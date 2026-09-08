#!/usr/bin/env python3
"""Session recorder for werkstadt: renders one finished session's replay to
an MP4 you can watch later and hand to somebody who has no server.

Why a file at all, when `index.html?project=..&session=..&replay=1` already
replays the same session exactly and for free: that link only works for someone
who can reach this machine. The MP4 is the half that travels. The link stays the
lossless master -- see docs/DECISIONS.md, "A recording is two things".

How the film is made, and why it is not a screen capture:

  * The page is driven, not watched. `?record=1` puts replay.js on a fixed step
    of 1/30 s of FILM per `window.__recordTick()`, so one drawn frame is worth
    exactly one frame of output however long it took to draw. Headless Chrome
    on this machine has no GPU (docs/RUNBOOK.md) and renders a few frames a
    second; a real-time capture would have shown a sixth of the session.
  * Frames come back through `Page.captureScreenshot`, the same call the
    screenshot harness in docs/RUNBOOK.md already uses, one per tick. There is
    no dropped-frame case to reason about because nothing is racing.
  * ffmpeg is the SYSTEM ffmpeg on PATH. Nothing bundled: Smart App Control
    blocks unsigned downloaded binaries on this machine (memory:
    remotion-ffmpeg-blocked-by-sac).

Nothing here uploads anything, ever. Transcripts carry client work; a file
leaves this machine only when a person clicks something. See
docs/DECISIONS.md, "Recordings are never uploaded automatically".

Stdlib only. The WebSocket client below exists because Python has no client of
its own and the alternative was a pip dependency for ~90 lines of framing.
"""
import base64
import json
import logging
import os
import re
import shutil
import socket
import struct
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("werkstadt.recorder")

# -- the film's shape ------------------------------------------------------
FPS = 30
WIDTH, HEIGHT = 1920, 1080
# Everything below is a bound, not a preference: past them the file stops being
# something you can send to a person.
MAX_MB = 30
CRF = "26"
MAXRATE = "2600k"

# -- when a session is worth a film ----------------------------------------
SILENT_SECS = 10 * 60      # a session still being typed into is not finished
MIN_TOOL_EVENTS = 20       # under this there is no city to watch being built
BACKLOG_DAYS = 30          # first run only reaches back this far; older on demand
IDLE_POLL_SECS = 300       # how often the loop looks for something to render
RENDER_TIMEOUT_SECS = 45 * 60

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
]


# =========================================================================
# WEBSOCKET — the minimum RFC 6455 client CDP needs
# Text frames out (masked, as a client must), text frames in (never masked).
# Binary, ping and continuation are handled because Chrome does send pings on
# a connection held open for the twenty minutes a render takes.
# =========================================================================
class _WS:
    def __init__(self, url, timeout=90):
        # ws://127.0.0.1:9333/devtools/page/<id>
        rest = url.split("://", 1)[1]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise OSError("websocket handshake closed by peer")
            buf += chunk
        head, _, rest_bytes = buf.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0] + b" ":
            raise OSError(f"websocket upgrade refused: {head.splitlines()[0]!r}")
        self._buf = bytearray(rest_bytes)

    def _read(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise OSError("websocket closed mid-frame")
            self._buf += chunk
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out

    def send(self, text):
        payload = text.encode("utf-8")
        n = len(payload)
        header = bytearray([0x81])          # FIN + text
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv(self):
        """One complete text message, reassembling continuation frames."""
        parts = []
        while True:
            b0, b1 = self._read(2)
            fin, opcode = b0 & 0x80, b0 & 0x0F
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            data = self._read(n) if n else b""
            if opcode == 0x9:               # ping -> pong, or Chrome drops us
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if opcode == 0xA:               # pong
                continue
            if opcode == 0x8:
                raise OSError("websocket closed by peer")
            parts.append(data)
            if fin:
                return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class CDP:
    """One page target, driven synchronously. Events are read and dropped:
    nothing here subscribes to any, so a reply is the only message worth
    keeping and a stray event just gets skipped over."""

    def __init__(self, ws_url):
        self.ws = _WS(ws_url)
        self._id = 0

    def call(self, method, params=None, timeout=120):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = json.loads(self.ws.recv())
            if msg.get("id") != mid:
                continue                     # an event, or an older reply
            if "error" in msg:
                raise RuntimeError(f"{method}: {msg['error'].get('message')}")
            return msg.get("result", {})
        raise TimeoutError(method)

    def eval(self, expr, await_promise=False, timeout=120):
        r = self.call("Runtime.evaluate",
                      {"expression": expr, "returnByValue": True,
                       "awaitPromise": await_promise}, timeout=timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"page threw: {r['exceptionDetails'].get('text')}")
        return r.get("result", {}).get("value")

    def close(self):
        self.ws.close()


# =========================================================================
# THE TOOLS THIS NEEDS TO EXIST
# =========================================================================
def find_chrome():
    for p in CHROME_CANDIDATES:
        if Path(p).is_file():
            return p
    return shutil.which("chrome") or shutil.which("chrome.exe")


def find_ffmpeg():
    """The SYSTEM ffmpeg. `shutil.which` first so PATH wins, then winget's own
    package directory, which is where this machine's copy actually lives and
    which is not always on a service's PATH."""
    hit = shutil.which("ffmpeg")
    if hit:
        return hit
    root = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if root.is_dir():
        for exe in root.glob("Gyan.FFmpeg*/**/bin/ffmpeg.exe"):
            return str(exe)
    return None


def find_ffprobe():
    hit = shutil.which("ffprobe")
    if hit:
        return hit
    ff = find_ffmpeg()
    if ff:
        cand = Path(ff).with_name("ffprobe.exe")
        if cand.is_file():
            return str(cand)
    return None


# Windows only; on anything else the flag simply does not exist and the render
# runs at normal priority rather than failing.
_LOW_PRIORITY = getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)


# =========================================================================
# NAMING — one film's three files
# =========================================================================
# Unicode alphanumerics survive, everything else becomes a hyphen. NOT
# [^a-z0-9]: Beri's session titles are Hebrew, and an ASCII-only slug turned
# every one of them into the same filename ("session"), which the shelf then
# could not tell apart. Windows takes Hebrew filenames, and a browser
# percent-encodes them on the way back out.
_SLUG_STRIP = re.compile(r"[^\w]+", re.UNICODE)


def slug(text, limit=60):
    s = _SLUG_STRIP.sub("-", (text or "").lower()).strip("-_")
    return (s[:limit].rstrip("-_") or "session")


def output_paths(recordings_dir, cand):
    """recordings/<project>/<YYYY-MM-DD>_<title-slug>.mp4 (+ .jpg, + .json).

    Dated and named after the session, not after its uuid, because the point of
    the shelf is that a person recognises the film without opening it. The uuid
    is inside the sidecar, which is what the code matches on."""
    day = (cand.get("started") or "")[:10] or "undated"
    folder = recordings_dir / slug(cand.get("project") or "project", 48)
    stem = f"{day}_{slug(cand.get('title'))}"
    return (folder / f"{stem}.mp4", folder / f"{stem}.jpg", folder / f"{stem}.json")


def already_rendered(recordings_dir, session_id):
    """True when some sidecar already claims this session. Matching on the
    SIDECAR and not on the filename: a session's title can be re-derived
    differently by a later parser, and re-rendering a film that already exists
    because its slug moved is exactly the waste this guards."""
    for j in recordings_dir.glob("*/*.json"):
        try:
            if json.loads(j.read_text(encoding="utf-8")).get("session_id") == session_id:
                return True
        except (OSError, ValueError):
            continue
    return False


# =========================================================================
# THE RENDER
# =========================================================================
def _launch_chrome(chrome, port, profile_dir):
    """Our own port and our own profile directory, per docs/RUNBOOK.md's first
    capture trap: two harnesses sharing a debugging port screenshot each
    other's pages. The returned Popen is the ONLY thing this module ever kills
    -- never `taskkill /IM chrome.exe`, which takes every other agent's browser
    with it (docs/RUNBOOK.md, traps)."""
    args = [
        chrome,
        "--headless=new",
        f"--remote-debugging-port={port}",
        f"--window-size={WIDTH},{HEIGHT}",
        "--enable-unsafe-swiftshader",       # no GPU here; without it there is no WebGL
        "--hide-scrollbars",
        "--mute-audio",
        # A headless window counts as occluded on Windows, and an occluded
        # Chrome stops running rAF entirely -- the page would render nothing
        # and __recordTick() would never resolve (docs/RUNBOOK.md, traps).
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-features=CalculateNativeWinOcclusion",
        f"--user-data-dir={profile_dir}",
        "about:blank",
    ]
    return subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=_LOW_PRIORITY)


def _page_ws_url(port, timeout=30):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as r:
                for t in json.loads(r.read().decode("utf-8")):
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        return t["webSocketDebuggerUrl"]
        except Exception as e:      # the port is simply not open yet
            last = e
        time.sleep(0.4)
    raise TimeoutError(f"chrome never offered a page target on {port}: {last}")


def film_url(port, cand):
    """The record-mode address. `since` is on it because /api/project's window
    is the last 30 days and a backlog session can sit outside it."""
    from urllib.parse import quote
    return (f"http://127.0.0.1:{port}/index.html"
            f"?project={quote(cand['project_id'])}"
            f"&session={quote(cand['session_id'])}"
            f"&replay=1&record=1"
            f"&since={quote(cand.get('started') or '')}")


def replay_url(cand):
    """The free, exact recording: the same session in its own project city."""
    from urllib.parse import quote
    return (f"/index.html?project={quote(cand['project_id'])}"
            f"&session={quote(cand['session_id'])}"
            f"&replay=1&since={quote(cand.get('started') or '')}")


def _run(cmd, timeout):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                          creationflags=_LOW_PRIORITY)


def render_one(cand, recordings_dir, server_port, frames_dir, cdp_port=9377):
    """Render one candidate. Returns the sidecar dict, or None on failure.

    Writes nothing under `recordings/` until ffmpeg has actually produced a
    playable file, so a crashed render leaves no half-film for the shelf to
    list."""
    chrome = find_chrome()
    ffmpeg = find_ffmpeg()
    if not chrome:
        log.error("[recorder] no chrome.exe found; nothing can be rendered")
        return None
    if not ffmpeg:
        log.error("[recorder] no system ffmpeg on PATH; nothing can be encoded")
        return None

    mp4, poster, sidecar = output_paths(recordings_dir, cand)
    if mp4.exists():
        return None

    if frames_dir.exists():
        shutil.rmtree(frames_dir, ignore_errors=True)
    frames_dir.mkdir(parents=True, exist_ok=True)
    profile_dir = frames_dir.parent / "cdp-profile"

    proc = None
    cdp = None
    t0 = time.time()
    frames = 0
    speed = 1.0
    try:
        proc = _launch_chrome(chrome, cdp_port, profile_dir)
        cdp = CDP(_page_ws_url(cdp_port))
        cdp.call("Page.enable")
        cdp.call("Runtime.enable")
        cdp.call("Emulation.setDeviceMetricsOverride",
                 {"width": WIDTH, "height": HEIGHT, "deviceScaleFactor": 1, "mobile": False})
        cdp.call("Page.navigate", {"url": film_url(server_port, cand)})

        # Wait for record mode to actually be armed rather than for a stopwatch:
        # the page has ~100 MB of assets and a project payload to fetch first.
        deadline = time.time() + 300
        while time.time() < deadline:
            if cdp.eval("typeof window.__recordTick === 'function'"):
                break
            time.sleep(1.0)
        else:
            raise TimeoutError("record mode never armed (no __recordTick)")
        state = cdp.eval("window.__recordState()")
        speed = float(state.get("speed") or 1)

        # The loop: one tick, one screenshot, until the page says it is done.
        while state.get("phase") != "done":
            state = cdp.eval("window.__recordTick()", await_promise=True, timeout=180)
            shot = cdp.call("Page.captureScreenshot",
                            {"format": "jpeg", "quality": 82, "optimizeForSpeed": True})
            frames += 1
            # decoded straight to disk; the base64 never goes anywhere it could
            # be printed (docs/RUNBOOK.md: never print base64 into a transcript)
            (frames_dir / f"f{frames:06d}.jpg").write_bytes(
                base64.b64decode(shot["data"]))
            if time.time() - t0 > RENDER_TIMEOUT_SECS:
                raise TimeoutError(f"render exceeded {RENDER_TIMEOUT_SECS}s at frame {frames}")
    except Exception as e:
        log.error("[recorder] %s: %s", cand.get("title"), e)
        return None
    finally:
        if cdp:
            cdp.close()
        if proc and proc.poll() is None:
            proc.terminate()            # OUR pid only
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(profile_dir, ignore_errors=True)

    if frames < FPS:                    # under a second of film is a failed render
        log.error("[recorder] %s produced only %d frames", cand.get("title"), frames)
        shutil.rmtree(frames_dir, ignore_errors=True)
        return None

    mp4.parent.mkdir(parents=True, exist_ok=True)
    tmp_mp4 = frames_dir.parent / "out.mp4"
    enc = _run([ffmpeg, "-y", "-framerate", str(FPS),
                "-i", str(frames_dir / "f%06d.jpg"),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", CRF,
                "-maxrate", MAXRATE, "-bufsize", "5M",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                str(tmp_mp4)], timeout=1800)
    if enc.returncode != 0 or not tmp_mp4.exists():
        log.error("[recorder] ffmpeg failed: %s", (enc.stderr or "")[-400:])
        shutil.rmtree(frames_dir, ignore_errors=True)
        return None

    duration = frames / FPS
    _run([ffmpeg, "-y", "-ss", f"{duration * 0.55:.2f}", "-i", str(tmp_mp4),
          "-frames:v", "1", "-q:v", "3", str(poster)], timeout=180)
    shutil.move(str(tmp_mp4), str(mp4))
    shutil.rmtree(frames_dir, ignore_errors=True)

    size = mp4.stat().st_size
    meta = {
        "project": cand.get("project"),
        "project_id": cand.get("project_id"),
        "session_id": cand.get("session_id"),
        "title": cand.get("title"),
        "started": cand.get("started"),
        "ended": cand.get("ended"),
        "tool_events": cand.get("tool_events"),
        "frames": frames,
        "fps": FPS,
        "speed": round(speed, 2),
        "duration_secs": round(duration, 2),
        "width": WIDTH, "height": HEIGHT,
        "bytes": size,
        "over_size_budget": size > MAX_MB * 1024 * 1024,
        "rendered": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "render_secs": round(time.time() - t0, 1),
        "mp4": "/" + mp4.relative_to(recordings_dir.parent).as_posix(),
        "poster": "/" + poster.relative_to(recordings_dir.parent).as_posix() if poster.exists() else None,
        "replay_url": replay_url(cand),
    }
    sidecar.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("[recorder] wrote %s (%.1fs film, %.1f MB, %d frames, %.1f min)",
             mp4.name, duration, size / 1048576, frames, meta["render_secs"] / 60)
    return meta


# =========================================================================
# THE SHELF'S OWN READ — every sidecar on disk, newest first
# =========================================================================
def list_recordings(recordings_dir):
    out = []
    if not recordings_dir.is_dir():
        return out
    for j in sorted(recordings_dir.glob("*/*.json")):
        try:
            meta = json.loads(j.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        mp4 = recordings_dir.parent / meta.get("mp4", "").lstrip("/")
        if not mp4.is_file():
            continue                    # a sidecar whose film was deleted is not a row
        out.append(meta)
    out.sort(key=lambda m: m.get("started") or "", reverse=True)
    return out


# =========================================================================
# THE LOOP — one render at a time, only on an idle machine
# =========================================================================
def _loop(recordings_dir, work_dir, server_port, candidates_fn, busy_fn):
    # A first pass has to wait for the server it is going to screenshot.
    time.sleep(60)
    while True:
        try:
            # Scanned BEFORE the busy check, not after: this is also what keeps
            # the shelf's "still to render" count true while Beri is working,
            # and it is cheap once server.py's own cache is warm.
            cands = [c for c in candidates_fn()
                     if not already_rendered(recordings_dir, c["session_id"])]
            if busy_fn():
                time.sleep(IDLE_POLL_SECS)
                continue
            if not cands:
                time.sleep(IDLE_POLL_SECS)
                continue
            # Newest first: the session Beri just finished is the one he might
            # want to watch, and the backlog can wait for the next idle window.
            cands.sort(key=lambda c: c.get("ended") or c.get("started") or "", reverse=True)
            render_one(cands[0], recordings_dir, server_port, work_dir / "frames")
        except Exception:
            log.exception("[recorder] loop error")
        time.sleep(IDLE_POLL_SECS)


def start(recordings_dir, work_dir, server_port, candidates_fn, busy_fn):
    """One daemon thread, started from server.py's main(). Never more than one
    render in flight, because the machine has one integrated GPU and a second
    headless Chrome on it is measurably the difference between 36 and 51 fps
    (docs/RUNBOOK.md)."""
    recordings_dir.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)
    t = threading.Thread(target=_loop, name="recorder", daemon=True,
                         args=(recordings_dir, work_dir, server_port,
                               candidates_fn, busy_fn))
    t.start()
    return t

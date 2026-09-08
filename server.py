#!/usr/bin/env python3
"""Live server for Werkstadt: static file server + two SSE feeds.

Usage: python server.py [--port 4949] [--vault "/path/to/an/obsidian/vault"]

Everything the two flags above set also lives in config.json, which is written
from config.example.json on first run — the flags are the override, the file is
the setting. See load_config() below.

Endpoints:
  GET /                same static files python -m http.server would serve,
                        rooted at this script's own directory (not the cwd
                        the process happens to be launched from).
  GET /api/config.js    the client-visible slice of config.json, as a script
                        the pages load before their own module (globe.js reads
                        window.WERKSTADT_CONFIG for the continent rules).
  GET /api/stream       text/event-stream of the Claude Code session you are
                        currently working in, converted to the replay event
                        shape the client's window.ingest() already expects
                        (see replay.js). ?session=<uuid> pins one session;
                        otherwise the most recently modified main session
                        file is followed, switching when a newer one appears.
  GET /api/vault        text/event-stream of Obsidian vault file changes.
  GET /api/sessions     JSON: the 10 most recent main sessions.

Session parsing reuses tools/export_replay.py directly (imported, not
copied): the pure helpers (to_ms, clip, redact, tool_summary, tool_path,
iter_transcript_lines, load_agent_metas, process_file) are called as-is so
tailed events are redacted and summarised exactly like an exported replay
file. Two small pieces of export_replay's *orchestration* are adapted (not
imported) because that module only ever reads a whole file from byte 0 --
each adaptation carries a comment naming the function it mirrors.
"""
import argparse
import base64
import gzip
import hashlib
import hmac
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse, parse_qs, quote, unquote

# The floor, checked rather than documented, because the failure without it
# is a stack trace out of the standard library that reads like a bug in this
# file. 3.9 is what the code actually needs and what it is tested on here
# (3.9.13 and 3.12.10); nothing in the tree uses match statements, `X | Y`
# annotations or fromisoformat's "Z", which are what would push it to 3.10+.
MIN_PYTHON = (3, 9)
if sys.version_info < MIN_PYTHON:
    sys.exit("Werkstadt needs Python %d.%d or newer (this is %d.%d)." % (
        MIN_PYTHON + sys.version_info[:2]))

SCRIPT_DIR = Path(__file__).resolve().parent
log = logging.getLogger("werkstadt")
sys.path.insert(0, str(SCRIPT_DIR / "tools"))
import export_replay as er  # noqa: E402  (path must be set up first)
import export_vault as ev  # noqa: E402  (path must be set up first)
import recorder as rc  # noqa: E402  (path must be set up first)


# ==========================================================================
# CONFIGURATION
# Everything machine-specific used to be a literal in this file. It is now one
# JSON file, because a public clone runs on somebody else's disk: their
# transcripts are somewhere else, their vault may not exist at all, and their
# projects are not laid out like ours.
#
# config.json is gitignored and written from config.example.json the first
# time the server starts, so a fresh clone needs no setup step and an upgrade
# never overwrites what the user edited. Comment keys (anything starting with
# an underscore) are carried through untouched -- the example file documents
# itself, and a copy of it should still read as documentation.
# ==========================================================================

CONFIG_PATH = SCRIPT_DIR / "config.json"
CONFIG_EXAMPLE_PATH = SCRIPT_DIR / "config.example.json"


def _cfg_path(value, default=None):
    """A configured path as a Path, or None when it is not set.

    `~` is expanded (the example file uses it, and a user will type it), and a
    relative path is resolved against the Werkstadt folder rather than
    whatever cwd the process was launched from -- the same rule SCRIPT_DIR
    exists for everywhere else in this file."""
    s = (value if value not in (None, "") else default)
    if not s:
        return None
    p = Path(str(s)).expanduser()
    return p if p.is_absolute() else (SCRIPT_DIR / p)


def load_config():
    """config.json, created from config.example.json on first run.

    Missing keys fall back to the example's own values rather than to literals
    scattered through this file: the example IS the schema, so a config.json
    written against an older version keeps working when a key is added."""
    defaults = {}
    try:
        defaults = json.loads(CONFIG_EXAMPLE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass  # a stripped-down deployment may have deleted it; defaults below cover it
    if not CONFIG_PATH.exists():
        try:
            CONFIG_PATH.write_text(
                CONFIG_EXAMPLE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
        except OSError:
            pass  # read-only checkout: fall through and run on the example's values
    user = {}
    try:
        user = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        if CONFIG_PATH.exists():
            print(f"config.json is not valid JSON ({e}) - using defaults", file=sys.stderr)
    merged = dict(defaults)
    merged.update(user)
    return merged


CONFIG = load_config()

PROJECTS_DIR = _cfg_path(CONFIG.get("transcripts_root"), "~/.claude/projects")
# OPTIONAL. None when config.json leaves "vault" empty, which is the shipped
# default: the globe and the island are the product, the Obsidian layer is an
# extra for people who happen to keep one. Everything downstream of this is
# written to run with it absent -- see main(), which substitutes a path that
# cannot exist so every `vault_dir / ...` and `.rglob()` stays valid and empty.
VAULT_DIR = _cfg_path(CONFIG.get("vault"))
# Optional HTTP Basic Auth, for the case where the server is deliberately
# reachable beyond loopback (a phone over a private VPN -- docs/RUNBOOK.md).
# Absent file -> auth stays off, unchanged local behaviour.
AUTH_SECRETS_PATH = _cfg_path(CONFIG.get("auth_secrets"), "data/auth.json")
KEEPALIVE_SECS = 15
STREAM_POLL_SECS = 0.5
VAULT_POLL_SECS = 2
VAULT_REGEN_DEBOUNCE_SECS = 30  # quiet period after the last change before re-exporting
VAULT_REGEN_MIN_INTERVAL_SECS = 60  # never re-export more often than this
SESSION_SWITCH_CHECK_EVERY = 6  # * STREAM_POLL_SECS = every 3s
# /api/stream?project= sends its history-so-far in chunks of this many
# events (each still one _send_event()/flush() apiece) rather than one
# unbroken write -- see handle_project_stream()'s docstring, docs/TESTS.md A8.
PROJECT_STREAM_CHUNK = 500

# A tool_use whose tool_result hasn't arrived after this many seconds of real
# wall time gets a synthetic tool_end/pulse_end (ok: null) from the server
# itself, on both /api/stream and /api/world/stream -- the live-parity gap
# docs/HANDOFF.md's sixth pass left open (the client's own WORKER_TIMEOUT_MS
# in city.js, also 90s, was a workaround measured in SESSION time and only
# ever covered live mode; this is the real fix). A module-level name, not a
# literal inside the function that reads it, so a test can monkeypatch it.
PENDING_CALL_TIMEOUT_SECS = 90
# How often a path already seen from a file-tool event gets re-stat()'d for
# "did it disappear" -- see detect_deletions() below.
DELETE_RECHECK_SECS = 60


# ==========================================================================
# REDACTION — config.json "redact": true, or --redact for one run
#
# What it is for: the wallpaper, a screen share, a conference talk and a
# recorded film all put this world on somebody else's screen, and the world
# is made of your directory tree. With redaction on, every name that came
# out of your disk is replaced by a stable pseudonym before it leaves this
# process, so the city still has the same shape, the same street count and
# the same buildings — it just no longer says whose they are.
#
# SERVER-SIDE, not a display filter, and that is the whole point: three
# renderers (city.js, world.js, globe.js), a recorder and a phone page all
# read these payloads, and every one of them would otherwise have to
# remember to hide the same fields. Redacting at the edge of the process
# means a curl of any /api/* route is as clean as the screen is.
#
# Applied at the response boundary rather than inside the builders, for one
# concrete reason: build_world_static(), cached_build_replay() and the trade
# cache all persist to data/.cache/, and a redacted run must not leave
# pseudonyms behind in a cache that a later normal run then reads back as
# truth. The boundary is also the one place that is provably complete —
# _send_event() is the single writer for all four SSE feeds.
#
# Pseudonyms are a hash of the real string and nothing else: the same folder
# is the same "dir-7c21" on every machine and across restarts, so a film
# recorded today and one recorded next month still agree with each other,
# and a screenshot in the docs stays reproducible.
# ==========================================================================

REDACT = bool(CONFIG.get("redact"))

# Labels the code itself emits rather than reads off your disk. Hashing
# "Orchestrator" into task-4f10 would hide nothing and cost the one label
# that makes a drone swarm readable.
PUBLIC_LABELS = {"Orchestrator", "main"}

REDACTED_FILE_NOTICE = (
    "[redacted]\n\n"
    "Werkstadt is running with \"redact\": true, so file contents are not\n"
    "served. The building, its height and its floors are still real - only\n"
    "the text on the walls is withheld.\n\n"
    "Set \"redact\": false in config.json (or drop --redact) to read files\n"
    "again.\n")

REDACTED_HTML_NOTICE = (
    "<!doctype html><meta charset=\"utf-8\"><title>redacted</title>"
    "<body style=\"margin:0;display:grid;place-items:center;height:100vh;"
    "background:#0b0d10;color:#8a94a6;font:14px/1.6 system-ui,sans-serif\">"
    "<p>Page preview withheld &mdash; Werkstadt is running redacted.</p>")


def _pseudo(prefix, real, n=4):
    """A stable pseudonym for one real string. blake2s because it is in the
    standard library and fast; four hex characters because these are read on
    screen at a distance and 65k buckets is plenty to tell two towns apart."""
    h = hashlib.blake2s(str(real).replace("\\", "/").lower().encode("utf-8"),
                        digest_size=8).hexdigest()
    return "%s-%s" % (prefix, h[:n])


def redact_name(name):
    return _pseudo("town", name or "")


def redact_task(label):
    return label if label in PUBLIC_LABELS else _pseudo("task", label or "")


def redact_session(sid):
    return _pseudo("session", sid or "")


def redact_town_path(path):
    """A synthetic path that keeps exactly what the client reads out of a
    town's path and nothing else.

    globe.js does two things with it: it compares the prefix against `home`
    to decide continent-or-offshore-island, and it looks for each
    `continents` rule's `path_contains` fragment to pick the landmass. Both
    are preserved here - the fragment is one you wrote in config.json, not a
    name off your disk - so a redacted planet has the same geography as the
    real one. Everything after it is a pseudonym. handle_client_config()
    sends `home` as "~" to match."""
    p = str(path or "").replace("\\", "/")
    if not p:
        return ""
    low = p.lower()
    home = str(Path.home()).replace("\\", "/").lower()
    if home and not low.startswith(home):
        return "offshore/" + _pseudo("town", p)     # -> an island, as before
    for r in (CONFIG.get("continents") or []):
        frag = str((r or {}).get("path_contains") or "").lower()
        if frag and frag in low:
            return "~" + frag.rstrip("/") + "/" + _pseudo("town", p)
    return "~/" + _pseudo("town", p)


def redact_file_path(path):
    """One building's label. Directory structure survives (a city with every
    file in one folder would be a different city); every segment is a
    pseudonym, and only the extension is kept, because the extension is what
    decides a building's material and roof."""
    p = str(path or "").replace("\\", "/").strip()
    if not p:
        return ""
    parts = [s for s in p.split("/") if s not in ("", ".", "..")]
    if not parts:
        return ""
    last = parts[-1]
    ext = "." + last.rsplit(".", 1)[-1] if "." in last[1:] else ""
    # A suffix is only kept when it looks like a file type. ".client-name"
    # is a perfectly legal suffix and would otherwise walk straight through.
    if not (2 <= len(ext) <= 6 and ext[1:].isalnum()):
        ext = ""
    out = [_pseudo("dir", s) for s in parts[:-1]]
    out.append(_pseudo("file", last) + ext)
    return "/".join(out)


def _redact_inflight(call):
    if not isinstance(call, dict):
        return call
    out = dict(call)
    if "path" in out:
        out["path"] = redact_file_path(out["path"])
    return out


def redact_agent(a):
    """A drone: its label is the task text it was dispatched with."""
    if not isinstance(a, dict):
        return a
    out = dict(a)
    if "label" in out:
        out["label"] = redact_task(out["label"])
    if "last_path" in out:
        out["last_path"] = redact_file_path(out["last_path"])
    if isinstance(out.get("inflight"), list):
        out["inflight"] = [_redact_inflight(c) for c in out["inflight"]]
    return out


def redact_event(ev):
    """One replay event. `summary` is dropped rather than pseudonymised for
    everything except an agent_start: for a prompt or a text block it IS the
    conversation, and for a tool call it is the tool's raw input JSON -
    file paths, shell commands, search patterns. An agent_start's summary is
    the drone's task tag, which has to stay a stable something so two drones
    on the same task still read as the same task."""
    if not isinstance(ev, dict):
        return ev
    out = dict(ev)
    if "path" in out:
        out["path"] = redact_file_path(out["path"])
    if "summary" in out:
        out["summary"] = (redact_task(ev.get("summary"))
                          if ev.get("kind") == "agent_start" else "")
    return out


def redact_town(t):
    """One settlement on the map. Only keys that are actually present are
    touched: /api/world/stream's `world` message carries a four-key state
    patch, not a whole town, and must not grow fields it never had."""
    if not isinstance(t, dict):
        return t
    out = dict(t)
    if "name" in out:
        out["name"] = redact_name(out["name"])
    if "path" in out:
        out["path"] = redact_town_path(out["path"])
    # A project's favicon is its client's logo. There is no pseudonym for a
    # picture, so the logo simply does not travel.
    if "logo" in out:
        out["logo"] = None
    if isinstance(out.get("open_items"), list):
        out["open_items"] = [_pseudo("item", s) for s in out["open_items"]]
    if isinstance(out.get("live_agents"), list):
        out["live_agents"] = [redact_agent(a) for a in out["live_agents"]]
    if isinstance(out.get("now"), dict):
        now = dict(out["now"])
        for k in ("prompt", "last_text"):
            if k in now:
                now[k] = ""
        if "last_path" in now:
            now["last_path"] = redact_file_path(now["last_path"])
        out["now"] = now
    return out


def redact_world(payload):
    """/api/world. `roads` are pairs of town ids and `meta` is counts, so
    neither carries a name."""
    out = dict(payload)
    out["towns"] = [redact_town(t) for t in payload.get("towns") or []]
    return out


def redact_sessions(rows):
    """/api/sessions. The uuid stays - it is how a page asks for one session
    back, and it is not a name."""
    out = []
    for s in rows:
        r = dict(s)
        for k in ("cwd", "root"):
            if k in r:
                r[k] = redact_town_path(r[k])
        r["title"] = redact_session(s.get("id") or s.get("title") or "")
        out.append(r)
    return out


def redact_project(obj):
    """/api/project - the whole city in one object."""
    out = dict(obj)
    if isinstance(obj.get("session"), dict):
        s = dict(obj["session"])
        if "cwd" in s:
            s["cwd"] = redact_town_path(s["cwd"])
        s["title"] = redact_name(s.get("title") or "")
        out["session"] = s
    if "root" in out:
        out["root"] = redact_town_path(out["root"])
    if isinstance(obj.get("town"), dict):
        out["town"] = redact_town(obj["town"])
    out["agents"] = [redact_agent(a) for a in obj.get("agents") or []]
    out["streets"] = [dict(s, title=redact_session(s.get("id") or ""))
                      for s in obj.get("streets") or []]
    out["events"] = [redact_event(e) for e in obj.get("events") or []]
    return out


def redact_meta(m):
    """/api/project/meta. `trade`, `stack` and `last_deploy` are kept: they
    are a schema.org type, a framework name and a date, none of which names
    anybody. `pages` and `site_url` are the client's own page titles and
    domain, so they do not travel."""
    out = dict(m)
    if "name" in out:
        out["name"] = redact_name(out["name"])
    if "root" in out:
        out["root"] = redact_town_path(out["root"])
    out["logo"] = None
    out["pages"] = []
    out["site_url"] = None
    return out


def _is_redacted_recording(meta):
    """A film whose FILENAME was written under redaction. The mp4 url has to
    stay literally true (it is the path the browser fetches), so a film
    rendered before redaction was turned on cannot be listed at all - its
    slug is a real session title. Films rendered while redacted are named
    from the pseudonyms _build_recording_candidates() hands the recorder, so
    they list normally."""
    return str(meta.get("project") or "").startswith("town-")


def redact_recordings(rows):
    out = []
    for m in rows:
        if not _is_redacted_recording(m):
            continue
        r = dict(m)
        r["title"] = redact_session(m.get("session_id") or "")
        r["project"] = redact_name(m.get("project") or "")
        out.append(r)
    return out


def redact_message(msg):
    """Every SSE message, from all four feeds. Dispatched on `kind`; anything
    unrecognised falls through to the last branch, which blanks the text
    fields these payloads use rather than passing an unknown shape through."""
    if not isinstance(msg, dict):
        return msg
    kind = msg.get("kind")
    if kind == "world":
        out = dict(msg)
        out["towns"] = [redact_town(t) for t in msg.get("towns") or []]
        return out
    if kind in ("pulse", "pulse_end"):
        out = dict(msg)
        if "path" in out:
            out["path"] = redact_file_path(out["path"])
        return out
    if kind == "street":
        return dict(msg, title=redact_session(msg.get("id") or ""))
    if kind in ("prompt", "text", "tool", "tool_end", "agent_start", "agent_end"):
        return redact_event(msg)
    out = dict(msg)
    for k in ("title", "name", "label", "summary", "text", "prompt", "note",
              "file", "cwd", "root"):
        if k in out:
            out[k] = ""
    if "path" in out:
        out["path"] = redact_file_path(out["path"])
    return out


# ==========================================================================
# Session discovery — main transcripts live at <project-dir>/<uuid>.jsonl;
# subagent transcripts live one level deeper at
# <project-dir>/<uuid>/subagents/agent-<id>.jsonl (per the docstring at the
# top of export_replay.py, confirmed against real data in ~/.claude/projects).
# ==========================================================================

def find_latest_session():
    """The most recently modified main session file across all projects."""
    best_path, best_mtime = None, -1
    for p in PROJECTS_DIR.glob("*/*.jsonl"):
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        if m > best_mtime:
            best_path, best_mtime = p, m
    return best_path


_session_path_cache = {}  # stem -> Path, one full-tree scan shared by every lookup
_session_path_cache_lock = threading.Lock()
_session_path_cache_at = 0
SESSION_PATH_CACHE_SECS = 5  # short: a session can start at any moment


def _refresh_session_path_cache():
    global _session_path_cache_at
    fresh = {p.stem: p for p in PROJECTS_DIR.glob("*/*.jsonl")}
    with _session_path_cache_lock:
        _session_path_cache.clear()
        _session_path_cache.update(fresh)
        _session_path_cache_at = time.time()


def find_session_by_id(session_id):
    """Was `next(PROJECTS_DIR.glob(f"*/{session_id}.jsonl"), None)` -- a
    full scan of every project directory for ONE filename. Fine for a single
    lookup, but build_project_replay() calls this once per session in a
    town, and a 337-session town paid for 337 full-tree scans (9.8 of its
    11.5s, measured) to resolve names a single scan already would have
    covered. Cached as one stem->path map, rebuilt at most once every
    SESSION_PATH_CACHE_SECS and immediately on any miss (a session that
    started after the last rebuild is still found right away, just via one
    fresh scan instead of a per-lookup one)."""
    with _session_path_cache_lock:
        hit = _session_path_cache.get(session_id)
        stale = time.time() - _session_path_cache_at > SESSION_PATH_CACHE_SECS
    if hit is not None and not stale:
        return hit
    _refresh_session_path_cache()
    with _session_path_cache_lock:
        return _session_path_cache.get(session_id)


def list_recent_sessions(limit=10):
    """The town field reuses the persistent index's project_calls (the same
    numbers build_world_static() folds sessions into towns with) rather than
    re-deriving project attribution here: the dominant project by file-tool
    call count wins, falling back to the session's own cwd town when no
    file-tool path resolved to a project at all -- same fallback order
    build_world_static() uses."""
    idx, _ = refresh_index()
    town_by_stem = {}
    root_by_stem = {}  # same town's own root path, forward slashes -- see /api/project's "root"
    for s in session_records(idx):
        pc = s.get("project_calls") or {}
        if pc:
            proj = max(pc.items(), key=lambda kv: kv[1])[0]
            town_by_stem[s["session"]] = town_id(proj)
            root_by_stem[s["session"]] = proj.replace("\\", "/")
        elif s["cwd"] and not is_temp_cwd(s["cwd"]):
            town_by_stem[s["session"]] = town_id(s["cwd"])
            root_by_stem[s["session"]] = s["cwd"].replace("\\", "/")
    files = list(PROJECTS_DIR.glob("*/*.jsonl"))
    files.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)
    out = []
    for p in files[:limit]:
        summary = session_summary(p)
        summary["town"] = town_by_stem.get(p.stem)
        summary["root"] = root_by_stem.get(p.stem)
        out.append(summary)
    return out


_session_summary_cache = {}  # path -> {"offset", "cwd", "title", "started", "session_id", "line_count"}
_session_summary_cache_lock = threading.Lock()


def _fresh_summary_state(stem):
    return {"offset": 0, "cwd": "", "title": "", "started": None,
            "session_id": stem, "line_count": 0}


def session_summary(path):
    """Lightweight metadata for /api/sessions. Mirrors the title/cwd
    extraction in export_replay.build_replay() (lines finding "cwd",
    "sessionId" and the first user prompt) but stops after a single pass
    instead of also building the full event list, since the sessions list
    doesn't need it.

    Incremental, via read_new_lines() (the same byte-offset tailer
    /api/stream uses), not a fresh full-file parse: this session's own live
    transcript reached 24 MB mid-work, and re-reading it whole on every
    /api/sessions poll cost 5-8s alone -- worse than a (size, mtime) cache
    can fix, since a LIVE session's mtime changes on every call by
    definition. Only the bytes appended since the last call are parsed;
    cwd/title/started, once found, don't need re-checking against lines
    that can't change them."""
    key = path.as_posix()
    with _session_summary_cache_lock:
        state = _session_summary_cache.get(key)
    if state is None:
        state = _fresh_summary_state(path.stem)

    try:
        size = path.stat().st_size
    except OSError:
        size = None
    if size is not None:
        if size < state["offset"]:
            state = _fresh_summary_state(path.stem)  # truncated/rotated: start over
        if size > state["offset"]:
            new_objs, new_offset = read_new_lines(path, state["offset"])
            state["offset"] = new_offset
            state["line_count"] += len(new_objs)
            for obj in new_objs:
                if not state["cwd"] and obj.get("cwd"):
                    state["cwd"] = obj["cwd"].replace("\\", "/")
                if obj.get("sessionId"):
                    state["session_id"] = obj["sessionId"]
                if state["started"] is None and obj.get("timestamp"):
                    state["started"] = obj["timestamp"]
                if not state["title"]:
                    msg = obj.get("message", {}) or {}
                    if msg.get("role") == "user":
                        content = msg.get("content")
                        if isinstance(content, str):
                            # An envelope (e.g. <scheduled-task ...>) is not a
                            # title -- task_line() skips its opening tag line
                            # and returns the first real prose line after it.
                            state["title"] = (task_line(content) if is_envelope(content)
                                               else er.clip(content, 80))
                        elif isinstance(content, list):
                            for b in content:
                                if isinstance(b, dict) and b.get("type") == "text":
                                    text = b.get("text", "")
                                    state["title"] = (task_line(text) if is_envelope(text)
                                                       else er.clip(text, 80))
                                    break
    subagents_dir = path.parent / path.stem / "subagents"
    agents = 1
    if subagents_dir.is_dir():
        agents += len(list(subagents_dir.glob("agent-*.meta.json")))
    result = {"id": state["session_id"], "cwd": state["cwd"], "started": state["started"],
              "events": state["line_count"], "agents": agents, "title": state["title"]}
    if size is not None:
        with _session_summary_cache_lock:
            _session_summary_cache[key] = state
    return result


# ==========================================================================
# Incremental tailing of one session's transcript files.
# ==========================================================================

def read_new_lines(path, offset):
    """Read complete new lines appended to `path` since byte `offset`.
    Returns (list_of_parsed_objects, new_offset). Filters the same way
    export_replay.iter_transcript_lines() does (skip "attachment" lines and
    control lines with no "message") so tailed events match what a full
    export would have produced -- but reads from an offset instead of the
    whole file, which iter_transcript_lines() has no way to do.
    A shrunk file (truncation/rotation, e.g. a compacted transcript) is
    treated as "nothing new yet": the offset jumps to the new end so we
    don't re-emit history already sent, rather than re-reading from 0 and
    flooding the client with duplicates of events it already has."""
    try:
        size = path.stat().st_size
    except OSError:
        return [], offset
    if size < offset:
        return [], size
    if size == offset:
        return [], offset
    objs = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        f.seek(offset)
        while True:
            pos = f.tell()
            line = f.readline()
            if not line or not line.endswith("\n"):
                offset = pos  # partial trailing line: wait for the rest next poll
                break
            offset = f.tell()
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "attachment" or "message" not in obj:
                continue
            objs.append(obj)
    return objs, offset


def line_to_events(obj, agent_id, session_start_ms, events,
                    pending_agent_calls, agent_meta_by_id, pending_tool_calls,
                    pending_since=None):
    """Convert one parsed transcript line into 0+ replay events. This is
    the per-line body of export_replay.process_file() (its `for obj in
    iter_transcript_lines(path)` loop, lines ~132-185) factored out so
    tailing can feed it one freshly-appended line at a time; process_file
    itself only ever walks a whole file from the start, so it can't be
    called incrementally without redoing already-sent lines.

    Mirrors process_file's "id" / tool_end handling (2026-09-05): every
    plain (non-Agent) "tool" event carries the tool_use block's "id", and a
    matching tool_result emits a "tool_end" ({"id", "ok"}). Unlike
    process_file/build_replay, nothing here ever synthesizes a tool_end for
    a call still pending when the poll ends -- a live stream has no "end"
    to flush pending calls at; they simply stay in pending_tool_calls
    (owned by the caller, one dict per SessionTail, across polls) until a
    later poll sees their tool_result, however long that takes -- or until
    SessionTail.check_timeouts() gives up on it after PENDING_CALL_TIMEOUT_SECS.

    `pending_since` (tool_use_id -> wall-clock time.time() the call was first
    seen pending), when given, is what check_timeouts() reads; optional
    because burst() seeds it itself from the already-built events' real
    historical timestamps instead of "now"."""
    ts = obj.get("timestamp")
    if not ts:
        return
    t_rel = er.to_ms(ts) - session_start_ms
    msg = obj["message"]
    role = msg.get("role")
    content = msg.get("content")

    if role == "user":
        if isinstance(content, str):
            events.append({"t": t_rel, "agent": agent_id, "kind": "prompt",
                            "summary": er.clip(content, 60)})
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    events.append({"t": t_rel, "agent": agent_id, "kind": "prompt",
                                    "summary": er.clip(block.get("text", ""), 60)})
                elif btype == "tool_result":
                    tu_id = block.get("tool_use_id")
                    if tu_id in pending_agent_calls:
                        child_id = pending_agent_calls.pop(tu_id)
                        events.append({"t": t_rel, "agent": agent_id, "kind": "agent_end",
                                        "summary": ""})
                        if child_id in agent_meta_by_id:
                            agent_meta_by_id[child_id]["ended_ms_hint"] = t_rel
                    elif tu_id in pending_tool_calls:
                        # Matching tool_end for a plain (non-Agent) tool call --
                        # mirrors process_file()'s same branch.
                        call_agent = pending_tool_calls.pop(tu_id)
                        if pending_since is not None:
                            pending_since.pop(tu_id, None)
                        events.append({"t": t_rel, "agent": call_agent, "kind": "tool_end",
                                        "id": tu_id, "ok": not block.get("is_error", False)})
    elif role == "assistant":
        if isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    events.append({"t": t_rel, "agent": agent_id, "kind": "text",
                                    "summary": er.clip(block.get("text", ""), 60)})
                elif btype == "tool_use":
                    name = block.get("name", "")
                    input_obj = block.get("input", {}) or {}
                    if name == "Agent":
                        pending_agent_calls[block.get("id")] = block.get("id")
                        events.append({"t": t_rel, "agent": agent_id, "kind": "agent_start",
                                        "tool": "Agent",
                                        "summary": er.clip(input_obj.get("description", ""), 60)})
                    else:
                        tool_id = block.get("id")
                        ev = {"t": t_rel, "agent": agent_id, "kind": "tool",
                              "tool": name, "id": tool_id, "summary": er.tool_summary(name, input_obj)}
                        p = er.tool_path(name, input_obj)
                        if p:
                            ev["path"] = p
                        events.append(ev)
                        if tool_id:
                            pending_tool_calls[tool_id] = agent_id
                            if pending_since is not None:
                                pending_since[tool_id] = time.time()


# ==========================================================================
# file_deleted detection -- shared by /api/stream (SessionTail) and the
# world map's pulses (tool_pulses(), further below). Per docs/HANDOFF.md's
# sixth pass ("What server.py must add for live parity", gap 2): the client
# only ever saw a delete when replay.js's own derezFromShell() spotted an
# rm/del/Remove-Item command AND the city already happened to have that
# building. Two independent ways a delete is confirmed here instead:
# ==========================================================================

# (a) A Bash/PowerShell command whose FIRST line (mirrors export_replay.py's
# bash_summary(), which also only ever looks at the first line) names one of
# these verbs. `git rm` is matched as two words before the generic verbs so
# it isn't mistaken for a bare `rm` losing the `git` prefix. The separator
# run before the verb (one or more of `;&|`, so `&&`/`||` count) must not be
# preceded by a backslash -- without that guard, a Bash call that merely
# GREPS for a pattern like `derezFromShell\|rm\|Remove-Item` false-positives
# on its own escaped `|rm` (caught live testing this very change: a `grep`
# command run to check this file matched itself and "deleted" a nonsense
# path). Still not a real shell parser -- see the NOTES on remaining
# ambiguity in docs/HANDOFF.md.
DELETE_CMD_RE = re.compile(
    r"(?:^|(?<!\\)[;&|]+\s*)(?:git\s+rm|rm|del|rmdir|Remove-Item)\b(?P<rest>.*)$", re.I)


def _first_delete_target(command):
    """The first non-flag argument after a delete verb, or None if the line
    isn't a delete command at all, or names no argument (`git rm --cached`
    with nothing else, a bare `rm`)."""
    if not command:
        return None
    m = DELETE_CMD_RE.search(command.splitlines()[0])
    if not m:
        return None
    for raw in m.group("rest").split():
        tok = raw.strip("\"'")
        if not tok or tok.startswith("-"):
            continue
        return tok
    return None


def _resolve_delete_path(token, cwd):
    """Join a relative delete target against the session's own cwd (the
    line's own top-level "cwd" field -- present per line, same source
    scan_transcript()/session_summary() already read it from); an
    already-absolute target (drive letter or leading slash) is returned as
    given. Forward-slashed, matching er.tool_path()'s own normalisation, so
    a resolved delete path relativises client-side exactly like any other
    file-tool path."""
    if not token:
        return None
    t = token.replace("\\", "/")
    if re.match(r"^[A-Za-z]:/", t) or t.startswith("/"):
        return t
    if not cwd:
        return None
    return norm_cwd(cwd).rstrip("/") + "/" + t


def detect_deletions(obj, agent_id, session_start_ms, events,
                      pending_deletes, known_paths):
    """Appends 0+ "file_deleted" events for one transcript line. Independent
    of line_to_events()/process_file()'s normal tool/tool_end bookkeeping --
    owns its own two dicts, so it is only ever additive and never changes
    what those already emit.

    (a) above: a delete command is provisional the moment it fires (a `rm`
    that fails leaves the file standing) so it is held in `pending_deletes`
    (tool_use_id -> (agent_id, resolved_path)) until its OWN tool_result
    comes back without is_error -- same "confirmed, not assumed" rule
    tool_end already uses for ok.

    (b): a path already seen from an earlier file-tool event (Read/Edit/
    Write/MultiEdit/Glob/Grep -- er.PATH_TOOLS) that no longer exists on
    disk the next time *any* event in this session references that same
    path again. `known_paths` (path -> wall time last checked) throttles the
    stat() to at most once per path per DELETE_RECHECK_SECS -- first sight
    just records it, since the tool call that referenced it succeeding is
    already good evidence it existed then."""
    ts = obj.get("timestamp")
    if not ts:
        return
    t_rel = int(er.to_ms(ts) - session_start_ms)
    msg = obj.get("message") or {}
    content = msg.get("content")
    if not isinstance(content, list):
        return
    role = msg.get("role")
    if role == "assistant":
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            name = block.get("name", "")
            input_obj = block.get("input") or {}
            tool_id = block.get("id")
            if name in ("Bash", "PowerShell") and tool_id:
                target = _first_delete_target(input_obj.get("command", ""))
                resolved = _resolve_delete_path(target, obj.get("cwd")) if target else None
                if resolved:
                    pending_deletes[tool_id] = (agent_id, resolved)
            elif name in er.PATH_TOOLS:
                p = er.tool_path(name, input_obj)
                if not p:
                    continue
                last = known_paths.get(p)
                now = time.time()
                if last is None:
                    known_paths[p] = now
                elif now - last >= DELETE_RECHECK_SECS:
                    known_paths[p] = now
                    if not Path(p).exists():
                        events.append({"t": t_rel, "agent": agent_id,
                                       "kind": "file_deleted", "path": p})
                        del known_paths[p]  # gone; a later touch re-adds it fresh
    elif role == "user":
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            pend = pending_deletes.pop(block.get("tool_use_id"), None)
            if pend and not block.get("is_error", False):
                a_id, path = pend
                events.append({"t": t_rel, "agent": a_id,
                               "kind": "file_deleted", "path": path})


class SessionTail:
    """Tracks one session's parse state (byte offsets, which subagent files
    are known, and the pending-Agent-call / agent-meta dicts export_replay's
    own process_file() mutates) across repeated polls."""

    def __init__(self, session_path):
        self.session_path = session_path
        self.session_dir = session_path.parent / session_path.stem
        self.subagents_dir = self.session_dir / "subagents"
        self.session_start_ms = None
        self.offsets = {}
        self.pending_agent_calls = {}
        self.agent_meta_by_id = {}
        # export_replay.process_file() grew a seventh argument (toolUseId ->
        # agent_id, present while a tool call has no tool_result yet) when
        # tool_end events were added to the exporter. build_replay() owns one
        # of these per run; tailing owns one per session, for the same reason
        # the two dicts above are held here rather than per call.
        self.pending_tool_calls = {}
        # tool_use_id -> wall time.time() first seen pending -- what
        # check_timeouts() ages against. Populated by line_to_events() as new
        # calls arrive live; seeded from burst()'s own historical timestamps
        # for whatever was already pending at connect time (see burst()).
        self.pending_since = {}
        # file_deleted detection state (detect_deletions() above), one dict
        # of each kind per session, same lifetime as pending_tool_calls.
        self.pending_deletes = {}
        self.known_paths = {}

    def burst(self):
        """Full parse for the initial replay-so-far burst. Adapted from
        export_replay.build_replay(): that function is self-contained and
        its pending_agent_calls/agent_meta_by_id dicts go out of scope when
        it returns, but tailing needs those same dicts afterwards to keep
        matching later Agent tool_use calls to their eventual tool_result --
        so this mirrors build_replay's loop (calling the SAME imported
        process_file/load_agent_metas/iter_transcript_lines/to_ms) instead
        of calling build_replay() and discarding its state."""
        metas = er.load_agent_metas(self.subagents_dir)

        for obj in er.iter_transcript_lines(self.session_path):
            if obj.get("timestamp"):
                self.session_start_ms = er.to_ms(obj["timestamp"])
                break
        if self.session_start_ms is None:
            raise ValueError(f"no timestamped lines in {self.session_path}")

        events = []
        er.process_file(self.session_path, "main", self.session_start_ms,
                         events, self.pending_agent_calls, self.agent_meta_by_id,
                         self.pending_tool_calls)
        for obj in er.iter_transcript_lines(self.session_path):
            detect_deletions(obj, "main", self.session_start_ms, events,
                              self.pending_deletes, self.known_paths)
        self.offsets[self.session_path] = self.session_path.stat().st_size

        for tool_use_id, meta in metas.items():
            agent_id = meta["agent_id"]
            agent_file = self.subagents_dir / f"agent-{agent_id}.jsonl"
            if not agent_file.exists():
                continue
            self.agent_meta_by_id[agent_id] = meta
            events.append({"t": 0, "agent": agent_id, "kind": "agent_start", "summary": ""})
            first_ts, _ = er.process_file(agent_file, agent_id, self.session_start_ms,
                                           events, self.pending_agent_calls,
                                           self.agent_meta_by_id, self.pending_tool_calls)
            for obj in er.iter_transcript_lines(agent_file):
                detect_deletions(obj, agent_id, self.session_start_ms, events,
                                  self.pending_deletes, self.known_paths)
            started_ms = (first_ts - self.session_start_ms) if first_ts else 0
            for ev in events:
                if ev["agent"] == agent_id and ev["kind"] == "agent_start" and ev["t"] == 0:
                    ev["t"] = started_ms
                    break
            self.offsets[agent_file] = agent_file.stat().st_size

        # Seed pending_since from the real historical timestamp of each call
        # that process_file() (imported, unmodified -- it has no notion of
        # check_timeouts()) left in pending_tool_calls, so a call that was
        # already minutes old when this stream connected doesn't get another
        # fresh 90s from "now" -- it ages from when it actually started.
        for ev in events:
            if ev["kind"] == "tool" and ev.get("id") in self.pending_tool_calls:
                self.pending_since[ev["id"]] = (self.session_start_ms + ev["t"]) / 1000.0

        events.sort(key=lambda e: e["t"])
        return [{**e, "t": int(e["t"])} for e in events]

    def poll(self):
        """New events since the last burst()/poll() call, across the main
        file and every subagent file (discovering new ones as they appear)."""
        events = []
        new_objs, new_offset = read_new_lines(self.session_path, self.offsets[self.session_path])
        self.offsets[self.session_path] = new_offset
        for obj in new_objs:
            line_to_events(obj, "main", self.session_start_ms, events,
                            self.pending_agent_calls, self.agent_meta_by_id,
                            self.pending_tool_calls, self.pending_since)
            detect_deletions(obj, "main", self.session_start_ms, events,
                              self.pending_deletes, self.known_paths)

        if self.subagents_dir.is_dir():
            metas = er.load_agent_metas(self.subagents_dir)
            for tool_use_id, meta in metas.items():
                agent_id = meta["agent_id"]
                agent_file = self.subagents_dir / f"agent-{agent_id}.jsonl"
                if not agent_file.exists():
                    continue
                if agent_file not in self.offsets:
                    self.agent_meta_by_id.setdefault(agent_id, meta)
                    self.offsets[agent_file] = 0
                    events.append({"t": 0, "agent": agent_id, "kind": "agent_start", "summary": ""})
                new_objs, new_offset = read_new_lines(agent_file, self.offsets[agent_file])
                started_this_round = self.offsets[agent_file] == 0 and new_objs
                self.offsets[agent_file] = new_offset
                for obj in new_objs:
                    line_to_events(obj, agent_id, self.session_start_ms, events,
                                    self.pending_agent_calls, self.agent_meta_by_id,
                                    self.pending_tool_calls, self.pending_since)
                    detect_deletions(obj, agent_id, self.session_start_ms, events,
                                      self.pending_deletes, self.known_paths)
                if started_this_round:
                    # fix the placeholder agent_start's t to the real first timestamp
                    first_ts = None
                    for e in events:
                        if e["agent"] == agent_id and e["kind"] != "agent_start":
                            first_ts = e["t"]
                            break
                    if first_ts is not None:
                        for e in events:
                            if e["agent"] == agent_id and e["kind"] == "agent_start" and e["t"] == 0:
                                e["t"] = first_ts
                                break

        events.sort(key=lambda e: e["t"])
        return [{**e, "t": int(e["t"])} for e in events]

    def flush_pending(self):
        """Any tool_use with no tool_result yet when the stream ends or
        switches to a different session -- mirrors export_replay.py's
        end-of-file synthesis in build_replay() (a call cut off mid-flight
        gets a synthetic tool_end with ok:null so nothing flies forever), the
        one piece of that synthesis burst()/poll() deliberately skip while
        the session is still being tailed. Uses "now" as the timestamp since
        a live stream has no later event to anchor it to."""
        if not self.pending_tool_calls:
            return []
        t_rel = int(time.time() * 1000 - self.session_start_ms) if self.session_start_ms else 0
        events = [{"t": t_rel, "agent": agent_id, "kind": "tool_end", "id": tid, "ok": None}
                  for tid, agent_id in self.pending_tool_calls.items()]
        self.pending_tool_calls.clear()
        self.pending_since.clear()
        return events

    def check_timeouts(self, now=None):
        """Server-side half of docs/HANDOFF.md's live-parity gap 1: any call
        pending longer than PENDING_CALL_TIMEOUT_SECS of real wall time gets
        the same synthetic tool_end (ok: null) flush_pending() gives a call
        still open at stream end -- called every poll tick instead, so a call
        whose result never arrives is caught without waiting for the stream
        to end or switch. Leaves pending_deletes/known_paths alone; a delete
        that never got its tool_result confirmed just stays unconfirmed,
        same as export_replay.py never inventing an ok for a call it can't
        verify."""
        if now is None:
            now = time.time()
        stale = [tid for tid, since in self.pending_since.items()
                 if now - since >= PENDING_CALL_TIMEOUT_SECS]
        if not stale:
            return []
        t_rel = int(now * 1000 - self.session_start_ms) if self.session_start_ms else 0
        events = []
        for tid in stale:
            self.pending_since.pop(tid, None)
            agent_id = self.pending_tool_calls.pop(tid, None)
            if agent_id is None:
                continue
            events.append({"t": t_rel, "agent": agent_id, "kind": "tool_end",
                           "id": tid, "ok": None})
        return events


# ==========================================================================
# Vault watching (Obsidian) — plain mtime/size polling, no dependency.
# ==========================================================================

def scan_vault(vault_dir):
    """{relative_posix_path: (mtime, word_count)} for every .md file, minus
    .obsidian/ and .trash/."""
    snap = {}
    if not vault_dir.is_dir():
        return snap
    for p in vault_dir.rglob("*.md"):
        rel = p.relative_to(vault_dir)
        parts = rel.parts
        if ".obsidian" in parts or ".trash" in parts:
            continue
        try:
            st = p.stat()
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        snap[rel.as_posix()] = (st.st_mtime, len(text.split()))
    return snap


def diff_vault(old, new, t_ms):
    events = []
    for rel, (mtime, words) in new.items():
        if rel not in old:
            events.append({"kind": "note_created", "path": rel, "t": t_ms, "words": words})
        elif mtime != old[rel][0]:
            events.append({"kind": "note_modified", "path": rel, "t": t_ms, "words": words})
    for rel in old:
        if rel not in new:
            events.append({"kind": "note_deleted", "path": rel, "t": t_ms, "words": 0})
    return events


# -- data/vault.json regeneration --------------------------------------------
# world.html and GET /api/vault/note?meta=1 read data/vault.json, which goes
# stale as notes are added -- so it's kept fresh here instead of only by a
# manual `python tools/export_vault.py` run. regenerate_vault_json() is the
# single-flight worker (startup freshness check + the debounced poller
# trigger below both call it); _vault_regen_info is what handle_vault()'s
# per-connection loop diffs against to know a fresh export landed.
_vault_regen_lock = threading.Lock()  # never two concurrent exports
_vault_regen_info = {"version": 0, "notes": 0, "links": 0, "generated": None}
_vault_last_regen_at = 0.0  # time.monotonic() of the last completed export
_vault_debounce_timer = None
_vault_debounce_lock = threading.Lock()


def regenerate_vault_json():
    """Re-run tools/export_vault.py's own main() (imported as `ev`, not
    copied) and swap the result into place atomically (tmp + os.replace) so
    a page mid-load of /api/vault/note?meta=1 never sees a half-written
    file. Skips instead of queuing if an export is already running -- the
    debounce timer below already guarantees at most one pending call."""
    global _vault_last_regen_at
    if not _vault_regen_lock.acquire(blocking=False):
        return
    try:
        start = time.time()
        tmp_path = ev.OUT_PATH.with_suffix(".json.tmp")
        real_path = ev.OUT_PATH
        ev.OUT_PATH = tmp_path
        try:
            ev.main()
        finally:
            ev.OUT_PATH = real_path
        os.replace(tmp_path, real_path)
        data = json.loads(real_path.read_text(encoding="utf-8"))
        _vault_regen_info["notes"] = data["counts"]["notes"]
        _vault_regen_info["links"] = data["counts"]["resolved"]
        _vault_regen_info["generated"] = data["generated"]
        _vault_regen_info["version"] += 1
        _vault_last_regen_at = time.monotonic()
        elapsed = time.time() - start
        log.info(f"[vault] regenerated vault.json notes={_vault_regen_info['notes']} "
                 f"links={_vault_regen_info['links']} in {elapsed:.2f}s")
    except Exception as e:
        log.error(f"[error] vault regen failed: {e}")
    finally:
        _vault_regen_lock.release()


def _vault_regen_after_debounce():
    wait = VAULT_REGEN_MIN_INTERVAL_SECS - (time.monotonic() - _vault_last_regen_at)
    if wait > 0:
        time.sleep(wait)
    regenerate_vault_json()


def schedule_vault_regen():
    """Called from handle_vault()'s poller whenever diff_vault() sees a
    change. Debounces 30s of quiet (resets the timer on every new change),
    then _vault_regen_after_debounce() additionally waits out the 60s
    minimum interval if the last export was too recent."""
    global _vault_debounce_timer
    with _vault_debounce_lock:
        if _vault_debounce_timer is not None:
            _vault_debounce_timer.cancel()
        _vault_debounce_timer = threading.Timer(VAULT_REGEN_DEBOUNCE_SECS, _vault_regen_after_debounce)
        _vault_debounce_timer.daemon = True
        _vault_debounce_timer.start()


def ensure_vault_json_fresh(vault_dir):
    """Startup check (main()): regenerate data/vault.json if it's missing or
    older than the newest .md mtime in the vault. Runs off the main thread
    so the ~0.5s export never delays the server binding its port."""
    try:
        newest_md = 0.0
        for p in vault_dir.rglob("*.md"):
            try:
                newest_md = max(newest_md, p.stat().st_mtime)
            except OSError:
                continue
        stale = (not VAULT_JSON_PATH.exists()) or VAULT_JSON_PATH.stat().st_mtime < newest_md
    except OSError:
        stale = True
    if stale:
        regenerate_vault_json()


# -- vault full-text search (GET /api/vault/search) -------------------------
# Indexed in memory, keyed off the same (mtime, word_count) snapshot
# scan_vault() already produces for the SSE poller above -- "refresh when the
# vault poller sees changes" per the spec, without a second file-watch
# mechanism. A note's content is only re-read when its snapshot entry
# changed, same trigger diff_vault() uses to decide a note was touched.
_vault_search_cache = {"snapshot": None, "notes": {}}
_vault_search_lock = threading.Lock()

_DIGIT_RE = re.compile(r"\d")


def refresh_vault_search_index(vault_dir):
    """(Re)build the in-memory {relpath: {title, folder, lines}} index used by
    vault_search() below, skipping the rebuild entirely when nothing in the
    vault has changed since the last call. Locked end-to-end (not just the
    dict read/write): the rebuild re-reads every changed note's whole file,
    and two /api/vault/search requests landing on a ThreadingHTTPServer at
    once must not both do that walk -- the second one waits and then gets
    the first one's fresh result instead of redoing the same disk I/O."""
    with _vault_search_lock:
        snap = scan_vault(vault_dir)
        if snap == _vault_search_cache["snapshot"]:
            return _vault_search_cache["notes"]
        notes = {}
        for rel in snap:
            try:
                text = (vault_dir / rel).read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            rel_path = PurePosixPath(rel)
            folder = str(rel_path.parent) if str(rel_path.parent) != "." else ""
            notes[rel] = {"title": rel_path.stem, "folder": folder,
                          "lines": text.splitlines()}
        _vault_search_cache["snapshot"] = snap
        _vault_search_cache["notes"] = notes
        return notes


def vault_search(vault_dir, q, limit=20):
    """Case-insensitive substring search over every indexed note's title and
    lines, plus a digit-only pass so a phone number matches regardless of
    how it's punctuated ("+43 660 123 4567" vs "436601234567") -- both sides
    are reduced to their bare digit run before comparing. Title matches are
    ranked first, per the spec."""
    q = (q or "").strip()
    if not q:
        return []
    notes = refresh_vault_search_index(vault_dir)
    q_lower = q.lower()
    digit_query = "".join(_DIGIT_RE.findall(q))
    results = []
    for rel, note in notes.items():
        title_hit = q_lower in note["title"].lower()
        line_no, snippet_src = None, None
        for i, line in enumerate(note["lines"]):
            if q_lower in line.lower():
                line_no, snippet_src = i + 1, line
                break
            if len(digit_query) >= 4 and digit_query in "".join(_DIGIT_RE.findall(line)):
                line_no, snippet_src = i + 1, line
                break
        if not title_hit and snippet_src is None:
            continue
        results.append({"id": rel, "title": note["title"], "folder": note["folder"],
                        "line": line_no, "snippet": er.clip(snippet_src or note["title"], 120),
                        "_title_hit": title_hit})
    results.sort(key=lambda r: not r["_title_hit"])
    for r in results:
        del r["_title_hit"]
    return results[:limit]


# -- one note's raw markdown (GET /api/vault/note) ---------------------------
# Same traversal-guard shape as resolve_project_file_path(): segment check
# before joining `id` onto the vault root, relative_to() after resolve() to
# also catch a symlink pointing outside the vault.

MAX_VAULT_NOTE_BYTES = 512 * 1024
VAULT_JSON_PATH = SCRIPT_DIR / "data" / "vault.json"


def resolve_vault_note_path(note_id, vault_dir):
    """The .md path `id` (relative, no extension, as stored in
    data/vault.json) resolves to, or None if it's outside the vault dir,
    inside .obsidian/.trash, or malformed -- existence is NOT checked here
    so the caller can tell a guard violation (403) apart from a missing
    note (404)."""
    if not vault_dir.is_dir():
        return None
    rel_norm = (note_id or "").replace("\\", "/")
    if (not rel_norm or rel_norm.startswith("/") or re.match(r"^[A-Za-z]:", rel_norm)
            or ".." in rel_norm.split("/")):
        return None
    if ".obsidian" in rel_norm.split("/") or ".trash" in rel_norm.split("/"):
        return None
    try:
        p = (vault_dir / f"{rel_norm}.md").resolve()
        p.relative_to(vault_dir.resolve())
    except (ValueError, OSError):
        return None
    return p


def vault_note_meta(note_id):
    """{id, title, folder, words, modified, inlinks, outlinks, tags} for
    `note_id` out of data/vault.json's notes list, or None when the file or
    the id isn't there -- &meta=1 on /api/vault/note degrades to that
    quietly rather than erroring, since the note itself already served."""
    try:
        data = json.loads(VAULT_JSON_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for note in data.get("notes", []):
        if note.get("id") == note_id:
            return {"id": note["id"], "title": note.get("title"),
                    "folder": note.get("folder"), "words": note.get("words"),
                    "modified": note.get("modified"), "inlinks": note.get("inlinks"),
                    "outlinks": note.get("outlinks", []), "tags": note.get("tags", [])}
    return None


# ==========================================================================
# WORLD — every directory Claude ever worked in, as one settlement map.
#
# One town per distinct `cwd` seen across ~/.claude/projects. The numbers on a
# town (tool calls, files touched, edits) are all-time totals, which means
# reading every transcript byte once: ~5.6 GB across ~2,500 files on this
# machine, about a minute of json.loads. So the scan is backed by a PERSISTENT
# index on disk keyed by (size, mtime) per file — the first run pays that
# minute, every run afterwards is one stat() per file and re-parses only the
# transcripts that actually changed. The 10 s memory cache on top of it is what
# keeps a browser polling /api/world from re-aggregating 750 sessions a second;
# the live half (is_live / live_agents / now) deliberately sits OUTSIDE that
# cache and is recomputed on every request, because "the state of the task at
# that moment" is the whole point of the map.
# ==========================================================================

WORLD_CACHE_SECS = 10
LIVE_WINDOW_SECS = 120           # a town is alive if a transcript moved this recently
WORLD_STREAM_POLL_SECS = 2
INDEX_PATH = SCRIPT_DIR / "data" / ".cache" / "world-index.json"
INDEX_VERSION = 5  # bumped 2026-09-06: demo/tool sub-projects get their own
                   # town instead of collapsing into the parent site (see
                   # resolve_project_dir's demo-container scan)
EDIT_TOOLS = {"Edit", "Write"}
MAX_OPEN_ITEMS = 12
OPEN_ITEM_CHARS = 100

# A HANDOFF heading that introduces work still to do. Matched against the
# heading text, so "## Open / next steps" and "### TODO" both open the section
# and the next heading of any level closes it.
OPEN_HEADING = re.compile(r"^#{1,6}\s+(.*)$")
OPEN_WORDS = re.compile(r"\b(open|next|todo)\b", re.I)
# A row that is already finished — a ticked checkbox, a struck-through line, or
# a table cell that says so. These are the only things filtered out; everything
# else under an "open" heading is taken at face value.
DONE_MARK = re.compile(r"(\[x\]|~~|\bdone\b|✅|✔)", re.I)
WIKILINK = re.compile(r"\[\[([^\]|#]+)")


def norm_cwd(p):
    """Windows gives the same directory back as `C:\\Users\\…` and `c:/users/…`
    depending on which tool wrote it, so towns are keyed on a lowercase
    forward-slash form while the display path keeps its original casing."""
    return p.replace("\\", "/").rstrip("/")


def is_temp_cwd(cwd):
    """Scratchpads and skillspector's throwaway checkouts are not places Beri
    works — they are where a tool put a temporary file. 90 of the 98 project
    directories on this machine are those. They are dropped, not folded into a
    parent, because the parent they belong to is already a town in its own
    right and the scratchpad adds nothing but a duplicate."""
    c = cwd.lower()
    return ("/appdata/local/temp/" in c or c.endswith("/appdata/local/temp")
            or c.endswith("/scratchpad") or "/temp/claude/" in c)


def town_id(cwd):
    return hashlib.sha1(cwd.lower().encode("utf-8")).hexdigest()[:8]


# -- project-directory resolution (2026-09-05) ------------------------------
# Towns used to be keyed on a session's `cwd`, which is wrong for anybody who
# launches Claude Code from one habitual folder: that single cwd swallowed 578
# of 753 sessions on the machine this was measured on, while the real work
# happened elsewhere on disk. A town is now the DOMINANT PROJECT DIRECTORY of a
# session's file-tool paths (Read/Edit/Write/MultiEdit/Glob/Grep --
# er.PATH_TOOLS), not its cwd.

# A path under any of these is scratch space, never a project -- dropped
# before resolution even starts, same set is_temp_cwd() drops at the cwd
# level.
DROPPED_PATH_RE = re.compile(
    r"/appdata/local/temp/|/temp/claude/|/scratchpad(?:/|$)|/\.claude/", re.I)

# Fallback (b): a path two levels under Desktop/projects/ -- e.g.
# "projects/tools/werkstadt" or "projects/work/acme-site" -- is treated as
# its own project even with no marker file, because a
# Desktop/projects/<category>/<name> layout is common enough that the two
# levels are the project, marker file or not.
DESKTOP_PROJECTS_RE = re.compile(r"^(.*/Desktop/projects/[^/]+/[^/]+)(?:/.*)?$", re.I)

# Fallback (a): the deepest ancestor directory that looks like a project
# root by actually containing one of these.
PROJECT_MARKER_NAMES = ("docs", ".git", "package.json", "index.html")

# Demos are their own towns: a path segment named one of these that is
# immediately followed by a directory carrying its own project markers is
# that project's root, checked BEFORE the DESKTOP_PROJECTS_RE fallback below
# -- otherwise "wild-digital-moments-site/demos/musikschule" collapses into
# the parent site town and the flagship "music site must look like a music
# school" demo never gets its own trade-shaped building.
DEMO_CONTAINER_NAMES = {"demos", "demo", "sites", "clients", "apps", "tools", "video"}
DEMO_MARKER_NAMES = ("index.html", "index.php", "docs", "package.json", "BRIEF.md")

# An Obsidian vault has none of the markers above and usually sits outside
# any projects/ tree, so a file-tool path under it would otherwise fall
# through to the cwd fallback. Set once at startup (set_vault_dir, called from
# main()) so a session that merely touched a vault note also makes the vault
# its own town: the vault is a town whenever any session touched a file under
# it. Stays None when no vault is configured, and every check below is
# guarded on that -- the vault layer is optional.
VAULT_DIR_NORM = None
VAULT_DIR_DISPLAY = None


def set_vault_dir(vault_dir):
    """Called once from main(). An empty/None vault_dir leaves both globals
    None, which is what switches the whole vault layer off."""
    global VAULT_DIR_NORM, VAULT_DIR_DISPLAY
    if not vault_dir:
        VAULT_DIR_DISPLAY = VAULT_DIR_NORM = None
        return
    VAULT_DIR_DISPLAY = norm_cwd(str(vault_dir))
    VAULT_DIR_NORM = VAULT_DIR_DISPLAY.lower()

# Git Bash on Windows rewrites a Windows path to `/c/Users/...` inside some
# tool calls -- left unnormalised, "/c/Users/you/projects/x" and
# "C:/Users/you/projects/x" hash to two different towns for the same real
# directory. Normalised back to a drive letter before anything else touches
# the path.
MSYS_DRIVE_RE = re.compile(r"^/([A-Za-z])/")

# Directories that are explicitly NOT projects, from config.json's
# `excluded_dirs`. The case this exists for: the one folder you habitually
# launch Claude Code from. It usually holds a loose `docs/` or `.git` that
# satisfies the marker check below, which would let it swallow every session
# with a loose file at its root -- right back into being the one dominant town
# this whole re-key exists to break up. Only the exact directory is excluded;
# its SUBdirectories still resolve normally.
EXCLUDED_DIRS = {norm_cwd(str(Path(d).expanduser())).lower()
                 for d in CONFIG.get("excluded_dirs", []) if d}

# Display-name overrides, keyed by a project's directory name. Read once here
# so build_world_static()'s new_town() is a dict lookup and not a config parse.
PROJECT_NAMES = {k: v for k, v in (CONFIG.get("project_names") or {}).items()}

_marker_cache = {}
_marker_cache_lock = threading.Lock()


def _has_project_marker(dir_str, names=PROJECT_MARKER_NAMES):
    """Filesystem check, cached per (directory string, marker set) -- a
    session can repeat the same handful of directories thousands of times
    across its tool calls, and this is the only disk I/O
    resolve_project_dir() does. `names` defaults to the ancestor-walk
    fallback's own marker set; the demo-container scan passes its own.
    Locked (ThreadingHTTPServer: many requests hit this concurrently) so two
    threads never race a check-then-set on the same key -- the stat() itself
    runs outside the lock, only the cache read/write is serialized."""
    key = (dir_str, names)
    with _marker_cache_lock:
        hit = _marker_cache.get(key)
        if hit is not None:
            return hit
    found = False
    try:
        d = Path(dir_str)
        found = any((d / name).exists() for name in names)
    except OSError:
        found = False
    with _marker_cache_lock:
        _marker_cache[key] = found
    return found


def resolve_project_dir(path):
    """The project directory a file-tool path belongs to, or None if the
    path is scratch space or resolves to nothing project-shaped.

    Performance, not just the spec's letter, decides the order here. The
    brief lists marker-check (a) before the Desktop/projects/<category>
    regex (b), and on paths that would match both they agree anyway --
    every real example (`projects/tools/some-tool`,
    `projects/web/some-site`) has its docs/.git sitting
    exactly at the category/name directory the regex already names. So (b)
    runs FIRST here, as a pure string match with zero filesystem I/O, and
    only a path that misses it falls through to the disk-touching marker
    walk. Measured need for this: the naive a-then-b order (walking every
    unique directory on disk, per session, before ever trying the regex)
    turned the one-time cold index build from ~47 s into 9 minutes on this
    machine's ~2,500 transcripts -- Defender-guarded stat() calls are not
    free at that volume, and almost every real path here lives under
    Desktop/projects/ where the regex alone already gives the right answer."""
    p = path.replace("\\", "/")
    dm = MSYS_DRIVE_RE.match(p)
    if dm:
        p = dm.group(1).upper() + ":" + p[2:]
    if DROPPED_PATH_RE.search(p):
        return None
    low_p = p.lower()
    if VAULT_DIR_NORM and low_p.startswith(VAULT_DIR_NORM + "/"):
        return VAULT_DIR_DISPLAY
    # Demos are their own towns (see DEMO_CONTAINER_NAMES above) -- checked
    # before the Desktop/projects/<cat>/<name> regex so a demo/tool
    # sub-project wins over its parent site. Cheap string split first;
    # only a segment that actually matches pays for the marker-file check,
    # and that check is cached per directory in _has_project_marker.
    segments = p.split("/")
    for i in range(len(segments) - 1):
        if segments[i].lower() in DEMO_CONTAINER_NAMES:
            candidate = "/".join(segments[: i + 2])
            if _has_project_marker(candidate, DEMO_MARKER_NAMES):
                return candidate
    m = DESKTOP_PROJECTS_RE.match(p)
    if m:
        return m.group(1)
    # Rare path outside Desktop/projects/ -- only these pay for a filesystem
    # walk, capped at 6 ancestor levels and never climbing above Desktop
    # itself (going higher risks matching an unrelated marker in your home
    # directory, which is not a project).
    node = str(PurePosixPath(p).parent)
    guard = 0
    while node and guard < 6:
        guard += 1
        low = node.lower()
        if low.endswith("/desktop") or len(node) <= 3:
            break
        if low not in EXCLUDED_DIRS and _has_project_marker(node):
            return node
        parent = str(PurePosixPath(node).parent)
        if parent == node:
            break
        node = parent
    return None


# -- the persistent transcript index ---------------------------------------

def scan_transcript(path):
    """Full parse of one transcript file (main session or subagent) into the
    handful of all-time facts a town is built from. Deliberately NOT
    er.iter_transcript_lines(): that helper skips `attachment` lines, and on
    this data the `cwd` field lives on attachment lines far more often than on
    message lines — skipping them loses the town."""
    cwd = ""
    first_ts = last_ts = None
    tool_calls = edits = 0
    paths = set()
    # Per-project counts, from the same file-tool paths (see resolve_project_dir
    # above) -- this is what lets build_world_static() key a town on the
    # project a session actually worked in instead of its cwd. project_calls
    # counts FILE-TOOL calls only (not every tool_use), because that is the
    # only signal a path exists to attribute to a project; the session's full
    # tool_calls total is split proportionally from these counts later.
    project_calls = {}
    project_edits = {}
    project_paths = {}
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not cwd and obj.get("cwd"):
                cwd = norm_cwd(obj["cwd"])
            ts = obj.get("timestamp")
            if ts:
                # ISO-8601 UTC with a trailing Z sorts correctly as a string.
                if first_ts is None or ts < first_ts:
                    first_ts = ts
                if last_ts is None or ts > last_ts:
                    last_ts = ts
            msg = obj.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use":
                    continue
                name = block.get("name", "")
                tool_calls += 1
                if name in EDIT_TOOLS:
                    edits += 1
                p = er.tool_path(name, block.get("input") or {})
                if p:
                    paths.add(p)
                    proj = resolve_project_dir(p)
                    if proj:
                        project_calls[proj] = project_calls.get(proj, 0) + 1
                        project_paths.setdefault(proj, set()).add(p)
                        if name in EDIT_TOOLS:
                            project_edits[proj] = project_edits.get(proj, 0) + 1
    st = path.stat()
    return {"size": st.st_size, "mtime": st.st_mtime, "cwd": cwd,
            "first": first_ts, "last": last_ts, "tools": tool_calls,
            "edits": edits, "paths": sorted(paths),
            "project_calls": project_calls, "project_edits": project_edits,
            "project_paths": {k: sorted(v) for k, v in project_paths.items()}}


_index = None
_index_lock = threading.RLock()


def _load_index():
    global _index
    if _index is None:
        try:
            data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            _index = data.get("files", {}) if data.get("version") == INDEX_VERSION else {}
        except (OSError, json.JSONDecodeError):
            _index = {}
    return _index


def _save_index():
    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": INDEX_VERSION, "files": _index}),
                   encoding="utf-8")
    tmp.replace(INDEX_PATH)


def refresh_index():
    """Bring the on-disk index up to date. Returns (index, files_rescanned).

    Locked end-to-end: `_index` is one shared module-level dict and
    `_save_index()` writes it through a SINGLE fixed tmp-file name
    (world-index.tmp). Before this lock, two threads rescanning at once
    (build_world_static()'s own refresh_index() call already ran under
    world_static()'s _index_lock, but list_recent_sessions() called this
    function directly, unlocked) could both reach `_save_index()` at once
    and race the same tmp file's rename -- reproduced live: a real
    /api/sessions request 500'd with `WinError 32: The process cannot
    access the file because it is being used by another process` on
    world-index.tmp, from exactly this race. `_index_lock` is an RLock, so
    world_static()'s own already-locked call path nests into this one
    instead of deadlocking."""
    with _index_lock:
        idx = _load_index()
        seen = set()
        rescanned = 0
        everything = list(PROJECTS_DIR.glob("*/*.jsonl")) + \
                     list(PROJECTS_DIR.glob("*/*/subagents/*.jsonl"))
        for p in everything:
            key = p.as_posix()
            seen.add(key)
            try:
                st = p.stat()
            except OSError:
                continue
            rec = idx.get(key)
            if rec and rec["size"] == st.st_size and abs(rec["mtime"] - st.st_mtime) < 0.002:
                continue
            try:
                idx[key] = scan_transcript(p)
            except OSError:
                continue
            rescanned += 1
        for gone in [k for k in idx if k not in seen]:
            del idx[gone]
        if rescanned:
            _save_index()
        return idx, rescanned


def session_records(idx):
    """One record per main session, with its subagent transcripts folded in —
    a subagent carries no cwd of its own, so its tool calls belong to the town
    of the session that spawned it."""
    out = []
    for main in PROJECTS_DIR.glob("*/*.jsonl"):
        rec = idx.get(main.as_posix())
        if not rec:
            continue
        cwd, first, last = rec["cwd"], rec["first"], rec["last"]
        tools, edits = rec["tools"], rec["edits"]
        paths = set(rec["paths"])
        project_calls = dict(rec.get("project_calls", {}))
        project_edits = dict(rec.get("project_edits", {}))
        project_paths = {k: set(v) for k, v in rec.get("project_paths", {}).items()}
        subagents_dir = main.parent / main.stem / "subagents"
        for sub in subagents_dir.glob("*.jsonl"):
            s = idx.get(sub.as_posix())
            if not s:
                continue
            tools += s["tools"]
            edits += s["edits"]
            paths.update(s["paths"])
            for proj, cnt in s.get("project_calls", {}).items():
                project_calls[proj] = project_calls.get(proj, 0) + cnt
            for proj, cnt in s.get("project_edits", {}).items():
                project_edits[proj] = project_edits.get(proj, 0) + cnt
            for proj, ps in s.get("project_paths", {}).items():
                project_paths.setdefault(proj, set()).update(ps)
            if s["first"] and (not first or s["first"] < first):
                first = s["first"]
            if s["last"] and (not last or s["last"] > last):
                last = s["last"]
            if not cwd and s["cwd"]:
                cwd = s["cwd"]
        out.append({"session": main.stem, "main": main, "cwd": cwd,
                    "first": first, "last": last, "tools": tools,
                    "edits": edits, "paths": paths,
                    "project_calls": project_calls, "project_edits": project_edits,
                    "project_paths": project_paths})
    return out


# -- open items: docs/HANDOFF.md, and the vault's kanban boards -------------

def handoff_open_items(town_path):
    """List items and table rows under a heading that says open / next / todo,
    from that project's own docs/HANDOFF.md. Read-only, and only that file."""
    f = Path(town_path) / "docs" / "HANDOFF.md"
    if not f.is_file():
        return []
    try:
        lines = f.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    items, inside = [], False
    for raw in lines:
        head = OPEN_HEADING.match(raw.strip())
        if head:
            inside = bool(OPEN_WORDS.search(head.group(1)))
            continue
        if not inside:
            continue
        line = raw.strip()
        if not line:
            continue
        text = ""
        if line[0] in "-*+":
            text = line[1:].strip()
        elif line.startswith("|") and line.count("|") >= 3:
            cells = [c.strip() for c in line.strip("|").split("|")]
            if all(set(c) <= set("-: ") for c in cells):
                continue           # the |---|---| separator row
            # First cell is a row number in these tables; the second is the item.
            text = cells[1] if len(cells) > 1 and len(cells[0]) <= 3 else cells[0]
        if not text or DONE_MARK.search(text):
            continue
        text = " ".join(re.sub(r"[`*_\[\]]", "", text).split())
        if not text or text.lower() in ("what", "#"):
            continue
        items.append(er.clip(text, OPEN_ITEM_CHARS))
        if len(items) >= MAX_OPEN_ITEMS:
            break
    return items


def title_key(name):
    """`my-project`, `My Project` and `my_project` are the same place."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def board_open_items(vault_dir, key_to_town):
    """Cards in the vault's kanban boards that wikilink to a note whose title
    matches a town's name. Returns (items_by_town_id, matched_card_count)."""
    out, matched = {}, 0
    boards = vault_dir / "Boards"
    if not boards.is_dir():
        return out, 0
    for board in boards.glob("*.md"):
        try:
            lines = board.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        column_open = False
        for raw in lines:
            line = raw.strip()
            head = OPEN_HEADING.match(line)
            if head:
                column_open = "done" not in head.group(1).lower()
                continue
            if not column_open or not line or line[0] not in "-*+":
                continue
            text = line[1:].strip()
            if DONE_MARK.search(text):
                continue
            targets = {title_key(m) for m in WIKILINK.findall(raw)}
            for key in targets:
                tid = key_to_town.get(key)
                if not tid:
                    continue
                matched += 1
                clean = " ".join(re.sub(r"[`*_\[\]#>]|@\{[^}]*\}|🟡|🔴|🟢", " ", text).split())
                out.setdefault(tid, []).append(er.clip(clean, OPEN_ITEM_CHARS))
                break
    return out, matched


# -- the live half: recomputed on every request ----------------------------

_live_cache = {}
_live_cache_lock = threading.Lock()


def _new_live_state():
    # `task` is the tag line -- see task_line(); `prompt` stays the caption.
    return {"last_ts": None, "prompt": "", "task": "", "text": "", "tool": "", "path": "",
            "calls": {}, "results": set(), "tool_calls": {}, "projects": set(),
            "offset": 0}


def _copy_live_state(state):
    """A shallow-per-field copy so two threads racing a stale cache entry
    (see scan_live_file's own comment) each tail and mutate their own
    accumulator instead of the one sitting in the cache."""
    return {"last_ts": state["last_ts"], "prompt": state["prompt"],
            "task": state["task"], "text": state["text"], "tool": state["tool"], "path": state["path"],
            "calls": dict(state["calls"]), "results": set(state["results"]),
            "tool_calls": dict(state["tool_calls"]), "projects": set(state["projects"]),
            "offset": state["offset"]}


def _apply_live_line(obj, state):
    """One transcript line's effect on a live-state accumulator -- the exact
    per-line body scan_live_file() used to run over the WHOLE file on every
    poll. Split out so scan_live_file can run it over only the lines
    appended since the last poll instead."""
    ts = obj.get("timestamp")
    if ts and (state["last_ts"] is None or ts > state["last_ts"]):
        state["last_ts"] = ts
    msg = obj["message"]
    role = msg.get("role")
    content = msg.get("content")
    if role == "user":
        if isinstance(content, str):
            if not is_envelope(content):
                state["prompt"] = er.clip(content, 120)
                state["task"] = task_line(content) or state["task"]
        elif isinstance(content, list):
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "text":
                    if not is_envelope(b.get("text", "")):
                        state["prompt"] = er.clip(b.get("text", ""), 120)
                        state["task"] = task_line(b.get("text", "")) or state["task"]
                elif b.get("type") == "tool_result" and b.get("tool_use_id"):
                    state["results"].add(b["tool_use_id"])
    elif role == "assistant" and isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "text":
                state["text"] = er.clip(b.get("text", ""), 160)
            elif b.get("type") == "tool_use":
                name = b.get("name", "")
                inp = b.get("input") or {}
                if name == "Agent":
                    # Same rule as the subagent's own tag below: description
                    # first, then the first PROSE line of the prompt.
                    label = (inp.get("description")
                             or task_line(inp.get("prompt", ""))
                             or er.clip(inp.get("prompt", ""), 40))
                    state["calls"][b.get("id")] = {"label": er.clip(label, 60),
                                                   "started": ts}
                else:
                    state["tool"] = name
                    p = er.tool_path(name, inp)
                    if p:
                        state["path"] = p
                        # Which town(s) this file's own tool calls belong
                        # to -- used by session_live_state() so an agent
                        # attaches to the project it actually touched,
                        # not just the session's launch cwd.
                        proj = resolve_project_dir(p)
                        if proj:
                            state["projects"].add(proj)
                    tool_id = b.get("id")
                    if tool_id:
                        state["tool_calls"][tool_id] = {
                            "tool": name, "path": p or "",
                            "since_ms": int(er.to_ms(ts)) if ts else None}


def scan_live_file(path):
    """What one transcript file says about right now: the Agent calls it made,
    the tool_results that closed them, and its last prompt / text / tool.
    Cached on (size, mtime) so several towns polling at once parse it once.
    Incremental: the accumulator persists across polls and only the bytes
    appended since the last poll are parsed (via read_new_lines(), the same
    tailing primitive /api/stream uses), instead of re-reading the whole
    transcript from byte 0 on every 2s world-payload tick -- on a session
    with a multi-MB transcript that was most of _build_world_payload()'s
    2.5-3.8s cost. A shrunk file (compaction/rotation) is handled by
    read_new_lines() itself, same as the plain session tail.
    Locked reads/writes only -- ThreadingHTTPServer means several SSE
    connections and /api/world requests can call this on the same file at
    the same moment; the (possibly expensive) tail below still runs outside
    the lock, so two threads racing a stale entry just tail twice, they
    never corrupt the dict (see _copy_live_state)."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = path.as_posix()
    with _live_cache_lock:
        hit = _live_cache.get(key)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime:
        return hit[2]

    state = _copy_live_state(hit[3]) if hit else _new_live_state()
    new_objs, new_offset = read_new_lines(path, state["offset"])
    for obj in new_objs:
        _apply_live_line(obj, state)
    state["offset"] = new_offset

    res = {k: state[k] for k in
           ("last_ts", "prompt", "text", "tool", "path", "calls", "results",
            "tool_calls", "projects")}
    # In-flight = a tool_use in THIS file with no tool_result yet in it --
    # the worker-drone signal for the map (see the "inflight" note on
    # session_live_state()). Sorted oldest-first so the map can show the
    # call that has been running longest first.
    res["inflight"] = sorted(
        ({"id": tid, **v} for tid, v in res["tool_calls"].items() if tid not in res["results"]),
        key=lambda c: c["since_ms"] or 0)
    with _live_cache_lock:
        _live_cache[key] = (st.st_size, st.st_mtime, res, state)
    return res


_live_sessions_dir_cache = {"at": 0, "files": []}
_live_sessions_dir_lock = threading.Lock()
LIVE_SESSIONS_DIR_CACHE_SECS = 5  # a brand-new session dir is rare enough that a
# few seconds of staleness here costs nothing -- the per-file mtime checks below,
# which decide who's actually live, still run fresh on every call.


def live_sessions(now_ts):
    """Main session files (or any of their subagent files) touched inside the
    live window, newest first. The `PROJECTS_DIR.glob("*/*.jsonl")` directory
    listing itself (hundreds of files on this machine, unrelated to whether
    any of them is live) is cached for LIVE_SESSIONS_DIR_CACHE_SECS -- every
    file's own mtime (and its subagents') is still stat()'d fresh below, so
    which sessions count as live is unaffected, only the directory walk that
    finds the candidates is."""
    with _live_sessions_dir_lock:
        c = _live_sessions_dir_cache
        if now_ts - c["at"] >= LIVE_SESSIONS_DIR_CACHE_SECS:
            c["files"] = list(PROJECTS_DIR.glob("*/*.jsonl"))
            c["at"] = now_ts
        files = c["files"]
    out = []
    for main in files:
        try:
            m = main.stat().st_mtime
        except OSError:
            continue
        subs = sorted((main.parent / main.stem / "subagents").glob("agent-*.jsonl"))
        for s in subs:
            try:
                m = max(m, s.stat().st_mtime)
            except OSError:
                pass
        if now_ts - m <= LIVE_WINDOW_SECS:
            out.append((m, main, subs))
    out.sort(key=lambda r: -r[0])
    return out


# A line that is never the task. Measured off a real drone tag that read
# "Base directory for this skill: C:\\Users\\" -- the first line of a skill
# body, not the job. Paths, skill/system preambles, markdown headings and
# horizontal rules are all plumbing that happens to come first.
_NOT_TASK_RE = re.compile(r"^(base directory\b|[a-z]:[\\/]|/|<|#|\||-{3,}|={3,})",
                          re.IGNORECASE)


def task_line(text):
    """The first line of a prompt that reads as WHAT THE AGENT IS DOING.

    Still the agent's own prompt -- nothing invented, nothing summarised --
    only the right LINE of it. 48 characters is what a craft tag carries
    without becoming a paragraph in the sky (city.js clips at 42, drones at
    48), so the tag is trimmed here rather than mid-word on the page."""
    for raw in (text or "").splitlines():
        line = raw.strip().strip("*_`> ")
        if len(line) < 8 or _NOT_TASK_RE.match(line):
            continue
        if "system-reminder" in line.lower():
            continue
        return er.clip(line, 48)
    return ""


# Any XML/HTML-shaped envelope tag, not just `<ta...>` -- a street sign for a
# `<scheduled-task name="daily-hey-reminder" file=...>` session read that raw
# tag verbatim, because the old is_envelope() only caught `<ta`.
_ENVELOPE_TAG_RE = re.compile(r"^<[a-z][\w-]*[\s>]", re.IGNORECASE)


def is_envelope(text):
    """A task-dispatch envelope is plumbing that happens to be shaped like a
    user prompt (`<task…>`, `<scheduled-task …>`, `<task-id>`). replay.js drops
    the same thing from the ticker; the caption on a town must not read as
    machine noise either."""
    t = text.lstrip()
    return bool(_ENVELOPE_TAG_RE.match(t)) or "task-id" in t[:200]


def session_live_state(main, subs, now_ts):
    """The agents still in flight in one live session, plus what it is doing.

    The toolUseId join (the one export_replay.py uses to pair a subagent
    transcript with the Agent tool_use that spawned it) gives an agent its
    identity and its description — but it CANNOT say whether the agent is
    still working. A backgrounded agent gets its tool_result back in two
    seconds ("Async agent launched successfully"), so on this machine, where
    almost every dispatch is backgrounded, "no matching tool_result" answers
    zero agents in flight while twelve are running. Measured on session
    129a1668: 12 Agent calls, 12 closed, 0 pending, at a moment with 4 live
    agents. So the in-flight test is the agent's OWN transcript: a subagent
    that is working appends to agent-<id>.jsonl on every tool call, and one
    that has returned stops. Same window as a live town."""
    files = [main] + list(subs)
    scans = {p: scan_live_file(p) for p in files}
    scans = {p: s for p, s in scans.items() if s}
    if main not in scans:
        return None
    calls = {}
    for s in scans.values():
        calls.update(s["calls"])

    metas = er.load_agent_metas(main.parent / main.stem / "subagents")
    by_agent_id = {m["agent_id"]: (tu, m) for tu, m in metas.items()}

    m = scans[main]
    agents = [{"id": f"main:{main.stem[:8]}",
               "label": m["prompt"][:40] or "orchestrator",
               "started": None, "last_tool": m["tool"], "last_path": m["path"],
               "inflight": m.get("inflight", []), "projects": m.get("projects", set())}]
    for af in subs:
        try:
            if now_ts - af.stat().st_mtime > LIVE_WINDOW_SECS:
                continue
        except OSError:
            continue
        agent_id = af.stem.replace("agent-", "")
        tool_use_id, meta = by_agent_id.get(agent_id, (None, {}))
        call = calls.get(tool_use_id, {})
        a = scans.get(af)
        # Label priority per Beri's spec: the description from the agent's
        # own agent-<id>.meta.json (the "tag" on the drone) when present,
        # else the first PROSE line of the agent's own first prompt (from its
        # own transcript, not the parent's Agent-call description/prompt
        # snippet -- `call` is only the fallback of last resort, for the
        # gap between a subagent file appearing and its meta.json landing).
        # `task` before `prompt`: the raw first 60 characters is where the tag
        # "Base directory for this skill: C:\\Users\\" came from -- the skill
        # preamble a dispatched agent's prompt opens with. See task_line().
        label = (meta.get("description") or a["task"] or er.clip(a["prompt"], 60)
                 if a else "") or call.get("label") or agent_id
        agents.append({"id": agent_id, "label": er.clip(label, 60),
                       "started": call.get("started"),
                       "last_tool": a["tool"] if a else "",
                       "last_path": a["path"] if a else "",
                       "inflight": a["inflight"] if a else [],
                       "projects": a["projects"] if a else set()})

    last_ms = er.to_ms(m["last_ts"]) if m["last_ts"] else None
    now = {"prompt": m["prompt"], "last_text": m["text"], "last_tool": m["tool"],
           "last_path": m["path"],
           "elapsed_ms": int(time.time() * 1000 - last_ms) if last_ms else None}
    return {"session": main.stem, "agents": agents, "now": now,
            "last_ts": m["last_ts"]}


def tool_pulses(obj, tid, pending, pending_deletes, known_paths):
    """Every tool_use ('pulse') or matching tool_result ('pulse_end') in one
    freshly-appended transcript line, for that town. Same shape of read as
    line_to_events() above, minus the replay timeline — the world map has no
    clock of its own, only "just now". `pending` (tool_use_id -> (town id,
    wall time.time() pulsed)) is owned by the caller, one dict per
    /api/world/stream connection, the same way SessionTail.pending_tool_calls
    is owned per session -- it is what lets a later tool_result in a
    DIFFERENT town's file still find the town its own tool_use pulsed from,
    and what pulse_timeouts() below ages against.

    `pending_deletes`/`known_paths` are detect_deletions()'s own two dicts,
    one pair per connection, for the world map's half of live-parity gap 2:
    a confirmed delete also fires a plain {"kind":"pulse","tool":"delete"} —
    momentary, no matching pulse_end, since a delete has no "in flight"
    state to end."""
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return
    role = msg.get("role")
    content = msg.get("content")
    if not isinstance(content, list):
        return
    if role == "assistant":
        for b in content:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            name = b.get("name", "")
            tool_id = b.get("id")
            input_obj = b.get("input") or {}
            if tool_id:
                pending[tool_id] = (tid, time.time())
            yield {"kind": "pulse", "town": tid, "tool": name, "id": tool_id,
                   "path": er.tool_path(name, input_obj) or ""}
            if name in ("Bash", "PowerShell") and tool_id:
                target = _first_delete_target(input_obj.get("command", ""))
                resolved = _resolve_delete_path(target, obj.get("cwd")) if target else None
                if resolved:
                    pending_deletes[tool_id] = (tid, resolved)
            elif name in er.PATH_TOOLS:
                p = er.tool_path(name, input_obj)
                if p:
                    last = known_paths.get(p)
                    now = time.time()
                    if last is None:
                        known_paths[p] = now
                    elif now - last >= DELETE_RECHECK_SECS:
                        known_paths[p] = now
                        if not Path(p).exists():
                            yield {"kind": "pulse", "town": tid, "tool": "delete", "path": p}
                            del known_paths[p]
    elif role == "user":
        for b in content:
            if not isinstance(b, dict) or b.get("type") != "tool_result":
                continue
            tu_id = b.get("tool_use_id")
            if tu_id in pending:
                pulse_tid, _since = pending.pop(tu_id)
                yield {"kind": "pulse_end", "town": pulse_tid, "id": tu_id,
                       "ok": not b.get("is_error", False)}
            deleted = pending_deletes.pop(tu_id, None)
            if deleted and not b.get("is_error", False):
                del_tid, path = deleted
                yield {"kind": "pulse", "town": del_tid, "tool": "delete", "path": path}


def pulse_timeouts(pending, now=None):
    """World-map half of docs/HANDOFF.md's live-parity gap 1: a synthetic
    pulse_end (ok: null) for any pulse whose tool_result never arrived within
    PENDING_CALL_TIMEOUT_SECS of real wall time -- same rule and constant as
    SessionTail.check_timeouts(), for `pending`'s (town id, since) pairs
    instead of SessionTail's (agent_id, since)."""
    if now is None:
        now = time.time()
    stale = [tid for tid, (_town, since) in pending.items()
             if now - since >= PENDING_CALL_TIMEOUT_SECS]
    events = []
    for tid in stale:
        town, _since = pending.pop(tid)
        events.append({"kind": "pulse_end", "town": town, "id": tid, "ok": None})
    return events


# -- assembly ---------------------------------------------------------------

_world_cache = {"at": 0, "data": None}
# Single-flight gate for the background rebuild below. A plain Lock used
# non-blockingly, not a flag: `if not flag: flag = True` is two statements and
# two threads can pass it at once, and a second concurrent build_world_static()
# is exactly the 3.5s of CPU this is trying to keep off the machine.
_world_refresh_lock = threading.Lock()


def build_world_static(vault_dir):
    """The half that only changes when a transcript or a HANDOFF changes."""
    idx, rescanned = refresh_index()
    sessions = session_records(idx)

    def new_town(tid, path, kind):
        # A town is named after its own directory unless config.json's
        # `project_names` says otherwise -- a folder called `acme-web-v2-final`
        # should be able to read "Acme" on the map without being renamed on disk.
        folder = path.rsplit("/", 1)[-1]
        return {"id": tid, "path": path,
                "name": PROJECT_NAMES.get(folder, folder), "kind": kind,
                "sessions": 0, "first_seen": None, "last_active": None,
                "tool_calls": 0, "edits": 0, "_paths": set(), "_ids": []}

    def touch_town(t, s, calls, edits, paths):
        """Fold one session's contribution into town `t`. `calls` is the
        exact count of file-tool EVENTS (Read/Edit/Write/MultiEdit/Glob/Grep)
        attributed to this town -- never a proportional share of the
        session's other tool calls (Bash, Agent, ...), which have no path to
        attribute anywhere. edits/paths are likewise exact, since both only
        ever come from calls that already carry a path. sessions +1 per-town,
        so a session touching N towns counts once in each -- the shared
        session is also what makes it a roads[] edge below."""
        t["sessions"] += 1
        t["tool_calls"] += calls
        t["edits"] += edits
        t["_paths"].update(paths)
        t["_ids"].append(s["session"])
        if s["first"] and (not t["first_seen"] or s["first"] < t["first_seen"]):
            t["first_seen"] = s["first"]
        if s["last"] and (not t["last_active"] or s["last"] > t["last_active"]):
            t["last_active"] = s["last"]

    towns, dropped = {}, 0
    vault_cwd = norm_cwd(str(vault_dir)).lower()
    for s in sessions:
        proj_calls = s.get("project_calls") or {}
        if proj_calls:
            # The re-key (2026-09-05): a session that touched several
            # projects is a citizen of every one of them, each counted by its
            # OWN exact file-tool event count -- not a resident of whichever
            # cwd it happened to be launched from.
            for proj, cnt in proj_calls.items():
                tid = town_id(proj)
                kind = "vault" if VAULT_DIR_NORM and proj.lower() == VAULT_DIR_NORM else "project"
                t = towns.setdefault(tid, new_town(tid, proj, kind))
                touch_town(t, s, cnt,
                           s.get("project_edits", {}).get(proj, 0),
                           s.get("project_paths", {}).get(proj, set()))
            continue
        # Fallback: no file-tool path resolved to a project (a pure-chat
        # session with no file tools at all, or one whose only paths were
        # scratch/temp space) -- keep the old cwd-keyed behaviour so that
        # town still exists somewhere, per the brief's "sessions with NO
        # file-tool paths fall back to their cwd town".
        cwd = s["cwd"]
        if not cwd:
            continue
        if is_temp_cwd(cwd):
            dropped += 1
            continue
        tid = town_id(cwd)
        kind = "vault" if cwd.lower() == vault_cwd else "project"
        t = towns.setdefault(tid, new_town(tid, cwd, kind))
        touch_town(t, s, s["tools"], s["edits"], s["paths"])

    # Roads: a session whose file-tool paths fall inside two towns' directories
    # is a road between them. Longest-prefix match, walking a path upwards.
    dirs = {t["path"].lower(): t["id"] for t in towns.values()}
    pair_weight = {}
    for s in sessions:
        if not s["paths"]:
            continue
        hit = set()
        for p in s["paths"]:
            q = p.lower()
            while True:
                cut = q.rfind("/")
                if cut < 3:
                    break
                q = q[:cut]
                if q in dirs:
                    hit.add(dirs[q])
                    break
        if len(hit) > 1:
            for a in hit:
                for b in hit:
                    if a < b:
                        pair_weight[(a, b)] = pair_weight.get((a, b), 0) + 1
    roads = [{"a": a, "b": b, "weight": w} for (a, b), w in pair_weight.items()]
    roads.sort(key=lambda r: -r["weight"])

    key_to_town = {title_key(t["name"]): t["id"] for t in towns.values()}
    board_items, board_matched = board_open_items(vault_dir, key_to_town)

    for t in towns.values():
        t["files_touched"] = len(t["_paths"])
        items = handoff_open_items(t["path"]) + board_items.get(t["id"], [])
        t["open_items"] = items[:MAX_OPEN_ITEMS]
        del t["_paths"]

    return {"towns": towns, "roads": roads,
            "meta": {"rescanned": rescanned, "dropped_temp_sessions": dropped,
                     "board_cards_matched": board_matched,
                     "sessions_indexed": len(sessions)}}


def _refresh_world_static(vault_dir):
    """Rebuild the static half OFF the request path, then swap it in."""
    try:
        t0 = time.perf_counter()
        data = build_world_static(vault_dir)
        with _index_lock:
            _world_cache["data"] = data
            _world_cache["at"] = time.time()
        log.debug("world_static refreshed in %.1fms", (time.perf_counter() - t0) * 1000)
    except Exception:
        log.exception("world_static refresh failed")
    finally:
        _world_refresh_lock.release()


def world_static(vault_dir):
    """Stale-while-revalidate, because build_world_static() measured 3.1-6.6s
    on this machine while WORLD_CACHE_SECS is 10 -- so under the old
    rebuild-in-the-request rule, ANY open of the globe more than ten seconds
    after the last one paid a 3.5s stall before the planet could be drawn.
    That was the single biggest item in the startup measurement (docs/TESTS.md
    "Startup speed"). Serving the previous snapshot and rebuilding behind it
    costs nothing extra: the rebuild is still triggered by requests at the same
    rate, it just no longer happens between the request and the response.

    Staleness is bounded by one rebuild (a few seconds) and is invisible to the
    pages: globe.js re-polls /api/world every 60s and holds /api/world/stream,
    whose own 2s tick is what actually moves a town on screen. A snapshot is a
    snapshot -- one taken 3s ago is not less true than one whose build STARTED
    3s ago, which is what the caller used to wait for."""
    with _index_lock:
        cached, at = _world_cache["data"], _world_cache["at"]
    if cached is not None:
        if time.time() - at > WORLD_CACHE_SECS and _world_refresh_lock.acquire(blocking=False):
            # Released by _refresh_world_static()'s finally, so a failed
            # rebuild cannot wedge the cache stale forever.
            threading.Thread(target=_refresh_world_static, args=(vault_dir,),
                             daemon=True).start()
        return cached
    # Nothing cached at all. Only the very first caller after a restart lands
    # here, and main() prewarms it in a startup thread so that caller is the
    # server itself rather than Beri opening the page.
    with _index_lock:
        if _world_cache["data"] is None:
            _world_cache["data"] = build_world_static(vault_dir)
            _world_cache["at"] = time.time()
        return _world_cache["data"]


_live_payload_cache = {"at": 0, "data": None}
_live_payload_lock = threading.Lock()
# Single-flight gate for the background rebuild, same shape and same reason as
# _world_refresh_lock above. Separate from _live_payload_lock, which is only
# ever held for the microseconds it takes to read or swap the cached dict --
# holding THAT one across the 3.5s build is what used to make every caller wait.
_live_payload_refresh_lock = threading.Lock()
LIVE_CACHE_SECS = 1.5


def world_payload(vault_dir):
    """The /api/world body, shared by every caller inside a 1.5 s window.

    The live half re-reads whichever transcripts moved in the last two minutes,
    and on a busy machine that is a 5 MB main file plus a couple of multi-MB
    subagent files — a few hundred milliseconds. Without this the page's own
    poll and every open /api/world/stream connection each pay it separately,
    two seconds apart, and the server saturates with three tabs open. 1.5 s is
    under the stream's 2 s tick, so nothing is ever served stale by a full
    tick, and the towns still change the moment the transcript does.

    Its own dedicated lock, not `_index_lock` -- `_build_world_payload()`
    walks every live session across every town and measured 2.5-3.8s on this
    machine, well over its own 1.5s TTL, so an open /api/world/stream (which
    calls this every ~2s) was rebuilding on nearly every tick and holding
    `_index_lock` that whole time. Since `/api/sessions` and
    `/api/project/meta` both need `_index_lock` too (via refresh_index() and
    world_static()) but never touch the live payload, they were queuing
    behind a rebuild they had nothing to do with -- reproduced live: a single
    open world stream made /api/sessions take 15s+. Separating the locks
    means this cache's own (real, and not fixed by this pass) slowness only
    ever blocks its own callers.

    Stale-while-revalidate for the same reason world_static() above is (task B,
    startup speed): the docstring's own admission -- "measured 2.5-3.8s, well
    over its own 1.5s TTL" -- means the cache was expired at essentially every
    request, so /api/world cost 3.5s every time the page asked for it, and
    globe.js awaits it before it can build the planet. The rebuild still runs
    at exactly the rate requests trigger it; it no longer runs between the
    request and the response."""
    with _live_payload_lock:
        c = _live_payload_cache
        cached, at = c["data"], c["at"]
    if cached is not None:
        if (time.time() - at >= LIVE_CACHE_SECS
                and _live_payload_refresh_lock.acquire(blocking=False)):
            threading.Thread(target=_refresh_world_payload, args=(vault_dir,),
                             daemon=True).start()
        return cached
    with _live_payload_lock:
        if _live_payload_cache["data"] is None:
            _live_payload_cache["data"] = _build_world_payload(vault_dir)
            _live_payload_cache["at"] = time.time()
        return _live_payload_cache["data"]


def _refresh_world_payload(vault_dir):
    """The live half, rebuilt off the request path. See world_payload()."""
    try:
        t0 = time.perf_counter()
        data = _build_world_payload(vault_dir)
        with _live_payload_lock:
            _live_payload_cache["data"] = data
            _live_payload_cache["at"] = time.time()
        log.debug("_build_world_payload took %.1fms", (time.perf_counter() - t0) * 1000)
    except Exception:
        log.exception("world payload refresh failed")
    finally:
        _live_payload_refresh_lock.release()


def _build_world_payload(vault_dir):
    base = world_static(vault_dir)
    towns = {tid: dict(t) for tid, t in base["towns"].items()}
    for t in towns.values():
        t["is_live"] = False
        t["live_agents"] = []
        t["now"] = None

    agents_in_flight = 0
    now_ts = time.time()
    for _m, main, subs in live_sessions(now_ts):
        state = session_live_state(main, subs, now_ts)
        if not state:
            continue
        rec = _load_index().get(main.as_posix())
        cwd = rec["cwd"] if rec else ""
        cwd_tid = town_id(cwd) if cwd and not is_temp_cwd(cwd) else None
        session_town_ids = set()
        for agent in state["agents"]:
            # Per Beri's spec: an agent attaches to every town its OWN file
            # tool calls resolved to (session_live_state/scan_live_file), not
            # to one town per whole session -- a subagent working in a
            # different project than its orchestrator is a citizen of that
            # project's town, not the launch cwd's.
            projects = agent.pop("projects", set())
            target_ids = {town_id(p) for p in projects if town_id(p) in towns}
            if not target_ids and cwd_tid:
                target_ids = {cwd_tid}
            for tid in target_ids:
                t = towns.get(tid)
                if not t:
                    continue
                t["is_live"] = True
                t["live_agents"].append(agent)
                session_town_ids.add(tid)
        agents_in_flight += len(state["agents"])
        # live_sessions() is newest-first, so the first one to reach a town is
        # its most recent live session and owns the "now" caption.
        for tid in session_town_ids:
            t = towns[tid]
            if t["now"] is None:
                t["now"] = state["now"]
                t["live_session"] = state["session"]

    town_list = sorted(towns.values(), key=lambda t: -t["tool_calls"])
    for t in town_list:
        t.pop("_ids", None)
    augment_world_trade(town_list, vault_dir)
    meta = dict(base["meta"])
    meta["agents_in_flight"] = agents_in_flight
    # Distinct from agents_in_flight above: a subagent whose own file-tool
    # calls resolved to two different towns (see the loop above) is one
    # citizen counted once in agents_in_flight, but rides in BOTH towns'
    # live_agents[] -- agent_slots is that fanned-out total, i.e. exactly
    # what world.html draws one drone per (__drones()). Per Beri's spec
    # (docs/TESTS.md B5b): agents_in_flight is the masthead truth, agent_slots
    # is the render truth: they can legitimately differ and both are correct.
    meta["agent_slots"] = sum(len(t["live_agents"]) for t in town_list)
    meta["towns"] = len(town_list)
    meta["live"] = sum(1 for t in town_list if t["is_live"])
    meta["open_items"] = sum(len(t["open_items"]) for t in town_list)
    # The capital is the vault if a session ever ran inside it; on this machine
    # none has, so it falls back to the busiest town — the map still needs a
    # centre to lay the others out around, and inventing a vault town that no
    # transcript supports would be the one thing this map must never do.
    vault_town = next((t for t in town_list if t["kind"] == "vault"), None)
    meta["capital"] = (vault_town or (town_list[0] if town_list else {})).get("id")
    return {"generated": datetime.now(timezone.utc).isoformat(),
            "towns": town_list, "roads": base["roads"], "meta": meta}


# ==========================================================================
# PROJECT REPLAY — GET /api/project?id=<town id>: every session ever
# attributed to one town, merged into a single replay. "One city per
# project, one street per session" (Beri's rule): a street is one main
# session (its own subagents folded in, same as everywhere else in this
# file), and the city is every street this town's `_ids` list names --
# exactly the sessions build_world_static() already folded into this town,
# so a session shows up here if and only if it shows up in that town's
# numbers on the world map.
# ==========================================================================

MAX_PROJECT_BYTES = 25 * 1024 * 1024
PROJECT_CACHE_SECS = 10
DEFAULT_WINDOW_DAYS = 30
PROJECT_BUDGET_SECS = 8.0
_project_cache = {}  # (tid, since) -> (cached_at, body_bytes, is_partial)
_project_cache_lock = threading.Lock()
# gzip of the SAME body object, compressed once per cache entry rather than
# once per request: this town's payload is 3.8 MB of JSON that shrinks to
# 0.59 MB at level 1 for 55 ms (measured 2026-09-07). Worth ~6x on the phone
# (a VPN, say) and on the browser's own parse-from-network path; the identity
# check below (`cached is body`) is what ties an entry to its exact bytes, so
# a rebuilt body can never be served under a stale gzip.
_project_gzip = {}  # (tid, since) -> (body_bytes, gzip_bytes)
_project_gzip_lock = threading.Lock()
PROJECT_GZIP_LEVEL = 1  # level 6 only buys 0.08 MB more for 27 ms more


def project_replay_gzip(tid, since, body):
    """gzip bytes for a body project_replay_json() just returned, memoised on
    that exact bytes object."""
    key = (tid, since)
    with _project_gzip_lock:
        hit = _project_gzip.get(key)
    if hit is not None and hit[0] is body:
        return hit[1]
    gz = gzip.compress(body, PROJECT_GZIP_LEVEL)
    with _project_gzip_lock:
        _project_gzip[key] = (body, gz)
    return gz

# Per-session parsed-replay cache -- er.build_replay() re-walks a session's
# main transcript plus every subagent file from scratch, and a town with
# hundreds of sessions (the chat-folder catch-all) used to pay that cost on
# EVERY /api/project cache miss, for every session, every time. Cached to
# disk (survives a server restart, unlike the in-memory caches above) keyed
# on the (size, mtime) of every file build_replay() actually reads, so a
# session is parsed once ever and only re-parsed if one of those files
# changed since.
SESSION_CACHE_DIR = SCRIPT_DIR / "data" / ".cache" / "sessions"  # dot-dir: runtime cache, skipped by the docs audit
# No lock guards this cache: see cached_build_replay() -- the global lock that
# used to wrap its read was pure contention and is gone (2026-09-07).


def _session_fingerprint(session_path):
    """[[name, size, mtime], ...] for the main file and every subagent file
    build_replay() reads for this session -- the cache key. Returns None if
    the main file itself is gone (lets the caller fall through to
    er.build_replay()'s own error path unchanged)."""
    try:
        st = session_path.stat()
    except OSError:
        return None
    parts = [["main", st.st_size, st.st_mtime]]
    subagents_dir = session_path.parent / session_path.stem / "subagents"
    if subagents_dir.is_dir():
        for f in sorted(subagents_dir.glob("agent-*.jsonl")):
            try:
                fst = f.stat()
            except OSError:
                continue
            parts.append([f.name, fst.st_size, fst.st_mtime])
    return parts


def cached_build_replay(session_path):
    """er.build_replay(session_path), cached to
    data/cache/sessions/<uuid>.json. Wholly lock-free: entries are
    per-session files nobody shares, so a global lock around the READ bought
    nothing and cost everything -- measured 2026-09-07, six threads walking
    this town's 347 sessions spent 74% of their time blocked on that one
    lock (0.34s alone -> 1.91s wall for six), which is most of why
    /api/project took 20-34s while /api/world and the SSE bursts were
    running. Concurrent readers of the same file are safe; the write is now
    tmp+replace so a reader can never see a half-written file instead of
    being locked out of it. Two threads racing a cold entry still just parse
    twice and write the same deterministic result."""
    fp = _session_fingerprint(session_path)
    if fp is None:
        return er.build_replay(session_path)
    cache_file = SESSION_CACHE_DIR / f"{session_path.stem}.json"
    try:
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        if cached.get("fingerprint") == fp:
            return cached["replay"]
    except (OSError, ValueError, KeyError):
        pass
    replay = er.build_replay(session_path)
    try:
        SESSION_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        # Per-thread tmp name: two threads writing the same session at once
        # must not race one shared tmp path (the world-index.tmp bug again,
        # docs/DECISIONS.md). replace() is atomic, so readers see old or new.
        tmp = cache_file.with_suffix(f".{threading.get_ident():x}.tmp")
        tmp.write_text(
            json.dumps({"fingerprint": fp, "replay": replay}, ensure_ascii=False),
            encoding="utf-8")
        tmp.replace(cache_file)
    except OSError:
        pass  # a failed write just means this session re-parses next time
    return replay


def build_project_replay(tid, vault_dir, since_iso=None, force_30d=False, budget_secs=None):
    """One town's full history as a merged replay. Reuses cached_build_replay()
    (er.build_replay()'s own per-session shape, disk-cached above) rather
    than re-deriving it from the live-tail machinery, since this is
    historical, not a tail. `_ids` -- the town's own list of attributed
    session stems, built by touch_town() in build_world_static() -- IS the
    attribution: a session's non-file events (prompt/text/bash) ride along
    with the rest of that session's events into every town it was folded
    into, same as the world index already counts it there.

    Default window is the last DEFAULT_WINDOW_DAYS (30) unless `since_iso`
    widens it, always reported as `truncated: true` -- a town can span
    months of sessions and merging all of them by default is what made a
    337-session town take minutes to answer. `force_30d` overrides an
    explicit `since_iso` back to that same default window (used when a
    widened request still exceeds MAX_PROJECT_BYTES).

    `budget_secs`, when given, bounds only the per-session merge loop below,
    NOT world_static()'s own (separately cached, WORLD_CACHE_SECS-bounded)
    index rebuild above it -- a town's clock starts once its own session
    list is in hand, so one town's cold budget is never spent on work every
    endpoint shares and that a live poller keeps warm anyway. Past the
    budget, returns `partial: true` with whatever was already merged -- the
    caller is expected to keep building the rest in the background and let
    a later call see the complete result."""
    static = world_static(vault_dir)
    town = static["towns"].get(tid)
    if town is None:
        return None
    since_ms = None if force_30d else (er.to_ms(since_iso) if since_iso else None)
    if since_ms is None:
        since_ms = int(time.time() * 1000) - DEFAULT_WINDOW_DAYS * 24 * 3600 * 1000
    live_stems = {m.stem for _mt, m, _s in live_sessions(time.time())}
    deadline = time.time() + budget_secs if budget_secs is not None else None
    # The window filter used to run AFTER the parse, so a town whose _ids
    # span months paid a full build_replay() for every session it was about
    # to throw away -- 146 of this town's 347, 12.3s of an 18.2s cold merge
    # (measured 2026-09-07). The persistent index already knows each
    # session's LAST timestamp, so skip the parse when even that is older
    # than the window. `last`, not `first`: started <= last, so `last <
    # since` PROVES `started < since` and the session was going to be
    # dropped below anyway. No index record (a session that started since
    # the last refresh_index()) means no proof -- parse it, same as before.
    with _index_lock:
        idx = _load_index()

    replays = []
    partial = False
    for sid in town.get("_ids", []):
        if deadline is not None and time.time() > deadline:
            partial = True
            break
        main = find_session_by_id(sid)
        if not main:
            continue
        if since_ms is not None:
            rec = idx.get(main.as_posix())
            if rec and rec.get("last") and er.to_ms(rec["last"]) < since_ms:
                continue
        try:
            r = cached_build_replay(main)
        except (ValueError, OSError):
            continue
        started_ms = er.to_ms(r["session"]["started"])
        if since_ms is not None and started_ms < since_ms:
            continue
        replays.append((started_ms, sid, r, main.stem in live_stems, main))
    replays.sort(key=lambda x: x[0])

    base_ms = replays[0][0] if replays else 0
    all_events, agents_out, streets = [], [], []
    for started_ms, sid, r, is_live, main in replays:
        prefix = sid[:8]
        offset = started_ms - base_ms
        for e in r["events"]:
            e2 = dict(e)
            e2["t"] = int(e["t"] + offset)
            e2["agent"] = f"{prefix}:{e['agent']}"
            e2["session"] = sid
            all_events.append(e2)
        for a in r["agents"]:
            a2 = dict(a)
            a2["id"] = f"{prefix}:{a['id']}"
            agents_out.append(a2)
        ended_iso = None
        if not is_live:
            ended_ms = started_ms + r["session"]["duration_ms"]
            ended_iso = (datetime.fromtimestamp(ended_ms / 1000, tz=timezone.utc)
                                 .isoformat().replace("+00:00", "Z"))
        # build_replay()'s own title (tools/export_replay.py) is the raw first
        # user message clipped to 80 chars, with no envelope check at all --
        # a street sign for a `<scheduled-task name="daily-hey-reminder" ...>`
        # session showed that literal tag. session_summary() already carries
        # the is_envelope()/task_line() fix (see above); reuse it here rather
        # than duplicating the check into export_replay.py, which this pass
        # does not otherwise touch.
        title = r["session"]["title"]
        if is_envelope(title):
            title = session_summary(main)["title"] or title
        streets.append({"id": sid, "title": title,
                        "started": r["session"]["started"], "ended": ended_iso,
                        "events": len(r["events"]), "live": is_live})
    all_events.sort(key=lambda e: e["t"])
    started_iso = (datetime.fromtimestamp(base_ms / 1000, tz=timezone.utc)
                          .isoformat().replace("+00:00", "Z")) if replays else None
    session_obj = {"id": tid, "cwd": town["path"], "started": started_iso,
                   "duration_ms": all_events[-1]["t"] if all_events else 0,
                   "title": town["name"]}
    # `root` + `town` at top level (2026-09-06): the client used to guess the
    # town's own root from path statistics under the session cwd, which fails
    # a knife-edge case (item 12, docs/HANDOFF.md) -- the server already
    # knows the real answer, so hand it over instead of making the client
    # re-derive it. `project_meta` is 60s-cached, same call `/api/project/meta`
    # and `/api/world` already pay for.
    root = town["path"].replace("\\", "/")
    meta = project_meta(tid, vault_dir)
    town_obj = {"id": tid, "name": town["name"],
                "trade": meta["trade"] if meta else None,
                "logo": meta["logo"] if meta else None}
    return {"session": session_obj, "agents": agents_out, "events": all_events,
            "streets": streets, "truncated": True, "partial": partial,
            "root": root, "town": town_obj}


_project_building = set()  # (tid, since) currently finishing in the background
_project_building_lock = threading.Lock()


def project_replay_obj(tid, vault_dir, max_age=PROJECT_CACHE_SECS):
    """The default-window (`since=None`) town replay as a Python object,
    sharing project_replay_json()'s own `_project_cache` -- so
    handle_project_stream()'s history-so-far burst (docs/TESTS.md A8) is a
    cache HIT, not a fresh 198-session merge, whenever `/api/project` (or a
    previous stream connect) already warmed this exact town recently. A
    cache miss still costs one json.dumps to populate that shared entry,
    same as project_replay_json() already pays on its own miss.

    `max_age` defaults to the plain 10s `PROJECT_CACHE_SECS` (an `/api/project`
    poll wants that tight a freshness bound), but handle_project_stream()
    calls this with STREAM_BURST_MAX_AGE instead: a stream burst is only
    ever "history so far" -- the live tail attached right after it covers
    anything the burst missed -- so an entry the prewarm loop below is
    already keeping warm is a correct answer even well short of fresh, and
    accepting it is what turns a prewarmed town's connect into a cache hit
    instead of racing the prewarm thread for the same 10s window."""
    key = (tid, None)
    now = time.time()
    with _project_cache_lock:
        hit = _project_cache.get(key)
    if hit and now - hit[0] < max_age:
        return json.loads(hit[1])
    data = build_project_replay(tid, vault_dir, budget_secs=PROJECT_BUDGET_SECS)
    if data is None:
        return None
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    with _project_cache_lock:
        _project_cache[key] = (now, body, bool(data.get("partial")))
    if data.get("partial"):
        _finish_project_in_background(tid, vault_dir, None)
    return data


def project_replay_json(tid, vault_dir, since):
    """Cached (10s) JSON bytes for one town. Bounded by an 8s wall-clock
    budget (PROJECT_BUDGET_SECS): a cold, hundreds-of-sessions town gets back
    whatever was assembled in that time with "partial": true, while
    _finish_project_in_background keeps building the full result so the
    NEXT call sees it complete -- instead of every caller paying the town's
    full cold-parse time.

    Stale-while-revalidate on top of that (2026-09-07), the same shape
    world_static() got earlier today and for the same reason: past the 10s
    TTL the caller used to wait for a rebuild, and under real load (3
    /api/world + 3 /api/stream clients) that rebuild blew the 8s budget, so
    the wallpaper's one click got `partial: true` with 48 of 201 streets --
    a black city. replay.js fetches this ONCE and never re-polls, so a
    partial answer is what Beri sees until he reloads.

    Hence the asymmetry below: a stale but COMPLETE entry is served
    instantly and refreshed behind the request (a snapshot 30s old is a
    true snapshot; the SSE tail attached right after carries what moved
    since). A stale PARTIAL entry is NOT served -- it is not a worse-dated
    truth, it is a missing city -- so that case still builds inline, exactly
    as before."""
    key = (tid, since)
    now = time.time()
    with _project_cache_lock:
        hit = _project_cache.get(key)
    if hit:
        hit_partial = len(hit) > 2 and hit[2]
        if now - hit[0] < PROJECT_CACHE_SECS:
            return hit[1]
        if not hit_partial:
            _finish_project_in_background(tid, vault_dir, since)
            return hit[1]
    data = build_project_replay(tid, vault_dir, since_iso=since,
                                 budget_secs=PROJECT_BUDGET_SECS)
    if data is None:
        return None
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    if since is not None and not data.get("partial") and len(body) > MAX_PROJECT_BYTES:
        # A widened request that's still too big falls back to the same
        # default window a plain request already gets, rather than serving
        # nothing -- ?since=None is already at that window and has nothing
        # further to fall back to (see MAX_PROJECT_BYTES's docstring above).
        data = build_project_replay(tid, vault_dir, since_iso=since, force_30d=True,
                                     budget_secs=PROJECT_BUDGET_SECS)
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    with _project_cache_lock:
        _project_cache[key] = (now, body, bool(data.get("partial")))
    if data.get("partial"):
        _finish_project_in_background(tid, vault_dir, since)
    return body


def _finish_project_in_background(tid, vault_dir, since):
    """Started once per (tid, since) whenever a request came back partial, and
    (2026-09-07) whenever project_replay_json() served a stale-but-complete
    entry -- both want the same thing: rebuild this key with no deadline and
    swap the result in, off the request path.
    Runs the same build with no deadline and overwrites the 10s cache entry
    when done, so the call after this one sees the complete town instead of
    another partial result or another 8s wait. `_project_building` is the
    per-key in-flight guard so a burst of requests for the same partial town
    doesn't start the same background rebuild several times over."""
    key = (tid, since)
    with _project_building_lock:
        if key in _project_building:
            return
        _project_building.add(key)

    def worker():
        try:
            data = build_project_replay(tid, vault_dir, since_iso=since)
            if data is None:
                return
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            if since is not None and len(body) > MAX_PROJECT_BYTES:
                data = build_project_replay(tid, vault_dir, since_iso=since, force_30d=True)
                body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            with _project_cache_lock:
                _project_cache[key] = (time.time(), body, bool(data.get("partial")))
        finally:
            with _project_building_lock:
                _project_building.discard(key)

    threading.Thread(target=worker, daemon=True, name=f"project-finish-{tid}").start()


PREWARM_INTERVAL_SECS = 45
PREWARM_BOOT_DELAY_SECS = 25  # see _prewarm_project_replay_cache(): clear of restart-server.ps1's 15s /api/sessions check
PREWARM_STALE_SECS = 60
# How old a prewarmed entry handle_project_stream() will still accept as a
# hit (measured, docs/TESTS.md A8): a lap only rebuilds a town once it is
# PREWARM_STALE_SECS old, and reaching a given town can itself cost most of
# a lap (several towns x 4-6s each) after that -- 63s-old was observed to
# still miss at a 60s bound. This is one interval's worth of slack on top,
# not a second freshness policy: /api/project's own 10s PROJECT_CACHE_SECS
# is untouched, and a burst is "history so far" regardless -- the live tail
# attached right after it covers whatever this staleness misses.
STREAM_BURST_MAX_AGE = PREWARM_INTERVAL_SECS + PREWARM_STALE_SECS + 15


def _prewarm_project_replay_cache(vault_dir):
    """Background loop (docs/TESTS.md A8): a cold `/api/stream?project=`
    connect shares project_replay_obj()'s 10s cache, but that cache only
    ever gets warmed by an actual request -- so the FIRST stream connect to
    a town after 10s of silence pays the full merge (8.7s measured on this
    project's own town). Every PREWARM_INTERVAL_SECS, refresh that cache for
    the towns a stream is actually likely to hit next: every currently-live
    town (world_payload()'s own is_live, the live-state cache /api/world
    already shares) plus the 3 most recently active. One town at a time,
    with a short sleep between, so this never competes hard with a real
    request for the GIL -- it is background upkeep, not a hot path.

    The first lap runs at PREWARM_BOOT_DELAY_SECS, not at a full interval
    (2026-09-07): the sleep used to come first, so for the 45s after a
    restart no town was warm and the wallpaper's click landed on a cold
    build. 25s, not 0, and measured the hard way -- at 12s this loop's first
    lap starved `/api/sessions` and `launcher/restart-server.ps1` reported
    "restart FAILED", the exact failure the world prewarm's own 5s delay
    already exists to avoid (see "Startup speed", docs/HANDOFF.md). That
    script polls /api/sessions for 15s after start, so the first lap has to
    land after it."""
    time.sleep(PREWARM_BOOT_DELAY_SECS)
    while True:
        try:
            payload = world_payload(vault_dir)
            towns = payload["towns"]
            live_ids = [t["id"] for t in towns if t["is_live"]]
            recent = sorted((t for t in towns if t["last_active"]),
                             key=lambda t: t["last_active"], reverse=True)[:3]
            ids = list(dict.fromkeys(live_ids + [t["id"] for t in recent]))
            now = time.time()
            for tid in ids:
                with _project_cache_lock:
                    hit = _project_cache.get((tid, None))
                if hit and now - hit[0] < PREWARM_STALE_SECS:
                    continue
                t0 = time.perf_counter()
                project_replay_obj(tid, vault_dir)
                log.debug("prewarm refreshed %s in %.1fms", tid,
                          (time.perf_counter() - t0) * 1000)
                time.sleep(0.2)
        except Exception:
            log.exception("prewarm loop failed")
        time.sleep(PREWARM_INTERVAL_SECS)


# ==========================================================================
# PROJECT METADATA — GET /api/project/meta?id=<town id>: what the 3D world
# needs to shape a town's building like its trade, put its logo on a sign
# and cut one wing per site page. Everything below reads it off the
# project's OWN files (JSON-LD, BRIEF/README keywords, favicons, HANDOFF) --
# nothing here is guessed, per the brief. GET /api/project/asset serves the
# logo file it finds, scoped to that town's own root directory.
# ==========================================================================

# Directories that are never a page or a trade signal, wherever they sit in
# a project -- vendored code, build output and old copies. os.walk (not
# pathlib.rglob, which enumerates a whole tree before anything can be
# filtered) is what lets these be pruned in place instead of walked.
TRADE_SKIP_DIR_NAMES = {"node_modules", ".git", ".claude", "vendor", "dist", "archive", "backups"}
# A page listing additionally skips the client-editor/admin surface -- those
# are real .html/.php files, just not one of the site's own pages.
PAGE_SKIP_DIR_NAMES = TRADE_SKIP_DIR_NAMES | {"partials", "includes", "edit", "admin"}

MAX_PAGES_LISTED = 24
META_CACHE_SECS = 60


def _is_skip_dir(name, skip_names):
    """True for an exact skip-name match, or one that's merely dressed up
    with a leading underscore/dot or a `-`/`_` neighbour (`_backups`,
    `html-backups-2026-08-08`) -- real directory names on this machine, not
    a hypothetical, found while verifying this pass on wm-storybook."""
    low = name.lower()
    if low.strip("_.-") in skip_names:
        return True
    return any(tok in skip_names for tok in re.split(r"[^a-z0-9]+", low) if tok)


def _walk_files(root, max_depth, skip_names, exts):
    """Files under `root` with a suffix in `exts`, at most `max_depth`
    directories deep, never descending into `skip_names`. `root` itself is
    depth 0. Yields nothing if `root` isn't a real directory (a town's path
    can be a loose .md file, not a project folder)."""
    if not root.is_dir():
        return
    for dirpath, dirnames, filenames in os.walk(root):
        rel = Path(dirpath).relative_to(root)
        depth = 0 if rel == Path(".") else len(rel.parts)
        dirnames[:] = [d for d in dirnames if not _is_skip_dir(d, skip_names)]
        if depth >= max_depth:
            dirnames[:] = []
        for fn in filenames:
            if Path(fn).suffix.lower() in exts:
                yield Path(dirpath) / fn


def _read_text(path, cap):
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:cap]
    except OSError:
        return ""


# -- trade: JSON-LD first, then a BRIEF/README/index.html keyword table -----

# Any script tag naming this content-type, whichever order its attributes
# come in -- the lookahead checks the tag without caring where `type=` sits.
JSONLD_SCRIPT_RE = re.compile(
    r'<script\b(?=[^>]*type=["\']application/ld\+json["\'])[^>]*>(.*?)</script>',
    re.I | re.S)
JSONLD_TYPE_RE = re.compile(r'"@type"\s*:\s*"([^"]+)"')
# schema.org types that show up inside a real LocalBusiness JSON-LD block but
# say nothing about the trade itself (the address, the menu, the org that
# published it) -- excluded so the first REMAINING @type is the business
# subtype the brief asks for, not one of these.
GENERIC_JSONLD_TYPES = {
    "website", "webpage", "organization", "person", "imageobject",
    "breadcrumblist", "searchaction", "menu", "menuitem", "menusection",
    "postaladdress", "openinghoursspecification", "aggregaterating",
    "review", "faqpage", "question", "answer", "article", "product",
    "offer", "geocoordinates", "contactpoint", "listitem", "itemlist",
    "place", "thing", "creativework", "localbusiness",
    # Address/geo scaffolding a WooCommerce-style Organization block drags in
    # (found on wm-storybook's docs/shop-en/en-books-live.html while
    # verifying this pass -- an Organization->address graph with no real
    # trade subtype anywhere in it, misread as "AdministrativeArea" before
    # these were added).
    "administrativearea", "state", "country", "city",
}


def _jsonld_trade_type(html_text):
    """The first non-generic `@type` inside any JSON-LD block, in document
    order -- e.g. "Restaurant" out of a block that also names PostalAddress
    and Menu. None if every block is one of the generic types above."""
    for block in JSONLD_SCRIPT_RE.findall(html_text):
        for t in JSONLD_TYPE_RE.findall(block):
            if t.lower() not in GENERIC_JSONLD_TYPES:
                return t
    return None


# The keyword table that decides a project's trade. It lives in
# config/trades.json, not here, because it is the one part of the detection
# that is about the USER's work rather than about the algorithm: somebody
# running a print shop or a law practice needs their own words in it, and
# should not have to edit a 4,000-line server to add them.
#
# Order matters and the file says so: the first row that matches wins, so the
# specific trade words come first and the generic "tool/server/cli" catch-all
# comes last, or it swallows every project that merely mentions a server.
TRADES_PATH = _cfg_path(CONFIG.get("trades_file"), "config/trades.json")


def _load_trade_table():
    """[(compiled regex, schema.org type)] out of config/trades.json.

    Entries that are not objects are skipped on purpose: the file uses bare
    strings inside the `trades` array as section comments (JSON has no comment
    syntax and this table needs explaining more than it needs purity). A row
    with a broken regex is reported and dropped rather than taking the whole
    server down -- a hand-edited config must never be able to stop it booting."""
    table = []
    try:
        raw = json.loads(TRADES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        print(f"cannot read {TRADES_PATH} ({e}) - no trades will be detected",
              file=sys.stderr)
        return table
    for row in raw.get("trades", []):
        if not isinstance(row, dict):
            continue
        try:
            table.append((re.compile(row["match"], re.I), row["type"]))
        except (KeyError, re.error) as e:
            print(f"skipping trade row {row!r}: {e}", file=sys.stderr)
    return table


KEYWORD_TRADE_TABLE = _load_trade_table()

TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
DESC_RE = re.compile(
    r'<meta\b(?=[^>]*name=["\']description["\'])[^>]*content=["\']([^"\']*)["\']',
    re.I | re.S)
OG_SITE_NAME_RE = re.compile(
    r'<meta\b(?=[^>]*property=["\']og:site_name["\'])[^>]*content=["\']([^"\']*)["\']',
    re.I | re.S)
JSONLD_NAME_RE = re.compile(r'"name"\s*:\s*"([^"]+)"')


def _schema_name_blob(html_text):
    """Every `"name"` value inside any JSON-LD block on the page -- the
    schema's own declared name, distinct from its `@type` (_jsonld_trade_type
    above already tried that). One hit here counts as a strong keyword
    source, same as the page's own <title>."""
    parts = []
    for block in JSONLD_SCRIPT_RE.findall(html_text):
        parts.extend(JSONLD_NAME_RE.findall(block))
    return " ".join(parts)


_CODE_FENCE_RE = re.compile(r'```[\s\S]*?```')
_CODE_SPAN_RE = re.compile(r'`[^`\n]*`')
_WIKILINK_RE = re.compile(r'\[\[.*?\]\]')
_URL_OR_PATH_TOKEN_RE = re.compile(r'\S*[/\\]\S*')
_REFERENCE_SENTENCE_RE = re.compile(
    r'\b(?:demo|reference|example|installed on|for the)\b', re.I)


def _strip_paths_and_code(text):
    """Drop code spans, wikilinks and URL/path-shaped tokens before a
    keyword source is matched -- a hit inside `/musikschule/`,
    `musikschule.html` or a `[[wikilink]]` names a location, not the
    project's own trade."""
    if not text:
        return text
    # fenced blocks first: a directory listing inside ``` names files
    # (site-editor's README lists MUSIKSCHULE-EDIT-RULES.md), not a trade
    text = _CODE_FENCE_RE.sub(" ", text)
    text = _CODE_SPAN_RE.sub(" ", text)
    text = _WIKILINK_RE.sub(" ", text)
    text = _URL_OR_PATH_TOKEN_RE.sub(" ", text)
    return text


def _strip_reference_sentences(text):
    """Drop whole lines that talk ABOUT another project -- 'demo',
    'reference', 'example', 'installed on', 'for the' -- before a BRIEF/
    README source is matched. site-editor's own BRIEF and README each name
    the musikschule demo as the reference install ("On the Musikschule
    demo, live at ..."); that is prose about musikschule, not about
    site-editor, and must not decide site-editor's trade."""
    if not text:
        return text
    lines = re.split(r'(?<=[.\n])', text)
    return "".join(ln for ln in lines if not _REFERENCE_SENTENCE_RE.search(ln))


def _keyword_blob(root):
    """Text for each keyword source the brief names, kept as separate
    fields (not concatenated) -- _keyword_trade_type needs to know WHICH
    source a match came from, so one stray word in a BRIEF (claude-live's
    mentions drones once) can't decide the whole town's trade on its own.
    BRIEF/README are also stripped of path/URL/code-span tokens and of
    lines that reference another project by name (see
    _strip_reference_sentences) -- title/description/og:site_name/
    schema-name are left as-is since a page legitimately titling itself
    "Demo: X" is naming itself, not another project."""
    sources = {"title": "", "description": "", "og_site_name": "",
               "schema_name": "", "brief": "", "readme": ""}
    for name in ("docs/BRIEF.md", "BRIEF.md"):
        p = root / name
        if p.is_file():
            sources["brief"] = _strip_reference_sentences(
                _strip_paths_and_code(_read_text(p, 60000)))
            break
    for name in ("docs/README.md", "README.md"):
        p = root / name
        if p.is_file():
            sources["readme"] = _strip_reference_sentences(
                _strip_paths_and_code(_read_text(p, 60000)))
            break
    idx = root / "index.html"
    if idx.is_file():
        text = _read_text(idx, 8000)
        m = TITLE_RE.search(text)
        if m:
            sources["title"] = m.group(1)
        m = DESC_RE.search(text)
        if m:
            sources["description"] = m.group(1)
        m = OG_SITE_NAME_RE.search(text)
        if m:
            sources["og_site_name"] = m.group(1)
        sources["schema_name"] = _schema_name_blob(text)
    return sources


# A hit in the page's own title, its declared site name or its schema's own
# name is a strong enough signal to stand alone. Anywhere else (BRIEF,
# README, meta description) needs a SECOND, independent hit for the same
# type before the keyword table trusts it -- one stray word in a BRIEF must
# not decide a project's whole trade (claude-live's BRIEF mentions drones
# once and used to read as Photographer; claude-hub/wp-site each mention
# "book" once and used to read as Book).
STRONG_KEYWORD_SOURCES = ("title", "og_site_name", "schema_name")
COUNTED_KEYWORD_SOURCES = ("title", "description", "brief", "readme")


def _keyword_trade_type(sources):
    for rx, t in KEYWORD_TRADE_TABLE:
        if any(sources.get(s) and rx.search(sources[s]) for s in STRONG_KEYWORD_SOURCES):
            return t
        hits = sum(1 for s in COUNTED_KEYWORD_SOURCES
                   if sources.get(s) and rx.search(sources[s]))
        if hits >= 2:
            return t
    return None


def _has_html_pages(root):
    """Cheap existence check (not a full listing) for the software-default
    rule below -- a project with no html pages at all is a tool, not a
    site, regardless of what its BRIEF happens to say."""
    try:
        return next(_walk_files(root, 2, PAGE_SKIP_DIR_NAMES, {".html"}), None) is not None
    except OSError:
        return False


def _is_tool_project(root):
    """`.claude/skills` and anything under a `tools` category folder are
    code, not a business front -- default them to SoftwareSourceCode when
    neither JSON-LD nor a keyword hit named a trade."""
    if (root / ".claude" / "skills").is_dir():
        return True
    return "tools" in [s.lower() for s in root.parts]


def _software_default_trade(root):
    """A project with server.py, or a package.json declaring `bin`/`main`,
    and no html pages at all is code, not a business front."""
    has_server = (root / "server.py").is_file()
    has_bin_or_main = False
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(_read_text(pkg, 200000))
            has_bin_or_main = "bin" in data or "main" in data
        except ValueError:
            has_bin_or_main = False
    if (has_server or has_bin_or_main) and not _has_html_pages(root):
        return True
    return _is_tool_project(root)


ADMIN_UI_DIR_NAMES = {"edit", "admin", "tools"}


def _has_only_admin_ui_html(root):
    """True when every html page under root lives inside an edit/admin/
    tools directory (or there are none) -- an admin/editor UI, not a
    public-facing site, so a keyword hit in its docs must not override it."""
    try:
        for f in _walk_files(root, 2, PAGE_SKIP_DIR_NAMES, {".html"}):
            rel_parts = [p.lower() for p in f.relative_to(root).parts[:-1]]
            if not any(p in ADMIN_UI_DIR_NAMES for p in rel_parts):
                return False
    except OSError:
        return False
    return True


def _structural_default_trade(root):
    """Structural signals that outrank any keyword hit, checked BEFORE the
    keyword table -- a project under a `tools` category folder, or one with
    server.py/package.json `bin`/`main` whose only html pages are
    admin/editor UIs, is code regardless of what its own docs happen to say
    about another project (site-editor's BRIEF/README name the musikschule
    demo as its reference install; that must not make site-editor read as
    `MusicSchool`)."""
    if _is_tool_project(root):
        return True
    has_server = (root / "server.py").is_file()
    has_bin_or_main = False
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(_read_text(pkg, 200000))
            has_bin_or_main = "bin" in data or "main" in data
        except ValueError:
            has_bin_or_main = False
    return (has_server or has_bin_or_main) and _has_only_admin_ui_html(root)


def _detect_trade(root, trade_files):
    for f in trade_files:
        t = _jsonld_trade_type(_read_text(f, 2_000_000))
        if t:
            return {"type": t, "source": "jsonld", "confidence": 0.95}
    if root.is_dir():
        if _structural_default_trade(root):
            return {"type": "SoftwareSourceCode", "source": "default", "confidence": 0.5}
        t = _keyword_trade_type(_keyword_blob(root))
        if t:
            return {"type": t, "source": "keywords", "confidence": 0.6}
        if _software_default_trade(root):
            return {"type": "SoftwareSourceCode", "source": "default", "confidence": 0.5}
    return {"type": None, "source": None, "confidence": 0.0}


# -- logo: a named image file first, og:image as the fallback ---------------

LOGO_NAME_PREFIXES = ("logo", "favicon", "apple-touch-icon")
LOGO_EXTS = (".svg", ".png", ".webp")
MAX_LOGO_BYTES = 1024 * 1024
OG_IMAGE_RE = re.compile(
    r'<meta\b(?=[^>]*property=["\']og:image["\'])[^>]*content=["\']([^"\']+)["\']',
    re.I | re.S)


def _logo_source_name(rel):
    name = Path(rel).name.lower()
    for prefix in LOGO_NAME_PREFIXES:
        if name.startswith(prefix):
            return prefix
    return "og:image"


def _find_logo(root):
    """The project's own path to its best logo image, relative to `root` --
    SVG first, then the largest PNG/WebP under the 1 MB cap. Looked for by
    name (logo*/favicon*/apple-touch-icon*) at the root and in its usual
    image folders; og:image in index.html is the fallback when none of
    those exist."""
    candidates = []  # (0=svg/1=other, -size, relpath) -- sorts best first
    for d in (root, root / "img", root / "images", root / "assets"):
        if not d.is_dir():
            continue
        try:
            entries = list(d.iterdir())
        except OSError:
            continue
        for f in entries:
            if not f.is_file() or f.suffix.lower() not in LOGO_EXTS:
                continue
            if not f.name.lower().startswith(LOGO_NAME_PREFIXES):
                continue
            try:
                size = f.stat().st_size
            except OSError:
                continue
            if size > MAX_LOGO_BYTES:
                continue
            rank = 0 if f.suffix.lower() == ".svg" else 1
            candidates.append((rank, -size, f.relative_to(root).as_posix()))
    if candidates:
        candidates.sort()
        return candidates[0][2]

    idx = root / "index.html"
    if not idx.is_file():
        return None
    m = OG_IMAGE_RE.search(_read_text(idx, 8000))
    if not m:
        return None
    url = m.group(1)
    if url.lower().startswith(("http://", "https://", "//", "data:")):
        return None  # points off this project's own files -- not usable as an asset
    try:
        p = (root / url.lstrip("/")).resolve()
        p.relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    if not p.is_file() or p.stat().st_size > MAX_LOGO_BYTES:
        return None
    return p.relative_to(root).as_posix()


# -- pages: one entry per site page, biggest first ---------------------------

H1_RE = re.compile(r"<h1[^>]*>(.*?)</h1>", re.I | re.S)
TAG_RE = re.compile(r"<[^>]+>")


def _page_title(text):
    for rx in (TITLE_RE, H1_RE):
        m = rx.search(text)
        if m:
            title = TAG_RE.sub("", m.group(1)).strip()
            if title:
                return title
    return None


def _list_pages(root):
    pages = []
    for f in _walk_files(root, 2, PAGE_SKIP_DIR_NAMES, {".html", ".php"}):
        try:
            size = f.stat().st_size
        except OSError:
            continue
        title = _page_title(_read_text(f, 8000)) or f.stem
        pages.append({"file": f.relative_to(root).as_posix(), "title": title, "bytes": size})
    pages.sort(key=lambda p: -p["bytes"])
    return pages[:MAX_PAGES_LISTED]


# -- site_url: JSON-LD, canonical link, or the HANDOFF's own live line ------

JSONLD_SITE_URL_RE = re.compile(
    r'"@type"\s*:\s*"(?:WebSite|Organization)"[^}]*?"url"\s*:\s*"([^"]+)"',
    re.I | re.S)
CANONICAL_RE = re.compile(
    r'<link\b(?=[^>]*rel=["\']canonical["\'])[^>]*href=["\']([^"\']+)["\']',
    re.I | re.S)
HANDOFF_URL_RE = re.compile(r"(https?://\S+)", re.I)


def _detect_site_url(root):
    idx = root / "index.html"
    if idx.is_file():
        text = _read_text(idx, 20000)
        m = JSONLD_SITE_URL_RE.search(text) or CANONICAL_RE.search(text)
        if m:
            return m.group(1)
    handoff = root / "docs" / "HANDOFF.md"
    if handoff.is_file():
        for line in _read_text(handoff, 40000).splitlines():
            if re.search(r"\blive\b", line, re.I):
                m = HANDOFF_URL_RE.search(line)
                if m:
                    return m.group(1).rstrip(").,;‏")
    return None


# -- stack: cheap file-presence heuristics, no dependency parsing beyond
# package.json's own declared list ------------------------------------------

ANDROID_MARKERS = ("app/src/main/AndroidManifest.xml", "build.gradle",
                   "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts",
                   "gradlew")


def _detect_stack(root, trade_files):
    if not root.is_dir():
        return []
    stack = []
    if any(f.suffix.lower() == ".php" for f in trade_files):
        stack.append("php")
    if (root / "wp-config.php").is_file() or (root / "wp-content").is_dir():
        stack.append("wordpress")
    pkg = root / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(_read_text(pkg, 200000))
            deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        except ValueError:
            deps = {}
        if "three" in deps:
            stack.append("three.js")
        if any(k == "remotion" or k.startswith("@remotion/") for k in deps):
            stack.append("remotion")
    if any((root / m).is_file() for m in ANDROID_MARKERS):
        stack.append("kotlin/android")
    try:
        has_py = (root / "requirements.txt").is_file() or any(root.glob("*.py"))
    except OSError:
        has_py = False
    if has_py:
        stack.append("python")
    return stack


def _last_deploy(trade_files):
    latest = 0
    for f in trade_files:
        try:
            latest = max(latest, f.stat().st_mtime)
        except OSError:
            pass
    if not latest:
        return None
    return datetime.fromtimestamp(latest, tz=timezone.utc).isoformat().replace("+00:00", "Z")


_meta_cache = {}  # town id -> (built_at, meta dict)
_meta_cache_lock = threading.Lock()

# -- persistent trade/logo cache ---------------------------------------------
# H4 (docs/TESTS.md, "Acceptance 2026-09-07 evening"): /api/world used to
# recompute trade+logo for every town on every payload rebuild, budgeted to
# WORLD_META_BUDGET_SECS total (not per town) and ordered by tool_calls --
# so a low-activity town (gasthof-post-wenns, 4 calls) sat at the tail of
# that loop and lost the budget on EVERY rebuild, forever, while which towns
# elsewhere made the cut depended on machine load at that instant (the
# 1-45 swing HANDOFF documents). Fix: trade+logo now live in one persistent,
# on-disk dict this process treats as the single source of truth. It is
# filled by two writers only -- a live /api/project/meta hit
# (_store_trade_cache, called from build_project_meta) and the boot-time/
# periodic prewarm sweep (_prewarm_trade_cache) -- and read by exactly one
# reader, augment_world_trade(), which never touches the filesystem: a dict
# lookup is the same speed and the same answer on every call. See
# docs/DECISIONS.md, "Persistent trade cache, no per-request scan".
TRADE_CACHE_PATH = SCRIPT_DIR / "data" / ".cache" / "trade-cache.json"
TRADE_PREWARM_INTERVAL_SECS = 120  # a stat-only signature check per town is
                                    # cheap; this is how soon an edited site's
                                    # new trade reaches /api/world unprompted.
_trade_cache = {}  # town id -> {"sig": [file_count, newest_mtime], "trade": {...}, "logo": {...}|None}
_trade_cache_lock = threading.Lock()
TRADE_SAVE_MIN_INTERVAL_SECS = 1.0  # see _save_trade_cache(): the prewarm sweep
                                    # asks for a save per town; this is how often
                                    # one of those asks actually reaches disk.
_trade_save_last = 0.0      # time.time() of the last flush
_trade_save_timer = None    # the pending coalesced flush, or None
_trade_save_seq = 0         # makes each tmp file name unique within this process


def _trade_and_logo(tid, root, trade_files):
    """Trade + logo for one town off an already-walked `trade_files` list --
    factored out of build_project_meta so a live /api/project/meta hit and
    the background prewarm sweep run the exact same detection code and can
    never disagree about a town's trade."""
    trade = _detect_trade(root, trade_files)
    logo_rel = _find_logo(root) if root.is_dir() else None
    logo = None
    if logo_rel:
        logo = {"url": f"/api/project/asset?id={tid}&f={quote(logo_rel)}",
                "source": _logo_source_name(logo_rel)}
    return trade, logo


def _trade_signature(trade_files):
    """Cheap staleness check for the persistent trade cache: file count plus
    the newest mtime among them, both from stat() calls only -- never a
    content read, so checking whether a town changed never costs what
    re-running _detect_trade on it costs."""
    latest = 0
    for f in trade_files:
        try:
            latest = max(latest, f.stat().st_mtime)
        except OSError:
            pass
    return [len(trade_files), latest]


def _load_trade_cache():
    """Restores the persistent trade cache at boot, so a restart doesn't
    drop every town back to null until the prewarm sweep below finishes."""
    try:
        with open(TRADE_CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return
    with _trade_cache_lock:
        _trade_cache.update(data)


def _save_trade_cache():
    """Asks for the cache to reach disk, at most once per
    TRADE_SAVE_MIN_INTERVAL_SECS. Coalescing is the point: the boot prewarm
    sweep calls this once per town, so 145 towns rewrote the whole file 145
    times in a few seconds and every one of those writes was a chance for
    two threads to collide over the same path. A save inside the quiet
    window arms ONE timer instead, which flushes whatever the cache holds
    when it fires -- so the last writer's data still lands, just once."""
    global _trade_save_timer
    with _trade_cache_lock:
        wait = _trade_save_last + TRADE_SAVE_MIN_INTERVAL_SECS - time.time()
        if wait > 0:
            if _trade_save_timer is None:
                _trade_save_timer = threading.Timer(wait, _flush_trade_cache)
                _trade_save_timer.daemon = True   # never hold up shutdown
                _trade_save_timer.start()
            return
    _flush_trade_cache()


def _flush_trade_cache():
    """Atomic write (tmp + replace), same pattern as world-index.json --
    a crash mid-write must never leave a half-written cache file behind.

    Two Windows-specific details this had to learn the hard way. The tmp name
    is unique per call (pid + thread + counter): one fixed `trade-cache.tmp`
    meant the prewarm thread and a /api/project/meta request thread wrote the
    SAME file at the same time and one of them then renamed a file the other
    still had open -- which on Windows is a PermissionError, and it surfaced
    as an intermittent 500 on /api/project/meta (the world-index.tmp bug
    again, docs/DECISIONS.md). And the replace runs UNDER the lock, so two
    flushes can never rename onto the target at once. A replace that still
    loses gets one retry and is then logged and dropped: a cache file that
    missed one update is a re-scan later, never a failed request."""
    global _trade_save_timer, _trade_save_last, _trade_save_seq
    TRADE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _trade_cache_lock:
        _trade_save_timer = None
        _trade_save_last = time.time()
        _trade_save_seq += 1
        tmp = TRADE_CACHE_PATH.with_suffix(
            f".{os.getpid()}.{threading.get_ident():x}.{_trade_save_seq}.tmp")
        data = json.dumps(dict(_trade_cache))
    try:
        tmp.write_text(data, encoding="utf-8")
    except OSError:
        log.exception("trade cache tmp write failed")
        return
    with _trade_cache_lock:
        for attempt in (0, 1):
            try:
                os.replace(tmp, TRADE_CACHE_PATH)
                return
            except PermissionError:
                if attempt:
                    break
                time.sleep(0.05)   # another handle on the target; let it close
            except OSError:
                break
        log.warning("trade cache replace lost to another writer; skipping this save")
    try:
        tmp.unlink()
    except OSError:
        pass


def _store_trade_cache(tid, trade, logo, trade_files):
    """Writes one town's trade+logo into the persistent cache -- called from
    build_project_meta() so a live /api/project/meta hit warms /api/world's
    next call immediately, with no wait for the prewarm sweep."""
    with _trade_cache_lock:
        _trade_cache[tid] = {"sig": _trade_signature(trade_files), "trade": trade, "logo": logo}
    _save_trade_cache()


def _refresh_trade_cache_entry(tid, root):
    """One town's turn in the prewarm sweep: skip the content read entirely
    if its signature hasn't moved since the last scan."""
    trade_files = sorted(_walk_files(root, 3, TRADE_SKIP_DIR_NAMES, {".html", ".php"}))
    sig = _trade_signature(trade_files)
    with _trade_cache_lock:
        hit = _trade_cache.get(tid)
    if hit and hit.get("sig") == sig:
        return
    trade, logo = _trade_and_logo(tid, root, trade_files)
    with _trade_cache_lock:
        _trade_cache[tid] = {"sig": sig, "trade": trade, "logo": logo}
    _save_trade_cache()


def _prewarm_trade_cache(vault_dir):
    """Walks every town once at boot, then every TRADE_PREWARM_INTERVAL_SECS
    thereafter, filling/refreshing the persistent trade cache off the
    request path -- this, plus a live /api/project/meta hit, is the only
    place trade detection's own filesystem walk ever runs. See
    _refresh_trade_cache_entry for why a re-scan is cheap for a town that
    hasn't changed."""
    _load_trade_cache()
    while True:
        try:
            base = world_static(vault_dir)
            for tid, t in base["towns"].items():
                root = Path(t["path"])
                if root.is_dir():
                    _refresh_trade_cache_entry(tid, root)
        except Exception:
            log.exception("trade cache prewarm sweep failed")
        time.sleep(TRADE_PREWARM_INTERVAL_SECS)


def build_project_meta(tid, vault_dir):
    """Everything /api/project/meta answers for one town, read straight off
    its own files -- see the module comment above the PROJECT METADATA
    section for what each field is and where it comes from."""
    static = world_static(vault_dir)
    town = static["towns"].get(tid)
    if town is None:
        return None
    root = Path(town["path"])
    trade_files = sorted(_walk_files(root, 3, TRADE_SKIP_DIR_NAMES, {".html", ".php"}))
    trade, logo = _trade_and_logo(tid, root, trade_files)
    _store_trade_cache(tid, trade, logo, trade_files)
    return {"id": tid, "name": town["name"], "root": town["path"], "trade": trade,
            "logo": logo, "pages": _list_pages(root) if root.is_dir() else [],
            "site_url": _detect_site_url(root) if root.is_dir() else None,
            "stack": _detect_stack(root, trade_files),
            "last_deploy": _last_deploy(trade_files)}


def project_meta(tid, vault_dir):
    """Cached 60s per town -- a project's files don't change fast enough to
    justify recomputing this (pages/site_url/stack/last_deploy) on every
    request. Only the dict read/write is locked; build_project_meta()'s own
    filesystem walk runs unlocked so one slow town's meta build never blocks
    another town's cache lookup."""
    now = time.time()
    with _meta_cache_lock:
        hit = _meta_cache.get(tid)
    if hit and now - hit[0] < META_CACHE_SECS:
        return hit[1]
    data = build_project_meta(tid, vault_dir)
    if data is not None:
        with _meta_cache_lock:
            _meta_cache[tid] = (now, data)
    return data


def augment_world_trade(town_list, vault_dir):
    """Adds `trade` and `logo` to each town in /api/world by reading the
    persistent trade cache ONLY -- no filesystem walk, no budget, nothing
    time-dependent. A town neither /api/project/meta nor the prewarm sweep
    has reached yet answers null until one of them does, but that answer is
    now IDENTICAL on every call in between (H4 fix -- see module comment
    above _trade_cache)."""
    with _trade_cache_lock:
        cache = dict(_trade_cache)
    for t in town_list:
        hit = cache.get(t["id"])
        t["trade"] = hit["trade"] if hit else {"type": None, "source": None, "confidence": 0.0}
        t["logo"] = hit["logo"] if hit else None


# -- /api/project/asset: serves only an image file inside the town's own
# root, path-traversal safe --------------------------------------------------

ASSET_CONTENT_TYPES = {
    ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".ico": "image/x-icon",
}
MAX_ASSET_BYTES = 1024 * 1024


def resolve_asset_path(tid, rel, vault_dir):
    """The real file `f=` points to, or None if it isn't an image, doesn't
    exist, or resolves outside the town's own root -- one guard covers an
    absolute path, a drive letter and a `..` segment before the path is ever
    joined, and a second (`relative_to` after `resolve()`) catches a symlink
    or `..` reaching the same place a different way."""
    static = world_static(vault_dir)
    town = static["towns"].get(tid)
    if town is None:
        return None
    root = Path(town["path"])
    if not root.is_dir():
        return None
    rel_norm = (rel or "").replace("\\", "/")
    if (not rel_norm or rel_norm.startswith("/") or re.match(r"^[A-Za-z]:", rel_norm)
            or ".." in rel_norm.split("/")):
        return None
    try:
        p = (root / rel_norm).resolve()
        p.relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    if p.suffix.lower() not in ASSET_CONTENT_TYPES or not p.is_file():
        return None
    return p


# -- /api/project/file: serves one source/text file inside a town's own root
# for the interiors view, same traversal guard as /api/project/asset plus a
# name-based block list for anything that could leak a secret --------------

MAX_PROJECT_FILE_BYTES = 512 * 1024
FILE_FORBIDDEN_DIR_NAMES = {"node_modules", ".git", ".claude", "secrets"}
RAW_HTML_EXTENSIONS = {".html", ".htm", ".php"}
PROJECT_FILE_CSP = (
    "sandbox allow-same-origin; default-src 'self' data: blob:; "
    "img-src * data:; style-src 'self' 'unsafe-inline'; script-src 'none'"
)


def _is_forbidden_project_file(rel_norm):
    """Name-based block list on top of the path-traversal guard: any
    directory segment matching FILE_FORBIDDEN_DIR_NAMES, or a filename that
    looks like a secret/credential/key by name alone."""
    segs = rel_norm.split("/")
    if any(seg.lower() in FILE_FORBIDDEN_DIR_NAMES for seg in segs[:-1]):
        return True
    name = segs[-1].lower()
    if name.endswith(".env"):
        return True
    if name.endswith((".pem", ".key")):
        return True
    if name.endswith(".json") and ("secret" in name or "credential" in name):
        return True
    return False


def resolve_project_file_path(tid, rel, vault_dir):
    """The real file `f=` points to, or None if it's outside the town's own
    root, name-blocked, or doesn't exist -- same two-guard shape as
    resolve_asset_path() (segment check before joining, relative_to() after
    resolve() to catch a symlink out)."""
    static = world_static(vault_dir)
    town = static["towns"].get(tid)
    if town is None:
        return None
    root = Path(town["path"])
    if not root.is_dir():
        return None
    rel_norm = (rel or "").replace("\\", "/")
    if (not rel_norm or rel_norm.startswith("/") or re.match(r"^[A-Za-z]:", rel_norm)
            or ".." in rel_norm.split("/")):
        return None
    if _is_forbidden_project_file(rel_norm):
        return None
    try:
        p = (root / rel_norm).resolve()
        p.relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    if not p.is_file():
        return None
    return p


# -- /api/project/tree/<town>/<path>: a path-shaped sibling of
# /api/project/file's `raw=1`, so a relative url() inside a stylesheet
# resolves to a real path instead of through a query-string <base> that RFC
# 3986 breaks a level deeper than an element attribute reaches (see
# docs/HANDOFF.md item 10). Same traversal + secret guards as
# resolve_project_file_path(); the difference is a content-type whitelist so
# css/js/fonts/images/svg/json/html can be served with their real type
# instead of `asset`'s image-only list (item 11) --------------------------

TREE_PATH_PREFIX = "/api/project/tree/"
MAX_TREE_BYTES = 2 * 1024 * 1024
TREE_CONTENT_TYPES = {
    **ASSET_CONTENT_TYPES,
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".php": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".otf": "font/otf",
}


def resolve_project_tree_path(tid, rel, vault_dir):
    """The real file `<path>` points to, or None if it's outside the town's
    own root, name-blocked, of a type not in TREE_CONTENT_TYPES, or doesn't
    exist. Returns (path, content_type)."""
    static = world_static(vault_dir)
    town = static["towns"].get(tid)
    if town is None:
        return None
    root = Path(town["path"])
    if not root.is_dir():
        return None
    rel_norm = (rel or "").replace("\\", "/")
    if (not rel_norm or rel_norm.startswith("/") or re.match(r"^[A-Za-z]:", rel_norm)
            or ".." in rel_norm.split("/")):
        return None
    if _is_forbidden_project_file(rel_norm):
        return None
    try:
        p = (root / rel_norm).resolve()
        p.relative_to(root.resolve())
    except (ValueError, OSError):
        return None
    ctype = TREE_CONTENT_TYPES.get(p.suffix.lower())
    if ctype is None or not p.is_file():
        return None
    return p, ctype


# ==========================================================================
# RECORDINGS — which finished sessions deserve a film, and whether now is a
# good moment to render one. The render itself lives in tools/recorder.py;
# everything that needs to know what a session or a town IS stays here, which
# is also what keeps that module free of an import back into this one.
# ==========================================================================

RECORDINGS_DIR = _cfg_path(CONFIG.get("recordings_dir"), "recordings")
# Frames are scratch: a 90 s film is ~2,600 JPEGs and they are deleted the
# moment ffmpeg has read them. Same dot-dir the session cache uses, so the
# docs audit keeps skipping it.
RECORDER_WORK_DIR = SCRIPT_DIR / "data" / ".cache" / "recorder"
# The only three things the recorder ever writes, so the only three the range
# server needs to name. Anything else under recordings/ is not ours.
RECORDING_TYPES = {".mp4": "video/mp4", ".jpg": "image/jpeg",
                   ".json": "application/json"}


_candidates_cache = {"data": None, "at": 0}
_candidates_lock = threading.Lock()
CANDIDATES_CACHE_SECS = 300


def cached_recording_candidates():
    """Whatever the last scan found, or None if none has finished yet.

    The request path uses THIS and never _build_recording_candidates():
    a cold scan measured 37.9 s here (194 candidates, every session's title
    read off its transcript) and warm 1.3 s, so a shelf load that built it
    would time out on the first open after a restart -- it did. The recorder
    thread refreshes it every five minutes anyway, which is the only clock
    that actually matters: a session becomes a candidate ten minutes after it
    goes quiet."""
    with _candidates_lock:
        return _candidates_cache["data"]


def recording_candidates():
    """`_build_recording_candidates()` behind a 5-minute cache. Called from the
    recorder thread only."""
    with _candidates_lock:
        data, at = _candidates_cache["data"], _candidates_cache["at"]
    if data is not None and time.time() - at < CANDIDATES_CACHE_SECS:
        return data
    data = _build_recording_candidates()
    with _candidates_lock:
        _candidates_cache["data"] = data
        _candidates_cache["at"] = time.time()
    return data


def _build_recording_candidates():
    """Finished sessions worth a film, newest first.

    Three gates, all read off the index that /api/world already maintains, so
    this costs a dict walk and no transcript parsing:
      * silent for rc.SILENT_SECS -- a session still being typed into would be
        filmed half-written, and the film would be wrong an hour later;
      * at least rc.MIN_TOOL_EVENTS file-tool calls -- under that there is no
        city to watch build, just empty ground;
      * started inside the last rc.BACKLOG_DAYS -- the first run must not try
        to render two years of history. Older ones are rendered on demand (see
        docs/RUNBOOK.md).
    The town is picked exactly the way list_recent_sessions() picks it, so a
    film lands in the same project the world map already files that session
    under."""
    idx, _ = refresh_index()
    now_ms = int(time.time() * 1000)
    cutoff_ms = now_ms - rc.BACKLOG_DAYS * 86400 * 1000
    out = []
    for s in session_records(idx):
        if s["tools"] < rc.MIN_TOOL_EVENTS:
            continue
        first_ms = er.to_ms(s["first"]) if s["first"] else None
        last_ms = er.to_ms(s["last"]) if s["last"] else None
        if first_ms is None or last_ms is None or first_ms < cutoff_ms:
            continue
        if now_ms - last_ms < rc.SILENT_SECS * 1000:
            continue
        pc = s.get("project_calls") or {}
        if pc:
            proj = max(pc.items(), key=lambda kv: kv[1])[0]
        elif s["cwd"] and not is_temp_cwd(s["cwd"]):
            proj = s["cwd"]
        else:
            continue
        try:
            title = session_summary(s["main"])["title"]
        except OSError:
            continue
        name = proj.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        title = title or s["session"][:8]
        # THE recorder's ingest point, and the reason redaction is not purely
        # an HTTP concern: recorder.py builds the folder name, the file stem
        # and the film's title card out of these two strings, and those end
        # up on disk and burnt into the video. Pseudonymised here so a film
        # rendered under redaction is redacted in its own filename too.
        if REDACT:
            name, title = redact_name(name), redact_session(s["session"])
        out.append({
            "project": name,
            "project_id": town_id(proj),
            "session_id": s["session"],
            "title": title,
            "started": s["first"], "ended": s["last"],
            "tool_events": s["tools"],
        })
    out.sort(key=lambda c: c["ended"] or "", reverse=True)
    return out


def recorder_busy(vault_dir):
    """Is the machine in the middle of something? A render drives a second
    headless Chrome through WebGL on the one integrated GPU here, which
    docs/RUNBOOK.md measures at a 15-frame cost to whatever else is drawing.
    So it only ever starts when nobody is working: no agent in flight, and no
    transcript touched inside the live window. Any error answers "busy" --
    the safe direction is to not start."""
    try:
        if world_payload(vault_dir).get("meta", {}).get("agents_in_flight", 0) > 0:
            return True
        return bool(live_sessions(time.time()))
    except Exception:
        log.exception("[recorder] busy check failed; treating as busy")
        return True


# ==========================================================================
# Play mode -- the wallpaper borrows the screen
# ==========================================================================
# Beri asked for "a button on the wallpaper that makes it take control so I can
# play inside the wallpaper too". The wallpaper cannot be given a keyboard:
# Lively hosts globe.html?wallpaper=1 in a WebView2 behind the desktop icons
# with `InputForward: 1` (mouse only), and the one setting that forwards keys
# also swallows every key typed AT the desktop (docs/RUNBOOK.md "The desktop
# wallpaper"). So the page asks THIS server to open one fullscreen kiosk browser
# window, at the same page and the same state, over the desktop. That window is
# an ordinary browser with real focus, so WASD, F, "/" and Escape work there
# exactly as they do in a tab. Leaving kills that window and the wallpaper is
# simply there underneath -- never reloaded, never touched. See docs/DECISIONS.md.

# Its own throwaway profile, so the kiosk can never read, lock or dirty the
# profile Beri browses with. `.cache` because it is regenerable runtime state
# (the docs audit skips dot-dirs), same as the recorder's work dir above.
PLAY_PROFILE_DIR = SCRIPT_DIR / "data" / ".cache" / "play-profile"
# Three lines about the one thing on this server that opens a window on Beri's
# real screen, kept out of the 250 kB request log he would otherwise grep.
PLAY_LOG_PATH = SCRIPT_DIR / "launcher" / "play.log"
# The kiosk gets a CDP port so the acceptance run can drive it and assert on it
# (docs/TESTS.md) -- there is no other way to send that window a keystroke from
# a test. Chromium binds --remote-debugging-port to 127.0.0.1 only, and this
# profile holds nothing but this page.
PLAY_DEBUG_PORT = 4950

_play_lock = threading.Lock()
_play_proc = None          # subprocess.Popen of the ONE kiosk, or None


def _play_log(msg):
    log.info("[play] " + msg)
    try:
        PLAY_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(PLAY_LOG_PATH, "a", encoding="utf-8") as f:
            f.write("[{}] {}\n".format(
                datetime.now().isoformat(timespec="seconds"), msg))
    except Exception:
        pass       # a window that opened but could not be logged still opened


def _play_browser():
    """Edge first, then Chrome -- the same order and the same three paths
    launcher/screensaver-watch.ps1 already picks ITS kiosk with, so the play
    window and the screensaver window are always the same browser."""
    for env, rel, name in (
        ("ProgramFiles(x86)", "Microsoft/Edge/Application/msedge.exe", "msedge"),
        ("ProgramFiles", "Microsoft/Edge/Application/msedge.exe", "msedge"),
        ("ProgramFiles", "Google/Chrome/Application/chrome.exe", "chrome"),
    ):
        root = os.environ.get(env)
        if not root:
            continue
        exe = Path(root) / rel
        if exe.is_file():
            return exe, name
    return None, None


def _play_target_url(raw, port):
    """The address the kiosk opens at, or None if the client asked for anything
    but a page on this server. The browser is being launched BY the server, so
    the one thing that must be impossible is launching it at somebody else's
    address -- a file name and a query string is the whole allowed vocabulary."""
    s = str(raw or "").strip()
    if not re.match(r"^[A-Za-z0-9_.\-]+\.html(\?[^#\s]*)?$", s):
        return None
    return "http://127.0.0.1:{}/{}".format(port, s)


def play_alive():
    """The live kiosk's PID, or None. Caller must hold _play_lock. This is also
    where a kiosk the user closed some other way is forgotten, so `play` opens a
    new window instead of silently reporting one that is not on screen."""
    global _play_proc
    if _play_proc is None:
        return None
    if _play_proc.poll() is not None:
        _play_log("kiosk pid {} exited on its own (code {})".format(
            _play_proc.pid, _play_proc.returncode))
        _play_proc = None
        return None
    return _play_proc.pid


# ==========================================================================
# HTTP handler
# ==========================================================================

class Handler(SimpleHTTPRequestHandler):
    server_version = "Werkstadt/1.0"
    vault_dir = None
    boot_ms = 0
    auth_creds = None  # (user, password) from _load_auth_creds(), or None = auth off

    # A warm open of globe.html measured 219 requests, of which ~200 are the
    # asset pack (task B). SimpleHTTPRequestHandler sends Last-Modified and no
    # Cache-Control, so Chrome falls back to HEURISTIC caching -- 10 % of the
    # file's age, which for an asset written yesterday is about two hours.
    # After that every one of those 200 files costs a conditional round trip
    # through this threaded Python server on every open, forever. One day of
    # explicit caching removes them.
    #
    # A DAY, not `immutable`: the asset pack is still being written to (new
    # Hunyuan models land under assets/hunyuan/ at the same paths), and a
    # browser that has been told a file will never change has no reason to ask
    # again. A day self-corrects; see docs/RUNBOOK.md for the hard-reload note.
    ASSET_CACHE_PREFIX = "/assets/"
    ASSET_CACHE_CONTROL = "public, max-age=86400"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SCRIPT_DIR), **kwargs)

    def send_response_only(self, code, message=None):
        # end_headers() below needs to know the status; the base class keeps
        # no record of it.
        self._status = code
        super().send_response_only(code, message)

    def end_headers(self):
        # Only on a real hit or a revalidation -- a 404 or a 401 for an asset
        # path must never be the answer a browser caches for a day.
        if getattr(self, "_asset_cache", False) and getattr(self, "_status", 0) in (200, 304):
            self.send_header("Cache-Control", self.ASSET_CACHE_CONTROL)
        # Advertised on the plain 200 too, or Chrome never asks for a range in
        # the first place and the <video> element stays unseekable.
        if getattr(self, "_recordings_file", False) and getattr(self, "_status", 0) == 200:
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/stream") or self.path.startswith("/api/vault"):
            return  # our own connect/disconnect lines cover these
        # super().log_message() writes straight to sys.stderr, which is None
        # under pythonw.exe (no console) -- that raised inside send_response(),
        # before any bytes reached the client, and looked like a connection
        # reset on every endpoint that did not hit the early return above.
        try:
            super().log_message(fmt, *args)
        except Exception:
            pass

    def _check_auth(self):
        """Basic Auth gate for every GET route incl. SSE (docs/RUNBOOK.md:
        phone on the same private network). Loopback stays open so the desktop
        shortcut and the screensaver keep working with no credentials --
        127.0.0.1 is never how the phone reaches this server. No secrets
        file at all -> auth stays off (unchanged local-only behaviour)."""
        if self.auth_creds is None or self.client_address[0] == "127.0.0.1":
            return True
        header = self.headers.get("Authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                decoded = base64.b64decode(header[6:]).decode("utf-8")
                u, _, p = decoded.partition(":")
                ok = (hmac.compare_digest(u, self.auth_creds[0])
                      and hmac.compare_digest(p, self.auth_creds[1]))
            except Exception:
                ok = False
        if not ok:
            log.warning(f"[auth] rejected {self.command} {self.path} from {self.client_address[0]}")
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Werkstadt"')
            self.end_headers()
        return ok

    def handle_empty_vault(self):
        """An empty data/vault.json, for the shipped no-vault configuration."""
        body = json.dumps({"notes": [], "links": [], "timeline": [],
                           "counts": {"notes": 0, "resolved": 0}}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def handle_client_config(self):
        """The client-visible slice of config.json, as a <script> the pages load
        before their own module.

        A SCRIPT and not JSON on purpose: globe.js needs the continent rules
        while it is building its first frame, and a fetch() there would mean a
        planet that pops into place one round-trip late. Only the keys below
        ever leave the process -- the transcripts root, the vault path and the
        auth file are the server's business and a browser has no use for them."""
        body = ("window.WERKSTADT_CONFIG = %s;\n" % json.dumps({
            # Lower-cased with forward slashes because that is the shape
            # globe.js compares town paths in; doing it here means the client
            # never has to know which OS wrote the path.
            # Under redaction `home` is literally "~": redact_town_path()
            # rewrites every town path to start with it, so continentOf()'s
            # prefix test still separates local projects from offshore ones
            # without the username ever reaching the browser.
            "home": "~" if REDACT else str(Path.home()).replace("\\", "/").lower(),
            "continents": CONFIG.get("continents") or [],
            # The aviary regex is matched client-side against a town's path
            # and name, both of which are pseudonyms under redaction — so it
            # could only ever match by accident. Sent empty instead.
            "aviary_projects": "" if REDACT else (CONFIG.get("aviary_projects") or ""),
            "redact": REDACT,
        })).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Never cached: editing config.json and reloading the page has to be
        # the whole of "apply my settings".
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._check_auth():
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/stream":
            self.handle_stream(parse_qs(parsed.query))
        elif parsed.path == "/api/vault":
            self.handle_vault()
        elif parsed.path == "/api/sessions":
            self.handle_sessions()
        elif parsed.path == "/api/world":
            self.handle_world()
        elif parsed.path == "/api/world/stream":
            self.handle_world_stream()
        elif parsed.path == "/api/project":
            self.handle_project(parse_qs(parsed.query))
        elif parsed.path == "/api/project/meta":
            self.handle_project_meta(parse_qs(parsed.query))
        elif parsed.path == "/api/project/asset":
            self.handle_project_asset(parse_qs(parsed.query))
        elif parsed.path == "/api/project/file":
            self.handle_project_file(parse_qs(parsed.query))
        elif parsed.path.startswith(TREE_PATH_PREFIX):
            self.handle_project_tree(parsed.path[len(TREE_PATH_PREFIX):])
        elif parsed.path == "/api/vault/search":
            self.handle_vault_search(parse_qs(parsed.query))
        elif parsed.path == "/api/vault/note":
            self.handle_vault_note(parse_qs(parsed.query))
        elif parsed.path == "/api/recordings":
            self.handle_recordings()
        elif parsed.path == "/api/play":
            self.handle_play_status()
        elif parsed.path == "/api/config.js":
            self.handle_client_config()
        elif parsed.path == "/data/vault.json" and (REDACT or not VAULT_JSON_PATH.exists()):
            # The vault layer is optional and off by default, so on a fresh
            # clone this file does not exist. globe.js and world.js both fetch
            # it and both already fall back to an empty vault -- but the 404
            # lands in the console of every default install, which reads as a
            # broken page. An empty export IS the truth here, so serve it.
            #
            # Under redaction the same empty answer stands in for a real
            # export: vault.json is a static file of note TITLES, and a note
            # title is the one thing in this whole tree that is prose a human
            # wrote. There is no useful pseudonym for it, so the island
            # simply has no notes while redacted.
            self.handle_empty_vault()
        else:
            # A <video> that cannot seek is a video you have to watch from the
            # start every time, and SimpleHTTPRequestHandler answers a Range
            # request with the whole file and a 200 -- which Chrome treats as
            # "not seekable". Only the recordings tree needs this; everything
            # else here is small enough that the whole file IS the answer.
            if parsed.path.startswith("/recordings/") and self.headers.get("Range"):
                if self.serve_recording_range(unquote(parsed.path)):
                    return
            self._recordings_file = parsed.path.startswith("/recordings/")
            # Static file. Flag the asset pack for end_headers() above; nothing
            # else on this server is safe to cache (the pages and the .js are
            # edited constantly, data/vault.json is fetched no-store anyway).
            self._asset_cache = parsed.path.startswith(self.ASSET_CACHE_PREFIX)
            super().do_GET()

    def do_POST(self):
        """The play window is the only thing on this server a client may cause,
        so /api/play and /api/play/stop are the only POSTs that exist.

        LOOPBACK ONLY, and a 403 rather than a 401: this is not a credentials
        problem. Opening a fullscreen window on Beri's real screen is a thing the
        remote client must never be able to do, with or without the Basic
        Auth password (_check_auth above, docs/RUNBOOK.md "Phone access")."""
        parsed = urlparse(self.path)
        if parsed.path not in ("/api/play", "/api/play/stop"):
            self.send_error(404, "no such endpoint")
            return
        if self.client_address[0] != "127.0.0.1":
            log.warning("[play] refused POST {} from {}".format(
                parsed.path, self.client_address[0]))
            self.send_error(403, "loopback only")
            return
        if parsed.path == "/api/play/stop":
            self.handle_play_stop()
        else:
            self.handle_play_start()

    # -- /api/play ----------------------------------------------------------
    def handle_play_status(self):
        """{alive, pid}. Read-only, so it rides the normal GET auth gate."""
        with _play_lock:
            pid = play_alive()
        self._send_json({"alive": bool(pid), "pid": pid})

    def handle_play_start(self):
        global _play_proc
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n)) if n else {}
        except Exception:
            body = {}
        url = _play_target_url(body.get("url"), self.server.server_address[1])
        if not url:
            _play_log("refused url {!r}".format(body.get("url")))
            self._send_json({"error": "bad url"}, status=400)
            return
        with _play_lock:
            pid = play_alive()
            if pid:
                # Deliberately a no-op and not a second window: two fullscreen
                # kiosks stacked on one screen is a state with no visible way
                # back, which is the failure this whole feature exists to avoid.
                _play_log("play requested while pid {} is alive -- ignored".format(pid))
                self._send_json({"alive": True, "pid": pid, "started": False})
                return
            exe, name = _play_browser()
            if not exe:
                _play_log("ERROR: neither Edge nor Chrome found")
                self._send_json({"error": "no browser found"}, status=500)
                return
            PLAY_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
            # The same kiosk flags launcher/screensaver-watch.ps1 has been
            # opening this world with since 2026-09-05: Edge needs
            # --edge-kiosk-type=fullscreen or its kiosk is a locked-down tab
            # with a toolbar, Chrome wants the URL inside --app=.
            if name == "msedge":
                args = [str(exe), "--kiosk", url, "--edge-kiosk-type=fullscreen"]
            else:
                args = [str(exe), "--kiosk", "--app=" + url]
            args += ["--new-window",
                     "--user-data-dir={}".format(PLAY_PROFILE_DIR),
                     "--remote-debugging-port={}".format(PLAY_DEBUG_PORT)]
            try:
                # Popen and not `powershell Start-Process`: this server runs as
                # pythonw.exe under the At-logon task, in Beri's own interactive
                # session, so a child process here already owns a desktop --
                # verified with a real screen capture, docs/shots/play-mode.png.
                # A fresh --user-data-dir also means the launched process IS the
                # browser process (no hand-off to a running instance), which is
                # what makes the PID below the one worth storing.
                _play_proc = subprocess.Popen(args, close_fds=True)
            except Exception as e:
                _play_log("ERROR launching {}: {}".format(name, e))
                self._send_json({"error": str(e)}, status=500)
                return
            _play_log("launched {} pid {} at {}".format(name, _play_proc.pid, url))
            self._send_json({"alive": True, "pid": _play_proc.pid, "started": True})

    def handle_play_stop(self):
        global _play_proc
        with _play_lock:
            pid = play_alive()
            if not pid:
                self._send_json({"alive": False, "pid": None, "stopped": False})
                return
            # BY PID, WITH /T, AND NEVER BY IMAGE NAME. `taskkill /IM msedge.exe`
            # would close every Edge window Beri has open and every agent's
            # browser on this machine (docs/RUNBOOK.md). /T because a Chromium
            # main process leaves its renderers behind when killed alone.
            try:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                               capture_output=True, timeout=10)
            except Exception as e:
                _play_log("ERROR taskkill pid {}: {}".format(pid, e))
            _play_proc = None
            _play_log("stopped kiosk pid {}".format(pid))
            self._send_json({"alive": False, "pid": None, "stopped": True})

    def _sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

    def _send_event(self, obj):
        # The single writer for all four SSE feeds (/api/stream,
        # /api/project's stream, /api/vault, /api/world/stream), which is why
        # redaction hooks in here and nowhere upstream: one branch covers
        # every live message the browser will ever see.
        if REDACT:
            obj = redact_message(obj)
        self.wfile.write(f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8"))
        self.wfile.flush()

    def _send_keepalive(self):
        self.wfile.write(b": keepalive\n\n")
        self.wfile.flush()

    # -- /api/stream ------------------------------------------------------
    def handle_stream(self, query):
        project_tid = query.get("project", [None])[0]
        if project_tid:
            self.handle_project_stream(project_tid)
            return

        pinned_id = query.get("session", [None])[0]
        addr = self.client_address[0]

        if pinned_id:
            session_path = find_session_by_id(pinned_id)
            if not session_path:
                self.send_error(404, f"no session {pinned_id}")
                return
        else:
            session_path = find_latest_session()
            if not session_path:
                self.send_error(503, "no sessions found")
                return

        log.info(f"[connect] /api/stream session={session_path.stem} pinned={bool(pinned_id)} client={addr}")
        self._sse_headers()
        tail = SessionTail(session_path)
        try:
            for ev in tail.burst():
                self._send_event(ev)
        except Exception as e:
            log.error(f"[error] /api/stream burst failed for {session_path}: {e}")
            return

        last_sent = time.monotonic()
        ticks = 0
        try:
            while True:
                time.sleep(STREAM_POLL_SECS)
                ticks += 1

                if not pinned_id and ticks % SESSION_SWITCH_CHECK_EVERY == 0:
                    newest = find_latest_session()
                    if newest and newest != tail.session_path:
                        log.info(f"[switch] /api/stream {tail.session_path.stem} -> {newest.stem} client={addr}")
                        for ev in tail.flush_pending():
                            self._send_event(ev)
                            last_sent = time.monotonic()
                        session_path = newest
                        tail = SessionTail(session_path)
                        for ev in tail.burst():
                            self._send_event(ev)
                            last_sent = time.monotonic()
                        continue

                for ev in tail.poll():
                    self._send_event(ev)
                    last_sent = time.monotonic()

                for ev in tail.check_timeouts():
                    self._send_event(ev)
                    last_sent = time.monotonic()

                if time.monotonic() - last_sent >= KEEPALIVE_SECS:
                    self._send_keepalive()
                    last_sent = time.monotonic()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            try:
                for ev in tail.flush_pending():
                    self._send_event(ev)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
                pass
            log.info(f"[disconnect] /api/stream session={session_path.stem} client={addr}")

    # -- /api/stream?project= ----------------------------------------------
    def _project_touches(self, main, subs, tid, now_ts):
        """True if this live session's own file-tool paths (or, absent any,
        its cwd) resolve to town `tid` -- the same per-agent attribution
        _build_world_payload() uses for a town's live_agents[], so a session
        streamed here is exactly one whose events /api/project for the same
        town will also carry once the session finishes."""
        state = session_live_state(main, subs, now_ts)
        if not state:
            return False
        for agent in state["agents"]:
            if any(town_id(p) == tid for p in agent.get("projects", set())):
                return True
        rec = _load_index().get(main.as_posix())
        cwd = rec["cwd"] if rec else ""
        return bool(cwd and not is_temp_cwd(cwd) and town_id(cwd) == tid)

    def _burst_project_session(self, main, tails):
        """Add one session to the tail set and send its whole history-so-far
        -- same as the plain /api/stream's burst() on connect or on a
        session switch, just with the session/agent-prefix fields
        /api/project's merged replay also carries."""
        tail = SessionTail(main)
        tails[main.stem] = tail
        prefix = main.stem[:8]
        try:
            for ev in tail.burst():
                ev["session"] = main.stem
                ev["agent"] = f"{prefix}:{ev['agent']}"
                self._send_event(ev)
        except Exception as e:
            log.error(f"[error] /api/stream?project= burst failed for {main}: {e}")
            del tails[main.stem]

    def _attach_live_tail(self, main, snap_sizes, tails):
        """Attach an already-live, already-touching session to the tail set
        WITHOUT SessionTail.burst()'s full re-parse -- its history-so-far was
        already sent from build_project_replay()'s (disk-cached) replay in
        handle_project_stream() below, so this only needs today's file
        offsets to pick up whatever is written from here on. `snap_sizes`
        (main file + its subagent files -> size) is read by the caller
        BEFORE build_project_replay() runs, so a line appended while that
        build was in flight is still covered by the poll() that follows,
        never silently skipped.

        Trade-off, same shape as check_timeouts()'s existing PENDING_CALL_TIMEOUT_SECS
        soft-drop: any Agent/tool call still open at this exact moment has no
        entry in pending_agent_calls/pending_tool_calls (burst() would have
        seeded those from a full parse), so its eventual tool_result finds
        no match in line_to_events() and is silently dropped instead of
        emitted -- no crash, no duplicate, just one missed tool_end on a call
        that straddled the cutover."""
        tail = SessionTail(main)
        for obj in er.iter_transcript_lines(main):
            if obj.get("timestamp"):
                tail.session_start_ms = er.to_ms(obj["timestamp"])
                break
        if tail.session_start_ms is None:
            return
        for f, size in snap_sizes.items():
            if f == main or f.parent == tail.subagents_dir:
                tail.offsets[f] = size
        tails[main.stem] = tail

    def handle_project_stream(self, tid):
        addr = self.client_address[0]
        log.info(f"[connect] /api/stream?project={tid} client={addr}")
        self._sse_headers()
        self.wfile.write(b": connected\n\n")
        self.wfile.flush()
        tails = {}  # session stem -> SessionTail, only sessions live AND touching this town
        last_sent = time.monotonic()

        try:
            now_ts = time.time()
            live_now = list(live_sessions(now_ts))
            live_touching = [main for _mt, main, subs in live_now
                              if self._project_touches(main, subs, tid, now_ts)]
            # Snapshot file sizes now -- before build_project_replay() below,
            # whose cache build/hit can itself take a moment on a cold town --
            # so _attach_live_tail()'s poll() picks up from exactly this
            # point and nothing appended in between is lost. See A8.
            snap_sizes = {}
            for main in live_touching:
                snap_sizes[main] = main.stat().st_size
                sdir = main.parent / main.stem / "subagents"
                if sdir.is_dir():
                    for f in sdir.glob("agent-*.jsonl"):
                        snap_sizes[f] = f.stat().st_size

            # Street announcements first (docs/TESTS.md A8): a separate
            # per-session pre-pass here was tried and measured WORSE on a
            # 338-session town (session_summary() cold on 338 files serially
            # ran 27s, against project_replay_obj()'s single merge below at
            # ~2.8s warm) -- so the streets ride the one merge result
            # instead of paying for a second full pass over the town.
            # max_age=STREAM_BURST_MAX_AGE (docs/TESTS.md A8): a burst is
            # "history so far", and the prewarm loop below keeps a live/
            # recent town's entry no older than that (with slack for a lap
            # that hasn't reached it yet) -- so accept one that old here
            # instead of racing the prewarm thread for the tighter 10s
            # window /api/project's own polling needs.
            data = project_replay_obj(tid, self.vault_dir, max_age=STREAM_BURST_MAX_AGE)
            if data:
                for s in data["streets"]:
                    self._send_event({"kind": "street", "id": s["id"],
                                      "title": s["title"], "live": s["live"]})
                    last_sent = time.monotonic()
                events = data["events"]
                for i in range(0, len(events), PROJECT_STREAM_CHUNK):
                    for ev in events[i:i + PROJECT_STREAM_CHUNK]:
                        self._send_event(ev)
                    last_sent = time.monotonic()

            for main in live_touching:
                if main.stem not in tails:
                    self._attach_live_tail(main, snap_sizes, tails)
                    last_sent = time.monotonic()

            ticks = 0
            while True:
                time.sleep(STREAM_POLL_SECS)
                ticks += 1
                now_ts = time.time()

                if ticks % SESSION_SWITCH_CHECK_EVERY == 0:
                    live_now = list(live_sessions(now_ts))
                    live_stems = {m.stem for _mt, m, _s in live_now}
                    for stem in [s for s in tails if s not in live_stems]:
                        prefix = stem[:8]
                        for ev in tails[stem].flush_pending():
                            ev["session"] = stem
                            ev["agent"] = f"{prefix}:{ev['agent']}"
                            self._send_event(ev)
                            last_sent = time.monotonic()
                        del tails[stem]
                    for _mt, main, subs in live_now:
                        if main.stem in tails or not self._project_touches(main, subs, tid, now_ts):
                            continue
                        self._send_event({"kind": "street", "id": main.stem,
                                          "title": session_summary(main).get("title", ""),
                                          "live": True})
                        last_sent = time.monotonic()
                        self._burst_project_session(main, tails)
                        last_sent = time.monotonic()

                for stem, tail in list(tails.items()):
                    prefix = stem[:8]
                    for ev in tail.poll():
                        ev["session"] = stem
                        ev["agent"] = f"{prefix}:{ev['agent']}"
                        self._send_event(ev)
                        last_sent = time.monotonic()
                    for ev in tail.check_timeouts():
                        ev["session"] = stem
                        ev["agent"] = f"{prefix}:{ev['agent']}"
                        self._send_event(ev)
                        last_sent = time.monotonic()

                if time.monotonic() - last_sent >= KEEPALIVE_SECS:
                    self._send_keepalive()
                    last_sent = time.monotonic()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            for stem, tail in tails.items():
                prefix = stem[:8]
                try:
                    for ev in tail.flush_pending():
                        ev["session"] = stem
                        ev["agent"] = f"{prefix}:{ev['agent']}"
                        self._send_event(ev)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError, OSError):
                    pass
            log.info(f"[disconnect] /api/stream?project={tid} client={addr}")

    # -- /api/vault ---------------------------------------------------------
    def handle_vault(self):
        addr = self.client_address[0]
        log.info(f"[connect] /api/vault client={addr}")
        self._sse_headers()
        snapshot = scan_vault(self.vault_dir)
        last_sent = time.monotonic()
        last_regen_version = _vault_regen_info["version"]
        try:
            while True:
                time.sleep(VAULT_POLL_SECS)
                new_snapshot = scan_vault(self.vault_dir)
                t_ms = int((time.time() - self.boot_ms) * 1000)
                changes = diff_vault(snapshot, new_snapshot, t_ms)
                for change in changes:
                    self._send_event(change)
                    last_sent = time.monotonic()
                if changes:
                    schedule_vault_regen()
                snapshot = new_snapshot

                if _vault_regen_info["version"] != last_regen_version:
                    last_regen_version = _vault_regen_info["version"]
                    self._send_event({"kind": "vault_index",
                                       "notes": _vault_regen_info["notes"],
                                       "links": _vault_regen_info["links"],
                                       "generated": _vault_regen_info["generated"]})
                    last_sent = time.monotonic()

                if time.monotonic() - last_sent >= KEEPALIVE_SECS:
                    self._send_keepalive()
                    last_sent = time.monotonic()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            log.info(f"[disconnect] /api/vault client={addr}")

    # -- /api/world -------------------------------------------------------
    def handle_world(self):
        try:
            payload = world_payload(self.vault_dir)
        except Exception as e:
            log.error(f"[error] /api/world: {e}")
            self.send_error(500, str(e))
            return
        self._send_json(redact_world(payload) if REDACT else payload)

    # -- /api/world/stream ------------------------------------------------
    def handle_world_stream(self):
        """Two kinds of message. `world` carries the towns whose live state
        changed since the last tick — that is the "state of the task at this
        moment" the map is for, and it is the only thing that ever changes a
        town's drone count. `pulse` is one message per tool call in any live
        session, which is what makes a town flicker between those ticks."""
        addr = self.client_address[0]
        log.info(f"[connect] /api/world/stream client={addr}")
        self._sse_headers()
        prev = {}            # town id -> the last state we told this client
        offsets = {}         # transcript path -> bytes already turned into pulses
        pending_pulses = {}  # tool_use_id -> (town id, since), for pulse/pulse_end
        pending_deletes = {}  # detect_deletions()'s dict, this connection's own
        known_paths = {}      # detect_deletions()'s other dict, ditto
        last_sent = time.monotonic()
        try:
            while True:
                payload = world_payload(self.vault_dir)
                changed = []
                seen = set()
                for t in payload["towns"]:
                    state = {"id": t["id"], "is_live": t["is_live"],
                             "live_agents": t["live_agents"], "now": t["now"]}
                    seen.add(t["id"])
                    if prev.get(t["id"]) != state:
                        prev[t["id"]] = state
                        changed.append(state)
                if changed:
                    self._send_event({"kind": "world", "towns": changed})
                    last_sent = time.monotonic()

                for _m, main, subs in live_sessions(time.time()):
                    rec = _load_index().get(main.as_posix())
                    cwd = rec["cwd"] if rec else ""
                    if not cwd or is_temp_cwd(cwd):
                        continue
                    tid = town_id(cwd)
                    if tid not in seen:
                        continue
                    for f in [main] + list(subs):
                        key = f.as_posix()
                        if key not in offsets:
                            # A file we have never tailed starts at its current
                            # end: its history is already in /api/world, and
                            # replaying it as pulses would flash a town that
                            # has been asleep for a week.
                            try:
                                offsets[key] = f.stat().st_size
                            except OSError:
                                offsets[key] = 0
                            continue
                        objs, offsets[key] = read_new_lines(f, offsets[key])
                        for obj in objs:
                            for ev in tool_pulses(obj, tid, pending_pulses,
                                                  pending_deletes, known_paths):
                                self._send_event(ev)
                                last_sent = time.monotonic()

                for ev in pulse_timeouts(pending_pulses):
                    self._send_event(ev)
                    last_sent = time.monotonic()

                if time.monotonic() - last_sent >= KEEPALIVE_SECS:
                    self._send_keepalive()
                    last_sent = time.monotonic()
                time.sleep(WORLD_STREAM_POLL_SECS)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            pass
        finally:
            log.info(f"[disconnect] /api/world/stream client={addr}")

    def _send_text(self, text, content_type="text/plain; charset=utf-8"):
        """One short body, for the redaction notices that stand in for a
        file's contents and for an html page's preview."""
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- /api/sessions --------------------------------------------------
    def handle_sessions(self):
        try:
            sessions = list_recent_sessions(10)
        except Exception as e:
            self.send_error(500, str(e))
            return
        if REDACT:
            sessions = redact_sessions(sessions)
        body = json.dumps(sessions, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- /api/project -------------------------------------------------------
    def handle_project(self, query):
        tid = query.get("id", [None])[0]
        if not tid:
            self.send_error(400, "missing id")
            return
        since = query.get("since", [None])[0]
        try:
            body = project_replay_json(tid, self.vault_dir, since)
        except Exception as e:
            log.error(f"[error] /api/project id={tid}: {e}")
            self.send_error(500, str(e))
            return
        if body is None:
            self.send_error(404, f"no town {tid}")
            return
        if REDACT:
            # Re-parsed rather than redacted inside build_project_replay():
            # that result is what the 10s _project_cache holds, and the cache
            # is also read by cached_build_replay()'s per-session entries on
            # disk. Paid only in redact mode, and replay.js fetches this once
            # per page load, not on a poll.
            body = json.dumps(redact_project(json.loads(body)),
                              ensure_ascii=False).encode("utf-8")
        # Only when the client actually asked for it -- `curl` and the probe
        # harness do not send Accept-Encoding, and they must keep getting
        # plain JSON. Chrome always does, so the page always gets the 6x.
        encoding = None
        if "gzip" in (self.headers.get("Accept-Encoding") or ""):
            try:
                body = project_replay_gzip(tid, since, body)
                encoding = "gzip"
            except Exception:
                log.exception("gzip of /api/project failed; sending plain")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if encoding:
            self.send_header("Content-Encoding", encoding)
            self.send_header("Vary", "Accept-Encoding")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        # Written in chunks, not one wfile.write() of the whole body -- some
        # towns are 25k+ tool calls / tens of MB, and streaming it out lets
        # the OS interleave the transfer instead of blocking on it whole.
        for i in range(0, len(body), 65536):
            self.wfile.write(body[i:i + 65536])

    # -- /api/recordings ----------------------------------------------------
    def handle_recordings(self):
        """Every finished film on disk, newest first — one row per sidecar
        JSON. Read straight off the folder rather than from a database: the
        files ARE the state, so deleting an mp4 removes its row and dropping
        the folder resets the shelf."""
        try:
            rows = rc.list_recordings(RECORDINGS_DIR)
        except Exception as e:
            log.error(f"[error] /api/recordings: {e}")
            self.send_error(500, str(e))
            return
        # `pending` is null until the recorder's first scan has finished — the
        # shelf says "not scanned yet" rather than claiming a queue of zero.
        cands = cached_recording_candidates()
        done = {r.get("session_id") for r in rows}
        pending = (None if cands is None
                   else sum(1 for c in cands if c["session_id"] not in done))
        if REDACT:
            rows = redact_recordings(rows)
        self._send_json({"recordings": rows, "pending": pending})

    # -- /recordings/<project>/<file>.mp4, with Range ------------------------
    def serve_recording_range(self, path):
        """One byte range out of one recording. Returns False when this is not
        a real file under recordings/, so the caller falls through to the
        normal static path (which then 404s in one place, not two)."""
        root = RECORDINGS_DIR.resolve()
        try:
            p = (root / path[len("/recordings/"):]).resolve()
            p.relative_to(root)
        except (ValueError, OSError):
            return False
        if not p.is_file():
            return False
        size = p.stat().st_size
        rng = self.headers.get("Range", "")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m or (not m.group(1) and not m.group(2)):
            return False                     # multi-range and friends: let the whole file answer
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start, end = max(0, size - int(m.group(2))), size - 1   # bytes=-N, the tail
        if start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return True
        end = min(end, size - 1)
        self.send_response(206)
        self.send_header("Content-Type", RECORDING_TYPES.get(p.suffix.lower(),
                                                             "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        remaining = end - start + 1
        with p.open("rb") as f:
            f.seek(start)
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)
        return True

    # -- /api/project/meta ------------------------------------------------
    def handle_project_meta(self, query):
        tid = query.get("id", [None])[0]
        if not tid:
            self.send_error(400, "missing id")
            return
        try:
            meta = project_meta(tid, self.vault_dir)
        except Exception as e:
            log.error(f"[error] /api/project/meta id={tid}: {e}")
            self.send_error(500, str(e))
            return
        if meta is None:
            self.send_error(404, f"no town {tid}")
            return
        self._send_json(redact_meta(meta) if REDACT else meta)

    # -- /api/project/asset ------------------------------------------------
    def handle_project_asset(self, query):
        tid = query.get("id", [None])[0]
        rel = query.get("f", [None])[0]
        if not tid or not rel:
            self.send_error(400, "missing id or f")
            return
        if REDACT:
            # A favicon is a logo is a client. redact_town()/redact_meta()
            # already drop the url that points here; this closes the route
            # itself, since the url is guessable from a town id.
            self.send_error(403, "redacted")
            return
        try:
            path = resolve_asset_path(tid, rel, self.vault_dir)
        except Exception as e:
            log.error(f"[error] /api/project/asset id={tid} f={rel!r}: {e}")
            self.send_error(500, str(e))
            return
        if path is None:
            self.send_error(403, "forbidden")
            return
        try:
            size = path.stat().st_size
            if size > MAX_ASSET_BYTES:
                self.send_error(403, "too large")
                return
            data = path.read_bytes()
        except OSError:
            self.send_error(404, "not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", ASSET_CONTENT_TYPES[path.suffix.lower()])
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- /api/project/file ---------------------------------------------------
    def handle_project_file(self, query):
        tid = query.get("id", [None])[0]
        rel = query.get("f", [None])[0]
        raw = query.get("raw", [None])[0] == "1"
        if not tid or not rel:
            self.send_error(400, "missing id or f")
            return
        if REDACT:
            # interior.js dresses a building's walls with this text, 66 lines
            # to a floor. A notice keeps the room built and readable as a
            # room -- a 403 here would put a fault message on the wall and
            # read as a broken build rather than a deliberate one.
            self._send_text(REDACTED_FILE_NOTICE)
            return
        try:
            path = resolve_project_file_path(tid, rel, self.vault_dir)
        except Exception as e:
            log.error(f"[error] /api/project/file id={tid} f={rel!r}: {e}")
            self.send_error(500, str(e))
            return
        if path is None:
            self.send_error(403, "forbidden")
            return
        rel_norm = rel.replace("\\", "/")
        if raw and path.suffix.lower() in RAW_HTML_EXTENSIONS:
            # The old <base href="...asset?id=...&f=..."> splice ended in a
            # QUERY, so a relative styles.css resolved to
            # /api/project/styles.css -- RFC 3986 drops the query and
            # replaces the last path segment (docs/HANDOFF.md item 10). The
            # tree route is path-shaped, so a page served from there resolves
            # its own relative urls() with no rewriting at all.
            tree_url = f"{TREE_PATH_PREFIX}{quote(tid)}/{quote(rel_norm)}"
            self.send_response(302)
            self.send_header("Location", tree_url)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        try:
            size = path.stat().st_size
            if size > MAX_PROJECT_FILE_BYTES:
                self._send_json({"bytes": size}, status=413)
                return
            data = path.read_bytes()
        except OSError:
            self.send_error(404, "not found")
            return
        if b"\x00" in data:
            self.send_error(415, "binary file")
            return
        text = data.decode("utf-8", errors="replace")
        body = er.redact(text).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- /api/project/tree/<town>/<path> -------------------------------------
    def handle_project_tree(self, rest):
        rest = unquote(rest)
        if "/" not in rest:
            self.send_error(400, "missing path")
            return
        if REDACT:
            # This route serves a project's own html, css and images to the
            # window inside a building -- i.e. the client's actual page.
            self._send_text(REDACTED_HTML_NOTICE, "text/html; charset=utf-8")
            return
        tid, rel = rest.split("/", 1)
        try:
            result = resolve_project_tree_path(tid, rel, self.vault_dir)
        except Exception as e:
            log.error(f"[error] /api/project/tree id={tid} f={rel!r}: {e}")
            self.send_error(500, str(e))
            return
        if result is None:
            self.send_error(403, "forbidden")
            return
        path, content_type = result
        try:
            size = path.stat().st_size
            if size > MAX_TREE_BYTES:
                self.send_error(403, "too large")
                return
            data = path.read_bytes()
        except OSError:
            self.send_error(404, "not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if path.suffix.lower() in RAW_HTML_EXTENSIONS:
            self.send_header("Content-Security-Policy", PROJECT_FILE_CSP)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # -- /api/vault/search ----------------------------------------------------
    def handle_vault_search(self, query):
        q = query.get("q", [""])[0]
        if REDACT:
            self._send_json([])   # note titles are prose; see /data/vault.json above
            return
        try:
            results = vault_search(self.vault_dir, q)
        except Exception as e:
            log.error(f"[error] /api/vault/search q={q!r}: {e}")
            self.send_error(500, str(e))
            return
        self._send_json(results)

    # -- /api/vault/note --------------------------------------------------
    def handle_vault_note(self, query):
        note_id = query.get("id", [None])[0]
        if not note_id:
            self.send_error(400, "missing id")
            return
        if REDACT:
            self._send_text(REDACTED_FILE_NOTICE)
            return
        path = resolve_vault_note_path(note_id, self.vault_dir)
        if path is None:
            self.send_error(403, "forbidden")
            return
        if not path.is_file():
            self.send_error(404, "not found")
            return
        if query.get("meta", [None])[0] == "1":
            self._send_json(vault_note_meta(note_id) or {"id": note_id})
            return
        try:
            size = path.stat().st_size
            if size > MAX_VAULT_NOTE_BYTES:
                self._send_json({"bytes": size}, status=413)
                return
            data = path.read_bytes()
        except OSError:
            self.send_error(404, "not found")
            return
        body = er.redact(data.decode("utf-8", errors="replace")).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class LiveHTTPServer(ThreadingHTTPServer):
    """A0 (docs/TESTS.md): `ThreadingHTTPServer`'s default `allow_reuse_address
    = True` sets `SO_REUSEADDR`, which on Windows (unlike POSIX, the meaning
    the Python docs assume) lets a second, unrelated process bind the same
    port with no error -- three `server.py` processes were found listening
    on 4949 at once, silently. Turning that flag off is the first half;
    `SO_EXCLUSIVEADDRUSE` in `server_bind()` is the second, since it is
    Windows' own mechanism for refusing a duplicate bind outright rather than
    relying on `SO_REUSEADDR` staying unset everywhere."""
    allow_reuse_address = False

    def server_bind(self):
        if sys.platform == "win32":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def _find_listener_pid(port):
    """Best-effort PID of whatever already holds `port`'s listening socket,
    for the one-line refusal message below. Shells out to `netstat` (stdlib
    `subprocess`) rather than adding a psutil dependency for one lookup."""
    try:
        out = subprocess.run(["netstat", "-ano"], capture_output=True,
                              text=True, timeout=5).stdout
        for line in out.splitlines():
            parts = line.split()
            if (len(parts) >= 5 and parts[0] == "TCP" and parts[3] == "LISTENING"
                    and parts[1].rsplit(":", 1)[-1] == str(port)):
                return parts[4]
    except Exception:
        pass
    return "unknown"


def _load_auth_creds():
    """(user, password) from AUTH_SECRETS_PATH, or None if the file is
    absent/unreadable -- auth is opt-in, gated on that file existing at all
    (docs/RUNBOOK.md phone access setup)."""
    try:
        data = json.loads(AUTH_SECRETS_PATH.read_text(encoding="utf-8"))
        return (data["user"], data["password"])
    except (OSError, KeyError, ValueError):
        return None


def _install_windows():
    """`python server.py --install-windows` -- the desktop shortcut, the
    logon autostart and the screensaver watcher, via launcher/install.ps1.

    Opt-in and nothing else: registering scheduled tasks and writing to
    somebody's Desktop is not a thing a server should do because it was
    started. Returns a process exit code, so main() can hand it to sys.exit."""
    if sys.platform != "win32":
        print("--install-windows is Windows-only. The systemd and launchd\n"
              "equivalents are in docs/RUNBOOK.md.", file=sys.stderr)
        return 2
    script = SCRIPT_DIR / "launcher" / "install.ps1"
    if not script.is_file():
        print(f"not found: {script}", file=sys.stderr)
        return 2
    # Windows PowerShell 5.1 by absolute path: that is the interpreter every
    # script under launcher/ is written for, and `powershell` on PATH can be
    # something else entirely.
    ps = Path(os.environ.get("WINDIR", r"C:\Windows"),
              "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return subprocess.call([str(ps), "-NoProfile", "-ExecutionPolicy", "Bypass",
                            "-File", str(script)])


def _open_browser_when_up(url, port, host):
    """Open the default browser on globe.html, once, after the listener is
    actually accepting -- opening it before serve_forever() gets a connection
    refused page often enough to be worth the three lines."""
    for _ in range(40):                       # 40 x 0.25s = 10s, then give up
        try:
            with socket.create_connection((host, port), 0.25):
                break
        except OSError:
            time.sleep(0.25)
    else:
        return
    try:
        webbrowser.open(url)
    except Exception:                          # a headless box has no browser
        log.info("no browser could be opened; go to %s", url)


def _assets_unpacked():
    """Whether assets/ holds a library rather than just its index. Three files,
    one per kind, and not all ninety: this runs on the startup path."""
    base = SCRIPT_DIR / "assets"
    try:
        manifest = json.load(open(base / "manifest.json", encoding="utf-8"))
    except Exception:
        return False
    for key in ("grass", "hdriDusk", "model.hy.car"):
        rec = manifest.get(key) or {}
        rel = rec.get("path") or rec.get("diffuse")
        if not rel or not (base / rel).exists():
            return False
    return True


def main():
    ap = argparse.ArgumentParser()
    # config.json holds the settings; the flags are the one-off override.
    ap.add_argument("--port", type=int, default=int(CONFIG.get("port") or 4949))
    ap.add_argument("--vault", default=str(VAULT_DIR) if VAULT_DIR else "")
    ap.add_argument("--debug", action="store_true",
                     help="log _build_world_payload()'s per-tick cost at DEBUG level")
    ap.add_argument("--redact", action="store_true",
                     help="pseudonymise every project, file, session and task "
                          "name before it leaves this process (config.json: "
                          "\"redact\": true makes it permanent)")
    ap.add_argument("--no-browser", action="store_true",
                     help="do not open a browser window on start")
    ap.add_argument("--install-windows", action="store_true",
                     help="Windows only: run launcher/install.ps1 (desktop "
                          "shortcut, autostart, screensaver watcher) and exit. "
                          "Never happens on its own -- this flag is the opt-in.")
    args = ap.parse_args()
    if args.install_windows:
        sys.exit(_install_windows())
    if args.redact:
        # A flag, not an edit: the config file is the setting and this is the
        # one-off override, the same relationship --port and --vault have.
        global REDACT
        REDACT = True
    # Always log to launcher/server.log (rotated 5MB x3) so the server has
    # somewhere to write when launched via pythonw.exe, whose sys.stdout and
    # sys.stderr are None -- a plain logging.basicConfig() StreamHandler
    # would try to write to that None stream and raise. Add a console
    # handler too, but only when a real terminal is attached.
    log_fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    handlers = [RotatingFileHandler(SCRIPT_DIR / "launcher" / "server.log",
                                     maxBytes=5 * 1024 * 1024, backupCount=3,
                                     encoding="utf-8")]
    if sys.stdout is not None and sys.stdout.isatty():
        handlers.append(logging.StreamHandler())
    for h in handlers:
        h.setFormatter(log_fmt)
    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO,
                         handlers=handlers)

    # THE VAULT IS OPTIONAL and this is where that is decided. With no vault
    # configured, vault_dir points at a directory that does not exist rather
    # than at None: every `vault_dir / "Boards"`, `.is_dir()` and `.rglob()`
    # downstream then answers "nothing here" instead of raising, and the two
    # export threads below -- the only code that would WRITE using it -- are
    # not started at all. The globe and the island run unchanged; they simply
    # have no `knowledge` continent and no notes.
    vault_dir = Path(args.vault).expanduser() if args.vault else None
    Handler.vault_dir = vault_dir or (SCRIPT_DIR / "data" / "_no_vault")
    Handler.boot_ms = time.time()
    Handler.auth_creds = _load_auth_creds()
    set_vault_dir(args.vault)  # must run before any transcript is scanned
    if vault_dir:
        # export_vault.py is imported, not copied, so its module-level root is
        # the one place the configured path has to land.
        ev.VAULT_ROOT = vault_dir
        threading.Thread(target=ensure_vault_json_fresh, args=(vault_dir,),
                          daemon=True).start()
    threading.Thread(target=_prewarm_project_replay_cache, args=(Handler.vault_dir,),
                      daemon=True).start()
    # H4 fix: fills the persistent trade cache augment_world_trade() reads
    # from, once at boot and every TRADE_PREWARM_INTERVAL_SECS after -- see
    # the module comment above _trade_cache.
    threading.Thread(target=_prewarm_trade_cache, args=(Handler.vault_dir,),
                      daemon=True).start()
    # Build /api/world's two caches BEFORE anyone asks for them (task B). The
    # first build after a restart is the expensive one -- 6.6s measured, with
    # the transcript index cold -- and world_static()'s stale-while-revalidate
    # can only serve a stale snapshot if a snapshot exists. Without this the
    # first person to open globe.html after a logon is the one who pays it.
    # A daemon thread, not an inline call: the listener must come up
    # immediately, and a page loading its 100 MB of assets meanwhile has
    # seconds of work to do before it asks for /api/world at all.
    #
    # The 5 s head start is not padding. build_world_static() holds
    # `_index_lock` end-to-end (refresh_index's own docstring says why), so
    # while it runs, /api/sessions -- which needs the same lock -- blocks.
    # Started at t=0 it made launcher/restart-server.ps1's verification poll
    # (2 s timeout, 500 ms apart) time out for the whole build and report the
    # restart as FAILED. Five seconds lets the health check through first, and
    # still leaves the cache warm long before any page gets past its assets.
    def _prewarm_world():
        time.sleep(5)
        world_payload(Handler.vault_dir)

    threading.Thread(target=_prewarm_world, daemon=True).start()

    # The recorder: one film at a time, only while nobody is working, and only
    # for sessions that have been silent for ten minutes. It waits a minute of
    # its own before the first look, because the page it screenshots is served
    # by the listener started below. Turning it off is one env var --
    # docs/RUNBOOK.md, "Recordings".
    if os.environ.get("WERKSTADT_NO_RECORDER") != "1":
        rc.start(RECORDINGS_DIR, RECORDER_WORK_DIR, args.port,
                 recording_candidates,
                 lambda: recorder_busy(Handler.vault_dir))

    try:
        httpd = LiveHTTPServer((CONFIG.get("host") or "127.0.0.1", args.port), Handler)
    except OSError:
        pid = _find_listener_pid(args.port)
        print(f"port {args.port} already has a listener (pid {pid}) - not starting",
              file=sys.stderr)
        sys.exit(2)
    host = CONFIG.get("host") or "127.0.0.1"
    url = f"http://{host}:{args.port}/globe.html"
    log.info(f"werkstadt server on http://{host}:{args.port}/  "
             f"(vault: {args.vault or 'off'}, redact: {'on' if REDACT else 'off'})")
    # print(), not log.info(): under pythonw.exe the log goes to a file and
    # there is nobody to read a line anyway, but from a terminal the URL is
    # the one thing a first-time reader needs and it must not depend on the
    # log level.
    if sys.stdout is not None and sys.stdout.isatty():
        print(f"Werkstadt is at {url}   (Ctrl-C to stop)")
        # The asset library is not in git -- it is 100 MB of textures, HDRIs and
        # models attached to the release instead (see .gitignore). Without it
        # the pages still open and still draw, but the ground is untextured and
        # the streets are empty, and a first-time reader has no way to know that
        # is a missing download rather than the thing itself. One line beats
        # four pages of 404s.
        if not _assets_unpacked():
            print("assets/ is not unpacked - the world will render untextured "
                  "and empty.\n"
                  "  python assets/fetch_assets.py --release   (the release "
                  "zip, ~20 s)\n"
                  "  python assets/fetch_assets.py             (rebuilt from "
                  "source, ~8 min)")
    if not args.no_browser:
        threading.Thread(target=_open_browser_when_up,
                          args=(url, args.port, host), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

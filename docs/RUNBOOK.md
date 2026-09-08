# Runbook — werkstadt

_Verified: 2026-09-08_
_data/vault.json auto-regen (startup freshness check + 30s-debounced re-export on vault change, atomic write, vault_index SSE event) — see "Live mode — the server" above and HANDOFF VAULT-FRESH-DOC: 2026-09-07_
_Access from another device — the Basic Auth secrets file format and the
five-curl auth check; see "Access from another device" below: 2026-09-07_
_Globe round 6 — the GLOBE-R6-RUN section: the `?mobile=1` / `?mobile=0` / `?persist=0` flags, the six new probes, the four re-taken shots, the touch-emulation recipe and the QR decode check: 2026-09-06_
_The island pass — `world-harbour.png` re-composed, `world-mobile.png` added, the LOD1 night gate moved to 200 m, `__printed()`/`__vehicles()` probes: 2026-09-06_
_Touch controls and `?mobile=1` on `index.html` — see "Touch — index.html only" below and HANDOFF's TOUCH-MOBILE-DOC for the measured numbers: 2026-09-06_
_Launcher: `restart-server.ps1` + the on-demand `Werkstadt-Restart` task replace the manual port-kill for reloading code — run twice against the real server, one listener and one `/api/sessions` 200 after each: 2026-09-06_
_Globe round 4 — the living layer, the fleet and live prints on the planet; A/B against `?life=0&drones=0` on a QUIET machine reads 56-57 fps at all five poses, gate met: 2026-09-06_
_Print flash clamped + exponential cool-down, big-town tag floor fixed (`MAX_TAG_GROWTH` 6→12, see `__print().flash` above): verified 2026-09-06_
_The island's houses are buildings.js (kit town, LOD shell, prop shell, globe link) — shots re-taken and interiors re-verified with REAL input; the FPS GATE COULD NOT BE READ on a machine carrying four other agents' browser fleets, see "The frame rate after the kit town": 2026-09-06_
_Launcher: globe.html made the top-level page (settings.json "page", globe -> world -> index chain in open.ps1 and screensaver-watch.ps1) verified: 2026-09-06_
_Globe realism pass (coasts, ground splat, rivers, the ocean, BuildingKit settlements, forests, street level, the vault's notes) verified: 2026-09-06_
_The four interiors that are not the hall (note galleries, bridge decks, lighthouse climbs, page wings) verified with REAL input: 2026-09-06_
_Giant drone/agent labels fixed, HARBOUR_VIEW moved off the misclassified site-editor landmark, __landmarkAt() added: 2026-09-06_
_City polish (framing, tower heights, page window, room fixtures, __selfcheck) verified: 2026-09-06_
_Walkable landmark interiors on world.html (enterHall, __enterLandmark) verified: 2026-09-06_
_Navigation (free fly, zoom range, pan, enter-anything, help card) verified with real CDP input: 2026-09-06_
_Materialisation pass — print duration, the print cue, `?demo=print`, `P`, the three print shots: 2026-09-06_
_The island is alive — `life.js` populated from the real counts, ORNIS craft over the live quarters, live files materialise as buildings; four world shots re-taken, console 0, `?life=0` / `?drones=orbs` A/B kept: 2026-09-06_

## Run it

```
cd werkstadt
python server.py
```

Open <http://127.0.0.1:4949/>. The host and the port come from `config.json`,
which `server.py` writes from `config.example.json` the first time it runs;
`127.0.0.1` and `4949` are the shipped defaults, and `--port` overrides the file
for one run. If something is already listening on the port from another session,
reuse it: it serves this same folder. `python -m http.server 4949` also serves
the static pages, but nothing that needs `/api/*` will work behind it.

`python server.py` with no arguments does four things: writes `config.json` if it
is missing, prints its own URL, starts listening, and opens `globe.html` in the
default browser once the socket is actually accepting. `--no-browser` suppresses
only the last of those — use it for a headless box, a second instance, or any
automated run.

**Python 3.9 or newer**, checked at import: below that `server.py` exits with one
line naming the version it found instead of a stack trace out of the standard
library. Tested here on 3.9.13 and 3.12.10. Nothing in the tree uses a `match`
statement, an `X | Y` annotation or `fromisoformat`'s `Z`, which are what would
push the floor to 3.10 or 3.11.

### The flags

| flag | what it does |
|---|---|
| `--port N` | listen on N instead of `config.json`'s `port` |
| `--vault <path>` | the Obsidian layer, for this run only |
| `--redact` | pseudonymise every name on the way out — see "Redaction" below |
| `--no-browser` | do not open a browser window |
| `--install-windows` | run `launcher/install.ps1` and exit (Windows only) |
| `--debug` | log `_build_world_payload()`'s per-tick cost |

### Autostart

**Windows** is the only platform with an installer, and it is opt-in:

```
python server.py --install-windows
```

which runs `launcher/install.ps1` — desktop shortcut, the `Werkstadt-Server` and
`Werkstadt-Screensaver` logon tasks, and the on-demand `Werkstadt-Restart` task.
Nothing in that list happens because the server was started; see "Launcher &
screensaver" below for what each piece does and `launcher/uninstall.ps1` to undo
it.

**macOS and Linux have no installer.** The two units below are written from the
code rather than from a run — **untested on this machine**, which only has
Windows. Both assume the checkout is at `~/werkstadt` and a `python3` on `PATH`.

*Linux — `~/.config/systemd/user/werkstadt.service`, then
`systemctl --user enable --now werkstadt`:*

```ini
[Unit]
Description=Werkstadt
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/werkstadt
ExecStart=/usr/bin/python3 %h/werkstadt/server.py --no-browser
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

*macOS — `~/Library/LaunchAgents/at.wildmoments.werkstadt.plist`, then
`launchctl load ~/Library/LaunchAgents/at.wildmoments.werkstadt.plist`:*

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>at.wildmoments.werkstadt</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>/Users/YOU/werkstadt/server.py</string>
    <string>--no-browser</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/werkstadt</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

`--no-browser` is in both on purpose: a service that opens a window at login is
a surprise, and `launcher/open.ps1` is the Windows equivalent of "and now show
me it".

One thing that will differ off Windows and is not guessed at here: `server.py`
logs to `launcher/server.log` through a `RotatingFileHandler`, which is fine
anywhere, but `launcher/*.ps1`, the scheduled tasks, the Lively wallpaper entry
and `_find_listener_pid()`'s `netstat -ano` are all Windows-shaped. The server
itself runs; the launcher chain does not.

## Redaction

`"redact": true` in `config.json`, or `--redact` for one run. Every project name,
session title, file path, drone task tag and agent label leaves the server as a
stable pseudonym instead of itself.

Where it happens, so it can be re-checked: `server.py`'s `REDACTION` section
holds the pseudonym helpers, and the call sites are `_send_event()` (the single
writer for all four SSE feeds), `handle_world`, `handle_sessions`,
`handle_project`, `handle_project_meta`, `handle_recordings`,
`handle_client_config`, the two file routes, the vault routes, and
`_build_recording_candidates()` — that last one is what makes a film recorded
under redaction pseudonymous in its own MP4 filename and title card.

To verify it after a change, start a server and grep its own answers:

```
python server.py --port 4952 --redact --no-browser
curl -s "http://127.0.0.1:4952/api/world"   | grep -c "$USER"    # -> 0
curl -s "http://127.0.0.1:4952/api/sessions" | grep -c "$USER"   # -> 0
```

What is deliberately NOT hidden: tool names (`Bash`, `Read`, an MCP server's
name), timestamps, counts, and the `path_contains` fragments out of your own
`continents` rules — a redacted town path reads `~/projects/town-3f9a`, because
`globe.js` needs that fragment to put the town on the right continent and the
fragment is one you wrote in `config.json`, not a name off your disk.

Opening `index.html` straight off disk does **not** work, for two reasons now:
`fetch` of a local `.json` is blocked by the browser's `file://` origin rules, and
`replay.js` is an ES module, which `file://` will not load either. Always serve
the folder.

## Which file it replays

1. `?src=<url>` if present
2. `?project=<town>` — the whole project, from `GET /api/project?id=`
3. `?session=<uuid>` — one session, live
4. `?live=1` — the session being worked in right now, resolved to its **town**
   through `/api/sessions` and then loaded as a project
5. `data/demo.json`
6. `data/sample.json` (the hand-written dev fixture)

```
http://127.0.0.1:4949/                             # the exported session
http://127.0.0.1:4949/?src=data/sample.json        # the fixture
http://127.0.0.1:4949/?src=data/sample-project.json# the PROJECT fixture, 3 streets
http://127.0.0.1:4949/?project=cb09014b            # a real town — werkstadt's own
http://127.0.0.1:4949/?camera=fixed                # no auto-orbit — for screenshots
http://127.0.0.1:4949/?live=1                      # live; becomes project mode by itself
http://127.0.0.1:4949/?session=<uuid>              # one session, live, one street
http://127.0.0.1:4949/archive/tree/                # the 2D version this replaced
```

**A city is a project; a street is a session.** Whatever the door, a payload
carrying a top-level `streets` array renders as a town of avenues, and anything
else renders as a town with exactly one. Town ids come from `/api/sessions`
(each row now carries `town`) — `curl http://127.0.0.1:4949/api/sessions`.

## Controls

Both pages — `index.html` (the session city) and `world.html` (the island) —
carry the same navigation. The transport keys are the city's only.

| key / gesture | does | where |
|---|---|---|
| drag | orbit by hand; pauses the automatic orbit for 20 s | both |
| scroll | zoom. 0.22 a notch, scaled by the event's own `deltaY` so a trackpad stays proportional | both |
| **right-drag** / middle-drag | **pan** — moves the orbit's own aim point, which is what makes a corner reachable at all | both |
| `W` `A` `S` `D` | glide the aim over the ground (world) | world |
| **`F`** | **free fly on/off** — see below | both |
| **double-click** | **go inside whatever is under the pointer**, with no arming click | both |
| click, then click again (or `Enter`) | the older two-step: read the caption, then go in | both |
| `Esc` | close the caption; inside a structure, leave it | both |
| `O` | open the note you are standing in, in Obsidian | world |
| `/` | the address search | world |
| `Q` | render quality high / medium (free fly takes `Q` for "down") | world |
| **`H`** | **the help card again**, six seconds | both |
| `space` | pause / resume | city |
| `←` `→` | jump back / forward 10 s (rebuilds the city at that instant) | city |
| `[` `]` | speed down / up through 0.5× · 1× · 2× · 4× | city |
| `L` | live-follow on/off — on means the clock chases the newest event | city |
| **`P`** | **replay the last materialisation** — the print plane runs again over a shell that already stands. Visual only: no event, no floor, no clock | city |

### Touch — `index.html` only

| gesture | does |
|---|---|
| one-finger drag | orbit — the same drag code a mouse runs |
| two-finger pinch | zoom |
| two-finger twist | rotate the orbit |
| tap | select (arm) a building |
| double-tap | go straight in |
| long-press | show the caption without arming it — touch has no hover |
| inside, left-half drag | move (synthesised WASD) |
| inside, right-half drag | look (synthesised mouse-drag-look) |
| inside, two-finger tap | leave — the same as `Esc` |
| swipe the ticker | ±10 s, the same as `←`/`→` |
| the mono play/pause glyph | the same as `space` — shown only on a coarse pointer |

`?mobile=1`, or an auto-detected coarse pointer, also switches on a lighter
quality preset (half-res bloom, an 8-craft worker cap, a shorter light trail)
and a `body.mobile-mode` chrome (bottom-sheet hints, one-line ticker, a scaled
masthead). See HANDOFF's "Touch controls and a mobile preset" for the code map
and the measured numbers.

### Free fly — `F`

The orbit is a camera on a string: it always looks at one solved point and always
stands the fitted distance back, so there are corners it cannot be put in. `F`
cuts the string.

| in free fly | does |
|---|---|
| `W` `A` `S` `D` | move in the direction the lens looks |
| `Q` / `E` | straight down / straight up |
| `shift` | four times the speed |
| mouse | look. Pointer lock is asked for on the first click; **refused over CDP**, and drag-look takes over — that is the path a screenshot harness uses |
| `F` | back to the orbit, eased over 0.7 s onto the exact pose you left |

Speed scales with height over the ground — fast in the sky, slow enough at a
doorway to stop at it — and never falls under **0.3 units/s**. The only collision
is the ground: `FREE_EYE` (1.7) above the terrain on `world.html`, above the
ground plane in the city. Everything else is flown through on purpose.
A one-line HUD (`#free-hud`) says `free · WASD QE · shift fast · F back`, and it
is the only thing on screen that changes.

### The zoom range

`CAM_NEAR` / `CAM_FAR` / `CAM_FLOOR` in `world.js`, `ZOOM_MIN` / `ZOOM_MAX` /
`CAM_NEAR` / `CAM_FLOOR` in `city.js`. Read together they say: the whole map
down to **two units above the ground**. Two things had to move for that to be
true and neither is guessable —

- **The aim point's own lift.** It was a flat 4 (world) / 42% of the city's
  height (city), which is right for the wide shot and is exactly why the wheel
  used to bottom out at a first-floor window: the lens sits above an aim that is
  already up there. Both are now capped by the distance, so the wide shot is
  untouched (the cap is far above the lift at any real fitted distance) and a
  close orbit comes down to eye level.
- **Whose ground.** Fully zoomed in, `world.js` rides the terrain **under the
  lens** rather than under the aim (`cam.dist < 12`). On a slope those differ by
  more than the zoom's whole remaining travel, which is how the same fully
  zoomed-in shot measured 4.4 m up on one side of a rise and 2.0 on the other.

### Going inside anything

Nothing on either page is a dead end any more.

| you double-click | you get |
|---|---|
| a trade landmark | its own hall, dressed as its trade (`HALL_DRESS`) |
| a vault house, a bridge, a lighthouse, a fortress wall | a plain room (`HALL_PLAIN`) whose board carries that structure's caption verbatim, and `O` for its Obsidian address |
| a sleeping project quarter | the same plain room, carrying the project's own counts |
| a LIVE project quarter | still flies down into its session city — a richer inside than any room this page could build |
| a building, a district plate, a street sign (city) | the file room, the lobby, the hall of records, unchanged |

**As of 2026-09-06 there IS a note-TEXT endpoint (`GET /api/vault/note`, see
"Live mode — the server" above) but the room does not use it yet** — wiring a
vault room to fetch and show it is a separate front-end job. `/api/vault` is a
change stream and `/api/vault/search` returns one matched line per note, so
today a vault room shows the caption it can prove — words, inlinks, when it
was written — plus the `obsidian://` door on `O`. `enterGeneric()` in
`world.js` is where that decision lives.

The help card is every control on one line: six seconds on the first visit per
browser, and again whenever `H` is pressed. To get the first-visit one back:
`localStorage.removeItem('werkstadt.hints-seen')` (city) /
`localStorage.removeItem('werkstadt.world-hints')` (world).

**A centring transform on the hints card does not survive its own animation.**
`rise-in`'s to-state is `transform: none`, so `translateX(-50%)` is wiped the
moment the animation ends and the card lands a hundred-odd pixels off centre.
Both cards are centred by `left: 0; right: 0; text-align: center` instead. Do not
put the transform back.

### Going inside a building

| you do | it does |
|---|---|
| hover a building | a thin gold rim on its edges, and its path under the cursor |
| click it | arms it — the rim stays, and the caption says "click again to enter" |
| click again, or `Enter` | the camera flies to the door, the facade dissolves, you are inside |
| `W` `A` `S` `D` | glide, in the direction you are looking. No gravity: look up and hold `W` and you rise |
| `space` / `shift` | straight up, straight down |
| drag the mouse | look around. Pointer lock is asked for once; if the browser refuses it, drag-look takes over for the rest of the visit |
| glide into the gold column | the lift — it is the way to the floor above |
| `Esc`, or walk out of the door | back to the city, on the exact frame you left |

A district's caption and a street sign are clickable too: the caption opens that
folder's lobby (one door per file), the sign opens that session's hall of
records. While you are inside, the transport keys are off — `W` is a step, not a
letter, and `space` is up rather than pause.

## Capture screenshots

Chrome's `--virtual-time-budget` is **not** usable here — it races the page's
`fetch` of the replay file and produces a booted-but-frozen page that looks like a
stalled clock. Drive real Chrome over CDP with real wall-clock waits instead.
Node 24 has a built-in `WebSocket`, so this needs no packages:

```
chrome.exe --headless=new --remote-debugging-port=9333 \
           --window-size=1440,900 --enable-unsafe-swiftshader \
           --user-data-dir=%TEMP%\cdp-profile-cl about:blank
```

then `Page.navigate`, `Emulation.setDeviceMetricsOverride` to 1440×900, wait in
real wall time, and `Page.captureScreenshot`. The harness used for `docs/shots/`
is about seventy lines and lives in the scratchpad, not in this repo — it is
quicker to rewrite than to maintain. It also subscribes to `Runtime.enable` and
`Log.enable` and prints the console-error count, which is how the "zero errors"
claim is made.

Two of the reference shots cannot be taken on a stopwatch: a print lasts 1.2 s
and a derez under half of one, and neither happens at a time you can predict. The
harness therefore takes an optional **until-expression**: after the wall-clock
wait it polls that expression every 40 ms and screenshots the moment it is true.
`__printing() > 0` catches `city-print.png`, `__derezzing() > 0` catches
`city-derez.png`.

Three traps, all of which cost time here:

- **Do not share a debugging port with another session.** Two agents working in
  this repo at once both reused the page target on 9333; the second one navigated
  it to `world.html`, and `city-240.png` came back as a screenshot of somebody
  else's page with 26 console errors that belonged to it. Launch Chrome on a port
  and a `--user-data-dir` of your own, and check `/json/list` says the tab is
  still on your URL before believing a capture.

- **MSYS/Git-Bash rewrites paths inside arguments to `node` and `chrome.exe`.** A
  `$PWD` output directory silently became `\tmp\claude\…`; the command returned 0
  and wrote the PNGs somewhere else. Pass absolute `C:/…` paths and prefix the
  command with `MSYS_NO_PATHCONV=1`.
- **Headless Chrome on this machine has no GPU** and falls back to SwiftShader.
  Screenshots are correct; the frame rate it reports is software rendering.

### The reference shots

All six are taken headless at 1440x900 against
`http://127.0.0.1:4949/?src=data/demo.json&camera=fixed`.

| shot | wait | caught with |
|---|---|---|
| `docs/shots/city-020.png` | 21 s | — |
| `docs/shots/city-090.png` | 92 s | — |
| `docs/shots/city-240.png` | 242 s | — |
| `docs/shots/city-print.png` | 55 s | `__print().cue && __print().k > 0.30 && __print().k < 0.62 && __print().seconds >= 3` |
| `docs/shots/city-print-wide.png` | 100 s | `__printing() > 0 && !__print().cue && __cam().dist > 30 && __print().seconds > 2 && __print().k > 0.2` |
| `docs/shots/city-derez.png` | 20 s | `__derezzing() > 0`, **then wait 420 ms** — the glitch pre-roll is what the poll catches, and the voxels are in the air a beat after it |

Two more, taken emulated at 390×844 (dpr 1.5) rather than 1440×900, per the
"Touch controls and a mobile preset" pass:

| shot | url | wait | caught with |
|---|---|---|---|
| `docs/shots/final/city-mobile.png` | `?src=data/demo.json&mobile=1&camera=fixed` | 91 s | — |
| `docs/shots/final/city-mobile-interior.png` | `?project=cb09014b&mobile=1&camera=fixed` | `__seek(37800000)`, `__enterFile('city.js')`, `__stand(0.4, 1.80, -1.0, -Math.PI/2+0.55, 0.02)` | `__interior().phase === 'inside'` |

A print now runs **2.5 s (one floor) to 4.0 s (twelve drawn floors)** and the
lattice stays 1.1 s past it, so it no longer has to be caught blind — but the
`k` window is still the only way to land the shot ON the scanline rather than on
a shell that has already finished. `city-print-wide.png` deliberately waits for
`cue` to be FALSE: that is the print seen from the wide shot, which is the thing
the ground ring and the 2.4 px laser exist for.

### Watching a print on purpose

```
http://127.0.0.1:4949/?src=data/demo.json&demo=print
```

`?demo=print` scans the payload for the first 20-second window in which three
files are touched for the FIRST time — a first touch is exactly what prints a
building — seeks to 1.5 s before it and plays at **0.5x**. Nothing is staged; on
`data/demo.json` the cluster sits at **929.5 s** and spans 9.8 s. If no such
cluster exists in the file the badge says so and the transport is left alone.

`P` replays the last print at any time, on the building that printed most
recently. It is visual only — `replayLastPrint()` re-runs the plane over a shell
that already stands and changes no data.

### The interior shots <!-- INTERIOR-DOC -->

Four shots, all headless at 1440x900. They need a **project** page, not a
`?src=` one, because the walls carry the file's real bytes and the source
endpoint is keyed on the town id:
`http://127.0.0.1:4949/?project=cb09014b&camera=fixed`.

A screenshot harness has no pointer, so the interior is driven by name. These
call the same `Interior` entries a click calls; nothing bypasses the real path.

```js
window.__enterFile('city.js')        // click a building, then click it again
window.__enterPlate('docs')          // a district's caption -> its lobby
window.__enterStreet(0)              // a street sign -> the hall of records
window.__stand(x, y, z, yaw, pitch)  // put the walker exactly where a shot needs him
window.__leaveInterior()             // Esc
window.__interior()                  // the probe below
```

`__interior()` answers:

```
{ phase: 'out'|'in'|'inside'|'leaving', inside, mode, subject, floor, floors,
  panels,          // pages of source built right now (3 floors x 3 walls)
  faced,           // of those, how many are on this floor and in front of the reader
  minGlyphPx,      // the legibility instrument — measured on the RENDERED frame
  pointerLock, dragLook, fixture, echoes }
```

`minGlyphPx` is the same kind of measurement as `__tags()`: world glyph height
over `2 * distance * tan(fov/2)`, times the frame height. It counts only pages
**on the reader's own floor and in front of him** — the floor above is visible
through the lift well and its type is genuinely small there, which is not what
anybody is reading. **Floor: 14.**

| shot | how |
|---|---|
| `docs/shots/interior-enter.png` | `__enterFile('city.js')`, poll `__interior().phase === 'in'`, hold 430 ms |
| `docs/shots/interior-file.png` | then `__stand(0.4, 1.80, -1.0, -Math.PI / 2 + 0.55, 0.02)` |
| `docs/shots/interior-html.png` | on `?project=c500d4e9` (town-c500) — `__seek(999999999)`, `__enterFile('index.html')`, `__stand(-0.1, 1.95, -1.55, Math.PI - 0.19, -0.02)` |
| `docs/shots/interior-street.png` | `__enterStreet(0)`, `__stand(0, 2.05, -3.0, Math.PI, 0.02)` |

Measured 2026-09-06: `interior-file` 16.4 px, `interior-html` 14.5 px, both
clear of the 14 floor.

**Console errors: 0 for the whole city-and-room flow** — load a project, enter a
building, walk it, leave — verified on `?project=cb09014b`. The one exception is
an `.html` room, and it is not the page's: on the tree route (the normal case
since HANDOFF's sixteenth pass), it is only the sandbox's own "Blocked script
execution … sandboxed" notices — one per script tag the page ships, six on
town-c500's `index.html`, re-verified 2026-09-06 against the real server. On
the `raw=1` fallback (an older server, or a path the tree route's guard
refuses) the framed document's FIRST pass at its own relative assets also goes
through `server.py`'s broken `<base>` and 404s before the load handler can
rewire them (two on town-91a7 — `/api/project/styles.css` and
`/api/project/skippy-stamp.webp`), after which they load correctly. Both counts
belong to the frame and both are attributable by the `url` on the log entry
(`/api/project/tree/…` for the normal case, `/api/project/file`/`/asset` for
the fallback).

**`interior-file.png` is a ROOM shot now, not a wall shot.** The old pose stood a
metre from the back wall facing it, which proved the source was legible and
nothing else; the room around it was undressed and it did not show. The pose
above stands back in the middle of the floor looking across it, so the frame
carries the window on the dusk, the ceiling lamp, two desks with lit terminals,
the floor plate on the lift AND a page of source — and it still measures 16.4 px,
because the wall it faces is the side wall five units away rather than the back
wall six and a half away.

**`interior-html.png` moved to town-c500 (`c500d4e9`), 2026-09-06.**
Before HANDOFF's sixteenth pass it lived on town-91a7 (`91a7433c`) instead,
for a reason worth knowing even though it no longer applies: the window needs
a town where the city's `rel` for a file IS that town's own relative path, and
`chooseRoot()`'s 40% heuristic put town-c500 on the wrong side of that line
(36.3% of its paths under the session cwd) — the endpoint 404'd on it and the
room fell back to the labelled fixture, a coin flip depending on which paths a
given session window happened to touch. Now that `chooseRoot()` reads the
payload's own `root` outright (PAGE-WINDOW-DOC and HANDOFF's sixteenth pass),
town-c500 resolves every time, not on a knife edge — and it is the town this
whole fix was written to prove, so it is the reference now.

- `cb09014b` (werkstadt) still resolves, but its own `index.html` is a
  `<canvas>` filled by a module script — a script cannot run in a sandboxed
  frame by design, so the window there is correctly, uselessly blank. Still not
  the reference, for that reason alone.
- `c500d4e9` (town-c500) is the reference: real `root`, a designed page,
  `fixture: false` every time.
- `91a7433c` (town-91a7) still works too (67.5% under its cwd even by the old
  heuristic) and is the fallback proof if town-c500's session window ever
  moves enough to change which files exist at all.

Three things that cost time here and will cost it again:

- **Seek before you enter.** The town spans ten and a half hours and a
  stopwatch never reaches the files this pass is about. `__seek(37800000)` first,
  then `__nodes()` should read ~181. Without it `__enterFile()` returns `null`
  because the building does not exist yet.
- **Yaw 0 faces the DOOR.** The wall carrying the source is `+z`, so a shot of
  it wants `yaw = Math.PI`. The first three captures were of the wall behind
  the reader's head and measured 10 px.
- **The by-name entries do not go through the raycast.** All four captures
  passed while hovering and clicking a building was completely broken (three had
  cached the facade mesh's bounding sphere at radius `-1`). If you change
  anything in the `PICKING` section of `city.js`, check the pointer path itself:
  dispatch a `pointermove` from page script (CDP's `Input.dispatchMouseEvent`
  does **not** synthesise `pointermove` in headless, so it finds nothing and
  looks like a product fault), read `#pick-caption`, then two `pointerdown` /
  `pointerup` pairs at the same spot. Expected: the caption names a file and its
  floor count, the caption gains `armed`, and `__interior().phase` becomes
  `'in'`. Verified 2026-09-06: hover `.../fps.mjs  ·  7 floors` -> armed ->
  inside, HUD `floor 1 of 7`.
- **Pointer lock is refused over CDP** — there is no user gesture Chrome will
  accept — and that is deliberately not fatal: `pointerlockerror` and a rejected
  `requestPointerLock()` promise both set `dragLook`, and mouse-look falls back
  to drag. Verified in the harness: after one synthetic `mousedown` +
  `mousemove` + `mouseup`, `__interior().dragLook` is `true` and the view turns.

### The page window <!-- PAGE-WINDOW-DOC -->

The ground floor of an `.html`/`.php` room carries the real page, in a
`CSS3DRenderer` layer holding an `<iframe sandbox="allow-same-origin">`, at
960×600 CSS px (`PAGE_PX_W`/`PAGE_PX_H` in `interior.js`; was 1024×640, same
1.6 aspect). Three things about it are not guessable:

- **It is DOM, not WebGL, so the room's walls cannot occlude it.** It is
  therefore shown only while the reader is inside, on the ground floor, and
  facing it (`syncPageWindow()`, `dot(_toPage, _pageFwd) > 0.20` — was 0.10),
  and `display:none` the rest of the time. That same `visible` flag is what
  gates the `css.render()` call in `update()`, so the CSS3D layer's own draw is
  skipped, not just hidden, over the wider arc the raised threshold now covers.
- **It costs about eight to ten frames a second while it is on screen** — the
  browser re-blends that transformed layer over the whole canvas every frame.
  Measured headed on the AMD 860M, same room, at the current 960×600/0.20
  setup: **57 / 56 fps** with the window up and faced head-on
  (`?project=cb09014b`, `city.js`, floor 1) — inside the ≥50 gate. Shrinking
  the raster (1280 → 1024 → 720, and now 960×600) has never moved this
  outside the noise; what does help is that an animating page repaints its own
  layer every frame, which is why `holdPageStill()` pauses the framed page's
  animations. The two changes (raster, threshold) were read together, not in
  isolation — see HANDOFF's sixteenth pass for the honest caveat.
- **The errors it logs are its own.** A page that ships scripts or a webfont
  produces "Blocked script execution … sandboxed" and a `style-src` violation in
  the console — that is the sandbox reporting that it is working. Count them
  separately from the page's own errors: a capture harness can tell them apart
  by the `url` on the log entry (`/api/project/tree/…` or `/api/project/asset`).

**The window is served by `GET /api/project/tree/<town>/<path>` first, with a
`raw=1` fallback.** `rawPageUrl()` in `interior.js` probes the real, path-shaped
tree route before anything else: a page served from there resolves its own
relative `styles.css`/`fonts/*.woff2`/`url()` natively, because the URL IS a
real path with a real directory — no `<base>` splice to get wrong, and no
per-element rewiring needed (`pageWindow()` skips `wirePageAssets()` when the
probe reports `native: true`). Only when the tree route does not answer 200
(an older server, or a path its own traversal guard refuses) does the code fall
back to the pre-existing `GET /api/project/file?…&raw=1` and the `<base>`
workaround below — `wirePageAssets()`/`inlineSheets()` are still there for
exactly that case, not dead code.

Verified on town-c500 (`c500d4e9`) against the real running server: the
iframe's `src` is `/api/project/tree/c500d4e9/index.html`, and the network log
shows `css/base.css`, `css/instrument.css` and both webfonts loading as 200s
off that same path — assets the old `<base>` splice could never reach one level
into a stylesheet's own `url()`. `docs/shots/interior-html.png` was retaken
against this path.

**`server.py`'s `<base>` splice still cannot work, and the fallback still routes
around it exactly as before.** The served `raw=1` page carries
`<base href="/api/project/asset?id=<town>&f=">`, and a base URL whose last
component is a QUERY has no directory: the browser resolves `styles.css`
against it as `/api/project/styles.css`, dropping the query, per RFC 3986.
Every relative asset in a framed page 404s. So `wirePageAssets()` rewrites the
frame's own `img`/`source`/`video` URLs to the asset endpoint directly, and
`inlineSheets()` fetches each local stylesheet as text and inlines it — the
asset endpoint answers **403** for a `.css` (media only) and the file endpoint
serves it as `text/plain`, which Chrome will not apply as a stylesheet. What is
still missing there is a `url()` INSIDE one of those sheets: it resolves
against the sheet's own URL and hits the same problem one level down. The
caption under the window says so, and now also says which of the two routes
actually answered.

### The interior frame-rate gate

Gate: **>= 50 fps inside a 40-floor building with 3 worker drones and the text
walls**, 1440x900, bloom on. Headless Chrome has no GPU here, so this has to be
read in a **headed** window (`Emulation.setDeviceMetricsOverride` still gives
the real GPU). Measured 2026-09-06, `ANGLE (AMD, AMD Radeon(TM) 860M Graphics
(0x00001114) Direct3D11)`, on `?project=cb09014b`, three reads each:

| state | buildings | workers | fps |
|---|---|---|---|
| inside `city.js`, 40 floors, floor 1 | 181 | 0 | 56 / 56 / 57 |
| inside `city.js`, 40 floors, floor 1 | 181 | 3 | **57 / 56 / 57** |
| climbed to floor 4 — 9 live pages | 181 | 3 | 57 / 56 / 56 |
| the city outside, `data/demo.json` + `__stress(140)` | 361 | 0 | 56 / 56 / 56 |

Re-measured 2026-09-06 after the page window landed, same headed window and same
GPU string. **The page window costs about ten frames a second and the gate is not
met with it up** — that is the honest number, and the A/B is the part worth
trusting because both halves were read minutes apart on the same machine:

| state | fps |
|---|---|
| inside a 40-floor room, no window (`city.js`, floor 1) | 51 / 53 / 56 / 57 |
| ground floor of an `.html` room, **window shown** | 37 / 45 / 47 / 48 |
| the same room, one floor up, **window hidden** | 54 / 56 |
| the same window pointed at `about:blank` | 42 → 54 |
| the CSS3D layer `display:none` entirely | 55 / 56 |

**The window costs about eight to ten frames a second and the room does not hold
50 with it up.** The A/B is the trustworthy part — both halves read minutes apart
on the same machine, four times over, and the gap is the same every time. The
absolutes are not: with three other agents' headless Chromes on this GPU the
whole table shifts down 10-15 (the unstressed CITY read 56 early in that session
and 31 late in it, with nothing about the page changed), so read the unstressed
row first and only then the rest.

What has been ruled out as the lever: the raster size (1280 → 1024 → 720 moved
nothing outside the noise) and the framed page's own animation (paused by
`holdPageStill()`; `about:blank` in the same layer costs almost nothing, so what
remains is the browser compositing a live document over the canvas every frame).
Going back to a still texture would recover it and is exactly what this pass
replaced, so the honest options are a smaller window or accepting the cost.

**Re-measured again 2026-09-06 (sixteenth pass)**, after the window shrank to
960×600 and the facing threshold moved to `0.20` (PAGE-WINDOW-DOC above): the
same room, window up, faced head-on, read **57 / 56 fps** — clear of the ≥50
gate on a quiet machine. This is not proof the two changes fixed the
compositing cost the paragraph above describes; it was not re-isolated from the
raster change, and the honest reading is "the gate passes now," not "the cost
is gone." Read the unstressed row and close every other Chrome before trusting
either this number or the ones above it — same trap, same warning.

Close every other browser first: with a second headless Chrome alive on the same
GPU the same runs read 47-54, which is the machine and not the page.

### The desk terminals are never off

One lit terminal per tool call in flight against this file, wearing that call's
own tag — and, since 2026-09-06, an IDLE screen where nothing is running rather
than a black rectangle: the same terminal at a lower brightness, with a lit bezel
drawn on its own canvas and the room's own file name on it (`> city.js`). The
bezel is a stroke on the canvas and not geometry, because the screen is
MeshBasic and goes through the bloom pass, so the stroke IS the glow round the
panel and costs nothing per frame. The point light on the desk still only comes
on for a real worker — an idle room is not pretending anybody is in it.

### The source endpoint the interior needs

```
GET /api/project/file?id=<town>&f=<relative path>
  200  text/plain; charset=utf-8   the file, verbatim, <= 512 KB
  404  the town or the file is not there
  403  the path resolved outside the town root
```

`f` is the same relative path the city put on the building's plaque. With no
server, or with a 404, the room falls back to `data/sample-file.txt` and says
`FIXTURE` on the plaque beside the door — a room never shows somebody else's
bytes without saying so. `__interior().fixture` reports which it is.

**As of 2026-09-06 `server.py` does not answer this yet** — it is another
agent's half of the pass. The four interior captures above were taken through a
throwaway proxy that stands in front of 4949 and answers exactly this contract
off the town's own `cwd`, which is why the walls in them carry the real
`city.js` and the real `index.html` and `__interior().fixture` reads `false`.
Once the endpoint lands, drop the proxy and shoot straight at 4949; nothing in
the page changes. Until then a plain run shows the labelled fixture, which is
the designed fallback and not a fault.

The project shots are taken the same way, against the project fixture
`?src=data/sample-project.json&camera=fixed` — except `project-live.png`, which
is the real werkstadt town through `server.py`:

| shot | url | wait | caught with |
|---|---|---|---|
| `docs/shots/project-020.png` | the fixture | 21 s | — |
| `docs/shots/project-240.png` | the fixture | 242 s | — |
| `docs/shots/project-street.png` | the fixture | 12 s, then `__seek(7600000)` | `__streetIntro()`, then hold 2.2 s |
| `docs/shots/project-live.png` | `?project=cb09014b` | 62 s | — |

Two things the street shot cost, both worth knowing before repeating it:

- **A street intro cannot be waited for on a stopwatch.** The avenues of a real
  project are HOURS of session clock apart, and the arrow keys move in
  ten-second steps — `data/sample-project.json`'s second session starts three
  hours in, so a wall-clock wait never reaches it. `__seek(ms)` is the jump the
  `→` key does, in one call; seek to just BEFORE a street's last event, not
  past it, because the intro only fires on a CHANGE of street and a seek that
  lands inside the new one has nothing to change from.
- **`Log.enable` replays the previous navigation's log buffer.** A 404 from an
  earlier run on another port was counted against a clean run and read as a
  console error in this page. Send `Log.clear` and reset the collector
  immediately before `Page.navigate`.

## Measure the frame rate

The page reports its own numbers:

```js
window.__fps()           // rolling average over the last 90 frames
window.__nodes()         // buildings currently standing
window.__drones()        // craft currently in the air — one per agent
window.__workers()       // worker drones in the air — one per tool call still running
window.__kit()           // the ORNIS fleet: { kit, byVariant, craft, byLod, trisEach, night }
                         //   `byVariant` is this file's own bookkeeping (orchestrator /
                         //   agent / worker.edit / .read / .search / .shell / .net);
                         //   `byLod` is [near, mid, sprite]. `{ kit: false }` means the
                         //   city is flying the old discs — ?drones=discs, or no model
window.__printing()      // buildings materialising this instant (print jobs, lattice included)
window.__print()         // { jobs, seconds, k, cue, flash } — `seconds` is the SCHEDULED
                         //   length of the longest print running, `k` how far through, `cue`
                         //   whether the camera is inside a print close-up. The duration gate
                         //   is read off this; a stopwatch on a screenshot cannot see it.
                         //   `flash: { jobs, peak }` is the white-hot cool-down: `peak` is
                         //   the hottest facade's flashValue() this instant (1 through the
                         //   0.2s hold, then an exponential decay to 0 by 3s) — the
                         //   overexposure gate below is read off this, since a stopwatch on
                         //   a screenshot cannot see the pre-bloom value either.
window.__replayPrint()   // exactly what `P` does; returns the path, or null
window.__derezzing()     // craft AND buildings coming apart this instant — the glitch
                         //   pre-roll counts, which is what makes city-derez.png catchable
window.__tags()          // { captions, minGlyphPx } — the legibility floor, measured
window.__stress(n)       // place n extra buildings — for this measurement only
window.__stressWorkers(n)// fly n extra workers, over as many synthetic craft as needed
window.__frame()         // { width, top } — where the city's box sits, in % of the frame
window.__streets()       // { count, current } — avenues standing, and the live one's title
window.__streetIntro()   // true while the camera is easing to a newly reached avenue
window.__stressStreets(n)// open n avenues with ten buildings each — for the gate only
window.__seek(ms)        // jump the transport, for catching a street intro
window.__enterFile(rel)  // walk into a building by name — see "The interior shots"
window.__enterPlate(name)// walk into a district's lobby
window.__enterStreet(i)  // walk into a session's hall of records
window.__stand(x,y,z,yaw,pitch)  // place the walker, for a shot
window.__leaveInterior() // Esc, from the harness
window.__interior()      // { phase, inside, mode, subject, floor, floors, panels,
                         //   faced, minGlyphPx, pointerLock, dragLook, fixture, echoes }
window.__selfcheck()     // { attrs, sphereRadius, streets, buildings } — see below
window.__cam()           // the NAVIGATION instrument — see below
```

### The four interiors that are not the hall <!-- INTERIOR-GAPS-DOC -->

Since 2026-09-06 every structure on `world.html` has an inside. Four forms, and
only two of them are rooms:

| double-click | opens | `__interior().mode` |
|---|---|---|
| a vault house, temple, ruin, terrace tower, quarry block, fortress wall | the note's own gallery: its markdown on the walls | `note` |
| a Daily bridge | the deck, standing on it | `deck` |
| an Ideas lighthouse | the tower, at the door of the stair | `tower` |
| a page wing | the plain hall dressed for one page | `hall`, `form: pageWing` |
| a trade landmark | the hall, as before | `hall` |

**A note gallery needs `GET /api/vault/note?id=<note id>`.** Without it (an older
`server.py`, or a note the endpoint 404s on) the structure opens the plain hall
with the caption board instead, which is what it did before this pass — so a
gallery that does not appear is an endpoint question first:

```
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:4949/api/vault/note?id=Home"
curl -s "http://127.0.0.1:4949/api/vault/note?id=Home&meta=1"
```

**A deck and a tower keep the WORLD on screen behind them** (see HANDOFF's
OVERLAY-DOC). `__interior().overlay` is true for exactly those two, the world's
own sea, signs and drones keep updating while you are in one, and the bloom runs
at `BLOOM_OVERLAY` (0.12) rather than 0.48 for as long as you are. If a deck ever
comes back as a white sheet, that assignment in `frame()` is the first thing to
look at.

**Climbing.** The lighthouse's stair is walked in polar coordinates: `W` runs
ALONG the ring, `A`/`D` cross it, and the lens turns with the stair, so one held
key climbs the tower. Above the lamp-room floor the walk goes back to x and z.
`__interior().climb` is the fraction of the four turns climbed; multiply by 13
for metres.

#### The probes this pass added

```js
__interior()      // .room 'note'|'deck'|'tower', .overlay, .notePanels,
                  // .noteGlyphPx (the plate being READ, on the rendered frame),
                  // .climb (0..1 up the lighthouse), .warm (the note flashing)
__kindOf('Daily/2026-07-23')   // 'bridge' — what biomes.js built for a note
__deck('2026-07-23')           // the deck's solved len / wid / rot / deckY
__vaultEvent('Home.md')        // one saved note, through /api/vault's own handler
__stand(x, y, z, yaw, pitch)   // works in all four forms; in the tower it sets
                               // the CLIMB from y, or stepTower() undoes the pose
```

`__vaultEvent()` is `onVaultEvent()` and nothing else — the same function the
EventSource hands its messages to, with the same payload shape. It is how the
live half is tested without an Obsidian to save in; the transport itself is the
pre-existing wiring the lit-window behaviour proves.

#### Aiming the double-click at each of the four

Same rule as NAV-DOC: sweep `mouseMoved` over a grid, read `#hover`, and click
the first pixel the PAGE says something is under. Two things make the sweep find
nothing if you skip them:

- **Fly to it first.** `__search('<note title>')` puts the structure on screen;
  a bridge or a lighthouse is a few metres wide on a 900-unit island and the
  opening shot has neither in frame.
- **A WING needs the camera INSIDE its town's pick sphere.** `groups.picks`
  carries one large sphere per quarter and `pick()` walks the hits in distance
  order, so from 26 units out every pixel of the screen reports the TOWN and no
  wing is ever reachable. At `__goto(wing.x, wing.z, 10, 0.30)` the sphere's
  front faces are behind the lens, three's raycast skips them (they are
  `FrontSide`), and the wings are what the ray reaches. The hover caption for a
  wing ends in `kB`, which is how the harness tells one from a house.

#### Two harness traps this pass paid for

- **`Log.enable` REPLAYS the browser's stored entries.** A second run on the same
  Chrome inherited the first run's console and reported fourteen errors it never
  caused. Send `Log.clear` after `Log.enable` AND again after `Page.navigate`.
- **Chrome caches the modules.** Without `Network.setCacheDisabled` the harness
  verifies the PREVIOUS build, and its stack traces name line numbers that no
  longer exist — which reads exactly like a fix that did not take.

#### The shots

All four headless at 1440x900 on `world.html?camera=fixed`, entered with a real
double-click and posed with `__stand` afterwards where a shot needed it.

| shot | how | measured 2026-09-06 |
|---|---|---|
| `docs/shots/final/int-note.png` | `__search('Home')`, sweep, double-click, `__stand(0.3, 1.62, -2.6, 1.30, -0.05)` | **16.3 px** of glyph, 3 plates, 56 fps |
| `docs/shots/final/int-bridge.png` | `__search('2026-07-23')`, sweep, double-click | **16.6 px** on the stand, 57 fps |
| `docs/shots/final/int-lighthouse.png` | `__search('<a long note title>')`, sweep, double-click, `__stand(x, y + 14.68, z - 1.6, PI, -0.06)` | `climb 1`, 56 fps |
| `docs/shots/final/int-wing.png` | `__goto` a wing at dist 10, sweep for a caption ending `kB` with >= 5 kB, double-click | page loaded through the tree route, 57 fps |

**Console: 0 for the note, the deck and the tower.** The wing carries fourteen
and every one of them belongs to the FRAMED DOCUMENT, attributable by the `url`
on the entry (`/api/project/tree/...`): six sandbox "Blocked script execution"
notices, one per script tag the page ships, and eight 403s on that page's own
`?v=`-busted assets through the tree route. Same class INTERIOR-DOC already
records; `server.py`'s to answer for, not the world page's.

### `__cam()` and the real-input gates <!-- NAV-DOC -->

`__cam()` exists on both pages (`world.js` directly; `city.js` as `camProbe()`,
exported and hung on `window.__cam` by `replay.js`) and it only reports:

```
{ x, y, z, aboveGround, dist, targetX, targetZ, free, pointerLock, ... }
```

Every navigation gate is stated in those numbers, because a screenshot can
answer none of them — "did the camera move" and "is the lens at eye level" are
not things a picture shows.

**Drive the gestures with `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`,
never with a probe.** The by-name entries (`__enterFile`, `__enterLandmark`) all
passed while hovering and clicking were completely broken once already — see the
`PICKING` warning above. Three things this cost:

- **`Input.dispatchKeyEvent` must not carry `text` for a non-printable key.**
  `text: 'Escape'` makes Chrome deliver a char event and `interior.js`'s
  capture-phase handler never sees the keydown: the room reported `inside`
  forever and it read as a broken Esc. Send `text` only for `key.length === 1`.
- **`pointermove` DOES fire from `Input.dispatchMouseEvent` in Chrome 152**,
  contrary to the older note in the `PICKING` section — the pan, the drag-look
  and the hover sweep here all ride on it. Do not design round the old warning
  without re-checking it.
- **Aim the double-click with the page's own hover caption.** Sweep
  `mouseMoved` over a grid, read `#hover` (world) / `#pick-caption` (city), and
  double-click the first pixel the PAGE says something is under. Nothing is
  computed from scene internals, so the test cannot pass on a broken raycast.

Measured 2026-09-06, headless 1440×900, against the running `server.py`:

| gate | world.html | index.html (`?project=cb09014b`) |
|---|---|---|
| `H` → card up, gone after 6 s | true / true | true / true |
| `F`, hold `W` 2 s → moved ≥ 20 | **133.7 m** | **27.2 units** |
| drag-look turns, `F` back to orbit | yes / yes | yes / yes |
| right-drag → aim moved | **210.6** | **21.9** |
| 20 scroll notches → ≤ 3 above ground | dist 720 → 5, **2.45** | dist 85 → 3.3, **2.72** |
| double-click → inside → `Esc` → out | vault house, `inside` → `out` | street sign, `inside` → `out` |
| console errors | **0** | **0** |

The one console error seen during this pass was a **403** from
`/api/project/file` for a path outside the town root — a scratchpad file that had
leaked into the session log, the documented behaviour of that endpoint, and the
room correctly fell back to `FIXTURE`. Not a navigation fault; re-run against an
in-root building and it is 0.

**The frame-rate gate was NOT re-verified for this pass, and here is why.** Six
other headless Chromes were rendering WebGL on this GPU throughout (ports 9333,
9334, 9337, 9411 and two gpu-processes — other agents in this repo), and the
unstressed baseline read **30** against its historical 56. By this file's own
rule — *if the unstressed row is not ~56, nothing below it means anything* — no
absolute taken in that state is a verdict. What IS trustworthy is the A/B inside
one run on the real GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics …
Direct3D11)`):

| state | fps |
|---|---|
| the orbit, wide shot | 30 / 30 |
| **free fly** | **30 / 30** |
| the orbit zoomed to eye level | 24 / 24 |

**Free fly costs nothing over the orbit** — it draws the same scene with a
different camera — and the eye-level orbit costs about six frames because the
lens is inside the terrain's near detail. Re-run the gate on a quiet machine
before quoting a number.

**A headed Chrome window that is not on screen cannot be measured at all.**
Chrome suspends `requestAnimationFrame` for an occluded or minimised window:
`__fps()` returns **0**, `camera.position` stays at the origin because
`updateCamera()` has never run, and — the part that wastes the time —
`Input.dispatchMouseEvent` with `type: 'mouseWheel'` never resolves its CDP
promise, so the harness simply hangs with no error. Bring the window to the
front before reading anything from it.

| shot | how |
|---|---|
| `docs/shots/final/nav-help.png` | `H`, then capture |
| `docs/shots/final/nav-freefly.png` | `F`, drag down 64 px, hold `W` 2 s, drag-look, capture |
| `docs/shots/final/nav-house-interior.png` | hover-sweep, double-click, hold 5.8 s, capture |

`__selfcheck()` is the one call that catches the two failures this city has
suffered SILENTLY, with nothing in the console and nothing obviously wrong on
screen. Read it first when something looks off:

| field | healthy | what it means when it is not |
|---|---|---|
| `attrs` | **16** | vertex-attribute slots the facade program uses. GL guarantees sixteen; `instanceMatrix` takes four and every other attribute one. **17 and the program does not link** — SwiftShader logs "Too many attributes" and the city is black. That is why the ten per-building floats ride in three vec4s (`aStatic`/`aTags`/`aLive`). |
| `sphereRadius` | positive, ≈ half the city's diagonal | the buildings' bounding sphere, recomputed on the spot. three caches it on first use and never invalidates it when `instanceMatrix` changes, so a raycast against an empty city caches **-1** and every building raycast after that misses in total silence: hover reports the plate behind the tower, clicking does nothing. |
| `streets` | the avenue count | sanity, and the third number the framing solve depends on |
| `buildings` | `__nodes()` | ditto |

`__frame()` is the framing instrument. It projects the BUILDINGS' bounding box
through the live camera; a pixel measurement off a screenshot cannot tell a lit
window from a drone, a spark or a star, and every threshold that was tried here
disagreed with the next one by twenty points. Wide-shot target: **width 80-88%,
top >= 8%**. Re-measured 2026-09-05 after the worker-drone pass, on
`data/demo.json` at 1440x900: **83.2 / 18.5 at 90 s** (32 buildings, session
20:34) and **82.1 / 19.4 at 240 s** (47 buildings, session 33:51).

Re-measured 2026-09-06 after the tower-height change, same file, same size:
**83.3 / 20.4 at 90 s** and **82.6 / 24.7 at 240 s** — unchanged within noise,
which is the point of measuring it.

**A STREET INTRO is part of that gate, and it is where the gate used to break.**
When the replay reaches a session it has not shown yet, the camera swings its
aim onto that avenue for a beat. It used to keep `cam.distWant * 0.78` while it
did so — a guess — and a distance solved for a CENTRED box does not hold that
box once the aim has moved off it: `?project=cb09014b` measured **155–243 %**
for the seconds `__streetIntro()` was true, and only entered the band when the
intro ended. It now calls `fitDistance()` for the union of every street's
buildings, re-centred on the intro's own aim, so the whole town is in frame
during the intro too. Re-measured 2026-09-06, every 2 s from t=16 s to t=90 s:
**38/38 samples, width 81.3–86.0, top 25.1–36.1**. If you change the intro,
SAMPLE it — a single reading at 30 s is exactly what missed this.

**An avenue does not reserve its band until it is built on.** `openStreet()`
records `s.band` and leaves `s.minH` at the carriageway; `claimBand()`, called
from `ensurePlate()` when the first district lands, turns one into the other and
slides the still-empty avenues below it down by the difference. A project opens
every one of its streets before the first event is replayed, so those avenues
ARE still empty and nothing that already stands ever moves; a claim that would
run into a street which already has buildings is cut short at the gap that is
free, and the packer annexes along +x from there.

**Project and live mode are otherwise the same gate and meet it.** There is no
project-specific camera: `updateCamera()` calls `fitCamera(false)` every frame
whatever door the payload came in through, so a town re-fits as its streets
grow by construction. Measured on `?project=cb09014b` at 1440x900, `__frame()`
sampled every 900 ms across a full 90-second orbit — **105 samples, width 81.3
to 86.7, top 16.8 to 30.2**, inside the band for every one. At the 62-second
capture point: **84.5 / 27.4**. Elevation is `WIDE_PHI` = 0.42 rad = **24.1°**
(a street intro's 0.47 = 26.9°), inside the 22-28 the brief asks for. A
`project-live.png` that shows a small far city is an OLD capture, not a
regression — check `__frame()` before changing the camera.

Early on it
reads lower (60.6 at 20 s) and that is correct - with eight buildings and five
craft the drones' altitude is what the frame is solving for. Before the camera
was recalibrated the 240 s mark was a close-up sitting at **133%**; see
`docs/HANDOFF.md` -> "the camera was recalibrated".

`__tags()` is the legibility instrument, for the same reason: type in the scene
is a world-space sprite, so how big it is on the frame depends on where the
camera is standing, and a screenshot cannot be measured by eye. Floor: **13**.
Measured on the same runs: 14.5 at 20 s, 13.0 at 90 s, 13.0 at 240 s, 13.0 with
32 captions on screen under the stress gate below.

The gate is **≥50 fps with 300 buildings and 25 drones at 1440×900**.

> **2026-09-06, the print pass: this gate was NOT re-measured under the
> conditions below, and the numbers in this section are still the 2026-09-05
> ones.** The machine was at 70-91% CPU with 84 Chrome processes, 76 of them
> belonging to other agents working in this repo at the same time, and the
> headed window the gate is stated against could not be given a fair run. What
> WAS measured, headless in the same session, is that the print layer costs
> nothing detectable: with `__stress(300)` + `__stressWorkers(40)` and the
> transport paused, **0 prints running read 38-45 fps and prints running read
> 39-42 fps**, and 18 buildings with no stress at all read 32-42 — i.e. the
> deficit is the machine, not the scene. Re-run the headed gate on a quiet
> machine before trusting any absolute number here.

Measured
2026-09-05 in a **headed** Chrome window (`ANGLE (AMD, AMD Radeon(TM) 860M
Graphics (0x00001114) Direct3D11)`), on `data/demo.json`, bloom on:

| state | buildings | drones | fps |
|---|---|---|---|
| 40 s into the replay | 16 | 9 | 60 |
| seeked to the end of the session (`L`) | 221 | 22 | 60 |
| plus `__stress(95)` | **316** | 22 | **60** |

Re-measured 2026-09-05 after the third pass, same headed window and same GPU
string, on `data/demo.json`:

| state | buildings | drones | fps |
|---|---|---|---|
| 50 s into the replay | 18 | 9 | 60 |
| plus `__stress(300)` | **323** | 9 | **60** |
| plus `__stress(300)`, second run | **318** | 9 | **60** |

Re-measured 2026-09-05 after the worker-drone pass, same headed window, GPU
string `ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11 vs_5_0
ps_5_0, D3D11)`, on `data/demo.json`, bloom on. The gate now has a second half:
**300 buildings AND 40 visible worker drones**, because the worker layer is what
this pass added.

| state | buildings | craft | workers | fps |
|---|---|---|---|---|
| 50 s into the replay | 18 | 9 | 7 | 60 |
| plus `__stress(300)` and `__stressWorkers(40)` | **320** | 13 | **45** | **60** |
| the same, ten seconds later | **323** | 13 | **45** | **60** |

Re-measured 2026-09-06 after the project/street pass. The gate now has a THIRD
half: **300 buildings, 40 visible workers AND 12 streets**, because a town of
avenues is what this pass added.  opens twelve synthetic
avenues with ten buildings each, so it must run BEFORE /.
Same headed window, same GPU string, on , bloom on:

| state | streets | buildings | craft | workers | fps |
|---|---|---|---|---|---|
| 50 s into the fixture | 3 | 18 | 11 | 5 | 60 |
| plus , ,  | **12** | **415** | 24 | **48** | **57** |
| the same, ten seconds later | 12 | 419 | 24 | 44 | **56** |

### What the ORNIS airframes cost — the A/B (2026-09-06)

The craft are real aircraft now (`drones.js`, `docs/DRONES.md`), not octahedrons,
so the only honest way to state their cost is to measure the SAME page twice in
the same minute with the only difference being `?drones=discs`. Headed Chrome,
the real GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11
vs_5_0 ps_5_0, D3D11)`), 1440×900, `deviceScaleFactor 1`, bloom on,
`?src=data/demo.json&camera=fixed`, `__stress(300)` + `__stressWorkers(40)`, an
8 s settle and then five one-second samples:

| run | started | craft | workers | samples | median fps |
|---|---|---|---|---|---|
| **kit** (ORNIS airframes) | 14:58:10 | 51 | 41 | 35 35 39 47 48 | **39** |
| **discs** (`?drones=discs`) | 14:58:46 | 60 | 47 | 32 33 36 41 42 | **36** |

**The airframes are not the cost.** Two things make that reading believable and
one makes it provisional:

- Craft past ~120 city units fall to LOD1 and past ~400 to LOD2 — at the stress
  pose `__kit()` reported `byLod [0, 2, 49]`, i.e. 49 of 51 craft were sprites.
  That is the whole point of the LOD bands and it is why 51 aircraft cost less
  than 60 discs, which have no LOD at all.
- Both runs reported **zero console errors** and the same GPU string.
- **The box was loaded** — 74 Chrome processes and 59-60% CPU across both runs,
  which is why neither run reaches the documented 60 and why the samples spread
  35-48. Both halves of the A/B paid the same tax, so the COMPARISON holds; the
  absolute numbers do not. Re-run on a quiet machine before quoting 39 anywhere.

Read the frame rate AFTER the stress calls have settled:  is a rolling
average over 90 frames, so a reading taken six seconds in still carries the
allocation burst (47 on the first attempt, 57 once it had cleared) — and do not
run two capture browsers against the GPU at once, which is how a 242 s reference
shot came back showing 16:48 of session clock instead of 22:00:  clamps
dt at 0.1 s, so a page starved of frames advances its own clock more slowly than
the wall clock.

At that twelve-avenue stress the CAPTION floor does not hold — craft tags measure
4.7 px and signs 7.8 px against the 13 px floor, because the camera stands back
far enough that  runs out. The real werkstadt town (2 streets,
137 buildings) measures 13.0 on both. See HANDOFF -> Known limits of this pass.

Re-measured 2026-09-06 after the project/street pass. The gate has a THIRD half
now: **300 buildings, 40 visible workers AND 12 streets**, because a town of
avenues is what this pass added. `__stressStreets(12)` opens twelve synthetic
avenues with ten buildings each, so it must run BEFORE `__stress` and
`__stressWorkers`. Same headed window, same GPU string, on
`data/sample-project.json`, bloom on:

| state | streets | buildings | craft | workers | fps |
|---|---|---|---|---|---|
| 50 s into the fixture | 3 | 18 | 11 | 5 | 60 |
| plus `__stressStreets(12)`, `__stress(300)`, `__stressWorkers(40)` | **12** | **415** | 24 | **46** | **56** |
| the same, ten seconds later | 12 | 419 | 24 | 44 | **56** |

Re-measured 2026-09-06 after the tower-height pass, same headed window, same GPU
string, on `data/demo.json`. **Where the gate is stated matters, and this is the
row that was never run before:** every table above starts the stress from an
EARLY replay state, so `__stress(300)` lands on ~320 buildings TOTAL. Run from a
city seeked to the END it lands on 521, and that is a different machine problem:

| state | buildings | craft | workers | fps |
|---|---|---|---|---|
| seeked to the end, no stress | 221 | 22 | 0 | **55 / 56** |
| `__stress(100)` from there, + `__stressWorkers(40)` | **321** | 26 | 40 | **56 / 56** |
| `__stress(300)` from there, + `__stressWorkers(40)` | **521** | 26 | 40 | **55 / 56 / 57** |

**The same three rows read 41-48 earlier the same day and the page had not
changed** — three other agents were rendering WebGL cities on this GPU at the
time. That is a 15-frame swing from the machine alone and it is the single
biggest source of wrong conclusions here. Check what else is holding the GPU
(`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'"`, look for
`--headless`) before you believe a number, and re-read the unstressed row first:
if THAT is not ~56, nothing below it means anything.

`__stress(n)` is NOT cumulative — it touches the same `__stress/blockN/fileN.js`
paths every time, so calling it twice adds floors rather than buildings. That is
worth knowing before you read a ladder of stress calls as a ladder of loads.
Note also that every table above starts the stress from an EARLY replay state,
so their `__stress(300)` lands on ~320 buildings TOTAL; this one starts from a
city seeked to the end and lands on 521.


Two things about reading that number honestly:

- **Let the stress calls settle first.** `__fps()` is a rolling average over 90
  frames, so a reading taken six seconds in still carries the allocation burst
  — 47 on the first attempt, 57 once it had cleared.
- **Do not run two capture browsers against the GPU at once.** That is how a
  242 s reference shot came back showing 16:48 of session clock instead of
  22:00: `frame()` clamps `dt` at 0.1 s, so a page starved of frames advances
  its own clock more slowly than the wall clock, and the shot is simply of an
  earlier moment than the one asked for.

At that twelve-avenue stress the CAPTION floor did not hold: craft tags measured
4.6 px and street signs 8.6 px against the 13 px floor, because the camera stands
back far enough that `MAX_TAG_GROWTH` ran out. The real werkstadt town
(2 streets, 157 buildings) measured 13.0 on both. See `HANDOFF.md` -> *Known
limits of this pass*. **`MAX_TAG_GROWTH` was 6.0 for this measurement; it is
12.0 now (2026-09-06, "Two polish items" in HANDOFF.md) — this specific
twelve-avenue number predates that change and has not been re-taken, but the
same fix that brought `?project=cb09014b` (sphereRadius 86) from 8.2 px to the
floor applies here too, since it is the same growth ceiling.

60 is the vsync cap, so there is headroom above it that this cannot see. Anything
under 50 is a regression. `__stressWorkers(40)` brings its own synthetic craft —
`WORKER_CAP` is 12, so forty visible workers need four of them, and there is no
honest way to show forty around one.

**How much concurrency is real?** In `data/demo.json`, counted off the
`tool`/`tool_end` id pairs: one agent (`af1683550b4c817e7`) peaks at **18
simultaneous calls**, the whole session peaks at **33 calls in flight at once**,
and after the 12-per-craft cap that is **29 workers visible**. The stress figures
above are therefore above, not below, what the real data asks for.

## Live mode — the server

`server.py` (stdlib-only) now provides this. Start it instead of
`python -m http.server`:

```
cd werkstadt
python server.py
```

`--port` and `--vault` exist as one-off overrides; the settings themselves live
in `config.json` (`"port"`, `"vault"`), and each flag defaults to whatever that
file says. **The vault is optional and ships empty** — with no vault configured
the globe and the island still run, there is simply no knowledge continent and
no notes. It serves the same static
files `python -m http.server` would — rooted at the script's own folder, not
whatever directory it happens to be launched from — so `?live=1` works from
`http://127.0.0.1:4949/`, plus three endpoints:

- `GET /api/stream` — `text/event-stream`. Watches
  `<transcripts_root>/**/*.jsonl` (`~/.claude/projects` by default: main session
  files plus `<session>/subagents/agent-*.jsonl`), follows
  whichever main session was modified most recently — "the session you are
  working in right now" — and switches when a newer one appears. `?session=<uuid>`
  pins one session so it never auto-switches. On connect it replays everything
  that session has done so far as a burst (so the city stands immediately),
  then tails new lines every 0.5 s. Parsing is `tools/export_replay.py`,
  imported directly, so tailed events are redacted and summarised exactly like
  an exported replay file. A `: keepalive` comment goes out every 15 s of
  silence. `window.ingest(event)` on the client needs nothing else — no
  handshake, no acknowledgement, no polling endpoint; reconnection is the
  browser's own `EventSource`.
- `GET /api/vault` — same SSE mechanics for the Obsidian vault at `config.json`'s
  `"vault"`. Absent when no vault is configured, which is the default.
  Polls the tree every 2 s (skipping `.obsidian/` and `.trash/`) and emits
  `{"kind":"note_created"|"note_modified"|"note_deleted","path":...,"t":...,"words":...}`
  for `.md` files that changed. Not wired into the page yet — that's a
  separate front-end job. `data/vault.json` (below) is kept fresh
  automatically: on startup if it's missing/stale, and 30 s (debounced) after
  the last change this poller sees, capped at one export/minute — see
  HANDOFF's VAULT-FRESH-DOC. Once a regen lands, connected clients also get
  `{"kind":"vault_index","notes":N,"links":M,"generated":iso}` on this same
  stream.
- `GET /api/sessions` — JSON, the 10 most recently modified main sessions as
  `{id, cwd, started, events, agents, title}`, for a future session picker.
- `GET /api/vault/note?id=<relative note id, no .md, as in data/vault.json>`
  (added 2026-09-06) — the note's markdown, `text/plain; charset=utf-8`,
  redacted like everything else, capped at 512 KB (413 over). Same
  traversal guard as `/api/project/file`: 403 if `id` resolves outside the
  vault dir or into `.obsidian`/`.trash`, 404 if the note isn't there.
  `&meta=1` returns JSON instead —
  `{id, title, folder, words, modified, inlinks, outlinks, tags}` pulled
  from `data/vault.json`, or just `{id}` if that file or the id isn't in it.

Known limits: an `Agent` tool call already in flight *before* the server
attaches has no way to be matched to its eventual result (the pending-call
table is only built from the moment of connection forward), so that one
agent's drone never gets its `agent_end`. Switching to a newer session sends a
fresh burst but the contract has no "reset" event, so the client would need
its own city-reset handling to make that visually clean — out of scope here,
same as `/api/vault` wiring.

## Recordings (2026-09-07) <!-- RECORDINGS-RUN -->

Every finished session is kept twice: as a **link** that replays it exactly, and
as an **MP4** you can send to somebody. What each one is and why there are two:
`docs/HOW-IT-WORKS.md` -> "Recordings", `docs/DECISIONS.md`.

**The shelf.** `http://127.0.0.1:4949/recordings.html` — linked from the
masthead of `globe.html`, `world.html` and `index.html`. One card per film:
poster, duration, date, the session's own tool-call count, and four actions
(play here, open the live replay, copy either link, download the MP4).

**Where the files are.**

```
recordings/<project-name>/<date>_<session-title-slug>.mp4   the film
recordings/<project-name>/<date>_<session-title-slug>.jpg   the poster
recordings/<project-name>/<date>_<session-title-slug>.json  what was measured
data/.cache/recorder/frames/                                       scratch, deleted after each render
launcher/server.log                                                every `[recorder]` line
```

The `.json` sidecar IS the index — `/api/recordings` reads the folder, nothing
else. Delete an `.mp4` and its row disappears from the shelf; delete the whole
`recordings/` folder and the shelf is empty again. `recordings/` is the default;
`config.json`'s `"recordings_dir"` moves it (a relative path is resolved against
the Werkstadt folder, not the current directory).

**The replay link, by hand.**

```
http://127.0.0.1:4949/index.html?project=<town-id>&session=<uuid>&replay=1
```

Add `&since=2026-08-01T00:00:00Z` for a session older than thirty days —
`/api/project`'s own window is the last 30 days, and without `since` that street
is simply not in the payload (the page then falls back to the whole town, which
looks like the link "not working"). The shelf's own links always carry it.

**When a film gets made.** A daemon thread in `server.py` looks every five
minutes and renders **one at a time**, only when:

| gate | value | where |
|---|---|---|
| the session has been silent for | 10 min | `SILENT_SECS`, `tools/recorder.py` |
| it carries at least | 20 file-tool calls | `MIN_TOOL_EVENTS` |
| it started within the last | 30 days | `BACKLOG_DAYS` |
| nothing else is running | no agent in flight, no transcript touched in the live window | `recorder_busy()`, `server.py` |

A render takes about **five minutes** for a ninety-second film (measured: ~8
captured frames a second, ~2,700 frames). It runs Chrome and ffmpeg at
`BELOW_NORMAL_PRIORITY_CLASS` and kills **only the PID it started** — never
`taskkill /IM chrome.exe`, which takes every other agent's browser with it.

**Re-render one on purpose** (also the way to record a session older than the
30-day window): delete its `.mp4` and `.json` and the loop picks it up again on
its next pass. To do it now, without waiting:

```
cd werkstadt
python -c "import sys; sys.path[:0]=['.','tools']; import server, recorder as rc; server.set_vault_dir(''); c=next(x for x in server.recording_candidates() if x['session_id']=='<uuid>'); print(rc.render_one(c, server.RECORDINGS_DIR, 4949, server.RECORDER_WORK_DIR/'frames-manual', cdp_port=9379))"
```

Pass your vault path to `set_vault_dir()` instead of `''` if you run with one.
Run the whole thing with `PYTHONIOENCODING=utf-8` — a session title can be in any
script, and the Windows console codepage cannot print most of them.

**Turn it off.** Set `WERKSTADT_NO_RECORDER=1` in the environment `server.py`
starts in (`launcher/start-server.ps1`) and restart. The shelf, the replay links
and everything already rendered keep working; only new renders stop.

**Watching a render.** `launcher/server.log` gets one line per finished film
(name, film length, MB, frame count, render minutes) and one per failure. While
one is running, `data/.cache/recorder/frames/` fills with numbered JPEGs — that
count divided by 30 is where the film is up to.

**Two things that will bite.**

- **A film is not made of the whole session.** `?record=1` picks a playback
  speed so the film lands near 90 s; a long conversation is therefore fast. The
  speed is on the card and in the sidecar. Nothing is skipped — it is the same
  dead-air compression the transport already does, only more of it.
- **The page must be able to reach the server it screenshots.** The recorder
  drives `http://127.0.0.1:4949/…`, so it is not a Basic Auth path. If the port
  ever moves, `main()` passes `args.port` through and nothing else needs
  changing.

## Launcher & screensaver

`launcher/` makes the page always-available on the machine it is installed on,
and usable as a screen
saver, without any unsigned `.exe` (Smart App Control is ON — everything here
runs through `powershell.exe`, `pythonw.exe` and `msedge.exe`/`chrome.exe`, all
already signed and on the machine).

| script | does |
|---|---|
| `install.ps1` | one-time setup, safe to re-run: generates `werkstadt.ico`, creates the Desktop shortcut `Werkstadt.lnk`, registers all three Scheduled Tasks below |
| `start-server.ps1` | idempotent — if nothing listens on 4949 it starts `server.py` via `pythonw` (no console window), working dir = project root, no `--vault` flag on purpose (`config.json` is where that setting lives, and a flag here would silently outrank it), stdout/stderr redirected to `launcher/server-stdout.log`/`server-stderr.log`, its own lifecycle lines logged to `launcher/server.log` (rotated at 5 MB) |
| `restart-server.ps1` | **the way to reload code onto the running server** — see below |
| `open.ps1` | the shortcut's target — runs `start-server.ps1`, polls `/api/sessions` for up to 10 s, then opens `settings.json`'s `page` (default `globe.html`), falling down the chain `globe.html` -> `world.html` -> `index.html?live=1` on the first real `200` |
| `screensaver-watch.ps1` | the idle loop, see below — same `page` chain, with `?screensaver=1` on whichever page wins |
| `uninstall.ps1` | removes all three Scheduled Tasks, the Desktop shortcut, and kills a running kiosk — nothing else |
| `make_icon.py` | draws the `.ico` itself (a three-bar gold skyline on ink) — PIL if installed, else a hand-written minimal ICO. No download. |
| `settings.json` | `{ "idleMinutes": 5, "page": "globe" }` — `page` is `globe` (top-level, default), `world` or `city` (`index.html?live=1`); switch it here, not in the scripts |

Three Scheduled Tasks, all hidden:

- `Werkstadt-Server` — at logon of whoever ran `install.ps1`, runs
  `start-server.ps1`; `RestartCount 999` / 1-minute interval so a crash
  relaunches it.
- `Werkstadt-Screensaver` — at logon of the same user, runs `screensaver-watch.ps1`,
  which loops forever.
- `Werkstadt-Restart` — **on demand only, no trigger**: runs
  `restart-server.ps1`. `schtasks /Run /TN Werkstadt-Restart` is the
  documented way to push new code onto the running server.

Verify any of them with `schtasks /Query /TN Werkstadt-Server` (or
`-Screensaver` / `-Restart`).

### Restarting onto new code

`schtasks /End /TN Werkstadt-Server` does **not** stop the running
`pythonw.exe` — `start-server.ps1` launches it detached via `Start-Process`, so
the task's own tracked process tree is already empty by the time `/End` runs,
and a follow-up `schtasks /Run` then sees the port still listening (the
idempotent check in `start-server.ps1`) and does nothing either. Manually
finding and killing the port-4949 listener before running `schtasks /Run`
used to be the only way around this; `Werkstadt-Restart` replaces that
manual step:

```
schtasks /Run /TN Werkstadt-Restart
```

`restart-server.ps1` finds the process listening on 4949, confirms it is
`pythonw`/`python` running `werkstadt`'s own `server.py` (never kills
anything else), stops it, waits up to 5 s for the port to free, runs
`start-server.ps1`, then waits up to 15 s for `/api/sessions` to answer `200`
before printing `restarted: pid <new> started <time>` — to stdout and to
`launcher/server.log`. Any failure along the way exits 1 with a one-line
reason instead of silently doing nothing, which is the whole point: the old
`/End` + `/Run` pair failed exactly that way, with `SUCCESS` printed both
times.

Verified 2026-09-06, run twice back to back against the real production
server: first run replaced pid `76604` (started `18:36:46`) with pid `68272`
(started `18:39:45`), second run replaced `68272` with pid `76152` (started
`18:40:46`) — one `LISTENING` row on port 4949 after each run, `/api/sessions`
`200` after each, and both `restarted:` lines landed in `launcher/server.log`.
`schtasks /Query` reported all three tasks `Ready` throughout.

### pythonw.exe and `sys.stdout`/`sys.stderr` (fixed 2026-09-06)

`pythonw.exe` has no console, so any code path that touches `sys.stdout`/
`sys.stderr` directly is fragile under it -- on this machine (Python 3.12.10)
they come back as *usable but pointless* `TextIOWrapper` objects when the
process is launched unredirected, and this launcher's own
`start-server.ps1` used to launch it exactly that way (`Start-Process
-WindowStyle Hidden`, no `-Redirect*`). `server.py`'s bare `print(..., flush=True)`
calls and its unwrapped `log_message()` override (which calls
`BaseHTTPRequestHandler`'s default, a raw `sys.stderr.write()`) crashed inside
the request thread on every endpoint whose path didn't short-circuit
`log_message()` (`/api/stream`, `/api/vault` did; `/api/world`,
`/api/sessions`, `/api/project*` did not) -- the crash landed before any bytes
reached the client, so the browser saw a bare `ERR_CONNECTION_RESET` / curl
saw `(52) Empty reply from server`. Reproduced live 2026-09-06 by running an
unpatched copy of `server.py` the exact same way: `curl /api/world` and
`curl /api/sessions` both came back `(52)` every time.

Fixed on both sides, belt and suspenders:
- **`server.py`** — `logging.basicConfig()` now always attaches a
  `RotatingFileHandler` at `launcher/server.log` (5 MB × 3 backups) and only
  adds a console `StreamHandler` when `sys.stdout` is not `None` and is a
  real tty; every request-path `print()` became `log.info`/`log.error`;
  `log_message()` wraps its `super()` call in `try/except Exception: pass` so
  a bad stream can never abort a request thread again.
- **`start-server.ps1`** — the `Start-Process` call now passes
  `-RedirectStandardOutput`/`-RedirectStandardError` to two dedicated files
  (`launcher/server-stdout.log`, `launcher/server-stderr.log`) — not
  `launcher/server.log` itself: `Start-Process` refuses identical
  stdout/stderr paths, and `server.py`'s own `RotatingFileHandler` already
  holds that file open for the life of the process. This is what actually
  gives the process a real, valid `sys.stdout`/`sys.stderr` from the OS side
  (confirmed: `server.py`'s own hardening above already stops the crash even
  launched unredirected, so this is defense-in-depth, not the only fix).

Verified 2026-09-06 against the server launched three ways -- an unpatched
copy unredirected (reproduced the bug: 5/5 `(52)` on both endpoints), the
patched `server.py` unredirected (5/5 `200` after a first cold-cache miss),
and the real production path, `schtasks /Run /TN Werkstadt-Server` after
killing the port-4949 listener: single `LISTENING` PID, then `/api/world`
10/10 `200`, `/api/sessions` 10/10 `200` (one cold-cache timeout, not a
reset), `/api/project?id=cb09014b` 5/5 `200` (this project's own
continuously-growing session — see the A8 entry below for why it's slow, not
broken), a 10 s `/api/stream?project=cb09014b` and a 5 s `/api/world/stream`
both `200` with real bytes flowing, cut only by the test's own `--max-time`.
Zero `ERR_CONNECTION_RESET` / curl `(52)` anywhere in that pass.

**Left as a separate, pre-existing, unfixed observation:** with a valid
`sys.stderr`, `server-stderr.log` now fills with Python's own
`Exception occurred during processing of request ... ConnectionAbortedError:
[WinError 10053]` tracebacks whenever a *client* disconnects mid-response
(a closed browser tab, a cut-off `curl -N`, live-reload navigating away from
an SSE stream). That's `socketserver`'s default `handle_error()`, not this
pass's crash -- it never reaches the client as a reset (they already hung up)
and it predates this fix; it was just as reachable before, only silently, so
`server-stderr.log` growing with these is expected noise, not a regression.

### How the screensaver replacement works

Every 5 s, `screensaver-watch.ps1` calls `GetLastInputInfo` via an inline P/Invoke
(`Add-Type`) to read real idle time. Past `idleMinutes` (from `settings.json`) it
launches `msedge.exe --kiosk ...?screensaver=1` (falls back to `chrome.exe --kiosk
--app=...` if Edge is missing) into its own `launcher/kiosk-profile/` user-data
dir, and remembers that process's PID. On the next input it kills exactly that
PID's tree (`taskkill /PID <pid> /T /F`) — never anything else the browser has
open. A second launch is refused while one is already tracked as running.

**`powercfg /requests` needs an elevated shell.** Confirmed on this machine
2026-09-05: run non-elevated it fails with "This command requires administrator
privileges". The Scheduled Task at logon is not elevated, so the
"skip if a fullscreen video/presentation holds a DISPLAY request" check is
best-effort — on access-denied it logs once and treats it as "no active
request" rather than blocking the screensaver forever. To make this gate
actually work, the task would have to run elevated, which trades away the
"no UAC prompt at logon" property; left as-is by design.

**Note for whoever builds `world.html`:** the kiosk always appends
`?screensaver=1`. Nothing in the client reads that flag yet — this launcher does
not touch `.js`/`.html`/`.css`. Worth doing there: hide the keyboard-hint toast
and any click-to-interact prompt (nobody's at the keyboard), and consider a
slower auto-orbit so it reads as ambient rather than something demanding
attention.

**Set Windows' own screen saver to "None"** (Settings → Personalization
→ Lock screen → Screen saver) so the two don't fight. `install.ps1` deliberately
does not do this for you.

Tested 2026-09-05: `open.ps1` opened the page in the default browser (confirmed
by window title, not just exit code — `Get-Process` alone doesn't distinguish a
reused window). Both tasks registered and shown `Ready` by `schtasks /Query`.
The idle-triggered path was exercised directly (the PC had continuous real
input throughout testing, so `GetLastInputInfo` never idled past even a 12 s
threshold on its own) — `Start-Kiosk`/`Stop-Kiosk` were run with the same code
path against a live server: the kiosk launched (`msedge`, correct fallback to
`index.html?live=1&screensaver=1` since `world.html` didn't exist yet, window
title carried "Werkstadt"), and `Stop-Kiosk` killed only that PID — two other
Chrome windows open at the time were untouched.

## The World — `world.html` <!-- WORLD-MAP-DOC -->

One island carrying everything: the Obsidian vault as geography, every project
Claude Code has worked in as a quarter of the harbour city on its coast, and
whatever is running this minute as light, smoke and drones over it. Replaces both
the old grid-of-towns map and the separate vault city; `vault.html` now redirects
here and the old renderer sits unloaded at `archive/vault-city.js`.

Needs `server.py` (not `python -m http.server`) for the harbour: the land is
`data/vault.json` and stands without a server, the 125 project quarters are
`/api/world` and do not.

**Since 2026-09-06 the houses are `buildings.js`.** 1,033 of the island's 1,196
structures are grown by the building kit — real openings, sills, shutters,
gutters, roofs in tile courses — and the thirteen scanned props from
`assets/manifest.json` stand near the lens. What an operator needs to know:

- **Two shells, both gated on camera TRAVEL, not on frames.** `updateKitLod()`
  and `updateProps()` only re-solve when the lens has moved 9 m (`KIT_MOVE`,
  `PROP_MOVE`). Everything they rebuild — `kit.instanced()` groups, the prop
  instance matrices — is rebuilt whole, so doing it per frame would cost far more
  than either LOD saves.
- **The props do not exist past 115 m** (`PROP_SHELL`). The wide shot of the
  island has none, which is why it costs what it always did.
- **The caps in `PROP_SPEC` are a triangle budget.** One quiver tree is 82 k
  triangles, one fence module 89 k over 26 meshes, one pipe run 95 k over 106.
  Raising a cap costs frames; re-measure with `ab.py` before and after, never by
  eye. `__props()` prints what is actually placed against each cap.
- **`__kit().lod2` is always 0 and that is on purpose** — LOD2 builds no roof and
  the island's default framing is 900 m up. See HANDOFF -> "The kit town and the
  prop shell".
- **A house is still picked by its box.** The five house pools are built exactly
  as before and are `visible = false`; they are the raycast collider under the
  kit buildings, so anything that walks `pool.userData.records[instanceId]` —
  hover, caption, `enterGeneric`, `applyLive` — is unchanged.

```
python server.py
```

| url | what it gives you |
|---|---|
| `/world.html` | the world, orbiting slowly |
| `/world.html?camera=fixed` | no auto-orbit — every capture below uses this |
| `/world.html?screensaver=1` | hides the hints, the click prompt and the quality toast, and halves the orbit rate. The kiosk launcher already appends it |
| `/world.html?hour=19.5` | forces the clock the sky is lit by. **Only** the shot list uses it: docs/shots needs a dusk frame and a night frame at one sitting and the wall clock is one of those at a time |
| `/world.html?focus=vault` | fly to the landmass as a whole (this is where `vault.html` sends you) |
| `/world.html?focus=<note id>` | fly to one note — `Daily/2026-08-14`, `Knowledge/…` |
| `/world.html?focus=<project name>` | fly to that project's quarter |
| `/world.html?demo=print` | the materialisation on purpose: fetches the busiest LIVE town's own replay and prints every file it touched for the first time in the last thirty minutes of it, in order, at **0.5×**. Nothing is staged. The payload is tens of megabytes for a busy town, which is why this is a flag and not a mode; with nothing live it says so in the console and does nothing |
| `/world.html?life=0` | **no living layer at all** — no people, no traffic, no herds, no flocks. Kept on purpose: it is the B half of the frame-rate A/B, and it is also the ~20 s of `Life.load()` you do not pay when you only want the terrain |
| `/world.html?drones=orbs` | the octahedron-ring-quad craft this page flew before `drones.js` landed. The other B half. A `DroneKit` that fails to load falls into the same path rather than taking the world down |

| gesture / key | does |
|---|---|
| drag | orbit by hand; the automatic orbit resumes after 20 s |
| scroll | zoom, 28 to 900 units |
| `w` `a` `s` `d` | glide over the ground; the camera drops to low altitude while you hold them |
| hover | the name and how long ago it last moved |
| click | the caption: a note's words, inlinks and age, or a town's prompt, agents and open items |
| click again, or `Enter` | a note opens in Obsidian (`obsidian://open`); a **trade LANDMARK** flies to its door and you walk in (see "Inside a landmark" below); any other live town flies in to `index.html?live=1&session=…` |
| `w` `a` `s` `d` inside a landmark | glide. `space`/`shift` up and down, drag to look, `Esc` or walking out of the door to come back |
| `p` | replay the last materialisation over the shell that already stands — visual only, no event, no building, no count |
| `/` | the address search — see below |
| `q` | quality high ↔ medium |
| `esc` | close the caption or the search |

### The address search

`/` opens a one-line mono field (an underline, not a box — this page has no
panels). It matches over the same two payloads the world is built from, so it
can never offer something that is not on the map:

- a **date** flies to that day's bridge: `2026-08-14`, `14.8`, `14.8.2026`,
  `today`/`heute`, `yesterday`/`gestern`
- a **note title** or a **project name**, fuzzy (subsequence, prefix wins)
- a **region name**: `Knowledge`, `Dev Logs`, `Boards`, `Ideas`, …

Verified 2026-09-05: `2026-08-14` → that bridge; `yesterday` → `2026-09-04 — its
bridge`; `WDM Client Pipeline` → the clock-tower crossroads.

**Before the world is built the field is honest instead of broken.** A cold
`world.html` takes about 25 s on this box and the field is live from the first
frame. `searchHits()` returns nothing while `plan` is null, `#search-hits` reads
"world still loading…", Enter is a NO-OP, and the query is banked and run for
real from `boot()` the moment `buildWorld()` has returned. Before that guard
every keystroke in that window threw
`TypeError: Cannot read properties of null (reading 'index')` — seven of them in
the acceptance run, with nothing on screen to say why. Verified 2026-09-06 by
typing `2026-08-14` at t = 2 s: 0 uncaught exceptions, and the camera flew to
that bridge on its own once the plan existed.

### The opening shot, and why the signs are on it

`frameCamera()` stands **720 back over the harbour**, aimed at `(40, 10, 0)`,
phi 0.34, theta 1.30. It used to stand 900 back over the whole island aimed at
`(-40, 10, 0)`, which was the prettier postcard and a map with no addresses on
it: `__signPixels()` read `{visible: 0}` there, because the sign fade ended at
380 units. Four things had to move together and none of them is optional:

- **`SIGN_FADE0/1` are 900/1,200**, not 300/380. The pixel solve already makes a
  sign the same size on the frame at any range, so the only honest reason left
  to fade one out is that it is past the fog.
- **`SIGN_MIN_CAP_PX` = 18.** A plaque whose solve runs into `SIGN_MAX_H` — a
  sign with a logo band spends most of its height on the logo — cannot reach the
  floor, and drawing it anyway is the 9.5 px smudge this whole section exists to
  remove. Below the floor it is not there.
- **The plaque is as wide as the name on it.** A fixed 512 px canvas made a
  four-letter town's sign the same 210 px hoarding as an eighteen-letter one and
  the overlap cull then threw four fifths of the harbour's names away.
- **No fog and no depth test on a sign.** At 900 units the exponential fog took a
  quarter of the ink out of a plaque the solve had just made readable, and a
  hillside between the lens and a quarter ate the LEFT HALF of that town's
  plaque — the plaque, not just its text. The mast still sinks behind the hill,
  which is what says where the town actually is.

The cost, measured A/B inside one minute on one machine: **43/43/41 fps at the
old framing, 40/41/40 at the new** — 3 frames, and the river mouth and the far
islands are out of frame. Read the A/B, not the absolutes.

### Probes

```js
window.__fps()          // rolling average over the last 90 frames
window.__structures()   // boxes standing: notes, quarters, walls, ruins
window.__trees()        // instanced trees
window.__roads()        // road ribbons on the ground (local + trunk + rail + path)
window.__links()        // { local, trunks, carriedByTrunks } — all 3,518 accounted for
window.__bridges()      // must equal the Daily note count
window.__towns()        // quarters, one per /api/world project
window.__cranes()       // one per open item, plus the fortress wall
window.__drones()       // must equal the agents in flight (still a plain number)
window.__fleet()        // WHICH airframe each of them flies: { craft, kit, variants, working, trails, stats }
window.__life()         // { on, counted, stats, draws, maxSkinned, rigid } — `counted` is what
                        // world.js asked for, `stats` is what life.js built; they must agree
window.__print()        // { jobs, cue, built, k, seconds, flash, rigs, x, z, path } — the
                        // until-expression for docs/shots/world-print.png
window.__printing()     // prints still cutting (the flash does not count)
window.__printed()      // EVERY building that stands for a file, and how it got there:
                        // { built, clickable, seeded, live, floors, grown, growMs,
                        //   maxFloors, seed: {towns, seeded, skipped, ms}, sample }
                        // `clickable` MUST equal `built` — a printed building with no
                        // collider is one nobody can read. `seed` is the load pass that
                        // recovers the day's work off /api/project, which is the proof a
                        // reload does not empty the back yards.
window.__printed(path)  // one building: { path, floors, edits, seeded, clickable, agent, at }
window.__vehicles()     // { cars, lanes, plazas, tol, offCarriageway } — `offCarriageway`
                        // MUST be []. It lists any car more than `tol` (3.6 m) from the
                        // nearest lane CENTRE LINE, or standing on a plaza. The market
                        // square is a place people stand in, not a carriageway.
window.__derezzing()    // buildings coming apart
window.__nextPlot(town) // where this town's NEXT live building will stand — point the lens first
window.__quay()         // the waterfront pavement, as the crowd walks it
window.__pulse(town, tool, path)  // one synthetic pulse down the real path
window.__replayPrint()  // what `P` does: replay the last print, visual only
window.__live()         // the names of the towns that are alive right now
window.__night()        // 0 by day, 1 after dusk — what the windows follow
window.__quality('high'|'medium')
window.__bloom(false)   // bisect the frame rate
window.__search('14.8') // run the address search from the console
window.__select(name)   // open the caption on anything, for screenshots
window.__goto(x, z, dist, phi)   // put the camera somewhere, for screenshots
window.__dbg            // { terrain, sun, renderer, scene, plan, cam } — the shot harness uses these
window.__autoDegrade(false)      // stop the page dropping to medium under the instrument
window.__landmarks()             // { shaped, wings, signs, forms } — the trade-landmark gate
window.__signPixels()            // { visible, culled, minCapPx, medCapPx, capTarget } — sign legibility
                                  // GATE, on the DEFAULT view: minCapPx >= 18 AND visible >= 6, at t=0 s
                                  // and t=30 s of the orbit. Measured 2026-09-06: 9 / 19.5 and 9 / 22.
window.__goto(x, z, dist, phi, theta)   // theta is the 5th arg, and only docs/shots passes it
window.__landmarkAt(name)        // { town, trade, form, signText, pos, ownSignIsNearest, nearestSignTown }
                                  // one town's ground truth — proves a sign names its own landmark and
                                  // a form matches its own trade. Exact name match first, substring
                                  // fallback. See HANDOFF -> "Giant ticker labels and the site-editor sign"

/* INSIDE a landmark. Same four names the session city's harness uses, so one
   harness drives both pages. A screenshot harness has no pointer, and these
   call the same Interior entries a second click calls — nothing bypasses the
   real path. Name matching is __landmarkAt()'s: exact first, then substring. */
window.__enterLandmark(name)     // click a landmark, then click it again. Returns the town's name, or null
window.__stand(x, y, z, yaw, pitch)   // put the walker exactly where a shot needs him, in HALL coordinates
window.__leaveInterior()         // Esc
window.__interior()              // the probe below
```

### The board a reader sees from the door

The hall's lens is 30 mm on a 16:9 frame — **23 degrees off the axis, either
side**. A plaque bolted to a side wall 10 m to the left of a reader standing
2.2 m inside the door is therefore not "at the edge of the frame", it is off it;
the one capture that caught the "still open" corkboard at all caught it cut in
half. It now hangs over the left-hand aisle at `(-6.6, 4.4, HALL_Z0 + 26)`,
turned to face the door, which puts it about 15 degrees off the axis with its
whole width inside the frame. Check it with
`__stand(0, 1.68, -14.8, Math.PI, -0.02)` — the entrance pose
`placePlayerAtHallDoor()` uses — and not from a shot pose that has already been
turned toward it.

### Inside a landmark <!-- WORLD-INTERIOR-DOC -->

`__interior()` on `world.html` answers the session city's fields plus five of
its own:

```
{ phase: 'out'|'in'|'inside'|'leaving', inside, mode: 'hall', subject,
  form,           // the landmark's form key — 'concertHall', 'factoryHall', ...
  stations,       // bays built: one per page of /api/project/meta
  loaded,         // stations that have carried the real page this visit
  station,        // the page whose window is up RIGHT NOW, or null. Never more than one
  liveStations,   // stations a live agent's last_path names
  pack,           // true when the world's PBR pack reached the hall's materials
  pointerLock, dragLook, fixture, echoes }
```

**THE HALL'S OWN COORDINATE SYSTEM**, which every `__stand()` below is in. It is
NOT the world's: the building is modelled at the origin and the world camera is
never in it.

| | |
|---|---|
| the entrance door | `z = -17`, `x = 0`. Walk through it and the visit ends |
| the hall | `x` −10…10, `z` −17…17, ceiling 9.5 |
| the trade's far end (stage, yard window, reception) | `z` = +10 to +17 |
| the three arches into the aisle | `x = -10`, at `z` = −13.4, −6.2, +1.0 |
| the aisle | `x` −16.6…−10, from `z = -17` for as long as the site is big |
| station *i* (practice room *i*) | `x` −23.2…−16.6, `z0 = -15.4 + i * pitch` |
| a station's screen | `x = -22.92`, facing **+x** — so a shot of it wants `yaw = pi/2` |

`pitch` is 4.8 for a walled station (`concertHall`, `school`) and 3.2–3.6 for an
open bay. **A 24-page site is a 115 m corridor** and that is deliberate: the
building is as big as the project's site, so the aisle is where the page count
is legible as a fact rather than as a number.

Two things that will cost time and did:

- **`yaw = pi` faces the STAGE and `yaw = pi/2` faces a station's screen.** The
  hall's own forward at yaw pi is `+z`; a station is read looking `-x`. The
  first three room captures were of the wall behind the reader's head.
- **`__enterLandmark()` does NOT go through the raycast**, exactly as the session
  city's by-name entries do not — the same trap, on the same day it was written
  down there. Check the pointer path itself after touching anything in world.js's
  `pick()`/`hover()`/`click()`/`act()`: dispatch a real `pointermove` from page
  script (CDP's `Input.dispatchMouseEvent` does not synthesise one in headless),
  read `#hover`, then two `pointerdown`/`pointerup` pairs at the same spot.
  Expected: the hover names the town, `#cap-hint` reads "click again, or Enter,
  to go inside", and the second pair puts `__interior().phase` at `'inside'`.
  Verified 2026-09-06 on `?focus=harbour` at (672, 513): all three, 0 console
  errors. `canvas.setPointerCapture` has to be stubbed out for a synthetic
  pointerId, or `pointerdown` throws before `click()` is ever reached.
- **The page window is one document, and it loads on ARRIVAL.** Walking into a
  station swaps the iframe's `src`; nothing preloads. A capture therefore has to
  poll `__interior().loaded > 0` after `__stand()` and hold — 2.5 s was enough
  on the real server, and a shot taken without the poll comes back with the
  station's dark title screen, which looks like a designed state and is not.

### The world-interior shots

All at 1440x900 against `http://127.0.0.1:<port>/world.html?camera=fixed&hour=19.5`,
after polling `__landmarks().shaped >= 40` — a cold `/api/world` has not filled
its trade cache and `__enterLandmark()` returns `null` for a town that is still
a generic quarter.

| shot | how |
|---|---|
| `docs/shots/world-int-town-c500.png` | `__enterLandmark('town-c500')`, poll `phase === 'inside'`, `__stand(6.2, 3.3, -15.4, Math.PI - 0.60, -0.04)` |
| `docs/shots/world-int-room.png` | then `__stand(-17.2, 1.90, -12.2, Math.PI / 2 - 0.42, -0.12)`, poll `__interior().loaded > 0`, hold 3 s |
| `docs/shots/world-int-factory.png` | `__enterLandmark('zahnradpumpe')`, `__stand(4.4, 2.6, -13.0, Math.PI - 0.30, -0.02)` |
| `docs/shots/world-int-studio.png` | `__enterLandmark('wild-digital-moments-site')`, `__stand(-1.5, 2.3, -6.0, Math.PI - 0.30, -0.02)` |
| `docs/shots/world-int-return.png` | `__leaveInterior()`, poll `phase === 'out'` — the world, back on the frame it was left on. Taken on `?focus=harbour` |

**Console errors inside a landmark: 0**, except the framed page's own sandbox
notices — one "Blocked script execution … sandboxed" per `<script>` the page
ships (four on town-c500's `instrumente/schlagzeug.html`, measured
2026-09-06). Same rule and same attribution as the session city's `.html` room:
the `url` on the log entry is `/api/project/tree/…`, so they are the frame's and
not the page's.

**The frame rate inside a hall.** Gate: **>= 45 fps in the concert hall with the
practice rooms standing and one live page window**, 1440x900, real GPU. Measured
by RUNBOOK's own procedure above — quality into `localStorage`, hard reload,
`__autoDegrade(false)`, settle 12 s, five samples 1.4 s apart, median — in a
fresh headed Chrome process (`--disable-features=CalculateNativeWinOcclusion`),
`ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11)`:

| state | stations built | live page window | median fps | samples | gate |
|---|---|---|---|---|---|
| a town-c500 practice room, page window UP | 24 | 1 | **56** | 56,56,56,56,56 | 45 |
| the concert hall, window hidden | 24 | 0 | **56** | 56,54,56,56,56 | 45 |
| back OUT on the world, same process, high | — | — | 44 | 43,44,46,44,45 | 40 |

The third row is the regression check, not the gate: 1,185 structures and 44
landmarks at quality high, in the same window and the same minute, against
RUNBOOK's own last world measurement of 46 median. There were 48 other Chrome
processes on the box at measurement time — the instrument this file already
warns about twice — so read the world row as "unchanged", not as an absolute.

Why it is not the session city's >= 50: the hall's page window is the same
compositing cost PAGE-WINDOW-DOC measures at eight to ten frames a second, and
the hall carries the world's 1,185 structures in a scene it is not drawing.
`frame()` in `world.js` skips the sea, the cranes, the sign projection, the
drone orbits and the landmark props while `Interior.inside()` is true, which is
what pays for it — none of those is visible from inside a practice room.

### The frame-rate gate

**≥ 40 fps at quality high, ≥ 55 at medium**, at 1440×900, with the whole world
standing. Measured 2026-09-05 in a **headed** Chrome window (`ANGLE (AMD, AMD
Radeon(TM) 860M Graphics (0x00001114) Direct3D11)`):

| quality | fps | structures | trees | roads | local links | trunks | bridges | towns | cranes | drones |
|---|---|---|---|---|---|---|---|---|---|---|
| high — shadows on, 512² reflection | **60** | 1,136 | 2,055 | 307 | 256 | 25 | 45 | 125 | 123 | 4 |
| medium — shadows off, 256² reflection | **60** | 1,136 | 2,055 | 307 | 256 | 25 | 45 | 125 | 123 | 4 |

60 is the `requestAnimationFrame` cap, so there is headroom above it this cannot
see. The viewport was 1442×822 at `devicePixelRatio` 2 — the renderer caps the
ratio at 1.5, so 2163×1233 backing pixels, which is *more* work than 1440×900 at
dpr 1. 36 asset requests, all 200. Zero console errors on load and after 60 s.

`__links()` reads `{local: 256, trunks: 25, carriedByTrunks: 3262}` — 256 + 3262
is exactly the 3,518 resolved links in `data/vault.json`, which is the check that
the road cap drops nothing.

**Launch the window with occlusion detection off**, or you will measure zero:

```
chrome.exe --remote-debugging-port=9445 --window-size=1456,999 --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion --user-data-dir=%TEMP%\cdp-headed-cl "http://127.0.0.1:4949/world.html?camera=fixed&hour=19.5"
```

Without `CalculateNativeWinOcclusion` disabled, Chrome stops the render loop the
moment another window covers it and `__fps()` returns 0 — which looks exactly
like a hung page and is not one. Measured here twice.

**Measure in a real, fronted window.** The agent Browser pane reports 0 when it
is hidden (`requestAnimationFrame` does not run) and under-reports when five
agents are on the machine. A number under 30 is usually the machine, not the page
— bisect with `__bloom(false)` and `__quality('medium')` before believing it.

**Measure it like this, or the number is wrong by twenty fps.** Two things
quietly ruin a reading and both were doing it here:

1. **Set the quality BEFORE the page builds.** `localStorage.setItem(
   'werkstadt.quality', 'high')` and then a hard reload. The terrain mesh is
   300 segments at high and 220 at medium, so a page that booted at medium and
   was switched to high afterwards measures high-quality lighting on a
   medium-quality mesh. And `setQuality()` rebuilds the sea and marks every
   material for recompilation, so the seconds right after it are shader
   compilation, not rendering.
2. **Turn the auto-degrade off and let it settle.** `__autoDegrade(false)`, then
   twelve seconds, then five samples 1.4 s apart, then take the median. Without
   the first call, five seconds under 35 fps and the page has switched itself to
   medium under the instrument. Without the settle, the 90-frame ring still
   carries the build.
   **Call `__autoDegrade(false)` about three seconds after navigation, not after
   the build.** The world takes ~25 s to build and the auto-degrade fires DURING
   it, so a run that disables it at 26 s has already been switched to medium and
   `__quality()` will say so while the run label says high. Every fps row below
   prints `__quality()` back for exactly this reason.
3. **When another agent's Chrome is on the same GPU, measure A/B, not absolute.**
   `ab.py` in the harness alternates the current build and a saved baseline in
   the same window, round after round, and prints `%` CPU with every row. On this
   machine, with three other agents' browser fleets alive, the same unchanged
   page read 45, 32, 24 and 14 fps within one hour. An absolute number taken then
   is not a measurement of the page; the paired difference still is.

The same code read 33/40 the wrong way and 56/56 the right way, in the same
window, in the same minute.

**Last measured, 2026-09-06, world-polish pass — the gate is MET.** Real fronted
Chrome, 1440x900 (viewport 1442x822 at dpr 2, so 2163x1233 backing pixels), real
GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11)`), 1,177
structures / 45 trade landmarks / 207 page wings / 45 signs / 45 sign masts, measured by the
procedure above (quality into `localStorage`, hard reload, `__autoDegrade(false)`,
settle 12 s, five samples 1.4 s apart, median):

| quality | median fps | samples | CPU at the time | gate |
|---|---|---|---|---|
| high | **56** | 45,48,56,56,57 | 50% | 40 |
| medium | **55** | 54,55,55,55,56 | 39% | 55 |

The bisection in the same window says the scene is still not the bottleneck:
baseline 49, trade landmarks hidden 49, `__bloom(false)` 50. Nothing this pass
added shows up in the frame time — the five extra instanced pools (white, timber,
roofGable, roofFlat, and the sign masts riding in `lmCyl`) are five draw calls,
and the per-frame sign solve is 45 projections.

**Two ways this same code read BELOW the gate in the same session, both of them
the instrument and not the page:**

1. **A headless capture browser still alive on the same GPU** — 36 at high. The
   trap RUNBOOK already warns about, seen again. Kill every other Chrome first.
2. **REUSING one headed Chrome process across many measurement runs** — this one
   is new and it cost an hour. Each run navigates twice, and every navigation
   leaves its `/api/world/stream` connection and its WebGL context behind; after
   about eight runs the same code, the same scene and the same box read 34, and
   the bisection said the sea and the bloom had become expensive. A FRESH
   `--user-data-dir` and a fresh process, same minute, same 50% CPU: **56**.
   Measure each quality in its own browser process, and treat a slow reading as
   a suspect instrument until a fresh process agrees with it.

There is also a third, older one: a page whose harbour has not converged. A cold
`/api/world` leaves the un-computed trade towns as GENERIC quarters, which puts a
few hundred extra houses in the scene and takes 25 landmarks out of it — a
different scene from the one the gate is about. Poll `__landmarks().shaped >= 45`
before reading, and call `__autoDegrade(false)` BEFORE that poll, or the
auto-degrade fires during the wait and a 'high' run reports a medium number.

**Superseded — the twelfth pass's numbers, kept for the record.** Real fronted
Chrome, 1440x900, real GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics, D3D11)`),
1,065 structures / 2,235 trees / 142 towns / 45 trade landmarks / 207 page wings,
CPU at 50% with 56 other agents' Chrome processes on the box:

| quality | median fps | samples | gate |
|---|---|---|---|
| high | **57** | 56,57,57,57,57 | 40 |
| medium | **56** | 56,56,56,56,57 | 55 |

The bisection in the same window says the scene is no longer the bottleneck at
all: baseline 57, sea hidden 56, landmarks hidden 57, `__bloom(false)` 56.
Everything is inside the browser's own cadence, so the remaining lever (forest
impostors) would buy nothing and was not built.

**Three ways this number lies, all seen in one session:**

| reading | why |
|---|---|
| 37 high / 49 medium | the box at 51% CPU with 64 other agents' Chrome processes on it. Same code, twenty minutes earlier |
| 39 high / 55 medium | measured on `?hour=22.4`, the NIGHT url, where every window in the world is lit and the bloom has something to do. The gate url is `?hour=19.5` |
| 43 high, samples 39,40,43,57,57 | taken while the page was still rebuilding the harbour, with 16 of 45 landmarks standing — a cold `/api/world` fills its trade cache lazily. Warm it with a few `curl /api/world` calls first |

The way to tell a real regression from a busy machine is the bisection below: if
hiding the sea, the bloom or the landmarks MOVES the number, the scene is the
bottleneck and there is something to fix. If it does not, the machine is.

**Superseded — the realism pass's failing numbers, kept for the record.** Real
fronted Chrome, 1440x900, real GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics,
D3D11)`), 1,210 structures / 2,050 trees / 142 towns: **high 27, medium 30**,
against a gate of 40 / 55. The machine was at ~52% CPU with 91 chrome+node+python
processes from other agents. The bisection in the same window:

| | median fps |
|---|---|
| baseline, high | 29 |
| `__bloom(false)` | 33 |
| ...and the sea hidden | 44 |
| ...and the forest hidden | 50 |
| ...and the terrain hidden | **55** |

The empty scene caps at 55, so the medium gate was unreachable on the box in that
state regardless of the code. Re-measure on an idle machine before quoting either
number, and bisect the same way before changing anything. The order of cost, re-measured
2026-09-06 after the twelfth pass, is now
**sea reflection > bloom ≈ trade landmarks > forest > terrain** — the terrain,
which used to be third, measures zero.

**Re-measured 2026-09-06, giant-label / sign-mapping fix.** By the procedure
above — quality into `localStorage`, hard reload, `__autoDegrade(false)`,
settle 12 s, five samples 1.4 s apart — a real headed Chrome window
(`--disable-features=CalculateNativeWinOcclusion`, ANGLE/D3D11): **47, 46, 44,
46, 46**, median **46**, at high quality, 1,177 structures / 45 landmarks / 207
wings / 45 signs. Clears the 40 fps high-quality gate. This is below the
56-median row recorded for the world-polish pass on the same machine, and the
gap is the instrument RUNBOOK already names, not a regression: at least four
other browser tabs against this same server were open on this machine at
measurement time (`tabs_context` during this pass), and RUNBOOK's own note
above records a 15-frame swing from concurrent Chrome/agent load alone with
nothing about the page changed. `updateDroneLabels()` (the fix itself) is five
to ten sprite `scale.set()` calls a frame — smaller than the 45 sign
projections `updateSigns()` already does every frame and already measured at
about one frame per second — so no material regression is expected from it
structurally, and the unstressed baseline here still clears the gate.

### The frame rate after the persistence + touch pass (2026-09-06) — the high gate is met, and the A/B says the layer is not the cost

Headless Chrome on SwiftShader (the shots' own instrument — a real fronted GPU
window was not available on this box in this window), 1440×900, one fresh
navigation per row, RUNBOOK procedure exactly: quality into `localStorage`,
hard reload, `__autoDegrade(false)` at ~3 s, poll `__structures() > 0` and
`__landmarks().shaped >= 40`, settle 12 s, five samples 1.4 s apart, median.
**A is this build; B is the SAME build with `?life=0`**, which is the control
the living-layer pass established.

| row | samples | median | gate |
|---|---|---|---|
| A — quality high, default framing | 46, 44, 43, 38, 36 | **43** | 40 |
| B — the same, `?life=0` | 40, 36, 36, 35, 33 | **36** | — |
| A — quality high, **`?focus=harbour`** | 25, 24, 24, 22, 22 | **24** | 40 |
| B — the same, `?life=0` | 29, 30, 29, 29, 30 | **29** | — |
| phone emulation, 390×844 dpr 3, `?mobile=1`, quality medium | 40, 39, 41, 50, 53 | **41** | 30 |

**`?focus=harbour` does not clear the gate, and it did not before this pass
either.** The living-layer pass measured **22** there on the OLD harbour view
(`docs/TESTS.md`, row L11), so the close dense frame — 104 m over the busiest
end of the shore, with the crowd, the traffic, the fleet and the whole prop
shell inside it — is where this world costs the most, and re-composing the view
did not create that. What IS new information is the A/B: at the wide shot the
control read LOWER than the build (noise), and at the harbour it reads five
frames HIGHER, so at that framing the living layer really is the difference.
The lever if it ever has to move is `LIFE_CAPS` and `KIT_MAX_LOD0`, in that
order — measured, not guessed, and on a quiet box, which this was not.

**The A/B is the reading, and it is the useful one: A measured SEVEN FRAMES
ABOVE its own control.** Turning the entire living layer off made the page
slower, which is impossible as a property of the scene and is exactly the
machine noise RUNBOOK already records a 15-frame swing for — `chrome.exe` went
from 24 to **70 processes** during this run, all of them other agents', and a
warm `/api/world` took 23 s at the peak. So: the high-quality gate is met with
three frames of margin even under that, and nothing this pass added shows up
against the control. Read every absolute number here as a floor.

`?demo=print` and the seed both run AFTER the page is interactive, so neither
is inside the settle window; `seedPrintedBuildings()` was still fetching during
the first samples of some rows, which is another reason the early samples in a
row read low and the late ones high.

**A harness trap that silently invalidates a whole quality row, and it cost one
here: `localStorage` IS PER ORIGIN.** A harness that navigates to `about:blank`,
writes `werkstadt.quality`, and then navigates to `127.0.0.1:4949` has written
the setting to the blank page's own opaque store and the world never sees it —
the run boots at whatever the origin already had. The medium row of this pass
was measured that way and is void: it printed **`quality high`** back while the
run label said medium, which is the only reason it was caught. **Navigate to the
ORIGIN first, write the key, then reload onto it** — and keep printing
`__quality()` on every fps row, because that print is the whole defence.

**What the void row is still worth knowing.** It read median **34** on samples
32, 34, 34, 36, 36 — the same `quality high` configuration that had read **43**
a few minutes earlier in the same process, on a box that had gone from 24 to 70
foreign `chrome.exe` processes in between. Nine frames, no code change. That is
the swing RUNBOOK keeps warning about, measured again.

### The frame rate after the kit town (2026-09-06) — NOT MEASURED CLEAN, and why

**The gate could not be read on this machine on 2026-09-06.** Four other agents'
Chrome fleets (`cdp-bld-9471`, `cdp-globe-realism-b`, `cdp-globe-r3b`,
`cdp-life-9401b`) were driving WebGL on the same integrated GPU for the whole
pass, at 55-85 % CPU. The **unchanged** pre-kit build read 45, 32, 30, 24, 21,
18 and 16 fps at the same view within one hour, so no absolute number taken then
is a measurement of the page. Both builds are far under the 40 / 50 gate under
that load; the last clean reading of this page, on 2026-09-06 before the fleets
came up, was 56 high / 55 medium (the table above).

What CAN be read under load is the paired difference, and that is what `ab.py`
in the harness does: it alternates the saved pre-kit build and the kit build in
the same window, round after round, five samples and a median each, and prints
`%` CPU per row. Three rounds, 1440x900, quality forced into `localStorage`
before the build, `__autoDegrade(false)`, settle 12 s:

| round | view | quality | pre-kit | kit town | delta | CPU bak / new |
|---|---|---|---|---|---|---|
| 1 | default | high | 21 | 31 | +10 | 65% / 83% |
| 1 | default | medium | 21 | 29 | +8 | 74% / 63% |
| 1 | `?focus=harbour` | high | 18 | 18 | 0 | 74% / 74% |
| 1 | `?focus=harbour` | medium | 23 | 21 | -2 | 83% / 75% |
| 2 | default | high | 21 | 16 | -5 | 79% / 67% |
| 2 | default | medium | 21 | 15 | -6 | 65% / 64% |
| 2 | `?focus=harbour` | high | 17 | 15 | -2 | 85% / 78% |
| 2 | `?focus=harbour` | medium | 15 | 21 | +6 | 69% / 67% |
| 3 | default | high | 18 | 19 | +1 | 63% / 72% |
| 3 | default | medium | 27 | 21 | -6 | 55% / 59% |
| 3 | `?focus=harbour` | high | 16 | 15 | -1 | 83% / 68% |
| 3 | `?focus=harbour` | medium | 19 | 18 | -1 | 70% / 61% |

Median paired delta: **default high +1, default medium -6, harbour high -1,
harbour medium -1**, against a round-to-round spread of ±6 on the same build.
The kit town, the LOD shell and the prop shell are **within the noise of the box
world they replaced** — which is what the design is for: at the wide framing the
whole town is 26 draw calls, and the props do not exist past 115 m.

**Re-run the gate properly when the machine is quiet:** kill every other Chrome,
confirm with
`Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { ($_.CommandLine -split '--user-data-dir=')[1] }`,
then use the procedure above at `world.html?camera=fixed&hour=19.5` and at
`?focus=harbour`. **Until that is done the gate row for this pass is FAIL, not
PASS** — an unread instrument is not a passing number.

### The frame rate after the living layer (2026-09-06) — the gate is NOT proven, and the A/B says why

Same instrument, same procedure, same problem: this box was carrying four other
agents' work and their browser fleets through the whole window, and the CPU
reading moved between **31% and 68% inside one A/B pair**. Real headed Chrome on
the real GPU (`ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11)`),
1440x900 at dpr 1, quality forced into `localStorage` before the build, hard
reload, `__autoDegrade(false)` three seconds after navigation, settle 12 s, five
samples 1.4 s apart, median. **A** is this build. **B** is the same build with
`?life=0&drones=orbs` — the fallback flags, kept for exactly this.

| round | view | quality | A (alive) | B (`life=0&drones=orbs`) | A − B | CPU A / B |
|---|---|---|---|---|---|---|
| 1 | default | high | **36** | 30 | **+6** | 68% / 51% |
| 2 | default | high | **31** | 26 | **+5** | 49% / 31% |
| 1 | `?focus=harbour` | high | **22** | 18 | **+4** | 32% / 71% |
| 1 | default | medium | **33** | 30 | **+3** | 60% / 73% |

**Read that the right way round.** A is not faster *because* of the living
layer — a layer cannot make a frame cheaper. It is faster because the CPU under
the two halves was not the same, which is precisely why an absolute number taken
in this window is not a measurement of this page. What the pair DOES establish,
and it is the thing worth establishing: **the living layer and the fleet do not
show up in the frame time at all.** In **four pairs across three views**, the build
carrying 130 people, 52 vehicles, 20 animals, 111 birds and 6-8 ORNIS craft was
never slower than the same build with none of them — including at
`?focus=harbour`, which is the view the crowd and the traffic are actually IN,
and at medium, where the caps halve the population.

**The gate — 40 fps high, 50 medium — is therefore FAIL, not PASS.** The
control row proves it is the instrument: the last clean reading of this page on
an idle machine was **56 high / 55 medium**, and the `?life=0&drones=orbs` build
— which is the same code the 56 was measured on, minus this pass — reads
**26-30** in this window. Nothing measured here is about this pass. Re-run it on
a quiet box, control first:

1. Kill every other Chrome and confirm with
   `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ForEach-Object { ($_.CommandLine -split '--user-data-dir=')[1] }`.
2. Run `?life=0&drones=orbs` FIRST and check it reads 55-60. If it does not, stop.
3. Then run the same view alive, in the same window, in the same minute.

Two things this pass measured that are NOT frame-rate-dependent and do hold:

- **Draw calls: 13-33 for the whole living layer** (`__life().draws`), against a
  budget of 90. The spread is the LOD ladder — the figure is the visible meshes
  under `life.group`, so it rises when the lens is near the crowd.
- **`maxSkinned` 24 and `rigid` 3**, both below the defaults `docs/LIFE.md`
  measures its own numbers at, and both are the levers that doc names as the
  cheapest.

One practical warning for whoever re-runs this: **the world now takes about
seven minutes to reach a measurable state** on this machine — `Life.load()` is
~20 s of decimation on its own, and the harness also waits for
`__landmarks().shaped >= 45`, which needs several `/api/world` polls that a
loaded server answers in 10-18 s each. Budget for it or the run times out
half-built and reports a number for a world that has not converged.

The bisection under load, for whoever re-runs it: hiding `groups.props` and
nothing else took `?focus=harbour` from 23.5 to 30 with the first (larger) prop
caps, and hiding `groups.kit` on top of that bought nothing. The props are the
only thing this pass added that shows in a frame time; the caps in `PROP_SPEC`
were cut against that reading.

### Capture the shots

Same CDP harness as the session city (see above), with two additions this pass
needed. Chrome must be started headless with `--enable-unsafe-swiftshader`; then
`Emulation.setDeviceMetricsOverride` to 1440×900, `Page.navigate`, **wait 11 s in
real wall time** (the world builds 1,133 instanced structures, 2,055 trees and a
splatted terrain out of two fetches; there is no shortcut and
`--virtual-time-budget` races the fetch), then `Runtime.evaluate` the camera
expression, wait ~3.4 s for the fly to land, and `Page.captureScreenshot`.

The five reference captures in `docs/shots/`, and the exact expression each one
was taken with:

| shot | url | camera |
|---|---|---|
| `world-dusk.png` | `?camera=fixed&hour=19.5` | the default framing (`frameCamera()`: dist 900, phi 0.35, theta 1.30) |
| `world-mountain.png` | `?camera=fixed&hour=19.5` | `__goto(-150,-120,215,0.26)` |
| `world-river.png` | `?camera=fixed&hour=19.5` | `__select('2026-08-14'); __goto(-22,35,120,0.38)` |
| `world-harbour.png` | `?camera=fixed&hour=19.5` | `__goto(120,10,150,0.28)` |
| `world-night.png` | `?camera=fixed&hour=22.4` | `__goto(60,20,420,0.30)` |
| `world-landmarks.png` | `?camera=fixed&hour=19.5` | **`__goto(95, -95, 88, 0.34, 0.80)`** — these are the numbers `HARBOUR_VIEW` used to hold. It stopped being `?focus=harbour` on 2026-09-06 when that constant was re-composed into an actual harbour view; the landmark frame is unchanged, it just has to be asked for by hand now |
| `world-street.png` | `?camera=fixed&hour=19.5` | `__goto(36.0,285.0,23,0.12,2.42)` — eye level (~5 m above ground) at the south end of the harbour, a brick apartment and a plaster townhouse at ~10 m with a lamp post, a bench, a fence and a real tree in frame. **This is the frame the kit town is judged on.** The spot was chosen with `__dbg.plan()` — a `house` record with 6 to 12 neighbours inside 22 m and no trade quarter within 26 m, so the frame is a street and not a landmark plaza |

### The four shots the living island is judged on (2026-09-06)

Same harness, plus one thing this pass had to learn: **poll the camera until it
has LANDED before the shutter.** Headless here runs at a few frames a second
with 150 actors in the scene, so a fixed `sleep(4500)` after a `__goto` catches
the fly-in half way — the first capture of this pass came back at dist 379 for a
`__goto(...,150,...)`. Poll `Math.abs(__cam().dist - D) < 4`, then hold 3 s.

| shot | url | camera |
|---|---|---|
| `world-harbour.png` | `?camera=fixed&hour=19.5&focus=harbour` | **none — `?focus=harbour` IS the camera** (`HARBOUR_VIEW` in `world.js`, `= __goto(120, -232, 104, 0.31, 4.60)`). Re-composed 2026-09-06 so the frame actually contains a harbour: sea and the offshore island in the left third with the surf running diagonally, moored ships, the quay and its trees up the middle, and the live end of the shore (`werkstadt`, `wild-digital-moments`) with their craft on the right. **theta 4.60 looks ALONG the shore and not at the sunset, and that is not a mistake:** on this island the sea is at +x and the sun sets at −x (`__dbg.sun()` at 19:30 reads azimuth −3.01 rad), so a lens that faces the sunset has the water behind it. Looking along the shore is the only frame that holds both, and it rakes the light across the facades instead of flattening them |
| `world-mobile.png` | `?mobile=1&hour=19.5` | 390×844 with `Emulation.setDeviceMetricsOverride {mobile:true, deviceScaleFactor:3}` + `Emulation.setTouchEmulationEnabled {maxTouchPoints:5}`. No `__goto`: the shot is the default framing with the hint SHEET showing, which is what the preset is judged on. Un-hide it with `document.getElementById('hints').hidden = false` — its own six-second timer has long expired by the time the world has built |
| `world-street.png` | `?camera=fixed&hour=19.5` | eye level ON the quay: `__quay()` gives the promenade; take the node with the most neighbours inside 40 m whose `y <= 8` (this vault: `(3.6, 214.9)`, 68 neighbours), set `theta` to `atan2` along the line **+ π** so the pavement runs away from the lens, then aim **`x + 10`** and stand at **`dist 30, phi 0.11`**. The three numbers matter and were each found by a bad capture: at `dist 18, phi 0.06` and no offset the lens is pressed against a wall with nothing but render in frame; at offset **17** it is inside the NEXT wall (the offset is not "seaward" everywhere — at the south end of the shore the coast has turned). 30 / 0.11 / +10 puts a lamp post, a barrel, lit windows on both sides and the trees behind them in one frame, which is what this shot is for |
| `world-print.png` | `?camera=fixed&hour=19.5` | `__nextPlot(town)` for the busiest live town, `__goto(plot.x, plot.z, 30, 0.40, 0.30)` — **from the SEAWARD side**, because the plot is the quarter's back yard and standing inland of it is standing inside the next quarter's houses. Settle, then `__pulse(town,'Write',path)` and poll `__print().k > 0.30 && __print().k < 0.62` |
| `world-night.png` | `?camera=fixed&hour=22.4` | `__goto(60,20,420,0.30)` — unchanged. **Do NOT read the lit-window gate off this frame**, see below |

`world-landmarks.png` is the frame the trade-landmark pass is judged on. As of
the giant-label / sign-mapping fix (HANDOFF -> "Giant ticker labels and the
site-editor sign") `HARBOUR_VIEW` moved:

- **`?focus=harbour` used to stand at `(76,-256,86,0.34,0.80)`, over
  `site-editor`'s barrel VAULT.** That vault is real geometry, but
  `__landmarkAt('site-editor')` shows `site-editor` is trade "MusicSchool"
  by a server.py keyword-classifier bug (its own docs name the town-c500
  demo as its live reference; see server.py's `_keyword_trade_type()`) — it
  is a SoftwareSourceCode project, not a music school. The old comment here
  asserted "three unlike silhouettes" without checking which one was real.
  That is a server.py data bug and out of reach from `world.js`/`biomes.js`.
- **The view now stands at `(95,-95,88,0.34,0.80)`, over the ACTUAL music
  school.** `town-c500`'s own concert hall, `town-91a7`'s school and
  `werkstadt`'s code shop are the three forms in frame, each with its own
  sign legible (`__signPixels()` there: 22 visible, 7 culled, min and median
  22 px against an 18 px floor). Same method as before, still the right one:
  `__dbg.plan().quarters.filter(q => q.formKey)` prints every shaped town
  with its form and its x/z — use it if the harbour is ever re-ordered, and
  cross-check a candidate town with `__landmarkAt(name)` before trusting its
  form.
- **The signs used to be the compromise and are not any more.** The
  twelfth-pass camera stood 200 units back because that was the only frame
  that held three NAMED towns, and at 200 units the forms did not read.
  Since signs are scaled to a pixel target rather than to a world size, the
  camera can stand at under 90 units and the names are still ~22 px tall.
- **Never point the camera away from the sunset.** `theta` near pi puts the
  sun behind the frame and the whole capture comes back as a night shot at
  19:30. Every camera in this list looks within a quadrant of the sun. 0.80
  here, unchanged by the move.
- **A drone/agent name tag is no longer a flat world-space multiply.**
  Before this pass, `makeDrone()`'s label sat at a fixed `multiplyScalar(4
  or 5)` on top of `makeLabel()`'s own scale — a WORLD size with no distance
  term — so any camera within roughly 90 units of a live town blew a
  clipped session prompt up across the whole frame ("Goal check-in:
  «...»", ~80 px tall, at the bottom of `world-landmarks.png`).
  `updateDroneLabels()` now solves it every frame the same way
  `updateSigns()` solves a sign, at a 14 px cap (`LABEL_CAP_PX`, the same
  cap the session city's own DOM ticker holds its line to). Verify with
  `docs/shots/world-harbour.png`'s `__goto(120,10,150,0.28)` camera, which
  stands close enough to two live towns to have shown the bug before this
  fix and shows small legible tags after it.

### Reading the LOD1 night skyline — 200 m, not 420 (2026-09-06)

`buildings.js` bakes a second, lit facade per style + palette and `setNight()`
cross-fades to it on a `uNight` uniform (docs/BUILDINGS.md, "The night skyline
lost its lit windows"). `world.js` drives it from the same lamp ramp its own
windows follow and adds nothing of its own — there is no island-side workaround
to remove, and `grep -n 'fixLod1Roofs\|workaround' world.js` returns nothing.

**`world-night.png` at 420 m cannot see it, and that is geometry, not a bug.**
At `__goto(60,20,420,0.30)` a two-storey house is about ten pixels tall and its
windows are sub-pixel, so the metric barely moves. Measured 2026-09-06 with a
warm/bright pixel count (luminance ≥ 90 AND R−B ≥ 18, which is the only pair of
conditions a lit window meets and the sky, the sea and the moon do not):

| frame | lit px | share |
|---|---|---|
| `world-night.png`, dist **420** | **1,352** | 0.10 % |
| same night, same build, dist **200** over the harbour (`__goto(105,-60,200,0.26,0.80)`) | **5,599** | 0.43 % |
| dist 120 | 5,651 | 0.44 % |

**Read the gate at 200 m.** 4.1× the lit pixels for a 2.1× closer lens is the
windows resolving, not more of them lighting up, and at 200 m the individual
warm and pale window rectangles are visible across the LOD1 field in the frame
itself. `world-night.png` stays at 420 m because it is the island's wide night
picture, and it is not the instrument for this.

**A trap that will waste a pass:** the 17:32 baseline `world-night.png` ALREADY
had the bake in it — `buildings.js` landed it before `docs/shots/buildings-night.png`
was taken at 16:40 the same day — so a "before/after" at that camera compares
the feature with itself. It reads 12,839 → 12,864 lit px, which is noise.
Confirm the mechanism with the probe instead: every LOD1 instanced group's body
material carries `material.userData.uNight`, and at `?hour=22.4` all 26 of them
read **1**.

### The phone, and how to drive it over CDP (2026-09-06)

`world.html` has a touch layer and a mobile preset since 2026-09-06. Both are
verified with Chrome's own touch emulation — there is no second code path for a
"test mode", the events the harness sends are the events a finger sends.

Set the device up BEFORE navigating, three calls in this order:

```
Emulation.setDeviceMetricsOverride { width: 390, height: 844, deviceScaleFactor: 3,
                                     mobile: true, screenWidth: 390, screenHeight: 844 }
Emulation.setTouchEmulationEnabled { enabled: true, maxTouchPoints: 5 }
Emulation.setUserAgentOverride     { userAgent: <an Android Chrome UA> }
```

`mobile: true` plus touch emulation is what makes `matchMedia('(pointer: coarse)')`
answer true, which is what the page's own auto-detection reads. **Do not rely on
that alone in a harness** — navigate to `?mobile=1` as well, so a run that
silently lost the emulation fails loudly instead of quietly measuring the
desktop build. `?mobile=0` refuses the preset on a real phone, which is how you
compare the two on one device.

Gestures are `Input.dispatchTouchEvent`, and every one of them needs an `id` per
touch point or the second finger is read as the first one moving:

| gesture | events |
|---|---|
| one-finger orbit | `touchStart` [1 point] → several `touchMove` with the point walking → `touchEnd` [] |
| pinch / twist | `touchStart` [2 points] → `touchMove` with both points moving apart and rotating → `touchEnd` [] |
| tap | `touchStart` → ~70 ms → `touchEnd` |
| double tap | two taps under 320 ms apart and within 40 px |
| long press | `touchStart` → **900 ms** → `touchEnd` (the page's own threshold is 480 ms) |

Read the result off `__dbg.cam()` (`th` for the orbit and the twist, `d` for the
pinch) and off `#caption` for tap and long press, not off a screenshot: a
screenshot cannot tell a caption that opened from one that was already open.

**What the preset actually changes, and what it does not.** Three of the five
knobs were already at spec before it existed and the run should print all five
rather than assume any:

| knob | on the phone | how |
|---|---|---|
| quality | `medium` | `MOBILE` forces it at module load — assigned, NOT put through `setQuality()`, so a desktop that once opened `?mobile=1` does not find its own preference rewritten in `localStorage` |
| shadows | off | falls out of quality medium (`renderer.shadowMap.enabled = quality === 'high'`) |
| living-layer budget | halved | falls out of quality medium too — `LIFE_CAPS.medium` is half of `high` across the board |
| devicePixelRatio | ≤ 1.5 | **already the cap for every device** since the page was written (`init()`), so a 3x phone screen was never rendered at 3x. `renderer.getPixelRatio()` proves it |
| bloom | half the frame | **already the default** (`resize()`), and it is the single most expensive pass in the scene |

The one thing that is only true on the phone is the hint SHEET: `body.mobile`
in `world.css` turns the 12 px floating line into a 14 px sheet on the bottom
edge with `env(safe-area-inset-bottom)` under it, and `world.js` rewrites its
contents from keyboard keys to the gestures above.

`world-vs-city.png` is a sixth, and it is not a capture: it is `world-dusk.png`
pasted beside `city-090.png` with PIL, at full size, with a one-line label over
each half. It is the picture the realism bar is actually judged on — a stranger
shown it must not be able to say which render is the less real one — so it is
rebuilt from the two PNGs every time either of them is re-shot.

Three additions to the harness this pass needed, all of them things that quietly
produce a wrong shot rather than an error:

- **Wait for the BUILD, not for the clock.** The world now builds 1,210 instanced
  structures and a splatted terrain out of two fetches, and on a loaded machine
  that can take well past the 11 s the old procedure allowed. Poll
  `__structures() > 0` after the wall-clock wait; a capture taken early comes back
  as an empty sea with a masthead on it, and the probe line reads `structures:0`,
  which is the tell.
- **Force `__quality('high')` immediately before the capture, then hide the
  toast.** The auto-degrade below 35 fps fires within the first few seconds under
  SwiftShader, so an unforced reference shot is a medium-quality shot with the
  shadows off. `document.getElementById('quality').hidden = true` after the call,
  or the toast is in the frame.
- **`server.py` restarting mid-run is normal** when another agent is in the repo.
  It shows up as `ERR_CONNECTION_REFUSED` in the console count and as
  `structures:0`. Re-run the shot; do not go looking for a bug in the page.

Two traps that cost time here, both still true: `/json/new` needs **PUT** on
Chrome 152, and you must **reuse one page target** — each stale one keeps its
`/api/world/stream` open and after half a dozen runs the browser stops answering.
A third, new: MSYS rewrites paths inside arguments to `node` and `chrome.exe`, so
prefix every capture command with `MSYS_NO_PATHCONV=1` and pass absolute `C:/…`
output paths.

### How the towns are keyed

Not by a session's `cwd` but by the dominant project directory of its file-tool
paths — `resolve_project_dir()` in `server.py`, unchanged by this pass. That is
why there are 125 towns and not 10, and why sub-projects that live loose inside
the chat folder get their own quarter. The full account of that change, including
the measured before/after per project, is in `HANDOFF.md` under *The world map,
re-keyed by project*.

### Checks before calling the world working

| # | check | command / action | expected |
|---|---|---|---|
| 1 | the server answers | `curl http://127.0.0.1:4949/api/world` | JSON with `towns`, `roads`, `meta` |
| 2 | the land stands without it | stop `server.py`, reload | the island draws; a line says the harbour is empty and how to start the server |
| 3 | every link is accounted for | `__links()` | `local + carriedByTrunks` equals `counts.resolved` in `data/vault.json` |
| 4 | one bridge per daily note | `__bridges()` | 45, the `Daily` count |
| 5 | one drone per agent | `__drones()` against `meta.agent_slots` in `/api/world` (NOT `meta.agents_in_flight` -- see the note below) | equal |
| 6 | nothing stands in the water | fly the coast and the river | no building on a water surface |
| 7 | the caption reads as sentences | click a note, then a live town | words/inlinks/age; then prompt, agents, open items |
| 8 | search | `__search('14.8')`, `__search('yesterday')`, a project name | each returns a hit and the camera flies |
| 9 | frame rate | `__fps()` in a fronted window | ≥ 40 high, ≥ 55 medium |
| 10 | console is clean | DevTools on load and after 60 s | zero errors |
| 11 | textures actually loaded | Network tab, filter `assets/` | all 200. 246 requests since the scanned prop pack landed (13 more `.glb` and their maps), up from 36 |
| 12 | studio seal | `grep -c WDM-SEAL world.html` | `4` |
| 12f | the houses are KIT buildings | `__kit()` | `buildings` 1,033, `catalogue` naming 13 rows, `lod0 + lod1` summing to 1,033 and **`lod2` always 0** — LOD2 builds no roof and the island is seen from 900 m, so the far band is LOD1 on purpose (HANDOFF -> "The kit town and the prop shell"). `instGroups` 26 at the wide framing |
| 12g | the props are on their leash | `__props()` at `?focus=harbour` | every `placed` value at or under its `PROP_SPEC` cap, `slots` unchanged by the camera, `lights` at most 8, and `realTreesHiding` equal to `placed.treeReal` |
| 12h | the LOD1 roofs are the right size | look at `docs/shots/world-landmarks.png` | roofs about as wide as their walls and as tall as their LOD0 twins. The old `fixLod1Roofs()` workaround was deleted on 2026-09-06 once `buildings.js` `instanced()` scaled the roof prism by `min(w, d)`; if roofs look wrong now, check `__roofRise()` in `buildings.html` — see HANDOFF -> "Upstream fixes" |
| 12i | the globe link | click `globe` beside the title on `world.html` | `globe.html` opens. `#masthead` is `pointer-events:none`, so this one element has to take them back for itself |
| 12a | trade landmarks | `__landmarks()` | `shaped` 45, `wings` 207, `signs` 45, and `forms` naming at least eight distinct shapes |
| 12d | the signs are READABLE | `__signPixels()` at `?focus=harbour` | `minCapPx` 18 or more. Measured 22 there, and 22 at the `world-harbour.png` camera with 22 visible and 12 overlapping ones culled |
| 12e | the houses are not copies | look at `docs/shots/world-harbour.png` | four wall colours (whitewash, ochre plaster, brick, dark timber up in the People village), three roof forms (hip, gable, flat with a parapet), lanes between the rows, and a chimney on about one house in three |
| 12b | a landmark knows its trade | click a shaped town | the caption's first line says what it is built as and which source the type came from |
| 12c | a wing knows its page | hover a wing | the page's title, its file and its size in kB |
| 13 | the vault address still works | open `/vault.html` | forwards to `world.html?focus=vault` |

**`meta.agents_in_flight` vs `meta.agent_slots` (docs/TESTS.md B5b):** an agent
attaches to every town its OWN file-tool calls resolved to, not one town per
whole session (see `_build_world_payload()` in `server.py`), so one subagent
touching two towns rides in both towns' `live_agents[]`. `agents_in_flight` is
the DISTINCT agent count across all live sessions (the masthead's "N agents in
flight" truth); `agent_slots` is `sum(len(town.live_agents))` -- the fanned-out
total that equals `__drones()`, since world.html draws one drone per slot, not
per distinct agent. Both are correct at once and are expected to differ
whenever any agent spans more than one town.

### Checks before calling project metadata working

| # | check | command / action | expected |
|---|---|---|---|
| 1 | trade + logo detected | `curl "http://127.0.0.1:4949/api/project/meta?id=<town>"` for a real project town (e.g. `zahnradpumpe`) | JSON with `trade.type` non-null and `logo` set when the project has one |
| 2 | pages listed | same call | `pages[]` sorted biggest-first, each with `file`, `title`, `bytes` |
| 3 | the logo actually loads | `curl -D- "http://127.0.0.1:4949/api/project/asset?id=<town>&f=<logo.url's f=>"` | `200`, an image `Content-Type`, `Content-Length` matching the file |
| 4 | traversal is blocked | `curl -o /dev/null -w '%{http_code}' "http://127.0.0.1:4949/api/project/asset?id=<town>&f=../server.py"` | `403` |
| 5 | `/api/world` carries it too | `curl http://127.0.0.1:4949/api/world` | every town has `trade` and `logo` keys (null until its 60 s meta cache fills) |
| 6 | never blocks the world payload | time a cold `/api/world` call right after a restart | returns well under a couple of seconds even with towns not yet cached |

### If something looks wrong

| symptom | cause | expected once fixed |
|---|---|---|
| the clock is frozen and `__fps()` is 0 | the tab or the Browser pane is hidden — `requestAnimationFrame` is paused. Not a bug | front the window; the clock resumes |
| `trade.type` is a schema.org type that has nothing to do with the project's actual business (`AdministrativeArea`, `ReadAction`, `Place`...) | a generic/structural JSON-LD type slipped past `GENERIC_JSONLD_TYPES` in `server.py`, or a `.claude/worktrees/` checkout or similarly-named backup dir wasn't pruned by `TRADE_SKIP_DIR_NAMES` | add the type or the directory name and restart |
| `trade.type` looks right for the wrong reason (`Photographer`/`Book`/`SoftwareApplication` from an unrelated sentence in BRIEF/README) | the keyword table's generic entries match ordinary English use of that word — a known, documented limitation, not a crash | see `HANDOFF.md`'s tenth pass "Left for whoever needs it next" |
| the ground is one flat colour with no texture detail | the splat's `vWPos` varying is not being written — check the `project_vertex` replacement in `terrain.js` survived an edit | four layers blended by height and slope |
| the signs are back to being unreadable smudges | `__signPixels()` first — if `minCapPx` is near 22 they are legible and something else is wrong. If it is single digits, the per-frame solve in `updateSigns()` was reverted to a fixed world size, or `SIGN_MIN_H` was raised until it overrides the solve | `minCapPx` at or above 18 wherever the camera stands inside `SIGN_FADE1` |
| a quarter's houses are all one colour and one roof again | the record's `palette` / `roofType` are not reaching `famName()` / `roofName()` in `world.js` — most likely a new placement site in `biomes.js` that calls `structure('house', ...)` without them | four palettes and three roofs, hash-picked per building |
| the harbour is a forest of tall thin columns | the chimney pool is using the works size on domestic buildings — `dom` in the chimney block of `buildWorld()` | a stack about a metre proud of the roof on a house, a ten-metre one on a Dev Logs works |
| the harbour has far fewer landmarks than 45 | `/api/world` computes trade lazily under a 2 s budget and returns `null` for the towns it did not reach — `rememberTrade()` in `world.js` is what stops those being forgotten. If it is fewer than 45 on a COLD server, wait one 30 s refresh | `__landmarks().shaped` climbs to 45 and stays |
| a trade town has a landmark but no wings | its `/api/project/meta` call was reset — the stdlib server drops connections under a burst. There is one retry; more than two in flight brings it back | `__landmarks().wings` around 207 |
| the mountain is covered in even stripes along its contours | a ground texture tiling too small, NOT shadow acne and NOT moiré. `cliff_side` is stratified rock; it needs metres per tile in double figures | rock strata at a believable scale |
| every roof is flat black | the roof prism's material lost `side: DoubleSide`; its gable triangles wind the other way | terracotta roofs |
| the roads are a grey ball of wool over everything | the trunk-road bundling in `biomes.js` was reverted to per-link curves | 332 local roads and 25 trunks |
| a hard straight line across the horizon | the sea plane's own edge is inside the fog's far distance | sea into haze, no seam |
| buildings standing on water | `toLand()` or the river guard in `place()` was bypassed by a new placement site | every box on dry ground |
| the whole world is dark and unreadable | it is night, and that is the information — but the moon floor in `updateSun()` may have been removed | a dark world with lit windows where work happened today |

## Checks before calling it working

| # | check | command / action | expected |
|---|---|---|---|
| 1 | it serves | `python -m http.server 4949`, open `/` | the session title fills in and the clock starts counting |
| 2 | the city builds | watch for ~20 s | plates appear, buildings rise out of them with a dust puff, drones fly |
| 3 | it replays real data | watch the top-right tallies | buildings, tool calls and agents all climb as events arrive |
| 4 | frame rate | `window.__fps()` after ~20 s | 60; anything under 50 is a regression |
| 5 | console is clean | DevTools console on load and after 90 s | zero errors |
| 6 | pause | press `space` | clock stops, `paused` flashes; press again and it resumes |
| 7 | seek | press `→` then `←` | clock jumps ±10 s and the city rebuilds to the right building count, with no slide-into-place |
| 8 | speed | press `]` then `[` | badge flashes `2×` then `1×`, and the replay visibly changes pace |
| 9 | camera by hand | drag, then wait 20 s | the view orbits with the mouse, then the automatic orbit resumes |
| 10 | fallback | rename `data/demo.json` and reload | it falls through to `data/sample.json` instead of a blank page |
| 11 | studio seal | `grep -c WDM-SEAL index.html` | `4`, and the W mark sits in the bottom-right corner |
| 13 | framing | `window.__frame()` after ~90 s | `width` 80-88, `top` 8 or more |
| 14 | the ticker reads as sentences | watch the bottom-left for 30 s | file basenames and real commands - never `<ta…>`, a `task-id`, or a `cd "C:/…"` prefix |
| 15 | one worker per running call | `window.__workers()` while a busy agent is mid-burst | climbs into double figures and falls back to 0 in the quiet; never stuck above 0 for minutes |
| 16 | the cap holds | watch a busy craft | at most 12 workers around it, and a `+n` over it while more are queued |
| 17 | failures are visible | watch for a red smoke trail | 52 of `demo.json`'s 1,688 calls fail; each one sputters home |
| 18 | every drone carries a tag | look at any craft | its agent's task, not an id; workers read `Edit · file.js` / `Bash · npm` |
| 19 | tags are legible from the wide shot | `window.__tags()` | `minGlyphPx` 13 or more |
| 20 | buildings are printed, not raised | watch a new file appear | two red laser bars come down through it, four red scaffolds hold it up, both gone in ~1.2 s |
| 21 | trails | watch any drone move | a thin ribbon behind it — red for writes, blue for reads, gold for the orchestrator |
| 22 | derez | wait for an agent to return | the craft comes apart into falling red voxels, it does not fade |
| 23 | permanence | seek past 30 min of session clock | districts nobody has touched for half an hour are grey; touching one brings its windows back |
| 24 | a city per PROJECT | open `?project=<town>` for a town with more than one session | the serif title is the PROJECT, the mono line reads `N streets · current: …` |
| 25 | a street per session | `window.__streets()` | `count` equals the payload’s `streets` length; `current` is the live session’s title |
| 26 | street signs are legible | `window.__tags()` | `minSignPx` 13 or more, on a real town |
| 27 | a live street is lit | compare the live avenue with a finished one | lamps bright and craft docked on the live one, lamps dim and the sign still there on the finished one |
| 28 | nothing already standing moved | seek back and forth across a street boundary | the same buildings on the same lots; a later session adds FLOORS, never a second building |
| 29 | the street intro | `__seek()` to just before a street’s last event, watch | the camera eases to the new avenue for ~3 s and returns to the wide shot by itself |
| 30 | ?live=1 still works | open `?live=1` with `server.py` running | it resolves the current session’s `town` and opens the whole project, not one session |
| 31 | the two silent breakages | `window.__selfcheck()` | `attrs` exactly `16`, `sphereRadius` positive |
| 32 | a much-edited file is a tower, not a needle | enter `city.js` on `?project=cb09014b` | the caption and the HUD both say **40 floors**, the room has 40 storeys, and the exterior stands about 30 floors tall with a beacon on it |
| 33 | project mode meets the wide-shot gate | `window.__frame()` on `?project=<town>` after ~60 s | `width` 80-88 and `top` 8 or more, held across a full orbit |
| 34 | the page window is the real page | enter an `.html` building on `?project=91a7433c` | the page is laid out with its own type and its own images, `__interior().fixture` is false, and the plaque under it says where it came from |
| 35 | the page window disappears when it should | climb one floor, or turn away from it | the iframe is `display:none` — it cannot be occluded by the walls, so the room hides it instead |
| 36 | the room is furnished with facts | stand on the ground floor of a busy file | a lit terminal per call in flight wearing its tag, dark screens when nothing runs, three event plates by the door, a lamp overhead and the floor number beside the lift |
| 12 | the archived version | open `/archive/tree/` | the 2D radial tree still replays the same data |

## If something looks wrong

| symptom | cause | expected once fixed |
|---|---|---|
| clock frozen at 0:00 | the tab is hidden or backgrounded — `requestAnimationFrame` is paused. Not a bug. | bring the tab to the front; the clock resumes |
| "This browser could not open a WebGL context" | no WebGL — a locked-down browser, or a headless run without `--enable-unsafe-swiftshader` | the city draws; `/archive/tree/` is the 2D fallback |
| "No session to replay yet" | the page was opened from `file://`, or the json is missing/malformed | served over http, the title fills in within a second |
| every caption in the city is Arial | the labels were baked before the webfont loaded — `document.fonts.ready` did not resolve | JetBrains Mono in the scene as well as in the chrome |
| a district appears twice, far apart | it filled up and opened an annex where there was room. By design; see `annexOf()` | both blocks carry the same name |
| the camera sits in a close-up and stays there | a burst focus that never released — check the 33 s cooldown AND the `FOCUS_BUDGET` accounting in `updateCamera()` | it eases back to the wide orbit after 8 s, and at least 60% of any 2-minute window is wide |
| drones hover over buildings and never come home | no `tool_end` is reaching `ingest()` — an old replay file, or a live server that does not pair `id`s | `__workers()` falls back to 0 in the quiet; worst case they time out after 90 s of session clock |
| the whole city is grey | the session clock is far past every building's last touch — permanence, working as designed | a touched district lights up again immediately |
| a building is invisible but its plate is there | its `aPrintY` never came back to -1: a print job that was removed without finishing, or a derez with nothing to bring it back | `__printing()` returns to 0 within about a second of the last file event |
| the city is black and nothing is in the console | the facade program did not link. `__selfcheck().attrs` is 17, not 16 — something added a vertex attribute past the sixteen GL guarantees | `attrs` 16; pack new per-building floats into the existing `aStatic`/`aTags`/`aLive` vec4s |
| hovering a building does nothing, and clicking does nothing | `__selfcheck().sphereRadius` is **-1**: three cached the InstancedMesh's bounding sphere on an empty city and never invalidated it. The by-name entries (`__enterFile` etc.) keep working, which is how this hid through four passing captures | a positive radius, roughly half the city's diagonal |
| a room shows `FIXTURE` on a town you know the server can read | the city's `rel` is not the town's own relative path — `chooseRoot()` landed above the town root. `__interior().fixture` is the check | `fixture` false; see HANDOFF open item 12 |
| the page window in an `.html` room is blank white | that page draws itself with script, and script cannot run in that frame by design. `werkstadt`'s own `index.html` is exactly this case | a page whose content is markup renders; `town-91a7` is the reference |
| a headed capture reads 0 fps and a frozen clock even though the window is on screen | `document.hidden` is true — the window is occluded or unfocused, and `Page.bringToFront` alone does not clear it | send `Emulation.setFocusEmulationEnabled {enabled:true}` and `Page.setWebLifecycleState {state:'active'}` after `Page.enable`; `document.visibilityState` reads `visible` and the clock runs |
| the city is small in the frame and the ground is empty | `FRAME_FILL` in `city.js`, or something putting a stray point into `cityBounds()` | `window.__frame().width` between 80 and 88 |
| the upper half of the frame is one flat colour | the ground plane is opaque again — from this camera it covers the whole frame and the sky dome is never seen. The alpha fade at the end of the ground fragment shader is what makes a horizon | a dusk band above the far streets, and stars in it at the night keyframes |
| the tally captions vanish over the sky | the top scrim or the ink shadow in `styles.css` was reverted | readable against the brightest part of the dusk band |

## The Globe — `globe.html` <!-- GLOBE-DOC -->

A planet, not an island: a 600-unit sphere with five continents, an ocean, an
atmosphere and a day/night terminator taken from the wall clock. Every project
`/api/world` knows about stands on it as a city, a town, a village, a hamlet or
a field. Needs `server.py` for the settlements; without it the planet still
builds and says so in words.

```
python server.py
```

| url | what it gives you |
|---|---|
| `/globe.html` | the planet, turning slowly |
| `/globe.html?camera=fixed` | no auto-rotation — every capture below uses this |
| `/globe.html?screensaver=1` | hides the hints, the hover line and the quality toast, and halves the rotation. Verified: `document.body.classList` carries `screensaver` and `#hints` computes to `display:none` |
| `/globe.html?hour=19.5` | forces the clock the SUN is lit by. The masthead clock stays on the real wall time — only the terminator moves. The shot list is the only thing that uses it |
| `/globe.html?focus=<name>` | fly to that settlement, continent or vault region on load |

| gesture / key | does |
|---|---|
| drag | turn the planet. Sensitivity falls with altitude, so one centimetre of mouse is a continent from orbit and a street on the ground |
| scroll | zoom, log — one notch is a constant RATIO, so orbit-to-street is the same number of notches wherever you start. 3,400 down to about R + 3 |
| hover | the settlement's name, its class and how long ago it last moved |
| click | the caption: the class, the real tool-call and edit counts, the last time it was worked, its continent and its landmark |
| double-click | fly in and hand over — `index.html?project=<id>` for a project, `world.html?focus=vault` for the vault |
| `/` | the address search: a settlement, a continent (`Werkland`, `Neuland`, …) or a vault region (`Knowledge`, `Dev Logs`, …) |
| `q` | quality high ↔ medium |
| `esc` | close the caption, or the search |

### The camera, and why it lies down on its own

There is no camera mode. `cam.tilt = smoothstep(260, 25, altitude)` — straight
down above 260 units, fully out to the horizon below 25 — and everything else
follows from it: the pitch, how far ahead the aim sits, and the screen's up
vector. Two numbers that were wrong and are worth not re-breaking:

- **The tilt curve is 260/25, not 900/60.** At 900 the tilt was already 0.7 by
  the time the frame held one continent, and the continent capture came back four
  fifths sky. A region view is a map; it is looked at from above.
- **`camera.up` is local NORTH at orbit**, eased to local UP as the tilt comes
  on. It cannot be local up at orbit: looking straight down, the direction from
  the target to the camera IS the local up, so `lookAt` gets a forward vector
  parallel to its own up and the orientation is undefined. The planet slid off
  the frame between two captures reporting the same lat, lon and distance.

### Probes

```js
window.__fps()            // rolling average over the last 90 frames
window.__planet()         // { landFraction, faces, triangles, buildMs }
                          //   GATE: landFraction ~0.35. Measured 2026-09-06: 0.35
window.__clouds()         // fraction of the deck's texture that is cloud. ~0.39
window.__settlements()    // { total, city, town, village, hamlet, fields }
window.__structures()     // { lod1, parcels, barns } — lod1 is every building on
                          //   the planet as a BuildingKit LOD1 instance
window.__trees()          // trees standing. ~12,000
window.__treeSpecies()    // { broad, conifer, quiver, trunkMeshes, trunksOn }
                          //   the forest by species. quiver is the pack's model
                          //   and only grows in the hot dry band; trunksOn is
                          //   the sub-350 m half of the tree LOD
window.__overlaps()       // { pairs, worst, lots, dropped }
                          //   GATE: pairs === 0, on every settlement. The same
                          //   2D separating-axis test the lot planner accepts
                          //   lots with, run on the RAW footprints — so it
                          //   measures what is drawn, not what was aimed at.
                          //   `dropped` is how many buildings could not be
                          //   fitted and were left out rather than hidden
                          //   inside a neighbour
window.__notes()          // the vault's notes on their own landforms. 437
window.__probe(lat, lon)  // the ground truth at one point: the land mask, the
                          //   raw and flattened elevation, the four splat
                          //   weights, the river and the forest. Scan `m` for
                          //   0.62-0.78 to FIND A COASTLINE — an elevation scan
                          //   finds river mouths and calls them shores
window.__roads()          // { land, lanes } — ribbon pieces merged into each mesh
window.__signs()          // { visible, culled, minCapPx, capTarget }
                          //   GATE: minCapPx >= 15. Measured: 6 visible at 18 px
window.__regions()        // the vault continent's five, with their real note counts
window.__landmarks()      // trade landmarks standing
window.__lights()         // night-light points
window.__drones()         // craft in the air — one per agent in flight
window.__live()           // the names of the towns alive right now
window.__night()          // 0 by day, 1 after dusk, measured AT THE CAMERA
window.__sun()            // { lat, lon, hour } — where the sun is over the planet
window.__cam()            // { lat, lon, dist, alt, tilt }
window.__goto(lat,lon,d)  // put the camera somewhere, for a screenshot
window.__flyTo(name)      // run the address search from the console
window.__select(name)     // open the caption on a settlement
window.__placeOf(name)    // one settlement's ground truth: class, continent,
                          //   lat/lon, elevation, radius, tool calls, live, form
window.__nan()            // every geometry in the scene with a NaN position, by
                          //   object name. READ THIS FIRST when something is
                          //   missing: three's own "Computed radius is NaN"
                          //   names no object, which on a scene of merged
                          //   ribbons is unactionable
window.__dbg()            // { scene, camera, renderer, plan, cam, sun }
window.__quality('high'|'medium')
window.__autoDegrade(false)   // stop the page dropping to medium under the instrument
window.__bloom(false)     // bisect the frame rate
```

### Capture the globe shots

Same harness and the same three traps as everything else in this file: your own
debugging port and `--user-data-dir`, `MSYS_NO_PATHCONV=1` with absolute
`C:/…` paths, and headless Chrome has no GPU so its frame rate is SwiftShader
and means nothing. All four at 1440x900, `camera=fixed`, 33-36 s of real wall
time so the ~1.3 s build and the four-second trade re-reads have finished.

| shot | url | camera |
|---|---|---|
| `docs/shots/globe-space.png` | `?camera=fixed&hour=12` | `__goto(12, -30, 2350)` |
| `docs/shots/globe-terminator.png` | `?camera=fixed&hour=5.3` | `__goto(15, -20, 2200)` |
| `docs/shots/globe-continent.png` | `?camera=fixed&hour=12` | `__goto(26, -42, 980)` |
| `docs/shots/globe-street.png` | `?camera=fixed&hour=12` | `__goto(32.47, -43.71, 672)` |
| `docs/shots/globe-coast.png` | `?camera=fixed&hour=16.9` | `__goto(2.6, -66.4, 800)` |
| `docs/shots/globe-village.png` | `?camera=fixed&hour=14.6` | `__goto(35.88, -56.87, 655)` |
| `docs/shots/globe-vault.png` | `?camera=fixed&hour=22.2` | `__goto(62.6, 153.1, 806)` |

**Two traps in the capture itself, both of which produced a wrong shot in this
pass, and neither of which announces itself:**

- **`__goto()` starts an EASE, it does not teleport.** Take the shot or read the
  frame rate in the same call and you get the camera mid-flight — and while it
  is moving, `updateNearTown()` rebuilds the street settlement every 30 units,
  so the number you read is the rebuild and not the scene. Measured at the
  street pose: **33 fps mid-ease, 43 settled.** Do the `__goto` in one call and
  the capture in a second one twelve seconds later.
- **`nightAmount` is one frame behind the camera.** It is computed in
  `updateSun()`, so `__night()` read in the same dispatch as `__goto()` is the
  PREVIOUS position's value — the vault captures came back as midnight over a
  sunlit mountain twice before this was noticed.
- **Every `hour=` in that table is chosen so the SUN is over the shot.** The
  sub-solar longitude is `(12 - hour) * 15`, so a capture at longitude L wants
  `hour = 12 - L/15` for noon there and about four hours either side of that for
  a raking light. Get it wrong and the shot is a correct picture of the night
  side — which is how the vault capture came back as midnight twice.
- **A coast has to be found, not guessed.** Scanning for `elevRaw` near zero
  finds RIVER MOUTHS as often as shorelines, because a river is cut seven units
  into the land and crosses zero inland. Scan for the LAND MASK crossing
  instead: `__probe(lat, lon).m` between 0.62 and 0.78 is the waterline, because
  `SEA` is 0.70.
- **And the RUNBOOK's own port warning is not theoretical.** Another agent in
  this repo navigated this pass's capture tab to `world.html` between a `goto`
  and a `captureScreenshot`, and the shot came back as a picture of the island
  with no error anywhere. The harness now checks `location.pathname` contains
  `globe.html` before it believes a capture.

**`globe-village.png` is `zwoelfblick`, and the settlement was CHOSEN rather
than picked.** A village shot has to be a village at eye level with its lanes
and its trees in frame, and three things disqualify most of the 142: a trade
landmark stands at the centre of a settlement and fills the frame from 55 units
up (three captures came back as a picture of the inside of a beige dome), a
settlement on dry ground has no wood round it, and a settlement near a
continent's edge shows the sea instead. The filter that found this one:

```js
const lm = new Set();
__dbg().scene.traverse(o => { if (o.name && o.name.startsWith('landmark:')) lm.add(o.name.slice(9)); });
__dbg().plan.placed
  .filter(p => (p.cls === 'village' || p.cls === 'hamlet') && !lm.has(p.town.id))
  .map(p => ({ n: p.town.name, lat: Math.asin(p.axis.y) * 57.3,
               lon: Math.atan2(p.axis.z, p.axis.x) * 57.3, e: p.elev,
               f: __probe(Math.asin(p.axis.y) * 57.3, Math.atan2(p.axis.z, p.axis.x) * 57.3).forest }))
  .filter(x => x.f > 0.5 && x.e > 6 && x.e < 24);
```

Then `hour = 12 - lon/15` is noon over it and about an hour and a half either
side is the raking light — 14.6 for longitude -56.87. `dist = R + elev + ~34`
puts the camera at eye level, which is where the tilt curve has it looking at
the horizon rather than down at a map.

`hour=5.3` is not arbitrary: it puts the sub-solar point at longitude 100, which
is 131 degrees from Werkland — deep night — while the terminator still crosses
the visible disc, so the settlement lights are on and there is a lit crescent to
read them against. `hour=12` lights Werkland at about 45 degrees, which is the
only reason the continent and street shots are not a grey slope.

### Round 6: three live towns, persistence, region terrain, the phone <!-- GLOBE-R6-RUN -->

| url | what it gives you |
|---|---|
| `/m.html` | the phone's front door: Globe / Island / City as tap targets, and a QR code of this page's own address |
| `/globe.html?mobile=1` | the phone preset on a desktop -- quality medium, dpr clamped to 1.5, no shadows, one live neighbour, hints as a bottom sheet, the five touch gestures |
| `/globe.html?mobile=0` | forces the DESKTOP path on a machine with a touchscreen. Without it `pointer: coarse` applies the preset on its own, and a harness measures the phone when it meant to measure the desktop |
| `/globe.html?persist=0` | **the control row for the persistence work.** No `/api/project` fetches at all, so a shot or a frame-rate run is not competing with three megabyte-scale replays |

```js
window.__life().towns   // WHICH SETTLEMENTS ARE ALIVE, nearest first.
                        //   towns[0] is the full life.js stage; the rest are
                        //   sprite-only neighbours at half strength.
                        //   GATE: __life().draws <= 120.  Measured: 70
window.__life().satDraws   // what the neighbours cost this frame (0-4)
window.__seeded()       // { towns, seeded, skipped, partial, ms, done,
                        //   standing, live, paths } — what a RELOAD put back.
                        //   `done` is what a harness polls; `partial` is how
                        //   many towns answered inside the server's own 8 s
                        //   budget and were therefore short
window.__printed()      // every materialised building with its PIXEL on the
                        //   current frame. The counterpart of __craftOnScreen():
                        //   a building is pickable only under 400 m and only on
                        //   the visible hemisphere, so aiming at the middle of
                        //   the screen and hoping does not work
window.__ground()       // { coarse, detailMetres, macroMetres, macroRockMetres }
                        //   `coarse` is the fine/coarse texture blend: 0 at a
                        //   street, 0.718 at the continent pose, 1 from orbit
window.__impostors()    // { tier, swapAlt, views, atlasPx, buckets, drawing,
                        //   nearDrawing, trees } — which forest tier is on the
                        //   screen. `tier` flips at 300 m of altitude
window.__touch()        // { enabled, mobile, coarse, fingers, moved, last, dpr,
                        //   quality } — `last` names the gesture the page
                        //   RECOGNISED, which is the only way a harness driving
                        //   Input.dispatchTouchEvent can tell a pinch from two
                        //   ignored fingers
window.__qr             // on m.html: { url, modules, scale, px } for the code
                        //   currently drawn
```

**Capture the round-6 shots.** All at 1456x999 (`--force-device-scale-factor=1`),
`camera=fixed`, `?persist=0` so three replays are not downloading under the
capture, and `__goto`'s two round-3 traps still apply -- it starts an EASE, and
`nightAmount` is one frame behind.

| shot | url | camera |
|---|---|---|
| `docs/shots/globe-continent.png` | `?camera=fixed&hour=12&persist=0` | `__goto(26, -42, 980)`, settle 20 s |
| `docs/shots/globe-street.png` | `?camera=fixed&hour=12&persist=0` | `__goto(24.28, -46.41, 672)`, settle 20 s |
| `docs/shots/globe-live.png` | `?camera=fixed&hour=14.7&persist=0` | `__goto(27.85, -40.35, 850)`, settle 20 s, then check `__life().towns` has three rows |
| `docs/shots/globe-mobile.png` | `?mobile=1&camera=fixed&hour=14.7&persist=0` at 390x844 dpr 3, touch emulation on | `__goto(27.85, -40.35, 880)`, settle 16 s, `localStorage.removeItem('globe-hints')` before the reload so the sheet is up, then a real tap on a settlement so the caption is open |

- **`hour` IS THE SUN'S LONGITUDE, and the shot is dark if you forget.** The sun
  sits at longitude `(12 - hour) * 15`, so to light the town you are pointing at,
  `hour = 12 - lon / 15`. The continent and street shots keep round 4's `hour=12`
  (which is a low afternoon sun over Werkland and is what those two frames have
  always been); the live shot at longitude -40.35 needs **14.7**, and the first
  attempt at `hour=12` came back correct and unusable.
- **A four-fifths-black capture with a correct 1456x999 canvas and zero console
  errors is the renderer's VIEWPORT, not the camera.** `bakeImpostorAtlas()` is
  the only thing on this page that calls `setViewport`/`setScissor`; if a future
  bake forgets to restore them the composer draws the whole planet into a strip
  the size of the last atlas cell. Bisect it by reading
  `renderer.getViewport(new THREE.Vector4())` after `built`.
- **The three towns of `globe-live.png` were CHOSEN and will need re-choosing.**
  The frame wants a settlement whose two nearest neighbours are inside about 90
  units (a 250 m altitude frames roughly 200 x 140 units) and which have real
  session counts of their own. Re-find them:

```js
(() => { const P = __dbg().plan.placed; const out = [];
  for (const p of P) {
    const ds = P.filter(q => q !== p)
                .map(q => ({ q, d: p.centre.distanceTo(q.centre) }))
                .sort((a, b) => a.d - b.d).slice(0, 2);
    const spread = Math.max(ds[0].d, ds[1].d);
    if (spread > 95) continue;
    out.push({ n: p.town.name, ses: p.town.sessions, spread: Math.round(spread),
      minNb: Math.min(...ds.map(x => x.q.town.sessions || 0)),
      lat: +(Math.asin(p.axis.y) * 57.2958).toFixed(2),
      lon: +(Math.atan2(p.axis.z, p.axis.x) * 57.2958).toFixed(2) });
  }
  return out.sort((a, b) => b.minNb - a.minNb).slice(0, 6); })()
```

**Driving the touch gestures from a harness.** Real
`Input.dispatchTouchEvent` only, and `Emulation.setDeviceMetricsOverride` with
`mobile: true` first -- that is what makes `pointer: coarse` true, which is the
auto-detect path the flag exists beside. Then
`Emulation.setTouchEmulationEnabled { enabled: true, maxTouchPoints: 5 }`.

| gesture | events |
|---|---|
| orbit | `touchStart` one point, two or three `touchMove`, `touchEnd` with an EMPTY `touchPoints` array |
| pinch + twist | `touchStart` two points, `touchMove` with both moved AND rotated, `touchEnd` empty |
| tap | `touchStart` + `touchEnd`, no move, under 700 ms |
| double tap | two taps under 300 ms apart and within 32 px of each other |
| long press | `touchStart`, wait 900 ms, read the caption, THEN `touchEnd` |

- **Read the result off `__touch().last`, not off the camera.** A gesture that was
  not recognised leaves `last` null, and a camera that did not move is the same
  observation whether the page ignored the fingers or the browser ate them.
- **Aim a tap with `__printed()` or with `pickAt`'s own rule.** A settlement is
  only pickable on the visible hemisphere -- `p.axis.dot(camDir) >= R/|camPos|` --
  and at 100 m of altitude that is a small cap. Tapping the nearest projected
  settlement WITHOUT that test lands on one that is over the horizon and picks
  nothing: measured, `cookis-teilzeit-prep.md` projected to (241, 386) with
  `dot` 0.867 against a horizon of 0.905.
- **The bottom sixth of a phone screen is the hints sheet.** It is
  `pointer-events: none` now, but a tap that lands under the CAPTION (which is
  not) still goes to the caption.

**The frame-rate procedure is round 4's, with one addition.** Same headed window,
your own port, `--force-device-scale-factor=1`,
`--disable-features=CalculateNativeWinOcclusion`, `__autoDegrade(false)` POLLED
FOR as the first thing after the reload, twenty seconds of settling after each
`__goto`, three samples 1.6 s apart, and the `?life=0&drones=0` control run in
the same window in the same session. The addition is `?persist=0` on both: three
`/api/project` replays are tens of megabytes and a cold one takes four minutes,
and a frame-rate row measured over that is a measurement of the network.

Count the machine's Chrome load before quoting any number
(`(Get-Process chrome).Count`). Round 6's table was taken at **8**; the same four
poses at **72** read 42 / 39 / 36 / 45 against a control of 44 / 33 / 24 / 32 --
the control slower than the full build at three of four poses, which is the
signature of a machine that is busy and not of code that is slow.

**Mobile frame rate.** Same procedure at `Emulation.setDeviceMetricsOverride`
390x844 `deviceScaleFactor: 3`, `mobile: true`. The gate is **>= 30**. Measured:
**60 / 60 / 60 / 60 / 60**, with `__touch().dpr` reading **1.5** -- the preset's
clamp, against a `devicePixelRatio` of 3.

**Verifying the QR code.** The encoder is in `m.html` and has no dependency, so
the only honest check is to decode what it draws:

```js
// in the page, for any address you like
(() => { const c = document.createElement('canvas');
  drawQr(c, 'http://192.168.1.23:4949/m.html');
  return c.toDataURL('image/png'); })()
```

```python
# then, outside it
import numpy as np, cv2, base64
img = cv2.imdecode(np.frombuffer(base64.b64decode(png.split(',')[1]), np.uint8), 1)
print(cv2.QRCodeDetector().detectAndDecode(img)[0])
```

Test at three lengths -- an IP host (version 3), a long `.local` host (version 5)
and something over 100 characters (version 8, which is the only one that
exercises the version-information blocks). **A QR that decodes by hand and still
does not scan is the Reed-Solomon generator polynomial**, not the placement or
the mask: check that `rsPoly(2)` returns `[1, 3, 2]` and not `[2, 3, 1]`.

**Seeding takes minutes on a cold server and seconds on a warm one.** Measured on
the same machine an hour apart: **232 s with `partial: 3`**, then **4.9 s with
`partial: 0`**. Poll `__seeded().done`; never wait a fixed number of seconds.

### Round 4: life, the fleet and live materialisation <!-- GLOBE-R4-RUN -->

| url | what it gives you |
|---|---|
| `/globe.html` | the planet, with people, traffic, herds, birds and the ORNIS fleet |
| `/globe.html?life=0&drones=0` | **the control row of the frame-rate table.** No living layer, no craft — round 3's build with two flags |
| `/globe.html?drones=cones` | round 3's cone instead of the ORNIS kit. Also the path a failed fetch of `assets/drones/ornis.glb` takes, so the branch is reachable code |
| `/globe.html?demo=print` | replays the busiest LIVE town's last thirty minutes of first-touched files at 0.5x, and flies there. Nothing is staged — the events are that town's own tool calls with their own spacing |

| key | does |
|---|---|
| `p` | replay the last materialisation over the shell that already stands. Visual only: no event, no building, no count |
| `f` | **free fly, round 5.** Surface-relative: `W A S D` walk the ground under the lens, `Q`/`E` are the height above it (2 m to 400 m), `shift` x4, mouse to look (pointer lock on a real click, drag otherwise). `f` again eases back onto the orbit. **Entering from ORBIT cuts to the 400 m ceiling** — enter it from a region view or lower, or the drop is the first thing you see |
| `/` + a DATE | **round 5.** `2026-08-14`, `14.8`, `14.8.2026`, `yesterday`/`gestern`, `today`/`heute` all fly to that day's cottage on the Daily river and open its caption. A note TITLE typed in full takes the same branch |

```js
window.__life()        // the living layer: every population by kind, what the
                       //   settlement under the stage was given and why, the
                       //   reserve (populated but not simulated), and `draws`
                       //   GATE: draws <= 90.  Measured: 62
                       //   `at` names the settlement the stage is standing on;
                       //   `visible` is false above 300 units of altitude,
                       //   where nothing is stepped
window.__drones()      // { craft, byVariant, working, kit, trails }
                       //   one craft per live agent; the variant is the tool
                       //   that agent has open
window.__craftOnScreen()  // how many craft are inside the frame RIGHT NOW, and
                       //   where. A drone orbits its town, so whether one is on
                       //   screen is a function of the clock — poll this before
                       //   a shot instead of taking it and hoping
window.__print()       // { running, rigs, standing, derezzing, cue, last,
                       //   budgetSpent, budget } — `budget` is 48 s, 40 % of a
                       //   two-minute window, the same rate city.js charges
window.__gotoLastPrint()  // frame the last materialisation. Aims HALF WAY
                       //   between the settlement's centre and the lot: at
                       //   street altitude the tilt curve looks at the horizon,
                       //   so an aim point on the lot puts the lens inside the
                       //   building that is printing
window.__replayPrint() // what `p` does
window.__fakePrint(name, tool)   // fire one materialisation by hand, through the
                       //   same seam a real pulse uses. For the shot list and
                       //   for a page with no live session on it
window.__landmarks()   // { total, scanned, models } — `scanned` is how many
                       //   towns wear a Hunyuan lm_* instead of the procedural
                       //   solid
window.__cam().free    // round 5: { on, alt, yaw, pitch } — which mode produced
                       //   the lat/lon/dist beside it. Free fly WRITES those
                       //   four every frame, so they are true in both modes and
                       //   this is the only field that says which
window.__flyTo('2026-08-14')   // the date search from the console; returns the
                       //   note's title, or null if nothing matched
```

**Driving free fly from a harness.** Real `Input.dispatchKeyEvent` only — the
toggle is on a `keydown` and the movement keys are read from a held SET, so a
`w` with no `keyUp` flies for ever and a `w` dispatched as a single event moves
nothing. Hold it: `keyDown w`, wait two seconds, `keyUp w`. Read the movement
off `__dbg().camera.position`, not off `__cam()` — `__cam().lat/lon` move too,
but the metres are in the position. Measured: 24.63 m for two seconds of `w` at
31 m altitude.

**Capture the round-4 shots.** All at 1456x999, `camera=fixed`, and the two
traps in `__goto` from round 3 still apply — it starts an EASE, and
`nightAmount` is one frame behind. Three more that are this pass's own:

| shot | url | camera |
|---|---|---|
| `docs/shots/globe-street.png` | `?camera=fixed&hour=12` | `__goto(24.28, -46.41, 672)` then poll `__craftOnScreen().onScreen >= 1` |
| `docs/shots/globe-live.png` | `?camera=fixed&hour=12` | `__goto(15.56, 86.68, 668)` then poll `__craftOnScreen().onScreen >= 2` |
| `docs/shots/globe-print.png` | `?camera=fixed&hour=12` | `__fakePrint('werkstadt','Write')`, `__gotoLastPrint()`, **wait 12 s for the ease to settle**, THEN a second `__fakePrint`, wait 1.4 s, shoot |

- **`life.js` takes about twenty seconds to load and `/api/world` can take three
  minutes.** A fixed wait after `Page.navigate` is not a procedure. Poll instead:
  `for(let i=0;i<300;i++){ if(window.__life && __life().on) break; await sleep(1000); }`
  Measured on this machine: **life ready at 8 s** on a warm server and at
  **194 s** on a cold one, in the same session.
- **`__autoDegrade(false)` has to be the FIRST thing, and it has to be polled
  for too.** The page drops itself to medium under 33 fps after 12 s, and
  `LIFE_CLASS_CAP` is halved at medium — a run that called it after the poll
  measured a pool of 60 people where the data says 120, and the number looked
  like a bug in the counts.
- **Fire the print AFTER the camera has settled, not before.** `__gotoLastPrint()`
  starts an ease like every other `__goto`, and a 2.5-4 s print is over before a
  12 s ease finishes — the first two attempts at this shot are a photograph of a
  gutter and a photograph of a town with nothing happening in it. Print once to
  give the aim something to point at, let the lens arrive, then print again: the
  second lot is the next free station along the same lane, so it lands in the
  same frame.
- **A blank white frame at orbit is the drone downwash, and it is a bisect, not
  a read.** If `globe-space.png` comes back white: the fault is in `liveGroup`,
  and inside it the craft, and inside them `drones.js`'s dust ring being handed a
  flat-world ground on a round planet (see HANDOFF). The tell is that a shot
  taken STRAIGHT FROM BOOT looks perfect and only one taken after the camera has
  been at street level is white — the ring needs `rpm > 0.3` and the rotors do
  not spool until a craft has been close. Bisect it by hiding one scene child at
  a time and comparing the PNG's byte size: a 220 KB capture is a flat frame, a
  1.2 MB one is a planet.
- **The settlements the shots use are named because they were CHOSEN.** The
  street shot wants a town with a real session count (`wild-digital-moments-site`,
  71 sessions, 70 residents) and the live shot wants one with several agents in
  flight (`werkstadt`, 3 agents). Re-find them when the payload changes:

```js
__dbg().plan.placed.filter(p => p.town.is_live).map(p => ({
  n: p.town.name, cls: p.cls, ses: p.town.sessions,
  ag: (p.town.live_agents || []).length,
  lat: +(Math.asin(p.axis.y) * 57.2958).toFixed(2),
  lon: +(Math.atan2(p.axis.z, p.axis.x) * 57.2958).toFixed(2),
  d: Math.round(600 + p.elev + p.radius * 1.25 + 26) }))
```

**The frame-rate procedure, round 4.** Same as round 3 — headed window, your own
port, `--force-device-scale-factor=1`,
`--disable-features=CalculateNativeWinOcclusion`, `__autoDegrade(false)` first,
three samples 1.6 s apart after twenty seconds of settling — plus **one thing
that is not optional: run the control in the same window, in the same minute.**

```
node globe-r3-cdp.mjs <port> jobA.json    # the full build
node globe-r3-cdp.mjs <port> jobB.json    # ?life=0&drones=0, the same five poses
```

Count the machine's Chrome load before quoting any number
(`(Get-Process chrome).Count`). Round 3's table was taken at 65 processes and
its worst-case A/B at 83; round 4's was taken at **99**, and the control read
17-27 where round 3's own doc records 47-52 at the same poses. **If the control
is not reading 45-52, the absolute numbers are about the machine and not about
the code, and the gate cannot be claimed either way.**

### The frame-rate gate

**>= 40 fps in orbit AND >= 40 at street level, on the real GPU.** Headed Chrome
window, `--remote-debugging-port` of your own, `__autoDegrade(false)` first or
the page drops itself to medium under the instrument and you measure that
instead. Measured 2026-09-06, GPU string
`ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0, D3D11)`:

**Re-measured 2026-09-06 after the round-3 lots/lanes/trees pass.** Headed
1456x999 window, `--disable-features=CalculateNativeWinOcclusion`,
`__autoDegrade(false)`, nineteen seconds after each `__goto` had SETTLED, median
of three samples 1.6 s apart. **65 chrome.exe processes on the machine** — other
agents in this repo were running their own capture browsers throughout, and that
is the load these were taken under:

| where | camera | fps (median of 3) |
|---|---|---|
| orbit, whole planet | `__goto(12, -30, 2350)` | **52** |
| a region / continent view | `__goto(26, -42, 980)` | **51** |
| a village street | `__goto(32.47, -43.71, 672)` | **49** |
| a hamlet at eye level | `__goto(35.88, -56.87, 655)` | **47** |

**All four clear the >= 40 gate.** CPU over fifteen seconds at the village pose,
counting only that profile's seven processes: **71 % of one core, 4.4 % of
sixteen.** Count the machine's chrome load before quoting any of this:
`(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'").Count`.

**A/B against round 2, same window, same minute, at 83 processes** — the worst
load seen in the pass. Swap `globe.js` between the two builds and re-run the
same job; nothing else changes:

| where | round 3 | round 2 |
|---|---|---|
| orbit | 40 | 38 |
| region | 44 | **52** |
| a village street | **32** | 27 |
| over a LIVE town | **35** | 28 |

Under that load neither build clears the gate at the street, and round 3 clears
it by five fps more than round 2. Bisected at the street pose by hiding one
thing at a time (`scene.traverse`, `o.visible = false`): the forest costs 7 fps,
the tree trunks 2, the near settlement 9, and the lane and plaza meshes are
inside the run-to-run spread.

Measured 2026-09-06 after the realism pass, same GPU, same window,
`__autoDegrade(false)`, twenty seconds after each `__goto` had SETTLED — and with
**five other agents' capture browsers on the same GPU** (56 chrome processes; four
other passes were running in this repo at the time). These are a floor, not a
best case:

| where | camera | fps (lighter load) | fps (final sweep) |
|---|---|---|---|
| orbit, whole planet | `__goto(12, -30, 2350)` | **57** | **56** |
| a region / continent view | `__goto(26, -42, 980)` | **55** | **43** |
| a village street | `__goto(32.47, -43.71, 672)` | **43** | **27** |
| over a LIVE town (drones, weather, gold roads) | `__goto(15.56, 86.68, 700)` | **41** | **31** |

**Read the two columns together, and read the caveat.** Both were taken on the
same GPU, in the same window, with `__autoDegrade(false)`, twenty seconds after
each `__goto` had SETTLED, on the same build. The only difference is what else
was on the GPU: the left column was taken with about 50 chrome processes on the
machine, the right with 64 — four other agents in this repo were running their
own headed capture browsers throughout this pass, and the RUNBOOK's own warning
above ("do not run two capture browsers against the GPU at once") applies to
every number in both columns.

**Re-measured 2026-09-06 evening, on a machine that finally went quiet, and
this is the reading that closes the gate.** Same procedure, same window; the
`chrome.exe` count is on every row because it is the only thing that changed:

| where | camera | at 30 processes | at 16 (8 of them the harness's own) | control, 40 min later |
|---|---|---|---|---|
| a village street | `__goto(24.28,-46.41,678)` | **24** | **46** | **60** (vsync cap) |
| over a LIVE town | `__goto(15.56,86.68,668)` | **30** | **47** | — |
| orbit | `__goto(12,-30,2350)` | **46** | **47** | — |

And the bisect that says the difference is not in the scene: hiding the forest,
the near town, the living stage, the craft, the map settlements, the bloom or
the shadows one at a time gave 42, 29, 60, 60, 60, 60, 60 — two of them SLOWER
than drawing the thing, five of them on the cap, and the FULL build measured in
the same minute as those 60s also read 60. **Nothing in this frame owns the
street.** Full table and the CPU counter reading: docs/TESTS.md, under the
evening acceptance table.

**The older statement it replaces** — orbit and region PASS; street and
over-a-live-town PASS at 43 / 41 under light load and FAIL at 27 / 31 under
heavy load — is kept because its caveat is still the operating rule. The street
pose at `__quality('medium')` — which is what the page drops
itself to on its own below 33 fps — read **38** in the same heavy-load sweep.
Re-measure both low poses on a quiet machine before quoting a single number:
`(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'").Count` under 20 is
what "quiet" looks like here.

The cost at the street pose is spread, not concentrated — measured by hiding one
thing at a time: the planet's own ground shader 7 fps, the near settlement 8,
the forest 5, the map settlements 3. Removing shadows AND all thirteen LOD0
buildings changed the number by less than the run-to-run spread, which is why
the LOD0 budget below is set for the worst case rather than tuned for the
meter.

Four things bought the street number back after the realism pass, all measured,
each with its number in a comment at the line that does it:

- **The forest is six InstancedMeshes, one per continent, not one.** three
  frustum-culls an InstancedMesh against `object.boundingSphere`, which
  `computeBoundingSphere()` fills from the instance matrices — and one mesh
  holding 12,000 trees spread over a whole planet has the PLANET for a bounding
  sphere, so nothing is ever culled and every tree on the far side is submitted
  every frame. **34 → 39 fps** at the street.
- **`kit.lodFor(distance * 1.7)`** — this page's LOD0 band is 35 m, not the kit's
  60. A village has forty buildings inside 60 m and LOD0 is 9 draw calls each:
  135 draw calls of buildings alone at ×1.0, **63** at ×1.7.
- **The rock normal map is planar, not triplanar** — the rock ALBEDO keeps its
  three reads, because a stretched albedo is what reads as smeared toffee and a
  stretched normal still breaks the light up. Two fetches saved on every ground
  fragment, and the ground is most of the frame at every altitude: **3 fps** at
  orbit.
- **`PCFShadowMap`, and shadows only below 220 units of altitude**, not 420.
  Both numbers come straight out of docs/BUILDINGS.md's own measurements
  (38 → 44 fps on a street of real buildings).

**Warm the page up before you read a number.** Sampled nine seconds after load
the same three came back 39 / 37 / 34 on the same machine: the build is still
finishing, `loadData()` is still doing its three four-second trade re-reads, and
the favicons are still arriving. Twelve seconds after the camera has settled is
the honest reading. Bloom on or off made no difference at orbit (60 / 60 in a
back-to-back pair), so the planet is not fill-bound.

CPU over fifteen seconds at orbit, counting only that profile's eight processes:
**57 % of one core, 3.6 % of sixteen.** The window has to be in the FOREGROUND —
Chrome throttles an occluded one and the same sample reads 1 %.

The page drops itself to medium under 33 fps and says so once; `__autoDegrade(false)`
turns that off, and it must be off for any measurement quoted anywhere.

### Checks before calling the globe working

1. `window.__planet().landFraction` between 0.30 and 0.40 — the continents are
   the map, and this is the only honest knob for them. Ships at **0.39**. It
   moves with TWO numbers together now, not one: `SEA` (the waterline, 0.70) and
   the `1.24` / `0.86` ramp in `landMask()`. The comment at the ramp gives the
   arithmetic that keeps the coastline still while the shelf under it widens.
2. `window.__nan()` returns `[]`. It is this page's `__selfcheck()`.
3. `window.__settlements().total` equals `/api/world`'s `meta.towns`.
4. `window.__signs().minCapPx >= 15` with at least three visible at orbit. The
   TOTAL is 8 to 20 depending on how much of the server's lazy trade cache has
   filled when the page loads — a plaque goes to a city, a town, or anything
   whose trade resolved to a landmark — so measure the floor, not the count.
5. Zero console errors on a cold load with the server running.
6. Search: `/`, type a name, Enter — it flies there and does NOT leave the page.
   That last clause is the regression: Enter used to navigate into the project.
7. Double-click a project settlement — `index.html?project=<id>`. Double-click
   the vault — `world.html?focus=vault`.
8. `?screensaver=1` — `#hints` computes to `display:none`.
9. `window.__structures().lod1` is 890 and `window.__trees()` is ~12,000 —
   both come from the same `plan`, so a zero in either means the kit or the
   prop pack did not load, not that the planet is empty.
10. `window.__notes()` equals `data/vault.json`'s own note count (437). The five
    region plaques' numbers have to add up to it: anything not in Knowledge,
    Dev Logs, Daily, People, Boards or Tasks is filed under Dev Logs, on
    purpose, so the total never quietly loses a note.
11. Hover a note on the Knowledge mountain — title, words and inlinks. SINGLE
    click opens the caption and does NOT leave the page; DOUBLE click goes to
    `world.html?focus=<note id>`. **`noteAt()` is module-scope and cannot be
    called from the console**, so this has to be driven with real
    `Input.dispatchMouseEvent` moves and clicks, not with an expression.
12. `window.__overlaps().pairs` is **0**. This is round 3's own gate and it is
    the reason the lot planner exists. `__overlaps().dropped` (**104**) is how
    many buildings could not be fitted; it is reported, not hidden, and a jump
    in it means a settlement's ground or its lane spacing has changed.
13. `window.__treeSpecies()` — **4,934 broadleaf, 4,781 conifer, 2,288 quiver**,
    12 trunk meshes. A zero in `broad` or `conifer` means `leafTexture()` or
    `canopyGeometry()` failed; a quiver count anywhere near the other two means
    `speciesAt()`'s dry band has widened and the planet has palms on it again.
14. `window.__structures().laneRibbons` is **1,054** and `.plazas` is **72**. If
    either is non-zero and no lane is visible on `globe-continent.png`, the
    ribbons are being culled or z-fought — see the two traps below.

### Three traps that cost real time in round 3

- **`assets/textures/gravel_road_1k_arm.jpg` has an EMPTY GREEN CHANNEL.**
  Measured over the whole image: R 240.5, G 0.4, B 0.3 — its roughness is packed
  in RED, and `assets/manifest.json` says `roughnessChannel: "g"`, which is also
  what three.js reads. `MeshStandardMaterial` multiplies `roughness` by that
  channel, so every gravel surface on the planet sat at roughness 0: a mirror,
  which from straight above shows the sky. That is why the first lane capture
  was 1,081 white stripes and why it survived a black material with no map on
  it. Worked around in `globe.js` with `GRAVEL_ROUGH = 0.94` and no roughness
  map. **REPORT UPSTREAM.** The colours that multiply the gravel photograph had
  to be re-tuned with the fix — that photograph averages 0.19 linear, so
  `0x8b8274` over it is a black stripe and `0xc4c8c4` is a gravel road.
- **A ground ribbon lifted 2 cm above the pad is invisible from a region view.**
  A 24-bit depth buffer resolves about 7 cm at 330 units, so the lift has to be
  bigger than the depth step and `polygonOffset` alone will not save it. The
  lanes sit at +0.42, the same as the inter-town roads.
- **`ribbon()`'s winding follows the polyline's direction** (`fwd CROSS up`), so
  a lane drawn outward-in is the mirror winding and is back-face culled. The
  inter-town roads never showed this because they all run the same way. The
  settlement lane and plaza materials are `DoubleSide` for that reason; ground
  ribbons are only ever seen from above, so it costs nothing.

### Two bugs in `buildings.js` this page works around

Both are in the kit's LOD1 path, both are reported upstream, and both are worked
around HERE because `buildings.js` is another agent's file with a frozen API.
If they are ever fixed, these two workarounds can go:

- **`roof: 'flat'` renders pure black.** `_roofPrism('flat', …)` returns a plain
  `BoxGeometry`, which — unlike its gable and hip prisms — carries no `color`
  attribute. The shared roof material has `vertexColors` on, an absent attribute
  reads as (0,0,0), and every tower on the planet wore a black slab. Worked
  around by giving the catalogue's `tower` an explicit `roof: 'hip'`. It also
  hits `industrial` and anything asking for a flat roof.
- **The instanced roof prism overhangs by half the building.** The kit builds it
  at a 1×1 footprint, where it is already `1 + 0.9` wide (the 0.45 m eaves baked
  in), and then scales it by the real footprint — so a 5 m cottage gets a 9.5 m
  roof. From above that is a dark slab wider than the house, and on
  globe-vault.png the one-storey note cottages were black shards lying on the
  snow with nothing visible under them. Worked around by `roofScale(w, d)` in
  `globe.js`, which passes `(w + 0.9) / 1.9` instead of `w`.


## The vault city — superseded <!-- VAULT-CITY-DOC -->

`vault.html` no longer renders anything: it forwards to
`world.html?focus=vault`, because the vault IS the land of the world now — the
mountain, the river, the villages and the ruins are its folders. The old
renderer is kept, unloaded, at `archive/vault-city.js`.

`data/vault.json` is still the source. `server.py` keeps it fresh by itself
while it runs; the standalone export needs the vault path, which it has no
default for:

```
python tools/export_vault.py --vault "/path/to/your/vault"
```

`shots/vault-intro.png`, `vault-wide.png` and `vault-hub.png` are the archived
renderer's own reference captures and are kept with it; the World's captures are
the five `world-*.png` files.

Everything else about running, capturing and measuring it is in
**The World** above.

## Access from another device (2026-09-07)

`server.py` binds `config.json`'s `"host"`, and that ships as `127.0.0.1`:
nothing outside this machine can reach it, which is the default on purpose
because your transcripts are behind it. Opening it to a phone or a laptop on
your own network is two changes, and they go together.

**1. Bind a reachable interface.** Set `"host"` in `config.json` to the address
you want to listen on (`0.0.0.0` for every interface). Do not do this without
step 2.

**2. Turn on Basic Auth.** Write the secrets file `config.json`'s
`"auth_secrets"` points at — `data/auth.json` when that key is left empty:

```json
{"user": "<a name>", "password": "<16 chars, letters+digits>"}
```

Delete the file (or rename it) to turn auth off again — no `server.py` edit
needed, `_load_auth_creds()` just returns `None` and every route is open again,
same as before this feature existed. **Loopback is always exempt**, so the
desktop shortcut, the screensaver and the recorder keep working with no
credentials, and a 401 cannot be tested from `127.0.0.1`.

**After any `config.json` or `server.py` edit**, restart with exactly one listener:
```
schtasks /Run /TN Werkstadt-Restart
netstat -ano | findstr :4949        # expect exactly one LISTENING pid
```

**The five-request check.** Run the non-loopback ones from another device on the
network (or with `curl --interface`), against the address that device reaches
this machine at:
```
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4949/api/sessions
# -> 200, loopback, no auth needed

curl -s -o /dev/null -w "%{http_code}" http://<ip>:4949/api/sessions
# -> 401, no Authorization header

curl -s -o /dev/null -w "%{http_code}" -u <user>:<password> http://<ip>:4949/api/sessions
# -> 200

curl -s -o /dev/null -w "%{http_code}" http://<ip>:4949/m.html                        # -> 401
curl -s -o /dev/null -w "%{http_code}" -u <user>:<password> http://<ip>:4949/m.html   # -> 200

curl -s -o /dev/null -w "%{http_code}" --max-time 5 -u <user>:<password> \
  "http://<ip>:4949/api/stream?project=<town-id>"                                     # -> 200, streams
```

**Phone flow**: open `http://<ip>:4949/m.html` — the browser's own Basic Auth
dialog asks for user and password before the page loads. `m.html` also draws a
QR code of its own address, so the next device does not have to be told the IP.

## The desktop wallpaper (2026-09-07) <!-- WALLPAPER-RUN -->

`globe.html?wallpaper=1` can be run as the Windows desktop wallpaper by
**Lively Wallpaper** (Microsoft Store build, PFN
`12030rocksdanister.LivelyWallpaper_97hta09mmv6hy`). Nothing in this repo
installs it — this section is what to do by hand, and what goes wrong.

**Where Lively keeps everything** (per-user, inside the Store package):
```
%LOCALAPPDATA%\Packages\12030rocksdanister.LivelyWallpaper_97hta09mmv6hy\LocalCache\Local\Lively Wallpaper\
    Settings.json               <- SelectedDisplay: the exact monitor object
    WallpaperLayout.json        <- which library folder is on which screen
    Library\wallpapers\werkstadt\LivelyInfo.json    <- ours
```
Back both JSON files up before you touch either of them.

**Our library entry** is a Lively **Type 3 (url)** wallpaper — no files of ours
live in Lively's library, it just loads the running server:
```json
{"Type":3,"FileName":"http://127.0.0.1:4949/globe.html?wallpaper=1","IsAbsolutePath":true, ...}
```

**The Store build has no working CLI.** A wallpaper is set by writing
`WallpaperLayout.json` and relaunching Lively:
```powershell
$pfn = '12030rocksdanister.LivelyWallpaper_97hta09mmv6hy'
$lw  = "$env:LOCALAPPDATA\Packages\$pfn\LocalCache\Local\Lively Wallpaper"
# LivelyScreen MUST be the SelectedDisplay object out of Settings.json, verbatim,
# and the file must be UTF-8 with NO BOM or Lively silently ignores it.
Get-Process | Where-Object { $_.Name -like '*Lively*' } | Stop-Process -Force
Start-Process "shell:AppsFolder\$pfn!App"     # the AppUserModelId, from Get-StartApps
```
To switch the desktop back to another wallpaper, point `WallpaperLayout.json` at
that library folder instead and restart Lively the same way.

**Order matters at logon.** A WebView2 that reaches the port before
`Werkstadt-Server` has bound shows a browser error page and never retries, so
anything that sets the wallpaper at logon has to wait for
`http://127.0.0.1:4949/globe.html` to answer 200 first. `Werkstadt-Server` itself
needs no change for this: At-logon trigger, enabled, no battery or network
conditions, `MultipleInstances=IgnoreNew`, and `start-server.ps1` is idempotent.

**Interaction on the desktop** — from `Settings.json`: `InputForward: 1` (Lively's
"mouse only" mode) with `MouseInputMovAlways: true`. So the wiring is there for
drag-to-turn / wheel-to-zoom / click-to-read / double-click-to-enter, and
**keyboard is off** by design (`/` search, `f` free-fly, `q` quality, `p` replay
would need `InputForward: 2`, which also swallows keys typed at the desktop).
**NOT VERIFIED end-to-end** — an automated drag on the desktop could not be
proven here because other windows kept restoring themselves over the
desktop within seconds of every MinimizeAll. Click an empty patch of
desktop and drag; if the planet does not turn, raise `InputForward` in Lively's
settings UI — don't edit the JSON while Lively is running.

**2026-09-07 — the keyboard is no longer needed, and `InputForward` stays at 1.**
`globe.html`, `world.html` and `index.html` now carry an **enter / back /
search** button cluster (`controls.js`, HANDOFF -> CONTROLS-DOC), and the search
panel has clickable lists of real projects, dates and notes under the field — so
every action the keyboard owned is reachable with the mouse Lively already
forwards. Proven on the real desktop: `docs/shots/wallpaper-desktop.png`.
`InputForwardMode: mousekeyboard` (value 2) does exist — it is in
`Lively.Models.dll` — but it was deliberately NOT switched on: this page binds
bare single letters (`f` free-fly, `q` quality, `p` replay, `/` search) with no
modifier, and keyboard forwarding hands every keystroke typed at a focused
desktop to the wallpaper, which is the same keystroke Windows uses to jump to a
desktop icon. It is also a global Lively setting affecting every wallpaper.
**If you do raise it anyway:** back up `Settings.json` first, stop Lively before
editing, and restart with `Get-Process *Lively* | Stop-Process -Force` then
`Start-Process "shell:AppsFolder\$pfn!App"` — that restart is also how you make
the wallpaper reload the page after editing `globe.js`/`controls.css`.
`AppFullscreenPause: 0` means the wallpaper pauses while an app is fullscreen;
`AppFocusPause: 1` means it keeps running behind ordinary windows.

**Frame rate inside WebView2 could not be read.** Setting `WebDebugPort` in
`Settings.json` (tried 9222, which another app's WebView2 already owned here,
then 9788) never opened a port for `Lively.Player.WebView2`, so there is no CDP
target to ask `window.__fps()`. What IS measured: 10 screen crops of the planet
393 ms apart show 0.28-0.42 % of pixels changing per crop with no frozen pair,
i.e. it animates continuously; and the same page in headless Chrome on the same
GPU reads 58-60 fps. The scene on the desktop is the full one — terrain, clouds,
forests, settlement labels, atmosphere rim — not a degraded fallback.

**Proving it renders** — "Lively reports Success" is not evidence. Minimise
everything and photograph the real screen:
```powershell
$sh = New-Object -ComObject Shell.Application; $sh.MinimizeAll(); Start-Sleep 3
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save("...\docs\shots\wallpaper-desktop.png")
$sh.UndoMinimizeALL()
```
**Two traps in that snippet, both cost a re-run on 2026-09-07.** (1) PowerShell
is DPI-virtualised, so on a scaled display `PrimaryScreen.Bounds` returns the
LOGICAL size and you capture the top-left corner of the real screen with no
error — at 200 % scaling that is a quarter of it. Call
`SetProcessDPIAware()` first:
```powershell
Add-Type -Namespace D -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[D.N]::SetProcessDPIAware() | Out-Null
```
(2) `MinimizeAll()` does not hold — some windows restore themselves within a
second or two, and you save a picture of those instead. **Always look at the file you just saved**; the cheap machine
check is that the middle pixel of the desktop wallpaper is near-black
(`$bmp.GetPixel($w/2,$h/2)`, sum < 150), and a page or an editor is not.


### "Screen missing" — the wallpaper is gone and restarting Lively will NOT bring it back (2026-09-08)

**The symptom that looks like everything else:** desktop shows the Windows
default photo, `Lively.exe` is running, **`Lively.Player.WebView2` is not**, and
restarting Lively changes nothing. Before touching any file, read the
newest log in
`%LOCALAPPDATA%\Packages\<pfn>\LocalCache\Local\Lively Wallpaper\logs\`.
If it says

```
Screen missing, skipping restoration of ...\Library\wallpapers\werkstadt | \.\DISPLAY1
Wallpaper queued to disconnected screenlist ...
```

then **the layout file is innocent** and so is the display-id drift trap above.
Checked on 2026-09-08 and all fine while the wallpaper was dead:
`WallpaperLayout.json` intact and byte-identical to its backup apart from
the intended `werkstadt` path, its `LivelyScreen` equal to `Settings.json`'s
`SelectedDisplay` verbatim, the library entry + `LivelyInfo.json` present, and
`http://127.0.0.1:4949/globe.html` -> 200.

**What is actually broken is one level lower: the panel's device interface.**
Lively's screen list comes from the monitor device interface
`{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}` — a Lively `DeviceId` **is** that
interface path. When the interface goes un-linked (seen after some sleep/resume
cycles), the list is EMPTY, so nothing in the layout can ever match. The three
independent checks, all run from PowerShell:

```powershell
# 1. EnumDisplayDevices(deviceName, 0, ..., EDD_GET_DEVICE_INTERFACE_NAME=0x1)
#    healthy -> \?\DISPLAY#<panel-id>#<instance>#{e6f07b5f-...}
#    broken  -> returns FALSE, DeviceID empty, GetLastError 203
# 2. healthy -> one row; broken -> nothing at all:
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID | Select InstanceName
# 3. healthy -> Linked=1; broken -> the key has no properties:
# (paste your own interface path from check 1 in place of <panel-id>#<instance>)
$k='HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses\{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}\##?#DISPLAY#<panel-id>#<instance>#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}\#\Control'
(Get-ItemProperty -LiteralPath $k -EA SilentlyContinue).Linked
```

**Do not spend time on these — all four were tried and none worked:** restarting
Lively (4x), `DisplaySwitch.exe /internal`,
`ChangeDisplaySettingsEx(CDS_RESET)`, and a 60->48->60 Hz modeset. They each make
Lively log `Display settings changed` and re-read the screen rect, but Lively
re-attaches a **queued** wallpaper only on a screen-ADDED event, so the desktop
stays empty. Also useless: switching `DisplayIdentification` in `Settings.json`
— 0 (deviceId), 1 (deviceName) and 2 (screenLayout) were all tried and all say
`Screen missing`, which is the proof that the list is empty rather than the
comparison wrong. Put it back to **1**, its original value.

**The fix is a sleep/resume cycle** (lid, or lock and let the panel power down),
or a reboot. On resume the interface relinks and `EnumDisplayDevices` returns
the same id that was already stored. Then restart Lively **properly**:

```powershell
$pfn = '12030rocksdanister.LivelyWallpaper_97hta09mmv6hy'
curl.exe -s -o NUL -w "%{http_code}" http://127.0.0.1:4949/globe.html   # must be 200 FIRST
Get-Process | Where-Object { $_.Name -like 'Lively*' } | Stop-Process -Force
Start-Sleep -Seconds 4
Start-Process "shell:AppsFolder\$pfn!App"
$d=(Get-Date).AddSeconds(45)
while((Get-Date) -lt $d){ if(Get-Process -Name 'Lively.Player.WebView2' -EA SilentlyContinue){break}; Start-Sleep 2 }
Get-Process | Where-Object { $_.Name -like 'Lively*' } | Select Name,Id
```
Success looks like this in the log — anything less is not a restored wallpaper:
```
Restoring wallpaper Werkstadt - The Planet | ...\werkstadt
Setting wallpaper: Werkstadt - The Planet | http://127.0.0.1:4949/globe.html?wallpaper=1
Wv20: {"Type":2,"Success":true}
```
**`Lively.exe` being up proves nothing.** The wallpaper is
`Lively.Player.WebView2` (plus `Lively.Watchdog`). Always wait for that process
by name, then take the DPI-aware desktop screenshot below.

**If you write a heal script for this, do not let it exit silently on an empty
screen list.** That is the one condition that kills the wallpaper, and an early
`return` on it produces no output and no change — which reads as "the script
did nothing wrong". Keep the stored display id (never stamp an empty one), say
which health test failed before restarting, wait for `Lively.Player.WebView2` by
name, and end with an explicit OK or FAILED line. Latest proof that the
wallpaper is really up: `docs/shots/wallpaper-desktop.png` — planet,
settlement labels, stats pill and the play / search / enter cluster, with two
captures 2 minutes apart at different longitudes proving it animates.

## Play mode — the wallpaper full screen, with a keyboard (2026-09-07) <!-- PLAY-MODE-RUN -->

**What it does.** The wallpaper's fourth button, **`play`** (gold, bottom-right,
next to `search`), asks the server to open ONE fullscreen kiosk browser window at
the same page and state, over the desktop. That window is an ordinary browser
with real focus, so WASD / `f` / `q` / `/` / Escape all work in it. **Escape at
the top level**, or the **`back to desktop`** button that replaces `play` inside
it, closes the window — and the wallpaper is simply there underneath, never
reloaded and never reconfigured. Why a window and not forwarded keys:
docs/DECISIONS.md.

The Escape ladder is the one the keys already had, one rung longer: close the
search → close the caption → leave an interior → walk a city or the island back
up to the globe → **then** the desktop. `controls.js` only claims Escape when
the page's own `exitLabel()` says there is nothing left to leave, and it listens
in the CAPTURE phase so it reads the level the key ARRIVED in (see its comment;
a bubble listener closed the caption AND the window in one press).

**The endpoints** (loopback only — a POST from any other host gets
**403**, before any Basic Auth check):
```bash
curl http://127.0.0.1:4949/api/play                      # {"alive":false,"pid":null}
curl -X POST -H 'Content-Type: application/json' \
     -d '{"url":"globe.html?play=1&focus=werkstadt"}' \
     http://127.0.0.1:4949/api/play                      # {"alive":true,"pid":63884,"started":true}
curl -X POST http://127.0.0.1:4949/api/play/stop         # {"alive":false,"pid":null,"stopped":true}
```
`url` must be a bare `<name>.html` plus a query — anything with a scheme or a
slash is refused with a 400, because this route launches a browser.

**A stuck kiosk.** The window is Edge (Chrome if Edge is missing) on its own
profile `data/.cache/play-profile`, with CDP on **port 4950**. In order:
1. `curl -X POST http://127.0.0.1:4949/api/play/stop` — the normal way.
2. Server restarted since it opened, so the PID is forgotten? Find it by its
   profile and kill THAT pid only:
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
     Where-Object { $_.CommandLine -like '*play-profile*' } |
     ForEach-Object { taskkill /PID $_.ProcessId /T /F }
   ```
   **Never `taskkill /IM msedge.exe`** — that closes every Edge window you have
   and every agent's browser on this machine.
3. The server forgets a window closed any other way by itself: `play_alive()`
   polls the stored `Popen` on every `/api/play` read, logs `exited on its own`
   and clears the PID, so the next `play` click opens a fresh one.

**The log** is `launcher/play.log` — one line per launch and per stop, with the
PID and the URL. It is the only server log that is worth reading by hand.

**Disabling it.** The button is drawn only under `body.wallpaper` or `body.play`
(`controls.js`), so:
- **Hide the button, keep the routes:** delete the `<button id="ctl-play">` line
  from `globe.html`, `world.html` and `index.html`. `controls.js` `install()`
  already no-ops when the element is absent.
- **Turn the feature off entirely:** delete the two `"/api/play"` lines from
  `do_POST()` in `server.py` — the route then 404s and the button's `fetch`
  logs a warning and does nothing. Nothing else in the project calls it.

**One interaction to know:** Lively's `AppFullscreenPause: 0` means the wallpaper
PAUSES while an app is fullscreen — so the planet behind the play window stops
animating while you are playing, and resumes when the window closes. That is a
saving, not a bug, and it is why the wallpaper's clock jumps when you come back.


## Startup speed — how to re-measure (2026-09-07) <!-- STARTUP-SPEED-RUN -->

The number that matters is **time to the planet on screen**, i.e. from
`Page.navigate` until `window.__settlements()` returns non-null (`plan` is set by
`buildWorld()`). `index.html`'s equivalent is `window.__streets().count > 0`.

Server side, in isolation — this is where the wait used to be:
```powershell
1..5 | ForEach-Object {
  $t = Measure-Command { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4949/api/world -TimeoutSec 60 }
  "world #$_ : {0:N0} ms" -f $t.TotalMilliseconds
  Start-Sleep -Seconds 5      # 5 s, to land OUTSIDE the caches' TTLs
}
```
Expect **180-400 ms**. Before this pass it was 3,100-8,100 ms, because
`world_static()` / `world_payload()` rebuilt inside the request whenever their
(10 s / 1.5 s) TTLs had expired, and each rebuild costs 2.5-6.6 s. They serve the
previous snapshot and rebuild behind it now, and `main()` prewarms both at boot.
A number back in the seconds means the prewarm thread did not run or the
single-flight lock is wedged — check `launcher/server.log` for
"world_static refresh failed".

Client side, same CDP harness as "Capture screenshots" above, plus
`Network.setCacheDisabled` to pick cold vs warm and a `requestAnimationFrame`
hook for first-frame time. The harness is ~90 lines and lives in the scratchpad,
not in this repo. Measured 2026-09-07 at 1440x900, headless:

| run | before | after |
|---|---|---|
| `globe.html`, cold (server just restarted, no browser cache) | 69,378 ms | **6,025 ms** |
| `globe.html`, warm browser cache | 18,215 ms | **5,652 ms** |
| first `/api/world` inside that open | 8,124 ms | 42 ms avg over 28 |
| `index.html?project=e6a8abd1` (busiest town), warm | 3,728 ms | 3,728 ms (unchanged — it never asked `/api/world`) |

**The asset pack is cached for a day.** `server.py` sends
`Cache-Control: public, max-age=86400` on anything under `/assets/` (200 and 304
only — never on a 404). It is deliberately NOT `immutable`: models are still being
written into `assets/hunyuan/` at fixed paths. **If you replace an asset and the
page still shows the old one, hard-reload (Ctrl+Shift+R)** or wait a day; a
harness must set `Network.setCacheDisabled`.

## Photographing the crowd and the props (2026-09-08)

Two probes exist because a count is not a photograph, and both were added after
an acceptance run reported "0 props" and "crew not photographable" when neither
was true.

**Island props — `__props().nearest`.** `updateProps()` places the nearest `cap`
slots inside `PROP_SHELL` (115 m of the camera) and nothing else, so every pool
reads `placed: 0` from any overview framing; `world.html?focus=vault` sits 209 m
up. `__props().nearest` gives the closest slot of each type in world
coordinates. To photograph the Hunyuan conifers:

```js
const p = __props().nearest['hy.tree_conifer'];   // {x, y, z, metres}
__goto(p.x, p.z, 26, 0.55);                       // 26 m out, phi 0.55
```

`?hour=16` puts the sun up; at the default clock the island is at night and the
trees are silhouettes. Verified: `placed 3` of cap 6, `realTreesHiding 4`.

**City crew — `__lifeStand()` + `__life().streets[].crewAt`.** `__lifeStand(i,
back, bearing)` stands the free-fly lens in front of ONE person on avenue `i` —
a crew member by preference. It used to aim at the CENTROID of everyone on the
street, which on a two-man site 22 m wide is bare tarmac between them.
`crewAt` returns each crew head's city coordinates and its NDC, so a capture can
wait for the subject to actually be in frame instead of shooting and hoping:

```js
const i = __life().streets.find(s => s.crewPlaced > 0).idx;
__lifeStand(i, 1.6);
const at = __life().streets.find(s => s.idx === i).crewAt;
// shoot when some a.ndc satisfies |x| < 0.85 && |y| < 0.85 && z < 1
```

The crew comes and goes as the transport moves, so poll and re-pose in a loop.

**Reference-shot timing moved (2026-09-08).** `replay.js` no longer holds on a
dead-air gap while the city is still empty (docs/DECISIONS.md, "the opening
void"), so a `?src=` shot timed off the opening — `city-020`, `city-090`,
`city-240` in the table above — now lands further into the session than its
recorded wall time. Re-time them from the picture, not from the number, if they
are ever retaken.

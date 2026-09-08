# Runbook — claude-live, the "tree" build

_Verified: 2026-09-05_

## Run it

```
cd <repo>\archive\tree
python -m http.server 4951
```

Open <http://127.0.0.1:4951/>. **Do not use 4949** — two agents both claimed it in
this project and you will get served the other build without any error to tell you
so. 4646, 4747 and 4848 are taken by other tools.

Opening `index.html` straight off disk does **not** work: `fetch` of a local
`.json` is blocked by the browser's `file://` origin rules, and the page shows its
"no session to replay yet" message. Always serve the folder.

## Which file it replays

1. `?src=<url>` if present
2. `data/demo.json`
3. `data/sample.json` (the dev fixture, copied into this folder so it runs alone)

```
http://127.0.0.1:4951/                      # falls through to the fixture
http://127.0.0.1:4951/?src=data/sample.json # the fixture, explicitly
http://127.0.0.1:4951/?live=1               # live mode, needs a server on /api/stream
```

A 404 on `data/demo.json` in the network log is the fallback working, not a fault.

## Controls

| key | does |
|---|---|
| `space` | pause / resume |
| `←` `→` | jump back / forward 10 s (rebuilds the tree at that instant) |
| `[` `]` | speed down / up through 0.5× · 1× · 2× · 4× |
| `L` | live-follow on/off — on means the clock chases the newest event |

Keyboard hints appear once per browser and never again. To get them back:
`localStorage.removeItem('claude-live.hints-seen')`.

## Checks before calling it working

| # | check | command / action | expected |
|---|---|---|---|
| 1 | it serves | `python -m http.server 4951`, open `/` | title reads "Build the live session visualizer" and the clock counts |
| 2 | it is the right build | `curl -s http://127.0.0.1:4951/ \| grep title` | `Claude Live — watch a session work`, not "a city built by a session" |
| 3 | it replays real data | watch the top-right tallies | files, tool calls and agents all climb as events arrive |
| 4 | frame rate | `window.__fps()` in the console after ~10 s | 60 (vsync cap); under 50 is a regression |
| 5 | console is clean | DevTools console on load and after 90 s | zero JavaScript errors (one `data/demo.json` 404 is the fallback) |
| 6 | pause | press `space` | clock stops, `paused` flashes; press again and it resumes |
| 7 | seek | press `→` then `←` | clock jumps ±10 s and the tree rebuilds to the right file count |
| 8 | speed | press `]` then `[` | badge flashes `2×` then `1×`, and the pace visibly changes |
| 9 | studio seal | `grep -c WDM-SEAL index.html` | `4`, and the W mark sits in the bottom-right corner |

Measured 2026-09-05 on this machine (Radeon 860M, integrated): **60 fps** at 5 s,
30 s and 90 s of the 112-second fixture at 1440×900, and over the first ten minutes
of the 2,193-event real export. Zero JavaScript console errors in both.

## Capture screenshots and measure the frame rate

Chrome's `--virtual-time-budget` is **not** usable here — it races the page's
`fetch` of the replay file and produces a booted-but-frozen page that looks like a
stalled clock. Drive real Chrome over CDP instead. Node 24 has a built-in
`WebSocket`, so this needs no packages:

```
chrome.exe --headless=new --disable-gpu --remote-debugging-port=9335 \
           --window-size=1440,900 --user-data-dir=%TEMP%\cdp-tree-profile about:blank
```

then `Page.navigate`, wait in **real wall time**, then `Page.captureScreenshot` and
`Runtime.evaluate` for the readouts. Run it from PowerShell with absolute Windows
paths — Git-Bash rewrites the paths and silently writes nothing.

Frame rate comes from the page itself: `window.__fps()`, a rolling average over the
last 90 frames.

## Live mode — what the server has to provide

The client is written; the server is not, and was out of scope. It needs exactly
one endpoint:

- `GET /api/stream` — a `text/event-stream` response. One SSE message per event,
  `data:` carrying a single JSON object shaped exactly like one entry of the replay
  file's `events` array (`t`, `agent`, `kind`, and `tool`/`path`/`summary` where
  they apply). `t` is milliseconds since the session started.

The page calls `window.ingest(event)` for each message. No handshake, no
acknowledgement, no polling endpoint. Reconnection is handled by `EventSource`.

## If something looks wrong

| symptom | cause | expected once fixed |
|---|---|---|
| the page is a city, not a tree | another agent's build is on that port, or you opened the project root | check check #2 above; serve this folder |
| clock frozen at 0:00, one event in the ticker | the tab is hidden or backgrounded — `requestAnimationFrame` is paused. Not a bug. | front the tab; the clock resumes |
| "No session to replay yet" | opened from `file://`, or the json is missing/malformed | served over http, the title fills in within a second |
| tree is one dot in the middle | every path is outside the chosen root — check `chooseRoot()` and the exporter's cwd | branches grow outward as files are touched |
| two captions stacked | both landed in the same spot; halos handle crossing, not coinciding | labels separate as the layout settles |

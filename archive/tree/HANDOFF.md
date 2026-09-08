# Handoff — claude-live, the "tree" build

_Verified: 2026-09-05_

Written so that a new session, or a different person, can continue with zero context.

## State right now

Complete and working. `index.html` + `styles.css` + `app.js`, served from this
folder, replay a session file at **60 fps with zero JavaScript console errors**.
Replay transport, live-mode hook, studio seal, screenshots and docs are all in.
Zero dependencies. Nothing is deployed, and the `/api/stream` server for live mode
does not exist — it was explicitly out of scope.

**This build was superseded in place.** A second agent working in the same
`claude-live` folder replaced the project root with a different visualizer (a city
that builds itself) and moved this one into `archive/tree/`. That is why the root
`index.html`, `styles.css`, `EDITING.md` and `docs/` describe a city, not a tree.
This folder is intact and self-contained. Which build survives is Beri's call, not
an agent's — do not copy this back over the root without it.

## Done in this session (2026-09-05)

- The whole visualizer — `index.html`, `styles.css`, `app.js`
- Dev fixture, 48 events shaped like the real contract — `data/sample.json`
- Studio seal, all five layers, via the skill's injector — `index.html`, `humans.txt`
- Bottom-right pin for the seal, because every other element is fixed — `styles.css`
- Human-facing edit guide — `EDITING.md`
- Reference captures at 5 s / 30 s / 90 s — `shots/`

## Decisions, and why

**Canvas 2D, not WebGL.** The ceiling was 300 nodes on an integrated GPU. 300
circles, ~300 hairline edges and a few dozen glow blits is nowhere near the fill
rate where WebGL starts to pay for its complexity, and 2D leaves the file readable
by someone who has never written a shader. Measured 60 fps, vsync-capped.

**Glows are pre-rendered sprites, not `ctx.shadowBlur`.** `shadowBlur` is roughly
20× the cost per draw and would have been what broke the frame budget. One 128px
radial-gradient canvas per colour is built at boot; every glow is that image scaled
and blitted with `globalCompositeOperation='lighter'`.

**A radial wedge layout, not d3-force.** A force layout reshuffles every existing
node whenever a new one is added, which is exactly wrong for a tree that grows
while you are watching it — you lose your place every second. Each node instead
owns an angular slice of its parent's slice, so siblings never collide and a node
only moves when its own branch changes shape. It also costs no dependency.

**An ellipse, not concentric circles.** The window is 16:9. A circular tree packed
a 1440×900 frame into a 380px disc and left two thirds of the picture empty. Radius
rises as `depth^0.68` so ring one clears the centre instead of crowding it.

**The root is chosen, not assumed.** The obvious design roots the tree at
`session.cwd`. The real 8.5-hour export has 221 distinct paths and **not one is
under its own cwd** — the session ran from one folder and worked in a dozen others.
Rooting that at the cwd hangs the whole tree off a meaningless stub. So the cwd is
used when it covers at least 40% of the paths, and otherwise the tree is rooted at
the longest directory prefix the paths genuinely share. `chooseRoot()` in `app.js`.

**Dead air is skipped; events are not.** That same export runs 8 h 34 m and its
first tool call is three minutes in — at 1× you would watch an empty screen.
Playing forward jumps any gap longer than 4 s, landing 2.6 s before the next event
so the idle "thinking" state still plays. No event is skipped, reordered, merged or
invented — only the empty time between them, and the clock keeps showing the
session's own real timestamps, which is why it visibly jumps. Two constants,
`DEAD_AIR` and `IDLE_HOLD`, above `advance()`.

**The chrome distrusts the exporter's strings.** Real agent labels are whole
sentences and real tool summaries are sometimes the raw JSON argument blob. Both
are correct data and unreadable on screen, so they are clipped at the point of
display and a JSON-looking summary falls back to the file's own name. The event
itself is never modified — `readable()` and `clip()` in `app.js`.

**Seek rebuilds from event zero.** Running the animation backwards would need every
effect to be invertible. Replaying a few hundred events silently is sub-millisecond
and guarantees a seek lands in exactly the state a forward play would have reached.

**One entry point, `ingest(event)`.** Replay and the live `EventSource` both call
it, so there is precisely one code path that can change what is on screen — which
is also why live mode needed no second renderer.

**Hierarchy by size and rim, not by colour.** The orchestrator is a larger orb with
an outer ring; subagents are smaller, rimless, tethered to it by a faint line.
Giving every agent its own hue would have burned the colour budget that reads and
writes need, and ten hues stop meaning anything anyway.

**Labels carry an ink halo.** On a canvas anything can end up behind a caption — an
edge, a glow, another label. The cartographer's trick keeps every label readable
without putting a box on screen.

## Open / next steps

| # | What | Why it matters | Blocked by |
|---|---|---|---|
| 1 | Decide: tree or city | Two complete builds now exist in one folder | Beri |
| 2 | The `/api/stream` SSE server for `?live=1` | Live mode is the whole point of "watch Claude work"; replay is the rehearsal | nothing; contract is in `RUNBOOK.md` |
| 3 | Deploy somewhere shareable | The screenshot-and-share job needs a URL | a decision on where |
| 4 | Density test at 300+ nodes | 60 fps is measured over the first ~10 min of the 2,193-event export, which reaches ~40 nodes — not the stated ceiling | a denser session file |
| 5 | Two captions in the same spot still stack | Halos keep labels readable when they cross, but not when they coincide | #4 |
| 6 | An 8-hour session is still ~25 min to watch | Dead-air skipping fixes empty stretches, not volume. A one-frame-per-event mode would, but was not in the brief | Beri |

## Gotchas someone will hit

- **Another agent may be serving a different project on the same port.** Port 4949
  was claimed by both builds; a request can land on the wrong server and you will
  swear the page is broken. Check `curl -s http://127.0.0.1:PORT/ | grep title`
  before debugging anything.
- **A hidden or backgrounded tab freezes the clock at 0:00 with one event in the
  ticker.** `requestAnimationFrame` is paused by the browser. This cost about forty
  minutes here: it looks exactly like a stalled replay loop, and it is not.
- **`chrome --virtual-time-budget` is useless against this page.** It races the
  `fetch` of the replay JSON and returns either an unbooted page or a booted page
  with a frozen clock. Drive real Chrome over CDP with real waits instead — Node 24
  has a built-in `WebSocket`, so that harness needs no packages.
- **MSYS/Git-Bash mangles the Chrome `--screenshot` path**, writes nothing, and
  returns success. Use PowerShell with absolute Windows paths.
- **The seal lands top-left unless it is pinned.** Every visible element is
  `position:fixed`, so the injected `.wdm-seal` is the only thing left in normal
  flow. The pin is the `STUDIO SEAL` block at the end of `styles.css` and changes
  placement only — never the mark itself.
- **`data/sample.json` is a fixture, not data.** It says so in its own `_fixture`
  field. Do not quote numbers off it.

## Key files and commands

| what | where |
|---|---|
| this build | `<repo>\archive\tree` |
| serve | `python -m http.server 4951` |
| the one public function | `window.ingest(event)` in `app.js` |
| frame rate | `window.__fps()` in the browser console |
| seal check | `grep -c WDM-SEAL index.html` → 4 |

# How it works — werkstadt

_Verified: 2026-09-08_

One read of the system. Every claim below is checkable against the code or a
doc; where this file isn't sure, it says "see X" instead of guessing.

## The one-paragraph version

`server.py` reads three kinds of real data — Claude Code's own session
transcripts under `transcripts_root` (`~/.claude/projects` by default, subagent
files included), an **optional** Obsidian vault, and the file trees of every
project Claude Code has touched —
and turns them into JSON over a handful of `/api/*` HTTP + SSE endpoints. Three
front-end pages read that JSON and draw it as a place: `index.html` draws one
session as a city, `world.html` draws everything at once as one island, and
`globe.html` draws everything as a planet. Nothing on screen is invented — see
`docs/DECISIONS.md`, "Nothing on screen is invented".

Everything machine-specific is one file: `config.json`, which `server.py` writes
from `config.example.json` the first time it runs and then reads on every start.
It holds the transcripts root, the (optional) vault, the bind host and port, the
recordings directory, the trades table, display-name overrides, the continent
rules and the aviary regex. The example file is the schema and documents itself.

## Data sources → what each becomes

| source | read by | becomes |
|---|---|---|
| `<transcripts_root>/**/*.jsonl` (main session transcripts, `~/.claude/projects` by default) | `scan_transcript()`, `line_to_events()` in `server.py` | events: `prompt`, `text`, `tool`, `agent_start`, `agent_end` |
| subagent transcript files (same tree) | the same scanner, keyed by `agent` id | the drones/workers a city shows in flight |
| a project's own files (`cwd` / file-tool paths) | `resolve_project_dir()` | which town/city a session's buildings belong to (see `docs/DECISIONS.md`, "Towns are keyed by project root") |
| the Obsidian vault at `config.json`'s `"vault"` — **optional, empty by default** | `scan_vault()`, `regenerate_vault_json()` → a generated vault export under `data/` (not in the repo; the server writes it, and serves an empty one when no vault is configured) | the World's geography: notes as mountains/valleys/rivers/villages, links as roads. With no vault configured there is no knowledge continent and no notes; everything else runs unchanged |
| `docs/HANDOFF.md` per project | `handoff_open_items()` | one crane per open item, standing on that project's harbour quarter |
| `assets/manifest.json` + `assets/*` (CC0, **not in git** — fetched by `assets/fetch_assets.py`) | `buildings.js` / `life.js` / `drones.js` loaders | every model, texture and animation on screen — see `docs/DECISIONS.md`, "The generated models are gone" |

## `server.py` — endpoints

All routing is one `if`/`elif` chain in `do_GET()` (`server.py` ~3810-3855).

| path | purpose | consumer |
|---|---|---|
| `GET /api/config.js` | the client-visible slice of `config.json`, served as a `<script>` (`window.WERKSTADT_CONFIG`): the home directory, the continent rules, `aviary_projects` and `redact`. A script and not JSON because `globe.js` needs the continent rules while it builds its first frame. The transcripts root, the vault path and the auth file never leave the process. `Cache-Control: no-store`, so editing `config.json` and reloading is the whole of "apply my settings" | `globe.html`, `world.html` (loaded before their own module) |
| `GET /api/stream` | SSE: live events for the current/most-recent session (or `?project=<town>` for a town's live tail) | `replay.js` (`window.ingest`) |
| `GET /api/vault` | SSE: vault file-change diffs | `world.js` (live note edits) |
| `GET /api/sessions` | JSON: the 10 most recent main sessions, each carrying `town` + `root` | `index.html` (session picker), `world.html` |
| `GET /api/world` | JSON: every town (project or vault region), building/session/trade counts, `is_live`, `meta.agents_in_flight` / `meta.agent_slots` | `world.html`, `globe.html` |
| `GET /api/world/stream` | SSE: the live half of `GET /api/world`, polled ~2 s | `world.html`, `globe.html` |
| `GET /api/project?id=<town>` | JSON: one town's full replay — every session as a `street`, every file as a building. Same body shape as always; **gzipped only when the caller sends `Accept-Encoding: gzip`** (`Vary: Accept-Encoding`, 6.4x on the big town), so a browser gets the small one and `curl` still gets plain JSON. Stale-while-revalidate since 2026-09-07 — a stale but COMPLETE cache entry is served instantly and rebuilt behind the request; a stale `partial` one is not (see DECISIONS) | `index.html?project=`, the World's project cities |
| `GET /api/project/meta?id=<town>` | JSON: that project's trade classification (`_keyword_trade_type()` / `_software_default_trade()` / `_is_tool_project()`) and page count | town shape/sign on `world.html` / `globe.html` |
| `GET /api/project/asset` | binary passthrough for a project's own static files (images, etc.) | interiors (`interior.js`) rendering a real page |
| `GET /api/project/file` | JSON/raw: one file's content, or a 302 to the tree route for a raw page | interiors; walkable landmarks |
| `GET /api/project/tree/<town>/<path>` (`TREE_PATH_PREFIX`) | serves a project's own page with its relative asset URLs resolved against its real path (no `<base>` splice needed) | walkable interiors, world/globe landmark rooms |
| `GET /api/vault/search?q=` | JSON: full-text hits against the vault search index | `world.html`'s `/` address search |
| `GET /api/vault/note?id=` (+ `?meta=1`) | JSON/raw: one note's text or metadata | note interiors, the address search's caption |
| `GET /api/recordings` | JSON: every finished session film on disk (one row per sidecar), plus how many candidates are still un-rendered | `recordings.html` |
| `GET /api/play` | JSON `{alive, pid}`: is the play kiosk on screen, and which process is it. Also the place a kiosk closed some other way is forgotten (`play_alive()` polls the stored `Popen`) | `controls.js`, the acceptance run |
| `POST /api/play` | body `{"url": "<page>.html?<query>"}` — opens ONE fullscreen kiosk browser at that page over the desktop, on a throwaway browser profile it creates under the cache directory, and its own CDP port (4950). A second POST while one is alive is a no-op. **Loopback only — 403 otherwise, before any auth check** | `controls.js`, the `play` button on the wallpaper |
| `POST /api/play/stop` | kills the stored PID (`taskkill /PID <pid> /T /F`, never by image name) and answers `{alive:false}` | `controls.js` — the "back to desktop" button and Escape at the top level |
| `GET /recordings/<project>/<file>` | the MP4, its poster JPG and its sidecar JSON as plain files — with `Range` support, so a `<video>` can seek | `recordings.html`, and anyone the link is handed to |

Every path not matched above falls through to `super().do_GET()` — plain
static file serving out of the project root, which is how `index.html`,
`world.html`, `globe.html`, the `.js`/`.css` files and `assets/` are served
with no build step.

## Pages

| page | draws | reads |
|---|---|---|
| `index.html` (+ `city.js`, `replay.js`, `styles.css`) | one session, or one project's full history, as a city: a plate per directory, a building per file, floors for edits, lit windows for reads, drones for agents/tool calls, and a population per street — a crew on an avenue still being worked on, residents on a finished one | `GET /api/stream` or `GET /api/project` (live and project mode), or `?src=` pointing at any exported replay JSON. The two sample replays the private build fell back to are not in this repo — without a server the page has nothing to draw |
| `world.html` (+ `world.js`, `world.css`, `terrain.js`, `biomes.js`) | the whole vault as one island (Knowledge = mountain, Dev Logs = industrial valley, Daily = a river of dated bridges, People = a hill village, Ideas = offshore islands) plus every project as a harbour quarter | the generated vault export, `GET /api/world`, `GET /api/world/stream` |
| `globe.html` (+ `globe.js`, `globe.css`) | the same data as a 600-unit sphere: five continents, an ocean, an atmosphere, a real day/night terminator; imports exactly one thing from the rest of the repo, `hash32` from `biomes.js`, so a town lands on the same square metre in both `world.html` and `globe.html` | the same `GET /api/world` + vault data as the island |
| `buildings.html` / `life.html` / `drones.html` | showcase pages proving each standalone module on its own — see `docs/DECISIONS.md`, "BuildingKit / Life / DroneKit are standalone modules" | `assets/manifest.json` only |
| `recordings.html` (+ `recordings.js`, `recordings.css`) | the shelf: every finished session as a card — poster, duration, date, and four actions (play here, open the live replay, copy either link, download the MP4) | `GET /api/recordings` |
| `vault.html` | a redirect to `world.html?focus=vault` — no longer a separate renderer | — |
| `m.html` | the phone's front door: three tap targets (Globe / Island / City, each linking with `?mobile=1`) and a QR code of this page's own LAN address, drawn by an encoder written into the page so it works on a network with no internet | nothing — it reads `location.host` and no API at all |
| `archive/tree/`, `archive/vault-city.js` | the superseded 2D radial tree and flat vault-city renderer, kept runnable, not deleted (see `docs/DECISIONS.md`) | the same `data/` files |

## Shared modules

- **`replay.js` is time; `city.js` is space.** `replay.js` loads a session,
  drives the playback clock, and skips dead air (`gap * 0.02`, clamped
  280-1400 ms); `city.js` knows nothing about time and only draws what
  `ingest(event)` hands it. That single seam (`ingest`) is also what a live
  `EventSource` calls, so replay and live mode share one entry point.
- **`buildings.js`** — the standalone procedural building generator
  (`BuildingKit`). Nine styles, five palettes, four roof shapes, three LOD
  tiers. See `docs/BUILDINGS.md` for the full API and its own showcase.
- **`life.js`** — the standalone population layer (`Life`): cars, people,
  animals, robots. Every count is a parameter the caller passes in (sessions,
  road weight, live-agent count) — there is no random population size
  anywhere in the module. See `docs/LIFE.md`. **On the island** it is driven by
  `buildLife()` / `lifeCounts()` in `world.js`: people from sessions, traffic
  from the project link graph, herds from the projects nobody has opened in a
  month, parrots over the quarters `config.json`'s `aviary_projects` regex
  matches (opt-in: it ships empty, so by default there is no bird anywhere),
  and **zero robots** — a live
  agent is one aircraft and drawing it twice would be a lie about the count.
  `?life=0` builds the world without it. **In the project city** (`city.js`, since
  2026-09-07) it is driven per STREET and in two regimes: an avenue whose
  session is live or was touched inside the 30-minute TRON permanence gets a
  CREW (all `human.worker`, sized off that session's calls in flight and its
  Edits in the window, with orange cones round whatever is printing), and an
  older avenue gets residents and traffic off its own tool calls. The roads,
  pavements, doors and the forecourt square are cut from the city's own street
  and plate geometry, converted once at 0.23 units per metre. It is also the one
  host that has to LIGHT the module: `city.js` has no lights, so the crowd gets
  a sun and a hemisphere of its own on a dedicated layer, driven by the same
  `sunDir` / `sunColor` the facade shader is handed. `docs/HANDOFF.md` ->
  CITY-LIFE-DOC.
- **`drones.js`** — the standalone `DroneKit`: seven aircraft variants (the
  real ORNIS quadcopter airframe) whose *silhouette*, not colour, carries
  what they're doing. See `docs/DRONES.md`. **On the island** `makeDrone()` in
  `world.js` picks the variant from the agent's own payload — `orchestrator`
  for a main session, `worker.<family>` for an agent with that tool in flight,
  plain `agent` for an idle one — and hangs the tag on `tagAnchor` and the
  ribbon on `trailAnchor`. `?drones=orbs` brings back the old octahedrons.
- **THE MATERIALISATION** (`world.js`, THE MATERIALISATION section) — a
  `pulse` on the world stream (`GET /api/world/stream`) naming a file its quarter has never seen
  prints a new `BuildingKit` house onto that quarter's next free plot, over
  ~3 seconds, cut by a descending clipping plane with a laser rig, a lattice, a
  ground ring and a white-hot flash; a deletion derezzes it into red voxels.
  `?demo=print` replays a real town's last half hour of first touches at 0.5x;
  `P` replays the last print. Full write-up: `docs/HANDOFF.md` -> ISLAND-ALIVE-DOC.
- **`controls.js` + `controls.css`** — the enter / back / search buttons,
  bottom-right on all three pages (`<nav id="controls">`, `data-sid="controls"`).
  They exist because `globe.html?wallpaper=1` is the desktop and Lively forwards
  **mouse only**, so `/`, `Escape` and `Enter` never reach it. `controls.js`
  owns the cluster — labels, disabled states, a 250 ms poll (no page emits a
  selection-change event), and the quick-lists; each page's own
  `bindControls()` / `attachControls()` passes in what enter, exit and search
  MEAN there, and every one of those calls the function the KEY already called,
  so a button can never do something the keyboard cannot. The quick-lists under
  the search field — *last worked in*, *recent days*, *most linked notes* — are
  read from the payload the page is already built from (`plan.placed` +
  `noteMarks`, or `plan.index`), so a row cannot name a place that is not on the
  map; clicking one is exactly typing that address. No search button on
  `index.html`, which has no address search. Full write-up:
  `docs/HANDOFF.md` -> CONTROLS-DOC.
- **`interior.js`** — walkable interiors: entering a building, a landmark
  hall, or a project's own rendered page (via the `GET /api/project/tree` route).
- **`assets/cc0/*.glb`** — the rigid model pack (Kenney and Quaternius, CC0;
  it replaced a generated pack in phase B and kept its manifest keys). Two rules
  govern every
  use of it. **One:** the loader must carry `setMeshoptDecoder` — every file
  declares `EXT_meshopt_compression` in `extensionsRequired`, and without the
  decoder globe.js loses the model in silence while world.js fails to build at
  all. **Two:** a scan is used only where it means what it shows — that is what
  keeps `EducationalOrganization` off a church and what let it take `lm_school`
  the day one existed. The conifer is the one tree in the pack that reaches the
  forest, and it does so as two PHOTOGRAPHS of one normalised copy (the near
  crossed cards and the eight-bearing impostor atlas), never as 4,800 copies of
  a 50k-triangle mesh; the mesh itself stands only in the settlement near ring
  and inside the island's `PROP_SHELL`. `docs/HANDOFF.md` -> HUNYUAN-2-DOC.
- **`terrain.js`** — the island's ground and sun (`world.html` only): the
  real-clock sun position, the fading ground plane, the sea.
- **`biomes.js`** — where everything stands on the island/globe: the vault
  regions' geography, and `hash32()`, the one function `globe.js` imports so a
  town's position agrees between the island and the planet.

## The event schema

```
{ session: {id, cwd, started, duration_ms, title},
  agents:  [{id, label, started_ms?, ended_ms?}],
  events:  [{t, agent, kind, tool?, path?, summary?}] }
```

`kind` is one of `prompt`, `text`, `tool`, `agent_start`, `agent_end`. A `tool`
event carries the tool_use `id`; a matching `{kind:"tool_end", id, ok}` arrives
when the call returns — that pair is what lets a worker drone fly out, hover,
and be recalled by name rather than by guesswork (`docs/DECISIONS.md`, "One
drone per tool call in flight"). See `docs/RUNBOOK.md` → "Which file it
replays" for the exact fixture files.

## Recordings — a session you can watch back <!-- RECORDINGS-DOC -->

A recording is **two things**, and the difference is the point:

| | what it is | who can open it | exact? |
|---|---|---|---|
| the **replay link** | `index.html?project=<town>&session=<uuid>&replay=1` — the same city, rebuilt from the same events | anyone who can reach this machine (loopback, or another host plus Basic Auth) | yes: it IS the session, not a picture of it |
| the **MP4** | `recordings/<project>/<date>_<title>.mp4`, ~90 s, 1920x1080 | anyone the file is handed to | no: one fixed camera, compressed |

`oneStreet()` in `replay.js` is the whole of the first half. `GET /api/project`
already stamps every event with `session`, so one conversation is a filter over
a payload the page was going to fetch anyway — no second endpoint, and no export
that could disagree with the city. `&since=` is on the link because
`GET /api/project`'s own window is the last 30 days.

The second half is `tools/recorder.py`, started as one daemon thread from
`main()`. It renders one film at a time, and only when nobody is working
(`recorder_busy()`: no agent in flight and no transcript touched inside the live
window). A session qualifies once it has been silent for ten minutes and carries
at least twenty file-tool calls; the first run reaches back thirty days.

The render is **driven, not watched**. `?record=1` puts the page in record mode:
every overlay is hidden except a title card, and the replay advances one fixed
1/30 s step per `window.__recordTick()` instead of per wall-clock second. The
recorder ticks, screenshots, ticks again. Headless Chrome here has no GPU and
draws about eight frames a second, so a real-time capture would have shown a
quarter of the session — this way the film's length is arithmetic
(`frames / 30`) and nothing is dropped or raced. `filmPlanMs()` walks the same
dead-air rule `advance()` uses to work out how much session time one pass really
spends, and picks the playback speed from it, which is how ~90 s comes out the
end regardless of how long the conversation was.

`ffmpeg` is the **system** ffmpeg (Smart App Control blocks unsigned bundled
binaries here). Frames go in as a numbered JPEG sequence and come out as H.264
with `+faststart`; a poster is pulled from 55 % through, and a sidecar JSON
records what was measured — never estimated.

**Nothing is ever uploaded.** Transcripts carry client work, so no button on the
shelf sends a file anywhere; `copy link` and `copy download link` copy an
address on the current origin — whoever can already reach the server can already
open it, and nobody else can. See `docs/DECISIONS.md`.

## The town / street model

A **town is a project** (keyed on its resolved root directory, not a
session's raw `cwd` — see `docs/DECISIONS.md`). A **street is one session**
inside that town: the conversation's own title is the street's sign. A
directory touched by two different conversations stands as two plates, one
per street, because a plate is keyed on `street.key + '|' + dirpath`. A
building is never duplicated or re-seated once it exists — a later session
only adds floors to a file the city has already seen, and its worker drone
simply flies in from a different avenue. Full geometry rules (avenue origin,
`claimBand()`, annexes when a district is hemmed in): `docs/HANDOFF.md` →
"A city per PROJECT, a street per SESSION".

## LOD strategy

Three tiers, consistent across `buildings.js`, `drones.js` and the world's own
structures:

- **LOD0** — the near band: full geometry, real PBR materials, the shader-
  computed window grid, instanced roof prisms with a real eave.
- **LOD1** — the far band: a simplified/decimated version of the same asset
  (see `docs/BUILDINGS.md`'s two roof-prism bug fixes, both LOD-specific).
- **LOD2 / instanced** — everything beyond that renders as one instanced draw
  call per building type, which is what keeps 300+ buildings and dozens of
  drones inside the frame budget on an integrated GPU (`docs/HANDOFF.md`'s
  "Decisions, and why" section: one InstancedMesh, one shader, one draw call
  for a whole skyline).

## Diagram

```
~/.claude/projects/**/*.jsonl ---.
Obsidian vault ------------------+--> server.py --(/api/*, JSON + SSE)--> pages
project files (cwd/file paths) --'                                        |
docs/HANDOFF.md (open items) ----'                                        |
assets/manifest.json (CC0, fetched) ---------------> buildings.js/life.js/drones.js
                                                                            |
                                          index.html (city.js, replay.js) -+- session/project city
                                          world.html (world.js, terrain.js,|- vault-as-island + harbour
                                                        biomes.js)         |
                                          globe.html (globe.js) -----------'- vault-as-planet
                                                        ^
                                          hash32() shared from biomes.js
                                          (the one import globe.js takes
                                           from the rest of the repo)
```

## Launcher / screensaver

`launcher/install.ps1` (see `docs/RUNBOOK.md` → "Launcher & screensaver" for the
full table) registers three hidden Scheduled Tasks: `Werkstadt-Server` at logon
(`launcher/start-server.ps1`, runs `server.py` via `pythonw`, no console window),
`Werkstadt-Screensaver` at logon (`launcher/screensaver-watch.ps1`, polls real idle
time via `GetLastInputInfo` and launches an Edge/Chrome `--kiosk` window past the idle
threshold), and `Werkstadt-Restart` with no trigger at all — `schtasks /Run /TN
Werkstadt-Restart` is the documented way to reload `server.py` onto new code — see `docs/DECISIONS.md`, "Screensaver via a kiosk window, not a
compiled `.scr`"). `pythonw.exe`'s stdout/stderr are routed through Python
`logging` rather than bare `print()`, which is what fixed the
`ERR_CONNECTION_RESET` autostart bug (`docs/DECISIONS.md`).

## Gotchas worth knowing (see the named doc for the full story)

- `ThreadingHTTPServer` + per-cache locking, not one global lock — a real
  race on `world-index.tmp` and a lock-granularity bug were both found and
  fixed here. `docs/DECISIONS.md`, `docs/HANDOFF.md` → "Threading deadlock
  and /api/project timeout, fixed".
- Two `buildings.js` bugs (a black flat roof, an oversized roof overhang on
  big buildings) are fixed at the source now — `docs/BUILDINGS.md`; `globe.js`
  still carries a documented workaround for the pre-fix behaviour until that
  page's own owner removes it.
- `/api/project/tree/<id>/../server.py` must 403, not 200 — path traversal is
  rejected before the path is ever joined. See `docs/TESTS.md` row A6.

_Re-verified 2026-09-08: the pass that closed the 2026-09-07 acceptance's client FAILs
reloaded this subsystem's pages with `Network`, `Log` and `Runtime` collectors
armed — 0 console errors and no response >= 400 — and nothing in this file
changed. See docs/TESTS.md table Q._

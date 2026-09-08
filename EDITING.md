# Editing this page — for humans

_Verified: 2026-09-08_
_Globe round 6 — the rows for three live settlements, the buildings a reload puts back, the region-range terrain and forest tiers, the five touch gestures and `m.html`: 2026-09-06_
_The island's back yards survive a reload, cars are routed round the market square, `world.html` works with a finger, and the quiver tree is out of the harbour — the TOUCH-DOC section and the new World rows: 2026-09-06_
_Touch controls and mobile mode — the rows for the pinch/twist/tap/long-press gestures, the interior touch bridge, and `body.mobile-mode`: 2026-09-06_
_Globe round 4 — the rows for the living layer, the ORNIS fleet, live materialisation and the Hunyuan landmarks: 2026-09-06_
_The island's houses are built by `buildings.js` now — the kit town, the LOD shell and the scanned props: 2026-09-06_
_Globe realism pass — the rows for the coast, the ground splat, the buildings, the fields, the forests, the street and the vault's notes: 2026-09-06_
_Globe round 3 — the rows for the lot planner, the lanes and the plaza, the three tree species and the `window.Globe` seams: 2026-09-06_
_Every structure on the world map has an inside — notes, bridges, lighthouses, page wings: 2026-09-06_
_The materialisation is a 3-second sequence now — emitters, lattice, flash, camera cue, `?demo=print`: 2026-09-06_
_The island is alive — the rows for the population counts, the ORNIS craft over the live quarters, and the building that prints itself when a session touches a new file: 2026-09-06_

This is the page that replays a Claude Code session as a city that builds itself.
Four files, no build step, no framework. Open them in any editor, save, reload the
browser. That is the whole workflow.

## Where things live

| I want to change… | open | look for |
|---|---|---|
| the type, the corners, a colour of the text | `styles.css` | the `TOKENS` block at the top — every colour of the writing comes from those six variables |
| a font | `styles.css` | `--mono` and `--display`, plus the Google Fonts `<link>` in `index.html` |
| the text in the corners | `index.html` | the sections are labelled: `MASTHEAD`, `TALLIES`, `TICKER` |
| what a file type looks like as a building | `city.js` | the `TYPES` table near the top — one line per family: width, depth, floor height, starting floors, facade colour |
| which extension is which family | `city.js` | `EXT_TYPE`, right under `TYPES` |
| how a tool looks when it fires | `replay.js` | the `FAMILY` table at the top — one line per tool name |
| which conversation a building belongs to | `city.js` | the `STREETS` section — one avenue per session, opened by `openStreet()`. A building's lot is on the street of the session that FIRST touched the file, and it never moves after that |
| how deep an avenue is, and how far apart two of them stand | `city.js` | `bandFor()` (the depth a street reserves, sized from its own event count), `STREET_GAP` between avenues, `STREET_ROAD` for the carriageway itself |
| how long a street sign may be | `city.js` | `STREET_SIGN` (48 characters) in `CONSTANTS`; the sign itself is made in `nameStreet()` |
| whether a street's lamps are lit | `city.js` | `setStreetLive()` — a live session's avenue is lit, a finished one's is dim, and the sign stays either way |
| how the camera introduces a new avenue | `city.js` | `focusStreet()` and the `p.isStreet` branch in `updateCamera()` — it swings the aim to the new street for 3 s rather than diving into it |
| which project or session the page shows | `replay.js` | `pick()` — `?project=<town>`, `?src=<file>`, `?session=<uuid>`, `?live=1`, then the demo file |
| replaying ONE finished session instead of the whole project | the URL | `index.html?project=<town>&session=<uuid>&replay=1` — `oneStreet()` in `replay.js` filters the town's payload down to that one conversation. Add `&since=<the session's date>` for anything older than 30 days |
| how long a recorded film is, and what its title card says | `replay.js` | the `RECORD MODE` block — `titleFrames`, `endFrames`, `targetPlaySecs` (80) and `maxSpeed` in `REC`, and `startRecord()` for the card's two lines |
| what a recorded film HIDES | `styles.css` | the `RECORD MODE` section — one `body.record` rule listing every overlay that leaves the frame |
| which sessions get a film at all | `server.py` | `_build_recording_candidates()`; the three numbers it reads (`SILENT_SECS`, `MIN_TOOL_EVENTS`, `BACKLOG_DAYS`) live at the top of `tools/recorder.py` |
| the film's size, frame rate and quality | `tools/recorder.py` | `FPS`, `WIDTH`/`HEIGHT`, `CRF`, `MAXRATE` at the top — nothing else in that file decides the picture |
| the shelf page — cards, buttons, grouping | `recordings.html` / `recordings.css` / `recordings.js` | `filmCard()` builds one card; `recordings.css` carries the same tokens the city does, copied on purpose (its body has to scroll) |
| how many worker drones one agent may fly at once | `city.js` | `WORKER_CAP` (12) in `CONSTANTS` — past it the calls queue inside the craft and it wears a `+n` |
| how long a worker waits for a `tool_end` before flying home by itself | `city.js` | `WORKER_TIMEOUT_MS` (90 s of session time) — only ever reached in live mode |
| what a drone's tag says | `city.js` | `workerTagText()` for the workers, `makeDrone()` for the craft (it shows the agent's own task, cut at 42 characters) |
| which AIRFRAME an agent or a worker flies | `city.js` | `makeDrone()` picks `orchestrator` (the main craft) or `agent` (a subagent, coloured by tier); `FAM_CRAFT`, right above `makeWorker()`, maps a tool family to one of the five worker variants. The aircraft themselves are `drones.js` — see `docs/DRONES.md` |
| how big the aircraft are | `city.js` | `CRAFT_SCALE` (0.32). The kit is built in metres against `BuildingKit`; here a whole file stands on a 1.0-unit plot, so the city is about a third of that world. Change this and the tag heights and the camera solve move with it |
| flying the old glowing discs again — for an A/B, or with no model | the URL | `?drones=discs`. `loadDrones()` returns false, `kit` stays null, and every craft falls back to the octahedron-and-ring it flew before. The same fallback happens on its own if `assets/drones/ornis.glb` cannot be fetched |
| **who is walking on a street, and whether they are a crew or residents** | `city.js` | the `LIFE` section. A street whose session is live, or was touched inside `PERMANENCE_MS` (30 minutes of session time), is UNDER CONSTRUCTION and gets a crew in hi-vis; anything older gets residents. `lifeCountsFor()` is where both sizes are decided — **do not type a number into it.** Every one is read off that session's own tool calls, Edits and calls still in flight |
| how many people the city may hold at once | `city.js` | `LIFE_POOL_CREW` (40), `LIFE_POOL_RESIDENT` (72), `LIFE_POOL_CARS` (24) and `LIFE_NEAR_STREETS` (6, how many finished avenues get a population). `populate()` sizes every mesh once, so raising a pool is the only way to raise a ceiling — changing a `_MAX` alone does nothing |
| how big the people and the cars are | `city.js` | `LIFE_SCALE` (0.23 city units per metre). It is derived from the carriageway and the lamp post, which are the only two things in this city drawn at real street size — the comment beside it says why the building floor is NOT the anchor. Change it and the crowd, the traffic, the hedges and the pavement width all move together |
| why the people are not black silhouettes | `city.js` | `lifeSun` / `lifeFill` in `loadLife()`, and `markLifeLayer()`. This scene has no lights; the crowd gets its own two on `LIFE_LAYER` so that nothing else — above all the aircraft — is re-lit. Their colours come from the city's own `sunDir` / `sunColor` / `ambient` |
| the orange cones round a building being printed | `city.js` | `buildSiteCones()` and `syncSiteCones()`. They are drawn here and not by `life.js` on purpose: a cone is eight triangles, and a hoarding round a printing footprint is this file's own fact |
| how often the crowd re-decides where it stands | `city.js` | `LIFE_GRAPH_MS` (1.4 s) and `LIFE_FLIP_PER_TICK`. Lowering the first makes the layer chase the camera; raising it makes a street take longer to change hands |
| how small a caption is allowed to get | `city.js` | `MIN_TAG_PX` (13) and `MAX_TAG_GROWTH` in the `LABELS` section |
| the red of the lasers and the blue of the reads | `city.js` | `LASER` and `AZURE`, next to `GOLD` in the palette block |
| how long a building takes to materialise | `city.js` | `PRINT_MIN_SECONDS` (2.5) and `PRINT_MAX_SECONDS` (4.0) — `printSecondsFor()` picks between them by the building's drawn floors. `LAYER_SECONDS` (0.6) is one new floor from an Edit or a Write |
| what the print rig looks like — the emitters, the lasers, the scaffolding, the ground ring | `city.js` | `placeRig()`, and `buildPrintRigs()` for the parts it moves. `RIG_STRUTS` (8) is the lattice: 4 corner posts and 4 belt rails |
| how thick a laser is | `city.js` | `laserWidth()` — it is solved in PIXELS off the lens (2.4 of them) and never thinner than 4.5 cm, which is what makes a print readable from the wide shot |
| how long the scaffolding stays after the print lands | `city.js` | `RIG_HOLD_SECONDS` (0.6) then `RIG_DISSOLVE_SECONDS` (0.5) — it shortens from the top, so the ground lets go last |
| how bright a finished facade flashes | `city.js` | `FLASH_HOLD_SECONDS` / `FLASH_COOL_SECONDS`, and the `* 0.55` in the FLASH block of the facade shader. Do not raise that number: with bloom on, three facades at 2.6 blew the whole frame to white |
| how long a thing glitches before it derezzes | `city.js` | `GLITCH_SECONDS` (0.4) — `stepGlitch()` for buildings, the `d.glitch` branch of `stepDrones()` for craft |
| whether the camera cuts to a building being printed | `city.js` | `cuePrint()` — `PRINT_CUE_COOLDOWN` (12 s) is the rate, and it spends the SAME `FOCUS_BUDGET` every other close-up spends. Budget gone means no cue; the building still prints |
| the demo that jumps to three buildings printing at once | `replay.js` | `firstPrintCluster()` and the `?demo=print` block at the end of `boot()` |
| how tall a much-edited file is allowed to stand | `city.js` | `HEIGHT_SOFT` (24) and `HEIGHT_K` (4) in `CONSTANTS` — above 24 floors the count and the height stop being the same number, and the tower lights a beacon. The floor COUNT is untouched: the caption and the rooms inside still show every Edit |
| the furniture in a room | `interior.js` | the `FIXTURES` section — `DESK_POOL` and `DESK_Z` (the desks), `makeFloorLamps()` (a lamp per floor), `makeLiftNumbers()` (the floor plates on the lift), `eventPlates()` (the last three events) |
| the page window in an `.html` room | `interior.js` | the `THE PAGE ITSELF` section — `PAGE_PX_W`/`PAGE_W`/`PAGE_POS` for size and pose, `syncPageWindow()` for when it is on screen at all |
| the light trails | `city.js` | `TRAIL_SEG`, `TRAIL_LIFE`, `TRAIL_WIDTH`, `TRAIL_SLOTS` — one merged geometry per colour |
| when an untouched building goes grey | `city.js` | `PERMANENCE_MS` (30 minutes of session time) and `PERMANENCE_FADE_MS` |
| how often the camera is allowed a close-up | `city.js` | `BURST_EVENTS`, `FOCUS_SECONDS`, `FOCUS_WINDOW` and `FOCUS_BUDGET` above `updateCamera()` |
| how tightly the city is packed | `city.js` | `LOT`, `LOT_GAP`, `PLATE_PAD`, `PLATE_GAP` in the `CONSTANTS` block |
| the time of day | `city.js` | `SKY_KEYS` — five keyframes from dusk through night to dawn |
| how the camera behaves | `city.js` | the `CAMERA` section — `ORBIT_RATE`, `AIM_LIFT`, and the focus block in `updateCamera()` |
| how fast the replay runs | `replay.js` | `DEAD_AIR`, `HOLD_MIN`, `HOLD_MAX` above `advance()` |
| the glow | `replay.js` | `City.enableBloom(true)` in `boot()` — turn it off and the city goes matte |
| the Desktop shortcut, autostart, or the screensaver replacement | `launcher/` | PowerShell only, no `.js`/`.html`/`.css` here — see `docs/RUNBOOK.md` → "Launcher & screensaver" |
| how big a room is when you walk into a building | `interior.js` | the `CONSTANTS` block — `ROOM_W`, `ROOM_D`, `ROOM_H`, `SLAB` (the thickness between floors), `WELL` (the hole the lift rises through), `DOOR_W` |
| how many lines of the file go on one wall | `interior.js` | `PAGE_ROWS` (22) and `PAGE_COLS` (96). Three walls a floor, so 66 lines a floor. Making this bigger makes the type smaller — the floor is 14 px, measured, see `docs/RUNBOOK.md` |
| how big the type on a wall is | `interior.js` | `PANEL_H`, `PANEL_ASPECT` and `GLYPH_FRAC`, right under `PAGE_ROWS`. Do not raise `PAGE_ROWS` without re-measuring `__interior().minGlyphPx` |
| how fast you glide inside, and how quick the mouse is | `interior.js` | `MOVE_SPEED` and `LOOK_SENS` |
| how long the camera takes to fly into a door | `interior.js` | `FLY_SECONDS` |
| how bright a room is | `interior.js` | `buildShell()` — two point lights and a hemisphere. The numbers look huge because three's lights have been in physical units since r155 |
| when a wall of source counts as "written recently" | `interior.js` | `RECENT_MS` (30 minutes of session time — the same half hour the city greys a building on) |
| how many clicks it takes to walk into a building | `city.js` | the `PICKING` section — hover, then arm, then enter. Two clicks on purpose: the camera orbits under the pointer, so one click would send you inside every time you tried to drag |
| touch gestures — orbit, pinch-zoom, twist, tap, long-press | `city.js` | `attachPointer()` (the pinch/twist, alongside the mouse drag it shares state with) and `attachPicker()` (long-press, right above the tap/double-tap logic it was already using) |
| touch inside a building — move, look, the exit tap | `city.js` | `attachInteriorTouch()` — dispatches the same keydown/mousedown events `interior.js` already listens for; nothing in that file changed |
| whether the page is in mobile mode, and what that trims | `city.js` | `MOBILE` right above `WORKER_CAP` — `?mobile=1` or an auto-detected coarse pointer. `WORKER_CAP`, `TRAIL_LIFE` and the bloom pass's pixel ratio (`enableBloom()`) all read it |
| the mobile play/pause glyph and the ticker swipe | `replay.js` | `attachMobilePlaypause()` and `attachTickerSwipe()`, right after the `CHROME` banner |
| the mobile chrome — bottom-sheet hints, one-line ticker, the glyph's own look | `styles.css` | the `MOBILE MODE` section, keyed off `body.mobile-mode` |

Every section in `index.html` carries `data-sid` (a short id) and `data-title`
(what the section is, in plain words). The same names are used as banner comments
in `styles.css`, so you can search one word and find both halves. `city.js` and
`replay.js` are divided by the same kind of banner.


## The World <!-- WORLD-MAP-DOC -->

`world.html` + `world.css` + `world.js` + `terrain.js` + `biomes.js` is the second
page in this folder: everything at once, as one island. It needs `server.py`
running (not `python -m http.server`) for the harbour half; the land draws
without it.

Three files, and it is worth knowing which is which before you open one:

- **`terrain.js` is the ground and the light.** The heightmap, the coastline, the
  mountain, the river, the sea, and where the sun is. If you want to move the
  land, you are in here.
- **`biomes.js` is where everything stands.** It reads the vault and the projects
  and hands back a list of placements. It makes no shapes and picks no colours.
  If you want a region somewhere else, you are in here.
- **`world.js` is what it is made of and how it behaves.** Materials, instancing,
  the camera, the caption, the search, the live feeds.

- **`interior.js` is the inside of things.** One module, two buildings: the
  session city's stacked room (`enterBuilding`) and the world's trade hall
  (`enterHall`). `world.js` attaches it with `hallOnly: true`, which is what
  stops the city's room being built on a page that never opens one.

| I want to change… | open | look for |
|---|---|---|
| the colours or the type of the writing on the map | `world.css` | the `TOKENS` block at the top |
| what a trade's hall is filled with | `interior.js` | `HALL_DRESS` — one line per trade, then `HALL_BODY` for the far end and `HALL_STATION` for the per-page bay |
| which instrument a practice room gets | `interior.js` | `INSTRUMENTS`, right above it — a list of patterns matched against the page's own title |
| how far apart the practice rooms stand | `interior.js` | `pitch` in that trade's `HALL_DRESS` row |
| how bright it is inside | `interior.js` | the four lights at the end of `enterHall()`, and `hallMaterials()` for the tints |
| where a region sits | `biomes.js` | the `REGIONS` table near the top — one line per region, x and z |
| how big a note's building is for its word count | `biomes.js` | `wordsToHeight` and `wordsToFoot`, right under `REGIONS` |
| how long after writing a note its windows stay lit | `biomes.js` | `freshness()` — six hours |
| how many houses a project quarter gets | `biomes.js` | the quarter block: `ceil(log2(tool_calls+1)) + 2`, floored at 3 and capped at 14. A town whose trade the server recognised gets none — it is built as its trade instead |
| what colour and what roof a house has | `biomes.js` | `PALETTES` / `ROOF_TYPES` / `COASTAL_PALETTES` at the top. Each building picks one of each from a hash of the note or town it came from; `world.js` owns what the names look like |
| **what a house actually looks like** | `world.js` | `KIT_CATALOGUE` in THE KIT TOWN — six buckets (harbour houses, People cottages, Dev Logs factories, Knowledge terraces, the Old Town, the fortress), each a short list of style + palette + roof rows out of `buildings.js`. A hash of the building's own position picks the row. **Keep the list short**: every extra row is another baked facade and another instanced draw call |
| whether a `wall` record is a building or a retaining wall | `biomes.js` | `fortress: true` on the 28 Boards curtain blocks. Everything else called `wall` holds a terrace up and stays a box |
| how many full-detail buildings may stand at once | `world.js` | `KIT_MAX_LOD0` (22 high / 8 medium). Each one is ~8.7 k triangles and 9 draw calls — this is the whole near-field budget |
| how far the lens must move before the town re-solves its detail | `world.js` | `KIT_MOVE` (9 m) and `KIT_HYST` (14 m). Lower them and the instanced groups rebuild constantly, which costs far more than the detail saves |
| which props stand where | `world.js` | `planProps()` in THE PROPS — one block per place: the harbour lanes and quay, the People paths and greens, the Dev Logs yards, the fortress, the slopes |
| **how many props may be on screen** | `world.js` | `PROP_SPEC` — a cap and a real height in metres per type, plus whether it casts a shadow. These are a measured triangle budget: one quiver tree is 82 k triangles and one fence module 89 k. Raising a cap costs frames, and the reason each one is where it is sits in the comment above the table |
| how far from the lens props exist at all | `world.js` | `PROP_SHELL` (115 m). Past it there are none, which is why the wide shot of the island is as cheap as it always was |
| **where the scanned quiver tree is allowed to stand** | `world.js` | `planProps()`'s `dryTrees` filter — species `scrub`, ground below `DRY_BAND_TOP` (4.2 m, the terrain's own sand threshold), and at least `QUIVER_KEEP_OUT` (60 m) from any project quarter. It is a desert tree; on a European harbour street it reads as a palm, which is the same defect `globe.js` fixed with its own hot-dry band. Everywhere else the forest's own broadleaf and conifer cards keep standing |
| **how many people, cars and animals are on the island** | `world.js` | `lifeCounts()` in THE LIVING LAYER. **Do not put a number in it.** Every count is a division of something real — sessions per person, link weight per car, one grazer per dormant project — and the dividers (`LIFE_PER_RESIDENT`, `LIFE_PER_CAR`, `LIFE_NOTES_PER_BIRD`) are what you change if the island feels empty or crowded |
| the ceiling on the population, per quality | `world.js` | `LIFE_CAPS` — high / medium / low. These are a frame-rate budget, applied AFTER the data has spoken |
| how much frame time the living layer may cost | `world.js` | `LIFE_MAX_SKINNED` (24 real skeletons at once) and `LIFE_RIGID` (3 vehicles at full detail). `docs/LIFE.md` calls these the only two dials worth pulling |
| when a project counts as asleep and gets grazed | `world.js` | `DORMANT_DAYS` (30) and `DORMANT_OLD_DAYS` (45) — the first is sheep in the quarry, the second cows out on the steppe |
| where the crowd walks and where the traffic runs | `world.js` | `harbourQuay()` (the waterfront: footway at 2.4 m out, carriageway at 5.6 m), `lifeWalkways()` and `lifeRoads()`. `LIFE_MAX_ROADS` (40) is a hard limit — `life.js` finds its junctions in O(roads²) |
| which aircraft an agent flies | `world.js` | `droneVariant()` and the `DRONE_FAMILY` table in THE FLEET — the tool it has open picks the craft. `?drones=orbs` brings back the old glowing octahedrons |
| how long a building takes to print | `world.js` | `PRINT_MIN_SECONDS` / `PRINT_MAX_SECONDS` in THE MATERIALISATION. **Duration is the whole feature** — at 1.2 s nobody could see any of it |
| how tall a printed building is | `world.js` | `PRINT_FLOORS` — a file that was read is a shed, a file that was written is a house — plus one floor for every time it has been written SINCE, up to `LIVE_MAX_FLOORS` (9) |
| **whether the back yards survive a reload** | `world.js` | `seedPrintedBuildings()`. On load it asks `/api/project` for the last `SEED_SCAN_CAP` (4) active towns and stands up every file they first touched inside `SEED_WINDOW_MS` (24 h), up to `SEED_PER_TOWN` (12) each — **without printing them.** A print is the event; replaying forty of them at load would be forty lies about what is happening now |
| how far back a reload remembers, and how many buildings that is | `world.js` | `SEED_WINDOW_MS`, `SEED_SCAN_CAP`, `SEED_PER_TOWN`. `SEED_PER_TOWN` is four rows of `HOUSE_GRID` (21.6 m) — raise it and a quarter's back yard reaches the row of quarters behind it |
| what a printed building's caption says | `world.js` | the `hit.kind === 'print'` branch of `showCaption()` — the path, when it was first touched, which agent touched it, and how many floors it has grown |
| **whether cars drive across the market square** | `world.js` | `clipRoadsAroundPlazas()` + `lifePlazas()`. Every trunk road on this island starts at the fortress court's own centre, so the polylines are cut where they cross a plaza (plus `PLAZA_KERB`, 5 m) before `addRoads()` ever sees them. Check it with `__vehicles()` — `offCarriageway` must be `[]` |
| how often the camera is allowed to go and watch a print | `world.js` | `FOCUS_BUDGET` (40% of any two minutes) and `PRINT_CUE_COOLDOWN` (12 s). Budget spent means no cue, and the building still prints |
| how many street lamps really light something | `world.js` | `MAX_LAMP_LIGHTS` (8) and `setLampPower()` — every other bulb is emissive only. The intensity is 6 cd; at 12 the whole near field went over the bloom threshold |
| how the shore is broken into districts | `biomes.js` | `DISTRICTS` (6) and `DISTRICT_LANE` (16 m) in the quarters block — the empty lane between blocks of quarters |
| what a music school / restaurant / factory looks like | `world.js` | `FORM_BUILDERS` — one function per shape, written in plain metres. `TRADE_FORMS` above it maps a schema.org type onto one |
| which schema.org types get a building of their own | `world.js` | `TRADE_FORMS` — add a line, and a builder under it, and that trade stops being a generic quarter |
| which projects the server calls which trade in the first place | `config/trades.json` | the keyword table: one regex → schema.org type per row, read by `server.py` (`trades_file` in `config.json` points at it). This is the file to edit when a project is drawn as the wrong building |
| how big a landmark is next to the houses | `world.js` | `LM_SCALE` (1.5) and `LM_YARD` in `biomes.js` (the empty ground it owns). They have to move together |
| where a project's logo sign hangs and how big it is | `world.js` | `SIGN_CAP_PX` (the town name's cap height on the frame, in pixels — this is the size, not a world width), `SIGN_MIN_H`/`SIGN_MAX_H`, `SIGN_POST_H`, `SIGN_OFFSET_X/Z`, and `updateSigns()`, which solves the world scale from the camera every frame and culls signs that overlap |
| whether a sign is readable | run `__signPixels()` in the console | `minCapPx` is the floor of the visible set. Gate: 18 |
| **why the signs are smaller on a phone** | `world.js` | `SIGN_CAP_PX` is `15` under `MOBILE` and `22` otherwise, and `SIGN_MIN_CAP_PX` goes 18 → 12 with it. A sign's width follows the NAME on it, so 22 px of cap height on a 390 px frame is a plaque across the whole picture. `LABEL_CAP_PX` (the drone tags) does the same, 14 → 11 |
| how tall a page's wing is | `world.js` | the wings block in `buildTradeLandmarks()` — log on the page's byte count |
| how the harbour is laid out along the coast | `biomes.js` | `ROWS` and `PER_ROW` in the quarters block |
| how dense the forests are | `biomes.js` | `STEP` and the `clump` line in the FOREST block |
| which links get their own road | `biomes.js` | the ROADS block — `span <= 62` is the neighbour rule |
| the size and shape of the island | `terrain.js` | `WORLD`, `COAST_X`, `MOUNTAIN`, `VALLEY`, and the seven numbered steps in `heightAt()` |
| the river's course | `terrain.js` | `RIVER_CTRL` — seven control points, mountain foot to sea |
| where the sun thinks it is | `terrain.js` | `LAT` and `LON` (Innsbruck) in the SUN block |
| which ground texture appears where | `terrain.js` | `splatW()` inside `buildTerrain` — four weights by height and slope |
| the green of the grass | `terrain.js` | the `grass *= vec3(...)` line — the pack's grass is a DRY grass, see the comment |
| how big the lit windows are and how many are on | `world.js` | the windows block inside `makeWallMaterial` — a 1.7 m by 1.5 m grid, 2 panes in 5 |
| the colour of a wall family | `world.js` | the `P` table in `buildWorld`. **Five of those pools are invisible now** — `plaster`, `white`, `brick`, `timber` and `stone` are the PICK COLLIDER under the kit buildings, so changing their colour changes nothing you can see. What is still drawn as a box: `quarry`, `ruinStone` (the ruins), `retain` (the Knowledge retaining walls) and `chimney`. `famName()` right above the table decides which pool a record goes in |
| the shape of a roof | `world.js` | **not here any more.** The kit builds every roof; `KIT_CATALOGUE` picks `gable`, `hip`, `flat` or `mansard` per row. `roofGeo()` is still used, but only by the trade landmarks |
| the window rhythm and the shutters | `world.js` | inside `makeWallMaterial`'s windows block — two rhythms (1.7 m / 2.4 m) and the shutters, both picked from the instance's own `vSeed`, NOT from a new attribute (the shader is already on sixteen and a seventeenth will not link) |
| how many cranes the world may show at once | `world.js` | `MAX_CRANES` |
| the opening camera | `world.js` | `frameCamera()` — distance, elevation, where it looks |
| how fast the screensaver orbit turns | `world.js` | `updateCamera()` — 0.012 rad/s with `?screensaver=1`, 0.02 without |
| what the search understands | `world.js` | `parseDate()` for the dates, `fuzzy()` for everything else |
| the `globe` link beside the title | `world.html` + `world.css` | the `MASTHEAD` block and `#globe-link`. `#masthead` is `pointer-events:none` so a drag anywhere over it still turns the map; the link takes pointer events back for itself alone |
| how long a town stays "alive" after its last event | `server.py` | `LIVE_WINDOW_SECS`, 120 seconds |
| where the open items come from | `server.py` | `handoff_open_items()` and `board_open_items()` |

Things not to touch here:

- **`data/.cache/world-index.json`** is a cache the server rebuilds by itself. Deleting
  it is safe and costs about a minute; editing it by hand will make the map lie.
- **The in-flight test in `session_live_state()`** (`server.py`) asks whether a
  subagent's own transcript was written recently, not "has the tool call come
  back". The reason is in `docs/HANDOFF.md`; change it back and every drone
  disappears.
- **`side: THREE.DoubleSide` on the roof material.** The roof prism is
  hand-indexed and its two gable triangles wind the other way to its slopes.
  Single-sided, every roof in the world turns flat black.
- **The metres-per-tile numbers in the terrain splat.** The cliff texture is
  stratified rock; at the pack's own 1.83 m it tiles into a woven basket pattern
  across the whole mountain that looks like a bug in something else entirely.
- **`rememberTrade()` in `world.js`.** `/api/world` computes a town's trade
  lazily and answers `null` for the ones it ran out of time for, so a `null`
  there means "not yet", not "no trade". Remove this and the page keeps losing
  landmarks it had already found — it shipped 20 of 45 that way.
- **The "no generic houses for a trade town" line in `biomes.js`.** Put the
  houses back and the concert hall disappears under fourteen hip roofs; that was
  measured, not feared.
- **`toLand()` and the river guard in `place()`** (`biomes.js`). They are what
  keeps buildings out of the sea and off the river. Add a new region without
  going through `place()` and it will build in the water.

To see the keyboard hints again:
`localStorage.removeItem('werkstadt.world-hints')`. To clear a remembered
quality setting: `localStorage.removeItem('werkstadt.quality')`.

## The Globe <!-- GLOBE-DOC -->

`globe.html` is the planet: the same work as the island, on a sphere you can
turn, with five continents and a day and a night side. Three files, no build
step: `globe.html` (the words in the corners), `globe.css` (their colour and
type) and `globe.js` (the planet). It reads nothing from `world.js`, so you can
change one without touching the other.

Open `http://127.0.0.1:4949/globe.html` with the server running.

| I want to change… | open | look for |
|---|---|---|
| a colour or the type of the writing on top | `globe.css` | the `TOKENS` block at the very top — six variables, everything else reads them |
| the words in the corners | `globe.html` | the sections are labelled: `MASTHEAD`, `CAPTION`, `SEARCH`, `HINTS` |
| how big the planet is | `globe.js` | `R` at the top (600). Everything else is derived from it — do not change one number here without re-reading `__planet().landFraction` afterwards |
| where a continent is, or what it is called | `globe.js` | the `CONTINENTS` table — one row each: label, latitude, longitude, angular radius, tint. These are constants on purpose: a continent that moves between reloads is a map nobody can learn |
| which projects land on which continent | `config.json` | the `continents` list — one `{path_contains, continent}` rule per line, tried in order, first match wins. `continentOf()` in `globe.js` is only the loop that reads them (served to the page by `GET /api/config.js`); anything under your home directory matching no rule lands on `frontier`, anything outside it becomes an offshore island |
| **how much of the planet is land** | `globe.js` | the `r` values in `CONTINENTS`. Measure after, never guess: `window.__planet().landFraction`, and 0.35 is the target |
| where the coastline actually falls | `globe.js` | `SEA` (0.70), just under `landMask()`. That is the waterline, and it is the ONLY thing that decides it. It moves TOGETHER with the `1.24` / `0.86` ramp in `landMask` — the comment there gives the arithmetic |
| how steep the coast is — beach or cliff | `globe.js` | the `-32 * Math.pow(below, 1.9)` line in `elevRaw()`. This is the continental shelf: a low power is a gentle beach, a high one is a wall. It is why there are no cliff walls at the shore any more |
| which ground texture goes where | `globe.js` | `splatWeights()` — five lines, one each for sand, forest floor, rock and snow, and grass is whatever is left. `groundMaterial()`'s shader is what paints them |
| where the woods are | `globe.js` | `forestMask()` — ONE function, read by both the ground splat and `buildForests()`, so the trees always stand on their own forest floor |
| where the rivers run | `globe.js` | `riverAt()`. A river is where a noise crosses its own middle; the `0.982` is how wide, the `* 7` in `elevRaw()` is how deep |
| how mountainous a continent is | `globe.js` | the per-continent block in `elevRaw()` — one line each: Werkland rolls, Federkueste is cliffs, Werkzeugland is a broken plateau, Neuland is flat and dry |
| the vault continent's five regions | `globe.js` | `VAULT_REGIONS` (bearing, distance and kind for each) and `vaultRelief()`, which cuts the mountain, the valley, the river channel, the hill village and the fortress bluff into the ground |
| **when a project counts as a city, a town or a field** | `globe.js` | `classOf()` — five lines, the thresholds in plain numbers. This is the whole map's meaning: change it and every settlement can change class |
| how many buildings a class gets | `globe.js` | `CLASSES` — the pad radius, the building count, the tower count and the light count, one row per class |
| **what the buildings look like** | `globe.js` | `CATALOGUE` — ten types, each a style + palette + footprint + floors out of `buildings.js`. Ten, not two hundred: `BuildingKit.instanced()` makes one draw call per type, so the catalogue's LENGTH is the frame rate |
| which types a village or a city is built from | `globe.js` | `CLASS_COMMON` (a repeated number is a weight) and `CLASS_SPECIAL` (the church and the civic block, one each, always, in the middle) |
| **where each building stands** | `globe.js` | `planBuildings()` — the LOT PLANNER. Lanes first (`laneNetwork()`), then a lot beside each lane, and a lot is only taken if its footprint plus 1.2 m of daylight clears every lot already taken and every carriageway. Read TWICE, by the map and by the street, which is what keeps them the same place. **Change nothing here without re-reading `window.__overlaps()` — it must come back `pairs: 0`** |
| how much daylight there is between two houses | `globe.js` | `LOT_GAP` (1.2 m), `LOT_SETBACK` (from the carriageway to the front wall), `LOT_BACKOFF` and `LOT_SHRINK` — the ladder the planner tries before it drops a building |
| how a village's lanes are shaped | `globe.js` | `laneNetwork()` — `nSpoke` per class, the `bow` (how far a lane wanders over its length), the `rings` table, and `plazaR`. **Two rings closer than about 17 m make BOTH their rows of lots fail**; four rings on the city measured worse than two |
| how many houses actually got built | `globe.js` | nothing — read it: `window.__structures().dropped` is how many could not be fitted. It is reported rather than hidden. If it jumps, a class's ground or its ring spacing changed |
| the ground a village stands on | `globe.js` | four surfaces, four lifts: `padGeometry()` is the grass between the houses, and `settlementSurfaces()` builds the cobbled plaza, the gravel lanes and the 1.5 m path from every door to its lane. `LANE_LIFT` / `PLAZA_LIFT` / `PATH_LIFT` are 30 cm apart on purpose — 2 cm is inside the depth buffer's own noise at region distance and the lanes vanish |
| the colour of a lane or a road | `globe.js` | `cLane` / `cPath` in `settlementSurfaces()` and `cDim` in `buildRoads()`. These MULTIPLY the gravel photograph, which averages 0.19 linear, so they have to be near-white; a warm one comes out pink under a low sun |
| the worn ring of ground round a settlement | `globe.js` | `townGround()` and the `vTown` block in `groundMaterial()`'s shader. A tint on the sample that is already there, not a fifth texture — the ground shader has no fetch to spare |
| what you see standing in a village | `globe.js` | `buildNearTown()` and `streetProps()` — the lamp posts, the benches, the barrels, the fences, the boats, the rocks and the real trees |
| how close you have to be for full detail | `globe.js` | the `* 1.7` inside `kit.lodFor(...)` in `buildNearTown()`. Bigger number, smaller LOD0 band, faster frame |
| what a ploughed field looks like | `globe.js` | `fieldParcels()` — four quads of the `farmland` texture, each turned its own way, plus the kit's barn. The furrows are in the TEXTURE, not in geometry |
| **which tree grows where** | `globe.js` | `TREE_SPECIES` (three rows: broadleaf, conifer, and the pack's quiver tree) and `speciesAt()`, which decides by latitude then elevation. **The quiver tree is the pack's model and belongs ONLY in the hot dry band** — that is what `speciesAt()`'s `dry` term is for, and widening it puts palms back on an Alpine street |
| what a tree is made of | `globe.js` | `canopyGeometry()` (crossed planes plus the one flat card a globe needs) and `leafTexture()` (four hundred ellipses drawn on a canvas at load — the ragged edge of a canopy lives in the texture, where it is cheap). The quiver tree instead uses `bakeImpostor()` on the real model |
| how many trees there are, and where | `globe.js` | `buildForests()` — the count round each settlement, the river-bank pass, and `shadedSlope()`, which thickens the wood on the shaded side of a hill. Check it with `window.__treeSpecies()` |
| when a tree gets its trunk | `globe.js` | `updateTreeLod()` — 350 m of camera altitude, and only for the continent bucket the camera is over. Above it a tree is its canopy cards alone |
| the colour of the ground | `globe.js` | `BIOME` — six named colours, sand through snow — and `biomeColor()` under it, which decides which one by height, slope and latitude |
| how the sea looks | `globe.js` | `buildOcean()` — `uShelf`, `uShallow` and `uDeep` are the three depth colours (they go IN to the tone curve, so they look too bright in a swatch), the two `pow()` terms are the sun glint, `foam` is the line at the shore and the fresnel line is the pale limb |
| how cloudy it is | `globe.js` | the `0.42` in `cloudTexture()`. Check it with `window.__clouds()`; 0.38 is what it ships at |
| why the clouds vanish when you fly down | `globe.js` | `uHigh` in `buildClouds()`, set from the altitude in `updateSun()`. The deck sits 17 units up, so from a region view it is a sheet between you and the map. Its SHADOW on the ground is deliberately not faded with it |
| the sky, and the ring round the planet | `globe.js` | `buildAtmosphere()`. `uInside` is what turns the rim into a daylight sky when the camera comes down; `R_SKY` at the top is how far up the air reaches |
| when the camera lies down toward the horizon | `globe.js` | `cam.tilt` in `updateCamera()` — `smoothstep(260, 25, altitude)`. Both numbers are heights above the ground |
| how far you can zoom in and out | `globe.js` | `DIST_MIN` and `DIST_MAX`, near the `cam` object |
| how fast the planet turns by itself | `globe.js` | `cam.spin` — degrees of longitude a second, halved by `?screensaver=1` |
| which town names are shown | `globe.js` | `buildSigns()` (cities, towns and any settlement with a landmark) and `updateSigns()`, which hides a name that would land on one already drawn |
| how big a name is on screen | `globe.js` | `SIGN_CAP_TARGET` (**21 px** since 2026-09-06 — it was 18 against a gate of 18, which is no margin at all) and `SIGN_MIN_CAP_PX` (13). Below the floor a plaque is hidden rather than drawn as a smudge |
| what a trade's landmark looks like | `globe.js` | `TRADE_FORMS` (which trade gets which shape) and `landmarkGeo()` (the shapes). **`world.js` is the source of truth for the table** — see the comment above it |
| how loud the roads are | `globe.js` | `buildRoads()` — `cDim` and `cLane` for the colours, the `weight < 4` line for how many shipping lanes are drawn at all |
| the weather over a live town | `globe.js` | the `puff` shader in `rebuildLive()`, and `puffFade` in `updateSun()` — the puff is a map symbol and is faded out below 320 units so you are never standing inside it |
| **what the address search finds** | `globe.js` | `searchHits()` — settlements, continents, vault regions, and since 2026-09-06 the vault's NOTES as well. `parseDate()` above it turns `2026-08-14`, `14.8`, `yesterday` and `today` into one date, so a day is an address: it flies to that day's cottage on the Daily river and opens its caption |
| **flying with the keys instead of the orbit** | `globe.js` | the `FREE FLY` block under `updateCamera()`. `F` toggles it; the state is an AXIS, an ALTITUDE and a bearing, never a loose position and quaternion — that is why it cannot get lost on a sphere. `FREE_BASE` is the speed, `FREE_ALT_MIN` / `FREE_ALT_MAX` (2 m and 400 m over the ground) are how low and how high, `FREE_LOOK` is the mouse. The line at the bottom of the screen is `#free-hud` in `globe.html` |
| **the vault's notes** | `globe.js` | `buildVaultNotes()` — which folder goes to which of the five landforms (`NOTE_FOLDER`), what a note is built as (`NOTE_TYPE`), and `floors` from the note's own word count. `noteAt()` is the hover and the double-click |
| what a drone looks like and what its label says | `globe.js` | `makeCraft()` (which of the seven ORNIS variants, from `droneVariant()`) and `taskTag()` (the label — the agent's own task, cut at 42 characters). The airframe itself is `drones.js` and is NOT edited from here |
| which craft an agent flies | `globe.js` | `droneVariant()` and `DRONE_FAMILY`. `orchestrator` for a session's main agent, `agent` for a subagent doing nothing, `worker.<family>` for the tool it has open. Change the map, not the kit |
| where a drone hovers | `globe.js` | `makeCraft()`'s `radius` and `alt` — 0.85 of the settlement's radius and 11 m up, one storey over a cottage's ridge. Bigger numbers put the fleet outside the town and out of every street frame |
| **how many people and cars a settlement has** | `globe.js` | `lifeCountsFor()` — one resident per session, traffic from the real link weight, herds only on a `fields` (dormant) settlement, parrots only over the projects `aviary_projects` in `config.json` matches (empty by default, so no bird anywhere). `LIFE_CLASS_CAP` is the ceiling per class and it is what stops a 341-session project holding a crowd its houses cannot. **Never type a count in here — every one of them is read off the payload** |
| how expensive the crowd is allowed to be | `globe.js` | `LIFE_MAX_SKINNED` (24) and `LIFE_RIGID` (3), and `LIFE_Q` which halves everything at medium quality. Check with `window.__life().draws` — the gate is 90 |
| which settlement is alive right now | `globe.js` | `updateLife()` — `LIFE_ALT` (300 units) is when the layer comes on at all, and `STAGE_HOLD_MS` (1.2 s) is the hysteresis that stops the crowd teleporting between two neighbours as the camera crosses the ground between them |
| **the flat world life.js stands on** | `globe.js` | `aimStage()` and `stageHeight()`. The basis is `(east, up, -north)` and the minus is NOT optional — `(east, up, north)` is left-handed and mirrors every model in it. Read the GLOBE-STAGE-DOC comment before touching either |
| where the walkers, the cars and the birds actually go | `globe.js` | `lifeRoadsFor()`, `lifeWalkwaysFor()`, `lifePlazaFor()`, `lifePastureFor()` and `lifePerchesFor()` — every one of them reads the settlement's own plan, so a car is on a lane that is drawn |
| **how long a building takes to materialise** | `globe.js` | `PRINT_MIN_SECONDS` / `PRINT_MAX_SECONDS` (2.5 to 4.0 s by floors). Duration is the whole feature: at the 1.2 s this started as, nobody could see any of it |
| how bright the finished flash is | `globe.js` | `FLASH_PEAK` (0.22). This page's bloom threshold is 0.62 — at the city's 0.55 the whole frame goes white. Look at `docs/shots/globe-print.png` after any change |
| where a new building lands | `globe.js` | `freeLot()` — the settlement's own lot planner run again, furthest lane station first, because a full village grows at its edge. **Re-read `window.__overlaps()` after: still `pairs: 0`** |
| what happens when a file is deleted | `globe.js` | `derezPath()` and `stepDerez()` — 0.4 s of tearing, then red voxels. Never a fade |
| **which trade gets a scanned landmark** | `globe.js` | `LM_MODEL` (trade type → `model.hy.lm_*`) and `LM_HEIGHT` (8.5 to 14 m by class). A trade with no scan keeps the procedural shape in `landmarkGeo()`. **Do not point a trade at a scan that means something else** — there is no lm_school, and a school under a church spire is a lie about the building |
| **how life.js or drones.js gets on to these lanes** | `globe.js` | the `window.Globe` block at the very bottom: `onTown()` / `onTownEvent()` (the stream dispatcher), `getSettlement()`, `getHeight()`, `localToWorld()`, `roadsFor()`. Nothing in that block draws anything — it is the seam, and it is there so nobody re-derives where a lane is |
| how bright the sun's glint on the sea is | `globe.js` | the `min(0.34, …)` in `buildOcean()`'s shader. The cap is applied BEFORE the tone map and the bloom adds to it after, so it is always lower than it looks |
| **how many settlements are alive at once** | `globe.js` | `SAT_MAX` (2 neighbours besides the stage, so three in all) and `SAT_RANGE` (600 units from the lens), in the GLOBE-SAT-DOC block. `SAT_SHARE` (0.5) is the "half people" the second and third get. Check with `window.__life().towns` — it names all three and what each was given |
| **why the neighbours are sprites and not people** | `globe.js` | the GLOBE-SAT-DOC comment. `life.js` is a flat-world module hanging off ONE tangent stage and a plane wide enough for three settlements would have its edges 300 m in the air, so the neighbours get their own layer, drawn with `life.js`'s OWN sprite bake. The VAT tier is module-private and the API is frozen — this is not a shortcut, it is the tier that is reachable |
| how much the neighbours cost | `globe.js` | one `InstancedMesh` per human MODEL for ALL satellites (world space, no Group per town), so the whole feature is four draw calls. `window.__life().satDraws` says how many are actually submitted; the budget for the whole living layer is `draws <= 120` |
| **which buildings a reload puts back** | `globe.js` | `seedPrintedBuildings()` and the GLOBE-SEED-DOC block above it. `PERSIST_TOWNS` (3 live towns), `PERSIST_PER_TOWN` (10 buildings each), `PERSIST_FRESH_H` (24 h — the brief's window) and `PERSIST_SINCE_H` (48 h — how far back a SESSION may have started, which is a different thing and the comment says why). `?persist=0` turns it all off |
| why a seeded building looks flatter than a printed one | `globe.js` | `addLivePrint()`'s `opts.lod` — 1 for a seeded building, 0 for one materialising in front of you. Nine draw calls each is worth it for the one you are watching and not for thirty you are not |
| **reading a materialised building's file, date and agent** | `globe.js` | `printedAt()` (the pick, screen-space like every other pick here) and `showPrintCaption()`. `window.__printed()` lists every one of them with its pixel on the current frame — that is how a harness aims at one |
| **the ground reading as flat colour from a region view** | `globe.js` | `groundMaterial()`'s `uCoarse`, written once a frame in `updateSun()` from the altitude, and the pairs of reads it mixes: ground diffuse and normal at 2.4 m / 46 m, the cliff at 3.6 m / 38 m, forest floor and snow at their own two. `window.__ground()` prints all of them. **The fine read alone mips to a flat average by 300 units up — that was the whole bug** |
| **a wood reading as confetti from 300 to 900 m** | `globe.js` | `bakeImpostorAtlas()` and `impostorMaterial()`, GLOBE-IMPOSTOR-DOC. Eight photographs of each species into one atlas, one billboard that picks the cell by the camera's bearing. `IMPOSTOR_ALT` (300 m) is where the swap happens; `window.__impostors()` says which tier is drawn |
| the size of an impostor tree | `globe.js` | `uSize` in `impostorMaterial()`, NOT the instance matrix — the species height is baked into the near canopy's GEOMETRY and the matrix carries only the per-tree spread. Get this wrong and a forest is a hillside of one-metre dashes |
| **the phone: what the preset changes** | `globe.js` | `MOBILE` at the top (`?mobile=1`, `?mobile=0`, or `pointer: coarse`), `MOBILE_DPR` (1.5) and `MOBILE_SAT` (one neighbour). It sets `quality = 'medium'` and `body.mobile` BEFORE the renderer exists, because the constructor reads both |
| **the five touch gestures** | `globe.js` | the TOUCH block in `bindInput()`, GLOBE-TOUCH-DOC. `TAP_MS` (300), `HOLD_MS` (480), `TAP_PX` (16). `touch-action: none` on `#map` in `globe.css` is what stops the browser taking a pinch for its own page zoom — without it none of this runs |
| how the phone's hints and caption look | `globe.css` | the `body.mobile` block at the bottom. The hints become a bottom sheet (`pointer-events: none`, or it eats every tap in the bottom sixth of the screen) and the caption gets a wash, a `42dvh` ceiling and three list items instead of eleven |
| **the QR code on the phone's front page** | `m.html` | the M-QR-DOC block — a byte-mode QR encoder in the page, no dependency, because a library from a CDN is a code that fails on a network with no internet. The address is `location.host`, and the page SAYS SO when that is `127.0.0.1` rather than printing a code no phone can reach |
| the three links on the phone's front page | `m.html` | the `THE THREE VIEWS` block — one row each, 64 px tall, every one carrying `?mobile=1` |

**Three traps that will cost you an hour each if you meet them cold.**

1. If something on the planet has gone missing, type `window.__nan()` before
   anything else.
2. If you moved a building and want to know whether you broke anything, type
   `window.__overlaps()`. It must come back `pairs: 0`. Nothing on screen tells
   you when two houses are inside each other from most angles.
3. If a flat thing you drew on the ground is invisible, it is almost always one
   of two things: it is lifted less than about 10 cm (the depth buffer cannot
   tell it from the pad at region distance) or its polyline runs the wrong way
   round and it is back-face culled. Both cost a full afternoon in round 3.

The `__nan()` note in full: three's own warning about a NaN says only
"BufferGeometry" and names no object; this returns the object by name.


## Getting around — both pages <!-- NAV-DOC -->

Same navigation on the session city and on the world map. Press `H` at any time
and the page tells you all of it in one line; it also tells you once, for six
seconds, the first time you open it in a browser.

| you do | it does |
|---|---|
| drag | turn the view round what you are looking at |
| scroll | zoom, from the whole map right down to standing on the ground |
| **right-drag** (or middle-drag) | **slide the view sideways.** This is the one that lets you reach a corner — turning alone only ever circles the same spot |
| **`F`** | **free flight.** The camera comes off its leash: `W A S D` to move where you are looking, `Q` down, `E` up, `shift` for four times the speed, mouse to look. It goes faster the higher you are and slows to walking pace at street level, and it will not sink through the ground. `F` again glides you back to where you were |
| **`F` on the planet** | the globe has it too since 2026-09-06, and there it is SURFACE-RELATIVE: `W A S D` walk the ground under you rather than the direction the lens points, `Q` and `E` are your height above that ground (2 m to 400 m), and up is always the local up — so there is no way to end up in space looking at nothing. `F` again eases you back onto the orbit where you left it |
| **double-click anything** | **go inside it** |
| `Esc` | come back out |
| `H` | the help line again |

### The gold "play" button — the wallpaper, full screen, with a keyboard <!-- PLAY-EDIT-DOC -->

Since 2026-09-07 the desktop wallpaper has a fourth button, **play**, in gold.

The wallpaper is behind your icons and Windows never gives it the keyboard — so
`play` does not try. It opens a **second window**: the same planet, the same
place you were looking at, full screen over the desktop, as a normal browser.
There the keyboard works completely — walk with `W A S D`, `F` to fly, `/` to
search, everything.

**To get out again:** press **Esc**, or click **back to desktop** (the same
button, in the same corner, renamed). The window closes and your desktop is
exactly as you left it — the planet behind it was never touched.

Esc unwinds one step at a time, the same as it always did: it closes the search,
then the caption, then walks you out of a building, then back up to the planet,
and only when there is nothing left to leave does it close the window. So from
deep inside a city it takes a few presses, and that is on purpose.

**If the window ever gets stuck**, open a terminal and run:

```bash
curl -X POST http://127.0.0.1:4949/api/play/stop
```

Never close it by killing "Microsoft Edge" from Task Manager — that would close
every other Edge window you have open too. `docs/RUNBOOK.md` ("Play mode") has
the safe way to find just this one.

**To take the button away** without breaking anything, delete this one line from
`globe.html`, `world.html` and `index.html`:

```html
<button id="ctl-play" type="button" hidden>play</button>
```

Everything else keeps working; the page simply stops offering it.

### The three buttons in the bottom-right corner <!-- CONTROLS-EDIT-DOC -->

Since 2026-09-07 every page also has **enter**, **back** and **search** as
buttons, so the whole world can be walked with a mouse and nothing else. They do
exactly what `Enter`, `Esc` and `/` do — the keys all still work, unchanged.

They are there because the planet can be run as the desktop wallpaper
(`globe.html?wallpaper=1`), and a wallpaper gets the mouse but **not the
keyboard**.

- **enter** is grey until you click a place; then it says what it will enter
  (`enter my-project`).
- **back** is not shown when there is nothing to leave — on the globe, which is
  the top of the world, it only appears once a caption or the search is open.
- **search** opens the same address bar `/` opens, and under the text field
  there are clickable lists of real projects, dates and notes — clicking one is
  the same as typing it. On the session city there is no search bar, so there is
  no search button.

**To move them, change ONE rule** at the top of `controls.css`:

```css
#controls { position: fixed; right: 26px; bottom: 26px; ... }
```

Bottom-right is deliberate: the caption, the studio seal and the free-fly line
all live on the left and along the bottom centre, and the buttons must never
cover the caption. Two other places set the same corner and both have a reason
written next to them — `body.wallpaper #controls { bottom: 82px }` clears the
Windows taskbar (Lively paints the wallpaper *behind* it), and the
`max-width: 720px` block keeps the row on one line on a phone.

**To hide them completely**, add this to the page's own stylesheet
(`globe.css`, `world.css` or `styles.css`) — do not delete anything:

```css
#controls { display: none !important; }
```

On the wallpaper you need the more specific one, because `body.wallpaper` turns
them back on by design:

```css
body.wallpaper #controls { display: none !important; }
```

**To change what a button does**, do not edit `controls.js` — it owns no page's
meaning. Edit `bindControls()` in `globe.js`, `bindControls()` in `world.js`, or
`attachControls()` in `city.js`. Each is about thirty lines and says in one
place what enter, exit and search mean on that page.

### On a phone — the world map <!-- TOUCH-DOC -->

Since 2026-09-06 `world.html` works with a finger. Nothing about the desktop
controls changed; this is the same five things done a different way. The page
notices the phone on its own (`pointer: coarse`), and `?mobile=1` forces it if
you want to see it on a laptop — `?mobile=0` refuses it.

| you do | it does |
|---|---|
| **drag with one finger** | turn the view, same as a mouse drag |
| **pinch** | zoom, the whole island down to standing on the quay |
| **twist two fingers** | turn the view — the pan is the wrong reflex on a map you orbit |
| **tap** | pick the thing you touched and open its caption |
| **double tap** | go inside it |
| **press and hold** | "what is this" — opens the caption WITHOUT arming the second tap, because a finger cannot hover |

The phone also gets a lighter version of the world: medium quality (shadows off,
half the crowd, fewer full-detail buildings), and the six-second hint line
becomes a sheet along the bottom edge with the gestures on it instead of a row
of keyboard keys it does not have. The frame is still rendered at the same
resolution a laptop gets — the page has always capped itself at 1.5x whatever
the screen claims, so a 3x phone was never asked for 3x.

Nothing on either page is a dead end. A landmark opens its own hall; a house, a
bridge, a lighthouse or a sleeping project opens a plain room with that thing's
own caption on the board inside, and for a vault note `O` opens it in Obsidian.
A project that is running right now still takes you down into its session city.

**Why a vault room does not show you the note's text:** there is no endpoint that
hands it over. `/api/vault` reports which notes changed and
`/api/vault/search` returns one matching line. The room shows what it can prove —
the title, the word count, how many notes link to it, when it was written — and
the `obsidian://` door for the rest. It never invents a wall of prose.


## Going inside a LANDMARK on the world map <!-- WORLD-INTERIOR-DOC -->

A town that the server recognised a trade for is not a quarter of houses, it is
built as its trade — a concert hall, a factory, a glass office — and since
2026-09-06 you can walk into it. Double-click it, or click once to read the
caption and click again (or press `Enter`). The camera flies to its door and you
are standing inside. `Esc`, or walking back out of the door, puts you on the
world exactly where you left it.

The controls are the session city's, because it is the same walker: `W A S D`
glides in whatever direction you are looking, `space` and `shift` go straight up
and down, and dragging the mouse looks around. There is no gravity.

**Every building has the same three parts**, so you can find your way around one
you have never been in:

- **the hall** you land in — 20 by 34 metres, with tall windows down its east
  side and the trade's own end at the far wall: a stage and rows of seats in a
  music school, a counter and a kitchen pass in a restaurant, a flywheel turning
  in the yard beyond the window in a factory, a reception desk and glass
  partitions in the studio's own office;
- **the aisle** — three arches in the hall's west wall open into a corridor that
  runs the length of the building;
- **the stations** off that corridor — **one per page of the project's own
  site**. A music school walls them in as practice rooms with a door and a name
  plate each; every other trade leaves them open as bays.

**Everything in there is a fact from the two payloads the map is already built
from.** A station's plate is that page's own `<title>`. Its screen shows that
page — the real one, rendered by the browser — as soon as you walk up to it, and
falls back to the title on a dark screen when you walk away, because one live
page on screen costs about ten frames a second and twenty-four would cost the
lot. A practice room's instrument is chosen from the page's own title (a page
about *Klavier* gets a grand piano, *Schlagzeug* a drum kit, and everything else
a music stand). The board by the door is the project's open items, word for
word. The plate on the entrance wall is the project's own logo if it publishes
one and says so if it does not. The gold craft hovering in the room is a live
agent wearing its own task tag, and it hovers over the station whose page its
last file path names — and notes rise in a music room, sparks in a factory and
steam in a kitchen while it is working there.

If the server is not running there are no landmarks at all, so there is nothing
to walk into — the land still draws, the harbour does not.


## Going inside a NOTE, a bridge, a lighthouse or a page wing <!-- INTERIOR-GAPS-DOC -->

Since 2026-09-06 **everything on the world map has an inside**, not only the
trade landmarks. Double-click it, or click once to read the caption and click
again. `Esc` puts you back on the world exactly where you left it, and `O` opens
the note you are standing in in Obsidian.

**A house, a temple, a ruin, a terrace tower, a quarry block or a fortress wall
opens the note itself.** It is a gallery about the width of a corridor, as long
as the note needs: the note's own markdown printed on plates down the two side
walls in reading order, a page number on each, headings set larger and every
`[[wikilink]]` in gold. The title is in serif over the door and the vault's own
numbers — words, how many notes link here, when it was written — are on a plaque at
the far end. **Save that note in Obsidian while you are standing in it and the
walls re-read it and flash warm.**

If the walls carry a plaque with the caption on it instead of the note, the
server does not have `GET /api/vault/note` — that is the older behaviour and it is
not a fault in the page.

**A bridge puts you ON it.** You are on the deck with the river underneath, the
day's own plaque at each end and that day's note on a reading stand in the
middle; the neighbouring days are the arches carrying on upstream and
downstream, because they are the same viaduct. The world is still being drawn
around you — this is not a room.

**A lighthouse is climbed.** You come in at the door at the bottom of a stair
that winds four turns round the central shaft. **Hold `W` and it climbs** —
the stair carries your view round with it, so one key is the whole climb; `A`
and `D` cross the steps if you want to. At the top is the lamp room: the idea
note on a lectern, the lamp turning over it, and the sea and the harbour out
past the gallery rail. About fifteen seconds of `W` from the door to the lamp.

**A page wing has a small inside now** — one room, with that page of the site on
the wall, the real page rendered by the browser. It is the same page window a
landmark's stations carry.

## Going inside a building in the session city <!-- INTERIOR-DOC -->

Hover a building and it gets a thin gold outline and its path under the cursor.
Click it once to arm it, click again (or press `Enter`) and the camera flies to
the door, the front wall comes apart and you are standing inside.

Inside, `W A S D` glides you in whatever direction you are looking — there is no
gravity and nothing falls, this is a monument and not a shooter — `space` and
`shift` go straight up and down, and dragging the mouse looks around. The gold
column of light is the lift: glide into it and you come out on the floor above.
`Esc`, or walking out of the door, puts you back in the city exactly where you
left it.

**Everything in the room is the file.** The number of floors is the number of
times that file was edited. The walls carry the file's own text — 22 lines a
wall, three walls a floor, and the ground floor is the top of the file. A wall
written in warm ink is a floor whose edit happened in the last half hour of the
session; a wall that pulses red is a file being edited *right now*, and the
small drone hovering in the room with it is that tool call.

**And the room is furnished with the same facts.** Four desks stand down the
right-hand side; a desk's screen lights up, wearing that call's own tag, for
every tool call in flight against this file, and stays dark when nothing is
running. Three plates by the door name the last three events that landed here —
the tool, the agent that ran it, and how long ago on the session's own clock.
A lamp hangs under every floor's ceiling, the number of the floor you are on is
on a plate beside the lift, and the opening in the front wall is a real window:
the dusk outside it is the session's own hour.

**An `.html` or `.php` file's ground floor also has a window onto the page those
bytes make** — a real one. It is the actual file loaded in a locked-down frame,
so the browser lays it out with the page's own stylesheets and draws its own
images. No script in it runs and the page is held still. It disappears when you
climb to another floor or turn away from it, because a live page laid over the
room costs about ten frames a second and is only worth that while somebody is
looking at it.

Two other things can be walked into: a folder's caption on the ground opens a
lobby with one door per file in it, and a street sign opens that conversation's
hall of records — its title on the wall, its prompts as plaques in the order
they were typed, and the agents it dispatched parked along the aisle.

If the little server is not running, the walls show `data/sample-file.txt`
instead of the real file and the plaque beside the door says `FIXTURE`. Nothing
in here ever shows text without saying where it came from.


## The one rule the code keeps

**Nothing on screen is invented.** Every building, spark, drone and number comes
from an event that actually happened in the session file. If you add something
decorative — traffic, a skyline on the horizon, a number that estimates rather
than counts — you have broken the only promise this page makes.

## What not to touch

- **The `WDM-SEAL` blocks in `index.html`, `world.html` and `vault.html`.** That
  is the studio signature. It is generated — edit it and the next run of the seal
  tool will fight you.
- **`ingest()` in `replay.js`.** Everything that puts something on screen goes
  through that one function. Change its shape and the live server and the replay
  files both stop working.
- **The packer in `city.js`** (`placeIn`, `addChild`, `growthFits`, `annexOf`).
  It is written so that a building which already stands can never move. That is
  fiddly and it is deliberate: a city that reshuffles while you watch it is
  unreadable. If you change it, watch a full replay before believing it works.
- **The `if (!kit)` branches in `makeDrone()` and `makeWorker()` (`city.js`).**
  That is the disc path, and it is the only thing standing between a missing
  `ornis.glb` and a city with nothing in the air. It is not dead code; it is
  reached by `?drones=discs` and by any failed fetch of the model.
- **The field names in `data/*.json`.** They come from the exporter. Renaming one
  here does not rename it there.
- **The `id` on a `tool` event and the `tool_end` that shares it.** That pair is
  the only thing that knows how long a call actually ran, and therefore the only
  reason a busy agent shows eight drones instead of one. Drop either half and
  the workers either never appear or never come home.
- **The `tool_end` skip in `advance()` (`replay.js`).** A `tool_end` is not
  allowed to decide when the clock may jump a gap. Counting them made four
  minutes of watching reach 23:50 of session instead of 31:51, and every
  reference shot came out a third smaller. It looks like a special case and it
  is one, deliberately.

- **`life.js`, `drones.js` and `buildings.js` are libraries, not part of this
  page.** They are imported and called; they are never edited from `globe.js`.
  If one of them is wrong, it gets fixed there and this page's workaround gets
  DELETED afterwards — which is what happened to `roofScale()` and the tower's
  forced hip roof in round 4.
- **`?life=0&drones=0` and `?drones=cones` are not debug toggles.** The first is
  the control row of the frame-rate table in `docs/RUNBOOK.md` and the second is
  the path a failed fetch of `assets/drones/ornis.glb` takes, so both branches
  are reachable code and both have to keep working.
- **`clearGraph()` reaches into `life.js`'s own five arrays.** That is
  deliberate and it is documented where it is written. Do not add a sixth reach
  without re-seating whatever references it — the failure mode is a crowd
  walking towards node indices from a village that is not there any more.
- **`GRAVEL_ROUGH` stays even though the manifest key is fixed.** Nothing in
  this repo READS `roughnessChannel`; three.js reads the green channel of a
  roughness map and only the green channel. The manifest now documents the file
  correctly and the constant is still what makes a gravel road the right
  roughness.

## How to run it

You cannot double-click `index.html` — the browser blocks a page from reading a
local `.json` file, and it will not load an ES module from disk either. Serve the
folder instead:

```
cd werkstadt
python server.py
```

Then open <http://127.0.0.1:4949/> for the session city, or
<http://127.0.0.1:4949/world.html> for the World. `python -m http.server 4949`
serves the same folder, but the World's harbour and every `/api/*` route need
`server.py`.

The host, the port and everything else machine-specific live in `config.json`,
which `server.py` writes from `config.example.json` the first time it starts.
The defaults are `127.0.0.1:4949`; the example file documents every key.

## How to undo

Nothing here writes to disk and nothing is stored on a server. The only thing the
page remembers is whether you have already seen the keyboard hints, kept in your
own browser. To see them again, open the browser console and run:

```js
localStorage.removeItem('werkstadt.hints-seen')
```

The version before this one — a 2D radial tree — is still in `archive/tree/` and
still runs, at <http://127.0.0.1:4949/archive/tree/>. If a change here goes badly
wrong, that folder is a working page to compare against.

## The vault city <!-- VAULT-CITY-DOC -->

There isn't one any more. `vault.html` is a redirect to
`world.html?focus=vault`, because the vault is now the **land** of the World —
Knowledge is the mountain, Dev Logs the valley, Daily the river. Everything you
used to change in `vault.js` you now change in `biomes.js`; see *The World*
above.

The old renderer is still on disk at `archive/vault-city.js`, unloaded. Nothing
imports it. It is kept for the same reason `archive/tree/` is kept: it worked,
and its comments explain choices that still apply.

The vault is **optional and off by default**: `config.json`'s `"vault"` ships
empty, and with it empty there is simply no knowledge continent and no notes —
the island and the planet run unchanged. Point it at a vault to switch the layer
on.

`server.py` regenerates `data/vault.json` by itself while it runs (on startup if
the file is missing or stale, and 30 s after the last change it sees). To do it
by hand, the standalone script needs the path — it has no default:
`python tools/export_vault.py --vault "/path/to/your/vault"`. It only ever reads
the vault.

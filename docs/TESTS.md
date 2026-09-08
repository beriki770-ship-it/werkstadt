# Tests — what has been verified, and how you re-run it

_Verified: 2026-09-08_

There is no test runner in this repo. Verification is a **CDP harness**: a
throwaway headless Chrome driven over the DevTools protocol, which loads each
page, waits for it to settle, reads the page's own debug probes, counts console
errors and takes a screenshot. Everything below is either a check that exists
and can be re-run, or a result that is still true of this code.

Two things this file is not. It is not a claim that the numbers here will
reproduce on your machine — every frame rate and every cold timing was measured
on one Windows laptop, with a software GL renderer, and usually with dozens of
other browser processes alive; read them as floors and as *relative* A/B
comparisons, never as a spec. And it is not a full record: the fork left the
private working history behind, and a few sections below say plainly that a
check has not been re-run against this tree.

---

## 1. The harness

**Server.** One `python server.py`. Confirm exactly one listener on the port
before and after a run — a second stale server is the most common way a run
measures the wrong build.

**Browser.** A dedicated Chrome on its own debug port and its own profile, never
the one you are using:

```
chrome.exe --headless=new --remote-debugging-port=9401 ^
  --user-data-dir=%TEMP%\werkstadt-cdp-9401 ^
  --disable-features=CalculateNativeWinOcclusion ^
  --enable-unsafe-swiftshader
```

- `CalculateNativeWinOcclusion` off: an occluded window freezes
  `requestAnimationFrame`, and a frozen page reads as a broken one.
- `--enable-unsafe-swiftshader`: the software renderer. It is why the frame
  rates here are low and why the 16-vertex-attribute ceiling matters — the
  facade program does not link past 16 attributes on it.
- Viewport via `Emulation.setDeviceMetricsOverride`, 1440×900 for desktop rows,
  390×844 for the mobile rows.

**Console errors** are collected from `Runtime.exceptionThrown`,
`Log.entryAdded` at level `error`, and `Runtime.consoleAPICalled` type `error`.
Clear the collector and send `Log.clear` **immediately before** each
`Page.navigate`, or the previous page's buffer is replayed into the new page's
count. Entries whose text is a sandbox "Blocked script execution" notice, or
whose URL is under `/api/project/tree|file|asset`, are counted separately as
sandbox notices — those routes are served with a restrictive CSP on purpose and
their notices are not the page's fault.

**Frame rate** is `window.__fps()` after at least a 12-second settle. State the
machine's load with any number you record; the same build at the same pose has
been measured 22 fps apart on the same laptop purely on how many other browser
processes were alive.

**Screenshots** go to `docs/shots/`. Eight reference frames survive in this
fork: `city-print.png`, `fix-city-crew-hivis.png`, `globe-continent.png`,
`interior-html.png`, `recordings-shelf.png`, `traffic-accident.png`,
`wallpaper-desktop.png`, `world-harbour.png`.

**The probes.** Every page exposes read-only debug functions on `window`. They
are the evidence, not the screenshot — a shot that is wrong in a way that still
looks like a rendered scene is the one an eye-check passes. The ones a
verification run actually uses:

| probe | on | reports |
|---|---|---|
| `__fps()` | all 3D pages | frames per second |
| `__nan()` | globe, island, city | any non-finite value that reached a transform; `[]` is the pass |
| `__selfcheck()` | city | `{attrs, sphereRadius, streets}` — `attrs` must be 16 |
| `__frame()` | city | how much of the frame the town fills, in per cent |
| `__streets()` | city | street count and the current street's title |
| `__nodes()` / `__printed()` | city | buildings standing / print state |
| `__interior()` | city, island | `{phase, mode, floors, minGlyphPx}` — also proves you are *outside* |
| `__settlements()` / `__landmarks()` | globe | settlement and landmark counts |
| `__overlapsBuildings()` | globe | landmark/building footprint collisions; `pairs: 0` is the pass |
| `__treeSpecies()` / `__props()` | globe, island | per-species tree counts, prop pool slots vs placed |
| `__signPixels()` / `__signs()` | island | cap height in pixels of every visible place name |
| `__drones()` | city, island | craft in the air |
| `__life()` | all hosts | the living layer's own counts, regimes and stage |
| `__counts()` / `__penetrations()` | `life.html` | crowd overlaps per second, bodies inside solids |
| `__overlaps()`, `__headingErr()`, `__pedOnRoad()`, `__carsInZone()` | `life.html` | traffic and pavement gates; all should read empty/zero |
| `__accident()` / `__accidentState()` | `life.html` | stage an error deterministically and watch it resolve |
| `__controls()` | showcases | camera mode, rotate, night, distance — the state a legend button was meant to change |
| `__resetProbes()` | `life.html` | zero the rate counters before a measured window |

---

## 2. How to re-run a full pass

1. Start the server. Check there is exactly one listener on the port.
2. Start the dedicated Chrome above.
3. **API rows** (section 3) — plain HTTP, no browser needed.
4. **Page rows** (sections 4-7) — for each: `Log.clear`, clear the collector,
   `Page.navigate`, poll the page's own "ready" probe rather than sleeping a
   fixed time, settle ≥12 s, read the probes, `Page.captureScreenshot`.
5. Record the machine's load with every timing and frame rate.
6. Anything you did not run in this pass is **FAIL**, not "PASS from last time".

---

## 3. API acceptance

Run against a server that has been up long enough for its boot prewarm to
finish. All of these are plain GETs.

| check | expected |
|---|---|
| `/api/sessions` | 200, each item carries `town` and `root` |
| `/api/world` | 200, a town per project, some with `is_live` |
| `/api/world` cold vs warm | cold under a second, warm well under 100 ms |
| `/api/world` trade stability | poll 5× — the set of `(id, trade)` pairs must be **identical every time**. Flapping here means the trade cache is not doing its job |
| `/api/project?id=<town>` | 200, `partial: false`, carries `streets`, `root`, `town`. Warm reads are tens of ms; a **cold** read on the largest project is seconds and that is expected |
| `/api/project/meta?id=<town>` | trade type, source and confidence; page count |
| `/api/project/tree/<id>/index.html` | 200 `text/html` **with** a `Content-Security-Policy` header including `sandbox` and `script-src 'none'` |
| `/api/project/tree/<id>/../server.py` | **403** — path traversal must be refused |
| `/api/stream?project=<town>` | `: connected` within ~30 ms; the history burst follows from the shared cache |
| `/api/world/stream` | first `data:` within a second |
| `/api/vault` | a `: keepalive` or an event within 20 s (only meaningful when a vault is configured) |
| `/api/recordings` | JSON list; each film has `mp4`, `poster` and `replay_url` |
| nothing is uploaded | `grep -niE "upload|sftp|ftp|requests\.post|urlopen\(.?http" server.py` → **zero hits** |

**The core rule, end to end.** Run one real `claude -p` in a project directory
and watch the world change. Snapshot `/api/project?id=<town>` before and after:
a new session must appear as **one new street**, titled by the prompt, in the
**same** town. A second run in the same directory adds a second street and
creates **no** new town. A `--continue`d session grows its existing street and
adds none. A run in a brand-new directory adds exactly one town, named after the
directory. All four have been verified this way; they are the only checks that
prove the data path rather than the renderer.

**A load-testing trap worth knowing.** The server speaks HTTP/1.0, so every
request is its own socket. Hammering it unthrottled on Windows exhausts the
ephemeral port range and returns `[WinError 10048]` — a *client* failure that
reads exactly like a server fault. Throttle to roughly 100 req/s.

---

## 4. The project city — `index.html`

| check | expected |
|---|---|
| replay a fixture or a project | 0 console errors after ~90 s |
| `__selfcheck().attrs` | **exactly 16**. More and the facade shader will not link on a software renderer |
| `__nan()` | `[]` |
| `__frame()` | the town fills **80-88 %** of the frame width, sampled across a whole orbit, not once. A single sample can be in band while the intro swing is out of it |
| `?live=1` | resolves to a real project city; the title is not empty; `__streets().count ≥ 1` |
| time to first building | the target is a few seconds on a warm cache. This was **17 s** before `Life.load()` learned to yield and is now around **1 s**; if it regresses, profile before optimising — the city's own construction was never the cost (198 street openings total ~176 ms) |
| enter a building | HUD reads `<file> — floor 1 of N`; `__interior().minGlyphPx ≥ 14`; a real `Escape` returns `{phase: "out"}` |
| the crew | `__life()` shows `regime: "crew"` on a street being worked on and `regime: "settled"` on finished ones; the vests are legible against the dusk street (`docs/shots/fix-city-crew-hivis.png`) |
| `JSON.stringify(window.__life())` | must not throw. It used to hit a circular structure through `kids[].parent` |

---

## 5. The island — `world.html`

| check | expected |
|---|---|
| counts | structures, trees, roads, towns, bridges, landmarks all non-zero and stable across reloads |
| `__signPixels()` at the default view | `minCapPx ≥ 18` and at least a handful visible, at t=0 and again 30 s into the orbit. Zero visible signs is the regression this row exists for |
| `__signs().minCapPx` | ≥ the sign cap target, with margin. Reading exactly the gate is not a pass |
| enter a landmark | the interior resolves with the right `form` and a real station count; leaving returns to the outside |
| `?screensaver=1` | hints hidden, quality toast hidden, the auto-orbit measurably slower than the default |
| `vault.html` | redirects to `world.html?focus=vault` |
| address search | `/` opens it; a date and a note name each fly the camera and name the hit in the caption |
| search **before** the world has built | no uncaught exceptions; the field says the world is still loading, Enter is a no-op, and the query is banked and runs when the plan lands |
| close-ups | **read `__interior()` alongside every close-up screenshot.** Flying close on the island can land the camera inside a structure, where the interior walker renders a convincing and completely wrong frame |
| prop pools | at a wide framing every pool reads `placed: 0` — that is the design (the prop shell is ~115 m). Fly to a prop before judging it |

---

## 6. The planet — `globe.html`

| check | expected |
|---|---|
| time to planet | `__settlements()` non-null within a few seconds warm. A cold load right after a server restart is much slower and that is a known, reported number, not a pass |
| `__overlapsBuildings()` | `pairs: 0` across all settlements. This is the gate on the landmark-footprint reservation |
| `__landmarks().total` | identical across three reloads. A drifting count means the trade cache is being rebuilt per request |
| `__treeSpecies()` | per-species counts, an 8-view impostor atlas present, the near tier drawing |
| landmark models | the scanned buildings load with **0 console errors**; a town's `form` matches its detected trade |
| assets | `Cache-Control: public, max-age=86400` on a model request |
| `__life()` on a surface town | props, animals and people all non-zero. Dogs are `round(humans / 12)` and need a shop on the pavement graph, so a 3-person town correctly has none |
| `__nan()` | `[]` |

---

## 7. Showcases, recordings and the desktop layer

**`life.html`** — the living layer's own gates. Call `__resetProbes()`, then run
a measured window of ≥1,000 frames:

| probe | pass |
|---|---|
| `__penetrations()` | `rate 0, peak 0, worst 0` — nobody inside a hedge, a car or a railing. This is the gate that has to read zero |
| `__counts().overlap.perSecond` | ≤ 1/s at 300 people (`?stress=1`). It is a *rate*, on the positions the frame actually drew |
| `__overlaps()`, `__pedOnRoad()` | `[]` |
| `__headingErr()` | `{worst: 0, bad: [], wraps: 0}` |
| `__carsInZone()` | `[]` — no vehicle inside a pedestrian plaza |
| vehicle classes | buses only on the two-lane road, tractors only on the field road |
| `__accident('tool_end:is_error')` | stages deterministically even with `?robots=0`: a person is thrown, the car goes askew, an ambulance arrives. `docs/shots/traffic-accident.png` |

**`buildings.html` / `drones.html` / `life.html` legend chips** — click each chip
with a real mouse event and read `__controls()` before and after. Every chip
must change the state it names; a chip clicked into the mode it already shows is
the only legitimate no-op.

**`recordings.html`** — the shelf loads with real posters (check `naturalWidth`,
not just that an `<img>` exists), the inline video plays and seeks, and the
replay link opens **exactly one** street. `docs/shots/recordings-shelf.png`.

**Launcher (Windows).** These are file and OS checks, not browser ones: the two
scheduled tasks exist and are Ready, the Desktop shortcut exists, `open.ps1`
exists, and the screensaver script's kiosk URL points at
`world.html?screensaver=1`. **Not re-verified against this fork** — the install
paths changed with the rename and nobody has run `install.ps1` from a clean
clone since.

**The seal.** `grep -c WDM-SEAL <page>.html` returns 4 on every page that has
it, and `humans.txt` is present at the root. All nine HTML files carry the seal
and the JSON-LD creator block; the four main views additionally carry the
credits footer and the console signature.

---

## 8. Results that are still true of this code

These were measured and the code that produced them has not changed since.
Treat the absolute numbers as one machine's; treat the *comparisons* as the
finding.

- **`Life.load()` yielding.** Time to streets on screen, same page, same
  machine: **8,974 ms before → 962 ms after**. The control is `?life=0` at
  703-1,324 ms, which says the crowd was the whole cost. A CPU profile put
  `Life.load()` at 8,785 ms of it and the city's own construction at 176 ms.
- **Hi-vis as an emissive.** Before, the crew photographed as black silhouettes
  at four bearings and four distances in the dusk city. After, five crew read as
  orange and yellow against a near-black street, with the same worker's skin and
  trousers still dark — the emissive is on two garment classes, not the body.
  Non-workers gained nothing. Paired A/B frame rate: unchanged.
- **Trade detection is deterministic.** Ten identical `/api/world` polls over
  three minutes returned the same trade count and the same `(id, trade)` set
  every time; warm latency 7-45 ms. Before the persistent on-disk cache the same
  poll returned anywhere from 1 to 45 towns with a trade, on identical code,
  depending on which towns fitted inside a per-request time budget.
- **Trade-cache concurrency.** 4,739 responses under 8 concurrent loops for 60 s
  starting during the boot prewarm: **0 non-200**, no `PermissionError` in the
  log, no orphaned `.tmp` files.
- **Two new keyword rows, diffed rather than assumed.** Trade detection was run
  over every town twice, before and after adding a lodging group and a civic
  group, and diffed: exactly the two genuinely-lodging projects changed, every
  other town byte-identical, and zero towns picked up the civic type because no
  civic project existed. That diff is the method to copy when you edit
  `config/trades.json`.
- **Landmark footprint reservation.** Reserving a landmark's measured ground
  before lots are handed out, plus a relocation ladder for specials that used to
  get exactly one placement attempt, took the whole planet from **804 lots with
  105 dropped to 842 with 67** — better, not merely no worse — with
  `__overlapsBuildings().pairs` at 0.
- **The crowd's separation gate is geometry, not solver cost.** At 300 people on
  the showcase's own pavement width the constraint loop cannot converge, because
  the density exceeds what the personal-space radius allows. Widening the
  pavement for the stress scene took overlaps from 11-95/s to **0.000/s** and
  restored the frame rate; making the solver cheaper closes neither. The number
  to remember is roughly **one person per 0.7 m²**.
- **The impostor conifer.** Baking the far tier off the scanned model rather
  than off the near card removed six trunk instanced meshes (12 → 6) with the
  forest's triangle count unchanged.
- **Machine load dominates frame rate.** Same build, same window, same pose:
  median **24 fps with 30 other browser processes alive, 46 with 16**, and the
  full build in the same minute also hit the vsync cap. A one-component-at-a-time
  bisect could not attribute the difference to anything in the code — two rows
  came back *slower* with a component removed. Do not pull a visual lever on a
  reading taken on a busy machine.

---

## 9. Known limits — still true

1. **A cold first load is slow.** The first `/api/project` for the largest
   project after a restart is seconds, and the first globe load after a restart
   misses the warm target. Warm, both are fine. Nothing caches across a reboot
   except the trade cache, which does persist to disk deliberately.
2. **The far crowd tier cannot be photographed.** A distant human is a ~4 px
   sprite; horizontally it is against a wall of lit windows and from above a
   billboard is edge-on. The evidence for that tier is the code path and the
   bake row, not a picture, and it is recorded as such rather than as a pass.
3. **A knocked-down pedestrian stands back up past the near band.** Only the
   near tier has a per-actor rotation to give.
4. **A district plate's own name is not in the caption-culling pass**, and a
   place name on the island can still be overlapped by a caption that is not a
   sign.
5. **Frame rates on this hardware are software-renderer numbers.** They are
   useful as A/B comparisons within one run and useless as a spec.
6. **`server.py` fails a comment-density audit that reads it as one silent
   stretch.** The file really carries ~530 comment lines and 20 section banners;
   this is an auditor artifact on large Python files, not the file.

---

## 10. Not verified against this fork

Honest gaps, listed so nobody reads silence as a pass.

- ~~**Nothing in this tree has been run since `assets/hunyuan/` was
  excluded.**~~ Closed by phase B — see section 11 below. What is still NOT
  re-run against this tree: the per-section numbers in sections 5 and 7 predate
  the CC0 set and the models they measured are gone, so read them as the private
  install's numbers, not this one's.
- **`data/` ships empty.** The fixtures the replay path falls back to
  (`data/demo.json`, `data/sample.json`, `data/sample-project.json`) are absent,
  and so is `data/sample-file.txt`, which `interior.js` fetches to dress a wall
  when the server is not running. Every `?src=` row above therefore needs a
  fixture you export yourself (`tools/export_replay.py`) or a live project.
- **`redact` is a no-op**, so there is nothing to test for it yet.
- **The launcher chain** — install, scheduled tasks, screensaver, wallpaper,
  `POST /api/play` — has not been run from a clean clone under the new name.
- **Never tested at all, in any pass:** phone access over a VPN, HTTP Basic
  Auth, and `?mobile=1` at 390 px on real hardware rather than an emulated
  viewport.

---

## 11. Phase B — the CC0 asset set (2026-09-08)

Run with the harness in section 1: one `python server.py --port 4951 --redact`,
one throwaway headless Chrome at 1440x900 over CDP, each page given 20-30 s to
settle before anything is read.

**Every page, zero errors, zero 404s.** The check is
`performance.getEntriesByType('resource')` filtered on `responseStatus >= 400`,
uncapped, plus a `window.onerror` / `unhandledrejection` / `console.error`
collector installed right after navigation.

| page | resources | 4xx/5xx | console errors | probes |
|---|---|---|---|---|
| `index.html?project=<id>` | 57 | 0 | 0 | `__selfcheck` 720 buildings / 5 streets, `__nan` null, `__life` 41 actors, 9 vehicles, 32 props |
| `globe.html` | 131 | 0 | 0 | `__nan` `[]`, life counts 2 humans / 1 car / 8 sheep / 18 props |
| `world.html` | 191 | 0 | 0 | life counts 129 humans / 45 cars / 13 cows / 11 sheep / 11 dogs / 40 props |
| `recordings.html` | 7 | 0 | 0 | `__nan` null |
| `life.html` (`__street`) | 77 | 0 | 0 | 60 fps, 442 calls, 1.49 M tris |
| `life.html` (`__herd`) | 79 | 0 | 0 | 60 fps, 306 calls, 1.86 M tris |

The one warning every page prints, and it is the intended output rather than a
fault: `life.js: 4 of 30 models were not loaded and are skipped ... Skipped:
model.hy.parrot (no manifest row), model.hy.chicken, model.hy.busstop,
model.hy.playground`. Those four have no CC0 equivalent (CREDITS.md).

**Degrading with no assets at all.** `Life.load()` was read against an empty
`assets/`: the manifest fetch is wrapped, a failure warns and continues with an
empty manifest, every model is then skipped, `_deckFor()` returns an empty deck,
`populate()` gives each lane zero capacity, and no draw pass dereferences a
model it does not have. `server.py` prints the two fetch commands at startup
when the library is not unpacked (both branches of `_assets_unpacked()` proven
against `assets/` and against a directory with no manifest).

**Frame rate, paired A/B against the private install.** Both servers alive at
once, same Chrome, `life.html?stress=1`, alternating order across runs to cancel
warm-up. Read these as an A/B, never as a spec (see the note at the top).

| scene | run | private install (4949) | this tree (4951) |
|---|---|---|---|
| street | 1 | 41.5 fps | 31.4 fps |
| street | 2 | 55.7 fps | 34.0 fps |
| street | 3 | 51.9 fps | 38.3 fps |
| street | 4 | 50.0 fps | 31.2 fps |
| herd | 1 | 39.1 fps | 41.9 fps |

**One caveat on the A/B, stated rather than buried.** The private install on
4949 is somebody's live working tree, and its `life.js` and `city.js` were being
edited by another session while these pairs were measured. The per-run fps on
the 4949 side is therefore not a fixed reference. The population figures below
are, though: they come out of both trees' own probes in the same minute and they
do not depend on either side holding still.

**The street gap is population, not geometry, and the probe says so.** At the
same requested `cars: 80` the two trees place different numbers of them:

| | private install | this tree |
|---|---|---|
| cars placed | 54 | 76 |
| `carsDropped` | 26 | 4 |
| triangles | 3.47 M | 1.90 M |
| draw calls | 454 | 450 |

`populate()` sizes a lane's capacity as `lane.length / (longest vehicle +
CAR_CLEAR)`, and a Kenney sedan is 2.84 m against the old 4.5 m. Same road, 41%
more traffic, and the frame rate follows the traffic. Nothing here is evidence
that the CC0 models are slower to draw — they are half the triangles at the
same draw-call count.

**Screenshots** (all from the redacted server): `docs/shots/cc0-street.png`
(traffic and pavement props), `docs/shots/cc0-pasture.png` (the still herd, a
cow at four metres), `docs/shots/cc0-city-crew.png` (the city at street level).
The city one is the weakest of the three and honestly so: the city draws the
living layer at `LIFE_SCALE 0.23` and it is a night scene, so a crew member is a
few pixels. The street and pasture frames are where the CC0 set can be judged.

---

## 12. Phase D — vehicle scale, the squashed history, a clean clone (2026-09-08)

Everything in this section was run on 2026-09-08 against the tree as it stands.
The pages were driven by the CDP harness of section 1 at 1440x900 on port 4953.

### 12.1 Vehicle scale

`life.html?stress=1`, measured through `window.__life()` and `__counts()`.

| check | expected | measured | result |
|---|---|---|---|
| car length | ~4.3 m | 4.30 m (1.67 wide, 1.45 tall) | PASS |
| van length | ~5.2 m | 5.20 m (2.22 wide, 2.00 tall) | PASS |
| pickup length | ~5.3 m | 5.30 m (2.08 wide, 1.80 tall) | PASS |
| box lorry (`bus`) length | ~9 m | 9.00 m (2.77 wide, 2.40 tall) | PASS |
| tractor length | ~4 m | 4.00 m (2.18 wide, 2.60 tall) | PASS |
| bicycle | untouched | 2.04 m | PASS |
| `_deckFor()` lane capacity | back to the pre-CC0 range | **54 placed / 26 dropped**, against 76 / 4 before the change and 54 / 26 on the private install | PASS |
| `__headingErr()` | no vehicle pointing across its own path | 0 warnings, 0 wraps | PASS |
| `__pedOnRoad()` | empty | empty | PASS |
| `__carsInZone()` | empty | empty | PASS |
| `__overlaps()` over 600 frames | 0 | **45-75 frames of 600 carry 1-2 pairs** | **FAIL — see below** |

Screenshot: `docs/shots/cc0-street-scaled.png`, the same stress scene from above
the street. The vehicles now read at the size of the road and of the people on
the pavement; compare `docs/shots/cc0-street.png`, which is the same module
before the change.

**The overlap failure, measured rather than waved away.** The baseline
(2.84 m vehicles) is 0 frames of 600. After the change it is 45 to 75 frames,
never more than two pairs at once, and every occurrence caught is the same
situation: a vehicle standing in the gridlocked side street with its tail inside
the crossing carriageway, and a car on the main road clipping the corner of it.
Two examples, both captured with their full state:

- a van stopped on lane 4 at (14.6, 4.95), heading +Z, body spanning z 2.35 to
  7.55 — 0.25 m of it inside the z = 2.6 lane — while a van on lane 1 drives
  through at 3.6 m/s;
- a car stopped on lane 5 at (9.4, -3.85) with the same geometry, clipped by a
  pickup on lane 0.

It is not the scale arithmetic. It is that `?stress=1` asks for 80 vehicles on a
network that holds 54, so the 69 m side street stands still — 20 of the 54 are
stopped at any moment — and a stopped vehicle that entered the junction box on a
green cannot leave it. With 2.84 m vehicles the same cars stopped in the same
places and were simply too short to touch anything.

Two fixes were tried and **both were reverted**, because a change to the driving
model that does not measurably help is a change that should not ship:

- reducing a follower's `free` by a turning leader's remaining arc, so it
  measures to the metal rather than to the reserved slot: 74 bad frames against
  75. No effect.
- adding `v.half` to the "do not block the box" reservation, so the far side is
  reserved by the tail rather than by the centre: **117** bad frames. Worse — the
  extra caution backs the queue into the other junction.

What would actually fix it is a junction model that can get a stopped vehicle
out of the box, and that is a different piece of work from sizing a car. Logged
here rather than hidden, and named in the release notes.

### 12.2 The squashed history

| check | expected | measured | result |
|---|---|---|---|
| commits on `main` | 1 | 1 (`Werkstadt 0.1.0 — a live 3D world for your Claude Code sessions`) | PASS |
| old history kept locally | branch `pre-squash` | present, 5 commits, not pushed | PASS |
| loose objects before | — | `count: 243, size: 100.78 MiB, packs: 0` | — |
| after `git gc --prune=now --aggressive` | packed | `in-pack: 247, size-pack: 99.95 MiB`, `.git` 101 MB — `pre-squash` keeps the asset blobs reachable | PASS (expected) |
| what a clone actually fetches | small | `git clone --no-local --single-branch --branch main` gives **`size-pack: 13.59 MiB`**, `.git` 14 MB | PASS |
| tracked working tree | 20 MB or less | 17 MB, 94 files | PASS |
| `dist/` in the commit | no | gitignored, not tracked | PASS |

A local clone is not evidence here. `git clone` of a path on the same disk
hardlinks the whole object store, unreachable objects included, and reports 101
MB. `--no-local` (or a `file://` URL) is what does the pack negotiation a real
fetch does, and it is the only number worth quoting.

### 12.3 A clone that has never seen this machine

`git clone --no-local` into `%TEMP%\wk-clone`, the release zip copied to a
sibling folder, and `RELEASE_URL` / `RELEASE_SHA256` pointed at a `file://` URL
for the test only.

| check | expected | measured | result |
|---|---|---|---|
| `fetch_assets.py --release` | downloads, verifies, unpacks | `== unpacked 100 files into assets/ ==`, exit 0, 98 files on disk | PASS |
| the hash gate actually gates | a wrong digest refuses | digest changed by hand gives `sha256 MISMATCH`, exit 3, zip left on disk | PASS |
| `server.py --no-browser --port 4953` first run | writes `config.json` from the example | written | PASS |
| four pages, console errors | 0 | 0 | PASS |
| four pages, 4xx | 0 | **2 on `index.html`**: `data/demo.json`, `data/sample.json` | FAIL — expected, see below |
| the globe actually renders | textured planet, settlements counted | 149 settlements, textured, at a 40 s settle. 11 s is too short — the world index is still building and the page is stars only | PASS |
| with `assets/` removed: startup hint | one line naming both fetch commands | `_assets_unpacked()` returns `False`, and the print is gated on `sys.stdout.isatty()`, so it does not appear when stdout is redirected to a file. Verified by evaluating the predicate, not by reading the line | PARTIAL |
| with `assets/` removed: pages still open | yes, untextured | all four open, **0 console errors**, 86 asset 404s | PASS |
| `--redact` | no real name reaches a browser | `/api/config.js` gives `home: "~"`; `/api/world` gives `town-7f97`, `~/projects/town-8b3f`. grep for the real username, `Desktop`, other OS-specific profile folder names, `claude-live`, real project names, `werkstadt`, `wildmoments` and any Hebrew character over 104 KB of response: **0 hits** | PASS |

**The two 404s are the documented fixture fallback**, not a regression:
`replay.js` tries `data/demo.json` then `data/sample.json` when it is opened
with no `?src=` and no `?project=`, and phase A removed both fixtures because
they were exports of private sessions (HANDOFF, gap 2). The page handles it —
it prints "No session to replay yet. Export one to data/demo.json, or pass
?src= a replay file." — so the user-visible behaviour is correct and only the
console is untidy. Left alone rather than fixed, because deleting a fallback in
`replay.js` is a change to code phase D was not asked to touch. It is a two-line
decision for Beri: ship a small public fixture, or drop the two probes.

### 12.4 The plugin, from a clone

| check | expected | measured | result |
|---|---|---|---|
| `claude plugin validate ./plugin` | passes | Validation passed | PASS |
| `claude plugin validate .` | passes | Validation passed | PASS |
| `claude plugin marketplace add <clone>` | registers | Successfully added marketplace: werkstadt | PASS |
| `claude plugin install werkstadt@werkstadt --scope local` | installs | Successfully installed; `claude plugin list` shows `werkstadt@werkstadt 1.0.0, local, enabled` | PASS |
| the skill is there | one skill | `~/.claude/plugins/cache/werkstadt/werkstadt/1.0.0/skills/werkstadt` | PASS |
| removed again | the machine is as it was | marketplace removed, plugin gone from `claude plugin list`, download cache deleted. Marketplaces before **and** after: `trailofbits`, `ponytail`. Installed plugins before and after: 7 | PASS |
| `/plugin marketplace add owner/repo` | — | still cannot be tested: no remote. It is step 6 of `docs/PUBLISH.md` | NOT RUN |

Note for whoever repeats this: `claude plugin uninstall` needs `--scope local`
when the install used it, and removing the marketplace first makes the uninstall
report "not found in installed plugins", which is confusing but harmless. Check
`claude plugin list` rather than trusting either message.

## 13. The ported accident fixes and the demo fixture (2026-09-08, later)

Everything in this section was run against this tree on 2026-09-08, with the
CDP harness of section 1 at 1440x900, `server.py --port 4954`, and one headless
Chrome of its own on port 9461. It covers the four files ported out of the
private install (see HANDOFF, the section at the top) and the fixture that
closed gap 8.

### 13.1 The accident finishes, on three different hosts

The gate is that the incident leaves `approach`, reaches `ambulance`, has the
ambulance actually arrive, and then tears itself down — because the accident
slot is exclusive and one that wedges declines every later error in the session.

| host | how it was driven | stages, in that host's own clock | result |
|---|---|---|---|
| `life.html?robots=0` | `__accident()`, then `__accidentState()` polled at 50 ms | approach 0 → hit 9.76 s → ambulance 11.88 s → arrived → clear 38.0 s → gone 40.01 s | PASS |
| `index.html?project=<a real town>&replay=1&record=1` | `__recordTick()` driven 900 times, `__lifeAccident()` read every tick | staged f1 → hit f50 → ambulance f75 → arrived f112 → clear f363 → gone f388 | PASS |
| `index.html` on `data/demo.json` | played in real time, `__lifeAccident()` polled at 50 ms | approach 5.40 s → hit 7.36 s → ambulance 9.37 s → arrived 12.00 s → clear 31.96 s → gone 34.01 s | PASS |

The record row is the one the fixes were written for: before them the same run
sat in `approach` for 581 consecutive frames and declined every later error. The
`life.html` timings are longer than the private install's (2.22 s to hit against
9.76 s) for a boring reason — a headless software renderer runs fewer frames per
wall second, and `life.js` clamps `dt`, so its life clock lags the wall clock.
Read the ORDER of the stages, not the seconds.

### 13.2 The stress gates did not move

`life.html?stress=1`, 600 sampled frames, run three times with identical results,
and once more against the pre-port `life.js` to prove the port is what did not
change it.

| check | before the port | after the port | result |
|---|---|---|---|
| vehicles placed | 54 | 54 | PASS |
| `__overlaps()` frames of 600 carrying a pair | 77 (max 2 pairs) | 77 (max 2 pairs) | **known FAIL, not regressed** — gap 7 / section 12.1 |
| `__headingErr()` worst | 0, 0 wraps | 0, 0 wraps | PASS |
| `__pedOnRoad()` | `[]` | `[]` | PASS |
| `__penetrations()` | `now 0, peak 0, rate 0` | `now 0, peak 0, rate 0` | PASS |
| `__carsInZone()` | `[]` | `[]` | PASS |

The 77 is inside the same failure section 12.1 measured at 45-75 and is the same
mechanism; it is quoted here from this harness so the two numbers are comparable
with each other rather than across machines. Identical before and after the port,
which is the claim this row is making.

### 13.3 `globe.html?signs=<name>`

| check | expected | measured | result |
|---|---|---|---|
| `?signs=<a town name>` | one plaque built | `__signs()` → 1 sign (0 visible, 1 culled — that town was on the far side of the sphere at the pose) | PASS |
| no flag | unchanged | 31 signs built, 3 visible | PASS |
| console errors, either way | 0 | 0 | PASS |

### 13.4 The demo fixture

| check | expected | measured | result |
|---|---|---|---|
| `index.html` with no query, 4xx responses | 0 | 0 | PASS |
| ... console errors | 0 | 0 | PASS |
| ... fault card | absent | absent (it read "No session to replay yet" before the fixture) | PASS |
| buildings | > 0 | 10 | PASS |
| a crew on the street | > 0 | 3 workers, 1 drone, 2 crew actors, 1 car | PASS |
| the accident | reaches `ambulance` | reaches `clear` and tears down — see 13.1 | PASS |
| fixture size | ≤ 300 KB | 5,379 bytes | PASS |
| fixture privacy | no username, `Desktop`, `Users`, other OS-specific profile folder names, or the throwaway folder's name | 0 occurrences of each | PASS |
| screenshot | — | taken at `arrived`: two plates, ten lit buildings, the ambulance beacon and the hazard cones | PASS |

### 13.5 Four pages, cold

`index.html`, `globe.html`, `world.html`, `life.html`, each loaded fresh and left
for 25 seconds.

| page | console errors | 4xx | result |
|---|---|---|---|
| `index.html` | 0 | 0 | PASS |
| `globe.html` | 0 | 0 | PASS |
| `world.html` | 0 | 0 | PASS |
| `life.html` | 0 | 0 | PASS |

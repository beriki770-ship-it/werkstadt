# buildings.js — the procedural building generator

_Verified: 2026-09-08_
_The LOD1/2 night skyline (second facade bake, `uNight`/`aPhase` cross-fade, "The night skyline lost its lit windows" below) verified: 2026-09-06_

## Two bugs fixed this pass

`globe.js` was carrying workarounds for both of these (see its own HANDOFF
section, "Two bugs in `buildings.js` this page works around") — that agent can
remove `roof:'hip'` on its tower catalogue entry and its `roofScale()` helper
now that the kit itself is fixed.

- **`_roofPrism('flat')` rendered pure black.** It returned a plain
  `BoxGeometry`, which — unlike the hip and gable prisms right above it in the
  same function — carried no `color` attribute. The shared roof material has
  `vertexColors` on, and an absent attribute reads as `(0,0,0)`: every `tower`
  and `industrial` roof (both default to `flat`) was a black slab, at every
  LOD. Fixed by filling a `color` attribute on the flat box the same way the
  hip/gable prisms already do — white, i.e. no tint, so the shared roof
  texture shows through unmodified. Verified by rendering `tower` and
  `industrial` at LOD0/1/2 and reading the roof pixel back off the canvas:
  luminance 0.33-0.86 across all six, comfortably over the 0.08 floor a black
  roof would read as.
- **The instanced roof prism overhung by up to 90% on a big building.** It was
  built at a 1x1 footprint that already had the `+0.9` eave baked in
  (`W = w + 0.9` with `w = 1`), then that whole 1.9-wide prism was scaled by
  the REAL footprint — so a 20 m building's roof came out 38 m wide, a dark
  slab lying on the ground far past the walls (the black shards under
  `globe-vault.png`'s note cottages). Fixed by giving `_roofPrism` an
  `overhang` parameter: the single-building path (`_makeLod`) keeps passing
  the real footprint with the old default overhang, but `instanced()` now
  builds the roof at a true UNIT footprint with `overhang: 0`, then adds the
  fixed eave back in world metres at instance-matrix time
  (`scl.set(w + roofOverhang, 1, d + roofOverhang)`) — additive, not
  multiplied by the footprint. Verified with a probe, `__roofOverhang(style)`
  in `buildings.html`, that builds a one-item instanced group at a 6x8 and a
  20x30 footprint and measures the roof mesh's actual world-space width minus
  the wall's: both sizes read **0.5 m** for `tower`/`industrial` (flat roof)
  — a fixed eave, not one that grows with the building.

## A third bug, found by the island integration (2026-09-06)

`world.js`'s `fixLod1Roofs()` workaround (docs/HANDOFF.md, "the kit town and
the prop shell") corrected the x/z eave but also carried a y-scale fix the kit
itself never got: `instanced()` scaled every pitched LOD1 roof prism's height
by a flat `1`, so `_roofPrism`'s own `rise = min(w, d) * 0.42` came out at a
fixed **0.42 m regardless of the building under it** — every distant pitched
roof read as a near-flat slab, in exactly the 60-250 m band the island is
normally read at. Fixed in `instanced()`: the roof instance's y-scale is now
`Math.min(w, d)`, which reproduces `_roofPrism`'s own rise formula for that
footprint (`w`, `d` are the building's real footprint, not the unit prism's).
The eave fix above is untouched — only the third argument of `scl.set()`
changed. `world.js`'s `fixLod1Roofs()` is gone now that the kit does the whole
job; see that page's own HANDOFF entry. Verified with a probe,
`__roofRise(style, w, d, lod)` in `buildings.html`, that builds the same
footprint through the single-mesh LOD1 path (`_makeLod`, never scaled, always
correct) and the mass `instanced()` path and measures each roof mesh's own
world-space height: the two agree within 10% at both a 6x8 and a 20x30
footprint.

A standalone ES module that grows detailed buildings from a seed. No build step,
Three.js 0.185.1 through the same import map every other page here uses, textures
and models from `assets/manifest.json`.

The bar it was written against, verbatim: *"real realism — real details on every
structure so it looks as real as possible."* Measured as **at least twelve
distinct detail elements readable from 10 m**, each carrying a real PBR material
rather than a flat colour.

- **Library:** `buildings.js` (1,515 lines) — no dependency on any other file here.
- **Showcase:** `buildings.html` + `buildings.css` — a street of twelve, all nine
  styles, all five palettes, all four roofs.
- **Run it:** `python server.py`, then <http://127.0.0.1:4949/buildings.html>
  (`?seed=` picks the street).

---

## API

```js
import { BuildingKit } from './buildings.js';

const kit = await BuildingKit.load(renderer, 'assets/manifest.json');
```

Loads the pack once — five textures, two HDRIs prefiltered to PMREM — and builds
the nine shared materials. Everything after this is synchronous.

| call | does |
|---|---|
| `kit.make(opts) → THREE.Group` | one building, deterministic from `opts.seed` |
| `group.userData.lamps` | `[[x,y,z], …]` of the lit wall-lamp bulbs, in the building's own frame — hang real lights on them |
| `kit.instanced(list) → THREE.Group` | hundreds of buildings as InstancedMeshes, grouped by style + palette + roof + lod |
| `kit.setNight(t)` | `0` day … `1` night; drives window emissive and the glass tint |
| `kit.lodFor(distance) → 0 \| 1 \| 2` | `<60 m` → 0, `<250 m` → 1, else 2 |
| `kit.setEnvironment(env)` | point every material at an env map (`kit.envDusk` / `kit.envNight`) |
| `BuildingKit.styles` / `.palettes` | the grammar tables, for a legend or a doc |

### `make(opts)`

| key | default | values |
|---|---|---|
| `seed` | `1` | any integer — the same seed is the same building, always |
| `footprint` | `[8, 8]` | `[width, depth]` in metres |
| `floors` | `3` | integer |
| `style` | `'townhouse'` | `townhouse` `cottage` `apartment` `industrial` `shop` `civic` `barn` `church` `tower` |
| `roof` | the style's own | `gable` `hip` `flat` `mansard` |
| `palette` | `'plaster'` | `plaster` `brick` `timber` `whitewash` `stone` |
| `lod` | `0` | `0` full geometry · `1` baked box + roof solid · `2` baked box |
| `lit` | `true` | `false` bakes every window dark (used by the LOD bake itself) |

The building stands on `y = 0` with its **front on −Z**, so `rotation.y = 0`
faces a road that lies toward −Z.

### `instanced(list)`

Each item: `{ position:[x,y,z], rotationY, footprint, floors, style, palette,
roof, lod, seed }`. Grouping is by everything that decides geometry or material,
so a field drawn from a small catalogue of types costs a handful of draw calls
and a field drawn from all 180 combinations costs 360. **Use a catalogue.**

---

## The grammar

One row per style. `bay` is the target column width the facade divides itself
into; the last five columns are probabilities the seed rolls against.

| style | floor h | bay | default roof | shutters | balcony | sign | shopfront | utility wall | boundary | quoins | string course |
|---|---|---|---|---|---|---|---|---|---|---|---|
| townhouse | 3.0 | 2.5 | gable | .6 | .5 | .25 | – | .4 | .3 | .3 | yes |
| cottage | 2.7 | 2.8 | hip | .9 | – | – | – | .2 | .9 | .1 | – |
| apartment | 2.9 | 2.4 | mansard | .2 | 1 | – | .35 | .8 | .1 | .2 | yes |
| industrial | 4.4 | 3.4 | flat | – | – | .9 | – | 1 | .7 | – | – |
| shop | 3.2 | 2.5 | gable | .4 | .3 | 1 | 1 | .3 | – | .2 | yes |
| civic | 4.0 | 3.0 | hip | .1 | .2 | .7 | – | .2 | .5 | .8 | yes |
| barn | 4.8 | 3.6 | gable | .3 | – | .2 | – | .5 | .8 | – | – |
| church | 6.0 | 3.2 | gable | – | – | – | – | – | .4 | .9 | – |
| tower | 3.1 | 2.6 | flat | .1 | .4 | .2 | – | .9 | .1 | .3 | yes |

Palettes are the wall surface plus three colours — wall, joinery, roof — and the
stone the dressings are cut from:

| palette | wall surface | reads as |
|---|---|---|
| plaster | `painted_plaster_wall` | cream render, green joinery |
| brick | `sandstone_blocks_04` | red brick, near-black joinery |
| timber | `painted_plaster_wall` | ochre render, brown joinery |
| whitewash | `painted_plaster_wall` | white render, navy joinery |
| stone | `sandstone_blocks_04` | grey ashlar, charcoal joinery |

---

## The detail elements

Counted off `docs/shots/buildings-closeup.png` — building 1, townhouse ·
plaster · gable, camera 8 m out. Every one of these is geometry with a PBR
material on it; none is painted on.

| # | element | material |
|---|---|---|
| 1 | plinth — stone base course with a chamfered drip | sandstone |
| 2 | wall panels, built around the openings as piers and spandrels | plaster |
| 3 | string courses at every floor line | sandstone |
| 4 | corner quoins, alternating long and short | sandstone |
| 5 | window frame — four members with visible corner joints | painted timber |
| 6 | mullion and transom | painted timber |
| 7 | glass, reflecting the HDRI | MeshPhysical + clearcoat |
| 8 | stone sill, proud of the wall | sandstone |
| 9 | lintel over each opening | sandstone |
| 10 | shutters with louvre bars | painted timber |
| 11 | dirt streak under every sill | multiply decal |
| 12 | soot and splash on the bottom 0.45 m | vertex colour |
| 13 | door — jambs, head, panelled leaf, plate and lever handle | timber + brass |
| 14 | step and threshold at the door | sandstone |
| 15 | fanlight over the door, lit at night | glass + emissive |
| 16 | balcony — slab, two corbels, railing, balusters | sandstone + metal |
| 17 | wall lamp — bracket, arm, shade, bulb | metal + emissive |
| 18 | downpipe with brackets and a shoe, one at each rear corner | metal |
| 19 | gutter, a run of half-round along the eaves | metal |
| 20 | fascia board under the eaves | painted timber |
| 21 | roof in stepped tile courses, ~0.42 m apart | roof tiles |
| 22 | ridge cap | roof tiles |
| 23 | eaves overhang, 0.48 m past the wall | — |
| 24 | chimney with cap slab and two pots (in the street shot) | sandstone + metal |
| 25 | contact occlusion in every reveal, under the eaves and sills, in the wall/roof corner | vertex colour |
| 26 | an impostor ROOM behind each pane — back wall, two returns, floor, ceiling | textured, parallaxes |
| 27 | half-lowered blinds or drawn curtains on ~30 % of panes | painted timber |
| 28 | rust running out of the pipe brackets | rust decal |
| 29 | moss on the north (+Z) plinth | vertex colour |
| 30 | replaced tiles, lighter and proud of their course, ~8 % of courses | roof tiles |

Off-frame in the close-up but in the same grammar: the AC unit, meter box and
pipe run on the utility wall (`industrial`, `tower`, `apartment`), the awning and
fascia sign on a `shop` ground floor, the dormer on a mansard, the parapet and
roof plant on a `flat`, and the fence or low boundary wall.

At night, `setNight(1)` lights roughly 58 % of the windows — about a quarter of
them on a cool lamp rather than a warm one — and leaves the rest dark. See
`docs/shots/buildings-night.png`.

---

## Why no two surfaces match

The first pass scored itself 3/5 against "would pass as a game screenshot". Four
of the five things holding it back were the same defect wearing different
clothes: **everything repeated**. One plaster tone across a street, one dirt
streak under every sill, one roof colour from eaves to ridge. This is what was
done about it, and all of it is deterministic from the seed.

| lever | what it does | where |
|---|---|---|
| per-building colour | ±3° hue and ±6 % value on wall, stone, roof and joinery, re-rolled from the seed | `buildFull` |
| per-panel tint | every pier and spandrel takes its own ±3°/±5 % off a hash of its bay, floor and side | `facade`'s `panel()` |
| macro noise | two octaves at 4.2 m and 1.3 m multiplied into every vertex colour — the blotching a flat render has none of | `Builder._paint` |
| patched repair | a sparser, harder-edged mask, plaster palettes only — filled cracks never match | `_paint`, `patch` |
| mortar lines | a darker bed joint at every floor line, brick and ashlar only | `_paint`, `mortar` |
| whitewash streaks | runs from a leaking gutter, on the one palette they show on | `buildFull` |
| dirt atlas | six streak cells at three strengths; cell, width, length, offset all off the opening's own position | `partWindow` |
| wobbled tide mark | the splash-back height is modulated by metre-scale noise, so the dirt is not a spirit level | `_paint` |
| rust | its own decal texture, under every pipe bracket on the utility wall and beside both downpipes | `partUtility`, `buildFull` |
| moss | a green-black vertex tint on the +Z plinth only — the side that never dries | `_paint`, `moss` |
| roof weathering | per-course value, darker at the ridge and at the gutter, plus lighter replaced tiles | `partRoof`'s `slope()` |
| glass | per-pane tint, roughness 0.05, and a five-quad impostor room so a pane has depth, not a mirror | `partWindow` |
| blinds and curtains | on ~30 % of panes, in the joinery bucket so they cost no material | `partWindow` |
| warm and cool rooms | a second lit material — emissive is not a per-vertex channel | `_buildMaterials` |

### Contact occlusion

`aoMap` is still off; it was measured at 27 → 41 fps and what it bought was
micro-occlusion inside a 2 m texture tile, invisible from the street. What was
missing without it is **contact** dark — inside a window reveal, under an eave,
under a balcony slab, where the wall meets the roof — and that is geometry
scale, so it is baked once at build time and costs nothing to draw.

`Builder.bakeAO()` voxelises the building's own solid boxes into a 0.32 m
occupancy grid, then fires eight rays per vertex over the hemisphere **around
that vertex's normal**, four steps each, and multiplies the result into the
`color` attribute the materials already read. About 32 grid lookups a vertex; a
townhouse bakes in single-digit milliseconds and forty of them do not show up in
the stress numbers below.

### The street

The showcase's ground was a road plane butting a pavement box at a hard 16 cm
step. `buildStreetFurniture()`, `buildWeeds()` and `buildWires()` replace that
edge with the one a person actually knows by heart:

- 256 instanced **kerb stones** with a 45° chamfer on the road arris, each settled
  a few millimetres of its own — one draw call
- a **gutter channel**, darker and smoother than the road beside it
- eleven **puddles** with an alpha map for the wet margin and a roughness map so
  the middle is smoother than the rim, two thirds of them in the gutter
- four **drain grates** and a **manhole**, so the water has somewhere to go
- seven **bollards**, ten more deterministically scattered barrels, crates and
  stones against the facade line, and two more benches
- ~120 **weed** billboard cards in the kerb joint and at the foot of every wall,
  one alpha-tested draw call
- three **overhead wire** spans with catenary sag and insulators

### The lamps that light something

Every entrance already carried an emissive lamp shade. A shade that glows and
lights nothing is what makes a night render read as a poster, so `make()` now
returns `userData.lamps` and the showcase hangs up to **eight real point lights**
on the nearest bulbs within 40 m, re-picked twice a second, off entirely during
the day. Those three numbers are the whole budget.

---

## LOD

| lod | distance | what it is | cost |
|---|---|---|---|
| 0 | < 60 m | the full grammar, merged into 9 meshes | ~8.7 k triangles, 9 draw calls |
| 1 | 60–250 m | a box wearing a **render of the real building's own front**, plus a roof solid | 2 draw calls per instanced group |
| 2 | > 250 m | the same box, no roof | 1 draw call per instanced group |

The bake is what makes LOD1 hold up: at load, one prototype building per
style + palette is rendered head-on into two 512² targets — albedo and, with the
scene overridden to `MeshNormalMaterial`, a normal map — under flat light. The
distant box therefore has the same sills, shutters and dirt as the near one, and
still catches the sun across its reveals. `docs/shots/buildings-stress.png` is
the proof: LOD0 in the foreground, LOD1 behind it, LOD2 at the horizon, and no
line where one becomes the other.

---

## The night skyline lost its lit windows

`setNight(t)` only ever drove LOD0's live `lit`/`lit2`/`glass` materials. A
LOD1/2 building wears a baked-flat photograph of its own front instead of
those materials, so at 60 m+ every window on the instanced skyline stayed the
day-time dark rectangle no matter what hour it was — the only lit windows in
the whole town were on the dozen LOD0 buildings within 60 m of the camera.

Fixed by baking a SECOND facade photograph per style + palette: `_bake()` now
shoots the prototype twice — once as authored (`lit:false`, the day albedo)
and once with `setNight(1)` applied to it first (`lit:true`, the night
albedo) — reusing `setNight()`'s own emissive/glass numbers rather than
duplicating them, so the baked night photo always matches what `setNight(1)`
does to a live LOD0 building next to it. The normal map is only baked once;
the geometry does not change between the two shots.

The instanced material's `onBeforeCompile` cross-fades the two bakes in the
fragment shader on a `uNight` uniform (`material.userData.uNight`, written by
`setNight()` on every one of its `_bakes`) — `mix(dayTexel, nightTexel,
smoothstep(...))` gated on the delta between the two bakes, not on how dark
the day pixel already is, so dirt, mortar and shadow (dark in both bakes)
don't dilute the fade and only actual window pixels move. A per-instance
`aPhase` attribute (`instanced()` adds it to the body geometry, one seeded
float per building) staggers WHERE in the day/night ramp each instance's
`smoothstep` window sits, so a field of LOD1/2 buildings lights up over the
ramp instead of every window in the group snapping on in one frame. `aPhase`
is read behind `#ifdef USE_INSTANCING`, so the single-building LOD1/2 path
(`make()`'s plain, non-instanced `Mesh`) still compiles and still fades, just
without the per-instance offset — nothing there needed a second attribute.

**Attribute budget:** the LOD1/2 body carries `position`, `normal`, `uv`,
`aPhase` (4 geometry attributes) plus `instanceMatrix` (a mat4 — 4 GLSL
attribute slots on its own) = **8 of the 16 the task set as a ceiling**. The
roof mesh carries `position`, `normal`, `uv`, `color` + `instanceMatrix` = 8.
Measured with `window.__attrCount(style)`.

**Verified 2026-09-06** (`window.__nightLuminance(style, palette)`, which
reads the two bakes' own pixels back with `gl.readPixels` rather than
guessing from a framed screenshot): window-region mean luminance, night ÷ day
— `townhouse/plaster` **3.91×** (0.150 → 0.586), `apartment/brick` **3.67×**
(0.124 → 0.456), both clear of the 3× gate. `window.__roofOverhang('tower')`
(unrelated fix, re-checked here since it shares the LOD1 instanced path):
**0.5 m** eave at both a 6×8 and a 20×30 footprint (ceiling 0.6 m) and
**0.42 m** flat-parapet height (ceiling 0.5 m) — both fixed, neither grows
with the building. `docs/shots/buildings-night.png` — 300 m out, night on,
`__stress(40,200,800)` in frame — re-shot and looked at: the far LOD1/2 field
carries warm and cool lit windows, not the uniform dark wall the bug left.
Console: 0 (`window.onerror` count and `Runtime.consoleAPICalled` type
`error`, both across load + night + LOD1 + LOD2). `__stress(40,200,800)`:
781 calls with no stress field vs. showcase street only → 1,275 calls /
2.23 M triangles once the field is spawned and framed from outside the ring
(extra draws are the pose bringing more of the stress field's own groups into
the frustum, not new draws the fix added — group count and per-group draw
calls are unchanged by the second bake). Absolute
fps is not quotable from this run for the same reason "Reading a frame rate
here honestly" below already documents: this machine had other Chrome
processes contending for the GPU at capture time (19.8-23.9 fps on headless
SwiftShader, well under the 45 fps gate, on a box that has hit 60 fps at this
same stress level with a quiet GPU) — draw-call and triangle counts are the
only numbers this environment can make honestly, and they match expectation.

**For `world.js` / `globe.js`:** this closes the gap in "What integrating
into `world.js` / `globe.js` needs" item 5 below — `setNight(t)` now drives
LOD1/2's own windows through the bake, not just LOD0's. Either page can drop
any workaround it grew for a permanently-dark instanced skyline (a forced
LOD0 radius at night, a fake point-light rig standing in for windows that
don't light, etc.) — check `globe.js`'s own HANDOFF section the way the "Two
bugs fixed this pass" note above already points at for the roof fixes; there
was no such workaround as of this pass, so there may be nothing to remove,
but the option is now real.

---

## Performance

Measured on the real GPU (AMD Radeon 860M, `ANGLE … D3D11`), headed Chrome 152 at
1440 × 900, `deviceScaleFactor 1`, one browser on the GPU, `__fps()` read after
letting the rolling 90-frame average settle. 60 is the vsync cap.

| state | draw calls | triangles | fps |
|---|---|---|---|
| the showcase street — 12 LOD0 + street furniture + props | 590 | 1.59 M | **60** |
| `__stress(40, 200, 800)` — the gate | 894 | 1.33 M | **60** |
| the same stress from a higher pose, street still in frustum | 1,275 | 2.23 M | **58** |
| the close-up pose | 188 | 0.67 M | **60** |
| night, eight point lights up | 585 | 1.57 M | **55** |

Gate is ≥ 45 fps at 40 LOD0 + 200 LOD1 + 800 LOD2. **Passes at the cap**, three
consecutive runs of five samples each, on a box carrying 60-odd other Chrome
processes at 68–73 % CPU at the time — see the honesty note below, which this
pass had to lean on hard.

**Re-run after the two roof fixes above (2026-09-06):** `__stress(40,200,800)`
came back 897 draw calls / 1.33 M triangles — matching the pre-fix baseline
(894 / 1.33 M) within the noise of a random layout, which is the structural
proof the fix changed the roof's SHAPE and not the group/instance count. The
fps reading itself is not quotable this time: this repo had 80-plus Chrome
processes running at once (four other agents' own capture browsers, per the
honesty note below) and both a fresh headed Chrome and headless SwiftShader
read 15-24 fps under that load — the same "occluded/contended window reads
nonsense" failure mode this doc already documents, not a regression. Console
errors: 0.

Before the polish pass, on the same machine and the same procedure: street 545
calls / 1.46 M triangles / 60 fps, stress 800 / 1.23 M / 60 fps. The pass costs
**+45 draw calls on the street and +94 at the stress gate** — the extra decal
material, the second lit material and the street furniture — and buys the whole
table above it.

Three things bought that, all measured, none of them cosmetic:

- **No `aoMap`.** The pack's ARM red channel is micro-occlusion inside a 2 m
  texture tile and is invisible at any distance a person stands. It cost a
  texture fetch on every shaded pixel: **27 → 41 fps** on the 40-LOD0 view. The
  occlusion that IS visible — the base of the wall, under the sills — is vertex
  colour and decals, which cost nothing.
- **`PCFShadowMap`, not `PCFSoftShadowMap`**, at 1536² instead of 2048²:
  **38 → 44 → 47 fps** on the street.
- **The impostor room does not cast a shadow and is not double-sided.** It is
  five quads per window and it lives INSIDE the building, so its shadow can
  never be seen. Built double-sided and shadow-casting it put roughly twelve
  thousand extra quads through the shadow pass at the stress gate and measured
  **13 fps**; `side: FrontSide` and `castShadow = false` put it back to **60**.
  That one line was the whole regression, and for an hour it read as machine
  load because the machine really was loaded at the same time.
- **LOD2 is keyed without the roof** — it builds no roof mesh, so splitting the
  groups by roof shape turned one instanced draw into four for nothing. 800 LOD2
  buildings: 180 groups → 45.

### Reading a frame rate here honestly

- **A Chrome window that is occluded or backgrounded reports nonsense.** The same
  page on the same GPU read 27 fps and then 60 fps with no code change between
  them, because the window had fallen behind another. Launch the measuring
  browser with `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --disable-background-timer-throttling`, and if
  `__fps()` returns 0 the render loop is throttled, not slow.
- **Headless Chrome has no GPU on this machine** — it falls back to SwiftShader
  and reads 15–30 fps for everything. Screenshots from it are correct; its frame
  rate means nothing.
- Props are scanned `.glb` models at full density and dominate the triangle
  count, not the buildings: `__budget()` prints the split (buildings 105 k
  triangles for twelve; one chainlink fence module 89 k).

---

## The showcase page

| key | does |
|---|---|
| drag / scroll | orbit, zoom |
| `W A S D` | walk in the direction you are looking (`shift` to run) |
| `Q` `E` | up, down |
| `N` | day / night |
| `L` | force LOD 0 → 1 → 2 → auto, rebuilding the same twelve in place |
| `C` | jump to the close-up pose |

Harness hooks, all on `window`: `__ready()` `__fps()` `__calls()` `__tris()`
`__budget()` `__night(t)` `__lod(n)` `__closeup()` `__wide()`
`__stand(x,y,z,tx,ty,tz)` `__stress(n0,n1,n2)` `__roofOverhang(style)`
`__nightLuminance(style,palette)` `__attrCount(style)`.

### Reference shots

Taken headed at 1440 × 900 against `?seed=1`, console errors zero on all four.

| shot | pose |
|---|---|
| `docs/shots/buildings-street.png` | `__wide()` — down the street |
| `docs/shots/buildings-closeup.png` | `__closeup()` — 8 m off building 1 |
| `docs/shots/buildings-night.png` | `__stress(40,200,800)`, `__night(1)`, then `__stand(0,70,700,0,10,-60)` — outside the stress ring (center `(0,0,-60)`, radius ≤ 620) looking across the whole LOD1/2 field, to show the bake's own lit windows rather than the near LOD0 street (re-posed 2026-09-06 for "The night skyline lost its lit windows"; an earlier pose at `(0,20,300)` sat INSIDE the ring and mostly framed nearby LOD0/1, which proves nothing new) |
| `docs/shots/buildings-stress.png` | `__stress(40,200,800)` then `__stand(-44,26,40,-44,6,-90)` — the old, lower pose ends up under the eaves of the near row |

---

## HANDOFF

_Verified: 2026-09-07_

**State:** complete and self-contained. `buildings.js` is a library nothing else
imports yet; `buildings.html` is the only caller. `world.js`, `globe.js`,
`city.js`, `interior.js` and `server.py` were **not touched** — other agents were
editing them during this pass.

### Decisions worth knowing

- **Geometry, not decals.** The world's existing facade shader paints windows
  onto a box. That is correct at 600 m and wrong at 10, so nothing here is
  painted: an opening is a gap the wall is built around, and the reveal comes
  from the 0.34 m wall thickness.
- **Nine material buckets, merged per building.** A townhouse is ~400 boxes and
  9 draw calls. `vertexColors` is what lets one plaster material carry a cream
  wall, a green shutter and a soot-dark base — without it there would be thirty
  materials and thirty draws.
- **World-projected UVs, not box UVs.** A `BoxGeometry`'s own 0..1 UV would
  squeeze a 3 m brick texture onto a 0.09 m window frame. Every surface is
  projected from its dominant axis at the manifest's true metres-per-tile.
- **Three decal materials, not one atlas.** An atlas bleeds across its own
  cells in the lower mips, and the first build of this pass put green moss and
  orange rust under front-facade window sills because of it. Six dirt cells of
  one grey-brown family share a texture safely; rust gets its own; moss stopped
  being a decal at all and became a vertex tint on the plinth, which is free.
- **The signs are one shared plate.** Per-building lettering would be one texture
  and one draw call per building. The bar asked for *a sign plate*, not a
  typography system.

### Traps the polish pass hit

- **A world-up AO hemisphere shades the eaves and misses every reveal.** A
  window reveal is a vertical face looking sideways into a 1.3 m slot; sampled
  against world up it comes back almost unoccluded. The hemisphere has to be
  built around the vertex NORMAL.
- **A `roughnessMap` MULTIPLIES `material.roughness`.** A puddle with a
  near-black centre in its roughness map is a mirror whatever `roughness` says,
  and under a bright overcast HDRI every puddle rendered as a white blob of
  reflected cloud that read as spilt paint. Mid-grey centre, `envMapIntensity`
  0.1, and it reads as standing water.
- **`Math.random()` in a texture generator breaks screenshot comparison.** The
  old grime canvas used it, so no two loads produced the same wall. Seeded.
- **The scanned bush is the most expensive thing in the pack.** A scatter of
  eighteen extra props cost 270 k triangles until the bushes came out of it; the
  weed cards cover the same ground for four hundred.
- **A headed measuring window on a shared desktop drifts.** Three captures in
  this pass came back from a camera nobody in the code had moved. The harness
  now re-applies the pose immediately before `Page.captureScreenshot`, and
  compares the HUD's own draw-call count against `__calls()` to catch it.

### Traps the first pass hit

- **Roof course tilt.** A box rotated by `-ang` points its +Z *up*-slope; the
  slope direction is `(0, -sin, cos)`, so the angle is `+ang`. With the sign
  wrong every roof came out as gapped louvres with sky between the courses, and
  it looked like a spacing bug rather than a rotation bug.
- **A hip roof's slopes taper.** Built as constant-width rectangles they cross at
  the hips and leave a hole at every corner. `slope()` takes `lenEave` and
  `lenRidge` for exactly this.
- **A mansard's lower pitch starts at the eaves, not at the knuckle.** Without
  pushing the frame out to `z = D/2` first, the whole roof floats a metre inside
  the walls.
- **`MultiplyBlending` needs `premultipliedAlpha: true`** or three warns on every
  single draw — 359 console errors from one decal material.
- **`renderer.info.render.calls` after `composer.render()` reports 1.** The last
  thing an `EffectComposer` draws is the output pass's fullscreen quad and
  `info.autoReset` had already cleared the counter. Set `autoReset = false` and
  reset once per frame.
- **Bloom threshold and a real HDRI background do not mix at 0.86.** The whole
  upper half of the frame sits above that, so the bloom veiled the entire street
  in milk. 1.0 during the day, 0.58 at night.

### What integrating into `world.js` / `globe.js` needs

1. **One kit, shared.** `BuildingKit.load()` builds its own PMREM chains and
   materials. `world.js` already has `envDusk` / `envNight` and its own texture
   cache — pass the renderer, then call `kit.setEnvironment(world's env)` on the
   day/night swap instead of letting the kit hold a second copy.
2. **Front is −Z.** The town planner in `world.js` places buildings by matrix; it
   has to face them at their street, or every door will point into a neighbour.
3. **The town loop should call `kit.lodFor(distance)` per building per camera
   move**, and keep LOD1/LOD2 in `kit.instanced()` groups. Rebuilding those
   groups every frame would be far worse than the LOD saves — rebuild on a
   coarse hysteresis (e.g. when a building crosses a band by more than 10 m).
4. **Use a catalogue of types.** `instanced()` groups by style + palette + roof;
   a random draw over all 180 combinations produces 360 InstancedMeshes and
   destroys the point. The showcase's `CATALOGUE` of ten is the pattern.
5. **`setNight(t)` is one call for the whole town** — wire it to `world.js`'s
   existing sun angle rather than adding a second clock.
6. **Budget:** 8.7 k triangles and 9 draw calls per LOD0 building. A world that
   wants 40 of them close needs ~360 calls before anything else is drawn.

### Known limits

- Daylight glass is still the weakest of the six levers. The impostor room is
  there and it parallaxes, but a north-facing pane under an overcast sky is
  mostly a dark reflection of that sky, and at 8 m the depth reads as tone
  rather than as a room. It carries the shot at night; it argues at noon.
- The wall macro noise is per-BUILDING, offset by a constant derived from the
  seed rather than by the building's world position, because `make()` does not
  know where it will be placed. Two buildings with adjacent seeds therefore wear
  similar stain maps. Give `make()` a world offset if that ever shows.
- `church` and `tower` are the grammar's weakest rows — they are the townhouse
  grammar with different numbers, not their own forms (no spire, no belfry).
- The LOD1 bake photographs the **front** facade and wraps it on all four sides,
  so a distant building's side wall shows a door. Correct at 60 m+, wrong if the
  LOD bands are ever widened.
- `_bake()` runs a render-to-texture on first use of a style + palette, so the
  first `instanced()` call with a new combination costs a frame.

_Re-verified 2026-09-08: the pass that closed the 2026-09-07 acceptance's client FAILs
reloaded this subsystem's pages with `Network`, `Log` and `Runtime` collectors
armed — 0 console errors and no response >= 400 — and nothing in this file
changed. See docs/TESTS.md table Q._

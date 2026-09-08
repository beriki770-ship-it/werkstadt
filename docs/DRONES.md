# drones.js — the ORNIS drone kit

_Verified: 2026-09-08_

A standalone ES module that turns every agent and worker in this app from a
glowing octahedron into an **aircraft**. The airframe is Beri's own ORNIS
quadcopter from <https://digital.wildmoments.at/ornis/>; seven variants wear
procedural attachments that say what the craft is doing. No build step,
Three.js 0.185.1 through the same import map every other page here uses, model
and manifest from `assets/`.

The bar it was written against, verbatim: *"agents and workers are real
aircraft, not glowing discs"*, with **silhouettes readable from the wide shot**
as the measurable half of that.

- **Library:** `drones.js` (1,052 lines) — imports nothing from this repo.
- **Showcase:** `drones.html` + `drones.css` (628 + 108 lines) — the seven
  variants over a `BuildingKit` street.
- **Run it:** `python server.py`, then <http://127.0.0.1:4949/drones.html>
  (`?stress=60` builds the frame-rate gate, `?seed=` picks the street).

---

## The one rule

**The silhouette carries the meaning. Colour is the second channel.**

At two hundred metres a gold dot and a blue dot are two dots. A craft with a
tall mast, a craft with wide flat wings and a craft with a ball turret slung
underneath are three different machines. So every variant puts its mass on a
**different axis** — up, down, out, forward — and none of them needs a colour
to be identified:

| axis | variants |
|---|---|
| below | orchestrator (beacon ring), agent (cargo pod), read (turret), shell (skid cage) |
| forward | edit (two booms), shell (tool arms) |
| out | search (wide wings — the widest craft in the fleet) |
| above | net (mast — the tallest craft in the fleet) |

The first cut of the line-up put the attachments at ~0.15 of the airframe span
and four of the seven were indistinguishable at 27 m. They are now 0.22–0.30,
which is what `docs/shots/drones-lineup.png` shows.

---

## API

```js
import { DroneKit, VARIANTS } from './drones.js';

const kit = await DroneKit.load(renderer, 'assets/manifest.json');
```

`load()` fetches one GLB, bakes the ORNIS's 102 nodes and 12 materials down to
three merged geometries, decimates each for LOD1, builds the shared rotor and
light parts, and renders one sprite per variant. Everything after that is
synchronous, which is what lets `make()` be called from an event handler.

| call | does |
|---|---|
| `kit.make(type, opts) → THREE.Group` | one craft; `opts` is `{ tier, seed, lod }` |
| `kit.update(dt, camera)` | one call a frame: rotors, strobes, bob, bank, downwash, beams, LOD |
| `kit.lodFor(distance) → 0 \| 1 \| 2` | `<120 m` → 0, `<400 m` → 1, else 2 |
| `kit.setNight(t)` | `0` day … `1` night |
| `kit.setEnvironment(env)` | point the shared materials at an env map — `BuildingKit.envDusk` / `.envNight` |
| `kit.remove(g)` | stop flying a craft (the host still un-parents it) |
| `kit.stats()` | craft count, the LOD split, triangles per tier |
| `kit.getHeight = (x,z) => y` | the host's ground, for the downwash ring. Default is a flat world |
| `VARIANTS` | the catalogue table, for a legend or a doc |

### What a craft carries

Everything a host needs is on `group.userData`:

| key | is |
|---|---|
| `tagAnchor` | an `Object3D` over the craft — project it to screen space and put a label there |
| `trailAnchor` | an `Object3D` at the tail, for a light ribbon |
| `emitters[]` | the beam / laser / cone / spark objects, so a host can drive its own instead |
| `setSpeed(v)` | metres per second, or a `Vector3` velocity — banks, pitches and spools the rotors |
| `setWorking(bool)` | the variant's effect on or off |
| `setLights(t)` | `0` dark … `1` full, per craft |

`setSpeed` takes a number **or** a vector. A number is forward speed; a vector
also rolls the craft into a sideways component, which is what makes a drone
crossing the frame look flown rather than slid.

---

## The seven variants

`scale` multiplies `BASE_SPAN`, which is **1.6 m** rotor tip to rotor tip —
sized against `BuildingKit`, where a floor is about 3 m.

| type | scale | span | accent | attachments | silhouette cue |
|---|---|---|---|---|---|
| `orchestrator` | ×1.8 | 2.88 m | gold `#d2a62c` | underslung beacon ring, four rotor guards, four hull pips | biggest craft, a lit ring under it |
| `agent` | ×1.2 | 1.92 m | by tier | cargo pod on two struts, tier band | a box slung below |
| `worker.read` | ×0.7 | 1.12 m | azure `#5fb7ff` | sensor turret, lens, downward scan beam | a ball hanging down |
| `worker.edit` | ×0.7 | 1.12 m | laser `#ff2a1a` | two raked printer arms with emitter tips, five heat fins | two horns in front |
| `worker.search` | ×0.7 | 1.12 m | blue-white `#dff0ff` | two swept wings, sweeping cone | the widest span |
| `worker.shell` | ×0.8 | 1.28 m | ember `#e2703a` | skid cage, two tool arms, spark burst | heavy and low |
| `worker.net` | ×0.7 | 1.12 m | link `#7fe8c0` | antenna mast, two cross elements, dish, **upward** uplink beam | the tallest |

Agent tiers: `opus` gold, `sonnet` silver, `haiku` bronze. Anything else —
including no tier — is silver, which is the documented default and not an error.

The colours are city.js's own `GOLD`, `AZURE`, `LASER` and `EMBER`, so a craft
and the beam it fires in the city are the same palette.

**The net craft's beam points UP.** It is an uplink, and it is the only beam in
the fleet that does — one more silhouette cue for free.

### Every craft, regardless of variant

- **Real rotors.** The GLB carries eight blade meshes; two are merged into one
  shared rotor geometry and instanced at the four `PropHub_*` mounts taken off
  the model. Above ~half power an additive blur disc fades in over them, which
  is what a spinning rotor actually looks like — and is how a viewer tells
  "landed" from "hovering" at a hundred metres without reading anything.
- **Nav lights.** Port red, starboard green, tail white strobe at 1.35 s. The
  real convention, kept because it carries real information: from behind,
  red-on-the-left says the aircraft is flying away from you.
- **Bank and pitch** from velocity, clamped at about 17°. Past that a hovering
  camera drone stops looking like it is holding station and starts looking like
  it is falling.
- **Hover bob** on two frequencies that do not divide into each other, or sixty
  craft breathe in unison and the fleet reads as one object.
- **Downwash** — a dust ring that appears within two rotor spans of the ground
  and only while the rotors are turning.

---

## LOD

| lod | distance | what it is | triangles |
|---|---|---|---|
| 0 | < 120 m | the full merged airframe + four rotors | **41,432** |
| 1 | 120–400 m | grid-welded airframe, welded rotors | **2,358** |
| 2 | > 400 m | a sprite baked off the real LOD0 craft | 2 |

All three tiers are **built at `make()` time** and swapped by visibility.
Building LOD1 lazily at the moment a craft crosses 120 m means a geometry
upload mid-flight, and that is a stutter you can see.

LOD2 is a billboard of the *actual machine*, not a coloured dot: each variant
is photographed once at load into a 128² target from three-quarter front-high,
so the wide-wing craft stays wide and the mast craft stays tall at the distance
where that is hardest to hold.

`docs/shots/drones-stress.png` is the proof — 67 craft, 27 at LOD0 in the near
ranks and 40 at LOD1 behind them, in one frame.

---

## Why 102 nodes became 3 draw calls

`ornis.glb` ships as a **node soup**: 102 root-level nodes, one mesh each, no
hierarchy, 12 materials. As it stands that is 102 draw calls per craft, and
sixty craft would be six thousand.

Every one of those 12 materials is a flat `baseColorFactor` — **the model
carries no textures at all** — so the colour can move into a vertex attribute
and the merge can be by *shading* rather than by colour:

| bucket | materials | shading | shared? |
|---|---|---|---|
| `hull` | Body, Hull, Dark, Lens, Label, PCB | metalness 0.30, roughness 0.62 | yes, one material for the whole fleet |
| `metal` | Copper, Silver, Blade | metalness 0.94, roughness 0.26 | yes |
| `glow` | Accent, LED, LEDRear | emissive | **no** — this is what takes the variant's accent |

Three draws for the airframe, four for the rotors (same geometry, same
material, one batch), one for the nav lights, and one to three for the rig.
About **10–14 draw calls per craft**, against 102 unmerged.

The model's **own normals are kept**. `computeVertexNormals()` here would throw
away the exported smoothing — the motor windings and the lens hood are visibly
faceted without it — and generate NaN on the model's degenerate triangles. The
fix matrix is a uniform scale plus a translation, which cannot invalidate a
normal, so there is nothing to recompute.

---

## Performance

Measured on the real GPU (AMD Radeon 860M, `ANGLE … D3D11`), headed Chrome 152
driven over CDP at 1440 × 900, `deviceScaleFactor 1`, five one-second samples
after a three-second settle, median reported.

**Read the control row first.** `buildings.html` is documented in
`docs/BUILDINGS.md` at **60 fps** in both of these poses on this same GPU. When
this table was taken it measured **16** and **15** — the box was carrying 87
Chrome processes, and every number below is therefore about **a quarter** of
what the same code reads on an idle machine. The absolute figures are not
comparable to `BUILDINGS.md`; the ratios in the last column are.

| state | draw calls | triangles | fps | × the control |
|---|---|---|---|---|
| **control** — `buildings.html` `__wide()` (documented 60) | 590 | 1.59 M | **16** | 1.0 |
| **control** — `buildings.html` `__stress(40,200,800)` (documented 60) | 914 | 1.42 M | **15** | 0.9 |
| drones line-up, 7 craft, all LOD0 | 308 | 0.41 M | **41** | **2.6 ×** |
| drones night, 7 craft working | 309 | 0.41 M | **31** | **1.9 ×** |
| drones `?stress=60`, 67 craft (27 LOD0 / 40 LOD1) | 841 | 1.26 M | **22** | **1.4 ×** |

### The gate is NOT proven

The brief's gate is **60 drones at ≥ 55 fps**. On this box that number could
not be measured, because the reference page cannot reach its own documented 60
either. What the table does establish: at the 60-craft gate the kit runs at
**1.4 × the control's frame rate while drawing 0.9 × its calls and 0.9 × its
triangles**, and the control's clean-machine figure is 60. That is consistent
with passing and it is **not a measurement of passing**. Re-run `bench` on an
idle machine before claiming the gate.

Reading a frame rate here honestly — the same three traps `BUILDINGS.md`
records, all of which cost time again in this pass:

- **A loaded box lies about everything.** Always measure the control in the
  same session. A drones page reading 32 fps looked like a failure until
  `buildings.html` read 18 in the same window.
- **`devicePixelRatio` is 2 on this display**, and a CDP device-metrics
  override only holds while that CDP session is open. Measure inside the
  session that set the override or the page renders four times the pixels.
- **Headless Chrome on this machine has no GPU** and falls back to SwiftShader.
  Screenshots are correct; its frame rate means nothing.

---

## The showcase page

| key | does |
|---|---|
| drag / scroll | orbit, zoom |
| `W A S D` | fly in the direction you are looking (`shift` to sprint) |
| `Q` `E` | up, down |
| `N` | day / night |
| `K` | working effects on / off |
| `L` | run the launch / dock sequence now |

The rightmost craft flies a looping **launch and dock** every 13 seconds: it
drops to the road, sits with its rotors idling, then climbs back to station.
Two things that animation exists to prove, neither of which a static shot can:
the rotors spool **down** on descent and up on the climb, and the downwash ring
appears on the way in rather than being painted on the ground.

Harness hooks, all on `window`: `__ready()` `__fps()` `__calls()` `__tris()`
`__stats()` `__night(t)` `__work(on)` `__wide()` `__lineup()` `__closeup(i)`
`__stand(x,y,z,tx,ty,tz)` `__cycle(p)` `__scene()`.

`__cycle(p)` pins the launch/dock loop at a phase — 0.85 is "on station", and
without it whichever craft is flying the cycle is halfway to the road in the
line-up shot and the row has a hole in it.

### Reference shots

Taken headed at 1440 × 900 over CDP against `?seed=1`. Console errors zero on
all four.

| shot | how |
|---|---|
| `docs/shots/drones-lineup.png` | `__lineup()` — all seven side by side, above the roofline |
| `docs/shots/drones-working.png` | `__cycle(0.85); __work(true); __stand(6,25.5,47,-4,20.2,30)` |
| `docs/shots/drones-night.png` | `__night(1); __stand(11,26.5,52,-4,20.8,30)` |
| `docs/shots/drones-stress.png` | `?stress=60`, `__stand(-5,27,64,-5,14,-140)` |

The line-up stands **30 m in front of the street and above the roofline**, not
over the road. Both were forced by the pictures: the near row of buildings sits
at `z = +13`, and a camera far enough back to frame seven craft ends up behind
it — four of the seven were completely hidden by an apartment block. And a
silhouette read against a brick facade is not a silhouette.

---

## The model

| | |
|---|---|
| file | `assets/drones/ornis.glb` |
| bytes | 235,608 (no compression needed — the 4 MB threshold is 17× away) |
| sha256 | `26a589ae842d12e43389b14acdca81ee42c8d746b3fcee3116deca0f5c592885` |
| source | `Desktop/projects/wdm/wild-digital-moments-site/img/aufbau/models/ornis.glb` — found locally, nothing downloaded |
| live page | <https://digital.wildmoments.at/ornis/> |
| generator | glTF-Transform v4.4.1 |
| extensions | `EXT_meshopt_compression`, `KHR_mesh_quantization` (both **required**), `KHR_materials_clearcoat` |
| triangles | 41,432 across 102 meshes |
| vertices | 27,840 |
| materials | 12, none textured |
| textures / images / animations / skins | 0 / 0 / 0 / 0 |
| up axis | Y · forward `+Z` (SensorBar at `+Z`, GpsPuck at `−Z`) |
| licence | Beri's own ORNIS demo model |

Recorded in `assets/manifest.json` as `model.drone.ornis` and in
`assets/CREDITS.md`.

**The GLB has no animations**, so nothing on it can be played — the rotors are
spun by transform and the props are real geometry, not a baked clip.

---

## HANDOFF

_Verified: 2026-09-07_

**State:** complete and self-contained. `drones.js` is a library nothing else
imports yet; `drones.html` is the only caller. `city.js`, `world.js`,
`globe.js`, `life.js`, `buildings.js`, `interior.js` and `server.py` were **not
touched** — other agents were editing them during this pass. `buildings.js` is
imported read-only by the showcase.

### Traps this pass paid for

- **One NaN vertex normal turns the entire frame black.** A welded triangle
  whose three corners land collinear has zero area, and `computeVertexNormals`
  normalises its zero-length face normal to NaN. In a direct render that is
  invisible. Through an `EffectComposer` it becomes a NaN pixel, the bloom pass
  blurs it across five mip levels, and the additive composite takes the whole
  image out — **with zero console errors and a perfectly healthy draw-call
  count**. Two hours. `decimate()` now sanitises non-finite normals and LOD0
  keeps the model's own.
- **`size` is already a uniform in `PointsMaterial`.** Adding
  `attribute float size` in `onBeforeCompile` is a hard `'size' : redefinition`
  link failure that takes down every `Points` object on the page. The attribute
  is called `navSize`.
- **Chrome caches ES modules hard.** `Network.setCacheDisabled` was set and a
  stale `drones.js` still ran three captures in a row. A fresh
  `--user-data-dir` is the only reliable fix.
- **Start the render loop only after `boot()` resolves.** Both kits bake into
  their own render targets during load, and a `composer.render()` interleaved
  with those bakes on one renderer is a class of bug that shows up as a blank
  sprite or worse. `buildings.html` already did it this way; copying the
  pattern rather than the code cost an hour.
- **A CDP device-metrics override dies with its session.** Measuring in one
  script and probing in another gave `devicePixelRatio` 1 and 2 for what looked
  like the same page.

### What integrating into `city.js` / `world.js` / `globe.js` needs

Nothing in those files was touched. This is what has to change in them:

1. **One kit, shared.** `DroneKit.load()` fetches, merges, decimates and bakes
   seven sprites through the renderer. Load it **once**, next to
   `BuildingKit.load()`, and hand the same instance around. Call it after the
   building kit and before the render loop starts.
2. **`city.js:makeDrone(id, label, isMain)`** (line ~1613) builds an
   `OctahedronGeometry` body, a torus ring and an additive underlight quad.
   Replace the body/ring/under trio with
   `kit.make(isMain ? 'orchestrator' : 'agent', { tier, seed })`. Keep the
   record object exactly as it is — `pos`, `vel`, `want`, `bank`, `workers`,
   `queue`, `trail` are all still right; only the three meshes change.
   `disposeDrone` (line ~3657) gains one line: `kit.remove(d.group)`.
3. **`city.js:makeWorker(craft, id, tool, fam, target, detail)`** (line ~1697)
   uses `FAM_LOOK` to pick one of three shared `workerMats`. Replace that map
   with a family → variant map — `write` → `worker.edit`, `read` →
   `worker.read`, `search` → `worker.search`, `shell` → `worker.shell`,
   `other` → `worker.net` — and call `kit.make(variant, { seed: hash(id) })`.
   The families already exist in `replay.js:FAMILY` (line ~25); no new
   classification is needed. `disposeWorker` (line ~3657 area) gains
   `kit.remove(w.group)`.
4. **Tags.** `city.js` parents a label sprite to the craft group at a hard-coded
   `y` (0.95 main / 0.62 worker / 0.34 tag). Parent it to
   `group.userData.tagAnchor` instead and drop the `y`; the anchor is already
   at the right height for each variant, including the net craft's mast.
5. **Trails.** `assignCraftTrail` and the ribbon in `stepDrones` read the craft
   group's world position. Read `userData.trailAnchor.getWorldPosition()`
   instead so the ribbon leaves the tail rather than the centre of mass.
6. **Emitters.** `scanBeam`, `searchCone`, `sparkBurst` and `shellBurst`
   (lines ~1812–1930) fire from the drone's own position. Either fire them from
   `userData.emitters[0].getWorldPosition()`, or drop them and use the kit's
   own by calling `userData.setWorking(true)` when the tool starts and `false`
   when it ends — `toolStart` / `toolEnd` are already the right hooks.
7. **Speed.** `stepDrones` integrates `d.vel` itself. Add
   `d.group.userData.setSpeed(d.vel)` once per frame and the craft banks; there
   is a `d.bank` field in the record that can then go.
8. **One `kit.update(dt, camera)` per frame**, and `kit.setNight(t)` wherever
   `city.js` already switches its own night. `kit.getHeight` should be pointed
   at the world's terrain probe in `world.js`/`globe.js` so the downwash lands
   on the ground and not at `y = 0`.
9. **Budget.** 10–14 draw calls and 41 k triangles per LOD0 craft. `city.js`
   caps at 26 craft + 120 workers; at that cap everything past ~120 m must be
   allowed to fall to LOD1, so `kit.update` needs the real camera, not a
   cached one.

### Reported, not fixed

- **`life.js` imports `MeshoptDecoder` and never calls `setMeshoptDecoder`**
  (line 35, with a comment at line 33 explaining why it is needed). Every
  meshopt-compressed model it loads should be failing. Not touched — not this
  pass's file.

_Re-verified 2026-09-08: the pass that closed the 2026-09-07 acceptance's client FAILs
reloaded this subsystem's pages with `Network`, `Log` and `Runtime` collectors
armed — 0 console errors and no response >= 400 — and nothing in this file
changed. See docs/TESTS.md table Q._

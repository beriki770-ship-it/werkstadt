# life.js — the living layer

_Verified: 2026-09-08_

Cars, people, animals and robots for the world. A standalone ES module with no
dependency on any other file here: give it a renderer, a scene, the roads and
the counts, and it populates them. No build step, Three.js 0.185.1 through the
same import map every other page here uses, models from `assets/manifest.json`.

> **Read this first (phase B, 2026-09-08).** Everything below that says
> *Hunyuan* describes the model pack this file was BUILT against, and that pack
> does not ship. The public tree fills the same `model.hy.*` manifest keys from
> Kenney's and Quaternius's CC0 kits, plus one model of the author's own; the
> catalogue in `life.js` is the current truth and `assets/CREDITS.md` is the
> current licence table. What still holds below: every rule about how the
> catalogue is USED — one mesh per model, `setMeshoptDecoder` or nothing, the
> three-tier ladder, the mixed herd, why nothing spins its wheels. What no longer
> holds: the per-model triangle counts (~50,000 became 80 to 3,238), the
> photogrammetry surface quality, the reference shots named `*-hy.png`, and the
> four subjects with no CC0 equivalent at all — the parrot, the chicken, the
> bus shelter and the playground, which now load nothing and fall back to drawn
> geometry. The measured comparison is in `docs/HANDOFF.md`, "What phase B did".

**Fourth pass, 2026-09-07 — the statics.** Hunyuan's second batch landed:
twelve un-rigged models — six animals, five plaza props and a bush — and they
are better meshes than anything rigged in this file. What changed:

- **The herd is MIXED now.** Two grazing animals in three are the Hunyuan mesh,
  standing still; the third keeps its Quaternius rig, because a rig is the only
  thing here that can walk. Judged, not asserted:
  [`docs/shots/life-herd-hy.png`](shots/life-herd-hy.png) is a cow at four
  metres and it is a photograph of a cow. See [The statics](#the-statics).
- **Squares have furniture** — a fountain, café tables, a playground, a kiosk
  and a bus shelter — and a **hedge** runs along the pavements and the pasture
  fence. Every one of them is triggered by something the HOST declares; the
  module places nothing on its own.
- **A dog walks with a pedestrian, a hen stands in the yard, a cat sits on the
  edge of the square.** All three counts arrive through the API like every
  other count in this file.
- **Two settings the rigid ladder did not have**, both measured rather than
  chosen: `noRaw` (this model never gets the 50,000-triangle tier) and
  `midBand` (how far out its middle tier reaches). Without them the pass cost
  **half the frame rate** at the stress counts. See
  [The statics' own two rungs](#the-statics-own-two-rungs).

**Third pass, 2026-09-06 — the animals, and the day people have.** The second
pass left four things named in its own Known limits, and this one closes them:
the animals were still the 2,000-triangle toys the pack ships, the pedestrians
had nowhere to be, no road here had a pedestrian zone in it, and two people at
a junction could still stand inside each other. What changed, in one line each:

- **Animals** are subdivided x2 at load with crease preservation and re-weighted
  skinning, smoothed across the pack's own material seams, given a procedural
  hide with fur shells and a dark glossy eyeball welded to the head bone, and
  the alpaca standing in for a sheep is reshaped into one. A cow is 2,450 ->
  **44,436** triangles on the near tier and unchanged on every other. See
  [The animal realism pass](#the-animal-realism-pass).
- **People have errands**: a round of home -> shop -> bench -> plaza -> home,
  path-found over the pavement graph, with lunch and evening peaks off the real
  clock, groups keeping formation, and zebra crossings that both halves respect.
- **`addPlaza(centre, r, { carsAllowed: false })`** cuts every road that crosses
  a pedestrian zone out of the lane graph.
- **Separation is measured, not asserted**: `__counts().overlap.perSecond` reads
  **0** over a settled sixty seconds of the showcase.

**Second pass, 2026-09-06 — the realism pass.** The first version was alive but
made of toys: the characters were a stylised pack with heads two and a half to
the figure and a cream decal for eyes, and the vehicles were three-thousand
triangle low-poly cars. Everything rigid is now a **Hunyuan** model — a real
photogrammetry-grade mesh with a baked albedo, a metallic-roughness map and a
normal map — and every character's rig is **rescaled at load** to adult
proportions and repainted out of a palette. What did not change: the data rule,
the LOD ladder, and the draw-call budget.

The bar it was written against, from the owner, verbatim: *"when the world
design is done, add life: cars, animals, people, robots etc."* — with one rule
that is a design constraint and not decoration:

> **Populations are driven by data.** Residents per settlement are a function of
> sessions, traffic on a road a function of that link's weight, robots are the
> live agents, parrots belong to the Wild Moments continent, sheep and cows on
> a field are the dormant projects.

The module **receives** every one of those numbers through `addRoads`,
`addPasture`, `addSkyBox`, `populate` and `setLiveAgents`. There is no random
population size anywhere in it. The only thing its seed decides is which model
wears which shirt.

- **Library:** `life.js` (4,217 lines) — imports nothing from this repo.
- **Showcase:** `life.html` + `life.css` (906 + 132 lines) — a `BuildingKit`
  street, a plaza, a **pedestrian zone across the side street**, a pasture,
  populated.
- **Run it:** `python server.py`, then <http://127.0.0.1:4949/life.html>
  (`?stress=1` builds the full target counts instead).

---

## API

```js
import { Life } from './life.js';

const life = await Life.load(renderer, scene, {
  manifestUrl: 'assets/manifest.json',
  getHeight: (x, z) => 0,     // the host's ground; everything stands on it
  seed: 7,
});
```

`load()` fetches **eighteen** models — nine skinned, nine rigid. Each skinned
one is reproportioned, merged down to a single geometry, decimated, and has two
vertex-animation clips and one sprite baked off it; each rigid one is decimated
into three detail levels. Everything after `load()` is synchronous, and it is
the slow call: on this machine it is about twenty seconds, most of it the
bisecting decimation of eighteen 50,000-triangle meshes.

| call | does |
|---|---|
| `life.addRoads(polylines)` | two lanes per road, one each way; vehicles follow them |
| `life.addWalkways(polylines, plazas, {width, bushes})` | the pavement graph pedestrians use; `width` is the host's real pavement width, `bushes` a hedge along it |
| `life.addPlaza(centre, r, {carsAllowed, seats, fountain, cafeTables, playground, kiosk, busstop})` | an open place; `carsAllowed:false` makes it a pedestrian zone and cuts the roads that cross it out of the lane graph; the five prop flags are the square's furniture |
| `life.addObstacles([{x,z,r} | {x1,z1,x2,z2,r}])` | the solid things the HOST placed — railings, fences, tree trunks — so the walk layer can route round them; circles and segments, any number of calls, all before `populate()` |
| `life.addPasture(polygon, {sheep, cows, horses, chickens, bushes})` | a grazing herd inside one field, its hens, and a hedge on its fence line |
| `life.addSkyBox(bounds, {birds, parrots})` | flocks, and the roosts they use at night |
| `life.populate({humans, workers, cars, robots, dogs, cats})` | the counts, from the caller's data; `workers` are pedestrians on the hi-vis rig (a crew), `humans` the muted resident mix |
| `life.park(type, x, z, yaw)` | one STATIONARY vehicle at a fixed spot — the site van standing AT the site; may be called any time, drawn as its own mesh, its box avoided by the crowd |
| `life.setLiveAgents([{id, label, pos}])` | maps agents onto robots, with their task tags |
| `life.setNight(t)` | `0` day … `1` night |
| `life.update(dt, camera)` | one call a frame: simulation, then LOD, then draw |
| `life.stats()` | every count and every derived number, for a HUD or a doc |

Order matters in two places now. `addRoads`, `addWalkways`, `addPlaza` and
`addPasture` all have to run **before** `populate()`, because `populate` builds
the instanced meshes from what is actually going to stand in them. And
`addPlaza` wants to be called **between** `addRoads` and `addWalkways`: after
the roads because it re-cuts the lanes against the zone, before the walkways
because that is the pass which wires it into the pavement graph. Calling it
later still works — the lanes are simply rebuilt — but a plaza declared after
`addWalkways` has no pedestrians in it.

### `addRoads(polylines)`

Each entry is a list of `[x, y, z]` points. The list may carry a **`weight`**
property — the link weight out of the real graph — and that is the only thing
that decides how much traffic a road gets:

```js
life.addRoads([
  Object.assign([[-96,0,0], [-40,0,0], [12,0,0], [96,0,0]], { weight: 4 }),
  Object.assign([[12,0,-66], [12,0,-20], [12,0,0], [12,0,30]], { weight: 1 }),
]);
life.populate({ cars: 30 });   // 24 on the main road, 6 on the side street
```

`{ points, weight }` objects are accepted too. Two roads that pass within 9 m of
each other at a **shared vertex** become a junction — so a crossing has to be a
point in both polylines, or the crossing is not found.

### `addWalkways(polylines, plazas)`

Polylines are pavements; points within 0.75 m of each other weld into one node.
A plaza is `{ center: [x,y,z], radius, seats: [[x,y,z,yaw], …] }` and is wired
into every pavement node within `radius + 6`. The third argument's `width` is
the pavement's real width in metres: walkers spread themselves across 70% of it
rather than in single file, and without the number the module has to guess —
at the old fixed ±0.9 m a third of the crowd walked on the grass verge. Two node kinds get behaviour:

- a node with only **one** link is a **door** — a pavement stub off the main
  run, which is what a front door is — and a pedestrian arriving at one stops
  and looks at it for a few seconds. Since the errands pass a door is also
  either a **shop** or a **home**: every third one in the list is a shop, which
  is roughly what a small town's high street has in trade, and the split is on
  the door ORDER and not on the seed, so the same street always has the same
  shops in it and two screenshots of it match;
- a **seat** is somewhere to sit. The host decides where a bench IS; the module
  decides who sits on it, and only one person per bench.

**Zebra crossings are found here**, at the end of the call, and they are the
only place the pavement graph reaches ACROSS the carriageway. One on each
approach to each junction: stand `CROSS_BACK` (11 m) back from the junction
along the road, then take the nearest pavement node on each SIDE of the centre
line. Without them the two pavements of a street are two disconnected
components and no errand can ever change sides —
`__counts().walk.components` is the number that says so, and it has to read
**1**.

### `addPlaza(centre, radius, opts)`

```js
life.addPlaza([12, 0, -50], 11, { carsAllowed: false, seats: benchRing });
```

Two jobs, and they are one call because they are one thing on the ground.

- **For people** it is a gathering place, wired into the pavement graph exactly
  like a plaza passed to `addWalkways` — every pavement node inside
  `radius + 6` gets a link to it — and its `seats` join the bench list.
- **For cars**, `carsAllowed: false` makes it a **pedestrian zone**: every road
  that crosses the circle is cut, analytically, at the two points where it
  enters and leaves, and only the stretches OUTSIDE become lanes. A road that
  runs into a market square now stops at the paving.

The cut is the honest half of the two things the brief allowed. Routing the
traffic *around* would need a road that goes around, and inventing one is
exactly the kind of geometry this module is not allowed to make up: it is handed
a network, it does not draw one.

The gate is one expression, and the showcase runs it: `__carsInZone()` lists
every vehicle whose position is inside a declared zone, and it is `[]`.

### `addPasture(polygon, counts)`

`polygon` is `[[x,z], …]` or `[[x,y,z], …]`. Animals are placed inside it by
rejection sampling and never leave it.

`chickens` are yard birds — a fenced field is a yard — and `bushes` is a hedge
spread by arc length along the polygon, which is the fence line. Both are
counts from the caller, like the herd.

### `addSkyBox(bounds, { birds, parrots, camera })`

`bounds` is `{ min:[x,y,z], max:[x,y,z] }`. Roosts are found by **raycasting
straight down the middle of everything already in the scene**, once, at this
call — so birds land on the roofs and tree crowns that are really there. Call
it after the buildings and trees are in.

**A third-pass fix (2026-09-06), found by the island integration.** The roost
raycast used a bare `new THREE.Raycaster()`, which has no `camera` — and
three's `Sprite.raycast` dereferences `raycaster.camera.matrixWorld`
unconditionally, so a scene with even one sprite in it (a name plaque, a drone
tag) threw and **aborted `buildLife()` before `populate()` ran**: no birds, no
parrots, no people and no cars, and nothing in the error says "sprite". Fixed
by handing the raycaster the host's own camera — `Life.load(renderer, scene,
{ camera, ... })` stores it, `addSkyBox`'s own optional `camera` overrides it
per call, and a throwaway `THREE.PerspectiveCamera()` stands in when neither is
given, so the call never throws for lack of one. The perch search also now
skips sprite hits outright (`!h.object.isSprite`, on top of the camera fix) —
a sign or a tag is not somewhere a bird can sit. Verified with a scene holding
a `THREE.Sprite`: `buildLife()` completes and `populate()` runs.

### `setLiveAgents(list)`

`[{ id, label, pos }]`. Robot *n* takes agent *n*: it hover-walks to `pos` and
carries `label` on a tag above its head. A robot with no agent stands idle;
calling this again re-targets them all.

### Tuning

`Life.load` takes four optional numbers, and they are the only dial between
frame rate and how close a real model gets — `maxSkinned` (default 40), `near`
(default 80 m), `shadows` (default 12) and `rigid` (default 8, how many
vehicles/robots may be at full 50,000-triangle detail at once). The performance
table below was measured against them. They are settings and not constants
because the host is the only thing that knows what its scene can afford.

---

## The models

Two families, and they are loaded and drawn in completely different ways.

### Skinned — Quaternius, CC0

Characters and animals. All CC0, from **Quaternius** (<https://quaternius.com>),
fetched by `python assets/fetch_assets.py --life`. Clip counts are read back out
of each `.glb`'s own JSON chunk by `validate_glb()` / `clip_names()`; a model
whose `animations` array is empty cannot pass as animated.

| key | file | clips | tris | far tris |
|---|---|---|---|---|
| `life.human.casualM` | Casual_Male | 17 | 2,202 | 838 |
| `life.human.casualF` | Casual_Female | 17 | 2,202 | 838 |
| `life.human.suitM` | Suit_Male | 16 | 2,228 | 830 |
| `life.human.workerF` | Worker_Female | 17 | 2,414 | 950 |
| `life.animal.cow` | Cow | 13 | **44,436** | 1,534 |
| `life.animal.horse` | Horse | 13 | **35,248** | 1,304 |
| `life.animal.dog` | Husky | 12 | **36,480** | 1,612 |
| `life.animal.sheep` | **Alpaca** | 13 | **39,476** | 1,330 |
| `life.animal.fox` | Fox | 12 | **35,112** | 1,736 |

The animals' near-tier counts are the third pass's, not the pack's: every one of
them is subdivided x2 at load and carries fur shells and eyeballs. The **far**
column is untouched, because the far tiers are decimated off the UNDIVIDED mesh
— see [The animal realism pass](#the-animal-realism-pass) for the before/after.

The humans are **a third of the triangles they were** (6,400 down to 2,200) and
that is not a decimation change: the pack's `Face` and `Hair` primitives are
dropped at merge time — see The reproportion pass below — and a generated hair
cap of about 180 triangles replaces the hair.

### Rigid — Hunyuan, generated

Everything with wheels, plus the agents' bodies and the perched birds. These are
`model.hy.*` rows in `assets/manifest.json`, one mesh and one material each,
**50,000 triangles apiece** with a baked albedo, a metallic-roughness map and a
normal map. `height` is what each is scaled to, from the brief. `face` is the
yaw that turns the model's own forward onto +Z and every one of them was
**measured off a top-down and a head-on render of that file**, not guessed.

| id | manifest key | height | faces | fitted L x W (m) | near / mid / far tris |
|---|---|---|---|---|---|
| `car` | `model.hy.car` | 1.45 | -X | 2.5 x 1.5 | 49,988 / 17,843 / 6,472 |
| `van` | `model.hy.van` | 2.20 | +Z | 5.0 x 2.1 | 50,000 / 17,970 / 6,466 |
| `pickup` | `model.hy.pickup` | 1.80 | -X | 4.7 x 2.4 | 49,892 / 17,795 / 6,436 |
| `bus` | `model.hy.bus` | 3.00 | +X | 8.2 x 3.1 | 50,050 / 21,776 / 7,957 |
| `tractor` | `model.hy.tractor` | 2.60 | +X | 4.1 x 2.5 | 49,950 / 21,812 / 7,879 |
| `bicycle` | `model.hy.bicycle` | 1.10 | -X | 1.9 x 0.9 | 50,000 / 11,970 / 4,500 |
| `robot` | `model.hy.robot` | 1.35 | +Z | 1.1 x 0.8 | 50,000 / 13,964 / 5,241 |
| `drone` | `model.hy.drone` | 0.34 | +Z | 0.7 x 0.6 | 50,000 / 7,941 / 3,497 |
| `parrot` | `model.hy.parrot` | 0.32 | +Z | 0.1 x 0.3 | 50,008 / 7,957 / 2,972 |

Three things about loading them are not optional:

- **They are meshopt-compressed.** `EXT_meshopt_compression`,
  `KHR_mesh_quantization` and `EXT_texture_webp`. Three handles the last two by
  itself; without `setMeshoptDecoder(MeshoptDecoder)` the loader throws
  *"setMeshoptDecoder must be called before loading compressed files"* and every
  vehicle is simply missing, with nothing else to go on.
- **Their attributes are quantised and interleaved**, so they cannot be scaled
  in place: `BufferAttribute.applyMatrix4` writes back through `setXYZ` without
  re-normalising, and the model silently folds in on itself. Every copy here is
  rebuilt through the accessors first (`toPlainGeometry`, `decimate`).
- **They are not centred on their own origin.** Both the turning pivot and the
  headlight placement need them to be, so `_buildRigid` recentres each one
  horizontally after the fit.

### Substitutions, and what still has no source

| asked for | what it is | why |
|---|---|---|
| a **sheep** | Alpaca, **reshaped** | Quaternius's Farm Animals pack has a sheep but it is **static** - no rig, no clips. The alpaca is the woolly grazer of the animated list, and since the third pass its neck is shortened by half AND bent forward off the withers, its legs are shortened by a fifth and its head thickened — an alpaca's tell is a long neck carried UPRIGHT, and a merely shorter upright neck still reads as a small llama. |
| a **cat** | **nothing — it is called a fox now** | No CC0 animated cat in any pack checked. The previous pass shipped the fox as `animal.cat`; a fox is not a cat, nothing in this module places one, and the honest name costs nothing. The key is `animal.fox`; the manifest row it loads is still `life.animal.cat`, because `assets/manifest.json` belongs to the fetch script. |
| **birds in flight** | **procedural - no model at all** | Nothing checked, CC0 or generated, is rigged to flap. The flying bird is geometry written in `_buildBirdMesh()`: a body wedge, two swept wings and a tail, with an `aSpan` attribute that is 0 on the body and 1 at a wing tip and the beat done in the vertex shader. One draw call for the whole sky. |
| **a perched parrot** | `model.hy.parrot` | An African Grey with a red tail, which is the species this world's parrots actually are. It swaps in the moment a parrot lands and swaps back the moment it takes off, so nothing static ever flies. |
| **spinning wheels, spinning rotors** | **nothing** | Every Hunyuan model is ONE mesh: the wheels are welded to the body and the drone's four propellers are welded to its arms. A wheel cannot be spun without cutting the mesh, and a fake disc over a modelled propeller is worse than a still one. They stay rigid. |

## The animal realism pass

The second pass's own Known limits said it: *"the animals are still the low-poly
pack. A cow at four metres is still a 2,450-triangle cow."* There is still no
CC0 realistic animated animal to swap in — checked again — and the local
generator that made the vehicles is static-only and out of quota, so the pack's
**rigs and its thirteen clips are kept** and the MESH is upgraded on the way in.
Five things, in `life.js` SECTION 4c, and the order they run in matters.

### 1 · Loop subdivision x2, with creases, on skinned geometry

Topology is built on a **position weld** and attributes are carried on the
original split vertices, so the pack's one-primitive-per-colour seams survive as
colour seams instead of becoming holes. An edge is a **crease** when it has one
adjacent face or when the two faces meeting on it turn by more than sixty
degrees; a crease edge takes the sharp midpoint and a vertex on exactly two
crease edges takes the crease rule, which is what keeps a horn a horn and a hoof
a hoof instead of melting both into the leg.

The part that is specific to a SKINNED mesh: every new vertex is **re-weighted
from its two parents** — weights summed per bone, the four heaviest kept and
renormalised, which is exactly what glTF's four-influence limit allows. Without
it a midpoint on the shoulder seam stays bound to the ribs and the leg tears the
flank open the first time a clip lifts it.

| model | pack | near tier, subdivided | shells | eyes | reshaped | **far tier** |
|---|---|---|---|---|---|---|
| `animal.cow` | 2,450 | **44,436** | 2 | yes | — | 1,534 |
| `animal.sheep` | 2,060 | **39,476** | 3 | yes | yes | 1,330 |
| `animal.dog` | 1,920 | **36,480** | 3 | — | — | 1,612 |
| `animal.horse` | 2,182 | **35,248** | — | yes | — | 1,304 |
| `animal.fox` | 1,848 | **35,112** | 3 | — | — | 1,736 |

Read off `__budget().models['animal.cow'].sub`, which reports `before` and
`after` from the geometry itself.

**The far column is the point of the table.** `decimate()` still runs on the
PRE-subdivision geometry, so the VAT textures, the far triangle counts and the
sprites are the same bytes they were: the ladder is untouched and only the tier
that is close enough to see the difference pays for it.

### 2 · Normals smoothed across the pack's own seams

`computeVertexNormals()` cannot do this — it averages per attribute vertex, so
the two sides of a material seam keep two different normals and the seam lights
as a crease down the flank where the light belly meets the back. `smoothNormals`
averages area-weighted face normals over the WELDED topology and writes the
result back to every duplicate.

### 3 · A procedural hide instead of a flat colour

Two octaves of value noise off the **rest-pose** `position` attribute — not the
skinned one, or the grain slides over the animal as it walks, which is the
loudest "this is a shader" tell there is — modulating albedo and roughness, plus
a large-scale blotch for the ones with markings. The pack ships **no UVs at
all**, so a texture would have to be unwrapped first; a hash and a trilinear
blend cost less than sampling one.

Every frequency is quoted in **cycles per metre of the finished animal**, not per
model unit, and that is not tidiness: this pack's export scale runs from 0.01 to
100 between files. The first version of the shader tuned the cow's markings
beautifully while the sheep, whose file is a hundredth of the size, landed
entirely inside one noise cell and came out a flat tan silhouette.

### 4 · Fur shells

Two or three copies of the mesh pushed out along their own normals, each
carrying how far out it is in an `aFur` attribute, alpha-noise-discarded in the
fragment shader and darker at the root than at the tip. Built from the
**undivided** mesh on purpose: a shell is fuzz and never shows a silhouette of
its own, so three shells cost 3 x 2,000 triangles rather than 3 x 32,000. Their
normals are smoothed on a copy first — grown off the pack's per-primitive
normals a shell splits along every material seam and sprouts two flaps where the
belly meets the flank.

Length is in **metres** and converted to model units by `baseScale`, which is why
the whole pass now runs AFTER the fit rather than before it. See the traps.

### 5 · Eyes

Two dark glossy spheres welded to the head bone with weight 1, so they follow
the skull through every clip for no extra draw call. They are placed on the
**pack's own eye decal** — the `Eyes_Black` / `Eye_White` primitives are found,
split left and right on the sign of x, and the ball is seated a third of a
radius INWARD along the decal's own average normal, so about two thirds of it
stands proud of the skull. Measured, not guessed. `aFur = -1` is the flag that
tells the shader this is glass: no noise, no fur, roughness 0.09.

The dog and the fox get none: their materials are named `Material.006` and
there is nothing to find. It is reported rather than faked, and neither is ever
placed.

### One attribute, three behaviours, one draw call

`aFur` is 0 on the skin, `1/n .. 1` on the shells and `-1` on an eye. That is
what keeps a subdivided cow with two fur shells and two eyeballs at **one draw
call**, exactly like the cow before it.

## The statics

Twelve `model.hy.*` rows generated on 2026-09-07, loaded and drawn by exactly
the same code as the vehicles: they carry a `tris` field, so `ModelEntry` sends
them down `_buildRigid()` and the loading path needed no change at all. What
they do not have is a skeleton — Hunyuan produces a mesh, not a rig — and the
whole design of this pass is built on the fact that most of what lives in a
town **stands still**.

| id | manifest key | height | faces | midBand | raw tier | near / far tris |
|---|---|---|---|---|---|---|
| `st.cow` | `model.hy.cow` | 1.55 | -X | 22 m | yes | 19,838 / 2,498 |
| `st.sheep` | `model.hy.sheep` | 1.05 | -X | 22 m | yes | ~20,000 / ~2,500 |
| `st.horse` | `model.hy.horse` | 1.70 | +Z | 24 m | yes | ~20,000 / ~2,500 |
| `st.dog` | `model.hy.dog` | 0.62 | +Z | 14 m | no | 8,971 → 5,000 / 1,600 |
| `st.cat` | `model.hy.cat` | 0.35 | +Z | 12 m | no | ~3,500 / ~1,100 |
| `st.chicken` | `model.hy.chicken` | 0.45 | +X | 12 m | no | ~3,500 / ~1,100 |
| `st.fountain` | `model.hy.fountain` | 2.20 | — | 40 m | no | 13,943 → 9,000 / 3,000 |
| `st.kiosk` | `model.hy.kiosk` | 2.60 | +Z | 40 m | no | ~9,000 / ~3,000 |
| `st.busstop` | `model.hy.busstop` | 2.50 | +X | 40 m | no | ~9,000 / ~3,000 |
| `st.cafeTable` | `model.hy.cafe_table` | 2.30 | — | 40 m | no | ~9,000 / ~3,000 |
| `st.playground` | `model.hy.playground` | 2.40 | +Z | 40 m | no | ~9,000 / ~3,000 |
| `st.bush` | `model.hy.bush` | 1.20 | — | 16 m | no | ~8,000 / ~2,000 |

`faces` was **measured**, not guessed: each of the twelve was rendered head-on
from +Z and from straight above, at one unit tall on a grid, and the direction
its nose or its opening points was read off the two images. The fountain, the
café table and the bush are radially symmetric and have no face to measure.

### The herd is mixed, and that is a rendering decision

The count is still exactly what the caller passed. What `addPasture` decides is
how each animal is DRAWN: **two in three stand** as a Hunyuan mesh, the third
keeps its Quaternius rig.

The reason for keeping any rig at all is that a rig is the only thing in this
file that can WALK, and a field where nothing ever moves is a diorama rather
than a pasture. The reason for standing the majority is that the Hunyuan mesh
is simply a better animal: real markings, correct anatomy, wool that reads as
wool. Put side by side in
[`docs/shots/life-herd-hy.png`](shots/life-herd-hy.png) — the Hunyuan cow in
the foreground, a Hunyuan sheep behind it — the gap is not close, and the
third pass's own subdivided-and-furred rig is the thing it is being compared
against. The rigs are kept because they move, not because they hold up.

### Where each prop is allowed to appear

Every one of these is triggered by something the **host** knows and this module
cannot. Nothing appears unless it was asked for — the data rule applies to a
fountain exactly as it applies to a population.

| prop | data trigger |
|---|---|
| `fountain` | `addPlaza(…, { fountain: true })` — a square with an open middle. Placed on the centre. |
| `cafeTables` | `addPlaza(…, { cafeTables: n })` — a square whose **trade** is café or restaurant. A ring at 55 % of the radius, so the middle stays walkable. |
| `playground` | `addPlaza(…, { playground: true })` — a **residential** square in a village or a town. One object at one bearing, backing onto the rim. |
| `kiosk` | `addPlaza(…, { kiosk: true })` — a market square in a settlement of **town class or larger**. Placed at the ROAD edge, facing the traffic. |
| `busstop` | `addPlaza(…, { busstop: true })` — a settlement large enough to be on a **bus route**. Also at the road edge, four and a half metres round the rim from the kiosk. |
| `bush` | `addWalkways(…, { bushes: n })` along the pavements and `addPasture(…, { bushes: n })` along the fence. Spread by arc length; planted on the side of the line that is FURTHER from the nearest lane, and never inside a declared square. |
| `chickens` | `addPasture(…, { chickens: n })` — a **hamlet or village** with a yard. A fenced field is the yard. |
| `dogs` | `populate({ dogs: n })`, and only where `walk.shops` is non-empty — a dog on a lead is a person going somewhere, and on a pavement graph with no destinations it would be a dog trotting in circles. |
| `cats` | `populate({ cats: n })`, and only where a plaza was declared. Placed on the square's EDGE: the middle is where the people are, and a cat is the animal that has decided against them. |

The showcase declares them the way a small town would: the leisure plaza gets
the fountain and three café tables, the market square gets the kiosk, the
shelter and the playground, the pavements and the pasture fence get the hedge,
the pasture gets six hens, and the street gets three dogs and two cats.

### What each HOST reads the trigger off (2026-09-07)

The table above is stated in a settlement's terms. The three pages that own a
settlement have different facts in front of them, so this is the mapping —
written here and not only in the code, because two hosts quietly disagreeing
about what a "town" is is exactly the drift the data rule exists to stop.

| trigger | `globe.js` (a settlement on the planet) | `world.js` (the harbour, one island) | `city.js` (a project city, one street per session) |
|---|---|---|---|
| town class or larger | `p.cls` is `town` or `city` — `classOf()`'s own boundary, ≥ 1,000 tool calls | the island's tool calls summed over every project, ≥ 1,000 (`LIFE_TOWN_CALLS`, the same number) | the PROJECT's tool calls summed over every street, ≥ 1,000 — the same number again |
| `fountain` | town class or larger, on the settlement's own `p.plaza` | the Boards fortress court, when the island is town class | town class or larger, on the forecourt square where the avenues begin |
| `kiosk` | town class or larger | the same court, same condition | the same square, same condition |
| `busstop` | town class or larger **and** at least one non-sea road arrives (`plan.roads`) — the arriving roads are the only thing that says a place is connected | town class **and** `/api/world`'s `roads[]` (the project graph) is non-empty | town class **and** more than one avenue — a second street is this city's version of "a road arrives" |
| `cafeTables` | `town.trade.type` is `CafeOrCoffeeShop`, `Restaurant` or `FoodEstablishment` → 3 (one Hunyuan table is a terrace of one) | **none** — the only square is the fortress court, whose trade is nothing; the eateries are quarters on the quay and no quarter has a square | **none** — a project has no trade classification at all |
| `playground` | a `village` or `town` with **no** trade landmark — on this planet, a place people only live in | **none** — a fortress court is not a residential square | **none** — the forecourt is where the orchestrators dock, which is a place of work |
| `bushes` (walkways) | one per 18 m of the settlement's real pavement length, capped 26 | one per 18 m of the quay + village paths, capped 40 | one per 18 m of the active avenues' own kerbs, capped 26 |
| `bushes` (pasture) | one per 22 m of the field's own perimeter, capped 18 | one per 22 m of the quarry / steppe rectangle's perimeter, capped 16 | **none** — a project has no field |
| `chickens` | `hamlet` or `village` only — a fenced field beside five houses is a yard, the same field beside a city is not; `sessions / 8`, 3 to 8 | **none** — the quarry and the orphan steppe are not yards | **none** — no field, so no yard |
| `dogs` | `humans / 12`, and life.js drops them all where the pavement has no shops | the same ratio on the island's capped resident count | the same ratio, summed over the settled avenues — a construction site gets none |
| `cats` | 2 per plaza rim (`humans / 25`, 1 to 3), and none without a plaza | 2 per square found by `fortressCourt()` | `humans / 25`, 1 to 3, on the one forecourt square |

### The city's own row: two regimes, not one (2026-09-07)

`city.js` is in the table above now, and it is the one host whose POPULATION is
not a single kind of place. A street there is one SESSION, and a session is
either still being worked on or it is finished:

| | crew street | settled street |
|---|---|---|
| when | the session is live, or its last event was inside the city's own 30-minute TRON permanence (`PERMANENCE_MS`) | anything older |
| `humans` | `clamp(inFlight + editsInWindow, 2, 8)` — one per tool call still running, one per Edit in the window | `clamp(round(sqrt(tools)), 1, 12)` |
| which model | `human.worker` for every one of them | the module's own four-model mix |
| `cars` | `clamp(ceil(crew/3), 1, 3)`; the ROAD WEIGHT is `1 + inFlight + editsInWindow`, so the deck deals its vans to the busy street | `clamp(round(edits/12), 0, 4)`; weight `1 + sqrt(tools)/3` |
| props | orange cones round the printing footprint — **drawn by `city.js`, not by this module**: a traffic cone is eight triangles and the whole 50,000-triangle manifest-and-ladder path would cost more than the cone does | the plaza furniture and the hedges above |

**The scale.** `city.js` works in its own units, not metres, so the whole layer
sits in one group scaled by `LIFE_SCALE` = **0.23 units per metre** — derived
from the two things in that city that are real street furniture drawn at street
size (the 2.2-unit carriageway and the 1.35-unit lamp post, which agree inside
3%), not from the building floor, which is one Edit and not a storey. The full
derivation and the measurement that rejected 0.10 are in `docs/HANDOFF.md` →
CITY-LIFE-DOC.

**Three things that city needs from this module**, none of them written yet and
all of them worked around today: `populate({ humans, mix })` so a crew does not
have to be pre-seated through `_pedestrian()`; `reportError()` staged on
something other than a robot, since every host that draws its own agents passes
`robots: 0`; and `park(type, x, z, yaw)` for a site vehicle that stands at the
site. Details, with the workaround each one replaces, in CITY-LIFE-DOC.

### A dog is carried, not animated

`st.dog` is the one static model here whose POSITION moves. Each dog is bound
to a pedestrian at `populate()` time and drawn every frame at that walker's
own position, offset to their right or left and rotated to their heading. The
mesh never changes pose. At a dog's size on a street that is indistinguishable
from a walk cycle and it costs one instance instead of a rig, a VAT texture and
a sprite. A dog standing still while the street walks past it would be the one
animal on the page that reads as furniture.

### The statics' own two rungs

The rigid ladder — raw file inside 22 m for the nearest eight, welded `near`
copy inside 40 m, welded `tris` copy beyond — was solved for **vehicles**, and
it does not survive being handed seventy hedges. Two settings were added, and
both of them are measurements:

- **`noRaw`** — this model never gets the raw 50,000-triangle tier; its closest
  InstancedMesh is built on the middle geometry instead, and it does not queue
  for the eight-slot budget either. Everything except the three grazing species
  has it.
- **`midBand`** — how far out the middle tier reaches, per model. `RIGID_MID`'s
  forty metres was solved for an eight-metre bus. A 1.2 m hedge at forty metres
  is a few dozen pixels.

**What they are worth, paired A/B in one window** (the machine's absolute frame
rate swung 25-60 fps inside an hour with other agents on it, so every row here
is the same pose measured against the unmodified build minutes apart):

| build | stress pose | ÷ its own control |
|---|---|---|
| statics with no ladder settings at all | 16.0 fps · 12.2 fps | **0.51 · 0.56** |
| the LOD budgets cut, nothing else | 14.0 fps | 0.48 |
| `noRaw` + the budget exclusion | 30.3 · 31.2 fps | **1.08 · 0.93** |

The middle row is the interesting one: cutting the triangle budgets did almost
nothing, because **the cost was never the triangle count**. Seventy hedges
standing beside the camera were taking every one of the eight raw-tier slots —
at fifty thousand triangles each, plus a shadow-map copy of each — and pushing
the traffic they were meant to share the budget with out to the welded tiers.
The fix is not fewer triangles, it is a hedge that was never eligible for that
tier in the first place.

`midBand` came out of the one pose that looks at thirty statics at once: with
the herd and the fence hedge both holding the middle tier to forty metres, the
**pasture** pose read 32.3 fps against a 55.7 control.

### What the models actually look like

Read off a head-on render of each at one unit tall, and off the reference
shots. Honest, including the parts that are not good:

- **The six animals are the best meshes in this file.** The cow has real
  Fleckvieh markings, a wet muzzle, horns and a glossy eye; the sheep has
  modelled fleece rather than a noise shader; the chicken, the cat and the dog
  are clean. No baked-in ground plane, no floating fragments, no reversed
  normals in any of the twelve.
- **The bus shelter's glazing is opaque white**, not glass. The generator
  modelled a frosted panel, so the shelter reads as a solid box from the side.
  It is the one prop that does not survive being looked at closely.
- **The café table ships one parasol, one table and two chairs.** It is a
  terrace of one, so three of them are placed rather than one.
- **A decimated bush speckles.** Foliage is the worst case for a weld: at 2,000
  triangles the silhouette breaks into confetti, which is why the near budget
  is 8,000 and the middle tier stops at sixteen metres rather than forty.
- **A photogrammetry animal welded to 20,000 triangles tears.** White and green
  rips down the flank and across the face — the UV-seam damage the vehicle
  ladder documents, and much more visible on an organic surface than on a car
  door. It is why the three grazing species keep the raw tier.

## The reproportion pass

The first version's verdict, verbatim: *the Quaternius humans are chibi
cartoons, huge heads, dot eyes*. That is measurable, and the measurement is what
this section is about.

`window.__counts().proportions` reports, per human model, **how many heads tall
the figure is** — read off the posed rest pose by pushing every vertex through
its own bones and taking the Y extent of the ones whose dominant bone is `Head`
against the Y extent of all of them. Same instrument before and after.

| model | before | after | head, metres |
|---|---|---|---|
| `human.casual` | **one head in 2.52** | **7.64** | 0.236 |
| `human.casualF` | 1.87 | 7.64 | 0.222 |
| `human.suit` | 2.52 | 7.64 | 0.238 |
| `human.worker` | 1.77 | 6.77 | 0.254 |

A real adult is about seven and a half. The pack shipped at **two and a half**,
which is not a stylisation, it is a caricature — and it is the single reason a
crowd of them read as figurines however well it was lit.

### How the rig is reshaped without losing the clips

Every clip in this pack animates **translation, rotation AND scale on all 23
bones**, so an edit written into the bind pose alone is overwritten on the first
frame of `Walk`. Each entry in `PROPORTION` is therefore applied **twice**: once
to the bone's rest transform and once to every clip's own track for that bone
(`retargetClip`). The inverse bind matrices are deliberately **not** recomputed
— they stay the original rest pose, and that is exactly what makes the mesh
deform instead of merely following the bones.

Three kinds of edit, because they do different things to a limb:

| kind | what it does | used on |
|---|---|---|
| `scale` | uniform, resizes the part around its own joint | head, neck, hands, feet |
| `scaleY` | along the bone's own axis (Blender's +Y): **length**, no fattening | torso, shin |
| `pos` | the bone's offset from its parent, i.e. the length of the parent limb; skinning blends across the joint so the segment stretches smoothly | forearm, hand, knee |

Names are matched with the punctuation stripped, because `GLTFLoader` runs
`PropertyBinding.sanitizeNodeName` on the way in and Blender's `LowerArm.L`
becomes `LowerArmL` while the raw glTF still says `LowerArm.L`.

**Two numbers in the brief could not both be met.** It asked for a head bone at
×0.62 *and* a finished ratio of about one in seven and a half. Measured, ×0.62
lands at **3.73** — because the head starts at 2.5 to the figure rather than the
4 or 5 a normal stylisation uses. The ratio is the half anyone can check on the
screenshot, so the ratio is what is honoured: **0.26** is what reaches it, and
the number was solved from the measurement rather than picked. Every other
factor is the brief's own: neck ×0.9, torso ×1.05, arms ×1.08, legs ×1.12,
hands and feet ×0.85.

**The legs are the awkward part of this rig.** `Foot.L` and `Foot.R` are IK
targets hung off the ROOT bone, not off the shin, so lengthening the leg does
not move them. The shin has no child bone either, so its length is a `scaleY`
and not an offset. `reproportion()` measures the thigh off the rig itself,
works out how far the ankle ends up (`2 × thigh × (leg − 1)`), subtracts that
from both foot targets in the rest pose and in every clip, and lifts the
**armature node** — the one object in the hierarchy no clip touches — by the
same amount, so the soles still land on y = 0.

### The palette, and the dot eyes

The pack ships one flat colour per material, its skin is **0.013 linear** — near
black — and its eyes are a separate cream `Face` primitive. Both that and `Hair`
(a low-poly shell the size of the skull, the blob that reads as a wig at twenty
metres) are **dropped at merge time**, so they never reach the merge, the
decimation or either baked texture.

Colour does not come from the vertex any more. Each vertex carries a **class**
(skin, shirt, trousers, belt-and-shoes, hair, other) in an `aCls` attribute and
each character carries a **palette row**, and the shader looks the two up in a
6 × 24 texture: **four skin tones × six wardrobes**. That is what buys the
variety out of one geometry and one draw call — baking colour in would need
twenty-four copies of the mesh. The texture's **alpha channel carries that
class's roughness**, so cloth sits at 0.74–0.78 and skin at 0.55 without a
second material.

The palette row reaches the shader two ways, and they have to agree or a
character would change clothes at the 80 m line: a per-instance `aPal`
attribute on the far tier, and a `uPalRow` uniform on the near one, where each
pooled skeleton owns its own material. Forty materials, one program, no extra
draw calls.

The hair is a **generated cap**: a squashed half-sphere sized to the head's own
measured box — the SKIN-class vertices only, or it would come out the size of
the wig it replaced — welded to the head bone with weight 1 and merged straight
into the geometry, so it inherits the skinning, the palette and the single draw
call.

## How it draws three hundred people

Every character model is loaded **once** and turned into three things.

### 1 · One geometry, one material

The pack ships one primitive per **material** — a human is six meshes: skin,
shirt, pants, belt, face, hair. Drawn as they come, forty near characters is
240 draw calls before anything else in the frame. So each model is merged into
a single geometry whose material colours have been baked into a `color` vertex
attribute, exactly the trick `buildings.js` uses on a facade. One character is
then **one draw call**.

The robot needed more than that: it is three skinned meshes plus **fifteen solid
pieces parented to bones**. `rigidToSkin()` folds those in by writing
`skinnedInverseWorld · mesh.matrixWorld` straight into the vertices with weight
1 on the parent bone — which is exactly what the skinning shader would compute
for them at the bind pose. Before that fix the robot was 18 draw calls near the
camera and, worse, only 544 of its 3,238 triangles reached the animation bake,
so a robot at ninety metres was a floating head and a pelvis.

### 2 · A decimated copy

A Quaternius human is 8,800 vertices. Three hundred of them is 1.3 M triangles a
frame for people twenty pixels tall. `decimate()` welds vertices onto a grid;
the cluster key carries the vertex's **dominant bone** as well as its cell,
because without that the inside of an upper arm welds to the ribs it touches in
the rest pose and the arm tears open the moment the clip moves it. Humans go
6,492 → 1,548 triangles.

### 3 · A vertex-animation texture, per clip

`bakeVat()` samples a clip at 20 poses; at each pose every vertex is pushed
through its own bones on the CPU once and written into a float texture, with a
second texture for the normals. At draw time the vertex shader reads its own
position out of that texture at a time the **instance** chooses, so five hundred
characters on one InstancedMesh can each be at a different point in the same
walk cycle for the cost of one draw call.

Normals are baked rather than left in the bind pose: without them a walking
figure's arms light as if they were still hanging at its sides, which is the
"sliding box" tell this tier exists to avoid. After decimation both textures
together are 0.6–1.1 MB per model.

Two clips per model is the whole far-tier vocabulary — **walk** and **idle**. A
person at ninety metres is walking or standing, and a third texture buys nothing
anybody can see.

### 4 · A sprite

One head-on render into a 64 × 128 transparent target, alpha-tested on a
camera-facing quad.

### The ladder

| tier | distance | what it is | cost |
|---|---|---|---|
| 0 | < 80 m, nearest 40 | a real `SkinnedMesh` with an `AnimationMixer`, cross-fading between clips | 1 draw call each; the nearest 12 also cast a shadow |
| 1 | < 400 m | one InstancedMesh per model per clip, positions and normals out of the VAT | 2 draw calls per model, whatever the population |
| 2 | beyond | one InstancedMesh of a baked sprite per model | 1 draw call per model |

### The rigid ladder

Vehicles used to sit outside the ladder entirely — a 3,000-triangle car can be
drawn at any distance. A 50,000-triangle one cannot: thirty of them is 1.5 M
triangles a frame, and with the shadow pass, three million.

| tier | distance | what it is |
|---|---|---|
| near | < 22 m, and only the nearest **8** rigid models on screen | the file the generator produced, untouched |
| mid | < 40 m | welded down to 12,000–22,000 triangles |
| far | beyond | welded down to 3,000–8,000, and **casts no shadow** |

Three levels and not two because one middle level cannot be both: at 12,000
triangles an eight-metre bus came out visibly faceted at four metres, and at
35,000 thirty vehicles cost 1.5 M triangles. The `8` is a budget of the same
shape as `maxSkinned` — the cut is the CLOSER of the 22 m band and the eighth
nearest thing, from one partial sort of about a hundred distances a frame.

An InstancedMesh whose `count` is 0 issues no draw call at all (three's
`WebGLBufferRenderer.renderInstances` returns early), so twenty-seven meshes
cost what the two or three tiers actually in use cost.

**Welding a textured mesh needs a UV bucket in the cluster key**, or a seam
smears across half the bonnet. Its size is the whole trick and it is not a free
choice: these meshes carry 36,000 vertices on a 1024 atlas, one vertex every
five texels, so a bucket FINER than that gives every vertex a key of its own and
nothing welds — set to 1/256 it left a 50,000-triangle car at 35,000 and the
decimation looked like it had silently stopped working. **1/32** is far coarser
than the vertex spacing and far finer than the gap between two UV islands.

`decimateTo` also **brackets and then bisects** for the cell size rather than
taking the first one that fits. Without that, "happens to fit" was 11,800
triangles against a target of 22,000 — half the budget thrown away, and a bus at
thirty metres with its windscreen pillars welded into the glass.

---

## Behaviour

| who | does |
|---|---|
| pedestrians | run a **daily round** — leave home, stand at a shop door, take a bench, linger in the plaza, go home — **path-found** over the pavement graph, not drifted; each on **its own line** across the host's declared pavement width; **never inside 0.6 m of each other**, measured; **about a third walk in twos and threes and keep formation**; **wait at a zebra until the lane is clear**; lunch and evening peaks off the **real clock** |
| vehicles | keep their lane, slow behind the car in front (full speed at 10 m of clear road, stopped at 6), stop at a red signal, **yield at a zebra somebody is standing at or on**, **indicate 25 m out and turn onto the crossing road**, run headlights and tail lights at night, and **never enter a pedestrian zone** |
| herds | graze (`Eating`), then amble to somewhere else inside their own field and graze again; **after dark they lie down** and play the pack's head-down idle |
| birds | Reynolds flocking against their own kind, banking into the turn; at night they go to a roost found by raycast and sit on it |
| parrots | the same, plus every second one keeps station on its mate — they fly in pairs; **on landing the six-triangle bird is swapped for the real parrot model**, seated by its FEET (the tail hangs below the toes, so seating it by its bounding box leaves it floating 13 cm over the branch) |
| robots | a 3.5 cm suspension bob and a couple of degrees of nose-down while driving, walk to their agent's position, carry the agent's task tag; **a robot with an agent also carries a drone** station-keeping 2.35 m above it |

No sound, anywhere.

### The day a pedestrian has

The first version had no errands: a walker picked a neighbouring node at random,
which over a pavement graph produces drift, and drift is not a life. This one
gives every walker a **round** — home, a shop door, a bench, the plaza, home —
and the round is what makes the same hundred and twenty people read as a town
rather than as a screensaver. Three things about it are load-bearing.

**It uses a real path.** An errand is a named destination, so the walker has to
GET there and not merely toward it. `_path()` is a breadth-first search over the
pavement graph — ninety-nine nodes, run once per errand and not once per frame.

**It is timed off the real clock.** `clockHour()` reads `new Date()`: lunch pulls
the crowd toward the shops between half eleven and quarter past two, the evening
pulls it to the plaza and the benches. A page open at one o'clock should show the
street at one o'clock. `setNight()` still forces the evening half, so a night
screenshot is a night screenshot whatever the hour.

**A follower does not navigate.** Two people who each solved the graph would
split at the first fork and rejoin a hundred metres later, which is the one thing
a pair visibly never does. A follower keeps station beside and a step behind its
leader in the LEADER'S frame, so the formation turns with it, walks 15% faster
so a corner does not stretch the pair out, and mirrors the leader's pause — but
stands beside the bench rather than sitting on it, because only one person fits
on a seat.

`__probe().errands` is where each person is HEADING and `__probe().doing` is what
they are doing this instant. A settled minute of the showcase reads, at 22:13:
`{ shop: 24, bench: 25, plaza: 26, home: 45 }` and
`{ walking: 97, atDoor: 3, sitting: 5, lingering: 10, waitingToCross: 0, onACrossing: 5 }`.

**The dwell times are not decoration.** The plaza is sixty metres off the street
and the walk there is the best part of a minute; at the first pass's ten to
thirty seconds on a bench, twenty-four people were heading for twelve benches
and the square photographed **empty**. A bench is now 25-70 s and the plaza
20-50 s, and the reference shot has twelve people in it.

**Every walker used to start the round at the SAME point in it.** `_pedestrian()`
seeded every one of the hundred and twenty with `errand: 'home'`, so the very
first `_nextErrand()` call — frame one, path empty — sent all hundred and
twenty toward a shop at the same instant: a synchronised wave that then took
the round's own length, several minutes, to reach the far side (the plaza) for
the first time. `__probe().errands.plaza` read 0 for as long as the wave
hadn't arrived, whatever the window a harness measured it over — the level-up
pass's own E3 caught exactly this, at 0 both 0 s and 60 s after load. Each
walker now seeds onto a RANDOM stage of the round (`ROUND_SEED`), so the
population starts pre-spread across home/shop/bench/plaza the way a page
opened mid-day actually is. On the showcase this puts the plaza at **22-27**
within the first 60 s of load, not the tenth minute.

### The zebra, which is one object with two halves

A crossing is where the pavement graph reaches across the carriageway, and both
sides read the same record:

- a pedestrian at the kerb sets `waiting` and steps off only when **no moving
  vehicle** is inside 9 m of the crossing;
- a driver inside 15 m of a crossing with anybody waiting at or standing on it
  eases off — but **inside 5 m it is going through**, and that is what stops the
  two halves deadlocking. A pedestrian waiting for a car that is waiting for the
  pedestrian is the failure every naive version of this has; here the car that
  is too close to stop simply passes, and the one behind it stops.

Only MOVING traffic counts in the pedestrian's test, or a car that has stopped
FOR this crossing becomes the reason nobody uses it.

### Pedestrian zones, and what a lane is cut against

`addPlaza(..., { carsAllowed: false })` puts a circle on the ground that the lane
graph is not allowed inside. `_openStretches()` intersects every road segment
with every zone analytically and keeps the pieces outside, so a lane ends at the
kerb of the paving rather than a metre inside it. In the showcase the side
street's far end runs into a market square and stops: six lanes where there were
four, because the cross street is now two stretches.

### Separation, and why it is written on the positions

A pedestrian here has no velocity to steer — it has a target node and a line
across the pavement — so `_separate` pushes overlapping pairs apart directly.
The gate for the third pass is a NUMBER and not a look: `__counts().overlap`
reports how many pairs are inside 0.6 m of each other **on the positions the
frame drew**, accumulated into a rate. Over a settled sixty seconds of the
showcase, 2,416 frames, it reads **0.000 pairs a second, peak 0**. Four things
had to change to get there and every one of them was a bug the old prose hid:

- **It runs after the movement, not before.** Fixing the positions and then
  walking everybody a centimetre into each other is why the old version could
  look settled and photograph as two people sharing a coat.
- **Paused people are pushed too.** The old rule — sitting and paused push but
  are not pushed — left two people who had stopped at the same front door
  standing inside each other for as long as they stood there, which on this
  street was forty of the hundred and twenty. Somebody at a door shuffling
  thirty centimetres to make room is what a person does; only a SITTER is
  immovable now, and no two sitters can overlap because no two share a seat.
  People at a door also stand on a small **ring** round it, at an angle taken
  from their own id, so eight people at one shop are eight places and not a knot.
- **The push is asymmetric, by id.** Two people who each give way by half do the
  pavement dance. The lower id holds its line and the other goes round: 0.2 /
  0.8, a priority rule rather than a physics one, and it is what unpicks a
  four-way crowd at a junction.
- **It converges, and then it checks.** A sweep is Gauss-Seidel — fixing (i, k)
  can push i into a j already walked past — so six sweeps still left a pair a
  frame touching. The loop now counts what is still overlapping, fixes exactly
  that, and looks again, up to fourteen rounds.

The sweeps run over a **uniform grid one personal space wide**, so nothing
further apart than 0.6 m is ever tested: at the stress counts that is about
2,000 pair tests a sweep instead of 45,000, which is what makes running the
sweep up to twenty times on a bad frame affordable at all.

**The level-up pass found two more residuals, both invisible to the instant
reading and both real.** `__probe().overlap.perSecond` accumulates over a
window, and a window catches things a single glance at `now` never will:

- **The fourteen-round guard could report a pair it had just fixed.** The loop
  measured, and if still overlapping, fixed and moved to the next round — but
  on the FOURTEENTH round it fixed and then exited on the round count, never
  re-measuring the position its own fix() call had just moved. `o.pairs` then
  reported the state from BEFORE that last fix, not after — a phantom pair,
  resolved on screen but counted in the rate. One more measurement after the
  loop, only when the loop actually ran its full fourteen rounds, reports what
  is really still overlapping instead of what was a moment before the fix.
- **Two people both walking to the same graph node converge on top of each
  other regardless of their lane offset.** `a.off` keeps a walker off the
  pavement's centre line, but it is a fixed, per-person value drawn once at
  spawn — nothing stops two people's offsets from being drawn close together,
  and the offset is measured perpendicular to the line toward a SINGLE shared
  target point, so as both approach it their lines converge no matter how far
  apart the offsets started. `_separate` was fighting that convergence every
  frame at the pinch and never fully winning it. The offset now fades to 0
  over the last 2.5 m of a hop (`OFF_TAPER`) — a walker narrows to single file
  on the approach the way a real pinch point makes anyone do, instead of
  holding a lane width all the way into a point.

Measured on the showcase after both: two clean 60 s windows read **0.000
pairs a second** back to back, and a 216 s window (peak 1) reads **0.019/s** —
against 0.05-1.49/s, peaks 1-4, before this pass. Measured by calling
`life.update(dt, camera)` directly from the console rather than waiting on a
wall clock — see Known limits for why.

### Turning is a lane change, not a steering problem

The lanes already carry the geometry, so a turn is: pick, on approach, one of
the lanes that also meets this junction (`lane.stops` already records which),
and on green inside the box hand the car that lane at the arc length the
junction sits at, plus four metres so it does not immediately re-test the same
stop from the wrong side. The indicator is decided **once** per approach and
remembered, or the lamp flickers between sides as the car closes; it runs day
and night, because an amber flash is a signal and not a lamp.

The one thing that had to move for this: after a turn the car is advanced along
`v.lane` and not along the `lane` the loop is iterating, or it is put straight
back into the middle of the junction it just left.

### Robots hover less than they used to

The Hunyuan robot **runs on two wheels**. The old 6 cm of lift plus 6 cm of sine
was right for a floating machine and is the one thing about a wheeled one that
would read as a bug, so what was a hover is now suspension travel: 3.5 cm of
sine, no lift, and a small nose-down lean while driving.

### The junction is a signal, not a lock

Two earlier versions gave the junction to whichever car claimed it first, and
**both deadlocked within fifteen seconds** — every vehicle on the page reading
0.00 m/s. The reason is the same both times: the holder of a lock can be stopped
for a reason that has nothing to do with the junction (the car in front of it),
and then nobody can ever take it.

A signal cannot deadlock, because it is a function of the clock: the light goes
green whether or not anything moved. Each road that meets a junction gets nine
seconds in turn. Queues form on the red and drain on the green, which is what a
junction is supposed to look like anyway.

The other half of that bug is one comparison. `gap >= 0` is load-bearing in the
stop test: without it the car that has just **cleared** the junction is still
inside the check window with a negative gap, reads "the light is red and I am
under six metres from it", and stops dead on the far side — which walls the
crossing in from the other direction and jams the queue behind it.

---

## Performance

Measured on the real GPU (AMD Radeon 860M, `ANGLE … D3D11`), headed Chrome at
1440 × 900, `--force-device-scale-factor=1`, `__fps()` read after letting the
rolling 90-frame average settle, then read a second time four seconds later.
60 is the vsync cap.

**Read the control row first.** `buildings.html __wide()`, whose own doc records
**60 fps** on this GPU, read **22.8-30.7** in the two rounds below and
**49.5-54.5** in a third round twenty minutes earlier. The machine was carrying
other work at **36-62 %** CPU throughout. Every absolute number here is
therefore a fraction of what the same code does on a quiet box, and the honest
comparison is each row against the control taken a minute either side of it.

Both `life.html` rows are taken at the **reference-shot poses**, which is what
the previous pass's table used too — its control row's 590 / 1.59 M reproduces
exactly, and so do its draw calls and triangles.

| state | draw calls | triangles | fps (2 reads) | CPU | ÷ control |
|---|---|---|---|---|---|
| **control** — `buildings.html __wide()`, doc says **60** here | 590 | 1.59 M | 24.8 · 22.8 | 36 % | 1.00 |
| the showcase street, `__street()` — 120 people, 30 vehicles, 6 robots, 26 animals, 88 birds | **434** | 1.98 / 1.92 M | 25.2 · 31.4 | 45 % | **1.19** |
| `?stress=1`, the stress shot's pose — **300 people, 80 vehicles, 120 animals, 200 birds** | **398 / 399** | 3.72 / 3.65 M | 19.6 · 21.3 | 62 % | **0.86** |
| **control**, second round | 590 | 1.59 M | 27.6 · 30.7 | 54 % | 1.00 |
| street, second round | **434** | 1.98 / 1.92 M | 24.9 · 25.6 | 41 % | **0.87** |
| stress, second round | **398 / 399** | 3.69 / 3.65 M | 22.6 · 20.6 | 48 % | **0.74** |

An earlier round on a quieter box, measured at `__wide()` on both pages rather
than at the reference poses: control **49.5 · 54.5**, street **45.0 · 49.5**
(0.91), stress **32.7 · 40.0** (0.70).

Draw calls and triangles are exact whatever the load. Other poses, day:
plaza **261 / 2.72 M** · pasture **236 / 1.87 M** · animals **184 / 2.31 M** ·
night with headlights up **349 / 2.37 M**.

**Against the previous pass's table, which is the gate:**

- **The ratios did not regress, they improved.** Street was 0.79 / 0.80 and reads
  **1.19 / 0.87**; stress was 0.73 / 0.72 and reads **0.86 / 0.74**. The street
  row above 1.00 is noise on a control that swung from 23 to 52 inside half an
  hour — it is not a claim that the living layer is cheaper than the buildings.
- **Draw calls and triangles are within 1-3 %.** Street 432 → **434** and
  1.93 M → 1.92-1.98 M; stress 403 → **398-399** and 3.67 M → 3.65-3.72 M. The
  subdivided animals cost nothing at either pose because at both of them the
  herd is past the near band; where they DO cost something is the pasture pose,
  1.16 M → **1.87 M**, and the animal shot, which is what the pass is for.
- **The separation grid paid for the errands.** Before the uniform grid, the
  stress row read 27.8 fps against a control of 52 — a ratio of **0.53**, which
  is a real regression and was measured. Seven O(n²) sweeps of three hundred
  people is most of a frame on this machine; the grid took the same seven sweeps
  to about 2,000 pair tests each and the ratio back to 0.70-0.86.

**The ≥ 45 fps gate is still NOT demonstrated, and the control still says why.**
The reference page read 23-31 where its own doc records 60. To finish it: re-run
on an idle machine and **check the control reads 55-60 first**. If it does not,
the number that comes back is not about this module.

### The statics pass, measured paired (2026-09-07)

The absolute frame rate on this machine moved between **10 and 60 fps for the
same unchanged page** over the course of one afternoon, with other agents'
browsers on the same GPU — the RUNBOOK records the same swing and says what to
do about it. So this pass was measured the way that document prescribes: the
**same window**, the baseline build and the new build alternating, minutes
apart, five samples each and only accepted once five consecutive reads of the
rolling average sat inside 4 % of each other.

**The final build, three poses, one round each.** The machine was loaded (the
baseline itself reads 10-13 fps here, where a quiet box reads 55-60), so read
the RATIO and not the number:

| pose | baseline | with the statics | ratio | draw calls | triangles |
|---|---|---|---|---|---|
| street, `__street()` | 10.45 | **11.32** | **1.08** | 405 → **421** | 1.79 M → **2.46 M** |
| `?stress=1`, the stress pose | 11.54 | **11.69** | **1.01** | 371 → **382** | 3.53 M → **3.77 M** |
| pasture, `__pasture()` | 13.21 | **13.09** | **0.99** | 234 → **251** | 1.75 M → **1.48 M** |

An earlier round of the same change, on a quieter machine (the `buildings.html`
control read **60.0** in that window, which is what its own doc records),
measured the stress pose at **34.39 → 32.92 fps, ratio 0.96**.

Three things in that table are worth naming:

- **The pasture got CHEAPER.** 1.75 M → 1.48 M triangles, because two grazing
  animals in three are no longer a 44,436-triangle subdivided-and-furred
  skinned rig — they are a static instance on the rigid ladder.
- **The street pays the most**, +0.67 M triangles, and that is the hedge: it is
  the pose with the most pavement in frame.
- **Draw calls rise by 11-17**, not by 36. There are twelve new models and each
  owns three InstancedMeshes, but an InstancedMesh whose `count` is 0 issues no
  draw call, so a pose pays only for the tiers actually in use.

**Reading these rows against the previous table is not valid.** That table was
taken in a window whose control read 22.8-30.7; this one in a window whose
baseline read 10-13. The two are not comparable and nothing here claims they
are — which is exactly why every row above is a paired difference.

### Reading a frame rate here honestly

- **`devicePixelRatio` on this display is 2.** A headed Chrome window opened
  without `--force-device-scale-factor=1` renders 2520 × 1575, three times the
  pixels, and reads about 60 % of the real figure. The first measurement pass
  here was wrong for exactly that reason.
- **Headless Chrome on this machine has no GPU** and falls back to SwiftShader.
  Screenshots from it are correct; the frame rate it reports means nothing.
- **A second browser rendering the same page in the background halves the
  first one.** Kill the screenshot browser before measuring.
- Launch the measuring browser with `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --disable-background-timer-throttling`; if
  `__fps()` returns 0 the render loop is throttled, not slow.

---

## The showcase page

A `BuildingKit` street of twelve, a side street that crosses it at a signalled
junction, a paved plaza with eight benches, a **market square with four benches
that the side street runs into and stops at** — the pedestrian zone — and a
fenced pasture on rolling ground.

The market square is where it is for a reason: a plaza BESIDE a road proves
nothing about `addPlaza`, and a plaza ACROSS one is a pedestrian zone. The
ground under it is already flat, because the side street flattens the whole
corridor, so it needed no new terrain.

The ground is the part worth knowing about: it is **flat under the roads and the
plaza and rolling everywhere else**, and the exact same `groundHeight(x, z)`
function is what displaces the mesh *and* what is handed to `Life.load` as
`getHeight`. A herd on a hill is the only way to see whether that contract
actually holds.

| key | does |
|---|---|
| drag / scroll | orbit, zoom |
| `W A S D` | walk in the direction you are looking (`shift` to run) |
| `Q` `E` | up, down |
| `N` | day / night |

Harness hooks, all on `window`: `__ready()` `__fps()` `__calls()` `__tris()`
`__counts()` `__nearestAnim()` `__budget()` `__night(t)`
`__stand(x,y,z,tx,ty,tz)` `__street()` `__plaza()` `__pasture()` `__wide()`,
plus three added by the realism pass and five by this one:

| hook | answers |
|---|---|
| `__vehicles()` | where every vehicle IS — type, x, z, yaw, speed, whether it is turning. A vehicle a metre off the carriageway is invisible in a street-level screenshot and obvious in this list. |
| `__rigidCounts()` | how many rigid instances are on each of the three detail levels right now, and what each level costs in triangles. The budget table above is read off it. |
| `__probe()` | the behaviours, as counts: lamps lit, contact shadows drawn, parrots perched, animals lying down, people walking in groups, cars indicating, cars turning — and since this pass the clock hour, `errands` (where each person is heading), `doing` (what each is doing this instant, including `waitingToCross` and `onACrossing`), `yielding` (drivers slowing for a zebra) and `overlap`. |
| `__animals()` | frames a cow and the two sheep nearest it from **four metres**. Nine bearings per cow are scored for how much of the cow's front and how many of its sheep the camera would see, so the shot is composed rather than typed — the herd's positions come out of the seeded placement and a hard-coded camera would drift the day anyone changes a count. |
| `__closeUp(model, d)` | stand `d` metres off any model's three-quarter front. The realism pass is a claim about what a mesh looks like CLOSE, and this is how a species the reference shots do not frame gets looked at. |
| `__herd()` | frames a STANDING cow and the two standing sheep nearest it from four metres, scored over nine bearings exactly the way `__animals()` frames the rigged herd. The Hunyuan half of the pasture is a different set of objects from the rigged half, so it needs its own composer. |
| `__props()` | every static, by type and position, plus where each dog's owner is standing this instant. A prop that was never placed is invisible in a screenshot and obvious in this list — the same reason `__vehicles()` exists. |
| `__penetrations()` | every pedestrian capsule that is inside something solid this instant — a railing, a hedge, a bench, a prop, a parked or moving vehicle — plus the accumulated rate, the deepest one in metres, and how many obstacles the map holds. Beri's report A is this number and it has to read 0. |
| `__controls()` | what the bottom-right chips did: camera mode, `enableRotate`, night, distance to the orbit target, height. The click test asserts a change in this after each button. |
| `__zones()` | the pedestrian zones, read off `life.carFree` — the LIBRARY's list, not the page's constants. |
| `__carsInZone()` | every vehicle inside one. The gate for `addPlaza` is that this is `[]`, and it is one expression so it cannot be fudged. |
| `__resetProbes()` | start the accumulated probes again. The overlap rate is measured over a window and the window has to begin after the crowd has settled — the first second of the page has a hundred and twenty people materialising on ninety-nine nodes, several to a node. |

`__counts().proportions` carries the head-to-height ratio per human model,
before and after the reshape. `__counts().walk` carries the pavement graph's
**connected components** and where each piece is — the single most useful thing
to look at when the errands go wrong, because a walker whose shop is in another
component can never path to it. It has to read `components: 1`.
`__counts().overlap` carries the separation gate.
`__budget().models['animal.*'].sub` carries the before/after triangle counts of
the animal pass.

### Reference shots

All five retaken and a **sixth added** on 2026-09-06 for the animals-and-errands
pass, headless at 1440 × 900, `deviceScaleFactor 1`, console errors **zero** on
all six (`Runtime.enable` + `Log.enable`, on a tab of this harness's own so the
previous page's entries are not replayed as this run's). Every one is taken
**sixty seconds after `__ready()`**, which is new: an errand round is a couple of
minutes long and a shot at three seconds catches the crowd still leaving home.

| shot | pose |
|---|---|
| `docs/shots/life-street.png` | `__street()` — down the carriageway; pedestrians on both pavements, a pair walking together, a bus at the far end |
| `docs/shots/life-plaza.png` | `__plaza()` — **twelve people in the square**, three of them on benches |
| `docs/shots/life-pasture.png` | `__pasture()` — two cows grazing on the rolling field, inside the fence, markings readable at forty metres |
| `docs/shots/life-animals.png` | `__animals()` — **a cow head-on at four metres with a sheep behind it and two more beyond**: the horns, the blaze, the dark glossy eye and the hide's grain |
| `docs/shots/life-night.png` | `__night(1)` then `__stand(-62,4.6,4.4,-2,2.0,-1.0)` — headlights up, herd lying down, parrots on the roofs |
| `docs/shots/life-stress.png` | `?stress=1`, `__stand(-70,7.5,5.0,20,1.5,-0.5)` |
| `docs/shots/life-herd-hy.png` | `__herd()` — **the Hunyuan cow at four metres**, a Hunyuan sheep and a hedge behind it, inside the fence (2026-09-07) |
| `docs/shots/life-plaza-hy.png` | `__plaza()` — the same pose as `life-plaza.png`, now with the **fountain on the centre and three café tables** round it (2026-09-07) |
| `docs/shots/life-obstacles.png` | a queue of vehicles nose to tail on the main street with the crowd walking past them on the pavement — **nobody inside a bonnet**, which is the half of report A a picture can show; `__penetrations()` read `{now: 0}` on the same frame (2026-09-07) |
| `docs/shots/life-crowd-300.png` | `?stress=1` at the stress pose — three hundred people, all of them on the pavements and none on the carriageway (`__pedOnRoad()` = 0 on the same run) (2026-09-07) |
| `docs/shots/life-legend-buttons.png` | the bottom-right chips as real buttons, `drag orbit` carrying its pressed state, after the eight-click CDP test (2026-09-07) |

The three below are the HOSTS, not the showcase — the same props reached by a
real settlement's own data rather than by `life.html`'s hand-written flags.

| shot | what it proves |
|---|---|
| `docs/shots/host-globe-plaza.png` | a `town` on the planet (`takt-robotik`) at the documented 72 m street pose: **fountain, kiosk, bus shelter and playground** on its square and the hedge along the paving, all at the `-mid` tier (`LIFE_PROP_MID`) because the far tier tears at this altitude (2026-09-07) |
| `docs/shots/host-island-pasture.png` | the island's grazing field — a Hunyuan sheep and the hedge in frame, with `__props()` reading **6 sheep / 8 cows / 62 bushes / 11 dogs / 2 cats**. The animals are spread over the whole quarry rectangle, so the counts are the evidence and the frame is the sanity check; `__interior().inside` is asserted `false` because a closer fly-to lands inside a building (2026-09-07) |
| `docs/shots/host-tags.png` | not a prop shot — **fourteen drone tags on `index.html`, every one a real task line** and none a path or a "Base directory" preamble, after `server.py`'s `task_line()` (2026-09-07) |

---

## HANDOFF

_Verified: 2026-09-07_

**State:** complete and self-contained. `life.js` is a library nothing else
imports yet; `life.html` is the only caller. `globe.js`, `world.js`, `city.js`,
`buildings.js`, `drones.js`, `interior.js`, `server.py` and `assets/*.py` were
**not touched** in either pass — other agents were editing them — and
`assets/manifest.json` was only READ. This pass changed `life.js`, `life.html`,
this document and the **six** `docs/shots/life-*.png`.

_Superseded the same day, 2026-09-07: "nothing else imports it yet" is no longer
true. `globe.js` and `world.js` both call `Life` and pass the statics — see
"What each HOST reads the trigger off" above. `city.js` still does not, and that
is a decision, not an oversight (DECISIONS 2026-09-07, TESTS.md J8)._

### Decisions the animals-and-errands pass made

- **The pack's rigs are kept and its MESH is replaced.** There is no CC0
  realistic animated animal to swap in and the local generator is static-only.
  Subdividing the mesh keeps thirteen working clips; regenerating the model
  would have thrown them away for a statue.
- **The LOD ladder is not part of the deal.** `decimate()` runs on the
  pre-subdivision geometry on purpose, so the VAT textures, the far triangle
  counts and the sprites are byte-for-byte what they were. Only the tier close
  enough to see the difference pays for it.
- **An eye is placed where the pack already drew one.** The decal's own
  primitives are measured and the ball seated along their own normal. A guessed
  eye position on five different skulls is five wrong eyes.
- **A fox is called a fox.** The previous pass shipped it as `animal.cat`. The
  manifest key stays `life.animal.cat`, because `assets/manifest.json` belongs to
  the fetch script, and the row that reads it says so.
- **A pedestrian zone REMOVES the road, it does not divert it.** Routing traffic
  around would need a road that goes around, and this module is handed a network
  rather than allowed to draw one.
- **An errand is path-found; a follower is not.** Two people who each solved the
  graph would split at the first fork. A follower keeps station in the leader's
  own frame instead.
- **The clock is the real one.** Lunch is lunch. `setNight()` still overrides the
  evening half so a night screenshot is reproducible.
- **The separation gate is a measured rate, not a look.** `overlap.perSecond`
  reads 0 over sixty settled seconds of the showcase; at the stress counts it
  reads 17.2, and that number is in Known limits rather than rounded away.
- **Dwell times were solved from the geometry, not chosen.** The plaza is a
  minute's walk from the street, so a ten-second bench meant nobody was ever on
  one. 25-70 s is what fills it.

### Decisions worth knowing

- **The module can never invent a population.** Unchanged, and the reason the
  legend is checkable: every count arrives through the API.
- **The ratio is the gate, not the factor.** The brief asked for a head bone at
  x0.62 and a finished 1-in-7.5. On this rig those are different numbers; the
  ratio is the one a stranger can check on the screenshot, so x0.26 is what
  shipped. Everything else is the brief's own factor.
- **A clip-driven rig is reshaped in TWO places or not at all.** Every clip in
  this pack writes translation, rotation and scale on all 23 bones. The bind
  pose and the tracks both get the edit; the inverse bind matrices deliberately
  do not, and that is what makes the mesh deform rather than follow.
- **Colour is a lookup, not a bake.** Four skins x six wardrobes out of one
  geometry, because twenty-four baked copies of a character is twenty-four
  geometries and the whole point of the tier is one.
- **Rigid means rigid.** Every Hunyuan model is a single welded mesh: the wheels
  do not turn and the drone's propellers do not spin, and neither is faked. A
  disc drawn over a modelled propeller is worse than a still one.
- **Fit by measured size, never by the file's own scale.** Unchanged, and now
  also RECENTRE: these models are not centred on their origin, and both the
  turning pivot and the lamp placement need them to be.
- **The traffic mix is a deck, not a list.** Dealt one of each type in turn, a
  thirty-vehicle street came out 20% buses and 20% tractors. Four cars to one
  bus is what a small town's carriageway carries.
- **The yaw correction is not baked into the prototype.** Unchanged, and every
  rigid `face` was measured off a top-down and a head-on render of that file.

### Traps the animals-and-errands pass paid for

- **A fur shell offset in MODEL units is offset by nothing.** `len: 0.03` on a
  file whose own units are a hundredth of a metre is 0.3 mm, so two faceted
  low-poly shells sat flat on top of a 39,000-triangle body and hid every smooth
  normal under them. The whole subdivision looked like it had silently not run —
  the geometry was there, the triangle count proved it, and the screen showed
  the old cow. Everything in the pass is quoted in metres now and converted by
  `baseScale`, which is why it runs AFTER the fit rather than before it.
- **A procedural frequency is per metre or it is per nothing.** The same export-
  scale spread put the sheep's entire body inside one noise cell: perfect
  markings on the cow, a flat tan silhouette on the sheep, one shader.
- **`Box3.setFromObject` reads the BIND pose.** For a Mesh it takes the
  geometry's bounding box, so a rig whose bones have been edited measures as
  though they had not been. A reshaped animal's feet are wherever its shortened
  legs left them; `posedBox()` pushes every vertex through its own bones, which
  is the only reading that can put the soles back on y = 0.
- **`onBeforeCompile.toString()` is three's default program cache key.** One
  patch function that branches on a captured flag gives two DIFFERENT generated
  shaders the SAME key, and the second material silently gets the first one's
  program. The near (with fur) and VAT (without) variants need explicit
  `customProgramCacheKey`s.
- **An idempotent search must not test its own side effect.** `_findCrossings`
  ran twice — once from `addWalkways`, once from `populate` — rebuilt its list
  from empty and then skipped every pair because `nodes[A].links.includes(B)`
  was already true from the first run. Result: zero crossings, silently. The
  pavement graph still reached across the road, so nothing looked broken; nobody
  ever waited at a kerb.
- **Nearest by straight-line distance is the wrong pick at a junction.** The
  zebra search picked the CROSSING road's own pavement, four metres off its
  centre line, over this road's kerb seven metres off — and linked two pavements
  that were already connected while the far side stayed an island. Scored on
  distance ALONG the road instead, it is right.
- **A weld radius is not a graph.** The showcase's door stubs ran back to the
  kerb at each door's own x, and the kerb line was a plain eight-metre grid, so
  almost no stub landed within the 0.75 m weld radius of a node: ninety-five
  nodes in **fourteen** components. It had been that way since the module was
  written and nothing noticed, because a pedestrian that only hops to a
  neighbouring node never leaves its own island. `__counts().walk.components` is
  the instrument, and it has to read 1.
- **Half the overlap each is a dance, not a rule.** Two people who both give way
  by half oscillate. 0.2 / 0.8 by id resolves in one direction.
- **A separation push of exactly R moves nobody.** For two people at the same
  spot the direction has to be invented AND the vector has to be a millimetre
  long: at R the overlap term is exactly zero and neither of them ever moves,
  which is invisible on screen because two people in one coat look like one.
- **A tolerance that is tighter than float precision is an infinite loop.**
  Resolving to exactly R comes back as 0.59993, and counted against R that is
  still an overlap — so the convergence loop fixed the same pair fourteen times
  a frame, gave up, and reported one pair a second forever. The count is a
  millimetre inside the radius.
- **Reserving a resource at planning time empties the room.** Claiming a bench
  when the errand was chosen meant twelve people held all twelve benches for the
  minute it took to walk there: every seat taken, none of them occupied, and the
  plaza photographed empty. The seat is taken on arrival.

### Traps this pass paid for

- **`setMeshoptDecoder` or nothing.** The Hunyuan files are
  `EXT_meshopt_compression`; without the decoder the loader throws and every
  vehicle is missing with no other symptom.
- **Quantised interleaved attributes cannot be scaled in place.**
  `applyMatrix4` writes back through `setXYZ` without re-normalising and the
  model folds in on itself. Rebuild through the accessors first.
- **A UV bucket finer than the vertex spacing stops the weld dead.** 1/256 of
  the atlas left a 50,000-triangle car at 35,000 and looked exactly like a
  decimator that had silently failed. 1/32 works; the reasoning is in The rigid
  ladder.
- **`decimateTo` has to bracket AND bisect.** Taking the first cell that fits
  spent half the budget: 11,800 triangles against a target of 22,000.
- **`vColor` is a vec3 on some material and define combinations and a vec4 on
  others**, and reproducing three's own `USE_COLOR_ALPHA` guard by hand still
  got it wrong — three declared it vec4 with that define absent. Keep the stock
  `<color_vertex>` include and write only `.rgb`. The only symptom is "dimension
  mismatch" at a line number in generated source.
- **A DataTexture read in the VERTEX shader gets no automatic sRGB decode.**
  Declare it `NoColorSpace` and `pow(rgb, 2.2)` by hand, or the decode happens
  twice and every palette comes out half its intended value — the same
  double-decode the previous pass hit on `THREE.Color`.
- **`Material.clone()` deep-copies `userData` through JSON**, which a compiled
  shader object does not survive. Per-slot materials are constructed, not cloned.
- **Turning a car meant one more line than it looks.** After the lane change the
  car has to be advanced along `v.lane`, not along the `lane` the loop is
  iterating, or it lands back in the middle of the junction it just left.
- **The pack's `Hair` is the blob.** Recolouring it was not enough — it is a
  shell the size of the skull. Dropping it and generating a cap is what made
  the head measurably smaller rather than merely better lit.
- **Sizing the cap off the head's bounding box built a cap the size of the wig.**
  It has to be sized off the SKIN-class vertices only.
- **A distance band is not a budget.** At the stress counts eighteen vehicles
  were inside 22 m and the full-detail tier alone cost 1.8 M triangles with the
  shadow pass. The cut is now the closer of the band and the 8th-nearest.

### Traps the statics pass paid for

- **Cutting triangle budgets did not fix a frame rate the triangles were not
  costing.** 4.12 M → 3.80 M triangles bought 16.0 → 14.0 fps. The cost was the
  eight-slot raw-tier BUDGET being spent on hedges. Measure what the budget is
  spending before shrinking what it is spending it on.
- **A distance band is not a budget — and a budget is not a filter.** The third
  pass learned the first half. This one learned the second: an object that can
  never USE the raw tier must not be in the queue for it either, or it pushes
  the cut inward and starves the objects that can.
- **Welding a photogrammetry animal tears it far worse than a car.** The same
  1/32 UV bucket that keeps a bonnet clean at 6,500 triangles rips a cow's
  flank open at 20,000. An organic surface has no flat panels for the weld to
  hide in.
- **`const bx` twice in one function is a module that never loads.** The hedge
  fix declared `bx` inside a loop that already had a `bx`; the page threw
  `SyntaxError: Identifier 'bx' has already been declared`, `__ready()` never
  went true, and the screenshot harness sat waiting for a page that was never
  going to boot. Nothing in the symptom names the file.
- **A pavement that runs into a market square is still a pavement.** The first
  hedge pass planted two bushes in the middle of the paving — the one place on
  the page deliberately kept clear so people can stand in it. `_inPlaza` is the
  rejection.
- **A shot taken 45 s after `Page.navigate` is not a shot taken 45 s after the
  page is ready.** Twelve more models pushed `Life.load` from about twenty
  seconds to about thirty-five, so a harness that waits on the wall clock alone
  photographed a plaza with one person in it and looked exactly like a
  regression in the errands. The settle has to start when `__ready()` goes true.
- **A file-swapping A/B script will happily overwrite the build you are
  swapping in.** `cp life.js life.js.new` run while `ab.sh` had the BASELINE in
  place replaced the new build with the old one, silently, and the next two
  measured rounds were the baseline against itself. `rebuild.py` (in the
  scratchpad) exists because of it: the whole pass is one script against the
  pristine backup.

### Known limits

- **The frame-rate gate is unproven** — the control page read 22.8-30.7 fps
  where its own doc records 60, on a box at 36-62 % CPU (and 49.5-54.5 twenty
  minutes earlier on the same box). Nothing measured in that window is about
  this module; the RATIOS are, and they are at or above the previous pass's.
  Re-run on an idle machine, control first.
- **The level-up pass's E3/E6 re-check could not read a live fps, or a live
  draw call, at all.** The automation pane the pass ran in reported
  `document.hidden === true`, and Chrome fully suspends
  `requestAnimationFrame` on a hidden document rather than merely throttling
  it — twenty real seconds produced zero simulated ones, and
  `renderer.info.render.calls/triangles` read a stale, partial frame from
  before the tab was backgrounded (51 calls, 200k tris — clearly not a
  settled `__street()` pose). Nothing in this pass touches geometry,
  materials or population counts, so calls and triangles are reasoned to be
  unchanged against the last table, not re-measured. Errand and overlap
  counts were instead read by calling `life.update(dt, camera)` directly from
  the console, which does not depend on `requestAnimationFrame` firing at
  all — that is how E3 and E6's numbers below were taken, and it is a
  deterministic-stepping measurement, not a frame-rate one.
- **At the stress counts the separation gate is not met: 17.2 pairs a second,
  peak 7.** In the showcase it is 0. The convergence loop hits its fourteen-round
  guard when three hundred people share a 3.4 m pavement, which is also why —
- **— the stress shot has people walking on the carriageway.** Three hundred
  people do not fit on the pavement the host declared, and the separation pass
  has no idea where the kerb is, so the overflow is pushed into the road. The
  fix is a corridor constraint — pull a walker back toward the segment it is
  walking along — and it is NOT written, because it fights the separation pass
  and would have to be solved together with it. The showcase's 120 do not
  overflow: nobody is on the carriageway in `life-street.png` except on a zebra.
- **A fur shell casts a solid shadow.** Three's depth material does not carry the
  alpha-noise discard, so the shadow of a woolly sheep is the shadow of a sheep
  three centimetres fatter. At these shell lengths it is under a pixel.
- **The dog and the fox have no eyeballs.** Their materials are named
  `Material.006`; there is no eye decal to measure. Neither is ever placed.
- **The animals' far tiers still show the pack.** Only the near tier is
  subdivided, by design — but it means the seam at eighty metres is now a real
  one, where before both sides were equally low-poly.
- **The human rig shows a hip seam at close range.** Visible in
  `life-plaza.png` on several figures. It is the reproportion pass's rig, not
  this one's — nothing here touches the human geometry path — and it is
  reported rather than changed.
- **The Hunyuan bus is blank at the front.** The generator models the reference
  view well and the opposite side poorly; the bus's grille and headlamps are a
  flat yellow panel. It is the one model in the set that does not survive being
  looked at head-on, which is exactly what an oncoming bus is. Either regenerate
  that asset from a front reference or drop `bus` from `TRAFFIC`.
- **Wheels do not turn and propellers do not spin.** See Decisions.
- **The far tier's clip vocabulary is still two.** A sitting, grazing or LYING
  character beyond 80 m plays idle. Lying is new and makes this more visible at
  night than it was.
- **Sprites are almost never reached** in the showcase — the scene fits inside
  400 m. The tier is built and wired but the reference shots do not exercise it.
- **A robot still crosses the carriageway** to reach its agent, through the
  traffic, and it does not use the zebras: the crossings are a PEDESTRIAN
  behaviour and a robot is not a pedestrian here.
- **`_findJunctions` is O(roads^2 x points^2)** and stores only the first two
  roads that meet at a point, so a crossroads of three or more signals two of
  them — and now also offers turns onto only those two.
- **A static animal is exactly as static as it says.** It does not graze, does
  not amble to a new patch of the field, and does **not lie down after dark** —
  lying down is a clip, and a clip needs the rig. At night the third of the herd
  that kept its rig lies down and the other two thirds keep standing. The mixed
  herd is what makes that read as some animals still up rather than as a bug,
  but it is a real difference from the third pass's night shot.
- **The statics have no contact shadow.** `_drawBlobs` walks `this.actors`, and
  a prop is not an actor. Inside the middle tier they cast a real shadow, which
  is better than a blob; **past their `midBand` they cast nothing at all** and a
  distant hedge or hen sits on the grass with no contact under it. The vehicles
  have had exactly this limit since the second pass.
- **The Hunyuan bus shelter's glazing is opaque white.** The generator modelled
  a frosted panel rather than glass, so the shelter reads as a solid box from
  the side. It is the one of the twelve that does not survive being looked at
  closely — the same class of defect as the bus's blank front.
- **A decimated bush speckles.** Foliage is the worst case for a positional
  weld: at 2,000 triangles the silhouette breaks into confetti. The near budget
  is 8,000 and the middle tier stops at sixteen metres to keep that out of
  frame, but a hedge at forty metres is visibly coarser than one at ten.
- **On `globe.html`, a `fields` settlement reached by MOVING the stage shows
  only the rigged third of its herd.** The standing two-thirds are props, and
  props are cleared and re-placed on every stage move (they are in stage metres);
  but the only call that places a standing grazer is `addPasture()`, and calling
  it again would also push fresh RIGGED actors into `life.actors`, which the
  globe pools and moves between settlements. So `moveStage()` passes
  `sheep: 0, cows: 0` and the herd on the second field you visit is thinner than
  the herd on the first. The first settlement the page builds is correct. The fix
  belongs in `life.js` — a way to place the static half of a herd without
  creating actors — and is not written.
- **The statics are placed once and never re-grounded.** `_prop` calls the
  host's `getHeight` at placement time. That is correct for terrain that does
  not move, and wrong the moment a host deforms its ground after `populate()`.
- **Nothing here is culled by frustum.** Every InstancedMesh is
  `frustumCulled = false`; the instance counts track the LOD tier, so the cost
  is per-population and not per-visible.

### What integrating into `globe.js` needs

1. **One `getHeight`.** Pass the terrain height function straight in. Everything
   on the ground uses it — feet, hooves, tyres. No per-frame raycasts here.
2. **Roads and walkways from the real graph**, each road carrying its link
   weight, and `addWalkways`'s third argument carrying the **real pavement
   width** or the crowd walks on the verge.
3. **Feed the counts, do not tune them.** `residents = f(sessions)` belongs in
   `globe.js`, where the data is.
4. **`setLiveAgents` on the same tick the agent list changes** — it re-targets
   every robot, rebuilds their tag canvases and decides which of them fly a
   drone.
5. **`setNight(t)` is one call for the whole population** — headlights, roosting
   birds, the plaza in the evening, and the herd lying down.
6. **Budget:** at the target counts, ~403 draw calls and 3.7 M triangles for the
   whole frame *including* the street it stands on. A globe already spending 600
   calls on towns should bring `maxSkinned` AND `rigid` down before adding this;
   `rigid: 3` is the cheapest single lever, worth about 0.25 M triangles.
7. **`addPlaza` before `addWalkways`, and both before `populate`.** The zone cuts
   the lane graph and the walkway pass wires it into the pavement graph; a plaza
   declared after `addWalkways` has no pedestrians in it.
8. **Check `__counts().walk.components` reads 1** once the walkways are in. A
   shattered pavement graph is silent: people still walk, they simply can never
   reach an errand, and the street quietly turns back into drift.
9. **Call `addSkyBox` before `populate`** — it raycasts the scene once to find
   roosts (so run it after the buildings exist), and `populate` sizes the
   perched-parrot mesh from the parrot count it recorded.


## Traffic realism - 2026-09-07
_Verified: 2026-09-07_

Beri's screen recording of this page showed buses broadside across the road,
vans stacked at the crossroads, a tractor between the shopfronts of the main
street and the crowd walking down the middle of the carriageway. None of it was
one bug. It was six, and they are separate rules now.

### The rules, and the number each one was measured against

| rule | where | what it fixes |
|---|---|---|
| heading is the path tangent, including through a turn | `_stepArc()` - a cubic bezier, control points along each end's own heading; `v.head` is the curve's own derivative | the car that used to teleport across the junction and spin 90 degrees in one frame |
| following distance | `CAR_CLEAR` 1.5 m bumper to bumper, `CAR_HEADWAY` 0.9 s on top, floor of `max(own length + 1.5, both half-lengths + 1.5)` | a bus at rest inside the bus in front |
| the junction STOP LINE | `JUNCTION_BOX = 2 * LANE_HALF + 0.5`; the target ramps to zero when this vehicle's own NOSE is that far short of the junction's middle | a van stopped with 2 m of itself inside the crossing carriageway - 327 overlap frames out of 600 |
| AMBER | `AMBER = 2.5 s` at the end of each road's green: anyone who can still stop at the line does, anyone past it goes through | the signal flipping under a van three metres out, which parked it in the box for the whole of the next green |
| do not block the box | `free < gap + JUNCTION_BOX + stop` holds a driver at the line | a car that entered on green and stopped inside the junction because the queue ahead had not moved |
| road classes, at SPAWN and at every TURN | `_deckFor(road)` from the host's `lanes` / `settlement` / `field`; `_chooseTurn()` filters the exits through the same deck | the bus in a one-lane hamlet road and the tractor in the town's main street - the turn was the hole in the spawn rule |

`_deckFor()` also puts the tractor at the FRONT of a field road's deck, and the
dealer indexes the deck per LANE rather than by a running total. Both are the
same defect: `TRAFFIC` is ordered by how common a vehicle is in a town, so the
tractor is its last card, and a one-lane road with room for two vehicles never
reached it. life.html's field road ran two saloons and demonstrated half the
rule it exists to demonstrate.

### Pedestrians

`_holdToPavement()` already clamped a walker to the corridor between its two
graph nodes. Three things were still walking in the road, and each needed its
own rule:

1. **A pavement edge that spans a carriageway is a CROSSING** - `_edgeCrossings()`.
   The junction search only looks `CROSS_BACK` metres back from a junction; the
   pavement graph had a fifth way over the main street that nothing classified,
   so walkers used it in state `'walk'` and no driver ever read them.
2. **A group follower on the carriageway is on a crossing.** A follower does not
   path-find, so it has no corridor and cannot be held to one; what it has is
   the leader's route, and the leader crosses only at a crossing. Without this a
   family strung out over a 15 m zebra turned into jaywalkers the instant the
   leader reached the far kerb - peak 18 people in the road on every frame - and
   the crossing stopped counting as occupied, so a car accelerated into the rest
   of them.
3. **Nobody stands in the road** - `_pushOffCarriageway()`. Somebody sitting,
   lingering or waiting has no corridor at all, and at 300 people a corridor can
   clip a carriageway at the edge of a pedestrian square. They are walked back to
   the kerb, and still reported in `_onRoad` for that frame so the drivers react
   to where they were.

The accident's victim is exempt from all of it (`if (a.crash) continue`): it is
supposed to be in the road, and the kerb clamp silently cancelled the whole
accident - `__accidentState()` sat in `'approach'` for thirty seconds.

`_laneZebras()` now takes a crossing only if `c.road` says it spans THAT road.
At a crossroads the side street's crossing passes within five metres of the main
street's lanes, and distance alone handed it to the main street's drivers, who
braked at the junction for somebody crossing the other road and stopped there.

### Wheels - what the FILES contain

`window.__wheels()` reads this off the loaded models, so it is a property of the
assets and not of the code:

| model | separable wheels | note |
|---|---|---|
| car, van, pickup, bus, tractor, bicycle | **none** | every Hunyuan vehicle is one node with one primitive: the wheels are welded to the body. A wheel cannot be spun without cutting the mesh, and a fake disc over a modelled wheel is worse than a still one. |
| ambulance | **yes** - `BackWheels`, `FrontWheels`, radius 0.35 m | the only vehicle on this street whose wheels turn, and they turn with speed: measured `rate = 22.3 / 25.4 / 28.3 / 31.4 rad/s` at `7.8 / 8.7 / 9.9 / 11.0 m/s`, which is `speed / 0.35` on every sample |

This supersedes the older line in this file that said wheels never turn: it is
still true of every Hunyuan model and no longer true of the ambulance.

### Accidents

`Life.reportError({ label, at })` stages ONE collision at the nearest road
segment: late brake, the victim knocked with a short physics arc, the car askew
with hazard blinkers, an ambulance in with a flashing beacon, then a derez and
traffic resumes. One in flight at a time - a second call answers
`{staged: false}`. Deterministic from the event, no `Math.random`.
`__accident(label, at)` in life.html is the verification hook and nothing on
that page calls it by itself. The host wiring is one line in `city.js` and is
NOT in this pass - see HANDOFF.

### Known limits after this pass

- **Pedestrian separation at 300 people is still not clean.** Showcase reads
  **0.000 pairs/s** over 600 frames; `?stress=1` read **14.4 pairs/s (peak 6)** on one
  600-frame window and **26.0 pairs/s (peak 8)** on the next, against the
  pre-existing recorded 17.2/s (peak 7) - so the range straddles the old number
  and this pass did NOT improve it, and on a bad window makes it worse. Three
  hundred people on a 3.4 m pavement is more people than pavement, and the kerb
  push-out adds to it: pushing somebody out of the road can put them next to
  somebody else. A FAIL against 0, and it is measured twice here rather than
  quoted from the better of the two windows.
- **The road SURFACE is offset from the lanes.** In `traffic-street.png` and
  `traffic-brake.png` the westbound lane is drawn on grass while the paving lies
  to one side of it. It is in `life-street.png` from 2026-09-06 as well, so it
  predates this pass and nothing here touched it. It is the road paint, not the
  lane geometry: the gates read the lanes and pass.
- **The frame-rate instrument still swings.** Six paired A/B rounds on the same
  window, stress pose, file-swapped: two rounds are stable and read
  **0.98** and **0.96**; the other four span 0.55-1.28 on identical code, and one
  read a flat 0.0 (throttled, not slow - the note above still applies).

## The obstacle layer, and the constraint loop — 2026-09-07

_Verified: 2026-09-07_

> **UPDATE 2026-09-07 (part 2): the two open FAILs at the bottom of this section
> — separation at 300 people and the 0.60 stress frame rate — are CLOSED. The
> Measured table's stress column and the Known-limits bullets below are the state
> BEFORE that fix; the new numbers (separation 0.000/s, stress fps ÷control 1.00)
> and how they were reached are in "Hi-vis workers, park(), and closing the
> stress gate" further down.**

Beri sent two screenshots: a pedestrian walking through a pavement railing, and
people walking through parked and moving cars. Both are the same missing thing.
Nothing in this module knew where the SOLID objects were. The separation pass
knew about other people, the kerb clamp knew about lane centre lines, and a
railing, a hedge, a bench or a bonnet was simply not in the world as far as a
walker was concerned — the hedges and the fence went in on 2026-09-07 and the
pavement was never recomputed around them.

### One map, and everything empties into it

`_buildObstacles()` runs once, at the end of `populate()`, and fills a single
uniform grid (2 m cells) with circles from four sources:

| source | what it contributes | radius |
|---|---|---|
| `this.props` | hedges, the fountain, the kiosk, the shelter, the café tables, the playground, the standing herd, the hens, the cats | the model's own measured half-extent, the LARGER of the two, times its placement scale |
| `this.walk.seats` | every bench the host declared | two circles of 0.42 m, 0.9 m apart — a bench is not round |
| `addObstacles()` | **new API** — what the HOST placed and this module cannot see | as given; a segment becomes overlapping circles at its own radius |
| `_vehicleBoxes()` | every vehicle, every parked bicycle and the ambulance, as an oriented box on its own heading | rebuilt at the top of every people step |

`life.html` declares 1,281 obstacles on the showcase and 1,385 on `?stress=1`:
its tree trunks, its low woodland, and the pasture fence as four segments.

Everything is reduced to a circle because a circle is the only shape a
clearance test resolves without a branch, and `PED_R` — 0.45 m, half the
measured swept width the SEPARATION constant is already written against — is the
radius of the capsule every clearance in this file is measured to.

### The pavement is recomputed around them, at build time

For every edge of the pavement graph, `_buildEdgeSpans()` walks it in half-metre
steps and subtracts, from the corridor `[-walkHalf, +walkHalf]`, the lateral band
each obstacle beside that step occupies, keeping the larger surviving side. What
is left over the whole edge is the **free interval** a walker may steer in — the
reroute — and it is what `a.off` is clamped into and what the corridor clamp
clamps across. A step whose OWN interval is narrower than one body is a pavement
that is walled off, and that edge is cut out of the graph.

Two things about the cut are load-bearing and both were found by failing:

- **Cutting is guarded by reachability.** The first run cut five edges and made
  **three connected components** out of one, which is silent: people still walk,
  they simply can never reach an errand. Each candidate is now removed and then
  checked with the graph's own BFS; if the two ends are still reachable another
  way the cut stands, otherwise it goes back. Two edges are cut on this street
  and `__counts().walk.components` reads **1**.
- **The running intersection is not the blockage test.** Intersecting every
  step's interval over a long run with a hedge weaving across it collapses to a
  LINE, and three hundred people pinned to single lines at z = -6.6 read 364
  overlapping pairs a second. A collapsed interval is now widened back to one
  body about its own middle and the runtime push-out is left to do the rest;
  only a step whose own interval is empty counts as blocked.

`_plantHedge` also changed, and it is the same defect one level up: it planted
0.9-1.4 m off a pavement whose own half-width is 1.19 m, so half the hedge stood
on the flagstones. Along a pavement it now plants clear of `walkHalf`; along a
fence line (`closed`) the old offset stands, because there is no pavement there
to be beside.

### The clamp and the solver are one loop now

The old order was `_separate()` and **then** `_holdToPavement()`. That is why the
stress scene could never reach the separation gate however many rounds the solver
spent: the clamp ran last, moved people, and nothing measured or fixed the
overlaps its own squeeze had just created. The number that pass recorded —
14.4-26.0 pairs a second — was taken on the solver's positions, not on the ones
the frame drew.

Both are projections, so they alternate until neither moves anybody:

```
for (guard = 0; guard < SEP_ROUNDS; guard++) {
  moved = _holdToPavement();        // corridor, kerb, statics, vehicles
  pairs = measure();                // overlaps, on constrained positions
  if (!pairs && !moved) break;
  bucket(); sweep(fix);             // two full relaxation sweeps
  bucket(); sweep(fix);
}
if (guard === SEP_ROUNDS) {         // out of budget: the solids get the last word
  solved = measure();
  _holdToPavement();
  bucket(); sweep(fix);
  _projectSolids();                 // kerb + statics + vehicles, no corridor
  pairs = measure();
}
```

`stats().overlap` now carries **two** readings and the difference between them is
the whole story of this gate: `solvedPerSecond` is what the pairwise solver
achieved — the criterion the previous build reported — and `perSecond` is the
same count after every constraint has had the last word, which is what the frame
actually draws.

Four things in that loop are measurements, not choices:

- **`SEP_ROUNDS` is 26.** At 16 the solver did not converge at three hundred
  people (`solvedPerSecond` 15.2); at 26 it does (0.04 in the same window). The
  showcase breaks out after 19.
- **The corridor clamp has a 0.35 m dead zone.** The clamp and the sweeps have no
  common fixed point: the sweeps settle the crowd, the clamp pulls everybody a
  few centimetres back onto their line and makes three new pairs, and the two
  alternate forever — 77 pairs a second drawn against 0.04 solved. Being fifteen
  centimetres off your line is not a defect anybody can see, and 1.19 m of
  half-pavement plus 0.35 m is 1.54 m against the host's real 1.7 m to the kerb,
  so the walker is still on the flagstones. The KERB, static and vehicle pushes
  have no dead zone — those are the ones that would show.
- **The last word goes to `_projectSolids()` and not to the full projection**,
  and it is ONE alternation. Three of them take the drawn separation figure from
  16.2 to 12.3 pairs a second and the penetration rate the other way, from
  0.32/s at 2 mm (a float boundary) to 0.92/s at 253 mm — a person a quarter of
  a metre inside a car. Report A is the one that must read zero, so the solids
  win the tie.
- **Re-projecting only the people the last sweep MOVED is slower.** Measured on
  the stress scene: 35.8 → 28.9 fps and separation 5.9-26.8 → 49.8 pairs a
  second, because the cost of this loop is the sweeps and the measurement, not
  the projection. It is not in the code; it is here so nobody re-derives it.

### The dynamic half: stop, and then be pushed

A walker looks at where its step LANDS. If that is inside a vehicle box with
`VEH_CLEAR` (0.9 m) round it, the step is not taken — a car passing in front of
somebody is a person who stops for a beat. Two exemptions, both of which were
deadlocks the first time they were missing:

- **If you are already inside a box, the way out is forward.** A queue of cars
  stopped at the junction stop line covers the zebra, and everybody halfway over
  it froze in the middle of the road for as long as the red lasted.
- **Nobody on a zebra waits for a car.** A pedestrian on a crossing has right of
  way and the drivers already read the crossing as occupied; making it wait for a
  car that is waiting for it is the deadlock this file's own zebra rule exists to
  avoid, and it came straight back — two of the four crossings sat permanently
  occupied by nine people who could not move, **22 of 30 vehicles stood still**,
  and a staged accident never left its approach stage in seventy seconds because
  its driver was one of them.

The projection is the backstop, and it is a hard one: statics and vehicle boxes
are alternated up to four times per walker per pass, so the drawn capsule is
outside everything.

### Lane discipline, and queueing at a kerb

- **Keep right, where there is a pavement to keep right on.** The side a walker
  offsets to is now the side of its own direction of travel, so two streams end
  up on opposite halves — but only where each half is still a body wide.
  Forcing it on this street's free width gave each direction 0.65 m, narrower
  than one person, and the stress scene went from 14-26 pairs a second to
  **338**. The test is `(hi - lo) >= 2 * SEPARATION`, measured per edge.
- **A zebra is three metres wide.** The old rule dropped the lane offset to zero
  on a crossing, which put everybody on it in single file: seventy-four people on
  four zebras, in one line each. The offset is kept and clamped to the painted
  width.
- **A kerb holds a queue, not a merge.** Waiters take a slot back along the
  PAVEMENT — not back along the crossing's own axis, which walks the tail of a
  twenty-person queue through the shopfronts — alternating sides, and only the
  front two step off. `CROSS_CAP` (10) is how many the painted area holds at
  0.9 m of personal space; past it the rest queue. A waiter is also exempt from
  the corridor clamp, because its path still points ACROSS the road and the clamp
  was dragging the whole queue back onto the crossing's centre line.
- **Row 1 of a queue is the first row BEHIND the kerb.** `floor(slot/2)` handed
  the second person in every queue a place 0.5 m from the first one's — under one
  personal space, on every crossing, on every frame, four overlapping pairs a
  frame that no number of solver rounds could resolve because the TARGET was
  wrong. Fixing it took the stress scene from 213 to 120 pairs a second.

### The accident throws whoever stepped into its path

Beri, 2026-09-07: *"it throws whoever stepped into its path."* The robot stays
the DEFAULT because it is the data-true one — the robots are the live agents and
an agent that hit an error is the thing that goes down — but a car does not
choose its victim by species. `reportError()` now compares the nearest robot and
the nearest pedestrian to the impact point and takes whichever is closer. It is a
plain distance comparison with no tie-break and no `Math.random`, so the same
error at the same spot picks the same body twice. Somebody sitting on a bench and
a group follower are skipped: neither stepped into anything.

A person victim goes through exactly the same machinery as a robot one — the walk
into the road, the ballistic arc, the tumble, the ambulance, the getting up — and
`_stepPeople` hands it to `_stepVictim` the way `_stepRobots` always did. What it
costs: only the NEAR tier can be rotated. `lean` is written onto
`slot.obj.rotation.x` for a skinned figure; the vertex-animation texture and the
sprite have no rotation to give, so a knocked pedestrian beyond the near band
stands up again. That is in Known limits, not hidden.

### The legend chips are buttons

The bottom-right panel on `life.html`, `buildings.html` and `drones.html` looked
like a row of buttons and did nothing when it was clicked. Every chip is a real
`<button>` now, calling exactly what the key it shows calls — one behaviour, not
two — with the keycap typography unchanged, an `aria-label` each, `aria-pressed`
on the orbit/walk mode pair, a focus ring, and 44 px of line box so it can be
hit. `pointer-events` is re-enabled per chip because the panel around them is
deliberately click-through.

`window.__controls()` is what the click test reads. Every chip on every page was
driven by a CDP mouse click and asserted to change it: night 0 → 1, mode
orbit ↔ walk with `enableRotate` following, distance 81.11 → 66.51 → 81.14,
height 3.67 → 5.67 → 3.67, and on the other two pages `lod` -1 → 0, the close-up
re-frame, `working` true → false and `cycleForced` 0 → 1. Zero console errors on
all three.

### Measured

Headless Chrome, 1440 × 900, `deviceScaleFactor 1`, against the running server.
Every window starts after `__ready()` and after a settle, and `__resetProbes()`
opens it.

| gate | showcase (120 people) | `?stress=1` (300 people) | bar |
|---|---|---|---|
| `__penetrations().rate` | **0.000/s**, peak 0, worst 0 m, 1086 and 1073 frames | **0.000/s**, peak 0, worst 0 m, 867 / 801 / 711 frames | 0 — **PASS** |
| `__counts().overlap.perSecond` (drawn) | **0.000/s**, peak 0 | 11.28 / 95.73 / 77.34 per s | ≤ 1 — **PASS / FAIL** |
| `__counts().overlap.solvedPerSecond` | 0.000/s | 5.92 / 26.81 / 49.66 per s | (the old build's criterion) |
| `__pedOnRoad()` | 0 | 0 | 0 — PASS |
| `__carsInZone()` | `[]` | `[]` | `[]` — PASS |
| `__overlaps()` (vehicles) | 0 | 0 | 0 — PASS |
| `__headingErr().worst` | 0° | 0° | — PASS |
| `__counts().walk.components` | 1 | 1 | 1 — PASS |
| console errors | 0 | 0 | 0 — PASS |

**Frame rate, paired on one headed window** (1440 × 900,
`--force-device-scale-factor=1`, occlusion and throttling disabled), control
first and control again after:

| pose | fps (2 reads) | ÷ control | draw calls | triangles |
|---|---|---|---|---|
| **control** — `buildings.html __wide()`, its doc says 60 | 56.1 · 56.2 | 1.00 | 590 | — |
| the showcase street, `__street()` | 53.3 · 56.0 | **0.97** | 413 | 2.25 M |
| `?stress=1`, the stress pose | 34.9 · 33.2 | **0.60** | 407 | 3.36 M |
| **control**, second round | 56.2 · 55.4 | 1.00 | 590 | — |

The street row sits inside LIFE.md's own band (0.87-1.19). **The stress row does
not** — the band is 0.70-0.96 and this reads 0.60 — and the reason is named
rather than hidden: twenty-six constraint rounds over three hundred people, each
round a full projection plus two relaxation sweeps plus a measurement. Draw calls
and triangles are unchanged (407 against the recorded 398-399, 3.36 M against
3.65-3.77 M), so it is CPU in `_separate` and not anything on the GPU.

### Known limits after this pass

- **Separation at 300 people is still a FAIL, and now it is measured on the
  positions the frame draws.** Three windows read **11.3, 95.7 and 77.3 pairs a
  second** against a bar of ≤ 1. On the criterion the previous build used
  (`solvedPerSecond`) the same windows read **5.9, 26.8 and 49.7** against its
  recorded 14.4-26.0, so this is not a like-for-like regression — but it is not
  the gate either. What is left is congestion at two pinch points: a pavement
  graph node where four flows merge, and the kerbs of the four zebras. At those
  points the local density is above one person per 0.7 m², which is what 0.9 m of
  personal space needs, and no solver can separate people who do not fit. The
  showcase's 120 read **0.000/s**.
- **The variance between windows is larger than the effect of most changes
  here.** 11.3 and 95.7 pairs a second came off the same build twenty-five
  seconds apart. Anything measured on this gate has to be measured twice.
- **A knocked-over PEDESTRIAN stands up again past the near band.** The lean is
  a rotation and only the skinned tier has one. A robot victim does not have this
  problem, which is one more reason it is the default.
- **The stress pose costs 0.60 of the control** — see the table above.
- **The obstacle map is built once.** A host that adds a bench, a hedge or a
  railing AFTER `populate()` is invisible to the walk layer; `addObstacles()` has
  to be called before it, exactly like `addPlaza`.
- **A vehicle box is the model's bounding box on its heading.** A bus is drawn
  the shape of a bus and collided with as a 9.2 × 3.1 m rectangle; nobody can
  stand in the gap under a tractor's axle.
- **The road SURFACE is still offset from the lanes** — visible in
  `life-obstacles.png` as cars on grass with the paving to one side. It predates
  this pass and nothing here touched it.

## Hi-vis workers, park(), and closing the stress gate — 2026-09-07 (part 2)

_Verified: 2026-09-07_

Four defect reports, all measured against the Anno 1800 / Cities:Skylines
plausibility bar and the recorded fps band.

### 1 · A worker looks like a worker

The construction crew reused the plain pedestrian rig, so on the city they were
dark silhouettes indistinguishable from residents. The `human.worker` model
(`spec.hivis`) now wears a **hi-vis vest and helmet** — and it is a real
material, through the same 6×N palette texture the whole crowd already reads,
not a decal or a second mesh.

- Two **HI-VIS wardrobes** were appended to the palette (`HIVIS_WARDROBES`, an
  orange vest + yellow helmet and a yellow vest + white helmet). The palette went
  from 24 rows (4 skin × 6 muted wardrobes) to **32** (× 8), and `paletteRow(rand,
  hivis)` deals a worker one of the hi-vis rows and everybody else a muted one —
  the two never share a row, so a resident can never be handed a vest.
- It survives all three tiers with no extra work, because it recolours the
  `shirt` and `hair`(cap) classes the renderer already looks up: the per-instance
  `uPalRow` uniform on the near skeleton, the per-instance `aPal` attribute on the
  VAT, and — the one that needed a line — the distant **sprite**, which is one
  baked texture per model, so `_buildSkinned` bakes the worker's at
  `HIVIS_SPRITE_ROW` before the photograph is taken.
- **The worker was removed from the resident mix.** It used to be the fourth of
  the four models `populate({humans})` deals, and once the rig became hi-vis that
  would have put a quarter of every quiet village in a safety vest — the opposite
  of the owner's rule (*normal life in what is finished, workers where it is
  under construction*). Residents are now `casual / casualF / suit`; the worker
  is dealt only through `workers` and the city's own crew path.

`docs/shots/worker-hivis.png`: one worker in a hi-vis vest and hard hat among
residents in muted clothes — the readable difference the city needed.

### 2 · populate({ workers: n })

The public API the city.js note asked for. `populate({ humans, workers, cars,
… })` deals `workers` pedestrians on the hi-vis rig, identical to a resident in
every other respect (home, errands, separation, couples). The city's crew
regime, which today pre-seats workers with the private `_pedestrian('human.worker')`,
can now say `populate({ workers: n })` instead; `life.html` demonstrates it (a
dozen of the showcase's 120, thirty of the stress scene's 300).

### 3 · park(type, x, z, yaw) — a stationary vehicle AT a spot

The site van that stands at the printing building, not merely pulled near it by
the road's traffic weight. `park()` adds a plain `THREE.Mesh` of the model's
geometry to the group — the same choice the ambulance makes, because a population
of a few does not earn an InstancedMesh, three tiers and a raw-detail slot — and
pushes its record onto `this.hostParked`, whose box joins `_vehicleBoxes()` every
people step. So the crowd steps round it and `__penetrations()` counts it like
any stopped car, and it may be called at **any** time (before or after
`populate()`), because it never touches the instanced traffic pool or its
capacity. `docs/shots/life-park-van.png`: the van at the kerb, a walker passing
it. The city's one-liner: `life.park('van', x, z, yaw)` at the site forecourt.

### 4 · The stress gate: 0.60 fps → in band, separation FAIL → 0.000/s

Both were the SAME thing, and the obstacle-layer section above already named it:
at 300 people the constraint loop **never converged**, so it spent its whole
26-round budget every frame (the 0.60 fps) AND still drew overlapping pairs (the
separation FAIL). The cause is geometric — congestion at two pinch points (a
pavement node where four flows merge, the four zebra kerbs) where the local
density is above the one-person-per-0.7-m² that 0.9 m of personal space needs.

Two changes, and the first is what actually closes it:

- **The stress showcase gets a wider pavement.** `VERGE` is 6.4 m on `?stress=1`
  (against 3.4 m on the 120-person showcase, which is unchanged), which nearly
  doubles the walkable area at every pinch and lets the crowd spread laterally
  instead of piling. This alone took separation from 11–95 pairs/s to **0.000/s,
  peak 0**. It is the "widen the pinch pavements" lever, in the one file that owns
  the showcase's geometry — no host code changed.
- **The loop stops once separation is clean.** With the crowd fitting, overlaps
  hit zero within a couple of rounds — but the corridor clamp's 0.35 m dead zone
  keeps nudging people onto their line forever, so `moved` never reaches zero and
  the loop still burned all 26 rounds. `SETTLE_ROUNDS = 3` caps the projection
  rounds allowed AFTER overlaps hit zero (the full 26 is still available while
  pairs remain), so a converged frame does ~4 rounds instead of 26. That is what
  brings the frame rate back.

Nothing about the SOLVER'S correctness changed: the penetration projection still
runs, `_projectSolids` still gets the last word if the budget is ever spent, and
the 120-person showcase is untouched (still 0.000/s, and now 4 rounds not 5).

**Measured (headless 1440×900, `--reset` then 600+ frames; fps headed, same
window, `__street()` pose, vs `buildings.html __wide` control):**

| gate | 120 showcase | 300 `?stress=1` | bar |
|---|---|---|---|
| `overlap.perSecond` (drawn) | 0.000/s, peak 0 | **0.000/s, peak 0** (two windows) | ≤1 — **PASS** |
| `__penetrations().rate` | 0.000/s | 0.000/s | 0 — PASS |
| `__pedOnRoad()` / `__overlaps()` / `__headingErr().worst` | 0 / 0 / 0° | 0 / 0 / 0° | 0 — PASS |
| `walk.components` | 1 | 1 | 1 — PASS |
| console errors | 0 | 0 | 0 — PASS |
| **fps ÷ control** | 56.5 / 56.3 = **1.00** | 56.3 / 56.3 = **1.00** | ≥0.87 — **PASS** |

The stress row was 46.9 fps (÷0.80) before the settle cap and 33–35 (÷0.60) in
the build the obstacle-layer section measured. Control 56.3, street(120) 56.5,
stress(300) 56.3 — the solver's per-frame cost is now inside the noise.

### 5 · The accident stages on the nearest actor, and pulls a vehicle in

`reportError()` already threw whoever was nearest, robot or person (the
obstacle-layer pass). What it still did on a host with no robots and an empty
lane was no-op with `{ why: 'no vehicle on that lane' }` — which is every crew
street in the city, where `robots: 0`. Now, when the victim's own lane carries no
car, the **nearest vehicle on any lane is driven onto it** a short approach
behind the impact, so a real collision happens where the error is; and if the
whole street has no vehicle at all, the victim collapses in place and the
ambulance still comes. So an accident is always visible — a person knocked down,
a car stopped askew with its hazards on, an ambulance arriving — even with
`robots: 0`. `docs/shots/city-accident.png` is `life.html?robots=0`: a person
victim (not a robot), a van driven in, the ambulance on the scene. Still one in
flight at a time, still deterministic (nearest by distance, no `Math.random`).

### Known limits after part 2

- **The 300-person separation PASS depends on the wider stress pavement.** On the
  showcase's own 3.4 m pavement at 300 people it is still geometric — you cannot
  separate bodies that do not fit — which is why the stress showcase declares
  6.4 m. A real city street at that density would need the same width; the number
  to remember is one person per 0.7 m² of pavement.
- **A knocked-over PEDESTRIAN still stands up again past the near band** (the lean
  is a rotation only the skinned tier has) — unchanged, and one more reason the
  robot stays the accident's default where there is one.
- **park() is a plain mesh, one draw call each.** Fine for the handful a site
  wants; it is not the path for parking a hundred.

## Life.load() yields between models (2026-09-08)

Every host starts `Life.load()` **without awaiting it**, and each says in a
comment that this is so the world draws before the crowd arrives. Until now that
was not true: the loop that builds the eighteen `ModelEntry` objects decimates a
50,000-triangle mesh three times per entry and never returned to the event loop,
so for **8.8 s** the page ran no frame, no fetch handler and no host code at all.
`Life.load()` now awaits one macrotask between entries.

Measured on `index.html?project=e6a8abd1` (the busiest project, 198 streets):
the city's own streets painted at **8,974 ms before and 962 ms after**, against
987 ms for `?life=0`, which has no crowd to load and is the control. Nothing
else changed: the loop is still sequential on one renderer (two render-target
swaps interleaved is how you get a blank sprite), the order is the same, and so
is every mesh it produces.

A macrotask and not `requestAnimationFrame`: rAF is frozen in a hidden or
occluded window on this machine, and a crowd that never finishes loading because
the window is behind another one is worse than a slow one.

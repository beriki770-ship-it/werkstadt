/* =========================================================================
   life.js — the living layer
   =========================================================================
   Cars, people, animals and robots for the world. A standalone ES module with
   no dependency on any other file here: give it a renderer, a scene, the roads
   and the counts, and it populates them.

   The one design rule, from the brief, verbatim: populations are DRIVEN BY
   DATA. Residents per settlement come from sessions, traffic on a road from
   that road's link weight, robots are the live agents. This module RECEIVES
   those numbers through addRoads / addPasture / populate / setLiveAgents. It
   has no random population size anywhere and it never invents a count — the
   only thing the seed decides is which model wears which shirt.

   Three tiers of animation, because 300 characters cannot each own an
   AnimationMixer:
     < 80 m   a real SkinnedMesh with a mixer   (capped at 40, nearest first)
     < 400 m  an instanced mesh whose vertices are read out of a baked
              vertex-animation texture, one clip, per-instance phase offset
     beyond   an instanced camera-facing sprite baked off the model itself

   Model pack: Quaternius, CC0, fetched by assets/fetch_assets.py --life.
   Everything skinned in it carries named clips (Walk, Idle, Eating, ...) —
   nothing here is a static model pushed along the ground.
   ========================================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js';
/* The Hunyuan models are `EXT_meshopt_compression` + `KHR_mesh_quantization` +
   `EXT_texture_webp`. Three handles the last two on its own; without the
   decoder the loader throws "setMeshoptDecoder must be called before loading
   compressed files" and every vehicle is missing with no other symptom. */
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/* =========================================================================
   SECTION 1 — THE CATALOGUE
   One row per model. `height` is the real-world metres the model is scaled
   to, which is the only reliable way to use a pack whose export scale varies
   from file to file (the FBX-sourced vehicles come out ~100x the glTF ones).
   `face` is the yaw correction that turns the model's own forward onto +Z,
   measured off the reference shots, not guessed.
   `cell` is the decimation grid the far tiers are welded onto — see
   decimate(). It is set per model against how big that model is on screen at
   eighty metres, which is why a cat's is a third of a cow's.
   ========================================================================= */

const HUMAN_CLIPS = { walk: 'Walk', idle: 'Idle', run: 'Run', sit: 'SitDown' };
/* `lie` is what a grazer plays after dark. Both animal packs have a head-down
   idle; they spell it differently, which is why it is per row and not global. */
const HOOFED = { walk: 'Walk', idle: 'Idle', graze: 'Eating', run: 'Gallop', lie: 'Idle_Headlow' };
const PAWED  = { walk: 'Walk', idle: 'Idle', graze: 'Eating', run: 'Gallop', lie: 'Idle_2_HeadLow' };

const CHARACTERS = {
  'human.casual':  { key: 'life.human.casualM',  height: 1.80, face: 0, cell: 0.19,
                     human: true, clips: HUMAN_CLIPS },
  'human.casualF': { key: 'life.human.casualF',  height: 1.70, face: 0, cell: 0.19,
                     human: true, clips: HUMAN_CLIPS },
  'human.suit':    { key: 'life.human.suitM',    height: 1.82, face: 0, cell: 0.19,
                     human: true, clips: HUMAN_CLIPS },
  'human.worker':  { key: 'life.human.workerF',  height: 1.72, face: 0, cell: 0.19,
                     human: true, hivis: true, clips: HUMAN_CLIPS },

  /* The animals carry four more fields than the humans, and every one of them
     is the realism pass of 2026-09-06 (SECTION 4c above):
       `sub`   how many Loop subdivisions the NEAR geometry gets. Two, which is
               sixteen times the triangles for the one tier that is close
               enough to see them; the VAT and sprite tiers are baked off the
               undivided mesh and are unchanged.
       `hide`  the procedural hide: grain frequency, how far the albedo swings,
               and a large-scale blotch for the ones with markings.
       `fur`   how many alpha-noise shells and how far out the outermost sits,
               in the model's own units before the fit to `height`.
       `eyes`  the pack's own eye-material names. The dark glossy ball is
               placed on the decal those primitives already occupy, which is
               why it lands in the socket rather than somewhere plausible.
       `shape` bone edits, for the one substitution whose silhouette is wrong.
     Every number here is per model because a sheep is not a cow: wool is long
     and light-scattering, a cow's coat is short and its markings are the whole
     of what says "cow" at forty metres. */
  'animal.sheep':  { key: 'life.animal.sheep',   height: 1.05, face: 0, cell: 0.14, clips: HOOFED,
                     sub: 2, shape: 'sheep',
                     hide: { grain: 22, wave: 0.24, rough: 0.94 },
                     fur: { shells: 3, len: 0.032 }, furFreq: 90,
                     eyes: ['Eyes_Black', 'Eyes_White'] },
  'animal.cow':    { key: 'life.animal.cow',     height: 1.55, face: 0, cell: 0.18, clips: HOOFED,
                     sub: 2,
                     hide: { grain: 40, wave: 0.10, rough: 0.86,
                             blotch: 0.80, blotchScale: 1.8, blotchCol: 0x0d0a08 },
                     fur: { shells: 2, len: 0.005 }, furFreq: 320,
                     eyes: ['Eye_Black', 'Eye_White'] },
  'animal.horse':  { key: 'life.animal.horse',   height: 1.70, face: 0, cell: 0.18, clips: HOOFED,
                     sub: 2,
                     hide: { grain: 30, wave: 0.12, rough: 0.72 },
                     eyes: ['Eye_Black', 'Eye_White'] },
  'animal.dog':    { key: 'life.animal.dog',     height: 0.62, face: 0, cell: 0.08, clips: PAWED,
                     sub: 2,
                     hide: { grain: 40, wave: 0.20, rough: 0.90 },
                     fur: { shells: 3, len: 0.015 }, furFreq: 150 },
  /* A FOX, and it is called one. The previous pass shipped it as `animal.cat`
     because no CC0 animated cat exists in any pack checked; a fox is not a cat
     and the honest name costs nothing, since nothing places it. */
  'animal.fox':    { key: 'life.animal.cat',     height: 0.42, face: 0, cell: 0.06, clips: PAWED,
                     sub: 2,
                     hide: { grain: 50, wave: 0.22, rough: 0.88 },
                     fur: { shells: 3, len: 0.013 }, furFreq: 190 },
};

/* The one substitution whose SILHOUETTE is wrong rather than merely its label.
   Quaternius's farm pack has a sheep but it is static — no rig, no clips — so
   the woolly grazer of the ANIMATED list is an alpaca, and an alpaca's tell is
   a long upright neck on long legs. Shortening both, and thickening the head
   and neck to compensate, turns that silhouette into the barrel-on-short-legs
   a sheep is. Applied through the same two-place machinery the humans use: the
   rest pose AND every clip's own tracks, because this pack animates position,
   rotation and scale on all of its bones.

   Names are the bone names with the punctuation stripped, because GLTFLoader
   runs PropertyBinding.sanitizeNodeName on the way in. */
const ANIMAL_SHAPE = {
  sheep: {
    /* The neck: two thirds shorter AND bent forward off the withers. The
       length alone was not enough — an alpaca's tell is that it carries a long
       neck UPRIGHT, and a shorter upright neck still reads as a small llama.
       The bend is added to the rest pose and to every quaternion key, so the
       clips still play, they just play around a sheep's carriage. */
    Neck1: { pos: 0.52, rotX: 0.62 }, Neck2: { pos: 0.52, rotX: 0.20 },
    Neck3: { pos: 0.52, rotX: 0.16 },
    Head: { pos: 0.52, scale: 1.20, rotX: -0.72 },
    /* The leg: `pos` shortens the UPPER leg (the lower leg's offset from it)
       and `scaleY` shortens the lower leg itself, which has no child bone to
       carry an offset. The feet end up above the floor, and _buildSkinned
       grounds the armature on the measured box afterwards. */
    FrontLowerLegL: { pos: 0.78, scaleY: 0.78 }, FrontLowerLegR: { pos: 0.78, scaleY: 0.78 },
    BackLowerLegL: { pos: 0.78, scaleY: 0.78 }, BackLowerLegR: { pos: 0.78, scaleY: 0.78 },
  },
};

/* Which two clips get baked into a vertex-animation texture. Two is the whole
   far-tier vocabulary: a person at 90 m is walking or standing, and a third
   texture per model buys nothing anybody can see. */
const VAT_CLIPS = ['walk', 'idle'];

/* =========================================================================
   THE RIGID CATALOGUE — CC0 low-poly, one mesh, one material
   Every row here is a `model.hy.*` out of assets/manifest.json. The pack these
   rows named until 2026-09-08 was generated on a hosted Hunyuan 3D account and
   could not be redistributed — docs/PUBLISH-RESEARCH.md section 4 — so the
   public tree fills the same keys from Kenney's and Quaternius's CC0 kits.
   The keys keep the `hy.` prefix: it now names the catalogue, not a generator,
   and renaming it would touch four renderers for no behaviour change.

   WHAT CHANGED UNDER THE ROWS. The old files were photogrammetry-grade, about
   50,000 triangles apiece with a baked albedo, a metallic-roughness map and a
   normal map, which is why every row still carries `near` and `tris` and why
   there is a three-level ladder below. The CC0 models are 100 to 3,200
   triangles with one small palette texture and no normal map, so decimateTo()
   now returns them essentially untouched and the ladder costs nothing. The
   ladder is KEPT rather than deleted because it is what makes a richer pack
   (a locally generated one, or a future CC0 scan set) drop in without code.

   `height` is the real-world metres the model is scaled to, UNIFORMLY, off
   the bounding box's Y. On a row with no `length` it is therefore the only
   dial there is, so for a low, wide subject like the fountain it is solved
   backwards from the width the thing should have, and each such row says so.

   `length` is the second dial and only the five ROAD VEHICLES carry it: real
   metres nose to tail, stretched along the model's long horizontal axis after
   the height fit. Kenney's cars are stubbier than real ones — 1.96 long per
   unit tall against about 3.0 — so a uniform scale cannot make one both the
   right height and the right length, and the length is the half that the
   traffic model reads. See _buildRigid() for what that costs.
   `face` is the yaw that turns the model's own forward onto +Z.

   EVERY `face` IN THIS FILE WAS MEASURED, not guessed: assets/_facing.html
   rendered each model orthographically from +Z and from +X and the front was
   read off the picture. Sixteen of the seventeen face +Z (`face: 0`); the
   bicycle alone faces -Z. The previous pack's values were a quarter-turn out
   for the car, the pickup and the tractor, which is a vehicle driving sideways
   down the carriageway.

   `_buildRigid` ASSERTS the axis rather than trusting the table: a road vehicle
   is longer than it is wide, so after `face` its long horizontal axis must be
   Z, and a row that says otherwise is corrected at load with a console warning.
   The catalogue is the intent; the assertion is what makes it true. It cannot
   catch a 180-degree error — a bounding box cannot tell a bonnet from a boot
   — which is what the render measurement above is for.

   `clearcoat` is the lacquer over the albedo — car paint has one, a tractor's
   enamel barely does, and a bicycle has none to speak of. */
const RIGID = {
  'car':     { key: 'model.hy.car',     height: 1.45, length: 4.30, face: 0,            near: 18000, tris: 6500, wheeled: true, clearcoat: 0.65, rough: 0.34 },
  /* 2.00 and not 2.20. Kenney's vehicles are 1.5 units wide against 1.3 tall
     — stubbier than a real one — and `height` sets the WIDTH too, so a van
     set to a true 2.20 m roof came out 2.44 m across, wider than the lane it
     drives in. `length` below fixes the other axis; it does not fix this one. */
  'van':     { key: 'model.hy.van',     height: 2.00, length: 5.20, face: 0,            near: 18000, tris: 6500, wheeled: true, clearcoat: 0.55, rough: 0.36 },
  'pickup':  { key: 'model.hy.pickup',  height: 1.80, length: 5.30, face: 0,            near: 18000, tris: 6500, wheeled: true, clearcoat: 0.55, rough: 0.38 },
  /* THE BIG VEHICLE, and it is a BOX LORRY and not a bus. No CC0 pack checked
     ships a bus — see assets/fetch_assets.py, CC0_MODELS — so the deck's
     big-vehicle slot is filled by Kenney's `truck.glb`, which is the same size
     class and drives the same roads. The key stays called `bus` because
     _deckFor() reads that name to decide which streets carry one, and the rule
     it encodes (two lanes, town or city) is right for a lorry too.
     2.40 m and not 3.00 for the same width reason as the van. */
  'bus':     { key: 'model.hy.bus',     height: 2.40, length: 9.00, face: 0,            near: 22000, tris: 8000, wheeled: true, clearcoat: 0.45, rough: 0.40 },
  'tractor': { key: 'model.hy.tractor', height: 2.60, length: 4.00, face: 0,            near: 22000, tris: 8000, wheeled: true, clearcoat: 0.25, rough: 0.45 },
  /* PI and not 0: the only model in the pack whose front is on -Z. Measured
     off a +X side render — saddle at +Z, handlebars and fork at -Z. */
  'bicycle': { key: 'model.hy.bicycle', height: 1.10, face: Math.PI,      near: 12000, tris: 4500, wheeled: true, clearcoat: 0.15, rough: 0.50 },
  /* Not traffic: the agents' bodies and what perches in the trees. */
  'robot':   { key: 'model.hy.robot',   height: 1.35, face: 0, near: 14000, tris: 5500, clearcoat: 0.35, rough: 0.42 },
  /* 0.09 and not 0.34, and it is the width rule again: the ORNIS airframe is
     7.25 times longer than it is tall, so a 0.34 m `height` made a two-and-a
     -half metre aircraft hover over a 1.35 m robot. 0.09 puts it at 65 cm
     nose to tail, which is what a machine that size carries. */
  'drone':   { key: 'model.hy.drone',   height: 0.09, face: 0, near: 8000, tris: 3500, clearcoat: 0.20, rough: 0.45 },
  /* An African Grey with a red tail, which is the species this world's parrots
     actually are. `footY` is where its feet are as a fraction of its height:
     the tail hangs BELOW the toes, so seating it by its bounding box alone
     would leave every perched bird floating 13 cm over the branch. */
  /* NO CC0 MODEL. No CC0 African Grey exists in any pack checked, so this row
     never loads and _drawBirds() keeps every parrot procedural, in the air and
     on the branch. The aviary is opt-in and empty by default anyway
     (config.json `aviary_projects`), so a stock install loses nothing. */
  'parrot':  { key: 'model.hy.parrot',  height: 0.32, face: 0, near: 8000, tris: 3000, clearcoat: 0.10, rough: 0.62, footY: 0.40 },
};

/* =========================================================================
   THE STATIC CATALOGUE — CC0, the still half of the world
   Same files, same loader, same three-tier ladder as the vehicles above: these
   rows carry `tris`, so ModelEntry sends them down _buildRigid() and nothing
   in the loading path had to change to take them.

   What IS different is that none of them is rigged. That is the whole reason
   they exist: a grazing cow does not need a skeleton, and an unrigged mesh is a
   fraction of the file. The animals here therefore stand — they are the still
   half of a mixed herd, and the Quaternius rigs above keep the half that walks.
   See addPasture(). Their models come from Quaternius's Farm Animal pack, which
   is unrigged at the source; the cat is the rigged Fox exported without its
   skin, because no CC0 cat exists in any pack checked.

   `face` is the yaw that turns each model's own front onto +Z, and every row
   here was MEASURED the same way the vehicles were — assets/_facing.html,
   orthographic from +Z and from +X. All of them face +Z, so all of them are 0.
   The fountain, the cafe table and the bush are radially symmetric and their
   face is 0 by nature rather than by measurement.

   FOUR ROWS HAVE NO CC0 MODEL and are marked where they sit: the chicken, the
   bus shelter and the playground here, and the parrot above. They stay in the
   catalogue as the intent; Life.load() skips a key with no manifest row.

   `height` is real metres, the same convention the rest of the file uses. The
   three grazing species repeat the CHARACTERS heights exactly, or a standing
   cow and a walking one would be two different animals in one field.

   `midBand` is how far out the MIDDLE tier reaches, and it is the one number
   here that had to be measured rather than reasoned. RIGID_MID's forty metres
   was solved for an eight-metre bus; at forty metres a 1.2 m hedge is a few
   dozen pixels and eight thousand triangles of them is the pasture pose at
   32.3 fps against a 55.7 control. Short bands put that back.
   ========================================================================= */
const STATICS = {
  /* The herd. `st.` because `animal.cow` is the rigged one and both are alive
     in `this.models` at the same time. These three keep the raw tier — see the
     noRaw list below — because a cow at four metres is what this pass is
     judged on. */
  'st.cow':      { key: 'model.hy.cow',      height: 1.55, face: 0, near: 20000, tris: 2500, midBand: 22, clearcoat: 0.05, rough: 0.72 },
  'st.sheep':    { key: 'model.hy.sheep',    height: 1.05, face: 0, near: 20000, tris: 2500, midBand: 22, clearcoat: 0.00, rough: 0.90 },
  'st.horse':    { key: 'model.hy.horse',    height: 1.70, face: 0, near: 20000, tris: 2500, midBand: 24, clearcoat: 0.10, rough: 0.62 },
  /* The three that belong to a settlement rather than to a field. Small on
     screen and never the subject of a shot, so they are cut hard and their
     middle tier stops inside fifteen metres. */
  'st.dog':      { key: 'model.hy.dog',      height: 0.62, face: 0,            near: 5000, tris: 1600, midBand: 14, clearcoat: 0.05, rough: 0.78 },
  'st.cat':      { key: 'model.hy.cat',      height: 0.35, face: 0,            near: 3500, tris: 1100, midBand: 12, clearcoat: 0.05, rough: 0.76 },
  /* NO CC0 MODEL. This row and the three others marked the same way stay in the
     catalogue on purpose: they are the intent, they cost nothing while they are
     unfilled — Life.load() skips a key with no manifest row and names it once
     in one warning — and filling one later is a manifest row and no code. */
  'st.chicken':  { key: 'model.hy.chicken',  height: 0.45, face: -Math.PI / 2, near: 3500, tris: 1100, midBand: 12, clearcoat: 0.05, rough: 0.80 },
  /* Plaza and street furniture. Wet stone takes a little lacquer, a glass
     shelter takes more, painted wood and a hedge take almost none. */
  /* `height` FITS THE WIDTH on these, not the roof. The CC0 fountain and cafe
     table are low and wide — the fountain is a 2.0 x 0.48 x 2.0 basin — and
     nothing here carries `length`, so `height` is the only dial these rows
     have and the old numbers scaled the basin to nine metres across the plaza. Solved from the measured box: 0.62
     gives a 2.6 m basin, 0.46 a 1.0 m cafe table. */
  'st.fountain':   { key: 'model.hy.fountain',   height: 0.62, face: 0,             near: 9000, tris: 3000, clearcoat: 0.18, rough: 0.55 },
  'st.kiosk':      { key: 'model.hy.kiosk',      height: 2.60, face: 0,             near: 9000, tris: 3000, clearcoat: 0.10, rough: 0.70 },
  /* NO CC0 MODEL — see st.chicken. */
  'st.busstop':    { key: 'model.hy.busstop',    height: 2.50, face: -Math.PI / 2,  near: 9000, tris: 3000, clearcoat: 0.40, rough: 0.35 },
  'st.cafeTable':  { key: 'model.hy.cafe_table', height: 0.46, face: 0,             near: 9000, tris: 3000, clearcoat: 0.10, rough: 0.65 },
  /* NO CC0 MODEL — see st.chicken. */
  'st.playground': { key: 'model.hy.playground', height: 2.40, face: 0,             near: 9000, tris: 3000, clearcoat: 0.10, rough: 0.70 },
  /* A hedge is planted by the dozen along a pavement or a fence. 2,000 for the
     far tier is where its silhouette starts to speckle, and 8,000 near is what
     keeps a bush eight metres away looking like foliage rather than confetti. */
  /* 0.72 and not 1.20, same rule: the CC0 hedge is a 0.60 x 0.36 x 0.60 clump,
     so 0.72 m of height is what makes it 1.2 m across. */
  'st.bush':       { key: 'model.hy.bush',       height: 0.72, face: 0,             near: 8000, tris: 2000, midBand: 16, clearcoat: 0.00, rough: 0.92 },
};

/* Which statics may NOT use the raw 50,000-triangle file. Two measurements
   decided this list and both are in docs/LIFE.md:

   - the hedge, the small animals and the furniture are OUT, because they are
     numerous and small. Seventy hedges beside the camera spent the whole
     eight-slot rigid budget on BUSHES at fifty thousand triangles apiece, plus
     their shadow-map copies, and halved the stress scene (31.6 -> 16.0 fps,
     paired A/B). A hedge at four metres does not need a photogrammetry mesh;
     an oncoming bus does.
   - the three GRAZING species are IN. Welding a photogrammetry cow down to
     20,000 triangles tears its texture across the UV seams — white and green
     rips down the flank and across the face, visible in the first version of
     docs/shots/life-herd-hy.png — and that shot is a cow at four metres. */
for (const k of ['st.dog', 'st.cat', 'st.chicken', 'st.fountain', 'st.kiosk',
                 'st.busstop', 'st.cafeTable', 'st.playground', 'st.bush']) {
  STATICS[k].noRaw = true;
}

/* The deck populate() deals traffic from, and it is a DECK and not a list of
   types: dealt one of each in turn, a thirty-vehicle street came out 20% buses
   and 20% tractors, which is a depot and not a town. Four cars to one bus is
   roughly what a small town's carriageway actually carries.
   A bicycle is not in it — it is parked furniture, because no model checked has
   a rider on one — and the robot, the drone and the parrot are not traffic. */
const TRAFFIC = ['car', 'car', 'car', 'car', 'van', 'van', 'pickup', 'pickup', 'bus', 'tractor'];

/* LOD bands, in metres. The brief's numbers, unchanged. */
const NEAR = 80;          // real SkinnedMesh + AnimationMixer inside this
const FAR = 400;          // instanced vertex-animation texture inside this
const MAX_SKINNED = 40;   // total mixers alive, across every model
const MAX_SHADOW = 12;    // of those, how many cast a shadow

const VAT_FRAMES = 20;    // samples per clip; below ~16 a walk cycle judders
/* What every rigid albedo is multiplied down to before it meets a 2.6-intensity
   sun. It was solved for a baked photogrammetry albedo and it does a second job
   for the CC0 kits: Kenney's palette is a toy palette, and 0.74 is most of what
   keeps a red sedan sitting inside the dusk sky rather than glowing out of it. */
const RIGID_ALBEDO = 0.74;
/* The rigid ladder, in metres. Inside RIGID_NEAR a vehicle is the file the
   generator produced, untouched — 50,000 triangles and its own normal map,
   which is what a car four metres away has to be. RIGID_MID is the welded
   `near` copy, and beyond it the welded `tris` one. Three levels and not two
   because one middle level cannot be both: at 12,000 triangles an eight-metre
   bus came out visibly faceted at four metres, and at 35,000 thirty vehicles
   cost 1.5 M triangles a frame. */
const RIGID_NEAR = 22;
const RIGID_BUDGET = 8;     // how many rigid models may be at full detail at once
const RIGID_MID = 40;
const TAU = Math.PI * 2;

/* =========================================================================
   SECTION 1b — PROPORTIONS
   The Quaternius characters are stylised: the head is about a fifth of the
   figure, which is what makes a crowd of them read as toys however well it is
   lit. A real adult is nearer a SEVENTH AND A HALF, and that single ratio is
   most of the difference between "people" and "figurines".

   The rig cannot simply be re-posed, because every clip in this pack animates
   translation, rotation AND scale on all 23 bones — a change written into the
   bind pose alone is overwritten on the first frame of Walk. So each entry
   below is applied TWICE: once to the bone's rest transform, and once to every
   clip's own track for that bone. The inverse bind matrices are deliberately
   NOT recomputed; they stay the original rest pose, which is exactly what makes
   the mesh deform instead of just following the bones.

   Two kinds of edit, because they do different things to a limb:
     `scale`  — uniform, resizes the part around its own joint (a head, a hand)
     `scaleY` — along the bone's own axis, which is Blender's +Y: LENGTH, with
                no fattening, and safe here because the bones it is used on have
                no children to shear
     `pos`    — the bone's offset from its parent, i.e. the length of the parent
                limb. Skinning blends across the joint, so the segment stretches
                smoothly rather than tearing.

   Names are matched with the punctuation stripped, because GLTFLoader's
   PropertyBinding.sanitizeNodeName turns Blender's `LowerArm.L` into
   `LowerArmL` on the way in, and the raw glTF still says `LowerArm.L`. */
const PROPORTION = {
  neck:   0.90,
  /* The brief asks for two things that this rig cannot both satisfy: a head
     bone at 0.62 AND a finished head-to-height of about one in seven and a
     half. Measured, 0.62 lands at 3.7 — because a Quaternius head starts at
     TWO AND A HALF heads to the figure, which is a caricature and not a
     stylisation. The ratio is the thing anybody can check on the screenshot,
     so the ratio is what is honoured; 0.26 is what reaches it, and the number
     was solved from the measurement rather than guessed at. */
  head:   0.26,
  torso:  1.05,
  arm:    1.08,
  leg:    1.12,
  hand:   0.85,
  foot:   0.85,
};

function proportionTable(p) {
  return {
    Neck:      { scale: p.neck },
    /* Divided by the neck's, because bone scale CASCADES: a head at a literal
       0.62 under a neck already at 0.90 would come out at 0.558 of the
       original, and the measured ratio is what this is for. */
    Head:      { scale: p.head / p.neck },
    Torso:     { scaleY: p.torso },
    LowerArmL: { pos: p.arm }, LowerArmR: { pos: p.arm },
    FistL:     { pos: p.arm, scale: p.hand }, FistR: { pos: p.arm, scale: p.hand },
    /* `pos` lengthens the thigh (it is the knee's offset from the hip);
       `scaleY` lengthens the shin, which has no child bone to move. */
    LowerLegL: { pos: p.leg, scaleY: p.leg }, LowerLegR: { pos: p.leg, scaleY: p.leg },
    /* The feet are IK targets hung off the ROOT, not off the shin, so they do
       not follow the longer leg by themselves. `dropY` is filled in at load
       from the rig's own measured thigh, and the whole armature is lifted by
       the same amount so the soles still meet the ground. */
    FootL:     { scale: p.foot, dropY: true }, FootR: { scale: p.foot, dropY: true },
  };
}

/* =========================================================================
   SECTION 1c — THE PALETTE
   The pack ships one flat colour per material and its skin is 0.013 linear —
   near black — with a separate cream `Face` primitive for the eyes, which is
   the "dot eyes" tell. So the face plate is dropped at merge time and every
   surface is re-coloured out of the table below instead.

   Colour does not come from the vertex any more: each vertex carries a CLASS
   (skin, shirt, trousers, belt and shoes, hair, other) and each character
   carries a PALETTE ROW, and the shader looks the two up in a 6 x 24 texture.
   That is what buys four skin tones and six wardrobes out of one geometry and
   one draw call — baking the colour in would need twenty-four copies of it.
   The alpha channel carries that class's ROUGHNESS, so cloth sits at 0.6-0.8
   and skin below it without a second material. */
const CLS = { skin: 0, shirt: 1, trousers: 2, shoes: 3, hair: 4, other: 5 };
const CLS_N = 6;
/* Material name -> class. Anything unlisted is `other`; `Face` is dropped. */
const CLS_OF = { Skin: CLS.skin, Shirt: CLS.shirt, Pants: CLS.trousers,
                 Belt: CLS.shoes, Hair: CLS.hair };
/* `Hair` goes with it. The pack's hair is a separate low-poly shell the size
   of the skull it sits on — the blob that reads as a wig from twenty metres —
   and the generated cap replaces it. Dropping both is what makes the head
   MEASURABLY smaller and not merely better lit. */
const DROP_MATERIALS = ['Face', 'Hair'];

/* Four skin tones, from a light northern-European through to deep brown. sRGB
   hex, converted once; these are the values a colourist would pick, not a hue
   ramp — an evenly spaced ramp reads as four members of the same family. */
const SKIN_TONES = [0xe0b596, 0xc99168, 0x9a6641, 0x60402c];
/* Six wardrobes: shirt, trousers, shoes-and-belt, hair. Muted on purpose —
   a street is not a paint chart, and saturated clothing is the other half of
   the toy read. */
const WARDROBES = [
  { shirt: 0x3f4b5c, trousers: 0x2f3138, shoes: 0x1d1e22, hair: 0x2a1e17 },
  { shirt: 0x7a6a58, trousers: 0x39414b, shoes: 0x241f1c, hair: 0x4a3323 },
  { shirt: 0xa9a49b, trousers: 0x4b4238, shoes: 0x2b2723, hair: 0x121012 },
  { shirt: 0x5c6b58, trousers: 0x2c333a, shoes: 0x211e1b, hair: 0x6b4b2c },
  { shirt: 0x8f5c4d, trousers: 0x494f57, shoes: 0x1f1c1a, hair: 0x8a7358 },
  { shirt: 0x33404a, trousers: 0x6a6055, shoes: 0x26221f, hair: 0x352a22 },
];
/* Two HI-VIS wardrobes, and they are the exception to the "muted on purpose"
   rule above. A construction crew on the city reused the plain pedestrian rig
   and read as dark silhouettes indistinguishable from residents — so the worker
   model ('human.worker', spec.hivis) is dressed out of THESE rows instead: a
   saturated safety vest on the `shirt` class and a bright helmet on the `hair`
   class (the generated cap the pack's Hair material is replaced by). It is a
   real material through the same palette texture the whole crowd reads, not a
   decal, and because it recolours the shirt+cap classes it survives all three
   tiers — the per-instance uniform on the near skeleton, the per-instance aPal
   on the VAT, and the sprite baked at a hi-vis row (see _buildSkinned). Only the
   worker picks these; residents pick STD_WARDROBES, so nothing else changes. */
const HIVIS_WARDROBES = [
  { shirt: 0xff6b1a, trousers: 0x2b2f36, shoes: 0x1a1c20, hair: 0xf2e400 },  // orange vest, yellow helmet
  { shirt: 0xf2e400, trousers: 0x2b2f36, shoes: 0x1a1c20, hair: 0xf0f2f5 },  // yellow vest, white helmet
];
/* How hard the vest and the helmet glow, as a fraction of the garment's own
   linear colour. The project city is dusk-to-night by design, so a saturated
   ALBEDO alone still resolved as a black silhouette there (docs/shots/
   fix-city-crew.png) — real hi-vis is visible because it RETURNS light, not
   because it is yellow. So the two hi-vis classes carry an emissive term of
   their own and stop depending on the sun. 0.55, not 1.0: high enough to read
   as orange/yellow at street range, low enough that the city's bloom pass does
   not turn a crew into a row of white blobs. Residents are never on a hi-vis
   row, so nothing else in the crowd gains a milliwatt. */
const HIVIS_EMISSIVE = 0.55;
const STD_WARD_N = WARDROBES.length;                     // 6
const ALL_WARDROBES = WARDROBES.concat(HIVIS_WARDROBES);
const WARD_N = ALL_WARDROBES.length;                     // 8
const PAL_ROWS = SKIN_TONES.length * WARD_N;             // 32
/* The palette row a pedestrian wears: a skin tone always, and a wardrobe that is
   a hi-vis one for a worker and a muted one for everybody else. The two never
   share a row, so a resident can never be dealt a safety vest. */
function paletteRow(rand, hivis) {
  const skin = Math.floor(rand() * SKIN_TONES.length);
  const ward = hivis
    ? STD_WARD_N + Math.floor(rand() * HIVIS_WARDROBES.length)
    : Math.floor(rand() * STD_WARD_N);
  return skin * WARD_N + ward;
}
/* One hi-vis row, for baking the worker's distant SPRITE (which is a single
   texture per model, so it needs one row chosen for it rather than a per-instance
   one). Skin tone 0, first hi-vis wardrobe. */
const HIVIS_SPRITE_ROW = STD_WARD_N;                     // = 6
/* Roughness per class. Cloth 0.6-0.8, skin under it, hair above, leather low. */
const CLS_ROUGH = [0.55, 0.74, 0.78, 0.52, 0.86, 0.70];

/* One 6 x 24 RGBA texture: x is the class, y is the character's palette row,
   rgb is the colour and a is the roughness. Built once for the whole crowd. */
let _palTex = null;
function paletteTexture() {
  if (_palTex) return _palTex;
  const data = new Uint8Array(CLS_N * PAL_ROWS * 4);
  let row = 0;
  for (const skin of SKIN_TONES) {
    for (const w of ALL_WARDROBES) {
      const cols = [skin, w.shirt, w.trousers, w.shoes, w.hair, 0x6d6a63];
      for (let k = 0; k < CLS_N; k++) {
        /* The literals above ARE sRGB bytes and the texture is declared sRGB,
           so they go in untouched and the GPU decodes them once. Converting
           here as well is the double-decode that darkened every repaint on the
           previous pass. */
        const o = (row * CLS_N + k) * 4, hex = cols[k];
        data[o] = (hex >> 16) & 255; data[o + 1] = (hex >> 8) & 255; data[o + 2] = hex & 255;
        data[o + 3] = Math.round(CLS_ROUGH[k] * 255);
      }
      row++;
    }
  }
  const t = new THREE.DataTexture(data, CLS_N, PAL_ROWS, THREE.RGBAFormat);
  /* Nearest, not linear: a linear fetch halfway between two classes would
     paint somebody's collar in the average of their shirt and their skin. */
  t.magFilter = t.minFilter = THREE.NearestFilter;
  /* Left as raw data on purpose. This is read in the VERTEX shader, where
     three's automatic sRGB decode does not run — the decode is a pow() in the
     patch below, and declaring the texture sRGB as well would do it twice. */
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _palTex = t;
  return t;
}

/* =========================================================================
   SECTION 2 — SMALL HELPERS
   ========================================================================= */

/* Deterministic PRNG. Nothing in this module may use Math.random(): two loads
   of the same page have to produce the same crowd, or no screenshot can ever
   be compared against another. */
function rng(seed) {
  let a = (seed * 1664525 + 1013904223) >>> 0;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* Allocated once. Everything below runs per object per frame. */
const UP = new THREE.Vector3(0, 1, 0);
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler();
/* Scratch for the heading Lane.at() writes back while a turn is being set up.
   Module scope rather than a local, because _takeTurn runs on the frame path. */
const _turnHead = new THREE.Vector3();

/* A stable 32-bit hash of a string. The accident staging needs to make choices
   — which lane, which way a car ends up pointing — and it is not allowed to
   make them with the generator: the same error reported twice has to stage the
   same collision twice. FNV-1a, because it is four lines and deterministic. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const BIRD_PLAIN = new THREE.Color(0x2a2621);
const PARROT_A = new THREE.Color(0x2e9e3c);
const PARROT_B = new THREE.Color(0xd8452a);
/* Scratch colours. Allocating a THREE.Color inside a per-frame loop is the
   quietest way to hand the garbage collector three hundred objects a second. */
const _colA = new THREE.Color(), _colB = new THREE.Color(), _colC = new THREE.Color();
/* Two more: the brake lamp and the ambulance beacon are written in the same
   loop as the head, tail and indicator lamps and cannot share their scratch. */
const _colD = new THREE.Color(), _colE = new THREE.Color();

/* Shortest signed angle from a to b — the difference between a character
   turning the short way round and spinning 350 degrees to face a door. */
function angleTo(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/* Is (x, z) inside this polygon? Standard ray-crossing test; used to keep a
   herd in its own field and to place it there in the first place. */
function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/* GLTFLoader strips the punctuation out of node names on the way in, so the
   table above and the runtime tree only agree once both are stripped. */
const bareName = n => String(n || '').replace(/[^A-Za-z0-9]/g, '');

/* Scratch for the quaternion edit in retargetClip — one clip is 23 bones x 40
   keys and allocating a Quaternion per key is the one place in the load path
   where that would be measurable. */
const _q4 = new THREE.Quaternion(), _q4b = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);

/* =========================================================================
   SECTION 2b — RESHAPING THE RIG
   ========================================================================= */

/* Push one clip's own tracks through the same edit the bind pose got. Track
   names are `<node>.position` / `.quaternion` / `.scale`; the property is the
   last dot-separated token, which is also how three's PropertyBinding reads
   them, so a bone whose own name contains a dot still resolves. */
function retargetClip(clip, table, dropY) {
  for (const track of clip.tracks) {
    const cut = track.name.lastIndexOf('.');
    if (cut < 0) continue;
    const prop = track.name.slice(cut + 1);
    const edit = table[bareName(track.name.slice(0, cut))];
    if (!edit) continue;
    const v = track.values;
    if (prop === 'position') {
      if (edit.pos) for (let i = 0; i < v.length; i++) v[i] *= edit.pos;
      /* The IK foot target is in the root bone's space with Y up, so the leg's
         extra length is a SUBTRACTION here and not a factor: multiplying an
         ankle that sits at 5 cm by 1.12 moves it half a centimetre. */
      if (edit.dropY) for (let i = 1; i < v.length; i += 3) v[i] -= dropY;
    } else if (prop === 'scale') {
      if (edit.scale) for (let i = 0; i < v.length; i++) v[i] *= edit.scale;
      if (edit.scaleY) for (let i = 1; i < v.length; i += 3) v[i] *= edit.scaleY;
    } else if (prop === 'quaternion' && edit.rotX) {
      /* A constant bend added in the bone's OWN space, which is what makes it a
         posture edit and not a pose: post-multiplying every key by the same
         rotation leaves the animation's own motion intact and simply carries it
         around the new rest angle. Post- and not pre-, to match what
         `bone.quaternion.multiply(q)` does to the rest transform — the two have
         to agree or the first frame of a clip snaps the limb back. */
      _q4.setFromAxisAngle(_axisX, edit.rotX);
      for (let i = 0; i < v.length; i += 4) {
        _q4b.set(v[i], v[i + 1], v[i + 2], v[i + 3]).multiply(_q4);
        v[i] = _q4b.x; v[i + 1] = _q4b.y; v[i + 2] = _q4b.z; v[i + 3] = _q4b.w;
      }
    }
  }
}

/* Rescale one character's bones toward adult proportions, in the rest pose and
   in every clip, and lift the armature so the soles still land on y = 0.
   Returns what it actually did, for the doc's before/after table. */
function reproportion(root, clips, p) {
  const table = proportionTable(p);
  const bones = {};
  root.traverse(o => { if (o.isBone) bones[bareName(o.name)] = o; });
  if (!bones.Head || !bones.LowerLegL) return null;    // not this rig; leave it alone

  /* How far the ankle drops, measured off THIS rig rather than assumed: the
     thigh is the knee's own offset from the hip, and the shin is taken as the
     same length because it has no child bone to measure against. Both grow by
     the leg factor, so the ankle ends up (2 x thigh x (leg - 1)) lower. */
  const thigh = bones.LowerLegL.position.length();
  const dropY = 2 * thigh * (p.leg - 1);

  for (const name in table) {
    const b = bones[name], e = table[name];
    if (!b) continue;
    if (e.pos) b.position.multiplyScalar(e.pos);
    if (e.dropY) b.position.y -= dropY;
    if (e.scale) b.scale.multiplyScalar(e.scale);
    if (e.scaleY) b.scale.y *= e.scaleY;
  }
  for (const clip of clips) retargetClip(clip, table, dropY);

  /* The armature node is the one thing in this hierarchy no clip touches, so
     it is the only safe place to hang the lift that puts the feet back on the
     floor. Doing it on the gltf root instead would be wiped by the near tier,
     which writes the actor's position straight onto that object every frame. */
  const armature = root.children.find(c => !c.isBone && c.children.some(k => k.isBone))
                || root.children[0];
  if (armature) armature.position.y += dropY;
  root.updateMatrixWorld(true);
  return { dropY, headBone: bones.Head };
}

/* The same edit, for an animal. It is a separate function and not a call into
   reproportion() because reproportion() carries the human rig's own IK-foot
   correction — this pack's feet are the ends of the leg chain, so shortening a
   leg simply lifts them and _buildSkinned puts the animal back on the floor by
   MEASURING the posed box afterwards. `table` is already in stripped-name form.
   Returns whether anything was found, so a re-generated pack that has renamed
   its bones fails loudly in the doc's numbers rather than silently. */
function reshapeAnimal(root, clips, table) {
  const bones = {};
  root.traverse(o => { if (o.isBone) bones[bareName(o.name)] = o; });
  let hit = 0;
  for (const name in table) {
    const b = bones[name], e = table[name];
    if (!b) continue;
    hit++;
    if (e.pos) b.position.multiplyScalar(e.pos);
    if (e.scale) b.scale.multiplyScalar(e.scale);
    if (e.scaleY) b.scale.y *= e.scaleY;
    if (e.rotX) b.quaternion.multiply(_q4.setFromAxisAngle(_axisX, e.rotX));
  }
  if (!hit) return false;
  for (const clip of clips) retargetClip(clip, table, 0);
  root.updateMatrixWorld(true);
  return true;
}

/* The measurement the brief asks for: how tall the head is against how tall the
   figure is, both read off the posed rest pose so the number means the same
   thing before and after. Vertices are assigned to the head by their DOMINANT
   bone, which is the same rule decimate() uses. */
function measureHeadRatio(skinnedMesh, geo, headBone) {
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const sk = skinnedMesh.skeleton;
  const headIdx = sk.bones.indexOf(headBone);
  if (headIdx < 0 || !si) return null;
  skinnedMesh.updateMatrixWorld(true);
  const bind = skinnedMesh.bindMatrix, bindInv = skinnedMesh.bindMatrixInverse;
  let headLo = Infinity, headHi = -Infinity, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const acc = _m4b.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    let best = -1, dom = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const b = si.getComponent(i, k);
      if (w > best) { best = w; dom = b; }
      _m4.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
      for (let e = 0; e < 16; e++) acc.elements[e] += _m4.elements[e] * w;
    }
    _v3.fromBufferAttribute(pos, i).applyMatrix4(bind).applyMatrix4(acc)
       .applyMatrix4(bindInv).applyMatrix4(skinnedMesh.matrixWorld);
    if (_v3.y < lo) lo = _v3.y;
    if (_v3.y > hi) hi = _v3.y;
    if (dom === headIdx) {
      if (_v3.y < headLo) headLo = _v3.y;
      if (_v3.y > headHi) headHi = _v3.y;
    }
  }
  const head = headHi - headLo, height = hi - lo;
  if (!(head > 0) || !(height > 0)) return null;
  return { head, height, ratio: height / head };   // "one head in N"
}

/* The box a merged geometry occupies once its own skeleton has posed it, in the
   skinned mesh's world space.

   Box3.setFromObject() cannot answer this: for a Mesh it reads the GEOMETRY's
   bounding box, which is the BIND pose, so a rig whose bones have been edited
   measures as though they had not been. That is only a rounding error for the
   humans (their edit keeps the soles on the floor by construction) and it is
   the whole answer for a reshaped animal, whose shortened legs leave its feet
   twenty centimetres in the air. Same instrument as measureHeadRatio. */
function posedBox(skinnedMesh, geo) {
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const sk = skinnedMesh.skeleton;
  const box = new THREE.Box3();
  if (!si) return box.setFromBufferAttribute(pos);
  skinnedMesh.updateMatrixWorld(true);
  const bind = skinnedMesh.bindMatrix, bindInv = skinnedMesh.bindMatrixInverse;
  for (let i = 0; i < pos.count; i++) {
    const acc = _m4b.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      const b = si.getComponent(i, k);
      _m4.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]);
      for (let e = 0; e < 16; e++) acc.elements[e] += _m4.elements[e] * w;
    }
    box.expandByPoint(_v3.fromBufferAttribute(pos, i).applyMatrix4(bind).applyMatrix4(acc)
      .applyMatrix4(bindInv).applyMatrix4(skinnedMesh.matrixWorld));
  }
  return box;
}

/* A skull cap, generated rather than modelled: a half-sphere squashed onto the
   head's own measured box, sitting a couple of millimetres proud of it. The
   pack's own hair is a separate low-poly shell that reads as a blob from
   twenty metres; the cap is what gives the silhouette a hairline instead. It
   is merged in with weight 1 on the head bone, so it costs no extra draw. */
function hairCapGeometry(headBox) {
  const size = headBox.getSize(_v3b), mid = headBox.getCenter(_v3);
  const g = new THREE.SphereGeometry(0.5, 14, 8, 0, TAU, 0, Math.PI * 0.62);
  g.scale(size.x * 1.05, size.y * 0.80, size.z * 1.05);
  /* Seated a little below the crown so the cap meets the temples rather than
     balancing on top of the skull like a bowl. */
  g.translate(mid.x, headBox.max.y - size.y * 0.30, mid.z);
  return g;
}

/* =========================================================================
   SECTION 3 — LOADING ONE MODEL
   Every model in the pack arrives as one primitive per MATERIAL: a human is
   six meshes — skin, shirt, pants, belt, face, hair. Drawn as they come, forty
   near characters would be 240 draw calls before anything else in the frame.
   So each model is merged into ONE geometry whose material colours have been
   baked into a `color` vertex attribute, exactly the trick buildings.js uses
   on a facade. One character is then one draw call and one material.
   ========================================================================= */

/* Merge every primitive of `root` into a single geometry carrying the source
   materials as vertex colours. Returns null if the model has no mesh. */
function mergeToVertexColours(root, onlySkinned, opts = {}) {
  const { classify = null, drop = null } = opts;
  const geos = [];
  const taken = [];
  let skinnedSource = null;
  root.updateMatrixWorld(true);
  /* Find the skinned mesh first: everything rigid has to be expressed in ITS
     frame before it can join the merge. */
  if (onlySkinned) root.traverse(o => { if (o.isSkinnedMesh && !skinnedSource) skinnedSource = o; });
  if (onlySkinned && !skinnedSource) return null;
  const toSkin = onlySkinned ? new THREE.Matrix4().copy(skinnedSource.matrixWorld).invert() : null;

  root.traverse(o => {
    if (!o.isMesh) return;
    if (onlySkinned && !o.isSkinnedMesh && !boneAbove(o)) return;
    /* The cream `Face` primitive is the pack's eyes-and-mouth decal, and it is
       the single loudest cartoon signal on the model. Dropping it here rather
       than recolouring it means it never reaches the merge, the decimation or
       either baked texture. */
    if (drop && o.material && drop.includes(o.material.name)) { taken.push(o); return; }
    const g = o.geometry.clone();
    /* Bake the primitive's flat material colour into the vertices. The pack
       has no textures and no UVs at all — colour IS the material here, so this
       loses nothing. Headlights and tail lights come through as their own
       bright vertex colours, which is why they read even before the night
       emissive quads go up. */
    const c = o.material && o.material.color ? o.material.color : new THREE.Color(0xffffff);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    /* On a palette model the colour above is only a fallback: what the shader
       actually reads is this class id, one number per vertex saying which of
       the six surfaces it belongs to. */
    if (classify) {
      const cls = new Float32Array(n);
      cls.fill(classify(o.material && o.material.name));
      g.setAttribute('aCls', new THREE.BufferAttribute(cls, 1));
    }
    /* A rigid model's primitives sit under different nodes (body, wheels), so
       their own transforms have to be folded in before the merge. A skinned
       model's primitives all share the skinned mesh's frame and must NOT be —
       the skeleton supplies that transform at draw time. */
    if (!o.isSkinnedMesh) {
      if (onlySkinned) rigidToSkin(g, o, skinnedSource, toSkin);
      else g.applyMatrix4(o.matrixWorld);
    }
    taken.push(o);
    /* mergeGeometries refuses a set whose attributes differ, and the pack is
       not perfectly consistent about tangents/uvs, so keep only what is used. */
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color', 'aCls', 'skinIndex', 'skinWeight'].includes(name)) {
        g.deleteAttribute(name);
      }
    }
    geos.push(g);
  });
  if (!geos.length) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  geos.forEach(g => { if (g !== merged) g.dispose(); });
  return { geometry: merged, skinnedSource, taken };
}

/* The nearest ancestor that is a bone, or null. */
function boneAbove(o) {
  for (let p = o.parent; p; p = p.parent) if (p.isBone) return p;
  return null;
}

/* Turn a rigid mesh hanging off a bone into skinned vertices, so it can join
   the single merged geometry instead of costing its own draw call.

   The Quaternius robot is built this way: three skinned meshes and fifteen
   solid pieces parented to bones. Left alone it is eighteen draw calls per
   robot near the camera, and — much worse — only the three skinned meshes,
   544 of its 3,238 triangles, reach the vertex-animation bake, so a robot at
   ninety metres was a floating head and a pelvis.

   The maths: the skinning shader computes
       out = bindInverse * (bone.matrixWorld * boneInverse) * bind * p
   and at the bind pose `bone.matrixWorld * boneInverse` is the identity, so
   out == p. What we want out to be is the rigid part where it rests, in the
   skinned mesh's own space: skinnedInverseWorld * mesh.matrixWorld * p_local.
   So writing that transform straight into the vertices, with weight 1 on the
   parent bone, makes the part follow that bone exactly. */
function rigidToSkin(g, mesh, skinnedMesh, toSkin) {
  g.applyMatrix4(_m4.multiplyMatrices(toSkin, mesh.matrixWorld));
  weldToBone(g, skinnedMesh, skinnedMesh.skeleton.bones.indexOf(boneAbove(mesh)));
}

/* Give every vertex of `g` weight 1 on one bone, in the attribute types this
   skinned mesh already uses. The TYPES matter: glTF may hand out JOINTS_0 as
   Uint8 or Uint16 and WEIGHTS_0 as float or normalised integer, and
   mergeGeometries refuses a set whose attributes differ in type — after which
   the SkinnedMesh constructor throws on a null geometry, three calls later. */
function weldToBone(g, skinnedMesh, index) {
  const n = g.attributes.position.count;
  const srcI = skinnedMesh.geometry.attributes.skinIndex;
  const srcW = skinnedMesh.geometry.attributes.skinWeight;
  const si = new srcI.array.constructor(n * 4);
  const sw = new srcW.array.constructor(n * 4);
  /* "Weight 1", written in whatever units this attribute uses. */
  const full = !srcW.normalized ? 1
    : srcW.array.constructor === Uint8Array ? 255
    : srcW.array.constructor === Uint16Array ? 65535 : 1;
  for (let i = 0; i < n; i++) { si[i * 4] = Math.max(0, index); sw[i * 4] = full; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4, srcI.normalized));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, srcW.normalized));
}

/* The box the head-dominated vertices of a merged character occupy, in that
   geometry's own space — which is where the hair cap has to be built.
   `onlyClass` restricts it to one surface: the cap has to be sized to the
   SKULL, and a box that included the pack's own hair would produce a cap the
   size of the wig it is replacing. */
function headBox(geo, headIndex, onlyClass) {
  const pos = geo.attributes.position, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const cls = geo.attributes.aCls;
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) {
    if (onlyClass !== undefined && cls && cls.getX(i) !== onlyClass) continue;
    let best = -1, dom = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > best) { best = w; dom = si.getComponent(i, k); }
    }
    if (dom === headIndex) box.expandByPoint(_v3.fromBufferAttribute(pos, i));
  }
  return box.isEmpty() ? null : box;
}

/* =========================================================================
   SECTION 4 — DECIMATION FOR THE FAR TIERS
   A Quaternius human is 8,800 vertices. Three hundred of them instanced is
   1.3 M triangles a frame for people who are twenty pixels tall, and it is
   also 8,800 x 20 frames of vertex-animation texture per clip. Both problems
   have the same answer: weld the vertices onto a grid before baking.

   The cluster key carries the vertex's DOMINANT BONE as well as its cell.
   Without that, the inside of an upper arm welds to the ribs it touches in the
   rest pose and the arm tears itself open the moment the clip moves it.
   ========================================================================= */

function decimate(geo, cell) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, col = geo.attributes.color;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const cls = geo.attributes.aCls, uv = geo.attributes.uv;
  const idx = geo.index;
  const map = new Map();
  const P = [], N = [], C = [], SI = [], SW = [], CL = [], UV = [];
  const remap = new Int32Array(pos.count);
  /* A texture seam is two vertices at the same place with different UVs. Weld
     them and the seam smears across half the bonnet, so on a textured model the
     cluster key carries a UV bucket as well.

     The size of that bucket is the whole trick and it is not a free choice.
     These meshes carry 36,000 vertices on a 1024 atlas, which is one vertex
     every five texels; a bucket FINER than that gives every vertex a key of its
     own and nothing welds at all — set to 1/256 it left a 50,000-triangle car
     at 35,000 and the decimation looked like it had silently stopped working.
     1/32 is 32 texels: far coarser than the vertex spacing, so the weld runs,
     and far finer than the gap between two UV islands, so a seam still splits
     the key. */
  const UVCELL = 1 / 32;

  for (let i = 0; i < pos.count; i++) {
    let bone = 0;
    if (si && sw) {
      let best = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > best) { best = w; bone = si.getComponent(i, k); }
      }
    }
    /* The class joins the key for the same reason the bone does: a collar
       vertex welded to the neck under it would drag the shirt's colour onto
       the skin, and no amount of lighting hides that. */
    const key = `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},` +
                `${Math.round(pos.getZ(i) / cell)},${bone}` +
                (cls ? `,${cls.getX(i)}` : '') +
                (uv ? `,${Math.round(uv.getX(i) / UVCELL)},${Math.round(uv.getY(i) / UVCELL)}` : '');
    let at = map.get(key);
    if (at === undefined) {
      at = P.length / 3;
      map.set(key, at);
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (col) C.push(col.getX(i), col.getY(i), col.getZ(i));
      if (cls) CL.push(cls.getX(i));
      if (uv) UV.push(uv.getX(i), uv.getY(i));
      if (si) {
        SI.push(si.getX(i), si.getY(i), si.getZ(i), si.getW(i));
        SW.push(sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i));
      }
    }
    remap[i] = at;
  }

  /* Rebuild the index, dropping any triangle whose corners collapsed onto the
     same welded vertex — those are zero-area and would only cost fill rate. */
  const out = [];
  const count = idx ? idx.count : pos.count;
  for (let t = 0; t < count; t += 3) {
    const a = remap[idx ? idx.getX(t) : t];
    const b = remap[idx ? idx.getX(t + 1) : t + 1];
    const c = remap[idx ? idx.getX(t + 2) : t + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  if (cls) g.setAttribute('aCls', new THREE.Float32BufferAttribute(CL, 1));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  if (si) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  }
  g.setIndex(out);
  return g;
}

/* =========================================================================
   SECTION 4c — THE ANIMAL REALISM PASS
   The realism pass of 2026-09-06 replaced every rigid model and reproportioned
   every human, and left one thing behind: a cow at four metres was still a
   2,450-triangle cow with a flat brown paint job and a cream decal for an eye.
   No CC0 animated realistic animal exists to swap in — checked — so the pack's
   rigs and its thirteen clips are KEPT and the MESH is upgraded on the way in:

     1. Loop subdivision x2 with crease preservation, so the silhouette is a
        curve instead of a polygon count. New vertices are re-weighted from
        their two parents, so every clip still deforms it.
     2. Normals smoothed across the PACK'S OWN MATERIAL SEAMS. It ships one
        primitive per colour, and averaging only inside a primitive leaves a
        hard line down the flank where the light belly meets the back.
     3. A procedural hide instead of the flat colour: two octaves of value
        noise off the REST-POSE position (so it does not swim when the animal
        walks) modulating albedo and roughness, plus a large-scale blotch for
        the ones that have markings.
     4. Fur shells — two or three offset copies of the UNDIVIDED mesh with an
        alpha noise — for the woolly ones. Undivided on purpose: a shell is
        fuzz and never shows a silhouette of its own, so three shells cost
        3 x 2,000 triangles rather than 3 x 32,000.
     5. Eyes as dark glossy spheres welded to the head bone, seated on the
        pack's own eye decal so the position is MEASURED and not guessed.

   What is deliberately NOT touched: the LOD ladder. decimate() still runs on
   the PRE-subdivision geometry, so the VAT tier and the sprite are exactly the
   size they were and the far crowd costs what the doc's table says.
   ========================================================================= */

/* Weld an attribute buffer's vertices by POSITION alone, at a tenth of a
   millimetre. Both the subdivider and the normal smoother need the same map:
   the pack's material seams are duplicate vertices at the same place, and
   every rule below has to treat the two sides as one point, or the seam opens
   into a crack the moment the surface moves. */
function weldByPosition(pos) {
  const Q = 1e4;
  const map = new Map();
  const rep = new Int32Array(pos.count);
  const P = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
    let a = map.get(key);
    if (a === undefined) { a = P.length / 3; map.set(key, a); P.push(x, y, z); }
    rep[i] = a;
  }
  return { rep, P, count: P.length / 3 };
}

/* Area-weighted normals averaged over the WELDED topology, written back to
   every attribute duplicate. computeVertexNormals() cannot do this: it averages
   per attribute vertex, so the two sides of a material seam keep two different
   normals and the seam lights as a crease. */
function smoothNormals(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const { rep, count } = weldByPosition(pos);
  const acc = new Float32Array(count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    /* NOT normalised: the cross product's length is twice the triangle's area,
       which is the weighting a smooth normal wants, for free. */
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    for (const i of [i0, i1, i2]) {
      const r = rep[i] * 3;
      acc[r] += n.x; acc[r + 1] += n.y; acc[r + 2] += n.z;
    }
  }
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const r = rep[i] * 3;
    n.set(acc[r], acc[r + 1], acc[r + 2]);
    if (n.lengthSq() < 1e-12) continue;      // a degenerate island keeps what it had
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return geo;
}

/* Blend two vertices' skin bindings into one. This is the whole reason a
   subdivided SKINNED mesh is harder than a subdivided static one: a new vertex
   between two parents has to be driven by the union of their bones, or a
   midpoint on the shoulder seam stays bound to the ribs and the leg tears the
   flank open the first time a clip lifts it. Weights are summed per bone, the
   four heaviest kept and renormalised — which is exactly what glTF's own
   four-influence limit allows. */
function blendSkin(si, sw, a, b, outI, outW, at) {
  const acc = new Map();
  for (const v of [a, b]) {
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w <= 0) continue;
      const bone = si.getComponent(v, k);
      acc.set(bone, (acc.get(bone) || 0) + w * 0.5);
    }
  }
  const list = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  let sum = 0;
  for (const e of list) sum += e[1];
  if (sum <= 0) { outI[at * 4] = 0; outW[at * 4] = 1; return; }
  for (let k = 0; k < 4; k++) {
    outI[at * 4 + k] = list[k] ? list[k][0] : 0;
    outW[at * 4 + k] = list[k] ? list[k][1] / sum : 0;
  }
}

/* One level of Loop subdivision with crease preservation.

   Topology is built on the POSITION weld, so the pack's material seams do not
   become holes; attributes are carried on the original (split) vertices, so a
   seam still separates two colours. An edge is a CREASE when it has one
   adjacent face — a real boundary, an ear's rim, the inside of a mouth — or
   when the two faces meeting on it turn by more than the threshold. A crease
   edge uses the sharp rule (the plain midpoint) and a vertex sitting on
   exactly two crease edges uses the crease rule (1/8, 3/4, 1/8), which is what
   keeps a horn a horn and a hoof a hoof instead of melting both into the leg. */
function loopSubdivide(geo, creaseCos) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const col = geo.attributes.color, si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const idx = geo.index;
  const nv = pos.count, nt = idx.count / 3;
  const { rep, P, count: wn } = weldByPosition(pos);

  /* Welded faces and their normals, for the crease test. */
  const F = new Int32Array(nt * 3);
  const FN = new Float32Array(nt * 3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const a = rep[idx.getX(t * 3)], b = rep[idx.getX(t * 3 + 1)], c = rep[idx.getX(t * 3 + 2)];
    F[t * 3] = a; F[t * 3 + 1] = b; F[t * 3 + 2] = c;
    va.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    vb.set(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    vc.set(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
    fn.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
    if (fn.lengthSq() > 1e-20) fn.normalize();
    FN[t * 3] = fn.x; FN[t * 3 + 1] = fn.y; FN[t * 3 + 2] = fn.z;
  }

  /* Welded edges: who is on them, which two faces share them, and which vertex
     each of those faces has OPPOSITE the edge — the two 1/8 terms of Loop's
     odd rule. */
  const edges = new Map();
  const ekey = (a, b) => (a < b ? a * wn + b : b * wn + a);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const a = F[t * 3 + k], b = F[t * 3 + (k + 1) % 3], o = F[t * 3 + (k + 2) % 3];
      const key = ekey(a, b);
      let e = edges.get(key);
      if (!e) { e = { a, b, o: [-1, -1], f: [-1, -1], n: 0 }; edges.set(key, e); }
      if (e.n < 2) { e.o[e.n] = o; e.f[e.n] = t; }
      e.n++;
    }
  }

  /* Crease flags, and the two neighbour rings the even rule reads. */
  const nb = [], cnb = [];
  for (let i = 0; i < wn; i++) { nb.push([]); cnb.push([]); }
  for (const e of edges.values()) {
    let crease = e.n !== 2;
    if (!crease) {
      const f0 = e.f[0] * 3, f1 = e.f[1] * 3;
      const d = FN[f0] * FN[f1] + FN[f0 + 1] * FN[f1 + 1] + FN[f0 + 2] * FN[f1 + 2];
      crease = d < creaseCos;
    }
    e.crease = crease;
    nb[e.a].push(e.b); nb[e.b].push(e.a);
    if (crease) { cnb[e.a].push(e.b); cnb[e.b].push(e.a); }
  }

  /* EVEN vertices — the originals, moved. */
  const NP = new Float32Array(wn * 3);
  const get = (i, o) => P[i * 3 + o];
  for (let v = 0; v < wn; v++) {
    const cs = cnb[v], ns = nb[v];
    if (cs.length === 2) {
      /* On a crease: the crease curve's own rule, which smooths the CREASE
         without pulling it toward the surface either side of it. */
      for (let o = 0; o < 3; o++) {
        NP[v * 3 + o] = 0.75 * get(v, o) + 0.125 * get(cs[0], o) + 0.125 * get(cs[1], o);
      }
    } else if (cs.length !== 0 || ns.length < 3) {
      /* A corner (three or more creases meet) or a dart: held exactly. */
      for (let o = 0; o < 3; o++) NP[v * 3 + o] = get(v, o);
    } else {
      const n = ns.length;
      const beta = n === 3 ? 3 / 16
        : (1 / n) * (5 / 8 - Math.pow(3 / 8 + 0.25 * Math.cos(TAU / n), 2));
      for (let o = 0; o < 3; o++) {
        let s = 0;
        for (const u of ns) s += get(u, o);
        NP[v * 3 + o] = (1 - n * beta) * get(v, o) + beta * s;
      }
    }
  }

  /* ODD vertices — one new point per welded edge. */
  for (const e of edges.values()) {
    e.mid = [0, 0, 0];
    if (!e.crease && e.n === 2) {
      for (let o = 0; o < 3; o++) {
        e.mid[o] = 0.375 * (get(e.a, o) + get(e.b, o)) + 0.125 * (get(e.o[0], o) + get(e.o[1], o));
      }
    } else {
      for (let o = 0; o < 3; o++) e.mid[o] = 0.5 * (get(e.a, o) + get(e.b, o));
    }
  }

  /* Now build the output in ATTRIBUTE space. The originals keep their colour
     and their skinning and take the new welded position; every new edge vertex
     is keyed on the ATTRIBUTE pair, so two triangles either side of a material
     seam get one new vertex each and the seam survives. */
  const cap = nv + edges.size * 2 + 8;
  const OP = new Float32Array(cap * 3), ON = new Float32Array(cap * 3);
  const OC = col ? new Float32Array(cap * 3) : null;
  const OI = new si.array.constructor(cap * 4), OW = new sw.array.constructor(cap * 4);
  let n = 0;
  const put = i => {
    const r = rep[i] * 3;
    OP[n * 3] = NP[r]; OP[n * 3 + 1] = NP[r + 1]; OP[n * 3 + 2] = NP[r + 2];
    ON[n * 3] = nrm.getX(i); ON[n * 3 + 1] = nrm.getY(i); ON[n * 3 + 2] = nrm.getZ(i);
    if (OC) { OC[n * 3] = col.getX(i); OC[n * 3 + 1] = col.getY(i); OC[n * 3 + 2] = col.getZ(i); }
    for (let k = 0; k < 4; k++) { OI[n * 4 + k] = si.getComponent(i, k); OW[n * 4 + k] = sw.getComponent(i, k); }
    return n++;
  };
  for (let i = 0; i < nv; i++) put(i);

  const mids = new Map();
  const midOf = (ia, ib) => {
    const key = ia < ib ? ia * nv + ib : ib * nv + ia;
    let at = mids.get(key);
    if (at !== undefined) return at;
    const e = edges.get(ekey(rep[ia], rep[ib]));
    at = n++;
    OP[at * 3] = e.mid[0]; OP[at * 3 + 1] = e.mid[1]; OP[at * 3 + 2] = e.mid[2];
    ON[at * 3] = (nrm.getX(ia) + nrm.getX(ib)) * 0.5;
    ON[at * 3 + 1] = (nrm.getY(ia) + nrm.getY(ib)) * 0.5;
    ON[at * 3 + 2] = (nrm.getZ(ia) + nrm.getZ(ib)) * 0.5;
    if (OC) {
      OC[at * 3] = (col.getX(ia) + col.getX(ib)) * 0.5;
      OC[at * 3 + 1] = (col.getY(ia) + col.getY(ib)) * 0.5;
      OC[at * 3 + 2] = (col.getZ(ia) + col.getZ(ib)) * 0.5;
    }
    blendSkin(si, sw, ia, ib, OI, OW, at);
    mids.set(key, at);
    return at;
  };

  const OUT = [];
  for (let t = 0; t < nt; t++) {
    const i0 = idx.getX(t * 3), i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2);
    const m01 = midOf(i0, i1), m12 = midOf(i1, i2), m20 = midOf(i2, i0);
    OUT.push(i0, m01, m20, i1, m12, m01, i2, m20, m12, m01, m12, m20);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(OP.slice(0, n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(ON.slice(0, n * 3), 3));
  if (OC) g.setAttribute('color', new THREE.BufferAttribute(OC.slice(0, n * 3), 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(OI.slice(0, n * 4), 4, si.normalized));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(OW.slice(0, n * 4), 4, sw.normalized));
  g.setIndex(OUT);
  return g;
}

/* `levels` rounds of the above, then one smoothing pass over the result. Sixty
   degrees is the threshold: under it the pack meant a surface, over it it meant
   an edge. */
function subdivideSkinned(geo, levels) {
  let g = geo;
  for (let i = 0; i < levels; i++) {
    const next = loopSubdivide(g, Math.cos(THREE.MathUtils.degToRad(60)));
    if (g !== geo) g.dispose();
    g = next;
  }
  return smoothNormals(g);
}

/* Fur shells: `n` copies of the mesh pushed out along their own normals, each
   carrying how far out it is in `aFur` so the shader can thin it. Built from
   the UNDIVIDED geometry — a shell is alpha-noise fuzz and never shows a
   silhouette of its own, so it does not need the subdivided vertex count. */
function furShells(geo, n, len) {
  const out = [];
  /* Smoothed on a copy first. The offset direction IS the normal, so a shell
     grown off the pack's own per-primitive normals splits along every material
     seam and grows two flaps where the belly meets the flank. The copy is
     deliberate: the VAT tier is baked off `geo` and its numbers are supposed
     to be unchanged by this pass. */
  const src = smoothNormals(geo.clone());
  for (let s = 1; s <= n; s++) {
    const g = src.clone();
    const p = g.attributes.position, nr = g.attributes.normal;
    const t = s / n;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(i, p.getX(i) + nr.getX(i) * len * t,
                  p.getY(i) + nr.getY(i) * len * t,
                  p.getZ(i) + nr.getZ(i) * len * t);
    }
    p.needsUpdate = true;
    g.setAttribute('aFur', new THREE.Float32BufferAttribute(new Float32Array(p.count).fill(t), 1));
    out.push(g);
  }
  src.dispose();
  return out;
}

/* Where the pack put the eyes. Read off the eye-material primitives rather than
   guessed from the head box: the model already knows where an eye is, and the
   two halves separate cleanly on the sign of x because every animal in this
   pack is modelled symmetric about it. Returns one entry per side with the
   decal's centre and its size — and it is seated INWARD along the decal's own
   average normal, which is the only reason the ball ends up in the socket
   rather than balanced on the cheek. */
function eyeAnchors(root, skinnedSource, names) {
  const toSkin = new THREE.Matrix4().copy(skinnedSource.matrixWorld).invert();
  const sides = [
    { box: new THREE.Box3(), nrm: new THREE.Vector3(), n: 0 },
    { box: new THREE.Box3(), nrm: new THREE.Vector3(), n: 0 },
  ];
  root.traverse(o => {
    if (!o.isMesh || !o.material || !names.includes(o.material.name)) return;
    const p = o.geometry.attributes.position, nr = o.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      _v3.fromBufferAttribute(p, i);
      if (!o.isSkinnedMesh) _v3.applyMatrix4(o.matrixWorld).applyMatrix4(toSkin);
      const s = sides[_v3.x >= 0 ? 0 : 1];
      s.box.expandByPoint(_v3);
      if (nr) { _v3b.fromBufferAttribute(nr, i); s.nrm.add(_v3b); }
      s.n++;
    }
  });
  const out = [];
  for (const s of sides) {
    if (s.n < 3 || s.box.isEmpty()) continue;
    const size = s.box.getSize(_v3);
    const r = Math.max(size.x, size.y, size.z) * 0.58;
    if (!(r > 0)) continue;
    const c = s.box.getCenter(new THREE.Vector3());
    const nn = s.nrm.lengthSq() > 1e-9 ? s.nrm.normalize() : new THREE.Vector3(0, 0, 1);
    /* A third of a radius in, so about two thirds of the ball stands proud of
       the skull — which is what an eye does. */
    c.addScaledVector(nn, -r * 0.34);
    out.push({ c, r });
  }
  return out;
}

/* Two dark glossy balls, welded to the head bone with weight 1 so they follow
   the skull through every clip for no extra draw call. `aFur = -1` is the flag
   the hide shader reads: no noise, no fur, and a roughness low enough that the
   eye catches the sun — which is the cheapest single thing that makes an animal
   read as alive rather than as modelled. */
function eyeGeometry(anchors) {
  const parts = [];
  for (const a of anchors) {
    const g = new THREE.SphereGeometry(a.r, 12, 8);
    g.translate(a.c.x, a.c.y, a.c.z);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.06), 3));
    g.setAttribute('aFur', new THREE.Float32BufferAttribute(new Float32Array(n).fill(-1), 1));
    parts.push(g);
  }
  if (!parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  parts.forEach(g => { if (g !== merged) g.dispose(); });
  return merged;
}

/* The hide shader. Everything it needs is a uniform, so every animal's near
   material and every animal's VAT material compile ONE program between them.

   The noise is read off the REST-POSE `position` attribute and not off the
   skinned one, on purpose: sampled after skinning, the grain slides over the
   animal as it walks, which is the loudest "this is a shader" tell there is. */
function patchHide(mat, hide, withFur) {
  const h = hide || {};
  mat.onBeforeCompile = shader => {
    /* Every frequency below is CYCLES PER METRE of the finished animal, not per
       model unit — because this pack's export scale runs from 0.01 to 100
       between files, and the first version of this shader tuned the cow's
       markings beautifully while the sheep, whose file is a hundredth of the
       size, landed entirely inside one noise cell and came out a flat tan
       silhouette. `scale` is the same `fit` the geometry was sized by. */
    shader.uniforms.uHideScale = { value: h.scale || 1 };
    shader.uniforms.uGrain = { value: h.grain !== undefined ? h.grain : 18 };
    shader.uniforms.uWave = { value: h.wave !== undefined ? h.wave : 0.16 };
    shader.uniforms.uBlotch = { value: h.blotch || 0 };
    shader.uniforms.uBlotchScale = { value: h.blotchScale || 3 };
    shader.uniforms.uBlotchCol = { value: new THREE.Color(h.blotchCol !== undefined ? h.blotchCol : 0x151210) };
    shader.uniforms.uRough = { value: h.rough !== undefined ? h.rough : 0.88 };
    shader.uniforms.uFurFreq = { value: h.furFreq || 200 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        ${withFur ? 'attribute float aFur;' : ''}
        uniform float uHideScale;
        varying vec3 vHidePos;
        varying float vFur;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vHidePos = position * uHideScale;
        vFur = ${withFur ? 'aFur' : '0.0'};
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vHidePos;
        varying float vFur;
        uniform float uGrain, uWave, uBlotch, uBlotchScale, uRough, uFurFreq;
        uniform vec3 uBlotchCol;
        /* Value noise. A hash and a trilinear blend is all a hide needs, and it
           costs nothing next to a texture that would first have to be unwrapped
           onto a pack shipping no UVs at all. */
        float hHash(vec3 p) {
          return fract(sin(dot(floor(p), vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        float hNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hHash(i), hHash(i + vec3(1,0,0)), f.x),
                         mix(hHash(i + vec3(0,1,0)), hHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hHash(i + vec3(0,0,1)), hHash(i + vec3(1,0,1)), f.x),
                         mix(hHash(i + vec3(0,1,1)), hHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float hFbm(vec3 p) { return hNoise(p) * 0.65 + hNoise(p * 2.7) * 0.35; }
        float hHide;
      `)
      /* After the map include and not instead of it, so the noise MULTIPLIES
         the pack's own colour: a two-tone animal is still its two tones, with
         a hide over them. */
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        hHide = hFbm(vHidePos * uGrain);
        if (vFur < 0.0) {
          diffuseColor.rgb *= 0.55;                    // the eye: glass, not hide
        } else {
          if (vFur > 0.0 && hHash(vHidePos * uFurFreq) < vFur * vFur * 0.92) discard;
          diffuseColor.rgb *= mix(1.0 - uWave, 1.0 + uWave, hHide);
          if (uBlotch > 0.0) {
            /* A hard edge, not a gradient: a cow's markings END. 0.48 to 0.52
               is two pixels of blend at four metres and none at forty. */
            float hB = smoothstep(0.485, 0.525, hFbm(vHidePos * uBlotchScale));
            diffuseColor.rgb = mix(diffuseColor.rgb, uBlotchCol, hB * uBlotch);
          }
          /* Fur reads as fur because it is DARKER at the root and lighter at
             the tip — the gap between the shells is where the light gets in. */
          diffuseColor.rgb *= mix(0.80, 1.10, vFur);
        }
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = vFur < 0.0 ? 0.09 : clamp(uRough + (hHide - 0.5) * 0.30, 0.05, 1.0);
      `);
  };
  return mat;
}

/* Weld until the model is inside a triangle budget. The Hunyuan models are all
   50,000 triangles — a fixed number the generator hits every time, and one that
   makes thirty vehicles cost 1.5 M triangles a frame on their own. The first
   cell is estimated from the model's own size against the target, so this
   usually converges in one or two passes rather than by doubling from nothing.
   It also DE-QUANTISES: those files store positions as normalised shorts in an
   interleaved buffer, and the read-and-rebuild here is what turns them into the
   plain float arrays everything downstream (and mergeGeometries) needs. */
/* Copy a geometry into plain, non-interleaved Float32 arrays, welding nothing.
   The meshopt files store positions as normalised shorts inside one interleaved
   buffer, and BufferAttribute.applyMatrix4 writes back through setXYZ WITHOUT
   re-normalising — so scaling one of those in place silently produces a model
   folded in on itself. Reading through the accessors and rebuilding is the only
   safe way to touch them, and it is what the near tier is built from. */
function toPlainGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const a = src.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      out[i * size] = a.getX(i);
      out[i * size + 1] = a.getY(i);
      if (size > 2) out[i * size + 2] = a.getZ(i);
    }
    g.setAttribute(name, new THREE.Float32BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  return g;
}

function decimateTo(geo, targetTris) {
  geo.computeBoundingBox();
  const d = geo.boundingBox.getSize(_v3).length();
  let cell = (d / Math.cbrt(Math.max(64, targetTris))) * 0.55;
  const fits = g => g.index.count / 3 <= targetTris;
  let g = decimate(geo, cell);
  /* `lo` is the finest cell known to be too dense, `hi` the coarsest known to
     fit. Bracket first, then close the gap — because the estimate above is only
     an estimate and the whole point is to SPEND the budget. Taking the first
     cell that happened to fit threw half of it away: an 8 m bus came back at
     11,800 triangles against a target of 22,000, and at thirty metres its
     windscreen pillars were welded into the glass. */
  let lo = 0, hi = 0;
  if (fits(g)) {
    hi = cell;
    for (let i = 0; i < 7; i++) {
      cell *= 0.74;
      const t = decimate(geo, cell);
      if (fits(t)) { g.dispose(); g = t; hi = cell; }
      else { t.dispose(); lo = cell; break; }
    }
  } else {
    for (let i = 0; i < 14; i++) {
      lo = cell;
      cell *= 1.22;
      g.dispose();
      g = decimate(geo, cell);
      if (fits(g)) { hi = cell; break; }
    }
  }
  if (lo > 0 && hi > lo) {
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) * 0.5;
      const t = decimate(geo, mid);
      if (fits(t)) { g.dispose(); g = t; hi = mid; }
      else { t.dispose(); lo = mid; }
    }
    cell = hi;
  }
  return { geometry: g, cell };
}

/* =========================================================================
   SECTION 5 — THE VERTEX-ANIMATION TEXTURE
   The middle tier's whole trick. A clip is sampled at VAT_FRAMES poses; at
   each pose every vertex is pushed through its own bones on the CPU once, and
   the result is written into a float texture. At draw time the vertex shader
   reads its own position out of that texture at a time the instance chooses,
   so five hundred characters on one InstancedMesh can each be at a different
   point in the same walk cycle for the cost of one draw call.

   Normals are baked into a second texture rather than left in the bind pose:
   without them a walking figure's arms light as if they were still hanging at
   its sides, which is exactly the "sliding box" tell this tier exists to
   avoid. After decimation both textures together are a few hundred kilobytes.
   ========================================================================= */

const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4(), _m3 = new THREE.Matrix3();
const _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();

function bakeVat(root, skinnedMesh, geo, clip, frames) {
  const V = geo.attributes.position.count;
  const total = V * frames;
  const W = Math.min(1024, total);
  const H = Math.ceil(total / W);
  const posData = new Float32Array(W * H * 4);
  const nrmData = new Float32Array(W * H * 4);

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
  const skeleton = skinnedMesh.skeleton;
  const bindMatrix = skinnedMesh.bindMatrix, bindInv = skinnedMesh.bindMatrixInverse;

  for (let f = 0; f < frames; f++) {
    /* setTime rewinds and re-evaluates from zero, so the poses are absolute
       and a re-bake of the same clip gives byte-identical texels. */
    mixer.setTime((f / frames) * clip.duration);
    root.updateMatrixWorld(true);
    const world = skinnedMesh.matrixWorld;      // model space -> prototype root
    _m3.getNormalMatrix(world);

    for (let i = 0; i < V; i++) {
      /* The blended bone matrix, built once and used for both the position and
         the normal — three's own applyBoneTransform rebuilds it per call. */
      const acc = _m4b.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w === 0) continue;
        const b = si.getComponent(i, k);
        _m4.multiplyMatrices(skeleton.bones[b].matrixWorld, skeleton.boneInverses[b]);
        for (let e = 0; e < 16; e++) acc.elements[e] += _m4.elements[e] * w;
      }
      _v3.fromBufferAttribute(pos, i).applyMatrix4(bindMatrix)
         .applyMatrix4(acc).applyMatrix4(bindInv).applyMatrix4(world);
      /* The same four matrices as the position, but as DIRECTIONS. Dropping
         bindMatrix here is the classic version of this bug: it is identity on
         most rigs, so the mistake only shows on the one model whose armature
         is rotated, and then only in the lighting. */
      _v3b.fromBufferAttribute(nrm, i)
          .transformDirection(bindMatrix).transformDirection(acc)
          .transformDirection(bindInv).applyMatrix3(_m3).normalize();

      const o = (f * V + i) * 4;
      posData[o] = _v3.x; posData[o + 1] = _v3.y; posData[o + 2] = _v3.z; posData[o + 3] = 1;
      nrmData[o] = _v3b.x; nrmData[o + 1] = _v3b.y; nrmData[o + 2] = _v3b.z; nrmData[o + 3] = 0;
    }
  }
  action.stop();
  mixer.uncacheRoot(root);

  const mk = data => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    /* NearestFilter is not a quality compromise, it is a correctness one: a
       linear fetch would blend vertex 12's position with vertex 13's. */
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { pos: mk(posData), nrm: mk(nrmData), size: new THREE.Vector2(W, H), verts: V, frames,
           rate: frames / clip.duration, bytes: (posData.length + nrmData.length) * 4 };
}

/* =========================================================================
   THE PALETTE PATCH
   Two shader edits, shared by the near tier and the instanced one so a
   character cannot change colour when it crosses the 80 m line:
     vertex   — the class id and the palette row pick an RGBA texel; rgb is the
                colour (decoded from sRGB by hand, because the automatic decode
                only runs in the fragment stage) and a is the roughness
     fragment — that roughness replaces the material's own
   `instanced` says where the palette row comes from: a per-instance attribute
   on the far tier, a uniform on the near one, where each pooled character owns
   its own material and there is nothing to instance over. */
function patchPalette(mat, instanced) {
  mat.userData.palRow = 0;
  if (!mat.userData.shaders) mat.userData.shaders = [];
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.uniforms.uPalette = { value: paletteTexture() };
    shader.uniforms.uPalSize = { value: new THREE.Vector2(CLS_N, PAL_ROWS) };
    if (!instanced) {
      shader.uniforms.uPalRow = { value: this.userData.palRow };
      if (!this.userData.shaders.includes(shader)) this.userData.shaders.push(shader);
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute float aCls;
        ${instanced ? 'attribute float aPal;' : 'uniform float uPalRow;'}
        uniform sampler2D uPalette;
        uniform vec2 uPalSize;
        varying float vLifeRough;
        varying vec3 vLifeEmis;
      `)
      /* The stock include is KEPT and the palette written over its result,
         rather than replacing it. `vColor` is a vec3 on some material and
         define combinations and a vec4 on others, and reproducing three's own
         guard here still got it wrong — three declared it vec4 with
         USE_COLOR_ALPHA undefined, and the only symptom is "dimension
         mismatch" at a line number in generated source. Letting the include
         declare and initialise it, and touching nothing but `.rgb`, is correct
         for both and leaves the alpha at 1 either way. */
      .replace('#include <color_vertex>', /* glsl */`
        #include <color_vertex>
        vec4 lifePal = texture2D(uPalette,
          (vec2(aCls, ${instanced ? 'aPal' : 'uPalRow'}) + 0.5) / uPalSize);
        vColor.rgb = pow(lifePal.rgb, vec3(2.2));
        vLifeRough = lifePal.a;
        /* Hi-vis emission, decided here rather than stored in the palette
           texture because that texture's four channels are already spent (rgb
           colour + a roughness) and this is derivable from what it already
           holds: the hi-vis wardrobes are the LAST rows of every skin tone's
           block, so a row whose wardrobe index is >= STD_WARD_N is a worker.
           Only the vest (shirt) and the helmet (the cap on the hair class)
           light up — a resident's shirt reads out of the same texture and must
           stay unlit, and a worker's own trousers and skin must not glow. */
        float lifeWard = mod(${instanced ? 'aPal' : 'uPalRow'}, ${WARD_N}.0);
        float lifeHi = step(${STD_WARD_N}.0, lifeWard);
        float lifeGarment = step(0.5, max(1.0 - abs(aCls - ${CLS.shirt}.0),
                                          1.0 - abs(aCls - ${CLS.hair}.0)));
        vLifeEmis = vColor.rgb * (lifeHi * lifeGarment * ${HIVIS_EMISSIVE.toFixed(2)});
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
               '#include <common>\nvarying float vLifeRough;\nvarying vec3 vLifeEmis;')
      .replace('#include <roughnessmap_fragment>',
               '#include <roughnessmap_fragment>\nroughnessFactor = vLifeRough;')
      /* Added to the emissive radiance, not to the diffuse colour: emission is
         what survives an unlit night street AND what the sprite bake below
         photographs, so the far tier glows without a second code path. */
      .replace('#include <emissivemap_fragment>',
               '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLifeEmis;');
  };
  return mat;
}

/* One character's near-tier material. Not shared and not cloned: every pooled
   skeleton gets its own, because the palette row is a uniform and Material's
   own clone() deep-copies userData through JSON, which a compiled shader
   object does not survive. Forty materials, one program, no extra draw calls. */
function characterMaterial(palRow) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.74, metalness: 0.0, envMapIntensity: 0.6,
  });
  patchPalette(mat, false);
  mat.userData.palRow = palRow;
  mat.customProgramCacheKey = () => 'life-char';
  return mat;
}

/* The material that reads that texture. A stock MeshStandardMaterial with the
   position and normal reads patched in, so the crowd is lit by the same sun,
   fog and environment map as everything else in the scene. */
function vatMaterial(vat, palette, hide) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: palette ? 0.74 : 0.86, metalness: 0.0, envMapIntensity: 0.6,
  });
  mat.userData.shaders = [];
  /* The hide's own patch runs FIRST and is then wrapped by the VAT one below,
     because both edit `#include <common>` and the later writer has to see the
     earlier one's text. Without the fur attribute: the VAT geometry is the
     undivided mesh and carries neither shells nor eyeballs. */
  if (hide) patchHide(mat, hide, false);
  const hidePatch = hide ? mat.onBeforeCompile : null;
  mat.onBeforeCompile = shader => {
    if (hidePatch) hidePatch(shader);
    shader.uniforms.uVatPos = { value: vat.pos };
    shader.uniforms.uVatNrm = { value: vat.nrm };
    shader.uniforms.uVatSize = { value: vat.size };
    shader.uniforms.uVerts = { value: vat.verts };
    shader.uniforms.uFrames = { value: vat.frames };
    shader.uniforms.uRate = { value: vat.rate };
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute float aVid;
        attribute float aPhase;
        uniform sampler2D uVatPos;
        uniform sampler2D uVatNrm;
        uniform vec2 uVatSize;
        uniform float uVerts, uFrames, uRate, uTime;
        vec3 vatFetch(sampler2D tex, float frame) {
          float idx = frame * uVerts + aVid;
          vec2 px = vec2(mod(idx, uVatSize.x), floor(idx / uVatSize.x));
          return texture2D(tex, (px + 0.5) / uVatSize).xyz;
        }
      `)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float vFrame = mod(uTime * uRate + aPhase * uFrames, uFrames);
        float vF0 = floor(vFrame);
        float vF1 = mod(vF0 + 1.0, uFrames);
        float vMix = vFrame - vF0;
        vec3 objectNormal = normalize(mix(vatFetch(uVatNrm, vF0), vatFetch(uVatNrm, vF1), vMix));
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = mix(vatFetch(uVatPos, vF0), vatFetch(uVatPos, vF1), vMix);
      `);
    mat.userData.shaders.push(shader);
  };
  if (palette) patchPalette(mat, true);
  /* Without this every VAT material would share one compiled program and the
     second model to draw would wear the first model's texture uniforms. The
     palette variant needs a key of its own because it is a different SOURCE,
     not merely different uniforms. */
  mat.customProgramCacheKey = () => (palette ? 'life-vat-pal' : hide ? 'life-vat-hide' : 'life-vat');
  return mat;
}

/* A Hunyuan model's own material, upgraded. The generator hands out a plain
   metallic-roughness set; a clearcoat over it is what makes a car body read as
   lacquered steel rather than as moulded plastic, and it is the one thing the
   baked albedo cannot supply because a clearcoat is a highlight, not a colour.
   `rough` multiplies the model's own roughness map rather than replacing it,
   so the tyres stay matt while the panels go to about 0.3. */
function rigidMaterial(src, spec) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map || null,
    normalMap: src.normalMap || null,
    roughnessMap: src.roughnessMap || null,
    metalnessMap: src.metalnessMap || null,
    /* The baked albedos come out of the generator at close to full white on the
       light bodies, and under this scene's 2.6-intensity sun a white van landed
       above 1.0 after tone mapping and rendered as a glowing slab with a bloom
       halo round it — the same failure the previous vehicle pack had, arriving
       through a texture this time instead of a vertex colour. RIGID_ALBEDO is
       the top of the range real paint sits in. */
    color: (src.color ? src.color.clone() : new THREE.Color(0xffffff)).multiplyScalar(RIGID_ALBEDO),
    roughness: spec.rough !== undefined ? spec.rough : 0.5,
    /* 0.85 and not 1.0 even where the generator supplies a map: its metallic
       channel is optimistic about paint, and at a full multiplier a car body
       mirrors the sky instead of taking a highlight off it. */
    metalness: src.metalnessMap ? 0.85 : 0.05,
    clearcoat: spec.clearcoat !== undefined ? spec.clearcoat : 0.4,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.6,
  });
  if (src.normalScale) m.normalScale.copy(src.normalScale);
  return m;
}

/* =========================================================================
   SECTION 6 — THE SPRITE BAKE
   Beyond 400 m a character is under two pixels wide. Rendering it head-on once
   into a small transparent target and drawing that on a camera-facing quad
   costs one draw call for the whole distant population.
   ========================================================================= */

function bakeSprite(renderer, root, height) {
  const rt = new THREE.WebGLRenderTarget(64, 128, {
    magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true, colorSpace: THREE.SRGBColorSpace,
  });
  const scene = new THREE.Scene();
  /* The prototype itself, borrowed and handed back. A SkinnedMesh does NOT
     survive Object3D.clone() — the copy keeps a reference to the original
     skeleton's bones and draws as a heap — so photographing the real one in
     its rest pose is both simpler and the only correct option. */
  const parent = root.parent;
  const proto = root;
  scene.add(proto);
  /* Flat, frontal light: this image is seen at 400 m against the sky, where a
     modelled shadow reads as dirt rather than as form. */
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(0.4, 1, 1.6);
  scene.add(key);

  const box = new THREE.Box3().setFromObject(proto);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const halfH = Math.max(size.y, height) * 0.55;
  const cam = new THREE.OrthographicCamera(-halfH * 0.5, halfH * 0.5, halfH, -halfH, 0.01, 100);
  cam.position.set(mid.x, mid.y, mid.z + Math.max(4, size.z * 4));
  cam.lookAt(mid);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearAlpha(0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  scene.remove(proto);
  if (parent) parent.add(proto);
  return { texture: rt.texture, aspect: 0.5 };
}

/* =========================================================================
   SECTION 7 — A LOADED MODEL, ALL THREE TIERS
   ========================================================================= */

class ModelEntry {
  constructor(id, spec, gltf, renderer) {
    this.id = id;
    this.spec = spec;
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name.split('|').pop()] = c;

    const root = gltf.scene;
    this.face = spec.face || 0;
    this.height = spec.height;
    this.palette = !!spec.human;
    /* The hide's own settings, with the fur frequency folded in from the spec's
       `furFreq` so the shader reads one object rather than two. */
    this.hide = spec.hide ? Object.assign({ furFreq: spec.furFreq }, spec.hide) : null;
    if (spec.tris !== undefined) { this._buildRigid(root, spec); return; }
    this._buildSkinned(root, spec, renderer, gltf.animations);
  }

  /* ---- a character: reproportioned, repainted, then baked ----------------
     Order matters twice over. The bones are reshaped BEFORE anything is merged
     or decimated, because the head ratio has to be in the geometry the far
     tiers are baked off as well as in the one the near tier draws. And the fit
     to `height` metres happens AFTER the reshape, because the reshape changes
     how tall the model is. */
  _buildSkinned(root, spec, renderer, animations) {
    this.skinned = true;
    /* Measure first, on the pack as it shipped, so the doc's before/after
       numbers are two readings of the same instrument. */
    const probeMerge = mergeToVertexColours(root, true, {});
    const bones0 = {};
    root.traverse(o => { if (o.isBone) bones0[bareName(o.name)] = o; });
    this.ratioBefore = spec.human && bones0.Head
      ? measureHeadRatio(probeMerge.skinnedSource, probeMerge.geometry, bones0.Head) : null;
    probeMerge.geometry.dispose();

    if (spec.human) this.reshape = reproportion(root, animations, PROPORTION);
    /* An animal's silhouette edit, where it has one. Same rule as the humans':
       before the merge, so the reshape is in the geometry both tiers are built
       from and not only in the one the near tier draws. */
    if (spec.shape) this.reshaped = reshapeAnimal(root, animations, ANIMAL_SHAPE[spec.shape]);

    const merged = mergeToVertexColours(root, true, {
      classify: spec.human ? (name => (CLS_OF[name] !== undefined ? CLS_OF[name] : CLS.other)) : null,
      drop: spec.human ? DROP_MATERIALS : null,
    }) || mergeToVertexColours(root, false, {});
    let geometry = merged.geometry;

    /* The hair cap. Built from the head's own measured box in this geometry's
       space, welded to the head bone, and merged straight in — so it inherits
       the skinning, the palette and the single draw call. */
    if (spec.human && this.reshape) {
      const hi = merged.skinnedSource.skeleton.bones.indexOf(this.reshape.headBone);
      const hb = hi >= 0 ? headBox(geometry, hi, CLS.skin) : null;
      if (hb) {
        const cap = hairCapGeometry(hb);
        const n = cap.attributes.position.count;
        cap.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
        cap.setAttribute('aCls', new THREE.Float32BufferAttribute(new Float32Array(n).fill(CLS.hair), 1));
        cap.deleteAttribute('uv');
        weldToBone(cap, merged.skinnedSource, hi);
        const both = mergeGeometries([geometry, cap], false);
        if (both) { geometry.dispose(); cap.dispose(); geometry = both; this.hairCap = true; }
      }
    }

    const vatSource = geometry;
    /* Scale the whole prototype so the model is `height` metres tall, because
       export scale in this pack varies from 0.01 to 100 between packs and no
       other measurement of it is trustworthy.

       The yaw correction is deliberately NOT applied here. Both far tiers get
       their rotation from an instance matrix, so a rotation baked into the
       prototype would apply to the near tier only and the crowd would split in
       two at the 80 m line, half of it facing the wrong way. */
    const probe = this.reshaped ? posedBox(merged.skinnedSource, vatSource)
                                : new THREE.Box3().setFromObject(root);
    /* A reshaped animal's feet are wherever its shortened legs left them, so
       the armature — the one node no clip touches — drops by whatever the
       posed box says, and the soles land back on y = 0. Done BEFORE the fit
       because the box was measured before it. */
    if (this.reshaped) {
      const arm = root.children.find(c => !c.isBone && c.children.some(k => k.isBone)) || root.children[0];
      if (arm) { arm.position.y -= probe.min.y / (root.scale.y || 1); root.updateMatrixWorld(true); }
    }
    const fit = spec.height / Math.max(1e-6, probe.getSize(_v3).y);
    root.scale.multiplyScalar(fit);
    root.updateMatrixWorld(true);
    this.baseScale = root.scale.x;
    /* The hide's noise is quoted in cycles per METRE, so it needs the number
       that turns this model's own units into metres — which is only known now,
       and is needed before _material() below compiles anything. */
    if (this.hide) this.hide.scale = this.baseScale;

    /* ---- the animal realism pass, SECTION 4c --------------------------
       It runs HERE, after the fit, because everything it does is measured in
       METRES and `baseScale` is what turns this file's own units into them.
       Built before the fit, the fur shells were offset by three hundredths of
       a MODEL UNIT — which on these files is under a millimetre — so two
       faceted low-poly shells sat flat on top of a thirty-nine-thousand
       triangle body and hid every smooth normal underneath them. The whole
       pass looked like it had not run.

       `vatSource` above is the geometry the far tiers are built from and it
       stays the UNDIVIDED one: the VAT texture, the far triangle count and the
       sprite are not what this pass is about, and a subdivided VAT would be
       sixteen times the texture for a figure twenty pixels tall. */
    if (spec.sub) {
      this.trisBefore = geometry.index.count / 3;
      const parts = [subdivideSkinned(geometry, spec.sub)];
      /* aFur = 0 on the skin itself. Everything merged in after this says what
         it is in the same attribute: a shell says how far out it sits, an eye
         says -1. One attribute, one draw call, three behaviours. */
      const nSub = parts[0].attributes.position.count;
      parts[0].setAttribute('aFur', new THREE.Float32BufferAttribute(new Float32Array(nSub), 1));
      this.shells = 0;
      if (spec.fur) {
        const len = spec.fur.len / Math.max(1e-9, this.baseScale);   // metres -> model units
        for (const sh of furShells(vatSource, spec.fur.shells, len)) parts.push(sh);
        this.shells = spec.fur.shells;
      }
      if (spec.eyes) {
        const hi = merged.skinnedSource.skeleton.bones.findIndex(b => bareName(b.name) === 'Head');
        const eyes = hi >= 0 ? eyeGeometry(eyeAnchors(root, merged.skinnedSource, spec.eyes)) : null;
        if (eyes) { weldToBone(eyes, merged.skinnedSource, hi); parts.push(eyes); this.eyeBalls = true; }
      }
      const all = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
      if (all) {
        for (const g of parts) if (g !== all) g.dispose();
        geometry = all;
      }
    }

    /* Replace the six per-material skinned meshes with one merged one bound
       to the same skeleton. The armature hierarchy is untouched, so
       SkeletonUtils.clone() still produces working independent copies. */
    const src = merged.skinnedSource;
    const one = new THREE.SkinnedMesh(geometry, this._material());
    one.bind(src.skeleton, src.bindMatrix);
    one.castShadow = true;
    one.frustumCulled = false;    // a skinned bounding sphere is the bind pose
    src.parent.add(one);
    /* Everything that was merged comes out of the prototype, or the near tier
       draws each part twice — once inside the merge and once on its own. */
    for (const m of merged.taken) if (m.parent) m.parent.remove(m);
    this.proto = root;
    this.protoMesh = one;
    this.tris = geometry.index.count / 3;
    this.ratioAfter = this.reshape
      ? measureHeadRatio(one, geometry, this.reshape.headBone) : null;

    /* One decimated copy, shared by both far tiers and by every baked clip:
       the vertex ids the shader looks up are indices into THIS geometry, so
       a second decimation would silently mis-address every texel. */
    const small = decimate(vatSource, spec.cell);
    this.vatGeometry = small;
    this.farTris = small.index.count / 3;
    this.vat = {};
    let vatBytes = 0;
    for (const slot of VAT_CLIPS) {
      const clip = this.clips[spec.clips[slot]];
      if (!clip) continue;
      /* Bake off a throwaway rig so the prototype's own pose is left alone —
         bakeSprite below photographs it and would otherwise catch it
         mid-stride. */
      const rig = cloneRig(root);
      const rigMesh = rig.getObjectByProperty('isSkinnedMesh', true);
      rigMesh.geometry = small;
      const v = bakeVat(rig, rigMesh, small, clip, VAT_FRAMES);
      vatBytes += v.bytes;
      this.vat[slot] = v;
    }
    this.vatBytes = vatBytes;
    /* The distant sprite is ONE baked texture for the whole model, so a worker's
       vest has to be chosen for it here — the per-instance palette row that
       dresses the near and VAT tiers has nothing to instance over on a single
       photograph. `one.material` (from _material()) is used only by this bake;
       the near tier swaps in its own characterMaterial per clone. Setting the
       row before the bake render is what the palette shader compiles against. */
    if (spec.hivis && this.protoMesh && this.protoMesh.material.userData) {
      this.protoMesh.material.userData.palRow = HIVIS_SPRITE_ROW;
    }
    this.sprite = bakeSprite(renderer, root, spec.height);
  }

  /* ---- a Hunyuan model: one textured mesh, decimated, always instanced ----
     These files are a single primitive with a baked albedo, so the vertex
     colour trick the characters use would throw the texture away. They also
     arrive meshopt-compressed and position-quantised into an interleaved
     buffer, which nothing downstream can merge or scale — decimateTo() reads
     them through the attribute accessors and hands back plain float arrays,
     which is why it runs before anything is transformed. */
  _buildRigid(root, spec) {
    this.skinned = false;
    root.updateMatrixWorld(true);
    let mesh = null;
    root.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) throw new Error(`${this.id}: the model has no mesh`);

    /* Two versions, the same ladder the characters have. The near one is the
       file untouched — a 50,000-triangle car with its own normal map, which is
       what makes it read as a photograph of a car at four metres. The far one
       is welded down to `tris`, because thirty of the near one would be 1.5 M
       triangles a frame and 24 of the 30 are past forty-five metres anyway.
       Decimating everything to one middle level was tried first and is what
       the close shot caught: the near car came out visibly faceted with the
       texture torn across the welds. */
    const near = toPlainGeometry(mesh.geometry);
    this.rawTris = near.index.count / 3;
    const mid = decimateTo(mesh.geometry, spec.near).geometry;
    const cut = decimateTo(mesh.geometry, spec.tris);
    const far = cut.geometry;
    this.cell = cut.cell;

    const place = g => {
      g.applyMatrix4(mesh.matrixWorld);        // the node's own transform, folded in
      g.computeBoundingBox();
      const fit = spec.height / Math.max(1e-6, g.boundingBox.getSize(_v3).y);
      g.scale(fit, fit, fit);
      g.computeBoundingBox();
      /* THE SECOND DIAL, and only on the rows that carry it: `length`, in real
         metres nose to tail, applied along the model's own long horizontal
         axis after the height fit.

         Why a road vehicle needs one. `height` alone is a UNIFORM scale, and a
         uniform scale can only be right for a model whose proportions are
         already right. Kenney's cars are not: the sedan is 2.55 long against
         1.3 tall, a ratio of 1.96, where a real one is nearer 3.0. Scaled to a
         1.45 m roof it comes out 2.84 m long — a car the size of a bubble car
         — and scaled UP until it is 4.3 m long it is 2.19 m tall and 2.53 m
         wide, which is taller than the van beside it and wider than its lane.
         Neither dial alone can produce a vehicle that is both the right height
         and the right length, so there are two.

         This is not cosmetic. populate() sizes a lane's capacity off the
         LONGEST vehicle the road may carry, so a 41% short car packs 41% more
         of them onto the same street: measured 76 vehicles placed against the
         previous pack's 54, and 4 dropped against 26.

         The cost, stated rather than hidden: a stretch along one axis makes a
         cylindrical wheel an ellipse in side view. At the factors here (1.13
         to 1.65) that is visible in a close side-on shot of the lorry and not
         at street distance, and it is the smaller of the two errors — a car
         that is a third too short is wrong in the traffic simulation as well
         as on screen, and a car that is too tall is wrong from every angle. */
      if (spec.length) {
        const e = g.boundingBox.getSize(_v3);
        const onX = e.x > e.z;
        const s = spec.length / Math.max(1e-6, onX ? e.x : e.z);
        g.scale(onX ? s : 1, 1, onX ? 1 : s);
        g.computeBoundingBox();
      }
      /* Lift so the lowest vertex is the ground plane: a wheel through the road
         is the first thing anyone notices. */
      const drop = -g.boundingBox.min.y;
      /* Centre it horizontally as well. These models are not centred on their
         own origin, and two things depend on it: a vehicle turns about the
         point its matrix is composed around — an off-centre body swings its
         nose through the kerb at a junction — and the lamp placement below
         reads one half-length for both ends of the car. */
      const c = g.boundingBox.getCenter(_v3b);
      g.translate(-c.x, drop, -c.z);
      g.computeBoundingBox();
      return g;
    };
    place(near); place(mid); place(far);

    this.geometry = near;
    this.geometryMid = mid;
    this.geometryFar = far;
    this.material = rigidMaterial(mesh.material, spec);
    /* Whether this model may use the raw tier at all, and how far out its
       middle tier reaches. Both are read in _buildVehicleMeshes and both are
       measurements — see the STATICS catalogue. */
    this.noRaw = !!spec.noRaw;
    this.midBand = spec.midBand;
    this.tris = near.index.count / 3;
    this.midTris = mid.index.count / 3;
    this.farTris = far.index.count / 3;
    this.bbox = near.boundingBox.clone();
    this.baseScale = 1;

    /* Which horizontal axis the model's LENGTH runs along, MEASURED, and then
       `face` checked against it.

       This used to be inferred from `face` itself — length on X when face was
       a quarter turn, on Z otherwise — which cannot catch a wrong `face`,
       because it believes it. It believed the bus: the catalogue said a quarter
       turn, so `halfLength` was read off the bus's 1.5 m half-WIDTH and
       `halfWidth` off its 4.58 m half-length, the headlights were hung on its
       flanks, and the whole nine metres of it drove sideways down the street
       with nothing in the module able to notice.

       A road vehicle is longer than it is wide. That assumption is true of
       everything that DRIVES and false of half the street furniture — a bus
       shelter is wider than it is deep on purpose — so the check runs only on
       rows the catalogue marks `wheeled`. Measure which axis is longer, and
       require that `face` puts it on Z. A row that gets this wrong is corrected
       at load rather than trusted, because the failure it causes is a vehicle
       across the road and the fix is a quarter turn — the same quarter turn,
       every time.

       The SIGN is not measurable this way and is not touched: a bounding box
       cannot tell a bonnet from a boot, so front-to-back stays the catalogue's
       word. Only the AXIS is enforced. */
    const ext = this.bbox.getSize(_v3);
    const longOnX = ext.x > ext.z;
    const faceIsQuarter = Math.abs(Math.cos(this.face)) < 0.5;   // ±90°, not 0 or 180°
    if (spec.wheeled && longOnX !== faceIsQuarter) {
      console.warn(`life.js: ${this.id} face=${(this.face / Math.PI).toFixed(2)}pi puts its ` +
        `${longOnX ? 'X' : 'Z'} length (${Math.max(ext.x, ext.z).toFixed(2)} m) across the road; ` +
        `turning it a quarter. Fix the RIGID/STATICS row.`);
      this.face += Math.PI / 2;
    }
    /* Now that `face` is honest, the half-extents follow from it directly. */
    this.halfLength = (longOnX ? ext.x : ext.z) * 0.5;
    this.halfWidth = (longOnX ? ext.z : ext.x) * 0.5;
    /* The real metres a driver behind this thing has to leave. `_stepVehicles`
       reads it once per vehicle per frame and the accident staging reads it to
       place the ambulance, so it is stored rather than recomputed. */
    this.length = this.halfLength * 2;
  }

  _material() {
    /* envMapIntensity 0.6, not the default 1.0. Under the dusk HDRI a 0.8
       albedo panel at full IBL plus a 2.6-intensity sun lands above 1.0 after
       tone mapping, and an early pass rendered a blue car as a white one with
       a bloom halo round it. This is the value buildings.js uses on its own
       surfaces, so the crowd and the street sit in the same light. */
    if (this.palette) return characterMaterial(0);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.84, metalness: 0.0, envMapIntensity: 0.6,
    });
    /* An animal wears the procedural hide. `withFur` is true only here: the
       near tier is the one whose geometry carries the shells and the eyeballs,
       and a program compiled with `attribute float aFur` bound against a
       geometry that has none is a silent zero, not an error — which is exactly
       the kind of bug that only shows up as fur on the wrong tier. The cache
       key separates the two variants, because three's default key is the
       SOURCE of onBeforeCompile and both variants share one function. */
    if (this.hide) {
      patchHide(mat, this.hide, true);
      mat.customProgramCacheKey = () => 'life-hide-fur';
    }
    return mat;
  }
}

/* =========================================================================
   SECTION 8 — THE CROWD RENDERER
   One Crowd per character model. It owns a small pool of real SkinnedMeshes
   and one InstancedMesh per baked clip, and every frame the actors tell it
   where they are and which tier they earned.
   ========================================================================= */

class Crowd {
  constructor(entry, scene, cap) {
    this.entry = entry;
    this.pool = [];             // live SkinnedMesh + mixer, grown on demand
    this.group = new THREE.Group();
    this.group.name = `life-${entry.id}`;
    scene.add(this.group);

    /* The vertex-animation tier: one InstancedMesh per clip. Capacity is the
       whole population, because at a distance every one of them can be walking
       at the same time. */
    this.vat = {};
    for (const slot of Object.keys(entry.vat)) {
      const v = entry.vat[slot];
      const geo = this._farGeometry(v.verts);
      const im = new THREE.InstancedMesh(geo, vatMaterial(v, entry.palette, entry.hide), cap);
      im.frustumCulled = false;
      im.castShadow = false;    // the far tier is past every shadow camera here
      im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      phase.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      let pal = null;
      if (entry.palette) {
        pal = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        pal.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aPal', pal);
      }
      this.group.add(im);
      this.vat[slot] = { mesh: im, phase, pal, n: 0 };
    }

    /* The sprite tier. One quad, alpha-tested rather than blended so it needs
       no sorting against the buildings behind it. */
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const smat = new THREE.MeshBasicMaterial({
      map: entry.sprite.texture, transparent: true, alphaTest: 0.4,
      /* Tone mapping already ran when this texture was rendered. Letting it run
         a second time at draw washes the distant crowd out to pale grey. */
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.sprites = new THREE.InstancedMesh(quad, smat, cap);
    this.sprites.frustumCulled = false;
    this.sprites.count = 0;
    this.sprites.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.sprites);

    this.skinnedUsed = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);

  }

  /* One geometry per clip, but every one of them POINTS AT the same buffers.
     A BufferGeometry.clone() would copy 800 vertices twice for nothing; what
     actually has to differ between two clips is only the per-instance phase
     attribute, which the caller sets on the object this returns.

     Position and normal are read out of the texture at draw time and the
     values in these attributes are never used — but they have to be there,
     because three sizes the draw call and builds the bounding sphere from
     `position`. */
  _farGeometry(verts) {
    const proto = this.entry.vatGeometry;
    if (!this._vid) {
      const ids = new Float32Array(verts);
      for (let i = 0; i < verts; i++) ids[i] = i;
      this._vid = new THREE.BufferAttribute(ids, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(proto.index);
    g.setAttribute('position', proto.attributes.position);
    g.setAttribute('normal', proto.attributes.normal);
    g.setAttribute('color', proto.attributes.color);
    if (proto.attributes.aCls) g.setAttribute('aCls', proto.attributes.aCls);
    g.setAttribute('aVid', this._vid);
    return g;
  }

  beginFrame() {
    for (const k in this.vat) this.vat[k].n = 0;
    this.sprites.count = 0;
    this.spriteN = 0;
    this.skinnedUsed = 0;
  }

  /* Give one actor a real skeleton. The pool grows to MAX_SKINNED across all
     crowds together, which the Life object enforces before it calls this. */
  takeSkinned(actor) {
    let slot = this.pool[this.skinnedUsed];
    if (!slot) {
      const obj = cloneRig(this.entry.proto);
      const mesh = obj.getObjectByProperty('isSkinnedMesh', true);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      /* Its own material, so this pooled skeleton can wear this actor's
         palette row. cloneRig hands out a reference to the prototype's. */
      if (this.entry.palette) mesh.material = characterMaterial(0);
      const mixer = new THREE.AnimationMixer(obj);
      slot = { obj, mesh, mixer, action: null, clipName: null };
      this.group.add(obj);
      this.pool.push(slot);
    }
    /* A pooled skeleton is handed to a different actor from one frame to the
       next, so the row is re-stamped every time rather than once at creation.
       The uniform only exists after the shader has compiled — until then the
       userData value is what the compile will read. */
    if (this.entry.palette) {
      const m = slot.mesh.material;
      m.userData.palRow = actor.pal;
      for (const s of m.userData.shaders || []) s.uniforms.uPalRow.value = actor.pal;
    }
    this.skinnedUsed++;
    slot.obj.visible = true;
    return slot;
  }

  /* Anything the pool did not hand out this frame has to be hidden, or the
     last position a character stood in stays on screen as a statue. */
  endFrame() {
    for (let i = this.skinnedUsed; i < this.pool.length; i++) this.pool[i].obj.visible = false;
    for (const k in this.vat) {
      const v = this.vat[k];
      v.mesh.count = v.n;
      v.mesh.instanceMatrix.needsUpdate = true;
      v.phase.needsUpdate = true;
      if (v.pal) v.pal.needsUpdate = true;
    }
    this.sprites.count = this.spriteN;
    this.sprites.instanceMatrix.needsUpdate = true;
  }

  pushVat(slot, pos, yaw, phase, scale, pal) {
    const v = this.vat[slot] || this.vat.idle;
    if (!v || v.n >= v.mesh.instanceMatrix.count) return;
    this._q.setFromAxisAngle(UP, yaw);
    this._s.set(scale, scale, scale);
    v.mesh.setMatrixAt(v.n, this._m.compose(pos, this._q, this._s));
    v.phase.setX(v.n, phase);
    if (v.pal) v.pal.setX(v.n, pal || 0);
    v.n++;
  }

  pushSprite(pos, camera, height) {
    if (this.spriteN >= this.sprites.instanceMatrix.count) return;
    const yaw = Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z);
    this._q.setFromAxisAngle(UP, yaw);
    this._s.set(height * this.entry.sprite.aspect, height, 1);
    this.sprites.setMatrixAt(this.spriteN, this._m.compose(pos, this._q, this._s));
    this.spriteN++;
  }

  /* Every VAT material carries its own clock; one call a frame keeps the whole
     distant crowd walking. */
  advance(t) {
    for (const k in this.vat) {
      const shaders = this.vat[k].mesh.material.userData.shaders;
      for (const s of shaders) s.uniforms.uTime.value = t;
    }
  }
}

/* =========================================================================
   SECTION 9 — THE ROAD NETWORK
   A polyline in, two lanes out: one each way, offset to its own side. Vehicles
   are points on a lane with an arc length, which is what makes "slow down
   behind the car in front" a one-line comparison rather than a physics
   problem.
   ========================================================================= */

/* Personal space, and why 0.6 was the wrong number.

   The separation solver was converging: `stats().overlap` read zero pairs per
   second over 600 frames on 2026-09-07, and people still walked through each
   other in Beri's recording. The solver was right and the CRITERION was wrong.
   The posed, drawn body of a walking person was measured off the skinned mesh
   in the same run — bone transforms applied, sampled every few vertices — and
   its horizontal footprint is 0.72 m to 1.24 m across as the arms and legs
   swing, ~0.9 m for a walker mid-stride. Two of those with 0.6 m between their
   centres overlap by a third of a metre, which is an arm through a shoulder.

   0.9 is the measured swept width, so it is what personal space has to be. It
   is also, for what it is worth, roughly where pedestrian-comfort figures put
   it — but the number here comes from this street's own models. */
const SEPARATION = 0.9;     // metres of personal space between two pedestrians
/* And how much MORE space a walker wants than a stander. The separation gate is
   measured against SEPARATION flat, so the solver has to resolve to at least
   that or it can never read zero; resolving to slightly MORE is what leaves the
   fixed point slack enough to survive the corridor and obstacle projections
   that run in the same loop. It is also true of a pavement: somebody at a shop
   window stands closer to a stranger than two people striding past each other
   do. Scaled on the walker's own speed, so a stopped person contributes
   nothing extra and a pair at full stride keeps 1.01 m. */
const SEP_SPEED = 0.12;     // fraction of SEPARATION added at full walking speed
const SEP_ROUNDS = 26;      // relaxation rounds the constraint loop may spend
/* Once separation is CLEAN (zero overlapping pairs on the drawn positions), the
   loop only needs a couple more projection rounds to settle any residual
   penetration the pre-sweeps left — but the corridor clamp's 0.35 m dead zone
   never stops nudging people back onto their line, so `moved` never reaches zero
   and the loop would otherwise burn its whole 26-round budget EVERY frame doing
   nothing anybody can see. That is the stress scene's 0.60 fps. Capping the
   post-convergence settling at three rounds is what brings the frame rate back
   into band; the sub-clamp drift is redone next frame regardless. The budget is
   still the full 26 while there are pairs left to separate. */
const SETTLE_ROUNDS = 3;    // projection rounds allowed AFTER overlaps hit zero
const OFF_TAPER = 2.5;      // metres of a hop's end over which the lane offset fades to 0
const LANE_HALF = 2.6;      // metres from the centre line to a lane's centre
/* The obstacle layer, added 2026-09-07 because Beri filmed a pedestrian walking
   through a pavement railing and another through a parked car.

   PED_R is HALF the measured swept width above — the radius of the capsule a
   walking person occupies — and it is the number every clearance in this file
   is written against, so a body never overlaps a hedge, a bench, a railing or a
   bonnet by so much as a centimetre.

   OB_CELL is the obstacle grid's cell. Two metres is wider than every prop this
   module places except the fountain and the playground, so a query touches nine
   cells and finds everything that can possibly matter; finer cells cost memory
   for nothing on a street that is mostly empty pavement.

   VEH_CLEAR is the extra metre a walker keeps off a MOVING box before it will
   step: a car is not a bollard, and somebody who steps exactly to the paintwork
   of something doing eight metres a second has misjudged it. */
const PED_R = 0.45;         // metres — the pedestrian capsule's own radius
const OB_CELL = 2.0;        // metres — the static obstacle grid's cell
const VEH_CLEAR = 0.9;      // metres of daylight a walker keeps off a vehicle box
const SEG_CELL = 8.0;       // metres — the lane-segment grid's cell
const CORRIDOR_SLACK = 0.35; // metres a walker may sit outside its corridor before it is pulled back
/* Following distance, and why it is no longer two flat numbers.
   A single CAR_GAP/CAR_STOP pair was measured wrong on 2026-09-07: it stopped
   every driver six metres behind whatever was in front, and a bus is 9.16 m
   long, so a bus at rest behind a bus had three metres of itself inside the
   one ahead. The overlap probe read overlapping pairs on 600 frames out of 600.

   The rule now has the two parts the street actually has:
   - CAR_CLEAR is the bumper-to-bumper gap at a standstill. Everything else is
     derived from the two vehicles' own measured lengths, so a bus keeps a
     bus's distance and a car keeps a car's.
   - CAR_HEADWAY is the seconds of road a moving driver wants on top of that.
     Time and not distance, which is what makes the gap speed-dependent without
     a second constant. */
const CAR_CLEAR = 1.5;      // metres of daylight between two stopped bumpers
const CAR_HEADWAY = 0.9;    // seconds of road a moving driver wants as well
const JUNCTION_R = 9.0;     // how close two roads have to pass to be a junction
/* Half the crossing carriageway a stopped nose has to stay behind. A red light
   used to set `target = 0` the instant a driver was six metres from the middle
   of the junction, and a target is not a stop: a van doing 8 m/s needs three
   and a half metres to shed it, so it came to rest two and a half metres short
   of the middle with 2.49 m of van in front of its own centre — nose at 3.5 m,
   inside the 5.5 m half-width of the road it was supposed to be giving way to.
   That is the stationary vehicle the side street then drove through, and it is
   327 frames out of 600 in the overlap probe, not a transient. The stop is now
   a distance ramp to a real stop LINE, exactly like the zebra's above. */
const JUNCTION_BOX = 2 * LANE_HALF + 0.5;  // metres from the junction's middle to its stop line
const JUNCTION_READ = 20.0; // metres out a driver starts reading the signal
const GREEN = 9.0;          // seconds each road holds the junction
const AMBER = 2.5;          // of those, the last ones in which the junction clears itself
const TURN_RATE = 0.35;     // how often a car at a junction leaves its own road
/* Zebra crossings. A crossing is put on each approach to a junction, which is
   where a real one is, and it is the only place the pavement graph reaches
   across the carriageway at all — without it the two pavements of a street are
   two disconnected components and no errand can ever change sides. */
const CROSS_BACK = 11.0;    // metres back from the junction's middle the zebra sits
const CROSS_CLEAR = 9.0;    // metres of clear lane a pedestrian wants before stepping off
const CROSS_YIELD = 15.0;   // how far out a driver reads a zebra with someone at it
const CROSS_COMMIT = 5.0;   // inside this a driver is going through: too late to stop
const ZEBRA_HALF = 1.5;     // half the painted width of a crossing
const CROSS_CAP = 10;       // how many people one crossing holds at 0.9 m of personal space
const CROSS_STOPLINE = 2.0; // metres between a stopped bumper and the zebra's near edge
const JAY_CLEAR = 2.5;      // metres a driver leaves in front of somebody in the road

/* The pedestrian day, as a cycle: home, a shop door, a bench, the plaza, home.
   One constant read by both ends of it — `_pedestrian()` seeds a fresh walker
   onto a random stage of it (see there for why) and `_nextErrand()` walks it
   forward one stage at a time. */
const ROUND = { home: 'shop', shop: 'bench', bench: 'plaza', plaza: 'home' };
const ROUND_SEED = Object.keys(ROUND);

class Lane {
  constructor(points, dir, weight, road) {
    this.dir = dir;
    this.road = road;
    this.weight = weight;
    this.pts = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    this.length = this.cum[this.cum.length - 1];
    this.cars = [];
    /* The lane's overall heading, used only to work out which way a car is
       turning when it leaves one lane for another — end minus start, which is
       exact on the straight runs a street grid is made of. */
    this.head = new THREE.Vector3().subVectors(points[points.length - 1], points[0]);
    this.head.y = 0;
    this.head.normalize();
  }

  /* Position and heading at arc length s. Writes into `out` to keep this off
     the allocation path — it runs once per vehicle per frame. */
  at(s, out, headingOut) {
    s = clamp(s, 0, this.length);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
    out.lerpVectors(this.pts[i - 1], this.pts[i], t);
    if (headingOut) headingOut.subVectors(this.pts[i], this.pts[i - 1]).normalize();
    return out;
  }
}

/* Offset a centre line sideways by `off` metres. The normal is taken from the
   average of the two segments at each joint, so an offset polyline does not
   pull apart at a corner. */
function offsetLine(points, off) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out.push(new THREE.Vector3(points[i].x + (dz / len) * off, points[i].y, points[i].z - (dx / len) * off));
  }
  return out;
}

/* A soft round falloff, generated once. An additive QUAD with no falloff is
   a glowing postage stamp floating in front of the bumper; the whole read of a
   headlight is its edge. `stops` lets the same generator make the contact
   shadow, which wants the opposite curve — solid in the middle, gone by the
   rim, and much softer at the centre than a lamp. */
const _canvasTex = {};
function radialTexture(name, stops) {
  if (_canvasTex[name]) return _canvasTex[name];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [at, col] of stops) g.addColorStop(at, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  _canvasTex[name] = t;
  return t;
}
const glowTexture = () => radialTexture('glow', [
  [0, 'rgba(255,255,255,1)'], [0.28, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
const blobTexture = () => radialTexture('blob', [
  [0, 'rgba(0,0,0,0.55)'], [0.45, 'rgba(0,0,0,0.30)'], [1, 'rgba(0,0,0,0)']]);

/* Contact shadows. BLOB_RANGE is where one stops being readable as contact and
   starts being a smudge on the pavement; BLOB_Q lays the disc flat. */
const BLOB_RANGE = 190;
const BLOB_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/* =========================================================================
   SECTION 10 — THE PUBLIC OBJECT
   ========================================================================= */

export class Life {

  /* ---- load -------------------------------------------------------------
     Fetches the manifest, loads every model in the catalogue, merges,
     decimates and bakes. Everything after this is synchronous. */
  static async load(renderer, scene, opts = {}) {
    const life = new Life();
    life.renderer = renderer;
    life.scene = scene;
    life.getHeight = opts.getHeight || (() => 0);
    life.rand = rng(opts.seed || 1);
    /* `_findPerches()` raycasts the scene, and three's `Sprite.raycast` needs
       `raycaster.camera` to orient the billboard — a bare `new
       THREE.Raycaster()` has none, so any sprite in the scene (a town-name
       plaque, a drone tag) threw and aborted `buildLife()` before `populate()`
       ran (docs/HANDOFF.md, "the island is alive" pass). The host's own camera
       is the right one to hand it; a throwaway stands in when none is given so
       the raycast still has something to orient against. */
    life.camera = opts.camera || new THREE.PerspectiveCamera();
    /* The three LOD numbers are settings and not constants because they are
       the only dial that trades frame rate against how close a real skeleton
       gets, and the host is the only thing that knows what its scene can
       afford. The defaults are the documented ones. */
    life.maxSkinned = opts.maxSkinned !== undefined ? opts.maxSkinned : MAX_SKINNED;
    life.nearBand = opts.near !== undefined ? opts.near : NEAR;
    life.shadowBudget = opts.shadows !== undefined ? opts.shadows : MAX_SHADOW;
    life.rigidBudget = opts.rigid !== undefined ? opts.rigid : RIGID_BUDGET;
    /* TOLERANT FROM HERE DOWN, and it was not before. Every step of this load
       used to throw: a missing manifest, a missing row, a row with no
       heightUnits, a 404 on the file. One rejection anywhere aborted the whole
       load, so ONE absent model cost the entire living layer — no crowd, no
       traffic, no herd, on every host, and because nobody awaits this the
       street simply came up empty with a rejected promise nobody saw.

       The old strictness had a real argument behind it: a model that quietly
       vanishes is a model nobody notices is gone. That argument is answered by
       the warning below rather than by the throw. It names every key it
       skipped, once, and the catalogue that could not be filled at all — see
       assets/fetch_assets.py, whose CC0 set deliberately leaves five subjects
       and the thirteen landmarks empty because no CC0 equivalent exists.

       What makes skipping SAFE is that nothing downstream dereferences a model
       it does not have: `_deckFor()` deals only from types that loaded,
       `_prop()` and `park()` refuse a type they have no model for, and
       `_buildVehicleMeshes()` / `_buildCrowds()` skip one. Audited, all
       fifteen `this.models[...]` sites, 2026-09-08. */
    const manifestUrl = opts.manifestUrl || 'assets/manifest.json';
    const missing = [];
    try {
      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      life.manifest = await res.json();
    } catch (e) {
      /* No manifest at all is the empty-assets-folder case: a fresh clone
         before `python assets/fetch_assets.py` has run. Everything below skips
         and the host still gets a world, an empty one. */
      console.warn(`life.js: ${manifestUrl} could not be read (${e.message}); ` +
        'the living layer will be empty. Run assets/fetch_assets.py.');
      life.manifest = {};
    }

    const base = manifestUrl.replace(/[^/]*$/, '');
    await MeshoptDecoder.ready;
    const loader = new GLTFLoader().setPath(base).setMeshoptDecoder(MeshoptDecoder);
    const load = p => new Promise((res, rej) => loader.load(p, res, undefined, rej));

    life.models = {};
    const all = [...Object.entries(CHARACTERS), ...Object.entries(RIGID), ...Object.entries(STATICS)];
    const loaded = (await Promise.all(all.map(async ([id, spec]) => {
      const rec = life.manifest[spec.key];
      if (!rec) { missing.push(`${spec.key} (no manifest row)`); return null; }
      /* The rigid rows state their own height in model units. It is not used to
         scale anything — the bounding box is measured at load, which is the
         only reading that survives a re-generated file — but a row that has
         lost it has probably lost the file too, so it is treated as absent. */
      if (spec.tris !== undefined && !(rec.heightUnits > 0)) {
        missing.push(`${spec.key} (no heightUnits)`);
        return null;
      }
      try {
        return [id, spec, await load(rec.path)];
      } catch (e) {
        missing.push(`${spec.key} -> ${rec.path}`);
        return null;
      }
    }))).filter(Boolean);
    if (missing.length) {
      console.warn(`life.js: ${missing.length} of ${all.length} models were not loaded and ` +
        `are skipped — run assets/fetch_assets.py --cc0 if this is unexpected. ` +
        `Skipped: ${missing.join(', ')}`);
    }
    life.missingModels = missing;

    /* Sequential on purpose: every skinned entry bakes a sprite through the
       renderer, and two render-target swaps interleaved on one renderer is a
       class of bug that only shows up as a blank sprite.

       YIELDING BETWEEN ENTRIES is what makes "started and not awaited" mean
       anything. Every host starts this load without awaiting it precisely so
       the world draws long before the crowd arrives — but a ModelEntry
       decimates a 50,000-triangle mesh three times, and eighteen of them in one
       uninterrupted loop is 8.7 s in which the main thread runs nothing else:
       no frame, no fetch handler, no building. Measured on
       `index.html?project=e6a8abd1`: the streets themselves did not paint until
       9.0 s with the crowd loading and 1.0 s with `?life=0` (docs/TESTS.md D4).
       A macrotask between entries hands the frame loop and the host's own boot
       back to the browser after each model. Order is untouched — the loop is
       still one entry at a time on one renderer — and so is the result. */
    for (const [id, spec, gltf] of loaded) {
      life.models[id] = new ModelEntry(id, spec, gltf, renderer);
      await new Promise(r => setTimeout(r, 0));
    }

    /* Kept so the ambulance can be loaded the first time an error is reported
       rather than on every page that will never have one. */
    life._loadGLB = load;

    life._buildStatics();
    return life;
  }

  constructor() {
    this.roads = [];
    this.lanes = [];
    this.junctions = [];
    this.walk = { nodes: [], edges: [], doors: [], shops: [], homes: [], seats: [], plazas: [] };
    /* Where the pavement graph crosses the carriageway, and the plazas cars are
       not allowed into. Both are empty until the host says otherwise: a module
       that invented a pedestrian zone would be inventing a population's worth
       of behaviour out of nothing, which is the one thing this file does not
       do. */
    this.crossings = [];
    this.carFree = [];
    this.plazaSpecs = [];
    /* The separation probe, accumulated so the harness can read a RATE. */
    this.overlap = { pairs: 0, peak: 0, sum: 0, frames: 0, time: 0 };
    /* The obstacle layer. `hostObstacles` is what addObstacles() was told —
       a railing, a fence, a tree trunk: things the HOST put in the scene and
       this module would otherwise never hear about. `obstacles` is the flat
       list of circles built from those PLUS every prop and every bench, and
       `obGrid` buckets them so a walker's clearance test is nine cells and not
       a scan of eight hundred bushes. `edgeSpan` is the free lateral interval
       left on each pavement edge once the obstacles beside it are subtracted —
       the reroute, computed once at build time. `penetration` is the probe. */
    this.hostObstacles = [];
    this.obstacles = [];
    this.obGrid = new Map();
    this.edgeSpan = new Map();
    this.penetration = { now: 0, peak: 0, sum: 0, frames: 0, time: 0, worst: 0 };
    this.walkHalf = 0.9;    // half the pavement, until addWalkways is told better
    this.pastures = [];
    this.actors = [];       // everything with a skeleton: people, animals, robots
    this.vehicles = [];
    this.parked = [];
    /* Vehicles the HOST parked at a fixed spot with park() — the site van that
       stands AT the printing building, not merely pulled near by road weight.
       Unlike `parked` (bicycles, counted into the instanced pool at populate()
       time) a host van may be dropped at any time and any count, so each is its
       own plain Mesh in the group — the same choice the ambulance makes, for the
       same reason: a population of a few does not earn an InstancedMesh, three
       tiers and a slot in the raw-detail budget. Its box joins _vehicleBoxes(),
       so the crowd steps round it like any stopped car. */
    this.hostParked = [];
    /* Everything that stands still: plaza and street props, the hedges, and
       the standing half of every herd. One record each — position, yaw, scale
       — written once when it is placed and read every frame by the same rigid
       ladder the traffic uses. `dogs` is separate because a dog is the one
       static model here whose POSITION moves: it is carried by a pedestrian. */
    this.props = [];
    this.dogs = [];
    this.birds = null;
    this.crowds = {};
    this.night = 0;
    this.time = 0;
    this.agents = [];
    /* The one accident that may be in flight, and the ambulance that answers
       it. Both null until the host reports a real error — see reportError(). */
    this.accident = null;
    this.ambGroup = null;
    this.counts = { humans: 0, cars: 0, robots: 0, sheep: 0, cows: 0, birds: 0, parrots: 0 };
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /* ---- the pieces that exist before anything is populated --------------- */
  _buildStatics() {
    this.group = new THREE.Group();
    this.group.name = 'life';
    this.scene.add(this.group);

    /* Vehicles: one InstancedMesh per type, capacity grown by populate(). */
    this.vehicleMeshes = {};

    /* Headlights and tail lights: one additive quad each, all types on one
       InstancedMesh, coloured per instance. Off entirely during the day, which
       is one `count = 0` rather than a material swap. */
    const lampGeo = new THREE.PlaneGeometry(1, 1);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }), 640);
    this.lamps.frustumCulled = false;
    this.lamps.count = 0;
    this.lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(640 * 3), 3);
    this.group.add(this.lamps);

    /* The contact shadows, one flat disc each, all on one InstancedMesh.
       depthWrite off so two overlapping blobs do not cut holes in each other;
       the disc is transparent everywhere except its middle. */
    const blobGeo = new THREE.PlaneGeometry(1, 1);
    this.blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false,
      toneMapped: false, opacity: 0.85,
    }), 512);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    this.blobs.renderOrder = -1;   // under everything that stands on it
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.blobs);
  }

  /* =======================================================================
     ROADS — vehicles follow these, one lane each way, and stop at junctions
     ======================================================================= */

  /* `polylines` is an array of point lists. A point is [x, y, z]; the list may
     carry a `weight` property (a link weight from the real graph) which is the
     ONLY thing that decides how much traffic that road gets. An object of the
     shape { points, weight } is accepted too.

     Three more optional properties decide WHAT that traffic is, and they are
     the host's to set because only the host knows what its network means —
     see _deckFor() for the rules they feed:
       lanes       how many lanes the carriageway has (default 2)
       settlement  'hamlet' | 'village' | 'town' | 'city' (default 'town')
       field       true for a farm track
     A caller that sets none of them gets the two-lane town street this module
     has always drawn. */
  addRoads(polylines) {
    for (const raw of polylines) {
      const pts = (raw.points || raw).map(p => new THREE.Vector3(p[0], p[1] || 0, p[2]));
      if (pts.length < 2) continue;
      this.roads.push({ pts, weight: raw.weight !== undefined ? raw.weight : 1,
                        lanes: raw.lanes, settlement: raw.settlement, field: raw.field });
    }
    this._buildLanes();
    return this;
  }

  /* =======================================================================
     PLAZAS — an open place, and whether traffic may be in it
     `addPlaza([x,y,z], radius, { carsAllowed: false, seats })`. Two separate
     jobs, and they are one call because they are one THING on the ground:
       - people: it is a gathering place, wired into the pavement graph by
         addWalkways the same way the plazas passed to that call are;
       - cars: `carsAllowed: false` cuts every road that crosses it OUT of the
         lane graph, so a market square stops being a road with people
         standing in it.
     The cut is the honest half of the alternative the brief allowed — routing
     the traffic around would need a road that goes around, and inventing one
     is exactly the kind of geometry this module is not allowed to make up.
     Call it BEFORE populate(); calling it after addRoads is fine, the lanes
     are simply rebuilt. */
  addPlaza(center, radius, opts = {}) {
    const c = center.center || center;
    const r = radius !== undefined ? radius : (center.radius || 6);
    this.plazaSpecs.push({ center: [c[0], c[1] || 0, c[2]], radius: r, seats: opts.seats || [] });
    if (opts.carsAllowed === false) {
      this.carFree.push({ x: c[0], z: c[2], r });
      if (this.roads.length) { this._buildLanes(); this._laneZebras(); }
    }
    /* The furniture, after the lane cut: the kiosk and the shelter are placed
       against the OPEN lanes, so they have to be placed after the zone has
       taken its bite out of them or a shelter lands on a stretch of road that
       no longer exists. */
    this._plazaProps(c[0], c[2], r, opts);
    return this;
  }

  /* Two lanes per road, one each way — minus whatever falls inside a
     pedestrian zone. Split out of addRoads because addPlaza can arrive after
     the roads have, and re-cutting is the only correct answer to that. */
  _buildLanes() {
    this.lanes.length = 0;
    for (let road = 0; road < this.roads.length; road++) {
      const { pts, weight } = this.roads[road];
      for (const piece of this._openStretches(pts)) {
        if (piece.length < 2) continue;
        this.lanes.push(new Lane(offsetLine(piece, LANE_HALF), 1, weight, road));
        this.lanes.push(new Lane(offsetLine([...piece].reverse(), LANE_HALF), -1, weight, road));
      }
    }
    this._findJunctions();
    if (this.crossings.length) this._laneZebras();
  }

  /* The stretches of one road that are NOT inside a car-free plaza. The cut is
     analytic — each segment is intersected with each circle and split at the
     roots — rather than sampled, because a lane that ends a metre inside the
     paving is a car parked on the flagstones and everyone can see it. */
  _openStretches(pts) {
    if (!this.carFree.length) return [pts];
    const inside = (x, z) => this.carFree.some(k => {
      const dx = x - k.x, dz = z - k.z;
      return dx * dx + dz * dz < k.r * k.r;
    });
    const out = [];
    let run = [];
    const flush = () => { if (run.length >= 2) out.push(run); run = []; };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const cuts = [0, 1];
      for (const k of this.carFree) {
        /* |a + t(b-a) - centre|^2 = r^2, in the ground plane. */
        const fx = a.x - k.x, fz = a.z - k.z;
        const A = dx * dx + dz * dz;
        const B = 2 * (fx * dx + fz * dz);
        const C = fx * fx + fz * fz - k.r * k.r;
        const disc = B * B - 4 * A * C;
        if (A < 1e-9 || disc <= 0) continue;
        const sq = Math.sqrt(disc);
        for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
          if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t);
        }
      }
      cuts.sort((x, y) => x - y);
      for (let c = 0; c < cuts.length - 1; c++) {
        const t0 = cuts[c], t1 = cuts[c + 1];
        if (t1 - t0 < 1e-6) continue;
        const m = (t0 + t1) * 0.5;
        if (inside(a.x + dx * m, a.z + dz * m)) { flush(); continue; }
        if (!run.length) run.push(a.clone().lerp(b, t0));
        run.push(a.clone().lerp(b, t1));
      }
    }
    flush();
    return out;
  }

  /* Where two roads pass within JUNCTION_R of each other is a junction. That is
     not the same thing as a true geometric intersection, and it does not need
     to be: what a junction is FOR here is a lock that stops two cars crossing
     the same patch of tarmac at the same moment. */
  _findJunctions() {
    this.junctions.length = 0;
    for (let a = 0; a < this.roads.length; a++) {
      for (let b = a + 1; b < this.roads.length; b++) {
        for (const p of this.roads[a].pts) {
          for (const q of this.roads[b].pts) {
            if (p.distanceTo(q) > JUNCTION_R) continue;
            const mid = p.clone().add(q).multiplyScalar(0.5);
            if (this.junctions.some(j => j.pos.distanceTo(mid) < JUNCTION_R)) continue;
            /* `roads` is the list of roads that meet here, and the signal below
               gives each of them GREEN seconds in turn. */
            this.junctions.push({ pos: mid, roads: [a, b] });
          }
        }
      }
    }
    /* Each lane remembers the arc length at which it meets each junction, so a
       driver's check is a subtraction rather than a search. */
    for (const lane of this.lanes) {
      lane.stops = [];
      for (const j of this.junctions) {
        let best = Infinity, bestS = 0;
        for (let i = 0; i < lane.pts.length; i++) {
          const d = lane.pts[i].distanceTo(j.pos);
          if (d < best) { best = d; bestS = lane.cum[i]; }
        }
        if (best < JUNCTION_R * 1.4) lane.stops.push({ j, s: bestS });
      }
      lane.stops.sort((x, y) => x.s - y.s);
    }
  }

  /* =======================================================================
     WALKWAYS — where people go
     `polylines` are pavements. `plazas` are open places people gather in:
     { center:[x,y,z], radius, seats?:[[x,y,z,yaw], ...] }. A walkway's loose
     END is treated as a door — that is what a pavement stub off the main run
     IS on a street, and it is where a pedestrian pauses.
     ======================================================================= */
  addWalkways(polylines, plazas = [], opts = {}) {
    /* How wide the host's pavement actually is. The module cannot know it —
       it is handed a centre line, not a kerb — and it is the difference
       between a crowd on the flagstones and a crowd on the lawn beside them.
       0.35 of the width, so nobody's shoulder hangs over the kerb. */
    if (opts.width > 0) this.walkHalf = opts.width * 0.35;
    /* Hedges along the pavement. Planted at the end of this call, after the
       whole graph exists, because the side they go on is decided against the
       lanes and against nothing in this loop. */
    const hedge = opts.bushes || 0;
    const nodeAt = p => {
      const v = new THREE.Vector3(p[0], p[1] || 0, p[2]);
      for (let i = 0; i < this.walk.nodes.length; i++) {
        if (this.walk.nodes[i].pos.distanceTo(v) < 0.75) return i;
      }
      this.walk.nodes.push({ pos: v, links: [] });
      return this.walk.nodes.length - 1;
    };
    for (const raw of polylines) {
      const pts = raw.points || raw;
      let prev = -1;
      for (const p of pts) {
        const i = nodeAt(p);
        if (prev >= 0 && prev !== i) {
          this.walk.nodes[prev].links.push(i);
          this.walk.nodes[i].links.push(prev);
        }
        prev = i;
      }
    }
    /* Plazas passed here and plazas registered by addPlaza() are the same
       thing to a pedestrian, so they are wired in together. */
    for (const pz of plazas.concat(this.plazaSpecs)) {
      const c = pz.center || pz.centre;
      const i = nodeAt(c);
      this.walk.plazas.push({ node: i, pos: this.walk.nodes[i].pos, radius: pz.radius || 6 });
      /* Wire the plaza into whatever pavement runs past it, or people can walk
         to it and never leave. */
      for (let k = 0; k < this.walk.nodes.length; k++) {
        if (k === i) continue;
        if (this.walk.nodes[k].pos.distanceTo(this.walk.nodes[i].pos) < (pz.radius || 6) + 6) {
          this.walk.nodes[i].links.push(k);
          this.walk.nodes[k].links.push(i);
        }
      }
      for (const s of pz.seats || []) {
        this.walk.seats.push({ pos: new THREE.Vector3(s[0], s[1] || 0, s[2]), yaw: s[3] || 0, taken: false });
      }
    }
    /* The hedge, spread over every pavement run in proportion to its length —
       so the long main pavement gets most of them and a two-metre door stub
       gets none, which is where a hedge actually is. */
    if (hedge > 0) {
      const runs = polylines.map(r => r.points || r).filter(p => p.length > 2);
      const len = runs.map(r => {
        let L = 0;
        for (let i = 1; i < r.length; i++) L += Math.hypot(r[i][0] - r[i - 1][0], r[i][2] - r[i - 1][2]);
        return L;
      });
      const total = len.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < runs.length; i++) {
        this._plantHedge(runs[i], Math.round((hedge * len[i]) / total), false);
      }
    }
    this.walk.doors = this.walk.nodes
      .map((n, i) => (n.links.length === 1 ? i : -1))
      .filter(i => i >= 0);
    /* A door is a front door or it is a shop door, and an errand needs to know
       which. Every third one is a shop — a street with a third of its ground
       floor in trade is a small town's high street, and the alternative is a
       parameter the host would have to invent a number for. Deterministic on
       the door ORDER, not on the seed, so the same street always has the same
       shops in it and two screenshots of it match. */
    this.walk.shops = this.walk.doors.filter((_, i) => i % 3 === 0);
    this.walk.homes = this.walk.doors.filter((_, i) => i % 3 !== 0);
    this._findCrossings();
    return this;
  }

  /* =======================================================================
     ZEBRA CROSSINGS — where the pavement graph reaches across the road
     One on each approach to each junction, which is where a crossing is. Both
     halves matter and they are the same object: a pedestrian waits at it until
     the lane is clear, and a driver reading it occupied comes off the
     accelerator.

     Found rather than declared, because the host gives this module a road
     centre line and two pavements and nothing that says which pavement node
     faces which. The search is: stand back CROSS_BACK metres from the
     junction along the road, then take the nearest pavement node on each SIDE
     of the centre line.
     ======================================================================= */
  _findCrossings() {
    this.crossings = [];
    const nodes = this.walk.nodes;
    if (!nodes.length || !this.junctions.length) return;
    const dir = new THREE.Vector3(), right = new THREE.Vector3(), off = new THREE.Vector3();
    for (const j of this.junctions) {
      for (const road of j.roads) {
        const pts = this.roads[road] ? this.roads[road].pts : null;
        if (!pts) continue;
        /* The road's own direction where it meets this junction. */
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const d = pts[i].distanceTo(j.pos);
          if (d < bd) { bd = d; bi = i; }
        }
        dir.subVectors(pts[Math.min(pts.length - 1, bi + 1)], pts[Math.max(0, bi - 1)]);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) continue;
        dir.normalize();
        right.set(dir.z, 0, -dir.x);
        for (const side of [-1, 1]) {
          const at = j.pos.clone().addScaledVector(dir, side * CROSS_BACK);
          let A = -1, B = -1, da = Infinity, db = Infinity;
          for (let i = 0; i < nodes.length; i++) {
            off.subVectors(nodes[i].pos, at);
            off.y = 0;
            const lat = off.dot(right), lon = Math.abs(off.dot(dir));
            /* On the pavement beside THIS approach: within a few metres along
               the road, off the carriageway but not out in the field, and
               clear of the centre line so a node ON the road cannot be picked
               as either side of it. */
            if (lon > 6.5 || Math.abs(lat) > 13 || Math.abs(lat) < 2.5) continue;
            /* Scored on `lon` ALONE — how far the node is ALONG this road from
               the zebra line — and not on straight-line distance. Distance
               picked the crossing road's own pavement: at the junction of two
               streets a node of the OTHER street sits four metres off the
               centre line and three along it, which beats the node this road's
               own kerb has seven metres off it, and the zebra then linked two
               pavements that were already connected while the far side of this
               road stayed an island. `__counts().walk.components` is what
               caught it: three pieces, and only the small one crossable. */
            if (lat > 0 && lon < da) { da = lon; A = i; }
            if (lat < 0 && lon < db) { db = lon; B = i; }
          }
          if (A < 0 || B < 0) continue;
          /* Idempotent, and the LINK is not the test. This runs twice — once
             from addWalkways and once from populate, so a host that adds its
             roads after its pavements still gets crossings — and the second
             run rebuilds the list from empty. Testing `links.includes(B)`
             made that second run skip every pair it had linked on the first
             and hand back zero crossings, which is silent: the pavement graph
             still reached across the road, and nobody ever waited at a kerb. */
          if (this.crossings.some(c => (c.a === A && c.b === B) || (c.a === B && c.b === A))) continue;
          if (!nodes[A].links.includes(B)) { nodes[A].links.push(B); nodes[B].links.push(A); }
          this.crossings.push({
            a: A, b: B, road, occupied: 0, waiting: 0,
            pos: nodes[A].pos.clone().add(nodes[B].pos).multiplyScalar(0.5),
          });
        }
      }
    }
    this._edgeCrossings();
    this._laneZebras();
  }

  /* Every OTHER way the pavement graph reaches across a carriageway.

     The search above only looks where a real zebra is: CROSS_BACK metres back
     from a junction. It found four of them on this street and stopped — but
     the pavement graph had a fifth way over the road that nobody had declared,
     an ordinary pavement edge running from one side of the main street to the
     other. A walker on it is in state 'walk', not 'cross', so no driver read
     it and nobody waited at a kerb: they simply walked into the traffic, five
     of them on every one of 600 frames in the probe. That is the crowd in the
     middle of the road in Beri's 2026-09-07 recording, and it is not a bug in
     the walking — it is an edge that was never classified.

     The rule is geometric and belongs to the LIBRARY and not to one page: an
     edge whose middle is on a carriageway IS a crossing, wherever it is. The
     host declares pavements and roads; which of its pavement links happen to
     span a road is this module's business to work out, exactly as the junction
     search already does. Quarter points as well as the middle, so an edge that
     clips the corner of a junction is caught too. */
  _edgeCrossings() {
    const nodes = this.walk.nodes;
    const mid = new THREE.Vector3();
    for (let a = 0; a < nodes.length; a++) {
      for (const b of nodes[a].links) {
        if (b <= a) continue;                       // each edge once
        if (this._crossingBetween(a, b)) continue;  // the junction search already has it
        const pa = nodes[a].pos, pb = nodes[b].pos;
        let on = false;
        for (const f of [0.5, 0.25, 0.75]) {
          mid.lerpVectors(pa, pb, f);
          if (this._onCarriageway(mid)) { on = true; break; }
        }
        if (!on) continue;
        mid.lerpVectors(pa, pb, 0.5);
        /* `road` is carried for the same reason the junction crossings carry
           it — the record is one shape — and it is the road this edge actually
           spans rather than a guess. */
        this.crossings.push({
          a, b, road: this._roadAt(mid), occupied: 0, waiting: 0, pos: mid.clone(),
        });
      }
    }
  }

  /* Which road's carriageway a point is on, or -1. */
  _roadAt(pos) {
    for (const lane of this.lanes) {
      for (let i = 1; i < lane.pts.length; i++) {
        const p = lane.pts[i - 1], q = lane.pts[i];
        const ex = q.x - p.x, ez = q.z - p.z;
        const t = clamp(((pos.x - p.x) * ex + (pos.z - p.z) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const dx = pos.x - (p.x + ex * t), dz = pos.z - (p.z + ez * t);
        if (dx * dx + dz * dz < LANE_HALF * LANE_HALF) return lane.road;
      }
    }
    return -1;
  }

  /* Each lane learns the arc length at which it meets each zebra, exactly the
     way _findJunctions taught it its signals — so a driver's check is a
     subtraction and not a search. */
  _laneZebras() {
    for (const lane of this.lanes) {
      lane.zebras = [];
      for (const c of this.crossings) {
        let best = Infinity, bestS = 0;
        for (let i = 0; i < lane.pts.length; i++) {
          const d = lane.pts[i].distanceTo(c.pos);
          if (d < best) { best = d; bestS = lane.cum[i]; }
        }
        /* Near it AND over this road. At a crossroads the crossing that spans
           the side street passes within five metres of the main street's own
           lanes, so distance alone handed it to the main street's drivers too:
           they braked at the junction for somebody crossing the OTHER road and
           stopped there, which is the pickup and the van standing in the box
           in the overlap probe. `c.road` is what the crossing spans, and it is
           recorded rather than inferred. */
        if (best < 7 && (c.road === undefined || c.road < 0 || c.road === lane.road)) {
          lane.zebras.push({ c, s: bestS });
        }
      }
      lane.zebras.sort((x, y) => x.s - y.s);
    }
  }

  /* One static thing on the ground. Grounded through the host's own getHeight
     at placement time and never again: a prop that does not move cannot leave
     the terrain it was put on. `scaleV` is built here rather than per frame —
     an InstancedMesh matrix wants a Vector3 and a herd of thirty would
     otherwise allocate thirty of them every frame. */
  _prop(type, x, z, yaw, scale = 1) {
    if (!this.models[type]) return null;
    const p = {
      type, yaw,
      pos: new THREE.Vector3(x, this.getHeight(x, z), z),
      scaleV: scale === 1 ? null : new THREE.Vector3(scale, scale, scale),
    };
    this.props.push(p);
    return p;
  }

  /* Where the nearest OPEN lane passes a plaza, as a point just inside the
     square's rim and a yaw that looks at the road. A kiosk with its back to
     the traffic is a kiosk nobody buys from, and a bus shelter facing the
     paving is not a bus shelter. `along` walks a couple of metres round the
     rim so two props at one square do not stand inside each other. With no
     roads declared at all the fallback is the +Z rim, which is honest: the
     module is not going to invent a road to put a shelter next to. */
  _roadEdge(cx, cz, r, along = 0) {
    let best = null;
    for (const lane of this.lanes) {
      for (const p of lane.pts) {
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (!best || d < best.d) best = { d, x: p.x, z: p.z };
      }
    }
    const a = best ? Math.atan2(best.x - cx, best.z - cz) : 0;
    const b = a + along / Math.max(1, r);
    return { x: cx + Math.sin(b) * (r - 1.2), z: cz + Math.cos(b) * (r - 1.2), yaw: a };
  }

  /* The props on one plaza. Every one of them is triggered by something the
     HOST knows and this module cannot: what trade the square carries, whether
     the settlement is big enough for a bus route, whether anybody lives round
     it. Nothing appears unless it was asked for — the data rule applies to a
     fountain exactly as it applies to a population. */
  _plazaProps(cx, cz, r, o) {
    if (o.fountain) this._prop('st.fountain', cx, cz, 0);
    const n = o.cafeTables || 0;
    for (let i = 0; i < n; i++) {
      /* A ring at 55% of the radius: far enough out to leave the middle of the
         square walkable, near enough in to read as one café's terrace. */
      const a = (i / n) * TAU + 0.6;
      this._prop('st.cafeTable', cx + Math.sin(a) * r * 0.55, cz + Math.cos(a) * r * 0.55,
                 a + Math.PI);
    }
    /* A playground is ONE object and not a ring, so it takes one bearing and
       stands with its back to the rim, looking into the square. */
    if (o.playground) {
      const a = 2.35;
      this._prop('st.playground', cx + Math.sin(a) * r * 0.6, cz + Math.cos(a) * r * 0.6,
                 a + Math.PI);
    }
    if (o.kiosk) { const e = this._roadEdge(cx, cz, r); this._prop('st.kiosk', e.x, e.z, e.yaw); }
    if (o.busstop) { const e = this._roadEdge(cx, cz, r, 4.5); this._prop('st.busstop', e.x, e.z, e.yaw); }
  }

  /* =======================================================================
     PASTURE — a herd that grazes inside one polygon
     `polygon` is [[x, z], ...] or [[x, y, z], ...]. The counts are the caller's
     real numbers (dormant projects, in the world that uses this).
     ======================================================================= */
  addPasture(polygon, { sheep = 0, cows = 0, horses = 0, chickens = 0, bushes = 0 } = {}) {
    const poly = polygon.map(p => (p.length >= 3 ? [p[0], p[2]] : [p[0], p[1]]));
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const field = { poly, minX, maxX, minZ, maxZ };
    this.pastures.push(field);
    /* Rejection sampling with a hard cap: a long thin field would otherwise
       spin here forever, and one animal on the fence line is cheaper than a
       hung page. */
    const sample = () => {
      let x = 0, z = 0;
      for (let t = 0; t < 40; t++) {
        x = minX + this.rand() * (maxX - minX);
        z = minZ + this.rand() * (maxZ - minZ);
        if (inPolygon(poly, x, z)) break;
      }
      return [x, z];
    };
    /* A MIXED herd, and the split is a RENDERING decision rather than a
       population one — the count is still exactly what the caller passed.
       Two in three stand: those are the Hunyuan meshes, which have real
       markings, correct anatomy and wool that reads as wool at four metres,
       and which is what an animal with its head down actually is. The third
       keeps its Quaternius rig, because a rig is the only thing here that can
       WALK, and a field where nothing ever moves is a diorama. Judged on the
       reference shots, not asserted: docs/shots/life-herd-hy.png. */
    const place = (kind, still, n) => {
      for (let i = 0; i < n; i++) {
        const [x, z] = sample();
        if (still && (i % 3) !== 0) {
          this._prop(still, x, z, this.rand() * TAU, 0.92 + this.rand() * 0.16);
        } else {
          this.actors.push(this._grazer(kind, field, x, z));
        }
      }
    };
    place('animal.sheep', 'st.sheep', sheep);
    place('animal.cow', 'st.cow', cows);
    place('animal.horse', 'st.horse', horses);
    /* Chickens: a yard bird, and a fenced field IS the yard. They never got a
       rig and they never needed one — a hen stands and pecks. The count comes
       from the caller for the same reason every other count does. */
    for (let i = 0; i < chickens; i++) {
      const [x, z] = sample();
      this._prop('st.chicken', x, z, this.rand() * TAU, 0.9 + this.rand() * 0.2);
    }
    /* Hedges ON the fence line, which is the polygon itself. Spread by arc
       length round the perimeter rather than per edge, or a short edge gets as
       many as a long one and the field ends up with a thicket at one corner. */
    this._plantHedge(poly, bushes, true);
    this.counts.sheep += sheep;
    this.counts.cows += cows;
    return this;
  }

  /* =======================================================================
     OBSTACLES — the things the HOST put on the pavement
     This module places its own props and knows where every bench is, but the
     railings, the pasture fence and the tree trunks on life.html are the
     page's own meshes and it had no way to hear about them. Beri filmed the
     result: a pedestrian walking straight through a railing.

     One call, and it takes the two shapes a host actually has. A CIRCLE is
     `{ x, z, r }` — a trunk, a post, a bollard. A SEGMENT is
     `{ x1, z1, x2, z2, r }` — a railing, a fence rail, a wall: the whole run
     in one entry, chopped into overlapping circles here so every clearance
     test in this file stays one distance to one centre.

     `addObstacles` may be called any number of times and at any point before
     populate(); the map is built there, once, out of everything declared.
     ======================================================================= */
  addObstacles(list = []) {
    for (const o of list) {
      if (!o) continue;
      if (o.x2 !== undefined || o.z2 !== undefined) {
        this.hostObstacles.push({
          x1: o.x1, z1: o.z1, x2: o.x2 !== undefined ? o.x2 : o.x1,
          z2: o.z2 !== undefined ? o.z2 : o.z1, r: o.r > 0 ? o.r : 0.1,
        });
      } else if (o.x !== undefined) {
        this.hostObstacles.push({ x1: o.x, z1: o.z, x2: o.x, z2: o.z, r: o.r > 0 ? o.r : 0.3 });
      }
    }
    return this;
  }

  /* park(type, x, z, yaw) — a STATIONARY vehicle at a fixed spot. The city's
     crew regime wants a work van standing AT the printing building, not merely
     pulled near it by the road's traffic weight; this is that lever, and it is
     the third of the three APIs the city.js note asked life.js for.

     `type` is any vehicle key already in the catalogue (e.g. 'van', 'pickup').
     It may be called at ANY time — before or after populate() —
     because a parked van is drawn as its own plain Mesh and never touches the
     instanced traffic pool or its capacity. The mesh is the model's near (or
     welded-mid) geometry, stood on the ground with the same two corrections
     every vehicle gets: `face` onto +Z and grounded by getHeight. Its box joins
     _vehicleBoxes() every people step, so the crowd already avoids it and
     __penetrations() already counts it — no obstacle-map rebuild is needed. */
  park(type, x, z, yaw = 0) {
    const e = this.models[type];
    if (!e) { console.warn('life.park: no model for', type); return null; }
    /* One van earns the near geometry; noRaw models keep to their welded mid so
       a huge raw mesh is never stood next to the camera for a single instance. */
    const geo = (e.noRaw ? e.geometryMid : e.geometry) || e.geometryMid || e.geometry;
    if (!geo) { console.warn('life.park: model has no geometry', type); return null; }
    const y = this.getHeight(x, z);
    const mesh = new THREE.Mesh(geo, e.material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw + (e.face || 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = `life-parked-${type}`;
    this.group.add(mesh);
    const rec = { type, pos: new THREE.Vector3(x, y, z), yaw, mesh,
                  halfLength: e.halfLength, halfWidth: e.halfWidth };
    this.hostParked.push(rec);
    return rec;
  }

  /* Bushes spread evenly by ARC LENGTH along a list of points, jittered off
     the line so a hedge is a hedge and not a row of dots. `closed` walks the
     last point back to the first, which is what a fence round a field does and
     a pavement does not. */
  _plantHedge(pts, n, closed) {
    if (!(n > 0) || pts.length < 2) return;
    const P = pts.map(p => (p.length >= 3 ? [p[0], p[2]] : [p[0], p[1]]));
    if (closed) P.push(P[0]);
    const seg = [], cum = [0];
    for (let i = 1; i < P.length; i++) {
      const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      seg.push(d); cum.push(cum[i - 1] + d);
    }
    const total = cum[cum.length - 1];
    if (total < 1) return;
    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / Math.max(1e-6, seg[i - 1]);
      const ax = P[i - 1][0], az = P[i - 1][1], bx = P[i][0], bz = P[i][1];
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      /* Perpendicular to the run, on the side that is FURTHER from the nearest
         lane. The module is handed a centre line and not a kerb, so this is
         the only reading it has of which side is the pavement and which is the
         carriageway — and a hedge planted in the road is the loudest possible
         way to get that wrong. */
      const L = Math.max(1e-6, Math.hypot(bx - ax, bz - az));
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      /* Clear of the PAVEMENT, not merely clear of the centre line. 0.9-1.4 m
         off a run whose own half-width is 1.19 m put half the hedge on the
         flagstones: it is where the walkers were, so the obstacle pass then had
         to squeeze three hundred people through 1.3 m of a 2.4 m pavement and
         the separation rate tripled. A hedge is beside a pavement. Along a
         fence line (`closed`) there is no pavement to be beside, so the old
         offset stands. */
      const off = closed ? 0.9 + this.rand() * 0.5
                         : this.walkHalf + 0.55 + this.rand() * 0.5;
      const side = this._awayFromRoad(x, z, nx, nz);
      const hx = x + nx * off * side, hz = z + nz * off * side;
      /* Not inside a declared square. A pavement that runs into a market
         square is still a pavement here, and the first version planted two
         hedges in the middle of its paving — the ONE place on the whole page
         that is deliberately kept clear so people can stand in it. */
      if (this._inPlaza(hx, hz)) continue;
      this._prop('st.bush', hx, hz, this.rand() * TAU, 0.75 + this.rand() * 0.45);
    }
  }

  /* Inside any square declared through addPlaza. Used to keep the hedge off
     the paving; the plazas passed to addWalkways are not in this list, and do
     not need to be — a hedge is only ever planted from a call that has already
     seen this one. */
  _inPlaza(x, z) {
    for (const pz of this.plazaSpecs) {
      if (Math.hypot(x - pz.center[0], z - pz.center[2]) < pz.radius) return true;
    }
    return false;
  }

  /* +1 or -1: which way along (nx, nz) leads away from the nearest lane. */
  _awayFromRoad(x, z, nx, nz) {
    let best = null;
    for (const lane of this.lanes) {
      for (const p of lane.pts) {
        const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
        if (!best || d < best.d) best = { d, x: p.x, z: p.z };
      }
    }
    if (!best) return 1;
    return ((best.x - x) * nx + (best.z - z) * nz) > 0 ? -1 : 1;
  }

  /* =======================================================================
     SKY — flocks
     `bounds` is { min:[x,y,z], max:[x,y,z] }. Birds flock; parrots fly in
     pairs. At night both go looking for somewhere to perch, and the perches
     are found by raycasting down through the real scene once, so they land on
     the roofs and trees that are actually there rather than on a guess.
     ======================================================================= */
  addSkyBox(bounds, { birds = 0, parrots = 0, camera } = {}) {
    this.sky = {
      min: new THREE.Vector3(...bounds.min),
      max: new THREE.Vector3(...bounds.max),
    };
    this._findPerches(camera);
    const flock = [];
    const mk = (isParrot, n) => {
      for (let i = 0; i < n; i++) {
        const p = new THREE.Vector3(
          THREE.MathUtils.lerp(this.sky.min.x, this.sky.max.x, this.rand()),
          THREE.MathUtils.lerp(this.sky.min.y, this.sky.max.y, 0.3 + this.rand() * 0.6),
          THREE.MathUtils.lerp(this.sky.min.z, this.sky.max.z, this.rand()));
        flock.push({
          pos: p,
          vel: new THREE.Vector3(this.rand() - 0.5, 0, this.rand() - 0.5).normalize().multiplyScalar(7),
          parrot: isParrot,
          /* Parrots go about in pairs: every odd one is bound to the one before
             it and steers to keep station on it. */
          mate: isParrot && i % 2 === 1 ? flock.length - 1 : -1,
          phase: this.rand(),
          perch: null,
          landed: 0,
        });
      }
    };
    mk(false, birds);
    mk(true, parrots);
    this.flock = flock;
    this.counts.birds += birds;
    this.counts.parrots += parrots;
    this._buildBirdMesh(Math.max(1, flock.length));
    return this;
  }

  /* Where a bird can sit is a question about the scene, so it is asked OF the
     scene: one ray straight down the middle of every object already standing
     there, and anything the ray hits well above the ground is a roof, a wall
     head or a tree crown. Sampling the sky box at random instead found two
     perches in two hundred and forty tries, because the box is mostly air. */
  _findPerches(camera) {
    this.perches = [];
    const ray = new THREE.Raycaster();
    // `Sprite.raycast` dereferences `raycaster.camera.matrixWorld`
    // unconditionally — a bare Raycaster has none and throws on the first
    // sprite it meets. See the load()-time note on `life.camera`.
    ray.camera = camera || this.camera || new THREE.PerspectiveCamera();
    const down = new THREE.Vector3(0, -1, 0);
    const box = new THREE.Box3(), mid = new THREE.Vector3();
    const columns = [];
    for (const o of this.scene.children) {
      if (o === this.group || !o.visible) continue;
      box.setFromObject(o);
      if (!isFinite(box.min.x) || box.max.y - box.min.y < 2.5) continue;
      box.getCenter(mid);
      /* Three columns per object, not one: the centre of a gabled roof is its
         ridge, and a bird on a ridge and two birds on the slopes is what a roof
         at dusk actually looks like. */
      const w = (box.max.x - box.min.x) * 0.3, d = (box.max.z - box.min.z) * 0.3;
      columns.push([mid.x, mid.z], [mid.x - w, mid.z + d], [mid.x + w, mid.z - d]);
      if (columns.length > 260) break;
    }
    for (const [x, z] of columns) {
      if (this.perches.length >= 72) break;
      ray.set(new THREE.Vector3(x, 200, z), down);
      // Sprites (town-name plaques, drone tags) are billboards, not roofs —
      // skip them here too, on top of the camera fix above: a sign is not
      // somewhere a bird can sit.
      const hit = ray.intersectObjects(this.scene.children, true)
        .find(h => !h.object.name.startsWith('life') && !h.object.isSprite);
      if (!hit) continue;
      if (hit.point.y - this.getHeight(x, z) > 2.5) this.perches.push(hit.point.clone());
    }
  }

  /* =======================================================================
     POPULATE — the counts, from the caller's data
     ======================================================================= */
  populate({ humans = 0, workers = 0, cars = 0, robots = 0, dogs = 0, cats = 0 } = {}) {
    /* The crossings are found here as well as in addWalkways, because a host
       that added its roads AFTER its pavements would otherwise have none: the
       search needs the junctions and the pavement graph both. Idempotent — it
       rebuilds the list and skips a pair already linked. */
    this._findCrossings();
    /* The resident mix is normal life — no hi-vis. 'human.worker' is dealt only
       through `workers` (below) and the city's own crew path, so a finished
       street and a quiet village never wear safety vests, which is exactly the
       owner's rule: normal life in what is finished, workers where it is under
       construction. Before this it was the fourth resident model, and once the
       worker rig became hi-vis that would have put a quarter of every village in
       a vest. */
    const human = ['human.casual', 'human.casualF', 'human.suit'];
    const people = [];
    for (let i = 0; i < humans; i++) {
      const p = this._pedestrian(human[i % human.length], i);
      /* Groups of two or three. About a third of the crowd walks with somebody:
         a follower takes its leader's target and keeps station a metre or so to
         one side, which is what turns a hundred and twenty independent walkers
         into a street with couples and a family on it. */
      /* Everybody lives somewhere. The round starts and ends at this door, and
         it is a HOME door and not a shop: the module has both lists. */
      if (this.walk.homes.length) {
        p.home = this.walk.homes[Math.floor(this.rand() * this.walk.homes.length)];
      }
      const lead = people[people.length - 1];
      if (lead && lead.groupSize < 3 && this.rand() < 0.34) {
        p.leader = lead.leader || lead;
        p.home = p.leader.home;
        p.leader.groupSize++;
        p.side = (people.length % 2 ? 1 : -1) * (0.85 + this.rand() * 0.5);
      }
      people.push(p);
      this.actors.push(p);
    }
    /* WORKERS — the public path the city's crew regime asked for. Same walker
       as a resident in every respect (home, errands, separation) but always the
       hi-vis 'human.worker' rig, so an active/under-construction avenue can be
       populated with people who look like a crew without the host reaching into
       `_pedestrian()`. `humans` is the module's own four-model mix; `workers` is
       all hi-vis on top of it. They share the group/couple logic so a crew reads
       as a site and not as a parade. */
    for (let i = 0; i < workers; i++) {
      const p = this._pedestrian('human.worker', humans + i);
      if (this.walk.homes.length) {
        p.home = this.walk.homes[Math.floor(this.rand() * this.walk.homes.length)];
      }
      const lead = people[people.length - 1];
      if (lead && lead.groupSize < 3 && this.rand() < 0.34) {
        p.leader = lead.leader || lead;
        p.home = p.leader.home;
        p.leader.groupSize++;
        p.side = (people.length % 2 ? 1 : -1) * (0.85 + this.rand() * 0.5);
      }
      people.push(p);
      this.actors.push(p);
    }
    for (let i = 0; i < robots; i++) this.actors.push(this._robot(i));
    this.counts.humans += humans + workers;
    this.counts.robots += robots;

    /* A dog belongs to somebody. It is placed ONLY where there are errands to
       walk — a pavement graph that has shops on it — because a dog on a lead
       is a person going somewhere, and on a graph with no destinations it
       would be a dog trotting in circles. The count is the caller's: a hamlet
       passes one, a town passes several. The model is static and carried along
       the owner's own path, which at a dog's size is indistinguishable from a
       walk cycle and costs one instance instead of a rig. */
    if (dogs > 0 && this.walk.shops.length && people.length) {
      for (let i = 0; i < dogs; i++) {
        const owner = people[Math.floor(this.rand() * people.length)];
        this.dogs.push({ owner, side: (i % 2 ? 1 : -1) * (0.7 + this.rand() * 0.3) });
      }
    }
    /* Cats sit at the EDGE of a square. The middle of a plaza is where the
       people are, and a cat is the animal that has decided against them. Only
       where a plaza was actually declared. */
    for (let i = 0; i < cats && this.walk.plazas.length; i++) {
      const pz = this.walk.plazas[i % this.walk.plazas.length];
      const a = this.rand() * TAU;
      this._prop('st.cat', pz.pos.x + Math.sin(a) * (pz.radius - 0.8),
                 pz.pos.z + Math.cos(a) * (pz.radius - 0.8), a + Math.PI);
    }

    /* Bicycles are street furniture here, not traffic. No model checked has a
       rider on one, and a riderless bicycle rolling down the carriageway at
       eight metres a second reads as a bug rather than as a cyclist. They are
       parked at the doors instead, which is where bicycles are. */
    this.parked = [];
    for (let i = 0; i < Math.min(8, Math.floor(humans / 14)); i++) {
      const d = this.walk.doors[Math.floor(this.rand() * Math.max(1, this.walk.doors.length))];
      const n = this.walk.nodes[d];
      if (!n) break;
      this.parked.push({
        type: 'bicycle',
        pos: new THREE.Vector3(n.pos.x + (this.rand() - 0.5) * 2.4, n.pos.y + 0.16,
                               n.pos.z + (this.rand() - 0.5) * 1.2),
        yaw: this.rand() * TAU,
        /* Leaned over, because a bicycle that stands up by itself is a bicycle
           on a stand and none of these have one. */
        lean: (this.rand() < 0.5 ? -1 : 1) * (0.16 + this.rand() * 0.1),
      });
    }
    /* Traffic per road is proportional to that road's weight, so a busy link
       gets a busy road. A network with no weights at all is a flat share. */
    /* Traffic is shared out by weight TIMES LENGTH, and then capped at what
       each lane can physically hold.

       By weight alone it was neither, and the street showed it. A pedestrian
       zone takes a bite out of the lane graph, and on this page that leaves the
       side street as a 5 m stub and a 69 m run — two lanes of equal weight. The
       stub was dealt three vehicles, which is three vehicles in five metres of
       road: they spawned inside one another and the follow model can no more
       recover from that than a driver can. Every remaining overlapping pair in
       the first measured run of this pass was on that stub.

       Capacity is the honest limit: the longest vehicle this road may carry,
       plus the clearance a driver leaves, divided into the lane. A five-metre
       stub holds no traffic at all, which is the right answer for a five-metre
       stub. */
    const room = new Map();
    for (const lane of this.lanes) {
      const deck = this._deckFor(lane.road);
      let longest = 0;
      for (const t of deck) longest = Math.max(longest, this.models[t] ? this.models[t].length : 4);
      /* An empty deck is a road with nothing to put on it — no vehicle model in
         the asset pack at all — and its capacity is zero, not "one car". */
      room.set(lane, deck.length ? Math.floor(lane.length / (longest + CAR_CLEAR)) : 0);
    }
    const total = this.lanes.reduce((a, l) => a + Math.max(0.001, l.weight) * l.length, 0) || 1;
    let placed = 0;
    for (const lane of this.lanes) {
      /* The deck this ROAD may be dealt from. A bus route is not a property of
         a vehicle, it is a property of the street — see _deckFor(). */
      const deck = this._deckFor(lane.road);
      const share = Math.min(room.get(lane),
        Math.round((cars * Math.max(0.001, lane.weight) * lane.length) / total));
      for (let i = 0; i < share && placed < cars; i++, placed++) {
        /* Dealt by this LANE's own index and not by the running total. With the
           running total, which road got which card depended on how many cars
           every earlier road had taken — a lane with two slots was handed
           whatever the counter happened to be on, never the front of its own
           deck, so the tractor deck's first card was never dealt. */
        this.vehicles.push(this._newVehicle(deck[i % deck.length], lane,
          (lane.length * (i + 0.5)) / share));
        room.set(lane, room.get(lane) - 1);
      }
    }
    /* Rounding down per-lane can leave a few cars unplaced. They go round the
       lanes that still have room, longest first — never onto a lane that is
       already full, which is the mistake the old "put them on the busiest one"
       fallback made. A network with no room left really does carry fewer cars
       than were asked for, and `stats().carsDropped` says so rather than the
       street quietly overlapping to hide it. */
    const spare = this.lanes.filter(l => room.get(l) > 0).sort((a, b) => b.length - a.length);
    let guard = 0;
    while (placed < cars && spare.length && guard++ < cars * 4) {
      const lane = spare[guard % spare.length];
      if (room.get(lane) <= 0) continue;
      const deck = this._deckFor(lane.road);
      this.vehicles.push(this._newVehicle(deck[placed % deck.length], lane,
        this._largestGap(lane)));
      room.set(lane, room.get(lane) - 1);
      placed++;
    }
    this.carsDropped = cars - placed;
    this.counts.cars += placed;

    /* The obstacle map, last, because it is built out of everything above it:
       every prop this module placed — including the cats put on the plaza rim
       a few lines up — every bench the host declared, and whatever
       `addObstacles` was told. It has to be after the crossings (a crossing
       edge is exempt from the pruning) and it is what the pavement graph's
       free lateral intervals are computed from. */
    this._buildObstacles();

    this._buildCrowds();
    this._buildVehicleMeshes();
    return this;
  }

  /* The middle of the biggest hole in a lane's traffic, in arc length. A
     leftover car dropped at an arbitrary point would land on top of one that is
     already there — the whole reason the spawn spacing is even in the first
     place — so it goes where there is most room. */
  _largestGap(lane) {
    const on = this.vehicles.filter(v => v.lane === lane).map(v => v.s).sort((a, b) => a - b);
    if (!on.length) return lane.length * 0.5;
    let best = 0, at = 0;
    for (let i = 0; i < on.length; i++) {
      const a = on[i], b = i + 1 < on.length ? on[i + 1] : on[0] + lane.length;
      if (b - a > best) { best = b - a; at = (a + b) * 0.5; }
    }
    return at % lane.length;
  }

  /* Which vehicles this ROAD is allowed to carry.

     Beri's 2026-09-07 recording had a tractor between the shopfronts of the
     main street and a bus wedged into a lane the width of a car. Neither is a
     bug in the driving; both are a bug in the DEALING — every road was dealt
     from one deck. What decides it in a real place is the street: a bus needs
     two lanes and somewhere worth running a service to, and a tractor belongs
     on the road out to the fields.

     Both come off the road record the HOST declares, because the host is the
     only thing that knows what its network means. `lanes` is how many lanes the
     carriageway has (default 2 — the module already builds one each way, which
     is what LANE_HALF offsets) and `settlement` is its class. A caller that
     says nothing gets a two-lane town street, which is what this module has
     always drawn, so nothing that already worked changes.

     `field: true` is the shorthand for a road that is neither: a farm track. */
  _deckFor(roadIndex) {
    const r = this.roads[roadIndex] || {};
    const lanes = r.lanes !== undefined ? r.lanes : 2;
    const cls = r.settlement || 'town';
    const bus = lanes >= 2 && (cls === 'town' || cls === 'city');
    const tractor = r.field === true || cls === 'hamlet';
    const key = `${bus}|${tractor}`;
    /* Cached: this runs once per lane at populate() time, but the string keys
       make the filter cheap enough to keep readable rather than clever. */
    this._decks = this._decks || {};
    if (!this._decks[key]) {
      const deck = TRAFFIC.filter(t => (t !== 'bus' || bus) && (t !== 'tractor' || tractor));
      /* A road that turns out to allow nothing still has to carry traffic —
         a hamlet lane with no bus and, somehow, no tractor is still a lane
         with cars on it. Falling back to the cars in the deck beats delivering
         an empty road the caller asked to populate. */
      /* On a farm track the tractor is not the tenth card in the deck, it is
         the one you actually see. TRAFFIC is ordered by how common a vehicle is
         in a TOWN, so the tractor sits last in it — and a one-lane hamlet road
         with room for two vehicles never reached the last card, which is why
         life.html's field road ran two saloons and demonstrated only half the
         rule it exists to demonstrate. */
      if (tractor) deck.unshift(...deck.splice(deck.indexOf('tractor'), 1));
      /* And only the cards whose model actually LOADED. This is the one place
         that has to know: a type dealt onto a road with no geometry behind it
         is dereferenced by _newVehicle, by the body pass and by the lamp pass,
         none of which can sensibly test for it. `park()` and `_prop()` already
         refuse a type they have no model for; this is the traffic's version of
         the same refusal. An asset pack with no car at all leaves the deck
         empty and populate() gives the road no traffic, which is the honest
         answer rather than a crash. */
      const have = deck.filter(t => this.models[t]);
      this._decks[key] = have.length ? have : (this.models.car ? ['car'] : []);
    }
    return this._decks[key];
  }

  /* One traffic record. Both spawn sites go through here because the fields a
     driver needs are no longer three: it carries its own measured length (the
     following distance is derived from it), the arc it is turning through, and
     the brake state the body pitch and the brake lights are drawn from. */
  _newVehicle(type, lane, s) {
    const e = this.models[type];
    return {
      type, lane, s,
      speed: 8, want: 7 + this.rand() * 5,
      pos: new THREE.Vector3(), head: new THREE.Vector3(0, 0, 1),
      yaw: 0, approach: null, turn: 0, turnTo: null, blink: 0,
      /* Measured off the model, once. `len` is the whole vehicle and `half` the
         half it needs in front of its own centre. */
      len: e ? e.length : 4, half: e ? e.halfLength : 2,
      /* The turn in progress: a bezier through the junction, or null. */
      arc: null,
      /* How hard this driver is braking this frame, in m/s². The body pitch and
         the brake lights are both read off it, so it is one number rather than
         two flags that can disagree. */
      decel: 0, pitch: 0,
      /* How far off the lane's own heading the body is drawn. Zero for every
         vehicle that has not been in an accident. */
      askew: 0,
      /* The accident: null, or the record _stageAccident() put here. */
      crash: null, hazard: 0,
    };
  }

  /* ---- one pedestrian --------------------------------------------------- */
  _pedestrian(model, i) {
    const nodes = this.walk.nodes;
    const start = nodes.length ? Math.floor(this.rand() * nodes.length) : -1;
    const pos = start >= 0 ? nodes[start].pos.clone() : new THREE.Vector3();
    pos.x += (this.rand() - 0.5) * 1.6;
    pos.z += (this.rand() - 0.5) * 1.6;
    return {
      kind: 'person', model, pos, yaw: this.rand() * TAU, node: start,
      /* The errand round. `path` is the list of pavement nodes still to reach,
         `point` the last few metres to a bench once the graph has run out, and
         `cross` the zebra being waited at. `home` is this person's own front
         door and it is where the round starts and ends.

         Seeded to a RANDOM stage of the round, not always 'home'. Every
         pedestrian used to start there, so the first `_nextErrand()` call
         (frame one, path empty) sent all hundred and twenty toward a shop
         AT THE SAME INSTANT — a synchronised wave that then took the round's
         own length, minutes, to reach the far side (the plaza) for the very
         first time. `__probe().errands.plaza` measured that wave: exactly 0
         until the wave arrived, whatever the window. Starting the population
         pre-spread across home/shop/bench/plaza is what a page opened mid-day
         actually looks like, and it is what makes the plaza populated inside
         the showcase's first minute instead of its tenth. */
      errand: ROUND_SEED[Math.floor(this.rand() * ROUND_SEED.length)],
      path: [], point: null, cross: null,
      home: start,
      state: 'walk', hold: 0, clock: this.rand() * 4, speed: 1.15 + this.rand() * 0.5,
      tint: null, seat: null, scale: 0.94 + this.rand() * 0.12, id: i,
      phase: this.rand(),
      /* Which skin-and-wardrobe row this one wears. The only thing in this
         module the seed decides. A worker ('human.worker', spec.hivis) is dealt
         a hi-vis row so its vest and helmet read at city range; everybody else
         gets a muted one. */
      pal: paletteRow(this.rand, !!(this.models[model] && this.models[model].spec.hivis)),
      leader: null, groupSize: 1, side: 0,
      /* Each walker keeps its own line across the width of the pavement. Every
         pedestrian aiming at the exact node produced a single-file queue down
         the middle of the flagstones — a hundred and twenty people in one
         conga line, which is the least like a street a crowd can look.
         Clamped to the pavement the host declared: at the old flat +/-0.9 m a
         third of the crowd walked on the grass verge beside it. */
      off: (this.rand() - 0.5) * 2 * this.walkHalf,
    };
  }

  _grazer(model, field, x, z) {
    return {
      kind: 'grazer', model, field, pos: new THREE.Vector3(x, this.getHeight(x, z), z),
      yaw: this.rand() * TAU, state: 'graze', hold: 2 + this.rand() * 8, clock: this.rand() * 4,
      speed: 0.5 + this.rand() * 0.3, goal: null, scale: 0.9 + this.rand() * 0.2, tint: null,
      phase: this.rand(),
    };
  }

  /* A robot is no longer a skinned character: the Hunyuan one is a single rigid
     mesh, so it is drawn from the same instanced pass the traffic uses and its
     motion is written here rather than played from a clip. */
  _robot(i) {
    const p = this.walk.nodes.length
      ? this.walk.nodes[Math.floor(this.rand() * this.walk.nodes.length)].pos.clone()
      : new THREE.Vector3();
    return {
      kind: 'robot', model: 'robot', pos: p, yaw: 0, state: 'idle', hold: 0,
      clock: this.rand() * 3, speed: 1.9, goal: null, agent: null, slot: i,
      phase: this.rand(), scale: 1, bob: this.rand() * TAU, lean: 0,
    };
  }

  /* Only the skinned families get a Crowd. Robots are rigid now, so a crowd for
     them would build an InstancedMesh out of a model that has no VAT. */
  _buildCrowds() {
    const need = {};
    for (const a of this.actors) {
      if (a.kind === 'robot') continue;
      need[a.model] = (need[a.model] || 0) + 1;
    }
    for (const model in need) {
      if (this.crowds[model]) continue;
      /* A character the asset pack does not carry gets no crowd, and the draw
         pass below skips an actor whose crowd is missing. The actor itself is
         left in place: it still walks, it still occupies the pavement, it is
         simply not drawn — which is a smaller lie than a population that
         changes size with the asset folder. */
      if (!this.models[model]) continue;
      this.crowds[model] = new Crowd(this.models[model], this.group, need[model] + 8);
    }
  }

  /* One InstancedMesh per rigid type, sized to what is actually going to stand
     in it. Robots, their drones and the perched parrots share the pass with the
     traffic because they are the same kind of object: one geometry, one
     material, a matrix each. */
  _buildVehicleMeshes() {
    const need = {};
    for (const v of this.vehicles) need[v.type] = (need[v.type] || 0) + 1;
    for (const v of this.parked) need[v.type] = (need[v.type] || 0) + 1;
    /* The statics share this pass because they are the same kind of object:
       one geometry, one material, a matrix each. */
    for (const p of this.props) need[p.type] = (need[p.type] || 0) + 1;
    if (this.dogs.length) need['st.dog'] = (need['st.dog'] || 0) + this.dogs.length;
    const robots = this.actors.filter(a => a.kind === 'robot').length;
    if (robots) { need.robot = robots; need.drone = robots; }
    const parrots = this.counts.parrots;
    if (parrots) need.parrot = parrots;
    for (const type in need) {
      if (this.vehicleMeshes[type]) continue;
      const e = this.models[type];
      /* No model, no instanced pair. `_push()` already returns on a type with
         no mesh, so everything downstream of here degrades to drawing nothing
         rather than to a null dereference. */
      if (!e) continue;
      /* A pair per type: full detail inside RIGID_NEAR, welded beyond it. An
         InstancedMesh whose count is 0 issues no draw call at all, so the two
         together cost one when only one tier is on screen. */
      const mk = geo => {
        const im = new THREE.InstancedMesh(geo, e.material, need[type]);
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        return im;
      };
      /* A static that is not allowed the raw tier gets its MIDDLE geometry in
         the closest slot instead, so nothing downstream has to know. */
      const im = mk(e.noRaw ? e.geometryMid : e.geometry);
      im.midBand = e.midBand || RIGID_MID;
      im.name = `life-${type}`;
      im.mid = mk(e.geometryMid);
      im.mid.name = `life-${type}-mid`;
      im.far = mk(e.geometryFar);
      im.far.name = `life-${type}-far`;
      /* The far tier does not cast. A shadow map has to draw every caster a
         second time, and past fifty-five metres a vehicle's shadow is a smudge
         under a shape too small to connect it to — the most expensive thing in
         the frame buying the least. The near and middle tiers, which are the
         ones standing on tarmac you can see, still do. */
      im.far.castShadow = false;
      this.vehicleMeshes[type] = im;
    }
  }

  /* =======================================================================
     BIRDS — procedural, because no CC0 pack checked has an animated one
     Quaternius (the only CC0 source here that publishes rigged meshes) has no
     bird pack at all, and Poly Haven has no rigged model of anything. Rather
     than fly a static model and call it a bird, the bird IS geometry written
     here: a body, two wings and a tail, with the wing beat done in the vertex
     shader off a per-vertex span attribute. One draw call for the whole sky.
     ======================================================================= */
  _buildBirdMesh(cap) {
    /* A bird from six triangles: two swept wings, a body wedge, a tail. The
       `aSpan` attribute is 0 on the body and rises to 1 at a wing tip, which is
       both the hinge distance and the amount that vertex moves. */
    const P = [], N = [], S = [], I = [];
    const push = (x, y, z, span) => { P.push(x, y, z); N.push(0, 1, 0); S.push(span); return P.length / 3 - 1; };
    const bodyF = push(0, 0, 0.26, 0);
    const bodyB = push(0, 0, -0.30, 0);
    const bodyL = push(-0.055, 0, 0, 0);
    const bodyR = push(0.055, 0, 0, 0);
    const tipL = push(-0.42, 0, -0.06, 1);
    const tipR = push(0.42, 0, -0.06, 1);
    const midL = push(-0.20, 0, 0.03, 0.45);
    const midR = push(0.20, 0, 0.03, 0.45);
    const tail = push(0, 0, -0.46, 0.25);
    I.push(bodyF, bodyL, bodyB, bodyF, bodyB, bodyR);
    I.push(bodyL, midL, bodyF, midL, tipL, bodyF, bodyL, bodyB, midL, midL, bodyB, tipL);
    I.push(midR, bodyR, bodyF, tipR, midR, bodyF, bodyB, bodyR, midR, bodyB, midR, tipR);
    I.push(bodyB, bodyL, tail, bodyB, tail, bodyR);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('aSpan', new THREE.Float32BufferAttribute(S, 1));
    g.setIndex(I);
    g.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.9, metalness: 0, side: THREE.DoubleSide, flatShading: true,
    });
    mat.userData.shaders = [];
    mat.onBeforeCompile = shader => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aSpan;
          attribute float aBeat;
          uniform float uTime;`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = vec3(position);
          /* The beat: a wing tip swings up and down about the body axis, and
             shortens slightly as it does, which is what stops the flap reading
             as a paper aeroplane rocking. aBeat carries this bird's own rate
             and phase so no two in the flock are in step. */
          float beat = sin(uTime * (7.0 + fract(aBeat) * 5.0) + aBeat * 31.0);
          transformed.y += beat * aSpan * 0.30;
          transformed.x *= 1.0 - abs(beat) * aSpan * 0.16;`);
      mat.userData.shaders.push(shader);
    };
    mat.customProgramCacheKey = () => 'life-bird';

    const im = new THREE.InstancedMesh(g, mat, cap);
    im.frustumCulled = false;
    im.count = 0;
    im.name = 'life-birds';
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const beat = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    for (let i = 0; i < cap; i++) beat.setX(i, this.rand());
    g.setAttribute('aBeat', beat);
    this.group.add(im);
    this.birds = im;
  }

  /* =======================================================================
     LIVE AGENTS — the robots ARE the agents
     Each entry is { id, label, pos }. A robot walks to its agent's position and
     carries the label above its head; a robot with no agent stands idle. The
     label is a canvas texture on a sprite, one draw call each, and there are
     six of them.
     ======================================================================= */
  setLiveAgents(list) {
    this.agents = list || [];
    const robots = this.actors.filter(a => a.kind === 'robot');
    for (let i = 0; i < robots.length; i++) {
      const a = this.agents[i] || null;
      robots[i].agent = a;
      robots[i].goal = a && a.pos ? new THREE.Vector3(a.pos[0], a.pos[1] || 0, a.pos[2]) : null;
      this._setTag(robots[i], a ? a.label : null);
    }
    return this;
  }

  _setTag(robot, label) {
    if (!label) {
      if (robot.tag) robot.tag.visible = false;
      return;
    }
    if (!robot.tag) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      robot.tagCanvas = c;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, toneMapped: false }));
      /* Two metres wide and not two and a half. The robot is 1.35 m tall now,
         and a tag wider than the machine carrying it is the thing in the frame
         that says "diagram" rather than "street". */
      sp.scale.set(2.0, 0.50, 1);
      this.group.add(sp);
      robot.tag = sp;
    }
    const ctx = robot.tagCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(14,13,18,0.82)';
    ctx.fillRect(0, 14, 256, 36);
    ctx.fillStyle = '#d2a62c';
    ctx.fillRect(0, 14, 4, 36);
    ctx.fillStyle = '#efeae0';
    ctx.font = '500 22px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(label).slice(0, 22), 14, 33);
    robot.tag.material.map.needsUpdate = true;
    robot.tag.visible = true;
  }

  /* =======================================================================
     DAY AND NIGHT
     One number for the whole population: headlights on, birds down off the
     sky, people out of the shops and into the plaza.
     ======================================================================= */
  setNight(t) {
    this.night = clamp(t, 0, 1);
    return this;
  }

  /* =======================================================================
     THE FRAME
     ======================================================================= */
  update(dt, camera) {
    dt = Math.min(0.08, dt);
    this.time += dt;
    this._stepPeople(dt);
    this._stepGrazers(dt);
    this._stepRobots(dt);
    this._stepVehicles(dt);
    this._stepBirds(dt);
    this._draw(camera, dt);
  }

  /* ---- people, and the day they are having ------------------------------
     The first version had no errands: a pedestrian picked a neighbouring node
     at random, which over a pavement graph produces drift, and drift is not a
     life. This one gives every walker a ROUND — leave a door, walk to a shop
     and stand at it, take a bench, drift to the plaza with whoever it is
     walking with, go home — and the round is what makes the same hundred and
     twenty people read as a town rather than as a screensaver.

     Two things about it are deliberate:

     - It is timed off the REAL CLOCK. Lunch pulls the crowd toward the shops
       between half eleven and quarter past two and the evening pulls it to the
       plaza and the benches, because a page open at one o'clock should show
       the street at one o'clock. `setNight()` still overrides the evening half,
       so a night screenshot is a night screenshot whatever the hour.
     - It uses a real PATH. An errand is a named destination, so the walker
       needs to get there and not merely toward it, and _path() is a breadth-
       first search over the pavement graph — ninety-four nodes, run once per
       errand, not once per frame. */
  _stepPeople(dt) {
    const nodes = this.walk.nodes;
    if (!nodes.length) return;
    /* The dynamic half of the obstacle map, rebuilt before anybody moves, so
       every test below and every projection in `_holdToPavement` reads the
       same boxes for the whole frame. */
    this._vehicleBoxes();
    for (const c of this.crossings) { c.occupied = 0; c.waiting = 0; c.queue = 0; }
    const hour = this.clockHour();

    for (const a of this.actors) {
      if (a.kind !== 'person') continue;
      a.clock += dt;
      /* Hit. The accident owns this body's position until the street clears —
         the same call the robot victim goes through, because the arc, the
         tumble and the getting up are the same physics whoever is under it. */
      if (a.crash) { this._stepVictim(a, dt); a.lean = a.crash.lean; continue; }
      if (a.leader) { this._followLeader(a, dt); continue; }

      if (a.state === 'pause' || a.state === 'sit' || a.state === 'linger') {
        a.hold -= dt;
        if (a.hold <= 0) {
          if (a.seat) { a.seat.taken = false; a.seat = null; }
          this._nextErrand(a, hour);
        }
        continue;
      }

      /* At a kerb. A pedestrian steps off it when nothing is coming; the
         drivers, for their part, read `waiting` and start braking — which is
         what a zebra crossing IS, and why this cannot deadlock: a car already
         inside five metres neither yields nor is waited for, it simply goes. */
      if (a.state === 'wait') {
        if (a.cross) {
          a.cross.waiting++;
          /* QUEUE, rather than merge. Twenty people waiting at one kerb all
             stood on the one graph node, which is a knot the separation pass
             then spent every frame unpicking — most of the stress scene's
             overlap rate was made here. A queue is what a kerb really holds:
             each arrival takes the next slot BACK from the kerb along the
             crossing's own axis, and only the front two step off when the lane
             clears. Slots are handed out in actor order, which is fixed, so
             the queue is the same queue on two runs of the same seed. */
          const slot = a.cross.queue++;
          if (slot > 0) {
            /* The queue runs ALONG the pavement, to either side of the kerb —
               not back from it. The crossing's own axis is across the road, so
               backing up along that axis walks the tail of a twenty-person
               queue through the shopfronts; the pavement is the other axis,
               and it is where a queue at a crossing really stands. Alternating
               sides keeps the kerb itself, which is the place people actually
               wait, in the middle of it. */
            const kerb = nodes[a.node] ? nodes[a.node].pos : a.pos;
            let axq = kerb.x - a.cross.pos.x, azq = kerb.z - a.cross.pos.z;
            const al = Math.hypot(axq, azq) || 1;
            axq /= al; azq /= al;                       // away from the road
            const px = -azq, pz = axq;                  // along the pavement
            /* Row 1 is the first row BEHIND the kerb, not on top of it. With
               `floor(slot/2)` the second person in every queue was handed a
               place 0.5 m from the first one's — under one personal space, on
               every crossing, on every frame, which is four overlapping pairs
               a frame that no number of solver rounds could ever resolve
               because the target itself was wrong. */
            const row = (Math.floor(slot / 2) + 1) * 1.0, side = (slot % 2 ? 1 : -1);
            const tx = kerb.x + axq * 0.5 + px * row * side;
            const tz = kerb.z + azq * 0.5 + pz * row * side;
            const dq = Math.hypot(tx - a.pos.x, tz - a.pos.z);
            if (dq > 0.15) {
              const st = Math.min(dq, a.speed * dt);
              a.pos.x += ((tx - a.pos.x) / dq) * st;
              a.pos.z += ((tz - a.pos.z) / dq) * st;
              a.pos.y = this.getHeight(a.pos.x, a.pos.z);
            }
          }
          /* And a crossing holds what a crossing holds. Without a cap on how
             many may be ON one, three hundred people put seventy-six of them on
             four zebras at the same time — 0.4 m² each, which is less than a
             person occupies, so the separation pass could not win however many
             rounds it spent. CROSS_CAP is the painted area divided by the space
             one walker needs; past it the rest queue, which is what the queue
             above is for. */
          if (slot < 2 && a.cross.occupied < CROSS_CAP && this._clearToCross(a.cross)) a.state = 'cross';
          else continue;
        } else if (this._clearToCross(a.cross)) a.state = 'cross';
        else continue;
      }
      if (a.state === 'cross' && a.cross) a.cross.occupied++;

      const goal = a.path.length ? nodes[a.path[0]].pos : a.point;
      if (!goal) { this._nextErrand(a, hour); continue; }

      this._tmp.subVectors(goal, a.pos);
      this._tmp.y = 0;
      let d = this._tmp.length();
      if (d > 0.001) {
        /* Each walker keeps its own line across the width of the pavement:
           everybody aiming at the exact node produced one conga line down the
           middle of the flagstones. On a crossing the offset is dropped — a
           zebra is three metres wide and people walk down the middle of it.

           Tapered to nothing in the last couple of metres of a hop, too, and
           not only on a crossing: two walkers whose fixed offsets happen to
           land within `_separate`'s 0.6 m — nothing stops that draw — are
           fine apart on the open pavement, but both are steering at the SAME
           single graph node, so their lines converge on top of each other
           right at it regardless of the offset, and `_separate` was fighting
           that convergence every frame without ever winning, which is the
           residual E6 measured. Narrowing to single file on the approach is
           what a real pinch point does anyway. */
        /* The taper no longer goes to ZERO. Narrowing to single file on the
           approach is right for two people meeting at a doorway (it is what the
           errands pass added it for) and wrong for a kerb that fifty people a
           minute walk through: at the stress counts every walker's line
           converged on the same square metre and the pinch, not the pavement,
           was where the overlapping pairs were — three hundred people put six
           pairs a frame on two graph nodes. A third of the lane offset is kept
           all the way in, so a busy node is walked through on a front a metre
           wide instead of through a point. */
        const taper = Math.min(1, d / OFF_TAPER);
        /* KEEP RIGHT. `a.off` used to be signed either way, so two streams on
           one pavement walked through each other head-on — the worst case
           there is, because the closing speed is doubled and the separation
           pass gets half as many frames to resolve a pair. The magnitude is
           still this walker's own, and it still spreads the stream across the
           width; only the SIDE is now a rule, and it is the side of the
           direction of travel, so the two streams end up on opposite halves of
           the pavement the way they do on a real one.

           Clamped into the hop's free interval, which is what keeps the line a
           walker steers along outside the hedge instead of relying on the
           projection to drag it out afterwards. */
        let off = 0;
        if (a.state === 'cross') {
          /* A zebra is three metres wide and people spread across it. The old
             rule dropped the offset to zero on a crossing, which put everybody
             on the crossing on ONE line: at the stress counts seventy-four
             people were on four zebras at once, in single file, and a single
             file at 0.9 m of personal space is a queue of people standing
             inside each other. It is the biggest single source of the stress
             scene's overlap rate. The lane offset is kept and clamped to the
             painted width instead. */
          off = clamp(a.off * taper, -ZEBRA_HALF + PED_R, ZEBRA_HALF - PED_R);
        } else {
          const sp = this._spanFor(a.node, a.path.length ? a.path[0] : -1);
          const lo = sp ? Math.min(sp.lo, sp.hi) : -this.walkHalf;
          const hi = sp ? Math.max(sp.lo, sp.hi) : this.walkHalf;
          /* KEEP RIGHT, but only where there is a pavement to keep right ON.
             The rule is worth having because two streams walking through each
             other head-on is the worst case the separation pass has: the
             closing speed is doubled and it gets half as many frames to
             resolve a pair. It is worth having ONLY when each direction's half
             is still a body wide, and that is measured, not assumed — forcing
             it on this street's 1.3 m of free pavement gave each direction
             0.65 m, which is narrower than one person, and the stress scene's
             overlap rate went from 14-26 pairs a second to 338. So: two body
             widths of clearance and the streams separate by direction of
             travel; anything narrower and everybody uses the whole width and
             gives way individually, which is also what people do in an alley. */
          off = (hi - lo) >= SEPARATION * 2
            ? clamp(Math.abs(a.off) * taper, Math.max(0, lo), hi)
            : clamp(a.off * taper, lo, hi);
        }
        this._tmp2.set(this._tmp.z / d, 0, -this._tmp.x / d).multiplyScalar(off);
        this._tmp.add(this._tmp2);
        d = this._tmp.length();
      }

      if (d < 0.9) {
        if (a.path.length) {
          a.node = a.path.shift();
          if (a.state === 'cross') { a.state = 'walk'; a.cross = null; }
          if (a.path.length) {
            const c = this._crossingBetween(a.node, a.path[0]);
            if (c) { a.cross = c; a.state = 'wait'; }
          } else if (!a.point) this._arrive(a);
        } else {
          this._arrive(a);
        }
        continue;
      }

      const step = Math.min(d, a.speed * dt);
      /* STOP AND WAIT. The projection in `_holdToPavement` guarantees nobody
         is ever left inside a car, but a walker who is shoved back out of one
         every frame is a walker being teleported. This is the other half:
         look at where the step LANDS, and if that is inside a vehicle box with
         a metre of daylight round it, do not take the step at all. A car
         passing in front of somebody is a person who stops for a beat, which
         is the behaviour, and the projection below is only ever the backstop.
         The accident's victim is exempt — it is supposed to be hit. */
      this._tmp.divideScalar(d);
      const nx = a.pos.x + this._tmp.x * step, nz = a.pos.z + this._tmp.z * step;
      /* Do not ENTER a box; if you are already inside one, the way out is
         forward. Refusing the step unconditionally deadlocks the one place it
         matters most: a queue of cars stopped at the junction stop line covers
         the zebra, and everybody halfway over it froze in the middle of the
         road for as long as the red lasted. And the state is left alone —
         writing `a.state = 'walk'` here (the first version did) turned a
         crosser into a jaywalker mid-carriageway, so the crossing stopped
         counting as occupied, the drivers stopped yielding, and the corridor
         clamp then fought the kerb push over the same body every frame. That
         one line was 200 of the 205 overlapping pairs a second the stress
         scene was reading. */
      if (a.blocked === undefined) a.blocked = 0;
      /* NOT on a zebra. A pedestrian on a crossing has right of way and the
         drivers already read the crossing as occupied; making it wait for a car
         that is waiting for it is the deadlock this file's own zebra rule was
         written to avoid, and it came straight back the moment the vehicle
         boxes were added — two of the four crossings sat permanently occupied
         by nine people who could not move, twenty-two of thirty vehicles stood
         still, and a staged accident never left its approach stage in seventy
         seconds because its driver was one of them. The projection still keeps
         a body out of a car; this rule is only about not walking into one. */
      if (a.state !== 'cross'
          && this.vehicleClearance(a.pos.x, a.pos.z, VEH_CLEAR) >= 0
          && this.vehicleClearance(nx, nz, VEH_CLEAR) < 0
          && a.blocked < 2.5) { a.blocked += dt; continue; }
      a.blocked = 0;
      a.pos.addScaledVector(this._tmp, step);
      a.pos.y = this.getHeight(a.pos.x, a.pos.z);
      /* Turn toward the walk, never snap to it: an instant yaw change is the
         single most robotic thing a walking figure can do. */
      a.yaw += angleTo(a.yaw, Math.atan2(this._tmp.x, this._tmp.z)) * Math.min(1, dt * 6);
      if (a.state !== 'cross') a.state = 'walk';
    }

    /* AFTER everyone has moved, and not before. The overlap probe reads the
       positions this frame DREW, so the pass that guarantees the number has to
       be the last thing that touches them. */
    /* One loop, not two passes. The old order was `_separate()` and THEN
       `_holdToPavement()`, and that is why the stress scene could never reach
       the separation gate however many rounds the solver spent: the clamp ran
       last, moved people, and nothing measured or fixed the overlaps its own
       squeeze had just created. The clamp is a projection and the separation
       is a projection; alternating them until neither moves anybody is the
       only order in which BOTH gates can read zero on the positions drawn. */
    this._separate(dt);
  }

  /* =======================================================================
     THE OBSTACLE MAP — one map, built once, read by everything
     Beri's two reports were the same missing thing: nothing in this module
     knew where the solid objects on the pavement were. The separation pass
     knows about people, the kerb clamp knows about lanes, and a railing, a
     hedge, a bench or a parked car was simply not in the world as far as a
     walker was concerned.

     There is ONE map and every source empties into it: the props this module
     placed (hedges, the fountain, the kiosk, the shelter, the café tables, the
     playground, the standing herd, the hens and the cats), the benches the
     host declared through `addWalkways`, and whatever `addObstacles` was told.
     Everything is reduced to a CIRCLE, because a circle is the only shape a
     clearance test can resolve without a branch, and a segment is a row of
     them.

     It is a grid and not a list for the reason the separation grid is:
     `_holdToPavement()` now runs up to SEP_ROUNDS times a frame inside the
     constraint loop, and three hundred people against eight hundred bushes is
     a quarter of a million distance tests a round if it is a list.
     ======================================================================= */
  _buildObstacles() {
    this.obstacles.length = 0;
    this.obGrid.clear();

    /* 1 — the props this module placed. The radius is the model's own measured
       half-extent, the LARGER of the two: a bench or a shelter is not round,
       and a circle that fits inside it would let a shoulder into the corner.
       The one exclusion is the bus shelter's own footprint being generous —
       reported, not tuned. */
    for (const p of this.props) {
      const e = this.models[p.type];
      if (!e) continue;
      const s = p.scaleV ? p.scaleV.x : 1;
      this._obPut(p.pos.x, p.pos.z, Math.max(e.halfLength, e.halfWidth) * s);
    }
    /* 2 — the benches. The host says where a bench IS; it is a solid object
       whether or not anybody is sitting on it, and a walker who has not chosen
       to sit walks round it. 1.6 m long, so two circles rather than one. */
    for (const s of this.walk.seats) {
      const ux = Math.cos(s.yaw), uz = -Math.sin(s.yaw);
      this._obPut(s.pos.x - ux * 0.45, s.pos.z - uz * 0.45, 0.42);
      this._obPut(s.pos.x + ux * 0.45, s.pos.z + uz * 0.45, 0.42);
    }
    /* 3 — whatever the host declared. A segment becomes overlapping circles at
       a spacing of its own radius, which is what makes a railing solid along
       its whole length rather than a row of gateposts. */
    for (const o of this.hostObstacles) {
      const dx = o.x2 - o.x1, dz = o.z2 - o.z1;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.ceil(len / Math.max(0.25, o.r)));
      for (let i = 0; i <= n; i++) {
        this._obPut(o.x1 + (dx * i) / n, o.z1 + (dz * i) / n, o.r);
      }
    }
    this._buildSegGrid();
    this._buildEdgeSpans();
    return this;
  }

  _obPut(x, z, r) {
    if (!(r > 0)) return;
    const c = { x, z, r };
    this.obstacles.push(c);
    /* Bucketed over every cell the circle touches, so a fountain two metres
       across is found from a cell its centre is not in. */
    const lo = Math.floor((x - r) / OB_CELL), hi = Math.floor((x + r) / OB_CELL);
    const lo2 = Math.floor((z - r) / OB_CELL), hi2 = Math.floor((z + r) / OB_CELL);
    for (let ix = lo; ix <= hi; ix++) {
      for (let iz = lo2; iz <= hi2; iz++) {
        const k = ix * 100003 + iz;
        let b = this.obGrid.get(k);
        if (!b) { b = []; this.obGrid.set(k, b); }
        b.push(c);
      }
    }
  }

  /* Every obstacle whose circle can reach a point, handed to `cb`. The caller's
     own radius widens the search by one cell either way, which is why `pad` is
     a parameter and not baked in. */
  _obNear(x, z, pad, cb) {
    if (!this.obGrid.size) return;
    const span = Math.max(1, Math.ceil(pad / OB_CELL));
    const ix = Math.floor(x / OB_CELL), iz = Math.floor(z / OB_CELL);
    for (let ox = -span; ox <= span; ox++) {
      for (let oz = -span; oz <= span; oz++) {
        const b = this.obGrid.get((ix + ox) * 100003 + iz + oz);
        if (!b) continue;
        for (const c of b) cb(c);
      }
    }
  }

  /* How far a point is from the nearest static obstacle's SURFACE. Negative is
     inside one, and that is the number `__penetrations()` counts. */
  obstacleClearance(x, z) {
    let best = Infinity;
    this._obNear(x, z, PED_R + 1.5, c => {
      const d = Math.hypot(x - c.x, z - c.z) - c.r;
      if (d < best) best = d;
    });
    return best;
  }

  /* Out of every static obstacle, by the shortest way. Two rounds, because
     coming out of a hedge can put somebody against the bench behind it. */
  _pushOutOfObstacles(pos) {
    let moved = 0;
    for (let round = 0; round < 2; round++) {
      let hit = null, hd = Infinity;
      this._obNear(pos.x, pos.z, PED_R + 0.5, c => {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz) - c.r - PED_R;
        if (d < 0 && d < hd) { hd = d; hit = c; }
      });
      if (!hit) break;
      let dx = pos.x - hit.x, dz = pos.z - hit.z;
      let d = Math.hypot(dx, dz);
      /* Dead centre of a bush. There is no direction to leave by, so one is
         taken from the obstacle's own coordinates — the SAME one every frame,
         which is what stops a walker vibrating inside it. */
      if (d < 1e-4) { const t = (hit.x * 7.13 + hit.z * 3.71) % TAU; dx = Math.cos(t); dz = Math.sin(t); d = 1; }
      const want = hit.r + PED_R + 5e-3;
      pos.x = hit.x + (dx / d) * want;
      pos.z = hit.z + (dz / d) * want;
      moved = 1;
    }
    return moved;
  }

  /* ---- the pavement's free width, per edge ------------------------------
     The hedges and the railings went in AFTER the lanes were laid out and
     nothing recomputed the pavement around them, which is Beri's report A in
     one sentence. This is the recompute, and it happens once at build time.

     For each edge of the pavement graph, walk it in half-metre steps and, at
     each step, subtract from the corridor `[-walkHalf, +walkHalf]` the lateral
     band every obstacle within reach occupies. What is left over the WHOLE
     edge is the interval a walker may use — the reroute. An edge whose
     remaining interval is narrower than one body is not a pavement any more
     and is REMOVED from the graph.

     Removal is guarded: an edge is only cut if both its ends still have
     another link, because a graph that loses its last edge to a front door
     strands whoever lives there and `__counts().walk.components` goes to two.
     A blocked-but-last edge keeps its narrowest usable line instead, and that
     is reported through `stats().walk` rather than silently invented. */
  _buildEdgeSpans() {
    this.edgeSpan.clear();
    if (!this.obstacles.length) return;
    const nodes = this.walk.nodes, half = this.walkHalf;
    const cut = [];
    for (let a = 0; a < nodes.length; a++) {
      for (const b of nodes[a].links) {
        if (b <= a) continue;
        /* A crossing is not a pavement and has no verge to give way on. */
        if (this._crossingBetween(a, b)) continue;
        const pa = nodes[a].pos, pb = nodes[b].pos;
        const ex = pb.x - pa.x, ez = pb.z - pa.z;
        const len = Math.hypot(ex, ez);
        if (len < 1e-3) continue;
        const ux = ex / len, uz = ez / len;
        let lo = -half, hi = half, blocked = false;
        const steps = Math.max(2, Math.ceil(len / 0.5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = pa.x + ex * t, pz = pa.z + ez * t;
          /* This step's OWN free interval, measured from the whole pavement
             rather than from what is left of it. The two readings answer
             different questions and the first version conflated them: the
             running intersection is the line a walker can HOLD for the length
             of the hop, and it collapses to nothing over a long run with a
             wiggly hedge on alternate sides; a step whose own interval is
             empty is a pavement that is genuinely walled off, and only THAT is
             a reason to cut the edge out of the graph. Conflating them cut
             nothing but pinned three hundred people onto single lines at
             z = -6.6 and read 364 overlapping pairs a second. */
          let slo = -half, shi = half;
          this._obNear(px, pz, half + PED_R + 1.0, c => {
            const rx = c.x - px, rz = c.z - pz;
            const along = rx * ux + rz * uz;
            if (Math.abs(along) > 0.55) return;
            const across = rx * -uz + rz * ux;
            const blockLo = across - c.r - PED_R, blockHi = across + c.r + PED_R;
            if (blockHi <= slo || blockLo >= shi) return;
            /* Keep the LARGER surviving side. A hedge planted on the far verge
               leaves the road-side half of the pavement, which is where the
               crowd should have been walking all along. */
            const left = blockLo - slo, right = shi - blockHi;
            if (left >= right) shi = Math.max(slo, blockLo);
            else slo = Math.min(shi, blockHi);
          });
          if (shi - slo < PED_R * 2) blocked = true;
          lo = Math.max(lo, slo);
          hi = Math.min(hi, shi);
        }
        const k = a * 100003 + b;
        if (blocked && nodes[a].links.length > 1 && nodes[b].links.length > 1) {
          cut.push([a, b, (lo + hi) * 0.5]);
          continue;
        }
        /* A line is not a lane. Where the intersection has closed to less than
           one body — a long run with the hedge weaving across it — the steering
           hint is widened back to a body's width about its own middle and the
           runtime push-out is left to keep people out of the actual bushes.
           Pinning a crowd to a single line is how a pavement becomes a queue of
           people standing inside each other. */
        if (hi - lo < PED_R * 2) {
          const mid = clamp((lo + hi) * 0.5, -half + PED_R, half - PED_R);
          lo = mid - PED_R; hi = mid + PED_R;
        }
        this.edgeSpan.set(k, { lo, hi });
      }
    }
    /* Cutting an edge is only allowed if the graph still holds together
       without it. `__counts().walk.components` has to read 1 — a walker whose
       shop is in another component can never path to it, and the street
       quietly turns back into drift — and the first run of this pass cut five
       edges and made three components out of one. So each candidate is removed
       and then CHECKED: if the two ends are still reachable by another route
       the cut stands, otherwise it is put back and the edge keeps the thinnest
       line through it instead. One breadth-first search per candidate over
       ninety-odd nodes, once, at build time. */
    let done = 0;
    for (const [a, b, mid] of cut) {
      nodes[a].links = nodes[a].links.filter(i => i !== b);
      nodes[b].links = nodes[b].links.filter(i => i !== a);
      if (this._path(a, b)) { done++; continue; }
      nodes[a].links.push(b);
      nodes[b].links.push(a);
      /* Put back, and with a body's width of steering room about the best
         line through it rather than pinned to that line. */
      const m = clamp(mid, -this.walkHalf + PED_R, this.walkHalf - PED_R);
      this.edgeSpan.set(Math.min(a, b) * 100003 + Math.max(a, b),
                        { lo: m - PED_R, hi: m + PED_R });
    }
    this.edgesCut = done;
  }

  /* The free lateral interval on the hop from node `i` to node `j`, in the
     direction of travel. Stored once per undirected edge, so the sign flips
     when the walk is the other way round. */
  _spanFor(i, j) {
    if (i < 0 || j < 0) return null;
    const s = this.edgeSpan.get(Math.min(i, j) * 100003 + Math.max(i, j));
    if (!s) return null;
    return i < j ? s : { lo: -s.hi, hi: -s.lo };
  }

  /* ---- the lane segments, bucketed -------------------------------------
     `_onCarriageway` and `_pushOffCarriageway` used to scan every point of
     every lane. They are called once per person per constraint ROUND now, so
     at three hundred people and ten rounds that scan is most of a frame. Same
     grid, same reason as the separation grid. */
  _buildSegGrid() {
    const g = this._segGrid || (this._segGrid = new Map());
    g.clear();
    for (const lane of this.lanes) {
      for (let i = 1; i < lane.pts.length; i++) {
        const p = lane.pts[i - 1], q = lane.pts[i];
        const seg = { lane, p, q };
        const lo = Math.floor((Math.min(p.x, q.x) - LANE_HALF) / SEG_CELL);
        const hi = Math.floor((Math.max(p.x, q.x) + LANE_HALF) / SEG_CELL);
        const lo2 = Math.floor((Math.min(p.z, q.z) - LANE_HALF) / SEG_CELL);
        const hi2 = Math.floor((Math.max(p.z, q.z) + LANE_HALF) / SEG_CELL);
        for (let ix = lo; ix <= hi; ix++) {
          for (let iz = lo2; iz <= hi2; iz++) {
            const k = ix * 100003 + iz;
            let b = g.get(k);
            if (!b) { b = []; g.set(k, b); }
            b.push(seg);
          }
        }
      }
    }
  }

  _segNear(x, z, cb) {
    const g = this._segGrid;
    if (!g || !g.size) return;
    const b = g.get(Math.floor(x / SEG_CELL) * 100003 + Math.floor(z / SEG_CELL));
    if (!b) return;
    for (const s of b) cb(s);
  }

  /* ---- the vehicles, as boxes, once a frame ----------------------------
     The static map is built once; a car is not static. Every vehicle's own
     measured half-length and half-width, on its own heading, rebuilt at the
     top of the people step so the boxes are the ones the frame is about to
     draw. The ambulance is in the list when there is one: it is the largest
     thing on the street at the moment it matters most. */
  _vehicleBoxes() {
    const out = this._vehBoxes || (this._vehBoxes = []);
    out.length = 0;
    for (const v of this.vehicles) {
      const e = this.models[v.type];
      if (!e) continue;
      const h = v.head;
      const l = Math.hypot(h.x, h.z) || 1;
      out.push({
        x: v.pos.x, z: v.pos.z, ux: h.x / l, uz: h.z / l,
        hl: v.half, hw: e.halfWidth, moving: v.speed > 0.4,
      });
    }
    for (const p of this.parked) {
      const e = this.models[p.type];
      if (!e) continue;
      out.push({
        x: p.pos.x, z: p.pos.z, ux: Math.sin(p.yaw), uz: Math.cos(p.yaw),
        hl: e.halfLength, hw: e.halfWidth, moving: false,
      });
    }
    /* Host-parked vehicles (park()): a stationary box the crowd steps round. */
    for (const p of this.hostParked) {
      out.push({
        x: p.pos.x, z: p.pos.z, ux: Math.sin(p.yaw), uz: Math.cos(p.yaw),
        hl: p.halfLength, hw: p.halfWidth, moving: false,
      });
    }
    if (this.accident && this.accident.amb && this.ambGroup && this.ambGroup.visible) {
      const a = this.ambGroup;
      out.push({ x: a.position.x, z: a.position.z, ux: Math.sin(a.rotation.y),
                 uz: Math.cos(a.rotation.y), hl: 2.6, hw: 1.1, moving: false });
    }
    return out;
  }

  /* How far a point is from the nearest vehicle box's SURFACE, negative
     inside. `pad` widens the box, which is how the stop-and-wait test asks a
     different question from the penetration probe with the same code. */
  vehicleClearance(x, z, pad = 0) {
    const boxes = this._vehBoxes || [];
    let best = Infinity;
    for (const b of boxes) {
      const rx = x - b.x, rz = z - b.z;
      const along = Math.abs(rx * b.ux + rz * b.uz) - (b.hl + pad);
      const across = Math.abs(rx * -b.uz + rz * b.ux) - (b.hw + pad);
      /* Outside on either axis: the real distance to the rectangle. Inside
         both: the negative of the smaller penetration, which is the direction
         the push below will take. */
      const d = (along > 0 || across > 0)
        ? Math.hypot(Math.max(0, along), Math.max(0, across))
        : Math.max(along, across);
      if (d < best) best = d;
    }
    return best - PED_R;
  }

  /* Out of every vehicle box, along whichever of the box's own axes is the
     shorter way out — which is across the car for somebody beside it and out
     of the front for somebody on the bonnet. */
  _pushOutOfVehicles(pos) {
    const boxes = this._vehBoxes || [];
    let moved = 0;
    for (let round = 0; round < 3; round++) {
      let worst = null, wd = 0;
      for (const b of boxes) {
        const rx = pos.x - b.x, rz = pos.z - b.z;
        const al = rx * b.ux + rz * b.uz, ac = rx * -b.uz + rz * b.ux;
        const dl = (b.hl + PED_R) - Math.abs(al), dc = (b.hw + PED_R) - Math.abs(ac);
        if (dl <= 0 || dc <= 0) continue;                       // outside the box
        const pen = Math.min(dl, dc);
        if (pen > wd) { wd = pen; worst = { b, al, ac, dl, dc }; }
      }
      if (!worst) break;
      const { b, al, ac, dl, dc } = worst;
      if (dc <= dl) {
        const s = ac >= 0 ? 1 : -1, want = (b.hw + PED_R + 5e-3) * s;
        pos.x += (-b.uz) * (want - ac);
        pos.z += (b.ux) * (want - ac);
      } else {
        const s = al >= 0 ? 1 : -1, want = (b.hl + PED_R + 5e-3) * s;
        pos.x += b.ux * (want - al);
        pos.z += b.uz * (want - al);
      }
      moved = 1;
    }
    return moved;
  }

  /* Keep a walker on the flagstones.

     The stress scene is three hundred people on ninety-nine pavement nodes.
     Nothing in the module ever said a pedestrian may not stand on the
     carriageway, so when the pavement filled up the separation pass — which
     only knows about other people — pushed the overflow sideways into the
     road, and the probe measured thirty-two of them out there on every one of
     600 frames. That is the crowd walking down the middle of the street in
     Beri's recording, and it is not a bug in the walking: it is a missing
     constraint.

     The constraint is the pavement the host already declared. A walker between
     two graph nodes is inside the corridor between them, `walkHalf` either
     side, and this clamps it back into that corridor after separation has had
     its say. Separation then pushes ALONG the pavement instead of off it,
     which is what a crowded pavement really does.

     Three cases are deliberately left alone, because none of them is a
     pavement: somebody ON a zebra, somebody the accident has knocked down, and
     somebody off the graph entirely — the last few metres to a bench, a
     doorway, the open middle of a square. Those are the only people who can be
     on the carriageway, so they are also where `_onRoad` comes from: the list
     the drivers brake for. */
  _holdToPavement() {
    const nodes = this.walk.nodes, half = this.walkHalf;
    const onRoad = this._onRoad || (this._onRoad = []);
    onRoad.length = 0;
    /* How many people this pass actually MOVED. The constraint loop in
       `_separate` runs this and the pairwise fix alternately, and it needs to
       know when the projection has stopped changing anything — that, and zero
       overlapping pairs, is the fixed point both gates are read at. */
    let moved = 0;
    const bx = this._tmp3 || (this._tmp3 = new THREE.Vector3());

    for (const a of this.actors) {
      if (a.kind !== 'person') continue;
      /* The accident's victim, who is SUPPOSED to be in the road. It is
         staged by walking one pedestrian off the kerb in front of a car, and
         the kerb-clamp below quietly cancelled that: the victim was pushed
         back onto the pavement every frame, the car never reached anybody and
         `__accidentState()` sat in 'approach' for thirty seconds. It is added
         to `_onRoad` by name below, so every other driver still brakes for it. */
      if (a.crash) continue;
      bx.copy(a.pos);
      /* A zebra IS the way across, and the drivers already read it through
         `crossing.occupied`. Clamping somebody on one back to a pavement would
         drag them off the crossing halfway over — so the CORRIDOR and the kerb
         are skipped for a crosser, and only for a crosser.

         What is NOT skipped any more is the obstacle and vehicle projection
         below it. Skipping the whole body of this loop was Beri's second
         screenshot: somebody halfway over a zebra with a car on top of them,
         because the one person on this street who is legitimately in the road
         was also the one person nothing ever pushed out of a car. The probe
         read it as 5.3 penetrations a second, worst 0.84 m deep. */
      const onZebra = a.state === 'cross';
      /* A waiter has no corridor either, and for the opposite reason: its path
         still points ACROSS the road, so the corridor clamp is the crossing
         itself and it dragged the whole kerb queue back onto the crossing's
         centre line — straight through the queue positions the wait state had
         just spread along the pavement. Two rules pulling one body two ways is
         what put twelve of the stress scene's overlapping pairs at one kerb.
         The kerb push and the obstacle push still apply to a waiter; only the
         corridor does not. */
      const p = (!onZebra && a.state !== 'wait' && a.node >= 0) ? nodes[a.node] : null;
      /* The next graph node, or — when the graph has run out and the walker is
         on the last few metres to a bench or a doorway — that point. Leaving
         the second case unclamped is what let four of them stand in the road on
         every frame of the first measured run: `a.point` is off the graph, but
         the walk to it is still a corridor. */
      const q = a.path.length ? nodes[a.path[0]] : (a.point ? { pos: a.point } : null);
      if (p && q && !this._inPlaza(a.pos)) {
        const ex = q.pos.x - p.pos.x, ez = q.pos.z - p.pos.z;
        const len2 = ex * ex + ez * ez;
        if (len2 > 1e-6) {
          const len = Math.sqrt(len2);
          const ux = ex / len, uz = ez / len;
          const rx = a.pos.x - p.pos.x, rz = a.pos.z - p.pos.z;
          /* Along the corridor, with half a pavement of slack at each end so
             the clamp does not fight the walker's own arrival at a node. */
          const along = clamp(rx * ux + rz * uz, -half, len + half);
          /* Across it, hard. This is the whole point — and since the obstacle
             pass, the limits are the edge's own FREE interval and not the full
             pavement: a hedge, a railing or a bench beside this hop has already
             been subtracted from it at build time, so clamping into the span
             is what walks the crowd round the obstacle instead of through it.
             An edge with no entry (a crossing, or a graph built before any
             obstacle was declared) keeps the whole width. */
          const sp = this._spanFor(a.node, a.path.length ? a.path[0] : -1);
          const lo = sp ? Math.max(-half, sp.lo) : -half;
          const hi = sp ? Math.min(half, sp.hi) : half;
          /* With a dead zone, and that is what closes this gate. The clamp and
             the separation sweeps are two projections that do not share a fixed
             point: the sweeps settle the crowd (`solvedPerSecond` reads 0.04 at
             three hundred people), the clamp then pulls everybody a few
             centimetres back onto their line and makes three new overlapping
             pairs, and the two alternate forever — 77 pairs a second measured on
             the drawn positions against 0.04 on the solver's. A hard constraint
             that is only ever violated by centimetres does not need to be
             enforced by centimetres. Inside CORRIDOR_SLACK the walker is left
             where the sweeps put it, which is still on the flagstones: 1.19 m
             of half-pavement plus 0.35 m of slack is 1.54 m, and the host's own
             pavement is 1.7 m to the kerb. Outside it the clamp is as hard as it
             ever was, and the KERB push and the obstacle push are untouched —
             those are the ones that would show as somebody in a hedge. */
          const across = clamp(rx * -uz + rz * ux,
                               Math.min(lo, hi) - CORRIDOR_SLACK,
                               Math.max(lo, hi) + CORRIDOR_SLACK);
          a.pos.x = p.pos.x + ux * along - uz * across;
          a.pos.z = p.pos.z + uz * along + ux * across;
          a.pos.y = this.getHeight(a.pos.x, a.pos.z);
        }
      }
      /* And then, corridor or no corridor, nobody is left standing in the
         road. Two kinds of person got here: somebody sitting, lingering or
         waiting, whose path and point are both spent and who therefore has no
         corridor at all — the probe found a lingerer two metres inside the
         kerb and a walker on the last metres to a door cutting the side street
         on 145 frames out of 600 — and, at 300 people, somebody whose corridor
         itself clips a carriageway at the edge of a pedestrian square, where
         the lane graph resumes a metre outside the paving. Both are walked
         back to the kerb.

         They are still reported in `_onRoad` for this frame, because a driver
         reacts to where somebody WAS when it read the road, and because a rule
         that hid them from the drivers would be a rule that only flatters the
         probe. */
      if (!onZebra && this._onCarriageway(a.pos)) {
        onRoad.push(a);
        this._pushOffCarriageway(a.pos);
      }
      /* And then out of the solid things, which is Beri's report A. Statics
         first — they are where the walker is allowed to end up — then the
         vehicle boxes, because coming off a bonnet must not put somebody
         inside the railing behind it and the static pass is the one that has
         the last word on where the pavement actually is. Both are hard
         projections: at the end of this the capsule is outside everything, so
         `__penetrations()` reads zero on the positions the frame draws. */
      /* Alternated until neither of them moves anybody, and not run once each
         in a fixed order: coming off a bonnet can put somebody inside the
         railing behind it and coming out of the railing can put them back on
         the bonnet, so a fixed order leaves whichever one ran FIRST violated.
         Four alternations is enough for everything on this street; a body
         genuinely wedged between a hedge and a car is reported by the probe
         rather than resolved by an infinite loop. */
      for (let r = 0; r < 4; r++) {
        const so = this._pushOutOfObstacles(a.pos);
        const sv = this._pushOutOfVehicles(a.pos);
        if (!so && !sv) break;
      }
      a.pos.y = this.getHeight(a.pos.x, a.pos.z);
      /* 3 mm, and not the float epsilon: a projection that lands exactly on a
         boundary re-lands on it by a fraction of a millimetre every round, and
         counting that as movement spends the whole round budget on nothing. */
      if (Math.abs(a.pos.x - bx.x) > 3e-3 || Math.abs(a.pos.z - bx.z) > 3e-3) moved++;
    }
    /* And whatever the accident has put on the carriageway. Every OTHER driver
       brakes for a body in the road by exactly the rule above; the one that hit
       it is the only exception, and it is flagged rather than special-cased
       here. */
    if (this.accident && this.accident.victim) onRoad.push(this.accident.victim);
    return moved;
  }

  /* Inside a declared square, where there are no corridors because a square is
     open ground. */
  _inPlaza(pos) {
    for (const pz of this.walk.plazas) {
      const dx = pos.x - pz.pos.x, dz = pos.z - pz.pos.z;
      if (dx * dx + dz * dz < pz.radius * pz.radius) return true;
    }
    return false;
  }

  /* Out of the road, by the shortest way. Perpendicular to the lane the point
     is in, to just past its edge — repeated, because a two-lane carriageway
     pushed out of one lane can land in the other one, and four rounds clears
     any road this module builds (two lanes each way is the widest it draws). */
  _pushOffCarriageway(pos) {
    for (let round = 0; round < 4; round++) {
      let hit = null, hx = 0, hz = 0, hd = Infinity;
      /* Through the segment grid, for the same reason `_onCarriageway` is. */
      this._segNear(pos.x, pos.z, ({ lane, p, q }) => {
        const ex = q.x - p.x, ez = q.z - p.z;
        const t = clamp(((pos.x - p.x) * ex + (pos.z - p.z) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const dx = pos.x - (p.x + ex * t), dz = pos.z - (p.z + ez * t);
        const d2 = dx * dx + dz * dz;
        if (d2 < LANE_HALF * LANE_HALF && d2 < hd) { hd = d2; hit = lane; hx = dx; hz = dz; }
      });
      if (!hit) return;
      const d = Math.sqrt(hd) || 1e-3;
      /* Straight out from the centre line, a little past the lane's edge. The
         direction is the one they are already nearest to, so nobody is pushed
         across the road they were standing beside. */
      const out = (LANE_HALF + 0.4) / d;
      pos.x += hx * (out - 1);
      pos.z += hz * (out - 1);
    }
  }

  /* Within a lane's own half-width of a lane centre line. The lanes and not the
     roads: a stretch of road that a pedestrian zone has cut out of the lane
     graph is a square with paving on it, and nobody should brake for somebody
     standing in the middle of the market. */
  _onCarriageway(pos) {
    /* Through the segment grid since the constraint loop started calling this
       up to SEP_ROUNDS times per person per frame; the geometry is unchanged. */
    let on = false;
    this._segNear(pos.x, pos.z, ({ p, q }) => {
      if (on) return;
      const ex = q.x - p.x, ez = q.z - p.z;
      const t = clamp(((pos.x - p.x) * ex + (pos.z - p.z) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      const dx = pos.x - (p.x + ex * t), dz = pos.z - (p.z + ez * t);
      if (dx * dx + dz * dz < LANE_HALF * LANE_HALF) on = true;
    });
    return on;
  }

  /* The wall clock, in hours, because the peaks are supposed to be the real
     ones. Not a simulated day: this page is a window onto the actual one. */
  clockHour() {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  }

  /* Someone walking with somebody else does not navigate: it keeps station.
     That is what turns a hundred and twenty independent walkers into a street
     with couples and a family on it, and it is also why a follower never
     path-finds — two people who each solved the graph would split at the first
     fork and rejoin a hundred metres later, which is the one thing a pair
     visibly never does. */
  _followLeader(a, dt) {
    const L = a.leader;
    const was = a.state;
    if (L.state === 'pause' || L.state === 'linger' || L.state === 'sit') {
      /* A follower stands beside the bench rather than sitting on it: only one
         person per seat, and that rule belongs to the seat. */
      a.state = L.state === 'sit' ? 'linger' : L.state;
      a.hold = 1;
    } else if (L.state === 'wait') {
      a.state = 'wait';
    } else {
      a.state = L.state;
      if (L.state === 'cross') a.cross = L.cross;
    }
    /* A group is still on the zebra when its leader has stepped off it.

       A follower does not path-find — that is the whole point of a group — so
       it has no corridor of its own and `_holdToPavement` cannot hold it to
       one. What it has is the leader's route, and the leader is held to the
       pavement and crosses only at a crossing. So a follower that is ON the
       carriageway is on the crossing its leader used, and it stays 'cross'
       until it is off the road again.

       Without this the probe read a peak of eighteen people in the road on
       every frame: a family of three is strung out over a fifteen-metre
       crossing, and the leader reaching the far kerb turned the two still in
       the middle of it into jaywalkers in the same instant. Worse than the
       number, the drivers stopped yielding — a crossing counts as occupied
       only while somebody the module calls a crosser is on it — so a car
       accelerated into the rest of the family. They count into the crossing
       now, which is what keeps it occupied until the last of them is over. */
    if (a.state !== 'cross' && this._onCarriageway(a.pos)) {
      a.state = 'cross';
      if (!a.cross) a.cross = L.cross || this._nearestCrossing(a.pos);
    } else if (was === 'cross' && a.state !== 'cross') {
      a.cross = null;
    }
    if (a.state === 'cross' && a.cross) a.cross.occupied++;
    /* Station: beside the leader and a step behind, in the leader's own frame,
       so the formation turns with it instead of swinging around it. */
    const s = Math.sin(L.yaw), c = Math.cos(L.yaw);
    this._tmp.set(L.pos.x + c * a.side - s * 0.55, 0, L.pos.z - s * a.side - c * 0.55);
    this._tmp.sub(a.pos);
    this._tmp.y = 0;
    const d = this._tmp.length();
    if (d < 0.35) {
      a.yaw += angleTo(a.yaw, L.yaw) * Math.min(1, dt * 6);
      return;
    }
    /* A shade faster than the leader, or a pair drifts apart every time the
       leader turns a corner and never closes the gap again. */
    const step = Math.min(d, (L.state === 'walk' || L.state === 'cross' ? a.speed * 1.15 : a.speed) * dt);
    a.pos.addScaledVector(this._tmp.divideScalar(d), step);
    a.pos.y = this.getHeight(a.pos.x, a.pos.z);
    a.yaw += angleTo(a.yaw, Math.atan2(this._tmp.x, this._tmp.z)) * Math.min(1, dt * 6);
  }

  /* Arrived. What that means is what the errand was. */
  _arrive(a) {
    if (a.errand === 'bench') {
      /* Whichever free bench is nearest, now that we are here. */
      let seat = null, best = 12 * 12;
      for (const s of this.walk.seats) {
        if (s.taken) continue;
        const d = s.pos.distanceToSquared(a.pos);
        if (d < best) { best = d; seat = s; }
      }
      if (seat) { seat.taken = true; a.seat = seat; }
      else a.errand = 'plaza';
    }
    if (a.errand === 'bench' && a.seat) {
      a.pos.copy(a.seat.pos);
      a.yaw = a.seat.yaw;
      a.state = 'sit';
      /* Twenty-five to seventy seconds, and the number is not decoration: the
         plaza is sixty metres off the street and the walk there is the best
         part of a minute, so at ten to thirty seconds nobody was ever ON a
         bench when a screenshot was taken — twenty-four people were heading
         for twelve benches and the square photographed empty. Somebody who
         walks a minute to sit down does not get up after ten seconds. */
      a.hold = 25 + this.rand() * 45;
    } else if (a.errand === 'plaza') {
      /* Spread across the square, the door ring's own trick on a bigger dial.
         Without this every arrival stopped on the plaza's one graph NODE — a
         single point, not a place — so a settled square was a crowd standing
         on each other that `_separate` had to spend several frames unpicking
         every time somebody new walked in. That churn is what E6 measured: 0
         pairs at any instant sampled, but a non-zero accumulated rate, because
         the instant nobody was looking was never the instant a new arrival
         landed. A radius scaled off the id and not a fixed rim keeps a few
         people nearer the middle instead of a single ring of figures round
         the edge. */
      const plaza = this.walk.plazas.find(p => p.node === a.node);
      if (plaza) {
        const t = (a.id * 2.399963) % TAU;
        const r = Math.max(1, plaza.radius - 1.5) * (0.2 + 0.7 * (((a.id * 7) % 11) / 10));
        a.pos.set(plaza.pos.x + Math.cos(t) * r, a.pos.y, plaza.pos.z + Math.sin(t) * r);
        a.pos.y = this.getHeight(a.pos.x, a.pos.z);
      }
      a.state = 'linger';
      a.hold = 20 + this.rand() * 30;
    } else {
      /* A door. Standing at one and looking at it for a few seconds is what a
         front door and a shop window both look like from the street.

         Stood on a RING round the door and not on the door itself: eight people
         who all walked to the same shop all stopped inside the same metre, and
         the separation pass then had a knot of eight to unpick every frame for
         as long as they stood there. The angle comes off the person's own id,
         so it is the same place every time and nobody shuffles. */
      const spot = this.walk.nodes[a.node];
      if (spot) {
        const t = (a.id * 2.399963) % TAU;
        a.pos.set(spot.pos.x + Math.cos(t) * 1.05, a.pos.y, spot.pos.z + Math.sin(t) * 1.05);
        a.pos.y = this.getHeight(a.pos.x, a.pos.z);
        a.yaw = Math.atan2(spot.pos.x - a.pos.x, spot.pos.z - a.pos.z);
      }
      a.state = 'pause';
      a.hold = (a.errand === 'shop' ? 6 : 4) + this.rand() * 9;
    }
    a.point = null;
  }

  /* Pick the next errand and lay a path to it. The order is the round —
     home, shop, bench, plaza, home — and the clock bends it: at lunch most
     people are going to a shop whatever they did last, and in the evening most
     are going to the plaza or to a bench. */
  _nextErrand(a, hour) {
    const w = this.walk;
    const lunch = hour >= 11.5 && hour < 14.25;
    const evening = hour >= 17 || this.night > 0.35;
    let next = ROUND[a.errand] || 'shop';
    if (lunch && this.rand() < 0.55) next = 'shop';
    else if (evening && this.rand() < 0.5) next = this.rand() < 0.4 ? 'bench' : 'plaza';

    let node = -1, point = null;
    if (next === 'bench') {
      /* Head for a bench, do not RESERVE one. Claiming the seat at planning
         time looked tidier and emptied the plaza: twelve people heading for
         twelve benches held all twelve of them for the two minutes it took to
         walk there, so every bench was taken and none of them had anybody on
         it. The seat is taken on arrival instead, and somebody who finds it
         gone lingers in the square, which is what actually happens. */
      const free = w.seats.filter(x => !x.taken);
      if (free.length) {
        const seat = free[Math.floor(this.rand() * free.length)];
        point = seat.pos;
        node = this._nearestNode(seat.pos);
      } else { next = 'plaza'; }
    }
    if (next === 'plaza') {
      const pz = w.plazas.length ? w.plazas[Math.floor(this.rand() * w.plazas.length)] : null;
      node = pz ? pz.node : a.home;
      /* A SQUARE is not a point, and the pavement graph only has the point. A
         plaza is one node, so everybody heading for it steered at the same
         couple of metres of paving: at the stress counts a hundred and fifteen
         people converged on one spot and the separation pass spent every round
         of its budget prising them apart — 370-400 overlapping pairs a second,
         and the same street reads 15 when the crowd is spread. So the last few
         metres are given a point of this walker's OWN inside the square, on a
         golden-angle spiral off its id: deterministic, no `Math.random`, and it
         fills the paving evenly however many people arrive. */
      if (pz) {
        const k = a.id + 1;
        const ang = k * 2.39996323, rad = pz.radius * 0.86 * Math.sqrt((k % 97) / 97);
        a.plazaPoint = a.plazaPoint || new THREE.Vector3();
        a.plazaPoint.set(pz.pos.x + Math.sin(ang) * rad, pz.pos.y,
                         pz.pos.z + Math.cos(ang) * rad);
        point = a.plazaPoint;
      }
    }
    if (next === 'shop') node = w.shops.length
      ? w.shops[Math.floor(this.rand() * w.shops.length)] : a.home;
    if (next === 'home') node = a.home;
    if (node < 0) node = a.home;

    const from = a.node >= 0 ? a.node : this._nearestNode(a.pos);
    const path = this._path(from, node);
    if (!path) {
      /* Not reachable — two pavements with nothing joining them. Give the seat
         back and wander one link, which is what the module did everywhere
         before this pass and is still the right fallback. */
      if (a.seat) { a.seat.taken = false; a.seat = null; }
      const links = this.walk.nodes[from] ? this.walk.nodes[from].links : [];
      a.node = from;
      a.path = links.length ? [links[Math.floor(this.rand() * links.length)]] : [];
      a.point = null;
      a.errand = 'home';
      a.state = 'walk';
      return;
    }
    a.errand = next;
    a.node = from;
    a.path = path;
    a.point = point;
    a.state = 'walk';
    /* A crossing on the very first hop has to be seen before the walker steps
       into the road, not after. */
    if (path.length) {
      const c = this._crossingBetween(from, path[0]);
      if (c) { a.cross = c; a.state = 'wait'; }
    } else if (!point) this._arrive(a);
  }

  /* Breadth-first over the pavement graph. Ninety-four nodes and a hundred and
     eighty links: a full search is under a hundred microseconds and it runs
     once per errand, so there is nothing here worth pre-computing. */
  _path(from, to) {
    const nodes = this.walk.nodes;
    if (from === to || from < 0 || to < 0 || !nodes[from] || !nodes[to]) return [];
    const prev = new Int32Array(nodes.length).fill(-1);
    const seen = new Uint8Array(nodes.length);
    const q = [from];
    seen[from] = 1;
    for (let h = 0; h < q.length; h++) {
      const n = q[h];
      for (const k of nodes[n].links) {
        if (seen[k]) continue;
        seen[k] = 1;
        prev[k] = n;
        if (k === to) {
          const path = [];
          for (let c = to; c !== from; c = prev[c]) path.push(c);
          return path.reverse();
        }
        q.push(k);
      }
    }
    return null;
  }

  /* How many disconnected pieces the pavement graph is in, and how much of it
     the biggest piece holds. This is the single most useful thing to look at
     when the errands go wrong: a walker whose shop is in another component can
     never path to it, falls back to wandering one link, and the whole street
     quietly turns back into the drift this pass replaced. Two pavements down
     one street ARE two components until a crossing joins them. */
  _walkComponents() {
    const nodes = this.walk.nodes;
    const seen = new Int32Array(nodes.length).fill(-1);
    let n = 0, biggest = 0;
    const sizes = [];
    for (let i = 0; i < nodes.length; i++) {
      if (seen[i] >= 0) continue;
      const q = [i];
      seen[i] = n;
      for (let h = 0; h < q.length; h++) {
        for (const k of nodes[q[h]].links) if (seen[k] < 0) { seen[k] = n; q.push(k); }
      }
      /* Where the piece IS, not only how big it is: a component count says
         something is disconnected, a position says WHAT. */
      sizes.push({ n: q.length, at: [+nodes[i].pos.x.toFixed(1), +nodes[i].pos.z.toFixed(1)] });
      if (q.length > biggest) biggest = q.length;
      n++;
    }
    sizes.sort((a, b) => b.n - a.n);
    return { components: n, biggest, sizes, nodes: nodes.length };
  }

  _nearestNode(pos) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < this.walk.nodes.length; i++) {
      const d = this.walk.nodes[i].pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* The crossing a follower in the road is on. Its leader knows which one it
     used, but a follower that was still on the pavement when the leader
     finished has no record of it, so the nearest one is the answer — and it is
     the right one, because the leader's route went over it. */
  _nearestCrossing(pos) {
    let best = null, bd = Infinity;
    for (const c of this.crossings) {
      const d = c.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _crossingBetween(a, b) {
    for (const c of this.crossings) {
      if ((c.a === a && c.b === b) || (c.b === a && c.a === b)) return c;
    }
    return null;
  }

  /* Is it safe to step off the kerb? Only MOVING traffic counts: a car that
     has stopped for this very crossing must not be the reason nobody uses it,
     which is the deadlock every naive version of this has. */
  _clearToCross(c) {
    if (!c) return true;
    for (const v of this.vehicles) {
      if (v.speed < 0.4) continue;
      if (v.pos.distanceTo(c.pos) < CROSS_CLEAR) return false;
    }
    return true;
  }

  /* Nobody walks through anybody, and the number that says so is measured.

     Three things changed here in the errands pass, all of them about the ONE
     place the old version visibly failed — a junction, where four streams of
     people meet:

     - It runs AFTER the movement, not before, so the positions it fixes are
       the positions the frame draws. Fixing them first and then walking
       everybody a centimetre into each other is why the old probe could read
       zero and the screenshot still show two people sharing a coat.
     - It resolves the overlap COMPLETELY rather than by a fraction of dt, and
       it does two relaxation passes, because one pass cannot settle a knot of
       three.
     - It is asymmetric, by id. Two people who each give way by half do the
       pavement dance; the one with the lower id holds its line and the other
       goes round, which is a priority rule and not a physics one, and it is
       what actually unpicks a four-way crowd.

     Only a SITTER is immovable now, and that changed for the gate. The old
     rule — paused people push but are not pushed — left two people who had
     stopped at the same front door standing inside each other for as long as
     they stood there, which on this street was forty of the hundred and twenty
     and no relaxation pass could ever clear it. Somebody standing at a door
     shuffling thirty centimetres to make room is what a person does; a bench
     is still a fixed place, and no two sitters can overlap because no two of
     them share a seat.

     O(n^2) over 300 people is 45,000 pair tests a frame, the same order as the
     flock's, and measured at well under a millisecond. */
  _separate(dt) {
    const R = SEPARATION, people = this._people || (this._people = []);
    people.length = 0;
    for (const a of this.actors) if (a.kind === 'person') people.push(a);
    for (let i = 0; i < people.length; i++) people[i].sepIndex = i;

    /* Half the space one person wants, on its own speed. Somebody at a shop
       window is a narrower obstacle than somebody at full stride, and the two
       halves add up to the pair's radius — which is at least SEPARATION, the
       flat number the gate is measured against, and a little more when both
       are moving. That margin is what leaves the fixed point room to survive
       the corridor and obstacle projections running in the same loop. */
    const halfR = a => (R * 0.5) *
      (1 + SEP_SPEED * (a.state === 'walk' || a.state === 'cross'
        ? Math.min(1, a.speed / 1.6) : 0));

    /* Resolve one pair, in place. */
    const fix = (a, b) => {
      /* A body the accident has knocked into the road is immovable here: the
         crash owns its position, and separation dragging it back onto the
         pavement is the same defect the kerb clamp had. */
      const amove = a.state !== 'sit' && !a.crash, bmove = b.state !== 'sit' && !b.crash;
      if (!amove && !bmove) return;
      const RR = halfR(a) + halfR(b);
      let dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      let d2 = dx * dx + dz * dz;
      if (d2 > RR * RR) return;
      /* Exactly on top of each other — two people who walked into the same
         doorway. There is no direction to push along, so one is invented from
         the id and it is the SAME one every frame, which is what stops the two
         of them vibrating. The vector has to be a MILLIMETRE long and not R
         long: at R the `over` below is exactly zero and neither of them moves
         at all, which is invisible on screen because two people in one coat
         look like one person. */
      if (d2 < 1e-6) {
        const t = (a.id * 2.399963) % TAU;
        dx = Math.cos(t) * 1e-3; dz = Math.sin(t) * 1e-3; d2 = 1e-6;
      }
      const d = Math.sqrt(d2);
      const over = (RR - d) / d;
      /* Priority: the lower id holds its line. Both moving, it is 0.2 / 0.8 and
         not 0.5 / 0.5 — a rule rather than a physics, so a pair resolves in one
         direction instead of negotiating, which is the pavement dance. */
      const share = !amove ? 0 : !bmove ? 1 : (a.id < b.id ? 0.2 : 0.8);
      if (amove) { a.pos.x += dx * over * share; a.pos.z += dz * over * share; }
      if (bmove) { b.pos.x -= dx * over * (1 - share); b.pos.z -= dz * over * (1 - share); }
    };

    /* A uniform grid one personal space wide, rebuilt before every sweep.
       Nothing further apart than R can matter, so nothing outside the nine
       cells around a person needs to be looked at, and the sweep goes from
       45,000 pair tests at the stress counts to about 2,000. That is not an
       optimisation for its own sake: the loop below runs the sweep up to
       twenty times on a bad frame, and twenty O(n^2) sweeps of three hundred
       people is most of a frame's budget on this machine. */
    const cells = this._sepCells || (this._sepCells = new Map());
    /* The cell is the LARGEST pair radius and not the flat one: with the
       speed-scaled radius a striding pair wants 1.01 m, and a 0.90 m cell can
       put two of those in cells the 3x3 sweep never compares. */
    const CELL = R * (1 + SEP_SPEED);
    const bucket = () => {
      cells.clear();
      for (const a of people) {
        const k = Math.floor(a.pos.x / CELL) * 100003 + Math.floor(a.pos.z / CELL);
        let b = cells.get(k);
        if (!b) { b = []; cells.set(k, b); }
        b.push(a);
      }
    };
    /* Every pair inside the grid's reach, once each — `sepIndex` is what keeps
       a pair from being visited nine times, and from being visited at all in
       the wrong order. */
    const sweep = cb => {
      for (let i = 0; i < people.length; i++) {
        const a = people[i];
        const ix = Math.floor(a.pos.x / CELL), iz = Math.floor(a.pos.z / CELL);
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const b = cells.get((ix + ox) * 100003 + iz + oz);
            if (!b) continue;
            for (const o of b) if (o.sepIndex > i) cb(a, o);
          }
        }
      }
    };

    /* Six relaxation sweeps. Resolving a pair can push one of the two into a
       third person the sweep has already walked past, so a knot of three needs
       more than one sweep — and a zebra crossing, where four streams of people
       meet, is exactly where the knots are. */
    for (let pass = 0; pass < 6; pass++) { bucket(); sweep(fix); }

    /* Then: count what is STILL overlapping, fix exactly that, and look again,
       until it comes back zero. The sweeps above are Gauss-Seidel — fixing
       (i, k) can push i into a j already passed, and that j is never revisited
       — so they converge fast and do not finish. This loop is what finishes.

       A MILLIMETRE inside the radius, and that tolerance is load-bearing: fix()
       resolves a pair to exactly R and in floating point exactly R comes back
       as 0.59993, so counted against R itself the loop re-fixed the same pair
       every round, gave up, and reported a pair a second forever. Two people
       59.99 cm apart are not standing in each other. */
    const tight = (R - 1e-3) * (R - 1e-3);
    const bad = this._sepBad || (this._sepBad = []);
    const measure = () => {
      bucket();
      let n = 0;
      bad.length = 0;
      sweep((a, b) => {
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz < tight) { n++; bad.push(a, b); }
      });
      return n;
    };
    /* THE CONSTRAINT LOOP. Two projections alternate here — `_holdToPavement`,
       which puts everybody back inside their corridor and outside every
       railing, hedge, bench and vehicle, and `fix`, which pushes overlapping
       pairs apart — and the loop runs until neither of them moves anybody.

       The order inside a round is projection first, measurement second, fix
       third, and that order is the whole point: whatever the round ENDS on is
       re-projected and re-measured at the top of the next one, so the numbers
       both gates read are taken on positions that have already been through
       every constraint. The old code ran the clamp once, after the whole
       solver, and reported a separation figure for positions it then moved. */
    let pairs = 0, guard, moved = 0, zeroRounds = 0;
    for (guard = 0; guard < SEP_ROUNDS; guard++) {
      moved = this._holdToPavement();
      pairs = measure();
      if (!pairs && !moved) break;
      /* How many rounds the worst frame needed — the guard is there so a pair
         that CANNOT be separated (two sitters a hand's breadth apart, if a host
         ever placed two benches that way) cannot spin here. */
      this.overlap.rounds = Math.max(this.overlap.rounds || 0, guard + 1);
      if (!pairs) {
        /* Separation is clean. Settle a few more projection rounds for
           penetration and then stop — see SETTLE_ROUNDS. */
        if (++zeroRounds >= SETTLE_ROUNDS) break;
        continue;
      }
      zeroRounds = 0;                             // a fresh overlap resets the settle count
      /* Two full relaxation sweeps, and not a targeted fix of the pairs the
         measurement just listed. Fixing only the listed pairs resolves each of
         them into a THIRD person the list did not have, and the round budget
         then goes on chasing the knot round the crowd; a sweep resolves the
         whole neighbourhood at once and is what the six passes above are. The
         projection at the top of the next round is what puts everybody the
         sweeps moved back inside the pavement, so the measurement is still
         taken on constrained positions. */
      bucket(); sweep(fix);
      bucket(); sweep(fix);
    }
    /* The guard can end the loop right after a fix() round it never re-checked
       — the last round finds a pair, resolves it, and then the loop exits on
       the count, not on the fix. That is what E6 was reading: `now` 0 at any
       instant sampled because the pair WAS resolved, but a non-zero rate
       because this function reported the round before the fix as if it were
       the round after it. One more projection and one more measurement, next
       to nothing beside the rounds it might have just run, reports the position
       actually drawn — and the projection has to be in it or the penetration
       probe would read a body inside a car that separation had just pushed
       there. */
    /* Two readings, and the difference between them is the whole story of this
       gate. `solved` is what the pairwise solver achieved — the number the
       build before this pass reported, because it ran the kerb clamp AFTER the
       solver and read the solver's positions. `pairs` is the same count taken
       after the clamp, obstacle and vehicle projections have had the last word,
       which is what the frame actually DRAWS. Reporting only the first is how
       "14.4 pairs a second" was recorded for a street that drew more than that:
       the clamp then moved people and nothing looked again. Both are reported
       here so the two builds can be compared on the same criterion. */
    let solved = pairs;
    if (guard === SEP_ROUNDS) {
      solved = measure();
      /* The last word goes to the SOLIDS and not to the corridor. The corridor
         is a steering constraint — being fifteen centimetres off your line is
         not a defect anybody can see — while a body inside a hedge or a car is
         exactly the defect this pass exists to remove, and only the second kind
         is measured. So the round budget ends with one full projection, one
         more sweep, and then the solid projection alone: the sweep gets the
         last say on separation, and the pushes that follow it touch only the
         handful of people who are actually against something. Ending on the
         full projection instead put a pair a frame back on the street. */
      this._holdToPavement();
      /* ONE alternation, and that is a measured trade and not a default.
         Three of them take the drawn separation figure from 16.2 to 12.3 pairs
         a second and the penetration rate the other way, from 0.32/s at 2 mm —
         a float boundary — to 0.92/s at 253 mm, which is a person a quarter of
         a metre inside a car. Report A is the defect Beri filmed and the one
         that must read zero; the separation figure at three hundred people is
         a FAIL either way. So the solids win the tie. */
      bucket(); sweep(fix); this._projectSolids();
      pairs = measure();
    }
    this._countPenetrations(dt);

    const o = this.overlap;
    o.solvedPairs = solved;
    o.solvedSum = (o.solvedSum || 0) + solved;
    o.pairs = pairs;
    if (pairs > o.peak) o.peak = pairs;
    o.sum += pairs;
    o.frames++;
    o.time += dt;
  }

  /* The hard half of `_holdToPavement`, on its own: out of the carriageway,
     out of every static obstacle, out of every vehicle box. No corridor and no
     lane offset — see the constraint loop for why the two halves are separable.
     `_onRoad` is NOT rebuilt here: the drivers read the list the full pass
     built a moment ago, and rebuilding it from a pass that has already pushed
     everybody off the road would hand them an empty one. */
  _projectSolids() {
    for (const a of this.actors) {
      if (a.kind !== 'person' || a.crash) continue;
      if (a.state !== 'cross' && this._onCarriageway(a.pos)) this._pushOffCarriageway(a.pos);
      for (let r = 0; r < 4; r++) {
        const so = this._pushOutOfObstacles(a.pos);
        const sv = this._pushOutOfVehicles(a.pos);
        if (!so && !sv) break;
      }
      a.pos.y = this.getHeight(a.pos.x, a.pos.z);
    }
  }

  /* The penetration gate, and it is deliberately a SEPARATE reading from the
     projection that prevents it: the projection runs on `a.pos`, and this
     measures `a.pos` again afterwards with the same map, so a bug in the push
     shows up here as a number instead of hiding behind the code that caused it.

     The accident's victim is exempt and is the only exemption. It is knocked
     into the road by a car on purpose — it is supposed to be inside a vehicle
     box for the frame of the impact, and a gate that counted that would be a
     gate against the feature. */
  _countPenetrations(dt) {
    let n = 0, worst = 0;
    for (const a of this.actors) {
      if (a.kind !== 'person' || a.crash) continue;
      const s = this.obstacleClearance(a.pos.x, a.pos.z) - PED_R;
      const v = this.vehicleClearance(a.pos.x, a.pos.z);
      const d = Math.min(s, v);
      if (d < -1e-3) { n++; if (-d > worst) worst = -d; }
    }
    const p = this.penetration;
    p.now = n;
    if (n > p.peak) p.peak = n;
    if (worst > p.worst) p.worst = worst;
    p.sum += n;
    p.frames++;
    p.time += dt;
  }

  /* ---- herds -----------------------------------------------------------
     Graze, then pick somewhere else in the field and amble to it. A cow that
     grazes without ever moving is a statue with a chewing animation. */
  _stepGrazers(dt) {
    for (const a of this.actors) {
      if (a.kind !== 'grazer') continue;
      a.clock += dt;
      a.hold -= dt;
      /* After dark a herd lies down. It is the one thing that makes a field at
         night read as a field rather than as the day's field with the lights
         off, and it costs nothing: the animal stops moving, drops onto its
         belly and plays the pack's head-down idle. */
      if (this.night > 0.5) {
        if (a.state !== 'lie') { a.state = 'lie'; a.goal = null; }
        a.pos.y = this.getHeight(a.pos.x, a.pos.z);
        continue;
      }
      if (a.state === 'lie') { a.state = 'graze'; a.hold = 2 + this.rand() * 8; }
      if (a.state === 'graze' || a.state === 'idle') {
        if (a.hold <= 0) {
          const f = a.field;
          for (let t = 0; t < 24; t++) {
            const x = a.pos.x + (this.rand() - 0.5) * 26;
            const z = a.pos.z + (this.rand() - 0.5) * 26;
            if (inPolygon(f.poly, x, z)) { a.goal = new THREE.Vector3(x, 0, z); break; }
          }
          a.state = 'walk';
          a.hold = 4 + this.rand() * 8;
        }
        continue;
      }
      if (!a.goal) { a.state = 'graze'; a.hold = 6 + this.rand() * 14; continue; }
      this._tmp.subVectors(a.goal, a.pos); this._tmp.y = 0;
      const d = this._tmp.length();
      if (d < 0.6 || a.hold <= 0) {
        a.goal = null;
        a.state = this.rand() < 0.75 ? 'graze' : 'idle';
        a.hold = 6 + this.rand() * 16;
        continue;
      }
      a.pos.addScaledVector(this._tmp.divideScalar(d), Math.min(d, a.speed * dt));
      a.pos.y = this.getHeight(a.pos.x, a.pos.z);
      a.yaw += angleTo(a.yaw, Math.atan2(this._tmp.x, this._tmp.z)) * Math.min(1, dt * 3);
    }
  }

  /* ---- robots ---------------------------------------------------------- */
  _stepRobots(dt) {
    for (const a of this.actors) {
      if (a.kind !== 'robot') continue;
      a.clock += dt;
      /* An agent that has been hit is not having a day. The accident owns its
         position and its lean until the street is cleared. */
      if (a.crash) {
        this._stepVictim(a, dt);
        a.lean = a.crash.lean;
        a.state = 'idle';
        if (a.tag) a.tag.position.set(a.pos.x, a.pos.y + 2.95, a.pos.z);
        continue;
      }
      a.bob += dt * 2.4;
      const ground = this.getHeight(a.pos.x, a.pos.z);
      if (a.goal) {
        this._tmp.subVectors(a.goal, a.pos); this._tmp.y = 0;
        const d = this._tmp.length();
        if (d > 1.2) {
          a.pos.addScaledVector(this._tmp.divideScalar(d), Math.min(d, a.speed * dt));
          a.yaw += angleTo(a.yaw, Math.atan2(this._tmp.x, this._tmp.z)) * Math.min(1, dt * 5);
          a.state = 'walk';
        } else {
          a.state = 'idle';
        }
      } else {
        a.state = 'idle';
      }
      /* The bob: 3.5 cm on a slow sine, and no lift under it. The Hunyuan
         robot runs on two wheels, and a wheeled machine floating six
         centimetres over the tarmac is the one thing about it that would read
         as a bug — so what was a hover is now suspension travel.
         The lean is the same motion read sideways: a couple of degrees of nose
         down while it is driving, which is what a two-wheeler does. */
      a.pos.y = ground + Math.sin(a.bob) * 0.035;
      const wantLean = a.state === 'walk' ? -0.09 : 0;
      a.lean += (wantLean - a.lean) * Math.min(1, dt * 3);
      if (a.tag) {
        a.tag.position.set(a.pos.x, a.pos.y + 2.95, a.pos.z);
      }
    }
  }

  /* ---- traffic ---------------------------------------------------------
     One pass per lane: sort by arc length, then every car looks at exactly one
     thing ahead of it — the car in front, or the next junction. */
  _stepVehicles(dt) {
    for (const lane of this.lanes) lane.cars.length = 0;
    for (const v of this.vehicles) v.lane.cars.push(v);
    for (const lane of this.lanes) lane.cars.sort((a, b) => a.s - b.s);

    for (const lane of this.lanes) {
      for (let i = 0; i < lane.cars.length; i++) {
        const v = lane.cars[i];
        let ahead = lane.cars[i + 1];
        let free = ahead ? ahead.s - v.s : Infinity;
        /* The lane is a loop: the last car's leader is the first one, a lap
           further on. Without this the head of every queue accelerates away
           into an empty road that is actually full behind it. `ahead` is set
           to that leader too and not left null — the stopping distance below is
           computed from the leader's own length, and a null one would let the
           last car in the lane close on the first with no distance at all. */
        if (!ahead && lane.cars.length > 1) {
          ahead = lane.cars[0];
          free = lane.length - v.s + ahead.s;
        }

        /* Follow the car in front. `free` is centre to centre along the lane,
           so the distance at which this driver is stopped dead is the larger of
           two things:

           - the brief's rule, own length plus CAR_CLEAR; and
           - what it takes not to be INSIDE the vehicle ahead, which is the two
             half-lengths plus CAR_CLEAR. A car behind a bus needs 1.25 + 4.58 +
             1.5 = 7.3 m, and the brief's rule alone would have given it 4.0.

           Taking the larger satisfies both: the gap is never less than own
           length + 1.5 m, and two bounding boxes never meet. `want` adds
           CAR_HEADWAY seconds of road on top, which is the speed-dependent
           half. The linear ramp between the two is unchanged, and so is the
           reason it has a floor: without one a queue compresses to a metre and
           can never recover, because the target speed there is zero for
           everybody at once. */
        const stop = ahead
          ? Math.max(v.len + CAR_CLEAR, v.half + ahead.half + CAR_CLEAR)
          : 0;
        const want = stop + v.speed * CAR_HEADWAY;
        let target = v.want * clamp((free - stop) / Math.max(0.5, want - stop), 0, 1);

        /* Junctions, as a SIGNAL rather than as a lock. Two earlier versions
           gave the junction to whichever car claimed it first and both
           deadlocked within fifteen seconds, because the holder of the lock
           can be stopped for a reason that has nothing to do with the junction
           — the car in front of it — and then nobody can ever take it. A
           signal cannot deadlock: it is a function of the clock, so the light
           goes green whether or not anything moved. Each road that meets here
           gets GREEN seconds in turn.

           Only a car APPROACHING the line stops. Without the `gap >= 0.5` the
           car that has just cleared the junction stops on the far side of it,
           which walls the crossing in and jams the queue behind it. */
        /* The indicator goes on well before the line — twenty-five metres, so
           it is lit for two or three seconds at town speed — and stays on
           until the turn is taken. `turn` is decided ONCE per approach and
           remembered, or the lamp would flicker between sides as the car
           closed on the junction. */
        /* Yield at a zebra. Only to somebody who is ON it or standing at the
           kerb of it, and only from far enough out to stop: inside
           CROSS_COMMIT the car is going through, which is what keeps this from
           deadlocking against a pedestrian who is waiting for it. */
        /* The STOP LINE, which is a real thing on a road and was missing: the
           target used to reach zero at CROSS_COMMIT, five metres from the
           middle of the zebra, so a nine-metre bus came to rest with its front
           half standing on the crossing. It now reaches zero when this
           vehicle's own NOSE is CROSS_STOPLINE short of the zebra's near edge,
           which is where the painted line is. */
        for (const zb of lane.zebras || []) {
          const gap = zb.s - v.s;
          if (gap < CROSS_COMMIT || gap > CROSS_YIELD) continue;
          if (!(zb.c.occupied || zb.c.waiting)) continue;
          const line = v.half + ZEBRA_HALF + CROSS_STOPLINE;
          target = Math.min(target, Math.max(0, (gap - line) * 1.6));
        }

        /* And somebody in the road who is NOT on a crossing. A jaywalker gets
           braked for exactly the same way — that is what a driver does — and it
           is also the mechanism the accident runs through, so the two cannot
           drift apart. `_onRoad` is built once a frame by _holdToPavement() and
           holds only the handful of people who are genuinely on the
           carriageway, so this loop is a few tests per car and not a search. */
        for (const a of this._onRoad || []) {
          const rx = a.pos.x - v.pos.x, rz = a.pos.z - v.pos.z;
          const ahead2 = rx * v.head.x + rz * v.head.z;      // metres in front
          if (ahead2 <= 0 || ahead2 > CROSS_YIELD + v.half) continue;
          const side = Math.abs(rx * v.head.z - rz * v.head.x);
          if (side > LANE_HALF) continue;                    // in the next lane, not this one
          const line = v.half + JAY_CLEAR;
          /* `crash` overrides it: the staged collision is a driver who brakes
             LATE, and a driver who braked in time would have no accident. */
          if (v.crash && v.crash.stage === 'approach') continue;
          target = Math.min(target, Math.max(0, (ahead2 - line) * 1.6));
        }

        v.blink = 0;
        for (const st of lane.stops) {
          const gap = st.s - v.s;
          if (gap < 0.5) { if (v.approach === st.j) v.approach = null; continue; }
          if (gap > 25) continue;
          const j = st.j;
          if (v.approach !== j) { v.approach = j; v.turn = this._chooseTurn(v, lane, j); }
          if (v.turn) v.blink = v.turn;
          if (gap <= JUNCTION_READ) {
            const cycle = this.time / GREEN;
            const green = j.roads[Math.floor(cycle) % j.roads.length];
            /* Where this vehicle's own NOSE has to come to rest: clear of the
               carriageway it is crossing, and therefore a function of its own
               half-length rather than one number for a bus and a bicycle. */
            const line = v.half + JUNCTION_BOX;
            /* Do not block the box. A driver who can see that the far side is
               full waits at the line, and this is the other half of why cars
               ended up standing in the middle of the crossroads: the amber rule
               below lets anybody already past the line drive on, which is right
               — unless what is stopping it is the queue in front, in which case
               it drives in and stops there. `free` is the distance to the
               vehicle ahead and `stop` is the space this one needs behind it,
               both already computed for the car-following rule above. */
            if (gap > line && ahead && free < gap + JUNCTION_BOX + stop) {
              target = Math.min(target, Math.max(0, (gap - line) * 1.6));
              break;
            }
            /* AMBER, and it is not decoration. Without it a signal flips from
               green to red under a van that is already three metres from the
               junction: `target` drops to zero and it parks with its nose in
               the box, which is a stationary vehicle in the middle of the
               crossing road for the whole of the next green — 114 frames of
               600 in the overlap probe, and the visible "vans stacked at the
               crossroads" in Beri's recording. A real junction solves this by
               clearing itself before the other road moves, and so does this
               one: for the last AMBER seconds of a road's green, anybody who
               can still stop at the line does, and anybody already past it
               goes through. */
            const amber = (cycle % 1) * GREEN > GREEN - AMBER;
            if (green !== lane.road || amber) {
              if (gap > line) {
                target = Math.min(target, Math.max(0, (gap - line) * 1.6));
                break;
              }
            }
            /* Green and inside the box: take the turn. Moving a car between
               lanes is the whole of "turning" here — the lanes already carry
               the geometry, so the car picks up the new one at the arc length
               that junction sits at and drives on. */
            if (v.turn && gap < 2.5) { this._takeTurn(v, st); break; }
          }
        }

        /* Asymmetric response: brake harder than you accelerate, which is both
           true of cars and what keeps a queue from oscillating. */
        const rate = target < v.speed ? 9 : 3.2;
        const was = v.speed;
        v.speed += clamp(target - v.speed, -rate * dt, rate * dt);
        /* How hard, in m/s². The body pitch and the brake lights are both read
           off this one number so they can never disagree, and it is smoothed
           because a per-frame delta at 60 Hz is noise, not a nose dive. */
        const g = dt > 0 ? (was - v.speed) / dt : 0;
        v.decel += (Math.max(0, g) - v.decel) * Math.min(1, dt * 8);
        /* The nose dive follows it, one step behind, because a suspension does
           too. 0.035 rad at a 3 m/s² stop is two degrees, which is what a town
           stop looks like from the pavement. */
        v.pitch += (clamp(v.decel / 3, 0, 1) * 0.035 - v.pitch) * Math.min(1, dt * 10);

        /* `v.lane` and not `lane`: the turn above may have just moved this car
           onto the crossing road, and advancing it along the lane it has left
           would put it back in the middle of the junction it came from. */
        const on = v.lane;
        /* `v.s` is HELD for the whole of a turn, at the arc length the car is
           arriving at. The distance it covers through the junction is the arc's
           own, not the lane's, and advancing both meant the arc ended at a
           point the lane had already moved past — a jump of a couple of metres
           on the last frame of every turn, which the finite-difference heading
           probe caught at 16°. Holding it also reserves the slot: everything
           behind it on the lane it is joining queues for a car that is visibly
           on its way in. */
        if (!v.arc) v.s = (v.s + v.speed * dt) % on.length;
        if (v.arc) this._stepArc(v, dt);
        else {
          on.at(v.s, v.pos, v.head);
          v.pos.y = this.getHeight(v.pos.x, v.pos.z);
          v.yaw = Math.atan2(v.head.x, v.head.z);
        }
      }
    }
    this._stepAccident(dt);
  }

  /* The turn, as a curve rather than as a jump.

     A car used to change lanes at a junction by having `v.lane` and `v.s`
     reassigned, which moved it several metres sideways between two frames and
     spun its yaw through ninety degrees in one. On screen that is a vehicle
     teleporting across a crossroads, and it is the second half of what Beri's
     recording shows at the junction.

     It is now a cubic bezier from where the car is, along the heading it has,
     to where it joins the new lane, along the heading THAT has. A cubic and
     not a quadratic because a quadratic can only be tangent to one of the two:
     with a control point pulled out along each end's own heading, the curve
     leaves the old lane pointing down it and arrives on the new one pointing
     down that, which is what makes both joins invisible.

     `v.s` is set to the arrival arc length at COMMIT and keeps advancing, so
     the car queues on the lane it is joining for the whole of the turn — a car
     that only appeared on the new lane when it got there would materialise
     inside whatever had driven into the space meanwhile. */
  _stepArc(v, dt) {
    const a = v.arc;
    a.t += dt / a.dur;
    if (a.t >= 1) {
      v.arc = null;
      v.lane.at(v.s, v.pos, v.head);
      v.pos.y = this.getHeight(v.pos.x, v.pos.z);
      v.yaw = Math.atan2(v.head.x, v.head.z);
      return;
    }
    const t = a.t, u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    v.pos.set(b0 * a.p0.x + b1 * a.p1.x + b2 * a.p2.x + b3 * a.p3.x, 0,
              b0 * a.p0.z + b1 * a.p1.z + b2 * a.p2.z + b3 * a.p3.z);
    v.pos.y = this.getHeight(v.pos.x, v.pos.z);
    /* The derivative of the same curve, which is the heading by definition —
       so "the vehicle faces along its path" is true here by construction and
       not by a separate rule that could drift out of step with the position. */
    const d0 = 3 * u * u, d1 = 6 * u * t, d2 = 3 * t * t;
    const hx = d0 * (a.p1.x - a.p0.x) + d1 * (a.p2.x - a.p1.x) + d2 * (a.p3.x - a.p2.x);
    const hz = d0 * (a.p1.z - a.p0.z) + d1 * (a.p2.z - a.p1.z) + d2 * (a.p3.z - a.p2.z);
    v.head.set(hx, 0, hz).normalize();
    v.yaw = Math.atan2(hx, hz);
  }

  /* Which way this car will leave the junction, decided once on approach.
     Returns -1 for a left turn, +1 for a right one and 0 for straight on. A
     lane can only be turned INTO if it actually passes this junction, which is
     what `lane.stops` already records — so the choice is made from the lanes
     that meet here rather than from the roads, and a car can never be handed a
     lane it would have to teleport to reach. */
  _chooseTurn(v, lane, j) {
    if (this.rand() > TURN_RATE) return 0;
    /* And only into a road this vehicle is allowed on. `_deckFor()` keeps a
       bus off a one-lane hamlet road and a tractor off the town's main street
       at SPAWN time, and a turn was the hole in that: the tractor life.html
       puts on its field road turned left at the crossroads and drove down the
       shopfronts, which is exactly the tractor in Beri's 2026-09-07 recording,
       and it was also the last standing pair in the overlap probe. The rule
       that decides where a vehicle may start is the rule that decides where it
       may go. */
    const outs = this._exits(lane, j)
      .filter(o => this._deckFor(o.lane.road).includes(v.type));
    if (!outs.length) return 0;
    const pick = outs[Math.floor(this.rand() * outs.length)];
    v.turnTo = pick;
    /* The sign of the cross product of the two headings says which way the
       wheel goes, and therefore which lamp blinks. */
    const cross = lane.head.x * pick.lane.head.z - lane.head.z * pick.lane.head.x;
    return cross > 0 ? -1 : 1;
  }

  _exits(lane, j) {
    const out = [];
    for (const other of this.lanes) {
      if (other === lane || other.road === lane.road) continue;
      for (const st of other.stops) if (st.j === j) out.push({ lane: other, s: st.s });
    }
    return out;
  }

  _takeTurn(v, st) {
    const to = v.turnTo;
    if (!to) { v.turn = 0; v.blink = 0; v.approach = null; return; }

    /* Land a little PAST the junction on the new lane, so the car does not
       immediately re-test the same stop from the wrong side and stall in it. */
    const s2 = (to.s + 4 + v.half) % to.lane.length;
    const p3 = to.lane.at(s2, new THREE.Vector3(), _turnHead);
    const h3 = _turnHead.clone();

    /* Is the space it would arrive in actually free? The old version reassigned
       the lane unconditionally, which is how a car appeared inside a bus that
       happened to be passing the junction — a real pair in the 600-frame
       baseline. A driver who cannot see a gap waits at the line instead, which
       is what the junction signal already makes it do. */
    for (const o of to.lane.cars) {
      if (o === v) continue;
      let d = Math.abs(o.s - s2);
      d = Math.min(d, to.lane.length - d);            // the lane is a loop
      if (d < v.half + o.half + CAR_CLEAR) return;    // not this green; try again
    }

    v.turn = 0; v.blink = 0; v.approach = null; v.turnTo = null;

    /* The curve. Control points pulled out along each end's own heading by a
       little under half the straight-line distance, which is the standard
       tangent-continuous corner: less and the car cuts the apex, more and it
       swings wide through the far kerb. */
    const span = Math.hypot(p3.x - v.pos.x, p3.z - v.pos.z);
    const pull = span * 0.42;
    v.arc = {
      t: 0,
      /* At the speed it is doing, floored so a car that crawled into the box
         still clears it rather than sitting on the curve forever. */
      dur: span / Math.max(3.5, v.speed),
      p0: v.pos.clone(),
      p1: new THREE.Vector3(v.pos.x + v.head.x * pull, 0, v.pos.z + v.head.z * pull),
      p2: new THREE.Vector3(p3.x - h3.x * pull, 0, p3.z - h3.z * pull),
      p3,
    };
    v.lane = to.lane;
    v.s = s2;
  }

  /* ---- birds -----------------------------------------------------------
     Reynolds' three rules against the flock's own neighbours, plus a pull back
     into the sky box, plus at night a dive for a perch. Neighbour search is
     O(n^2) over 200 birds, which is 40,000 distance checks a frame — measured
     at well under a millisecond and not worth a grid.
     ======================================================================= */
  _stepBirds(dt) {
    if (!this.flock || !this.flock.length) return;
    const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3();
    const roost = this.night > 0.4 && this.perches && this.perches.length;

    for (let i = 0; i < this.flock.length; i++) {
      const b = this.flock[i];

      if (roost) {
        if (!b.perch) b.perch = this.perches[(i * 7 + 3) % this.perches.length];
        this._tmp.subVectors(b.perch, b.pos);
        const d = this._tmp.length();
        if (d < 0.5) {
          b.landed = 1;
          b.vel.multiplyScalar(0.001);
          b.pos.copy(b.perch);
          /* Which way it ends up facing on the branch. Off its own phase, so
             a roof full of birds is not a row of clones and two screenshots of
             the same seed still match. */
          b.perchYaw = b.phase * TAU;
          continue;
        }
        b.landed = 0;
        b.vel.addScaledVector(this._tmp.divideScalar(d), 26 * dt);
      } else {
        b.perch = null;
        b.landed = 0;
        sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
        let n = 0;
        for (let k = 0; k < this.flock.length; k++) {
          if (k === i) continue;
          const o = this.flock[k];
          if (o.parrot !== b.parrot) continue;
          const d = b.pos.distanceTo(o.pos);
          if (d > 14) continue;
          if (d < 3.2) sep.add(this._tmp.subVectors(b.pos, o.pos).divideScalar(Math.max(0.3, d * d)));
          ali.add(o.vel);
          coh.add(o.pos);
          n++;
        }
        if (n) {
          ali.divideScalar(n).sub(b.vel);
          coh.divideScalar(n).sub(b.pos);
          b.vel.addScaledVector(sep, 34 * dt)
               .addScaledVector(ali, 0.9 * dt)
               .addScaledVector(coh, 0.55 * dt);
        }
        /* Pairs. A parrot's mate is worth more to it than the flock. */
        if (b.mate >= 0) {
          const m = this.flock[b.mate];
          this._tmp.subVectors(m.pos, b.pos);
          const d = this._tmp.length();
          if (d > 3.5) b.vel.addScaledVector(this._tmp.divideScalar(d), 12 * dt);
        }
        /* Walls of the sky box, as a force and not a clamp — a bird that hits
           an invisible wall and stops reads as a bug. */
        for (const axis of ['x', 'y', 'z']) {
          if (b.pos[axis] < this.sky.min[axis] + 6) b.vel[axis] += 30 * dt;
          if (b.pos[axis] > this.sky.max[axis] - 6) b.vel[axis] -= 30 * dt;
        }
        b.vel.y += (b.parrot ? 0.6 : 0.2) * Math.sin(this.time * 0.7 + b.phase * TAU) * dt * 10;
      }

      const sp = b.vel.length();
      const max = b.parrot ? 15 : 12;
      if (sp > max) b.vel.multiplyScalar(max / sp);
      if (sp < 4 && !b.landed) b.vel.multiplyScalar(4 / Math.max(0.2, sp));
      b.pos.addScaledVector(b.vel, dt);
    }
  }

  /* =======================================================================
     DRAWING — tier assignment, then one pass per family
     ======================================================================= */
  _draw(camera, dt) {
    const cam = camera.position;

    /* Tier assignment. Everything closer than NEAR is a candidate for a real
       skeleton; the MAX_SKINNED nearest of those win it. Partial selection by
       sort is fine at these counts and is the honest simple thing. */
    const near = [];
    for (const a of this.actors) {
      a.dist = a.pos.distanceTo(cam);
      /* Robots are rigid now and never enter the ladder — they are drawn from
         one InstancedMesh at every distance, like the traffic. Their distance
         is still measured, because the contact shadows read it. */
      if (a.kind === 'robot') { a.tier = -1; continue; }
      a.tier = a.dist < this.nearBand ? 0 : a.dist < FAR ? 1 : 2;
      if (a.tier === 0) near.push(a);
    }
    near.sort((x, y) => x.dist - y.dist);
    for (let i = this.maxSkinned; i < near.length; i++) near[i].tier = 1;
    this.nearestAnim = Math.min(near.length, this.maxSkinned);

    for (const c in this.crowds) this.crowds[c].beginFrame();

    for (let i = 0; i < near.length; i++) {
      const a = near[i];
      if (a.tier !== 0) break;
      const entry = this.models[a.model];
      const crowd = this.crowds[a.model];
      /* An actor whose model is not in the asset pack has no crowd — see
         _buildCrowds(). It keeps walking, it is just not drawn. */
      if (!crowd) continue;
      const slot = crowd.takeSkinned(a);
      const want = entry.spec.clips[this._clipSlot(a)] || entry.spec.clips.idle;
      if (slot.clipName !== want) {
        const clip = entry.clips[want];
        if (clip) {
          /* Cross-fade rather than cut. The quarter second is what turns
             "stopped walking" into "came to a stop", and it is the difference
             a person notices without being able to name it. */
          const next = slot.mixer.clipAction(clip);
          next.reset().fadeIn(0.25).play();
          if (slot.action) slot.action.fadeOut(0.25);
          slot.action = next;
          slot.clipName = want;
        }
      }
      slot.mixer.update(dt);
      slot.obj.position.copy(a.pos);
      slot.obj.rotation.y = a.yaw + entry.face;
      /* A pedestrian the accident has knocked over. `lean` is the same term the
         robot's own draw carries; on a skinned figure it is a pitch about the
         model's own X, which is what puts it over the bonnet and then flat on
         its back. Only this tier can do it — the vertex-animation texture and
         the sprite have no rotation to give — so a knocked pedestrian beyond
         the near band stands up again, and that is in Known limits rather than
         hidden. Written unconditionally so a figure that was leaning last frame
         and is not this one is put back upright. */
      slot.obj.rotation.x = a.crash ? a.crash.lean : 0;
      slot.obj.scale.setScalar(entry.baseScale * a.scale);
      /* The nearest twelve are the only ones that cast a shadow. A shadow map
         has to re-skin every caster, so this is the most expensive dozen
         objects in the frame and also the only ones close enough for a shadow
         to be read as contact rather than as a smudge. */
      slot.mesh.castShadow = i < this.shadowBudget;
    }
    for (const a of this.actors) {
      if (a.tier <= 0) continue;
      const crowd = this.crowds[a.model];
      if (!crowd) continue;
      const entry = this.models[a.model];
      if (a.tier === 1) crowd.pushVat(this._vatSlot(a), a.pos, a.yaw + entry.face, a.phase, a.scale, a.pal);
      else crowd.pushSprite(a.pos, camera, entry.height * a.scale);
    }
    for (const c in this.crowds) {
      this.crowds[c].advance(this.time);
      this.crowds[c].endFrame();
    }

    this._camPos = cam;
    this._beginRigid();
    this._drawVehicles();
    this._drawProps();
    this._drawRobots();
    this._drawBirds();
    this._endRigid();
    this._drawBlobs(near);
  }

  /* Robots and their drones. Both are rigid, both go into the same instanced
     pass, and the drone only exists for a robot that has an agent — a drone
     over an idle machine would be claiming a job that is not running. */
  _drawRobots() {
    if (!this.vehicleMeshes.robot) return;
    for (const a of this.actors) {
      if (a.kind !== 'robot') continue;
      _euler.set(a.lean, a.yaw + this.models.robot.face, 0, 'YXZ');
      this._q.setFromEuler(_euler);
      this._push('robot', a.pos, this._q);
      if (!a.agent) continue;
      /* Its drone, station-keeping above it. Only a robot that HAS an agent
         gets one: a drone over an idle machine would be claiming a job that is
         not running. */
      this._tmp.set(a.pos.x, a.pos.y + 2.35 + Math.sin(a.bob * 0.7 + a.phase * TAU) * 0.09, a.pos.z);
      _euler.set(a.state === 'walk' ? -0.16 : 0, a.yaw, 0, 'YXZ');
      this._q.setFromEuler(_euler);
      this._push('drone', this._tmp, this._q);
    }
  }

  /* Contact shadows for everything the real shadow map cannot afford. A soft
     dark disc on the ground under each actor is not a shadow — it does not
     know where the sun is — but the thing a missing shadow costs is CONTACT,
     the sense that a figure is standing on the pavement rather than hovering a
     few centimetres over it, and a blob buys that back for one draw call.
     `near` is the list the shadow budget was taken from, so the twelve that
     already cast a real shadow are skipped and never wear both. */
  _drawBlobs(near) {
    const im = this.blobs;
    if (!im) return;
    const shadowed = new Set();
    for (let i = 0; i < Math.min(near.length, this.shadowBudget); i++) shadowed.add(near[i]);
    let k = 0;
    const cap = im.instanceMatrix.count;
    for (const a of this.actors) {
      /* Robots are drawn from an InstancedMesh that casts a real shadow, so
         they are the one family that would wear two. */
      if (k >= cap || a.kind === 'robot' || shadowed.has(a) || a.dist > BLOB_RANGE) continue;
      const e = this.models[a.model];
      const w = (a.kind === 'grazer' ? 1.5 : 0.62) * (e ? e.height : 1.6) * a.scale;
      /* A hand's breadth off the ground, or the disc z-fights the road. */
      this._tmp.set(a.pos.x, this.getHeight(a.pos.x, a.pos.z) + 0.02, a.pos.z);
      im.setMatrixAt(k, this._m.compose(this._tmp, BLOB_Q, _scale.set(w, w, 1)));
      k++;
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
  }

  /* Which clip a near actor should be playing. Kept in one place so the
     skinned tier and the baked tier can never disagree about what a state
     looks like. */
  _clipSlot(a) {
    if (a.kind === 'grazer') {
      if (a.state === 'lie') return 'lie';
      return a.state === 'walk' ? 'walk' : a.state === 'graze' ? 'graze' : 'idle';
    }
    if (a.state === 'sit') return 'sit';
    return a.state === 'walk' ? 'walk' : 'idle';
  }

  /* The far tier only has two clips baked, so everything that is not walking
     falls back to idle. */
  _vatSlot(a) {
    const s = this._clipSlot(a);
    return s === 'walk' ? 'walk' : 'idle';
  }

  /* One matrix per vehicle, written into the near mesh or the far one
     depending on how close it is. `_push` is shared with the robots and the
     perched birds, which are the same kind of object. */
  _push(type, pos, quat, s) {
    const im = this.vehicleMeshes[type];
    if (!im) return;
    const d = pos.distanceTo(this._camPos);
    const to = d < this._nearCut ? im : d < im.midBand ? im.mid : im.far;
    if (to.n >= to.instanceMatrix.count) return;
    to.setMatrixAt(to.n++, this._m.compose(pos, quat, s || this._s));
  }

  /* The rigid ladder's own budget. RIGID_NEAR is a distance, but a distance
     alone is not a budget: at the stress counts eighteen vehicles were inside
     twenty-two metres and the full-detail tier alone cost 1.8 M triangles a
     frame with the shadow pass. So the cut is the CLOSER of the band and the
     rigidBudget-th nearest thing, exactly the way maxSkinned caps the skinned
     tier. One partial sort of about a hundred distances a frame. */
  _beginRigid() {
    this._rigidTouched = this._rigidTouched || [];
    this._rigidTouched.length = 0;
    for (const type in this.vehicleMeshes) {
      const im = this.vehicleMeshes[type];
      im.n = 0; im.mid.n = 0; im.far.n = 0;
      this._rigidTouched.push(im, im.mid, im.far);
    }
    const d = this._rigidDist || (this._rigidDist = []);
    d.length = 0;
    for (const v of this.vehicles) d.push(v.pos.distanceTo(this._camPos));
    for (const v of this.parked) d.push(v.pos.distanceTo(this._camPos));
    /* Only the props ELIGIBLE for the raw tier queue for it. A hedge counted
       here would push the cut inside four metres and spend the whole budget on
       things that could never take it, which is what starved the traffic in
       the first measured round. The grazing animals do queue: they are the one
       static family you walk up to. Dogs never do. */
    for (const p of this.props) {
      const e = this.models[p.type];
      if (e && !e.noRaw) d.push(p.pos.distanceTo(this._camPos));
    }
    for (const a of this.actors) if (a.kind === 'robot') d.push(a.dist);
    d.sort((x, y) => x - y);
    this._nearCut = d.length > this.rigidBudget
      ? Math.min(RIGID_NEAR, d[this.rigidBudget]) : RIGID_NEAR;
  }

  _endRigid() {
    for (const im of this._rigidTouched) {
      im.count = im.n;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _drawVehicles() {
    for (const v of this.vehicles) {
      /* The nose dive. A braking car pitches forward on its springs, and it is
         the cue the eye reads before it reads the lamps. Small on purpose —
         0.035 rad is two degrees, which is what a town stop looks like; more
         and it reads as a stunt. Order YXZ so the pitch is about the vehicle's
         own lateral axis and not the world's. `askew` is the accident: a car
         that has hit somebody does not end up square to the lane. */
      this._q.setFromEuler(_euler.set(v.pitch, v.yaw + v.askew + this.models[v.type].face, 0, 'YXZ'));
      this._push(v.type, v.pos, this._q);
    }
    for (const v of this.parked) {
      this._q.setFromEuler(_euler.set(0, v.yaw + this.models[v.type].face, v.lean, 'YXZ'));
      this._push(v.type, v.pos, this._q);
    }
    this._drawLamps();
  }

  /* The statics. They never move, so the only thing this pass computes is the
     tier — and the tier is a function of the CAMERA, which does. Same ladder
     and same budget as the traffic, with two per-model settings on top of it:
     `noRaw` and `midBand`, both in the STATICS catalogue. */
  _drawProps() {
    for (const p of this.props) {
      this._q.setFromAxisAngle(UP, p.yaw + this.models[p.type].face);
      this._push(p.type, p.pos, this._q, p.scaleV);
    }
    /* A dog walks with its owner: the mesh is static, the position is the
       pedestrian's, offset to the walker's own right or left. A dog standing
       still while the street walks past it would be the one animal on the page
       that reads as furniture. */
    const dogFace = this.models['st.dog'] ? this.models['st.dog'].face : 0;
    for (const g of this.dogs) {
      const o = g.owner;
      this._tmp.set(o.pos.x + Math.cos(o.yaw) * g.side,
                    this.getHeight(o.pos.x, o.pos.z),
                    o.pos.z - Math.sin(o.yaw) * g.side);
      this._q.setFromAxisAngle(UP, o.yaw + dogFace);
      this._push('st.dog', this._tmp, this._q);
    }
  }

  /* Headlights and tail lights. Additive quads standing at the corners of the
     car, sized off the model's own bounding box, faded in with the night. */
  _drawLamps() {
    let k = 0;
    const cap = this.lamps.instanceMatrix.count;
    const lit = this.night >= 0.25;
    const white = _colA.setHex(0xfff0c8).multiplyScalar(this.night);
    /* Tail lights at full night rather than 0.8 of it. They are the only
       thing visible on traffic driving AWAY down the street, which is what
       the night shot is looking at, and at 0.8 with a 0.42 quad they did not
       read at all past thirty metres. */
    const red = _colB.setHex(0xff3a20).multiplyScalar(this.night);
    /* The indicator runs day and night, because it is a SIGNAL and not a lamp:
       an amber flash is how a driver reads a turn coming, and it is the only
       thing on the carriageway that says a junction is about to be used. Two
       flashes a second, which is what a real relay does. */
    const amberOn = Math.floor(this.time * 2) % 2 === 0;
    const amber = _colC.setHex(0xffa023);
    for (const v of this.vehicles) {
      const e = this.models[v.type];
      const half = e.halfLength;
      const wide = e.halfWidth * 0.62;
      const y = (e.bbox.max.y + e.bbox.min.y) * 0.45;
      if (lit) {
        for (const [side, front] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
          if (k >= cap) break;
          this._tmp.set(side * wide, y, front * half * 0.98)
            .applyAxisAngle(UP, v.yaw).add(v.pos);
          this._q.setFromAxisAngle(UP, v.yaw);
          const sz = front > 0 ? 0.85 : 0.60;
          this.lamps.setMatrixAt(k, this._m.compose(this._tmp, this._q, _scale.setScalar(sz)));
          this.lamps.setColorAt(k, front > 0 ? white : red);
          k++;
        }
      }
      /* BRAKE LIGHTS. Day and night, like the indicator and for the same
         reason: a brake light is a signal, not illumination, and the whole
         read of a car slowing for a crossing at two in the afternoon is the
         two red lamps coming on. Off the same `decel` the body pitch uses, so
         the lamps and the nose dive can never disagree. Full red at 3 m/s²,
         which is an ordinary town stop. */
      const brake = clamp(v.decel / 3, 0, 1);
      if (brake > 0.06 && k + 1 < cap) {
        for (const side of [-1, 1]) {
          this._tmp.set(side * wide, y, -half * 0.98)
            .applyAxisAngle(UP, v.yaw).add(v.pos);
          this._q.setFromAxisAngle(UP, v.yaw);
          this.lamps.setMatrixAt(k, this._m.compose(this._tmp, this._q, _scale.setScalar(0.7)));
          this.lamps.setColorAt(k, _colD.setHex(0xff2a10).multiplyScalar(0.35 + brake * 0.65));
          k++;
        }
      }
      /* Hazards: all four corners at once, which is the only thing on a road
         that means "this vehicle is not going anywhere". Set by the accident. */
      if (v.hazard && amberOn && k + 3 < cap) {
        for (const side of [-1, 1]) for (const front of [1, -1]) {
          this._tmp.set(side * wide, y, front * half * 0.92)
            .applyAxisAngle(UP, v.yaw).add(v.pos);
          this._q.setFromAxisAngle(UP, v.yaw);
          this.lamps.setMatrixAt(k, this._m.compose(this._tmp, this._q, _scale.setScalar(0.62)));
          this.lamps.setColorAt(k, amber);
          k++;
        }
      } else if (v.blink && amberOn && k + 1 < cap) {
        /* Both corners on the turning side, front and rear, which is what an
           indicator actually is. */
        for (const front of [1, -1]) {
          this._tmp.set(v.blink * wide, y, front * half * 0.92)
            .applyAxisAngle(UP, v.yaw).add(v.pos);
          this._q.setFromAxisAngle(UP, v.yaw);
          this.lamps.setMatrixAt(k, this._m.compose(this._tmp, this._q, _scale.setScalar(0.55)));
          this.lamps.setColorAt(k, amber);
          k++;
        }
      }
    }
    k = this._drawAmbulanceLamps(k, cap);
    this.lamps.count = k;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  _drawBirds() {
    if (!this.birds || !this.flock) return;
    const plain = BIRD_PLAIN, parrotA = PARROT_A, parrotB = PARROT_B;
    /* A parrot that has landed stops being six triangles and becomes the real
       model. In the air it stays procedural: nothing CC0 or generated here is
       rigged to flap, and a static bird flying is worse than a stylised one. */
    const perchIm = this.vehicleMeshes.parrot;
    const perchEntry = this.models.parrot;
    let flying = 0;
    for (let i = 0; i < this.flock.length; i++) {
      const b = this.flock[i];
      if (b.parrot && b.landed && perchIm) {
        /* Its feet, not its bounding box: the tail hangs below the toes, so
           seating it by the box alone leaves it floating over the branch. */
        this._tmp.set(b.pos.x, b.pos.y - perchEntry.height * (perchEntry.spec.footY || 0), b.pos.z);
        this._q.setFromAxisAngle(UP, b.perchYaw);
        this._push('parrot', this._tmp, this._q);
        continue;
      }
      const yaw = Math.atan2(b.vel.x, b.vel.z);
      /* Bank into the turn: a bird that flies flat and changes direction reads
         as a paper dart. The roll is taken straight off the sideways component
         of this bird's own velocity. */
      const roll = clamp(-b.vel.x * 0.03 + b.vel.z * 0.0, -0.6, 0.6);
      const e = new THREE.Euler(b.landed ? 0 : clamp(-b.vel.y * 0.05, -0.5, 0.5), yaw, b.landed ? 0 : roll, 'YXZ');
      this._q.setFromEuler(e);
      const sc = b.parrot ? 0.95 : 0.75;
      this.birds.setMatrixAt(flying, this._m.compose(b.pos, this._q, _scale.setScalar(sc)));
      this.birds.setColorAt(flying, b.parrot ? (b.mate >= 0 ? parrotB : parrotA) : plain);
      flying++;
    }
    this.birds.count = flying;
    this.birds.instanceMatrix.needsUpdate = true;
    if (this.birds.instanceColor) this.birds.instanceColor.needsUpdate = true;
    for (const s of this.birds.material.userData.shaders) s.uniforms.uTime.value = this.time;
  }

  /* =======================================================================
     ACCIDENTS — one per real error, and never otherwise

     THE DATA RULE, which is the whole point of this section: an accident on
     this street is not decoration and is not random. It happens when, and only
     when, the host reports that something actually went wrong — a tool call
     that came back `is_error`, a test that failed, an agent that died. Nothing
     in here calls `this.rand()`; every choice is derived from the error event
     and from the geometry it lands on, so the same error reported twice stages
     the same collision twice, and a street with no errors in it never has a
     crash. That is the same rule the rest of this file lives by (a cow is a
     dormant project, a robot is a live agent) applied to the one event a
     viewer cannot mistake for scenery.

     The host wires it in one line — see docs/HANDOFF.md.
     ======================================================================= */

  /* `at` is where in the world the error happened — [x, y, z], a Vector3, or
     omitted. `label` is what to call it. Returns the accident record, or null
     with a reason on the record's `why`, because a caller that fires this on
     every failed tool call needs to know it was dropped rather than silently
     ignored.

     One at a time, on purpose. Two wrecks and two ambulances on one street
     stops reading as an incident and starts reading as a demolition derby, and
     the errors that arrive in bursts are exactly the ones that would do it. */
  reportError(ev = {}) {
    if (this.accident) return null;
    if (!this.lanes.length) return null;

    /* Where. A caller that gives no position still has to get the SAME street
       corner every time for the same error, so the label is hashed into an arc
       length rather than drawn from the generator. */
    let at = ev.at;
    if (Array.isArray(at)) at = new THREE.Vector3(at[0], at[1] || 0, at[2]);
    let lane = null, s0 = 0;
    if (at && at.x !== undefined) {
      let best = Infinity;
      for (const ln of this.lanes) {
        for (let i = 1; i < ln.pts.length; i++) {
          const p = ln.pts[i - 1], q = ln.pts[i];
          const ex = q.x - p.x, ez = q.z - p.z;
          const t = clamp(((at.x - p.x) * ex + (at.z - p.z) * ez) / (ex * ex + ez * ez || 1), 0, 1);
          const dx = at.x - (p.x + ex * t), dz = at.z - (p.z + ez * t);
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; lane = ln; s0 = ln.cum[i - 1] + t * (ln.cum[i] - ln.cum[i - 1]); }
        }
      }
    } else {
      const h = hashString(ev.label || 'error');
      lane = this.lanes[h % this.lanes.length];
      s0 = ((h >> 8) % 1000) / 1000 * lane.length;
    }
    if (!lane) return null;

    /* Who. A robot and not a pedestrian, and that is a rendering constraint
       being honest about itself rather than a story choice: a robot is drawn
       from its own instanced mesh with a `lean` term already in its matrix, so
       it can be knocked flat with no change to anything. The crowd renderer
       draws people through three tiers — a real skeleton, a baked
       vertex-animation texture and a sprite — none of which has a rotation
       this pass could give it, and a "tumbling" pedestrian that stayed upright
       in two of the three tiers would be worse than no accident at all.

       It also happens to be the truer picture. The robots ARE the live agents
       here; an agent that hit an error is the thing that goes down. */
    /* And the 2026-09-07 amendment, from Beri: "it throws whoever stepped into
       its path". The robot stays the DEFAULT because it is the data-true one —
       the robots are the live agents and an agent that hit an error is the
       thing that goes down — but a car does not choose its victim by species.
       Whoever is nearest the impact point is the one that is hit, robot or
       person, and it is a plain distance comparison with no tie-break and no
       randomness, so the same error at the same spot picks the same body twice.

       What a person costs that a robot does not: only the near tier can be
       rotated. See Known limits. */
    let victim = null, vd = Infinity;
    const cx = lane.at(s0, _v3, _v3b).clone();
    for (const a of this.actors) {
      if (a.crash) continue;
      if (a.kind !== 'robot' && a.kind !== 'person') continue;
      /* Somebody already sitting on a bench did not step into anything. */
      if (a.kind === 'person' && (a.state === 'sit' || a.leader)) continue;
      const d = a.pos.distanceToSquared(cx);
      if (d < vd) { vd = d; victim = a; }
    }
    if (!victim) return { why: 'nobody to stage it on' };

    /* Which car. The nearest one on this lane that is still SHORT of the spot,
       because a driver who has already gone past cannot hit anybody. */
    let car = null, cd = Infinity;
    for (const v of this.vehicles) {
      if (v.crash) continue;
      if (v.lane !== lane) continue;
      let d = s0 - v.s;
      if (d < 0) d += lane.length;                 // the lane is a loop
      if (d < cd) { cd = d; car = v; }
    }
    /* No car on the victim's own lane — a crew street can be a lane with no
       traffic on it at this instant, and on those hosts (city, globe) the
       accident used to no-op. Drive the nearest vehicle on ANY lane onto this
       one, a short approach behind the impact, so a collision still HAPPENS
       where the error is. It keeps its type (its instanced mesh already has the
       slot) and simply changes lanes; _stepVehicles picks it up on the new lane
       next step, and the approach stage below drives it into the victim. */
    if (!car && this.vehicles.length) {
      let best = Infinity, near = null;
      for (const v of this.vehicles) {
        if (v.crash) continue;
        const d = v.pos.distanceToSquared(cx);
        if (d < best) { best = d; near = v; }
      }
      if (near) {
        const back = Math.min(lane.length * 0.35, 14, lane.length - 1e-3);
        near.lane = lane;
        near.s = ((s0 - back) % lane.length + lane.length) % lane.length;
        near.arc = null; near.approach = null; near.turn = 0; near.turnTo = null;
        lane.at(near.s, near.pos, near.head);      // no one-frame teleport at the old spot
        car = near;
      }
    }

    this.accident = {
      label: ev.label || 'error', lane, s: s0, at: cx,
      /* car may be null only when the whole street has NO vehicle at all; the
         victim then collapses in place and the ambulance still comes — an
         accident is reported, never swallowed, wherever there is a victim. */
      car, victim, stage: car ? 'approach' : 'hit', t: 0, ambulance: null,
    };
    if (car) {
      /* The victim stops having its own day and walks into the road. */
      victim.crash = { stage: 'walking', t: 0, lean: 0, vy: 0 };
    } else {
      /* Carless: a collapse where it stands, on its back, so the ambulance has
         something to answer. Only the near tier can show the lean (known limit),
         same as a knocked pedestrian. */
      victim.crash = { stage: 'down', t: 0, lean: -Math.PI / 2, vy: 0 };
    }
    victim.goal = null;
    /* A person victim stops having a day too: the errand is dropped and the
       bench it had claimed is given back, or the seat stays taken by somebody
       lying in the road for as long as the accident lasts. */
    if (victim.seat) { victim.seat.taken = false; victim.seat = null; }
    if (victim.kind === 'person') { victim.path = []; victim.point = null; victim.cross = null; }
    /* And the driver stops reading the road ahead. `_stepVehicles` skips its
       jaywalk braking while this says 'approach', which is the one line that
       turns "a car brakes for somebody in the road" into "a car brakes too
       late" — the same code path, one flag apart. */
    if (car) car.crash = { stage: 'approach' };
    return this.accident;
  }

  /* One frame of whatever the accident is doing. Called from _stepVehicles,
     after the traffic has moved, because every stage of it is a reaction to
     where the car now is. */
  _stepAccident(dt) {
    const A = this.accident;
    if (!A) return;
    A.t += dt;
    const V = A.victim;

    if (A.stage === 'approach') {
      /* Into the road, at a walk. The driver is NOT braking for this one —
         `_stepVehicles` skips a car whose crash record is still on 'approach' —
         which is what makes it a collision and not a near miss. */
      this._tmp.subVectors(A.at, V.pos); this._tmp.y = 0;
      const d = this._tmp.length();
      if (d > 0.05) {
        V.pos.addScaledVector(this._tmp.divideScalar(d), Math.min(d, 1.6 * dt));
        V.pos.y = this.getHeight(V.pos.x, V.pos.z);
        V.yaw += angleTo(V.yaw, Math.atan2(this._tmp.x, this._tmp.z)) * Math.min(1, dt * 6);
      }
      /* Contact: the car's nose reaches the body. */
      const gap = Math.hypot(A.car.pos.x - V.pos.x, A.car.pos.z - V.pos.z) - A.car.half;
      /* The late brake. Inside a car's length the driver finally sees it, which
         is a deceleration curve that starts far too late to matter — and the
         one place on this street where `decel` is doing its job as a signal:
         the nose dives and the brake lights come on a beat before the impact. */
      if (gap < A.car.len * 1.6) A.car.crash = null;   // release the brake block
      if (gap < 0.4 || (d < 0.4 && gap < 1.2)) {
        A.stage = 'hit'; A.t = 0;
        /* Thrown along the car's own heading. The speed the car was doing is
           what the body carries, halved, which is enough to clear the bonnet
           without launching anybody over a roof. */
        const sp = Math.max(3, A.car.speed);
        V.crash = { stage: 'fly', t: 0, lean: 0,
                    vx: A.car.head.x * sp * 0.5, vz: A.car.head.z * sp * 0.5,
                    vy: 3.4, spin: sp * 0.25 };
        A.car.speed = 0;
        A.car.want = 0;
        A.car.hazard = 1;
        /* Askew, and deterministically so: which way a car ends up pointing
           after it has stopped hard is decided by the label, not by chance. */
        A.car.askew = (hashString(A.label) & 1 ? 1 : -1) * 0.34;
      }
      return;
    }

    if (A.stage === 'hit') {
      /* Two seconds of lying there before the call goes out, which is roughly
         how long it takes anyone to react. */
      if (A.t > 2) { A.stage = 'ambulance'; A.t = 0; this._callAmbulance(A); }
      return;
    }

    if (A.stage === 'ambulance') {
      this._driveAmbulance(A, dt);
      /* Twenty seconds from the moment it arrives, then everything the
         accident put on the street goes away again. */
      if (A.amb && A.amb.arrived && A.t - A.amb.arrivedAt > 20) { A.stage = 'clear'; A.t = 0; }
      return;
    }

    if (A.stage === 'clear') {
      /* Derez, in the sense city.js uses the word: nothing fades: the ambulance
         drives back off the end of the road it came in by, the victim stands
         up, and the car straightens and rejoins the traffic. Two seconds. */
      const k = Math.min(1, A.t / 2);
      V.crash.lean += (0 - V.crash.lean) * Math.min(1, dt * 4);
      if (A.car) A.car.askew += (0 - A.car.askew) * Math.min(1, dt * 3);
      if (A.amb) A.amb.leaving = true;
      if (A.amb) this._driveAmbulance(A, dt);
      if (k >= 1) {
        V.crash = null;
        if (A.car) {
          A.car.hazard = 0;
          A.car.askew = 0;
          A.car.want = 7;
          A.car.crash = null;
        }
        if (this.ambGroup) this.ambGroup.visible = false;
        this.accident = null;
      }
    }
  }

  /* The victim, once it is off its feet: a ballistic arc, a tumble, and then it
     stays down until the accident is cleared. Driven from _stepRobots so a
     knocked-down agent stops doing its own errands. */
  _stepVictim(a, dt) {
    const c = a.crash;
    if (c.stage === 'walking') return;              // the approach owns it
    if (c.stage === 'fly') {
      c.vy -= 9.81 * dt;
      a.pos.x += c.vx * dt;
      a.pos.z += c.vz * dt;
      a.pos.y += c.vy * dt;
      /* Tumbling backwards over the bonnet — `lean` is the term the robot's own
         draw already has, so this costs nothing anywhere else. */
      c.lean -= c.spin * dt;
      const ground = this.getHeight(a.pos.x, a.pos.z);
      if (a.pos.y <= ground && c.vy < 0) {
        a.pos.y = ground;
        c.stage = 'down';
        /* Flat, and stopped there. -PI/2 is on its back. */
        c.lean = -Math.PI / 2;
      }
      if (c.lean < -Math.PI / 2) c.lean = -Math.PI / 2;
    }
    /* 'down' does nothing at all, which is the point of it. */
  }

  /* An ambulance, which is a real model and not a re-skinned van: the assets
     already carry `life/quaternius_publictransport_ambulance.glb` (manifest row
     `life.car.van`, a leftover from before the traffic moved to the Hunyuan
     pack). It is loaded the first time an error is reported and never before,
     so a street that has no accidents pays nothing for the possibility of one.

     It is NOT put through the rigid instanced ladder the traffic uses. There is
     only ever one of it — the cap is one accident at a time — and a population
     of one does not need an InstancedMesh, three decimation tiers and a slot in
     the raw-detail budget. It is a plain Object3D in the group.

     It is also the only vehicle on this street whose WHEELS TURN, and that is
     not a choice either: this Quaternius file has `FrontWheels` and
     `BackWheels` as separate nodes, and every Hunyuan traffic model is a single
     node with a single primitive and no separable wheels at all. See
     docs/LIFE.md for the per-model table. */
  async _loadAmbulance() {
    if (this.ambGroup || this._ambLoading) return this.ambGroup;
    this._ambLoading = true;
    const rec = this.manifest['life.car.van'];
    if (!rec || !this._loadGLB) { this._ambLoading = false; return null; }
    const gltf = await this._loadGLB(rec.path);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(_v3);
    /* Scaled to a real ambulance's height and stood on the road, the same two
       corrections every model in this file gets. */
    const fit = 2.35 / Math.max(1e-6, size.y);
    const holder = new THREE.Group();
    root.scale.setScalar(fit);
    root.position.set(0, -box.min.y * fit, 0);
    /* Its length onto +Z, by the same measurement the rigid catalogue's `face`
       assertion uses — the long horizontal axis is the one it drives along. */
    if (size.x > size.z) holder.rotation.y = Math.PI / 2;
    holder.add(root);
    holder.visible = false;
    holder.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.ambGroup = holder;
    this.ambWheels = [];
    let radius = 0.35;
    root.traverse(o => {
      if (!/wheel/i.test(o.name || '')) return;
      this.ambWheels.push(o);
      const wb = new THREE.Box3().setFromObject(o);
      radius = Math.max(radius, wb.getSize(_v3b).y * 0.5 * fit);
    });
    this.ambWheelRadius = radius;
    this.group.add(holder);
    this._ambLoading = false;
    return holder;
  }

  /* Where it comes in from, and where it stops. The nearest END of the lane the
     accident is on — an ambulance arrives from off the edge of the map, which
     on a lane graph is one of its two ends. */
  _callAmbulance(A) {
    const fromStart = A.s < A.lane.length - A.s;
    A.amb = {
      dir: fromStart ? 1 : -1,
      s: fromStart ? 0 : A.lane.length,
      /* Stopping short of the wreck by both vehicles' lengths, so it parks
         behind the scene rather than in it. */
      stopAt: A.s - (fromStart ? 1 : -1) * ((A.car ? A.car.len : 4) + 4),
      speed: 0, arrived: false, arrivedAt: 0, leaving: false, spin: 0,
    };
    this._loadAmbulance();
  }

  _driveAmbulance(A, dt) {
    const amb = A.amb, g = this.ambGroup;
    if (!amb || !g) return;
    g.visible = true;
    const target = amb.leaving ? (amb.dir > 0 ? A.lane.length : 0) : amb.stopAt;
    const dir = Math.sign(target - amb.s) || amb.dir;
    const left = Math.abs(target - amb.s);
    /* Slows into the scene rather than stopping dead on the mark. */
    const want = amb.leaving ? 13 : Math.min(13, 2 + left * 0.9);
    amb.speed += clamp(want - amb.speed, -12 * dt, 5 * dt);
    const step = amb.speed * dt;
    if (left <= step && !amb.leaving) {
      amb.s = target; amb.speed = 0;
      if (!amb.arrived) { amb.arrived = true; amb.arrivedAt = A.t; }
    } else {
      amb.s += dir * step;
    }
    A.lane.at(clamp(amb.s, 0, A.lane.length), _v3, _v3b);
    g.position.set(_v3.x, this.getHeight(_v3.x, _v3.z), _v3.z);
    /* Backwards along the lane when it came in from the far end: the lane's
       tangent is the direction of travel and the ambulance is driving it. */
    g.rotation.y = Math.atan2(_v3b.x * amb.dir, _v3b.z * amb.dir);
    /* THE WHEELS. Angular velocity is the ground speed over the wheel radius,
       which is the only value that makes a rolling wheel look rolled rather
       than spun — and it is measured off the wheel node's own bounding box, not
       assumed. */
    amb.spin -= (amb.speed / Math.max(0.05, this.ambWheelRadius)) * dt;
    for (const w of this.ambWheels || []) w.rotation.x = amb.spin;
    amb.wheelRate = amb.speed / Math.max(0.05, this.ambWheelRadius);
  }

  /* The beacon: red and blue, alternating, on the roof. Drawn on the same
     additive InstancedMesh as every other lamp on this street, which is why it
     is a continuation of _drawLamps' index rather than a mesh of its own. */
  _drawAmbulanceLamps(k, cap) {
    const A = this.accident, g = this.ambGroup;
    if (!A || !A.amb || !g || !g.visible || k + 1 >= cap) return k;
    /* Four flashes a second — twice the indicator's rate, which is what makes
       an emergency light read as urgent next to a turn signal. */
    const blue = Math.floor(this.time * 4) % 2 === 0;
    for (const side of [-1, 1]) {
      if (k >= cap) break;
      this._tmp.set(g.position.x + Math.cos(g.rotation.y) * side * 0.5, g.position.y + 2.5,
                    g.position.z - Math.sin(g.rotation.y) * side * 0.5);
      this._q.setFromAxisAngle(UP, g.rotation.y);
      this.lamps.setMatrixAt(k, this._m.compose(this._tmp, this._q, _scale.setScalar(1.15)));
      this.lamps.setColorAt(k, _colE.setHex((side < 0) === blue ? 0x2a5bff : 0xff2020));
      k++;
    }
    return k;
  }

  /* =======================================================================
     PROBES — what the docs' numbers are read off
     ======================================================================= */
  stats() {
    return {
      humans: this.counts.humans, cars: this.counts.cars, robots: this.counts.robots,
      sheep: this.counts.sheep, cows: this.counts.cows,
      birds: this.counts.birds, parrots: this.counts.parrots,
      actors: this.actors.length, nearestAnim: this.nearestAnim || 0,
      lanes: this.lanes.length, junctions: this.junctions.length,
      /* How many of the cars the caller asked for did not fit. Non-zero means
         the lane graph is shorter than the traffic asked of it — see
         populate()'s capacity cap — and it is reported rather than hidden,
         because the alternative is vehicles standing inside one another. */
      carsDropped: this.carsDropped || 0,
      /* The accident, if one is in flight. Null on a street with no errors,
         which is every street until a host reports one. */
      accident: this.accident ? { stage: this.accident.stage, label: this.accident.label } : null,
      walkNodes: this.walk.nodes.length, doors: this.walk.doors.length,
      seats: this.walk.seats.length, perches: (this.perches || []).length,
      /* The statics, so a harness can tell a herd that was placed from one that
         silently was not. `props` counts everything standing still; `dogs` the
         ones carried by a pedestrian. */
      props: this.props.length, dogs: this.dogs.length,
      shops: this.walk.shops.length, homes: this.walk.homes.length,
      crossings: this.crossings.length, carFree: this.carFree.length,
      walk: this._walkComponents(),
      /* The separation gate, as a rate. `perSecond` is the honest reading: how
         many overlapping pairs a second of this street contains, measured on
         the positions the frames actually drew. */
      overlap: {
        now: this.overlap.pairs, peak: this.overlap.peak, frames: this.overlap.frames,
        seconds: +this.overlap.time.toFixed(1),
        rounds: this.overlap.rounds || 0,
        perSecond: this.overlap.time > 0
          ? +(this.overlap.sum / this.overlap.time).toFixed(3) : 0,
        /* The solver's own figure, on the criterion the previous build used. */
        solvedPerSecond: this.overlap.time > 0
          ? +((this.overlap.solvedSum || 0) / this.overlap.time).toFixed(3) : 0,
      },
      /* The obstacle gate, the same shape as the separation one: how many
         pedestrian capsules a second of this street are inside a railing, a
         hedge, a bench, a prop or a vehicle. `worst` is the deepest any body
         got, in metres, which is what separates a rounding error from a person
         standing in a car. `obstacles` and `edgesCut` say what the map was
         built from and what the pavement graph lost to it. */
      penetration: {
        now: this.penetration.now, peak: this.penetration.peak,
        frames: this.penetration.frames, seconds: +this.penetration.time.toFixed(1),
        worst: +this.penetration.worst.toFixed(3),
        perSecond: this.penetration.time > 0
          ? +(this.penetration.sum / this.penetration.time).toFixed(3) : 0,
      },
      obstacles: this.obstacles.length, edgesCut: this.edgesCut || 0,
      /* What the reshape actually achieved, per human model: one head in N,
         before and after. This is the number the brief states as a target and
         it is read off the posed geometry, not asserted. */
      proportions: this.headRatios(),
    };
  }

  /* Start the accumulated probes again. The overlap rate is a rate SINCE
     something, and what it has to be measured over is a settled street: the
     first second of the page has a hundred and twenty people materialising on
     ninety-nine nodes, several to a node, and the separation pass needs a few
     frames to comb that out. Counting those frames into the rate measures the
     spawn, not the behaviour. */
  resetProbes() {
    this.overlap.pairs = 0;
    this.overlap.peak = 0;
    this.overlap.sum = 0;
    this.overlap.frames = 0;
    this.overlap.time = 0;
    this.overlap.solvedSum = 0;
    const p = this.penetration;
    p.now = 0; p.peak = 0; p.sum = 0; p.frames = 0; p.time = 0; p.worst = 0;
    return this;
  }

  headRatios() {
    const out = {};
    for (const id in this.models) {
      const e = this.models[id];
      if (!e.ratioBefore) continue;
      out[id] = {
        before: +e.ratioBefore.ratio.toFixed(2),
        after: e.ratioAfter ? +e.ratioAfter.ratio.toFixed(2) : null,
        headM: e.ratioAfter ? +(e.ratioAfter.head / e.ratioAfter.height * e.height).toFixed(3) : null,
      };
    }
    return out;
  }
}

export { CHARACTERS, RIGID, PROPORTION };

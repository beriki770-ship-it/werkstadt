/* =============================================================================
   werkstadt — world.js
   ONE world: Beri's vault as geography, his projects as a harbour city on its
   coast, and whatever Claude is doing this minute as light, smoke and drones
   over it.

   This replaces two views that were separate and that Beri rejected as "boring
   cities": world.html's grey block clusters on a grid, and vault.html's one
   flat city. The DNA change is geography — a real heightmap with a coastline, a
   mountain, a river and a sea, lit by the real sun at the real time, with PBR
   materials off the asset pack. The bar is a modern strategy game, not a chart.

   THE ONE RULE, everywhere: nothing is invented. Every building traces to a
   note in data/vault.json or a project in /api/world; every bridge is a daily
   note; every crane is an open item somebody actually wrote down; every drone
   is an agent in flight right now; every window that is lit is a file that was
   touched in the last six hours. When the machine is idle the world is dark and
   quiet, and that is the information.

   Split across three files because one was 1,800 lines: terrain.js owns the
   ground and the sun, biomes.js owns where everything stands, this file owns
   what it is made of and how it behaves.
   ========================================================================== */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
/* Merging is not a nicety here: the scanned prop pack ships one chainlink fence
   across 26 meshes and one pipe run across 106, and instanceModel() makes ONE
   InstancedMesh per source mesh — 106 draw calls for a single pipe. Merged by
   material first, both come down to two. */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* THE BUILDING GENERATOR. buildings.js grows a real facade — openings the wall
   is built around, sills, shutters, gutters, a room behind every pane — where
   this file's own wall shader paints windows onto a box. The box is right at
   600 m and wrong at 8, which is the whole reason for the seam. API frozen:
   docs/BUILDINGS.md. */
import { BuildingKit } from './buildings.js';

/* THE LIVING LAYER and THE FLEET. Two standalone modules that import nothing
   from this repo: life.js puts people, vehicles, herds and flocks on the ground
   the plan already laid out, drones.js turns every live agent from a glowing
   octahedron into an ORNIS airframe. Both take their counts from THIS file,
   because this file is the only one that has the data. APIs frozen:
   docs/LIFE.md, docs/DRONES.md. */
import { Life } from './life.js';
import { DroneKit } from './drones.js';

import { WORLD, HALF, SEA, heightAt, landAt, buildTerrain, buildWater,
         buildCheapWater, buildHeightTexture, sunVector, sunAngles, riverAt,
         riverSurface, RIVER } from './terrain.js';
import { planWorld, REGIONS, hash32, LM_YARD, HOUSE_GRID } from './biomes.js';


/* =============================================================================
   CONSTANTS — the shape of the world in one block
   ========================================================================== */
/* THE INSIDE OF A LANDMARK. The same module the session city walks its rooms
   with — see THE HALL in interior.js. This file owns nothing of it and hands it
   the six callbacks it asks for in init(); there is no import back the other
   way and no cycle. */
import * as Interior from './interior.js';
/* The enter / exit / search buttons. This page owns what those three words
   MEAN on the island; controls.js owns the buttons, their labels and their
   states. It exists because Lively forwards mouse only to the wallpaper — see
   the header comment in controls.js. */
import * as Controls from './controls.js';

const API_WORLD  = '/api/world';
const API_STREAM = '/api/world/stream';
const API_VAULT  = '/api/vault';
const API_META   = '/api/project/meta?id=';
const VAULT_JSON = 'data/vault.json';
const MANIFEST   = 'assets/manifest.json';
const REFRESH_MS = 30000;

const GOLD  = new THREE.Color(0xd2a62c);
const COOL  = new THREE.Color(0x6fa8b8);

const ORBIT_RESUME_MS = 20000;
const FLY_MS = 1800;
/* The zoom range, stated as the two numbers a person can check: the wheel may
   pull in to CAM_NEAR units of the aim point, and the lens itself never drops
   below CAM_FLOOR metres over whatever is under it. Together they are "the whole
   map down to eye level". CAM_FAR is the whole island in frame. */
const CAM_NEAR = 3, CAM_FAR = 900, CAM_FLOOR = 2;
const MAX_CRANES = 220;         // ceiling on the crane pool: 125 quarters + the fortress
const MAX_SMOKE  = 900;
const MAX_TRAFFIC = 260;

const params = new URLSearchParams(location.search);
const CAMERA_FIXED = params.get('camera') === 'fixed';
const SCREENSAVER  = params.get('screensaver') === '1';
const FOCUS        = params.get('focus');
/* ?hour=NN forces the clock the sky is lit by. Its caller is the shot list:
   docs/shots wants a dusk frame and a night frame, and the wall clock is only
   one of those at a time. Nothing else reads it. */
const HOUR_OVERRIDE = params.has('hour') ? parseFloat(params.get('hour')) : null;
/* THE TWO FALLBACK FLAGS, kept on purpose and not for debugging: they are the
   B half of every A/B frame-rate reading in RUNBOOK.md. `?life=0` builds the
   world with no living layer at all; `?drones=orbs` keeps the octahedron-and-
   ring craft this page flew before the kit landed. Anything measured without a
   pair of readings taken minutes apart on this machine is not a measurement —
   see "Reading a frame rate here honestly". */
const LIFE_OFF   = params.get('life') === '0';
const DRONE_ORBS = params.get('drones') === 'orbs';
/* ?demo=print replays the last half hour of one real live town's file work as
   prints, at half speed, so the materialisation can be watched on purpose
   instead of waited for. Nothing is staged — the events are that town's own.
   `?demo=print=<townId>` (I16 fix) forces the town instead of picking one —
   the query string's own "=" splits on the FIRST one, so the raw value here
   is literally "print=<townId>". */
const DEMO_PARAM = params.get('demo') || '';
const DEMO_PRINT = DEMO_PARAM === 'print' || DEMO_PARAM.startsWith('print=');
const DEMO_PRINT_TOWN = DEMO_PARAM.startsWith('print=') ? DEMO_PARAM.slice('print='.length) : null;
/* THE PHONE. `?mobile=1` forces the preset and `?mobile=0` refuses it; with
   neither, `pointer: coarse` decides — a finger has no hover, no wheel and no
   right button, which is exactly the set of things this page's controls were
   built on. Auto-detection and not a flag alone, because the person holding the
   phone did not read the docs.
   WHAT THE PRESET IS, and two of the five knobs were already at spec before it:
     - quality medium (which is where shadows OFF and the halved living-layer
       budget already live — LIFE_CAPS.medium is half of high across the board,
       and KIT_MAX_LOD0.medium is 8 against high's 22);
     - devicePixelRatio capped at 1.5 — ALREADY the renderer's cap for every
       device, see init(); a 3x phone screen was never rendered at 3x;
     - the bloom at half the frame's width and height — ALREADY the default,
       see resize(); it is the single most expensive pass in this scene;
     - the hint line as a bottom sheet rather than one line of 12 px type. */
const MOBILE = params.get('mobile') === '1' ||
  (params.get('mobile') !== '0' &&
   typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

const el = id => document.getElementById(id);
const dom = {};


/* =============================================================================
   STATE
   ========================================================================== */
let renderer, scene, camera, composer, canvas, bloomPass, renderPass;
let sky, sun = new THREE.Vector3(), sunLight, hemi, water, terrain, bedTex = null;
let envDusk = null, envNight = null;
let plan = null, vault = null, world = null;
let kit = null;                 // the BuildingKit — see THE KIT TOWN
let life = null;                // the Life layer — see THE LIVING LAYER
let droneKit = null;            // the DroneKit — see THE FLEET
let droneEnv = null;            // which env map the fleet is currently pointed at
let tex = {}, models = {};
/* The remembered setting, unless this is a phone — see MOBILE. Assigned, not
   put through setQuality(), so a desktop that once opened `?mobile=1` does not
   find its own preference rewritten to medium in localStorage. */
let quality = MOBILE ? 'medium' : (localStorage.getItem('werkstadt.quality') || 'high');
let fontsReady = false;
const bootMs = performance.now();

const quarters = new Map();     // town id -> quarter record
const drones = new Map();       // "<townId>/<agentId>" -> craft
const pickables = [];           // meshes the raycaster tests, with a records table
let selected = null, hovered = null;
let liveNotes = new Map();      // note id -> ms when it was last written (from /api/vault)


/* =============================================================================
   BOOT
   ========================================================================== */
async function init() {
  canvas = el('map');
  for (const id of ['world-counts', 'world-clock', 'hover', 'caption', 'cap-name',
                    'cap-path', 'cap-state', 'cap-agents', 'cap-open', 'cap-hint',
                    'hints', 'fault', 'fault-text', 'a11y-status', 'search',
                    'search-input', 'search-hits', 'quality', 'free-hud']) {
    dom[id] = el(id);
  }
  if (SCREENSAVER) document.body.classList.add('screensaver');
  if (MOBILE) {
    document.body.classList.add('mobile');
    /* The controls line names KEYS, and a phone has none of them. Rewritten to
       the gestures the touch layer actually binds — same element, same six
       seconds, and the keyboard-only rows (wasd, f, /, q, p, h) are dropped
       rather than listed as things a finger cannot do. */
    dom.hints.querySelector('p').innerHTML =
      '<kbd>drag</kbd> orbit · <kbd>pinch</kbd> zoom · <kbd>twist</kbd> rotate · ' +
      '<kbd>tap</kbd> select · <kbd>double-tap</kbd> enter · <kbd>press &amp; hold</kbd> what is this';
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false,
                                         powerPreference: 'high-performance' });
  } catch (e) {
    return fault('This browser could not open a WebGL context, so the world cannot draw.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  /* 0.62, not 1.05. This is the single biggest thing that separated this world
     from the session city standing next to it: at 1.05 the ground, the sky and
     the roofs all land in the top third of the range, nothing is allowed to be
     dark, and the frame reads as a board game under a desk lamp. A film exposes
     for the highlights and lets the rest fall — which is also what makes a lit
     window mean something, because it is then the brightest thing in the shot. */
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  /* THE PRINT CUT IS A CLIPPING PLANE, so the renderer has to honour per-material
     planes. This costs nothing on its own: a material with no `clippingPlanes`
     compiles to exactly the program it compiled to before, because the clipping
     define is 0. Only the handful of cloned materials on a building that is
     currently printing carry a plane — see THE MATERIALISATION. */
  renderer.localClippingEnabled = true;

  scene = new THREE.Scene();
  /* fov 30, not 38. A wide lens on a 900 m island stretches the near corner and
     shrinks the mountain, which is exactly the diorama look — you are reading a
     model on a table. A long lens compresses the mountain, the harbour and the
     islands into one another, and compression is what atmosphere is drawn on. */
  /* far 12,000, not 3,000. The far plane is where the sea gets CUT, and that cut
     is a dead-straight line across the frame at a fixed screen height — the
     "orange sky band with a hard edge" survived four attempts at fixing it in
     the sky shader because it was never in the sky. Past 12,000 units the
     exponential fog has taken the water to within half a percent of the sky's
     own horizon colour, so the cut has nothing left to show. near goes 1 -> 2 to
     buy back the depth precision the longer frustum costs; nothing in this world
     is ever closer than two metres to the lens. */
  camera = new THREE.PerspectiveCamera(30, 1, 2, 12000);
  /* EXPONENTIAL depth fog in the sky's own colour, not linear. Linear fog has a
     start distance, and a start distance means everything nearer than it sits in
     perfectly clear air — which is why the harbour and the mountain read as two
     cut-outs on one card. Air does not work that way: it thickens from the lens
     outwards, so the near village is very slightly hazed, the mountain foot more,
     the far ridge more again, and THAT gradient is what the eye reads as depth.
     0.00062: at the wide shot's 1,100 units the far ridge keeps about 50% of its
     own colour, which is haze you can see without losing the mountain in it. */
  scene.fog = new THREE.FogExp2(0x2b3a48, 0.00062);

  document.fonts.ready.then(() => { fontsReady = true; refreshLabels(); });
  window.addEventListener('resize', resize);
  bindInput();
  bindControls();
  /* BEFORE resize(), for the reason city.js records: resize() is what hands the
     interior camera its aspect ratio, and an interior that does not exist yet
     keeps the PerspectiveCamera default of 1 and draws every wall a third too
     wide. `hallOnly` says this page only ever opens a hall, so the stacked room
     the session city walks is not built here — see attach() in interior.js. */
  Interior.attach({
    hallOnly: true,
    createSky,
    doorPose,
    overrideCamera,
    hallMaterial,
    sessionClock: () => Date.now(),
    cameraPose: () => ({ pos: camera.position.clone(),
                         look: new THREE.Vector3(camTarget.x,
                                                 camTarget.y + cam.dist * 0.105,
                                                 camTarget.z) }),
    /* Three the hall never calls — they belong to the city's file rooms. Given
       as no-ops rather than left undefined, so a future path that does call one
       fails on its return value and not on `host.x is not a function`. */
    setBuildingOpen: () => {},
    workersFor: () => [],
    filesOfPlate: () => [],
  });
  resize();
  requestAnimationFrame(frame);

  try {
    await loadAssets();
  } catch (e) {
    return fault('The asset pack under <code>assets/</code> did not load: ' + escapeHtml(e.message));
  }
  /* ONE kit, shared, built off THIS renderer — integration note 1 in
     docs/BUILDINGS.md. It prefilters its own PMREM chains at load; the world's
     own envDusk/envNight are handed to it straight afterwards so the two are
     never lit by two different skies. */
  try {
    kit = await BuildingKit.load(renderer, MANIFEST);
    kit.setEnvironment(envDusk);
  } catch (e) {
    return fault('The building generator did not load: ' + escapeHtml(e.message));
  }
  /* ONE kit, shared, loaded next to BuildingKit.load() and before the render
     loop needs it — integration note 1 in docs/DRONES.md. A fleet that fails to
     load is NOT fatal: the world still stands and the drones fall back to the
     orbs, which is also what `?drones=orbs` asks for on purpose. */
  if (!DRONE_ORBS) {
    try {
      droneKit = await DroneKit.load(renderer, MANIFEST);
      droneKit.getHeight = (x, z) => Math.max(SEA, landAt(x, z));
      droneKit.setEnvironment(envDusk);
      buildDroneTrails();
    } catch (e) {
      droneKit = null;
      console.warn('drone kit unavailable, flying orbs:', e.message);
    }
  }
  buildSky();
  await loadData();
  buildWorld();
  openStreams();
  setInterval(loadWorldOnly, REFRESH_MS);
  applyFocus();
  runPendingSearch();          // whatever was typed during the ~25 s cold build
  showHintsOnce();
  /* THE LIVING LAYER GOES ON LAST, and after the camera has been pointed.
     Two reasons, both measured: Life.load() decimates eighteen 50,000-triangle
     meshes and takes about twenty seconds on this machine, so awaiting it before
     applyFocus() would leave the lens over the wrong water for that whole time;
     and addSkyBox raycasts everything already standing to find its roosts, so
     the buildings and the trees have to be there first (docs/LIFE.md,
     integration note 7). The world is complete and interactive without it. */
  await buildLife();
  /* THE BACK YARDS, FILLED IN. After the living layer for the same reason the
     living layer is last: it is two megabytes a town off the server and the
     world is complete and interactive without it. See seedPrintedBuildings(). */
  await seedPrintedBuildings();
  if (DEMO_PRINT) startPrintDemo();
}

function fault(msg) {
  dom['fault-text'].innerHTML = msg;
  dom.fault.hidden = false;
  dom['a11y-status'].textContent = dom['fault-text'].textContent;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  Interior.resize(w, h);
  if (!composer) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
    /* Kept by name: when the reader is inside a landmark the picture is the
       interior's scene and camera, and swapping them on this pass is how the
       one composer draws both — the same seam city.js has. */
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    /* Bloom is what turns a lit window into a town at dusk. Low strength: this
       is a world at golden hour, not a neon one. */
    /* The session city's exact numbers. Nothing in this world is a different
       KIND of light source from a lit office window, so anything else would make
       the two views disagree about what a lamp at dusk looks like. */
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_STRENGTH, 0.72, 0.62);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  composer.setSize(w, h);
  /* HALF RESOLUTION for the bloom, put back after composer.setSize(), which
     resets every pass to the full frame. Measured on the real Radeon: bloom was
     the single most expensive thing in the frame — 38 fps without it against 28
     with — because it is five downsample and five upsample passes over the whole
     1440x900 buffer. A bloom is a blur; run at half the width and height it
     costs a quarter and looks, at this radius, identical. */
  if (bloomPass) bloomPass.setSize(Math.round(w * 0.5), Math.round(h * 0.5));
}


/* THE TWO BLOOM STRENGTHS. 0.48 is the orbit's, and it is solved for a 30 mm
   lens pointed DOWN at a town: almost no sky is in the frame and the only things
   over the 0.62 threshold are lit windows. A bridge deck and a lighthouse
   gallery are the first views this world has ever had at eye level through a
   62-degree lens, and there the horizon fills a third of the frame at HDR values
   far over that threshold — the first deck capture came back as a white sheet
   with a plaque in it, and the same shot with bloom off showed cobbles, a gorge
   and a town on the ridge. So an overlay form runs the same bloom at a third of
   the strength: the lamps still glow and the sky stops eating the picture.
   frame() writes it every frame, which needs no state to restore. */
const BLOOM_STRENGTH = 0.48, BLOOM_OVERLAY = 0.12;

/* =============================================================================
   ASSETS — the CC0 pack in assets/, read through its own manifest
   Every texture is set up once here: sRGB on colour maps, linear on data maps,
   repeat wrapping (the whole splat depends on it) and anisotropy, which is the
   single cheapest thing that stops ground textures smearing into mush at a
   grazing angle.
   ========================================================================== */
async function loadAssets() {
  const man = await (await fetch(MANIFEST)).json();
  const texLoader = new THREE.TextureLoader().setPath('assets/');
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const load = (path, srgb) => new Promise((res, rej) => {
    texLoader.load(path, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, maxAniso);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, () => rej(new Error(path)));
  });

  const surfaces = ['grass', 'forestFloor', 'cliff', 'cobble', 'asphalt',
                    'roofTiles', 'plaster', 'brick', 'sand'];
  await Promise.all(surfaces.map(async k => {
    const m = man[k];
    const [diffuse, normal, arm] = await Promise.all([
      load(m.diffuse, true), load(m.normal, false), load(m.roughness, false)]);
    tex[k] = { diffuse, normal, arm, tile: m.metresPerTile };
  }));
  tex.waterNormal = await load(man.waterNormal.path, false);

  /* Two HDRIs: one for dusk, one for the moon. They are the environment only —
     the visible sky is the Sky shader, which follows the sun continuously,
     while these two supply the reflected light the PBR materials need.

     PREFILTERED HERE, not left to the renderer. Three will PMREM an
     equirectangular scene.environment on its own, but it does it lazily, on the
     frame the texture is first assigned — and this world swaps between the two
     HDRIs as the sun goes down, so that cost lands as a stall in the middle of a
     shot. Both chains are built once, at load, while the page is already showing
     nothing. It also makes the roughness response correct: a PMREM mip chain is
     what lets a rough plaster wall and a wet roof take DIFFERENT amounts of the
     same sky, which is most of what "lit by an environment" means. */
  const rgbe = new RGBELoader().setPath('assets/');
  const hdr = (p) => new Promise((res, rej) =>
    rgbe.load(p, t => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); },
              undefined, () => rej(new Error(p))));
  const [rawDusk, rawNight] = await Promise.all([hdr(man.hdriDusk.path), hdr(man.hdriNight.path)]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  envDusk = pmrem.fromEquirectangular(rawDusk).texture;
  envNight = pmrem.fromEquirectangular(rawNight).texture;
  rawDusk.dispose(); rawNight.dispose(); pmrem.dispose();

  /* Every castle/town/pirate .glb points at Textures/colormap.png, which the
     pack does not ship (checked: the reference is in the .glb, the file is not
     in assets/models/). Left alone that is four 404s in the console on every
     load. The models that keep their own material are retinted below anyway, so
     the loader is handed one transparent pixel instead of a network error. */
  const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=';
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => /colormap\.png$/.test(url) ? BLANK : url);
  /* `setMeshoptDecoder` OR NOTHING — and here it is not even silent. The two
     `hy.*` keys in PROP_KEYS are EXT_meshopt_compression files, `glb()` REJECTS
     on a load error, and PROP_KEYS is loaded through one `Promise.all`, so a
     missing decoder does not lose a bush: it throws out of loadAssets() and the
     island never builds. globe.js carries the same note against its landmark
     loader. */
  await MeshoptDecoder.ready;
  const gltf = new GLTFLoader(manager).setPath('assets/')
    .setMeshoptDecoder(MeshoptDecoder);
  const glb = (p) => new Promise((res, rej) => gltf.load(p, res, undefined, () => rej(new Error(p))));
  /* No 'tree': the nature kit's lollipop was replaced by the crossed-plane
     canopies built in THE FOREST below, so its .glb is no longer fetched. The
     manifest still lists it — assets/ is not this file's to edit. */
  const got = await Promise.all(['tower', 'bridge', 'boat', 'shed']
    .map(k => glb(man['model.' + k].path)));
  ['tower', 'bridge', 'boat', 'shed'].forEach((k, i) => { models[k] = got[i]; });

  /* THE PROP PACK — the scanned .glb props. These are photogrammetry, not kit
     pieces, and their cost is nothing like the Kenney models above: measured on
     this pack, one quiver tree is 82 k triangles, one chainlink fence module
     89 k across 26 meshes, one pipe run 95 k across 106. That is why they are
     drawn only inside PROP_SHELL metres of the lens and under a per-type cap —
     see THE PROPS. Loading them is 47 MB off a local server, once. */
  /* A PROP IS OPTIONAL, THE KIT IS NOT — which is why this uses `glbOpt` and
     the four models above use `glb`. A prop pack can legitimately be absent
     from a checkout (`assets/hunyuan/` is not redistributable and is excluded
     from this repo until it is replaced), and losing a bush must not lose the
     island: with `glb` a single 404 rejected the whole `Promise.all`, threw out
     of loadAssets() and left the page showing nothing but its own fault line.
     Every consumer of `models[k]` below already skips a key it has no model for
     (`if (!models[k]) continue;` in the pool builder), so an absent prop costs
     exactly the prop. A DECODE failure still surfaces, as the note above
     requires: it is logged, not swallowed. */
  const glbOpt = (p) => new Promise(res => gltf.load(p, res, undefined, (e) => {
    console.warn('prop not loaded, drawing without it:', p, e && e.message ? e.message : '');
    res(null);
  }));
  const got2 = await Promise.all(PROP_KEYS.map(k => glbOpt(man['model.' + k].path)));
  PROP_KEYS.forEach((k, i) => { if (got2[i]) models[k] = got2[i]; });
}

async function loadData() {
  try {
    vault = await (await fetch(VAULT_JSON, { cache: 'no-store' })).json();
  } catch (e) {
    /* THE VAULT LAYER IS OPTIONAL and off unless config.json names one, so a
       missing data/vault.json is the SHIPPED state, not a broken install. The
       island then has no land made of notes; the harbour, the towns and every
       road between them are built from the transcripts and still stand. Run
       tools/export_vault.py --vault "..." to give it geography. */
    vault = { notes: [], links: [], timeline: [], counts: {} };
  }
  try {
    const res = await fetch(API_WORLD, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    world = await res.json();
  } catch (e) {
    /* The vault is the land; the towns are the harbour. Without the server the
       land still stands, and saying so beats a blank page. */
    world = { towns: [], roads: [], meta: { towns: 0, live: 0, agents_in_flight: 0 } };
    fault('The world server is not answering, so the harbour is empty. Start it with ' +
          '<code>python server.py</code>.');
  }
  rememberTrade(world.towns);
  await loadPages(world.towns);
  /* And three more reads, four seconds apart, purely to let the server's own
     lazy trade cache fill while the world is still being built. Each one only
     ADDS towns to the map above; none of them rebuilds anything, because
     buildWorld() has not run yet. */
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const r = await fetch(API_WORLD, { cache: 'no-store' });
      if (r.ok) rememberTrade((await r.json()).towns);
    } catch (e) { /* the world already has what it has */ }
  }
  rememberTrade(world.towns);
  await loadPages(world.towns);
}

/* THE TRADE, REMEMBERED. /api/world computes a town's trade lazily under a hard
   two-second wall-clock budget (WORLD_META_BUDGET_SECS in server.py) and hands
   back `null` for every town it did not get to — so a `null` there means "not
   computed yet", NOT "this project has no trade". Measured on this machine:
   the same server answered 46 towns with a trade on a warm cache and 16, 20 and
   31 on three cold reads a minute apart. Overwriting the world payload wholesale
   every thirty seconds therefore kept LOSING landmarks that had already been
   found once.

   So a trade, once seen, is kept. Nothing is invented by this: every value in
   here was read off the project's own files by the server on some earlier call,
   and a town the server has never resolved still has no landmark. */
const knownTrade = new Map();
function rememberTrade(towns) {
  for (const t of towns) {
    if (t.trade && t.trade.type) knownTrade.set(t.id, { trade: t.trade, logo: t.logo });
    else {
      const k = knownTrade.get(t.id);
      if (k) { t.trade = k.trade; if (!t.logo) t.logo = k.logo; }
    }
  }
  return towns;
}

/* THE SITE STRUCTURE, for the towns that have a trade.

   /api/world carries every town's `trade` and `logo` but not its `pages[]` —
   that costs a filesystem walk per project and would put a hundred and forty of
   them in front of the first paint. It is on /api/project/meta instead, one
   town at a time, cached 60 s server-side. So this asks only for the towns the
   landmark grammar can actually shape (forty-six of a hundred and forty-two)
   and only for their pages; a town whose trade has no form gets nothing asked
   about it. TWO at a time: three and six both produced ERR_CONNECTION_RESET on
   this machine, which is a stdlib ThreadingHTTPServer dropping a connection
   under a burst — and a dropped connection is a town silently losing its wings.

   AWAITED, not fired and forgotten: the wings are geometry in an InstancedMesh
   that has to be allocated at exactly its final size, and an instanced mesh
   cannot grow. Measured cost of the whole batch against the live server: see
   RUNBOOK.md. A town whose meta call fails simply has no wings — the landmark
   still stands, which is the honest degradation. */
async function loadPages(towns) {
  const want = towns.filter(t => t.trade && TRADE_FORMS[t.trade.type]);
  let i = 0;
  const worker = async () => {
    while (i < want.length) {
      const t = want[i++];
      /* ONE retry. server.py is a stdlib ThreadingHTTPServer and it drops a
         connection under a burst — measured here as two ERR_CONNECTION_RESET
         out of forty-five on the first run, which is a town silently losing its
         wings rather than an error anybody would see. Retried once after a
         breath, which cleared it. */
      for (let att = 0; att < 2; att++) {
        try {
          const r = await fetch(API_META + encodeURIComponent(t.id), { cache: 'no-store' });
          if (!r.ok) break;
          const m = await r.json();
          t.pages = Array.isArray(m.pages) ? m.pages : [];
          break;
        } catch (e) {
          if (att) break;                       // no pages; the landmark still stands
          await new Promise(r => setTimeout(r, 220));
        }
      }
    }
  };
  /* Three at a time, not six: six was where the stdlib server started resetting
     connections on this machine. Forty-five towns at three deep is under a
     second against a warm 60 s meta cache. */
  await Promise.all([worker(), worker()]);
  return want.length;
}

/* The 30 s re-read. If the set of towns has not changed this only re-applies the
   live state — rebuilding a hundred thousand instances every half minute for a
   changed tool count would be the most expensive no-op on the page. */
async function loadWorldOnly() {
  let data;
  try {
    const res = await fetch(API_WORLD, { cache: 'no-store' });
    if (!res.ok) return;
    data = await res.json();
  } catch (e) { return; }
  /* The signature includes each town's TRADE, not only its id. /api/world fills
     trade lazily under a two-second wall-clock budget, so a cold server answers
     the first call with a hundred nulls and the real types arrive over the next
     few reads — measured here as 20 landmarks on the first load against 45 once
     the server's own cache had filled. Keying the rebuild on ids alone meant
     those twenty-five towns kept their generic quarter for the life of the
     page. */
  const sig = (ts) => ts.map(t => t.id + ':' + ((t.trade && t.trade.type) || '')).sort().join();
  const before = sig(world.towns);
  rememberTrade(data.towns);
  const same = world.towns.length === data.towns.length && before === sig(data.towns);
  world = data;
  dom.fault.hidden = true;
  /* Only when the set of towns actually changed — the pages of a project do not
     move every thirty seconds, and forty-six filesystem walks twice a minute
     for a number that never changes is the most expensive kind of no-op. */
  if (!same) { await loadPages(world.towns); rebuildHarbour(); }
  else for (const t of data.towns) applyLive(t);
  recount();
  /* The agent list is what this poll most often changes, and life.js re-targets
     every robot on the call — docs/LIFE.md, note 4. */
  pushLiveAgentsToLife();
}


/* =============================================================================
   SKY, SUN, SEA — the light follows the real clock
   ========================================================================== */
/* The dome, on its own. Built twice now: once over the world and once over the
   inside of a landmark, because a CSS3D/WebGL scene cannot share a mesh with
   another scene and the light through a practice-room window has to be the same
   hour as the light on the roof above it. Every dome built here is registered in
   `skies`, and updateSun() writes the same four values into all of them. */
const skies = [];

function makeSkyDome() {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  /* Tuned for DUSK, which is the hour this world is nearly always seen at.
     turbidity 9 (was 6) thickens the air so the warm band climbs off the horizon
     into the lower sky instead of sitting on it as a stripe; rayleigh 1.7 (was
     2.4) keeps the zenith a deep blue rather than washing the whole dome warm;
     mieDirectionalG 0.88 tightens the forward scatter into a real glow around
     the sun's own disc, which the bloom pass then blooms. */
  sky.material.uniforms.turbidity.value = 4.5;
  sky.material.uniforms.rayleigh.value = 2.9;
  sky.material.uniforms.mieCoefficient.value = 0.005;
  sky.material.uniforms.mieDirectionalG.value = 0.86;
  /* Two things the addon's Preetham sky cannot do on its own, patched into its
     fragment shader the same guarded way the sea's depth is — check the string
     first, and if a future three renames it, the sky is exactly what it was.

     1. HAZE ALL THE WAY ROUND THE RIM. Preetham lights the sky near the sun and
        leaves the rest of the horizon nearly black. At dusk the whole rim of the
        sky is lit, and without it a camera pointed away from the sunset has the
        island standing in a void — which is what the third capture showed, and
        it is the same note the session city's own sky shader carries.
     2. A HORIZON THAT MEETS THE SEA. Below the horizon the dome is dark, while
        the sea at infinity is the fog's colour, so the two drew a hard ruled
        line across the frame. Fading the dome to the fog colour below the
        horizon makes the join exact by construction, at any hour. */
  const sf = sky.material.fragmentShader;
  const HOOK = 'gl_FragColor = vec4( texColor, 1.0 );';
  if (sf.indexOf(HOOK) >= 0) {
    sky.material.uniforms.uHaze = { value: new THREE.Color(0x7d5a52) };
    sky.material.uniforms.uGlow = { value: new THREE.Color(0xffb066) };
    sky.material.uniforms.uHazeAmt = { value: 0.5 };
    sky.material.fragmentShader = sf
      .replace('uniform float time;',
               'uniform float time;\nuniform vec3 uHaze;\nuniform float uHazeAmt;')
      .replace('uniform vec3 uHaze;', 'uniform vec3 uHaze;\nuniform vec3 uGlow;')
      .replace(HOOK, `
        /* The horizon mix FIRST, the haze and the glow after it. The other way
           round the sky above the horizon carried the sunset and the sky below
           it was flat fog, and the two met as a ruled line across the frame —
           the same hard edge, moved. Both terms use abs(direction.y), so they
           are symmetric about the horizon and the join is continuous. */
        texColor = mix(uHaze, texColor, smoothstep(-0.02, 0.22, direction.y));
        float rim = 1.0 - smoothstep(0.0, 0.32, abs(direction.y));
        texColor += uHaze * rim * uHazeAmt;
        /* And a wide bloom of the sun's OWN colour along the rim it is setting
           on, so a camera looking anywhere within a quadrant of the sunset gets
           the warm side of the sky. Wide, and never a disc: a disc in frame
           would blow out the island the shot is about. */
        float toSun = max(dot(direction, vSunDirection), 0.0);
        texColor += uGlow * rim * pow(toSun, 2.2) * uHazeAmt * 2.1;
        ` + HOOK);
  }
  skies.push(sky);
  return sky;
}

/* The interior asks for its own dome through this — Interior.attach()'s
   `createSky`, exactly as city.js supplies it. */
function createSky() { return makeSkyDome(); }

function buildSky() {
  sky = makeSkyDome();
  scene.add(sky);

  /* One directional light with a soft shadow, plus a hemisphere fill. Two lights
     for a whole world: every extra one multiplies the fragment cost of every
     instanced material on screen, and at this altitude nothing is close enough
     to need a third. */
  sunLight = new THREE.DirectionalLight(0xffd9a8, 2.2);
  sunLight.castShadow = true;
  /* 1536, not 2048. The shadow map is re-rendered from the sun every frame and
     its cost is its area: 1536² is 56% of the pixels 2048² is. What the map has
     to resolve is a building's own edge at a camera distance of 900 units, and
     the box it covers is fitted to the lens in updateSun() — so the texel size
     ON SCREEN, which is the number that decides whether an edge is a staircase,
     barely moves. Measured: see the fps table in docs/HANDOFF.md. */
  sunLight.shadow.mapSize.set(1536, 1536);
  /* A soft edge, not a hard one. PCFSoftShadowMap gives the filter; the radius
     is what makes a dusk shadow spread the way a low sun's does. */
  sunLight.shadow.radius = 2.4;
  /* normalBias 3, not 0.6: the terrain's cells are 3 world units across and the
     sun at dusk grazes them, which put textbook shadow acne — evenly spaced
     bands running along the contours — over the whole Knowledge mountain. It
     looked exactly like a texture problem and three texture fixes did nothing to
     it. The bias has to be bigger than a cell, not bigger than a millimetre. */
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 3.0;
  const c = sunLight.shadow.camera;
  c.left = -170; c.right = 170; c.top = 170; c.bottom = -170; c.near = 1; c.far = 900;
  scene.add(sunLight, sunLight.target);

  /* The fill is the HDRI, not this. A hemisphere light is one colour from above
     and one from below with nothing in between, which lights every face of every
     box to the same flat value — the exact look the verdict called a diorama.
     The PMREM'd dusk HDRI knows where the sun set and how bright the sea is, so
     a north wall and a west wall are different colours for the right reason.
     This stays only as a floor under it, at a quarter of its old strength, so
     nothing in shadow is ever pure black. */
  hemi = new THREE.HemisphereLight(0x9fc4d8, 0x2a2318, 0.14);
  scene.add(hemi);

  /* The stars are the night's only decoration and they are switched by the same
     sun angle everything else is. */
  scene.add(buildStars());

  /* The seabed, as a texture, so the sea can know how deep it is over any point
     of the island. 256²: the shallows are tens of metres wide, and the surf line
     this feeds is three metres — a finer grid buys nothing and costs 65k more
     heightAt() calls. Built once; the ground never moves. */
  bedTex = buildHeightTexture(256);
  buildSea();
}

function buildSea() {
  if (water) { scene.remove(water); water.geometry.dispose(); water.material.dispose(); }
  /* MEDIUM HAS NO REFLECTOR AT ALL. The planar reflection is a second render of
     the whole scene every frame, and the bisection put it at eleven fps of a
     twenty-nine fps budget — far and away the most expensive thing here. Medium
     exists so a loaded machine can still show this world; a second scene pass is
     the first thing that has to go. buildCheapWater() takes its sheet of sky
     from the PMREM'd HDRI through a Fresnel term instead, which is where a
     reflection at this grazing angle comes from anyway. */
  if (quality !== 'high') {
    water = buildCheapWater(tex.waterNormal, 30000, bedTex);
    scene.add(water);
    return;
  }
  /* 30,000 units, not 8,000 and certainly not the original 2,700. The sea has to
     end past the point the air stops being transparent, and with an EXPONENTIAL
     fog that point is a long way out: at 8,000 the far edge still kept a sixth
     of its own dark colour. It is one plane either way and the geometry costs
     two triangles, so it is set past the camera's far plane and the far plane
     is what decides where the water stops. */
  /* 256, not 512: the reflection is a second render of the whole scene, and it
     is the second most expensive thing in the frame (48 fps without the sea
     against 38 with). It is seen at a grazing angle through a normal-mapped
     distortion, where half the resolution cannot be told apart. */
  water = buildWater(Water, tex.waterNormal, 30000, 256, bedTex);
  /* The reflection is a second render of the whole scene, so what it is allowed
     to see is the whole cost. Terrain and structures only: they are the harbour
     front and the mountain, which is all a reflection at a grazing angle
     actually shows. Trees, roads, drones, smoke, traffic and the road ribbons
     all cost a second pass each and none of them survives the normal-mapped
     distortion at 256 px. */
  const inner = water.onBeforeRender;
  let reflFrame = 0;
  water.onBeforeRender = function (r, s, cam) {
    /* EVERY OTHER FRAME. The reflection is a second render of the whole scene,
       and on the loaded box it was still the most expensive single thing left
       — six fps of a forty fps budget after the terrain and the medium-quality
       water had already been dealt with. What it shows is the sky and the
       harbour front, seen at a grazing angle through a normal-mapped
       distortion, over a camera that orbits at 0.02 rad/s. At 30 Hz that
       reflection is one two-hundredth of a degree stale. The render target
       simply keeps the previous frame, so there is nothing to blend and nothing
       that can flicker. */
    if ((reflFrame++ & 1) === 1) return;
    const hide = [groups.forest, groups.drones, groups.roads, groups.traffic,
                  groups.smoke, groups.cranesGroup];
    const was = hide.map(g => g && g.visible);
    hide.forEach(g => { if (g) g.visible = false; });
    inner.call(this, r, s, cam);
    hide.forEach((g, i) => { if (g) g.visible = was[i]; });
  };
  scene.add(water);
}

function buildStars() {
  const n = 700, pos = new Float32Array(n * 3), sz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    /* Deterministic: a star field that reshuffles between two screenshots of the
       same view is a tell. */
    const a = (hash32('star' + i) % 100000) / 100000 * Math.PI * 2;
    const b = (hash32('starb' + i) % 100000) / 100000;
    const y = 0.06 + b * 0.94;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 1600;
    pos[i * 3 + 1] = y * 1600;
    pos[i * 3 + 2] = Math.sin(a) * r * 1600;
    sz[i] = 1.4 + b * 2.6;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  stars = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uNight: { value: 0 } },
    vertexShader: `attribute float aSize; void main(){
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      gl_PointSize = aSize; }`,
    fragmentShader: `uniform float uNight; void main(){
      gl_FragColor = vec4(0.82,0.86,1.0, uNight * 0.85); }`,
  }));
  stars.frustumCulled = false;
  return stars;
}
let stars;

/** The sky, the sun, the fog and every window in the world, from one angle. */
function updateSun() {
  const now = new Date();
  if (HOUR_OVERRIDE != null) {
    now.setHours(Math.floor(HOUR_OVERRIDE), Math.round((HOUR_OVERRIDE % 1) * 60), 0, 0);
  }
  const ang = sunAngles(now);
  sun.copy(sunVector(now));
  for (const s of skies) s.material.uniforms.sunPosition.value.copy(sun);

  /* Night is a ramp, not a switch: the windows come on while the sun is still
     just above the horizon, which is what golden hour actually looks like. */
  const night = THREE.MathUtils.clamp((0.12 - ang.elevation) / 0.34, 0, 1);
  nightAmount = night;

  sunLight.target.position.copy(camTarget);
  /* At full night the key light does not go out, it becomes the moon: a weak,
     cold, still-directional light. Zero here left the world unreadable as a
     screensaver, which is the one thing it is on screen for. */
  /* A REAL key light at golden hour. sin(elevation) * 2.6 gave the low sun an
     intensity of 0.28 — so at the one hour this world is nearly always seen at,
     nothing in the frame had a key light and every surface was ambient fill,
     which is what "flat even lighting" in the verdict describes. A setting sun
     is not weak; it is low, and the light it throws is long, warm and hard. The
     constant is what carries golden hour, the sine only adds the extra a noon
     sun brings. */
  sunLight.intensity = (1.75 + Math.max(0, Math.sin(Math.max(ang.elevation, 0))) * 1.35)
                       * (1 - night * 0.93) + night * 0.30;
  sunLight.color.setHSL(0.095 - Math.max(0, ang.elevation) * 0.05, 0.48 - Math.max(0, ang.elevation) * 0.24, 0.66);
  if (night > 0.5) sunLight.color.lerp(new THREE.Color(0x9fb4d8), (night - 0.5) * 2);
  /* The shadow box follows the camera AND its distance. A fixed box big enough
     for the whole world at 2048² is half a metre per texel and every shadow is a
     staircase; a fixed box tight enough to be sharp covers a third of the wide
     shot and the far half of the island has no shadows in it at all — which is
     most of why the mountain read flat. Fitting the box to what the lens can
     actually see keeps the texel size near constant ON SCREEN, which is the
     thing that matters. */
  const half = THREE.MathUtils.clamp(cam.dist * 0.44, 130, 520);
  const sc = sunLight.shadow.camera;
  if (Math.abs(sc.right - half) > 4) {
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.far = 400 + half * 2.2;
  }
  sunLight.position.copy(sun).multiplyScalar(Math.max(320, half * 1.5)).add(camTarget);
  sunLight.shadow.camera.updateProjectionMatrix();

  hemi.intensity = 0.78 - night * 0.42;
  hemi.color.setHex(night > 0.5 ? 0x2b3c56 : 0x9fc4d8);

  /* The ambient light of the whole world, and the only one with any structure
     in it. envDusk/envNight are PMREM mip chains, prepared once at load. */
  scene.environment = night > 0.55 ? envNight : envDusk;
  scene.environmentIntensity = 1.4 - night * 0.95;

  /* The haze takes the sky's own colour at the horizon, warm while the sun is
     setting and blue-black once it is down, and it THINS at night: a night with
     as much haze as a dusk swallows the lit windows the night shot is about. */
  /* DESATURATED. 0xc0653a is a strong orange, and an exponential fog in a
     strong orange puts that orange on every surface in the frame in proportion
     to its distance — the whole picture came back one hue, which is exactly what
     it does NOT do next to the session city, whose haze is a grey-mauve and
     whose windows are the only saturated thing in it. This is the session city's
     own dusk fog colour, and the reason the warm and the cool can coexist. */
  const fogNear = new THREE.Color(0x3a3740).lerp(new THREE.Color(0x0d1420), night);
  const dusk = new THREE.Color(0x7d5a52).lerp(new THREE.Color(0x131c2e), night);
  scene.fog.color.copy(dusk.lerp(fogNear, 0.4));
  scene.fog.density = 0.00050 - night * 0.00018;
  for (const s of skies) {
    if (!s.material.uniforms.uHaze) continue;
    s.material.uniforms.uHaze.value.copy(scene.fog.color);
    s.material.uniforms.uGlow.value.copy(sunLight.color);
    s.material.uniforms.uHazeAmt.value = 1.45 - night * 1.15;
  }
  /* The inside of a landmark takes the same environment map the outside does,
     so a plaster wall indoors reflects the same dusk. One assignment; three
     will not PMREM anything twice. */
  const inScene = Interior.getScene();
  if (inScene) {
    inScene.environment = scene.environment;
    /* A THIRD of the world's. The environment map is the whole sky's light
       arriving from every direction, which is what an open coast gets and what a
       room with four walls and five windows does not. At full strength the first
       capture of the concert hall came back as white card with furniture in it. */
    inScene.environmentIntensity = scene.environmentIntensity * 0.34;
  }
  renderer.toneMappingExposure = 0.85 - night * 0.22;
  if (stars) stars.material.uniforms.uNight.value = night;
  /* Only the reflective sea carries these two: the cheap one takes its sun from
     the same directional light every other material does, and its body colour
     from the seabed. Guarded rather than duplicated, so a quality toggle can
     never leave the two seas lit differently at the same hour. */
  if (water && water.material.uniforms && water.material.uniforms.sunDirection) {
    water.material.uniforms.sunDirection.value.copy(sun).normalize();
    water.material.uniforms.waterColor.value.setHex(night > 0.5 ? 0x081722 : 0x11303c);
  } else if (water) {
    water.material.color.setHex(night > 0.5 ? 0x081722 : 0x11303c);
  }
  /* THE LAMPS come on before the dark does. night is the SKY ramp — it is what
     the fog, the exposure and the moon follow, and by the time it is anywhere
     near 1 the frame is a night shot. A window is switched by a person who
     cannot read any more, which happens while the sun is still on the horizon.
     Separating the two is what gives the dusk frame its warm accents against a
     cool ground — the one thing the session city has that this did not. */
  const lamps = THREE.MathUtils.clamp((0.34 - ang.elevation) / 0.42, 0, 1);
  for (const m of litMaterials) m.userData.uNight.value = lamps;
  /* ONE CLOCK for the kit town too — integration note 5. setNight() drives the
     window emissive and the glass tint across every kit building at once, and
     it rides the same lamp ramp the world's own windows do rather than adding a
     second sun. */
  if (kit) {
    kit.setNight(lamps);
    /* setEnvironment() marks every kit material for recompilation, so it is
       called only when the world actually swapped HDRIs — twice a day, not
       twice a second. */
    if (scene.environment !== kitEnv) { kitEnv = scene.environment; kit.setEnvironment(kitEnv); }
  }
  /* THE SAME ONE CLOCK for the living layer and the fleet. One call each, for
     the whole population: headlights on, birds looking for a roost, the herd
     lying down, and every craft's nav lights and cabin glow — docs/LIFE.md
     integration note 5, docs/DRONES.md note 8. */
  if (life) life.setNight(lamps);
  if (droneKit) {
    droneKit.setNight(lamps);
    if (scene.environment !== droneEnv) { droneEnv = scene.environment; droneKit.setEnvironment(droneEnv); }
  }
  setLampPower(lamps);
}
let nightAmount = 0;
const litMaterials = [];


/* =============================================================================
   MATERIALS — the pack's PBR maps, tiled at real-world scale
   Two families, and one shared trick.

   makeWallMaterial: a box's own uv is 0..1 per face, so a 3 m wall and a 30 m
   wall would show the same number of bricks. The instance's size is uploaded as
   an attribute and the uv is scaled by it in the vertex shader — three texture
   samples, exact tiling, no triplanar.

   Lit windows are computed in the fragment shader from that same world-scaled
   uv: a grid of cells, a hash per cell, and a per-instance seed. Geometry for
   half a million windows is not a thing an integrated GPU does.
   ========================================================================== */
function makeWallMaterial(surface, opts = {}) {
  const s = tex[surface];
  const mat = new THREE.MeshStandardMaterial({
    map: s.diffuse, normalMap: s.normal, roughnessMap: s.arm, aoMap: s.arm,
    roughness: 1.0, metalness: 0.0, color: opts.tint || 0xffffff,
    envMapIntensity: 0.5, side: opts.side || THREE.FrontSide,
  });
  const uNight = { value: 0 };
  mat.userData.uNight = uNight;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.uniforms.uTile = { value: s.tile };
    sh.uniforms.uWindows = { value: opts.windows ? 1 : 0 };
    /* The trick: instead of rewriting map/normal/roughness/ao chunk by chunk,
       OVERWRITE the uv varyings the stock chunks already read. Three then does
       all four maps, the tangent frame and the ARM channel unpacking for us,
       correctly, at world scale — and this material stays four lines of glsl
       plus the windows. */
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aSize; attribute float aLit; attribute float aSeed;
        uniform float uTile;
        varying float vLit; varying float vSeed; varying float vSide; varying vec2 vTileUv;
        /* This face's real size in metres. The facade below is drawn in metres —
           a plinth is half a metre whatever the building is — and without the
           face's own dimensions every band would scale with the box and a
           warehouse would get a two-metre skirting board. */
        varying vec2 vFace;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        /* Which face this vertex is on decides which two of the instance's three
           dimensions the texture has to tile across — a 3 m wall and a 30 m wall
           must not show the same number of bricks. */
        vec2 tileSize = abs(normal.y) > 0.5 ? aSize.xz
                      : (abs(normal.x) > 0.5 ? aSize.zy : aSize.xy);
        vTileUv = uv * tileSize / uTile;
        vMapUv = vTileUv; vNormalMapUv = vTileUv; vRoughnessMapUv = vTileUv; vAoMapUv = vTileUv;
        vLit = aLit; vSeed = aSeed; vSide = 1.0 - step(0.5, abs(normal.y)); vFace = tileSize;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; uniform float uWindows; uniform float uTile;
        varying float vLit; varying float vSeed; varying float vSide; varying vec2 vTileUv;
        varying vec2 vFace;
        float cellHash(vec2 c){ return fract(sin(dot(c, vec2(41.7, 289.3))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        /* Every instance a slightly different shade of its own material. A
           hundred houses cut from one colour read as one stamped copy; half a
           stop of variation is the difference between a district and a texture. */
        float hv = cellHash(vec2(vSeed * 91.0, 3.0));
        diffuseColor.rgb *= 0.66 + 0.62 * hv;
        /* and each one tipped a little warm or a little cool, which is what a
           street of houses rendered and re-rendered over forty years looks like */
        diffuseColor.rgb *= mix(vec3(1.06, 0.99, 0.90), vec3(0.93, 0.99, 1.05),
                                cellHash(vec2(vSeed * 17.0, 9.0)));

        /* THE FACADE. Every building in the first pass was a correctly textured
           box, and a box is what it read as — the verdict's "boxes without
           facades". What separates a building from a box is four horizontal
           events at known heights in METRES, none of which the box's own
           geometry has to carry: a dark plinth where it meets the ground, a
           cornice line at the top of the ground floor, an eaves band shaded by
           the roof it stands under, and a door.

           All four are drawn in the shader, on the SIDE faces only. Geometry for
           six hundred plinths, cornices and doors is six hundred more draw calls
           and a modelling job; this is eight lines, and it is the same eight
           lines whether the world has six buildings or six thousand. */
        float paneMask = 0.0;
        if (vSide > 0.5) {
          float mX = vTileUv.x * uTile;          // metres along this face
          float mY = vTileUv.y * uTile;          // metres up this face
          /* Plinth: where a wall meets the ground it is always darker and
             dirtier than the wall above it. */
          diffuseColor.rgb *= mix(1.0, 0.54, 1.0 - smoothstep(0.35, 0.95, mY));
          /* Cornice: a thin light band at the top of the ground floor, 3.1 m up,
             on anything tall enough to have a second storey. */
          float cornice = (1.0 - smoothstep(0.10, 0.20, abs(mY - 3.1))) * step(4.6, vFace.y);
          diffuseColor.rgb *= 1.0 + cornice * 0.42;
          /* Eaves: the roof overhangs, so the top band of wall stands in its
             shadow at every hour. This is the shading the overhang would cast
             and that a 1.22 roof scale cannot, because the sun at dusk comes in
             almost level and casts it sideways instead of down. */
          diffuseColor.rgb *= mix(1.0, 0.46, smoothstep(vFace.y - 0.85, vFace.y - 0.10, mY));
          /* One door per face, centred, two metres tall. A door is the only
             thing in the frame that says how big the building is. */
          float door = (1.0 - step(0.62, abs(mX - vFace.x * 0.5))) * (1.0 - step(2.05, mY));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.10, 0.08), door * 0.85);
          if (uWindows > 0.5) {
            /* The window grid, computed ONCE here so the glass can be dark by day
               and the same panes can be lit at night below. A wall with no
               openings by day is a card with a texture on it; this row of dark
               rectangles is what makes it a building.

               TWO RHYTHMS, chosen by the instance's own seed. Every building in
               the harbour capture carried the identical 1.7 x 1.5 m grid, and a
               window grid is the finest-grained thing on a facade — repeat it a
               hundred times and the eye reads one stamped copy however the walls
               are tinted. The wide rhythm is 2.4 m: two windows where the tight
               one has three, which is a difference visible at the wide shot.
               Derived from vSeed rather than carried as an attribute on purpose:
               the facade shader already stands on sixteen vertex attributes and
               a seventeenth does not link (see HANDOFF, the interiors pass). */
            float wide = step(0.5, fract(vSeed * 13.0));
            float px = mix(1.7, 2.4, wide);
            vec2 gg = vec2(mX / px, mY / 1.5);
            vec2 f = fract(gg);
            float paneW = mix(0.28, 0.22, wide);
            paneMask = step(paneW, f.x) * step(f.x, 1.0 - paneW) * step(0.30, f.y) * step(f.y, 0.82)
                     * step(2.3, mY) * (1.0 - step(vFace.y - 0.6, mY))
                     * step(0.35, cellHash(floor(gg) + vSeed * 37.0));
            diffuseColor.rgb = mix(diffuseColor.rgb,
                                   diffuseColor.rgb * 0.20 + vec3(0.045, 0.052, 0.070),
                                   paneMask * 0.88);
            /* SHUTTERS, on about half the buildings: a dark board flanking each
               pane, the same height as the pane and half its width. It is the
               one detail that separates a north-European facade from a plain
               curtain wall, and it costs the two steps below. */
            float hasShutters = step(0.55, fract(vSeed * 29.0));
            float band = step(0.30, f.y) * step(f.y, 0.82)
                       * step(2.3, mY) * (1.0 - step(vFace.y - 0.6, mY))
                       * step(0.35, cellHash(floor(gg) + vSeed * 37.0));
            float shutter = band * hasShutters
                          * max(step(paneW * 0.45, f.x) * (1.0 - step(paneW, f.x)),
                                step(1.0 - paneW, f.x) * (1.0 - step(1.0 - paneW * 0.45, f.x)));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.17, 0.13), shutter * 0.80);
          }
        }`)
      .replace('#include <emissivemap_fragment>', `
        /* The light behind the glass. Exactly the panes the facade above cut, so
           a window that is dark by day is the one that lights at night — and two
           in five of THOSE, because a building with every window on is a render
           and not an evening. */
        if (paneMask > 0.0) {
          /* The SAME rhythm the pane was cut with, or the lit cells and the dark
             cells are two different grids and every wide-rhythm building lights
             windows that are not there. */
          float lw = step(0.5, fract(vSeed * 13.0));
          vec2 gl = floor(vec2(vTileUv.x * uTile / mix(1.7, 2.4, lw), vTileUv.y * uTile / 1.5));
          float on = step(0.55, cellHash(gl + vSeed * 71.0));
          totalEmissiveRadiance += vec3(1.0, 0.66, 0.28) * paneMask * on * uNight * vLit * 4.2;
        }`);
  };
  mat.customProgramCacheKey = () => 'wall-' + surface + (opts.windows ? '-win' : '');
  litMaterials.push(mat);
  return mat;
}

/* Triplanar, for the Kenney models. Their uv is an atlas the pack's textures
   know nothing about, so the texture is projected from three directions in
   object space instead. Only the landmarks use this — thirteen towers, forty-five
   bridges — so three samples instead of one is a trade that never shows up in
   the frame time. Without it they read as plastic toys, which is the one thing
   the brief names them as placeholders against. */
function makeTriplanarMaterial(surface, tint) {
  const s = tex[surface];
  const mat = new THREE.MeshStandardMaterial({
    map: s.diffuse, roughnessMap: s.arm, roughness: 1.0, metalness: 0.0,
    color: tint || 0xffffff, envMapIntensity: 0.45,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTile = { value: s.tile };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObj; varying vec3 vObjN;\nuniform float uTile;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position / uTile; vObjN = normalize(normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObj; varying vec3 vObjN;
        vec3 triplanar(sampler2D t, vec3 p, vec3 n){
          vec3 w = pow(abs(n), vec3(4.0));
          w /= max(1e-4, w.x + w.y + w.z);
          return texture2D(t, p.yz).rgb * w.x
               + texture2D(t, p.xz).rgb * w.y
               + texture2D(t, p.xy).rgb * w.z; }`)
      .replace('#include <map_fragment>',
        'diffuseColor.rgb *= triplanar(map, vObj, vObjN) * 1.3;')
      .replace('#include <roughnessmap_fragment>',
        'float roughnessFactor = roughness * triplanar(roughnessMap, vObj, vObjN).g;');
  };
  mat.customProgramCacheKey = () => 'triplanar-' + surface;
  return mat;
}


/* =============================================================================
   GEOMETRY POOLS
   Everything that repeats is one InstancedMesh. 1,300 buildings as 1,300 meshes
   is 1,300 draw calls on an integrated Radeon; as six instanced meshes it is six.
   ========================================================================== */
const groups = {};
const pools = {};

/** A unit box standing on the ground, so an instance matrix's scale IS its size
    in metres and its position IS where it stands. */
function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** A hip roof: a prism, unit footprint, apex at y=1. */
function roofGeo() {
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,   // 0..3 eaves
    -0.18, 1, 0, 0.18, 1, 0,                                    // 4,5 ridge
  ];
  const idx = [0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 1, 2, 5, 3, 0, 4];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  /* A hand-built geometry has no uv, and the wall material's world-scaled uv
     needs one. Planar from x/z is right for a roof seen from above. */
  const uv = [];
  for (let i = 0; i < p.length; i += 3) uv.push(p[i] + 0.5, p[i + 2] + 0.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** An InstancedMesh with the three per-instance attributes every wall material
    reads, and a records table so a raycast can say what was clicked. */
function pool(name, geo, mat, max, castShadow) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.count = 0;
  m.castShadow = !!castShadow;
  m.receiveShadow = true;
  m.frustumCulled = false;
  const add = (attr, size) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(attr, a);
    return a;
  };
  m.userData.aSize = add('aSize', 3);
  m.userData.aLit = add('aLit', 1);
  m.userData.aSeed = add('aSeed', 1);
  m.userData.records = [];
  m.name = name;
  pools[name] = m;
  return m;
}

/** One placement into a pool. Returns the instance index, which the record
    keeps so a live update can relight exactly that building. */
const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler();
const _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function put(p, x, y, z, w, h, d, rot, lit, seed, record) {
  const i = p.count;
  if (i >= p.instanceMatrix.count) return -1;
  _e4.set(0, rot, 0);
  _m4.compose(_v3.set(x, y, z), _q4.setFromEuler(_e4), _s3.set(w, h, d));
  p.setMatrixAt(i, _m4);
  p.userData.aSize.setXYZ(i, w, h, d);
  p.userData.aLit.setX(i, lit);
  p.userData.aSeed.setX(i, seed);
  p.userData.records[i] = record;
  p.count = i + 1;
  return i;
}
function commit(p) {
  p.instanceMatrix.needsUpdate = true;
  p.userData.aSize.needsUpdate = true;
  p.userData.aLit.needsUpdate = true;
  p.userData.aSeed.needsUpdate = true;
  p.computeBoundingSphere();
}


/* =============================================================================
   THE KENNEY MODELS, INSTANCED
   Each GLB is flattened to its meshes, normalised to one metre tall standing on
   the ground, and turned into one InstancedMesh per source mesh, all sharing the
   same matrices. That keeps the model's own parts (a tower's roof and its walls)
   while still costing one draw call each.
   ========================================================================== */
/* The Kenney kits ship their colour as an external Textures/colormap.png that is
   NOT in this pack (checked: the .glb references it, the file is not there), so
   every model that uses it arrives pure white. The castle, town and pirate kits
   are re-materialed with the pack's PBR textures anyway; the nature kit's tree
   is the one that keeps its own materials, and its named colours are a mint
   green and a salmon bark that belong to a cartoon. Both are retinted here to
   something a forest at dusk can be made of. */
const MODEL_TINTS = {
  _defaultMat: 0x4a5c3a,
  colormap:    0x8a7a63,
};

function instanceModel(gltf, max, override, merge) {
  let src = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (o.isMesh) src.push({ geo: o.geometry.clone().applyMatrix4(o.matrixWorld), mat: o.material });
  });
  /* MERGE BY MATERIAL, for the scanned props only. instanceModel makes one
     InstancedMesh per source mesh, which is right for a Kenney model of three
     parts and ruinous for a scanned one: the chainlink fence arrives as 26
     meshes and the pipe run as 106, so a single pipe would cost 106 draw calls
     before a second one is placed. Merging them by material makes both two.
     Guarded, not assumed — mergeGeometries returns null when the attribute sets
     differ, and an unmerged prop is slow, not broken. */
  if (merge && src.length > 1) {
    const byMat = new Map();
    for (const s of src) {
      const k = s.mat ? s.mat.uuid : 'none';
      if (!byMat.has(k)) byMat.set(k, { mat: s.mat, geos: [] });
      byMat.get(k).geos.push(s.geo);
    }
    const merged = [];
    for (const b of byMat.values()) {
      if (b.geos.length === 1) { merged.push({ geo: b.geos[0], mat: b.mat }); continue; }
      /* Every geometry in one merge has to carry the same attributes, so the
         intersection is taken first — one mesh in the pack missing a uv2 would
         otherwise fail the whole merge and hand back 26 draw calls. */
      let keep = Object.keys(b.geos[0].attributes);
      for (const g of b.geos) keep = keep.filter(a => g.attributes[a]);
      for (const g of b.geos) for (const a of Object.keys(g.attributes)) if (!keep.includes(a)) g.deleteAttribute(a);
      const g = mergeGeometries(b.geos, false);
      if (g) merged.push({ geo: g, mat: b.mat });
      else for (const gg of b.geos) merged.push({ geo: gg, mat: b.mat });
    }
    src = merged;
  }
  /* Normalise: base on the ground, one unit tall, centred in x/z. */
  const box = new THREE.Box3();
  for (const s of src) { s.geo.computeBoundingBox(); box.union(s.geo.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(1e-3, size.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const parts = [];
  for (const s of src) {
    s.geo.translate(-cx, -box.min.y, -cz);
    s.geo.scale(k, k, k);
    let mat = override || s.mat;
    /* THE SCANNED PROPS KEEP THEIR OWN MAPS. The branch below was written for
       the Kenney kits, whose colour lives in an external Textures/colormap.png
       that this pack does not ship — so it nulls `map` and retints. A Poly Haven
       scan carries its albedo, normal and roughness INSIDE the .glb, and nulling
       its map turns a quiver tree into a white flare eight metres wide, which is
       exactly what the first street capture of this pass came back as. All these
       need is the env intensity taken down to the level the rest of this world
       is lit at. */
    if (merge && mat && mat.isMeshStandardMaterial) {
      mat = mat.clone();
      mat.envMapIntensity = 0.5;
    } else if (!override && mat && mat.isMeshStandardMaterial) {
      /* Cloned and retinted, not replaced — a tree textured with cobble is worse
         than a tree that is simply the right colour and properly lit. */
      mat = mat.clone();
      if (MODEL_TINTS[mat.name] != null) mat.color.setHex(MODEL_TINTS[mat.name]);
      mat.map = null;                       // the atlas it points at is not in the pack
      mat.envMapIntensity = 0.35;
      mat.roughness = 0.94;
      mat.metalness = 0;
    }
    const im = new THREE.InstancedMesh(s.geo, mat, max);
    im.count = 0;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    parts.push(im);
  }
  return {
    parts,
    records: [],
    place(x, y, z, rot, scale, record) {
      const i = parts[0].count;
      if (i >= max) return -1;
      _e4.set(0, rot, 0);
      _m4.compose(_v3.set(x, y, z), _q4.setFromEuler(_e4), _s3.set(scale, scale, scale));
      for (const p of parts) { p.setMatrixAt(i, _m4); p.count = i + 1; }
      this.records[i] = record;
      return i;
    },
    commit() { for (const p of parts) { p.instanceMatrix.needsUpdate = true; p.computeBoundingSphere(); } },
    reset() { for (const p of parts) p.count = 0; this.records.length = 0; },
  };
}



/* =============================================================================
   THE FOREST — three tree types, built here, out of crossed planes
   The pack's nature kit ships ONE tree: a brown stick under a green ball. Two
   thousand copies of it, all the same shape and all the same colour, is the
   single loudest "this is a toy" in the whole frame — it is the lollipop every
   board game is made of, and no amount of light fixes a silhouette.

   What a forest actually looks like from 300 m is a MASS with a ragged edge and
   a hundred shades of green in it. That is a texture problem, not a geometry
   one, so each canopy here is two or three crossed quads carrying a leaf-cluster
   alpha drawn at load; the ragged edge is in the alpha, the colour spread is per
   instance, and the shape spread is three types placed by height.

   WHY the alpha is DRAWN and not fetched: the CC0 pack has no leaf texture, this
   file already owns the tint decisions that make its dry grass green, and four
   hundred ellipses on a canvas is smaller than the PNG would be. Deterministic
   off hash32, like everything else here, so two screenshots match.

   WHY the normals are SPHERIFIED: a flat quad lit by a low sun is a flat card,
   and three flat cards crossed are three flat cards. Pointing each vertex's
   normal away from the canopy's centre instead makes the same six triangles
   shade like a round mass, which is the whole trick and costs nothing.
   ========================================================================== */
const TREE_TYPES = [
  /* Broadleaf on the flats, spruce up the mountain, scrub on the dunes and the
     dry south — the three things that actually grow on a coast with an alp
     behind it. share is the fraction of the forest each takes at sea level.
     `scrub` is also the island's DRY species, and planProps() reads that off
     this key: it is the only one the scanned quiver tree may stand in for. */
  { key: 'broad',   w: 1.06, h: 0.94, cy: 0.62, planes: 3, trunkH: 0.44, trunkR: 0.052,
    tint: 0x7f9c55, blobs: 260, hue: 92,  spread: 22, shape: 'round', share: 0.52 },
  { key: 'conifer', w: 0.66, h: 1.08, cy: 0.54, planes: 3, trunkH: 0.26, trunkR: 0.040,
    tint: 0x4a6b4a, blobs: 230, hue: 132, spread: 16, shape: 'cone',  share: 0.34 },
  { key: 'scrub',   w: 0.90, h: 0.58, cy: 0.32, planes: 2, trunkH: 0.14, trunkR: 0.038,
    tint: 0x8a8f4b, blobs: 150, hue: 70,  spread: 26, shape: 'round', share: 0.14 },
];

/** The leaf-cluster alpha for one type. Hundreds of small ellipses inside a
    silhouette, in a band of greens, with the lower third darkened — a canopy is
    lit from above and shades itself underneath, and baking that in is far
    cheaper than asking the lighting to discover it on a flat quad. */
function leafTexture(t) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < t.blobs; i++) {
    const r1 = (hash32(t.key + 'a' + i) % 10000) / 10000;
    const r2 = (hash32(t.key + 'b' + i) % 10000) / 10000;
    const r3 = (hash32(t.key + 'c' + i) % 10000) / 10000;
    const r4 = (hash32(t.key + 'd' + i) % 10000) / 10000;
    /* v is 0 at the top of the canopy, 1 at the bottom; the silhouette's
       half-width at that height is what makes a cone a cone and a ball a ball. */
    const v = r2;
    const halfW = t.shape === 'cone'
      ? 0.10 + 0.42 * Math.pow(v, 0.78)
      : 0.50 * Math.sqrt(Math.max(0, 1 - Math.pow(v * 2 - 1, 2))) * (0.82 + 0.24 * r3);
    const x = S * (0.5 + (r1 - 0.5) * 2 * halfW);
    const y = S * (0.06 + v * 0.9);
    const rx = 6 + r3 * 15, ry = 5 + r4 * 11;
    /* Darker low, lighter high: the sun is above the tree. */
    const light = 16 + (1 - v) * 26 + r4 * 12;
    g.save();
    g.translate(x, y);
    g.rotate(r1 * 6.283);
    g.fillStyle = 'hsl(' + (t.hue + (r3 - 0.5) * t.spread) + ',' +
                  (30 + r4 * 26) + '%,' + light + '%)';
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, 6.2832);
    g.fill();
    g.restore();
  }
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}

/** `planes` crossed quads around the trunk, normalised to one unit tall standing
    on the ground, with spherified normals. */
function canopyGeometry(t) {
  const pos = [], nrm = [], uv = [], idx = [];
  const top = t.cy + t.h / 2, k = 1 / top;      // normalise: total height = 1
  const cn = new THREE.Vector3(), vn = new THREE.Vector3();
  for (let i = 0; i < t.planes; i++) {
    const a = i * Math.PI / t.planes;
    const dx = Math.cos(a) * t.w / 2, dz = Math.sin(a) * t.w / 2;
    const y0 = t.cy - t.h / 2, y1 = t.cy + t.h / 2;
    const corners = [[-dx, y0, -dz], [dx, y0, dz], [dx, y1, dz], [-dx, y1, -dz]];
    const planeN = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const base = i * 4;
    for (let q = 0; q < 4; q++) {
      const cx = corners[q][0], cy = corners[q][1], cz = corners[q][2];
      pos.push(cx * k, cy * k, cz * k);
      /* Away from the canopy's own centre, mostly — the 0.18 of plane normal
         left in keeps a quad seen edge-on from going black. */
      vn.set(cx, cy - t.cy, cz).normalize();
      cn.copy(planeN).multiplyScalar(0.18).addScaledVector(vn, 0.82).normalize();
      nrm.push(cn.x, cn.y, cn.z);
      uv.push(q === 0 || q === 3 ? 0 : 1, q < 2 ? 0 : 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geo: g, trunkH: t.trunkH * k, trunkR: t.trunkR * k };
}

/** All three types, instanced, from one forest list. Returns the group. */
function buildForest(list) {
  const group = new THREE.Group();
  treeSlots.length = 0;
  const share = TREE_TYPES.map(t => t.share);
  /* Which type a tree is comes from its own position, not a counter: the same
     coordinate is the same species on every reload. Above ~34 m the mix walks
     over to conifer, which is what a tree line on the way up an alp looks like. */
  const buckets = TREE_TYPES.map(() => []);
  for (const tr of list) {
    const r = (hash32('sp' + (tr.x | 0) + ':' + (tr.z | 0)) % 10000) / 10000;
    const alp = THREE.MathUtils.clamp((tr.y - 34) / 46, 0, 1);
    const p = alp > 0 ? r * (1 - alp) + (0.52 + r * 0.46) * alp : r;
    let acc = 0, pick = TREE_TYPES.length - 1;
    for (let i = 0; i < share.length; i++) { acc += share[i]; if (p < acc) { pick = i; break; } }
    buckets[pick].push(tr);
  }
  TREE_TYPES.forEach((t, i) => {
    const rows = buckets[i];
    if (!rows.length) return;
    const built = canopyGeometry(t);
    const geo = built.geo;
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTexture(t), color: t.tint,
      /* alphaTest, not transparent: two thousand transparent canopies would need
         sorting every frame and would still overlap wrongly. A cut-out edge at
         this distance is indistinguishable and costs one discard. */
      alphaTest: 0.42, side: THREE.DoubleSide,
      roughness: 0.94, metalness: 0, envMapIntensity: 0.7,
    });
    leafMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying float vSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSeed = aSeed;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSeed;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          /* Per TREE, not per leaf: one stand is a dozen greens because a dozen
             trees are a dozen ages, and that spread is what a forest is. */
          float s = fract(sin(vSeed * 91.7) * 4375.5453);
          diffuseColor.rgb *= 0.70 + 0.56 * s;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.22, 0.96, 0.58), s * 0.5);`);
    };
    leafMat.customProgramCacheKey = () => 'leaf-' + t.key;
    const trunkGeo = new THREE.CylinderGeometry(built.trunkR * 0.72, built.trunkR,
                                                built.trunkH * 2.1, 5)
      .translate(0, built.trunkH * 1.05, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x453626, roughness: 1, metalness: 0, envMapIntensity: 0.3 });
    const canopy = new THREE.InstancedMesh(geo, leafMat, rows.length);
    const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, rows.length);
    const seeds = new THREE.InstancedBufferAttribute(new Float32Array(rows.length), 1);
    geo.setAttribute('aSeed', seeds);
    rows.forEach((tr, n) => {
      const sc = tr.scale * 3.4;
      _e4.set(0, tr.rot, 0);
      /* Not a uniform scale: a stand of trees the same height is a plantation.
         The vertical stretch is independent of the spread, which is what a
         wind-shaped coast looks like. */
      _m4.compose(_v3.set(tr.x, tr.y, tr.z), _q4.setFromEuler(_e4),
                  _s3.set(sc * (0.82 + 0.36 * ((hash32('tw' + n) % 100) / 100)),
                          sc * (0.80 + 0.44 * ((hash32('th' + n) % 100) / 100)),
                          sc * (0.82 + 0.36 * ((hash32('td' + n) % 100) / 100))));
      canopy.setMatrixAt(n, _m4);
      trunk.setMatrixAt(n, _m4);
      seeds.setX(n, (hash32('ts' + (tr.x | 0) + ':' + (tr.z | 0)) % 1000) / 1000);
      /* THE SEAM WITH THE REAL TREES. A card canopy is right at 300 m and is
         two crossed quads at 20; within PROP_SHELL a scanned quiver tree stands
         in its place, and the way one is swapped for the other is this slot —
         the card's own instance index and its own matrix, so it can be scaled
         to nothing and put back byte for byte when the camera leaves. */
      treeSlots.push({ meshes: [canopy, trunk], i: n, m: _m4.clone(), key: t.key,
                       x: tr.x, y: tr.y, z: tr.z, rot: tr.rot, scale: sc, hidden: false });
    });
    for (const m of [canopy, trunk]) {
      m.instanceMatrix.needsUpdate = true;
      m.receiveShadow = true;
      /* Trees do not cast shadows: two thousand alpha-tested canopies into a
         2048² map is a second full depth pass with a discard in it, and it was
         the one measured cost that took the frame rate under the gate. At this
         altitude the shadow a tree casts is a pixel. */
      m.castShadow = false;
      m.frustumCulled = false;
      m.computeBoundingSphere();
      group.add(m);
    }
  });
  return group;
}




/* =============================================================================
   LANDMARKS BY TRADE — a music school has to look like a music school

   The owner's verdict on the third pass was that the harbour quarters were
   "still anonymous boxes", and the request that follows from it is exact: a
   town whose project IS a music school should read as a concert hall from
   across the water, carry that project's own logo on a sign, and show the
   structure of its site as building.

   Everything here is driven by data server.py already reads off the project's
   own files and hands over on /api/world and /api/project/meta:
     · trade.type  a schema.org type found in the project's JSON-LD, or inferred
                   from its BRIEF/README/title. null when the server does not
                   know, and a null town keeps the generic quarter it had.
     · logo        a favicon/apple-touch-icon/og:image inside the project's own
                   root, served back through /api/project/asset.
     · pages[]     the site's own HTML pages, biggest first, capped at 24 —
                   ONE WING EACH, in a ring around the landmark, as tall as the
                   page is big. A site's shape is a real thing about it, and this
                   is the cheapest honest way to show it.

   Nothing is invented: a trade with no form in the table below falls through to
   the generic quarter, a town with no logo gets its NAME on the plaque instead
   of a made-up mark, and a town with no pages gets no wings. Every moving part
   — the flywheel, the saw, the LEDs, the smoke, the notes over the music
   school's chimney — turns only while that town has an agent in it. An idle
   world is a still world, which is the rule the cranes and the chimneys over the
   Dev Logs valley already follow.

   WHY procedural boxes and not modelled .glb: the pack has no concert hall and
   no sawtooth factory, and thirteen downloaded models would be thirteen more
   fetches, thirteen more materials and thirteen silhouettes that do not belong
   to this world's own PBR set. Eight instanced primitives — box, pitched roof,
   barrel vault, sawtooth, cylinder, glass panel, lamp, wing — compose all
   thirteen forms at one draw call per primitive.
   ========================================================================== */

/* schema.org type -> the form it is built as. Aliases share a builder where the
   building really is the same building: a café and a restaurant are both a low
   room with an awning and tables outside. */
const TRADE_FORMS = {
  MusicSchool:                 'concertHall',
  Restaurant:                  'eatery',
  CafeOrCoffeeShop:            'eatery',
  FoodEstablishment:           'eatery',
  Manufacturer:                'factoryHall',
  Carpenter:                   'workshop',
  HomeAndConstructionBusiness: 'workshop',
  Plumber:                     'waterTower',
  ProfessionalService:         'glassOffice',
  SoftwareApplication:         'dataHall',
  SoftwareSourceCode:          'codeShop',
  Book:                        'library',
  EducationalOrganization:     'school',
  VideoObject:                 'filmStudio',
};

/* What the caption says a town's building is, in the words a person would use.
   Read off the same table so the picture and the sentence cannot drift apart. */
const TRADE_WORDS = {
  concertHall: 'a concert hall — this project is a music school',
  eatery:      'a restaurant — one room, an awning, tables outside',
  factoryHall: 'a factory hall: sawtooth roof, chimney, a flywheel in the yard',
  workshop:    'a workshop shed with a log pile and a saw bench',
  waterTower:  'a water tower and its pipe run',
  glassOffice: 'a glass office with the studio plaque on it',
  dataHall:    'a data hall under an antenna mast',
  codeShop:    'a workshop with a server rack lit in the window',
  library:     'a library, read through its reading-room windows',
  school:      'a school under a bell tower',
  filmStudio:  'a sound stage under a light rig',
};

/** A barrel vault: half a cylinder lying on its side, unit footprint, its crown
    at y = 1. What makes a concert hall read as a concert hall from six hundred
    metres is that its roof CURVES while every other roof in this world is a
    pitch or a flat — one silhouette, and no texture has to carry it. */
function vaultGeo() {
  /* three's cylinder runs along Y and its partial theta keeps the x >= 0 half.
     rotateZ(+90 degrees) maps that axis onto X and that half onto y >= 0 — the
     PLUS sign matters, and the minus one is why the first build put the dome
     underground and drew the concert hall as a flat slab, which is exactly what
     the first landmark capture showed. Then the y is doubled so the crown sits
     at 1 and an instance's h is the vault's real rise. */
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  g.scale(1, 2, 1);
  /* THE UNDERSIDE. openEnded is false, so three does cap the barrel's two ENDS
     with half-discs — what it cannot cap is the flat diametral plane the half
     cylinder was cut on, which after the rotation above is the whole rectangular
     floor of the vault at y = 0. From any camera below the eaves that rectangle
     is a hole and you are looking at the inside of the roof: the shell the
     twelfth pass flagged and tinted around rather than closed.
     Two triangles, wound downward (the material is DoubleSide anyway, but a
     normal that points into the room lights the floor from the wrong side).
     HANDOFF called this a fourteen-triangle fix, which was an estimate made from
     the segment count without looking; the hole is one quad. */
  const pos = Array.from(g.attributes.position.array);
  const nor = Array.from(g.attributes.normal.array);
  const idx = Array.from(g.index.array);
  const base = pos.length / 3;
  pos.push(-0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5);
  for (let i = 0; i < 4; i++) nor.push(0, -1, 0);
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const uv = [];
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) uv.push(p[i] + 0.5, p[i + 2] + 0.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A sawtooth bay: a prism, vertical on one side and sloped on the other. A row
    of them is the north-light roof every real machine hall has, and it is the
    most recognisable industrial silhouette there is. */
function sawGeo() {
  const p = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
             -0.5, 1, -0.5, -0.5, 1, 0.5];
  const idx = [0, 2, 1, 0, 3, 2, 0, 5, 4, 0, 3, 5, 4, 1, 0, 5, 1, 4, 1, 5, 2, 2, 5, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uv = [];
  for (let i = 0; i < p.length; i += 3) uv.push(p[i] + 0.5, p[i + 2] + 0.5);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Glass. Not a tinted wall: a dark, smooth, strongly reflective panel that
    takes the dusk HDRI, plus a floor glow that comes up with the lamps. It is
    the only MIRROR in this world, which is why a glass office reads as a
    different kind of building and not as a blue box. */
function makeGlassMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x14232b, roughness: 0.10, metalness: 0.86, envMapIntensity: 1.9,
  });
  const uNight = { value: 0 };
  mat.userData.uNight = uNight;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSize; attribute float aLit; attribute float aSeed;\nvarying float vLit; varying float vGY;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vLit = aLit; vGY = uv.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit; varying float vGY;')
      .replace('#include <emissivemap_fragment>', `
        /* The floors behind the glass: warm, and brightest low down where the
           lit rooms are. A band per storey would need the storey height as an
           attribute; the gradient says the same thing for nothing. */
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.40) * uNight * vLit
                               * (0.16 + 0.5 * (1.0 - vGY));`);
  };
  mat.customProgramCacheKey = () => 'lm-glass';
  litMaterials.push(mat);
  return mat;
}

/** A lamp: a dull object by day, a hard little light after dusk. The LEDs down
    a mast, the rig over a sound stage, the gold plaque on the studio's own
    office, the rack behind a workshop window. */
function makeLampMaterial(hex) {
  const mat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.1 });
  const uNight = { value: 0 };
  mat.userData.uNight = uNight;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSize; attribute float aLit; attribute float aSeed;\nvarying float vLit;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vLit = aLit;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;')
      .replace('#include <emissivemap_fragment>',
        'totalEmissiveRadiance += diffuse * (0.25 + 2.9 * uNight) * vLit;');
  };
  mat.customProgramCacheKey = () => 'lm-lamp-' + hex.toString(16);
  litMaterials.push(mat);
  return mat;
}

/* The emitter handed to every form builder. It knows the quarter's centre and
   its ground, so a builder writes in LOCAL metres — x across the front, z back
   into the plot, y up from the town's own ground — and never has to know where
   in the world the town is. */
/* Every form is drawn at a HOUSE's scale and then built at this. A house on
   this coast is three to six metres across and up to six tall, and a landmark
   the same size as its neighbours is not a landmark — it is one more roof.

   1.3 was measured and rejected: at that scale the harbour capture still showed
   the concert hall lost among its neighbours' roofs, because 1.3 of a house is
   still a house. 1.8 was rejected the other way — two neighbouring landmarks
   grew into each other, the shore giving a quarter only about sixteen metres of
   frontage. 1.5 is what fits, TOGETHER with the wider row pitch and the tighter
   house ring biomes.js now uses; that half of the problem geometry alone could
   not solve. */
const LM_SCALE = 1.5;

function landmarkEmitter(q, sink) {
  const lit = q.town.is_live ? 1 : 0;
  const put3 = (pool, lx0, ly0, lz0, w0, h0, d0, rot, l) => {
    const lx = lx0 * LM_SCALE, ly = ly0 * LM_SCALE, lz = lz0 * LM_SCALE;
    const w = w0 * LM_SCALE, h = h0 * LM_SCALE, d = d0 * LM_SCALE;
    /* The quarter's own rotation turns the whole landmark to face the water,
       so a builder can write "the terrace is at +z" once and mean it for all
       forty-six towns. */
    const c = Math.cos(q.face), s = Math.sin(q.face);
    sink.push({ pool, x: q.x + lx * c - lz * s, y: q.y + ly, z: q.z + lx * s + lz * c,
                w, h, d, rot: (rot || 0) + q.face, lit: l == null ? lit : l, q });
  };
  return {
    lit,
    block: (lx, ly, lz, w, h, d, r, mat) =>
      put3(mat === 'plaster' ? 'lmPlaster' : 'lmStone', lx, ly, lz, w, h, d, r),
    glass: (lx, ly, lz, w, h, d, r) => put3('lmGlass', lx, ly, lz, w, h, d, r),
    roof:  (lx, ly, lz, w, h, d, r) => put3('lmRoof', lx, ly, lz, w, h, d, r, 0),
    vault: (lx, ly, lz, w, h, d, r) => put3('lmVault', lx, ly, lz, w, h, d, r, 0),
    saw:   (lx, ly, lz, w, h, d, r) => put3('lmSaw', lx, ly, lz, w, h, d, r, 0),
    /* A cylinder standing on its base — and `lay` for one lying along x, which
       is what a log pile and a lighting truss are made of. It needs its own
       POOL and not a rotation: put() composes a Y rotation only, so the first
       build's `lay` quietly spun each log about its own axis and left it
       standing on end. */
    cyl:   (lx, ly, lz, rad, h, lay) =>
      put3(lay ? 'lmPipe' : 'lmCyl', lx, ly, lz,
           lay ? h : rad * 2, lay ? rad * 2 : h, rad * 2, 0, 0),
    lamp:  (lx, ly, lz, w, h, d, r) => put3('lmLamp', lx, ly, lz, w, h, d, r),
  };
}

/* -----------------------------------------------------------------------------
   THE THIRTEEN FORMS. Each writes into the emitter in local metres and stays
   inside LM_YARD, the radius biomes.js reserved by pushing that quarter's own
   houses outside it. Every one is the same idea: take the ONE thing a person
   would draw if asked to draw that trade, and build that — at a silhouette a
   camera six hundred metres up can still tell apart from its neighbour.

   The return value carries whatever MOVES: a smoke source, a wheel, a bank of
   LEDs. None of it animates unless the town has an agent in it.
   -------------------------------------------------------------------------- */
const FORM_BUILDERS = {
  /* A hall with a CURVED roof, tall windows down its front and the practice
     rooms as a low row beside it. The curve is the tell. */
  concertHall(L) {
    L.block(0, 0, 0, 7.6, 5.4, 4.4);
    L.vault(0, 5.4, 0, 7.8, 2.4, 4.6);
    /* Four glass slots, floor to cornice. A concert-hall foyer is glass from
       the ground up, and after dusk it is the brightest thing on the front. */
    for (let i = 0; i < 4; i++) L.glass(-2.7 + i * 1.8, 0.6, 2.28, 1.05, 4.0, 0.16);
    /* The practice-room row: five small rooms in a line under one long roof. */
    for (let i = 0; i < 5; i++) L.block(-3.6 + i * 1.8, 0, -3.4, 1.6, 2.2, 2.0, 0, 'plaster');
    L.roof(0, 2.2, -3.4, 9.0, 0.8, 2.4);
    L.cyl(3.0, 7.8, -0.9, 0.38, 2.0);
    return { smoke: { x: 3.0, y: 9.6, z: -0.9, glyph: true } };
  },

  /* Low room, an awning thrown out over the pavement, tables under it, a
     kitchen chimney. Nobody has ever mistaken this shape for an office. */
  eatery(L) {
    L.block(0, 0, 0, 6.4, 3.0, 4.0, 0, 'plaster');
    L.roof(0, 3.0, 0, 7.0, 1.4, 4.4);
    /* A flat slab at door height is what says "you sit outside". */
    L.block(0, 2.7, 2.9, 6.8, 0.20, 2.4);
    L.cyl(-2.9, 0, 3.9, 0.13, 2.7);
    L.cyl(2.9, 0, 3.9, 0.13, 2.7);
    for (let i = 0; i < 3; i++) {
      L.cyl(-2.0 + i * 2.0, 0, 3.2, 0.11, 0.74);
      L.cyl(-2.0 + i * 2.0, 0.74, 3.2, 0.50, 0.09);
    }
    L.cyl(-2.3, 4.1, -1.2, 0.36, 1.7);
    return { smoke: { x: -2.3, y: 5.6, z: -1.2 } };
  },

  /* A machine hall: long, low, a NORTH-LIGHT sawtooth roof, one tall chimney,
     and a flywheel standing in the yard that turns while work is happening. */
  factoryHall(L) {
    L.block(0, 0, -0.6, 8.2, 3.8, 4.8);
    for (let i = 0; i < 4; i++) L.saw(-3.1 + i * 2.05, 3.8, -0.6, 2.05, 1.4, 4.8);
    L.cyl(3.8, 0, -2.4, 0.50, 10.0);
    L.block(-1.0, 0, 3.8, 5.4, 0.12, 2.6);
    return { wheel: { x: -1.0, y: 1.9, z: 3.8, r: 1.7, rate: 0.9 } };
  },

  /* A shed under a big pitched roof, a stack of logs beside it, a circular saw
     on a bench. Three cylinders lying down is an arrangement nothing else in
     this world has. */
  workshop(L) {
    L.block(0, 0, 0, 5.8, 2.8, 4.0, 0, 'plaster');
    L.roof(0, 2.8, 0, 6.6, 2.0, 4.6);
    for (let i = 0; i < 3; i++) L.cyl(-4.0, 0.45 + i * 0.8, -1.0 + (i % 2) * 0.45, 0.40, 3.2, true);
    L.block(3.0, 0, 2.2, 2.0, 0.85, 1.3);
    return { wheel: { x: 3.0, y: 1.3, z: 2.2, r: 0.80, rate: 4.2 } };
  },

  /* A tank on four legs with a pipe run at its foot. There is exactly one
     building in the world that looks like this. */
  waterTower(L) {
    for (const [sx, sz] of [[-1.4, -1.4], [1.4, -1.4], [1.4, 1.4], [-1.4, 1.4]])
      L.cyl(sx, 0, sz, 0.20, 6.5);
    L.cyl(0, 6.5, 0, 2.3, 3.2);
    L.roof(0, 9.7, 0, 4.8, 1.3, 4.8);
    for (let i = 0; i < 3; i++) L.cyl(0, 0.42 + i * 0.66, -2.6 + i * 0.85, 0.28, 6.0, true);
    return {};
  },

  /* Glass, and the studio's own gold plaque on it. This is the one form whose
     MATERIAL is its meaning: the only mirrored building on the map. */
  glassOffice(L) {
    L.block(0, 0, 0, 6.2, 0.5, 4.6);
    L.glass(0, 0.5, 0, 5.8, 7.4, 4.2);
    L.block(0, 7.9, 0, 6.4, 0.5, 4.8);
    /* The W, in gold, beside the door. 1.1 m of plaque on a building this size
       is the proportion the mark has on the studio's own pages. */
    L.lamp(2.0, 1.5, 2.15, 1.1, 1.1, 0.13);
    return {};
  },

  /* A low windowless hall, a mast on it, and the mast's warning lights blinking
     down the shaft. */
  dataHall(L) {
    L.block(0, 0, 0, 6.8, 2.6, 4.8);
    L.block(0, 2.6, 0, 7.0, 0.32, 5.0);
    L.cyl(-2.2, 2.9, -1.5, 0.15, 9.0);
    for (let i = 0; i < 4; i++) L.lamp(-2.2, 4.2 + i * 2.0, -1.5, 0.40, 0.26, 0.40);
    /* Cooling stacks, which is what a data hall has instead of chimneys. */
    for (let i = 0; i < 3; i++) L.cyl(0.9 + i * 1.2, 2.9, 1.3, 0.26, 1.4);
    return { leds: true };
  },

  /* A workshop, and through its one big window a server rack standing lit. The
     rack is what makes this different from every other shed on the map. */
  codeShop(L) {
    L.block(0, 0, 0, 5.4, 3.2, 3.8, 0, 'plaster');
    L.roof(0, 3.2, 0, 6.0, 1.5, 4.4);
    L.glass(0, 0.9, 1.94, 3.2, 1.8, 0.14);
    L.lamp(-0.65, 0.85, 1.35, 0.5, 1.9, 0.45);
    L.lamp(0.65, 0.85, 1.35, 0.5, 1.9, 0.45);
    return { leds: true };
  },

  /* Tall, narrow, evenly spaced reading-room windows the full height of the
     wall, and a shallow roof. A library is a rhythm. */
  library(L) {
    L.block(0, 0, 0, 7.0, 5.6, 4.4);
    L.roof(0, 5.6, 0, 7.6, 1.1, 5.0);
    for (let i = 0; i < 6; i++) L.glass(-2.8 + i * 1.12, 1.3, 2.31, 0.56, 3.6, 0.14);
    L.block(0, -0.4, 2.8, 3.2, 0.4, 1.4);      // a library is entered UP
    return {};
  },

  /* A long two-storey block with a bell tower on one end. Every village school
     in Tirol is this drawing. */
  school(L) {
    L.block(0, 0, 0, 7.8, 4.6, 4.0, 0, 'plaster');
    L.roof(0, 4.6, 0, 8.4, 1.7, 4.6);
    L.block(-3.2, 0, -0.2, 2.0, 8.2, 2.0, 0, 'plaster');
    L.roof(-3.2, 8.2, -0.2, 2.4, 2.2, 2.4);
    L.lamp(-3.2, 6.7, 0.86, 0.95, 0.95, 0.13);   // the bell in its arch
    return {};
  },

  /* A blank shed — a sound stage is deliberately featureless — with a lighting
     truss over its apron and three lamps hanging off it. */
  filmStudio(L) {
    L.block(0, 0, 0, 7.0, 5.0, 4.6);
    L.block(0, 5.0, 0, 7.2, 0.35, 4.8);
    L.cyl(-3.2, 0, 3.2, 0.15, 6.2);
    L.cyl(3.2, 0, 3.2, 0.15, 6.2);
    L.cyl(0, 6.1, 3.2, 0.13, 6.8, true);
    for (let i = 0; i < 3; i++) L.lamp(-2.1 + i * 2.1, 5.4, 3.2, 0.58, 0.55, 0.58);
    return {};
  },
};


/* -----------------------------------------------------------------------------
   THE SIGN. A project's own logo, on a plaque, on a post, facing the camera.

   A Sprite and not a quad: the sign has to be legible from wherever the camera
   happens to be standing, and a flat panel on a building is edge-on from half
   the orbit. The texture is drawn on a canvas here rather than used raw so that
   the logo and the town's NAME are one image — a logo alone is unreadable at
   the distance most of these are seen from, and the name alone would throw away
   the thing the owner actually asked for.

   The fallback is not a placeholder mark, it is the name set in Instrument
   Serif on the same dark plaque: a project with no favicon has no logo, and
   inventing one would be the exact thing the whole world refuses to do.
   -------------------------------------------------------------------------- */
/* The layout, in canvas pixels, stated once because updateSigns() has to know
   what fraction of the plaque's height is CAP HEIGHT — that fraction is the only
   thing that turns "eighteen pixels of town name on the frame" into a world
   scale for the sprite. Guess it and the gate is measuring something else. */
const SIGN_CANVAS_W = 512;
const SIGN_PAD = 12;
const SIGN_LOGO_H = 168;         // the logo band, when the project has a logo
const SIGN_NAME_PX = 76;         // font size; cap height is ~0.70 of it in this face
const SIGN_CAP_OF_EM = 0.70;
const SIGN_NAME_BLOCK = 100;     // the band the name is drawn centred in

function signTexture(name, img) {
  const H = SIGN_PAD * 2 + (img ? SIGN_LOGO_H + 12 : 0) + SIGN_NAME_BLOCK;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const shown = clipName(name, 18);
  /* THE PLAQUE IS AS WIDE AS THE NAME ON IT. A fixed 512 px canvas made a
     four-letter town's sign the same 210 px hoarding on the frame as an
     eighteen-letter one, and the overlap cull then threw away four fifths of
     the harbour's addresses to stop them covering each other. Measured first,
     on a throwaway raster, because setting c.width resets the context. */
  c.width = 8; c.height = 8;
  g.font = `400 ${SIGN_NAME_PX}px "Instrument Serif", Georgia, serif`;
  const W = img ? SIGN_CANVAS_W
                : Math.min(SIGN_CANVAS_W, Math.max(170, Math.ceil(g.measureText(shown).width) + SIGN_NAME_PX));
  c.width = W; c.height = H;
  /* The plaque: the page's own ink, a gold hairline, and nothing else. The
     world has no panels in it and this is as close as it comes to one. */
  g.fillStyle = 'rgba(14,13,18,0.95)';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(210,166,44,0.62)';
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, W - 5, H - 5);
  if (img) {
    /* Fitted, never stretched: a squashed logo is worse than no logo. */
    const boxW = W - 70, boxH = SIGN_LOGO_H;
    const k = Math.min(boxW / img.width, boxH / img.height);
    const w = img.width * k, h = img.height * k;
    g.drawImage(img, (W - w) / 2, SIGN_PAD + (boxH - h) / 2, w, h);
  }
  const cy = H - SIGN_PAD - SIGN_NAME_BLOCK / 2;
  g.font = `400 ${SIGN_NAME_PX}px "Instrument Serif", Georgia, serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  /* THE INK HALO — the same one every caption in this world carries. The plaque
     is dark, but a sign is seen against a lit roof or a bright sky as often as
     against its own panel once it is scaled to be readable, and a stroke under
     the glyph is what keeps the letterform when the plaque is only a few pixels
     wider than the text. Drawn before the fill, never over it. */
  g.lineWidth = 9; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(8,7,12,0.92)';
  /* 18 characters, not 26: a name clipped at 26 sets 26 glyphs across 512 px,
     which is 19 px per glyph on a canvas whose cap height has to survive being
     scaled down to eighteen screen pixels. Fewer, larger letters read; more,
     smaller ones are the smudge this pass exists to remove. */
  g.strokeText(shown, W / 2, cy);
  g.fillStyle = '#f3ecdd';
  g.fillText(shown, W / 2, cy);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  /* What updateSigns() needs and cannot re-derive: the cap height and the logo
     height as fractions of this image. */
  t.userData.capFrac = (SIGN_NAME_PX * SIGN_CAP_OF_EM) / H;
  t.userData.logoFrac = img ? SIGN_LOGO_H / H : 0;
  return t;
}

/** Swap a sign's texture once the project's own logo has actually arrived.
    Every logo goes through an <img> and then a canvas, which is what makes an
    SVG usable as a texture at all — three cannot sample an SVG, and the server
    serves several of these as SVG. Same origin, so the canvas never taints.
    A logo that 404s or fails to decode leaves the name-only plaque standing;
    there is no error state, because "this project has no logo" is not an
    error. */
function loadSignLogo(spr, name, url) {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (!img.width || !img.height) return;
    const t = signTexture(name, img);
    spr.material.map.dispose();
    spr.material.map = t;
    spr.material.needsUpdate = true;
    /* Only the SHAPE of the plaque changes here; its size on the frame is
       solved every frame by updateSigns() from these two numbers. */
    spr.userData.aspect = t.image.height / t.image.width;
    spr.userData.capFrac = t.userData.capFrac;
    spr.userData.logoFrac = t.userData.logoFrac;
  };
  img.onerror = () => { /* the plaque already says the name; nothing to do */ };
  img.src = url;
}

/* -----------------------------------------------------------------------------
   HOW BIG A SIGN IS, and it is not a world size.

   The old rule was a fixed 7.2 m plaque that grew up to 1.9x with distance. That
   is a compromise between two distances and it is legible at neither: measured
   off the harbour capture's own camera (dist 150, fov 30, 900 px frame) it put
   9.5 px of cap height on the frame — the "small dark plaques with unreadable
   text" in the verdict, exactly.

   A sign is a piece of TYPE. Type is measured in pixels on the frame, so that is
   what is solved for: every frame, each sign is scaled so its cap height lands on
   SIGN_CAP_PX, whatever the camera is doing. The clamps stop it becoming a
   billboard three streets wide when the camera is far off, and the overlap cull
   below is what keeps forty-five of them from covering the town they name.
   -------------------------------------------------------------------------- */
/* 22 px of cap height on a 900 px frame is 2.4 % of its height. On a phone
   held upright the frame is 390 px WIDE, and the same 22 px plaque — whose
   width is set by the name on it, not by the cap — covered a third of the map:
   `alps-day` and `cafe-fundstueck` each ran the full width of the first mobile
   capture. The target is a fraction of the FRAME, not an absolute, so a phone
   gets 15 px, which at its dpr is the same physical size on the glass as 22 px
   is on a laptop. The 18 px legibility floor below is a DESKTOP gate and moves
   with it, or every sign on the phone would be culled for failing a test aimed
   at a screen twice the size. */
const SIGN_CAP_PX = MOBILE ? 15 : 22;   // cap height on the frame. Desktop gate is 18
/* 2.0 m, and it is a floor on the WORLD size, not on the pixel size. The solve
   already guarantees the pixel size; this only stops a sign the camera is
   standing on top of from collapsing to a sliver. Set at 4.5 first and the near
   sign in the landmark frame came back 54 px tall and covering a third of the
   town it was naming — a clamp that fires is a clamp that overrides the thing
   it was meant to protect. */
const SIGN_MIN_H = 2.0;
const SIGN_MAX_H = 34;       // metres — past this it is scenery, not a label
/* 900/1,200, not 300/380. The page OPENS at dist 900, so a fade that ended at
   380 units meant the default view — the one every visitor sees first — had
   zero signs on it: a pretty island with no addresses. The pixel solve already
   makes a sign the same size on the frame at any range, so the only honest
   reason left to fade one out is that it is past the fog. */
const SIGN_FADE0 = 900, SIGN_FADE1 = 1200;  // where it fades out entirely
/* And the other half of "a sign is legible or it is not there": a plaque whose
   solve runs into SIGN_MAX_H cannot reach the floor, and showing it anyway is
   what put a 9.5 px smudge in the frame. Below this it is simply not there. */
const SIGN_MIN_CAP_PX = MOBILE ? 12 : 18;
const SIGN_POST_H = 13.5;    // the mast the plaque is bolted to, in metres
/* Where the mast stands, relative to the quarter's centre. +x is the water on
   this coast (every trade town has face 0), so the sign is on the seaward
   corner of the landmark's yard — outside the building, inside the plot. */
const SIGN_OFFSET_X = LM_YARD * 0.78, SIGN_OFFSET_Z = LM_YARD * 0.62;

/* Every landmark part, sign, wing and moving prop, built in one pass over the
   quarters that have a trade. Called from buildWorld() after the generic
   structures, and again by rebuildHarbour() when the set of towns changes. */
const lmProps = [];          // things that move, and the town each belongs to
let lmSmoke = null;          // the note-glyph particles over live chimneys

function buildTradeLandmarks() {
  if (groups.landmarkTrade) {
    scene.remove(groups.landmarkTrade);
    groups.landmarkTrade.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  }
  groups.landmarkTrade = new THREE.Group();
  scene.add(groups.landmarkTrade);
  lmProps.length = 0;

  /* PASS ONE: run every form builder into a flat list, so the pools below can be
     allocated at exactly the size they need. An InstancedMesh cannot grow, and
     guessing a cap either wastes a megabyte of matrices or silently drops the
     forty-seventh town's roof. */
  const parts = [];
  const wings = [];
  const signs = [];
  for (const q of plan.quarters) {
    const form = FORM_BUILDERS[TRADE_FORMS[q.trade]];
    if (!form) continue;                       // unknown trade: the generic quarter stands
    /* Every landmark faces the water, which is +x on this coast — so the awning,
       the terrace and the glass front are all on the side you see from the sea. */
    q.face = 0;
    q.formKey = TRADE_FORMS[q.trade];
    const moving = form(landmarkEmitter(q, parts)) || {};
    if (moving.smoke) lmProps.push({ kind: 'smoke', q, ...moving.smoke });
    if (moving.wheel) lmProps.push({ kind: 'wheel', q, ...moving.wheel });
    if (moving.leds) lmProps.push({ kind: 'leds', q });
    signs.push(q);
    /* THE MAST AND ITS LAMP, in pools the landmarks already own — pushed here,
       in pass ONE, because pass two allocates every InstancedMesh at exactly the
       size this list says and an InstancedMesh cannot grow afterwards.
       A plaque floating in the air over a roof is a HUD element; a plaque on a
       post is a thing that is in the town. The lamp is what makes the sign a
       sign after dusk: lmLamp's material takes the same uNight every lit surface
       in this world does, so it comes on when the windows do. */
    parts.push({ pool: 'lmCyl', q,
                 x: q.x + SIGN_OFFSET_X, y: q.y, z: q.z + SIGN_OFFSET_Z,
                 w: 0.42, h: SIGN_POST_H, d: 0.42, rot: 0, lit: q.town.is_live ? 1 : 0 });
    parts.push({ pool: 'lmLamp', q,
                 x: q.x + SIGN_OFFSET_X, y: q.y + SIGN_POST_H - 0.9,
                 z: q.z + SIGN_OFFSET_Z + 0.55,
                 w: 0.9, h: 0.34, d: 0.5, rot: 0, lit: 1 });

    /* THE WINGS — one per page of the project's own site, in a ring around the
       landmark, as tall as the page is big. pages[] arrives from
       /api/project/meta biggest-first and is already capped at 24 by the server.
       The ring's radius is fixed at the yard biomes.js reserved, so a
       twenty-four-page site gets twenty-four narrow wings and a three-page site
       gets three wide ones; either way the ring is the same ring and no town's
       wings stand in its neighbour's plot. */
    const pages = (q.town.pages || []).slice(0, 24);
    if (!pages.length) continue;
    const step = (Math.PI * 2) / pages.length;
    const maxBytes = pages.reduce((m, p) => Math.max(m, p.bytes || 1), 1);
    pages.forEach((p, i) => {
      const a = i * step - Math.PI / 2;
      const wr = LM_YARD - 0.5;
      /* Log, like every other size on this map: a 45 kB page is not forty-five
         times the building a 1 kB page is. */
      /* Tall and narrow, never squat. The first build made these 1.4 to 4 m and
         they read as rubble around the landmark rather than as anything built;
         a wing has to be at least as tall as it is wide or the eye files it as
         debris. Log on the byte count, like every other size on this map: a
         45 kB page is not forty-five times the building a 1 kB page is. */
      const h = 2.6 + Math.log10(Math.max(1, (p.bytes || 1) / 1024) + 1) * 3.4
                    * (0.55 + 0.45 * ((p.bytes || 1) / maxBytes));
      wings.push({
        x: q.x + Math.cos(a) * wr, y: q.y, z: q.z + Math.sin(a) * wr,
        w: Math.max(0.7, Math.min(2.4, wr * step * 0.70)), h, d: 1.9, rot: a,
        lit: q.town.is_live ? 1 : 0, seed: (hash32(q.id + p.file) % 1000) / 1000,
        q, page: p,
      });
    });
  }
  if (!parts.length) return;

  /* PASS TWO: one InstancedMesh per primitive. Nine pools for forty-six
     landmarks and their several hundred wings — nine draw calls. */
  const counts = {};
  for (const p of parts) counts[p.pool] = (counts[p.pool] || 0) + 1;
  const box = unitBox();
  const mk = (name, geo, mat, n, shadow) => {
    if (!n) return null;
    const m = pool(name, geo, mat, n, shadow);
    groups.landmarkTrade.add(m);
    return m;
  };
  const P = {
    lmStone:   mk('lmStone', box, makeWallMaterial('brick', { windows: true, tint: 0xa8998a }), counts.lmStone, true),
    lmPlaster: mk('lmPlaster', box.clone(), makeWallMaterial('plaster', { windows: true, tint: 0xd8c3a2 }), counts.lmPlaster, true),
    lmGlass:   mk('lmGlass', box.clone(), makeGlassMaterial(), counts.lmGlass, false),
    lmRoof:    mk('lmRoof', roofGeo(), makeWallMaterial('roofTiles', { tint: 0xc87f56, side: THREE.DoubleSide }), counts.lmRoof, true),
    lmVault:   mk('lmVault', vaultGeo(), /* Lighter than a pitched roof, not darker. A barrel vault is a shell and the
       camera sees INTO its open end; at the pitched roof's own tint that opening
       read as a hole punched in the town. */
                  makeWallMaterial('roofTiles', { tint: 0xd8b49a, side: THREE.DoubleSide }), counts.lmVault, true),
    lmSaw:     mk('lmSaw', sawGeo(), makeWallMaterial('roofTiles', { tint: 0x8f8578, side: THREE.DoubleSide }), counts.lmSaw, true),
    lmCyl:     mk('lmCyl', new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0),
                  makeWallMaterial('brick', { tint: 0x9a8a78 }), counts.lmCyl, true),
    /* The same cylinder turned to lie along x: an instance's WIDTH is its
       length and its height and depth are its diameter, so a log and a truss
       are written exactly the way a standing pipe is. */
    lmPipe:    mk('lmPipe', new THREE.CylinderGeometry(0.5, 0.5, 1, 10).rotateZ(Math.PI / 2),
                  makeWallMaterial('brick', { tint: 0x8a7864 }), counts.lmPipe, true),
    lmLamp:    mk('lmLamp', box.clone(), makeLampMaterial(0xd2a62c), counts.lmLamp, false),
  };
  for (const p of parts) {
    const target = P[p.pool];
    if (!target) continue;
    put(target, p.x, p.y, p.z, p.w, p.h, p.d, p.rot, p.lit, (hash32(p.q.id + p.pool) % 1000) / 1000,
        { ref: { type: 'town', id: p.q.id, title: p.q.town.name, town: p.q.town }, x: p.q.x, y: p.q.y, z: p.q.z });
  }
  for (const k in P) if (P[k]) commit(P[k]);
  /* Clicking the concert hall has to open the concert hall's town, so every
     landmark pool is a pick target exactly like the houses are. */
  for (const k of ['lmStone', 'lmPlaster', 'lmRoof', 'lmCyl']) if (P[k]) pickables.push(P[k]);

  /* PASS THREE: the wings, in their own pool, because their record is a PAGE
     and hover has to be able to say the page's title. */
  if (wings.length) {
    const wp = pool('lmWing', box.clone(), makeWallMaterial('plaster', { windows: true, tint: 0xbfae95 }),
                    wings.length, true);
    groups.landmarkTrade.add(wp);
    for (const w of wings) {
      put(wp, w.x, w.y, w.z, w.w, w.h, w.d, w.rot, w.lit, w.seed, {
        x: w.x, y: w.y, z: w.z,
        ref: { type: 'page', id: w.q.id + '#' + w.page.file, title: w.page.title || w.page.file,
               file: w.page.file, bytes: w.page.bytes, town: w.q.town },
      });
    }
    commit(wp);
    pickables.push(wp);
  }

  /* PASS FOUR: the signs. One sprite each, name first and the logo swapped in
     when it arrives, so a slow asset never holds up the world. */
  if (!groups.signs) { groups.signs = new THREE.Group(); scene.add(groups.signs); }
  groups.signs.clear();
  /* BUSIEST FIRST. The overlap cull walks this list in order and keeps the first
     sign to claim a piece of the frame, so the order of these children IS the
     rule "when two signs collide, the busier town keeps its name". */
  signs.sort((a, b) => (b.town.tool_calls || 0) - (a.town.tool_calls || 0));
  for (const q of signs) {
    const t = signTexture(q.town.name, null);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      /* fog OFF. Everything else in this world is air-thickened with distance,
         and that is the point of it — but a sign is TYPE, and at the opening
         shot's 900 units the exponential fog took a quarter of the ink out of
         a plaque that the pixel solve had just made exactly readable. Haze on
         the mountain is depth; haze on the label is a defect. */
      /* depthTest OFF as well as depthWrite. From the harbour view a hillside
         between the lens and a quarter ate the LEFT HALF of that town's plaque
         — the plaque, not just its text — which reads as a broken texture
         rather than as depth. A place-name on a map is drawn over the map; the
         mast under it still sinks behind the hill, which is what says where
         the town actually is. */
      map: t, transparent: true, depthWrite: false, depthTest: false,
      opacity: 0.97, fog: false }));
    /* The sprite's anchor is its BOTTOM edge, so the plaque is bolted to the top
       of its mast and grows upward as the camera pulls back. Anchored at the
       centre it would sink through its own post every time it was scaled up. */
    spr.center.set(0.5, 0);
    /* On the water side of the landmark's yard, clear of the building itself:
       q.face is 0 for every trade town, so +x is the water and the sign stands
       where somebody arriving by sea would read it. */
    spr.position.set(q.x + SIGN_OFFSET_X, q.y + SIGN_POST_H, q.z + SIGN_OFFSET_Z);
    spr.userData.aspect = t.image.height / t.image.width;
    spr.userData.capFrac = t.userData.capFrac;
    spr.userData.logoFrac = t.userData.logoFrac;
    spr.userData.q = q;
    groups.signs.add(spr);
    if (q.town.logo && q.town.logo.url) loadSignLogo(spr, q.town.name, q.town.logo.url);
  }

  /* PASS FIVE: the musical notes over a live music school's chimney. The smoke
     system this world already has draws round soft blobs; a note is a GLYPH, so
     it needs its own texture and therefore its own Points — and it only ever has
     as many particles as there are live music schools, which is at most one. */
  buildNoteSmoke();
}

/** ♪ and ♫ drawn once onto a canvas, and one Points system that lifts them out
    of the chimneys of the music schools that are alive right now. Nothing
    emits while a town is idle: that is the same rule as the Dev Logs chimneys,
    and it is the reason a still frame of this world means "nothing is
    happening" rather than "the animation is subtle". */
function buildNoteSmoke() {
  if (lmSmoke) { scene.remove(lmSmoke); lmSmoke.geometry.dispose(); lmSmoke.material.dispose(); lmSmoke = null; }
  const sources = lmProps.filter(p => p.kind === 'smoke' && p.glyph);
  if (!sources.length) return;
  const PER = NOTE_PER_SOURCE;
  const n = sources.length * PER;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), act = new Float32Array(n);
  sources.forEach((s, si) => {
    for (let k = 0; k < PER; k++) {
      const i = si * PER + k;
      const c = Math.cos(s.q.face), co = Math.sin(s.q.face);
      const sx = s.x * LM_SCALE, sy = s.y * LM_SCALE, sz = s.z * LM_SCALE;
      pos.set([s.q.x + sx * c - sz * co, s.q.y + sy, s.q.z + sx * co + sz * c], i * 3);
      seed[i] = (hash32('note' + s.q.id + k) % 1000) / 1000;
      act[i] = s.q.town.is_live ? 1 : 0;
    }
  });
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '52px "Instrument Serif", Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText('♫', 32, 34);
  const tex2 = new THREE.CanvasTexture(c);
  tex2.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
  lmSmoke = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uMap: { value: tex2 } },
    vertexShader: `attribute float aSeed; attribute float aAct; uniform float uTime;
      varying float vA;
      void main(){
        float life = fract(uTime * 0.13 + aSeed);
        vA = aAct * (1.0 - life);
        vec3 p = position;
        p.y += life * 9.0;
        p.x += sin(aSeed * 30.0 + life * 5.0) * life * 3.2;
        p.z += cos(aSeed * 21.0 + life * 4.0) * life * 2.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 220.0 / -mv.z; }`,
    fragmentShader: `varying float vA; uniform sampler2D uMap;
      void main(){
        vec4 s = texture2D(uMap, gl_PointCoord);
        if (s.a < 0.15) discard;
        gl_FragColor = vec4(1.0, 0.86, 0.58, s.a * vA * 0.9); }`,
  }));
  lmSmoke.frustumCulled = false;
  scene.add(lmSmoke);
}

/** THE SIGNS, once per frame: a sign is legible or it is not there.

    The rule this replaces was a fixed 7.2 m plaque grown up to 1.9x with
    distance, and it failed its own purpose: measured on the harbour capture's
    own camera it put 9.5 px of cap height on a 900 px frame. The verdict called
    them "small dark plaques with unreadable text at any normal distance" and
    that is arithmetic, not taste.

    What runs here instead is a solve. Type is measured in pixels on the frame,
    so pixels on the frame is what is solved for: for each sign, take its real
    distance to the lens, work out how many metres one pixel is at that distance,
    and scale the plaque so its CAP HEIGHT lands on SIGN_CAP_PX. Then three
    things keep it honest:
      · CLAMPED between SIGN_MIN_H and SIGN_MAX_H, so a sign never shrinks under
        its own door or grows into a hoarding over the whole harbour;
      · CULLED where two signs overlap on the frame — walked busiest-town first,
        so the town with the most tool calls keeps its name and its quieter
        neighbour goes dark rather than both being illegible;
      · FADED out past SIGN_FADE1, because at that range even the clamped plaque
        is a stack of grey bars and forty-five of them is worse than the island.
    And after dusk the plaque brightens with its own lamp, live towns by more —
    the same rule the windows follow, so a still frame still says who is awake. */
const _sv = new THREE.Vector3();
let signStat = { visible: 0, minCapPx: 0, medCapPx: 0, culled: 0 };

function updateSigns() {
  if (!groups.signs) return;
  const el = renderer.domElement;
  const frameH = el.clientHeight || 900, frameW = el.clientWidth || 1440;
  /* metres per screen pixel is 2*d*tan(fov/2)/frameH — the same instrument
     __tags() and __interior().minGlyphPx are measured with, so a number from
     this probe can be compared with those without translating anything. */
  const halfTan = Math.tan(camera.fov * Math.PI / 360);
  const kept = [];
  const caps = [];
  let culled = 0;
  groups.signs.visible = true;
  for (const spr of groups.signs.children) {
    const d = _sv.copy(spr.position).sub(camera.position).length();
    const vis = 1 - THREE.MathUtils.smoothstep(d, SIGN_FADE0, SIGN_FADE1);
    if (vis <= 0.02) { spr.visible = false; continue; }
    const mPerPx = 2 * d * halfTan / frameH;
    const capFrac = spr.userData.capFrac || 0.18;
    const h = THREE.MathUtils.clamp(SIGN_CAP_PX * mPerPx / capFrac, SIGN_MIN_H, SIGN_MAX_H);
    const w = h / (spr.userData.aspect || 0.33);
    /* What the clamp actually delivered. A tall plaque (one with a logo band)
       spends most of its height on the logo, so at the wide shot its name hits
       SIGN_MAX_H long before it hits SIGN_CAP_PX — and an unreadable sign is
       not a sign. */
    if (h * capFrac / mPerPx < SIGN_MIN_CAP_PX) { spr.visible = false; culled++; continue; }
    spr.scale.set(w, h, 1);
    /* Where it lands on the frame. project() gives clip space; z past 1 is
       behind the lens, and a sprite behind the lens must not claim a rectangle
       the signs in front of it then get culled against. */
    _sv.copy(spr.position).project(camera);
    if (_sv.z > 1) { spr.visible = false; continue; }
    const cx = (_sv.x * 0.5 + 0.5) * frameW;
    const by = (1 - (_sv.y * 0.5 + 0.5)) * frameH;   // the plaque's bottom edge
    const pw = w / mPerPx, ph = h / mPerPx;
    /* KEEP IT ON THE FRAME. A plaque half off the edge is the `site-…` in
       docs/shots/final/world-harbour.png: the mast is in shot, the name is not.
       A Sprite's `center` is which point of it lands on its world position, so
       sliding that toward the far edge swings the plaque inward while the mast
       stays exactly where it is bolted. A sign whose own MAST is off the frame
       is hidden instead — a label pointing at something nobody can see is
       noise. `center` is (0.5, 0) here: the anchor is the plaque's BOTTOM. */
    const EDGE = 10;                                  // pixels of air, each side
    if (cx < -EDGE || cx > frameW + EDGE || by < -EDGE || by > frameH + EDGE) {
      spr.visible = false; continue;
    }
    let ax = 0.5;
    if (cx - pw * ax < EDGE) ax = (cx - EDGE) / pw;
    if (cx + pw * (1 - ax) > frameW - EDGE) ax = 1 - (frameW - EDGE - cx) / pw;
    /* Vertically the plaque only ever runs off the TOP, because it grows upward
       from a mast that is standing on the ground. */
    let ay = 0;
    if (by - ph * (1 - ay) < EDGE) ay = 1 - (by - EDGE) / ph;
    spr.center.set(ax, ay);
    const r = [cx - pw * ax, by - ph * (1 - ay), cx + pw * (1 - ax), by + ph * ay];
    let clash = false;
    for (const k of kept) {
      if (r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1]) { clash = true; break; }
    }
    if (clash) { spr.visible = false; culled++; continue; }
    kept.push(r);
    spr.visible = true;
    spr.material.opacity = 0.97 * vis;
    /* Its own lamp. A SpriteMaterial's colour multiplies its map, so pushing it
       past white is how an unlit sprite is made to read as a lit panel without
       giving every sign a real light in a scene that has one directional and an
       environment. Live towns a third brighter again. */
    const live = spr.userData.q && spr.userData.q.town.is_live;
    spr.material.color.setScalar(Math.min(1.55, (1 + nightAmount * 0.34) * (live ? 1.24 : 1.0)));
    caps.push(h * capFrac / mPerPx);
  }
  caps.sort((a, b) => a - b);
  signStat = {
    visible: caps.length, culled,
    minCapPx: caps.length ? Math.round(caps[0] * 10) / 10 : 0,
    medCapPx: caps.length ? Math.round(caps[caps.length >> 1] * 10) / 10 : 0,
  };
}

/** The moving props, once per frame. Every one of them is gated on its own
    town being live, so an idle harbour is a still harbour. */
function updateLandmarkProps(t) {
  for (const p of lmProps) {
    if (p.kind !== 'wheel') continue;
    if (!p.mesh) {
      /* Built lazily, and only for the towns that actually have a wheel: a
         flywheel and a saw blade are the only two round things in the world
         and there are never more than a dozen of them. */
      const R = p.r * LM_SCALE;
      const g = new THREE.TorusGeometry(R, R * 0.16, 6, 18);
      const spokes = new THREE.BoxGeometry(R * 2, R * 0.14, R * 0.14);
      p.mesh = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0x6b5f52, roughness: 0.8, metalness: 0.35 });
      p.mesh.add(new THREE.Mesh(g, mat));
      const s1 = new THREE.Mesh(spokes, mat);
      const s2 = new THREE.Mesh(spokes, mat);
      s2.rotation.z = Math.PI / 2;
      p.mesh.add(s1, s2);
      const c = Math.cos(p.q.face), s = Math.sin(p.q.face);
      const px = p.x * LM_SCALE, py = p.y * LM_SCALE, pz = p.z * LM_SCALE;
      p.mesh.position.set(p.q.x + px * c - pz * s, p.q.y + py, p.q.z + px * s + pz * c);
      /* Upright, and turned across the front so the disc reads as a disc from
         the water rather than as a line. */
      p.mesh.rotation.y = p.q.face + Math.PI / 2;
      p.mesh.castShadow = true;
      groups.landmarkTrade.add(p.mesh);
    }
    /* THE WHOLE ANIMATION RULE, in one line: it turns while an agent is in this
       project, and it stands still when there is not. */
    if (p.q.town.is_live) p.mesh.rotation.z = t * p.rate;
  }
  if (lmSmoke) lmSmoke.material.uniforms.uTime.value = t;
}

/** Relight a trade town's landmark, its wings and its props when the live state
    changes. The generic quarters already do this through their own pool; this
    is the same idea for the pools this section owns. */
function relightLandmarks(town) {
  const lit = town.is_live ? 1 : 0;
  for (const name of LM_LIT_POOLS) {
    const p = pools[name];
    if (!p) continue;
    let touched = false;
    for (let i = 0; i < p.count; i++) {
      const rec = p.userData.records[i];
      if (!rec || !rec.ref || rec.ref.town !== town) continue;
      p.userData.aLit.setX(i, lit);
      touched = true;
    }
    if (touched) p.userData.aLit.needsUpdate = true;
  }
  /* The note glyphs are laid out fourteen per source in source order, so a
     source's own slice is the only part of the buffer its live state may
     touch — rewriting the whole attribute would switch every music school on
     the map when one of them woke up. */
  if (lmSmoke) {
    const a = lmSmoke.geometry.attributes.aAct;
    const glyphs = lmProps.filter(pr => pr.kind === 'smoke' && pr.glyph);
    glyphs.forEach((pr, si) => {
      if (pr.q.town !== town) return;
      for (let k = 0; k < NOTE_PER_SOURCE; k++) a.setX(si * NOTE_PER_SOURCE + k, lit);
    });
    a.needsUpdate = true;
  }
}
const LM_LIT_POOLS = ['lmStone', 'lmPlaster', 'lmGlass', 'lmLamp', 'lmWing'];
/* One number, read by the builder and by the relighter: how many note glyphs
   one chimney owns in the shared buffer. */
const NOTE_PER_SOURCE = 14;


/* =============================================================================
   BUILD — one pass, from the plan
   ========================================================================== */
/* =============================================================================
   THE KIT TOWN — buildings.js where the boxes used to be

   The world's houses were an instanced box wearing a facade the fragment shader
   painted on: window grids, a cornice line, a door. That is exactly right at six
   hundred metres and it is a lie at eight, and eight metres is where this pass
   had to stand. `buildings.js` grows the other thing — an opening is a GAP the
   wall is built around, so the reveal is 0.34 m of real wall thickness, and the
   sill, the lintel, the shutter, the gutter, the downpipe, the dirt streak under
   the sill and the room behind the pane are all geometry with a PBR material on
   them. Thirty detail elements, all listed in docs/BUILDINGS.md.

   WHAT IS KEPT: the plan. biomes.js still decides where every building stands,
   how big it is, which way it faces and which note or project it IS. Nothing
   about the data changed; what changed is what the box is made of.

   THE THREE THINGS THIS HAS TO GET RIGHT, and how:

   1. A CATALOGUE, not a random draw. kit.instanced() groups by style, palette
      and roof, so 180 free combinations would be 360 InstancedMeshes and the
      whole point of instancing would be gone. Eleven entries here, six buckets,
      eleven baked facades — integration note 4 in docs/BUILDINGS.md.
   2. FRONT IS -Z. The world's own box put its door on the +x face and turned it
      by s.rot; a kit building faces -Z at rotation.y = 0. In three.js a +x face
      turned by r points at (cos r, -sin r) and a -Z front turned by t points at
      (-sin t, -cos t), and those two are equal at t = r - PI/2. That one
      subtraction is what stops every door in the harbour opening into the
      neighbour's back wall — and because the extra quarter turn swaps the
      building's own x and z, its footprint is passed as [d, w] and not [w, d].
   3. LOD WITH HYSTERESIS. kit.lodFor() bands at 60 m and 250 m. LOD0 is 8.7 k
      triangles and 9 draw calls, so it is capped hard and given only to the
      nearest few; everything else rides in two kit.instanced() groups that are
      rebuilt only when the camera has actually MOVED (KIT_MOVE) and a building
      has actually crossed a band by more than KIT_HYST. At the default 900 m
      framing every building is LOD2 and the whole town is a handful of draw
      calls, which is what the six box pools cost before it.
   ========================================================================== */

/* One row per bucket. `kind` on a plan record picks the bucket; a hash of the
   building's own position picks the row, so the same ground grows the same
   street on every reload. Every row is a style + palette + roof triple, which
   is exactly instanced()'s grouping key — eleven rows, eleven groups. */
const KIT_CATALOGUE = {
  /* THE HARBOUR. Whitewash-led, the way the box palettes already were: this is
     a coast, and a white house against a red roof is a silhouette from the sea
     where an ochre one is a smudge. A shop and an apartment block among the
     townhouses is what makes a quarter read as a quarter and not a terrace. */
  house: [
    { style: 'townhouse', palette: 'whitewash', roof: 'gable' },
    { style: 'townhouse', palette: 'whitewash', roof: 'hip' },
    { style: 'townhouse', palette: 'plaster',   roof: 'gable' },
    { style: 'shop',      palette: 'plaster',   roof: 'gable' },
    { style: 'apartment', palette: 'brick',     roof: 'mansard' },
  ],
  /* THE PEOPLE VILLAGE, up the hill. Dark timber under a gable with the odd
     whitewashed one — one silhouette and two colours for the whole hill, which
     is what tells it from the harbour at any distance. */
  cottage: [
    { style: 'cottage', palette: 'timber',    roof: 'gable' },
    { style: 'cottage', palette: 'whitewash', roof: 'hip' },
  ],
  /* THE DEV LOGS VALLEY. Brick industrial sheds with their utility walls, and
     barn-style timber sheds between them. */
  factory: [
    { style: 'industrial', palette: 'brick',  roof: 'flat' },
    { style: 'barn',       palette: 'timber', roof: 'gable' },
  ],
  /* THE KNOWLEDGE TERRACES. Stone civic and stone tower: quoins and string
     courses, no shutters, nothing domestic. */
  terrace: [
    { style: 'civic', palette: 'stone', roof: 'hip' },
    /* gable, not the tower style's own flat: the Knowledge terraces are read
       from 600 m against a bare mountain, and a field of flat-topped stone
       slabs up there is the one thing the first wide capture of this pass
       still read as blocks rather than as buildings. */
    { style: 'tower', palette: 'stone', roof: 'gable' },
  ],
  /* THE OLD TOWN at the river mouth — the oldest addresses, in stone. */
  civic: [{ style: 'townhouse', palette: 'stone', roof: 'gable' }],
  /* THE BOARDS FORTRESS. 28 curtain blocks, flat-roofed stone civic — the one
     `wall` kind that is a building. The other 140 are retaining walls and are
     still boxes, which is what s.fortress is for. */
  fortress: [{ style: 'civic', palette: 'stone', roof: 'flat' }],
};

/* How many LOD0 buildings may stand at once. 22 x 9 draw calls is 198 before
   anything else is drawn, and 22 x 8.7 k is 190 k triangles — that is the whole
   near-field budget on this GPU and it is spent deliberately. Medium quality
   gets a third of it. */
const KIT_MAX_LOD0 = { high: 22, medium: 8, low: 4 };
const KIT_MOVE = 9;          // metres the lens must move before the bands are re-solved
const KIT_HYST = 14;         // metres of overshoot before a building changes band

let kitRecs = [];            // { d: descriptor, band, obj, dist } per kit building
let kitLod0 = null;          // the group the real buildings hang in
let kitInst = null;          // the current kit.instanced() group
let kitEnv = null;           // which env map the kit is currently pointed at
const _kitAnchor = new THREE.Vector3(1e9, 0, 0);

/** Which catalogue bucket a plan record belongs to, or null for "still a box". */
function kitBucketOf(s) {
  if (s.kind === 'wall') return s.fortress ? 'fortress' : null;
  return KIT_CATALOGUE[s.kind] ? s.kind : null;
}

/** One plan record -> one kit.instanced() item. Also writes s.kitTop, which is
    where the chimney and its smoke stand, because a kit building's height is a
    whole number of its own style's floors and is not s.h. */
function kitDescribe(s, fall) {
  const bucket = kitBucketOf(s);
  if (!bucket) return null;
  const cat = KIT_CATALOGUE[bucket];
  const h32 = hash32('kit' + Math.round(s.x * 7) + ':' + Math.round(s.z * 7));
  const e = cat[h32 % cat.length];
  const floorH = BuildingKit.styles[e.style].floorH;
  /* The plan's height in metres, read back as whole floors. A height that is
     not a whole number of floors is what cuts the top row of windows in half —
     the same reason biomes.js already picks its box heights as 2.45 x floors. */
  const floors = Math.max(1, Math.min(9, Math.round(s.h / floorH)));
  /* Sunk by how far the ground falls across the building's own footprint, the
     same measurement the box above it uses — but only up to 2.4 m, because the
     kit's plinth is real geometry and burying it takes the base course with it. */
  const sink = Math.min(2.4, 0.35 + fall * 0.9);
  s.kitTop = s.y - sink + floors * floorH;
  return {
    position: [s.x, s.y - sink, s.z],
    rotationY: s.rot - Math.PI / 2,
    footprint: [s.d, s.w],
    floors, style: e.style, palette: e.palette, roof: e.roof,
    seed: h32 % 100000,
    rec: s,
  };
}

function buildKitTown(list) {
  groups.kit = new THREE.Group();
  groups.kit.name = 'kit';
  scene.add(groups.kit);
  kitLod0 = new THREE.Group();
  groups.kit.add(kitLod0);
  kitRecs = list.map(d => ({ d, band: 2, obj: null, dist: 1e9 }));
  kitInst = null;
  _kitAnchor.set(1e9, 0, 0);
  updateKitLod(true);
}

/** One real building. The kit's own materials are shared, so only the harvested
    geometry is this group's to dispose when it leaves the near band. */
function makeKitBuilding(d) {
  const g = kit.make({ seed: d.seed, footprint: d.footprint, floors: d.floors,
                       style: d.style, palette: d.palette, roof: d.roof, lod: 0 });
  g.position.set(d.position[0], d.position[1], d.position[2]);
  g.rotation.y = d.rotationY;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
function disposeKitBuilding(g) {
  g.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
}

/** The band solve. Runs from frame() at most every KIT_MOVE metres of camera
    travel — never per frame, because rebuilding the instanced groups costs far
    more than the LOD ever saves (integration note 3 in docs/BUILDINGS.md). */
function updateKitLod(force) {
  if (!kit || !kitRecs.length) return;
  const cp = camera.position;
  if (!force && cp.distanceToSquared(_kitAnchor) < KIT_MOVE * KIT_MOVE) return;
  _kitAnchor.copy(cp);

  const near = [];
  for (const r of kitRecs) {
    const p = r.d.position;
    const dx = p[0] - cp.x, dy = p[1] - cp.y, dz = p[2] - cp.z;
    r.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    /* THE HYSTERESIS IS ON THIS LINE, the only band boundary left. A building
       already standing in full detail keeps it until it is KIT_HYST past
       `kit.lodFor()`'s 60 m, so one sitting exactly on the line cannot be built
       and thrown away on alternate solves — and building one is ~400 boxes
       merged and an AO bake, which is the expensive half of this whole file. */
    if (kit.lodFor(r.dist) === 0 || (r.obj && r.dist < 60 + KIT_HYST)) near.push(r);
  }
  near.sort((a, b) => a.dist - b.dist);
  const want = new Set(near.slice(0, KIT_MAX_LOD0[quality] || 8));
  /* A PINNED building keeps its full detail whatever the budget says: it is
     mid-print or mid-derez, its materials are cloned and carrying a clipping
     plane, and disposing it here would leave a job holding a freed geometry.
     The pin is dropped the instant the sequence ends — see endPrint(). */
  for (const r of kitRecs) if (r.pin) want.add(r);

  let changed = !!force;
  for (const r of kitRecs) {
    if (want.has(r)) {
      if (!r.obj) { r.obj = makeKitBuilding(r.d); kitLod0.add(r.obj); changed = true; }
      r.band = 0;
    } else if (r.obj) {
      kitLod0.remove(r.obj); disposeKitBuilding(r.obj); r.obj = null;
      r.band = -1; changed = true;
    }
  }

  /* LOD2 IS NOT USED, AND THAT IS DELIBERATE — measured, not assumed.
     `kit.lodFor()` puts everything past 250 m in LOD2, and LOD2 **builds no
     roof**: it is a flat-topped box wearing the baked facade. The island's
     default framing is 900 m up, so at that one view — the frame this whole
     world is judged on, `docs/shots/world-dusk.png` — every roofline on it
     disappeared. The first capture of this pass is a mountain of tan slabs and
     a Dev Logs valley of flat pink blocks, and telling a hip roof from a gable
     at six hundred metres is a thing the box world already did.
     What LOD2 buys is ONE draw call per group instead of two. With a catalogue
     of thirteen rows that is thirteen draw calls, against six triangles a
     building for the roof prism — about 6 k triangles for the whole island.
     Not a trade worth making, so the far band is LOD1. */
  const items = [];
  for (const r of kitRecs) {
    if (r.obj) continue;
    r.band = 1;
    items.push({ position: r.d.position, rotationY: r.d.rotationY,
                 footprint: r.d.footprint, floors: r.d.floors, style: r.d.style,
                 palette: r.d.palette, roof: r.d.roof, seed: r.d.seed, lod: 1 });
  }
  if (!changed) return;
  /* Removed, not disposed: every geometry and every material in an instanced
     group belongs to the kit and is shared with the next rebuild. */
  if (kitInst) groups.kit.remove(kitInst);
  kitInst = kit.instanced(items);
  groups.kit.add(kitInst);
}

/** The lit bulbs of every LOD0 building, in world space, for the light budget. */
function kitLampPoints(out) {
  for (const r of kitRecs) {
    if (!r.obj || !r.obj.userData.lamps) continue;
    r.obj.updateMatrixWorld();
    for (const l of r.obj.userData.lamps) {
      _v3.set(l[0], l[1], l[2]).applyMatrix4(r.obj.matrixWorld);
      out.push([_v3.x, _v3.y, _v3.z]);
    }
  }
}


/* =============================================================================
   THE PROPS — the scanned pack, on a leash

   assets/manifest.json carries thirteen photogrammetry props, and they are an
   order of magnitude heavier than everything else in this world: measured on
   this machine, one quiver tree is 82 k triangles, one chainlink fence module
   89 k over 26 meshes, one pipe run 95 k over 106 meshes, one street lamp 31 k.
   Two hundred of anything here is the whole frame budget.

   So they are not scenery, they are a SHELL. Every slot is planned once, off
   the same plan the buildings come from; each solve takes the nearest few
   within PROP_SHELL metres and writes only those into the instanced pool. Past
   the shell there are no props at all, which is correct as well as cheap — a
   barrel is invisible at 200 m, and the wide shot of the island has never had
   one in it.

   The caps below are a triangle budget, not a taste: saturated, they are about
   1.2 M triangles at high quality on top of a world that already draws 1.5 M.
   Medium halves them.
   ========================================================================== */

/* A key here is the manifest key with `model.` taken off it, which is why the
   two Hunyuan entries carry their `hy.` prefix — `models` is loaded straight
   from `man['model.' + k]` and nothing else has to learn about the new pack. */
const PROP_KEYS = ['lamppost', 'bench', 'fence', 'cart', 'barrel', 'crate',
                   'tank', 'pipe', 'rockA', 'rockB', 'hy.bush',
                   'hy.tree_conifer', 'treeReal', 'boatReal'];

/* type -> cap at high, real height in metres, whether it casts. The height is
   what instanceModel's normalisation wants: it scales a model to one metre tall
   standing on the ground, so the scale IS the height. */
/* THE CAPS ARE A MEASUREMENT, not a preference. Saturated at the ?focus=harbour
   framing the first set of them (treeReal 8, lamppost 8, fence 2, boatReal 2)
   was 1.68 M triangles of props alone and cost SIX FPS there — bisected in a
   real headed window by hiding `groups.props` and nothing else, which took the
   same view from 23.5 to 30. Hiding the whole kit town on top of that bought
   nothing, so the buildings are not the bottleneck and the scans are.
   `shadow` is the second half of the same budget: a mesh that casts goes through
   the depth pass as well, so a 31 k lamp post costs 62 k. It is left on only
   where the shadow is the thing that plants the object on the ground — a bench,
   a barrel, a crate, a tank — and off for a pole, a hull and a canopy, whose
   shadows at this scale are a line, a smudge and nothing. */
const PROP_SPEC = {
  lamppost: { cap: 6,  h: 3.9,  shadow: false },
  bench:    { cap: 14, h: 0.9,  shadow: true  },
  fence:    { cap: 1,  h: 2.5,  shadow: false },
  cart:     { cap: 2,  h: 1.0,  shadow: false },
  barrel:   { cap: 8,  h: 0.9,  shadow: true  },
  crate:    { cap: 10, h: 0.4,  shadow: true  },
  tank:     { cap: 6,  h: 1.6,  shadow: true  },
  pipe:     { cap: 1,  h: 2.4,  shadow: false },
  rockA:    { cap: 6,  h: 0.9,  shadow: false },
  rockB:    { cap: 2,  h: 3.0,  shadow: false },
  /* The two Hunyuan statics. Each arrives as ONE primitive with one material,
     so its pool is one InstancedMesh — the rooibos bush it replaces was 15
     meshes over 3 materials and cost 3 draw calls after instanceModel's merge,
     which is why swapping it in takes the prop budget DOWN by two calls while
     the conifer's own pool puts one back. `h` is still the real height in
     metres; the conifer's is overridden per slot below so a scan is exactly as
     tall as the card it stands in for. */
  'hy.bush':         { cap: 3, h: 0.8, shadow: false },
  'hy.tree_conifer': { cap: 6, h: 9.0, shadow: false },
  treeReal: { cap: 9,  h: 4.5,  shadow: false },
  boatReal: { cap: 1,  h: 15.0, shadow: false },
};
/* Where the terrain stops painting grass and starts painting sand — the world's
   own dry band, and the same number terrain.js's splat uses
   (`float sand = smoothstep(4.2, 0.4, h)`). Read here so the quiver tree is
   planted on the ground that is actually drawn as dune, not on a guess. */
const DRY_BAND_TOP = 4.2;
/* AND NOT IN ANYBODY'S FRONT GARDEN. The height test alone is not enough on
   this island and the capture proved it: the harbour lawn is low ground, so a
   quiver tree passed the dry test and stood next to a broadleaf on the grass
   between `wild-digital-moments` and a parked car (h2/b4.png, 2026-09-06). The
   quarters are a European harbour town; the dune is what is left when you walk
   away from it. Sixty metres is two quarter-rows plus the yard — far enough
   that no camera framing a quarter has one in the same shot. */
const QUIVER_KEEP_OUT = 60;
const nearAQuarter = (x, z, r) =>
  plan.quarters.some(q => Math.hypot(q.x - x, q.z - z) < r + q.radius);
const PROP_SHELL = 115;      // metres — past this, nothing is placed
const PROP_MOVE = 9;         // metres of camera travel before the shell is re-solved
const MAX_LAMP_LIGHTS = 8;   // real point lights at night; every other bulb is emissive only

const propSlots = {};        // type -> [{x,y,z,rot,scale}]
const propPools = {};        // type -> instanceModel handle
const treeSlots = [];        // every card tree, so a real one can stand in its place
const boatSlots = [];        // every moored Kenney boat, same idea
let propBulbs = null;        // the emissive lamp heads
let lampLights = [];         // the eight real ones
let nightLamps = 0;          // the lamp ramp updateSun() solves, 0..1
const _propAnchor = new THREE.Vector3(1e9, 0, 0);

const propSlot = (type, x, z, y, rot, scale) => {
  (propSlots[type] || (propSlots[type] = [])).push({ x, y, z, rot, scale });
};

/** Where every prop in the world could stand. Run once, from buildWorld(). */
function planProps() {
  for (const k in propSlots) delete propSlots[k];
  const R = REGIONS;

  /* -- the harbour: lamps down the lanes, a bench and a barrel per quarter --- */
  for (const q of plan.quarters) {
    /* Quarters are packed about twelve metres apart along the shore, so the gap
       on a quarter's +z side IS the lane between it and its neighbour. */
    propSlot('lamppost', q.x, q.z + q.radius + 3.0, q.y, 0, PROP_SPEC.lamppost.h);
    if (q.trade) {
      /* A shop's own frontage: two barrels and two crates by the door, and a
         bench in the yard the landmark stands in. */
      for (let k = 0; k < 2; k++) {
        const a = 0.9 + k * 2.1;
        propSlot('barrel', q.x + Math.cos(a) * (LM_YARD + 1.1), q.z + Math.sin(a) * (LM_YARD + 1.1),
                 q.y, a, PROP_SPEC.barrel.h);
        propSlot('crate', q.x + Math.cos(a + 0.5) * (LM_YARD + 1.6), q.z + Math.sin(a + 0.5) * (LM_YARD + 1.6),
                 q.y, a + 1.3, PROP_SPEC.crate.h);
      }
      propSlot('bench', q.x - LM_YARD - 1.4, q.z, q.y, Math.PI / 2, PROP_SPEC.bench.h);
      propSlot('lamppost', q.x + LM_YARD + 1.2, q.z - LM_YARD * 0.5, q.y, 0, PROP_SPEC.lamppost.h);
    } else {
      /* THE QUAY side. A generic quarter's -z edge faces the water it was laid
         out along, and a working quay is barrels and crates before it is
         anything else. */
      propSlot('barrel', q.x + 1.4, q.z - q.radius - 2.2, q.y, 0.7, PROP_SPEC.barrel.h);
      propSlot('crate', q.x - 1.2, q.z - q.radius - 2.6, q.y, 2.2, PROP_SPEC.crate.h);
    }
  }

  /* -- the People village: a lamp on every third path, benches on the green -- */
  let ci = 0;
  for (const s of plan.structures) {
    if (s.kind !== 'cottage') continue;
    if (ci++ % 3 === 0) {
      /* Two and a half metres out of the door, on the side the path back to the
         green leaves from. s.rot is the way the cottage faces, which biomes.js
         already points at the village centre. */
      propSlot('lamppost', s.x + Math.cos(s.rot) * 2.6, s.z - Math.sin(s.rot) * 2.6,
               s.y, s.rot, PROP_SPEC.lamppost.h);
    }
  }
  for (const [reg, n, r] of [[R.people, 5, 6.5], [R.oldtown, 5, 7.5]]) {
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2;
      const x = reg.x + Math.cos(a) * r, z = reg.z + Math.sin(a) * r;
      propSlot('bench', x, z, landAt(x, z), a + Math.PI / 2, PROP_SPEC.bench.h);
    }
  }

  /* -- the Dev Logs valley: yards fenced, tanks and pipe runs at the works --- */
  let fi = 0;
  for (const s of plan.structures) {
    if (s.kind !== 'factory') continue;
    const i = fi++;
    if (i % 4 === 0) propSlot('fence', s.x + Math.cos(s.rot) * (s.w * 0.5 + 4.4),
                              s.z - Math.sin(s.rot) * (s.w * 0.5 + 4.4), s.y, s.rot, PROP_SPEC.fence.h);
    if (i % 3 === 1) propSlot('tank', s.x - Math.sin(s.rot) * (s.d * 0.5 + 1.5),
                              s.z - Math.cos(s.rot) * (s.d * 0.5 + 1.5), s.y, s.rot, PROP_SPEC.tank.h);
    if (i % 7 === 2) propSlot('pipe', s.x + Math.cos(s.rot) * (s.w * 0.5 + 1.2),
                              s.z - Math.sin(s.rot) * (s.w * 0.5 + 1.2), s.y, s.rot + Math.PI / 2, PROP_SPEC.pipe.h);
    if (i % 41 === 3) propSlot('cart', s.x + 3.2, s.z + 2.4, s.y, s.rot, PROP_SPEC.cart.h);
  }

  /* -- the fortress: a fence line outside every other curtain block ---------- */
  let wi = 0;
  for (const s of plan.structures) {
    if (s.kind !== 'wall' || !s.fortress) continue;
    if (wi++ % 2) continue;
    const ox = s.x - R.boards.x, oz = s.z - R.boards.z;
    const len = Math.hypot(ox, oz) || 1;
    propSlot('fence', s.x + ox / len * 3.4, s.z + oz / len * 3.4, s.y, s.rot, PROP_SPEC.fence.h);
  }

  /* -- slopes: rocks and bushes where the ground actually falls -------------- */
  plan.forest.forEach((tr, i) => {
    if (i % 7 && i % 9 && i % 23) return;
    /* The gradient over four metres. A rock on a flat lawn is set dressing; a
       rock on a slope is the slope showing through, which is the only reason
       these are here. */
    const g = Math.abs(heightAt(tr.x + 2, tr.z) - heightAt(tr.x - 2, tr.z))
            + Math.abs(heightAt(tr.x, tr.z + 2) - heightAt(tr.x, tr.z - 2));
    if (g < 1.1) return;
    const rot = (hash32('pr' + i) % 628) / 100;
    if (i % 23 === 0) propSlot('rockB', tr.x, tr.z, tr.y - 0.9, rot, PROP_SPEC.rockB.h);
    else if (i % 9 === 0) propSlot('rockA', tr.x, tr.z, tr.y - 0.15, rot, PROP_SPEC.rockA.h);
    else propSlot('hy.bush', tr.x, tr.z, tr.y, rot, PROP_SPEC['hy.bush'].h);
  });

  /* -- the real trees and the real boats, which stand IN PLACE OF something --- */
  /* ONLY WHERE A QUIVER TREE GROWS. `model.treeReal` is the pack's quiver tree —
     a bare trunk under a spray of blades — and swapping it in for ANY card tree
     inside the shell stood a row of desert blades on the street of a European
     harbour quarter. globe.js already fixed the same defect the same way
     (`speciesAt()` returns species 2 only in its hot dry band); this island has
     no latitude, so its dry band is the three things the world itself already
     says are dry, and it takes all three:
       - the SPECIES `TREE_TYPES` calls `scrub` ("on the dunes and the dry
         south") — the island's own answer to the globe's species 2;
       - the GROUND: either below DRY_BAND_TOP, which is where terrain.js stops
         painting grass and starts painting sand, or inside the Orphans STEPPE,
         which is the field `lifeField('ruin')` already hands the cows. Read off
         the plan's own ruin records, not off a copied rectangle;
       - and QUIVER_KEEP_OUT metres from any quarter, because on this island
         the harbour lawn is low ground too and the height test alone let one
         stand on the grass between two European townhouses.
     Everywhere else the forest's own broadleaf and conifer cards keep standing
     as themselves — they are the right tree for that ground, and a card at ten
     metres is a better tree than the wrong scan at ten metres. */
  const steppe = lifeField('ruin', 40);
  const inSteppe = (x, z) => steppe && x >= steppe[0][0] && x <= steppe[1][0] &&
                                      z >= steppe[0][1] && z <= steppe[2][1];
  const dryTrees = treeSlots.filter(t => t.key === 'scrub' &&
                                         (t.y < DRY_BAND_TOP || inSteppe(t.x, t.z)) &&
                                         !nearAQuarter(t.x, t.z, QUIVER_KEEP_OUT));
  for (const t of dryTrees) {
    propSlot('treeReal', t.x, t.z, t.y, t.rot,
             PROP_SPEC.treeReal.h * (0.74 + (t.scale % 1) * 0.46));
  }
  if (propSlots.treeReal) propSlots.treeReal.forEach((s, i) => { s.swap = dryTrees[i]; });

  /* THE CONIFERS THE CAMERA IS STANDING IN. The card conifer is right at 300 m
     and wrong at ten: `canopyGeometry` is three crossed quads wearing a drawn
     alpha, and inside the prop shell you are close enough to read the quads.
     `model.hy.tree_conifer` is a real spruce, so it stands in for the nearest
     six of them exactly as the quiver tree already stands in for the nearest
     nine scrub cards — same slot, same hide/show, same shell.

     NO DRY-BAND TEST HERE, and that is the difference from the quiver tree
     above: a quiver tree in a European harbour street is a wrong statement
     about the place, whereas a spruce is what `TREE_TYPES` says grows on this
     island's slopes in the first place. The only rule it has to obey is the one
     the cards already obey — it stands where a conifer card stands.

     THE HEIGHT IS THE CARD'S OWN. `t.scale` is that tree's finished height in
     metres (canopyGeometry normalises the canopy to 1 and buildForest scales by
     `tr.scale * 3.4`), so passing it through means the scan appears at exactly
     the size of the card it replaces and the swap is invisible rather than a
     tree growing as you walk towards it. PROP_SPEC's own `h` is the fallback
     the pool is built at. */
  const conifers = treeSlots.filter(t => t.key === 'conifer');
  for (const t of conifers) propSlot('hy.tree_conifer', t.x, t.z, t.y, t.rot, t.scale);
  if (propSlots['hy.tree_conifer']) {
    propSlots['hy.tree_conifer'].forEach((s, i) => { s.swap = conifers[i]; });
  }
  for (const b of boatSlots) propSlot('boatReal', b.x, b.z, b.y, b.rot, PROP_SPEC.boatReal.h);
  if (propSlots.boatReal) propSlots.boatReal.forEach((s, i) => { s.swap = boatSlots[i]; });
}

/** The pools, one per type, built at their cap and never resized. */
function buildProps() {
  groups.props = new THREE.Group();
  groups.props.name = 'props';
  scene.add(groups.props);
  const q = quality === 'high' ? 1 : 0.5;
  for (const k of PROP_KEYS) {
    if (!models[k]) continue;
    const cap = Math.max(1, Math.round(PROP_SPEC[k].cap * q));
    const inst = instanceModel(models[k], cap, null, true);
    for (const p of inst.parts) { p.castShadow = PROP_SPEC[k].shadow; p.receiveShadow = true; }
    groups.props.add(...inst.parts);
    inst.cap = cap;
    propPools[k] = inst;
  }
  /* THE BULBS. One emissive head per lamp post — the same lit material the
     landmark lamps use, so it comes on with the windows off the one sun. A
     shade that glows and lights nothing is what makes a night render read as a
     poster, so up to MAX_LAMP_LIGHTS of them also carry a real point light. */
  const capL = propPools.lamppost ? propPools.lamppost.cap : 0;
  if (capL) {
    /* 0.09 m, not 0.17. The lit material is an emissive at full strength and it
       goes through the bloom pass: at 0.17 a lamp head eight metres from the
       lens came back as a white disc the size of a window, which is a poster
       effect and not a lamp. The LIGHT is what should be seen, not the bulb. */
    propBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5),
                                        makeLampMaterial(0xffb469), capL);
    propBulbs.count = 0;
    propBulbs.frustumCulled = false;
    groups.props.add(propBulbs);
  }
  lampLights = [];
  for (let i = 0; i < MAX_LAMP_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffb469, 0, 26, 1.8);
    l.visible = false;
    scene.add(l);
    lampLights.push(l);
  }
}

/** The shell solve: nearest N of each type inside PROP_SHELL, and nothing else.
    Runs on the same camera-travel gate the kit LOD does. */
function updateProps(force) {
  if (!groups.props) return;
  const cp = camera.position;
  if (!force && cp.distanceToSquared(_propAnchor) < PROP_MOVE * PROP_MOVE) return;
  _propAnchor.copy(cp);
  const shell2 = PROP_SHELL * PROP_SHELL;
  const bulbs = [];

  for (const k of PROP_KEYS) {
    const pool = propPools[k], list = propSlots[k];
    if (!pool || !list) continue;
    const near = [];
    for (const s of list) {
      const dx = s.x - cp.x, dy = s.y - cp.y, dz = s.z - cp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < shell2) near.push([d2, s]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const take = near.slice(0, pool.cap);
    /* Whatever this type replaced comes BACK first and is hidden again second:
       in that order a slot that stays inside the shell across two solves is
       never briefly drawn twice, and one that left is never left invisible. */
    for (const s of list) if (s.swap && s.swap.hidden) showSwapped(s.swap);
    pool.reset();
    for (const [, s] of take) {
      pool.place(s.x, s.y, s.z, s.rot, s.scale, null);
      if (s.swap) hideSwapped(s.swap);
      if (k === 'lamppost') bulbs.push([s.x, s.y + s.scale * 0.93, s.z]);
    }
    pool.commit();
  }

  if (propBulbs) {
    propBulbs.count = Math.min(bulbs.length, propBulbs.instanceMatrix.count);
    for (let i = 0; i < propBulbs.count; i++) {
      _e4.set(0, 0, 0);
      _m4.compose(_v3.set(bulbs[i][0], bulbs[i][1], bulbs[i][2]), _q4.setFromEuler(_e4), _s3.set(1, 1, 1));
      propBulbs.setMatrixAt(i, _m4);
    }
    propBulbs.instanceMatrix.needsUpdate = true;
  }
  /* The eight real lights go on the nearest bulbs of all — a lamp post's head
     or a kit building's own wall lamp, whichever is closer. */
  kitLampPoints(bulbs);
  const d2 = (b) => (b[0] - cp.x) * (b[0] - cp.x) + (b[2] - cp.z) * (b[2] - cp.z);
  bulbs.sort((a, b) => d2(a) - d2(b));
  lampLights.forEach((l, i) => {
    if (i < bulbs.length) { l.position.set(bulbs[i][0], bulbs[i][1], bulbs[i][2]); l.userData.armed = true; }
    else l.userData.armed = false;
  });
  setLampPower(nightLamps);
}

/** Day/night for the eight real lights. Called from updateSun() as well as from
    the shell solve, because either the sun or the camera can change which lamps
    are alight. */
function setLampPower(ramp) {
  nightLamps = ramp;
  for (const l of lampLights) {
    const on = !!l.userData.armed && ramp > 0.04;
    l.visible = on;
    /* 6, not 12. Eight point lights at 12 cd inside a 26 m radius put the
       whole near field over the bloom threshold and the street came back as
       milk — the same failure buildings.js records against a 0.86 threshold on
       a real HDRI. What has to read is the pool of light on the ground, not the
       lamp. */
    l.intensity = on ? 6 * ramp : 0;
  }
}

/* A card tree standing where a scanned one now stands is two crossed quads
   inside a real canopy, which reads as a glitch and not as a tree — and the
   same is true of the Kenney pirate hull under a scanned Dutch ship. Both are
   scaled to nothing and put back from their own stored matrix when the camera
   leaves, which is one mechanism for the two swaps. */
const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
function hideSwapped(t) {
  if (!t || t.hidden) return;
  t.hidden = true;
  for (const m of t.meshes) { m.setMatrixAt(t.i, _zeroM); m.instanceMatrix.needsUpdate = true; }
}
function showSwapped(t) {
  if (!t || !t.hidden) return;
  t.hidden = false;
  for (const m of t.meshes) { m.setMatrixAt(t.i, t.m); m.instanceMatrix.needsUpdate = true; }
}


function buildWorld() {
  plan = planWorld(vault, world.towns);

  terrain = buildTerrain(tex, quality === 'high' ? 300 : 220);
  scene.add(terrain);

  /* Six wall pools by material family, so a factory is brick and a temple is
     stone and neither is a tinted copy of the other. */
  const box = unitBox();
  groups.structures = new THREE.Group();
  scene.add(groups.structures);
  /* Which pool a record goes in. A structure that names a PALETTE gets it — that
     is the whole of the house-variety pass on this side of the seam; anything
     that does not falls back to the pool its kind always had, so a record from
     an older payload still builds. */
  /* SINCE THE KIT LANDED these six pools are still built, still carry every
     record and are still what the raycaster tests — but the five house families
     are `visible = false`. They are the PICK COLLIDER for the kit buildings
     standing in their place, and keeping them is what keeps hover, the caption,
     click, double-click, `enterGeneric`, `applyLive`'s per-building relight and
     `q.blocks` working with no change at all: every one of those paths reads
     `pool.userData.records[instanceId]`, and re-deriving that mapping out of
     `kit.instanced()`'s own internal grouping would be a second source of truth
     for which building is which. An invisible InstancedMesh is not drawn and
     still raycasts; the cost is memory, and it is the cheapest honest seam
     between a box world and a kit world.
     `ruinStone` and `retain` are new because they are the two families that do
     NOT go to the kit — a ruin is a building with its top taken off and a
     retaining wall is not a building — and they used to ride in the brick and
     stone pools, which are now invisible. */
  const famName = (s) =>
      s.kind === 'ruin' ? 'ruinStone'
    : (s.kind === 'wall' && !s.fortress) ? 'retain'
    : (s.palette && (s.palette === 'plaster' || s.palette === 'white'
                  || s.palette === 'brick' || s.palette === 'timber')) ? s.palette
    : (s.kind === 'house' || s.kind === 'cottage' || s.kind === 'civic') ? 'plaster'
    : (s.kind === 'factory') ? 'brick'
    : (s.kind === 'terrace' || s.kind === 'wall') ? 'stone' : 'quarry';
  const counts = { plaster: 0, white: 0, brick: 0, timber: 0, stone: 0, quarry: 0,
                   ruinStone: 0, retain: 0, chimney: 0 };
  for (const s of plan.structures) {
    counts[famName(s)]++;
    if (s.chimney) counts.chimney++;
  }
  const P = {
    plaster: pool('plaster', box, makeWallMaterial('plaster', { windows: true, tint: 0xd3bc9c }), counts.plaster + 8, true),
    /* WHITEWASH. The coast's own colour, and the one palette that reads at the
       wide shot without a single window being resolvable — a white house against
       a red roof is a silhouette, an ochre one is a smudge. */
    white:   pool('white', box.clone(), makeWallMaterial('plaster', { windows: true, tint: 0xeae3d3 }), counts.white + 8, true),
    /* A real brick, not the beige-brick the generic pool used: two pools with
       the same texture ten percent apart in hue are one pool as far as the eye
       is concerned, which is exactly the failure this pass exists to fix.
       0x9a7360 and not the 0xa9705a tried first — this pool also carries the 176
       Dev Logs factories, and at full brick red the whole industrial valley went
       scarlet in the wide dusk shot and took the frame off the mountain. Muted
       is still unmistakably a different material from whitewash and ochre. */
    brick:   pool('brick', box.clone(), makeWallMaterial('brick', { windows: true, tint: 0x9a7360 }), counts.brick + 8, true),
    /* DARK TIMBER. The brick texture's own horizontal courses at a dark umber
       read as boarding at this distance; there is no wood texture in assets/ and
       assets/ is another agent's to change. */
    timber:  pool('timber', box.clone(), makeWallMaterial('brick', { windows: true, tint: 0x6b5137 }), counts.timber + 8, true),
    stone:   pool('stone', box.clone(), makeWallMaterial('brick', { tint: 0x9d9182 }), counts.stone + 8, true),
    quarry:  pool('quarry', box.clone(), makeWallMaterial('cliff'), counts.quarry + 8, true),
    /* The two families the kit does not take, and the only two of these seven
       that are still DRAWN as boxes. Same materials the brick and stone pools
       carry, because they are the same stone — what changed is only which pool
       they live in, so that the kit's colliders can be hidden as a set. */
    ruinStone: pool('ruinStone', box.clone(), makeWallMaterial('brick', { tint: 0x9a7360 }), counts.ruinStone + 8, true),
    retain:  pool('retain', box.clone(), makeWallMaterial('brick', { tint: 0x9d9182 }), counts.retain + 8, true),
    /* THE ROOF POOLS ARE GONE — three instanced prisms and a parapet slab that
       exist to put a lid on a box. The kit builds its own roof in stepped tile
       courses with a ridge cap, an eaves overhang, a fascia and a gutter, so a
       second roof over the same footprint would only z-fight with it. Same for
       the porch lamp: the kit hangs a bracketed wall lamp beside every door and
       reports it in `userData.lamps`, and THE PROPS below stands real lamp posts
       along the People paths on top of that.
       The CHIMNEY stays. It is the Dev Logs valley's whole silhouette and it is
       where buildSmoke() takes its sources from — but it is now placed on the
       KIT's roof height, not on the box's, because those two are no longer the
       same number. */
    chimney: pool('chimney', new THREE.CylinderGeometry(0.5, 0.62, 1, 7).translate(0, 0.5, 0),
                  makeWallMaterial('brick', { tint: 0x8f7d6a }), counts.chimney + 8, true),
  };
  for (const k in P) if (P[k]) groups.structures.add(P[k]);
  /* The five house families are colliders now, not scenery. `quarry`,
     `ruinStone`, `retain` and `chimney` are still drawn. */
  for (const k of ['plaster', 'white', 'brick', 'timber', 'stone']) P[k].visible = false;
  pickables.length = 0;
  pickables.push(P.plaster, P.white, P.brick, P.timber, P.stone, P.quarry,
                 P.ruinStone, P.retain);
  const kitList = [];          // what buildKitTown() grows the real buildings from

  for (const s of plan.structures) {
    const fam = P[famName(s)];
    /* A ruin is a building with its top taken off and its walls out of plumb —
       the same box, tilted. Nothing about it is a separate asset. */
    const tilt = s.kind === 'ruin' ? (s.seed - 0.5) * 0.22 : 0;
    /* THE FOUNDATION, cut into the slope. A box placed exactly on heightAt() sits
       on the ground at ONE point — its own centre — and on a hillside its four
       corners hang in the air, which is the "floating boxes" in the verdict, and
       it is worst exactly where it shows most: on the Knowledge mountain. How far
       a building has to be buried is how far the ground falls across its own
       footprint, so that is what is measured — four extra heightAt() calls per
       building at build time, and nothing per frame. */
    const fall = (Math.abs(heightAt(s.x + s.w * 0.5, s.z) - heightAt(s.x - s.w * 0.5, s.z))
                + Math.abs(heightAt(s.x, s.z + s.d * 0.5) - heightAt(s.x, s.z - s.d * 0.5))) * 0.5;
    /* 1.4 of base sink, not 0.6: the ground MESH is 3 m per cell, so on a ridge
       the drawn surface can sit a metre and a half under the heightAt() the
       building was placed on, and that metre and a half is a visible gap. */
    const sink = Math.min(7, 1.4 + fall * 0.85);
    s.index = put(fam, s.x, s.y - sink, s.z, s.w, s.h + sink, s.d, s.rot + tilt, s.lit || 0, s.seed || 0, s);
    s.pool = fam;
    /* THE KIT DESCRIPTOR, built out of the same four heightAt() calls the box
       above already paid for. `s.kitTop` is what the chimney and the smoke
       source below stand on, because a kit building's height is a whole number
       of its style's own floors and is not `s.h`. */
    const kd = kitDescribe(s, fall);
    if (kd) kitList.push(kd);
    if (s.chimney) {
      const cx = s.x + Math.cos(s.rot) * s.w * 0.32, cz = s.z + Math.sin(s.rot) * s.w * 0.32;
      /* A DOMESTIC chimney is not a works chimney. This pool was written for the
         Dev Logs valley, where 2.6 + 55% of the building's height on a 1.1 m
         stack is exactly right; put the same stack on a four-storey harbour
         house and it is a nine-metre column, and the first capture of the varied
         houses came back reading as a forest of pillars rather than a town. */
      /* `domestic`, not `dom`: `dom` is this module's element registry and a
         block-scoped shadow of it is the kind of thing that reads fine and
         breaks the next edit made three lines lower. */
      const domestic = s.kind === 'house' || s.kind === 'cottage' || s.kind === 'civic';
      const ch = domestic ? 1.0 + s.h * 0.10 : 2.6 + s.h * 0.55;
      const cw = domestic ? 0.62 : 1.1;
      /* On the KIT's ridge, not the box's. `kitTop` is set by kitDescribe();
         a record the kit does not take (there are none with a chimney today)
         falls back to its own box height rather than dropping the stack. */
      const top = s.kitTop != null ? s.kitTop : s.y + s.h;
      put(P.chimney, cx, top, cz, cw, ch, cw, 0, 0, s.seed, s);
      s.chimneyTop = { x: cx, y: top + ch, z: cz };
    }
  }
  for (const k in P) if (P[k]) commit(P[k]);
  buildKitTown(kitList);

  /* -- landmarks ---------------------------------------------------------- */
  groups.landmarks = new THREE.Group();
  scene.add(groups.landmarks);
  const towers = plan.landmarks.filter(l => l.model === 'tower');
  const stalls = plan.landmarks.filter(l => l.model === 'shed' || l.model === 'stall');
  const boats  = plan.landmarks.filter(l => l.model === 'boat');
  models.towerInst  = instanceModel(models.tower, towers.length + 4, makeTriplanarMaterial('brick', 0xa89b8a));
  models.bridgeInst = instanceModel(models.bridge, plan.bridges.length + 4, makeTriplanarMaterial('cobble', 0xb0a898));
  models.stallInst  = instanceModel(models.shed, stalls.length + 4, makeTriplanarMaterial('plaster', 0xc9b898));
  models.boatInst   = instanceModel(models.boat, Math.max(8, boats.length + 4));
  for (const m of [models.towerInst, models.bridgeInst, models.stallInst, models.boatInst])
    groups.landmarks.add(...m.parts);

  for (const l of towers) models.towerInst.place(l.x, l.y, l.z, l.rot, l.scale * 2.6, l);
  for (const l of stalls) models.stallInst.place(l.x, l.y, l.z, l.rot, l.scale * 2.0, l);
  /* Every mooring is remembered, because within PROP_SHELL the scanned hull
     stands here instead and this Kenney one has to get out of its way. */
  boatSlots.length = 0;
  for (const l of boats) {
    const i = models.boatInst.place(l.x, l.y, l.z, l.rot, l.scale * 3.2, l);
    if (i < 0) continue;
    const m = new THREE.Matrix4();
    models.boatInst.parts[0].getMatrixAt(i, m);
    boatSlots.push({ meshes: models.boatInst.parts, i, m, x: l.x, y: l.y, z: l.z,
                     rot: l.rot, hidden: false });
  }
  /* One CONSTANT scale for all 45 bridges, not one per note's word count. The
     model is normalised to one unit tall and is about four long, so 4.2 spans a
     20 m river; anything larger and 45 bridges 7 m apart merge into a city wall
     with no water visible under it, which is what the first river capture
     showed. A bridge is an address, not a measurement. */
  for (const b of plan.bridges) models.bridgeInst.place(b.x, b.y, b.z, b.rot + Math.PI / 2, 4.2, b);
  models.towerInst.commit(); models.stallInst.commit();
  models.boatInst.commit(); models.bridgeInst.commit();
  pickables.push(models.towerInst.parts[0], models.bridgeInst.parts[0]);
  models.towerInst.parts[0].userData.modelRecords = models.towerInst.records;
  models.bridgeInst.parts[0].userData.modelRecords = models.bridgeInst.records;

  /* -- forest ------------------------------------------------------------- */
  groups.forest = buildForest(plan.forest);
  scene.add(groups.forest);

  /* -- the river, and the roads --------------------------------------------- */
  buildRiver();
  buildRoads();

  /* -- the trade landmarks, their signs and their page wings ---------------- */
  buildTradeLandmarks();

  /* -- cranes, smoke, quarters --------------------------------------------- */
  buildCranes();
  buildSmoke();
  rebuildHarbour();

  /* AFTER the harbour and the forest, because a prop slot is placed against a
     quarter, a cottage, a factory yard or a tree that already exists. */
  planProps();
  buildProps();
  updateProps(true);

  recount();
  dom['a11y-status'].textContent =
    `${vault.counts.notes} notes and ${world.towns.length} projects, drawn as one world.`;
  frameCamera();
}

/* The Daily river. The terrain already carves the trench; this is the water in
   it — a ribbon down the same polyline the bridges are placed on, at the surface
   height terrain.js defines, so the water can never sit above its banks or
   under its own bridges. NOT the addons' Water: a planar reflector needs a
   horizontal plane and this one descends 8 m from the mountain to the sea. A
   normal-mapped standard material takes its reflection from the scene's HDRI
   environment instead, which at this scale is the same picture for a fraction of
   the cost. */
function buildRiver() {
  const verts = [], uvs = [];
  for (let i = 0; i < RIVER.length - 1; i++) {
    const t0 = i / (RIVER.length - 1), t1 = (i + 1) / (RIVER.length - 1);
    /* Stop at the estuary. Past here the bed is under the sea, the ribbon is
       hidden by the sea plane anyway, and all it does is leave a blue band lying
       over the sea floor for whoever next turns the water off to wonder about. */
    if (riverSurface(t1) < SEA - 1.2) break;
    const [x0, z0] = RIVER[i], [x1, z1] = RIVER[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    /* The river widens downstream, the way one does. 13 to 33 m: at 7 to 19 it
       read as a drainage canal against a 900 m island. */
    const w0 = 13 + t0 * 20, w1 = 13 + t1 * 20;
    const n0x = -dz / len * w0, n0z = dx / len * w0;
    const n1x = -dz / len * w1, n1z = dx / len * w1;
    const y0 = riverSurface(t0), y1 = riverSurface(t1);
    verts.push(x0 - n0x, y0, z0 - n0z, x0 + n0x, y0, z0 + n0z, x1 + n1x, y1, z1 + n1z);
    verts.push(x0 - n0x, y0, z0 - n0z, x1 + n1x, y1, z1 + n1z, x1 - n1x, y1, z1 - n1z);
    const v0 = i * 0.6, v1 = (i + 1) * 0.6;
    uvs.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  const nrm = tex.waterNormal.clone();
  nrm.needsUpdate = true;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(2, 2);
  groups.river = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: 0x1b3a44, roughness: 0.14, metalness: 0.2,
    normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 1.4, transparent: true, opacity: 0.94,
  }));
  groups.river.name = 'river';
  scene.add(groups.river);
}

/* Roads: every resolved link in the vault, bundled through its two regions and
   laid on the ground as one merged ribbon. 3,518 separate line meshes would be
   3,518 draw calls; merged, it is one. */
function buildRoads() {
  const verts = [], uvs = [];
  const W = 0.48;
  for (const r of plan.roadPts) {
    /* A trunk road is as wide as the number of links it carries — log, because
       Knowledge-to-Projects carries 700 and People-to-Templates carries 2. */
    const w = r.kind === 'trunk' ? 1.4 + Math.log10(Math.max(1, r.weight)) * 1.5
            : r.kind === 'rail' ? 1.1 : r.kind === 'path' ? 0.42 : W;
    const pts = r.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * w, nz = dx / len * w;
      verts.push(x0 - nx, y0, z0 - nz, x0 + nx, y0, z0 + nz, x1 + nx, y1, z1 + nz);
      verts.push(x0 - nx, y0, z0 - nz, x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz);
      const v0 = 0, v1 = len / 2;
      uvs.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex.cobble.diffuse, normalMap: tex.cobble.normal, roughnessMap: tex.cobble.arm,
    /* 0.55, not 0.9: three thousand bundled roads at full opacity turned the
       ground into a ball of wool that read louder than the mountain. A road
       should be a trace of a link, not the subject of the frame. */
    roughness: 1, metalness: 0, transparent: true, opacity: 0.34, depthWrite: false,
    color: 0xd6cab4,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  groups.roads = new THREE.Mesh(g, mat);
  groups.roads.receiveShadow = true;
  groups.roads.name = 'roads';
  scene.add(groups.roads);

  /* Traffic: one dot per forty links, moving along the road it belongs to. The
     count is proportional to the real link count and nothing else; a road with
     no links has no traffic on it. */
  const roads = plan.roadPts.filter(r => r.kind === 'road');
  const n = Math.min(MAX_TRAFFIC, Math.floor(roads.length / 14));
  const a = new Float32Array(n * 3), b = new Float32Array(n * 3), off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = roads[Math.floor(i * roads.length / n)];
    const p0 = r.pts[0], p1 = r.pts[r.pts.length - 1];
    a.set([p0[0], p0[1] + 0.35, p0[2]], i * 3);
    b.set([p1[0], p1[1] + 0.35, p1[2]], i * 3);
    off[i] = (hash32('t' + i) % 1000) / 1000;
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(a, 3));
  tg.setAttribute('aEnd', new THREE.BufferAttribute(b, 3));
  tg.setAttribute('aOff', new THREE.BufferAttribute(off, 1));
  groups.traffic = new THREE.Points(tg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `attribute vec3 aEnd; attribute float aOff; uniform float uTime;
      varying float vF;
      void main(){
        float t = fract(uTime * 0.035 + aOff);
        vF = sin(t * 3.14159);
        vec3 p = mix(position, aEnd, t);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = 90.0 / -mv.z; }`,
    fragmentShader: `varying float vF; uniform float uNight;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(mix(vec3(0.85,0.82,0.74), vec3(1.0,0.78,0.42), uNight),
                            vF * (0.35 + uNight * 0.5)); }`,
  }));
  groups.traffic.frustumCulled = false;
  scene.add(groups.traffic);
}

/* Cranes: a mast and a turning jib, instanced. One crane is one open item. */
function buildCranes() {
  const mat = makeWallMaterial('brick', { tint: 0x6e6154 });
  pools.craneMast = new THREE.InstancedMesh(unitBox().scale(0.32, 1, 0.32), mat, MAX_CRANES);
  pools.craneJib = new THREE.InstancedMesh(unitBox().translate(0, -0.5, 0).scale(6.5, 0.32, 0.32), mat, MAX_CRANES);
  /* In their own group, so the sea's reflection pass can switch them off with
     one flag along with everything else that costs a second render and cannot
     be seen through 256 px of normal-mapped distortion. */
  groups.cranesGroup = new THREE.Group();
  scene.add(groups.cranesGroup);
  for (const p of [pools.craneMast, pools.craneJib]) {
    p.count = 0; p.castShadow = true; p.frustumCulled = false;
    const add = (n, s) => p.geometry.setAttribute(n,
      new THREE.InstancedBufferAttribute(new Float32Array(MAX_CRANES * s), s));
    add('aSize', 3); add('aLit', 1); add('aSeed', 1);
    groups.cranesGroup.add(p);
  }
  cranes.length = 0;
  for (const c of (plan.boardsCranes || [])) cranes.push(c);
  for (const q of plan.quarters) for (const c of q.cranes) cranes.push(c);
  pools.craneMast.count = pools.craneJib.count = Math.min(MAX_CRANES, cranes.length);
  /* aSize is what the wall material tiles its texture by; left at zero every
     crane would sample one texel and read as flat plastic. */
  for (let i = 0; i < pools.craneMast.count; i++) {
    pools.craneMast.geometry.attributes.aSize.setXYZ(i, 0.32, cranes[i].h, 0.32);
    pools.craneJib.geometry.attributes.aSize.setXYZ(i, 6.5, 0.32, 0.32);
  }
  pools.craneMast.geometry.attributes.aSize.needsUpdate = true;
  pools.craneJib.geometry.attributes.aSize.needsUpdate = true;
}
const cranes = [];

/* Smoke: chimneys over the Dev Logs valley and over any quarter that is alive.
   A strand only emits when its own source is actually working — the valley is
   clear on a day nothing was written there, which is the point. */
function buildSmoke() {
  const pos = new Float32Array(MAX_SMOKE * 3);
  const seed = new Float32Array(MAX_SMOKE);
  const act = new Float32Array(MAX_SMOKE);
  smokeSources.length = 0;
  const src = [];
  for (const s of plan.structures) if (s.chimneyTop && s.lit > 0) src.push({ p: s.chimneyTop, ref: s });
  for (const q of plan.quarters) src.push({ p: { x: q.x, y: q.y + 6, z: q.z }, ref: q, town: q.town });
  let i = 0;
  for (const s of src) {
    const n = 10;
    s.start = i;
    for (let k = 0; k < n && i < MAX_SMOKE; k++, i++) {
      pos.set([s.p.x, s.p.y, s.p.z], i * 3);
      seed[i] = (hash32('sm' + i) % 1000) / 1000;
      act[i] = s.town ? (s.town.is_live ? 1 : 0) : 1;
    }
    s.count = i - s.start;
    smokeSources.push(s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aAct', new THREE.BufferAttribute(act, 1));
  g.setDrawRange(0, i);
  groups.smoke = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `attribute float aSeed; attribute float aAct; uniform float uTime;
      varying float vA;
      void main(){
        float life = fract(uTime * 0.08 + aSeed);
        vA = aAct * (1.0 - life) * 0.5;
        vec3 p = position;
        p.y += life * 26.0;
        p.x += sin(aSeed * 30.0 + life * 3.0) * life * 12.0;
        p.z += cos(aSeed * 21.0 + life * 2.2) * life * 9.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (60.0 + life * 340.0) / -mv.z; }`,
    fragmentShader: `varying float vA; uniform float uNight;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = vA * (1.0 - d * 2.0);
        gl_FragColor = vec4(mix(vec3(0.72,0.66,0.6), vec3(0.3,0.32,0.4), uNight), a * 0.5); }`,
  }));
  groups.smoke.frustumCulled = false;
  scene.add(groups.smoke);
}
const smokeSources = [];

/* The harbour's live half: quarter records, their pick proxies, their drones and
   their boats. Rebuilt when the set of towns changes, which is rare. */
function rebuildHarbour() {
  for (const q of plan.quarters) quarters.set(q.id, q);
  if (!groups.picks) { groups.picks = new THREE.Group(); scene.add(groups.picks); }
  groups.picks.clear();
  const pickGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const pickMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const q of plan.quarters) {
    const p = new THREE.Mesh(pickGeo, pickMat);
    p.position.set(q.x, q.y + 5, q.z);
    p.scale.set(q.radius + 4, 14, q.radius + 4);
    p.userData.quarterId = q.id;
    groups.picks.add(p);
  }
  buildTradeLandmarks();
  for (const t of world.towns) applyLive(t);
}


/* =============================================================================
   THE LIVING LAYER — life.js, fed from the same data everything else here is

   THE ONE RULE THIS SECTION EXISTS TO KEEP: life.js has no random population
   size anywhere in it, and it must not acquire one here. Every count below is a
   function of something a person could go and check —

     people   f(sessions)          per project, capped by its class, over the island
     cars     f(link weight)       the trunk network's own weights, divided down
     animals  f(dormant projects)  one grazer per project nobody has opened in months
     birds    f(vault notes)       the island's own note count, divided down
     parrots  f(aviary_projects)   one pair per aviary project, and only there
     robots   0                    see THE ROBOT DECISION below

   THE ROBOT DECISION, stated once so nobody re-derives it: `populate.robots` is
   ZERO and stays zero. A live agent is one aircraft — that is the rule the drone
   pass established and the number the caption, `__drones()` and the fleet all
   agree on. Putting a ground robot on the quay for the same agent would draw the
   same fact twice and the island's robot count would be a lie about how many
   agents are running. There is no second real population that ground robots
   could stand for, so there are none. `setLiveAgents()` is still called on the
   tick the agent list changes — it is the module's documented contract and it
   costs one line — and at robots: 0 it has nothing to map, which is correct.
   ========================================================================== */
/* THE BUDGET, and it is a budget and not a taste. docs/LIFE.md measures ~403
   draw calls and 3.7 M triangles at ITS full counts on a bare street; this
   island is already spending its frame on 1,177 structures, 45 landmarks and a
   prop shell. So the two levers the doc names as the cheapest are both pulled
   down from their defaults — `maxSkinned` 40 -> 24 (the gate this pass was given)
   and `rigid` 8 -> 3 (worth about 0.25 M triangles, integration note 6) — and
   the counts below are capped on top of that. The gate is <= 90 extra draw calls
   for the whole layer; `__life().draws` reports the real figure. */
const LIFE_MAX_SKINNED = 24;
const LIFE_RIGID = 3;
/* Per-quality ceilings, applied AFTER the data has spoken. Medium is half of
   high across the board, for the same reason KIT_MAX_LOD0 is: the auto-degrade
   drops to medium to save a machine, and a layer that ignored it would defeat it. */
const LIFE_CAPS = {
  high:   { humans: 140, cars: 56, animals: 34, birds: 90, parrots: 24 },
  medium: { humans:  70, cars: 28, animals: 18, birds: 48, parrots: 12 },
  low:    { humans:  30, cars: 12, animals:  8, birds: 24, parrots:  6 },
};
/* A single project may house at most this many sessions' worth of residents.
   Without it the chat folder's 341 sessions would be a third of the island's
   population on its own, which is true of the DATA and false about the place —
   a quarter is fifteen metres of shoreline. This is the "capped by class" half
   of `residents = f(sessions)`. */
const LIFE_SESSION_CAP = 40;
const LIFE_PER_RESIDENT = 5;     // capped sessions per person on the ground
const LIFE_PER_CAR = 28;         // link-weight per vehicle
/* How long a project has to have been shut before it is DORMANT and its plot is
   grazed. 30 days, and the two bands are the two herds: a project asleep for a
   month is a sheep in the quarry, one asleep for six weeks is a cow out on the
   steppe with the orphan ruins. Both boundaries are read off the real spread on
   this machine — 20 dormant projects, 31 to 62 days idle — so both herds exist
   rather than one of them being an empty field. */
const DORMANT_DAYS = 30;
const DORMANT_OLD_DAYS = 45;
const LIFE_NOTES_PER_BIRD = 5;   // vault notes per bird over the island

/** How many days since a town last did anything. Infinity if it never has. */
function townIdleDays(t) {
  const ms = Date.parse(t.last_active || '');
  return isFinite(ms) ? (Date.now() - ms) / 86400000 : Infinity;
}
/** The parrots' only address: the projects `aviary_projects` in config.json
    names. Off by default — an empty setting means no flock at all, and every
    caller below is already written to handle a count of zero. */
const AVIARY_RE = (() => {
  const cfg = (typeof window !== 'undefined' && window.WERKSTADT_CONFIG) || {};
  try { return cfg.aviary_projects ? new RegExp(cfg.aviary_projects, 'i') : null; }
  catch (e) { console.warn('config.json: aviary_projects is not a valid regex', e); return null; }
})();
const isAviary = t => !!AVIARY_RE && AVIARY_RE.test((t.path || '') + ' ' + (t.name || ''));

/** The arterial network, as polylines carrying their real link weight.
    ONLY the trunks and the heaviest local roads, and that is not a shortcut:
    `_findJunctions` is O(roads^2 x points^2) (docs/LIFE.md, Known limits), and
    the plan draws 859 of them. Forty is a network a person can see traffic
    moving on and a solve that finishes in a frame. */
const LIFE_MAX_ROADS = 40;
/** THE QUAY, at a given distance seaward of the quarters' own frontage. Not an
    invented line: the project quarters all stand along one shore, sorted north
    to south, and the run in front of them IS the waterfront. Taken twice — the
    pavement at 2.4 m out and the carriageway at 5.6 m — because that is what a
    quay is: a road with a footway between it and the houses. */
const QUAY_BAND = 9;      // metres of shore one quay node stands for
const QUAY_STEP = 5;      // metres between nodes after subdivision
function harbourQuay(offset) {
  /* THE SEAWARD ROW ONLY. The harbour is built in rows — biomes.js places a
     quarter at `coastX - 14 - row * 27` — so walking every quarter in z order
     produces a line that zigzags 130 m inland and back between rows, which is
     not a waterfront, it is a scribble. One node per band of shore, at the
     quarter that stands FURTHEST seaward in it, is the front row and nothing
     else. */
  const front = new Map();
  for (const q of plan.quarters) {
    const band = Math.round(q.z / QUAY_BAND);
    const have = front.get(band);
    if (!have || q.x > have.x) front.set(band, q);
  }
  const rows = [...front.values()].sort((a, b) => a.z - b.z);
  const pts = [];
  for (const q of rows) {
    const x = q.x + q.radius + offset;
    const y = landAt(x, q.z);
    if (y < SEA + 0.4) continue;                    // never in the surf
    pts.push([x, y + 0.06, q.z]);
  }
  /* Subdivided to a real pavement resolution. life.js spreads its crowd over
     the NODES it is given, so a promenade described by one point every twenty
     metres holds a fifth of the people a path described every five does — and
     the two would then be populated by how finely the host happened to draw
     them rather than by how much pavement there is. */
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / QUAY_STEP));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      out.push([x, landAt(x, z) + 0.06, z]);
    }
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}
function lifeRoads() {
  const trunks = plan.roadPts.filter(r => r.kind === 'trunk');
  /* A local road is one link between two notes, so its weight is 1. The trunks
     carry the bundles and state their own. */
  const locals = plan.roadPts.filter(r => r.kind === 'road' && r.pts.length > 1);
  const chosen = trunks.concat(locals.slice(0, Math.max(0, LIFE_MAX_ROADS - trunks.length)));
  const roads = chosen.map(r => Object.assign(r.pts.map(p => [p[0], p[1] + 0.06, p[2]]),
                                              { weight: Math.max(1, r.weight || 1) }));
  /* THE WATERFRONT ROAD, and its weight is the OTHER link graph. Everything
     above is the vault's note graph — trunk roads between regions carrying the
     links they bundle. `/api/world`'s `roads[]` is the PROJECT graph: which two
     projects share sessions, and how many. Every one of those pairs is two
     quarters on this shore, so the traffic they generate runs along the quay
     and nowhere else. One road, weight = the whole project graph. */
  const quay = harbourQuay(5.6);
  if (quay.length > 1) {
    let w = 0;
    for (const r of (world.roads || [])) w += r.weight || 0;
    roads.push(Object.assign(quay, { weight: Math.max(1, w) }));
  }
  return clipRoadsAroundPlazas(roads, lifePlazas());
}

/* How far OUTSIDE a plaza the nearest carriageway centre line may run. A lane
   is offset LANE_HALF (2.6 m, docs/LIFE.md) from the centre line and a car is
   about two metres wide, so five metres of kerb is the first number at which no
   part of a vehicle can be over the flagstones. */
const PLAZA_KERB = 5;

/** THE MARKET SQUARE IS NOT A ROAD. Every trunk road on this island starts at
    the Boards fortress — `plan.roadPts`'s trunks all begin at (20, -85), which
    is the fortress court's own centre — so handing them to `addRoads()` whole
    laid two lanes straight across the plaza and drove the traffic over the
    stalls. `life.js` has no `carsAllowed` flag: it takes plazas on
    `addWalkways()` only, for the crowd, and knows nothing about them when it
    builds lanes. So the routing is done HERE, on the polylines before they
    become lanes: a point inside a plaza (plus PLAZA_KERB) is dropped and the
    polyline is CUT into the runs that survive it. A surviving run keeps its
    parent's weight — the traffic that used to cross the square is the same
    traffic, it now stops at the edge of it — and a run of fewer than two points
    is not a road and is discarded. */
function clipRoadsAroundPlazas(roads, plazas) {
  if (!plazas.length) return roads;
  const blocked = (p) => plazas.some(pz =>
    Math.hypot(p[0] - pz.center[0], p[2] - pz.center[2]) < pz.radius + PLAZA_KERB);
  const out = [];
  for (const road of roads) {
    let run = [];
    for (const p of road) {
      if (blocked(p)) {
        if (run.length > 1) out.push(Object.assign(run, { weight: road.weight }));
        run = [];
      } else run.push(p);
    }
    if (run.length > 1) out.push(Object.assign(run, { weight: road.weight }));
  }
  return out;
}

/** The open places on this island, solved once and shared by the three callers
    that must agree about them: the road clip above, `addWalkways()`'s plaza
    list, and `__vehicles()`'s check. Two copies of this list would be two
    different squares. */
let lifePlazaList = null;
function lifePlazas() {
  if (!lifePlazaList) { const c = fortressCourt(); lifePlazaList = c ? [c] : []; }
  return lifePlazaList;
}

/** The pavements: the footway along the quay, and the People village paths.
    It is the ground `world-street.png` is shot from. */
function lifeWalkways() {
  const lines = [];
  const quay = harbourQuay(2.4);
  if (quay.length > 1) lines.push(quay);
  /* Every People-village path, exactly as the plan drew it: one per person note,
     each running from that cottage's door down to the village green. The far end
     of each is a single-link node, which life.js reads as a DOOR — somebody
     arriving there stops and looks at it, which is what a front door is. */
  for (const r of plan.roadPts) {
    if (r.kind === 'path' && r.pts.length > 1) lines.push(r.pts.map(p => [p[0], p[1] + 0.05, p[2]]));
  }
  return lines;
}

/** The Boards fortress court, read off the fortress's own curtain wall rather
    than off a constant copied out of biomes.js: the 28 `wall` records with
    `fortress: true` ARE the four sides, so their bounding box is the castle and
    the court is what is inside it. Returns null if the vault has no Boards note. */
function fortressCourt() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0, n = 0;
  for (const s of plan.structures) {
    if (s.kind !== 'wall' || !s.fortress) continue;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
    y = s.y; n++;
  }
  if (n < 4) return null;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const r = Math.max(6, Math.min(x1 - x0, z1 - z0) / 2 - 4);   // inside the walls
  return { center: [cx, y + 0.05, cz], radius: r };
}

/** A pasture polygon around a family of plan records — the quarry cuts, or the
    orphan ruins. Grown outward by `pad` and returned as a rectangle, because
    the field IS the ground those records stand on and a convex hull of eight
    boxes buys nothing a rectangle does not. Null when the family is empty. */
function lifeField(kind, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (const s of plan.structures) {
    if (s.kind !== kind) continue;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
    z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
    n++;
  }
  if (!n) return null;
  x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}

/** Every count the layer is given, in one place, so the rule can be read. */
function lifeCounts() {
  const cap = LIFE_CAPS[quality] || LIFE_CAPS.medium;
  const towns = world.towns;
  let sessions = 0;
  for (const t of towns) sessions += Math.min(t.sessions || 0, LIFE_SESSION_CAP);
  let weight = 0;
  for (const r of (world.roads || [])) weight += r.weight || 0;
  const dormant = towns.filter(t => !t.is_live && townIdleDays(t) > DORMANT_DAYS);
  const sheep = dormant.filter(t => townIdleDays(t) <= DORMANT_OLD_DAYS).length;
  const cows  = dormant.length - sheep;
  const wm = towns.filter(isAviary).length;
  const share = cap.animals / Math.max(1, sheep + cows);
  return {
    humans: Math.min(cap.humans, Math.round(sessions / LIFE_PER_RESIDENT)),
    cars:   Math.min(cap.cars,   Math.round(weight / LIFE_PER_CAR)),
    /* Both herds scaled by the SAME factor when the pair is over the cap, so the
       ratio between "asleep two months" and "asleep half a year" survives it. */
    sheep:  Math.min(sheep, Math.round(sheep * Math.min(1, share))),
    cows:   Math.min(cows,  Math.round(cows  * Math.min(1, share))),
    birds:  Math.min(cap.birds, Math.round(vault.notes.length / LIFE_NOTES_PER_BIRD)),
    /* A PAIR per aviary project — life.js flies parrots in pairs, so an
       odd number would leave one bird flying alone with a mate index of -1. */
    parrots: Math.min(cap.parrots, wm * 2),
    robots: 0,                                    // see THE ROBOT DECISION above
    /* A DOG IS A WALKER'S dog — life.js carries it at a pedestrian's own
       position — so the count is a share of the pedestrians and nothing else.
       One in twelve, and life.js drops them all if the pavement has no shops
       on it, which is the errand half of the same rule. */
    dogs: Math.round(Math.min(cap.humans, Math.round(sessions / LIFE_PER_RESIDENT)) / 12),
    /* Cats sit on the RIM of a square, so there are none without one, and this
       island has exactly the squares fortressCourt() finds. */
    cats: lifePlazas().length * 2,
    raw: { sessions, weight, dormant: dormant.length, wm },
  };
}

/* "Town class or larger" is globe.js's own boundary read on the same number:
   classOf() calls a place a town at 1,000 tool calls, and this harbour's tool
   calls are every project on the island put together. */
const LIFE_TOWN_CALLS = 1000;
/* One hedge per this many metres of the line it is planted along — a hedge is a
   LENGTH of planting, so the count comes off the pavement's own length and not
   off how many polylines the plan happened to draw it with. */
const LIFE_M_PER_BUSH = 18;
const LIFE_M_PER_FENCE_BUSH = 22;

/** Ground length of a list of [x, y, z] polylines, in island metres. */
function polyLength(lines) {
  let s = 0;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][2] - l[i - 1][2]);
  }
  return s;
}

/** THE STATICS' DATA TRIGGERS for the island's one square.

    docs/LIFE.md "Where each prop is allowed to appear" states each trigger in a
    settlement's terms; the harbour IS the settlement, and the mapping from this
    host's facts onto it is written down in the same table so the two cannot
    drift. Nothing is invented and nothing is decorative.

    NO café tables and NO playground here, and that is the data rule holding
    rather than a gap: life.js puts café tables on a square whose TRADE is food
    and a playground on a RESIDENTIAL one, and the only square on this island is
    the Boards fortress court, which is neither. The eateries are quarters on
    the quay and no quarter has a square of its own. */
function lifeSquareProps() {
  let calls = 0;
  for (const t of world.towns) calls += t.tool_calls || 0;
  const big = calls >= LIFE_TOWN_CALLS;
  return {
    fountain: big,
    kiosk: big,
    /* ON A BUS ROUTE: `/api/world`'s `roads[]` is the project graph — which two
       projects share sessions — and it is the only thing on this island that
       says the harbour is connected to anywhere. */
    busstop: big && (world.roads || []).length > 0,
  };
}

/** One Life.load(), then the calls in the one order docs/LIFE.md allows:
    roads, walkways and pastures BEFORE populate (populate sizes its instanced
    meshes from what is going to stand in them), and addSkyBox after the scene
    is built and before populate (it raycasts for roosts, and populate sizes the
    perched-parrot mesh from the parrot count it recorded). */
let lifeCounted = null;
async function buildLife() {
  if (LIFE_OFF || !plan || !world) return;
  const counts = lifeCounts();
  lifeCounted = counts;
  try {
    life = await Life.load(renderer, scene, {
      manifestUrl: MANIFEST,
      /* ONE getHeight, the world's own — integration note 1. Clamped to the sea,
         because a walker on the quay must stand on the quay and not in the water
         the terrain function keeps descending into. */
      getHeight: (x, z) => Math.max(SEA, landAt(x, z)),
      seed: 7,
      maxSkinned: LIFE_MAX_SKINNED,
      rigid: LIFE_RIGID,
      shadows: quality === 'high' ? 8 : 0,
    });
  } catch (e) {
    life = null;
    console.warn('the living layer did not load:', e.message);
    return;
  }
  life.addRoads(lifeRoads());
  /* THE SQUARE GOES THROUGH addPlaza, between the roads and the walkways, and
     that is the only call that places its furniture: the kiosk and the shelter
     stand against the OPEN lanes, so the lanes have to exist first. `carsAllowed`
     is left alone deliberately — `clipRoadsAroundPlazas()` above already took
     the carriageways out of the square, on the polylines, before they ever
     became lanes, and asking for the cut twice would be two answers to one
     question. */
  const squareProps = lifeSquareProps();
  for (const pz of lifePlazas()) life.addPlaza(pz.center, pz.radius, squareProps);
  /* 0.84 m is the plan's own `path` ribbon width (2 x 0.42 in buildRoads), and
     the number matters: without it life.js guesses +/-0.9 m and a third of the
     crowd walks on the grass beside a pavement 84 cm wide. The plazas are NOT
     passed a second time here: addPlaza() above registered them and addWalkways
     wires everything in `life.plazaSpecs` as well as its own argument. */
  const walk = lifeWalkways();
  life.addWalkways(walk, [], {
    width: 0.84,
    /* A HEDGE ALONG THE PROMENADE, by its real length: the quay and the village
       paths are the pavement, and life.js plants on the side of each that is
       further from the traffic. */
    bushes: Math.min(40, Math.round(polyLength(walk) / LIFE_M_PER_BUSH)),
  });
  const quarry = lifeField('quarry', 16);
  const steppe = lifeField('ruin', 20);
  /* THE FENCE LINE IS THE FIELD'S OWN PERIMETER — `lifeField` returns a
     rectangle round the records that are really standing there, so the hedge
     count is that rectangle's edge and not a number chosen for it. */
  const fenceBushes = (poly) => Math.min(16, Math.round(
    polyLength([poly.concat([poly[0]]).map(([x, z]) => [x, 0, z])]) / LIFE_M_PER_FENCE_BUSH));
  if (quarry) life.addPasture(quarry, { sheep: counts.sheep, bushes: fenceBushes(quarry) });
  if (steppe) life.addPasture(steppe, { cows: counts.cows, bushes: fenceBushes(steppe) });
  /* THE SKY over the whole island, not over the harbour: birds belong to the
     land, and the roost raycast wants every roof and tree crown on it.

     A REAL DEFECT IN life.js, WORKED AROUND HERE because that file is frozen
     for this pass. `_findPerches()` raycasts the scene with a bare
     `new THREE.Raycaster()`, which has no `camera` — and three's `Sprite.raycast`
     dereferences `raycaster.camera.matrixWorld` unconditionally. One sprite
     anywhere in the scene and the call throws, which on this island it did:
     45 town-name plaques and every drone's tag are sprites, addSkyBox died on
     the first of them, and the whole layer came up with no birds, no parrots
     and — because the throw aborted buildLife() before populate() — no people
     and no cars either. Nothing in the error says "sprite".
     The fix belongs in life.js (`ray.camera = camera`, one line). Until then the
     sprite-bearing groups are unparented for the duration of the call. Nothing
     is lost by it: a sign and a name tag are not somewhere a bird can sit. */
  const stashed = [];
  for (const o of scene.children.slice()) {
    let sprite = false;
    o.traverse(c => { if (c.isSprite) sprite = true; });
    if (sprite) { stashed.push(o); scene.remove(o); }
  }
  try {
    life.addSkyBox({ min: [-HALF, SEA + 6, -HALF], max: [HALF, SEA + 96, HALF] },
                   { birds: counts.birds, parrots: counts.parrots });
  } finally {
    for (const o of stashed) scene.add(o);
  }
  seatParrots(counts.parrots);
  life.populate({ humans: counts.humans, cars: counts.cars, robots: counts.robots,
                  dogs: counts.dogs, cats: counts.cats });
  life.setNight(nightAmount);
  pushLiveAgentsToLife();
}

/** THE PARROTS BELONG TO THE AVIARY PROJECTS, and life.js takes ONE sky box for the
    whole flock — so the placement is done here, on the flock it just built, and
    it is the only thing this file reaches into that module's state for. Every
    parrot pair is put over one aviary quarter; the birds are left where
    the module scattered them, which is the whole island.
    KNOWN LIMIT, and it is honest to say it: this seats them, it does not tether
    them. Parrots flock only with parrots and steer only for their own mate, so
    over several minutes a pair will drift across the harbour. At dusk they go
    looking for a roost like everything else. */
function seatParrots(want) {
  if (!life || !life.flock || !want) return;
  const homes = plan.quarters.filter(q => isAviary(q.town));
  if (!homes.length) return;
  let k = 0;
  for (const b of life.flock) {
    if (!b.parrot) continue;
    const q = homes[Math.floor(k / 2) % homes.length];
    b.pos.set(q.x + (k % 2 ? 2.4 : -2.4), q.y + 12 + (k % 3) * 2.5, q.z + (k % 2 ? -1.8 : 1.8));
    k++;
  }
}

/** Every live agent on the island, in the shape setLiveAgents() asks for. At
    robots: 0 this maps nothing — see THE ROBOT DECISION — and it is called
    anyway, on the same tick the agent list changes, because that is the
    module's contract and the day the robot count stops being zero is the day a
    missing call here would be a silent bug rather than a visible one. */
function pushLiveAgentsToLife() {
  if (!life) return;
  const list = [];
  for (const q of quarters.values()) {
    for (const a of q.town.live_agents || []) {
      list.push({ id: q.id + '/' + a.id, label: a.label || a.id,
                  pos: new THREE.Vector3(q.x, q.y, q.z) });
    }
  }
  life.setLiveAgents(list);
}


/* =============================================================================
   LIVE — the parts of the world that change while you watch
   ========================================================================== */
function applyLive(t) {
  const q = quarters.get(t.id);
  if (!q) return;
  q.town = t;
  const lit = t.is_live ? 1 : 0;
  /* Through the record's OWN pool, not through pools.plaster: since the house
     palettes landed a quarter's fourteen houses are spread over four pools, and
     writing every one of them into the plaster pool's attribute would light
     whichever unrelated buildings happen to hold those indices there. */
  const touched = new Set();
  for (const b of q.blocks) {
    if (b.index < 0 || !b.pool) continue;
    const arr = b.pool.userData.aLit;
    if (arr.getX(b.index) !== lit) { arr.setX(b.index, lit); touched.add(arr); }
  }
  for (const a of touched) a.needsUpdate = true;
  /* A trade town's landmark, its wings and its props follow the same switch its
     houses do — and its flywheel starts turning at the same instant. */
  if (q.trade) relightLandmarks(t);
  const act = groups.smoke && groups.smoke.geometry.attributes.aAct;
  if (act) {
    for (const s of smokeSources) {
      if (s.ref === q) {
        for (let i = s.start; i < s.start + s.count; i++) act.setX(i, lit);
        act.needsUpdate = true;
      }
    }
  }
  syncDrones(q);
}

function droneKey(townId, agentId) { return townId + '/' + agentId; }

function syncDrones(q) {
  const want = new Set();
  for (const a of q.town.live_agents) {
    const key = droneKey(q.id, a.id);
    want.add(key);
    const have = drones.get(key);
    if (!have) { drones.set(key, makeDrone(q, a)); continue; }
    have.agent = a;
    /* THE CRAFT FOLLOWS THE WORK. An agent that was idle and has just opened an
       Edit is flying the wrong airframe until it is remade — and remaking one is
       a synchronous kit.make(), which is exactly why drones.js bakes everything
       at load. Only when the variant actually CHANGED: rebuilding a craft that
       is still doing the same thing would restart its bob and its strobe every
       two seconds and the fleet would breathe in unison. */
    if (droneKit && droneVariant(a, have.isMain) !== have.variant) {
      removeDrone(key);
      drones.set(key, makeDrone(q, a));
    }
  }
  for (const [key, d] of drones) {
    if (d.townId === q.id && !want.has(key)) removeDrone(key);
  }
}

const droneBody = new THREE.OctahedronGeometry(0.55, 0);
const droneRing = new THREE.TorusGeometry(0.9, 0.06, 6, 16);
const underGeo = new THREE.PlaneGeometry(1, 1);

/* =============================================================================
   THE FLEET — drones.js where the glowing octahedrons used to be

   An agent over its own quarter used to be an octahedron, a torus and an
   additive quad: at 600 m a gold dot and a blue dot, and at 40 m three
   primitives. It is now Beri's own ORNIS airframe wearing the attachments that
   say what the craft is DOING — the silhouette carries the meaning and the
   colour is the second channel (docs/DRONES.md, "The one rule").

   WHICH CRAFT, from the real payload and nothing else:
     main session      -> `orchestrator`, the biggest craft, a lit ring under it
     agent, tool open  -> `worker.<family>` of the tool it is running RIGHT NOW
     agent, idle       -> `agent`, a cargo pod slung below, tier band by model
   The families are replay.js's own (`Read` -> read, `Edit`/`Write` -> edit,
   `Grep`/`Glob` -> search, `Bash` -> shell, everything else -> net), so a craft
   over the harbour and the same tool's effect in the session city are one
   vocabulary. `?drones=orbs` keeps the old three primitives — it is the B half
   of the frame-rate A/B and nothing else.
   ========================================================================== */
/* The tool -> variant map. Same table replay.js:FAMILY carries, resolved
   straight to a craft so no second classification exists. */
const DRONE_FAMILY = {
  Read: 'read', NotebookRead: 'read', WebFetch: 'read',
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit', MultiEdit: 'edit',
  Grep: 'search', Glob: 'search', Search: 'search', WebSearch: 'search',
  Bash: 'shell', PowerShell: 'shell',
};
/* Which model this agent is, for the `agent` craft's tier band — gold for opus,
   silver for sonnet, bronze for haiku. Read off the agent's own label, which is
   the only place the payload carries it; anything unrecognised is silver, which
   is drones.js's documented default and not an error. */
const droneTier = (a) => {
  const s = ((a.label || '') + ' ' + (a.id || '')).toLowerCase();
  return /opus/.test(s) ? 'opus' : /haiku/.test(s) ? 'haiku' : 'sonnet';
};
/** The craft one live agent flies, from its role and the tool it has open. */
function droneVariant(agent, isMain) {
  if (isMain) return 'orchestrator';
  const open = (agent.inflight && agent.inflight.length) ? agent.inflight[0].tool : agent.last_tool;
  const fam = open ? DRONE_FAMILY[open] : null;
  /* An in-flight tool with no family of its own — an MCP call, a Task, a
     Skill — is a `net` craft: the tallest silhouette in the fleet, which is
     exactly right for something reaching outside the machine. An agent with
     nothing open is not working, and flies the plain `agent` craft. */
  if (agent.inflight && agent.inflight.length) return 'worker.' + (fam || 'net');
  return 'agent';
}

function makeDrone(q, agent) {
  if (!groups.drones) { groups.drones = new THREE.Group(); scene.add(groups.drones); }
  const isMain = String(agent.id).startsWith('main');
  const seed = hash32(String(agent.id));
  let g, variant = null, tagAnchor = null;
  if (droneKit) {
    variant = droneVariant(agent, isMain);
    g = droneKit.make(variant, { tier: droneTier(agent), seed: seed % 100000 });
    tagAnchor = g.userData.tagAnchor;
  } else {
    /* THE ORB FALLBACK, unchanged: `?drones=orbs`, and whatever a failed kit
       load leaves behind. Three primitives and no dependency. */
    g = new THREE.Group();
    g.add(new THREE.Mesh(droneBody, new THREE.MeshBasicMaterial({ color: isMain ? 0xf0e4c6 : 0xbfc9d4 })));
    const ring = new THREE.Mesh(droneRing, new THREE.MeshBasicMaterial({
      color: isMain ? GOLD : 0x8fa6b8, transparent: true, opacity: isMain ? 0.9 : 0.6 }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    /* An additive quad, not a PointLight: one real light would push every shader
       in the scene onto another lit path for one glow. */
    const under = new THREE.Mesh(underGeo, new THREE.MeshBasicMaterial({
      color: isMain ? GOLD : COOL, transparent: true, opacity: isMain ? 0.32 : 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.4;
    under.scale.setScalar(isMain ? 5 : 3);
    g.add(under);
  }
  /* Scale is NOT set here — updateDroneLabels() solves it every frame from the
     camera distance, the same way a sign is solved, so it never depends on how
     close the camera happens to be standing (see that function's own comment). */
  const label = makeLabel(clipName(agent.label || agent.id, 26), isMain ? '#f2d99a' : '#cfe0ea', 30);
  /* THE TAG HANGS ON THE CRAFT'S OWN ANCHOR — integration note 4. Every variant
     puts it at the right height for ITS silhouette, including the net craft's
     mast, so the hard-coded 3.0 / 2.4 only survives for the orbs. */
  /* The craft group is scaled by its variant (drones.js `g.scale.setScalar(s)`,
     0.7 for a worker to 1.8 for the orchestrator) and a sprite hung under it
     inherits that — so the pixel solve in updateDroneLabels() has to divide it
     back out, or every worker's tag is 30% under its target cap height and the
     orchestrator's is 80% over. `tagScale` is that divisor and it is 1 on the
     orb path, where the label hangs straight off the group. */
  let tagY = isMain ? 3.0 : 2.4, tagScale = 1;
  if (tagAnchor) {
    tagAnchor.add(label);
    label.position.set(0, 0, 0);
    tagScale = g.scale.x || 1;
    tagY = tagAnchor.position.y * tagScale;
  } else {
    g.add(label);
    label.position.y = tagY;
  }
  groups.drones.add(g);
  const d = { townId: q.id, agent, group: g, isMain, variant, working: false,
              orbit: (seed % 6283) / 1000,
              radius: q.radius + (isMain ? 6 : 10 + (seed % 200) / 20),
              height: q.y + (isMain ? 20 : 14 + (seed % 130) / 13),
              label, tagY, tagScale, trail: null, prev: new THREE.Vector3() };
  if (droneKit) d.trail = claimTrail();
  return d;
}

function removeDrone(key) {
  const d = drones.get(key);
  if (!d) return;
  if (droneKit && d.variant) droneKit.remove(d.group);
  groups.drones.remove(d.group);
  /* The label is this file's canvas texture whatever the craft is; the craft's
     own geometry and materials belong to the kit and are shared, so only the
     orb path has anything of its own to dispose. */
  if (d.label.material) { if (d.label.material.map) d.label.material.map.dispose(); d.label.material.dispose(); }
  if (!d.variant) {
    d.group.traverse(o => {
      if (o !== d.label && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
  if (d.trail) releaseTrail(d.trail);
  const i = labelRegistry.indexOf(d.label);
  if (i >= 0) labelRegistry.splice(i, 1);
  drones.delete(key);
}

/* -----------------------------------------------------------------------------
   TRAILS — one light ribbon per craft, out of the TAIL and not the centre

   Integration note 5: the ribbon is read off `userData.trailAnchor`, which sits
   at the back of the airframe, so a craft banking into its orbit lays its trail
   behind itself rather than out of its own belly.

   ONE draw call for the whole fleet. Every craft owns a fixed slice of one
   LineSegments buffer and writes its own points into it; a slot nobody holds is
   collapsed to a single point at the origin, which draws nothing. A ribbon per
   drone would be a draw call per drone, and at ten live agents that is ten
   calls for a decoration. */
const TRAIL_SLOTS = 16;         // craft that may leave a trail at once
const TRAIL_SEG = 20;           // points of memory per craft, ~2 s at the orbit's speed
const TRAIL_STEP = 0.10;        // seconds between samples
let trailMesh = null, trailPos = null, trailAlpha = null;
const trailFree = [];
function buildDroneTrails() {
  const n = TRAIL_SLOTS * (TRAIL_SEG - 1) * 2;      // two vertices per segment
  const g = new THREE.BufferGeometry();
  trailPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  trailAlpha = new THREE.BufferAttribute(new Float32Array(n), 1);
  g.setAttribute('position', trailPos);
  g.setAttribute('aAlpha', trailAlpha);
  trailMesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0x8fd0e8) } },
    vertexShader: `attribute float aAlpha; varying float vA;
      void main(){ vA = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main(){ if (vA <= 0.002) discard; gl_FragColor = vec4(uColor, vA * 0.55); }`,
  }));
  trailMesh.frustumCulled = false;
  trailMesh.name = 'drone-trails';
  scene.add(trailMesh);
  for (let i = 0; i < TRAIL_SLOTS; i++) trailFree.push(i);
}
const claimTrail = () => (trailFree.length ? { slot: trailFree.pop(), pts: [], acc: 0 } : null);
function releaseTrail(t) {
  /* Collapsed before it goes back in the pool, or the next craft to take this
     slot inherits the last one's ribbon for a frame. */
  const base = t.slot * (TRAIL_SEG - 1) * 2;
  for (let i = 0; i < (TRAIL_SEG - 1) * 2; i++) trailAlpha.setX(base + i, 0);
  trailAlpha.needsUpdate = true;
  trailFree.push(t.slot);
}
const _tp = new THREE.Vector3();
function stepDroneTrails(dt) {
  if (!trailMesh) return;
  let dirty = false;
  for (const d of drones.values()) {
    const t = d.trail;
    if (!t) continue;
    t.acc += dt;
    if (t.acc >= TRAIL_STEP) {
      t.acc = 0;
      const anchor = d.group.userData.trailAnchor;
      if (anchor) anchor.getWorldPosition(_tp); else _tp.copy(d.group.position);
      t.pts.unshift(_tp.x, _tp.y, _tp.z);
      if (t.pts.length > TRAIL_SEG * 3) t.pts.length = TRAIL_SEG * 3;
    }
    const base = t.slot * (TRAIL_SEG - 1) * 2;
    const have = Math.floor(t.pts.length / 3);
    for (let s = 0; s < TRAIL_SEG - 1; s++) {
      const v = base + s * 2;
      if (s + 1 < have) {
        trailPos.setXYZ(v,     t.pts[s * 3],       t.pts[s * 3 + 1],       t.pts[s * 3 + 2]);
        trailPos.setXYZ(v + 1, t.pts[s * 3 + 3],   t.pts[s * 3 + 4],       t.pts[s * 3 + 5]);
        const a = 1 - s / (TRAIL_SEG - 1);
        trailAlpha.setX(v, a); trailAlpha.setX(v + 1, a * (1 - 1 / (TRAIL_SEG - 1)));
      } else {
        trailAlpha.setX(v, 0); trailAlpha.setX(v + 1, 0);
      }
    }
    dirty = true;
  }
  if (dirty) { trailPos.needsUpdate = true; trailAlpha.needsUpdate = true; }
}

/** A tool started or ended in this town: the craft flying for that agent turns
    its own effect on or off — integration note 6, `setWorking` rather than a
    beam this file fires itself. A pulse names a town and not an agent, so every
    craft over that town answers, which is what "the town is working" means. */
function setTownWorking(townId, on) {
  for (const d of drones.values()) {
    if (d.townId !== townId) continue;
    if (d.working === on) continue;
    d.working = on;
    const set = d.group.userData.setWorking;
    if (set) set(on);
  }
}

/* Both feeds. /api/world/stream moves the harbour; /api/vault lights a note's
   windows the moment Beri saves it. Neither is required for the world to stand. */
function openStreams() {
  try {
    const src = new EventSource(API_STREAM);
    src.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.kind === 'world') {
        for (const patch of msg.towns) {
          const q = quarters.get(patch.id);
          if (!q) continue;
          Object.assign(q.town, patch);
          applyLive(q.town);
        }
        recount();
        /* On the SAME tick the agent list changed — docs/LIFE.md, note 4. */
        pushLiveAgentsToLife();
      }
      /* THE THREE LIVE EVENTS THIS ISLAND MATERIALISES ON. `pulse` is one tool
         call: it lights the town's craft and, when it names a file this quarter
         has never touched, prints a building. `pulse_end` cools the glow.
         A deletion arrives on this stream as a `pulse` whose tool is `delete`
         (server.py: tool_pulses) and on /api/stream as its own `file_deleted`
         kind; both are accepted, because which one a given server build emits
         is not this file's business. */
      else if (msg.kind === 'pulse') onWorldPulse(msg);
      else if (msg.kind === 'pulse_end') setTownWorking(msg.town, false);
      else if (msg.kind === 'file_deleted') derezPath(msg.path);
    };
  } catch (e) { /* no server: the land still stands */ }

  try {
    const vs = new EventSource(API_VAULT);
    vs.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch (err) { return; }
      if (ev.kind === 'file_deleted') { derezPath(ev.path); return; }
      onVaultEvent(ev);
    };
  } catch (e) { /* same */ }
}

/* ONE SAVED NOTE, arriving. Split out of the EventSource handler above so the
   harness can run exactly this without a transport in the way — __vaultEvent()
   below is this function and nothing else, and a test that called
   Interior.noteChanged() directly would be testing the interior rather than
   the seam this file owns. */
function onVaultEvent(ev) {
  const id = String(ev.path || '').replace(/\.md$/i, '');
  const rec = plan.index.get(id);
  /* THE ROOM IS TOLD FIRST. A bridge and a lighthouse are model instances
     with no `pool` and no lit-window attribute, so the guard below drops
     their events entirely — and a reader standing in one of them would
     never have seen his own note change. */
  Interior.noteChanged(id);
  if (!rec || rec.index == null || rec.index < 0 || !rec.pool) return;
  /* A saved note's windows come on and stay on: it IS a recently touched
     file now, which is exactly what a lit window means everywhere else. */
  rec.pool.userData.aLit.setX(rec.index, 1);
  rec.pool.userData.aLit.needsUpdate = true;
  liveNotes.set(id, Date.now());
}


/* =============================================================================
   THE MATERIALISATION — a file appears, a building is printed onto the island

   Ported from the session city's print pass (docs/HANDOFF.md, PRINT-DOC), and
   the one thing that pass proved is carried over first: DURATION IS THE WHOLE
   FEATURE. Everything else here existed at 1.2 s and nobody could see any of
   it. A print runs 2.5 s for a one-storey shed and 4.0 s for a tall one, it
   leaves a mark on the GROUND (the only thing findable from a wide shot), and
   the lens is allowed to come and look at it out of a budget it cannot exceed.

   THE ONE RULE, unchanged from the rest of this file: nothing is invented. A
   building prints when a live session touches a file its quarter has never seen
   before — the pulse is the event, the town is the quarter, the file is the
   address. A file that is deleted derezzes. Nothing prints on a timer.

   WHAT IS DIFFERENT FROM THE CITY, and why. The city's buildings are one
   instanced box each and the cut is a `discard` on a per-instance float, which
   is free. An island building is a BuildingKit LOD0 group — some four hundred
   merged boxes with a baked facade — and there is no per-instance float to ride
   on. So the cut is a horizontal CLIPPING PLANE on that one building's own
   materials, which is the same picture (a hard horizontal edge that descends)
   with no shader of ours in it. The materials are CLONED for the print and the
   shared ones put back at the end, because they belong to the kit and every
   other building of that style wears them. The first print of a given style
   pays one shader link for the clipping define; every print after it hits the
   program cache.
   ========================================================================== */
const PRINT_MIN_SECONDS = 2.5;
const PRINT_MAX_SECONDS = 4.0;
const PRINT_FLOOR_REF = 4;        // floors at which the print reaches its ceiling
const RIG_HOLD_SECONDS = 0.6;     // the lattice holds the finished shell...
const RIG_DISSOLVE_SECONDS = 0.5; // ...then shortens from the top: the ground lets go last
const RIG_AFTER = RIG_HOLD_SECONDS + RIG_DISSOLVE_SECONDS;
const FLASH_HOLD_SECONDS = 0.2;   // white-hot out of the printer...
const FLASH_COOL_SECONDS = 3.0;   // ...three seconds down into the island's own palette
const GLITCH_SECONDS = 0.4;       // the derez pre-roll: it tears before it falls
const MAX_PRINT_RIGS = 6;         // lasers and lattices on screen at once
const RIG_STRUTS = 8;             // 4 corner posts + 4 belt rails
const LASER = new THREE.Color(0xff2a1a);
/* THE FOCUS BUDGET, the same shape city.js charges its close-ups against: a
   cue is refused unless the last two minutes would still be at least 60% wide
   shot. The cooldown is that budget written as a rate. Budget spent -> no cue,
   and the building still prints. */
const FOCUS_WINDOW = 120;
const FOCUS_BUDGET = FOCUS_WINDOW * 0.40;
const PRINT_CUE_COOLDOWN = 12;
const CUE_TAIL_SECONDS = 1;
const focusSpent = [];            // { t, dur } of every cue granted

const printJobs = [];
const printRigs = [];
const livePrints = new Map();     // normalised file path -> the record it built
let lastPrint = null;             // what `P` replays
let printCueUntil = 0, cuePrev = null;
let derezCount = 0;

const smoothstep01 = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
const normPath = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
const printSecondsFor = floors => PRINT_MIN_SECONDS +
  (PRINT_MAX_SECONDS - PRINT_MIN_SECONDS) * Math.min(1, floors / PRINT_FLOOR_REF);

/* --- the rigs -------------------------------------------------------------
   Pooled, exactly as the city pools them: six sets of lasers on screen at once
   is already more red than this frame wants, and a seventh simultaneous file
   simply prints without its own scaffolding. Built lazily, on the first print
   of the session — an island that never goes live never pays for them. */
function buildPrintRigs() {
  if (printRigs.length) return;
  const bar = new THREE.PlaneGeometry(1, 1); bar.rotateX(-Math.PI / 2);
  const post = new THREE.BoxGeometry(1, 1, 1); post.translate(0, 0.5, 0);
  const head = new THREE.BoxGeometry(1, 1, 1);
  const shaft = new THREE.PlaneGeometry(1, 1); shaft.translate(0, -0.5, 0);
  const ring = new THREE.RingGeometry(0.62, 0.80, 40); ring.rotateX(-Math.PI / 2);
  groups.prints = new THREE.Group();
  groups.prints.name = 'prints';
  scene.add(groups.prints);
  for (let i = 0; i < MAX_PRINT_RIGS; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: LASER, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    /* The shimmer is the only part with its own material: the heat over the
       scanline sits at a tenth of the lasers' brightness, and one shared
       opacity cannot say both things. */
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0xff7a4a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const lines = [new THREE.Mesh(bar, mat), new THREE.Mesh(bar, mat)];
    const heads = [new THREE.Mesh(head, mat), new THREE.Mesh(head, mat)];
    const beams = [new THREE.Mesh(shaft, mat), new THREE.Mesh(shaft, mat)];
    const struts = [];
    for (let k = 0; k < RIG_STRUTS; k++) struts.push(new THREE.Mesh(post, mat));
    const ringM = new THREE.Mesh(ring, mat);
    const haze = new THREE.Mesh(bar, hazeMat);
    for (const m of lines.concat(heads, beams, struts)) g.add(m);
    g.add(ringM); g.add(haze);
    g.visible = false;
    groups.prints.add(g);
    printRigs.push({ group: g, mat, hazeMat, lines, heads, beams, struts,
                     ring: ringM, haze, job: null });
  }
  buildSparks();
}
const freeRig = () => printRigs.find(r => !r.job) || null;

/* How thick a laser has to be in WORLD units to still be `minPx` pixels wide on
   screen. The island's default framing stands 720 m back, where a 4.5 cm bar is
   a hundredth of a pixel and simply is not there. Solved off the lens rather
   than guessed: at distance d a pixel covers 2*d*tan(fov/2)/height world units. */
const _lw = new THREE.Vector3();
function laserWidth(x, y, z, minPx) {
  const d = Math.max(1, camera.position.distanceTo(_lw.set(x, y, z)));
  const px = 2 * d * Math.tan(camera.fov * Math.PI / 360) /
             Math.max(1, renderer.domElement.height / renderer.getPixelRatio());
  return px * minPx;
}

/* --- sparks and voxels ----------------------------------------------------
   One additive Points cloud, one draw call, shared by the two things that throw
   particles here: the shower off the cutting edge while a building prints, and
   the red voxels a deleted file comes apart into. Integrated in JS rather than
   in a shader because the pool is 400 and the loop is measured in microseconds,
   and because a CPU pool can be emitted into from an event handler. */
const SPARK_MAX = 400;
let sparks = null, sparkPos = null, sparkCol = null, sparkSize = null;
const sparkV = new Float32Array(SPARK_MAX * 3);
const sparkLife = new Float32Array(SPARK_MAX);
const sparkMax = new Float32Array(SPARK_MAX);
const sparkGrav = new Float32Array(SPARK_MAX);
let sparkNext = 0;
function buildSparks() {
  const g = new THREE.BufferGeometry();
  sparkPos = new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 3), 3);
  sparkCol = new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 3), 3);
  sparkSize = new THREE.BufferAttribute(new Float32Array(SPARK_MAX), 1);
  g.setAttribute('position', sparkPos);
  g.setAttribute('color', sparkCol);
  g.setAttribute('aSize', sparkSize);
  sparks = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aSize; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = aSize;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, aSize * 260.0 / -mv.z); }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ if (vA <= 0.0) discard;
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(vC, (1.0 - d * 2.0)); }`,
    vertexColors: true,
  }));
  sparks.frustumCulled = false;
  sparks.name = 'sparks';
  groups.prints.add(sparks);
}
function emitSpark(x, y, z, vx, vy, vz, color, size, life, grav) {
  if (!sparks) return;
  const i = sparkNext = (sparkNext + 1) % SPARK_MAX;
  sparkPos.setXYZ(i, x, y, z);
  sparkCol.setXYZ(i, color.r, color.g, color.b);
  sparkV[i * 3] = vx; sparkV[i * 3 + 1] = vy; sparkV[i * 3 + 2] = vz;
  sparkLife[i] = life; sparkMax[i] = life; sparkGrav[i] = grav;
  sparkSize.setX(i, size);
}
function stepSparks(dt) {
  if (!sparks) return;
  let any = false;
  for (let i = 0; i < SPARK_MAX; i++) {
    if (sparkLife[i] <= 0) continue;
    sparkLife[i] -= dt;
    any = true;
    if (sparkLife[i] <= 0) { sparkSize.setX(i, 0); continue; }
    sparkV[i * 3 + 1] += sparkGrav[i] * dt;
    sparkPos.setXYZ(i,
      sparkPos.getX(i) + sparkV[i * 3] * dt,
      sparkPos.getY(i) + sparkV[i * 3 + 1] * dt,
      sparkPos.getZ(i) + sparkV[i * 3 + 2] * dt);
    /* The size IS the fade — one attribute doing two jobs, because a point that
       shrinks as it dims is what a cooling ember does. */
    sparkSize.setX(i, sparkSize.getX(i) * 0.985 * (sparkLife[i] / sparkMax[i] > 0.15 ? 1 : 0.9));
  }
  if (any) { sparkPos.needsUpdate = true; sparkCol.needsUpdate = true; sparkSize.needsUpdate = true; }
}

/* --- where a live building stands ----------------------------------------
   The next free plot of the quarter's OWN street grid, one row further inland
   than its planned houses reach — which is the quarter's back yard and is where
   biomes.js already puts its garden trees. The grid's three numbers come from
   biomes.js (HOUSE_GRID) and are not copied, or a materialising house would go
   through its neighbour's wall. */
function livePlot(q) {
  const { COLS, COL_PITCH, ROW_PITCH } = HOUSE_GRID;
  const planned = q.blocks.length;
  const k = planned + (q.printed ? q.printed.size : 0);
  const nRows = Math.max(1, Math.ceil(planned / COLS));
  const row = Math.floor(k / COLS) - Math.floor(planned / COLS) + 1;
  const col = k % COLS;
  const x = q.x - (nRows / 2 + row) * ROW_PITCH;
  const z = q.z + (col - (COLS - 1) / 2) * COL_PITCH;
  return heightAt(x, z) < SEA + 1.2 ? null : { x, z, y: landAt(x, z) };
}

/* How tall a file's building is, from the ONE datum a first-touch pulse
   carries: which tool touched it. A file that was read is a shed; a file that
   was written is a house. The city grows a building by a floor per Edit — it
   can, because its buildings are one instanced box. Growing one of these means
   re-merging four hundred boxes and re-baking its AO, which is not affordable
   per keystroke, so an island building is printed once at the height its first
   tool call earns. Stated as a known limit in docs/HANDOFF.md. */
const PRINT_FLOORS = { Read: 1, NotebookRead: 1, Grep: 1, Glob: 1, Bash: 1, PowerShell: 1 };
const floorsForTool = tool => PRINT_FLOORS[tool] || 2;

/* THE COLLIDER A PRINTED BUILDING GETS. The planned buildings are picked
   through the invisible box pools, whose instance counts come from the plan —
   a building that did not exist when the plan was made is not in them, which
   is why a live building used to be visible and unclickable (docs/HANDOFF.md,
   "Known limits"). Growing those pools at runtime is a `buildWorld()` change;
   one box per printed building in `groups.picks`, which is the same group the
   quarter proxies already live in and is already in `pick()`'s ray list, is
   the same answer at a hundredth of the cost. */
const _pickGeo = new THREE.BoxGeometry(1, 1, 1);
const _pickMat = new THREE.MeshBasicMaterial({ visible: false });
/* THEIR OWN GROUP, and that is not tidiness — it is the bug this cost.
   `rebuildHarbour()` calls `groups.picks.clear()` whenever the set of towns or
   their trades changes, which the 30 s re-read does routinely while a cold
   `/api/world` fills its trade cache. Colliders parented there were silently
   swept: `__printed()` read `built: 49, clickable: 1` one refresh after it read
   48 / 48, and nothing in the frame looked any different. This group belongs to
   the print records and nothing else empties it. */
function printPickGroup() {
  if (!groups.prints) { groups.prints = new THREE.Group(); groups.prints.name = 'printPicks'; scene.add(groups.prints); }
  return groups.prints;
}
function addPrintCollider(rec) {
  if (!scene) return;
  const picks = printPickGroup();
  const h = rec.d.floors * BuildingKit.styles[rec.d.style].floorH + 1.4;
  const box = new THREE.Mesh(_pickGeo, _pickMat);
  box.position.set(rec.d.position[0], rec.d.position[1] + h / 2, rec.d.position[2]);
  box.rotation.y = rec.d.rotationY;
  box.scale.set(rec.d.footprint[1] + 0.6, h, rec.d.footprint[0] + 0.6);
  box.userData.printRec = rec;
  picks.add(box);
  rec.collider = box;
}
function dropPrintCollider(rec) {
  if (rec && rec.collider) { printPickGroup().remove(rec.collider); rec.collider = null; }
}

/** One live building: the plan record, its kit descriptor, and the LOD0 object
    that will be printed. Returns the kitRecs entry, or null if there is nowhere
    for it to stand. */
function addLiveBuilding(q, path, tool, meta) {
  if (!kit || !kitRecs.length) return null;
  const plot = livePlot(q);
  if (!plot) return null;
  const h32 = hash32(path);
  /* A SEEDED building already knows its whole history, so it is given the height
     it would have GROWN to rather than the height its first call earns — one
     kit.make() instead of one per edit replayed. A live pulse has no history and
     falls back to the tool. */
  const floors = Math.min(LIVE_MAX_FLOORS, (meta && meta.floors) || floorsForTool(tool));
  /* The plan's own house dimensions and the harbour's own palettes: a live
     building has to be indistinguishable from a planned one the moment its
     lattice comes off, or the island grows a district of odd-looking sheds. */
  const s = {
    kind: 'house', x: plot.x, y: plot.y, z: plot.z,
    w: 3.0 + (h32 % 15) / 10, d: 2.8 + ((h32 >>> 4) % 12) / 10,
    h: 2.45 * floors, rot: ((h32 >>> 8) % 209) / 1000 - 0.104,
    seed: (h32 % 100000) / 100000, lit: 1, roof: true,
    ref: { type: 'town', id: q.id, title: q.town.name, town: q.town },
    live: true, livePath: path,
  };
  const d = kitDescribe(s, 0);
  if (!d) return null;
  /* A SEEDED building is NOT built at LOD0 here. Forty-eight of them at load
     would be forty-eight full kit.make() calls — four hundred merged boxes and
     a baked facade each — and updateKitLod() would then dispose all but the
     nearest 22 on its very next solve. It goes into kitRecs at band 1 and the
     ONE forced solve at the end of the seed decides which of them is close
     enough to be real. A live print still builds its object immediately,
     because the print is a shot of THAT geometry being cut. */
  const obj = (meta && meta.noBuild) ? null : makeKitBuilding(d);
  if (obj) kitLod0.add(obj);
  /* PINNED: updateKitLod() would otherwise dispose this the moment the camera
     is more than 60 m away, half way through its own print. The pin is dropped
     when the print lands and the building joins the ordinary LOD ladder. */
  const rec = { d, band: obj ? 0 : 1, obj, dist: obj ? 0 : 1e9, pin: !!obj, live: true, path, q, struct: s,
                /* WHAT THE CAPTION SAYS. `at` is wall-clock ms of the first
                   touch, `agent` the label of whoever made it, `edits` how many
                   times the file has been written since. A seeded building
                   carries the real numbers off the town's replay; one printed
                   live carries `now` and the pulse's own agent. */
                first: { tool, at: (meta && meta.at) || Date.now(),
                         agent: (meta && meta.agent) || null },
                edits: (meta && meta.edits) || 0, seeded: !!(meta && meta.seeded) };
  kitRecs.push(rec);
  addPrintCollider(rec);
  return rec;
}

/* HOW TALL A LIVE BUILDING MAY GET. kitDescribe() clamps a planned house to
   nine floors off the plan's own metres; a printed one grows a floor per Edit
   and stops at the same nine, or one file under heavy work becomes the tower
   the harbour is read by. */
const LIVE_MAX_FLOORS = 9;
let growMs = 0, growCount = 0;

/** A FILE THAT KEEPS BEING WRITTEN GETS ANOTHER FLOOR. The old rule was one
    print at the height its FIRST tool call earned, and the reason given was
    cost: growing one of these means re-merging the kit's four hundred boxes
    and re-baking its AO, which is not affordable per keystroke. It is
    affordable per EDIT — this is one `kit.make()` for one building, the same
    call `updateKitLod()` already makes every time that building crosses the
    60 m band, and the cost is measured into `__printed().growMs` rather than
    asserted. Only the one building is rebuilt; the instanced far field is
    re-solved once, which it would be anyway. */
function growLiveBuilding(rec) {
  if (!rec || rec.gone || rec.d.floors >= LIVE_MAX_FLOORS) return false;
  const t0 = performance.now();
  rec.d.floors++;
  rec.struct.h = 2.45 * rec.d.floors;
  rec.struct.kitTop = rec.d.position[1] + rec.d.floors * BuildingKit.styles[rec.d.style].floorH;
  if (rec.obj) {
    kitLod0.remove(rec.obj);
    disposeKitBuilding(rec.obj);
    rec.obj = makeKitBuilding(rec.d);
    kitLod0.add(rec.obj);
  }
  dropPrintCollider(rec);
  addPrintCollider(rec);
  updateKitLod(true);
  growMs = performance.now() - t0;
  growCount++;
  return true;
}

/** Start printing one building. `y0` is where the cut starts (the roof line)
    and `y1` where it lands (the ground). */
function startPrint(rec, wantRig) {
  const top = rec.d.position[1] + rec.d.floors * BuildingKit.styles[rec.d.style].floorH + 1.4;
  const base = rec.d.position[1] - 0.2;
  for (const j of printJobs) if (j.rec === rec) return j;   // already printing
  buildPrintRigs();
  /* THE CUT. `keep everything ABOVE the plane`, and the plane starts over the
     ridge and descends to the ground — so at t=0 nothing of the building exists
     and at t=1 all of it does. The plane is this job's own object; nothing else
     in the scene has a clipping plane at all. */
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -top);
  const mats = [];
  rec.obj.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const shared = o.material;
    const clone = shared.clone();
    clone.clippingPlanes = [plane];
    clone.clipShadows = true;
    o.material = clone;
    mats.push({ mesh: o, shared, clone,
                emissive: clone.emissive ? clone.emissive.clone() : null,
                intensity: clone.emissiveIntensity });
  });
  const job = { rec, plane, mats, top, base, t: 0, life: printSecondsFor(rec.d.floors),
                after: 0, flash: -1, rig: null, sparkAt: 0 };
  printJobs.push(job);
  lastPrint = rec;
  if (wantRig !== false) {
    const r = freeRig();
    if (r) { r.job = job; job.rig = r; r.group.visible = true; }
    cuePrint();
  }
  return job;
}

/* Two laser lines riding the print plane, the emitters that fire them, the
   lattice under it, the heat over it and the ring around it on the ground.
   `after` is 0 while the print runs and counts up once it has landed. */
function placeRig(r, j, y, k, after) {
  const rc = j.rec.d, T = { w: rc.footprint[1], d: rc.footprint[0] };
  const cx = rc.position[0], cz = rc.position[2];
  const w = T.w * 1.5, d = T.d * 1.5;
  const t = clock();
  /* Never thinner than the 4.5 cm the close view was tuned on, and never
     thinner than 2.4 px on the lens — which is what makes a print visible in
     the 720 m wide shot at all. */
  const thin = Math.max(0.045, laserWidth(cx, y, cz, 2.4));
  /* THE EMITTERS DESCEND. Over the first fifth of the print two heads come down
     out of the hovering altitude onto the roof line; after that they ride the
     plane down with the beams they are firing. */
  const drop = smoothstep01(0, 0.18, k);
  const headY = (j.top + 2.6) + (y + 0.55 - (j.top + 2.6)) * drop;
  /* The pair scissors across the footprint as the plane descends, so the print
     reads as being DRAWN rather than as a bar sliding down. */
  const off = d * 0.5 * Math.cos(k * Math.PI * 3.0);
  for (let i = 0; i < 2; i++) {
    const sgn = i ? 1 : -1;
    const z = cz + sgn * off;
    r.lines[i].position.set(cx, y, z);
    r.lines[i].scale.set(w, 1, thin);
    const hx = cx + sgn * w * 0.42;
    r.heads[i].position.set(hx, headY, z);
    r.heads[i].scale.set(0.14, 0.10, 0.14);
    /* The beam is a flat quad turned to face the lens, so it never edges out. */
    const bm = r.beams[i];
    bm.position.set(hx, headY - 0.05, z);
    bm.scale.set(thin * 1.6, Math.max(0.02, headY - 0.05 - y), 1);
    bm.rotation.y = Math.atan2(camera.position.x - cx, camera.position.z - cz);
  }
  /* THE LATTICE — four corner posts up to the printed line plus four rails at a
     belt height that rises with it. Struts and not a box, so it reads as
     scaffolding holding a shell up rather than as a crate around it. */
  const sh = Math.max(0.02, y - j.base);
  const belt = j.base + sh * 0.55;
  for (let i = 0; i < 4; i++) {
    const px = cx + (i & 1 ? 1 : -1) * T.w * 0.5;
    const pz = cz + (i & 2 ? 1 : -1) * T.d * 0.5;
    r.struts[i].position.set(px, j.base, pz);
    r.struts[i].scale.set(0.022, sh, 0.022);
    const rail = r.struts[4 + i];
    const acrossX = i < 2;
    rail.position.set(acrossX ? cx : cx + (i & 1 ? 1 : -1) * T.w * 0.5, belt,
                      acrossX ? cz + (i & 1 ? 1 : -1) * T.d * 0.5 : cz);
    rail.scale.set(acrossX ? T.w : 0.018, 0.018, acrossX ? 0.018 : T.d);
  }
  /* THE GROUND RING. Always on the ground, always the footprint's own size, and
     it pulses — the ONE mark that says "this lot is printing" from 700 m up.
     The effect itself never will be; this is what makes the event findable. */
  r.ring.position.set(cx, j.base + 0.06, cz);
  const rs = Math.max(T.w, T.d) * (1.15 + 0.10 * Math.sin(t * 7));
  r.ring.scale.set(rs, 1, rs);
  /* HEAT: a wide dim quad just over the cutting line, breathing. */
  r.haze.position.set(cx, y + 0.06, cz);
  r.haze.scale.set(w * 1.25, 1, d * 1.25);
  r.hazeMat.opacity = after > 0 ? 0 : 0.18 + 0.07 * Math.sin(t * 11);

  if (after > 0) {
    /* The lattice holds the finished shell, then shortens FROM THE TOP: the
       ground lets go last, which is the only way scaffolding ever comes off. */
    const a = smoothstep01(RIG_HOLD_SECONDS, RIG_AFTER, after);
    for (const m of r.lines.concat(r.heads, r.beams)) m.visible = false;
    r.ring.visible = false;
    const full = Math.max(0.02, j.top - j.base);
    for (let i = 0; i < 4; i++) r.struts[i].scale.y = full * (1 - a);
    for (let i = 4; i < 8; i++) r.struts[i].position.y = j.base + full * (1 - a);
    r.mat.opacity = 0.9 * (1 - a);
  } else {
    for (const m of r.lines.concat(r.heads, r.beams)) m.visible = true;
    r.ring.visible = true;
    r.mat.opacity = 0.9;
  }
}

/** One frame of every print, every flash and every derez on the island. */
function stepPrints(dt) {
  stepSparks(dt);
  stepDerez(dt);
  for (let i = printJobs.length - 1; i >= 0; i--) {
    const j = printJobs[i];
    if (j.flash >= 0) {
      /* THE FLASH. White-hot for a fifth of a second, then three seconds down
         into the warm palette the island already has. It is driven on the same
         cloned materials the cut rides, which is why they are not restored
         until it is over. 0.55 and not 2.6: with bloom on, three facades
         flashing at 2.6 blow the whole frame to white (PRINT-DOC). */
      j.flash += dt;
      const v = 1 - smoothstep01(FLASH_HOLD_SECONDS, FLASH_HOLD_SECONDS + FLASH_COOL_SECONDS, j.flash);
      for (const m of j.mats) {
        if (!m.clone.emissive) continue;
        m.clone.emissive.setRGB(m.emissive.r + v, m.emissive.g + v * 0.86, m.emissive.b + v * 0.62);
        m.clone.emissiveIntensity = m.intensity + v * 0.55;
      }
      /* The lattice comes off on ITS own clock (1.1 s) and not on the flash's
         (3.2 s), and the rig slot goes back in the pool with it — six rigs held
         three times too long is a burst of prints with no scaffolding on it. */
      if (j.rig) {
        j.after += dt;
        placeRig(j.rig, j, j.base, 1, j.after);
        if (j.after >= RIG_AFTER) { j.rig.group.visible = false; j.rig.job = null; j.rig = null; }
      }
      if (v > 0.002) continue;
      endPrint(j);
      printJobs.splice(i, 1);
      continue;
    }
    j.t += dt;
    const k = Math.min(1, j.t / j.life);
    const y = j.top + (j.base - j.top) * k;
    j.plane.constant = -y;
    if (j.rig) placeRig(j.rig, j, y, k, 0);
    /* Sparks off the cutting edge — where the laser is actually touching the
       shell, not over the building in general. Three every 60 ms is a shower of
       about twenty over a whole print, and not a fog. */
    if (k < 1 && j.t - j.sparkAt > 0.06) {
      j.sparkAt = j.t;
      const T = { w: j.rec.d.footprint[1], d: j.rec.d.footprint[0] };
      for (let s = 0; s < 3; s++) {
        emitSpark(j.rec.d.position[0] + (Math.random() - 0.5) * T.w * 1.3, y,
                  j.rec.d.position[2] + (Math.random() - 0.5) * T.d * 1.3,
                  (Math.random() - 0.5) * 1.6, 0.9 + Math.random() * 1.8, (Math.random() - 0.5) * 1.6,
                  LASER, 0.045 + Math.random() * 0.04, 0.35 + Math.random() * 0.35, -4.5);
      }
    }
    if (k >= 1) { j.flash = 0; j.after = 0.0001; }
  }
}

/** The print is over: shared materials back, the pin dropped, and the building
    handed to the ordinary LOD ladder. */
function endPrint(j) {
  for (const m of j.mats) { m.mesh.material = m.shared; m.clone.dispose(); }
  j.mats.length = 0;
  if (j.rig) { j.rig.group.visible = false; j.rig.job = null; j.rig = null; }
  j.rec.pin = false;
  /* Forced, because the pin is what was keeping this out of the instanced set
     and the bands are otherwise only re-solved on camera travel. */
  updateKitLod(true);
}

/* --- the camera cue -------------------------------------------------------
   A materialisation is the one thing this island can show that a map cannot, so
   when one starts from the wide shot the lens goes and looks. Every guard the
   rest of this file already obeys applies:
     - it never interrupts a shot that is already close, a flight, the interior,
       free fly, or a camera a person has their hand on;
     - it is charged to the FOCUS_BUDGET, so cues cannot exceed 40% of any
       two-minute window. Budget spent -> no cue, and the building still prints;
     - it puts the lens BACK where it found it, which the search fly-to does not
       have to do because a person asked for that one.
   Multiple prints at once are framed as a GROUP — the aim is the union of every
   lot printing this instant, so three files materialising together are one shot
   of three rather than three fights over the lens. */
function cuePrint() {
  if (Interior.busy() || free.on || CAMERA_FIXED) return;
  const now = clock();
  if (now < printCueUntil) return;
  if (cam.fly || performance.now() < cam.manualUntil) return;
  const dur = PRINT_MAX_SECONDS + CUE_TAIL_SECONDS;
  while (focusSpent.length && focusSpent[0].t < now - FOCUS_WINDOW) focusSpent.shift();
  let spent = 0;
  for (const f of focusSpent) spent += f.dur;
  if (spent + dur > FOCUS_BUDGET) return;
  let x = 0, z = 0, n = 0;
  for (const j of printJobs) { x += j.rec.d.position[0]; z += j.rec.d.position[2]; n++; }
  if (!n) return;
  cuePrev = { target: camTarget.clone(), dist: cam.dist, phi: cam.phi };
  flyTo(x / n, z / n, 34, 0.30);
  printCueUntil = now + dur + PRINT_CUE_COOLDOWN;
  focusSpent.push({ t: now, dur });
  /* Back to the wide shot when the print is over, unless the person has taken
     the camera in the meantime — `cuePrev` is cleared by any manual input. */
  setTimeout(() => {
    if (!cuePrev || free.on || Interior.busy() || performance.now() < cam.manualUntil) { cuePrev = null; return; }
    /* Flown back, not snapped back: the same eased flight that brought the lens
       in, run the other way, so the cue reads as one move out and one move home
       rather than as a cut. */
    flyTo(cuePrev.target.x, cuePrev.target.z, cuePrev.dist, cuePrev.phi);
    cuePrev = null;
  }, dur * 1000);
}
/** Is the lens inside a print cue this instant — the shot harness's own test. */
const printCued = () => !!cuePrev;

/* --- derez ----------------------------------------------------------------
   A file stops existing. The construct does not simply fall apart: for 0.4 s it
   TEARS first — the clipping plane is driven to a random height every 35 ms,
   which is a scanline artifact for free because the cut is already a horizontal
   edge — and only then do the voxels go. Never a fade: a fade says the renderer
   stopped drawing it, and this has to say the construct's time was up. */
const derezJobs = [];
function derezPath(path) {
  const rec = livePrints.get(normPath(path));
  if (!rec || rec.gone) return false;
  rec.gone = true;
  livePrints.delete(normPath(path));
  /* The collider goes with the file, not with the geometry: a box you can click
     on a building that is tearing itself apart would open a caption about a
     path that no longer exists. */
  dropPrintCollider(rec);
  if (selected && selected.kind === 'print' && selected.rec === rec) closeCaption();
  /* A building still printing is finished first, so the two do not fight over
     one plane; its own job is dropped and this one takes the materials over. */
  for (let i = printJobs.length - 1; i >= 0; i--) {
    if (printJobs[i].rec === rec) { endPrint(printJobs[i]); printJobs.splice(i, 1); }
  }
  if (!rec.obj) { rec.obj = makeKitBuilding(rec.d); kitLod0.add(rec.obj); }
  rec.pin = true;
  buildPrintRigs();
  const top = rec.d.position[1] + rec.d.floors * BuildingKit.styles[rec.d.style].floorH + 1.4;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -rec.d.position[1] + 0.2);
  const mats = [];
  rec.obj.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const shared = o.material;
    const clone = shared.clone();
    clone.clippingPlanes = [plane];
    o.material = clone;
    mats.push({ mesh: o, shared, clone });
  });
  derezJobs.push({ rec, plane, mats, t: 0, tear: 0, top });
  derezCount++;
  return true;
}
function stepDerez(dt) {
  for (let i = derezJobs.length - 1; i >= 0; i--) {
    const j = derezJobs[i];
    j.t += dt;
    if (j.t < GLITCH_SECONDS) {
      j.tear += dt;
      if (j.tear > 0.035) {
        j.tear = 0;
        const y = j.rec.d.position[1] + Math.random() * (j.top - j.rec.d.position[1]);
        j.plane.constant = -y;
      }
      continue;
    }
    /* The voxels. Red, thrown out of the footprint the building stood on, and
       then the building is gone — geometry disposed, record out of kitRecs, the
       instanced field rebuilt without it. */
    const p = j.rec.d.position, T = j.rec.d.footprint;
    for (let s = 0; s < 26; s++) {
      emitSpark(p[0] + (Math.random() - 0.5) * T[1] * 1.4,
                p[1] + Math.random() * (j.top - p[1]),
                p[2] + (Math.random() - 0.5) * T[0] * 1.4,
                (Math.random() - 0.5) * 3.2, 0.6 + Math.random() * 3.2, (Math.random() - 0.5) * 3.2,
                LASER, 0.07 + Math.random() * 0.06, 0.6 + Math.random() * 0.7, -6.5);
    }
    for (const m of j.mats) { m.mesh.material = m.shared; m.clone.dispose(); }
    kitLod0.remove(j.rec.obj);
    disposeKitBuilding(j.rec.obj);
    j.rec.obj = null;
    const k = kitRecs.indexOf(j.rec);
    if (k >= 0) kitRecs.splice(k, 1);
    if (lastPrint === j.rec) lastPrint = null;
    derezJobs.splice(i, 1);
    derezCount--;
    updateKitLod(true);
  }
}

/* --- the seam: one pulse in, one building out -----------------------------
   A pulse names a town, a tool and a path. Three things happen and only three:
   the town's craft light up; a path this quarter has never seen prints a new
   building; a `delete` tool derezzes the one that path built. */
function onWorldPulse(msg) {
  setTownWorking(msg.town, true);
  const path = normPath(msg.path);
  if (!path) return;
  if (msg.tool === 'delete') { derezPath(path); return; }
  const q = quarters.get(msg.town);
  if (!q || !q.town.is_live) return;
  if (!q.printed) q.printed = new Set();
  /* ALREADY STANDING. It used to end here — one print, one height, for ever.
     A file that is WRITTEN again is a file being worked on, and that is the one
     thing the island can show about it, so the building it already built gains
     a floor instead. A Read of a file that already stands still changes
     nothing: reading is not work you can see from the harbour. */
  if (q.printed.has(path) || livePrints.has(path)) {
    const standing = livePrints.get(path);
    if (standing && !PRINT_FLOORS[msg.tool]) { standing.edits++; growLiveBuilding(standing); }
    return;
  }
  const rec = addLiveBuilding(q, path, msg.tool);
  if (!rec) return;
  q.printed.add(path);
  livePrints.set(path, rec);
  startPrint(rec, true);
}

/** `P` — replay the last print over the shell that already stands. VISUAL ONLY:
    no event, no new building, no count. The one way to look at the sequence
    again without waiting for the machine to touch a new file. */
function replayLastPrint() {
  if (!lastPrint || lastPrint.gone) return null;
  /* The building may have fallen out of the near band since it printed — its
     full-detail object is only kept for the LOD0 budget. Rebuilt and pinned for
     the replay, exactly as a fresh print is. */
  if (!lastPrint.obj) { lastPrint.obj = makeKitBuilding(lastPrint.d); kitLod0.add(lastPrint.obj); }
  lastPrint.pin = true;
  startPrint(lastPrint, true);
  return lastPrint.path;
}

/* --- the buildings that were printed before you opened the page -----------
   A materialisation was a thing you had to be WATCHING. Reload and the island
   forgot every file the machine had touched, because the only record of one was
   the `kitRecs` entry a live pulse had created in this tab. So a page opened at
   nine in the morning showed a harbour with nothing in its back yards and a
   day's real work invisible — the one thing this island exists to show.

   The fix is the record the server already keeps: `/api/project?id=` is the
   town's own replay, and every path in it carries the tool that touched it, the
   agent that ran it and the millisecond it happened. Every path FIRST touched
   inside the last twenty-four hours, that this quarter has no lot for, is stood
   up on the next free plot — WITHOUT a print. That is not a shortcut, it is the
   whole point: a print is the event, and replaying forty of them at load would
   be forty lies about what is happening now.

   Bounded on purpose in three places, because the payload is two megabytes for
   a busy town:
     - SEED_SCAN_CAP towns, live first and then by `last_active`;
     - SEED_WINDOW_MS of history, which is the same day `?demo=print` widens to;
     - SEED_PER_TOWN lots, which is four rows of HOUSE_GRID (21.6 m) and stops
       a quarter's back yard reaching the row of quarters behind it. */
const SEED_WINDOW_MS = 24 * 60 * 60 * 1000;
const SEED_SCAN_CAP = 4;
const SEED_PER_TOWN = 12;
let seedStat = { towns: 0, seeded: 0, skipped: 0, ms: 0 };

async function seedPrintedBuildings() {
  if (!kit || !plan || !world) return;
  const now = Date.now();
  const towns = (world.towns || [])
    .filter(t => quarters.has(t.id) &&
                 (t.is_live || now - (Date.parse(t.last_active || '') || 0) < SEED_WINDOW_MS))
    .sort((a, b) => (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0) ||
                    (Date.parse(b.last_active || '') || 0) - (Date.parse(a.last_active || '') || 0))
    .slice(0, SEED_SCAN_CAP);
  const t0 = performance.now();
  let seeded = 0, skipped = 0;
  /* ALL FOUR AT ONCE. `/api/project` is tens of megabytes for a busy town and
     server.py answers each one on its own thread; asked one after another this
     took 70 s on this machine, which is a minute of the island silently not
     showing what it did today. In parallel it is the slowest single town.
     A town whose fetch fails is dropped rather than taking the pass down —
     its back yard stays empty, which is the state before this existed. */
  const reps = await Promise.all(towns.map(t =>
    fetch('/api/project?id=' + encodeURIComponent(t.id))
      .then(r => r.json()).catch(() => null)));
  for (let ti = 0; ti < towns.length; ti++) {
    const t = towns[ti], rep = reps[ti];
    if (!rep) continue;
    /* The replay's `t` is milliseconds since the session opened, so wall-clock
       time is the session's own start plus it. A payload with no start date is
       one this cannot place in time, and a building whose caption cannot say
       WHEN is not worth standing up. */
    const base = Date.parse((rep.session && rep.session.started) || '') || 0;
    if (!base) continue;
    const labels = new Map((rep.agents || []).map(a => [a.id, a.label || a.id]));
    const q = quarters.get(t.id);
    if (!q.printed) q.printed = new Set();
    /* One pass over the replay to learn each path's whole history, then one
       building per path. Doing it the other way round would rebuild a building
       once per Edit at load, which is exactly the cost the growth rule is
       careful about. */
    const hist = new Map();
    for (const ev of (rep.events || [])) {
      if (ev.kind !== 'tool' || !ev.path) continue;
      const p = normPath(ev.path);
      let h = hist.get(p);
      if (!h) { h = { at: base + ev.t, tool: ev.tool, agent: labels.get(ev.agent) || ev.agent || null, edits: 0 };
                hist.set(p, h); continue; }
      if (!PRINT_FLOORS[ev.tool]) h.edits++;      // a write, not a read
    }
    /* Newest first, so a town with more than its share of fresh work shows the
       work it did most recently rather than whatever the replay listed first. */
    const fresh = [...hist].filter(([, h]) => now - h.at <= SEED_WINDOW_MS)
                           .sort((a, b) => b[1].at - a[1].at);
    let mine = 0;
    for (const [p, h] of fresh) {
      if (mine >= SEED_PER_TOWN) break;                   // this town's share is spent
      if (q.printed.has(p) || livePrints.has(p)) { skipped++; continue; }
      const rec = addLiveBuilding(q, p, h.tool, {
        at: h.at, agent: h.agent, edits: h.edits, seeded: true, noBuild: true,
        floors: floorsForTool(h.tool) + h.edits });
      if (!rec) break;                                    // no dry plot left in this quarter
      q.printed.add(p);
      livePrints.set(p, rec);
      seeded++; mine++;
    }
  }
  if (seeded) updateKitLod(true);
  seedStat = { towns: towns.length, seeded, skipped, ms: Math.round(performance.now() - t0) };
  console.log(`seeded ${seeded} printed building(s) from ${towns.length} town(s) ` +
              `in ${seedStat.ms} ms (24 h window)`);
}

/* --- ?demo=print ----------------------------------------------------------
   The materialisation, watched on purpose. Fetches a live town's own replay,
   takes every file its sessions touched for the first time inside the window,
   and prints them in order at HALF speed. Nothing is staged: the events are
   that town's own tool calls with their own spacing, and every path is a file
   that really exists.
   TOWN PICKED BY FIRST TOUCHES, NOT TOTAL TOOL CALLS (I16 fix): the old rule
   picked whichever live town had the most `tool_calls` ever, which on this
   machine is always the month-old chat town — its own replay has thousands of
   calls and zero paths first touched in the last thirty minutes, so the demo
   silently printed nothing (TESTS.md row I16). The busiest town by raw call
   count and the town that actually has fresh work to show are different
   questions; this asks the second one directly by scanning each live town's
   OWN replay for how many of its paths were first touched inside the window,
   and picking whichever scores highest. Capped at 5 towns (by `tool_calls`,
   so a vault with many live towns does not pay for a replay fetch per town)
   and widened from 30 min to 24 h if nothing scores in the tighter window.
   The payload is tens of megabytes for a busy town, which is why this is a
   flag and not a mode. */
const DEMO_WINDOW_MS = 30 * 60 * 1000;
const DEMO_DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_SCAN_CAP = 5;
const DEMO_RATE = 0.5;
let demoTimers = [];

/** Every path FIRST touched inside `windowMs` of a town's own replay, for
    each town in `towns` — one `/api/project` fetch per town. Returns the
    town whose script is longest, or null if every town scored zero. */
async function scanFirstTouches(towns, windowMs) {
  let best = null;
  for (const t of towns) {
    let rep;
    try { rep = await (await fetch('/api/project?id=' + encodeURIComponent(t.id))).json(); }
    catch (e) { continue; }
    const events = rep.events || [];
    if (!events.length) continue;
    const end = events[events.length - 1].t;
    const seen = new Set();
    const script = [];
    for (const ev of events) {
      if (ev.kind !== 'tool' || !ev.path) continue;
      const p = normPath(ev.path);
      if (seen.has(p)) continue;
      seen.add(p);
      if (ev.t < end - windowMs) continue;    // seen already, but before the window
      script.push({ at: ev.t - (end - windowMs), tool: ev.tool, path: p });
    }
    if (script.length && (!best || script.length > best.script.length)) best = { town: t, script };
  }
  return best;
}

async function startPrintDemo() {
  const live = (world.towns || []).filter(t => t.is_live);
  if (!live.length) { console.warn('?demo=print: nothing is live'); return; }
  let pool = live;
  if (DEMO_PRINT_TOWN) {
    pool = live.filter(t => t.id === DEMO_PRINT_TOWN);
    if (!pool.length) { console.warn(`?demo=print=${DEMO_PRINT_TOWN}: not a live town`); return; }
  } else {
    pool = [...live].sort((a, b) => (b.tool_calls || 0) - (a.tool_calls || 0)).slice(0, DEMO_SCAN_CAP);
  }
  let picked = await scanFirstTouches(pool, DEMO_WINDOW_MS);
  let widened = false;
  if (!picked) { picked = await scanFirstTouches(pool, DEMO_DAY_MS); widened = true; }
  if (!picked) { console.warn('?demo=print: no first touches in the last 30 min or 24 h'); return; }
  const { town: busiest, script } = picked;
  const q = quarters.get(busiest.id);
  if (!q) return;
  /* The clock starts at the FIRST event rather than at the window's edge, so a
     demo whose cluster is at the end does not open with eleven silent minutes. */
  const t0 = script[0].at;
  for (const s of script) {
    demoTimers.push(setTimeout(() => onWorldPulse(
      { kind: 'pulse', town: busiest.id, tool: s.tool, path: s.path }), (s.at - t0) / DEMO_RATE));
  }
  flyTo(q.x, q.z, 60, 0.32);
  console.log(`?demo=print: ${script.length} first touches from ${busiest.name}` +
              (widened ? ' (widened to 24h)' : ' (30 min)') + `, at ${DEMO_RATE}x`);
}


/* =============================================================================
   LABELS — canvas textures, so the type in the scene is the type on the page
   ========================================================================== */
const labelRegistry = [];
function makeLabel(text, color, px, register) {
  const pad = 8, size = px || 32;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
  g.font = font;
  c.width = Math.max(2, Math.ceil(g.measureText(text).width) + pad * 2);
  c.height = size + pad * 2;
  const g2 = c.getContext('2d');
  g2.font = font;
  g2.textBaseline = 'middle';
  g2.lineWidth = 5; g2.lineJoin = 'round'; g2.strokeStyle = 'rgba(8,7,12,.86)';
  g2.strokeText(text, pad, c.height / 2);
  g2.fillStyle = color;
  g2.fillText(text, pad, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: t, transparent: true, depthWrite: false, depthTest: false, opacity: 0.92 }));
  spr.scale.set((c.width / c.height) * 0.5, 0.5, 1);
  /* aspect/capFrac are what updateDroneLabels() solves the on-screen pixel
     size from, same instrument the signs use — capFrac is the fraction of the
     canvas the font's cap height actually fills. */
  spr.userData = { text, color, px: size, aspect: c.width / c.height, capFrac: size / c.height };
  if (register !== false) labelRegistry.push(spr);
  return spr;
}
/* A label baked before the webfont lands is Arial in a texture forever. */
function refreshLabels() {
  for (const spr of labelRegistry) {
    if (!spr.parent) continue;
    const fresh = makeLabel(spr.userData.text, spr.userData.color, spr.userData.px, false);
    const scale = spr.scale.x / ((spr.material.map.image.width / spr.material.map.image.height) * 0.5);
    spr.material.map.dispose();
    spr.material.map = fresh.material.map;
    spr.userData.aspect = fresh.material.map.image.width / fresh.material.map.image.height;
    spr.scale.set((fresh.material.map.image.width / fresh.material.map.image.height) * 0.5 * scale,
                  0.5 * scale, 1);
    spr.material.needsUpdate = true;
  }
}

/** DRONE LABELS, once per frame: the same pixel-target solve updateSigns()
    already runs, at a much smaller cap.

    Before this, a label's on-screen size was a flat multiplyScalar(4 or 5) on
    top of makeLabel()'s own scale — a WORLD size with no distance term at all.
    A sign has exactly this same shape of bug and was fixed the same way
    (RUNBOOK -> "A sign is a piece of TYPE"); a drone label never was, and it
    is agent.label, which for the main orchestrator IS the session's live
    prompt (server.py: `m["prompt"][:40]`) — so any camera pass within roughly
    90 units of a live town blew a clipped prompt up across the whole frame.
    That is the "Goal check-in: «...»" bug in docs/shots/world-landmarks.png.
    14 px is the same cap the session city's own DOM ticker holds its one live
    line to (styles.css #ticker-list, 13px + the age-0 line at 400 weight) —
    a name tag over an agent should read like that ticker line, not like a
    sign on a mast. */
const LABEL_CAP_PX = MOBILE ? 11 : 14;
const LABEL_MIN_H = 0.35;   // world metres — floor, so a far drone's tag does not vanish
const LABEL_MAX_H = 3.0;    // world metres — ceiling, so a close pass never covers the town
function updateDroneLabels() {
  if (!drones.size) return;
  const el = renderer.domElement;
  const frameH = el.clientHeight || 900;
  const halfTan = Math.tan(camera.fov * Math.PI / 360);
  for (const d of drones.values()) {
    const label = d.label;
    if (!label) continue;
    /* The label's offset is pure +y off the drone group's origin, which
       rotation about y leaves unmoved — so the group's own position plus that
       one offset IS the label's world position, with no matrix update needed.
       `d.tagY` is that offset in WORLD metres for both paths: the orb's own
       3.0/2.4, or the craft's tagAnchor height already multiplied by the
       variant scale. */
    _sv.copy(d.group.position);
    _sv.y += d.tagY;
    const dist = camera.position.distanceTo(_sv);
    const mPerPx = 2 * dist * halfTan / frameH;
    const h = THREE.MathUtils.clamp(LABEL_CAP_PX * mPerPx / label.userData.capFrac, LABEL_MIN_H, LABEL_MAX_H);
    /* Divided by the craft's own scale, because the sprite hangs INSIDE it. */
    const s = d.tagScale || 1;
    label.scale.set(h * label.userData.aspect / s, h / s, 1);
  }
}


/* =============================================================================
   CAMERA — a slow orbit for the screensaver, WASD to walk into it
   ========================================================================== */
/* While the interior is flying the lens from the world into a landmark's door
   it writes the camera pose directly, and updateCamera() steps aside. Null the
   rest of the time, which is also what puts the world camera back EXACTLY where
   it was when the visit ends — not moving it is the restore. */
let camOverride = null;
function overrideCamera(pos, look) {
  if (!pos) { camOverride = null; return; }
  camOverride = camOverride || { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  camOverride.pos.copy(pos); camOverride.look.copy(look);
}

const camTarget = new THREE.Vector3(-20, 0, -10);
const cam = { theta: 0.9, phi: 0.34, dist: 620, manualUntil: 0, fly: null };
const keys = new Set();

/* FREE FLY — the answer to "I cannot get to every corner".
   The orbit is a camera on a string: it always looks at camTarget and it always
   stands cam.dist away, so there are places on this island the string will not
   reach. Free fly cuts it — the LENS becomes the thing that moves, with no
   target, no zoom clamp and no auto-refit. `F` toggles, and cam.* is deliberately
   left untouched the whole time it is on, which is what makes coming back an ease
   to the pose the viewer left rather than a fresh framing of the island. */
const free = {
  on: false,
  pos: new THREE.Vector3(), yaw: 0, pitch: 0,
  /* The pose we left free fly FROM, and how much of it is still mixed into the
     orbit pose. 1 the instant F is released, 0 when the ease has finished. */
  back: 0, backPos: new THREE.Vector3(), backQuat: new THREE.Quaternion(),
};
const FREE_BASE = 26;        // m/s at street level, before the altitude term
const FREE_MIN = 0.3;        // m/s floor — a slow camera, never a stuck one
const FREE_EASE = 0.7;       // seconds to blend back onto the orbit
const FREE_EYE = 1.7;        // how far the lens stays above whatever is under it
const _fFwd = new THREE.Vector3(), _fRight = new THREE.Vector3();
const _oPos = new THREE.Vector3(), _oQuat = new THREE.Quaternion();

/* Entering free fly starts from EXACTLY where the orbit lens is standing and
   looking, so the toggle is a change of control and not a cut to somewhere else. */
function toggleFreeFly() {
  if (Interior.busy()) return;
  if (!free.on) {
    free.pos.copy(camera.position);
    /* yaw/pitch read back off the direction the orbit lens is already pointing —
       camera.rotation is in the renderer's own XYZ order, which is not the YXZ a
       flyer's two angles compose in, so it is read from the vector instead. */
    camera.getWorldDirection(_fFwd);
    free.yaw = Math.atan2(-_fFwd.x, -_fFwd.z);
    free.pitch = Math.asin(THREE.MathUtils.clamp(_fFwd.y, -1, 1));
    free.on = true; free.back = 0;
  } else {
    free.backPos.copy(camera.position);
    free.backQuat.copy(camera.quaternion);
    free.on = false; free.back = 1;
  }
  if (dom['free-hud']) dom['free-hud'].hidden = !free.on;
  dom['a11y-status'].textContent = free.on
    ? 'Free flight. W A S D to move, Q and E down and up, F to go back.'
    : 'Back to the orbit.';
}

/* WASD + Q/E, in the direction the lens is looking. The one thing that is not
   obvious here is the SPEED: a fixed step that feels right crossing the island
   overshoots a doorway by fifty metres, and a step that feels right at a doorway
   takes a minute to cross the water. So it scales with how high above the ground
   the lens is — fast in the sky, slow in a street — and never falls under
   FREE_MIN, because a camera that cannot move is broken rather than careful. */
function updateFreeFly(dt) {
  const ground = Math.max(SEA, landAt(free.pos.x, free.pos.z));
  const alt = Math.max(0, free.pos.y - ground);
  const step = Math.max(FREE_MIN, FREE_BASE * (0.12 + alt / 90)) *
               (keys.has('shift') ? 4 : 1) * dt;

  camera.rotation.order = 'YXZ';
  camera.rotation.set(free.pitch, free.yaw, 0);
  camera.getWorldDirection(_fFwd);
  _fRight.set(_fFwd.z, 0, -_fFwd.x);
  if (_fRight.lengthSq() < 1e-6) _fRight.set(1, 0, 0);
  _fRight.normalize();

  if (keys.has('w')) free.pos.addScaledVector(_fFwd, step);
  if (keys.has('s')) free.pos.addScaledVector(_fFwd, -step);
  if (keys.has('d')) free.pos.addScaledVector(_fRight, step);
  if (keys.has('a')) free.pos.addScaledVector(_fRight, -step);
  if (keys.has('e')) free.pos.y += step;
  if (keys.has('q')) free.pos.y -= step;

  free.pos.x = THREE.MathUtils.clamp(free.pos.x, -HALF, HALF);
  free.pos.z = THREE.MathUtils.clamp(free.pos.z, -HALF, HALF);
  /* The ONLY collision in free fly: the lens never sinks through the terrain or
     the water. Everything else is walked through on purpose — a flyer that
     bounces off every roof is a flyer nobody uses. */
  const floor = Math.max(SEA, landAt(free.pos.x, free.pos.z)) + FREE_EYE;
  if (free.pos.y < floor) free.pos.y = floor;

  camera.position.copy(free.pos);
}

/* The opening shot. Measured against the whole 900-unit map at fov 38: at 520
   the frame held the mountain and the harbour but cut off the river mouth, the
   village and the islands; at 740 with the aim west of centre the whole landmass
   is in frame with the coastline running diagonally, which is the shot. */
function frameCamera() {
  /* phi 0.35 is 20 degrees of elevation: low enough that the mountain has a SKY
     behind it rather than a sheet of water, which is the difference between a
     landscape and a map. theta 1.30, not 1.02: at 1.02 the sun sets BEHIND the
     camera and every face in the frame is a shaded face, which is exactly the
     flat even lighting the verdict named. At 1.30 the sunset rakes across the
     island and the mountain has a lit side and a dark side.
     900, not the 880 a fov of 38 needed and not the 1,120 a fov of 30 needs for
     the same width: the whole island fitting in frame costs the settlements,
     which at 1,120 stop being buildings and become texture. */
  /* 720 over the HARBOUR, not 900 over the whole island. The island shot was
     the prettier postcard and it was also a map with no addresses on it: at 900
     units, with the aim 40 west of centre, the forty-odd landmark signs pile
     onto the same strip of frame and the overlap cull leaves five or six of
     them — `__signPixels()` read {visible: 0} before this pass and 6 after the
     fade was opened up. Aiming at the quays and standing 720 back spreads the
     towns far enough apart that eight or nine of them keep their name, and the
     orbit stays over the harbour instead of swinging away from it. 720 and not
     620: measured A/B in one minute on one machine, the closer stand cost
     another two or three frames a second for the same count of readable signs.
     The mountain is still in frame; the river mouth and the far islands are
     what this costs. */
  cam.dist = 720;
  cam.phi = 0.34;
  cam.theta = 1.30;
  camTarget.set(40, 10, 0);
}

function flyTo(x, z, dist, phi) {
  cam.fly = { start: performance.now(),
              from: camTarget.clone(), to: new THREE.Vector3(x, landAt(x, z) + 4, z),
              d0: cam.dist, d1: dist == null ? 120 : dist,
              p0: cam.phi, p1: phi == null ? 0.24 : phi, href: null };
}

function updateCamera(dt) {
  if (camOverride) {
    camera.position.copy(camOverride.pos);
    camera.lookAt(camOverride.look);
    return;
  }
  if (free.on) { updateFreeFly(dt); return; }
  if (cam.fly) {
    const k = Math.min(1, (performance.now() - cam.fly.start) / FLY_MS);
    const e = 1 - Math.pow(1 - k, 3);
    camTarget.lerpVectors(cam.fly.from, cam.fly.to, e);
    cam.dist = cam.fly.d0 + (cam.fly.d1 - cam.fly.d0) * e;
    cam.phi = cam.fly.p0 + (cam.fly.p1 - cam.fly.p0) * e;
    if (k >= 1) { if (cam.fly.href) location.href = cam.fly.href; cam.fly = null; }
  } else {
    /* WASD glides the camera over the ground at low altitude. It is the only way
       to be IN the world rather than above it, and it is what turns the map into
       a place. */
    let mx = 0, mz = 0;
    if (keys.has('w')) mz += 1;
    if (keys.has('s')) mz -= 1;
    if (keys.has('a')) mx -= 1;
    if (keys.has('d')) mx += 1;
    if (mx || mz) {
      const speed = 60 * dt * (cam.dist / 200 + 0.4);
      const f = new THREE.Vector3(-Math.cos(cam.theta), 0, -Math.sin(cam.theta));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      camTarget.addScaledVector(f, mz * speed).addScaledVector(r, mx * speed);
      camTarget.x = THREE.MathUtils.clamp(camTarget.x, -HALF + 40, HALF - 40);
      camTarget.z = THREE.MathUtils.clamp(camTarget.z, -HALF + 40, HALF - 40);
      cam.dist += (70 - cam.dist) * Math.min(1, dt * 1.4);
      cam.phi += (0.17 - cam.phi) * Math.min(1, dt * 1.4);
      cam.manualUntil = performance.now() + ORBIT_RESUME_MS;
    } else if (!CAMERA_FIXED && performance.now() > cam.manualUntil) {
      cam.theta += dt * (SCREENSAVER ? 0.012 : 0.02);
      maybePassOverLiveQuarter();
    }
  }
  /* The camera never goes underground or under water. The lift over the ground
     used to be a flat 4, which is right for the wide shot and is also the reason
     the closest the wheel could ever get you was a first-floor window: the aim
     point itself was pinned four metres up, and the lens sat above THAT. Scaling
     it with the distance leaves the wide shot exactly where it was (at 720 the
     term is still 4) and lets a fully zoomed-in orbit sit at eye level. */
  const lift = Math.min(4, cam.dist * 0.06);
  camTarget.y += (Math.max(SEA + 2, landAt(camTarget.x, camTarget.z)) + lift - camTarget.y) * Math.min(1, dt * 2);
  const d = cam.dist;
  camera.position.set(
    camTarget.x + Math.cos(cam.theta) * Math.cos(cam.phi) * d,
    camTarget.y + Math.sin(cam.phi) * d,
    camTarget.z + Math.sin(cam.theta) * Math.cos(cam.phi) * d);
  /* Two metres above whatever is under the lens — eye level, and the floor the
     zoom range is stated against. It was 6, which is a first-floor window. */
  const floor = landAt(camera.position.x, camera.position.z) + CAM_FLOOR;
  if (camera.position.y < floor) camera.position.y = floor;
  /* Zoomed all the way in, the lens rides the ground UNDER ITSELF rather than
     the ground under the aim point. On a slope those two differ by more than the
     whole of the zoom's remaining travel, which is how the same fully zoomed-in
     shot stands two metres up on one side of a rise and four on the other. Only
     inside twelve units: above that the solved height is the shot. */
  if (cam.dist < 12) camera.position.y = Math.min(camera.position.y, floor + cam.dist * 0.09);
  /* 0.105, not 0.05. The look-at point sits above the target, which tilts the
     lens up until roughly the top quarter of the frame is sky. At 0.05 and a fov
     of 30 the lens pitched 17 degrees down, the top edge of the picture sat two
     degrees BELOW horizontal, and there was no horizon in the frame at all — the
     "sky" in it was the dome's dark underside. That quarter of sky is not
     decoration: it is what the mountain is silhouetted AGAINST. */
  camera.lookAt(camTarget.x, camTarget.y + d * 0.105, camTarget.z);

  /* Leaving free fly EASES back rather than cutting: the orbit pose is solved
     first (above), then the pose the flyer was left in is mixed out of it over
     FREE_EASE seconds. A cut here reads as a bug even when it is not. */
  if (free.back > 0) {
    free.back = Math.max(0, free.back - dt / FREE_EASE);
    const e = free.back * free.back * (3 - 2 * free.back);      // smoothstep
    _oPos.copy(camera.position); _oQuat.copy(camera.quaternion);
    camera.position.lerpVectors(_oPos, free.backPos, e);
    camera.quaternion.slerpQuaternions(_oQuat, free.backQuat, e);
  }
}


/* =============================================================================
   INPUT — orbit, zoom, hover, click, search, quality
   ========================================================================== */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let dragging = false, dragMoved = 0, lastX = 0, lastY = 0, panning = false;
const _pan = new THREE.Vector3(), _panR = new THREE.Vector3();

/* =============================================================================
   TOUCH — the same five things the mouse does, with a finger

   A finger is not a small mouse. It has no hover, so nothing is ever "under the
   cursor" until it is put there; no wheel, so the zoom has to be the gesture
   everyone already knows; no right button, so the pan has to come off the same
   two fingers as the zoom; and no dblclick event that fires reliably, so the
   double tap is timed here.

   | gesture | what it does | why that one |
   |---|---|---|
   | one finger drag | orbit | the same drag the mouse does, unchanged |
   | pinch | zoom | the only zoom gesture a phone has |
   | two-finger twist | rotate (theta) | the pan is the wrong reflex on a map you orbit; a twist is the one people try |
   | tap | select, caption | one click |
   | double tap | go inside | the dblclick this page already binds |
   | long press | caption without selecting | the substitute for HOVER, which does not exist |

   `touch-action: none` on the canvas (world.css) is load-bearing: without it
   the browser claims the first two fingers for its own page zoom and none of
   this is ever delivered. */
const touches = new Map();      // live pointerId -> {x, y}, touch pointers only
let pinch = null;               // { gap, angle, dist, theta } at the moment two fingers landed
let tapAt = 0, tapX = 0, tapY = 0;   // the previous tap, for the double-tap window
let pressTimer = 0, pressFired = false;
/* Two fingers came down at some point in this gesture. Lifting them both fires
   liftPointer twice, and the second one arrives with a small `dragMoved` — so
   without this a pinch ends by selecting whatever the last finger was over. */
let pinchedThisGesture = false;
const TAP_SLOP = 12;            // px a finger may wander and still be a tap — bigger than the mouse's 6
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 40;     // px between the two taps of a double tap
const LONG_PRESS_MS = 480;

/** The pointer's position as NDC and as pixels, both of which a tap needs and
    only one of which a mouse move sets. */
function aimAt(x, y) {
  ndc.x = (x / window.innerWidth) * 2 - 1;
  ndc.y = -(y / window.innerHeight) * 2 + 1;
}
const clearPress = () => { clearTimeout(pressTimer); pressTimer = 0; };

function bindInput() {
  canvas.addEventListener('pointerdown', (e) => {
    if (Interior.busy()) return;      // the walker owns the mouse while he is inside
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      aimAt(e.clientX, e.clientY);
      pressFired = false;
      clearPress();
      if (touches.size === 2) {
        /* Two fingers: the orbit stops and the pinch takes over from exactly
           where the lens is standing, so neither zoom nor rotation jumps. */
        dragging = false;
        const [a, b] = [...touches.values()];
        pinch = { gap: Math.hypot(a.x - b.x, a.y - b.y) || 1,
                  angle: Math.atan2(b.y - a.y, b.x - a.x),
                  dist: cam.dist, theta: cam.theta };
        pinchedThisGesture = true;
        cam.manualUntil = performance.now() + ORBIT_RESUME_MS;
        return;
      }
      if (touches.size === 1) {
        /* THE SUBSTITUTE FOR HOVER. A finger cannot rest on a building and read
           its name, so holding still on one opens its caption without arming
           the second click that would walk into it. */
        pressTimer = setTimeout(() => {
          pressFired = true; pressTimer = 0;
          const hit = pick();
          if (hit) { selected = hit; showCaption(hit); } else closeCaption();
        }, LONG_PRESS_MS);
      }
    }
    dragging = true; dragMoved = 0; lastX = e.clientX; lastY = e.clientY;
    /* Right or middle drag is a PAN, not an orbit: an orbit can only ever look
       at one point, so no amount of dragging reaches a corner the aim is not
       already near. Panning moves the aim itself, which is what makes every
       corner reachable without leaving the orbit. */
    panning = (e.button === 2 || e.button === 1);
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    /* Free fly asks for the pointer once, on a real click, because that is the
       only gesture a browser will grant it on. A refusal is not fatal — the drag
       branch below turns the same movement into the same look. */
    if (free.on && document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  });
  /* Without this the right-drag pan opens the browser's own context menu on
     mouseup and the gesture is unusable. */
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (Interior.busy()) return;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      const t = touches.get(e.pointerId);
      if (Math.abs(e.clientX - t.x) + Math.abs(e.clientY - t.y) > TAP_SLOP) clearPress();
      t.x = e.clientX; t.y = e.clientY;
      if (pinch && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const gap = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        /* Fingers apart is closer in, which is why the ratio is the OLD gap
           over the new one and not the other way round. */
        cam.dist = THREE.MathUtils.clamp(pinch.dist * (pinch.gap / gap), CAM_NEAR, CAM_FAR);
        cam.theta = pinch.theta - (Math.atan2(b.y - a.y, b.x - a.x) - pinch.angle);
        cam.manualUntil = performance.now() + ORBIT_RESUME_MS;
        return;
      }
    }
    const locked = document.pointerLockElement === canvas;
    if (free.on) {
      /* Mouse-look. Pointer lock gives movementX/Y with no edge to hit; the drag
         fallback is the same numbers off two client positions, and it is the path
         a screenshot harness and a locked-down browser both take. */
      const dx = locked ? e.movementX : (dragging ? e.clientX - lastX : 0);
      const dy = locked ? e.movementY : (dragging ? e.clientY - lastY : 0);
      if (dx || dy) {
        free.yaw -= dx * 0.0026;
        free.pitch = THREE.MathUtils.clamp(free.pitch - dy * 0.0026, -1.45, 1.45);
      }
      lastX = e.clientX; lastY = e.clientY;
      /* Locked, the cursor stands still and the crosshair IS the middle. */
      if (locked) { ndc.set(0, 0); hover(window.innerWidth / 2, window.innerHeight / 2); }
      else { ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
             hover(e.clientX, e.clientY); }
      return;
    }
    if (dragging) {
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      if (panning) {
        /* One screen pixel is worth more ground the further back the lens
           stands, which is what keeps a pan feeling like dragging the map
           itself at every zoom. */
        const k = cam.dist * 0.0016;
        _pan.set(-Math.cos(cam.theta), 0, -Math.sin(cam.theta));   // into the screen
        _panR.set(-_pan.z, 0, _pan.x);                             // screen right
        camTarget.addScaledVector(_panR, -dx * k).addScaledVector(_pan, -dy * k);
        camTarget.x = THREE.MathUtils.clamp(camTarget.x, -HALF, HALF);
        camTarget.z = THREE.MathUtils.clamp(camTarget.z, -HALF, HALF);
      } else {
        cam.theta -= dx * 0.005;
        cam.phi = THREE.MathUtils.clamp(cam.phi + dy * 0.004, 0.06, 1.2);
      }
      cam.manualUntil = performance.now() + ORBIT_RESUME_MS;
      lastX = e.clientX; lastY = e.clientY;
    }
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    hover(e.clientX, e.clientY);
  });
  const liftPointer = (e) => {
    if (Interior.busy()) return;
    const wasPan = panning;
    const wasTouch = e.pointerType === 'touch' && touches.has(e.pointerId);
    if (wasTouch) {
      touches.delete(e.pointerId);
      clearPress();
      /* A finger has no un-hover. The move handler shows the one-line chip the
         mouse gets, and on a phone it would then sit under where the finger was
         for ever, so the lift takes it away. */
      dom.hover.hidden = true;
      if (touches.size < 2) pinch = null;
      /* One finger left of two: the drag has to restart from where THAT finger
         is, or the orbit snaps by the distance between the two of them. */
      if (touches.size === 1) {
        const t = [...touches.values()][0];
        lastX = t.x; lastY = t.y; dragMoved = 0; dragging = true;
        canvas.classList.remove('dragging');
        return;
      }
    }
    dragging = false; panning = false;
    canvas.classList.remove('dragging');
    if (wasTouch) {
      const wasPinch = pinchedThisGesture;
      pinchedThisGesture = false;                             // the gesture is over either way
      if (pressFired || wasPinch || e.type === 'pointercancel') return;
      if (dragMoved >= TAP_SLOP || free.on) return;           // that was a drag, not a tap
      const now = performance.now();
      aimAt(e.clientX, e.clientY);
      if (now - tapAt < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - tapX, e.clientY - tapY) < DOUBLE_TAP_SLOP) {
        /* The second tap of a double tap goes INSIDE, which is what the mouse's
           dblclick does — and the first tap's caption is already open behind
           it, so the two taps read as "what is this" then "go in". */
        tapAt = 0;
        const hit = pick();
        if (hit) { selected = hit; act(hit); }
        return;
      }
      tapAt = now; tapX = e.clientX; tapY = e.clientY;
      click();
      return;
    }
    if (dragMoved < 6 && !wasPan && !free.on) click();
  };
  canvas.addEventListener('pointerup', liftPointer);
  canvas.addEventListener('pointercancel', liftPointer);
  /* One double-click goes inside whatever is under it — a landmark, a house, a
     bridge, a lighthouse. The two-click arm-then-enter path is still there and
     unchanged; this is the gesture for people who did not read the caption. */
  canvas.addEventListener('dblclick', (e) => {
    if (Interior.busy()) return;
    e.preventDefault();
    const hit = pick();
    if (hit) { selected = hit; act(hit); }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Interior.busy() || free.on) return;    // free fly has no zoom, it has W
    /* 0.22 per notch, not 0.09: the range this wheel now has to cover is the
       whole island (720) down to eye level (3), which is 240x — at 9% a notch
       that is seventy turns of the wheel and nobody ever finds the bottom of it.
       The step is scaled by the event's OWN deltaY rather than its sign, so a
       mouse notch (120) is a full step and a trackpad's stream of small deltas
       stays proportional instead of firing twenty full steps a second. */
    const t = Math.sign(e.deltaY) * THREE.MathUtils.clamp(Math.abs(e.deltaY) / 120, 0.08, 1);
    cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + t * 0.22), CAM_NEAR, CAM_FAR);
    cam.manualUntil = performance.now() + ORBIT_RESUME_MS;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === dom['search-input']) {
      if (e.key === 'Escape') closeSearch();
      /* Enter is a NO-OP until the index exists — the query is banked and flown
         the moment buildWorld() finishes, rather than throwing on a null plan. */
      if (e.key === 'Enter' && !plan) { pendingQuery = dom['search-input'].value; pendingGo = true; return; }
      if (e.key === 'Enter') { runSearch(dom['search-input'].value); closeSearch(); }
      return;
    }
    /* Inside a building W is a step and not a letter, Escape is the way out and
       "/" is not an address bar. interior.js's own capture-phase listener has
       already had this event; this one steps aside entirely. */
    /* One key survives the interior: the note's own Obsidian door. Everything
       else inside is interior.js's, and this listener steps aside for it. */
    if (Interior.busy()) {
      if (e.key.toLowerCase() === 'o' && obsidianDoor) location.href = obsidianDoor;
      return;
    }
    const k = e.key.toLowerCase();
    if (k === '/') { e.preventDefault(); openSearch(); return; }
    if (k === 'f') { toggleFreeFly(); return; }
    if (k === 'h') { showHints(); return; }
    /* Q is the quality toggle on the orbit and "down" in free fly — the flyer
       owns W A S D Q E while it is on, and nothing else does. */
    if (k === 'q' && !free.on) { setQuality(quality === 'high' ? 'medium' : 'high', true); return; }
    /* P replays the last materialisation over the shell that already stands.
       Visual only — no event, no building, no count; see replayLastPrint(). */
    if (k === 'p') { replayLastPrint(); return; }
    if (e.key === 'Escape') closeCaption();
    if (e.key === 'Enter' && (hovered || selected)) act(hovered || selected);
    if ('wasdqe'.includes(k) || k === 'shift') keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
}

/* One raycast over the instanced pools. Three gives back an instanceId, which
   indexes straight into the records table the placement pass filled in — so a
   click knows the note it hit without a single extra mesh in the scene. */
function pick() {
  if (!pickables.length) return null;
  ray.setFromCamera(ndc, camera);
  ray.params.Points.threshold = 0;
  const hits = ray.intersectObjects(pickables
    .concat(groups.prints ? groups.prints.children : [])
    .concat(groups.picks ? groups.picks.children : []), false);
  /* A PRINTED BUILDING WINS OVER ITS OWN QUARTER, and that is a rule and not a
     depth test. Its collider is a 5 m box standing INSIDE the quarter's own
     14 m proxy cylinder, so on any lens that is seaward of it the cylinder is
     the nearer hit and the ray would hand back the town every time. A person
     who put the cursor on a building meant the building. */
  for (const h of hits) {
    const pr = h.object.userData.printRec;
    if (pr && !pr.gone) {
      return { kind: 'print', print: pr, rec: pr.struct, q: pr.q,
               ref: { type: 'print', id: 'print:' + pr.path, title: basename(pr.path) } };
    }
  }
  for (const h of hits) {
    if (h.object.userData.quarterId) {
      const q = quarters.get(h.object.userData.quarterId);
      if (q) return { kind: 'town', q, ref: { type: 'town', id: q.id, title: q.town.name, town: q.town } };
    }
    const table = h.object.userData.modelRecords || h.object.userData.records;
    const rec = table && table[h.instanceId];
    if (rec && rec.ref) return { kind: rec.ref.type === 'page' ? 'page'
                                     : rec.ref.type === 'town' ? 'town' : 'note',
                                 rec, q: quarters.get(rec.ref.id), ref: rec.ref };
  }
  return null;
}

function hover(x, y) {
  const hit = pick();
  hovered = hit;
  if (!hit) { dom.hover.hidden = true; return; }
  dom.hover.hidden = false;
  dom.hover.style.transform = `translate(${x + 14}px, ${y - 26}px)`;
  /* A wing is one page of a project's own site, and what a person wants under
     the cursor is its TITLE and how big it is — not a date, because a page's
     mtime is not something this world reads. */
  if (hit.ref.type === 'page') {
    dom.hover.innerHTML = `<b>${escapeHtml(hit.ref.title)}</b> ` +
      `<span>${escapeHtml(hit.ref.file)} · ${Math.round((hit.ref.bytes || 0) / 1024)} kB</span>`;
    return;
  }
  /* A printed building has no `modified` and no town clock — what it knows is
     when its file was first touched, which is the only date it should show. */
  if (hit.kind === 'print') {
    dom.hover.innerHTML = `<b>${escapeHtml(hit.ref.title)}</b> ` +
      `<span>${ago(new Date(hit.print.first.at).toISOString())}</span>`;
    return;
  }
  const when = hit.kind === 'town' ? hit.ref.town.last_active : hit.ref.modified;
  dom.hover.innerHTML = `<b>${escapeHtml(hit.ref.title)}</b> <span>${ago(when)}</span>`;
}

function click() {
  const hit = pick();
  if (!hit) { closeCaption(); return; }
  if (selected && selected.ref.id === hit.ref.id) { act(hit); return; }
  selected = hit;
  showCaption(hit);
}

/* The second click. A note opens in Obsidian, a LANDMARK opens its own door and
   you walk in, and a plain live quarter still flies to its session city. */
function act(hit) {
  /* A printed building has no inside. It is a fact about one file — the caption
     IS the whole of it — and a second click on one does nothing rather than
     opening the plain room a note gets, whose text would be about a note that
     does not exist. */
  if (hit.kind === 'print') return;
  if (hit.kind === 'page') { enterWing(hit); return; }
  if (hit.kind === 'town') {
    const q = quarters.get(hit.ref.id);
    /* A town BUILT AS ITS TRADE has an inside dressed as that trade. */
    if (q && q.formKey) { enterLandmark(q); return; }
    const t = hit.ref.town;
    /* A live quarter still flies down into its own session city — that is a
       richer inside than any room this page could build for it. */
    if (t.is_live && t.live_session) {
      cam.fly = { start: performance.now(), from: camTarget.clone(),
                  to: new THREE.Vector3(hit.q.x, hit.q.y + 4, hit.q.z),
                  d0: cam.dist, d1: 40, p0: cam.phi, p1: 0.2,
                  href: Controls.href(`index.html?live=1&session=${encodeURIComponent(t.live_session)}`) };
      return;
    }
    /* And a quarter with neither a trade nor a live session is no longer a dead
       end: it opens the same plain room a house does, carrying its own caption. */
    enterGeneric(hit);
  } else {
    /* THE THREE STRUCTURES THAT ARE NOT ROOMS. A bridge is walked and a
       lighthouse is climbed; everything else in the vault opens the note's own
       gallery. Which one this is comes from `plan.index`, not from the pool
       record: biomes.js writes the kind there and the instanced pools carry the
       PLACEMENT records, which for a bridge and a tower have no kind at all. */
    const kind = regionKindOf(hit);
    if (kind === 'bridge') { enterDeck(hit); return; }
    if (kind === 'lighthouse') { enterTower(hit); return; }
    enterGeneric(hit);
  }
}

/* What biomes.js decided this note's structure IS. `plan.index` is the only
   table that knows: `byId` there is keyed by note id and carries the kind, and
   it is what the search's fly-to already reads. */
function regionKindOf(hit) {
  const rec = plan && plan.index ? plan.index.get(hit.ref.id) : null;
  return rec ? rec.kind : (hit.rec ? hit.rec.kind : null);
}

/* The three numbers a note carries everywhere it is shown, and the Obsidian
   address that goes with them. One place, so the caption outside, the plaque
   inside and the reading stand on a bridge cannot say different things. */
function noteLines(r) {
  return [`${r.words.toLocaleString()} words · ${r.inlinks} note${r.inlinks === 1 ? '' : 's'} link here`,
          `written ${ago(r.modified)}`,
          'press O to open this note in Obsidian'];
}
function obsidianFor(id) {
  return `obsidian://open?vault=${encodeURIComponent(vault.root)}&file=${encodeURIComponent(id)}`;
}

/* The plain room behind everything this world draws that is not a trade
   landmark: a vault house, a bridge, a lighthouse, a fortress wall, a sleeping
   quarter. HALL_PLAIN is what interior.js falls back to for a spec with no
   `form`, so this needs no new builder — what it needs is the CAPTION, because
   the caption is the only thing the room can honestly say about the thing.

   `/api/vault` is a change stream and `/api/vault/search` returns one matched
   line, so there is no endpoint that hands back a note's text. Rather than
   invent a wall of prose the room does not have, the caption goes on the
   corkboard verbatim and the note's own `obsidian://` address goes with it —
   `O` opens it. That is the door, and it is the honest one. */
const REGION_WORDS = {
  bridge: 'a bridge over the river — one per day of the vault, in date order',
  lighthouse: 'a lighthouse on the coast',
  fortress: 'a wall of the board fortress',
};
let obsidianDoor = null;      // the address `O` opens while a note room is open

async function enterGeneric(hit) {
  if (Interior.busy()) return false;
  const r = hit.ref, rec = hit.rec || hit.q || {};
  const lines = [];
  let name, path, id;
  if (hit.kind === 'town') {
    const t = r.town;
    id = r.id; name = t.name; path = t.path;
    lines.push(`nothing has happened here since ${ago(t.last_active)}`,
               `${t.sessions} session${t.sessions === 1 ? '' : 's'} · ` +
               `${t.tool_calls.toLocaleString()} tool calls · ${t.files_touched} files`);
    obsidianDoor = null;
  } else {
    id = r.id; name = r.title; path = r.folder ? r.folder + '/' : 'the vault root';
    lines.push(REGION_WORDS[rec.kind] || 'a house in the vault — one per note',
               `${r.words.toLocaleString()} words · ${r.inlinks} note${r.inlinks === 1 ? '' : 's'} link here`,
               `written ${ago(r.modified)}`,
               'press O to open this note in Obsidian');
    obsidianDoor = obsidianFor(r.id);
  }
  closeCaption();
  dom.hover.hidden = true;
  /* THE NOTE'S OWN TEXT FIRST. /api/vault/note hands back the markdown, and a
     structure standing for a note is a room with that note on its walls rather
     than a room with a caption about it. A non-200 falls straight through to
     the caption board below, which is what this page has always shown and what
     it still shows on a server without the route. */
  if (hit.kind !== 'town' &&
      await Interior.enterNote({ id, name, path, x: rec.x || 0, y: rec.y || 0, z: rec.z || 0,
                                 noteId: r.id, metaLines: lines.slice(1) })) {
    return true;
  }
  Interior.setSource({ projectId: hit.kind === 'town' ? id : null });
  /* x/y/z so doorPose() puts the lens outside THIS structure's door rather than
     at the origin — a house and a landmark are entered by the same fly-in. */
  Interior.enterHall({
    id, name, path, form: null, x: rec.x || 0, y: rec.y || 0, z: rec.z || 0,
    tradeType: null, tradeSource: null, logoUrl: null,
    pages: [], openItems: lines, agents: [], sessions: 0, live: false,
    boardTitle: hit.kind === 'town' ? 'this project' : 'this note',
  });
  return true;
}


/* One bridge, in the deck's own measurements — and the measurement is the
   surprise. The .glb is ONE arched pier segment, normalised by instanceModel()
   to one unit tall and 0.79 square, so at the constant 4.2 every bridge is a
   3.3 m block, not a span; the forty-six of them stand 4.25 m apart down the
   river and together they read as one long viaduct. So the deck a reader walks
   is the segment's own bay — 4.2 m along the viaduct, its neighbours' arches
   carrying on either side — and not a crossing of the river.

   THE AXIS. The walk runs along the viaduct, which is the river's own tangent:
   `rec.rot` is that tangent and the group's local +x lands on it at `-rec.rot`.
   Measured rather than reasoned: bridge 0 sits at rot 0.971 and bridge 1 is
   (+2.53, +3.70) from it, which is (cos rot, sin rot) x 4.49 exactly.

   THE HEIGHT. `rec.y` is the model's base, one unit is BRIDGE_SCALE, and the
   walkway is the flat course under the crenellations — 0.80 of the way up. */
const BRIDGE_SCALE = 4.2;             // the same constant buildWorld() places with
const BRIDGE_DECK_FRAC = 0.80;
function deckOf(rec) {
  return { len: 4.2, wid: 2.4, rot: -rec.rot,
           deckY: rec.y + BRIDGE_SCALE * BRIDGE_DECK_FRAC };
}

/* ON THE DECK. Not a room: the world keeps being drawn behind the walker (see
   Interior.overlay() and frame()), so the river is under him, the banks are
   where they are and the days either side of this one are the bridges up and
   downstream. */
async function enterDeck(hit) {
  const r = hit.ref, rec = hit.rec || {};
  if (Interior.busy() || !models.bridge) return false;
  const d = deckOf(rec);
  const c = Math.cos(d.rot), sn = Math.sin(d.rot);
  obsidianDoor = obsidianFor(r.id);
  closeCaption();
  dom.hover.hidden = true;
  Interior.setSource({ projectId: null });
  return Interior.enterDeck({
    id: r.id, name: r.title, noteId: r.id, metaLines: noteLines(r),
    x: rec.x, y: rec.y, z: rec.z, rot: d.rot, len: d.len, wid: d.wid, deckY: d.deckY,
    /* The fly-in lands off the upstream end, level with the deck and looking
       along it — so the shot the flight ends on is the bridge, not its side. */
    pose: { px: rec.x - c * (d.len * 0.9), py: d.deckY + 3.4, pz: rec.z + sn * (d.len * 0.9),
            lx: rec.x, ly: d.deckY + 1.4, lz: rec.z },
  });
}

/* UP THE LIGHTHOUSE. Same overlay rule as the deck, and for the same reason:
   the whole point of a lamp room is what is out of the window. */
async function enterTower(hit) {
  const r = hit.ref, rec = hit.rec || {};
  if (Interior.busy()) return false;
  obsidianDoor = obsidianFor(r.id);
  closeCaption();
  dom.hover.hidden = true;
  Interior.setSource({ projectId: null });
  return Interior.enterTower({
    id: r.id, name: r.title, noteId: r.id, metaLines: noteLines(r),
    x: rec.x, y: rec.y, z: rec.z,
    pose: { px: rec.x + 17, py: rec.y + 9, pz: rec.z + 3,
            lx: rec.x, ly: rec.y + 7, lz: rec.z },
  });
}

/* A PAGE WING. One page of a project's own site, and now a room to read it in:
   the plain hall dressed as a single framed-page bay, with the page itself in
   the CSS3D layer through the same tree route every hall station uses. The
   caption's "hover the wing for its title" is still true; what is no longer
   true is that a wing has no inside. */
function enterWing(hit) {
  const r = hit.ref;
  if (Interior.busy() || !r.town) return false;
  obsidianDoor = null;
  closeCaption();
  dom.hover.hidden = true;
  Interior.setSource({ projectId: r.town.id });
  Interior.enterHall({
    id: r.id, name: r.title, path: r.file, form: 'pageWing',
    x: hit.rec.x, y: hit.rec.y, z: hit.rec.z,
    tradeType: null, tradeSource: null, logoUrl: null,
    pages: [{ file: r.file, title: r.title, bytes: r.bytes }],
    openItems: [`${r.file} · ${Math.round((r.bytes || 0) / 1024)} kB`,
                `one page of ${r.town.name}'s own site`],
    agents: [], sessions: r.town.sessions || 0, live: !!r.town.is_live,
    boardTitle: 'this page',
  });
  return true;
}


/* =============================================================================
   INSIDE A LANDMARK — the seam with interior.js
   This file owns nothing of the interior and the interior owns nothing of this
   world. What crosses the line is six callbacks and one SPEC, and every field of
   that spec is a fact this page already had: /api/world gave the trade, the
   agents and the open items, /api/project/meta gave the pages and the logo.
   ========================================================================== */

/* Where the lens stops before the walk begins: outside the landmark's door, at
   head height, looking at it. Every landmark on this coast faces +x (the water)
   — buildTradeLandmarks() sets `q.face = 0` for exactly that reason — so the
   door is on its +x side and the camera stands off it. */
function doorPose(q) {
  /* A bridge and a lighthouse are not entered through a door on their +x face:
     one is walked onto and the other is climbed, and the fly-in has to land
     looking at the thing itself rather than at the side of it. Those two hand
     their own pose over on the spec, and this is where it is honoured. */
  if (q.pose) {
    return { pos: new THREE.Vector3(q.pose.px, q.pose.py, q.pose.pz),
             look: new THREE.Vector3(q.pose.lx, q.pose.ly, q.pose.lz) };
  }
  return { pos: new THREE.Vector3(q.x + LM_YARD * 0.55, q.y + 2.6, q.z),
           look: new THREE.Vector3(q.x, q.y + 2.2, q.z) };
}

/* The hall's surfaces come from the world's own PBR pack, through the same
   triplanar material the landmarks outside are built with — so a sandstone wall
   indoors is the sandstone wall you were just looking at from the harbour. */
function hallMaterial(surface, tint) { return makeTriplanarMaterial(surface, tint); }

/* One quarter -> everything the hall needs to build itself. Nothing is computed
   here that the payloads did not already say. */
function landmarkSpec(q) {
  const t = q.town;
  return {
    id: q.id, name: t.name, path: t.path, form: q.formKey,
    tradeType: t.trade ? t.trade.type : null,
    tradeSource: t.trade ? t.trade.source : null,
    logoUrl: t.logo ? t.logo.url : null,
    pages: t.pages || [],
    openItems: t.open_items || [],
    agents: t.live_agents || [],
    sessions: t.sessions || 0,
    live: !!t.is_live,
  };
}

function enterLandmark(q) {
  if (!q || !q.formKey || Interior.busy()) return false;
  /* The page window resolves through /api/project/tree/<town>/<path>, so the
     interior has to know which town it is standing in before it opens a door. */
  Interior.setSource({ projectId: q.id });
  closeCaption();
  dom.hover.hidden = true;
  Interior.enterHall(landmarkSpec(q));
  return true;
}


/* =============================================================================
   THE CAPTION — floating type, anchored to the thing it describes
   Not a card: no border, no background, no close button. Escape closes it.
   ========================================================================== */
function showCaption(hit) {
  const r = hit.ref;
  dom['cap-name'].textContent = r.title;
  const bits = [];
  if (hit.kind === 'page') {
    /* One wing, one page. The caption names the file and the site it belongs
       to, and the second click has nowhere to go — a page is a fact about the
       project, not an address on this map. */
    dom['cap-path'].textContent = r.town.name + ' · ' + r.file;
    bits.push(`<span class="line quiet">${Math.round((r.bytes || 0) / 1024)} kB of HTML — ` +
              `one wing of this town's landmark per page of its site.</span>`);
    dom['cap-agents'].innerHTML = '';
    dom['cap-open'].innerHTML = '';
    dom['cap-hint'].textContent = '';
    dom['cap-state'].innerHTML = bits.join('');
    dom.caption.hidden = false;
    dom['a11y-status'].textContent = r.title;
    return;
  }
  /* A PRINTED BUILDING. Three facts and no more, because three is all the
     island actually knows about it: which file it is, when that file was first
     touched here, and which agent touched it. `floors` is the fourth only when
     the file has been written again since — a building that has grown is
     saying something, one that has not has nothing to add. */
  if (hit.kind === 'print') {
    const p = hit.print;
    dom['cap-path'].textContent = p.q.town.name + ' · ' + p.path;
    bits.push(`<span class="line">first touched ` +
              `${escapeHtml(ago(new Date(p.first.at).toISOString()))}` +
              (p.first.tool ? ` <span class="quiet">(${escapeHtml(p.first.tool)})</span>` : '') +
              '</span>');
    if (p.first.agent) {
      bits.push(`<span class="line quiet">by <bdi>${escapeHtml(p.first.agent)}</bdi></span>`);
    }
    bits.push(`<span class="line quiet">${p.d.floors} floor${p.d.floors === 1 ? '' : 's'}` +
              (p.edits ? ` — one per write since, ${p.edits} so far` : '') +
              (p.seeded ? ' · stood here before this page opened' : ' · printed while you watched') +
              '</span>');
    dom['cap-agents'].innerHTML = '';
    dom['cap-open'].innerHTML = '';
    dom['cap-hint'].textContent = '';
    dom['cap-state'].innerHTML = bits.join('');
    dom.caption.hidden = false;
    dom['a11y-status'].textContent = r.title;
    return;
  }
  if (hit.kind === 'town') {
    const t = r.town;
    dom['cap-path'].textContent = t.path;
    /* What the building IS, in the words a person would use — and why. Only for
       the towns whose trade the server actually recognised; the rest say
       nothing rather than guess. */
    const q = quarters.get(r.id);
    if (q && q.formKey && TRADE_WORDS[q.formKey]) {
      bits.push(`<span class="line">built as ${TRADE_WORDS[q.formKey]}` +
                (t.trade && t.trade.source ? ` <span class="quiet">(${escapeHtml(t.trade.type)}, ` +
                  `read from its ${escapeHtml(t.trade.source)})</span>` : '') + '</span>');
      const np = (t.pages || []).length;
      if (np) bits.push(`<span class="line quiet">` + (np === 1
        ? 'one page on its site, and the one wing beside it — hover the wing for its title.'
        : `${np} pages on its site, one wing each — hover a wing for its title.`) + '</span>');
    }
    if (t.is_live && t.now) {
      if (t.now.prompt) bits.push(`<span class="line">asked: <bdi>${escapeHtml(t.now.prompt)}</bdi></span>`);
      if (t.now.last_text) bits.push(`<span class="line quiet"><bdi>${escapeHtml(t.now.last_text)}</bdi></span>`);
      const where = t.now.last_path ? ' · ' + basename(t.now.last_path) : '';
      if (t.now.last_tool) bits.push(`<span class="line tool">${escapeHtml(t.now.last_tool)}${escapeHtml(where)}</span>`);
    } else {
      bits.push(`<span class="line quiet">nothing has happened here since ${ago(t.last_active)}.</span>`);
      bits.push(`<span class="line quiet">${t.sessions} session${t.sessions === 1 ? '' : 's'}, ` +
                `${t.tool_calls.toLocaleString()} tool calls, ${t.files_touched} files, ${t.edits} edits.</span>`);
    }
    dom['cap-agents'].innerHTML = t.live_agents.map(a =>
      `<li class="${String(a.id).startsWith('main') ? 'main' : 'sub'}"><bdi>${escapeHtml(a.label)}</bdi>` +
      (a.last_tool ? ` <span class="quiet">— ${escapeHtml(a.last_tool)}` +
        (a.last_path ? ' ' + escapeHtml(basename(a.last_path)) : '') + '</span>' : '') +
      '</li>').join('');
    const shown = t.open_items.slice(0, 6);
    dom['cap-open'].innerHTML = shown.map(i => `<li><bdi>${escapeHtml(i)}</bdi></li>`).join('') +
      (t.open_items.length > shown.length
        ? `<li id="cap-more">+${t.open_items.length - shown.length} more still open</li>` : '');
    /* A landmark can be walked into whether or not anybody is working in it —
       the building is there either way. Only a plain quarter has nothing to
       open, and it says so instead of promising a door. */
    const walkable = !!(q && q.formKey);
    dom['cap-hint'].textContent = walkable
      ? 'click again, or Enter, to go inside'
      : (t.is_live && t.live_session
          ? 'click again to fly in' : 'click again, or Enter, to go inside');
    dom['cap-hint'].className = '';
  } else {
    dom['cap-path'].textContent = r.folder ? r.folder + '/' : 'the vault root';
    bits.push(`<span class="line quiet">${r.words.toLocaleString()} words · ` +
              `${r.inlinks} note${r.inlinks === 1 ? '' : 's'} link here · written ${ago(r.modified)}</span>`);
    if (hit.rec && hit.rec.kind === 'bridge') {
      bits.push('<span class="line quiet">one bridge per day, in date order, mountain to sea.</span>');
    }
    if (hit.rec && hit.rec.kind === 'fortress') {
      bits.push(`<span class="line quiet">${plan.boardsOpen} cards still open on this board; ` +
                `${Math.min(24, plan.boardsOpen)} of them stand on the walls.</span>`);
    }
    dom['cap-agents'].innerHTML = '';
    dom['cap-open'].innerHTML = '';
    dom['cap-hint'].textContent = 'click again, or Enter, to go inside · O opens it in Obsidian';
    dom['cap-hint'].className = '';
  }
  dom['cap-state'].innerHTML = bits.join('');
  if (SCREENSAVER) dom['cap-hint'].textContent = '';
  dom.caption.hidden = false;
  dom['a11y-status'].textContent = r.title;
}

function closeCaption() { selected = null; dom.caption.hidden = true; }


/* =============================================================================
   THE BUTTONS — what enter, exit and search MEAN on the island
   controls.js owns the cluster; this owns the three verbs, and each calls the
   function the KEY already called. See controls.js's header for why a mouse
   needs its own way in at all.
   ========================================================================== */
function bindControls() {
  /* The masthead's "globe" anchor is the fourth way off this page and it is
     hand-written in world.html, so it cannot carry the flag by itself. Rewritten
     here rather than in the markup because only this side knows whether the page
     is inside the wallpaper (controls.js CONTROLS-WALLPAPER). */
  const globeLink = document.getElementById('globe-link');
  if (globeLink) globeLink.href = Controls.href('globe.html');

  /* The same `hovered || selected` the Enter key reads, so the button and the
     key can never disagree about what is in the crosshair. A printed building
     is skipped for the reason act() states: it has no inside. */
  const aim = () => {
    if (Interior.busy()) return null;      // already inside; there is no deeper
    const hit = hovered || selected;
    return hit && hit.kind !== 'print' ? hit : null;
  };
  Controls.install({
    target: () => { const h = aim(); return h ? h.ref.title : null; },
    enter: () => { const h = aim(); if (h) act(h); },
    /* Four levels, innermost first — the exact order the Escape key unwinds
       them, plus the one step Escape has never had: the island's own way up to
       the globe, which until now was only the small link in the masthead. */
    exitLabel: () => Interior.busy() ? 'leave'
                   : !dom.search.hidden ? 'close search'
                   : !dom.caption.hidden ? 'close' : 'globe',
    exit: () => {
      if (Interior.busy()) { Interior.leave(); return; }
      if (!dom.search.hidden) { closeSearch(); return; }
      if (!dom.caption.hidden) { closeCaption(); return; }
      /* Controls.href keeps `wallpaper=1` on the way back to the planet: a bare
         'globe.html' lands the desktop on a globe whose button cluster falls
         below the taskbar and cannot be clicked again (controls.js
         CONTROLS-WALLPAPER). */
      location.href = Controls.href('globe.html');
    },
    search: {
      open: openSearch,
      close: closeSearch,
      isOpen: () => !dom.search.hidden,
      go: q => runSearch(q),
      /* runSearch() flies the WORLD camera. Inside a landmark that camera is
         not the one on screen, so the panel would move a view nobody can see —
         the button greys out until you are back outside. */
      available: () => !Interior.busy(),
    },
    quickLists,
    /* WHERE THE PLAY WINDOW OPENS. `focus` is the param applyFocus() already
       resolves — `plan.index` first, then the town list, then runSearch() — so
       the full-screen window lands on whatever was in the crosshair here. The
       INTERIOR is not carried: standing inside a landmark is a state Interior
       has never had a URL for, and the play window puts you back outside its
       door rather than inventing one (see docs/DECISIONS.md). */
    state: () => { const h = aim(); return { focus: h ? h.ref.id : null }; },
  });
}

/** The clickable addresses under the search field, out of `plan.index` — the
    one map searchHits() itself matches over, so a row can never name a place
    that is not on the island. Read when the panel OPENS: `plan` is null for the
    first seconds of a cold build. */
function quickLists() {
  if (!plan || !plan.index) return [];
  const towns = [], notes = [], days = [];
  for (const rec of plan.index.values()) {
    const r = rec.ref;
    if (!r) continue;
    if (r.type === 'town') towns.push(r);
    else if (r.type === 'note') {
      /* A Daily note's title IS a date — that is what makes the river an index
         of time, and what parseDate() resolves a typed date against. */
      if (r.folder === 'Daily' && /^\d{4}-\d{2}-\d{2}$/.test(r.title || '')) days.push(r);
      else notes.push(r);
    }
  }
  const out = [];
  const recent = towns.filter(r => r.town && r.town.last_active)
    .sort((a, b) => Date.parse(b.town.last_active) - Date.parse(a.town.last_active))
    .slice(0, 6);
  if (recent.length) out.push({
    title: 'last worked in',
    items: recent.map(r => ({ label: r.title || r.id, query: r.title || r.id })),
  });
  days.sort((a, b) => b.title.localeCompare(a.title));
  if (days.length) out.push({
    title: 'recent days',
    items: days.slice(0, 7).map(r => ({ label: r.title, query: r.title })),
  });
  notes.sort((a, b) => (b.inlinks || 0) - (a.inlinks || 0));
  if (notes.length) out.push({
    title: 'most linked notes',
    items: notes.slice(0, 6).map(r => ({ label: r.title || r.id, query: r.title || r.id })),
  });
  return out;
}

const _proj = new THREE.Vector3();
function positionCaption() {
  if (dom.caption.hidden || !selected) return;
  const r = (selected.kind === 'town' && selected.q) ? selected.q : selected.rec;
  _proj.set(r.x, (r.y || 0) + 12, r.z).project(camera);
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  const w = dom.caption.offsetWidth, h = dom.caption.offsetHeight;
  const left = x + 28 + w > window.innerWidth ? x - w - 28 : x + 28;
  dom.caption.style.transform =
    `translate(${Math.max(20, left)}px, ${THREE.MathUtils.clamp(y - h / 2, 20, window.innerHeight - h - 20)}px)`;
}


/* =============================================================================
   ADDRESS SEARCH — "/" then a date, a note title or a project name
   A date flies to that day's bridge, which is what makes the river an index of
   time rather than a decoration. Everything else is a fuzzy match over the same
   two payloads the world is built from — there is no separate search corpus and
   therefore nothing in it that is not on the map.
   ========================================================================== */
function openSearch() {
  dom.search.hidden = false;
  dom['search-input'].value = '';
  dom['search-hits'].textContent = '';
  dom['search-input'].focus();
  if (!plan) dom['search-hits'].textContent = LOADING_HINT;
  dom['search-input'].oninput = () => {
    /* While the plan is null there is nothing to match against, so the field
       says so and remembers the query instead of pretending it found nothing.
       buildWorld() runs it for real as soon as the index exists. */
    if (!plan) { pendingQuery = dom['search-input'].value; dom['search-hits'].textContent = LOADING_HINT; return; }
    const hits = searchHits(dom['search-input'].value).slice(0, 4);
    dom['search-hits'].innerHTML = hits.map(h => escapeHtml(h.label)).join('  ·  ');
  };
}
const LOADING_HINT = 'world still loading…';

/* What the reader asked for while the world was still building, answered the
   moment it can be. An Enter that was a no-op then flies now; a query that was
   only typed gets its hits filled in under the field. */
function runPendingSearch() {
  const q = pendingQuery;
  pendingQuery = null;
  if (!q) { pendingGo = false; return; }
  if (pendingGo) { pendingGo = false; runSearch(q); closeSearch(); return; }
  if (!dom.search.hidden) dom['search-input'].oninput();
}
function closeSearch() { dom.search.hidden = true; dom['search-input'].blur(); }

/** A date in any of the shapes Beri actually types. Returns YYYY-MM-DD or null. */
function parseDate(q) {
  const s = q.trim().toLowerCase();
  const today = new Date();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (s === 'today' || s === 'heute') return iso(today);
  if (s === 'yesterday' || s === 'gestern') { today.setDate(today.getDate() - 1); return iso(today); }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?\.?$/);   // 14.8 or 14.8.2026
  if (m) return `${m[3] || today.getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/* A cheap subsequence score: every query character has to appear in order, and a
   match that starts at the beginning of the name wins. Two hundred lines of
   fuzzy-matcher for a list of 557 strings would be the definition of fat. */
function fuzzy(q, s) {
  const a = q.toLowerCase(), b = s.toLowerCase();
  if (b.startsWith(a)) return 1000 - b.length;
  let i = 0, score = 0;
  for (let j = 0; j < b.length && i < a.length; j++) {
    if (b[j] === a[i]) { score += 10 - Math.min(9, j - i); i++; }
  }
  return i === a.length ? score : -1;
}

/* The query typed before the world existed, replayed the moment it does.
   Cold, this box builds in about 25 s and the field was live from the first
   frame: every keystroke read `plan.index` on a null plan and threw, once per
   key and once for Enter, with nothing on screen to say why. */
let pendingQuery = null, pendingGo = false;

function searchHits(q) {
  if (!plan) return [];                 // the world is still building — see openSearch()
  if (!q || !q.trim()) return [];
  const date = parseDate(q);
  const out = [];
  if (date) {
    const rec = plan.index.get('Daily/' + date);
    if (rec) out.push({ label: date + ' — its bridge', rec, score: 1e6 });
  }
  for (const [id, rec] of plan.index) {
    const name = rec.ref ? rec.ref.title : id;
    const s = fuzzy(q, name);
    if (s > 0) out.push({ label: name, rec, score: s });
  }
  for (const key in REGIONS) {
    const s = fuzzy(q, REGIONS[key].label);
    if (s > 0) out.push({ label: REGIONS[key].label, rec: REGIONS[key], score: s * 0.9 });
  }
  return out.sort((a, b) => b.score - a.score);
}

function runSearch(q) {
  const hit = searchHits(q)[0];
  if (!hit) { dom['a11y-status'].textContent = `nothing on the map matches "${q}".`; return; }
  const r = hit.rec;
  flyTo(r.x, r.z, 90, 0.22);
  if (r.ref) { selected = { kind: r.ref.type === 'town' ? 'town' : 'note',
                            rec: r, q: quarters.get(r.ref.id), ref: r.ref };
               if (selected.kind === 'town' && !selected.q) selected.kind = 'note';
               showCaption(selected); }
}

/* The one camera in this file that docs/shots also uses, stated once so the
   shot list and the ?focus= link can never drift apart. Numbers measured, see
   applyFocus() below and RUNBOOK -> Capture the shots. */
/* RE-COMPOSED 2026-09-06, and the old frame's own failure is the reason. TESTS
   known limit 6 read: "`?focus=harbour` never shows the harbour — it lands at
   roof height inside the housing with no water, no quays and no boats in frame;
   the shot is indistinguishable from any other dense street." That was exactly
   true, and it was true for a geometric reason nobody had written down: on this
   island the sea is at +x and the sun sets at -x (`__dbg.sun()` at 19:30 reads
   an azimuth of -3.01 rad, which is due -x). A camera that looks at the sunset
   has the water behind it; a camera that looks at the water is a night shot at
   half past seven. The two cannot both be in front of the lens.

   So this frame looks ALONG the shore instead of across it — theta 4.60, which
   puts the sun about ninety degrees to the right and rakes it across every
   facade in the frame rather than flattening them from behind. What that buys,
   measured off the capture and not asserted: the sea and the offshore island
   fill the left third with the surf line running diagonally out of the corner,
   the moored ships are in frame (one under sail mid-water, two more at the
   bottom edge), the quay and its trees run up the middle, and the right two
   thirds are the live end of the harbour — `claude-live` and
   `wild-digital-moments` are both alive here, with their craft and its lit ring
   over them. It stands at the NORTH end because that is where the live
   quarters are; `busiestLiveQuarter()` finds them by data, this frame is the
   fixed one docs/shots is taken with.

   THE LANDMARK FRAME MOVED OUT FROM UNDER THIS ONE. `world-landmarks.png` used
   to be "whatever `?focus=harbour` is"; it is now taken with an explicit
   `__goto(95, -95, 88, 0.34, 0.80)` — these numbers, which is what this
   constant was — see RUNBOOK -> Capture the shots. */
const HARBOUR_VIEW = { x: 120, z: -232, dist: 104, phi: 0.31, theta: 4.60 };
/* ?focus=live's stand-off — RUNBOOK's own recipe for the drone shot (TESTS.md
   row I4b: `__goto(102.8, -237.6, 58, 0.30, 2.35)` over claude-live). dist 58
   is close enough that an ORNIS craft orbiting its quarter is a shape, not a
   speck; phi 0.30 is the same low elevation the harbour view uses. theta is
   fixed rather than solved per quarter — the sun-behind-the-lens trap
   HARBOUR_VIEW's own comment names applies here too, and 0.80 already clears
   it for every quarter on this island's layout. */
const LIVE_VIEW = { dist: 58, phi: 0.30, theta: 0.80 };
/* How often the idle orbit swings its target over the busiest live quarter
   before returning to the harbour (I4 fix, "so a screensaver viewer sees the
   work"). Reuses flyTo()'s own ease rather than a second one — this is a
   scheduled fly-there-and-back, not a new camera mode. */
const LIVE_ORBIT_PERIOD_MS = 60000;
const LIVE_ORBIT_HOLD_MS = 10000;
let liveOrbitDueAt = 0;

/** The live quarter an idle viewer is most likely to find something happening
    in: most `live_agents` right now, ties broken by whichever town's own
    `last_active` is most recent. Null when nothing on the island is live. */
function busiestLiveQuarter() {
  let best = null, bestAgents = -1, bestActive = -1;
  for (const q of quarters.values()) {
    if (!q.town.is_live) continue;
    const n = (q.town.live_agents || []).length;
    const active = Date.parse(q.town.last_active || '') || 0;
    if (n > bestAgents || (n === bestAgents && active > bestActive)) {
      best = q; bestAgents = n; bestActive = active;
    }
  }
  return best;
}

/* I4 fix — a screensaver viewer watches the whole idle orbit and none of it
   used to dwell over the agents actually doing work. Every
   LIVE_ORBIT_PERIOD_MS, if the orbit is genuinely idle (not fixed, not free
   flying, no fly already under way, search closed), swing the target to the
   busiest live quarter for LIVE_ORBIT_HOLD_MS then swing back — two flyTo()
   calls reusing the ease a manual search already uses, not a second camera
   mode. A tick with nothing live just reschedules the next check. */
function maybePassOverLiveQuarter() {
  if (CAMERA_FIXED || free.on || cam.fly || !dom.search.hidden) return;
  const now = performance.now();
  if (now <= cam.manualUntil || now < liveOrbitDueAt) return;
  liveOrbitDueAt = now + LIVE_ORBIT_PERIOD_MS;
  const q = busiestLiveQuarter();
  if (!q) return;
  const back = { x: camTarget.x, z: camTarget.z, dist: cam.dist, phi: cam.phi };
  flyTo(q.x, q.z, LIVE_VIEW.dist, LIVE_VIEW.phi);
  setTimeout(() => {
    if (!CAMERA_FIXED && !free.on && !cam.fly && performance.now() > cam.manualUntil) {
      flyTo(back.x, back.z, back.dist, back.phi);
    }
  }, LIVE_ORBIT_HOLD_MS);
}

/** ?focus=vault | harbour | live | <town id or name> | <note id>. The vault.html redirect uses it. */
function applyFocus() {
  if (!FOCUS) return;
  if (FOCUS === 'vault') { flyTo(REGIONS.vault.x, REGIONS.vault.z, 420, 0.34); return; }
  /* ?focus=harbour — THE HARBOUR, and since 2026-09-06 it actually shows one:
     water, the surf line, moored ships, the quay and two live quarters in one
     frame. The whole reading, including why the sun cannot be in it, is on
     HARBOUR_VIEW itself. Two things it is NOT any more: it is not the landmark
     shot (`world-landmarks.png` carries its own explicit `__goto` now), and it
     is not the fleet shot either — `?focus=live` below stands closer, over
     whichever quarter has the most agents in the air right now. This one is
     fixed, because it is the frame `world-harbour.png` is taken with and a
     reference shot that moves with the data is not a reference. */
  if (FOCUS === 'harbour') {
    cam.theta = HARBOUR_VIEW.theta;
    flyTo(HARBOUR_VIEW.x, HARBOUR_VIEW.z, HARBOUR_VIEW.dist, HARBOUR_VIEW.phi);
    return;
  }
  /* ?focus=live (I4 fix) — the busiest quarter with real work in flight, at
     RUNBOOK's own drone-shot distance, so its craft and their session tags
     stand in frame instead of specks at harbour range. Falls back to the
     harbour when nothing on the island is live right now. */
  if (FOCUS === 'live') {
    const q = busiestLiveQuarter();
    cam.theta = q ? LIVE_VIEW.theta : HARBOUR_VIEW.theta;
    if (q) flyTo(q.x, q.z, LIVE_VIEW.dist, LIVE_VIEW.phi);
    else flyTo(HARBOUR_VIEW.x, HARBOUR_VIEW.z, HARBOUR_VIEW.dist, HARBOUR_VIEW.phi);
    return;
  }
  const direct = plan.index.get(FOCUS);
  if (direct) { runSearchRecord(direct); return; }
  const town = world.towns.find(t => t.name === FOCUS || t.id === FOCUS);
  if (town && plan.index.get(town.id)) { runSearchRecord(plan.index.get(town.id)); return; }
  runSearch(FOCUS);
}
function runSearchRecord(rec) {
  flyTo(rec.x, rec.z, 90, 0.22);
  if (rec.ref) {
    selected = { kind: rec.ref.type === 'town' ? 'town' : 'note',
                 rec, q: quarters.get(rec.ref.id), ref: rec.ref };
    if (selected.kind === 'town' && !selected.q) selected.kind = 'note';
    showCaption(selected);
  }
}


/* =============================================================================
   QUALITY — one toggle, remembered, and a floor it drops to on its own
   ========================================================================== */
function setQuality(q, announce) {
  quality = q;
  try { localStorage.setItem('werkstadt.quality', q); } catch (e) { /* private mode */ }
  renderer.shadowMap.enabled = q === 'high';
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  if (water) buildSea();
  /* KIT_MAX_LOD0 is read per solve, so dropping to medium has to force one —
     otherwise twenty-two full buildings stay standing until the camera next
     moves nine metres, which is the exact moment the frame rate needed them
     gone. The prop pools are sized at build time and are not resized here; a
     quality switch mid-flight keeps the caps it booted with. */
  if (kitRecs.length) updateKitLod(true);
  if (announce) {
    dom.quality.textContent = q === 'high' ? 'quality: high' : 'quality: medium — shadows off';
    dom.quality.hidden = false;
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(() => { dom.quality.hidden = true; }, 2600);
  }
}
let qualityTimer = null;


/* =============================================================================
   CHROME — the counts line and the wall clock
   ========================================================================== */
function recount() {
  if (!vault) return;
  const live = world.towns.filter(t => t.is_live);
  /* The masthead's own number, from the endpoint's own headline counter. The
     towns' `live_agents` arrays sum HIGHER, because a subagent whose file tools
     touch two towns rides in both — server.py ships that fanned-out total
     separately as `meta.agent_slots`. Its presence is the signal that the
     server knows the difference; until it is there the summed rows are all
     there is, and that is what the page keeps showing. */
  const meta = world.meta || {};
  const agents = (meta.agent_slots !== undefined && meta.agents_in_flight !== undefined)
    ? meta.agents_in_flight
    : live.reduce((n, t) => n + t.live_agents.length, 0);
  dom['world-counts'].innerHTML =
    `<b>${vault.counts.notes}</b> notes · <b>${vault.counts.resolved.toLocaleString()}</b> links · ` +
    `<b>${world.towns.length}</b> towns · <b class="alive">${live.length}</b> alive · ` +
    `<b>${agents}</b> agent${agents === 1 ? '' : 's'} in flight`;
}

function tickClock() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  dom['world-clock'].textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* The help card: every control on one line each, six seconds, once per browser
   — and `H` for the rest of the time, because "shown once and never again" is
   only kind to the person who read it the first time. */
let hintsTimer = 0;
function showHints() {
  if (SCREENSAVER) return;
  dom.hints.hidden = false;
  /* Re-showing a hidden element does not replay its animation; nulling it and
     reading a layout property forces the restart. */
  dom.hints.style.animation = 'none';
  void dom.hints.offsetWidth;
  dom.hints.style.animation = '';
  clearTimeout(hintsTimer);
  hintsTimer = setTimeout(() => { dom.hints.hidden = true; }, 6000);
}

function showHintsOnce() {
  if (SCREENSAVER) return;
  if (localStorage.getItem('werkstadt.world-hints') === 'seen') return;
  showHints();
  try { localStorage.setItem('werkstadt.world-hints', 'seen'); } catch (e) { /* private mode */ }
}


/* =============================================================================
   HELPERS
   ========================================================================== */
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return 'never';
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const basename = p => (p || '').split('/').pop();
const clipName = (n, max) => (String(n).length > max ? String(n).slice(0, max - 1) + '…' : String(n));
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const clock = () => (performance.now() - bootMs) / 1000;


/* =============================================================================
   THE FRAME LOOP
   A hidden or backgrounded tab pauses requestAnimationFrame — see RUNBOOK.md.
   ========================================================================== */
let last = performance.now();
const fpsRing = [];
let clockAcc = 0, sunAcc = 99, slowSince = 0;
/* The auto-degrade is a screensaver protection, and it is also the thing that
   makes a HIGH-quality frame-rate measurement impossible: five seconds under 35
   and the page has quietly switched to medium under the instrument. __autoDegrade
   (false) is how RUNBOOK.md's gate table is measured; nothing else turns it off. */
let autoDegrade = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsRing.push(dt);
  if (fpsRing.length > 90) fpsRing.shift();
  const t = clock();

  /* The interior walks the player and, while it is flying, writes the lens — so
     it runs BEFORE updateCamera(), which reads camOverride. Same order city.js
     uses and for the same reason. */
  Interior.update(dt);
  updateCamera(dt);

  /* WHEN THE PICTURE IS A ROOM the world is not drawn, so nothing that only
     moves the world is worth solving: the sea's ripple, the cranes, the signs'
     per-frame projection and the drones' orbits are all invisible from inside a
     practice room. Skipping them is what pays for the page window's compositing
     cost — see the fps table in RUNBOOK. The sun still moves, because the light
     through the hall's windows is the same sun. */
  /* THREE STATES, not two. `overlay` is the bridge deck and the lighthouse:
     the reader is inside something, but the world is still the picture and the
     room is a layer over it, so everything the world moves must keep moving.
     `within` keeps its old meaning — the world is not drawn at all — and every
     test below it is unchanged. */
  const inRoom = Interior.inside();
  const overlay = inRoom && Interior.overlay();
  const within = inRoom && !overlay;

  /* The sun moves at the speed the sun moves; solving it every frame would be
     3,600 solves for one degree of arc. Twice a second is already generous. */
  sunAcc += dt;
  if (sky && sunAcc > 0.5) { sunAcc = 0; updateSun(); }

  if (water && !within) {
    /* Two seas, one clock. The reflective Water animates its own ripple from a
       `time` uniform; the cheap one is a standard material, so its ripple is
       the normal map's own offset being scrolled. The surf line breathes on the
       same clock as the beach's, or the foam on the water and the foam on the
       sand run out of step and the shore reads as two animations meeting. */
    const wu = water.material.uniforms || (water.material.userData.uniforms || {});
    if (wu.time) wu.time.value += dt * 0.35;
    else if (water.material.normalMap) {
      water.material.normalMap.offset.x += dt * 0.0016;
      water.material.normalMap.offset.y -= dt * 0.0011;
    }
    if (wu.uSurf) wu.uSurf.value = t;
  }
  if (terrain && !within) terrain.material.userData.uniforms.uTime.value = t;
  if (groups.river && !within) {
    /* The river flows: the normal map is scrolled downstream, which is the whole
       animation. Anything more would be a simulation nobody can see from here. */
    const n = groups.river.material.normalMap;
    n.offset.y -= dt * 0.09;
    n.offset.x += dt * 0.012;
  }
  if (groups.traffic && !within) {
    groups.traffic.material.uniforms.uTime.value = t;
    groups.traffic.material.uniforms.uNight.value = nightAmount;
  }
  if (groups.smoke && !within) {
    groups.smoke.material.uniforms.uTime.value = t;
    groups.smoke.material.uniforms.uNight.value = nightAmount;
  }

  /* Cranes turn. Slowly — what a crane has to say is that work is unfinished,
     not that it is frantic. */
  if (pools.craneMast && pools.craneMast.count && !within) {
    for (let i = 0; i < pools.craneMast.count; i++) {
      const c = cranes[i];
      _e4.set(0, 0, 0);
      _m4.compose(_v3.set(c.x, c.y, c.z), _q4.setFromEuler(_e4), _s3.set(1, c.h, 1));
      pools.craneMast.setMatrixAt(i, _m4);
      _e4.set(0, c.phase + t * 0.1, 0);
      _m4.compose(_v3.set(c.x, c.y + c.h, c.z), _q4.setFromEuler(_e4), _s3.set(1, 1, 1));
      pools.craneJib.setMatrixAt(i, _m4);
    }
    pools.craneMast.instanceMatrix.needsUpdate = true;
    pools.craneJib.instanceMatrix.needsUpdate = true;
  }

  if (!within) { updateLandmarkProps(t); updateSigns(); }

  /* THE TWO SHELLS. Both are gated on the lens having actually travelled — the
     kit's instanced groups and the prop pools are rebuilt, not tweaked, so
     doing it per frame would cost far more than either LOD saves. Skipped while
     the picture is a room, for the same reason the cranes are. */
  if (!within) { updateKitLod(false); updateProps(false); }

  /* Drones circle over their own quarter, banking into the turn. */
  for (const d of within ? [] : drones.values()) {
    const q = quarters.get(d.townId);
    if (!q) continue;
    d.prev.copy(d.group.position);
    d.orbit += dt * (d.isMain ? 0.22 : 0.36);
    d.group.position.set(q.x + Math.cos(d.orbit) * d.radius,
                         d.height + Math.sin(t * 0.9 + d.orbit) * 0.7,
                         q.z + Math.sin(d.orbit) * d.radius);
    d.group.rotation.y = -d.orbit;
    /* THE KIT BANKS ITSELF — integration note 7. Handing it the real velocity
       makes it roll into the turn and spool its rotors, so the hard-coded
       rotation.z survives only on the orb path, which has nothing to bank with. */
    if (d.variant) {
      _v3.subVectors(d.group.position, d.prev).divideScalar(Math.max(1e-4, dt));
      d.group.userData.setSpeed(_v3);
      d.group.rotation.z = 0;
    } else {
      d.group.rotation.z = Math.sin(d.orbit * 2) * 0.12;
    }
  }
  if (!within && droneKit) { droneKit.update(dt, camera); stepDroneTrails(dt); }
  if (!within) updateDroneLabels();
  /* THE LIVING LAYER: one call a frame — simulation, then LOD, then draw. Held
     while the picture is a room for the same reason the cranes are: nothing on
     the island is visible from inside a practice hall, and this is the most
     expensive per-frame solve on the page. */
  if (life && !within) life.update(dt, camera);
  if (!within) stepPrints(dt);

  positionCaption();
  clockAcc += dt;
  if (clockAcc > 0.5) { clockAcc = 0; tickClock(); }

  /* The floor under the frame rate. Five seconds under 35 and the world drops to
     medium by itself — a screensaver nobody is watching must not be the thing
     that makes the machine hot. */
  if (autoDegrade && quality === 'high' && fpsRing.length > 60) {
    const fps = fpsRing.length / fpsRing.reduce((a, b) => a + b, 0.0001);
    if (fps < 35) { if (!slowSince) slowSince = now; else if (now - slowSince > 5000) setQuality('medium', true); }
    else slowSince = 0;
  }

  /* WHICH SCENE IS THE PICTURE. Only once the fly-in has landed: during the
     flight the world is still what you are looking at, and that is the shot
     `world-int-door.png` catches. */
  const drawScene = within ? Interior.getScene() : scene;
  const drawCam = inRoom ? Interior.getCamera() : camera;
  drawCam.updateMatrixWorld();
  /* The dome follows whichever lens is drawing: a Sky is a 4,000-unit sphere
     centred on the camera, and left at the origin it clips through the far wall
     of a hall standing a hundred units out in the harbour. */
  const dome = within ? Interior.getSky() : sky;
  if (dome) dome.position.copy(drawCam.position);
  renderPass.scene = drawScene;
  renderPass.camera = drawCam;
  if (bloomPass.enabled) bloomPass.strength = overlay ? BLOOM_OVERLAY : BLOOM_STRENGTH;
  composer.render();
  /* THE LAYER OVER THE WORLD. The composer has just drawn the island from the
     walker's own lens; clearing the DEPTH buffer (not the colour) and drawing
     the interior scene straight to the same canvas puts the deck's plaques or
     the tower's stair in front of it, and leaves the world showing through
     every gap in them — which is what a window and a bridge railing are.
     Not a composer pass: bloom over a lamp is the world's, and running the
     room through it a second time would double every bright thing on screen. */
  if (overlay) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(drawScene === scene ? Interior.getScene() : drawScene, drawCam);
    renderer.autoClear = true;
  }
}


/* =============================================================================
   PROBES — the instruments RUNBOOK.md's gate numbers are measured with
   ========================================================================== */
window.__fps = () => Math.round(fpsRing.length / fpsRing.reduce((a, b) => a + b, 0.0001));
/* The navigation instrument. Every number the nav gates are stated in is read
   from here and nowhere else — where the lens actually is, how far over the
   ground, what the orbit is aiming at, and which of the two modes has it. A
   screenshot cannot answer any of those and a probe that ENTERS something is
   not a test of the pointer, so this only reports. */
window.__cam = () => ({
  x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2),
  aboveGround: +(camera.position.y - Math.max(SEA, landAt(camera.position.x, camera.position.z))).toFixed(2),
  dist: +cam.dist.toFixed(2),
  targetX: +camTarget.x.toFixed(2), targetZ: +camTarget.z.toFixed(2),
  free: free.on, pointerLock: document.pointerLockElement === canvas,
  hints: !dom.hints.hidden,
});
/** Visible drawable leaves under one object — one InstancedMesh is one call
    whatever its count, which is what a draw-call budget is about. */
function countDraws(root) {
  if (!root) return 0;
  let n = 0;
  root.traverse(o => {
    if (!o.visible) return;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) n += o.count > 0 || !o.isInstancedMesh ? 1 : 0;
  });
  return n;
}
window.__structures = () => plan ? plan.structures.length : 0;
window.__trees = () => plan ? plan.forest.length : 0;
window.__roads = () => plan ? plan.roadPts.length : 0;
window.__links = () => plan ? { local: plan.roadsDrawn, trunks: plan.trunkRoads, carriedByTrunks: plan.linksBundled } : null;
window.__bridges = () => plan ? plan.bridges.length : 0;
window.__towns = () => quarters.size;
/* How many quarters were shaped by their project's own trade, and how many site
   pages became wings. Both are the gate for the landmark pass. */
window.__landmarks = () => {
  const t = plan ? plan.quarters.filter(q => FORM_BUILDERS[TRADE_FORMS[q.trade]]) : [];
  return { shaped: t.length,
           wings: (pools.lmWing ? pools.lmWing.count : 0),
           signs: (groups.signs ? groups.signs.children.length : 0),
           forms: t.reduce((m, q) => (m[q.formKey] = (m[q.formKey] || 0) + 1, m), {}) };
};
/* One town's ground truth, for proving a sign names its own landmark and a
   landmark's form matches its own trade — the two things the "site-editor"
   verdict called into question. Exact name match first, so "site-editor"
   cannot resolve to the "site-editor-promo" quarter next to it. signText is
   simply q.town.name: signTexture() never draws anything else onto the
   plaque. ownSignIsNearest is the second half of the same check — the sign
   physically closest to this landmark's position has to be its OWN sign,
   never a neighbour's. */
window.__landmarkAt = (name) => {
  if (!plan) return null;
  const low = String(name).toLowerCase();
  const q = plan.quarters.find(qq => (qq.town.name || '').toLowerCase() === low)
         || plan.quarters.find(qq => (qq.town.name || '').toLowerCase().includes(low));
  if (!q) return null;
  let nearest = null, nearestD = Infinity;
  const here = new THREE.Vector3(q.x, q.y, q.z);
  if (groups.signs) {
    for (const spr of groups.signs.children) {
      const d = spr.position.distanceTo(here);
      if (d < nearestD) { nearestD = d; nearest = spr; }
    }
  }
  return {
    town: q.town.name, trade: q.trade, form: q.formKey || null,
    signText: q.town.name,
    pos: { x: q.x, y: q.y, z: q.z },
    ownSignIsNearest: !!(nearest && nearest.userData.q === q),
    nearestSignTown: nearest && nearest.userData.q ? nearest.userData.q.town.name : null,
  };
};
/* THE SIGN LEGIBILITY INSTRUMENT. Same shape as __tags() and the interior's
   minGlyphPx: how tall the town name's capitals actually are ON THE FRAME, in
   pixels, for the signs that are visible from where the camera is standing right
   now. A screenshot cannot be measured by eye and a world size means nothing
   without a distance, so this is the number the gate is read off.
     visible  — signs drawing this frame
     culled   — signs suppressed because a busier town's sign overlapped them
     minCapPx / medCapPx — the floor and the middle of the visible set. Floor: 18 */
window.__signPixels = () => ({ ...signStat, capTarget: SIGN_CAP_PX });
/* THE KIT TOWN and THE PROPS, for the counts RUNBOOK's gate table asks for.
   `lod` is how many kit buildings are standing at each band right now, which is
   a function of where the camera is — read it after the fly has landed. */
window.__kit = () => {
  const lod = [0, 0, 0];
  for (const r of kitRecs) lod[r.obj ? 0 : r.band]++;   // lod2 is always 0 — see updateKitLod
  const cat = {};
  for (const r of kitRecs) {
    const k = r.d.style + '|' + r.d.palette + '|' + r.d.roof;
    cat[k] = (cat[k] || 0) + 1;
  }
  return { buildings: kitRecs.length, lod0: lod[0], lod1: lod[1], lod2: lod[2],
           catalogue: cat, night: kit ? kit.night : null,
           instGroups: kitInst ? kitInst.children.length : 0 };
};
window.__props = () => {
  const out = { shell: PROP_SHELL, placed: {}, slots: {}, lights: 0 };
  for (const k of PROP_KEYS) {
    out.slots[k] = propSlots[k] ? propSlots[k].length : 0;
    out.placed[k] = propPools[k] ? propPools[k].parts[0].count : 0;
  }
  out.lights = lampLights.filter(l => l.visible).length;
  out.bulbs = propBulbs ? propBulbs.count : 0;
  out.realTreesHiding = treeSlots.filter(t => t.hidden).length;
  /* WHERE TO STAND TO SEE THEM. `placed` is the nearest `cap` slots inside
     PROP_SHELL and nothing else, so every pool reads 0 from any camera more
     than 115 m off the ground — which is every overview framing, `?focus=vault`
     included, and reads as "the props failed to load" when nothing failed
     (docs/TESTS.md H2). This hands the harness the nearest slot of each type in
     WORLD coordinates, so a capture can `__goto(x, z, …)` to it and photograph
     the thing instead of inferring it from a zero. */
  out.nearest = {};
  for (const k of PROP_KEYS) {
    const list = propSlots[k];
    if (!list || !list.length) continue;
    let best = null, bd = Infinity;
    for (const s of list) {
      const d = camera.position.distanceToSquared(_v3.set(s.x, s.y, s.z));
      if (d < bd) { bd = d; best = s; }
    }
    out.nearest[k] = { x: +best.x.toFixed(1), y: +best.y.toFixed(1), z: +best.z.toFixed(1),
                       metres: +Math.sqrt(bd).toFixed(0) };
  }
  return out;
};
window.__cranes = () => cranes.length;
/* Still a plain number, and still one craft per live agent — nothing about that
   changed when the octahedrons became aircraft, and RUNBOOK's gate table reads
   it as an integer. WHICH aircraft is __fleet() below. */
window.__drones = () => drones.size;
/* How many craft are actually INSIDE the frame this instant, and where — the
   same probe globe.js already carries (`__craftOnScreen()`), added here for
   I4's own verification: waiting for a craft to be on screen at HARBOUR_VIEW's
   drone-shot distance is what tells a capture whether to press the shutter,
   instead of taking the picture and hoping. */
const _craftNdc = new THREE.Vector3();
window.__craftOnScreen = () => {
  const on = [];
  for (const [key, d] of drones) {
    _craftNdc.copy(d.group.position).project(camera);
    if (_craftNdc.z < 1 && Math.abs(_craftNdc.x) < 0.92 && Math.abs(_craftNdc.y) < 0.86) {
      on.push({ key, variant: d.variant, townId: d.townId,
                x: +_craftNdc.x.toFixed(2), y: +_craftNdc.y.toFixed(2) });
    }
  }
  return { onScreen: on.length, total: drones.size, craft: on };
};
/* THE FLEET — which airframe each live agent is flying, which is a readout of
   what the agents are actually DOING: an `orchestrator` is the main session, a
   `worker.edit` is an agent with a Write open right now, a plain `agent` is one
   with nothing in flight. `orb` means the kit is not loaded (`?drones=orbs`). */
window.__fleet = () => {
  const variants = {};
  for (const d of drones.values()) variants[d.variant || 'orb'] = (variants[d.variant || 'orb'] || 0) + 1;
  return { craft: drones.size, kit: !!droneKit, variants,
           working: [...drones.values()].filter(d => d.working).length,
           trails: trailMesh ? TRAIL_SLOTS - trailFree.length : 0,
           stats: droneKit ? droneKit.stats() : null };
};
/* THE LIVING LAYER, and the numbers the design rule is checked against: every
   count next to the datum it came from, plus the draw-call figure the <= 90
   budget is read off. `counted` is what this file ASKED for; `stats` is what
   life.js actually built, and the two disagreeing is the bug to look for. */
window.__life = () => {
  if (!life) return { on: false, off: LIFE_OFF, counted: lifeCounted };
  return { on: true, counted: lifeCounted, stats: life.stats(),
           /* The draw-call figure the <= 90 budget is read off. There is no way
              to ask the renderer for "this group's share", so it is counted the
              only honest way: every visible mesh under life's own group. */
           draws: countDraws(life.group), maxSkinned: LIFE_MAX_SKINNED, rigid: LIFE_RIGID };
};
/* THE CARS, AND WHERE THEY ARE NOT ALLOWED TO BE. Two failures in one probe,
   both invisible in a screenshot taken at the wrong second: a vehicle that has
   left the carriageway, and a vehicle standing on a plaza. `offCarriageway` is
   the answer to both and it is meant to read `[]` — anything in it names the
   car, how far it is from the nearest lane centre line, and which square it is
   on. The tolerance is life.js's own lane offset plus a metre of slack, because
   a vehicle rides a LANE and a lane is LANE_HALF (2.6 m) off the centre line
   this file handed it. */
const VEHICLE_LANE_TOL = 3.6;
/* To the nearest point of the SEGMENT, not to the nearest vertex. A lane is a
   polyline with tens of metres between its points, so a car halfway along a
   straight run is ten metres from the nearest vertex while sitting exactly on
   the line — the first version of this probe reported fourteen cars off the
   carriageway for that reason alone and every one of them was on it. */
function distToSegment2D(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2)) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}
window.__vehicles = () => {
  if (!life || !life.vehicles) return { on: false };
  const plazas = lifePlazas();
  const off = [];
  life.vehicles.forEach((v, i) => {
    let near = Infinity;
    for (const lane of life.lanes) {
      for (let k = 1; k < lane.pts.length; k++) {
        const a = lane.pts[k - 1], b = lane.pts[k];
        const d = distToSegment2D(v.pos.x, v.pos.z, a.x, a.z, b.x, b.z);
        if (d < near) near = d;
      }
    }
    const onPlaza = plazas.findIndex(pz =>
      Math.hypot(v.pos.x - pz.center[0], v.pos.z - pz.center[2]) < pz.radius);
    if (near > VEHICLE_LANE_TOL || onPlaza >= 0) {
      off.push({ car: i, toLane: +near.toFixed(2), plaza: onPlaza >= 0 ? onPlaza : null,
                 x: +v.pos.x.toFixed(1), z: +v.pos.z.toFixed(1) });
    }
  });
  return { cars: life.vehicles.length, lanes: life.lanes.length, plazas: plazas.length,
           tol: VEHICLE_LANE_TOL, offCarriageway: off };
};
/* THE PRINT, for the shot harness's until-expression. A print lasts three
   seconds and does not happen at a time anyone can predict, so the capture
   polls this: `k` is how far down the cut has travelled (0 at the ridge, 1 on
   the ground), `seconds` is how long this one runs for, `cue` says whether the
   lens is inside a cue this instant. */
window.__print = () => {
  const j = printJobs.find(p => p.flash < 0) || printJobs[0] || null;
  return { jobs: printJobs.length, cue: printCued(), built: livePrints.size,
           k: j ? Math.min(1, j.t / j.life) : 0,
           seconds: j ? +j.life.toFixed(2) : 0,
           flash: j ? j.flash : -1,
           rigs: printRigs.filter(r => r.job).length,
           /* Where the lot IS, so a capture can be standing over it before the
              three seconds start rather than flying in after they finish. */
           x: j ? +j.rec.d.position[0].toFixed(2) : null,
           z: j ? +j.rec.d.position[2].toFixed(2) : null,
           path: j ? j.rec.path : null };
};
/* The plot the NEXT live building in this town will stand on — the same
   livePlot() a real pulse uses. The `world-print.png` capture needs it: a print
   lasts three seconds and a camera flight takes two, so the lens has to be
   pointed at the ground before the file is touched. Read-only. */
/* The waterfront pavement, as the crowd walks it. The `world-street.png` recipe
   stands the lens ON it and looks along it — an eye-level shot aimed at a
   quarter's centre instead lands inside somebody's wall or out in the surf,
   which is what the first two captures of this pass were. */
/* EVERY BUILDING THAT STANDS FOR A FILE, and how it got there. `seed` is what
   the load pass recovered off `/api/project` (the proof that a reload does not
   empty the back yards), `grown` how many gained a floor from a later write and
   what the last one of those rebuilds COST — the number the growth rule was
   argued on, measured rather than asserted. `clickable` must equal `built`: a
   printed building without a collider is one nobody can read. */
window.__printed = (path) => path ? (() => {
  /* One building by its own path, for the growth check: print it, read the
     floors, edit it, read them again. A summary cannot answer that. */
  const r = livePrints.get(normPath(path));
  return r ? { path: r.path, floors: r.d.floors, edits: r.edits, seeded: r.seeded,
               clickable: !!r.collider, agent: r.first.agent,
               /* Where it stands, so a capture can point the lens at it and
                  click it with a real pointer rather than a probe. */
               x: +r.d.position[0].toFixed(2), z: +r.d.position[2].toFixed(2),
               at: new Date(r.first.at).toISOString() } : null;
})() : ({
  built: livePrints.size,
  clickable: groups.prints
    ? groups.prints.children.filter(o => o.userData.printRec && !o.userData.printRec.gone).length : 0,
  seeded: [...livePrints.values()].filter(r => r.seeded).length,
  live: [...livePrints.values()].filter(r => !r.seeded).length,
  floors: [...livePrints.values()].reduce((m, r) => (m[r.d.floors] = (m[r.d.floors] || 0) + 1, m), {}),
  grown: growCount, growMs: +growMs.toFixed(1), maxFloors: LIVE_MAX_FLOORS,
  seed: seedStat,
  sample: [...livePrints.values()].slice(0, 3).map(r => ({
    path: r.path, floors: r.d.floors, edits: r.edits, seeded: r.seeded,
    agent: r.first.agent, at: new Date(r.first.at).toISOString() })),
});
window.__quay = () => harbourQuay(2.4);
window.__nextPlot = (townId) => {
  const q = quarters.get(townId);
  if (!q) return null;
  if (!q.printed) q.printed = new Set();
  return livePlot(q);
};
window.__printing = () => printJobs.filter(p => p.flash < 0).length;
window.__derezzing = () => derezCount;
/* One print, on demand, for a capture that cannot wait for the machine to touch
   a new file. Same function `P` calls and nothing else. */
window.__replayPrint = () => replayLastPrint();
/* One synthetic pulse, with no transport in the way — the same function the
   stream hands its messages to, so a test drives the real path. */
window.__pulse = (town, tool, path) => { onWorldPulse({ kind: 'pulse', town, tool, path }); return true; };
window.__live = () => world ? world.towns.filter(t => t.is_live).map(t => t.name) : [];
window.__quality = (q) => { if (q) setQuality(q, true); return quality; };
window.__autoDegrade = (on) => { autoDegrade = on !== false; slowSince = 0; return autoDegrade; };
window.__bloom = (on) => { bloomPass.enabled = on !== false; return bloomPass.enabled; };
window.__night = () => nightAmount;
window.__search = (q) => { runSearch(q); return searchHits(q).slice(0, 3).map(h => h.label); };
window.__select = (name) => {
  const hit = searchHits(name)[0];
  if (!hit) return null;
  runSearchRecord(hit.rec);
  return hit.label;
};
/* theta is the fifth argument and it exists only for docs/shots: the waterfront
   landmarks stand in a line along the coast, and which SIDE the camera is on
   decides whether that line reads as a row of buildings or as one building with
   others hidden behind it. Nothing in the page itself passes it. */
window.__goto = (x, z, d, phi, theta) => { if (theta != null) cam.theta = theta; flyTo(x, z, d, phi); };

/* THE INSIDE OF A LANDMARK, for the capture harness. A screenshot harness has
   no pointer, so the interior is driven by name — these call the same Interior
   entries a second click calls and nothing bypasses the real path. Same four
   names the session city's harness uses, so one harness drives both. */
window.__enterLandmark = (name) => {
  const q = landmarkQuarter(name);
  if (!q) return null;
  return enterLandmark(q) ? q.town.name : null;
};
window.__leaveInterior = () => { Interior.leave(); return true; };
window.__stand = (x, y, z, yaw, pitch) => Interior.stand(x, y, z, yaw, pitch);
window.__interior = () => Interior.probe();
/* One saved note, without an Obsidian to save it in: the same function
   /api/vault's own messages are handed to, with the same shape of payload. */
window.__vaultEvent = (path) => { onVaultEvent({ path }); return true; };
/* The deck a bridge would be walked on, without walking it: the numbers
   enterDeck() solves out of the model's own bounding box. Read-only, and the
   one way to check the deck height against the model without a screenshot. */
window.__deck = (name) => {
  const rec = (plan ? plan.bridges : []).find(b => (b.ref.title || '').includes(name));
  return rec ? Object.assign({ x: rec.x, y: rec.y, z: rec.z }, deckOf(rec)) : null;
};
/* Which structure biomes.js built for a note — the routing act() uses. */
window.__kindOf = (id) => {
  const rec = plan && plan.index ? plan.index.get(id) : null;
  return rec ? rec.kind : null;
};

/* Exact name first, then substring — the same rule __landmarkAt() follows, so a
   name that works in one probe works in the other. */
function landmarkQuarter(name) {
  const want = String(name || '').toLowerCase();
  let sub = null;
  for (const q of quarters.values()) {
    if (!q.formKey) continue;
    const n = q.town.name.toLowerCase();
    if (n === want) return q;
    if (!sub && n.includes(want)) sub = q;
  }
  return sub;
}
window.__dbg = { terrain: () => terrain, sun: () => sunLight, renderer: () => renderer, scene: () => scene, plan: () => plan, cam: () => ({t: camTarget.toArray(), d: cam.dist, p: cam.phi, th: cam.theta}) };

init();

/* =============================================================================
   claude-live — vault.js
   The second city: Beri's Obsidian vault, standing as a town you can walk.

   One note is one building. Its height is the log of its word count, its
   footprint is its `type`, its roof is its topic tag, its tint is its age, and
   the roads between buildings are the wikilinks. Nothing here is decorative:
   there is no filler block, no invented street and no number on screen that was
   not counted out of data/vault.json.

   It shares the session city's world — the append-only packer, the dusk sky, the
   district slabs, the caption textures and the framing solve all come from
   city.js and are not copied here. What is NOT shared is the part the data
   decides: a file has an extension, a note has words, tags and links, so the
   facade program, the road network and the event grammar are this file's own.

   Read city.js first if you want the engine; read this for the mapping.
   ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  createSky, createGround, createPlateMaterial, fitDistance, lightUniforms,
  setPhase, makePlate, addChild, bumpBounds, worldOrigin,
  makeLabel, clipName, hash01, LOT, LOT_GAP, PLATE_PAD, PLATE_GAP,
} from './city.js';


/* =============================================================================
   MAPPING — every rule that turns a note into a building, in one block
   Change a number here and nowhere else. The comments say what the number was
   measured against, because these were all tuned against the real 432 notes.
   ========================================================================== */

/* Obsidian's `type` frontmatter drifted over a year of writing: the same kind of
   note is filed as `devlog` 95 times and `dev-log` 82 times, and `debug` and
   `debugging` are one idea with two spellings. Aliasing is not tidying the data
   — un-aliased, one district would be built out of two building shapes for no
   reason a reader could ever see. */
const TYPE_ALIAS = {
  devlog: 'devlog', 'dev-log': 'devlog', debugging: 'devlog', debug: 'devlog',
  project: 'project', person: 'person', board: 'board', daily: 'daily',
  knowledge: 'knowledge', decision: 'knowledge', idea: 'knowledge',
  note: 'knowledge', task: 'knowledge', architecture: 'knowledge',
};

/* Footprint inside a 1.0 lot, floor height, window columns per face. The lot is
   the session city's lot, unchanged, which is why the two cities read at the
   same scale side by side. */
const SHAPES = {
  /* A project is the widest thing on its street and it is usually the tallest —
     the six largest word counts in the vault are five projects and one board. */
  project:   { w: 0.86, d: 0.56, fh: 0.30, cols: 5 },
  /* A dev log is one day's work: narrow, and there are 178 of them, so a slim
     footprint is what keeps the biggest district from reading as a solid wall. */
  devlog:    { w: 0.52, d: 0.50, fh: 0.30, cols: 3 },
  /* A person is a house, and the porch light is the point: 22 of the 432 notes
     are people, and a warm lamp at the door is what separates a person from a
     small piece of knowledge at a glance. `porch` lights it in the shader. */
  person:    { w: 0.54, d: 0.52, fh: 0.24, cols: 2, porch: 1 },
  knowledge: { w: 0.74, d: 0.70, fh: 0.28, cols: 4 },
  /* The board is one note, 48,934 words, and it is the largest building in the
     vault. A flat hall with a courtyard cut into the roof, so the landmark is
     shaped like a hall and not like a taller tower. */
  board:     { w: 0.94, d: 0.88, fh: 0.24, cols: 6 },
  /* Templates are the depot at the edge of town: same shape, no colour. */
  template:  { w: 0.62, d: 0.58, fh: 0.26, cols: 3 },
  daily:     { w: 0.74, d: 0.62, fh: 0.20, cols: 4 },
};
const SHAPE_KEYS = Object.keys(SHAPES);

/* Height. Words run from 37 to 48,934 in this vault — on a linear scale the
   Engineering board would be a 1,300-storey wall and every other note would be
   a paving slab. On this log scale the measured spread is: 10th percentile 1.7,
   median 2.2, 90th 2.9, and the two outliers 4.9 and 4.7 — so the board and the
   log are twice the town and everything else is a street. The first pass had
   H_SCALE at 0.95 and the capture showed why that was wrong: correct heights,
   and a town made of pins. */
const H_BASE = 0.30, H_SCALE = 0.62, H_PIVOT = Math.log(31);   // log1p(30)
const heightOf = words => Math.max(0.5, H_BASE + H_SCALE * (Math.log1p(words) - H_PIVOT));

/* Roof colour by topic. Eight hues off the studio gold and the earth end of the
   palette — no purple, no blue-violet, nothing that would read as a chart key.
   The tags are the eight most-used TOPICAL tags in the real vault; the tags that
   merely repeat the note's own type (`devlog`, `knowledge`, `project`, `daily`,
   `person`) are deliberately not here, because a roof that repeats the footprint
   tells a reader nothing they cannot already see. Index 8 is "no topic": the
   roof stays the facade's own dark tar. */
const TAG_HUES = [
  ['wdm',         0xd2a62c],   // studio gold — 130 notes, the biggest single topic
  ['wildmoments', 0x8a9a45],   // olive
  ['web3d',       0x6fa8b8],   // the palette's cool
  ['legal',       0x9c6b3f],   // leather
  ['outreach',    0xc2703a],   // terracotta
  ['demo',        0xb8934f],   // brass
  ['video',       0x6f8268],   // sage
  ['web',         0xa8562f],   // rust
];
const TAG_INDEX = new Map(TAG_HUES.map(([t], i) => [t, i]));
const ROOF_PLAIN = 8;

/* A hub earns a plaza. 30 inlinks is where the real distribution breaks: 14
   notes are at or above it and the next one down sits at 25, so this is a gap in
   the data rather than a round number someone liked. */
const HUB_INLINKS = 30;

/* The intro. The city builds itself in the order the notes were written, with
   the vault's 46 real days of history compressed into this many seconds — so a
   day Beri wrote nine notes arrives as nine buildings at once, and a quiet week
   is a pause. Linear index would have flattened exactly that. */
const INTRO_SECONDS = 25;
const RISE_SECONDS = 0.8;
const WARM_SECONDS = 6;          // how long a fresh building glows before it cools

/* Traffic. Dots per road is ceil(links on that road / 20) — with weights of 1
   and 2 that is one dot per road, so the real limiter is the cap, and the cap is
   spent on the busiest roads first (the sum of the two endpoints' inlinks). It
   is a budget, not a decoration: no road that carries no link ever gets a dot.
   280 and not the brief's 400: the cap is what the frame budget could pay for
   at 1440x900 with the whole vault standing, and the roads are what the picture
   is actually about. */
const TRAFFIC_CAP = 280;

const MAX_PARTICLES = 700;
const LIVE_SLACK = 64;           // spare building slots for notes written tonight


/* =============================================================================
   STATE
   ========================================================================== */
let renderer, scene, camera, composer;
let ok = false, W = 0, H = 0;
let buildings, bShadow, plates, roads, traffic, dust, hoverLabel;
let bAttr = {}, sky, ground, plazaGroup, labelGroup, drone;
let vault = null;                          // the parsed data/vault.json
const notes = new Map();                   // note id -> building record
const byIndex = [];                        // instance index -> building record
let bCount = 0, plateCount = 0;
let cityRoot = null;
const allPlates = [];
let now = 0;
let liveOn = false;
let focusId = null;                        // ?focus=<note id>: stand over one building

const dummy = new THREE.Object3D();
const light = lightUniforms();

/* Camera. Same numbers as the session city: 24 degrees up, one turn every 90 s,
   35 mm, the city filling 85% of the frame with 8% of sky held above it. */
const cam = {
  theta: -0.85, phi: 0.42, dist: 70, distWant: 70, zoom: 1,
  target: new THREE.Vector3(), targetWant: new THREE.Vector3(),
  autoPauseUntil: 0, fixed: false,
};
const ORBIT_RATE = (Math.PI * 2) / 90;
/* How far back ?focus= stands, and how high. 24 units at 31 degrees puts the
   hub's plaza ring, the roads arriving at it, two streets of neighbours AND a
   band of sky in a 1440-wide frame; at 17 and 35 the frame was wall-to-wall
   rooftops and the shot had no horizon to sit against. */
const FOCUS_DIST = 24, FOCUS_PHI = 0.55;
const view = { theta: 0, phi: 0, fov: 35, aspect: 1, lift: 0.038, fill: 0.90, head: 0.06 };


/* =============================================================================
   BOOT
   ========================================================================== */
async function boot() {
  const canvas = document.getElementById('stage');
  if (!initGL(canvas)) { fault('This browser could not open a WebGL context.'); return; }

  try {
    const res = await fetch('data/vault.json');
    if (!res.ok) throw new Error(res.status);
    vault = await res.json();
  } catch (_) {
    fault('data/vault.json is not there. Run: python tools/export_vault.py');
    return;
  }

  chrome();
  layout();
  buildRoads();
  buildTraffic();
  buildPlazas();
  fitCamera(true);
  connectLive();

  /* Captions are canvas textures, and a texture is not restyled when a webfont
     arrives later — bake them before JetBrains Mono is in and every district in
     the city is Arial forever. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(labelDistricts);
  else labelDistricts();

  let prev = performance.now();
  requestAnimationFrame(function frame(t) {
    const dt = Math.min(0.05, (t - prev) / 1000);
    prev = t;
    render(dt);
    requestAnimationFrame(frame);
  });
}

function initGL(canvas) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false,
                                         powerPreference: 'high-performance' });
  } catch (_) { return false; }
  if (!renderer.getContext()) return false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.5, 900);

  /* Dusk, and it stays dusk. The session city walks its sky across the session
     clock; a vault has no clock to walk, so this picks the one hour the whole
     palette was designed for and holds it. */
  setPhase(0.06);

  sky = createSky(); scene.add(sky);
  ground = createGround(); scene.add(ground);
  plazaGroup = new THREE.Group(); scene.add(plazaGroup);
  labelGroup = new THREE.Group(); scene.add(labelGroup);
  buildDust();
  buildDrone();

  const q = new URLSearchParams(location.search);
  cam.fixed = q.get('camera') === 'fixed';
  focusId = q.get('focus') || null;
  resize();
  window.addEventListener('resize', resize);
  attachPointer(canvas);
  attachKeys();

  enableBloom();
  ok = true;
  return true;
}

/* Bloom is what turns lit windows into a town at dusk rather than a chart of
   boxes. Half resolution, threshold 0.62 — the same settings the session city
   measured at 60 fps, and the first thing to remove if the gate ever moves. */
function enableBloom() {
  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
  composer.addPass(new RenderPass(scene, camera));
  /* HALF resolution for the bloom's own mip chain, not full. Bloom is a blur —
     it cannot show detail it does not have — and the five down/up passes are
     what the frame is actually spent on here: this city puts far more
     transparent fill in front of the composite than the session city does, and
     at full resolution the standing city measured 45 fps against a 50 gate. */
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W * 0.4, H * 0.4), 0.46, 0.72, 0.62));
  composer.addPass(new OutputPass());
  composer.setSize(W, H);
}

function resize() {
  const c = renderer.domElement;
  W = c.clientWidth; H = c.clientHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / Math.max(1, H);
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(W, H);
}

function fault(msg) {
  const box = document.getElementById('fault');
  const txt = document.getElementById('fault-text');
  if (txt) txt.textContent = msg;
  if (box) box.hidden = false;
}


/* =============================================================================
   CHROME — the two lines of type over the city
   Every number is counted out of the file that was just loaded. Nothing is
   rounded up, estimated or held over from a previous export.
   ========================================================================== */
function chrome() {
  const today = new Date().toISOString().slice(0, 10);
  const writtenToday = vault.notes.filter(n => (n.modified || '').slice(0, 10) === today).length;
  const nf = n => n.toLocaleString('en-US');
  const meta = document.getElementById('vault-counts');
  meta.textContent = `${nf(vault.counts.notes)} notes · ${nf(vault.counts.resolved)} links · `
                   + `${nf(writtenToday)} written today`;
  document.getElementById('vault-title').textContent = vault.root;
  const status = document.getElementById('a11y-status');
  if (status) status.textContent = `${vault.counts.notes} notes standing as a city.`;
}


/* =============================================================================
   LAYOUT — folders become districts, and time becomes a street
   The packer is the session city's, unchanged: a rect's origin corner is fixed
   the moment it is created and a plate only ever grows along +x/+z. It was
   written so a live city never reshuffles while you watch it, and it earns its
   keep here for the same reason — the live feed adds notes to a city that is
   already standing.
   ========================================================================== */
function layout() {
  cityRoot = makePlate('', 'vault', null, 0);

  /* Group by folder. `Daily` is pulled out — it is not a district, it is a
     boulevard (see below) — and the three root-level notes (folder "") become
     the Old Town. */
  const groups = new Map();
  for (const n of vault.notes) {
    const key = n.folder === '' ? '__root' : n.folder;
    if (key === 'Daily') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const rootNotes = groups.get('__root') || [];
  groups.delete('__root');

  /* Biggest district first. The packer scores a corner by how square it keeps
     the parent, and feeding it the large plates first is what turns eleven
     folders into a town block instead of a mile-long ribbon. */
  const order = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  buildBuildingMesh(vault.notes.length + LIVE_SLACK);
  buildPlateMesh(order.length + 3);

  /* The Old Town: the three notes that live at the vault root. It is seated
     through the packer once about half the town's notes are down, so the
     districts that follow are placed AROUND it — the packer only ever appends,
     so the only way to get a plate into the middle of a block is to be holding
     the middle when the block is still being laid. */
  let laid = 0;
  const half = vault.notes.length / 2;
  for (const [folder, list] of order) {
    if (rootNotes.length && laid >= half) { oldTown(rootNotes); rootNotes.length = 0; }
    district(folder, folder, list);
    laid += list.length;
  }
  if (rootNotes.length) oldTown(rootNotes);

  /* And the boulevard, along the near edge, one low block per day in order. */
  boulevard(vault.notes.filter(n => n.folder === 'Daily'));

  bumpBounds(cityRoot);
  syncPlates();
}

/* One folder, one plate, one lot per note. Notes are seated in the order they
   were written, so a district's own streets also run oldest-to-newest. */
function district(key, name, list) {
  const plate = newPlate(key, name);
  const sorted = list.slice().sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  for (const n of sorted) {
    const lot = { x: 0, z: 0, w: LOT, h: LOT, isPlate: false };
    if (!addChild(plate, lot, LOT_GAP)) continue;   // cityRoot always has room; a district can only fail if it is full
    spawn(n, plate, lot);
  }
  return plate;
}

function oldTown(list) {
  district('__oldtown', 'Old Town', list);
}

/* The boulevard. 45 daily notes in date order along the near edge of the town,
   one block per day, so the street IS the calendar: walk it left to right and
   you are walking July into September. Its spacing is solved from the town's own
   width rather than fixed, because a fixed spacing makes a street half again as
   long as the city it belongs to, and that reads as a mistake. */
function boulevard(list) {
  if (!list.length) return;
  const sorted = list.slice().sort((a, b) => (a.created || '').localeCompare(b.created || ''));
  const step = Math.max(0.5, Math.min(LOT + LOT_GAP, cityRoot.w / sorted.length));
  const plate = makePlate('Daily', 'Daily', null, 1);
  plate.kids = sorted.map((n, i) => ({
    x: i * step, z: 0, w: step * 0.86, h: LOT, isPlate: false, parent: plate,
  }));
  plate.w = sorted.length * step - (step - step * 0.86) + PLATE_PAD * 2;
  plate.h = LOT + PLATE_PAD * 2;
  /* The NEAR edge, centred on the town it belongs to: at the back it is a ridge
     behind the skyline, at the front it is a street you can read along. */
  plate.x = (cityRoot.w - plate.w) / 2;
  plate.z = -(plate.h + PLATE_GAP * 3);
  plate.parent = cityRoot;
  cityRoot.kids.push(plate);
  registerPlate(plate);
  sorted.forEach((n, i) => spawn(n, plate, plate.kids[i]));
}

function newPlate(key, name) {
  const p = makePlate(key, name, null, 1);
  p.w = PLATE_PAD * 2; p.h = PLATE_PAD * 2;
  if (!addChild(cityRoot, p, PLATE_GAP)) {
    /* The root has no siblings, so a corner past the last block is always free.
       This is the same escape hatch the session city uses. */
    p.x = cityRoot.w + PLATE_GAP; p.z = 0; p.parent = cityRoot;
    cityRoot.kids.push(p); bumpBounds(cityRoot);
  }
  registerPlate(p);
  return p;
}

function registerPlate(p) {
  p.meshIndex = plateCount++;
  plates.count = plateCount;
  allPlates.push(p);
}

/* Plate slabs and their captions are written once — nothing in this city moves
   a district after it is placed. */
function syncPlates() {
  for (const p of allPlates) {
    const [x, z] = worldOrigin(p);
    dummy.position.set(x + p.w / 2, 0, z + p.h / 2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(p.w, 0.14, p.h);
    dummy.updateMatrix();
    plates.setMatrixAt(p.meshIndex, dummy.matrix);
    plates.geometry.attributes.aSize.array[p.meshIndex * 2] = p.w;
    plates.geometry.attributes.aSize.array[p.meshIndex * 2 + 1] = p.h;
    plates.geometry.attributes.aTone.array[p.meshIndex] = 0.5;
  }
  plates.instanceMatrix.needsUpdate = true;
  plates.geometry.attributes.aSize.needsUpdate = true;
  plates.geometry.attributes.aTone.needsUpdate = true;
}

function labelDistricts() {
  for (const s of labelGroup.children.slice()) { labelGroup.remove(s); disposeSprite(s); }
  const placed = [];
  const order = allPlates.slice().sort((a, b) => b.kids.length - a.kids.length);
  for (const p of order) {
    const [x, z] = worldOrigin(p);
    const cx = x + p.w / 2, cz = z + p.h + 0.4;
    /* A caption is roughly 2.6 units wide and sits half a unit off its plate,
       so two captions closer than this in world space overlap on screen at every
       orbit angle. The bigger district keeps its name. */
    if (placed.some(q => Math.abs(q.x - cx) < 2.6 && Math.abs(q.z - cz) < 0.9)) continue;
    placed.push({ x: cx, z: cz });
    const spr = makeLabel(clipName(p.name, 16), 'rgba(226,220,206,.95)', 34);
    spr.material.opacity = 0.62;
    spr.position.set(cx, 0.42, cz);
    labelGroup.add(spr);
  }
}


/* =============================================================================
   BUILDINGS — one InstancedMesh, one facade program
   The window grid, the lit pattern, the roof colour, the age tint and the edit
   glow are all computed in the fragment shader off eight instanced floats. As
   geometry this would be roughly forty thousand quads; as a shader it is one
   draw call and the frame budget never notices it.
   ========================================================================== */
function buildBuildingMesh(max) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  /* Ten per-building floats, packed into three vec4s and NOT ten attributes.
     WebGL only guarantees 16 vertex attributes and an InstancedMesh already
     spends seven of them (position, normal, uv, and four rows of instanceMatrix)
     — ten more link, then fail validation with "Too many attributes", which is a
     console error and a black city on exactly the drivers that matter. Packed:
       aStatic = floors, window columns, seed, age      (written once)
       aTags   = roof index, ruin, porch, spare         (ruin changes on delete)
       aLive   = rise, warm, lit, spare                 (the ones that animate) */
  const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  bAttr = { aStatic: mk(), aTags: mk(), aLive: mk() };
  for (const k in bAttr) geo.setAttribute(k, bAttr[k]);

  buildings = new THREE.InstancedMesh(geo, facadeMaterial(), max);
  buildings.count = 0;
  buildings.frustumCulled = false;
  scene.add(buildings);

  /* Contact shadows: a soft dark quad per building, sharing the buildings' own
     aRise buffer so a shadow can never be out of step with the block above it.
     A real shadow map is an extra scene pass and buys nothing at this distance. */
  const sgeo = new THREE.PlaneGeometry(1, 1);
  sgeo.rotateX(-Math.PI / 2);
  sgeo.setAttribute('aLive', bAttr.aLive);
  bShadow = new THREE.InstancedMesh(sgeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 aLive; varying vec2 vUv; varying float vRise;
      void main() {
        vUv = uv; vRise = aLive.x;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; varying vec2 vUv; varying float vRise;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        gl_FragColor = vec4(0.02, 0.02, 0.05, (1.0 - smoothstep(0.25, 1.0, d)) * 0.32 * clamp(vRise, 0.0, 1.0));
      }`,
  }), max);
  bShadow.count = 0;
  bShadow.frustumCulled = false;
  bShadow.renderOrder = -1;
  scene.add(bShadow);
}

function buildPlateMesh(max) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2));
  geo.setAttribute('aTone', new THREE.InstancedBufferAttribute(new Float32Array(max), 1));
  plates = new THREE.InstancedMesh(geo, createPlateMaterial(), max);
  plates.count = 0;
  plates.frustumCulled = false;
  scene.add(plates);
}

/* The facade program. The session city's shader colours a building by its file
   extension; a note has no extension, so this one is driven by the three things
   a note actually has — how old it is, what it is about, and whether anything
   links to it. The roof palette is baked in as a constant array because an array
   uniform indexed by a varying is the one thing GLSL ES 1.0 will not do
   reliably across drivers. */
function facadeMaterial() {
  const pal = TAG_HUES.map(([, hex]) => {
    const c = new THREE.Color(hex);
    return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  }).join(', ');

  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: light.sunDir }, uSunColor: { value: light.sunColor },
      uAmbient: { value: light.ambient }, uFog: { value: light.fogColor },
      uFogDensity: { value: 0.00010 },
      uWindow: { value: new THREE.Color(0xffc27a) },
      uWarmColor: { value: new THREE.Color(0xff8a3c) },
      /* Age, as two facade materials rather than a hue shift: the vault's oldest
         notes are seven weeks old and its newest are from this morning, and a
         town where you can see which streets were built first is the whole
         reason to draw a vault as a town at all. */
      uStone: { value: new THREE.Color(0x5c4a37) },
      uGlass: { value: new THREE.Color(0x1f5270) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute vec4 aStatic, aTags, aLive;
      varying vec3 vLocal, vNorm;
      varying float vRow, vSeed, vWarm, vLit, vCols, vAge, vRoof, vRuin, vPorch, vWorldY, vDepth;
      void main() {
        /* A building that has not been written yet is not a flat building — it
           is not there. At rise 0 the box collapses to a degenerate slab whose
           TOP face still rasterises, and the intro was carpeting the ground with
           coloured roof tiles waiting to stand up. Send it off-screen instead. */
        if (aLive.x < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 p = position;
        p.y *= aLive.x;                    /* rise */
        vec4 w = instanceMatrix * vec4(p, 1.0);
        vec4 mv = modelViewMatrix * w;
        gl_Position = projectionMatrix * mv;
        vLocal = position;
        vRow = position.y * aStatic.x;    /* window rows are floors, not UV */
        vNorm = normal;
        vSeed = aStatic.z; vCols = aStatic.y; vAge = aStatic.w;
        vRoof = aTags.x; vRuin = aTags.y; vPorch = aTags.z;
        vWarm = aLive.y; vLit = aLive.z;
        vWorldY = w.y; vDepth = -mv.z;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uSun, uSunColor, uAmbient, uFog, uWindow, uWarmColor, uStone, uGlass;
      uniform float uFogDensity, uTime;
      varying vec3 vLocal, vNorm;
      varying float vRow, vSeed, vWarm, vLit, vCols, vAge, vRoof, vRuin, vPorch, vWorldY, vDepth;

      const vec3 ROOFS[8] = vec3[8](${pal});

      float hash(vec2 c) {
        return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        /* Old notes are stone, new ones are glass, and everything between is
           between — a continuous mix off the creation date, not three buckets. */
        vec3 facade = mix(uStone, uGlass, vAge);
        vec3 n = normalize(vNorm);
        vec3 emis = vec3(0.0);

        if (abs(n.y) < 0.5) {
          float u = (abs(n.x) > 0.5) ? vLocal.z : vLocal.x;
          float cu = (u + 0.5) * vCols;
          vec2 cell = vec2(floor(cu), floor(vRow));
          vec2 f = vec2(fract(cu), fract(vRow));
          float pane = smoothstep(0.20, 0.28, f.x) * smoothstep(0.80, 0.72, f.x)
                     * smoothstep(0.24, 0.32, f.y) * smoothstep(0.78, 0.70, f.y);
          float h = hash(cell + vec2(vSeed * 91.7, vSeed * 13.1));
          /* vLit is how connected the note is: a note nothing links to has dark
             windows, a hub is lit right up. The ground floor is always on, which
             is what keeps a one-floor note reading as a building and not a brick. */
          float p = 0.13 + vLit * 0.40 + (vRow < 1.0 ? 0.26 : 0.0);
          emis += uWindow * pane * step(h, p) * (0.72 + vWarm * 1.2);
          facade *= 0.82 + 0.18 * (1.0 - pane);
          /* The porch. A lamp at the door of every person's house, at the foot
             of the facade and centred on it, so the People district reads as
             houses with someone home rather than as small offices. */
          if (vPorch > 0.5) {
            float lamp = smoothstep(0.17, 0.0, vLocal.y) * smoothstep(0.24, 0.0, abs(u));
            emis += vec3(1.0, 0.70, 0.36) * lamp * 1.15;
          }
        } else if (n.y > 0.5) {
          /* The roof is the topic. Index 8 means the note carries no topical tag
             and the roof stays plain tar — most of the town, by design, so the
             roofs that ARE coloured actually mean something from the air. */
          int ri = int(vRoof + 0.5);
          if (ri < 8) {
            vec3 roof = ROOFS[0];
            for (int i = 0; i < 8; i++) if (i == ri) roof = ROOFS[i];
            facade = roof * 0.80;
            /* A little of its own light. The sun sits on the horizon here, so a
               roof gets almost nothing from it, and a topic you cannot see from
               above is a topic that is not on screen. */
            emis += roof * 0.12;
          } else {
            facade *= 0.5;
          }
        }

        float ndl = max(dot(n, normalize(uSun)), 0.0);
        /* Fake AO: the street is darker than the parapet. It is what makes rows
           of buildings read as streets rather than as a bar chart. */
        float ao = mix(0.42, 1.0, smoothstep(0.0, 1.6, vWorldY));
        vec3 c = facade * (uAmbient + uSunColor * ndl * 0.85) * ao;
        c += emis;
        c += uWarmColor * vWarm * 0.34;

        /* A ruin: an orphan note, or one deleted while you watched. No windows,
           no colour, just the shape left standing. */
        c = mix(c, vec3(dot(c, vec3(0.32, 0.34, 0.28))) * 0.55, vRuin);

        float f = 1.0 - exp(-uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(c, uFog, clamp(f, 0.0, 0.9)), 1.0);
      }`,
  });
}

/* One note becomes one building. Everything read here comes off the note record;
   nothing is defaulted to a nicer-looking value when a field is missing. */
function spawn(n, plate, lot) {
  const idx = bCount;
  if (idx >= buildings.instanceMatrix.count) return null;
  const shape = SHAPES[shapeKeyOf(n)];
  const [px, pz] = worldOrigin(plate);
  const h = heightOf(n.words || 0);

  const b = {
    id: n.id, title: n.title || n.id, note: n, idx, shape,
    wx: px + lot.x + lot.w / 2, wz: pz + lot.z + lot.h / 2, wy: h,
    birth: introTime(n), warm: 0, ruin: n.orphan ? 1 : 0,
    /* The footprint never exceeds its own lot. The boulevard's lots are narrower
       than a district's — its spacing is solved from the town's width — so a
       fixed footprint made the daily blocks overlap each other. */
    fw: Math.min(shape.w, lot.w * 0.92), fd: Math.min(shape.d, lot.h * 0.92),
    /* Orphans lean. 13 of them, out at the edges of their own districts,
       unlit — the buildings nothing in the vault points at. */
    tilt: n.orphan ? (hash01(n.id) - 0.5) * 0.14 : 0,
  };
  notes.set(n.id, b);
  byIndex[idx] = b;
  bCount++;
  buildings.count = bCount; bShadow.count = bCount;

  writeInstance(b);
  const o = idx * 4;
  const st = bAttr.aStatic.array, tg = bAttr.aTags.array, lv = bAttr.aLive.array;
  st[o] = Math.max(1, Math.round(h / shape.fh));
  st[o + 1] = shape.cols;
  st[o + 2] = hash01(n.id);
  st[o + 3] = ageOf(n);
  tg[o] = roofOf(n);
  tg[o + 1] = b.ruin;
  tg[o + 2] = shape.porch ? 1 : 0;
  lv[o] = 0;                       // rise: it has not been built yet
  lv[o + 1] = 0;                   // warm
  /* Lit windows are inlinks, saturating: the difference between 0 and 8 inlinks
     has to be visible, and the difference between 100 and 125 must not blow the
     hub out to white. */
  lv[o + 2] = 1 - Math.exp(-(n.inlinks || 0) / 14);
  for (const k in bAttr) bAttr[k].needsUpdate = true;
  return b;
}

function writeInstance(b) {
  dummy.position.set(b.wx, 0.30, b.wz);
  dummy.rotation.set(0, 0, b.tilt);
  dummy.scale.set(b.fw, b.wy, b.fd);
  dummy.updateMatrix();
  buildings.setMatrixAt(b.idx, dummy.matrix);
  buildings.instanceMatrix.needsUpdate = true;

  dummy.position.set(b.wx, 0.305, b.wz);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(b.fw * 1.6, 1, b.fd * 1.6);
  dummy.updateMatrix();
  bShadow.setMatrixAt(b.idx, dummy.matrix);
  bShadow.instanceMatrix.needsUpdate = true;
}

/* Templates are the one place the folder beats the frontmatter: the seven notes
   in `Templates/` carry the type of the note they are a template FOR (one is
   typed `daily`, one `project`, one `person`), so reading `type` there would
   scatter the depot's shapes across the town for no reason a reader could see. */
function shapeKeyOf(n) {
  if (n.folder === 'Templates') return 'template';
  const key = TYPE_ALIAS[n.type] || 'knowledge';
  return SHAPE_KEYS.includes(key) ? key : 'knowledge';
}

/* 0 = the oldest note in the vault, 1 = the newest. Computed against the real
   spread rather than a fixed window, so the tint still means something when the
   vault is a year old. */
let ageMin = null, ageMax = null;
function ageOf(n) {
  if (ageMin === null) {
    const ts = vault.notes.map(x => Date.parse(x.created)).filter(x => !isNaN(x));
    ageMin = Math.min(...ts); ageMax = Math.max(...ts);
  }
  const t = Date.parse(n.created);
  if (isNaN(t) || ageMax === ageMin) return 0.5;
  return Math.max(0, Math.min(1, (t - ageMin) / (ageMax - ageMin)));
}

function roofOf(n) {
  for (const tag of n.tags || []) if (TAG_INDEX.has(tag)) return TAG_INDEX.get(tag);
  return ROOF_PLAIN;
}

/* Where this note lands in the 25-second intro. Real calendar time, compressed:
   the vault's 46 days of history map onto the intro, so nine notes written on
   one day arrive together and a quiet fortnight is a held breath. */
let introMin = null, introMax = null;
function introTime(n) {
  if (introMin === null) {
    const ts = vault.timeline.map(e => Date.parse(e.t)).filter(x => !isNaN(x));
    introMin = Math.min(...ts); introMax = Math.max(...ts);
  }
  const t = Date.parse(n.created);
  if (isNaN(t) || introMax === introMin) return 0;
  const at = INTRO_SECONDS * (t - introMin) / (introMax - introMin);
  /* A pinch of spread inside one day so a nine-note day is a street being laid
     rather than nine boxes appearing on the same frame. */
  return at + hash01(n.id) * 0.5;
}


/* =============================================================================
   ROADS — the link graph, on the ground
   3,518 wikilinks over 432 notes. Drawn as flat quads in ONE merged geometry:
   as separate line meshes this is 2,594 draw calls and the frame budget is gone
   before a single building is drawn. Parallel links are bundled — A links to B
   and B links back to A is one road carrying two, drawn wider and brighter,
   which is exactly the pair of notes that belong together.
   ========================================================================== */
let roadPairs = [];
function buildRoads() {
  const weight = new Map();
  for (const l of vault.links) {
    const a = notes.get(l.from), b = notes.get(l.to);
    if (!a || !b || a === b) continue;
    const key = a.id < b.id ? a.id + ' ' + b.id : b.id + ' ' + a.id;
    const e = weight.get(key);
    if (e) e.n++;
    else weight.set(key, { a: a.id < b.id ? a : b, b: a.id < b.id ? b : a, n: 1 });
  }
  roadPairs = [...weight.values()];
  if (!roadPairs.length) return;

  const N = roadPairs.length;
  const pos = new Float32Array(N * 6 * 3);
  const edge = new Float32Array(N * 6);      // -1..1 across the road, for the soft edge
  const wgt = new Float32Array(N * 6);
  const birth = new Float32Array(N * 6);
  const Y = 0.335;                            // above the plate tops AND the contact shadows

  let v = 0;
  for (const r of roadPairs) {
    const dx = r.b.wx - r.a.wx, dz = r.b.wz - r.a.wz;
    const len = Math.hypot(dx, dz) || 1;
    /* Width by weight, and it is the only width in the road network: a road that
       carries two links is a street, one that carries one is a lane. */
    const hw = (0.065 + 0.045 * r.n) / 2;
    const nx = -dz / len * hw, nz = dx / len * hw;
    /* A road exists only once BOTH its notes do — otherwise the intro draws
       streets to buildings that have not been written yet. */
    const t = Math.max(r.a.birth, r.b.birth);
    r.birth = t;
    const quad = [
      [r.a.wx + nx, r.a.wz + nz, 1], [r.a.wx - nx, r.a.wz - nz, -1], [r.b.wx - nx, r.b.wz - nz, -1],
      [r.a.wx + nx, r.a.wz + nz, 1], [r.b.wx - nx, r.b.wz - nz, -1], [r.b.wx + nx, r.b.wz + nz, 1],
    ];
    for (const [x, z, e] of quad) {
      pos[v * 3] = x; pos[v * 3 + 1] = Y; pos[v * 3 + 2] = z;
      edge[v] = e; wgt[v] = r.n; birth[v] = t;
      v++;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  geo.setAttribute('aWeight', new THREE.BufferAttribute(wgt, 1));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));

  roads = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    /* DoubleSide, and this is the bug that hid the entire link network through
       three passes of tuning: a road quad's winding depends on which way the
       road runs, so a road drawn from west to east faces DOWN and is back-face
       culled while the same road drawn east to west is not. Half the network was
       being thrown away by the rasteriser and the other half was too faint to
       notice it. Roads are flat on the ground; there is no back of one. */
    side: THREE.DoubleSide,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uNow: { value: 0 }, uWarm: { value: new THREE.Color(0xd2a62c) } },
    vertexShader: /* glsl */`
      attribute float aEdge, aWeight, aBirth;
      varying float vEdge, vWeight, vBirth, vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vEdge = aEdge; vWeight = aWeight; vBirth = aBirth; vDepth = -mv.z;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform float uNow; uniform vec3 uWarm;
      varying float vEdge, vWeight, vBirth, vDepth;
      void main() {
        /* Soft along the width, so a road is a lit strip and not a hard bar.
           Additive and faint: nearly three thousand of these overlap, and at any
           strength that reads on its own the town disappears under a web. */
        float across = 1.0 - smoothstep(0.55, 1.0, abs(vEdge));
        float lit = smoothstep(vBirth, vBirth + 0.7, uNow);
        /* These two numbers are small on purpose and they were measured, not
           guessed: 2,594 roads converge on fourteen hubs, and the busiest of
           them carries 125 of them into one plaza. Additively, anything above
           about four hundredths per road turns that plaza into a white hole and
           takes the town with it — the capture at 0.44 was a photograph of a
           sunrise. Faint per road IS the reading: a lane you can barely see, a
           street where two notes point at each other, and a blaze where a
           hundred do. */
        float a = across * lit * (vWeight > 1.5 ? 0.042 : 0.019);
        a *= 1.0 - smoothstep(110.0, 240.0, vDepth);
        gl_FragColor = vec4(uWarm * (0.55 + 0.45 * (vWeight - 1.0)), a);
      }`,
  }));
  roads.frustumCulled = false;
  roads.renderOrder = 1;
  scene.add(roads);
}

/* =============================================================================
   TRAFFIC — light moving along the busiest roads
   Dots per road is ceil(links on that road / 20), which on this vault is one
   each; the total is capped, and the cap is spent on the roads whose endpoints
   carry the most inlinks. Every dot is on a real road, and the whole thing is
   one Points draw with the position solved in the vertex shader — no per-frame
   CPU work at all.
   ========================================================================== */
function buildTraffic() {
  if (!roadPairs.length) return;
  const ranked = roadPairs.slice().sort((p, q) =>
    ((q.a.note.inlinks || 0) + (q.b.note.inlinks || 0)) - ((p.a.note.inlinks || 0) + (p.b.note.inlinks || 0)));

  const A = [], B = [], SP = [], OF = [], BR = [];
  for (const r of ranked) {
    const dots = Math.ceil(r.n / 20);
    for (let i = 0; i < dots && A.length / 3 < TRAFFIC_CAP; i++) {
      A.push(r.a.wx, 0.38, r.a.wz);
      B.push(r.b.wx, 0.38, r.b.wz);
      /* A dot crosses its own road in four to nine seconds — a long road is
         therefore visibly faster, which is what makes the network feel like it
         is carrying something rather than blinking. */
      SP.push(1 / (4 + hash01(r.a.id + r.b.id) * 5));
      OF.push(hash01(r.b.id + r.a.id));
      BR.push(r.birth);
    }
    if (A.length / 3 >= TRAFFIC_CAP) break;
  }
  if (!A.length) return;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A), 3));
  geo.setAttribute('aTo', new THREE.BufferAttribute(new Float32Array(B), 3));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(SP), 1));
  geo.setAttribute('aOffset', new THREE.BufferAttribute(new Float32Array(OF), 1));
  geo.setAttribute('aBirth', new THREE.BufferAttribute(new Float32Array(BR), 1));

  traffic = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uNow: { value: 0 }, uPix: { value: 1 }, uColor: { value: new THREE.Color(0xffd79a) } },
    vertexShader: /* glsl */`
      attribute vec3 aTo; attribute float aSpeed, aOffset, aBirth;
      uniform float uNow, uPix;
      varying float vFade;
      void main() {
        float u = fract(uNow * aSpeed + aOffset);
        vec3 p = mix(position, aTo, u);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPix * 2.6 * (30.0 / max(6.0, -mv.z));
        /* Fades in at each end so a dot arrives and leaves rather than blinking
           out of existence on a doorstep. */
        vFade = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u))
              * smoothstep(aBirth, aBirth + 0.7, uNow)
              * (1.0 - smoothstep(110.0, 230.0, -mv.z));
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; uniform vec3 uColor; varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.2, 1.0, d)) * vFade * 0.85);
      }`,
  }));
  traffic.frustumCulled = false;
  traffic.renderOrder = 2;
  scene.add(traffic);
}

/* =============================================================================
   PLAZAS — a lit ring around every hub
   A note with 30 or more inlinks gets a plaza, and its radius is that inlink
   count. Fourteen of them in this vault, and they are how a stranger reads the
   town: the rings are where the roads converge.
   ========================================================================== */
function buildPlazas() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd2a62c, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const b of notes.values()) {
    const inl = b.note.inlinks || 0;
    if (inl < HUB_INLINKS) continue;
    const r = 0.95 + inl * 0.014;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.14, 44), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.wx, 0.32, b.wz);
    ring.renderOrder = 1;
    plazaGroup.add(ring);
    b.hub = true;
  }
}


/* =============================================================================
   DUST — the puff of a building pushing up through the ground
   One Points system, a hard cap, dead particles swapped with the last live one
   so there is never a gap to skip over. The same object serves the intro and a
   note written tonight, because they are the same event.
   ========================================================================== */
let pPos, pAlpha, pLive = 0;
const pVel = new Float32Array(MAX_PARTICLES * 3);
const pAge = new Float32Array(MAX_PARTICLES);
const pLife = new Float32Array(MAX_PARTICLES);

function buildDust() {
  pPos = new Float32Array(MAX_PARTICLES * 3);
  pAlpha = new Float32Array(MAX_PARTICLES);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1));
  dust = new THREE.Points(geo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(0xbdae94) }, uPix: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aAlpha; varying float vA; uniform float uPix;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPix * 5.0 * (30.0 / max(6.0, -mv.z));
        vA = aAlpha;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.0, 1.0, d)) * vA * 0.5);
      }`,
  }));
  dust.frustumCulled = false;
  scene.add(dust);
}

function puff(b) {
  for (let i = 0; i < 6 && pLive < MAX_PARTICLES; i++) {
    const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 0.9;
    const j = pLive++;
    pPos[j * 3] = b.wx + Math.cos(a) * 0.25;
    pPos[j * 3 + 1] = 0.32;
    pPos[j * 3 + 2] = b.wz + Math.sin(a) * 0.25;
    pVel[j * 3] = Math.cos(a) * s; pVel[j * 3 + 1] = 0.5 + Math.random(); pVel[j * 3 + 2] = Math.sin(a) * s;
    pAge[j] = 0; pLife[j] = 0.8 + Math.random() * 0.5;
  }
}

function stepDust(dt) {
  for (let i = 0; i < pLive; i++) {
    pAge[i] += dt;
    if (pAge[i] >= pLife[i]) {
      const last = --pLive;
      if (i !== last) {
        for (let k = 0; k < 3; k++) { pPos[i * 3 + k] = pPos[last * 3 + k]; pVel[i * 3 + k] = pVel[last * 3 + k]; }
        pAge[i] = pAge[last]; pLife[i] = pLife[last];
      }
      i--; continue;
    }
    for (let k = 0; k < 3; k++) { pPos[i * 3 + k] += pVel[i * 3 + k] * dt; pVel[i * 3 + k] *= 1 - 2.2 * dt; }
    pVel[i * 3 + 1] -= 0.6 * dt;
    pAlpha[i] = 1 - pAge[i] / pLife[i];
  }
  dust.geometry.setDrawRange(0, pLive);
  dust.geometry.attributes.position.needsUpdate = true;
  dust.geometry.attributes.aAlpha.needsUpdate = true;
}


/* =============================================================================
   THE DRONE — one craft, and it is Beri
   The session city launches a drone per agent. A vault has no agents: it has one
   person writing in it. So there is exactly one craft, it idles over the middle
   of the town, and it flies to whichever note was just saved. If nothing is
   being written it is not in the air at all.
   ========================================================================== */
function buildDrone() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0),
    new THREE.MeshBasicMaterial({ color: 0xd2a62c })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.024, 8, 26),
    new THREE.MeshBasicMaterial({ color: 0xd2a62c, transparent: true, opacity: 0.75 }));
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  g.visible = false;
  scene.add(g);
  drone = { group: g, ring, pos: new THREE.Vector3(), to: null, until: 0 };
}

function stepDrone(dt) {
  if (!drone.to || now > drone.until) {
    drone.group.visible = false;
    drone.to = null;
    return;
  }
  drone.group.visible = true;
  const want = drone.to;
  drone.pos.lerp(want, Math.min(1, dt * 1.6));
  drone.group.position.copy(drone.pos);
  drone.ring.rotation.z += dt * 3.4;
}


/* =============================================================================
   CAMERA — the session city's solve, on this city's box
   fitDistance() is imported, not rewritten: the bisection over the real
   projection is the thing that took the framing from 43% of the frame to 85%,
   and there is no reason for the vault city to relearn it.
   ========================================================================== */
const _box = new THREE.Box3(), _c = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

function cityBounds() {
  if (!bCount) return null;
  _box.makeEmpty();
  for (const b of notes.values()) {
    if (b.rise === undefined || b.rise < 0.02) continue;   // not built yet: not in the frame
    _box.expandByPoint(_p.set(b.wx - 0.6, 0, b.wz - 0.6));
    _box.expandByPoint(_p.set(b.wx + 0.6, b.wy + 0.4, b.wz + 0.6));
  }
  return _box.isEmpty() ? null : _box;
}

function fitCamera(snap) {
  /* ?focus= is a FIXED placement, not a solve. Running the bisection over a box
     around one building looked right and drifted: the solve is fed the city's
     live bounds elsewhere in the same frame and the two disagreed as the intro
     filled in, so the same URL captured at 25 s and at 55 s produced two
     different shots. A close-up that is not reproducible is not a close-up, and
     this is a camera you point, not one you solve. */
  const focus = focusId ? notes.get(focusId) : null;
  if (focus) {
    cam.targetWant.set(focus.wx, focus.wy * 0.5 + 0.7, focus.wz);
    cam.distWant = FOCUS_DIST;
    if (snap) { cam.target.copy(cam.targetWant); cam.dist = cam.distWant; }
    return;
  }
  const box = cityBounds();
  if (!box) return;
  box.getCenter(_c);
  box.getSize(_s);
  cam.targetWant.set(_c.x, Math.max(0.9, _s.y * 0.42), _c.z);
  view.theta = cam.theta; view.phi = cam.phi;
  view.fov = camera.fov; view.aspect = camera.aspect;
  cam.distWant = Math.max(16, fitDistance(view, _s.x, _s.y, _s.z, cam.targetWant.y - box.min.y));
  if (snap) { cam.target.copy(cam.targetWant); cam.dist = cam.distWant; }
}

function updateCamera(dt) {
  fitCamera(false);
  const k = Math.min(1, dt * 1.4);
  cam.target.lerp(cam.targetWant, k);
  cam.dist += (cam.distWant * cam.zoom - cam.dist) * k;
  cam.phi += ((focusId ? FOCUS_PHI : 0.42) - cam.phi) * Math.min(1, dt * 0.9);
  if (!cam.fixed && now > cam.autoPauseUntil) cam.theta += ORBIT_RATE * dt;

  const r = cam.dist * Math.cos(cam.phi);
  camera.position.set(cam.target.x + Math.cos(cam.theta) * r,
                      cam.target.y + cam.dist * Math.sin(cam.phi),
                      cam.target.z + Math.sin(cam.theta) * r);
  /* Aim ABOVE the town: at 24 degrees with a 35 mm field, looking straight at
     the centre puts no sky in the frame at all and the city floats in a void. */
  camera.lookAt(cam.target.x, cam.target.y + cam.dist * view.lift, cam.target.z);
}

function attachPointer(canvas) {
  let down = false, lx = 0, ly = 0, moved = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    down = true; moved = 0; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (down) {
      moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
      cam.theta -= (e.clientX - lx) * 0.006;
      cam.phi = Math.max(0.16, Math.min(1.15, cam.phi + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
      cam.autoPauseUntil = now + 20;
    }
    pointer.x = (e.clientX / W) * 2 - 1;
    pointer.y = -(e.clientY / H) * 2 + 1;
    pointer.live = true;
  });
  const up = () => { down = false; };
  canvas.addEventListener('pointerup', e => {
    /* A drag that ended on a building is still a drag, not a click. */
    if (moved < 6) openNote();
    up(e);
  });
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { pointer.live = false; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = Math.max(0.45, Math.min(2.2, cam.zoom * (1 + Math.sign(e.deltaY) * 0.11)));
    cam.autoPauseUntil = now + 20;
  }, { passive: false });
}

function attachKeys() {
  addEventListener('keydown', e => {
    if (e.key === 'h' || e.key === 'H') {
      const help = document.getElementById('vault-help');
      if (help) help.hidden = !help.hidden;
    }
  });
}


/* =============================================================================
   HOVER AND CLICK — the note under the cursor
   Raycast against the one InstancedMesh, which THREE resolves down to an
   instanceId, and that index IS the note. A DOM tooltip would need a projection
   and a reflow every frame; a canvas caption is the same object the district
   names already are.
   ========================================================================== */
const ray = new THREE.Raycaster();
const pointer = { x: 0, y: 0, live: false };
let hovered = null, hoverTick = 0;

function updateHover(dt) {
  hoverTick += dt;
  if (hoverTick < 0.06) return;                 // ~16 casts a second is plenty
  hoverTick = 0;
  if (!pointer.live || !bCount) { setHover(null); return; }
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObject(buildings, false);
  const hit = hits.length ? byIndex[hits[0].instanceId] : null;
  setHover(hit && hit.rise > 0.3 ? hit : null);
}

function setHover(b) {
  if (b === hovered) {
    if (hoverLabel && b) hoverLabel.position.set(b.wx, 0.35 + b.wy * b.rise + 0.55, b.wz);
    return;
  }
  hovered = b;
  document.body.style.cursor = b ? 'pointer' : 'default';
  if (hoverLabel) { scene.remove(hoverLabel); disposeSprite(hoverLabel); hoverLabel = null; }
  if (!b) return;
  hoverLabel = makeLabel(clipName(b.title, 38), 'rgba(240,232,216,.98)', 30);
  hoverLabel.position.set(b.wx, 0.35 + b.wy * b.rise + 0.55, b.wz);
  hoverLabel.renderOrder = 5;
  scene.add(hoverLabel);
}

/* Obsidian's own URL scheme. The vault name comes out of the export, not out of
   a constant here, so a different vault opens in the right window. */
function openNote() {
  if (!hovered) return;
  location.href = `obsidian://open?vault=${encodeURIComponent(vault.root)}`
                + `&file=${encodeURIComponent(hovered.id)}`;
}


/* =============================================================================
   LIVE — the vault as it is being written
   /api/vault is server.py's SSE feed over the real folder, polled every two
   seconds. If the server is not running this fails quietly and the city just
   stands: a page that shouts about a missing endpoint is a page that is broken
   for the ninety per cent of visits that are only looking at it.
   ========================================================================== */
async function connectLive() {
  try {
    const probe = await fetch('/api/sessions', { cache: 'no-store' });
    if (!probe.ok) return;
  } catch (_) { return; }        // no server.py behind this page: stay static, stay quiet
  try {
    const es = new EventSource('/api/vault');
    es.onopen = () => { liveOn = true; markLive(); };
    es.onmessage = m => {
      try { onVaultEvent(JSON.parse(m.data)); }
      catch (_) { /* a malformed frame must not kill the stream */ }
    };
    es.onerror = () => { /* EventSource reconnects on its own; stay quiet */ };
  } catch (_) { /* no live feed: the static city is the whole product */ }
}

function markLive() {
  const dot = document.getElementById('vault-live');
  if (dot) dot.hidden = false;
}

function onVaultEvent(ev) {
  const id = String(ev.path || '').replace(/\.md$/i, '');
  const b = notes.get(id);
  console.log('[vault]', ev.kind, id);

  if (ev.kind === 'note_created' && !b) { createLive(id, ev.words || 0); return; }
  if (!b) return;

  if (ev.kind === 'note_modified') {
    /* The facade lights warm and cools over six seconds, and the craft flies
       there — the same grammar as an edit in the session city. */
    b.warm = 1;
    drone.to = new THREE.Vector3(b.wx, b.wy + 1.6, b.wz);
    if (!drone.group.visible) drone.pos.set(cam.target.x, 6, cam.target.z);
    drone.until = now + 9;
  } else if (ev.kind === 'note_deleted') {
    b.ruin = 1;
    b.tilt = (hash01(b.id) - 0.5) * 0.14;
    bAttr.aTags.array[b.idx * 4 + 1] = 1;      // ruin
    bAttr.aLive.array[b.idx * 4 + 2] = 0;      // the windows go out
    bAttr.aTags.needsUpdate = bAttr.aLive.needsUpdate = true;
    writeInstance(b);
  }
}

/* A note written tonight gets a lot in its own district, the same way the
   session city seats a file it has never seen. No link data exists for it yet,
   so it stands unlinked until the next export — which is the truth. */
function createLive(id, words) {
  const parts = id.split('/');
  const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  let plate = allPlates.find(p => p.key === folder) || allPlates.find(p => p.key === '__oldtown');
  if (!plate) return;
  const lot = { x: 0, z: 0, w: LOT, h: LOT, isPlate: false };
  /* An annex, the same idea as the session city's. Every district here was
     packed to fit exactly the notes that existed at export time, so the FIRST
     note written after that is refused by its own district — measured: the live
     test wrote a root-level note and the building count did not move, because
     the Old Town had three lots and room for three. A district that cannot grow
     without shoving its neighbours continues across the street instead, under
     the same name, and the root always has a free corner. */
  if (!addChild(plate, lot, LOT_GAP)) {
    plate = plate.annex || (plate.annex = newPlate(plate.key + '#annex', plate.name));
    if (!addChild(plate, lot, LOT_GAP)) return;
  }
  const n = {
    id, title: parts[parts.length - 1], folder, words,
    created: new Date().toISOString(), modified: new Date().toISOString(),
    tags: [], type: 'knowledge', inlinks: 0, orphan: false,
  };
  const b = spawn(n, plate, lot);
  if (!b) return;
  b.birth = now;                     // rises immediately, not at its intro slot
  b.warm = 1;
  syncPlates();
  puff(b);
  drone.to = new THREE.Vector3(b.wx, b.wy + 1.6, b.wz);
  if (!drone.group.visible) drone.pos.set(cam.target.x, 6, cam.target.z);
  drone.until = now + 9;
}


/* =============================================================================
   FRAME
   ========================================================================== */
const easeOutBack = t => { const c = 1.9, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

function render(dt) {
  if (!ok) return;
  now += dt;

  stepBuildings(dt);
  stepDust(dt);
  stepDrone(dt);
  updateHover(dt);
  updateCamera(dt);

  const pix = renderer.getPixelRatio();
  if (roads) roads.material.uniforms.uNow.value = now;
  if (traffic) { traffic.material.uniforms.uNow.value = now; traffic.material.uniforms.uPix.value = pix; }
  dust.material.uniforms.uPix.value = pix;
  buildings.material.uniforms.uTime.value = now;
  ground.material.uniforms.uCenter.value.copy(cam.target);

  const su = sky.material.uniforms;
  su.uTime.value = now;
  su.uCamUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
  su.uCamFwd.value.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  su.uTanV.value = Math.tan(camera.fov * Math.PI / 360);
  /* The haze over the town is the town's own light: how much of the vault is
     standing, saturating, so the first fifty buildings visibly light the sky and
     the four-hundredth cannot blow it out. */
  su.uGlow.value = 1 - Math.exp(-visible / 120);
  sky.position.copy(camera.position);

  fps(dt);
  composer.render();
}

/* Rise, then cool. Once the intro is over and nothing is warm this loop stops
   writing to the GPU entirely — a standing city costs one draw per mesh and no
   buffer uploads at all. */
let visible = 0;
function stepBuildings(dt) {
  let dirty = false, lit = 0;
  for (const b of notes.values()) {
    const want = now >= b.birth ? 1 : 0;
    if (b.rise === undefined) b.rise = 0;
    if (want && (b.riseT === undefined || b.riseT < RISE_SECONDS)) {
      if (b.riseT === undefined) { b.riseT = 0; puff(b); b.warm = 0.4; }
      b.riseT = Math.min(RISE_SECONDS, b.riseT + dt);
      b.rise = easeOutBack(b.riseT / RISE_SECONDS);
      bAttr.aLive.array[b.idx * 4] = b.rise;
      dirty = true;
    }
    if (b.warm > 0) {
      b.warm = Math.max(0, b.warm - dt / WARM_SECONDS);
      bAttr.aLive.array[b.idx * 4 + 1] = b.warm;
      dirty = true;
    }
    if (b.rise > 0.02) lit++;
  }
  visible = lit;
  if (dirty) bAttr.aLive.needsUpdate = true;
}

function disposeSprite(s) {
  if (!s) return;
  if (s.material.map) s.material.map.dispose();
  s.material.dispose();
}


/* =============================================================================
   MEASUREMENT — the numbers docs/RUNBOOK.md quotes
   Read-only, called by hand from the console or the capture harness.
   ========================================================================== */
const frames = [];
function fps(dt) {
  frames.push(dt);
  if (frames.length > 90) frames.shift();
}
window.__fps = () => {
  if (!frames.length) return 0;
  return +(frames.length / frames.reduce((a, b) => a + b, 0)).toFixed(1);
};
window.__nodes = () => visible;
window.__roads = () => roadPairs.length;
window.__live = () => liveOn;
/* Did ?focus= actually name a note? A typo silently falls back to the wide shot,
   which looks like the camera is broken rather than like a bad id. */
window.__focused = () => (focusId && notes.has(focusId)) ? focusId : null;
/* Where the town lands in the frame, in per cent of it — the same instrument
   the session city is framed with, so the two are judged on one number. */
window.__frame = () => {
  const box = cityBounds();
  if (!box) return null;
  let x0 = 9, x1 = -9, y1 = -9;
  for (let i = 0; i < 8; i++) {
    _p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y,
           i & 4 ? box.max.z : box.min.z).project(camera);
    if (_p.x < x0) x0 = _p.x;
    if (_p.x > x1) x1 = _p.x;
    if (_p.y > y1) y1 = _p.y;
  }
  return { width: +((x1 - x0) * 50).toFixed(1), top: +((1 - y1) * 50).toFixed(1) };
};

boot();

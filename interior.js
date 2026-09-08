/* =============================================================================
   werkstadt — interior.js
   The inside of the city. Click a building and you walk into it.

   The owner's sentence this file exists for: "if I want to enter a building I
   can really see what happens there — real 3D buildings I can walk into."

   One generic room template, dressed three ways by real data and nothing else:

     a FILE building   floors are the Edit/Write events the file received, and
                       the walls carry the file's own bytes, 24 lines a wall,
                       three walls a floor, floor 1 at the top of the file.
     a PLATE lobby     a directory's files as doors, mono-labelled; walk into
                       one and you are in that file's building.
     a STREET hall     the session's title on the wall, its prompts as plaques
                       in the order they were typed, and the agents that worked
                       there parked along the aisle wearing their task tags.

   The rule city.js obeys is the rule here: nothing is invented. Every plaque,
   every glow and every drone in these rooms traces to an event that arrived
   through replay.js or to a byte the server handed over. The one exception is
   labelled as one — the FIXTURE plaque, which appears only when the file
   endpoint is not there to answer, and says so on the wall.

   Why a second scene rather than rooms inside the city's: the city is one
   InstancedMesh of 720 boxes with a facade shader that computes windows in the
   fragment stage. A room is the opposite shape of problem — a handful of large
   surfaces carrying big textures — and putting both in one scene would mean the
   city's 720 instances paying frustum and uniform costs for a view that cannot
   see any of them. The renderer, the composer and the dusk sky are shared; the
   scene graph is not.
   ========================================================================== */

import * as THREE from 'three';
/* The one addon this module needs. A CSS3D layer is not a second WebGL
   renderer: it is a DOM element carried by a matrix3d transform, which is the
   only way a browser will lay a live page out on a surface in this scene. */
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
/* The hall is a few hundred static boxes at a handful of sizes. Merged into one
   buffer per material they are five draw calls; as separate meshes they are
   three hundred. See THE HALL below for why not an InstancedMesh. */
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


/* =============================================================================
   CONSTANTS — the whole shape of a room, in one block
   ========================================================================== */
const ROOM_W = 11.0;      // wall to wall, across
const ROOM_D = 8.6;       // door wall to text wall
const ROOM_H = 3.9;       // floor to ceiling
const SLAB   = 0.55;      // the thickness between one floor and the next
const STEP   = ROOM_H + SLAB;
const WELL   = 2.3;       // the square opening the lift column rises through
const DOOR_W = 2.2, DOOR_H = 2.6;

/* A page of the file, per wall. 22 rows is not a taste call, it is the measured
   answer to the legibility gate. The floor is 14 px of glyph on a 900-px frame,
   and the wall that decides it is not the one you are facing but the SIDE wall
   about 5.6 units away, still in shot and still carrying source. 34 rows
   measured 11 px there and 24 rows measured 13.4; 22 rows on a panel 88% of the
   room's height measures 15.0 on the side wall and 29 on the wall being read.
   Fewer rows a wall is 66 lines a floor rather than 72 — the trade the gate
   costs, and the right way round. */
const PAGE_ROWS = 22;
const PAGE_COLS = 96;
/* The panel is sized from the TEXT, not from the wall. 24 rows of 96 monospace
   columns want an aspect of about 2.4; stretched across the full 10-unit wall
   (aspect 3.2) every glyph came out a third wider than tall and the canvas was
   half empty. So the panel is 2.4:1, centred on the wall, and the wall keeps a
   margin either side — which is also what makes it read as a printed page
   rather than as wallpaper. */
const PANEL_ASPECT = 2.4;
const PANEL_H = ROOM_H * 0.88;
const PANEL_W = PANEL_H * PANEL_ASPECT;
const GLYPH_FRAC = 0.72;          // glyph height as a share of the row box
const WALLS_PER_FLOOR = 3;                    // back, left, right
const FLOOR_LINES = PAGE_ROWS * WALLS_PER_FLOOR;

const MAX_FLOORS = 40;                        // city.js's FLOOR_CAP; a room per floor
/* Only the floor you are on and its two neighbours carry live text. Forty
   floors of 2048-px canvases is 300 MB of texture and the reason the frame-rate
   gate would fail; three is what you can actually see through the well. */
const LIVE_FLOORS = 1;                        // radius, so 3 floors live at once
const PANEL_CACHE = 18;                       // textures kept before the oldest goes

const FLY_SECONDS = 1.15;                     // city camera -> the door
const MOVE_SPEED = 5.4;                       // world units a second, gliding
const LOOK_SENS = 0.0024;

/* Recency, in SESSION time — the same clock and the same half hour city.js
   fades a building to grey on, so "warm" means the same thing inside and out. */
const RECENT_MS = 30 * 60 * 1000;

/* styles.css's tokens, and only the three a room actually paints with: bone
   for source, dim for line numbers and gutters, gold for the lift and the
   plaque rules. The warm and the red in here are the city's own ember and
   laser, written where they are used so the reason is next to the value. */
const C_BONE = '#e9e1d2';
const C_DIM  = '#8d857a';
const C_GOLD = 0xd2a62c;
const C_GOLD_CSS = '#d2a62c';     // the same gold, for the 2D canvas contexts

const MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace';
const SERIF = '"Instrument Serif", Georgia, serif';


/* =============================================================================
   STATE — one interior at a time, because a person is only ever in one room
   ========================================================================== */
let host = null;            // the callbacks city.js hands over — see attach()
let src = { projectId: null, events: [], agents: [], solo: null };

let scene = null, camera = null, sky = null;
let shell = null;           // { walls, slabs, front, lift, group } — the template
let dress = null;           // whatever the current mode hung inside it
let mode = null;            // 'file' | 'plate' | 'street' | 'hall'
let subject = null;         // the building / plate / street record we are inside

/* 'out' | 'in' (flying in) | 'inside' | 'leaving'. The city is still the picture
   during 'in' and 'leaving' — that is the fly-in shot. */
let phase = 'out';
let flyT = 0, flyFrom = null, flyTo = null;

const player = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, floor: 0 };
const keys = new Set();
let dragLook = false;       // pointer lock refused (the CDP harness): drag instead
let dragging = false, lastX = 0, lastY = 0;
let pointerLockTried = false;

let W = 1, H = 1;
let hud = null;             // the one line of DOM chrome — see setHud()


/* =============================================================================
   ATTACH — the seam with city.js
   city.js owns the renderer, the composer, the camera and every record about
   the city. This module owns nothing of the city and asks for what it needs, so
   there is no import back the other way and no cycle.
   ========================================================================== */
export function attach(h) {
  host = h;
  scene = new THREE.Scene();
  /* 62 degrees, not the city's 35: a room is read from inside it, and a long
     lens indoors turns a wall three metres away into a texture swatch. */
  camera = new THREE.PerspectiveCamera(62, 1, 0.08, 400);
  /* The same dome the city stands under, so the light through the window is the
     session's own hour and not a second sun invented for the interior. */
  sky = host.createSky();
  scene.add(sky);
  /* THE STACKED ROOM is the city's shell, and world.html never enters one — it
     only ever opens a HALL. Building it there anyway would put its four lights
     in the hall's scene, lighting it from the wrong places and adding four
     lights to every material compile in the building. `hallOnly` is world.js
     saying which half of this module it attached for; city.js passes nothing
     and gets exactly what it had. */
  if (!h.hallOnly) buildShell();
  /* The DOM layer the ground-floor page window lives on. It has to be a
     sibling of the canvas rather than a child of it — a canvas has no DOM
     children — so it is created here and styled in styles.css (#interior-css3d),
     under the chrome and over the field. */
  css = new CSS3DRenderer();
  css.domElement.id = 'interior-css3d';
  document.body.appendChild(css.domElement);
  attachInput();
}

/* replay.js is the only place that knows which town this page is showing and
   what the session's events were, so it hands both over once at boot. */
export function setSource(s) {
  src = Object.assign({ projectId: null, events: [], agents: [], solo: null }, s || {});
}

export const inside = () => phase === 'inside';
/* True from the first frame of the fly-in to the last of the fly-out: city.js
   uses it to know the lens is not its own. */
export const busy = () => phase !== 'out';
export const getScene = () => scene;
export const getCamera = () => camera;
/* city.js writes the four camera-dependent sky uniforms for whichever scene it
   is about to draw, so the dusk indoors is the same hour as the dusk outside. */
export const getSky = () => sky;

export function resize(w, h) {
  W = w; H = h;
  if (css) css.setSize(w, h);
  if (!camera) return;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}


/* =============================================================================
   SHELL — the room template, built once and re-dressed
   Three instanced meshes carry forty floors: the side walls, the slabs between
   them and the window wall. That is three draw calls for the whole building,
   which is what keeps a forty-floor tower inside the frame-rate gate.
   ========================================================================== */
const dummy = new THREE.Object3D();

/* A box with its top and bottom faces removed, drawn from the inside. Removing
   the faces rather than hiding them means the slab below is what you stand on
   and the well through it is not fighting a second surface for the same pixels.
   BoxGeometry's index runs px, nx, py, ny, pz, nz — six per face, two triangles
   — so keeping 0, 1 and 4 keeps +x, -x and +z, and drops the floor, the ceiling
   and the front wall the door and the window live in. */
function threeWalls(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = g.getIndex().array;
  const keep = [];
  for (const face of [0, 1, 4]) for (let i = 0; i < 6; i++) keep.push(idx[face * 6 + i]);
  g.setIndex(keep);
  return g;
}

/* A flat rectangle with a square hole in the middle of it: the slab between two
   floors, and the well you glide up through. ShapeGeometry, so it is one piece
   of geometry with a genuine hole rather than four strips that show their
   seams under a grazing light. */
function slabWithWell(w, d, well) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2);
  s.lineTo(w / 2, d / 2);   s.lineTo(-w / 2, d / 2); s.closePath();
  const hole = new THREE.Path();
  const k = well / 2, cx = w / 2 - well * 0.9;   // the well sits off to one side
  hole.moveTo(cx - k, -k); hole.lineTo(cx + k, -k);
  hole.lineTo(cx + k, k);  hole.lineTo(cx - k, k); hole.closePath();
  s.holes.push(hole);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

/* The front wall: a frame around one wide opening. That opening is the window —
   the dusk sky and the city's own light come through it — and on the ground
   floor a door-sized notch is cut out of its sill as well. Same Shape trick. */
function frontWall(w, h, openW, openH) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  const hole = new THREE.Path();
  const y0 = h * 0.34, y1 = y0 + openH;
  hole.moveTo(-openW / 2, y0); hole.lineTo(openW / 2, y0);
  hole.lineTo(openW / 2, y1);  hole.lineTo(-openW / 2, y1); hole.closePath();
  s.holes.push(hole);
  return new THREE.ShapeGeometry(s);
}

const WALL_MAT = () => new THREE.MeshStandardMaterial({
  color: 0x3d362c, roughness: 0.94, metalness: 0.0, side: THREE.DoubleSide,
});

function buildShell() {
  const group = new THREE.Group();

  const walls = new THREE.InstancedMesh(threeWalls(ROOM_W, ROOM_H, ROOM_D), WALL_MAT(), MAX_FLOORS);
  const slabs = new THREE.InstancedMesh(slabWithWell(ROOM_W, ROOM_D, WELL),
                                        new THREE.MeshStandardMaterial({ color: 0x272119, roughness: 1, side: THREE.DoubleSide }),
                                        MAX_FLOORS + 1);
  const front = new THREE.InstancedMesh(frontWall(ROOM_W, ROOM_H, ROOM_W * 0.72, ROOM_H * 0.42),
                                        WALL_MAT(), MAX_FLOORS);
  for (const m of [walls, slabs, front]) { m.frustumCulled = false; m.count = 0; group.add(m); }

  /* The lift: a gold light column standing in the well, all the way up. Additive
     and unlit, so it reads as light rather than as a painted pole, and the
     bloom pass the city already runs makes the halo for free. */
  const lift = new THREE.Mesh(
    new THREE.CylinderGeometry(WELL * 0.22, WELL * 0.22, 1, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: C_GOLD, transparent: true, opacity: 0.16,
                                  blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
                                  depthWrite: false }));
  /* A bright core inside the sleeve: two radii give the column an edge, which
     is what makes it read as a column of light rather than a lighter patch of
     wall. The numbers are small because the bloom pass multiplies them — at
     0.34 and 0.85 the lift came back as a white blur across a third of the
     frame, brighter than the source it was standing next to. */
  const liftCore = new THREE.Mesh(
    new THREE.CylinderGeometry(WELL * 0.055, WELL * 0.055, 1, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.42,
                                  blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
                                  depthWrite: false }));
  group.add(lift, liftCore);

  /* Two warm lamps, moved to the floor the player is on. Two point lights is the
     whole lighting budget indoors — a light per floor would be forty, and forty
     lights is a recompile of every material on this machine.
     The intensities look enormous because three's lights have been in physical
     units since r155: with decay 2 the figure is candela and it is divided by
     the distance squared, so a lamp three metres away at 26 lit nothing at all
     and the first capture came back as black walls with type floating on them. */
  const lampA = new THREE.PointLight(0xffc27a, 190, 20, 2);
  const lampB = new THREE.PointLight(0xffa860, 110, 18, 2);
  group.add(lampA, lampB);
  /* And a cool fill from the window side, so the room is not lit from one hue
     only — this is the dusk coming in, and it is why the door wall reads. */
  const fill = new THREE.PointLight(0x8fb6d8, 90, 24, 2);
  group.add(fill);
  /* A floor of light so nothing in the room is ever pure black. Warm from
     above, near-black from below: the same two-stop reading the city's own
     ambient uses, and cheaper than any third lamp. */
  group.add(new THREE.HemisphereLight(0x6d5c46, 0x14110e, 1.1));

  scene.add(group);
  /* The lamps are visible objects, not just lights: a warm disc under the
     ceiling, so the light in the room has somewhere to come from. */
  const bulbGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const bulbA = new THREE.Mesh(bulbGeo, bulbMat), bulbB = new THREE.Mesh(bulbGeo, bulbMat);
  group.add(bulbA, bulbB);
  shell = { group, walls, slabs, front, lift, liftCore, lampA, lampB, fill, bulbA, bulbB };
}

/* Stack n rooms and put the lift through all of them. Called once per entry. */
function raiseShell(n) {
  const floors = Math.max(1, Math.min(MAX_FLOORS, n));
  for (let i = 0; i < floors; i++) {
    const y = i * STEP;
    dummy.position.set(0, y + ROOM_H / 2, 0); dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    shell.walls.setMatrixAt(i, dummy.matrix);

    dummy.position.set(0, y, 0); dummy.updateMatrix();
    shell.slabs.setMatrixAt(i, dummy.matrix);

    dummy.position.set(0, y, -ROOM_D / 2); dummy.updateMatrix();
    shell.front.setMatrixAt(i, dummy.matrix);
  }
  /* The roof: one more slab, so the top floor is a room and not an open box. */
  dummy.position.set(0, floors * STEP, 0); dummy.updateMatrix();
  shell.slabs.setMatrixAt(floors, dummy.matrix);

  shell.walls.count = floors; shell.front.count = floors; shell.slabs.count = floors + 1;
  for (const m of [shell.walls, shell.slabs, shell.front]) m.instanceMatrix.needsUpdate = true;

  const h = floors * STEP;
  for (const m of [shell.lift, shell.liftCore]) {
    m.scale.set(1, h, 1);
    m.position.set(ROOM_W / 2 - WELL * 0.9, h / 2, 0);
  }
  shell.floors = floors;
}


/* =============================================================================
   TYPE ON A WALL — canvas textures, the same way city.js makes its captions
   Text in the scene, not the DOM: a DOM overlay would need a projection per
   line per frame, and a page is twenty-four of them on each of three walls.
   ========================================================================== */
const panelCache = new Map();      // key -> { tex, mesh } , oldest evicted

function panelCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* One wall of source. `rows` are the file's own lines, `first` is the real line
   number of rows[0], and `warm` tints the whole panel when this floor's own
   Edit landed inside the last half hour of session time. */
function sourcePanel(rows, first, warm, hot) {
  /* 750 canvas rows for a panel that lands about 800 px tall on a 900-px frame
     at reading distance: one texel per pixel, so the type is neither soft nor
     paying for resolution nobody sees. */
  const CH = 750, CW = Math.round(CH * PANEL_ASPECT);
  const c = panelCanvas(CW, CH);
  const g = c.getContext('2d');
  /* Fully opaque, and the material below is not transparent either. A page of
     source is a solid plate, and putting it in the transparent queue sorted it
     by its own centre against a lift column whose bounding centre is ninety
     units up — so the column was drawn FIRST and the plate painted straight
     over it. Opaque geometry is depth-tested instead of sorted, which is the
     only ordering that is correct by construction. */
  g.fillStyle = '#0e0c0a';
  g.fillRect(0, 0, CW, CH);

  const rowH = CH / PAGE_ROWS;
  const size = Math.floor(rowH * GLYPH_FRAC);
  g.font = `400 ${size}px ${MONO}`;
  g.textBaseline = 'middle';
  const gutter = g.measureText('00000').width + 24;

  for (let i = 0; i < PAGE_ROWS; i++) {
    const y = rowH * (i + 0.5);
    const n = first + i;
    const line = rows[i];
    if (line === undefined) break;
    /* The line number is dim and the code is bone: the same two weights the
       ticker uses, so the wall and the chrome are one typographic system. */
    g.fillStyle = C_DIM;
    g.textAlign = 'right';
    g.fillText(String(n), gutter - 24, y);
    g.textAlign = 'left';
    g.fillStyle = warm ? '#ffd6a8' : C_BONE;
    /* Tabs are expanded rather than measured: canvas draws a tab as nothing at
       all, and an indented file would come out flush left. */
    g.fillText(line.replace(/\t/g, '  ').slice(0, PAGE_COLS), gutter, y);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: hot ? 0xffb0a0 : 0xffffff });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), mat);
  mesh.userData.tex = tex;
  return mesh;
}

/* NO MANGLED DIRECTORY NAMES ON A ROOM WALL  <!-- CITY-DIRNAME-DOC -->
   The same check city.js applies to a plate before it ever reaches the
   ground (see its CITY-DIRNAME-DOC): a `~/.claude/projects` folder name has
   every separator flattened to a dash, and a real tool call against a file
   living there put one on a wall in here as the file's own address. Plate and
   street names arrive already clean (their labels are set once, in
   city.js — see plateLabels()); a file's `rel` is not, since this module
   reads it straight off the building record for the address line and the
   floor HUD. Duplicated rather than imported: city.js already imports this
   module, so the other direction is a cycle, and the rule is ten lines. */
function looksMangledDir(s) {
  if (/^[a-z]--users-|--users-|-appdata-/i.test(s)) return true;
  return s.length > 40 && (s.split('-').length - 1) >= 3;
}
function scrubDirName(name) {
  const s = String(name || '');
  if (!looksMangledDir(s)) return s;
  const parts = s.split('-').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i];
    if (t.length >= 3 && /[a-z]/i.test(t) && !/^[0-9a-f]{6,}$/i.test(t)) return t;
  }
  return '~';
}
function scrubRelDisplay(rel) {
  const segs = String(rel || '').split('/');
  const file = segs.pop();
  return segs.map(scrubDirName).concat(file).join('/');
}

/* A plaque: a small piece of prose on a dark plate. Used for the "source not
   available" notice, the file's own address, a prompt in the hall of records
   and a door's label in a lobby. */
function plaque(title, body, opts) {
  const o = opts || {};
  const CW = 1024, CH = Math.round(CW * (o.ratio || 0.42));
  const c = panelCanvas(CW, CH);
  const g = c.getContext('2d');
  g.fillStyle = o.bare ? 'rgba(0,0,0,0)' : 'rgba(16,14,11,0.90)';
  g.fillRect(0, 0, CW, CH);
  if (!o.bare) {
    g.strokeStyle = 'rgba(210,166,44,0.45)'; g.lineWidth = 3;
    g.strokeRect(6, 6, CW - 12, CH - 12);
  }
  let y = 62;
  if (title) {
    g.font = `${o.serif ? '400 58px ' + SERIF : '500 44px ' + MONO}`;
    g.fillStyle = o.gold ? '#d2a62c' : C_BONE;
    g.textBaseline = 'middle';
    /* Wrapped, not clipped. A session title is somebody's whole first sentence
       and the first hall-of-records capture cut it mid-word at the edge of the
       canvas — which reads as a rendering fault rather than as a long title. */
    for (const line of wrap(g, title, CW - 88)) {
      g.direction = rtl(line) ? 'rtl' : 'ltr';
      g.textAlign = rtl(line) ? 'right' : 'left';
      g.fillText(line, rtl(line) ? CW - 44 : 44, y);
      y += 66;
      if (y > CH - 20) break;
    }
    y += 10;
  }
  if (body) {
    g.font = `300 34px ${MONO}`;
    g.fillStyle = C_DIM;
    for (const line of wrap(g, body, CW - 88)) {
      g.direction = rtl(line) ? 'rtl' : 'ltr';
      g.textAlign = rtl(line) ? 'right' : 'left';
      g.fillText(line, rtl(line) ? CW - 44 : 44, y);
      y += 46;
      if (y > CH - 20) break;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(o.w || 3.4, (o.w || 3.4) * (CH / CW)),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.userData.tex = tex;
  return mesh;
}

/* The same first-strong-character rule city.js's makeLabel() uses: a Hebrew
   prompt set left-to-right comes out with its punctuation in the wrong place. */
const RTL_FIRST = /^[^\p{L}\p{N}]*[\p{Script=Hebrew}\p{Script=Arabic}]/u;
const rtl = t => RTL_FIRST.test(t || '');

function wrap(g, text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (g.measureText(t).width > max && line) { out.push(line); line = word; }
      else line = t;
    }
    out.push(line);
  }
  return out;
}

function disposePanel(m) {
  if (!m) return;
  if (m.userData.tex) m.userData.tex.dispose();
  if (m.geometry) m.geometry.dispose();
  if (m.material) m.material.dispose();
}


/* =============================================================================
   THE FILE'S OWN BYTES — GET /api/project/file, or the labelled fixture
   Contract, exactly:
     GET /api/project/file?id=<town>&f=<relative path>
       200  text/plain; charset=utf-8   the file verbatim, <= 512 KB
       any other status -> there is no source, and the room says so on a plaque
   Nothing here retries and nothing here guesses: a 404 is a fact about the
   building, and the plaque prints it.
   ========================================================================== */
const fileCache = new Map();       // rel -> { lines, fixture, missing }

async function fetchSource(rel) {
  if (fileCache.has(rel)) return fileCache.get(rel);
  let got = null;
  if (src.projectId) {
    try {
      const r = await fetch(`/api/project/file?id=${encodeURIComponent(src.projectId)}` +
                            `&f=${encodeURIComponent(rel)}`, { cache: 'no-store' });
      if (r.ok) got = { lines: (await r.text()).split(/\r?\n/), fixture: false, missing: false };
    } catch (_) { /* no server: the fixture below is the honest fallback */ }
  }
  if (!got) {
    /* The dev fixture. It is LABELLED on the wall — see enterBuilding()'s
       plaque — because a room that shows somebody else's bytes without saying
       so is the one lie this whole page is built not to tell. */
    try {
      const r = await fetch('data/sample-file.txt', { cache: 'no-store' });
      if (r.ok) got = { lines: (await r.text()).split(/\r?\n/), fixture: true, missing: false };
    } catch (_) { /* fall through to missing */ }
  }
  if (!got) got = { lines: [], fixture: false, missing: true };
  fileCache.set(rel, got);
  return got;
}

/* =============================================================================
   THE PAGE ITSELF — a CSS3D window in the ground-floor wall
   An `.html` or `.php` building's ground floor gets a window onto the page its
   own bytes make, and it is the REAL page: an <iframe> of
   `GET /api/project/file?id=<town>&f=<path>&raw=1`, which the server serves as
   sandboxed `text/html` — a CSP with `script-src 'none'` and a `<base>` spliced
   into its head so the page's own stylesheets and images resolve through the
   asset endpoint. So the browser lays it out with its own CSS and loads its own
   pictures, which is exactly what the <foreignObject> route this replaces could
   never do: a foreignObject image is forbidden to fetch anything, so the wall
   carried the markup with none of its design on it and none of its images.

   The cost of being real is that a CSS3D element is DOM, not WebGL: it cannot
   be occluded by the room's own walls, whatever its depth. So it is shown only
   while the reader is inside, on the ground floor — the one floor it belongs to
   — and hidden the rest of the time. See syncPageWindow().
   ========================================================================== */
/* The iframe's own pixel size, and the width of the window in the room. The
   world size and the pose are the ones the panel this replaces used, so the
   window is in the same place in the same room; only what is inside it
   changed. A CSS3DObject is one CSS pixel to one world unit until it is
   scaled, which is what PAGE_SCALE is. */
/* 1024, not the 1280 the foreignObject panel used. The window is about 860 CSS
   pixels wide on screen at reading distance, so 1280 was oversampling it.

   The raster size is NOT the frame-rate lever, and that was worth measuring
   rather than assuming: an iframe under a 3D transform is a compositing layer
   the browser re-blends over the WebGL canvas every frame, and shrinking it
   1280 -> 1024 -> 720 moved nothing outside the noise on the headed AMD 860M
   (shown vs hidden: 37-48 against 54-56 at 1024, 35-40 against 44-47 at 720).
   The cost is the compositing itself. 1024 is kept because it is the smallest
   size that is still not softer than the pixels the window occupies. */
const PAGE_PX_W = 960, PAGE_PX_H = 600;
const PAGE_W = ROOM_W * 0.36;
const PAGE_SCALE = PAGE_W / PAGE_PX_W;
const PAGE_POS = [-1.7, 2.35, ROOM_D / 2 - 2.5];
const PAGE_YAW = Math.PI - 0.30;                 // turned to face the door

let css = null;          // the CSS3DRenderer, and the DOM layer it draws into
let pageObj = null;      // the CSS3DObject standing in the room right now
/* WHERE it hangs and where a reader has to be to see it. The city's room has
   exactly one pose and used to carry it in constants; a hall has one per
   station and moves the window between them, so the pose is state now. */
let pageAnchor = null;   // { x, y, z, yaw, floor, near }

/* Does the page have somewhere it can be served from? Two candidates, tried in
   order:

   `GET /api/project/tree/<town>/<relative path>` — a real, path-shaped route,
   so a page's own relative `styles.css`/`img/x.png` resolve against IT the way
   a browser resolves anything: natively, with no `<base>` to get right and
   nothing here to rewrite. This is what item 10/11 in HANDOFF's open items has
   been waiting on.

   `GET /api/project/file?…&raw=1` — the fallback this file already had, for a
   server that has not grown the tree route yet. Its `<base>` cannot work (see
   the comment above `assetPath()`), which is why `wirePageAssets()` still
   exists: it is dead weight only once every server answers the tree route,
   and this one does not check that unconditionally.

   A GET, not a HEAD, on both: server.py implements no HEAD and answers 404 to
   one, so a HEAD probe would report every page as missing. Two localhost
   requests at most per building entered — the price of saying "non-200"
   honestly instead of inferring it from a file extension. */
async function rawPageUrl(rel) {
  if (!src.projectId) return null;
  const treeUrl = '/api/project/tree/' + encodeURIComponent(src.projectId) + '/' +
                   rel.split('/').map(encodeURIComponent).join('/');
  try {
    const r = await fetch(treeUrl, { cache: 'no-store' });
    if (r.ok) return { url: treeUrl, native: true };
  } catch (_) { /* no tree route on this server: fall through to the old path */ }
  const fileUrl = `/api/project/file?id=${encodeURIComponent(src.projectId)}` +
                  `&f=${encodeURIComponent(rel)}&raw=1`;
  try {
    const r = await fetch(fileUrl, { cache: 'no-store' });
    return r.ok ? { url: fileUrl, native: false } : null;
  } catch (_) { return null; }
}

/* The window, built around a live iframe. `allow-same-origin` and nothing
   else: the page is served from this same origin, so its own stylesheets and
   images load, and every other capability — scripts, forms, popups, top-level
   navigation — stays off. The server's own CSP says `script-src 'none'` as
   well, so this holds even if the attribute is ever loosened by accident. */
function pageWindow(info, dir) {
  const el = document.createElement('iframe');
  el.src = info.url;
  el.setAttribute('sandbox', 'allow-same-origin');
  el.setAttribute('scrolling', 'no');
  el.setAttribute('tabindex', '-1');
  el.setAttribute('aria-hidden', 'true');
  el.width = PAGE_PX_W; el.height = PAGE_PX_H;
  el.className = 'interior-page';
  /* The tree route is a real path, so the page's own relative assets already
     resolve against it — the per-element rewiring below is only for the
     fallback, whose `<base>` cannot do that job (see rawPageUrl() above). */
  el.addEventListener('load', () => { if (!info.native) wirePageAssets(el, dir); holdPageStill(el); });
  const obj = new CSS3DObject(el);
  obj.scale.setScalar(PAGE_SCALE);
  obj.position.set(PAGE_POS[0], PAGE_POS[1], PAGE_POS[2]);
  obj.rotation.y = PAGE_YAW;
  return obj;
}

/* A CSS3D element is drawn by the browser, over the canvas, with no knowledge
   of the room's walls — so the room decides when it exists on screen at all:
   inside, and on the floor the window is cut into. Everywhere else it is
   display:none, which also stops the page inside it costing anything. */
/* THE PAGE'S OWN STYLESHEETS AND IMAGES, wired up by hand.

   server.py splices `<base href="/api/project/asset?id=<town>&f=">` into the
   served page so its relative assets resolve through the asset endpoint. That
   cannot work and it is worth writing down: a base URL whose last component is
   a QUERY has no directory, so the browser resolves `styles.css` against it as
   `/api/project/styles.css` — the query is dropped and the last path segment
   replaced, per RFC 3986. Measured: every relative stylesheet and image in a
   framed page 404s, which is why the first capture of this window showed a page
   in browser-default serif with its illustration reduced to alt text.

   Fixing it in the server is not this file's to do, so the frame's own document
   — same origin, reachable — gets its hrefs and srcs rewritten to the asset
   endpoint directly, resolved against the FILE's own directory. What this still
   cannot reach is a url() inside one of those stylesheets: that resolves
   against the stylesheet's URL, which has the same query problem one level
   down. Backgrounds and webfonts declared in an external sheet stay missing,
   and the caption under the window does not claim otherwise. */
/* A reference in the page, as a path the two endpoints will accept. Root-
   relative is relative to the TOWN root; anything else to the file's own
   folder. `..` and `.` are folded here because the endpoints reject a `..`
   segment outright — they cannot tell a tidy path from an escape. */
function assetPath(dir, ref) {
  const segs = (ref.startsWith('/') ? ref.slice(1) : (dir ? dir + '/' : '') + ref)
    .split('?')[0].split('#')[0].split('/');
  const out = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return out.join('/');
}

const assetUrl = (dir, ref) =>
  '/api/project/asset?id=' + encodeURIComponent(src.projectId) +
  '&f=' + encodeURIComponent(assetPath(dir, ref));

/* A stylesheet cannot go through the asset endpoint at all — that one answers
   403 for anything but media — and the file endpoint serves it as text/plain,
   which Chrome will not apply as a stylesheet in standards mode. So a local
   sheet is fetched as text and inlined instead. Three at most: a page that
   links more than three local sheets is not going to be legible on a wall
   either way, and every one of them is a request. */
async function inlineSheets(d, dir) {
  const links = Array.from(d.querySelectorAll('link[rel~="stylesheet"][href]'))
    .filter(n => { const h = n.getAttribute('href');
                   return h && !/^(https?:)?\/\//.test(h) && !h.startsWith('data:'); })
    .slice(0, 3);
  for (const n of links) {
    const rel = assetPath(dir, n.getAttribute('href'));
    const got = await fetchSource(rel);
    if (got.missing || got.fixture) continue;
    const s = d.createElement('style');
    s.textContent = got.lines.join('\n');
    n.replaceWith(s);
  }
}

function wirePageAssets(el, dir) {
  try {
    const d = el.contentDocument;
    if (!d || !src.projectId) return;
    const local = u => u && !/^(https?:)?\/\//.test(u) && !/^(data|blob|mailto|tel|#):?/.test(u);
    inlineSheets(d, dir);
    for (const n of d.querySelectorAll('img[src], source[src], video[src], video[poster]')) {
      for (const attr of ['src', 'poster']) {
        const v = n.getAttribute(attr);
        if (local(v)) n.setAttribute(attr, assetUrl(dir, v));
      }
    }
  } catch (_) { /* not reachable: the page keeps whatever loaded */ }
}

/* A page whose CSS keeps animating repaints its own compositing layer on every
   frame of the room as well as its own, and that is where the frame rate goes:
   measured on the headed AMD 860M, the same room reads 55-56 with the layer off,
   54 with an `about:blank` iframe in it, and 38-43 with a page whose stylesheet
   has running animations. The window is a WINDOW — a page hanging on a wall,
   not a video of one — so the animations are stopped rather than watched. Same
   origin, so the frame's own document is reachable; wrapped anyway, because a
   document that refuses must not take the room down with it. */
function holdPageStill(el) {
  try {
    const d = el.contentDocument;
    if (!d || !d.head) return;
    const s = d.createElement('style');
    s.textContent = '*,*::before,*::after{animation-play-state:paused!important;' +
                    'transition:none!important;scroll-behavior:auto!important}';
    d.head.appendChild(s);
  } catch (_) { /* not reachable: the page just keeps animating */ }
}

const _toPage = new THREE.Vector3(), _pageFwd = new THREE.Vector3();
function syncPageWindow() {
  if (!pageObj) return;
  /* Measured on the headed AMD 860M: a live iframe under a 3D transform costs
     about ten frames a second while it is on screen — the browser re-blends
     that layer over the whole WebGL canvas every frame, and shrinking its
     raster from 1280 to 1024 barely moved it, so the cost is the compositing
     and not the pixels. That is worth paying for a page somebody is reading and
     not worth paying for one behind their head, so the window exists on screen
     only while the reader is inside, on the floor it is cut into, and actually
     facing it. Same rule mountFloor() uses for the source panels. */
  if (!pageAnchor) { pageObj.element.style.display = 'none'; pageObj.visible = false; return; }
  let show = phase === 'inside' && player.floor === pageAnchor.floor;
  /* A hall station also has to be the one the reader is STANDING at: the aisle
     is long and a page four rooms away is a document the browser is compositing
     for nobody. The city's room has no such radius and passes Infinity. */
  if (show && isFinite(pageAnchor.near)) {
    show = Math.hypot(pageAnchor.x - player.pos.x, pageAnchor.z - player.pos.z) < pageAnchor.near + 2.0;
  }
  if (show) {
    _toPage.set(pageAnchor.x, pageAnchor.y, pageAnchor.z).sub(player.pos).normalize();
    /* The hall's screens stand on a WEST wall and are read facing -x, which is
       where a sign error on sin(yaw) decides whether the page is shown at all.
       The city's room is read at yaw ~ pi, where sin(yaw) is 0 and the two
       expressions cannot be told apart — so it keeps the one its four captures
       were taken through and the hall uses the player's real forward vector. */
    if (mode === 'hall') _pageFwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    else _pageFwd.set(Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    show = _toPage.dot(_pageFwd) > 0.20;      // roughly: not behind the reader
  }
  pageObj.element.style.display = show ? '' : 'none';
  pageObj.visible = show;
}

/* =============================================================================
   FIXTURES — what makes a file's room a room and not a box of type
   Everything below is drawn from something the city already knows: a desk is a
   tool call in flight, a plate is an event that landed on this file, a floor
   number is a floor. Nothing here is furniture for the sake of furniture, and
   nothing here is invented — the rule the rest of this file obeys.
   ========================================================================== */
/* Desks are a pool, not one per worker built on the fly: a tool call lasts
   seconds, and building and disposing a desk and its canvas at that rate is a
   texture upload every few frames. Four is above the number of calls this city
   has ever had in flight against ONE file at once — a craft may run twelve, but
   they are twelve different paths. A fifth concurrent call has no desk and is
   still shown by the echo drone over the top floor, which is uncapped. */
const DESK_POOL = 4;
const DESK_W = 1.5, DESK_D = 0.66, DESK_H = 0.74;

/* The screen's own canvas, one per desk, repainted only when the tag changes. */
function screenTexture() {
  const c = panelCanvas(512, 320);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { c, tex };
}

function paintScreen(d, text, idle) {
  const key = (idle ? 'idle ' : 'live ') + (text || '');
  if (d.text === key) return;
  d.text = key;
  const g = d.c.getContext('2d');
  /* Dark and lit are two different greens, not one green at two opacities.
     What is NOT here any more is an OFF screen: a black rectangle on a desk
     photographs as unfinished furniture — the verdict called the two terminals
     in city-interior.png "solid black rectangles" — and it also says the wrong
     thing, because the machine is on and the file is open, there is simply no
     tool call against it this second. An idle screen is the same terminal at a
     lower brightness, wearing the room's own file name. */
  g.fillStyle = idle ? '#0a1210' : '#0d1512';
  g.fillRect(0, 0, 512, 320);
  /* THE BEZEL — a lit frame drawn on the canvas rather than built as geometry.
     The screen is MeshBasic and goes through the bloom pass, so a stroke here
     IS the glow around the panel and costs nothing per frame. */
  g.strokeStyle = idle ? 'rgba(120,198,158,0.42)' : 'rgba(152,240,192,0.78)';
  g.lineWidth = 7;
  g.strokeRect(3.5, 3.5, 512 - 7, 320 - 7);
  d.tex.needsUpdate = true;
  if (!text) return;
  /* A terminal, so: a prompt character, then the tag, wrapped. The tag is the
     worker's own label — the same string the drone outside is wearing. */
  g.font = '400 30px ' + MONO;
  g.textBaseline = 'middle';
  g.fillStyle = idle ? '#4f8069' : '#8fe3b0';
  g.textAlign = 'left';
  g.fillText('>', 22, 56);
  g.fillStyle = idle ? '#7ea994' : '#d8f5e4';
  let y = 56;
  for (const line of wrap(g, text, 512 - 96)) {
    g.direction = rtl(line) ? 'rtl' : 'ltr';
    g.textAlign = rtl(line) ? 'right' : 'left';
    g.fillText(line, rtl(line) ? 512 - 26 : 56, y);
    y += 40;
    if (y > 300) break;
  }
}

/* One desk: a slab on four legs with a screen standing on it. The screen is
   MeshBasic, so it is its own light source and the bloom pass gives it the
   glow — the room has two point lights and they are spent on the room. */
function makeDesk() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3f31, roughness: 0.85 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(DESK_W, 0.06, DESK_D), wood);
  top.position.y = DESK_H;
  g.add(top);
  const legGeo = new THREE.BoxGeometry(0.07, DESK_H, 0.07);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, wood);
    leg.position.set(sx * (DESK_W / 2 - 0.09), DESK_H / 2, sz * (DESK_D / 2 - 0.09));
    g.add(leg);
  }
  const scr = screenTexture();
  /* Held down to 55%, the same correction the page window needs and for the
     same reason: a MeshBasic surface goes through the bloom pass at full value
     and at 1.0 one terminal washed the whole room green. */
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.39),
    new THREE.MeshBasicMaterial({ map: scr.tex, color: 0x8c8c8c }));
  screen.position.set(0, DESK_H + 0.24, -0.10);
  screen.rotation.x = -0.16;                 // tilted back, the way a screen is
  g.add(screen);
  /* The light the screen throws on the desk in front of it. At most four of
     these exist at once — that is a light per WORKER, not the light per floor
     the room's lighting budget rules out. The number looks small next to the
     room's own lamps at 190, and it is not comparable: decay 2 divides by the
     distance squared, and this one sits 30 cm from what it lights while a lamp
     is three metres up. At 26 the first capture came back with the walls, the
     ceiling and the page of source all green. */
  const glow = new THREE.PointLight(0x7fe6b4, 4.5, 2.4, 2);
  glow.position.set(0, DESK_H + 0.30, 0.16);
  glow.visible = false;
  g.add(glow);
  return { group: g, screen, glow, c: scr.c, tex: scr.tex, text: null };
}

/* The desks stand down the right-hand side of the ground floor, screens turned
   into the room. Not against the door wall, which was the first placement: a
   reader standing where he can read a wall of source is facing AWAY from the
   door, so desks behind him are desks nobody ever sees. The z values skip the
   lift's own corner — the floor has a hole in it there. */
const DESK_Z = [3.3, 1.9, -1.9, -3.3];
function placeDesks(desks) {
  desks.forEach((d, i) => {
    d.group.position.set(ROOM_W / 2 - 1.15, 0, DESK_Z[i % DESK_Z.length]);
    d.group.rotation.y = -Math.PI / 2;
  });
}

/* The desks are furniture and always stand; the SCREENS are the live fact. One
   lit terminal per tool call in flight against this file, wearing that call's
   own tag, and a dark screen where nothing is running — which is a statement
   about the file rather than a decoration, and the reason an idle room is not
   pretending anybody is in it. `live` is host.workersFor(subject): the same
   fact the echo drones over the top floor are, and the same one the worker
   drones outside are. */
function syncDesks(live) {
  if (!dress || !dress.desks) return;
  /* What an idle terminal shows: the room's own file, which is the one fact a
     desk in THIS room can state without inventing anybody to be sitting at it. */
  const idleText = (subject && (subject.rel ? scrubRelDisplay(subject.rel) : subject.name)) || '';
  dress.desks.forEach((d, i) => {
    const w = live[i];
    d.glow.visible = !!w;
    if (w) paintScreen(d, w.label || w.tool || 'tool', false);
    else paintScreen(d, idleText, true);
  });
}

/* A LAMP ON EVERY FLOOR. Not a light on every floor — forty lights is a
   recompile of every material on this machine, which is why the room's two real
   point lights ride the floor the reader is on. This is the FIXTURE: a warm
   shade hanging under each ceiling, in one instanced draw, so a tower seen up
   its own lift well is a stack of lit rooms rather than a stack of dark ones. */
function makeFloorLamps(floors) {
  const geo = new THREE.ConeGeometry(0.26, 0.22, 12, 1, true);
  const m = new THREE.InstancedMesh(
    geo, new THREE.MeshBasicMaterial({ color: 0xffcf92, side: THREE.DoubleSide,
                                       transparent: true, opacity: 0.72 }), floors);
  for (let f = 0; f < floors; f++) {
    dummy.position.set(-1.0, f * STEP + ROOM_H - 0.62, 0.5);
    dummy.rotation.set(Math.PI, 0, 0);       // the shade opens downward
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    m.setMatrixAt(f, dummy.matrix);
  }
  m.frustumCulled = false;
  return m;
}

/* FLOOR NUMBERS, on the lift column — one small plate per floor within reach of
   the reader, riding him up and down the tower.

   The first version was one tall plane carrying a strip of forty numbers, and
   it was wrong in a way worth recording: the plane is 0.44 wide and 178 tall,
   and its canvas was 128 wide and 5120 tall, so the two aspects differed by a
   factor of ten and every glyph came out stretched into an unreadable smear.
   Matching the aspect would have wanted a canvas 51,800 px tall, which is past
   what the driver will allocate. So the strip is a POOL instead: seven plates
   with their own small canvases, repainted and repositioned whenever the reader
   changes floor — the same lifecycle, and the same reasoning, as the source
   panels three floors either side of him. */
const LIFT_NUM_SPAN = 3;                          // floors either side
const LIFT_NUM_X = ROOM_W / 2 - WELL * 0.9 - WELL * 0.26;

function makeLiftNumbers() {
  const out = [];
  for (let i = 0; i < LIFT_NUM_SPAN * 2 + 1; i++) {
    const c = panelCanvas(192, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.32),        // 192:128 — the canvas's own aspect
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.rotation.y = -Math.PI / 2;                  // off the column, facing the room
    m.visible = false;
    m.userData.tex = tex; m.userData.c = c; m.userData.shown = null;
    out.push(m);
  }
  return out;
}

function syncLiftNumbers(centre) {
  if (!dress || !dress.liftNums) return;
  dress.liftNums.forEach((m, i) => {
    const f = centre - LIFT_NUM_SPAN + i;
    const on = f >= 0 && f < dress.floors;
    m.visible = on;
    if (!on) return;
    /* Beside the lift, not across it. The column is additive gold and the bloom
       pass spreads it: a numeral hung on its face came back as a ghost inside
       the glare. Offset toward the door by most of the well's half-width and it
       stands against the dark room instead. */
    m.position.set(LIFT_NUM_X, f * STEP + 1.62, -WELL * 0.62);
    if (m.userData.shown === f) return;
    m.userData.shown = f;
    const g = m.userData.c.getContext('2d');
    /* On its own dark plate, the same one every plaque in this room uses — for
       the same reason: unbacked type in front of a light source is not read. */
    g.clearRect(0, 0, 192, 128);
    g.fillStyle = 'rgba(16,14,11,0.90)';
    g.fillRect(0, 0, 192, 128);
    g.strokeStyle = 'rgba(210,166,44,0.45)'; g.lineWidth = 3;
    g.strokeRect(5, 5, 182, 118);
    g.font = '500 84px ' + MONO;
    g.fillStyle = C_GOLD_CSS;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(f + 1), 96, 68);
    m.userData.tex.needsUpdate = true;
  });
}

/* THE THREE MOST RECENT EVENTS ON THIS FILE, as plates by the door: what the
   tool was, which agent ran it, and how long ago on the SESSION clock — the
   same clock the facade outside fades on. city.js records them as they land
   (logFileEvent() there), because that is the one place an event and a building
   meet. A building the city rebuilt before any event was recorded against it
   gets no plates at all, which is the honest answer rather than a guess. */
function agoText(ms) {
  if (!(ms > 0)) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  return h < 24 ? h + 'h ' + (m % 60) + 'm ago'
                : Math.floor(h / 24) + 'd ' + (h % 24) + 'h ago';
}

function eventPlates(b, nodes) {
  const evs = (b && b.events) || [];
  const clock = host.sessionClock();
  evs.forEach((e, i) => {
    const pl = plaque(e.tool, e.agent + '\n' + agoText(clock - e.at),
                      { w: 1.9, ratio: 0.38, gold: i === 0 });
    /* Standing PROUD of the left wall and turned to face the door, not flat on
       a wall. Two reasons, both found by trying the other thing: every wall of
       this room already carries a page of the file, so a plate lying on one is
       coplanar with that page and the two flicker against each other; and a
       plate on a side wall is edge-on to a reader who is facing the source,
       which is where a reader stands. Turned to the door, they are read on the
       way in — newest first, so walking past them is walking backwards through
       what happened to this file.

       Staggered in x and y as well as z, because three plates at one height on
       one line hide each other from every angle but dead ahead: the first
       capture of these was one plate with two ghosts behind it. Older ones step
       further into the room and a little lower, so the set reads as a receding
       row rather than as a stack. */
    pl.position.set(-ROOM_W / 2 + 1.15 + i * 0.62, 2.35 - i * 0.46,
                    ROOM_D / 2 - 0.5 - i * 1.5);
    pl.rotation.y = Math.PI;         // a plane's normal is +z; the door is -z
    shell.group.add(pl); nodes.push(pl);
  });
}


/* =============================================================================
   ENTER — the three doors in
   Each of these builds the dressing, then hands the lens to the fly-in. The
   city is still what is on screen until the fly lands.
   ========================================================================== */
function clearDress() {
  dropEchoes();
  /* The page window is DOM, so disposing is removing the element: leaving it
     parked would keep a live page laid out and painted over the city. */
  if (pageObj) {
    scene.remove(pageObj);
    pageObj.element.remove();
    pageObj = null;
  }
  pageAnchor = null;
  clearHall();
  clearRoom();
  if (dress) for (const m of dress.nodes) { shell.group.remove(m); disposePanel(m); }
  /* Removed from the group as well as disposed: disposing a texture does not
     take the mesh out of the scene, and the first capture after a second visit
     was drawn through six orphaned panels from the first one. */
  for (const [, m] of panelCache) { shell.group.remove(m); disposePanel(m); }
  panelCache.clear();
  dress = null;
}

function beginFly(b) {
  const pose = host.doorPose(b);
  flyFrom = host.cameraPose();
  flyTo = pose;
  flyT = 0;
  phase = 'in';
  keys.clear();
}

/* A FILE. Floors are the Edit/Write events it received — that is city.js's own
   rule for how tall it stands, so the building has exactly as many rooms as it
   has storeys, and page 1 is the top of the file on the ground floor. */
export async function enterBuilding(b) {
  if (phase !== 'out' || !b) return;
  mode = 'file'; subject = b;
  beginFly(b);

  const floors = Math.max(1, Math.min(MAX_FLOORS, b.floors || 1));
  raiseShell(floors);
  placePlayerAtDoor();
  const nodes = [];
  const source = await fetchSource(b.rel);

  /* The address, at eye height beside the door: the path the city knows this
     building by, its floor count and where the bytes came from. */
  const originLine = source.missing
    ? 'source not available — the file endpoint answered with nothing'
    : source.fixture
      ? 'FIXTURE — data/sample-file.txt. The real source needs GET /api/project/file'
      : `${source.lines.length} lines · GET /api/project/file`;
  const addr = plaque(b.name, `${scrubRelDisplay(b.rel)}\n${floors} floor${floors === 1 ? '' : 's'} · ` +
                              `${floors} Edit/Write event${floors === 1 ? '' : 's'}\n${originLine}`,
                      { w: 4.2, gold: true });
  addr.position.set(-ROOM_W / 2 + 0.06, 1.9, -ROOM_D * 0.18);
  addr.rotation.y = Math.PI / 2;
  shell.group.add(addr); nodes.push(addr);

  /* The live page, on the ground floor of an .html or .php building only.
     Everything else in the room is type; this is the one surface that is the
     thing itself rather than a reading of it. Standing in the room facing the
     door, not flat on the back wall: that wall is already carrying this floor's
     source, and two pages of the same file fighting for the same pixels reads
     as a mistake. */
  let pageCaption = null;
  if (/\.(html?|php)$/i.test(b.name)) {
    /* Only probe the raw endpoint when the TEXT endpoint already answered for
       this same path. A path the town cannot resolve — a project whose files
       live under several roots, so the city's `rel` is not the town's own
       relative path — would otherwise fail twice and log two failed requests
       instead of the one the fixture fallback has always logged. */
    const url = (!source.missing && !source.fixture) ? await rawPageUrl(b.rel) : null;
    if (url) {
      const dir = b.rel.includes('/') ? b.rel.slice(0, b.rel.lastIndexOf('/')) : '';
      pageObj = pageWindow(url, dir);
      pageAnchor = { x: PAGE_POS[0], y: PAGE_POS[1], z: PAGE_POS[2],
                     yaw: PAGE_YAW, floor: 0, near: Infinity };
      scene.add(pageObj);
      syncPageWindow();
      pageCaption = url.native
        ? 'the page these bytes make, rendered by the browser from ' +
          'GET /api/project/tree/<town>/<path> — its own stylesheets and its own ' +
          'images, resolved natively, held still. No script runs.'
        : 'the page these bytes make, rendered by the browser from ' +
          'GET /api/project/file?raw=1 — its own stylesheets and its own ' +
          'images, held still. No script runs. A background declared ' +
          'inside a stylesheet is the one thing this window misses.';
    } else {
      /* Neither endpoint answered 200. The window is a claim about the file and
         a claim that cannot be checked is not made — the plaque takes its place
         and says so. */
      pageCaption = 'no window: neither GET /api/project/tree/… nor ' +
                    'GET /api/project/file?raw=1 answered 200 for this path. The ' +
                    'walls above are still this file\'s own bytes.';
    }
    const cap = plaque(null, pageCaption, { w: 3.0, ratio: 0.34 });
    cap.position.set(PAGE_POS[0], 0.58, PAGE_POS[2] - 0.01);   // clear of the window sill
    cap.rotation.y = PAGE_YAW;
    shell.group.add(cap); nodes.push(cap);
  }

  /* The fixtures — see the FIXTURES section above. Each one is a fact about
     this file: a desk per call in flight, a lamp per floor, a plate per recent
     event, a number per floor on the lift. */
  const desks = [];
  for (let i = 0; i < DESK_POOL; i++) {
    const d = makeDesk();
    desks.push(d);
    shell.group.add(d.group); nodes.push(d.group);
  }
  placeDesks(desks);

  const lamps = makeFloorLamps(floors);
  shell.group.add(lamps); nodes.push(lamps);

  const liftNums = makeLiftNumbers();
  for (const m of liftNums) { shell.group.add(m); nodes.push(m); }

  dress = { nodes, source, floors, desks, liftNums };
  eventPlates(b, nodes);
  syncDesks(host.workersFor(b));
  syncLiftNumbers(0);
  mountFloor(0);
  setHud(`${scrubRelDisplay(b.rel)} — floor 1 of ${floors}`);
}

/* A PLATE — a directory. Its lobby lists the files that stand on it as doors,
   in the order the city seated them, each one labelled with its own name. */
export async function enterPlate(p) {
  if (phase !== 'out' || !p) return;
  mode = 'plate'; subject = p;
  const kids = host.filesOfPlate(p);
  beginFly(p);

  raiseShell(1);
  const nodes = [];
  const sign = plaque(p.name, `${kids.length} file${kids.length === 1 ? '' : 's'} stand on this plate`,
                      { w: 5.2, serif: true, gold: true });
  /* Turned to face the door. A PlaneGeometry's own normal is +z and a
     MeshBasicMaterial is front-facing only, so a plaque hung flat on the back
     wall shows its back to the room and is simply not there — which is what
     happened to the session title in the first hall-of-records capture. */
  sign.position.set(0, 2.6, ROOM_D / 2 - 0.08);
  sign.rotation.y = Math.PI;
  shell.group.add(sign); nodes.push(sign);

  /* One door per file, along the two side walls. A door is a plate of type with
     a gold sill; walking into it is what opens that file's building. */
  const doors = [];
  kids.forEach((b, i) => {
    const side = i % 2 ? 1 : -1;
    const row = Math.floor(i / 2);
    const d = plaque(b.name, `${b.floors} floor${b.floors === 1 ? '' : 's'}`,
                     { w: 2.5, ratio: 0.30 });
    d.position.set(side * (ROOM_W / 2 - 0.07), 1.6, ROOM_D / 2 - 1.2 - row * 1.55);
    d.rotation.y = -side * Math.PI / 2;
    d.userData.door = b;
    shell.group.add(d); nodes.push(d); doors.push(d);
  });
  if (!kids.length) {
    const none = plaque(null, 'no files have been touched on this plate yet', { w: 4.6 });
    none.position.set(0, 1.6, 0);
    shell.group.add(none); nodes.push(none);
  }

  dress = { nodes, doors, floors: 1 };
  placePlayerAtDoor();
  setHud(`${p.name} — lobby, ${kids.length} door${kids.length === 1 ? '' : 's'}`);
}

/* A STREET SIGN — the hall of records for one conversation. The title on the
   back wall, the prompts as plaques in the order they were typed, and the
   agents that worked here parked along the aisle wearing their task tags. */
export async function enterStreet(s) {
  if (phase !== 'out' || !s) return;
  mode = 'street'; subject = s;
  beginFly(s);

  raiseShell(2);
  const nodes = [];
  const title = plaque(s.name, null, { w: 8.4, serif: true, gold: true, ratio: 0.26 });
  title.position.set(0, 2.9, ROOM_D / 2 - 0.08);
  title.rotation.y = Math.PI;              // faces the door — see enterPlate()
  shell.group.add(title); nodes.push(title);

  const evs = src.events || [];
  const mine = e => (e.session || src.solo) === s.sid || s.sid === src.solo;
  const prompts = evs.filter(e => e.kind === 'prompt' && mine(e));
  const starts = evs.filter(e => e.kind === 'agent_start' && mine(e));

  const stamp = ms => {
    const t = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
             : `${m}:${String(t % 60).padStart(2, '0')}`;
  };

  /* Prompts down the left wall in order, oldest nearest the door. Their text is
     the export's own summary, cut where the export cut it — nothing is filled
     in and nothing is paraphrased. */
  prompts.slice(0, 14).forEach((e, i) => {
    const pl = plaque(stamp(e.t), e.summary || '(no text in the export)',
                      { w: 3.6, ratio: 0.46 });
    pl.position.set(-ROOM_W / 2 + 0.07, 2.0, ROOM_D / 2 - 1.0 - i * 1.05);
    pl.rotation.y = Math.PI / 2;
    shell.group.add(pl); nodes.push(pl);
  });
  if (!prompts.length) {
    const none = plaque(null, 'this street carries no prompt events in the replay', { w: 4.6 });
    none.position.set(-ROOM_W / 2 + 0.07, 2.0, 0);
    none.rotation.y = Math.PI / 2;
    shell.group.add(none); nodes.push(none);
  }

  /* And the agents, parked. Same octahedron the city flies, standing still on a
     gold pad, wearing the task it was dispatched with. */
  const craftGeo = new THREE.OctahedronGeometry(0.30, 0);
  /* Dimmer than the city's craft: indoors these sit two metres from the lens
     and the bloom pass turned the first set into four white lozenges. */
  const craftMat = new THREE.MeshStandardMaterial({ color: 0x8a8478, emissive: 0x140f08,
                                                    roughness: 0.5, metalness: 0.45 });
  const padGeo = new THREE.RingGeometry(0.44, 0.52, 24);
  const padMat = new THREE.MeshBasicMaterial({ color: C_GOLD, transparent: true, opacity: 0.30,
                                               side: THREE.DoubleSide });
  starts.slice(0, 12).forEach((e, i) => {
    const z = ROOM_D / 2 - 1.2 - i * 1.15;
    const x = ROOM_W / 2 - 2.4;
    const c = new THREE.Mesh(craftGeo, craftMat);
    c.position.set(x, 1.05, z);
    shell.group.add(c); nodes.push(c);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.03, z);
    shell.group.add(pad); nodes.push(pad);
    const tag = plaque(null, e.summary || 'agent', { w: 3.3, bare: true, ratio: 0.16 });
    /* Staggered in three heights: parked in a line down the aisle, every tag at
       the same height overlapped every other one into an unreadable smear. */
    tag.position.set(x, 1.52 + (i % 3) * 0.30, z);
    tag.rotation.y = -Math.PI / 2;
    shell.group.add(tag); nodes.push(tag);
  });

  dress = { nodes, floors: 2 };
  placePlayerAtDoor();
  setHud(`${s.name} — hall of records · ${prompts.length} prompts · ${starts.length} agents`);
}


/* =============================================================================
   THE WALLS OF ONE FLOOR — mounted as you reach it, dropped as you leave
   Three panels a floor and a radius of one, so at most nine textures are live
   however tall the building is.
   ========================================================================== */
const WALL_POSE = [
  /* back  */ { pos: [0, 0, ROOM_D / 2 - 0.06], rot: Math.PI },
  /* left  */ { pos: [-ROOM_W / 2 + 0.06, 0, 0], rot: Math.PI / 2 },
  /* right */ { pos: [ROOM_W / 2 - 0.06, 0, 0], rot: -Math.PI / 2 },
];

function mountFloor(centre) {
  if (mode !== 'file' || !dress) return;
  const want = new Set();
  for (let f = centre - LIVE_FLOORS; f <= centre + LIVE_FLOORS; f++) {
    if (f < 0 || f >= dress.floors) continue;
    for (let wall = 0; wall < WALLS_PER_FLOOR; wall++) want.add(f + ':' + wall);
  }
  /* Drop what walked out of range first, so the cache never holds two floors'
     worth more than it needs. */
  for (const [key, m] of panelCache) {
    if (want.has(key)) continue;
    shell.group.remove(m); disposePanel(m); panelCache.delete(key);
  }
  for (const key of want) {
    if (panelCache.has(key)) continue;
    const [f, wall] = key.split(':').map(Number);
    const m = makeWallPanel(f, wall);
    if (!m) continue;
    panelCache.set(key, m);
    shell.group.add(m);
    while (panelCache.size > PANEL_CACHE) {
      const oldest = panelCache.keys().next().value;
      const om = panelCache.get(oldest);
      shell.group.remove(om); disposePanel(om); panelCache.delete(oldest);
    }
  }
}

function makeWallPanel(f, wall) {
  const s = dress.source;
  const first = f * FLOOR_LINES + wall * PAGE_ROWS;
  if (s.missing) {
    if (wall !== 0) return null;
    const m = plaque('source not available',
                     `${scrubRelDisplay(subject.rel)}\nGET /api/project/file did not answer for this path. ` +
                     `The building's floors, plaques and drones are still this file's own events.`,
                     { w: 6.0 });
    place(m, f, wall, 2.0);
    return m;
  }
  const rows = s.lines.slice(first, first + PAGE_ROWS);
  if (!rows.length) return null;

  /* WARM and HOT, both real and both measured on the session clock:
     - warm  this floor's own Edit landed inside the last RECENT_MS.
     - hot   a worker drone is in the air for this file RIGHT NOW, so the top
             floor — the one that Edit is adding — pulses.
     The export carries no line numbers, so nothing here claims a LINE; the unit
     the events can actually name is the floor, and that is what glows. */
  const at = floorTime(f);
  const warm = at !== null && (host.sessionClock() - at) < RECENT_MS;
  const hot = f === dress.floors - 1 && host.workersFor(subject).length > 0;

  const m = sourcePanel(rows, first + 1, warm, hot);
  m.userData.floor = f; m.userData.wall = wall; m.userData.hot = hot;
  place(m, f, wall, ROOM_H * 0.52);
  return m;
}

function place(m, f, wall, y) {
  const w = WALL_POSE[wall];
  m.position.set(w.pos[0], f * STEP + y, w.pos[2]);
  m.rotation.y = w.rot;
}

/* When floor f's own Edit happened, in session ms. city.js records one stamp
   per floor as it adds it; a building that predates the recording returns null
   and simply does not glow, which is the honest answer. */
function floorTime(f) {
  const t = subject && subject.floorTimes;
  return t && t[f] !== undefined ? t[f] : null;
}


/* =============================================================================
   THE HALL — a TRADE LANDMARK you walk into (world.html)

   The owner's sentence this section exists for: "the music site must really
   look like a music school — really 3D buildings I can walk into and see what
   is happening there."

   ONE hall template, dressed per trade. The template is always the same three
   volumes, because a building a person can navigate is a building whose parts
   they can predict:

     THE HALL      20 x 34 x 9.5 m. The room you land in. Its far end and its
                   furniture are the trade's own (a stage, a dining room, a
                   factory floor, a glass office, a server room, a reading
                   room, a classroom, a studio floor).
     THE AISLE     a corridor down the west side, as long as the site is big.
     THE STATIONS  one per PAGE of the project's own site, off that aisle. For a
                   music school they are walled practice rooms with doors; for
                   every other trade they are open bays on the same pitch.

   Nothing in here is decoration that stands for data. Every station is a page
   from /api/project/meta, its plaque is that page's own <title>, its screen is
   that page rendered by the browser through /api/project/tree/<town>/<path>,
   the corkboard is the town's own open_items, the drones are the agents in
   /api/world's live_agents and they hover over the station whose file their
   own last_path names. The one invented object is the fallback plaque, and it
   says on its face that it is one.

   WHY it re-uses this module rather than being a fourth renderer: the player,
   the pointer-lock/drag-look fallback, the HUD, the fly-in, the plaque canvas
   and the CSS3D page window are all already here and all already proven by the
   city's four interior captures. What the hall adds is a second SHELL and a
   second collision model; everything else is the code the city walks with.

   WHY merged geometry and not instanced pools: a hall is a few hundred boxes
   that never move, at a handful of sizes — the opposite of the city's 720
   identical towers. mergeGeometries() puts the lot into one buffer per
   material, which is five draw calls for the whole building, and it keeps each
   box's OBJECT-SPACE coordinates in metres, which is what makeTriplanarMaterial
   in world.js needs to tile a texture at real-world scale. An InstancedMesh of
   unit boxes would hand that shader a unit cube and every wall in the building
   would show exactly one tile of brick.
   ========================================================================== */

/* The template, in metres. The hall is fixed; only the aisle grows. */
const HALL_W = 20, HALL_D = 34, HALL_H = 9.5;
const HALL_DOOR_W = 3.6, HALL_DOOR_H = 3.4;
const WALL_T = 0.36;
const CORR_X1 = -HALL_W / 2;          // the aisle's east side IS the hall's west wall
const CORR_X0 = CORR_X1 - 6.2;        // and it is 6.2 m wide
/* THE SAME HEIGHT as a station's ceiling, and that is not a style choice: the
   aisle's west side IS the stations' east wall, so a corridor taller than a
   station leaves an open strip the length of the building and the first capture
   of the aisle had a band of sky running along the top of it. */
const CORR_H = 3.7;
const CELL_X1 = CORR_X0;              // a station's east side is the aisle's west side
const CELL_X0 = CELL_X1 - 6.6;
const CELL_H = CORR_H;
const HALL_Z0 = -HALL_D / 2;          // the entrance wall
/* WHERE THE HALL OPENS INTO THE AISLE. Three arches, not one door: a single
   door put the whole teaching wing out of sight of anybody standing at the
   entrance, and a music school whose practice rooms you cannot see is a concert
   hall with a cupboard. Each arch looks straight at a practice-room door on the
   far side of the aisle, which is what puts the corridor in the room's own
   picture. */
const AISLE_ARCHES = [-13.4, -6.2, 1.0];
const ARCH_W = 3.4, ARCH_H = 3.2;   // under CORR_H, or an arch opens above the aisle's ceiling
const HALL_EYE = 1.68;
const HALL_SHOULDER = 0.5;

/* The page window in a station: 4.2 m wide, which is a wall screen and not a
   poster. Same 960x600 raster the city's room uses — see PAGE-WINDOW-DOC in
   RUNBOOK; the raster was never the frame-rate lever, the compositing is, and
   the hall shows exactly ONE of these at a time for that reason. */
const HALL_PAGE_W = 4.2;

/* Trade -> how the hall is dressed. `cells` walls the stations in and gives
   each one a door; `pitch` is how far apart they stand down the aisle; `body`
   is what fills the hall itself. Read off ONE table so the plaque by the door,
   the HUD line and the geometry cannot drift apart — the same rule world.js's
   TRADE_WORDS follows. */
const HALL_DRESS = {
  concertHall: { cells: true,  pitch: 4.8, station: 'practice', body: 'stage',
                 words: 'a concert hall — the stage at the far end, one practice room per page of the site' },
  eatery:      { cells: false, pitch: 3.6, station: 'table',    body: 'dining',
                 words: 'a dining room — the counter, the kitchen pass, one table per page of the site' },
  factoryHall: { cells: false, pitch: 3.6, station: 'machine',  body: 'factory',
                 words: 'a factory floor — the flywheel through the yard window, one machine per page of the site' },
  workshop:    { cells: false, pitch: 3.6, station: 'machine',  body: 'factory',
                 words: 'a workshop floor — one bench machine per page of the site' },
  waterTower:  { cells: false, pitch: 3.2, station: 'monitor',  body: 'servers',
                 words: 'a plant room — one gauge panel per page of the site' },
  glassOffice: { cells: false, pitch: 3.2, station: 'frame',    body: 'office',
                 words: 'a glass office — a desk per live agent, the pages framed on the wall' },
  dataHall:    { cells: false, pitch: 3.2, station: 'monitor',  body: 'servers',
                 words: 'a server room — a rack per session, a monitor per page of the site' },
  codeShop:    { cells: false, pitch: 3.2, station: 'monitor',  body: 'servers',
                 words: 'a server room and a workbench — a rack per session, a monitor per page' },
  library:     { cells: false, pitch: 3.4, station: 'door',     body: 'reading',
                 words: 'a reading room — the shelves down one side, the pages as doors' },
  school:      { cells: true,  pitch: 4.8, station: 'practice', body: 'classroom',
                 words: 'a classroom — the blackboard at the far end, one room per page of the site' },
  filmStudio:  { cells: false, pitch: 3.6, station: 'door',     body: 'studio',
                 words: 'a studio floor — the light rig overhead, the pages as doors' },
};
const HALL_PLAIN = { cells: false, pitch: 3.4, station: 'door', body: 'plain',
                     words: 'a plain hall — a plaque by the door and the pages as doors' };
/* A PAGE WING has one page and no trade, so it takes the plainest body and the
   framed-page station — and the walker starts in the bay rather than at the
   hall door, which is what makes one page read as a room rather than as a
   thirty-metre corridor with a picture at the end. See placePlayerAtHallDoor().
   No new shell: the hall with one station IS a single room with the page on the
   wall, and the page arrives through the same tree route every station uses. */
const HALL_WING = { cells: false, pitch: 3.4, station: 'frame', body: 'plain', wing: true,
                    words: 'one page of this site — the page itself on the wall' };

/* An instrument per practice room, chosen from the PAGE TITLE and nothing else,
   so the same page always gets the same instrument on every visit and on every
   machine. German first because that is the language these sites are in. */
const INSTRUMENTS = [
  [/klavier|piano|fl[uü]gel/i, 'grand'],
  [/gitarre|guitar/i,          'guitar'],
  [/schlagzeug|drum/i,         'drums'],
  [/gesang|voice|vocal|sing/i, 'mic'],
];
const instrumentFor = (title) => {
  for (const [re, k] of INSTRUMENTS) if (re.test(title || '')) return k;
  return 'stand';                       // a music stand: every room has one
};

let hall = null;      // the whole standing building — see enterHall()


/* -----------------------------------------------------------------------------
   THE EMITTER. Every static box, cylinder and plate in the building is written
   here in WORLD metres and sorted into a bin per material; buildHallMesh() then
   merges each bin into one buffer. `y` is the BOTTOM of a box, the same
   convention world.js's landmark emitter uses, because a wall is a thing that
   stands on a floor and not a thing centred in the air.
   -------------------------------------------------------------------------- */
function hallEmitter() {
  const bins = new Map();
  const push = (key, g) => {
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(g);
  };
  return {
    bins,
    /* `rotZ` rolls a box about the axis pointing down the hall, which is what a
       wheel's spokes and a propped piano lid need; with it the box is CENTRED on
       y rather than standing on it, because a rolled box has no bottom face to
       stand on. */
    box(key, x, y, z, w, h, d, rotY, rotZ) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rotZ) g.rotateZ(rotZ);
      if (rotY) g.rotateY(rotY);
      g.translate(x, rotZ ? y : y + h / 2, z);
      push(key, g);
    },
    cyl(key, x, y, z, r, h, rotZ, rotY) {
      const g = new THREE.CylinderGeometry(r, r, h, 12, 1);
      if (rotZ) g.rotateZ(rotZ);
      if (rotY) g.rotateY(rotY);
      g.translate(x, y + (rotZ ? 0 : h / 2), z);
      push(key, g);
    },
    /* A wall with a doorway in it, as three boxes: the two jambs and the lintel.
       Cheaper than a Shape with a hole and it merges the same. `axis` is the
       wall's long direction. */
    wallGap(key, cx, z, len, h, thick, gapAt, gapW, gapH, axis) {
      const half = len / 2;
      const a0 = -half, a1 = gapAt - gapW / 2, b0 = gapAt + gapW / 2, b1 = half;
      const seg = (s, e) => {
        if (e - s < 0.02) return;
        const m = (s + e) / 2, l = e - s;
        if (axis === 'x') this.box(key, cx + m, 0, z, l, h, thick);
        else this.box(key, cx, 0, z + m, thick, h, l);
      };
      seg(a0, a1); seg(b0, b1);
      if (h - gapH > 0.02) {
        if (axis === 'x') this.box(key, cx + gapAt, gapH, z, gapW, h - gapH, thick);
        else this.box(key, cx, gapH, z + gapAt, thick, h - gapH, gapW);
      }
    },
  };
}

function buildHallMesh(E, mats, group) {
  const out = [];
  for (const [key, list] of E.bins) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mats[key] || mats.wall);
    m.frustumCulled = false;
    group.add(m);
    out.push(m);
  }
  return out;
}


/* -----------------------------------------------------------------------------
   THE SHELL. Floor, ceiling, four walls, the aisle and the stations. The whole
   navigable volume is also written down as a list of RECTANGLES, which is the
   collision model: a position is legal if it is inside one of them. Doorways
   are rectangles too — that is how you get from the hall into the aisle and
   from the aisle into a room without cutting a hole in anything.
   -------------------------------------------------------------------------- */
function hallShell(E, n, dress) {
  const regions = [];
  const cells = [];
  const pitch = dress.pitch;
  const aisleLen = Math.max(HALL_D, n * pitch + 4);
  const zEnd = HALL_Z0 + aisleLen;

  /* THE HALL */
  E.box('floor', 0, -0.3, 0, HALL_W + WALL_T * 2, 0.3, HALL_D + WALL_T * 2);
  E.box('ceil', 0, HALL_H, 0, HALL_W + WALL_T * 2, WALL_T, HALL_D + WALL_T * 2);
  /* The entrance wall, with the door you walked in through. */
  E.wallGap('wall', 0, HALL_Z0 - WALL_T / 2, HALL_W, HALL_H, WALL_T, 0, HALL_DOOR_W, HALL_DOOR_H, 'x');
  /* The far wall — the trade's own end of the room dresses it. A factory sees
     its yard and a kitchen sees its pass, so those two get a real opening in it
     rather than a dark plate painted on a solid wall: the first capture of the
     factory floor had the flywheel modelled correctly and completely hidden
     behind six inches of plaster. */
  if (dress.body === 'factory' || dress.body === 'dining') {
    const ow = dress.body === 'factory' ? 9.0 : 6.4, oy = 2.4, oh = 4.0;
    E.box('wall', 0, 0, HALL_D / 2 + WALL_T / 2, HALL_W + WALL_T * 2, oy, WALL_T);
    E.box('wall', 0, oy + oh, HALL_D / 2 + WALL_T / 2, HALL_W + WALL_T * 2, HALL_H - oy - oh, WALL_T);
    E.box('wall', -(HALL_W + ow) / 4 - 0.1, oy, HALL_D / 2 + WALL_T / 2, (HALL_W - ow) / 2 + 0.4, oh, WALL_T);
    E.box('wall', (HALL_W + ow) / 4 + 0.1, oy, HALL_D / 2 + WALL_T / 2, (HALL_W - ow) / 2 + 0.4, oh, WALL_T);
  } else {
    E.box('wall', 0, 0, HALL_D / 2 + WALL_T / 2, HALL_W + WALL_T * 2, HALL_H, WALL_T);
  }
  /* THE EAST WALL and its tall windows: five glass slots floor to cornice, the
     same four-storey glazing world.js's concertHall builder puts on the front
     of this building from outside. They are what puts the dusk in the room. */
  const winW = 2.0, winH = 6.2, winY = 1.1;
  for (let i = 0; i < 5; i++) {
    const z = -12 + i * 6;
    E.box('glass', HALL_W / 2 - 0.02, winY, z, 0.06, winH, winW);
    /* the mullions either side, so the glazing reads as a window and not a hole */
    E.box('stone', HALL_W / 2 - 0.10, winY, z - winW / 2 - 0.16, 0.30, winH, 0.32);
    E.box('stone', HALL_W / 2 - 0.10, winY, z + winW / 2 + 0.16, 0.30, winH, 0.32);
    /* and the wall in the gaps between them */
    E.box('wall', HALL_W / 2 + WALL_T / 2, 0, z, WALL_T, winY, 6);
    E.box('wall', HALL_W / 2 + WALL_T / 2, winY + winH, z, WALL_T, HALL_H - winY - winH, 6);
    E.box('wall', HALL_W / 2 + WALL_T / 2, winY, z + 3, WALL_T, winH, 6 - winW - 0.7);
  }
  /* THE WEST WALL, with the mouth of the aisle in it. */
  /* The west wall as PIERS between the arches: one box per gap, which is the
     same wall wallGap() draws for a single opening, written out because there
     are three of them and wallGap() cuts one. */
  const edges = [-HALL_D / 2];
  for (const a of AISLE_ARCHES) { edges.push(a - ARCH_W / 2, a + ARCH_W / 2); }
  edges.push(HALL_D / 2);
  for (let i = 0; i < edges.length; i += 2) {
    const s0 = edges[i], s1 = edges[i + 1];
    if (s1 - s0 > 0.02) E.box('wall', -HALL_W / 2 - WALL_T / 2, 0, (s0 + s1) / 2, WALL_T, HALL_H, s1 - s0);
  }
  for (const a of AISLE_ARCHES) {
    E.box('wall', -HALL_W / 2 - WALL_T / 2, ARCH_H, a, WALL_T, HALL_H - ARCH_H, ARCH_W);
    /* the arch's own reveal, so the opening reads as built and not as a hole */
    E.box('stone', -HALL_W / 2 + 0.02, 0, a - ARCH_W / 2 - 0.13, 0.30, ARCH_H + 0.26, 0.30);
    E.box('stone', -HALL_W / 2 + 0.02, 0, a + ARCH_W / 2 + 0.13, 0.30, ARCH_H + 0.26, 0.30);
    E.box('stone', -HALL_W / 2 + 0.02, ARCH_H, a, 0.30, 0.26, ARCH_W + 0.6);
  }
  regions.push({ x0: -HALL_W / 2, x1: HALL_W / 2, z0: HALL_Z0, z1: HALL_D / 2, top: HALL_H - 0.5 });

  /* THE AISLE */
  E.box('floor', (CORR_X0 + CORR_X1) / 2, -0.3, (HALL_Z0 + zEnd) / 2, CORR_X1 - CORR_X0 + WALL_T * 2, 0.3, aisleLen + WALL_T * 2);
  E.box('ceil', (CORR_X0 + CORR_X1) / 2, CORR_H, (HALL_Z0 + zEnd) / 2, CORR_X1 - CORR_X0 + WALL_T * 2, WALL_T, aisleLen + WALL_T * 2);
  E.box('wall', (CORR_X0 + CORR_X1) / 2, 0, HALL_Z0 - WALL_T / 2, CORR_X1 - CORR_X0, CORR_H, WALL_T);
  E.box('wall', (CORR_X0 + CORR_X1) / 2, 0, zEnd + WALL_T / 2, CORR_X1 - CORR_X0 + WALL_T * 2, CORR_H, WALL_T);
  /* The aisle's east wall exists only where the hall is not: south of the hall
     it is the hall's own west wall, north of it the aisle is open to nothing. */
  if (zEnd > HALL_D / 2) {
    E.box('wall', CORR_X1 + WALL_T / 2, 0, (HALL_D / 2 + zEnd) / 2, WALL_T, CORR_H, zEnd - HALL_D / 2);
  }
  for (let z = HALL_Z0 + 5; z < zEnd; z += 9) {
    E.box('lamp', (CORR_X0 + CORR_X1) / 2, CORR_H - 0.16, z, 1.6, 0.10, 0.34);
  }
  regions.push({ x0: CORR_X0, x1: CORR_X1, z0: HALL_Z0, z1: zEnd, top: CORR_H - 0.5 });
  /* the arches: a rectangle straddling the wall each, so the two regions connect */
  for (const a of AISLE_ARCHES) {
    regions.push({ x0: CORR_X1 - 0.9, x1: CORR_X1 + 0.9,
                   z0: a - ARCH_W / 2, z1: a + ARCH_W / 2, top: ARCH_H - 0.3 });
  }

  /* THE STATIONS' BAND, one strip the whole length of the aisle: floor, ceiling
     and outer wall are CONTINUOUS, and the stations are what is inside it.
     Building them as one box per station is what the first capture showed sky
     through — a bay is only as long as its page, the aisle is as long as the
     site, and every metre of the difference was a hole. */
  const bandC = (CELL_X0 + CELL_X1) / 2, bandW = CELL_X1 - CELL_X0;
  const bandZ = (HALL_Z0 + zEnd) / 2, bandL = aisleLen;
  E.box('floor', bandC, -0.3, bandZ, bandW + WALL_T * 2, 0.3, bandL + WALL_T * 2);
  E.box('ceil', bandC, CELL_H, bandZ, bandW + WALL_T * 2, WALL_T, bandL + WALL_T * 2);
  E.box('wall', CELL_X0 - WALL_T / 2, 0, bandZ, WALL_T, CELL_H, bandL + WALL_T * 2);
  E.box('wall', bandC, 0, HALL_Z0 - WALL_T / 2, bandW, CELL_H, WALL_T);
  E.box('wall', bandC, 0, zEnd + WALL_T / 2, bandW + WALL_T * 2, CELL_H, WALL_T);

  const openings = [];      // where the aisle's west face is open, in z
  for (let i = 0; i < n; i++) {
    const z0 = HALL_Z0 + 1.6 + i * pitch;
    /* Walled stations leave 0.9 m between them for the two dividing walls and
       the void they enclose; open ones run edge to edge. */
    const z1 = z0 + pitch - (dress.cells ? 0.9 : 0);
    const zc = (z0 + z1) / 2;
    cells.push({ i, z0, z1, zc, x0: CELL_X0, x1: CELL_X1 });
    E.box('lamp', bandC + 0.6, CELL_H - 0.14, zc, 1.3, 0.08, 0.44);
    if (dress.cells) {
      /* A walled practice room: two dividing walls and a door in the aisle face. */
      E.box('wall', bandC, 0, z0 - WALL_T / 2, bandW, CELL_H, WALL_T);
      E.box('wall', bandC, 0, z1 + WALL_T / 2, bandW, CELL_H, WALL_T);
      openings.push([zc - 0.85, zc + 0.85, 2.5]);
      /* the jamb, so the door reads as a door and not as a gap */
      E.box('stone', CELL_X1 + 0.02, 0, zc - 0.95, 0.22, 2.62, 0.18);
      E.box('stone', CELL_X1 + 0.02, 0, zc + 0.95, 0.22, 2.62, 0.18);
      E.box('stone', CELL_X1 + 0.02, 2.5, zc, 0.22, 0.20, 2.08);
      regions.push({ x0: CELL_X1 - 0.7, x1: CELL_X1 + 0.7, z0: zc - 0.75, z1: zc + 0.75, top: 2.4 });
    } else {
      openings.push([z0, z1, CELL_H]);
    }
    regions.push({ x0: CELL_X0, x1: CELL_X1, z0, z1, top: CELL_H - 0.4 });
  }
  /* The aisle's west face: solid between the openings, and a lintel over each
     one that does not run to the ceiling. */
  let cursor = HALL_Z0 - WALL_T;
  for (const [a0, a1, ah] of openings) {
    if (a0 - cursor > 0.02) {
      E.box('wall', CELL_X1 + WALL_T / 2, 0, (cursor + a0) / 2, WALL_T, CELL_H, a0 - cursor);
    }
    if (CELL_H - ah > 0.02) {
      E.box('wall', CELL_X1 + WALL_T / 2, ah, (a0 + a1) / 2, WALL_T, CELL_H - ah, a1 - a0);
    }
    cursor = a1;
  }
  if (zEnd + WALL_T - cursor > 0.02) {
    E.box('wall', CELL_X1 + WALL_T / 2, 0, (cursor + zEnd + WALL_T) / 2, WALL_T, CELL_H, zEnd + WALL_T - cursor);
  }
  return { regions, cells, aisleLen, zEnd };
}


/* -----------------------------------------------------------------------------
   THE BODY OF THE HALL — the trade's own end of the room.
   Each of these is the ONE thing a person would draw if asked to draw the
   inside of that trade, and nothing else. They write into the same emitter, so
   they cost no extra draw call.
   -------------------------------------------------------------------------- */
const HALL_BODY = {
  /* A stage at the far end, a lectern on it, and nine rows of seats facing it.
     The rows are what make the room read as a hall rather than as a warehouse
     with a platform in it. */
  stage(E) {
    E.box('stone', 0, 0, 12.4, 15.0, 1.10, 9.0);
    E.box('stone', 0, 1.10, 7.95, 15.0, 0.14, 0.5);         // the stage lip
    /* the lectern */
    E.box('dark', -0.6, 1.10, 10.6, 0.72, 1.06, 0.50);
    E.box('dark', -0.6, 2.16, 10.6, 0.86, 0.06, 0.62, -0.22);
    /* the acoustic shell behind it — three canted panels, which is what a
       concert platform actually has and what tells the eye this room is for
       listening in */
    for (let i = 0; i < 3; i++) {
      E.box('plaster', -4.6 + i * 4.6, 1.10, 16.2, 4.2, 6.4, 0.3, (i - 1) * 0.16);
    }
    for (let r = 0; r < 9; r++) {
      const z = 4.6 - r * 2.05;
      for (let s = 0; s < 12; s++) {
        const x = -7.15 + s * 1.3;
        E.box('seat', x, 0.42, z, 1.02, 0.10, 0.86);        // the pan
        E.box('seat', x, 0.52, z - 0.42, 1.02, 0.62, 0.10); // the back
        E.box('dark', x, 0, z, 0.10, 0.42, 0.10);           // the leg
      }
    }
  },

  /* A dining room: the counter down the east side under the windows, and the
     kitchen behind a pass-through in the far wall. */
  dining(E) {
    E.box('stone', 6.6, 0, 2.0, 1.10, 1.06, 14.0);
    E.box('dark', 6.6, 1.06, 2.0, 1.30, 0.08, 14.2);
    E.box('dark', 0, 2.2, 16.6, 6.4, 1.5, 0.6);             // the pass-through hood
    E.box('stone', -4.6, 0, 16.4, 5.4, 2.2, 0.6);
    E.box('stone', 4.6, 0, 16.4, 5.4, 2.2, 0.6);
    for (let i = 0; i < 4; i++) E.cyl('dark', -5 + i * 3.4, 1.06, 2.0, 0.16, 0.9);
  },

  /* A factory floor: the flywheel standing in the yard, seen through the far
     wall's window. The wheel is the same wheel world.js turns on the OUTSIDE of
     this landmark when the town is live — the same fact, from inside. */
  /* The yard is a real yard: the far wall has a real opening in it (hallShell
     cuts one for this body), so the flywheel stands OUTSIDE and is seen through
     it. The first capture had a dark plate painted over the opening and the
     wheel modelled correctly behind six inches of plaster. */
  factory(E) {
    E.box('floor', 0, -0.3, 22.0, 22.0, 0.3, 12.0);         // the yard's ground
    E.box('wall', 0, 0, 28.2, 24.0, 9.0, WALL_T);           // and its back fence
    E.cyl('steel', 0, 5.0, 21.0, 2.6, 0.5, Math.PI / 2);    // the flywheel
    E.cyl('steel', 0, 5.0, 21.0, 0.45, 1.4, Math.PI / 2);
    for (let i = 0; i < 6; i++) {                            // its spokes
      /* (i + 0.5), never i: rotZ 0 is falsy, and a spoke at exactly 0 would fall
         through to the standing-box case and sit on top of the wheel. */
      E.box('steel', 0, 5.0, 21.0, 0.22, 5.0, 0.30, 0, (i + 0.5) * Math.PI / 6);
    }
    E.box('steel', 0, 0, 21.0, 1.4, 5.0, 1.4);              // the bearing pedestal
    E.box('stone', 0, 0, 12.0, 15.0, 0.18, 8.0);            // the concrete apron
    for (let i = 0; i < 5; i++) E.box('steel', -7 + i * 3.5, 0, 6.0, 0.34, HALL_H, 0.34);
    /* The gantry the hall is spanned by — one rail at cornice height, which is
       what makes the volume read as a machine hall and not as a car park. */
    E.box('steel', 0, HALL_H - 1.3, 2.0, 0.5, 0.5, 26.0);
  },

  /* A glass office: a desk per LIVE AGENT — not a fixed six — because that is
     the fact this room is about. The agents themselves hover over their own desk
     (see enterHall), wearing the task tag /api/world gave them. */
  office(E, f) {
    E.box('stone', 0, 0, 15.6, 7.0, 1.12, 1.0);             // reception
    for (let i = 0; i < Math.max(1, Math.min(6, f.agents)); i++) {
      const z = 10.0 - i * 3.2;
      E.box('dark', 2.4, 0.70, z, 2.0, 0.07, 1.0);
      E.box('steel', 1.5, 0, z, 0.08, 0.70, 0.08);
      E.box('steel', 3.3, 0, z, 0.08, 0.70, 0.08);
      E.box('steel', 2.4, 0.77, z + 0.30, 0.30, 0.24, 0.10);   // the monitor arm
      E.box('lamp', 2.4, 1.01, z + 0.32, 0.90, 0.52, 0.04);    // and its lit face
    }
    for (let i = 0; i < 4; i++) E.box('glass', -3.2, 0, 4 + i * 4, 0.06, 3.4, 3.6);
  },

  /* A server room: a rack per SESSION in this project, capped at eighteen —
     past that the room is a wall of black boxes and the count has stopped
     saying anything. The cap is named in the plaque by the door. */
  servers(E, f) {
    const racks = Math.max(1, Math.min(18, f.sessions));
    for (let i = 0; i < racks; i++) {
      const col = i % 2, row = (i - col) / 2;
      E.box('dark', col ? 4.4 : -0.4, 0, -8 + row * 2.3, 1.0, 2.15, 1.1);
    }
    E.box('dark', 0, 0, 15.4, 12.0, 0.90, 1.2);             // the workbench
    E.box('steel', 0, 0.90, 15.4, 12.0, 0.06, 1.4);
  },

  /* A reading room: shelves down the west side of the hall, tables in the middle. */
  reading(E) {
    for (let i = 0; i < 7; i++) {
      E.box('dark', -8.4, 0, -12 + i * 4.2, 0.9, 2.6, 3.8);
      for (let s = 1; s < 5; s++) E.box('stone', -8.1, s * 0.52, -12 + i * 4.2, 0.5, 0.06, 3.7);
    }
    for (let i = 0; i < 4; i++) {
      E.box('dark', 2.0, 0.72, -8 + i * 5, 3.2, 0.08, 1.2);
      E.box('steel', 0.6, 0, -8 + i * 5, 0.1, 0.72, 0.1);
      E.box('steel', 3.4, 0, -8 + i * 5, 0.1, 0.72, 0.1);
    }
  },

  /* A classroom: the blackboard at the far end and rows of desks facing it. */
  classroom(E) {
    E.box('dark', 0, 1.4, 16.6, 10.0, 2.4, 0.14);
    E.box('stone', 0, 0, 14.4, 12.0, 0.30, 3.0);
    for (let r = 0; r < 6; r++) for (let s = 0; s < 5; s++) {
      const x = -6.4 + s * 3.2, z = 8 - r * 2.6;
      E.box('dark', x, 0.70, z, 2.4, 0.07, 0.7);
      E.box('steel', x - 1.1, 0, z, 0.07, 0.70, 0.07);
      E.box('steel', x + 1.1, 0, z, 0.07, 0.70, 0.07);
      E.box('seat', x, 0.44, z + 1.0, 2.2, 0.09, 0.6);
    }
  },

  /* A studio floor: a light rig overhead and a cyclorama at the far end. */
  studio(E) {
    for (let i = 0; i < 6; i++) E.box('steel', 0, HALL_H - 0.9, -12 + i * 5, 16.0, 0.16, 0.16);
    for (let i = 0; i < 10; i++) {
      const x = -6 + (i % 5) * 3, z = -10 + Math.floor(i / 5) * 12;
      E.box('dark', x, HALL_H - 1.5, z, 0.5, 0.5, 0.7);
      E.box('lamp', x, HALL_H - 1.62, z, 0.34, 0.10, 0.5);
    }
    E.box('plaster', 0, 0, 16.4, 16.0, HALL_H, 0.5);
  },

  /* A plain hall: nothing but the room and the light. A trade this file has no
     grammar for gets an honest empty hall and a plaque, not a guess. */
  plain(E) {
    E.box('stone', 0, 0, 14.6, 9.0, 0.35, 4.0);
  },
};


/* -----------------------------------------------------------------------------
   THE STATIONS. One per page. Each returns the pose of its SCREEN — the surface
   that carries the real page — and everything else it writes into the emitter.
   -------------------------------------------------------------------------- */
const HALL_STATION = {
  /* A practice room: the instrument, a stool, and the screen on the far wall. */
  practice(E, c, page) {
    const k = instrumentFor(page.title);
    /* Deep in the room and off the centre line, not by the door: standing at the
       door of a 6.6 m room the instrument has to be far enough away to be SEEN,
       and the first capture had the reader's nose in the kick drum. */
    const x = CELL_X0 + 2.3, z = c.zc - 0.45;
    if (k === 'grand') {
      E.box('dark', x, 0.68, z, 2.2, 0.22, 1.5, 0.35);       // the case
      E.box('dark', x - 0.2, 0.90, z + 0.1, 1.9, 0.05, 1.3, 0.55);   // the lid, propped
      E.cyl('steel', x - 0.9, 0, z - 0.6, 0.06, 0.68);
      E.cyl('steel', x + 0.9, 0, z - 0.5, 0.06, 0.68);
      E.cyl('steel', x, 0, z + 0.7, 0.06, 0.68);
      E.box('plaster', x - 0.7, 0.72, z - 0.6, 1.0, 0.04, 0.16, 0.35);  // the keys
    } else if (k === 'guitar') {
      E.box('dark', x, 0, z, 0.5, 0.06, 0.5);
      E.cyl('dark', x, 0.06, z, 0.04, 1.0);
      E.box('stone', x + 0.03, 0.20, z, 0.10, 0.44, 0.36);
      E.cyl('dark', x + 0.03, 0.64, z, 0.03, 0.52);
    } else if (k === 'drums') {
      /* A kick drum LIES DOWN — its head faces the player, not the ceiling — and
         the first capture had it standing, which is why the kit read as three
         brown stools. rotZ turns the cylinder's axis onto x, which is the
         direction the reader looks from the door. */
      E.cyl('stone', x, 0.42, z, 0.42, 0.48, Math.PI / 2);   // the kick
      E.cyl('stone', x - 0.20, 0.86, z - 0.42, 0.20, 0.26);  // the toms, on it
      E.cyl('stone', x - 0.20, 0.86, z + 0.10, 0.23, 0.28);
      E.cyl('stone', x + 0.30, 0.50, z + 0.62, 0.19, 0.16);  // the snare
      E.cyl('steel', x + 0.30, 0, z + 0.62, 0.03, 0.50);
      /* Brass and thin. On the first capture the cymbals were the EMISSIVE
         material and the bloom pass turned a 60 cm disc into the brightest thing
         in the room by a wide margin. */
      E.cyl('steel', x - 0.10, 0, z - 1.00, 0.03, 1.32);
      E.cyl('brass', x - 0.10, 1.32, z - 1.00, 0.30, 0.015); // the ride
      E.cyl('steel', x + 0.40, 0, z + 1.10, 0.03, 1.10);
      E.cyl('brass', x + 0.40, 1.10, z + 1.10, 0.24, 0.015); // the hi-hat
    } else if (k === 'mic') {
      E.cyl('steel', x, 0, z, 0.04, 1.42);
      E.box('steel', x, 0, z, 0.5, 0.04, 0.5);
      E.box('dark', x, 1.42, z, 0.09, 0.16, 0.09);
    } else {
      E.cyl('steel', x, 0, z, 0.035, 1.10);                  // a music stand
      E.box('steel', x, 0, z, 0.44, 0.03, 0.44);
      E.box('dark', x, 1.10, z, 0.52, 0.04, 0.40, 0);
    }
    E.box('seat', x + 1.9, 0.44, z + 1.3, 0.5, 0.08, 0.5);   // the stool
    E.cyl('steel', x + 1.9, 0, z + 1.3, 0.05, 0.44);
    return { x: CELL_X0 + 0.28, y: 2.05, z: c.zc, yaw: Math.PI / 2, w: HALL_PAGE_W };
  },

  /* A table with a menu board standing on the wall behind it. */
  table(E, c) {
    const x = (CELL_X0 + CELL_X1) / 2 + 0.8, z = c.zc;
    E.cyl('dark', x, 0.72, z, 0.62, 0.07);
    E.cyl('steel', x, 0, z, 0.07, 0.72);
    E.cyl('steel', x, 0, z, 0.34, 0.04);
    for (const dz of [-1.0, 1.0]) {
      E.box('seat', x, 0.44, z + dz, 0.44, 0.07, 0.44);
      E.cyl('steel', x, 0, z + dz, 0.05, 0.44);
      E.box('seat', x, 0.51, z + dz + (dz > 0 ? 0.20 : -0.20), 0.44, 0.44, 0.06);
    }
    return { x: CELL_X0 + 0.28, y: 1.85, z: c.zc, yaw: Math.PI / 2, w: 3.4 };
  },

  /* A machine on the line, its control screen bolted to the side of it. */
  machine(E, c) {
    const x = (CELL_X0 + CELL_X1) / 2 + 0.4, z = c.zc;
    E.box('steel', x, 0, z, 2.4, 1.55, 1.5);
    E.box('dark', x, 1.55, z, 1.7, 0.42, 1.1);
    E.cyl('steel', x - 1.3, 1.0, z, 0.30, 0.6, Math.PI / 2);
    E.box('steel', x + 1.0, 0, z + 1.0, 0.5, 1.9, 0.5);
    return { x: CELL_X0 + 0.28, y: 1.95, z: c.zc, yaw: Math.PI / 2, w: 3.6 };
  },

  /* A framed page on the wall, with its own picture light over it. */
  frame(E, c) {
    E.box('lamp', CELL_X0 + 0.55, 3.05, c.zc, 0.16, 0.08, 1.4);
    E.box('dark', CELL_X0 + 0.18, 1.10, c.zc, 0.10, 2.4, 3.6);
    return { x: CELL_X0 + 0.30, y: 2.05, z: c.zc, yaw: Math.PI / 2, w: 3.2 };
  },

  /* A rack with a monitor on an arm in front of it. */
  monitor(E, c) {
    const x = (CELL_X0 + CELL_X1) / 2 + 1.2, z = c.zc;
    E.box('dark', x, 0, z, 1.0, 2.15, 1.1);
    E.box('dark', x - 1.4, 0.74, z, 1.6, 0.07, 0.9);
    E.cyl('steel', x - 1.4, 0, z, 0.06, 0.74);
    return { x: CELL_X0 + 0.28, y: 1.95, z: c.zc, yaw: Math.PI / 2, w: 3.4 };
  },

  /* A door. The page IS the door: its title on the plaque, the page itself in
     the doorway. This is the fallback grammar, and it is deliberately plain. */
  door(E, c) {
    E.box('stone', CELL_X0 + 0.16, 0, c.zc - 1.15, 0.22, 2.62, 0.18);
    E.box('stone', CELL_X0 + 0.16, 0, c.zc + 1.15, 0.22, 2.62, 0.18);
    E.box('stone', CELL_X0 + 0.16, 2.50, c.zc, 0.22, 0.20, 2.48);
    return { x: CELL_X0 + 0.30, y: 1.75, z: c.zc, yaw: Math.PI / 2, w: 2.9 };
  },
};


/* -----------------------------------------------------------------------------
   A DARK SCREEN with a page's title on it. This is what every station carries
   until the player walks up to it — the page window is one live document at a
   time, and twenty-four of them would be twenty-four documents laid out over
   the canvas at once.
   -------------------------------------------------------------------------- */
function screenPanel(page, w) {
  const CW = 640, CH = 400;
  const c = panelCanvas(CW, CH);
  const g = c.getContext('2d');
  g.fillStyle = '#0b0a09'; g.fillRect(0, 0, CW, CH);
  g.strokeStyle = 'rgba(210,166,44,0.30)'; g.lineWidth = 4;
  g.strokeRect(8, 8, CW - 16, CH - 16);
  g.font = `500 30px ${MONO}`;
  g.fillStyle = C_BONE;
  g.textBaseline = 'middle';
  let y = 74;
  for (const line of wrap(g, page.title || page.file, CW - 80)) {
    g.direction = rtl(line) ? 'rtl' : 'ltr';
    g.textAlign = rtl(line) ? 'right' : 'left';
    g.fillText(line, rtl(line) ? CW - 40 : 40, y);
    y += 40;
    if (y > CH - 110) break;
  }
  g.font = `300 24px ${MONO}`;
  g.fillStyle = C_DIM;
  g.textAlign = 'left'; g.direction = 'ltr';
  g.fillText(page.file, 40, CH - 74);
  g.fillText(`${Math.round((page.bytes || 0) / 1024)} kB · walk up to it to load the page`, 40, CH - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * (CH / CW)),
                              new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.userData.tex = tex;
  return mesh;
}


/* -----------------------------------------------------------------------------
   THE LOGO on the entrance wall. A real image from /api/project/asset when the
   project has one; a lettered plate when it has not, which says so.
   -------------------------------------------------------------------------- */
function logoPlate(spec, nodes) {
  const w = 3.2;
  if (spec.logoUrl) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.96, color: 0xffffff });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w), mat);
    /* Loaded, not assumed: a project whose favicon has moved gets the lettered
       plate instead of a white square, and the load error is swallowed here
       rather than printed as a console error the room did not cause. */
    new THREE.TextureLoader().load(spec.logoUrl, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      mat.map = t; mat.needsUpdate = true;
      mesh.userData.tex = t;
    }, undefined, () => { mesh.visible = false; });
    mesh.position.set(0, 5.6, HALL_Z0 + 0.30);
    return mesh;
  }
  const p = plaque(spec.name, 'this project publishes no logo — /api/project/meta returned none',
                   { w, gold: true, ratio: 0.5 });
  p.position.set(0, 5.6, HALL_Z0 + 0.30);
  return p;
}


/* -----------------------------------------------------------------------------
   ENTER. Builds the whole building, then hands the lens to the fly-in.
   `spec` is assembled by world.js from /api/world and /api/project/meta — see
   enterLandmark() there. Nothing in it is computed here.
   -------------------------------------------------------------------------- */
export async function enterHall(spec) {
  if (phase !== 'out' || !spec) return false;
  mode = 'hall'; subject = spec;
  beginFly(spec);

  const dress = spec.form === 'pageWing' ? HALL_WING : (HALL_DRESS[spec.form] || HALL_PLAIN);
  const pages = (spec.pages || []).slice(0, 24);
  const n = Math.max(1, pages.length);

  const group = new THREE.Group();
  const E = hallEmitter();
  const shellOut = hallShell(E, n, dress);
  (HALL_BODY[dress.body] || HALL_BODY.plain)(E, {
    sessions: spec.sessions || 1,
    agents: (spec.agents || []).length,
    pages: pages.length,
  });

  /* THE STATIONS, and the screen pose each one hands back. */
  const stations = [];
  const build = HALL_STATION[dress.station] || HALL_STATION.door;
  shellOut.cells.forEach((c, i) => {
    const page = pages[i] || { file: '(no page)', title: spec.name, bytes: 0 };
    const pose = build(E, c, page);
    stations.push({ cell: c, page, pose });
  });

  const mats = hallMaterials();
  const meshes = buildHallMesh(E, mats, group);

  /* THE TYPE. Everything with words on it is its own small plane: a canvas
     texture cannot be merged into a shared buffer, and there are only a few
     dozen of them. */
  const nodes = [];
  const add = (m) => { group.add(m); nodes.push(m); };

  /* The address by the door, at eye height, in the same words the world's
     caption uses — so a person who read the caption outside recognises the
     building they walked into. */
  const addr = plaque(spec.name,
    `${spec.path}\n${dress.words}\n` +
    (spec.tradeType ? `${spec.tradeType}, read from its ${spec.tradeSource || 'project'}` : 'no trade type') +
    `\n${pages.length} page${pages.length === 1 ? '' : 's'} on its site · ` +
    `${spec.sessions || 0} session${spec.sessions === 1 ? '' : 's'}`,
    { w: 4.4, gold: true, ratio: 0.46 });
  addr.position.set(HALL_W / 2 - 0.10, 2.1, HALL_Z0 + 5.0);
  addr.rotation.y = -Math.PI / 2;
  add(addr);

  add(logoPlate(spec, nodes));

  /* The studio's own mark on the reception wall — only in a glass office, which
     is the form ProfessionalService is built as, and only because the brief
     names it. Every other trade's entrance wall carries its logo and nothing
     else. */
  if (dress.body === 'office') {
    const w = plaque('W', 'Wild Digital Moments', { w: 2.2, ratio: 0.62, gold: true, serif: true });
    w.position.set(0, 3.3, HALL_D / 2 - 0.10);
    w.rotation.y = Math.PI;
    add(w);
  }

  /* THE CORKBOARD by the door: what is still open in this project, verbatim.
     Six of them, and the count of the rest — the same six the world's caption
     shows, for the same reason: a wall of forty is a wall nobody reads. */
  const open = spec.openItems || [];
  /* A trade landmark's board is its open items, so "still open" names it. A
     plain room's board carries that structure's own caption instead, and calling
     a note's word count "still open" would be a lie on a wall — so the caller
     may name the board. */
  const board = plaque(spec.boardTitle || (open.length ? 'still open' : 'nothing open'),
    open.length
      ? open.slice(0, 6).map(s => '· ' + s).join('\n') +
        (open.length > 6 ? `\n+${open.length - 6} more still open` : '')
      : 'no open item in this project — /api/world open_items is empty',
    { w: 4.6, ratio: 0.62 });
  /* HUNG IN THE ROOM, not flat on the side wall by the door. The lens here is
     30 mm on a 16:9 frame — 23 degrees off the axis, either side — so a board
     bolted to a wall 10 m to the left of a reader standing 2 m inside the door
     is not "at the edge of the frame", it is off it entirely, and the one
     capture that caught it at all (a MusicSchool-trade town's interior shot)
     caught it cut in half. Suspended over the left-hand aisle two thirds of the
     way down, turned to face the door, it sits 15 degrees off the axis with its
     whole width inside the frame from the moment the reader walks in — and it
     is still a thing hanging in the room rather than a HUD panel. */
  board.position.set(-6.6, 4.4, HALL_Z0 + 26.0);
  board.rotation.y = Math.PI - 0.27;        // square-on to somebody at the door
  add(board);

  /* One dark screen per station, carrying its page's own title. */
  for (const s of stations) {
    const scr = screenPanel(s.page, s.pose.w);
    scr.position.set(s.pose.x, s.pose.y, s.pose.z);
    scr.rotation.y = s.pose.yaw;
    add(scr);
    s.screen = scr;
    /* And the plaque on the door frame — a room is found by its plaque, which
       is the whole reason a corridor of identical doors is navigable. */
    /* GOLD, and the title as the title rather than as body text: in a corridor
       lit by one walking lamp the plaque's dim grey body copy was unreadable at
       the distance a person actually stands to read a door. */
    const pl = plaque(clipTitle(s.page.title || s.page.file), null,
                      { w: 1.9, ratio: 0.34, gold: true });
    /* Clear of the jamb (which stands 0.22 deep on this same wall) and beside
       the opening rather than over it: a plaque a door frame passes through is
       a plaque nobody can read. */
    pl.position.set(CELL_X1 + 0.34, 1.95, s.cell.zc - 1.5);
    pl.rotation.y = Math.PI / 2;
    add(pl);
  }

  /* THE LIVE AGENTS, as drones over the station whose page their own last_path
     names — and over the middle of the hall when it names something else. */
  const agentNodes = [];
  for (const a of (spec.agents || [])) {
    const st = stationForPath(stations, a.last_path);
    const d = new THREE.Group();
    const body = new THREE.Mesh(echoGeo, new THREE.MeshBasicMaterial({ color: C_GOLD }));
    body.scale.setScalar(2.2);
    d.add(body);
    /* The task tag as a TITLE and in gold, not as body copy: dim grey on a
       transparent plate is unreadable at the distance a drone hovers. */
    const tag = plaque(a.label || a.id || 'agent', null,
                       { w: 3.0, ratio: 0.22, gold: true, bare: true });
    tag.position.y = 0.62;
    d.add(tag);
    /* Over its own station when its last_path names one; over its own DESK in a
       glass office, which is the one form that builds a desk per agent; over the
       middle of the room otherwise. Never invented: an agent whose last_path
       this project cannot place is shown as being in the building and nowhere
       more precise than that. */
    const deskI = agentNodes.length;
    if (st) d.position.set((CELL_X0 + CELL_X1) / 2, CELL_H - 0.9, st.cell.zc);
    else if (dress.body === 'office' && deskI < 6) d.position.set(2.4, 1.75, 10.0 - deskI * 3.2);
    else d.position.set(0, 6.2, 0);
    d.userData.station = st || null;
    add(d);
    agentNodes.push(d);
    if (st) st.live = true;
  }

  /* THE NOTES RISING in a room somebody is working in. Only a live station gets
     them, only one glyph texture is made, and the whole effect is one Points
     object — so an idle building is a still building, which is the rule the
     world's chimneys and cranes already follow. */
  const liveCells = stations.filter(s => s.live);
  const glyph = LIVE_GLYPH[dress.body];
  let notes = null;
  if (liveCells.length && glyph) {
    notes = makeNoteParticles(liveCells, glyph);
    add(notes);
  }

  /* THE LIGHT. Four sources for a whole building: two warm lamps in the hall, a
     third that rides down the aisle with the player, and a hemisphere floor so
     nothing is ever pure black. A light per room would be twenty-five, and
     twenty-five lights is a shader recompile on this machine. */
  /* Candela, divided by the distance squared — three's lights have been in
     physical units since r155. The first capture ran these at 620/520/190 and
     came back with the whole stage end blown to white and the practice room a
     sheet of paper with a page floating on it: at 620 a wall five metres away
     takes 25 units of irradiance before the environment map has added anything.
     These are the numbers the second capture was read at. */
  const lampA = new THREE.PointLight(0xffc27a, 210, 30, 2);
  lampA.position.set(0, HALL_H - 1.6, -6);
  const lampB = new THREE.PointLight(0xffa860, 230, 32, 2);
  lampB.position.set(0, HALL_H - 2.2, 9);
  /* The lamp that walks with the reader. Weak and BEHIND his eye, not over his
     head: a light at the ceiling of a 3.7 m practice room washes the far wall
     the page is hanging on, which is the one surface in the room that has to
     hold its own contrast. */
  const follow = new THREE.PointLight(0xffc98a, 74, 14, 2);
  const hemi = new THREE.HemisphereLight(0x6d5c46, 0x14110e, 0.55);
  /* A fifth light ONLY where there is something outside to light: the factory's
     yard, whose flywheel is the one object in this grammar that stands beyond
     the building's own wall. */
  if (dress.body === 'factory') {
    const yard = new THREE.PointLight(0xffb87a, 460, 40, 2);
    yard.position.set(3.6, 6.6, 24.5);
    group.add(yard);
  }
  group.add(lampA, lampB, follow, hemi);
  /* The bulbs, so the light in the room has somewhere to come from. */
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  for (const p of [lampA, lampB]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), bulbMat);
    b.position.copy(p.position);
    add(b);
  }

  scene.add(group);
  hall = { spec, dress, group, meshes, nodes, mats, stations, notes, follow, agentNodes,
           regions: shellOut.regions, active: null, pageStation: null };

  placePlayerAtHallDoor();
  setHud(`${spec.name} — ${dress.words.split('—')[0].trim()} · ${pages.length} page${pages.length === 1 ? '' : 's'}`);
  return true;
}

/* A page's own file against an agent's last_path. The path is absolute and
   platform-shaped; the page's file is relative to the project root, so the
   test is a suffix match on forward slashes and nothing cleverer. */
function stationForPath(stations, p) {
  if (!p) return null;
  const norm = String(p).replace(/\\/g, '/');
  for (const s of stations) {
    const f = s.page.file;
    if (f && f !== '(no page)' && (norm.endsWith('/' + f) || norm === f)) return s;
  }
  return null;
}

const clipTitle = (t) => {
  const s = String(t || '').replace(/\s*[|·—-]\s*Wild Digital Moments\s*$/i, '');
  return s.length > 58 ? s.slice(0, 57) + '…' : s;
};

/* -----------------------------------------------------------------------------
   MUSICAL NOTES over a room that has an agent in it. One Points object, one
   small glyph texture, ten particles per live room — and they exist only while
   a live agent's last_path names that room's page.
   -------------------------------------------------------------------------- */
const NOTES_PER_CELL = 10;
/* What rises in a station somebody is working in, by trade. A music school gets
   notes, a factory gets sparks, a kitchen gets steam — and everything else gets
   nothing at all, because a glyph that does not mean anything is decoration. */
const LIVE_GLYPH = {
  stage:     { ch: '♪', color: '#ffe4a8', size: 0.34, rise: 0.42 },
  classroom: { ch: '♪', color: '#ffe4a8', size: 0.34, rise: 0.42 },
  factory:   { ch: '•', color: '#ff9a4e', size: 0.20, rise: 1.10 },
  dining:    { ch: '●', color: '#cfd6dc', size: 0.52, rise: 0.30 },
};
const noteTexes = new Map();
function noteTexture(spec) {
  if (noteTexes.has(spec.ch)) return noteTexes.get(spec.ch);
  const c = panelCanvas(64, 64);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = spec.color;
  g.font = '52px ' + SERIF;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(spec.ch, 32, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  noteTexes.set(spec.ch, t);
  return t;
}

function makeNoteParticles(cells, glyph) {
  const n = cells.length * NOTES_PER_CELL;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  cells.forEach((s, ci) => {
    for (let i = 0; i < NOTES_PER_CELL; i++) {
      const k = ci * NOTES_PER_CELL + i;
      pos[k * 3] = (CELL_X0 + CELL_X1) / 2 + (Math.sin(k * 12.9898) * 1.7);
      pos[k * 3 + 1] = 0.6;
      pos[k * 3 + 2] = s.cell.zc + (Math.cos(k * 78.233) * 1.2);
      seed[k] = (k % NOTES_PER_CELL) / NOTES_PER_CELL;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.PointsMaterial({
    map: noteTexture(glyph), size: glyph.size, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(g, m);
  pts.userData.base = pos.slice();
  pts.userData.rise = glyph.rise;
  pts.frustumCulled = false;
  return pts;
}

function stepNotes(t) {
  if (!hall || !hall.notes) return;
  const p = hall.notes.geometry.attributes.position;
  const s = hall.notes.geometry.attributes.aSeed;
  const base = hall.notes.userData.base;
  for (let i = 0; i < p.count; i++) {
    const rise = ((t * hall.notes.userData.rise + s.array[i]) % 1);
    p.array[i * 3 + 1] = 0.6 + rise * (CELL_H - 1.1);
    p.array[i * 3] = base[i * 3] + Math.sin(t * 1.4 + i) * 0.22;
  }
  p.needsUpdate = true;
}


/* -----------------------------------------------------------------------------
   MATERIALS. The world's own PBR pack, through the host — so a wall indoors is
   the same sandstone as a wall outdoors and the two views cannot disagree about
   what this world is built of. The four that are not in the pack (glass, a lit
   lamp face, a seat, painted steel) are made here and named for what they are.
   -------------------------------------------------------------------------- */

function hallMaterials() {
  /* No host material — a page that attaches this module without the world's
     texture pack. Plain matte surfaces in the same colours, so the hall is
     readable rather than absent, and probe() reports which of the two it is. */
  const H = host.hallMaterial ||
    ((surface, tint) => new THREE.MeshStandardMaterial({ color: tint || 0x8a7f6d, roughness: 0.95 }));
  return {
    /* Tinted DOWN, hard. The first capture ran these at 0xbfae95/0xc0b199/
       0xd8cbb2 and the hall came back as white card: makeTriplanarMaterial
       multiplies the pack's own diffuse by 1.3 before the tint, and indoors
       there is no sky to be darker than. */
    wall:   H('plaster',  0x736853),
    floor:  H('cobble',   0x4a443c),
    ceil:   H('plaster',  0x4c443a),
    stone:  H('brick',    0x7f7460),
    plaster: H('plaster', 0x8b8069),
    /* The four the pack has no map for, named for what they are rather than
       dressed up as PBR they are not. */
    dark:   new THREE.MeshStandardMaterial({ color: 0x241f1a, roughness: 0.72, metalness: 0.10 }),
    steel:  new THREE.MeshStandardMaterial({ color: 0x6a6f75, roughness: 0.44, metalness: 0.72 }),
    seat:   new THREE.MeshStandardMaterial({ color: 0x5c2b28, roughness: 0.88 }),
    /* Brass, for a cymbal and a trumpet bell. Painted steel read as a grey
       dinner plate in the first practice-room capture. */
    brass:  new THREE.MeshStandardMaterial({ color: 0xa8823a, roughness: 0.30, metalness: 0.85 }),
    /* Glass, and the lit face of a lamp. Both take the bloom pass the world
       already runs, which is what makes a window at dusk read as a window. */
    glass:  new THREE.MeshStandardMaterial({ color: 0xa8c8dc, roughness: 0.08, metalness: 0.0,
                                             transparent: true, opacity: 0.28,
                                             side: THREE.DoubleSide }),
    lamp:   new THREE.MeshBasicMaterial({ color: 0xffe0aa }),
  };
}


/* -----------------------------------------------------------------------------
   THE PLAYER, INSIDE A HALL. The collision model is the rectangle list
   hallShell() wrote down: a position is legal if it is inside one of them, and
   the doorways are rectangles too, so walking from the hall into the aisle and
   from the aisle into a practice room needs no special case at all.

   Separated axes, not a single test: moving x and z independently is what lets
   the player SLIDE along a wall instead of sticking to it, and a corridor of
   twenty-four doors is unwalkable without it.
   -------------------------------------------------------------------------- */
function placePlayerAtHallDoor() {
  /* A WING starts in its own bay, three metres off the framed page and facing
     it, because a wing has exactly one page and walking a reader down an empty
     aisle to find it is the "cannot be entered" complaint in a different shape. */
  if (hall && hall.dress.wing && hall.stations.length) {
    const st = hall.stations[0];
    player.pos.set(st.pose.x + 3.4, HALL_EYE, st.pose.z);
    /* +pi/2, and the sign is the whole thing: the walker's forward is
       (-sin yaw, 0, -cos yaw), so yaw -pi/2 points at +x and stands the reader
       with his back to the page. The first wing capture is the aisle. */
    player.yaw = Math.PI / 2;
    player.pitch = -0.02;
    player.floor = 0;
    return;
  }
  player.pos.set(0, HALL_EYE, HALL_Z0 + 2.2);
  player.yaw = Math.PI;          // yaw pi looks toward +z, which is the stage
  player.pitch = -0.02;
  player.floor = 0;
}

/* Which room the point is in, if any — with the shoulder taken off every wall
   so the walker's own width is what stops him rather than his eye. */
function hallRegionAt(x, z, s) {
  return hall ? regionAt(hall.regions, x, z, s) : null;
}

function stepHall(dt) {
  walkKeys(dt);
  const S = HALL_SHOULDER;
  /* THE DOOR OUT is the one place a legal position is outside every rectangle:
     inside the entrance's own width, below its lintel, and past the wall. */
  const nz0 = player.pos.z + _move.z;
  if (nz0 < HALL_Z0 + S && Math.abs(player.pos.x) < HALL_DOOR_W / 2 - 0.2 &&
      player.pos.y < HALL_DOOR_H) { leave(); return; }

  const nx = player.pos.x + _move.x;
  if (hallRegionAt(nx, player.pos.z, S)) player.pos.x = nx;
  const nz = player.pos.z + _move.z;
  if (hallRegionAt(player.pos.x, nz, S)) player.pos.z = nz;

  const here = hallRegionAt(player.pos.x, player.pos.z, S * 0.5);
  const top = here ? here.top : HALL_H - 0.5;
  player.pos.y = Math.max(0.55, Math.min(top, player.pos.y + _move.y));
}


/* -----------------------------------------------------------------------------
   THE ONE PAGE THAT IS LOADED. A station's screen carries its page's title
   until the walker is standing in front of it; then that ONE station gets the
   real page, in the CSS3D layer, and any other station that had it gives it
   back. One live document, because a live document under a 3D transform is a
   compositing layer the browser re-blends over the whole canvas every frame —
   the cost RUNBOOK's PAGE-WINDOW-DOC measured at eight to ten frames a second.
   -------------------------------------------------------------------------- */
const HALL_PAGE_NEAR = 7.0;        // metres: about the depth of one station
let hallPageToken = 0;

function syncHallStation() {
  if (!hall || phase !== 'inside') return;
  let best = null, bestD = HALL_PAGE_NEAR;
  for (const s of hall.stations) {
    const d = Math.hypot(s.pose.x - player.pos.x, s.pose.z - player.pos.z);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best === hall.pageStation) return;
  hall.pageStation = best;
  const token = ++hallPageToken;
  /* The old window goes first, always: two iframes alive for even one frame is
     two documents laid out over the canvas, which is the cost this avoids. */
  if (pageObj) { scene.remove(pageObj); pageObj.element.remove(); pageObj = null; }
  pageAnchor = null;
  for (const s of hall.stations) s.screen.visible = true;
  if (!best || !best.page.file || best.page.file === '(no page)') return;
  rawPageUrl(best.page.file).then(url => {
    /* The walk does not wait for the network. If the reader left the station
       while the probe was in flight, the answer is dropped rather than hung on
       a wall he is no longer standing at. */
    if (token !== hallPageToken || !url || !hall) return;
    const dir = best.page.file.includes('/')
      ? best.page.file.slice(0, best.page.file.lastIndexOf('/')) : '';
    pageObj = pageWindow(url, dir);
    pageObj.scale.setScalar(best.pose.w / PAGE_PX_W);
    pageObj.position.set(best.pose.x + 0.04, best.pose.y, best.pose.z);
    pageObj.rotation.y = best.pose.yaw;
    pageAnchor = { x: best.pose.x, y: best.pose.y, z: best.pose.z,
                   yaw: best.pose.yaw, floor: 0, near: HALL_PAGE_NEAR };
    scene.add(pageObj);
    /* The dark screen behind a live page is a second copy of the same title,
       showing through the page's own margins. */
    best.screen.visible = false;
    best.loaded = true;
    syncPageWindow();
    setHud(`${hall.spec.name} · ${clipTitle(best.page.title || best.page.file)}` +
           (url.native ? ' — the page, from /api/project/tree'
                       : ' — the page, from /api/project/file?raw=1'));
  });
}


/* -----------------------------------------------------------------------------
   THE FRAME, INSIDE A HALL.
   -------------------------------------------------------------------------- */
function updateHall(dt, t) {
  stepHall(dt);
  syncHallStation();
  /* The lamp that walks with you. Two fixed lamps light the hall; the aisle and
     the rooms are lit by this one, which is cheaper than a light per room by
     twenty-four lights and one shader recompile. */
  hall.follow.position.set(player.pos.x, player.pos.y + 0.5, player.pos.z);
  stepNotes(t);
  /* The drones bob over the station their agent's last_path names, and their
     tags turn to face the reader — a task tag edge-on is not a tag. */
  for (const d of hall.agentNodes) {
    d.position.y += Math.sin(t * 1.6 + d.position.z) * 0.004;
    d.rotation.y += dt * 0.6;
    const tag = d.children[1];
    if (tag) {
      tag.rotation.y = -d.rotation.y + Math.atan2(player.pos.x - d.position.x,
                                                  player.pos.z - d.position.z);
    }
  }
}

function clearHall() {
  if (!hall) return;
  scene.remove(hall.group);
  for (const m of hall.meshes) { m.geometry.dispose(); }
  for (const n of hall.nodes) disposePanel(n);
  for (const d of hall.agentNodes) for (const c of d.children) disposePanel(c);
  for (const k in hall.mats) { const m = hall.mats[k]; if (m && m.dispose) m.dispose(); }
  if (hall.notes) { hall.notes.geometry.dispose(); hall.notes.material.dispose(); }
  hall = null;
}


/* =============================================================================
   THREE MORE INSIDES — a note's own room, a bridge's deck, a lighthouse tower

   The navigation pass closed with three structures that opened the PLAIN hall
   and a caption board instead of themselves (HANDOFF, "What still cannot be
   entered"). All three are built here, out of the same emitter, the same merge
   and the same material table the hall already uses — what differs is the
   shell, the walk, and for the two OUTDOOR forms which scene is the picture.

   WHY TWO OF THEM ARE DRAWN OVER THE WORLD. A bridge deck is only worth
   standing on if the river is under it and the neighbouring days are up and
   downstream; a lighthouse gallery is only worth climbing to if the sea and the
   harbour are out of the window. Neither is something this module can build, and
   faking either would be the invention the whole file refuses. So `deck` and
   `tower` are drawn ON TOP of the world rather than instead of it: world.js
   renders its own scene through the composer with THIS camera, clears the depth
   buffer and draws this scene over it. Two consequences, and both are load
   bearing — everything in these two forms is placed in WORLD metres, and the
   sky dome this module carries is switched off, because the world already has
   one and two domes is two suns.
   ========================================================================== */

/* --- the note gallery ----------------------------------------------------- */
/* 5.6 m wall to wall, and that is the LEGIBILITY number rather than a taste
   call: the panels hang on the two side walls, so the width is twice the
   reading distance of somebody walking down the middle. At 5.6 a reader on the
   centre line is 3.1 m off a panel and its glyphs measure 17 px on a 900-px
   frame; at the hall's 20 m they would measure 4. */
const NOTE_W = 5.6, NOTE_H = 4.6;
const NOTE_BAY = 5.2;                 // one bay carries two panels, one a side
const NOTE_DOOR_W = 2.4, NOTE_DOOR_H = 2.7;
/* 18 rows of 66 columns, against the source wall's 22 x 96. A note is PROSE and
   a prose line is read at a bigger glyph than a line of code — the same panel
   at 18 rows is 0.071 m of glyph against 0.058, which is what puts a note above
   the 14-px floor from the middle of the room instead of only up against it. */
/* 92 columns, not 66: the plate's canvas is 1800 px wide and eighteen rows put
   the glyph at 28 px, so about 108 columns fit. Wrapping at 66 left a third of
   every plate empty — the first gallery capture is text down the left of a black
   sheet. The COLUMN count is what fills the plate; the ROW count is what sets
   the glyph size, and those two are the only two numbers in here. */
const NOTE_ROWS = 18, NOTE_COLS = 92;
/* THE READING STAND on a bridge and in a lamp room is the same page at a third
   of the size, so it takes a third of the rows and, because the canvas is the
   same, less than half the columns: 8 x 42 puts a 1.15 m plate at 19 px on the
   frame from the 1.55 m a walker at the end of the bay stands at. Eighteen rows
   on a plate that small measured 8.9, which is under the floor. */
const STAND_ROWS = 8, STAND_COLS = 42;
const NOTE_PANEL_W = 4.6;
/* Twenty-four panels is 432 rows, about 3,000 words — longer than every note in
   this vault. Past it the last panel says how much is left and `O` opens the
   note in Obsidian, which is the honest end of a wall. */
const NOTE_MAX_PANELS = 24;
const NOTE_WARM_MS = 1600;            // how long a re-fetched wall stays warm

/* --- the bridge deck ------------------------------------------------------ */
const DECK_EYE = 1.68;
/* 2.05 m across the deck. The plate is read from about 1.7 m — a walker at the
   end of the bay — and at 1.9 that measured 13.3 px on the frame, under the
   14 the source walls are held to. Width is the only lever: the row count is
   what makes it the same page the gallery hangs. */
const DECK_STAND_W = 1.15;

/* --- the lighthouse ------------------------------------------------------- */
const TOWER_R = 3.1;                  // inside face of the tower wall
const TOWER_SHAFT = 0.95;             // the central shaft the stair winds round
const TOWER_LAMP_Y = 13.0;            // the lamp-room floor
const TOWER_TURNS = 4;                // turns of stair between the door and it
const TOWER_STEPS = 16 * TOWER_TURNS; // treads
const TOWER_GALLERY = 1.15;           // how far the balcony stands out from the wall
const TOWER_STAND_W = 1.15;           // the lectern's plate, same as the bridge's

/* One at a time, like every other interior: `room` is whichever of the three is
   standing, and `mode` says which. */
let room = null;

/* THE LENS, FOR AN OUTDOOR FORM. attach() cuts this camera for a room — 0.08 to
   400 — and on a bridge deck the far shore is 900 m away and the far plane takes
   the island off at 400. Widened on the way in and put back on the way out; the
   near plane goes with it, because 0.08 against 5,000 is a depth ratio that
   z-fights the terrain and there is nothing within 25 cm of a reader out here. */
const OUT_NEAR = 0.25, OUT_FAR = 5000;
function outdoorLens(on) {
  camera.near = on ? OUT_NEAR : 0.08;
  camera.far = on ? OUT_FAR : 400;
  camera.updateProjectionMatrix();
}

/* True while the world behind is still the picture and this scene is only the
   layer over it. world.js reads it once a frame — see frame() there. */
export const overlay = () => phase !== 'out' && (mode === 'deck' || mode === 'tower');


/* -----------------------------------------------------------------------------
   THE NOTE'S OWN TEXT — GET /api/vault/note?id=<note id>
   Contract, exactly:
     GET /api/vault/note?id=<id>   200 text/plain  the note's markdown verbatim
                                   404 / 403       there is no text to show
   A non-200 is a FACT about the note, not an error to retry: world.js falls
   back to the caption board it has always shown, which is what the navigation
   pass shipped and what this replaces only when there is something better.
   Nothing is cached — the live re-fetch below exists precisely to get a newer
   answer out of the same URL.
   -------------------------------------------------------------------------- */
async function fetchNote(id) {
  if (!id) return null;
  try {
    const r = await fetch('/api/vault/note?id=' + encodeURIComponent(id), { cache: 'no-store' });
    if (!r.ok) return null;
    const t = await r.text();
    return t.length ? t : null;
  } catch (_) { return null; }
}

/* Markdown -> the rows a panel draws, one row per printed line. Headings keep
   their level (the panel sets them larger); everything else is body. Wrapping
   is by WORD at the column count, and a wikilink's own spaces are turned into
   non-breaking ones first so `[[a long note]]` can never be split across two
   rows — a half-drawn link would be gold on one line and bone on the next. */
const WIKILINK = /\[\[([^\][]+)\]\]/g;
function noteRows(md, cols0) {
  const out = [];
  for (const raw of String(md).replace(/\r/g, '').split('\n')) {
    const h = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(raw);
    const level = h ? h[2].length : 0;
    const body = (h ? h[3] : raw).replace(WIKILINK, s => s.replace(/ /g, '\u00a0'));
    const indent = h ? '' : (/^\s*/.exec(raw)[0]).slice(0, 8).replace(/\t/g, '  ');
    if (!body.trim()) { out.push({ text: '', level: 0 }); continue; }
    /* A heading is set about a third larger, so a third fewer columns fit on
       the same panel — wrapping it at the body width would overrun the plate. */
    const wide = cols0 || NOTE_COLS;
    const cols = level ? Math.round(wide * 0.7) : wide;
    let line = indent;
    /* SPACE AND TAB, not \s: JavaScript's \s matches U+00A0 as well, so a
       wikilink protected two lines up would be split apart again right here. */
    for (const w of body.trim().split(/[ \t]+/)) {
      const t = line.trim() ? line + ' ' + w : line + w;
      if (t.length > cols && line.trim()) { out.push({ text: line, level }); line = indent + '  ' + w; }
      else line = t;
    }
    out.push({ text: line, level });
  }
  return out;
}

/* One run of text, with every `[[wikilink]]` in gold. Drawn as segments and
   advanced by measureText, because canvas has no rich text and a link that is
   only a different colour has to be a second fillText at the right pen. */
function drawWiki(g, text, x, y, colour) {
  g.textAlign = 'left';
  let pen = x, last = 0, m;
  WIKILINK.lastIndex = 0;
  while ((m = WIKILINK.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) { g.fillStyle = colour; g.fillText(before, pen, y); pen += g.measureText(before).width; }
    /* `[[id|shown]]` shows the second half, which is what Obsidian shows. */
    const shown = m[1].split('|').pop();
    g.fillStyle = C_GOLD_CSS; g.fillText(shown, pen, y); pen += g.measureText(shown).width;
    last = m.index + m[0].length;
  }
  const tail = text.slice(last);
  if (tail) { g.fillStyle = colour; g.fillText(tail, pen, y); }
}

/* One page of the note, on one plate. Same construction as sourcePanel() — one
   opaque canvas, one CanvasTexture, one MeshBasicMaterial — and the same reason
   for every part of it; what changes is that this is prose, so there are no
   line numbers, the headings are larger and the links are gold. */
function notePanel(rows, from, pageNo, pages, w, nrows0) {
  const nrows = nrows0 || NOTE_ROWS;
  const CH = 750, CW = Math.round(CH * PANEL_ASPECT);
  const c = panelCanvas(CW, CH);
  const g = c.getContext('2d');
  g.fillStyle = '#0e0c0a';
  g.fillRect(0, 0, CW, CH);
  const FOOT = 54;                                  // the page number's own strip
  const rowH = (CH - FOOT) / nrows;
  const base = Math.floor(rowH * GLYPH_FRAC);
  g.textBaseline = 'middle';
  for (let i = 0; i < nrows; i++) {
    const r = rows[from + i];
    if (!r) break;
    const y = rowH * (i + 0.5);
    const scale = r.level === 1 ? 1.42 : r.level === 2 ? 1.26 : r.level ? 1.12 : 1;
    g.font = `${r.level ? 600 : 400} ${Math.round(base * scale)}px ${MONO}`;
    drawWiki(g, r.text, 40, y, r.level ? '#f4ead2' : C_BONE);
  }
  g.font = `400 ${Math.round(base * 0.78)}px ${MONO}`;
  g.fillStyle = C_DIM;
  g.textAlign = 'right';
  g.fillText(`${pageNo} / ${pages}`, CW - 40, CH - FOOT / 2);
  if (pageNo === pages && from + nrows < rows.length) {
    g.textAlign = 'left';
    g.fillText(`+${rows.length - from - nrows} more lines — press O to open it in Obsidian`,
               40, CH - FOOT / 2);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w / PANEL_ASPECT),
                              new THREE.MeshBasicMaterial({ map: tex }));
  mesh.userData.tex = tex;
  mesh.userData.rows = nrows;           // roomGlyphPx() solves the glyph from this
  return mesh;
}

/* A LECTERN, and the page on it. Both callers — the bridge's reading stand and
   the lighthouse's — want the same object: a post, a raked backing plate and the
   note's own plate on top of it, all facing the reader.

   IT IS A GROUP, and that is the whole reason this is a function. The rake and
   the yaw do not commute, and every attempt to write the two as an Euler put
   one of them about the wrong axis: the first bridge capture had the page raked
   toward the walker and the board it sits on raked ACROSS the deck, the two
   crossing in mid-air. Inside the group there is only the rake; the group's own
   `rotation.y` is the yaw, and there is no order left to get wrong. The caller
   turns the group; in the group's own frame the reader is at +z.

   `meshes` takes the props (geometry disposed, materials shared and disposed
   once with the table) and `nodes` takes the plate (its own canvas texture). */
function readingStand(mats, plate, w, meshes, nodes) {
  const RAKE = -1.02;                  // 58 degrees off vertical: a lectern's own
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.98, 0.46), mats.stone);
  post.position.y = 0.49;
  g.add(post); meshes.push(post);
  const h = w / PANEL_ASPECT;
  const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.10, 0.06), mats.dark);
  board.position.set(0, 1.06, 0);
  board.rotation.x = RAKE;
  g.add(board); meshes.push(board);
  /* translateZ AFTER the rake, not a z in the position: `position` is in the
     GROUP's axes and the board's front face is 3 cm out along its own RAKED
     normal, so a 4 cm z offset only clears 4 x sin(rake) = 2 cm of it and the
     page ends up inside the board it is lying on. The first capture of the
     stand is the tan back of the board with no page on it at all. */
  plate.position.set(0, 1.06, 0);
  plate.rotation.x = RAKE;
  plate.translateZ(0.05);
  g.add(plate); nodes.push(plate);
  return g;
}

/* The gallery: a corridor as long as the note is, a door at the near end and a
   panel on alternating walls down it. Growing the ROOM rather than stacking
   pages on one wall is what makes a note of any length readable at one glyph
   size — the alternative is a wall of 6-px type or a note that stops halfway. */
function noteShell(E, bays) {
  const D = 6.4 + bays * NOTE_BAY;
  const z0 = -D / 2, z1 = D / 2;
  E.box('floor', 0, -0.3, 0, NOTE_W + WALL_T * 2, 0.3, D + WALL_T * 2);
  E.box('ceil', 0, NOTE_H, 0, NOTE_W + WALL_T * 2, WALL_T, D + WALL_T * 2);
  E.wallGap('wall', 0, z0 - WALL_T / 2, NOTE_W, NOTE_H, WALL_T, 0, NOTE_DOOR_W, NOTE_DOOR_H, 'x');
  E.box('wall', 0, 0, z1 + WALL_T / 2, NOTE_W + WALL_T * 2, NOTE_H, WALL_T);
  E.box('wall', -NOTE_W / 2 - WALL_T / 2, 0, 0, WALL_T, NOTE_H, D + WALL_T * 2);
  E.box('wall', NOTE_W / 2 + WALL_T / 2, 0, 0, WALL_T, NOTE_H, D + WALL_T * 2);
  /* A strip light over every bay, so the panel below it is the brightest thing
     in its own stretch of the room and the corridor reads as a gallery. */
  for (let z = z0 + 3.2; z < z1; z += NOTE_BAY / 2) {
    E.box('lamp', 0, NOTE_H - 0.16, z, 1.8, 0.10, 0.34);
  }
  return { regions: [{ x0: -NOTE_W / 2, x1: NOTE_W / 2, z0, z1, top: NOTE_H - 0.5 }], z0, z1 };
}

/* Where panel `i` hangs. Left wall first, then right, then one bay further in —
   so reading order is the order you walk, and the page number on each plate
   says so out loud for anyone who reads them out of order anyway. */
function notePanelPose(i, z0) {
  const side = (i % 2) ? 1 : -1;                  // -1 is the left wall going in
  const bay = Math.floor(i / 2);
  return { x: side * (NOTE_W / 2 - 0.09), y: 2.05, z: z0 + 4.6 + bay * NOTE_BAY,
           yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/* A NOTE. The markdown on the walls, the title in serif over the door, the
   vault's own numbers on a plaque at the far end, and `O` (world.js's key) for
   the note itself in Obsidian. Returns false when there is no text — world.js
   then opens the caption board it has always opened, unchanged. */
export async function enterNote(spec) {
  if (phase !== 'out' || !spec || !spec.noteId) return false;
  /* THE FETCH IS FIRST, before anything is built and before the fly-in starts:
     a room half-built round a 404 would have to be torn down again, and the
     fallback has to be indistinguishable from never having tried. */
  const md = await fetchNote(spec.noteId);
  if (md == null) return false;

  mode = 'note'; subject = spec;
  beginFly(spec);

  const rows = noteRows(md);
  const pages = Math.max(1, Math.min(NOTE_MAX_PANELS, Math.ceil(rows.length / NOTE_ROWS)));
  const bays = Math.ceil(pages / 2);

  const group = new THREE.Group();
  const E = hallEmitter();
  const out = noteShell(E, bays);
  const mats = hallMaterials();
  const meshes = buildHallMesh(E, mats, group);

  const nodes = [];
  const add = (m) => { group.add(m); nodes.push(m); };
  const panels = [];
  for (let i = 0; i < pages; i++) {
    const p = notePanelPose(i, out.z0);
    const m = notePanel(rows, i * NOTE_ROWS, i + 1, pages, NOTE_PANEL_W);
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.yaw;
    add(m);
    panels.push(m);
  }

  /* THE TITLE, over the door, in serif. Over the door on the INSIDE face: this
     is the wall you turn back to on the way out, and the one surface in the
     room that is not carrying the note itself. */
  const title = plaque(spec.name, null, { w: 3.8, ratio: 0.30, gold: true, serif: true });
  title.position.set(0, NOTE_DOOR_H + 0.75, out.z0 + 0.10);
  add(title);

  /* THE META PLAQUE at the far end — the three numbers /api/vault already knew
     about this note, and the door out of the world entirely. */
  const metaPl = plaque('this note', spec.metaLines.join('\n'), { w: 4.2, ratio: 0.50 });
  metaPl.position.set(0, 2.1, out.z1 - 0.10);
  metaPl.rotation.y = Math.PI;
  add(metaPl);

  /* Two lamps and a floor bounce, the same four-source budget the hall keeps. */
  /* 78 and 0.20, not 150 and 0.55. A 5.6 m gallery is narrow enough that every
     surface is within three metres of a lamp, so the numbers the hall uses over
     a 20 m room light this one to a flat sheet — the first capture came back as
     one orange wash with a page floating on it, which is the same failure
     enterHall()'s light block records at 620/520/190. Lower lamps and a darker
     hemisphere put the fall-off back, and the panels are unlit BasicMaterial so
     none of this touches how the note reads. */
  const lampA = new THREE.PointLight(0xffc27a, 78, 16, 2);
  lampA.position.set(0, NOTE_H - 0.8, out.z0 + 4.0);
  const lampB = new THREE.PointLight(0xffb875, 78, 18, 2);
  lampB.position.set(0, NOTE_H - 0.8, out.z1 - 4.0);
  const follow = new THREE.PointLight(0xffc98a, 44, 10, 2);
  const hemi = new THREE.HemisphereLight(0x6d5c46, 0x14110e, 0.20);
  group.add(lampA, lampB, follow, hemi);

  scene.add(group);
  room = { kind: 'note', spec, group, meshes, nodes, mats, panels, follow,
           regions: out.regions, z0: out.z0, z1: out.z1, rows, pages,
           warmUntil: 0, id: spec.noteId };

  player.pos.set(0, HALL_EYE, out.z0 + 2.0);
  player.yaw = Math.PI;                    // yaw pi looks toward +z, down the gallery
  player.pitch = -0.02;
  player.floor = 0;
  setHud(`${spec.name} — the note itself, ${pages} panel${pages === 1 ? '' : 's'} · O opens it in Obsidian`);
  return true;
}

/* THE LIVE HALF. world.js's /api/vault stream calls this with the note's id on
   every change event it sees; a change to the note somebody is standing in
   re-fetches the markdown, repaints every panel and flashes the walls warm for
   NOTE_WARM_MS. Any other id is not this room's business and returns false. */
export async function noteChanged(id) {
  if (!room || room.kind !== 'note' || phase !== 'inside' || room.id !== id) return false;
  const md = await fetchNote(id);
  if (md == null) return false;
  const rows = noteRows(md);
  const pages = Math.max(1, Math.min(NOTE_MAX_PANELS, Math.ceil(rows.length / NOTE_ROWS)));
  /* THE ROOM'S LENGTH IS NOT RE-CUT. A note that grew past its last panel says
     so on that panel (notePanel's own footer) rather than growing the building
     under the reader's feet — moving a wall somebody is standing at is the one
     thing a live update must not do. */
  const n = Math.min(pages, room.panels.length);
  for (let i = 0; i < room.panels.length; i++) {
    const m = room.panels[i];
    const fresh = i < n ? notePanel(rows, i * NOTE_ROWS, i + 1, room.panels.length, NOTE_PANEL_W)
                        : null;
    if (!fresh) continue;
    if (m.userData.tex) m.userData.tex.dispose();
    m.material.map = fresh.material.map;
    m.material.needsUpdate = true;
    m.userData.tex = fresh.userData.tex;
    fresh.geometry.dispose();
    fresh.material.dispose();
  }
  room.rows = rows;
  room.warmUntil = clock + NOTE_WARM_MS / 1000;
  setHud(`${room.spec.name} — just saved, the wall re-read it · O opens it in Obsidian`);
  return true;
}

/* The walk in a gallery: the hall's own separated-axis slide against the same
   rectangle list, and the same door-out rule at the near end. */
function stepNoteRoom(dt) {
  walkKeys(dt);
  const S = HALL_SHOULDER;
  if (player.pos.z + _move.z < room.z0 + S && Math.abs(player.pos.x) < NOTE_DOOR_W / 2 - 0.2 &&
      player.pos.y < NOTE_DOOR_H) { leave(); return; }
  const nx = player.pos.x + _move.x;
  if (regionAt(room.regions, nx, player.pos.z, S)) player.pos.x = nx;
  const nz = player.pos.z + _move.z;
  if (regionAt(room.regions, player.pos.x, nz, S)) player.pos.z = nz;
  const here = regionAt(room.regions, player.pos.x, player.pos.z, S * 0.5);
  player.pos.y = Math.max(0.55, Math.min(here ? here.top : NOTE_H - 0.5, player.pos.y + _move.y));
  room.follow.position.set(player.pos.x, player.pos.y + 0.5, player.pos.z);
  /* The warm flash, decaying. One multiply on a material colour — no second
     texture, no second panel, nothing to dispose when it ends. */
  const k = Math.max(0, (room.warmUntil - clock) / (NOTE_WARM_MS / 1000));
  for (const m of room.panels) m.material.color.setRGB(1, 1 - 0.30 * k, 1 - 0.52 * k);
}


/* -----------------------------------------------------------------------------
   THE BRIDGE DECK. No shell at all: the bridge is already standing in the world
   and this form only adds what a bridge does not have — a plaque at each end
   saying whose day it is, and a reading stand in the middle with the day's own
   note on it. Everything is in WORLD metres, rotated onto the deck's own axis,
   and the river, the banks and the neighbouring days are the world underneath.
   -------------------------------------------------------------------------- */
export async function enterDeck(spec) {
  if (phase !== 'out' || !spec) return false;
  mode = 'deck'; subject = spec;
  beginFly(spec);

  const md = await fetchNote(spec.noteId);
  const group = new THREE.Group();
  group.position.set(spec.x, spec.deckY, spec.z);
  group.rotation.y = spec.rot;                    // local +x runs along the deck
  const E = hallEmitter();
  const half = spec.len / 2;


  const mats = hallMaterials();
  const meshes = buildHallMesh(E, mats, group);
  const nodes = [];
  const add = (m) => { group.add(m); nodes.push(m); };

  /* THE DAY, on a plaque at each end, facing inward — so whichever end you
     arrive from, the day's name is the first thing on the deck. */
  for (const s of [-1, 1]) {
    /* 1.5 m and at the very end of the bay. The first capture had these 2.6 m
       wide and 0.55 in from the end, which put one of them 35 cm from the
       reader's eye and made it the entire frame — a plaque on a bridge is a
       sign you read as you arrive, not a hoarding you stand under. */
    const pl = plaque(spec.name, spec.metaLines[0] || null, { w: 1.5, ratio: 0.42, gold: true });
    pl.position.set(s * (half - 0.14), 1.30, 0);
    pl.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    add(pl);
  }

  /* THE NOTE on the stand — one panel, tilted with the lectern. A bridge is not
     a reading room and the deck is 20 m long: what fits here is the first page,
     and the panel's own footer says how much of the note is not on it. */
  const standPanel = md != null
    ? notePanel(noteRows(md, STAND_COLS), 0, 1, 1, DECK_STAND_W, STAND_ROWS)
    : plaque('no text for this day',
             '/api/vault/note did not answer for this note — press O to open it in Obsidian',
             { w: DECK_STAND_W, ratio: 0.42 });
  const lectern = readingStand(mats, standPanel, DECK_STAND_W, meshes, nodes);
  lectern.rotation.y = -Math.PI / 2;              // the page faces -x, the walk
  group.add(lectern);

  /* One lamp over the stand and nothing else: the deck is outdoors and the sun
     that lights it is the world's own, already in the scene behind. */
  const lamp = new THREE.PointLight(0xffc98a, 90, 12, 2);
  lamp.position.set(0, 2.6, 0);
  group.add(lamp);

  scene.add(group);
  sky.visible = false;                            // the world's dome is the sky here
  outdoorLens(true);
  room = { kind: 'deck', spec, group, meshes, nodes, mats, panels: standPanel ? [standPanel] : [],
           half, halfW: spec.wid / 2 };

  /* Standing on the deck at the near end, looking along it. The group is turned
     by `spec.rot`, so its local +x is (cos rot, 0, -sin rot) in the world and a
     walker facing it has yaw atan2(-cos rot, sin rot) — the player's forward is
     (-sin yaw, 0, -cos yaw), which is where both minus signs come from. */
  const c = Math.cos(spec.rot), s = Math.sin(spec.rot);
  /* Local (-(half - 0.55), +0.35): at the near end, a hand's breadth off the
     centre line so the lectern is not dead centre in the frame, and close enough
     to it that its page clears the 14-px floor. */
  const px = -(half - 0.40), pz = 0.35;
  player.pos.set(spec.x + px * c + pz * s, spec.deckY + DECK_EYE, spec.z - px * s + pz * c);
  player.yaw = Math.atan2(-Math.cos(spec.rot), Math.sin(spec.rot));
  /* Looking DOWN the bay, not at the horizon: the walkway is 3.4 m over the
     model's base and every neighbouring parapet is below the eye line, so a
     level lens frames nothing but fog and sky — which is exactly what the first
     capture came back as. */
  player.pitch = -0.14;
  player.floor = 0;
  setHud(`${spec.name} — on the bridge · ${spec.metaLines[0] || ''} · O opens it in Obsidian`);
  return true;
}

/* The deck's collision, in the bridge's own axes: a rectangle len x wid, and
   walking off either end is the way out. Height is fixed — a deck is flat. */
function stepDeck(dt) {
  walkKeys(dt);
  const c = Math.cos(room.spec.rot), s = Math.sin(room.spec.rot);
  const wx = player.pos.x + _move.x - room.spec.x, wz = player.pos.z + _move.z - room.spec.z;
  /* World -> deck local. The group is rotated by +rot, so the inverse is -rot. */
  const lx = wx * c - wz * s, lz = wx * s + wz * c;
  if (Math.abs(lx) > room.half - 0.3) { leave(); return; }
  const clz = Math.max(-room.halfW + 0.35, Math.min(room.halfW - 0.35, lz));
  player.pos.x = room.spec.x + lx * c + clz * s;
  player.pos.z = room.spec.z - lx * s + clz * c;
  player.pos.y = room.spec.deckY + DECK_EYE;
}


/* -----------------------------------------------------------------------------
   THE LIGHTHOUSE. A tower you climb: a shaft, a stair winding round it four
   turns to the lamp room, the idea note on a lectern up there and the lamp
   turning over it. The wall stops at the lamp-room floor, so the sea and the
   harbour ARE the view — they are the world, drawn behind this scene.
   -------------------------------------------------------------------------- */
export async function enterTower(spec) {
  if (phase !== 'out' || !spec) return false;
  mode = 'tower'; subject = spec;
  beginFly(spec);

  const md = await fetchNote(spec.noteId);
  const group = new THREE.Group();
  group.position.set(spec.x, spec.y, spec.z);
  const E = hallEmitter();

  /* THE WALL, as 24 staves round a circle with the doorway left out of the two
     the door stands in. A box per stave rather than an open cylinder because
     the emitter merges boxes and a wall this thick reads as masonry from the
     inside, which a single-sided cylinder does not. */
  const SEG = 24, arc = (Math.PI * 2) / SEG;
  for (let i = 0; i < SEG; i++) {
    const a = i * arc;
    const doorway = i === 0 || i === SEG - 1;     // the two staves the door is in
    const x = Math.cos(a) * (TOWER_R + 0.18), z = Math.sin(a) * (TOWER_R + 0.18);
    if (doorway) {
      /* Over the door only, so the opening is a doorway and not a missing wall. */
      E.box('stone', x, 2.5, z, 0.36, TOWER_LAMP_Y - 2.5, arc * TOWER_R * 1.12, -a);
    } else {
      E.box('stone', x, 0, z, 0.36, TOWER_LAMP_Y, arc * TOWER_R * 1.12, -a);
    }
  }
  /* THE SHAFT the stair winds round, and the collision the brief asks for: it
     is a solid column from the floor to the lamp room, so a step that would go
     through the middle is a step that does not happen. */
  E.cyl('stone', 0, 0, 0, TOWER_SHAFT, TOWER_LAMP_Y);
  E.cyl('floor', 0, -0.3, 0, TOWER_R + 0.6, 0.3);

  /* THE STAIR: sixty-four treads, one turn every sixteen, from the door to the
     lamp-room floor. Drawn as steps and WALKED as a ramp — see stepTower(). */
  const rMid = (TOWER_SHAFT + TOWER_R) / 2;
  for (let i = 0; i < TOWER_STEPS; i++) {
    const a = (i / TOWER_STEPS) * TOWER_TURNS * Math.PI * 2;
    const y = (i / TOWER_STEPS) * TOWER_LAMP_Y;
    E.box('stone', Math.cos(a) * rMid, y, Math.sin(a) * rMid,
          TOWER_R - TOWER_SHAFT - 0.1, 0.20, arc * rMid * 1.25, -a);
  }

  /* THE LAMP ROOM. Its floor is a ring — solid where you are not arriving
     through it — eight glazing posts, a gallery ring outside the wall line and
     a rail on it. Nothing between the posts, which is the point of the form. */
  const LAMP_H = 3.4;
  for (let i = 0; i < SEG; i++) {
    const a = i * arc;
    /* The stair arrives at angle zero after a whole number of turns, so the
       three staves there are left out — that hole IS the stairwell. */
    if (i < 3) continue;
    E.box('floor', Math.cos(a) * rMid, TOWER_LAMP_Y - 0.22, Math.sin(a) * rMid,
          TOWER_R - TOWER_SHAFT + 0.2, 0.22, arc * rMid * 1.3, -a);
  }
  E.cyl('floor', 0, TOWER_LAMP_Y - 0.22, 0, TOWER_SHAFT + 0.05, 0.22);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    E.box('steel', Math.cos(a) * TOWER_R, TOWER_LAMP_Y, Math.sin(a) * TOWER_R,
          0.16, LAMP_H, 0.16, -a);
  }
  /* The gallery: the ring you step out onto, and the rail that keeps you on it. */
  for (let i = 0; i < SEG; i++) {
    const a = i * arc, rG = TOWER_R + TOWER_GALLERY / 2 + 0.18;
    E.box('stone', Math.cos(a) * rG, TOWER_LAMP_Y - 0.22, Math.sin(a) * rG,
          TOWER_GALLERY, 0.22, arc * rG * 1.3, -a);
    E.box('steel', Math.cos(a) * (rG + TOWER_GALLERY / 2), TOWER_LAMP_Y + 0.95,
          Math.sin(a) * (rG + TOWER_GALLERY / 2), 0.08, 0.10, arc * rG * 1.3, -a);
  }
  /* The roof cone over the lamp, as a ring of leaning plates. */
  for (let i = 0; i < SEG; i++) {
    const a = i * arc;
    E.box('dark', Math.cos(a) * (TOWER_R * 0.55), TOWER_LAMP_Y + LAMP_H + 0.5,
          Math.sin(a) * (TOWER_R * 0.55), TOWER_R * 1.2, 0.14, arc * TOWER_R * 1.3, -a, 0.5);
  }

  const mats = hallMaterials();
  const meshes = buildHallMesh(E, mats, group);
  const nodes = [];
  const add = (m) => { group.add(m); nodes.push(m); };

  /* THE NAME, by the door at the bottom, and again on the lectern up top. */
  const pl = plaque(spec.name, spec.metaLines[0] || null, { w: 2.4, ratio: 0.40, gold: true });
  pl.position.set(TOWER_R - 0.22, 2.0, -1.5);
  pl.rotation.y = -Math.PI / 2;
  add(pl);

  /* THE IDEA, on the lectern in the lamp room. An Ideas note is short by
     construction — one panel is the whole of nearly every one of them, and the
     footer says so when it is not. */
  const notePl = md != null
    ? notePanel(noteRows(md, STAND_COLS), 0, 1, 1, TOWER_STAND_W, STAND_ROWS)
    : plaque('no text for this idea',
             '/api/vault/note did not answer for this note — press O to open it in Obsidian',
             { w: TOWER_STAND_W, ratio: 0.42 });
  /* The lectern stands the far side of the shaft head from the stairwell, so
     the climber walks up into the lamp room and the page is facing him. */
  const lectern = readingStand(mats, notePl, TOWER_STAND_W, meshes, nodes);
  lectern.position.set(0, TOWER_LAMP_Y, TOWER_SHAFT + 0.85);
  lectern.rotation.y = Math.PI;                   // the page faces -z, the stairwell
  group.add(lectern);

  /* THE LAMP, and it turns. One emissive box on a hub — the bloom pass the
     world already runs is what makes it a beam rather than a bright brick. */
  const lampHub = new THREE.Group();
  lampHub.position.set(0, TOWER_LAMP_Y + 1.9, 0);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), mats.lamp);
  lampHub.add(bulb); meshes.push(bulb);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.5, 0.9),
    new THREE.MeshBasicMaterial({ color: 0xffe0aa, transparent: true, opacity: 0.16,
                                  blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.x = 4.5;
  lampHub.add(beam); nodes.push(beam);      // its own material, so it is disposed
  group.add(lampHub);

  const beacon = new THREE.PointLight(0xffe0aa, 360, 40, 2);
  beacon.position.set(0, TOWER_LAMP_Y + 1.9, 0);
  const climb = new THREE.PointLight(0xffc98a, 70, 13, 2);
  const hemi = new THREE.HemisphereLight(0x6d5c46, 0x14110e, 0.5);
  group.add(beacon, climb, hemi);

  scene.add(group);
  sky.visible = false;
  outdoorLens(true);
  room = { kind: 'tower', spec, group, meshes, nodes, mats, panels: [notePl],
           lampHub, follow: climb, turns: 0, lampY: TOWER_LAMP_Y, lampH: LAMP_H };

  /* At the door, on the bottom step, facing the way the stair goes. */
  player.pos.set(spec.x + (TOWER_R - 0.7), spec.y + HALL_EYE, spec.z);
  player.yaw = Math.PI;
  player.pitch = 0.06;
  player.floor = 0;
  setHud(`${spec.name} — a lighthouse · walk round the shaft to climb · O opens it in Obsidian`);
  return true;
}

/* The climb, and it is POLAR below the lamp room. The stair is drawn as treads
   and walked as a ramp: the climber's height is a function of how far round the
   shaft he has come, so there is no tread to fall between.

   WHY THE WALK IS RESOLVED IN (r, theta) RATHER THAN IN x AND z. A ring is a
   curved wall and neither of the two things this file already knew how to do
   works against one. The hall's separated axes stop a walker dead the moment
   both fail together; clamping the radius keeps the tangential half of a step
   and is a proper slide, but the step's direction is still fixed in the world,
   so its tangential half shrinks to nothing a quarter turn in and the climber
   halts facing the wall. Measured, holding W for six seconds: 0.26 m of height
   with the axes tested, 0.81 with the radius clamped, out of a thirteen-metre
   climb. So W walks ALONG the ring and A/D cross it, the lens turns with the
   stair, and one held key climbs the tower the way a spiral stair is climbed.
   Above the lamp-room floor the walk goes back to plain x and z, because up
   there it is a room and not a stair.

   The shaft and the wall are still the collision — the legal band is the ring
   between them, which is the "collision with the shaft" the brief asks for and
   the reason the climb cannot be cut across the middle. */
function stepTower(dt) {
  walkKeys(dt);
  const lx0 = player.pos.x - room.spec.x, lz0 = player.pos.z - room.spec.z;
  const inLamp = room.turns >= TOWER_TURNS - 0.02;
  const rMin = inLamp ? 0 : TOWER_SHAFT + 0.34;
  const rMax = inLamp ? TOWER_R + TOWER_GALLERY : TOWER_R - 0.34;

  if (inLamp) {
    /* THE LAMP ROOM is a room: walk it in x and z, and only the outer rail
       stops you. The gallery is outside the wall line, which is why rMax is the
       wall plus the balcony rather than the wall. */
    let lx = lx0 + _move.x, lz = lz0 + _move.z;
    const r = Math.hypot(lx, lz) || 1e-4;
    if (r > rMax) { lx *= rMax / r; lz *= rMax / r; }
    player.pos.x = room.spec.x + lx;
    player.pos.z = room.spec.z + lz;
    player.pos.y = room.spec.y + room.lampY + HALL_EYE;
    room.follow.position.set(lx, room.lampY + 0.6, lz);
    return;
  }

  const ang = Math.atan2(lz0, lx0);
  const r0 = Math.max(1e-4, Math.hypot(lx0, lz0));
  const ct = Math.cos(ang), st = Math.sin(ang);
  /* The step, split at the climber's own place on the ring. */
  const along = -st * _move.x + ct * _move.z;      // + is anticlockwise, which is up
  const across = ct * _move.x + st * _move.z;      // + is outward, toward the wall
  const r1 = Math.max(rMin, Math.min(rMax, r0 + across));
  const dTheta = along / r1;
  const ang1 = ang + dTheta;
  player.pos.x = room.spec.x + Math.cos(ang1) * r1;
  player.pos.z = room.spec.z + Math.sin(ang1) * r1;
  /* The lens turns with the stair. yaw = pi - theta is what puts the walker's
     forward on the ring's tangent, so the two stay locked as he rises; drag-look
     still adds its own turn on top of it. */
  player.yaw -= dTheta;
  room.turns = Math.max(0, Math.min(TOWER_TURNS, room.turns + dTheta / (Math.PI * 2)));
  const y = room.spec.y + (room.turns / TOWER_TURNS) * room.lampY;
  player.pos.y = y + HALL_EYE;
  room.follow.position.set(player.pos.x - room.spec.x, y + 0.6, player.pos.z - room.spec.z);
  /* Walking back out of the doorway at the bottom is the way out, same as every
     other interior in this file. */
  if (room.turns < 0.02 && r1 > TOWER_R - 0.44 && Math.abs(player.pos.z - room.spec.z) < 1.0 &&
      player.pos.x - room.spec.x > 0) leave();
}


/* -----------------------------------------------------------------------------
   THE THREE THINGS ALL FOUR SHELLS SHARE
   -------------------------------------------------------------------------- */
/* The keys -> `_move`, in world axes. Lifted out of stepHall() verbatim rather
   than copied four times; stepHall() calls it too, so there is one place where
   W means forward. */
function walkKeys(dt) {
  const f = keys.has('w') - keys.has('s');
  const rr = keys.has('d') - keys.has('a');
  const u = (keys.has(' ') || keys.has('e')) - (keys.has('shift') || keys.has('q'));
  _fwd.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch),
           -Math.cos(player.yaw) * Math.cos(player.pitch));
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  _move.set(0, 0, 0).addScaledVector(_fwd, f).addScaledVector(_right, rr);
  _move.y += u;
  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(MOVE_SPEED * dt);
}

/* The rectangle list as a collision model, with the walker's own width taken
   off every wall. hallRegionAt() is this with `hall.regions` bound. */
function regionAt(regions, x, z, s) {
  for (const r of regions) {
    if (x > r.x0 + s && x < r.x1 - s && z > r.z0 + s && z < r.z1 - s) return r;
  }
  return null;
}

/* One frame of whichever of the three is standing. */
function updateRoom(dt, t) {
  if (room.kind === 'note') stepNoteRoom(dt);
  else if (room.kind === 'deck') stepDeck(dt);
  else if (room.kind === 'tower') {
    stepTower(dt);
    /* Two turns a minute, which is a real lighthouse's own speed and slow
       enough that the beam sweeping the harbour reads as a sweep. */
    room.lampHub.rotation.y = t * 0.21;
  }
}

function clearRoom() {
  if (!room) return;
  scene.remove(room.group);
  for (const m of room.meshes) m.geometry.dispose();
  for (const n of room.nodes) disposePanel(n);
  for (const k in room.mats) { const m = room.mats[k]; if (m && m.dispose) m.dispose(); }
  room = null;
  if (sky) sky.visible = true;
  outdoorLens(false);
}

/* =============================================================================
   LEAVE — Esc, or walking out of the door on the ground floor
   The city camera was never touched while we were inside, so there is nothing
   to restore: not moving it IS the restore, and it comes back on the exact
   frame it left on.
   ========================================================================== */
export function leave() {
  if (phase === 'out' || phase === 'leaving') return;
  phase = 'leaving';
  flyT = 0;
  flyFrom = { pos: camera.position.clone(), look: lookPoint() };
  flyTo = host.cameraPose();
  setHud(null);
  document.exitPointerLock && document.exitPointerLock();
}

function landOut() {
  phase = 'out';
  clearDress();
  host.overrideCamera(null);
  if (mode === 'file' && subject) host.setBuildingOpen(subject, 0);
  mode = null; subject = null;
}

const _look = new THREE.Vector3();
function lookPoint() {
  _look.set(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(6).add(camera.position);
  return _look.clone();
}


/* =============================================================================
   THE PLAYER — WASD, mouse-look, and walls you cannot walk through
   Gravity-free glide, per the brief: this is a monument, not a shooter. Look up
   and hold W and you rise; there is no jump and nothing falls.
   ========================================================================== */
function placePlayerAtDoor() {
  player.pos.set(0, 1.65, -ROOM_D / 2 + 1.5);
  player.yaw = 0; player.pitch = -0.04; player.floor = 0;
}

const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();

function stepPlayer(dt) {
  const f = keys.has('w') - keys.has('s');
  const r = keys.has('d') - keys.has('a');
  const u = (keys.has(' ') || keys.has('e')) - (keys.has('shift') || keys.has('q'));

  /* Matches the camera's own basis after `camera.rotateY(yaw)` (three.js's
     RotationY: forward = (-sin yaw, ., -cos yaw), right = (cos yaw, ., -sin
     yaw)) — this used to carry the opposite sign on both sine terms, which
     is exactly what HANDOFF's open item 16 named: A/D swapped once you were
     not facing yaw 0 or π, because that is the one pair of angles where a
     sign error on sin(yaw) is invisible (sin 0 = sin π = 0). */
  _fwd.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch),
           -Math.cos(player.yaw) * Math.cos(player.pitch));
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  _move.set(0, 0, 0)
    .addScaledVector(_fwd, f).addScaledVector(_right, r);
  _move.y += u;
  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(MOVE_SPEED * dt);

  const nx = player.pos.x + _move.x;
  const nz = player.pos.z + _move.z;
  let ny = player.pos.y + _move.y;

  /* COLLISION. Half a unit of shoulder off every wall, and the door is the one
     gap in it: on the ground floor, inside the door's width, -z is open — and
     stepping through it is what ends the visit. */
  const hw = ROOM_W / 2 - 0.55, hd = ROOM_D / 2 - 0.55;
  const onGround = ny < STEP;
  const inDoorway = onGround && Math.abs(nx) < DOOR_W / 2 && ny < DOOR_H;
  player.pos.x = Math.max(-hw, Math.min(hw, nx));
  if (nz < -hd && inDoorway) { leave(); return; }
  player.pos.z = Math.max(-hd, Math.min(hd, nz));

  const ceil = (dress ? dress.floors : 1) * STEP - 0.4;
  player.pos.y = Math.max(0.5, Math.min(ceil, ny));

  const floor = Math.max(0, Math.min((dress ? dress.floors : 1) - 1,
                                     Math.floor(player.pos.y / STEP)));
  if (floor !== player.floor) {
    player.floor = floor;
    mountFloor(floor);
    syncLiftNumbers(floor);
    if (mode === 'file') setHud(`${scrubRelDisplay(subject.rel)} — floor ${floor + 1} of ${dress.floors}`);
  }
}


/* =============================================================================
   INPUT — pointer lock, and the drag fallback the capture harness needs
   Headless Chrome over CDP refuses a pointer lock request (there is no user
   gesture it will accept), and a first-person view that cannot look around is
   not one. So the refusal is caught rather than ignored, and drag-look takes
   over for the rest of the visit.
   ========================================================================== */
function attachInput() {
  window.addEventListener('keydown', e => {
    if (!busy()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); leave(); return; }
    keys.add(k === 'shift' ? 'shift' : k);
    if (k === ' ' || k === 'w' || k === 'a' || k === 's' || k === 'd') e.preventDefault();
  }, true);
  window.addEventListener('keyup', e => {
    keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  }, true);
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('pointerlockchange', () => {
    if (inside() && document.pointerLockElement === null) dragLook = true;
  });
  document.addEventListener('pointerlockerror', () => { dragLook = true; }, true);

  document.addEventListener('mousemove', e => {
    if (!inside()) return;
    if (document.pointerLockElement) {
      turn(e.movementX, e.movementY);
    } else if (dragging) {
      turn(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
    }
  });
  document.addEventListener('mousedown', e => {
    if (!inside()) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    if (!pointerLockTried && !dragLook) {
      pointerLockTried = true;
      /* The session city calls its canvas #stage and the world calls its own
         #map. Pointer lock is requested on whichever this page has; without one
         the request is skipped and drag-look carries the visit, which is the
         same fallback the CDP harness already runs on. */
      const el = document.getElementById('stage') || document.getElementById('map');
      try {
        const p = el && el.requestPointerLock && el.requestPointerLock();
        if (p && p.catch) p.catch(() => { dragLook = true; });
      } catch (_) { dragLook = true; }
    }
    /* Looking at a door in a lobby and clicking it walks through it. */
    if (mode === 'plate') tryDoor();
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

function turn(dx, dy) {
  player.yaw += dx * LOOK_SENS;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - dy * LOOK_SENS));
}

/* The door the reticle is on, if any: a plain distance-and-facing test rather
   than a raycast, because a door is a flat plate on a known wall and the test
   is three subtractions. */
function tryDoor() {
  if (!dress || !dress.doors) return;
  let best = null, bestD = 3.2;
  for (const d of dress.doors) {
    const dist = d.position.distanceTo(player.pos);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  if (!best) return;
  const b = best.userData.door;
  /* Straight out and straight back in: leave() clears the room, and the next
     frame opens the file's own building from the same lobby doorway. */
  const target = b;
  phase = 'out';
  clearDress();
  host.overrideCamera(null);
  enterBuilding(target);
}


/* =============================================================================
   WORKER ECHO — the tool calls in flight for this file, inside the room
   Not a second copy of the city's drone: it is the same fact, seen from inside.
   A worker exists for exactly as long as its tool_use id has no tool_result, so
   when one of these is hovering over the wall an Edit really is running.
   ========================================================================== */
let echoes = [];
const echoGeo = new THREE.OctahedronGeometry(0.14, 0);
const echoMat = new THREE.MeshBasicMaterial({ color: 0xff6a4a });

/* `live` is passed in rather than fetched again: update() already asked for it
   this frame, and the desks and the echoes must not be able to disagree about
   how many calls are in flight. */
function stepEchoes(dt, t, live) {
  if (mode !== 'file' || !subject) { dropEchoes(); return; }
  while (echoes.length > live.length) {
    const e = echoes.pop();
    shell.group.remove(e.group); disposePanel(e.tag);
  }
  while (echoes.length < live.length) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(echoGeo, echoMat);
    g.add(body);
    const tag = plaque(null, live[echoes.length].label, { w: 2.6, bare: true, ratio: 0.13 });
    tag.position.y = 0.34;
    g.add(tag);
    shell.group.add(g);
    echoes.push({ group: g, tag, body });
  }
  /* Over the wall of the floor they are writing: that is the TOP floor, because
     that is the floor the next Edit adds. */
  const top = (dress ? dress.floors : 1) - 1;
  echoes.forEach((e, i) => {
    const a = t * 0.9 + i * 2.1;
    e.group.position.set(Math.cos(a) * 2.2, top * STEP + ROOM_H * 0.62 + Math.sin(a * 1.7) * 0.12,
                         ROOM_D / 2 - 1.3 + Math.sin(a) * 0.5);
    e.group.rotation.y = -a;
    e.tag.rotation.y = player.yaw;      // the tag turns to the reader
  });
}

function dropEchoes() {
  for (const e of echoes) { shell.group.remove(e.group); disposePanel(e.tag); }
  echoes = [];
}


/* =============================================================================
   FRAME — the fly in, the walk, the fly out
   city.js calls this before it decides which scene to draw.
   ========================================================================== */
let clock = 0;
const _ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const _pos = new THREE.Vector3(), _lk = new THREE.Vector3();

export function update(dt) {
  if (phase === 'out') return;
  clock += dt;

  if (phase === 'in' || phase === 'leaving') {
    flyT = Math.min(1, flyT + dt / FLY_SECONDS);
    const k = _ease(flyT);
    _pos.copy(flyFrom.pos).lerp(flyTo.pos, k);
    _lk.copy(flyFrom.look).lerp(flyTo.look, k);
    host.overrideCamera(_pos, _lk);
    /* The facade dissolves as the lens reaches it — the wall has to be gone
       before the room behind it can be the picture. */
    if (mode === 'file' && subject) {
      host.setBuildingOpen(subject, phase === 'in' ? k : 1 - k);
    }
    if (flyT >= 1) {
      if (phase === 'in') { phase = 'inside'; host.overrideCamera(null); }
      else landOut();
    }
    /* The city is still the picture during the flight and the window belongs to
       the room, so it stays hidden until the fly-in lands. */
    syncPageWindow();
    return;
  }

  /* A HALL is a different building with a different collision model and no
     floors, so it takes the frame from here and returns. Everything below this
     point is the city's stacked room. */
  if (mode === 'hall') {
    updateHall(dt, clock);
    aimCamera();
    syncPageWindow();
    if (pageObj && pageObj.visible) css.render(scene, camera);
    return;
  }

  /* A NOTE GALLERY, a BRIDGE DECK and a LIGHTHOUSE are each their own shell and
     their own walk, and none of them has a floor stack, a lift or a page window
     — so they take the frame here and everything below stays the city's room. */
  if (room) { updateRoom(dt, clock); aimCamera(); return; }

  stepPlayer(dt);
  const live = mode === 'file' && subject ? host.workersFor(subject) : [];
  stepEchoes(dt, clock, live);
  syncDesks(live);

  /* The two lamps ride the floor you are on, and the third is the dusk coming
     in through the window. */
  const y = player.floor * STEP;
  shell.lampA.position.set(-2.4, y + ROOM_H - 0.95, 1.2);
  shell.lampB.position.set(2.6, y + ROOM_H - 0.95, -1.4);
  shell.fill.position.set(0, y + ROOM_H * 0.7, -ROOM_D / 2 - 1.2);
  shell.bulbA.position.copy(shell.lampA.position);
  shell.bulbB.position.copy(shell.lampB.position);

  /* A file being edited right now: the top floor's panels pulse red. This is
     the only animated colour in the room and it means exactly one thing. */
  const pulse = 0.5 + 0.5 * Math.sin(clock * 5.2);
  for (const [, m] of panelCache) {
    if (!m.userData.hot) continue;
    m.material.color.setRGB(1, 0.62 + 0.24 * (1 - pulse), 0.56 + 0.28 * (1 - pulse));
  }

  aimCamera();

  /* The DOM layer, last: it needs the camera's final pose for this frame, and
     it costs nothing at all when there is no window standing. Order against the
     WebGL draw does not matter — this only writes CSS transforms. */
  syncPageWindow();
  if (pageObj && pageObj.visible) css.render(scene, camera);
}


/* =============================================================================
   HUD — one line of type, in the chrome's own voice
   Not a panel: the same mono, the same bone, bottom centre, and it says where
   you are and how to get out. Nothing else about the interior is DOM.
   ========================================================================== */
/* The lens, from the walker. Yaw then pitch, in that order and off a CLEARED
   rotation: three's default XYZ order applies pitch about the world x axis, so
   writing the two as Euler components tilts the horizon the moment yaw is not a
   right angle. Written once here rather than once in each of the four shells. */
function aimCamera() {
  camera.position.copy(player.pos);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);
}

function setHud(text) {
  if (!hud) hud = document.getElementById('interior-hud');
  if (!hud) return;
  if (!text) { hud.hidden = true; return; }
  hud.querySelector('#interior-where').textContent = text;
  hud.hidden = false;
}


/* =============================================================================
   MEASUREMENT — what docs/RUNBOOK.md reads to check this pass
   Read-only. The glyph number is computed the way city.js computes tagPixels():
   world height / (2 * distance * tan(fov/2)) * frame height, so it is the size
   on the RENDERED frame and not an assertion about a canvas.
   ========================================================================== */
export function probe() {
  if (phase === 'out') return { phase, inside: false };
  const tanV = Math.tan(camera.fov * Math.PI / 360);
  /* "At reading distance" means the wall the reader is actually looking at. The
     floors above and below are visible through the well and the side walls sit
     at a grazing angle; measuring those would report the smallest type in the
     building rather than the type being read, and the number would fail on a
     page nobody is looking at. So the filter is the camera's own facing. */
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const to = new THREE.Vector3();
  let minPx = Infinity, panels = 0, faced = 0;
  for (const [, m] of panelCache) {
    if (!m.userData.tex || m.userData.floor === undefined) continue;
    panels++;
    /* The floor above is visible through the well and its type is genuinely
       small there; it is not what anybody is reading, and counting it made this
       instrument report the smallest page in the tower. */
    if (m.userData.floor !== player.floor) continue;
    to.copy(m.position).sub(camera.position);
    const dist = Math.max(0.01, to.length());
    if (to.normalize().dot(fwd) < 0.55) continue;     // not in front of the reader
    const rowWorld = m.geometry.parameters.height / PAGE_ROWS;
    const px = (rowWorld * GLYPH_FRAC) / (2 * dist * tanV) * H;
    if (px < minPx) minPx = px;
    faced++;
  }
  return {
    phase, inside: inside(), mode,
    subject: subject ? (subject.rel || subject.name) : null,
    floor: player.floor + 1, floors: dress ? dress.floors : 0,
    /* The hall's own instruments: how many stations stand, how many carry a
       real page right now (never more than one), and which one that is. */
    stations: hall ? hall.stations.length : 0,
    loaded: hall ? hall.stations.filter(s => s.loaded).length : 0,
    station: hall && hall.pageStation ? hall.pageStation.page.file : null,
    liveStations: hall ? hall.stations.filter(s => s.live).length : 0,
    pack: hall ? !!host.hallMaterial : null,
    form: hall ? hall.spec.form : null,
    /* THE THREE NEW SHELLS. `notePanels` is how many plates of markdown stand,
       `noteGlyphPx` the size of one of their glyphs on the RENDERED frame at the
       reader's own distance (the same solve minGlyphPx runs), `climb` how far up
       the lighthouse's stair he is, and `overlay` whether the world is still
       being drawn behind him. RUNBOOK's gate numbers are read from here. */
    room: room ? room.kind : null,
    overlay: overlay(),
    notePanels: room && room.panels ? room.panels.length : 0,
    noteGlyphPx: roomGlyphPx(),
    climb: room && room.kind === 'tower' ? +(room.turns / TOWER_TURNS).toFixed(3) : null,
    warm: room && room.kind === 'note' ? room.warmUntil > clock : null,
    panels, faced, minGlyphPx: faced ? +minPx.toFixed(1) : null,
    pointerLock: !!document.pointerLockElement, dragLook,
    fixture: !!(dress && dress.source && dress.source.fixture),
    echoes: echoes.length,
  };
}

/* The smallest glyph on a panel the reader is actually FACING, on the rendered
   frame — the same solve probe()'s minGlyphPx runs over the city's source
   walls, over the note/deck/tower panels instead. Null when none is in front of
   him, which is a fact about where he is looking and not a zero. */
function roomGlyphPx() {
  if (!room || !room.panels || !room.panels.length) return null;
  const tanV = Math.tan(camera.fov * Math.PI / 360);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const to = new THREE.Vector3();
  /* THE NEAREST FACED PANEL, not the smallest one inside the facing cone — the
     same correction probe()'s own minGlyphPx carries as its floor filter, and
     for the same reason it records: a gallery is a row of plates and the one
     four bays down IS genuinely small type. Reporting that as the room's
     legibility measures a page nobody is reading. */
  let best = null, bestD = Infinity;
  for (const m of room.panels) {
    m.getWorldPosition(to);
    to.sub(camera.position);
    const dist = Math.max(0.01, to.length());
    if (to.normalize().dot(fwd) < 0.5) continue;
    if (dist < bestD) { bestD = dist; best = m; }
  }
  if (!best) return null;
  /* The plate carries NOTE_ROWS rows over the part of the canvas that is not
     the page-number strip — the same 750/(750-54) the panel was drawn with. */
  const rowWorld = best.geometry.parameters.height * (696 / 750) / (best.userData.rows || NOTE_ROWS);
  return +((rowWorld * GLYPH_FRAC) / (2 * bestD * tanV) * H).toFixed(1);
}

/* The capture harness cannot hold a mouse. These two put the player exactly
   where a shot needs him, in the room's own coordinates. */
export function stand(x, y, z, yaw, pitch) {
  if (!inside()) return false;
  player.pos.set(x, y, z);
  player.yaw = yaw || 0; player.pitch = pitch || 0;
  if (mode === 'hall') { player.floor = 0; syncHallStation(); return true; }
  /* The three new shells have no floor stack to mount and no lift numbers to
     roll — the pose IS the whole state. The one exception is the lighthouse,
     whose HEIGHT is not state at all: stepTower() solves it from how far round
     the shaft the climber has come, so a pose that only writes y is undone on
     the next frame. The climb is set from the y that was asked for instead. */
  if (room) {
    player.floor = 0;
    if (room.kind === 'tower') {
      room.turns = Math.max(0, Math.min(TOWER_TURNS,
        (y - room.spec.y - HALL_EYE) / room.lampY * TOWER_TURNS));
    }
    return true;
  }
  player.floor = Math.max(0, Math.floor(y / STEP));
  mountFloor(player.floor);
  syncLiftNumbers(player.floor);
  /* stepPlayer() sets this HUD line whenever a real step crosses a floor —
     __stand() teleports past that check entirely, so a shot taken right after
     it kept reading "floor 1 of N" no matter where it landed. */
  if (mode === 'file' && subject) setHud(`${scrubRelDisplay(subject.rel)} — floor ${player.floor + 1} of ${dress.floors}`);
  return true;
}

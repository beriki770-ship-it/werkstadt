/* =============================================================================
   werkstadt — city.js
   The world: a city that builds itself while a real session replays.

   Ground is the project, one plate per directory. One building per file, born
   the first time an event touches it. Floors are Edits and Writes. Lit windows
   are Reads. Drones are agents. The sky is the session clock.

   The one rule this file obeys everywhere: nothing here is invented. Every
   building, spark, drone and beam traces back to an event that arrived through
   replay.js. There is no ambient traffic, no filler skyline and no decorative
   district — when nothing happens, the city just hums.

   Why WebGL and instancing: the gate is 300 buildings and 25 drones at 60 fps on
   an integrated Radeon 860M. Three hundred separate meshes is three hundred draw
   calls; as one InstancedMesh with a single facade shader it is one. Windows are
   computed in that same fragment shader rather than being geometry, which is the
   difference between ~300 draws and ~30,000.
   ========================================================================== */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
/* The inside of the buildings. It owns its own scene and its own camera and
   knows nothing about the city; everything it needs from here is handed to it
   as callbacks in init(), so there is no import back this way and no cycle. */
import * as Interior from './interior.js';
/* The aircraft. drones.js owns the ORNIS airframe, its three LOD tiers and
   everything that moves ON a craft — rotors, nav lights, bank, downwash, the
   variant's own beam. This file owns where a craft flies and why. Two seams
   join them: `kit.getHeight` (the city's ground) and `kit.lodFor` (the city's
   scale). See the ORNIS block in the DRONES section below. */
import { DroneKit } from './drones.js';
/* The crowd. life.js owns every person, vehicle, dog and hedge and the whole
   ladder that draws three hundred of them in one pass; this file owns WHERE
   they stand and, in the two regimes below, WHO they are — a crew on a street
   still being built, residents on one that is finished. The seam is the LIFE
   section further down: one scaled group, the city's own road and plate
   geometry converted once, and counts read off real tool calls. */
import { Life } from './life.js';
/* The enter / exit buttons. This page owns what those two words MEAN in a
   city; controls.js owns the buttons, their labels and their states. It exists
   because the desktop wallpaper gets mouse input and no keyboard — see the
   header comment in controls.js. */
import * as Controls from './controls.js';


/* =============================================================================
   CONSTANTS — the whole shape of the city in one block
   Anything a person might want to tune lives here and nowhere else.
   ========================================================================== */
const LOT       = 1.0;      // one file's plot, in world units
const LOT_GAP   = 0.18;     // the alley between two plots inside a district
const PLATE_PAD = 0.34;     // ground margin a plate keeps around its contents
const PLATE_GAP = 0.5;      // the gap between two plates
const FLOOR_CAP = 40;       // brief's cap; a capped tower gets a beacon instead

/* --- How tall a tower is DRAWN ------------------------------------------
   Two files in this project have been edited over a hundred times each
   (server.py 110, city.js 101, against a median of one or two), so both sit on
   the cap. At one floor per Edit that is a 40-storey needle on a 0.46 footprint
   standing over blocks three floors high — it dwarfs the city it is part of,
   and because the framing solve fits the city's own bounding BOX, the tallest
   thing in it is what pushes the lens back and leaves the picture two thirds
   sky.

   So the count and the height stop being the same number above HEIGHT_SOFT
   floors. Nothing else moves: `b.floors` is still the true Edit count, the
   pick caption still prints it, and interior.js still raises one walkable room
   per real floor. Only the exterior compresses, and a compressed tower lights
   a beacon so the shortfall is stated rather than hidden.

   The curve is `soft + k*ln(1 + (f-soft)/k)`: continuous and with slope 1 at
   the join, so a building crossing 24 floors does not visibly jump. At k = 4
   the cap draws as 30.4 floors (12.8 units instead of 16.8) and the 35-floor
   second tower as 28.6 — enough to put the skyline back on the city, gentle
   enough that a tower is still obviously a tower. */
const HEIGHT_SOFT = 24;
const HEIGHT_K    = 4;
const drawnFloors = f => f <= HEIGHT_SOFT
  ? f
  : HEIGHT_SOFT + HEIGHT_K * Math.log(1 + (f - HEIGHT_SOFT) / HEIGHT_K);

const MAX_BUILDINGS = 720;  // hard ceiling on the instanced buffers
const MAX_PLATES    = 200;
const MAX_PARTICLES = 2200; // raised for derez voxels — see DEREZ below
const MAX_BEACONS   = 96;
const MAX_SCANS     = 10;   // read-beam quads in flight
const MAX_CONES     = 5;    // search-light cones in flight

/* --- Mobile ---------------------------------------------------------------
   Forced by ?mobile=1, or auto-detected on a coarse pointer (a phone or a
   tablet with no mouse). Read once at load, since nobody's pointer type
   changes mid-session, and used below to trim the things that cost a phone
   GPU its frame rate: half-res bloom, a lower worker cap and shorter trails.
   The DPR clamp needs no separate mobile branch — it is already capped at 1.5
   for every pointer type. */
const MOBILE = new URLSearchParams(location.search).get('mobile') === '1' ||
               matchMedia('(pointer: coarse)').matches;
export const isMobile = () => MOBILE;

/* --- Worker drones -------------------------------------------------------
   One worker per in-flight tool call, launched from its agent's craft. The
   real export peaks at 18 simultaneous calls for a single agent, so the cap is
   above nothing that matters and below the point where twelve tags around one
   craft stop being readable — the extra calls queue inside the craft and it
   wears a "+n". Mobile halves it to 8: the same reasoning, for a smaller
   screen and a slower GPU. */
const WORKER_CAP     = MOBILE ? 8 : 12;    // visible workers per craft
const MAX_WORKERS    = 120;   // hard ceiling across the whole city
/* Live mode has no tool_end yet (server.py sends it now; an older server or a
   call already in flight when the stream attached does not), so a worker that
   is never told its call finished flies home on its own after this much
   SESSION time. Replay mode never reaches it — every call there is paired. */
const WORKER_TIMEOUT_MS = 90000;

/* --- Streets -------------------------------------------------------------
   A city is a PROJECT and an avenue is a SESSION. The plate layer below still
   belongs to the directory tree — a plate keeps the folder's name — and the
   street is the second axis over it: the conversation that did the work. So a
   directory worked on by two sessions stands twice, once per avenue, the same
   way an annex is the same district continued on a second block. That is the
   only reading of "the lot is on the street of the session that FIRST touched
   the file" that also keeps "nothing that already stands ever moves" true.

   Geometry: every avenue starts on the same entrance line (x = 0) and runs
   +x for as long as its session keeps working. Avenues stack in +z, and a new
   one opens past the far edge of everything already standing. The BAND (see
   bandFor() below) is the depth an avenue RESERVES when it opens: while it is
   the newest it may grow past it freely, and the moment a newer avenue opens
   below, the ordinary sibling-overlap test in growthFits() caps it there — a
   district that then runs out of room annexes further along its own street
   instead of shoving the avenue below into the next one. */
const STREET_ROAD  = 2.2;    // the carriageway, kept clear of plates
/* An avenue's reserved depth is not one number, because sessions are not one
   size: this town's live session holds 4,391 events and the scheduled job next
   to it holds 74. Reserved at a flat 13 units, the big one could not stack its
   districts at all and laid 134 buildings in a single lot-deep ribbon 300 units
   long — the exact failure the packer's squarify term exists to prevent, moved
   up a level. So the band is sized from the street's own event count, which
   /api/project hands over in `streets[].events`, and clamped at both ends: no
   avenue is narrower than a couple of blocks, and none reserves a whole
   district's worth of empty ground on the strength of one long session. */
const STREET_BAND_MIN = 11.0;
const STREET_BAND_MAX = 34.0;
const bandFor = events =>
  Math.max(STREET_BAND_MIN, Math.min(STREET_BAND_MAX, Math.sqrt(events || 400) * 0.46));
const STREET_GAP   = 1.6;    // kerb to kerb between two avenues
const STREET_SIGN  = 48;     // characters on a street sign, per the brief
const LAMP_SPACING = 5.0;    // world units between two lamp posts
const MAX_LAMPS    = 320;

/* --- TRON: Ares constructs ----------------------------------------------
   The film's thesis is that the digital is a guest in a real world: programs
   are laser-printed into it in red, they hold for 29 minutes, then they derez.
   So the city stays warm and photographic and only the CONSTRUCT layer — the
   print lasers, the support scaffolds, the trails and the derez voxels — is
   this palette. Nothing warm was recoloured. The two construct colours live
   with the rest of the palette below (LASER / AZURE), because GOLD is declared
   there and TRAIL_COLORS needs all three. */
/* A print has to be WATCHABLE. At 1.2 s the whole event was over before the eye
   found it — `docs/shots/city-print.png` had to be caught by polling, and a
   viewer who blinked missed the only thing the city is about. A print now runs
   2.5 s for a one-floor shed and 4.0 s for a tower, scaled by the DRAWN floors
   so a 40-storey file does not print in the same beat as a README. */
const PRINT_MIN_SECONDS = 2.5;
const PRINT_MAX_SECONDS = 4.0;
const PRINT_FLOOR_REF   = 12;      // floors at which the print reaches its ceiling
const printSecondsFor = b => PRINT_MIN_SECONDS +
  (PRINT_MAX_SECONDS - PRINT_MIN_SECONDS) *
  Math.min(1, drawnFloors(b.floors || 1) / PRINT_FLOOR_REF);
const LAYER_SECONDS = 0.6;   // one new floor, printed the same way
/* The lattice does not vanish with the last layer: it holds the finished shell
   for a beat and then dissolves UPWARD, which is the only part of the film's
   grammar the first pass left out. */
const RIG_HOLD_SECONDS    = 0.6;
const RIG_DISSOLVE_SECONDS = 0.5;
/* The facade comes out of the printer white-hot and cools into the warm palette
   the rest of the city already uses. 0.2 s at full white, three seconds down. */
const FLASH_HOLD_SECONDS = 0.2;
const FLASH_COOL_SECONDS = 3.0;
/* The cool-down is exponential, not the old smoothstep ease: most of the drop
   happens in the first second, which is what keeps a fresh facade under the
   bloom threshold for only a beat instead of blooming white for seconds. TAU is
   solved so the curve is at 0.2% (the same cutoff stepFlash already used to
   retire a job) right at FLASH_COOL_SECONDS after the hold — ln(1/0.002) = 6.215. */
const FLASH_COOL_TAU = FLASH_COOL_SECONDS / 6.215;
/* Derez gets a pre-roll: a construct does not simply fall apart, it glitches
   first — scanline artifacts tearing across the body — and THEN the voxels go. */
const GLITCH_SECONDS = 0.4;
const MAX_PRINT_RIGS = 8;    // lasers + scaffolds shown at once; the print itself is free
const RIG_STRUTS = 8;        // the support lattice: 4 corner posts + 4 belt rails

/* Light trails. 32 segments over 1.5 s is the ribbon's whole memory — the cap
   in the brief is 64 and half of it already outlives the fade. */
const TRAIL_SEG    = 32;
const TRAIL_LIFE   = MOBILE ? 0.8 : 1.5;   // shorter ribbon on mobile — same buffers, less to draw
const TRAIL_WIDTH  = 0.05;
const TRAIL_MIN_STEP = 0.07;   // world units before a new point is recorded
/* One merged geometry per colour, so the whole ribbon layer is three draws.
   Slots are budgeted where the drones actually are: most workers do file work. */
const TRAIL_KEYS   = ['red', 'blue', 'gold'];
const TRAIL_SLOTS  = [56, 40, 12];

/* Permanence. The film's programs hold for 29 real minutes; here the clock is
   the SESSION's own, so a building nobody has touched for half an hour of
   session time loses its warm windows and desaturates. A touch restores it. */
const PERMANENCE_MS      = 30 * 60 * 1000;
const PERMANENCE_FADE_MS = 5 * 60 * 1000;   // how long the grey takes to arrive

/* File-type families. The footprint, the floor height and the facade colour are
   all decided here, so adding a file type is one line rather than three edits.
   w/d are the footprint inside a 1.0 lot; fh is the height of one floor. */
const TYPES = [
  { key: 'wide',   w: 0.94, d: 0.56, fh: 0.30, floors: 4, cols: 6, color: 0x3c3552 },
  { key: 'medium', w: 0.76, d: 0.70, fh: 0.30, floors: 3, cols: 5, color: 0x35405c },
  { key: 'tall',   w: 0.46, d: 0.46, fh: 0.42, floors: 6, cols: 3, color: 0x2f3450 },
  { key: 'flat',   w: 0.88, d: 0.80, fh: 0.16, floors: 1, cols: 5, color: 0x4c4639 },
  { key: 'glass',  w: 0.66, d: 0.66, fh: 0.30, floors: 2, cols: 4, color: 0x27455a },
  { key: 'small',  w: 0.40, d: 0.40, fh: 0.28, floors: 2, cols: 2, color: 0x3f3b46 },
  { key: 'shed',   w: 0.90, d: 0.52, fh: 0.20, floors: 1, cols: 5, color: 0x483c33 },
  { key: 'other',  w: 0.64, d: 0.60, fh: 0.30, floors: 3, cols: 4, color: 0x393748 },
];
const EXT_TYPE = {
  html: 0, htm: 0, php: 0, vue: 0, svelte: 0,
  css: 1, scss: 1, less: 1,
  js: 2, mjs: 2, cjs: 2, ts: 2, tsx: 2, jsx: 2,
  md: 3, txt: 3, rst: 3,
  png: 4, jpg: 4, jpeg: 4, webp: 4, gif: 4, svg: 4, mp4: 4, mov: 4, wav: 4, mp3: 4,
  json: 5, yaml: 5, yml: 5, toml: 5, xml: 5, ini: 5, csv: 5,
  sh: 6, bash: 6, py: 6, ps1: 6, bat: 6, cmd: 6, rb: 6, go: 6, rs: 6,
};
const typeOf = name => {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return EXT_TYPE[ext] !== undefined ? EXT_TYPE[ext] : 7;
};

/* The three working colours, matched to the CSS tokens so the type on top of the
   canvas and the light inside it are the same palette. */
const GOLD  = new THREE.Color(0xd2a62c);
const COOL  = new THREE.Color(0x6fa8b8);
const EMBER = new THREE.Color(0xe2703a);
const BONE  = new THREE.Color(0xe9e1d2);
/* The two TRON: Ares construct colours. Deliberately hotter and colder than
   anything the city itself is made of — the digital is the guest here. */
const LASER = new THREE.Color(0xff2a1a);   // edit / write / print / derez
const AZURE = new THREE.Color(0x5fb7ff);   // read / search
/* Trail bucket index -> colour, matching TRAIL_KEYS above. */
const TRAIL_COLORS = [LASER, AZURE, GOLD];

/* Time of day. Real: the session clock is mapped across these keyframes, so an
   8-hour export actually changes the light. Dusk is the default look, which is
   why phase 0 is dusk and not midday — a session opens at golden hour. */
const SKY_KEYS = [
  /* p, horizon,   zenith,   sun dir(normalised later), sun colour, ambient, fog */
  { p: 0.00, hz: 0xffa85c, zn: 0x33285c, sun: [-0.55, 0.16, -0.42], sc: 0xffb066, am: 0x3f3d5c, fg: 0x6b4a55 },
  { p: 0.28, hz: 0xd05f33, zn: 0x21204a, sun: [-0.42, 0.07, -0.30], sc: 0xff8a45, am: 0x30314c, fg: 0x4e2f3c },
  { p: 0.50, hz: 0x2b3358, zn: 0x080b1c, sun: [-0.20, -0.05, -0.15], sc: 0x51607f, am: 0x1a1e33, fg: 0x1b2039 },
  { p: 0.78, hz: 0x3a3f6b, zn: 0x0a0e22, sun: [0.30, 0.05, 0.22], sc: 0x6d7096, am: 0x1f2338, fg: 0x232847 },
  { p: 1.00, hz: 0xe08a6a, zn: 0x1a2a55, sun: [0.55, 0.18, 0.38], sc: 0xffbf8e, am: 0x39405e, fg: 0x5b4a58 },
];


/* =============================================================================
   PACKER — where a plate or a lot is allowed to stand
   The rule from the brief: new files get new lots WITHOUT moving what already
   stands. So every rectangle's origin corner is fixed the moment it is created,
   and a plate can only ever grow along +x/+z from that corner. A new child is
   placed at the corner point that grows its parent's bounding box the least and
   keeps it closest to square — the classic corner-point packer, which appends
   only. A squarified treemap over the *current* file set was the obvious
   alternative and was rejected for exactly one reason: it re-solves the whole
   layout every time a file appears, and a city that reshuffles while you watch
   it is unreadable.
   ========================================================================== */
function makePlate(key, name, parent, depth) {
  return {
    key, name, parent, depth,
    kids: [],          // child rects: sub-plates and lots, in local coordinates
    w: 0, h: 0,        // bounding box of kids, grown as they are added
    x: 0, z: 0,        // origin corner, in the PARENT's local space; never changes
    isPlate: true,
    labelSprite: null,
    meshIndex: -1,     // slot in the plate InstancedMesh
    files: 0,
  };
}

/* World-space origin of a rect, walking up the tree. Cheap: the tree is 3 deep. */
function worldOrigin(rect) {
  let x = 0, z = 0, n = rect;
  while (n) { x += n.x; z += n.z; n = n.parent; }
  return [x, z];
}

const rectsOverlap = (a, b, gap) => {
  const g = (gap === undefined ? PLATE_GAP : gap) * 0.5;
  return a.x < b.x + b.w + g && b.x < a.x + a.w + g &&
         a.z < b.z + b.h + g && b.z < a.z + a.h + g;
};

/* Would giving `plate` this new bounding box make it collide with one of its
   own siblings? Checked all the way up, because a plate growing pushes its
   parent's box out too. Returns true when the growth is legal. */
function growthFits(plate, w, h) {
  let node = plate;
  let nw = w + PLATE_PAD * 2, nh = h + PLATE_PAD * 2;
  while (node && node.parent) {
    /* A district may not grow its avenue past the depth that avenue reserved.
       placeIn() already refuses to SEAT a plate too deep, but a plate that is
       already seated grows through bumpBounds(), which no collision test sees
       — and one district half a unit over the cap put its street permanently in
       a state where every later probe overlapped the avenue below, so the whole
       street could only append along +x. Refusing the growth sends the district
       to an annex instead, which is what an annex is for. */
    if (node.parent.isStreet && node.z + nh > node.parent.minH - PLATE_PAD * 2) return false;
    const probe = { x: node.x, z: node.z, w: nw, h: nh };
    for (const sib of node.parent.kids) {
      if (sib === node) continue;
      if (rectsOverlap(probe, sib)) return false;
    }
    /* The parent's own box only has to grow if this child pokes out of it. */
    nw = Math.max(node.parent.w, node.x + nw);
    nh = Math.max(node.parent.h, node.z + nh);
    node = node.parent;
  }
  return true;
}

/* Place a w×h rect inside `parent`, or return null when every free corner would
   make `parent` grow into one of its own neighbours. Null is not a failure: the
   caller opens an annex, which is how a district keeps growing without a single
   building that already stands ever moving. */
function placeIn(parent, w, h, gap) {
  const kids = parent.kids;
  /* An avenue keeps its carriageway clear: nothing may be seated in the first
     STREET_ROAD units of a street's own depth, which is the strip the road mesh
     and the lamps stand on. It applies to the FIRST rect on an empty street too,
     which is why the early return reads zMin rather than zero. */
  const zMin = parent.isStreet ? STREET_ROAD : 0;
  if (!kids.length) return { x: 0, z: zMin };

  /* Candidates: the free corner just right of, and just below, every rect that
     is already there. No snapping — the corners themselves are the grid, which
     is what keeps rows of buildings aligned into streets. */
  const cands = [{ x: 0, z: zMin }];
  for (const k of kids) {
    cands.push({ x: k.x + k.w + gap, z: Math.max(zMin, k.z) });
    cands.push({ x: k.x, z: k.z + k.h + gap });
  }

  let best = null, bestScore = Infinity;
  for (const c of cands) {
    if (c.x < 0 || c.z < zMin) continue;
    /* An avenue's depth is clamped HERE and not left to growthFits() to notice.
       Measured: a street whose box crept even 0.6 of a unit past its reservation
       overlapped the avenue below on every probe from then on, so growthFits()
       refused EVERY further placement — including ones that added no depth at
       all — and the district could only ever append along +x. Twenty-six plates
       came out as a column of eight and then a ribbon of nineteen. Refusing the
       over-deep candidate up front keeps the street's own box at its
       reservation exactly, which is what keeps the row below legal. */
    if (parent.isStreet && c.z + h > parent.minH - PLATE_PAD * 2) continue;
    const probe = { x: c.x, z: c.z, w, h };
    let clash = false;
    for (const k of kids) if (rectsOverlap(probe, k, gap)) { clash = true; break; }
    if (clash) continue;
    const bw = Math.max(parent.w, c.x + w), bh = Math.max(parent.h, c.z + h);
    /* Grow the smaller side first — that one term is the difference between a
       city block and a mile-long ribbon — then prefer the corner nearest the
       plate's own origin, which is what keeps it dense. */
    /* Inside a street the aim is the opposite of square: an avenue is a LINE,
       so depth past the reserved band is punished hard and length is nearly
       free. Everywhere else the squarifying term stays exactly as it was — it
       is the difference between a city block and a mile-long ribbon. */
    const score = parent.isStreet
      ? bw * bh + Math.max(0, bh - parent.minH) * 60 + c.x * 0.02
      : bw * bh + Math.abs(bw - bh) * 3.0 + (c.x + c.z) * 0.05;
    if (score < bestScore && growthFits(parent, bw, bh)) { bestScore = score; best = c; }
  }
  return best;
}

/* Try to seat a rect inside a parent. Returns false when it does not fit, so the
   caller can annex rather than shove. The root is the one plate that can never
   run out of room, because it has no siblings to collide with. */
function addChild(parent, rect, gap) {
  const pos = placeIn(parent, rect.w, rect.h, gap === undefined ? PLATE_GAP : gap);
  if (!pos) return false;
  rect.x = pos.x; rect.z = pos.z; rect.parent = parent;
  parent.kids.push(rect);
  bumpBounds(parent);
  return true;
}
/* The last resort, for the two hosts that can never run out of room: put the
   rect past the far end of everything the host already holds. A street appends
   along its own carriageway (which is what an avenue getting longer looks
   like); the root appends past its last block. Neither can collide, because
   nothing of theirs stands out there yet. */
function appendFar(host, rect) {
  rect.x = host.w + PLATE_GAP;
  rect.z = host.isStreet ? STREET_ROAD : 0;
  rect.parent = host;
  host.kids.push(rect);
  bumpBounds(host);
}

/* A rect grew, so every ancestor's bounding box may have to. Origins never move,
   so this is the only thing that ever changes about a plate's geometry. */
function bumpBounds(plate) {
  let n = plate;
  while (n) {
    let w = 0, h = 0;
    for (const k of n.kids) { w = Math.max(w, k.x + k.w); h = Math.max(h, k.z + k.h); }
    if (n.parent) { w += PLATE_PAD * 2; h += PLATE_PAD * 2; }
    /* A street RESERVES its band the moment it opens, so an empty avenue is
       still a full-depth avenue and the next one opens below the reservation
       rather than inside it. */
    if (n.minW) w = Math.max(w, n.minW);
    if (n.minH) h = Math.max(h, n.minH);
    if (w === n.w && h === n.h) break;   // nothing above this changed either
    n.w = w; n.h = h;
    n.dirty = true;
    n = n.parent;
  }
}


/* =============================================================================
   CITY — the singleton the replay engine talks to
   ========================================================================== */
let renderer, scene, camera, composer, bloomPass;
/* Kept rather than dropped into the composer and forgotten: when a viewer walks
   into a building the pass draws the interior's scene through the same bloom,
   and swapping these two fields is the whole of it. */
let renderPass = null;
let ok = false;                      // WebGL up and running
let W = 0, H = 0;

let buildings, bShadow, plates, beacons, sparks, dust, scans, cones;
let bAttr = {};                      // the instanced float attributes, by name
let sky, ground, groundMat;
let labelGroup, droneGroup;

const files = new Map();             // rel path -> building record
const plateByKey = new Map();        // dir path -> plate
const streets = new Map();           // session id -> avenue record (one per session)
const streetOrder = [];              // avenues in the order they opened, north to south
let currentStreet = null;            // the avenue the events arriving now belong to
const drones = new Map();            // agent id -> craft record (one per agent)
const workers = new Map();           // tool_use id -> worker record (one per call)
let cityRoot = null;                 // the top plate; everything hangs off it
let bCount = 0, pCount = 0, beaconCount = 0;
let fontsReady = false;
/* Total window cells standing in the city — floors x columns, summed. The sky's
   horizon glow is scaled by this, which is what keeps the atmosphere a reading
   of the session rather than a decoration bolted on top of it. */
let windowUnits = 0;

/* Camera state. Numbers straight from the brief: 25-35 degrees of elevation, a
   full orbit every ~90 s, FOV 35, ~10% margin around the city. */
const cam = {
  theta: -0.9, phi: 0.47, dist: 40, distWant: 40,
  target: new THREE.Vector3(), targetWant: new THREE.Vector3(),
  /* The pan offset, in world units, added to whatever fitCamera() solved. It has
     to be an OFFSET and not a written target: fitCamera() re-solves targetWant
     from the city's own bounds every single frame, so anything written straight
     into the target is gone by the next one. */
  pan: new THREE.Vector3(),
  auto: true, autoPauseUntil: 0, fixed: false,
  focusPlate: null, focusUntil: 0, focusCooldown: 0,
  /* The print cue's own cooldown, so materialisations do not queue into one
     continuous close-up. See cuePrint(). */
  printCueUntil: 0,
};
/* The zoom range, as the two numbers a person can check. ZOOM_MIN is a multiple
   of the fitted distance, so it means "much closer than the fit"; CAM_NEAR and
   CAM_FLOOR are the absolute floors under it — three units from the aim point,
   two above the ground. Together: the whole city down to eye level. */
const ZOOM_MIN = 0.02, ZOOM_MAX = 3.0, CAM_NEAR = 3, CAM_FLOOR = 2;
const ORBIT_RATE = (Math.PI * 2) / 90;   // one full turn every 90 seconds
const AIM_LIFT = 0.038;                  // how far above the target the lens points
/* Framing. The city has to OWN the frame: at the old margin it spanned 43% of
   the width at four minutes in and the rest was empty ground and empty sky, so
   the wide shot read as a model on a table. FRAME_FILL is the share of the frame
   width the city's own box is fitted to; FRAME_HEAD is the sky the tallest tower
   always keeps above it. Only the top is held — see fitDistance(). */
const FRAME_FILL = 0.85;
const FRAME_HEAD = 0.08;
const WIDE_PHI = 0.42;                   // 24 degrees, the low end of the brief's 22-35
let now = 0;                             // seconds of wall time since boot
/* The SESSION's own clock, in ms, fed per event by replay.js. Wall time paces
   the animation; this one is what "untouched for 30 minutes" is measured in,
   so a seek lands every building on the age a forward play would have given
   it rather than on the age of the seek itself. */
let sessionNow = 0;

/* Burst detection: >= 8 `tool` events in one district inside 3 s earns a
   close-up — see updateCamera() for why the threshold moved. */
const burstLog = [];


/* =============================================================================
   BOOT
   ========================================================================== */
export function init(canvas) {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false,
                                         powerPreference: 'high-performance' });
  } catch (_) { return false; }
  if (!renderer.getContext()) return false;

  /* Cap at 1.5, not the device's 2: on the integrated GPU this is the single
     biggest lever on frame rate and the difference is invisible at this scale. */
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.5, 900);

  buildSky();
  buildGround();
  buildPlates();
  buildBuildings();
  buildParticles();
  buildBeams();
  buildTrails();
  buildPrintRigs();
  buildSiteCones();
  labelGroup = new THREE.Group(); scene.add(labelGroup);
  droneGroup = new THREE.Group(); scene.add(droneGroup);

  cityRoot = makePlate('', 'session', null, 0);

  attachPointer(canvas);
  attachPicker(canvas);
  attachControls();
  attachInteriorTouch(canvas);
  /* Everything the interior is allowed to know about the city, in one object.
     It never reaches into this module's state; this is the whole seam.
     BEFORE resize(), not after: resize() is what hands the interior camera its
     aspect ratio, and an interior that does not exist yet quietly keeps the
     PerspectiveCamera default of 1 — which draws every wall of source a third
     too wide and pushes the line numbers off the left of the frame. */
  Interior.attach({
    createSky,
    sessionClock: () => sessionNow,
    cameraPose: () => ({ pos: camera.position.clone(),
                         look: new THREE.Vector3(cam.target.x,
                                                 cam.target.y + cam.dist * AIM_LIFT,
                                                 cam.target.z) }),
    overrideCamera,
    doorPose,
    setBuildingOpen,
    workersFor,
    filesOfPlate,
  });
  resize();
  cam.fixed = new URLSearchParams(location.search).get('camera') === 'fixed';

  /* The scene draws text into canvas textures. Doing that before the webfont has
     loaded bakes Arial into the texture permanently — a texture is not restyled
     when a font arrives later, which is why this waits instead of re-rendering. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { fontsReady = true; refreshLabels(); });
  } else fontsReady = true;

  ok = true;
  /* The crowd, started and NOT awaited — Life.load() decimates eighteen meshes
     and takes about twenty seconds, and the city has to be on screen long
     before that. Everything in the LIFE section is guarded on `life`. */
  loadLife();
  return true;
}

export const ready = () => ok;
export const buildingCount = () => bCount;
/* Live craft in the air, for the frame-rate gate in RUNBOOK.md. */
export const droneCount = () => drones.size;
/* Worker drones in the air — one per tool call still running. */
export const workerCount = () => workers.size;
/* The session clock, fed per event so a seek ages buildings correctly. */
export function setSessionClock(ms) { sessionNow = ms || 0; }
/* Buildings materialising right now, and craft derezzing right now. Both exist
   for the capture harness in RUNBOOK.md: a print lasts 1.2 s and a derez under
   half of one, so the only way to photograph either is to poll for it. */
export const printingCount = () => printJobs.length;
/* The print, in numbers, for the duration row in RUNBOOK.md: how many are
   running, how long the longest one is scheduled to take, and how far through
   it is. A stopwatch on a screenshot cannot answer any of the three. */
export const printProbe = () => {
  let seconds = 0, k = 1;
  for (const j of printJobs) {
    if (j.after > 0) continue;
    if (j.life > seconds) seconds = j.life;
    k = Math.min(k, j.t / j.life);
  }
  /* flash.peak is flashValue() itself — the exact 0..1 the shader is fed for
     the hottest facade cooling right now — for the overexposure gate in
     RUNBOOK.md: peak and t(50%) can't be read off a screenshot either. */
  let flashPeak = 0;
  for (const f of flashJobs) flashPeak = Math.max(flashPeak, flashValue(f.t));
  return { jobs: printJobs.length, seconds: Math.round(seconds * 100) / 100,
           k: Math.round(k * 100) / 100, cue: !!(cam.focusPlate && cam.focusPlate.isLot && now < cam.focusUntil),
           flash: { jobs: flashJobs.length, peak: Math.round(flashPeak * 1000) / 1000 } };
};
/* Is the camera inside a street intro this instant? Same reason as the two
   above: the intro lasts three seconds at an unpredictable moment, so the only
   way to photograph `project-street.png` is to poll for it. */
export const inStreetIntro = () =>
  !!(cam.focusPlate && cam.focusPlate.isStreet && now < cam.focusUntil);
/* Anything coming apart RIGHT NOW — craft mid-glitch, craft mid-voxel-fall, and
   buildings mid-tear. The glitch pre-roll is counted deliberately: it is the
   half of a derez the harness has to catch for `docs/shots/city-derez.png`. */
export const derezCount = () => {
  let n = glitchJobs.length;
  for (const d of drones.values()) if (d.leaving || d.glitch) n++;
  return n;
};


/* =============================================================================
   SKY — one inverted sphere, a two-stop gradient, no texture
   The whole time-of-day system is four uniforms on this shader plus the fog
   colour; nothing else in the scene knows what hour it is.
   ========================================================================== */
const sunDir = new THREE.Vector3(-0.55, 0.16, -0.42).normalize();
const sunColor = new THREE.Color(0xffb066);
const ambient = new THREE.Color(0x3a3b58);
const fogColor = new THREE.Color(0x6a4a52);
const hzColor = new THREE.Color(0xff9a4e);
const znColor = new THREE.Color(0x1c2350);

function buildSky() {
  sky = createSky();
  scene.add(sky);
}

/* The dome on its own, with nothing attached to it. Split out of buildSky() so
   vault.js can stand the same sky over the second city without importing this
   file's scene — see the SHARED PRIMITIVES banner at the end of this file. The
   uniforms hold the module's own colour objects, so setPhase() moves both
   cities' light with one call. */
export function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uHorizon: { value: hzColor }, uZenith: { value: znColor },
      uSun: { value: sunDir }, uSunColor: { value: sunColor },
      /* The three the frame loop writes: seconds since boot (the star drift),
         how much of the city is lit (the haze), and how far into the night the
         session clock has walked (the stars at all). */
      uTime: { value: 0 }, uGlow: { value: 0 }, uNight: { value: 0 },
      /* The camera's own up and forward, plus tan(fov/2). The star field is
         gated on where a pixel sits IN THE FRAME, and these three turn a view
         direction into that answer — see the fragment shader. */
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uTanV: { value: 0.315 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      /* highp, not mediump: the star hash multiplies a quantised direction by
         four-figure constants, and at mediump that arithmetic loses its low bits
         and the stars come out in blocks instead of points. */
      precision highp float;
      uniform vec3 uHorizon, uZenith, uSun, uSunColor;
      uniform float uTime, uGlow, uNight, uTanV;
      uniform vec3 uCamUp, uCamFwd;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        /* pow(): the warm band has to hug the horizon or the whole sky goes
           orange and the city loses its blue. */
        float t = clamp(d.y, -0.2, 1.0);
        /* A wide band, not a thin line: at 27 degrees of elevation the upper
           two thirds of the frame is sky, and a tight horizon glow leaves all of
           it black. The band has to reach most of the way to the zenith. */
        vec3 c = mix(uHorizon, uZenith, smoothstep(-0.05, 0.92, t));
        /* Evening haze sitting on the horizon all the way round, not only where
           the sun is: at dusk the whole rim of the sky is lit, and this is what
           puts the city in front of something instead of in a void. */
        c += uHorizon * 0.34 * (1.0 - smoothstep(0.0, 0.26, abs(t)));
        /* The sun is a wide bloom on the horizon, never a disc: a disc in frame
           would blow out the buildings the shot is actually about. */
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += uSunColor * pow(s, 3.5) * 0.62 * (1.0 - smoothstep(0.0, 0.55, d.y));
        /* The city's own light spilling up into the air above it. This is the
           one thing in the sky that is data: uGlow is the window budget the
           facade shader lights from, so the haze thickens as real files arrive
           and real edits add floors, and an empty session has none of it. It
           takes the sky's OWN horizon colour, so it can never become a purple
           wash sitting on top of an orange dusk. */
        c += uHorizon * (1.0 - smoothstep(0.0, 0.22, abs(t))) * uGlow * 0.55;
        /* Stars, in the top of the frame only and only once the session clock
           has walked into the night keyframes. Hashed off the direction so a
           star sits still while the camera orbits, and the whole field turns
           once every seventeen minutes so the sky is not a photograph. */
        if (uNight > 0.01) {
          /* Top 40% of the FRAME, and it has to be the frame and not the sky's
             own elevation: this camera looks DOWN at a city from 24 degrees up,
             so every direction inside the picture is below the true horizon and
             an elevation gate puts no stars anywhere at all. Projecting the view
             direction onto the camera's own up and forward gives the normalised
             device y directly — 1.0 is the top edge, so 0.2 is the four-tenths
             line the stars fade in across. */
          float ndcY = dot(d, uCamUp) / (max(0.02, dot(d, uCamFwd)) * uTanV);
          float top = smoothstep(0.14, 0.34, ndcY);
          float a = uTime * 0.006;
          vec3 sd = vec3(d.x * cos(a) - d.z * sin(a), d.y, d.x * sin(a) + d.z * cos(a));
          vec3 q = floor(sd * 170.0);
          float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          c += vec3(0.86, 0.89, 1.0) * smoothstep(0.9955, 0.9995, h) * top * uNight * 0.85;
        }
        /* Below the horizon the dome darkens into the ground haze. */
        c = mix(c * 0.55, c, smoothstep(-0.30, 0.03, d.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), mat);
  dome.frustumCulled = false;
  return dome;
}


/* =============================================================================
   GROUND — the plane the project sits on
   A shader, not a texture: a faint street grid that fades into the fog, so the
   city has a floor without a 2048px image to download.
   ========================================================================== */
function buildGround() {
  ground = createGround();
  groundMat = ground.material;
  scene.add(ground);
}

/* The plane on its own. Split out for vault.js, same reason as createSky(). */
export function createGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFog: { value: fogColor }, uGrid: { value: new THREE.Color(0x3b3550) },
      uBase: { value: new THREE.Color(0x14121c) }, uCenter: { value: new THREE.Vector3() },
    },
    /* The plane dissolves at its far end instead of ending, so it is drawn with
       the transparent pass. It writes no depth and goes first among them: it is
       the lowest thing in the scene and there is nothing it needs to hide. */
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3 uFog, uGrid, uBase, uCenter;
      varying vec3 vW;
      void main() {
        /* One faint street line every eight units. Anything denser or brighter
           than this stops reading as asphalt and starts reading as graph paper,
           which is the one thing this picture must never look like. */
        vec2 g = abs(fract(vW.xz * 0.125) - 0.5);
        float line = smoothstep(0.485, 0.5, max(g.x, g.y));
        vec3 c = mix(uBase, uGrid, line * 0.10);
        float d = length(vW.xz - uCenter.xz);
        /* Haze eats the ground well before the plane's own edge, so the horizon
           is a soft band of evening air and not a seam. */
        c = mix(c, uFog, smoothstep(25.0, 90.0, d));
        /* And then the plane fades OUT rather than to a fog colour. This is what
           gives the picture a horizon at all: from a camera 24 degrees up, a
           900-unit plane covers every pixel of the frame, so what looked like
           sky in the upper half was the plane's own fog — no sky shader could
           reach it, and the top of the frame was one flat wash. Dissolved, the
           real dome shows through above the far streets, and the horizon haze
           and the stars are in the shot where they belong. */
        gl_FragColor = vec4(c, 1.0 - smoothstep(38.0, 96.0, d));
      }`,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.02;
  plane.renderOrder = -1;
  return plane;
}


/* =============================================================================
   PLATES — one raised slab per directory, nested for sub-directories
   Instanced boxes with a border drawn in the fragment shader: a real border mesh
   would be a second draw call per plate and a hundred plates is a hundred draws.
   ========================================================================== */
function buildPlates() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);           // sit on the ground, not through it
  const aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLATES * 2), 2);
  const aTone = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLATES), 1);
  geo.setAttribute('aSize', aSize);
  geo.setAttribute('aTone', aTone);

  const mat = createPlateMaterial();
  plates = new THREE.InstancedMesh(geo, mat, MAX_PLATES);
  plates.count = 0;
  plates.frustumCulled = false;
  scene.add(plates);
}

/* The slab program: aSize (the plate's world footprint) and aTone (its nesting
   depth) come in as instanced attributes. Split out for vault.js — a district
   in the vault city is the same slab as a directory in the session city. */
export function createPlateMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir }, uSunColor: { value: sunColor }, uAmbient: { value: ambient },
      uFog: { value: fogColor }, uEdge: { value: new THREE.Color(0x8f8bb4) },
      uFogDensity: { value: 0.00010 },
    },
    vertexShader: /* glsl */`
      attribute vec2 aSize; attribute float aTone;
      varying vec3 vN; varying vec2 vUv, vSize; varying float vTone, vDepth;
      void main() {
        vec4 w = instanceMatrix * vec4(position, 1.0);
        vec4 mv = modelViewMatrix * w;
        gl_Position = projectionMatrix * mv;
        vN = normal; vUv = uv; vSize = aSize; vTone = aTone; vDepth = -mv.z;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3 uSun, uSunColor, uAmbient, uFog, uEdge;
      uniform float uFogDensity;
      varying vec3 vN; varying vec2 vUv, vSize; varying float vTone, vDepth;
      void main() {
        vec3 base = mix(vec3(0.055, 0.052, 0.075), vec3(0.085, 0.080, 0.105), vTone);
        float ndl = max(dot(normalize(vN), normalize(uSun)), 0.0);
        /* Half the sun the buildings get: a plate is ground, and ground at
           dusk is the darkest thing in the frame. */
        vec3 c = base * (uAmbient * 0.9 + uSunColor * ndl * 0.22);
        if (vN.y > 0.5) {
          /* Distance to the nearest edge, in world units, so the border is the
             same weight on a small plate and a large one. */
          vec2 p = vUv * vSize;
          float d = min(min(p.x, vSize.x - p.x), min(p.y, vSize.y - p.y));
          c += uEdge * (1.0 - smoothstep(0.0, 0.14, d)) * 0.26;
        }
        float f = 1.0 - exp(-uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(c, uFog, clamp(f, 0.0, 0.88)), 1.0);
      }`,
  });
}


/* =============================================================================
   BUILDINGS — one InstancedMesh, one facade shader, four live floats each
   ========================================================================== */
const dummy = new THREE.Object3D();

function buildBuildings() {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);

  const mk = (n, size) => new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUILDINGS * size), size);
  bAttr = {
    aFloors: mk('aFloors', 1), aType: mk('aType', 1), aSeed: mk('aSeed', 1),
    aWarm: mk('aWarm', 1), aLit: mk('aLit', 1), aRise: mk('aRise', 1), aCols: mk('aCols', 1),
    /* THREE FLOATS IN ONE ATTRIBUTE, and the reason is a hard limit rather
       than tidiness: GL guarantees only 16 vertex attribute slots, and with
       position, normal, uv and the four rows of instanceMatrix this shader was
       already standing on exactly 16. A tenth float would not link — SwiftShader
       says "Too many attributes" and the city does not draw at all. So the three
       that are written by the same three functions ride together:
         x  the world height the laser print has reached, sweeping DOWN from the
            roof; everything below it does not exist yet and is discarded. -1
            means printed, which is every building not mid-materialisation.
         y  the pointer is over this building: a thin gold rim on its edges.
         z  the facade is opening because somebody is walking in. */
    aState: mk('aState', 3),
    /* Permanence, 0..1: how far this building has faded toward grey for not
       having been touched in PERMANENCE_MS of session time. */
    aGrey: mk('aGrey', 1),
  };
  for (const k in bAttr) geo.setAttribute(k, bAttr[k]);
  /* x only: printY starts at "already printed", hover and open start at zero. */
  for (let i = 0; i < MAX_BUILDINGS; i++) bAttr.aState.array[i * 3] = -1;

  buildings = new THREE.InstancedMesh(geo, makeBuildingMaterial(), MAX_BUILDINGS);
  buildings.count = 0;
  buildings.frustumCulled = false;
  scene.add(buildings);

  /* Contact shadows. Not a shadow map: one 1024 map costs a whole extra scene
     pass per frame and buys almost nothing at this camera distance, while a soft
     dark quad under each building reads as grounded from any angle. It shares
     the buildings' own aRise buffer, so a shadow can never be out of step with
     the building above it. */
  const sgeo = new THREE.PlaneGeometry(1, 1);
  sgeo.rotateX(-Math.PI / 2);
  sgeo.setAttribute('aRise', bAttr.aRise);
  const smat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aRise; varying vec2 vUv; varying float vRise;
      void main() {
        vUv = uv; vRise = aRise;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; varying vec2 vUv; varying float vRise;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        gl_FragColor = vec4(0.02, 0.02, 0.05, (1.0 - smoothstep(0.25, 1.0, d)) * 0.55 * clamp(vRise, 0.0, 1.0));
      }`,
  });
  bShadow = new THREE.InstancedMesh(sgeo, smat, MAX_BUILDINGS);
  bShadow.count = 0;
  bShadow.frustumCulled = false;
  bShadow.renderOrder = -1;
  scene.add(bShadow);
}

/* The facade program. Written as a function because the facade palette has to be
   baked in as a constant array — an array uniform indexed by a varying is the
   one thing GLSL ES 1.0 will not do reliably across drivers. */
function makeBuildingMaterial() {
  const pal = TYPES.map(t => {
    const c = new THREE.Color(t.color);
    return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  }).join(', ');

  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: sunDir }, uSunColor: { value: sunColor }, uAmbient: { value: ambient },
      uFog: { value: fogColor }, uFogDensity: { value: 0.00010 },
      uWindow: { value: new THREE.Color(0xffc27a) },
      uWarmColor: { value: new THREE.Color(0xff8a3c) },
      uTime: { value: 0 }, uIdle: { value: 0 },
      uLaser: { value: LASER },
    },
    vertexShader: /* glsl */`
      attribute float aFloors, aType, aSeed, aWarm, aLit, aRise, aCols, aGrey;
      attribute vec3 aState;              /* printY, hover, open — see bAttr */
      varying vec3 vLocal, vNorm;
      varying float vRow, vSeed, vWarm, vLit, vCols, vType, vWorldY, vDepth;
      varying float vPrintY, vGrey, vHover, vOpen;
      void main() {
        vec3 p = position;
        p.y *= aRise;
        vec4 w = instanceMatrix * vec4(p, 1.0);
        vec4 mv = modelViewMatrix * w;
        gl_Position = projectionMatrix * mv;
        vLocal = position;
        vRow   = position.y * aFloors;   /* window rows are floors, not UV */
        vNorm  = normal;                 /* boxes never rotate: no normal matrix */
        vSeed = aSeed; vWarm = aWarm; vLit = aLit; vCols = aCols; vType = aType;
        vWorldY = w.y; vDepth = -mv.z;
        vPrintY = aState.x; vGrey = aGrey;
        vHover = aState.y; vOpen = aState.z;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uSun, uSunColor, uAmbient, uFog, uWindow, uWarmColor, uLaser;
      uniform float uFogDensity, uTime, uIdle;
      varying vec3 vLocal, vNorm;
      varying float vRow, vSeed, vWarm, vLit, vCols, vType, vWorldY, vDepth;
      varying float vPrintY, vGrey, vHover, vOpen;

      const vec3 PAL[8] = vec3[8](${pal});

      float hash(vec2 c) {
        return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        /* MATERIALISATION. The print plane sweeps down from the roof, and what
           is below it has not been printed yet — so it is not drawn. Discard,
           not a scale: a building that grows upward out of the ground is a
           building being BUILT, and this one is being laser-printed into the
           world from above, which is a different physical claim. */
        if (vWorldY < vPrintY) discard;

        /* OPENING. The facade of the building being walked into comes apart on
           an ordered 4x4 dither keyed to the pixel, so the wall thins out
           evenly instead of dimming — what is behind it is the room, and a
           half-transparent wall in front of a room is not a door. */
        if (vOpen > 0.001) {
          vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
          float bayer = (q.y * 4.0 + q.x) / 16.0;
          if (bayer < vOpen) discard;
        }

        int ti = int(vType + 0.5);
        vec3 facade = PAL[0];
        for (int i = 0; i < 8; i++) if (i == ti) facade = PAL[i];

        vec3 n = normalize(vNorm);
        vec3 emis = vec3(0.0);

        if (abs(n.y) < 0.5) {
          /* Which of the two side axes is across this face. */
          float u = (abs(n.x) > 0.5) ? vLocal.z : vLocal.x;
          float cu = (u + 0.5) * vCols;
          vec2 cell = vec2(floor(cu), floor(vRow));
          vec2 f = vec2(fract(cu), fract(vRow));
          /* A pane with a mullion around it, softened so it does not shimmer
             when the camera orbits. */
          float pane = smoothstep(0.20, 0.28, f.x) * smoothstep(0.80, 0.72, f.x)
                     * smoothstep(0.24, 0.32, f.y) * smoothstep(0.78, 0.70, f.y);
          float h = hash(cell + vec2(vSeed * 91.7, vSeed * 13.1));
          /* Reads light windows: vLit raises the share of lit panes. The ground
             floor is always lit, which is what makes a one-floor file read as a
             building rather than a brick. */
          float p = 0.34 + vLit * 0.46 + (vRow < 1.0 ? 0.30 : 0.0);
          float on = step(h, p);
          /* Rare flicker, and only while the city is idle: motion where nothing
             is happening would be inventing activity. */
          float flick = 1.0 - uIdle * 0.35 * step(0.985, fract(sin(h * 431.0 + uTime * 0.7) * 0.5 + 0.5));
          emis += uWindow * pane * on * flick * (0.95 + vWarm * 1.3);
          facade *= 0.82 + 0.18 * (1.0 - pane);
        } else if (n.y > 0.5) {
          facade *= 0.55;                       /* tar roof */
        }

        float ndl = max(dot(n, normalize(uSun)), 0.0);
        /* Fake AO: the street is darker than the parapet. Cheaper than any real
           occlusion and it is the thing that makes rows of buildings read as a
           street rather than as a bar chart. */
        float ao = mix(0.42, 1.0, smoothstep(0.0, 1.4, vWorldY));
        vec3 c = facade * (uAmbient + uSunColor * ndl * 0.85) * ao;
        /* PERMANENCE. Untouched for half an hour of session time, a building
           loses its warm windows first and its colour second — the light goes
           out before the paint does, which is how an empty building reads. */
        emis *= 1.0 - vGrey * 0.94;
        c += emis;
        c += uWarmColor * vWarm * 0.55;         /* a fresh edit glows, then cools */
        if (vGrey > 0.002) {
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          c = mix(c, vec3(lum) * 0.78, vGrey);
        }
        /* The cutting edge of the print, a hot red line riding the plane down. */
        if (vPrintY > -0.5) {
          c += uLaser * smoothstep(0.10, 0.0, vWorldY - vPrintY) * 2.4;
        }
        /* THE FLASH. A facade that has just finished printing is white-hot for a
           beat and then cools. It rides the SAME float as the print plane rather
           than a seventeenth attribute, because a seventeenth attribute stops
           the program linking on this GPU and the city goes black (selfCheck()).
           aState.x is -1 when nothing is happening and -1-flash while cooling,
           so the discard above — which only ever fires on a positive plane —
           never sees it. */
        float flash = max(0.0, -1.0 - vPrintY);
        if (flash > 0.001) {
          /* 0.9, not the 2.6 the close view was drawn at: with bloom on, three
             facades flashing at once at 2.6 blew the whole frame to white and
             the city behind them disappeared. At 0.55 the shell reads as white
             hot and its windows are still windows. */
          c += vec3(1.0, 0.93, 0.86) * flash * 0.55;
        }
        /* CLAMP BEFORE BLOOM. A print's flash stacks on top of the facade's own
           emissive (window glow, warm-edit glow, the laser line) and without a
           ceiling the sum went over the bloom pass's threshold for long enough
           to read as a solid white block for seconds, not a flash. 1.6 is
           comfortably above the ~1.0 a normal lit facade reaches and still under
           where SwiftShader's/the real GPU's bloom saturates a whole panel. */
        c = min(c, vec3(1.6));

        /* HOVER RIM. The pointer is on this building: a gold line along the
           edges of the box only. vLocal is the unit box, so the distance to
           the nearest edge of the face is exactly what decides the width, and
           the rim is the same 1.5% of the box however tall the tower is. */
        if (vHover > 0.001) {
          vec2 e = (abs(n.y) > 0.5) ? vec2(vLocal.x, vLocal.z)
                 : (abs(n.x) > 0.5) ? vec2(vLocal.z, vLocal.y)
                                    : vec2(vLocal.x, vLocal.y);
          float edge = 0.5 - max(abs(e.x), abs(e.y));
          c += vec3(0.82, 0.65, 0.17) * smoothstep(0.030, 0.0, edge) * vHover * 2.2;
        }

        float f = 1.0 - exp(-uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(mix(c, uFog, clamp(f, 0.0, 0.9)), 1.0);
      }`,
  });
}


/* =============================================================================
   PARTICLES — one Points system for every spark, ember and puff of steam
   Welding sparks, dust puffs and shell steam are the same object with different
   numbers. One buffer, one draw call, a hard cap, and dead particles are swapped
   with the last live one so there is never a gap to skip over.
   ========================================================================== */
let pPos, pCol, pSize, pAlpha, pBox, pLive = 0;
const pVel = new Float32Array(MAX_PARTICLES * 3);
const pLife = new Float32Array(MAX_PARTICLES);
const pAge = new Float32Array(MAX_PARTICLES);
const pDrag = new Float32Array(MAX_PARTICLES);
const pGrav = new Float32Array(MAX_PARTICLES);

function buildParticles() {
  const geo = new THREE.BufferGeometry();
  pPos = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
  pCol = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
  pSize = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
  pAlpha = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
  /* 0 = a soft round mote (spark, dust, steam), 1 = a hard-edged square. Derez
     debris has to read as VOXELS — a program falling apart into its own pixels —
     and a soft dot reads as a spark, which is the opposite claim. One float in
     the buffer is cheaper than a second Points system with its own draw call. */
  pBox = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
  geo.setAttribute('position', pPos);
  geo.setAttribute('aColor', pCol);
  geo.setAttribute('aSize', pSize);
  geo.setAttribute('aAlpha', pAlpha);
  geo.setAttribute('aBox', pBox);
  geo.setDrawRange(0, 0);

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor; attribute float aSize, aAlpha, aBox;
      uniform float uScale;
      varying vec3 vC; varying float vA, vB;
      void main() {
        vC = aColor; vA = aAlpha; vB = aBox;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; varying vec3 vC; varying float vA, vB;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float dot_ = 1.0 - smoothstep(0.0, 1.0, d);
        /* Chebyshev distance instead of Euclidean gives a square with a one-
           pixel edge — a voxel, not a blob. */
        vec2 q = abs(gl_PointCoord - 0.5) * 2.0;
        float box = 1.0 - smoothstep(0.72, 0.92, max(q.x, q.y));
        gl_FragColor = vec4(vC, vA * mix(dot_, box, vB));
      }`,
  });
  sparks = new THREE.Points(geo, mat);
  sparks.frustumCulled = false;
  scene.add(sparks);

  buildDust();
  buildBeacons();
  buildLamps();
}

/* Add one particle. Silently dropped past the cap: a burst of two hundred events
   in one second must lose sparks rather than lose the frame. */
function emit(x, y, z, vx, vy, vz, color, size, life, drag, grav, box) {
  if (pLive >= MAX_PARTICLES) return;
  const i = pLive++;
  pPos.array[i * 3] = x; pPos.array[i * 3 + 1] = y; pPos.array[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol.array[i * 3] = color.r; pCol.array[i * 3 + 1] = color.g; pCol.array[i * 3 + 2] = color.b;
  pSize.array[i] = size; pAlpha.array[i] = 1; pBox.array[i] = box || 0;
  pLife[i] = life; pAge[i] = 0; pDrag[i] = drag; pGrav[i] = grav;
}

/* Age, move and retire every live particle. Walked backwards and compacted by
   swapping the dead one with the last live one, so the buffer is always a solid
   run from 0 to pLive and the draw call never has to skip a hole. */
function stepParticles(dt) {
  for (let i = pLive - 1; i >= 0; i--) {
    pAge[i] += dt;
    if (pAge[i] >= pLife[i]) {
      const j = --pLive;                    // swap the dead one with the last live
      if (i !== j) {
        for (let k = 0; k < 3; k++) {
          pPos.array[i * 3 + k] = pPos.array[j * 3 + k];
          pCol.array[i * 3 + k] = pCol.array[j * 3 + k];
          pVel[i * 3 + k] = pVel[j * 3 + k];
        }
        pSize.array[i] = pSize.array[j]; pAlpha.array[i] = pAlpha.array[j];
        pBox.array[i] = pBox.array[j];
        pLife[i] = pLife[j]; pAge[i] = pAge[j]; pDrag[i] = pDrag[j]; pGrav[i] = pGrav[j];
      }
      continue;
    }
    /* Drag as pow(k, dt), not k*dt: framerate-independent, so a spark travels
       the same arc at 60 fps and at 30. */
    const d = Math.pow(pDrag[i], dt);
    pVel[i * 3] *= d; pVel[i * 3 + 1] = pVel[i * 3 + 1] * d + pGrav[i] * dt; pVel[i * 3 + 2] *= d;
    pPos.array[i * 3] += pVel[i * 3] * dt;
    pPos.array[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos.array[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pAlpha.array[i] = 1 - pAge[i] / pLife[i];
  }
  sparks.geometry.setDrawRange(0, pLive);
  pPos.needsUpdate = pCol.needsUpdate = pSize.needsUpdate = pAlpha.needsUpdate = true;
  pBox.needsUpdate = true;
}


/* =============================================================================
   DUST — motes hanging in the light
   Static positions, drifted entirely in the vertex shader, so the whole layer
   costs one draw call and zero CPU per frame.
   ========================================================================== */
function buildDust() {
  const N = 520;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = Math.random() * 16 + 0.4;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    seed[i] = Math.random() * 100;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffd9a8) },
                uCenter: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute float aSeed; uniform float uTime; uniform vec3 uCenter;
      varying float vA;
      void main() {
        vec3 p = position + uCenter;
        p.x += sin(uTime * 0.19 + aSeed) * 1.6;
        p.y += sin(uTime * 0.11 + aSeed * 2.3) * 0.9;
        p.z += cos(uTime * 0.16 + aSeed * 1.7) * 1.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.4 + sin(aSeed * 3.0) * 0.7) * 90.0 / max(-mv.z, 1.0);
        vA = 0.16 + 0.12 * sin(uTime * 0.5 + aSeed * 5.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, vA * (1.0 - smoothstep(0.0, 1.0, d)));
      }`,
  });
  dust = new THREE.Points(geo, mat);
  dust.frustumCulled = false;
  scene.add(dust);
}


/* =============================================================================
   BEACONS — the light on top of a capped tower
   A building that has hit FLOOR_CAP cannot show any more edits by growing, so it
   shows them by keeping a beacon lit. Persistent points, pulsed in the shader.
   ========================================================================== */
/* =============================================================================
   STREET LAMPS — one instanced post per lamp, lit or dim by its avenue
   A live session's street is lit and a finished one's is dim, and that is the
   only difference between them a viewer has to read from across the city. One
   InstancedMesh for every lamp in the city: twelve avenues is up to ~300 posts,
   and 300 meshes here would cost more than the entire building layer.
   ========================================================================== */
let lamps, lampLit, lampCount = 0, lampsDirty = false;
function buildLamps() {
  const geo = new THREE.CylinderGeometry(0.035, 0.055, 1, 5);
  geo.translate(0, 0.5, 0);           // stand on the road, not through it
  lampLit = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS), 1);
  geo.setAttribute('aLit', lampLit);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uWarm: { value: GOLD }, uCold: { value: new THREE.Color(0x2a2734) } },
    vertexShader: /* glsl */`
      attribute float aLit; varying float vLit, vY;
      void main() {
        vLit = aLit; vY = position.y;    // 0 at the foot, 1 at the lamp head
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3 uWarm, uCold; varying float vLit, vY;
      void main() {
        /* The head is the top fifth of the post; the column itself stays dark
           so a lit street reads as a row of points, not a row of sticks. */
        float head = smoothstep(0.80, 0.94, vY);
        vec3 c = mix(uCold, uWarm * 0.35, vLit * 0.5);
        c = mix(c, uWarm * (0.55 + 2.2 * vLit), head);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  lamps = new THREE.InstancedMesh(geo, mat, MAX_LAMPS);
  lamps.count = 0;
  lamps.frustumCulled = false;
  scene.add(lamps);
}

/* Re-lay every lamp in the city. Called only when an avenue's length or its
   live flag actually changed — never per frame. Rebuilding all of them rather
   than patching one street's run is deliberate: it is a few hundred matrix
   writes on an event that happens a handful of times a session, and it keeps
   the "which slot belongs to whom" bookkeeping out of the file entirely. */
function syncLamps() {
  lampCount = 0;
  for (const s of streetOrder) {
    const [sx, sz] = worldOrigin(s);
    const n = Math.max(2, Math.floor(s.w / LAMP_SPACING) + 1);
    for (let i = 0; i < n && lampCount < MAX_LAMPS; i++) {
      /* Both kerbs: the near one at the road's outer edge, the far one against
         the first row of plates, so the carriageway is between two lines. */
      const z = sz + (i % 2 ? 0.28 : STREET_ROAD - 0.28);
      dummy.position.set(sx + i * LAMP_SPACING * 0.5, 0.30, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1.35, 1);
      dummy.updateMatrix();
      lamps.setMatrixAt(lampCount, dummy.matrix);
      lampLit.array[lampCount] = s.live ? 1 : 0.12;
      lampCount++;
    }
  }
  lamps.count = lampCount;
  lamps.instanceMatrix.needsUpdate = true;
  lampLit.needsUpdate = true;
}


let beaconPos, beaconPhase;
function buildBeacons() {
  const geo = new THREE.BufferGeometry();
  beaconPos = new THREE.BufferAttribute(new Float32Array(MAX_BEACONS * 3), 3);
  beaconPhase = new THREE.BufferAttribute(new Float32Array(MAX_BEACONS), 1);
  geo.setAttribute('position', beaconPos);
  geo.setAttribute('aPhase', beaconPhase);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: EMBER } },
    vertexShader: /* glsl */`
      attribute float aPhase; uniform float uTime; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = 0.35 + 0.65 * pow(max(sin(uTime * 2.2 + aPhase), 0.0), 3.0);
        gl_PointSize = 9.0 * 300.0 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; uniform vec3 uColor; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColor, vA * (1.0 - smoothstep(0.0, 1.0, d)));
      }`,
  });
  beacons = new THREE.Points(geo, mat);
  beacons.frustumCulled = false;
  scene.add(beacons);
}


/* =============================================================================
   BEAMS — the read scan and the search cone
   Both are pools of hidden meshes rather than objects created per event: a
   session fires thousands of tool calls, and allocating geometry on each one is
   how a replay turns into a garbage-collection stutter.
   ========================================================================== */
const scanPool = [], conePool = [];
function buildBeams() {
  const sgeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < MAX_SCANS; i++) {
    const m = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({
      color: COOL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false; m.userData = { t: 0, life: 0, h: 1, y0: 0 };
    scene.add(m); scanPool.push(m);
  }
  const cgeo = new THREE.ConeGeometry(1, 1, 20, 1, true);
  cgeo.translate(0, -0.5, 0);          // apex at the drone, mouth on the ground
  for (let i = 0; i < MAX_CONES; i++) {
    const m = new THREE.Mesh(cgeo, new THREE.MeshBasicMaterial({
      color: COOL, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    m.visible = false; m.userData = { t: 0, life: 0, plate: null, from: new THREE.Vector3() };
    scene.add(m); conePool.push(m);
  }
}
const freeOf = pool => pool.find(m => !m.visible) || null;


/* =============================================================================
   LIGHT TRAILS — the ribbon every craft and worker drags behind it
   TRON's light cycles leave a wall; a drone here leaves a thin ribbon that
   fades over 1.5 s, and its colour says what the drone is DOING: red-hot for
   edit and write, cool blue for read and search, gold for the orchestrator.

   Three merged geometries, one per colour, and nothing is allocated after boot.
   A ribbon needs a strip of quads that always face the camera, which is per-
   vertex geometry — a Line would be one pixel wide at any distance and would
   not bloom. Each slot owns a fixed run of (SEG+1)*2 vertices inside its
   colour's buffer; an unused slot collapses its whole run onto one point with
   zero alpha, so it costs a handful of degenerate triangles the rasteriser
   throws away rather than a draw call of its own.
   ========================================================================== */
const trailBuckets = [];

function buildTrails() {
  for (let bi = 0; bi < TRAIL_KEYS.length; bi++) {
    const slots = TRAIL_SLOTS[bi];
    const verts = slots * (TRAIL_SEG + 1) * 2;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    const al = new THREE.BufferAttribute(new Float32Array(verts), 1);
    geo.setAttribute('position', pos);
    geo.setAttribute('aAlpha', al);
    /* Indices are fixed for the life of the page: slot s, segment i is the quad
       between vertex pairs i and i+1 inside that slot's own run. */
    const idx = new Uint16Array(slots * TRAIL_SEG * 6);
    let o = 0;
    for (let s = 0; s < slots; s++) {
      const base = s * (TRAIL_SEG + 1) * 2;
      for (let i = 0; i < TRAIL_SEG; i++) {
        const a = base + i * 2;
        idx[o++] = a; idx[o++] = a + 1; idx[o++] = a + 2;
        idx[o++] = a + 1; idx[o++] = a + 3; idx[o++] = a + 2;
      }
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: TRAIL_COLORS[bi] } },
      vertexShader: /* glsl */`
        attribute float aAlpha; varying float vA;
        void main() {
          vA = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision mediump float; uniform vec3 uColor; varying float vA;
        void main() { gl_FragColor = vec4(uColor, vA); }`,
    }));
    mesh.frustumCulled = false;
    scene.add(mesh);
    const free = [];
    const rec = [];
    for (let s = 0; s < slots; s++) {
      free.push(s);
      rec.push({
        index: s, count: 0, head: 0, fade: 1, owned: false,
        px: new Float32Array(TRAIL_SEG + 1), py: new Float32Array(TRAIL_SEG + 1),
        pz: new Float32Array(TRAIL_SEG + 1), pt: new Float32Array(TRAIL_SEG + 1),
      });
    }
    trailBuckets.push({ mesh, pos, al, free, rec, live: new Set() });
  }
}

/* Take a slot in one colour, or null when that colour is full. Running out is
   not a failure: the drone simply flies without a ribbon. */
function trailAcquire(colorIndex) {
  const bk = trailBuckets[colorIndex];
  if (!bk || !bk.free.length) return null;
  const s = bk.rec[bk.free.pop()];
  s.count = 0; s.head = 0; s.fade = 1; s.owned = true; s.bucket = colorIndex;
  bk.live.add(s);
  return s;
}
/* Let go of a slot without cutting the ribbon: it stops growing and fades out
   over its own lifetime, then returns to the free list in stepTrails(). */
function trailRelease(slot) {
  if (!slot || !slot.owned) return;
  slot.owned = false;
}

function trailPush(slot, x, y, z) {
  if (!slot || !slot.owned) return;
  if (slot.count) {
    const h = slot.head;
    const dx = x - slot.px[h], dy = y - slot.py[h], dz = z - slot.pz[h];
    if (dx * dx + dy * dy + dz * dz < TRAIL_MIN_STEP * TRAIL_MIN_STEP) return;
  }
  slot.head = (slot.head + 1) % (TRAIL_SEG + 1);
  slot.px[slot.head] = x; slot.py[slot.head] = y; slot.pz[slot.head] = z;
  slot.pt[slot.head] = now;
  if (slot.count < TRAIL_SEG + 1) slot.count++;
}

/* Rewrite every live ribbon's vertices. Scratch vectors only — this runs over
   every drone in the air, every frame. */
const _t0 = new THREE.Vector3(), _t1 = new THREE.Vector3(), _tv = new THREE.Vector3();
function stepTrails() {
  for (const bk of trailBuckets) {
    if (!bk.live.size) continue;
    for (const slot of bk.live) {
      const base = slot.index * (TRAIL_SEG + 1) * 2;
      const pos = bk.pos.array, al = bk.al.array;
      let lx = 0, ly = 0, lz = 0, alive = 0;
      for (let i = 0; i <= TRAIL_SEG; i++) {
        const v = base + i * 2;
        let x, y, z, a = 0;
        if (i < slot.count) {
          const k = (slot.head - i + (TRAIL_SEG + 1) * 2) % (TRAIL_SEG + 1);
          x = slot.px[k]; y = slot.py[k]; z = slot.pz[k];
          const age = now - slot.pt[k];
          a = Math.max(0, 1 - age / TRAIL_LIFE) * (1 - i / (TRAIL_SEG + 1));
          if (a > 0.002) alive++;
          /* The tangent is the step to the point behind this one; the ribbon's
             width axis is that crossed with the view direction, so the strip
             is edge-on to nothing and never disappears as the camera orbits. */
          const k2 = (k - 1 + (TRAIL_SEG + 1)) % (TRAIL_SEG + 1);
          if (i + 1 < slot.count) _t0.set(slot.px[k2] - x, slot.py[k2] - y, slot.pz[k2] - z);
          else _t0.set(x - lx, y - ly, z - lz);
          lx = x; ly = y; lz = z;
        } else { x = lx; y = ly; z = lz; _t0.set(0, 1, 0); }
        _t1.set(x - camera.position.x, y - camera.position.y, z - camera.position.z);
        _tv.crossVectors(_t0, _t1);
        const len = _tv.length();
        if (len > 1e-5) _tv.multiplyScalar(TRAIL_WIDTH * (1 - i / (TRAIL_SEG + 1)) / len);
        else _tv.set(0, 0, 0);
        pos[v * 3] = x - _tv.x; pos[v * 3 + 1] = y - _tv.y; pos[v * 3 + 2] = z - _tv.z;
        pos[v * 3 + 3] = x + _tv.x; pos[v * 3 + 4] = y + _tv.y; pos[v * 3 + 5] = z + _tv.z;
        al[v] = al[v + 1] = a * slot.fade;
      }
      if (!slot.owned) {
        /* Nothing is feeding it any more: once the last point has aged out the
           slot is genuinely free and goes back to the pool. */
        if (!alive) { bk.live.delete(slot); bk.free.push(slot.index); slot.count = 0; }
      }
    }
    bk.pos.needsUpdate = true;
    bk.al.needsUpdate = true;
  }
}


/* =============================================================================
   PRINT RIGS — the two laser lines and the support scaffolds
   The print itself is one float on the building (aState.x), so every building
   materialises whatever else is happening. Only the RIG is pooled: eight sets
   of lasers on screen at once is already more red than the frame wants, and a
   ninth simultaneous file just prints without its own scaffolding.
   ========================================================================== */
const printRigs = [];
function buildPrintRigs() {
  const bar = new THREE.PlaneGeometry(1, 1);
  bar.rotateX(-Math.PI / 2);              // lies flat, sweeps down with the plane
  const post = new THREE.BoxGeometry(1, 1, 1);
  post.translate(0, 0.5, 0);              // stands on the ground
  const head = new THREE.BoxGeometry(1, 1, 1);       // the emitter body
  const shaft = new THREE.PlaneGeometry(1, 1);       // the beam, hung from the head
  shaft.translate(0, -0.5, 0);            // hangs DOWN from its origin
  /* The ground ring is what makes a print findable from the wide shot: a lot
     with a red circle around it reads at any distance, where a 4 cm laser bar
     does not. Inner/outer are multiplied by the footprint in placeRig(). */
  const ring = new THREE.RingGeometry(0.62, 0.80, 40);
  ring.rotateX(-Math.PI / 2);
  for (let i = 0; i < MAX_PRINT_RIGS; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: LASER, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    /* The shimmer is the only part with its own material: the heat over the
       scanline has to sit at a tenth of the lasers' brightness, and one shared
       opacity cannot say both things. */
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0xff7a4a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const lines = [new THREE.Mesh(bar, mat), new THREE.Mesh(bar, mat)];
    const heads = [new THREE.Mesh(head, mat), new THREE.Mesh(head, mat)];
    const beams = [new THREE.Mesh(shaft, mat), new THREE.Mesh(shaft, mat)];
    const struts = [];
    for (let k = 0; k < RIG_STRUTS; k++) struts.push(new THREE.Mesh(post, mat));
    const ringM = new THREE.Mesh(ring, mat);
    const haze = new THREE.Mesh(bar, hazeMat);
    for (const m of lines) g.add(m);
    for (const m of heads) g.add(m);
    for (const m of beams) g.add(m);
    for (const m of struts) g.add(m);
    g.add(ringM); g.add(haze);
    g.visible = false;
    scene.add(g);
    printRigs.push({ group: g, mat, hazeMat, lines, heads, beams, struts,
                     ring: ringM, haze, job: null });
  }
}
const freeRig = () => printRigs.find(r => !r.job) || null;

/* How thick a laser has to be in WORLD units to still be two pixels wide on
   screen. The wide shot stands 60-plus units back, where the 4.5 cm bar the
   first pass drew is a third of a pixel and simply is not there. Solved off the
   lens rather than guessed: at distance d a pixel covers
   2*d*tan(fov/2)/height world units. */
const _lw = new THREE.Vector3();
function laserWidth(x, z, minPx) {
  const d = Math.max(1, camera.position.distanceTo(_lw.set(x, 0.6, z)));
  const px = 2 * d * Math.tan(camera.fov * Math.PI / 360) /
             Math.max(1, renderer.domElement.height / renderer.getPixelRatio());
  return px * minPx;
}


/* =============================================================================
   LABELS — plate names and drone names, drawn into canvas textures
   Text in the scene, not in the DOM: a DOM overlay would need a projection and a
   reflow per label per frame, and there are up to 60 of them.
   ========================================================================== */
/* A district caption is a street sign, not a paragraph: long folder names are
   cut so two neighbouring plates cannot bury each other in type. */
const clipName = (n, max) => { const m = max || 15; return n.length > m ? n.slice(0, m - 1) + '…' : n; };

/* A caption's base direction, decided the way the bidi algorithm decides a
   paragraph's: the FIRST strong character wins. Agent tasks are written in
   whatever language Beri typed, and a Hebrew one set left-to-right comes out
   with its punctuation and any Latin word in the wrong place — this is the
   canvas equivalent of wrapping the string in <bdi>. Canvas 2D runs the full
   Unicode bidi algorithm itself once the base direction is right, so the mixed
   runs inside ("תיקון city.js") need nothing further. */
const RTL_FIRST = /^[^\p{L}\p{N}]*[\p{Script=Hebrew}\p{Script=Arabic}]/u;

function makeLabel(text, color, px) {
  const pad = 8, size = px || 34;
  const rtl = RTL_FIRST.test(text);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
  g.font = font;
  g.direction = rtl ? 'rtl' : 'ltr';
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = Math.max(2, w); c.height = size + pad * 2;
  /* Resizing the canvas resets the context, so every setting is applied again
     below — g and g2 are the same object, which is why the font is re-set. */
  const g2 = c.getContext('2d');
  g2.font = font;
  g2.direction = rtl ? 'rtl' : 'ltr';
  g2.textAlign = rtl ? 'right' : 'left';
  g2.textBaseline = 'middle';
  const x = rtl ? c.width - pad : pad;
  /* An ink stroke under the fill so the caption stays readable when it crosses a
     lit facade — the same trick the 2D version used, for the same reason. */
  g2.lineWidth = 5; g2.lineJoin = 'round'; g2.strokeStyle = 'rgba(8,7,12,.85)';
  g2.strokeText(text, x, c.height / 2);
  g2.fillStyle = color;
  g2.fillText(text, x, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: 0.9,
  }));
  spr.scale.set((c.width / c.height) * 0.44, 0.44, 1);
  spr.userData.text = text;
  spr.userData.color = color;
  /* What share of the sprite's height is actual glyph rather than the padding
     the ink halo needs. sizeCaption() measures legibility in GLYPH pixels, so
     it has to divide the padding back out. */
  spr.userData.glyphFrac = size / c.height;
  return spr;
}

/* Labels made before the webfont arrived are Arial in a texture forever, so they
   are rebuilt once, when document.fonts says the real font is in. */
function refreshLabels() {
  for (const p of plateByKey.values()) if (p.labelSprite) rebuild(p.labelSprite);
  for (const d of drones.values()) { if (d.label) rebuild(d.label); if (d.overflow) rebuild(d.overflow); }
  for (const w of workers.values()) if (w.tag) rebuild(w.tag);
  function rebuild(spr) {
    const fresh = makeLabel(spr.userData.text, spr.userData.color,
                            spr.userData.px || 34);
    spr.material.map.dispose();
    spr.material.map = fresh.material.map;
    /* A craft tag lives under a group scaled to CRAFT_SCALE, so the rebuilt size
       has to be divided back out the same way attachTag() did it. */
    spr.scale.copy(fresh.scale).divideScalar(tagK(spr));
    if (spr.userData.baseScale) spr.userData.baseScale.copy(spr.scale);
    spr.userData.glyphFrac = fresh.userData.glyphFrac;
    spr.material.needsUpdate = true;
  }
}

/* Keep a caption legible from the wide shot. A sprite is in WORLD units, so at
   the framing this camera holds the craft names measured about six pixels of
   glyph at 1440x900 — present, but not readable, which is the same as absent.
   This grows a caption (never shrinks it) until its glyphs clear MIN_TAG_PX on
   the rendered frame, capped so a close-up does not turn one tag into a poster.
   Called from cullCaptions(), which has already paid for the distance. */
const MIN_TAG_PX = 13;
const MAX_TAG_PX = 26;           // a near craft's tag must not become a poster
/* 3.2 was enough while a city was one session's worth of buildings. A PROJECT's
   town is several avenues long, so the camera stands much further back and the
   same tags measured 7.7 px on the real claude-live town — under the floor,
   which is the same as absent. The ceiling below is what stops this becoming a
   poster, so raising the growth can only ever rescue a distant caption.
   6.0 was still not enough on the BIGGEST real town: at sphereRadius 86
   (`?project=cb09014b`) the growth hit its cap before the glyph cleared the
   floor and `__tags()` read 8.2 px. 12.0 clears that town's own worst caption
   with headroom — a distant sign or tag can still only grow as far as its own
   `maxPx` ceiling, so this never turns anything into a poster; it only lets a
   far caption keep climbing toward the floor instead of stalling short of it. */
const MAX_TAG_GROWTH = 12.0;
function sizeCaption(spr, dist, tanV) {
  const base = spr.userData.baseScale || (spr.userData.baseScale = spr.scale.clone());
  const frac = spr.userData.glyphFrac || 0.7;
  /* Screen pixels of glyph = worldGlyphHeight / (2 * dist * tan(fov/2)) * H.
     `tagK` is the scale of the parent the sprite hangs on — 1 for a street sign,
     the craft's own for a tag on an ORNIS tag anchor. Without it every craft
     caption measures three times bigger than the reader sees and the growth to
     the legibility floor never fires. */
  const px = (base.y * tagK(spr) * frac) / (2 * dist * tanV) * H;
  /* Grown to the floor, then held under the ceiling: a sprite is in world units,
     so without the ceiling the nearest craft in a close-up carried type twice
     the size of the masthead and read as a banner rather than a label. */
  /* A street sign carries up to 48 characters against a craft tag's 42, and it
     stands still while the camera comes to it — grown to the craft's ceiling it
     was a banner across a third of the frame. Its own ceiling is just above the
     floor: readable is the whole requirement, and a sign is wayfinding, not the
     subject of the shot. */
  const ceil = spr.userData.maxPx || MAX_TAG_PX;
  let k = Math.min(MAX_TAG_GROWTH, Math.max(1, MIN_TAG_PX / Math.max(px, 0.01)));
  if (px * k > ceil) k = ceil / px;
  spr.scale.set(base.x * k, base.y * k, 1);
}


/* =============================================================================
   DRONES — one craft per agent
   The orchestrator is a larger craft with a gold underlight hovering over the
   city centre. Each subagent launches from it, flies to its work, and docks back
   into it when the agent ends. Individual meshes and not an InstancedMesh: there
   are at most 26 of them, each carries its own label sprite anyway, and readable
   per-drone banking is worth twenty-six draw calls.
   ========================================================================== */
const droneGeo = new THREE.OctahedronGeometry(0.19, 0);
const rotorGeo = new THREE.TorusGeometry(0.30, 0.022, 6, 18);
const mainGeo = new THREE.OctahedronGeometry(0.42, 0);
const mainRingGeo = new THREE.TorusGeometry(0.72, 0.035, 8, 32);
const underGeo = new THREE.PlaneGeometry(1, 1);

/* --- THE ORNIS KIT --------------------------------------------------------
   Every craft above is now a real aircraft: drones.js's ORNIS quadcopter with
   the variant attachments that say what it is doing (docs/DRONES.md). The
   octahedron-and-torus discs above are KEPT, and they are not dead code — they
   are what `?drones=discs` puts back, which is the only way to read an A/B
   frame rate against the previous build in the same minute on the same GPU, and
   they are also the fallback if `assets/drones/ornis.glb` cannot be fetched.

   THE ONE NUMBER: the kit is built in metres against BuildingKit, where a floor
   is about 3 m. Here a whole FILE stands on a 1.0-unit plot and a floor is 0.30,
   so the city is roughly a third of that world. CRAFT_SCALE is that ratio, and
   at it an agent craft spans 0.61 units — the same width as the ring the disc
   drew, which is what keeps the framing, the tag heights and the camera solve
   where they already were.

   Every craft therefore carries TWO scale factors: `craftScale` (the variant's
   own size times CRAFT_SCALE, fixed for the craft's life) and the record's
   `scale` (0..1, the spawn fade). They multiply. */
const CRAFT_SCALE = 0.32;
let kit = null;

/* Load the kit once, from replay.js's boot(), after init() and BEFORE the first
   frame: `load()` bakes seven sprites through this same renderer, and a
   composer.render() interleaved with those bakes is a documented way to get a
   blank sprite or worse (docs/DRONES.md, "Traps this pass paid for"). */
export async function loadDrones() {
  if (kit) return true;
  if (new URLSearchParams(location.search).get('drones') === 'discs') return false;
  try {
    kit = await DroneKit.load(renderer, 'assets/manifest.json');
  } catch (e) {
    /* No model, no manifest, no network: the city still flies, as discs. */
    console.warn('ORNIS kit unavailable, flying discs instead:', e && e.message);
    return false;
  }
  /* This scene has NO LIGHTS — every other material in it is Basic or a custom
     shader — so a metalness 0.94 rotor with nothing to reflect renders black.
     One PMREM off the city's own sky dome is the whole light rig: the fleet
     reflects the dusk it is flying in. Baked once; kit.setNight() then dims it
     as the session clock walks into the evening. */
  kit.setEnvironment(bakeDroneEnv());
  /* The downwash ring lands on the plates, which are the city's ground: every
     plate's top face is the same 0.30 this file measures every building from. */
  kit.getHeight = () => 0.30;
  /* The kit's LOD bands are 120 m and 400 m for a 1.6 m craft. Ours are that
     many CRAFT_SCALE-sized units, or a wide shot 90 units back would hold every
     craft in the fleet at LOD0 — 41 k triangles each, times 45 at the gate. */
  kit.lodFor = d => {
    const m = d / CRAFT_SCALE;
    return m < 120 ? 0 : m < 400 ? 1 : 2;
  };
  return true;
}

/* The env map, from the dome this city already stands under. A second instance
   of the same shader material: its uniforms hold the module's own colour
   objects, so it bakes the exact sky the first frame will show. */
function bakeDroneEnv() {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const dome = createSky();
  s.add(dome);
  const env = pm.fromScene(s).texture;
  dome.geometry.dispose(); dome.material.dispose();
  pm.dispose();
  return env;
}

/* Where something docks INTO a craft: a worker onto the agent's cargo-pod band,
   an agent onto the orchestrator's beacon ring. Read off the kit's own rig
   rather than typed in, so a re-tuned airframe moves the dock with it. */
function dockY(craft) {
  const rig = kit && craft.group.userData.rig;
  const part = rig && (rig.band || rig.beacon);
  return part ? part.position.y * craft.craftScale : 0;
}

/* Hang a caption on a craft. On a kit craft the anchor is already at the right
   height for the variant — the net craft's mast included — but it lives inside
   a group scaled to CRAFT_SCALE, so the sprite's own scale has to be divided
   back out or every tag shrinks with the aircraft. `worldK` and `liftY` are what
   sizeCaption(), cullCaptions() and tagPixels() read instead of guessing at the
   parent, and they are 1 and spr.position.y for everything not on a craft. */
function attachTag(g, spr, fallbackY, craftScale) {
  const anchor = g.userData && g.userData.tagAnchor;
  if (!anchor) { spr.position.y = fallbackY; g.add(spr); return; }
  spr.scale.divideScalar(craftScale);
  spr.userData.worldK = craftScale;
  spr.userData.liftY = anchor.position.y * craftScale;
  anchor.add(spr);
}
const tagK = spr => spr.userData.worldK || 1;
const tagLift = spr => (spr.userData.liftY !== undefined ? spr.userData.liftY : spr.position.y);

function makeDrone(id, label, isMain, tier) {
  /* `orchestrator` is the command craft — biggest airframe, lit ring underneath;
     `agent` is a subagent's, with the tier colour on its cargo band. */
  const g = kit
    ? kit.make(isMain ? 'orchestrator' : 'agent',
               { tier, seed: 1 + ((hash01(id) * 1e6) | 0) })
    : new THREE.Group();
  const craftScale = kit ? g.scale.x * CRAFT_SCALE : 1;
  let body = null, ring = null, under = null;
  if (!kit) {
    const bodyMat = new THREE.MeshBasicMaterial({ color: isMain ? 0xf0e4c6 : 0xbfc9d4 });
    body = new THREE.Mesh(isMain ? mainGeo : droneGeo, bodyMat);
    body.scale.y = 0.6;
    g.add(body);
    ring = new THREE.Mesh(isMain ? mainRingGeo : rotorGeo, new THREE.MeshBasicMaterial({
      color: isMain ? GOLD : 0x8fa6b8, transparent: true, opacity: isMain ? 0.9 : 0.55,
    }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    /* The underlight is a flat additive quad, not a light: a real PointLight would
       force every shader in the scene into a lit path for one glow. */
    under = new THREE.Mesh(underGeo, new THREE.MeshBasicMaterial({
      color: isMain ? GOLD : COOL, transparent: true, opacity: isMain ? 0.34 : 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    under.rotation.x = -Math.PI / 2;
    under.position.y = -0.16;
    under.scale.setScalar(isMain ? 1.5 : 0.62);
    g.add(under);
  }

  /* The craft wears its agent's TASK, not its id: "every drone that is sent
     must carry a tag of what it is going to do". 42 characters is what fits
     on one line at this size without becoming a paragraph in the sky. */
  const spr = makeLabel(clipName(label, 42), isMain ? '#f2d99a' : '#cfe0ea', 30);
  spr.userData.px = 30;
  spr.scale.multiplyScalar(isMain ? 0.85 : 0.72);
  attachTag(g, spr, isMain ? 0.95 : 0.62, craftScale);
  g.scale.setScalar(craftScale);

  droneGroup.add(g);
  return {
    id, isMain, group: g, body, ring, label: spr, under, craftScale,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), want: new THREE.Vector3(),
    scale: isMain ? 1 : 0, leaving: 0, glitch: 0, phase: Math.random() * 6.28,
    anchor: null, orbitAng: Math.random() * 6.28, bank: 0, busy: 0,
    /* When this craft last fired an event. Its caption is only on screen for a
       few seconds after that; see cullCaptions(). */
    lastAt: -99,
    /* The craft is a MOTHERSHIP now: its own workers, and the calls waiting for
       a free slot inside it. `overflow` is the "+n" sprite, made on demand. */
    workers: new Set(), queue: [], overflow: null, overflowN: -1,
    /* The orchestrator's ribbon is gold; a subagent craft takes the colour of
       the work it is currently sending out (see assignCraftTrail). */
    trail: trailAcquire(isMain ? 2 : 0), trailColor: isMain ? 2 : 0,
  };
}


/* =============================================================================
   WORKER DRONES — one small craft per tool call, launched from its mothership
   The owner's rule: at least one drone per agent, and an agent doing several
   things at once runs several drones. So concurrency here is not a metaphor —
   a worker exists for exactly as long as its tool_use id has no tool_result,
   and `data/demo.json` really does put eighteen of them in the air at once.

   Workers are deliberately lighter than a craft: one small body sharing a
   material per family, plus a tag. No ring, no underlight, no per-drone
   material — forty of them must not cost forty extra draw-call pairs.
   ========================================================================== */
const workerGeo = new THREE.OctahedronGeometry(0.11, 0);
/* Shared, so a worker's body is one more instance of an existing draw batch.
   Fading a worker in and out is done with SCALE, which is why these can be
   opaque and shared at all. */
const workerMats = {
  write: new THREE.MeshBasicMaterial({ color: 0xff6a4a }),
  read:  new THREE.MeshBasicMaterial({ color: 0x9fd8ff }),
  other: new THREE.MeshBasicMaterial({ color: 0xd8d2c4 }),
};
/* Family -> the ribbon colour and the body material. Read and search are one
   look (both are the city being LOOKED at); write is the hot one. */
const FAM_LOOK = {
  write:  { mat: 'write', trail: 0 },
  read:   { mat: 'read',  trail: 1 },
  search: { mat: 'read',  trail: 1 },
  shell:  { mat: 'other', trail: 0 },
  other:  { mat: 'other', trail: 2 },
};

/* Family -> the ORNIS variant that DOES that job. The classification itself is
   replay.js:FAMILY's and is not repeated here; this is only which airframe flies
   it, and each one puts its mass on a different axis so the five read apart as
   outlines from the wide shot (docs/DRONES.md, "The one rule"). */
const FAM_CRAFT = {
  write:  'worker.edit',      // two printer arms raked forward
  read:   'worker.read',      // a sensor ball slung under the belly
  search: 'worker.search',    // the widest wings in the fleet
  shell:  'worker.shell',     // skid cage and tool arms, heavy and low
  other:  'worker.net',       // the mast — the tallest, and its beam points up
};

function makeWorker(craft, id, tool, fam, target, detail) {
  const look = FAM_LOOK[fam] || FAM_LOOK.other;
  const g = kit
    ? kit.make(FAM_CRAFT[fam] || FAM_CRAFT.other, { seed: 1 + ((hash01(id) * 1e6) | 0) })
    : new THREE.Group();
  const craftScale = kit ? g.scale.x * CRAFT_SCALE : 1;
  let body = null;
  if (!kit) {
    body = new THREE.Mesh(workerGeo, workerMats[look.mat]);
    body.scale.y = 0.7;
    g.add(body);
  }
  /* "Edit · city.js" — the verb and the thing, which is the whole sentence a
     viewer needs. 22px against the craft's 30: a worker is subordinate, and
     sizeCaption() guarantees the floor either way. */
  const tag = makeLabel(workerTagText(tool, target, detail), '#e8e0d0', 22);
  tag.userData.px = 22;
  tag.scale.multiplyScalar(0.78);
  attachTag(g, tag, 0.34, craftScale);
  g.scale.setScalar(craftScale);
  droneGroup.add(g);
  const w = {
    id, craft, tool, fam, target, group: g, body, tag, craftScale,
    /* Whether the variant's own effect — scan beam, search cone, sparks, uplink
       — is firing. Flipped in stepWorkers, so setWorking() is called on a state
       CHANGE and not sixty times a second. */
    working: false,
    /* Launched out of the mothership's cargo pod, not out of its middle. */
    pos: craft.pos.clone().setY(craft.pos.y + dockY(craft)),
    vel: new THREE.Vector3(), want: new THREE.Vector3(),
    scale: 0, state: 'out', arrivedAt: 0, bornAt: sessionNow, endedAt: -1, ok: true,
    orbitAng: Math.random() * 6.28, smokeAt: 0, lastAt: now,
    trail: trailAcquire(look.trail),
  };
  g.position.copy(w.pos);
  workers.set(id, w);
  craft.workers.add(w);
  return w;
}

/* The tag's text. A file tool says its basename; a shell tool says the first
   word of the command, which is the only part of `npm run build --silent` a
   person reads from across a city. */
function workerTagText(tool, target, detail) {
  /* `detail` is what replay.js could say better than the city can: the first
     word of a shell command. Otherwise the file's own basename is the story. */
  if (detail) return `${tool} · ${clipName(detail, 18)}`;
  if (target && target.name) return `${tool} · ${clipName(target.name, 18)}`;
  return tool;
}

/* Retire a worker: hand back its slot, its tag texture and its ribbon, then
   start the next queued call in the same craft. */
function disposeWorker(w) {
  /* And off its street's in-flight count. Idempotent, and it is here as well as
     in toolEnd() because a live call that never lands its end is retired by
     WORKER_TIMEOUT_MS instead — a crew sized off a leaked count would keep six
     people standing on a site nothing has touched for an hour. */
  lifeEndEvent(w.id);
  droneGroup.remove(w.group);
  if (kit) kit.remove(w.group);
  if (printerOver.get(w.target) === w) printerOver.delete(w.target);
  disposeSprite(w.tag);
  trailRelease(w.trail);
  w.craft.workers.delete(w);
  workers.delete(w.id);
  pumpQueue(w.craft);
}

/* Start as many queued calls as the craft now has room for. */
function pumpQueue(craft) {
  while (craft.queue.length && craft.workers.size < WORKER_CAP && workers.size < MAX_WORKERS) {
    const q = craft.queue.shift();
    const w = makeWorker(craft, q.id, q.tool, q.fam, q.target, q.detail);
    w.pending = q.pending;
    /* A call that finished while it was still queued still gets its flight —
       it just turns round the moment it arrives. */
    if (q.ended) { w.endedAt = q.endedAt; w.ok = q.ok; }
  }
}

/* The "+n" a busy mothership wears when more calls are running than it can
   show. Rebuilt only when n actually changes — this is a canvas texture. */
function setOverflow(craft, n) {
  if (craft.overflowN === n) return;
  craft.overflowN = n;
  if (craft.overflow) { craft.overflow.removeFromParent(); disposeSprite(craft.overflow); craft.overflow = null; }
  if (n <= 0) return;
  const spr = makeLabel(`+${n}`, '#ffb08a', 24);
  spr.userData.px = 24;
  spr.scale.multiplyScalar(0.7);
  attachTag(craft.group, spr, craft.isMain ? 0.68 : 0.40, craft.craftScale);
  /* On the tag anchor both captions would land on the same line, so the count
     drops by exactly one line of the task tag it belongs to. */
  if (spr.userData.liftY !== undefined) spr.position.y = -craft.label.scale.y * 0.95;
  craft.overflow = spr;
}


/* =============================================================================
   THE PUBLIC SURFACE — everything replay.js is allowed to call
   ========================================================================== */

/* The craft an event belongs to. In project mode every agent id is prefixed
   with its session (`<uuid8>:main`, `<uuid8>:af1683…`), so an agent whose own
   craft has not been created yet falls back to ITS OWN session's orchestrator
   rather than to whichever mothership happens to be called `main` — which is
   what keeps a subagent's work on its own street. */
function mainFor(agentId) {
  const d = drones.get(agentId);
  if (d) return d;
  const i = agentId ? agentId.indexOf(':') : -1;
  return (i > 0 ? drones.get(agentId.slice(0, i) + ':main') : null) || drones.get('main') || null;
}

/* A tool event that named a file. Returns the building record so the caller can
   aim a camera or a drone at it. */
/* `quiet` rebuilds state after a seek and fires nothing at all. `noBeam` is the
   narrower one: the city still materialises and still glows, but the family's
   beam is held back because a worker drone is on its way to carry it. */
export function touch(rel, fam, agentId, quiet, noBeam, sessionId) {
  const mute = quiet || noBeam;
  let b = files.get(rel);
  /* The lot belongs to the session that FIRST touched the file — a building
     already standing is never re-seated, whatever avenue is touching it now.
     A later session adds floors to it from ITS street, which is why the worker
     drone flies in from over there. */
  if (!b) b = spawnBuilding(rel, quiet, streetFor(sessionId));
  if (!b) return null;

  const d = mainFor(agentId);
  if (d) { d.anchor = b; d.busy = 1; d.lastAt = now; }

  /* Permanence resets on contact, in SESSION time — a touched building is a
     living one, whatever it looked like a second ago. */
  b.touchedAt = sessionNow;
  b.grey = 0;
  /* A file touched inside its own 0.4 s tear is not deleted after all — the
     glitch is cancelled and the shell comes back whole, rather than derezzing a
     file the session is demonstrably still using. */
  if (b.glitching) {
    b.glitching = 0;
    for (let i = glitchJobs.length - 1; i >= 0; i--) if (glitchJobs[i].b === b) glitchJobs.splice(i, 1);
    bAttr.aState.array[b.idx * 3] = -1;
    bAttr.aState.needsUpdate = true;
  }
  /* A derezzed file that is touched again is printed back into the world. */
  if (b.gone) { b.gone = false; b.rise = 1; b.riseT = 1; startPrint(b, printSecondsFor(b), !quiet); }

  if (fam === 'write') {
    /* +1 floor per Edit/Write. The cap is the brief's; past it the building
       cannot grow, so it lights a beacon instead of lying about its size. */
    if (b.floors < FLOOR_CAP) {
      const oldTop = 0.30 + b.wy;
      b.floors++; writeInstance(b);
      /* The session time this floor was added, kept per floor so the room
         inside knows which of its walls was written recently. One number per
         Edit; the export carries no line numbers, so the floor is the finest
         unit an event can honestly name. */
      (b.floorTimes || (b.floorTimes = [])).push(sessionNow);
      /* One more layer, printed the same way the whole building was: the plane
         starts at the new roof and comes down to where the old one was. */
      if (!quiet && !b.printing) startLayer(b, oldTop);
      /* Past HEIGHT_SOFT the roof no longer rises a full floor per Edit, so the
         beacon lights early: it is the same statement a capped tower already
         made — "this building has more storeys than you can count from the
         street" — made at the point that first becomes true. */
      if (b.floors > HEIGHT_SOFT && !b.beacon) addBeacon(b);
    }
    else if (!b.beacon) addBeacon(b);
    b.warm = 1;
    if (!mute) sparkBurst(b, 22, EMBER);
  } else if (fam === 'read') {
    b.lit = Math.min(1, b.lit + 0.22);          // reads light windows, not floors
    if (!mute) scanBeam(b);
  } else if (fam === 'search') {
    b.lit = Math.min(1, b.lit + 0.08);
    if (!mute && d) searchCone(d, b.plate);
  } else if (fam === 'shell') {
    if (!mute) shellBurst(b.wx, b.wz);
  } else {
    b.warm = Math.max(b.warm, 0.35);
    if (!mute) sparkBurst(b, 6, GOLD);
  }
  pushAttr(b);
  logBurst(b.plate);
  return b;
}

/* Does the city know this path? replay.js asks before it reads a deletion out
   of a shell command — a `rm` of something nobody ever opened is not an event
   this city has anything to say about. */
export const hasFile = rel => files.has(rel);

/* The last few events that landed on THIS file, for the wall plates in the room
   inside it. Recorded here because this is the one place an event and a
   building actually meet: interior.js is handed the whole replay, but the
   events in it carry absolute paths and the relativise() that turns one into a
   building's `rel` lives in replay.js — matching them up a second time would be
   a second implementation of the same rule, and the two would drift.

   Three, because three is what the wall holds; unshifted, so [0] is newest. A
   seek rebuilds the city by replaying, so these end up being the three most
   recent at whatever instant the transport is standing on. */
const RECENT_EVENTS = 3;
function logFileEvent(b, tool, agentId) {
  if (!b) return;
  const craft = mainFor(agentId);
  const list = b.events || (b.events = []);
  list.unshift({
    tool: tool || 'tool',
    /* The agent's own task tag — the same string its craft is wearing over the
       city, so the plate and the drone name the same agent. */
    agent: (craft && craft.label && craft.label.userData.text) || 'agent',
    at: sessionNow,
  });
  if (list.length > RECENT_EVENTS) list.length = RECENT_EVENTS;
}

/* A tool call started. `id` is the tool_use id, which is what pairs it with its
   tool_end, and therefore what makes concurrency real rather than assumed.
   Returns the building the call landed on, for the caller's own bookkeeping. */
export function toolStart(id, tool, fam, rel, agentId, quiet, detail, sessionId) {
  /* The event's own session decides which avenue a NEW building opens on. */
  if (sessionId && streets.has(sessionId)) currentStreet = streets.get(sessionId);
  /* The two regimes are read off this: the avenue's own call count, its edits,
     and how many of its calls are still out. See the LIFE section. */
  lifeNoteEvent(currentStreet, fam, quiet ? null : id);
  const b = rel ? touch(rel, fam, agentId, quiet, true, sessionId) : null;
  logFileEvent(b, tool, agentId);
  if (!rel && fam === 'shell') shell(agentId, true);
  if (quiet || !id) {
    /* A silent rebuild after a seek: the state is what matters, not the flight.
       Fire the effect straight away so a seek lands on the picture a forward
       play would have reached. */
    if (!quiet) fireFamily(fam, b, mainFor(agentId));
    return b;
  }
  const craft = mainFor(agentId);
  if (!craft) return b;
  const job = { id, tool, fam, target: b, detail, ended: false, endedAt: -1, ok: true };
  if (craft.workers.size >= WORKER_CAP || workers.size >= MAX_WORKERS) {
    craft.queue.push(job);
  } else {
    makeWorker(craft, id, tool, fam, b, detail);
  }
  return b;
}

/* Its tool_result arrived. ok:false sputters home trailing red smoke, ok:null
   (the exporter's synthetic end for a call that never returned) docks silently,
   and ok:true just goes home. */
export function toolEnd(id, ok) {
  /* A failed call is an accident on the street it was working — offered to
     life.js and not assumed of it; see lifeReportError(). Before the lookups
     below, because both of them can consume the record it reads. */
  if (ok === false) lifeReportError(id, (workers.get(id) || {}).tool);
  lifeEndEvent(id);
  const w = workers.get(id);
  if (w) { w.endedAt = sessionNow; w.ok = ok; return; }
  /* Still queued: mark it finished so its worker turns round on arrival. */
  for (const d of drones.values()) {
    for (const q of d.queue) if (q.id === id) { q.ended = true; q.endedAt = sessionNow; q.ok = ok; return; }
  }
}

/* The effect a family makes at the building. Factored out of touch() so a
   worker can carry it — the beam now fires when the drone ARRIVES, which is
   what makes "it flew over there to do that" a sentence and not a coincidence.
   The grammar itself is unchanged: same beams, same cones, same sparks. */
function fireFamily(fam, b, d) {
  if (!b) { if (d) shellBurst(d.pos.x, d.pos.z); return; }
  if (fam === 'write') sparkBurst(b, 22, EMBER);
  else if (fam === 'read') scanBeam(b);
  else if (fam === 'search') { if (d) searchCone(d, b.plate); }
  else if (fam === 'shell') shellBurst(b.wx, b.wz);
  else sparkBurst(b, 6, GOLD);
}

/* A file was deleted. It derezzes: the building falls apart into red voxels
   rather than fading out, and its lot stays empty until something touches the
   path again — at which point it is printed back. */
export function derezFile(rel, quiet) {
  const b = files.get(rel);
  if (!b || b.gone) return false;
  /* THE GLITCH PRE-ROLL. A construct does not simply fall apart: for four
     tenths of a second the shell TEARS — bands of it blink out and back — and
     only then do the voxels go. The tear is the print plane itself, driven to
     random heights: the facade's discard is already a horizontal cut, so a
     jittering cut is a scanline artifact with no new shader and no new
     attribute. `quiet` (a seek rebuilding state) skips straight to the end. */
  if (!quiet && !b.glitching) {
    b.glitching = 1;
    glitchJobs.push({ b, t: 0, cut: 0 });
    return true;
  }
  b.glitching = 0;
  b.gone = true;
  b.rise = 0; b.warm = 0;
  windowUnits -= b.windows || 0;
  b.windows = 0;
  bAttr.aState.array[b.idx * 3] = -1;
  bAttr.aState.needsUpdate = true;
  pushAttr(b);
  if (!quiet) derezBurst(b.wx, 0.30, b.wz, TYPES[b.type].w, b.wy, TYPES[b.type].d, 46);
  return true;
}
/* Buildings mid-tear. One entry per file whose derez has been asked for and
   whose voxels have not fallen yet. */
const glitchJobs = [];
function stepGlitch(dt) {
  if (!glitchJobs.length) return;
  bAttr.aState.needsUpdate = true;
  for (let i = glitchJobs.length - 1; i >= 0; i--) {
    const g = glitchJobs[i];
    g.t += dt;
    if (g.t >= GLITCH_SECONDS) {
      glitchJobs.splice(i, 1);
      derezFile(g.b.rel, false);               // b.glitching is 0 by then: falls through
      continue;
    }
    /* A new cut every ~35 ms. Anything smoother reads as a print running
       backwards; this has to read as a signal breaking up. */
    if (g.t - g.cut > 0.035) {
      g.cut = g.t;
      const top = 0.30 + g.b.wy;
      bAttr.aState.array[g.b.idx * 3] = Math.random() < 0.45
        ? -1                                    // whole again for one beat
        : 0.30 + Math.random() * (top - 0.30);
      emit(g.b.wx + (Math.random() - 0.5) * 1.2, 0.30 + Math.random() * g.b.wy,
           g.b.wz + (Math.random() - 0.5) * 1.2, 0, 0.2, 0,
           LASER, 0.09, 0.16, 0.4, 0, 1);
    }
  }
}

/* A shell command with no path of its own strikes the ground where its agent is
   working — the machine yard of whatever district it is standing over. */
export function shell(agentId, quiet) {
  const d = mainFor(agentId);
  if (d) { d.busy = 1; d.lastAt = now; }
  const p = d && d.anchor ? d.anchor : null;
  const x = p ? p.wx : cam.target.x, z = p ? p.wz : cam.target.z;
  if (!quiet) shellBurst(x, z);
  if (p) logBurst(p.plate);
}

export function agentStart(id, label, quiet, tier) {
  let d = drones.get(id);
  if (!d) {
    d = makeDrone(id, label, false, tier);
    drones.set(id, d);
  }
  d.leaving = 0;
  d.group.visible = true;
  const main = drones.get('main');
  /* Launched from the orchestrator, not teleported into place: seeing where a
     subagent came from is the whole point of having an orchestrator on screen.
     Out of its beacon RING specifically, which is the part of the command craft
     that faces the city and the part a launch should visibly come from. */
  if (main && !quiet) d.pos.set(main.pos.x, main.pos.y + dockY(main), main.pos.z);
  else d.pos.set(cam.target.x, 6, cam.target.z);
  d.want.set(d.pos.x + Math.cos(d.orbitAng) * 6, d.pos.y + 1.5,
             d.pos.z + Math.sin(d.orbitAng) * 6);
  if (!quiet && main) sparkBurst({ wx: main.pos.x, wy: main.pos.y, wz: main.pos.z }, 14, GOLD);
  return d;
}

export function agentEnd(id, quiet) {
  const d = drones.get(id);
  if (!d || d.isMain) return;
  d.anchor = null;
  /* DEREZ. The craft does not fade out — it comes apart into its own voxels,
     which fall and go dark. A fade says "we stopped drawing it"; this says the
     program's 29 minutes were up, which is the thing the film is about. */
  /* Its workers go with it: a call whose agent has returned has nobody to
     report to, and leaving them hovering would be inventing activity. */
  for (const w of Array.from(d.workers)) disposeWorker(w);
  d.queue.length = 0;
  setOverflow(d, 0);
  /* The same pre-roll a building gets: the craft breaks up as a SIGNAL first —
     the body strobing, red artifacts off it — and only then do the voxels fall.
     `leaving` (the derez timer proper) starts when the glitch runs out; see
     stepDrones. A seek rebuilding state skips both. */
  if (quiet) { d.leaving = 0.0001; return; }
  d.glitch = 0.0001;
}

/* Everything the world has to forget when the transport seeks back to zero. */
export function reset() {
  clearPick();
  files.clear(); byIdx.length = 0; plateByKey.clear(); allPlates.length = 0;
  for (const s of streetOrder) {
    scene.remove(s.road);
    if (s.sign) { labelGroup.remove(s.sign); disposeSprite(s.sign); }
  }
  streets.clear(); streetOrder.length = 0; currentStreet = null;
  /* The crowd survives a seek — Life.load() is twenty seconds and the actors
     are a pool, not state. What does NOT survive is every index into the graph
     the streets above just took with them, so the active set is emptied and the
     next updateLife() cuts a fresh one against the rebuilt city. */
  lifeActive = [];
  toolStreet.clear();
  lifeGraphAt = -1e9;
  lampCount = 0; lamps.count = 0; lampsDirty = false;
  for (const w of Array.from(workers.values())) disposeWorker(w);
  workers.clear();
  for (const d of drones.values()) { d.queue.length = 0; disposeDrone(d); }
  drones.clear();
  printerOver.clear();
  for (const r of printRigs) { r.job = null; r.group.visible = false; }
  printJobs.length = 0; flashJobs.length = 0; glitchJobs.length = 0;
  lastPrint = null;
  for (const p of labelGroup.children.slice()) { labelGroup.remove(p); disposeSprite(p); }
  bCount = 0; pCount = 0; beaconCount = 0; pLive = 0; windowUnits = 0;
  buildings.count = 0; bShadow.count = 0; plates.count = 0;
  sparks.geometry.setDrawRange(0, 0);
  beacons.geometry.setDrawRange(0, 0);
  for (const m of scanPool) m.visible = false;
  for (const m of conePool) m.visible = false;
  cityRoot = makePlate('', 'session', null, 0);
  burstLog.length = 0;
  focusSpent.length = 0;
  cam.focusPlate = null; cam.focusUntil = 0; cam.printCueUntil = 0;
  drones.set('main', makeDrone('main', 'Orchestrator', true));
  drones.get('main').pos.set(0, 7, 0);
}

/* After a silent rebuild (a seek) nothing should still be mid-animation. */
export function settle() {
  for (const b of files.values()) {
    if (!b.gone) { b.rise = 1; b.riseT = 1; }
    b.warm *= 0.2;
    bAttr.aState.array[b.idx * 3] = -1;   // every print lands instantly
    b.printing = 0; b.glitching = 0;
    pushAttr(b);
  }
  bAttr.aState.needsUpdate = true;
  printJobs.length = 0; flashJobs.length = 0; glitchJobs.length = 0;
  for (const r of printRigs) { r.job = null; r.group.visible = false; }
  for (const d of drones.values()) { d.scale = 1; d.pos.copy(d.want); }
  fitCamera(true);
}

/* Session progress 0..1 -> the light. Called every frame, so it reuses one
   scratch colour rather than allocating five. */
const _tmpCol = new THREE.Color();

/* How far into the night the session clock has walked, 0..1 — the SKY_KEYS at
   p 0.50 and 0.78 are the dark ones. Read by render() for the star field. */
let nightAmt = 0;
const smoothstep01 = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export function setPhase(p) {
  p = Math.max(0, Math.min(1, p || 0));
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (p >= SKY_KEYS[i].p && p <= SKY_KEYS[i + 1].p) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  }
  const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
  hzColor.set(a.hz).lerp(_tmpCol.set(b.hz), t);
  znColor.set(a.zn).lerp(_tmpCol.set(b.zn), t);
  sunColor.set(a.sc).lerp(_tmpCol.set(b.sc), t);
  ambient.set(a.am).lerp(_tmpCol.set(b.am), t);
  fogColor.set(a.fg).lerp(_tmpCol.set(b.fg), t);
  sunDir.set(
    a.sun[0] + (b.sun[0] - a.sun[0]) * t,
    a.sun[1] + (b.sun[1] - a.sun[1]) * t,
    a.sun[2] + (b.sun[2] - a.sun[2]) * t).normalize();
  /* Fades in and out with the light rather than switching on at a boundary. */
  nightAmt = smoothstep01(0.33, 0.52, p) * (1 - smoothstep01(0.80, 0.96, p));
}


/* =============================================================================
   SPAWN — a file becomes a building
   ========================================================================== */
function spawnBuilding(rel, quiet, street) {
  if (bCount >= MAX_BUILDINGS) return null;
  const parts = rel.split('/').filter(Boolean);
  const name = parts.pop();
  const plate = ensurePlate(parts, street || currentStreet);

  const ti = typeOf(name);
  const T = TYPES[ti];
  const lot = { x: 0, z: 0, w: LOT, h: LOT, isPlate: false };
  /* Walk the district's annex chain until one of them has room. A plate that is
     hemmed in by its neighbours cannot grow without shoving them, so it gets an
     annex across the street instead — the district continues, and not one
     building that already stands moves a millimetre. */
  let seat = plate;
  while (!addChild(seat, lot, LOT_GAP)) {
    if (!seat.annex) seat.annex = annexOf(seat);
    seat = seat.annex;
  }
  seat.files++;

  const [px, pz] = worldOrigin(seat);
  const b = {
    rel, name, plate: seat, lot, type: ti,
    wx: px + lot.x + LOT / 2, wz: pz + lot.z + LOT / 2, wy: 0,
    /* Printed, not raised: rise is already 1 and the print plane is what makes
       the building appear. See startPrint() and the MATERIALISATION block in
       the facade shader. */
    floors: T.floors, rise: 1, riseT: 1, warm: 1, lit: 0.15,
    floorTimes: [sessionNow],
    seed: hash01(rel), idx: bCount++, beacon: false,
    touchedAt: sessionNow, grey: 0, gone: false, printing: 0,
  };
  files.set(rel, b);
  byIdx[b.idx] = b;
  writeInstance(b);
  pushAttr(b);
  buildings.count = bCount; bShadow.count = bCount;

  startPrint(b, printSecondsFor(b), !quiet);
  return b;
}

/* The building's box and its contact shadow. Written only when the footprint or
   the floor count changes — never per frame. */
function writeInstance(b) {
  const T = TYPES[b.type];
  /* The DRAWN storeys, which above HEIGHT_SOFT is fewer than the real ones —
     see drawnFloors(). Rounded for the window rows, because a row is a row. */
  const shown = drawnFloors(b.floors);
  const rows = Math.max(1, Math.round(shown));
  const h = Math.max(T.fh, shown * T.fh);
  b.wy = h;
  dummy.position.set(b.wx, 0.30, b.wz);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(T.w, h, T.d);
  dummy.updateMatrix();
  buildings.setMatrixAt(b.idx, dummy.matrix);
  buildings.instanceMatrix.needsUpdate = true;

  dummy.position.set(b.wx, 0.305, b.wz);
  dummy.scale.set(T.w * 2.6, 1, T.d * 2.6);
  dummy.updateMatrix();
  bShadow.setMatrixAt(b.idx, dummy.matrix);
  bShadow.instanceMatrix.needsUpdate = true;

  /* Kept in step here rather than recounted per frame: this runs only when a
     building is born or gains a floor, which is the only time it can change. */
  /* Windows are counted on what is DRAWN, not on the Edit count: this figure
     is what lights the sky dome, and a tower whose top sixteen storeys were
     never built cannot glow with them. */
  const cells = rows * T.cols;
  windowUnits += cells - (b.windows || 0);
  b.windows = cells;

  /* Window rows are the drawn storeys too, so a row keeps the same physical
     height whether or not the building is compressed — the alternative is a
     forty-row facade squeezed into thirty rows' worth of wall. */
  bAttr.aFloors.array[b.idx] = rows;
  bAttr.aType.array[b.idx] = b.type;
  bAttr.aSeed.array[b.idx] = b.seed;
  bAttr.aCols.array[b.idx] = T.cols;
  bAttr.aFloors.needsUpdate = bAttr.aType.needsUpdate = true;
  bAttr.aSeed.needsUpdate = bAttr.aCols.needsUpdate = true;
  /* THE PICKER DEPENDS ON THIS LINE. three caches an InstancedMesh's bounding
     sphere the first time anything asks for it and never invalidates it when
     instanceMatrix changes — and the first thing that asks is a raycast, on an
     empty city, which caches a sphere of radius -1. Every building raycast after
     that misses, silently: hovering a tower reported the plate caption behind it
     and clicking a building did nothing at all, with no error anywhere. Dropping
     it here makes the next raycast recompute it, which happens on a pointermove
     and never in the frame loop. */
  buildings.boundingSphere = null;
  if (b.beacon !== false && b.beaconIdx !== undefined) moveBeacon(b);
}

/* The three floats that change while you watch: rise, warm, lit. */
function pushAttr(b) {
  bAttr.aRise.array[b.idx] = b.rise;
  bAttr.aWarm.array[b.idx] = b.warm;
  bAttr.aLit.array[b.idx] = b.lit;
  bAttr.aGrey.array[b.idx] = b.grey || 0;
}

/* Directory path -> plate, creating the whole chain the first time. Depth is
   capped at two levels below the city so that a path nine folders deep does not
   turn into nine nested slabs: the last two folders are the ones a person
   recognises, and deeper files land in the deepest plate that exists. */
const PLATE_DEPTH = 2;
function ensurePlate(dirParts, street) {
  const root = street || cityRoot;
  /* The first district on an avenue is what turns its reservation from a
     promise into ground — see claimBand(). Called before the early return as
     well: a plate that is already standing proves the same thing. */
  if (street) claimBand(street);
  if (!dirParts.length) return root;
  /* Keyed on the FULL path AND the avenue, never the visible name: two folders
     both called "docs" are two different places, and the same folder worked on
     by two sessions is two blocks — one on each street. */
  const pre = street ? street.key + '|' : '';
  const innerKey = pre + dirParts.join('/');
  const found = plateByKey.get(innerKey);
  if (found) return found;                    // already standing: never re-parent

  const keep = dirParts.slice(-PLATE_DEPTH);
  let parent = root;
  if (keep.length > 1) {
    const outerKey = pre + dirParts.slice(0, -1).join('/');
    parent = plateByKey.get(outerKey) || newPlate(outerKey, keep[0], root, 1, false);
  }
  return newPlate(innerKey, keep[keep.length - 1], parent, keep.length, true);
}

/* An annex is the same district, continued. It carries the same name but is not
   labelled again — one caption per district, however many blocks it spans. */
function annexOf(plate) {
  const a = makePlate(plate.key + '#' + (plate.depth + 1), plate.name, null, plate.depth);
  a.annexOf = plate;               // the district this block continues
  a.w = PLATE_PAD * 2; a.h = PLATE_PAD * 2;
  let host = plate.parent || cityRoot;
  while (!addChild(host, a, PLATE_GAP)) {
    /* A street and the root are the two hosts guaranteed to have room: both can
       always append further along +x, the street because the avenue has no end
       and the root because it has no siblings. An annex must never escape its
       own avenue — that is what would put a session's work on another
       session's street. */
    if (host.isStreet || host === cityRoot) { appendFar(host, a); break; }
    host = host.parent || cityRoot;
  }
  allPlates.push(a);
  if (pCount < MAX_PLATES) { a.meshIndex = pCount++; plates.count = pCount; }
  return a;
}

function newPlate(key, name, parent, depth, named) {
  const p = makePlate(key, name, null, depth);
  p.w = PLATE_PAD * 2; p.h = PLATE_PAD * 2;
  let host = parent;
  while (!addChild(host, p, PLATE_GAP)) {
    if (host.isStreet || host === cityRoot) { appendFar(host, p); break; }
    host = host.parent || cityRoot;
  }
  plateByKey.set(key, p);
  allPlates.push(p);
  if (pCount < MAX_PLATES) { p.meshIndex = pCount++; plates.count = pCount; }
  /* Only the inner plate is named on the ground: naming both levels doubles the
     type in the frame, and the outer name is already implied by the nesting. */
  if (named) {
    const spr = makeLabel(clipName(name), 'rgba(226,220,206,.95)', 34);
    spr.userData.plate = p;          // the picker walks back from sprite to plate
    labelGroup.add(spr);
    p.labelSprite = spr;
  }
  return p;
}

/* Plate boxes are rewritten only when a plate's bounding box actually grew. */
const allPlates = [];
function syncPlates() {
  for (const p of allPlates) {
    if (!p.dirty && p.synced) continue;
    p.dirty = false; p.synced = true;
    if (p.meshIndex < 0) continue;
    const [x, z] = worldOrigin(p);
    const thick = 0.10 + 0.09 * Math.min(p.depth, 2);
    dummy.position.set(x + p.w / 2, 0, z + p.h / 2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(p.w, thick + 0.02 * p.depth, p.h);
    dummy.updateMatrix();
    plates.setMatrixAt(p.meshIndex, dummy.matrix);
    plates.geometry.attributes.aSize.array[p.meshIndex * 2] = p.w;
    plates.geometry.attributes.aSize.array[p.meshIndex * 2 + 1] = p.h;
    plates.geometry.attributes.aTone.array[p.meshIndex] = p.depth / 2;
    plates.instanceMatrix.needsUpdate = true;
    plates.geometry.attributes.aSize.needsUpdate = true;
    plates.geometry.attributes.aTone.needsUpdate = true;
    if (p.labelSprite) {
      p.labelSprite.position.set(x + p.w / 2, 0.40, z + p.h + 0.34);
      p.labelSprite.material.opacity = 0.62;
    }
  }
}


/* =============================================================================
   STREETS — one avenue per session, opened at the city's far edge
   The owner's rule this whole layer exists for: "a city per project, not per
   session; streets per session — the conversation's name is the street name in
   the project's city." So the town is the project, an avenue is one session,
   and a session that comes back to the same project opens a NEW avenue rather
   than re-entering an old one. Nothing that already stands ever moves.
   ========================================================================== */
const roadGeo = new THREE.PlaneGeometry(1, 1);
const roadMat = new THREE.MeshBasicMaterial({ color: 0x14121b });

/* Open an avenue. `craftId` is the id of the agent that IS this session's
   orchestrator — its craft docks at the avenue's entrance and every worker the
   session sends out flies from there, which is what makes "the worker drone
   flies from its street's craft" true rather than decorative. */
/* Turn an avenue's promised band into reserved ground, once, when its first
   district lands. The avenues BELOW it slide down by the same amount — which is
   free, because a project opens every one of its streets before the first event
   is replayed, so the ones below are still empty when this fires. An avenue that
   is already built on is never pushed: the claim is cut short at whatever gap is
   genuinely free, and the packer then annexes along +x, which is what an annex
   is for. Nothing that already stands ever moves. */
function claimBand(s) {
  if (s.banded || !s.band) return;
  s.banded = true;
  const want = s.band - s.minH;
  if (want <= 0) return;
  const i = streetOrder.indexOf(s);
  let room = Infinity;
  for (let j = i + 1; j < streetOrder.length; j++) {
    if (streetOrder[j].kids.length) {
      room = streetOrder[j].z - (s.z + s.minH) - STREET_GAP;
      break;
    }
  }
  const d = Math.max(0, Math.min(want, room));
  if (d <= 0) return;
  s.minH += d;
  bumpBounds(s);
  for (let j = i + 1; j < streetOrder.length; j++) {
    if (streetOrder[j].kids.length) break;
    streetOrder[j].z += d;
    streetOrder[j].dirty = true;
  }
  bumpBounds(cityRoot);
  lampsDirty = true;
}

export function openStreet(id, title, live, craftId, events) {
  let s = streets.get(id);
  if (s) {
    if (title && !s.titled) nameStreet(s, title);
    if (live !== undefined) setStreetLive(id, live);
    return s;
  }

  s = makePlate('street:' + id, title || 'session', null, 0);
  s.isStreet = true;
  s.sid = id;
  s.minW = STREET_ROAD * 4;
  /* The band is what the avenue will reserve once it is built on — not what it
     reserves now. An avenue that never gets a building is a sign and a strip of
     carriageway, and a project that opens five sessions and works in one used
     to lay four empty plinths beside it. claimBand() below turns `band` into
     `minH` the moment the first district lands. */
  s.band = bandFor(events);
  s.minH = STREET_ROAD + PLATE_PAD * 2;
  s.w = s.minW; s.h = s.minH;
  /* The far edge of everything already standing, plus a kerb. cityRoot's own
     box is the whole city's, so this is literally "past the last avenue". */
  s.x = 0;
  s.z = streetOrder.length ? cityRoot.h + STREET_GAP : 0;
  s.parent = cityRoot;
  cityRoot.kids.push(s);
  bumpBounds(cityRoot);

  s.road = new THREE.Mesh(roadGeo, roadMat);
  s.road.rotation.x = -Math.PI / 2;
  s.road.position.y = 0.055;                 // just clear of the ground plane
  s.road.renderOrder = 0;
  scene.add(s.road);

  streets.set(id, s);
  streetOrder.push(s);
  nameStreet(s, title || id);
  s.live = !!live;
  s.dirty = true;
  lampsDirty = true;

  /* The session's own orchestrator, docked at the entrance. `home` is what
     stepDrones() flies an idle mothership back to. */
  if (craftId) {
    /* In project mode every session brings its own orchestrator, so the
       nameless `main` craft reset() puts over the middle of an empty city has
       nothing left to stand for — and an idle craft wearing the caption
       "Orchestrator" over a town with four real ones is a lie. mainFor() no
       longer needs it either: it resolves `<uuid8>:main` from the agent id. */
    if (craftId !== 'main' && drones.has('main')) {
      const stray = drones.get('main');
      if (!stray.home && !stray.workers.size) { disposeDrone(stray); drones.delete('main'); }
    }
    let craft = drones.get(craftId);
    /* "Orchestrator", not the session title: the street SIGN two units below it
       already says which conversation this is, and printing the same 48
       characters twice in one corner of the frame is the noisiest thing this
       layer can do. */
    if (!craft) { craft = makeDrone(craftId, 'Orchestrator', true); drones.set(craftId, craft); }
    craft.home = s;
    /* And it wears no caption at all. A docked orchestrator sits directly over
       its own street sign, so the two captions collided every frame and
       cullCaptions() — which ranks a craft above a sign — hid the SIGN, which
       is the one piece of type an avenue cannot do without. The gold ring and
       the sign under it already say whose street this is. */
    craft.label.userData.mute = true;
    craft.scale = 1;
    craft.pos.set(s.x + 1.5, 4.5, s.z + STREET_ROAD * 0.5);
    craft.want.copy(craft.pos);
    s.craft = craft;
  }
  currentStreet = s;
  return s;
}

/* The sign itself: mono, camera-facing (a Sprite always is), at the entrance.
   Cut at STREET_SIGN characters and built through makeLabel(), so a Hebrew
   conversation title reads right-to-left here exactly as it does on a drone
   tag — same first-strong-character rule, same bidi pass. */
function nameStreet(s, title) {
  if (s.sign) { labelGroup.remove(s.sign); disposeSprite(s.sign); }
  const spr = makeLabel(clipName(title, STREET_SIGN), '#f2e7cf', 34);
  spr.userData.px = 34;
  spr.userData.isSign = true;
  spr.userData.street = s;           // the picker walks back from sign to street
  spr.userData.maxPx = 17;      // just above the 13 px floor — see sizeCaption()
  labelGroup.add(spr);
  s.sign = spr;
  s.name = title;
  s.titled = true;
  s.dirty = true;
}

/* Live avenue: lamps on, sign bright. Finished avenue: lamps down to an ember,
   sign dimmed — but never removed. A street that has stopped being worked on is
   still the street that work happened on. */
export function setStreetLive(id, live) {
  const s = streets.get(id);
  if (!s || s.live === !!live) return;
  s.live = !!live;
  lampsDirty = true;
}

export const streetCount = () => streetOrder.length;
/* Title block: "N streets · current: <live session title>". The live one is the
   avenue the newest events are landing on; with none live it is the last opened. */
export function liveStreetTitle() {
  for (let i = streetOrder.length - 1; i >= 0; i--) if (streetOrder[i].live) return streetOrder[i].name;
  return streetOrder.length ? streetOrder[streetOrder.length - 1].name : null;
}

/* Which avenue an event belongs to. A file already standing keeps the street of
   the session that FIRST touched it, whatever session is touching it now — that
   is decided in touch(), not here; this only resolves the session id. */
function streetFor(sid) {
  if (sid && streets.has(sid)) return streets.get(sid);
  return currentStreet || streetOrder[0] || null;
}

/* Roads and signs are written only when an avenue's box actually grew. */
function syncStreets() {
  for (const s of streetOrder) {
    if (!s.dirty && s.roadW === s.w) continue;
    s.roadW = s.w;
    s.dirty = false;
    const [x, z] = worldOrigin(s);
    s.road.scale.set(s.w, STREET_ROAD, 1);
    s.road.position.set(x + s.w / 2, 0.055, z + STREET_ROAD / 2);
    /* The sign stands ON the entrance rather than out past it, at eye height
       for the wide shot: the outermost avenues already sit against the edge of
       the frame, and a sign hung a metre further out is the one that reads back
       as "usikschule" (HANDOFF open item 6). */
    s.sign.position.set(x + 0.6, 1.15, z + STREET_ROAD * 0.5);
    lampsDirty = true;
  }
  for (const s of streetOrder) {
    if (s.sign) s.sign.material.opacity = s.live ? 0.96 : 0.52;
  }
  if (lampsDirty) { lampsDirty = false; syncLamps(); }
}


/* =============================================================================
   LIFE — the crowd on the avenues, in two regimes
   data-sid="city-life"

   The owner's rule this section exists for: "Life is mandatory everywhere, but
   in ACTIVE cities the life must be WORKERS so it fits the atmosphere — in what
   is already finished, normal life; in the areas under construction, workers."

   A street is a SESSION, so a street is under construction exactly as long as
   its session is: live now, or last touched inside the same window a building
   greys on. That is PERMANENCE_MS — the TRON permanence, the film's 29 minutes
   — and reusing it rather than inventing a second number is the point: the
   regime a street is in and the warmth of the buildings standing on it are
   driven by one clock, so they can never disagree on screen.

   Everything here obeys the module's own data rule (docs/LIFE.md): every
   population is a number that was passed in, and every number below is read off
   this street's real tool calls, edits, and calls in flight. Nothing is a
   constant crowd.
   ========================================================================== */

/* --- THE UNIT CONVERSION, ONCE -------------------------------------------
   life.js works in real metres: a pedestrian is 1.72-1.82 m and a van is about
   five. This city does not — a whole FILE stands on a 1.0-unit plot. So the
   living layer gets its own group with ONE scale on it and every coordinate
   handed to the module goes through M() below; nothing inside life.js ever
   sees a city unit and nothing in this file ever sees a metre.

   THE NUMBER, and where it comes from. Two things in this city are real STREET
   FURNITURE drawn at street size, and they are the only honest anchors here:

     - the carriageway, `STREET_ROAD` = 2.2 units, which is a two-lane street
       with its kerbs — call it 9.5 m — giving 0.232 units per metre;
     - the lamp post, scaled to 1.35 units in syncLamps(), which at a real
       street lamp's ~6 m gives 0.225.

   Two independent numbers agreeing inside 3% is the answer, and the drone kit's
   own CRAFT_SCALE (0.32) is the third witness — solved by a completely
   different route (it keeps an ORNIS craft the width of the disc it replaced)
   and landing in the same order of magnitude. At 0.23 a 1.75 m person is 0.40
   units, a van is 1.15 on a 2.2-unit carriageway, and the pavement the kerbs
   mark out is 2.4 m, which is a pavement.

   WHAT IS DELIBERATELY NOT THE ANCHOR: the building floor. `T.fh` is 0.30 and
   it is tempting to call that a three-metre storey — but a floor here is one
   EDIT, not a storey, drawnFloors() compresses it above 24 on purpose, and a
   whole FILE stands on a one-metre-square lot. The buildings are an abstraction
   of a file tree; the road and the lamp are the only things in the frame that
   are what they look like. Anchoring on the floor gives 0.10, at which a person
   is seventeen pixels at the closest pose the zoom allows — measured, see
   docs/HANDOFF.md CITY-LIFE-DOC. */
const LIFE_SCALE = 0.23;             // city units per metre
const M = u => u / LIFE_SCALE;       // city units -> life.js metres

const LIFE_OFF = new URLSearchParams(location.search).get('life') === '0';
/* The road surface (syncStreets puts it at 0.055) plus a hair, so a foot is on
   the carriageway rather than inside it. The whole group carries this, which is
   why Life's own getHeight() can return a flat 0. */
const LIFE_GROUND_Y = 0.062;
/* The kerb inset syncLamps() already lays its posts on. Repeated rather than
   shared because touching syncLamps() is a change this task did not ask for —
   if one of the two ever moves, the other is here. */
const LIFE_KERB = 0.28;
/* The forecourt line: every avenue's road and both its pavements start here,
   one unit in front of the entrance, and so does the plaza. It is where each
   street's orchestrator craft docks (openStreet puts it at s.x + 1.5), and
   because the same x is a vertex of every road, life.js finds a junction at
   every avenue mouth — which is what gives the crossings something to hang on
   and reportError() a lane to stage an incident on. */
const LIFE_ENTRY_X = -1.2;

/* --- How many, and how far out -------------------------------------------
   The biggest town on this machine is 201 streets. Populating all of them is
   not a frame-rate question, it is an arithmetic one: at eight people an avenue
   that is sixteen hundred pedestrians against a module whose measured gate is
   three hundred. So the crowd is a POOL — populate() runs once, at the city's
   high-water mark, and everything after that is a fit against a reserve, the
   same shape globe.js uses for a planet of 142 settlements.

   Which streets get it: every avenue UNDER CONSTRUCTION, always, because the
   crew at a live print is the thing this section is for; plus the nearest
   LIFE_NEAR_STREETS finished ones, by camera distance. A finished avenue on the
   far side of a 300-unit town is a sprite either way. */
const LIFE_NEAR_STREETS = 6;
const LIFE_POOL_CREW     = 40;   // workers, across every site at once
const LIFE_POOL_RESIDENT = 72;   // and the people who live on the finished ones
const LIFE_POOL_CARS     = 24;
const LIFE_CREW_MIN = 2;         // a site with one call in flight is still a site
const LIFE_CREW_MAX = 8;         // above this the tags round one print stop reading
const LIFE_HUMANS_MAX = 12;
const LIFE_CARS_MAX = 4;
/* The same 1,000 tool calls globe.js and world.js call town class (docs/LIFE.md,
   "What each HOST reads the trigger off"). A project this size gets the square's
   furniture; a four-file scratch project does not. */
const LIFE_TOWN_CALLS = 1000;
/* The graph is re-cut on a timer and not per event: a burst of forty tool calls
   is one rebuild, not forty, and addWalkways' node weld is O(n^2). */
const LIFE_GRAPH_MS = 1400;
/* The hand-over is one person per fit, not a whole crew at once — see
   setLifePopulation(). */
const LIFE_FLIP_PER_TICK = 1;

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

let life = null;                 // the module, once loaded
let lifeStage = null;            // the scaled group everything of Life's lives in
let lifeCam = null;              // the real camera, expressed in Life's metres
let lifeEnv = null;              // the PMREM under the two lights below
let lifeSun = null, lifeFill = null;
/* THE CROWD IS THE ONLY LIT THING IN THIS CITY, and this is how it gets lit
   without changing anything else. Every other material here is Basic or a
   custom shader; life.js's are MeshStandard/MeshPhysical and expect a host with
   a real rig — life.html gives them a 2.6 sun and a 0.55 hemisphere and that is
   what the people in `docs/shots/life-*.png` are lit by. An environment map
   alone is not enough: at envMapIntensity 0.6 under a dusk PMREM the whole
   crowd renders as black silhouettes (measured, see docs/HANDOFF.md
   CITY-LIFE-DOC).

   Two lights added to the scene would also light the ORNIS fleet, which is a
   change this task did not ask for. So both are put on their own LAYER and
   every object under lifeStage is opted into it: a light on layer 1 illuminates
   only objects that are also on layer 1, and `layers.enable` keeps layer 0 — so
   the camera still draws the crowd and nothing else in the city is touched. */
const LIFE_LAYER = 1;
let lifeGraphAt = 0;             // `now` of the last graph cut
let lifeRate = 1;                // how fast the crowd's clock runs; see setLifeRate()
let lifeActive = [];             // the streets the graph currently holds
let lifeCounted = { crew: 0, humans: 0, cars: 0 };
const lifeReserve = { crew: [], people: [], cars: [] };
/* tool_use id -> the avenue that call is running on. toolEnd() is handed an id
   and nothing else, so this is what lets a finished call be taken off its own
   street's in-flight count instead of the city's. */
const toolStreet = new Map();

/* --- Which regime an avenue is in ----------------------------------------
   Two facts, both real: is the session live, and how long ago did anything
   land on it. Nothing else — not the age of the buildings, not whether a print
   is running this instant, because a crew that vanished between two calls and
   came back would be a strobe rather than a site. */
function streetRegime(s) {
  if (s.live) return 'crew';
  if (s.lastAt !== undefined && sessionNow - s.lastAt < PERMANENCE_MS) return 'crew';
  return 'settled';
}

/* Edits on this avenue inside the same window. Pruned here rather than on the
   event, because the session clock can jump backwards on a seek and a list
   pruned forward-only would then be wrong. */
function recentEdits(s) {
  const t = s.editTimes;
  if (!t || !t.length) return 0;
  const cut = sessionNow - PERMANENCE_MS;
  let i = 0;
  while (i < t.length && t[i] < cut) i++;
  if (i) t.splice(0, i);
  return t.length;
}

/* What one avenue earns. Every number traces to something the replay actually
   carried; the table of them is in docs/LIFE.md, "What each HOST reads the
   trigger off", city.js row. */
function lifeCountsFor(s) {
  if (streetRegime(s) === 'crew') {
    /* THE CREW IS THE WORK IN FLIGHT. One worker per tool call still running
       plus one per edit inside the window: a street with eight calls out and a
       run of writes is a busy site, and a street whose last event was twenty
       minutes ago is two people packing up. */
    const crew = clampN((s.inFlight || 0) + recentEdits(s), LIFE_CREW_MIN, LIFE_CREW_MAX);
    return { crew, humans: 0,
             /* Site vehicles. life.js deals its traffic off one deck and four of
                its ten cards are a van or a pickup, so a site street does not
                need a vehicle set of its own — it needs the deck dealt for a
                road whose WEIGHT is its own call count, which is what
                lifeRoadWeight() below hands addRoads. */
             cars: clampN(Math.ceil(crew / 3), 1, 3), dogs: 0 };
  }
  /* A FINISHED AVENUE IS A NEIGHBOURHOOD. The residents are the square root of
     the session's tool calls — the same shape globe.js uses for a settlement,
     and the reason it is a root rather than a ratio is that a 4,000-call
     conversation is not two hundred times the street a 20-call one is. */
  const humans = clampN(Math.round(Math.sqrt(s.tools || 0)), 1, LIFE_HUMANS_MAX);
  return { crew: 0, humans,
           cars: clampN(Math.round((s.edits || 0) / 12), 0, LIFE_CARS_MAX),
           /* The globe's own ratio, and life.js drops them all anyway where the
              pavement graph has no shops on it. */
           dogs: Math.floor(humans / 12) };
}

/* How much traffic an avenue's carriageway gets, which in life.js is the road's
   `weight` and nothing else. A live site pulls the vans. */
function lifeRoadWeight(s) {
  return streetRegime(s) === 'crew'
    ? 1 + (s.inFlight || 0) + recentEdits(s)
    : 1 + Math.round(Math.sqrt(s.tools || 0) / 3);
}

/* --- The city's own geometry, in metres ---------------------------------- */

/* Every active avenue's carriageway centre line, plus the forecourt road that
   crosses all of them. The crossing road SHARES the first vertex of every
   street polyline exactly, which is life.js's rule for finding a junction —
   two roads have to meet at a point that is in both lists, not merely near. */
function lifeRoads(active) {
  const out = [], zs = [];
  for (const s of active) {
    const [sx, sz] = worldOrigin(s);
    const zc = sz + STREET_ROAD * 0.5;
    zs.push(zc);
    const n = Math.max(2, Math.round(s.w / 8));
    const pts = [[M(LIFE_ENTRY_X), 0, M(zc)]];
    for (let i = 1; i <= n; i++) pts.push([M(sx + s.w * i / n), 0, M(zc)]);
    out.push(Object.assign(pts, { weight: lifeRoadWeight(s) }));
  }
  if (zs.length > 1) {
    zs.sort((a, b) => a - b);
    out.push(Object.assign(zs.map(z => [M(LIFE_ENTRY_X), 0, M(z)]), { weight: 1 }));
  }
  return out;
}

/* The pavements: both kerbs of every active avenue, plus one stub per district
   standing on it. A stub is a pavement run with a dead end, and a dead end is
   what life.js reads as a DOOR — every third one becomes a shop — so the
   frontages of the real directory plates are literally what the errands are
   aimed at. Nothing invents a building line: the stub ends at the plate's own
   near edge.

   Avenues are deliberately NOT linked to each other. Each is its own component
   of the walking graph, which is what keeps a session's residents on the street
   that session built and a site's crew inside its own hoarding — and it costs
   nothing, because the two kerbs of one avenue are joined by the zebra
   crossings life.js finds at that avenue's own junction with the forecourt. */
function lifeWalkways(active) {
  const out = [];
  for (const s of active) {
    const [sx, sz] = worldOrigin(s);
    const near = sz + LIFE_KERB, far = sz + STREET_ROAD - LIFE_KERB;
    const n = Math.max(2, Math.round(s.w / 6));
    for (const kz of [near, far]) {
      const pts = [[M(LIFE_ENTRY_X), 0, M(kz)]];
      for (let i = 0; i <= n; i++) pts.push([M(sx + s.w * i / n), 0, M(kz)]);
      out.push(pts);
    }
    /* One door per district, capped: a 60-plate avenue would otherwise weld
       three hundred nodes and addWalkways' node search is quadratic. */
    let doors = 0;
    for (const k of s.kids) {
      if (!k.isPlate || doors >= 8) continue;
      const [kx, kz] = worldOrigin(k);
      const cx = kx + k.w / 2;
      if (kz - 0.08 <= far) continue;          // a plate that is not past the kerb
      out.push([[M(cx), 0, M(far)], [M(cx), 0, M(kz - 0.08)]]);
      doors++;
    }
  }
  return out;
}

/* The square, on the forecourt where every avenue begins and every session's
   orchestrator hovers. One, not one per street: the city has one entrance.

   `carsAllowed` is left true on purpose. The forecourt road is the ONLY thing
   joining the avenues' lanes to each other, and cutting a pedestrian zone
   through it (docs/LIFE.md, addPlaza) would leave every street a dead-ended
   stretch with no junction on it — no crossings, and no lane for reportError()
   to stage an incident on. */
const LIFE_PLAZA_R = 1.7;            // city units
function lifePlaza(active) {
  if (!active.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const s of active) {
    const z = worldOrigin(s)[1] + STREET_ROAD * 0.5;
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  const zc = (lo + hi) / 2;
  /* Benches on the rim, facing in. The host decides where a bench IS and the
     module decides who sits on it — docs/LIFE.md, addWalkways. */
  const seats = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    seats.push([M(LIFE_ENTRY_X + Math.sin(a) * (LIFE_PLAZA_R - 0.25)), 0,
                M(zc + Math.cos(a) * (LIFE_PLAZA_R - 0.25)), a + Math.PI]);
  }
  return { center: [M(LIFE_ENTRY_X), 0, M(zc)], radius: M(LIFE_PLAZA_R), seats };
}

/* The square's furniture and the hedges, off the city's own facts. This is the
   `index.html` row of docs/LIFE.md's host table.

   `cafeTables` and `playground` are deliberately absent and that is not an
   omission: a project city has no trade classification and no residential
   square — its one square is the forecourt every session's orchestrator docks
   over, which is a place of work. world.js leaves both out of the fortress
   court for the same reason. There is no pasture and no sky box either: a
   project has no field and no roost, and inventing one would be exactly the
   decoration this whole file refuses. */
function lifeProps(active) {
  let calls = 0;
  for (const s of streetOrder) calls += s.tools || 0;
  const town = calls >= LIFE_TOWN_CALLS;
  /* One hedge per 18 m of real pavement, the globe's own ratio, capped 26. */
  let pave = 0;
  for (const s of active) pave += (s.w + Math.abs(LIFE_ENTRY_X)) * 2;
  const humans = active.reduce((n, s) => n + lifeCountsFor(s).humans, 0);
  return {
    plaza: { fountain: town, kiosk: town,
             /* A bus stop needs somewhere to come FROM: more than one avenue is
                the city's version of "a road arrives". */
             busstop: town && active.length > 1 },
    walkBushes: Math.min(26, Math.round(M(pave) / 18)),
    cats: active.length ? clampN(Math.round(humans / 25), 1, 3) : 0,
  };
}

/* --- Boot ----------------------------------------------------------------
   Fired from init() and deliberately not awaited: Life.load() decimates
   eighteen 50,000-triangle meshes and takes about twenty seconds on this
   machine, and a city that will not draw for twenty seconds is a worse city
   than one whose crowd arrives late. Nothing else in the file waits on it —
   every call site below is guarded on `life`. */
export function loadLife() {
  if (LIFE_OFF || life || !ok) return Promise.resolve(false);
  lifeStage = new THREE.Group();
  lifeStage.name = 'life';
  lifeStage.scale.setScalar(LIFE_SCALE);
  lifeStage.position.y = LIFE_GROUND_Y;
  scene.add(lifeStage);
  lifeCam = new THREE.PerspectiveCamera();
  lifeCam.matrixAutoUpdate = false;
  /* THIS SCENE HAS NO LIGHTS. Every other material in it is Basic or a custom
     shader; life.js's are MeshStandard/MeshPhysical at envMapIntensity 0.6, and
     without an environment they render black — the same trap the ORNIS kit hit
     and fixed with one PMREM off this city's own sky dome. `scene.environment`
     is the only lever life.js exposes (it has no setEnvironment()), and it is
     safe to set here precisely BECAUSE nothing else in the scene is lit by it. */
  lifeEnv = bakeDroneEnv();
  scene.environment = lifeEnv;
  /* The city already solves a sun direction and a sun colour every frame for
     its own facade shader (see render()); these two read the same numbers, so
     the crowd stands in exactly the dusk the buildings are standing in rather
     than in a second, disagreeing one. Inside lifeStage, whose scale is
     uniform — a directional light's direction is target minus position and a
     uniform scale leaves it alone. */
  lifeSun = new THREE.DirectionalLight(0xffffff, 2.6);
  lifeSun.layers.set(LIFE_LAYER);
  lifeFill = new THREE.HemisphereLight(0x9fb6d8, 0x3a3128, 0.55);
  lifeFill.layers.set(LIFE_LAYER);
  lifeStage.add(lifeSun, lifeSun.target, lifeFill);
  return Life.load(renderer, lifeStage, {
    manifestUrl: 'assets/manifest.json',
    /* Flat 0: the group above already stands on the carriageway, and a city
       plate is a raised slab the crowd never walks on. */
    getHeight: () => 0,
    camera: lifeCam,
    seed: 7,
    /* Both below the module's defaults (40 / 8) for the same reason globe.js
       trims them: this page is already spending its budget on an instanced
       skyline, a fleet of ORNIS craft and a bloom pass. */
    maxSkinned: MOBILE ? 10 : 18,
    rigid: MOBILE ? 2 : 4,
    shadows: 0,                       // no shadow-casting light to cast from
  }).then(l => {
    life = l;
    /* The pool. populate() sizes every InstancedMesh and every Crowd once and
       never grows them, so everything the city can ever ask for has to be
       standing in it for this one call.

       THE CREW IS PRE-SEATED, and this is the one place this file reaches into
       the module. populate() deals its humans round all four models
       (`human.casual`, `casualF`, `suit`, `worker`), so asking it for forty
       people gets ten in a hi-vis vest and thirty in a coat — which is a street,
       not a site. _pedestrian() is the module's own constructor and
       _buildCrowds(), which runs inside populate() below, sizes each Crowd off
       whatever is in `actors` — so pushing the crew in first is what makes the
       worker mesh big enough. The API that would replace this is written up in
       docs/HANDOFF.md, CITY-LIFE-DOC. */
    if (typeof life._pedestrian === 'function') {
      for (let i = 0; i < LIFE_POOL_CREW; i++) {
        const p = life._pedestrian('human.worker', i);
        p.isCrew = true;
        life.actors.push(p);
      }
      life.counts.humans += LIFE_POOL_CREW;
    } else {
      console.warn('life.js has no _pedestrian(); crews will wear the ordinary mix');
    }
    rebuildLifeGraph(true);
    return true;
  }).catch(e => {
    life = null;
    console.warn('the living layer did not load:', e && e.message);
    return false;
  });
}

/* --- The graph, re-cut when the city changes shape ----------------------- */

/* Which avenues are populated this pass: every site, plus the nearest finished
   ones. Sites first and uncapped, because the crew at a live print is the whole
   point of the two regimes. */
function lifeActiveStreets() {
  const crews = [], rest = [];
  for (const s of streetOrder) (streetRegime(s) === 'crew' ? crews : rest).push(s);
  rest.sort((a, b) => lifeStreetDist(a) - lifeStreetDist(b));
  return crews.concat(rest.slice(0, LIFE_NEAR_STREETS));
}

/* How far the camera is from an avenue's mouth, in city units. */
function lifeStreetDist(s) {
  const [sx, sz] = worldOrigin(s);
  const dx = camera.position.x - (sx + s.w / 2);
  const dz = camera.position.z - (sz + STREET_ROAD / 2);
  return Math.sqrt(dx * dx + dz * dz);
}

/* Empty the module's world model without touching its population, then cut the
   new one. Reaching into life.js's own arrays, and it is the one function here
   that does: the module has no teardown, a second Life.load() is twenty more
   seconds of decimation, and these are its whole world model. globe.js's
   clearGraph() is the same call for the same reason — see that file. Every
   reference into them is re-seated by seatActors() in the same tick. */
function rebuildLifeGraph(force) {
  if (!life) return;
  const active = lifeActiveStreets();
  /* Stamped before the early return as well, or an unchanged set would be
     re-tested every frame instead of once every LIFE_GRAPH_MS. */
  lifeGraphAt = now;
  if (!force && !lifeSetChanged(active)) return;
  lifeActive = active;

  life.roads.length = 0;
  life.lanes.length = 0;
  life.junctions.length = 0;
  life.walk = { nodes: [], edges: [], doors: [], shops: [], homes: [],
                seats: [], plazas: [] };
  if (life.crossings) life.crossings.length = 0;
  life.plazaSpecs.length = 0;
  life.props.length = 0;

  if (!active.length) return;
  const props = lifeProps(active);
  life.addRoads(lifeRoads(active));
  /* Between the roads and the pavements, which is where docs/LIFE.md puts it:
     after the roads because the kiosk and the shelter are set against the open
     lanes, before the pavements because that pass is what wires the square into
     the walking graph. */
  const pz = lifePlaza(active);
  if (pz) life.addPlaza(pz.center, pz.radius, Object.assign({ seats: pz.seats }, props.plaza));
  /* 2.8 m is the real pavement this city has — the kerb inset syncLamps() lays
     its posts on, in metres — and handing it over is the difference between a
     crowd on the flagstones and a crowd on the carriageway. The plazas are
     already in life.plazaSpecs from the call above, so passing them again here
     would register the same square twice. */
  life.addWalkways(lifeWalkways(active), [], { width: M(LIFE_KERB * 2),
                                               bushes: props.walkBushes });

  /* Which nodes belong to which avenue, for the seating below. Classified by z
     after the weld rather than recorded during it, because addWalkways welds
     two points within 0.75 m into one node and the polyline they came from is
     not a thing the module keeps. Avenue bands never overlap — STREET_GAP is
     what guarantees it — so a node's z names its street unambiguously. */
  for (const s of active) s.lifeNodes = [];
  const nodes = life.walk.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const zu = nodes[i].pos.z * LIFE_SCALE;
    for (const s of active) {
      const z0 = worldOrigin(s)[1];
      if (zu >= z0 - 0.2 && zu <= z0 + s.h + 0.2) { s.lifeNodes.push(i); break; }
    }
  }

  /* `populated` is this file's own flag on the module instance, not life.js's:
     populate() sizes every Crowd and every InstancedMesh once and calling it
     twice would build a second set nothing draws. */
  if (life.populated) { seatActors(); setLifePopulation(); }
  else {
    life.populate({ humans: LIFE_POOL_RESIDENT, cars: LIFE_POOL_CARS,
                    /* Zero robots, exactly as world.js does it: a live agent
                       here is one ORNIS craft, and drawing it a second time as
                       a robot on the pavement would be a lie about the count
                       (docs/DECISIONS.md). The cost is that life.js's own
                       reportError() has nothing to stage an incident ON — see
                       lifeReportError() below. */
                    robots: 0,
                    dogs: active.reduce((n, s) => n + lifeCountsFor(s).dogs, 0),
                    cats: props.cats });
    life.populated = true;
    seatActors();
    setLifePopulation();
  }
  life.setNight(nightAmt);
  markLifeLayer();
}

/* Opt every object the module just built into the crowd's own light layer.
   Called after each graph cut because `populate()`, `_prop()` and the plaza
   furniture all create their meshes inside these calls and a mesh that is not
   on the layer is a black silhouette. `enable`, not `set`: layer 0 has to stay
   on or the camera stops drawing it. */
function markLifeLayer() {
  lifeStage.traverse(o => { if (o !== lifeSun && o !== lifeFill) o.layers.enable(LIFE_LAYER); });
}

/* Did the set of populated avenues actually change? A rebuild is a node weld
   and a re-seat; doing it because the camera drifted a metre would be a crowd
   teleporting every frame. */
function lifeSetChanged(next) {
  if (next.length !== lifeActive.length) return true;
  for (let i = 0; i < next.length; i++) if (next[i] !== lifeActive[i]) return true;
  return false;
}

/* --- Who stands where ---------------------------------------------------- */

/* Put every actor back on the graph that now exists, on ITS OWN avenue. After a
   rebuild every `node`, `path` and `home` index points into a graph that no
   longer exists, and life.js's _stepPeople() reads nodes[a.path[0]].pos with no
   guard — the same 70-exceptions-a-frame globe.js measured before it added its
   own reseat(). */
function seatActors() {
  if (!life) return;
  for (const a of life.actors) {
    if (a.kind !== 'person') continue;
    const s = a.street && lifeActive.indexOf(a.street) >= 0 ? a.street : null;
    seatOn(a, s);
  }
}

function seatOn(a, s) {
  const pool = s && s.lifeNodes && s.lifeNodes.length ? s.lifeNodes : null;
  const nodes = life.walk.nodes;
  const i = pool ? pool[Math.floor(life.rand() * pool.length)] : -1;
  a.node = a.target = i;
  a.path = []; a.point = null; a.cross = null;
  a.leader = null; a.groupSize = 1;
  if (a.seat) { a.seat.taken = false; a.seat = null; }
  a.state = 'walk'; a.hold = 0;
  if (i >= 0) {
    a.pos.copy(nodes[i].pos);
    a.pos.x += (life.rand() - 0.5) * 1.6;
    a.pos.z += (life.rand() - 0.5) * 1.6;
    /* A CREW MEMBER'S ROUND STARTS AND ENDS AT THE PRINT. `home` is where
       life.js's errand round returns to (docs/LIFE.md, "The day a pedestrian
       has"), so pinning it to the node nearest whatever is materialising on
       this street is what keeps the crew clustered at the work and walking out
       to the carriageway — where the vans are — and back, instead of drifting
       the length of the avenue. */
    a.home = a.isCrew && s ? (printNodeFor(s) >= 0 ? printNodeFor(s) : i) : i;
  } else {
    a.home = -1;
  }
}

/* The pavement node nearest the building this avenue is printing right now, or
   nearest its most recently touched one. -1 when the street has nothing on it
   yet. */
function printNodeFor(s) {
  let b = null;
  for (const j of printJobs) {
    const t = j.b;
    if (t && streetOf(t) === s) { b = t; break; }
  }
  if (!b) {
    let best = -Infinity;
    for (const f of files.values()) {
      if (f.gone || streetOf(f) !== s) continue;
      if (f.touchedAt > best) { best = f.touchedAt; b = f; }
    }
  }
  if (!b || !s.lifeNodes) return -1;
  const nodes = life.walk.nodes;
  let idx = -1, bd = Infinity;
  for (const i of s.lifeNodes) {
    const dx = nodes[i].pos.x * LIFE_SCALE - b.wx;
    const dz = nodes[i].pos.z * LIFE_SCALE - b.wz;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; idx = i; }
  }
  return idx;
}

/* Which avenue a building stands on. The plate chain always ends at one. */
function streetOf(b) {
  let n = b && b.plate;
  while (n && !n.isStreet) n = n.parent;
  return n || null;
}

/* THE FIT, and the regime flip. Every avenue's earned counts are added up, the
   surplus goes to a reserve and the shortfall comes back out of it — the same
   pool-and-reserve globe.js uses, because populate() sizes its meshes once and
   never grows them.

   The flip is deliberately GRADUAL: at most LIFE_FLIP_PER_TICK people change
   hands per pass, so a street that goes quiet loses its crew one at a time over
   a few seconds and gains its residents the same way, rather than swapping six
   bodies in one frame. It is a hand-over and not a scripted departure — what a
   scripted one would need is written up in docs/HANDOFF.md, CITY-LIFE-DOC. */
function setLifePopulation() {
  if (!life) return;
  const crewOn = new Map(), peopleOn = new Map();
  let crew = 0, humans = 0, cars = 0;
  for (const s of lifeActive) {
    const c = lifeCountsFor(s);
    crewOn.set(s, c.crew); peopleOn.set(s, c.humans);
    crew += c.crew; humans += c.humans; cars += c.cars;
  }
  lifeCounted = { crew, humans, cars };

  /* Everybody currently placed, split by what they are and where they are. */
  const have = new Map();
  const keep = [];
  for (const a of life.actors) {
    if (a.kind !== 'person') { keep.push(a); continue; }
    /* THE ACCIDENT'S VICTIM IS NOT PART OF THE FIT. `a.crash` means life.js has
       this body lying in the road with an ambulance on its way to it; handing it
       to the reserve pops it out again on some other avenue seconds later, and
       seatOn() teleports it there — measured mid-incident on the promo town, the
       victim 422 m from the wreck the ambulance was still attending. It is kept,
       drawn and left where it is until the accident clears itself. */
    if (a.crash) { keep.push(a); continue; }
    if (a.street && lifeActive.indexOf(a.street) >= 0) {
      const k = have.get(a.street) || { crew: [], people: [] };
      (a.isCrew ? k.crew : k.people).push(a);
      have.set(a.street, k);
    } else {
      (a.isCrew ? lifeReserve.crew : lifeReserve.people).push(a);
      a.street = null;
    }
  }

  let moved = 0;
  const fit = (s, kind, want) => {
    const k = have.get(s) || { crew: [], people: [] };
    const list = kind === 'crew' ? k.crew : k.people;
    const res = kind === 'crew' ? lifeReserve.crew : lifeReserve.people;
    while (list.length > want && moved < LIFE_FLIP_PER_TICK + 4) {
      const a = list.pop(); a.street = null; res.push(a); moved++;
    }
    while (list.length < want && res.length && moved < LIFE_FLIP_PER_TICK + 4) {
      const a = res.pop(); a.street = s; seatOn(a, s); list.push(a); moved++;
    }
    have.set(s, k);
  };
  for (const s of lifeActive) { fit(s, 'crew', crewOn.get(s)); fit(s, 'people', peopleOn.get(s)); }

  /* life.actors is rebuilt from what survived, which is what actually takes a
     reserved walker off the screen: life.js draws `actors` and nothing else. */
  const out = [];
  for (const s of lifeActive) {
    const k = have.get(s);
    if (k) { for (const a of k.crew) out.push(a); for (const a of k.people) out.push(a); }
  }
  life.actors = out.concat(keep);
  life.counts.humans = out.length;

  /* The traffic. life.js has no per-road population call, so the fit is on the
     total and the road WEIGHTS decide where they end up — which is the module's
     own rule and the reason lifeRoadWeight() is a site's call count. */
  const want = clampN(cars, 0, LIFE_POOL_CARS);
  while (life.vehicles.length > want) lifeReserve.cars.push(life.vehicles.pop());
  while (life.vehicles.length < want && lifeReserve.cars.length) {
    life.vehicles.push(lifeReserve.cars.pop());
  }
  life.counts.cars = life.vehicles.length;
}

/* --- The cones round a live print ----------------------------------------
   Instanced in THIS file and not asked of life.js, and the reason is the size
   of the thing: a traffic cone is eight triangles. The module's props are
   50,000-triangle photogrammetry scans that arrive through a manifest, a
   decimation ladder and a two-rung LOD budget (docs/LIFE.md, "The statics' own
   two rungs") — the whole of that machinery to draw a cone would cost more
   than the cone does. It is also not life.js's fact: a hoarding goes round the
   footprint being PRINTED, and the print is this file's own event. */
const MAX_CONES_LIFE = 64;
const CONE_PER_LOT = 6;
let siteCones = null, siteConeCount = 0;
function buildSiteCones() {
  const geo = new THREE.ConeGeometry(0.045, 0.13, 5);
  geo.translate(0, 0.065, 0);
  siteCones = new THREE.InstancedMesh(geo,
    new THREE.MeshBasicMaterial({ color: 0xff6a2a }), MAX_CONES_LIFE);
  siteCones.count = 0;
  siteCones.frustumCulled = false;
  scene.add(siteCones);
}

/* Round every footprint printing right now, and round the last building each
   site touched so a site between two prints still reads as fenced off. */
function syncSiteCones() {
  if (!siteCones) return;
  const lots = [];
  for (const j of printJobs) if (j.b && !j.b.gone) lots.push(j.b);
  for (const s of lifeActive) {
    if (streetRegime(s) !== 'crew' || lots.length * CONE_PER_LOT >= MAX_CONES_LIFE) continue;
    const i = printNodeFor(s);
    if (i < 0) continue;
    let b = null, best = -Infinity;
    for (const f of files.values()) {
      if (f.gone || streetOf(f) !== s) continue;
      if (f.touchedAt > best) { best = f.touchedAt; b = f; }
    }
    if (b && lots.indexOf(b) < 0) lots.push(b);
  }
  siteConeCount = 0;
  for (const b of lots) {
    const T = TYPES[b.type];
    for (let k = 0; k < CONE_PER_LOT && siteConeCount < MAX_CONES_LIFE; k++) {
      const a = k / CONE_PER_LOT * Math.PI * 2;
      dummy.position.set(b.wx + Math.sin(a) * (T.w * 0.5 + 0.10), 0.30,
                         b.wz + Math.cos(a) * (T.d * 0.5 + 0.10));
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      siteCones.setMatrixAt(siteConeCount++, dummy.matrix);
    }
  }
  siteCones.count = siteConeCount;
  siteCones.instanceMatrix.needsUpdate = true;
}

/* --- The bookkeeping the two regimes are read off ------------------------ */

/* One tool call landed on an avenue. Called from toolStart(), which is the one
   place an event and a street actually meet. */
function lifeNoteEvent(s, fam, id) {
  if (!s) return;
  s.tools = (s.tools || 0) + 1;
  s.lastAt = sessionNow;
  if (fam === 'write') {
    s.edits = (s.edits || 0) + 1;
    (s.editTimes || (s.editTimes = [])).push(sessionNow);
  }
  if (id) {
    s.inFlight = (s.inFlight || 0) + 1;
    toolStreet.set(id, s);
  }
}

/* And its tool_result. `inFlight` is what the crew size is read off, so a call
   that never lands its end would leave a worker on the site for ever — the
   worker drone above has WORKER_TIMEOUT_MS for the same reason, and this rides
   on it: disposeWorker() is where a timed-out call gets its end. */
function lifeEndEvent(id) {
  const s = toolStreet.get(id);
  if (!s) return;
  toolStreet.delete(id);
  s.inFlight = Math.max(0, (s.inFlight || 0) - 1);
}

/* --- Accidents ------------------------------------------------------------
   A tool call that came back with an error is an accident on the street it was
   working. Optional-called: life.js's reportError() is the traffic pass's and
   this file must not depend on the shape of it.

   IT RETURNS A REASON TODAY RATHER THAN AN INCIDENT. reportError() stages the
   crash on a ROBOT — deliberately, because a robot is drawn from an instanced
   mesh with a `lean` in its matrix and a pedestrian is not — and this city
   passes robots: 0, because an agent here is already one ORNIS craft. So the
   call answers `{ why: 'no robot to stage it on' }` and the city draws nothing.
   That is reported, not swallowed: `__lifeProbe().lastError` carries it, and
   the API that would close it is in docs/HANDOFF.md, CITY-LIFE-DOC. */
let lifeLastError = null;
function lifeReportError(id, label) {
  if (!life || typeof life.reportError !== 'function') return;
  const s = toolStreet.get(id);
  const w = workers.get(id);
  const b = w && w.target;
  const at = b ? [M(b.wx), 0, M(b.wz)]
              : s ? [M(worldOrigin(s)[0] + s.w / 2), 0, M(worldOrigin(s)[1] + STREET_ROAD / 2)]
              : undefined;
  /* Wrapped, and not from timidity: reportError() belongs to the traffic pass
     and is being written in the same repo at the same time, and a throw inside
     it would land inside toolEnd() — the one call that retires a worker drone —
     and stop the fleet. One failed tool call must not be able to do that. */
  try {
    lifeLastError = life.reportError({ label: label || 'tool error', at }) || { why: 'declined' };
  } catch (e) {
    lifeLastError = { why: 'reportError threw: ' + (e && e.message) };
  }
}

/* --- The frame ----------------------------------------------------------- */

/* One call a frame from render(). `dt` is WALL time and it is already clamped
   to 0.1 s by replay.js's frame() and again to 0.08 s inside life.update() —
   which is what makes the replay's dead-air skip safe here: advance() speeds up
   the SESSION clock, not this one, so a crew never teleports across a gap the
   transport jumped. */
function updateLife(dt) {
  if (!life) return;
  if (now - lifeGraphAt > LIFE_GRAPH_MS / 1000) { rebuildLifeGraph(false); setLifePopulation(); }
  syncSiteCones();
  /* THE CAMERA LIFE SEES IS THE REAL ONE, IN METRES. life.js measures every
     actor's distance against camera.position to pick its LOD tier; handed the
     city camera it would read a walker forty units away as forty metres and
     hold the whole crowd at the near tier. */
  lifeCam.matrix.copy(lifeStage.matrixWorld).invert().multiply(camera.matrixWorld);
  lifeCam.matrix.decompose(lifeCam.position, lifeCam.quaternion, lifeCam.scale);
  /* The city's own sun, this frame. `sunDir` and `sunColor` are what the facade
     shader is handed below in render(); handing the crowd anything else would
     put the people and the buildings in two different times of day. */
  lifeSun.position.copy(sunDir).multiplyScalar(600);
  lifeSun.color.copy(sunColor);
  lifeFill.color.copy(sunColor);
  lifeFill.groundColor.copy(ambient);
  life.setNight(nightAmt);
  /* `lifeRate` is 1 everywhere except a recording. In ?record=1 a frame is worth
     a fixed 1/30 s of FILM but the transport advances the SESSION clock by
     clock.speed times that, so the crowd — the one layer paced off wall time —
     ran the session's whole accident sequence at 1/240th of the speed the film
     around it was playing at, and a staged collision needed 900 captured frames
     to finish. Handing it the replay's own rate puts the two clocks back on the
     same footing; life.update() clamps the product to 0.08 s itself, so the
     ceiling is 2.4x a record frame and nobody can teleport. */
  life.update(dt * lifeRate, lifeCam);
}

/* One caller: replay.js's startRecord(). Not a URL flag of this file's own — the
   rate a recording runs at is the transport's number, not the city's. */
export function setLifeRate(k) { lifeRate = Math.max(1, k || 1); }

/* THE TWO HARNESS HOOKS, and they are here rather than in replay.js with the
   rest of the `window.__*` family for one reason: replay.js is owned by another
   pass right now and this section has to be measurable without it. `__life` is
   the probe below; `__lifeFocus` is how a capture puts the lens on one avenue
   long enough to photograph its crew, since a screenshot harness has no pointer
   and the orbit will not go there on its own. */
window.__life = () => lifeProbe();
window.__lifeStand = (i, back, bearing) => {
  const s = streetOrder[i];
  if (!s) return false;
  const [x, z] = worldOrigin(s);
  /* Aimed at the PEOPLE, and only at the avenue's own geometry when there are
     none: the point of the shot is who is standing there. An avenue with 5,000
     tool calls reserves a band tens of units deep and its door stubs run into
     the districts, so the middle of the street is not where its crew is.

     AT ONE PERSON, NOT AT THE MIDDLE OF THE GROUP. This aimed at the CENTROID
     of everyone on the street, and a two-man crew standing 22 m apart at either
     end of a site has its centroid on empty tarmac between them: the pose was
     correct, the count said `crewPlaced: 2`, and the photograph was of nothing
     (docs/TESTS.md G3b, `crewAt` in lifeProbe() shows both heads outside the
     frame). So: stand in front of a crew member if the street has one — the
     crew IS the subject on a working street — and in front of the first
     resident otherwise. */
  let ax = x + Math.min(s.w, 22) * 0.5, az = z + STREET_ROAD * 0.5;
  let cn = 0;
  if (life) {
    const on = life.actors.filter(a => a.street === s);
    const subject = on.find(a => a.isCrew) || on[0];
    if (subject) { ax = subject.pos.x * LIFE_SCALE; az = subject.pos.z * LIFE_SCALE; cn = on.length; }
  }
  if (!cn) {
    const n = life ? printNodeFor(s) : -1;
    if (n >= 0) { ax = life.walk.nodes[n].pos.x * LIFE_SCALE; az = life.walk.nodes[n].pos.z * LIFE_SCALE; }
  }
  /* THE FREE-FLY LENS, not the orbit, and that is the whole reason this hook
     exists. The orbit re-solves its target from the city's own bounding box
     every frame and clamps its aim to a fifth of its own distance above the
     ground (see updateCamera), so it cannot be made to stand at head height in
     front of six people — and `cam.zoom` bottoms out at ZOOM_MIN x the fitted
     distance, which on a 300-unit town is still eleven units up. `F` already
     cuts all of that, and this is exactly the pose a viewer gets by pressing it
     and flying over: free.pos and the two angles are the entire camera. */
  const eye = standAt(ax, az, back, bearing);
  return { x: +ax.toFixed(2), z: +az.toFixed(2), on: cn, eye, name: s.name };
};

/* The pose itself, in CITY units, lifted out of __lifeStand so the accident
   hook below can use the identical lens. Nothing about it changed. */
function standAt(ax, az, back, bearing) {
  const b = bearing === undefined ? 2.3 : bearing;
  const d = back || 4.0;
  const eyeY = Math.max(FREE_EYE, d * 0.42);
  if (!free.on) toggleFreeFly();
  free.pos.set(ax + Math.sin(b) * d, eyeY, az + Math.cos(b) * d);
  const fx = ax - free.pos.x, fy = 0.55 - eyeY, fz = az - free.pos.z;
  const len = Math.hypot(fx, fy, fz) || 1;
  free.yaw = Math.atan2(-fx / len, -fz / len);
  free.pitch = Math.asin(Math.max(-1, Math.min(1, fy / len)));
  return +eyeY.toFixed(2);
}

/* THE ACCIDENT, FOR A LENS AND FOR A GATE. `__life().stats.accident` says which
   stage the incident is in; this says WHERE it is, in CITY units, and — passed
   `true` — puts the free-fly camera on it, because a capture harness has no
   pointer and the orbit will not go there by itself. That is the same reason
   __lifeStand exists, and this is the shot __lifeStand cannot frame: the victim
   is not necessarily the crew member that hook aims at.
   Callers: docs/RUNBOOK.md's accident capture, and the promo film's
   capture/probe_product.py --accident. Null until a host reports a real error. */
window.__lifeAccident = (stand, back, bearing) => {
  const A = life && life.accident;
  if (!A) return null;
  const ax = A.at.x * LIFE_SCALE, az = A.at.z * LIFE_SCALE;
  const out = {
    stage: A.stage, label: A.label, t: +A.t.toFixed(2), age: +(A.age || 0).toFixed(2),
    x: +ax.toFixed(2), z: +az.toFixed(2),
    victim: { kind: A.victim.kind, down: A.victim.crash ? A.victim.crash.stage : null,
              d: +A.victim.pos.distanceTo(A.at).toFixed(2) },
    car: A.car ? { type: A.car.type, speed: +A.car.speed.toFixed(2),
                   askew: +A.car.askew.toFixed(2), hazard: !!A.car.hazard } : null,
    amb: A.amb ? { s: +A.amb.s.toFixed(1), speed: +A.amb.speed.toFixed(1),
                   arrived: !!A.amb.arrived,
                   visible: !!(life.ambGroup && life.ambGroup.visible) } : null,
  };
  if (stand) out.eye = standAt(ax, az, back === undefined ? 9 : back, bearing);
  return out;
};

/* Every number this section is judged on, for the harness in docs/RUNBOOK.md
   and the probes in docs/TESTS.md. Read-only. */
export function lifeProbe() {
  if (!life) return { on: false, off: LIFE_OFF };
  const streets = lifeActive.map(s => ({
    idx: streetOrder.indexOf(s),
    name: s.name, regime: streetRegime(s), live: !!s.live,
    tools: s.tools || 0, edits: s.edits || 0,
    inFlight: s.inFlight || 0, recentEdits: recentEdits(s),
    want: lifeCountsFor(s),
    placed: life.actors.filter(a => a.street === s).length,
    crewPlaced: life.actors.filter(a => a.street === s && a.isCrew).length,
    /* WHERE THE CREW IS AND WHETHER IT IS IN SHOT. A screenshot harness has no
       pointer and no eyes: `crewPlaced: 2` with an empty photograph is the
       failure this closes (docs/TESTS.md G3b) — the count says the workers
       exist, and only a projection says whether the lens is pointing at them.
       `x`/`z` are CITY units (the same frame `__lifeStand` poses in) and `ndc`
       is the head's normalised device position, so |x|<1 and |y|<1 means "in
       frame". Built only for a street that actually has a crew. */
    crewAt: life.actors.filter(a => a.street === s && a.isCrew).map(a => {
      const wx = a.pos.x * LIFE_SCALE, wz = a.pos.z * LIFE_SCALE;
      _p.set(wx, LIFE_GROUND_Y + 1.75 * LIFE_SCALE, wz).project(camera);   // 1.75 m = head height
      return { x: +wx.toFixed(2), z: +wz.toFixed(2),
               ndc: [+_p.x.toFixed(2), +_p.y.toFixed(2), +_p.z.toFixed(2)] };
    }),
  }));
  return {
    on: true, scale: LIFE_SCALE,
    streetsTotal: streetOrder.length, streetsActive: lifeActive.length,
    counted: lifeCounted,
    actors: life.actors.length, vehicles: life.vehicles.length,
    nodes: life.walk.nodes.length, roads: life.roads.length,
    lanes: life.lanes.length, junctions: life.junctions.length,
    crossings: (life.crossings || []).length,
    shops: life.walk.shops.length, doors: life.walk.doors.length,
    plazas: life.walk.plazas.length, props: life.props.length,
    cones: siteConeCount,
    /* FLATTENED, because a probe a harness cannot JSON.stringify is not a probe.
       reportError() answers with life.js's own `accident` record when it stages
       one, and that record holds the victim ACTOR — whose `.street` is a city
       plate rect, whose `.kids[0].parent` closes a circle. One `JSON.stringify`
       of the whole probe therefore threw and every field below became
       unreadable in one call (docs/TESTS.md G4). Only the four readable facts
       of an accident cross this boundary; `why` is the declined case. */
    lastError: lifeLastError ? {
      why: lifeLastError.why,
      stage: lifeLastError.stage,
      label: lifeLastError.label,
      kind: lifeLastError.victim ? lifeLastError.victim.kind : undefined,
    } : null,
    /* Where the crowd actually IS, in CITY units, and how far the lens is from
       it — the two numbers a screenshot of an empty street cannot answer.
       life.js picks every LOD tier off metres, so `camMetres` is the number
       that says whether the people in shot are meshes or sprites. */
    camMetres: +(camera.position.distanceTo(_p.set(
      life.actors.length ? life.actors[0].pos.x * LIFE_SCALE : 0,
      LIFE_GROUND_Y,
      life.actors.length ? life.actors[0].pos.z * LIFE_SCALE : 0)) / LIFE_SCALE).toFixed(0),
    sample: life.actors.slice(0, 3).map(a => ({
      crew: !!a.isCrew, model: a.model,
      x: +(a.pos.x * LIFE_SCALE).toFixed(2), z: +(a.pos.z * LIFE_SCALE).toFixed(2),
    })),
    stats: typeof life.stats === 'function' ? life.stats() : null,
    /* What is actually being DRAWN, by tier — the one thing a screenshot of an
       empty-looking street cannot answer. `skinned` is the near tier (a real
       SkinnedMesh with a mixer), `instances` everything the VAT and the rigid
       ladder are drawing this frame. A layer that reads on:true with drawn:0 is
       a graph that built and a population that did not. */
    drawn: lifeStage ? (() => {
      let skinned = 0, instances = 0;
      lifeStage.traverse(o => {
        if (o.isSkinnedMesh && o.visible) skinned++;
        else if (o.visible && o.count > 0) instances += o.count;
      });
      return { skinned, instances };
    })() : null,
    streets,
  };
}


/* =============================================================================
   EFFECTS — what each tool family looks like
   ========================================================================== */
function sparkBurst(b, n, color) {
  const y = (b.wy || 0.5) + 0.25;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = 1.4 + Math.random() * 3.4;
    emit(b.wx, y, b.wz,
         Math.cos(a) * s, 1.6 + Math.random() * 3.4, Math.sin(a) * s,
         color, 0.055 + Math.random() * 0.05, 0.45 + Math.random() * 0.5, 0.22, -6.5);
  }
}
/* --- MATERIALISATION ------------------------------------------------------
   A building is laser-printed into the world from above: the print plane
   starts at the roof and descends, and everything under it does not exist yet
   (the discard in the facade shader). Thin red scaffolds stand under the part
   that is already printed and hold it up until the print lands on the ground,
   at which point they dissolve — which is exactly why the film needs them.
   `printJobs` is a plain array walked once a frame; a job is three numbers. */
const printJobs = [];
/* The last building that materialised, so `P` can play that print again. The
   replay is VISUAL ONLY — it re-runs the same plane over the same shell and
   touches no event, no floor count and no clock. */
let lastPrint = null;
export function replayLastPrint() {
  const b = lastPrint;
  if (!b || b.gone) return null;
  addPrint(b, 0.30 + b.wy, 0.30, printSecondsFor(b), true);
  return b.rel;
}
function startPrint(b, life, wantRig) {
  const top = 0.30 + b.wy;
  addPrint(b, top, 0.30, life, wantRig);
}
/* One new floor: the plane only has to come down as far as the old roof. */
function startLayer(b, oldTop) {
  addPrint(b, 0.30 + b.wy, Math.max(0.30, oldTop), LAYER_SECONDS, true);
}
function addPrint(b, y0, y1, life, wantRig) {
  /* A building already printing just gets its target extended — two overlapping
     planes on one instance would fight over the same float. */
  for (const j of printJobs) {
    if (j.b === b) { j.y0 = Math.max(j.y0, y0); j.y1 = Math.min(j.y1, y1); j.t = 0; j.life = life; j.after = 0; return; }
  }
  /* `after` is the lattice's own clock, which starts when the print ENDS: hold,
     then dissolve upward. The building is finished the whole time — this is the
     scaffolding coming off, not part of the build. */
  const job = { b, y0, y1, t: 0, life, after: 0, rig: null, sparkAt: 0 };
  printJobs.push(job);
  b.printing = 1;
  lastPrint = b;
  bAttr.aState.array[b.idx * 3] = y0;
  bAttr.aState.needsUpdate = true;
  if (wantRig) {
    const r = freeRig();
    if (r) { r.job = job; job.rig = r; r.group.visible = true; }
    cuePrint(b);
  }
}
const RIG_AFTER = RIG_HOLD_SECONDS + RIG_DISSOLVE_SECONDS;
function stepPrints(dt) {
  if (printJobs.length || flashJobs.length) bAttr.aState.needsUpdate = true;
  for (let i = printJobs.length - 1; i >= 0; i--) {
    const j = printJobs[i];
    if (j.after > 0) {
      /* The print landed; only the lattice is still on screen. */
      j.after += dt;
      if (j.rig) placeRig(j.rig, j.b, 0.30, 1, j.after);
      if (j.after >= RIG_AFTER) {
        if (j.rig) { j.rig.group.visible = false; j.rig.job = null; }
        printJobs.splice(i, 1);
      }
      continue;
    }
    j.t += dt;
    const k = Math.min(1, j.t / j.life);
    const y = j.y0 + (j.y1 - j.y0) * k;
    bAttr.aState.array[j.b.idx * 3] = k >= 1 ? -1 : y;
    if (j.rig) placeRig(j.rig, j.b, y, k, 0);
    /* Sparks off the cutting edge — where the laser is actually touching the
       shell, not over the building in general. Rate-limited so a print is a
       shower of about twenty and not a fog. */
    if (k < 1 && j.t - j.sparkAt > 0.06) {
      j.sparkAt = j.t;
      const T = TYPES[j.b.type];
      for (let s = 0; s < 3; s++) {
        emit(j.b.wx + (Math.random() - 0.5) * T.w * 1.3, y,
             j.b.wz + (Math.random() - 0.5) * T.d * 1.3,
             (Math.random() - 0.5) * 1.6, 0.9 + Math.random() * 1.8, (Math.random() - 0.5) * 1.6,
             LASER, 0.045 + Math.random() * 0.04, 0.35 + Math.random() * 0.35, 0.2, -4.5);
      }
    }
    if (k >= 1) {
      j.b.printing = 0;
      startFlash(j.b);
      if (j.rig) j.after = 0.0001; else printJobs.splice(i, 1);
    }
  }
  stepFlash(dt);
}
/* Two laser lines riding the print plane, the emitters that fire them, the
   support lattice under it, the heat over it and the ground ring around it.
   `after` is 0 while the print runs and counts up once it has landed. */
/* The write worker standing over each building that is printing, so the rig can
   fire its lasers out of that craft's own arms rather than out of thin air.
   Written when a worker.edit arrives on station and cleared when it leaves or
   dies; placeRig() below is the only reader. */
const printerOver = new Map();
const _hp = new THREE.Vector3();

function placeRig(r, b, y, k, after) {
  const T = TYPES[b.type];
  const w = T.w * 1.5, d = T.d * 1.5;
  const top = 0.30 + b.wy;
  /* Thick enough to read from the wide shot, and never thinner than the 4.5 cm
     the close view was tuned on. */
  const thin = Math.max(0.045, laserWidth(b.wx, b.wz, 2.4));
  /* THE EMITTERS DESCEND. Over the first fifth of the print the two heads come
     down out of the hovering drone's altitude onto the roof line; after that
     they ride the plane down with the beams they are firing. */
  const drop = smoothstep01(0, 0.18, k);
  const headY = (top + 2.6) + (y + 0.55 - (top + 2.6)) * drop;
  /* The pair scissors across the footprint as the plane descends, so the print
     reads as being drawn rather than as a bar sliding down. */
  const off = d * 0.5 * Math.cos(k * Math.PI * 3.0);
  /* WHOSE ARMS THE LASERS COME OUT OF. A worker.edit carries two raked printer
     booms with an emitter on each tip, and while one is on station over this
     building the rig's heads ARE those tips — the print visibly comes out of the
     aircraft doing the writing. With no craft there (a seek's silent rebuild, a
     call still queued, `?drones=discs`) the pair falls back to the hovering
     positions the rig has always drawn. */
  const printer = printerOver.get(b);
  const arms = printer && printer.group.userData.emitters;
  for (let i = 0; i < 2; i++) {
    const sgn = i ? 1 : -1;
    const z = b.wz + sgn * off;
    r.lines[i].position.set(b.wx, y, z);
    r.lines[i].scale.set(w, 1, thin);
    if (arms && arms[i]) arms[i].getWorldPosition(_hp);
    else _hp.set(b.wx + sgn * w * 0.42, headY, z);
    r.heads[i].position.copy(_hp);
    r.heads[i].scale.set(0.14, 0.10, 0.14);
    /* The beam is a flat quad turned to face the lens, so it never edges out. */
    const bm = r.beams[i];
    bm.position.set(_hp.x, _hp.y - 0.05, _hp.z);
    bm.scale.set(thin * 1.6, Math.max(0.02, _hp.y - 0.05 - y), 1);
    bm.rotation.y = Math.atan2(camera.position.x - b.wx, camera.position.z - b.wz);
  }
  /* THE LATTICE. Four corner posts up to the printed line, plus four rails at a
     belt height that rises with it — struts, not a box, so it reads as
     scaffolding holding a shell up rather than as a crate around it. */
  const sh = Math.max(0.02, y - 0.30);
  const belt = 0.30 + sh * 0.55;
  for (let i = 0; i < 4; i++) {
    const px = b.wx + (i & 1 ? 1 : -1) * T.w * 0.5;
    const pz = b.wz + (i & 2 ? 1 : -1) * T.d * 0.5;
    r.struts[i].position.set(px, 0.30, pz);
    r.struts[i].scale.set(0.022, sh, 0.022);
    /* The four rails: two across x, two across z, each spanning one side. */
    const rail = r.struts[4 + i];
    const acrossX = i < 2;
    rail.position.set(acrossX ? b.wx : b.wx + (i & 1 ? 1 : -1) * T.w * 0.5,
                      belt,
                      acrossX ? b.wz + (i & 1 ? 1 : -1) * T.d * 0.5 : b.wz);
    rail.scale.set(acrossX ? T.w : 0.018, 0.018, acrossX ? 0.018 : T.d);
  }
  /* THE GROUND RING. Always on the ground, always the footprint's own size, and
     it pulses — the one mark that says "this lot is printing" from 80 units up. */
  r.ring.position.set(b.wx, 0.315, b.wz);
  const rs = Math.max(T.w, T.d) * (1.15 + 0.10 * Math.sin(now * 7));
  r.ring.scale.set(rs, 1, rs);
  /* HEAT. A wide, dim quad sitting just over the cutting line, breathing — a
     shimmer, not a second laser, which is why it has its own material. */
  r.haze.position.set(b.wx, y + 0.06, b.wz);
  r.haze.scale.set(w * 1.25, 1, d * 1.25);
  r.hazeMat.opacity = after > 0 ? 0 : 0.18 + 0.07 * Math.sin(now * 11);

  /* Full while it prints. The lattice then holds the finished shell for
     RIG_HOLD_SECONDS and dissolves UPWARD over RIG_DISSOLVE_SECONDS — the posts
     shorten from the top, so the ground lets go last. */
  if (after > 0) {
    const a = smoothstep01(RIG_HOLD_SECONDS, RIG_AFTER, after);
    for (const m of r.lines) m.visible = false;
    for (const m of r.heads) m.visible = false;
    for (const m of r.beams) m.visible = false;
    r.ring.visible = false;
    const full = Math.max(0.02, top - 0.30);
    for (let i = 0; i < 4; i++) r.struts[i].scale.y = full * (1 - a);
    for (let i = 4; i < 8; i++) r.struts[i].position.y = 0.30 + full * (1 - a);
    r.mat.opacity = 0.9 * (1 - a);
  } else {
    for (const m of r.lines) m.visible = true;
    for (const m of r.heads) m.visible = true;
    for (const m of r.beams) m.visible = true;
    r.ring.visible = true;
    r.mat.opacity = 0.9;
  }
}

/* --- THE FLASH -----------------------------------------------------------
   A finished facade is white-hot for a fifth of a second and cools into the
   warm palette over three. It rides aState.x below -1; see the FLASH block in
   the facade shader for why it is not its own attribute. */
const flashJobs = [];
function startFlash(b) {
  b.warm = 1;                                  // what it cools INTO
  for (const f of flashJobs) if (f.b === b) { f.t = 0; return; }
  flashJobs.push({ b, t: 0 });
}
/* Held at 1 through the hold, then an exponential decay — see FLASH_COOL_TAU.
   stepFlash() and printProbe() both call this so the probe reports the exact
   value the shader is fed, not a re-derived guess. */
function flashValue(t) {
  if (t <= FLASH_HOLD_SECONDS) return 1;
  return Math.exp(-(t - FLASH_HOLD_SECONDS) / FLASH_COOL_TAU);
}
function stepFlash(dt) {
  for (let i = flashJobs.length - 1; i >= 0; i--) {
    const f = flashJobs[i];
    f.t += dt;
    if (f.b.gone || f.b.printing) { flashJobs.splice(i, 1); continue; }
    const v = flashValue(f.t);
    bAttr.aState.array[f.b.idx * 3] = v <= 0.002 ? -1 : -1 - v;
    if (v <= 0.002) flashJobs.splice(i, 1);
  }
}

/* --- DEREZ ----------------------------------------------------------------
   Something stops existing: it comes apart into red voxels that fall and go
   out. Never a fade — a fade says the renderer stopped drawing it, and this
   has to say the construct's time was up. */
function derezBurst(x, y, z, sx, sy, sz, n) {
  for (let i = 0; i < n; i++) {
    emit(x + (Math.random() - 0.5) * sx * 1.6,
         y + Math.random() * Math.max(0.3, sy),
         z + (Math.random() - 0.5) * sz * 1.6,
         (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2,
         LASER, 0.10 + Math.random() * 0.07, 0.8 + Math.random() * 0.7, 0.5, -5.2, 1);
  }
}

function shellBurst(x, z) {
  emit(x, 0.5, z, 0, 0, 0, GOLD, 0.9, 0.22, 0.001, 0);        // the flash itself
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 1.1;
    emit(x, 0.35, z, Math.cos(a) * s, 1.1 + Math.random() * 1.3, Math.sin(a) * s,
         BONE, 0.2 + Math.random() * 0.2, 1.1 + Math.random() * 0.7, 0.04, 0.5);
  }
}
/* A cool bar that sweeps the facade from the parapet down to the street. */
function scanBeam(b) {
  const m = freeOf(scanPool);
  if (!m) return;
  const T = TYPES[b.type];
  m.visible = true;
  m.userData.t = 0; m.userData.life = 0.95;
  m.userData.h = b.wy; m.userData.y0 = 0.30;
  m.scale.set(Math.max(T.w, T.d) * 2.3, 0.16, 1);
  m.position.set(b.wx, 0.30 + b.wy, b.wz);
  m.material.opacity = 0.85;
}
/* A wide search-light that sweeps the whole district, because Grep and Glob do
   not look at one file — they look at a folder. */
function searchCone(d, plate) {
  const m = freeOf(conePool);
  if (!m || !plate) return;
  const [x, z] = worldOrigin(plate);
  const r = Math.max(plate.w, plate.h) * 0.5 + 0.6;
  m.visible = true;
  m.userData.t = 0; m.userData.life = 1.5; m.userData.plate = plate;
  m.userData.cx = x + plate.w / 2; m.userData.cz = z + plate.h / 2; m.userData.r = r;
  m.userData.drone = d;
  m.material.opacity = 0.0;
}
function addBeacon(b) {
  if (beaconCount >= MAX_BEACONS) return;
  b.beacon = true; b.beaconIdx = beaconCount++;
  beaconPhase.array[b.beaconIdx] = hash01(b.rel + 'b') * 6.28;
  beaconPhase.needsUpdate = true;
  moveBeacon(b);
  beacons.geometry.setDrawRange(0, beaconCount);
}
function moveBeacon(b) {
  if (b.beaconIdx === undefined) return;
  beaconPos.array[b.beaconIdx * 3] = b.wx;
  beaconPos.array[b.beaconIdx * 3 + 1] = 0.30 + b.wy + 0.14;
  beaconPos.array[b.beaconIdx * 3 + 2] = b.wz;
  beaconPos.needsUpdate = true;
}

function logBurst(plate) {
  if (!plate) return;
  burstLog.push({ t: now, plate });
  if (burstLog.length > 200) burstLog.shift();
}


/* =============================================================================
   CAMERA — cinematic and automatic, with the brief's numbers
   Slow orbit, 25-35 degrees up, one turn every 90 s, FOV 35, the whole city in
   frame with a 10% margin, easing out to a district when that district gets busy.
   ========================================================================== */
/* Scratch objects. This runs once per frame over every building, so allocating
   a Vector3 in here would be 600 short-lived objects a frame and a visible GC
   sawtooth on the integrated GPU. */
const _box = new THREE.Box3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _want = new THREE.Vector3();

function cityBounds() {
  if (!bCount) return null;
  _box.makeEmpty();
  for (const b of files.values()) {
    _box.expandByPoint(_p.set(b.wx - 0.6, 0, b.wz - 0.6));
    _box.expandByPoint(_p.set(b.wx + 0.6, b.wy + 0.4, b.wz + 0.6));
  }
  /* The drones' ALTITUDE is part of the frame: the orchestrator hovers above
     every tower and cropping it is the one thing here that would look broken.
     Where they are on the GROUND is not. They follow the work, they move every
     frame, and one craft that had flown out to an outlying annex used to drag
     this box half a city wide — which is how the city itself ended up framed at
     43% of the picture while the fit believed it had filled it. Keeping the
     horizontal extent the city's own is what lets FRAME_FILL mean what it says. */
  _box.getCenter(_c);
  for (const d of drones.values()) {
    if (d.scale > 0.2) _box.expandByPoint(_p.set(_c.x, d.pos.y, _c.z));
  }
  return _box;
}

/* How far back the camera has to stand for the city to own the frame.

   Two things make this less obvious than it looks. The aim is LIFTED — lookAt()
   points at target + AIM_LIFT*d, not at the target — so the camera basis is
   tilted by an angle that depends on the very distance being solved for. And the
   width of a box on screen is set by a PAIR of corners at different depths, and
   which pair that is changes as the city orbits. A per-corner closed form gets
   both of those wrong: the one that was here stood roughly 35% too far back and
   its answer swung 20% with the orbit angle, which is how the city ended up
   spanning 43% of a 1440-wide frame with a third of the picture empty ground.

   So this projects the eight corners for a candidate distance and bisects on the
   real answer. Twenty-two steps of eight corners, once a frame, is about fifteen
   hundred float operations — under a thousandth of the frame budget, and it hits
   FRAME_FILL and FRAME_HEAD exactly instead of approximately. */
const _fx = new THREE.Vector3(), _fy = new THREE.Vector3(), _fz = new THREE.Vector3();
const _corner = new THREE.Vector3();
const _screen = { span: 0, top: 0 };

/* The box's horizontal span and its highest point, in normalised device
   coordinates (-1..1 across the frame), as seen from `d` away. */
function boxOnScreen(view, d, hx, sizeY, hz, baseY) {
  const cp = Math.cos(view.theta), sp = Math.sin(view.theta);
  const cph = Math.cos(view.phi), sph = Math.sin(view.phi);
  _fz.set(cp * cph, sph, sp * cph);            // target -> eye
  _fx.set(sp, 0, -cp);                         // screen right; the tilt leaves it alone
  _fy.crossVectors(_fz, _fx).normalize();      // screen up, before the aim is lifted
  const tanV = Math.tan(view.fov * Math.PI / 360), tanH = tanV * view.aspect;
  const lift = view.lift;
  const k = Math.sqrt(1 - 2 * lift * sph + lift * lift);   // the tilt's foreshortening
  const B = 1 - lift * sph;
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    /* The box stands on its own floor and the aim sits partway up it; baseY is
       how far up. Measuring from the floor instead pretends the whole city is
       above the lens. */
    _corner.set((i & 1 ? hx : -hx), (i & 2 ? sizeY : 0) - baseY, (i & 4 ? hz : -hz));
    const D = d * B + lift * _corner.y - _corner.dot(_fz);   // depth, times k
    if (D <= 0.05) { _screen.span = 99; _screen.top = 99; return _screen; }  // behind the lens
    const nx = k * _corner.dot(_fx) / (tanH * D);
    const ny = (_corner.dot(_fy) + lift * (_corner.x * cp + _corner.z * sp)
                - d * lift * cph) / (tanV * D);
    if (nx < x0) x0 = nx;
    if (nx > x1) x1 = nx;
    if (ny > y1) y1 = ny;
  }
  _screen.span = x1 - x0;
  _screen.top = y1;
  return _screen;
}

export function fitDistance(view, sizeX, sizeY, sizeZ, baseY) {
  const hx = sizeX / 2, hz = sizeZ / 2;
  const maxSpan = 2 * view.fill;               // NDC runs -1..1, so the frame is 2 wide
  const maxTop = 1 - 2 * view.head;
  /* Only the TOP is held in. The near ground running off the bottom edge is what
     a low camera standing close to a city looks like; holding the bottom in as
     well is exactly what kept the whole thing on a table in mid-frame. */
  const fits = d => {
    boxOnScreen(view, d, hx, sizeY, hz, baseY);
    return _screen.span <= maxSpan && _screen.top <= maxTop;
  };
  let hi = 6;
  while (!fits(hi) && hi < 600) hi *= 1.5;
  let lo = 3;
  for (let i = 0; i < 22; i++) {
    const m = (lo + hi) / 2;
    if (fits(m)) hi = m; else lo = m;
  }
  return hi;
}

/* The lens, as fitDistance() wants it. One object, rewritten in place each call
   so the solve never allocates. */
const _cityView = { theta: 0, phi: 0, fov: 35, aspect: 1, lift: AIM_LIFT,
                    fill: FRAME_FILL, head: FRAME_HEAD };
function cityView() {
  _cityView.theta = cam.theta; _cityView.phi = cam.phi;
  _cityView.fov = camera.fov; _cityView.aspect = camera.aspect;
  return _cityView;
}

function fitCamera(snap) {
  const box = cityBounds();
  if (!box) return;
  box.getCenter(_c);
  box.getSize(_s);
  cam.targetWant.set(_c.x, Math.max(0.9, _s.y * 0.42), _c.z);
  cam.distWant = fitDistance(cityView(), _s.x, _s.y, _s.z, cam.targetWant.y - box.min.y);
  if (snap) { cam.target.copy(cam.targetWant); cam.dist = cam.distWant; }
}

/* How much close-up the camera may spend, and how it is accounted.
   `tool_end` doubled the event density and the old rule (5 events in 3 s) fired
   on almost every district: at 240 s the shot was a close-up sitting at 133% of
   the frame width. Two changes, both measured on data/demo.json:
     - only `tool` events reach burstLog at all (tool_end never calls logBurst),
       and the bar is 8 in 3 s rather than 5;
     - a hard budget on top of the cooldown. Every close-up granted is written
       into focusSpent with its length; a new one is refused unless the last two
       minutes would still be at least 60% wide shot. That is the guarantee the
       cooldown alone could only approximate. */
const BURST_EVENTS = 8;          // `tool` events in one district, inside 3 s
const FOCUS_SECONDS = 8;
const FOCUS_WINDOW = 120;        // the 2-minute window the 60% is measured over
const FOCUS_BUDGET = FOCUS_WINDOW * 0.40;
const focusSpent = [];           // { t, dur } of every close-up granted

/* The street-by-street intro. A project replay can span weeks, so when the
   replay reaches a session it has not shown yet, the camera eases to that
   avenue for a beat and the sign lights — then the wide shot comes back on its
   own, because focusUntil is what updateCamera() is already watching. It is
   charged to the same FOCUS_BUDGET as a burst close-up rather than being free:
   a project with a hundred short sessions must not become a slideshow. */
/* THE PRINT CUE. A materialisation is the one thing this city exists to show,
   so when one starts from the wide shot the lens eases to a three-quarter view
   of that lot and holds it for the print plus a second. Two guards, both of
   them the ones that already govern every other close-up:
     - it never interrupts a shot that is already close (a burst, a street
       intro, the interior, free fly);
     - it is charged to the SAME FOCUS_BUDGET, so close-ups still cannot exceed
       40% of any two-minute window. Budget spent -> no cue, and the building
       still prints. The 12 s cooldown is that budget written as a rate: a cue
       is ~4.5 s and the budget allows ten of them per two minutes.
   Multiple prints at once are framed as a GROUP: the target is recomputed every
   frame from the union of every lot currently printing, so a district
   materialising three files at once is one shot of three, not three shots. */
const PRINT_CUE_COOLDOWN = 12;
const CUE_TAIL_SECONDS = 1;
function cuePrint(b) {
  if (Interior.busy() || free.on) return;
  if (now < cam.focusUntil || now < cam.printCueUntil) return;
  const dur = printSecondsFor(b) + CUE_TAIL_SECONDS;
  while (focusSpent.length && focusSpent[0].t < now - FOCUS_WINDOW) focusSpent.shift();
  let spent = 0;
  for (const f of focusSpent) spent += f.dur;
  if (spent + dur > FOCUS_BUDGET) return;      // budget spent: no cue, still prints
  cam.focusPlate = printLot;
  cam.focusUntil = now + dur;
  cam.printCueUntil = now + dur + PRINT_CUE_COOLDOWN;
  focusSpent.push({ t: now, dur });
}
/* The lot the cue aims at. One object, rewritten each frame — see framePrintLot(). */
const printLot = { isLot: true, wx: 0, wz: 0, w: 1, d: 1, h: 1 };
function framePrintLot() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 1;
  for (const j of printJobs) {
    const b = j.b, T = TYPES[b.type];
    x0 = Math.min(x0, b.wx - T.w); x1 = Math.max(x1, b.wx + T.w);
    z0 = Math.min(z0, b.wz - T.d); z1 = Math.max(z1, b.wz + T.d);
    top = Math.max(top, b.wy);
  }
  if (x0 === Infinity) return;                 // nothing printing: hold the last frame
  printLot.wx = (x0 + x1) / 2; printLot.wz = (z0 + z1) / 2;
  printLot.w = x1 - x0; printLot.d = z1 - z0; printLot.h = top;
}

export function focusStreet(id, seconds) {
  const s = streets.get(id);
  if (!s) return false;
  const dur = seconds || 3;
  cam.focusPlate = s;
  cam.focusUntil = now + dur;
  cam.focusCooldown = now + dur + 6;
  focusSpent.push({ t: now, dur });
  return true;
}

/* =============================================================================
   FREE FLY — the lens off the string
   The orbit always looks at the city's own solved centre and always stands the
   fitted distance back, so there are corners of a twelve-avenue town it simply
   cannot be put in. `F` cuts the string: no orbit, no zoom clamp, and no
   per-frame re-fit. cam.* is untouched the whole time, so `F` again eases back
   onto the exact shot that was left.
   ========================================================================== */
const free = {
  on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0,
  back: 0, backPos: new THREE.Vector3(), backQuat: new THREE.Quaternion(),
};
const freeKeys = new Set();
const FREE_BASE = 22;      // units/s at street level, before the altitude term
const FREE_MIN = 0.3;      // units/s floor — slow, never stuck
const FREE_EASE = 0.7;     // seconds to blend back onto the orbit
const FREE_EYE = 1.7;      // how far the lens stays over the ground plane
const _fFwd = new THREE.Vector3(), _fRight = new THREE.Vector3();
const _oPos = new THREE.Vector3(), _oQuat = new THREE.Quaternion();

function toggleFreeFly() {
  if (Interior.busy()) return;
  const hud = document.getElementById('free-hud');
  if (!free.on) {
    free.pos.copy(camera.position);
    /* Read off the direction the lens already points: camera.rotation is in the
       renderer's XYZ order, which is not the YXZ a flyer's two angles compose
       in, so the angles come out of the vector instead. */
    camera.getWorldDirection(_fFwd);
    free.yaw = Math.atan2(-_fFwd.x, -_fFwd.z);
    free.pitch = Math.asin(Math.max(-1, Math.min(1, _fFwd.y)));
    free.on = true; free.back = 0;
  } else {
    free.backPos.copy(camera.position);
    free.backQuat.copy(camera.quaternion);
    free.on = false; free.back = 1;
    freeKeys.clear();
  }
  if (hud) hud.hidden = !free.on;
}

/* WASD + Q/E in the direction the lens looks. The step scales with height over
   the ground — fast above the skyline, slow enough at a doorway to stop at it —
   and never falls under FREE_MIN, because a camera that cannot move is broken
   rather than careful. The ground is the only thing it collides with; flying
   through a tower is deliberate, since bouncing off every roof makes the mode
   useless for exactly the corners it exists to reach. */
function updateFreeFly(dt) {
  const alt = Math.max(0, free.pos.y);
  const step = Math.max(FREE_MIN, FREE_BASE * (0.12 + alt / 70)) *
               (freeKeys.has('shift') ? 4 : 1) * dt;

  camera.rotation.order = 'YXZ';
  camera.rotation.set(free.pitch, free.yaw, 0);
  camera.getWorldDirection(_fFwd);
  _fRight.set(_fFwd.z, 0, -_fFwd.x);
  if (_fRight.lengthSq() < 1e-6) _fRight.set(1, 0, 0);
  _fRight.normalize();

  if (freeKeys.has('w')) free.pos.addScaledVector(_fFwd, step);
  if (freeKeys.has('s')) free.pos.addScaledVector(_fFwd, -step);
  if (freeKeys.has('d')) free.pos.addScaledVector(_fRight, step);
  if (freeKeys.has('a')) free.pos.addScaledVector(_fRight, -step);
  if (freeKeys.has('e')) free.pos.y += step;
  if (freeKeys.has('q')) free.pos.y -= step;
  if (free.pos.y < FREE_EYE) free.pos.y = FREE_EYE;   // the ground plane, and nothing else

  camera.position.copy(free.pos);
}

function updateCamera(dt) {
  /* The interior has the lens: it is flying in or out through the facade, and
     cam.* is deliberately left exactly where it was so that landing back
     outside is the same shot the viewer left rather than a re-fit of it. */
  if (camOverride) {
    camera.position.copy(camOverride.pos);
    camera.lookAt(camOverride.look);
    return;
  }
  if (free.on) { updateFreeFly(dt); return; }
  if (now > cam.focusUntil) {
    const cut = now - 3;
    while (burstLog.length && burstLog[0].t < cut) burstLog.shift();
    while (focusSpent.length && focusSpent[0].t < now - FOCUS_WINDOW) focusSpent.shift();
    /* The cooldown is not in the brief and is the difference between a camera
       with an opinion and one that never lets go: this session fires four events
       a second, so without it the wide shot — the shot the whole city is for —
       would essentially never be on screen. */
    if (now > cam.focusCooldown) {
      let spent = 0;
      for (const f of focusSpent) spent += f.dur;
      if (spent + FOCUS_SECONDS <= FOCUS_BUDGET) {
        const counts = new Map();
        for (const e of burstLog) counts.set(e.plate, (counts.get(e.plate) || 0) + 1);
        for (const [plate, n] of counts) {
          if (n >= BURST_EVENTS && plate !== cam.focusPlate) {
            cam.focusPlate = plate; cam.focusUntil = now + FOCUS_SECONDS;
            cam.focusCooldown = now + 33;
            focusSpent.push({ t: now, dur: FOCUS_SECONDS });
            break;
          }
        }
      }
    }
    if (now > cam.focusUntil) cam.focusPlate = null;
  }

  fitCamera(false);
  _want.copy(cam.targetWant);
  let wantDist = cam.distWant, wantPhi = WIDE_PHI;   // low and three-quarter, not a map
  if (cam.focusPlate && cam.focusPlate.isLot && now < cam.focusUntil) {
    /* THE PRINT CUE's shot. A lot is not a plate — it has no parent to walk and
       no children — so it is framed straight off its own box, re-solved every
       frame from whatever is printing right now (see framePrintLot). The aim
       sits at half the building's height, which is where the laser is for most
       of the print, and the fit keeps a couple of metres of ground around it so
       the drone and the lattice are both in shot. */
    framePrintLot();
    const p = cam.focusPlate;
    _want.set(p.wx, Math.max(1.2, p.h * 0.5), p.wz);
    wantDist = Math.max(9, fitDistance(cityView(), p.w + 5, p.h + 3.4, p.d + 5, _want.y));
    wantPhi = 0.47;                     // 27 degrees: the same three-quarter view
  } else if (cam.focusPlate && now < cam.focusUntil) {
    const p = cam.focusPlate;
    const [x, z] = worldOrigin(p);
    /* An avenue is framed at its ENTRANCE, not at its middle: that is where
       the sign stands, and a 150-unit street fitted end to end is just the
       wide shot again with extra steps. */
    /* An avenue is framed at its first stretch, not end to end and not at one
       block: 16 units put the lens on empty carriageway the moment the street
       was new, and the whole length is the wide shot again. 30 shows the sign,
       the docked craft and the first blocks together. */
    const win = p.isStreet ? Math.min(p.w, 30) : p.w;
    _want.set(x + win / 2, 1.6, z + p.h / 2);
    /* Pulled part of the way back to the town's own centre. Aimed squarely at a
       brand-new avenue the shot is two thirds bare ground with the city shoved
       into a corner; this keeps the new street the subject and the town it
       belongs to in the frame around it. */
    if (p.isStreet) _want.lerp(cam.targetWant, 0.4);
    /* Never closer than the tallest thing it might fly past: at 6 units the
       camera ends up standing inside a tower with a wall filling the frame. */
    /* Never closer than the tallest thing it might fly past: at 6 units the
       camera ends up standing inside a tower with a wall filling the frame.
       A STREET intro is not a close-up at all, and that is the point: an avenue
       is introduced the moment its session starts, when it is still empty
       ground, so a close-up of it is a close-up of nothing. Fitting the street
       alone put two thirds of the frame on bare kerb. The camera keeps most of
       its distance and only swings the aim onto the new avenue, so the town it
       belongs to stays in shot behind it. */
    /* A STREET intro swings the aim onto the new avenue, which leaves the town's
       own box OFF-CENTRE in the shot — and a distance solved for a centred box
       no longer holds it. `* 0.78` was the guess that stood here, and it is what
       put the first thirty seconds of a two-street town at 133-243 % of the
       frame width against its own 80-88 band. Re-centring the union of EVERY
       street's buildings on the aim (half-extents measured from the target, not
       from the box's middle) and solving that is the same fit the wide shot
       uses, answered for the shot that is actually on screen. */
    if (p.isStreet) {
      const b = cityBounds();
      wantDist = b
        ? fitDistance(cityView(),
                      Math.max(b.max.x - _want.x, _want.x - b.min.x) * 2, b.max.y - b.min.y,
                      Math.max(b.max.z - _want.z, _want.z - b.min.z) * 2, _want.y - b.min.y)
        : Math.max(30, cam.distWant);
    } else {
      wantDist = Math.max(17, fitDistance(cityView(), win + 6, 6, p.h + 6, 1.6));
    }
    wantPhi = 0.47;                     // 27 degrees: a three-quarter view, not a map
  }
  wantDist *= (cam.zoom || 1);          // the wheel scales whatever the fit chose
  wantDist = Math.max(CAM_NEAR, wantDist);
  /* The aim point is lifted to 42% of the city's own height, which is right for
     the wide shot and is also why a fully zoomed-in orbit used to stop at a
     third-floor window: the lens sits above an aim that is already up there.
     Capping the lift by the distance leaves every wide shot untouched (the cap
     is far above the lift at any real fitted distance) and lets a close orbit
     come down to eye level. */
  _want.y = Math.min(_want.y, wantDist * 0.25 + 0.6);

  /* Whatever the fit chose, plus wherever the viewer dragged it. The pan is what
     makes a corner of a twelve-avenue town reachable without leaving the orbit —
     an orbit alone can only ever circle the one point the fit solved. */
  const wantTarget = _want.add(cam.pan);

  const k = Math.min(1, dt * 1.4);
  cam.target.lerp(wantTarget, k);
  cam.dist += (wantDist - cam.dist) * k;
  cam.phi += (wantPhi - cam.phi) * Math.min(1, dt * 0.8);

  if (cam.auto && !cam.fixed && now > cam.autoPauseUntil) cam.theta += ORBIT_RATE * dt;

  const r = cam.dist * Math.cos(cam.phi);
  camera.position.set(
    cam.target.x + Math.cos(cam.theta) * r,
    cam.target.y + cam.dist * Math.sin(cam.phi),
    cam.target.z + Math.sin(cam.theta) * r);
  /* Aim ABOVE the city, not at it. At 27 degrees of elevation with a 35 mm field
     the top of the frame is still pointing at the ground, so a camera that looks
     straight at the centre has no sky in it at all and the city floats in a void.
     Lifting the aim pushes the skyline into the lower two thirds and lets the
     dusk band occupy the top — which is the whole difference between a diorama
     and a photograph of a city. */
  /* Two units over the ground plane and no lower: that is what "down to eye
     level" means here, and it is the floor the zoom range is stated against. */
  if (camera.position.y < CAM_FLOOR) camera.position.y = CAM_FLOOR;
  camera.lookAt(cam.target.x, cam.target.y + cam.dist * AIM_LIFT, cam.target.z);

  /* Leaving free fly EASES back onto the orbit rather than cutting to it: the
     orbit pose is solved first, then the pose the flyer was left in is mixed out
     of it. A cut here reads as a bug even when it is not. */
  if (free.back > 0) {
    free.back = Math.max(0, free.back - dt / FREE_EASE);
    const e = free.back * free.back * (3 - 2 * free.back);      // smoothstep
    _oPos.copy(camera.position); _oQuat.copy(camera.quaternion);
    camera.position.lerpVectors(_oPos, free.backPos, e);
    camera.quaternion.slerpQuaternions(_oQuat, free.backQuat, e);
  }
}

/* Drag orbits and pauses the automatic orbit for 20 s; the wheel zooms inside
   limits so the city can never be lost off screen. */
const _pan = new THREE.Vector3(), _panR = new THREE.Vector3();

function attachPointer(canvas) {
  let down = false, lx = 0, ly = 0, panning = false;
  canvas.style.touchAction = 'none';

  /* Two fingers on the canvas is a pinch (zoom) and a twist (rotate), tracked
     independently of the one-finger orbit/pan above — TOUCHES holds every
     touch pointer currently down, and its size alone decides which gesture
     runs. One-finger touch falls straight through the existing orbit code
     below, unchanged, because a touch pointerdown/move/up carries the same
     clientX/Y a mouse one does. */
  const TOUCHES = new Map();           // pointerId -> { x, y }, touch only
  let pinchDist = 0, pinchAngle = 0;
  const pinchState = () => {
    const [a, b] = [...TOUCHES.values()];
    const dx = b.x - a.x, dy = b.y - a.y;
    return { dist: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) };
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') {
      TOUCHES.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (TOUCHES.size === 2) {
        down = false; panning = false;          // the pinch owns the gesture now
        ({ dist: pinchDist, angle: pinchAngle } = pinchState());
        return;
      }
      if (TOUCHES.size > 2) return;             // a third finger changes nothing
    }
    down = true; lx = e.clientX; ly = e.clientY;
    /* Right or middle drag pans, left drag orbits. */
    panning = (e.button === 2 || e.button === 1);
    /* A real touch pointer always has one; a synthetic PointerEvent (a test
       harness dispatching its own, with no genuine pointer behind it) does
       not, and throws NotFoundError here — which used to abort the rest of
       this handler and the orbit with it. */
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    /* Free fly asks for the pointer once, on a real click — the only gesture a
       browser grants it on. A refusal is not fatal: the drag branch below turns
       the same movement into the same look, which is also the path a screenshot
       harness takes, since CDP has no gesture Chrome will accept. */
    if (free.on && document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  });
  /* Without this the right-drag pan ends by opening the context menu. */
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' && TOUCHES.has(e.pointerId)) {
      TOUCHES.set(e.pointerId, { x: e.clientX, y: e.clientY });
      /* Two fingers or more: the pinch owns the gesture, and this returns
         without touching the orbit/pan code below. One finger falls straight
         through to it, same as it always did. */
      if (TOUCHES.size >= 2) {
        if (!free.on) {
          const { dist, angle } = pinchState();
          /* A ratio of distances, the same way the wheel scales a ratio of
             deltaY — a slow pinch and a fast one land on the same zoom for the
             same finger spread, not on however many move events fired. */
          if (pinchDist > 1) cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
            (cam.zoom || 1) * (pinchDist / dist)));
          /* Twist rotates the orbit exactly like a one-finger drag does — the
             same cam.theta, moved by the change in the two fingers' angle. */
          cam.theta -= (angle - pinchAngle);
          pinchDist = dist; pinchAngle = angle;
          cam.autoPauseUntil = now + 20;
        }
        return;
      }
    }
    if (free.on) {
      const locked = document.pointerLockElement === canvas;
      const dx = locked ? e.movementX : (down ? e.clientX - lx : 0);
      const dy = locked ? e.movementY : (down ? e.clientY - ly : 0);
      if (dx || dy) {
        free.yaw -= dx * 0.0026;
        free.pitch = Math.max(-1.45, Math.min(1.45, free.pitch - dy * 0.0026));
      }
      lx = e.clientX; ly = e.clientY;
      return;
    }
    if (!down) return;
    if (panning) {
      /* One screen pixel is worth more ground the further back the lens stands,
         which is what keeps the gesture feeling like dragging the city itself at
         every zoom. */
      const k = cam.dist * 0.0016;
      _pan.set(-Math.cos(cam.theta), 0, -Math.sin(cam.theta));   // into the screen
      _panR.set(-_pan.z, 0, _pan.x);                             // screen right
      cam.pan.addScaledVector(_panR, -(e.clientX - lx) * k)
             .addScaledVector(_pan, -(e.clientY - ly) * k);
    } else {
      cam.theta -= (e.clientX - lx) * 0.006;
      cam.phi = Math.max(0.16, Math.min(1.15, cam.phi + (e.clientY - ly) * 0.004));
    }
    lx = e.clientX; ly = e.clientY;
    cam.autoPauseUntil = now + 20;
  });
  const up = e => { down = false; panning = false; if (e && e.pointerType === 'touch') TOUCHES.delete(e.pointerId); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (free.on) return;                 // free fly has no zoom, it has W
    /* 0.22 a notch, not 0.11: the range is now the whole city down to eye level,
       and at 11% the bottom of it is forty turns away. Scaled by the event's own
       deltaY rather than its sign, so a mouse notch (120) is one full step and a
       trackpad's stream of small deltas stays proportional. */
    const t = Math.sign(e.deltaY) * Math.max(0.08, Math.min(1, Math.abs(e.deltaY) / 120));
    cam.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (cam.zoom || 1) * (1 + t * 0.22)));
    cam.autoPauseUntil = now + 20;
  }, { passive: false });
}


/* =============================================================================
   PICKING — the way in
   The owner's rule this exists for: "if I want to enter a building I can really
   see what happens there." Three things in this city can be entered, and each
   is picked the way it is drawn: a building is one instance of the facade mesh,
   a district is its plate caption, a session is its street sign.

   Hover puts a thin gold rim on the box and its name under the cursor. The
   FIRST click selects — the rim stays without the pointer — and the second
   click, or Enter, walks in. Two clicks rather than one because this camera
   orbits under the pointer the whole time, and a single click would send a
   viewer inside a tower every time he tried to drag the city round.
   ========================================================================== */
const byIdx = [];                 // instance index -> building record
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
let hover = null;                 // { kind, rec } under the pointer
let picked = null;                // { kind, rec } armed by the first click
let openB = null;                 // the building whose facade is dissolving
let captionEl = null;

const pickCaption = () => captionEl || (captionEl = document.getElementById('pick-caption'));
const samePick = (a, b) => !!(a && b && a.kind === b.kind && a.rec === b.rec);

function setHover(hit, x, y) {
  if (!samePick(hit, hover)) {
    if (hover && hover.kind === 'file' && !samePick(hover, picked)) setRim(hover.rec, 0);
    hover = hit;
    if (hover && hover.kind === 'file') setRim(hover.rec, 1);
  }
  const el = pickCaption();
  if (!el) return;
  const show = hover || picked;
  if (!show) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = captionFor(show);
  /* Follows the pointer rather than the target: the target is a world-space box
     that the camera is orbiting, and a caption chasing its projection wobbles. */
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  el.classList.toggle('armed', samePick(show, picked));
}

function captionFor(h) {
  if (h.kind === 'file')  return h.rec.rel + '  ·  ' + h.rec.floors + ' floors';
  if (h.kind === 'plate') return h.rec.name + '/  ·  district';
  return h.rec.name + '  ·  session';
}

/* The gold rim is one float on the instanced buffer, so hovering a building
   costs one buffer sub-upload and no extra draw. */
function setRim(b, v) {
  if (!b || b.idx === undefined) return;
  bAttr.aState.array[b.idx * 3 + 1] = v;
  bAttr.aState.needsUpdate = true;
}

/* The facade coming apart while the camera flies through it. Same idea: one
   float, no extra geometry, and the shader's dither does the rest. */
function setBuildingOpen(b, v) {
  if (!b || b.idx === undefined) return;
  openB = v > 0 ? b : null;
  bAttr.aState.array[b.idx * 3 + 2] = v;
  bAttr.aState.needsUpdate = true;
}

function clearPick() {
  if (hover && hover.kind === 'file') setRim(hover.rec, 0);
  if (picked && picked.kind === 'file') setRim(picked.rec, 0);
  if (openB) setBuildingOpen(openB, 0);
  hover = picked = null;
  const el = pickCaption();
  if (el) el.hidden = true;
}

/* What is under (x, y) in client pixels. Buildings first: a sign or a caption
   is a sprite that always faces the camera, so it wins every tie against the
   box it stands in front of, and the city would become unclickable. */
function pickAt(x, y) {
  const r = renderer.domElement.getBoundingClientRect();
  _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);

  const hits = _ray.intersectObject(buildings, false);
  for (const h of hits) {
    const b = byIdx[h.instanceId];
    if (b && !b.gone) return { kind: 'file', rec: b };
  }
  const caps = _ray.intersectObjects(labelGroup.children, false);
  for (const h of caps) {
    const u = h.object.userData;
    if (u.street) return { kind: 'street', rec: u.street };
    if (u.plate)  return { kind: 'plate',  rec: u.plate };
  }
  return null;
}

function enterPicked() {
  if (!picked || Interior.busy()) return;
  if (picked.kind === 'file')   Interior.enterBuilding(picked.rec);
  if (picked.kind === 'plate')  Interior.enterPlate(picked.rec);
  if (picked.kind === 'street') Interior.enterStreet(picked.rec);
  const el = pickCaption();
  if (el) el.hidden = true;
}

/* =============================================================================
   THE BUTTONS — what enter and exit MEAN in a city
   controls.js owns the cluster; this owns the two verbs, and each calls the
   function the KEY already called. There is no search button here: this page
   has no address search to open, and controls.js hides the button when a page
   passes none rather than this file building a second one.
   ========================================================================== */
function attachControls() {
  /* `picked || hover` is exactly what the Enter key reads, so the button and
     the key can never disagree about what is in the crosshair. */
  const aim = () => (Interior.busy() ? null : (picked || hover));
  Controls.install({
    /* A building is named by its file, a district and a street by their own
       name — the same three cases captionFor() splits on. */
    target: () => {
      const h = aim();
      if (!h) return null;
      return h.kind === 'file' ? h.rec.rel : h.rec.name;
    },
    enter: () => {
      const h = aim();
      if (!h) return;
      picked = h;
      if (h.kind === 'file') setRim(h.rec, 1);
      enterPicked();
    },
    /* Inside a building Escape leaves the room; outside, the level above a
       project's city is the planet it stands on. */
    exitLabel: () => Interior.busy() ? 'leave' : picked ? 'clear' : 'globe',
    exit: () => {
      if (Interior.busy()) { Interior.leave(); return; }
      if (picked) { clearPick(); return; }
      /* Controls.href keeps `wallpaper=1` on the way back to the planet: a bare
         'globe.html' lands the desktop on a globe whose button cluster falls
         below the taskbar and cannot be clicked again (controls.js
         CONTROLS-WALLPAPER). */
      location.href = Controls.href('globe.html');
    },
    search: null,
  });
}

function attachPicker(canvas) {
  let downAt = null;
  /* Touch has no hover, so a long press stands in for it: hold still on a
     building for LONG_PRESS_MS and its caption appears exactly as a mouse
     hover would, without arming it — lifting the finger afterwards is a peek,
     not a select. */
  const LONG_PRESS_MS = 500;
  let longPressTimer = 0, longPressFired = false;
  canvas.addEventListener('pointerdown', e => {
    downAt = { x: e.clientX, y: e.clientY };
    clearTimeout(longPressTimer);
    longPressFired = false;
    if (e.pointerType === 'touch') {
      longPressTimer = setTimeout(() => {
        if (Interior.busy()) return;
        const hit = pickAt(e.clientX, e.clientY);
        if (hit) { longPressFired = true; setHover(hit, e.clientX + 16, e.clientY + 16); }
      }, LONG_PRESS_MS);
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (Interior.busy()) return;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) clearTimeout(longPressTimer);
    setHover(pickAt(e.clientX, e.clientY), e.clientX + 16, e.clientY + 16);
  });
  canvas.addEventListener('pointerup', e => {
    clearTimeout(longPressTimer);
    if (Interior.busy()) return;
    /* The long press already showed its caption; lifting the finger is the
       peek ending, not a tap — let it fade rather than arming or entering
       whatever is underneath. */
    if (longPressFired) {
      longPressFired = false;
      setTimeout(() => { const el = pickCaption(); if (el && !picked) el.hidden = true; }, 1200);
      return;
    }
    /* A drag is an orbit, not a click. Four pixels is the slop a trackpad
       needs; without it every orbit ended by arming something. */
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) { clearPick(); return; }
    if (samePick(picked, hit)) { enterPicked(); return; }
    if (picked && picked.kind === 'file') setRim(picked.rec, 0);
    picked = hit;
    if (picked.kind === 'file') setRim(picked.rec, 1);
    setHover(hit, e.clientX + 16, e.clientY + 16);
  });
  /* One double-click goes straight in — no arming step. The two-click path is
     still there and unchanged; this is the gesture for somebody who already
     knows what he is pointing at. */
  canvas.addEventListener('dblclick', e => {
    if (Interior.busy()) return;
    e.preventDefault();
    const hit = pickAt(e.clientX, e.clientY);
    if (!hit) return;
    picked = hit;
    if (hit.kind === 'file') setRim(hit.rec, 1);
    enterPicked();
  });
  window.addEventListener('keydown', e => {
    if (Interior.busy()) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { toggleFreeFly(); return; }
    if (k === 'h') { showHints(); return; }
    if (e.key === 'Enter' && (picked || hover)) { e.preventDefault(); if (!picked) picked = hover; enterPicked(); }
    /* The flyer owns W A S D Q E only while it is on: outside it those are still
       replay.js's transport keys and this must not swallow them. */
    if (free.on && ('wasdqe'.includes(k) || k === 'shift')) { e.preventDefault(); freeKeys.add(k); }
  });
  window.addEventListener('keyup', e => freeKeys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => freeKeys.clear());
}

/* =============================================================================
   TOUCH -> INTERIOR — bridges touch onto interior.js's OWN input surface
   interior.js is imported, not edited (same rule DRONEKIT-DOC states for
   drones.js): it drives movement off a `keys` set fed by real keydown/keyup,
   and look off real mousedown/mousemove/mouseup, both read straight from
   document/window. So this dispatches exactly those events rather than
   reaching into the module's state — the left half of the canvas drags to
   move (synthetic WASD), the right half drags to look (a synthetic mouse
   drag, the same path drag-look already falls back to over CDP), and a
   two-finger tap leaves, calling the same `Interior.leave()` Esc calls.
   ========================================================================== */
function attachInteriorTouch(canvas) {
  const moveTouches = new Map();   // pointerId -> { x0, y0, keys: Set }
  let lookId = null;
  let downCount = 0, sawTwo = false, tapStart = 0;
  const DEAD = 14;                 // px of drag before a direction counts

  function setKeys(rec, wantW, wantS, wantA, wantD) {
    const want = { w: wantW, s: wantS, a: wantA, d: wantD };
    for (const k in want) {
      const on = rec.keys.has(k);
      if (want[k] && !on) { rec.keys.add(k); window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); }
      if (!want[k] && on) { rec.keys.delete(k); window.dispatchEvent(new KeyboardEvent('keyup', { key: k })); }
    }
  }
  const clearKeys = rec => setKeys(rec, false, false, false, false);

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || !Interior.inside()) return;
    downCount++;
    if (downCount === 1) tapStart = performance.now();
    if (downCount === 2) sawTwo = true;
    if (downCount > 2) return;

    const r = canvas.getBoundingClientRect();
    const leftHalf = (e.clientX - r.left) < r.width / 2;
    if (leftHalf && moveTouches.size === 0) {
      moveTouches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, keys: new Set() });
    } else if (!leftHalf && lookId === null) {
      lookId = e.pointerId;
      document.dispatchEvent(new MouseEvent('mousedown', { clientX: e.clientX, clientY: e.clientY }));
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !Interior.inside()) return;
    if (moveTouches.has(e.pointerId)) {
      const rec = moveTouches.get(e.pointerId);
      const dx = e.clientX - rec.x0, dy = e.clientY - rec.y0;
      setKeys(rec, dy < -DEAD, dy > DEAD, dx < -DEAD, dx > DEAD);
    } else if (lookId === e.pointerId) {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: e.clientX, clientY: e.clientY }));
    }
  });
  const end = e => {
    if (e.pointerType !== 'touch') return;
    if (moveTouches.has(e.pointerId)) { clearKeys(moveTouches.get(e.pointerId)); moveTouches.delete(e.pointerId); }
    if (lookId === e.pointerId) {
      document.dispatchEvent(new MouseEvent('mouseup', { clientX: e.clientX, clientY: e.clientY }));
      lookId = null;
    }
    if (downCount > 0) downCount--;
    /* Two fingers down together, both up again inside 300 ms, is the exit
       tap. Anything slower or with a third finger involved is a drag or a
       mis-tap, not a gesture that should throw the visit away. */
    if (downCount === 0) {
      if (sawTwo && Interior.inside() && performance.now() - tapStart < 300) Interior.leave();
      sawTwo = false;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* The help card: every control on one line, six seconds, and again on H.
   replay.js shows it once per browser at boot; this is the same element and the
   same six seconds, so both routes look identical. */
/* Read-only: where the lens is, what the orbit aims at, which mode has it.
   The city's ground plane is y = 0, so "above ground" is simply the height. */
export function camProbe() {
  return {
    x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2),
    aboveGround: +camera.position.y.toFixed(2),
    dist: +cam.dist.toFixed(2), zoom: +(cam.zoom || 1).toFixed(3),
    targetX: +cam.target.x.toFixed(2), targetZ: +cam.target.z.toFixed(2),
    panX: +cam.pan.x.toFixed(2), panZ: +cam.pan.z.toFixed(2),
    free: free.on, pointerLock: document.pointerLockElement === renderer.domElement,
  };
}

let hintsTimer = 0;
export function showHints() {
  const box = document.getElementById('hints');
  if (!box) return;
  box.hidden = false;
  /* Re-showing a hidden element does not replay its animation. */
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  clearTimeout(hintsTimer);
  hintsTimer = setTimeout(() => { box.hidden = true; }, 6000);
}

/* Where the lens ends up when it flies in: just outside the door, at eye
   height, looking through it. A building's door is on its -z face, which is the
   face the avenues run along; a plate or a street is entered at its near edge. */
function doorPose(rec) {
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  if (rec && rec.wx !== undefined) {
    pos.set(rec.wx, 1.7, rec.wz - 2.6);
    look.set(rec.wx, 1.5, rec.wz);
  } else if (rec) {
    const [x, z] = worldOrigin(rec);
    const cx = x + Math.min(rec.w, 14) / 2;
    pos.set(cx, 1.9, z - 2.2);
    look.set(cx, 1.5, z + 1.5);
  }
  return { pos, look };
}

/* The tool calls in the air for this file right now — one per tool_use id with
   no tool_result yet, which is the same fact the city's worker drones are. */
function workersFor(b) {
  const out = [];
  for (const w of workers.values()) {
    if (w.target === b) out.push({ tool: w.tool, fam: w.fam, label: w.tag.userData.text });
  }
  return out;
}

/* The buildings seated on a plate, and on every annex that continues it. */
function filesOfPlate(p) {
  const out = [];
  for (const b of files.values()) {
    let seat = b.plate;
    while (seat) { if (seat === p) { out.push(b); break; } seat = seat.annexOf; }
  }
  return out;
}

/* The lens, while the interior is flying through it. Passing null hands it back
   to updateCamera(), which has not moved since the visit started — which is why
   leaving restores the exact shot the viewer left. */
let camOverride = null;
function overrideCamera(pos, look) {
  if (!pos) { camOverride = null; return; }
  camOverride = camOverride || { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  camOverride.pos.copy(pos); camOverride.look.copy(look);
}

/* The sky is the same dome over both scenes, but they are two meshes with two
   materials, so the four camera-dependent uniforms are written per scene. Split
   out of render() for that reason and no other. */
export function paintSky(dome, cm) {
  const su = dome.material.uniforms;
  su.uTime.value = now;
  su.uNight.value = nightAmt;
  /* Saturating, not linear: the first fifty buildings have to visibly light the
     sky, and the four-hundredth cannot blow it out. */
  su.uGlow.value = 1 - Math.exp(-windowUnits / 1200);
  su.uCamUp.value.setFromMatrixColumn(cm.matrixWorld, 1);
  su.uCamFwd.value.setFromMatrixColumn(cm.matrixWorld, 2).negate();
  su.uTanV.value = Math.tan(cm.fov * Math.PI / 360);
  dome.position.copy(cm.position);
}


/* =============================================================================
   FRAME — everything that moves, once per frame
   ========================================================================== */
export function render(dt, idle) {
  if (!ok) return;
  now += dt;

  syncPlates();
  syncStreets();
  stepBuildings(dt);
  stepPrints(dt);
  stepGlitch(dt);
  stepDrones(dt, idle);
  /* One kit call a frame, AFTER stepDrones has moved every craft and handed it
     its velocity: rotors, strobes, bob, bank, downwash and the LOD swap all
     happen in here. It needs the REAL camera — a cached one holds the whole
     fleet at LOD0 and the triangle budget with it. */
  if (kit) { kit.setNight(nightAmt); kit.update(dt, camera); }
  /* The crowd, after the craft for the same reason: both read the frame's own
     camera, and this one wants the streets already synced above. */
  updateLife(dt);
  stepBeams(dt);
  stepTrails();
  stepParticles(dt);
  /* The interior moves the player and, while it is flying, the lens — so it
     runs BEFORE updateCamera(), which reads camOverride. */
  Interior.update(dt);
  updateCamera(dt * (idle > 0.5 ? 0.55 : 1));      // the drift slows when it thinks

  /* Uniforms that change every frame, in one place so nothing is missed. */
  const bu = buildings.material.uniforms;
  bu.uTime.value = now; bu.uIdle.value = idle;
  bu.uSun.value.copy(sunDir); bu.uSunColor.value.copy(sunColor);
  bu.uAmbient.value.copy(ambient); bu.uFog.value.copy(fogColor);
  const pu = plates.material.uniforms;
  pu.uSun.value.copy(sunDir); pu.uSunColor.value.copy(sunColor);
  pu.uAmbient.value.copy(ambient); pu.uFog.value.copy(fogColor);
  groundMat.uniforms.uFog.value.copy(fogColor);
  groundMat.uniforms.uCenter.value.copy(cam.target);
  dust.material.uniforms.uTime.value = now;
  dust.material.uniforms.uCenter.value.set(cam.target.x, 0, cam.target.z);
  beacons.material.uniforms.uTime.value = now;

  /* WHICH SCENE IS THE PICTURE. Only once the fly-in has landed: during the
     flight the city is still what you are looking at, and that is the shot
     `docs/shots/interior-enter.png` catches. */
  const within = Interior.inside();
  const drawScene = within ? Interior.getScene() : scene;
  const drawCam = within ? Interior.getCamera() : camera;
  drawCam.updateMatrixWorld();
  paintSky(within ? Interior.getSky() : sky, drawCam);

  if (composer) {
    renderPass.scene = drawScene;
    renderPass.camera = drawCam;
    composer.render();
  } else renderer.render(drawScene, drawCam);
}

/* Rise over ~0.8 s with an eased overshoot, then the warm facade cooling over
   about six seconds. easeOutBack, not a spring: a spring needs per-building
   velocity state and looks the same at this duration. */
const RISE_SECONDS = 0.8;
const easeOutBack = t => {
  const c = 1.9, u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;    // peaks near 1.06, settles at 1
};
function stepBuildings(dt) {
  for (const b of files.values()) {
    if (b.riseT < 1) {
      b.riseT = Math.min(1, b.riseT + dt / RISE_SECONDS);
      b.rise = Math.max(0, easeOutBack(b.riseT));
    }
    if (b.warm > 0.001) b.warm *= Math.pow(0.62, dt);   // ~6 s back to cold
    /* PERMANENCE, on the SESSION clock: nothing has touched this file for half
       an hour of the session, so its windows go out and its colour drains. It
       is not decay for its own sake -- it is what makes the shape of a long
       session readable, the parts still being worked on lit and the rest grey. */
    const idleMs = sessionNow - (b.touchedAt || 0) - PERMANENCE_MS;
    b.grey = idleMs <= 0 ? 0 : Math.min(1, idleMs / PERMANENCE_FADE_MS);
    pushAttr(b);
  }
  if (bCount) {
    bAttr.aRise.needsUpdate = bAttr.aWarm.needsUpdate = bAttr.aLit.needsUpdate = true;
    bAttr.aGrey.needsUpdate = true;
  }
}

const _v = new THREE.Vector3();
/* Where a light ribbon is emitted from, into _tp: the craft's own tail anchor
   when it has one, else the old fixed drop under its middle. */
const _tp = new THREE.Vector3();
function trailAt(g, pos, dropY) {
  const a = g.userData && g.userData.trailAnchor;
  if (a) a.getWorldPosition(_tp);
  else _tp.set(pos.x, pos.y + dropY, pos.z);
}

function stepDrones(dt, idle) {
  /* Its altitude follows the camera, not a constant: over a six-building city
     a fixed 6.4 units puts it in its own empty half of the frame. */
  const alt = Math.max(2.6, Math.min(9, cam.dist * 0.13));
  for (const m of drones.values()) {
    if (!m.isMain) continue;
    if (m.home) {
      /* A session's orchestrator is DOCKED at its own avenue's entrance, so
         which street is working right now is readable without a caption. */
      const [x, z] = worldOrigin(m.home);
      m.want.set(x + 1.4, alt * 0.75 + Math.sin(now * 0.5 + m.phase) * 0.3, z + STREET_ROAD * 0.5);
    } else {
      /* No street of its own (the pre-project single-session path): the
         orchestrator hovers over the middle of the city it is building. */
      m.want.set(cam.target.x, alt + Math.sin(now * 0.5) * 0.35, cam.target.z);
    }
  }
  for (const d of drones.values()) {
    d.phase += dt * (idle > 0.5 ? 0.5 : 1.4);
    d.busy *= Math.pow(0.4, dt);

    if (d.glitch) {
      /* THE PRE-ROLL. Four tenths of a second of the craft failing as a signal:
         the body strobes on the frame clock and throws red artifacts, and the
         voxels only start once it has finished breaking up. */
      d.glitch += dt;
      d.group.visible = Math.random() > 0.42;
      if (Math.random() < 0.5) {
        emit(d.pos.x + (Math.random() - 0.5) * 1.1, d.pos.y + (Math.random() - 0.5) * 0.7,
             d.pos.z + (Math.random() - 0.5) * 1.1, 0, 0.1, 0,
             LASER, 0.10, 0.18, 0.4, 0, 1);
      }
      if (d.glitch >= GLITCH_SECONDS) {
        d.glitch = 0;
        /* THE AIRFRAME IS GONE THE INSTANT THE VOXELS ARE IN THE AIR. An ORNIS
           shrinking behind its own debris reads as the camera pulling away, not
           as a machine coming apart, so the mesh is hidden and the burst below
           is the whole event. The disc fallback still collapses — a disc has no
           voxels of its own to be replaced by. */
        d.group.visible = !kit;
        derezBurst(d.pos.x, d.pos.y, d.pos.z, 0.9, 0.7, 0.9, 38);
        d.leaving = 0.0001;
      }
      continue;
    }
    if (d.leaving) {
      /* Derezzing in place: the body collapses while its voxels fall past it. */
      d.leaving = Math.min(1, d.leaving + dt * 2.6);
      d.want.copy(d.pos);
      if (kit) { d.group.visible = false; d.scale = 0; }
      else d.scale = Math.pow(1 - d.leaving, 2);
      if (d.leaving >= 1) { disposeDrone(d); drones.delete(d.id); continue; }
    } else if (d.scale < 1) {
      d.scale = Math.min(1, d.scale + dt * 1.7);
    }

    if (d.anchor && !d.leaving && !d.isMain) {
      d.orbitAng += dt * 0.6;
      d.want.set(
        d.anchor.wx + Math.cos(d.orbitAng) * 1.5,
        d.anchor.wy + 1.5 + Math.sin(d.phase) * 0.18,
        d.anchor.wz + Math.sin(d.orbitAng) * 1.5);
    }

    _v.copy(d.want).sub(d.pos);
    d.vel.addScaledVector(_v, (d.isMain ? 3.0 : 5.0) * dt);
    d.vel.multiplyScalar(Math.pow(d.isMain ? 0.02 : 0.05, dt));
    d.pos.addScaledVector(d.vel, dt);

    d.group.position.copy(d.pos);
    d.group.scale.setScalar(Math.max(0.0001, d.scale) * d.craftScale);
    if (kit) {
      /* The kit banks and pitches the airframe off the velocity this loop just
         integrated, so the roll that used to be written into rotation.z is the
         kit's now (`d.bank` is still on the record, and nothing reads it).
         What stays here is HEADING: an aircraft points where it is going, and
         one holding station keeps the heading it arrived on — which is the
         difference between a machine and a spinning ornament. */
      d.group.userData.setSpeed(d.vel);
      if (d.vel.lengthSq() > 0.04) d.group.rotation.y = Math.atan2(d.vel.x, d.vel.z);
    } else {
      /* Banking: the craft leans into the direction it is actually travelling, so
         "it flew over there to do that" reads without a caption. */
      const bank = Math.max(-0.5, Math.min(0.5, -d.vel.x * 0.055));
      d.bank += (bank - d.bank) * Math.min(1, dt * 6);
      d.group.rotation.z = d.bank;
      d.group.rotation.y += dt * (d.isMain ? 0.25 : 0.9);
      d.ring.rotation.z += dt * (2 + d.busy * 8);
      d.under.material.opacity = (d.isMain ? 0.30 : 0.10) + d.busy * 0.22;
    }
    /* The tag is the point now: "every drone that is sent must carry a tag of
       what it is going to do". A craft only exists while its agent is running,
       so its task is always worth reading -- what used to fade an idle craft's
       name almost to nothing is gone, and the overlap rule in cullCaptions()
       does the thinning instead, which is the one that keeps the type legible. */
    d.label.material.opacity = (d.isMain ? 0.90 : 0.62) + d.busy * 0.30;
    /* The label is a child of a rotating group, so undo the rotation on it. */
    d.label.material.rotation = 0;
    /* The mothership wears the count of what it could not launch. */
    setOverflow(d, d.queue.length);
    /* The ribbon leaves the TAIL, not the centre of mass: on a real airframe
       that is a visible difference, and it is what makes a banking craft's
       trail swing out behind it instead of pivoting under it. */
    trailAt(d.group, d.pos, -0.10);
    trailPush(d.trail, _tp.x, _tp.y, _tp.z);
  }
  stepWorkers(dt);
  cullCaptions();
}

/* Fly every worker out, hold it over its work, and bring it home.
   Three states and nothing else: `out` while it travels, `work` while it hovers
   over the building its call names, `back` once its tool_result has arrived.
   The state is DATA, not a timer -- a call that runs for four minutes keeps its
   drone over that building for four minutes, which is what makes the city an
   honest picture of what the session is doing right now. */
const WORK_MIN_SECONDS = 0.25;   // the shortest visit that still reads as one
function stepWorkers(dt) {
  for (const w of Array.from(workers.values())) {
    if (w.scale < 1 && w.state !== 'back') w.scale = Math.min(1, w.scale + dt * 3.4);
    w.orbitAng += dt * 1.1;

    /* Live mode may never send a tool_end (see WORKER_TIMEOUT_MS): after ninety
       seconds of session time the worker gives up and comes home on its own, so
       nothing is left flying forever over a call nobody will ever close. */
    if (w.endedAt < 0 && sessionNow - w.bornAt > WORKER_TIMEOUT_MS) { w.endedAt = sessionNow; w.ok = null; }

    if (w.state === 'out' || w.state === 'work') {
      const b = w.target;
      if (b && !b.gone) {
        w.want.set(b.wx + Math.cos(w.orbitAng) * 0.95,
                   0.30 + b.wy + 0.72 + Math.sin(w.orbitAng * 1.7) * 0.10,
                   b.wz + Math.sin(w.orbitAng) * 0.95);
      } else {
        /* Bash, PowerShell, WebFetch, Agent: no building of its own, so it works
           over its mothership -- the district root that craft is standing over. */
        w.want.set(w.craft.pos.x + Math.cos(w.orbitAng) * 1.9,
                   w.craft.pos.y - 0.55,
                   w.craft.pos.z + Math.sin(w.orbitAng) * 1.9);
      }
      if (w.state === 'out' && w.pos.distanceToSquared(w.want) < 1.3) {
        w.state = 'work'; w.arrivedAt = now;
        /* The beam fires HERE, not when the event arrived: the drone brought it.
           Same grammar as before -- scan bar, search cone, sparks, shell flash. */
        fireFamily(w.fam, w.target, w.craft);
        w.craft.lastAt = now; w.craft.busy = 1;
        /* An Edit on station is the machine that prints the building: from now
           until it leaves, the print rig's two laser heads sit on ITS arms. */
        if (kit && w.fam === 'write' && w.target) printerOver.set(w.target, w);
      }
      if (w.state === 'work' && w.endedAt >= 0 && now - w.arrivedAt > WORK_MIN_SECONDS) {
        w.state = 'back'; w.leftAt = now;
        if (printerOver.get(w.target) === w) printerOver.delete(w.target);
      }
    } else {
      /* Home is the mothership's cargo pod, not the middle of its airframe. */
      w.want.set(w.craft.pos.x, w.craft.pos.y + dockY(w.craft), w.craft.pos.z);
      w.scale = Math.max(0, w.scale - dt * 1.1);
      /* A failed call sputters: red smoke off the body the whole way home. */
      if (w.ok === false && now - w.smokeAt > 0.05) {
        w.smokeAt = now;
        emit(w.pos.x, w.pos.y, w.pos.z, (Math.random() - 0.5) * 0.3, 0.35, (Math.random() - 0.5) * 0.3,
             LASER, 0.13 + Math.random() * 0.08, 0.75, 0.25, -0.4, 1);
      }
      if (w.pos.distanceToSquared(w.craft.pos) < 0.6 || now - w.leftAt > 3.5 || w.scale <= 0.001) {
        disposeWorker(w);
        continue;
      }
    }

    _v.copy(w.want).sub(w.pos);
    w.vel.addScaledVector(_v, 7.0 * dt);
    w.vel.multiplyScalar(Math.pow(0.04, dt));
    w.pos.addScaledVector(w.vel, dt);
    w.group.position.copy(w.pos);
    w.group.scale.setScalar(Math.max(0.0001, w.scale) * w.craftScale);
    if (kit) {
      w.group.userData.setSpeed(w.vel);
      if (w.vel.lengthSq() > 0.04) w.group.rotation.y = Math.atan2(w.vel.x, w.vel.z);
      /* The variant's own effect — the read craft's scan beam, the search
         craft's cone, the shell craft's sparks, the net craft's uplink — burns
         for exactly as long as the tool call is being carried out over its
         building. toolStart is what puts the craft in the air, `work` is where
         it arrives, and toolEnd is what sends it home again. */
      const on = w.state === 'work';
      if (on !== w.working) { w.working = on; w.group.userData.setWorking(on); }
    } else w.group.rotation.y += dt * 2.2;
    /* ok:null docks silently: no smoke, and no ribbon on the way back either. */
    if (w.state !== 'back' || w.ok !== null) {
      trailAt(w.group, w.pos, 0);
      trailPush(w.trail, _tp.x, _tp.y, _tp.z);
    }
    w.tag.material.rotation = 0;
  }
}

/* Which drone names are actually on screen.
   Two rules, in order. A caption is only worth its ink while it is telling you
   something, so a subagent's name shows for CAPTION_SECONDS after it fires an
   event and the orchestrator's name always shows — over a dense district that
   alone takes twenty-odd captions down to two or three. Then, because two busy
   agents can still stand in front of each other, any two captions whose boxes
   overlap ON SCREEN are resolved in favour of the one that fired more recently.
   Faded-out type was not enough: at 10% opacity over a lit facade an overlap is
   still a smear, and the reader cannot tell which name they are reading. */
const _lp = new THREE.Vector3();
const _caps = [];
function cullCaptions() {
  _caps.length = 0;
  const tanV = Math.tan(camera.fov * Math.PI / 360);
  /* Crafts first, then their workers, so a mothership's own task always wins a
     collision against the tag of one of the calls it dispatched. */
  for (const d of drones.values()) add(d.label, d.pos, d.scale, d.isMain ? Infinity : d.lastAt + 1e6);
  /* Street signs sit between the two: a sign is permanent wayfinding and must
     outrank the tag of a call that will be gone in a second, but a mothership's
     own task still wins — it is the thing that is happening right now. */
  for (const s of streetOrder) if (s.sign) add(s.sign, s.sign.position, 1, 5e5);
  for (const w of workers.values()) add(w.tag, w.pos, w.scale, w.lastAt);

  function add(spr, pos, scale, at) {
    spr.visible = scale > 0.3 && !spr.userData.mute;
    if (!spr.visible) return;
    /* The caption's own position, not the craft's, and its own size: a sprite
       covers world-scale / distance of the frame, which is the box a collision
       actually happens in. */
    /* A drone caption's `position` is local to its craft's group; a street
       sign's already IS its world position, so it must not be added twice. */
    _lp.copy(pos); if (!spr.userData.isSign) _lp.y += tagLift(spr) * scale;
    const dist = Math.max(0.001, camera.position.distanceTo(_lp));
    /* Grow it to the legibility floor BEFORE measuring the box, or the overlap
       test is run against a size the reader never sees. */
    sizeCaption(spr, dist, tanV);
    _lp.project(camera);
    _caps.push({
      spr, x: _lp.x, y: _lp.y,
      hw: (spr.scale.x * tagK(spr) * 0.5) / (dist * tanV * camera.aspect),
      hh: (spr.scale.y * tagK(spr) * 0.5) / (dist * tanV),
      at,
    });
  }
  /* A caption at the edge of the frame is the one that reads back as
     "usikschule". A Sprite's `center` is which point of it lands on its world
     position, so sliding that toward the far edge swings the whole caption
     INWARD without moving the thing it names a millimetre — the fix HANDOFF
     open items 6 and 8 describe.
     Two changes over the version that only flipped a sign's centre to 0 or 1:
     it is a SOLVE rather than a flip, so a caption twice as wide as the gap it
     is standing in still lands inside; and it runs over EVERY caption, because
     a drone tag and a district name clip at the same edge a street sign does.
     A caption whose ANCHOR is off the frame is hidden instead — a label
     pointing at something nobody can see is noise, not wayfinding. */
  const EDGE = 0.02;                   // NDC: 1% of the frame, each side
  for (const c of _caps) {
    if (!c.spr.visible) continue;
    if (c.x < -1 || c.x > 1 || c.y < -1 || c.y > 1) { c.spr.visible = false; continue; }
    const w = c.hw * 2, h = c.hh * 2;
    let ax = 0.5, ay = 0.5;
    if (c.x - w * ax < -1 + EDGE) ax = (c.x + 1 - EDGE) / w;
    if (c.x + w * (1 - ax) > 1 - EDGE) ax = 1 - (1 - EDGE - c.x) / w;
    if (c.y - h * ay < -1 + EDGE) ay = (c.y + 1 - EDGE) / h;
    if (c.y + h * (1 - ay) > 1 - EDGE) ay = 1 - (1 - EDGE - c.y) / h;
    c.spr.center.set(ax, ay);
    /* Where it ACTUALLY sits now, so the overlap pass below tests the boxes the
       reader will see rather than the ones the anchors would have drawn. */
    c.x += (0.5 - ax) * w;
    c.y += (0.5 - ay) * h;
  }
  /* Freshest first, then keep greedily: whoever is already standing wins, so the
     one that goes is always the one whose drone has been quiet longer. */
  _caps.sort((a, b) => b.at - a.at);
  for (let i = 0; i < _caps.length; i++) {
    const a = _caps[i];
    for (let j = 0; j < i; j++) {
      const b = _caps[j];
      if (!b.spr.visible) continue;
      if (Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh) {
        a.spr.visible = false;
        break;
      }
    }
  }
}

function stepBeams(dt) {
  for (const m of scanPool) {
    if (!m.visible) continue;
    const u = m.userData;
    u.t += dt;
    if (u.t >= u.life) { m.visible = false; continue; }
    const k = u.t / u.life;
    m.position.y = u.y0 + u.h * (1 - k);        // top to bottom, once
    m.material.opacity = 0.9 * Math.sin(Math.PI * k);
    m.lookAt(camera.position);
    m.rotation.x = 0; m.rotation.z = 0;         // stay a horizontal bar
  }
  for (const m of conePool) {
    if (!m.visible) continue;
    const u = m.userData;
    u.t += dt;
    if (u.t >= u.life) { m.visible = false; continue; }
    const k = u.t / u.life;
    const d = u.drone;
    const ax = d ? d.pos.x : u.cx, ay = d ? d.pos.y : 6, az = d ? d.pos.z : u.cz;
    /* The cone hangs from the drone and sweeps across the district it is
       searching, so the light has an obvious source. */
    const sweep = (k - 0.5) * 2 * u.r * 0.55;
    const tx = u.cx + Math.cos(u.t * 4.0) * sweep, tz = u.cz + Math.sin(u.t * 4.0) * sweep;
    m.position.set(ax, ay, az);
    const h = Math.max(1, ay - 0.3);
    m.scale.set(u.r, h, u.r);
    /* The cone geometry already hangs straight down from its apex, so aiming it
       is two small tilts - lookAt() would spin the mouth around its own axis. */
    m.rotation.set(Math.atan2(tz - az, h), 0, -Math.atan2(tx - ax, h));
    m.material.opacity = 0.16 * Math.sin(Math.PI * k);
  }
}


/* =============================================================================
   HOUSEKEEPING
   ========================================================================== */
function disposeSprite(s) {
  if (!s) return;
  if (s.material.map) s.material.map.dispose();
  s.material.dispose();
}
function disposeDrone(d) {
  droneGroup.remove(d.group);
  if (kit) kit.remove(d.group);
  disposeSprite(d.label);
  disposeSprite(d.overflow);
  trailRelease(d.trail);
  for (const w of Array.from(d.workers)) disposeWorker(w);
}
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

export function resize() {
  if (!ok && !renderer) return;
  const c = renderer.domElement;
  W = c.clientWidth; H = c.clientHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / Math.max(1, H);
  camera.updateProjectionMatrix();
  Interior.resize(W, H);
  if (composer) composer.setSize(W, H);
}

/* Bloom is opt-out, not opt-in: it is what turns lit windows into a city at
   dusk. It runs at half resolution, and RUNBOOK.md records the measured frame
   rate with it on — if that number ever drops under the gate, this is the first
   thing to remove. */
export function enableBloom(on) {
  if (!ok) return;
  if (!on) { composer = null; return; }
  composer = new EffectComposer(renderer);
  /* Half of THAT again on mobile: the bloom pass already runs under the
     renderer's own pixel ratio (the comment above), and a phone GPU pays for
     every one of those pixels a second time compositing it back in. */
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 0.5 : 1.0));
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  /* strength / radius / threshold. The threshold is the important one: below
     about 0.6 the lit facades themselves bloom and a close pass goes to white. */
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.48, 0.72, 0.62);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(W, H);
}

/* Entry points by name, for the capture harness in RUNBOOK.md. A headless run
   has no pointer, and the four interior shots have to be taken from inside a
   named building — so these resolve a name to the same record a click would
   have picked and call the same Interior entry the picker calls. Nothing here
   bypasses the interior's own code path. */
export function enterFileByPath(rel) {
  let b = files.get(rel);
  if (!b) for (const f of files.values()) if (f.rel.endsWith(rel) || f.name === rel) { b = f; break; }
  if (!b) return null;
  Interior.enterBuilding(b);
  return b.rel;
}
export function enterPlateByName(name) {
  for (const p of plateByKey.values()) {
    if (p.name === name || p.key.endsWith(name)) { Interior.enterPlate(p); return p.name; }
  }
  return null;
}
export function enterStreetByIndex(i) {
  const s = streetOrder[i];
  if (!s) return null;
  Interior.enterStreet(s);
  return s.name;
}

/* Perf probe. The gate in the brief is 300 buildings and 25 drones, and a real
   8.5-hour session only ever reaches 221 — so the only honest way to report the
   gate is to place the extra buildings deliberately and say so. Nothing calls
   this except a person measuring; it never runs during a replay. */
export function stress(n) {
  for (let i = 0; i < n; i++) touch(`__stress/block${(i / 30) | 0}/file${i}.js`, 'write', 'main', true);
  settle();
  return bCount;
}

/* The same idea for the worker layer. The gate is 40 VISIBLE workers, and the
   cap is 12 per craft, so this has to bring its own motherships — four of them
   for forty workers. They are launched with no tool_end and never time out
   inside a measurement, so the count holds still while __fps() settles. */
/* The third half of the gate: "300 buildings + 40 workers + 12 streets". A
   fixture only has three sessions, so the extra avenues are opened deliberately
   and said so — each with a handful of real buildings, because twelve empty
   bands would measure the lamp layer and nothing else. Measurement only. */

export function stressStreets(n) {
  for (let i = streetOrder.length; i < n; i++) {
    const id = '__stress_street' + i;
    openStreet(id, 'stress avenue ' + i + ' — synthetic street for the frame-rate gate',
               i === n - 1, id + ':main');
    for (let j = 0; j < 10; j++) touch(`__stress${i}/block${(j / 5) | 0}/f${j}.ts`, 'write', 'main', true, false, id);
  }
  settle();
  return streetOrder.length;
}

export function stressWorkers(n) {
  const targets = Array.from(files.values());
  for (let i = 0; i < n; i++) {
    const cid = '__stress_craft' + ((i / WORKER_CAP) | 0);
    let craft = drones.get(cid);
    if (!craft) {
      craft = makeDrone(cid, 'stress ' + cid, false);
      craft.scale = 1;
      craft.pos.set(cam.target.x + (Math.random() - 0.5) * 8, 5, cam.target.z + (Math.random() - 0.5) * 8);
      drones.set(cid, craft);
    }
    const b = targets.length ? targets[(Math.random() * targets.length) | 0] : null;
    if (workers.size >= MAX_WORKERS) break;
    const w = makeWorker(craft, '__stress_w' + i + '_' + now, i % 3 ? 'Edit' : 'Read',
                         i % 3 ? 'write' : 'read', b);
    w.scale = 1;
    w.bornAt = Infinity;      // never times out while a frame rate is being read
  }
  return workers.size;
}


/* =============================================================================
   MEASUREMENT — the numbers docs/RUNBOOK.md quotes
   Read-only, called by hand from the console or a capture harness. Nothing in
   the replay path touches any of this.
   ========================================================================== */
/* Where the city lands in the frame, in per cent of it. The BUILDINGS only: the
   drones belong to the shot but they are not the city, and one craft off over an
   outlying annex would report a wide frame while the city itself looked small.
   `width` is the span of the city's bounding box, `top` is how far its highest
   corner sits below the top edge — the two numbers the framing is judged on. */
/* The smallest GLYPH height, in pixels of the rendered frame, among the drone
   and worker captions that are actually visible right now. The legibility floor
   is 13 px and sizeCaption() enforces it per caption; this is how that claim is
   checked from outside rather than asserted. */
export function tagPixels() {
  const tanV = Math.tan(camera.fov * Math.PI / 360);
  let min = Infinity, n = 0;
  const one = (spr, pos, scale) => {
    if (!spr || !spr.visible || scale <= 0.3) return;
    _p.copy(pos); if (!spr.userData.isSign) _p.y += tagLift(spr) * scale;
    const dist = Math.max(0.001, camera.position.distanceTo(_p));
    const px = (spr.scale.y * tagK(spr) * (spr.userData.glyphFrac || 0.7)) / (2 * dist * tanV) * H;
    if (px < min) min = px;
    n++;
  };
  for (const d of drones.values()) one(d.label, d.pos, d.scale);
  for (const w of workers.values()) one(w.tag, w.pos, w.scale);
  /* Street signs are held to the same floor by the same sizeCaption(), so they
     belong in the same measurement — a sign nobody can read is a street with no
     name on it. `signs` is broken out because the shot gate asks for it. */
  let sMin = Infinity, sN = 0;
  for (const s of streetOrder) {
    const spr = s.sign;
    if (!spr || !spr.visible) continue;
    const dist = Math.max(0.001, camera.position.distanceTo(spr.position));
    const px = (spr.scale.y * (spr.userData.glyphFrac || 0.7)) / (2 * dist * tanV) * H;
    if (px < sMin) sMin = px;
    if (px < min) min = px;
    sN++; n++;
  }
  return { captions: n, minGlyphPx: n ? +min.toFixed(1) : null,
           signs: sN, minSignPx: sN ? +sMin.toFixed(1) : null };
}

/* What is actually in the air, by AIRFRAME. `kit.stats()` counts craft and the
   LOD split; the variant breakdown is this file's own bookkeeping, because the
   kit deliberately does not know which of its craft belongs to which agent. The
   drone row of the gate in RUNBOOK.md is read off this. */
export function kitStats() {
  if (!kit) return { kit: false };
  const byVariant = {};
  const bump = g => { const t = g.userData.type; byVariant[t] = (byVariant[t] || 0) + 1; };
  for (const d of drones.values()) bump(d.group);
  for (const w of workers.values()) bump(w.group);
  return Object.assign({ kit: true, byVariant }, kit.stats());
}

export function frameBox() {
  if (!bCount) return null;
  let lx = Infinity, hx = -Infinity, lz = Infinity, hz = -Infinity, hy = 0;
  for (const b of files.values()) {
    if (b.wx - 0.5 < lx) lx = b.wx - 0.5;
    if (b.wx + 0.5 > hx) hx = b.wx + 0.5;
    if (b.wz - 0.5 < lz) lz = b.wz - 0.5;
    if (b.wz + 0.5 > hz) hz = b.wz + 0.5;
    if (b.wy > hy) hy = b.wy;
  }
  let x0 = 9, x1 = -9, y1 = -9;
  for (let i = 0; i < 8; i++) {
    _p.set(i & 1 ? hx : lx, i & 2 ? hy : 0, i & 4 ? hz : lz).project(camera);
    if (_p.x < x0) x0 = _p.x;
    if (_p.x > x1) x1 = _p.x;
    if (_p.y > y1) y1 = _p.y;
  }
  return { width: +((x1 - x0) * 50).toFixed(1), top: +((1 - y1) * 50).toFixed(1) };
}

/* The two traps that have broken this city silently, in one call.

   `attrs` is the vertex-attribute count of the facade program. GL guarantees
   sixteen slots; instanceMatrix eats four of them and every other attribute
   takes one, whatever its itemSize. At seventeen the program does not link,
   SwiftShader logs "Too many attributes" and the city is simply black — which
   is why the ten per-building floats ride in three vec4s. **16 is the answer.
   17 means the next pass broke it.**

   `sphereRadius` is the picking trap. three caches an InstancedMesh's bounding
   sphere on first use and never invalidates it when instanceMatrix changes, so
   a raycast against an empty city caches radius -1 and every building raycast
   after that misses in total silence. This recomputes it — the same call a
   raycast makes — so a negative or NaN radius shows up as a number instead of
   as "hovering does nothing". A healthy city reads roughly half its own
   diagonal.

   Cheap enough to call by hand, deliberately not called from the frame loop. */
export function selfCheck() {
  const g = buildings.geometry;
  const attrs = Object.keys(g.attributes).length + 4;
  buildings.computeBoundingSphere();
  const s = buildings.boundingSphere;
  return {
    attrs,
    sphereRadius: s ? +s.radius.toFixed(2) : null,
    streets: streetOrder.length,
    buildings: bCount,
  };
}


/* =============================================================================
   SHARED PRIMITIVES — the pieces vault.js stands its own city on
   One product, two cities. `vault.html` renders Beri's Obsidian vault with the
   same packer, the same sky, the same slabs, the same captions and the same
   framing solve as the session city above — so those live HERE, once, and are
   re-exported rather than copied. What is NOT shared is the part that is driven
   by different data: the facade program (files have extensions, notes have word
   counts and tags), the roads, and the event grammar. Those are vault.js's own.

   Nothing below changes behaviour in this file. createSky / createGround /
   createPlateMaterial / fitDistance were factored out of buildSky, buildGround,
   buildPlates and the camera solve in place, and this block only widens their
   visibility.
   ========================================================================== */
export {
  /* The append-only packer. Its whole point — a rect's origin corner is fixed
     the moment it is created — is what keeps BOTH cities readable while they
     grow, so the vault city's districts use it unchanged. */
  makePlate, placeIn, addChild, bumpBounds, worldOrigin, rectsOverlap,
  /* The grid the packer works in. A vault note's lot is the same size as a
     session file's lot, which is why the two cities read at the same scale. */
  LOT, LOT_GAP, PLATE_PAD, PLATE_GAP,
  /* Captions: ink-stroked canvas textures. A district name in either city. */
  makeLabel, clipName,
  /* Deterministic 0..1 from a string — the same note gets the same lit windows
     on every reload, which is what makes a screenshot reproducible. */
  hash01,
};

/* The four colour objects setPhase() writes. A material built outside this file
   holds these same objects in its uniforms, so one setPhase() call moves the
   light in both cities and there is no second time-of-day system to keep in
   step. Returned as the live objects, deliberately — copying them would be the
   bug this exists to prevent. */
export function lightUniforms() {
  return { sunDir, sunColor, ambient, fogColor, hzColor, znColor };
}


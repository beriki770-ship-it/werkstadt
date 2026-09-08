/* =============================================================================
   werkstadt — biomes.js
   Where everything stands, and why. This file turns two real payloads —
   data/vault.json (432 notes, 3518 links) and /api/world (the project towns) —
   into a placement list. It creates no geometry and no materials: it hands
   world.js an array of records, each of which carries the note or the town it
   came from, so nothing on the map can exist without a source.

   The geography was approved before it was built:
     Dev Logs   176 notes   industrial valley, factories and chimneys
     Knowledge  110 notes   a mountain; the most-linked notes are its summit
     Projects    62 notes   the civic half of the harbour city
     towns      125 dirs    the harbour city's quarters
     Daily       45 notes   bridges along the river, in date order
     People      21 notes   a hill village, one porch light each
     Boards       1 note    a fortress; its open cards are cranes on the walls
     Ideas        3 notes   islands offshore, a lighthouse each
     Templates    7 notes   a quarry
     Orphans     13 notes   ruins on the steppe at the map edge
     root         3 notes   the old town at the river mouth

   Every position is deterministic: a note's angle and radius come from its rank
   and a hash of its id, never from Math.random. Reload and the world is the
   world you left; that is also the only way docs/shots reproduce.
   ========================================================================== */

import { heightAt, landAt, slopeAt, riverAt, distToRiver, ISLANDS, HALF, SEA } from './terrain.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/* A 32-bit string hash, and a deterministic 0..1 from it. Both used only for
   jitter: two notes of equal rank must not stack on the same spoke. */
export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const unit = (str, salt) => (hash32(str + '|' + salt) % 100000) / 100000;

/* Region anchors. These are the map's landmarks and they are read in three
   places — placement here, the search's fly-to, and the ?focus= deep link — so
   they are exported rather than inlined. */
export const REGIONS = {
  knowledge: { x: -150, z: -120, label: 'Knowledge' },
  devlogs:   { x: -110, z:  150, label: 'Dev Logs' },
  harbour:   { x:  110, z:   10, label: 'Projects' },
  people:    { x:  -55, z: -255, label: 'People' },
  boards:    { x:   20, z:  -85, label: 'Boards' },
  daily:     { x:   25, z:   40, label: 'Daily' },
  ideas:     { x:  305, z:   50, label: 'Ideas' },
  templates: { x: -320, z:   30, label: 'Templates' },
  orphans:   { x: -352, z:  248, label: 'Orphans' },
  oldtown:   { x:  150, z:   66, label: 'Home' },   // inland of the river mouth: at 168 it stood in the surf
  vault:     { x:  -60, z:  -40, label: 'the vault' },   // the whole landmass
};

/* The radius world.js builds a trade town's landmark and its page-wings inside.
   Quarters are packed about 12 units apart along the shore, so this is the
   largest yard a landmark can have without reaching far into its neighbour's.
   The quarter's own generic houses are not built at all when it has one (see
   the harbour block below), so this yard is empty ground the landmark owns.
   One number, read in both files, never guessed twice. */
export const LM_YARD = 6.8;

/* THE QUARTER'S OWN STREET GRID, in one place because two files lay houses on
   it now: this file builds the quarter's planned houses on it, and world.js
   puts a LIVE building — one a running session just created a file in — in the
   next free plot of the same grid. Two copies of these three numbers would put
   a materialising house through its neighbour's wall.
   COLS 3 at 5.0 m spans 14.6 m of the ~15.8 m frontage each quarter has; the
   row pitch of 5.4 keeps a 14-house quarter inside the 27 m between one row of
   quarters and the next. */
export const HOUSE_GRID = { COLS: 3, COL_PITCH: 5.0, ROW_PITCH: 5.4 };

/* Size from words, height from words: a 33,000-word log is not thirty times the
   footprint of a 1,000-word note, it is a landmark. Log scale, the same one the
   vault city used, kept because it was the thing that worked there. */
const wordsToHeight = w => 1.5 + Math.log10(Math.max(10, w)) * 1.85;
const wordsToFoot   = w => 2.6 + Math.log10(Math.max(10, w)) * 1.05;

/* -----------------------------------------------------------------------------
   THE FOUR WALL PALETTES AND THE THREE ROOFS.

   The verdict on the harbour capture was "houses are copies — same beige block,
   same window grid, same roof, hundreds of times", and it was literally true:
   every generic structure went into ONE plaster pool with ONE hip roof, and the
   only thing that differed between two of them was half a stop of tint out of
   the wall shader's own hash.

   These names are the whole contract between this file and world.js: this file
   decides WHICH palette and WHICH roof a building has, from a hash of the town
   or note it came from; world.js owns what each name looks like. A name that
   world.js does not know falls back to the plaster pool rather than dropping the
   building, which is why the strings live here as arrays and not as indices.
   -------------------------------------------------------------------------- */
export const PALETTES = ['plaster', 'white', 'brick', 'timber'];
export const ROOF_TYPES = ['hip', 'gable', 'flat'];
/* The coast is whitewash country: two of the four draws are whitewash, one is
   ochre plaster, one is brick. No dark timber on the waterfront — that is the
   People village's material, up the hill, and using it in both places would
   throw away the one thing that tells the two apart from a distance. */
const COASTAL_PALETTES = ['white', 'white', 'plaster', 'brick'];

/** Recently touched = its windows are on before dusk even falls. Six hours is
    "this afternoon"; anything older is just a building. */
const freshness = (iso) => {
  const age = (Date.now() - Date.parse(iso)) / 3600000;
  return isFinite(age) ? Math.max(0, 1 - age / 6) : 0;
};

/* Walk a point back towards an anchor until it is on dry land. Every region
   that is laid out by a formula around a centre can put a note in the sea when
   the coastline moves — the Projects quarter did exactly that, and the harbour
   capture showed a dozen buildings standing on open water. Nothing is dropped:
   the note is moved inland, which is the only honest way to keep all 62 of them
   on the map. Returns null only if the anchor itself is under water. */
function toLand(x, z, ax, az) {
  for (let i = 0; i < 26; i++) {
    if (heightAt(x, z) > SEA + 1.4) return [x, z];
    x += (ax - x) * 0.12;
    z += (az - z) * 0.12;
  }
  return heightAt(x, z) > SEA + 1.4 ? [x, z] : null;
}

/* Push a point off the river's banks. The river is the Daily index — you have
   to be able to SEE the bridge you flew to — so nothing else is allowed within
   32 units of the water. It steps along z because the river runs roughly
   east-west through every region that has this problem. */
function awayFromRiver(x, z, keep) {
  const dir = z < 40 ? -1 : 1;
  for (let i = 0; i < 18 && distToRiver(x, z) < 38; i++) z += dir * 5;
  return keep && Math.abs(z) > HALF * 0.7 ? null : [x, z];
}

/* A structure record. `ref` is what the caption and the obsidian:// link read,
   and its presence is the whole of anti-goal 1: a record with no ref cannot be
   built, because nothing downstream knows what to say about it. */
function structure(kind, x, z, o) {
  return Object.assign({
    kind, x, z, y: landAt(x, z),
    w: 3, d: 3, h: 4, rot: 0, lit: 0, seed: 0,
  }, o);
}


/* =============================================================================
   THE PLAN — one pass over both payloads
   ========================================================================== */
export function planWorld(vault, towns) {
  const out = {
    structures: [],   // boxes: houses, factories, terraces, ruins, quarry cuts, walls
    landmarks: [],    // GLB placements: {model, x, y, z, rot, scale, ref}
    bridges: [],      // Daily, in date order
    quarters: [],     // one per project town, for drones/boats/captions
    forest: [],       // instanced trees
    roadPts: [],      // polylines, terrain-following, drawn as ribbons
    index: new Map(), // id -> record, for search and ?focus=
    roadsDrawn: 0,    // links that got their own road on the ground
    linksBundled: 0,  // links carried by the trunk roads instead
    trunkRoads: 0,    // one per pair of regions that has links
  };
  const byId = new Map();
  /* ONE river guard, for every box on the map. Knowledge's outer terraces and
     the Dev Logs blocks both reach the river's middle course, and a date search
     that flies to a bridge has to arrive at a bridge, not inside a factory that
     was built on top of it. Applied here rather than at each of the seven
     placement sites so it cannot be forgotten at the eighth. */
  const place = (rec) => {
    if (distToRiver(rec.x, rec.z) < 36) {
      const sink = rec.y - landAt(rec.x, rec.z);
      const [nx, nz] = awayFromRiver(rec.x, rec.z);
      rec.x = nx; rec.z = nz; rec.y = landAt(nx, nz) + sink;
    }
    out.structures.push(rec);
    if (rec.ref) byId.set(rec.ref.id, rec);
    return rec;
  };

  const notes = vault.notes;
  const inFolder = f => notes.filter(n => n.folder === f);
  const posOf = new Map();   // note id -> {x,z,y} — the roads read this back

  /* -------------------------------------------------------------------------
     KNOWLEDGE — the mountain. Rank by inlinks: the most-linked note is the
     summit, the least-linked are the foothills, so the shape of the hill IS the
     shape of what Beri keeps coming back to.
     ---------------------------------------------------------------------- */
  /* TERRACES, not a phyllotaxis scatter.

     The third-pass verdict on this mountain was "sugar-cube boxes scattered on
     it", and it was right for a structural reason: every note was placed on a
     spiral, its own y read straight off landAt(), and a box sunk a third of its
     height into a 40-degree slope is still a box sitting at a random angle on a
     hillside. Nothing tied any two of them together, so the eye had nothing to
     read but a dusting of cubes.

     What people actually do to a mountainside they want to use is cut it into
     LEVEL steps and hold each step up with a wall. That is the shape here now: a
     band of three to eight notes shares ONE levelled platform, the platform's
     downhill edge is a stone retaining wall as tall as the drop it is holding
     back, and a path switchbacks from one terrace to the next. The bands walk
     outwards and downwards in rank order, so the shape of the hill is still the
     shape of what Beri keeps coming back to — it is only legible now.

     The five most-linked notes are temples on a levelled plateau at the summit,
     with their own retaining ring and the path arriving at it. */
  const know = inFolder('Knowledge').sort((a, b) => b.inlinks - a.inlinks);
  const summit = know.slice(0, 5);
  const TOWER_PITCH = 8.4;                 // metres between two notes on a terrace
  const terraceCentres = [];               // where the path goes, in order

  /* -- the summit plateau ------------------------------------------------- */
  if (summit.length) {
    const PR = 19;                         // plateau radius
    const spots = summit.map((n, i) => {
      const a = i * (Math.PI * 2 / summit.length) + 0.6;
      return { a, x: REGIONS.knowledge.x + Math.cos(a) * PR * 0.62,
                  z: REGIONS.knowledge.z + Math.sin(a) * PR * 0.62 };
    });
    /* LEVELLED: one y for all five, or they are five towers at five heights and
       the plateau is not a plateau. The mean rather than the max, so the ring
       wall below has something to hold and the summit is not left standing on a
       pedestal of its own. */
    const py = spots.reduce((s, p) => s + landAt(p.x, p.z), 0) / spots.length;
    summit.forEach((n, i) => {
      const p = spots[i];
      out.landmarks.push({ model: 'tower', x: p.x, y: py, z: p.z, rot: p.a,
                           scale: 3.4 + n.inlinks / 60, material: 'stone', ref: noteRef(n) });
      posOf.set(n.id, { x: p.x, y: py, z: p.z });
      byId.set(n.id, { kind: 'temple', x: p.x, z: p.z, y: py, ref: noteRef(n) });
    });
    /* The ring that makes it a plateau and not a hilltop: sixteen stone blocks
       around the rim, each as tall as the ground falls away under it. */
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      const x = REGIONS.knowledge.x + Math.cos(a) * PR;
      const z = REGIONS.knowledge.z + Math.sin(a) * PR;
      const drop = Math.max(1.1, py - landAt(x, z) + 1.4);
      place(structure('wall', x, z, {
        w: PR * 2 * Math.PI / 16 + 0.6, d: 2.2, h: drop, rot: a + Math.PI / 2,
        y: py - drop, seed: unit(summit[0].id, 'p' + k), ref: noteRef(summit[0]),
      }));
    }
    terraceCentres.push([REGIONS.knowledge.x, REGIONS.knowledge.z, py]);
  }

  /* -- the terraces ------------------------------------------------------- */
  let ti = summit.length, band = 0;
  while (ti < know.length) {
    /* Three to eight notes per terrace, from the first note's own hash — a
       terrace that always held the same number would be a staircase. */
    const rows = know.slice(ti, ti + 3 + Math.floor(unit(know[ti].id, 'n') * 6));
    const t = ti / Math.max(1, know.length - 1);
    const r = 30 + Math.pow(t, 0.80) * 190;
    /* The golden angle again, but between TERRACES rather than between notes:
       consecutive bands land on opposite sides of the mountain, so the platforms
       never stack into one ring and the path that joins them switchbacks. */
    const a0 = band * GOLDEN + unit(rows[0].id, 'a') * 0.4;
    const span = (rows.length - 1) * TOWER_PITCH / r;
    const spots = rows.map((n, k) => {
      const a = a0 + (k / Math.max(1, rows.length - 1) - 0.5) * span;
      return { a, x: REGIONS.knowledge.x + Math.cos(a) * r,
                  z: REGIONS.knowledge.z + Math.sin(a) * r };
    });
    /* ONE height for the whole band. This single line is the difference between
       terraces and scattered crates: a level platform reads as something that
       was cut, and a cut is what says a person was here. */
    const ty = spots.reduce((s, p) => s + landAt(p.x, p.z), 0) / spots.length;
    rows.forEach((n, k) => {
      const p = spots[k];
      const foot = wordsToFoot(n.words);
      const h = wordsToHeight(n.words) * 1.15;
      const rec = place(structure('terrace', p.x, p.z, {
        w: foot * 2.2, d: foot * 1.5, h, y: ty,
        rot: p.a + Math.PI / 2, lit: freshness(n.modified), seed: unit(n.id, 's'),
        ref: noteRef(n),
      }));
      posOf.set(n.id, { x: p.x, y: rec.y, z: p.z });
    });
    /* THE RETAINING WALL, on the downhill edge — which on a cone is always the
       outward one. Its height is the drop it is actually holding, measured, so a
       terrace cut into a steep flank gets a tall wall and one on a shoulder gets
       a kerb. Without it a levelled platform is a slab hovering over the slope,
       which is the same floating-box problem in a new shape. */
    const wallR = r + 5.0;
    const wallN = Math.max(3, rows.length + 1);
    for (let k = 0; k < wallN; k++) {
      const a = a0 + (k / (wallN - 1) - 0.5) * (span + TOWER_PITCH / r * 1.4);
      const x = REGIONS.knowledge.x + Math.cos(a) * wallR;
      const z = REGIONS.knowledge.z + Math.sin(a) * wallR;
      const drop = Math.max(1.0, ty - landAt(x, z) + 1.2);
      place(structure('wall', x, z, {
        w: wallR * (span + TOWER_PITCH / r * 1.4) / (wallN - 1) + 0.8, d: 2.0, h: drop,
        rot: a + Math.PI / 2, y: ty - drop,
        seed: unit(rows[0].id, 'rw' + k), ref: noteRef(rows[0]),
      }));
    }
    terraceCentres.push([REGIONS.knowledge.x + Math.cos(a0) * r,
                         REGIONS.knowledge.z + Math.sin(a0) * r, ty]);
    ti += rows.length; band++;
  }
  /* The path. Terrace centres joined in order, outermost first, so it climbs —
     and because consecutive bands sit a golden angle apart it climbs as
     switchbacks rather than as a ladder up one face. */
  for (let k = terraceCentres.length - 1; k > 0; k--) {
    const a = terraceCentres[k], b = terraceCentres[k - 1];
    out.roadPts.push({ kind: 'path', pts: sampleLine(a[0], a[1], b[0], b[1], 9) });
  }

  /* -------------------------------------------------------------------------
     DEV LOGS — the industrial valley, and the busiest region on the map.
     A block grid with rail sidings between the rows: 176 factories scattered by
     phyllotaxis would read as a forest of chimneys, and a valley full of work
     should read as something laid out by people.
     ---------------------------------------------------------------------- */
  const devs = inFolder('Dev Logs').concat(inFolder('Debugging'))
    .sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  /* Four blocks with streets between them rather than one 14-wide grid: the
     grid read as identical crates in a warehouse, and a works is a set of yards
     with gaps you can see down. */
  const BLOCK_COLS = 6, BLOCK_ROWS = 8, PITCH_X = 12.5, PITCH_Z = 11;
  const perBlock = BLOCK_COLS * BLOCK_ROWS;
  devs.forEach((n, i) => {
    const b = Math.floor(i / perBlock), k = i % perBlock;
    const col = k % BLOCK_COLS, row = Math.floor(k / BLOCK_COLS);
    const bx = (b % 2) * (BLOCK_COLS * PITCH_X + 22) - (BLOCK_COLS * PITCH_X + 22) / 2;
    const bz = Math.floor(b / 2) * (BLOCK_ROWS * PITCH_Z + 20) - (BLOCK_ROWS * PITCH_Z + 20) / 2;
    const x = REGIONS.devlogs.x + bx + (col - BLOCK_COLS / 2) * PITCH_X + (unit(n.id, 'x') - 0.5) * 3;
    const z = REGIONS.devlogs.z + bz + (row - BLOCK_ROWS / 2) * PITCH_Z + (unit(n.id, 'z') - 0.5) * 3;
    const foot = wordsToFoot(n.words);
    const rec = place(structure('factory', x, z, {
      w: foot * (1.5 + unit(n.id, 'w') * 0.9), d: foot * (1.1 + unit(n.id, 'd') * 0.6),
      h: wordsToHeight(n.words) * (0.7 + unit(n.id, 'h') * 0.8),
      rot: (unit(n.id, 'r') - 0.5) * 0.2, lit: freshness(n.modified),
      seed: unit(n.id, 's'), chimney: n.words > 900,
      roof: unit(n.id, 'rf') > 0.7, ref: noteRef(n),
      /* The valley's own biome: brick, and a FLAT parapet roof where it has a
         roof at all. A works has flat roofs; a pitched tile roof on a machine
         hall is a house that got big. */
      palette: 'brick', roofType: 'flat',
    }));
    posOf.set(n.id, { x, y: rec.y, z });
    /* A SHED beside every second works — a low lean-to against its long side.
       One extra box per factory is what stops a block of eight from being eight
       rectangles at eight heights: a yard with something in it reads as a yard. */
    if (unit(n.id, 'shed') > 0.5) {
      const sa = rec.rot + Math.PI / 2;
      place(structure('factory', x + Math.cos(sa) * (rec.w * 0.5 + 2.0),
                                 z + Math.sin(sa) * (rec.w * 0.5 + 2.0), {
        w: 3.4, d: rec.d * 0.7, h: 2.4, rot: rec.rot,
        seed: unit(n.id, 'ss'), lit: rec.lit, ref: noteRef(n),
        palette: 'brick', roofType: 'gable', roof: true,
      }));
    }
  });
  /* The rail sidings: one line down each row gap, terrain-following. Real in the
     sense that matters here — there is one per row of dev logs, not a decorative
     count. */
  for (let row = 0; row <= BLOCK_ROWS * 2; row++) {
    const z = REGIONS.devlogs.z + (row - BLOCK_ROWS) * PITCH_Z - PITCH_Z / 2;
    out.roadPts.push({ kind: 'rail', pts: sampleLine(
      REGIONS.devlogs.x - BLOCK_COLS * PITCH_X - 20, z,
      REGIONS.devlogs.x + BLOCK_COLS * PITCH_X + 20, z, 12) });
  }

  /* -------------------------------------------------------------------------
     THE HARBOUR CITY — the vault's Projects notes are its civic buildings, and
     each project town from /api/world is a quarter of it. They share one
     coastline because they are the same thing seen from two sides: the note is
     what Beri wrote about the project, the town is what Claude did in it.
     ---------------------------------------------------------------------- */
  const projects = inFolder('Projects').sort((a, b) => b.inlinks - a.inlinks);
  projects.forEach((n, i) => {
    const a = i * GOLDEN + unit(n.id, 'a');
    const r = 12 + Math.sqrt(i + 1) * 13;
    const anchor = [REGIONS.harbour.x - 52, REGIONS.harbour.z - 55];
    const off = awayFromRiver(anchor[0] + Math.cos(a) * r * 0.85, REGIONS.harbour.z + Math.sin(a) * r);
    const dry = toLand(off[0], off[1], anchor[0], anchor[1]);
    if (!dry) return;
    const [x, z] = dry;
    const foot = wordsToFoot(n.words);
    /* The CIVIC half of the harbour is 62 buildings and it sits in the middle of
       the waterfront, so leaving it on one palette and one roof leaves the
       centre of the town looking exactly as stamped as the quarters used to.
       Same rule as the houses, off the NOTE's id instead of the town's: the
       coastal palette, all three roofs, a chimney on some. */
    const chv = hash32(n.id + '#civic');
    const rec = place(structure('civic', x, z, {
      w: foot * 1.5, d: foot * 1.5, h: wordsToHeight(n.words) * 1.25,
      rot: a, lit: freshness(n.modified), seed: unit(n.id, 's'), roof: true, ref: noteRef(n),
      palette: COASTAL_PALETTES[chv % COASTAL_PALETTES.length],
      roofType: ROOF_TYPES[(chv >>> 3) % ROOF_TYPES.length],
      chimney: ((chv >>> 6) % 3) === 0,
    }));
    posOf.set(n.id, { x, y: rec.y, z });
    /* The top hub — 125 inlinks — is the crossroads, and it gets the clock
       tower. It is the one building on this map that earns a landmark by having
       more roads meeting at it than anything else. */
    if (i === 0) {
      out.landmarks.push({ model: 'tower', x, y: rec.y, z, rot: a, scale: 5.2,
                           material: 'stone', clock: true, ref: noteRef(n) });
      REGIONS.crossroads = { x, z, label: n.title };
    }
  });

  /* The quarters: towns packed along the shore, biggest nearest the water so the
     busiest project fronts the harbour. */
  /* A harbour city is a STRIP along the water, not a disc around a point. Laid
     out as a disc the 125 quarters spread 200 units in every direction, swallowed
     the Daily river and buried its bridges inside a housing estate — the search
     flew to a date and arrived in somebody's back yard. Now each quarter is
     given a place on the shore (rows of 25, ordered by how much work has
     happened there, so the busiest project fronts the water) and the coastline
     is found per row by walking inland until the ground is above the tide. */
  const sorted = towns.slice().sort((a, b) => b.tool_calls - a.tool_calls);
  const ROWS = 4, PER_ROW = Math.ceil(sorted.length / ROWS);
  /* SIX DISTRICTS, not one continuous ribbon of quarters.

     A hundred quarters evenly spread over 570 m of shore is a hundred quarters:
     the harbour capture read as one uniform mass because there was no seam
     anywhere in it for the eye to rest on. Real coastal towns come in clumps
     with a gap between them, and the gap is what makes each clump a place. The
     shore is cut into six blocks with a 16 m lane between consecutive blocks —
     the lane is EMPTY ground, wide enough that the forest grid below fills it
     with trees, which is what turns a gap into a green edge rather than a
     stripe of bare grass. Six, not three (too coarse to see) and not twelve
     (each block down to two quarters, which is the uniform ribbon again with
     holes in it). */
  const DISTRICTS = 6, DISTRICT_LANE = 16;
  const perDistrict = Math.ceil(PER_ROW / DISTRICTS);
  const shoreUsable = 570 - (DISTRICTS - 1) * DISTRICT_LANE;
  const districtSpan = shoreUsable / DISTRICTS;
  sorted.forEach((t, i) => {
    const row = Math.floor(i / PER_ROW), k = i % PER_ROW;
    const dist = Math.floor(k / perDistrict), kIn = k % perDistrict;
    /* 570 metres of shoreline, not 430. Thirty-six quarters over 430 m is one
       every twelve metres, and a quarter's own houses already reached almost
       thirteen metres out — so every town's buildings stood inside its
       neighbours' and the whole harbour read as one undifferentiated field of
       roofs. That was survivable while every quarter was anonymous. It is not
       survivable now that a quarter has to be recognisable AS a music school.
       Sixteen metres of frontage each is what the landmark grammar needs, and
       the coast is long enough to give it: at z = +/-285 the ground is still
       well inside the island's own falloff. */
    const z = -285 + dist * (districtSpan + DISTRICT_LANE)
                   + (kIn / Math.max(1, perDistrict - 1)) * districtSpan
                   + (unit(t.id, 'z') - 0.5) * 6;
    let coastX = 250;
    while (coastX > -140 && heightAt(coastX, z) < 4) coastX -= 4;
    let x = coastX - 14 - row * 27 + (unit(t.id, 'x') - 0.5) * 10;
    /* The river gets a bank of its own. Without this the innermost row of the
       harbour built straight over the Daily bridges and a date search landed the
       camera inside somebody's roof. */
    while (x > coastX - 130 && distToRiver(x, z) < 32) x += 5;
    const dry = toLand(x, z, coastX - 110, z);
    if (!dry) return;
    const [qx, qz] = dry;
    const a = Math.atan2(qz - REGIONS.harbour.z, qx - REGIONS.harbour.x);
    const y = landAt(qx, qz);
    const x_ = qx, z_ = qz;
    const q = { id: t.id, town: t, x: x_, y, z: z_, radius: 4 + Math.sqrt(t.tool_calls) / 22,
                blocks: [], cranes: [] };
    /* A town that knows its own trade gets a LANDMARK instead of one more
       anonymous box, and world.js builds that landmark's shape from the
       schema.org type the server read off the project's own files. The plan's
       job is only to reserve the ground for it: the quarter's own houses start
       outside the landmark's yard, or the first six of them stand inside the
       concert hall. LM_YARD is the radius world.js builds inside, and the two
       numbers have to agree — it is stated here because this is the file that
       owns where things stand. */
    q.trade = (t.trade && t.trade.type) || null;
    /* Buildings per quarter from tool calls, log again: 25,846 calls against 1
       is four orders of magnitude, and a linear count would make 124 of the 125
       quarters a single hut. A town whose trade the server RECOGNISED gets none
       of them: world.js builds it as its trade instead, with one wing per page
       of its own site. The first attempt kept the houses and pushed them out
       around the landmark, and the harbour capture showed exactly what that
       does — a concert hall buried under fourteen hip roofs, invisible from any
       distance. A quarter is either a heap of anonymous houses or it is a
       building that says what the project is; it cannot be both in twelve
       metres of shoreline. */
    /* THE CAP: `ceil(log2(calls + 1)) + 2`, floored at 3 and ceilinged at 14,
       applied as a genuine CAP over the count this quarter would otherwise get.

       Applied as a REPLACEMENT formula it is not a cap at all — measured against
       the 107 real generic quarters on this machine it gives 732 houses where
       the old curve gives 569, which is the opposite of "so a hundred quarters
       do not become a wall". As a cap it gives 575 over the same towns, and the
       towns it bites are the busy ones that were pushing fourteen houses into
       sixteen metres of frontage. log2 is the right shape for the ceiling
       because doubling the work in a project may add exactly one house, and
       that is a rule a viewer can read off a roofline. */
    const houseCap = Math.max(3, Math.min(14, Math.ceil(Math.log2(Math.max(1, t.tool_calls) + 1)) + 2));
    const n = q.trade ? 0
            : Math.max(3, Math.min(houseCap,
                Math.round(2 + Math.min(1, Math.log10(Math.max(1, t.tool_calls)) / 4.6) * 12)));
    /* A GRID, not a phyllotaxis spiral. Fourteen houses on a golden spiral all
       face different ways and leave no straight gap anywhere, which is exactly
       the undifferentiated field of roofs the harbour capture showed. Three
       columns along the waterfront and as many rows inland as the count needs,
       every house turned within +/-6 degrees of the same heading, leaves a
       readable lane between every pair of rows — and the lanes of neighbouring
       quarters line up, so the district reads as streets.
       COLS 3 at 5.0 m spans 14.6 m of the ~15.8 m frontage each quarter has;
       the row pitch of 5.4 keeps a 14-house quarter inside the 27 m between
       one row of quarters and the next. */
    const { COLS, COL_PITCH, ROW_PITCH } = HOUSE_GRID;
    const nRows = Math.ceil(n / COLS);
    for (let k = 0; k < n; k++) {
      /* One hash per house carries every categorical choice, so the same town
         renders the same street on every machine and after every reload. */
      const hv = hash32(t.id + '#house' + k);
      const col = k % COLS, rw = Math.floor(k / COLS);
      const bx = x_ + (rw - (nRows - 1) / 2) * ROW_PITCH + (unit(t.id, 'jx' + k) - 0.5) * 1.0;
      const bz = z_ + (col - (COLS - 1) / 2) * COL_PITCH + (unit(t.id, 'jz' + k) - 0.5) * 1.0;
      if (heightAt(bx, bz) < SEA + 1.2) continue;         // no house on the water
      /* Whole floors of 2.9 m, 1 to 4. The wall shader draws its cornice at
         3.1 m and its window rows on a 1.5 m rhythm, so a height that is not a
         whole number of floors cuts the top row of windows in half — which is
         what a facade drawn in metres will always do to a height picked as a
         continuous number. */
      const floors = Math.max(1, Math.min(4, 1 + Math.floor(
        unit(t.id, 'h' + k) * 1.9 + Math.log10(Math.max(1, t.edits)) * 0.6)));
      const rec = place(structure('house', bx, bz, {
        w: 3.0 + unit(t.id, 'w' + k) * 1.5, d: 2.8 + unit(t.id, 'd' + k) * 1.2,
        /* 2.45 m a floor, so one to four floors is 2.45 to 9.8 m — the range
           these houses already stood in. The floor count is what changed, not
           the skyline: a height picked as a continuous number cuts the top row
           of windows in half, because the shader draws them on a 1.5 m rhythm
           in real metres. */
        h: 2.45 * floors,
        /* +/-6 degrees off the quarter's own heading. Enough that no two roof
           ridges are parallel to the pixel, not enough to close the lanes. */
        rot: (hv / 4294967295 - 0.5) * 0.209,
        lit: t.is_live ? 1 : 0, seed: unit(t.id, 's' + k),
        roof: true, ref: townRef(t),
        /* THE FOUR CHOICES a viewer can actually see, all off the one hash.
           The harbour is a COAST, so its palette is whitewash-led with ochre
           plaster and the odd brick house — never the dark timber that belongs
           to the People village up the hill. */
        palette: COASTAL_PALETTES[hv % COASTAL_PALETTES.length],
        roofType: ROOF_TYPES[(hv >>> 3) % ROOF_TYPES.length],
        /* One house in three, not one in two: at a half the first capture came
           back with a forest of stacks over the harbour and the chimneys, not
           the roofs, were what the district read as. */
        chimney: floors > 1 && ((hv >>> 6) % 3) === 0,
      }));
      q.blocks.push(rec);
    }
    /* GARDENS. Two trees on the inland corner of every generic quarter, in the
       ground the grid above does not use. Without them the lanes between rows
       are bare grass and the district reads as a parking layout; with them the
       gaps read as back yards, which is what they are. Pushed straight into the
       forest list — the rejection pass further down only filters the trees IT
       samples, so these survive standing exactly where they were asked for. */
    if (!q.trade) {
      for (let g = 0; g < 2; g++) {
        const gx = x_ - (nRows / 2 + 0.9) * ROW_PITCH;
        const gz = z_ + (g - 0.5) * COL_PITCH * 2.1;
        if (heightAt(gx, gz) < SEA + 1.6) continue;
        out.forest.push({ x: gx, y: landAt(gx, gz), z: gz,
                          rot: unit(t.id, 'g' + g) * 6.283,
                          scale: 1.6 + unit(t.id, 'gs' + g) * 1.1 });
      }
    }
    /* One crane per open item in that project's own HANDOFF, capped at six —
       the rest is a "+n" in the caption, never an invented crane. */
    for (let c = 0; c < Math.min(6, t.open_items.length); c++) {
      const ka = c * 1.9 + unit(t.id, 'c');
      q.cranes.push({ x: x_ + Math.cos(ka) * (q.radius + 1.6),
                      z: z_ + Math.sin(ka) * (q.radius + 1.6),
                      y, h: 5 + unit(t.id, 'ch' + c) * 3, phase: ka });
    }
    out.quarters.push(q);
    byId.set(t.id, { kind: 'quarter', x: x_, z: z_, y, ref: townRef(t) });
    /* A market stall per quarter that has ever finished anything: the stall is
       the human scale next to the houses, and its count is the sessions. */
    if (t.sessions >= 3) {
      out.landmarks.push({ model: 'stall', x: x_ + 2.2, y, z: z_ + 2.2,
                           rot: a + 1.1, scale: 1.5, ref: townRef(t) });
    }
    /* Boats: one per live session, moored off its own quarter. */
    if (t.is_live && t.live_session) {
      /* Moored off its own quarter: out past the waterline, not on the lawn. */
      let bx = x_ + 10;
      while (bx < 260 && heightAt(bx, z_) > SEA - 1.5) bx += 4;
      const bz = z_ + 6;
      out.landmarks.push({ model: 'boat', x: bx, y: SEA - 0.4, z: bz, rot: 0.4,
                           scale: 2.0, floats: true, ref: townRef(t) });
    }
  });

  /* -------------------------------------------------------------------------
     DAILY — one bridge per daily note, in date order, from the mountain end of
     the river to the sea. A day's address is its bridge; walking downstream is
     walking forward in time.
     ---------------------------------------------------------------------- */
  const daily = inFolder('Daily').sort((a, b) => a.id.localeCompare(b.id));
  daily.forEach((n, i) => {
    /* 0.05 to 0.64, not the whole river. Past 0.65 the bed drops under the sea
       — that stretch is the estuary, open water — and bridges placed there stood
       in the ocean off the harbour, which the first harbour capture showed as a
       row of stone piers marching out to sea. */
    const t = 0.05 + (i / Math.max(1, daily.length - 1)) * 0.59;
    const p = riverAt(t);
    const y = Math.max(SEA + 1.6, heightAt(p.x, p.z) + 3.4);   // clear of the water it crosses
    out.bridges.push({ x: p.x, y, z: p.z, rot: p.angle, scale: 2.2 + Math.log10(Math.max(10, n.words)) * 0.5,
                       date: n.title, ref: noteRef(n) });
    posOf.set(n.id, { x: p.x, y, z: p.z });
    byId.set(n.id, { kind: 'bridge', x: p.x, z: p.z, y, ref: noteRef(n) });
  });

  /* -------------------------------------------------------------------------
     PEOPLE — a hill village. One house per person, a porch light each, and a
     path from every door back to the village green.
     ---------------------------------------------------------------------- */
  const people = inFolder('People');
  people.forEach((n, i) => {
    const a = i * GOLDEN + unit(n.id, 'a');
    const r = 8 + Math.sqrt(i + 1) * 7.5;
    const dry = toLand(REGIONS.people.x + Math.cos(a) * r, REGIONS.people.z + Math.sin(a) * r,
                       REGIONS.people.x, REGIONS.people.z);
    if (!dry) return;
    const [x, z] = dry;
    /* The village follows its own biome, not the coast's: small DARK TIMBER
       cottages under gable roofs, every one with a chimney and a porch lamp.
       That is one silhouette and one colour for the whole hill, which is what
       makes it read as a village rather than as more harbour. */
    const rec = place(structure('cottage', x, z, {
      w: 3.0, d: 2.6, h: 2.6 + Math.log10(Math.max(10, n.words)) * 0.5,
      rot: a + Math.PI, lit: 1, porch: true, roof: true,
      seed: unit(n.id, 's'), ref: noteRef(n),
      palette: 'timber', roofType: 'gable', chimney: true, porchLamp: true,
    }));
    posOf.set(n.id, { x, y: rec.y, z });
    out.roadPts.push({ kind: 'path', pts: sampleLine(x, z, REGIONS.people.x, REGIONS.people.z, 8) });
  });

  /* -------------------------------------------------------------------------
     BOARDS — the fortress. A square wall with a courtyard, four corner towers,
     and one crane per open card on Boards/Engineering. 193 cards is more cranes
     than a wall can hold; 24 stand and the caption carries the rest.
     ---------------------------------------------------------------------- */
  const board = inFolder('Boards')[0];
  if (board) {
    const B = REGIONS.boards, SIDE = 30;
    const by = landAt(B.x, B.z);
    for (let s = 0; s < 4; s++) {
      for (let k = 0; k < 7; k++) {
        const f = (k + 0.5) / 7 - 0.5;
        const along = f * SIDE * 2;
        const [x, z] = s === 0 ? [B.x + along, B.z - SIDE] : s === 1 ? [B.x + SIDE, B.z + along]
                     : s === 2 ? [B.x + along, B.z + SIDE] : [B.x - SIDE, B.z + along];
        place(structure('wall', x, z, {
          w: SIDE * 2 / 7 + 0.4, d: 3.2, h: 7.5, rot: s % 2 ? Math.PI / 2 : 0,
          y: by, seed: unit(board.id, 'w' + s + k), ref: noteRef(board),
          /* THE ONE FLAG that tells the two kinds of `wall` apart. These 28 are
             the fortress's own curtain — a block a person could stand in, and
             what world.js builds out of the building kit. The other 140 `wall`
             records are the Knowledge mountain's RETAINING walls, which hold a
             terrace up and are not buildings at any distance. Without this
             they are one `kind` and the kit would grow doors and windows on
             the side of a mountain. */
          fortress: true,
        }));
      }
    }
    for (const [cx, cz] of [[-SIDE, -SIDE], [SIDE, -SIDE], [SIDE, SIDE], [-SIDE, SIDE]]) {
      out.landmarks.push({ model: 'tower', x: B.x + cx, y: by, z: B.z + cz,
                           rot: Math.atan2(cz, cx), scale: 4.4, material: 'stone',
                           ref: noteRef(board) });
    }
    const openCards = board.tasks_open || 0;
    out.boardsOpen = openCards;
    out.boardsCranes = [];
    for (let k = 0; k < Math.min(24, openCards); k++) {
      const a = (k / 24) * Math.PI * 2;
      out.boardsCranes.push({ x: B.x + Math.cos(a) * (SIDE - 2), z: B.z + Math.sin(a) * (SIDE - 2),
                              y: by + 7.5, h: 5 + unit(board.id, 'c' + k) * 4, phase: a });
    }
    byId.set(board.id, { kind: 'fortress', x: B.x, z: B.z, y: by, ref: noteRef(board) });
    posOf.set(board.id, { x: B.x, y: by, z: B.z });
  }

  /* -------------------------------------------------------------------------
     IDEAS — three islands, a lighthouse each. Three ideas, three lights out at
     sea: unbuilt, visible from the shore.
     ---------------------------------------------------------------------- */
  const ideas = inFolder('Ideas');
  ideas.forEach((n, i) => {
    const is = ISLANDS[i % ISLANDS.length];
    const y = landAt(is.x, is.z);
    out.landmarks.push({ model: 'tower', x: is.x, y, z: is.z, rot: unit(n.id, 'a') * 6.28,
                         scale: 4.0, material: 'plaster', beacon: true, ref: noteRef(n) });
    posOf.set(n.id, { x: is.x, y, z: is.z });
    byId.set(n.id, { kind: 'lighthouse', x: is.x, z: is.z, y, ref: noteRef(n) });
  });

  /* -------------------------------------------------------------------------
     TEMPLATES — a quarry. Cut steps into the hillside, no roofs: a template is
     material, not a building.
     ---------------------------------------------------------------------- */
  inFolder('Templates').concat(inFolder('Tasks')).forEach((n, i) => {
    const x = REGIONS.templates.x + (i % 3) * 11 - 11;
    const z = REGIONS.templates.z + Math.floor(i / 3) * 12 - 12;
    const rec = place(structure('quarry', x, z, {
      w: 9, d: 9, h: 2.2 + (i % 3) * 1.4, rot: 0, seed: unit(n.id, 's'), ref: noteRef(n),
    }));
    posOf.set(n.id, { x, y: rec.y, z });
  });

  /* -------------------------------------------------------------------------
     ORPHANS — ruins on the steppe at the map edge. Thirteen notes nothing links
     to and nothing links out of; they are on the map because they exist, and
     they are out there because nothing connects them to anything.
     ---------------------------------------------------------------------- */
  const orphans = notes.filter(n => n.orphan);
  orphans.forEach((n, i) => {
    const a = i * GOLDEN;
    const r = 10 + Math.sqrt(i + 1) * 11;
    const dry = toLand(REGIONS.orphans.x + Math.cos(a) * r, REGIONS.orphans.z + Math.sin(a) * r,
                       REGIONS.orphans.x, REGIONS.orphans.z);
    if (!dry) return;
    const [x, z] = dry;
    const rec = place(structure('ruin', x, z, {
      w: 3.4, d: 3.0, h: 1.4 + unit(n.id, 'h') * 2.6, rot: a,
      seed: unit(n.id, 's'), ref: noteRef(n),
    }));
    posOf.set(n.id, { x, y: rec.y, z });
  });

  /* -------------------------------------------------------------------------
     THE OLD TOWN — the root notes (Home, log, _CLAUDE) at the river mouth,
     where the river reaches the sea. The oldest addresses in the vault sit at
     the oldest address on the map.
     ---------------------------------------------------------------------- */
  inFolder('').forEach((n, i) => {
    const a = i * 2.1;
    const x = REGIONS.oldtown.x + Math.cos(a) * 9;
    const z = REGIONS.oldtown.z + Math.sin(a) * 9;
    const rec = place(structure('civic', x, z, {
      w: 4.5, d: 4.0, h: wordsToHeight(n.words) * 1.1, rot: a, roof: true,
      lit: freshness(n.modified), seed: unit(n.id, 's'), ref: noteRef(n),
    }));
    posOf.set(n.id, { x, y: rec.y, z });
  });

  /* -------------------------------------------------------------------------
     ROADS — the links, and the one place this file draws less than the data has.

     3,518 links drawn as 3,518 lines is a ball of wool: measured, twice. The
     first attempt bent every link towards its own region's centre, which put a
     starburst on the mountain; the second bent cross-region links through the
     region-pair midpoint, which still left every one of them starting at its own
     note and fanning down the slope.

     What is drawn instead is what a road network actually is:
       · a LOCAL road for every link between two structures within 62 units of
         each other — the lane between neighbours;
       · one TRUNK road per pair of regions that has any links at all, as wide as
         the number of links it carries — so the Knowledge-to-Projects road is a
         highway and the People-to-Templates road is a track.
     Nothing is invented and no link is dropped: every one is either a road on
     the ground or a measured strand of a trunk road, and both counts are
     reported by window.__links().
     ---------------------------------------------------------------------- */
  const regionOf = (id) => {
    const f = id.includes('/') ? id.slice(0, id.indexOf('/')) : '';
    return f === 'Knowledge' ? REGIONS.knowledge : f === 'Dev Logs' || f === 'Debugging' ? REGIONS.devlogs
         : f === 'Projects' ? REGIONS.harbour : f === 'Daily' ? REGIONS.daily
         : f === 'People' ? REGIONS.people : f === 'Boards' ? REGIONS.boards
         : f === 'Ideas' ? REGIONS.ideas : f === 'Templates' ? REGIONS.templates
         : REGIONS.oldtown;
  };
  const trunk = new Map();
  for (const l of vault.links) {
    const a = posOf.get(l.from), b = posOf.get(l.to);
    if (!a || !b) continue;
    const ra = regionOf(l.from), rb = regionOf(l.to);
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    if (span <= 62) {
      const pts = sampleLine(a.x, a.z, b.x, b.z, 5);
      if (pts.length > 1) { out.roadPts.push({ kind: 'road', pts }); out.roadsDrawn++; continue; }
    }
    if (ra === rb) { out.linksBundled++; continue; }
    const key = ra.label < rb.label ? ra.label + '|' + rb.label : rb.label + '|' + ra.label;
    const t = trunk.get(key) || { a: ra, b: rb, n: 0 };
    t.n++;
    trunk.set(key, t);
    out.linksBundled++;
  }
  for (const t of trunk.values()) {
    /* The trunk bows away from the straight line so two trunks sharing an end do
       not lie on top of each other, and so a road looks like it went round
       something rather than being ruled with a straightedge. */
    const mx = (t.a.x + t.b.x) / 2, mz = (t.a.z + t.b.z) / 2;
    const nx = -(t.b.z - t.a.z), nz = (t.b.x - t.a.x);
    const len = Math.hypot(nx, nz) || 1;
    const bow = 0.09;
    const pts = sampleQuad(t.a.x, t.a.z, mx + nx / len * len * bow, mz + nz / len * len * bow,
                           t.b.x, t.b.z, 16);
    if (pts.length > 2) out.roadPts.push({ kind: 'trunk', pts, weight: t.n });
  }
  out.trunkRoads = trunk.size;

  /* -------------------------------------------------------------------------
     FOREST — instanced trees on land nothing else is using. Sampled on a jittered
     grid, rejected near any structure, on any steep face, above the tree line,
     and in the sea.
     ---------------------------------------------------------------------- */
  const occupied = [];
  for (const s of out.structures) occupied.push([s.x, s.z, Math.max(s.w, s.d) * 1.5 + 4]);
  for (const q of out.quarters) occupied.push([q.x, q.z, q.radius + 8]);
  const STEP = 8;
  for (let x = -HALF + 26; x < HALF - 26; x += STEP) {
    for (let z = -HALF + 26; z < HALF - 26; z += STEP) {
      const jx = x + (unit(`${x}`, `${z}`) - 0.5) * STEP * 0.9;
      const jz = z + (unit(`${z}`, `${x}`) - 0.5) * STEP * 0.9;
      const h = heightAt(jx, jz);
      if (h < SEA + 1.8 || h > 96) continue;                   // sea, and the tree line
      if (slopeAt(jx, jz) > 0.62) continue;                    // sheer cliffs stay bare
      /* Woods have to CLUMP. An even dusting of trees over the whole map reads
         as texture; stands with clearings between them read as forest. Two long
         wavelengths against a per-cell hash is the cheapest thing that does it. */
      const clump = 0.94 + 0.34 * Math.sin(jx / 155 + 1.7) * Math.cos(jz / 128 - 0.6)
                         + 0.16 * Math.sin(jz / 61) * Math.sin(jx / 74);
      if (unit(`${jx | 0}`, `f${jz | 0}`) > clump) continue;
      let blocked = false;
      for (const [ox, oz, orad] of occupied) {
        if ((jx - ox) * (jx - ox) + (jz - oz) * (jz - oz) < orad * orad) { blocked = true; break; }
      }
      if (blocked) continue;
      out.forest.push({ x: jx, y: landAt(jx, jz), z: jz,
                        rot: unit(`${jx | 0}`, `r${jz | 0}`) * 6.283,
                        scale: 1.5 + unit(`${jz | 0}`, `s${jx | 0}`) * 1.5 });
    }
  }

  out.index = byId;
  out.notePos = posOf;
  return out;
}


/* =============================================================================
   HELPERS
   ========================================================================== */
function noteRef(n) {
  return { type: 'note', id: n.id, title: n.title, folder: n.folder,
           words: n.words, modified: n.modified, inlinks: n.inlinks, tags: n.tags };
}
function townRef(t) {
  return { type: 'town', id: t.id, title: t.name, town: t };
}

/* A straight line sampled onto the terrain. Roads follow the ground; a road
   that cuts through a hill is the thing that gives a 3D map away. */
function sampleLine(x0, z0, x1, z1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    pts.push([x, landAt(x, z) + 0.12, z]);
  }
  return pts;
}

/* A quadratic bend, sampled onto the terrain — the bundled link road. */
function sampleQuad(x0, z0, cx, cz, x1, z1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, k = 1 - t;
    const x = k * k * x0 + 2 * k * t * cx + t * t * x1;
    const z = k * k * z0 + 2 * k * t * cz + t * t * z1;
    /* A bundled road can bend out over the water. landAt() would float it on the
       sea surface, which is the single most obviously fake thing this file could
       draw, so the road stops at the shore instead. */
    if (heightAt(x, z) < SEA + 0.8) return pts.length > 1 ? pts : [];
    pts.push([x, landAt(x, z) + 0.12, z]);
  }
  return pts;
}

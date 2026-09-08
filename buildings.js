/* =============================================================================
   buildings.js — a detailed procedural building generator
   =============================================================================

   WHY THIS FILE EXISTS
   The world already draws buildings: unit boxes with a facade shader painted on
   them. From six hundred metres that is honest. From ten it is a box with a
   picture of windows on it, and the owner's bar for this pass is the opposite —
   "real details on every structure so it looks as real as possible", measured as
   at least twelve DISTINCT detail elements readable from 10 m, each carrying a
   real PBR material rather than a flat colour.

   So this file builds geometry, not decals. A window here is a reveal in the
   wall, a frame, a mullion, glass, a stone sill that sticks out and casts a
   line, a lintel over it, shutters beside it and a dirt streak under it. That is
   eight elements from one window, and the grammar below stacks about twenty per
   building.

   HOW IT IS ORGANISED
     1. RNG + small maths            — everything is deterministic from `seed`
     2. PALETTES and STYLES          — the grammar tables; this is the "design"
     3. Builder                      — a matrix stack that accumulates geometry
                                       into one bucket per material, so a whole
                                       building merges down to ~8 draw calls
     4. Detail parts                 — window, door, roof, gutter, chimney, …
     5. BuildingKit                  — the public API: load / make / instanced /
                                       setNight / lodFor
     6. LOD bake                     — render-to-texture once per style+palette,
                                       so LOD1 and LOD2 are boxes wearing a
                                       photograph of the real thing

   WHAT IT DELIBERATELY DOES NOT DO
   No CSG, no boolean cuts. Openings are left by building the wall AROUND them
   (piers, spandrels, bands) which is how a real facade is laid out anyway and
   gives correct reveals for free.

   Materials come from assets/manifest.json — the same CC0 pack world.js uses,
   read through the same manifest, at the same metres-per-tile. Nothing here is
   an untextured colour: even "painted timber" is the plaster normal at a small
   tile under a strong tint, because a flat lambert plank is the single loudest
   tell that a scene was generated.
   ========================================================================== */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


/* =============================================================================
   1. RNG AND SMALL MATHS
   Deterministic from a seed, because `make({seed})` promises the same building
   twice and because a street that reshuffles itself on reload cannot be
   screenshot-compared.
   ========================================================================== */

/** mulberry32 — 32-bit, seedable, good enough for placement decisions. */
function rngFrom(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
/** Value hash in [0,1) from two floats — used for per-position grime, so the
    weathering pattern is a property of the wall and not of the draw order. */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smoothed value noise built on the same hash — one octave, bilinear, with a
    smoothstep on the interpolant. WHY: `hash2` alone is per-cell static, which
    gives a wall salt-and-pepper grain but no BLOTCHES. What a real render has
    that this file did not is low-frequency variation at three to six metres —
    damp, sun-bleach, an old repair — so every surface tint below is multiplied
    by this at a metre scale, not a texel one. */
function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), sx),
              lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), sx), sy);
}

/** Shift a palette colour by ±`hueDeg` degrees and ±`valPct` of its value.
    WHY: five palettes over a street of forty buildings means eight buildings
    wearing the exact same cream, and identical albedo across a row is the tell
    that says "instanced" louder than any repeated window. Every building
    re-rolls its own wall, stone and roof colour from its seed. */
const _jc = new THREE.Color();
function jitterHex(hex, hueDeg, valPct) {
  _jc.setHex(hex);
  const hsl = _jc.getHSL({ h: 0, s: 0, l: 0 });
  _jc.setHSL((hsl.h + hueDeg / 360 + 1) % 1, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + valPct), 0.02, 0.98));
  return _jc.getHex();
}
/** Multiply a colour's value without touching its hue — used per roof course. */
function shadeHex(hex, k) {
  _jc.setHex(hex);
  const hsl = _jc.getHSL({ h: 0, s: 0, l: 0 });
  _jc.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * k, 0.02, 0.98));
  return _jc.getHex();
}


/* =============================================================================
   2. THE GRAMMAR TABLES
   Everything that makes one style look unlike another lives here as data, so a
   new style is a table row and not a new code path. `docs/BUILDINGS.md` prints
   this same table for a human.
   ========================================================================== */

/* A palette is the wall surface plus the three colours that read as "this
   building was painted by someone": the wall tint, the joinery (frames, doors,
   shutters) and the roof. Real streets are not monochrome and they are not a
   rainbow either — five palettes is the width a European street actually has. */
const PALETTES = {
  plaster:   { surface: 'plaster', wall: 0xd9cdb6, trim: 0x4b5a4e, roof: 0xc08a6c, stone: 0xc6c7c0 },
  brick:     { surface: 'brick',   wall: 0xa8705a, trim: 0x36302b, roof: 0xa5705a, stone: 0xb2b3ae },
  timber:    { surface: 'plaster', wall: 0xc9a878, trim: 0x53341f, roof: 0xac8877, stone: 0xb9b6ab },
  whitewash: { surface: 'plaster', wall: 0xeae4d8, trim: 0x2e3f52, roof: 0xb47764, stone: 0xd4d5cf },
  stone:     { surface: 'brick',   wall: 0x9d968a, trim: 0x3a3a34, roof: 0x968f87, stone: 0xacaea9 },
};

/* One row per style. Read it as: how tall is a floor, how wide is a bay, and
   which of the optional details this style is allowed to grow. The showcase
   page prints the same nine rows. */
const STYLES = {
  townhouse:  { floorH: 3.0, bay: 2.5, roof: 'gable',   sill: 1, shutter: 0.6, balcony: 0.5, sign: 0.25, shop: 0,    utility: 0.4, fence: 0.3, quoin: 0.3, band: 1 },
  cottage:    { floorH: 2.7, bay: 2.8, roof: 'hip',     sill: 1, shutter: 0.9, balcony: 0,   sign: 0,    shop: 0,    utility: 0.2, fence: 0.9, quoin: 0.1, band: 0 },
  apartment:  { floorH: 2.9, bay: 2.4, roof: 'mansard', sill: 1, shutter: 0.2, balcony: 1,   sign: 0,    shop: 0.35, utility: 0.8, fence: 0.1, quoin: 0.2, band: 1 },
  industrial: { floorH: 4.4, bay: 3.4, roof: 'flat',    sill: 0, shutter: 0,   balcony: 0,   sign: 0.9,  shop: 0,    utility: 1,   fence: 0.7, quoin: 0,   band: 0 },
  shop:       { floorH: 3.2, bay: 2.5, roof: 'gable',   sill: 1, shutter: 0.4, balcony: 0.3, sign: 1,    shop: 1,    utility: 0.3, fence: 0,   quoin: 0.2, band: 1 },
  civic:      { floorH: 4.0, bay: 3.0, roof: 'hip',     sill: 1, shutter: 0.1, balcony: 0.2, sign: 0.7,  shop: 0,    utility: 0.2, fence: 0.5, quoin: 0.8, band: 1 },
  barn:       { floorH: 4.8, bay: 3.6, roof: 'gable',   sill: 0, shutter: 0.3, balcony: 0,   sign: 0.2,  shop: 0,    utility: 0.5, fence: 0.8, quoin: 0,   band: 0 },
  church:     { floorH: 6.0, bay: 3.2, roof: 'gable',   sill: 1, shutter: 0,   balcony: 0,   sign: 0,    shop: 0,    utility: 0,   fence: 0.4, quoin: 0.9, band: 0 },
  tower:      { floorH: 3.1, bay: 2.6, roof: 'flat',    sill: 1, shutter: 0.1, balcony: 0.4, sign: 0.2,  shop: 0,    utility: 0.9, fence: 0.1, quoin: 0.3, band: 1 },
};

/* The material buckets. One merged mesh per bucket per building — eight draw
   calls for a building that is made of four hundred boxes. The order matters
   only in that `glass` and `grime` are drawn last. */
const BUCKETS = ['wall', 'stone', 'roof', 'timber', 'metal', 'sign', 'interior', 'lit', 'lit2', 'glass',
                 'grime', 'rust'];
/* The decal buckets: multiplied over whatever they sit on, never shadowed,
   never occluders. Two of them and not one, see `_grimeTexture`. */
const DECAL = new Set(['grime', 'rust']);
/* The impostor room behind the glass. It lives INSIDE the building, so its
   shadow can never be seen and rendering it into the shadow map is pure cost. */
const ROOM = new Set(['interior', 'lit', 'lit2']);

/* The dirt atlas: six cells side by side in ONE row. WHY an atlas at all: with
   a single streak texture every sill on a facade sheds the IDENTICAL stain,
   which is exactly what the first close-up was called out for. Six cells at
   three strengths and two densities, picked by a hash of the opening's own
   position, give a street where no two streaks line up.
   WHY rust and moss are NOT in it: an atlas bleeds across its own cells in the
   lower mips — at mip 5 a 128 px cell is four texels and the filter averages
   its neighbours in — and the first build of this pass put green moss and
   orange rust under front-facade window sills because of exactly that. Six
   cells of the same grey-brown family bleed into each other invisibly; a green
   one does not. Rust and moss therefore get their own textures and their own
   material, at a cost of two draw calls a building. */
const DIRT_CELLS = 6;
const dirtRect = (i) => [i / DIRT_CELLS, 0, (i + 1) / DIRT_CELLS, 1];


/* =============================================================================
   3. THE BUILDER
   A matrix stack plus one geometry array per bucket. Every part function below
   pushes boxes and planes in a LOCAL frame and lets the stack put them where
   they belong, which is what makes "the same window unit on all four facades"
   twenty lines instead of four copies.
   ========================================================================== */

/* Which buckets are SOLID — they block light, so they go into the occupancy
   grid the vertex-AO pass samples, and they are the ones that receive AO.
   Glass, the room impostor and the multiply decals are neither. */
const AO_SOLID = ['wall', 'stone', 'roof', 'timber', 'metal'];

class Builder {
  /** `opts.macro` offsets the macro-noise lookup so two buildings side by side
      do not wear the same stain pattern; `opts.courseH` is the floor height,
      used to darken the mortar line at every floor on a brick wall. */
  constructor(tiles, opts = {}) {
    this.tiles = tiles;                      // metres-per-tile, per bucket
    this.buckets = new Map();
    for (const k of BUCKETS) this.buckets.set(k, []);
    this.stack = [new THREE.Matrix4()];
    this._m = new THREE.Matrix4();
    this.macro = opts.macro || { ox: 0, oz: 0 };
    this.courseH = opts.courseH || 0;
    this.mortar = !!opts.mortar;             // brick / ashlar only
    this.patch = !!opts.patch;               // plaster only — old repairs
    this.solids = [];                        // AABBs for the AO grid
    this.lamps = [];                         // world positions of lit bulbs
  }

  /** Record where a lit bulb ended up, in the building's own frame, so the
      showcase can hang a real point light on it at night without re-deriving
      the door position. */
  markLamp(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.M);
    this.lamps.push([v.x, v.y, v.z]);
  }

  get M() { return this.stack[this.stack.length - 1]; }

  /** Push a child frame: translation then Y rotation, relative to the current. */
  push(x, y, z, ry = 0) {
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    /* setPosition after makeRotationY gives translate*rotate, which is what a
       "stand here, then face this way" frame means. */
    this.stack.push(new THREE.Matrix4().multiplyMatrices(this.M, m));
    return this;
  }
  pop() { this.stack.pop(); return this; }

  /** A box, given by CENTRE. Boxes-by-centre keep the sill maths readable. */
  box(bucket, w, h, d, x, y, z, opts = {}) {
    /* A facade arithmetic slip can ask for a pier of negative width. A negative
       BoxGeometry dimension does not throw — it renders inside out — so it is
       caught here rather than found later as a black hole in a wall. */
    if (!(w > 0) || !(h > 0) || !(d > 0)) return this;
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.rx) g.rotateX(opts.rx);              // about the box's own centre
    if (opts.rz) g.rotateZ(opts.rz);
    g.translate(x, y, z);
    return this._finish(bucket, g, opts);
  }

  /** A cylinder along Y unless `axis` says otherwise — gutters, pipes, poles. */
  cyl(bucket, r, h, x, y, z, opts = {}) {
    const g = new THREE.CylinderGeometry(r, opts.r2 !== undefined ? opts.r2 : r, h, opts.seg || 8, 1);
    if (opts.axis === 'x') g.rotateZ(Math.PI / 2);
    if (opts.axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this._finish(bucket, g, { ...opts, uv: 'quad' });
  }

  /** A flat quad facing +Z in the local frame — glass, grime, sign faces. */
  quad(bucket, w, h, x, y, z, opts = {}) {
    const g = new THREE.PlaneGeometry(w, h);
    if (opts.rx) g.rotateX(opts.rx);
    if (opts.ry) g.rotateY(opts.ry);
    g.translate(x, y, z);
    return this._finish(bucket, g, { ...opts, uv: 'quad' });
  }

  /** Raw geometry already in the local frame (the roof slopes use this). */
  raw(bucket, g, opts = {}) { return this._finish(bucket, g, opts); }

  _finish(bucket, g, opts) {
    g.applyMatrix4(this.M);
    if (opts.uv !== 'quad') this._worldUV(g, this.tiles[bucket] || 2);
    else if (opts.uvRect) this._uvRect(g, opts.uvRect);
    /* Everything solid goes in the occlusion list. A box's AABB is the whole
       box — good enough for a 0.32 m grid, and the reason `bakeAO` costs
       milliseconds rather than seconds. */
    if (AO_SOLID.includes(bucket) && opts.occlude !== false) {
      g.computeBoundingBox();
      this.solids.push(g.boundingBox.clone());
    }
    this._paint(g, opts);
    this.buckets.get(bucket).push(g);
    return this;
  }

  /** Remap a quad's 0..1 UV into one cell of the weathering atlas. */
  _uvRect(g, [u0, v0, u1, v1]) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
    uv.needsUpdate = true;
  }

  /* Box-projected UVs in BUILDING space, not face space. A BoxGeometry's own
     0..1 UV would squeeze a 3 m brick texture onto a 0.09 m window frame; here
     every surface takes the texture at its true metre scale and a merged wall
     reads as one continuous piece of plaster instead of a patchwork. */
  _worldUV(g, tile) {
    const p = g.attributes.position, n = g.attributes.normal;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      let u, v;
      if (nx >= ny && nx >= nz) { u = p.getZ(i); v = p.getY(i); }
      else if (ny >= nz) { u = p.getX(i); v = p.getZ(i); }
      else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  /* Vertex colour = the weathering. Two things happen: the bottom 0.4 m of
     anything darkens toward soot and splash, and a low-frequency hash breaks the
     wall into faintly different patches so a four-storey plaster face is not one
     dead flat tone. `opts.tint` lets a part (a shutter, a door) carry its own
     colour through the SAME merged material, which is how eight buckets can hold
     twenty visually different things. */
  _paint(g, opts) {
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const t = opts.tint !== undefined ? new THREE.Color(opts.tint) : null;
    const weather = opts.weather !== false;
    const ox = this.macro.ox, oz = this.macro.oz;
    let zmax = 0;
    if (opts.moss) { g.computeBoundingBox(); zmax = g.boundingBox.max.z; }
    for (let i = 0; i < p.count; i++) {
      let r = 1, gg = 1, b = 1;
      if (t) { r = t.r; gg = t.g; b = t.b; }
      if (weather) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        /* Splash-back and street dirt: strongest at the pavement, gone by 0.4 m.
           0.62 and not 0.2 — at 0.2 the base reads as a black skirting board.
           The 0.45 m ceiling is now WOBBLED by a metre-scale noise, because a
           dead-level tide mark all the way round a building is the giveaway
           that the dirt is a formula. */
        const top = 0.45 * (0.55 + 0.9 * noise2((x + ox) * 0.55, (z + oz) * 0.55));
        if (y < top) { const k = lerp(0.60, 1.0, Math.max(0, y) / top); r *= k; gg *= k; b *= k; }
        const n = 0.93 + 0.07 * hash2(Math.floor(x * 0.7), Math.floor(y * 0.5));
        r *= n; gg *= n; b *= n;
        /* The macro multiply — the whole point of this pass. 4.2 m across and
           3.4 m up, so one building carries three or four soft patches of
           lighter and darker render rather than one flat tone. */
        const m = lerp(0.90, 1.075, noise2((x + ox) / 4.2, (y + (z + oz) * 0.37) / 3.4))
                * lerp(0.965, 1.035, noise2((x + ox) / 1.3 + 5.5, (y - (z + oz) * 0.18) / 1.1 - 2.2));
        r *= m; gg *= m; b *= m;
        /* Plaster only: the old repair. A sparse, harder-edged second mask —
           where a crack was filled the new render never matches the old. */
        if (this.patch) {
          const q = noise2((x + ox) / 2.3 + 17.3, (y - (z + oz) * 0.21) / 2.9 - 8.1);
          if (q > 0.63) { const s = lerp(1.0, 1.075, (q - 0.63) / 0.37); r *= s; gg *= s; b *= s * 0.985; }
        }
        /* Brick / ashlar only: a darker bed joint at every floor line, which is
           where the wall was actually built in lifts. */
        if (this.mortar && this.courseH) {
          const dy = Math.abs(((y + 0.5) % this.courseH) - 0.5);
          if (dy < 0.07) { const s = lerp(0.80, 1.0, dy / 0.07); r *= s; gg *= s; b *= s; }
        }
      }
      /* Moss, on the north (+Z) face only and only near the ground. Patchy from
         the same metre-scale noise as everything else, so it is a colony and
         not a painted stripe. */
      if (opts.moss && p.getZ(i) > zmax - 0.06) {
        const yy = Math.max(0, p.getY(i));
        const k = Math.max(0, 1 - yy / 0.62) * Math.max(0, noise2((p.getX(i) + ox) * 0.85 + 31.0, (p.getZ(i) + oz) * 0.85) - 0.36) / 0.64;
        r *= 1 - 0.44 * k; gg *= 1 - 0.16 * k; b *= 1 - 0.50 * k;
      }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  /* -------------------------------------------------------------------------
     CONTACT OCCLUSION, baked into the vertex colours.
     WHY not an aoMap: measured 27 -> 41 fps when it was dropped (docs). What
     that texture gave was micro-occlusion inside a 2 m tile, invisible from the
     street. What is MISSING without it is CONTACT dark — inside a window
     reveal, under an eave, under a balcony slab, in the corner where the wall
     meets the roof — and that is geometry-scale, so it can be sampled once at
     build time and costs nothing at all to draw.
     The acceleration structure is a 0.32 m occupancy grid of the building's own
     boxes; 8 hemispheric directions x 4 steps is 32 grid reads a vertex, which
     is a few milliseconds for a whole townhouse.
     ---------------------------------------------------------------------- */
  bakeAO() {
    if (!this.solids.length) return this;
    const CELL = 0.32, PAD = 0.6;
    const bb = new THREE.Box3();
    for (const s of this.solids) bb.union(s);
    bb.expandByScalar(PAD);
    const nx = Math.ceil((bb.max.x - bb.min.x) / CELL);
    const ny = Math.ceil((bb.max.y - bb.min.y) / CELL);
    const nz = Math.ceil((bb.max.z - bb.min.z) / CELL);
    /* A runaway footprint would allocate hundreds of megabytes. Nothing in the
       grammar gets near this, but a caller passing a 200 m barn should lose the
       AO, not the tab. */
    if (nx * ny * nz > 4e6) return this;
    const grid = new Uint8Array(nx * ny * nz);
    const idx = (i, j, k) => (k * ny + j) * nx + i;
    for (const s of this.solids) {
      const i0 = Math.max(0, Math.floor((s.min.x - bb.min.x) / CELL));
      const i1 = Math.min(nx - 1, Math.floor((s.max.x - bb.min.x) / CELL));
      const j0 = Math.max(0, Math.floor((s.min.y - bb.min.y) / CELL));
      const j1 = Math.min(ny - 1, Math.floor((s.max.y - bb.min.y) / CELL));
      const k0 = Math.max(0, Math.floor((s.min.z - bb.min.z) / CELL));
      const k1 = Math.min(nz - 1, Math.floor((s.max.z - bb.min.z) / CELL));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[idx(i, j, k)] = 1;
    }
    /* Eight fixed directions over the hemisphere around the VERTEX NORMAL, not
       around world up. That distinction is the whole pass: a window reveal is a
       vertical face looking sideways into a 1.3 m slot, and a world-up
       hemisphere finds it almost unoccluded — the first build of this AO shaded
       the eaves correctly and left every reveal flat, which is the defect it
       was written to fix. Third component is along the normal, so every sample
       is in front of the surface and the weight is just that component. */
    const DIRS = [];
    for (const d of [[0, 0, 1], [0.72, 0, 0.69], [-0.72, 0, 0.69], [0, 0.72, 0.69], [0, -0.72, 0.69],
                     [0.52, 0.52, 0.68], [-0.52, -0.52, 0.68], [0.52, -0.52, 0.68]]) {
      const L = Math.hypot(d[0], d[1], d[2]); DIRS.push([d[0] / L, d[1] / L, d[2] / L]);
    }
    const STEPS = [0.30, 0.62, 1.10, 1.9], WT = [1.0, 0.66, 0.38, 0.18];
    const hit = (x, y, z) => {
      const i = ((x - bb.min.x) / CELL) | 0, j = ((y - bb.min.y) / CELL) | 0, k = ((z - bb.min.z) / CELL) | 0;
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
      return grid[idx(i, j, k)];
    };
    for (const bucket of AO_SOLID) {
      for (const g of this.buckets.get(bucket)) {
        const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color;
        for (let v = 0; v < p.count; v++) {
          const nxv = n.getX(v), nyv = n.getY(v), nzv = n.getZ(v);
          /* Tangent basis around the normal. The cross with world up degenerates
             on a floor or a ceiling, so fall back to X there. */
          let tx, ty, tz;
          if (Math.abs(nyv) > 0.95) { tx = 1; ty = 0; tz = 0; }
          else { const L = Math.hypot(nzv, nxv) || 1; tx = nzv / L; ty = 0; tz = -nxv / L; }
          const bx = nyv * tz - nzv * ty, by = nzv * tx - nxv * tz, bz = nxv * ty - nyv * tx;
          // start just off the surface, or every sample hits the vertex's own box
          const sx = p.getX(v) + nxv * 0.1, sy = p.getY(v) + nyv * 0.1, sz = p.getZ(v) + nzv * 0.1;
          let occ = 0, tot = 0;
          for (const d of DIRS) {
            const dx = tx * d[0] + bx * d[1] + nxv * d[2];
            const dy = ty * d[0] + by * d[1] + nyv * d[2];
            const dz = tz * d[0] + bz * d[1] + nzv * d[2];
            tot += d[2];
            for (let s = 0; s < STEPS.length; s++) {
              if (hit(sx + dx * STEPS[s], sy + dy * STEPS[s], sz + dz * STEPS[s])) { occ += d[2] * WT[s]; break; }
            }
          }
          /* 0.50 and not 1.0: this multiplies an albedo the sun and the env map
             still light on top, so a full black contact reads as a hole. 0.50 is
             the depth at which a reveal looks recessed and a corner still takes
             light. */
          const ao = tot > 0 ? 1 - 0.50 * Math.min(1, occ / tot) : 1;
          c.setXYZ(v, c.getX(v) * ao, c.getY(v) * ao, c.getZ(v) * ao);
        }
        c.needsUpdate = true;
      }
    }
    return this;
  }

  /** Merge each bucket down to one geometry. Empty buckets vanish. */
  harvest() {
    const out = {};
    for (const [k, list] of this.buckets) {
      if (!list.length) continue;
      out[k] = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
    }
    return out;
  }
}


/* =============================================================================
   4. THE DETAIL PARTS
   Each function below is one nameable thing a person would point at in the
   close-up shot. They are written in a frame where +Z is "out of the wall",
   X runs along the wall and Y is up, so the same code serves all four sides.
   ========================================================================== */

const T_WALL = 0.34;   // wall thickness — this is what gives a window its reveal

/* ---- 4.1 window ---------------------------------------------------------- */
/* Eight elements: reveal (from the wall), frame, mullions, glass, interior
   plane, stone sill, lintel, shutters, and the dirt streak under the sill. */
function partWindow(b, cx, cy, w, h, P, o) {
  const fr = 0.085;                                   // frame section
  const z0 = -0.13;                                   // glass sits INSIDE the reveal
  b.push(cx, cy, 0);
  // frame — four members, so the corners show a real joint at 10 m
  b.box('timber', w, fr, fr, 0, h / 2 - fr / 2, z0, { tint: P.trim });
  b.box('timber', w, fr, fr, 0, -h / 2 + fr / 2, z0, { tint: P.trim });
  b.box('timber', fr, h, fr, -w / 2 + fr / 2, 0, z0, { tint: P.trim });
  b.box('timber', fr, h, fr, w / 2 - fr / 2, 0, z0, { tint: P.trim });
  // mullion + transom: the cross that makes a window read as a window
  b.box('timber', 0.05, h - fr * 2, 0.05, 0, 0, z0, { tint: P.trim });
  b.box('timber', w - fr * 2, 0.05, 0.05, 0, h * 0.16, z0, { tint: P.trim });
  /* Glass, with a per-pane tint. Old glass is not one colour across a facade —
     each pane took its own bath of iron — and the variation is what stops four
     windows in a row reading as one mirrored strip. */
  const iw = w - fr * 2, ih = h - fr * 2;
  const gh1 = hash2(cx * 7.3 + b.macro.ox, cy * 3.1 + b.macro.oz);
  const gh2 = hash2(cy * 11.7 + b.macro.oz + 4.4, cx * 5.9 + b.macro.ox);
  b.quad('glass', iw, ih, 0, 0, z0 - 0.02, {
    tint: jitterHex(0xf2f6ff, (gh1 - 0.5) * 34, (gh2 - 0.5) * 0.30), weather: false,
  });
  /* The room behind it, as a SHALLOW BOX and not a plane. WHY: a single dark
     plane at the back of a reveal has no parallax, so the pane reads as a
     mirror with something painted on it. Five quads — back, two returns, floor,
     ceiling — and moving the head half a metre shows the side wall slide, which
     is the whole difference between "window" and "black rectangle". */
  const room = o.room || 'interior';
  const dz = 0.46;
  b.quad(room, iw, ih, 0, 0, -dz, { weather: false });
  b.quad(room, dz, ih, -iw / 2, 0, -dz / 2 - 0.02, { ry: Math.PI / 2, weather: false });
  b.quad(room, dz, ih, iw / 2, 0, -dz / 2 - 0.02, { ry: -Math.PI / 2, weather: false });
  b.quad(room, iw, dz, 0, -ih / 2, -dz / 2 - 0.02, { rx: -Math.PI / 2, weather: false });
  b.quad(room, iw, dz, 0, ih / 2, -dz / 2 - 0.02, { rx: Math.PI / 2, weather: false });
  /* Blinds or curtains on roughly a third of the panes. Both are built in the
     joinery bucket rather than a new material: the plaster normal at a 0.6 m
     tile already reads as woven cloth, and a tenth draw call per building for
     two hundred buildings is a worse trade than a tint. */
  if (gh1 < 0.30) {
    if (gh2 < 0.5) {
      const drop = ih * (0.30 + gh2 * 0.45);                    // half-lowered
      for (let s = 0; s < 6; s++)
        b.box('timber', iw - 0.03, drop / 7, 0.012, 0, ih / 2 - (s + 0.5) * (drop / 6), z0 - 0.06,
              { tint: 0xd8d2c4, weather: false, occlude: false });
    } else {
      const cw = iw * (0.20 + gh1 * 0.42);
      for (const s of [-1, 1])
        b.box('timber', cw, ih - 0.02, 0.03, s * (iw / 2 - cw / 2), 0, z0 - 0.07,
              { tint: [0x8f4a3c, 0x8b968c, 0xc4b79e][Math.floor(gh1 * 3) % 3], weather: false, occlude: false });
    }
  }
  // stone sill, proud of the wall so it throws a horizontal shadow line
  b.box('stone', w + 0.30, 0.09, 0.22, 0, -h / 2 - 0.055, 0.02, { tint: P.stone });
  // lintel / window head
  b.box('stone', w + 0.24, 0.12, 0.16, 0, h / 2 + 0.07, 0.0, { tint: P.stone });
  /* The dirt the sill sheds down the wall. Cell, WIDTH, LENGTH and lateral
     offset all come off the opening's own world position, so no two streaks on
     a facade are the same shape or the same strength — which is exactly what
     the first close-up was failing on. */
  const cell = Math.floor(gh1 * DIRT_CELLS) % DIRT_CELLS;
  const dw = (w + 0.34) * (0.55 + gh2 * 0.45), dl = 0.55 + gh1 * 0.85;
  b.quad('grime', dw, dl, (gh2 - 0.5) * w * 0.22, -h / 2 - 0.10 - dl / 2, 0.021, { uvRect: dirtRect(cell) });
  if (o.shutter) {
    const sw = w / 2 - 0.02;
    b.box('timber', sw, h - 0.04, 0.05, -w / 2 - sw / 2 - 0.02, 0, 0.055, { tint: o.shutterTint });
    b.box('timber', sw, h - 0.04, 0.05, w / 2 + sw / 2 + 0.02, 0, 0.055, { tint: o.shutterTint });
    // louvre bars — three per leaf is enough to break the flat panel
    for (let i = -1; i <= 1; i++) {
      b.box('timber', sw - 0.06, 0.045, 0.02, -w / 2 - sw / 2 - 0.02, i * h * 0.26, 0.085, { tint: 0x4a4a4a, weather: false });
      b.box('timber', sw - 0.06, 0.045, 0.02, w / 2 + sw / 2 + 0.02, i * h * 0.26, 0.085, { tint: 0x4a4a4a, weather: false });
    }
  }
  b.pop();
}

/* ---- 4.2 door ------------------------------------------------------------ */
/* Frame, leaf with two recessed panels, a handle, a stone step and threshold,
   plus a fanlight over it. */
function partDoor(b, cx, w, h, P, o) {
  const fr = 0.11;
  b.push(cx, 0, 0);
  // surround as jambs + head, so the leaf behind it is still visible
  b.box('stone', 0.17, h + 0.30, 0.16, -w / 2 - 0.085, (h + 0.30) / 2, 0.04, { tint: P.stone });
  b.box('stone', 0.17, h + 0.30, 0.16, w / 2 + 0.085, (h + 0.30) / 2, 0.04, { tint: P.stone });
  b.box('stone', w + 0.34, 0.22, 0.20, 0, h + 0.41, 0.05, { tint: P.stone });
  b.box('timber', w, h, 0.09, 0, h / 2, -0.10, { tint: P.trim });                          // leaf
  // two raised panels — a flat slab reads as a fridge door
  const panel = new THREE.Color(P.trim).multiplyScalar(1.5).getHex();
  b.box('timber', w - 0.26, h * 0.36, 0.03, 0, h * 0.28, -0.05, { tint: panel, weather: false });
  b.box('timber', w - 0.26, h * 0.30, 0.03, 0, h * 0.70, -0.05, { tint: panel, weather: false });
  // handle: a plate and a lever
  b.box('metal', 0.09, 0.20, 0.03, w / 2 - 0.16, h * 0.47, -0.04, { tint: 0xb9a06a, weather: false });
  b.cyl('metal', 0.022, 0.13, w / 2 - 0.16, h * 0.47, 0.02, { axis: 'z', tint: 0xb9a06a, weather: false });
  // fanlight above the door, lit at night like the hall behind it
  b.quad('glass', w - 0.1, 0.36, 0, h + 0.06, -0.12, { tint: 0xeef3ff, weather: false });
  b.quad(o.room || 'interior', w - 0.1, 0.36, 0, h + 0.06, -0.26, { weather: false });
  // step and threshold
  b.box('stone', w + 0.6, 0.16, 0.55, 0, 0.08, 0.30, { tint: P.stone });
  b.box('stone', w + 0.9, 0.16, 0.42, 0, -0.07, 0.52, { tint: P.stone });
  b.pop();
}

/* ---- 4.3 wall lamp ------------------------------------------------------- */
function partLamp(b, x, y, P) {
  b.push(x, y, 0);
  b.box('metal', 0.10, 0.22, 0.06, 0, 0, 0.03, { tint: 0x1d1d1f, weather: false });
  b.cyl('metal', 0.028, 0.34, 0, 0.10, 0.20, { axis: 'z', tint: 0x1d1d1f, weather: false });
  b.cyl('metal', 0.19, 0.20, 0, 0.02, 0.36, { r2: 0.05, tint: 0x1d1d1f, weather: false });
  b.cyl('lit', 0.10, 0.05, 0, -0.09, 0.36, { tint: 0xffd9a0, weather: false });
  /* Remember where the bulb ended up. A wall lamp that is emissive but throws
     no light is what makes a night render look like a poster; the showcase
     hangs a real point light here on the nearest few buildings. */
  b.markLamp(0, -0.09, 0.36);
  b.pop();
}

/* ---- 4.4 sign ------------------------------------------------------------ */
function partSign(b, x, y, w, h, P) {
  b.push(x, y, 0);
  b.box('timber', w, h, 0.07, 0, 0, 0.14, { tint: 0x2a241d });
  b.quad('sign', w - 0.08, h - 0.08, 0, 0, 0.181);
  b.box('metal', 0.05, 0.05, 0.16, -w / 2 + 0.1, h / 2 - 0.06, 0.06, { tint: 0x2a2a2c, weather: false });
  b.box('metal', 0.05, 0.05, 0.16, w / 2 - 0.1, h / 2 - 0.06, 0.06, { tint: 0x2a2a2c, weather: false });
  b.pop();
}

/* ---- 4.5 balcony --------------------------------------------------------- */
function partBalcony(b, x, y, w, P) {
  const d = 1.05;
  b.push(x, y, 0);
  b.box('stone', w, 0.14, d, 0, 0, d / 2, { tint: P.stone });
  // two corbels under it — the thing that says the slab is carried, not floating
  b.box('stone', 0.16, 0.30, 0.42, -w / 2 + 0.2, -0.20, 0.22, { tint: P.stone });
  b.box('stone', 0.16, 0.30, 0.42, w / 2 - 0.2, -0.20, 0.22, { tint: P.stone });
  // railing: top rail, bottom rail, balusters
  b.cyl('metal', 0.028, w, 0, 0.98, d - 0.05, { axis: 'x', tint: 0x1e1e20, weather: false });
  b.cyl('metal', 0.022, w, 0, 0.16, d - 0.05, { axis: 'x', tint: 0x1e1e20, weather: false });
  b.cyl('metal', 0.028, d - 0.1, -w / 2 + 0.02, 0.98, d / 2 + 0.02, { axis: 'z', tint: 0x1e1e20, weather: false });
  b.cyl('metal', 0.028, d - 0.1, w / 2 - 0.02, 0.98, d / 2 + 0.02, { axis: 'z', tint: 0x1e1e20, weather: false });
  const n = Math.max(4, Math.round(w / 0.17));
  for (let i = 0; i <= n; i++) {
    const px = -w / 2 + (w * i) / n;
    b.cyl('metal', 0.014, 0.92, px, 0.53, d - 0.05, { seg: 6, tint: 0x1e1e20, weather: false });
  }
  b.pop();
}

/* ---- 4.6 awning / canopy ------------------------------------------------- */
function partAwning(b, x, y, w, kind, tint) {
  b.push(x, y, 0);
  if (kind === 'canvas') {
    /* A sloped cloth, and the two arms holding it. Rotated about X so the front
       edge hangs lower than the wall edge, which is the whole read. */
    b.box('timber', w, 0.06, 1.35, 0, 0, 0.70, { rx: -0.34, tint, weather: false });
    b.box('timber', w, 0.26, 0.05, 0, -0.30, 1.34, { tint, weather: false });   // valance
    b.cyl('metal', 0.022, 1.25, -w / 2 + 0.12, -0.18, 0.62, { axis: 'z', tint: 0x2b2b2d, weather: false });
    b.cyl('metal', 0.022, 1.25, w / 2 - 0.12, -0.18, 0.62, { axis: 'z', tint: 0x2b2b2d, weather: false });
  } else {
    b.box('stone', w, 0.16, 1.5, 0, 0, 0.75, { tint });
    b.cyl('metal', 0.032, 1.5, -w / 2 + 0.2, -0.42, 0.75, { axis: 'z', rz: 0.5, tint: 0x2b2b2d, weather: false });
    b.cyl('metal', 0.032, 1.5, w / 2 - 0.2, -0.42, 0.75, { axis: 'z', tint: 0x2b2b2d, weather: false });
  }
  b.pop();
}

/* ---- 4.7 utility wall clutter -------------------------------------------- */
/* An AC unit, a meter box and a pipe run. Nothing dates a "realistic" building
   faster than a back wall with nothing on it. */
function partUtility(b, x, y, rnd) {
  b.push(x, y, 0);
  b.box('metal', 0.82, 0.62, 0.34, 0, 0, 0.17, { tint: 0x8f9195 });
  for (let i = -2; i <= 2; i++) b.box('metal', 0.70, 0.05, 0.03, 0, i * 0.10, 0.345, { tint: 0x4a4c50, weather: false });
  b.box('metal', 0.16, 0.16, 0.30, -0.34, -0.40, 0.15, { tint: 0x6e7074 });     // bracket
  b.box('metal', 0.16, 0.16, 0.30, 0.34, -0.40, 0.15, { tint: 0x6e7074 });
  b.box('metal', 0.44, 0.56, 0.20, 1.35, -0.30, 0.10, { tint: 0xa9a396 });       // meter box
  b.box('metal', 0.40, 0.03, 0.03, 1.35, -0.30, 0.205, { tint: 0x3a3a3c, weather: false });
  b.cyl('metal', 0.05, y + 0.4, -1.25, -y / 2 - 0.2, 0.09, { tint: 0x76787c });  // pipe run to ground
  b.cyl('metal', 0.05, y + 0.4, -1.45, -y / 2 - 0.2, 0.09, { tint: 0x76787c });
  for (let k = 0; k < 3; k++) {
    b.box('metal', 0.42, 0.06, 0.14, -1.35, -0.9 - k * 1.6, 0.06, { tint: 0x55575a });
    /* The rust the bracket bleeds down the render under it. A galvanised strap
       screwed into plaster is the most reliable orange streak on any European
       back wall, and it never repeats because the bracket never repeats. */
    b.quad('rust', 0.34, 0.95, -1.35, -1.45 - k * 1.6, 0.021);
  }
  b.pop();
}

/* ---- 4.8 roof ------------------------------------------------------------ */
/* The single biggest "is this a game asset" tell. A roof rendered as two smooth
   planes with a tile texture is a picture of a roof; a roof built as stepped
   COURSES has a serrated eaves edge and a shadow line every 40 cm, which is what
   the eye actually uses to read it. Every roof here is courses, plus a ridge
   cap, plus an eaves overhang with a fascia board and a gutter under it. */
function partRoof(b, w, d, y, kind, P, rnd) {
  const OV = 0.48;                                   // overhang past the wall
  const W = w + OV * 2, D = d + OV * 2;
  const courseL = 0.42, thick = 0.085;

  /** One stepped slope, in a frame where the eaves are at z=+hd, y=0 and the
      ridge at z=0, y=rise — so the caller only has to rotate about Y.
      `lenEave` -> `lenRidge` is the TAPER: a hip's slope is a trapezium and its
      end slopes are triangles. Building them as constant-width rectangles is
      what left four crossed slabs and a hole at every hip corner. */
  const slope = (lenEave, lenRidge, hd, rise, tint) => {
    const run = Math.hypot(hd, rise);
    const n = Math.max(3, Math.round(run / courseL));
    const ang = Math.atan2(rise, hd);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const cz = hd * (1 - s), cy = rise * s;
      const L = lerp(lenEave, lenRidge, s);
      if (L < 0.05) continue;
      /* Each course is pushed 5 cm out along the slope normal and made a little
         deeper than its share, so it laps the one below — that lap is the line. */
      const g = new THREE.BoxGeometry(L, thick, run / n + 0.10);
      /* rotateX(+ang), not -ang. A box's +z must end up pointing DOWN the slope,
         (0, -sin, cos); the negative angle pointed it up-slope, so every course
         crossed the roof plane at the wrong tilt and the roof came out as a set
         of gapped louvres with the sky showing between them. */
      g.rotateX(ang);
      g.translate(0, cy + Math.cos(ang) * 0.05, cz + Math.sin(ang) * 0.05);
      /* Course-by-course value. A roof of one flat tile colour is the second
         biggest "asset" tell after a flat plane: real tiles darken with soot and
         damp shade toward the RIDGE and with standing water and moss in the two
         courses above the GUTTER, and every course between them weathered on
         its own. `hh` is per-course and deterministic, so a roof is the same
         roof on every reload. */
      const hh = hash2(i * 3.77 + hd * 1.9, s * 9.13 + rise * 2.3);
      const k = (1 - 0.15 * Math.pow(s, 2.4) - 0.17 * Math.pow(1 - s, 3.2)) * (0.93 + 0.14 * hh);
      b.raw('roof', g, { tint: shadeHex(tint, k) });
      /* A few tiles that were replaced: lighter, and sitting a little proud of
         the course they were slipped into. Eight per cent of courses get one. */
      if (hh > 0.92) {
        const tw = Math.min(0.55, L * 0.5);
        const t2 = new THREE.BoxGeometry(tw, thick, run / n * 0.8);
        t2.rotateX(ang);
        t2.translate(lerp(-L / 2 + tw, L / 2 - tw, hash2(i * 5.1, s * 2.7)),
                     cy + Math.cos(ang) * 0.10, cz + Math.sin(ang) * 0.10);
        b.raw('roof', t2, { tint: shadeHex(tint, k * 1.28) });
      }
    }
  };

  b.push(0, y, 0);
  if (kind === 'flat') {
    b.box('roof', W, 0.16, D, 0, 0.08, 0, { tint: 0x4c4a47 });
    // parapet with a stone coping — a flat roof without one reads as a lid
    for (const [sx, sz, lw, ld] of [[0, -D / 2 + 0.12, W, 0.24], [0, D / 2 - 0.12, W, 0.24],
                                    [-W / 2 + 0.12, 0, 0.24, D], [W / 2 - 0.12, 0, 0.24, D]]) {
      b.box('wall', lw, 0.78, ld, sx, 0.55, sz, { tint: P.wall });
      b.box('stone', lw + 0.14, 0.10, ld + 0.14, sx, 0.99, sz, { tint: P.stone });
    }
    // roof plant: a vent stack and a housing, visible from any street below
    b.cyl('metal', 0.16, 0.9, W * 0.2, 0.6, D * 0.15, { tint: 0x7b7d80 });
    b.cyl('metal', 0.24, 0.12, W * 0.2, 1.08, D * 0.15, { tint: 0x4e5053 });
    b.box('metal', 1.2, 0.7, 1.0, -W * 0.18, 0.5, -D * 0.12, { tint: 0x8a8c90 });
  } else if (kind === 'gable') {
    const rise = D * 0.42;
    slope(W, W, D / 2, rise, P.roof);
    b.push(0, 0, 0, Math.PI); slope(W, W, D / 2, rise, P.roof); b.pop();
    // the two gable walls that close the ends
    for (const s of [-1, 1]) {
      const tri = new THREE.BufferGeometry();
      const hx = W / 2 * s;
      tri.setAttribute('position', new THREE.Float32BufferAttribute(
        [hx, 0, -D / 2, hx, 0, D / 2, hx, rise, 0], 3));
      tri.setIndex(s > 0 ? [0, 1, 2] : [2, 1, 0]);
      tri.computeVertexNormals();
      b.raw('wall', tri, { tint: P.wall });
      // bargeboard along the gable edge
      const phi = Math.atan2(rise, D / 2), edge = Math.hypot(D / 2, rise);
      b.box('timber', 0.10, 0.24, edge, hx - 0.06 * s, rise / 2, -D / 4, { tint: P.trim, rx: -phi });
      b.box('timber', 0.10, 0.24, edge, hx - 0.06 * s, rise / 2, D / 4, { tint: P.trim, rx: phi });
    }
    b.box('roof', W + 0.06, 0.15, 0.30, 0, rise + 0.03, 0, { tint: P.roof, rz: 0 });  // ridge cap
  } else if (kind === 'hip') {
    const rise = Math.min(D, W) * 0.40;
    const ridgeL = W * 0.34;                      // the flat the four slopes meet on
    slope(W, ridgeL, D / 2, rise, P.roof);
    b.push(0, 0, 0, Math.PI); slope(W, ridgeL, D / 2, rise, P.roof); b.pop();
    b.push(0, 0, 0, Math.PI / 2); slope(D, 0.1, (W - ridgeL) / 2, rise, P.roof); b.pop();
    b.push(0, 0, 0, -Math.PI / 2); slope(D, 0.1, (W - ridgeL) / 2, rise, P.roof); b.pop();
    b.box('roof', ridgeL + 0.3, 0.15, 0.30, 0, rise + 0.02, 0, { tint: P.roof });
  } else {                                            // mansard — the tall style
    const lower = D * 0.30, upper = D * 0.14;
    /* The lower pitch runs from the EAVES (z = D/2) up to the knuckle at
       z = D*0.16, so its frame has to be pushed out to the eaves first —
       without that shift the whole mansard floated a metre inside the walls. */
    const knuckle = D * 0.16;
    b.push(0, 0, knuckle); slope(W, W, D / 2 - knuckle, lower, P.roof); b.pop();
    b.push(0, 0, -knuckle, Math.PI); slope(W, W, D / 2 - knuckle, lower, P.roof); b.pop();
    b.push(0, lower, 0); slope(W, W * 0.7, knuckle, upper, P.roof); b.pop();
    b.push(0, lower, 0, Math.PI); slope(W, W * 0.7, knuckle, upper, P.roof); b.pop();
    b.box('roof', W, 0.14, 0.30, 0, lower + upper + 0.02, 0, { tint: P.roof });
    // dormer — a mansard without one is a shed
    b.push(0, lower * 0.35, D / 2 - D * 0.10);
    b.box('wall', 1.3, 1.0, 0.9, 0, 0.5, 0, { tint: P.wall });
    b.box('roof', 1.5, 0.12, 1.05, 0, 1.06, 0, { tint: P.roof });
    b.quad('glass', 0.85, 0.72, 0, 0.52, 0.46);
    b.quad('interior', 0.85, 0.72, 0, 0.52, 0.30);
    b.box('timber', 0.95, 0.07, 0.07, 0, 0.90, 0.46, { tint: P.trim });
    b.pop();
  }

  /* Fascia + gutter, on every roof that has eaves. The gutter is a real
     cylinder: it catches a highlight along the whole eaves line, and that
     highlight is what makes a roof edge look like metal rather than a cut. */
  if (kind !== 'flat') {
    for (const s of [-1, 1]) {
      b.box('timber', W + 0.1, 0.26, 0.06, 0, -0.10, (D / 2) * s, { tint: P.trim });
      b.cyl('metal', 0.075, W + 0.1, 0, -0.24, (D / 2 + 0.06) * s, { axis: 'x', tint: 0x6b6d70 });
      // gutter brackets
      for (let i = -2; i <= 2; i++)
        b.box('metal', 0.05, 0.12, 0.20, (W / 2 - 0.4) * (i / 2), -0.18, (D / 2 + 0.02) * s, { tint: 0x55575a, weather: false });
    }
  }
  b.pop();
}

/* ---- 4.9 chimney and downpipes ------------------------------------------- */
function partChimney(b, x, z, base, h, P) {
  b.push(x, base, z);
  b.box('stone', 0.78, h, 0.72, 0, h / 2, 0, { tint: P.stone === 0x9a9086 ? 0x8d6a58 : 0x8d6a58 });
  b.box('stone', 0.98, 0.13, 0.92, 0, h + 0.06, 0, { tint: P.stone });          // cap slab
  b.cyl('metal', 0.13, 0.34, -0.16, h + 0.28, 0, { tint: 0x3f3b38 });           // pot
  b.cyl('metal', 0.13, 0.34, 0.16, h + 0.28, 0, { tint: 0x3f3b38 });
  b.pop();
}

function partDownpipe(b, x, z, h) {
  b.push(x, 0, z);
  b.cyl('metal', 0.058, h, 0, h / 2, 0, { tint: 0x6b6d70 });
  b.cyl('metal', 0.075, 0.16, 0, h - 0.08, 0, { tint: 0x5a5c5f });              // swan neck collar
  b.cyl('metal', 0.075, 0.18, 0, 0.30, 0, { tint: 0x5a5c5f });                  // shoe
  for (let k = 1; k * 1.8 < h; k++) b.box('metal', 0.20, 0.05, 0.06, 0, k * 1.8, -0.07, { tint: 0x55575a, weather: false });
  b.pop();
}


/* =============================================================================
   5. THE BUILDING GRAMMAR
   `buildFull` is the LOD0 assembly: plinth, then a facade per side, then roof,
   then the things that hang off it. Everything reads its numbers from the STYLE
   row and its colours from the PALETTE row.
   ========================================================================== */

/** One facade, in a frame where the wall's outer face is z=0 and x runs along
    it. Emits the wall itself as piers and spandrels AROUND the openings. */
function facade(b, w, floors, S, P, rnd, opts) {
  const fh = S.floorH;
  const bays = Math.max(1, Math.round(w / S.bay));
  const bw = w / bays;
  const winW = Math.min(1.35, bw * 0.52);
  const winH = Math.min(fh * 0.58, 1.75);
  const shopFloor = opts.front && S.shop > 0 && rnd() < S.shop + 0.2;
  /* Every wall PANEL takes its own micro-tint off its bay and floor index. A
     spandrel and the pier beside it were rendered from different buckets of
     mix; without this a four-storey face is one dead value and the panel seams
     that make a facade read as built rather than extruded are invisible.
     `salt` is the side index, so the same bay on two sides differs too. */
  const salt = opts.salt || 0;
  const panel = (a, c) => jitterHex(P.wall, (hash2(salt * 7.1 + a, c * 3.3) - 0.5) * 3.0,
                                            (hash2(a * 2.9 + 1.7, salt * 5.7 + c) - 0.5) * 0.05);
  /* Which room is behind a pane at night. 58 % lit, and roughly a quarter of
     those on a cool lamp rather than a warm one: a street where every window is
     the same tungsten orange is a Christmas card, not an evening. */
  const roomOf = () => { if (!opts.lit) return 'interior'; const r = rnd(); return r < 0.42 ? 'interior' : r < 0.58 ? 'lit2' : 'lit'; };

  for (let f = 0; f < floors; f++) {
    const y0 = f * fh;
    const isShop = f === 0 && shopFloor;
    const isEntry = f === 0 && opts.front && !isShop;
    const sillY = y0 + (isShop ? 0.35 : 0.95);
    const headY = sillY + (isShop ? fh - 0.95 : winH);

    if (isShop) {
      /* A shopfront: one wide opening with a stall riser, a timber pilaster each
         side and a fascia over it. Ground floors are not just windows. */
      b.box('wall', w, 0.35, T_WALL, 0, y0 + 0.175, -T_WALL / 2, { tint: panel(f, 0) });
      b.box('wall', w, y0 + fh - headY, T_WALL, 0, (headY + y0 + fh) / 2, -T_WALL / 2, { tint: panel(f, 1) });
      b.box('timber', 0.36, fh - 0.35, 0.22, -w / 2 + 0.18, y0 + 0.35 + (fh - 0.35) / 2, 0.06, { tint: P.trim });
      b.box('timber', 0.36, fh - 0.35, 0.22, w / 2 - 0.18, y0 + 0.35 + (fh - 0.35) / 2, 0.06, { tint: P.trim });
      b.box('stone', w, 0.14, 0.34, 0, y0 + 0.30, 0.06, { tint: P.stone });     // stall riser cap
      const gw = w - 0.9, gh = fh - 0.95;
      b.quad('glass', gw, gh, 0, y0 + 0.42 + gh / 2, -0.09, { tint: 0xf0f5ff, weather: false });
      b.quad(opts.lit ? 'lit' : 'interior', gw, gh, 0, y0 + 0.42 + gh / 2, -0.44, { weather: false });
      // shop door inside the front, and the mullions splitting the glazing
      for (let i = 1; i < 3; i++) b.box('timber', 0.09, gh, 0.10, -gw / 2 + (gw * i) / 3, y0 + 0.42 + gh / 2, -0.07, { tint: P.trim });
      b.box('timber', w, 0.30, 0.26, 0, y0 + fh - 0.20, 0.10, { tint: P.trim });  // fascia board
      partAwning(b, 0, y0 + fh - 0.42, w - 0.5, 'canvas', opts.awningTint);
      partLamp(b, -w / 2 + 0.45, y0 + fh - 0.75, P);
      partLamp(b, w / 2 - 0.45, y0 + fh - 0.75, P);
    } else {
      // spandrel under the sills and the band over the heads
      b.box('wall', w, sillY - y0, T_WALL, 0, (sillY + y0) / 2, -T_WALL / 2, { tint: panel(f, 2) });
      b.box('wall', w, y0 + fh - headY, T_WALL, 0, (headY + y0 + fh) / 2, -T_WALL / 2, { tint: panel(f, 3) });
      for (let i = 0; i < bays; i++) {
        const cx = -w / 2 + bw * (i + 0.5);
        const entryBay = isEntry && i === Math.floor(bays / 2);
        if (entryBay) {
          // the door bay: its own pier arrangement, full height to the head
          const dw = Math.min(1.15, bw * 0.5), dh = Math.min(2.25, fh - 0.5);
          b.box('wall', (bw - dw) / 2 - 0.17, headY - y0, T_WALL, cx - (bw + dw) / 4 - 0.085, (headY + y0) / 2, -T_WALL / 2, { tint: panel(f, 20 + i) });
          b.box('wall', (bw - dw) / 2 - 0.17, headY - y0, T_WALL, cx + (bw + dw) / 4 + 0.085, (headY + y0) / 2, -T_WALL / 2, { tint: panel(f, 40 + i) });
          b.box('wall', dw + 0.34, headY - y0 - dh - 0.24, T_WALL, cx, y0 + dh + 0.24 + (headY - y0 - dh - 0.24) / 2, -T_WALL / 2, { tint: panel(f, 60 + i) });
          b.push(0, y0, 0); partDoor(b, cx, dw, dh, P, { room: opts.lit ? 'lit' : 'interior' }); b.pop();
          partLamp(b, cx + dw / 2 + 0.55, y0 + dh + 0.20, P);
          if (S.sign > 0.5) partSign(b, cx, y0 + dh + 0.85, Math.min(2.6, bw * 0.9), 0.62, P);
        } else {
          // piers left and right of the opening
          const pier = (bw - winW) / 2;
          b.box('wall', pier, headY - sillY, T_WALL, cx - (winW + pier) / 2, (headY + sillY) / 2, -T_WALL / 2, { tint: panel(f, 4 + i * 2) });
          b.box('wall', pier, headY - sillY, T_WALL, cx + (winW + pier) / 2, (headY + sillY) / 2, -T_WALL / 2, { tint: panel(f, 5 + i * 2) });
          partWindow(b, cx, (sillY + headY) / 2, winW, headY - sillY, P, {
            room: roomOf(),
            shutter: rnd() < S.shutter,
            shutterTint: jitterHex(P.trim, (hash2(i * 4.1 + salt, f * 6.3) - 0.5) * 6, (hash2(f * 8.2, i * 1.3) - 0.5) * 0.12),
          });
        }
      }
    }
    // string course between floors — the horizontal that stops a facade stacking
    if (S.band && f > 0) b.box('stone', w + 0.06, 0.13, T_WALL + 0.10, 0, y0 + 0.02, -T_WALL / 2 + 0.05, { tint: P.stone });
  }

  // balcony, on a middle floor, front only
  if (opts.front && S.balcony > 0 && floors >= 2 && rnd() < S.balcony) {
    const f = 1 + Math.floor(rnd() * Math.max(1, floors - 2));
    partBalcony(b, 0, f * fh + 0.05, Math.min(w - 1.2, 4.2), P);
  }
}

/** The whole LOD0 building. Returns the Builder, harvested by the caller. */
function buildFull(opts, tiles) {
  const S = STYLES[opts.style] || STYLES.townhouse;
  const PB = PALETTES[opts.palette] || PALETTES.plaster;
  const rnd = rngFrom(opts.seed);
  const [w, d] = opts.footprint;
  const floors = opts.floors;
  const H = floors * S.floorH;
  /* This building's OWN colours. +-3 degrees of hue and +-6 % of value off the
     palette, re-rolled from the seed: five palettes across a row of forty
     buildings otherwise means eight buildings in the identical cream, and a row
     of identical albedo reads as instanced however good the geometry is. */
  const P = {
    ...PB,
    wall:  jitterHex(PB.wall,  (rnd() * 2 - 1) * 3.0, (rnd() * 2 - 1) * 0.06),
    stone: jitterHex(PB.stone, (rnd() * 2 - 1) * 2.0, (rnd() * 2 - 1) * 0.045),
    roof:  jitterHex(PB.roof,  (rnd() * 2 - 1) * 4.0, (rnd() * 2 - 1) * 0.07),
    trim:  jitterHex(PB.trim,  (rnd() * 2 - 1) * 5.0, (rnd() * 2 - 1) * 0.10),
  };
  /* The macro-noise origin. Two neighbours must not wear the same stain map, so
     the lookup is offset by a large per-seed constant rather than by the world
     position the building does not know. */
  const b = new Builder(tiles, {
    macro: { ox: (opts.seed % 977) * 3.71, oz: (opts.seed % 613) * 5.29 },
    courseH: S.floorH,
    mortar: PB.surface === 'brick',
    patch: PB.surface === 'plaster',
  });
  const lit = opts.lit !== false;
  /* Awning cloth: one of three, chosen by seed. A street of identical red
     awnings is the same failure as a street of identical roofs. */
  const awningTint = [0x8e3b34, 0x2f5148, 0x2c4a6b][Math.floor(rnd() * 3)];

  /* Plinth: a stone base course standing proud of the wall. It is the cheapest
     detail in the whole file and the one that most reliably stops a building
     looking like it was dropped on the ground. */
  /* `moss: true` greens the +Z face of these two, and only that face — see
     `_paint`. WHY vertex colour and not a decal: the +Z wall is the north side,
     it never gets the sun, it never dries, and a green-black band up the base
     course is what says the building has stood through winters — but it is one
     flat face, so a decal quad would be a whole extra material for a tint the
     colour attribute is already carrying. */
  b.box('stone', w + 0.24, 0.52, d + 0.24, 0, 0.26, 0, { tint: P.stone, moss: true });
  b.box('stone', w + 0.34, 0.10, d + 0.34, 0, 0.55, 0, { tint: P.stone, moss: true });   // chamfer / drip

  // the four facades, each in its own frame
  const sides = [
    [0, -d / 2, Math.PI, w, true],    // front faces -Z
    [0, d / 2, 0, w, false],
    [-w / 2, 0, -Math.PI / 2, d, false],
    [w / 2, 0, Math.PI / 2, d, false],
  ];
  sides.forEach(([sx, sz, ry, sw, front], si) => {
    b.push(sx, 0.5, sz, ry);
    facade(b, sw, floors, S, P, rnd, { front, lit, awningTint, salt: si + 1 });
    b.pop();
  });

  // corner quoins — alternating stone blocks up every corner
  if (rnd() < S.quoin) {
    for (const [qx, qz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      for (let y = 0.6; y < H; y += 0.62) {
        const big = Math.round(y / 0.62) % 2 === 0;
        const L = big ? 0.72 : 0.48;
        b.box('stone', L, 0.30, 0.30, qx + (qx < 0 ? L / 2 - 0.08 : -L / 2 + 0.08), y, qz + (qz < 0 ? 0.08 : -0.08), { tint: P.stone });
        b.box('stone', 0.30, 0.30, L, qx + (qx < 0 ? 0.08 : -0.08), y, qz + (qz < 0 ? L / 2 - 0.08 : -L / 2 + 0.08), { tint: P.stone });
      }
    }
  }

  // roof, chimneys, downpipes
  partRoof(b, w, d, H + 0.5, opts.roof || S.roof, P, rnd);
  const chimneys = opts.style === 'industrial' || opts.style === 'tower' ? 0 : 1 + (rnd() < 0.35 ? 1 : 0);
  for (let i = 0; i < chimneys; i++)
    partChimney(b, lerp(-w * 0.3, w * 0.3, rnd()), lerp(-d * 0.18, d * 0.18, rnd()), H + 0.7, 1.15 + rnd() * 0.9, P);
  for (const [px, pz, sx, sz] of [[-w / 2 - 0.1, -d / 2 - 0.1, -1, -1], [w / 2 + 0.1, d / 2 + 0.1, 1, 1]]) {
    partDownpipe(b, px, pz, H + 0.4);
    /* The rust that runs out of every pipe bracket onto the wall beside it.
       Emitted in a frame rotated onto the SIDE wall (local +Z is outward there)
       because the pipe itself stands off the corner and a decal on the pipe
       would float. */
    b.push(sx * (w / 2 + 0.012), 0, 0, sx * Math.PI / 2);
    const rx = -sx * sz * (d / 2 - 0.36);
    for (let k = 1; k * 1.8 < H; k++)
      b.quad('rust', 0.30, 0.8 + hash2(k * 3.3, opts.seed % 97) * 0.7, rx, k * 1.8 - 0.55, 0);
    b.pop();
  }

  // the utility wall — AC, meter, pipes — always on a side, never on the front
  if (rnd() < S.utility) {
    b.push(w / 2, 0, 0, Math.PI / 2);
    partUtility(b, lerp(-d * 0.25, d * 0.25, rnd()), 2.4 + rnd() * (H - 3.4), rnd);
    b.pop();
  }

  // steps and a front boundary: low wall, or a fence with a gate post
  if (rnd() < S.fence) {
    const fz = -d / 2 - 2.4;
    if (opts.palette === 'stone' || opts.style === 'civic') {
      b.box('stone', w + 1.6, 0.62, 0.30, 0, 0.31, fz, { tint: P.stone });
      b.box('stone', w + 1.8, 0.10, 0.44, 0, 0.67, fz, { tint: P.stone });
    } else {
      for (let i = 0; i <= 6; i++) b.box('timber', 0.10, 1.0, 0.10, -w / 2 - 0.6 + ((w + 1.2) * i) / 6, 0.5, fz, { tint: P.trim });
      b.box('timber', w + 1.4, 0.09, 0.06, 0, 0.92, fz, { tint: P.trim });
      b.box('timber', w + 1.4, 0.09, 0.06, 0, 0.42, fz, { tint: P.trim });
    }
  }

  /* Whitewash only: the faint runs a leaking gutter leaves down a white wall.
     They are invisible on brick and on ochre render and unmissable on white,
     which is why this is the one palette that gets them. */
  if (opts.palette === 'whitewash') {
    for (const [zz, ry] of [[-d / 2 - 0.012, Math.PI], [d / 2 + 0.012, 0]]) {
      b.push(0, 0, zz, ry);
      for (let i = 0; i < 4; i++) {
        const hs = hash2(i * 9.4 + opts.seed % 71, zz);
        b.quad('grime', 0.35 + hs * 0.45, 1.6 + hs * 2.4, lerp(-w * 0.42, w * 0.42, hash2(i * 2.2, opts.seed % 53)),
               H - 0.6 - hs * 1.4, 0, { uvRect: dirtRect((i + 2) % DIRT_CELLS) });
      }
      b.pop();
    }
  }

  /* Contact occlusion last, once every solid is in the list. */
  b.bakeAO();
  return b;
}


/* =============================================================================
   6. THE KIT — the public API
   ========================================================================== */

export class BuildingKit {

  /** Load the pack once and build the shared materials. Everything a building
      needs afterwards is a geometry merge, so `make()` is synchronous. */
  static async load(renderer, manifestUrl = 'assets/manifest.json') {
    const kit = new BuildingKit();
    kit.renderer = renderer;
    const base = manifestUrl.replace(/manifest\.json$/, '');
    const man = await (await fetch(manifestUrl)).json();

    const texLoader = new THREE.TextureLoader().setPath(base);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const load = (p, srgb) => new Promise((res, rej) => texLoader.load(p, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, maxAniso);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, () => rej(new Error('texture: ' + p))));

    const want = ['plaster', 'brick', 'roofTiles', 'cobble', 'gravelRoad'];
    kit.tex = {};
    await Promise.all(want.map(async k => {
      const m = man[k];
      const [diffuse, normal, arm] = await Promise.all([
        load(m.diffuse, true), load(m.normal, false), load(m.roughness, false)]);
      kit.tex[k] = { diffuse, normal, arm, tile: m.metresPerTile };
    }));

    /* The environment. Glass with no envMap is grey plastic, and half the bar in
       this brief is "glass with reflection", so the HDRI is not optional here.
       Prefiltered at load for the same reason world.js does it: PMREM on first
       use lands as a stall in the middle of a shot. */
    const rgbe = new RGBELoader().setPath(base);
    const hdr = p => new Promise((res, rej) => rgbe.load(p, t => {
      t.mapping = THREE.EquirectangularReflectionMapping; res(t);
    }, undefined, () => rej(new Error('hdri: ' + p))));
    const [rawDusk, rawNight] = await Promise.all([hdr(man.hdriDusk.path), hdr(man.hdriNight.path)]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    kit.envDusk = pmrem.fromEquirectangular(rawDusk).texture;
    kit.envNight = pmrem.fromEquirectangular(rawNight).texture;
    rawDusk.dispose(); rawNight.dispose(); pmrem.dispose();

    kit._buildMaterials();
    kit._bakes = new Map();
    kit._instGeo = new Map();
    kit.manifest = man;
    kit.assetBase = base;
    return kit;
  }

  constructor() {
    this.night = 0;
    this.tiles = { wall: 2.0, stone: 1.4, roof: 1.5, timber: 0.6, metal: 0.6, interior: 1, lit: 1, lit2: 1, glass: 1, grime: 1, rust: 1 };
  }

  /* -------------------------------------------------------------------------
     MATERIALS — nine, shared by every building ever made. Nine materials means
     nine draw calls for a building of four hundred parts, and it means a street
     of forty of them is 360 calls rather than sixteen thousand.
     Every one of them carries a map. `vertexColors` is what lets one plaster
     material paint a cream wall, a green shutter and a soot-dark base.
     ---------------------------------------------------------------------- */
  _buildMaterials() {
    /* No aoMap. The pack's ARM red channel is micro-occlusion inside a 2 m
       texture tile — on a plaster wall it is invisible at any distance a person
       stands — and it costs a texture fetch on every shaded pixel of every
       building. Dropping it moved the 40-LOD0 stress view from 27 to 41 fps on
       the Radeon 860M. The occlusion that IS visible (the base of the wall,
       under the sills) is vertex colour and decals, which cost nothing. */
    const pbr = (t, extra = {}) => new THREE.MeshStandardMaterial({
      map: t.diffuse, normalMap: t.normal, roughnessMap: t.arm,
      roughness: 1.0, metalness: 0.0, vertexColors: true, envMapIntensity: 0.85,
      ...extra,
    });

    this.mat = {};
    this.mat.wall = pbr(this.tex.plaster);
    this.mat.wallBrick = pbr(this.tex.brick);
    this.mat.stone = pbr(this.tex.brick, { roughness: 0.95 });
    this.mat.roof = pbr(this.tex.roofTiles, { envMapIntensity: 0.7 });
    /* Painted joinery: the plaster normal at a 0.6 m tile is a fine brush
       texture at 10 m. A flat colour here is the loudest generated-scene tell. */
    this.mat.timber = pbr(this.tex.plaster, { roughness: 0.62, envMapIntensity: 0.5 });
    this.mat.metal = pbr(this.tex.plaster, { roughness: 0.42, metalness: 0.78, envMapIntensity: 1.1 });

    /* The room behind the glass. It is a shallow BOX of five quads now, not a
       plane, and it wears a texture: a dead flat interior colour behind a pane
       reads as paint, while a floor-to-ceiling gradient with a back-wall band
       reads as a room seen in the dark. */
    const roomTex = this._roomTexture();
    this.mat.interior = new THREE.MeshStandardMaterial({
      map: roomTex, color: 0x40474f, emissive: new THREE.Color(0x2a3038), emissiveIntensity: 0.75,
      roughness: 0.95, metalness: 0, vertexColors: true,
    });
    // the room behind the glass, lit warm — setNight() drives this one
    this.mat.lit = new THREE.MeshStandardMaterial({
      map: roomTex, color: 0x1a1512, emissive: new THREE.Color(0xffb463), emissiveIntensity: 0.0,
      roughness: 0.9, metalness: 0, vertexColors: true,
    });
    /* The same room on a COOL lamp. Emissive is not a per-vertex channel in
       three, so colour-temperature variation cannot come from vertex colours —
       it costs a second material, and one extra draw call per building is the
       cheapest way to buy a night street that is not uniformly tungsten. */
    this.mat.lit2 = new THREE.MeshStandardMaterial({
      map: roomTex, color: 0x141922, emissive: new THREE.Color(0xc2d6f2), emissiveIntensity: 0.0,
      roughness: 0.9, metalness: 0, vertexColors: true,
    });
    /* Glass. Physical, not standard: the clearcoat lobe is what puts the second,
       sharper reflection on top of the tinted one, and that double highlight is
       how a real pane differs from a shiny plane. */
    /* vertexColors so each pane can carry its own tint — see partWindow.
       roughness 0.05 and envMapIntensity 1.45: the old 1.9 made every pane a
       mirror bright enough to hide the room behind it, which is exactly the
       "glass reads flat" complaint. Less reflection, real depth behind it. */
    this.mat.glass = new THREE.MeshPhysicalMaterial({
      color: 0x121a20, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.42,
      clearcoat: 0.85, clearcoatRoughness: 0.04, envMapIntensity: 1.45, vertexColors: true,
      side: THREE.DoubleSide, depthWrite: false,
    });
    // the dirt decals: multiplied over whatever they sit on
    /* premultipliedAlpha is not optional with MultiplyBlending — three warns on
       every draw without it, and the blend factors it picks are wrong: the
       decal is DST_COLOR x SRC, so the texture must already carry its own
       alpha in its colour. White pixels then leave the wall untouched. */
    const decal = (map) => new THREE.MeshBasicMaterial({
      map, transparent: true, premultipliedAlpha: true,
      blending: THREE.MultiplyBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide,
    });
    this.mat.grime = decal(this._grimeTexture());
    this.mat.rust = decal(this._rustTexture());
    this.mat.sign = new THREE.MeshStandardMaterial({
      map: this._signTexture(), roughness: 0.55, metalness: 0.1, envMapIntensity: 0.6,
    });

    this._all = Object.values(this.mat);
  }

  /** The weathering ATLAS: 4 x 2 cells of 128 px on one 512 x 256 canvas.
      White = untouched, so every cell is safe under MultiplyBlending where the
      decal misses. Six dirt cells at three strengths and two densities, one
      rust, one moss. WHY an atlas: with one texture the streak under every sill
      on a facade is literally the same streak, which is what the first close-up
      was called out for. Math.random is gone — the RNG is seeded, so the texture
      is identical on every reload and a screenshot comparison means something. */
  _grimeTexture() {
    const CELL = 128;
    const c = document.createElement('canvas'); c.width = CELL * DIRT_CELLS; c.height = CELL;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    const rnd = rngFrom(20260906);

    /* One dirt cell. `strength` scales every alpha, `runs` the streak count —
       between them the six cells cover "barely stained" to "never cleaned". */
    const dirt = (cx, cy, strength, runs) => {
      x.save(); x.translate(cx * CELL, cy * CELL); x.beginPath(); x.rect(0, 0, CELL, CELL); x.clip();
      const g = x.createLinearGradient(0, 0, 0, CELL);
      g.addColorStop(0, 'rgba(84,78,68,' + (0.44 * strength) + ')');
      g.addColorStop(0.45, 'rgba(104,98,88,' + (0.17 * strength) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, CELL, CELL);
      for (let i = 0; i < runs; i++) {
        const px = rnd() * CELL, len = 26 + rnd() * (CELL * 0.8);
        const st = x.createLinearGradient(0, 0, 0, len);
        st.addColorStop(0, 'rgba(74,68,60,' + (0.34 * strength) + ')');
        st.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = st; x.fillRect(px, 0, 1 + rnd() * 2.6, len);
      }
      x.restore();
    };
    const params = [[0.45, 12], [0.75, 22], [1.15, 34], [0.6, 40], [1.0, 16], [1.35, 26]];
    for (let i = 0; i < DIRT_CELLS; i++) dirt(i, 0, params[i][0], params[i][1]);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Rust: vertical runs in iron oxide, on its own texture. Under a multiply it
      has to leave red nearly alone and pull green and blue down — that is what
      turns cream render orange rather than merely dark. */
  _rustTexture() {
    const S = 128;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
    const rnd = rngFrom(4711);
    for (let i = 0; i < 28; i++) {
      const px = S * 0.5 + (rnd() - 0.5) * S * 0.6, len = 30 + rnd() * S * 0.85;
      const g = x.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(186,88,34,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(px, 0, 1 + rnd() * 3.4, len);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }


  /** The impostor room's surface: a dark floor-to-ceiling gradient with a
      lighter band two thirds up where a back wall catches whatever light gets
      in. Tiny — it is only ever seen through a 1.2 m pane at 8 m. */
  _roomTexture() {
    const c = document.createElement('canvas'); c.width = 32; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#6a6f78'); g.addColorStop(0.34, '#3d434c');
    g.addColorStop(0.62, '#232830'); g.addColorStop(1, '#0e1116');
    x.fillStyle = g; x.fillRect(0, 0, 32, 64);
    x.fillStyle = 'rgba(190,196,206,0.22)'; x.fillRect(0, 20, 32, 5);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** One shared sign plate. Per-building lettering would be one texture and one
      draw call per building; the bar asks for "a sign plate", not a typography
      system, so this is deliberately one plate reused. */
  _signTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#1d1913'; x.fillRect(0, 0, 512, 128);
    x.strokeStyle = '#c9a227'; x.lineWidth = 4; x.strokeRect(10, 10, 492, 108);
    x.fillStyle = '#e8d7a8';
    x.font = '600 58px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('HANDLUNG', 256, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Which LOD a building at this distance should be drawn at. */
  lodFor(distance) { return distance < 60 ? 0 : distance < 250 ? 1 : 2; }

  /** 0 = day, 1 = night. Drives the window emissive and the glass tint, so a
      street at dusk gains warm rooms without touching any geometry — and, for
      every baked LOD1/2 facade, cross-fades to that style+palette's lit-window
      photograph via the `uNight` uniform `_bake()` wired into it. */
  setNight(t) {
    this.night = THREE.MathUtils.clamp(t, 0, 1);
    this.mat.lit.emissiveIntensity = 2.4 * this.night;
    this.mat.lit2.emissiveIntensity = 1.15 * this.night;    // cool lamps read brighter, so drive them lower
    this.mat.glass.opacity = lerp(0.42, 0.74, this.night);
    this.mat.glass.envMapIntensity = lerp(1.45, 1.0, this.night);
    for (const rec of this._bakes.values()) rec.material.userData.uNight.value = this.night;
  }

  /** Point every material at an environment map (the showcase swaps dusk/night). */
  setEnvironment(env) { for (const m of this._all) if ('envMap' in m) { m.envMap = env; m.needsUpdate = true; } }

  /* -------------------------------------------------------------------------
     make() — one building, deterministic from `seed`.
     ---------------------------------------------------------------------- */
  make(o) {
    const opts = {
      seed: 1, footprint: [8, 8], floors: 3, style: 'townhouse',
      roof: null, palette: 'plaster', lod: 0, ...o,
    };
    if (opts.lod === 0) return this._makeFull(opts);
    return this._makeLod(opts);
  }

  _makeFull(opts) {
    const b = buildFull(opts, this.tiles);
    const geo = b.harvest();
    const g = new THREE.Group();
    g.name = `building:${opts.style}:${opts.palette}:${opts.seed}`;
    const P = PALETTES[opts.palette] || PALETTES.plaster;
    const wallMat = P.surface === 'brick' ? this.mat.wallBrick : this.mat.wall;
    const pick = { wall: wallMat, stone: this.mat.stone, roof: this.mat.roof, timber: this.mat.timber,
                   metal: this.mat.metal, interior: this.mat.interior, lit: this.mat.lit, lit2: this.mat.lit2,
                   glass: this.mat.glass, grime: this.mat.grime, rust: this.mat.rust,
                   sign: this.mat.sign };
    for (const [k, geometry] of Object.entries(geo)) {
      const m = new THREE.Mesh(geometry, pick[k]);
      m.castShadow = !DECAL.has(k) && k !== 'glass' && !ROOM.has(k);
      m.receiveShadow = !DECAL.has(k);
      m.renderOrder = DECAL.has(k) ? 1 : k === 'glass' ? 2 : 0;
      g.add(m);
    }
    g.userData.lod = 0;
    g.userData.opts = opts;
    /* Where this building's lit wall lamps are, in its OWN frame. The showcase
       turns the nearest few into real point lights at night; anything further
       away keeps the emissive shade and no light, which is the whole budget. */
    g.userData.lamps = b.lamps;
    return g;
  }

  /** LOD1 / LOD2 as a single mesh wearing the baked facade. */
  _makeLod(opts) {
    const S = STYLES[opts.style] || STYLES.townhouse;
    const [w, d] = opts.footprint;
    const H = opts.floors * S.floorH;
    const bake = this._bake(opts.style, opts.palette);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), bake.material);
    box.position.y = H / 2;
    box.castShadow = box.receiveShadow = true;
    g.add(box);
    if (opts.lod === 1) {
      const roofGeo = this._roofPrism(opts.roof || S.roof, w, d);
      const r = new THREE.Mesh(roofGeo, this.mat.roof);
      r.position.y = H;
      r.castShadow = r.receiveShadow = true;
      g.add(r);
    }
    g.userData.lod = opts.lod;
    g.userData.opts = opts;
    return g;
  }

  /** A cheap roof solid for LOD1 — silhouette only, no courses.
      `overhang` defaults to the fixed metres a real eave sticks past the wall
      (0.5 for both a flat parapet and a sloped eave), used by the
      single-building path which already passes the real footprint. The
      instanced path passes `overhang: 0` with a UNIT footprint and adds the
      same fixed metres back in world units after the per-instance footprint
      scale — scaling a footprint that already contains the overhang made the
      overhang grow with the building (a 20 m roof got a 9.5 m eave). */
  _roofPrism(kind, w, d, overhang) {
    if (kind === 'flat') {
      const o = overhang ?? 0.5;
      /* 0.4 m, not the 0.7 m this shipped with — a LOD1 parapet at 0.7 m read
         as a lid on anything under ~4 m tall (docs/BUILDINGS.md, "flat
         parapets scaled into 2 m lids"; the 2 m case was the pre-fix scaling
         bug above, but 0.7 m was already too tall on its own). */
      const g = new THREE.BoxGeometry(w + o, 0.4, d + o); g.translate(0, 0.2, 0);
      // Every roof geometry needs a `color` attribute — the shared roof
      // material has vertexColors on, and an absent attribute reads as
      // (0,0,0): a flat roof rendered pure black. White = no tint, matching
      // the neutral fill the hip/gable prisms below already carry.
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
      return g;
    }
    /* Was 0.9 — a real eave's overhang on both sides of a pitched roof, but
       past the `__roofOverhang` gate's 0.6 m ceiling for the instanced LOD1
       silhouette. 0.5 m matches the flat parapet above and still reads as an
       eave rather than a wall-hugging cap. */
    const o = overhang ?? 0.5;
    const rise = Math.min(w, d) * 0.42, W = w + o, D = d + o;
    const pos = [], idx = [];
    if (kind === 'hip') {
      pos.push(-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2,
               -W * 0.16, rise, 0, W * 0.16, rise, 0);
      idx.push(0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 3, 0, 4, 1, 2, 5);
    } else {
      pos.push(-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2,
               -W / 2, rise, 0, W / 2, rise, 0);
      idx.push(0, 1, 5, 0, 5, 4, 2, 3, 4, 2, 4, 5, 3, 0, 4, 1, 2, 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 1.5, pos[i + 2] / 1.5);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.length).fill(1), 3));
    return g;
  }

  /* -------------------------------------------------------------------------
     THE BAKE — render the real thing once, wear the photograph forever.
     A LOD1/2 building is a box. What stops it looking like a box is that its
     texture is a render of the LOD0 building's own facade: the same sills, the
     same shutters, the same dirt, lit the same way. Three targets per style and
     palette: a day albedo (dark windows), a night albedo (the SAME building
     with `lit:true` and the room materials pushed to their full night
     brightness before the shot), and one normal map — geometry is identical
     lit or dark, so the normal bake only needs to run once.
     `setNight()`'s onBeforeCompile block cross-fades day → night per pixel;
     see "THE NIGHT SKYLINE LOST ITS LIT WINDOWS" in docs/BUILDINGS.md. */
  _bake(style, palette) {
    const key = style + '|' + palette;
    if (this._bakes.has(key)) return this._bakes.get(key);

    const S = STYLES[style] || STYLES.townhouse;
    const H = 3 * S.floorH;
    const SZ = 512;
    const cam = new THREE.OrthographicCamera(-4.5, 4.5, H, 0, 0.1, 100);
    cam.position.set(0, 0, -30); cam.lookAt(0, 0, 0);
    /* The camera looks at the -Z face, which is the FRONT — the one carrying the
       door, the sign and the balcony. That is the face worth photographing. */
    cam.left = -4.5; cam.right = 4.5; cam.top = H; cam.bottom = 0; cam.updateProjectionMatrix();

    /** One render of the prototype, flat-lit. `lit:false` bakes the day map
        (and, only that once, the normal map — the geometry doesn't change
        between the two shots). `lit:true` bakes the night map: `setNight(1)`
        is reused rather than duplicating its emissive/glass numbers, so the
        baked night photo always matches what setNight(1) does to a live LOD0
        building. */
    const shoot = (lit) => {
      const opts = { seed: 7, footprint: [9, 9], floors: 3, style, palette, roof: S.roof, lit };
      const proto = this._makeFull(opts);
      const scene = new THREE.Scene();
      scene.add(proto);
      /* Flat, even light: this bake is an albedo-with-detail, not a lighting
         solution. The real sun is applied again when the LOD1 box is drawn, and
         baking a second sun into it is what makes distant buildings look pasted. */
      scene.add(new THREE.AmbientLight(0xffffff, 2.3));
      const key1 = new THREE.DirectionalLight(0xffffff, 1.1); key1.position.set(-0.4, 0.5, 1); scene.add(key1);

      const savedNight = this.night;
      if (lit) this.setNight(1);

      const prevTarget = this.renderer.getRenderTarget();
      const prevClear = this.renderer.getClearAlpha();
      const prevColor = new THREE.Color(); this.renderer.getClearColor(prevColor);

      const rt = new THREE.WebGLRenderTarget(SZ, SZ, { colorSpace: THREE.SRGBColorSpace });
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(scene, cam);

      let normal = null;
      if (!lit) {
        const rtN = new THREE.WebGLRenderTarget(SZ, SZ);
        scene.overrideMaterial = new THREE.MeshNormalMaterial();
        this.renderer.setRenderTarget(rtN);
        this.renderer.setClearColor(0x8080ff, 1);
        this.renderer.clear();
        this.renderer.render(scene, cam);
        scene.overrideMaterial.dispose();
        scene.overrideMaterial = null;
        normal = rtN.texture;
        normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
      }

      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevColor, prevClear);
      if (lit) this.setNight(savedNight);

      const tex = rt.texture;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      proto.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      return { tex, normal };
    };

    const day = shoot(false);
    const night = shoot(true);

    const material = new THREE.MeshStandardMaterial({
      map: day.tex, normalMap: day.normal, roughness: 0.86, metalness: 0.0, envMapIntensity: 0.7,
    });
    /* `uNight` and `uLitMap` cross-fade to the night bake in the fragment
       shader; `aPhase` (an InstancedBufferAttribute `instanced()` adds per
       group) staggers WHEN each instance crosses over, so a field of LOD1/2
       buildings doesn't snap its windows on in one frame. Gated on
       `USE_INSTANCING` so the single-building path (`_makeLod`'s plain Mesh,
       which has no `aPhase` attribute) still compiles and still fades, just
       without the per-instance offset. */
    material.userData.uNight = { value: this.night };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = material.userData.uNight;
      shader.uniforms.uLitMap = { value: night.tex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n#ifdef USE_INSTANCING\nattribute float aPhase;\n#endif\nvarying float vPhase;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvPhase = aPhase;\n#else\nvPhase = 0.5;\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform sampler2D uLitMap;\nvarying float vPhase;')
        .replace('#include <map_fragment>', `#include <map_fragment>
	{
		// staggered cross-fade: each instance's own phase shifts where in the
		// 0..1 night ramp IT lights up, so the field doesn't light in lockstep
		vec4 nightTexel = texture2D( uLitMap, vMapUv );
		float localT = smoothstep( vPhase * 0.6, vPhase * 0.6 + 0.4, uNight );
		diffuseColor.rgb = mix( diffuseColor.rgb, nightTexel.rgb, localT );
	}`);
    };

    const rec = { material, albedo: day.tex, normal: day.normal, litAlbedo: night.tex };
    this._bakes.set(key, rec);
    return rec;
  }

  /* -------------------------------------------------------------------------
     instanced() — hundreds of buildings, grouped by everything that decides
     their geometry and material, one InstancedMesh per group.
     `list` items: { position:[x,y,z], rotationY, footprint, floors, style,
                     palette, roof, lod, seed }
     ---------------------------------------------------------------------- */
  instanced(list) {
    const groups = new Map();
    for (const it of list) {
      const S = STYLES[it.style] || STYLES.townhouse;
      const roof = it.roof || S.roof;
      /* LOD2 builds no roof mesh, so keying it by roof shape only splits one
         instanced draw into four for no visible difference. Measured: 800 LOD2
         buildings went from 180 groups to 45. */
      const key = it.lod === 2 ? `${it.style}|${it.palette}|2`
                               : `${it.style}|${it.palette}|${roof}|${it.lod}`;
      if (!groups.has(key)) groups.set(key, { style: it.style, palette: it.palette, roof, lod: it.lod, items: [] });
      groups.get(key).items.push(it);
    }

    const out = new THREE.Group();
    out.name = 'buildings:instanced';
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();

    for (const g of groups.values()) {
      const bake = this._bake(g.style, g.palette);
      const S = STYLES[g.style] || STYLES.townhouse;
      /* The body box gets its OWN geometry per group rather than the shared
         cache other pools use — it now carries `aPhase`, a per-instance
         attribute (one float per building), so a group's instance count has
         to match its own geometry. The box is 24 vertices; building it fresh
         costs nothing next to the group's own 512x512 bake, and `instanced()`
         only runs on camera-move hysteresis, not per frame (see
         docs/BUILDINGS.md, "the night skyline"). */
      const bodyGeo = new THREE.BoxGeometry(1, 1, 1); bodyGeo.translate(0, 0.5, 0);
      /* One draw per seed, deterministic like everything else here, so the
         same building always lights at the same point in the day/night ramp
         rather than reshuffling on every rebuild. */
      const phase = new Float32Array(g.items.length);
      g.items.forEach((it, i) => { phase[i] = rngFrom(it.seed)(); });
      bodyGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
      const body = new THREE.InstancedMesh(bodyGeo, bake.material, g.items.length);
      /* LOD2 is by definition beyond 250 m, further than any sun shadow frustum
         worth keeping tight; skipping the shadow pass for it costs nothing that
         can be seen and saves one draw call per group. */
      body.castShadow = g.lod !== 2;
      body.receiveShadow = true;

      let roofMesh = null;
      /* Flat and pitched now share one fixed eave (see `_roofPrism` above) —
         a single constant instead of a per-roof branch. */
      const roofOverhang = 0.5;
      if (g.lod === 1) {
        const rk = 'roof|' + g.roof;
        // Unit footprint, NO overhang baked in — the overhang goes back in as
        // world-unit metres at instance-matrix time (see roofOverhang below),
        // so it stays a fixed 0.5 m regardless of the instance's scale.
        if (!this._instGeo.has(rk)) this._instGeo.set(rk, this._roofPrism(g.roof, 1, 1, 0));
        roofMesh = new THREE.InstancedMesh(this._instGeo.get(rk), this.mat.roof, g.items.length);
        roofMesh.castShadow = roofMesh.receiveShadow = true;
      }

      g.items.forEach((it, i) => {
        const [w, d] = it.footprint;
        const H = it.floors * S.floorH;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rotationY || 0);
        pos.set(it.position[0], it.position[1] || 0, it.position[2]);
        scl.set(w, H, d);
        body.setMatrixAt(i, m4.compose(pos, q, scl));
        if (roofMesh) {
          pos.set(it.position[0], (it.position[1] || 0) + H, it.position[2]);
          /* The unit prism's rise is `min(1,1) * 0.42` (see `_roofPrism`) — a
             fixed y-scale of 1 carried that 0.42 m rise onto every footprint
             unchanged, so a 20x30 m LOD1 roof was as flat as a 6x8 m one. The
             real rise for this footprint is `min(w,d) * 0.42`, which is what
             scaling the prism's own y by `min(w,d)` reproduces (docs/HANDOFF.md,
             "the island is alive" pass). */
          scl.set(w + roofOverhang, Math.min(w, d), d + roofOverhang);
          roofMesh.setMatrixAt(i, m4.compose(pos, q, scl));
        }
      });
      body.instanceMatrix.needsUpdate = true;
      out.add(body);
      if (roofMesh) { roofMesh.instanceMatrix.needsUpdate = true; out.add(roofMesh); }
    }
    return out;
  }

  /** The grammar tables, for the showcase legend and docs/BUILDINGS.md. */
  static get styles() { return STYLES; }
  static get palettes() { return PALETTES; }
}

export { STYLES, PALETTES };

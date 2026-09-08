/* =============================================================================
   werkstadt — terrain.js
   The ground the whole world stands on: one deterministic heightmap with a
   coastline, a mountain, an industrial valley and a river, plus the meshes that
   draw it (splatted land, reflective sea).

   WHY a heightmap and not a flat plate: the previous world.js put every project
   on one grey grid, and Beri's verdict on it was "boring cities". Geography is
   what makes a map readable at a glance — you know where you are because the
   mountain is over there and the sea is that way. Every region in biomes.js
   reads its ground height back out of heightAt(), so nothing floats and nothing
   sinks: this function is the single source of truth for "where is the ground".

   WHY deterministic (seeded value noise, no Math.random anywhere in here): the
   docs/shots have to reproduce, and a world that reshuffles itself on reload is
   a world nobody can learn.
   ========================================================================== */

import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   THE DIMENSIONS OF THE WORLD — everything else is derived from these
   -------------------------------------------------------------------------- */
export const WORLD = 900;          // side of the square map, world units
export const HALF  = WORLD / 2;
export const SEA   = 0;            // sea level; land is positive, seabed negative
export const COAST_X = 170;        // the waterline runs roughly down this x
export const MOUNTAIN = { x: -150, z: -120, r: 190, h: 165 };   // Knowledge
export const VALLEY   = { x: -110, z:  150, r: 130, d: 20  };   // Dev Logs

/* The river's course, mountain foot to sea. Sampled into a polyline once; the
   Daily bridges and the river trench both read the SAME polyline, which is why
   a bridge always lands across water and never beside it. */
const RIVER_CTRL = [
  [-150, -55], [-118, -12], [-78, 20], [-30, 34], [ 25, 40], [ 92, 48], [175, 58],
];

/* Ideas: three islands offshore, far enough out to read as islands. */
export const ISLANDS = [
  { x: 292, z: -55, r: 34 },
  { x: 348, z:  62, r: 30 },
  { x: 279, z: 148, r: 28 },
];


/* =============================================================================
   NOISE — a seeded value-noise fbm. Twelve lines, no dependency.
   WHY hand-rolled: the whole world needs ONE noise function that JS at build
   time and nothing else ever evaluates. A library for twelve lines would be the
   definition of an unjustified dependency.
   ========================================================================== */
function hash2(ix, iz) {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const smooth = t => t * t * (3 - 2 * t);

function value2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

function fbm(x, z, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += value2(x * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

const smoothstepJS = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

/** A RIDGED MULTIFRACTAL — the shape a mountain summit actually has.

    fbm adds independent octaves, so its detail is the same everywhere and the
    result is a rolling blanket. A ridged multifractal folds each octave
    (1 - |2n - 1|, which puts a crease where the noise crosses its own middle)
    and then WEIGHTS the next octave by the value so far, so a small spur only
    exists on top of a big one and the ground between two spurs stays smooth.
    That dependency is the whole difference between "bumpy" and "a mountain":
    four octaves of plain fbm is noise, four octaves of this is ridges with
    gullies between them.

    Squaring the fold sharpens the crest and flattens the trough, which is what
    turns a rounded fold into a spine. Returns roughly 0..1, mean about 0.42,
    which is why the caller subtracts that before scaling — the summit's mean
    height must not move, only its surface. */
function ridgedMulti(x, z) {
  let sum = 0, amp = 0.5, freq = 1, weight = 1;
  for (let o = 0; o < 4; o++) {
    let n = 1 - Math.abs(value2(x * freq, z * freq) * 2 - 1);
    n *= n;
    n *= weight;
    /* The next octave only exists where this one is high. Clamped, or one loud
       octave multiplies the next into a spike. */
    weight = Math.min(1, n * 2.2);
    sum += n * amp;
    amp *= 0.55; freq *= 2.17;
  }
  return sum;
}


/* =============================================================================
   THE RIVER — one polyline, sampled from the control points above
   ========================================================================== */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export const RIVER = (() => {
  const pts = [];
  const c = RIVER_CTRL;
  for (let i = 0; i < c.length - 1; i++) {
    const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)];
    const steps = i === c.length - 2 ? 24 : 20;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  pts.push(c[c.length - 1].slice());
  return pts;
})();

/** Point on the river at 0..1 along its length. Used to place the Daily bridges
    in date order, so walking downstream IS walking forward in time. */
export function riverAt(t) {
  const f = THREE.MathUtils.clamp(t, 0, 1) * (RIVER.length - 1);
  const i = Math.min(RIVER.length - 2, Math.floor(f));
  const k = f - i;
  return {
    x: RIVER[i][0] + (RIVER[i + 1][0] - RIVER[i][0]) * k,
    z: RIVER[i][1] + (RIVER[i + 1][1] - RIVER[i][1]) * k,
    /* the bank-to-bank direction, for turning a bridge across the water */
    angle: Math.atan2(RIVER[i + 1][1] - RIVER[i][1], RIVER[i + 1][0] - RIVER[i][0]),
  };
}

/* Squared distance to the river polyline. Called once per terrain vertex at
   build time (65k × 125 segments) and then never again — cheap enough there,
   far too expensive per frame, which is why nothing calls it in the loop. */
const R_BB = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of RIVER) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
})();

export function distToRiver(x, z) { return distRiver(x, z); }

function distRiver(x, z) {
  /* Early out on the river's bounding box, padded by the widest trench this is
     ever asked about. Without it every one of the ~120k heightAt() calls in a
     build walks all 125 river segments; with it, most of the map skips the loop
     entirely. */
  if (x < R_BB.x0 - 95 || x > R_BB.x1 + 95 || z < R_BB.z0 - 95 || z > R_BB.z1 + 95) return 999;
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const ax = RIVER[i][0], az = RIVER[i][1];
    const bx = RIVER[i + 1][0], bz = RIVER[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const len = dx * dx + dz * dz;
    let t = len > 0 ? ((x - ax) * dx + (z - az) * dz) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) { best = d; best_t = i / (RIVER.length - 1) + t / (RIVER.length - 1); }
  }
  return Math.sqrt(best);
}
let best_t = 0;   // the parameter of the nearest point, set by distRiver above


/* =============================================================================
   heightAt — THE ground. Everything reads this: terrain vertices, every
   structure's y, every tree, the roads, the camera's floor.
   ========================================================================== */
export function heightAt(x, z) {
  /* 1. The coastal ramp. Land west and centre, sea east. 0.115, not 0.155: at
        the steeper figure the far west stood 96 m above the water and the whole
        landmass read as a tilted slab with a cliff for a rim. */
  let h = (COAST_X - x) * 0.115;

  /* 2. Rolling ground, two scales. */
  h += (fbm(x / 190 + 11.3, z / 190 - 4.1, 4) - 0.5) * 34;
  h += (fbm(x / 46 - 2.7, z / 46 + 8.9, 3) - 0.5) * 7;

  /* 3. The Knowledge mountain: a gaussian with ridged noise on its flanks, so
        the summit is a ridge and not a dome. */
  const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) / MOUNTAIN.r;
  if (md < 2.2) {
    const g = Math.exp(-md * md * 1.35);
    const ridge = 1 - Math.abs(fbm(x / 70, z / 70, 3) * 2 - 1);
    h += MOUNTAIN.h * g * (0.72 + 0.5 * ridge);
    /* THE SUMMIT. One ridged octave at 70 m over a gaussian is a smooth dome
       with a slight lean — which is exactly what the third-pass capture showed,
       "a smooth snowy dome". What makes a real summit is that ridges FORK: a
       spur throws two smaller spurs, each of those throws two more, and the
       gullies between them are what snow and shadow collect in. That is a
       ridged MULTIFRACTAL — each octave's ridge multiplied by the previous
       octave's value, so detail only appears where there is already a ridge to
       carry it, and the flat ground between spurs stays flat. Four octaves,
       and only over the top 35% of the cone (g > 0.65 is the upper third of the
       gaussian's height), so the foothills keep the shape the whole map was
       laid out against and only the part the eye actually reads as "mountain"
       gets torn up. */
    if (g > 0.16) {
      const top = smoothstepJS(0.16, 0.58, g);      // 0 at the foot, 1 near the top
      /* Two scales of it: 96 m carves the main spurs and the gullies between
         them, 34 m breaks each spur's own crest so a ridge is not a smooth
         hogback. 0.46 of the mountain's height on the first is a lot, and it has
         to be — at 0.30 the summit was still a dome with a texture on it, which
         is the exact verdict this pass exists to answer. */
      h += MOUNTAIN.h * top * 0.46 * (ridgedMulti(x / 96 + 5.1, z / 96 - 3.4) - 0.42);
      h += MOUNTAIN.h * top * 0.13 * (ridgedMulti(x / 34 - 2.6, z / 34 + 7.2) - 0.42);
    }
  }

  /* 4. The Dev Logs valley: a bowl pressed into the ground south of the
        mountain, which is what makes it read as a valley rather than a field. */
  const vd = Math.hypot(x - VALLEY.x, z - VALLEY.z) / VALLEY.r;
  h -= VALLEY.d * Math.exp(-vd * vd * 1.1);

  /* 5. The river trench. Near the water the ground is pulled down to a bed that
        descends monotonically to the sea — a river that ran uphill would be the
        loudest possible "this is fake". */
  const rd = distRiver(x, z);
  if (rd < 90) {
    const pull = Math.exp(-(rd / 34) * (rd / 34));
    h = h * (1 - pull) + (riverBank(best_t) - 3.2 * Math.exp(-(rd / 13) * (rd / 13))) * pull;
  }

  /* 6. The Ideas islands, pushed up out of the sea offshore. */
  for (const is of ISLANDS) {
    const d = Math.hypot(x - is.x, z - is.z) / is.r;
    if (d < 2.4) h += (18 - h) * Math.exp(-d * d * 1.6) * 0.92;
  }

  /* 7. The map's own edge. This is what makes the world an ISLAND rather than a
        square plate of land floating on a sheet of water: past 72% of the
        half-width the ground falls away, quadratically, to 260 m below the
        surface at the rim. Measured on the first wide capture — with a linear
        46 m drop the far edge was still 50 m ABOVE the sea and the frame's whole
        left half was a straight cut through solid ground. The start is 0.72 and
        not lower because the Templates quarry and the Orphan ruins live at 0.71
        and 0.78 and both have to stay on dry land. */
  /* A pure max() falloff cuts the island as a diamond with four straight
     coastlines — visible in the first island capture as a ruled diagonal across
     the whole bottom-left. A pure radial one rounds the corners so hard that the
     Orphan ruins end up at sea. The mix does both, and the noise term is what
     stops the coast being a curve anyone can see was drawn by a formula. */
  const eSquare = Math.max(Math.abs(x), Math.abs(z)) / HALF;
  const eRound  = Math.hypot(x, z) / (HALF * 1.34);
  const edge = eSquare * 0.7 + eRound * 0.3 + (fbm(x / 250 + 3.3, z / 250 + 7.7, 3) - 0.5) * 0.17;
  if (edge > 0.72) { const k = (edge - 0.72) / 0.28; h -= k * k * 300; }

  return h;
}

/** The height of the river's bank at 0..1 downstream: 7.9 at the source, 0.4 at
    the mouth, so the water always runs downhill. heightAt() carves the trench to
    this profile and buildRiver() in world.js floats its surface just under it —
    ONE profile, so the water can never sit above its own banks. */
export const riverBank = t => 7.5 * (1 - t) + 0.4;
export const riverSurface = t => riverBank(t) - 2.5;

/** Ground height, never below the waterline — for anything that must stand on
    dry land (a tree, a house, a road post). */
export const landAt = (x, z) => Math.max(SEA + 0.15, heightAt(x, z));

/** Surface slope, 0 flat … 1 vertical. Used to keep forests and buildings off
    cliffs, and by the splat shader to paint rock where it is steep. */
export function slopeAt(x, z, s = 4) {
  const dx = heightAt(x + s, z) - heightAt(x - s, z);
  const dz = heightAt(x, z + s) - heightAt(x, z - s);
  return Math.min(1, Math.hypot(dx, dz) / (2 * s) * 0.9);
}


/* =============================================================================
   THE LAND MESH
   One plane, displaced by heightAt, with four PBR layers blended by height and
   slope in the fragment shader — sand at the water, grass on the flats, forest
   floor at mid altitude, cliff rock where it is steep or high.

   WHY the splat is rules and not a painted mask: 65k vertices painted by hand is
   not a thing a person does twice, and the rules re-derive themselves the moment
   the heightmap changes.

   WHY only ONE normal map (grass) and not four: blending tangent-space normals
   across four layers needs a derivative TBN per layer, which triples the
   fragment cost of the single biggest mesh on screen for detail the camera
   never gets close enough to see. The geometry's uv is pre-tiled at grass scale
   so the normal map still lands at the right size everywhere.
   ========================================================================== */
export function buildTerrain(tex, segments) {
  const seg = segments;
  const geo = new THREE.PlaneGeometry(WORLD, WORLD, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const W = seg + 1;                                   // vertices per row
  const H = new Float32Array(pos.count);               // every vertex's height, kept
  /* MACRO AND CONCAVITY, PER VERTEX — not per pixel.

     The macro noise used to be three octaves of a sin-hash value noise
     evaluated in the FRAGMENT shader, on the mesh that covers most of the
     screen: twelve sin() per pixel for a signal whose shortest wavelength is
     sixteen metres. The grid here is three metres per cell, so every one of
     those wavelengths is resolved five times over by the vertices themselves —
     the interpolator draws the same field for nothing. Measured cost of the
     move: see docs/HANDOFF.md's fps table.

     Concavity is the discrete Laplacian of the height grid: positive in a
     gully, negative on a spur. It is what tells the shader where snow can lie
     and where rock is blown bare, and computing it from the grid that was just
     filled costs no extra heightAt() calls at all. */
  const macro = new Float32Array(pos.count);
  const conc = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    H[i] = h;
    pos.setY(i, h);
    /* Three octaves, the longest carrying the wide shot and the shortest the
       harbour close-up. 16 m and not the shader's old 11: at medium quality the
       grid is 4.1 m per cell, and an 11 m wavelength sampled 2.7 times aliases
       into blotches the moment the quality toggle is pressed. */
    macro[i] = fbm(x / 118 + 3.1, z / 118 - 6.2, 1) * 0.55
             + fbm(x / 37 - 8.4, z / 37 + 2.9, 1) * 0.29
             + fbm(x / 16 + 1.7, z / 16 + 9.3, 1) * 0.16;
    /* World-space uv at the grass texture's own metres-per-tile, so normalMap
       and any native map land at real-world scale without a repeat hack. */
    uv.setXY(i, (x + HALF) / 2.0, (z + HALF) / 2.0);
  }
  const cell = WORLD / seg;
  for (let j = 0; j < W; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const l = H[j * W + Math.max(0, i - 1)], r = H[j * W + Math.min(W - 1, i + 1)];
      const u = H[Math.max(0, j - 1) * W + i], d = H[Math.min(W - 1, j + 1) * W + i];
      /* Normalised by the cell so the number means the same thing at both
         quality settings, and squashed into −1…1 by a soft clamp: a cliff edge
         would otherwise read as a hundred times more concave than a gully and
         drown everything else out. */
      const lap = (l + r + u + d - 4 * H[k]) / cell;
      conc[k] = Math.max(-1, Math.min(1, lap * 0.55));
    }
  }
  geo.setAttribute('aMacro', new THREE.BufferAttribute(macro, 1));
  geo.setAttribute('aConc', new THREE.BufferAttribute(conc, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: tex.grass.diffuse,
    normalMap: tex.grass.normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });

  mat.userData.uniforms = {
    tSand:   { value: tex.sand.diffuse },
    tGrass:  { value: tex.grass.diffuse },
    tForest: { value: tex.forestFloor.diffuse },
    tCliff:  { value: tex.cliff.diffuse },
    tGrassArm: { value: tex.grass.arm },
    tCliffArm: { value: tex.cliff.arm },
    /* The rock's own relief. The stock chunk lands the GRASS normal map at the
       geometry's uv everywhere; a mountainside lit by a low sun with a meadow's
       normal on it is the flattest thing in the frame. */
    tCliffNrm: { value: tex.cliff.normal },
    /* Seconds. The only animated thing on the ground: the surf line. */
    uTime:   { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; varying vec3 vWNrm;
        attribute float aMacro; attribute float aConc;
        varying float vMacro; varying float vConc;`)
      .replace('#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vMacro = aMacro; vConc = aConc;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        /* MACRO VARIATION and CONCAVITY, both interpolated from the vertices.
           Nine hundred metres of ground carrying one 3 m texture is one flat
           colour with a weave in it however many scales it is sampled at; what
           the eye reads at wide-shot distance is the tens-of-metres wavelength,
           and the tile is never what it is looking at. That field used to be
           three octaves of a sin-hash noise per PIXEL — twelve sin() on the
           mesh that covers most of the screen, for a signal the 3 m vertex grid
           already resolves five times over. It is a vertex attribute now, and
           the picture is the same one.
           vConc is the height grid's own Laplacian: > 0 in a gully, < 0 on a
           spur. It is what decides where snow can lie. */
        varying float vMacro; varying float vConc;
        uniform sampler2D tSand, tGrass, tForest, tCliff, tGrassArm, tCliffArm, tCliffNrm;
        uniform float uTime;
        /* The one noise still evaluated per pixel: the fine grain, at 4.6 m,
           which is below the vertex grid and therefore cannot come from it. */
        float mhash(vec2 i){ return fract(sin(dot(i, vec2(41.7, 289.3))) * 43758.5453); }
        float mnoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mhash(i), mhash(i + vec2(1.0, 0.0)), f.x),
                     mix(mhash(i + vec2(0.0, 1.0)), mhash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        /* The splat weights. One place, so the colour and the roughness can
           never disagree about what material a pixel is standing on. */
        vec4 splatW(float slope) {
          float h = vWPos.y;
          float sand   = smoothstep(4.2, 0.4, h);
          /* 0.13, not 0.26: the Knowledge mountain rises 165 m over a 190 m
             radius, which is only a 0.25 slope reading — at the old threshold
             the whole mountainside was painted as meadow and the flat xz
             projection smeared it into contour stripes. A mountainside is rock. */
          float cliff  = smoothstep(0.13, 0.34, slope) + smoothstep(62.0, 96.0, h);
          float forest = smoothstep(26.0, 42.0, h) * (1.0 - smoothstep(70.0, 100.0, h));
          float grass  = 1.0;
          cliff = clamp(cliff, 0.0, 1.0);
          forest *= (1.0 - cliff);
          grass  *= (1.0 - cliff) * (1.0 - forest);
          vec4 w = vec4(sand, grass, forest, cliff);
          return w / max(1e-4, w.x + w.y + w.z + w.w);
        }`)
      .replace('#include <map_fragment>', `
        float slopeF = 1.0 - clamp(vWNrm.y, 0.0, 1.0);
        vec4 W = splatW(slopeF);
        /* ONE fine octave for the whole fragment; the macro field arrives
           interpolated from the vertices and every noise term below is built
           out of those two numbers. The first version of this pass called
           macro() three times over and mnoise() twice more on top — eleven noise
           evaluations and forty-four sin() per pixel, on the mesh that covers
           most of the screen. Measured at 20 fps on the real Radeon. */
        float m = vMacro;
        float nFine = mnoise(vWPos.xz / 4.6);
        /* Every layer is sampled at TWO scales and averaged. A 1 m texture over a
           400 m mountain repeats four hundred times and the repetition beats
           into concentric moiré rings that read as contour lines — measured on
           the first dusk capture. A second sample at 5.7x breaks the period for
           the cost of four more taps, which is the cheapest fix there is. */
        vec3 sand   = mix(texture2D(tSand,   vWPos.xz / 15.0).rgb, texture2D(tSand,   vWPos.xz / 71.0).rgb, 0.4);
        vec3 grass  = mix(texture2D(tGrass,  vWPos.xz /  3.4).rgb, texture2D(tGrass,  vWPos.xz / 19.0).rgb, 0.5);
        vec3 forest = mix(texture2D(tForest, vWPos.xz / 3.6).rgb, texture2D(tForest, vWPos.xz / 21.0).rgb, 0.5);
        /* Rock is TRIPLANAR, the other three are not. A flat xz projection on a
           40-degree mountainside stretches the texture along the slope into
           contour stripes that read as a topographic map — the second-worst
           thing this ground did, and visible from across the room. Three taps
           projected from three axes removes it completely; the flat layers
           never see a slope steep enough to need it.
           26 m per tile, not 14 and not the pack's 1.83: cliff_side is a
           STRATIFIED rock, and at 14 m its strata still beat into the woven
           basket pattern that was the loudest fake thing in the first dusk
           capture — visible from across the room. At 26 m, cross-faded a third
           of the way into a second sample at 11.5 m off swapped axes, the strata
           are metres apart the way rock strata are and the period never closes. */
        /* DOMAIN WARP, and a SWIZZLE on the second scale. Two scales of one
           texture were not enough: the Knowledge mountain is close to a cone, so
           its up-facing triplanar plane sees the rock in plan view and lays the
           same strata down as concentric contour bands — measured on the second
           dusk capture, and it is the basket weave the verdict named. Two scales
           of the SAME projection cannot fix that, because they share the grid
           they repeat on. Pushing the sample point around by the macro noise
           bends the grid, and reading the second scale off swapped axes means
           the two never line their periods up again. */
        /* And the Y coordinate of the two vertical planes is warped HARD — plus
           or minus nine metres against a 26 m period. A ring survives a warp
           only while the warp is constant along it; a noise that changes faster
           than the band is wide breaks every ring into blotches, which is what
           weathered rock looks like anyway. */
        /* 7 and 5, not 13 and 9. The warp exists to break the concentric rings a
           plan projection of a stratified rock draws on a cone; at the old
           amplitude, against a 26 m period, it did break them — and turned the
           strata into marble swirl, which reads as polished stone rather than as
           a mountainside. Half the push still breaks every ring and leaves the
           bedding planes running the way bedding planes run. */
        float wy = (m - 0.5) * 7.0 + (nFine - 0.5) * 5.0;
        float wx = (nFine - 0.5) * 5.0;
        vec3 cp  = vec3(vWPos.x + wx, vWPos.y + wy, vWPos.z - wx) / 26.0;
        vec3 cp2 = vec3(vWPos.z - wx, vWPos.y + wy * 1.7, vWPos.x + wx) / 11.5;
        /* THE ROCK, AND THE TWO REAL BRANCHES ON THIS MESH.

           1. W.w > 0.02 — most of this island is meadow, forest and sand, and
              on all of it the rock's weight is exactly zero. GLSL evaluates
              both sides of an expression, so those pixels were paying for six
              cliff taps, a warp and three normal taps to multiply the result by
              nothing. A real branch skips them, and the terrain is the mesh that
              covers most of the screen.
           2. slope > 0.45 — triplanar exists to stop a flat xz projection
              smearing the texture along a steep face. On ground gentler than
              about 24 degrees there is nothing to smear, so a single plan tap
              is the same picture for a third of the taps. Above it, the full
              three-axis blend at two scales, which is what makes an OUTCROP
              read as broken rock and not as a brown patch.
           Divergence is not the worry it looks like: rock and meadow are
           hundreds of metres apart, so a warp of pixels almost always agrees. */
        vec3 cliff = vec3(0.35);
        vec3 cw = vec3(0.0, 1.0, 0.0);
        if (W.w > 0.02) {
          if (slopeF > 0.45) {
            /* Power 6, not 4. On the Knowledge mountain's 41-degree flank the
               up-facing plane already carries most of the weight; pushing it to
               0.85 matters because the up-facing plane is the ONLY one of the
               three that does not index the texture by world Y — and world Y is
               where the banding comes from. */
            vec3 w3 = pow(abs(vWNrm), vec3(6.0));
            cw = w3 / max(1e-4, w3.x + w3.y + w3.z);
            cliff = mix(
              texture2D(tCliff, cp.yz).rgb * cw.x + texture2D(tCliff, cp.xz).rgb * cw.y
                + texture2D(tCliff, cp.xy).rgb * cw.z,
              texture2D(tCliff, cp2.yz).rgb * cw.x + texture2D(tCliff, cp2.xz).rgb * cw.y
                + texture2D(tCliff, cp2.xy).rgb * cw.z, 0.32);
          } else {
            cliff = mix(texture2D(tCliff, cp.xz).rgb, texture2D(tCliff, cp2.xz).rgb, 0.32);
          }
        }
        /* The pack's "leafy grass" is a DRY grass: its average is (151,131,89),
           a tan. Measured, after a whole world came out the colour of sand. The
           texture's detail is what is wanted, its hue is not, so the layer is
           tinted to a living green at constant luminance and the forest floor is
           pushed a little towards moss. Nothing about the DATA is tinted — this
           is one material decision about one CC0 texture. */
        grass  *= vec3(0.62, 1.02, 0.48);
        forest *= vec3(0.66, 0.88, 0.52);
        /* And cliff_side is a RED sandstone. A red mountain under a warm dusk
           haze is most of why the first two captures came back as one hue with
           nothing to contrast against — the same measured-tint decision the
           grass above already needed, in the other direction. Pulled two thirds
           of the way to its own luminance and then tipped cool, which is what
           limestone under a setting sun does. */
        cliff = mix(cliff, vec3(dot(cliff, vec3(0.299, 0.587, 0.114))), 0.55)
              * vec3(0.92, 0.93, 1.0);
        vec3 albedo = sand * W.x + grass * W.y + forest * W.z + cliff * W.w;

        /* The macro pass. m is one number per ~40 m of ground; it swings the
           albedo by nearly a stop and pulls the greens between a dry yellow and
           a wet olive, which is what stops a hundred hectares of one texture
           reading as a lawn. */
        albedo *= 0.70 + 0.62 * m;
        albedo *= mix(vec3(1.06, 0.96, 0.80), vec3(0.86, 1.04, 0.86), m) * (W.y + W.z) + (1.0 - W.y - W.z);

        /* SNOW on the summit. The Knowledge mountain tops out at 165 m; above
           118 the sun-facing rock holds snow and the sheer faces do not, which
           is the whole rule. Warm-white, not paper-white: at dusk snow is the
           colour of the sky that lights it. */
        /* The snow line is a LINE. Ramped over 40 m it was a forty-metre band of
           haze sitting on the mountain, and at an albedo of 0.8 under a bloom
           threshold of 0.62 it blew out into a white cloud — which is what the
           second capture actually showed. Over 14 m, broken by the macro noise
           so the edge is ragged, and at 0.46 it stays a snowfield rather than a
           light source. */
        float snow = smoothstep(143.0, 161.0, vWPos.y + (m - 0.5) * 22.0)
                   /* Snow LIES; it does not stick. Anything steeper than about
                      fifteen degrees sheds it, and the bare ridges between the
                      fields are the only reason a white summit reads as a
                      mountain rather than as a dome of plastic. */
                   * (1.0 - smoothstep(0.22, 0.42, slopeF))
                   /* And it COLLECTS. Slope-shed alone still whitens every
                      gentle face at altitude equally, which is the smooth snowy
                      dome the third-pass verdict named. Snow above a snowline
                      blows off the spurs and packs into the gullies, so a real
                      summit is white in the folds and grey-brown along every
                      crest. vConc is the height grid's own Laplacian — positive
                      in a hollow, negative on a spine — so this is that rule
                      stated directly. Never to zero on the convex side: a
                      windward spur at 160 m still holds a rime, and a hard cut
                      would draw the ridge lines as ink. */
                   * (0.30 + 0.70 * smoothstep(-0.16, 0.24, vConc));
        /* NEVER all the way to a flat colour. Replacing the albedo outright gave
           the summit a featureless plastic dome — measured on the mountain
           capture, and it is the same board-game tell the ground itself had.
           Snow lies IN rock: it fills the hollows, the ridges stay bare, and
           what reads from a hundred metres is that contrast. Capping the mix at
           0.78 and breaking it with a fine grain keeps the rock and its normal
           map showing through everywhere. */
        float grain = 0.70 + 1.20 * nFine * m;
        albedo = mix(albedo, vec3(0.40, 0.40, 0.43) * (0.66 + 0.34 * m) * grain,
                     clamp(snow, 0.0, 1.0) * 0.62);

        /* WET SAND, and then the surf on top of it. Below the waterline the
           beach is dark and specular; the band the water actually runs up and
           down is a moving white line. Both are drawn on the LAND, not on the
           sea: the sea plane is opaque and knows nothing about where the shore
           is, and a foam line painted on the ground is in exactly the right
           place by construction. */
        float wet = smoothstep(2.0, -0.2, vWPos.y);
        albedo *= mix(vec3(1.0), vec3(0.46, 0.44, 0.42), wet * 0.9);
        float surfBand = smoothstep(0.72, 0.28, vWPos.y) * smoothstep(-0.35, 0.06, vWPos.y);
        float surf = surfBand * (0.45 + 0.55 * sin(vWPos.x * 0.42 + vWPos.z * 0.31 + uTime * 1.4));
        albedo += vec3(0.9, 0.93, 0.95) * clamp(surf, 0.0, 1.0) * 0.42;

        /* 1.06, not 1.35: the old boost existed to fight an exposure of 1.05 and
           a flat hemisphere fill. With the exposure at 0.66 and the light coming
           off the HDRI it only crushed the ground into a bright flat card. */
        diffuseColor.rgb *= albedo * 1.06;`)
      .replace('#include <roughnessmap_fragment>', `
        /* ARM packing from the asset pack: r = AO, g = roughness. */
        vec2 armG = texture2D(tGrassArm, vWPos.xz / 2.0 ).rg;
        /* Triplanar, at the albedo's own scale and off the same warped point:
             a PLAN projection of the rock's AO on a cone is the same contour
             banding the colour had, drawn a second time in shadow. */
        /* One tap, not three. Its coordinates are the WARPED ones, and a warped
           plan projection cannot draw the contour bands a straight one did —
           which is the only thing the three taps were bought to fix. */
        vec2 armC = texture2D(tCliffArm, cp.xz).rg;
        float roughnessFactor = roughness * mix(armG.g, armC.g, W.w);
        /* Wet sand is the only glossy ground in the world, and it is what makes
           a waterline read as water meeting land rather than as two colours
           meeting. Snow goes the other way — matte, and slightly self-lit. */
        roughnessFactor = mix(roughnessFactor, 0.24, wet * 0.85);
        roughnessFactor = mix(roughnessFactor, 0.92, snow);
        diffuseColor.rgb *= mix(armG.r, armC.r, W.w) * 0.5 + 0.5;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        /* The rock's relief, projected the same three ways its colour is, and
           blended in WORLD space rather than tangent space. A triplanar tangent
           frame is three TBNs and a derivative solve per layer; at this altitude
           the difference between that and a perturbation of the surface normal
           is a shade of grey, and this is the difference between a mountain with
           facets on it and a brown cone. Weighted by the rock's own splat weight,
           so the meadow never sees it. */
        /* Gated exactly like the albedo above, and for the same reason: on a
           meadow W.w is zero and these three taps multiply out to nothing. On
           the gentle side of the slope branch cw is (0,1,0), so the blend
           collapses to the one plan tap by construction rather than by a second
           copy of the branch. */
        if (W.w > 0.02) {
          /* One scale for the relief, not two: the second scale exists to break the
             albedo's PERIOD, and a normal map here has no period to break — its
             only job is to stop the mountainside being flat. Three taps saved on
             the biggest mesh on screen. */
          vec3 cn = slopeF > 0.45
                  ? texture2D(tCliffNrm, cp.yz).rgb * cw.x
                    + texture2D(tCliffNrm, cp.xz).rgb * cw.y
                    + texture2D(tCliffNrm, cp.xy).rgb * cw.z
                  : texture2D(tCliffNrm, cp.xz).rgb;
          normal = normalize(normal + (cn * 2.0 - 1.0) * (W.w * 0.7));
        }`);
  };
  /* Two materials that compile to different programs must not share a cache
     key, and Three keys on this string. */
  mat.customProgramCacheKey = () => 'terrain-splat-v3';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}


/* =============================================================================
   THE SEA
   three/addons Water: a real planar reflection, which is the single cheapest
   thing on this list that makes the frame read as a game rather than a diagram.
   The caller narrows what gets reflected (see world.js) — reflecting six
   thousand trees costs more than it shows.
   ========================================================================== */
export function buildWater(Water, normalsTex, size, res, heightTex) {
  const geo = new THREE.PlaneGeometry(size, size);
  const water = new Water(geo, {
    textureWidth: res, textureHeight: res,
    waterNormals: normalsTex,
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: 0xffe9c4,
    waterColor: 0x11303c,
    distortionScale: 2.6,
    fog: true,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = SEA;
  water.name = 'sea';
  if (heightTex) addShoreDepth(water, heightTex);
  return water;
}

/** THE MEDIUM-QUALITY SEA — the same water with no second render of the world.

    The addon's Water is a planar reflector: it renders the entire scene a
    second time, from a mirrored camera, into an offscreen target, every frame.
    Bisected on the real Radeon it was the single most expensive thing in the
    frame by a wide margin — eleven fps of a twenty-nine fps budget — and at
    medium quality, which exists so a loaded machine can still run this, paying
    for a second full scene pass is the wrong trade.

    What replaces it is where a reflection at a grazing angle actually comes
    from: the sky. The PMREM'd dusk HDRI is already loaded, already knows where
    the sun set and how bright the horizon is, and a smooth metallic surface
    reading it through a Fresnel term gives the same sheet of sky lying on the
    water for one texture fetch. What is genuinely lost is the harbour front's
    own inverted image, which at this camera distance is a dozen pixels tall.

    The depth colouring and the surf line are the same rules the reflective
    version carries, off the same seabed texture, so the two qualities disagree
    about the reflection and about nothing else. */
export function buildCheapWater(normalsTex, size, heightTex) {
  const geo = new THREE.PlaneGeometry(size, size);
  const nrm = normalsTex.clone();
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  /* One repeat per 32 m of water. The plane is 30 km across, so this is the
     number that decides the ripple's size and nothing else does. */
  nrm.repeat.set(size / 32, size / 32);
  nrm.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x11303c, roughness: 0.06, metalness: 0.72,
    normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 1.8, fog: true,
  });
  const uni = { tBed: { value: heightTex }, uHalf: { value: HALF }, uSurf: { value: 0 } };
  mat.userData.uniforms = uni;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeaPos;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\n  vSeaPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSeaPos;
        uniform sampler2D tBed; uniform float uHalf; uniform float uSurf;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        /* The seabed under this fragment, in metres below the surface — the same
           256² byte texture and the same ±40 m packing the reflective version
           reads, so the shallows are turquoise in exactly the same places. */
        vec2 bedUv = (vSeaPos.xz + uHalf) / (uHalf * 2.0);
        float bed = texture2D(tBed, bedUv).r * 80.0 - 40.0;
        float deep = max(0.0, -bed);
        diffuseColor.rgb = mix(vec3(0.13, 0.32, 0.31), vec3(0.012, 0.036, 0.058),
                               smoothstep(0.4, 6.5, deep));
        `)
      /* metalnessFactor and roughnessFactor are declared by their OWN chunks,
         further down the shader than <color_fragment> — the depth this needs is
         therefore recomputed here rather than carried forward in a varying that
         would cost every fragment on every other material in the scene. */
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float deepR = max(0.0, -(texture2D(tBed, (vSeaPos.xz + uHalf) / (uHalf * 2.0)).r * 80.0 - 40.0));
        /* Shallow water is not a mirror: the bottom scatters light back and the
           Fresnel term stops winning. Roughening and de-metalling the shallows
           is what keeps the beach from looking like polished steel. */
        roughnessFactor = mix(0.34, roughnessFactor, smoothstep(0.2, 4.0, deepR));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= smoothstep(0.2, 3.5, deepR) * 0.85 + 0.15;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        /* Surf, on the same clock and the same rule as the beach's own foam
           line, so the two do not run out of step where they meet. */
        float band = smoothstep(1.0, -0.05, deep) * smoothstep(-0.5, 0.08, deep);
        float foam = band * (0.5 + 0.5 * sin(vSeaPos.x * 0.4 + vSeaPos.z * 0.3 + uSurf * 1.4));
        totalEmissiveRadiance += vec3(0.88, 0.91, 0.93) * clamp(foam, 0.0, 1.0) * 0.5;`);
  };
  mat.customProgramCacheKey = () => 'cheap-water-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = SEA;
  mesh.name = 'sea';
  return mesh;
}

/** Depth-based colour and a surf line, patched into the addon's own shader.
    WHY a patch and not a second mesh: the reflective Water is a ShaderMaterial
    with no chunk hooks, but it already carries `worldPosition` as a varying, so
    the one thing it is missing is knowing how deep it is — and the seabed is a
    function this file owns. A 256² byte texture of heightAt() answers that for a
    quarter of a megabyte, and turns a flat blue-grey sheet into shallows that go
    turquoise over sand and ink over the drop-off, with white water where the
    bed comes up to meet it.

    Every string this replaces is checked first: if a future three renames one,
    the patch is skipped and the sea is exactly what it was, rather than a page
    of shader errors. */
function addShoreDepth(water, heightTex) {
  const u = water.material.uniforms;
  const f = water.material.fragmentShader;
  const DECL = 'uniform vec3 waterColor;';
  const HOOK = 'vec3 outgoingLight = albedo;';
  if (f.indexOf(DECL) < 0 || f.indexOf(HOOK) < 0) return;
  u.tBed = { value: heightTex };
  u.uHalf = { value: HALF };
  u.uSurf = { value: 0 };
  water.material.fragmentShader = f
    .replace(DECL, DECL + `
      uniform sampler2D tBed; uniform float uHalf; uniform float uSurf;`)
    .replace(HOOK, `
      /* The seabed under this fragment, in metres below the surface. Outside the
         island's own square the texture clamps to its rim, which is the bottom
         of the shelf — so the open ocean is deep, which it is. */
      vec2 bedUv = (worldPosition.xz + uHalf) / (uHalf * 2.0);
      float bed = texture2D(tBed, bedUv).r * 80.0 - 40.0;
      float deep = max(0.0, -bed);
      /* Shallow water takes its colour from the sand under it; deep water has
         no bottom to take one from. */
      /* 0.4 to 6.5 m, not to 19: the island's shelf is shallow for hundreds of
         metres, so a ramp that long painted the whole sea turquoise and it read
         as milk. The turquoise belongs to the few metres you can actually see
         the sand through. */
      vec3 shallowC = vec3(0.13, 0.32, 0.31);
      vec3 deepC    = vec3(0.012, 0.036, 0.058);
      vec3 body = mix(shallowC, deepC, smoothstep(0.4, 6.5, deep));
      /* The reflection still wins at a grazing angle — that is Fresnel and it is
         what makes the sky sit on the water. The body colour only replaces the
         scatter term, which is where the addon's flat blue-grey came from. */
      vec3 outgoingLight = mix(body * (0.42 + diffuseLight.r * 0.30), albedo,
                               clamp(reflectance * 1.15 + 0.22, 0.0, 1.0));
      /* Surf: white water where the bed is within a metre of the surface,
         broken by the same noise the ripples come from so it is a line of foam
         and not a contour. */
      float band = smoothstep(1.0, -0.05, deep) * smoothstep(-0.5, 0.08, deep);
      float foam = band * (0.5 + 0.5 * sin(worldPosition.x * 0.4 + worldPosition.z * 0.3
                                           + uSurf * 1.4 + noise.x * 6.0));
      outgoingLight += vec3(0.88, 0.91, 0.93) * clamp(foam, 0.0, 1.0) * 0.7;`);
}

/** The seabed as a texture, for the water shader above. One byte per texel over
    a ±40 m range — 31 cm of resolution, which is far finer than a foam line
    needs and a thousandth of what a float target would cost. */
export function buildHeightTexture(size) {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const z = -HALF + (j + 0.5) / size * WORLD;
    for (let i = 0; i < size; i++) {
      const x = -HALF + (i + 0.5) / size * WORLD;
      data[j * size + i] = THREE.MathUtils.clamp((heightAt(x, z) + 40) / 80 * 255, 0, 255);
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}


/* =============================================================================
   THE SUN — real wall clock, real latitude
   A compact solar-position solve for Tirol (where the machine and the person
   both are). WHY not a made-up sine: the brief's first anti-goal is that
   nothing is fake, and "the sun is where the sun is" is the cheapest possible
   way to keep the light honest. Accuracy is a degree or so, which at this scale
   is a pixel.
   ========================================================================== */
const LAT = 47.27 * Math.PI / 180;    // Innsbruck
const LON = 11.39;

export function sunAngles(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const decl = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (day + 10) / 365.25);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  /* Solar hour angle: 15° per hour from local solar noon. */
  const hourAngle = (utcHours + LON / 15 - 12) * 15 * Math.PI / 180;
  const elev = Math.asin(Math.sin(LAT) * Math.sin(decl) +
                         Math.cos(LAT) * Math.cos(decl) * Math.cos(hourAngle));
  const az = Math.atan2(Math.sin(hourAngle),
                        Math.cos(hourAngle) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT));
  return { elevation: elev, azimuth: az + Math.PI };
}

/** The sun's direction as a unit vector in world space, +z = north. */
export function sunVector(date) {
  const { elevation, azimuth } = sunAngles(date);
  const c = Math.cos(elevation);
  return new THREE.Vector3(c * Math.sin(azimuth), Math.sin(elevation), -c * Math.cos(azimuth));
}

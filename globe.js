/* =============================================================================
   werkstadt — globe.js
   THE PLANET. Every project Claude Code has ever worked in, every note in the
   vault, placed on a real sphere with continents, an ocean, an atmosphere and a
   day/night terminator taken from the wall clock.

   WHY a globe and not the island in world.html: the island could only ever be
   ONE place. Beri's verdict was exact — "not a world — you built one island. I
   asked for a real spherical world with cities, settlements, towns, fields."
   A sphere is the only shape that lets five unrelated bodies of work be five
   DIFFERENT places with sea between them, lets you leave one and arrive at
   another, and lets the machine's own clock light half of it.

   WHY the settlement class is the work and nothing else: a map whose town sizes
   are arbitrary is decoration. Here the class is read off /api/world's real
   tool_calls and last_active, so a project that has had 25,000 tool calls IS a
   city and one nobody has opened in three months IS a field with a barn on it.
   The mapping table is in docs/HANDOFF.md and nowhere else is allowed to guess.

   WHAT THIS FILE OWNS: globe.html only. world.js, city.js, interior.js and
   server.py are untouched — the one thing imported from the existing world is
   biomes.js's hash32(), because a town must land on the same square metre in
   both views and two copies of a hash is how that quietly stops being true.
   ========================================================================== */

import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/* The ONE thing imported from the existing world. hash32 is pure and exported;
   everything else in terrain.js is a function of a 900x900 SQUARE map (heightAt,
   buildTerrain, the river polyline) and has no meaning on a sphere, so it is not
   imported rather than half-used. See docs/HANDOFF.md -> "what was reused". */
import { hash32 } from './biomes.js';

/* The building generator, used exactly as docs/BUILDINGS.md says to integrate
   it: ONE shared kit, a CATALOGUE of ten types so instanced() groups stay in
   the tens rather than the hundreds, front on -Z, and setNight() wired to this
   page's own sun instead of a second clock. buildings.js is NOT edited from
   here — only its public API is called. */
import { BuildingKit } from './buildings.js';
/* THE LIVING LAYER and THE FLEET, integrated exactly as docs/LIFE.md and
   docs/DRONES.md say to: ONE Life.load() and ONE DroneKit.load() for the whole
   page, every count fed from real data, and neither file edited from here. */
import { Life } from './life.js';
import { DroneKit } from './drones.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
/* `setMeshoptDecoder` OR NOTHING, and the symptom is silence. The Hunyuan files
   under assets/hunyuan/ are EXT_meshopt_compression; without the decoder the
   loader throws inside its own promise and every landmark scan is simply
   missing, with `__landmarks().models` empty and no error anywhere. Measured on
   this page's first run: six files on disk, zero loaded. */
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
/* The enter / exit / search buttons. This page owns what those three words
   MEAN here; controls.js owns the buttons, their labels and their states. It
   exists because Lively forwards mouse only to `?wallpaper=1` — see the header
   comment in controls.js. */
import * as Controls from './controls.js';


/* =============================================================================
   THE DIMENSIONS OF THE PLANET — everything else is derived from these
   ========================================================================== */
export const R = 600;              // sea level radius, world units
/* 1.11, not the 1.055 an Earth-to-scale atmosphere would be. This planet's
   settlements are 20 to 60 units across on a 600-unit radius, so its "street
   level" sits 15 to 60 units up — 2 to 10 % of the radius, which on a real
   planet is low orbit. A 1.055 shell put the camera OUTSIDE the air at every
   altitude a town is legible from, and the first street capture had a black
   sky over a sunlit village. The shell has to reach where this world is
   actually walked. */
/* 1.34, up from 1.11, and the number is not a taste choice — it is set by the
   ONE altitude band in which the camera looks at the HORIZON. The tilt curve
   (updateCamera) lies the camera down below 260 units of altitude, and a
   camera outside a finite shell sees that shell's own limb as a hard edge
   across the sky: the Knowledge-mountain capture came back with the orange
   sky stopping dead in a straight line and black space above it, and the
   village capture had a starfield over a sunlit street. 1.34 puts the top of
   the air at 204 units, and above 204 the tilt is already 0.03 — the camera is
   looking straight DOWN, so its own frame never reaches the shell's edge.
   The rim exponent below was raised with it, or a shell a third of the radius
   thick wears the planet as a fat halo from orbit. */
const R_SKY    = R * 1.34;         // the atmosphere shell
const R_CLOUD  = R * 1.028;        // the cloud deck
const MAX_LAND = 46;               // highest summit above sea level
const MAX_DEEP = -34;              // deepest seabed

/* One degree of arc, in world units. Every angular size in this file is written
   in DEGREES because that is the unit a map is read in, and converted once. */
const DEG = Math.PI / 180;
const UNITS_PER_DEG = R * DEG;     // 10.47 units

const API_WORLD = '/api/world';
const API_STREAM = '/api/world/stream';
const VAULT_JSON = 'data/vault.json';
const MANIFEST = 'assets/manifest.json';
const REFRESH_MS = 60000;

const params = new URLSearchParams(location.search);
/* THE DESKTOP WALLPAPER  <!-- GLOBE-WALLPAPER-DOC -->
   `?wallpaper=1` is what Lively's `werkstadt` library entry loads (see
   docs/RUNBOOK.md "The desktop wallpaper"). It is the screensaver preset plus
   one thing: no masthead, because the top-left corner of a desktop belongs to
   the icons. It is NOT a separate mode — folding it into SCREENSAVER is
   deliberate, so the slow spin, the hidden hints/quality/hover and the
   suppressed camera cue are all one behaviour with one place to change it,
   and the wallpaper can never drift away from the kiosk it was copied from. */
/* Controls.wallpaper and not `params.get(...)` alone: coming BACK from a city or
   the island the flag has to survive the hand-over, and controls.js remembers it
   for the tab (CONTROLS-WALLPAPER). Reading the param only meant a return trip
   landed on a bare globe — masthead back over the desktop icons, and the button
   cluster dropped below the taskbar. */
const WALLPAPER = params.get('wallpaper') === '1' || Controls.wallpaper;
const SCREENSAVER = params.get('screensaver') === '1' || WALLPAPER;
const FIXED_CAM = params.get('camera') === 'fixed';
const HOUR_OVERRIDE = params.has('hour') ? parseFloat(params.get('hour')) : null;
/* The two A/B flags the frame-rate table in docs/RUNBOOK.md is measured with.
   They are not debug toggles that will rot: `?life=0&drones=0` is the control
   row of that table, and `?drones=cones` is also the path a failed fetch of
   assets/drones/ornis.glb takes, so both branches are reachable code. */
const LIFE_OFF   = params.get('life') === '0';
/* THREE STATES, not two, and each is a different row of the table.
   `drones=0`  no craft at all — the control the round-4 fleet is measured against.
   `drones=cones` round 3's cone, which is also what a failed fetch of
                  assets/drones/ornis.glb leaves behind, so that branch is
                  reachable code and not a toggle that will rot.
   anything else  the ORNIS kit. */
const DRONES_OFF = params.get('drones') === '0';
const DRONE_CONES = DRONES_OFF || params.get('drones') === 'cones';
const DEMO_PRINT = params.get('demo') === 'print';

/* THE PHONE  <!-- GLOBE-MOBILE-DOC -->
   `?mobile=1` is the preset the QR code on m.html links to, and `pointer:
   coarse` applies the same preset without the flag — a phone that reached this
   page by typing the address is still a phone. `?mobile=0` forces it off, which
   is the only way a desktop harness can test the DESKTOP path on a machine with
   a touchscreen and the only reason the flag has three states.

   What the preset is, and every line of it is a measured cost on this planet:
     quality medium      shadows off, bloom off, pixel ratio pinned
     dpr <= 1.5          a 3x phone renders 9x the pixels of a 1x one for a
                         screen six inches wide; the third one buys nothing
     bloom half-res      the desktop already halves it (resize()); on the
                         preset it is off with the rest of `medium`
     life budget halved  LIFE_Q.medium is already 0.5, and MOBILE_LIFE takes
                         the neighbour count down with it
     no shadows          part of `medium`
     hints a bottom sheet  a fixed line of keyboard hints on a 390 px screen is
                         two lines of text over the planet; body.mobile moves it
                         to the bottom edge where a thumb is. */
const MOBILE_FLAG = params.get('mobile');
const COARSE = typeof matchMedia === 'function' &&
               matchMedia('(pointer: coarse)').matches;
const MOBILE = MOBILE_FLAG === '1' || (MOBILE_FLAG !== '0' && COARSE);
const MOBILE_DPR = 1.5;
const MOBILE_SAT = 1;            // one live neighbour on a phone, not two

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const mix = (a, b, t) => a + (b - a) * t;
const el = id => document.getElementById(id);


/* =============================================================================
   NOISE — seeded 3D value noise. THREE dimensions, not two, and that is the
   whole reason terrain.js's fbm could not be imported: a 2D noise sampled over
   a sphere's lat/lon has a seam down one meridian and a pinch at both poles,
   which on a planet you can rotate is the first thing anyone sees. Sampled on
   the unit direction instead, there is no seam anywhere because there is no
   parameterisation.
   ========================================================================== */
function hash3(ix, iy, iz) {
  /* Math.imul, NOT `*`. A plain multiply of two 32-bit integers in JS produces a
     DOUBLE, and everything below bit 21 of the product is thrown away before the
     next xor ever sees it — so the "random" number is a smooth function of its
     own inputs. Measured on the first build: this noise had a mean of 0.35
     instead of 0.5 and a range of 0.15 to 0.55 instead of 0 to 1, which is why
     the cloud deck came out at 1.7 % coverage with everything above the
     threshold missing. imul is the 32-bit multiply, and it is one call. */
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = t => t * t * (3 - 2 * t);

function value3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz);
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), fx), x10 = mix(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), fx), x11 = mix(c(0, 1, 1), c(1, 1, 1), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

/** Plain fractal Brownian motion, 0..1. A rolling blanket — this is the noise
    that decides WHERE land is, because a coastline should wander, not crease. */
function fbm3(x, y, z, oct = 4) {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += a * value3(x * f, y * f, z * f); norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}

/** Ridged multifractal, 0..1. Folding each octave at its own middle
    (1 - |2n-1|) puts a CREASE where the noise crosses the middle, and
    multiplying the next octave by this one means detail only appears where
    there is already a ridge to carry it. Four octaves of fbm is noise; four of
    this is a mountain range with spurs, which is what a continent needs. */
function ridged3(x, y, z, oct = 5) {
  let a = 0.5, f = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(value3(x * f, y * f, z * f) * 2 - 1);
    n *= n;
    sum += a * n * prev; norm += a; prev = n; a *= 0.52; f *= 2.07;
  }
  return sum / norm;
}


/* =============================================================================
   THE CONTINENTS — five bodies of work, five fixed places
   The lat/lon of each is a CONSTANT, written here once. A continent that moved
   between reloads would make the map unlearnable, which is the same reason
   terrain.js has no Math.random in it.

   `r` is the continent's angular radius in degrees; at R = 600 one degree is
   10.5 units, so a 35-degree continent is about 730 units across. `r` is not
   quite the coastline — the mask's ramp and the 0.42 waterline put the shore at
   about 0.96 of it — and the closest pair, Werkzeugland and Wissenberg at 68
   degrees apart, still has eleven degrees of open sea between their beaches.
   The number that matters is __planet().landFraction: 0.35 with these five.
   ========================================================================== */
/* The five landmasses. Which of them a project lands on is YOUR decision and
   lives in config.json (`continents`, a list of path fragments); this array is
   only the geography — where each one sits on the sphere, how big it is and
   what colour its ground is. The keys are the contract between the two. */
const CONTINENTS = [
  { key: 'wdm',      label: 'Workland',   lat:  26, lon: -42, r: 35, seed: 11.7,
    tint: 0x6d7a48, note: 'the work you are paid for' },
  { key: 'wild',     label: 'Wildcoast',  lat: -22, lon:  18, r: 31, seed: 41.3,
    tint: 0x5f7350, note: 'the work you do because you want to' },
  { key: 'tools',    label: 'Toolland',   lat:  14, lon:  84, r: 32, seed: 73.9,
    tint: 0x5c6470, note: 'tools, infra and the .claude machinery' },
  { key: 'knowledge',label: 'Mount Note', lat:  56, lon: 156, r: 28, seed: 97.1,
    tint: 0x6a6a72, note: 'the Obsidian vault — mountain, valley, river, village, fortress' },
  { key: 'frontier', label: 'Newland',    lat: -44, lon: -132, r: 30, seed: 137.7,
    tint: 0x6b6244, note: 'everything else Claude has opened' },
];

/* Small islands for work that belongs to no continent: a path that is not under
   Desktop at all. Deliberately far from every landmass — an unattributable
   project IS offshore, and drawing it as part of a continent would be a lie the
   map tells. */
const ISLE_SEEDS = [
  { lat:  -4, lon: -80 }, { lat:  40, lon:  22 }, { lat: -58, lon:  70 },
  { lat:  66, lon: -95 }, { lat: -14, lon: 128 }, { lat:  -2, lon: 176 },
];

/* Everything below comes from config.json, served as a script by the server
   (GET /api/config.js) so it is on `window` before this module's first frame
   rather than one fetch() late. The `|| {}` is not defensive noise: globe.js
   is also opened straight off the filesystem in development, where there is
   no server to answer that route. */
const CFG = (typeof window !== 'undefined' && window.WERKSTADT_CONFIG) || {};

/* YOUR home directory, lower-cased with forward slashes, sent by the server.
   A project under it belongs to a continent; a project outside it is, by
   definition, work whose home this machine is not — and that is drawn as an
   offshore island rather than pretended into a landmass. */
const HOME = (CFG.home || '').toLowerCase();

/* path fragment -> continent key, in order, from config.json. Empty by
   default in shape only: config.example.json ships four rules, and a config
   with none puts every local project on `frontier`, which is honest. */
const CONTINENT_RULES = (CFG.continents || []).filter(r => r && r.path_contains && r.continent);

/** Which continent a town belongs to, from its REAL path on this machine.
    Deterministic, and the order matters: the FIRST matching rule wins, so a
    config can put `/projects/clients/` on one landmass ahead of the broader
    `/projects/` rule underneath it. */
function continentOf(town) {
  if (town.kind === 'vault') return 'knowledge';
  const p = (town.path || '').replace(/\\/g, '/').toLowerCase();
  if (HOME && !p.startsWith(HOME)) return null;         // -> a small island
  for (const r of CONTINENT_RULES) {
    if (p.includes(String(r.path_contains).toLowerCase())) return r.continent;
  }
  return 'frontier';
}

/** Unit vector from latitude/longitude in degrees. +y is the north pole. */
function ll(lat, lon, r = 1) {
  const a = lat * DEG, b = lon * DEG;
  return new THREE.Vector3(Math.cos(a) * Math.cos(b) * r, Math.sin(a) * r,
                           Math.cos(a) * Math.sin(b) * r);
}
function toLL(v) {
  const u = v.clone().normalize();
  return { lat: Math.asin(clamp(u.y, -1, 1)) / DEG, lon: Math.atan2(u.z, u.x) / DEG };
}
for (const c of CONTINENTS) c.axis = ll(c.lat, c.lon);

/** Angular distance between two unit vectors, in DEGREES. */
const angDist = (a, b) => Math.acos(clamp(a.dot(b), -1, 1)) / DEG;

/** A unit vector `deg` degrees away from `axis`, in bearing `bearing` degrees.
    This is how every settlement is placed: a continent centre plus an offset. */
const _e = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
function offsetFrom(axis, deg, bearing) {
  /* east = the tangent pointing along increasing longitude; north = the other
     tangent. Guarded at the poles, where "east" is undefined. */
  _e.set(0, 1, 0).cross(axis);
  if (_e.lengthSq() < 1e-6) _e.set(1, 0, 0);
  _e.normalize();
  _n.copy(axis).cross(_e).normalize();
  const a = deg * DEG, br = bearing * DEG;
  _t.copy(_n).multiplyScalar(Math.cos(br)).addScaledVector(_e, Math.sin(br));
  return axis.clone().multiplyScalar(Math.cos(a)).addScaledVector(_t, Math.sin(a)).normalize();
}


/* =============================================================================
   THE HEIGHT FIELD — one function, the single source of truth for "where is the
   ground", exactly as terrain.js is for the island. Everything reads its
   elevation back out of here: the terrain mesh, the ocean's depth colour, every
   settlement pad, every road and every drone's altitude.
   ========================================================================== */

/** 0 in deep water, 1 well inland. The continents' own shapes, warped by a low
    frequency noise so no coastline is a circle. */
function landMask(u) {
  let m = 0;
  for (const c of CONTINENTS) {
    const d = angDist(u, c.axis);
    if (d > c.r * 1.9) continue;
    /* The wobble is sampled on the POINT, not on the bearing: a bearing-based
       wobble makes a flower, and every continent came out as the same flower
       rotated. On the point it is a coastline with bays and peninsulas. */
    /* TWO warps, at two frequencies. One gives a continent its overall shape;
       the second, a fifth as strong and four times as fine, is what puts bays
       and headlands on the coast. With only the first, every landmass came back
       as a smooth blob — recognisable as land, unbelievable as a coast. */
    const w = 0.72 + 0.58 * fbm3(u.x * 1.9 + c.seed, u.y * 1.9 + c.seed, u.z * 1.9, 3)
                   + 0.11 * (fbm3(u.x * 7.4 - c.seed, u.y * 7.4, u.z * 7.4 + c.seed, 3) - 0.5);
    /* The mask reaches 1 at 0.86 of the wobbled radius and dies at 1.24 of it,
       and the WIDTH of that ramp is the continental shelf in the horizontal.
       It was 1.06/0.84 — 0.22 of the radius for the WHOLE profile — and with
       the waterline at 0.42 that left about 25 units of ground between the
       beach and 27 units of depth: a 47-degree wall, which is exactly the
       "cliff wall at every coast" read off globe-space.png. Widened to 0.38 and
       the waterline moved to SEA below, the same coastline now has ~68 units of
       shelf under it. The two numbers move TOGETHER: 1.24 - SEA*0.38 has to stay
       at 0.968 of the wobbled radius or the land fraction moves with it.
       Measured after every change with __planet().landFraction. */
    m = Math.max(m, smoothstep(c.r * w * 1.24, c.r * w * 0.86, d));
  }
  for (let i = 0; i < ISLE_SEEDS.length; i++) {
    const s = ISLE_SEEDS[i];
    if (!s.axis) s.axis = ll(s.lat, s.lon);
    const d = angDist(u, s.axis);
    /* Re-scaled with SEA: a peak of 0.86 was comfortably above the old 0.42
       waterline and is UNDER the new 0.70, which would have sunk all six
       islands. 5.6/1.9 also gives them their own little shelf. */
    if (d < 6) m = Math.max(m, smoothstep(5.6, 1.9, d) * 0.97);
  }
  return m;
}

/* The waterline, as a value of the land mask. Everything about the coast is
   derived from this one number and the ramp width above; nothing else in the
   file is allowed to decide where the sea ends. */
const SEA = 0.70;

/** Rivers. A river is where a noise field crosses its own middle, which is a
    thin winding line — the same trick a ridged multifractal uses for a crest,
    read the other way up for a valley. Returns 0..1, the depth of the channel.
    WHY not a polyline per continent: a river drawn as a path has to be traced
    from a summit to a coast that the noise has not decided yet, and every
    vertex of the planet then has to test every segment. This is one fbm call,
    it lands on the terrain instead of over it, and because it is multiplied by
    the shore ramp it dies where the land does — which is a mouth. */
function riverAt(u, m) {
  const shore = smoothstep(SEA + 0.02, SEA + 0.20, m);
  if (shore <= 0) return 0;
  const n = fbm3(u.x * 6.7 - 11.7, u.y * 6.7 + 4.4, u.z * 6.7 - 2.9, 3);
  const v = 1 - Math.abs(n * 2 - 1);
  /* 0.982 is where this noise's own distribution puts about 2 % of the surface.
     At 0.90 — the first try — a third of every continent was river. */
  return smoothstep(0.982, 0.9995, v) * shore;
}

/** The raw elevation before any settlement flattens its own pad, in world
    units. Negative is seabed. */
function elevRaw(u) {
  const m = landMask(u);
  const x = u.x, y = u.y, z = u.z;

  /* Two independent bodies of noise, and they do different jobs. The roll is
     what makes farmland; the ridge is what makes a range. Multiplying the ridge
     by the mask means a range dies at the coast instead of walking into the
     sea, which is what a continental margin actually does. */
  const roll  = fbm3(x * 2.6 + 3.1, y * 2.6 - 6.2, z * 2.6 + 1.4, 4);
  const ridge = ridged3(x * 3.9 - 2.2, y * 3.9 + 5.5, z * 3.9 - 7.1, 5);
  /* The shore ramp starts ABOVE the waterline now, not below it: everything it
     gates — the ranges, the rolling farmland — has to stay off the beach, or a
     range walks into the surf and the coast is a cliff again. */
  const shore = smoothstep(SEA + 0.02, SEA + 0.20, m);

  /* THE WATERLINE IS ONE NUMBER. The first build mixed a sea height and a land
     height by the mask and hoped the result crossed zero somewhere sensible; it
     crossed it a long way inland and the planet measured 11 % land instead of
     35 %. Here the mask alone decides: elevation is zero at m = 0.42 by
     construction, and everything else is relief added on top of that. Move 0.42
     and the whole coastline moves with it — which is the only honest knob for a
     land fraction. Measured with __planet().landFraction after every change. */
  const above = m - SEA;
  /* Land rises steeply out of the water and then STOPS. A straight ramp on the
     mask put the middle of every continent 36 units up, which the biome table
     reads as rock and snow — the first capture came back as five tan plateaux
     with no green anywhere on them. An exponential approach to 7.5 units is a
     coastal plain with a shoreline, and it leaves the whole vertical range to
     the things that are supposed to own it: the ranges, and the vault's
     mountain. */
  let land;
  if (above < 0) {
    /* THE CONTINENTAL SHELF, and this is the whole coast fix. The old profile
       was one straight ×66 ramp from the waterline to the abyss, which put a
       47-degree wall under every beach — the tan striped rims on globe-space.png.
       A power of 1.9 over the (now three times wider) sub-water mask range is
       the real shape: nearly flat for the first few units, so there is a beach
       and then a shallow bench the ocean shader can colour turquoise, and only
       then the slope. Measured: 0.9 units of depth 6 units out from the water's
       edge, against 24 before. */
    const below = -above / SEA;                          // 0 at the shore, 1 at the deep
    land = -32 * Math.pow(below, 1.9);
  } else {
    land = 7.5 * (1 - Math.exp(-(above / (1 - SEA)) * 3.2));
  }
  land += (roll - 0.44) * 18 * shore;                    // rolling farmland
  /* Exponent 2.1, not 1.55, and this is what puts the green back on the
     continents. At 1.55 a middling ridge value of 0.35 still added nine units,
     so the MEDIAN piece of land on this planet sat at about 21 units — which
     the biome table reads as dry high ground, and globe-continent.png came back
     as olive-tan mush from coast to coast. At 2.1 the same 0.35 adds five and a
     real ridge at 0.8 still adds twenty-eight: lowlands stay low, ranges stay
     ranges. Measured with __probe(): Werkland's interior went 17-25 -> 9-16. */
  land += Math.pow(ridge, 2.1) * 46 * shore;             // the ranges
  /* Ridged detail on the LAND ITSELF, at four times the range frequency and a
     tenth of the amplitude. This is what a hillside has when you stand on it:
     without it every slope on this planet is a smooth clay ramp, which is what
     globe-street.png shows. Gated by shore so it does not roughen the beach. */
  land += (ridged3(x * 15.5 + 8.3, y * 15.5 - 2.7, z * 15.5 + 4.9, 3) - 0.34) * 4.6 * shore;
  land += (roll - 0.5) * 7 * (1 - shore);                // relief on the seabed
  land -= smoothstep(0.30, 0.0, m) * 14;                 // the abyssal plain
  /* THE RIVERS, cut last so nothing fills them back in. 7 units is deep enough
     to read as a channel from a region view and shallow enough that a village
     on the bank is not on a cliff. */
  land -= riverAt(u, m) * 7;

  /* Each continent's own character, so five landmasses are not one landmass
     drawn five times. The vault's is the biggest departure and has its own
     function, because five NAMED regions have to be findable on it. */
  for (const c of CONTINENTS) {
    const d = angDist(u, c.axis);
    if (d > c.r * 1.2) continue;
    const inland = smoothstep(c.r, c.r * 0.3, d);
    if (c.key === 'knowledge') land += vaultRelief(u, c, d, inland, ridge, roll);
    else if (c.key === 'wdm')  land += inland * 9 * (roll - 0.5);          // low, worked, rolling
    else if (c.key === 'wild') land += inland * 16 * Math.pow(ridge, 2.1); // steep coastal cliffs
    else if (c.key === 'tools') land += inland * 13 * (fbm3(x * 6.1, y * 6.1, z * 6.1, 2) - 0.5); // broken plateau
    else if (c.key === 'frontier') land += inland * 7 * (roll - 0.5) - inland * 3; // flat, dry, wide
  }

  return clamp(land, MAX_DEEP, MAX_LAND);
}

/* --- The vault continent's five regions, as landforms ---------------------
   The island in world.html put Knowledge on a mountain, Dev Logs in a valley,
   Daily along a river, People in a hill village and Boards behind a fortress
   wall. Those five ideas are the ones worth keeping; the coordinates are not,
   because they were points on a 900-unit square. Here they are bearings out of
   the continent's own centre, so the same five regions are in the same five
   places on the sphere every load. */
const VAULT_REGIONS = [
  { key: 'knowledge', label: 'Knowledge', bearing:  10, deg:  7.5, kind: 'mountain' },
  { key: 'devlogs',   label: 'Dev Logs',  bearing: 150, deg: 11.0, kind: 'valley' },
  { key: 'daily',     label: 'Daily',     bearing: 236, deg:  9.0, kind: 'river' },
  { key: 'people',    label: 'People',    bearing: 300, deg: 12.5, kind: 'village' },
  { key: 'boards',    label: 'Boards',    bearing:  74, deg: 13.0, kind: 'fortress' },
];
for (const rg of VAULT_REGIONS) rg.axis = null;   // filled once the continent axis exists

function vaultAxes() {
  const c = CONTINENTS.find(k => k.key === 'knowledge');
  for (const rg of VAULT_REGIONS) if (!rg.axis) rg.axis = offsetFrom(c.axis, rg.deg, rg.bearing);
}
vaultAxes();

function vaultRelief(u, c, d, inland, ridge, roll) {
  let h = 0;
  for (const rg of VAULT_REGIONS) {
    const dd = angDist(u, rg.axis);
    if (rg.kind === 'mountain') {
      /* A gaussian carrying a ridged multifractal on its flanks — a summit that
         FORKS rather than a snowy dome. Same reasoning as terrain.js's
         MOUNTAIN, on a sphere. */
      const g = Math.exp(-(dd * dd) / (2 * 4.4 * 4.4));
      h += g * (58 + 38 * Math.pow(ridge, 1.3));
    } else if (rg.kind === 'valley') {
      h -= smoothstep(7.5, 1.2, dd) * 21;
    } else if (rg.kind === 'river') {
      /* The river is a CHANNEL, not a spot: a trench along a great circle
         through the region, so the Daily notes read as a course you can follow
         instead of a lake. */
      const along = Math.abs(dd - 6.4);
      h -= smoothstep(2.4, 0.0, along) * 17;
    } else if (rg.kind === 'village') {
      h += smoothstep(6.0, 1.0, dd) * 16 * (0.7 + 0.6 * roll);
    } else if (rg.kind === 'fortress') {
      /* A flat-topped bluff: the fortress needs ground to stand on, and a wall
         on a slope is a wall falling over. */
      h += smoothstep(5.4, 2.2, dd) * 26;
    }
  }
  return h * inland;
}


/* =============================================================================
   SETTLEMENT SITES — the pads. Registered BEFORE the terrain mesh is built, so
   that elevAt() can flatten the ground under a town while it is being made.
   A town on a slope is a town sliding off the planet; a pad cut afterwards
   would float above the mesh or sink into it. This is the one ordering
   constraint in the whole file.

   Bucketed by a coarse lat/lon grid because elevAt() runs about 180,000 times
   during the build and a linear scan over 142 sites inside it is 25 million
   angle calls for nothing.
   ========================================================================== */
const SITES = [];
const SITE_GRID = new Map();           // "latCell,lonCell" -> [site]
const CELL = 10;                       // degrees

function siteCellKey(lat, lon) {
  return Math.floor(lat / CELL) + ',' + Math.floor(((lon % 360) + 360) % 360 / CELL);
}
function registerSite(site) {
  SITES.push(site);
  const c = toLL(site.axis);
  /* Spread over every cell the pad can touch, plus one ring, so a pad that
     straddles a cell edge is still found from either side. */
  const pad = Math.ceil(site.deg / CELL) + 1;
  for (let dy = -pad; dy <= pad; dy++) {
    for (let dx = -pad; dx <= pad; dx++) {
      const k = siteCellKey(clamp(c.lat + dy * CELL, -89, 89), c.lon + dx * CELL);
      if (!SITE_GRID.has(k)) SITE_GRID.set(k, []);
      const arr = SITE_GRID.get(k);
      if (!arr.includes(site)) arr.push(site);
    }
  }
}
function sitesNear(u) {
  const c = toLL(u);
  return SITE_GRID.get(siteCellKey(c.lat, c.lon)) || null;
}

/** The elevation the world is actually built at: elevRaw, flattened toward each
    settlement's own pad height inside that settlement's radius. */
function elevAt(u) {
  let e = elevRaw(u);
  const near = sitesNear(u);
  if (!near) return e;
  for (const s of near) {
    const d = angDist(u, s.axis);
    if (d > s.deg * 2.1) continue;
    /* Two rings: the inner one is dead flat (that is where buildings stand),
       the outer one eases the pad back into whatever the land was doing.
       1.35, not 2.0: at twice the settlement's own radius every town sat in the
       middle of a pale flat apron three times its size, which read as a crater
       from a region view and as a car park from the ground. */
    /* 1.05, not 0.82: the lot planner puts the outermost ring of houses at
       1.02 of the settlement's own radius, which is 0.88 of `deg`, and a house
       standing on the easing slope has one corner in the air. 1.55 is the ease
       out — the smallest step from 1.35 that keeps the FLAT part flat under
       every lot, and it is the number to watch if a town ever reads as a crater
       from a region view again. */
    const k = smoothstep(s.deg * 1.55, s.deg * 1.05, d);
    e = mix(e, s.elev, k);
  }
  return e;
}

/** The point on the surface, at the ground, for a unit direction. */
const surfaceAt = (u, lift = 0) => u.clone().multiplyScalar(R + Math.max(0.15, elevAt(u)) + lift);


/* =============================================================================
   SETTLEMENT CLASS — read off the real numbers and nothing else
   The thresholds are the brief's, verbatim, and they are also the row in
   docs/HANDOFF.md's mapping table. A dormant project turning into FARMLAND is
   the one piece of this map that is an opinion, and it is a legible one: the
   land is still worked, nobody is living on it.
   ========================================================================== */
/* `deg` is 1.45x what it was, and the reason is the buildings. A BuildingKit
   cottage is a 5x6 m footprint against the 3.1x3.6 unit boxes this map used to
   draw, so at the old radii a village of twelve was a solid block of masonry
   with no street in it. 1.45 puts every class back at about a third of its own
   pad covered — measured, not guessed — and is as far as it can go before the
   sunflower spiral starts overlapping neighbours on the crowded continents.
   `houses` is now the number of BUILDINGS, towers included in the city's own
   count separately below. */
const CLASSES = {
  city:    { deg: 4.6, houses: 48, towers: 12, lights: 240, label: 'city' },
  town:    { deg: 3.3, houses: 28, towers:  4, lights:  84, label: 'town' },
  village: { deg: 2.2, houses: 12, towers:  0, lights:  26, label: 'village' },
  hamlet:  { deg: 1.45, houses: 5, towers:  0, lights:   7, label: 'hamlet' },
  fields:  { deg: 2.4, houses:  1, towers:  0, lights:   2, label: 'fields' },
};

const DAY = 86400000;
function classOf(town) {
  const calls = town.tool_calls || 0;
  const last = town.last_active ? Date.parse(town.last_active) : 0;
  const days = last ? (Date.now() - last) / DAY : 9999;
  if (calls < 20 || days > 60) return 'fields';
  if (calls >= 5000) return 'city';
  if (calls >= 1000) return 'town';
  if (calls >= 200) return 'village';
  return 'hamlet';
}


/* =============================================================================
   TRADE FORMS — the same grammar the island uses
   world.js does not export its TRADE_FORMS table (it is a module-private const
   and world.js is being edited by someone else this hour), so this is a compact
   copy. SOURCE OF TRUTH: world.js -> const TRADE_FORMS / TRADE_WORDS, around
   line 1380. If a trade is added there, add it here; a type this table does not
   know draws no landmark rather than the wrong one.
   ========================================================================== */
const TRADE_FORMS = {
  MusicSchool: 'concertHall', Restaurant: 'eatery', CafeOrCoffeeShop: 'eatery',
  FoodEstablishment: 'eatery', Manufacturer: 'factoryHall', Carpenter: 'workshop',
  HomeAndConstructionBusiness: 'workshop', Plumber: 'waterTower',
  ProfessionalService: 'glassOffice', SoftwareApplication: 'dataHall',
  SoftwareSourceCode: 'codeShop', Book: 'library', EducationalOrganization: 'school',
  VideoObject: 'filmStudio', ReadAction: 'library',
  /* THE TWO ROWS THAT ARE NOT IN world.js, and why the copy note above is not
     being broken quietly. `hotel` and `townHall` exist so a trade that arrives
     as a schema.org `Hotel` or `GovernmentOrganization` can reach its SCAN in
     LM_MODEL below — nothing else. They are deliberately NOT added to world.js,
     because a form there needs a FORM_BUILDERS body written for it and writing
     two procedural bodies for a trade type this server has never once emitted
     is building for nobody. Here the cost of a row is one line, and if the scan
     is missing `landmarkGeo()` hands back its `default` shed, which is the
     shape this file already draws for every form it does not know. */
  LodgingBusiness: 'hotel', Hotel: 'hotel',
  GovernmentOrganization: 'townHall', GovernmentBuilding: 'townHall',
  CivicStructure: 'townHall',
};
/* WHICH TRADES HAVE A SCANNED LANDMARK, and which keep the procedural form.

   `assets/hunyuan/lm_*.glb` are Hunyuan-generated buildings. Where a town's
   trade maps to one, the SCAN stands on its plaza and the procedural solid is
   not drawn; every other trade keeps the form above, because a procedural
   concert hall is a better concert hall than a restaurant with the wrong sign
   on it.

   THE 2026-09-07 BATCH replaced four of these rows and closed one of the two
   gaps the previous note recorded:
     - `MusicSchool` now takes `lm_concerthall` instead of `lm_musicschool`. The
       new model is a closed building with a CURVED copper roof over a glass
       foyer, which is the same silhouette world.js's own `concertHall` builder
       argues for ("what makes a concert hall read as a concert hall is that its
       roof CURVES while every other roof is a pitch or a flat"). The old
       lm_musicschool is an open cutaway — a doll's house with one wall off — so
       from the street you were looking into a building rather than at one.
     - `CafeOrCoffeeShop` and `FoodEstablishment` take `lm_bakery`, a shopfront
       with an awning and bread in the window. `Restaurant` keeps
       `lm_restaurant`: a café and a restaurant share world.js's `eatery` FORM
       because the massing is the same, but where there are two real models the
       one that shows a counter and the one that shows tables are not
       interchangeable, and the server's keyword table already tells them apart.
     - `EducationalOrganization` takes `lm_school`. This is the gap the previous
       note left open ("there is no lm_school in the pack and lm_church is a
       CHURCH"); there is one now, so the rule that made it a gap — a scan is
       used only where it means what it shows — is what closes it.
     - `lm_church` still maps from nothing the server emits, unchanged, and
       `Hotel`/`GovernmentOrganization` are two more of the same kind: the rows
       are here so the day a project's own JSON-LD declares one, its town gets
       the right building. `_jsonld_trade_type` in server.py hands back whatever
       @type it finds, so that day needs no code — see DECISIONS 2026-09-07 for
       the measurement that no town on this planet declares them today.
   `Book` and `ReadAction` are both a library: a project whose trade is a book
   IS a library, and ReadAction is what the classifier calls a reading project. */
const LM_MODEL = {
  MusicSchool: 'model.hy.lm_concerthall',
  Restaurant: 'model.hy.lm_restaurant',
  CafeOrCoffeeShop: 'model.hy.lm_bakery',
  FoodEstablishment: 'model.hy.lm_bakery',
  Manufacturer: 'model.hy.lm_factory',
  ProfessionalService: 'model.hy.lm_office',
  Book: 'model.hy.lm_library',
  ReadAction: 'model.hy.lm_library',
  EducationalOrganization: 'model.hy.lm_school',
  LodgingBusiness: 'model.hy.lm_hotel',
  Hotel: 'model.hy.lm_hotel',
  GovernmentOrganization: 'model.hy.lm_townhall',
  GovernmentBuilding: 'model.hy.lm_townhall',
  CivicStructure: 'model.hy.lm_townhall',
  Church: 'model.hy.lm_church',
  PlaceOfWorship: 'model.hy.lm_church',
};
/* A scanned landmark's finished height in metres, by settlement class. The
   brief's plausible band is 8–14 m and these are inside it: a landmark has to
   stand over the roofline (a cottage is 3 m, a tower 24) without becoming the
   only thing in the frame — three village captures in round 3 came back as a
   picture of the inside of a beige dome, which is what a 20 m landmark on a
   26 m village does. */
const LM_HEIGHT = { city: 14, town: 12, village: 9.5, hamlet: 8.5, fields: 8.5 };

const TRADE_WORDS = {
  concertHall: 'a concert hall', eatery: 'a restaurant under an awning',
  factoryHall: 'a factory hall with a chimney', workshop: 'a workshop shed',
  waterTower: 'a water tower', glassOffice: 'a glass office',
  dataHall: 'a data hall under a mast', codeShop: 'a workshop with a lit server rack',
  library: 'a library', school: 'a school under a bell tower',
  filmStudio: 'a sound stage under a light rig',
  hotel: 'a hotel', townHall: 'a town hall under a clock tower',
};


/* =============================================================================
   STATE
   ========================================================================== */
let renderer, scene, camera, composer, renderPass, bloomPass, canvas;
let sunLight, hemi, envDay, envNight;
let planetGroup, oceanMesh, atmoMesh, cloudMesh, starField, lightsPoints;
let world = null, vault = null, plan = null;
const tex = {}, dom = {};
let quality = 'high', autoDegrade = true;
let fontsReady = false, built = false, pendingSearch = null;
let nightAmount = 0;
const fpsRing = new Array(90).fill(16.7);
let fpsPtr = 0;
const litMaterials = [];             // materials whose lamps come on at dusk
const groundMaterials = [];          // materials that take the cloud shadow
let kit = null;                      // the shared BuildingKit
let droneKit = null;                 // the shared DroneKit, or null on ?drones=cones
let life = null;                     // the shared Life, or null on ?life=0
const props = {};                    // the scanned prop models, by manifest key
const landmarkModels = {};           // the Hunyuan lm_* scans, by manifest key

/* THE CAMERA. A globe camera is two angles and a distance and nothing else —
   a free-fly camera on a sphere gets lost and never finds a continent again. */
const cam = {
  lat: 12, lon: -30,          // the point on the planet under the lens
  dist: 2350,                 // distance from the CENTRE of the planet
  distWant: 2350,
  tilt: 0,                    // 0 straight down, 1 out to the horizon
  spin: SCREENSAVER ? 0.55 : 1.1,   // degrees of longitude per second
  auto: !FIXED_CAM,
  lastDrag: 0,
  fly: null,                  // an easing flight, while one is running
};
const DIST_MIN = R + 3.4;     // street level: three metres over the pad
const DIST_MAX = 3400;        // the whole planet, with room around it


/* =============================================================================
   BOOT
   ========================================================================== */
async function init() {
  canvas = el('map');
  for (const id of ['globe-counts', 'globe-clock', 'hover', 'caption', 'cap-name',
                    'cap-path', 'cap-state', 'cap-agents', 'cap-open', 'cap-hint',
                    'hints', 'fault', 'fault-text', 'a11y-status', 'search',
                    'search-input', 'search-hits', 'quality', 'free-hud']) dom[id] = el(id);
  if (SCREENSAVER) document.body.classList.add('screensaver');
  if (WALLPAPER) document.body.classList.add('wallpaper');
  /* THE PRESET IS SET BEFORE THE RENDERER EXISTS, because `quality` is read by
     the constructor's own shadowMap line and by LIFE_Q the first time a
     settlement is counted. Setting it after would build a high-quality planet
     and then tell it it is a phone. */
  if (MOBILE) { document.body.classList.add('mobile'); quality = 'medium'; }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false,
                                         powerPreference: 'high-performance' });
  } catch (e) {
    return fault('This browser could not open a WebGL context, so the planet cannot draw.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,
                                  MOBILE ? MOBILE_DPR : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  /* The session city's and the island's exact tone curve and exposure. Three
     views of one machine have to agree about what a lit window at dusk looks
     like, and a different exposure is exactly how they stop agreeing. */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = quality === 'high';
  /* PCF, not PCFSoft. Measured on this same GPU in docs/BUILDINGS.md's own
     pass: 38 -> 44 fps on a street of real buildings, for a softness nobody
     picked out of a capture. The globe stands in those same streets now. */
  renderer.shadowMap.type = THREE.PCFShadowMap;
  /* The print's cut is a per-material clipping plane on one building at a time.
     Without this every clippingPlanes array in the scene is ignored and a
     materialisation appears whole in one frame. */
  renderer.localClippingEnabled = true;

  scene = new THREE.Scene();
  /* fov 32, far plane 40,000. The far plane is what the STARS need: a star
     sphere at 26,000 units cut by a 12,000 far plane is a black frame with a
     planet in it. near 1.2 keeps a house two metres from the lens.
     NO scene.fog. Fog is a function of distance from the LENS, and on a planet
     seen from orbit that fogs the far LIMB — the one edge that has to stay
     sharp for the atmosphere to read at all. The air is drawn by the
     atmosphere shell instead, which is where air actually is. */
  camera = new THREE.PerspectiveCamera(32, 1, 1.2, 40000);
  /* Density 0: see updateSun(). Present from the first frame so nothing ever
     recompiles when the camera comes down through 200 units. */
  scene.fog = new THREE.FogExp2(0x8fa6b4, 0);

  document.fonts.ready.then(() => { fontsReady = true; refreshLabels(); });
  window.addEventListener('resize', resize);
  bindInput();
  bindControls();
  resize();
  requestAnimationFrame(frame);

  /* THE SKY BEFORE THE ASSETS, and that ordering is the whole point (task B,
     startup speed). loadAssets() is ~100 MB of textures, HDRIs and GLBs and
     measured seconds even from a warm cache; until it returns there is nothing
     in the scene at all, so the render loop started two lines up has been
     drawing an empty black frame that whole time. buildStars() is 2,600
     hashed points and one inline shader — it touches no file, so it can run
     now and the wait becomes a starfield instead of a black rectangle. Nothing
     else in the boot can move up here: everything after this line needs either
     the asset pack or /api/world. */
  buildStars();

  try { await loadAssets(); }
  catch (e) { return fault('The asset pack under <code>assets/</code> did not load: ' + escapeHtml(e.message)); }

  await loadData();
  await loadLandmarkModels();
  buildWorld();
  built = true;
  openStream();
  setInterval(refreshWorld, REFRESH_MS);
  applyFocus();
  if (pendingSearch) { runSearch(pendingSearch); pendingSearch = null; }
  showHintsOnce();

  /* THE LIVING LAYER GOES ON LAST, and after the camera has been pointed —
     world.js's reason, and it holds harder here. Life.load() decimates eighteen
     50,000-triangle meshes and takes about twenty seconds on this machine, so
     awaiting it before applyFocus() would leave the lens over the wrong ocean
     for that whole time. The planet is complete, interactive and searchable
     without it, which is the honest definition of "last". */
  await buildLife();
  if (DEMO_PRINT) startPrintDemo();
  /* AND THE LAST DAY'S BUILDINGS AFTER THAT, for the same reason again: three
     replays are tens of megabytes of JSON and the planet is worth looking at
     while they arrive. Not awaited by anything — `__seeded().done` is how a
     harness knows it has finished. */
  seedPrintedBuildings();
}

function fault(msg) {
  dom['fault-text'].innerHTML = msg;
  dom.fault.hidden = false;
  dom['a11y-status'].textContent = dom['fault-text'].textContent;
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!composer) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.48, 0.72, 0.62);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  composer.setSize(w, h);
  /* HALF RESOLUTION, restored after setSize(), which resets every pass to the
     full frame. The island measured bloom at 38 fps without against 28 with; a
     blur run at half the width and height costs a quarter and, at this radius,
     looks identical. */
  if (bloomPass) bloomPass.setSize(Math.round(w * 0.5), Math.round(h * 0.5));
}


/* =============================================================================
   ASSETS — the same CC0 pack the island uses, read through the same manifest
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
  /* `gravel_road_1k_arm.jpg` HAS AN EMPTY GREEN CHANNEL. Measured over the
     whole image: R 240.5, G 0.4, B 0.3 — its roughness is packed in RED, not in
     the green the manifest's `roughnessChannel` claims and three.js reads.
     MeshStandardMaterial multiplies `roughness` by that green, so every gravel
     surface on this planet came out at roughness 0 — a mirror — and from
     straight above a mirror shows the sky. That is what made the first lane
     capture 1,081 white stripes, and it is also what the inter-town roads have
     been doing since round 2: they were bright fragments on the ridges and
     nothing anywhere else, which was read as a projection bug at the time.
     The fix is a CONSTANT roughness for this one texture (see GRAVEL_ROUGH);
     the red channel could be swapped in with a shader edit, but a gravel road
     is uniformly rough and one number is the honest answer.
     REPORT UPSTREAM: assets/manifest.json's `gravelRoad.roughnessChannel`. */
  /* rockCliffB rather than cliff: the ground splat samples it TRIPLANAR, and
     rock_face tiles in three planes without the horizontal banding cliff_side
     has (cliff_side is a photographed cut face and its strata run one way).
     farmland and gravelRoad are the field quads and the road ribbons. */
  const surfaces = ['grass', 'rockCliffB', 'sand', 'snow', 'forestFloor',
                    'farmland', 'gravelRoad', 'roofTiles', 'plaster', 'cobble'];
  await Promise.all(surfaces.map(async k => {
    const m = man[k];
    const [diffuse, normal, arm] = await Promise.all([
      load(m.diffuse, true), load(m.normal, false), load(m.roughness, false)]);
    tex[k] = { diffuse, normal, arm, tile: m.metresPerTile };
  }));
  /* The wave normal. It was NEVER loaded — buildOcean() reads `tex.waterNormal
     || null`, three then binds its 1x1 default, every fetch came back (0,0,0,0)
     and the shader's `t*2-1` turned that into a constant (-1,-1,-1) tilt on the
     whole sea. That is most of why the ocean read as slate rather than water:
     the glint was being computed against a normal that pointed nowhere. */
  tex.waterNormal = { diffuse: await load(man.waterNormal.path, false) };

  /* Both HDRIs prefiltered HERE rather than left to the renderer's lazy PMREM,
     for the island's reason: this planet swaps environment as the terminator
     crosses the camera, and a lazy PMREM lands that cost as a stall mid-shot. */
  const rgbe = new RGBELoader().setPath('assets/');
  const hdr = p => new Promise((res, rej) => rgbe.load(p,
    t => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); },
    undefined, () => rej(new Error(p))));
  /* THE PROP PACK. Scanned models, loaded once and cloned into the street of
     whichever settlement the camera is standing in — never instanced across the
     planet, because a chainlink fence module alone is 89 k triangles (measured
     in docs/BUILDINGS.md's __budget()) and 142 towns' worth of them is the whole
     frame budget for something nobody can see from orbit. */
  /* THE SAME `setMeshoptDecoder` OR NOTHING AS THE LANDMARK LOADER, and this
     one had to learn it the same way. The prop loader was built for the CC0
     pack, which is plain glTF, so it never needed a decoder; the moment two
     `hy.*` keys joined `wantProps` the two files became one loader's problem
     and the failure was again silent — `props['hy.tree_conifer']` undefined,
     the alpine street back on cards, `__treeSpecies().trunkMeshes` still 12
     when the scan path would have made it 6. That count is what caught it. */
  await MeshoptDecoder.ready;
  const gltf = new GLTFLoader().setPath('assets/').setMeshoptDecoder(MeshoptDecoder);
  /* `hy.tree_conifer` and `hy.bush` resolve to `model.hy.*` in the manifest,
     which is how the Hunyuan pack reaches this page without a second loader.
     The conifer is loaded here rather than with the landmarks because it is
     wanted on EVERY alpine street and by buildForests()' impostor bake, not
     only where a trade asks for it. */
  const wantProps = ['lamppost', 'bench', 'fence', 'cart', 'boatReal', 'treeReal',
                     'hy.bush', 'hy.tree_conifer', 'rockA', 'rockB', 'barrel', 'crate'];
  await Promise.all(wantProps.map(k => new Promise(res => {
    /* The ROW can be absent as well as the file. assets/fetch_assets.py drops
       a `model.hy.*` key it has no CC0 model for rather than leaving it
       pointing at a file that is not there, so `man['model.' + k]` is the
       first thing that can be undefined — and reading `.path` off it threw out
       of this Promise.all and took the planet with it. */
    const rec = man['model.' + k];
    if (!rec) return res();
    gltf.load(rec.path, g => { props[k] = g.scene; res(); },
      undefined, () => res());        // a missing prop is a missing prop, not a dead planet
  })));

  const [rawDay, rawNight] = await Promise.all([hdr(man.hdriDusk.path), hdr(man.hdriNight.path)]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  envDay = pmrem.fromEquirectangular(rawDay).texture;
  envNight = pmrem.fromEquirectangular(rawNight).texture;
  rawDay.dispose(); rawNight.dispose(); pmrem.dispose();

  /* ONE kit, as docs/BUILDINGS.md's integration note requires: it builds its own
     PMREM chains and its nine shared materials, and a second copy would be a
     second set of both. */
  kit = await BuildingKit.load(renderer, MANIFEST);
  kit.setEnvironment(envDay);
  prewarmCatalogue();

  /* THE FLEET, loaded next to the building kit and before the render loop —
     integration note 1 in docs/DRONES.md. `load()` merges 102 nodes into three
     geometries, decimates them and bakes seven sprites through THIS renderer,
     which is why it cannot happen from an event handler later.
     A fleet that fails to load is NOT fatal: the planet still turns and the
     live agents fall back to the cones round 3 flew, which is also what
     `?drones=cones` asks for on purpose. */
  if (!DRONE_CONES) {
    try {
      droneKit = await DroneKit.load(renderer, MANIFEST);
      /* THE DOWNWASH IS TURNED OFF, and it is not a taste choice — it is the
         one part of drones.js that cannot mean anything on a sphere.

         The kit computes `y = group.position.y - getHeight(x, z)` and calls
         that the craft's height over the ground. In a flat world it is. Here
         `position.y` is a CARTESIAN COORDINATE: a craft over a town at latitude
         15 has y = 160 while its ground is 606 units from the centre, so any
         honest ground value makes `y` come out around -450. The kit reads that
         as "446 units UNDERGROUND", computes `near = 1 - y/3.52 = 128` and
         draws its dust ring at `BASE_SPAN * (1.5 + (1 - 128) * 2.6)` — a
         526-unit additive white disc at full opacity. That is the white frame
         `docs/shots/globe-space.png` came back as twice: the planet behind a
         dust ring five hundred metres across. It only appeared after the camera
         had been at street level, because that is when the rotors spool past
         the `rpm > 0.3` the ring also needs — which is why a shot taken
         straight from boot looked fine.

         A per-craft answer is impossible through this hook: it is handed (x, z)
         and cannot tell one craft from another, so one shared value is always
         the last craft's. The honest answer is the one that is also true — a
         craft on this planet never lands. It launches from 1.2 m over the
         square and docks back down, and a dust ring drawn in a flat-world basis
         would be pointing the wrong way down anyway. -1e7 puts every craft
         permanently outside the ring's two-rotor-span band. */
      droneKit.getHeight = () => -1e7;
      droneKit.setEnvironment(envDay);
    } catch (e) {
      droneKit = null;
      console.warn('drone kit unavailable, flying cones:', e.message);
    }
  }
}

/** The Hunyuan landmark scans, and ONLY the ones this planet's trades actually
    ask for. Six files at 3–5 MB each is a load nobody should pay for a planet
    whose 142 towns declare two trades between them, so the set is computed from
    the real payload after loadData() and before buildWorld(). */
async function loadLandmarkModels() {
  const want = new Set();
  for (const t of (world.towns || [])) {
    const key = t.trade && LM_MODEL[t.trade.type];
    if (key) want.add(key);
  }
  if (!want.size) return 0;
  await MeshoptDecoder.ready;
  const gltf = new GLTFLoader().setPath('assets/').setMeshoptDecoder(MeshoptDecoder);
  const man = await (await fetch(MANIFEST)).json();
  await Promise.all([...want].map(k => new Promise(res => {
    const rec = man[k];
    if (!rec) return res();
    /* A missing scan is a missing scan, not a dead planet: buildLandmarks()
       falls back to the procedural form, which is what every trade without a
       scan gets anyway. */
    gltf.load(rec.path, g => { landmarkModels[k] = g.scene; res(); }, undefined, () => res());
  })));
  return Object.keys(landmarkModels).length;
}

/* =============================================================================
   THE BUILDING CATALOGUE — ten types, and the number is the point
   BuildingKit.instanced() groups by style + palette + roof + lod, so a random
   draw over the grammar's 180 combinations produces 360 InstancedMeshes and
   destroys the reason to instance at all. Ten types is what the showcase uses
   and what its own note says to copy.
   ========================================================================== */
const CATALOGUE = [
  { style: 'cottage',   palette: 'whitewash', footprint: [5, 6],  floors: 1 },  // 0
  { style: 'cottage',   palette: 'timber',    footprint: [6, 5],  floors: 2 },  // 1
  { style: 'townhouse', palette: 'plaster',   footprint: [5, 7],  floors: 3 },  // 2
  { style: 'townhouse', palette: 'brick',     footprint: [6, 6],  floors: 2 },  // 3
  { style: 'shop',      palette: 'plaster',   footprint: [6, 6],  floors: 2 },  // 4
  { style: 'civic',     palette: 'stone',     footprint: [8, 7],  floors: 2 },  // 5
  { style: 'apartment', palette: 'plaster',   footprint: [7, 7],  floors: 4 },  // 6
  /* A tower wears its OWN default roof again. Round 3 forced `roof: 'hip'` here
     because the kit's LOD1 flat prism was a plain BoxGeometry with no `color`
     attribute, and against a vertexColors material an absent attribute reads as
     (0,0,0) — every tower on the planet wore a pure black slab. docs/BUILDINGS.md
     (2026-09-06) records that fix landing: `_roofPrism('flat')` now fills a white
     colour attribute like the hip and gable prisms already did. The workaround is
     removed, so a tower is flat-roofed here exactly as it is in buildings.html. */
  { style: 'tower', palette: 'stone', footprint: [5, 5], floors: 8 }, // 7
  { style: 'barn',      palette: 'timber',    footprint: [8, 6],  floors: 1 },  // 8
  { style: 'church',    palette: 'stone',     footprint: [6, 11], floors: 1 },  // 9
];

/* Which of the ten each class of settlement is built from — the settlement
   class table read as ARCHITECTURE instead of as counts. A repeated index is a
   weight: a village is mostly cottages with a couple of townhouses in it. */
const CLASS_COMMON = {
  hamlet:  [0, 0, 1, 8],
  village: [0, 0, 0, 1, 1, 2, 4],
  town:    [0, 1, 1, 2, 2, 3, 4],
  city:    [2, 3, 3, 4, 6, 6],
  fields:  [8],
};
/* One of each of these, always, at the middle of the settlement — the buildings
   that make a place READ as a village rather than as houses. Without a forced
   slot a church drawn by the hash appears in two villages out of five. */
const CLASS_SPECIAL = {
  hamlet: [], village: [9], town: [9, 5], city: [5, 9], fields: [],
};

/** Force every bake the planet will ever need BEFORE the first frame.
    `_bake()` runs a render-to-texture the first time a style + palette is
    asked for, so without this the first zoom into a town that happens to be
    the first `civic` on screen costs a visible frame. Eleven throwaway
    instanced() calls at load is the price of never hitching later. */
function prewarmCatalogue() {
  for (let i = 0; i < CATALOGUE.length; i++) {
    /* Discarded, NOT disposed. The geometries and the baked materials these
       come back wearing are the kit's own cached ones — disposing the result
       would free the bake every later building shares. Nothing here is ever
       added to the scene, so nothing is uploaded; only the bake happens. */
    kit.instanced([{ ...CATALOGUE[i], position: [0, -9000, 0], rotationY: 0, lod: 2, seed: i }]);
    kit.instanced([{ ...CATALOGUE[i], position: [0, -9000, 0], rotationY: 0, lod: 1, seed: i }]);
  }
}

async function loadData() {
  try { vault = await (await fetch(VAULT_JSON, { cache: 'no-store' })).json(); }
  catch (e) { vault = { notes: [], counts: {} }; }
  try {
    const res = await fetch(API_WORLD, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    world = await res.json();
  } catch (e) {
    world = { towns: [], roads: [], meta: { towns: 0, live: 0, agents_in_flight: 0 } };
    fault('The world server is not answering, so the planet has no settlements on it. ' +
          'Start it with <code>python server.py</code>.');
  }
}


/* =============================================================================
   THE PLAN — every town given a place, a class and a pad, before one triangle
   of terrain exists. buildWorld() then builds the terrain THROUGH elevAt(),
   which reads these pads. Order is the whole contract.
   ========================================================================== */
function planPlanet() {
  const towns = (world.towns || []).slice();
  const byContinent = new Map();
  const isles = [];
  for (const t of towns) {
    const k = continentOf(t);
    if (!k) { isles.push(t); continue; }
    if (!byContinent.has(k)) byContinent.set(k, []);
    byContinent.get(k).push(t);
  }

  const placed = [];
  for (const c of CONTINENTS) {
    const list = (byContinent.get(c.key) || [])
      .sort((a, b) => (b.tool_calls || 0) - (a.tool_calls || 0));
    const n = Math.max(1, list.length);
    list.forEach((t, i) => {
      /* A SUNFLOWER SPIRAL, not a hash-scattered position. A hash puts three
         towns on top of each other and leaves a quarter of the continent empty;
         the golden angle is the one arrangement that is even at every count.
         The capital lands at the centre because it is sorted first, which is
         also how a capital reads on a real map. */
      const golden = 2.39996323;
      const rho = c.r * 0.70 * Math.sqrt((i + 0.42) / n);
      /* The hash is what stops all five continents being the same picture
         rotated: it rolls the whole spiral by an amount that is the town's own,
         and jitters each ring so the arms are not visible as arms. */
      const jitter = (hash32(t.id) % 1000) / 1000;
      const bearing = (i * golden + c.seed + jitter * 0.55) / DEG;
      placed.push({ town: t, cont: c.key, axis: offsetFrom(c.axis, rho, bearing) });
    });
  }
  isles.forEach((t, i) => {
    const s = ISLE_SEEDS[i % ISLE_SEEDS.length];
    if (!s.axis) s.axis = ll(s.lat, s.lon);
    placed.push({ town: t, cont: null,
                  axis: offsetFrom(s.axis, 1.2 + (i / ISLE_SEEDS.length | 0) * 0.9,
                                   (hash32(t.id) % 360)) });
  });

  /* Now the pads. The elevation a pad sits at is the RAW land under it, lifted
     clear of the water — a settlement whose spiral put it in a bay becomes a
     small island rather than a town standing in the surf, which is the honest
     picture for work that has drifted off the continent it came from. */
  for (const p of placed) {
    const cls = classOf(p.town);
    const spec = CLASSES[cls];
    const raw = elevRaw(p.axis);
    p.cls = cls;
    p.elev = Math.max(2.6, Math.min(raw, MAX_LAND - 8));
    p.deg = spec.deg;
    p.spec = spec;
    p.offshore = raw < 1.0;
    registerSite({ axis: p.axis, deg: p.deg, elev: p.elev });
  }

  /* The roads, resolved from ids to placements once. /api/world gives 859 of
     them; a road whose other end is not on the map is dropped rather than drawn
     into the sea. */
  const byId = new Map(placed.map(p => [p.town.id, p]));
  const roads = [];
  for (const r of (world.roads || [])) {
    const a = byId.get(r.a), b = byId.get(r.b);
    if (!a || !b || a === b) continue;
    roads.push({ a, b, weight: r.weight || 1, sea: a.cont !== b.cont });
  }

  return { placed, byId, roads,
           counts: placed.reduce((m, p) => (m[p.cls] = (m[p.cls] || 0) + 1, m), {}) };
}


/* =============================================================================
   THE PLANET MESH — a cube-sphere, six faces, displaced by elevAt()

   WHY a cube-sphere and not an icosphere or a lat/lon sphere:
   - a lat/lon sphere pinches at the poles and every ground texture on it smears
     into a spiral there. Not a subtlety — it is the first thing anyone sees.
   - an icosphere has no usable UV at all, so the PBR pack could not be tiled on
     it without triplanar projection, which is three texture reads per map per
     fragment and this has to hold 40 fps on a Radeon 860M.
   - a cube face has a flat, square, seamless (0..1) UV, so grass tiles across it
     the way grass tiles across the island's ground, at real-world scale, with
     one read per map.
   Six meshes, not one merged: three of them are behind the planet at any moment
   and the frustum drops them for free.
   ========================================================================== */
const FACE_N = 168;                 // quads per face edge -> 5.6 units per quad
const FACES = [
  { key: '+x', f: (a, b) => new THREE.Vector3( 1, -b, -a) },
  { key: '-x', f: (a, b) => new THREE.Vector3(-1, -b,  a) },
  { key: '+y', f: (a, b) => new THREE.Vector3( a,  1,  b) },
  { key: '-y', f: (a, b) => new THREE.Vector3( a, -1, -b) },
  { key: '+z', f: (a, b) => new THREE.Vector3( a, -b,  1) },
  { key: '-z', f: (a, b) => new THREE.Vector3(-a, -b, -1) },
];

/** The cube-to-sphere map with the standard area correction. A plain
    normalize() of a cube crowds four times as many triangles into the middle of
    a face as into its corner; this spreads them, which is why the coastlines
    stay the same crispness across a whole face. */
function cubeToSphere(v) {
  const x = v.x, y = v.y, z = v.z;
  const x2 = x * x, y2 = y * y, z2 = z * z;
  return new THREE.Vector3(
    x * Math.sqrt(1 - y2 / 2 - z2 / 2 + y2 * z2 / 3),
    y * Math.sqrt(1 - z2 / 2 - x2 / 2 + z2 * x2 / 3),
    z * Math.sqrt(1 - x2 / 2 - y2 / 2 + x2 * y2 / 3)).normalize();
}

/* The biome palette. Read as a table, not as magic numbers: this IS the legend
   of the map, and every colour in it is a colour a satellite would return. */
const BIOME = {
  seabed: new THREE.Color(0x2a2b26),
  sand:   new THREE.Color(0xb9a276),
  grass:  new THREE.Color(0x5d6f3f),
  forest: new THREE.Color(0x35482a),
  scrub:  new THREE.Color(0x77733f),
  rock:   new THREE.Color(0x6c675e),
  snow:   new THREE.Color(0xd8dee0),
};

/** How trodden this ground is by the settlement on it, 0..1. Full out to the
    edge of the pad (deg * 1.05, which is where elevAt() stops flattening) and
    gone by twice that — a ring of worn ground round a village, which is the
    ground a village actually stands in. Reuses the same lat/lon site grid
    elevAt() flattens the pads with, so it costs one grid lookup per vertex and
    is zero everywhere on the planet that is not near a town. */
function townGround(u) {
  const near = sitesNear(u);
  if (!near) return 0;
  let k = 0;
  for (const s of near) {
    k = Math.max(k, smoothstep(s.deg * 2.10, s.deg * 1.05, angDist(u, s.axis)));
  }
  return k;
}

/** Where the woods are. One noise, thresholded — a forest is patchy, and a
    patch is exactly what a thresholded fbm is. Read by BOTH the ground splat
    (so the forest floor texture lands under the trees) and buildForests() (so
    the trees stand on it), which is the only reason it is its own function. */
function forestMask(u) {
  const n = fbm3(u.x * 13.7 + 21.4, u.y * 13.7 - 8.8, u.z * 13.7 + 3.6, 3);
  return smoothstep(0.47, 0.60, n);
}

/** The five surface weights at one point: sand, forest floor, rock, snow, and
    grass as whatever is left. This is the map's own legend for the SPLAT, the
    same way BIOME is its legend for the colour, and the two are read from the
    same three numbers so a sandy beach is never painted green.
    Written into an `aSplat` vec4 attribute rather than recomputed in the
    fragment shader: four fbm calls per pixel would be the whole frame budget,
    and at 5.6 units per vertex the interpolation is finer than the textures. */
const _splat = [0, 0, 0, 0];
function splatWeights(u, e, slope, lat) {
  /* BEACH. Low, and FLAT — a sea cliff is rock, not sand, and without the slope
     term every steep shore came back with sand painted up its face. */
  const sand = smoothstep(2.8, 0.3, e) * (1 - smoothstep(0.14, 0.32, slope));
  const snow = Math.max(smoothstep(39, 46, e), smoothstep(60, 74, lat));
  const rock = Math.max(smoothstep(0.28, 0.58, slope), smoothstep(32, 43, e));
  /* Woods live between the beach and the treeline and not on a cliff. */
  const forest = forestMask(u) * smoothstep(2.4, 6.5, e) * (1 - smoothstep(27, 38, e))
                 * (1 - rock) * (1 - snow) * (1 - sand);
  _splat[0] = sand; _splat[1] = forest; _splat[2] = rock; _splat[3] = snow;
  return _splat;
}

function biomeColor(u, e, slope, tint, out) {
  const lat = Math.abs(Math.asin(clamp(u.y, -1, 1)) / DEG);
  if (e <= 0.4) { out.copy(BIOME.seabed).lerp(BIOME.sand, smoothstep(-9, 0.4, e)); return out; }
  out.copy(BIOME.sand);
  out.lerp(BIOME.grass, smoothstep(1.2, 4.2, e));
  /* The woods, as COLOUR as well as texture. The splat puts forest_floor under
     the canopy; without a darker green with it, a wood from a region view is
     the same green as the field beside it and the trees look like litter. */
  out.lerp(BIOME.forest, forestMask(u) * smoothstep(2.4, 6.5, e) * 0.85);
  /* Dry high ground before rock: a continent that goes grass -> rock with
     nothing between reads as a plastic model. */
  /* 20-33, not 13-25. The ridged detail and the range term put typical
     inland ground at about 20 units on this planet, so the old band read the
     WHOLE of every continent as dry high ground: globe-continent.png came back
     as olive-tan mush with no green in it anywhere. Measured against
     __probe(): Werkland's interior samples 17 to 25. */
  out.lerp(BIOME.scrub, smoothstep(20, 33, e) * 0.72);
  out.lerp(BIOME.rock, Math.max(smoothstep(33, 44, e), smoothstep(0.42, 0.78, slope)));
  /* Snow: high, or polar. Both, because a planet with a snowline and no ice
     caps is a planet nobody believes. */
  out.lerp(BIOME.snow, Math.max(smoothstep(40, 46, e), smoothstep(64, 78, lat)));
  /* The continent's own tint, faint. It is the difference between five
     landmasses and one landmass drawn five times, and at 0.16 it is a cast
     rather than a colour-coded key — the map is not a pie chart. */
  if (tint) out.lerp(tint, 0.16);
  /* MACRO VARIATION, at three scales, and this is where a continent stops
     reading as a painted ball. A 1k ground texture tiled every 2.4 metres is
     already past its own last mip level by 300 units up, so from a region view
     there is NOTHING in the picture but the vertex colour — the first continent
     capture came back as green mush with towns sitting on it. Frequency 9 is
     400-unit country (which half of the continent is in), 34 is 110-unit
     forest-and-field, 96 is 40-unit patchwork, right at what the 5.6-unit
     vertex spacing can still carry. Three multiplies, no texture. */
  const macro = 0.80 + 0.24 * fbm3(u.x * 9.1 + 4.2, u.y * 9.1 - 1.9, u.z * 9.1 + 6.6, 2)
                     + 0.14 * fbm3(u.x * 34 - 7.7, u.y * 34 + 2.1, u.z * 34 - 3.3, 2)
                     + 0.09 * fbm3(u.x * 96 + 1.3, u.y * 96 - 5.8, u.z * 96 + 8.4, 1);
  out.multiplyScalar(macro);
  /* And a hue shift with it: the drier patches go yellow, not just pale. A
     variation that only changes VALUE reads as dirt on the lens. */
  out.offsetHSL(-0.03 * (macro - 1.0) * 3.0, 0.06 * (1.0 - macro) * 3.0, 0);
  return out;
}

function buildPlanet() {
  planetGroup = new THREE.Group();
  planetGroup.name = 'planet';
  const tintOf = {};
  for (const c of CONTINENTS) tintOf[c.key] = new THREE.Color(c.tint);

  const mat = groundMaterial();
  const tmpC = new THREE.Color();
  const dir = new THREE.Vector3();
  let landVerts = 0, allVerts = 0;

  for (const face of FACES) {
    const N = FACE_N, W = N + 3;             // one vertex of overlap each side,
    const P = new Float32Array(W * W * 3);   // so normals are exact at the seam
    const E = new Float32Array(W * W);
    const D = new Float32Array(W * W * 3);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const a = ((i - 1) / N) * 2 - 1, b = ((j - 1) / N) * 2 - 1;
        const u = cubeToSphere(face.f(a, b));
        const e = elevAt(u);
        const k = j * W + i;
        E[k] = e;
        D[k * 3] = u.x; D[k * 3 + 1] = u.y; D[k * 3 + 2] = u.z;
        /* THE SEABED GOES DOWN. It used to be clamped at -0.02, i.e. the whole
           ocean floor was a shell two hundredths of a unit under the water
           surface — and at 1,750 units of camera distance one depth-buffer step
           is about 0.15 units, so the sea and the seabed z-fought across the
           entire ocean and the dark olive seabed won most of the pixels. THAT is
           why globe-space.png reads as slate: what was being looked at was
           mostly not water. With the shelf profile there is now a real bathymetry
           to draw, and the ocean sphere at exactly R sits on top of all of it. */
        const r = R + e;
        P[k * 3] = u.x * r; P[k * 3 + 1] = u.y * r; P[k * 3 + 2] = u.z * r;
      }
    }

    /* The real grid is the inner (N+1)^2; the border only ever feeds the
       normals. Normals from CENTRAL DIFFERENCES of the displaced positions, not
       from computeVertexNormals(): three of the six faces meet along an edge,
       and a face-averaged normal has nothing to average with on the far side of
       that edge, so a seam runs across the planet exactly where the cube's is.
       Central differences never look at a triangle, only at the height field,
       which is continuous across the seam by construction. */
    const V = N + 1;
    const pos = new Float32Array(V * V * 3);
    const nor = new Float32Array(V * V * 3);
    const col = new Float32Array(V * V * 3);
    const uvs = new Float32Array(V * V * 2);
    const slp = new Float32Array(V * V);
    const spl = new Float32Array(V * V * 4);      // sand · forest · rock · snow
    const wet = new Float32Array(V * V);          // river channel, 0..1
    const twn = new Float32Array(V * V);          // trodden ring round a settlement
    const du = new THREE.Vector3(), dv = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let j = 0; j < V; j++) {
      for (let i = 0; i < V; i++) {
        const k = (j + 1) * W + (i + 1), o = j * V + i;
        pos[o * 3] = P[k * 3]; pos[o * 3 + 1] = P[k * 3 + 1]; pos[o * 3 + 2] = P[k * 3 + 2];
        du.set(P[(k + 1) * 3] - P[(k - 1) * 3],
               P[(k + 1) * 3 + 1] - P[(k - 1) * 3 + 1],
               P[(k + 1) * 3 + 2] - P[(k - 1) * 3 + 2]);
        dv.set(P[(k + W) * 3] - P[(k - W) * 3],
               P[(k + W) * 3 + 1] - P[(k - W) * 3 + 1],
               P[(k + W) * 3 + 2] - P[(k - W) * 3 + 2]);
        nn.crossVectors(du, dv).normalize();
        dir.set(D[k * 3], D[k * 3 + 1], D[k * 3 + 2]);
        if (nn.dot(dir) < 0) nn.negate();
        nor[o * 3] = nn.x; nor[o * 3 + 1] = nn.y; nor[o * 3 + 2] = nn.z;
        /* Slope as 1 - (surface normal . up), i.e. 0 flat, 1 vertical. It is
           what the shader blends cliff over grass with, and what biomeColor
           puts rock on. */
        const slope = 1 - clamp(nn.dot(dir), 0, 1);
        slp[o] = slope;
        const latAbs = Math.abs(Math.asin(clamp(dir.y, -1, 1)) / DEG);
        const sw = splatWeights(dir, E[k], slope, latAbs);
        spl[o * 4] = sw[0]; spl[o * 4 + 1] = sw[1];
        spl[o * 4 + 2] = sw[2]; spl[o * 4 + 3] = sw[3];
        wet[o] = riverAt(dir, landMask(dir));
        twn[o] = townGround(dir);
        biomeColor(dir, E[k], slope, tintOf[continentUnder(dir)], tmpC);
        col[o * 3] = tmpC.r; col[o * 3 + 1] = tmpC.g; col[o * 3 + 2] = tmpC.b;
        uvs[o * 2] = i / N; uvs[o * 2 + 1] = j / N;
        allVerts++; if (E[k] > 0.2) landVerts++;
      }
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('aSlope', new THREE.BufferAttribute(slp, 1));
    g.setAttribute('aSplat', new THREE.BufferAttribute(spl, 4));
    g.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
    g.setAttribute('aTown', new THREE.BufferAttribute(twn, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = 'face' + face.key;
    m.receiveShadow = true;
    planetGroup.add(m);
  }
  planetGroup.userData.landFraction = landVerts / Math.max(1, allVerts);
  scene.add(planetGroup);
}

/** Which continent a direction sits on, for the tint only. Nearest centre
    inside its own radius; null out at sea and on the islands. */
function continentUnder(u) {
  let best = null, bd = 1e9;
  for (const c of CONTINENTS) {
    const d = angDist(u, c.axis);
    if (d < c.r * 1.25 && d < bd) { bd = d; best = c.key; }
  }
  return best;
}

/* --- The ground material -------------------------------------------------- */
function groundMaterial() {
  const g = tex.grass, cf = tex.rockCliffB;
  const mat = new THREE.MeshStandardMaterial({
    map: g.diffuse, normalMap: g.normal, roughnessMap: g.arm,
    roughness: 1.0, metalness: 0.0, vertexColors: true,
    normalScale: new THREE.Vector2(0.85, 0.85),
  });
  /* TWO TILE SCALES, and this is the "macro variation" line of the realism bar
     doing real work. One scale is either a mush of repeats from orbit or a
     smear of one texel at street level; there is no single number that is both.
     Detail = 2.4 m per tile (what you read standing in a field), macro = 46 m
     (what breaks the repeat from 400 units up), mixed 0.62/0.38.
     46, NOT the 27 round 2 shipped, and the range 30-60 is the brief's. At 27 m
     the macro read repeats about eleven times across one settlement's own
     valley, which is fine enough that from a region view it beats against the
     detail read into a regular weave rather than breaking it — the "good clay,
     not photography" note in HANDOFF is mostly that weave. At 46 there are six
     tiles across the same valley and the second read reads as terrain. No extra
     fetch: this is the SAME two reads at a different second scale, and a third
     scale was measured at 3 fps for a difference nobody could point at.
     Plus the cliff pack blended in by slope, which is what stops every mountain
     in the world being grass on a steep angle. */
  const uni = {
    uDetail: { value: (R * Math.PI / 2) / 2.4 },
    uMacro:  { value: (R * Math.PI / 2) / 46 },
    uCliff:  { value: cf.diffuse },
    uCliffN: { value: cf.normal },
    /* The four splat layers, in the order splatWeights() writes them. Each is
       ONE read at the detail scale — the macro second read is spent on grass and
       rock only, because those are the two that cover enough of the frame from a
       region view for the repeat to be visible. */
    uSand:   { value: tex.sand.diffuse },
    uForest: { value: tex.forestFloor.diffuse },
    uSnow:   { value: tex.snow.diffuse },
    /* Triplanar for ROCK ONLY, and only rock. The cube-face UV is a regular
       grid in the tangent plane, so on a 60-degree face the texture is stretched
       by 1/cos(60) = 2 vertically and reads as smeared toffee — which is what a
       mountain looked like at street level. Triplanar costs three reads instead
       of one; doing it for all five layers is fifteen, which the 860M does not
       have. Rock is the only layer that ever sits on a steep face. */
    uTriScale: { value: 1 / 3.6 },              // metres per tile, world-space
    /* THE SECOND ROCK SCALE, 38 m per tile, inside the brief's 30-60 band and
       deliberately not a multiple of the 46 m ground macro — two coarse reads
       on the same ratio beat against each other into a plaid. */
    uMacroRock: { value: 1 / 38 },
    /* HOW MUCH OF THE FRAME ONE FINE TILE COVERS, 0 at a street and 1 at region
       range and beyond. Written once a frame from the camera's altitude in
       updateSun(), not per fragment: the answer is the same for the whole
       ground and a derivative-based version costs a `fwidth` on every one of
       the 338,688 triangles for a number that does not vary across them.
       120 m is where a 2.4 m tile has gone under a pixel; 520 is where the
       46 m one starts to. */
    uCoarse: { value: 0 },
    uCloud:  { value: null },
    uCloudRot: { value: 0 },
    uCloudAmt: { value: 0.34 },
    uSun:    { value: new THREE.Vector3(1, 0, 0) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aSlope;\nattribute vec4 aSplat;\nattribute float aWet;\nattribute float aTown;\n' +
        'varying float vSlope;\nvarying vec3 vWDir;\nvarying vec4 vSplat;\nvarying float vWet;\nvarying float vTown;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvSlope = aSlope;\nvSplat = aSplat;\nvWet = aWet;\nvTown = aTown;\n' +
        'vWPos = (modelMatrix * vec4(position,1.0)).xyz;\nvWDir = normalize(vWPos);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSlope; varying vec3 vWDir; varying vec4 vSplat;
        varying float vWet; varying float vTown; varying vec3 vWPos;
        uniform float uDetail, uMacro, uCloudRot, uCloudAmt, uTriScale;
        uniform float uMacroRock, uCoarse;
        uniform sampler2D uCliff, uCliffN, uCloud, uSand, uForest, uSnow;
        /* Triplanar: three planar reads blended by the squared surface normal.
           The square is what makes the seam between two planes short instead of
           a third of the face wide. */
        vec4 tri(sampler2D t, vec3 p, vec3 n) {
          vec3 w = n * n;
          return texture2D(t, p.yz) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
        }`)
      .replace('#include <map_fragment>', `
        vec2 uvD = vMapUv * uDetail;
        vec2 uvM = vMapUv * uMacro;
        vec4 gr = texture2D(map, uvD) * 0.62 + texture2D(map, uvM) * 0.38;
        /* THE SPLAT, in the order a surface actually stacks: grass is the
           ground, the beach and the woods lie on it, rock cuts through both
           because a crag has no soil on it, and snow sits on top of everything.
           Painting them in any other order puts sand on a cliff face. */
        vec3 tn = abs(normalize(vWDir));
        vec4 rk = tri(uCliff, vWPos * uTriScale, tn);
        /* THE COARSE ROCK READ, and this is where "a mountain from 600 m" stops
           being one grey. uTriScale is 3.6 m per tile, which past ~250 units is
           four tiles inside one pixel and mips away to the texture's own mean —
           so the second read is the SAME triplanar at uMacroRock (38 m per
           tile, in the brief's 30-60 band), and the two are mixed by how much
           of the frame a tile covers rather than 50/50. uCoarse is that mix,
           written once a frame from the camera's altitude. */
        vec4 rkM = tri(uCliff, vWPos * uMacroRock, tn);
        rk = mix(rk, rkM, uCoarse * 0.72);
        /* And the same second scale for the two splat layers that cover enough
           of a REGION frame to matter: the forest floor under every wood and the
           snow on every summit. Sand is a beach — it is never more than a line
           at this range — so it keeps its one read and its one fetch. */
        vec4 fo = mix(texture2D(uForest, uvD), texture2D(uForest, uvM * 1.6), uCoarse * 0.66);
        vec4 sn = mix(texture2D(uSnow, uvD * 0.7), texture2D(uSnow, uvM), uCoarse * 0.6);
        vec4 sampledDiffuseColor = gr;
        sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(uSand,   uvD * 0.34), vSplat.x);
        sampledDiffuseColor = mix(sampledDiffuseColor, fo,                             vSplat.y);
        sampledDiffuseColor = mix(sampledDiffuseColor, rk,                             vSplat.z);
        sampledDiffuseColor = mix(sampledDiffuseColor, sn,                             vSplat.w);
        /* THE SETTLEMENT GROUND LAYER — the fifth thing on the ground, and
           the reason it is a separate weight rather than a fifth splat channel
           is that aSplat is a vec4 and this is not a surface, it is a state OF
           a surface. Round 3's brief: "the terrain splat under the near town
           must not read as bare clay". It does not read as clay any more (the
           pad wears grass now), but the country immediately outside a
           settlement was still the same untouched meadow right up to the last
           house, and a village with no worn ground round it reads as a model on
           a lawn. This warms and dries the ground over the ring the pads and
           lanes stop in — a tint on the sample that is already there, NOT
           another texture fetch, because the ground shader is most of the frame
           at every altitude and the street pose has no fetch to spare. */
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb,
          sampledDiffuseColor.rgb * vec3(1.24, 1.10, 0.86) + vec3(0.020, 0.016, 0.008),
          vTown);
        diffuseColor *= sampledDiffuseColor;
        /* THE RIVER, painted rather than modelled: the channel is already cut
           into the terrain by riverAt(), and this is the water in it — dark,
           smooth and a little blue, which is what a river looks like from the
           air. Roughness goes with it or a river reads as wet mud. */
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.105, 0.135), vWet * 0.88);
        /* CLOUD SHADOW. The deck above is a texture on a sphere, so its shadow
           is that same texture read along this fragment's own direction from
           the planet's centre, turned by the deck's current rotation. A real
           shadow map for a shell that covers the whole world would be a second
           full render of everything; this is one texture read and it is
           geometrically the same answer for a thin shell. */
        float lon = atan(vWDir.z, vWDir.x) / 6.2831853 + 0.5 + uCloudRot;
        float lat = asin(clamp(vWDir.y, -1.0, 1.0)) / 3.14159265 + 0.5;
        float cov = texture2D(uCloud, vec2(lon, lat)).r;
        diffuseColor.rgb *= 1.0 - uCloudAmt * smoothstep(0.42, 0.86, cov);`)
      .replace('#include <normal_fragment_maps>', `
        /* TWO normal maps, not five. A normal map only earns its fetch where the
           surface has relief the light can catch across it — grass and rock. The
           beach, the forest floor and the snow all take the grass normal, which
           at 2.4 m per tile is a fine random bump and reads correctly under all
           three. Measured: adding three more normal fetches cost 6 fps and
           changed nothing anyone could point at. */
        /* THE NORMAL AT TWO SCALES, and this is the single biggest thing wrong
           with globe-continent.png. A 2.4 m normal map read from 600 units up is
           two hundred tiles inside one pixel: it mips to flat, the ground loses
           every gradient it had, and a continent reads as a painted ball with
           towns sitting on it. The 46 m read still has six tiles across a
           valley at that altitude, so the light finally has something to fall
           across. Mixed by uCoarse — nothing changes at street level, where the
           fine read is the one that is resolvable. */
        vec3 mapNg = mix(texture2D(normalMap, vMapUv * uDetail).xyz,
                         texture2D(normalMap, vMapUv * uMacro).xyz, uCoarse) * 2.0 - 1.0;
        /* PLANAR, not triplanar, for the rock NORMAL — the colour keeps its
           three reads. A normal map's job on a cliff is to break the light up,
           and a stretched one still does that; a stretched ALBEDO is the thing
           that reads as smeared toffee. Two texture fetches saved on every
           ground fragment, and the ground is most of the frame at every
           altitude: 3 fps at orbit on the 860M. */
        vec3 mapNc = mix(texture2D(uCliffN, vMapUv * uDetail).xyz,
                         texture2D(uCliffN, vMapUv * uMacro).xyz, uCoarse) * 2.0 - 1.0;
        vec3 mapN = mix(mapNg, mapNc, vSplat.z);
        /* The coarse normal is a 46 m bump and a 46 m bump is SHALLOW — read at
           the detail scale's own normalScale it is a smear. 1.5x on the coarse
           half only, which is what makes a hillside at region range have a lit
           face and a shaded one. The real hills are in the mesh; this is the
           metre-scale relief on them that the mip level ate. */
        mapN.xy *= normalScale * (1.0 + uCoarse * 0.5) * (1.0 - vWet * 0.9);
        normal = normalize(tbn * mapN);`)
      /* Wet things are smooth. Without this the river bed takes the grass
         roughness map and the channel is a dark matte stripe, not water. */
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, vWet * 0.9);`);
    mat.userData.sh = sh;
    mat.userData.uni = uni;
  };
  mat.customProgramCacheKey = () => 'globe-ground';
  groundMaterials.push(mat);
  return mat;
}


/* =============================================================================
   THE OCEAN — depth colour, a sun glint and a fresnel horizon
   Not three.js's Water: Water is a planar reflector with a fixed up vector and
   a sun direction in ITS plane, and on a sphere every one of those assumptions
   is wrong at 90 degrees away. This is the same three ingredients written for a
   sphere: colour from the seabed under the fragment, one specular lobe from the
   real sun, and a fresnel that takes over at the limb — which is what makes an
   ocean read as an ocean from orbit rather than as a blue ball.
   ========================================================================== */
function buildOcean() {
  const g = new THREE.IcosahedronGeometry(R, 6);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const depth = new Float32Array(p.count);
  const shore = new Float32Array(p.count);
  const u = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    u.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    /* elevRaw, NOT elevAt: a settlement pad has no business colouring the sea,
       and an offshore hamlet's pad would otherwise draw a bright square of
       shallow water around an island that is already drawn. */
    const e = elevRaw(u);
    /* 22, not 30: the shelf profile puts almost the whole open ocean past -30,
       so a /30 mapping saturated at 1 everywhere and the three colour stops all
       collapsed onto the deepest one — one flat blue disc. */
    depth[i] = clamp(-e / 22, 0, 1);
    /* THE FOAM BAND. 1 at the water's edge, 0 by 2.6 units of depth. It only
       exists because the shelf does: on the old ×66 coast the whole band was
       under a third of a unit wide horizontally and there was nowhere to draw a
       breaking line. Now it is ~14 units of shore and reads at region zoom. */
    /* -3.0, not -6.0, and the shader's own cut moved with it. The shelf is
       three times wider than it used to be, so a band defined six units DEEP is
       a hundred units WIDE on the ground: the first coast capture was a solid
       white sheet from the beach to the horizon. Kept as a smooth attribute
       rather than a hard edge because the ocean's vertices are ~10 units apart
       and the sharp line has to be cut in the fragment shader. */
    shore[i] = smoothstep(-3.0, 0.0, e);
  }
  g.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
  g.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun:    { value: new THREE.Vector3(1, 0, 0) },
      uSunCol: { value: new THREE.Color(0xffd9a8) },
      uNight:  { value: 0 },
      uTime:   { value: 0 },
      uNormal: { value: null },
      /* Brighter and bluer than the first build's 0x1d6d78 / 0x08192e, which
         made the sea the same VALUE as the land and turned the whole planet
         into one brown ball. Water from orbit is dark, but it is dark BLUE, and
         the separation between land and sea is the first thing that has to read
         from a thousand units up. */
      /* THREE stops, not two, and this is the whole "blue from orbit, not
         slate" fix together with the wave normal that was never loaded. Real
         water reads as a bright turquoise bench over the shelf, an open blue
         over the slope and a near-black navy over the abyss; a two-stop lerp
         between one teal and one navy averages to the grey-green the first
         globe-space.png shows. The shelf added by elevRaw() is what gives the
         first of the three anywhere to live. */
      /* These three are the colours going INTO ACES at exposure 0.85, not the
         colours coming out of it. A #123c6e that looks right in a swatch comes
         out of that curve at roughly #0d2038 — near black, and the reason
         globe-space.png read as slate. Measured against the target on the way
         out: shelf ~#5fc9c4, shallow ~#2f7fae, deep ~#1c4470. */
      uShelf:  { value: new THREE.Color(0x6fdcd2) },
      uShallow:{ value: new THREE.Color(0x3aa8d6) },
      uDeep:   { value: new THREE.Color(0x27619c) },
    },
    vertexShader: `
      attribute float aDepth; attribute float aShore;
      varying float vDepth; varying float vShore; varying vec3 vN; varying vec3 vW;
      void main(){
        vDepth = aDepth; vShore = aShore;
        vN = normalize(position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uSun, uSunCol, uShelf, uShallow, uDeep;
      uniform float uNight, uTime;
      uniform sampler2D uNormal;
      varying float vDepth; varying float vShore; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        /* The wave normal. Two scrolling reads of the pack's own water normal,
           projected on the sphere's tangent frame — one read is a moving
           pattern, two at different speeds is water. */
        vec3 T = normalize(cross(vec3(0.0,1.0,0.0), vN) + vec3(1e-4));
        vec3 B = cross(vN, T);
        vec2 uv = vec2(dot(vW, T), dot(vW, B)) * 0.017;
        vec3 n1 = texture2D(uNormal, uv + vec2(uTime * 0.011, 0.0)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uNormal, uv * 1.9 - vec2(0.0, uTime * 0.017)).xyz * 2.0 - 1.0;
        vec3 nm = normalize(n1 + n2);
        /* 0.055: any more and the glint scatters into a field of sparkles that
           reads as static from orbit, which is the failure this number is
           tuned against. */
        /* THE WAVES FADE OUT WITH DISTANCE, and this is not a look — it is
           the fix for a real artefact. The wave uv is a world-space projection,
           so at a grazing angle one texel spans many pixels and the two
           scrolling reads beat against each other: the first coast capture came
           back as a hard diagonal corduroy across the whole sea. Damped to a
           seventh of its strength past 600 units, the water is water near the
           lens and a flat sheet at the horizon, which is also what water looks
           like. */
        float wFar = smoothstep(70.0, 620.0, length(cameraPosition - vW));
        vec3 N = normalize(vN + (T * nm.x + B * nm.y) * 0.055 * (1.0 - wFar * 0.86));

        float sd = max(dot(N, uSun), 0.0);
        vec3 base = mix(uShelf, uShallow, smoothstep(0.01, 0.14, vDepth));
        base = mix(base, uDeep, smoothstep(0.16, 0.62, vDepth));
        /* 0.30, not 0.13: the sky lights water from every direction, and a sea
           lit only by the sun goes black the moment it faces away from it. */
        vec3 col = base * (0.46 + 0.74 * sd);

        /* THE SHORE FOAM. Two scrolling bands of the same wave normal used as a
           scalar, so the line breaks and re-forms instead of being a painted
           ring. It sits inside the last few units of depth, which only exist
           because of the shelf — on the old coast there was nothing to draw it
           on. */
        float band = smoothstep(0.86, 1.0, vShore);
        float surge = 0.5 + 0.5 * sin(uTime * 0.9 + dot(vW, T) * 0.06);
        float foam = band * (0.45 + 0.55 * surge);
        col = mix(col, vec3(0.86, 0.92, 0.95) * (0.35 + 0.65 * sd), clamp(foam, 0.0, 0.80));

        /* THE GLINT. A tight Blinn-Phong lobe on the wave normal — this is the
           bright smear that appears where the sun's reflection would be and
           moves as the planet turns. Squared falloff at the terminator so it
           does not survive on to the night side. */
        vec3 H = normalize(uSun + V);
        /* ONE tight lobe and one very weak broad one. The first build had 3.4 at
           exponent 520 plus 0.24 at 46, and the 46 spread a sheet of white over a
           quarter of the disc that the bloom then took the rest of the way — the
           capture read as an overexposed cloud, not as a sea. A glint is a small
           bright thing; if it is large it is not a glint. */
        /* CAPPED, and the cap is the fix for a whole-frame blowout. The wave
           normal only tilts N by 0.055, so when the camera looks straight DOWN
           anywhere near the sub-solar point, N, V and the sun are all the same
           direction across the entire visible sea and the 900-exponent lobe
           saturates over the whole disc — the first three coast captures came
           back as a white sheet from the beach to the horizon, and it was read
           as cloud, then as foam, before it was read as this. A glint is a
           bright PATCH. 0.34, not the 0.55 round 2 shipped: at 0.55 the
           coast capture still had a pale wash over a third of the water,
           because the bloom adds to it after the cap and the cap is applied
           BEFORE the tone map. 0.34 through ACES at exposure 0.85 tops out at
           about 0.62 on screen, which is a bright patch of sea rather than a
           hole in it. The broad lobe drops with it (0.07 -> 0.045) — it is the
           half of the glint that spreads, so it is the half that has to be
           small. */
        float spec = min(0.34, pow(max(dot(N, H), 0.0), 900.0) * 1.7
                              + pow(max(dot(N, H), 0.0), 90.0) * 0.045);
        col += uSunCol * spec * smoothstep(0.0, 0.22, dot(vN, uSun));

        /* FRESNEL. At a grazing angle water is a mirror, and on a sphere the
           limb is ALL grazing angle — this is why an ocean planet has a pale
           bright edge and a dark middle. */
        float f = pow(1.0 - max(dot(N, V), 0.0), 4.2);
        col = mix(col, mix(vec3(0.24,0.34,0.44), vec3(0.05,0.07,0.12), uNight), f * 0.52);

        col *= mix(1.0, 0.17, uNight);
        /* LINEAR OUT, and no tonemapping or colorspace include here. Every
           other material on this page writes linear into the composer's target
           and the OutputPass tone-maps and encodes ONCE at the end; this shader
           was doing both itself as well, so the sea was ACES-curved and
           sRGB-encoded TWICE. What that looks like: the water comes out far
           brighter than it was authored, the bloom threshold then catches all
           of it, and every near-nadir sea view is a white sheet with a sharp
           coastline through it — which was read as cloud, then as foam, then as
           the sun glint, before it was read as this. */
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  mat.uniforms.uNormal.value = tex.waterNormal.diffuse;
  oceanMesh = new THREE.Mesh(g, mat);
  oceanMesh.name = 'ocean';
  oceanMesh.renderOrder = -1;
  scene.add(oceanMesh);
}


/* =============================================================================
   THE ATMOSPHERE — a fresnel shell, drawn from the inside
   The rim is the single cheapest thing that separates "a planet" from "a
   textured ball": it is the only element in the frame that is BETWEEN the eye
   and the surface, so it is what gives the limb depth. Back side and additive,
   so it costs one full-screen-ish draw with no depth write and no sorting.
   ========================================================================== */
function buildAtmosphere() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSun:  { value: new THREE.Vector3(1, 0, 0) },
      uDay:  { value: new THREE.Color(0x4a86c8) },
      uDusk: { value: new THREE.Color(0xd0703a) },
      uNight:{ value: 0 },
      /* 0 in orbit, 1 standing on the ground. A pure rim shader is right for a
         planet seen from outside and WRONG the moment the camera is inside the
         shell: the first street capture had a black sky over a sunlit town,
         because overhead is exactly where a rim term goes to zero. */
      uInside:{ value: 0 },
    },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(position);
        vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uSun, uDay, uDusk; uniform float uNight, uInside;
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        /* Drawn from the INSIDE, so the shell's outward normal faces away and
           the rim is where the view is most nearly ALONG it. */
        /* 5.2, not 3.4. The shell is now 1.34 R rather than 1.11 R, so the
           geometric band it covers on the disc is three times wider; a higher
           power puts the light back at the very edge where a limb actually is
           instead of spreading it across a third of the planet. */
        float rim = pow(clamp(1.0 - abs(dot(vN, V)), 0.0, 1.0), 5.2);
        float lit = dot(vN, uSun);
        /* Rayleigh in one line: blue where the air is lit head-on, orange where
           the light has gone through the most of it — the terminator band. */
        vec3 tint = mix(uDusk, uDay, smoothstep(0.02, 0.42, lit));
        float amt = smoothstep(-0.34, 0.16, lit);
        /* Forward scatter: the limb in FRONT of the sun is brighter than the
           limb beside it. Without this the ring is uniform and reads as a
           decal. */
        float fwd = pow(max(dot(V, -uSun), 0.0), 3.0) * 0.5;
        /* From inside, the whole dome carries air — most of it overhead, all of
           it at the horizon, which is the gradient a sky actually has. */
        /* 0.85 overhead, not 0.42: a daylight sky is BRIGHT, and the first
           version's inside band put a midday zenith at a quarter of the rim's
           own value — the street capture had a midnight-blue sky over a sunlit
           village. The extra (1 + uInside) is the same argument again: from
           inside you are looking through the whole depth of the air, not
           across the sliver of it that makes a limb. */
        float band = mix(rim, max(rim, 0.85 + 0.55 * rim), uInside);
        vec3 sky = tint * (band * (0.85 + fwd)) * amt * mix(1.0, 0.42, uNight);
        gl_FragColor = vec4(sky * (1.0 + uInside * 1.9), 1.0);
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  });
  atmoMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(R_SKY, 4), mat);
  atmoMesh.name = 'atmosphere';
  atmoMesh.renderOrder = 3;
  scene.add(atmoMesh);
}


/* =============================================================================
   THE CLOUD DECK — one noise texture, drifting, and the shadow it casts
   Built as a canvas rather than fetched: the pack has no cloud map, and a
   200 KB download for something that is three octaves of value noise is exactly
   the dependency the caveman rules are about. Deterministic — no Math.random —
   so docs/shots reproduce.
   ========================================================================== */
function cloudTexture(w = 1024, h = 512) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const u = new THREE.Vector3();
  for (let y = 0; y < h; y++) {
    const lat = (y / h - 0.5) * Math.PI;
    for (let x = 0; x < w; x++) {
      const lon = (x / w - 0.5) * Math.PI * 2;
      /* Sampled on the SPHERE direction, not on the pixel grid, so the map is
         seamless across the wrap AND does not pinch at the poles. */
      u.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      let n = fbm3(u.x * 3.4 + 17.1, u.y * 3.4 - 5.3, u.z * 3.4 + 9.8, 5);
      /* Banding: real cloud sits in latitude belts. One cosine is the whole
         difference between "noise" and "weather". */
      n *= 0.62 + 0.52 * Math.abs(Math.cos(lat * 2.6));
      /* The cut, and the only thing that sets how cloudy the planet is. The
         five-octave fbm times the latitude band has a mean near 0.44 and a
         standard deviation near 0.09, so 0.40 leaves a little under half the
         sphere under cloud. Coverage is reported by __clouds(): 0.4 is the
         number these two constants are set against. */
      const v = clamp((n - 0.42) * 3.0, 0, 1);
      const k = (y * w + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(v * 255);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function buildClouds() {
  const t = cloudTexture();
  for (const m of groundMaterials) if (m.userData.uni) m.userData.uni.uCloud.value = t;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: t }, uSun: { value: new THREE.Vector3(1, 0, 0) },
      uRot: { value: 0 }, uNight: { value: 0 }, uLive: { value: 0 },
      /* How much of the deck is drawn AT ALL, from the camera's altitude. */
      uHigh: { value: 1 },
    },
    vertexShader: `varying vec3 vN; varying vec2 vUv; varying vec3 vW;
      void main(){ vN = normalize(position); vUv = uv;
        vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uSun; uniform float uRot, uNight, uHigh;
      varying vec3 vN; varying vec2 vUv; varying vec3 vW;
      void main(){
        float a = texture2D(uMap, vec2(vUv.x + uRot, vUv.y)).r;
        a = smoothstep(0.10, 0.86, a);
        if (a < 0.01) discard;
        float lit = clamp(dot(vN, uSun) * 1.25 + 0.16, 0.0, 1.0);
        vec3 col = mix(vec3(0.26,0.29,0.36), vec3(0.88,0.86,0.83), lit);
        col = mix(col, col * 0.30, uNight);
        /* Thinner at the limb, or the deck reads as a hard shell edge outside
           the planet's own silhouette. */
        vec3 V = normalize(cameraPosition - vW);
        float rim = smoothstep(0.02, 0.34, abs(dot(vN, V)));
        /* THE DECK IS A FROM-ORBIT FEATURE. It sits 17 units above the
           ground on a 600-unit planet — a scaled altitude that makes it behave
           like fog rather than like weather — so from 220 units up it is a
           sheet between the lens and the map, and every coast and region
           capture in this pass came back as a white wash with a coastline
           through it. Full above 520 units, gone by 120. The cloud SHADOW on
           the ground is not faded with it: that is what still says there is
           weather up there when you are standing under it. */
        gl_FragColor = vec4(col, a * 0.62 * rim * uHigh);
      }`,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R_CLOUD, 96, 64), mat);
  cloudMesh.name = 'clouds';
  cloudMesh.renderOrder = 2;
  scene.add(cloudMesh);
}


/* =============================================================================
   THE STARS — deterministic, on a shell outside everything
   ========================================================================== */
function buildStars() {
  const N = 2600;
  const pos = new Float32Array(N * 3), sz = new Float32Array(N), br = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    /* A hash, not Math.random: the shot list has to reproduce and a reshuffled
       sky is a different frame. Same rule terrain.js holds. */
    const a = hash3(i, 7, 3), b = hash3(i, 11, 5), c = hash3(i, 13, 17);
    const th = a * Math.PI * 2, ph = Math.acos(2 * b - 1), r = 26000;
    pos[i * 3] = Math.sin(ph) * Math.cos(th) * r;
    pos[i * 3 + 1] = Math.cos(ph) * r;
    pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
    sz[i] = 60 + c * c * 300;
    br[i] = 0.25 + c * 0.75;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('aBright', new THREE.BufferAttribute(br, 1));
  starField = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uPix: { value: window.innerHeight }, uDim: { value: 1 } },
    vertexShader: `attribute float aSize; attribute float aBright;
      varying float vB; uniform float uPix, uDim;
      void main(){ vB = aBright * uDim;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = max(1.0, aSize * uPix / (-mv.z));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vB;
      void main(){ vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.05, length(d));
        gl_FragColor = vec4(vec3(0.92,0.94,1.0) * vB, a * vB); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  starField.frustumCulled = false;
  scene.add(starField);
}


/* =============================================================================
   THE SUN — the real one, from the wall clock
   Sub-solar longitude from the hour, declination from the day of the year. The
   terminator on this planet is therefore where the terminator is: at 07:00 the
   camera's default continent is coming into the light, and the night-side
   settlement lights are the ones actually in the dark.
   ========================================================================== */
function sunDirection(date = new Date()) {
  const h = HOUR_OVERRIDE !== null ? HOUR_OVERRIDE
          : date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const doy = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / DAY);
  const decl = 23.44 * Math.sin(2 * Math.PI * (doy - 80) / 365.24);
  /* Noon puts the sun over longitude 0, and longitude runs the way ll() builds
     it. Both signs were checked against the shot at ?hour=19.5: the terminator
     has to be moving WEST across the map as the hour climbs. */
  return ll(decl, 180 - h * 15);
}

function buildLights() {
  sunLight = new THREE.DirectionalLight(0xffe6c2, 3.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.5;
  scene.add(sunLight, sunLight.target);
  /* A hemisphere light so the night side is not pure black: on a real planet
     the dark side is lit by starlight and by the atmosphere, and a black half
     makes the terminator read as a crop rather than as a shadow. */
  hemi = new THREE.HemisphereLight(0x8fb3cc, 0x1a1a22, 0.42);
  scene.add(hemi);
}


/* =============================================================================
   THE SETTLEMENTS
   Everything on the ground is INSTANCED or MERGED. 142 settlements drawn as 142
   groups would be several hundred draw calls before a single roof; as five
   instanced meshes and two merged ones it is seven, and seven is what holds
   40 fps on a Radeon 860M with the whole planet in frame.

   The local frame: at each settlement the surface normal is "up", and a
   deterministic bearing out of the town's own hash is "north". Every building
   in that town is placed in THAT frame, which is why a town on the far side of
   the planet stands up out of the ground instead of lying on its side.
   ========================================================================== */

/** The tangent frame at a point on the sphere: up, and two axes across it. */
function frameAt(axis, spinDeg = 0) {
  const up = axis.clone();
  let east = new THREE.Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  east.normalize();
  const north = up.clone().cross(east).normalize();
  if (spinDeg) {
    const s = Math.sin(spinDeg * DEG), c = Math.cos(spinDeg * DEG);
    const e2 = east.clone().multiplyScalar(c).addScaledVector(north, s);
    north.copy(north.multiplyScalar(c).addScaledVector(east, -s));
    east.copy(e2);
  }
  return { up, east, north };
}

/** Build a matrix that puts a unit box of size (w,h,d) standing on the ground at
    local offset (ox, oz) metres from the settlement centre, turned by `yaw`. */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _b = new THREE.Matrix4();
const _pos = new THREE.Vector3(), _sc = new THREE.Vector3();
function standMatrix(site, fr, ox, oz, yaw, w, h, d, lift = 0) {
  /* The offset is applied on the tangent PLANE and then pushed back out to the
     sphere, so a building 30 m from the centre of a town is 30 m along the
     ground and not 30 m through the planet. */
  const dir = site.axis.clone()
    .addScaledVector(fr.east, ox / R).addScaledVector(fr.north, oz / R).normalize();
  const up = dir;
  const e = fr.east.clone().addScaledVector(up, -fr.east.dot(up)).normalize();
  /* e CROSS up, not up cross e. makeBasis() below builds the basis (ax, up, az)
     and a basis whose determinant is NEGATIVE mirrors the geometry, which flips
     every triangle's winding — so back-face culling then hides the OUTSIDE of
     every wall and shows the inside. Read straight off the first street
     capture: each house was a hollow white cross of two intersecting cards
     instead of a box. Right-handed means e x up = n, and nothing else. */
  const n = e.clone().cross(up).normalize();
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ax = e.clone().multiplyScalar(cy).addScaledVector(n, sy);
  const az = n.clone().multiplyScalar(cy).addScaledVector(e, -sy);
  _pos.copy(dir).multiplyScalar(R + site.elev + h / 2 + lift);
  _m.makeBasis(ax.multiplyScalar(w), up.clone().multiplyScalar(h), az.multiplyScalar(d));
  _m.setPosition(_pos);
  return _m;
}


/** A rigid frame at a point on a settlement's ground: the axes a building
    stands in, with no scale on them. `make()` returns geometry already at its
    real size in metres, so anything scaled here would stretch it. */
function placeMatrix(site, fr, ox, oz, yaw, lift = 0) {
  const dir = site.axis.clone()
    .addScaledVector(fr.east, ox / R).addScaledVector(fr.north, oz / R).normalize();
  const up = dir;
  const e = fr.east.clone().addScaledVector(up, -fr.east.dot(up)).normalize();
  /* e CROSS up. A basis with a negative determinant mirrors the geometry and
     flips every triangle's winding, so back-face culling then hides the OUTSIDE
     of every wall — read straight off the first street capture, where each
     house was a hollow cross of two cards. Right-handed, and nothing else. */
  const n = e.clone().cross(up).normalize();
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ax = e.clone().multiplyScalar(cy).addScaledVector(n, sy);
  const az = n.clone().multiplyScalar(cy).addScaledVector(e, -sy);
  const m = new THREE.Matrix4().makeBasis(ax, up, az);
  m.setPosition(dir.multiplyScalar(R + site.elev + lift));
  return m;
}

/** The same frame with a SCALE on it, for the kit's unit instance geometry:
    its body is a 1x1x1 box whose base sits at y = 0, so the instance matrix's
    scale is the building's size in metres. */
function instMatrix(site, fr, ox, oz, yaw, w, h, d, lift = 0) {
  const m = placeMatrix(site, fr, ox, oz, yaw, lift);
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  m.extractBasis(c0, c1, c2);
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  m.makeBasis(c0.multiplyScalar(w), c1.multiplyScalar(h), c2.multiplyScalar(d));
  m.setPosition(pos);
  return m;
}

/* THE ROOF EAVE, and it is the KIT'S OWN NUMBER now.

   Round 3 carried a `roofScale()` workaround here because buildings.js baked a
   `1 + 0.9` overhang into a prism it then scaled by the real footprint — a 5 m
   cottage under a 9.5 m roof. docs/BUILDINGS.md (2026-09-06) records that fix
   landing: `instanced()` now builds the prism at a TRUE unit footprint and adds
   a fixed eave back in world metres at instance-matrix time,
   `scl.set(w + 0.5, 1, d + 0.5)`. The workaround is gone and this constant is
   the kit's own `roofOverhang`, copied here for the one reason globe.js writes
   its own instance matrices at all: the kit places on a flat world and these
   buildings stand on a sphere, so the SCALE has to be re-stated even though the
   geometry no longer needs correcting. y is 1, not min(w, d) — the prism's rise
   is a fixed 0.42 m in the kit's own instanced path and a globe roof that rose
   with its footprint would not match buildings.html's own street. */
const ROOF_EAVE = 0.5;

/* =============================================================================
   THE LOT PLAN — lanes first, then a lot beside each lane, then a building in it

   ROUND 2 PUT HOUSES ON A JITTERED POLAR LATTICE and the street capture came
   back with roofs driven through their neighbours: a lattice knows a house's
   CENTRE and nothing about its footprint, so a 6x11 church on the same ring as
   a 5x6 cottage overlaps it by two metres and no amount of jitter fixes that.
   A settlement is planned here the way a settlement is actually laid out: the
   lanes come first, every building gets a LOT beside one of them, and a lot is
   only taken if its footprint — inflated by the 1.2 m of daylight the brief
   asks for — clears every lot already taken and every carriageway. The test is
   a 2D separating-axis test on the tangent plane, which is exact for rectangles
   and is the same test `__overlaps()` audits the finished plan with.

   The three answers to a collision, in order, and the order is the point: MOVE
   the lot further back off the lane (1.6 m, then 3.2 m — a deeper front garden
   reads as a place, a missing house does not), then SHRINK the footprint (0.86,
   then 0.72 — the kit takes a per-item `footprint`, so a narrow house is a real
   narrow house and not a scaled picture of a wide one), and only then DROP it.
   `__structures().dropped` is how many were dropped, and it is reported rather
   than hidden: a village whose ground cannot hold twelve houses should show
   eleven, not twelve with one inside another.
   ========================================================================== */

const LOT_GAP = 1.2;          // metres of daylight between two footprints — the brief's number
const LOT_SETBACK = 1.1;      // from the edge of the carriageway to the front wall
const LOT_BACKOFF = [0, 1.6, 3.2];   // move, before shrinking
const LOT_SHRINK = [0.86, 0.72];     // shrink, before dropping
/* The plaza-rim buildings — the specials and the towers — have no lane to slide
   along, so their answer to a collision is to step OUT along their own bearing.
   The step is one cottage plus its daylight (5 + 1.2, rounded), and five of them
   reach 31 m, which is past the outer ring lane of every class on this planet. */
const LOT_PUSH = [0, 6.2, 12.4, 18.6, 24.8, 31.0];

/** The four corners of a footprint, in the settlement's own (east, north)
    metres. Local +X is (cos yaw, -sin yaw) and local +Z is -(sin yaw, cos yaw):
    read straight out of placeMatrix()'s basis, whose third axis is
    `n * cos - e * sin` where `n = east CROSS up`, and `east CROSS up` is MINUS
    fr.north. Getting the handedness wrong here is SILENT — the rectangles are
    still rectangles, they are just the mirror image of the buildings, so every
    overlap test then passes on a shape that is not there. */
function rectCorners(ox, oz, yaw, w, d) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ux = c * w / 2, uz = -s * w / 2;      // half the width, along local +X
  const vx = s * d / 2, vz = c * d / 2;       // half the depth, along local Z
  return [[ox - ux - vx, oz - uz - vz], [ox + ux - vx, oz + uz - vz],
          [ox + ux + vx, oz + uz + vz], [ox - ux + vx, oz - uz + vz]];
}

/** Do two convex quads on the plane overlap? The separating-axis theorem: two
    convex shapes are apart if and only if there is an axis on which their
    projections are apart, and for polygons the only axes worth testing are the
    edge normals. Eight tests for two quads, exact, with no tolerance to tune. */
function satOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      /* The edge's normal, un-normalised: the test compares two projections on
         the SAME axis, so the axis's length cancels out of the comparison. */
      const ax = P[j][1] - P[i][1], az = P[i][0] - P[j][0];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of A) { const t = v[0] * ax + v[1] * az; if (t < a0) a0 = t; if (t > a1) a1 = t; }
      for (const v of B) { const t = v[0] * ax + v[1] * az; if (t < b0) b0 = t; if (t > b1) b1 = t; }
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

/** The lanes of one settlement, in local metres: a plaza in the middle, lanes
    out of it, and one or two ring lanes round the built-up part.

    ORGANIC, not a surveyed grid, and the drift is the whole difference. Each
    lane leaves the plaza on its own bearing and then bows by up to a third of a
    radian over its length, with the bow growing as `t*t` so it leaves the
    square straight and wanders further out — which is what a lane that GREW
    looks like from above. Everything comes off the town's own hash, so two
    loads of the page lay out the same village. */
function laneNetwork(p, seed, radius) {
  /* THE PLAZA'S RADIUS IS A LOT-COUNT DECISION, not a taste one. Adjacent
     spokes leave the plaza 2*PI*plazaR/nSpoke apart, so at the 0.20 the first
     build used a town's five spokes started 6.8 m from each other — closer than
     one house is wide — and every lot on the inner half of every spoke was
     rejected against its neighbour's carriageway. At 0.26 they start 9.4 m
     apart and the inner ring fills. Measured: 110 of a town's 224 buildings
     dropped at 0.20, 12 at 0.26 with the rings below. */
  /* FEWER spokes on a hamlet, not more: three lanes out of a 12 m square is a
     crossroads, five is a star with no room between the arms. */
  const nSpoke = p.cls === 'city' ? 6 : p.cls === 'town' ? 6 : p.cls === 'village' ? 4 : 3;
  /* THE PLAZA'S RADIUS IS A LOT-COUNT DECISION, not a taste one. Adjacent
     spokes leave the plaza `2*PI*plazaR/nSpoke` apart, so at the 0.20-of-radius
     the first build used, a town's five spokes started 6.8 m from each other —
     closer than one house is wide — and every lot on the inner half of every
     spoke was rejected against its neighbour's carriageway. The third term is
     that arithmetic run backwards: 1.55 per spoke holds the arc between two
     lanes at 9.7 m, which is one house plus its gap, whatever the class.
     Measured across the planet: 312 of 804 buildings dropped without it, 41 with. */
  /* AND A SQUARE HAS TO BE BIG ENOUGH FOR THE BUILDING STANDING ON IT. Every
     lane on this planet LEAVES the plaza rim, and every lot is measured from
     it, so a landmark wider than the square it stands in is a landmark with a
     carriageway through it and cottages inside it — which is exactly what
     docs/shots/trade-hotel-landmark.png caught. The fourth term is the
     landmark's own reach: the distance from the town's centre to the furthest
     corner of its footprint, plus the apron. Nothing else in this function
     changes, so a settlement with no trade lays out exactly as before. */
  const lf = landmarkFootprint(p);
  const lmReach = lf ? Math.hypot(lf.w, lf.d) / 2 + LM_APRON : 0;
  const plazaR = Math.max(5.0, radius * 0.26, nSpoke * 1.55, lmReach);
  const reach = radius * 1.16;      // the lanes run past the built ring, into the fields
  const lanes = [];
  const base = (seed % 360) * DEG;
  for (let i = 0; i < nSpoke; i++) {
    /* +-0.35 rad of jitter on the bearing and up to +-0.55 of bow. The first
       numbers here were a tenth of these and every settlement on the planet
       came back as the same wheel — even spokes, one concentric ring. What
       makes a lane read as grown rather than surveyed is that no two of them
       leave the square at the same angle and none of them arrives straight. */
    const a0 = base + (i / nSpoke) * Math.PI * 2 +
               (((hash32(p.town.id + 'LA' + i) % 700) / 1000) - 0.35);
    const bow = (((hash32(p.town.id + 'LB' + i) % 1000) / 1000) - 0.5) * 1.10;
    const pts = [];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      const r = plazaR + t * (reach - plazaR);
      const a = a0 + bow * t * t;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    lanes.push({ pts, w: i === 0 ? 3.4 : 2.6, main: i === 0 });
  }
  /* THE RING. A settlement with only spokes has every building pointing at one
     square and nothing joining them, which reads as a wheel rather than as a
     place. The wobble is what stops it reading as a drawn circle. */
  /* TWO OR THREE RINGS, not one. A ring lane is where most of the lots
     actually are — a spoke is short and a ring is 2*PI long — so the ring count
     is the single biggest lever on how many houses a settlement can hold
     without one touching another. */
  /* RING SPACING IS THE OTHER HALF OF THE SAME ARITHMETIC. Two rows of lots
     back onto each other between two consecutive rings, so two rings closer
     than about 17 m have their inner and outer lots fighting for the same
     ground and BOTH rows lose. Four rings on the city measured WORSE than two
     (30 buildings against 45) for exactly that reason. Every gap below is over
     16 m in that class's own metres. */
  const rings = p.cls === 'city' ? [0.56, 1.02]
              : p.cls === 'town' ? [0.74]
              : [0.72];      // one ring is all a village or a hamlet has room for
  for (const f of rings) {
    const rr = radius * f, pts = [];
    /* OFF-CENTRE, and wobbling on two frequencies. A ring lane concentric with
       the plaza is the other half of the wheel: it turns the whole settlement
       into a dartboard. */
    const cx = (((hash32(p.town.id + 'RC' + f) % 1000) / 1000) - 0.5) * radius * 0.22;
    const cz = (((hash32(p.town.id + 'RD' + f) % 1000) / 1000) - 0.5) * radius * 0.22;
    for (let s = 0; s <= 26; s++) {
      const a = (s / 26) * Math.PI * 2;
      const k = 1 + 0.14 * Math.sin(a * 3 + (seed % 7)) + 0.07 * Math.sin(a * 5 - (seed % 11));
      pts.push([cx + Math.cos(a) * rr * k, cz + Math.sin(a) * rr * k]);
    }
    lanes.push({ pts, w: 2.6, ring: true });
  }
  /* The carriageways as quads, one per lane segment, so the SAT test that keeps
     two houses apart also keeps a house out of the road. */
  const corridors = [];
  for (const L of lanes) {
    for (let i = 0; i + 1 < L.pts.length; i++) {
      const ax = L.pts[i][0], az = L.pts[i][1];
      const dx = L.pts[i + 1][0] - ax, dz = L.pts[i + 1][1] - az;
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const nx = -dz / len * L.w / 2, nz = dx / len * L.w / 2;
      corridors.push([[ax - nx, az - nz], [ax + nx, az + nz],
                      [ax + dx + nx, az + dz + nz], [ax + dx - nx, az + dz - nz]]);
    }
  }
  return { lanes, corridors, plaza: { r: plazaR } };
}

/** Points every `step` metres along a polyline, each with the unit tangent
    there — the stations a lot can be hung off. */
function laneStations(pts, step) {
  const out = [];
  let next = step * 0.5, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const tx = dx / len, tz = dz / len;
    while (next <= acc + len) {
      const s = next - acc;
      out.push({ x: ax + tx * s, z: az + tz * s, tx, tz });
      next += step;
    }
    acc += len;
  }
  return out;
}

/** Where every building in one settlement stands, in metres from its centre.
    Written into `p.buildings` and read TWICE: once by buildSettlements() to
    place the distant LOD1 instances, and again by buildNearTown() to grow the
    same buildings at LOD0 when the camera walks in. One plan, two renderings —
    which is the only way the street can be the same place as the map.

    Also writes `p.lanes`, `p.plaza` and `p.lots`, which is what the ground
    ribbons, the dirt paths and Globe.getSettlement() are all drawn from. */
function planBuildings(p, seed, radius) {
  const net = laneNetwork(p, seed, radius);
  p.lanes = net.lanes;
  p.plaza = net.plaza;
  const out = [];
  const taken = [];            // accepted footprints, already inflated by LOT_GAP
  let dropped = 0;

  /* A candidate is accepted only if its inflated footprint clears every lot
     already taken AND every carriageway. `taken` holds the INFLATED rectangles,
     so the daylight between two finished buildings is LOT_GAP and not twice it:
     the gap is counted once, on the candidate. */
  const place = (type, ox, oz, yaw, w, d, sd, extra) => {
    const r = rectCorners(ox, oz, yaw, w + LOT_GAP, d + LOT_GAP);
    for (const t of taken) if (satOverlap(r, t)) return false;
    for (const q of net.corridors) if (satOverlap(r, q)) return false;
    taken.push(r);
    out.push(Object.assign({ type, ox, oz, yaw, w, d, seed: sd }, extra || {}));
    return true;
  };

  /* THE LANDMARK'S GROUND IS TAKEN FIRST, before a single lot is handed out.
     The plaza has already been grown to hold it (laneNetwork above), so the
     lanes cannot cross it; this is what keeps the BUILDINGS off it. It goes
     into `taken` and NOT into `out`: `out` is what the kit instances, and the
     landmark is drawn by buildLandmarks() out of its own geometry. Everything
     after this line therefore treats the landmark exactly as it treats a
     neighbour it must clear — a special pushed one ring further out, a house
     that takes the next station along the lane. Nothing is deleted for it. */
  const lmFoot = landmarkFootprint(p);
  if (lmFoot) taken.push(rectCorners(0, 0, lmFoot.yaw,
                                     lmFoot.w + LOT_GAP + LM_APRON,
                                     lmFoot.d + LOT_GAP + LM_APRON));
  /* AND THE SQUARE'S FURNITURE. The lanes leave the plaza rim, but a RING lane
     is off-centre and wobbles by up to 14%, so on a small settlement it can
     pass inside the square and hang a lot off it — which is how the first run
     of this pass still left two café tables standing in a cottage after the
     landmark itself was clear. The reserved patch is the props' own reach and
     not the whole plaza: reserving the square outright would push lots out of
     ground they have stood on for three passes without ever touching anything.
     `-rim.cz` because the rim is in STAGE metres and `taken` is in PLAN metres
     (see plazaPropSpots for the same conversion and the same reason). */
  const rim = plazaFreeRim(p);
  if (rim.r > 0) {
    const side = plazaPropReach(rim) * 2;
    taken.push(rectCorners(rim.cx, -rim.cz, 0, side, side));
  }

  /* THE SPECIALS STAND ON THE PLAZA, facing in. A church on the square is the
     one building that says "village" from any angle, so it is placed FIRST and
     gets the ground it needs; everything after works round it. */
  const special = CLASS_SPECIAL[p.cls] || [];
  special.forEach((type, k) => {
    const spec = CATALOGUE[type];
    const a = (k / Math.max(1, special.length)) * Math.PI * 2 + (seed % 100) / 100;
    const rad = net.plaza.r + spec.footprint[1] / 2 + 1.6;
    const nx = Math.cos(a), nz = Math.sin(a);
    /* The kit builds its front on local -Z, which on the tangent plane is
       (sin yaw, cos yaw); to face the plaza it has to be MINUS the outward
       bearing, so yaw = atan2(-nx, -nz). Same line everywhere below. */
    /* RELOCATE, DO NOT DROP. A special had no retry at all: one `place()`, and
       a church that landed on a neighbour was simply gone. That was survivable
       while the plaza's rim was empty ground, and it is not now that a landmark
       sits inside the rim — the building count is DATA, so a special that
       cannot stand where its bearing puts it steps out along that same bearing
       to the next free ring instead of disappearing. */
    let ok = false;
    for (const push of LOT_PUSH) {
      if (place(type, nx * (rad + push), nz * (rad + push), Math.atan2(-nx, -nz),
                spec.footprint[0], spec.footprint[1], seed + 900 + k,
                /* `door` is the point on the LANE this building's path runs to.
                   A special's lane is the plaza rim itself. */
                { special: true, door: [nx * net.plaza.r, nz * net.plaza.r] })) {
        ok = true; break;
      }
    }
    if (!ok) dropped++;
  });

  /* TOWERS next: the dense middle of a city, and the only thing in a settlement
     that breaks the roofline — the silhouette that says "city" at a distance
     where you cannot count windows. They ring the plaza just outside the
     specials, so a city has its skyline at its centre and not at its edge. */
  for (let k = 0; k < (p.spec.towers || 0); k++) {
    const spec = CATALOGUE[7];
    const a = (k / Math.max(1, p.spec.towers)) * Math.PI * 2 + (seed % 100) / 100;
    const rad = net.plaza.r + spec.footprint[1] / 2 + 2.4 +
                radius * 0.20 * (((k * 37) % 100) / 100);
    const nx = Math.cos(a), nz = Math.sin(a);
    /* Same relocation ladder as the specials above, and for the same reason. */
    let ok = false;
    for (const push of LOT_PUSH) {
      if (place(7, nx * (rad + push), nz * (rad + push), Math.atan2(-nx, -nz),
                spec.footprint[0], spec.footprint[1], hash32(p.town.id + 'W' + k),
                { tower: true, door: [nx * net.plaza.r, nz * net.plaza.r] })) {
        ok = true; break;
      }
    }
    if (!ok) dropped++;
  }

  /* THE HOUSES, one per lot, working out from the middle. Both sides of every
     lane, nearest the square first, because a settlement grows outwards and a
     half-full one should have its gaps at the edge and not in its centre. */
  const slots = [];
  for (const L of net.lanes) {
    for (const st of laneStations(L.pts, 7.4)) {
      for (const side of [1, -1]) slots.push({ st, side, w: L.w });
    }
  }
  slots.sort((a, b) => (a.st.x * a.st.x + a.st.z * a.st.z) -
                       (b.st.x * b.st.x + b.st.z * b.st.z));

  const common = CLASS_COMMON[p.cls] || [0];
  let placed = 0;
  for (const slot of slots) {
    if (placed >= p.spec.houses) break;
    const type = common[(hash32(p.town.id + 'T' + placed) >>> 3) % common.length];
    const spec = CATALOGUE[type];
    /* The lane's own normal on the side this lot is on. The front then faces
       the carriageway, which is the brief's "fronts facing the lane". */
    const nx = -slot.st.tz * slot.side, nz = slot.st.tx * slot.side;
    const yaw = Math.atan2(-nx, -nz);
    const sd = hash32(p.town.id + 'S' + placed);
    let ok = false;
    for (const back of LOT_BACKOFF) {          // MOVE
      const w = spec.footprint[0], d = spec.footprint[1];
      const off = slot.w / 2 + LOT_SETBACK + d / 2 + back;
      if (place(type, slot.st.x + nx * off, slot.st.z + nz * off, yaw, w, d, sd,
                { door: [slot.st.x, slot.st.z] })) {
        ok = true; break;
      }
    }
    for (let i = 0; !ok && i < LOT_SHRINK.length; i++) {   // then SHRINK
      const k = LOT_SHRINK[i];
      const w = spec.footprint[0] * k, d = spec.footprint[1] * k;
      const off = slot.w / 2 + LOT_SETBACK + d / 2;
      if (place(type, slot.st.x + nx * off, slot.st.z + nz * off, yaw, w, d, sd,
                { door: [slot.st.x, slot.st.z] })) {
        ok = true;
      }
    }
    if (ok) placed++;                          // and otherwise it is DROPPED
  }
  dropped += p.spec.houses - placed;
  p.lots = out;
  p.dropped = dropped;
  p.buildings = out;
}

/* =============================================================================
   THE SETTLEMENTS — every building on the planet, as real buildings
   The first build drew a box and a pyramid per house, and from orbit 142 of
   those read as the checkered white stickers on the old globe-space.png. These
   are BuildingKit LOD2 boxes: each one wears a render of that style and
   palette's own front, with its sills, shutters and dirt on it, so a village at
   region zoom is a village and not a texture.
   ONE instanced() call per catalogue type, not one for the whole list, and that
   is deliberate: a single call groups internally and hands back a Group whose
   mesh order this file would then have to guess at. Called per type, the group
   has exactly one mesh and instance i IS list item i, which is what lets the
   sphere matrices be written over the kit's flat-world ones.
   ========================================================================== */
function buildSettlements() {
  const P = plan.placed;
  const grp = new THREE.Group();
  grp.name = 'settlements';

  const pads = [], fieldPads = [], parcels = [], laneGeos = [], plazaGeos = [];
  const byType = CATALOGUE.map(() => []);

  for (const p of P) {
    const seed = hash32(p.town.id);
    const fr = frameAt(p.axis, seed % 360);
    /* 0.86, not 0.78. Measured, not chosen: at 0.78 a village's 18 m of ground
       could not hold a plaza, a ring lane and twelve non-intersecting
       footprints, and 312 of the planet's 804 buildings were dropped. The cap
       is the flat apron above (deg * 1.05) divided by padGeometry's own 1.18. */
    const radius = p.deg * UNITS_PER_DEG * 0.86;      // metres of usable ground
    p.radius = radius;
    p.frame = fr;
    p.centre = p.axis.clone().multiplyScalar(R + p.elev);
    /* A FIELD'S GROUND IS SOIL, NOT COBBLE. Both are the same pad geometry;
       they go into two different merged meshes because they wear two different
       textures. Sent through the cobble mesh, a dormant project was a 40-unit
       disc of cobblestone in open country with one barn on it — a car park.
       Dropped entirely, the barn stood on nothing. */
    (p.cls === 'fields' ? fieldPads : pads).push(padGeometry(p, fr, radius));

    if (p.cls === 'fields') {
      /* A DORMANT PROJECT IS FARMLAND, and now it is farmland with furrows in
         the texture rather than nine grey boxes. The barn is the kit's own,
         which is what says somebody used to be here. */
      parcels.push(...fieldParcels(p, fr, radius, seed));
      /* A field's one barn is a lot too — w/d so it goes through the same
         instMatrix() and __overlaps() path as everything else. */
      p.buildings = [{ type: 8, ox: radius * 0.62, oz: radius * 0.58,
                       yaw: (seed % 90) * DEG, seed,
                       w: CATALOGUE[8].footprint[0], d: CATALOGUE[8].footprint[1] }];
      p.lots = p.buildings; p.lanes = []; p.plaza = null; p.dropped = 0;
    } else {
      planBuildings(p, seed, radius);
    }
    for (const b of p.buildings) { b.site = p; byType[b.type].push(b); }
    /* The hard ground, after the lots are known: the paths are drawn from each
       door to its own lane, so this cannot run before planBuildings(). */
    if (p.cls !== 'fields') {
      const surf = settlementSurfaces(p, fr);
      laneGeos.push(...surf.lanes, ...surf.paths);
      plazaGeos.push(...surf.plazas);
    }
  }

  /* --- the LOD2 instances, one draw per catalogue type ---------------------- */
  let nBuildings = 0;
  for (let t = 0; t < CATALOGUE.length; t++) {
    const list = byType[t];
    if (!list.length) continue;
    const spec = CATALOGUE[t];
    /* LOD **1**, not 2, and this is the whole "settlements are flat stickers"
       fix. LOD2 builds no roof mesh — it is a bare box wearing the baked FRONT
       of the building on all six faces — and a map is looked at from straight
       above, which is the one angle where the missing face is the only face you
       can see. The first pass with LOD2 came back as a town of facades lying
       face-up on the ground. LOD1 adds the roof solid: two instanced draws per
       catalogue type instead of one, twenty draw calls for the whole planet. */
    const g = kit.instanced(list.map(b => ({
      ...spec, position: [0, 0, 0], rotationY: 0, lod: 1, seed: b.seed,
    })));
    /* One call carried one style + palette + roof + lod, so the group is
       [body] at LOD2 and [body, roof] at LOD1, and instance i IS list item i. */
    const mesh = g.children[0];
    const roofMesh = g.children[1] || null;
    /* THE INSTANCES ARE SPREAD OVER A WHOLE PLANET and three frustum-culls an
       InstancedMesh against its GEOMETRY's bounding sphere — a unit box at the
       origin — not against where its instances actually are. Left on, every
       settlement mesh vanishes the moment the planet's centre leaves the frame,
       which is every frame below orbit. */
    mesh.frustumCulled = false;
    if (roofMesh) roofMesh.frustumCulled = false;
    const H = kitHeight(t);
    list.forEach((b, i) => {
      /* b.w / b.d, not spec.footprint: the lot planner SHRINKS a footprint
         rather than dropping the building when a lot is tight, so the
         catalogue's size is the wish and the lot's size is the fact. */
      mesh.setMatrixAt(i, instMatrix(b.site, b.site.frame, b.ox, b.oz, b.yaw,
                                     b.w, H, b.d));
      if (roofMesh) {
        roofMesh.setMatrixAt(i, instMatrix(b.site, b.site.frame, b.ox, b.oz, b.yaw,
                                           b.w + ROOF_EAVE, 1, b.d + ROOF_EAVE, H));
      }
      b.mesh = mesh; b.roofMesh = roofMesh; b.index = i; b.height = H;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (roofMesh) roofMesh.instanceMatrix.needsUpdate = true;
    grp.add(g);
    nBuildings += list.length;
  }

  /* --- the fields ---------------------------------------------------------- */
  let nParcels = 0;
  const fm = tex.farmland;
  if (fieldPads.length) {
    const gmesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(fieldPads, false),
      new THREE.MeshStandardMaterial({
        map: fm.diffuse, normalMap: fm.normal, roughnessMap: fm.arm,
        roughness: 1, metalness: 0, vertexColors: true,
      }));
    gmesh.name = 'field-ground';
    gmesh.receiveShadow = true;
    grp.add(gmesh);
  }
  if (parcels.length) {
    const fmesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parcels, false),
      new THREE.MeshStandardMaterial({
        map: fm.diffuse, normalMap: fm.normal, roughnessMap: fm.arm,
        roughness: 1, metalness: 0, vertexColors: true,
        /* The parcels lie ON the pad, a tenth of a unit above it, and at
           region distance a tenth of a unit is far below one depth step.
           polygonOffset is what stops them flickering against it. */
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }));
    fmesh.name = 'fields';
    fmesh.receiveShadow = true;
    grp.add(fmesh);
    nParcels = parcels.length;
  }

  /* --- the lanes, the paths and the plazas ---------------------------------
     Two more merged meshes for the whole planet: one gravel, one cobble. They
     are polygon-offset against the pad under them because the 2 cm of lift
     between the two is far below one depth step from a region view. */
  if (laneGeos.length) {
    const gr = tex.gravelRoad;
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(laneGeos, false),
      new THREE.MeshStandardMaterial({
        map: gr.diffuse, normalMap: gr.normal,   // no roughnessMap: see loadAssets()
        vertexColors: true, roughness: GRAVEL_ROUGH, metalness: 0,
        /* DOUBLE-SIDED, and it is not a shortcut. ribbon() takes its lateral
           offset from `fwd CROSS up`, so a polyline that runs the other way
           round produces the mirror winding — which for the inter-town roads is
           invisible because they all run the same way, and here meant every
           lane that happened to be drawn outward-in was culled. The first
           top-down capture of this pass had 1,081 lane ribbons in the scene
           graph and not one of them on screen. Ground ribbons are only ever
           seen from above, so not culling them costs nothing. */
        side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.name = 'settlement-lanes';
    m.receiveShadow = true;
    grp.add(m);
  }
  if (plazaGeos.length) {
    const cb = tex.cobble;
    const m = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(plazaGeos, false),
      new THREE.MeshStandardMaterial({
        map: cb.diffuse, normalMap: cb.normal, roughnessMap: cb.arm,
        vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    m.name = 'settlement-plazas';
    m.receiveShadow = true;
    grp.add(m);
  }

  /* --- the settlement ground ----------------------------------------------- */
  if (pads.length) {
    const merged = BufferGeometryUtils.mergeGeometries(pads, false);
    const padMesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
      map: tex.grass.diffuse, normalMap: tex.grass.normal, roughnessMap: tex.grass.arm,
      roughness: 1, vertexColors: true,
    }));
    padMesh.receiveShadow = true;
    padMesh.name = 'pads';
    grp.add(padMesh);
  }
  scene.add(grp);
  return { group: grp,
           counts: { lod1: nBuildings, parcels: nParcels,
                     /* Reported, not hidden — a lot the planner could not fit is
                        a house that is missing, which is the honest picture. */
                     dropped: P.reduce((a, p) => a + (p.dropped || 0), 0),
                     lots: P.reduce((a, p) => a + (p.lots ? p.lots.length : 0), 0),
                     lanes: P.reduce((a, p) => a + (p.lanes ? p.lanes.length : 0), 0),
                     laneRibbons: laneGeos.length, plazas: plazaGeos.length,
                     barns: P.filter(p => p.cls === 'fields').length } };
}

/** A catalogue entry's height in metres. The kit owns the floor heights, so
    this reads them out of its own table rather than keeping a second copy that
    would silently drift. */
function kitHeight(t) {
  const spec = CATALOGUE[t];
  const S = BuildingKit.styles[spec.style];
  return spec.floors * S.floorH;
}

/** A dormant project's fields: four parcels of ploughed ground, each a quad
    laid on the sphere and turned so the furrows in the texture run its own way.
    WHY quads and not the nine extruded strips this used to draw: a furrow is a
    12 cm ridge, and 12 cm of geometry on a 600-unit planet is invisible at
    every distance a field is looked at, so the old strips had to be 0.55 units
    tall to show at all — nine grey walls. The furrows belong in the TEXTURE,
    where they are the right size, and the parcel edges are what read from
    orbit. */
function fieldParcels(p, fr, radius, seed) {
  const out = [];
  const c = new THREE.Color();
  for (let k = 0; k < 4; k++) {
    const h = hash32(p.town.id + 'F' + k);
    const a = (k / 4) * Math.PI * 2 + (seed % 100) / 100;
    const cx = Math.cos(a) * radius * 0.50, cz = Math.sin(a) * radius * 0.50;
    /* Big enough to MEET each other. At 0.52/0.40 of the radius the four
       parcels were islands of tilled ground in a circle of bare pad. */
    const w = radius * (0.98 + ((h >>> 3) % 100) / 250);
    const d = radius * (0.86 + ((h >>> 9) % 100) / 250);
    /* Each parcel turned by its own angle: a farm is a patchwork of differently
       aligned strips, and four parcels all running the same way is a carpet. */
    const rot = ((h >>> 15) % 360) * DEG;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    /* Tone per parcel — stubble, turned earth, young green. setRGB is LINEAR:
       0.66 linear is 0.83 in sRGB, and lit at noon the first pass came out as
       white bars. These are worked ground. */
    const tone = [[0.42, 0.33, 0.20], [0.30, 0.24, 0.15],
                  [0.34, 0.36, 0.19], [0.46, 0.40, 0.24]][k];
    c.setRGB(tone[0], tone[1], tone[2]);
    const SEG = 6;
    const pos = [], nor = [], uv = [], col = [], idx = [];
    for (let j = 0; j <= SEG; j++) {
      for (let i = 0; i <= SEG; i++) {
        const lx = (i / SEG - 0.5) * w, lz = (j / SEG - 0.5) * d;
        const ox = cx + lx * cr - lz * sr, oz = cz + lx * sr + lz * cr;
        const dir = p.axis.clone()
          .addScaledVector(fr.east, ox / R).addScaledVector(fr.north, oz / R).normalize();
        const v = dir.clone().multiplyScalar(R + p.elev + 0.12);
        pos.push(v.x, v.y, v.z);
        nor.push(dir.x, dir.y, dir.z);
        /* One texture tile every ~6 m, so the furrows in farm_furrows read at
           their own real width from a street and still hold a pattern from a
           region view. */
        uv.push((lx / 6), (lz / 6));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a0 = j * (SEG + 1) + i, b0 = a0 + 1, c0 = a0 + SEG + 1, d0 = c0 + 1;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    out.push(g);
  }
  return out;
}

/** A settlement's ground disc, in world coordinates, ready to merge. */
/** A point on one settlement's ground, from its local (east, north) metres.
    Everything the lanes, the plaza and the paths are built from goes through
    here, so all four surfaces sit at the same height over the same terrain. */
function localPoint(p, fr, ox, oz, lift) {
  const dir = p.axis.clone()
    .addScaledVector(fr.east, ox / R).addScaledVector(fr.north, oz / R).normalize();
  return dir.multiplyScalar(R + Math.max(0.15, elevAt(dir)) + lift);
}

/* The order these four sit in, and the reason each is its own mesh: each wears
   a different photograph, and a merged mesh has one material. Bottom to top,
   with the lift each is drawn at:
     pad    +0.10  grass, the ground between the houses
     plaza  +0.40  cobble, the square
     lanes  +0.42  gravel, the carriageways
     paths  +0.46  gravel, narrow, from each door to its lane
   THE GAPS ARE 30 cm, not 2. At region distance a 24-bit depth buffer resolves
   about 7 cm at 330 units, so the first version's 2 cm lifts put the lanes
   INSIDE the pad's own z-fighting band and they were invisible from the air —
   1,081 ribbons in the scene graph and none of them on screen. 0.42 is what the
   inter-town roads already use, for the same reason. */
const LANE_LIFT = 0.42, PLAZA_LIFT = 0.40, PATH_LIFT = 0.46;

/** Every ribbon of hard ground in one settlement: the lanes, the paths to the
    doors, and the plaza. Returns three lists because they go into three meshes.

    THIS IS THE ANSWER TO "the ground at street level is bare white clay". The
    round-2 pad was one cobble disc tinted pale earth across the WHOLE
    settlement, so a village was a car park with houses on it. The ground
    between houses is grass now (padGeometry below), and the hard surfaces are
    only where a hard surface belongs — which is also what makes the lanes
    readable as lanes from the air. */
function settlementSurfaces(p, fr) {
  const lanes = [], paths = [], plazas = [];
  /* These MULTIPLY the gravel photograph, and from a region view that
     photograph is three hundred metres above its own last mip — so what reaches
     the screen is its MEAN — and that mean is DARK: gravel_road's diffuse
     averages (121, 88, 63) in sRGB, which is 0.19 linear. A near-white
     multiplier is what puts a gravel lane back at the tone gravel actually is;
     at 0x8f it read as a tarmac trench cut through the village. Kept in the
     same family as buildRoads()'s own colour, so a lane and the road it joins
     are the same surface at region zoom. */
  /* COOL-NEUTRAL, not warm. gravel_road's diffuse is (121, 88, 63) — a warm
     brown — so a warm multiplier on top of it comes out pink under a low sun,
     which is what the first village capture's lanes were. A slightly cool grey
     multiplier lands it back on gravel. */
  const cLane = new THREE.Color(0xc6cac6), cPath = new THREE.Color(0xb2b6b2);
  for (const L of (p.lanes || [])) {
    const pts = L.pts.map(q => localPoint(p, fr, q[0], q[1], LANE_LIFT));
    lanes.push(ribbon(pts, L.w, cLane, LANE_LIFT));
  }
  /* A PATH TO EVERY DOOR. Two metres from the wall to the carriageway, which is
     the one thing that says a house is lived in rather than parked. */
  for (const b of (p.lots || [])) {
    if (!b.door) continue;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);      // the front, local -Z
    const wall = [b.ox + fx * (b.d / 2 + 0.3), b.oz + fz * (b.d / 2 + 0.3)];
    const dx = b.door[0] - wall[0], dz = b.door[1] - wall[1];
    if (Math.hypot(dx, dz) < 0.6) continue;
    paths.push(ribbon([localPoint(p, fr, wall[0], wall[1], PATH_LIFT),
                       localPoint(p, fr, b.door[0], b.door[1], PATH_LIFT)],
                      1.5, cPath, PATH_LIFT));
  }
  /* THE PLAZA. A fan, not a ring disc: it is small enough that one ring of
     twenty-four segments is finer than the terrain under it. */
  if (p.plaza) {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    const c = new THREE.Color(0xc0c4c2);       // same reason as cLane above
    const add = (ox, oz) => {
      const v = localPoint(p, fr, ox, oz, PLAZA_LIFT);
      const d = v.clone().normalize();
      pos.push(v.x, v.y, v.z); nor.push(d.x, d.y, d.z);
      uv.push(ox / 3.2, oz / 3.2);         // 3.2 m of cobble per tile
      col.push(c.r, c.g, c.b);
    };
    const SEG = 24;
    add(0, 0);
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rr = p.plaza.r * (0.95 + 0.08 * Math.sin(a * 4));
      add(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    for (let i = 0; i < SEG; i++) idx.push(0, 1 + i, 1 + (i + 1) % SEG);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    plazas.push(g);
  }
  return { lanes, paths, plazas };
}

function padGeometry(p, fr, radius) {
  /* 1.18, because the outermost ring lane sits at 0.94 of the radius and its
     outer lots are a setback and half a footprint beyond that. A pad that
     stopped at `radius` left the last row of houses standing on open grass with
     a visible edge of packed earth behind them. */
  /* 5 x 30, not 3 x 22: the vertex colour below is now carrying the macro
     variation of the village green, and at three rings that variation is three
     bands. */
  const RINGS = 5, SEG = 30;
  radius *= 1.18;
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const c = new THREE.Color();
  const push = (ox, oz, ring) => {
    const dir = p.axis.clone().addScaledVector(fr.east, ox / R).addScaledVector(fr.north, oz / R).normalize();
    const v = dir.clone().multiplyScalar(R + p.elev + 0.10);
    pos.push(v.x, v.y, v.z); nor.push(dir.x, dir.y, dir.z);
    /* METRES, not 0..1 across the pad. The 0..1 was written for a tinted
       cobble disc where one stretched tile did not show; on the grass
       photograph it is one 40-metre blade of grass per village. 2.4 m per tile
       is the ground shader's own detail scale, so the pad and the country round
       it are the same grass at the same size. */
    uv.push(ox / 2.4, oz / 2.4);
    /* Fades out at the rim so the pad does not end on a hard circle — a town
       does not have a fence round it, it thins into the fields. */
    const t = ring / RINGS;
    const g = 0.72 + 0.28 * (1 - t);
    /* MACRO VARIATION, two octaves, at 30 m and at 9 m of arc — the same two
       sizes the ground shader's own detail/macro pair works at, so the village
       green and the country round it read as one surface with one weather on
       it. `R / F` is the feature size in units, so F = R/30 and F = R/9. */
    const F1 = R / 30, F2 = R / 9;
    const macro = 0.80 + 0.30 * fbm3(dir.x * F1, dir.y * F1, dir.z * F1, 2)
                       + 0.14 * (fbm3(dir.x * F2, dir.y * F2, dir.z * F2, 2) - 0.5);
    /* Packed earth, and it has to be LIGHTER than the country round it or the
       settlement reads as a hole in the ground. The first continent capture had
       a town as a black crater with dark tiles in it; a village is a pale patch
       with dark roofs on it, which is what it looks like from a plane. */
    /* setRGB is LINEAR, so 0.86 — the first value here — is 0.94 in sRGB, and
       at noon every pad read as white paper. A SETTLEMENT's ground is packed
       earth, pale enough to separate it from the country round it; a FIELD's is
       soil, and it has to be DARKER than the furrows standing on it or the
       ploughing inverts. From orbit the bright version scattered the 70 fields
       across the continents as white rectangles, like paper dropped on a map. */
    /* GRASS, not packed earth. Round 2 tinted a cobble disc pale earth across
       the whole settlement, and the street capture came back with every house
       standing on bare white clay — the single loudest thing wrong with it. The
       pad wears the grass photograph now and the hard surfaces are the lanes,
       the plaza and the paths; this vertex colour only gives the green its
       spread. A FIELD's ground is still soil, and still darker than the furrows
       standing on it or the ploughing inverts. */
    /* 0.20/0.24/0.11 is BIOME.grass (0x5d6f3f -> linear 0.106/0.157/0.052)
       lifted about half a stop, because a village green is worn grass and not
       meadow. It has to be READ AGAINST the country, not against white: at the
       0.62/0.68/0.44 this was first written with, the pad came out five times
       brighter than the terrain it sits in and every settlement was a pale
       yellow blob from a region view — the same failure as round 2's cobble,
       in a different colour. */
    const base = p.cls === 'fields' ? [0.20, 0.15, 0.09] : [0.20, 0.24, 0.11];
    const k = p.cls === 'fields' ? g : g * macro;
    c.setRGB(base[0] * k, base[1] * k, base[2] * k);
    col.push(c.r, c.g, c.b);
  };
  push(0, 0, 0);
  for (let r = 1; r <= RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const rr = radius * (r / RINGS) * (0.94 + 0.10 * Math.sin(a * 3 + r));
      push(Math.cos(a) * rr, Math.sin(a) * rr, r);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + s, 1 + (s + 1) % SEG);
  for (let r = 0; r < RINGS - 1; r++) {
    const a0 = 1 + r * SEG, b0 = a0 + SEG;
    for (let s = 0; s < SEG; s++) {
      const s2 = (s + 1) % SEG;
      idx.push(a0 + s, b0 + s, a0 + s2, a0 + s2, b0 + s, b0 + s2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function wallMaterial(t, tint) {
  return new THREE.MeshStandardMaterial({
    map: t.diffuse, normalMap: t.normal, roughnessMap: t.arm,
    color: tint, roughness: 1, metalness: 0,
  });
}

/** A wall material whose windows come on at dusk. Same idea as world.js's
    litMaterials: one uniform, driven from the sun's elevation, injected with
    onBeforeCompile rather than swapping materials at nightfall. */
function litMaterial(t, tint) {
  const m = wallMaterial(t, tint);
  const uNight = { value: 0 };
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        /* Window rows: a stripe function on the local height, so a tower is lit
           floor by floor and not as a glowing block. */
        float rows = step(0.55, fract(vViewPosition.y * 0.0 + gl_FragCoord.y * 0.0));
        vec2 wUv = vMapUv * vec2(9.0, 22.0);
        float win = step(0.55, fract(wUv.x)) * step(0.62, fract(wUv.y));
        totalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * win * uNight * 1.9;`);
  };
  m.customProgramCacheKey = () => 'globe-lit';
  m.userData.uNight = uNight;
  litMaterials.push(m);
  return m;
}


/* =============================================================================
   THE ROADS — great-circle arcs, on the ground
   /api/world gives 859 of them. As 859 meshes that is 859 draw calls; as one
   merged ribbon it is one. The live half is a SECOND merged ribbon, rebuilt
   only when the live set changes (once a minute at most), because a shader
   uniform cannot address "either end of this particular arc".
   ========================================================================== */
let roadMesh = null, roadLiveMesh = null, laneMesh = null, laneLiveMesh = null;

/** How many samples a road on the GROUND needs: one every six units, which is
    the terrain's own quad size. The first build used one every half degree —
    five units of arc per sample on a long road and forty on a short one — so
    short roads spanned hills they never touched and read as yellow slabs
    floating over the country. A road follows the ground or it is not a road. */
/* Every THREE units, not every six. Six is the terrain's own quad size, so a
   road sampled at exactly that spacing lands on the mesh's chords rather than
   on its vertices and rides a fraction under the surface between them. Half a
   quad costs 21 k more triangles across the planet and is the difference
   between a road and a dashed line. */
const groundSteps = deg => clamp(Math.round(deg * UNITS_PER_DEG / 3), 12, 420);

/** Points along the great circle from a to b, laid on the ground. */
function arcPoints(a, b, steps, lift) {
  const out = [];
  const va = a.axis, vb = b.axis;
  const om = Math.acos(clamp(va.dot(vb), -1, 1));
  const so = Math.sin(om);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let d;
    if (so < 1e-5) d = va.clone();
    else d = va.clone().multiplyScalar(Math.sin((1 - t) * om) / so)
                .addScaledVector(vb, Math.sin(t * om) / so).normalize();
    if (lift === null) {
      /* A SHIPPING LANE arcs over the sea: it is not a road, and drawing it flat
         on the water would say there is a causeway between two continents. */
      /* 22, not 46. At 46 units the arcs stood a tenth of the planet's radius
         off the surface and read as a halo of wire round the limb rather than
         as routes across an ocean. */
      const h = Math.sin(t * Math.PI) * Math.min(22, om / DEG * 0.8) + 2;
      out.push(d.multiplyScalar(R + Math.max(0.6, elevAt(d)) + h));
    } else {
      out.push(d.multiplyScalar(R + Math.max(0.4, elevAt(d)) + lift));
    }
  }
  return out;
}

/** A polyline turned into a flat ribbon lying on the sphere.

    `lift` is the height the ribbon's EDGES are re-projected to above the ground,
    and passing it is what makes a road lie on the country instead of cutting
    through it. Without it the two edge vertices were the centreline plus and
    minus a lateral offset at the CENTRELINE's height — so on a slope a 5-unit
    wide road had one edge up to five units under the hill. Measured across the
    whole road mesh: mean gap 0.28 as intended, worst -5.02, and what that looks
    like is a road that appears in bright fragments on the ridges and vanishes
    everywhere else. Pass null for anything that is deliberately off the ground
    (the shipping-lane arcs). */
function ribbon(points, width, color, lift = null) {
  const pos = [], nor = [], col = [], uv = [], idx = [];
  const up = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();
  let run = 0;                       // metres travelled, for the road's own UV
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) run += p.distanceTo(points[i - 1]);
    /* v runs ALONG the road at one gravel tile every two metres, u across it.
       Without a UV the ribbon could only ever be flat vertex colour — which is
       what made every road on the first build a painted stripe. */
    uv.push(0, run * 0.5, 1, run * 0.5);
    up.copy(p).normalize();
    const q = points[Math.min(points.length - 1, i + 1)];
    const r = points[Math.max(0, i - 1)];
    fwd.copy(q).sub(r); if (fwd.lengthSq() < 1e-9) fwd.set(1, 0, 0);
    side.crossVectors(fwd, up).normalize().multiplyScalar(width / 2);
    const a = new THREE.Vector3(p.x - side.x, p.y - side.y, p.z - side.z);
    const b = new THREE.Vector3(p.x + side.x, p.y + side.y, p.z + side.z);
    if (lift !== null) {
      for (const v of [a, b]) {
        const d = v.clone().normalize();
        v.copy(d).multiplyScalar(R + Math.max(0.4, elevAt(d)) + lift);
      }
    }
    pos.push(a.x, a.y, a.z);
    pos.push(b.x, b.y, b.z);
    nor.push(up.x, up.y, up.z, up.x, up.y, up.z);
    col.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** What a gravel surface's roughness is, since its ARM map cannot supply one.
    0.94 rather than 1.0: wet-looking gravel is a road nobody has driven on. */
const GRAVEL_ROUGH = 0.94;

function buildRoads() {
  const land = [], lanes = [];
  /* Near white: this colour now MULTIPLIES the gravel map, and the old
     0x4a4235 under a texture is a black stripe. The road's tone comes from the
     photograph; the vertex colour only warms it. */
  /* 0xd6cec2, not the 0x8b8274 this was written with. That number was chosen
     while gravel_road's ARM map still had the roads at roughness 0 — a mirror
     showing the sky reads bright whatever multiplies it. With a real roughness
     on them, 0x8b over a 0.19-linear photograph is a black stripe. */
  const cDim = new THREE.Color(0xc4c8c4), cLane = new THREE.Color(0x6b7f8c);
  for (const r of plan.roads) {
    const deg = angDist(r.a.axis, r.b.axis);
    if (deg < 0.05) continue;
    const w = clamp(0.9 + Math.log10(1 + r.weight) * 2.4, 1.0, 5.0);
    if (r.sea) {
      /* A CROSS-DOMAIN link only counts as a shipping lane when it is more than
         one shared file. 640 of the 859 roads have weight 1, and drawn as arcs
         over the ocean they came to 43,874 dash pieces and a sky full of
         string — measured on the first build. Weight 3 leaves 93. */
      if (r.weight < 4) continue;
      /* DOTTED. A dash is drawn as separate ribbon pieces because a dashed LINE
         has no width on a sphere at this scale — it disappears the moment the
         camera is more than a few hundred units out. */
      const pts = arcPoints(r.a, r.b, 20, null);
      for (let i = 0; i + 1 < pts.length; i += 2) {
        lanes.push(ribbon([pts[i], pts[i + 1]], w * 0.7, cLane));
      }
    } else {
      land.push(ribbon(arcPoints(r.a, r.b, groundSteps(deg), 0.42), w, cDim, 0.42));
    }
    r.deg = deg;
  }
  /* THE ROAD SURFACE IS GRAVEL, not a colour. The ribbon now carries a UV that
     runs along it at two metres a tile, so this is the same road material a
     village street would have — which is the point: from a region view it is a
     pale line, and from a street you can see what it is made of. */
  const gr = tex.gravelRoad;
  const matOpts = { map: gr.diffuse, normalMap: gr.normal,
                    /* NO roughnessMap — see loadAssets(). */
                    vertexColors: true, roughness: GRAVEL_ROUGH, metalness: 0,
                    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
  if (land.length) {
    roadMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(land, false),
                              new THREE.MeshStandardMaterial(matOpts));
    roadMesh.name = 'roads'; roadMesh.receiveShadow = true;
    scene.add(roadMesh);
  }
  if (lanes.length) {
    laneMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(lanes, false),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.30,
                                    depthWrite: false }));
    laneMesh.name = 'lanes';
    scene.add(laneMesh);
  }
  rebuildLiveRoads();
  return { land: land.length, lanes: lanes.length };
}

/** The roads with a live town at either end, drawn again in gold on top. Only
    these are rebuilt when the live set changes — the other 850 never move. */
function rebuildLiveRoads() {
  for (const m of [roadLiveMesh, laneLiveMesh]) {
    if (m) { scene.remove(m); m.geometry.dispose(); }
  }
  roadLiveMesh = laneLiveMesh = null;
  /* TWO meshes, land and sea, and the split is not cosmetic: a live sea arc
     stands 22 units off the water, so from a street it crosses the sky as a
     dead-straight cream line. The sea half is a MAP feature and is hidden below
     140 units with the dim lanes; the land half is a road you can stand on and
     is drawn at every altitude. One merged mesh could not do both. */
  const parts = [], seaParts = [];
  const gold = new THREE.Color(0xd2a62c);
  for (const r of plan.roads) {
    if (!r.a.town.is_live && !r.b.town.is_live) continue;
    /* The SAME weight cut the dim lanes get. Without it the capital — which is
       live nearly always and has a road to almost everything — drew five hundred
       gold arcs over the ocean, and the planet wore them as a halo of wire.
       A live road still has to be a road somebody actually walks. */
    if (r.sea && r.weight < 4) continue;
    const deg = r.deg || angDist(r.a.axis, r.b.axis);
    if (deg < 0.05) continue;
    const w = clamp(1.0 + Math.log10(1 + r.weight) * 1.8, 1.2, 3.8);
    (r.sea ? seaParts : parts).push(
      ribbon(arcPoints(r.a, r.b, r.sea ? 20 : groundSteps(deg),
                       r.sea ? null : 0.62), w, gold, r.sea ? null : 0.62));
  }
  const mat = () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
                                                  opacity: 0.46, depthWrite: false });
  if (parts.length) {
    roadLiveMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(parts, false), mat());
    roadLiveMesh.name = 'roads-live';
    scene.add(roadLiveMesh);
  }
  if (seaParts.length) {
    laneLiveMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries(seaParts, false), mat());
    laneLiveMesh.name = 'lanes-live';
    scene.add(laneLiveMesh);
  }
}






/* =============================================================================
   STREET LEVEL — the settlement the camera is standing in, grown for real

   From orbit every building on the planet is a BuildingKit LOD1 box wearing a
   render of its own front. That is right at 400 units and wrong at 20, so when
   the camera comes down over a settlement THAT settlement — and only that one —
   is rebuilt from the same plan at the kit's real geometry: LOD0 inside 60 m,
   LOD1 out to 250 m, exactly the bands kit.lodFor() defines, and the map
   instance of every building that got rebuilt is scaled to zero so nothing is
   drawn twice.

   WHY only one settlement: LOD0 is ~8.7 k triangles and 9 draw calls per
   building (measured in docs/BUILDINGS.md). Forty of them is 360 draw calls
   before the planet has drawn a single triangle of ground, and there are 142
   settlements.

   WHY it is not rebuilt every frame: it costs 40-90 ms. It is rebuilt when the
   camera changes settlement, or moves more than 30 units from where the last
   build was made — a coarse hysteresis, which is what BUILDINGS.md's
   integration note asks for.
   ========================================================================== */
let nearGroup = null;              // the detail scene for one settlement
let nearPlace = null;              // which settlement it is
let nearAt = new THREE.Vector3();  // where the camera was when it was built
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

/** Put back every map instance the detail group had hidden, and throw the
    detail group away. */
function clearNearTown() {
  if (!nearGroup) return;
  for (const b of (nearPlace ? nearPlace.buildings : [])) {
    if (!b.hidden) continue;
    b.mesh.setMatrixAt(b.index, b.mapMatrix);
    b.mesh.instanceMatrix.needsUpdate = true;
    if (b.roofMesh) {
      b.roofMesh.setMatrixAt(b.index, b.mapRoofMatrix);
      b.roofMesh.instanceMatrix.needsUpdate = true;
    }
    b.hidden = false;
  }
  scene.remove(nearGroup);
  /* The kit's materials and instance geometries are SHARED and cached inside
     it, so only what this file made is disposed: the LOD0 groups are made per
     call and their geometries are this group's own. disposeTree would also free
     the kit's baked facade textures, which every distant building wears. */
  nearGroup.traverse(o => {
    if (o.isMesh && o.geometry && o.userData.ownGeometry) o.geometry.dispose();
  });
  nearGroup = null;
  nearPlace = null;
}

/** The settlement the camera is over, or null. */
function settlementUnderCamera() {
  const u = ll(cam.lat, cam.lon);
  let best = null, bd = 1e9;
  for (const p of plan.placed) {
    const d = angDist(u, p.axis);
    if (d > p.deg * 2.6) continue;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** Rebuild the near settlement if the camera has moved enough to need it. */
function updateNearTown() {
  const alt = cam.dist - R;
  /* 260 units is where the tilt curve has the camera looking straight down and
     a town is 40 px across; below it the camera is coming in to land. */
  const want = alt < 260 ? settlementUnderCamera() : null;
  if (!want) { if (nearGroup) clearNearTown(); return; }
  if (nearGroup && want === nearPlace && camera.position.distanceTo(nearAt) < 30) return;
  clearNearTown();
  buildNearTown(want);
}

function buildNearTown(p) {
  nearPlace = p;
  nearAt.copy(camera.position);
  const grp = new THREE.Group();
  grp.name = 'near:' + p.town.id;

  /* --- the buildings, at the LOD their distance earns ---------------------- */
  const lod1 = [];
  const at = new THREE.Vector3();

  /* THE LOD0 BUDGET IS A COUNT, not a distance, and that is the whole trade.
     The kit's own bands were measured for a street of twelve; a village here
     puts forty buildings inside 60 m and a LOD0 building is 9 draw calls and
     8.7 k triangles, so the band alone decides nothing useful. Widening the
     band was tried first (x1.7 into lodFor) and rejected by LOOKING: it put the
     whole village outside LOD0 at the street capture's own camera height and
     the shot came back as a village of boxes, which is the exact thing this
     pass exists to fix. Measured at the street pose, everything-in-band 26 fps
     against the nearest fourteen — and the fifteenth building is forty metres
     away wearing a render of its own front. */
  const LOD0_BUDGET = 14;
  /* A PRINTED LOT IS ALREADY STANDING. It joined `p.buildings` so the overlap
     audit, the walkers' doors and the next print all see it, but it has no map
     instance behind it — `b.mesh` is undefined — and its own kit group is in
     `printGroup`. Rebuilding it here would draw the building twice and throw on
     the `b.mesh.getMatrixAt()` below, which is what a page with thirty seeded
     buildings on it found the first time the camera came down over one. */
  const ranked = p.buildings.filter(b => !b.printed).map(b => {
    const M = placeMatrix(p, p.frame, b.ox, b.oz, b.yaw);
    at.setFromMatrixPosition(M);
    return { b, M, d: camera.position.distanceTo(at) };
  }).sort((x, y) => x.d - y.d);

  for (let rank = 0; rank < ranked.length; rank++) {
    const b = ranked[rank].b, M = ranked[rank].M, dist = ranked[rank].d;
    const spec = CATALOGUE[b.type];
    const natural = kit.lodFor(dist);
    const lod = rank < LOD0_BUDGET ? natural : Math.max(1, natural);
    if (lod === 2) continue;                       // the map instance is right
    if (lod === 0) {
      const g = kit.make({ ...spec, footprint: [b.w, b.d], lod: 0, seed: b.seed });
      g.matrixAutoUpdate = false;
      g.matrix.copy(M);
      /* Made here, disposed here — see clearNearTown(). */
      g.traverse(o => { if (o.isMesh) o.userData.ownGeometry = true; });
      grp.add(g);
    } else {
      lod1.push({ b, spec, M });
    }
    /* Hide the map instance, both halves of it. The matrices are remembered so
       clearNearTown() can put them back — recomputing them would be a second
       copy of the placement rule, which is how the map and the street quietly
       stop being the same place. */
    if (!b.hidden) {
      b.mapMatrix = new THREE.Matrix4();
      b.mesh.getMatrixAt(b.index, b.mapMatrix);
      b.mesh.setMatrixAt(b.index, ZERO_M);
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.roofMesh) {
        b.mapRoofMatrix = new THREE.Matrix4();
        b.roofMesh.getMatrixAt(b.index, b.mapRoofMatrix);
        b.roofMesh.setMatrixAt(b.index, ZERO_M);
        b.roofMesh.instanceMatrix.needsUpdate = true;
      }
      b.hidden = true;
    }
  }
  /* The middle band, instanced per catalogue type so it stays in draw calls
     rather than in buildings. */
  const byType = new Map();
  for (const it of lod1) {
    if (!byType.has(it.b.type)) byType.set(it.b.type, []);
    byType.get(it.b.type).push(it);
  }
  for (const [type, list] of byType) {
    const spec = CATALOGUE[type];
    const g = kit.instanced(list.map(it => ({
      ...spec, position: [0, 0, 0], rotationY: 0, lod: 1, seed: it.b.seed })));
    const body = g.children[0], roof = g.children[1] || null;
    body.frustumCulled = false;
    if (roof) roof.frustumCulled = false;
    const H = kitHeight(type);
    list.forEach((it, i) => {
      body.setMatrixAt(i, instMatrix(p, p.frame, it.b.ox, it.b.oz, it.b.yaw,
                                     it.b.w, H, it.b.d));
      if (roof) {
        roof.setMatrixAt(i, instMatrix(p, p.frame, it.b.ox, it.b.oz, it.b.yaw,
                                       it.b.w + ROOF_EAVE, 1, it.b.d + ROOF_EAVE, H));
      }
    });
    body.instanceMatrix.needsUpdate = true;
    if (roof) roof.instanceMatrix.needsUpdate = true;
    grp.add(g);
  }

  grp.add(...streetProps(p));
  scene.add(grp);
  nearGroup = grp;
}

/* --- the props ------------------------------------------------------------ */

/** One scanned model, cloned, scaled to a real height and stood on the ground.
    The pack's models come in at whatever metre scale they were scanned at, so
    every one of them is normalised by its own bounding box rather than by a
    magic number per model. */
function placeProp(key, targetH, site, ox, oz, yaw) {
  const src = props[key];
  if (!src) return null;
  const o = src.clone(true);
  const box = new THREE.Box3().setFromObject(o);
  const size = new THREE.Vector3();
  box.getSize(size);
  const s = targetH / Math.max(0.001, size.y);
  /* Stand it ON the ground: a scanned model's origin is wherever the scanner
     put it, which for half this pack is the middle of the object. */
  o.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s,
                 -((box.min.z + box.max.z) / 2) * s);
  o.scale.setScalar(s);
  o.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  const holder = new THREE.Group();
  holder.add(o);
  holder.matrixAutoUpdate = false;
  holder.matrix.copy(placeMatrix(site, site.frame, ox, oz, yaw));
  return holder;
}

/** What stands in a settlement that is not a building. This is the difference
    between a model village and a place: the light the street is lit by, the
    bench on the square, the crates outside the shop, the fence round the field,
    the boat at the quay. */
function streetProps(p) {
  const out = [];
  const rad = p.radius;
  const push = (...a) => { const o = placeProp(...a); if (o) out.push(o); };

  /* LAMP POSTS down the main street. The street is the line through the middle
     of the settlement that the buildings' own ring pattern leaves open. */
  const nLamp = p.cls === 'city' ? 12 : p.cls === 'town' ? 8 : p.cls === 'fields' ? 0 : 5;
  for (let i = 0; i < nLamp; i++) {
    const t = (i / Math.max(1, nLamp - 1)) * 2 - 1;
    push('lamppost', 4.6, p, t * rad * 0.86, (i & 1 ? 3.4 : -3.4), (i & 1) * Math.PI);
  }
  /* BENCHES on the square, facing the middle. */
  if (p.cls !== 'fields' && p.cls !== 'hamlet') {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4;
      push('bench', 0.95, p, Math.cos(a) * rad * 0.16, Math.sin(a) * rad * 0.16, a + Math.PI);
    }
  }
  /* BARRELS AND CRATES by the shops. The catalogue's shop is type 4, so this
     reads the settlement's own plan rather than guessing where a shop is. */
  for (const b of p.buildings) {
    if (b.type !== 4) continue;
    const h = hash32(p.town.id + 'P' + b.seed);
    push('barrel', 0.95, p, b.ox + 3.4, b.oz - 2.2, (h % 360) * DEG);
    push('crate', 0.7, p, b.ox + 4.3, b.oz - 3.1, ((h >>> 9) % 360) * DEG);
    push('crate', 0.7, p, b.ox + 3.0, b.oz - 3.6, ((h >>> 18) % 360) * DEG);
  }
  /* FENCES round the fields — the class whose whole content is a field. */
  if (p.cls === 'fields') {
    /* Eight fence modules, not sixteen. One chainlink module is 89 k
       triangles (docs/BUILDINGS.md's __budget()), so sixteen of them is 1.4 M
       around one dormant field. */
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      push('fence', 1.7, p, Math.cos(a) * rad * 0.82, Math.sin(a) * rad * 0.82, a);
    }
    push('cart', 1.3, p, rad * 0.36, rad * 0.30, 0.7);
  }
  /* BOATS at a coastal settlement, moored just off the pad. `offshore` is set
     by planPlanet() from the raw land under the town, so this is the same fact
     the map is drawn from and not a second guess about where the sea is. */
  const coastal = p.offshore || p.elev < 5.5;
  if (coastal && p.cls !== 'fields') {
    for (let i = 0; i < 2; i++) {
      const a = ((hash32(p.town.id + 'B' + i) % 360)) * DEG;
      push('boatReal', 8.5, p, Math.cos(a) * rad * 1.30, Math.sin(a) * rad * 1.30, a + 1.2);
    }
  }
  /* ROCKS AND BUSHES at the edge, where the pad stops being a pad. Nine, not
     fourteen: these are SCANNED models at full density and the near group came
     to 888 k triangles, which the shadow pass then draws again. */
  for (let i = 0; i < 9; i++) {
    const h = hash32(p.town.id + 'E' + i);
    const a = ((h % 3600) / 3600) * Math.PI * 2;
    const r = rad * (0.92 + ((h >>> 8) % 100) / 300);
    const kind = (h >>> 3) & 3;
    /* The bush is the Hunyuan one now. Same slot, same rule, same height — it
       stands exactly where the edge ring already put low vegetation, and the
       only thing that changed is that a dense shrub replaced a wispy rooibos
       whose 15 meshes cost three draw calls to the new one's one. */
    push(kind === 0 ? 'rockA' : kind === 1 ? 'rockB' : 'hy.bush',
         kind === 1 ? 2.2 : kind === 0 ? 1.3 : 1.1,
         p, Math.cos(a) * r, Math.sin(a) * r, ((h >>> 16) % 360) * DEG);
  }
  /* REAL TREES, not impostors, in the near ring. buildForests() draws the same
     wood as crossed cards; inside 60 m a card is a card, and this is the one
     place the scanned model earns its triangles. */
  for (let i = 0; i < 5; i++) {
    const h = hash32(p.town.id + 'N' + i);
    const a = ((h % 3600) / 3600) * Math.PI * 2;
    const r = rad * (1.06 + ((h >>> 9) % 100) / 220);
    const dir = p.axis.clone()
      .addScaledVector(p.frame.east, Math.cos(a) * r / R)
      .addScaledVector(p.frame.north, Math.sin(a) * r / R).normalize();
    if (forestMask(dir) < 0.4) continue;
    /* ONLY IN THE HOT DRY BAND. `treeReal` is the pack's quiver tree, and five
       of them on the edge of every village on the planet is what put a palm
       grove on an Alpine street in globe-street.png. Everywhere else the
       forest's own broadleaf and conifer instances already stand here. */
    const sp = speciesAt(dir, p.elev,
                         p.axis.y >= -1 ? Math.asin(clamp(p.axis.y, -1, 1)) / DEG : 0);
    /* THE SAME RULE, ONE SPECIES WIDER. Species 2 is the hot dry band and gets
       the quiver tree it always got; species 1 is the alpine/polar band and now
       gets `model.hy.tree_conifer` — a real spruce where the forest is a
       spruce wood, which is the whole point of the near ring. Species 0 stays
       on the cards: the pack has no broadleaf worth standing here (the Hunyuan
       one is a sparse sapling), and a wrong scan at ten metres is worse than a
       card at ten metres.
       THE HEIGHT IS THE SPECIES' OWN. TREE_SPECIES[1].h is 6.6 m and these
       stand among four thousand cards of exactly that height, so a scan any
       taller would read as a different tree rather than as the same tree seen
       properly. (The brief's "18-25 m" is a real spruce; this world's trees are
       sized against its own 2.7 m storeys and its 14 m landmarks, and no 1:7.6
       scale appears anywhere in its docs — see DECISIONS 2026-09-07.) */
    if (sp === 2) {
      push('treeReal', 7.4, p, Math.cos(a) * r, Math.sin(a) * r, ((h >>> 17) % 360) * DEG);
    } else if (sp === 1) {
      push('hy.tree_conifer', TREE_SPECIES[1].h * (0.86 + ((h >>> 21) % 100) / 320),
           p, Math.cos(a) * r, Math.sin(a) * r, ((h >>> 17) % 360) * DEG);
    }
  }
  return out;
}


/* =============================================================================
   THE FORESTS — the real tree, photographed once, stood up 4,000 times

   The bar asks for trees at LOD0 near the camera and impostors beyond, and the
   impostor here is not a hand-drawn billboard: it is a render of
   `model.treeReal` itself, taken at load into a 256x512 target under flat
   light, so the shape, the colour and the silhouette on the horizon are the
   SAME tree the street shows. Two crossed quads per instance, alpha-tested, in
   ONE InstancedMesh for the whole planet.

   WHY not the model itself everywhere: the pack's props are scanned meshes and
   the tree is tens of thousands of triangles (docs/BUILDINGS.md's __budget()
   measured one fence module at 89 k). Four thousand of those is the entire
   frame budget for something that is eight pixels tall.
   ========================================================================== */
const forestMeshes = [], trunkMeshes = [], treeCounts = [];
const impostorMeshes = [];
let trunksOn = false;
/* Which forest tier is being drawn: null before the first decision, true for
   the near crossed planes, false for the impostor atlases. */
let nearForest = null;

/** Render one prop head-on into a transparent target and hand back the texture.
    The same idea as the kit's own facade bake, for a different subject. */
function bakeImpostor(model, w = 256, h = 512) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: true,
  });
  const sc = new THREE.Scene();
  const obj = model.clone(true);
  sc.add(obj);
  /* Flat, bright, from two sides: a billboard that is lit is lit from ONE
     direction forever, and the moment the sun moves the wood is lit from the
     left and its own picture from the right. */
  /* 1.15 / 0.85, not 2.1 / 1.5. The bake is a texture that the SCENE then
     lights again, so an over-exposed photograph comes out of the second lighting
     pass as a white ghost — twelve thousand pale palms on a green hill. */
  sc.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(1, 1.4, 1.2);
  sc.add(key);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(), mid = new THREE.Vector3();
  box.getSize(size); box.getCenter(mid);
  const halfH = Math.max(0.001, size.y / 2) * 1.04;
  const halfW = halfH * (w / h);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, size.length() * 8);
  cam.position.set(mid.x, mid.y, mid.z + size.length() * 2);
  cam.lookAt(mid);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearAlpha(0);
  renderer.clear();
  renderer.render(sc, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  disposeTree(sc);
  return { texture: rt.texture, height: size.y, width: size.y * (w / h) };
}

/* =============================================================================
   THE IMPOSTOR ATLAS — eight photographs of one tree  <!-- GLOBE-IMPOSTOR-DOC -->

   THE PROBLEM, read straight off `docs/shots/globe-continent.png`: from 300 to
   900 units a wood is a scatter of dark green flecks. It is not a wood; it is
   confetti. And the reason is geometric, not a texture problem — a tree there is
   three crossed cards, each of which is a FLAT quad, so at any camera bearing
   two of the three are near enough edge-on to contribute a line and the third
   contributes a rectangle. Twelve thousand of those on a hillside average out to
   noise, because there is no view at which a card is a canopy.

   THE ANSWER, and it is the classic one: photograph the tree from eight bearings
   at load, put the eight frames in ONE atlas, and draw a single billboard that
   picks the frame nearest the bearing the camera is actually at. The silhouette
   is then the real tree's silhouette at every angle instead of at one, the
   canopy is a mass rather than a cross, and a stand of them reads as a canopy.

   THREE THINGS THAT ARE NOT FREE AND ARE WORTH THE PRICE:

   - **The photographs are of THIS species' own built geometry**, trunk
     included, lit with the same flat two-light rig `bakeImpostor()` uses for
     the quiver tree — so the impostor is the same tree the street shows, not a
     drawing of one. The quiver tree gets an atlas too: its near tier is still
     the pack's own `treeReal` bake on crossed quads, exactly as before.
   - **The billboard turns about the tree's own UP**, never fully towards the
     lens. A sphere is looked at from every direction at once and a fully
     camera-facing quad lies down at the horizon — the same failure the flat
     card in `canopyGeometry()` was added to answer.
   - **N·L, once, per vertex band.** A baked photograph is lit from where it was
     baked, forever. The shader gives the card a CYLINDRICAL normal — leaning
     out to the left at u=0 and to the right at u=1 — so the sun lights one side
     of every crown and shades the other, which is the whole difference between
     a wood and a stencil. Wrapped 0.35, because a canopy scatters light
     through itself and a hard terminator on a tree reads as plastic.
   ========================================================================== */
const IMPOSTOR_VIEWS = 8;          // the brief's number: one frame per 45 degrees
const IMPOSTOR_W = 192, IMPOSTOR_H = 384;

/** Eight bearings of one species into a single 8-wide atlas. `obj` is anything
    that can be added to a scene; it is rotated, not the camera, so every frame
    is taken with the same lens and the same light. */
function bakeImpostorAtlas(obj, height) {
  const rt = new THREE.WebGLRenderTarget(IMPOSTOR_W * IMPOSTOR_VIEWS, IMPOSTOR_H, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace, generateMipmaps: true,
  });
  const sc = new THREE.Scene();
  const pivot = new THREE.Group();
  pivot.add(obj);
  sc.add(pivot);
  /* The same flat rig as bakeImpostor(), and the same reason for the numbers:
     the SCENE lights this texture a second time at draw, so an over-exposed
     photograph comes back as a white ghost on a green hill. */
  sc.add(new THREE.AmbientLight(0xffffff, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(1, 1.4, 1.2);
  sc.add(key);

  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(), mid = new THREE.Vector3();
  box.getSize(size); box.getCenter(mid);
  const h = Math.max(0.001, Math.max(size.y, height));
  /* The frame is the tree's own height with 4 % of air, and the width follows
     the atlas cell's aspect — so a conifer photographed into a narrow cell is
     not squashed, it simply has more sky either side of it. */
  const halfH = h * 0.52;
  const halfW = halfH * (IMPOSTOR_W / IMPOSTOR_H);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, h * 40);
  /* CENTRED AT halfH, NOT AT THE BOUNDING BOX'S MIDDLE, so the cell spans
     exactly y = 0 to y = 2 * halfH: the frame's bottom edge IS the ground the
     tree stands on, and the card the shader builds can therefore stand on the
     ground too without an offset nobody would remember to keep in step. */
  cam.position.set(0, halfH, h * 6);
  cam.lookAt(0, halfH, 0);

  /* THE VIEWPORT AND THE SCISSOR ARE SAVED AND PUT BACK, and this is not
     defensive tidiness — it is a bug that shipped for one run. Every other bake
     on this page renders a WHOLE target and therefore never touches the
     viewport, so nothing here had a habit of restoring it. This one draws eight
     cells into one target, and leaving the viewport at the last cell's 192x384
     made the composer draw the entire planet into a 1456x384 strip along the
     bottom of the window: three captures came back four fifths black with the
     page reporting a correct 1456x999 canvas, which is what makes it worth a
     paragraph rather than a line. */
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const prevScissor = renderer.getScissorTest();
  const prevView = renderer.getViewport(new THREE.Vector4());
  const prevScRect = renderer.getScissor(new THREE.Vector4());
  renderer.setRenderTarget(rt);
  renderer.setClearAlpha(0);
  renderer.clear();
  renderer.setScissorTest(true);
  for (let i = 0; i < IMPOSTOR_VIEWS; i++) {
    /* CELL i IS THE VIEW FROM BEARING i * 45 DEGREES, measured the same way the
       fragment shader measures it, which is the only thing that has to agree
       between the two halves of this feature. */
    pivot.rotation.y = -(i / IMPOSTOR_VIEWS) * Math.PI * 2;
    renderer.setViewport(i * IMPOSTOR_W, 0, IMPOSTOR_W, IMPOSTOR_H);
    renderer.setScissor(i * IMPOSTOR_W, 0, IMPOSTOR_W, IMPOSTOR_H);
    renderer.render(sc, cam);
  }
  renderer.setScissorTest(prevScissor);
  renderer.setViewport(prevView);
  renderer.setScissor(prevScRect);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  pivot.remove(obj);
  return rt.texture;
}

/** The material one species' impostors wear. One draw per bucket, the atlas
    cell chosen in the vertex shader, alpha-tested so nothing needs sorting. */
function impostorMaterial(atlas, treeH) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: atlas },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uNight: { value: 0 },
      uViews: { value: IMPOSTOR_VIEWS },
      /* THE CARD'S OWN METRES, and they have to be a uniform because they are
         NOT in the instance matrix. The near canopy bakes its species height
         into the GEOMETRY (`c.geo.clone().scale(t.h, t.h, t.h)`) and leaves the
         matrix carrying only the per-tree spread and stretch, both about 1. An
         impostor read straight off that matrix is therefore a one-metre card,
         and the first region capture came back with a hillside of dark dashes
         where a wood should be. These two are the atlas cell's own frame:
         2 * halfW wide and 2 * halfH tall, in the same metres. */
      uSize: { value: new THREE.Vector2(treeH * 0.52 * 2 * (IMPOSTOR_W / IMPOSTOR_H),
                                        treeH * 0.52 * 2) },
    },
    /* No lights, no fog, no tone mapping — the atlas was photographed THROUGH
       the tone mapper, and running it a second time at draw is what turns a
       forest pale grey (life.js's sprite tier carries the same note). */
    vertexShader: `
      uniform float uViews; uniform vec2 uSize;
      /* THE SAME PER-TREE TINT THE NEAR CANOPY WEARS. Without it every tree of
         a species is one photograph in one colour, and from straight down —
         where N·L is the same for every card because they all face the lens —
         that is the ONE thing left that says "wallpaper": the first region crop
         came back as a hillside of identical dark ovals. */
      attribute vec3 aTint;
      varying vec2 vUv; varying vec3 vN; varying float vLit; varying vec3 vTint;
      void main() {
        /* The instance basis carries the tree's own frame: column 0 is east
           scaled to its half-width, 1 is up scaled to its height, 2 is north.
           Everything below is read out of it rather than passed as attributes,
           so the far tier and the near tier share one set of matrices. */
        vec3 P  = vec3(instanceMatrix[3]);
        vec3 U  = vec3(instanceMatrix[1]);
        /* The matrix's column lengths are the per-tree STRETCH and SPREAD, both
           about 1 — the metres are in uSize. See its own note. */
        float sy = length(U);
        vec3 up = U / max(sy, 1e-6);
        vec3 ex = vec3(instanceMatrix[0]);
        float sxw = length(ex);
        float H = uSize.y * sy, W = uSize.x * sxw;
        vec3 east  = ex / max(sxw, 1e-6);
        vec3 north = normalize(vec3(instanceMatrix[2]));

        vec3 toCam = cameraPosition - P;
        /* The bearing of the LENS in the tree's own tangent frame, with the
           component along up removed — a camera straight overhead must not spin
           the atlas cell through all eight views in one frame. */
        vec3 flat0 = toCam - up * dot(toCam, up);
        float len = length(flat0);
        vec3 f = len > 1e-5 ? flat0 / len : north;
        float ang = atan(dot(f, east), dot(f, north));
        float cell = floor(mod(ang / 6.2831853 * uViews + uViews + 0.5, uViews));

        /* The billboard turns about the tree's OWN up, never about the lens's:
           on a sphere the second one lies down at the horizon. */
        vec3 right = normalize(cross(up, toCam));
        vec3 world = P + right * (position.x * W) + up * (position.y * H);
        vUv = vec2((uv.x + cell) / uViews, uv.y);

        /* A CYLINDRICAL NORMAL across the card: leaning left at u=0 and right
           at u=1, with a lift towards the sky, so a crown has a sunlit side and
           a shaded one instead of one flat value. */
        vN = normalize(right * (uv.x - 0.5) * 1.7 + up * 0.55 + normalize(toCam) * 0.5);
        vLit = uv.y;
        vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform vec3 uSun; uniform float uNight;
      varying vec2 vUv; varying vec3 vN; varying float vLit; varying vec3 vTint;
      void main() {
        vec4 t = texture2D(uAtlas, vUv);
        /* 0.42, the same cut the near canopy uses — a different one shows as a
           silhouette that changes shape at the swap. */
        if (t.a < 0.42) discard;
        /* WRAPPED N·L: a canopy scatters light through itself, so the shaded
           side of a crown is dark and not black. */
        float nl = clamp((dot(normalize(vN), uSun) + 0.35) / 1.35, 0.0, 1.0);
        /* And the underside of a crown is darker than its top whatever the sun
           is doing, which is the shading the leaf alpha bakes in near. */
        float ao = mix(0.80, 1.06, vLit);
        float day = 1.0 - uNight;
        /* 0.52/0.70, not 0.34/0.78. The first pass matched the near canopy's
           MEAN and not its RANGE, and a wood whose shaded half goes to a third
           of the texture reads as a hole in the hill rather than as trees —
           compare the two crops in docs/shots/final/round6/. */
        vec3 col = t.rgb * vTint * ao * (0.52 + 0.70 * nl) * (0.24 + 0.76 * day);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.DoubleSide,
  });
}

/** Two quads crossed at ninety degrees, standing on y = 0. The crossed pair is
    what stops a billboard vanishing when you walk round it — a single card
    turns edge-on and a forest disappears. Not a camera-facing sprite, because
    on a sphere "facing the camera" and "standing on the ground" fight each
    other and the trees end up lying down at the horizon. */
function crossedQuad(w, h) {
  const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  /* THE THIRD CARD, lying flat, and it is not optional on a globe. A map is
     looked at from straight down, which is the ONE angle at which two vertical
     cards are both edge-on: the first forest capture was four thousand little
     crosses lying on the ground like dropped aerials. The flat card wears the
     canopy half of the same bake — u 0.14..0.86, v 0.44..1.0 — so from above a
     tree is a round crown and from the side it is still the tree. */
  const c = new THREE.PlaneGeometry(w * 0.92, w * 0.92)
    .rotateX(-Math.PI / 2).translate(0, h * 0.66, 0);
  const uv = c.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.14 + uv.getX(i) * 0.72, 0.44 + uv.getY(i) * 0.56);
  }
  uv.needsUpdate = true;
  return BufferGeometryUtils.mergeGeometries([a, b, c], false);
}

/** Is this direction standing on somebody's settlement? The tree scatter runs
    in an annulus round EACH settlement, so on a crowded continent one town's
    annulus lands squarely on its neighbour's ground — and the first coast
    capture had two dozen trees growing out of a ploughed field. Reuses the same
    lat/lon site grid elevAt() flattens the pads with, so it costs nothing. */
function onAnyPad(u) {
  const near = sitesNear(u);
  if (!near) return false;
  /* 1.25, because the pad now reaches 1.015 of `deg` and a tree standing on
     the last two per cent of it is a tree in somebody's front garden. */
  for (const s of near) if (angDist(u, s.axis) < s.deg * 1.25) return true;
  return false;
}

/* -----------------------------------------------------------------------------
   THREE SPECIES, because twelve thousand copies of one tree is a wood you can
   identify. Round 2 had exactly one: the prop pack's quiver tree, whose
   silhouette is a bare trunk under a spray of blades — and on an Alpine street
   at dusk twelve of them read as a palm grove. That is the single loudest thing
   wrong with globe-street.png after the overlaps.

   The broadleaf and the conifer are BUILT here, not fetched: crossed planes
   wearing a leaf-cluster alpha drawn on a canvas at load, with a trunk under
   them. The method is world.js's (its TREE_TYPES / leafTexture /
   canopyGeometry, read as reference and re-implemented for the sphere — world.js
   is another agent's file and does not export them). Two things carried over
   because they are the whole trick:
     - the alpha is DRAWN, four hundred small ellipses inside a silhouette, so
       the ragged edge of a canopy is in the texture where it is cheap;
     - the normals are SPHERIFIED, pointed away from the canopy's own centre
       rather than along the quad, so three flat cards shade like a round mass.
   The quiver tree keeps its photographic bake and is now planted ONLY in the
   hot dry band, which is where a quiver tree grows.
   -------------------------------------------------------------------------- */
const TREE_SPECIES = [
  /* `h` is the tree's height in metres. 5.6 for the broadleaf is the round-2
     number and the reason holds: a cottage floor is 2.7 m, so a tree that
     clears a one-storey roof by half its own height is what a village in a wood
     looks like. The conifer is taller and much narrower — that contrast IS the
     species read at the distance where you cannot see a leaf. */
  { key: 'broad',   h: 5.6, w: 1.06, ch: 0.94, cy: 0.62, planes: 3, shape: 'round',
    trunkH: 0.44, trunkR: 0.052, tint: 0x7f9c55, blobs: 260, hue: 92,  spread: 22 },
  /* `model` is the one species with a SCAN behind it. Everything else on this
     row is the drawn canopy it falls back to when the pack is missing — the
     numbers are not dead: `buildForests()` uses them whenever
     `props['hy.tree_conifer']` failed to load, which is the same "a missing
     prop is a missing prop, not a dead planet" rule loadAssets() follows. */
  { key: 'conifer', h: 6.6, w: 0.74, ch: 1.10, cy: 0.52, planes: 3, shape: 'cone',
    model: 'hy.tree_conifer',
    trunkH: 0.26, trunkR: 0.040, tint: 0x4a6b4a, blobs: 230, hue: 132, spread: 16 },
  /* index 2 is the quiver tree and it has no canopy geometry — it is the pack's
     own model, baked. See buildForests(). */
  { key: 'quiver',  h: 5.2, baked: true },
];

/** Which species stands at this point. Latitude and elevation, in that order,
    because that is what actually decides it on a planet: the quiver tree only
    in the hot dry band, conifer up the mountain and towards the poles,
    broadleaf on everything in between. Deterministic off the position, so the
    same coordinate is the same species on every reload. */
function speciesAt(u, e, lat) {
  /* THE DRIEST, HOTTEST BAND, and nowhere else. |lat| under 24 and low ground,
     where splatWeights() is already laying scrub rather than forest. The 0.30
     of hash is what keeps the edge of the band ragged instead of a line of
     latitude drawn across the map. */
  const dry = smoothstep(30, 18, Math.abs(lat)) * smoothstep(22, 12, e);
  const r = (hash32('sp' + Math.round(u.x * 900) + ':' + Math.round(u.y * 900) +
                    ':' + Math.round(u.z * 900)) % 1000) / 1000;
  if (r < dry * 0.86) return 2;
  /* Conifer takes over up the hill and towards the poles — a treeline read as a
     species change rather than as a hard stop. */
  const alp = Math.max(smoothstep(14, 30, e), smoothstep(44, 62, Math.abs(lat)));
  return r < 0.30 + 0.62 * alp ? 1 : 0;
}

/** How much this ground faces AWAY from the equator, 0..1. A north slope in the
    northern hemisphere (and a south slope in the southern one) is the shaded,
    damp side of a hill, and that is where the wood is thicker — which is the
    brief's "denser on north slopes". Two elevation samples 1.4 units apart
    along local north; the sign is flipped below the equator so the same
    function means "the shaded side" on both halves of the planet. */
function shadedSlope(u) {
  const fr = frameAt(u);
  const step = 1.4 / R;
  const a = elevRaw(u.clone().addScaledVector(fr.north, step).normalize());
  const b = elevRaw(u.clone().addScaledVector(fr.north, -step).normalize());
  const rise = (u.y >= 0 ? b - a : a - b) / 1.4;    // + means the ground drops poleward
  return clamp(rise * 1.6, 0, 1);
}

/** The leaf-cluster alpha for one species: hundreds of small ellipses inside a
    silhouette, in a band of greens, with the lower third darkened. A canopy is
    lit from above and shades itself underneath, and baking that in is far
    cheaper than asking the lighting to find it on a flat quad. */
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
    /* v is 0 at the top of the canopy and 1 at the bottom; the silhouette's
       half-width at that height is what makes a cone a cone and a ball a ball. */
    const v = r2;
    const halfW = t.shape === 'cone'
      ? 0.10 + 0.42 * Math.pow(v, 0.78)
      : 0.50 * Math.sqrt(Math.max(0, 1 - Math.pow(v * 2 - 1, 2))) * (0.82 + 0.24 * r3);
    g.save();
    g.translate(S * (0.5 + (r1 - 0.5) * 2 * halfW), S * (0.06 + v * 0.9));
    g.rotate(r1 * 6.283);
    g.fillStyle = 'hsl(' + (t.hue + (r3 - 0.5) * t.spread) + ',' +
                  (30 + r4 * 26) + '%,' + (16 + (1 - v) * 26 + r4 * 12) + '%)';
    g.beginPath();
    g.ellipse(0, 0, 6 + r3 * 15, 5 + r4 * 11, 0, 0, 6.2832);
    g.fill();
    g.restore();
  }
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 4;
  return tx;
}

/** `planes` crossed quads around the trunk, plus the flat card that a globe
    needs, normalised to ONE unit tall standing on the ground, with spherified
    normals. Returns the geometry and where the trunk goes in the same units. */
function canopyGeometry(t) {
  const pos = [], nrm = [], uv = [], idx = [];
  const top = t.cy + t.ch / 2, k = 1 / top;      // normalise: total height = 1
  const cn = new THREE.Vector3(), vn = new THREE.Vector3();
  let base = 0;
  for (let i = 0; i < t.planes; i++) {
    const a = i * Math.PI / t.planes;
    const dx = Math.cos(a) * t.w / 2, dz = Math.sin(a) * t.w / 2;
    const y0 = t.cy - t.ch / 2, y1 = t.cy + t.ch / 2;
    const corners = [[-dx, y0, -dz], [dx, y0, dz], [dx, y1, dz], [-dx, y1, -dz]];
    const planeN = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    for (let q = 0; q < 4; q++) {
      const cx = corners[q][0], cy = corners[q][1], cz = corners[q][2];
      pos.push(cx * k, cy * k, cz * k);
      /* Away from the canopy's own centre, mostly — the 0.18 of plane normal
         left in is what keeps a quad seen edge-on from going black. */
      vn.set(cx, cy - t.cy, cz).normalize();
      cn.copy(planeN).multiplyScalar(0.18).addScaledVector(vn, 0.82).normalize();
      nrm.push(cn.x, cn.y, cn.z);
      uv.push(q === 0 || q === 3 ? 0 : 1, q < 2 ? 1 : 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    base += 4;
  }
  /* THE FLAT CARD, and it is not optional on a globe: a map is looked at from
     straight down, which is the one angle at which every vertical card is
     edge-on. Round 2's first forest capture without it was four thousand little
     crosses lying on the ground like dropped aerials. It wears the top half of
     the same leaf alpha, so from above a tree is a round crown. */
  /* 0.30 of the canopy's width, not half of it, and sitting INSIDE the crown
     rather than on top. Seen from a street this card is edge-on, and at 0.46 it
     drew a hard horizontal line through every tree on the horizon — read
     straight off the first three-species street capture. At 0.30 it is hidden
     by the vertical cards from the side and still fills the crown from above,
     which is the only view it exists for. */
  const fw = t.w * 0.30 * k, fy = (t.cy + t.ch * 0.10) * k;
  const fc = [[-fw, fy, -fw], [fw, fy, -fw], [fw, fy, fw], [-fw, fy, fw]];
  for (let q = 0; q < 4; q++) {
    pos.push(fc[q][0], fc[q][1], fc[q][2]);
    nrm.push(0, 1, 0);
    uv.push(0.16 + (q === 0 || q === 3 ? 0 : 1) * 0.68,
            0.42 + (q < 2 ? 0 : 1) * 0.56);
  }
  idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geo: g, trunkH: t.trunkH * k, trunkR: t.trunkR * k };
}

/** Every tree on the planet. Scattered where forestMask() says there are woods
    — the SAME function the ground splat lays forest_floor with, so the trees
    stand on their own floor and not on grass — along the river channels, and
    thicker on the shaded side of a hill. */
function buildForests() {
  const bake = props.treeReal ? bakeImpostor(props.treeReal) : null;
  /* THE SCANNED CONIFER, NORMALISED ONCE AND PHOTOGRAPHED TWICE.
     `model.hy.tree_conifer` is the same spruce `streetProps()` stands on the
     alpine street, and the whole reason it is normalised HERE rather than at
     each bake is that both photographs have to be of the same object at the
     same size: the head-on shot the near cards wear and the eight-bearing atlas
     the far tier wears. Photograph the model at its raw 1.19 units and
     `bakeImpostorAtlas()` — which frames `max(size.y, height)` — would put a
     six-metre frame round a one-metre tree and the wood would come back as
     specks in a lot of sky.
     Scaled to the species' own 6.6 m and stood on y = 0 with its footprint
     centred on the origin, because the atlas SPINS this object about that
     origin and an off-centre tree would orbit instead of turning. */
  let coniferScan = null, coniferBake = null;
  const coniferSrc = props[TREE_SPECIES[1].model];
  if (coniferSrc) {
    const o = coniferSrc.clone(true);
    const box = new THREE.Box3().setFromObject(o);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 1e-4) {
      const s = TREE_SPECIES[1].h / size.y;
      o.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s,
                     -((box.min.z + box.max.z) / 2) * s);
      o.scale.setScalar(s);
      coniferScan = o;
      coniferBake = bakeImpostor(o);
    }
  }
  const spots = [];
  const dir = new THREE.Vector3();

  /* --- around the settlements ---------------------------------------------
     An annulus outside the pad: a wood grows up TO a village, never through
     it, and the pad is where the buildings are. */
  for (const p of plan.placed) {
    const fr = p.frame;
    for (let i = 0; i < 150; i++) {
      const h = hash32(p.town.id + 'V' + i);
      const a = ((h % 3600) / 3600) * Math.PI * 2;
      const rad = p.radius * (1.25 + 2.1 * ((h >>> 7) % 1000) / 1000);
      dir.copy(p.axis).addScaledVector(fr.east, Math.cos(a) * rad / R)
         .addScaledVector(fr.north, Math.sin(a) * rad / R).normalize();
      if (forestMask(dir) < 0.42) continue;
      const e = elevAt(dir);
      if (e < 1.6 || e > 34) continue;
      if (onAnyPad(dir)) continue;
      spots.push(dir.clone());
    }
  }

  /* --- along the rivers and up the shaded slopes ---------------------------
     A Fibonacci sphere is the cheapest even sample of a whole planet, and 30 k
     of them is about one every 13 units of arc — fine enough to land in a
     channel a few units wide, coarse enough to run in a fifth of a second. */
  const N = 30000, GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N && spots.length < 12000; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = GA * i;
    dir.set(Math.cos(th) * r, y, Math.sin(th) * r);
    const m = landMask(dir);
    const bank = riverAt(dir, m) >= 0.45;
    /* THE SHADED SIDE OF A HILL CARRIES MORE WOOD, so the forest threshold
       drops on it. The test costs two extra elevRaw() calls, which is why it
       only runs on ground that is already nearly wooded — running it on all
       30,000 samples added 0.6 s to the build for the same picture. */
    let need = 0.66;
    if (!bank && forestMask(dir) < 0.52) continue;
    if (!bank) need = 0.66 - 0.20 * shadedSlope(dir);
    if (!bank && forestMask(dir) < need) continue;
    const e = elevAt(dir);
    if (e < 1.0 || e > 34) continue;
    if (onAnyPad(dir)) continue;
    for (let k = 0; k < (bank ? 2 : 4); k++) {
      const h = hash32('R' + i + '_' + k);
      const fr = frameAt(dir);
      spots.push(dir.clone()
        .addScaledVector(fr.east, (((h % 1000) / 1000) - 0.5) * (bank ? 9 : 26) / R)
        .addScaledVector(fr.north, ((((h >>> 10) % 1000) / 1000) - 0.5) * (bank ? 9 : 26) / R)
        .normalize());
    }
  }
  if (!spots.length) return 0;

  /* --- sorted into species x continent -------------------------------------
     SIX MESHES PER SPECIES, ONE PER CONTINENT, and the continent split is a
     frame-rate fix rather than an organising one: three frustum-culls an
     InstancedMesh against `object.boundingSphere`, which computeBoundingSphere()
     fills from the INSTANCE matrices, so one mesh holding twelve thousand trees
     spread over a whole planet has the PLANET for a bounding sphere and every
     tree on the far side is submitted every frame. Measured in round 2 at the
     street pose: 34 -> 39 fps. */
  const bucketOf = u => {
    for (let ci = 0; ci < CONTINENTS.length; ci++) {
      if (angDist(u, CONTINENTS[ci].axis) < CONTINENTS[ci].r * 1.4) return ci;
    }
    return CONTINENTS.length;
  };
  const buckets = new Map();          // "species:continent" -> spots
  treeCounts.length = 0;
  treeCounts.push(0, 0, 0);
  for (const u of spots) {
    const e = elevAt(u);
    const lat = Math.asin(clamp(u.y, -1, 1)) / DEG;
    let sp = speciesAt(u, e, lat);
    if (sp === 2 && !bake) sp = 0;    // no prop pack, no quiver tree
    treeCounts[sp]++;
    const k = sp + ':' + bucketOf(u);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(u);
  }

  /* One material and one geometry per species, shared by that species' six
     continent meshes. */
  const built = TREE_SPECIES.map(t => {
    /* WHICH PHOTOGRAPH THIS SPECIES WEARS, IF ANY. `baked` is the quiver tree,
       which has never had a canopy of its own; `model` is the scanned conifer,
       which has one and no longer needs it. A species with a `model` whose scan
       did not load falls THROUGH to the drawn canopy below rather than
       disappearing — one missing file must not empty the alpine wood. */
    const shot = t.baked ? bake : (t.model ? coniferBake : null);
    if (t.baked && !shot) return null;
    if (shot) {
      return { geo: crossedQuad(t.h * (shot.width / shot.height), t.h),
               mat: new THREE.MeshStandardMaterial({
                 map: shot.texture, transparent: false, alphaTest: 0.42,
                 side: THREE.DoubleSide, roughness: 0.94, metalness: 0 }),
               /* The scan carries its own trunk, so there is no trunk mesh and
                  no trunk draw call for this species at any distance. */
               trunk: null, h: t.h, scan: t.model ? coniferScan : null };
    }
    const c = canopyGeometry(t);
    const trunkGeo = new THREE.CylinderGeometry(c.trunkR * 0.72, c.trunkR,
                                                c.trunkH * 2.1, 5)
      .translate(0, c.trunkH * 1.05, 0).scale(t.h, t.h, t.h);
    return {
      geo: c.geo.clone().scale(t.h, t.h, t.h),
      mat: new THREE.MeshStandardMaterial({
        map: leafTexture(t), color: t.tint,
        /* alphaTest, not transparent: twelve thousand transparent canopies
           would need sorting every frame and would still overlap wrongly. */
        alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.94, metalness: 0 }),
      trunkGeo,
      trunkMat: new THREE.MeshStandardMaterial({ color: 0x453626, roughness: 1,
                                                 metalness: 0 }),
      h: t.h,
    };
  });

  /* THE EIGHT-VIEW ATLAS PER SPECIES, baked once off the geometry just built —
     see GLOBE-IMPOSTOR-DOC. The subject is the canopy AND its trunk, because a
     tree photographed without one has no ground contact at 400 m and a wood of
     them floats. */
  const atlas = built.map(B => {
    if (!B) return null;
    /* WHERE THERE IS A SCAN, THE EIGHT BEARINGS ARE OF THE SCAN. Photographing
       the crossed cards instead would be photographing a photograph: the near
       card is already one head-on view of this tree, so its atlas would be that
       one view smeared round eight bearings and the far wood would go back to
       being the confetti this atlas exists to fix. The other two species have
       no model and are still photographed off their own built geometry, trunk
       included, exactly as before. */
    const o = B.scan || (() => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(B.geo, B.mat));
      if (B.trunkGeo) g.add(new THREE.Mesh(B.trunkGeo, B.trunkMat));
      return g;
    })();
    const tx = bakeImpostorAtlas(o, B.h);
    return { tex: tx, mat: impostorMaterial(tx, B.h) };
  });
  /* ONE quad for every impostor on the planet: the vertex shader builds the
     billboard out of the instance matrix, so the geometry itself is a unit
     card and nothing about it is per-species. */
  const impostorQuad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

  const col = new THREE.Color();
  const m4 = new THREE.Matrix4();
  const up = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3();
  forestMeshes.length = 0;
  trunkMeshes.length = 0;
  impostorMeshes.length = 0;
  for (const [key, list] of buckets) {
    const sp = +key.split(':')[0];
    const B = built[sp];
    if (!B) continue;
    const mesh = new THREE.InstancedMesh(B.geo, B.mat, list.length);
    mesh.name = 'forest' + key;
    mesh.castShadow = false;      // 12,000 alpha-tested cards in the shadow pass is the frame
    mesh.receiveShadow = false;
    mesh.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
    const trunk = B.trunkGeo
      ? new THREE.InstancedMesh(B.trunkGeo, B.trunkMat, list.length) : null;
    if (trunk) { trunk.name = 'trunk' + key; trunk.castShadow = false; }
    /* The far tier of the same bucket, sharing the SAME instance matrices —
       one write, two meshes, so the near tree and its impostor can never be in
       two places. */
    const imp = atlas[sp]
      ? new THREE.InstancedMesh(impostorQuad, atlas[sp].mat, list.length) : null;
    if (imp) {
      imp.name = 'impostor' + key;
      imp.castShadow = imp.receiveShadow = false;
      /* The billboard is built in the shader from `cameraPosition`, so the
         geometry three sees is a unit quad at the origin and its own bounding
         sphere is meaningless. */
      imp.frustumCulled = false;
      imp.geometry = imp.geometry.clone();       // its own aTint, not the shared quad's
      imp.geometry.setAttribute('aTint',
        new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3));
    }
    list.forEach((u, i) => {
      up.copy(u);
      east.set(0, 1, 0).cross(up);
      if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
      east.normalize();
      north.copy(up).cross(east).normalize();
      const h = hash32('T' + key + '_' + i);
      const yaw = ((h % 360)) * DEG;
      /* Not a uniform scale. A stand of trees the same height is a plantation;
         the vertical stretch is independent of the spread, which is what a
         wind-shaped hillside looks like. */
      const sw = 0.72 + ((h >>> 9) % 100) / 180;
      const sh = 0.74 + ((h >>> 23) % 100) / 150;
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const ax = east.clone().multiplyScalar(cy).addScaledVector(north, sy).multiplyScalar(sw);
      const az = north.clone().multiplyScalar(cy).addScaledVector(east, -sy).multiplyScalar(sw);
      m4.makeBasis(ax, up.clone().multiplyScalar(sh), az);
      m4.setPosition(u.clone().multiplyScalar(R + Math.max(0.15, elevAt(u)) - 0.3));
      mesh.setMatrixAt(i, m4);
      if (trunk) trunk.setMatrixAt(i, m4);
      if (imp) imp.setMatrixAt(i, m4);
      /* A wood is not one green. Ten per cent either way of the species' own
         colour is what stops four thousand copies reading as wallpaper. */
      const g = 0.80 + ((h >>> 17) % 100) / 250;
      col.setRGB(g * 0.94, g, g * 0.86);
      mesh.setColorAt(i, col);
      if (imp) imp.geometry.getAttribute('aTint').setXYZ(i, col.r, col.g, col.b);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    forestMeshes.push(mesh);
    if (imp) {
      imp.instanceMatrix.needsUpdate = true;
      imp.geometry.getAttribute('aTint').needsUpdate = true;
      /* The bucket's own centre and radius, borrowed off the near mesh, so
         updateTreeLod() can skip a continent on the far side of the planet the
         same way it already skips its trunks. */
      imp.userData.axis = mesh.boundingSphere
        ? mesh.boundingSphere.center.clone().normalize() : null;
      imp.visible = false;                   // updateTreeLod() decides the tier
      scene.add(imp);
      impostorMeshes.push(imp);
    }
    if (trunk) {
      trunk.instanceMatrix.needsUpdate = true;
      trunk.computeBoundingSphere();
      /* Kept on the mesh so updateTreeLod() does not recompute it every frame.
         It never changes: the trees do not move. */
      trunk.userData.bs = trunk.boundingSphere.clone();
      trunk.visible = false;        // updateTreeLod() turns it on inside 350 m
      scene.add(trunk);
      trunkMeshes.push(trunk);
    }
  }
  return spots.length;
}

/** IMPOSTORS BEYOND 350 m, and this is what that means here. A canopy is
    already three crossed cards plus a flat one — that IS the impostor, and it
    is what every tree on the planet wears at every distance. What the trunk
    adds is a five-sided cylinder 5 cm across, which past 350 m of camera
    altitude is under a third of a pixel and costs one draw call per species per
    continent to submit. Below 350 the trunks come on and a tree stops being a
    bush. One distance test a frame, not one per tree. */
/* WHERE THE FOREST CHANGES TIER. 300 units, one step below the trunk band and
   the same altitude the living layer comes on at, because both are answering
   the same question: is a thing on the ground still resolvable. Under it a
   tree is its crossed cards and its trunk; over it, one eight-view impostor.
   The swap is invisible in a still and nearly invisible in motion — the atlas
   was photographed off the cards it replaces. */
const IMPOSTOR_ALT = 300;

function updateTreeLod() {
  /* THE TIER, and it is a separate decision from the trunks: at 300 the wood
     stops being geometry and starts being photographs of geometry. The sun goes
     into every impostor material on the same tick, or a wood is lit from where
     the sun was when the page loaded. */
  const near = (cam.dist - R) < IMPOSTOR_ALT;
  if (near !== nearForest) {
    nearForest = near;
    for (const m of forestMeshes) m.visible = near;
  }
  /* THE CULL IS A HEMISPHERE TEST, not a distance one, and the difference is
     the whole forest. `frustumCulled` is off — the billboard is built in the
     vertex shader out of `cameraPosition`, so three's own bounding sphere for a
     unit quad at the origin is a lie and would cull the planet's every tree.
     A distance test was tried first and hid every bucket at orbit (1,150 units
     of altitude against a 300-unit bucket radius): from space the whole visible
     half of the planet is in frame, and what is worth skipping is the buckets
     behind it. Their own centre against the camera's direction is that test. */
  const camDir = camera.position.clone().normalize();
  for (const m of impostorMeshes) {
    m.visible = !near && (!m.userData.axis || m.userData.axis.dot(camDir) > -0.12);
    if (m.visible) {
      m.material.uniforms.uSun.value.copy(sunDir);
      m.material.uniforms.uNight.value = nightAmount;
    }
  }

  const want = (cam.dist - R) < 350;
  if (want === trunksOn) return;
  trunksOn = want;
  for (const m of trunkMeshes) {
    /* AND ONLY THE BUCKET THE CAMERA IS OVER. A trunk mesh holds one
       continent's worth of one species, and inside 350 m of altitude the camera
       can only see one of them — submitting the other eleven costs 1.5 fps at
       the street pose for trees on the far side of the planet. The bounding
       sphere is the one computeBoundingSphere() filled from the instance
       matrices, so this is a real distance and not the planet's radius. */
    m.visible = want && (!m.userData.bs ||
      camera.position.distanceTo(m.userData.bs.center) < m.userData.bs.radius + 500);
  }
}

/* =============================================================================
   THE NIGHT LIGHTS — one Points cloud for the whole planet
   Every settlement contributes as many points as its class earns, and the
   vertex shader turns each one on from the SUN's direction. That is why the
   lights appear exactly along the terminator as the planet turns and not on a
   timer: it is the same dot product the ground is lit by.
   ========================================================================== */
function buildNightLights() {
  const pts = [], sizes = [], cols = [];
  const c = new THREE.Color();
  for (const p of plan.placed) {
    const n = p.spec.lights;
    const fr = p.frame;
    for (let i = 0; i < n; i++) {
      const h = hash32(p.town.id + 'L' + i);
      const a = ((h % 3600) / 3600) * Math.PI * 2;
      const rad = p.radius * Math.sqrt(((h >>> 7) % 1000) / 1000) * 0.96;
      const lift = 1.4 + ((h >>> 11) % 40) / 10;
      const d = p.axis.clone()
        .addScaledVector(fr.east, Math.cos(a) * rad / R)
        .addScaledVector(fr.north, Math.sin(a) * rad / R).normalize();
      const v = d.multiplyScalar(R + p.elev + lift);
      pts.push(v.x, v.y, v.z);
      sizes.push(p.cls === 'city' ? 30 : p.cls === 'town' ? 24 : 17);
      /* Sodium orange for houses, a colder white for a few — a real town at
         night is two colour temperatures, not one. */
      c.setHex(((h >>> 3) & 7) === 0 ? 0xcfe0ff : 0xffb960);
      cols.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  lightsPoints = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uPix: { value: 900 } },
    vertexShader: `
      attribute float aSize; varying vec3 vC; varying float vOn;
      uniform vec3 uSun; uniform float uPix;
      void main(){
        vC = color;
        vec3 up = normalize(position);
        /* The lamps come on BEFORE it is dark, the way a person switches one on
           when they cannot read any more. -0.02 to -0.30 is roughly civil
           twilight to full night on a real terminator. */
        vOn = smoothstep(0.06, -0.20, dot(up, uSun));
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * uPix / (-mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC; varying float vOn;
      void main(){
        if (vOn < 0.01) discard;
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.04, length(d));
        gl_FragColor = vec4(vC, a * vOn);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexColors: true,
  }));
  lightsPoints.frustumCulled = false;
  lightsPoints.name = 'night-lights';
  scene.add(lightsPoints);
  return pts.length / 3;
}


/* =============================================================================
   TRADE LANDMARKS AND SIGNS
   A town whose /api/world entry carries a schema.org trade gets ONE building
   that is that trade — the same grammar the island uses, so a music school is a
   barrel vault in both views. Cities and towns get a sign on a mast with their
   name, and their own favicon on it when the server found one.
   ========================================================================== */
const signSprites = [], landmarkMeshes = [];

/* THE APRON ROUND A LANDMARK — the "one plot" of daylight the brief asks for.
   3.0 m is a lane's half width (1.7) plus the LOT_GAP daylight (1.2) every two
   footprints on this planet already keep between them, rounded up: a landmark
   is walked up to, so it gets its own ground and not just the gap two cottages
   get. It is deliberately NOT larger — the plaza grows to hold it (laneNetwork
   below), and every metre of plaza is a metre the ring lanes and their lots do
   not have. Measured: at 6 m, claude-live's square reached its own ring lane. */
const LM_APRON = 3.0;

/** THE LANDMARK'S FOOTPRINT in the settlement's own metres, or null where the
    settlement has no trade — ONE source of truth with three readers:
    laneNetwork()/planBuildings() keep this ground clear BEFORE anything is
    placed on it, buildLandmarks() draws the building on it, and
    __overlapsBuildings() audits that nothing else got there.

    THE DEFECT THIS EXISTS FOR (docs/shots/trade-hotel-landmark.png): the
    landmark was drawn AFTER the whole settlement had been planned, at a size
    the planner had never been told, so a landmark came down inside a cottage —
    two houses interpenetrating. Measured before this pass: 16 landmark-against-
    building intersections across 7 of the 10 settlements that have one.

    It is MEASURED off the real geometry, never assumed. standMatrix()'s own
    comment says it centres a UNIT box, and the procedural forms in
    landmarkGeo() are not unit boxes — they are modelled at whatever size their
    parts need, and claude-live's came back 23.2 m wide off a `size` of 12,
    which is 1.93 units. A scan is worse: landmarkScan() fits it by HEIGHT and
    leaves its width wherever the generator put it (musikschule: 15.1 x 17.0 m
    at a 9.5 m target). Both are read here rather than guessed at.

    The procedural geometry is cached on the settlement because buildLandmarks()
    draws that very same one: measuring must not cost a second build. */
function landmarkFootprint(p) {
  if (p.lmFoot !== undefined) return p.lmFoot;
  p.lmFoot = null;
  const type = p.town.trade && p.town.trade.type;
  const form = type && TRADE_FORMS[type];
  if (!form) return null;
  const size = new THREE.Vector3();
  const lmKey = LM_MODEL[type];
  if (lmKey && landmarkModels[lmKey]) {
    new THREE.Box3().setFromObject(landmarkModels[lmKey]).getSize(size);
    if (size.y > 1e-4) {
      const s = (LM_HEIGHT[p.cls] || 9.5) / size.y;
      /* The scan's own yaw and no other: landmarkScan() reads this same
         expression back out of here, so the rectangle reserved is the
         rectangle built. */
      p.lmFoot = { w: size.x * s, d: size.z * s, scan: lmKey,
                   yaw: ((hash32(p.town.id) % 180) / 10 - 9) * DEG };
      return p.lmFoot;
    }
  }
  /* The procedural fallback, and its size table is the one buildLandmarks()
     used to carry inline — a settlement WITH a trade always gets its landmark,
     scaled to 0.7x on a hamlet or a field. */
  const small = p.cls === 'fields' || p.cls === 'hamlet';
  const sz = p.cls === 'city' ? 15 : p.cls === 'town' ? 12 : small ? 9 * 0.7 : 9;
  const geo = landmarkGeo(form);
  geo.computeBoundingBox();
  geo.boundingBox.getSize(size);
  p.lmGeo = geo;
  p.lmFoot = { w: size.x * sz, d: size.z * sz, form, size: sz,
               yaw: (hash32(p.town.id) % 90) * DEG };
  return p.lmFoot;
}

function landmarkGeo(form) {
  switch (form) {
    case 'concertHall': {
      /* A BARREL VAULT. What makes a concert hall read as a concert hall from
         orbit is that its roof CURVES while every other roof on this planet is
         a pitch or a flat — one silhouette, no texture needed. */
      const v = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1, false, 0, Math.PI)
        .rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
      const base = new THREE.BoxGeometry(1, 0.34, 1).translate(0, -0.17, 0);
      return BufferGeometryUtils.mergeGeometries([v, base], false);
    }
    case 'factoryHall': {
      const hall = new THREE.BoxGeometry(1.5, 0.6, 1).translate(0, 0.3, 0);
      const stack = new THREE.CylinderGeometry(0.09, 0.13, 1.7, 10).translate(0.62, 0.85, 0.3);
      return BufferGeometryUtils.mergeGeometries([hall, stack], false);
    }
    case 'waterTower': {
      const leg = new THREE.CylinderGeometry(0.06, 0.09, 1.2, 8).translate(0, 0.6, 0);
      const tank = new THREE.CylinderGeometry(0.42, 0.42, 0.5, 14).translate(0, 1.4, 0);
      return BufferGeometryUtils.mergeGeometries([leg, tank], false);
    }
    case 'glassOffice':
      return new THREE.BoxGeometry(0.9, 1.7, 0.9).translate(0, 0.85, 0);
    case 'dataHall': {
      const hall = new THREE.BoxGeometry(1.4, 0.5, 1).translate(0, 0.25, 0);
      const mast = new THREE.CylinderGeometry(0.03, 0.05, 2.2, 6).translate(0.5, 1.1, 0);
      return BufferGeometryUtils.mergeGeometries([hall, mast], false);
    }
    case 'library':
    case 'school': {
      const body = new THREE.BoxGeometry(1.2, 0.8, 0.9).translate(0, 0.4, 0);
      const tower = new THREE.BoxGeometry(0.34, 1.5, 0.34).translate(-0.42, 0.75, 0);
      return BufferGeometryUtils.mergeGeometries([body, tower], false);
    }
    case 'filmStudio': {
      const stage = new THREE.BoxGeometry(1.3, 0.9, 1.1).translate(0, 0.45, 0);
      const rig = new THREE.BoxGeometry(1.5, 0.08, 1.3).translate(0, 1.1, 0);
      return BufferGeometryUtils.mergeGeometries([stage, rig], false);
    }
    case 'eatery': {
      const room = new THREE.BoxGeometry(1.1, 0.5, 0.9).translate(0, 0.25, 0);
      const awn = new THREE.BoxGeometry(1.3, 0.05, 0.5).translate(0, 0.55, 0.6);
      return BufferGeometryUtils.mergeGeometries([room, awn], false);
    }
    case 'codeShop':
    case 'workshop':
    default: {
      const shed = new THREE.BoxGeometry(1.1, 0.55, 0.9).translate(0, 0.28, 0);
      const pitch = new THREE.CylinderGeometry(0.001, 0.8, 0.36, 3).rotateY(Math.PI / 2).translate(0, 0.72, 0);
      return BufferGeometryUtils.mergeGeometries([shed, pitch], false);
    }
  }
}

/** A scanned landmark, normalised to a real height and stood on the plaza.

    The model is fitted by its MEASURED bounding box and not by the manifest's
    `heightUnits`: that row states what the generator produced, and the reading
    that survives a re-generated file is the one taken off the geometry in front
    of you — the same rule life.js's rigid loader follows and for the same
    reason. `heightUnits` is still read, as a sanity check: a file whose measured
    height is more than a third away from what the manifest claims is a file that
    has been swapped, and it is refused rather than drawn at the wrong size. */
function landmarkScan(key, targetH, p) {
  const src = landmarkModels[key];
  if (!src) return null;
  const o = src.clone(true);
  const box = new THREE.Box3().setFromObject(o);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!(size.y > 1e-4)) return null;
  const s = targetH / size.y;
  /* Centred horizontally and standing ON y = 0: a scan's origin is wherever the
     generator put it, which for this pack is neither. */
  o.position.set(-((box.min.x + box.max.x) / 2) * s, -box.min.y * s,
                 -((box.min.z + box.max.z) / 2) * s);
  o.scale.setScalar(s);
  o.traverse(nd => {
    if (!nd.isMesh) return;
    nd.castShadow = nd.receiveShadow = true;
    /* THE SCAN ARRIVES LIT FOR A TURNTABLE, NOT FOR THIS PLANET. Straight out of
       the GLB, lm_office came back a white block that blew through the bloom
       threshold and became the brightest thing in globe-street.png — brighter
       than the sky behind it. A generator's material is a near-white albedo at
       low roughness with no environment; this town is plaster at roughness 1
       under one sun. Three numbers put the scan in the same light as the
       buildings round it, and the guard is because clone(true) SHARES materials
       with the source, so a second landmark of the same type would multiply the
       colour twice. */
    for (const m of (Array.isArray(nd.material) ? nd.material : [nd.material])) {
      if (!m || m.userData.lmTuned) continue;
      m.userData.lmTuned = true;
      if (m.color) m.color.multiplyScalar(0.62);
      if (m.roughness !== undefined) m.roughness = Math.max(0.75, m.roughness);
      if (m.metalness !== undefined) m.metalness = Math.min(0.08, m.metalness || 0);
      if (m.envMap !== undefined) { m.envMap = envDay; m.envMapIntensity = 0.45; }
      m.needsUpdate = true;
    }
  });
  const holder = new THREE.Group();
  holder.add(o);
  holder.matrixAutoUpdate = false;
  /* placeMatrix, not standMatrix: the model already stands on its own zero, so
     it wants a placement and not a unit box's centre-lift.

     AND IT FACES THE STREET, which the previous `hash % 90` yaw did not. Every
     model in this pack is built facing +Z — an awning, a shop window, a foyer,
     a flight of steps, all on that one side — and placeMatrix's third basis
     column at yaw 0 is `east x up`, which is the local street's own normal:
     streetProps() runs the lamp posts along east at oz = +/-3.4, so the road
     passes the plaza on exactly that axis. A yaw anywhere in 0..90 degrees
     therefore pointed the front of the building at a corner of the square, and
     the two village captures that made this obvious were of a bakery showing
     the camera its blank gable.
     The jitter is +/-9 degrees and it is not decoration: 26 villages with a
     landmark squared off to the same degree read as a stamped set rather than
     as places, which is the same reason the buildings round them carry a
     per-lot yaw. Nine degrees is small enough that the front is still the side
     you see from the road. */
  /* The yaw now comes back OUT of landmarkFootprint(), which is the rectangle
     the lot planner reserved — the two cannot drift apart. */
  holder.matrix.copy(placeMatrix(p, p.frame, 0, 0, landmarkFootprint(p).yaw));
  return holder;
}

function buildLandmarks() {
  const mat = litMaterial(tex.plaster, 0xcdbfa4);
  let n = 0, scanned = 0;
  for (const p of plan.placed) {
    const type = p.town.trade && p.town.trade.type;
    const form = type && TRADE_FORMS[type];
    if (!form) continue;
    /* A settlement WITH a detected trade always gets its trade landmark now —
       Beri wants gasthof-im-tal (hamlet) and gasthof-post-wenns (fields) to
       show their Hotel. Scaled to 0.7x the town size for hamlet/fields (still
       facing the road and carrying the logo sign, both unchanged below);
       settlements with no trade never reach this line (see !form above).
       THE SIZE AND THE YAW ARE landmarkFootprint()'S NOW, not this function's:
       planBuildings() reserved the ground off that same call, and two copies of
       the size table are two buildings of different sizes. */
    const foot = landmarkFootprint(p);
    if (!foot) continue;
    const size = foot.size;
    /* THE SCAN WINS WHERE THERE IS ONE. It is the same building the trade
       actually is, photographed, instead of two boxes and a cylinder standing
       for it — so it replaces the procedural form rather than joining it. */
    const lmKey = foot.scan;
    if (lmKey && landmarkModels[lmKey]) {
      const g = landmarkScan(lmKey, LM_HEIGHT[p.cls] || 9.5, p);
      if (g) {
        g.name = 'landmark:' + p.town.name;
        p.form = form;
        p.formWords = TRADE_WORDS[form] || null;
        p.landmarkScan = lmKey;
        scene.add(g); landmarkMeshes.push(g); n++; scanned++;
        continue;
      }
    }
    /* `p.lmGeo` is the geometry landmarkFootprint() already measured — building
       landmarkGeo(form) a second time here would be a second build of the same
       shape and, worse, a shape nothing had measured. */
    const m = new THREE.Mesh(p.lmGeo || landmarkGeo(form), mat);
    m.castShadow = m.receiveShadow = true;
    /* Standing on the town's own axis, at the centre, so it is the thing the
       camera lands on when a landmark town is flown to.
       lift = -size/2, and it is not optional: standMatrix centres a UNIT BOX,
       so it lifts by half the height, and every geometry in landmarkGeo() is
       already modelled standing on y = 0. With the two together the first
       street capture had the workshop hanging a full storey over the town. */
    m.applyMatrix4(standMatrix(p, p.frame, 0, 0, foot.yaw,
                               size, size, size, -size / 2));
    m.name = 'landmark:' + p.town.name;
    p.form = form;
    p.formWords = TRADE_WORDS[form] || null;
    scene.add(m); landmarkMeshes.push(m); n++;
  }
  plan.landmarkScans = scanned;
  return n;
}

/** A plaque on a mast: the town's name, and its favicon when the server has one.
    Only cities, towns and landmark villages get one — a name on all 142 is a
    map you cannot read, which the island already proved once. */
function buildSigns() {
  for (const p of plan.placed) {
    if (!(p.cls === 'city' || p.cls === 'town' || p.form)) continue;
    const spr = signSprite(p);
    if (spr) { scene.add(spr); signSprites.push(spr); p.sign = spr; }
  }
  if (p_logoQueue.length) loadLogos();
  return signSprites.length;
}

const p_logoQueue = [];

function signSprite(p) {
  const label = p.town.name || p.town.id;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '500 44px "JetBrains Mono", monospace';
  ctx.font = font;
  /* The plaque is as WIDE AS ITS NAME. A fixed canvas made a four-letter town's
     sign the same hoarding as an eighteen-letter one, and the overlap cull then
     threw most of the map's names away — the island's own recorded failure. */
  const w = Math.ceil(ctx.measureText(label).width) + 56;
  c.width = Math.max(96, w); c.height = 128;
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = 'rgba(10,9,14,0.62)';
  g.fillRect(0, 40, c.width, 64);
  g.fillStyle = '#e9e1d2';
  g.textBaseline = 'middle';
  g.fillText(label, 28, 74);
  g.fillStyle = '#d2a62c';
  g.fillRect(0, 40, 5, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: t, transparent: true,
                                         depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(mat);
  /* NO fog and NO depth test on a sign, for the island's reason: a place name is
     drawn ON a map, and a hillside between the lens and a town ate the left half
     of that town's plaque when it was depth-tested. */
  s.renderOrder = 8;
  const h = p.cls === 'city' ? 34 : p.cls === 'town' ? 26 : 20;
  s.position.copy(p.axis).multiplyScalar(R + p.elev + h);
  s.userData = { place: p, aspect: c.width / c.height, canvas: c, label };
  if (p.town.logo && p.town.logo.url) p_logoQueue.push({ p, s, canvas: c, label });
  return s;
}

/** The favicon the server found for a project, drawn on to the plaque it
    already has. Async and best-effort: a logo that 404s leaves the name.

    FETCHED RATHER THAN ASSIGNED TO `img.src`, and that is the whole reason this
    is not three lines. `/api/project/asset` answers **403 forbidden** for a
    path it will not resolve — a logo the world scan recorded and that has since
    been moved, renamed or deleted under the project root — and a resource load
    (`<img src>`) writes `Failed to load resource: … 403 (forbidden)` into the
    console no matter what handlers it carries. That was the intermittent error
    on roughly one globe load in six (docs/TESTS.md I2); it is the only request
    this page makes that can 403 at all. A `fetch` that comes back 403 resolves
    normally with `ok:false` and logs nothing, so the plaque falls back to the
    plain name in silence, exactly as it already did. */
function loadLogos() {
  for (const job of p_logoQueue.splice(0)) {
    const img = new Image();
    let objectUrl = null;
    fetch(job.p.town.logo.url, { cache: 'force-cache' })
      .then(r => (r.ok ? r.blob() : null))
      .then(b => { if (b) { objectUrl = URL.createObjectURL(b); img.src = objectUrl; } })
      .catch(() => { /* offline or aborted: the plain plaque stands */ });
    img.onload = () => {
      try {
        const c = job.canvas, g = c.getContext('2d');
        const pad = 8, side = 44;
        const nc = document.createElement('canvas');
        nc.width = c.width + side + pad; nc.height = c.height;
        const n = nc.getContext('2d');
        n.drawImage(c, side + pad, 0);
        n.fillStyle = 'rgba(10,9,14,0.62)';
        n.fillRect(0, 40, side + pad, 64);
        n.drawImage(img, 4, 50, 44, 44);
        const t = new THREE.CanvasTexture(nc);
        t.colorSpace = THREE.SRGBColorSpace;
        job.s.material.map.dispose();
        job.s.material.map = t;
        job.s.material.needsUpdate = true;
        job.s.userData.aspect = nc.width / nc.height;
      } catch (e) { /* a tainted or broken favicon leaves the plain plaque */ }
      /* The blob is on the canvas now; 145 towns' worth of them would otherwise
         stay in memory for the life of the page. */
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    };
  }
}

/* =============================================================================
   THE VAULT CONTINENT'S FIVE REGIONS
   Wissenberg is the only continent whose geography is not a settlement pattern
   but a set of NAMED places: the island put Knowledge on a mountain, Dev Logs
   in a valley, Daily along a river, People in a hill village and Boards behind
   a fortress wall, and vaultRelief() above cuts those five landforms into this
   sphere. This is the part that makes them findable — a plaque on each, with
   the real note count out of data/vault.json under it, and a search entry so
   "Dev Logs" flies there.

   The 432 notes THEMSELVES are still the island's: a double-click on the vault
   hands over to world.html?focus=vault. Putting 432 note-buildings on the globe
   is the next pass, and it is written up as such in docs/HANDOFF.md rather than
   half-built here.
   ========================================================================== */
const regionSprites = [];
function buildVaultRegions() {
  const notes = (vault && vault.notes) || [];
  const count = f => notes.filter(n => (n.folder || '') === f).length;
  const counts = { knowledge: count('Knowledge'), devlogs: count('Dev Logs'),
                   daily: count('Daily'), people: count('People'),
                   boards: count('Boards') + count('Tasks') };
  for (const rg of VAULT_REGIONS) {
    const n = counts[rg.key] || 0;
    const label = `${rg.label} · ${n}`;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = '400 40px "JetBrains Mono", monospace';
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(label).width) + 48; c.height = 128;
    const g = c.getContext('2d');
    g.font = font;
    g.fillStyle = 'rgba(10,9,14,0.55)'; g.fillRect(0, 44, c.width, 56);
    g.fillStyle = '#6fa8b8'; g.fillRect(0, 44, 4, 56);
    g.fillStyle = '#cfe6ec'; g.textBaseline = 'middle';
    g.fillText(label, 24, 74);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true,
                                                            depthTest: false }));
    spr.renderOrder = 7;
    const elev = elevAt(rg.axis);
    spr.position.copy(rg.axis).multiplyScalar(R + Math.max(2, elev) + 30);
    spr.userData = { region: rg, aspect: c.width / c.height };
    rg.sprite = spr; rg.elev = elev; rg.notes = n;
    scene.add(spr); regionSprites.push(spr);
  }
  return regionSprites.length;
}



/* =============================================================================
   THE VAULT'S NOTES, ON THE PLANET

   The five landforms were already cut into the terrain by vaultRelief() — the
   Knowledge mountain, the Dev Logs valley, the Daily river, the People hill and
   the Boards bluff — and the notes themselves were still being drawn on the
   island. This puts them where their landforms are: one small building per
   note, standing on the region its folder belongs to, hover for its title and
   its real word and inlink counts, double-click to open it.

   WHY a building and not a marker: a marker on a mountain is a pin in a map,
   and this planet's whole argument is that the work is a PLACE. A note is a
   small stone house on the Knowledge mountain; four hundred of them are a town
   climbing it.

   Every note that is not in one of the five folders goes to Dev Logs, which is
   where the loose working notes are — 64 Projects notes, 7 Templates and the
   handful of unfiled ones. Stated rather than silently dropped, because the
   count on each plaque has to add up to the vault's own total.
   ========================================================================== */
const NOTE_FOLDER = {
  'Knowledge': 'knowledge', 'Dev Logs': 'devlogs', 'Daily': 'daily',
  'People': 'people', 'Boards': 'boards', 'Tasks': 'boards',
};
/* The catalogue entries a note is built from, by region. A Knowledge note is a
   stone townhouse; a daily is a whitewashed cottage; a board is a civic block. */
const NOTE_TYPE = { knowledge: 2, devlogs: 3, daily: 0, people: 1, boards: 5 };
const noteMarks = [];              // { note, region, axis, centre, elev }

/** Where every note stands. A sunflower spiral on the region's own axis, for
    the same reason planPlanet() uses one for the settlements: a hash scatter
    puts three notes on one spot and leaves a quarter of the hill empty, and the
    golden angle is the one arrangement that is even at every count. */
function buildVaultNotes() {
  const notes = (vault && vault.notes) || [];
  if (!notes.length) return 0;
  const byRegion = new Map(VAULT_REGIONS.map(rg => [rg.key, []]));
  for (const n of notes) {
    const key = NOTE_FOLDER[n.folder || ''] || 'devlogs';
    byRegion.get(key).push(n);
  }

  const byType = new Map();
  for (const rg of VAULT_REGIONS) {
    const list = byRegion.get(rg.key);
    if (!list.length) continue;
    /* Biggest first, so the most linked note stands at the top of its own hill
       — the same rule that puts a capital in the middle of a continent. */
    list.sort((a, b) => (b.inlinks || 0) - (a.inlinks || 0));
    /* The region's own footprint in degrees. The mountain is steep and small,
       the valley is long, the bluff is flat: these are the radii vaultRelief()
       shapes the ground over, so the notes land on the landform and not beside
       it. */
    const spread = rg.kind === 'mountain' ? 5.2 : rg.kind === 'river' ? 6.2
                 : rg.kind === 'fortress' ? 3.0 : 5.0;
    const golden = 2.39996323;
    list.forEach((n, i) => {
      const rho = spread * Math.sqrt((i + 0.5) / list.length);
      const bearing = (i * golden) / DEG + (hash32(n.id) % 360);
      const axis = offsetFrom(rg.axis, rho, bearing);
      const elev = elevAt(axis);
      const mark = { note: n, region: rg, axis, elev,
                     centre: axis.clone().multiplyScalar(R + elev) };
      noteMarks.push(mark);
      const type = NOTE_TYPE[rg.key];
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(mark);
    });
  }

  const grp = new THREE.Group();
  grp.name = 'vault-notes';
  for (const [type, list] of byType) {
    const spec = CATALOGUE[type];
    const g = kit.instanced(list.map(m => ({
      ...spec, position: [0, 0, 0], rotationY: 0, lod: 1,
      seed: hash32(m.note.id) })));
    const body = g.children[0], roof = g.children[1] || null;
    body.frustumCulled = false;
    if (roof) roof.frustumCulled = false;
    const H = kitHeight(type);
    list.forEach((m, i) => {
      const fr = frameAt(m.axis, hash32(m.note.id) % 360);
      /* A note's own site, so instMatrix can place it exactly the way a
         building in a settlement is placed. */
      const site = { axis: m.axis, elev: m.elev, frame: fr };
      /* WORDS SET THE HEIGHT. A forty-word stub is one storey and a two
         thousand word essay is five, which makes the shape of the vault
         readable from the air without a single label: the Knowledge mountain
         has towers on it and the Daily river has cottages along it. */
      const floors = clamp(1 + Math.round(Math.log10(1 + (m.note.words || 0)) * 1.5), 1, 6);
      const h = H * floors / spec.floors;
      m.height = h;
      body.setMatrixAt(i, instMatrix(site, fr, 0, 0, 0,
                                     spec.footprint[0] * 0.45, h, spec.footprint[1] * 0.45));
      if (roof) {
        roof.setMatrixAt(i, instMatrix(site, fr, 0, 0, 0,
                                       spec.footprint[0] * 0.45 + ROOF_EAVE, 1,
                                       spec.footprint[1] * 0.45 + ROOF_EAVE, h));
      }
    });
    body.instanceMatrix.needsUpdate = true;
    if (roof) roof.instanceMatrix.needsUpdate = true;
    grp.add(g);
  }
  scene.add(grp);
  return noteMarks.length;
}

/** The note under the cursor, or null. Screen-space, the same as pickAt(): 437
    projections is nothing, and a raycast against instanced meshes needs a
    bounding sphere that this file would have to remember to invalidate. Only
    tested when the camera is actually over the vault continent, because
    everywhere else it is 437 projections for a guaranteed miss. */
function noteAt(px, py) {
  if (!noteMarks.length) return null;
  const vaultC = CONTINENTS.find(c => c.key === 'knowledge');
  const camDir = camera.position.clone().normalize();
  if (angDist(camDir, vaultC.axis) > vaultC.r * 1.4) return null;
  /* Notes are small. They are only pickable once they are big enough to aim
     at — which is also the altitude at which they stop being one grey mass. */
  if (cam.dist - R > 420) return null;
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);
  const v = new THREE.Vector3();
  let best = null, bd = 26 * 26;
  for (const m of noteMarks) {
    if (m.axis.dot(camDir) < horizon * 0.999) continue;
    v.copy(m.centre).project(camera);
    if (v.z > 1) continue;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}


/** The region plaques take the same pixel solve and the same horizon cull the
    town signs do; they are a separate pass only because they are not places you
    can walk into, so they never take part in the town-name overlap contest. */
function updateRegionSigns() {
  const H = window.innerHeight, fovRad = camera.fov * DEG;
  const camDir = camera.position.clone().normalize();
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);
  for (const s of regionSprites) {
    const rg = s.userData.region;
    if (rg.axis.dot(camDir) < horizon * 0.999) { s.visible = false; continue; }
    const d = camera.position.distanceTo(s.position);
    if (d > 5200) { s.visible = false; continue; }
    const worldPerPx = 2 * Math.tan(fovRad / 2) * d / H;
    const scaleY = Math.min(19 * worldPerPx * (128 / 40), 110);
    s.scale.set(scaleY * s.userData.aspect, scaleY, 1);
    s.visible = true;
  }
}

/** Signs are world-space sprites, so their pixel size depends on where the
    camera is standing. Solved every frame to a constant cap height, hidden
    below the floor rather than drawn as a smudge — the island's SIGN_MIN_CAP_PX
    rule, kept. */
/* 21, not 18. The acceptance run read minCapPx exactly 18 against a gate of 18
   — no margin at all, and one more plaque competing for the same solve starts
   failing the row. The target is what a plaque is SOLVED to, so raising it
   raises the floor by the same amount; the ceiling (SIGN_MAX_WORLD_H) is what
   would claw it back, and at 96 world units nothing on the planet reaches it
   from orbit. */
const SIGN_CAP_TARGET = 21, SIGN_MIN_CAP_PX = 13, SIGN_MAX_WORLD_H = 96;
const _sv = new THREE.Vector3();
/** Solve every plaque to a constant cap height in PIXELS, drop the ones the
    horizon hides, and then drop the ones that would land on top of a plaque
    already placed. Three separate culls and all three are needed: the pixel
    solve is what makes a name legible from orbit AND from a street, the horizon
    is what three does not know about a sphere, and the overlap is why the first
    capture read "takt-robotik" and "musikschule" as one word. */
function updateSigns() {
  const H = window.innerHeight, W = window.innerWidth;
  const fovRad = camera.fov * DEG;
  const camDir = camera.position.clone().normalize();
  /* A surface point is over the horizon when the angle between its direction
     and the camera's is wider than the tangent cone, whose COSINE is R/D. The
     first build used sqrt(1-(R/D)^2) — the SINE of that same angle — which at
     orbit hid everything more than 18 degrees from the point under the lens:
     17 of 19 signs culled, and nothing pickable outside the middle of frame. */
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);

  const cands = [];
  for (const s of signSprites) {
    const p = s.userData.place;
    s.visible = false;
    if (p.axis.dot(camDir) < horizon * 0.999) continue;
    const lift = (p.cls === 'city' ? 34 : p.cls === 'town' ? 26 : 20);
    s.position.copy(p.axis).multiplyScalar(R + p.elev + lift);
    const d = camera.position.distanceTo(s.position);
    if (d > 5200) continue;
    const worldPerPx = 2 * Math.tan(fovRad / 2) * d / H;
    const want = SIGN_CAP_TARGET * worldPerPx * (128 / 44);
    const scaleY = Math.min(want, SIGN_MAX_WORLD_H);
    /* A plaque whose solve ran into the ceiling cannot reach the floor, and
       drawing it anyway is the smudge this rule exists to remove. */
    const capPx = SIGN_CAP_TARGET * (scaleY / want);
    if (capPx < SIGN_MIN_CAP_PX) continue;
    s.scale.set(scaleY * s.userData.aspect, scaleY, 1);
    _sv.copy(s.position).project(camera);
    if (_sv.z > 1) continue;
    const px = (_sv.x * 0.5 + 0.5) * W, py = (-_sv.y * 0.5 + 0.5) * H;
    const hpx = scaleY / worldPerPx, wpx = hpx * s.userData.aspect;
    if (px < -wpx || px > W + wpx || py < -hpx || py > H + hpx) continue;
    /* A city outranks a town outranks a landmark village, and inside a class
       the busier project wins the space. Rank, not draw order, decides who is
       still on the map when two names want the same pixels. */
    const rank = (p.cls === 'city' ? 0 : p.cls === 'town' ? 1 : 2) * 1e9
               - (p.town.tool_calls || 0);
    cands.push({ s, rank, x: px, y: py, w: wpx * 0.5, h: hpx * 0.30, capPx });
  }
  cands.sort((a, b) => a.rank - b.rank);

  const kept = [];
  let minCap = 999;
  for (const c of cands) {
    let clash = false;
    for (const k of kept) {
      if (Math.abs(c.x - k.x) < (c.w + k.w) && Math.abs(c.y - k.y) < (c.h + k.h)) {
        clash = true; break;
      }
    }
    if (clash) continue;
    c.s.visible = true; kept.push(c); minCap = Math.min(minCap, c.capPx);
  }
  return { visible: kept.length, culled: signSprites.length - kept.length,
           minCapPx: kept.length ? +minCap.toFixed(1) : 0, capTarget: SIGN_CAP_TARGET };
}


/* =============================================================================
   LIVE WEATHER AND LIVE CRAFT
   A town that is working right now gets its own weather — a thicker patch of
   cloud over it — and one drone per agent in flight, carrying that agent's own
   task label. Both are rebuilt on the stream, not on a timer.
   ========================================================================== */
let liveGroup = null;
const droneStates = [];

function rebuildLive() {
  /* THE CRAFT ARE DISPOSED THROUGH THE KIT, not with the group: their geometry
     and materials are the kit's own and shared by every craft of that variant,
     so disposeTree() on the group would free the airframe the whole fleet
     wears. Everything else in liveGroup — the weather puffs, the tags — is this
     file's and goes with it. */
  for (const d of droneStates) disposeCraft(d);
  droneStates.length = 0;
  if (liveGroup) { scene.remove(liveGroup); disposeTree(liveGroup); }
  liveGroup = new THREE.Group();
  liveGroup.name = 'live';
  if (droneKit) buildDroneTrails();

  for (const p of plan.placed) {
    if (!p.town.is_live) continue;

    /* THE WEATHER OVER A LIVE TOWN. A disc of cloud on the deck's own shell,
       turned to face outward, dense in the middle. This is the one piece of
       weather on the planet that is not noise: it means work. */
    /* 1.3, not 2.4, and a uFade that takes it away below map altitude. This
       puff is the white blob that swallowed the right half of every region
       capture: at 2.4 x a town's own 3.3 degrees it is 166 units across, and a
       region frame is about 150. Weather over a town is a MAP symbol — it says
       "somebody is working here" from orbit — and from 200 units up it is a
       wall of fog between the lens and the thing it is pointing at. */
    const puff = new THREE.Mesh(new THREE.CircleGeometry(p.deg * UNITS_PER_DEG * 1.3, 26),
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) },
                    uAxis: { value: p.axis.clone() }, uT: { value: 0 },
                    uFade: { value: 1 } },
        vertexShader: `varying vec2 vUv; varying vec3 vW;
          void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `
          uniform vec3 uSun, uAxis; uniform float uT, uFade;
          varying vec2 vUv; varying vec3 vW;
          void main(){
            vec2 d = vUv - 0.5;
            float r = length(d) * 2.0;
            /* 0.86/0.14, not 0.62/0.38. At 0.38 the four lobes made a
               four-bladed propeller sitting over the town — read straight off
               the first continent capture. Weather is round with a ragged
               edge, not a rotor. */
            float lobes = 0.86 + 0.14 * sin(atan(d.y, d.x) * 5.0 + uT * 0.4);
            float a = smoothstep(1.0, 0.30, r / lobes) * uFade;
            if (a < 0.01) discard;
            float lit = clamp(dot(uAxis, uSun) * 1.2 + 0.2, 0.0, 1.0);
            vec3 col = mix(vec3(0.34,0.36,0.44), vec3(1.0,0.97,0.92), lit);
            gl_FragColor = vec4(col, a * 0.26);
          }`,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
    puff.position.copy(p.axis).multiplyScalar(R_CLOUD + 4);
    puff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.axis);
    puff.renderOrder = 2;
    liveGroup.add(puff);

    /* THE FLEET: one ORNIS craft per agent in flight, each carrying its own
       task label. The count is the server's live_agents, never a guess, and the
       VARIANT is the tool that agent has open — see droneVariant(). */
    if (!DRONES_OFF) (p.town.live_agents || []).forEach((ag, i) => makeCraft(p, ag, i));
  }
  scene.add(liveGroup);
  rebuildLiveRoads();
  refreshCounts();
  /* setLiveAgents on the SAME TICK the agent list changes — integration note 4:
     it re-targets every robot, rebuilds their tag canvases and decides which of
     them flies a drone. */
  pushLiveAgentsToLife();
}

function taskTag(text) {
  const s = String(text).slice(0, 42);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = '400 30px "JetBrains Mono", monospace';
  c.width = Math.ceil(ctx.measureText(s).width) + 28; c.height = 52;
  const g = c.getContext('2d');
  g.font = '400 30px "JetBrains Mono", monospace';
  g.fillStyle = 'rgba(8,7,12,0.72)'; g.fillRect(0, 8, c.width, 36);
  g.fillStyle = '#d2a62c'; g.textBaseline = 'middle';
  g.fillText(s, 14, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true,
                                                          depthTest: false }));
  spr.renderOrder = 9;
  spr.userData.aspect = c.width / c.height;
  return spr;
}

/* =============================================================================
   THE TANGENT STAGE — how a flat-world module stands on a round planet
   <!-- GLOBE-STAGE-DOC -->

   life.js and drones.js were both written against a FLAT world: `getHeight` is
   `(x, z) => y`, a pavement graph is a set of (x, y, z) points, and a bird's sky
   box is an axis-aligned box. None of that has a meaning on a sphere, and the
   answer is not to bend those modules — it is to give them a piece of flat world
   to stand on.

   `stage` is one Group whose matrix is a settlement's own tangent frame:
   x = east, y = up (the settlement's axis), z = MINUS north. The minus is not a
   typo and it is not cosmetic: `east CROSS up` is minus `north` on this frame
   (placeMatrix's own basis says so), so (east, up, north) is LEFT-handed, and a
   left-handed basis handed to makeBasis() mirrors every model in it and flips
   every winding. (east, up, -north) is right-handed, so local +Z is south.

   Everything life.js is given is in those metres, and life.group is parented to
   the stage, so one matrix turns a walking crowd into a walking crowd on a
   planet. `Globe.localToWorld()` is the same conversion for anyone outside.

   WHY ONE STAGE AND NOT THREE. The brief asks for the settlement under the
   camera and its neighbours within ~600 m. On this planet 600 units is 57
   degrees of arc: the sagitta of a 600-unit chord on a 600-unit radius is 300
   units, so a single tangent plane covering that neighbourhood would have its
   edges three hundred metres in the air. There is no flat world that size here.
   The stage therefore follows the settlement the camera is actually in, with
   hysteresis, and that is the honest version of the same idea. See
   docs/HANDOFF.md, "What round 4 does NOT do".
   ========================================================================== */

let stage = null;                 // the Group life.js lives inside
let stagePlace = null;            // the settlement it is pinned to
let stageWantedAt = 0;            // when the camera first wanted a different one
let stageWanted = null;
let lifeCam = null;               // the real camera, expressed in stage metres
let lifeCounted = null;           // the counts the current settlement was given
let lifePool = null;              // what populate() was sized for, once
let lifePropPool = null;          // and the per-type prop ceiling it was sized for
const lifeReserve = { people: [], cars: [], grazers: [], parrots: [], dogs: [] };

/* THE HEIGHT GRID, and it is a performance decision with a number behind it.
   life.js calls `getHeight` once per actor per frame — about 200 calls at the
   caps below. `elevAt()` is two ridged-noise stacks, a river term and a
   settlement-pad scan, measured at ~20 us a call when the forest was built
   (30,000 samples, 0.6 s): 200 of those is 4 ms a frame, a quarter of a 60 fps
   budget, spent on ground that is FLAT by construction inside a settlement pad.
   So the pad is sampled once on a grid when the stage moves and read back
   bilinearly, which is a handful of multiplies. */
const STAGE_GRID = 33;
let stageGrid = null, stageHalf = 1, stageStep = 1;

function buildStageGrid(p) {
  /* 1.45 of the radius: the lanes run to 1.16 and a car leaving town, a bird
     and the pasture fence all sit outside that. */
  stageHalf = p.radius * 1.45;
  stageStep = (stageHalf * 2) / (STAGE_GRID - 1);
  stageGrid = new Float32Array(STAGE_GRID * STAGE_GRID);
  const up = p.frame.up, origin = p.axis.clone().multiplyScalar(R + p.elev);
  const d = new THREE.Vector3();
  for (let j = 0; j < STAGE_GRID; j++) {
    const oz = -(-stageHalf + j * stageStep);          // local +z is south
    for (let i = 0; i < STAGE_GRID; i++) {
      const ox = -stageHalf + i * stageStep;
      d.copy(p.axis).addScaledVector(p.frame.east, ox / R)
                    .addScaledVector(p.frame.north, oz / R).normalize();
      const h = Math.max(0.15, elevAt(d));
      stageGrid[j * STAGE_GRID + i] = d.multiplyScalar(R + h).sub(origin).dot(up);
    }
  }
}

/** The ground under a point on the stage, in stage metres. Bilinear, clamped at
    the edge — a car that drives off the grid stands on the last row rather than
    falling through the planet. */
function stageHeight(x, z) {
  if (!stageGrid) return 0;
  const fx = clamp((x + stageHalf) / stageStep, 0, STAGE_GRID - 1.001);
  const fz = clamp((z + stageHalf) / stageStep, 0, STAGE_GRID - 1.001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const g = stageGrid, N = STAGE_GRID;
  const a = g[j * N + i], b = g[j * N + i + 1];
  const c = g[(j + 1) * N + i], e = g[(j + 1) * N + i + 1];
  return mix(mix(a, b, tx), mix(c, e, tx), tz);
}

/** Aim the stage at one settlement. Everything in stage metres is (ox, -oz) of
    the settlement's own (east, north) plan coordinates. */
function aimStage(p) {
  buildStageGrid(p);
  stage.matrix.makeBasis(p.frame.east, p.frame.up, p.frame.north.clone().negate());
  stage.matrix.setPosition(p.axis.clone().multiplyScalar(R + p.elev));
  stage.matrixWorldNeedsUpdate = true;
  stagePlace = p;
}


/* =============================================================================
   THE COUNTS — every number here is a count of something that happened

   The module can never invent a population (docs/LIFE.md's own first decision),
   so this is where the planet's real data becomes people, traffic and herds.
   Nothing below is tuned to look busy; the caps exist because a frame has a
   budget, and they are applied AFTER the data has spoken so the ratio between
   two settlements survives them.
   ========================================================================== */
const LIFE_MAX_SKINNED = 24;      // the brief's gate; the doc's default is 40
const LIFE_RIGID = 3;             // 8 -> 3, the cheapest single lever, ~0.25 M triangles
/* ONE RESIDENT PER SESSION, and the rule is that plain on purpose: a session is
   somebody arriving to work in that project, so a village of 26 sessions is a
   village of 26 people. The first version divided by five on top of a 40-session
   cap and a real village came back with ONE person in it — true of the
   arithmetic and false about the place. The CLASS cap below is what keeps a
   341-session project from being a crowd its own eleven houses cannot hold. */
const LIFE_PER_CAR = 6;           // link weight per vehicle on the lanes
const LIFE_NOTES_PER_BIRD = 24;   // vault notes per bird over one settlement
const DORMANT_DAYS = 30, DORMANT_OLD_DAYS = 120;

/* Per CLASS, because a hamlet with a busy project's session count is still a
   hamlet: eleven houses cannot hold a hundred and ten people, and a crowd
   bigger than the place it stands in is the one thing that reads as fake
   immediately. */
const LIFE_CLASS_CAP = {
  city:    { humans: 120, cars: 26 },
  town:    { humans:  70, cars: 16 },
  village: { humans:  34, cars:  9 },
  hamlet:  { humans:  14, cars:  4 },
  fields:  { humans:   0, cars:  2 },
};
/* Per QUALITY, on top. Medium is half of high for the reason the LOD0 budget
   is: the auto-degrade drops to medium to save a machine, and a layer that
   ignored it would defeat it. */
const LIFE_Q = { high: 1, medium: 0.5, low: 0.25 };

/* PARROTS are opt-in and off by default. `aviary_projects` in config.json is
   a regular expression; every project whose path or name matches it gets a
   small flock over its rooftops. Empty (the shipped default) means no bird
   ever appears, which is why lifeCountsFor() below can ask for it flatly. */
const AVIARY_RE = (() => {
  try { return CFG.aviary_projects ? new RegExp(CFG.aviary_projects, 'i') : null; }
  catch (e) { console.warn('config.json: aviary_projects is not a valid regex', e); return null; }
})();
const isAviary = t => !!AVIARY_RE && AVIARY_RE.test((t.path || '') + ' ' + (t.name || ''));
function townIdleDays(t) {
  const ms = Date.parse(t.last_active || '');
  return isFinite(ms) ? (Date.now() - ms) / 86400000 : Infinity;
}

/** What one settlement's own data says stands in it. */
function lifeCountsFor(p) {
  const t = p.town;
  const cap = LIFE_CLASS_CAP[p.cls] || LIFE_CLASS_CAP.hamlet;
  const q = LIFE_Q[quality] || 0.5;
  /* RESIDENTS = f(SESSIONS), one each, capped by what the settlement can hold. */
  const humans = t.sessions || 0;
  /* TRAFFIC = f(LINK WEIGHT). The land roads only: a shipping lane arcs 22
     units over the water and is not a surface anything can drive on. */
  let weight = 0;
  for (const r of (plan.roads || [])) {
    if (r.sea) continue;
    if (r.a === p || r.b === p) weight += r.weight || 0;
  }
  /* HERDS ON FIELDS. A `fields` settlement IS a dormant project, so the herd is
     not a decoration on it — it is the same fact drawn twice. Asleep one to four
     months is sheep; longer than that is cattle out on the far parcels. */
  let sheep = 0, cows = 0;
  if (p.cls === 'fields') {
    const idle = townIdleDays(t);
    /* A HERD, not a token. Six to fourteen head, from how much work the project
       had in it before it was shut: four parcels of ploughed ground with two
       sheep on them reads as a mistake, not as a farm. */
    const n = clamp(Math.round(6 + (t.sessions || 0) / 3), 6, 14);
    if (idle <= DORMANT_OLD_DAYS) sheep = n; else cows = Math.max(5, Math.round(n * 0.7));
  }
  return {
    humans: Math.round(Math.min(humans, cap.humans) * q),
    cars:   Math.round(Math.min(Math.round(weight / LIFE_PER_CAR), cap.cars) * q),
    sheep:  Math.round(sheep * q), cows: Math.round(cows * q),
    /* BIRDS from the vault's own note count, over every settlement equally —
       birds belong to the planet, not to a project. */
    birds:  Math.max(4, Math.round(((vault && vault.notes ? vault.notes.length : 0) /
                                    LIFE_NOTES_PER_BIRD) * q)),
    /* PARROTS ONLY ON AN AVIARY PROJECT. Two pairs, and a pair is the unit: life.js
       binds every odd parrot to the one before it, so an odd number leaves one
       bird flying with a mate index of -1. */
    parrots: isAviary(t) ? 4 : 0,
    /* ROBOTS 0 BY DEFAULT and there is no case here that justifies one. A robot
       in life.js is what an agent drives, and on this planet an agent flies an
       ORNIS craft — a robot walking under the drone that already represents it
       would be the same agent counted twice. */
    robots: 0,
  };
}

/** The high-water mark over the whole planet: what populate() is sized for,
    ONCE. life.js's crowds and instanced meshes are sized on the first
    populate() and grow no further, so the pool is the maximum any single
    settlement can ask for and the per-settlement counts are reached by putting
    the surplus in reserve — see setPopulation(). */
function lifePoolCounts() {
  const out = { humans: 0, cars: 0, sheep: 0, cows: 0, birds: 0, parrots: 0 };
  for (const p of plan.placed) {
    const c = lifeCountsFor(p);
    for (const k in out) out[k] = Math.max(out[k], c[k] || 0);
  }
  return out;
}


/* =============================================================================
   THE GRAPH — the lanes that are DRAWN are the lanes that are WALKED

   Every polyline below is read straight out of the same `plan` the settlement's
   ribbons are built from, so a car is on the carriageway that is on the screen
   and a walker's front door is a door that exists. Nothing here re-derives a
   position; that is the whole reason round 3 published these seams.
   ========================================================================== */

/* The stage's own metres: plan (ox, oz) -> stage (x, z). One place, because two
   copies of a sign flip is a class of bug that is invisible until a whole
   village is mirrored. */
const sx = ox => ox;
const sz = oz => -oz;

/** The carriageways: this settlement's own lanes, plus the land arcs of every
    road that arrives here, clipped to the stage. Each carries its real weight,
    which is the ONLY thing that decides how much traffic it gets. */
function lifeRoadsFor(p) {
  const out = [];
  for (const L of (p.lanes || [])) {
    if (!L.pts || L.pts.length < 2) continue;
    const pts = L.pts.map(([ox, oz]) => [sx(ox), stageHeight(sx(ox), sz(oz)) + 0.06, sz(oz)]);
    /* A lane's own weight is the settlement's traffic sharing itself out: the
       main spokes carry more than the rings, which is what a village's traffic
       actually does. */
    out.push(Object.assign(pts, { weight: L.main ? 3 : L.ring ? 1 : 2 }));
  }
  /* THE ROADS THAT ARRIVE. `roadsFor` gives world points; the first stretch of
     each is inside the stage, and a car appearing out of the country and turning
     into the square is what makes a settlement look connected rather than
     sealed. `sea: true` arcs are refused — nothing drives over the water. */
  const origin = p.axis.clone().multiplyScalar(R + p.elev);
  const inv = new THREE.Matrix4().makeBasis(p.frame.east, p.frame.up,
                                            p.frame.north.clone().negate()).invert();
  for (const r of Globe.roadsFor(p.town.id)) {
    if (r.sea) continue;
    const pts = [];
    for (const w of r.points) {
      const v = w.clone().sub(origin).applyMatrix4(inv);
      if (Math.abs(v.x) > stageHalf || Math.abs(v.z) > stageHalf) break;
      pts.push([v.x, stageHeight(v.x, v.z) + 0.06, v.z]);
    }
    if (pts.length > 1) out.push(Object.assign(pts, { weight: Math.max(1, r.weight || 1) }));
  }
  return out;
}

/** The pavements. A settlement's lanes ARE its pavements here — a village lane
    has no kerb — plus one stub from every lot's door, which life.js reads as a
    DOOR because it is a node with a single link, and which is a door. */
function lifeWalkwaysFor(p) {
  const out = [];
  for (const L of (p.lanes || [])) {
    if (!L.pts || L.pts.length < 2) continue;
    out.push(L.pts.map(([ox, oz]) => [sx(ox), stageHeight(sx(ox), sz(oz)) + 0.05, sz(oz)]));
  }
  for (const b of (p.lots || [])) {
    if (!b.door) continue;
    /* From the door on the lane to the front wall, which is exactly the path
       ribbon settlementSurfaces() already draws for this lot. */
    const a = [sx(b.door[0]), 0, sz(b.door[1])];
    const c = [sx(b.ox), 0, sz(b.oz)];
    a[1] = stageHeight(a[0], a[2]) + 0.05;
    c[1] = stageHeight(c[0], c[2]) + 0.05;
    if (Math.hypot(c[0] - a[0], c[2] - a[2]) > 1.2) out.push([a, c]);
  }
  return out;
}

/** The square, with benches round its rim. The bench positions are this file's
    (the plan does not place furniture) but the SQUARE is the plan's own plaza,
    so nobody sits in a field. */
/** The part of the square that is FREE — centre and radius, in stage metres.
    Called twice and that is the point: lifePlazaFor() hands it to life.js as
    the plaza the furniture is placed on, and planBuildings() reserves the same
    ground before it hands out a single lot, so no lot can be planned on top of
    a fountain. Two derivations of "where the props go" would drift the first
    time either changed. */
function plazaFreeRim(p) {
  const r0 = (p.plaza && p.plaza.r) || 0;
  const lf = landmarkFootprint(p);
  if (r0 && lf) {
    const near = lf.d / 2 + LM_APRON * 0.5;    // the far wall, plus a walkable strip
    /* A rim under 2 m holds nothing, and there is no such settlement on this
       planet now that the plaza grows to LM_APRON past the landmark's corner —
       the guard is here so a future landmark that is all depth and no width
       degrades to the old square rather than to a fountain in a wall. */
    if (r0 - near >= 2.0) return { cx: 0, cz: (near + r0) / 2, r: (r0 - near) / 2 };
  }
  return { cx: 0, cz: 0, r: r0 };
}

/** The outer reach of any prop on that rim: life.js's `_plazaProps` puts the
    playground at 0.6 of the radius and nothing further out, and LOT_GAP is the
    daylight every footprint on this planet keeps. */
const plazaPropReach = rim => rim.r * 0.6 + LOT_GAP;

function lifePlazaFor(p) {
  if (!p.plaza || !p.plaza.r) return [];
  /* THE FURNITURE STANDS BESIDE THE LANDMARK, NEVER INSIDE IT. life.js puts the
     fountain on the plaza's CENTRE and the café tables and the playground on a
     ring at 0.55 / 0.6 of its radius (`_plazaProps`), and on a square with a
     landmark on it the centre IS the building — a fountain inside a hotel is
     the same defect as a cottage inside one. life.js is not this file's to
     change and does not need to be: the square handed to it is the free RIM,
     the annulus between the landmark's footprint and the plaza edge, which is
     ground the lot planner has already kept clear of every building.
     The offset runs along local +Z because that is the landmark's FRONT — every
     scan in this pack is modelled facing +Z and landmarkScan() places it at
     yaw 0 for exactly that reason — so the fountain ends up in front of the
     building and not behind it.
     The PAVING disc is untouched: it is still centred on the town and still
     p.plaza.r across, which is why the rim the furniture moves onto is paved. */
  const rim = plazaFreeRim(p);
  const cx = rim.cx, cz = rim.cz, rr = rim.r;
  const seats = [];
  const n = p.cls === 'city' ? 8 : p.cls === 'town' ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const r = rr * 0.72;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    seats.push([x, stageHeight(x, z) + 0.05, z, Math.atan2(cx - x, cz - z)]);
  }
  return [{ center: [cx, stageHeight(cx, cz) + 0.05, cz], radius: rr, seats }];
}

/** Where the square's props will stand, in the settlement's local metres —
    what __overlapsBuildings() audits the plan against.

    It is the plaza this file hands life.js (lifePlazaFor) run through the ring
    factors life.js's `_plazaProps` places them on: the fountain on the centre,
    the café tables at 0.55 of the radius, the playground at 0.6. The kiosk and
    the bus shelter are NOT here — life.js sets those against the nearest open
    carriageway (`_roadEdge`), which is a decision this file does not make and
    cannot predict, and a road edge is by construction outside the square.

    THE Z SIGN FLIPS HERE and it would be silent if it did not: everything
    handed to life.js is in STAGE metres, which aimStage() defines as
    `(ox, -oz)` of the plan's own (east, north), while every footprint in
    `p.lots` and `p.landmarkLot` is in PLAN metres. Returned unconverted, a prop
    on the landmark's front would be audited against the ground behind it and
    the probe would read 0 while the fountain sat in a wall. */
function plazaPropSpots(p) {
  const out = [];
  const pz = lifePlazaFor(p)[0];
  if (!pz) return out;
  const o = lifePropsFor(p).plaza;
  const cx = pz.center[0], cz = pz.center[2], r = pz.radius;
  const add = (type, x, z) => out.push({ type, x, z: -z });   // stage -> plan
  if (o.fountain) add('fountain', cx, cz);
  for (let i = 0; i < (o.cafeTables || 0); i++) {
    const a = (i / o.cafeTables) * Math.PI * 2 + 0.6;
    add('cafeTable', cx + Math.sin(a) * r * 0.55, cz + Math.cos(a) * r * 0.55);
  }
  if (o.playground) add('playground', cx + Math.sin(2.35) * r * 0.6,
                        cz + Math.cos(2.35) * r * 0.6);
  return out;
}

/** A field's grazing ground: the parcels fieldParcels() actually drew, as one
    rectangle. The herd is inside the ploughing, not on the pad beside it. */
function lifePastureFor(p) {
  const r = p.radius * 0.86;
  return [[-r, -r], [r, -r], [r, r], [-r, r]];
}

/* The trades whose landmark IS a place people sit outside. Read off the same
   `town.trade.type` string TRADE_FORMS above keys on, so the square that gets
   café tables is the square with the eatery on it and no other. */
const LIFE_FOOD_TRADE = new Set(['CafeOrCoffeeShop', 'Restaurant', 'FoodEstablishment']);
/* One hedge per this many metres of pavement / of fence line. A hedge is a
   LENGTH of planting, so the count has to come off the length of the line it is
   planted along and not off how many polylines the plan happened to draw. */
const LIFE_M_PER_BUSH = 18;
const LIFE_M_PER_FENCE_BUSH = 22;
/* How far out the square's five props keep their middle geometry, in stage
   metres — see the override in buildLife() for why 40 is not enough here. 110 m
   covers the documented street pose (72 m of altitude) with room to look across
   the square from its far side. */
const LIFE_PROP_MID = 110;

/** Total ground length of a list of [x, y, z] polylines, in stage metres. */
function polyLength(lines) {
  let s = 0;
  for (const l of lines) {
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][2] - l[i - 1][2]);
  }
  return s;
}

/** THE STATICS' DATA TRIGGERS, in one place, for one settlement.

    docs/LIFE.md "Where each prop is allowed to appear" states each prop's
    trigger in the settlement's own terms; this is the mapping from THIS host's
    facts onto it, and the same table is written down in LIFE.md so the two
    cannot drift. Nothing here is a taste decision — a fountain is a town, a
    kiosk is a town with a road, café tables are a food trade, hens are a
    hamlet's yard — and a settlement that has none of those gets a bare square,
    which is what a hamlet's square is. */
function lifePropsFor(p) {
  const t = p.town;
  const trade = (t.trade && t.trade.type) || '';
  /* "Town class or larger" is `classOf()`'s own boundary: >= 1000 tool calls. */
  const big = p.cls === 'town' || p.cls === 'city';
  /* ON A ROUTE. The roads that ARRIVE are the only thing on this planet that
     says a settlement is connected to anywhere else, and a bus shelter in a
     place no road leaves is furniture. Sea arcs are not a bus route. */
  const onRoute = (plan.roads || []).some(r => !r.sea && (r.a === p || r.b === p));
  const homes = p.cls === 'village' || p.cls === 'hamlet';
  const want = lifeCountsFor(p);
  const fenceLen = p.radius * 0.86 * 8;                    // lifePastureFor's perimeter
  return {
    plaza: {
      fountain: big,
      /* Three, because one Hunyuan `cafeTable` is a parasol, a table and two
         chairs (docs/LIFE.md) — a terrace of one. Three of them is a café. */
      cafeTables: LIFE_FOOD_TRADE.has(trade) ? 3 : 0,
      /* A RESIDENTIAL square: a village or a town whose landmark trade is
         nothing, which on this planet is a place people only live in. */
      playground: (p.cls === 'village' || p.cls === 'town') && !trade,
      kiosk: big,
      busstop: big && onRoute,
    },
    walkBushes: p.cls === 'fields' ? 0
      : clamp(Math.round(polyLength(lifeWalkwaysFor(p)) / LIFE_M_PER_BUSH), 0, 26),
    /* The fence line is hedged wherever there is a field to fence. */
    fenceBushes: clamp(Math.round(fenceLen / LIFE_M_PER_FENCE_BUSH), 0, 18),
    /* HENS IN THE YARD, and only in the two classes that have one: a fenced
       field beside five houses is a yard, the same field beside a city is not. */
    chickens: homes ? clamp(Math.round((t.sessions || 0) / 8), 3, 8) : 0,
    /* A DOG IS A WALKER'S dog — it is carried by a pedestrian, so the count is a
       share of the pedestrians and nothing else. One in twelve. */
    dogs: Math.round(want.humans / 12),
    /* Cats sit on the rim of a square, so there are none without one. */
    cats: p.plaza && p.plaza.r ? clamp(Math.round(want.humans / 25), 1, 3) : 0,
  };
}

/** The prop high-water mark, per type, for the same reason lifePoolCounts()
    exists: `_buildVehicleMeshes()` sizes ONE InstancedMesh per type from what is
    standing in `life.props` at the FIRST populate() and never grows it, so a
    fountain first asked for by the third town would have no mesh to be drawn in
    and would silently not appear. buildLife() pads up to these counts, populate
    builds the meshes, and the padding is dropped again. */
function lifePropPoolCounts() {
  const out = {};
  const bump = (type, n) => { if (n > 0) out[type] = Math.max(out[type] || 0, n); };
  for (const p of plan.placed) {
    const o = lifePropsFor(p);
    bump('st.fountain', o.plaza.fountain ? 1 : 0);
    bump('st.cafeTable', o.plaza.cafeTables);
    bump('st.playground', o.plaza.playground ? 1 : 0);
    bump('st.kiosk', o.plaza.kiosk ? 1 : 0);
    bump('st.busstop', o.plaza.busstop ? 1 : 0);
    bump('st.bush', o.walkBushes + o.fenceBushes);
    bump('st.chicken', o.chickens);
    bump('st.cat', o.cats);
    /* Not a prop — a dog is carried by a walker — but its mesh is sized in the
       same pass off `life.dogs`, so its maximum belongs in the same table. */
    bump('st.dog', o.dogs);
  }
  return out;
}

/** Pad `life.props` up to those counts for the length of ONE populate() call.
    Returns how many entries were added so buildLife() can drop them again.
    They are parked far under the terrain rather than hidden behind a flag,
    because life.js has no such flag: a prop is drawn at its position and
    nowhere else, and for the one frame this lasts it is under the sea bed. */
function padProps(pool) {
  const have = {};
  for (const p of life.props) have[p.type] = (have[p.type] || 0) + 1;
  let n = 0;
  for (const type in pool) {
    for (let i = (have[type] || 0); i < pool[type]; i++) {
      life.props.push({ type, yaw: 0, pos: new THREE.Vector3(0, -1e4, 0), scaleV: null });
      n++;
    }
  }
  return n;
}

/** Where a bird can sit, taken from the settlement's OWN roofs.

    life.js finds perches by raycasting `this.scene.children` — and its scene
    here is the stage, which holds nothing but life.group, so its own search
    returns zero and the flock would circle all night. The roofs it is looking
    for are known exactly: every lot's centre, its own height, in stage metres.
    Three per building for the reason the module's own comment gives — the
    middle of a gabled roof is its ridge. */
function lifePerchesFor(p) {
  const out = [];
  for (const b of (p.lots || [])) {
    if (out.length > 60) break;
    const h = stageHeight(sx(b.ox), sz(b.oz)) + (b.height || kitHeight(b.type)) + 0.6;
    out.push(new THREE.Vector3(sx(b.ox), h, sz(b.oz)));
    out.push(new THREE.Vector3(sx(b.ox) + b.w * 0.3, h - 0.4, sz(b.oz) + b.d * 0.3));
  }
  return out;
}


/* =============================================================================
   BUILD AND MOVE THE LIVING LAYER
   ========================================================================== */

/** ONE Life.load(), then the calls in the one order docs/LIFE.md allows: roads,
    walkways and pasture first (populate sizes its instanced meshes from what is
    going to stand in them), addSkyBox LAST of the add* calls and still before
    populate (it raycasts for roosts, and populate sizes the perched-parrot mesh
    from the parrot count it recorded), then populate. */
async function buildLife() {
  if (LIFE_OFF || !plan || !plan.placed.length) return;
  stage = new THREE.Group();
  stage.name = 'stage';
  stage.matrixAutoUpdate = false;
  scene.add(stage);
  lifeCam = new THREE.PerspectiveCamera();
  lifeCam.matrixAutoUpdate = false;

  const first = settlementUnderCamera() ||
                plan.placed.find(p => p.town.is_live) || plan.placed[0];
  aimStage(first);

  try {
    life = await Life.load(renderer, stage, {
      manifestUrl: MANIFEST,
      getHeight: stageHeight,
      seed: 7,
      maxSkinned: LIFE_MAX_SKINNED,
      rigid: LIFE_RIGID,
      shadows: quality === 'high' ? 6 : 0,
    });
  } catch (e) {
    life = null;
    console.warn('the living layer did not load:', e.message);
    return;
  }

  /* THE SQUARE'S FURNITURE NEEDS A LONGER MIDDLE TIER HERE THAN IN THE SHOWCASE,
     and this is the one life.js setting this file overrides. `midBand` 40 m was
     solved for a camera standing IN the street; this planet's own street pose is
     72 m of altitude (RUNBOOK, `globe-street.png`), so all five props were drawn
     at the FAR tier — and a welded photogrammetry mesh TEARS there (docs/LIFE.md,
     "what the models actually look like"): the kiosk read as a shattered white
     box on the paving. It costs almost nothing to fix: a `noRaw` prop's near and
     middle slots are the SAME 9,000-triangle geometry, so this is six objects a
     settlement held one tier up, ~54,000 triangles. The hedge and the grazing
     animals keep their own measured bands — seventy hedges is what the ladder
     was tuned against, and moving that is how the frame rate was halved once. */
  for (const t of ['st.fountain', 'st.kiosk', 'st.busstop', 'st.cafeTable', 'st.playground']) {
    if (life.models[t]) life.models[t].midBand = LIFE_PROP_MID;
  }

  lifePool = lifePoolCounts();
  addGraph(first);
  /* The pasture and the sky box are added at the POOL's counts, because these
     two are the ones whose instanced meshes are sized here and never again.
     setPopulation() then takes each down to what the settlement under the
     camera actually earns. */
  const firstProps = lifePropsFor(first);
  life.addPasture(lifePastureFor(first), { sheep: lifePool.sheep, cows: lifePool.cows,
                                           chickens: firstProps.chickens,
                                           bushes: firstProps.fenceBushes });
  life.addSkyBox({ min: [-stageHalf, 6, -stageHalf], max: [stageHalf, 78, stageHalf] },
                 { birds: lifePool.birds, parrots: lifePool.parrots });
  life.perches = lifePerchesFor(first);
  /* THE PROPS ARE POOLED THE SAME WAY THE CROWD IS. One InstancedMesh per type
     is built inside populate() and never grown, so every type the planet can
     ask for has to be standing in life.props for that one call — see padProps. */
  lifePropPool = lifePropPoolCounts();
  const padded = life.props.length;
  const nPad = padProps(lifePropPool);
  /* `dogs: 0` and `cats: 0` on purpose: both are per-SETTLEMENT and are placed
     by setPopulation()/placeCats() below. Their meshes still exist, because
     padProps() put a `st.dog` and a `st.cat` in life.props for this one call. */
  life.populate({ humans: lifePool.humans, cars: lifePool.cars, robots: 0,
                  dogs: 0, cats: 0 });
  life.props.splice(padded, nPad);
  placeCats(first);
  life.setNight(nightAmount);
  setPopulation(first);
  pushLiveAgentsToLife();
}

/** The four graph calls for one settlement. Separated from buildLife() because
    they run again every time the stage moves. */
function addGraph(p) {
  const props = lifePropsFor(p);
  life.addRoads(lifeRoadsFor(p));
  /* THE SQUARE GOES THROUGH addPlaza NOW, not through addWalkways' second
     argument, because the furniture is placed by that call and by no other.
     Between the roads and the walkways is where docs/LIFE.md puts it: the kiosk
     and the shelter are set against the OPEN lanes, and the pavement pass is
     what wires the square into the walking graph. `carsAllowed` is left alone —
     a village lane IS its square's edge here, and cutting it would leave the
     settlement with no through road at all. */
  for (const pz of lifePlazaFor(p)) {
    life.addPlaza(pz.center, pz.radius, Object.assign({ seats: pz.seats }, props.plaza));
  }
  /* 0.84 m is the plan's own path ribbon width (2 x 0.42), and the number
     matters: without it life.js guesses +/-0.9 m and a third of the crowd walks
     on the grass beside a pavement 84 cm wide. The plazas are already in
     `life.plazaSpecs` from the call above and addWalkways wires those too, so
     passing them a second time here would register the same square twice. */
  life.addWalkways(lifeWalkwaysFor(p), [], { width: 0.84, bushes: props.walkBushes });
}

/** The cats, which are the one static this file has to place again after a
    stage move. They are put on the plaza rim by populate(), which runs once for
    the whole planet — so on every later settlement they are re-placed here,
    against the square that now exists. `_prop` is the module's own placement
    call and the same one populate() uses; the mesh it goes into was sized at
    the planet's high-water mark (lifePropPoolCounts). */
function placeCats(p) {
  const n = lifePropsFor(p).cats;
  for (let i = 0; i < n && life.walk.plazas.length; i++) {
    const pz = life.walk.plazas[i % life.walk.plazas.length];
    const a = life.rand() * Math.PI * 2;
    life._prop('st.cat', pz.pos.x + Math.sin(a) * (pz.radius - 0.8),
               pz.pos.z + Math.cos(a) * (pz.radius - 0.8), a + Math.PI);
  }
}

/** Empty the graph without touching the population. Reaching into the module's
    own state, and it is the one place this file does: life.js has no teardown,
    a second Life.load() is twenty more seconds of decimation, and these five
    arrays are its whole world model. Every reference into them is re-seated
    immediately below, which is why this is safe rather than merely short. */
function clearGraph() {
  life.roads.length = 0;
  life.lanes.length = 0;
  life.junctions.length = 0;
  /* THE SAME SHAPE THE MODULE'S OWN CONSTRUCTOR BUILDS, key for key. `shops`
     and `homes` are newer than this function and are what an errand is aimed
     at; a `walk` object missing them is one `.length` away from throwing, and
     the only reason it does not throw today is that addGraph() runs in the same
     tick and fills them back in. Copying the shape is cheaper than depending on
     that ordering staying true. */
  life.walk = { nodes: [], edges: [], doors: [], shops: [], homes: [],
                seats: [], plazas: [] };
  /* The zebra crossings hold node indices too. `_findCrossings()` empties and
     refills this array from inside addWalkways/addRoads, so addGraph() puts it
     back — but between the two calls it holds indices into a village that no
     longer exists, and clearing it is what makes that window safe. */
  if (life.crossings) life.crossings.length = 0;
  life.pastures.length = 0;
  /* THE SQUARES AND THE THINGS STANDING IN THEM. Every prop is positioned in
     STAGE metres, and the stage is re-aimed at the next settlement — so a
     fountain left here would stand in the middle of a village that never had
     one. `plazaSpecs` is emptied for the same reason: addWalkways() wires every
     square it still holds into the new pavement graph. The InstancedMeshes the
     props are drawn in are NOT touched: they were sized once, at the planet's
     high-water mark, and addGraph() refills them in the same tick. */
  life.plazaSpecs.length = 0;
  life.props.length = 0;
}

/** Put every live actor and vehicle back on the graph that now exists. Without
    this a crowd keeps walking towards node indices from the last village and a
    car drives along a lane object nothing draws any more. */
function reseat(p) {
  const nodes = life.walk.nodes;
  for (const a of life.actors) {
    if (a.kind === 'person') {
      const i = nodes.length ? Math.floor(life.rand() * nodes.length) : -1;
      a.node = a.target = i;
      if (i >= 0) a.pos.copy(nodes[i].pos);
      a.pos.x += (life.rand() - 0.5) * 1.6;
      a.pos.z += (life.rand() - 0.5) * 1.6;
      a.pos.y = stageHeight(a.pos.x, a.pos.z);
      /* Groups are dissolved on a move: a follower whose leader is in reserve
         would stand still for ever, and re-pairing them buys nothing a fresh
         walk does not. */
      a.leader = null; a.groupSize = 1;
      if (a.seat) { a.seat.taken = false; a.seat = null; }
      a.state = 'walk'; a.hold = 0;
      /* AND THE ERRAND, which is the newest thing a walker carries. `path` is a
         list of node INDICES into `life.walk.nodes` and `home` is one more, and
         after clearGraph() every one of them points into a village that no
         longer exists: `_stepPeople` reads `nodes[a.path[0]].pos` with no guard
         and throws, once per walker per frame, for as long as the page is open.
         Measured on the phone run — 70 exceptions a frame from one stage move.
         Written defensively for the fields rather than assumed, because this is
         the seam where globe.js reaches into another module's state and that
         module is not this file's to pin. */
      a.home = i;
      a.errand = 'home';
      if (a.path) a.path.length = 0;
      a.point = null;
      a.cross = null;
    } else if (a.kind === 'grazer') {
      a.field = life.pastures[0] || a.field;
      if (a.field) {
        a.pos.set(a.field.minX + life.rand() * (a.field.maxX - a.field.minX), 0,
                  a.field.minZ + life.rand() * (a.field.maxZ - a.field.minZ));
        a.pos.y = stageHeight(a.pos.x, a.pos.z);
      }
      a.goal = null; a.state = 'graze';
    }
  }
  for (const v of life.vehicles) {
    const lane = life.lanes.length
      ? life.lanes[Math.floor(life.rand() * life.lanes.length)] : null;
    if (!lane) continue;
    v.lane = lane;
    v.s = lane.length * life.rand();
    v.approach = null; v.turn = 0; v.turnTo = null;
  }
  for (const b of life.flock || []) {
    b.pos.set((life.rand() - 0.5) * stageHalf * 1.6, 14 + life.rand() * 40,
              (life.rand() - 0.5) * stageHalf * 1.6);
    b.perch = null; b.landed = 0;
  }
}

/** SPAWN AND DESPAWN, without a second populate().

    life.js sizes its crowds and its InstancedMeshes on the first populate() and
    grows neither afterwards, so calling it again for a smaller village would
    either overflow a crowd or silently deliver the wrong number. The population
    is therefore built ONCE at the planet's high-water mark and the surplus is
    held in a reserve list this file owns: `life.actors` and `life.vehicles` are
    plain arrays and every step function iterates them, so what is not in them
    is not simulated and not drawn. The counts a settlement is given are exactly
    what lifeCountsFor() read out of its own data. */
function setPopulation(p) {
  const want = lifeCountsFor(p);
  lifeCounted = want;
  const live = { people: [], cars: [], grazers: [], parrots: [] };
  const keepOther = [];
  for (const a of life.actors) {
    if (a.kind === 'person') live.people.push(a);
    else if (a.kind === 'grazer') live.grazers.push(a);
    else keepOther.push(a);
  }
  live.cars = life.vehicles.slice();

  const fit = (arr, reserve, n) => {
    while (arr.length > n) reserve.push(arr.pop());
    while (arr.length < n && reserve.length) arr.push(reserve.pop());
    return arr;
  };
  const people = fit(live.people, lifeReserve.people, want.humans);
  const cars = fit(live.cars, lifeReserve.cars, want.cars);
  const grazers = fit(live.grazers, lifeReserve.grazers, want.sheep + want.cows);

  life.actors = people.concat(grazers, keepOther);
  life.vehicles = cars;
  life.counts.humans = people.length;
  life.counts.cars = cars.length;

  /* THE DOGS ARE FITTED HERE AND NOT BY populate(), and the reason is measured:
     populate() runs ONCE, on whichever settlement the camera happened to be
     over, and it refuses to make a dog on a pavement graph with no shops on it
     (life.js's own errand rule). The planet's first settlement is usually a
     `fields` one, which has no pavement at all — so every dog on the planet was
     silently never created. The COUNT and the rule are unchanged; only the
     moment moved. The ceiling is the mesh padProps() sized, and the owner is
     re-bound every time, because a dog is drawn at its owner's position and one
     bound to a walker now in the reserve would stand frozen in the street. */
  const wantDogs = life.walk.shops.length
    ? Math.min(lifePropPool['st.dog'] || 0, lifePropsFor(p).dogs) : 0;
  while (life.dogs.length > wantDogs) lifeReserve.dogs.push(life.dogs.pop());
  while (life.dogs.length < wantDogs && people.length) {
    life.dogs.push(lifeReserve.dogs.pop() ||
                   { owner: null, side: (life.dogs.length % 2 ? 1 : -1) * (0.7 + life.rand() * 0.3) });
  }
  for (let i = 0; i < life.dogs.length; i++) {
    if (people.length) life.dogs[i].owner = people[i % people.length];
  }

  /* PARROTS FLY IN PAIRS AND ONLY OVER AN AVIARY PROJECT. They are appended LAST by
     addSkyBox and every odd one's `mate` is the index of the one before it, so
     taking them off the END in pairs is the only edit that leaves every
     surviving mate index valid. */
  const flock = life.flock || [];
  const wantP = Math.min(lifePool.parrots, want.parrots) & ~1;
  while (flock.length && flock[flock.length - 1].parrot &&
         countParrots(flock) > wantP) { lifeReserve.parrots.push(flock.pop()); }
  while (countParrots(flock) < wantP && lifeReserve.parrots.length) {
    flock.push(lifeReserve.parrots.pop());
  }
  life.counts.parrots = countParrots(flock);
}
const countParrots = f => f.reduce((n, b) => n + (b.parrot ? 1 : 0), 0);

/** Move the stage to another settlement: aim it, rebuild the graph in the new
    metres, put everybody back on it, and re-read the counts. */
function moveStage(p) {
  aimStage(p);
  clearGraph();
  addGraph(p);
  /* The field, and no new ANIMALS — the herd is moved by setPopulation(), not
     re-created. The hens and the fence hedge are props, which clearGraph() just
     emptied, so those two are re-placed here at this settlement's own counts. */
  const props = lifePropsFor(p);
  life.addPasture(lifePastureFor(p), { sheep: 0, cows: 0,
                                       chickens: props.chickens,
                                       bushes: props.fenceBushes });
  placeCats(p);
  life.perches = lifePerchesFor(p);
  setPopulation(p);
  reseat(p);
  pushLiveAgentsToLife();
}

/* THE HYSTERESIS. `settlementUnderCamera()` flips between two neighbours while
   the camera crosses the ground between them, and every flip is a graph rebuild
   and a re-seat — a crowd teleporting twice a second. A different settlement has
   to be wanted for a continuous 1.2 s before the stage follows it, which at any
   travel speed this camera has is one decision per arrival. */
const STAGE_HOLD_MS = 1200;
/* The layer is only simulated when the camera is low enough for a person to be
   more than a pixel. 300 units of altitude is one step above the near-town
   rebuild's own 260, so life comes on just before the LOD0 street does. */
const LIFE_ALT = 300;

function updateLife(dt) {
  if (!life) return;
  const alt = cam.dist - R;
  const want = alt < LIFE_ALT ? settlementUnderCamera() : null;
  if (want && want !== stagePlace) {
    if (stageWanted !== want) { stageWanted = want; stageWantedAt = performance.now(); }
    else if (performance.now() - stageWantedAt > STAGE_HOLD_MS) { moveStage(want); stageWanted = null; }
  } else stageWanted = null;

  /* THE SECOND AND THIRD TOWNS, stepped whether or not the first one is: they
     are their own draw calls in their own tangent frames and cost nothing when
     the list comes back empty. Outside the stage's own `if (!want) return`
     below, because a camera between two villages has a satellite on screen
     before `settlementUnderCamera()` will admit to being over either. */
  const satMax = MOBILE ? MOBILE_SAT : SAT_MAX;
  updateSatellites(dt, alt < SAT_ALT ? nearestSettlements(satMax + 1)
                                         .filter(p => p !== stagePlace)
                                         .slice(0, satMax) : []);

  /* Nothing is stepped from orbit. The group stays in the scene with its counts
     intact — hiding it is one boolean, and rebuilding a population every time
     the camera passes over a town is what the reserve exists to avoid. */
  stage.visible = !!want;
  if (!want) return;

  /* THE CAMERA LIFE SEES IS THE REAL ONE, IN STAGE METRES. life.js measures
     every actor's distance against `camera.position` to decide its LOD tier;
     handed the world camera, every actor on the planet would read as 600 units
     away and the whole crowd would be sprites. */
  lifeCam.matrix.copy(stage.matrixWorld).invert().multiply(camera.matrixWorld);
  lifeCam.matrix.decompose(lifeCam.position, lifeCam.quaternion, lifeCam.scale);
  life.setNight(nightAmount);
  life.update(dt, lifeCam);
}

/** Every live agent on the settlement under the stage, in the shape
    setLiveAgents() asks for. At robots: 0 this maps nothing, and it is called
    anyway on the same tick the agent list changes because that is the module's
    contract — the day the robot count stops being zero, a missing call here
    would be a silent bug rather than a visible one. */
function pushLiveAgentsToLife() {
  if (!life || !stagePlace) return;
  const list = [];
  for (const a of (stagePlace.town.live_agents || [])) {
    list.push({ id: stagePlace.town.id + '/' + a.id, label: a.label || a.id,
                pos: new THREE.Vector3(0, stageHeight(0, 0) + 0.2, 0) });
  }
  life.setLiveAgents(list);
}


/* =============================================================================
   THE NEIGHBOURS — the second and third settlement, alive at the same time
   <!-- GLOBE-SAT-DOC -->

   Round 4 shipped ONE living settlement and said why: `life.js` is a flat-world
   module, `life.group` hangs off ONE tangent stage, and a single tangent plane
   wide enough to hold a settlement AND its neighbours would have its edges
   three hundred metres in the air (the sagitta argument in GLOBE-STAGE-DOC,
   which has not stopped being true). None of that forbids a SECOND population;
   it forbids a second population inside life.js's own flat world.

   So the neighbours get their own layer, and it is deliberately the CHEAPEST
   tier life.js itself would have given them at that distance:

   - **Sprites, not skeletons and not VAT.** The texture is `ModelEntry.sprite`
     — the same 64x128 bake off the same four human models that life.js's own
     far tier draws past 90 m, taken off the loaded `life.models`, so a satellite
     villager is not a different person from a stage villager, only a further
     one. The VAT tier is not reachable from here and that is a fact about the
     module rather than a choice: `vatMaterial` and `Crowd` are module-private
     (life.js exports `Life`, `CHARACTERS`, `RIGID`, `PROPORTION` and nothing
     else) and the API is frozen.
   - **Half the people**, `SAT_SHARE`, on top of the class cap and the quality
     scale the full stage already pays — the second village is background.
   - **No skinned, no cars, no herds, no birds.** A car needs the lane/junction
     machinery that is `life.js`'s whole road model; sixteen more of them in a
     village nobody is standing in is the wrong place to spend a draw call.

   WHY THE INSTANCES ARE IN WORLD SPACE and not in a Group per town: one
   InstancedMesh per human MODEL holds every satellite's people at once, so the
   whole feature is FOUR draw calls no matter how many neighbours are awake.
   The billboard is built from the walker's own settlement up-axis, which is
   what keeps a person standing on the ground rather than leaning towards the
   lens on a curved world.
   ========================================================================== */

/* The brief's budget: three settlements alive, so two neighbours besides the
   stage. SAT_ALT is 900 and not LIFE_ALT's 300 because this is a REGION-range
   feature — at 300 m the neighbours are already off the frame. SAT_RANGE is a
   distance from the LENS, which is the only thing that decides whether a
   1.8 m sprite is worth a matrix: past 600 units a person is under a pixel. */
const SAT_MAX = 2, SAT_ALT = 900, SAT_RANGE = 600, SAT_SHARE = 0.5;
const SAT_SPEED = 1.25;               // m/s, life.js's own walking pace
const SAT_CAP = 60;                   // people per satellite, hard
/* The same 1.2 s the stage uses, for the same reason: a camera crossing the
   ground between three villages re-picks its neighbours every frame, and a
   satellite rebuilt at that rate is a village that flickers. */
const SAT_HOLD_MS = STAGE_HOLD_MS;

const satGroups = [];                 // { p, walkers, until } — one per live neighbour
const satMeshes = [];                 // { model, mesh, n } — one per human model, world space
let satPending = null, satPendingAt = 0;

/** The settlements nearest the LENS, nearest first, on the visible hemisphere.
    Great-circle order and screen order are the same order here — every
    settlement sits on the same sphere — so the angular sort is the distance
    sort, and the hemisphere test is `pickAt()`'s own tangent-cone cosine. */
function nearestSettlements(n) {
  const camDir = camera.position.clone().normalize();
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);
  const out = [];
  for (const p of plan.placed) {
    if (p.axis.dot(camDir) < horizon * 0.999) continue;        // over the horizon
    const d = camera.position.distanceTo(p.centre);
    if (d > SAT_RANGE) continue;
    out.push({ p, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, n).map(o => o.p);
}

/** The four human sprite meshes, made once off whatever life.js loaded. */
function buildSatMeshes() {
  if (satMeshes.length || !life || !life.models) return;
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  for (const id of Object.keys(life.models)) {
    const entry = life.models[id];
    /* `palette` IS `!!spec.human` inside ModelEntry — the four people, never
       the sheep or the cow. Read off the entry rather than off the catalogue
       because the catalogue is not exported in a shape this file can index. */
    if (!entry.palette || !entry.sprite) continue;
    const mat = new THREE.MeshBasicMaterial({
      map: entry.sprite.texture, transparent: true, alphaTest: 0.4,
      /* toneMapped false for life.js's own reason: the bake already ran through
         tone mapping once, and letting it run again washes the crowd to grey. */
      side: THREE.DoubleSide, toneMapped: false,
    });
    const mesh = new THREE.InstancedMesh(quad, mat, SAT_CAP * SAT_MAX);
    mesh.name = 'sat:' + id;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.renderOrder = 1;
    scene.add(mesh);
    satMeshes.push({ model: id, mesh, entry, n: 0 });
  }
}

/** One neighbour's walkers: people on that settlement's OWN lanes, in its own
    plan metres. Nothing here re-derives a position — `p.lanes` is the same
    polyline list the gravel ribbons are drawn from and `lifeWalkwaysFor()`
    hands to life.js, so a satellite villager walks a lane that is on screen. */
function makeSatellite(p) {
  const want = Math.min(SAT_CAP,
    Math.round((lifeCountsFor(p).humans || 0) * SAT_SHARE));
  const lanes = (p.lanes || []).filter(L => L.pts && L.pts.length > 1);
  const walkers = [];
  if (!want || !lanes.length || !satMeshes.length) return { p, walkers, until: 0 };
  for (let i = 0; i < want; i++) {
    const h = hash32(p.town.id + ':sat:' + i);
    const L = lanes[h % lanes.length];
    walkers.push({
      lane: L,
      /* Metres along the polyline, and the direction it is walked in. Both
         seeded off the hash so the same village has the same crowd on every
         reload — a satellite that re-rolls its people every time the camera
         passes is the thing that reads as a screensaver. */
      s: ((h >>> 7) % 1000) / 1000 * lanePathLength(L.pts),
      dir: ((h >>> 17) & 1) ? 1 : -1,
      mesh: (h >>> 21) % satMeshes.length,
      side: (((h >>> 25) % 100) / 100 - 0.5) * (L.w || 3) * 0.7,
      scale: 0.92 + ((h >>> 11) % 100) / 620,
    });
  }
  return { p, walkers, until: 0 };
}

const lanePathLength = pts => {
  let n = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return n;
};

/** Where a walker is on its lane, as (ox, oz) plus the tangent it is facing. */
function laneAt(pts, s, out) {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const dx = pts[i + 1][0] - ax, dz = pts[i + 1][1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    if (s <= acc + len) {
      const k = (s - acc) / len;
      out.x = ax + dx * k; out.z = az + dz * k;
      out.tx = dx / len; out.tz = dz / len;
      return out;
    }
    acc += len;
  }
  out.x = pts[pts.length - 1][0]; out.z = pts[pts.length - 1][1];
  out.tx = 1; out.tz = 0;
  return out;
}

const _satAt = { x: 0, z: 0, tx: 1, tz: 0 };
const _satPos = new THREE.Vector3(), _satUp = new THREE.Vector3();
const _satRight = new THREE.Vector3(), _satFwd = new THREE.Vector3();
const _satTall = new THREE.Vector3();
const _satM = new THREE.Matrix4();

/** Step and draw every live neighbour. `wanted` is what `updateLife()` decided
    should be awake this frame; the hold is what stops a camera in motion
    rebuilding two villages every frame. */
function updateSatellites(dt, wanted) {
  if (LIFE_OFF || !life) return;
  buildSatMeshes();
  if (!satMeshes.length) return;

  /* --- follow `wanted`, with the stage's own hysteresis -------------------- */
  const same = wanted.length === satGroups.length &&
               wanted.every((p, i) => satGroups[i] && satGroups[i].p === p);
  if (!same) {
    const key = wanted.map(p => p.town.id).join(',');
    if (satPending !== key) { satPending = key; satPendingAt = performance.now(); }
    else if (performance.now() - satPendingAt > SAT_HOLD_MS) {
      /* Kept, not rebuilt, for a neighbour that is still in the list: a village
         whose people restart at the top of their lane every time the third
         town changes is a village that twitches. */
      const keep = new Map(satGroups.map(s => [s.p, s]));
      satGroups.length = 0;
      for (const p of wanted) satGroups.push(keep.get(p) || makeSatellite(p));
      satPending = null;
    }
  } else satPending = null;

  /* --- step, then write the instance matrices ----------------------------- */
  for (const m of satMeshes) m.n = 0;
  for (const sat of satGroups) {
    const p = sat.p, fr = p.frame;
    /* THE GROUND IS THE PAD, and the pad is FLAT by construction: `elevAt()`
       levels a settlement's own disc, which is the whole reason the stage can
       be a plane at all. So a satellite walker's height is the settlement's own
       elevation and needs no grid — the 33x33 sample the stage pays for buys
       nothing here, and a satellite is 300 m away. */
    const ground = R + p.elev;
    for (const w of sat.walkers) {
      const L = w.len || (w.len = lanePathLength(w.lane.pts));
      w.s += SAT_SPEED * w.dir * dt;
      if (w.s > L) w.s -= L; else if (w.s < 0) w.s += L;
      laneAt(w.lane.pts, w.s, _satAt);
      const M = satMeshes[w.mesh];
      if (M.n >= M.mesh.instanceMatrix.count) continue;
      const h = M.entry.height * w.scale;
      /* Local (ox, oz) -> world, through the settlement's own frame. The offset
         is a metre of ground = 1/R radians of axis, the same conversion the
         lanes and the lots are placed with. */
      const ox = _satAt.x - _satAt.tz * w.side, oz = _satAt.z + _satAt.tx * w.side;
      _satUp.copy(p.axis).addScaledVector(fr.east, ox / R)
            .addScaledVector(fr.north, oz / R).normalize();
      _satPos.copy(_satUp).multiplyScalar(ground);
      /* THE BILLBOARD TURNS ABOUT THE LOCAL UP, never about the lens's own up:
         on a sphere a fully camera-facing quad lies down at the horizon, which
         is the same failure the forest's flat card exists to answer. */
      _satFwd.copy(camera.position).sub(_satPos);
      _satRight.crossVectors(_satUp, _satFwd);
      if (_satRight.lengthSq() < 1e-8) continue;
      _satRight.normalize().multiplyScalar(h * M.entry.sprite.aspect);
      _satFwd.crossVectors(_satRight, _satUp).normalize();
      _satTall.copy(_satUp).multiplyScalar(h);
      _satM.makeBasis(_satRight, _satTall, _satFwd);
      _satM.setPosition(_satPos);
      M.mesh.setMatrixAt(M.n++, _satM);
    }
  }
  for (const m of satMeshes) {
    m.mesh.count = m.n;
    if (m.n) m.mesh.instanceMatrix.needsUpdate = true;
    /* The same night curve everything else on the ground takes. A baked sprite
       has no lighting of its own, so this is the only thing that stops a
       neighbouring village glowing white at midnight. */
    m.mesh.material.color.setScalar(1 - nightAmount * 0.62);
  }
}


/* =============================================================================
   THE FLEET — one ORNIS craft per live agent  <!-- GLOBE-DRONE-DOC -->

   Round 3 flew a six-sided cone with an emissive material. These are the seven
   variants from `drones.js` (the airframe is Beri's own quadcopter), chosen by
   what the agent is actually doing, and `docs/DRONES.md` is that library's own
   document. This is only what CALLING it from a planet required.

   The three things that are different from the city and the island:

   - **The scale is 1.** The kit is built in metres against BuildingKit, where a
     floor is 3 m, and a globe unit IS a metre here — a cottage is 5 x 6. The
     city has to divide by three because a whole file stands on a one-unit plot
     there; this page does not.
   - **Nothing is hidden from orbit.** A craft past 400 m falls to the kit's own
     LOD2, which is a sprite baked off the real machine, and that sprite plus the
     weather puff over the town IS the settlement's live glow from space. There
     is no second orbit representation to keep in sync.
   - **The downwash is OFF, because it cannot be right here.** `kit.getHeight`
     is flat-world (x, z) and the kit reads `position.y - getHeight()` as a
     craft's altitude; on a sphere `position.y` is a cartesian coordinate, not a
     height. It is pinned at -1e7 so the ring never fires — the full reasoning,
     and the 526-unit white disc it drew before, are in loadAssets().
   ========================================================================== */

/* The families already exist in the payload: `last_tool` is the server's own
   field and this is the same map city.js uses, so a craft over a town and a
   craft over its street are the same machine doing the same job. */
const DRONE_FAMILY = {
  Write: 'edit', Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Read: 'read', NotebookRead: 'read', Glob: 'read',
  Grep: 'search', WebSearch: 'search', WebFetch: 'search',
  Bash: 'shell', PowerShell: 'shell', BashOutput: 'shell', KillShell: 'shell',
};
const droneTier = a => {
  const s = ((a.label || '') + ' ' + (a.id || '')).toLowerCase();
  return /opus/.test(s) ? 'opus' : /haiku/.test(s) ? 'haiku' : 'sonnet';
};
/** The craft one live agent flies. `orchestrator` for a session's own main
    agent, `agent` for a subagent with nothing open, and a `worker.*` for one
    that has a tool in flight — the tallest craft in the fleet, `net`, for an
    in-flight tool with no family of its own, which is exactly right for an MCP
    call or a Task reaching outside the machine. */
function droneVariant(a) {
  if (String(a.id || '').startsWith('main')) return 'orchestrator';
  const open = (a.inflight && a.inflight.length) ? a.inflight[0].tool : null;
  if (open) return 'worker.' + (DRONE_FAMILY[open] || 'net');
  return 'agent';
}

/* --- trails: ONE draw call for the whole fleet ---------------------------- */
const TRAIL_SLOTS = 12, TRAIL_SEG = 18, TRAIL_STEP = 0.10;
let trailMesh = null, trailPos = null, trailAlpha = null;
const trailFree = [];
function buildDroneTrails() {
  if (trailMesh) return;
  const n = TRAIL_SLOTS * (TRAIL_SEG - 1) * 2;
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
      void main(){ if (vA <= 0.002) discard; gl_FragColor = vec4(uColor, vA * 0.5); }`,
  }));
  /* Not frustum-culled for the reason every merged mesh on this planet is not:
     its geometry's bounding sphere is at the origin and its vertices are 600
     units away, so three would cull the whole ribbon every frame. */
  trailMesh.frustumCulled = false;
  trailMesh.name = 'drone-trails';
  scene.add(trailMesh);
  for (let i = 0; i < TRAIL_SLOTS; i++) trailFree.push(i);
}
const claimTrail = () => (trailFree.length ? { slot: trailFree.pop(), pts: [], acc: 0 } : null);
function releaseTrail(t) {
  const base = t.slot * (TRAIL_SEG - 1) * 2;
  for (let i = 0; i < (TRAIL_SEG - 1) * 2; i++) trailAlpha.setX(base + i, 0);
  trailAlpha.needsUpdate = true;
  trailFree.push(t.slot);
}
const _tp = new THREE.Vector3();
function stepDroneTrails(dt) {
  if (!trailMesh) return;
  let dirty = false;
  for (const d of droneStates) {
    const t = d.trail;
    if (!t) continue;
    t.acc += dt;
    if (t.acc >= TRAIL_STEP) {
      t.acc = 0;
      const anchor = d.craft.userData.trailAnchor;
      if (anchor) anchor.getWorldPosition(_tp); else _tp.copy(d.craft.position);
      t.pts.unshift(_tp.x, _tp.y, _tp.z);
      if (t.pts.length > TRAIL_SEG * 3) t.pts.length = TRAIL_SEG * 3;
    }
    const base = t.slot * (TRAIL_SEG - 1) * 2;
    const have = Math.floor(t.pts.length / 3);
    for (let i = 0; i < TRAIL_SEG - 1; i++) {
      const o = base + i * 2;
      if (i + 1 < have) {
        trailPos.setXYZ(o, t.pts[i * 3], t.pts[i * 3 + 1], t.pts[i * 3 + 2]);
        trailPos.setXYZ(o + 1, t.pts[(i + 1) * 3], t.pts[(i + 1) * 3 + 1], t.pts[(i + 1) * 3 + 2]);
        const a = 1 - i / (TRAIL_SEG - 1);
        trailAlpha.setX(o, a); trailAlpha.setX(o + 1, Math.max(0, a - 0.06));
      } else {
        trailPos.setXYZ(o, 0, 0, 0); trailPos.setXYZ(o + 1, 0, 0, 0);
        trailAlpha.setX(o, 0); trailAlpha.setX(o + 1, 0);
      }
    }
    dirty = true;
  }
  if (dirty) { trailPos.needsUpdate = true; trailAlpha.needsUpdate = true; }
}

/* --- one craft ------------------------------------------------------------ */
/* A craft does not appear: it LAUNCHES, out of the town it works in, over a
   second and a half, and when its agent finishes it DOCKS back down over one.
   Both are the same eased number; `t` is 0 on the ground and 1 on station. */
const LAUNCH_SECONDS = 1.5, DOCK_SECONDS = 1.0;

function makeCraft(p, ag, i) {
  const seed = hash32(String(ag.id || i));
  let craft, variant = null, tagAnchor = null, craftScale = 1;
  if (droneKit) {
    variant = droneVariant(ag);
    craft = droneKit.make(variant, { tier: droneTier(ag), seed: seed % 100000 });
    tagAnchor = craft.userData.tagAnchor;
    craftScale = craft.scale.x || 1;
  } else {
    /* THE CONE FALLBACK, round 3's craft unchanged. `?drones=cones` is how the
       A/B in docs/RUNBOOK.md is measured and it is the same path a failed fetch
       of assets/drones/ornis.glb takes, so this branch is reachable code. */
    craft = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 3.0, 6).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: 0xd2a62c,
                                       emissiveIntensity: 0.9, roughness: 0.5 }));
  }
  const tag = taskTag(ag.label || ag.last_tool || 'working');
  /* THE TAG HANGS ON THE CRAFT'S OWN ANCHOR — integration note 4. Every variant
     puts it at the right height for ITS silhouette, including the net craft's
     mast. It stays a scene-level sprite rather than a child of the anchor
     because updateDrones() already solves its size against the lens, and a
     sprite inside a group scaled by the variant would have that solve divided
     by 0.7 or multiplied by 1.8 depending on which craft it is on. */
  liveGroup.add(craft, tag);
  const rec = {
    place: p, craft, tag, agent: ag, variant, craftScale, tagAnchor,
    phase: ((hash32(String(ag.id || i)) % 1000) / 1000) * Math.PI * 2,
    /* OVER the settlement, not outside it. Round 3's cone orbited at 1.25 of the
       radius and 16-60 m up, which put it beyond the rooftops and above the
       frame at every street pose — read straight off this pass's first
       globe-street capture, which has seventy people in it and not one aircraft.
       0.85 of the radius is inside the built-up part, and 11 m is one storey
       over a cottage's ridge. */
    radius: p.radius * 0.85 + 4, alt: 11 + i * 4.5,
    launch: 0, docking: false, working: false,
    trail: droneKit ? claimTrail() : null,
    prev: new THREE.Vector3(), key: p.town.id + '/' + (ag.id || i),
  };
  droneStates.push(rec);
  return rec;
}

function disposeCraft(d) {
  if (droneKit && d.variant) droneKit.remove(d.craft);
  liveGroup.remove(d.craft, d.tag);
  if (d.tag.material) { if (d.tag.material.map) d.tag.material.map.dispose(); d.tag.material.dispose(); }
  /* The craft's geometry and materials belong to the kit and are shared by
     every craft of that variant; only the cone path has anything of its own. */
  if (!d.variant) { d.craft.geometry.dispose(); d.craft.material.dispose(); }
  if (d.trail) releaseTrail(d.trail);
}

/** One frame of the whole fleet: the orbit, the launch and dock eases, the bank
    off real velocity, and the tag solved to a pixel size on the lens. */
function updateDrones(t, dt) {
  const h = window.innerHeight, fovRad = camera.fov * DEG;
  const pos = new THREE.Vector3();
  for (let i = droneStates.length - 1; i >= 0; i--) {
    const d = droneStates[i];
    d.launch = clamp(d.launch + dt / (d.docking ? -DOCK_SECONDS : LAUNCH_SECONDS), 0, 1);
    if (d.docking && d.launch <= 0) { disposeCraft(d); droneStates.splice(i, 1); continue; }
    const k = d.launch * d.launch * (3 - 2 * d.launch);        // smoothstep
    const a = d.phase + t * 0.32;
    const fr = d.place.frame;
    /* The orbit closes as the craft launches: it leaves the square and swings
       out to station, rather than fading in already on its circle. */
    const rad = d.radius * (0.25 + 0.75 * k);
    const dir = d.place.axis.clone()
      .addScaledVector(fr.east, Math.cos(a) * rad / R)
      .addScaledVector(fr.north, Math.sin(a) * rad / R).normalize();
    const alt = d.place.elev + 1.2 + (d.alt - 1.2) * k + Math.sin(t * 1.6 + d.phase) * 1.8 * k;
    pos.copy(dir).multiplyScalar(R + alt);

    /* The velocity is MEASURED, not derived from the orbit's formula: the launch
       ease is part of the motion, and a craft that banks off its circle alone
       climbs out of a town dead level. */
    if (dt > 0 && d.prev.lengthSq() > 0) {
      const vel = pos.clone().sub(d.prev).divideScalar(dt);
      if (d.craft.userData.setSpeed) d.craft.userData.setSpeed(vel);
    }
    d.prev.copy(pos);
    d.craft.position.copy(pos);
    /* Nose along the flight path, deck level with the ground under it. The kit
       adds its own bank on top of this orientation. */
    const fwd = d.place.axis.clone()
      .addScaledVector(fr.east, Math.cos(a + 0.05) * rad / R)
      .addScaledVector(fr.north, Math.sin(a + 0.05) * rad / R)
      .normalize().multiplyScalar(pos.length()).sub(pos);
    if (fwd.lengthSq() > 1e-8) d.craft.lookAt(pos.clone().add(fwd));
    d.craft.up.copy(dir);

    const dist = camera.position.distanceTo(pos);
    /* The tag sits on the craft's own anchor height, converted out of the
       variant's scale, so an orchestrator's label is not 80% higher than a
       worker's for no reason a viewer can see. */
    const lift = d.tagAnchor ? d.tagAnchor.position.y * d.craftScale + 1.2 : 6;
    d.tag.position.copy(pos).addScaledVector(dir, lift);
    const worldPerPx = 2 * Math.tan(fovRad / 2) * dist / h;
    const sy = 15 * worldPerPx * (52 / 36);
    d.tag.scale.set(sy * d.tag.userData.aspect, sy, 1);
    d.tag.visible = dist < 900 && d.launch > 0.5;
  }
  stepDroneTrails(dt);
}

/** A tool call names a town; the craft working there turns its effect on. The
    variant is re-read at the same moment: an agent that was idle and has just
    opened an Edit is flying the wrong airframe until it is remade, and remaking
    one is a synchronous kit.make() — which is exactly why drones.js bakes
    everything at load. */
function setDroneWorking(townId, tool, on) {
  for (const d of droneStates) {
    if (d.place.town.id !== townId) continue;
    d.working = on;
    if (d.craft.userData.setWorking) d.craft.userData.setWorking(on);
  }
}

/** The `worker.edit` craft over one town, if there is one — the machine the
    print's lasers come out of. */
function printerOver(townId) {
  for (const d of droneStates) {
    if (d.place.town.id === townId && d.variant === 'worker.edit' && d.launch > 0.8) return d;
  }
  for (const d of droneStates) if (d.place.town.id === townId && d.launch > 0.8) return d;
  return null;
}


/* =============================================================================
   ARES MATERIALISATION — a file is touched, a building prints
   <!-- GLOBE-PRINT-DOC -->

   The session city's PRINT-DOC is the reference and its four lessons are taken
   whole, because each of them was paid for there:
     - DURATION is the whole feature. Everything else existed at 1.2 s and
       nobody could see any of it, so a building here takes 2.5 to 4.0 s
       depending on how tall it is.
     - A close-up nobody asked for is charged to a BUDGET, or the wide shot
       stops existing. 40 % of any two-minute window, exactly as the city.
     - A mark on the GROUND is what makes an event findable from a wide shot;
       the effect itself never will be. That is the pulsing ring.
     - The flash is 0.55 and not 2.6. With bloom on, three facades flashing at
       2.6 blow the whole frame to white.

   WHAT IS DIFFERENT ON A PLANET. The city cuts its buildings with a `discard`
   on a per-instance float, which it can because a city building is one box.
   These are BuildingKit LOD0 groups, so the cut is a CLIPPING PLANE on that one
   building's cloned materials — the island's answer — and the plane's normal is
   the SETTLEMENT'S OWN UP, not (0,1,0): a building at latitude 40 has a roof
   that points at the sky over latitude 40 and a horizontal cut anywhere else is
   a diagonal slice through it.

   And the rig lives in a tangent-frame Group of its own, which is what lets
   every line of the city's rig arithmetic be used unchanged: inside that group
   the world is flat, x is east, y is up and z is south.
   ========================================================================== */

const PRINT_MIN_SECONDS = 2.5, PRINT_MAX_SECONDS = 4.0, PRINT_FLOOR_REF = 4;
const RIG_HOLD_SECONDS = 0.6, RIG_DISSOLVE_SECONDS = 0.5;
const RIG_AFTER = RIG_HOLD_SECONDS + RIG_DISSOLVE_SECONDS;
const FLASH_HOLD_SECONDS = 0.2, FLASH_COOL_SECONDS = 3.0;
/* THE FLASH IS 0.22 HERE, NOT THE CITY'S 0.55, AND THE BLOOM IS WHY. This page
   runs UnrealBloom at strength 0.48 with a threshold of 0.62 over an ACES curve
   at exposure 0.85; the city's rig is not the same rig. At 0.55 the emissive
   lands at 0.85 after the intensity term, which is over the threshold on every
   facet of the shell at once — the first globe-print.png came back as a white
   blob with a town round it, which is PRINT-DOC's own 2.6 failure at a third of
   the number. 0.22 tops out just under the threshold, so what blooms is the
   laser and the ring and not the whole building. */
const FLASH_PEAK = 0.22;
const GLITCH_SECONDS = 0.4;
/* Three, not the city's six. A rig is fifteen meshes and this page is already
   spending its frame on a planet; a fourth simultaneous file simply prints
   without its own scaffolding, which is the city's own overflow rule. */
const MAX_PRINT_RIGS = 3;
const RIG_STRUTS = 8;
const LASER = new THREE.Color(0xff2a1a);
const FOCUS_WINDOW = 120, FOCUS_BUDGET = FOCUS_WINDOW * 0.40;
const PRINT_CUE_COOLDOWN = 12, CUE_TAIL_SECONDS = 1;

const printJobs = [], printRigs = [], derezJobs = [];
const livePrints = new Map();      // normalised path -> the record it built
const focusSpent = [];
let printGroup = null, lastPrint = null, printCueUntil = 0, cuePrev = null;

const clockS = () => performance.now() / 1000;
const smoothstep01 = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
const normPath = s => String(s || '').replace(/\\/g, '/').replace(/\/+$/, '');
const printSecondsFor = floors => PRINT_MIN_SECONDS +
  (PRINT_MAX_SECONDS - PRINT_MIN_SECONDS) * Math.min(1, floors / PRINT_FLOOR_REF);

/** A tangent-frame Group at a settlement, so the rig can be built flat. */
function tangentGroup(p) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.makeBasis(p.frame.east, p.frame.up, p.frame.north.clone().negate());
  g.matrix.setPosition(p.axis.clone().multiplyScalar(R + p.elev));
  return g;
}

/* --- sparks: one Points cloud in WORLD space for prints and derez ---------- */
const SPARK_MAX = 700;
let sparks = null, sparkPos, sparkCol, sparkSize, sparkNext = 0;
const sparkV = new Float32Array(SPARK_MAX * 3);
const sparkLife = new Float32Array(SPARK_MAX), sparkMax = new Float32Array(SPARK_MAX);
const sparkGrav = new Float32Array(SPARK_MAX);
const sparkUp = new Float32Array(SPARK_MAX * 3);   // "down" is per-spark on a sphere

function buildSparks() {
  if (sparks) return;
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
  printGroup.add(sparks);
}
function emitSpark(P, V, up, color, size, life, grav) {
  if (!sparks) return;
  const i = sparkNext = (sparkNext + 1) % SPARK_MAX;
  sparkPos.setXYZ(i, P.x, P.y, P.z);
  sparkCol.setXYZ(i, color.r, color.g, color.b);
  sparkV[i * 3] = V.x; sparkV[i * 3 + 1] = V.y; sparkV[i * 3 + 2] = V.z;
  sparkUp[i * 3] = up.x; sparkUp[i * 3 + 1] = up.y; sparkUp[i * 3 + 2] = up.z;
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
    /* GRAVITY POINTS AT THE PLANET'S CENTRE, per spark: a constant (0,-1,0)
       would have every ember on the far side of the world falling upwards. */
    const k = sparkGrav[i] * dt;
    sparkV[i * 3] += sparkUp[i * 3] * k;
    sparkV[i * 3 + 1] += sparkUp[i * 3 + 1] * k;
    sparkV[i * 3 + 2] += sparkUp[i * 3 + 2] * k;
    sparkPos.setXYZ(i, sparkPos.getX(i) + sparkV[i * 3] * dt,
                       sparkPos.getY(i) + sparkV[i * 3 + 1] * dt,
                       sparkPos.getZ(i) + sparkV[i * 3 + 2] * dt);
    /* The size IS the fade — one attribute doing two jobs, because a point that
       shrinks as it dims is what a cooling ember does. */
    sparkSize.setX(i, sparkSize.getX(i) * 0.985 * (sparkLife[i] / sparkMax[i] > 0.15 ? 1 : 0.9));
  }
  if (any) { sparkPos.needsUpdate = true; sparkCol.needsUpdate = true; sparkSize.needsUpdate = true; }
}

/* --- the rigs, pooled ----------------------------------------------------- */
function buildPrintRigs() {
  if (printRigs.length) return;
  const bar = new THREE.PlaneGeometry(1, 1); bar.rotateX(-Math.PI / 2);
  const post = new THREE.BoxGeometry(1, 1, 1); post.translate(0, 0.5, 0);
  const head = new THREE.BoxGeometry(1, 1, 1);
  const shaft = new THREE.PlaneGeometry(1, 1); shaft.translate(0, -0.5, 0);
  const ring = new THREE.RingGeometry(0.62, 0.80, 40); ring.rotateX(-Math.PI / 2);
  for (let i = 0; i < MAX_PRINT_RIGS; i++) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: LASER, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    /* The shimmer is the only part with its own material: the heat over the
       scanline sits at a tenth of the lasers' brightness, and one shared
       opacity cannot say both things. */
    const hazeMat = new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const lines = [new THREE.Mesh(bar, mat), new THREE.Mesh(bar, mat)];
    const heads = [new THREE.Mesh(head, mat), new THREE.Mesh(head, mat)];
    const beams = [new THREE.Mesh(shaft, mat), new THREE.Mesh(shaft, mat)];
    const struts = [];
    for (let k = 0; k < RIG_STRUTS; k++) struts.push(new THREE.Mesh(post, mat));
    const ringM = new THREE.Mesh(ring, mat);
    const haze = new THREE.Mesh(bar, hazeMat);
    for (const m of lines.concat(heads, beams, struts)) g.add(m);
    g.add(ringM, haze);
    for (const m of g.children) m.frustumCulled = false;
    g.visible = false;
    printGroup.add(g);
    printRigs.push({ group: g, mat, hazeMat, lines, heads, beams, struts, ring: ringM, haze, job: null });
  }
  buildSparks();
}
const freeRig = () => printRigs.find(r => !r.job) || null;

/* How thick a laser has to be in WORLD units to still be `minPx` wide on
   screen. At orbit a 4.5 cm bar is a hundredth of a pixel and simply is not
   there; solved off the lens rather than guessed. */
function laserWidth(worldPoint, minPx) {
  const d = Math.max(1, camera.position.distanceTo(worldPoint));
  return (2 * d * Math.tan(camera.fov * DEG / 2) / window.innerHeight) * minPx;
}

/* --- where a new building stands ------------------------------------------
   A FREE LOT ON A REAL LANE, found with the settlement's own planner: a
   candidate is hung off a lane station, inflated by the same LOT_GAP, and
   accepted only if it clears every lot that already stands and every
   carriageway. That is `planBuildings`'s own acceptance test, run again — so a
   printed house cannot land inside a neighbour, and `__overlaps()` still reads
   zero after one. */
function freeLot(p) {
  if (!p.lanes || !p.lanes.length) return null;
  const taken = (p.lots || []).map(b => rectCorners(b.ox, b.oz, b.yaw, b.w + LOT_GAP, b.d + LOT_GAP));
  const spec = CATALOGUE[(p.cls === 'city' || p.cls === 'town') ? 2 : 0];
  const slots = [];
  for (const L of p.lanes) {
    for (const st of laneStations(L.pts, 7.4)) for (const side of [1, -1]) slots.push({ st, side, w: L.w });
  }
  /* FURTHEST FIRST, and that is the opposite of the planner's own order on
     purpose: a settlement that is already full grows at its EDGE, and a new
     house appearing in the middle of a finished square would be the one place
     a viewer knows there was not one a second ago. */
  slots.sort((a, b) => (b.st.x * b.st.x + b.st.z * b.st.z) - (a.st.x * a.st.x + a.st.z * a.st.z));
  for (const slot of slots) {
    const nx = -slot.st.tz * slot.side, nz = slot.st.tx * slot.side;
    const yaw = Math.atan2(-nx, -nz);
    const w = spec.footprint[0], d = spec.footprint[1];
    const off = slot.w / 2 + LOT_SETBACK + d / 2;
    const ox = slot.st.x + nx * off, oz = slot.st.z + nz * off;
    if (Math.hypot(ox, oz) > p.radius * 1.1) continue;
    const r = rectCorners(ox, oz, yaw, w + LOT_GAP, d + LOT_GAP);
    let clash = false;
    for (const t of taken) if (satOverlap(r, t)) { clash = true; break; }
    if (clash) continue;
    return { type: (p.cls === 'city' || p.cls === 'town') ? 2 : 0, ox, oz, yaw, w, d,
             door: [slot.st.x, slot.st.z] };
  }
  return null;
}

/* How tall a file's building is, from the ONE datum a first-touch pulse
   carries: which tool touched it. A file that was read is a cottage; a file
   that was written is a house with a floor on top. */
const PRINT_FLOORS = { Read: 1, NotebookRead: 1, Grep: 1, Glob: 1, Bash: 1, PowerShell: 1 };

/** Add one real building to a settlement and start printing it. Returns the
    record, or null if the settlement has no ground left.

    `opts.animate === false` builds the SAME building and skips the sequence:
    that is what a page reload does for a file that was already printed while
    nobody was watching (see SEED-DOC). `opts.lod` is 1 for those, because a
    seeded building is one of thirty on the map and a LOD0 kit group is nine
    draw calls; a building that is materialising in front of you is worth them
    and twenty-nine that materialised yesterday are not. */
function addLivePrint(p, path, tool, opts = {}) {
  if (!kit || !plan) return null;
  const lot = freeLot(p);
  if (!lot) return null;
  const h32 = hash32(path);
  const spec = CATALOGUE[lot.type];
  const floors = PRINT_FLOORS[tool] ? spec.floors : spec.floors + 1;
  const lod = opts.lod !== undefined ? opts.lod : 0;
  const obj = kit.make({ ...spec, floors, footprint: [lot.w, lot.d], lod,
                         seed: h32 % 100000 });
  obj.matrixAutoUpdate = false;
  obj.matrix.copy(placeMatrix(p, p.frame, lot.ox, lot.oz, lot.yaw));
  obj.name = 'printed:' + path;
  printGroup.add(obj);

  /* The lot joins the settlement's own plan, which is what makes it real: the
     overlap audit sees it, a walker's door leads to it, and the next print has
     to work round it. */
  const rec = { p, path, lot, obj, floors, tool,
                /* WHEN and BY WHICH AGENT, for the caption. A live pulse is
                   happening now and is driven by the craft over that town; a
                   seeded one carries the replay's own two facts. */
                at: opts.at || Date.now(), agent: opts.agent || null,
                seeded: opts.animate === false,
                height: floors * BuildingKit.styles[spec.style].floorH, gone: false };
  Object.assign(lot, { type: lot.type, seed: h32 % 100000, height: rec.height, printed: true });
  p.lots.push(lot);
  if (p.lots !== p.buildings) p.buildings.push(lot);
  livePrints.set(path, rec);
  if (opts.animate !== false) startPrint(rec, true);
  return rec;
}

/** Start the sequence on one record. `top` is where the cut starts (over the
    ridge) and `base` where it lands (the ground), both as distances along the
    settlement's own up axis. */
function startPrint(rec, wantRig) {
  for (const j of printJobs) if (j.rec === rec) return j;
  buildPrintRigs();
  const p = rec.p;
  const baseW = localPoint(p, p.frame, rec.lot.ox, rec.lot.oz, 0);
  const n = p.axis;
  const base = baseW.dot(n) - 0.2;
  const top = base + rec.height + 1.6;
  /* THE CUT: keep everything ABOVE the plane, and the plane starts over the
     ridge and descends to the ground, so at t=0 nothing exists and at t=1 all
     of it does. The normal is the SETTLEMENT'S up. */
  const plane = new THREE.Plane(n.clone(), -top);
  const mats = [];
  rec.obj.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const shared = o.material;
    /* CLONED, and the shared ones put back at the end: they belong to the kit
       and every other building of that style wears them. The first print of a
       given style pays one shader link for the clipping define; every print
       after it hits the program cache. */
    const clone = shared.clone();
    clone.clippingPlanes = [plane];
    clone.clipShadows = true;
    o.material = clone;
    mats.push({ mesh: o, shared, clone,
                emissive: clone.emissive ? clone.emissive.clone() : null,
                intensity: clone.emissiveIntensity });
  });
  const job = { rec, plane, mats, top, base, n, t: 0, life: printSecondsFor(rec.floors),
                after: 0, flash: -1, rig: null, sparkAt: 0,
                frame: tangentGroup(p), origin: p.axis.clone().multiplyScalar(R + p.elev) };
  printGroup.add(job.frame);
  printJobs.push(job);
  lastPrint = rec;
  if (wantRig !== false) {
    const r = freeRig();
    if (r) { r.job = job; job.rig = r; job.frame.add(r.group); r.group.visible = true; }
    cuePrint();
  }
  return job;
}

/* Two laser lines riding the print plane, the emitters that fire them, the
   lattice under it, the heat over it and the ring on the ground. All of it in
   the job's own tangent frame, where x is east, y is up and z is south — the
   city's arithmetic, unchanged, because inside that group the world is flat.
   `y` is the cut's height above the settlement's ground, `k` the print's
   progress, `after` counts up once it has landed. */
function placeRig(r, j, y, k, after) {
  const L = j.rec.lot, T = { w: L.w, d: L.d };
  const cx = L.ox, cz = -L.oz;
  const w = T.w * 1.5, d = T.d * 1.5;
  const t = clockS();
  const yBase = 0, yTop = j.top - j.base;
  const worldAt = j.frame.localToWorld(new THREE.Vector3(cx, y, cz));
  /* Never thinner than the 4.5 cm the close view was tuned on, and never
     thinner than 2.4 px on the lens — which is what makes a print visible from
     orbit at all. */
  const thin = Math.max(0.045, laserWidth(worldAt, 2.4));

  /* THE EMITTERS ARE THE DRONE'S, when there is one on station. `worker.edit`
     is the craft that writes, so while it is over this town the two laser heads
     ARE its own arm emitters and the print visibly comes out of the machine
     doing the writing. With no craft there — a demo replay, a call still
     queued, ?drones=cones — the pair falls back to the hovering positions. */
  const printer = printerOver(j.rec.p.town.id);
  const em = printer && printer.craft.userData.emitters;
  const drop = smoothstep01(0, 0.18, k);
  const headY = (yTop + 2.6) + (y + 0.55 - (yTop + 2.6)) * drop;
  const off = d * 0.5 * Math.cos(k * Math.PI * 3.0);
  const _v = new THREE.Vector3();
  for (let i = 0; i < 2; i++) {
    const sgn = i ? 1 : -1;
    const z = cz + sgn * off;
    r.lines[i].position.set(cx, y, z);
    r.lines[i].scale.set(w, 1, thin);
    let hx = cx + sgn * w * 0.42, hy = headY, hz = z;
    if (em && em[i % em.length]) {
      em[i % em.length].getWorldPosition(_v);
      j.frame.worldToLocal(_v);
      hx = _v.x; hy = _v.y; hz = _v.z;
    }
    r.heads[i].position.set(hx, hy, hz);
    r.heads[i].scale.set(0.14, 0.10, 0.14);
    /* The beam is a flat quad turned to face the lens, so it never edges out. */
    const bm = r.beams[i];
    const len = Math.max(0.02, hy - 0.05 - y);
    bm.position.set(hx, hy - 0.05, hz);
    bm.scale.set(thin * 1.6, len, 1);
    _v.copy(camera.position); j.frame.worldToLocal(_v);
    bm.rotation.y = Math.atan2(_v.x - hx, _v.z - hz);
  }
  /* THE LATTICE — four corner posts up to the printed line plus four rails at a
     belt height that rises with it. Struts and not a box, so it reads as
     scaffolding holding a shell up rather than as a crate round it. */
  const sh = Math.max(0.02, y - yBase);
  const belt = yBase + sh * 0.55;
  for (let i = 0; i < 4; i++) {
    const px = cx + (i & 1 ? 1 : -1) * T.w * 0.5;
    const pz = cz + (i & 2 ? 1 : -1) * T.d * 0.5;
    r.struts[i].position.set(px, yBase, pz);
    r.struts[i].scale.set(0.022, sh, 0.022);
    const rail = r.struts[4 + i];
    const acrossX = i < 2;
    rail.position.set(acrossX ? cx : cx + (i & 1 ? 1 : -1) * T.w * 0.5, belt,
                      acrossX ? cz + (i & 1 ? 1 : -1) * T.d * 0.5 : cz);
    rail.scale.set(acrossX ? T.w : 0.018, 0.018, acrossX ? 0.018 : T.d);
  }
  /* THE GROUND RING, always on the ground and always the footprint's own size,
     pulsing. It is the ONE mark that says "this lot is printing" from 700 units
     up; the lasers never will be. */
  r.ring.position.set(cx, yBase + 0.06, cz);
  const rs = Math.max(T.w, T.d) * (1.15 + 0.10 * Math.sin(t * 7));
  r.ring.scale.set(rs, 1, rs);
  r.haze.position.set(cx, y + 0.06, cz);
  r.haze.scale.set(w * 1.25, 1, d * 1.25);
  r.hazeMat.opacity = after > 0 ? 0 : 0.18 + 0.07 * Math.sin(t * 11);

  if (after > 0) {
    /* The lattice holds the finished shell, then shortens FROM THE TOP: the
       ground lets go last, which is the only way scaffolding ever comes off. */
    const a = smoothstep01(RIG_HOLD_SECONDS, RIG_AFTER, after);
    for (const m of r.lines.concat(r.heads, r.beams)) m.visible = false;
    r.ring.visible = false;
    const full = Math.max(0.02, yTop);
    for (let i = 0; i < 4; i++) r.struts[i].scale.y = full * (1 - a);
    for (let i = 4; i < 8; i++) r.struts[i].position.y = yBase + full * (1 - a);
    r.mat.opacity = 0.9 * (1 - a);
  } else {
    for (const m of r.lines.concat(r.heads, r.beams)) m.visible = true;
    r.ring.visible = true;
    r.mat.opacity = 0.9;
  }
}

/** One frame of every print, every flash and every derez on the planet. */
function stepPrints(dt) {
  stepSparks(dt);
  stepDerez(dt);
  const _w = new THREE.Vector3(), _v = new THREE.Vector3();
  for (let i = printJobs.length - 1; i >= 0; i--) {
    const j = printJobs[i];
    if (j.flash >= 0) {
      /* THE FLASH: white-hot for a fifth of a second, then three seconds down
         into the warm palette the planet already has. Driven on the same cloned
         materials the cut rides, which is why they are not restored until it is
         over. 0.55 and not 2.6 — with bloom on, three facades at 2.6 blow the
         whole frame to white. */
      j.flash += dt;
      const v = 1 - smoothstep01(FLASH_HOLD_SECONDS, FLASH_HOLD_SECONDS + FLASH_COOL_SECONDS, j.flash);
      for (const m of j.mats) {
        if (!m.clone.emissive) continue;
        const f = v * FLASH_PEAK;
        m.clone.emissive.setRGB(m.emissive.r + f, m.emissive.g + f * 0.86, m.emissive.b + f * 0.62);
        m.clone.emissiveIntensity = m.intensity + f;
      }
      if (v > 0.002) { if (j.rig) { j.after += dt; placeRig(j.rig, j, 0, 1, j.after); } continue; }
      endPrint(j);
      printJobs.splice(i, 1);
      continue;
    }
    j.t += dt;
    const k = Math.min(1, j.t / j.life);
    const yWorld = j.top + (j.base - j.top) * k;      // along the settlement's up
    j.plane.constant = -yWorld;
    const yLocal = yWorld - j.base;
    if (j.rig) placeRig(j.rig, j, yLocal, k, 0);
    /* Sparks off the CUTTING EDGE, where the laser is actually touching the
       shell — three every 60 ms is a shower of about twenty over a print, and
       not a fog. */
    if (k < 1 && j.t - j.sparkAt > 0.06) {
      j.sparkAt = j.t;
      const L = j.rec.lot;
      for (let s = 0; s < 3; s++) {
        _w.set(L.ox + (Math.random() - 0.5) * L.w * 1.3, yLocal,
               -L.oz + (Math.random() - 0.5) * L.d * 1.3);
        j.frame.localToWorld(_w);
        _v.copy(j.n).multiplyScalar(0.9 + Math.random() * 1.8)
          .addScaledVector(j.rec.p.frame.east, (Math.random() - 0.5) * 1.6)
          .addScaledVector(j.rec.p.frame.north, (Math.random() - 0.5) * 1.6);
        emitSpark(_w, _v, j.n.clone().negate(), LASER,
                  0.045 + Math.random() * 0.04, 0.35 + Math.random() * 0.35, 4.5);
      }
    }
    if (k >= 1) { j.flash = 0; j.after = 0.0001; }
  }
}

/** The print is over: shared materials back, the rig freed, the frame dropped. */
function endPrint(j) {
  for (const m of j.mats) { m.mesh.material = m.shared; m.clone.dispose(); }
  j.mats.length = 0;
  if (j.rig) { j.rig.group.visible = false; j.frame.remove(j.rig.group); j.rig.job = null; j.rig = null; }
  printGroup.remove(j.frame);
}

/* --- the camera cue -------------------------------------------------------
   A materialisation is the one thing this planet can show that a map cannot, so
   when one starts from a wide shot the lens goes and looks. Every guard the
   city obeys applies: it never interrupts a flight or a camera a person has
   their hand on, it is charged to the same FOCUS_BUDGET (40 % of any two-minute
   window), and when the budget is spent there is no cue and the building still
   prints. PRINT_CUE_COOLDOWN is that budget written as a rate. */
function cuePrint() {
  if (FIXED_CAM || SCREENSAVER) return;
  const now = clockS();
  if (now < printCueUntil) return;
  if (cam.fly || performance.now() - cam.lastDrag < 4000) return;
  const dur = PRINT_MAX_SECONDS + CUE_TAIL_SECONDS;
  while (focusSpent.length && focusSpent[0].t < now - FOCUS_WINDOW) focusSpent.shift();
  let spent = 0;
  for (const f of focusSpent) spent += f.dur;
  if (spent + dur > FOCUS_BUDGET) return;
  /* Multiple prints at once are framed as a GROUP — the aim is the mean of every
     settlement printing this instant, so three files materialising together are
     one shot of three rather than three fights over the lens. */
  const axis = new THREE.Vector3();
  let n = 0, elev = 0, rad = 0;
  for (const j of printJobs) { axis.add(j.rec.p.axis); elev += j.rec.p.elev; rad += j.rec.p.radius; n++; }
  if (!n) return;
  axis.normalize();
  const ll = toLL(axis);
  cuePrev = { lat: cam.lat, lon: cam.lon, dist: cam.distWant };
  flyTo(ll.lat, ll.lon, R + elev / n + rad / n * 1.1 + 18, 0.9);
  printCueUntil = now + dur + PRINT_CUE_COOLDOWN;
  focusSpent.push({ t: now, dur });
  setTimeout(() => {
    /* Back to the wide shot when the print is over, unless the person has taken
       the camera in the meantime. */
    if (!cuePrev || performance.now() - cam.lastDrag < dur * 1000) { cuePrev = null; return; }
    flyTo(cuePrev.lat, cuePrev.lon, cuePrev.dist, 1.6);
    cuePrev = null;
  }, dur * 1000);
}
const printCued = () => !!cuePrev;

/* --- derez ----------------------------------------------------------------
   A file stops existing. The construct does not simply fall apart: for 0.4 s it
   TEARS first — the clipping plane is driven to a random height every 35 ms,
   which is a scanline artifact for free because the cut is already a straight
   edge — and only then do the voxels go, red. Never a fade: a fade says the
   renderer stopped drawing it, and this has to say the construct's time was up. */
function derezPath(path) {
  const rec = livePrints.get(normPath(path));
  if (!rec || rec.gone) return false;
  rec.gone = true;
  livePrints.delete(normPath(path));
  /* A building still printing is finished first, so the two do not fight over
     one set of cloned materials. */
  let job = printJobs.find(j => j.rec === rec);
  if (!job) job = startPrint(rec, false);
  job.t = job.life; job.flash = -1;
  derezJobs.push({ job, rec, glitch: GLITCH_SECONDS, next: 0, fall: 0 });
  return true;
}

function stepDerez(dt) {
  const _w = new THREE.Vector3(), _v = new THREE.Vector3();
  for (let i = derezJobs.length - 1; i >= 0; i--) {
    const D = derezJobs[i], j = D.job, rec = D.rec, p = rec.p;
    if (D.glitch > 0) {
      D.glitch -= dt; D.next -= dt;
      if (D.next <= 0) {
        D.next = 0.035;
        j.plane.constant = -(j.base + Math.random() * (j.top - j.base));
      }
      if (D.glitch > 0) continue;
    }
    D.fall += dt;
    if (D.fall < 0.02) {
      /* THE VOXELS. Twenty-six red points thrown out of the shell's own volume,
         with the planet's own down under them. */
      for (let s = 0; s < 26; s++) {
        _w.set(rec.lot.ox + (Math.random() - 0.5) * rec.lot.w * 1.4,
               Math.random() * rec.height,
               -rec.lot.oz + (Math.random() - 0.5) * rec.lot.d * 1.4);
        j.frame.localToWorld(_w);
        _v.copy(p.axis).multiplyScalar(0.6 + Math.random() * 3.2)
          .addScaledVector(p.frame.east, (Math.random() - 0.5) * 3.2)
          .addScaledVector(p.frame.north, (Math.random() - 0.5) * 3.2);
        emitSpark(_w, _v, p.axis.clone().negate(), LASER,
                  0.07 + Math.random() * 0.06, 0.6 + Math.random() * 0.7, 6.5);
      }
      /* The shell goes with the first voxel: it has already been cut to nothing
         by the glitch and leaving it a frame longer is a flicker. */
      endPrint(j);
      const k = printJobs.indexOf(j);
      if (k >= 0) printJobs.splice(k, 1);
      printGroup.remove(rec.obj);
      disposeTree(rec.obj);
      const li = p.lots.indexOf(rec.lot);
      if (li >= 0) p.lots.splice(li, 1);
      const bi = p.buildings.indexOf(rec.lot);
      if (bi >= 0 && p.buildings !== p.lots) p.buildings.splice(bi, 1);
      if (lastPrint === rec) lastPrint = null;
      continue;
    }
    derezJobs.splice(i, 1);
  }
}

/* --- the seam: one pulse in, one building out ------------------------------
   A pulse names a town, a tool and a path. Four things happen and only four:
   the town's craft turn their effect on, a path this settlement has never seen
   prints a new building, a `file_deleted` derezzes the one that path built, and
   a `pulse_end` cools the craft. Nothing here interprets the event further —
   the globe forwards, it does not guess. */
function onGlobePulse(townId, kind, msg) {
  if (kind === 'pulse_end') { setDroneWorking(townId, null, false); return; }
  if (kind === 'file_deleted') { derezPath(msg.path); return; }
  if (kind !== 'pulse') return;
  setDroneWorking(townId, msg.tool, true);
  const path = normPath(msg.path);
  if (!path || !plan) return;
  if (msg.tool === 'delete') { derezPath(path); return; }
  const p = plan.byId.get(townId);
  if (!p || !p.town.is_live || p.cls === 'fields') return;
  if (!p.printed) p.printed = new Set();
  if (p.printed.has(path) || livePrints.has(path)) return;   // already standing
  if (printJobs.length >= MAX_PRINT_RIGS + 2) return;        // the frame has a limit
  const rec = addLivePrint(p, path, msg.tool);
  if (rec) p.printed.add(path);
}

/** `P` — replay the last print over the shell that already stands. VISUAL ONLY:
    no event, no new building, no count. The one way to look at the sequence
    again without waiting for the machine to touch a new file. */
function replayLastPrint() {
  if (!lastPrint || lastPrint.gone || !lastPrint.obj) return null;
  startPrint(lastPrint, true);
  return lastPrint.path;
}

/* --- ?demo=print -----------------------------------------------------------
   The materialisation, watched on purpose. Takes the busiest LIVE town's own
   replay, keeps every file its sessions touched for the FIRST time in the last
   thirty minutes of that payload, and prints them in order at half speed.
   Nothing is staged: the events are that town's own tool calls with their own
   spacing, and every path is a file that really exists. The payload is tens of
   megabytes for a busy town, which is why this is a flag and not a mode. */
const DEMO_WINDOW_MS = 30 * 60 * 1000, DEMO_RATE = 0.5;
async function startPrintDemo() {
  const live = plan.placed.filter(p => p.town.is_live && p.cls !== 'fields');
  if (!live.length) { console.warn('?demo=print: nothing is live'); return; }
  const busiest = live.reduce((a, b) => ((b.town.tool_calls || 0) > (a.town.tool_calls || 0) ? b : a));
  let rep;
  try { rep = await (await fetch('/api/project?id=' + encodeURIComponent(busiest.town.id))).json(); }
  catch (e) { console.warn('?demo=print: ' + e.message); return; }
  const events = rep.events || [];
  if (!events.length) return;
  const end = events[events.length - 1].t;
  const seen = new Set(), script = [];
  for (const ev of events) {
    if (ev.kind !== 'tool' || !ev.path) continue;
    const q = normPath(ev.path);
    if (seen.has(q)) continue;
    seen.add(q);
    if (ev.t < end - DEMO_WINDOW_MS) continue;      // first touch, but before the window
    script.push({ at: ev.t - (end - DEMO_WINDOW_MS), tool: ev.tool, path: q });
  }
  if (!script.length) { console.warn('?demo=print: no first touches in the last 30 min'); return; }
  /* The clock starts at the FIRST event rather than at the window's edge, so a
     demo whose cluster is at the end does not open with eleven silent minutes. */
  const t0 = script[0].at;
  for (const s of script) {
    setTimeout(() => onGlobePulse(busiest.town.id, 'pulse', { tool: s.tool, path: s.path }),
               (s.at - t0) / DEMO_RATE);
  }
  const ll = toLL(busiest.axis);
  flyTo(ll.lat, ll.lon, R + busiest.elev + busiest.radius * 1.3 + 22, 2.4);
  console.log(`?demo=print: ${script.length} first touches from ${busiest.town.name}, at ${DEMO_RATE}x`);
}


/* --- WHAT WAS PRINTED WHILE NOBODY WAS WATCHING  <!-- GLOBE-SEED-DOC -->------

   Round 4's own "what it does NOT do": *a printed building is not persisted; a
   reload rebuilds the planet from /api/world and a file first touched an hour
   ago has no building on it.* This is that row, and the store it reads is the
   machine's own history rather than a file this page writes: `/api/project` is
   a merged replay of every session attributed to a town, so the question "which
   files did this town first touch in the last day" is already answerable and
   already cached server-side.

   FOUR THINGS THAT ARE NOT OBVIOUS AND WERE ALL MEASURED AGAINST THE LIVE API:

   1. **`t` IS RELATIVE.** Every event's `t` is milliseconds from
      `session.started`, not an epoch — the first event of every reply is `t: 0`.
      A window compared against `Date.now()` therefore keeps everything or
      nothing. The absolute clock is `Date.parse(session.started) + ev.t`.
   2. **`?since=` FILTERS SESSIONS BY THEIR OWN START, not events by their time.**
      A session that began 30 h ago and wrote a file 10 minutes ago is invisible
      to `since = now - 24 h`. Measured: `claude-live` at `since = 24 h` returns
      26 events; at 48 h it returns 21,070. So the REQUEST window is 48 h and the
      EVENT window is the brief's 24 h, applied here.
   3. **A REPLAY'S PATHS ARE NOT ALL THIS TOWN'S.** One agent session that
      touches files in four projects is folded into all four towns, so
      `/api/project?id=<any of them>` carries the same 649 paths. Measured on
      this payload: 565 paths first-touched inside 24 h, of which **98** are
      under `claude-live`'s own root and **1** under `wild-digital-moments-site`'s.
      The response's own `root` is the filter, and without it every live town
      grows the same village.
   4. **A COLD CALL COMES BACK `partial: true`** — `PROJECT_BUDGET_SECS` is 8 s
      and the server finishes the build in the background — so a partial answer
      is USED (it is real, just short) and not retried: the next reload sees the
      complete one. `partial` is reported by `__seeded()` rather than hidden.

   The cap is a draw-call decision, not a taste one: a seeded building is a real
   BuildingKit group, and `claude-live` alone has ninety-eight files that
   qualify. `PERSIST_PER_TOWN` of them at LOD1 is what a map of the last day
   costs; the rest are in the count `__seeded()` reports as `skipped`.
   ------------------------------------------------------------------------- */
const PERSIST_SINCE_H = 48;      // how far back a SESSION may have started (see 2)
const PERSIST_FRESH_H = 24;      // the brief's window: first touched inside it
const PERSIST_TOWNS = 3;         // live towns, most recently active first
const PERSIST_PER_TOWN = 10;     // buildings each, oldest touch first
const PERSIST_OFF = params.get('persist') === '0';
const seedStats = { towns: 0, seeded: 0, skipped: 0, partial: 0, ms: 0, done: false };

/** Seed one town's buildings from its own replay. Returns how many stood up. */
async function seedTown(p, sinceIso) {
  let rep;
  try {
    rep = await (await fetch('/api/project?id=' + encodeURIComponent(p.town.id) +
                             '&since=' + encodeURIComponent(sinceIso))).json();
  } catch (e) { console.warn('seed ' + p.town.name + ': ' + e.message); return 0; }
  if (rep.partial) seedStats.partial++;
  const t0 = Date.parse((rep.session || {}).started || '');
  const root = normPath(rep.root || p.town.path || '').toLowerCase();
  if (!isFinite(t0) || !root) return 0;
  const cutoff = Date.now() - PERSIST_FRESH_H * 3600000;

  const first = new Map();
  for (const ev of (rep.events || [])) {
    if (ev.kind !== 'tool' || !ev.path) continue;
    const q = normPath(ev.path);
    if (!first.has(q)) first.set(q, ev);
  }
  const fresh = [];
  for (const [q, ev] of first) {
    if (!q.toLowerCase().startsWith(root + '/')) continue;      // see note 3
    const at = t0 + ev.t;                                       // see note 1
    if (at < cutoff) continue;
    if (livePrints.has(q)) continue;                            // already standing
    fresh.push({ q, at, tool: ev.tool, agent: ev.agent });
  }
  /* OLDEST FIRST: `freeLot()` grows a settlement at its EDGE, so printing the
     day's files in the order they were touched puts the morning's work nearest
     the square and the last hour's furthest out — the settlement records the
     shape of the day rather than a random handful of it. */
  fresh.sort((a, b) => a.at - b.at);
  if (!p.printed) p.printed = new Set();
  let n = 0;
  for (const f of fresh) {
    if (n >= PERSIST_PER_TOWN) { seedStats.skipped++; continue; }
    const rec = addLivePrint(p, f.q, f.tool,
                             { animate: false, lod: 1, at: f.at, agent: f.agent });
    if (!rec) { seedStats.skipped++; continue; }
    /* The same set `onGlobePulse()` checks, which is what makes "only NEW
       pulses print" true: a file that already has a house does not get a
       second one when the machine touches it again this session. */
    p.printed.add(f.q);
    n++;
  }
  return n;
}

/** Every live town's last day, on the ground. Runs AFTER the planet is built
    and one town at a time: a replay is megabytes of JSON and two of them parsed
    in the same tick is a visible hitch on a page whose whole point is that it
    keeps moving. */
async function seedPrintedBuildings() {
  if (PERSIST_OFF || !plan || !kit) return;
  const t = performance.now();
  const sinceIso = new Date(Date.now() - PERSIST_SINCE_H * 3600000).toISOString();
  const towns = plan.placed
    .filter(p => p.town.is_live && p.cls !== 'fields' && p.lanes && p.lanes.length)
    .sort((a, b) => Date.parse(b.town.last_active || 0) - Date.parse(a.town.last_active || 0))
    .slice(0, PERSIST_TOWNS);
  for (const p of towns) {
    seedStats.towns++;
    seedStats.seeded += await seedTown(p, sinceIso);
  }
  seedStats.ms = Math.round(performance.now() - t);
  seedStats.done = true;
  if (seedStats.seeded) {
    refreshCounts();
    console.log(`seeded ${seedStats.seeded} building(s) from the last ` +
                `${PERSIST_FRESH_H} h across ${seedStats.towns} live town(s), ` +
                `${seedStats.ms} ms`);
  }
}


function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      const list = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of list) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}


/* =============================================================================
   BUILD — the whole planet, in the one order that works
   planPlanet() first, because the pads it registers are what elevAt() flattens
   the ground with while buildPlanet() is making it. Everything after that reads
   the same height field, which is why nothing floats and nothing sinks.
   ========================================================================== */
function buildWorld() {
  const t0 = performance.now();
  /* Everything that materialises lives in one group, made before the planet so
     a pulse arriving during the build has somewhere to land. */
  printGroup = new THREE.Group();
  printGroup.name = 'prints';
  scene.add(printGroup);
  plan = planPlanet();
  buildLights();
  buildPlanet();
  buildOcean();
  buildClouds();
  buildAtmosphere();
  plan.built = buildSettlements();
  plan.roadCounts = buildRoads();
  plan.treeCount = buildForests();
  plan.landmarkCount = buildLandmarks();
  plan.signCount = buildSigns();
  plan.regionCount = buildVaultRegions();
  plan.noteCount = buildVaultNotes();
  plan.lightCount = buildNightLights();
  rebuildLive();
  refreshCounts();
  plan.buildMs = Math.round(performance.now() - t0);
  dom['a11y-status'].textContent =
    `${plan.placed.length} settlements on the planet: ${plan.counts.city || 0} cities, ` +
    `${plan.counts.town || 0} towns, ${plan.counts.village || 0} villages, ` +
    `${plan.counts.hamlet || 0} hamlets and ${plan.counts.fields || 0} fields.`;
}


/* =============================================================================
   THE CAMERA — two angles and a distance, and a tilt that arrives on its own
   Google Earth's transition is the reference and its one real idea is this:
   from orbit you look straight DOWN, and by the time you are over a street you
   are looking at the HORIZON, and nobody ever asked for that to happen. It is a
   function of altitude, not a mode.
   ========================================================================== */
function updateCamera(dt) {
  /* Free fly owns the lens outright while it is on — see toggleFreeFly(). */
  if (free.on) { updateFreeFly(dt); return; }
  if (cam.fly) {
    const f = cam.fly;
    f.t = Math.min(1, f.t + dt / f.dur);
    const k = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;   // ease in-out cubic
    cam.lat = mix(f.lat0, f.lat1, k);
    cam.lon = f.lon0 + shortestLon(f.lon0, f.lon1) * k;
    /* Distance eased in LOG space. Linear interpolation from 2,350 to 610
       spends four fifths of the flight in orbit and then slams the last 200
       units — the whole descent happens in the final 12 %. In log space the
       ground grows at a constant rate, which is what "flying in" looks like. */
    cam.dist = Math.exp(mix(Math.log(f.d0), Math.log(f.d1), k));
    cam.distWant = cam.dist;
    if (f.t >= 1) cam.fly = null;
  } else {
    if (cam.auto && performance.now() - cam.lastDrag > 20000) cam.lon += cam.spin * dt;
    /* Log easing here too, for the same reason: a scroll wheel should feel the
       same at 3,000 units and at 12. */
    const l = Math.log(cam.dist), lw = Math.log(cam.distWant);
    cam.dist = Math.exp(l + (lw - l) * Math.min(1, dt * 6));
  }
  cam.lat = clamp(cam.lat, -86, 86);

  const dir = ll(cam.lat, cam.lon);
  const ground = R + Math.max(0.2, elevAt(dir));
  cam.dist = Math.max(ground + 2.6, cam.dist);
  const alt = cam.dist - ground;
  /* THE TILT. Straight down until 260 units up, fully out to the horizon by 25.
     Both numbers are ALTITUDES, so the curve behaves the same over a mountain
     and over the sea, which a distance-from-centre version does not.
     260/25, not 900/60: at 900 the tilt was already 0.7 by the time the frame
     held one continent, so the continent capture came back four fifths sky with
     a strip of land along the bottom. A region view is a map — it is looked at
     from above. The horizon is what a STREET is looked at from. */
  cam.tilt = smoothstep(260, 25, alt);
  const pitch = mix(Math.PI / 2, 0.34, cam.tilt);

  const fr = frameAt(dir);
  const target = dir.clone().multiplyScalar(ground);
  camera.position.copy(target)
    .addScaledVector(fr.up, alt * Math.sin(pitch))
    .addScaledVector(fr.north, -alt * Math.cos(pitch));
  /* The aim rises off the ground as the camera lies down, or the near ground
     fills the bottom two thirds of the frame at street level. */
  /* The screen's up vector, and it CANNOT be fr.up at orbit. Looking straight
     down, the direction from the target to the camera IS fr.up — so lookAt gets
     a forward vector parallel to its own up, the cross product is zero and the
     resulting orientation is undefined: the planet slid off the frame between
     one capture and the next with the camera reporting the same lat, lon and
     distance both times. Local NORTH is the right up vector for a map seen from
     above; local UP is the right one for a horizon. The tilt is already exactly
     that blend, so it is the blend. */
  camera.up.copy(fr.north).lerp(fr.up, cam.tilt).normalize();
  /* 0.45 and 0.16, down from 1.9 and 0.10. The forward term is how far past the
     point under the lens the camera aims once it has lain down; at 1.9 it aimed
     twice its own altitude beyond the town it had just flown to, so the street
     capture looked at the country BEHIND the village. The eye is already about
     0.9 of the altitude back from the target, so 0.45 forward puts the target
     itself two thirds of the way up the lower half of the frame — which is
     where the thing you flew to belongs. */
  camera.lookAt(target.clone().addScaledVector(fr.up, alt * 0.16 * cam.tilt)
                      .addScaledVector(fr.north, alt * 0.45 * cam.tilt));
  /* Leaving free fly EASES back onto the orbit rather than cutting. The orbit
     pose solved just above is already the flyer's own lat/lon/altitude — free
     fly writes those every frame — so this blends out the flyer's heading and
     eye height over FREE_EASE seconds instead of jumping home. A cut here reads
     as a bug even when it is not. */
  if (free.back > 0) {
    free.back = Math.max(0, free.back - dt / FREE_EASE);
    const e = free.back * free.back * (3 - 2 * free.back);        // smoothstep
    _oPos.copy(camera.position); _oQuat.copy(camera.quaternion);
    camera.position.lerpVectors(_oPos, free.backPos, e);
    camera.quaternion.slerpQuaternions(_oQuat, free.backQuat, e);
  }
  camera.updateMatrixWorld();
}


/* =============================================================================
   FREE FLY — "F" — the lens off the string, and still never lost

   `cam` above says a free-fly camera on a sphere gets lost and never finds a
   continent again, and that was true of the flyer that was meant then: a
   position and a quaternion, six degrees of freedom, one stray roll and you are
   in space with no horizon to recover from. This one has no such state. The
   lens is an AXIS — which point of the sphere it is over — an ALTITUDE above
   the ground at that point, and a bearing measured from LOCAL NORTH. The basis
   is rebuilt from the axis every frame, so "up" is up wherever you fly to, W is
   always along the ground, and there is no pose from which the planet is not
   underneath. Getting lost is not prevented by a clamp here; it is unreachable.
   ========================================================================== */
const free = {
  on: false,
  axis: new THREE.Vector3(1, 0, 0),   // the point of the sphere under the lens
  alt: 60,                            // metres above the ground THERE
  yaw: 0,                             // bearing, radians, from local north toward east
  pitch: 0,                           // up/down off the tangent plane
  /* The pose free fly was left in, and how much of it is still mixed into the
     orbit pose: 1 the instant F is released, 0 when the ease has finished. */
  back: 0, backPos: new THREE.Vector3(), backQuat: new THREE.Quaternion(),
};
const FREE_BASE = 26;                 // m/s at street level, before the altitude term
const FREE_MIN = 0.8;                 // m/s floor — a slow camera, never a stuck one
const FREE_ALT_MIN = 2;               // eye height over the pad, the island's FREE_EYE
const FREE_ALT_MAX = 400;             // above this the orbit's own map view is the tool
const FREE_LOOK = 0.0026;             // radians per pixel of mouse, the island's number
const FREE_EASE = 0.7;                // seconds to blend back onto the orbit
const _ffwd = new THREE.Vector3(), _fright = new THREE.Vector3();
const _flook = new THREE.Vector3(), _fflat = new THREE.Vector3();
const _oPos = new THREE.Vector3(), _oQuat = new THREE.Quaternion();
const keys = new Set();               // only ever read while free.on

/* Entering starts from EXACTLY where the orbit lens is standing and looking, so
   F is a change of control and not a cut to somewhere else. yaw and pitch are
   read off the look DIRECTION rather than camera.rotation: the renderer's Euler
   order is XYZ and these two angles compose in the local frame, which is a
   different decomposition and gives a different — wrong — heading. */
function toggleFreeFly() {
  if (!built) return;
  if (!free.on) {
    free.axis.copy(camera.position).normalize();
    const ground = R + Math.max(0.2, elevAt(free.axis));
    free.alt = clamp(camera.position.length() - ground, FREE_ALT_MIN, FREE_ALT_MAX);
    const fr = frameAt(free.axis);
    camera.getWorldDirection(_flook);
    free.pitch = clamp(Math.asin(clamp(_flook.dot(fr.up), -1, 1)), -1.45, 1.45);
    _fflat.copy(_flook).addScaledVector(fr.up, -_flook.dot(fr.up));
    free.yaw = _fflat.lengthSq() < 1e-9 ? 0
             : Math.atan2(_fflat.dot(fr.east), _fflat.dot(fr.north));
    free.on = true; free.back = 0; free.backPos.set(0, 0, 0);
    cam.fly = null;
  } else {
    free.backPos.copy(camera.position);
    free.backQuat.copy(camera.quaternion);
    free.on = false; free.back = 1;
    keys.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  if (dom['free-hud']) dom['free-hud'].hidden = !free.on;
  dom['a11y-status'].textContent = free.on
    ? 'Free flight. W A S D along the ground, Q and E down and up, shift to go faster, F to go back.'
    : 'Back to the orbit.';
}

/* WASD on the TANGENT PLANE, Q/E through the altitude. Two things here are not
   obvious. The first is the SPEED: a step that feels right in a street takes a
   minute to cross a continent, so it scales with how high the lens is and never
   falls under FREE_MIN, because a camera that cannot move is broken rather than
   careful. The second is that W follows the HEADING and not the look direction
   — pitching down and pressing W on a sphere is a dive into the ground, and the
   whole point of a surface-relative flyer is that it walks the surface. */
function updateFreeFly(dt) {
  const ground = R + Math.max(0.2, elevAt(free.axis));
  const step = Math.max(FREE_MIN, FREE_BASE * (0.12 + free.alt / 90)) *
               (keys.has('shift') ? 4 : 1) * dt;
  let fr = frameAt(free.axis);
  _ffwd.copy(fr.north).multiplyScalar(Math.cos(free.yaw))
       .addScaledVector(fr.east, Math.sin(free.yaw)).normalize();
  _fright.copy(fr.east).multiplyScalar(Math.cos(free.yaw))
         .addScaledVector(fr.north, -Math.sin(free.yaw)).normalize();

  /* A metre along the ground is `1 / radius` radians of axis, which is why the
     same key crosses a continent from orbit and a street from a street without
     a second speed anywhere. */
  const radius = ground + free.alt;
  let moved = false;
  const walk = (v, s) => { free.axis.addScaledVector(v, s / radius); moved = true; };
  if (keys.has('w')) walk(_ffwd, step);
  if (keys.has('s')) walk(_ffwd, -step);
  if (keys.has('d')) walk(_fright, step);
  if (keys.has('a')) walk(_fright, -step);
  if (moved) free.axis.normalize();
  if (keys.has('e')) free.alt += step;
  if (keys.has('q')) free.alt -= step;
  /* The only collision in free fly, and it is a clamp on the ALTITUDE rather
     than a floor under the position: the ground moved while we walked, so a
     y-test against the old height lets the lens into a hillside. */
  free.alt = clamp(free.alt, FREE_ALT_MIN, FREE_ALT_MAX);

  const g2 = R + Math.max(0.2, elevAt(free.axis));      // the ground where we ARE now
  camera.position.copy(free.axis).multiplyScalar(g2 + free.alt);
  fr = frameAt(free.axis);
  _ffwd.copy(fr.north).multiplyScalar(Math.cos(free.yaw))
       .addScaledVector(fr.east, Math.sin(free.yaw)).normalize();
  _flook.copy(_ffwd).multiplyScalar(Math.cos(free.pitch))
        .addScaledVector(fr.up, Math.sin(free.pitch));
  /* Local up is the camera's up, so there is no roll to accumulate and the
     horizon is level at every point of the planet. */
  camera.up.copy(fr.up);
  camera.lookAt(_flook.multiplyScalar(60).add(camera.position));
  camera.updateMatrixWorld();

  /* The rest of the page reads cam.lat/lon/dist — the sun, the shadow fit, the
     near settlement, the signs, the living layer. Free fly moves the LENS, so
     it writes them back every frame or the flyer arrives over a town that was
     never built. lastDrag too: the auto-spin must not fight the flyer. */
  const c = toLL(free.axis);
  cam.lat = c.lat; cam.lon = c.lon;
  cam.dist = cam.distWant = g2 + free.alt;
  cam.tilt = smoothstep(260, 25, free.alt);
  cam.lastDrag = performance.now();
}

/** Degrees to travel from a to b the short way round. Without this a flight
    from lon 179 to lon -179 goes the whole way round the planet. */
function shortestLon(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function flyTo(lat, lon, dist, dur = 2.4) {
  cam.fly = { lat0: cam.lat, lon0: cam.lon, d0: cam.dist,
              lat1: lat, lon1: lon, d1: clamp(dist, DIST_MIN, DIST_MAX), t: 0, dur };
  cam.lastDrag = performance.now();
}

function flyToPlace(p, dist) {
  const c = toLL(p.axis);
  flyTo(c.lat, c.lon, dist !== undefined ? dist
        : R + p.elev + p.radius * 2.1 + 26);
}


/* =============================================================================
   THE SUN, EVERY FRAME — one direction, and everything that follows from it
   ========================================================================== */
const sunDir = new THREE.Vector3(1, 0, 0);
function updateSun() {
  sunDir.copy(sunDirection());
  /* How much night the CAMERA is in — the exposure, the hemisphere light and
     the cloud tone follow the lens, not the planet, because the planet is half
     lit at all times and a single global "night" would be a lie either way. */
  const under = ll(cam.lat, cam.lon);
  const lit = under.dot(sunDir);
  nightAmount = smoothstep(0.10, -0.22, lit);

  sunLight.position.copy(sunDir).multiplyScalar(R * 4).add(
    ll(cam.lat, cam.lon).multiplyScalar(0));
  sunLight.target.position.set(0, 0, 0);
  sunLight.intensity = 3.1;
  sunLight.color.setHex(0xffe6c2);
  hemi.intensity = 0.42 - nightAmount * 0.24;
  hemi.color.setHex(nightAmount > 0.5 ? 0x2b3c56 : 0x8fb3cc);

  scene.environment = nightAmount > 0.55 ? envNight : envDay;
  scene.environmentIntensity = 1.15 - nightAmount * 0.72;
  renderer.toneMappingExposure = 0.85 - nightAmount * 0.16;

  /* The coarse-scale blend, once a frame for the whole ground — see uCoarse. */
  const coarse = smoothstep(120, 520, cam.dist - R);
  for (const m of groundMaterials) if (m.userData.uni) {
    m.userData.uni.uSun.value.copy(sunDir);
    m.userData.uni.uCloudRot.value = cloudRot;
    m.userData.uni.uCoarse.value = coarse;
  }
  if (oceanMesh) {
    const u = oceanMesh.material.uniforms;
    u.uSun.value.copy(sunDir);
    u.uNight.value = nightAmount;
    /* uTime was declared and never written, so both scrolling reads of the wave
       normal sat at t=0 and the sea was a still photograph. It drives the two
       normal scrolls AND the foam surge. */
    u.uTime.value = performance.now() / 1000;
  }
  if (atmoMesh) {
    atmoMesh.material.uniforms.uSun.value.copy(sunDir);
    atmoMesh.material.uniforms.uNight.value = nightAmount * 0.5;
    /* 240 to 45. uInside is how much of the frame is AIR. It was 112/14, which
       drew a midnight-blue zenith over a village lit by a sun forty-eight
       degrees high; 300/60 was then too generous the other way and put a
       quarter of a screen of additive haze over every REGION view, which is a
       map and wants to be crisp. 240/45 is 0.03 at region altitude and 0.85 at
       a village street. */
    atmoMesh.material.uniforms.uInside.value = smoothstep(240, 45, cam.dist - R);
  }
  if (cloudMesh) {
    cloudMesh.material.uniforms.uSun.value.copy(sunDir);
    cloudMesh.material.uniforms.uNight.value = nightAmount;
    cloudMesh.material.uniforms.uRot.value = cloudRot;
    cloudMesh.material.uniforms.uHigh.value = smoothstep(120, 520, cam.dist - R);
  }
  if (lightsPoints) {
    lightsPoints.material.uniforms.uSun.value.copy(sunDir);
    lightsPoints.material.uniforms.uPix.value = window.innerHeight * 0.5;
  }
  /* The weather puffs fade out on the way down, the same way the shipping lanes
     are hidden below 140 units: both are map symbols and neither survives being
     stood underneath. Full above 320 units, gone by 140. */
  const puffFade = smoothstep(220, 480, cam.dist - R);
  if (liveGroup) liveGroup.traverse(o => {
    if (o.material && o.material.uniforms && o.material.uniforms.uSun)
      o.material.uniforms.uSun.value.copy(sunDir);
    if (o.material && o.material.uniforms && o.material.uniforms.uFade)
      o.material.uniforms.uFade.value = puffFade;
  });
  /* THE LAMPS come on before the dark does, exactly as on the island: a window
     is switched by a person who cannot read any more, which happens while the
     sun is still above the horizon. */
  const lamps = clamp((0.16 - lit) / 0.32, 0, 1);
  for (const m of litMaterials) m.userData.uNight.value = lamps;
  /* ONE call for every building on the planet, driven by THIS page's sun —
     docs/BUILDINGS.md's integration note asks for exactly that rather than a
     second clock inside the kit. setEnvironment is guarded because it sets
     needsUpdate on every material it touches, and doing that every frame
     recompiles nothing but costs a full material walk sixty times a second. */
  if (kit) {
    kit.setNight(lamps);
    const wantEnv = nightAmount > 0.55 ? envNight : envDay;
    if (kit.userEnv !== wantEnv) { kit.setEnvironment(wantEnv); kit.userEnv = wantEnv; }
  }

  /* SHADOWS ONLY NEAR THE CAMERA. A shadow camera big enough to cover a planet
     puts one texel of a 1024 map across forty metres, which is a shadow nobody
     can see paying for a full extra pass. Below 400 units of altitude it is
     fitted to what is actually in front of the lens; above it, off. */
  /* FOG THAT IS NOT THERE FROM ORBIT. Fog is a function of distance from the
     LENS, and from orbit that fogs the far LIMB — the one edge the atmosphere
     needs sharp — so its density is zero above 200 units and ramps in below
     that, where it stops being wrong and becomes the thing that gives a valley
     depth. The fog OBJECT is always present and only its density moves:
     assigning scene.fog = null and back recompiles every standard material on
     the crossing, which is a visible stall in the middle of a descent.
     Only the standard materials read it — the ocean, the sky shell and the
     cloud deck are custom shaders with no fog chunk, which is exactly the set
     that must not be fogged. */
  const fogAmt = smoothstep(200, 20, cam.dist - R);
  scene.fog.density = 0.0016 * fogAmt;
  scene.fog.color.setHex(nightAmount > 0.5 ? 0x141a26 : 0x8fa6b4);

  const alt = cam.dist - R;
  /* 220, not 420. A shadow map fitted to a 420-unit altitude puts one texel
     across four metres, which is a shadow nobody can point at, and it costs a
     full extra pass over every building and tree in the frame. Shadows are for
     where you can see them. */
  const want = quality === 'high' && alt < 220;
  sunLight.castShadow = want;
  if (want) {
    const s = clamp(alt * 1.6 + 40, 60, 700);
    const sc = sunLight.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.near = R * 2; sc.far = R * 6.4;
    const focus = ll(cam.lat, cam.lon).multiplyScalar(R + 10);
    sunLight.position.copy(focus).addScaledVector(sunDir, R * 3);
    sunLight.target.position.copy(focus);
    sunLight.target.updateMatrixWorld();
    sc.updateProjectionMatrix();
  }
}
let cloudRot = 0;


/* =============================================================================
   THE FRAME
   ========================================================================== */
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsRing[fpsPtr = (fpsPtr + 1) % fpsRing.length] = Math.max(0.001, (now - (frame.prev || now)) / 1000);
  frame.prev = now;

  if (!renderer) return;
  cloudRot += dt * 0.0016;                 // one turn of the deck in ~10 minutes
  updateCamera(dt);
  if (built) {
    updateSun();
    updateSigns();
    updateRegionSigns();
    updateNearTown();
    updateTreeLod();
    updateDrones(now / 1000, dt);
    /* ONE kit.update a frame with the REAL camera, or nothing falls to LOD1 and
       every craft draws its full 41 k-triangle airframe from orbit. */
    if (droneKit) { droneKit.setNight(nightAmount); droneKit.update(dt, camera); }
    updateLife(dt);
    stepPrints(dt);
    /* Shipping lanes and the gold sea arcs are a MAP feature: they stand up to
       22 units off the water, and from 60 units up that projects as a set of
       dead-straight cream lines across the sky above the horizon — read off the
       close field capture. Above 140 units they are routes; below it they are
       wires, so they are simply not drawn there. */
    const mapScale = (cam.dist - R) > 140;
    if (laneMesh) laneMesh.visible = mapScale;
    if (laneLiveMesh) laneLiveMesh.visible = mapScale;
    if (starField) {
      starField.material.uniforms.uPix.value = window.innerHeight * 0.5;
      /* Stars go out under a daylight sky and come back at night and in orbit —
         the same reason you cannot see them from a sunlit street. */
      /* 420 to 70, not 90 to 10. A star is invisible under a DAYLIT SKY, and the
         sky is lit long before the camera is inside the shell: the first street
         capture had a full starfield over a sunlit village at 84 units, where
         the old curve had only dimmed them by 7 %. Night brings them back at
         every altitude, which is the other half of the same rule. */
      const inAir = smoothstep(420, 70, cam.dist - R);
      starField.material.uniforms.uDim.value = 1 - inAir * (1 - nightAmount) * 0.97;
    }
  }
  tickClock();
  composer ? composer.render() : renderer.render(scene, camera);

  /* Auto-degrade, same contract as the island: the page drops itself to medium
     rather than stuttering, and says so once. __autoDegrade(false) stops it, so
     the frame-rate gate can be measured without the instrument moving. */
  if (autoDegrade && built && fpsNow() < 33 && quality === 'high' && now > 12000) {
    setQuality('medium', true);
  }
}
const fpsNow = () => 1 / (fpsRing.reduce((a, b) => a + b, 0) / fpsRing.length);

function setQuality(q, auto) {
  quality = q;
  /* The population is capped per quality, so dropping to medium has to re-read
     it — otherwise the auto-degrade saves the shadows and the pixel ratio and
     leaves the crowd it was trying to afford exactly where it was. */
  if (life && stagePlace) setPopulation(stagePlace);
  renderer.shadowMap.enabled = q === 'high';
  /* The phone's clamp is the same 1.5 the desktop's `high` uses and it applies
     at EVERY quality: a 3x phone at `medium` would otherwise drop to 1 and the
     text baked into the plaques would go soft for no frame rate anybody needed. */
  renderer.setPixelRatio(MOBILE ? Math.min(window.devicePixelRatio || 1, MOBILE_DPR)
                                : (q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.5) : 1));
  if (bloomPass) bloomPass.enabled = q === 'high';
  if (cloudMesh) cloudMesh.visible = true;
  toast(auto ? 'quality: medium (frame rate)' : 'quality: ' + q);
  resize();
}
let toastTimer = 0;
function toast(text) {
  if (SCREENSAVER || !dom.quality) return;
  dom.quality.textContent = text;
  dom.quality.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.quality.hidden = true; }, 2200);
}


/* =============================================================================
   THE CHROME — counts, clock, hover, caption
   Every number here is a count of something that actually happened. Nothing is
   rounded up, projected or padded to look busier than the machine is.
   ========================================================================== */
function refreshCounts() {
  if (!plan || !dom['globe-counts']) return;
  const c = plan.counts;
  const alive = plan.placed.filter(p => p.town.is_live).length;
  const meta = (world && world.meta) || {};
  const agents = meta.agents_in_flight !== undefined ? meta.agents_in_flight
    : plan.placed.reduce((n, p) => n + ((p.town.live_agents || []).length), 0);
  dom['globe-counts'].innerHTML =
    `<b>${plan.placed.length}</b> settlements · <b>${c.city || 0}</b> cities · ` +
    `<b>${c.town || 0}</b> towns · <b>${c.village || 0}</b> villages · ` +
    `<b>${c.hamlet || 0}</b> hamlets · <b>${c.fields || 0}</b> fields · ` +
    `<span class="alive">${alive} alive</span> · ${agents} agents in flight`;
}

function tickClock() {
  if (!dom['globe-clock']) return;
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  dom['globe-clock'].textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function refreshLabels() { /* the canvas labels are baked once fonts are ready */
  if (!fontsReady || !plan) return;
  for (const s of signSprites) {
    const p = s.userData.place;
    if (!p) continue;
    const fresh = signSprite(p);
    if (!fresh) continue;
    s.material.map.dispose();
    s.material.map = fresh.material.map;
    s.material.needsUpdate = true;
    s.userData.aspect = fresh.userData.aspect;
  }
  if (p_logoQueue.length) loadLogos();
}

const ago = ms => {
  const s = Math.max(0, ms / 1000);
  if (s < 90) return Math.round(s) + 's ago';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
};

let selected = null;
/* The note the caption is about, tracked separately because `selected` means
   "a project the Enter KEY may fly into" and deliberately excludes notes (see
   showNoteCaption). The enter BUTTON has to name whatever is actually under the
   caption, note included, so it needs the thing `selected` refuses to hold. */
let selectedNote = null;
function showCaption(p) {
  selected = p;
  selectedNote = null;
  const t = p.town;
  dom['cap-name'].textContent = t.name || t.id;
  dom['cap-path'].textContent = t.path || '';
  const last = t.last_active ? ago(Date.now() - Date.parse(t.last_active)) : 'never';
  const cont = CONTINENTS.find(c => c.key === p.cont);
  dom['cap-state'].textContent =
    `${CLASSES[p.cls].label} · ${(t.tool_calls || 0).toLocaleString()} tool calls · ` +
    `${(t.edits || 0).toLocaleString()} edits · last worked ${last}` +
    (cont ? ` · ${cont.label}` : ' · an island of its own') +
    (p.formWords ? ` · its landmark is ${p.formWords}` : '');
  dom['cap-agents'].innerHTML = (t.live_agents || [])
    .map(a => `<li>${escapeHtml(a.label || a.last_tool || 'working')}</li>`).join('');
  dom['cap-open'].innerHTML = (t.open_items || []).slice(0, 6)
    .map(o => `<li>${escapeHtml(typeof o === 'string' ? o : (o.title || o.text || ''))}</li>`).join('');
  /* THE GESTURE THE READER ACTUALLY HAS. A phone has no double-click, and a
     hint that names one is a hint that reads as broken. */
  const dbl = MOBILE ? 'double-tap' : 'double-click';
  dom['cap-hint'].textContent = t.kind === 'vault'
    ? dbl + ' to open the vault continent in the island view'
    : dbl + ' to walk this project’s city';
  dom.caption.hidden = false;
  dom['a11y-status'].textContent = dom['cap-name'].textContent + ': ' + dom['cap-state'].textContent;
}
/** The caption for one note. Same panel as a settlement's, because it is the
    same question — what is this place — asked of a smaller one. `selected` is
    left null on purpose: Enter flies into a PROJECT, and a note is not one. */
function showNoteCaption(m) {
  const n = m.note;
  selected = null;
  selectedNote = m;
  dom['cap-name'].textContent = n.title || n.id;
  dom['cap-path'].textContent = (n.folder || '') + (n.subfolder ? '/' + n.subfolder : '');
  const mod = n.modified ? ago(Date.now() - Date.parse(n.modified)) : 'never';
  dom['cap-state'].textContent =
    `note · ${(n.words || 0).toLocaleString()} words · ${n.inlinks || 0} links in · ` +
    `${(n.outlinks || []).length} out · last edited ${mod} · ${m.region.label}, Wissenberg`;
  dom['cap-agents'].innerHTML = '';
  dom['cap-open'].innerHTML = (n.tags || []).slice(0, 6)
    .map(t => `<li>${escapeHtml(t)}</li>`).join('');
  dom['cap-hint'].textContent = (MOBILE ? 'double-tap' : 'double-click') +
                                ' to open this note in the island view';
  dom.caption.hidden = false;
  dom['a11y-status'].textContent = dom['cap-name'].textContent + ': ' + dom['cap-state'].textContent;
}

/** The caption for one materialised building: which file it is, when it was
    first touched and by which agent. Same panel again, and `selected` stays
    null for the same reason a note's does — Enter flies into a PROJECT, and
    Enter on a house would leave the planet for a city the house is in. */
function showPrintCaption(rec) {
  selected = null;
  selectedNote = null;
  dom['cap-name'].textContent = rec.path.split('/').pop();
  dom['cap-path'].textContent = rec.path;
  const who = rec.agent ? String(rec.agent).split(':').pop() : null;
  dom['cap-state'].textContent =
    `${rec.seeded ? 'built from the record' : 'materialised here'} · ` +
    `${rec.tool || 'touched'} · first touched ${ago(Date.now() - rec.at)}` +
    (who ? ` · by agent ${who.slice(0, 8)}` : '') +
    ` · ${rec.floors} floor${rec.floors === 1 ? '' : 's'} · ${rec.p.town.name}`;
  dom['cap-agents'].innerHTML = '';
  dom['cap-open'].innerHTML = '';
  dom['cap-hint'].textContent = 'a file of this project, standing where it was written';
  dom.caption.hidden = false;
  dom['a11y-status'].textContent = dom['cap-name'].textContent + ': ' + dom['cap-state'].textContent;
}

/** THE PICK COLLIDER FOR A PRINTED BUILDING — screen-space, like every other
    pick on this page, and for the same two reasons: a raycast against the
    kit's own instanced geometry needs a bounding sphere nothing here would
    remember to invalidate, and there are at most a few dozen of these.

    Only under 400 m of altitude. Above that a building is under a pixel, and a
    settlement is the thing the pointer is actually aiming at. */
const PRINT_PICK_ALT = 400, PRINT_PICK_PX = 30;
const _pk = new THREE.Vector3();
function printedAt(px, py) {
  if (!livePrints.size || cam.dist - R > PRINT_PICK_ALT) return null;
  const camDir = camera.position.clone().normalize();
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);
  let best = null, bd = PRINT_PICK_PX * PRINT_PICK_PX;
  for (const rec of livePrints.values()) {
    if (rec.gone) continue;
    if (rec.p.axis.dot(camDir) < horizon * 0.999) continue;
    /* HALF WAY UP THE BUILDING, not its footprint: at street level the lens
       looks at the horizon, so the point that lands where the eye reads the
       house is its middle, not the ground it stands on. */
    if (!rec.aim) {
      rec.aim = localPoint(rec.p, rec.p.frame, rec.lot.ox, rec.lot.oz, rec.height * 0.5);
    }
    _pk.copy(rec.aim).project(camera);
    if (_pk.z > 1) continue;
    const x = (_pk.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_pk.y * 0.5 + 0.5) * window.innerHeight;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = rec; }
  }
  return best;
}

function hideCaption() { dom.caption.hidden = true; selected = null; selectedNote = null; }

/** Where a settlement lands on the frame, and whether the planet is in the way.
    Screen-space, not a raycast: 142 projections is nothing, and a raycast
    against instanced towns needs a bounding sphere three caches and never
    invalidates — the exact silent failure the island's __selfcheck() exists to
    catch. There is nothing to cache here. */
function pickAt(px, py) {
  const v = new THREE.Vector3();
  const camDir = camera.position.clone().normalize();
  /* A surface point is over the horizon when the angle between its direction
     and the camera's is wider than the tangent cone, whose COSINE is R/D. The
     first build used sqrt(1-(R/D)^2) — the SINE of that same angle — which at
     orbit hid everything more than 18 degrees from the point under the lens:
     17 of 19 signs culled, and nothing pickable outside the middle of frame. */
  const horizon = clamp(R / camera.position.length(), 0, 0.9999);
  let best = null, bd = 46 * 46;
  for (const p of plan.placed) {
    if (p.axis.dot(camDir) < horizon * 0.999) continue;     // over the horizon
    v.copy(p.centre).project(camera);
    if (v.z > 1) continue;
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}


/* =============================================================================
   INPUT
   ========================================================================== */
function bindInput() {
  let dragging = false, lx = 0, ly = 0, moved = 0;

  canvas.addEventListener('pointerdown', e => {
    /* A TOUCH IS NOT A MOUSE HERE, and the two paths cannot both run. Pointer
       events do fire for touch, so leaving them on gave every tap a mouse drag
       AND a gesture, and a pinch moved the camera twice — once per finger. The
       touch listeners below own every finger; these own every mouse and pen. */
    if (e.pointerType === 'touch') return;
    dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(e.pointerId);
    /* Free fly asks for the pointer once, on a real click, because that is the
       only gesture a browser will grant it on. A refusal is not fatal — the
       drag branch below turns the same movement into the same look, and that is
       also the path a screenshot harness takes. */
    if (free.on && document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    if (free.on) {
      /* Mouse-look. Pointer lock gives movementX/Y with no edge to hit; the
         drag fallback is the same numbers off two client positions. */
      const locked = document.pointerLockElement === canvas;
      const dx = locked ? e.movementX : (dragging ? e.clientX - lx : 0);
      const dy = locked ? e.movementY : (dragging ? e.clientY - ly : 0);
      lx = e.clientX; ly = e.clientY;
      if (dx || dy) {
        free.yaw += dx * FREE_LOOK;
        free.pitch = clamp(free.pitch - dy * FREE_LOOK, -1.45, 1.45);
      }
      return;
    }
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      /* Sensitivity falls with altitude, so one centimetre of mouse is one
         continent from orbit and one street at street level. */
      const k = clamp((cam.dist - R) / R, 0.012, 1) * 0.42;
      cam.lon -= dx * k; cam.lat = clamp(cam.lat + dy * k, -86, 86);
      cam.lastDrag = performance.now(); cam.fly = null;
      return;
    }
    if (!built) return;
    /* A PRINTED BUILDING WINS, and only under 400 m — printedAt() refuses above
       that. Inside a settlement the house is the smaller, more specific thing
       the pointer is on, and the town's own plaque is still one flick away. */
    const pr = printedAt(e.clientX, e.clientY);
    const p = pr ? null : pickAt(e.clientX, e.clientY);
    /* A settlement wins a tie with a note: the notes only exist on one
       continent and a town there is still the bigger thing to aim at. */
    const nm = (p || pr) ? null : noteAt(e.clientX, e.clientY);
    if (pr) {
      dom.hover.hidden = false;
      dom.hover.style.left = (e.clientX + 16) + 'px';
      dom.hover.style.top = (e.clientY + 14) + 'px';
      dom.hover.textContent = `${pr.path.split('/').pop()} — ${pr.tool || 'touched'}, ` +
                              `${ago(Date.now() - pr.at)}`;
    } else if (p || nm) {
      dom.hover.hidden = false;
      dom.hover.style.left = (e.clientX + 16) + 'px';
      dom.hover.style.top = (e.clientY + 14) + 'px';
      if (p) {
        const last = p.town.last_active ? ago(Date.now() - Date.parse(p.town.last_active)) : 'never';
        dom.hover.textContent = `${p.town.name} — ${CLASSES[p.cls].label}, ${last}`;
      } else {
        const n = nm.note;
        dom.hover.textContent =
          `${n.title || n.id} — ${(n.words || 0).toLocaleString()} words, ` +
          `${n.inlinks || 0} link${(n.inlinks || 0) === 1 ? '' : 's'} in · ${nm.region.label}`;
      }
    } else dom.hover.hidden = true;
  });
  const endDrag = e => {
    if (e.pointerType === 'touch') return;
    if (!dragging) return;
    dragging = false; canvas.classList.remove('dragging');
    /* Not in free fly: the click there is how the browser grants pointer lock,
       and a click that also opened or closed a caption would make aiming the
       camera toggle the writing on the screen. */
    if (moved < 6 && built && !free.on) {
      const pr = printedAt(e.clientX, e.clientY);
      const p = pr ? null : pickAt(e.clientX, e.clientY);
      const nm = (p || pr) ? null : noteAt(e.clientX, e.clientY);
      if (pr) showPrintCaption(pr);
      else if (p) showCaption(p);
      else if (nm) showNoteCaption(nm);
      else hideCaption();
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { dragging = false; canvas.classList.remove('dragging'); });

  /* =========================================================================
     TOUCH — the five gestures a phone has  <!-- GLOBE-TOUCH-DOC -->

     | one finger, dragged   | orbit — the same lat/lon walk the mouse does  |
     | two fingers, spread   | zoom, as a RATIO, the same log zoom the wheel |
     | two fingers, turned   | spin the planet under the lens                |
     | tap                   | select, and open the caption                  |
     | double tap            | go in — a settlement's city, a note's page    |
     | press and hold        | the caption, without having to let go first   |

     WHY THE GESTURES ARE WRITTEN OUT AND NOT LEFT TO POINTER EVENTS. Pointer
     events give one drag for free and nothing else: a browser sends no pinch,
     it sends `dblclick` on a double tap only after a 300 ms delay it also uses
     to decide whether to zoom the PAGE, and it sends no long press at all. The
     three that matter on a phone are exactly the three it does not send.

     `touch-action: none` in globe.css is what stops the browser taking the
     gesture for its own page zoom BEFORE this code ever sees it —
     preventDefault() alone is too late for a pinch on a passive listener.
     ====================================================================== */
  const TAP_MS = 300, TAP_PX = 16, HOLD_MS = 480, HOLD_PX = 12;
  const T = { n: 0, x: 0, y: 0, ox: 0, oy: 0, moved: 0, at: 0,
              dist: 0, ang: 0, lastTap: 0, tapX: -999, tapY: -999,
              lastX: 0, lastY: 0, hold: 0, held: false, multi: false };
  /* The gesture state, published for the emulation run in docs/RUNBOOK.md —
     a harness driving Input.dispatchTouchEvent has no other way to tell a
     recognised pinch from two ignored fingers. */
  window.__touch = () => ({ enabled: true, mobile: MOBILE, coarse: COARSE,
                            fingers: T.n, moved: Math.round(T.moved),
                            last: window.__lastTouch || null,
                            dpr: renderer ? renderer.getPixelRatio() : null,
                            quality });
  const twoFinger = e => {
    const a = e.touches[0], b = e.touches[1];
    return { d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
             a: Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX),
             x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  };
  const clearHold = () => { if (T.hold) { clearTimeout(T.hold); T.hold = 0; } };

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    T.n = e.touches.length;
    T.held = false;
    clearHold();
    if (T.n === 1) {
      const t = e.touches[0];
      T.x = T.lastX = t.clientX; T.y = T.lastY = t.clientY;
      T.ox = t.clientX; T.oy = t.clientY;
      T.moved = 0; T.at = performance.now();
      /* PRESS AND HOLD IS A READ, not a select-then-read. On a phone the
         caption is the only way to see what a place IS, and asking for a tap
         that must not move more than sixteen pixels on a moving planet is the
         gesture people miss. */
      T.hold = setTimeout(() => {
        T.held = true; T.hold = 0;
        if (!built || T.moved > HOLD_PX) return;
        const pr = printedAt(T.ox, T.oy);
        const p = pr ? null : pickAt(T.ox, T.oy);
        const nm = (p || pr) ? null : noteAt(T.ox, T.oy);
        window.__lastTouch = { gesture: 'longpress', x: T.ox, y: T.oy,
                               hit: pr ? pr.path : p ? p.town.name : nm ? nm.note.title : null };
        if (pr) showPrintCaption(pr); else if (p) showCaption(p);
        else if (nm) showNoteCaption(nm); else hideCaption();
      }, HOLD_MS);
    } else if (T.n >= 2) {
      const g = twoFinger(e);
      T.dist = g.d; T.ang = g.a;
      /* TESTS.md levelup B12: once a gesture has gone two-finger, the LAST
         finger to lift must not be read as a fresh tap — see touchend. */
      T.multi = true;
    }
    cam.lastDrag = performance.now(); cam.fly = null;
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && T.n === 1) {
      const t = e.touches[0];
      const dx = t.clientX - T.lastX, dy = t.clientY - T.lastY;
      T.lastX = t.clientX; T.lastY = t.clientY;
      T.moved += Math.abs(dx) + Math.abs(dy);
      if (T.moved > HOLD_PX) clearHold();
      /* The mouse drag's own sensitivity curve, unchanged: one centimetre of
         thumb is one continent from orbit and one street at street level. */
      const k = clamp((cam.dist - R) / R, 0.012, 1) * 0.42;
      cam.lon -= dx * k; cam.lat = clamp(cam.lat + dy * k, -86, 86);
      cam.lastDrag = performance.now(); cam.fly = null;
      window.__lastTouch = { gesture: 'orbit', dx, dy, lat: +cam.lat.toFixed(2),
                             lon: +cam.lon.toFixed(2) };
    } else if (e.touches.length >= 2) {
      clearHold();
      const g = twoFinger(e);
      if (T.dist > 8 && g.d > 8) {
        /* A RATIO, like the wheel's log zoom: spreading by half again is the
           same step at orbit and at a street. */
        cam.distWant = clamp(cam.distWant * (T.dist / g.d), DIST_MIN, DIST_MAX);
      }
      let da = g.a - T.ang;
      /* The shortest way round: a pinch that crosses the -pi/pi seam otherwise
         spins the planet a full turn in one frame. */
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      cam.lon -= da * 57.2958 * 0.55;
      T.dist = g.d; T.ang = g.a;
      T.n = e.touches.length;
      cam.lastDrag = performance.now(); cam.fly = null;
      window.__lastTouch = { gesture: 'pinch', spread: +(g.d).toFixed(1),
                             turn: +(da * 57.2958).toFixed(2),
                             distWant: Math.round(cam.distWant) };
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    clearHold();
    if (e.touches.length > 0) { T.n = e.touches.length; return; }
    const wasOne = T.n === 1, moved = T.moved, held = T.held, wasMulti = T.multi;
    T.n = 0; T.multi = false;
    /* TESTS.md levelup B12: when a pinch ends, its two fingers lift one after
       the other — the second-to-last touchend leaves T.n at 1 (the branch
       above), so without wasMulti this final touchend reads as a one-finger
       tap and overwrites __lastTouch with {gesture:'tap'}, even though the
       camera just proved a pinch ran. Bail out and leave __lastTouch as the
       pinch info touchmove already set. */
    if (wasMulti) return;
    if (!wasOne || held || !built) return;
    if (moved > TAP_PX || performance.now() - T.at > 700) return;
    const now = performance.now();
    const px = T.ox, py = T.oy;
    /* Against the PREVIOUS tap's own pixel, which has to be remembered
       separately: T.x is this touch's start and comparing it with itself made
       every second tap a double tap wherever on the screen it landed. */
    if (now - T.lastTap < TAP_MS &&
        Math.hypot(px - T.tapX, py - T.tapY) < TAP_PX * 2) {
      /* DOUBLE TAP GOES IN, the same as a double click: a settlement's own
         city, a note's own page. The first tap of the pair has already opened
         the caption, which is what makes the gesture readable — you see what
         you are about to enter. */
      T.lastTap = 0;
      const p = pickAt(px, py);
      window.__lastTouch = { gesture: 'doubletap', x: px, y: py,
                             hit: p ? p.town.name : null };
      if (p) { enter(p); return; }
      const nm = noteAt(px, py);
      if (nm) location.href = Controls.href('world.html?focus=' + encodeURIComponent(nm.note.id));
      return;
    }
    T.lastTap = now; T.tapX = px; T.tapY = py;
    window.__lastTouch = { gesture: 'tap', x: px, y: py, at: now };
    const pr = printedAt(px, py);
    const p = pr ? null : pickAt(px, py);
    const nm = (p || pr) ? null : noteAt(px, py);
    if (pr) showPrintCaption(pr); else if (p) showCaption(p);
    else if (nm) showNoteCaption(nm); else hideCaption();
  }, { passive: false });

  canvas.addEventListener('touchcancel', () => { clearHold(); T.n = 0; }, { passive: true });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    /* LOG ZOOM: one wheel notch is a constant RATIO, so the scroll from orbit to
       a street is the same number of notches wherever you start. A linear zoom
       crawls in space and jumps at the ground. */
    cam.distWant = clamp(cam.distWant * Math.exp(clamp(e.deltaY, -220, 220) * 0.0011),
                         DIST_MIN, DIST_MAX);
    cam.lastDrag = performance.now(); cam.fly = null;
  }, { passive: false });

  canvas.addEventListener('dblclick', e => {
    if (!built) return;
    const p = pickAt(e.clientX, e.clientY);
    if (p) { enter(p); return; }
    const nm = noteAt(e.clientX, e.clientY);
    /* The note's own page on the ISLAND for now. The globe draws where a note
       stands; world.html is still the only view that draws what is inside one,
       and building a second reader here would be the duplicate the caveman
       rules exist to stop. */
    if (nm) location.href = Controls.href('world.html?focus=' + encodeURIComponent(nm.note.id));
  });

  window.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== dom['search-input']) {
      e.preventDefault(); openSearch();
    } else if (e.key === 'Escape') {
      if (!dom.search.hidden) closeSearch(); else hideCaption();
    } else if ((e.key === 'f' || e.key === 'F') && document.activeElement !== dom['search-input']) {
      toggleFreeFly();
    } else if (e.key === 'q' && !free.on && document.activeElement !== dom['search-input']) {
      /* Q is the quality toggle on the orbit and "down" in free fly — the flyer
         owns W A S D Q E while it is on, and nothing else does. */
      setQuality(quality === 'high' ? 'medium' : 'high');
    } else if ((e.key === 'p' || e.key === 'P') && document.activeElement !== dom['search-input']) {
      /* Replay the last materialisation over the shell that already stands.
         Visual only: no event, no new building, no count. */
      const path = replayLastPrint();
      toast(path ? 'replaying: ' + path.split('/').pop() : 'nothing has printed yet');
    } else if (e.key === 'Enter' && selected && dom.search.hidden &&
               document.activeElement !== dom['search-input']) {
      /* dom.search.hidden AND the focus check, and both are needed. Enter in the
         search field runs runSearch(), which opens the caption — so `selected`
         is set — and then closeSearch() BLURS the field, all inside the same
         dispatch. This listener is on window, so it runs after the field's own
         handler in the bubble phase, by which time activeElement is no longer
         the input: pressing Enter on a search hit navigated straight out of the
         page to that project's city. Measured, not guessed. */
      enter(selected);
    }
    /* The flyer's own keys, held rather than pressed — updateFreeFly() reads the
       SET every frame, so W is a movement for as long as it is down. Separate
       from the chain above because Q is in both: quality on the orbit, down in
       the air, and the chain has already decided which. */
    if (free.on && document.activeElement !== dom['search-input']) {
      const k = e.key.toLowerCase();
      if ('wasdqe'.includes(k) || k === 'shift') { keys.add(k); e.preventDefault(); }
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  /* A key held when the window loses focus never gets its keyup, and the camera
     flies away on its own until the next press. */
  window.addEventListener('blur', () => keys.clear());
  dom['search-input'].addEventListener('input', () => showHits(dom['search-input'].value));
  dom['search-input'].addEventListener('keydown', e => {
    /* stopPropagation as well as the guard above: one of the two is redundant on
       purpose, because the failure it prevents is silent — the page leaves. */
    if (e.key === 'Enter') {
      e.stopPropagation();
      runSearch(dom['search-input'].value);
      closeSearch();
    }
  });
}

/** Fly in, then hand over. The globe does not draw a street — the session city
    already does, and building a second one would be the duplicate the caveman
    rules exist to stop. */
function enter(p) {
  flyToPlace(p, R + p.elev + p.radius * 1.2 + 12);
  /* Controls.href, not a bare string: on the desktop wallpaper this is the
     hand-over that used to drop `wallpaper=1` and strand the page below the
     taskbar — see controls.js CONTROLS-WALLPAPER. */
  const url = p.town.kind === 'vault'
    ? 'world.html?focus=vault'
    : 'index.html?project=' + encodeURIComponent(p.town.id);
  setTimeout(() => { location.href = Controls.href(url); }, 1500);
}


/* =============================================================================
   THE BUTTONS — what enter, exit and search MEAN on the planet
   controls.js owns the cluster; this owns the three verbs. Every one of them
   calls the function the KEY already called, so a button can never do something
   the keyboard cannot — see controls.js's header for why they exist at all.
   ========================================================================== */
function bindControls() {
  Controls.install({
    /* Whatever the caption is currently about. A settlement flies into its own
       city, a note into the island view that can actually draw its text walls;
       a printed building has no inside, so it names nothing and the button
       stays disabled — the same rule showPrintCaption() states for the key. */
    target: () => selected ? (selected.town.name || selected.town.id)
                 : selectedNote ? (selectedNote.note.title || selectedNote.note.id)
                 : null,
    enter: () => {
      if (selected) { enter(selected); return; }
      if (selectedNote) location.href = Controls.href('world.html?focus=' +
                                        encodeURIComponent(selectedNote.note.id));
    },
    /* The globe IS the top level, so there is nothing above it: the button only
       appears while something is open ON it, and says which. */
    exitLabel: () => !dom.search.hidden ? 'close search'
                   : !dom.caption.hidden ? 'close' : null,
    exit: () => { if (!dom.search.hidden) closeSearch(); else hideCaption(); },
    search: {
      open: openSearch,
      close: closeSearch,
      isOpen: () => !dom.search.hidden,
      go: q => runSearch(q),
    },
    quickLists,
    /* WHERE THE PLAY WINDOW OPENS. Deliberately the same expression `target`
       reads, so the full-screen window lands on whatever the caption on the
       desktop was about — `focus` is a param applyFocus() already resolves
       through runSearch(), which is why nothing new had to be taught to the
       planet. The CAMERA is not carried: no page on this server has ever taken
       a camera out of its URL, and the focus flight puts the view close enough
       that the town is in frame (see docs/DECISIONS.md). */
    state: () => ({
      focus: selected ? (selected.town.name || selected.town.id)
           : selectedNote ? (selectedNote.note.title || selectedNote.note.id)
           : null,
    }),
  });
}

/** The clickable addresses under the search field. Straight out of the payload
    the planet was built from — `plan.placed` and `noteMarks` are what
    searchHits() itself matches over — so a row can never name a place that is
    not on the map. Read when the panel OPENS, because on a cold globe the
    payload lands seconds after the buttons do. */
function quickLists() {
  const out = [];
  if (plan && plan.placed) {
    const recent = plan.placed
      .filter(p => p.town.last_active)
      .sort((a, b) => Date.parse(b.town.last_active) - Date.parse(a.town.last_active))
      .slice(0, 6);
    if (recent.length) out.push({
      title: 'last worked in',
      items: recent.map(p => ({ label: p.town.name || p.town.id,
                                query: p.town.name || p.town.id })),
    });
  }
  /* The Daily notes are one cottage per day along the Daily river, and their
     titles ARE dates — which is why parseDate() exists in the search at all. */
  const days = noteMarks
    .filter(m => m.region.key === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(m.note.title || ''))
    .sort((a, b) => b.note.title.localeCompare(a.note.title))
    .slice(0, 7);
  if (days.length) out.push({
    title: 'recent days',
    items: days.map(m => ({ label: m.note.title, query: m.note.title })),
  });
  /* Most linked-into first — the same order buildVaultNotes() stands them in on
     their own hill, so the top of this list is the top of the mountain. */
  const notes = noteMarks
    .filter(m => m.region.key !== 'daily')
    .sort((a, b) => (b.note.inlinks || 0) - (a.note.inlinks || 0))
    .slice(0, 6);
  if (notes.length) out.push({
    title: 'most linked notes',
    items: notes.map(m => ({ label: m.note.title || m.note.id,
                             query: m.note.title || m.note.id })),
  });
  return out;
}


/* =============================================================================
   THE ADDRESS SEARCH — "/" — the island's, on a sphere
   It matches over the SAME payload the planet is built from, so it can never
   offer somewhere that is not on the map. And it is honest before the world
   exists: the field is live from the first frame, the build takes seconds, and
   every keystroke in that window used to throw on the island.
   ========================================================================== */
function openSearch() {
  dom.search.hidden = false;
  dom['search-input'].value = '';
  dom['search-hits'].textContent = built ? '' : 'planet still building…';
  dom['search-input'].focus();
}
function closeSearch() { dom.search.hidden = true; dom['search-input'].blur(); }

/** A date in any of the shapes Beri actually types, as YYYY-MM-DD, or null.
    The island's parseDate(), on this page for the same reason: the Daily notes
    stand along the Daily river as one cottage per day, so a DATE is an address
    on this planet — but the acceptance run typed `2026-08-14` and the field
    answered "nothing on the map by that name", because the index held
    settlements, continents and vault regions and nothing else (TESTS B11). */
function parseDate(q) {
  const s = q.trim().toLowerCase();
  const d = new Date();
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(x.getDate()).padStart(2, '0')}`;
  if (s === 'today' || s === 'heute') return iso(d);
  if (s === 'yesterday' || s === 'gestern') { d.setDate(d.getDate() - 1); return iso(d); }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{4}))?\.?$/);      // 14.8 or 14.8.2026
  if (m) return `${m[3] || d.getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function searchHits(q) {
  if (!plan) return [];
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const out = [];
  /* The notes are addresses too, and a resolved DATE beats every other match:
     `2026-08-14`, `14.8` and `yesterday` all name one cottage on the Daily
     river. 437 string compares per keystroke is nothing next to the 142
     settlements below it. */
  const date = parseDate(s);
  for (const m of noteMarks) {
    const title = (m.note.title || m.note.id).toLowerCase();
    if (date ? title === date : title === s) out.push({ note: m, rank: -1 });
    else if (!date && title.startsWith(s)) out.push({ note: m, rank: 2 });
  }
  for (const p of plan.placed) {
    const name = (p.town.name || '').toLowerCase();
    if (name === s) out.push({ p, rank: 0 });
    else if (name.startsWith(s)) out.push({ p, rank: 1 });
    else if (name.includes(s)) out.push({ p, rank: 2 });
    else if (subsequence(s, name)) out.push({ p, rank: 3 });
  }
  for (const c of CONTINENTS) {
    if (c.label.toLowerCase().includes(s) || c.key.includes(s)) out.push({ cont: c, rank: 1 });
  }
  for (const rg of VAULT_REGIONS) {
    if (rg.label.toLowerCase().includes(s) || rg.key.includes(s)) out.push({ region: rg, rank: 1 });
  }
  return out.sort((a, b) => a.rank - b.rank ||
    ((b.p ? b.p.town.tool_calls : 0) - (a.p ? a.p.town.tool_calls : 0))).slice(0, 6);
}
const subsequence = (needle, hay) => {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length;
};

function showHits(q) {
  if (!built) { dom['search-hits'].textContent = 'planet still building…'; return; }
  const hits = searchHits(q);
  dom['search-hits'].textContent = hits.length
    ? hits.map(h => h.p ? h.p.town.name
                  : h.note ? (h.note.note.title || h.note.note.id) + ' — ' + h.note.region.label
                  : (h.cont ? h.cont.label : h.region.label)).join('  ·  ')
    : (q.trim() ? 'nothing on the map by that name' : '');
}

function runSearch(q) {
  if (!built) { pendingSearch = q; return null; }
  const hit = searchHits(q)[0];
  if (!hit) return null;
  /* A note is flown to like anything else, and then READ: the caption is the
     only thing on screen that can say which day this cottage on the river is,
     because the note itself lives on the island view. */
  if (hit.note) {
    const m = hit.note;
    const c = toLL(m.axis);
    flyTo(c.lat, c.lon, R + m.elev + 46);
    showNoteCaption(m);
    return m.note.title || m.note.id;
  }
  if (hit.cont) { flyTo(hit.cont.lat, hit.cont.lon, R + 620); return hit.cont.label; }
  if (hit.region) {
    const c = toLL(hit.region.axis);
    flyTo(c.lat, c.lon, R + Math.max(2, hit.region.elev || 0) + 180);
    return hit.region.label;
  }
  flyToPlace(hit.p);
  showCaption(hit.p);
  return hit.p.town.name;
}

/** ?focus=live's real target: the live settlement with the most agents in the
    air right now, ties broken by whichever went live most recently. Same rule
    as world.js's busiestLiveQuarter() — a sphere instead of a plaza. Null when
    nothing on the planet is live. TESTS.md levelup B8 caught `focus=live`
    working only because "live" is a substring of the town name claude-live —
    this is the real feature that comment asked for. */
function busiestLiveSettlement() {
  let best = null, bestAgents = -1, bestActive = -1;
  for (const p of plan.placed) {
    if (!p.town.is_live) continue;
    const n = (p.town.live_agents || []).length;
    const active = Date.parse(p.town.last_active || '') || 0;
    if (n > bestAgents || (n === bestAgents && active > bestActive)) {
      best = p; bestAgents = n; bestActive = active;
    }
  }
  return best;
}

function applyFocus() {
  const f = params.get('focus');
  if (!f) return;
  if (f === 'live') {
    const p = busiestLiveSettlement();
    /* enter()'s own close-approach distance: close enough that the town's
       craft stand in frame (__craftOnScreen()), not specks at search range. */
    if (p) { flyToPlace(p, R + p.elev + p.radius * 1.2 + 12); showCaption(p); return; }
    /* Nothing live right now — fall through to the plain address search below,
       same as any other unmatched focus value. */
  }
  const name = runSearch(f);
  if (!name) {
    const c = CONTINENTS.find(c => c.key === f);
    if (c) flyTo(c.lat, c.lon, R + 620);
  }
}

function showHintsOnce() {
  if (SCREENSAVER) return;
  try {
    if (localStorage.getItem('globe-hints') === '1') return;
    localStorage.setItem('globe-hints', '1');
  } catch (e) { /* private mode: show them, it is one line */ }
  dom.hints.hidden = false;
  setTimeout(() => { dom.hints.hidden = true; }, 9000);
}


/* =============================================================================
   LIVE — the same stream the island reads
   ========================================================================== */
function openStream() {
  let es;
  try { es = new EventSource(API_STREAM); }
  catch (e) { return; }
  es.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'world' || msg.towns) refreshWorld();
    /* EVERY event goes on to the town dispatcher, whether this page uses it or
       not. `kind` is the server's own field (server.py's world_stream: `world`,
       `pulse`, `pulse_end`, `file_deleted`) and `town` is the town id on the
       three that have one. This is the seam life.js and drones.js plug into —
       see Globe.onTown() below — and it is deliberately a pass-through: the
       globe does not interpret a pulse, it forwards it. */
    const kind = msg.kind || msg.type;
    if (kind) {
      /* THIS PAGE'S OWN HANDLER RUNS FIRST and is not one of the registered
         ones: a print is the globe's, and a listener that throws must not be
         able to stop it. onTownEvent() then forwards the same event to
         everybody outside, unchanged. */
      if (msg.town) { try { onGlobePulse(msg.town, kind, msg); } catch (e) { console.warn(e); } }
      Globe.onTownEvent(msg.town || null, kind, msg);
    }
  };
  es.onerror = () => { /* the 60 s poll below is the fallback and needs no toast */ };
}


/* =============================================================================
   THE LIVE SEAMS — what life.js, drones.js and prints plug into

   Nothing in this block draws anything. It exists so the next round can put
   people, carts and drones on these lanes without re-deriving where the lanes
   are: every number here is read straight out of the same `plan` the planet is
   built from, so a walker on a lane is on the lane that is drawn and not on a
   second guess at it.

   THE ONE THING TO KNOW ABOUT THE COORDINATES: a settlement's `lots` and
   `lanes` are in METRES ON ITS OWN TANGENT PLANE, x along `tangentFrame.east`
   and z along `tangentFrame.north`. Turning a local (ox, oz) into a world point
   is exactly three lines, and `Globe.localToWorld()` is those three lines so
   nobody writes a fourth copy of them.
   ========================================================================== */
const townHandlers = [];

window.Globe = {
  /** The planet's radius, so a caller can turn an elevation into a point. */
  R,

  /** Register a handler for the stream. Returns the function that removes it.
      `kind` is one of `world`, `pulse`, `pulse_end`, `file_deleted`. */
  onTown(fn) {
    townHandlers.push(fn);
    return () => {
      const i = townHandlers.indexOf(fn);
      if (i >= 0) townHandlers.splice(i, 1);
    };
  },

  /** The dispatcher itself, fed by /api/world/stream. Called with the town id
      (null on an event that has none), the kind, and the raw message. It is
      also callable from outside — replaying a captured stream through it is how
      the next round can test life.js without a live session. A throwing handler
      is caught and dropped: one broken listener must not stop the others or
      kill the EventSource. */
  onTownEvent(townId, kind, payload) {
    for (const fn of townHandlers) {
      try { fn(townId, kind, payload); } catch (e) { /* one handler, not all */ }
    }
  },

  /** Everything about one settlement's ground, or null if there is no such
      town on the planet.
        center       THREE.Vector3, the world point at the middle of the plaza
        tangentFrame { up, east, north } — the basis `lots` and `lanes` are in
        lots[]       { type, ox, oz, yaw, w, d, seed, door, special?, tower? }
                     ox/oz metres from the centre; yaw is the building's, and
                     its FRONT faces (sin yaw, cos yaw) in (east, north)
        lanes[]      { pts: [[ox,oz], …], w, main?, ring? } — carriageways
        plaza        { r } in metres, or null for a field
        liveAgents   the ids of the agents working here right now */
  getSettlement(townId) {
    if (!plan) return null;
    const p = plan.byId.get(townId);
    if (!p) return null;
    return {
      id: p.town.id, name: p.town.name, cls: p.cls,
      center: p.centre ? p.centre.clone() : p.axis.clone().multiplyScalar(R + p.elev),
      tangentFrame: p.frame
        ? { up: p.frame.up.clone(), east: p.frame.east.clone(), north: p.frame.north.clone() }
        : null,
      radius: p.radius, elev: p.elev,
      lots: p.lots || [],
      lanes: p.lanes || [],
      plaza: p.plaza || null,
      liveAgents: (p.town.live_agents || []).slice(),
    };
  },

  /** The ground elevation, in metres above sea level, under a direction from
      the planet's centre. The argument does NOT have to be normalised — this
      is a direction, not a point — so passing a drone's own position works.
      The surface point is `dir.normalize().multiplyScalar(Globe.R + h)`, which
      is what localToWorld() below does. Settlement pads are already flattened
      into this, so a walker crossing a village square does not step. */
  getHeight(x, y, z) {
    const d = new THREE.Vector3(x, y, z);
    if (d.lengthSq() < 1e-12) return 0;
    return elevAt(d.normalize());
  },

  /** A settlement's local metres to a world point, `lift` metres over the
      ground. The one conversion every mover on a lane needs. */
  localToWorld(townId, ox, oz, lift = 0) {
    if (!plan) return null;
    const p = plan.byId.get(townId);
    if (!p || !p.frame) return null;
    return localPoint(p, p.frame, ox, oz, lift);
  },

  /** Every road with this town at one end, as a polyline of world points with
      the weight the trade gave it.
        to      the town id at the other end
        weight  how many files the two share — this is the road's WIDTH
        sea     true for a shipping lane, which ARCS OVER THE WATER and is not
                a surface anything can walk on
        points  THREE.Vector3[], already on the ground (or on the arc) */
  roadsFor(townId) {
    if (!plan) return [];
    const out = [];
    for (const r of plan.roads) {
      if (r.a.town.id !== townId && r.b.town.id !== townId) continue;
      const a = r.a.town.id === townId ? r.a : r.b;
      const b = a === r.a ? r.b : r.a;
      const deg = r.deg !== undefined ? r.deg : angDist(a.axis, b.axis);
      out.push({ to: b.town.id, weight: r.weight, sea: !!r.sea, deg,
                 points: r.sea ? arcPoints(a, b, 20, null)
                               : arcPoints(a, b, groundSteps(deg), 0.42) });
    }
    return out;
  },

  /** Which settlements are alive right now, by id. */
  liveTowns() {
    return plan ? plan.placed.filter(p => p.town.is_live).map(p => p.town.id) : [];
  },
};

async function refreshWorld() {
  try {
    const res = await fetch(API_WORLD, { cache: 'no-store' });
    if (!res.ok) return;
    const fresh = await res.json();
    if (!plan) return;
    /* Only the LIVE half is re-read. A town's class is its whole history and
       does not change inside a minute; rebuilding the planet every minute would
       be six seconds of frozen frame for a drone that moved. */
    const by = new Map((fresh.towns || []).map(t => [t.id, t]));
    let changed = false;
    for (const p of plan.placed) {
      const t = by.get(p.town.id);
      if (!t) continue;
      if (!!t.is_live !== !!p.town.is_live ||
          (t.live_agents || []).length !== (p.town.live_agents || []).length) changed = true;
      p.town.is_live = t.is_live;
      p.town.live_agents = t.live_agents;
      p.town.last_active = t.last_active;
      p.town.tool_calls = t.tool_calls;
      p.town.open_items = t.open_items;
      p.town.now = t.now;
    }
    world.meta = fresh.meta || world.meta;
    if (changed) rebuildLive(); else refreshCounts();
  } catch (e) { /* the planet keeps what it has */ }
}


/* =============================================================================
   PROBES — the instruments docs/RUNBOOK.md drives the gates with
   Every claim about this page in the docs is one of these, read out of the live
   page, not measured off a screenshot.
   ========================================================================== */
window.__fps = () => Math.round(fpsNow());
window.__planet = () => ({
  landFraction: planetGroup ? +planetGroup.userData.landFraction.toFixed(3) : 0,
  faces: planetGroup ? planetGroup.children.length : 0,
  triangles: planetGroup ? planetGroup.children.length * FACE_N * FACE_N * 2 : 0,
  buildMs: plan ? plan.buildMs : 0,
});
window.__settlements = () => plan ? { total: plan.placed.length, ...plan.counts } : null;
window.__structures = () => plan ? plan.built.counts : null;
window.__roads = () => plan ? plan.roadCounts : null;

/** THE OVERLAP AUDIT — how many pairs of footprints on this planet intersect.
    GATE: 0, on every settlement. Runs the SAME satOverlap() the planner accepts
    lots with, but on the RAW footprints rather than the inflated ones, so it is
    measuring what is actually drawn and not what the planner was aiming at.
    A settlement is only ever tested against itself: two settlements are degrees
    apart and their local metres are two different tangent planes. */
window.__overlaps = () => {
  if (!plan) return null;
  let pairs = 0, worst = null;
  for (const p of plan.placed) {
    const L = p.lots || [];
    const rects = L.map(b => rectCorners(b.ox, b.oz, b.yaw, b.w, b.d));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (satOverlap(rects[i], rects[j])) {
          pairs++;
          if (!worst) worst = { town: p.town.name, a: i, b: j };
        }
      }
    }
  }
  return { pairs, worst,
           lots: plan.placed.reduce((a, p) => a + ((p.lots || []).length), 0),
           dropped: plan.placed.reduce((a, p) => a + (p.dropped || 0), 0) };
};

/** THE FULL FOOTPRINT AUDIT — every placed building, the trade LANDMARK, and
    the square's PROPS, per settlement, in that settlement's own local XZ.
    GATE: `pairs` is 0 across all 145. __overlaps() above only ever knew about
    the kit's own lots, which is why a landmark could stand inside a cottage for
    a whole pass without any probe saying so (16 of them did — see
    docs/shots/trade-hotel-landmark.png).

    TWO COUNTS, and the difference is not a bug in either. `pairs` is the exact
    separating-axis test on the ORIENTED rectangles — the same satOverlap() the
    planner accepts a lot with, so it measures what is actually drawn. `aabbPairs`
    is the axis-aligned test asked for in the brief, and on a planet whose
    footprints all carry a per-lot yaw it reports the corner-to-corner boxes of
    two rectangles that do not touch: it read 65 building pairs on a settlement
    plan the exact test reads 0 on. It is kept because a rising AABB count is
    still a useful smell, but the GATE is `pairs`.

    A PROP is audited as its anchor plus the LOT_GAP daylight, and not as a
    modelled footprint: the meshes live in life.js and their real sizes are that
    module's, while what this has to prove is that no building was planned on
    top of one. */
window.__overlapsBuildings = () => {
  if (!plan) return null;
  const box = r => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of r) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
                         if (v[1] < z0) z0 = v[1]; if (v[1] > z1) z1 = v[1]; }
    return [x0, z0, x1, z1];
  };
  const aabbHit = (a, b) => a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 &&
                            a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01;
  let pairs = 0, aabbPairs = 0, worst = null, landmarks = 0, props = 0;
  for (const p of plan.placed) {
    const items = (p.lots || []).map(b =>
      ({ what: 'building', r: rectCorners(b.ox, b.oz, b.yaw, b.w, b.d) }));
    /* Read back off landmarkFootprint() rather than off anything planBuildings()
       recorded, so the FIELDS class — which never runs the lot planner and still
       gets its trade landmark — is audited on the same line as everything else. */
    const L = landmarkFootprint(p);
    if (L) { items.push({ what: 'landmark', r: rectCorners(0, 0, L.yaw, L.w, L.d) }); landmarks++; }
    for (const s of plazaPropSpots(p)) {
      items.push({ what: 'prop:' + s.type,
                   r: rectCorners(s.x, s.z, 0, LOT_GAP, LOT_GAP) });
      props++;
    }
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (satOverlap(items[i].r, items[j].r)) {
          pairs++;
          if (!worst) worst = { town: p.town.name, cls: p.cls,
                                a: items[i].what, b: items[j].what };
        }
        if (aabbHit(box(items[i].r), box(items[j].r))) aabbPairs++;
      }
    }
  }
  return { settlements: plan.placed.length, landmarks, props, pairs, aabbPairs, worst };
};
window.__trees = () => plan ? plan.treeCount : 0;
/** The forest by species — broadleaf, conifer, quiver — and how many trunks are
    standing at the moment (the trunks are the sub-350 m half of the tree LOD). */
/* WHICH FOREST TIER IS ON THE SCREEN, and how many meshes each is submitting.
   `views` is the atlas depth per species; `impostors` counts only the buckets
   actually being drawn, which is what the frame pays for. */
window.__impostors = () => ({
  tier: nearForest === null ? 'unset' : nearForest ? 'near (crossed cards + trunks)'
                                                   : 'impostor atlas',
  swapAlt: IMPOSTOR_ALT, alt: Math.round(cam.dist - R), views: IMPOSTOR_VIEWS,
  atlasPx: IMPOSTOR_W * IMPOSTOR_VIEWS + 'x' + IMPOSTOR_H,
  buckets: impostorMeshes.length,
  drawing: impostorMeshes.filter(m => m.visible).length,
  nearDrawing: forestMeshes.filter(m => m.visible).length,
  trees: impostorMeshes.reduce((a, m) => a + (m.visible ? m.count : 0), 0),
});
window.__treeSpecies = () => ({
  broad: treeCounts[0] || 0, conifer: treeCounts[1] || 0, quiver: treeCounts[2] || 0,
  trunkMeshes: trunkMeshes.length, trunksOn,
});
window.__notes = () => plan ? plan.noteCount : 0;
window.__signs = () => updateSigns();
window.__lights = () => plan ? plan.lightCount : 0;
window.__landmarks = () => plan
  ? { total: plan.landmarkCount, scanned: plan.landmarkScans || 0,
      models: Object.keys(landmarkModels) } : 0;
window.__regions = () => VAULT_REGIONS.map(r => ({ label: r.label, kind: r.kind,
  notes: r.notes, elev: r.elev !== undefined ? +r.elev.toFixed(1) : null, ...toLL(r.axis) }));
/* THE FLEET, by variant — the count and what each craft is doing, so a claim
   about "one drone per live agent" can be checked rather than believed. */
window.__drones = () => {
  const by = {};
  for (const d of droneStates) by[d.variant || 'cone'] = (by[d.variant || 'cone'] || 0) + 1;
  return { craft: droneStates.length, byVariant: by,
           working: droneStates.filter(d => d.working).length,
           kit: droneKit ? droneKit.stats() : null,
           trails: TRAIL_SLOTS - trailFree.length };
};
/* THE LIVING LAYER: every population by kind, what the settlement under the
   stage was given and why, and the draw calls the whole layer costs — the gate
   is <= 90. `reserve` is what is populated but not simulated, which is how the
   counts move between settlements without a second Life.load(). */
window.__life = () => {
  if (!life) return { on: false, off: LIFE_OFF };
  const st = life.stats ? life.stats() : {};
  let draws = 0;
  if (life.group) life.group.traverse(o => { if (o.isMesh || o.isPoints || o.isLine) draws++; });
  /* The neighbours' four sprite meshes count as draws only while they hold
     somebody: an InstancedMesh with count 0 is not submitted. */
  const satDraws = satMeshes.filter(m => m.mesh.count > 0).length;
  const flock = life.flock || [];
  return {
    on: true, at: stagePlace ? stagePlace.town.name : null,
    /* WHICH THREE SETTLEMENTS ARE ALIVE and what each was given. `towns[0]` is
       the full stage; the rest are sprite-only neighbours at half strength. */
    towns: [stagePlace && stage && stage.visible
              ? { name: stagePlace.town.name, tier: 'full',
                  people: life.actors.filter(a => a.kind === 'person').length }
              : null,
            ...satGroups.map(s => ({ name: s.p.town.name, tier: 'sprite',
                                     people: s.walkers.length }))].filter(Boolean),
    satellites: satGroups.length, satPeople: satMeshes.reduce((a, m) => a + m.n, 0),
    satDraws,
    cls: stagePlace ? stagePlace.cls : null, visible: !!(stage && stage.visible),
    people: life.actors.filter(a => a.kind === 'person').length,
    cars: life.vehicles.length,
    animals: life.actors.filter(a => a.kind === 'grazer').length,
    birds: flock.filter(b => !b.parrot).length,
    parrots: flock.filter(b => b.parrot).length,
    robots: life.actors.filter(a => a.kind === 'robot').length,
    counted: lifeCounted, pool: lifePool,
    reserve: { people: lifeReserve.people.length, cars: lifeReserve.cars.length,
               grazers: lifeReserve.grazers.length, parrots: lifeReserve.parrots.length },
    perches: (life.perches || []).length,
    /* `draws` is the GATE's number and it is the whole living layer — the
       stage's own meshes plus whatever the neighbours are drawing this frame.
       The brief's budget is 120. */
    draws: draws + satDraws, stageDraws: draws,
    maxSkinned: LIFE_MAX_SKINNED, rigid: LIFE_RIGID, stats: st,
  };
};
/* THE MATERIALISATIONS: what is printing, what has printed, and whether the
   lens is inside a cue this instant. */
window.__print = () => ({
  running: printJobs.length, rigs: printRigs.filter(r => r.job).length,
  standing: livePrints.size, derezzing: derezJobs.length,
  cue: printCued(), last: lastPrint ? lastPrint.path : null,
  budgetSpent: +focusSpent.reduce((a, f) => a + f.dur, 0).toFixed(1), budget: FOCUS_BUDGET,
});
/* WHAT A RELOAD PUT BACK — the buildings seeded from the last day's replays,
   as against the ones that materialised while this page was open. `partial` is
   how many of the towns answered inside the server's own 8 s budget and were
   therefore short; the reload after it sees the complete replay. */
window.__seeded = () => ({
  ...seedStats, off: PERSIST_OFF,
  standing: [...livePrints.values()].filter(r => r.seeded && !r.gone).length,
  live: [...livePrints.values()].filter(r => !r.seeded && !r.gone).length,
  window: PERSIST_FRESH_H + 'h', perTown: PERSIST_PER_TOWN,
  paths: [...livePrints.values()].filter(r => r.seeded).slice(0, 6).map(r => r.path),
});
/* WHERE THE MATERIALISED BUILDINGS ARE ON THE FRAME RIGHT NOW — the same probe
   `__craftOnScreen()` is, and it exists for the same reason: a building is
   pickable only under 400 m and only on the visible hemisphere, so "click one"
   is not a thing a harness can do by aiming at the middle of the screen and
   hoping. `x`/`y` are pixels; feed them straight to a real mouse event. */
window.__printed = () => {
  const out = [];
  for (const rec of livePrints.values()) {
    if (rec.gone) continue;
    if (!rec.aim) {
      rec.aim = localPoint(rec.p, rec.p.frame, rec.lot.ox, rec.lot.oz, rec.height * 0.5);
    }
    const v = rec.aim.clone().project(camera);
    out.push({ path: rec.path, town: rec.p.town.name, seeded: !!rec.seeded,
               tool: rec.tool, at: rec.at, agent: rec.agent,
               onScreen: v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1,
               x: Math.round((v.x * 0.5 + 0.5) * window.innerWidth),
               y: Math.round((-v.y * 0.5 + 0.5) * window.innerHeight) });
  }
  return { total: out.length, pickableAlt: PRINT_PICK_ALT,
           alt: Math.round(cam.dist - R), list: out };
};
window.__replayPrint = () => replayLastPrint();
/* Frame the last materialisation, for the shot list and for looking at one on
   purpose. It is the same solve cuePrint() uses, without the budget: a shot is
   asked for and a cue is not. */
window.__gotoLastPrint = () => {
  const rec = lastPrint;
  if (!rec) return null;
  const p = rec.p;
  /* HALF WAY between the settlement's centre and the lot, not at the lot: the
     tilt curve has the camera looking at the HORIZON at street altitude, so an
     aim point on the lot itself puts the lens inside the building that is
     printing — the first capture of this probe is a photograph of a gutter.
     The distance is the settlement's own radius plus 34, which is the same
     solve `enter()` uses to frame a whole town. */
  const dir = p.axis.clone()
    .addScaledVector(p.frame.east, rec.lot.ox * 0.5 / R)
    .addScaledVector(p.frame.north, rec.lot.oz * 0.5 / R).normalize();
  const ll = toLL(dir);
  window.__goto(ll.lat, ll.lon, R + p.elev + p.radius * 0.9 + 34);
  return { at: p.town.name, path: rec.path, ...ll };
};
/* How many craft are actually INSIDE the frame this instant, and where. A drone
   orbits its town, so whether one is on screen at a given azimuth is a function
   of the clock — this is what lets the shot harness wait for one instead of
   taking the picture and hoping. */
window.__craftOnScreen = () => {
  const v = new THREE.Vector3();
  const on = [];
  for (const d of droneStates) {
    v.copy(d.craft.position).project(camera);
    if (v.z < 1 && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.86) {
      on.push({ variant: d.variant, at: d.place.town.name,
                x: +v.x.toFixed(2), y: +v.y.toFixed(2),
                dist: Math.round(camera.position.distanceTo(d.craft.position)) });
    }
  }
  return { onScreen: on.length, total: droneStates.length, craft: on };
};
/* Fire one materialisation by hand, for the shot list and for a page with no
   live session on it. It goes through the same seam a real pulse does. */
window.__fakePrint = (name, tool) => {
  const h = name ? searchHits(name)[0] : null;
  const p = (h && h.p) || plan.placed.find(x => x.town.is_live && x.cls !== 'fields') || null;
  if (!p) return null;
  p.town.is_live = true;
  onGlobePulse(p.town.id, 'pulse', { tool: tool || 'Write', path: 'probe/' + Math.random() });
  return p.town.name;
};
window.__live = () => plan ? plan.placed.filter(p => p.town.is_live).map(p => p.town.name) : [];
window.__night = () => +nightAmount.toFixed(3);
window.__sun = () => ({ ...toLL(sunDir), hour: HOUR_OVERRIDE !== null ? HOUR_OVERRIDE : new Date().getHours() });
window.__cam = () => ({ lat: +cam.lat.toFixed(2), lon: +cam.lon.toFixed(2),
                        dist: Math.round(cam.dist), alt: Math.round(cam.dist - R),
                        tilt: +cam.tilt.toFixed(2),
                        /* Free fly writes cam.lat/lon/dist itself, so the four
                           numbers above are true in both modes; this says which
                           mode produced them. */
                        free: { on: free.on, alt: +free.alt.toFixed(1),
                                yaw: +free.yaw.toFixed(3), pitch: +free.pitch.toFixed(3) } });
window.__goto = (lat, lon, dist) => { cam.fly = null; cam.lat = lat; cam.lon = lon;
                                      cam.dist = cam.distWant = clamp(dist, DIST_MIN, DIST_MAX);
                                      cam.lastDrag = performance.now(); return window.__cam(); };
window.__flyTo = (name) => runSearch(name);
window.__select = (name) => { const h = searchHits(name)[0];
                              if (h && h.p) { showCaption(h.p); return h.p.town.name; } return null; };
window.__placeOf = (name) => { const h = searchHits(name)[0];
  if (!h || !h.p) return null;
  const p = h.p;
  return { name: p.town.name, cls: p.cls, continent: p.cont, ...toLL(p.axis),
           elev: +p.elev.toFixed(1), radius: Math.round(p.radius),
           calls: p.town.tool_calls, live: !!p.town.is_live, form: p.form || null };
};
window.__dbg = () => ({ scene, camera, renderer, plan, cam, sun: sunDir });
/** Every geometry in the scene whose positions contain a NaN, by object name.
    three reports "Computed radius is NaN" with no object attached to it, and on
    a scene of a hundred merged ribbons that message is unactionable on its own.
    This is the globe's __selfcheck(): read it FIRST when something is missing. */
window.__nan = () => {
  const bad = [];
  scene.traverse(o => {
    const g = o.geometry; if (!g) return;
    const p = g.getAttribute('position'); if (!p) return;
    for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) {
      bad.push({ name: o.name || o.type, at: i, of: p.array.length }); return;
    }
  });
  return bad;
};
/** What fraction of the deck's own texture is opaque enough to be cloud. The
    number the two constants in cloudTexture() are set against. */
window.__clouds = () => {
  if (!cloudMesh) return 0;
  const img = cloudMesh.material.uniforms.uMap.value.image;
  const g = img.getContext('2d').getImageData(0, 0, img.width, img.height).data;
  let n = 0;
  for (let i = 0; i < g.length; i += 4) if (g[i] > 0.30 * 255) n++;
  return +(n / (g.length / 4)).toFixed(3);
};
/* THE GROUND'S OWN SCALES, and which of them the current altitude is reading.
   `coarse` 0 is a street (the 2.4 m tile), 1 is region range and up (the 46 m
   ground tile, the 38 m rock tile and the coarse normal). */
window.__ground = () => {
  const m = groundMaterials.find(x => x.userData.uni);
  return m ? { coarse: +m.userData.uni.uCoarse.value.toFixed(3),
               detailMetres: 2.4, macroMetres: 46, macroRockMetres: 38,
               alt: Math.round(cam.dist - R), layers: 5 } : null;
};
/** THE FRAME'S OWN BILL — draw calls and triangles for ONE whole frame.
    docs/BUILDINGS.md's `__budget()` reports these for the showcase, and every
    claim about "no more draw calls than before" is a before/after of these two
    numbers; the globe had no way to read them, so the claim was being reasoned
    rather than measured.

    WHY IT TURNS `autoReset` OFF INSTEAD OF JUST READING `info.render`: this page
    draws through an EffectComposer, so a frame is several `renderer.render()`
    calls and three zeroes the counters at the top of EACH of them. A plain read
    therefore returns the LAST pass — the fullscreen bloom quad — and the first
    reading taken that way was `{calls: 1, triangles: 1}`, which looks like a
    measurement and is a fullscreen triangle. With `autoReset` off the counters
    accumulate across every pass of the frame, which is what the frame costs.
    Async because it has to span two real animation frames. */
window.__budget = () => new Promise(res => {
  if (!renderer) return res(null);
  renderer.info.autoReset = false;
  requestAnimationFrame(() => {
    renderer.info.reset();
    requestAnimationFrame(() => {
      const r = renderer.info.render;
      const out = { calls: r.calls, triangles: r.triangles,
                    programs: renderer.info.programs ? renderer.info.programs.length : 0,
                    geometries: renderer.info.memory.geometries,
                    textures: renderer.info.memory.textures };
      renderer.info.autoReset = true;
      res(out);
    });
  });
});
window.__quality = q => setQuality(q);
window.__autoDegrade = v => { autoDegrade = !!v; return autoDegrade; };
window.__bloom = v => { if (bloomPass) bloomPass.enabled = !!v; return !!v; };
window.__counts = () => dom['globe-counts'] ? dom['globe-counts'].textContent : '';

/** THE GROUND TRUTH AT ONE POINT, and it is the probe every terrain change in
    the realism pass was measured with. It answers the questions a capture
    cannot: is this brown because it is scrub or because it is in shadow, is
    that dark line a river or a road, and — the one that cost the most time —
    where is the actual COASTLINE. Scan `m` (the land mask) for 0.62 to 0.78,
    not `elevRaw` for zero: a river is cut seven units into the land and crosses
    zero a long way inland, so an elevation scan finds mouths and calls them
    shores. `slope` is passed as a nominal 0.02 because a flat sample is what
    the splat's own thresholds are written against. */
window.__probe = (lat, lon) => {
  const u = ll(lat, lon);
  const m = landMask(u), e = elevAt(u);
  return { m, elevRaw: elevRaw(u), e, splat: splatWeights(u, e, 0.02, Math.abs(lat)).slice(),
           river: riverAt(u, m), forest: forestMask(u) };
};

init();

/* =============================================================================
   drones.js — the drone kit
   =============================================================================
   Agents and workers in this app used to be glowing octahedra with a torus
   around them. This module makes them AIRCRAFT: Beri's own ORNIS quadcopter
   (assets/drones/ornis.glb, from digital.wildmoments.at/ornis/) wearing a set
   of procedural attachments that say what the craft is DOING — so the wide
   shot reads as a fleet with roles, not a swarm of identical dots.

   The one rule that shaped everything below: **the silhouette carries the
   meaning.** Colour is the second channel, not the first. At 200 m a gold dot
   and a blue dot are two dots; a craft with a tall mast, a craft with wide flat
   wings and a craft with a ball turret slung under it are three different
   machines. So every variant puts its attachment on a DIFFERENT axis — up,
   down, out, forward — and none of them relies on being able to read a colour.

   No build step. Three.js 0.185.1 through the same import map every other page
   here uses. Imports nothing from this repo: give it a renderer and a manifest
   URL and it hands back craft.

   Run the showcase: `python server.py`, then
   <http://127.0.0.1:4949/drones.html>  (`?stress=60` for the frame-rate gate).
   ========================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
/* ornis.glb is `EXT_meshopt_compression` + `KHR_mesh_quantization` (both listed
   in its `extensionsRequired`). Three handles quantization on its own; without
   the decoder wired in, GLTFLoader throws "setMeshoptDecoder must be called
   before loading compressed files" and the whole fleet is missing with no other
   symptom on screen. Note for whoever reads life.js next: it imports this same
   decoder and never calls setMeshoptDecoder — reported, not touched. */
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';


/* =============================================================================
   SECTION 1 — THE CATALOGUE
   One row per variant. This table is the whole grammar: everything the kit
   knows about "what kind of craft is this" is here and nowhere else, so adding
   a task type is one row plus one attachment builder.

   `scale` is the multiplier on BASE_SPAN below — the numbers come straight from
   the brief (orchestrator 1.8, agent 1.2, workers 0.7, shell 0.8).
   `accent` lights the ORNIS's own accent/LED geometry AND every attachment, so
   one colour per row is the entire palette of a craft.
   `rig` names the attachment builder in SECTION 5.
   ========================================================================== */

const GOLD   = 0xd2a62c;   // the orchestrator, and the opus tier — city.js's GOLD
const SILVER = 0xc8cdd4;   // sonnet, and the default agent tier
const BRONZE = 0xb0713a;   // haiku
const AZURE  = 0x5fb7ff;   // read — city.js's AZURE, the cool "being looked at" blue
const LASER  = 0xff2a1a;   // edit / write — city.js's LASER, the red-hot one
const SEARCH = 0xdff0ff;   // grep / glob — blue-white, colder than read on purpose
const EMBER  = 0xe2703a;   // bash / powershell — city.js's EMBER, the spark colour
const LINK   = 0x7fe8c0;   // webfetch / agent — the only green in the fleet

/* The rotor-tip span of a ×1.0 craft, in metres. Sized against BuildingKit:
   a floor there is ~3 m, so a 1.6 m worker is a big drone parked next to a
   window and an orchestrator at ×1.8 is nearly the width of a room. Below ~1.2
   the attachments stop being separable at the wide shot, which is the whole
   point of the module. */
const BASE_SPAN = 1.6;

export const VARIANTS = {
  'orchestrator': {
    scale: 1.8, accent: GOLD, rig: 'orchestrator',
    label: 'Orchestrator', note: 'ring beacon + four rotor guards',
  },
  'agent': {
    scale: 1.2, accent: SILVER, rig: 'agent',
    label: 'Agent', note: 'cargo pod, accent by tier',
  },
  'worker.read': {
    scale: 0.7, accent: AZURE, rig: 'read',
    label: 'Read', note: 'downward sensor turret + scan beam',
  },
  'worker.edit': {
    scale: 0.7, accent: LASER, rig: 'edit',
    label: 'Edit / Write', note: 'two laser printer arms + heat vents',
  },
  'worker.search': {
    scale: 0.7, accent: SEARCH, rig: 'search',
    label: 'Grep / Glob', note: 'wide sensor wings + sweeping cone',
  },
  'worker.shell': {
    scale: 0.8, accent: EMBER, rig: 'shell',
    label: 'Bash / PowerShell', note: 'heavy frame, tool arms, sparks',
  },
  'worker.net': {
    scale: 0.7, accent: LINK, rig: 'net',
    label: 'WebFetch / Agent', note: 'antenna mast + blinking link light',
  },
};

/* The agent tiers, for `make('agent', { tier })`. Anything not in here — an
   unknown model name, or no tier at all — falls back to silver, which is the
   documented default and not an error. */
const TIERS = { opus: GOLD, sonnet: SILVER, haiku: BRONZE };

/* LOD bands, in metres from the camera. The brief's numbers. */
const LOD_NEAR = 120;
const LOD_FAR  = 400;

/* How the ORNIS's twelve materials are bucketed. Three buckets, not twelve,
   because the model carries NO textures at all — every material is a flat
   baseColorFactor — so the colour can live in a vertex attribute and twelve
   draw calls collapse into three. The split is by SHADING, not by colour:
   a hull and a label want the same metalness even at different colours.

   `glow` is the one bucket that cannot be shared between craft: it is what
   takes the variant's accent colour, so each craft owns its own material. */
const MAT_BUCKET = {
  OrnisBody: 'hull', OrnisHull: 'hull', OrnisDark: 'hull',
  OrnisLens: 'hull', OrnisLabel: 'hull', OrnisPCB: 'hull',
  OrnisCopper: 'metal', OrnisSilver: 'metal', OrnisBlade: 'metal',
  OrnisAccent: 'glow', OrnisLED: 'glow', OrnisLEDRear: 'glow',
};


/* =============================================================================
   SECTION 2 — SMALL SHARED TOOLS
   Determinism, geometry welding and the two textures the kit paints itself.
   ========================================================================== */

/* A seeded PRNG. `Math.random()` in here would mean no two loads of the
   showcase produce the same fleet, which makes screenshot comparison useless —
   the exact trap buildings.js documents having hit with its grime canvas. */
function rng(seed) {
  let s = (seed | 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 8) & 0xffffff) / 0xffffff; };
}

/* Grid-weld decimation for LOD1. Snap every vertex to a `cell`-metre grid,
   keep one vertex per occupied cell, drop the triangles that collapse to a
   line, then recompute normals. Crude next to a real quadric simplifier and
   exactly right here: at 120 m+ the ORNIS is forty pixels tall and what
   matters is that its OUTLINE survives, which a grid weld preserves and a
   naive index-stride decimation does not. */
function decimate(geo, cell) {
  const pos = geo.getAttribute('position'), col = geo.getAttribute('color');
  const idx = geo.getIndex();
  const map = new Map(), P = [], C = [], remap = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const kx = Math.round(pos.getX(i) / cell), ky = Math.round(pos.getY(i) / cell), kz = Math.round(pos.getZ(i) / cell);
    const key = `${kx},${ky},${kz}`;
    let at = map.get(key);
    if (at === undefined) {
      at = P.length / 3; map.set(key, at);
      P.push(kx * cell, ky * cell, kz * cell);
      C.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    remap[i] = at;
  }
  const out = [];
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = remap[idx ? idx.getX(t) : t], b = remap[idx ? idx.getX(t + 1) : t + 1], c = remap[idx ? idx.getX(t + 2) : t + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(out);
  g.computeVertexNormals();
  /* A welded triangle whose three corners land collinear has zero area, and
     `computeVertexNormals` normalises its zero-length face normal to NaN. One
     NaN vertex is invisible in a direct render — but it becomes a NaN PIXEL,
     the bloom pass blurs that pixel across five mip levels, and the additive
     composite then turns the ENTIRE frame black with no console error and a
     perfectly healthy draw-call count. Cost an hour; the fix is three lines. */
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) {
    if (!Number.isFinite(nrm.getX(i)) || !Number.isFinite(nrm.getY(i)) || !Number.isFinite(nrm.getZ(i))) {
      nrm.setXYZ(i, 0, 1, 0);
    }
  }
  return g;
}

/* A soft round dot, for the nav lights and the spark burst. Painted once and
   shared: three PointsMaterials each carrying their own 64² canvas would be
   three textures for one gradient. */
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* The downwash ring: bright at the rim, empty in the middle, because that is
   what a rotor actually throws — the air goes DOWN through the disc and OUT
   along the ground, so the dust is a torus, never a filled circle. Painted as
   a texture on one quad rather than built as ring geometry: an alpha gradient
   has a soft outer edge and a polygonal ring does not. */
function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255,245,225,0)');
  g.addColorStop(0.42, 'rgba(255,245,225,0)');
  g.addColorStop(0.68, 'rgba(255,240,215,0.55)');
  g.addColorStop(0.86, 'rgba(230,215,190,0.22)');
  g.addColorStop(1.00, 'rgba(230,215,190,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}


/* =============================================================================
   SECTION 3 — THE KIT
   `DroneKit.load()` does every expensive thing once: fetch the GLB, bake the
   ORNIS down to three merged geometries, decimate them, build the shared rotor
   and light parts, and render one sprite per variant. Everything after that is
   synchronous, which is what lets `make()` be called from an event handler.
   ========================================================================== */

export class DroneKit {

  static async load(renderer, manifestUrl = 'assets/manifest.json') {
    const kit = new DroneKit();
    kit.renderer = renderer;
    kit.manifest = await (await fetch(manifestUrl)).json();

    const rec = kit.manifest['model.drone.ornis'];
    if (!rec) throw new Error('manifest has no model.drone.ornis — see docs/DRONES.md');
    const base = manifestUrl.replace(/[^/]*$/, '');

    const loader = new GLTFLoader().setPath(base);
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise((res, rej) => loader.load(rec.path, res, undefined, rej));

    kit._bakeOrnis(gltf.scene);
    kit._buildShared();
    kit._bakeSprites(renderer);
    return kit;
  }

  constructor() {
    /* Every craft `make()` has handed out. `update()` walks this; nothing else
       does, and a host that drops a craft on the floor keeps it flying, which
       is why `remove()` exists. */
    this.craft = new Set();
    this.night = 0;
    this.env = null;
    this.time = 0;
    /* Ground height under a craft, for the downwash ring. A flat world is the
       honest default; a host with terrain replaces this with its own probe,
       the same shape life.js takes as `getHeight`. */
    this.getHeight = () => 0;
  }

  /* ---------------------------------------------------------------------
     Bake the ORNIS: 102 nodes and 12 materials down to 3 merged geometries
     The model is a node soup — every part is its own root-level node with its
     own mesh, no hierarchy at all. That is 102 draw calls per craft as it
     ships, and sixty craft would be six thousand. Merging by shading bucket
     with the material colour written into a vertex attribute gets a whole
     airframe onto three draws, and because none of the twelve materials
     carries a texture, nothing is lost doing it.
     --------------------------------------------------------------------- */
  _bakeOrnis(root) {
    root.updateMatrixWorld(true);

    const buckets = { hull: [], metal: [], glow: [] };
    const props = [];            // the eight blade meshes — they must spin
    const hubs = [];             // where the four rotors sit

    root.traverse(o => {
      if (!o.isMesh) return;
      const name = o.name || '';
      /* PropHub_* is the top of the motor shaft, which is exactly where a
         rotor turns. Taking the mount point off the model instead of guessing
         it is what makes the blur disc sit ON the hub rather than through it. */
      if (name.startsWith('PropHub_')) hubs.push(o.getWorldPosition(new THREE.Vector3()));
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      /* Merging needs identical attribute sets. Half the model has UVs and
         half does not, and a merge across that mix silently drops the whole
         attribute on some builds — so strip UVs everywhere. Nothing here is
         textured, so they were never read. */
      g.deleteAttribute('uv'); g.deleteAttribute('uv1'); g.deleteAttribute('tangent');
      if (!g.getIndex()) g.setIndex([...Array(g.getAttribute('position').count).keys()]);

      const matName = (o.material && o.material.name) || 'OrnisDark';
      const col = o.material && o.material.color ? o.material.color : new THREE.Color(0x333333);
      const n = g.getAttribute('position').count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));

      if (name.startsWith('Prop_')) props.push(g);
      else buckets[MAT_BUCKET[matName] || 'hull'].push(g);
    });

    /* One frame for the whole airframe: centre it on the rotor square in X/Z,
       drop the skids onto y = 0, and scale so the rotor-tip span is BASE_SPAN.
       Every variant's `scale` is then a plain multiplier on a craft whose size
       is a known number of metres, which is what makes "×1.8" mean anything. */
    const all = mergeGeometries([...Object.values(buckets).flat(), ...props], false);
    all.computeBoundingBox();
    const bb = all.boundingBox;
    const span = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    const k = BASE_SPAN / span;
    const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2, fy = bb.min.y;
    const fix = new THREE.Matrix4()
      .makeScale(k, k, k)
      .multiply(new THREE.Matrix4().makeTranslation(-cx, -fy, -cz));
    all.dispose();

    this.geo = {};
    for (const [b, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.applyMatrix4(fix);
      /* The model's OWN normals are kept. `computeVertexNormals` here would
         both throw away the exported smoothing (the motor windings and the
         lens hood are visibly faceted without it) and generate NaN on the
         model's degenerate triangles — see the note in decimate(). The fix
         matrix is a uniform scale plus a translation, which cannot invalidate
         a normal, so there is nothing to recompute. */
      this.geo[b] = g;
      /* LOD1 cells: the hull is big shapes and welds hard, the glow parts are
         small and vanish entirely on a coarse grid, so they get a finer one. */
      this.geo[b + '1'] = decimate(g, b === 'glow' ? 0.035 : 0.055);
    }
    for (const g of Object.values(buckets).flat()) g.dispose();

    /* The rotor: the two blades of the front-left motor, moved so the hub is
       at the origin. One geometry, reused at all four mounts — the four rotors
       on a quad are the same part, and modelling them as four is four times
       the buffer for no pixel of difference. */
    const rotor = mergeGeometries(props.slice(0, 2), false);
    rotor.applyMatrix4(fix);
    const h0 = hubs[0].clone().applyMatrix4(fix);
    rotor.translate(-h0.x, -h0.y, -h0.z);
    this.geo.rotor = rotor;
    this.geo.rotor1 = decimate(rotor, 0.03);
    for (const g of props) g.dispose();

    this.hubs = hubs.map(h => h.clone().applyMatrix4(fix));
    /* The blur disc has to cover the blades and no more. Measured off the
       real hub spacing rather than typed in, so a re-export of the model
       cannot silently leave the discs the wrong size. */
    this.rotorRadius = this.hubs.length > 1
      ? this.hubs[0].distanceTo(this.hubs[1]) * 0.46
      : BASE_SPAN * 0.22;

    let tris = 0;
    for (const key of ['hull', 'metal', 'glow']) if (this.geo[key]) tris += this.geo[key].getIndex().count / 3;
    this.baseTris = tris + (rotor.getIndex().count / 3) * 4;
    this.lod1Tris = ['hull1', 'metal1', 'glow1'].reduce((n, k) => n + (this.geo[k] ? this.geo[k].getIndex().count / 3 : 0), 0)
      + (this.geo.rotor1.getIndex().count / 3) * 4;
  }

  /* ---------------------------------------------------------------------
     The parts every craft shares. Two materials and four geometries here are
     what keeps sixty craft off sixty material compilations.
     --------------------------------------------------------------------- */
  _buildShared() {
    this.dot = dotTexture();
    this.dust = dustTexture();

    this.matHull = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.30, roughness: 0.62 });
    this.matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.94, roughness: 0.26 });

    /* Nav lights are three points in ONE Points object, not three sprites:
       a sprite is a mesh with its own draw, and sixty craft × three lights is
       180 draws for nine pixels of colour. The strobe is done by writing the
       size attribute, so the material never changes and the batch never
       breaks. */
    this.matNav = new THREE.PointsMaterial({
      size: 1, sizeAttenuation: true, map: this.dot, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    /* PointsMaterial has ONE size for the whole object, so a strobe would mean
       a second Points per craft — 60 more draws for one blinking pixel. Three
       lines of onBeforeCompile give the built-in shader a per-point `size`
       attribute instead, and the strobe becomes a buffer write inside the batch
       that is already there. `gl_PointSize` is written by the stock shader as
       `size * scale / -mvPosition.z`, so multiplying it afterwards is the one
       edit that survives a Three.js point release.
       The attribute is `navSize` and NOT `size`: PointsMaterial's own shader
       already declares `uniform float size`, and a second declaration is a hard
       "'size' : redefinition" link failure that takes down every Points object
       on the page, not only this one. */
    this.matNav.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float navSize;\n' + shader.vertexShader
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n\tgl_PointSize *= navSize;');
    };
    /* Two materials that compile to different programs must not share a cache
       key, and Three keys custom shaders off this string. */
    this.matNav.customProgramCacheKey = () => 'drones-nav';
    this.matSpark = new THREE.PointsMaterial({
      size: 0.05, sizeAttenuation: true, map: this.dot, color: EMBER,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.matDust = new THREE.MeshBasicMaterial({
      map: this.dust, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });

    this.geo.disc = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
    this.geo.quad = new THREE.PlaneGeometry(1, 1);
    this.geo.torus = new THREE.TorusGeometry(1, 0.055, 6, 22).rotateX(Math.PI / 2);
    this.geo.box = new THREE.BoxGeometry(1, 1, 1);
    this.geo.rod = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
    this.geo.ball = new THREE.SphereGeometry(0.5, 10, 7);
    /* A cone with its APEX at the origin and its mouth pointing down −Y, so an
       emitter can be parented straight to a turret and the beam hangs from it
       — the same trick city.js uses for its search-light. */
    this.geo.cone = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0);
  }

  /* ---------------------------------------------------------------------
     LOD2: one sprite per variant, rendered off the real craft
     A billboard of the actual machine, not a coloured dot. At 400 m+ the
     silhouette is all that is left, and a bake keeps the wide-wing craft wide
     and the mast craft tall — which is the whole promise of this module, held
     at the distance where it is hardest to hold.
     --------------------------------------------------------------------- */
  _bakeSprites(renderer) {
    const S = 128;
    const rt = new THREE.WebGLRenderTarget(S, S, { colorSpace: THREE.SRGBColorSpace });
    const scene = new THREE.Scene();
    /* Flat, generous light: the sprite is seen against sky at a kilometre and
       a directional key would bake a shadow side that then reads as damage. */
    scene.add(new THREE.AmbientLight(0xffffff, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 2, 1.4); scene.add(key);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);

    const prevTarget = renderer.getRenderTarget();
    this.sprites = {};

    for (const type of Object.keys(VARIANTS)) {
      const proto = this.make(type, { seed: 1, lod: 0 });
      /* The craft is built to fly, so it carries a dust ring and beams that
         are invisible in flight and would be baked in here. Strip them. */
      proto.userData.dustRing.visible = false;
      for (const e of proto.userData.emitters) e.visible = false;
      scene.add(proto);

      const bb = new THREE.Box3().setFromObject(proto);
      const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
      const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
      /* Three-quarter front-high, the angle a drone is actually seen from when
         it is working over a city and you are standing in it. */
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.updateProjectionMatrix();
      cam.position.set(c.x + r * 1.6, c.y + r * 1.1, c.z + r * 2.0);
      cam.lookAt(c);

      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, cam);

      const buf = new Uint8Array(S * S * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const img = cv.getContext('2d').createImageData(S, S);
      /* WebGL reads bottom-up; a canvas is top-down. Straight copy gives a
         fleet of upside-down drones at the horizon, and it looks like a
         gravity bug rather than a blit bug. */
      for (let y = 0; y < S; y++) {
        img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      }
      cv.getContext('2d').putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.sprites[type] = { tex, size: r * 2 };

      scene.remove(proto);
      this.craft.delete(proto);       // a prototype is not part of the fleet
    }

    renderer.setRenderTarget(prevTarget);
    rt.dispose();
  }


  /* =========================================================================
     SECTION 4 — make(): one craft
     Returns a THREE.Group the host positions and rotates. Everything the host
     needs to hook onto is on `group.userData`, and the three setters are the
     entire runtime API of a craft.
     ====================================================================== */

  /**
   * @param {string} type  a key of VARIANTS
   * @param {object} opts  { tier, seed, lod }
   * @returns {THREE.Group}
   */
  make(type, opts = {}) {
    const spec = VARIANTS[type] || VARIANTS['worker.net'];
    const rand = rng(opts.seed || 1);
    /* Tier only means anything on a subagent craft; on a worker it would fight
       the family colour, which is the one thing a viewer reads off a worker. */
    const accent = new THREE.Color(
      type === 'agent' ? (TIERS[opts.tier] !== undefined ? TIERS[opts.tier] : SILVER) : spec.accent
    );

    const g = new THREE.Group();
    g.name = 'drone:' + type;
    const s = spec.scale;

    /* --- the airframe, three LOD tiers deep -------------------------------
       All three tiers are BUILT now and swapped by visibility later. Building
       LOD1 lazily at the moment a craft crosses 120 m means a geometry upload
       mid-flight, and that is a stutter you can see. */
    const matGlow = new THREE.MeshStandardMaterial({
      color: accent, emissive: accent, emissiveIntensity: 0.9,
      metalness: 0.2, roughness: 0.4, vertexColors: false,
    });

    const lod0 = new THREE.Group();
    lod0.add(new THREE.Mesh(this.geo.hull, this.matHull));
    lod0.add(new THREE.Mesh(this.geo.metal, this.matMetal));
    lod0.add(new THREE.Mesh(this.geo.glow, matGlow));

    const lod1 = new THREE.Group(); lod1.visible = false;
    lod1.add(new THREE.Mesh(this.geo.hull1, this.matHull));
    lod1.add(new THREE.Mesh(this.geo.metal1, this.matMetal));
    lod1.add(new THREE.Mesh(this.geo.glow1, matGlow));

    /* The rotors live outside the LOD groups because they spin, and a spinning
       child of a group that gets hidden keeps its stale rotation. Four meshes
       sharing one geometry and one material: four draws in the same batch. */
    const rotors = [];
    for (const h of this.hubs) {
      const r = new THREE.Group();
      r.position.copy(h);
      const blades = new THREE.Mesh(this.geo.rotor, this.matMetal);
      r.add(blades);
      /* The blur disc: what a spinning rotor actually looks like. It fades in
         with rpm, so a docked craft shows its blades and a working one shows
         a disc — which is how a person tells "landed" from "hovering" at a
         hundred metres without reading anything. */
      const blur = new THREE.Mesh(this.geo.disc, new THREE.MeshBasicMaterial({
        color: 0xdfe6ee, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      blur.scale.setScalar(this.rotorRadius);
      r.add(blur);
      rotors.push({ group: r, blades, blur, dir: rotors.length % 2 ? 1 : -1 });
      lod0.add(r);
    }

    /* During `_bakeSprites` this craft IS the prototype being photographed, so
       its own sprite does not exist yet. `baked` is undefined for exactly that
       one call per variant and for no other. */
    const baked = this.sprites && this.sprites[type];
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: baked ? baked.tex : null, transparent: true, depthWrite: false,
    }));
    if (baked) sprite.scale.setScalar(baked.size);
    sprite.position.y = BASE_SPAN * 0.15;
    sprite.visible = false;

    /* --- nav lights ------------------------------------------------------
       Port red, starboard green, tail white strobe: the real convention, and
       the reason is worth keeping — from behind, red-on-the-left tells you the
       aircraft is flying AWAY from you. That reading survives at any distance
       and no other cue on the craft gives it. */
    const navPos = new Float32Array([
      -BASE_SPAN * 0.50, 0.02, BASE_SPAN * 0.24,   // port
      BASE_SPAN * 0.50, 0.02, BASE_SPAN * 0.24,    // starboard
      0, BASE_SPAN * 0.10, -BASE_SPAN * 0.36,      // tail strobe
    ]);
    const navCol = new Float32Array([1, 0.13, 0.10, 0.18, 1, 0.35, 1, 1, 1]);
    const navGeo = new THREE.BufferGeometry();
    navGeo.setAttribute('position', new THREE.BufferAttribute(navPos, 3));
    navGeo.setAttribute('color', new THREE.BufferAttribute(navCol, 3));
    navGeo.setAttribute('navSize', new THREE.BufferAttribute(new Float32Array([0.1, 0.1, 0]), 1));
    const nav = new THREE.Points(navGeo, this.matNav);
    lod0.add(nav);

    /* --- downwash ------------------------------------------------------- */
    const dustRing = new THREE.Mesh(this.geo.quad, this.matDust.clone());
    dustRing.rotation.x = -Math.PI / 2;
    dustRing.visible = false;
    g.add(dustRing);

    /* --- the variant's own attachments ---------------------------------- */
    const emitters = [];
    const rig = this[`_rig_${spec.rig}`](lod0, accent, matGlow, rand, emitters);

    /* --- anchors the host hangs things on -------------------------------
       Empty Object3Ds, deliberately: a host that wants the tag at a different
       height moves the anchor, and nothing in here has to know about it. */
    const tagAnchor = new THREE.Object3D();
    tagAnchor.position.y = (rig && rig.tagY !== undefined ? rig.tagY : BASE_SPAN * 0.42);
    g.add(tagAnchor);
    const trailAnchor = new THREE.Object3D();
    trailAnchor.position.set(0, BASE_SPAN * 0.02, -BASE_SPAN * 0.34);
    g.add(trailAnchor);

    /* The airframe hangs off a tilt pivot so `setSpeed` can bank the machine
       without touching the group the host is steering. Mixing the host's yaw
       and the kit's roll on one object is how a drone ends up flying sideways
       and nobody can find the line that did it. */
    const tilt = new THREE.Group();
    tilt.add(lod0); tilt.add(lod1); tilt.add(sprite);
    g.add(tilt);
    g.scale.setScalar(s);

    g.userData = {
      type, kit: this, spec, accent, tilt, lod0, lod1, sprite, rotors, nav, dustRing,
      emitters, tagAnchor, trailAnchor, matGlow, rig,
      lod: 0, rpm: 0, targetRpm: 0.55, working: false, lights: 1,
      speed: 0, bob: rand() * 6.28, strobe: rand() * 6.28, sway: rand() * 6.28,
      vel: new THREE.Vector3(), prev: new THREE.Vector3(),

      /** Metres per second, from the host's own motion. Banks and pitches the
       *  craft, and spins the rotors up — a drone that moves without leaning
       *  is the single clearest tell that it is a sprite and not an aircraft. */
      setSpeed: v => {
        const u = g.userData;
        if (typeof v === 'number') { u.speed = v; u.vel.set(0, 0, -v); }
        else { u.vel.copy(v); u.speed = u.vel.length(); }
        u.targetRpm = 0.42 + Math.min(1, u.speed / 8) * 0.9;
      },
      /** On: the beams, lasers, cone or sparks this variant carries. */
      setWorking: on => {
        const u = g.userData;
        u.working = !!on;
        for (const e of u.emitters) e.visible = !!on;
      },
      /** 0 dark … 1 full. The host's day/night, per craft: a craft inside a
       *  lit interior wants its strobes down even at night. */
      setLights: t => { g.userData.lights = Math.max(0, Math.min(1, t)); },
    };

    g.userData.setWorking(false);
    this.craft.add(g);
    return g;
  }

  /** Stop flying a craft. The host still has to remove it from its own scene —
   *  the kit never owned the parenting and must not guess at it. */
  remove(g) { this.craft.delete(g); }


  /* =========================================================================
     SECTION 5 — THE RIGS
     One builder per variant. Every one of these is procedural boxes, rods and
     rings on the SAME airframe, and each puts its mass on a different axis so
     the seven read apart as outlines:

       orchestrator  four rings around the props + a halo under   — widest ring pattern
       agent         a slung box under the belly                  — a lump below
       read          a ball turret hanging down                   — a sphere below
       edit          two booms raked forward + a fin stack on top — horns in front
       search        two wide flat wings                          — the widest span
       shell         a boxy skid cage + two arms reaching forward — heavy and low
       net           a tall mast above the hull                   — the tallest

     `emitters` collects the parts that only exist while the craft is working;
     `setWorking` toggles exactly that array, so a rig adds an effect by
     pushing it and nothing else in the module changes.
     ====================================================================== */

  /* Small helper: a mesh from a shared geometry with a per-craft emissive
     material. Only the glowing bits need their own material (the accent colour
     differs per craft); structure reuses matHull and stays in one batch. */
  _lit(geo, color, intensity = 1.1) {
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: intensity, roughness: 0.35, metalness: 0.1,
    }));
  }
  _part(geo, color = 0x2a2d33, metal = 0.5, rough = 0.55) {
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
  }

  /* ORCHESTRATOR — the command craft. Four rotor guards make its outline a row
     of circles nothing else in the fleet has, and the underslung beacon ring
     is the one part visible from directly below, which is where the city's
     camera usually is. */
  _rig_orchestrator(host, accent, matGlow, rand, emitters) {
    for (const h of this.hubs) {
      const guard = this._part(this.geo.torus, 0x3a3d44, 0.75, 0.4);
      guard.position.copy(h); guard.position.y -= BASE_SPAN * 0.012;
      guard.scale.setScalar(this.rotorRadius * 1.14);
      host.add(guard);
    }
    const beacon = this._lit(this.geo.torus, accent, 1.6);
    beacon.position.y = -BASE_SPAN * 0.16;
    beacon.scale.setScalar(BASE_SPAN * 0.46);
    host.add(beacon);
    /* Four gold accent pips on the shell, so the craft still reads as the
       leader head-on where the beacon is edge-on and invisible. */
    for (let i = 0; i < 4; i++) {
      const pip = this._lit(this.geo.ball, accent, 1.4);
      pip.scale.setScalar(BASE_SPAN * 0.035);
      pip.position.set(Math.cos(i * 1.571) * BASE_SPAN * 0.14, BASE_SPAN * 0.09, Math.sin(i * 1.571) * BASE_SPAN * 0.14);
      host.add(pip);
    }
    return { tagY: BASE_SPAN * 0.52, beacon };
  }

  /* AGENT — a subagent craft. It carries work, so it carries a box: one pod
     slung under the belly with the tier colour on its band. */
  _rig_agent(host, accent, matGlow, rand, emitters) {
    const pod = this._part(this.geo.box, 0x24262b, 0.4, 0.6);
    pod.scale.set(BASE_SPAN * 0.26, BASE_SPAN * 0.17, BASE_SPAN * 0.38);
    pod.position.y = -BASE_SPAN * 0.125;
    host.add(pod);
    const band = this._lit(this.geo.box, accent, 1.2);
    band.scale.set(BASE_SPAN * 0.265, BASE_SPAN * 0.030, BASE_SPAN * 0.385);
    band.position.y = -BASE_SPAN * 0.070;
    host.add(band);
    /* Two struts, so the pod hangs off the airframe instead of floating in it. */
    for (const x of [-1, 1]) {
      const st = this._part(this.geo.rod, 0x3a3d44, 0.8, 0.35);
      st.scale.set(BASE_SPAN * 0.014, BASE_SPAN * 0.07, BASE_SPAN * 0.014);
      st.position.set(x * BASE_SPAN * 0.07, -BASE_SPAN * 0.025, 0);
      host.add(st);
    }
    return { tagY: BASE_SPAN * 0.46, band };
  }

  /* READ — the sensor craft. A gimbal ball hanging below, and a cool-blue cone
     of scan light dropped straight down out of it. */
  _rig_read(host, accent, matGlow, rand, emitters) {
    const mount = this._part(this.geo.rod, 0x2c2f35, 0.6, 0.5);
    mount.scale.set(BASE_SPAN * 0.055, BASE_SPAN * 0.10, BASE_SPAN * 0.055);
    mount.position.y = -BASE_SPAN * 0.070;
    host.add(mount);
    const turret = this._part(this.geo.ball, 0x1a1c20, 0.35, 0.35);
    turret.scale.setScalar(BASE_SPAN * 0.22);
    turret.position.y = -BASE_SPAN * 0.155;
    host.add(turret);
    const lens = this._lit(this.geo.ball, accent, 1.7);
    lens.scale.setScalar(BASE_SPAN * 0.085);
    lens.position.set(0, -BASE_SPAN * 0.235, BASE_SPAN * 0.045);
    host.add(lens);

    const beam = this._beam(accent, BASE_SPAN * 0.10, 5.2, 0.30);
    beam.position.y = -BASE_SPAN * 0.235;
    host.add(beam); emitters.push(beam);
    return { tagY: BASE_SPAN * 0.44, beam };
  }

  /* EDIT / WRITE — the hot one. Two printer arms raked forward carry the
     emitters the Ares materialisation fires from, and a stack of heat vents
     sits on the spine, because a machine that writes runs hot. */
  _rig_edit(host, accent, matGlow, rand, emitters) {
    for (const x of [-1, 1]) {
      const arm = this._part(this.geo.box, 0x2e3037, 0.7, 0.4);
      arm.scale.set(BASE_SPAN * 0.055, BASE_SPAN * 0.055, BASE_SPAN * 0.60);
      arm.position.set(x * BASE_SPAN * 0.21, -BASE_SPAN * 0.02, BASE_SPAN * 0.30);
      arm.rotation.x = -0.22;
      host.add(arm);
      const tip = this._lit(this.geo.ball, accent, 1.9);
      tip.scale.setScalar(BASE_SPAN * 0.065);
      tip.position.set(x * BASE_SPAN * 0.21, -BASE_SPAN * 0.09, BASE_SPAN * 0.585);
      host.add(tip);

      /* The laser itself: a thin cone from the tip, forward and down, the way
         a print head actually points at what it is writing on. */
      const las = this._beam(accent, BASE_SPAN * 0.022, 4.4, 0.55);
      las.position.copy(tip.position);
      las.rotation.x = -0.5;
      host.add(las); emitters.push(las);
    }
    /* Heat vents — five fins, hard-edged, on top. Read as a ridge from above,
       which is the one angle the arms are foreshortened at. */
    for (let i = 0; i < 5; i++) {
      const fin = this._part(this.geo.box, 0x3c3026, 0.55, 0.6);
      fin.scale.set(BASE_SPAN * 0.20, BASE_SPAN * 0.10, BASE_SPAN * 0.016);
      fin.position.set(0, BASE_SPAN * 0.155, -BASE_SPAN * 0.06 + i * BASE_SPAN * 0.036);
      host.add(fin);
    }
    return { tagY: BASE_SPAN * 0.48 };
  }

  /* SEARCH — the widest craft in the fleet. Two flat swept wings, and a broad
     cone that the update loop sweeps across the ground. */
  _rig_search(host, accent, matGlow, rand, emitters) {
    for (const x of [-1, 1]) {
      const wing = this._part(this.geo.box, 0x2a2d33, 0.45, 0.55);
      wing.scale.set(BASE_SPAN * 0.62, BASE_SPAN * 0.022, BASE_SPAN * 0.26);
      wing.position.set(x * BASE_SPAN * 0.50, BASE_SPAN * 0.03, -BASE_SPAN * 0.03);
      wing.rotation.y = x * 0.30;   // swept back, so the outline is an arrow
      host.add(wing);
      const edge = this._lit(this.geo.box, accent, 1.0);
      edge.scale.set(BASE_SPAN * 0.62, BASE_SPAN * 0.014, BASE_SPAN * 0.034);
      edge.position.set(x * BASE_SPAN * 0.50, BASE_SPAN * 0.042, BASE_SPAN * 0.08);
      edge.rotation.y = x * 0.30;
      host.add(edge);
    }
    /* The sweep pivot is its own object so `update` can swing the cone without
       swinging the craft — a search-light rakes; the aircraft holds station. */
    const pivot = new THREE.Object3D();
    pivot.position.y = -BASE_SPAN * 0.06;
    host.add(pivot);
    const cone = this._beam(accent, BASE_SPAN * 0.55, 6.0, 0.22);
    pivot.add(cone); emitters.push(cone);
    return { tagY: BASE_SPAN * 0.44, sweep: pivot };
  }

  /* SHELL — heavy-duty. A skid cage under it and two arms reaching forward and
     down, so the craft reads low and squat where the others read light. */
  _rig_shell(host, accent, matGlow, rand, emitters) {
    for (const z of [-1, 1]) {
      const skid = this._part(this.geo.box, 0x33363d, 0.8, 0.45);
      skid.scale.set(BASE_SPAN * 0.62, BASE_SPAN * 0.042, BASE_SPAN * 0.042);
      skid.position.set(0, -BASE_SPAN * 0.22, z * BASE_SPAN * 0.20);
      host.add(skid);
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const leg = this._part(this.geo.rod, 0x33363d, 0.8, 0.45);
      leg.scale.set(BASE_SPAN * 0.026, BASE_SPAN * 0.21, BASE_SPAN * 0.026);
      leg.position.set(x * BASE_SPAN * 0.25, -BASE_SPAN * 0.12, z * BASE_SPAN * 0.20);
      host.add(leg);
    }
    for (const x of [-1, 1]) {
      const upper = this._part(this.geo.box, 0x3d3128, 0.65, 0.5);
      upper.scale.set(BASE_SPAN * 0.06, BASE_SPAN * 0.06, BASE_SPAN * 0.32);
      upper.position.set(x * BASE_SPAN * 0.13, -BASE_SPAN * 0.14, BASE_SPAN * 0.18);
      host.add(upper);
      const fore = this._part(this.geo.box, 0x3d3128, 0.65, 0.5);
      fore.scale.set(BASE_SPAN * 0.055, BASE_SPAN * 0.26, BASE_SPAN * 0.055);
      fore.position.set(x * BASE_SPAN * 0.13, -BASE_SPAN * 0.27, BASE_SPAN * 0.33);
      host.add(fore);
      const claw = this._lit(this.geo.ball, accent, 1.3);
      claw.scale.setScalar(BASE_SPAN * 0.055);
      claw.position.set(x * BASE_SPAN * 0.13, -BASE_SPAN * 0.40, BASE_SPAN * 0.33);
      host.add(claw);
    }
    /* Sparks: 26 points re-seeded every frame the craft is working. A Points
       object costs one draw whether it holds four particles or four hundred,
       which is why this is not four hundred meshes. */
    const n = 26;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const sparks = new THREE.Points(geo, this.matSpark);
    sparks.position.set(0, -BASE_SPAN * 0.42, BASE_SPAN * 0.33);
    sparks.userData.seed = rand() * 1000;
    host.add(sparks); emitters.push(sparks);
    return { tagY: BASE_SPAN * 0.46, sparks };
  }

  /* NET — the tallest craft. One mast straight up with a blinking tip: nothing
     else in the fleet is taller than it is wide, so it is unmistakable in a
     line-up and in the sky. */
  _rig_net(host, accent, matGlow, rand, emitters) {
    const mast = this._part(this.geo.rod, 0x3a3d44, 0.85, 0.3);
    mast.scale.set(BASE_SPAN * 0.020, BASE_SPAN * 0.78, BASE_SPAN * 0.020);
    mast.position.y = BASE_SPAN * 0.47;
    host.add(mast);
    for (const y of [0.40, 0.62]) {
      const cross = this._part(this.geo.rod, 0x3a3d44, 0.85, 0.3);
      cross.scale.set(BASE_SPAN * 0.014, BASE_SPAN * 0.30, BASE_SPAN * 0.014);
      cross.rotation.z = Math.PI / 2;
      cross.position.y = BASE_SPAN * y;
      host.add(cross);
    }
    const tip = this._lit(this.geo.ball, accent, 2.0);
    tip.scale.setScalar(BASE_SPAN * 0.07);
    tip.position.y = BASE_SPAN * 0.88;
    host.add(tip);
    /* A dish on the belly, so the craft is not just "the one with a stick". */
    const dish = this._part(this.geo.cone, 0x24262b, 0.5, 0.5);
    dish.scale.set(BASE_SPAN * 0.14, BASE_SPAN * 0.08, BASE_SPAN * 0.14);
    dish.position.y = -BASE_SPAN * 0.05;
    host.add(dish);
    /* The "link" is an uplink, so it points UP, not down: the only beam in the
       fleet that does, which is another silhouette cue for free. */
    const up = this._beam(accent, BASE_SPAN * 0.14, 4.0, 0.26);
    up.position.y = BASE_SPAN * 0.88;
    up.rotation.z = Math.PI;      // flip the cone so it opens upward
    host.add(up); emitters.push(up);
    return { tagY: BASE_SPAN * 1.00, tip };
  }

  /* A beam: the shared cone geometry, apex at the origin, hanging down −Y.
     `radius` is the mouth at `length` metres; additive and non-writing so two
     crossing beams brighten instead of z-fighting. */
  _beam(color, radius, length, opacity) {
    const m = new THREE.Mesh(this.geo.cone, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.scale.set(radius, length, radius);
    m.userData.baseOpacity = opacity;
    return m;
  }


  /* =========================================================================
     SECTION 6 — update(): one call a frame
     Rotors, strobes, bob, bank, downwash, beams, LOD. Everything that moves in
     this module moves here, so a host that forgets to call it gets a fleet of
     statues rather than a subtle half-broken one.
     ====================================================================== */

  update(dt, camera) {
    this.time += dt;
    const t = this.time;
    const camPos = camera ? camera.getWorldPosition(new THREE.Vector3()) : null;

    for (const g of this.craft) {
      const u = g.userData;

      /* --- LOD ---------------------------------------------------------- */
      if (camPos) {
        const d = camPos.distanceTo(g.getWorldPosition(new THREE.Vector3()));
        const lod = this.lodFor(d);
        if (lod !== u.lod) {
          u.lod = lod;
          u.lod0.visible = lod === 0;
          u.lod1.visible = lod === 1;
          u.sprite.visible = lod === 2;
        }
      }
      if (u.lod === 2) continue;   // a sprite has nothing left to animate

      /* --- rotors ------------------------------------------------------- */
      u.rpm += (u.targetRpm - u.rpm) * Math.min(1, dt * 3);
      const spin = u.rpm * 46 * dt;
      for (const r of u.rotors) {
        r.group.rotation.y += spin * r.dir;
        /* Above about half power the blades are a disc to the eye and a strobe
           artefact to the renderer, so the disc takes over and the blades fade
           behind it rather than flickering through it. */
        const blur = Math.max(0, Math.min(1, (u.rpm - 0.28) / 0.5));
        r.blur.material.opacity = blur * 0.30 * (0.55 + 0.45 * u.lights);
        r.blades.visible = blur < 0.92;
      }

      /* --- hover bob and sway -------------------------------------------
         Two frequencies that do not divide into each other, or sixty craft
         breathe in unison and the fleet reads as one object. */
      u.bob += dt * 1.7; u.sway += dt * 0.63;
      u.tilt.position.y = Math.sin(u.bob) * BASE_SPAN * 0.022;

      /* --- bank and pitch -----------------------------------------------
         Roll into the turn, pitch nose-down into the run. Clamped hard: past
         about 18° a hovering camera drone stops looking like it is holding
         station and starts looking like it is falling. */
      const fwd = Math.min(1, u.speed / 9);
      const lat = Math.max(-1, Math.min(1, u.vel.x / 6));
      u.tilt.rotation.x += (fwd * 0.30 - u.tilt.rotation.x) * Math.min(1, dt * 2.2);
      u.tilt.rotation.z += (-lat * 0.26 + Math.sin(u.sway) * 0.012 - u.tilt.rotation.z) * Math.min(1, dt * 2.2);

      /* --- nav strobes ---------------------------------------------------
         Port and starboard burn steady; the tail flashes twice a second. The
         size attribute is written, not the material, so all sixty craft stay
         in one batch. */
      u.strobe += dt;
      const size = u.nav.geometry.getAttribute('navSize');
      const lit = 0.055 * BASE_SPAN * (0.35 + 0.65 * u.lights);
      const flash = (u.strobe % 1.35) < 0.09 ? lit * 3.4 : 0;
      size.setX(0, lit); size.setX(1, lit); size.setX(2, flash);
      size.needsUpdate = true;
      u.nav.visible = u.lights > 0.02;

      /* --- downwash -------------------------------------------------------
         Only within two rotor spans of the ground, and only while the rotors
         are actually turning. A dust ring under a parked drone is the kind of
         detail that reads as a bug the moment somebody notices it. */
      const y = g.position.y - this.getHeight(g.position.x, g.position.z);
      const near = Math.max(0, 1 - y / (BASE_SPAN * 2.2));
      if (near > 0.01 && u.rpm > 0.3) {
        u.dustRing.visible = true;
        u.dustRing.position.set(0, -y / g.scale.x + 0.02, 0);
        const r = BASE_SPAN * (1.5 + (1 - near) * 2.6);
        u.dustRing.scale.set(r, r, 1);
        u.dustRing.material.opacity = near * near * 0.55 * u.rpm;
      } else if (u.dustRing.visible) {
        u.dustRing.visible = false;
      }

      /* --- what the craft is doing ---------------------------------------- */
      if (u.working) {
        /* The search cone rakes; nothing else does. */
        if (u.rig && u.rig.sweep) u.rig.sweep.rotation.z = Math.sin(t * 0.9 + u.sway) * 0.55;
        /* The orchestrator's beacon and the net craft's tip pulse — one slow,
           one blinking — which is the difference between "in command" and
           "transmitting" without a word of text. */
        if (u.rig && u.rig.beacon) u.rig.beacon.material.emissiveIntensity = 1.2 + Math.sin(t * 2.1) * 0.6;
        if (u.rig && u.rig.tip) u.rig.tip.material.emissiveIntensity = (t % 0.9) < 0.25 ? 3.0 : 0.5;
        for (const e of u.emitters) {
          if (e.isPoints) this._sparks(e, t);
          else if (e.material) e.material.opacity = e.userData.baseOpacity * (0.72 + Math.sin(t * 7 + u.sway) * 0.28);
        }
      }
      u.matGlow.emissiveIntensity = (u.working ? 1.5 : 0.75) * (0.4 + 0.6 * u.lights);
    }
  }

  /* Re-seed the shell craft's spark burst. Deterministic per craft per frame
     bucket, so two identical craft do not spark identically and a screenshot
     of the same frame is still the same picture. */
  _sparks(pts, t) {
    const p = pts.geometry.getAttribute('position');
    const r = rng((pts.userData.seed + Math.floor(t * 22)) | 0);
    for (let i = 0; i < p.count; i++) {
      const age = r();
      p.setXYZ(i,
        (r() - 0.5) * BASE_SPAN * 0.30 * age,
        -age * age * BASE_SPAN * 0.34,
        (r() - 0.5) * BASE_SPAN * 0.26 * age + BASE_SPAN * 0.02);
    }
    p.needsUpdate = true;
  }

  /** 0 full mesh · 1 decimated · 2 sprite. The brief's bands. */
  lodFor(distance) { return distance < LOD_NEAR ? 0 : distance < LOD_FAR ? 1 : 2; }

  /** 0 day … 1 night. Night makes every light on the fleet matter more; it
   *  does not make the airframe glow, because a lit drone at night is a set of
   *  points in the dark and that is the whole picture. */
  setNight(t) {
    this.night = Math.max(0, Math.min(1, t));
    this.matNav.opacity = 0.55 + 0.45 * this.night;
    this.matHull.envMapIntensity = 1 - 0.55 * this.night;
    this.matMetal.envMapIntensity = 1 - 0.35 * this.night;
    for (const g of this.craft) g.userData.setLights(0.35 + 0.65 * this.night);
  }

  /** Point every shared material at an env map — BuildingKit's `envDusk` /
   *  `envNight` are the two this was written against. Without one, a metalness
   *  0.94 rotor has nothing to reflect and renders black. */
  setEnvironment(env) {
    this.env = env;
    this.matHull.envMap = env; this.matHull.needsUpdate = true;
    this.matMetal.envMap = env; this.matMetal.needsUpdate = true;
    for (const g of this.craft) { g.userData.matGlow.envMap = env; g.userData.matGlow.needsUpdate = true; }
  }

  /** Counts, for a HUD or a doc. */
  stats() {
    const byLod = [0, 0, 0];
    for (const g of this.craft) byLod[g.userData.lod]++;
    return {
      craft: this.craft.size, byLod,
      trisEach: { lod0: this.baseTris, lod1: this.lod1Tris, lod2: 2 },
      baseSpan: BASE_SPAN, rotorRadius: this.rotorRadius, night: this.night,
    };
  }
}

export default DroneKit;

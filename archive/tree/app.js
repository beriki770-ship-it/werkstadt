/* =============================================================================
   claude-live — app.js
   Replays (or live-streams) one Claude Code session as a growing tree of files
   with agent orbs flying between them.

   The one rule this file obeys everywhere: nothing on screen is invented.
   Every node, beam, orb and number traces back to an event that actually
   arrived through ingest(). There is no simulated activity, no filler motion
   and no estimated statistic — when nothing happens, the picture goes quiet.

   Layout is Canvas 2D, not WebGL: 300 nodes is nowhere near the fill-rate where
   WebGL starts to pay for itself, and 2D keeps the file readable by someone who
   has never written a shader. Glows are pre-rendered sprites blitted with
   'lighter' compositing, which is what keeps it cheap on an integrated GPU —
   ctx.shadowBlur, the obvious alternative, costs roughly 20x per draw.
   ========================================================================= */

(() => {
'use strict';

/* =============================================================================
   PALETTE — read once from the stylesheet
   The CSS custom properties are the single source of truth for colour, so a
   change in styles.css moves the canvas too. Read once: getComputedStyle is a
   layout-flushing call and must never happen inside the frame loop.
   ========================================================================== */
const css = getComputedStyle(document.documentElement);
const C = {
  bone:  css.getPropertyValue('--bone').trim()  || '#e9e1d2',
  dim:   css.getPropertyValue('--bone-dim').trim() || '#8d857a',
  gold:  css.getPropertyValue('--gold').trim()  || '#d2a62c',
  cool:  css.getPropertyValue('--cool').trim()  || '#6fa8b8',
  ember: css.getPropertyValue('--ember').trim() || '#e2703a',
  ink:   css.getPropertyValue('--ink').trim()   || '#12100d',
};

/* One font string, built once. Assigning ctx.font is a parse on every call, so
   it is worth not rebuilding the string 300 times a frame. */
const F_LABEL = '11px "JetBrains Mono", ui-monospace, monospace';
const F_ROOT  = '15px "JetBrains Mono", ui-monospace, monospace';
const F_AGENT = '11px "JetBrains Mono", ui-monospace, monospace';
const F_SUB   = '10px "JetBrains Mono", ui-monospace, monospace';

/* Tool families. The grammar of a beam is decided here and nowhere else, so
   adding a tool means adding one line rather than hunting through the renderer. */
const FAMILY = {
  Read: 'read', NotebookRead: 'read', WebFetch: 'read',
  Edit: 'write', Write: 'write', NotebookEdit: 'write', MultiEdit: 'write',
  Grep: 'search', Glob: 'search', Search: 'search', WebSearch: 'search',
  Bash: 'shell', PowerShell: 'shell',
};
const FAMILY_COLOR = { read: C.cool, write: C.ember, search: C.cool, shell: C.gold, other: C.gold };
const familyOf = t => FAMILY[t] || 'other';


/* =============================================================================
   STAGE — canvas sizing and the pre-rendered glow sprites
   ========================================================================== */
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: true });
let W = 0, H = 0, cx = 0, cy = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); // cap at 2: a 3x phone doubles
  W = canvas.clientWidth;                          // the fill cost for no visible gain
  H = canvas.clientHeight;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cx = W / 2; cy = H * 0.52;                       // slightly low: the title sits above
  relayout();
}
window.addEventListener('resize', resize);

/* One 128px sprite per colour, drawn once at boot. Every glow in the scene is
   this image scaled — which is a single GPU blit instead of a gradient rebuild. */
const SPRITE = {};
function makeSprite(hex) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  const { r, gg, b } = hexToRgb(hex);
  grd.addColorStop(0.00, `rgba(${r},${gg},${b},1)`);
  grd.addColorStop(0.18, `rgba(${r},${gg},${b},.55)`);
  grd.addColorStop(0.50, `rgba(${r},${gg},${b},.13)`);
  grd.addColorStop(1.00, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return c;
}
function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: (n >> 16) & 255, gg: (n >> 8) & 255, b: n & 255 };
}
for (const k of ['bone', 'gold', 'cool', 'ember', 'dim']) SPRITE[k] = makeSprite(C[k]);
const spriteFor = fam => SPRITE[fam === 'read' || fam === 'search' ? 'cool'
                              : fam === 'write' ? 'ember' : 'gold'];

function label(text, x, y, alpha, colour) {
  ctx.globalAlpha = alpha * 0.9;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function glow(sprite, x, y, radius, alpha) {
  if (alpha <= 0.004) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}


/* =============================================================================
   TREE — files and directories, born the first time they are touched
   Positions are radial wedges: every node owns an angular slice of its parent's
   slice, so siblings never collide and the whole shape stays legible as it
   grows. A force simulation was the obvious alternative and was rejected —
   force layouts reshuffle every existing node whenever one is added, which
   makes the picture impossible to follow and costs a dependency.
   ========================================================================== */
const nodes = new Map();        // relative path -> node
let root = null;
let maxDepth = 1;

function makeNode(rel, name, parent) {
  const n = {
    rel, name, parent,
    children: [],
    depth: parent ? parent.depth + 1 : 0,
    isDir: false,
    x: parent ? parent.x : cx, y: parent ? parent.y : cy,  // born at the parent,
    tx: cx, ty: cy, vx: 0, vy: 0,                          // then springs outward
    weight: 1,
    heat: 0,          // 0..1, how recently it was touched — drives brightness
    ember: 0,         // slow-decaying warm mark left only by writes
    fam: 'other',
    age: 0,           // seconds since birth, used so nothing pops in at full size
    jitter: hash01(rel) - 0.5,   // deterministic radial wobble; rings look organic
  };
  nodes.set(rel, n);
  if (parent) { parent.children.push(n); parent.isDir = true; }
  maxDepth = Math.max(maxDepth, n.depth);
  return n;
}

/* Cheap deterministic 0..1 from a string. Deterministic matters: the same
   session must lay out identically every replay, or screenshots lie. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/* The root the tree hangs from. Usually the session cwd — but a real session
   often works almost entirely outside it (the 8.5-hour export this was built
   against has 221 distinct paths and not one of them under its own cwd), and
   rooting that at the cwd puts every branch behind a single meaningless stub.
   So: use the cwd when it actually covers the work, otherwise use the longest
   directory prefix the paths genuinely share. That is what "shorten long common
   prefixes" means on real data. */
let cwd = '';
const normPath = p => p.replace(/\\/g, '/').replace(/\/+$/, '');

function chooseRoot(rep) {
  const sessionCwd = normPath(rep.session.cwd || '');
  const paths = rep.events.filter(e => e.path).map(e => normPath(e.path));
  if (!paths.length) return sessionCwd;
  const under = paths.filter(p => p.toLowerCase().startsWith(sessionCwd.toLowerCase())).length;
  if (sessionCwd && under >= paths.length * 0.4) return sessionCwd;

  let parts = paths[0].split('/');
  for (const p of paths) {
    const q = p.split('/');
    let i = 0;
    while (i < parts.length && i < q.length && parts[i].toLowerCase() === q[i].toLowerCase()) i++;
    parts = parts.slice(0, i);
    if (!parts.length) break;
  }
  /* One path in the whole session would make its own filename the "prefix". */
  if (parts.length && paths.length === 1) parts.pop();
  return parts.join('/') || sessionCwd;
}

/* Turn an absolute path into a path relative to that root. Anything still
   outside it keeps only its last three segments behind an ellipsis. */
function relativise(abs) {
  if (!abs) return null;
  const p = normPath(abs);
  if (cwd && p.toLowerCase().startsWith(cwd.toLowerCase())) {
    const tail = p.slice(cwd.length).replace(/^\//, '');
    return tail || '';
  }
  const seg = p.split('/').filter(Boolean);
  return seg.length > 3 ? '…/' + seg.slice(-3).join('/') : seg.join('/');
}

/* Create every missing ancestor on the way down, so a first touch deep inside
   an unseen folder grows the whole branch at once — the Gource moment. */
function touchPath(abs) {
  const rel = relativise(abs);
  if (rel === null) return null;
  if (rel === '') return root;
  const parts = rel.split('/').filter(Boolean);
  let cur = root, acc = '';
  for (const part of parts) {
    acc = acc ? acc + '/' + part : part;
    let n = nodes.get(acc);
    if (!n) n = makeNode(acc, part, cur);
    cur = n;
  }
  return cur;
}

let rx = 400, ry = 320;

function relayout() {
  if (!root) return;
  /* An ellipse, not a circle: the window is 16:9 and a circular tree wastes the
     sides. Radius rises as depth^0.68 so ring one is already well clear of the
     centre — evenly spaced rings crowd everything into the middle. */
  rx = W * 0.33; ry = H * 0.40;
  weigh(root);
  root.tx = cx; root.ty = cy;
  assign(root, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
}
function weigh(n) {
  if (!n.children.length) { n.weight = 1; return 1; }
  let w = 0;
  for (const c of n.children) w += weigh(c);
  n.weight = w;
  return w;
}
function assign(n, a0, a1) {
  if (n !== root) {
    const a = (a0 + a1) / 2;
    const f = Math.pow(n.depth / Math.max(2.2, maxDepth), 0.68) * (1 + n.jitter * 0.12);
    n.tx = cx + Math.cos(a) * rx * f;
    n.ty = cy + Math.sin(a) * ry * f;
  }
  let a = a0;
  for (const c of n.children) {
    const span = (a1 - a0) * (c.weight / n.weight);
    /* Pad each child's wedge inward a touch so deep branches splay instead of
       stacking into a solid pie slice. */
    assign(c, a + span * 0.04, a + span * 0.96);
    a += span;
  }
}


/* =============================================================================
   ACTORS — one orb per agent
   The orchestrator is bigger and carries a gold rim; subagents are smaller and
   rimless. Size and rim, not a colour each: ten agents in ten hues would be a
   parade, and the eye would stop being able to tell reads from writes.
   ========================================================================== */
const actors = new Map();
let agentsEverSeen = 0;

function makeActor(id, label, isMain) {
  const a = {
    id, label, isMain,
    short: clip(label, 22),   // orb captions sit beside each other; sentences do not fit
    x: cx, y: cy, tx: cx, ty: cy, vx: 0, vy: 0,
    scale: isMain ? 1 : 0,   // subagents grow out of the orchestrator, from nothing
    alive: true,
    leaving: 0,              // 0..1 merge-back progress on agent_end
    breath: hash01(id) * 6.28,
    lastFam: 'other',
    busy: 0,                 // decays; a busy orb is brighter than an idle one
    anchor: null,            // the node it is currently orbiting
    anchorAng: 0, anchorDist: 60,
  };
  actors.set(id, a);
  agentsEverSeen++;
  return a;
}


/* =============================================================================
   EFFECTS — beams, ripples, sparks
   Fixed-capacity arrays with a hard cap: a burst of 200 events in one second
   must not be allowed to turn into 200 simultaneous draws and drop the frame.
   ========================================================================== */
const beams = [];
const ripples = [];
const sparks = [];
const MAX_BEAMS = 90, MAX_RIPPLES = 60, MAX_SPARKS = 160;

function fireBeam(actor, node, fam) {
  if (beams.length >= MAX_BEAMS) beams.shift();
  beams.push({
    ax: actor.x, ay: actor.y, node, fam,
    t: 0,
    life: fam === 'write' ? 1.05 : fam === 'search' ? 0.85 : 0.62,
    /* A search fans: five strands with fixed offsets, swept as the beam runs. */
    strands: fam === 'search' ? 5 : 1,
  });
}
function addRipple(node) {
  if (!node) return;
  if (ripples.length >= MAX_RIPPLES) ripples.shift();
  ripples.push({ node, t: 0, life: 0.9 });          // ring at the node
  /* …and a bead that runs up the edges toward the root, so a touch deep in the
     tree visibly reaches the trunk. */
  let hop = node, delay = 0;
  while (hop && hop.parent && delay < 4) {
    if (ripples.length >= MAX_RIPPLES) break;
    ripples.push({ edge: [hop, hop.parent], t: -delay * 0.11, life: 0.42 });
    hop = hop.parent; delay++;
  }
}
function addSparks(node, n, color) {
  for (let i = 0; i < n; i++) {
    if (sparks.length >= MAX_SPARKS) break;
    const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 160;
    sparks.push({ x: node.x, y: node.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                  t: 0, life: 0.5 + Math.random() * 0.35, color });
  }
}


/* =============================================================================
   INGEST — the single public entry point
   Replay and the live EventSource both come through here, so there is exactly
   one code path that can change what is on screen. `quiet` replays history
   after a seek: state is rebuilt, but no beams fire for the past.
   ========================================================================== */
const tally = { files: 0, tools: 0, agents: 1 };
const tickerLines = [];

function ingest(ev, quiet) {
  if (!ev || typeof ev !== 'object') return;
  const actor = actors.get(ev.agent) || actors.get('main');

  if (ev.kind === 'agent_start') {
    const a = actors.get(ev.agent) || makeActor(ev.agent, ev.label || labelFor(ev.agent), false);
    a.alive = true; a.leaving = 0;
    const main = actors.get('main');
    if (main && !quiet) { a.x = main.x; a.y = main.y; }   // born out of the orchestrator
    a.tx = cx + Math.cos(hash01(a.id) * 6.28) * Math.min(W, H) * 0.22;
    a.ty = cy + Math.sin(hash01(a.id) * 6.28) * Math.min(W, H) * 0.22;
    tally.agents = agentsEverSeen;
    if (!quiet) addSparks({ x: a.x, y: a.y }, 10, C.gold);

  } else if (ev.kind === 'agent_end') {
    const a = actors.get(ev.agent);
    if (a && !a.isMain) { a.leaving = 0.0001; }           // starts the merge-back

  } else if (ev.kind === 'tool') {
    tally.tools++;
    const fam = familyOf(ev.tool);
    const before = nodes.size;
    const node = ev.path ? touchPath(ev.path) : root;
    if (nodes.size !== before) relayout();
    if (node) {
      node.fam = fam;
      node.heat = 1;
      if (fam === 'write') node.ember = 1;
      if (actor) {
        actor.busy = 1; actor.lastFam = fam;
        /* The orb glides to the node it is working on; it does not teleport. */
        actor.anchor = node;
        actor.anchorAng = hash01(actor.id + node.rel) * 6.2832;
        actor.anchorDist = 54 + hash01(node.rel + actor.id) * 30;
        if (!quiet) fireBeam(actor, node, fam);
      }
      if (!quiet) {
        addRipple(node);
        /* Shell commands do not read a file — they strike the project root. */
        if (fam === 'shell') addSparks(root, 16, C.gold);
      }
    }

  } else if (ev.kind === 'prompt' || ev.kind === 'text') {
    if (actor) actor.busy = Math.max(actor.busy, 0.45);
  }

  tally.files = countFiles();
  lastEventAt = clock.t;
  if (!quiet) { pushTicker(ev); paintChrome(); }
}
window.ingest = ingest;   // documented contract: the live server feeds this

function labelFor(id) {
  const a = (replay && replay.agents || []).find(x => x.id === id);
  return a ? a.label : id;
}
function countFiles() {
  let n = 0;
  for (const v of nodes.values()) if (!v.isDir && v !== root) n++;
  return n;
}


/* =============================================================================
   CHROME — title, clock, tallies, ticker
   DOM is touched only when an event arrives or the clock's visible second
   changes. Writing text nodes every frame would be the single most expensive
   thing on the page.
   ========================================================================== */
const el = id => document.getElementById(id);
const VERB_CLASS = { read: 'read', search: 'read', write: 'write', shell: '', other: '' };

function pushTicker(ev) {
  const who = clip(ev.agent === 'main' ? 'Orchestrator' : labelFor(ev.agent), 28);
  let verb, what;
  if (ev.kind === 'tool')            { verb = ev.tool; what = readable(ev); }
  else if (ev.kind === 'agent_start'){ verb = 'dispatched'; what = clip(ev.summary, 72) || who; }
  else if (ev.kind === 'agent_end')  { verb = 'returned';   what = clip(ev.summary, 72) || who; }
  else if (ev.kind === 'prompt')     { verb = 'prompt';     what = clip(ev.summary, 90); }
  else                               { verb = 'thinking';   what = clip(ev.summary, 90); }

  tickerLines.unshift({ who, verb, what, cls: VERB_CLASS[familyOf(ev.tool)] || '' });
  if (tickerLines.length > 5) tickerLines.pop();

  const list = el('ticker-list');
  list.innerHTML = '';
  /* Rendered oldest-first so the newest line lands at the bottom, nearest the
     eye, with the history rising and fading above it. */
  for (let i = tickerLines.length - 1; i >= 0; i--) {
    const L = tickerLines[i];
    const li = document.createElement('li');
    li.className = 'age-' + i;
    li.innerHTML = `<span class="who"></span><span class="dot">·</span>` +
                   `<span class="verb ${L.cls}"></span><span class="dot">·</span><span class="what"></span>`;
    li.querySelector('.who').textContent  = L.who;
    li.querySelector('.verb').textContent = L.verb;
    li.querySelector('.what').textContent = L.what;
    list.appendChild(li);
  }
  el('a11y-status').textContent = `${tickerLines[0].who}, ${tickerLines[0].verb}, ${tickerLines[0].what}`;
}
const lastSeg = p => p ? normPath(p).split('/').filter(Boolean).pop() : '';
const clip = (t, n) => !t ? '' : (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

/* A summary that is a JSON argument blob says nothing a person wants to read —
   the file's own name does. Fall back to it whenever the summary is unusable. */
function readable(ev) {
  const sum = (ev.summary || '').replace(/\s+/g, ' ').trim();
  const looksLikeJson = sum.startsWith('{') || sum.startsWith('[');
  if ((!sum || looksLikeJson) && ev.path) return lastSeg(ev.path);
  return clip(sum, 72);
}

let shownTally = { files: -1, tools: -1, agents: -1 };
function paintChrome() {
  for (const k of ['files', 'tools', 'agents']) {
    if (tally[k] !== shownTally[k]) {
      const b = el(k === 'files' ? 'n-files' : k === 'tools' ? 'n-tools' : 'n-agents');
      b.textContent = tally[k];
      b.classList.add('bump');
      /* The gold flash is removed on the next frame so the CSS transition can
         carry it back to bone — a real change, briefly marked, then gone. */
      requestAnimationFrame(() => b.classList.remove('bump'));
      shownTally[k] = tally[k];
    }
  }
}

let shownSecond = -1;
function paintClock() {
  const s = Math.floor(clock.t / 1000);
  if (s === shownSecond) return;
  shownSecond = s;
  const mm = Math.floor(s / 60) % 60, hh = Math.floor(s / 3600);
  el('clock').textContent = hh
    ? `${hh}:${String(mm).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${mm}:${String(s % 60).padStart(2, '0')}`;
}


/* =============================================================================
   CLOCK — replay transport
   Seeking rebuilds from event zero rather than trying to run the animation
   backwards. Rebuilding a few hundred events is sub-millisecond, and it is the
   only way a seek can be guaranteed to land in the same state a forward play
   would have reached.
   ========================================================================== */
const clock = { t: 0, speed: 1, paused: false, follow: true };
let cursor = 0;          // index of the next event to dispatch
let lastEventAt = 0;
let replay = null;

function resetWorld() {
  nodes.clear(); actors.clear();
  beams.length = 0; ripples.length = 0; sparks.length = 0;
  tickerLines.length = 0;
  maxDepth = 1; agentsEverSeen = 0;
  tally.files = 0; tally.tools = 0; tally.agents = 1;
  shownTally = { files: -1, tools: -1, agents: -1 };
  root = makeNode('', lastSeg(cwd) || 'session', null);
  root.isDir = true; root.heat = 0.5;
  makeActor('main', 'Orchestrator', true);
  tally.agents = agentsEverSeen;
  relayout();
}

function seekTo(ms) {
  const target = Math.max(0, Math.min(ms, replay.session.duration_ms || Infinity));
  resetWorld();
  cursor = 0;
  clock.t = target;
  const evs = replay.events;
  while (cursor < evs.length && evs[cursor].t <= target) ingest(evs[cursor++], true);
  /* Give the rebuilt tree its final positions immediately — a seek should not
     be followed by three seconds of everything sliding into place. */
  relayout();
  for (const n of nodes.values()) { n.x = n.tx; n.y = n.ty; n.age = 3; n.heat *= 0.25; }
  for (const a of actors.values()) { a.x = a.tx; a.y = a.ty; a.scale = 1; }
  /* The quiet pass deliberately skips the ticker, so refill it here from the
     last handful of events — otherwise a seek lands on a blank bottom line. */
  for (const e of evs.slice(Math.max(0, cursor - 5), cursor)) pushTicker(e);
  paintChrome(); shownSecond = -1; paintClock();
}

/* A real session is mostly waiting. The export this was built against runs 8.5
   hours and holds 2,193 events, so at 1x you would watch an empty screen for
   three minutes before the first tool call. Playing forward therefore skips a
   gap longer than DEAD_AIR, landing IDLE_HOLD before the next event so the
   thinking state still plays out. No event is skipped, reordered or invented —
   only the empty time between them, and the clock keeps showing the session's
   own real timestamps, which is why it visibly jumps. */
const DEAD_AIR = 4000, IDLE_HOLD = 2600;

function advance(dtMs) {
  clock.t += dtMs;
  const evs = replay.events;
  while (cursor < evs.length && evs[cursor].t <= clock.t) ingest(evs[cursor++], false);
  if (cursor < evs.length && evs[cursor].t - clock.t > DEAD_AIR) {
    clock.t = evs[cursor].t - IDLE_HOLD;
  }
}


/* =============================================================================
   FRAME — physics and drawing
   ========================================================================== */
const SPRING_K = 9, SPRING_D = 5.4;      // nodes: soft, settles in about a second
const ACTOR_K = 15, ACTOR_D = 7.0;       // orbs: quicker, they lead the eye
let idle = 0;                            // 0..1, how deep into the quiet we are
let prev = performance.now();
let fpsSamples = [];

function frame(now) {
  let dt = (now - prev) / 1000;
  prev = now;
  if (dt > 0.1) dt = 0.1;                // a backgrounded tab must not teleport
  fpsSamples.push(dt);
  if (fpsSamples.length > 90) fpsSamples.shift();

  if (replay && !clock.paused) advance(dt * 1000 * clock.speed);

  /* Idle is measured against the last real event, not against a timer, which is
     what makes silence read as thinking rather than as a stall. */
  const quietFor = (clock.t - lastEventAt) / 1000;
  const wantIdle = quietFor > 2 ? Math.min(1, (quietFor - 2) / 2.5) : 0;
  idle += (wantIdle - idle) * Math.min(1, dt * 2.2);

  step(dt);
  draw();
  paintClock();
  requestAnimationFrame(frame);
}

function step(dt) {
  for (const n of nodes.values()) {
    n.age += dt;
    n.vx += ((n.tx - n.x) * SPRING_K - n.vx * SPRING_D) * dt;
    n.vy += ((n.ty - n.y) * SPRING_K - n.vy * SPRING_D) * dt;
    n.x += n.vx * dt; n.y += n.vy * dt;
    n.heat  *= Math.pow(0.58, dt);       // fades, but slowly enough to accumulate
    n.ember *= Math.pow(0.93, dt);       // slow fade: a write leaves a mark
  }
  for (const a of actors.values()) {
    a.breath += dt * (idle > 0.5 ? 0.55 : 1.5);
    a.busy *= Math.pow(0.35, dt);
    if (a.leaving) {
      a.leaving = Math.min(1, a.leaving + dt * 0.8);
      const m = actors.get('main');
      if (m) { a.tx = m.x; a.ty = m.y; }
      a.scale = 1 - ease(a.leaving);
      if (a.leaving >= 1) { actors.delete(a.id); continue; }
    } else if (a.scale < 1) {
      a.scale = Math.min(1, a.scale + dt * 1.6);
    }
    if (a.anchor && !a.leaving) {
      a.tx = a.anchor.x + Math.cos(a.anchorAng) * a.anchorDist;
      a.ty = a.anchor.y + Math.sin(a.anchorAng) * a.anchorDist;
    }
    a.vx += ((a.tx - a.x) * ACTOR_K - a.vx * ACTOR_D) * dt;
    a.vy += ((a.ty - a.y) * ACTOR_K - a.vy * ACTOR_D) * dt;
    a.x += a.vx * dt; a.y += a.vy * dt;
  }
  for (let i = beams.length - 1; i >= 0; i--) {
    beams[i].t += dt; if (beams[i].t > beams[i].life) beams.splice(i, 1);
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].t += dt; if (ripples[i].t > ripples[i].life) ripples.splice(i, 1);
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.94; s.vy *= 0.94;
    if (s.t > s.life) sparks.splice(i, 1);
  }
}
const ease = t => 1 - Math.pow(1 - t, 3);

function draw() {
  ctx.clearRect(0, 0, W, H);          // the vignette lives in CSS, so this is free
  const dim = 1 - idle * 0.55;        // the whole field recedes while it thinks

  /* --- edges ------------------------------------------------------------- */
  ctx.lineWidth = 1;
  for (const n of nodes.values()) {
    if (!n.parent) continue;
    const a = (0.20 + n.heat * 0.50 + n.ember * 0.30) * dim * Math.min(1, n.age * 1.4);
    if (a <= 0.006) continue;
    ctx.strokeStyle = n.ember > 0.05 ? C.ember : C.dim;
    ctx.globalAlpha = a;
    ctx.beginPath(); ctx.moveTo(n.parent.x, n.parent.y); ctx.lineTo(n.x, n.y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* --- ripples running up the branches ----------------------------------- */
  ctx.globalCompositeOperation = 'lighter';
  for (const r of ripples) {
    if (r.t < 0) continue;
    const k = r.t / r.life, fade = 1 - k;
    if (r.edge) {
      const [from, to] = r.edge;
      const x = from.x + (to.x - from.x) * ease(k);
      const y = from.y + (to.y - from.y) * ease(k);
      glow(SPRITE.bone, x, y, 9 * fade + 3, 0.30 * fade * dim);
    } else {
      const R = 6 + ease(k) * 42;
      ctx.strokeStyle = r.node.ember > 0.1 ? C.ember : C.cool;
      ctx.globalAlpha = 0.22 * fade * dim;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(r.node.x, r.node.y, R, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  /* --- nodes -------------------------------------------------------------- */
  ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes.values()) {
    const grow = Math.min(1, ease(Math.min(1, n.age * 1.1)));   // never pops in
    const base = n === root ? 7.0 : n.isDir ? 4.0 : 2.6;
    const r = (base + n.heat * 5.5) * grow;
    const warm = n.ember > 0.04;
    const spr = n === root ? SPRITE.gold : warm ? SPRITE.ember
              : n.heat > 0.05 ? spriteFor(n.fam) : SPRITE.dim;
    const a = (0.30 + n.heat * 0.62 + n.ember * 0.35) * dim * grow;
    glow(spr, n.x, n.y, r * 5.2, a * 0.55);
    ctx.globalAlpha = Math.min(1, a * 1.9);
    ctx.fillStyle = n === root ? C.gold : warm ? C.ember : n.heat > 0.05 ? FAMILY_COLOR[n.fam] : C.dim;
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  /* --- beams -------------------------------------------------------------- */
  ctx.globalCompositeOperation = 'lighter';
  for (const b of beams) {
    const k = b.t / b.life;
    const head = ease(Math.min(1, k * 1.8));        // the bolt runs out…
    const fade = 1 - ease(Math.max(0, (k - 0.35) / 0.65));  // …then dies behind it
    if (fade <= 0.01) continue;
    const col = FAMILY_COLOR[b.fam];
    const nx = b.node.x, ny = b.node.y;
    ctx.strokeStyle = col;
    for (let s = 0; s < b.strands; s++) {
      /* A search sweeps: each strand lands a little off the node and the whole
         fan rotates through the beam's life, which reads as looking around. */
      const off = b.strands === 1 ? 0 : (s / (b.strands - 1) - 0.5);
      const swing = off * (34 + 26 * Math.sin(k * 3.1));
      const ex = b.ax + (nx - b.ax) * head;
      const ey = b.ay + (ny - b.ay) * head;
      ctx.globalAlpha = (b.fam === 'write' ? 0.75 : 0.5) * fade / Math.sqrt(b.strands);
      ctx.lineWidth = b.fam === 'write' ? 3.1 : 1.1;
      ctx.beginPath();
      ctx.moveTo(b.ax, b.ay + swing * 0.25);
      ctx.lineTo(ex + swing * head, ey + swing * head * 0.6);
      ctx.stroke();
    }
    /* The impact: a bright head where the beam meets the file. */
    glow(spriteFor(b.fam), b.ax + (nx - b.ax) * head, b.ay + (ny - b.ay) * head,
         (b.fam === 'write' ? 34 : 20) * fade, 0.5 * fade);
  }
  ctx.globalAlpha = 1;

  /* --- sparks -------------------------------------------------------------- */
  for (const s of sparks) {
    const f = 1 - s.t / s.life;
    glow(SPRITE.gold, s.x, s.y, 7 * f + 2, 0.5 * f);
  }
  ctx.globalCompositeOperation = 'source-over';

  /* --- file labels, under the orbs that are painted after them ------------------------------ */
  ctx.textAlign = 'left';
  for (const n of nodes.values()) {
    /* Label budget: the root always, and anything currently warm. Labelling
       every node would turn the tree into a wall of text within a minute. */
    let a = n === root ? 0.9
          : Math.max(n.isDir ? 0.38 : 0, Math.min(1, n.heat * 1.7 + n.ember * 0.8) * 0.95);
    if (a < 0.10) continue;
    a = Math.max(a, 0.42);        // legible or absent — never a smudge
    ctx.font = n === root ? F_ROOT : F_LABEL;
    label(n.name, n.x + (n === root ? 14 : 9), n.y + (n === root ? 5 : 3.5),
          a * dim, n.ember > 0.08 ? C.ember : C.bone);
  }
  /* --- actors -------------------------------------------------------------- */
  const mainOrb = actors.get('main');
  for (const a of actors.values()) {
    if (a.scale <= 0.01) continue;
    if (!a.isMain && mainOrb) {
      ctx.strokeStyle = C.gold; ctx.globalAlpha = 0.13 * a.scale * dim; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mainOrb.x, mainOrb.y); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    /* Breathing is the idle tell: slow and deep when nothing is happening,
       shallow and quick while the orb is working. */
    const breathe = 1 + Math.sin(a.breath) * (0.05 + idle * 0.16);
    const R = (a.isMain ? 13 : 8) * a.scale * breathe;
    ctx.globalCompositeOperation = 'lighter';
    glow(SPRITE.gold, a.x, a.y, R * (a.isMain ? 7.5 : 6.5), (0.22 + a.busy * 0.32) * (1 - idle * 0.35));
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, 6.2832);
    ctx.fillStyle = C.ink;
    ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;

    ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, 6.2832);
    ctx.strokeStyle = C.gold;
    ctx.globalAlpha = a.isMain ? 0.95 : 0.82;
    ctx.lineWidth = a.isMain ? 2.4 : 1.7;
    ctx.stroke();

    /* Only the orchestrator gets an outer ring — that ring IS the hierarchy,
       and it is why a stranger can tell who is in charge without a legend. */
    if (a.isMain) {
      ctx.beginPath(); ctx.arc(a.x, a.y, R + 7 + Math.sin(a.breath) * 2.2, 0, 6.2832);
      ctx.globalAlpha = 0.20 + 0.16 * (1 - idle);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.font = a.isMain ? F_AGENT : F_SUB;
    ctx.textAlign = 'center';
    label(a.short, a.x, a.y + R + 17, (a.isMain ? 0.9 : 0.75) * a.scale, C.bone);
  }

  ctx.globalAlpha = 1;
}


/* =============================================================================
   TRANSPORT KEYS — space, arrows, brackets, L
   ========================================================================== */
const SPEEDS = [0.5, 1, 2, 4];
function flashBadge(text) {
  const b = el('speed-badge');
  b.textContent = text;
  b.hidden = false;
  b.style.animation = 'none'; void b.offsetWidth;      // restart the CSS animation
  b.style.animation = '';
  clearTimeout(flashBadge.timer);
  flashBadge.timer = setTimeout(() => { b.hidden = true; }, 1500);
}

window.addEventListener('keydown', e => {
  if (!replay) return;
  const k = e.key;
  if (k === ' ')                { e.preventDefault(); clock.paused = !clock.paused;
                                  flashBadge(clock.paused ? 'paused' : '▸'); }
  else if (k === 'ArrowLeft')   { seekTo(clock.t - 10000); flashBadge('−10s'); }
  else if (k === 'ArrowRight')  { seekTo(clock.t + 10000); flashBadge('+10s'); }
  else if (k === '[' || k === ']') {
    const i = SPEEDS.indexOf(clock.speed);
    const j = Math.max(0, Math.min(SPEEDS.length - 1, i + (k === ']' ? 1 : -1)));
    clock.speed = SPEEDS[j];
    flashBadge(clock.speed + '×');
  }
  else if (k === 'l' || k === 'L') {
    clock.follow = !clock.follow;
    flashBadge(clock.follow ? 'following' : 'free');
    if (clock.follow && replay.events.length) {
      /* Follow means: stop lagging behind the newest thing that happened. */
      const last = replay.events[replay.events.length - 1].t;
      if (clock.t < last - 500) seekTo(last);
      clock.paused = false;
    }
  }
});


/* =============================================================================
   BOOT — load the session, or say plainly that there is nothing to show
   Order is fixed by the brief: ?src= wins, then the exported demo, then the
   hand-written dev fixture.
   ========================================================================== */
async function pick() {
  const q = new URLSearchParams(location.search).get('src');
  /* Archived copy: it lives two folders below the root, so the data it reads is
     two folders up. Everything else in this file is the v1 renderer, untouched. */
  const candidates = q ? [q] : ['../../data/demo.json', '../../data/sample.json'];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.session && Array.isArray(j.events)) return j;
    } catch (_) { /* try the next candidate; the fault screen reports the end */ }
  }
  return null;
}

function showFault(msg) {
  el('fault-text').textContent = msg;
  el('fault').hidden = false;
}

async function boot() {
  resize();
  replay = await pick();
  if (!replay) {
    showFault('No session to replay yet. Export one to data/demo.json, ' +
              'or pass ?src= a replay file.');
    return;
  }
  cwd = chooseRoot(replay);
  el('session-title').textContent = clip(replay.session.title, 78) || 'Untitled session';
  el('session-cwd').textContent = lastSeg(cwd);
  document.title = (replay.session.title || 'Claude Live') + ' — Claude Live';

  replay.events.sort((a, b) => a.t - b.t);
  resetWorld();
  cursor = 0; clock.t = 0; lastEventAt = 0;
  paintChrome(); paintClock();

  /* The hints are a one-time courtesy, not a permanent legend. */
  try {
    if (!localStorage.getItem('claude-live.hints-seen')) {
      el('hints').hidden = false;
      localStorage.setItem('claude-live.hints-seen', '1');
    }
  } catch (_) { el('hints').hidden = false; }   // private mode: show them anyway

  /* Live mode: the same ingest() the replay uses, fed by the server's stream.
     The client contract is one JSON event per SSE message, shaped exactly like
     an entry in the replay file's `events` array. */
  if (new URLSearchParams(location.search).get('live') === '1') {
    try {
      const es = new EventSource('/api/stream');
      es.onmessage = m => {
        try {
          const ev = JSON.parse(m.data);
          if (clock.follow && ev.t > clock.t) clock.t = ev.t;
          ingest(ev, false);
        } catch (_) { /* a malformed frame must not kill the stream */ }
      };
      es.onerror = () => { /* EventSource reconnects on its own; stay quiet */ };
      clock.paused = true;    // in live mode the stream drives the clock, not us
    } catch (_) {
      showFault('Live mode asked for /api/stream, but the stream is not there.');
    }
  }

  requestAnimationFrame(now => { prev = now; frame(now); });
}

boot();

/* Exposed for the fps measurement in docs/RUNBOOK.md — reading it costs nothing
   and it is the only honest way to report a frame rate from this machine. */
window.__fps = () => {
  if (!fpsSamples.length) return 0;
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  return Math.round(1 / avg);
};

})();

/* =============================================================================
   werkstadt — replay.js
   The engine: it loads a session, drives the clock, and feeds the city.

   This half of the app knows nothing about geometry and the city half knows
   nothing about time. The seam between them is ingest(): replay and the live
   EventSource both go through it, so there is exactly one code path that can
   change what is on screen — which is why live mode needed no second renderer.

   Extracted from the v1 file (now archive/tree/app.js). Everything about how a
   session is read, seeked, paced and captioned is unchanged from the version
   that was already working; only the renderer behind it was replaced.
   ========================================================================== */

import * as City from './city.js';
/* The interior needs two things only this half of the app knows: which town the
   page is showing, so it can ask the server for a file's bytes, and the event
   list, so a street sign can open a hall of that session's own prompts. */
import * as Interior from './interior.js';

/* =============================================================================
   TOOL FAMILIES — the grammar of an effect is decided here and nowhere else
   Adding a tool is one line, rather than a hunt through the renderer.
   ========================================================================== */
const FAMILY = {
  Read: 'read', NotebookRead: 'read', WebFetch: 'read',
  Edit: 'write', Write: 'write', NotebookEdit: 'write', MultiEdit: 'write',
  Grep: 'search', Glob: 'search', Search: 'search', WebSearch: 'search',
  Bash: 'shell', PowerShell: 'shell',
};
const familyOf = t => FAMILY[t] || 'other';


/* =============================================================================
   PATHS — where the city is rooted, and what a file is called inside it
   ========================================================================== */
const normPath = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
const lastSeg = p => p ? normPath(p).split('/').filter(Boolean).pop() : '';
const clip = (t, n) => !t ? '' : (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);
let cwd = '';

/* The root the city stands on. Usually the session cwd — but a real session
   often works almost entirely outside it (the 8.5-hour export this was built
   against has 221 distinct paths and not one of them under its own cwd), and
   rooting that at the cwd puts the whole city behind a single meaningless gate.
   So: use the cwd when it actually covers the work, otherwise use the longest
   directory prefix the paths genuinely share.

   A project payload can now carry its own top-level `root` — the server's own
   answer for the town's real root, not a guess from the events it happened to
   see. When it is there, use it outright and skip the 40% heuristic below: the
   heuristic exists only because nothing better than the events was available,
   and a real town (36.3% under its cwd) is exactly the kind it gets wrong. An
   older server with no `root` field falls straight through to the heuristic,
   unchanged. */
function chooseRoot(rep) {
  if (rep.root) return normPath(rep.root);
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

/* Absolute path -> the path the city knows it by. Anything outside the root
   keeps only its last three segments, so a stray system file becomes a small
   outlying district instead of a mile of empty ground. */
function relativise(abs) {
  if (!abs) return null;
  const p = normPath(abs);
  if (cwd && p.toLowerCase().startsWith(cwd.toLowerCase())) {
    const tail = p.slice(cwd.length).replace(/^\//, '');
    return tail || '';
  }
  const seg = p.split('/').filter(Boolean);
  return seg.length > 3 ? seg.slice(-3).join('/') : seg.join('/');
}


/* =============================================================================
   TITLE — which project the session is actually about
   chooseRoot() can only find the shared root across all four projects a real
   session touches — that root's own name is a poor headline (see its comment)
   and changing chooseRoot()/relativise() would move the whole city, so this is
   a second, title-only pass over the same paths. It builds a trie of every
   touched file's path under the root and walks down through whichever child
   holds at least half of its parent's events — a pass-through folder like
   `Desktop` or `projects` always has ~100% in one child, so the walk falls
   through it for free, and it stops the moment the work genuinely forks
   between two projects. The last node before that fork is the answer.
   Recomputed at most once every 5 s (LIVE_TITLE_MS) so a live burst cannot
   thrash the masthead every frame. */
const LIVE_TITLE_MS = 5000;
const titleTrie = { count: 0, children: new Map() };
let lastTitleAt = -Infinity;

function rootTailSegs(abs) {
  if (!abs || !cwd) return null;
  const p = normPath(abs);
  if (!p.toLowerCase().startsWith(cwd.toLowerCase())) return null;
  const tail = p.slice(cwd.length).replace(/^\//, '');
  return tail ? tail.split('/').filter(Boolean) : [];
}

function addToTitleTrie(segs) {
  let node = titleTrie;
  node.count++;
  for (const seg of segs) {
    let child = node.children.get(seg);
    if (!child) { child = { count: 0, children: new Map() }; node.children.set(seg, child); }
    node = child;
    node.count++;
  }
}

function dominantProject() {
  let node = titleTrie, name = null;
  while (true) {
    let bestSeg = null, bestNode = null, bestN = -1;
    for (const [seg, child] of node.children) if (child.count > bestN) { bestSeg = seg; bestNode = child; bestN = child.count; }
    if (!bestNode || bestN / node.count < 0.5) break;
    name = bestSeg; node = bestNode;
  }
  return name;
}

function updateTitle() {
  el('session-title').textContent =
    clip(projectName || dominantProject() || lastSeg(cwd), 34) || 'Untitled session';
  /* In project mode the mono line under the serif title stops being the session
     prompt — there is no single session any more — and becomes the shape of the
     town: how many conversations it is built out of, and which one is talking
     right now. */
  if (projectMode) {
    const live = City.liveStreetTitle();
    const n = City.streetCount();
    el('session-prompt').textContent =
      `${n} street${n === 1 ? '' : 's'}` + (live ? ` · current: ${clip(live, 46)}` : '');
  }
}


/* =============================================================================
   STREETS — one avenue per session, in the order the project opened them
   The city is the PROJECT; a conversation is a street inside it. A seek wipes
   the world and replays from event zero, so the avenues have to be re-opened in
   exactly the order they were first declared or the layout would differ between
   a forward play and a seek — which is the one thing the packer's append-only
   rule exists to prevent.
   ========================================================================== */
let projectMode = false;
let projectId = null;        // the town, when this page is showing a whole project
let projectName = null;      // its display name — the serif title
const declaredStreets = [];  // { id, title, live }, in the order they opened
const streetSeen = new Set();
let shownStreet = null;      // the avenue the camera has already introduced

/* Single-session mode is the same machinery with one avenue: the whole page has
   exactly one code path, and "single session = one street" is literally true. */
const SOLO_STREET = 'solo';
const craftIdFor = id =>
  id === SOLO_STREET ? 'main' : String(id).slice(0, 8) + ':main';

function declareStreet(id, title, live, events) {
  if (streetSeen.has(id)) {
    if (live !== undefined) City.setStreetLive(id, live);
    return;
  }
  streetSeen.add(id);
  /* `events` is the street's own event count from /api/project. The city sizes
     the avenue's reserved depth from it, so a 4,000-event conversation gets a
     district-deep band and a 74-event scheduled job gets a lane. */
  declaredStreets.push({ id, title, live: !!live, events });
  City.openStreet(id, title || id, !!live, craftIdFor(id), events);
  if (projectMode) updateTitle();
}

/* Re-open every avenue the project has already declared. Called by resetWorld()
   after City.reset() has wiped them, so a seek rebuilds the same town. */
function reopenStreets() {
  for (const s of declaredStreets) City.openStreet(s.id, s.title, s.live, craftIdFor(s.id), s.events);
}


/* =============================================================================
   INGEST — the single public entry point
   `quiet` replays history after a seek: state is rebuilt, but nothing fires.
   ========================================================================== */
const tally = { files: 0, tools: 0, agents: 1 };
const tickerLines = [];
let agentsEverSeen = 1;

export function ingest(ev, quiet) {
  if (!ev || typeof ev !== 'object') return;

  /* The city ages its buildings on the SESSION's clock (permanence), so it is
     told the timestamp of the event it is about to be handed rather than the
     timestamp of the frame — which is what makes a seek land every building on
     the age a forward play would have given it. */
  if (typeof ev.t === 'number') City.setSessionClock(ev.t);

  /* A new conversation started on this project: the server says so directly on
     the live stream, and the events of a replay say it by carrying a `session`
     nobody has opened an avenue for yet. Both land here. */
  if (ev.kind === 'street') { declareStreet(ev.id, ev.title, ev.live, ev.events); return; }
  const sid = ev.session || SOLO_STREET;
  if (!streetSeen.has(sid)) declareStreet(sid, ev.session_title || sid, true, ev.events);
  /* The street-by-street intro: a project replay can span weeks, so the camera
     eases to an avenue the first time the replay reaches it and the sign lights,
     then the wide shot returns on its own. Skipped on a seek's silent rebuild —
     that would fire an intro for every session in the file at once. */
  if (!quiet && sid !== shownStreet) {
    if (shownStreet !== null) City.focusStreet(sid, 3);
    shownStreet = sid;
    if (projectMode) updateTitle();
  }

  if (ev.kind === 'agent_start') {
    agentsEverSeen++;
    /* 42 characters, because the craft's tag IS the agent's task — see the
       label sizing in city.js's makeDrone(). */
    City.agentStart(ev.agent, clip(labelFor(ev.agent), 42) || 'agent', quiet, tierFor(ev.agent));
    tally.agents = agentsEverSeen;

  } else if (ev.kind === 'agent_end') {
    City.agentEnd(ev.agent, quiet);

  } else if (ev.kind === 'tool') {
    tally.tools++;
    const fam = familyOf(ev.tool);
    const rel = relativise(ev.path);
    const titleSegs = rootTailSegs(ev.path);
    if (titleSegs) {
      addToTitleTrie(titleSegs);
      if (!quiet && performance.now() - lastTitleAt > LIVE_TITLE_MS) { lastTitleAt = performance.now(); updateTitle(); }
    }
    /* Every call gets its own worker drone, keyed on the tool_use id, so an
       agent running eighteen calls at once really does fly eighteen of them. */
    const before = City.buildingCount();
    City.toolStart(ev.id, ev.tool || 'tool', fam, rel, ev.agent, quiet,
                   fam === 'shell' ? firstWord(shellText(oneLine(ev.summary))) : null,
                   sid);
    if (City.buildingCount() !== before) tally.files = City.buildingCount();
    if (fam === 'shell') derezFromShell(ev, quiet);

  } else if (ev.kind === 'tool_end') {
    /* The other half of the pair: this is what sends the worker home, and it is
       the only reason concurrency in this city is real rather than assumed. */
    City.toolEnd(ev.id, ev.ok === undefined ? null : ev.ok);

  } else if (ev.kind === 'file_deleted') {
    const rel = relativise(ev.path);
    if (rel) City.derezFile(rel, quiet);
  }
  /* prompt and text carry no place in the world; they are the ticker's job. */

  lastEventAt = clock.t;
  if (!quiet) { pushTicker(ev); paintChrome(); }
}

/* A shell command that deletes a file the city already stands on. There is no
   `file_deleted` event in the export yet, so this reads the command itself:
   `rm`, `del` or `Remove-Item`, then any argument that resolves to a building.
   Deliberately narrow — a token has to name a path the city ALREADY knows, so a
   `rm -rf node_modules` in a folder nobody opened derezzes nothing, and no
   building is ever removed on a guess. */
const DELETE_CMD = /(^|[;&|]\s*)(rm|del|erase|unlink|Remove-Item)\b/i;
function derezFromShell(ev, quiet) {
  const sum = ev.summary || '';
  if (!DELETE_CMD.test(sum)) return;
  for (const raw of sum.split(/[\s;&|]+/)) {
    const tok = raw.replace(/^["']|["']$/g, '');
    if (tok.length < 3 || tok.startsWith('-')) continue;
    const rel = relativise(tok);
    if (rel && City.hasFile(rel)) City.derezFile(rel, quiet);
  }
}
window.ingest = ingest;   // documented contract: the live server feeds this

function labelFor(id) {
  const a = (replay && replay.agents || []).find(x => x.id === id);
  return a ? a.label : id;
}

/* The agent's MODEL TIER, when the export carries one: it paints the cargo band
   on that agent's craft gold, silver or bronze. No payload written so far has
   the field, which is exactly why drones.js documents silver as the default
   rather than treating a missing tier as an error. */
const MODEL_TIERS = ['opus', 'sonnet', 'haiku'];
function tierFor(id) {
  const a = (replay && replay.agents || []).find(x => x.id === id);
  const m = a && String(a.tier || a.model || '').toLowerCase();
  return m ? MODEL_TIERS.find(t => m.includes(t)) : undefined;
}


/* =============================================================================
   CHROME — title, clock, tallies, ticker
   DOM is touched only when an event arrives or the clock's visible second
   changes. Writing text nodes every frame would be the most expensive thing on
   the page by a wide margin.
   ========================================================================== */
const el = id => document.getElementById(id);
const VERB_CLASS = { read: 'read', search: 'read', write: 'write', shell: '', other: '' };

/* Same detection city.js makes for its own quality settings — one flag, read
   once, so the two halves of the page cannot disagree about whether this is a
   phone. `mobile-mode` on <body> is what styles.css hangs the bottom-sheet
   hints, the scaled masthead and the one-line ticker off. */
const MOBILE = City.isMobile();
if (MOBILE) document.body.classList.add('mobile-mode');

/* A swipe on the ticker does what the arrow keys do — ten seconds either way —
   since a phone has no keyboard to reach for `←`/`→` on. Only wired on
   mobile: the ticker is pointer-events:none on desktop on purpose (styles.css
   — "so the skyline stays clickable underneath"), and this would fight that. */
function attachTickerSwipe() {
  if (!MOBILE) return;
  const t = el('ticker');
  if (!t) return;
  t.style.pointerEvents = 'auto';
  let sx = null;
  t.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') sx = e.clientX; });
  t.addEventListener('pointerup', e => {
    if (sx === null || e.pointerType !== 'touch' || !replay) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) < 40) return;               // a tap, not a swipe
    if (dx < 0) { seekTo(clock.t + 10000); flashBadge('+10s'); }
    else        { seekTo(clock.t - 10000); flashBadge('−10s'); }
  });
}

/* The mono play/pause glyph: `space` has no equivalent on a touchscreen, so a
   coarse pointer gets a button that does the same thing space does. Hidden on
   a real keyboard-and-mouse machine — the transport table already documents
   space for that case, and a glyph nobody needs is clutter. */
function attachMobilePlaypause() {
  if (!MOBILE) return;
  const btn = el('mobile-playpause');
  if (!btn) return;
  btn.hidden = false;
  const paint = () => { btn.textContent = clock.paused ? '▸' : '❚❚'; };
  paint();
  btn.addEventListener('click', () => {
    clock.paused = !clock.paused;
    paint();
    flashBadge(clock.paused ? 'paused' : '▸');
  });
}

function pushTicker(ev) {
  if (isNoise(ev)) return;
  const who = clip(ev.agent === 'main' ? 'Orchestrator' : labelFor(ev.agent), 28);
  let verb, what;
  if (ev.kind === 'tool')            { verb = ev.tool; what = readable(ev); }
  else if (ev.kind === 'agent_start'){ verb = 'dispatched'; what = clip(oneLine(ev.summary), 72) || who; }
  else if (ev.kind === 'agent_end')  { verb = 'returned';   what = clip(oneLine(ev.summary), 72) || who; }
  else if (ev.kind === 'prompt')     { verb = 'prompt';     what = clip(oneLine(ev.summary), 90); }
  else                               { verb = 'thinking';   what = clip(oneLine(ev.summary), 90); }

  const cls = VERB_CLASS[familyOf(ev.tool)] || '';
  /* Newest pushed at the end, so the DOM's last child is always the newest —
     matching the flex column's justify-content: flex-end below it. */
  tickerLines.push({ who, verb, what, cls });
  if (tickerLines.length > 5) tickerLines.shift();

  /* Rebuilding with innerHTML = '' restarted every line's fade-in on every
     event, so a fast burst never finished fading any of them in (HANDOFF open
     item 7). Only the new line is a new node; the rest just get their age
     class relabelled, which recolours them instantly with no animation. */
  const list = el('ticker-list');
  const li = document.createElement('li');
  li.innerHTML = `<span class="who"></span><span class="dot">·</span>` +
                 `<span class="verb ${cls}"></span><span class="dot">·</span><span class="what"></span>`;
  li.querySelector('.who').textContent  = who;
  li.querySelector('.verb').textContent = verb;
  li.querySelector('.what').textContent = what;
  list.appendChild(li);
  while (list.children.length > 5) list.removeChild(list.firstChild);
  const n = list.children.length;
  for (let i = 0; i < n; i++) list.children[i].className = 'age-' + (n - 1 - i);

  el('a11y-status').textContent = `${who}, ${verb}, ${what}`;
}

/* The ticker is one line per event, always. A summary can carry newlines, and a
   two-line ticker entry pushes the whole stack off the bottom of the frame. */
const oneLine = s => (s || '').replace(/\s+/g, ' ').trim();

/* Some exported prompt/text summaries are not prose at all — they are the raw
   envelope a subagent was handed (`<ta…>`, `<task-id>…`). That is plumbing, and
   on screen it reads as a bug. Dropped at RENDER time only: the replay file, the
   event stream and the city are all untouched, so a dropped line still built its
   buildings and still counts in the tallies. */
const isNoise = ev => ev.kind === 'tool_end' ||
  ((ev.kind === 'prompt' || ev.kind === 'text') &&
   (/^\s*</.test(ev.summary || '') || (ev.summary || '').includes('task-id')));

/* A shell drone's tag says the verb it ran, not the whole command line: from
   across a city `npm` is the readable half of `npm run build --silent`. */
const firstWord = t => (t || '').trim().split(/[\s(]+/)[0].slice(0, 18);

/* Nearly every shell line in a real session opens with the same
   `cd "<long absolute path>" &&`, which pushes the actual command past the end
   of the line — the ticker ends up printing the same directory over and over and
   never the thing that ran. Strip the prefix and show the command itself. */
function shellText(sum) {
  const m = sum.match(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;|&)\s*/i);
  if (m) {
    const rest = sum.slice(m[0].length).replace(/^[({]\s*/, '').trim();
    if (rest.length >= 3) return clip(rest, 50);
    /* The command survived as one or two letters, which says nothing. */
    return 'cd ' + lastSeg(m[1].replace(/["']/g, ''));
  }
  /* A `cd` with nothing after it at all: the export truncates every summary at
     sixty characters and a deep Windows path spends all sixty on its own. The
     directory is then the only real thing the line still has to say. */
  const bare = sum.match(/^cd\s+["']?([^"']*)/i);
  if (bare) return 'cd ' + lastSeg(bare[1]);
  return clip(sum.replace(/^[({]\s*/, ''), 50);
}

/* A summary that is a JSON argument blob says nothing a person wants to read —
   the file's own name does. Fall back to it whenever the summary is unusable. */
function readable(ev) {
  const sum = oneLine(ev.summary);
  if (ev.tool === 'Bash' || ev.tool === 'PowerShell') return shellText(sum) || lastSeg(ev.path);
  /* A tool that named a file: the basename is the whole story, and the absolute
     path is a wall of `C:/Users/…` that is identical on every line. */
  if (ev.path) return lastSeg(ev.path);
  const looksLikeJson = sum.startsWith('{') || sum.startsWith('[');
  if (!sum || looksLikeJson) return '';
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
   Seeking rebuilds from event zero rather than running the animation backwards.
   Rebuilding a few hundred events is sub-millisecond, and it is the only way a
   seek is guaranteed to land in the state a forward play would have reached.
   ========================================================================== */
const clock = { t: 0, speed: 1, paused: false, follow: true };
let cursor = 0;          // index of the next event to dispatch
let lastEventAt = 0;
let replay = null;

function resetWorld() {
  City.reset();
  streetSeen.clear();
  for (const s of declaredStreets) streetSeen.add(s.id);
  reopenStreets();
  shownStreet = null;
  tickerLines.length = 0;
  agentsEverSeen = 1;
  tally.files = 0; tally.tools = 0; tally.agents = 1;
  shownTally = { files: -1, tools: -1, agents: -1 };
  titleTrie.count = 0; titleTrie.children.clear();
  lastTitleAt = -Infinity;
}

function seekTo(ms) {
  const target = Math.max(0, Math.min(ms, replay.session.duration_ms || Infinity));
  resetWorld();
  cursor = 0;
  clock.t = target;
  const evs = replay.events;
  while (cursor < evs.length && evs[cursor].t <= target) ingest(evs[cursor++], true);
  /* A seek should not be followed by three seconds of the whole city sliding
     into place, so the world is told to finish everything it was mid-way
     through. */
  City.settle();
  /* The quiet pass deliberately skips the ticker, so refill it here from the
     last handful of events — otherwise a seek lands on a blank bottom line. */
  for (const e of evs.slice(Math.max(0, cursor - 5), cursor)) pushTicker(e);
  tally.files = City.buildingCount();
  updateTitle();   // the quiet pass fed the trie but never throttle-fires; force it once
  paintChrome(); shownSecond = -1; paintClock();
}

/* A real session is mostly waiting. The export this was built against runs 8 h
   34 m and holds 2,193 events; its first tool call is three minutes in and its
   median gap between events is 2.4 s. Playing that at true speed means watching
   empty ground for the first minute and 66 minutes for the whole session, which
   fails the one thing this page is for.
   So the empty time between events is compressed — and only the empty time. No
   event is skipped, reordered, merged or invented, and the clock keeps showing
   the session's own real timestamps, which is why it visibly jumps. A gap longer
   than DEAD_AIR is replaced by a hold that grows with the size of the gap, so a
   two-second pause still feels shorter than a two-minute one. Measured against
   the real export: the city has its first buildings by 12 s and about forty by
   90 s, and the whole session runs in roughly nine minutes.
   v1 used a flat 4 s / 2.6 s here; those constants are the reason it took three
   minutes to show anything. */
const DEAD_AIR = 500, HOLD_MIN = 280, HOLD_MAX = 1400;
const holdFor = gap => Math.min(HOLD_MAX, Math.max(HOLD_MIN, gap * 0.02));

/* How many events the OPENING may run through while the ground is still bare —
   a budget for the whole page, not per frame. Two things need the bound. A
   session that never touches a file has no first building to run to, and
   without a budget it would race its whole transcript past in three frames; and
   a single frame that ingested ten thousand events would lock the tab up. 400
   is comfortably past e6a8abd1's 28 opening prompts and far short of any real
   conversation. */
let openingBudget = 400;

function advance(dtMs) {
  clock.t += dtMs;
  const evs = replay.events;
  while (cursor < evs.length && evs[cursor].t <= clock.t) ingest(evs[cursor++], false);
  /* The gap is measured to the next event that is WORTH WAITING FOR, and a
     `tool_end` is not one: it is the bookkeeping half of a call that already
     happened. Counting them here halved the number of skippable gaps the moment
     the exporter started emitting them — measured on data/demo.json, four
     minutes of watching reached 23:50 of session instead of 31:51, and the city
     was a third smaller in every reference shot. They still fire at their own
     real timestamps; they just no longer decide when the clock may skip. */
  let n = cursor;
  while (n < evs.length && evs[n].kind === 'tool_end') n++;
  if (n < evs.length) {
    const gap = evs[n].t - clock.t;
    if (gap > DEAD_AIR) clock.t = evs[n].t - holdFor(gap);
  }

  /* THE OPENING VOID. A hold exists so a pause between two events reads as
     thinking rather than as a stall — but there is nothing to think in front of
     while the ground is still bare, and holding there is just a black screen.
     e6a8abd1 opens on 28 prompt/text events with hours between them: every one
     of those gaps drew HOLD_MAX, and the first building stood 7.9 s in with
     nothing on screen before it (docs/TESTS.md D4).
     So while NO building has printed yet, the transport runs on without a hold
     and without waiting for the next frame, until one stands. No event is
     skipped, reordered or invented — this only removes the waiting from a
     stretch that has nothing to show — and it stops the instant the city is no
     longer empty, so everything after the first building paces exactly as
     before. */
  while (openingBudget > 0 && cursor < evs.length && City.buildingCount() === 0) {
    openingBudget--;
    clock.t = evs[cursor].t;
    ingest(evs[cursor++], false);
  }
}


/* =============================================================================
   FRAME — the only requestAnimationFrame on the page
   ========================================================================== */
let idle = 0;                            // 0..1, how deep into the quiet we are
let prev = performance.now();
const fpsSamples = [];

function frame(now) {
  let dt = (now - prev) / 1000;
  prev = now;
  if (dt > 0.1) dt = 0.1;                // a backgrounded tab must not teleport

  /* RECORD MODE — the recorder paces the film, one drawn frame per capture.
     Wall time is the wrong clock for an offline render: headless Chrome on
     this machine has no GPU (docs/RUNBOOK.md) and draws a few frames a second,
     so a real-time capture would advance the replay 6× further between two
     captured frames than the finished film shows. Here every frame is worth
     exactly REC.dt of film, whatever it cost to draw, which makes the output
     length arithmetic instead of a measurement — and deterministic, since
     nothing in the loop reads the wall clock. */
  if (REC.on) {
    if (!REC.pending) { requestAnimationFrame(frame); return; }
    REC.pending = false;
    dt = REC.dt;
    recordStep();
  }

  fpsSamples.push(dt);
  if (fpsSamples.length > 90) fpsSamples.shift();

  if (replay && !clock.paused) advance(dt * 1000 * clock.speed);

  /* Idle is measured against the last real event, not against a timer, which is
     what makes silence read as thinking rather than as a stall. */
  const quietFor = (clock.t - lastEventAt) / 1000;
  const wantIdle = quietFor > 2 ? Math.min(1, (quietFor - 2) / 2.5) : 0;
  idle += (wantIdle - idle) * Math.min(1, dt * 3.2);

  /* The session clock is the sun: an 8-hour export walks from dusk to dawn. */
  if (replay && replay.session.duration_ms) {
    City.setPhase(clock.t / replay.session.duration_ms);
  }
  City.render(dt, idle);
  paintClock();
  /* The tick is answered only after the frame it asked for has actually been
     drawn, so the screenshot the recorder takes next can never be the previous
     frame. */
  if (REC.on && REC.resolve) { const r = REC.resolve; REC.resolve = null; r(recordState()); }
  requestAnimationFrame(frame);
}


/* =============================================================================
   RECORD MODE — ?record=1, the page as a film set
   Written for tools/recorder.py and used by nothing else: the chrome is hidden,
   a title card opens and closes the film, and the replay advances one fixed
   step per __recordTick() instead of per wall-clock second. See docs/RUNBOOK.md
   -> "Recordings".
   ========================================================================== */
const REC = {
  on: false,
  fps: 30,
  dt: 1 / 30,
  titleFrames: 4 * 30,       // 4 s of title card before the city starts building
  endFrames: 3 * 30,         // 3 s of end card, so a shared clip does not cut dead
  targetPlaySecs: 80,        // + the two cards = an ~87 s film
  maxSpeed: 240,             // past this the city builds faster than a print draws
  phase: 'title',            // title -> playing -> end -> done
  frames: 0, phaseFrames: 0,
  pending: false, resolve: null,
};

/* How many milliseconds of SESSION time one pass of the film actually spends,
   at speed 1. advance() replaces every gap longer than DEAD_AIR with holdFor(),
   so the answer is not the session's duration — it is the sum of the gaps the
   replay really sits through, and it is exactly linear in clock.speed (the
   holds are measured in session ms and divided by speed just like real gaps).
   That linearity is what lets record mode pick a speed and know the length. */
/* What ONE gap really costs the transport. Not simply holdFor(gap): after
   advance() jumps the clock to `next - holdFor(gap)` the remaining distance is
   itself a gap, and if it is still over DEAD_AIR the very next frame jumps
   again — and holdFor() of anything at or under 1400 ms is its own floor, 280.
   So a long silence collapses to the floor in two frames. Worked through:
     gap <= 500          the transport really waits it out
     500 < gap <= 14000  holdFor is the 280 floor, under DEAD_AIR, so: 280
     14000 < gap <= 25000  holdFor is 2% of the gap and over the floor: gap*0.02
     gap > 25000         holdFor is over DEAD_AIR, so it collapses again: 280
   This mirrors advance(); if that function's constants change, this changes
   with it. */
function effectiveHold(gap) {
  if (gap <= DEAD_AIR) return gap;
  const h = holdFor(gap);
  return h > DEAD_AIR ? HOLD_MIN : h;
}

function filmPlanMs(events) {
  let spent = 0, cur = 0;
  for (const e of events) {
    /* Same rule as advance(): a tool_end is bookkeeping and never decides when
       the clock may skip, so it never opens a gap of its own. */
    if (e.kind === 'tool_end') continue;
    const gap = e.t - cur;
    if (gap > 0) spent += effectiveHold(gap);
    cur = e.t;
  }
  return Math.max(1, spent);
}

function recordState() {
  return { phase: REC.phase, frames: REC.frames, fps: REC.fps,
           speed: +clock.speed.toFixed(2), t: Math.round(clock.t) };
}

/* One film frame's worth of state change, run before the frame is drawn. */
function recordStep() {
  REC.frames++; REC.phaseFrames++;
  if (REC.phase === 'title') {
    if (REC.phaseFrames >= REC.titleFrames) {
      REC.phase = 'playing'; REC.phaseFrames = 0;
      el('record-card').hidden = true;
      clock.paused = false;
    }
  } else if (REC.phase === 'playing') {
    const done = cursor >= replay.events.length &&
                 clock.t >= (replay.session.duration_ms || 0);
    if (done) {
      REC.phase = 'end'; REC.phaseFrames = 0;
      clock.paused = true;
      el('record-end-line').textContent =
        `${tally.files} buildings · ${tally.tools} tool calls · ${tally.agents} agents`;
      el('record-card').hidden = false;
    }
  } else if (REC.phase === 'end') {
    if (REC.phaseFrames >= REC.endFrames) REC.phase = 'done';
  }
}

/* Called once from boot(), only when ?record=1 is on the URL. */
function startRecord() {
  REC.on = true;
  document.body.classList.add('record');
  clock.paused = true;                 // the title card holds the city still
  const plan = filmPlanMs(replay.events);
  clock.speed = Math.min(REC.maxSpeed,
                         Math.max(1, plan / (REC.targetPlaySecs * 1000)));
  /* The crowd runs on wall time and everything else in a recording runs on the
     session clock. Told the speed once, life.js's own accident sequence lands
     inside the film instead of outstaying it — see city.js setLifeRate(). */
  City.setLifeRate(clock.speed);
  const started = replay.session.started ? new Date(replay.session.started) : null;
  el('record-title').textContent = oneLine(replay.session.title) || 'session';
  /* The town's own name first: in single-session mode `projectName` is the
     STREET's title, which is the line above — printing it twice would say
     nothing. `replay.town` is what /api/project hands over for exactly this. */
  el('record-sub').textContent =
    [(replay.town && replay.town.name) || projectName || lastSeg(cwd || ''),
     started ? started.toISOString().slice(0, 10) : ''].filter(Boolean).join(' · ');
  el('record-end-line').textContent = '';
  el('record-card').hidden = false;
  window.__recordTick = () => new Promise(res => { REC.pending = true; REC.resolve = res; });
  window.__recordState = recordState;
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
  /* Inside a building the same keys mean something else: W is a step forward,
     not a letter, and space is up rather than pause. The transport keeps its
     state and comes back untouched when the visit ends. */
  if (Interior.busy()) return;
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
  else if (k === 'p' || k === 'P') {
    /* Play the last materialisation again. VISUAL ONLY: it re-runs the print
       plane over a shell that already stands, and touches no event, no floor
       count and no clock — which is why it is a key and not a seek. */
    const rel = City.replayLastPrint();
    flashBadge(rel ? 'print ▸' : 'nothing printed yet');
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
   Order is fixed: ?src= wins, then the exported demo, then the dev fixture.
   ========================================================================== */
async function load(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.session && Array.isArray(j.events)) ? j : null;
  } catch (_) { return null; }   // the fault screen reports the end of the list
}

/* Plain JSON, for the endpoints that are not a replay payload. */
async function loadJson(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
  catch (_) { return null; }
}

/* Which town or session this page is showing, decided once:

     ?src=<url>       a replay file — a project export or a single session
     ?project=<town>  the whole project, from GET /api/project?id=
     ?session=<uuid>  one session, live — one street
     ?project=<town>&session=<uuid>&replay=1
                      one FINISHED session, replayed from the top: the town's
                      own payload with every other street's events filtered out.
                      This is the stable "recording" address — see
                      docs/HOW-IT-WORKS.md, "Recordings"
     ?live=1          the session Beri is working in RIGHT NOW, resolved to its
                      town through /api/sessions, so the launcher's own URL
                      keeps working and still opens the whole project
     (nothing)        data/demo.json, then the hand-written fixture

   A payload with a top-level `streets` array is a project whichever door it
   came in through, which is why ?src=data/sample-project.json is a full
   rehearsal of project mode with no server running at all. */
/* One street lifted out of a town's merged payload, as a payload of its own.

   The server already stamps every event with the session it came from
   (`e.session`, set in build_project_replay), so this needs no new endpoint —
   which is the point: the recording link is the SAME data the city already
   draws, not a second export that could drift from it. `t` is rebased to the
   street's own first event because a town's clock starts at its OLDEST
   session, and replaying from 0 would otherwise open on days of dead air.
   Returns null when the town has no such street, so the caller can fall back
   to the whole town rather than showing an empty city. */
function oneStreet(rep, sid) {
  const street = (rep.streets || []).find(s => s.id === sid);
  const evs = (rep.events || []).filter(e => e.session === sid);
  if (!street || !evs.length) return null;
  const base = evs[0].t;
  const events = evs.map(e => ({ ...e, t: e.t - base }));
  const prefix = sid.slice(0, 8) + ':';
  return {
    ...rep,
    session: { ...rep.session, id: sid, started: street.started,
               duration_ms: events[events.length - 1].t, title: street.title },
    agents: (rep.agents || []).filter(a => String(a.id).startsWith(prefix)),
    events,
    streets: [{ ...street, events: events.length }],
  };
}

let sessionPin = null;
let filmSession = null;   // ?replay=1&session= — one finished session, from the top
async function pick() {
  const q = new URLSearchParams(location.search);
  /* `replay=1` is what separates a RECORDING from the live pin: with it, the
     session id names a finished conversation to play back from the top, and
     nothing must attach to /api/stream. Without it, ?session= keeps its
     original meaning (follow this one session live) untouched. */
  const filmSid = q.get('replay') === '1' ? q.get('session') : null;
  filmSession = filmSid;
  sessionPin = filmSid ? null : q.get('session');

  const src = q.get('src');
  if (src) return load(src);

  const proj = q.get('project');
  if (proj) {
    projectId = proj;
    /* /api/project's own window is the last 30 days. A recording link to an
       older session therefore carries `since` (recordings.js reads it off the
       sidecar's date) — without it that street is simply not in the payload
       and the page would silently show the whole town instead. */
    const since = q.get('since');
    const rep = await load('/api/project?id=' + encodeURIComponent(proj) +
                           (since ? '&since=' + encodeURIComponent(since) : ''));
    if (rep && filmSid) return oneStreet(rep, filmSid) || rep;
    return rep;
  }

  if (q.get('live') === '1' && !sessionPin) {
    /* /api/sessions carries each session's `town`. The newest session's town is
       the project the launcher meant, so ?live=1 becomes project mode by
       itself. An older server with no `town` field falls through to the
       single-session stream — nothing breaks, it just shows one street. */
    const list = await loadJson('/api/sessions');
    const row = Array.isArray(list) && list.length ? list[0] : null;
    if (row && row.town) {
      const rep = await load('/api/project?id=' + encodeURIComponent(row.town));
      if (rep) { projectId = row.town; return rep; }
    }
  }

  for (const url of ['data/demo.json', 'data/sample.json']) {
    const j = await load(url);
    if (j) return j;
  }
  return null;
}

function showFault(msg) {
  el('fault-text').textContent = msg;
  el('fault').hidden = false;
}

async function boot() {
  const canvas = el('stage');
  if (!City.init(canvas)) {
    showFault('This browser could not open a WebGL context, so the city cannot be ' +
              'drawn. The 2D version is still in archive/tree/.');
    return;
  }
  /* Bloom is what turns lit windows into a city at dusk rather than a chart of
     boxes. It is a measured cost, not a guess — RUNBOOK.md carries the frame
     rate with it on, and it is the first thing to drop if that number moves. */
  City.enableBloom(true);
  /* The ORNIS airframes, before the first frame: DroneKit.load() bakes seven
     billboards through this same renderer, and a composer.render() interleaved
     with those bakes is a documented way to get a blank sprite (docs/DRONES.md).
     It resolves false on ?drones=discs and on a missing model — the city flies
     the old octahedrons in both cases rather than not flying at all. */
  await City.loadDrones();
  window.addEventListener('resize', () => City.resize());
  attachTickerSwipe();
  attachMobilePlaypause();

  replay = await pick();
  if (!replay) {
    showFault('No session to replay yet. Export one to data/demo.json, ' +
              'or pass ?src= a replay file.');
    return;
  }
  cwd = chooseRoot(replay);

  /* Project mode is decided by the PAYLOAD, not by the URL: anything carrying a
     `streets` array is a town. Every other mode is the same town with one
     avenue, so there is one code path below and not two. */
  projectMode = Array.isArray(replay.streets) && replay.streets.length > 0;
  /* /api/project puts the TOWN's name in session.title — a project payload has
     no single session to be titled after, so that field is the project. The
     path trie is still the fallback, which is what an older or hand-made
     payload lands on. */
  projectName = projectMode ? (oneLine(replay.session.title) || null) : null;
  declaredStreets.length = 0;
  streetSeen.clear();
  if (projectMode) {
    for (const s of replay.streets) declaredStreets.push({ id: s.id, title: s.title, live: !!s.live, events: s.events });
  } else {
    declaredStreets.push({ id: SOLO_STREET, title: oneLine(replay.session.title) || 'session',
                           live: new URLSearchParams(location.search).get('live') === '1' });
  }

  /* The project is the headline, not the prompt. A session prompt is a paragraph
     of somebody's sentence — set in the display serif at 44px it took a quarter
     of the frame and fought the skyline behind it. The place the work happened
     is one short word, it fits on one line, and it is what a viewer needs first.
     The prompt keeps its place directly underneath, in the mono the rest of the
     chrome uses, at one line and 60% — present, but not the picture. Nothing has
     been ingested yet, so this falls through to the root's own name until the
     first tool events pick a real project (see dominantProject() above). */
  if (!projectMode) el('session-prompt').textContent = clip(oneLine(replay.session.title), 70);
  document.title = (replay.session.title || 'Werkstadt') + ' — Werkstadt';

  replay.events.sort((a, b) => a.t - b.t);
  /* Handed over once: the interior reads it, never writes it. `solo` is the id
     the single-session mode files everything under, so a street sign in that
     mode opens a hall of the whole session rather than of nothing. */
  Interior.setSource({ projectId, events: replay.events,
                       agents: replay.agents || [], solo: SOLO_STREET });
  resetWorld();          // opens every declared avenue before the first event
  updateTitle();         // needs the streets, so it runs after resetWorld()
  cursor = 0; clock.t = 0; lastEventAt = 0;
  paintChrome(); paintClock();

  /* The hints are a courtesy on the first visit — six seconds, once per browser
     — and `H` brings the same card back for the rest of the time. City.showHints
     owns both routes so they cannot drift apart. */
  try {
    if (!localStorage.getItem('werkstadt.hints-seen')) {
      City.showHints();
      localStorage.setItem('werkstadt.hints-seen', '1');
    }
  } catch (_) { City.showHints(); }   // private mode: show them anyway

  /* Live mode: the same ingest() the replay uses, fed by the server's stream.
     One JSON event per SSE message, shaped exactly like an entry in the replay
     file's `events` array. */
  /* A project follows its town's stream whenever one of its streets is still
     live — the page was opened on a project that is being worked on right now,
     and that is exactly when it should keep building. Otherwise ?live=1 (or a
     pinned ?session=) asks for the single-session stream, as before. */
  /* A recording never attaches to the stream, even when the session it replays
     happens to still be live: the whole point of the link is that it plays the
     same thing every time it is opened. */
  const wantLive = !filmSession &&
                   (new URLSearchParams(location.search).get('live') === '1' || !!sessionPin ||
                    (projectMode && declaredStreets.some(s => s.live)));
  const streamUrl = projectId ? '/api/stream?project=' + encodeURIComponent(projectId)
                  : sessionPin ? '/api/stream?session=' + encodeURIComponent(sessionPin)
                  : '/api/stream';
  if (wantLive && !new URLSearchParams(location.search).get('src')) {
    try {
      /* server.py can switch to a newer session mid-stream and send a fresh
         burst with no reset event of its own (see RUNBOOK's "known limits").
         A burst's first timestamp lands far behind the one just watched — more
         than a minute is not something a real session's own event gaps do —
         so that gap is the signal a new session has started. */
      let lastLiveT = null;
      const es = new EventSource(streamUrl);
      es.onmessage = m => {
        try {
          const ev = JSON.parse(m.data);
          /* In PROJECT mode a backwards jump is not a new session — it is the
             next street's own history arriving, and `t` is measured from the
             first session in the town, so it never rewinds by a minute anyway.
             The reset therefore only applies to the single-session stream. */
          if (!projectMode && lastLiveT !== null && ev.t < lastLiveT - 60000) seekTo(0);
          lastLiveT = ev.t;
          if (clock.follow && ev.t > clock.t) clock.t = ev.t;
          ingest(ev, false);
        } catch (_) { /* a malformed frame must not kill the stream */ }
      };
      es.onerror = () => { /* EventSource reconnects on its own; stay quiet */ };
      clock.paused = true;    // in live mode the stream drives the clock, not us

      /* /api/sessions names the session the server is actually following —
         the title block otherwise only ever shows what the trie above has
         inferred from paths, and a fresh live session has touched none yet. */
      if (!projectMode) {
        fetch('/api/sessions').then(r => r.ok ? r.json() : null).then(list => {
          const picked = Array.isArray(list) ? list[0] : null;
          if (picked && picked.title) el('session-prompt').textContent = clip(oneLine(picked.title), 70);
        }).catch(() => { /* no server, no title update — the fault screen already covers this */ });
      }
    } catch (_) {
      showFault('Live mode asked for /api/stream, but the stream is not there.');
    }
  } else {
    /* No ?live=1 yet: offer it, but only when a live server is actually
       there to answer — otherwise the link would be a dead end. */
    fetch('/api/sessions').then(r => { if (r.ok) el('live-link').hidden = false; }).catch(() => {});
  }

  /* ?demo=print — the busiest minute of materialisation, at half speed.
     A print happens exactly when a file is touched for the FIRST time, so the
     densest stretch of prints is the densest stretch of first touches. Nothing
     is staged: this only moves the transport to a moment that is already in the
     data. Documented in docs/RUNBOOK.md. */
  if (new URLSearchParams(location.search).get('demo') === 'print') {
    const at = firstPrintCluster(replay.events, 3, 20000);
    if (at !== null) {
      clock.speed = 0.5;
      seekTo(Math.max(0, at - 1500));
      clock.paused = false;
      flashBadge('print demo · 0.5×');
    } else flashBadge('no cluster of 3 prints');
  }

  /* ?record=1 — the film set. Last, so it overrides the transport state every
     block above may have left behind (?demo=print sets a speed of its own). */
  if (new URLSearchParams(location.search).get('record') === '1') startRecord();

  requestAnimationFrame(now => { prev = now; frame(now); });
}

/* The first timestamp at which `need` distinct files are touched for the first
   time inside `span` ms. Returns the first of those touches, or null. */
function firstPrintCluster(events, need, span) {
  const seen = new Set();
  const firsts = [];
  for (const ev of events) {
    if (ev.kind !== 'tool' || !ev.path) continue;
    const rel = relativise(ev.path);
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    firsts.push(ev.t);
  }
  for (let i = 0; i + need - 1 < firsts.length; i++) {
    if (firsts[i + need - 1] - firsts[i] <= span) return firsts[i];
  }
  return null;
}

boot();

/* Exposed for the measurements in docs/RUNBOOK.md. Reading them costs nothing,
   and they are the only honest way to report a frame rate and a node count from
   this machine. __stress places extra real buildings so the brief's 300-building
   gate can be measured on a session that only ever reaches 221. */
window.__fps = () => {
  if (!fpsSamples.length) return 0;
  const avg = fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length;
  return Math.round(1 / avg);
};
window.__nodes = () => City.buildingCount();
/* The navigation instrument — where the lens is, how far over the ground, what
   the orbit is aiming at and which mode has it. Every nav gate is stated in
   these numbers, because a screenshot can answer none of them. */
window.__cam = () => City.camProbe();
window.__drones = () => City.droneCount();
/* The ORNIS fleet: how many craft of each airframe are up, the LOD split behind
   the frame rate, and `kit:false` when the page is flying the disc fallback. */
window.__kit = () => City.kitStats();
/* Worker drones in the air right now — one per tool call with no tool_result
   yet, so this is the concurrency the session actually has. */
window.__workers = () => City.workerCount();
/* Avenues standing — one per session in this project's city. */
window.__streets = () => ({ count: City.streetCount(), current: City.liveStreetTitle() });
window.__stress = n => City.stress(n);
/* n avenues, each with a handful of buildings, for the twelve-street half of
   the frame-rate gate. Measurement only, exactly like __stress. */
window.__stressStreets = n => City.stressStreets(n);
/* n extra workers, spread over as many synthetic craft as the 12-per-craft cap
   needs — the frame-rate gate asks for 40 visible ones. Measurement only. */
window.__stressWorkers = n => City.stressWorkers(n);
/* For the two shots that have to be caught rather than timed: how many
   buildings are mid-print and how many craft are mid-derez, this instant. */
window.__printing = () => City.printingCount();
window.__derezzing = () => City.derezCount();
/* The print in numbers: { jobs, seconds, k, cue }. `seconds` is the SCHEDULED
   length of the longest print running — the duration gate in RUNBOOK.md is read
   off this, because a stopwatch on a screenshot cannot see it. `cue` says
   whether the camera is inside a print close-up this instant. */
window.__print = () => City.printProbe();
/* Play the last materialisation again, exactly what `P` does. */
window.__replayPrint = () => City.replayLastPrint();
/* True while the camera is easing to a newly reached avenue — the three-second
   window `docs/shots/project-street.png` has to be caught inside. */
window.__streetIntro = () => City.inStreetIntro();
/* Jump the transport to a session timestamp. The arrow keys move in ten-second
   steps, and the avenues of a real project are HOURS apart — so photographing a
   street intro from the outside needs the same jump the `→` key does, in one
   call. Capture harness only; it is exactly seekTo(), which the keys use. */
window.__seek = ms => { if (replay) seekTo(ms); return clock.t; };
/* The legibility floor, measured rather than asserted: the smallest glyph
   height in pixels among the captions currently on screen. Gate: >= 13. */
window.__tags = () => City.tagPixels();
/* Where the city sits in the frame, in per cent of it: { width, top }. This is
   the instrument behind the framing row in RUNBOOK.md — a pixel measurement off
   a screenshot cannot tell a lit window from a drone or a star, and this can. */
window.__frame = () => City.frameBox();
/* The two silent breakages, in one call: { attrs, sphereRadius, streets,
   buildings }. attrs must be 16 (17 stops the facade program linking and the
   city goes black); sphereRadius must be positive (a cached -1 makes every
   building raycast miss and hovering does nothing, with no error anywhere).
   See selfCheck() in city.js for the whole story. */
window.__selfcheck = () => City.selfCheck();

/* --- the interior, for the capture harness -------------------------------
   A screenshot harness has no mouse and cannot hold one, so the four interior
   shots are taken by naming what to walk into and where to stand. These are
   exactly what a click and a walk do; nothing here is a shortcut past the real
   code path. `__interior()` is the instrument the readability gate is read
   from: minGlyphPx is measured on the RENDERED frame, floor 13 px, gate 14. */
window.__enterFile = rel => City.enterFileByPath(rel);
window.__enterPlate = name => City.enterPlateByName(name);
window.__enterStreet = i => City.enterStreetByIndex(i || 0);
window.__stand = (x, y, z, yaw, pitch) => Interior.stand(x, y, z, yaw, pitch);
window.__leaveInterior = () => Interior.leave();
window.__interior = () => Interior.probe();

/* =============================================================================
   werkstadt — recordings.js
   The shelf: every finished session film, grouped by project.

   It reads GET /api/recordings and nothing else. Every field on a card came
   out of that sidecar JSON, which the recorder wrote from ffmpeg's own output
   and the session's own counts — there is no number here that this page
   invented, same rule the city obeys.

   Two kinds of "recording" live on every card, and the difference is the whole
   design of this page:
     * the MP4 is the file — it travels, it plays anywhere, it is lossy;
     * the replay link is the real thing — the same session rebuilt in its own
       project city, exact, and only reachable by someone who can reach this
       machine.
   Nothing is ever uploaded. `copy link` copies an address on THIS origin; if
   you are on a private network that is that address, which is the sharing
   story, and it is deliberate that there is no button which sends a file
   somewhere on its own. See docs/DECISIONS.md.
   ========================================================================== */

const el = id => document.getElementById(id);

/* --- plain formatting, no library ---------------------------------------- */
const two = n => String(n).padStart(2, '0');

function hms(secs) {
  const s = Math.round(secs || 0);
  const m = Math.floor(s / 60);
  return `${m}:${two(s % 60)}`;
}

function mb(bytes) {
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/* A date a person reads, in their own locale, from the session's own ISO
   timestamp. Falls back to the raw string rather than printing "Invalid
   Date" at somebody. */
function day(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? String(iso).slice(0, 10)
                  : d.toLocaleDateString(undefined,
                      { year: 'numeric', month: 'short', day: 'numeric' });
}

let toastTimer = 0;
function toast(text) {
  const t = el('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

/* Clipboard first, and a real fallback second: navigator.clipboard is refused
   outside a secure context, and over a LAN or VPN this page is plain http — which
   is exactly the situation in which somebody wants to copy a link. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('link copied');
    return;
  } catch (_) { /* fall through to the selection route */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  toast(ok ? 'link copied' : text);   // last resort: show it so it can be copied by hand
}


/* =============================================================================
   ONE CARD
   ========================================================================== */
function filmCard(rec) {
  const li = document.createElement('li');
  li.className = 'film';

  /* THE POSTER is a <button>, not a div with a click handler: it is the
     primary action on the card and it has to be reachable with a keyboard. */
  const poster = document.createElement('button');
  poster.type = 'button';
  poster.className = 'poster';
  poster.setAttribute('aria-label', `play ${rec.title || 'this recording'}`);
  if (rec.poster) {
    const img = document.createElement('img');
    img.src = rec.poster;
    img.alt = '';                       // decorative: the title is right below it
    img.loading = 'lazy';
    poster.appendChild(img);
  }
  const glyph = document.createElement('span');
  glyph.className = 'play';
  poster.appendChild(glyph);
  const dur = document.createElement('span');
  dur.className = 'dur';
  dur.textContent = hms(rec.duration_secs);
  poster.appendChild(dur);

  /* Play IN PLACE. A <video> is only created on click, so a shelf of thirty
     films costs thirty JPEGs on load and not thirty video elements each
     opening a range request of its own. */
  poster.addEventListener('click', () => {
    const v = document.createElement('video');
    v.src = rec.mp4;
    v.controls = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = 'metadata';
    poster.replaceWith(v);
    v.className = 'poster';
    v.focus();
  });
  li.appendChild(poster);

  const h3 = document.createElement('h3');
  h3.dir = 'auto';                      // a session title is whatever was typed
  h3.textContent = rec.title || rec.session_id;
  li.appendChild(h3);

  const meta = document.createElement('p');
  meta.textContent = [day(rec.started), `${rec.tool_events} tool calls`,
                      mb(rec.bytes), `${rec.speed}×`]
                     .filter(Boolean).join(' · ');
  li.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const replay = document.createElement('a');
  replay.className = 'replay';
  replay.href = rec.replay_url;
  replay.textContent = 'open live replay';
  replay.title = 'the same session rebuilt in its project city — exact, not a video';
  actions.appendChild(replay);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'copy link';
  /* The link is built against THIS origin, so on a LAN or a VPN it carries
     that address and works for whoever else is on that network. */
  copy.addEventListener('click',
    () => copyText(new URL(rec.replay_url, location.href).href));
  actions.appendChild(copy);

  const dl = document.createElement('a');
  dl.href = rec.mp4;
  dl.setAttribute('download', '');
  dl.textContent = 'download MP4';
  actions.appendChild(dl);

  const copyFile = document.createElement('button');
  copyFile.type = 'button';
  copyFile.textContent = 'copy download link';
  copyFile.title = 'the MP4’s own address — nothing is uploaded anywhere';
  copyFile.addEventListener('click',
    () => copyText(new URL(rec.mp4, location.href).href));
  actions.appendChild(copyFile);

  li.appendChild(actions);
  return li;
}


/* =============================================================================
   BOOT — read the shelf, group it, draw it
   ========================================================================== */
function groupByProject(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.project || 'unfiled';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return by;
}

async function boot() {
  let data = null;
  try {
    const r = await fetch('/api/recordings', { cache: 'no-store' });
    if (r.ok) data = await r.json();
  } catch (_) { /* the message below covers a missing server */ }

  if (!data) {
    el('shelf-counts').textContent = 'no server';
    el('shelf-empty').textContent =
      'This page needs server.py running on this machine — it is the only thing ' +
      'that knows which sessions have been recorded. Start it and reload.';
    el('shelf-empty').hidden = false;
    return;
  }

  const rows = data.recordings || [];
  /* null, not 0, until the recorder's first scan has finished — saying "0
     queued" before anything has been counted would be a number this page
     invented, which is the one thing nothing here does. */
  const pending = typeof data.pending === 'number' ? Math.max(0, data.pending) : null;
  const total = rows.reduce((n, r) => n + (r.duration_secs || 0), 0);
  el('shelf-counts').textContent =
    `${rows.length} ${rows.length === 1 ? 'film' : 'films'} · ${hms(total)} of footage` +
    (pending ? ` · ${pending} still to render` : '');

  if (!rows.length) {
    el('shelf-empty').textContent =
      'Nothing recorded yet. The recorder renders one session at a time, and only ' +
      'while nothing else is running: a session has to have been quiet for ten ' +
      'minutes and carry at least twenty tool calls before it gets a film. ' +
      (pending === null ? 'The queue has not been counted yet.'
       : pending ? `${pending} session${pending === 1 ? ' is' : 's are'} in the queue.`
       : 'Nothing is queued right now.');
    el('shelf-empty').hidden = false;
    return;
  }

  const shelf = el('shelf');
  for (const [project, films] of groupByProject(rows)) {
    const section = document.createElement('section');
    section.className = 'project';
    /* The same navigation contract the rest of the project keeps: a plain-
       language name on every section, readable by a person who did not write
       this page (docs/EDITING.md). */
    section.dataset.sid = 'project-' + project;
    section.dataset.title = `Every recorded session from ${project}`;

    const h2 = document.createElement('h2');
    h2.textContent = project;
    const count = document.createElement('span');
    count.textContent = `${films.length} ${films.length === 1 ? 'session' : 'sessions'}`;
    h2.appendChild(count);
    section.appendChild(h2);

    const ul = document.createElement('ul');
    ul.className = 'films';
    for (const rec of films) ul.appendChild(filmCard(rec));
    section.appendChild(ul);
    shelf.appendChild(section);
  }
}

boot();

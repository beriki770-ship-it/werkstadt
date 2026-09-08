/* =============================================================================
   CONTROLS — enter, exit and search, as three buttons a mouse can reach
   Shared by globe.js, world.js and city.js. Nothing in here knows what a
   settlement, a landmark or a building is: each page passes in what entering
   and leaving MEAN there, and this file owns only the buttons, their labels,
   their disabled states and the quick-lists under the search field.

   WHY IT EXISTS.  `globe.html?wallpaper=1` is the desktop wallpaper and Lively
   forwards MOUSE ONLY to it (`InputForward: 1` — see RUNBOOK "The desktop
   wallpaper"). Double-click still arrives there; "/" , Escape and Enter never
   do. Every way into and out of a place on these three pages was a key, so on
   the desktop the world could be turned and read but not walked.

   WHY ONE MODULE AND NOT THREE BLOCKS.  The three pages differ only in what
   `enter` and `exit` do. The label rules, the one-word trim, the disabled
   state, the poll that keeps them true and the quick-list markup are the same
   sentence three times over, and three copies is three places for the 44 px
   hit target and the aria-label to drift.

   THE KEYS ARE UNTOUCHED.  This adds a second way to do what "/" , Escape,
   Enter and double-click already did; it replaces none of them, and it calls
   the page's own functions rather than re-implementing any of them.

   A FOURTH BUTTON, `play`, appears only on the wallpaper and only inside the
   window it opens — see CONTROLS-PLAY below for why a kiosk window and not a
   forwarded keystroke.
   ========================================================================== */

/* =============================================================================
   THE WALLPAPER FLAG HAS TO SURVIVE A HAND-OVER  <!-- CONTROLS-WALLPAPER -->
   `globe.html?wallpaper=1` is the desktop, and `body.wallpaper` is the ONE
   thing that lifts the button cluster clear of the taskbar: Lively paints over
   the screen BOUNDS (2880x1800) and not the working area (2880x1704), so the
   bottom 48 CSS px of every page are behind the taskbar (controls.css).

   Measured 2026-09-07 at the real desktop geometry (1440x900 @ dpr 2), the bug
   Beri hit: every cross-page link dropped `wallpaper=1`, so the flag existed
   only until the first hand-over. `enter` on a settlement went to
   `index.html?project=...` with no flag, and pressing `globe` there came back to
   a bare `globe.html` whose cluster fell to `bottom: 26px` — page-bottom 874,
   i.e. UNDER the taskbar. The wallpaper then had no reachable control at all:
   you could neither enter anything nor leave. "I entered a project and now I
   can't get out of it."

   Two layers, because one is not enough. `href()` keeps the flag in the URL, so
   the page it lands on can read the param the way globe.js's own WALLPAPER
   const does. sessionStorage is the belt under it: sessionStorage is per-tab
   and the wallpaper is one tab that lives for weeks, so once the flag has been
   seen it stays seen — a link somebody adds later and forgets to route through
   href() costs a lost masthead, not a dead desktop.
   ========================================================================== */
const WP_KEY = 'werkstadt.wallpaper';

function readWallpaper() {
  if (new URLSearchParams(location.search).get('wallpaper') === '1') {
    /* Wrapped: sessionStorage throws outright in a WebView with site data
       blocked, and a throw at module scope would take the whole page down. */
    try { sessionStorage.setItem(WP_KEY, '1'); } catch (_) {}
    return true;
  }
  try { return sessionStorage.getItem(WP_KEY) === '1'; } catch (_) { return false; }
}

/** True on any page inside the desktop wallpaper's WebView. */
export const wallpaper = readWallpaper();

/* Set here and not in each page's boot: globe.js, world.js and city.js all
   import this module, module bodies run before any of their init() does, and
   `body.wallpaper` has to be on before the first paint or the cluster is drawn
   under the taskbar and then jumps. globe.js still sets the same class itself —
   classList.add is idempotent, and its copy is what feeds SCREENSAVER. */
if (wallpaper) document.body.classList.add('wallpaper');

/* =============================================================================
   PLAY MODE — the wallpaper borrows the screen  <!-- CONTROLS-PLAY -->
   Beri asked to "play inside the wallpaper too". The wallpaper cannot be given
   a keyboard: Lively hosts it in a WebView2 behind the desktop icons with
   `InputForward: 1` (mouse only), and the only setting that forwards keys,
   `InputForward: 2`, swallows every key typed AT the desktop as well — Win+R
   and a rename in Explorer would stop working (docs/RUNBOOK.md "The desktop
   wallpaper"). Forwarding a synthesised keystroke into that layer from here is
   not possible either: nothing on the page can reach the host process.

   So `play` does not try to make the wallpaper focusable. It asks the SERVER to
   open one fullscreen kiosk browser window, at this same page and state, over
   the desktop. That window is an ordinary browser with real focus, so WASD, F,
   "/" and Escape work there exactly as they do in a normal tab, and leaving
   kills the window — the wallpaper is simply there underneath, never touched
   and never reloaded. See docs/DECISIONS.md.

   THE FLAG SURVIVES A HAND-OVER, for the same reason `wallpaper` does. The
   kiosk starts on globe.html and its whole point is walking from there into a
   city and back; if `play=1` were dropped on the first link, the "back to
   desktop" button and the Escape handler would vanish and the fullscreen window
   would have no way out at all — the exact dead end CONTROLS-WALLPAPER above
   describes. Both layers again: href() carries it in the URL, sessionStorage
   remembers it for any link that forgets. sessionStorage is safe here in a way
   it would not be in Beri's own browser: the kiosk runs on its own throwaway
   profile (`data/.cache/play-profile`), so this key never touches his session.
   ========================================================================== */
const PLAY_KEY = 'werkstadt.play';

function readPlay() {
  if (new URLSearchParams(location.search).get('play') === '1') {
    try { sessionStorage.setItem(PLAY_KEY, '1'); } catch (_) {}
    return true;
  }
  try { return sessionStorage.getItem(PLAY_KEY) === '1'; } catch (_) { return false; }
}

/* Module-local, not exported: no page needs to know it is in the play window.
   That is the point — with `wallpaper=1` gone the pages are already in their
   full desktop-browser behaviour (globe.js's SCREENSAVER folds WALLPAPER in,
   so dropping the flag restores hints, hover and the quality picker for free). */
const play = readPlay();

if (play) document.body.classList.add('play');

/**
 * A cross-page URL that keeps the wallpaper alive.
 * Every `location.href = ...` that leaves globe.html, world.html or index.html
 * goes through this; a raw string there is the bug described above.
 */
export function href(url) {
  let out = url;
  if (wallpaper) out += (out.includes('?') ? '&' : '?') + 'wallpaper=1';
  /* Never both: the desktop layer and the kiosk window are two different
     surfaces, and the kiosk is opened from a URL with `wallpaper` stripped. */
  if (play) out += (out.includes('?') ? '&' : '?') + 'play=1';
  return out;
}

/* -----------------------------------------------------------------------
   Talking to the server about the one kiosk window. Both routes are POST and
   loopback-only (server.py "Play mode"); a failure is logged and swallowed
   because there is nothing a person could do about it from inside a wallpaper.
   -------------------------------------------------------------------- */

/** The address the play window opens at: this page, this state, as a browser
    window rather than a desktop layer. `wallpaper` and `screensaver` come off
    — they are the desktop preset (slow spin, no hints, no hover, no quality
    picker) and the whole request is for the opposite of that. */
function playUrl(cfg) {
  const p = new URLSearchParams(location.search);
  p.delete('wallpaper');
  p.delete('screensaver');
  p.set('play', '1');
  const st = (cfg && cfg.state) ? (cfg.state() || {}) : {};
  for (const k of Object.keys(st)) {
    const v = st[k];
    if (v === null || v === undefined || v === '') p.delete(k);
    else p.set(k, String(v));
  }
  /* The file name only. server.py refuses anything with a scheme or a slash in
     it — this server is being asked to open a browser, and the one thing that
     must be impossible is opening it at somebody else's address. */
  const file = location.pathname.split('/').pop() || 'globe.html';
  return file + '?' + p.toString();
}

async function startPlay(cfg) {
  try {
    const r = await fetch('/api/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: playUrl(cfg) }),
    });
    if (!r.ok) console.warn('play: server answered ' + r.status);
  } catch (e) { console.warn('play: ' + e.message); }
}

async function stopPlay() {
  try { await fetch('/api/play/stop', { method: 'POST' }); }
  catch (e) { console.warn('play stop: ' + e.message); }
}

/** "Esc leaves", for three seconds. The kiosk is fullscreen with no tab strip,
    no address bar and no window frame, so the one thing a person arriving there
    needs told is how to get out again; after that it is in the way. */
function showEscHint() {
  const el = document.createElement('p');
  el.id = 'play-hint';
  el.textContent = 'Esc leaves';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* How often the Enter and Exit buttons re-read the page. Neither globe.js,
   world.js nor city.js announces a selection change — the selected place is a
   module-scope variable four call sites write — so the honest options were a
   poll or an event none of them emit. 250 ms is under the ~350 ms at which a
   button feels stale to the hand, and the work is two string compares and, only
   when something actually changed, one textContent write. */
const REFRESH_MS = 250;

/* The label has to fit next to the word "enter" on a 390 px phone, so a project
   called `wild-digital-moments-site` is cut to the last word a person would say
   out loud. Slashes and dots first, because a target is often a path. */
function oneWord(s) {
  const t = String(s || '').trim();
  if (!t) return '';
  const last = t.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return last.length > 18 ? last.slice(0, 17) + '…' : last;
}

/**
 * Wire the cluster this page's markup already contains.
 *
 * @param {object} cfg
 *   target()      -> string|null  the name of what Enter would enter right now,
 *                                 or null when nothing is in the crosshair.
 *   enter()                       do exactly what a double-click does.
 *   exitLabel()   -> string|null  one word for what Exit would leave, or null
 *                                 at the top level — the button then hides.
 *   exit()                        do exactly what Escape / back does.
 *   search        -> null|{ open(), close(), isOpen(), go(query) }
 *                                 null on a page with no address search
 *                                 (index.html has none), which hides the button.
 *   quickLists()  -> [{ title, items: [{ label, query }] }]
 *                                 rows to draw under the field, from the
 *                                 payload the page is already built from.
 *   state()       -> object|null  optional. URL params that put the PLAY window
 *                                 back where the wallpaper was — only params
 *                                 the page already reads out of its own URL.
 *                                 A key whose value is null is dropped.
 */
export function install(cfg) {
  const nav = document.getElementById('controls');
  if (!nav) return;                       // a page without the markup opts out
  const bEnter = document.getElementById('ctl-enter');
  const bExit = document.getElementById('ctl-exit');
  const bSearch = document.getElementById('ctl-search');
  const bPlay = document.getElementById('ctl-play');
  const quick = document.getElementById('search-quick');
  const targetSpan = bEnter && bEnter.querySelector('.ctl-target');

  /* A pointerdown on the cluster must not reach the canvas underneath: the
     canvas treats a press as the start of an orbit drag, and on the globe a
     press that ends without moving also opens or closes a caption. Clicking
     "enter" would then close the very caption it is about to act on. */
  nav.addEventListener('pointerdown', e => e.stopPropagation());

  if (bEnter) bEnter.addEventListener('click', () => { if (!bEnter.disabled) cfg.enter(); });
  if (bExit) bExit.addEventListener('click', () => cfg.exit());

  if (bSearch && cfg.search) {
    bSearch.addEventListener('click', () => {
      /* The same button closes it again. On the wallpaper Escape does not
         arrive, so a search panel with no way back would cover the planet for
         good. */
      if (cfg.search.isOpen()) { cfg.search.close(); return; }
      cfg.search.open();
      drawQuick();
    });
  } else if (bSearch) {
    bSearch.hidden = true;                // index.html has no address search
  }

  /* ---------------------------------------------------------------------
     PLAY — one button that is two verbs, because it is never both at once
     On the desktop it opens the kiosk; inside the kiosk it is the way back
     out. In an ordinary browser tab it stays hidden: that tab already has a
     keyboard, and a button offering one would be a lie about what it does.
     ------------------------------------------------------------------ */
  if (bPlay) {
    if (play) {
      bPlay.textContent = 'back to desktop';
      bPlay.setAttribute('aria-label', 'back to desktop — close the full-screen window');
      bPlay.addEventListener('click', stopPlay);
      bPlay.hidden = false;
      showEscHint();
    } else if (wallpaper) {
      bPlay.setAttribute('aria-label', 'play — open this world full screen, with a keyboard');
      bPlay.addEventListener('click', () => startPlay(cfg));
      bPlay.hidden = false;
    }
  }

  /* Escape at the TOP LEVEL, and only there. Inside the kiosk the page's own
     Escape keeps every meaning it has always had — close the search, leave the
     interior, walk a city or the island back up to the globe — and exitLabel()
     returning nothing IS the statement "there is nothing left in here to
     leave". Only then does the key mean the WINDOW. On world.html and
     index.html exitLabel() never returns null (their top level is 'globe'), so
     Escape there costs one more press before the desktop comes back, which is
     the ladder the keys already described.

     CAPTURE PHASE, and that is not a detail. Measured 2026-09-07: with a plain
     bubble listener the FIRST Escape closed the caption AND killed the window
     in one press. globe.js, world.js and city.js all bind their own Escape on
     `window` in the bubble phase, so theirs ran first, hid the caption, and by
     the time this one asked exitLabel() the answer was already "nothing left" —
     the level it was supposed to read had been consumed a microsecond earlier.
     Capturing on `window` runs before every one of them, so the question is
     asked of the state the key ARRIVED in. */
  if (play) {
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (cfg.exitLabel && cfg.exitLabel()) return;   // the page still owns it
      stopPlay();
    }, true);
  }

  /* ---------------------------------------------------------------------
     THE QUICK LISTS — real addresses, drawn when the panel opens
     Built on open rather than at boot because on a cold globe the payload
     arrives seconds after the buttons do, and a list built too early is a
     list that is empty for the rest of the visit.
     ------------------------------------------------------------------ */
  function drawQuick() {
    if (!quick || !cfg.quickLists) return;
    const lists = cfg.quickLists().filter(l => l.items && l.items.length);
    quick.hidden = false;
    if (!lists.length) {
      /* Said in words rather than left blank: at this point the reader has
         clicked a button and is owed an answer about why nothing came back. */
      quick.innerHTML = '<p class="quick-empty">the world is still building — these fill in when it is up.</p>';
      return;
    }
    quick.innerHTML = '';
    for (const list of lists) {
      const sec = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = list.title;
      const row = document.createElement('div');
      row.className = 'quick-row';
      for (const item of list.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = item.label;
        b.setAttribute('aria-label', 'fly to ' + item.label);
        /* Clicking a row is exactly typing that address and pressing Enter —
           the same runSearch() the field calls, so a row can never go
           somewhere the typed query would not. */
        b.addEventListener('click', () => { cfg.search.go(item.query); cfg.search.close(); });
        row.appendChild(b);
      }
      sec.appendChild(h);
      sec.appendChild(row);
      quick.appendChild(sec);
    }
  }

  /* ---------------------------------------------------------------------
     THE POLL — keep the two labels true
     ------------------------------------------------------------------ */
  let lastTarget = null, lastExit = null, lastSearchOpen = null, lastSearchOn = null;
  function refresh() {
    if (bEnter) {
      const t = cfg.target ? cfg.target() : null;
      if (t !== lastTarget) {
        lastTarget = t;
        const word = oneWord(t);
        bEnter.disabled = !word;
        /* No leading space in the string: on narrow screens the span becomes an
           inline-block to get its ellipsis, and an inline-block eats a leading
           space — the phone capture read "entertakt-r…". The gap is a margin in
           controls.css instead, where it survives the display change. */
        if (targetSpan) targetSpan.textContent = word;
        bEnter.setAttribute('aria-label',
          word ? 'enter ' + word : 'enter — click a place on the map first');
      }
    }
    if (bExit) {
      const x = cfg.exitLabel ? cfg.exitLabel() : null;
      if (x !== lastExit) {
        lastExit = x;
        bExit.hidden = !x;
        if (x) {
          bExit.textContent = x;
          bExit.setAttribute('aria-label', x);
        }
      }
    }
    if (bSearch && cfg.search) {
      /* Optional, and only the island passes it: inside a landmark the address
         search would fly the WORLD camera while the room is still on screen,
         so the button greys out rather than doing something incoherent. */
      const on = cfg.search.available ? cfg.search.available() : true;
      if (on !== lastSearchOn) { lastSearchOn = on; bSearch.disabled = !on; }
      const open = cfg.search.isOpen();
      if (open !== lastSearchOpen) {
        lastSearchOpen = open;
        bSearch.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (quick) quick.hidden = !open;
      }
    }
  }
  refresh();
  setInterval(refresh, REFRESH_MS);
}

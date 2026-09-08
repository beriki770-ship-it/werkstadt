# Contributing to Werkstadt

## Run it

```
git clone <repo> && cd werkstadt && python server.py
```

Then open http://127.0.0.1:4949/globe.html. The other three pages are `world.html`, `index.html` and `recordings.html`.

There is no build step and no dependencies. `server.py` is Python standard library only; the pages are plain HTML, CSS and JavaScript, and three.js comes from a CDN. Edit a file, save, reload the browser — that is the whole workflow.

On first run the server writes `config.json` from `config.example.json`. `config.json` is gitignored, so never commit it and never put your own paths in `config.example.json`.

Serve the pages through `server.py`, not `python -m http.server`. Everything that reads live data goes through the `/api/*` endpoints, so a plain static server gives you a page with no data in it.

## Code conventions

These are the conventions this repo actually uses. `EDITING.md` at the root is the human-facing map of where things live; read the section for the page you are changing before you change it.

**Every HTML section carries `data-sid` and `data-title`.** `data-sid` is a short id; `data-title` says in plain words what the section is. For example:

```html
<aside id="tallies" data-sid="tallies" data-title="Running counts of files, tool calls and agents">
```

The same id is the hook in all three layers: the markup, the CSS selector and the JavaScript. Add a section, give it both attributes.

**CSS carries section banners with the same names.** A banner every so often, named exactly like the HTML section it styles, so one word finds both halves:

```css
/* =============================================================================
   TALLIES — running counts, top right
   ========================================================================== */
```

`city.js`, `replay.js`, `world.js` and `server.py` are divided by the same kind of banner.

**Comments explain WHY, not what.** The valuable comment in this codebase is the one that records a decision and the measurement behind it — why the bloom flash is capped at `0.55`, why the quiver tree is kept out of the harbour, why the in-flight test asks whether a subagent's transcript was written recently. If a comment only restates the line below it, delete it. If it stops the next person from undoing something that was measured, keep it and say what was measured.

**No numbers typed into the world.** Populations, building heights and counts are divisions of real data from the transcripts. If you need a new one on screen, derive it — do not hard-code a figure that looks about right. The caps and budgets (`LIFE_CAPS`, `PROP_SPEC`, `KIT_MAX_LOD0`) are the exception: they are frame-rate budgets applied after the data has spoken, and each one carries a comment saying what it cost.

**Match the surrounding style.** Keep the diff to what you came to change; no reformatting, no renaming and no drive-by refactors of code you happened to open.

## Reporting a bug

Open a GitHub issue with:

- what you did, what you expected, what happened
- your OS, Python version and browser
- the browser console output and anything `server.py` printed to the terminal
- a screenshot if it is visual

Do not paste transcript content, `config.json` or a screenshot with client paths and project names in it — see the Privacy section of the README. A redacted screenshot or a description is enough.

## What a pull request should include

- **One change per PR.** A rendering fix and a config change are two PRs.
- **What it changes and why**, in the description. If it changes a number, say what you measured to pick it.
- **Manual verification.** There is no test runner here, so say which pages you loaded, on what data, and what you looked at. If it is visual, attach a before and after.
- **The conventions above**, applied to whatever you added — `data-sid` + `data-title` on a new section, a banner on a new CSS block, a WHY comment on anything non-obvious.
- **`EDITING.md` updated** if you added or moved something a person would go looking for.
- **No new dependencies.** No build step, no package manager, no Python package. If you think a change genuinely needs one, open an issue first and argue for it.

## Licence

Contributions are accepted under the Apache License 2.0, the same licence as the project. By opening a pull request you agree your contribution is licensed under it.

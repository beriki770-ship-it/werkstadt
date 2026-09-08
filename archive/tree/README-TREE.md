# claude-live — the "tree" build

_Verified: 2026-09-05_

**Read this first: this folder is a complete, working, superseded build.**

It replays one Claude Code session as a **growing tree of files** with an orb per
agent flying between them. It was built on 2026-09-05 and finished — 60 fps, zero
console errors, all audits passing. While it was being finished, a second agent
working in the same `claude-live` folder replaced the project root with a different
visualizer (a **city** that builds itself) and moved this one here. Nothing in this
folder is broken or half-done; it is simply not the version at the root any more.

**Beri decides which one lives.** Nothing here should be copied back over the root
without that decision — the root is another agent's current work.

## Run it

```
cd <repo>\archive\tree
python -m http.server 4951
```

Open <http://127.0.0.1:4951/>. Port 4949 is contested — two agents both tried to
use it, which is worth knowing before debugging anything that "serves the wrong
page". 4646, 4747 and 4848 are taken by other tools.

`data/sample.json` here is a copy of the fixture, so this folder runs standalone.
`?src=` still overrides, and `../../data/demo.json` is the real 2,193-event export
if you serve the parent folder instead.

## Files

| file | what |
|---|---|
| `index.html` | the page shell; every section has `data-sid` + a plain-language `data-title`; studio seal injected (4 markers) |
| `styles.css` | palette tokens, floating typographic chrome, section banners named like the HTML |
| `app.js` | the engine — radial-wedge tree, agent orbs, per-tool beam grammar, idle breathing, transport keys, `ingest()` + live `EventSource` |
| `data/sample.json` | dev fixture, 48 events, labelled as a fixture in its own `_fixture` field |
| `shots/` | reference captures at 5 s / 30 s / 90 s, 1440×900 |
| `EDITING.md` | for humans: where things live, what not to touch, how to undo |
| `HANDOFF.md` | state, every design decision and why, open items, gotchas |
| `RUNBOOK.md` | run it, check it, capture it, and the live-server contract |

## The 60-second version

- Three files, no build step, **zero dependencies**. Only external requests are two
  Google Fonts.
- Canvas 2D. Files and directories appear the first time an event touches them and
  spring outward on an elliptical radial tree.
- Every tool call fires a beam from the agent's orb to the file: reads thin and
  cool, writes thick and warm leaving an ember, searches fan out, shell commands
  strike the project root.
- **Nothing on screen is invented.** The three tallies count events that actually
  arrived; after two silent seconds the field dims and the orchestrator's breathing
  slows, so silence reads as thinking.
- One function, `window.ingest(event)`, is the only way anything reaches the
  screen. Replay and the live `EventSource` both call it.

# Editing this page — for humans

This is the page that replays a Claude Code session as a **growing tree of files**.
Three files, no build step, no framework. Open them in any editor, save, reload the
browser. That is the whole workflow.

(There is a second, different visualizer at the project root — a city. This folder
is the tree. They are not the same page and do not share code.)

## Where things live

| I want to change… | open | look for |
|---|---|---|
| a colour | `styles.css` | the `TOKENS` block at the top — every colour on the page and on the canvas comes from those six variables |
| a font | `styles.css` | `--mono` and `--display`, plus the Google Fonts `<link>` in `index.html` |
| the text in the corners | `index.html` | the sections are labelled: `MASTHEAD`, `TALLIES`, `TICKER` |
| how a tool looks when it fires | `app.js` | the `FAMILY` table near the top — one line per tool name |
| how fast things fade | `app.js` | `step()` — the two `Math.pow(…, dt)` lines control how long a touched file glows |
| how spread out the tree is | `app.js` | `relayout()` — `rx` and `ry` |
| how much dead time is skipped | `app.js` | `DEAD_AIR` and `IDLE_HOLD` just above `advance()` |

Every section in `index.html` carries `data-sid` (a short id) and `data-title`
(what the section is, in plain words). The same names are used as banner comments
in `styles.css`, so you can search one word and find both halves.

## What not to touch

- **The `WDM-SEAL` blocks in `index.html`.** That is the studio signature. It is
  generated — edit it and the next run of the seal tool will fight you.
- **`ingest()` in `app.js`.** Everything that puts something on screen goes through
  that one function. Change its shape and the live server and the replay files both
  stop working.
- **The field names in `data/*.json`.** They come from the exporter. Renaming one
  here does not rename it there.

## How to run it

You cannot just double-click `index.html` — the browser blocks a page from reading
a local `.json` file. Serve the folder instead:

```
cd archive\tree
python -m http.server 4951
```

Then open <http://127.0.0.1:4951/>. Avoid port 4949; something else in this project
uses it and you will be shown the wrong page with no error.

## How to undo

Nothing here writes to disk and nothing is stored on a server. The only thing the
page remembers is whether you have already seen the keyboard hints, kept in your
own browser. To see them again, open the browser console and run:

```js
localStorage.removeItem('claude-live.hints-seen')
```

If an edit goes wrong and there is no backup, the three files are small enough to
read end to end — every non-obvious line has a comment saying **why** it is there.

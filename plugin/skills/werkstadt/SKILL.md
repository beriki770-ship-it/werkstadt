---
name: werkstadt
description: Open Werkstadt, the live 3D world of the user's Claude Code sessions - a planet where every project is a settlement, an island with a harbour, and one session drawn as a city. Use when the user says "open werkstadt", "show me the world/planet/city", "watch this session build", "start the session visualiser", or asks what Werkstadt is and whether it is safe to run. Starts the local server if it is not already listening, opens the page, and can explain the privacy model.
---

# Werkstadt

A live 3D world for Claude Code sessions. It reads the JSONL transcripts Claude
Code already writes, read-only, and draws them as places. Everything runs on
this machine: a Python standard-library server bound to `127.0.0.1` and a
browser page. Nothing is uploaded and there is no account.

## 1. Find the checkout

Werkstadt is a repository the user clones, not something this plugin carries.
Take the first of these that contains a `server.py`:

1. `$WERKSTADT_DIR`
2. `${CLAUDE_PLUGIN_ROOT}/../..` — true when the plugin was installed from a
   clone of the repo itself, which is the normal case
3. ask the user for the path, and suggest
   `git clone <repo> werkstadt` if they do not have one yet

Do not guess a third location and do not create one.

## 2. Start the server if it is not already up

The port is `port` in `config.json` (4949 unless the user changed it). Check
before starting anything — a second server on the same port fails to bind and
the first one is already serving.

```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4949/api/config.js
```

`200` means it is running: skip to step 3. Anything else, start it from the
checkout, in the background, and let it settle for a few seconds:

```bash
cd <checkout> && python server.py --no-browser
```

Needs Python 3.9 or newer and nothing else — no pip install, no build step. On
first run it writes `config.json` from `config.example.json`, so there is no
setup step to walk the user through.

## 3. Open a page

Tell the user the URL and open it (`--no-browser` above was so that *you*
decide which page, not the server):

| page | what it shows |
|---|---|
| `http://127.0.0.1:4949/globe.html` | every project ever worked in, as one planet — the usual starting point |
| `http://127.0.0.1:4949/world.html` | the same data as one island with a harbour |
| `http://127.0.0.1:4949/index.html?project=<town id>` | one project's sessions as a city, live |
| `http://127.0.0.1:4949/recordings.html` | finished sessions rendered as MP4 films |

Town ids come from `GET /api/world` (`towns[].id`). For "watch what you are
doing right now", open `globe.html` — the town that is currently alive is
labelled and lit.

## 4. The privacy model, in one paragraph

Werkstadt reads `~/.claude/projects/**/*.jsonl` read-only and writes only
inside its own folder; the server binds `127.0.0.1`, so nothing outside this
machine can reach it, and there is no telemetry, no account and no upload path
of any kind. What it draws, though, is made of real names: project folders,
session prompts and absolute file paths appear on screen as labels, so a
screenshot, a screen share or the desktop wallpaper mode deserves the same
care as terminal scrollback. For those cases set `"redact": true` in
`config.json`, or start it with `python server.py --redact`: every project
name, session title, file path, task tag and agent label is then replaced by a
stable pseudonym (`town-3f9a`, `session-7c21`, `dir-04ab/file-9e12.css`)
before it leaves the server, prompt text is dropped rather than pseudonymised,
and file contents, page previews and project favicons are not served at all.
The world keeps its shape — same towns, same streets, same buildings — it just
no longer says whose they are.

## Notes

- Never edit anything under `~/.claude/projects/`. Werkstadt does not, and
  neither should you while working with it.
- Recordings are MP4 files under `recordings/` on this disk. There is no share
  button and no hosted gallery; deleting the file is the whole of the deletion
  process.
- Windows extras (desktop shortcut, autostart, screensaver) are opt-in and
  never automatic: `python server.py --install-windows`.

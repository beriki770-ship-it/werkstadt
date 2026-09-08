# Werkstadt 0.1.0

_Verified: 2026-09-08_

Werkstadt turns the session transcripts Claude Code already writes on your
machine into a place you can fly through. It reads
`~/.claude/projects/**/*.jsonl`, read-only, and draws it three ways:

- **A planet.** Every project you have ever worked in is a settlement. A file
  you touched once is a hamlet, a repo you have lived in for a year is a city.
  Which continent a project lands on is a rule you write yourself.
- **An island.** The same data as one landmass with a harbour — a quarter per
  project, roads for the links between them, cranes and ships on the water.
  Point it at an Obsidian vault and the notes become the geography.
- **A city.** One project, live. Each street is a session, each building a file,
  and a building that is being written right now stands in a red rig. You can
  walk into one and read the file on its walls, 66 lines to a floor.

There is also a shelf of MP4 films the server renders from finished sessions,
and a wallpaper mode that Lively paints behind your desktop icons.

## Running it

```
git clone https://github.com/<your-github-account>/werkstadt && cd werkstadt
python assets/fetch_assets.py --release
python server.py
```

Python 3.9 or newer. No `pip install`, no `npm install`, no build step. The
server is `server.py` and it uses the standard library and nothing else; the
pages are plain HTML, CSS and JavaScript with three.js from a CDN. Edit a file,
reload the browser.

The middle line fetches the asset library — 100 MB of textures, HDRIs and
models, attached to this release as `werkstadt-assets-v1.zip` and checked
against its SHA-256 on the way in. Skip it and the world still opens, untextured
and with empty streets, and the server says so at startup.

## Your transcripts stay on your machine

The server binds `127.0.0.1` by default. Nothing is uploaded, there is no
telemetry, no account and no network call except the CDN that serves three.js
and the one download above.

`--redact` (or `"redact": true` in `config.json`) replaces every name that came
off your disk with a stable pseudonym before it leaves the process: a project
becomes `town-3f9a`, a session `session-7c21`, a file
`dir-04ab/dir-91ff/file-9e12.css`. Prompt and message text is dropped rather
than pseudonymised, because a sentence has no pseudonym, and file contents are
not served at all. The pseudonym is `blake2s(name)[:4]` with no salt, so the
same folder is the same town on any machine — which is what lets two
screenshots taken a month apart still agree. Three of the five README
screenshots were taken this way.

## As a Claude Code plugin

```
/plugin marketplace add <your-github-account>/werkstadt
/plugin install werkstadt@werkstadt
```

The plugin adds a `werkstadt` skill that finds your checkout, starts the server
if nothing is listening, opens the page and can explain the privacy model. It
does not carry the world — the repository is still what you clone.

## What is in this first release

- The four views, the two SSE feeds that keep them live, and the three showcase
  pages (`buildings.html`, `drones.html`, `life.html`) that each module is
  developed against.
- A living layer on the city streets: traffic that follows and gives way,
  pedestrians that use the crossings, herds, flocks, and one robot per agent in
  flight carrying that agent's task tag. Every population on screen is a
  function of the data — 120 people is the session count, not a number somebody
  typed in.
- `redact`, the launcher for Windows, and systemd and launchd units in
  `docs/RUNBOOK.md` for everyone else.
- A demo session in `data/demo.json`, so `index.html` has something to play
  before you have pointed it at a project of your own. It is a real 55-second
  Claude Code session exported with `tools/export_replay.py` — ten tool calls,
  one of which fails, which is what puts an ambulance on the street.
- An asset set that is entirely CC0 (Kenney, Quaternius, Poly Haven) plus one
  model of the studio's own. `assets/CREDITS.md` has the licence table.

## Known limits

- The Windows launcher chain — the scheduled tasks, the screensaver watcher,
  the Lively wallpaper entry — is written and has never been run end to end.
  `--install-windows` is opt-in and never fires on its own.
- The systemd and launchd units are written from the code and untested; the
  author's machine is Windows.
- Four subjects have no CC0 model and fall back to procedural shapes: a parrot,
  a chicken, a bus shelter and a playground. Filling one is a line in
  `assets/manifest.json` and no code.
- On `life.html?stress=1`, which deliberately asks for more traffic than the
  road network holds, one or two vehicles can briefly overlap at the crossroads
  while the side street is gridlocked. It is 45 to 75 frames in 600 and it is
  in `docs/TESTS.md` with the measurement.
- The demo session's masthead line is the prompt that was actually typed, so it
  opens "Reply in English only". It is a verbatim export and it was left
  verbatim; `docs/DECISIONS.md` says why.

Licence: Apache-2.0. Built by [Wild Digital
Moments](https://digital.wildmoments.at/).

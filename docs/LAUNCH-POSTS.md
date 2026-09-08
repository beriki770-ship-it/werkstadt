# Launch drafts

_Verified: 2026-09-08_

Four drafts for Beri to post himself. Nothing here is scheduled or automated.
Read each one against the live repository first — if the known-limits list in
`docs/RELEASE-NOTES.md` has changed by the day of posting, these change with it.

The rule that shaped all four: say what it does and what it does not do. A tool
that reads your session transcripts has to be boring and specific about privacy
or nobody sane installs it.

---

## Show HN

**Title** (80 chars max, no "I built"):

```
Show HN: Werkstadt – your Claude Code sessions as a 3D city you can walk through
```

**Text**:

```
Claude Code writes a JSONL transcript for every session on your disk. I wanted
to see what a year of those looks like as a place instead of a folder.

Three views: a planet where every project is a settlement sized by the work
that went into it, an island where an Obsidian vault becomes the terrain, and
one project as a city — a street per session, a building per file. Walk into a
building and its source is on the walls.

Runs on your machine: Python standard library, bound to 127.0.0.1, no account,
no telemetry. --redact swaps every name off your disk for a stable pseudonym,
which is how three of the README screenshots were taken.
```

Post as `Show HN` with the URL field set to the repository and the text above as
the first comment. Weekday morning US time. Do not reply to the first sceptical
comment for at least an hour, and when you do, answer the privacy question with
the `--redact` table rather than a paragraph.

---

## r/ClaudeAI

**Title:**

```
I made a thing that draws your Claude Code sessions as a 3D world (local only, Apache-2.0, no account)
```

**Body:**

```
Claude Code already writes every session to ~/.claude/projects as JSONL. This
reads those files, read-only, and draws them.

- globe.html — every project you have ever worked in, as one planet. A repo you
  have lived in a year is a city; a folder you touched once is a hamlet.
- world.html — the same data as an island. Point it at an Obsidian vault and the
  notes become the land.
- index.html — one project, live. Street = session, building = file. A file being
  written right now is in a red rig. You can walk inside and read the source off
  the walls.

It also renders MP4s of finished sessions, and there's a wallpaper mode.

Install is a clone, one asset download and `python server.py`. Python 3.9+,
nothing to pip install, no build step. There's a Claude Code plugin too:
/plugin marketplace add beriki770-ship-it/werkstadt

Privacy, because it matters here: the server binds 127.0.0.1, there is no
account and no telemetry, and `--redact` replaces every project name, session
title and file path with a stable pseudonym before anything reaches the browser.
The screenshots in the README are taken that way.

Apache-2.0. Honest known limits are in the release notes — the Windows launcher
has never been run end to end, and four of the models are still procedural
because no CC0 equivalent exists.

https://github.com/beriki770-ship-it/werkstadt
```

---

## LinkedIn

English, one post, no hashtag wall. Attach `docs/shots/globe-planet.png`.

```
Claude Code leaves a JSONL transcript of every session on your disk. Mine go
back about a year, which is a lot of folders and no picture at all.

So I built the picture. Werkstadt reads those transcripts and draws them three
ways: a planet where every project is a settlement sized by how much work went
into it, an island where an Obsidian vault becomes the terrain, and a single
project as a city where each street is a session and each building is a file
you touched. Files being written right now stand in a red rig. You can walk into
a building and read its source off the walls.

It runs entirely on your own machine — Python standard library, bound to
localhost, no account, no telemetry — and a --redact flag swaps every name off
your disk for a pseudonym, which is how the screenshots were taken.

Open source, Apache-2.0, free:
https://github.com/beriki770-ship-it/werkstadt
```

---

## awesome-claude-code

One line, alphabetical inside whichever section fits (Tools / Visualization). PR
title: `Add Werkstadt`.

```
- [Werkstadt](https://github.com/beriki770-ship-it/werkstadt) — Renders your local Claude Code session transcripts as a 3D world: a planet of projects, an island, and one session as a walkable city. Python stdlib server, runs offline, has a redaction mode.
```

Check the repository's CONTRIBUTING first — some of these lists want the entry
in a YAML or JSON manifest rather than in the README, and a PR that edits the
generated file gets closed.

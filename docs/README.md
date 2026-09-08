# Werkstadt — docs index

_Verified: 2026-09-08_

This is the index of the `docs/` folder only. **The public front page is the
`README.md` at the repository root** — what Werkstadt is, how to install it and
how to run it. Start there. Come here when you are working on the code.

| file | what it is for |
|---|---|
| `README.md` | this index |
| `HANDOFF.md` | pick the project up: what this repo is, the four-phase release plan, exactly what phase A did, the known gaps, and a file map |
| `DECISIONS.md` | why the code looks the way it does — one entry per real choice, each with its reason, the alternative that was rejected, and what it cost |
| `HOW-IT-WORKS.md` | one read of the system: transcripts in, three views out |
| `RUNBOOK.md` | running and operating it — start, restart, the wallpaper and screensaver, phone access, and the traps that cost someone a day |
| `TESTS.md` | what has been verified and how you re-run it: the CDP screenshot harness, the debug probes, the acceptance criteria per view, and what is *not* verified against this fork |
| `BUILDINGS.md` | `buildings.js`, the procedural building generator — the LOD ladder, the facade bake, its own showcase page |
| `DRONES.md` | `drones.js`, the aircraft kit — airframes, LOD bands, variant rigs, its own showcase page |
| `LIFE.md` | `life.js`, the living layer — cars, people, animals, the pavement graph, the crowd solver, and its known limits |
| `shots/` | eight reference screenshots the checks in `TESTS.md` refer to by name |

Two conventions worth knowing before you edit anything here. Filenames are
fixed and never dated — a superseded document goes to `docs/archive/`, it does
not become `HANDOFF-v2.md`. And every file carries a `_Verified:` stamp near the
top: bump it when you change the file, so a reader can tell at a glance whether
the doc is older than the code.

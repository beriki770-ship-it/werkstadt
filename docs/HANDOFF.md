# Handoff — Werkstadt (the public repo)

_Verified: 2026-09-08_

## What this repo is

Werkstadt is a live 3D world for your Claude Code sessions. It reads the JSONL
transcripts Claude Code already writes on your machine, read-only, and draws
them as places: a planet where every project is a settlement, an island where a
note vault is the land and the projects are a harbour, and a project city where
one street is one session and a building is a file. A small standard-library
Python server serves the pages and two SSE feeds, so the world updates while you
work.

This is the **public fork**. It was cut out of a private single-machine install
called Claude Live and is being released under the name Werkstadt. Everything
below describes this tree, not the one it came from.

---

## The accident finishes, and there is a demo to watch it in — 2026-09-08 (later)

Two things happened after phase D. The private install this fork was cut from
kept working on the same morning and fixed the living layer's accident; those
fixes are ported here. And gap 8 — the two 404s a bare `index.html` produces —
is closed by shipping a real demo session in `data/demo.json`.

### The four fixes ported from the private install

Ported by hand rather than by merge: the fork's own phase-A/B changes sit in the
same functions (the rename, `config.json`, the CC0 catalogue, the vehicle
`length` dial and the tolerant loaders), and all of those are kept.

**1 · `life.js` — the accident is bounded now, and it moves to the victim.**
Six new constants above `_stepAccident`, each named for the failure it closes:
`ACCIDENT_NEAR` (12 m), `APPROACH_GRACE` (4 s), `APPROACH_DRIVE` (9 m/s),
`APPROACH_BACK` (10 m), `ACCIDENT_MAX` (75 s) and `AMB_RUN` (70 m). What they
fix, measured on the install this came from:

- `reportError()` put the impact on the lane nearest the ERROR and then took the
  actor nearest THAT, so on a sparse street the victim could be 126 m away and
  the collision could never happen. `_nearestLane()` was lifted out of
  `reportError()` so the impact can be **re-seated on the lane point nearest the
  victim** when the two are further apart than `ACCIDENT_NEAR`. Dense streets are
  untouched: `life.html` measures 0–4 m and never re-anchors.
- `approach` ended only on contact, and a car in traffic is not guaranteed to
  arrive. After `APPROACH_GRACE` the accident drives the car in itself
  (`_forceApproach()`), after `_stepVehicles` has run so the two passes cannot
  fight over the arc length. If the host has popped the car out of
  `life.vehicles` the victim collapses where it stands (`_collapseVictim()`) and
  the ambulance still comes. `ACCIDENT_MAX` tears down anything still wedged, so
  the exclusive slot is freed and the next error can stage.
- the ambulance entered at the lane's nearest END — 778 m on a city avenue,
  sixty seconds of siren before `arrived` began. `AMB_RUN`, clamped to the lane
  end, gives a long lane five seconds and leaves a short one exactly as it was.
- `_endAccident()` is the single teardown, called by the end of `clear` and by
  the watchdog.

**2 · `city.js` — the crowd fit no longer throws the victim away.**
`setLifePopulation()` refits the crowd every 1.4 s and pops surplus people into
a reserve; the crashed body was in that fit and came back out on another avenue,
measured 422 m from the wreck the ambulance was still attending. An actor with
`a.crash` is kept and left where it is. Also new here: `lifeRate` /
`setLifeRate()` (see 3), `standAt()` lifted unchanged out of `__lifeStand` so
both hooks use one lens, and `window.__lifeAccident(stand, back, bearing)` —
where the incident is in city units, which stage it is in, and optionally the
free-fly pose on it.

**3 · `replay.js` — a recording's crowd runs at the film's speed.**
One line in `startRecord()`: `City.setLifeRate(clock.speed)`. A record frame is
worth a fixed 1/30 s of film but the transport advances the session clock by
`clock.speed` times that, and the crowd is the one layer paced off wall time, so
it ran the accident at a fraction of the speed of the film around it.
`life.update()` clamps the product to 0.08 s itself, so the ceiling is 2.4× a
record frame and nothing teleports. Live pages are unaffected — `lifeRate` is 1
everywhere else.

**4 · `globe.js` — `?signs=<name>` draws one plaque.**
Two lines: `SIGNS_ONLY` beside the other capture flags and one `continue` in
`buildSigns()`. It filters the sign LAYER only — the planet, its settlements and
the HUD's own count are untouched. It exists because a film of this planet at
label size publishes the directory name of every project on the machine.
Measured here: signs built **31 → 1**.

**What was NOT ported.** Everything else in the private tree's diff is that
tree's own: the Hunyuan catalogue and its `face` values, the hard-coded home
directory and continent table, the Wild Moments parrot rule, the strict asset
loader. The fork's versions of all of those stay.

### The demo fixture — gap 8 closed

`data/demo.json` is a **real** Claude Code session, run once for this purpose in
a throwaway English project and exported with this repo's own
`tools/export_replay.py`. 32 events, 10 tool calls, 5.4 KB. The session reads
four files, writes four, reads one that does not exist — that failing `Read` is
what stages the accident — and writes a note about it.

It is not redacted, and DECISIONS says why: redaction would turn every building
into `file-9e12.md` and the town into `town-3f9a`, which is the opposite of what
a first-run demo is for. What the fixture carries instead is a project that has
nothing private in it, with the one machine-specific thing in an export — the
absolute path — rewritten to `C:/projects/widget-shop` before it was committed.
A grep over the file for the real username, `Desktop`, `Users` and other
OS-specific profile folder names returns zero. The throwaway project and its
transcript were deleted afterwards.

`data/sample.json` is deliberately still absent: `replay.js` probes `demo.json`
first and never reaches the second name, so a bare `index.html` is now **zero**
4xx and zero console errors.


## The release plan

Four phases. **A, B and C are done. D is prepared but NOT pushed** — there is
still no GitHub repository. `docs/PUBLISH.md` is the remaining three commands.

### Phase A — get it out of the private install (done)

Fork the tree; extract every machine-specific setting into
`config.json` / `config.example.json` / `config/trades.json`; strip private
paths; rename Claude Live to Werkstadt throughout; apply the studio seal and the
credits/sponsor layer; write the public docs; `git init` with no push.

### Phase B — assets (done)

Every `model.hy.*` key refilled from CC0 packs, `Life.load()` made tolerant of a
model it does not have, and the 100 MB asset library moved out of git into a
release zip. See "What phase B did" below.

### Phase C — `redact`, the launcher and the plugin (done)

`redact` implemented, a cross-platform first run, a Claude Code plugin wrapper,
and a second privacy pass over the screenshots. See "What phase C did" below.

### Phase D — prepare the publish (done, except the push)

Squash the history, fix the vehicle scale phase B measured and left open, prove
the whole thing from a clone that has never seen this machine, and write the
publish kit. The GitHub repository, the push, the release and the posts are
deliberately NOT done: the account was not confirmed when phase D ran. See
"What phase D did" below and `docs/PUBLISH.md`.

---

## What phase D did

Verified against this tree, not from memory. **Nothing was pushed and no
GitHub repository exists.** Phase D is the preparation; `docs/PUBLISH.md` is
the rest of it, written so the publish is three commands.

**The history is one commit again.** `main` is a single orphan commit,
`Werkstadt 0.1.0 — a live 3D world for your Claude Code sessions`, holding the
whole tree. The five phase A-C commits live on the local branch `pre-squash`
and are not pushed. The reason is `git count-objects`: the first of those
commits carried the 103 MB asset library before phase B moved it out of git,
and that read **100.78 MiB** of loose objects. A single-branch `--no-local`
clone of the new `main` fetches a **13.59 MiB** pack and checks out a 17 MB
tree, 94 files. The local `.git` is still ~101 MB and stays that way as long as
`pre-squash` exists — that is one machine paying instead of everybody who
clones, and `git branch -D pre-squash && git gc --prune=now` is the whole of the
cleanup if it is ever wanted. See DECISIONS, "The old history is a local branch".

**The CC0 vehicles are the right size.** Phase B's note ended "worth
revisiting: either the vehicles are scaled up, or lane capacity stops being a
pure function of vehicle length." It is the first, and it needed a second dial
rather than a bigger `height`: the five road-vehicle rows in `life.js`'s `RIGID`
catalogue now carry a `length` in real metres — car 4.30, van 5.20, pickup 5.30,
box lorry 9.00, tractor 4.00 — which `_buildRigid()` applies as a stretch along
the model's long horizontal axis after the uniform height fit. `life.html?stress=1`
places **54 vehicles and drops 26**, which is exactly what the private install
did; before the change it was 76 and 4. `docs/shots/cc0-street-scaled.png` is
the result. The manifest was NOT touched, and DECISIONS says why: `heightUnits`
and `extentUnits` are measurements the fetcher writes, nothing sizes anything
from them, and the fetcher would overwrite an edit on its next run.

**One thing the scale change made worse, and it is not fixed.** The 600-frame
overlap probe on the stress scene goes from 0 bad frames to 45-75, never more
than two pairs at once. It is always the same thing: `?stress=1` asks for 80
vehicles on a network that holds 54, the side street gridlocks, a vehicle that
entered the junction box on a green stops with its tail in the crossing
carriageway, and the longer body now reaches far enough to touch a car going
past. Two candidate fixes were implemented, measured and **reverted** — one
made no difference, one made it worse. `docs/TESTS.md` 12.1 has both numbers and
the captured vehicle states. The real fix is a junction model that can clear
its own box, which is a different job from sizing a car.

**A clone was proved end to end.** `git clone --no-local` into a temp
directory, the release zip beside it and `RELEASE_URL` pointed at a `file://`
URL for the test: the fetcher downloaded, verified the SHA-256 and unpacked 100
files; the server wrote `config.json` on first run; all four pages opened with
**zero console errors**. The hash gate was proved by breaking it on purpose —
a wrong digest exits 3 and leaves the zip on disk. With `assets/` removed the
four pages still open with zero console errors and 86 asset 404s, and
`_assets_unpacked()` returns False so the startup hint fires (the print itself
is gated on `sys.stdout.isatty()`, so it does not appear when stdout is
redirected — that is by design and it is why the predicate was tested rather
than the line). `--redact` was re-checked on that clone: `home` becomes `~`,
towns become `town-7f97`, and a grep for the real username, `Desktop`, other
OS-specific profile folder names, four real project names and any Hebrew
character over 104 KB of API response returns zero hits.

**One expected failure in that run.** `index.html` opened with no `?src=` and
no `?project=` produces two 404s — `data/demo.json` and `data/sample.json` —
because `replay.js` probes for the fixtures phase A deliberately removed. The
page handles it and prints "No session to replay yet", so the behaviour is
right and only the console is untidy. Left alone on purpose: editing
`replay.js` is outside what phase D was asked to touch. It is a two-line
decision — ship a small public fixture, or drop the two probes.

**The plugin was installed and removed again, from the clone.** Both manifests
validate, `claude plugin marketplace add <clone>` registered it,
`claude plugin install werkstadt@werkstadt --scope local` installed it, and the
skill appeared at `~/.claude/plugins/cache/werkstadt/werkstadt/1.0.0/skills/werkstadt`.
Then all of it was removed and the machine checked: marketplaces before and
after are `trailofbits` and `ponytail`, installed plugins 7 and 7, and the
download cache is gone. The remote form, `/plugin marketplace add owner/repo`,
still cannot be tested — that is step 6 of `docs/PUBLISH.md`.

**The publish kit.** `docs/PUBLISH.md` (the exact `gh` commands, and a table of
the six placeholder lines with their file and line number), `docs/RELEASE-NOTES.md`
(the v0.1.0 text, with a real known-limits section) and `docs/LAUNCH-POSTS.md`
(Show HN, r/ClaudeAI, LinkedIn and one `awesome-claude-code` line, for the
maintainer to post). `gh auth status` on this machine reports a personal
account, scopes `gist, read:org, repo, workflow` — nothing was created and
nothing was logged in.

---

## What phase A actually did

Verified against this tree, not from memory.

**Configuration extracted.** `config.example.json` is the schema and ships 12
settings with a `_comment_*` key documenting each: `transcripts_root`, `vault`,
`host`, `port`, `auth_secrets`, `recordings_dir`, `trades_file`,
`project_names`, `excluded_dirs`, `continents`, `aviary_projects`, `redact`.
`server.py` grew a `CONFIGURATION` section (from line ~63): `load_config()`
copies the example to `config.json` on first run, merges user keys over the
example's own values so an older `config.json` keeps working when a key is
added, and `_cfg_path()` expands `~`, accepts either slash, and resolves a
relative path against the repo rather than the process's cwd. Consumers are
wired through: `PROJECTS_DIR`, `VAULT_DIR`, `AUTH_SECRETS_PATH`, `TRADES_PATH`,
`RECORDINGS_DIR`, `PROJECT_NAMES`, and the excluded-directory set.

**The trade table became a file.** `config/trades.json` (4.4 KB) is a commented
regex → schema.org-type list loaded by `_load_trade_table()` into
`KEYWORD_TRADE_TABLE`. If it cannot be read the server names the file and
detects no trades rather than falling back to a hidden built-in copy.

**The client gets its own slice of the config.** `handle_client_config()` in
`server.py` serves `GET /api/config.js` as a `<script>` — not JSON over
`fetch` — because `globe.js` needs the continent rules before its first frame.
Exactly four keys leave the process: `home` (lower-cased, forward slashes),
`continents`, `aviary_projects`, `redact`. `no-store`, so editing `config.json`
and reloading is the whole of "apply my settings".

**The client half.** `globe.js` reads `window.WERKSTADT_CONFIG` into `CFG`
(line ~267) and `continentOf()` (line ~284) resolves a town's continent from the
ordered `path_contains` rules, first match wins, returning `null` for anything
outside your home directory so it is drawn as an offshore island. `AVIARY_RE`
(globe.js ~5298, world.js ~3634) compiles the optional `aviary_projects` regex —
empty by default, so no bird appears anywhere — and warns instead of throwing on
a bad pattern. Both files carry `|| {}` fallbacks so a page still opens straight
off the filesystem with no server.

**Private paths stripped.** `tools/export_vault.py` has no default vault path at
all; `--vault` is required when it runs standalone, and `server.py` sets
`VAULT_ROOT` from config before calling into it. `launcher/install.ps1` uses
`$env:USERNAME` rather than a hard-coded account. `.gitignore` keeps
`config.json`, `data/auth.json`, `*.secret`, the whole of `data/.cache/`,
`data/vault.json`, `data/world-index.json`, `recordings/`, `launcher/*.log`,
`launcher/kiosk-profile/`, and the asset working caches including
`assets/hunyuan/`.

**Renamed.** The launcher scripts, the scheduled-task names, the shortcut, the
icon and the server's log name are all Werkstadt. Three stragglers remain — see
Known gaps.

**Seal and credits applied.** All nine HTML files carry the four invisible seal
layers (`meta generator`, `meta author`, `link rel="author"` → `humans.txt`, and
a JSON-LD `WebSite.creator` block). Eight of them also carry the body block with
the 1px W mark; `vault.html` does not, and should not — it is a two-line
redirect to `world.html?focus=vault`. The four main views —
`globe.html`, `world.html`, `index.html`, `recordings.html` — additionally load
`credits.css` and carry the console signature, the `<footer class="credits">`
line ("Built by … · Hire us · Sponsor"), a `.sponsor-btn` in the masthead and,
on the three 3D pages, a `.sponsor-chip` in the controls cluster. `credits.css`
is its own file loaded *after* each page's stylesheet, positioned bottom-centre
because the bottom-left corner is the mark and caption and the bottom-right is
the controls.

**Docs written.** `docs/` now holds a public README index, this handoff,
trimmed DECISIONS and TESTS, plus HOW-IT-WORKS, RUNBOOK and the three module
docs. `docs/shots/` was cut to eight reference frames.

**Git.** `git init` on branch `main`. **Zero commits, no remote, nothing
staged** — everything is still untracked. Phase D is where that changes.

---

## What phase C did

Verified against this tree, not from memory.

**`redact` works.** `server.py` grew a `REDACTION` section (from the line after
`DELETE_RECHECK_SECS`) with the pseudonym helpers and one redactor per payload
shape. `REDACT` is `config.json`'s `redact` unless `--redact` overrides it for
the run. A pseudonym is `blake2s(real.lower())[:4]` and nothing else — no salt,
no per-machine seed — so the same folder is the same `dir-7c21` on every machine
and across restarts, which is what lets two films made a month apart still agree
with each other.

| what | becomes |
|---|---|
| project / town name | `town-3f9a` |
| session title, street sign | `session-7c21` |
| file path | `dir-04ab/dir-91ff/file-9e12.css` — structure and extension kept |
| drone task tag, agent label | `task-6ab7` (`Orchestrator` is kept: the code emits it, your disk does not) |
| a town's path | `~/projects/town-3f9a`, keeping only the `path_contains` fragment out of your own `continents` rules, because `globe.js` reads that to pick a continent |
| prompt text, message text, tool-input summaries | dropped — there is no pseudonym for a sentence |
| file contents, page previews, favicons, note titles | not served |

**Applied at the response boundary, not inside the builders.** The
HANDOFF's original phrasing was "at ingest", meaning server-side rather than a
display filter in three renderers — that part holds. It is not inside
`build_world_static()` / `cached_build_replay()` / the trade cache, though,
and deliberately: those three persist to `data/.cache/`, and a redacted run
must not leave pseudonyms in a cache a later normal run reads back as truth.
The boundary is also the only provably complete place — `_send_event()` is the
single writer for all four SSE feeds, so one branch there covers every live
message that will ever reach a browser.

Call sites: `_send_event`, `handle_world`, `handle_sessions`, `handle_project`,
`handle_project_meta`, `handle_recordings`, `handle_project_asset` (403),
`handle_project_file` and `handle_project_tree` (a notice instead of contents),
`handle_vault_search` / `handle_vault_note` / `/data/vault.json` (empty),
`handle_client_config` (`home` becomes `~`, `aviary_projects` empties), and
`_build_recording_candidates()` — that last one is the true ingest point, since
`recorder.py` builds the folder name, the file stem and the film's title card
out of the two strings it hands over.

Verified: a probe hit 39 routes plus three SSE feeds on a redacted server and
grepped every byte for the 173 real town names and path segments taken from an
unredacted `/api/world` snapshot, plus the real username, `Desktop` and other
OS-specific profile folder names, plus any Hebrew character. **Zero hits.** The thirteen matches it does report
are `site` inside the key `"site_url"`, `site` inside a random `toolu_…` id,
and the `.claude` / `tools` fragments of the shipped `continents` rules.
`docs/shots/redact-city.png` is the same server seen from the pilot's seat.

**First run is now the same on every platform.** `python server.py` with no
arguments writes `config.json`, prints its URL, and opens `globe.html` in the
default browser after the socket actually accepts (a thread that polls the port,
because opening the browser before `serve_forever()` gets a refused connection
often enough to matter). `--no-browser` suppresses that. `--install-windows`
runs `launcher/install.ps1` and exits — the Windows extras are opt-in and were
never automatic, and now there is one entry point that says so.
`MIN_PYTHON = (3, 9)` is checked at import; tested on 3.9.13 and 3.12.10.

**Claude Code plugin.** `.claude-plugin/marketplace.json` at the repo root and
the plugin itself under `plugin/`, with one skill `plugin/skills/werkstadt/`.
Format taken from <https://code.claude.com/docs/en/plugins-reference> and
<https://code.claude.com/docs/en/plugin-marketplaces> (fetched 2026-09-08).
Verified locally, end to end, then undone: `claude plugin validate ./plugin`
and `claude plugin validate .` both pass, `claude plugin marketplace add
<this folder>` registered it, `claude plugin install werkstadt@werkstadt
--scope local` installed it and `claude plugin list` showed it enabled at
1.0.0. What could NOT be verified locally: `/plugin marketplace add
owner/repo`, because there is no remote yet — phase D.

**Screenshots.** Six of the eight README frames carried client or project names,
personal paths or Hebrew folder names. Replaced by redacted captures
(`globe-planet.png`, `island-dusk.png`, `redact-city.png`), kept
(`traffic-accident.png` — `life.html`'s own synthetic street; and
`wallpaper-desktop.png` — only the author's own open-source repos), or dropped
along with their captions (the recordings shelf and the building interior, both
of which showed a real session title; the interior also showed an absolute
`C:/Users/...` path). `release-city.png`, `release-globe.png` and
`release-island.png` — phase A's own evidence frames, not in the README — were
deleted for the same reason. `release-recordings.png` is the empty shelf and
stays.

---

## What phase B did

Verified against this tree, not from memory.

**The 35 Hunyuan models are gone and 19 CC0 files stand in their place.**
`assets/fetch_assets.py` grew a `--cc0` stage (its own commented section, after
the life pack) that downloads Kenney's kits and Quaternius's packs, converts
what needs Blender, runs every model through `npx @gltf-transform/cli optimize`
and rewrites the `model.hy.*` rows of `assets/manifest.json`. **The keys did not
change.** Renaming them would have touched four renderers and seventy-two call
sites for no behaviour change; the `hy.` prefix now names the catalogue rather
than a generator, and life.js says so where the catalogue is declared.

| what it fills | from | note |
|---|---|---|
| car, van, pickup, tractor | Kenney car-kit | sedan / van / truck-flat / tractor |
| the big vehicle (`bus`) | Kenney car-kit `truck.glb` | **a box lorry.** No CC0 pack checked ships a bus; Quaternius's is an untextured grey shell |
| bicycle | Quaternius Public Transport | re-packed: the old conversion was several meshes and life.js draws only the first |
| robot | Quaternius Animated Robot | frozen on one frame of `Robot_Idle` and exported without its skeleton — the bind pose is a T |
| drone | Wild Digital Moments' own ORNIS | own work, released under this repo's licence |
| cow, sheep, horse, dog | Quaternius Farm Animal | unrigged at the source, which is exactly what the still half of a mixed herd wants |
| cat | Quaternius Fox, exported without its skin | no CC0 cat exists in any pack checked |
| fountain, kiosk, cafe table | Kenney fantasy-town-kit, furniture-kit | |
| bush, conifer, broadleaf | Kenney nature-kit | |

**Four subjects and the thirteen landmarks were left empty on purpose**: parrot,
chicken, bus shelter, playground. No CC0 equivalent exists in any pack checked,
and a substitute that is not the subject is worse than the procedural fallback
each of them already has. Their catalogue rows stay in `life.js`, marked, so
filling one later is a manifest row and no code.

**Sizes, and the visual cost.** The old pack was ~50,000 triangles a model with
a baked albedo, a normal map and a metallic-roughness map. The CC0 set is 80 to
3,238 triangles with one small palette texture and no normal map: 19 files,
691 KB in total, the largest 177 KB. That is the honest downgrade — a Kenney
sedan is a Kenney sedan, and at four metres it is flat-shaded where a
photogrammetry car was not. What was kept is coherence: one material treatment
(`rigidMaterial`, unchanged), one scale family, and `RIGID_ALBEDO = 0.74`, which
was solved for a baked albedo and does a second job on Kenney's toy palette.

**`height` had to be re-solved, and `face` re-measured.** `_buildRigid()` scales
a model by its bounding box's Y, so a low wide subject scaled to a plausible
ROOF height comes out enormous: the CC0 fountain is a 2.0 x 0.48 x 2.0 basin,
and the old `height: 2.20` would have put a nine-metre basin on the plaza. Those
rows now solve height backwards from the width the thing should have, and each
says so. Every `face` was measured, not guessed: `assets/_facing.html` renders
each model orthographically from +Z, +X and above, and the front is read off the
picture. Sixteen of nineteen face +Z; the bicycle alone faces -Z. The previous
pack's values were a quarter-turn out for the car, the pickup and the tractor.

**`Life.load()` is tolerant, and the audit that made that safe is done.** It
used to throw on a missing manifest, a missing row, a row with no
`heightUnits`, or a 404 — and one throw cost the entire living layer on every
host, silently, because nobody awaits it. It now collects what it could not
load and warns ONCE, naming every key. All fifteen `this.models[...]` sites were
audited; four needed a guard (`_deckFor` deals only from types that loaded,
`_buildCrowds` and `_buildVehicleMeshes` skip one, and the skinned draw pass
skips an actor with no crowd), and the rest already refused a type they had no
model for. `globe.js`'s prop loader gained the same guard on the manifest ROW,
which is the thing that can now be absent. With the CC0 set in place the four
pages produce **zero console errors and zero 404s**; with `assets/` empty the
pages still open and draw, untextured.

**The asset library left git.** `assets/textures`, `hdri`, `models`, `life`,
`drones` and `cc0` are gitignored and ship as `werkstadt-assets-v1.zip`, built
by `tools/build_assets_zip.py` (100 files, 101.6 MB raw, 82.4 MB zipped, with a
`.sha256` beside it). A fresh clone gets them with
`python assets/fetch_assets.py --release` (the zip, hash-checked) or
`python assets/fetch_assets.py` (rebuilt from source). The tracked working tree
went from 115.28 MB to 14.97 MB. `server.py` prints one line at startup when
the library is not unpacked, instead of letting four pages fill a console with
404s.

**Frame rate, paired A/B against the private install on 4949.** Three pairs,
same machine, same headless Chrome, `life.html?stress=1`:

| scene | private install | this tree | why |
|---|---|---|---|
| street | 50.0 / 55.7 / 51.9 fps | 31.2 / 34.0 / 38.3 fps | **more traffic, not slower models** |
| herd | 39.1 fps | 41.9 fps | half the triangles |

The street result is real and it is not the geometry: at the same requested
population the CC0 street places **76 vehicles against 54** (`carsDropped` 4
against 26), because a Kenney car is 2.84 m long against the old 4.5 m and
`populate()` sizes a lane's capacity off the longest vehicle it may carry. Same
road, 41% more cars on it. Triangles went the other way, 3.47 M to 1.90 M.
**Closed in phase D**, the first way: a `length` dial on the five road-vehicle
rows puts a car back at 4.30 m and the street back at 54 placed / 26 dropped.

---

## Known gaps for the next session

**1. ~~`assets/hunyuan/` is absent.~~ Closed in phase B.** The keys are filled
from CC0 packs, `Life.load()` tolerates a hole, and four subjects plus the
thirteen landmarks are deliberately empty and fall back to procedural forms.
Two things it did NOT close: `assets/cc0/fountain.glb` is still two primitives
(the second is Kenney's own `(%ignore)` water plane, which is the one we want
dropped, so this is correct rather than pending), and the release zip's
`RELEASE_URL` / `RELEASE_SHA256` in `assets/fetch_assets.py` are empty until
there is a release to point at. Phase D proved both work against a `file://`
URL and left them empty; filling them is step 4 of `docs/PUBLISH.md`.

**2. `data/` ships one fixture, and the rest are gone.**
The private-session exports were left behind on purpose; `data/demo.json` was
rebuilt from a throwaway public session on 2026-09-08 (gap 8). What referenced
them, checked by grep:

| fixture | referenced by | effect of its absence |
|---|---|---|
| `data/demo.json` | `replay.js:900` (first fallback when no `?src=`/`?project=`), plus comments in `city.js` | **present since 2026-09-08** — a bare `index.html` plays it |
| `data/sample.json` | `replay.js:900` (second fallback) | never reached now that `demo.json` answers the first probe |
| `data/sample-project.json` | `replay.js` comments only — it was a three-street `?src=` fixture used by a framing test | no runtime path breaks; the multi-street framing check has no fixture |
| `data/this-session.json` | **nothing in this tree** | no effect |
| `data/sample-file.txt` | `interior.js:512` — fetched to dress an interior wall when `GET /api/project/file` is unavailable | the fixture branch has nothing to show; `interior.js:1076` still labels that mode "FIXTURE" |

None of these is referenced from an HTML page directly; the fallbacks all live
in `replay.js` and `interior.js`. `archive/tree/` has its own copies referenced
by its own docs and is not part of the live app. `data/` today holds
`demo.json` and `.cache/`, and the cache is gitignored and regenerates.

**3. ~~`redact` is a no-op.~~ Closed in phase C.** Do not confuse `redact` with
`export_replay.redact()`, which is a different and older thing: that one strips
secrets out of event text and runs whether or not `redact` is on.

**4. No remote and no push.** Still true, and it is the only thing standing
between this tree and a public repository. `main` is one commit; `pre-squash`
holds the old five. `docs/PUBLISH.md` is the three commands, the six
placeholder lines and the account to publish under.

**5. A dozen "claude-live" strings survived the rename, all deliberate.** They
sit in comments in `city.js`, `globe.js`, `world.js` and `server.py` and name
the author's own project directory as the *subject of a measurement* ("measured
7.7 px on the real claude-live town"). Renaming them would make the measurement
unverifiable. Everything user-facing, every task name, every localStorage key
and the asset fetcher's User-Agent were renamed — including an earlier working
name for the project itself that turned out to be taken. A grep for that old
name and for the author's own name over the tree both return zero.

**6. The launcher chain has still never been run.** Phase A started the server
from this folder with no `config.json` and drove headless Chrome at 1440x900
over CDP across all four views; phase C repeated that from a `git clone` into a
temp directory. Phase C added `--install-windows`, which is the opt-in entry
point into `launcher/install.ps1`, and **did not run it** — registering
scheduled tasks and writing a Desktop shortcut on the author's own machine, on
top of the private install that is already there under the old name, is not
something to do to prove a flag exists. Still NOT run: `install.ps1`, the three
scheduled tasks, the screensaver watcher, the Lively wallpaper entry,
`POST /api/play`, and most of `docs/TESTS.md` sections 5 and 7.

The systemd and launchd units in `docs/RUNBOOK.md` are written from the code and
are marked untested; this machine is Windows only.

**7. The stress scene overlaps at the crossroads, since phase D.** 45 to 75
frames of 600 carry one or two overlapping vehicle pairs on
`life.html?stress=1`, where the pre-scale build had zero. Not the scale
arithmetic: the scene asks for 80 vehicles on a network that holds 54, the side
street gridlocks, and a vehicle stopped in the junction box is now long enough
for its tail to reach the crossing lane. Two fixes were tried and reverted with
their numbers — `docs/TESTS.md` 12.1. The real fix is a junction model that can
clear its own box.

**8. ~~`index.html` opened bare produces two 404s.~~ Closed 2026-09-08.**
`data/demo.json` now ships — a real 32-event session, 5.4 KB, described in the
section at the top of this file. `replay.js` finds it on the first probe and
never asks for `data/sample.json`, so a bare `index.html` is zero 4xx and zero
console errors, and a first-time user sees a city with a crew and an accident in
it instead of "No session to replay yet".

**9. Three module docs reference screenshots that no longer exist.**
`docs/BUILDINGS.md`, `docs/DRONES.md` and `docs/LIFE.md` name roughly twenty
`docs/shots/*.png` files (`buildings-night.png`, `drones-lineup.png`,
`life-plaza.png` and so on) that phase A removed when it cut `docs/shots/` down
to a handful of reference frames. Pre-existing, reported rather than fixed:
either re-capture them from the showcase pages' own `__pose()` helpers, which
those docs already document, or cut the references. Nothing in the running app
touches them.

---

## Where things live

```
index.html    styles.css   replay.js  city.js  interior.js   the project city
world.html    world.css    world.js   biomes.js  terrain.js  the island
globe.html    globe.css    globe.js                          the planet
recordings.html  recordings.css  recordings.js              the film shelf
buildings.html  buildings.css  buildings.js                 BuildingKit showcase
drones.html     drones.css     drones.js                    DroneKit showcase
life.html       life.css       life.js                      living-layer showcase
m.html                                                       phone page, own QR encoder
vault.html                                                   redirect -> world.html?focus=vault
controls.js  controls.css                                   shared on-screen controls
credits.css                                                 studio line + sponsor affordances
humans.txt                                                  seal layer 3

server.py                stdlib-only server: static files, /api/*, two SSE feeds
config.example.json      the schema; copied to config.json (gitignored) on first run
config/trades.json       regex -> schema.org type, the trade/landmark table

tools/export_replay.py   a session transcript -> the replay event shape
tools/export_vault.py    an Obsidian vault -> data/vault.json (--vault required)
tools/recorder.py        drives a page at ?record=1 and writes an MP4

launcher/                Windows: install / start / restart / open / screensaver /
                         uninstall (PowerShell 5.1), make_icon.py, the .ico
assets/                  manifest.json + CC0 packs; fetch_assets.py re-downloads them
data/                    demo.json, the shipped fixture; .cache/ and vault.json are generated
archive/                 the superseded 2D radial-tree renderer, kept runnable
docs/                    see docs/README.md
```

**Read next:** `docs/HOW-IT-WORKS.md` for the system in one pass,
`docs/RUNBOOK.md` for running and operating it, `docs/DECISIONS.md` for why the
code is shaped the way it is, and `EDITING.md` at the root if you are here to
change what things look like.

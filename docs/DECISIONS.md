# Decisions — Werkstadt

_Verified: 2026-09-08_

Why the code looks the way it does. Every entry is a choice that a contributor
would otherwise be tempted to undo, with the reason it was made and what it
cost. Nothing here is a to-do list and nothing here is a session log — the
dated working history this file was trimmed out of is gone on purpose.

Shape of an entry: **Decision:** what is in the code. **Why:** the reason,
usually a measurement. **Rejected** — the alternative someone will suggest.
**Cost** — what the choice gave up, stated rather than hidden.

---

## The shape of the thing

### One HTML file per view, no build step

**Decision:** Every view is a plain `.html` file at the repo root loading a plain
`.js` module and a plain `.css` file: `index.html` (the project city),
`world.html` (the island), `globe.html` (the planet), `recordings.html`, plus
the three module showcases `buildings.html`, `drones.html`, `life.html` and the
phone page `m.html`. There is no bundler, no transpiler, no `package.json` and
no `node_modules`.

**Why:** The whole tool is a thing you clone, point at a folder and open. A
build step would make editing a colour require a toolchain, and it would put a
second artefact between the file you read and the pixels you see. `humans.txt`
states it as the project's own claim: *handbuilt, no framework, no build step*.

**Cost:** Files are large — `globe.js` is ~480 KB of source — with no
minification. It is paid back by convention rather than tooling: every section
carries a `data-sid` and a plain-language `data-title`, CSS carries banner
comments about every 50 lines, and comment density runs 8-14%. A big file that is
navigable beats a small one that needs a map.

### three.js is pinned to an exact version, from one package

**Decision:** Every page's importmap points `three` and `three/addons/` at
`https://cdn.jsdelivr.net/npm/three@0.185.1/...`. Both entries are the same
version and the same package.

**Why:** The addon files import from `"three"` and `"./three.core.js"`
internally, so both map entries have to resolve to one copy or the renderer
loads twice. An unpinned `latest` would silently change the renderer under a
reference screenshot — this project's acceptance is measured in pixels and
frame rates, and a dependency that moves invalidates all of it without an error.

**Cost:** Upgrading is a deliberate act with a re-run of the shot list behind
it, and the pages need the network on first load.

### The server is Python standard library only

**Decision:** `server.py` imports nothing outside the stdlib —
`http.server.ThreadingHTTPServer`, `json`, `pathlib`, `threading`, `logging`,
`re`, `gzip`, `hmac`. There is no Flask, no FastAPI, no requirements file.

**Why:** The install instruction is "you have Python". A dependency list turns a
clone into an environment problem, and the server's actual job — serve static
files, tail some JSONL, hold two SSE feeds and a few caches — is squarely what
the stdlib does. `ThreadingHTTPServer` is what makes the SSE feeds possible at
all: a single-threaded `HTTPServer` serves one request at a time and an open
stream would block every other route forever.

**Rejected:** A single global lock over the caches — that was the bug that was
actually shipping (one open world stream rebuilt on nearly every poll tick and
starved `/api/sessions` behind it). The caches now hold their own locks, and
`_index_lock` is an `RLock` because `refresh_index()`'s own call path nests into
it.

### Nothing on screen is invented

**Decision:** Every building, drone, tree, sign, person and population count
traces to a real event, note, file or data field. There is no ambient traffic,
no decorative skyline filler and no placeholder population. When no event has
arrived for two seconds, drones hover and windows flicker rather than the scene
inventing motion to look alive.

**Why:** It is what the tool is for. A record with no source cannot be drawn,
because the moment one thing on screen is decoration you cannot trust any of it.

**How it constrains everything downstream.** `life.js` never picks a population
size — every count is passed in. An accident is a real `tool_end` error, staged
deterministically from the error's own label and position (a string hash, no
`Math.random()`), so the same error replays the same crash. Props are opt-in: a
fountain, a hedge, a playground, hens, dogs and cats each appear only when the
host passes a flag or a count, because a fountain nobody asked for is decoration
with a data-shaped excuse. What the renderer *is* allowed to decide is how a
thing is DRAWN once the count is given — the LOD ladder, which of two cow meshes
an animal gets, where on a plaza a requested prop stands. A placement derived
from declared geometry is not a population.

### The island and the planet are two views, not one replacing the other

**Decision:** `world.html` (an island: the vault as land, the projects as a
harbour) and `globe.html` (a 600-unit sphere with continents, an ocean and a
day/night terminator) both stand. `index.html` is a third, closer view — one
project's own city, one street per session.

**Why:** An island can only ever be one place; a sphere is what "a world"
actually means, and enlarging the island would not have answered that. But the
island holds the vault-as-geography and the interior work, which the planet does
not, so replacing it would have thrown away a working view to gain a different
one.

**Cost:** Three renderers with overlapping concerns. The overlap is managed by
pushing the shared parts into standalone modules (below) rather than by merging
the pages.

---

## Modules and assets

### BuildingKit, DroneKit and Life are standalone modules with their own showcase pages

**Decision:** `buildings.js`, `life.js` and `drones.js` import nothing from the
rest of the repo, and each ships its own showcase page (`buildings.html`,
`life.html`, `drones.html`) before being wired into a world.

**Why:** Each has its own bar to clear — buildings: twelve distinct detail
elements readable from 10 m; drones: silhouettes readable from the wide shot;
life: every population count driven by data. A showcase page lets that bar be
measured in isolation, and it makes a defect attributable: the module or its
caller, never "somewhere in the app". A second copy of a drone airframe inside
`city.js` would have two bars to clear and one of them would rot.

**Consequence you will meet.** A host may not edit a module to make its own case
work. `globe.js` pools and re-places `life.js`'s props between settlements rather
than asking for a teardown; `city.js` converts its own units to metres rather
than asking for city units. Where a host genuinely needs an API the module lacks,
that is written down as a request, not patched in from the caller's side.

### CC0 assets only, and no rig is ever invented

**Decision:** Every model and texture in `assets/` comes from a CC0 source (Poly
Haven, Kenney, Quaternius) or is generated for static, non-animated props. Where
no CC0 *animated* source exists for something a scene needs, the nearest CC0
animated substitute is used and documented — a sheep drawn as an alpaca, a cat
as a fox, birds as procedural geometry with a shader-driven wing beat.

**Why:** "Nothing invented" applies to provenance too: a model with no rig
cannot be animated honestly by faking clips onto it, and a hand-built rig that
looks plausible is exactly the kind of lie this project refuses elsewhere.

**Cost:** The animals are the weakest thing on the living layer, and a herd is
deliberately MIXED — two grazers in three are the higher-quality static mesh,
the third keeps its rig — because the two families fail in opposite directions
and a field needs both halves: a field where nothing ever moves is a diorama.

### A landmark model is used only where it means what it shows

**Decision.** A project's detected trade picks a landmark building, and a model
is mapped to a trade only when it is recognisably that thing — a concert hall for
a music school, a bakery for a café, a school for a school. Trades with no
honest model fall through to a procedural form. A scanned landmark is placed at
yaw 0 ± 9°, not at a hashed angle.

**Why.** The landmark's job is to be recognisable from across the water. An open
cutaway model reads as looking *into* a building rather than at one, whatever it
is labelled. And every model in the pack is built facing +Z, with the awning, the
window, the steps and the clock face on that one side, while the road passes the
plaza on exactly that axis — a free yaw pointed the front of every building at a
corner of its own square. Nine degrees of jitter is enough that a set of villages
does not read as stamped, and small enough that the front still faces the road.

### Every loader gets the meshopt decoder, or the pack silently degrades

**Decision:** The prop/model loaders in both `globe.js` and `world.js` `await
MeshoptDecoder.ready` and call `.setMeshoptDecoder(MeshoptDecoder)`.

**Why:** It is its own entry because it costs a whole measurement round to
rediscover. The generated packs declare `EXT_meshopt_compression` in
`extensionsRequired`; the CC0 packs are plain glTF. The two failures are not the
same shape: `globe.js`'s prop loader swallows errors on purpose ("a missing prop
is a missing prop, not a dead planet"), so the page looks completely healthy —
zero console errors, every count normal — and quietly falls back to card
geometry. `world.js`'s loader rejects, and because its props load through one
`Promise.all`, a missing decoder throws out of `loadAssets()` and the island
never builds at all. The decoder is inert on files that do not use the
extension, so the lines stay either way.

---

## From data to a world

### A city is a project; a street is a session

**Decision:** A town is a project directory; an avenue in it is one session; a
directory worked on by two conversations stands as two plates, because a plate is
keyed on `street.key + '|' + dirpath` rather than on the path alone.

**Why:** Without it, every new session on the same project would start a brand
new empty city and throw away the fact that the project itself has history. The
alternative — one shared plate touched by two sessions — breaks the rule the
whole renderer depends on: nothing that already stands ever moves.

### A town is keyed by the project root, not by the session's `cwd`

**Decision:** `resolve_project_dir()` derives a town from the dominant project
directory of a session's actual file-tool paths.

**Why:** Measured on a real transcript store: one `cwd` (the folder the terminal
happened to be opened in) held 578 of 753 sessions while the real work happened
elsewhere on disk. Keying on `cwd` would have put almost everything under one
meaningless town.

**Also.** A second rule runs before the path-collapsing regex: a path segment
named `demos`, `demo`, `sites`, `clients`, `apps`, `tools` or `video` whose next
segment carries its own project marker (`index.html`, `docs/`, `package.json`,
`BRIEF.md`) becomes that project's own root. Without it a site swallows every
demo it contains into one undifferentiated town — measured at 125 towns before,
142 after, with 17 demos each getting their own trade and pages.

### Trades are keyword-detected, and detection needs two sources or one strong one

**Decision:** A project's trade (which decides its landmark) comes from
`config/trades.json` — a plain regex → schema.org type table — plus any
schema.org `@type` the project's own JSON-LD declares. A keyword type fires only
on **2 distinct source hits** for the same type, or **1 hit in a strong source**
(the title, `og:site_name`, or a JSON-LD `"name"`). Below that bar two structural
defaults apply before `null`: a root with `server.py`, or a `package.json`
declaring `bin`/`main` and no HTML pages, is `SoftwareSourceCode`, and so is
anything under a `tools` folder or carrying its own skills directory.

**Why:** The single-hit rule misfiled real projects on one stray word — one
"book" in a README line about a code module was enough to relabel a whole town.
The JSON-LD path is kept alongside because it can emit any type at all, so a
project that declares what it is gets it right with no code change.

**Why it is a config file and not code.** It is the most project-specific table
in the tool and the thing a new user will most want to edit. The server names the
file it could not read rather than falling back to a hidden built-in copy.

**The discipline it is under: detection, never assignment.** A candidate word is
tested against the real corpus before it is allowed in. Words that sound right
and are not: "Frühstück" (a breakfast café is not a hotel), "booking" (a
lesson-booking widget is not lodging), "Bezirk" (a district is geography, not a
municipality). Each would have fired on a *title* — a strong source — so one word
would have decided a whole town.

### Continents come from config, and work outside your home directory becomes an island

**Decision:** `continentOf()` in `globe.js` reads `continents` from
`config.json` — an ordered list of `{path_contains, continent}` rules, first
match wins — served to the page by `GET /api/config.js`. A project outside your
home directory returns `null` and is drawn as a small offshore island.

**Why:** The mapping from a directory tree to a landmass is the most personal
thing in the tool and used to be literals in `globe.js`. Order matters and is
part of the contract: a config can put `/projects/clients/` on one landmass ahead
of a broader `/projects/` rule underneath it. Work outside your home directory is,
by definition, work whose home this machine is not — an island says that, and
pretending it into a landmass would not.

**Why a `<script>` and not a `fetch`.** `globe.js` needs the continent rules
while it is building its first frame. A fetch there is a planet that pops into
place one round-trip late. Only four keys ever leave the process — the home path,
the continent rules, the aviary regex and the `redact` flag; the transcripts root,
the vault path and the auth file are the server's business.

### The vault is an optional layer, not a dependency

**Decision:** `vault` in `config.json` is `""` by default. With it empty, the
Obsidian layer switches off entirely and `main()` substitutes a path that cannot
exist, so every `vault_dir / ...` and `.rglob()` downstream stays valid and
empty. `tools/export_vault.py` has no default path at all and `--vault` is
required when it is run on its own.

**Why:** The globe and the island are the product; a note vault is an extra for
people who happen to keep one. There is deliberately no guessed default: an
Obsidian vault is one folder among thousands on any machine, and a tool that
guesses wrong here reads someone's private notes without being asked. Before the
layer became optional, `world.html` threw outright on a missing
`data/vault.json` and drew nothing at all.

**Cost:** on a default install the island's land is flat — the harbour, the
towns and the roads are all there, the geography made of notes is not.

### The island reads the machine's history and writes nothing

**Decision.** On load the island stands up the last 24 h of first-touched files
by fetching each live town's own replay. No file is written, nothing goes into
`localStorage`, and the print sequence is **not** replayed for those buildings —
they simply exist, captioned "stood here before this page opened" against
"printed while you watched".

**Why.** The record already exists server-side; a store the page wrote would be a
second copy of a fact the machine already holds, and would go stale the moment a
session ran while the page was closed — the entire case the feature exists for.
And a print is the EVENT: replaying forty at load would be forty lies about what
is happening right now.

**The trap inside it.** `/api/project?since=` filters **sessions** by their own
start, not events by their time. The client therefore asks for 48 h and applies
its own 24 h filter to the events — otherwise a session that began 30 h ago and
wrote a file ten minutes ago is invisible.
---

## Rendering and performance

### The 16-attribute ceiling is a hard limit, not a budget

**Decision:** The facade program uses exactly 16 vertex attributes and no
feature is allowed to add a 17th. `__selfcheck().attrs` reports it.

**Why:** Past 16 the program does not link on the software renderer this project
is captured on ("Too many attributes"). Two separate features — the print flash
and the materialisation cut — were designed around this rather than through it:
the flash rides an existing state float, and the island's print cut is a
`THREE.Plane` on cloned materials instead of a per-instance `discard`.

**Cost, stated.** The clipping plane costs one shader link the first time a given
style is printed; every print after it hits three.js's program cache, and a
material with no planes compiles to exactly the program it did before. Materials
must be cloned because they are shared with every other building of that style.

### The night skyline is a second bake, not a uniform

**Decision:** The building kit shoots a **second** facade photograph per style +
palette with night lighting applied, and the instanced material cross-fades
day → night per pixel, staggered per instance by an `aPhase` attribute.

**Why:** The live night term only ever drove the near tier; every window on the
instanced skyline past 60 m stayed a daytime dark rectangle, which is most of a
town at any distance worth having LOD for.

**Rejected:** Real emissive window materials on the far box — the whole reason
that tier is one draw call is that it is four flat quads wearing a photograph.
And one shared fade with no per-instance offset: a field of identical buildings
crossing the threshold in the same frame reads as a light switch thrown on the
whole town, not a street coming alive.

**Cost:** One extra 512² render target per style + palette, at first use.

### Trees far away are impostor atlases, near ones are crossed cards

**Decision:** Each tree species is photographed from eight bearings into one
atlas at load. Above 300 m of altitude a wood is one billboard per tree picking
the cell nearest the camera's bearing; below it, crossed cards and trunks.

**Why:** A crossed card is flat, so at any bearing two of three are edge-on and
the third is a rectangle. There is no angle at which a card is a canopy, which is
why twelve thousand of them average to confetti at altitude. The atlas gives the
real silhouette at every angle for the same draw-call count, since the two tiers
are never both visible.

**And the tier boundary must be invisible.** A scanned conifer is normalised
ONCE — scaled to the species' own height, stood on y=0, footprint centred — then
photographed twice from that one object: head-on for the near card, eight-up for
the atlas. Two normalisations are two chances to disagree, and the baker spins
the object about the origin, so an off-centre tree orbits instead of turning. A
tree that is not the height of the cards around it is not a better tree, it is a
different one, and the swap becomes a visible jump.

### The living layer sits on ONE tangent stage that follows the camera

**Decision:** `life.js` is loaded once into a group whose matrix is one
settlement's tangent frame, and that group is re-aimed with hysteresis as the
camera moves. Neighbouring settlements get baked human sprites in world space
instead — one instanced mesh per model for all of them.

**Why:** On a 600-unit sphere, 600 units of neighbourhood is 57° of arc and the
sagitta of that chord is 300 units: a single tangent plane covering a settlement
and its neighbours has its edges three hundred metres in the air. `life.js`'s
whole API is flat-world by contract.

**Rejected:** A `Life.load()` per settlement — twenty seconds of mesh decimation
each, and several copies of eighteen models in memory.

**The consequence to know before you touch populations.** `life.js` sizes its
crowds and instanced meshes on the FIRST `populate()` and never grows them. So a
host populates once at the high-water mark any single settlement can ask for and
moves actors between the live arrays and a reserve it owns. A prop first asked
for by the third town would otherwise have no mesh and would silently not appear.

### Frame rate is a property of the machine, and the bisect says so

**Decision:** No performance lever was pulled in response to a low reading that a
one-thing-at-a-time bisect could not attribute to a component.

**Why:** The same build, same window, same pose read a median of 24 fps with 30
browser processes alive and 46 with 16. Two rows of the bisect came back SLOWER
with a component removed, which no renderer can do, and five came back on the
vsync cap, which turning off a bloom pass cannot buy. The control is what makes
it a finding rather than a shrug: the full build at the same pose in the same
minute also read the cap. Cutting a documented visual budget to move a number
that is not about the code is paying for someone else's browser — a lever gets
pulled when a pose reads slow on a *quiet* machine, and only then.

**The one real client-side cost that WAS found, and fixed.** `Life.load()` never
returned to the event loop while decimating eighteen meshes, so "started and not
awaited" meant nothing for 8.8 seconds. One `setTimeout(r, 0)` between model
constructions took time-to-first-street from 8,974 ms to 962 ms (numbers in
`docs/TESTS.md`). Not `requestAnimationFrame` — rAF is frozen in a hidden or
occluded tab. Not parallel — the sequential loop bakes sprites through the
renderer, and two interleaved render-target swaps gives a blank sprite.

### The bloom pass sets the emissive budget, and its constants are per-page

**Decision.** Two related numbers. The materialisation flash peaks at 0.55 in the
project city and 0.22 on the planet. The construction crew's vest and helmet emit
0.55 of the garment's own linear colour in the palette shader — not 1.0, and
residents get none.

**Why the flash constant is not portable.** The two pages are not the same rig:
the planet runs bloom at strength 0.48, threshold 0.62, over an ACES curve at
exposure 0.85, and at the city's own number the emissive crosses the threshold on
every facet at once and the capture comes back as a white blob with a town round
it. The flash is also clamped before the fog mix, because nothing capped the SUM
of the flash on top of a facade's own emissive — windows, edit glow, laser line —
which is the actual overexposure case; lowering the flash's own constant does
nothing about that.

**Why the vest had to become emissive at all.** A saturated albedo was already
there — a real material through the shared palette texture, not a decal — and it
still failed: the city is dusk-to-night by design and the crew rendered as black
silhouettes at four bearings and four distances. An albedo can only return the
light that falls on it, and lighting a whole city so two workers read would
change every building and every reference shot to solve a two-material problem.
Real hi-vis works the same way: retro-reflective, not merely yellow. At 1.0 the
vest crosses the bloom threshold and the crew photographs as white blobs.
**Cost:** two varyings and ~six vertex-shader instructions.

### Three camera and input choices that look odd out of context

**Free flight on the planet is `{axis, alt, yaw, pitch}`** — tangent-plane
movement, altitude clamped over the terrain, up vector rebuilt every frame — and
never a free position or quaternion. A six-DOF flyer on a sphere gets lost and
never finds a continent again: with a constant "up" the horizon rolls over as
soon as you leave your starting point. Clamping makes "lost" unreachable.

**Touch is written out, not inherited from pointer events.** `touchstart` /
`touchmove` / `touchend` own every finger, the pointer handlers return early on
`pointerType === 'touch'`, and the canvas carries `touch-action: none`. Pointer
events give one drag and nothing else, and with both paths live a pinch moved the
camera twice, once per finger. A long press is the deliberate stand-in for HOVER,
because a finger has no hover, no wheel and no right button — and the desktop
controls were built on all four.

**`m.html` carries its own ~200-line QR encoder** (byte mode, versions 1-10,
level M) with no dependency: the page's whole job is to work on a home network,
and a CDN library is a QR code that fails exactly when it is needed. When the
hostname is loopback it says so and asks for the real address, because there is
no honest way for a page to discover its own LAN address (WebRTC's local
candidates are mDNS-obfuscated) and printing an unreachable code is the one
failure mode this page must not have.

---

## Recordings, the wallpaper, and what leaves the machine

### A recording is two things: an exact link and a file that travels

**Decision:** Every session gets both. The **link**
(`index.html?project=<town>&session=<uuid>&replay=1`) replays that one
conversation in its own project city, from the real events, for free. The
**MP4** (`recordings/<project>/<date>_<title>.mp4`, ~90 s, 1920×1080) is a render
of that same link, produced by `tools/recorder.py` while the machine is idle.

**Why both.** An MP4 is one camera, one speed and one compression — you cannot
walk into a building, read a wall of source or pause on a print, so everything
the tool is for is lost in the encode. But the link only resolves on the machine
that holds the transcripts, and a file plays for somebody who has never heard of
this project.

**Why the film is driven rather than captured.** Headless Chrome here has no GPU
and draws about eight frames a second, so a screen capture advances the replay
four times further between two captured frames than the finished film shows. With
`?record=1` the page renders on demand instead: one `__recordTick()` is worth
exactly 1/30 s of film, whatever it cost to draw. Length becomes arithmetic, the
picture is deterministic, and there is no dropped-frame case. **Cost:** about
five minutes of wall clock for a ninety-second film. **Rejected:**
`Page.startScreencast` — the obvious call, wrong for the same reason, because it
delivers frames in wall time, which is the clock this render must not be on.

### Nothing is ever uploaded, and there is no button that uploads

**Decision:** Neither `tools/recorder.py` nor `recordings.html` sends a file
anywhere. Sharing is `copy link` and `copy download link`, both of which copy an
address on the current origin.

**Why:** A session transcript is your work and possibly someone else's: a film of
a project shows its file names, its directory tree and the shape of what was done
in it. A recorder that uploaded on a timer would eventually put one of those on a
URL nobody meant to create. The one-click cost of copying a link is much smaller
than the cost of the first mistake.

### The server binds loopback, and auth exists for the case where it does not

**Decision:** `host` defaults to `127.0.0.1`. HTTP Basic Auth switches on for
non-loopback clients only when an auth secrets file exists; it is absent by
default, so auth is off and local use needs no login.

**Why:** Your transcripts are behind this server. Loopback is the default because
that is the honest security boundary for a tool that reads them; the auth layer
is for the deliberate case (a phone over a private network), not the normal one.

### "Play" opens a window; it does not give the wallpaper a keyboard

**Decision:** The play button on the desktop wallpaper asks the server to open
one fullscreen kiosk browser at the same page and state over the desktop, and
leaving kills that window. The wallpaper host's own input-forwarding setting is
never touched.

**Why not keyboard forwarding, which is what the request literally describes.**
The wallpaper host has that setting and it is the wrong answer three times over.
It is global and it eats the desktop's own keys — these pages bind bare single
letters (`f`, `q`, `p`, `/`), the same keystrokes the OS uses to jump to a
desktop icon by name. The wallpaper is not the surface you want to play on
anyway: it renders behind the icons and below the taskbar (the controls carry an
82 px offset because the bottom strip is covered) and runs a reduced preset — slow
spin, no hints, no hover, no quality picker. And the window already existed, so
re-using the screensaver's kiosk flags is a route on the server, not a new
mechanism.

**Cost:** one POST route, one GET, a button and a flag that rides the existing
link builder — against a wallpaper that is never reloaded and never at risk.

### The Windows launcher ships no binary, and never writes to a console

**Decision:** `launcher/` is PowerShell 5.1 plus `pythonw.exe` plus whichever
system browser is present. The screensaver is a kiosk browser window opened past
an idle threshold and killed on the next input — not a compiled `.scr`. And the
server always logs to a rotating file at `launcher/server.log`, adding a console
handler only when stdout is a real tty; every request-path `print()` is a log
call and the base handler's `log_message()` swallows its own failures.

**Why:** Two constraints, one shape. An unsigned compiled binary is blocked
outright on a machine with Smart App Control on, while PowerShell, `pythonw.exe`
and the system browsers are all already signed and already present. And
launching via `pythonw.exe` — no console — with unredirected stdout made any code
path touching `sys.stdout` reset the connection before a byte reached the
client: `curl` saw "empty reply from server", 5/5. The launch script redirects
the streams as well; that is belt-and-braces, because the server's own fix stops
it even when launched unredirected.

---

## 2026-09-08 — The public release

### Every machine-specific setting is in `config.json`, and `config.example.json` is the schema

**Decision:** Everything that used to be a literal in `server.py` or `globe.js`
is a key in `config.json`: the transcripts root, the optional vault, host and
port, the auth secrets file, the recordings directory, the trades file, display-
name overrides, excluded directories, the continent rules, the aviary regex and
the `redact` flag. `config.json` is gitignored and written from
`config.example.json` on first run; missing keys fall back to the example's own
values.

**Why the example is the schema and not a list of literals in code.** A
`config.json` written against an older version keeps working when a key is added,
because the fallback is the shipped example rather than a default scattered
through whichever function reads it. Comment keys (anything starting with an
underscore) are carried through untouched, so a copy of the file still reads as
documentation.

**Why "not set" is an empty string and never a guess.** A blank path switches its
feature off rather than reaching for a plausible directory. On a public tool that
reads a machine's own files, a wrong guess is not a bug report — it is reading
something nobody offered.

### The credit line is bottom-centre, in its own stylesheet

**Decision:** `credits.css` holds the studio line and the two sponsor
affordances, and is loaded by `globe.html`, `world.html`, `index.html` and
`recordings.html` **after** each page's own stylesheet.

**Why bottom-centre.** It is the only strip that all four pages leave free: the
bottom-left corner is the mark and the caption, the bottom-right is the controls
cluster. The line must never land on either.

**Why its own file.** It is the same object on four pages, and four copies would
drift apart the first time one of them was touched — the same reason
`controls.css` is one file. Loading it last lets it lean on each page's own
design tokens, and every token reference carries a literal fallback because
`recordings.css` does not define the same set the three 3D pages do.

**Cost:** on the desktop wallpaper the line is lifted 88 px to clear the
taskbar — a hard-coded number, kept beside the offset `controls.css` already
carries for the same reason. There is no background box anywhere: the line sits
on a lit 3D scene with the same text shadow as the rest of the type, because a
panel here is the one thing the design refuses to have.

### The studio seal is five layers, four of them invisible

**Decision:** Every page carries `meta generator` and `meta author`, a JSON-LD
`WebSite.creator`, a `link rel="author"` to `/humans.txt`, a console signature,
and a 1px **W** mark in the footer corner. The mark is drawn with a difference
blend rather than inherited `currentColor`.

**Why difference and not `currentColor`.** Inheriting the footer's text colour
assumes the footer's text always contrasts with whatever is painted at the very
bottom of the page. On a dark panel running to the page edge it did not, and the
mark vanished. Difference against white is contrast by construction.

### The name

**Decision:** the public name is **Werkstadt** (German *Werk* + *Stadt*), with
"a live 3D world for your Claude Code sessions" as the descriptive line.

**Why:** the working name "Claude Live" is not usable — Anthropic's own Claude
Code legal and compliance page restricts what a third-party tool may be called.
The first replacement considered was an earlier working name that turned out
to be taken — by two existing GitHub projects with the same concept, plus npm
and PyPI packages.

**Cost:** every user-facing string, the scheduled task names, the Lively library
entry and the desktop shortcut had to move at once. Comments that name the
author's own project directory `claude-live` as the *subject of a measurement*
were deliberately left alone — renaming those would have made the measurements
unverifiable.

### Apache-2.0, not MIT

**Decision:** the repo ships under Apache-2.0, copyright Wild Digital Moments —
Shalom Dov Ber Kirsh.

**Why:** it buys what MIT buys — inclusion in the awesome-lists this kind of
tool is found through — and adds an express patent grant, which matters for a
tool a company might run internally. Its NOTICE mechanism is also the natural
home for the studio attribution and the 3D models' provenance, which MIT has no
slot for.

**Rejected:** a noncommercial licence. It would exclude the repo from most
awesome lists and from corporate use, which is the whole distribution story.

### `redact` is declared now and implemented later

**Decision:** `redact` is in `config.example.json`, is read by the server and is
passed to the client, and today it changes nothing. It is documented as "not
implemented yet".

**Why declare a setting that does nothing.** The shape of the setting is the
part that has to be fixed early: it belongs at *ingest*, so that a pseudonym is
what the browser receives, rather than as a display filter each of the three
renderers would have to remember to apply. Declaring the key now means the
config file people write today does not have to change when it lands.

**Not to be confused with** `export_replay.redact()`, which is a different and
already-working thing: it strips secrets (keys, tokens) out of event text on
every path that serves file contents.

### The generated models are gone; the CC0 set fills the same keys

**Decision:** No generated model ships. `assets/fetch_assets.py --cc0` fills every
`model.hy.*` key from Kenney's kits, Quaternius's packs and one model of the
author's own, and the whole asset library is gitignored and attached to the
release as a zip instead.

**Why.** The licence position on the generated pack is not one this repo can
settle on its users' behalf: the open-weights licence that would have covered
the outputs excludes the EU in its own first sentence, and the hosted service's
terms could not be retrieved at all. There is no clause anybody can quote that
grants redistribution, and a repository whose most visible assets have no citable
licence is the first thing a hostile reader opens. docs/PUBLISH-RESEARCH.md,
section 4, has the quotes.

**The keys did not change.** `model.hy.car` still means "the car". Renaming the
prefix would touch four renderers and seventy-two call sites to change nothing
that runs; the prefix now names the catalogue rather than a generator, and
life.js says so where the catalogue is declared.

**Rejected — substituting something that is not the subject.** Four subjects
have no CC0 equivalent in any pack checked (a parrot, a chicken, a bus shelter,
a playground) and neither do the thirteen landmark buildings. Their keys are
DROPPED from the manifest rather than pointed at something that is nearly it.
Every consumer already skips a key it has no model for and falls back to a
procedural form, which is a better answer than a wrong one. The one place this
rule was bent is `model.hy.bus`, which is a box lorry: it is a real vehicle of
the right size class doing the job the deck needs, and both the catalogue row
and CREDITS.md say plainly that it is not a bus.

**Cost, stated rather than hidden.** ~50,000 triangles a model with a normal map
became 80 to 3,238 triangles with a palette texture. A Kenney sedan is a Kenney
sedan. Coherence was kept instead of fidelity: one material path, one scale
family, and the existing `RIGID_ALBEDO = 0.74` doing a second job on a toy
palette. The village layer of the public release is visibly less rich than the
private install's, and that is the price of a licence anybody can check.

### `Life.load()` skips a model it cannot load, and says so once

**Decision:** A missing manifest, a missing row, a row with no `heightUnits` or a
404 on the file costs exactly that model. `Life.load()` collects them and warns
once, naming every key.

**Why the old strictness was wrong even though its reasoning was right.** The
argument in the code was that a model which quietly vanishes is a model nobody
notices is gone — true, and answered by the warning. What it cost was out of
all proportion: nobody awaits `Life.load()` (deliberately: the world has to draw
before the crowd arrives), so ONE rejected model took the entire living layer
down on every host, silently, and the street simply came up empty.

**What makes skipping safe.** All fifteen `this.models[...]` sites were audited.
Four needed a guard: `_deckFor()` deals only from vehicle types that loaded,
`_buildCrowds()` and `_buildVehicleMeshes()` skip a type with no entry, and the
skinned draw pass skips an actor whose crowd was never built. The rest already
refused a type they had no model for. `_push()` was already a no-op for a type
with no instanced mesh, which is what makes every draw pass safe by
construction.

**Rejected — making `_buildRigid()` merge every mesh instead of the first.**
It would have fixed a multi-mesh model at runtime, but it would also have merged
Kenney's `(%ignore)` water plane into the fountain and taken the first mesh's
material for geometry that does not want it. The offline pipeline guarantees one
primitive instead, and warns when it cannot.

### The asset library is not in git

**Decision:** `assets/textures`, `hdri`, `models`, `life`, `drones` and `cc0` are
gitignored. `tools/build_assets_zip.py` packs them into
`werkstadt-assets-v1.zip` with a `.sha256`, and `fetch_assets.py --release`
downloads and verifies it.

**Why.** 100 MB of binaries, and git keeps every version of a binary forever: one
re-fetch of one texture set would add another hundred megabytes to every clone
anybody ever makes. The tracked working tree is 14.97 MB instead of 115.28 MB.

**Cost.** Two steps to a running world instead of one, and a release asset that
has to be rebuilt and re-attached whenever the library changes. `server.py`
prints one line naming both commands when the library is not unpacked, so the
second step is discoverable from the first failure rather than from the README.

### A road vehicle has two dials, `height` and `length`

**Decision:** The five road vehicles in `life.js`'s `RIGID` catalogue carry a
`length` in real metres alongside `height`, and `_buildRigid()` applies it as a
stretch along the model's own long horizontal axis after the uniform height fit:
car 4.30 m, van 5.20 m, pickup 5.30 m, the box lorry 9.00 m, tractor 4.00 m.
Everything else in the file — every static, the robot, the drone — still has
`height` and nothing else.

**Why.** A uniform scale can only be right for a model whose proportions are
already right, and Kenney's are not: the sedan is 2.55 long against 1.3 tall, a
ratio of 1.96 where a real car is nearer 3.0. Fitted to a 1.45 m roof it came
out **2.84 m** long against the previous pack's 4.5 m. That is not cosmetic:
`populate()` sizes a lane's capacity off the longest vehicle the road may carry,
so a 41% short car packs 41% more of them onto the same street. Measured on
`life.html?stress=1`, before **76 placed / 4 dropped**, after **54 / 26** —
which is exactly the pre-CC0 pack's own numbers.

**Rejected — raising `height` until the length came out right.** It is one
dial, so it moves all three axes: a 4.3 m Kenney sedan is 2.19 m tall and 2.53 m
wide, taller than the van beside it and wider than its lane. The van row's own
comment already records that the roof height had to be lowered from 2.20 to 2.00
for exactly this reason.

**Rejected — putting the number in `assets/manifest.json`.** The manifest's
`heightUnits` and `extentUnits` are *measurements written by
`assets/fetch_assets.py`*, and neither `_buildRigid()` nor `landmarkScan()` uses
them to size anything — both fit off the geometry in front of them and read the
manifest only as a sanity check. Editing a measured row would change nothing on
screen and would be overwritten the next time the fetcher runs. The intent
belongs in the catalogue, next to `height`, which is where every other
size decision in the file already lives.

**Cost.** A stretch on one axis turns a cylindrical wheel into an ellipse in
side view. The factors are 1.13 (tractor) to 1.65 (lorry), which is visible in a
close side-on shot of the lorry and not at street distance. The alternative
errors were both worse and both wrong from every angle.

### The old history is a local branch, not a rewritten remote

**Decision:** `main` is a single root commit containing the whole current tree.
The five phase A-C commits are kept locally on `pre-squash` and are not pushed.

**Why.** The first of those commits carried the 103 MB asset library before it
was moved out of git, and git keeps a binary forever: `git count-objects` read
**100.78 MiB** of loose objects, and every clone anyone ever made would have
paid for it. A fresh single-branch clone of the new `main` fetches a **13.59
MiB** pack. The working tree it checks out is 17 MB.

**Cost.** The local `.git` is still ~101 MB, because `pre-squash` keeps those
blobs reachable — that is the price of not throwing the old history away, and it
is paid on one machine rather than by everybody who clones. Deleting the branch
and re-running `git gc --prune=now` is the whole of the cleanup if it is ever
wanted. The phase A-C commit messages are also no longer in the public history;
what they said is in this file and in `HANDOFF.md`, which is where a reader
actually looks.

### The shipped demo is a real session, not a synthetic one

**Decision:** `data/demo.json` — the fixture a bare `index.html` falls back to —
is the export of one real `claude.cmd -p` run, made in a throwaway English
project called `widget-shop` and exported with this repo's own
`tools/export_replay.py`. 32 events, 10 tool calls, 5.4 KB. It was not
hand-written and it was not stitched together out of pieces.

**Why.** The demo is the first thing a stranger sees, and the claim the whole
project makes is *this is your real work, drawn*. A hand-written fixture would
be a drawing of that claim rather than the claim itself, and it would drift: the
exporter's schema has already changed twice (`tool_end`, then the `id` join key),
and a synthetic file has nobody to notice. A real export is regenerated by
running the exporter again. The session was also *composed* rather than found —
four reads, four writes, one read of a file that does not exist, and a note
about it — so the fixture exercises the building pass, the crew, and the failed
tool call that stages an accident, which is the sequence most worth seeing first.

**Rejected — running it through `--redact`.** Redaction is the right tool for a
screen share and the wrong one here: it turns every building into `file-9e12.md`
and the town into `town-3f9a`, so the demo would show the shapes and hide the
one thing that makes them mean anything. It was not needed either — the project
is fictional stock and shipping data written for this purpose, with nothing on
it that belongs to anybody. The one machine-specific thing an export does carry,
the absolute path, was rewritten to `C:/projects/widget-shop` before the file was
committed; a grep for the real username, `Desktop`, `Users` and other
OS-specific profile folder names over the fixture returns zero, and the
throwaway project and its transcript were deleted.

**Rejected — dropping the two probes in `replay.js` instead.** That closes the
console and leaves the page saying "No session to replay yet" to somebody who
has just cloned the repository to look at it. Two lines either way; this way the
page has something to show.

**Cost.** The fixture carries the session's own prompt verbatim, and that prompt
opens "Reply in English only" — a real instruction to the model, and now the
first line of the demo's masthead and the browser tab. Trimming it would make
the file no longer a verbatim export, which is the property the whole entry is
about. It is also small and fixed in size: the demo is 55 seconds of one
project, not a tour, and anybody wanting more points `?project=` at their own.

### A demo session has to be long enough for the crowd to exist

**Decision:** The fixture is ten tool calls rather than the four the same story
needs.

**Why.** `replay.js` compresses any gap over `DEAD_AIR` (500 ms) to at most
`HOLD_MAX`, and `openingBudget` fast-forwards outright while no building has
printed. A five-tool-call session therefore replays in about two seconds, and
`life.js`'s crowd — models, graph cut, population fit — is not on the street
until about three. Measured: the first fixture built its five buildings by 2.0 s
and reported `lastError: null` forever, because the failing tool call had come
and gone before there was anybody to knock over. With ten calls the error lands
at 5.4 s and the accident runs: approach 5.40 s, hit 7.36 s, ambulance 9.37 s,
arrived 12.00 s, cleared 34.01 s.

**Cost.** The fixture is 5.4 KB rather than 2.5 KB, and the demo takes about
half a minute to reach its accident. Both are cheaper than a demo whose most
interesting feature never fires.

## 2026-09-08 — why "Werkstadt" and not the research shortlist
The research shortlist (Ludus / Agentopolis / Vantage) was checked before adoption: **Agentopolis** was already taken by two GitHub repos with the same concept (Claude Code agents as a city), and by the npm and PyPI package names. Werkstadt (German: Werk + Stadt, echoing Werkstatt) was free on npm and PyPI and had only unrelated 0-star GitHub hits; it also carries the studio's Tyrolean signature. Decided by the owner on 2026-09-08 after seeing the availability table.

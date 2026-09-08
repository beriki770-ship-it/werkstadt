# Publishing Werkstadt — the exact commands

_Verified: 2026-09-08_

Phase D prepared everything and deliberately stopped short of the network. This
file is the rest of it. Nothing here has been run; every command is written to
be pasted from the repository root.

Account: `gh auth status` on this machine reports a personal account, logged
in through the keyring, token scopes `gist, read:org, repo, workflow`. `repo`
is what creating the repository and the release both need, so no re-auth is
expected.

Before the first command, decide the owner. Everything below assumes
`beriki770-ship-it/werkstadt` — substitute the real account before running
anything. If it goes somewhere else, that string changes in step 1, in the
release URL in step 3 and in the four placeholder edits in step 4.

---

## Step 0 — the two things to check first

```
git log --oneline            # one commit, "Werkstadt 0.1.0 — …"
git status --short           # empty
du -sh .git                  # ~15 MB, not ~100
ls -la dist/                 # the zip and its .sha256 are both there
```

`dist/` is gitignored. The zip is not in the repository and must not become part
of it; it is uploaded as a release asset in step 3.

---

## Step 1 — create the repository and push

```
gh repo create beriki770-ship-it/werkstadt --public --source . --push
```

`--source .` adds the remote and `--push` sends `main`. It does not create a
README or a licence of its own, so nothing collides with the ones already here.

---

## Step 2 — nothing. Skip.

The release notes and the launch drafts are already written:
`docs/RELEASE-NOTES.md` and `docs/LAUNCH-POSTS.md`.

---

## Step 3 — the release, with the asset zip attached

```
gh release create v0.1.0 \
  dist/werkstadt-assets-v1.zip \
  dist/werkstadt-assets-v1.zip.sha256 \
  --title "Werkstadt 0.1.0 — a live 3D world for your Claude Code sessions" \
  --notes-file docs/RELEASE-NOTES.md
```

82 MB goes up, so give it a minute. The download URL that comes out of this is
fixed by the tag and the filename:

```
https://github.com/beriki770-ship-it/werkstadt/releases/download/v0.1.0/werkstadt-assets-v1.zip
```

The SHA-256 is already computed and lives in
`dist/werkstadt-assets-v1.zip.sha256`:

```
b96cc5909c53c4bec1b5c6e8be2e254a6fd702ebf6fde64372007e97d56eee34
```

---

## Step 4 — point the fetcher at the release, and fill the four placeholders

Five files, six lines. Nothing else in the tree carries a placeholder — this
list is `grep -rn "<repo>\|<owner>"` plus the two constants, run on the tree as
it stands.

| file | line | now | after |
|---|---|---|---|
| `assets/fetch_assets.py` | 1600 | `RELEASE_URL = ""` | `RELEASE_URL = "https://github.com/beriki770-ship-it/werkstadt/releases/download/v0.1.0/werkstadt-assets-v1.zip"` |
| `assets/fetch_assets.py` | 1601 | `RELEASE_SHA256 = ""` | `RELEASE_SHA256 = "b96cc5909c53c4bec1b5c6e8be2e254a6fd702ebf6fde64372007e97d56eee34"` |
| `README.md` | 53 | `git clone <repo> && cd werkstadt` | `git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt` |
| `README.md` | 84 | `/plugin marketplace add <owner>/<repo>` | `/plugin marketplace add beriki770-ship-it/werkstadt` |
| `CONTRIBUTING.md` | 6 | `git clone <repo> && cd werkstadt && python server.py` | `git clone https://github.com/beriki770-ship-it/werkstadt && cd werkstadt && python server.py` |
| `plugin/skills/werkstadt/SKILL.md` | 22 | `` `git clone <repo> werkstadt` `` | `` `git clone https://github.com/beriki770-ship-it/werkstadt werkstadt` `` |

The two constants are empty in the repository on purpose. A URL that points at a
release which does not exist yet fails as a 404 halfway through a download
instead of as a sentence, which is why `main_release()` checks for the empty
string and prints what to do instead.

Then:

```
git add assets/fetch_assets.py README.md CONTRIBUTING.md plugin/skills/werkstadt/SKILL.md
git commit -m "point the asset fetcher and the docs at the v0.1.0 release"
git push
```

---

## Step 5 — prove it from a clone that has never seen this machine

This is the one step worth not skipping, because it is the only thing that
tests the release URL rather than the local zip:

```
cd %TEMP%
git clone https://github.com/beriki770-ship-it/werkstadt wk-check
cd wk-check
python assets/fetch_assets.py --release
python server.py --no-browser --port 4953
```

The fetcher should print the download, then the hash check, then the unpack.
Open `globe.html`, `world.html`, `index.html` and `recordings.html` and expect
no console errors and no 4xx. Then delete `wk-check`.

The same run was already done in phase D against a `file://` URL and the local
zip, so what step 5 adds is the network and the hash of the artefact GitHub
actually stored. See `docs/TESTS.md`.

---

## Step 6 — the plugin from the remote

Phase C verified `claude plugin marketplace add <local folder>` and
`claude plugin install werkstadt@werkstadt --scope local`, and phase D did it
again from a clone. What has never been possible to test is the remote form,
because there was no remote:

```
/plugin marketplace add beriki770-ship-it/werkstadt
/plugin install werkstadt@werkstadt
```

Run it once, check `/plugin list` shows werkstadt 1.0.0 enabled, then remove it
again unless it is wanted permanently.

---

## Step 7 — the posts

`docs/LAUNCH-POSTS.md` holds four drafts for the maintainer to post: Show HN,
r/ClaudeAI, LinkedIn, and the one-line entry for an `awesome-claude-code` pull
request. None of them is scheduled or automated. Read them once against the live
repository before posting — the release-notes limits section is the honest part
and it should still be true on the day.

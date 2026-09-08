#!/usr/bin/env python3
"""Turn an Obsidian vault into data/vault.json for the 3D "vault city"
renderer. Stdlib only -- no PyYAML, so frontmatter is parsed with a small
line-based parser that covers exactly the shapes this vault actually uses
(scalar `key: value`, blank values, and one-level `- item` lists for tags).
The folder conventions it relies on are Obsidian's own plus four folder
names: Daily/, Projects/, Dev Logs/, People/, and Boards/ for kanban notes
(which carry a `kanban-plugin` frontmatter key). A vault without them still
exports; every note simply falls back to type "note".

Usage: python export_vault.py --vault "/path/to/your/vault"
"""
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

# Set by server.py from config.json ("vault") before it calls main(), and by
# --vault when this script is run on its own. There is deliberately no
# default: an Obsidian vault is one folder among thousands on any machine,
# and guessing at it would export the wrong tree in silence.
VAULT_ROOT = None
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "vault.json"

# Directories that are Obsidian/plugin plumbing, never vault content.
# The vault's actual trash folder is `_trash/`; `.trash/` is Obsidian's
# default name on other vaults, so both are excluded to be safe.
SKIP_DIRS = {".obsidian", ".trash", "_trash"}

# Folder name -> note type, used only when frontmatter has no `type` key
# (see the Folder Map in _CLAUDE.md). Anything not listed falls back to "note".
FOLDER_TYPE = {
    "Daily": "daily",
    "Projects": "project",
    "People": "person",
    "Dev Logs": "devlog",
    "Boards": "board",
}

CODEFENCE_RE = re.compile(r"```.*?```", re.S)
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
# Inline #tag: no space right after '#', which also naturally excludes ATX
# headings ("# Title", "## Title") since those always have a space after #.
INLINE_TAG_RE = re.compile(r"(?<!\S)#([A-Za-z][\w/-]*)")
TASK_OPEN_RE = re.compile(r"^[ \t]*-\s\[ \]", re.M)
TASK_DONE_RE = re.compile(r"^[ \t]*-\s\[[xX]\]", re.M)


def parse_frontmatter(text):
    """Split leading `---` YAML-ish frontmatter from the body. Returns
    (dict, body). Handles the vault's real shapes only (see module docstring)
    -- not general YAML, on purpose (nothing here needs more)."""
    text = text.lstrip("\ufeff")  # some notes carry a BOM before the first '---'
    lines = text.split("\n")
    i = 0
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    if i >= len(lines) or lines[i].strip() != "---":
        return {}, text
    start = i + 1
    end = None
    for j in range(start, len(lines)):
        if lines[j].strip() == "---":
            end = j
            break
    if end is None:
        return {}, text  # unterminated frontmatter -- treat whole file as body
    body = "\n".join(lines[end + 1:])
    fm = {}
    last_key = None
    for line in lines[start:end]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- ") and last_key is not None:
            val = stripped[2:].strip().strip('"').strip("'")
            if not isinstance(fm.get(last_key), list):
                fm[last_key] = []
            fm[last_key].append(val)
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", stripped)
        if m:
            key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
            fm[key] = val if val else None
            last_key = key
    return fm, body


def try_parse_date(raw):
    """Parse a frontmatter date/created value ("2026-08-27" or full ISO).
    Naive results are anchored to the system's local timezone via
    astimezone(), matching how the filesystem timestamps below are read."""
    s = str(raw).strip()
    try:
        dt = datetime.strptime(s, "%Y-%m-%d") if len(s) == 10 else datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone() if dt.tzinfo is None else dt
    except ValueError:
        return None


def extract_body_data(body):
    """One pass over a note's body (frontmatter already stripped) for
    everything word-count/tag/link/task related. Code fences are removed
    first so fenced examples never contribute words, tags or fake tasks."""
    no_code = CODEFENCE_RE.sub("", body)
    raw_link_targets = []
    for m in WIKILINK_RE.finditer(no_code):
        inner = m.group(1)
        target = inner.split("|", 1)[0].split("#", 1)[0].strip()  # drop alias, then heading
        if target:
            raw_link_targets.append(target)
    # Strip wikilinks before scanning for #tags so a heading link like
    # [[Note#Some Section]] can't be misread as an inline tag.
    text_no_links = WIKILINK_RE.sub("", no_code)
    inline_tags = [t.lower() for t in INLINE_TAG_RE.findall(text_no_links)]
    words = len(re.findall(r"\w+", no_code))
    tasks_open = len(TASK_OPEN_RE.findall(body))
    tasks_done = len(TASK_DONE_RE.findall(body))
    return raw_link_targets, inline_tags, words, tasks_open, tasks_done


def note_type(fm, top_folder):
    if "kanban-plugin" in fm:
        return "board"
    if fm.get("type"):
        return fm["type"]
    return FOLDER_TYPE.get(top_folder, "note")


def note_tags(fm):
    raw = fm.get("tags")
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        return [t.strip() for t in raw.strip("[]").split(",") if t.strip()]
    return []


def load_notes():
    """Walk the vault once, skip plugin/trash dirs, and return (notes, attachment_counts)."""
    notes = []
    attach_by_folder = {}
    for dirpath, dirnames, filenames in os.walk(VAULT_ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = Path(dirpath).relative_to(VAULT_ROOT)
        top_folder = "" if rel_dir == Path(".") else rel_dir.parts[0]
        for fname in filenames:
            if not fname.lower().endswith(".md"):
                attach_by_folder[top_folder] = attach_by_folder.get(top_folder, 0) + 1
                continue
            path = Path(dirpath) / fname
            rel = path.relative_to(VAULT_ROOT).as_posix()
            note_id = rel[:-3]  # strip ".md"
            parts = note_id.split("/")
            folder = parts[0] if len(parts) > 1 else ""
            subfolder = parts[1] if len(parts) > 2 else None

            raw = path.read_text(encoding="utf-8", errors="replace")
            fm, body = parse_frontmatter(raw)
            raw_links, inline_tags, words, tasks_open, tasks_done = extract_body_data(body)

            st = path.stat()
            ctime_dt = datetime.fromtimestamp(st.st_ctime).astimezone()  # Windows: real creation time
            mtime_dt = datetime.fromtimestamp(st.st_mtime).astimezone()
            fm_dt = try_parse_date(fm.get("created") or fm.get("date")) if (fm.get("created") or fm.get("date")) else None
            created_dt = min(ctime_dt, fm_dt) if fm_dt else ctime_dt

            tags = sorted(set(t.lower().lstrip("#") for t in note_tags(fm)) | set(inline_tags))

            notes.append({
                "id": note_id,
                "title": fm.get("title") or Path(fname).stem,
                "folder": folder,
                "subfolder": subfolder,
                "words": words,
                "created": created_dt.isoformat(),
                "modified": mtime_dt.isoformat(),
                "tags": tags,
                "type": note_type(fm, folder),
                "_raw_links": raw_links,  # resolved into "outlinks" after all notes are loaded
                "outlinks": [],
                "inlinks": 0,
                "orphan": True,
                "tasks_open": tasks_open,
                "tasks_done": tasks_done,
            })
    return notes, attach_by_folder


def resolve_links(notes):
    """Obsidian-style resolution: a bare basename resolves only when it is
    unique across the vault (shortest-path-when-unique); anything with a
    '/' in it, or a basename that isn't unique, must match an exact
    relative id. Non-matches are dropped and counted as unresolved."""
    basename_index = {}
    id_index = {}
    for n in notes:
        # NOT Path(n["id"]).stem: the ".md" is already gone from id, and several
        # real note titles contain a literal dot ("regional.tirol Demo"), which
        # Path.stem would misread as a file extension and truncate.
        base = n["id"].split("/")[-1].lower()
        basename_index.setdefault(base, []).append(n["id"])
        id_index[n["id"].lower()] = n["id"]

    duplicate_basenames = sum(1 for ids in basename_index.values() if len(ids) > 1)

    links = []
    unresolved = 0
    for n in notes:
        resolved_ids = set()
        for target in n["_raw_links"]:
            norm = target.replace("\\", "/").strip()
            if norm.lower().endswith(".md"):
                norm = norm[:-3]
            resolved = None
            if "/" in norm:
                candidate = id_index.get(norm.lower())
                if candidate is None:
                    # exact path may be relative to the note's own folder
                    joined = "/".join(n["id"].split("/")[:-1] + [norm]) if "/" in n["id"] else norm
                    candidate = id_index.get(joined.lower())
                resolved = candidate
            else:
                candidates = basename_index.get(norm.lower(), [])
                if len(candidates) == 1:
                    resolved = candidates[0]
                else:
                    resolved = id_index.get(norm.lower())  # falls back to an exact-path match by luck
            if resolved and resolved != n["id"]:
                resolved_ids.add(resolved)
            else:
                unresolved += 1
        n["outlinks"] = sorted(resolved_ids)
        for target_id in resolved_ids:
            links.append({"from": n["id"], "to": target_id})

    by_id = {n["id"]: n for n in notes}
    for link in links:
        by_id[link["to"]]["inlinks"] += 1
    for n in notes:
        n["orphan"] = n["inlinks"] == 0
        del n["_raw_links"]

    return links, unresolved, duplicate_basenames


def main():
    start = time.time()
    notes, attach_by_folder = load_notes()
    links, unresolved, duplicate_basenames = resolve_links(notes)

    by_type = {}
    for n in notes:
        by_type[n["type"]] = by_type.get(n["type"], 0) + 1

    timeline = sorted(({"t": n["created"], "id": n["id"]} for n in notes), key=lambda x: x["t"])

    data = {
        "root": VAULT_ROOT.name,
        "generated": datetime.now().astimezone().isoformat(),
        "counts": {
            "notes": len(notes),
            "attachments": sum(attach_by_folder.values()),
            "attachments_by_folder": attach_by_folder,
            "resolved": len(links),
            "unresolved": unresolved,
            "by_type": by_type,
            "duplicate_basenames": duplicate_basenames,
            "orphans": sum(1 for n in notes if n["orphan"]),
        },
        "notes": notes,
        "links": links,
        "timeline": timeline,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")

    elapsed = time.time() - start
    top_by_inlinks = sorted(notes, key=lambda n: n["inlinks"], reverse=True)[:5]
    folder_counts = {}
    for n in notes:
        folder_counts[n["folder"] or "(root)"] = folder_counts.get(n["folder"] or "(root)", 0) + 1

    print(f"notes={len(notes)} resolved_links={len(links)} unresolved_links={unresolved}")
    print("top5_by_inlinks=" + json.dumps([{"title": n["title"], "inlinks": n["inlinks"]} for n in top_by_inlinks], ensure_ascii=False))
    print("folder_counts=" + json.dumps(folder_counts, ensure_ascii=False))
    print(f"orphans={data['counts']['orphans']}")
    if timeline:
        print(f"oldest_created={timeline[0]['t']} newest_created={timeline[-1]['t']}")
    print(f"json_bytes={OUT_PATH.stat().st_size}")
    print(f"runtime_seconds={elapsed:.2f}")


if __name__ == "__main__":
    # Only the standalone run parses flags. server.py imports this module and
    # sets VAULT_ROOT itself from config.json, so argparse must not run there.
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--vault", required=True,
                    help="path to the Obsidian vault to export")
    VAULT_ROOT = Path(ap.parse_args().vault).expanduser()
    if not VAULT_ROOT.is_dir():
        raise SystemExit(f"not a directory: {VAULT_ROOT}")
    main()

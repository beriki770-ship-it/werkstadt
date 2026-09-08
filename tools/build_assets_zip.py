#!/usr/bin/env python3
"""
Pack the asset library into the zip that ships as a GitHub Release asset.

WHY THIS EXISTS. A clone of Werkstadt must be small enough that somebody tries
it: the code, the docs and the config are about 18 MB, and the textures, HDRIs
and models are another 100. Git keeps every version of a binary forever, so
committing them would mean a repository that grows by a hundred megabytes every
time one texture is re-fetched. They live in a Release instead, which is a plain
HTTP download with a hash beside it.

Two ways to get them into a fresh clone, and both end at the same files:
  * `python assets/fetch_assets.py`          re-downloads from the sources
  * `python assets/fetch_assets.py --release` pulls this zip and checks the hash

Usage: python tools/build_assets_zip.py [--out dist] [--version v1]
Writes dist/werkstadt-assets-<version>.zip and .zip.sha256.
"""
import argparse
import hashlib
import os
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(REPO, "assets")

# What goes in. Directories are taken whole; `manifest.json` and `CREDITS.md`
# are in the zip as well as in git ON PURPOSE, so an unzipped copy is
# self-describing and carries its own licence table.
PACK_DIRS = ["textures", "hdri", "models", "life", "cc0", "drones"]
PACK_FILES = ["manifest.json", "CREDITS.md"]

# What never goes in: the working caches. These are the downloaded source packs
# and the intermediate conversions -- a few hundred megabytes that exist only so
# a second run of fetch_assets.py does not re-download the internet.
SKIP_DIRS = {"_kenney_zips", "_quaternius_raw", "_cc0_raw", "__pycache__"}


def iter_files():
    for d in PACK_DIRS:
        root = os.path.join(ASSETS, d)
        if not os.path.isdir(root):
            print(f"  (no assets/{d}/ - skipped)")
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [x for x in dirnames if x not in SKIP_DIRS]
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                yield full, os.path.relpath(full, ASSETS).replace(os.sep, "/")
    for f in PACK_FILES:
        full = os.path.join(ASSETS, f)
        if os.path.exists(full):
            yield full, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(REPO, "dist"))
    ap.add_argument("--version", default="v1")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    zip_path = os.path.join(args.out, f"werkstadt-assets-{args.version}.zip")

    total = 0
    count = 0
    # ZIP_DEFLATED and not ZIP_STORED even though jpg/png/hdr barely compress:
    # the .glb files do (the meshopt buffers are the exception), and a zip that
    # says "deflate" opens in every tool a reader might reach for.
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for full, rel in iter_files():
            z.write(full, "assets/" + rel)
            total += os.path.getsize(full)
            count += 1
    if not count:
        print("nothing to pack - run assets/fetch_assets.py first", file=sys.stderr)
        sys.exit(1)

    digest = hashlib.sha256(open(zip_path, "rb").read()).hexdigest()
    with open(zip_path + ".sha256", "w", encoding="utf-8", newline="\n") as f:
        f.write(f"{digest}  {os.path.basename(zip_path)}\n")

    print(f"{zip_path}")
    print(f"  {count} files, {total/1e6:.1f} MB uncompressed, "
          f"{os.path.getsize(zip_path)/1e6:.1f} MB zipped")
    print(f"  sha256 {digest}")
    print()
    print("Next, at publish time:")
    print("  1. attach both files to the GitHub Release")
    print("  2. put the download URL in RELEASE_URL and the hash in "
          "RELEASE_SHA256, both in assets/fetch_assets.py")


if __name__ == "__main__":
    main()

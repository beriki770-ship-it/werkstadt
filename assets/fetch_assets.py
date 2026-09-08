#!/usr/bin/env python3
"""
Download a small CC0 asset pack from Poly Haven's public API for a realistic
Three.js world. Plain files only (jpg/png/hdr/glb) -- no zips executed, no
installers. Stdlib + PIL only.

Usage: python fetch_assets.py
Writes into ./textures/, ./hdri/, ./models/ (relative to this file).
"""
import json
import os
import re
import struct
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
TEX_DIR = os.path.join(BASE, "textures")
HDRI_DIR = os.path.join(BASE, "hdri")
MODEL_DIR = os.path.join(BASE, "models")
for d in (TEX_DIR, HDRI_DIR, MODEL_DIR):
    os.makedirs(d, exist_ok=True)

API = "https://api.polyhaven.com"
UA = "werkstadt-asset-fetch/1.0 (CC0 asset pack builder)"


def get_json(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2)


def download(url, dest_path, retries=3):
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return dest_path
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r, open(dest_path, "wb") as f:
                f.write(r.read())
            return dest_path
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2)


def fetch_bytes(url, retries=3):
    """Like download() but returns the bytes instead of writing a file --
    used to assemble a self-contained .glb in memory (see pack_glb)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2)


def pack_glb(gltf_json, raw_files, dest_path):
    """Poly Haven's model API serves a plain-text .gltf JSON that points at
    a separate .bin (mesh data) and loose texture files via 'include'. Fold
    all of that into one real, self-contained .glb: the mesh .bin goes into
    the BIN chunk unchanged (so existing bufferViews keep their offsets),
    then each texture is appended (4-byte aligned) with a new bufferView so
    images reference bufferView instead of an external uri."""
    buffers = gltf_json.get("buffers", [])
    combined = bytearray()
    if buffers and buffers[0].get("uri"):
        combined += raw_files[buffers[0]["uri"]]
        while len(combined) % 4:
            combined.append(0)
        buffers[0].pop("uri", None)
    mime_by_ext = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
    buffer_views = gltf_json.setdefault("bufferViews", [])
    for img in gltf_json.get("images", []):
        uri = img.pop("uri", None)
        if uri is None:
            continue
        data = raw_files[uri]
        offset = len(combined)
        combined += data
        while len(combined) % 4:
            combined.append(0)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        img["bufferView"] = len(buffer_views) - 1
        img["mimeType"] = mime_by_ext.get(os.path.splitext(uri)[1].lower(), "image/jpeg")
    if buffers:
        buffers[0]["byteLength"] = len(combined)
    else:
        gltf_json["buffers"] = [{"byteLength": len(combined)}]

    json_bytes = json.dumps(gltf_json).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    bin_bytes = bytes(combined)
    while len(bin_bytes) % 4:
        bin_bytes += b"\x00"
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(dest_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I", len(json_bytes)))
        f.write(b"JSON")
        f.write(json_bytes)
        f.write(struct.pack("<I", len(bin_bytes)))
        f.write(b"BIN\x00")
        f.write(bin_bytes)


# ---------------------------------------------------------------------------
# TEXTURES: semantic key -> polyhaven asset id
# ---------------------------------------------------------------------------
TEXTURES = {
    "grass": "leafy_grass",
    "forestFloor": "forest_floor",
    "cliff": "cliff_side",
    "cobble": "cobblestone_04",
    "asphalt": "asphalt_02",
    "roofTiles": "roof_tiles_14",
    "plaster": "painted_plaster_wall",
    "brick": "sandstone_blocks_04",
    "sand": "coast_sand_01",
}

# map channels we want, in priority order per asset (Poly Haven names vary)
WANT_CHANNELS = ["diffuse", "albedo", "Diffuse", "nor_gl", "normal", "rough", "roughness", "arm", "ao"]


def fetch_texture(key, asset_id, res="1k"):
    """Fetch exactly 3 maps per the brief: diffuse, normal (GL), and
    roughness-or-ARM (prefer ARM since it folds AO+rough+metal into one
    file and saves bytes toward the 80MB budget)."""
    info = get_json(f"{API}/files/{asset_id}")
    has_arm = "arm" in {m.lower() for m in info}
    saved = {}
    for maptype, variants in info.items():
        low = maptype.lower()
        if low in ("diffuse", "albedo", "col", "color"):
            role = "diffuse"
        elif low == "nor_gl":
            role = "normal"
        elif low == "arm" and has_arm:
            role = "arm"
        elif low == "rough" and not has_arm:
            role = "roughness"
        else:
            continue
        if res not in variants:
            continue
        entry = variants[res]
        fmt = None
        for f in ("jpg", "png"):
            if f in entry:
                fmt = f
                break
        if fmt is None:
            fmt = next(iter(entry))
        file_url = entry[fmt]["url"]
        fname = f"{asset_id}_{res}_{role}.{fmt}"
        dest = os.path.join(TEX_DIR, fname)
        download(file_url, dest)
        saved[role] = os.path.relpath(dest, BASE).replace(os.sep, "/")
        print(f"  [{key}] {role}: {fname} ({os.path.getsize(dest)} bytes)")
    return saved


# ---------------------------------------------------------------------------
# HDRIs
# ---------------------------------------------------------------------------
HDRIS = {
    "hdriDusk": None,   # filled by search
    "hdriNight": None,
}


def find_hdri(keyword):
    d = get_json(f"{API}/assets?t=hdris")
    candidates = [k for k in d if keyword in k.lower()]
    return candidates


def fetch_hdri(key, asset_id, res="1k"):
    info = get_json(f"{API}/files/{asset_id}")
    hdri_variants = info.get("hdri", {})
    if res not in hdri_variants:
        # fall back to lowest available
        res = sorted(hdri_variants.keys())[0]
    entry = hdri_variants[res]
    fmt = "hdr" if "hdr" in entry else next(iter(entry))
    file_url = entry[fmt]["url"]
    fname = f"{asset_id}_{res}.{fmt}"
    dest = os.path.join(HDRI_DIR, fname)
    download(file_url, dest)
    print(f"  [{key}] {asset_id}: {fname} ({os.path.getsize(dest)} bytes)")
    return os.path.relpath(dest, BASE).replace(os.sep, "/")


# ---------------------------------------------------------------------------
# MODELS
# ---------------------------------------------------------------------------
MODELS = {
    # semantic key -> polyhaven asset id (filled after search)
}


def fetch_model(key, asset_id, res="1k"):
    info = get_json(f"{API}/files/{asset_id}")
    gltf_variants = info.get("gltf", {})
    if res not in gltf_variants:
        res = sorted(gltf_variants.keys())[0]
    entry = gltf_variants[res]
    # Poly Haven gltf entries can be {'gltf': {...}} nested one more level per LOD (e.g. -no-lods)
    fmt_key = None
    for k in entry:
        if k.endswith("gltf") or k == "glb":
            fmt_key = k
            break
    if fmt_key is None:
        fmt_key = next(iter(entry))
    node = entry[fmt_key]
    fname = f"{asset_id}_{res}.glb"
    dest = os.path.join(MODEL_DIR, fname)
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        if fmt_key == "glb":
            download(node["url"], dest)
        else:
            # plain .gltf JSON + separate .bin/texture files (see 'include')
            # -- fold them into one real self-contained .glb (pack_glb)
            gltf_json = json.loads(fetch_bytes(node["url"]))
            raw_files = {rel: fetch_bytes(meta["url"]) for rel, meta in node.get("include", {}).items()}
            pack_glb(gltf_json, raw_files, dest)
    print(f"  [{key}] {asset_id}: {fname} ({os.path.getsize(dest)} bytes)")
    return os.path.relpath(dest, BASE)


# resolved via textures_list.json / hdris_list.json / models_list.json search
# (see docs/HANDOFF.md for how these ids were chosen)
HDRIS["hdriDusk"] = "qwantani_dusk_1"
HDRIS["hdriNight"] = "moonlit_golf"

# Poly Haven's model catalog has no tower/lighthouse/bridge/shed/market-stall
# subjects, and its available boat/tree assets ship an 8k-shared .bin mesh
# tens-to-hundreds of MB regardless of the "1k" texture pick -- both blow the
# 80MB/6MB-per-model budget. Falling back to Kenney (CC0, ships ready-made
# single-file .glb, no conversion needed) for all 5, per the brief's
# fallback clause.
KENNEY_KITS = {
    "castle-kit": "https://kenney.nl/media/pages/assets/castle-kit/a395102d20-1711543616/kenney_castle-kit.zip",
    "fantasy-town-kit": "https://kenney.nl/media/pages/assets/fantasy-town-kit/efe948d309-1754222374/kenney_fantasy-town-kit_2.0.zip",
    "nature-kit": "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip",
    "pirate-kit": "https://kenney.nl/media/pages/assets/pirate-kit/e6d4bb1525-1771333093/kenney_pirate-kit.zip",
}
KENNEY_MODELS = {
    # semantic key -> (kit, path inside zip, output filename)
    "model.tower": ("castle-kit", "Models/GLB format/wall-corner-half-tower.glb", "kenney_castle-kit_wall-corner-half-tower.glb"),
    "model.bridge": ("castle-kit", "Models/GLB format/bridge-straight.glb", "kenney_castle-kit_bridge-straight.glb"),
    "model.tree": ("nature-kit", "Models/GLTF format/tree_detailed.glb", "kenney_nature-kit_tree_detailed.glb"),
    "model.boat": ("pirate-kit", "Models/GLB format/ship-pirate-medium.glb", "kenney_pirate-kit_ship-pirate-medium.glb"),
    "model.shed": ("fantasy-town-kit", "Models/GLB format/stall.glb", "kenney_fantasy-town-kit_stall.glb"),
}
KENNEY_ZIP_DIR = os.path.join(BASE, "_kenney_zips")


def fetch_kenney_models():
    import zipfile
    os.makedirs(KENNEY_ZIP_DIR, exist_ok=True)
    needed_kits = {kit for kit, _, _ in KENNEY_MODELS.values()}
    for kit in needed_kits:
        zpath = os.path.join(KENNEY_ZIP_DIR, f"{kit}.zip")
        download(KENNEY_KITS[kit], zpath)
    out = {}
    for key, (kit, inner, fname) in KENNEY_MODELS.items():
        z = zipfile.ZipFile(os.path.join(KENNEY_ZIP_DIR, f"{kit}.zip"))
        data = z.read(inner)
        dest = os.path.join(MODEL_DIR, fname)
        with open(dest, "wb") as f:
            f.write(data)
        out[key] = {
            "path": os.path.relpath(dest, BASE).replace(os.sep, "/"),
            "bytes": len(data),
            "kit": kit,
        }
        print(f"  [{key}] {kit}/{inner}: {fname} ({len(data)} bytes)")
    return out


def generate_water_normal(size=512):
    """Poly Haven has no tileable water normal map; synthesize one with a
    seamless sum-of-sines ripple field so PIL's own PBR normal-mapping
    convention (RGB = XYZ, Z-up, tangent space) still looks right at runtime."""
    from PIL import Image
    import math
    img = Image.new("RGB", (size, size))
    px = img.load()
    waves = [
        (0.031, 0.017, 1.0),
        (-0.019, 0.028, 0.6),
        (0.012, -0.034, 0.4),
    ]
    for y in range(size):
        for x in range(size):
            # analytic height-field gradient at (x,y) from the same sines,
            # so normals stay consistent and tile seamlessly at period `size`
            dhdx = dhdy = 0.0
            for fx, fy, amp in waves:
                phase = 2 * math.pi * (fx * x + fy * y)
                dhdx += amp * fx * math.cos(phase)
                dhdy += amp * fy * math.cos(phase)
            nx, ny, nz = -dhdx, -dhdy, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / length, ny / length, nz / length
            r = int((nx * 0.5 + 0.5) * 255)
            g = int((ny * 0.5 + 0.5) * 255)
            b = int((nz * 0.5 + 0.5) * 255)
            px[x, y] = (r, g, b)
    dest = os.path.join(TEX_DIR, "water_normal_generated_1k.png")
    img.save(dest)
    print(f"  [waterNormal] generated (PIL, no Poly Haven source): water_normal_generated_1k.png ({os.path.getsize(dest)} bytes)")
    return os.path.relpath(dest, BASE).replace(os.sep, "/")


def build_manifest_and_credits(tex_paths, tex_meta, hdri_paths, hdri_meta, model_paths, water_path):
    manifest = {}
    credit_rows = []

    for key, aid in TEXTURES.items():
        maps = tex_paths[key]
        meta = tex_meta[aid]
        mm = meta.get("dimensions", [None, None])[0]
        manifest[key] = {
            "diffuse": maps.get("diffuse"),
            "normal": maps.get("normal"),
            "roughness": maps.get("arm") or maps.get("roughness"),
            "roughnessChannel": "g" if "arm" in maps else None,
            "aoChannel": "r" if "arm" in maps else None,
            "metresPerTile": round(mm / 1000, 3) if mm else None,
        }
        size = sum(os.path.getsize(os.path.join(BASE, p)) for p in maps.values())
        credit_rows.append((
            aid, ", ".join(meta.get("authors", {}).keys()),
            f"https://polyhaven.com/a/{aid}", "CC0", "1K", size,
        ))

    manifest["waterNormal"] = {"path": water_path, "metresPerTile": None}
    credit_rows.append((
        "water_normal_generated", "generated (PIL, sum-of-sines)", "n/a (no Poly Haven source)",
        "CC0 (own generation)", "1K", os.path.getsize(os.path.join(BASE, water_path)),
    ))

    for key, aid in HDRIS.items():
        p = hdri_paths[key]
        meta = hdri_meta[aid]
        manifest[key] = {"path": p}
        credit_rows.append((
            aid, ", ".join(meta.get("authors", {}).keys()),
            f"https://polyhaven.com/a/{aid}", "CC0", "1K", os.path.getsize(os.path.join(BASE, p)),
        ))

    for key, info in model_paths.items():
        manifest[key] = {"path": info["path"]}
        credit_rows.append((
            f'Kenney {info["kit"]}', "Kenney (www.kenney.nl)",
            f'https://kenney.nl/assets/{info["kit"]}', "CC0", "n/a (game-ready mesh)", info["bytes"],
        ))

    with open(os.path.join(BASE, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    lines = [
        "# CREDITS",
        "",
        "CC0 asset pack for a realistic Three.js world. All assets below are",
        "public domain (CC0) -- no attribution legally required, credited here",
        "for provenance.",
        "",
        "| id | author | source | license | resolution | bytes |",
        "|---|---|---|---|---|---|",
    ]
    total = 0
    for row in credit_rows:
        aid, author, src, lic, res, size = row
        total += size
        lines.append(f"| {aid} | {author} | {src} | {lic} | {res} | {size:,} |")
    lines += ["", f"**Total: {total:,} bytes ({total/1e6:.2f} MB)**"]
    with open(os.path.join(BASE, "CREDITS.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return total


def main():
    tex_list = json.load(open(os.path.join(BASE, "textures_list.json"), encoding="utf-8"))
    hdri_list = json.load(open(os.path.join(BASE, "hdris_list.json"), encoding="utf-8"))

    print("== Textures ==")
    tex_paths = {}
    for key, aid in TEXTURES.items():
        print(f"{key} <- {aid}")
        tex_paths[key] = fetch_texture(key, aid)

    print("== Water normal (generated) ==")
    water_path = generate_water_normal()

    print("== HDRIs ==")
    hdri_paths = {}
    for key, aid in HDRIS.items():
        print(f"{key} <- {aid}")
        hdri_paths[key] = fetch_hdri(key, aid)

    print("== Models (Kenney, CC0 fallback) ==")
    model_paths = fetch_kenney_models()

    print("== Manifest + Credits ==")
    total = build_manifest_and_credits(
        tex_paths, tex_list, hdri_paths, hdri_list, model_paths, water_path,
    )
    print(f"TOTAL: {total} bytes ({total/1e6:.2f} MB)")


# ---------------------------------------------------------------------------
# EXTENSION (2026-09-06): more realistic (non-cartoon) models + terrain
# textures + HDRIs, all from Poly Haven (CC0, direct-file API, no login).
# ambientCG was checked too (api/v2/full_json) -- its "3DModel" dataType is
# 34 food-prop assets only (3DApple001 etc, verified by listing every
# dataType!="Material" asset across the catalog), so it has nothing usable
# for buildings/props here; Poly Haven's model catalog covers this instead.
# Reuses fetch_texture / fetch_hdri / fetch_model above unchanged -- only
# new semantic-key -> asset-id maps and a merge step are added.
# ---------------------------------------------------------------------------

# 4 more terrain textures: snow, a second rock-cliff face, farmland
# (ploughed furrows), gravel road. All ship an ARM map on Poly Haven.
TEXTURES_V2 = {
    "snow": "snow_01",
    "rockCliffB": "rock_face",
    "farmland": "farm_furrows",
    "gravelRoad": "gravel_road",
}

# 2 more HDRIs: a bright clear day and a flat overcast sky, both 1k.
HDRIS_V2 = {
    "hdriClearDay": "kloofendal_43d_clear",
    "hdriOvercast": "kloofendal_overcast",
}

# Realistic (photogrammetry-based) Poly Haven models, each verified via
# /files/<id> to have a 1k glTF (glb + .bin) totalling <=12MB (<=8MB for
# treeReal) before download. Poly Haven's model catalog has no house/
# cottage/townhouse/barn/church/tower subject at all (confirmed by keyword
# search over the full 521-model list) -- those keys stay unfilled, see
# CREDITS.md / the run report for the full unfilled list.
MODELS_V2 = {
    "model.lamppost": "street_lamp_01",
    "model.bench": "painted_wooden_bench",
    "model.fence": "modular_chainlink_fence",
    "model.cart": "tool_cart",
    "model.boatReal": "dutch_ship_medium",
    "model.treeReal": "quiver_tree_02",
    "model.bush": "wild_rooibos_bush",
    "model.rockA": "rock_07",
    "model.rockB": "rock_face_01",
    "model.barrel": "wine_barrel_01",
    "model.crate": "wooden_crate_01",
    "model.tank": "propane_tank",
    "model.pipe": "modular_pipes",
}


def validate_glb(path):
    """Parse the GLB container by hand (stdlib only): check the 'glTF'
    magic + version + a JSON chunk, then sum triangle counts from the
    JSON chunk's accessors (indexed TRIANGLES primitives, mode 4 is the
    glTF default) without touching the binary mesh/image buffer."""
    with open(path, "rb") as f:
        data = f.read()
    if data[0:4] != b"glTF":
        return {"valid": False, "error": "bad GLB magic"}
    version = int.from_bytes(data[4:8], "little")
    chunk_len = int.from_bytes(data[12:16], "little")
    chunk_type = data[16:20]
    if chunk_type != b"JSON":
        return {"valid": False, "error": "first chunk is not JSON"}
    gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    accessors = gltf.get("accessors", [])
    meshes = gltf.get("meshes", [])
    tris = 0
    for m in meshes:
        for prim in m.get("primitives", []):
            if prim.get("mode", 4) != 4:  # 4 == TRIANGLES
                continue
            if "indices" in prim:
                tris += accessors[prim["indices"]]["count"] // 3
            else:
                tris += accessors[prim["attributes"]["POSITION"]]["count"] // 3
    return {
        "valid": True,
        "version": version,
        "mesh_count": len(meshes),
        "triangles": tris,
        "n_images": len(gltf.get("images", [])),
    }


def extend_manifest_and_credits(tex_paths, tex_meta, hdri_paths, hdri_meta, model_info):
    """Merge the extension assets into the existing manifest.json / CREDITS.md
    in place -- same per-row shape as build_manifest_and_credits, appended
    rather than rebuilt, so the original (Kenney/first-batch) entries are
    left untouched."""
    manifest_path = os.path.join(BASE, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    new_rows = []

    for key, aid in TEXTURES_V2.items():
        maps = tex_paths[key]
        meta = tex_meta[aid]
        mm = meta.get("dimensions", [None, None])[0]
        manifest[key] = {
            "diffuse": maps.get("diffuse"),
            "normal": maps.get("normal"),
            "roughness": maps.get("arm") or maps.get("roughness"),
            "roughnessChannel": "g" if "arm" in maps else None,
            "aoChannel": "r" if "arm" in maps else None,
            "metresPerTile": round(mm / 1000, 3) if mm else None,
        }
        size = sum(os.path.getsize(os.path.join(BASE, p)) for p in maps.values())
        new_rows.append((
            aid, ", ".join(meta.get("authors", {}).keys()),
            f"https://polyhaven.com/a/{aid}", "CC0", "1K", size,
        ))

    for key, aid in HDRIS_V2.items():
        p = hdri_paths[key]
        meta = hdri_meta[aid]
        manifest[key] = {"path": p}
        new_rows.append((
            aid, ", ".join(meta.get("authors", {}).keys()),
            f"https://polyhaven.com/a/{aid}", "CC0", "1K", os.path.getsize(os.path.join(BASE, p)),
        ))

    for key, info in model_info.items():
        manifest[key] = {"path": info["path"]}
        tris = info["check"].get("triangles") if info["check"].get("valid") else "?"
        res_note = f"mesh, {tris} tris"
        new_rows.append((
            info["aid"], ", ".join(info["authors"].keys()),
            f'https://polyhaven.com/a/{info["aid"]}', "CC0", res_note, info["bytes"],
        ))

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    credits_path = os.path.join(BASE, "CREDITS.md")
    lines = open(credits_path, encoding="utf-8").read().splitlines()
    total_idx = next(i for i, l in enumerate(lines) if l.startswith("**Total:"))
    prior_total = int(lines[total_idx].split("Total: ")[1].split(" bytes")[0].replace(",", ""))
    new_lines = [f"| {aid} | {author} | {src} | {lic} | {res} | {size:,} |" for aid, author, src, lic, res, size in new_rows]
    added = sum(r[5] for r in new_rows)
    total = prior_total + added
    lines = lines[:total_idx - 1] + new_lines + [lines[total_idx - 1]] + [f"**Total: {total:,} bytes ({total/1e6:.2f} MB)**"]
    with open(credits_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return added, total


def main_extend():
    tex_list = json.load(open(os.path.join(BASE, "textures_list.json"), encoding="utf-8"))
    hdri_list = json.load(open(os.path.join(BASE, "hdris_list.json"), encoding="utf-8"))
    model_list = json.load(open(os.path.join(BASE, "models_list.json"), encoding="utf-8"))

    print("== Extension textures ==")
    tex_paths = {}
    for key, aid in TEXTURES_V2.items():
        print(f"{key} <- {aid}")
        tex_paths[key] = fetch_texture(key, aid)

    print("== Extension HDRIs ==")
    hdri_paths = {}
    for key, aid in HDRIS_V2.items():
        print(f"{key} <- {aid}")
        hdri_paths[key] = fetch_hdri(key, aid)

    print("== Extension models (Poly Haven, realistic subjects) ==")
    model_info = {}
    for key, aid in MODELS_V2.items():
        rel_path = fetch_model(key, aid)
        abs_path = os.path.join(BASE, rel_path)
        check = validate_glb(abs_path)
        print(f"  [{key}] {aid}: valid={check.get('valid')} meshes={check.get('mesh_count')} tris={check.get('triangles')}")
        model_info[key] = {
            "path": rel_path.replace(os.sep, "/"),
            "aid": aid,
            "authors": model_list[aid].get("authors", {}),
            "bytes": os.path.getsize(abs_path),
            "check": check,
        }

    print("== Merge into manifest.json + CREDITS.md ==")
    added, total = extend_manifest_and_credits(tex_paths, tex_list, hdri_paths, hdri_list, model_info)
    print(f"ADDED: {added} bytes ({added/1e6:.2f} MB); PACK TOTAL: {total} bytes ({total/1e6:.2f} MB)")


# ---------------------------------------------------------------------------
# LIFE PACK (2026-09-06): CC0 *animated* characters, animals, vehicles and a
# robot for life.js. Source: Quaternius (quaternius.com), CC0, no login.
#
# Why this is not another Poly Haven block: Poly Haven ships no rigged or
# animated model at all -- every asset in its model catalog is a static scan.
# Quaternius is the only CC0 source checked here that publishes skinned meshes
# with named clips, and it publishes them as public Google Drive folders rather
# than as a direct zip. So the fetch is: list the folder (Drive's own
# embeddedfolderview HTML, no API key), resolve a file BY NAME, download it.
# Resolving by name rather than hard-coding file ids means the fetch still works
# if Quaternius re-uploads a pack.
#
# Two conversions are needed, and which one applies is a property of the pack:
#   * packs that ship a glTF folder (Ultimate Animated Character, Ultimate
#     Animated Animals) give a .gltf with a base64 data: URI buffer -- 2 MB of
#     text for 1.5 MB of mesh. gltf_json_to_glb() re-wraps it as a real binary
#     .glb, which is what every other model in this pack is.
#   * packs that ship NO glTF folder (Cars, Public Transport, Animated Robot --
#     verified by listing all four format folders of each) only have FBX and
#     OBJ. FBX is the one of the two that carries the animation, so those go
#     through Blender's own headless converter. Blender 5.1 is installed on this
#     machine; without it this whole group is skipped with a loud message rather
#     than silently producing static models.
# ---------------------------------------------------------------------------

QUATERNIUS_LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"

# Drive folder listing. The embedded folder view is a plain HTML page that needs
# no API key and no login for a publicly shared folder; every entry carries its
# own file id in the wrapper div, which is all a direct download needs.
_DRIVE_ENTRY = re.compile(
    r'<div class="flip-entry" id="entry-([A-Za-z0-9_-]+)"(.*?)<div class="flip-entry-title">(.*?)</div>',
    re.S,
)


def drive_list(folder_id, retries=3):
    """{filename: file_id} for one public Drive folder."""
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                html = r.read().decode("utf-8", "replace")
            break
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2)
    return {m.group(3): m.group(1) for m in _DRIVE_ENTRY.finditer(html)}


def drive_download(file_id, dest_path, retries=3):
    """Download one Drive file by id. These are all a few MB, so none of them
    trips Drive's virus-scan interstitial (which only fires above ~100 MB) --
    the response is the file itself. The size check below is what would catch
    it if that ever changed: an interstitial is a few KB of HTML."""
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return dest_path
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for i in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            if len(data) < 4096 and b"<html" in data[:512].lower():
                raise RuntimeError("Drive returned an HTML interstitial, not the file")
            with open(dest_path, "wb") as f:
                f.write(data)
            return dest_path
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2)


def gltf_json_to_glb(src_path, dest_path):
    """Re-wrap a text .gltf whose buffers/images are base64 `data:` URIs as a
    binary .glb. Same container writer as pack_glb() above, but the bytes come
    out of the data URI instead of off the network."""
    import base64

    gltf = json.loads(open(src_path, encoding="utf-8").read())

    def decode(uri):
        return base64.b64decode(uri.split(",", 1)[1])

    combined = bytearray()
    buffers = gltf.get("buffers", [])
    if buffers and buffers[0].get("uri", "").startswith("data:"):
        combined += decode(buffers[0].pop("uri"))
        while len(combined) % 4:
            combined.append(0)
    buffer_views = gltf.setdefault("bufferViews", [])
    for img in gltf.get("images", []):
        uri = img.get("uri")
        if not uri or not uri.startswith("data:"):
            continue
        img.pop("uri")
        mime = uri.split(";", 1)[0].split(":", 1)[1]
        data = decode(uri)
        offset = len(combined)
        combined += data
        while len(combined) % 4:
            combined.append(0)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        img["bufferView"] = len(buffer_views) - 1
        img["mimeType"] = mime
    if buffers:
        buffers[0]["byteLength"] = len(combined)
    else:
        gltf["buffers"] = [{"byteLength": len(combined)}]

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    bin_bytes = bytes(combined)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(dest_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I", len(json_bytes)))
        f.write(b"JSON")
        f.write(json_bytes)
        f.write(struct.pack("<I", len(bin_bytes)))
        f.write(b"BIN\x00")
        f.write(bin_bytes)
    return dest_path


BLENDER_CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    "blender",
]


def find_blender():
    import shutil
    for c in BLENDER_CANDIDATES:
        if os.path.sep in c:
            if os.path.exists(c):
                return c
        elif shutil.which(c):
            return shutil.which(c)
    return None


_FBX2GLB_SCRIPT = """
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=argv[0])
bpy.ops.export_scene.gltf(filepath=argv[1], export_format='GLB',
                          export_animations=True, export_skins=True,
                          export_yup=True, export_materials='EXPORT')
"""


def fbx_to_glb(src_path, dest_path):
    """Convert one .fbx to .glb, animations included, through headless Blender.
    Written because the three CC0 packs that have the vehicles and the robot
    publish no glTF at all, and an FBX loaded in the browser would mean a second
    loader and a megabyte of parser for five models."""
    import subprocess, tempfile
    blender = find_blender()
    if not blender:
        raise RuntimeError(
            "Blender not found -- cannot convert FBX. Install Blender or drop "
            "the FBX-sourced entries from LIFE_MODELS."
        )
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(_FBX2GLB_SCRIPT)
        script = f.name
    try:
        r = subprocess.run(
            [blender, "--background", "--factory-startup", "--python", script,
             "--", os.path.abspath(src_path), os.path.abspath(dest_path)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
        )
        if not os.path.exists(dest_path):
            raise RuntimeError(f"Blender wrote no file:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
    finally:
        os.unlink(script)
    return dest_path


# semantic key -> (pack slug, format folder id, filename in that folder, source)
# `src` is 'gltf' (data-URI .gltf, re-wrapped locally) or 'fbx' (Blender).
# The pack slug is only used to build the credit row's URL.
LIFE_MODELS = {
    # --- people: skinned, 17 clips each (Idle, Walk, Run, SitDown, ...) ------
    "life.human.casualM": ("ultimatedanimatedcharacter", "1UNNT0MeVX0O04RGgu8aLkKe3fwB9_t-A", "Casual_Male.gltf", "gltf"),
    "life.human.casualF": ("ultimatedanimatedcharacter", "1UNNT0MeVX0O04RGgu8aLkKe3fwB9_t-A", "Casual_Female.gltf", "gltf"),
    "life.human.suitM": ("ultimatedanimatedcharacter", "1UNNT0MeVX0O04RGgu8aLkKe3fwB9_t-A", "Suit_Male.gltf", "gltf"),
    "life.human.workerF": ("ultimatedanimatedcharacter", "1UNNT0MeVX0O04RGgu8aLkKe3fwB9_t-A", "Worker_Female.gltf", "gltf"),
    # --- animals: skinned, 13 clips each (Idle, Walk, Gallop, Eating, ...) ---
    "life.animal.cow": ("ultimateanimatedanimals", "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry", "Cow.gltf", "gltf"),
    "life.animal.horse": ("ultimateanimatedanimals", "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry", "Horse.gltf", "gltf"),
    "life.animal.dog": ("ultimateanimatedanimals", "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry", "Husky.gltf", "gltf"),
    # Quaternius has no CC0 animated SHEEP and no animated CAT: its Farm Animals
    # pack is static (one .blend per animal, no rig) and the animated animals
    # pack is Alpaca/Bull/Cow/Deer/Donkey/Fox/Horse/Husky/ShibaInu/Stag/Wolf.
    # The Alpaca is the woolly grazer of that list and the Fox is its only
    # cat-sized animal, so they stand in -- see docs/LIFE.md.
    "life.animal.sheep": ("ultimateanimatedanimals", "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry", "Alpaca.gltf", "gltf"),
    "life.animal.cat": ("ultimateanimatedanimals", "1yJXdB1iSrI8Db7hG77zxZ66vKsqIt0ry", "Fox.gltf", "gltf"),
    # --- vehicles: rigid, no clips; wheels are spun in code --------------
    "life.car.hatch": ("cars", "1cjhc5GgiFR_pqPINeW99XDeWc62FWDlY", "NormalCar1.fbx", "fbx"),
    "life.car.sedan": ("cars", "1cjhc5GgiFR_pqPINeW99XDeWc62FWDlY", "NormalCar2.fbx", "fbx"),
    "life.car.suv": ("cars", "1cjhc5GgiFR_pqPINeW99XDeWc62FWDlY", "SUV.fbx", "fbx"),
    "life.car.taxi": ("cars", "1cjhc5GgiFR_pqPINeW99XDeWc62FWDlY", "Taxi.fbx", "fbx"),
    "life.car.van": ("publictransport", "1VD5Lcu7URgyjtpDSKBXYu3jcLwA79YW6", "Ambulance.fbx", "fbx"),
    "life.bicycle": ("publictransport", "1VD5Lcu7URgyjtpDSKBXYu3jcLwA79YW6", "Bicycle.fbx", "fbx"),
    # --- robot: skinned, 14 clips (Walking, Idle, Wave, Dance, ...) ----------
    "life.robot": ("animatedrobot", "1sYGxzkiEc3JoFknyMex7dlTCS6-0uvbH", "Robot.fbx", "fbx"),
}

LIFE_RAW_DIR = os.path.join(BASE, "_quaternius_raw")
LIFE_MODEL_DIR = os.path.join(BASE, "life")   # assets/life/, per the brief


def clip_names(glb_path):
    """The animation clip names inside a .glb, read straight out of the JSON
    chunk. This is the check that a model marked 'animated' really is: a GLB
    with `animations: []` is a static model pretending to walk."""
    with open(glb_path, "rb") as f:
        data = f.read()
    chunk_len = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    names = []
    for a in gltf.get("animations", []):
        n = a.get("name", "")
        # Blender's FBX path prefixes every clip with 'Armature|Armature|'
        names.append(n.split("|")[-1] if "|" in n else n)
    return names


def fetch_life_models():
    os.makedirs(LIFE_RAW_DIR, exist_ok=True)
    os.makedirs(LIFE_MODEL_DIR, exist_ok=True)
    listings = {}
    out = {}
    for key, (pack, folder, fname, src) in LIFE_MODELS.items():
        if folder not in listings:
            listings[folder] = drive_list(folder)
        entries = listings[folder]
        if fname not in entries:
            raise RuntimeError(f"{key}: '{fname}' is not in Drive folder {folder}; "
                               f"the pack was re-uploaded. Folder holds: {sorted(entries)[:12]}")
        raw = os.path.join(LIFE_RAW_DIR, fname)
        drive_download(entries[fname], raw)
        stem = os.path.splitext(fname)[0].lower()
        dest = os.path.join(LIFE_MODEL_DIR, f"quaternius_{pack}_{stem}.glb")
        if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
            (gltf_json_to_glb if src == "gltf" else fbx_to_glb)(raw, dest)
        check = validate_glb(dest)
        clips = clip_names(dest)
        print(f"  [{key}] {pack}/{fname}: valid={check.get('valid')} "
              f"tris={check.get('triangles')} clips={len(clips)} "
              f"({os.path.getsize(dest)} bytes)")
        out[key] = {
            "path": os.path.relpath(dest, BASE).replace(os.sep, "/"),
            "pack": pack, "file": fname, "bytes": os.path.getsize(dest),
            "check": check, "clips": clips,
        }
    return out


def extend_manifest_and_credits_life(model_info):
    """Same append-in-place shape as extend_manifest_and_credits(): the manifest
    gains one `{path, clips}` entry per model and CREDITS.md gains one row per
    model above its total line. `clips` is in the manifest and not only in the
    docs because life.js picks a clip by name and has to fail loudly, at load,
    if a re-uploaded pack renamed one."""
    manifest_path = os.path.join(BASE, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    new_rows = []
    for key, info in model_info.items():
        manifest[key] = {"path": info["path"], "clips": info["clips"]}
        tris = info["check"].get("triangles") if info["check"].get("valid") else "?"
        new_rows.append((
            f'Quaternius {info["pack"]} / {info["file"]}',
            "Quaternius (quaternius.com)",
            f'https://quaternius.com/packs/{info["pack"]}.html',
            "CC0",
            f'mesh, {tris} tris, {len(info["clips"])} clips',
            info["bytes"],
        ))
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    credits_path = os.path.join(BASE, "CREDITS.md")
    lines = open(credits_path, encoding="utf-8").read().splitlines()
    total_idx = next(i for i, l in enumerate(lines) if l.startswith("**Total:"))
    prior_total = int(lines[total_idx].split("Total: ")[1].split(" bytes")[0].replace(",", ""))
    # Idempotent: a second `--life` run must not append a second copy of every
    # row and double the pack total. Rows are keyed on their first column, which
    # names the pack and the file and is unique.
    have = {l.split("|")[1].strip() for l in lines if l.startswith("| ")}
    new_rows = [r for r in new_rows if r[0] not in have]
    if not new_rows:
        return 0, prior_total
    new_lines = [f"| {a} | {b} | {c} | {d} | {e} | {s:,} |" for a, b, c, d, e, s in new_rows]
    added = sum(r[5] for r in new_rows)
    total = prior_total + added
    lines = lines[:total_idx - 1] + new_lines + [lines[total_idx - 1]] + \
        [f"**Total: {total:,} bytes ({total/1e6:.2f} MB)**"]
    with open(credits_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return added, total


def main_life():
    print("== Life pack (Quaternius, CC0 animated) ==")
    info = fetch_life_models()
    print("== Merge into manifest.json + CREDITS.md ==")
    added, total = extend_manifest_and_credits_life(info)
    print(f"ADDED: {added} bytes ({added/1e6:.2f} MB); PACK TOTAL: {total} bytes ({total/1e6:.2f} MB)")


# ---------------------------------------------------------------------------
# CC0 REPLACEMENT SET (2026-09-08, phase B of the public release)
#
# WHY THIS BLOCK EXISTS. The thirty-five `model.hy.*` rows above this line were
# generated on a hosted Tencent Hunyuan 3D account. The open-weights licence
# that would have covered their outputs excludes the EU by its own first
# sentence, and the hosted service's terms could not be retrieved at all, so
# there is no clause anybody can quote that grants redistribution -- see
# docs/PUBLISH-RESEARCH.md section 4. A public repository cannot ship files in
# that state, so this stage rebuilds the same manifest KEYS out of CC0 packs
# whose licence line is printed on the vendor's own asset page.
#
# The keys are deliberately still called `model.hy.*`. Renaming them would
# touch four renderers and seventy-two call sites for no behaviour change, and
# the prefix is now simply the name of the catalogue, not of a generator.
#
# WHAT IT DOES NOT DO. Five subjects and the thirteen landmark buildings have
# no CC0 equivalent in the packs checked (Kenney's kits, Quaternius's packs,
# Poly Haven's model catalogue): a parrot, a chicken, a bus shelter, a
# playground. Those keys are DROPPED from the manifest rather than filled with
# something that is not the thing. Every consumer of a missing key skips it --
# see Life.load(), world.js glbOpt() and globe.js landmarkGeo(), which falls
# back to the procedural TRADE_FORMS shed.
#
# WHY IT ALSO REWRITES THE FOUR ORIGINAL KENNEY MODELS. Kenney's "GLB format"
# folder ships models whose texture is an EXTERNAL `Textures/colormap.png`.
# Extracting the .glb alone -- which is what the first run did -- gives four
# models that request a file nobody copied: four 404s and four untextured white
# props. Routing them through the same optimiser embeds it.
# ---------------------------------------------------------------------------

CC0_DIR = os.path.join(BASE, "cc0")
_KENNEY_ZIP_RE = re.compile(r"https://kenney\.nl/media/pages/assets/[^\"']+?\.zip")


def kenney_zip_url(slug):
    """Resolve a kit's current download URL off its own asset page. Kenney's
    URLs carry a content hash and a timestamp, so a hard-coded one rots the
    next time he re-exports a pack; the link on the page does not."""
    req = urllib.request.Request("https://kenney.nl/assets/" + slug,
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    urls = sorted(set(_KENNEY_ZIP_RE.findall(html)))
    if not urls:
        raise RuntimeError("kenney.nl/assets/%s: no .zip link on the page" % slug)
    return urls[0]


def kenney_kit(slug):
    """Local path to one kit's zip, downloaded if it is not here yet."""
    os.makedirs(KENNEY_ZIP_DIR, exist_ok=True)
    zpath = os.path.join(KENNEY_ZIP_DIR, slug + ".zip")
    if not (os.path.exists(zpath) and os.path.getsize(zpath) > 0):
        download(kenney_zip_url(slug), zpath)
    return zpath


def kenney_extract(slug, inner, dest_dir):
    """Extract one model out of a kit PLUS the texture folder beside it, so the
    optimiser downstream can resolve the external URI and embed it."""
    import zipfile
    z = zipfile.ZipFile(kenney_kit(slug))
    os.makedirs(dest_dir, exist_ok=True)
    out = os.path.join(dest_dir, os.path.basename(inner))
    with open(out, "wb") as f:
        f.write(z.read(inner))
    folder = os.path.dirname(inner)
    for name in z.namelist():
        if name.lower().endswith((".png", ".jpg")) and name.startswith(folder + "/Textures/"):
            rel = name[len(folder) + 1:]
            tgt = os.path.join(dest_dir, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(tgt), exist_ok=True)
            with open(tgt, "wb") as f:
                f.write(z.read(name))
    return out


# semantic manifest key -> where it comes from.
#   ("kenney",     kit slug, path inside the zip, output name)
#   ("quat",       pack slug, drive folder id, file name, output name)  -- Blender
#   ("quat_local", path relative to assets/, output name)               -- Blender
#   ("localopt",   path relative to assets/, output name)  -- already here, re-packed
#   ("local",      path relative to assets/)               -- already here, as-is
#
# The three grazing species and the dog come from Quaternius's FARM ANIMAL pack
# and not from the rigged Ultimate Animated Animals: these rows are the STILL
# half of a mixed herd (see life.js STATICS) and an unrigged model is both the
# right thing and a fraction of the file size. The cat has no CC0 equivalent in
# any pack checked, so the rigged Fox stands in, exported without its skin --
# the same stand-in the rigged half of the catalogue already makes.
CC0_MODELS = {
    # --- traffic ---------------------------------------------------------
    "model.hy.car":      ("kenney", "car-kit", "Models/GLB format/sedan.glb", "car.glb"),
    "model.hy.van":      ("kenney", "car-kit", "Models/GLB format/van.glb", "van.glb"),
    "model.hy.pickup":   ("kenney", "car-kit", "Models/GLB format/truck-flat.glb", "pickup.glb"),
    "model.hy.tractor":  ("kenney", "car-kit", "Models/GLB format/tractor.glb", "tractor.glb"),
    # NOT A BUS, and the catalogue row in life.js says so too. No CC0 pack
    # checked ships one: Kenney's car, retro-urban and city kits have none,
    # and Quaternius's Public Transport bus is an untextured grey shell whose
    # eight materials are all the FBX default 0.8 grey -- it would have stood
    # in the street as a featureless slab beside seventeen coloured Kenney
    # models. A box lorry is the same size class, drives the same roads and is
    # the same kit, so it takes the deck's big-vehicle slot.
    "model.hy.bus":      ("kenney", "car-kit", "Models/GLB format/truck.glb", "bus.glb"),
    "model.hy.bicycle":  ("quat", "publictransport", "1VD5Lcu7URgyjtpDSKBXYu3jcLwA79YW6", "Bicycle.fbx", "bicycle.glb"),
    # --- the agents' bodies and what flies -------------------------------
    "model.hy.robot":    ("quat", "animatedrobot", "1sYGxzkiEc3JoFknyMex7dlTCS6-0uvbH", "Robot.fbx", "robot.glb"),
    # Beri's own ORNIS model, re-packed rather than pointed at. `_buildRigid()`
    # merges the FIRST mesh it finds and nothing else, and ornis.glb is 102
    # nodes across twelve materials -- pointed at directly, life.js would fly
    # one rotor arm over the city. drones.js keeps loading the original, which
    # it merges itself.
    "model.hy.drone":    ("localopt", "drones/ornis.glb", "drone.glb"),
    # --- the still half of the herd --------------------------------------
    "model.hy.cow":      ("quat", "farmanimal", "1QVGfjsD8f2DHHiUbqAuaYBnNcK452RYE", "Cow.fbx", "cow.glb"),
    "model.hy.sheep":    ("quat", "farmanimal", "1QVGfjsD8f2DHHiUbqAuaYBnNcK452RYE", "Sheep.fbx", "sheep.glb"),
    "model.hy.horse":    ("quat", "farmanimal", "1QVGfjsD8f2DHHiUbqAuaYBnNcK452RYE", "Horse.fbx", "horse.glb"),
    "model.hy.dog":      ("quat", "farmanimal", "1QVGfjsD8f2DHHiUbqAuaYBnNcK452RYE", "Pug.fbx", "dog.glb"),
    "model.hy.cat":      ("quat_local", "_quaternius_raw/Fox.gltf", "cat.glb"),
    # --- plaza and street furniture --------------------------------------
    "model.hy.fountain":   ("kenney", "fantasy-town-kit", "Models/GLB format/fountain-round-detail.glb", "fountain.glb"),
    "model.hy.kiosk":      ("kenney", "fantasy-town-kit", "Models/GLB format/stall-red.glb", "kiosk.glb"),
    "model.hy.cafe_table": ("kenney", "furniture-kit", "Models/GLTF format/tableRound.glb", "cafe_table.glb"),
    # --- planting --------------------------------------------------------
    "model.hy.bush":           ("kenney", "nature-kit", "Models/GLTF format/plant_bushDetailed.glb", "bush.glb"),
    "model.hy.tree_conifer":   ("kenney", "nature-kit", "Models/GLTF format/tree_pineTallA_detailed.glb", "tree_conifer.glb"),
    "model.hy.tree_broadleaf": ("kenney", "nature-kit", "Models/GLTF format/tree_oak.glb", "tree_broadleaf.glb"),
}

# Which rows are RIGGED at the source and therefore have to be frozen on a clip
# before they are exported without their skeleton. Everything not in here is
# already a still model (Kenney's kits, Quaternius's farm animals) and its bind
# pose is the pose it is meant to stand in. The fox is left alone deliberately:
# its bind pose is a standing animal, measured 5.88 long by 2.68 tall.
CC0_POSE = {
    "model.hy.robot": "Idle",
}

# The four kit models the first run extracted with their texture left behind.
# Same output path, so no manifest row moves -- only the file is fixed.
KENNEY_REPACK = {
    "model.tower":  ("castle-kit", "Models/GLB format/wall-corner-half-tower.glb",
                     "kenney_castle-kit_wall-corner-half-tower.glb"),
    "model.bridge": ("castle-kit", "Models/GLB format/bridge-straight.glb",
                     "kenney_castle-kit_bridge-straight.glb"),
    "model.boat":   ("pirate-kit", "Models/GLB format/ship-pirate-medium.glb",
                     "kenney_pirate-kit_ship-pirate-medium.glb"),
    "model.shed":   ("fantasy-town-kit", "Models/GLB format/stall.glb",
                     "kenney_fantasy-town-kit_stall.glb"),
}

# Keys with no CC0 equivalent, removed from the manifest rather than filled with
# a substitute that is not the subject. Nothing breaks: every consumer skips a
# key it has no model for.
CC0_DROP = [
    "model.hy.parrot",     # no CC0 African Grey; the aviary is opt-in and empty by default
    "model.hy.chicken",    # Quaternius's farm pack is cow/horse/llama/pig/pug/sheep/zebra
    "model.hy.busstop",    # no CC0 bus shelter in any pack checked
    "model.hy.playground",
    "model.hy.boat",       # model.boat / model.boatReal cover it and nothing reads this row
] + ["model.hy.lm_" + n for n in (
    "musicschool restaurant factory office church library concerthall "
    "bakery hotel school townhall").split()]


_BLENDER_BATCH = """
import bpy, sys, json
jobs = json.loads(sys.argv[sys.argv.index('--') + 1])
for src, dest, pose in jobs:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=src)
    else:
        bpy.ops.import_scene.gltf(filepath=src)
    if pose:
        # Freeze the armature on one frame of one clip and bake that shape into
        # the mesh. Without it the export is the BIND pose, and a rigged
        # character's bind pose is a T: measured, the robot came out 6.62 units
        # across against 4.53 tall -- scaled to 1.35 m of height that is a
        # machine standing in the street with a two-metre wingspan.
        arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
        act = next((a for a in bpy.data.actions if pose.lower() in a.name.lower()), None)
        if not arm or not act:
            raise RuntimeError('%s: no armature or no clip matching %r' % (src, pose))
        if not arm.animation_data:
            arm.animation_data_create()
        arm.animation_data.action = act
        bpy.context.scene.frame_set(int(act.frame_range[0]) + 1)
        deps = bpy.context.evaluated_depsgraph_get()
        for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
            ev = ob.evaluated_get(deps)
            me = bpy.data.meshes.new_from_object(ev)
            ob.modifiers.clear()
            ob.data = me
            ob.parent = None
            ob.matrix_world = ev.matrix_world
    # Force every material opaque. Quaternius's FBX materials carry a base
    # colour whose ALPHA is 0, and Blender exports that verbatim as
    # alphaMode MASK with a 0.5 cutoff -- a model that any standard glTF viewer
    # renders as nothing at all. life.js never sees it (rigidMaterial builds a
    # fresh material and copies only the colour) but a public repository should
    # not ship four invisible animals, so it is fixed at the source.
    for mat in bpy.data.materials:
        mat.blend_method = 'OPAQUE'
        if mat.use_nodes:
            for node in mat.node_tree.nodes:
                for inp in getattr(node, 'inputs', []):
                    if inp.name in ('Base Color', 'Color') and hasattr(inp, 'default_value'):
                        try:
                            inp.default_value[3] = 1.0
                        except Exception:
                            pass
                    if inp.name == 'Alpha' and hasattr(inp, 'default_value'):
                        try:
                            inp.default_value = 1.0
                        except Exception:
                            pass
    bpy.ops.export_scene.gltf(filepath=dest, export_format='GLB',
                              export_animations=False, export_skins=False,
                              export_yup=True, export_materials='EXPORT')
"""


def blender_batch(jobs):
    """Convert several source files to static .glb in ONE Blender run -- one
    startup instead of seven.

    `export_skins=False` is the point of this function, not an optimisation:
    these rows are the STILL half of the catalogue, and a rest-pose mesh with
    no armature is what _buildRigid() wants. It merges the first mesh it finds
    and never looks for a skeleton, so a skinned file would draw in whatever
    pose the bind matrices happen to leave it."""
    import subprocess, tempfile
    jobs = [(os.path.abspath(a), os.path.abspath(b), c) for a, b, c in jobs
            if not (os.path.exists(b) and os.path.getsize(b) > 0)]
    if not jobs:
        return
    blender = find_blender()
    if not blender:
        raise RuntimeError("Blender not found -- cannot convert the FBX/glTF sources")
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(_BLENDER_BATCH)
        script = f.name
    try:
        r = subprocess.run([blender, "--background", "--factory-startup",
                            "--python", script, "--", json.dumps(jobs)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
        missing = [b for _, b, _p in jobs if not os.path.exists(b)]
        if missing:
            raise RuntimeError("Blender wrote nothing for %s:\n%s\n%s"
                               % (missing, r.stdout[-2000:], r.stderr[-2000:]))
    finally:
        os.unlink(script)


def glb_bbox(path):
    """The model's bounding box in its own units, read out of the glTF JSON.

    A POSITION accessor carries `min`/`max` by specification, so the box is
    exact without decoding a single vertex -- but only BEFORE compression
    quantises the positions onto a node scale, which is why this runs on the
    raw file and never on the optimised one. Node transforms are composed by
    hand because the whole point of this script is that it needs no packages."""
    with open(path, "rb") as f:
        data = f.read()
    chunk_len = int.from_bytes(data[12:16], "little")
    g = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    nodes, meshes, acc = g.get("nodes", []), g.get("meshes", []), g.get("accessors", [])

    def mul(a, b):   # column-major 4x4, glTF's own layout
        return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
                for c in range(4) for r in range(4)]

    def local(n):
        if "matrix" in n:
            return list(n["matrix"])
        t = n.get("translation", [0, 0, 0])
        x, y, z, w = n.get("rotation", [0, 0, 0, 1])
        s = n.get("scale", [1, 1, 1])
        m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
             2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
             2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
             0, 0, 0, 1]
        for c in range(3):
            for r in range(3):
                m[c * 4 + r] *= s[c]
        m[12], m[13], m[14] = t
        return m

    lo = [1e30] * 3
    hi = [-1e30] * 3

    def walk(idx, m):
        n = nodes[idx]
        m = mul(m, local(n))
        if "mesh" in n:
            for prim in meshes[n["mesh"]].get("primitives", []):
                a = acc[prim["attributes"]["POSITION"]]
                if "min" not in a:
                    continue
                for corner in range(8):   # the box's eight corners, transformed
                    p = [a["max" if corner >> k & 1 else "min"][k] for k in range(3)]
                    for r in range(3):
                        v = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]
                        lo[r] = min(lo[r], v)
                        hi[r] = max(hi[r], v)
        for c in n.get("children", []):
            walk(c, m)

    ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    for s in g.get("scenes", [{}]):
        for root in s.get("nodes", []):
            walk(root, ident)
    if lo[0] > hi[0]:
        return None
    return {"size": [round(hi[k] - lo[k], 4) for k in range(3)],
            "min": [round(v, 4) for v in lo]}


def strip_clearcoat(src, dest):
    """Copy a .glb with KHR_materials_clearcoat removed from every material.

    Why this exists: glTF Transform's `join` will not merge two primitives whose
    materials differ, and on Beri's ORNIS airframe the ONLY difference between
    fourteen of them is a clearcoat factor. _buildRigid() merges the first mesh
    it finds and drops the rest, so pointed at the file as it stands life.js
    would fly one rotor arm over the city. rigidMaterial() sets clearcoat from
    the catalogue row, so the file's own value is never read by anything.

    It rewrites the JSON chunk and copies the binary chunk through untouched,
    which is why it works on a meshopt-compressed file that Blender cannot even
    open ("Extension EXT_meshopt_compression is not available on this addon
    version" -- Blender 5.1)."""
    EXT = "KHR_materials_clearcoat"
    with open(src, "rb") as f:
        data = f.read()
    json_len = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20:20 + json_len].decode("utf-8"))
    rest = data[20 + json_len:]          # every chunk after the JSON one
    for mat in gltf.get("materials", []):
        ext = mat.get("extensions")
        if ext and EXT in ext:
            ext.pop(EXT)
            if not ext:
                mat.pop("extensions")
    for field in ("extensionsUsed", "extensionsRequired"):
        if EXT in gltf.get(field, []):
            gltf[field] = [e for e in gltf[field] if e != EXT]
    out = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(out) % 4:                  # the JSON chunk pads with SPACES
        out += b" "
    total = 12 + 8 + len(out) + len(rest)
    with open(dest, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I", len(out)))
        f.write(b"JSON")
        f.write(out)
        f.write(rest)
    return dest


def gltf_optimise(src, dest):
    """One pass of `@gltf-transform/cli optimize` per model: flatten, join,
    weld, prune, embed the external texture, meshopt-compress.

    `--simplify false` on purpose. life.js decimates every rigid model itself,
    three times, into its own LOD ladder; a second simplifier upstream would
    take the near tier -- the one a car four metres away is judged on -- down
    with it. Compression is meshopt and not draco because every loader in this
    tree calls setMeshoptDecoder and none of them wires a DRACOLoader.

    `--palette-min 2` is the one non-default setting and it is load-bearing.
    _buildRigid() merges the FIRST mesh it finds and nothing else, so a model
    that reaches it as several primitives loses everything after the first: the
    robot arrived as three materials, and the near tier would have been its
    orange half without its grey half or its head. Below the palette minimum
    glTF Transform leaves the materials apart and `join` cannot merge across
    them; at 2 it bakes them into one palette texture and the model comes out
    as one primitive with its colours intact. `--instance false` is there for
    the same reason: GPU instancing rewrites the scene graph into something
    `join` will not cross, and none of these models has five copies of anything
    for it to help with."""
    import subprocess, shutil
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise RuntimeError("npx not found -- install Node to run @gltf-transform/cli")
    r = subprocess.run([npx, "--yes", "@gltf-transform/cli@4", "optimize", src, dest,
                        "--compress", "meshopt", "--texture-compress", "auto",
                        "--simplify", "false", "--palette-min", "2",
                        "--instance", "false"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
    if not os.path.exists(dest):
        raise RuntimeError("gltf-transform wrote nothing for %s:\n%s\n%s"
                           % (src, r.stdout[-1500:], r.stderr[-1500:]))
    return dest


def glb_primitives(path):
    """How many primitives the whole file draws. One is the target: life.js's
    _buildRigid() merges the FIRST mesh it finds and drops everything after it,
    so a model that arrives in pieces arrives as its first piece."""
    with open(path, "rb") as f:
        data = f.read()
    chunk_len = int.from_bytes(data[12:16], "little")
    g = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    return sum(len(m.get("primitives", [])) for m in g.get("meshes", []))


def optimise_to_one_mesh(src, dest):
    """gltf_optimise() until the model is a single primitive, at most twice.

    A second pass is not superstition and it is not free-form retrying: the
    FIRST pass is what merges the materials into a palette, and `join` has
    already run by then against the materials as they were. Feeding its own
    output back in lets dedup see the palette materials as identical and join
    merge across them. Measured on assets/drones/ornis.glb: 14 primitives ->
    3 after one pass -> 1 after two. A third pass has never changed anything,
    so two is the cap and a model still in pieces is reported rather than
    looped over."""
    gltf_optimise(src, dest)
    if glb_primitives(dest) > 1:
        again = dest + ".pass2.glb"
        gltf_optimise(dest, again)
        if glb_primitives(again) <= glb_primitives(dest):
            os.replace(again, dest)
        else:
            os.unlink(again)
    n = glb_primitives(dest)
    if n > 1:
        print(f"  WARNING: {os.path.basename(dest)} is still {n} primitives; "
              f"life.js will draw only the first")
    return dest


def build_cc0_models():
    """Fetch, convert and optimise every row of CC0_MODELS, and re-pack the
    four Kenney models that lost their texture. Returns {key: info}."""
    raw_dir = os.path.join(BASE, "_cc0_raw")
    os.makedirs(raw_dir, exist_ok=True)
    os.makedirs(CC0_DIR, exist_ok=True)
    os.makedirs(LIFE_RAW_DIR, exist_ok=True)
    info = {}
    blender_jobs = []
    staged = {}          # key -> (raw path, output filename, credit tuple)

    for key, row in CC0_MODELS.items():
        kind = row[0]
        if kind == "local":
            info[key] = {"path": row[1], "local": True}
        elif kind == "localopt":
            _, rel, out = row
            raw = os.path.join(raw_dir, out)
            strip_clearcoat(os.path.join(BASE, rel.replace("/", os.sep)), raw)
            staged[key] = (raw, out, ("Wild Digital Moments", os.path.basename(rel),
                                      "https://digital.wildmoments.at/ornis/"))
        elif kind == "kenney":
            _, slug, inner, out = row
            raw = kenney_extract(slug, inner, os.path.join(raw_dir, slug))
            staged[key] = (raw, out, ("Kenney " + slug, os.path.basename(inner),
                                      "https://kenney.nl/assets/" + slug))
        elif kind == "quat":
            _, pack, folder, fname, out = row
            entries = drive_list(folder)
            if fname not in entries:
                raise RuntimeError("%s: '%s' is no longer in Drive folder %s; "
                                   "the pack was re-uploaded" % (key, fname, folder))
            src = os.path.join(LIFE_RAW_DIR, fname)
            drive_download(entries[fname], src)
            raw = os.path.join(raw_dir, out)
            blender_jobs.append((src, raw, CC0_POSE.get(key)))
            staged[key] = (raw, out, ("Quaternius " + pack, fname,
                                      "https://quaternius.com/packs/%s.html" % pack))
        elif kind == "quat_local":
            _, rel, out = row
            src = os.path.join(BASE, rel.replace("/", os.sep))
            raw = os.path.join(raw_dir, out)
            blender_jobs.append((src, raw, CC0_POSE.get(key)))
            staged[key] = (raw, out, ("Quaternius ultimateanimatedanimals",
                                      os.path.basename(rel),
                                      "https://quaternius.com/packs/ultimateanimatedanimals.html"))
        else:
            raise RuntimeError("%s: unknown source kind %r" % (key, kind))

    if blender_jobs:
        print("  Blender: converting %d source files in one run..." % len(blender_jobs))
        blender_batch(blender_jobs)

    for key in sorted(staged):
        raw, out, credit = staged[key]
        box = glb_bbox(raw)
        dest = os.path.join(CC0_DIR, out)
        if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
            optimise_to_one_mesh(raw, dest)
        chk = validate_glb(dest)
        info[key] = {
            "path": os.path.relpath(dest, BASE).replace(os.sep, "/"),
            "bytes": os.path.getsize(dest),
            "primitives": glb_primitives(dest),
            "triangles": chk.get("triangles"),
            "size": box["size"] if box else None,
            "credit": credit,
        }
        print("  [%s] %s/%s: %s tris, %d bytes, box %s"
              % (key, credit[0], credit[1], chk.get("triangles"),
                 info[key]["bytes"], box["size"] if box else "?"))

    for key in sorted(KENNEY_REPACK):
        slug, inner, out = KENNEY_REPACK[key]
        raw = kenney_extract(slug, inner, os.path.join(raw_dir, slug))
        dest = os.path.join(MODEL_DIR, out)
        # `.glb` and not `.tmp`: gltf-transform picks the container off the
        # OUTPUT extension, and anything else makes it write a .gltf with the
        # buffer and the texture beside it as loose files.
        tmp = dest[:-4] + ".repack.glb"
        optimise_to_one_mesh(raw, tmp)
        os.replace(tmp, dest)
        chk = validate_glb(dest)
        print("  [%s] re-packed with its texture embedded: %s tris, %d bytes"
              % (key, chk.get("triangles"), os.path.getsize(dest)))
    return info


def rewrite_manifest_cc0(info):
    """Point every `model.hy.*` row at its CC0 file and drop the ones with no
    CC0 equivalent. Idempotent -- a second run writes the same values."""
    manifest_path = os.path.join(BASE, "manifest.json")
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    for key in CC0_DROP:
        manifest.pop(key, None)
    rows = []
    for key in sorted(info):
        i = info[key]
        if i.get("local"):
            row = dict(manifest.get(key, {}))
            row["path"] = i["path"]
            row.pop("license", None)
            manifest[key] = row
            continue
        manifest[key] = {
            "path": i["path"],
            "upAxis": "Y",
            "heightUnits": i["size"][1] if i["size"] else None,
            "extentUnits": i["size"],
        }
        rows.append((i["credit"][0] + " / " + i["credit"][1], i["credit"][2],
                     i["triangles"], i["bytes"]))
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    return rows


CREDITS_BEGIN = "<!-- CC0-REPLACEMENT-SET:BEGIN -->"
CREDITS_END = "<!-- CC0-REPLACEMENT-SET:END -->"


def library_bytes():
    """Every byte the asset library actually holds, which is what the total at
    the foot of CREDITS.md claims. Counted off the disk rather than summed from
    the rows, because the rows are per-SOURCE and several of them share a file."""
    total = 0
    for d in ("textures", "hdri", "models", "life", "cc0", "drones"):
        root = os.path.join(BASE, d)
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                total += os.path.getsize(os.path.join(dirpath, f))
    return total


def rewrite_credits_cc0(info):
    """Replace (or append) the CC0 section of CREDITS.md, and re-state the
    total from the files on disk. Delimited by an HTML comment so a re-run
    rewrites its own section and leaves every hand-written line alone."""
    path = os.path.join(BASE, "CREDITS.md")
    text = open(path, encoding="utf-8").read()
    rows = []
    for key in sorted(info):
        i = info[key]
        if i.get("local"):
            continue
        author, fname, url = i["credit"]
        lic = "own work, repo licence" if author.startswith("Wild Digital") else "CC0"
        rows.append("| `%s` | %s / %s | %s | %s | %s tris, %s primitive%s | %s |"
                    % (key, author, fname, url, lic, i["triangles"], i["primitives"],
                       "" if i["primitives"] == 1 else "s", f"{i['bytes']:,}"))
    body = [
        CREDITS_BEGIN,
        "",
        "## The CC0 replacement set (`assets/cc0/`)",
        "",
        "One row per `model.hy.*` key in `assets/manifest.json`. Each file is one",
        "vendor model, flattened and joined into a SINGLE primitive by",
        "`npx @gltf-transform/cli optimize` and compressed with meshopt -- life.js",
        "draws only the first mesh it finds, so the join is not cosmetic.",
        "",
        "| manifest key | source | vendor page | licence | after optimise | bytes |",
        "|---|---|---|---|---|---|",
    ] + rows + [
        "",
        "`model.hy.bicycle` and `model.hy.drone` are in this table too: the bicycle",
        "is the Quaternius Public Transport model re-packed, and the drone is Wild",
        "Digital Moments' own ORNIS airframe, released under this repository's",
        "licence rather than CC0.",
        "",
        "**Four subjects and the thirteen landmark buildings have no model, and",
        "are left empty on purpose** -- no CC0 equivalent exists in any pack",
        "checked: `model.hy.parrot`, `model.hy.chicken`, `model.hy.busstop`,",
        "`model.hy.playground`, and every `model.hy.lm_*`. life.js and globe.js",
        "skip a key they have no model for and fall back to their procedural",
        "forms -- a drawn parrot, a procedural shed for a landmark, nothing at",
        "all for a hen.",
        "",
        "`model.hy.bus` is a BOX LORRY (Kenney `truck.glb`): no CC0 pack checked",
        "ships a bus, and Quaternius's is an untextured grey shell. The manifest",
        "key keeps its name because life.js reads it to decide which streets carry",
        "a large vehicle.",
        "",
        CREDITS_END,
    ]
    section = "\n".join(body)
    if CREDITS_BEGIN in text:
        pre = text.split(CREDITS_BEGIN)[0]
        post = text.split(CREDITS_END, 1)[1]
        text = pre + section + post
    else:
        text = text.rstrip() + "\n\n" + section + "\n"
    total = library_bytes()
    out = []
    for line in text.split("\n"):
        if line.startswith("**Total:"):
            line = "**Total: %s bytes (%.2f MB) across assets/textures, hdri, models, life, cc0 and drones**" % (
                f"{total:,}", total / 1e6)
        out.append(line)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out).rstrip() + "\n")
    return len(rows), total


def main_cc0():
    print("== CC0 replacement set (Kenney + Quaternius, phase B) ==")
    info = build_cc0_models()
    rows = rewrite_manifest_cc0(info)
    print("== manifest.json rewritten: %d CC0 rows, %d keys dropped =="
          % (len(rows), len(CC0_DROP)))
    for r in rows:
        print("   %-52s %7s tris  %9d bytes" % (r[0], r[2], r[3]))
    n, total = rewrite_credits_cc0(info)
    print("== CREDITS.md: %d CC0 rows, library total %.2f MB ==" % (n, total / 1e6))



# ---------------------------------------------------------------------------
# THE RELEASE ZIP (the fast path)
#
# Everything above this line rebuilds the asset library from its sources: about
# eight minutes, a Blender install and a Node install. Almost nobody wants that.
# `--release` downloads the same library as one zip attached to the GitHub
# Release and checks its hash, which is twenty seconds and needs nothing but
# Python.
#
# The two constants below are filled in AT PUBLISH TIME, by hand, from what
# tools/build_assets_zip.py prints. They are empty in the repository on purpose:
# a URL that points at a release that does not exist yet is worse than no URL,
# because it fails as a 404 halfway through a download instead of as a sentence.
# ---------------------------------------------------------------------------

RELEASE_URL = ""       # e.g. https://github.com/<owner>/werkstadt/releases/download/v1/werkstadt-assets-v1.zip
RELEASE_SHA256 = ""    # the digest printed beside the zip


def main_release():
    import hashlib
    import zipfile
    if not RELEASE_URL:
        print("RELEASE_URL is not set yet in assets/fetch_assets.py.\n"
              "Either wait for the first release, or rebuild the library from\n"
              "its sources with:  python assets/fetch_assets.py", file=sys.stderr)
        sys.exit(2)
    zip_path = os.path.join(BASE, "_release.zip")
    print(f"== downloading {RELEASE_URL} ==")
    download(RELEASE_URL, zip_path)
    digest = hashlib.sha256(open(zip_path, "rb").read()).hexdigest()
    if RELEASE_SHA256 and digest != RELEASE_SHA256:
        # Left on disk deliberately: a mismatch is worth looking at, and
        # deleting the evidence is how a corrupted mirror stays a mystery.
        print(f"sha256 MISMATCH\n  expected {RELEASE_SHA256}\n  got      {digest}\n"
              f"  file left at {zip_path}", file=sys.stderr)
        sys.exit(3)
    # The zip carries `assets/...` paths so it also unpacks correctly from the
    # repository root; extracted from here, that leading component is dropped.
    repo = os.path.dirname(BASE)
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        z.extractall(repo)
    os.unlink(zip_path)
    print(f"== unpacked {len(names)} files into {os.path.relpath(BASE, repo)}/ ==")


if __name__ == "__main__":
    # `--release` is the fast path and does not touch the stages at all.
    # `--life` and `--cc0` run one stage on its own. The full run rebuilds
    # manifest.json from scratch in main(), so the four stages have to stay in
    # this order -- and --cc0 has to be last, because it REWRITES rows the
    # earlier stages wrote.
    if "--release" in sys.argv:
        main_release()
    elif "--life" in sys.argv:
        main_life()
    elif "--cc0" in sys.argv:
        main_cc0()
    else:
        main()
        main_extend()
        main_life()
        main_cc0()

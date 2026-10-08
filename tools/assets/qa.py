#!/usr/bin/env python
"""Asset QA (docs/ASSETS.md section 4): tri count, bounds, palette distance, non-manifold edges, file size.

  python tools/assets/qa.py [--class X] [--no-sheet]

Reads normalized GLBs under assets/models/ directly (pure numpy, no Blender), writes `qa` into each manifest row
({tris, bounds, palette_delta, warnings, ...}) and builds reports/latest/assets_sheet.png (thumbnails, or the Gemini
concept image when no thumbnail exists yet).
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log  # noqa: E402

SIZE_CAP_BYTES = 2 * 1024 * 1024
PALETTE_WITHIN = 0.03  # OKLab distance counted as "on palette"
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    b = open(path, "rb").read()
    magic, _ver, _len = struct.unpack("<4sII", b[:12])
    if magic != b"glTF":
        raise ValueError("not a GLB")
    off, js, binc = 12, None, b""
    while off < len(b):
        clen, ctype = struct.unpack("<II", b[off:off + 8])
        data = b[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(data.decode("utf-8"))
        elif ctype == 0x004E4942:
            binc = data
        off += 8 + clen
    return js, binc


def accessor(js, binc, idx):
    acc = js["accessors"][idx]
    bv = js["bufferViews"][acc["bufferView"]]
    dt = np.dtype(COMP[acc["componentType"]])
    n = NCOMP[acc["type"]]
    stride = bv.get("byteStride") or dt.itemsize * n
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    count = acc["count"]
    if stride == dt.itemsize * n:
        arr = np.frombuffer(binc, dtype=dt, count=count * n, offset=start).reshape(count, n)
    else:
        arr = np.empty((count, n), dtype=dt)
        for i in range(count):
            arr[i] = np.frombuffer(binc, dtype=dt, count=n, offset=start + i * stride)
    arr = arr.astype(np.float64)
    if acc.get("normalized"):
        arr = arr / (np.iinfo(dt).max if dt.kind in "iu" else 1.0)
    return arr


def node_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
    t = np.array(node.get("translation", [0, 0, 0]), dtype=np.float64)
    q = node.get("rotation", [0, 0, 0, 1])
    s = np.array(node.get("scale", [1, 1, 1]), dtype=np.float64)
    x, y, z, w = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * s
    M[:3, 3] = t
    return M


def collect(js, binc):
    pos, col, tris = [], [], []
    base = 0

    def visit(ni, parent):
        nonlocal base
        node = js["nodes"][ni]
        M = parent @ node_matrix(node)
        if "mesh" in node:
            for prim in js["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                p = accessor(js, binc, prim["attributes"]["POSITION"])
                p = (np.c_[p, np.ones(len(p))] @ M.T)[:, :3]
                idx = accessor(js, binc, prim["indices"]).astype(np.int64).ravel() if "indices" in prim else np.arange(len(p))
                pos.append(p)
                tris.append(idx.reshape(-1, 3) + base)
                if "COLOR_0" in prim["attributes"]:
                    col.append(accessor(js, binc, prim["attributes"]["COLOR_0"])[:, :3])
                else:
                    col.append(np.full((len(p), 3), np.nan))
                base += len(p)
        for c in node.get("children", []):
            visit(c, M)

    scene = js["scenes"][js.get("scene", 0)]
    for ni in scene["nodes"]:
        visit(ni, np.eye(4))
    return np.concatenate(pos), np.concatenate(col), np.concatenate(tris)


def lin_to_oklab(rgb):
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], axis=1)


def hex_lin(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def palette_lab():
    pal = C.palette_hex()
    return lin_to_oklab(np.array([hex_lin(h) for h in pal.values()]))


def edge_stats(pos, tris):
    key = np.round(pos / 1e-4).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    t = inv[tris]
    e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    e.sort(axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    return int((counts == 1).sum()), int((counts > 2).sum())


def qa_asset(a: dict, budgets=None) -> dict:
    post = a["steps"]["post"]
    path = C.abspath(post["output_path"])
    js, binc = read_glb(path)
    pos, col, tris = collect(js, binc)
    mn, mx = pos.min(axis=0), pos.max(axis=0)
    size = mx - mn  # glTF is Y-up: size[1] is height
    warnings = []
    qa = {"tris": int(len(tris)), "verts": int(len(pos)),
          "bounds": {"min": [round(float(v), 4) for v in mn], "max": [round(float(v), 4) for v in mx], "size": [round(float(v), 4) for v in size]},
          "bytes": os.path.getsize(path), "materials": len(js.get("materials", []))}
    p = a["params"]
    bud = (budgets or C.style_json().get("triBudgets", {})).get(p.get("budget_class", "prop"))
    if bud:
        if qa["tris"] > bud[1]:
            warnings.append(f"tris {qa['tris']} above budget max {bud[1]}")
        if qa["tris"] < bud[0]:
            warnings.append(f"tris {qa['tris']} below budget min {bud[0]}")
    if p.get("height") and abs(size[1] - p["height"]) > 0.05 * p["height"]:
        warnings.append(f"height {size[1]:.3f} vs target {p['height']}")
    if p.get("footprint") and abs(max(size[0], size[2]) - p["footprint"]) > 0.05 * p["footprint"]:
        warnings.append(f"footprint {max(size[0], size[2]):.3f} vs target {p['footprint']}")
    if abs(mn[1]) > 0.02:
        warnings.append(f"base not on ground (min y {mn[1]:.3f})")
    cx, cz = (mn[0] + mx[0]) / 2, (mn[2] + mx[2]) / 2
    if abs(cx) > 0.02 or abs(cz) > 0.02:
        warnings.append(f"pivot off footprint center ({cx:.3f}, {cz:.3f})")
    if qa["materials"] != 1:
        warnings.append(f"{qa['materials']} materials (expected 1 shared)")
    if np.isnan(col).any():
        warnings.append("no COLOR_0 vertex colors in GLB")
        qa["palette_delta"] = None
    else:
        lab = lin_to_oklab(col)
        pl = palette_lab()
        d = np.sqrt(((lab[:, None, :] - pl[None, :, :]) ** 2).sum(-1)).min(axis=1)
        qa["palette_delta"] = round(float(d.mean()), 5)
        qa["palette_within"] = round(float((d < PALETTE_WITHIN).mean()), 4)
        if qa["palette_within"] < 0.95:
            warnings.append(f"only {qa['palette_within'] * 100:.0f}% of vertex colors on palette")
    pm = post.get("meta") or {}
    if p.get("tribe_color") and "tribe_faces" in pm:
        qa["tribe_faces"], qa["tribe_height_range"] = pm["tribe_faces"], pm.get("tribe_height_range")
        if not pm["tribe_faces"]:
            warnings.append("no tribe-color region (azure/crimson/amber/jade) after palette snap")
    boundary, nonman = edge_stats(pos, tris)
    qa["boundary_edges"], qa["nonmanifold_edges"] = boundary, nonman
    if nonman:
        warnings.append(f"{nonman} non-manifold edges")
    if qa["bytes"] > SIZE_CAP_BYTES:
        warnings.append(f"file {qa['bytes']} bytes above cap {SIZE_CAP_BYTES}")
    qa["warnings"] = warnings
    a["qa"] = qa
    return qa


def build_sheet(m: dict, out=None, cell=256, cols=6) -> str | None:
    from PIL import Image, ImageDraw, ImageFont

    items = []
    for a in m["assets"]:
        th, cp = a["steps"]["thumb"], a["steps"]["concept"]
        src = None
        if th["status"] == "done" and th.get("output_path") and C.abspath(th["output_path"]).exists():
            src = th["output_path"]
        elif cp["status"] == "done" and cp.get("output_path") and C.abspath(cp["output_path"]).exists():
            src = cp["output_path"]
        # always show the concept too when a model thumb exists, so the pair is comparable
        if src:
            items.append((a, src))
            if src != cp.get("output_path") and cp["status"] == "done" and cp.get("output_path") and C.abspath(cp["output_path"]).exists():
                items.append((a, cp["output_path"]))
    if not items:
        return None
    font = ImageFont.load_default(size=13)
    pad, lab_h = 8, 34
    rows = (len(items) + cols - 1) // cols
    W, H = cols * (cell + pad) + pad, rows * (cell + lab_h + pad) + pad
    sheet = Image.new("RGB", (W, H), (58, 54, 50))
    d = ImageDraw.Draw(sheet)
    for i, (a, src) in enumerate(items):
        r, c = divmod(i, cols)
        x, y = pad + c * (cell + pad), pad + r * (cell + lab_h + pad)
        with Image.open(C.abspath(src)) as im:
            im = im.convert("RGBA")
            im.thumbnail((cell, cell))
            bg = Image.new("RGBA", (cell, cell), (120, 140, 120, 255) if "icons" in src else (90, 90, 90, 255))
            bg.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
            sheet.paste(bg.convert("RGB"), (x, y))
        kind = "thumb" if "icons" in src else "concept"
        q = a.get("qa") or {}
        line2 = f"{kind}"
        if q.get("tris") is not None and kind == "thumb":
            line2 += f"  tris {q['tris']}"
            if q.get("warnings"):
                line2 += f"  WARN {len(q['warnings'])}"
        d.text((x, y + cell + 2), a["id"], fill=(240, 235, 225), font=font)
        d.text((x, y + cell + 17), line2, fill=(255, 190, 120) if q.get("warnings") and kind == "thumb" else (190, 190, 180), font=font)
    out = out or (C.REPORTS / "assets_sheet.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    return C.rel(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--class", dest="cls")
    ap.add_argument("--no-sheet", action="store_true")
    args = ap.parse_args()
    m = C.load_manifest()
    n = warn_n = 0
    for a in m["assets"]:
        if args.cls and a["class"] != args.cls:
            continue
        post = a["steps"]["post"]
        if a["class"] in ("sfx", "music") or post["status"] != "done" or not post.get("output_path"):
            continue
        q = qa_asset(a)
        n += 1
        warn_n += bool(q["warnings"])
        log(f"  qa {a['id']}: tris {q['tris']} size {q['bounds']['size']} palette_delta {q['palette_delta']} bytes {q['bytes']} warnings {q['warnings']}")
    C.save_manifest(m)
    sheet = None if args.no_sheet else build_sheet(m)
    log(f"RESULT: qa {n} model(s), {warn_n} with warnings; sheet {sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

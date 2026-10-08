#!/usr/bin/env python
"""Per-class contact sheets with labels (id, tris, size, tribe faces): reports/latest/assets_<class>_sheet.png.

  python tools/assets/class_sheets.py --class buildings [--cell 256] [--cols 4] [--concepts]

--concepts puts each asset's Gemini concept image next to its model thumbnail (pairs).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--class", dest="cls", required=True)
    ap.add_argument("--cell", type=int, default=256)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--concepts", action="store_true")
    ap.add_argument("--only", nargs="*", default=None, help="restrict to these asset ids")
    ap.add_argument("--out", default=None, help="output file name (default assets_<class>_sheet.png)")
    args = ap.parse_args()
    from PIL import Image, ImageDraw, ImageFont

    m = C.load_manifest()
    items = []
    for a in m["assets"]:
        if a["class"] != args.cls or (args.only and a["id"] not in args.only):
            continue
        th, cp = a["steps"]["thumb"], a["steps"]["concept"]
        if th["status"] == "done" and th.get("output_path") and C.abspath(th["output_path"]).exists():
            items.append((a, th["output_path"], "model"))
            if args.concepts and cp.get("output_path") and C.abspath(cp["output_path"]).exists():
                items.append((a, cp["output_path"], "concept"))
    cell, pad, lab = args.cell, 8, 50
    font = ImageFont.load_default(size=14)
    rows = (len(items) + args.cols - 1) // args.cols
    sheet = Image.new("RGB", (args.cols * (cell + pad) + pad, rows * (cell + lab + pad) + pad), (46, 43, 40))
    d = ImageDraw.Draw(sheet)
    for i, (a, src, kind) in enumerate(items):
        r, c = divmod(i, args.cols)
        x, y = pad + c * (cell + pad), pad + r * (cell + lab + pad)
        with Image.open(C.abspath(src)) as im:
            im = im.convert("RGB")
            im.thumbnail((cell, cell))
            tile = Image.new("RGB", (cell, cell), (158, 153, 143))
            tile.paste(im, ((cell - im.width) // 2, (cell - im.height) // 2))
            sheet.paste(tile, (x, y))
        q = a.get("qa") or {}
        warns = q.get("warnings") or []
        if kind == "model":
            sz = (q.get("bounds") or {}).get("size")
            l1 = a["id"]
            l2 = f"tris {q.get('tris')}  size {sz[0]:.2f} x {sz[1]:.2f} x {sz[2]:.2f}" if sz else "no qa"
            if a["class"] == "buildings":
                l2 += f"  tribe {q.get('tribe_faces', 0)}"
            elif a["class"] == "units":
                l2 = f"tris {q.get('tris')}  h {sz[1]:.2f}  tribe faces {q.get('tribe_faces') if a['params'].get('tribe_color') else 'n/a'}" if sz else "no qa"
        else:
            l1, l2 = a["id"], "concept (Gemini)"
        d.text((x, y + cell + 3), l1, fill=(240, 235, 225), font=font)
        d.text((x, y + cell + 21), l2, fill=(255, 190, 120) if (warns and kind == "model") else (190, 190, 180), font=font)
        if warns and kind == "model":
            d.text((x, y + cell + 36), "WARN " + warns[0][:36], fill=(255, 150, 90), font=font)
    out = C.REPORTS / (args.out or f"assets_{args.cls}_sheet.png")
    os.makedirs(out.parent, exist_ok=True)
    sheet.save(out)
    log(f"sheet -> {C.rel(out)} ({sheet.width}x{sheet.height}, {len(items)} tiles)")
    log("RESULT: sheet ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

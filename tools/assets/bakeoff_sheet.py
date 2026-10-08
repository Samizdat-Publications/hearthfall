#!/usr/bin/env python
"""A1 unit bake-off comparison sheet: 2x2 grid of 3/4-view Blender renders (rows = subjects, columns = Meshy
route A text-to-3D preview vs route B Gemini concept -> image-to-3D) plus a third row with the Gemini concepts.

  python tools/assets/bakeoff_sheet.py [--cell 384] [--out reports/latest/unit_bakeoff_sheet.png]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
import blender_run as B  # noqa: E402
from common import log  # noqa: E402

GRID = [("unit.settler.bakeoff_a", "A text-to-3D preview, untextured"), ("unit.settler.bakeoff_b", "B image-to-3D, textured"),
        ("unit.warden.bakeoff_a", "A text-to-3D preview, untextured"), ("unit.warden.bakeoff_b", "B image-to-3D, textured")]
CONCEPTS = ["unit.settler.bakeoff_b", "unit.warden.bakeoff_b"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cell", type=int, default=384)
    ap.add_argument("--out", default=str(C.REPORTS / "unit_bakeoff_sheet.png"))
    args = ap.parse_args()
    from PIL import Image, ImageDraw, ImageFont

    m = C.load_manifest()
    B.WORK.mkdir(parents=True, exist_ok=True)
    jobs = []
    for aid, _ in GRID:
        a = C.find_asset(m, aid)
        out = B.WORK / f"{aid}.sheet.png"
        jobs.append({"in": str(C.abspath(a["steps"]["post"]["output_path"])), "out": str(out), "size": args.cell})
    jf = B.WORK / "bakeoff_jobs.json"
    C.save_json_atomic(jf, jobs)
    B.run_blender(B.BLENDER_DIR / "thumbs.py", ["--jobs", jf], timeout=480)

    cell, pad, lab = args.cell, 10, 54
    font, small = ImageFont.load_default(size=16), ImageFont.load_default(size=13)
    W, H = 2 * cell + 3 * pad, 3 * (cell + lab) + 4 * pad
    sheet = Image.new("RGB", (W, H), (46, 43, 40))
    d = ImageDraw.Draw(sheet)

    def put(img, col, row, l1, l2):
        x, y = pad + col * (cell + pad), pad + row * (cell + lab + pad)
        im = img.convert("RGBA")
        im.thumbnail((cell, cell))
        bg = Image.new("RGBA", (cell, cell), (112, 120, 112, 255))
        bg.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
        sheet.paste(bg.convert("RGB"), (x, y))
        d.text((x, y + cell + 4), l1, fill=(244, 238, 226), font=font)
        d.text((x, y + cell + 26), l2, fill=(200, 196, 186), font=small)

    for i, ((aid, route), job) in enumerate(zip(GRID, jobs)):
        a = C.find_asset(m, aid)
        q = a.get("qa") or {}
        pm = a["steps"]["post"].get("meta") or {}
        tf = pm.get("tribe_faces")
        line2 = f"{route} | tris {q.get('tris')} | h {q['bounds']['size'][1]:.2f}"
        line2 += f" | tribe faces {tf}" + (f" (z {pm['tribe_height_range'][0]:.2f}-{pm['tribe_height_range'][1]:.2f})" if pm.get("tribe_height_range") else "")
        with Image.open(job["out"]) as im:
            put(im, i % 2, i // 2, aid, line2)
    for i, aid in enumerate(CONCEPTS):
        a = C.find_asset(m, aid)
        with Image.open(C.abspath(a["steps"]["concept"]["output_path"])) as im:
            put(im, i, 2, f"{aid.split('.')[1]} concept (Gemini, ref_04 style ref)", "input image for route B")
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    sheet.save(args.out)
    log(f"sheet -> {C.rel(args.out)} ({W}x{H})")
    log("RESULT: bakeoff sheet ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

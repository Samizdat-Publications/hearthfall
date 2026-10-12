#!/usr/bin/env python
"""HUD v3: key the Gemini UI pieces (painted on flat magenta) into transparent WebP files in assets/ui/hud/.

  .venv/Scripts/python tools/assets/ui_key.py            every piece in tools/assets/raw/gemini/ui/pieces/
  .venv/Scripts/python tools/assets/ui_key.py --sheet    also writes reports/latest/hud_pieces_sheet.png

Unlike keying.py (border flood fill), magenta is removed everywhere, so holes such as the minimap ring keep their
transparent center. The edge band is softened and de-spilled, the piece is cropped to its content and scaled so its
long side is at most --max px. No API calls, no cost.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402

SRC = C.abspath("tools/assets/raw/gemini/ui/pieces")
OUT = C.abspath("assets/ui/hud")
OPAQUE: set = set()  # every piece is painted on magenta


def key_magenta(img: Image.Image) -> Image.Image:
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g  # 255 on pure magenta, negative on warm or green paint
    alpha = np.clip((150.0 - m) / 90.0, 0.0, 1.0)
    # de-spill: pull red and blue down toward green on partly magenta pixels
    spill = np.clip(m, 0, None) * (1.0 - alpha * 0.5)
    a[..., 0] = np.clip(r - spill, 0, 255)
    a[..., 2] = np.clip(b - spill, 0, 255)
    al = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.7))
    out = Image.fromarray(a.astype(np.uint8)).convert("RGBA")
    out.putalpha(al)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max", type=int, default=1400)
    ap.add_argument("--sheet", action="store_true")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    index = C.load_json(OUT / "index.json", {}) or {}
    done = []
    for src in sorted(SRC.glob("*.png")):
        pid = src.stem
        if a.only and pid not in a.only:
            continue
        img = Image.open(src)
        piece = img.convert("RGBA") if pid in OPAQUE else key_magenta(img)
        bbox = piece.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
        if bbox:
            piece = piece.crop(bbox)
        s = min(1.0, a.max / max(piece.size))
        if s < 1.0:
            piece = piece.resize((round(piece.width * s), round(piece.height * s)), Image.LANCZOS)
        dst = OUT / f"{pid}.webp"
        piece.save(dst, "WEBP", quality=88, method=6)
        index[pid] = {"w": piece.width, "h": piece.height, "src": C.rel(src), "sha256": C.sha256_file(src)}
        done.append((pid, piece))
    C.save_json_atomic(OUT / "index.json", index)
    if a.sheet and done:
        cols, cell = 4, 420
        rows = (len(done) + cols - 1) // cols
        sheet = Image.new("RGBA", (cols * cell, rows * cell), (40, 70, 90, 255))
        for k, (pid, p) in enumerate(done):
            t = p.copy()
            t.thumbnail((cell - 20, cell - 20))
            x, y = (k % cols) * cell + (cell - t.width) // 2, (k // cols) * cell + (cell - t.height) // 2
            sheet.alpha_composite(t, (x, y))
        dst = C.abspath("reports/latest/hud_pieces_sheet.png")
        sheet.convert("RGB").save(dst)
        print(f"sheet {C.rel(dst)}")
    print(f"RESULT: keyed {len(done)} pieces into {C.rel(OUT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

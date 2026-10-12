#!/usr/bin/env python
"""HUD v3 painted UI art: one Gemini image per call, with optional reference images.

  .venv/Scripts/python tools/assets/ui_gen.py --id ui.concept.a --prompt-file p.txt --ref a.webp --ref b.png \
      --aspect 16:9 --size 2K --out tools/assets/raw/gemini/ui/concept_a.png

Checks the Gemini cap (BUDGET_GEMINI_USD) and the total cap against ledger.jsonl before calling, then appends a
settled ledger line. Prints one RESULT line. Keys are never printed.
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from providers import gemini  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--prompt")
    ap.add_argument("--prompt-file")
    ap.add_argument("--ref", action="append", default=[])
    ap.add_argument("--aspect", default="1:1")
    ap.add_argument("--size", default="2K", choices=["1K", "2K", "4K"])
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    prompt = a.prompt or pathlib.Path(a.prompt_file).read_text(encoding="utf-8")
    est = C.PRICING["gemini_image_usd"][a.size]
    spent = C.spent_by_provider()
    if spent.get("gemini", 0.0) + est > C.cap_usd("gemini") or sum(spent.values()) + est > C.total_cap_usd():
        print(f"RESULT: skipped {a.id} (cap would be exceeded; gemini spent {spent.get('gemini', 0.0):.2f})")
        return 2
    refs = []
    for r in a.ref:
        mime = mimetypes.guess_type(r)[0] or "image/png"
        refs.append((mime, pathlib.Path(r).read_bytes()))
    res = gemini.generate_image(prompt, aspect_ratio=a.aspect, image_size=a.size, ref_images=refs)
    out = pathlib.Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    C.write_atomic_bytes(out, res["bytes"])
    n = sum(1 for e in C.ledger_entries() if e.get("asset") == a.id) + 1
    C.ledger_append({"provider": "gemini", "asset": a.id, "step": "ui", "attempt": n, "kind": "settled", "usd": est,
                     "units": 1, "unit": "image", "endpoint": res.get("endpoint")})
    print(f"RESULT: ok {a.id} -> {C.rel(out)} ({len(res['bytes']) // 1024} KB, ${est:.3f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

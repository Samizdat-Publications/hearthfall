#!/usr/bin/env python
"""A3 indexes and contact sheets.

  python tools/assets/a3_index.py index    assets/audio/index.json, assets/vfx/index.json, assets/icons/index.json
  python tools/assets/a3_index.py sheets   reports/latest/assets_icons_sheet.png and reports/latest/assets_vfx_sheet.png

Loudness is measured with ffmpeg ebur128 on the final OGG (integrated LUFS and true peak). No API calls.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import audio_post  # noqa: E402
import common as C  # noqa: E402
from common import log  # noqa: E402


def probe(ff, path):
    r = subprocess.run([ff, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=120)
    err = r.stderr
    dur = None
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    if m:
        dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    tail = err[err.rfind("Summary:"):] if "Summary:" in err else err
    li = re.search(r"I:\s+(-?[\d.]+) LUFS", tail)
    tp = re.search(r"Peak:\s+(-?[\d.]+) dBFS", tail)
    return {"duration_s": round(dur, 3) if dur else None,
            "lufs": float(li.group(1)) if li else None,
            "true_peak_db": float(tp.group(1)) if tp else None}


def build_audio_index(m):
    ff = audio_post.find_ffmpeg()
    entries = {}
    for a in m["assets"]:
        if a["class"] not in ("sfx", "music", "voice"):
            continue
        st = a["steps"]["post"]
        if st["status"] != "done" or not st.get("output_path"):
            continue
        f = C.abspath(st["output_path"])
        e = {"file": st["output_path"], "kind": a["class"], **probe(ff, f), "bytes": f.stat().st_size,
             "sha256": st.get("sha256"), "prompt": a["prompt"]}
        if a["class"] == "music":
            e["loop"] = True
            e["loop_crossfade_s"] = (st.get("meta") or {}).get("loop_crossfade_s")
            e["stem"] = a["id"].split(".", 1)[1]
        if a["class"] == "voice":
            e["voice"] = a["params"]["voice_key"]
            e["text"] = a["params"]["text"]
            e["language"] = "invented"
        e["event"] = a["id"].split(".", 1)[1]
        entries[a["id"]] = e
    entries = dict(sorted(entries.items()))
    return {"schema": 1, "generated": C.now_iso(), "format": "ogg vorbis, 44.1 kHz",
            "loudness_targets_lufs": audio_post.LOUDNESS, "count": len(entries), "entries": entries}


def build_vfx_index(m):
    entries = {}
    for a in m["assets"]:
        if a["class"] != "vfx" or a["steps"]["post"]["status"] != "done":
            continue
        meta = a["steps"]["post"]["meta"]
        entries[a["id"]] = {"file": a["steps"]["post"]["output_path"], "size": meta.get("size"), "blend": "additive",
                            "note": "RGBA keyed from black; rgb * alpha reproduces the source, so additive blending (or premultiplied alpha) matches the original",
                            "mean_alpha": round(meta.get("mean_alpha", 0), 3), "border_luma": round(meta.get("border_luma", 0), 1),
                            "sha256": a["steps"]["post"].get("sha256"), "prompt": a["prompt"]}
    return {"schema": 1, "generated": C.now_iso(), "count": len(entries), "entries": dict(sorted(entries.items()))}


def build_icon_index(m):
    entries = {}
    for a in m["assets"]:
        if a["class"] != "icons" or a["steps"]["post"]["status"] != "done":
            continue
        meta = a["steps"]["post"]["meta"]
        kind = a["id"].split(".")[1]
        entries[a["id"]] = {"file_256": meta["output_path"], "file_128": meta["output_128"], "kind": kind, "source": "gemini + ref_04",
                            "prompt": a["prompt"]}
    for a in m["assets"]:
        if a["class"] in ("buildings", "units") and ".bakeoff" not in a["id"]:
            stem = "icon." + a["id"]
            p256, p128 = C.OUT / "icons" / f"{stem}.png", C.OUT / "icons" / f"{stem}_128.png"
            if p256.exists() and p128.exists():
                entries[stem] = {"file_256": C.rel(p256), "file_128": C.rel(p128), "kind": a["class"][:-1] if a["class"].endswith("s") else a["class"],
                                 "source": "blender thumbnail, grey background keyed to transparent", "model": a["id"]}
    return {"schema": 1, "generated": C.now_iso(), "sizes": [128, 256], "count": len(entries), "entries": dict(sorted(entries.items()))}


def write_index(path, obj):
    C.save_json_atomic(path, obj)
    log(f"  {C.rel(path)}: {obj['count']} entries")


def font(sz):
    for f in (r"C:\Windows\Fonts\consola.ttf", r"C:\Windows\Fonts\arial.ttf"):
        if os.path.isfile(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def checker(w, h, s=16, a=(70, 70, 74), b=(92, 92, 96)):
    y, x = np.mgrid[0:h, 0:w]
    m = ((x // s + y // s) % 2).astype(bool)
    arr = np.where(m[..., None], np.array(b, dtype=np.uint8), np.array(a, dtype=np.uint8))
    return Image.fromarray(arr.astype(np.uint8)).convert("RGBA")


def sheet_icons(index):
    ids = list(index["entries"])
    spells = [i for i in ids if i.startswith("icon.spell.") or i.startswith("icon.resource.")]
    rest = [i for i in ids if i not in spells]
    order = spells + rest
    cols, tile, pad, lab = 6, 192, 12, 22
    rows = (len(order) + cols - 1) // cols
    W, H = cols * (tile + pad) + pad, rows * (tile + lab + pad) + pad + 30
    img = Image.new("RGBA", (W, H), (34, 30, 28, 255))
    d = ImageDraw.Draw(img)
    d.text((pad, 8), "Hearthfall A3 icons (256 px sources shown at 192, over a checkerboard to show transparency)", fill=(230, 220, 200), font=font(14))
    for n, i in enumerate(order):
        c, r = n % cols, n // cols
        x, y = pad + c * (tile + pad), 30 + pad + r * (tile + lab + pad)
        bg = checker(tile, tile)
        ic = Image.open(C.abspath(index["entries"][i]["file_256"])).convert("RGBA").resize((tile, tile), Image.LANCZOS)
        bg.alpha_composite(ic)
        img.paste(bg, (x, y))
        d.text((x, y + tile + 4), i.replace("icon.", ""), fill=(230, 220, 200), font=font(13))
    return img.convert("RGB")


def sheet_vfx(index):
    ids = list(index["entries"])
    cols, tile, pad, lab = 4, 320, 12, 22
    rows = (len(ids) + cols - 1) // cols
    W, H = cols * (tile + pad) + pad, rows * (tile + lab + pad) + pad + 30
    img = Image.new("RGB", (W, H), (30, 28, 26))
    d = ImageDraw.Draw(img)
    d.text((pad, 8), "Hearthfall A3 spell VFX textures, additive over dark terrain green (the in-game blend)", fill=(230, 220, 200), font=font(14))
    ground = np.array([0x2C, 0x4A, 0x20], dtype=np.float32)
    for n, i in enumerate(ids):
        c, r = n % cols, n // cols
        x, y = pad + c * (tile + pad), 30 + pad + r * (tile + lab + pad)
        im = Image.open(C.abspath(index["entries"][i]["file"])).convert("RGBA").resize((tile, tile), Image.LANCZOS)
        a = np.asarray(im, dtype=np.float32)
        add = a[..., :3] * (a[..., 3:4] / 255.0)
        out = np.clip(ground[None, None, :] + add, 0, 255).astype(np.uint8)
        img.paste(Image.fromarray(out), (x, y))
        d.text((x, y + tile + 4), i.replace("vfx.", ""), fill=(230, 220, 200), font=font(13))
    return img


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    m = C.load_manifest()
    if cmd == "index":
        write_index(C.OUT / "audio" / "index.json", build_audio_index(m))
        write_index(C.OUT / "vfx" / "index.json", build_vfx_index(m))
        write_index(C.OUT / "icons" / "index.json", build_icon_index(m))
        log("RESULT: a3 index ok")
        return 0
    if cmd == "sheets":
        C.REPORTS.mkdir(parents=True, exist_ok=True)
        ic = C.load_json(C.OUT / "icons" / "index.json")
        vf = C.load_json(C.OUT / "vfx" / "index.json")
        p1, p2 = C.REPORTS / "assets_icons_sheet.png", C.REPORTS / "assets_vfx_sheet.png"
        sheet_icons(ic).save(p1)
        sheet_vfx(vf).save(p2)
        log(f"  {C.rel(p1)}\n  {C.rel(p2)}")
        log("RESULT: a3 sheets ok")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

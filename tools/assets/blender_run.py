#!/usr/bin/env python
"""Blender wrapper (docs/ASSETS.md section 4). Blender runs only through this file.

  python tools/assets/blender_run.py normalize --in raw.glb --out assets/models/x.glb [--height H|--footprint F] ...
  python tools/assets/blender_run.py thumbs --class buildings        (or --in x.glb --out x.png)

Executable: BLENDER_EXE from .env; if unset or pointing at a missing file, falls back to the newest
C:\\Program Files\\Blender Foundation\\Blender *\\blender.exe and says so (stderr).
Command shape: BLENDER_EXE --background --factory-startup -noaudio --python-exit-code 1 --python SCRIPT -- ARGS
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log, warn  # noqa: E402

BLENDER_DIR = C.ASSETS_DIR / "blender"
WORK = C.RAW / "_work"
_notified = False


def find_blender() -> str:
    global _notified
    exe = os.getenv("BLENDER_EXE")
    if exe and os.path.isfile(exe):
        return exe
    cands = sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender *\blender.exe"), reverse=True)
    if not cands:
        raise RuntimeError("Blender not found: BLENDER_EXE unset or missing and no install under Program Files")
    if not _notified:
        warn(f"BLENDER_EXE {'unset' if not exe else 'points at a missing file'}; falling back to {cands[0]}")
        _notified = True
    return cands[0]


def run_blender(script, script_args, timeout=300) -> str:
    cmd = [find_blender(), "--background", "--factory-startup", "-noaudio", "--python-exit-code", "1",
           "--python", str(script), "--"] + [str(a) for a in script_args]
    env = dict(os.environ, PYTHONUTF8="1")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        tail = (r.stderr or r.stdout)[-1200:]
        raise RuntimeError(f"blender exit {r.returncode}: {tail}")
    return r.stdout


def palette_file() -> str:
    WORK.mkdir(parents=True, exist_ok=True)
    p = WORK / "palette.json"
    C.save_json_atomic(p, C.palette_hex())
    return str(p)


# Units never show water, snow, foliage or fire colors: snapping to this subset keeps blues on the tribe color
# (azure) instead of water, and reds/oranges/greens on crimson/amber/jade instead of lava, fire, meadow.
UNIT_PALETTE = ["sand", "rock", "rockDark", "wood", "woodDark", "thatch", "stone", "skin1", "skin2", "skin3", "cloth",
                "azure", "crimson", "amber", "jade", "scar"]


# Buildings keep world, wood, stone, thatch and glow colors but drop the other tribe colors and all water colors, so the
# only blue on a building is the tribe banner (azure) and fire-lodge clay or gems never read as crimson, amber or jade.
BUILDING_PALETTE = ["sand", "meadow", "moss", "forest", "rock", "rockDark", "snow", "wood", "woodDark", "thatch", "stone",
                    "skin1", "skin2", "skin3", "cloth", "azure", "fire", "lava", "lightning", "magic", "scar"]


def normalize(inp, out, *, height=None, footprint=None, tri_min=0, tri_max=0, scheme="sample", default_color="stone", report=None,
              allow=None, tribe_color="azure", side_color="skin1", torso_color="cloth") -> dict:
    out = str(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    report = str(report or (WORK / (os.path.basename(out) + ".report.json")))
    args = ["--in", inp, "--out", out, "--palette", palette_file(), "--report", report,
            "--tri-min", tri_min, "--tri-max", tri_max, "--scheme", scheme, "--default-color", default_color,
            "--tribe-color", tribe_color, "--side-color", side_color, "--torso-color", torso_color]
    if allow:
        args += ["--allow", ",".join(allow)]
    if height:
        args += ["--height", height]
    if footprint:
        args += ["--footprint", footprint]
    run_blender(BLENDER_DIR / "normalize.py", args)
    return json.load(open(report, encoding="utf-8"))


def normalize_asset(a: dict) -> dict:
    p = a["params"]
    sp = C.style_json().get("triBudgets", {})
    lo, hi = sp.get(p.get("budget_class", "prop"), [0, 0])
    inp = C.abspath(a["steps"]["model"]["output_path"])
    out = C.OUT / "models" / f"{a['id']}.glb"
    rep = normalize(str(inp), out, height=p.get("height"), footprint=p.get("footprint"), tri_min=lo, tri_max=hi,
                    scheme=p.get("scheme", "sample"), default_color=p.get("default_color", "stone"),
                    allow=UNIT_PALETTE if p.get("budget_class") == "unit" else (BUILDING_PALETTE if p.get("budget_class") == "building" else None), tribe_color=p.get("tribe_color", "azure"),
                    side_color=p.get("side_color", "skin1"), torso_color=p.get("torso_color", "cloth"))
    rep["output_path"] = C.rel(out)
    return rep


def thumbs_for(assets, manifest=None, size=256) -> None:
    jobs, by_out = [], {}
    for a in assets:
        post = a["steps"]["post"]
        if post["status"] != "done" or not post.get("output_path"):
            continue
        out = C.OUT / "icons" / f"{a['id']}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        jobs.append({"in": str(C.abspath(post["output_path"])), "out": str(out), "size": size})
        by_out[str(out)] = a
    if not jobs:
        return
    WORK.mkdir(parents=True, exist_ok=True)
    jf = WORK / "thumb_jobs.json"
    C.save_json_atomic(jf, jobs)
    stdout = run_blender(BLENDER_DIR / "thumbs.py", ["--jobs", jf], timeout=480)
    line = next((l for l in stdout.splitlines() if l.startswith("THUMBS_RESULT ")), None)
    results = json.loads(line[len("THUMBS_RESULT "):]) if line else []
    ok_in = {r["in"]: r for r in results}
    for j in jobs:
        a = by_out[j["out"]]
        st = a["steps"]["thumb"]
        r = ok_in.get(j["in"], {"ok": False, "error": "no result"})
        if r["ok"] and os.path.exists(j["out"]):
            from PIL import Image

            with Image.open(j["out"]) as im:
                im.resize((128, 128), Image.LANCZOS).save(str(C.OUT / "icons" / f"{a['id']}_128.png"))
            st.update(status="done", finished=C.now_iso(), output_path=C.rel(j["out"]), sha256=C.sha256_file(j["out"]),
                      attempts=st["attempts"] + 1, error=None)
            log(f"  thumb {a['id']} -> {C.rel(j['out'])}")
        else:
            st.update(attempts=st["attempts"] + 1, error=r.get("error"), status="pending" if st["attempts"] < C.MAX_ATTEMPTS else "needs_review")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("normalize")
    n.add_argument("--in", dest="inp", required=True)
    n.add_argument("--out", required=True)
    n.add_argument("--height", type=float)
    n.add_argument("--footprint", type=float)
    n.add_argument("--tri-min", type=int, default=0)
    n.add_argument("--tri-max", type=int, default=0)
    n.add_argument("--scheme", default="sample")
    n.add_argument("--default-color", default="stone")
    t = sub.add_parser("thumbs")
    t.add_argument("--class", dest="cls")
    t.add_argument("--in", dest="inp")
    t.add_argument("--out")
    t.add_argument("--size", type=int, default=256)
    args = ap.parse_args()
    if args.cmd == "normalize":
        rep = normalize(args.inp, args.out, height=args.height, footprint=args.footprint, tri_min=args.tri_min,
                        tri_max=args.tri_max, scheme=args.scheme, default_color=args.default_color)
        log(json.dumps({k: rep[k] for k in ("tris_in", "tris_out", "bounds_min", "bounds_max", "warnings")}))
        log("RESULT: normalize ok")
        return 0
    if args.inp:
        WORK.mkdir(parents=True, exist_ok=True)
        jf = WORK / "thumb_jobs_adhoc.json"
        C.save_json_atomic(jf, [{"in": os.path.abspath(args.inp), "out": os.path.abspath(args.out), "size": args.size}])
        run_blender(BLENDER_DIR / "thumbs.py", ["--jobs", jf])
        log("RESULT: thumbs ok")
        return 0
    m = C.load_manifest()
    todo = [a for a in m["assets"] if (not args.cls or a["class"] == args.cls) and a["steps"]["thumb"]["status"] == "pending"]
    thumbs_for(todo, m, args.size)
    C.save_manifest(m)
    log(f"RESULT: thumbs ok ({len(todo)} considered)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

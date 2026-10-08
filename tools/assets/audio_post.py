#!/usr/bin/env python
"""Audio post pass (docs/ASSETS.md section 4): trim leading silence, normalize loudness, convert to OGG.

  python tools/assets/audio_post.py [--check]     process every sfx/music row whose generation step is done

Uses ffmpeg (PATH, or the winget Links folder). If ffmpeg is missing this is a stub: it prints exactly what it
would do and exits 0 (the row's post step is then marked skipped, never failed).
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log  # noqa: E402

LOUDNESS = {"sfx": -18.0, "music": -16.0}  # integrated LUFS targets, one per class


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    guess = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe")
    return guess if os.path.isfile(guess) else None


def ffmpeg_cmd(ff, src, dst, cls):
    chain = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02"
    chain += f",loudnorm=I={LOUDNESS[cls]}:TP=-1.5:LRA=11"
    return [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-af", chain, "-c:a", "libvorbis", "-q:a", "4", str(dst)]


def post_asset(a: dict) -> dict:
    src = C.abspath(a["steps"]["model"]["output_path"])
    dst = C.OUT / "audio" / f"{a['id']}.ogg"
    dst.parent.mkdir(parents=True, exist_ok=True)
    ff = find_ffmpeg()
    if not ff:
        return {"status": "stub", "message": f"ffmpeg missing: would run `{' '.join(ffmpeg_cmd('ffmpeg', src, dst, a['class']))}`"}
    subprocess.run(ffmpeg_cmd(ff, src, dst, a["class"]), check=True, timeout=120, capture_output=True)
    return {"output_path": C.rel(dst), "bytes": dst.stat().st_size, "loudness_target_lufs": LOUDNESS[a["class"]], "ffmpeg": "ok"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="only report ffmpeg availability")
    args = ap.parse_args()
    ff = find_ffmpeg()
    log(f"ffmpeg: {'found' if ff else 'MISSING (stub mode)'}")
    if args.check:
        log("RESULT: audio_post check ok")
        return 0
    m = C.load_manifest()
    n = 0
    for a in m["assets"]:
        if a["class"] not in ("sfx", "music"):
            continue
        st, mod = a["steps"]["post"], a["steps"]["model"]
        if mod["status"] != "done" or st["status"] == "done":
            continue
        res = post_asset(a)
        if res.get("status") == "stub":
            log(f"  {a['id']}: {res['message']}")
            continue
        st.update(status="done", finished=C.now_iso(), output_path=res["output_path"], sha256=C.sha256_file(C.abspath(res["output_path"])), meta=res)
        n += 1
        log(f"  {a['id']} -> {res['output_path']}")
    C.save_manifest(m)
    log(f"RESULT: audio_post {n} file(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

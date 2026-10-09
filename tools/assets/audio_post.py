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

LOUDNESS = {"sfx": -18.0, "music": -16.0, "voice": -18.0}
LOOP_XFADE_S = 2.0  # music: tail crossfaded into the head so the file loops seamlessly  # integrated LUFS targets, one per class


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    guess = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe")
    return guess if os.path.isfile(guess) else None


def duration_s(ff, src):
    import re

    exe = shutil.which("ffprobe")
    if not exe:
        cand = os.path.join(os.path.dirname(ff), "ffprobe.exe")
        exe = cand if os.path.isfile(cand) else None
    if exe:
        r = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(src)],
                           capture_output=True, text=True, timeout=60)
        try:
            return float(r.stdout.strip())
        except ValueError:
            pass
    r = subprocess.run([ff, "-i", str(src)], capture_output=True, text=True, timeout=60)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0.0


def ffmpeg_cmd(ff, src, dst, cls, length=None, loud=None):
    if cls == "music" and length and length > 4 * LOOP_XFADE_S:
        x, L = LOOP_XFADE_S, length
        graph = (f"[0:a]asplit=3[a][b][c];[a]atrim=0:{x},asetpts=PTS-STARTPTS[head];[b]atrim={L - x:.3f}:{L:.3f},asetpts=PTS-STARTPTS[tail];"
                 f"[c]atrim={x}:{L - x:.3f},asetpts=PTS-STARTPTS[mid];[tail][head]acrossfade=d={x}:c1=tri:c2=tri[xf];"
                 f"[xf][mid]concat=n=2:v=0:a=1,loudnorm=I={LOUDNESS[cls]}:TP=-1.5:LRA=11[out]")
        return [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-filter_complex", graph, "-map", "[out]",
                "-c:a", "libvorbis", "-q:a", "4", str(dst)]
    chain = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02"
    chain += "," + (loud or f"loudnorm=I={LOUDNESS[cls]}:TP=-1.5:LRA=11")
    return [ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-af", chain, "-c:a", "libvorbis", "-q:a", "4", str(dst)]


def measure_loudnorm(ff, src, cls):
    """First loudnorm pass on the trimmed clip; returns a second-pass filter string (linear when possible) or None."""
    import json
    import re

    chain = f"silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02,loudnorm=I={LOUDNESS[cls]}:TP=-1.5:LRA=11:print_format=json"
    r = subprocess.run([ff, "-hide_banner", "-nostats", "-i", str(src), "-af", chain, "-f", "null", "-"], capture_output=True, text=True, timeout=120)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        return None
    try:
        j = json.loads(m.group(0))
        vals = {k: float(j[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}
    except (ValueError, KeyError):
        return None
    if vals["input_i"] < -60:
        return None
    return (f"loudnorm=I={LOUDNESS[cls]}:TP=-1.5:LRA=11:measured_I={vals['input_i']}:measured_TP={vals['input_tp']}:"
            f"measured_LRA={vals['input_lra']}:measured_thresh={vals['input_thresh']}:offset={vals['target_offset']}:linear=true")


def post_asset(a: dict) -> dict:
    src = C.abspath(a["steps"]["model"]["output_path"])
    dst = C.OUT / "audio" / f"{a['id']}.ogg"
    dst.parent.mkdir(parents=True, exist_ok=True)
    ff = find_ffmpeg()
    if not ff:
        return {"status": "stub", "message": f"ffmpeg missing: would run `{' '.join(ffmpeg_cmd('ffmpeg', src, dst, a['class']))}`"}
    length = duration_s(ff, src) if a["class"] == "music" else None
    loud = measure_loudnorm(ff, src, a["class"]) if a["class"] != "music" else None
    subprocess.run(ffmpeg_cmd(ff, src, dst, a["class"], length, loud), check=True, timeout=180, capture_output=True)
    return {"output_path": C.rel(dst), "bytes": dst.stat().st_size, "loudness_target_lufs": LOUDNESS[a["class"]], "ffmpeg": "ok",
            "loop_crossfade_s": LOOP_XFADE_S if length else None}


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
        if a["class"] not in ("sfx", "music", "voice"):
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

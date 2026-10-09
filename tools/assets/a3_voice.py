#!/usr/bin/env python
"""Design the Shaper voice once (ElevenLabs Voice Design) and store its voice_id in tools/assets/voices.json.

  python tools/assets/a3_voice.py design [--pick N]   design previews, save them under raw/elevenlabs/_voices/, save preview N (default 0) as a voice

Voice ids are not secrets. One paid design call per voice; re-running refuses if the voice already exists (delete the key to redo).
"""
from __future__ import annotations

import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log  # noqa: E402
from providers import ProviderError, elevenlabs  # noqa: E402
import seed  # noqa: E402

VOICES = C.ASSETS_DIR / "voices.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["design"])
    ap.add_argument("--pick", type=int, default=0)
    args = ap.parse_args()
    v = seed.SHAPER_VOICE
    voices = C.load_json(VOICES, {}) or {}
    if v["key"] in voices:
        log(f"voice '{v['key']}' already exists in voices.json; nothing to do")
        return 0
    b = C.Budget(None)
    est = C.PRICING["elevenlabs_voice_design_usd"]
    ok, why = b.check("elevenlabs", est)
    if not ok:
        log(f"BLOCKED: {why}")
        return 2
    try:
        res = elevenlabs.design_voice(v["description"], v["sample_text"])
    except ProviderError as e:
        C.ledger_append({"provider": "elevenlabs", "asset": f"voice.{v['key']}", "step": "design", "attempt": 1, "kind": "failed", "usd": 0.0, "note": e.message[:160]})
        log(f"design failed: {e}")
        return 1
    prev = res["json"].get("previews", [])
    outdir = C.RAW / "elevenlabs" / "_voices"
    for i, p in enumerate(prev):
        C.write_atomic_bytes(outdir / f"{v['key']}_preview{i}.mp3", base64.b64decode(p["audio_base_64"]))
    C.ledger_append({"provider": "elevenlabs", "asset": f"voice.{v['key']}", "step": "design", "attempt": 1, "kind": "call", "usd": est,
                     "units": len(prev), "unit": "previews", "headers": res["headers"], "note": "design cost not published; $0.01 assumed"})
    if not prev:
        log("no previews returned")
        return 1
    pick = prev[min(args.pick, len(prev) - 1)]
    saved = elevenlabs.create_voice_from_preview(v["name"], v["description"], pick["generated_voice_id"])
    vid = saved["json"].get("voice_id")
    voices[v["key"]] = {"voice_id": vid, "name": v["name"], "description": v["description"], "designed": C.now_iso(),
                        "previews": len(prev), "picked": min(args.pick, len(prev) - 1), "model": "eleven_multilingual_ttv_v2"}
    C.save_json_atomic(VOICES, voices)
    log(f"designed voice '{v['key']}' ({len(prev)} previews, picked {min(args.pick, len(prev) - 1)}); voice_id saved to {C.rel(VOICES)}")
    log("RESULT: voice design ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())

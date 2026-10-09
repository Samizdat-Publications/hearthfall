"""ElevenLabs client. Source: docs/research/asset_apis.md section 5 (checked 2026-10-08).

Synchronous: the response body is the audio. Header xi-api-key. SFX: POST /v1/sound-generation
(text, duration_seconds 0.5..30, prompt_influence, loop, model_id eleven_text_to_sound_v2, query output_format).
Music: POST /v1/music (model_id music_v2_5 passed explicitly, force_instrumental, music_length_ms 3000..600000), paid plan.
"""
from __future__ import annotations

from . import http
from common import require_key

BASE = "https://api.elevenlabs.io"


def _h():
    return {"xi-api-key": require_key("elevenlabs"), "Content-Type": "application/json"}


def _keep(headers) -> dict:
    keep = ("request-id", "history-item-id", "song-id", "character-cost", "current-concurrent-requests", "maximum-concurrent-requests")
    return {k: v for k, v in headers.items() if k.lower() in keep}


def models() -> list:
    return http("elevenlabs", "GET", f"{BASE}/v1/models", headers=_h(), timeout=30, retry_5xx=True).json()


def sound_effect(text: str, *, duration_seconds=None, prompt_influence=0.3, loop=False,
                 output_format="mp3_44100_128") -> dict:
    body = {"text": text, "model_id": "eleven_text_to_sound_v2", "prompt_influence": prompt_influence}
    if duration_seconds is not None:
        body["duration_seconds"] = max(0.5, min(30.0, float(duration_seconds)))
    if loop:
        body["loop"] = True
    r = http("elevenlabs", "POST", f"{BASE}/v1/sound-generation", headers=_h(), json=body,
             params={"output_format": output_format}, timeout=120)
    return {"bytes": r.content, "headers": _keep(r.headers), "content_type": r.headers.get("content-type")}


def music(prompt: str, *, length_ms=60000, output_format="mp3_44100_128") -> dict:
    body = {"prompt": prompt, "music_length_ms": int(length_ms), "model_id": "music_v2_5", "force_instrumental": True}
    r = http("elevenlabs", "POST", f"{BASE}/v1/music", headers=_h(), json=body,
             params={"output_format": output_format}, timeout=300)
    return {"bytes": r.content, "headers": _keep(r.headers), "content_type": r.headers.get("content-type")}


def tts(voice_id: str, text: str, *, model_id="eleven_v4", output_format="mp3_44100_128", voice_settings=None, seed=None) -> dict:
    body = {"text": text, "model_id": model_id}
    if voice_settings:
        body["voice_settings"] = voice_settings
    if seed is not None:
        body["seed"] = seed
    r = http("elevenlabs", "POST", f"{BASE}/v1/text-to-speech/{voice_id}", headers=_h(), json=body,
             params={"output_format": output_format}, timeout=120)
    return {"bytes": r.content, "headers": _keep(r.headers), "content_type": r.headers.get("content-type")}


def design_voice(description: str, text: str, *, model_id="eleven_multilingual_ttv_v2", seed=None, guidance_scale=5) -> dict:
    """POST /v1/text-to-voice/design -> previews (generated_voice_id + base64 mp3). Source: ElevenLabs API reference, checked 2026-10-08."""
    body = {"voice_description": description, "text": text, "model_id": model_id, "guidance_scale": guidance_scale}
    if seed is not None:
        body["seed"] = seed
    r = http("elevenlabs", "POST", f"{BASE}/v1/text-to-voice/design", headers=_h(), json=body,
             params={"output_format": "mp3_44100_128"}, timeout=180)
    return {"json": r.json(), "headers": _keep(r.headers)}


def create_voice_from_preview(name: str, description: str, generated_voice_id: str) -> dict:
    """POST /v1/text-to-voice -> saved voice (voice_id)."""
    body = {"voice_name": name, "voice_description": description, "generated_voice_id": generated_voice_id}
    r = http("elevenlabs", "POST", f"{BASE}/v1/text-to-voice", headers=_h(), json=body, timeout=60)
    return {"json": r.json(), "headers": _keep(r.headers)}

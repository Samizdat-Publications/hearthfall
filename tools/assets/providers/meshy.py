"""Meshy client. Source: docs/research/asset_apis.md section 2 (checked 2026-10-08).

Base https://api.meshy.ai/openapi ; Bearer auth ; POST returns {"result": "<task_id>"}; poll GET until
SUCCEEDED / FAILED / CANCELED ; model_urls keys may be missing (check before download) ; assets deleted after 3 days.
Smart topology: ai_model meshy-t2, model_type smart-topology, target_polycount 100..15000 (triangles only).
Never use meshy-5 (retires 2026-10-10) or model_type lowpoly (retires 2026-10-30).
"""
from __future__ import annotations

from . import ProviderError, http
from common import require_key

BASE = "https://api.meshy.ai/openapi"
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELED"}
FORBIDDEN_MODELS = {"meshy-5"}


def _h():
    return {"Authorization": f"Bearer {require_key('meshy')}"}


def balance() -> dict:
    return http("meshy", "GET", f"{BASE}/v1/balance", headers=_h(), timeout=30, retry_5xx=True).json()


def create_text_to_3d_preview(prompt: str, *, target_polycount=800, ai_model="meshy-t2") -> str:
    """Untextured smart-topology preview (5 credits on meshy-t2). Prompt cap 800 chars."""
    assert ai_model not in FORBIDDEN_MODELS
    body = {"mode": "preview", "prompt": prompt[:800], "ai_model": ai_model,
            "model_type": "smart-topology", "target_polycount": int(target_polycount)}
    return http("meshy", "POST", f"{BASE}/v2/text-to-3d", headers=_h(), json=body, timeout=60).json()["result"]


def create_image_to_3d(image_data_uri: str, *, target_polycount=1500, ai_model="meshy-t2", textured=False) -> str:
    """Image to 3D (5 credits mesh only, 15 textured on meshy-t2).
    UNVERIFIED param names (not spelled out in the research file): image_url, should_texture.
    Confirm on the first A1 call before relying on them."""
    assert ai_model not in FORBIDDEN_MODELS
    body = {"image_url": image_data_uri, "ai_model": ai_model, "model_type": "smart-topology",
            "target_polycount": int(target_polycount), "should_texture": bool(textured)}
    return http("meshy", "POST", f"{BASE}/v1/image-to-3d", headers=_h(), json=body, timeout=120).json()["result"]


def get_task(kind: str, task_id: str) -> dict:
    path = {"text": "v2/text-to-3d", "image": "v1/image-to-3d"}[kind]
    return http("meshy", "GET", f"{BASE}/{path}/{task_id}", headers=_h(), timeout=30, retry_5xx=True).json()


def glb_url(task: dict):
    return (task.get("model_urls") or {}).get("glb")


def download(url: str) -> bytes:
    return http("meshy", "GET", url, timeout=120, retry_5xx=True).content


def credits(task: dict) -> float:
    return float(task.get("consumed_credits") or 0)

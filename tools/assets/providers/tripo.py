"""Tripo client (V3 only). Source: docs/research/asset_apis.md section 3 (checked 2026-10-08).

Base https://openapi.tripo3d.com/v3 ; Bearer auth ; {"code":0,"data":{...}} envelope ; poll GET /tasks/{id}
until success / failed / banned / expired / cancelled ; model URLs are short-lived signed links, download at once.
NOT smoke tested in A0 (the bake-off is A1). Dated model ids are pinned per research 3.4 and must be confirmed
by the first real task. generate_parts cannot combine with texture/pbr/quad/smart_low_poly. Never retry `banned`.
"""
from __future__ import annotations

from . import ProviderError, http
from common import require_key

BASE = "https://openapi.tripo3d.com/v3"
TERMINAL = {"success", "failed", "banned", "expired", "cancelled"}
H_MODEL = "v3.1-20260211"
P_MODEL = "P1-20260311"


def _h():
    return {"Authorization": f"Bearer {require_key('tripo')}"}


def _unwrap(r) -> dict:
    j = r.json()
    if j.get("code") != 0:
        raise ProviderError("tripo", r.status_code, f"code {j.get('code')}: {j.get('message')} {j.get('suggestion', '')}"[:400])
    return j["data"]


def balance() -> dict:
    return _unwrap(http("tripo", "GET", f"{BASE}/account/balance", headers=_h(), timeout=30, retry_5xx=True))


def upload_image(png_bytes: bytes, name="concept.png") -> str:
    """POST /files (multipart, images up to 20 MB). The token field name is UNVERIFIED; tries common keys."""
    d = _unwrap(http("tripo", "POST", f"{BASE}/files", headers=_h(), files={"file": (name, png_bytes, "image/png")}, timeout=120))
    return d.get("file_token") or d.get("token") or d["id"]


def create_image_to_model(file_token: str, *, model=H_MODEL, smart_low_poly=True, face_limit=None,
                          texture=False, pbr=False, model_seed=None) -> str:
    """Single `input` field accepts a task_id, file_token or URL (research 3.3). texture/pbr default true, so set explicitly."""
    body = {"input": file_token, "model": model, "texture": texture, "pbr": pbr}
    if smart_low_poly:
        body["smart_low_poly"] = True
    if face_limit:
        body["face_limit"] = int(face_limit)
    if model_seed is not None:
        body["model_seed"] = int(model_seed)
    return _unwrap(http("tripo", "POST", f"{BASE}/generation/image-to-model", headers=_h(), json=body, timeout=60))["task_id"]


def get_task(task_id: str) -> dict:
    return _unwrap(http("tripo", "GET", f"{BASE}/tasks/{task_id}", headers=_h(), timeout=30, retry_5xx=True))


def model_url(task: dict):
    return (task.get("output") or {}).get("model_url")


def download(url: str) -> bytes:
    return http("tripo", "GET", url, timeout=120, retry_5xx=True).content


def credits(task: dict) -> float:
    return float(task.get("credits_consumed") or 0)

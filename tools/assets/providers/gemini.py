"""Gemini image client. Source: docs/research/asset_apis.md section 6 (checked 2026-10-08).

Primary route: Interactions API (POST /v1beta/interactions). The research notes the response shape only as
"base64 image in the output", so extraction searches the JSON recursively for an inline image payload.
If Interactions rejects the request (4xx, not charged) we fall back to the generateContent route and record
which one worked.
"""
from __future__ import annotations

import base64

from . import ProviderError, http
from common import require_key

BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-nano-banana-2.1"


def _headers():
    return {"x-goog-api-key": require_key("gemini"), "Content-Type": "application/json"}


def _find_image(node):
    """Recursively find (mime, base64) of the first inline image in a response."""
    if isinstance(node, dict):
        data = node.get("data") or node.get("bytesBase64Encoded")
        mime = node.get("mime_type") or node.get("mimeType")
        if isinstance(data, str) and len(data) > 1000 and (mime or "").startswith("image/"):
            return mime, data
        for v in node.values():
            r = _find_image(v)
            if r:
                return r
    elif isinstance(node, list):
        for v in node:
            r = _find_image(v)
            if r:
                return r
    return None


def generate_image(prompt: str, *, model=DEFAULT_MODEL, aspect_ratio="1:1", image_size="1K",
                   ref_images=None, previous_interaction_id=None):
    """Returns dict(bytes, mime, endpoint, interaction_id, usage). image_size must use an uppercase K.
    ref_images: list of (mime, raw_bytes)."""
    parts = [{"type": "text", "text": prompt}]
    for mime, raw in (ref_images or []):
        parts.append({"type": "image", "mime_type": mime, "data": base64.b64encode(raw).decode("ascii")})
    body = {
        "model": model,
        "input": parts if len(parts) > 1 else prompt,
        "response_format": {"type": "image", "aspect_ratio": aspect_ratio, "image_size": image_size, "mime_type": "image/png"},
    }
    if previous_interaction_id:
        body["previous_interaction_id"] = previous_interaction_id
    try:
        r = http("gemini", "POST", f"{BASE}/interactions", headers=_headers(), json=body, timeout=180, retries=3)
        j = r.json()
        found = _find_image(j)
        if not found:
            raise ProviderError("gemini", r.status_code, f"no inline image in interactions response (top keys {sorted(j)[:8]})")
        mime, b64 = found
        return {"bytes": base64.b64decode(b64), "mime": mime, "endpoint": "interactions",
                "interaction_id": j.get("id"), "usage": j.get("usage") or j.get("usageMetadata")}
    except ProviderError as e:
        # Fall back only on client errors (request rejected: nothing generated or billed).
        if e.status is None or not (400 <= e.status < 500) or e.status == 429:
            raise
        interactions_err = e
    gparts = [{"text": prompt}] + [{"inlineData": {"mimeType": m, "data": base64.b64encode(b).decode("ascii")}} for m, b in (ref_images or [])]
    gbody = {
        "contents": [{"parts": gparts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect_ratio, "imageSize": image_size}},
    }
    try:
        r = http("gemini", "POST", f"{BASE}/models/{model}:generateContent", headers=_headers(), json=gbody, timeout=180, retries=3)
    except ProviderError as e2:
        raise ProviderError("gemini", e2.status, f"interactions: {interactions_err.message[:200]} | generateContent: {e2.message[:200]}")
    j = r.json()
    found = _find_image(j)
    if not found:
        raise ProviderError("gemini", r.status_code, f"no inline image in generateContent response (top keys {sorted(j)[:8]})")
    mime, b64 = found
    return {"bytes": base64.b64decode(b64), "mime": mime, "endpoint": "generateContent",
            "interaction_id": None, "usage": j.get("usageMetadata"),
            "fallback_reason": f"interactions HTTP {interactions_err.status}: {interactions_err.message[:200]}"}

"""Shared helpers for the Hearthfall asset pipeline.

Paths, .env loading (presence-only logging), atomic manifest IO, hashing,
the append-only spend ledger and budget checks. Never prints key values.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
ASSETS_DIR = ROOT / "tools" / "assets"
MANIFEST = ASSETS_DIR / "assets.json"
LEDGER = ASSETS_DIR / "ledger.jsonl"
STYLE_PROMPT = ASSETS_DIR / "style_prompt.json"
RAW = ASSETS_DIR / "raw"
OUT = ROOT / "assets"
REPORTS = ROOT / "reports" / "latest"
LOCK = RAW / ".gen.lock"

try:  # python-dotenv is in requirements.txt
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except Exception:  # pragma: no cover
    pass

STEP_ORDER = ["concept", "model", "rig", "animate", "post", "thumb"]
STEP_STATUSES = {"pending", "submitted", "done", "failed", "needs_review", "skipped"}
MAX_ATTEMPTS = 3

# List prices verified 2026-10-08 (docs/research/asset_apis.md). USD unless noted.
# Meshy credit price is NOT published by Meshy; $0.02 (Pro tier) is the conservative assumption.
PRICING = {
    "verified_on": "2026-10-08",
    "gemini_image_usd": {"1K": 0.0336, "2K": 0.0504, "4K": 0.113},
    "meshy_usd_per_credit": 0.02,
    "meshy_credits": {
        "text_preview_t2": 5,
        "image_mesh_t2": 5,
        "image_textured_t2": 15,
        "rig": 5,
        "anim_per_action": 3,
    },
    "tripo_usd_per_credit": 0.01,
    "tripo_credits": {"image_to_model_smart_low_poly": 40},
    "elevenlabs_sfx_usd_per_second": 0.002,
    "elevenlabs_music_usd_per_minute": 0.15,
}

PROVIDERS = ["gemini", "meshy", "tripo", "elevenlabs", "pixellab"]


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def canon(o) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rel(p) -> str:
    """Repo-relative posix path for manifest storage."""
    p = pathlib.Path(p).resolve()
    try:
        return p.relative_to(ROOT).as_posix()
    except ValueError:
        return p.as_posix()


def abspath(r: str) -> pathlib.Path:
    return ROOT / r


def write_atomic_bytes(path: pathlib.Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def save_json_atomic(path: pathlib.Path, data) -> None:
    write_atomic_bytes(path, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def load_json(path: pathlib.Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


# ----------------------------------------------------------------- env / keys
KEY_VARS = {
    "gemini": "GEMINI_API_KEY",
    "meshy": "MESHY_API_KEY",
    "tripo": "TRIPO_API_KEY",
    "elevenlabs": "ELEVENLABS_API_KEY",
    "pixellab": "PIXELLAB_API_KEY",
}


def key_present(provider: str) -> bool:
    return bool(os.getenv(KEY_VARS[provider]))


def require_key(provider: str) -> str:
    v = os.getenv(KEY_VARS[provider])
    if not v:
        raise RuntimeError(f"{KEY_VARS[provider]} is not set (presence check only; value never printed)")
    return v


def cap_usd(provider: str) -> float:
    try:
        return float(os.getenv(f"BUDGET_{provider.upper()}_USD", "0") or 0)
    except ValueError:
        return 0.0


def total_cap_usd() -> float:
    try:
        return float(os.getenv("BUDGET_TOTAL_USD", "0") or 0)
    except ValueError:
        return 0.0


# --------------------------------------------------------------- style files
def style_json() -> dict:
    """Single source of truth: data/base/style.json when present, else the seed copy.
    Provides palette, triBudgets, styleVersion, promptStyleSuffix and promptNegative."""
    for p in (ROOT / "data" / "base" / "style.json", ROOT / "seed-data" / "style.json"):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return {}


def style_prompt() -> dict:
    """Prompt text for every provider. `suffix`, `negative` and `style_version` come from style.json
    (promptStyleSuffix, promptNegative, styleVersion); style_prompt.json only adds per-class fragments
    (concept_camera, mesh_suffix, unit_pose, templates). A style.json key always wins over style_prompt.json."""
    sp = dict(load_json(STYLE_PROMPT, {}))
    sj = style_json()
    if sj.get("promptStyleSuffix"):
        sp["suffix"] = sj["promptStyleSuffix"]
    if sj.get("promptNegative"):
        sp["negative"] = sj["promptNegative"]
    sp["style_version"] = sj.get("styleVersion", sp.get("style_version", 1))
    return sp


def palette_hex() -> dict:
    return style_json().get("palette", {})


# ------------------------------------------------------------------ manifest
def load_manifest() -> dict:
    m = load_json(MANIFEST)
    if m is None:
        m = {"schema_version": 1, "style_version": style_prompt().get("style_version", 1), "assets": []}
    return m


def save_manifest(m: dict) -> None:
    save_json_atomic(MANIFEST, m)


def find_asset(m: dict, asset_id: str):
    for a in m["assets"]:
        if a["id"] == asset_id:
            return a
    return None


def new_step(status="pending", provider=None) -> dict:
    return {
        "status": status,
        "provider": provider,
        "remote_id": None,
        "started": None,
        "finished": None,
        "cost": None,
        "output_path": None,
        "sha256": None,
        "attempts": 0,
        "error": None,
    }


def request_hash(asset: dict, step_name: str, upstream: list[str]) -> str:
    sp = style_prompt()
    body = {
        "step": step_name,
        "provider": asset["steps"][step_name].get("provider"),
        "prompt": asset["prompt"],
        "params": asset.get("params", {}),
        "style_version": asset.get("style_version"),
        "style_json_version": sp.get("style_version"),
        "style_text": [sp.get("suffix"), sp.get("negative"), sp.get("mesh_suffix")],
        "upstream": upstream,
        "refs": [sha256_file(abspath(r)) for r in asset.get("refs", []) if abspath(r).exists()],
    }
    return sha256_bytes(canon(body).encode("utf-8"))


# -------------------------------------------------------------------- ledger
def ledger_append(entry: dict) -> None:
    entry = {"ts": now_iso(), **entry}
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with open(LEDGER, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def ledger_entries() -> list[dict]:
    out = []
    if LEDGER.exists():
        for line in LEDGER.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def spent_by_provider() -> dict:
    """Sum USD per provider. For one (asset, step, attempt) the LAST ledger line wins,
    so a 'settled' line (actual) replaces the 'submit' line (estimate)."""
    last = {}
    for e in ledger_entries():
        if "usd" not in e:
            continue
        last[(e.get("provider"), e.get("asset"), e.get("step"), e.get("attempt"))] = e
    totals: dict = {}
    for (prov, *_), e in last.items():
        totals[prov] = totals.get(prov, 0.0) + float(e["usd"])
    return totals


class Budget:
    """Pre-flight budget gate. Refuses any job whose estimate would exceed a cap."""

    def __init__(self, max_usd: float | None):
        self.max_usd = max_usd
        self.run_spent = 0.0
        self.base = spent_by_provider()

    def provider_spent(self, provider: str) -> float:
        return self.base.get(provider, 0.0)

    def total_spent(self) -> float:
        return sum(self.base.values())

    def check(self, provider: str, est_usd: float) -> tuple[bool, str]:
        pc, tc = cap_usd(provider), total_cap_usd()
        if self.provider_spent(provider) + est_usd > pc + 1e-9:
            return False, f"{provider} cap ${pc:.2f} would be exceeded (spent ${self.provider_spent(provider):.4f} + est ${est_usd:.4f})"
        if self.total_spent() + est_usd > tc + 1e-9:
            return False, f"total cap ${tc:.2f} would be exceeded (spent ${self.total_spent():.4f} + est ${est_usd:.4f})"
        if self.max_usd is not None and self.run_spent + est_usd > self.max_usd + 1e-9:
            return False, f"--max-usd ${self.max_usd:.2f} for this run would be exceeded (run spent ${self.run_spent:.4f} + est ${est_usd:.4f})"
        return True, "ok"

    def commit(self, provider: str, est_usd: float) -> None:
        self.run_spent += est_usd
        self.base[provider] = self.base.get(provider, 0.0) + est_usd

    def settle(self, provider: str, est_usd: float, actual_usd: float) -> None:
        delta = actual_usd - est_usd
        self.run_spent += delta
        self.base[provider] = self.base.get(provider, 0.0) + delta


# ------------------------------------------------------------------- locking
class RunLock:
    def __enter__(self):
        RAW.mkdir(parents=True, exist_ok=True)
        if LOCK.exists():
            age = time.time() - LOCK.stat().st_mtime
            if age < 15 * 60:
                raise SystemExit(f"another gen.py run holds {rel(LOCK)} (age {int(age)}s). Refusing to run concurrently.")
        LOCK.write_text(f"{os.getpid()} {now_iso()}\n", encoding="utf-8")
        return self

    def __exit__(self, *exc):
        try:
            LOCK.unlink()
        except OSError:
            pass


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"WARN: {msg}", file=sys.stderr, flush=True)

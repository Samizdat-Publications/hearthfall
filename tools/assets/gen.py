#!/usr/bin/env python
"""Hearthfall asset pipeline driver (docs/ASSETS.md sections 3 and 4).

  python tools/assets/gen.py seed                       add missing v1 rows to assets.json (never overwrites)
  python tools/assets/gen.py plan [--class X]           dry run: pending steps and projected cost per provider
  python tools/assets/gen.py run --class X --max-usd N --max-minutes M [--only ID ...]
  python tools/assets/gen.py status                     one line per class
  python tools/assets/gen.py balance                    key presence and Meshy credit balance (free calls)

`run` returns within --max-minutes. In-flight remote jobs (Meshy) are saved by remote_id the moment they are
created and resumed by polling on the next call; they are never re-submitted. Every paid call is appended to
ledger.jsonl and checked against the BUDGET_* caps from .env before it is sent.
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log, warn  # noqa: E402
from providers import ProviderError  # noqa: E402

CLASSES = ["concept", "buildings", "props", "units", "sfx", "music", "voice", "vfx", "icons"]
POLL_SECONDS = 5
MIN_JOB_SECONDS = 45  # do not start a new job with less than this left in the run window


# ------------------------------------------------------------------ prompts
def concept_prompt(a: dict) -> str:
    sp = C.style_prompt()
    if a["class"] == "vfx":
        return (f"{a['prompt']}, {sp['vfx_suffix']}, flat-shaded faceted stylized game effect texture, crisp angular shapes matching a low-poly look, "
                "the glow fades to pure black well before every edge of the image, nothing touches the border, no text. "
                f"Avoid: {sp['negative']}, grey or colored background, frame, border.")
    if a["class"] == "icons":
        text = (f"{a['prompt']}. Square game UI icon: one bold readable emblem centered, with a clean silhouette, crisp flat-shaded facets, chunky shapes, "
                "warm golden-hour light, set on a plain solid pure magenta (#FF00FF) background with a margin around the emblem, no text, no letters, no numbers. "
                "Do not use magenta or pink anywhere on the emblem itself.")
        if a.get("refs") and sp.get("style_ref_note"):
            text += " " + sp["style_ref_note"]
        return text
    parts = [a["prompt"]]
    if a["class"] == "units":
        parts.append(sp["unit_pose"])
    if a["params"].get("kind") != "style_ref":
        parts.append(sp["concept_camera"])
    parts.append(sp["suffix"])
    text = ", ".join(parts) + f". Avoid: {sp['negative']}."
    if a.get("refs") and sp.get("style_ref_note"):
        text += " " + sp["style_ref_note"]
    return text


def mesh_text_prompt(a: dict) -> str:
    sp = C.style_prompt()
    return f"{a['prompt']}, {sp['mesh_suffix']}"[:800]


def audio_prompt(a: dict) -> str:
    sp = C.style_prompt()
    if a["class"] == "voice":
        return a["params"]["text"]
    tpl = sp["music_template"] if a["class"] == "music" else sp["sfx_template"]
    return tpl.format(subject=a["prompt"])


# --------------------------------------------------------------- cost model
def est_cost(a: dict, step: str):
    """(provider, usd, human description) for a paid step, or None for free local steps."""
    P = C.PRICING
    prov = a["steps"][step].get("provider")
    if prov == "gemini":
        return "gemini", P["gemini_image_usd"][a["params"].get("image_size", "1K")], "1 image"
    if prov == "meshy":
        if a["params"].get("route") == "text":
            key = "text_preview_t2"
        else:
            key = "image_textured_t2" if a["params"].get("textured") else "image_mesh_t2"
        cr = P["meshy_credits"][key]
        return "meshy", cr * P["meshy_usd_per_credit"], f"{cr} credits"
    if prov == "tripo":
        cr = P["tripo_credits"]["image_to_model_smart_low_poly"]
        return "tripo", cr * P["tripo_usd_per_credit"], f"{cr} credits"
    if prov == "elevenlabs":
        if a["class"] == "music":
            mins = a["params"].get("length_ms", 60000) / 60000
            return "elevenlabs", mins * P["elevenlabs_music_usd_per_minute"], f"{mins:.1f} min music"
        if a["class"] == "voice":
            n = len(a["params"]["text"])
            return "elevenlabs", n / 1000 * P["elevenlabs_tts_usd_per_1k_chars"], f"{n} chars tts"
        d = a["params"].get("duration_seconds", 1.0)
        return "elevenlabs", d * P["elevenlabs_sfx_usd_per_second"], f"{d}s sfx"
    return None


def deps_done(a: dict, step: str) -> bool:
    s = a["steps"]
    need = {"model": ["concept"], "post": ["model"], "thumb": ["post"], "rig": ["model"], "animate": ["rig"]}.get(step, [])
    return all(s[d]["status"] in ("done", "skipped") for d in need)


def ready(a: dict, step: str) -> bool:
    return a["steps"][step]["status"] == "pending" and deps_done(a, step)


def upstream_hashes(a: dict, step: str) -> list:
    dep = {"model": "concept", "post": "model", "thumb": "post"}.get(step)
    return [a["steps"][dep]["sha256"]] if dep and a["steps"][dep].get("sha256") else []


# --------------------------------------------------------------------- plan
def selected(m: dict, cls: str | None, only: list | None):
    for a in m["assets"]:
        if cls and a["class"] != cls:
            continue
        if only and a["id"] not in only:
            continue
        yield a


def cmd_seed(args) -> int:
    import seed

    m = C.load_manifest()
    have = {a["id"] for a in m["assets"]}
    added = 0
    for row in seed.v1_assets():
        if row["id"] not in have:
            row["style_version"] = m.get("style_version", 1)
            m["assets"].append(row)
            added += 1
    C.save_manifest(m)
    log(f"seeded {added} new rows, {len(m['assets'])} total -> {C.rel(C.MANIFEST)}")
    log("RESULT: ok")
    return 0


def cmd_plan(args) -> int:
    m = C.load_manifest()
    spent = C.spent_by_provider()
    per: dict = {}
    free = 0
    stale = 0
    blocked_note = []
    for a in selected(m, args.cls, args.only):
        for step in C.STEP_ORDER:
            st = a["steps"][step]
            if st["status"] == "done" and st.get("request_hash"):
                if C.request_hash(a, step, upstream_hashes(a, step)) != st["request_hash"]:
                    stale += 1
            if st["status"] not in ("pending", "submitted"):
                continue
            if st["status"] == "submitted":
                per.setdefault("(in flight, resume)", {"n": 0, "usd": 0.0})["n"] += 1
                continue
            ec = est_cost(a, step)
            if ec is None:
                free += 1
                continue
            prov, usd, _ = ec
            d = per.setdefault(prov, {"n": 0, "usd": 0.0})
            d["n"] += 1
            d["usd"] += usd
    log(f"PLAN{' class=' + args.cls if args.cls else ''} (dry run, no API calls)")
    tot = 0.0
    for prov in sorted(per):
        d = per[prov]
        if prov.startswith("("):
            log(f"  {prov}: {d['n']} job(s)")
            continue
        cap, sp = C.cap_usd(prov), spent.get(prov, 0.0)
        flag = "" if sp + d["usd"] <= cap + 1e-9 else "  OVER CAP, will stop at the cap"
        log(f"  {prov:11s} {d['n']:3d} step(s)  projected ${d['usd']:7.3f}  spent ${sp:7.3f}  cap ${cap:6.2f}{flag}")
        tot += d["usd"]
    log(f"  local free steps: {free}   stale (hash changed): {stale}")
    tc, ts = C.total_cap_usd(), sum(spent.values())
    log(f"  total projected ${tot:.3f}; total spent ${ts:.3f}; total cap ${tc:.2f}")
    log("RESULT: plan ok")
    return 0


def cmd_status(args) -> int:
    m = C.load_manifest()
    by: dict = {}
    for a in m["assets"]:
        d = by.setdefault(a["class"], {"assets": 0})
        d["assets"] += 1
        for step in C.STEP_ORDER:
            s = a["steps"][step]["status"]
            if s == "skipped":
                continue
            d[s] = d.get(s, 0) + 1
    for cls in CLASSES:
        if cls not in by:
            continue
        d = by[cls]
        extra = " ".join(f"{k}={v}" for k, v in sorted(d.items()) if k != "assets")
        log(f"{cls:10s} {d['assets']:3d} assets | steps: {extra}")
    sp = C.spent_by_provider()
    log("spent: " + ", ".join(f"{k} ${v:.3f}/{C.cap_usd(k):.0f}" for k, v in sorted(sp.items())) + f" | total ${sum(sp.values()):.3f}/{C.total_cap_usd():.0f}")
    log("RESULT: status ok")
    return 0


def cmd_repost(args) -> int:
    """Reset the local post and thumb steps (free) so the next `run --only` re-runs Blender normalize, QA and thumbs."""
    m = C.load_manifest()
    n = 0
    for a in selected(m, args.cls, args.only):
        if a["steps"]["model"]["status"] != "done":
            continue
        for step in ("post", "thumb"):
            st = a["steps"][step]
            if st["status"] != "skipped":
                st.update(status="pending", attempts=0, error=None)
        n += 1
    C.save_manifest(m)
    log(f"reset post and thumb for {n} asset(s); now run: gen.py run --only ...")
    log("RESULT: repost ok")
    return 0


def cmd_balance(args) -> int:
    for p in C.PROVIDERS:
        log(f"{p}: key {'present' if C.key_present(p) else 'missing'}")
    if C.key_present("meshy"):
        from providers import meshy

        try:
            b = meshy.balance()
            log("meshy balance response keys/values: " + ", ".join(f"{k}={v}" for k, v in b.items() if isinstance(v, (int, float))))
        except ProviderError as e:
            warn(str(e))
    log("RESULT: balance ok")
    return 0


# ---------------------------------------------------------------------- run
class Runner:
    def __init__(self, m, budget, deadline, args):
        self.m, self.budget, self.deadline, self.args = m, budget, deadline, args
        self.skip: set = set()  # (asset id, step) not retried again in this run
        self.n_paid = 0
        self.notes: list = []

    def remaining(self) -> float:
        return self.deadline - time.time()

    def save(self):
        C.save_manifest(self.m)

    def fail(self, a, step, err: str, retry_ok=True):
        st = a["steps"][step]
        st["error"] = err[:400]
        st["finished"] = C.now_iso()
        st["status"] = "pending" if (retry_ok and st["attempts"] < C.MAX_ATTEMPTS) else "needs_review"
        if st["status"] == "needs_review":
            self.notes.append(f"{a['id']}:{step} needs_review: {err[:120]}")
        self.skip.add((a["id"], step))
        self.save()
        warn(f"{a['id']}:{step} failed (attempt {st['attempts']}): {err[:200]}")

    def gate(self, a, step):
        ec = est_cost(a, step)
        if ec is None:
            return True, None
        prov, usd, desc = ec
        ok, why = self.budget.check(prov, usd)
        if not ok:
            self.notes.append(f"BLOCKED {a['id']}:{step}: {why}")
            self.skip.add((a["id"], step))
            warn(f"BLOCKED {a['id']}:{step}: {why}")
            return False, None
        return True, ec

    # -- sync providers -------------------------------------------------
    def do_gemini(self, a):
        from providers import gemini

        ok, ec = self.gate(a, "concept")
        if not ok:
            return
        prov, usd, _ = ec
        st = a["steps"]["concept"]
        st.update(status="submitted", started=C.now_iso(), attempts=st["attempts"] + 1, error=None)
        self.save()
        refs = []
        for r in a.get("refs", []):
            p = C.abspath(r)
            if p.exists():
                refs.append(("image/png" if p.suffix == ".png" else "image/jpeg", p.read_bytes()))
        prompt = concept_prompt(a)
        self.budget.commit(prov, usd)
        try:
            res = gemini.generate_image(prompt, aspect_ratio=a["params"].get("aspect_ratio", "1:1"),
                                        image_size=a["params"].get("image_size", "1K"), ref_images=refs)
        except ProviderError as e:
            self.budget.settle(prov, usd, 0.0)
            C.ledger_append({"provider": "gemini", "asset": a["id"], "step": "concept", "attempt": st["attempts"], "kind": "failed", "usd": 0.0, "note": e.message[:160]})
            self.fail(a, "concept", str(e))
            return
        ext = "png" if "png" in res["mime"] else "jpg"
        out = C.RAW / "gemini" / a["id"] / f"concept.{ext}"
        C.write_atomic_bytes(out, res["bytes"])
        sha = C.sha256_file(out)
        meta = {"endpoint": res["endpoint"], "mime": res["mime"], "bytes": len(res["bytes"])}
        if res.get("fallback_reason"):
            meta["fallback_reason"] = res["fallback_reason"]
        try:
            from PIL import Image

            with Image.open(out) as im:
                meta["size"] = list(im.size)
        except Exception:
            pass
        C.ledger_append({"provider": "gemini", "asset": a["id"], "step": "concept", "attempt": st["attempts"], "kind": "call",
                         "usd": usd, "units": 1, "unit": "image_1K", "endpoint": res["endpoint"], "usage": res.get("usage")})
        st.update(status="done", finished=C.now_iso(), cost={"usd": usd, "source": "computed"}, output_path=C.rel(out),
                  sha256=sha, meta=meta, request_hash=C.request_hash(a, "concept", []))
        self.n_paid += 1
        self.save()
        log(f"  gemini {a['id']} -> {C.rel(out)} ({meta.get('size')}, {meta['endpoint']}) ${usd:.4f}")

    def do_eleven(self, a):
        from providers import elevenlabs

        ok, ec = self.gate(a, "model")
        if not ok:
            return
        prov, usd, _ = ec
        st = a["steps"]["model"]
        st.update(status="submitted", started=C.now_iso(), attempts=st["attempts"] + 1, error=None)
        self.save()
        self.budget.commit(prov, usd)
        prompt = audio_prompt(a)
        try:
            if a["class"] == "voice":
                vid = (C.load_json(C.ASSETS_DIR / "voices.json", {}) or {}).get(a["params"]["voice_key"], {}).get("voice_id")
                if not vid:
                    raise ProviderError("elevenlabs", None, f"no designed voice '{a['params']['voice_key']}' in tools/assets/voices.json (run a3_voice.py design)")
                res = elevenlabs.tts(vid, prompt, model_id=a["params"].get("model_id", "eleven_v4"),
                                     output_format=a["params"].get("output_format", "mp3_44100_128"),
                                     voice_settings=a["params"].get("voice_settings"), seed=a["params"].get("seed"))
            elif a["class"] == "music":
                res = elevenlabs.music(prompt, length_ms=a["params"]["length_ms"], output_format=a["params"].get("output_format", "mp3_44100_128"))
            else:
                res = elevenlabs.sound_effect(prompt, duration_seconds=a["params"].get("duration_seconds"),
                                              prompt_influence=a["params"].get("prompt_influence", 0.3), loop=a["params"].get("loop", False),
                                              output_format=a["params"].get("output_format", "mp3_44100_128"))
        except ProviderError as e:
            self.budget.settle(prov, usd, 0.0)
            C.ledger_append({"provider": "elevenlabs", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "failed", "usd": 0.0, "note": e.message[:160]})
            plan_err = a["class"] == "music" and e.status in (401, 402, 403)
            self.fail(a, "model", str(e), retry_ok=not plan_err)
            if plan_err:
                self.notes.append("music endpoint refused (plan?). Skipped and logged per docs/ASSETS.md section 6.")
            return
        out = C.RAW / "elevenlabs" / a["id"] / f"{a['id']}.mp3"
        C.write_atomic_bytes(out, res["bytes"])
        sha = C.sha256_file(out)
        unit = {"music": "ms", "voice": "chars"}.get(a["class"], "seconds")
        units = {"music": a["params"].get("length_ms"), "voice": len(a["params"].get("text", ""))}.get(a["class"], a["params"].get("duration_seconds"))
        C.ledger_append({"provider": "elevenlabs", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "call",
                         "usd": usd, "units": units, "unit": unit, "headers": res["headers"]})
        st.update(status="done", finished=C.now_iso(), cost={"usd": usd, "source": "computed"}, output_path=C.rel(out), sha256=sha,
                  meta={"bytes": len(res["bytes"]), "content_type": res["content_type"], "headers": res["headers"]},
                  request_hash=C.request_hash(a, "model", []))
        self.n_paid += 1
        self.save()
        log(f"  elevenlabs {a['id']} -> {C.rel(out)} ({len(res['bytes'])} bytes) ${usd:.4f}")

    # -- async: meshy ----------------------------------------------------
    def submit_meshy(self, a):
        from providers import meshy

        ok, ec = self.gate(a, "model")
        if not ok:
            return
        prov, usd, _ = ec
        st = a["steps"]["model"]
        route = a["params"].get("route", "image")
        tris = a["params"].get("target_polycount", 800)
        st.update(status="submitted", started=C.now_iso(), attempts=st["attempts"] + 1, error=None)
        self.save()
        self.budget.commit(prov, usd)
        try:
            if route == "text":
                rid = meshy.create_text_to_3d_preview(mesh_text_prompt(a), target_polycount=tris)
            else:
                ip = C.abspath(a["steps"]["concept"]["output_path"])
                mime = "image/png" if ip.suffix.lower() == ".png" else "image/jpeg"
                uri = f"data:{mime};base64," + base64.b64encode(ip.read_bytes()).decode("ascii")
                rid = meshy.create_image_to_3d(uri, target_polycount=tris, textured=bool(a["params"].get("textured", False)))
        except ProviderError as e:
            self.budget.settle(prov, usd, 0.0)
            C.ledger_append({"provider": "meshy", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "failed", "usd": 0.0, "note": e.message[:160]})
            self.fail(a, "model", str(e))
            return
        # persist the remote id immediately (resume, never re-submit)
        st["remote_id"] = rid
        st["meta"] = {"route": route, "kind": "text" if route == "text" else "image"}
        C.ledger_append({"provider": "meshy", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "submit",
                         "usd": usd, "units": None, "unit": "credits_est", "remote_id": rid})
        self.save()
        self.n_paid += 1
        log(f"  meshy submitted {a['id']} remote_id={rid}")

    def poll_meshy(self, a) -> bool:
        """Poll once. Returns True if the step reached a terminal state."""
        from providers import meshy

        st = a["steps"]["model"]
        kind = st.get("meta", {}).get("kind", "text")
        try:
            t = meshy.get_task(kind, st["remote_id"])
        except ProviderError as e:
            warn(f"poll {a['id']}: {e}")
            return False
        status = t.get("status")
        if status not in meshy.TERMINAL:
            st["meta"]["progress"] = t.get("progress")
            return False
        prov_usd = C.PRICING["meshy_usd_per_credit"]
        est = est_cost(a, "model")[1]
        if status != "SUCCEEDED":
            self.budget.settle("meshy", est, 0.0)
            C.ledger_append({"provider": "meshy", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "settled",
                             "usd": 0.0, "units": meshy.credits(t), "unit": "credits", "remote_id": st["remote_id"], "note": status})
            st["remote_id"] = None
            self.fail(a, "model", f"meshy task {status}: {str(t.get('task_error'))[:200]}")
            return True
        url = meshy.glb_url(t)
        if not url:
            self.fail(a, "model", f"SUCCEEDED but no glb in model_urls (keys {sorted((t.get('model_urls') or {}))})")
            return True
        data = meshy.download(url)
        out = C.RAW / "meshy" / a["id"] / "model.glb"
        C.write_atomic_bytes(out, data)
        cr = meshy.credits(t)
        usd = cr * prov_usd
        self.budget.settle("meshy", est, usd)
        C.ledger_append({"provider": "meshy", "asset": a["id"], "step": "model", "attempt": st["attempts"], "kind": "settled",
                         "usd": usd, "units": cr, "unit": "credits", "remote_id": st["remote_id"]})
        st.update(status="done", finished=C.now_iso(), cost={"credits": cr, "usd": usd, "source": "consumed_credits"},
                  output_path=C.rel(out), sha256=C.sha256_file(out),
                  request_hash=C.request_hash(a, "model", upstream_hashes(a, "model")))
        st["meta"].update(bytes=len(data), progress=100)
        self.save()
        log(f"  meshy done {a['id']} -> {C.rel(out)} ({len(data)} bytes, {cr} credits)")
        return True

    # -- local -----------------------------------------------------------
    def do_post(self, a):
        st = a["steps"]["post"]
        st.update(status="submitted", started=C.now_iso(), attempts=st["attempts"] + 1, error=None)
        self.save()
        try:
            if a["class"] in ("sfx", "music", "voice"):
                import audio_post

                res = audio_post.post_asset(a)
            elif a["class"] in ("vfx", "icons"):
                import keying

                res = keying.post_asset(a)
            else:
                import blender_run

                res = blender_run.normalize_asset(a)
        except Exception as e:  # noqa: BLE001
            self.fail(a, "post", f"{type(e).__name__}: {e}")
            return
        if res.get("status") == "stub":
            st.update(status="skipped", finished=C.now_iso(), error=None, meta=res)
            self.notes.append(f"{a['id']}:post stubbed: {res.get('message')}")
            self.save()
            return
        st.update(status="done", finished=C.now_iso(), output_path=res["output_path"], sha256=C.sha256_file(C.abspath(res["output_path"])),
                  meta={k: v for k, v in res.items() if k not in ("output_path",)}, request_hash=C.request_hash(a, "post", upstream_hashes(a, "post")))
        self.save()
        log(f"  post {a['id']} -> {res['output_path']}")
        if a["class"] not in ("sfx", "music", "voice", "vfx", "icons"):
            try:
                import qa

                qa.qa_asset(a)
                self.save()
            except Exception as e:  # noqa: BLE001
                warn(f"qa {a['id']}: {type(e).__name__}: {e}")

    def do_thumbs(self, assets):
        import blender_run

        try:
            blender_run.thumbs_for(assets, self.m)
        except Exception as e:  # noqa: BLE001
            warn(f"thumbs failed: {type(e).__name__}: {e}")
            for a in assets:
                a["steps"]["thumb"]["error"] = f"{type(e).__name__}: {e}"[:300]
        self.save()

    # -- main loop -------------------------------------------------------
    def run(self, assets):
        while True:
            progressed = False
            # 1. poll in-flight meshy jobs (resume by remote_id)
            inflight = [a for a in assets if a["steps"]["model"]["status"] == "submitted" and a["steps"]["model"].get("remote_id")]
            for a in inflight:
                if self.poll_meshy(a):
                    progressed = True
            # a model step stuck in 'submitted' with no remote id (crash between mark and POST) cannot be resumed safely
            for a in assets:
                st = a["steps"]["model"]
                if st["status"] == "submitted" and not st.get("remote_id") and a["steps"]["model"]["provider"] == "meshy":
                    st["status"] = "pending"
                    st["error"] = "reconciled: submit interrupted before remote_id was saved (possible duplicate charge, bounded by caps)"
                    self.notes.append(f"{a['id']}: model step reset after interrupted submit")
            # 2. submit / run ready steps
            max_inflight = 5
            n_inflight = sum(1 for a in assets if a["steps"]["model"]["status"] == "submitted" and a["steps"]["model"].get("remote_id"))
            for a in assets:
                if self.remaining() < MIN_JOB_SECONDS:
                    break
                if ready(a, "concept") and (a["id"], "concept") not in self.skip:
                    self.do_gemini(a)
                    progressed = True
                if ready(a, "model") and (a["id"], "model") not in self.skip:
                    if a["steps"]["model"]["provider"] == "elevenlabs":
                        self.do_eleven(a)
                        progressed = True
                    elif a["steps"]["model"]["provider"] == "meshy" and n_inflight < max_inflight:
                        self.submit_meshy(a)
                        n_inflight += 1
                        progressed = True
                    elif a["steps"]["model"]["provider"] == "tripo":
                        self.notes.append(f"{a['id']}: tripo steps are driven by the A1 bake-off, skipped")
                        self.skip.add((a["id"], "model"))
                if ready(a, "post") and (a["id"], "post") not in self.skip:
                    self.do_post(a)
                    progressed = True
            # 3. loop control
            n_inflight = sum(1 for a in assets if a["steps"]["model"]["status"] == "submitted" and a["steps"]["model"].get("remote_id"))
            pending_ready = any(ready(a, s) and (a["id"], s) not in self.skip for a in assets for s in ("concept", "model", "post"))
            if self.remaining() < MIN_JOB_SECONDS and not n_inflight:
                break
            if not n_inflight and not pending_ready:
                break
            if self.remaining() <= 0:
                break
            if n_inflight and not progressed:
                time.sleep(min(POLL_SECONDS, max(0.0, self.remaining())))
        # thumbs: one Blender process for everything that is ready
        th = [a for a in assets if ready(a, "thumb")]
        if th:
            self.do_thumbs(th)


def cmd_run(args) -> int:
    if not args.cls and not args.only:
        log("run needs --class or --only")
        return 2
    m = C.load_manifest()
    assets = list(selected(m, args.cls, args.only))
    if not assets:
        log("no matching assets")
        return 2
    deadline = time.time() + args.max_minutes * 60
    budget = C.Budget(args.max_usd)
    with C.RunLock():
        r = Runner(m, budget, deadline, args)
        log(f"RUN class={args.cls} only={args.only} max_usd={args.max_usd} max_minutes={args.max_minutes}")
        try:
            r.run(assets)
        except KeyboardInterrupt:
            warn("interrupted; state saved")
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        r.save()
    inflight = sum(1 for a in assets if a["steps"]["model"]["status"] == "submitted")
    log(f"run spent ~${budget.run_spent:.4f}; paid calls {r.n_paid}; still in flight {inflight} (resume with the same command)")
    for n in r.notes:
        log(f"  note: {n}")
    log(f"RESULT: run {'partial (in flight)' if inflight else 'ok'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed")
    sub.add_parser("status")
    sub.add_parser("balance")
    rp = sub.add_parser("repost")
    rp.add_argument("--class", dest="cls", choices=CLASSES)
    rp.add_argument("--only", nargs="*")
    p = sub.add_parser("plan")
    p.add_argument("--class", dest="cls", choices=CLASSES)
    p.add_argument("--only", nargs="*")
    r = sub.add_parser("run")
    r.add_argument("--class", dest="cls", choices=CLASSES)
    r.add_argument("--only", nargs="*")
    r.add_argument("--max-usd", type=float, default=None, help="spend cap for this invocation (also bounded by BUDGET_* in .env)")
    r.add_argument("--max-minutes", type=float, default=8.0)
    args = ap.parse_args()
    return {"seed": cmd_seed, "plan": cmd_plan, "run": cmd_run, "status": cmd_status, "balance": cmd_balance, "repost": cmd_repost}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python
"""Re-generate one asset with a new prompt, keep the old version, compare them (BACKLOG 26, docs/ASSETS.md).

  python tools/assets/regen.py prepare --id building.hearth --prompt "..." [--from concept|model]
      archives the asset's current outputs and manifest row under tools/assets/raw/history/<id>/<stamp>/,
      sets the new prompt and resets the steps from --from on (default: the first step that is not skipped)
      to pending, unapproves it and prints the projected cost. Free: nothing is sent anywhere.
  python tools/assets/gen.py run --only <id> --max-usd N
      the normal pipeline generates the new version (paid, budget caps apply)
  python tools/assets/regen.py sheet --id building.hearth
      before and after sheet (concept and thumbnail, prompts) -> reports/latest/regen_<id>.png
  python tools/assets/regen.py restore --id building.hearth
      puts the archived files and manifest row back (the newest archive; the new outputs are archived first)
  python tools/assets/regen.py selftest
      runs prepare, sheet and restore on a temporary copy of one asset (no network, no manifest change)
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log, warn  # noqa: E402

HISTORY = C.RAW / "history"


def find(m: dict, aid: str) -> dict:
    for a in m["assets"]:
        if a["id"] == aid:
            return a
    raise SystemExit(f"no asset {aid} in the manifest")


def stamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())


def archive(a: dict, root: pathlib.Path, hist: pathlib.Path, reason: str) -> pathlib.Path:
    """Copy every step output that exists and the manifest row into hist/<id>/<stamp>/."""
    d = hist / a["id"] / stamp()
    k = 0
    while d.exists():
        k += 1
        d = hist / a["id"] / f"{stamp()}-{k}"
    d.mkdir(parents=True)
    files = {}
    for name, st in a["steps"].items():
        p = st.get("output_path")
        if not p or not (root / p).exists():
            continue
        dst = d / f"{name}{pathlib.Path(p).suffix}"
        shutil.copy2(root / p, dst)
        files[name] = {"from": p, "file": dst.name}
    meta = {"when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reason": reason, "row": copy.deepcopy(a), "files": files}
    (d / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return d


def prepare(m: dict, aid: str, prompt: str, start: str | None, root: pathlib.Path, hist: pathlib.Path) -> dict:
    a = find(m, aid)
    order = [s for s in C.STEP_ORDER if a["steps"].get(s, {}).get("status") != "skipped"]
    if not order:
        raise SystemExit(f"{aid} has no steps to run")
    start = start or order[0]
    if start not in order:
        raise SystemExit(f"--from {start} is not a step of {aid} (steps: {', '.join(order)})")
    d = archive(a, root, hist, f"before regen from {start}")
    old = a["prompt"]
    a["prompt"] = prompt
    for s in order[order.index(start):]:
        st = a["steps"][s]
        st.update(status="pending", attempts=0, error=None, remote_id=None, started=None, finished=None, cost=None, sha256=None)
    a["approved"] = False
    a.setdefault("history", []).append({"when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "archive": d.relative_to(root).as_posix(), "oldPrompt": old, "from": start})
    return {"archive": d, "reset": order[order.index(start):]}


def latest_archive(aid: str, hist: pathlib.Path) -> pathlib.Path | None:
    base = hist / aid
    if not base.exists():
        return None
    dirs = sorted(p for p in base.iterdir() if (p / "meta.json").exists())
    return dirs[-1] if dirs else None


def restore(m: dict, aid: str, root: pathlib.Path, hist: pathlib.Path) -> pathlib.Path:
    a = find(m, aid)
    d = latest_archive(aid, hist)
    if d is None:
        raise SystemExit(f"no archive for {aid}")
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    archive(a, root, hist, f"before restore of {d.name}")
    for info in meta["files"].values():
        dst = root / info["from"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(d / info["file"], dst)
    row = meta["row"]
    row["history"] = a.get("history", []) + [{"when": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "restored": d.relative_to(root).as_posix()}]
    m["assets"][m["assets"].index(a)] = row
    return d


def sheet(m: dict, aid: str, root: pathlib.Path, hist: pathlib.Path, out: pathlib.Path) -> pathlib.Path:
    """Before (newest archive) and after (current outputs) side by side: concept and thumbnail images, prompts below."""
    from PIL import Image, ImageDraw, ImageFont

    a = find(m, aid)
    d = latest_archive(aid, hist)
    if d is None:
        raise SystemExit(f"no archive for {aid}: run prepare first")
    meta = json.loads((d / "meta.json").read_text(encoding="utf-8"))
    kinds = [k for k in ("concept", "thumb") if k in meta["files"] or (a["steps"].get(k, {}).get("output_path") and (root / a["steps"][k]["output_path"]).exists())]
    cell, pad, head, foot = 320, 10, 26, 120
    font = ImageFont.load_default(size=14)
    w = 2 * cell + 3 * pad
    h = head + max(1, len(kinds)) * (cell + pad) + foot
    im = Image.new("RGB", (w, h), (46, 43, 40))
    dr = ImageDraw.Draw(im)
    dr.text((pad, 6), f"{aid}: before ({d.name})", fill=(240, 235, 225), font=font)
    dr.text((2 * pad + cell, 6), "after (current)", fill=(240, 235, 225), font=font)

    def tile(src: pathlib.Path | None, x: int, y: int, label: str) -> None:
        box = Image.new("RGB", (cell, cell), (158, 153, 143))
        if src is not None and src.exists() and src.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            with Image.open(src) as t:
                t = t.convert("RGB")
                t.thumbnail((cell, cell))
                box.paste(t, ((cell - t.width) // 2, (cell - t.height) // 2))
        else:
            ImageDraw.Draw(box).text((10, cell // 2), "not an image" if src is not None and src.exists() else "missing", fill=(40, 40, 40), font=font)
        im.paste(box, (x, y))
        dr.text((x + 4, y + 4), label, fill=(255, 255, 255), font=font)

    for i, k in enumerate(kinds):
        y = head + i * (cell + pad)
        before = d / meta["files"][k]["file"] if k in meta["files"] else None
        cur = a["steps"].get(k, {}).get("output_path")
        tile(before, pad, y, k)
        tile(root / cur if cur and a["steps"][k].get("status") == "done" else None, 2 * pad + cell, y, k)

    def wrap(s: str, n: int = 44) -> list[str]:
        words, lines, line = s.split(), [], ""
        for wd in words:
            if len(line) + len(wd) + 1 > n:
                lines.append(line)
                line = wd
            else:
                line = (line + " " + wd).strip()
        return lines + ([line] if line else [])

    y0 = head + max(1, len(kinds)) * (cell + pad)
    for col, text in ((pad, meta["row"]["prompt"]), (2 * pad + cell, a["prompt"])):
        for j, ln in enumerate(wrap(text)[:7]):
            dr.text((col, y0 + j * 16), ln, fill=(200, 196, 186), font=font)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out)
    return out


def cmd_prepare(args) -> int:
    m = C.load_manifest()
    r = prepare(m, args.id, args.prompt, args.start, C.ROOT, HISTORY)
    C.save_manifest(m)
    a = find(m, args.id)
    import gen  # noqa: E402

    est = 0.0
    for s in r["reset"]:
        c = gen.est_cost(a, s)
        est += c[1] if c else 0.0
    log(f"archived the old version to {C.rel(r['archive'])}; reset {', '.join(r['reset'])}; projected cost about ${est:.2f}")
    log(f"next: python tools/assets/gen.py run --only {args.id} --max-usd {max(0.5, round(est * 1.5, 2))}, then regen.py sheet --id {args.id}")
    log("RESULT: prepare ok")
    return 0


def cmd_sheet(args) -> int:
    m = C.load_manifest()
    out = sheet(m, args.id, C.ROOT, HISTORY, C.REPORTS / f"regen_{args.id}.png")
    log(f"sheet -> {C.rel(out)}")
    log("RESULT: sheet ok")
    return 0


def cmd_restore(args) -> int:
    m = C.load_manifest()
    d = restore(m, args.id, C.ROOT, HISTORY)
    C.save_manifest(m)
    log(f"restored {args.id} from {C.rel(d)} (the replaced version was archived too)")
    log("RESULT: restore ok")
    return 0


def cmd_selftest(_args) -> int:
    """prepare, sheet and restore on a temporary copy of the first asset with a done thumbnail."""
    m = copy.deepcopy(C.load_manifest())
    a = next(x for x in m["assets"] if x["steps"].get("thumb", {}).get("status") == "done" and x["steps"]["thumb"].get("output_path"))
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        for st in a["steps"].values():
            p = st.get("output_path")
            if p and (C.ROOT / p).exists():
                (root / p).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(C.ROOT / p, root / p)
        hist = root / "history"
        old_prompt = a["prompt"]
        old_steps = copy.deepcopy(a["steps"])
        r = prepare(m, a["id"], "selftest prompt", None, root, hist)
        b = find(m, a["id"])
        assert b["prompt"] == "selftest prompt" and b["approved"] is False, "prompt not set"
        assert all(b["steps"][s]["status"] == "pending" for s in r["reset"]), "steps not reset"
        assert (r["archive"] / "meta.json").exists() and any(r["archive"].glob("thumb.*")), "archive incomplete"
        # a fake new thumbnail stands in for the paid run
        from PIL import Image

        thumb = root / b["steps"]["thumb"]["output_path"]
        Image.new("RGB", (64, 64), (200, 40, 40)).save(thumb)
        b["steps"]["thumb"]["status"] = "done"
        out = sheet(m, a["id"], root, hist, root / "sheet.png")
        assert out.exists() and Image.open(out).size[0] > 600, "sheet missing"
        time.sleep(1.1)
        restore(m, a["id"], root, hist)
        c = find(m, a["id"])
        assert c["prompt"] == old_prompt and c["steps"] == old_steps, "row not restored"
        assert (root / c["steps"]["thumb"]["output_path"]).read_bytes() == (C.ROOT / c["steps"]["thumb"]["output_path"]).read_bytes(), "file not restored"
        assert len(list((hist / a["id"]).iterdir())) == 2, "restore did not archive the replaced version"
    log(f"selftest on {a['id']}: prepare, sheet, restore ok")
    log("RESULT: selftest ok")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--id", required=True)
    p.add_argument("--prompt", required=True)
    p.add_argument("--from", dest="start", choices=C.STEP_ORDER, default=None)
    for name in ("sheet", "restore"):
        s = sub.add_parser(name)
        s.add_argument("--id", required=True)
    sub.add_parser("selftest")
    args = ap.parse_args()
    return {"prepare": cmd_prepare, "sheet": cmd_sheet, "restore": cmd_restore, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())

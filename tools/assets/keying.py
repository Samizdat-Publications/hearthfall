#!/usr/bin/env python
"""Local image post for A3: VFX black-key, icon chroma-key, and transparent building/unit icons.

  vfx   (docs/ASSETS.md section 1): Gemini renders a glow on pure black. alpha = max(r, g, b) after a small black-level
        crush, rgb un-premultiplied, border tapered to zero. `rgb * alpha` reproduces the source, so the PNG works with
        additive blending (black adds nothing) and with normal alpha blending. 1024 px, saved as assets/vfx/<id>.png.
  icons Gemini renders an emblem on solid magenta (#FF00FF). Border-connected magenta is removed (flood fill), the edge band
        is feathered and de-spilled, the emblem is cropped to a square with a small margin and saved at 256 and 128 px as
        assets/icons/<id>.png and <id>_128.png.
  thumbs  python tools/assets/keying.py thumbs   copies the Blender thumbnails (flat grey background) as transparent
        icon.building.* / icon.unit.* files at 256 and 128 px.

No API calls, no cost.
"""
from __future__ import annotations

import os
import sys

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common as C  # noqa: E402
from common import log  # noqa: E402


# ------------------------------------------------------------------- vfx
def key_black(img: Image.Image, floor: int = 10, taper_frac: float = 0.04):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    m = a.max(axis=2)
    alpha = np.clip((m - floor) / (255.0 - floor), 0.0, 1.0)
    # un-premultiply: color = source / (m/255) so the brightest channel is full scale
    scale = 255.0 / np.maximum(m, 1.0)
    rgb = np.clip(a * scale[..., None], 0, 255)
    rgb[alpha <= 1e-4] = 0
    h, w = alpha.shape
    t = max(2, int(min(h, w) * taper_frac))
    ramp_x = np.minimum(np.arange(w), np.arange(w)[::-1]).astype(np.float32)
    ramp_y = np.minimum(np.arange(h), np.arange(h)[::-1]).astype(np.float32)
    win = np.clip(np.minimum(ramp_y[:, None], ramp_x[None, :]) / t, 0, 1)
    alpha = alpha * win
    out = np.dstack([rgb, alpha * 255.0]).clip(0, 255).astype(np.uint8)
    stats = {
        "border_luma": float(np.mean(np.concatenate([m[0], m[-1], m[:, 0], m[:, -1]]))),
        "opaque_frac": float((alpha > 0.5).mean()),
        "mean_alpha": float(alpha.mean()),
    }
    return Image.fromarray(out), stats


# ----------------------------------------------------------------- icons
def _border_flood(mask: np.ndarray) -> np.ndarray:
    """True where mask is set AND connected (4-neighbour) to the image border."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not seen[y, x]:
                seen[y, x] = True
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    return seen


def _flood_scipy(mask: np.ndarray) -> np.ndarray:
    try:
        from scipy import ndimage

        lab, _ = ndimage.label(mask)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
        return np.isin(lab, list(border)) if border else np.zeros_like(mask)
    except Exception:
        return _border_flood(mask)


def key_magenta(img: Image.Image):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spill = np.minimum(r, b) - g  # large for magenta-ish pixels
    core = (spill > 90) & (r > 140) & (b > 140)
    flood = _flood_scipy(core)
    # enclosed pockets of strong magenta (between figures, inside a horn) are background too; stricter threshold so emblem pinks survive
    pockets = (spill > 100) & (r > 160) & (b > 160)
    bg = flood | pockets
    # feather band: pixels within ~3 px of the removed background
    bgimg = Image.fromarray((bg * 255).astype(np.uint8))
    near = np.asarray(bgimg.filter(ImageFilter.MaxFilter(7))) > 0
    band = near & ~bg
    alpha = np.ones_like(r)
    alpha[bg] = 0.0
    soft = 1.0 - np.clip((spill - 30.0) / 110.0, 0.0, 1.0)
    alpha[band] = soft[band]
    # despill in the band only: pull red and blue down toward green
    s = np.clip(spill, 0, None)
    r2, b2 = r.copy(), b.copy()
    r2[band] = r[band] - s[band] * 0.85
    b2[band] = b[band] - s[band] * 0.85
    out = np.dstack([np.clip(r2, 0, 255), g, np.clip(b2, 0, 255), alpha * 255.0]).astype(np.uint8)
    # a thin remaining pink halo: anything in the band that is still strongly magenta becomes transparent
    stats = {"bg_frac": float(bg.mean()), "band_frac": float(band.mean()), "pocket_frac": float((pockets & ~flood).mean())}
    return Image.fromarray(out), stats


def crop_square(im: Image.Image, margin: float = 0.07) -> Image.Image:
    al = np.asarray(im)[..., 3]
    ys, xs = np.where(al > 24)
    if len(xs) == 0:
        return im
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * margin))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im.crop((x0, y0, x1, y1)), (side // 2 - (x1 - x0) // 2, side // 2 - (y1 - y0) // 2))
    return sq


def save_icon_pair(im: Image.Image, stem: str):
    out = []
    for size, suffix in ((256, ""), (128, "_128")):
        p = C.OUT / "icons" / f"{stem}{suffix}.png"
        p.parent.mkdir(parents=True, exist_ok=True)
        im.resize((size, size), Image.LANCZOS).save(p)
        out.append(C.rel(p))
    return out


# --------------------------------------------------------- manifest hooks
def post_asset(a: dict) -> dict:
    src = C.abspath(a["steps"]["concept"]["output_path"])
    im = Image.open(src)
    if a["class"] == "vfx":
        keyed, stats = key_black(im)
        dst = C.OUT / "vfx" / f"{a['id']}.png"
        dst.parent.mkdir(parents=True, exist_ok=True)
        keyed.save(dst)
        warn = []
        if stats["border_luma"] > 24:
            warn.append(f"border not black (mean {stats['border_luma']:.0f})")
        if stats["opaque_frac"] > 0.6:
            warn.append(f"mostly opaque ({stats['opaque_frac']:.2f}), probably a filled background")
        if stats["mean_alpha"] < 0.02:
            warn.append("almost empty")
        return {"output_path": C.rel(dst), "size": list(keyed.size), "blend": "additive", "warnings": warn, **stats}
    keyed, stats = key_magenta(im)
    sq = crop_square(keyed)
    files = save_icon_pair(sq, a["id"])
    warn = []
    if stats["bg_frac"] < 0.15:
        warn.append("little magenta background removed, check key")
    return {"output_path": files[0], "output_128": files[1], "size": [256, 256], "warnings": warn, **stats}


# ---------------------------------------------------------------- thumbs
def key_flat_grey(im: Image.Image, tol: int = 16):
    a = np.asarray(im.convert("RGB"), dtype=np.int16)
    corners = np.array([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]])
    ref = np.median(corners, axis=0)
    dist = np.abs(a - ref).max(axis=2)
    bg = _flood_scipy(dist <= tol)
    bgimg = Image.fromarray((bg * 255).astype(np.uint8))
    near = np.asarray(bgimg.filter(ImageFilter.MaxFilter(5))) > 0
    band = near & ~bg
    alpha = np.ones(dist.shape, dtype=np.float32)
    alpha[bg] = 0.0
    alpha[band] = np.clip((dist[band] - tol) / 24.0, 0.25, 1.0)
    out = np.dstack([a.clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    return Image.fromarray(out), float(bg.mean())


def cmd_thumbs() -> int:
    n = 0
    items = []
    m = C.load_manifest()
    for a in m["assets"]:
        if a["class"] == "buildings" or (a["class"] == "units" and ".bakeoff" not in a["id"]):
            items.append(a["id"])
    for aid in items:
        src = C.OUT / "icons" / f"{aid}.png"
        if not src.exists():
            log(f"  skip {aid}: no thumbnail")
            continue
        keyed, frac = key_flat_grey(Image.open(src))
        keyed = crop_square(keyed, 0.06)
        stem = "icon." + aid
        files = save_icon_pair(keyed, stem)
        n += 1
        log(f"  {aid} -> {files[0]} (bg removed {frac:.2f})")
    log(f"RESULT: keying thumbs {n} icon pair(s)")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "thumbs":
        sys.exit(cmd_thumbs())
    print(__doc__)

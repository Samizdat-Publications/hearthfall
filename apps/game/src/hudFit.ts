// BACKLOG 8: the HUD scale setting is a wish. On a window too small for it the panels would overlap,
// so the HUD (not the menus) steps down in 5 percent steps until every panel fits and none overlap.

/** Largest scale from `wanted` down to `floor` (5 percent steps) at which `fits(scale)` holds; `floor` if none. */
export function fitScale(wanted: number, fits: (scale: number) => boolean, floor = 0.5): number {
  for (let z = wanted; z > floor + 1e-9; z = Math.round((z - 0.05) * 100) / 100) if (fits(z)) return z;
  return floor;
}

/** True when the visible HUD panels under `root` stay on screen and do not overlap each other. */
export function hudFits(root: HTMLElement): boolean {
  const W = innerWidth;
  const H = innerHeight;
  const rs = [...root.querySelectorAll<HTMLElement>(".hud-panel")].filter((e) => e.getClientRects().length > 0).map((e) => e.getBoundingClientRect());
  for (let a = 0; a < rs.length; a++) {
    const A = rs[a];
    if (A.left < 0 || A.top < 0 || A.right > W || A.bottom > H) return false;
    for (let b = a + 1; b < rs.length; b++) {
      const B = rs[b];
      if (Math.min(A.right, B.right) - Math.max(A.left, B.left) > -4 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > -4) return false;
    }
  }
  return true;
}

/** Applies the largest HUD scale up to `wanted` that fits (CSS variable --hud-scale on root) and returns it. */
export function fitHud(root: HTMLElement, wanted: number): number {
  return fitScale(wanted, (z) => {
    root.style.setProperty("--hud-scale", String(z));
    return hudFits(root);
  });
}

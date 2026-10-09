// BACKLOG 4: formations for group move orders. A move command with `formation: "box"` or `"line"` gives
// each unit its own slot around the goal, facing the direction of travel: melee troops in front, settlers
// and Shades in the middle, Firecallers and Chanters behind, the Shaper at the back. Slots are assigned
// row by row, and inside a row by each unit's sideways position, so paths do not cross. Deterministic:
// only allowlisted Math and wrapped deltas.
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

export const FORMATIONS = ["box", "line"] as const;
export type FormationShape = (typeof FORMATIONS)[number];

/** front-to-back rank of a unit type: 0 melee troops, 1 settlers and others, 2 ranged and chanters, 3 the caster */
export function formationRank(w: World, type: number): number {
  const u = w.cfg.pack.units.units[type];
  if (u.isCaster) return 3;
  if (u.ranged || u.convert) return 2;
  if (u.melee && u.trainedAt) return 0;
  return 1;
}

/**
 * Slot positions (unwrapped; the caller wraps them) for the units `idx` ordered to (gx, gy), in the same
 * order as `idx`. Box: rows about twice as wide as deep; line: one row.
 */
export function formationSlots(w: World, idx: readonly number[], gx: number, gy: number, shape: FormationShape, spacing: number): [number, number][] {
  const E = w.ents;
  const n = w.terrain.size;
  const k = idx.length;
  // group center (wrapped mean around the first unit) and the facing from it to the goal
  let cx = 0;
  let cy = 0;
  for (const i of idx) {
    cx += wrapDelta(E.x[i] - E.x[idx[0]], n);
    cy += wrapDelta(E.y[i] - E.y[idx[0]], n);
  }
  cx = E.x[idx[0]] + cx / k;
  cy = E.y[idx[0]] + cy / k;
  let fx = wrapDelta(gx - cx, n);
  let fy = wrapDelta(gy - cy, n);
  const fl = Math.sqrt(fx * fx + fy * fy);
  if (fl < 1e-6) {
    fx = 0;
    fy = 1;
  } else {
    fx /= fl;
    fy /= fl;
  }
  // lateral axis (to the right of the facing)
  const lx = -fy;
  const ly = fx;
  const cols = shape === "line" ? k : Math.min(k, Math.ceil(Math.sqrt(k * 2)));
  const rows = Math.ceil(k / cols);
  // units by rank, then entity order (stable)
  const order = idx.map((i, j) => j).sort((a, b) => formationRank(w, E.type[idx[a]]) - formationRank(w, E.type[idx[b]]) || idx[a] - idx[b]);
  const out: [number, number][] = new Array(k);
  for (let r = 0; r < rows; r++) {
    const row = order.slice(r * cols, (r + 1) * cols);
    // inside a row, left to right by current sideways position
    const side = (j: number) => wrapDelta(E.x[idx[j]] - cx, n) * lx + wrapDelta(E.y[idx[j]] - cy, n) * ly;
    row.sort((a, b) => side(a) - side(b) || idx[a] - idx[b]);
    const back = (r - (rows - 1) / 2) * spacing;
    for (let c = 0; c < row.length; c++) {
      const lat = (c - (row.length - 1) / 2) * spacing;
      out[row[c]] = [gx + lx * lat - fx * back, gy + ly * lat - fy * back];
    }
  }
  return out;
}

// Counter triangle matchup (docs/TESTING.md section 5, fixed definition): flat 64x64 map, two groups
// of 10 placed 20 cells apart, both attack-move at each other, no spells, no Shapers; the side with
// survivors at 90 s wins (both alive is a draw). Used by unit tests and `soak --mode triangle`.
import type { PackFiles } from "@hearthfall/data";
import { CAT } from "./entities.ts";
import { Rng } from "./rng.ts";
import { ORDER } from "./units.ts";
import { World } from "./world.ts";

export interface MatchupResult {
  a: string;
  b: string;
  seed: number;
  /** "a", "b" or "draw" */
  winner: string;
  survivorsA: number;
  survivorsB: number;
  /** tick the losing side ran out of units (-1 when it did not) */
  endTick: number;
  converted: number;
  killed: number;
}

export interface MatchupOptions {
  size?: number;
  /** units per side (side b uses perSideB when given) */
  perSide?: number;
  perSideB?: number;
  apart?: number;
  seconds?: number;
  /** formation jitter in cells (default 0.4, the fixed definition) */
  jitter?: number;
}

/**
 * a and b name one unit type each, or a mixed army as "warden+firecaller+chanter" (types cycle over
 * the formation slots). BACKLOG 60 variance probes use uneven counts and wider jitter; the fixed
 * triangle definition is the default options.
 */
export function runMatchup(pack: PackFiles, packHash: string, a: string, b: string, seed: number, opts: MatchupOptions = {}): MatchupResult {
  const size = opts.size ?? 64;
  const per = opts.perSide ?? 10;
  const jit = opts.jitter ?? 0.4;
  const apart = opts.apart ?? 20;
  const w = new World({ pack, packHash, seed, map: { generator: "flat", size, tribes: 2 } });
  // no Shapers: each tribe gets a Hearth in a far corner so it is only eliminated when its units are gone
  w.spawnBuilding("hearth", 0, 2, 2);
  w.spawnBuilding("hearth", 1, size / 2 + 2, 2);
  const rng = new Rng(seed ^ 0x2545f491);
  const cy = size / 2;
  const ax = size / 2 - apart / 2;
  const bx = size / 2 + apart / 2;
  const place = (army: string, tribe: number, x0: number, count: number): number[] => {
    const kinds = army.split("+");
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      const col = k % 2;
      const row = (k - col) / 2;
      const jx = (rng.float("spawn") - 0.5) * jit;
      const jy = (rng.float("spawn") - 0.5) * jit;
      out.push(w.ents.index(w.spawnUnit(kinds[k % kinds.length], tribe, x0 + (tribe === 0 ? -col : col) + jx, cy - count / 4 + row + jy)));
    }
    return out;
  };
  const ga = place(a, 0, ax, per);
  const gb = place(b, 1, bx, opts.perSideB ?? per);
  w.units.order(ga, bx, cy, ORDER.attackMove);
  w.units.order(gb, ax, cy, ORDER.attackMove);
  const ticks = Math.round((opts.seconds ?? 90) * w.cfg.tickHz);
  const alive = (tribe: number) => w.count((i) => w.ents.cat[i] === CAT.unit && w.ents.tribe[i] === tribe);
  let endTick = -1;
  for (let t = 0; t < ticks; t++) {
    w.step();
    if (alive(0) === 0 || alive(1) === 0) {
      endTick = w.tick;
      break;
    }
  }
  const sa = alive(0);
  const sb = alive(1);
  return { a, b, seed, winner: sa > 0 && sb === 0 ? "a" : sb > 0 && sa === 0 ? "b" : "draw", survivorsA: sa, survivorsB: sb, endTick, converted: w.eventCounts.get("converted") ?? 0, killed: w.eventCounts.get("killed") ?? 0 };
}

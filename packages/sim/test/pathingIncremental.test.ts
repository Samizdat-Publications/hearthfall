// BACKLOG 47: the pathfinder applies terrain edits per dirty rect and repairs components locally; after any
// mix of terrain ops its walkability, step costs and component partition must equal a full rebuild.
import { describe, expect, it } from "vitest";
import { Pathfinder, type NavMode } from "../src/pathing.ts";
import type { Terrain, TerrainOpSpec } from "../src/terrain.ts";
import { world } from "./helpers.ts";

type Inner = { walk: Uint8Array; cost: Float32Array; comp: Int32Array };

function same(a: Pathfinder, b: Pathfinder): string | null {
  const A = a as unknown as Inner;
  const B = b as unknown as Inner;
  const fwd = new Map<number, number>();
  const back = new Map<number, number>();
  for (let i = 0; i < A.walk.length; i++) {
    if (A.walk[i] !== B.walk[i]) return `walk differs at ${i}`;
    if (A.cost[i] !== B.cost[i]) return `cost differs at ${i}`;
    const x = A.comp[i];
    const y = B.comp[i];
    if ((x === 0) !== (y === 0)) return `comp zero differs at ${i}`;
    if (x === 0) continue;
    if ((fwd.get(x) ?? y) !== y || (back.get(y) ?? x) !== x) return `partition differs at ${i} (${x} vs ${y})`;
    fwd.set(x, y);
    back.set(y, x);
  }
  return null;
}

/** A deterministic op stream mixing every height op near the sea, where walkability flips most. */
function ops(t: Terrain, count: number, seed: number): TerrainOpSpec[][] {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const n = t.size;
  const out: TerrainOpSpec[][] = [];
  for (let k = 0; k < count; k++) {
    const batch: TerrainOpSpec[] = [];
    const m = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < m; j++) {
      const x = Math.floor(rnd() * n);
      const y = Math.floor(rnd() * n);
      const r = 2 + Math.floor(rnd() * 5);
      const pick = Math.floor(rnd() * 9);
      batch.push(
        [
          { op: "raise", x, y, r, amount: 20 + Math.floor(rnd() * 120) } as const,
          { op: "lower", x, y, r, amount: 20 + Math.floor(rnd() * 120) } as const,
          { op: "set", x, y, r, value: t.sea - 10 + Math.floor(rnd() * 30) } as const,
          { op: "flattenToAverage", x, y, r } as const,
          { op: "smooth", x, y, r, strength: 0.5 } as const,
          { op: "crater", x, y, r, height: 80, shape: rnd() < 0.5 ? "cone" : "bowl" } as const,
          { op: "ridgeLine", x, y, x2: x + 12, y2: y + 5, width: 2, aboveSea: 20 } as const,
          { op: "noiseScar", x, y, r, depth: 60, seed: k } as const,
          { op: "lowerTowardSea", x, y, r, amount: 60 } as const,
        ][pick],
      );
    }
    out.push(batch);
  }
  return out;
}

describe("BACKLOG 47: incremental pathfinder refresh", () => {
  for (const [label, gen, mode] of [
    ["continents land", "continents", "land"],
    ["islands land", "islands", "land"],
    ["continents water", "continents", "water"],
  ] as [string, string, NavMode][]) {
    it(`${label}: 150 op batches stay equal to a full rebuild`, () => {
      const w = world({ generator: gen as "continents", size: 128, tribes: 2 }, 5);
      const t = w.terrain;
      const pf = new Pathfinder(t, mode);
      pf.refresh();
      for (const batch of ops(t, 150, 99)) {
        for (const o of batch) t.apply(o);
        pf.refresh();
        const full = new Pathfinder(t, mode);
        full.refresh();
        const why = same(pf, full);
        expect(why, `after ${JSON.stringify(batch)}`).toBeNull();
      }
      // the incremental path did the work; full rebuilds only for possible splits and large edits
      expect(pf.refreshStats.local).toBeGreaterThan(30);
      expect(pf.refreshStats.full).toBeLessThan(pf.refreshStats.local + 150);
    });
  }

  it("an edit that keeps walkability touches no component, a lake repairs locally", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 }, 1);
    const t = w.terrain;
    const pf = new Pathfinder(t);
    pf.refresh();
    const s0 = { ...pf.refreshStats };
    t.raise(20, 20, 3, 1);
    pf.refresh();
    expect(pf.refreshStats).toEqual(s0);
    // a lake that leaves the land connected around it repairs locally
    t.setDisc(30, 30, 3, t.sea - 40);
    pf.refresh();
    expect(pf.refreshStats.local).toBe(s0.local + 1);
    const ok = new Pathfinder(t);
    ok.refresh();
    expect(same(pf, ok)).toBeNull();
  });

  it("islands appear locally, a land bridge merges them, cutting it rebuilds", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 }, 1);
    const t = w.terrain;
    t.heights.fill(t.sea - 40);
    const pf = new Pathfinder(t);
    pf.refresh();
    const check = () => {
      const full = new Pathfinder(t);
      full.refresh();
      expect(same(pf, full)).toBeNull();
    };
    const at = (x: number, y: number) => pf.comp[x + y * 64];
    t.setDisc(20, 20, 6, t.sea + 40);
    t.setDisc(40, 20, 6, t.sea + 40);
    pf.refresh();
    check();
    expect(pf.refreshStats).toEqual({ full: 1, local: 1, merges: 0 });
    expect(at(20, 20)).toBeGreaterThan(0);
    expect(at(20, 20)).not.toBe(at(40, 20));
    t.setDisc(30, 20, 5, t.sea + 40);
    pf.refresh();
    check();
    expect(pf.refreshStats).toEqual({ full: 1, local: 2, merges: 1 });
    expect(at(20, 20)).toBe(at(40, 20));
    t.setDisc(30, 20, 5, t.sea - 40);
    pf.refresh();
    check();
    expect(pf.refreshStats.full).toBe(2);
    expect(at(20, 20)).not.toBe(at(40, 20));
  });
});

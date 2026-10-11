import { describe, expect, it } from "vitest";
import { Heap, Pathfinder, SpatialHash } from "../src/pathing.ts";
import { flatTerrain } from "./helpers.ts";

describe("heap", () => {
  it("pops in key order with index tie-break", () => {
    const h = new Heap();
    for (const [k, n] of [[5, 1], [1, 9], [1, 3], [7, 2], [0, 4]]) h.push(k, n);
    const out: number[] = [];
    while (h.size) out.push(h.pop());
    expect(out).toEqual([4, 3, 9, 1, 2]);
  });
  it("grows past its initial capacity", () => {
    const h = new Heap();
    for (let i = 3000; i > 0; i--) h.push(i, i);
    expect(h.pop()).toBe(1);
    expect(h.size).toBe(2999);
  });
});

describe("pathfinder", () => {
  const S = 32;
  it("finds the short way across the wrap seam", () => {
    const t = flatTerrain(S, 160);
    const pf = new Pathfinder(t);
    const r = pf.astar(t.idx(2, 5), t.idx(S - 3, 5), 10000);
    expect(r.ok).toBe(true);
    expect(r.expanded).toBeLessThan(40);
    expect(Array.from(r.waypoints)).toEqual([t.idx(S - 3, 5)]);
  });
  it("routes around a wall and keeps waypoints walkable", () => {
    const t = flatTerrain(S, 160);
    for (let y = 0; y < 20; y++) t.heights[t.idx(16, y)] = 600;
    for (let y = 0; y < S; y++) t.heights[t.idx(0, y)] = 600;
    const pf = new Pathfinder(t);
    const r = pf.astar(t.idx(8, 4), t.idx(24, 4), 10000);
    expect(r.ok).toBe(true);
    expect(r.waypoints.length).toBeGreaterThan(1);
    for (const v of r.waypoints) expect(pf.walkable(v)).toBe(true);
  });
  it("fails instantly when the goal is on another landmass", () => {
    const t = flatTerrain(S, 160);
    for (let y = 0; y < S; y++) for (const x of [0, 1, 16, 17]) t.heights[t.idx(x, y)] = 40;
    const pf = new Pathfinder(t);
    const r = pf.astar(t.idx(8, 4), t.idx(24, 4), 10000);
    expect(r.ok).toBe(false);
    expect(r.expanded).toBe(0);
  });
  it("refreshes caches when the terrain changes", () => {
    const t = flatTerrain(S, 160);
    const pf = new Pathfinder(t);
    pf.refresh();
    expect(pf.walkable(t.idx(5, 5))).toBe(true);
    t.setDisc(5, 5, 1, 40);
    pf.refresh();
    expect(pf.walkable(t.idx(5, 5))).toBe(false);
  });
  it("flow field decreases toward the goal", () => {
    const t = flatTerrain(S, 160);
    const f = new Pathfinder(t).flowField(t.idx(10, 10));
    expect(f[t.idx(10, 10)]).toBe(0);
    expect(f[t.idx(12, 10)]).toBeLessThan(f[t.idx(14, 10)]);
  });
  it("S4 L6-C regression: a flow field over fractional slope costs pops each cell a bounded number of times", () => {
    // a rising causeway leaves many cells with fractional step costs; comparing a float64 candidate with the
    // float32 stored distance re-pushed cells whose distance rounded up, a cascade that took minutes per field
    const N = 128;
    const t = flatTerrain(N, 160);
    // columns one height unit apart: every cell has slope 1, so every step costs 1.025 (not exact in float32)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.heights[t.idx(x, y)] = 160 + (x % 2);
    const pf = new Pathfinder(t);
    const f = pf.flowField(t.idx(3, 3));
    expect(f[t.idx(3, 3)]).toBe(0);
    expect(Number.isFinite(f[t.idx(90, 70)])).toBe(true);
    expect(pf.flowPops).toBeLessThanOrEqual(2 * N * N);
  });
});

describe("spatial hash", () => {
  it("lists neighbors in ascending index order across the seam", () => {
    const h = new SpatialHash(32);
    const xs = new Float64Array([0.5, 31.5, 10, 0.8]);
    const ys = new Float64Array([0.5, 0.5, 10, 31.6]);
    h.rebuild(4, () => true, xs, ys);
    const seen: number[] = [];
    h.near(0.5, 0.5, (i) => seen.push(i));
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 3]);
  });
});

describe("torus ambiguity (M3 soak regression)", () => {
  it("never produces a waypoint leg of half the map or more", () => {
    const S = 32;
    const t = flatTerrain(S, 160);
    // wall the short way so the route must go around the long way
    for (let y = 0; y < S; y++) t.heights[t.idx(10, y)] = 600;
    const pf = new Pathfinder(t);
    const r = pf.astar(t.idx(8, 5), t.idx(12, 5), 10000);
    expect(r.ok).toBe(true);
    let prev = t.idx(8, 5);
    for (const v of r.waypoints) {
      let dx = Math.abs((v % S) - (prev % S));
      if (dx > S / 2) dx = S - dx;
      expect(dx).toBeLessThan(S / 2 - 1);
      prev = v;
    }
  });
});

import { describe, expect, it } from "vitest";
import { wrap, wrapDelta } from "../src/terrain.ts";
import { flatTerrain } from "./helpers.ts";

const S = 32;

describe("torus helpers", () => {
  it("wrap and wrapDelta", () => {
    expect(wrap(-1, S)).toBe(S - 1);
    expect(wrap(S, S)).toBe(0);
    expect(wrapDelta(S - 1, S)).toBe(-1);
    expect(wrapDelta(-(S - 2), S)).toBe(2);
  });

  it("heightAt interpolates across the seam", () => {
    const t = flatTerrain(S, 100);
    t.heights[t.idx(S - 1, 5)] = 200;
    t.heights[t.idx(0, 5)] = 100;
    expect(t.heightAt(S - 0.5, 5)).toBe(150);
    expect(t.heightAt(-0.5, 5)).toBe(150);
  });
});

describe("terrain ops", () => {
  it("raise adds most at the center and nothing outside the radius", () => {
    const t = flatTerrain(S, 160);
    t.raise(10, 10, 4, 40);
    expect(t.get(10, 10)).toBe(200);
    expect(t.get(12, 10)).toBe(160 + Math.round(40 * (1 - 0.25)));
    expect(t.get(15, 10)).toBe(160);
    expect(t.dirty.length).toBe(1);
    expect(t.version).toBe(1);
  });

  it("lower is the mirror of raise and clamps at zero", () => {
    const t = flatTerrain(S, 10);
    t.lower(10, 10, 3, 40);
    expect(t.get(10, 10)).toBe(0);
  });

  it("raise at the corner wraps symmetrically over both seams", () => {
    const t = flatTerrain(S, 160);
    t.raise(0, 0, 5, 50);
    expect(t.get(S - 2, S - 2)).toBe(t.get(2, 2));
    expect(t.get(S - 3, 0)).toBe(t.get(3, 0));
    expect(t.get(0, S - 4)).toBe(t.get(0, 4));
    expect(t.get(2, 2)).toBeGreaterThan(160);
    const d = t.dirty[0];
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.x).toBeLessThan(S);
    expect(d.x + d.w).toBeGreaterThan(S);
  });

  it("set writes a value in the disc", () => {
    const t = flatTerrain(S, 160);
    t.setDisc(5, 5, 2, 300);
    expect(t.get(5, 5)).toBe(300);
    expect(t.get(6, 6)).toBe(300);
    expect(t.get(8, 5)).toBe(160);
  });

  it("flattenToAverage levels the core to the mean and respects minAboveSea", () => {
    const t = flatTerrain(S, 160);
    t.raise(10, 10, 3, 60);
    const target = t.flattenToAverage(10, 10, 4, 0);
    expect(t.get(10, 10)).toBe(target);
    expect(t.get(11, 11)).toBe(target);
    const w = flatTerrain(S, 100);
    expect(w.flattenToAverage(5, 5, 3, 4)).toBe(124);
    expect(w.version).toBe(1);
  });

  it("flattenRect moves at most maxStep per call and reports what is left", () => {
    const t = flatTerrain(S, 160);
    t.heights[t.idx(4, 4)] = 180;
    expect(t.flattenRect(3, 3, 2, 2, 160, 5)).toBe(15);
    expect(t.get(4, 4)).toBe(175);
    let left = 1;
    while (left > 0) left = t.flattenRect(3, 3, 2, 2, 160, 5);
    expect(t.get(4, 4)).toBe(160);
  });

  it("smooth pulls a spike toward its neighbors", () => {
    const t = flatTerrain(S, 160);
    t.heights[t.idx(0, 0)] = 400;
    t.smooth(0, 0, 1, 1);
    expect(t.get(0, 0)).toBeLessThan(400);
    expect(t.get(S - 1, 0)).toBeGreaterThan(160);
  });

  it("crater cone rises with a dip at the top; bowl sinks", () => {
    const t = flatTerrain(S, 160);
    t.crater(16, 16, 7, 120, "cone");
    expect(t.get(16, 16)).toBeLessThan(t.get(17, 16));
    expect(t.get(18, 16)).toBeGreaterThan(200);
    const b = flatTerrain(S, 300);
    b.crater(16, 16, 5, 100, "bowl");
    expect(b.get(16, 16)).toBe(200);
  });

  it("ridgeLine bridges water above sea, across the seam", () => {
    const t = flatTerrain(S, 160);
    for (let y = 0; y < S; y++) for (let x = 0; x < 6; x++) t.heights[t.idx(x - 3, y)] = 60;
    expect(t.minHeightAlong(S - 6, 10, 5, 10)).toBeLessThan(t.sea);
    t.ridgeLine(S - 6, 10, 5, 10, 2, 24);
    expect(t.minHeightAlong(S - 6, 10, 5, 10)).toBeGreaterThanOrEqual(t.sea + 24);
    expect(t.get(0, 10)).toBe(t.sea + 24);
    expect(t.get(0, 14)).toBe(60);
  });

  it("noiseScar lowers unevenly and deterministically", () => {
    const a = flatTerrain(S, 300);
    const b = flatTerrain(S, 300);
    a.noiseScar(16, 16, 7, 24, 99);
    b.noiseScar(16, 16, 7, 24, 99);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(a.get(16, 16)).toBeLessThan(300);
    const vals = new Set<number>();
    for (let x = 12; x <= 20; x++) vals.add(a.get(x, 16));
    expect(vals.size).toBeGreaterThan(3);
  });

  it("lowerTowardSea sinks to drowning depth and no further", () => {
    const t = flatTerrain(S, 140);
    for (let k = 0; k < 20; k++) t.lowerTowardSea(10, 10, 4, 10);
    expect(t.get(10, 10)).toBe(t.sea - 16);
    expect(t.drowns(10, 10)).toBe(true);
  });

  it("scar marks cells unbuildable and heals one second per call", () => {
    const t = flatTerrain(S, 200);
    expect(t.buildable(8, 8, 2, 2, 48)).toBe(true);
    t.scarDisc(9, 9, 2, 3);
    expect(t.buildable(8, 8, 2, 2, 48)).toBe(false);
    t.healScars();
    t.healScars();
    expect(t.scarAt(9, 9)).toBe(1);
    t.healScars();
    expect(t.buildable(8, 8, 2, 2, 48)).toBe(true);
  });

  it("walkability, slope, buildability and drowning queries", () => {
    const t = flatTerrain(S, 160);
    expect(t.walkable(3, 3)).toBe(true);
    t.heights[t.idx(3, 3)] = 200;
    expect(t.slope(3, 3)).toBe(40);
    expect(t.walkable(3, 3)).toBe(false);
    expect(t.buildable(2, 2, 2, 2, 48)).toBe(true);
    expect(t.buildable(2, 2, 2, 2, 30)).toBe(false);
    t.heights[t.idx(20, 20)] = 115;
    expect(t.isLand(20, 20)).toBe(false);
    expect(t.drowns(20, 20)).toBe(false);
    t.heights[t.idx(20, 20)] = 100;
    expect(t.drowns(20, 20)).toBe(true);
  });

  it("apply() dispatches every op spec", () => {
    const t = flatTerrain(S, 200);
    const specs = [
      { op: "raise", x: 4, y: 4, r: 2, amount: 10 },
      { op: "lower", x: 4, y: 4, r: 2, amount: 10 },
      { op: "set", x: 8, y: 8, r: 1, value: 250 },
      { op: "flattenToAverage", x: 8, y: 8, r: 3 },
      { op: "smooth", x: 8, y: 8, r: 2, strength: 0.5 },
      { op: "crater", x: 20, y: 20, r: 4, height: 30, shape: "bowl" },
      { op: "ridgeLine", x: 1, y: 1, x2: 6, y2: 1, width: 2, aboveSea: 10 },
      { op: "noiseScar", x: 25, y: 5, r: 3, depth: 10, seed: 1 },
      { op: "lowerTowardSea", x: 25, y: 25, r: 3, amount: 5 },
      { op: "scar", x: 12, y: 25, r: 2, seconds: 10 },
    ] as const;
    for (const s of specs) t.apply(s);
    expect(t.version).toBe(specs.length);
    expect(t.takeDirty().length).toBe(specs.length);
    expect(t.dirty.length).toBe(0);
  });
});

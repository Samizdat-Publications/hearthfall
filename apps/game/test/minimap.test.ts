// BACKLOG 80: the minimap view footprint is clipped to the terrain fade radius, so on a small map it
// stays inside one map copy instead of folding into a V across the wrap.
import { describe, expect, it } from "vitest";
import { World } from "@hearthfall/sim";
import { basePack } from "../../../packages/sim/test/helpers.ts";
import { clipFootprint, drawDens, type DenCtx } from "../src/minimap.ts";

describe("minimap footprint", () => {
  it("keeps points inside the fade radius and pulls farther ones onto it", () => {
    const pts: [number, number][] = [
      [34, 32],
      [32 + 60, 32],
      [32, 32 - 45],
    ];
    const out = clipFootprint(pts, 32, 32, 30);
    expect(out[0]).toEqual([34, 32]);
    expect(out[1][0]).toBeCloseTo(62, 9);
    expect(out[1][1]).toBeCloseTo(32, 9);
    expect(out[2][0]).toBeCloseTo(32, 9);
    expect(out[2][1]).toBeCloseTo(2, 9);
  });

  it("bounds a far horizon footprint on a 64 map to less than one map width", () => {
    // a zoomed-out view whose top edge reaches far past the antipode (unwrapped picks)
    const n = 64;
    const pts: [number, number][] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = Math.sin(a) < 0 ? 90 : 12;
      pts.push([20 + Math.cos(a) * r, 20 + Math.sin(a) * r]);
    }
    const out = clipFootprint(pts, 20, 20, n / 2 - 2);
    const xs = out.map((p) => p[0]);
    const zs = out.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(n);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(n);
  });
});

// Chapter 4 prep: wolf den icons on the minimap
describe("minimap den icons", () => {
  const pack = basePack();
  const world = () => {
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2, fog: true } });
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    w.spawnBuilding("hearth", 1, 54, 54);
    w.vision.update(true);
    return w;
  };
  /** records the fill colors used and the diamond centers */
  const recorder = () => {
    const log = { fills: [] as string[], arcs: [] as number[][], moves: [] as number[][], strokes: [] as string[] };
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      beginPath() {},
      closePath() {},
      lineTo() {},
      moveTo(x: number, y: number) {
        log.moves.push([x, y]);
      },
      arc(x: number, y: number, r: number) {
        log.arcs.push([x, y, r]);
      },
      fill() {
        log.fills.push(this.fillStyle as string);
      },
      stroke() {
        log.strokes.push(this.strokeStyle as string);
      },
    };
    return { ctx: ctx as unknown as DenCtx, log };
  };

  it("draws a red diamond with a dark rim over an explored den, nothing over one in the dark", () => {
    const w = world();
    w.beasts.addDen("wolf", 18, 14, 2);
    w.beasts.addDen("wolf", 40, 40, 2);
    const { ctx, log } = recorder();
    expect(drawDens(w, 0, false, ctx)).toBe(1);
    expect(log.fills).toEqual(["rgba(13, 11, 9, 0.9)", "#e2483a"]);
    expect(log.arcs).toHaveLength(0);
    // the first diamond point is the top corner above the den
    expect(log.moves[0]).toEqual([18, 10]);
  });

  it("the fog reveal shows every standing den; a cleared den has no icon", () => {
    const w = world();
    w.beasts.addDen("wolf", 18, 14, 1);
    w.beasts.addDen("wolf", 40, 40, 1);
    const { ctx } = recorder();
    expect(drawDens(w, 0, true, ctx)).toBe(2);
    w.damage(w.ents.index(w.beasts.dens[1].members[0]), 1e6, 0, true);
    w.step();
    expect(drawDens(w, 0, true, ctx)).toBe(1);
  });

  it("a clearDens beacon is gold with a ring, even in unexplored ground", () => {
    const w = world();
    w.beasts.addDen("wolf", 40, 40, 1);
    const { ctx: none } = recorder();
    expect(drawDens(w, 0, false, none)).toBe(0);
    // a level objective that counts every den turns it into a beacon
    w.level = { def: { objectives: [{ type: "clearDens" }] }, done: [0], open: () => true } as unknown as typeof w.level;
    const { ctx, log } = recorder();
    expect(drawDens(w, 0, false, ctx)).toBe(1);
    expect(log.strokes).toEqual(["#ffd23a"]);
    expect(log.arcs).toHaveLength(1);
    expect(log.fills.at(-1)).toBe("#ffd23a");
  });

  it("the icons grow with the map", () => {
    const small = world();
    small.beasts.addDen("wolf", 18, 14, 1);
    const big = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 256, tribes: 1, fog: false } });
    big.beasts.addDen("wolf", 100, 100, 1);
    const a = recorder();
    const b = recorder();
    drawDens(small, 0, true, a.ctx);
    drawDens(big, 0, true, b.ctx);
    // the top corner sits 4 cells above the den on a 64 map and 8 on a 256 map
    expect(100 - b.log.moves[0][1]).toBeGreaterThan(14 - a.log.moves[0][1]);
    expect(100 - b.log.moves[0][1]).toBe(8);
  });
});

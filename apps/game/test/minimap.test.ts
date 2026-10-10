// BACKLOG 80: the minimap view footprint is clipped to the terrain fade radius, so on a small map it
// stays inside one map copy instead of folding into a V across the wrap.
import { describe, expect, it } from "vitest";
import { clipFootprint } from "../src/minimap.ts";

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

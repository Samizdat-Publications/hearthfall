import { describe, expect, it } from "vitest";
import { atan2, cos, sin } from "../src/dmath.ts";

describe("dmath", () => {
  it("sin and cos track Math within table error", () => {
    for (let i = -400; i <= 400; i++) {
      const x = i * 0.0731;
      expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-5);
      expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-5);
    }
  });

  it("atan2 tracks Math in all quadrants", () => {
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        if (i === 0 && j === 0) continue;
        expect(Math.abs(atan2(i, j) - Math.atan2(i, j))).toBeLessThan(1e-5);
      }
    }
    expect(atan2(0, 0)).toBe(0);
  });
});

describe("dmath edge cases (M0 review regression)", () => {
  it("never returns NaN for tiny negatives or exact turns", () => {
    for (const x of [-1e-17, -1e-20, -5e-324, -0, 0, 6.283185307179586, -6.283185307179586, 1e6 * 6.283185307179586, -1.5707963267948966]) {
      expect(Number.isNaN(sin(x))).toBe(false);
      expect(Number.isNaN(cos(x))).toBe(false);
    }
    expect(sin(-1e-17)).toBe(0);
  });

  it("golden values are bit exact (any change here breaks replays)", () => {
    expect(sin(1)).toBe(0.841470594095792);
    expect(cos(2.5)).toBe(-0.8011399050110692);
    expect(atan2(3, -7)).toBe(2.736700903017609);
  });
});

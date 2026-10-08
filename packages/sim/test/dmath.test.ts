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

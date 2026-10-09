import { describe, expect, it } from "vitest";
import { fitScale } from "../src/hudFit.ts";

describe("hud fit (BACKLOG 8)", () => {
  it("keeps the wanted scale when it fits", () => {
    expect(fitScale(1.25, () => true)).toBe(1.25);
  });
  it("steps down in 5 percent steps to the largest scale that fits", () => {
    const tried: number[] = [];
    expect(fitScale(1.25, (z) => (tried.push(z), z <= 1.05))).toBe(1.05);
    expect(tried).toEqual([1.25, 1.2, 1.15, 1.1, 1.05]);
  });
  it("stops at the floor when nothing fits", () => {
    expect(fitScale(1.5, () => false)).toBe(0.5);
  });
});

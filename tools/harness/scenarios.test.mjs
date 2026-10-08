import { describe, expect, it } from "vitest";
import { loadBasePack } from "./datapack.mjs";
import { loadScenarios, runScenario } from "./scenarios.mjs";

const pack = loadBasePack().pack;
const base = { id: "t", seed: 1, map: { generator: "flat", size: 64, tribes: 1 }, setup: [{ spawn: "wild", at: [5, 5] }], runTicks: 10 };

describe("scenario runner", () => {
  it("fails a false assertion and reports operands", () => {
    const r = runScenario({ ...base, assert: [{ at: 3, expr: "count(wild) == 2" }] }, pack);
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/got 1 == 2/);
  });

  it("evaluates assertions at their tick (including 0 and runTicks)", () => {
    const r = runScenario({ ...base, assert: [{ at: 0, expr: "tick == 0" }, { at: 10, expr: "tick == 10" }] }, pack);
    expect(r).toMatchObject({ ok: true });
    const bad = runScenario({ ...base, assert: [{ at: 4, expr: "tick == 5" }] }, pack);
    expect(bad.ok).toBe(false);
  });

  it("errors on unknown names, asserts after runTicks, and unknown spawns", () => {
    expect(runScenario({ ...base, assert: [{ at: 1, expr: "bogus > 1" }] }, pack).failures[0]).toMatch(/unknown name/);
    expect(runScenario({ ...base, assert: [{ at: 99, expr: "true" }] }, pack).failures[0]).toMatch(/after runTicks/);
    expect(runScenario({ ...base, setup: [{ spawn: "dragon", at: [1, 1] }] }, pack).failures[0]).toMatch(/unknown spawn/);
  });

  it("every scenario file has a description, tags and at least one assertion", () => {
    for (const d of loadScenarios()) {
      expect(d.description, d.id).toBeTruthy();
      expect((d.tags ?? []).length, d.id).toBeGreaterThan(0);
      expect((d.assert ?? []).length, d.id).toBeGreaterThan(0);
    }
  });
});

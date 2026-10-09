import { describe, expect, it } from "vitest";
import { etaLabel, spellEtas, type EtaInput } from "../src/eta.ts";

const base = (o: Partial<EtaInput> = {}): EtaInput => ({
  costs: [60, 120, 300],
  maxCharges: [4, 3, 1],
  charges: [0, 0, 0],
  progress: [0, 0, 0],
  auto: [1, 1, 0],
  unlocked: [1, 1, 1],
  cursor: 0,
  incomePerMin: 120,
  spellsPct: 50,
  trainDemand: 0,
  ...o,
});

describe("spell ETAs (M8 HUD)", () => {
  it("plays the round robin forward at the spell share of income", () => {
    // 2 mana/s, all to spells: spell 0 needs 60 (30 s), then spell 1 needs 120 (60 s more)
    expect(spellEtas(base())).toEqual([30, 90, -1]);
    // training also wants mana: spells get 50 percent, so twice as long
    expect(spellEtas(base({ trainDemand: 3 }))).toEqual([60, 180, -1]);
  });

  it("counts progress already made and starts at the cursor", () => {
    expect(spellEtas(base({ progress: [0, 100, 0], cursor: 1 }))).toEqual([40, 10, -1]);
  });

  it("full, manual or locked spells and zero income have no ETA", () => {
    expect(spellEtas(base({ charges: [4, 0, 0] }))).toEqual([-1, 60, -1]);
    expect(spellEtas(base({ incomePerMin: 0 }))).toEqual([-1, -1, -1]);
    expect(spellEtas(base({ unlocked: [1, 0, 1], auto: [1, 1, 1] }))).toEqual([30, -1, 180]);
  });

  it("labels", () => {
    expect(etaLabel(-1)).toBe("");
    expect(etaLabel(0.2)).toBe("1s");
    expect(etaLabel(42.1)).toBe("43s");
    expect(etaLabel(400)).toBe("7m");
  });
});

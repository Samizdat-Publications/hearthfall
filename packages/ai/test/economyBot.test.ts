import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { EconomyBot } from "../src/economyBot.ts";

// BACKLOG 48: an islet across a moat from the Hearth (flat map, the islet big enough for a dwelling pad)
function islet() {
  const p = basePack();
  const map = {
    generator: "flat",
    size: 64,
    tribes: 1,
    paint: [
      { shape: "disc" as const, at: [16, 16] as [number, number], r: 17, aboveSea: -20, falloff: 1 },
      { shape: "disc" as const, at: [16, 16] as [number, number], r: 10, aboveSea: 40, falloff: 1 },
    ],
  };
  const w = new World({ pack: p.files, packHash: p.hash, seed: 48, map });
  w.spawnBuilding("hearth", 0, 44, 44);
  for (let k = 0; k < 5; k++) w.spawnUnit("settler", 0, 46 + k * 0.7, 42);
  return w;
}

describe("economy bot (BACKLOG 48)", () => {
  it("cancels its plan once the plan is cut off from the Hearth, and never plans across water", () => {
    const w = islet();
    const bot = new EconomyBot({ tribe: 0, every: 1 });
    w.step([{ tick: w.tick, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [16, 16] } }]);
    expect(w.eventCounts.get("planPlaced") ?? 0).toBe(1);
    const cmds = bot.decide(w);
    expect(cmds.map((c) => c.type)).toEqual(["cancelPlan"]);
    w.step(cmds);
    expect(w.eventCounts.get("planCancelled") ?? 0).toBe(1);
    const snap = w.cfg.pack.balance.movement.snapRadius;
    const home = w.economy.compAt(44, 44, snap);
    expect(home).toBeGreaterThan(0);
    for (let k = 0; k < 6; k++) {
      const out = bot.decide(w).filter((c) => c.type === "placePlan");
      if (!out.length) break;
      const at = out[0].args.at as [number, number];
      expect(w.economy.compAt(at[0], at[1], snap)).toBe(home);
      w.step(out);
    }
  });
});

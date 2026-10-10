// BACKLOG 11 (ADR-017): the opponent AI forges by personality (turtle moat with two gaps, aggressive
// flatten) and then declares itself ready, without drowning its own people.
import { describe, expect, it } from "vitest";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { OpponentAI } from "../src/index.ts";

function forgeWorld(personality: string): World {
  const p = basePack();
  const w = new World({ pack: p.files, packHash: p.hash, seed: 6, map: { generator: "flat", size: 64, tribes: 2 }, forge: true });
  w.spawnBuilding("hearth", 0, 48, 32);
  w.spawnBuilding("hearth", 1, 16, 32);
  w.spawnUnit("shaper", 0, 50, 30);
  w.spawnStartUnits(1, 16, 32);
  w.controllers.push(new OpponentAI({ tribe: 1, personality, difficulty: "normal" }));
  return w;
}

describe("AI in the Forge (BACKLOG 11)", () => {
  it("the turtle digs a moat ring with gaps toward and away from its rival, then is ready", () => {
    const w = forgeWorld("turtle");
    const plan = w.cfg.pack.ai.personalities.find((p) => p.id === "turtle")!.forge!;
    const h0 = w.terrain.heights[26 + 32 * 64];
    w.run(w.forge!.endsAt);
    expect(w.forge!.ops[1]).toBe(plan.strokes);
    expect(w.forge!.ready[1]).toBe(true);
    expect(w.events.some((e) => e.type === "forgeReady") || w.eventCounts.get("forgeReady") === 1).toBe(true);
    const sea = w.terrain.sea;
    // ring 10 around (16, 32): north and south are moat, east (toward the rival) and west are gaps
    expect(w.terrain.drowns(16, 32 - plan.ring)).toBe(true);
    expect(w.terrain.drowns(16, 32 + plan.ring)).toBe(true);
    // the moat is continuous between the gaps (every 5 degrees from 35 to 145 and 215 to 325)
    for (let deg = 35; deg <= 325; deg += 5) {
      if (deg > 145 && deg < 215) continue;
      const a = (deg * Math.PI) / 180;
      expect(w.terrain.drowns(16 + Math.cos(a) * plan.ring, 32 + Math.sin(a) * plan.ring), `${deg} degrees`).toBe(true);
    }
    expect(w.terrain.heights[26 + 32 * 64]).toBe(h0);
    expect(w.terrain.heightAt(16 - plan.ring, 32)).toBeGreaterThan(sea);
    expect(w.eventCounts.get("drowned") ?? 0).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("the aggressive AI flattens a few strokes and is ready long before time runs out", () => {
    const w = forgeWorld("aggressive");
    const plan = w.cfg.pack.ai.personalities.find((p) => p.id === "aggressive")!.forge!;
    w.run(Math.round(w.forge!.endsAt / 2));
    expect(w.forge!.ops[1]).toBe(plan.strokes);
    expect(w.forge!.ready[1]).toBe(true);
    // the player has not readied, so the Forge still runs
    expect(w.forge!.running()).toBe(true);
  });
});

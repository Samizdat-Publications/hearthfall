// In-match progression (BACKLOG 0b, DESIGN 3a): follower tiers gate buildings and never close again.
import { describe, expect, it } from "vitest";
import { basePack, world } from "./helpers.ts";

function camp(settlers: number) {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  w.spawnBuilding("hearth", 0, 8, 8);
  w.spawnBuilding("hearth", 1, 40, 40);
  w.spawnUnit("shaper", 0, 10, 10);
  w.spawnUnit("shaper", 1, 42, 42);
  for (let k = 0; k < settlers; k++) w.spawnUnit("settler", 0, 12 + (k % 6), 12 + Math.floor(k / 6));
  return w;
}

const plan = (w: ReturnType<typeof camp>, building: string, at: [number, number]) => {
  w.step([{ tick: w.tick, tribe: 0, type: "placePlan", args: { building, at } }]);
  return w.events.find((e) => e.type === "commandRejected");
};

describe("progression tiers", () => {
  it("lodges and the Watchtower stay locked until the follower thresholds, then open for good", () => {
    const tiers = basePack().files.balance.progression.tiers;
    const village = tiers.find((t) => t.buildings.includes("warden_lodge"))!;
    const w = camp(3);
    w.step();
    expect(w.tribes[0].eco.tier).toBe(0);
    expect(String(plan(w, "warden_lodge", [24, 24])?.reason ?? "")).toContain(`locked: needs ${village.followers} followers`);
    expect(plan(w, "dwelling", [24, 30])).toBeUndefined();
    for (let k = 0; k < village.followers; k++) w.spawnUnit("settler", 0, 14 + (k % 5), 20 + Math.floor(k / 5));
    const seen: unknown[] = [];
    w.step();
    for (const e of w.events) if (e.type === "tierReached") seen.push(e);
    expect(seen).toEqual([expect.objectContaining({ tribe: 0, id: "village" })]);
    expect(plan(w, "warden_lodge", [24, 24])).toBeUndefined();
    // losing followers never closes a tier
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === 0 && w.ents.type[i] === w.economy.typeSettler) w.kill(i, "test");
    w.step();
    expect(w.tribes[0].eco.tier).toBe(1);
    expect(w.economy.buildingLock(0, w.cfg.buildingIndex.get("watchtower")!)).toBeNull();
    expect(w.economy.buildingLock(0, w.cfg.buildingIndex.get("fire_lodge")!)).toMatch(/needs \d+ followers/);
    expect(w.economy.buildingLock(1, w.cfg.buildingIndex.get("warden_lodge")!)).toMatch(/needs/);
  });

  it("god mode ignores locks", () => {
    const w = camp(0);
    w.godMode = true;
    expect(plan(w, "chant_house", [24, 24])).toBeUndefined();
  });
});

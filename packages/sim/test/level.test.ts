// Campaign level runtime (M9): painted maps, per-level unlocks and carry, objectives, lose
// conditions, triggers, and level state through snapshot and restore.
import { describe, expect, it } from "vitest";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { createLevelWorld, levelMap, OUTCOME } from "../src/level.ts";
import { World } from "../src/world.ts";
import { basePack } from "./helpers.ts";

function level(over: Partial<LevelDef> = {}): LevelDef {
  const raw = {
    id: "test_level",
    name: "Test",
    order: 1,
    description: "A test level.",
    seed: 7,
    map: { generator: "flat", size: 64, landAboveSea: -30, paint: [{ shape: "disc", at: [20, 32], r: 14, aboveSea: 40 }, { shape: "rect", at: [48, 32], size: [10, 6], aboveSea: 30, falloff: 0 }] },
    tribes: [{}],
    spells: ["bolt"],
    buildings: ["dwelling"],
    setup: [
      { spawn: "hearth", tribe: 0, at: [16, 32] },
      { spawn: "shaper", tribe: 0, at: [20, 30] },
      { spawn: "settler", tribe: 0, near: [20, 36], count: 4 },
      { spawn: "shrine", at: [26, 32], site: { tag: "near", worshippers: 2, prayerSeconds: 4, rewards: [{ type: "charges", spell: "hornets", n: 1 }] } },
    ],
    objectives: [{ type: "worship", site: "near" }, { type: "followers", n: 3 }],
    triggers: [
      { when: { type: "time", seconds: 2 }, do: [{ type: "message", text: "two seconds" }] },
      { when: { type: "objective", index: 0 }, do: [{ type: "spawn", unit: "settler", n: 2 }] },
    ],
    ...over,
  };
  const res = validateLevel(raw, basePack().files);
  if (!res.level) throw new Error(JSON.stringify(res.issues));
  return res.level;
}

const make = (def: LevelDef, carry?: { spells?: string[]; buildings?: string[] }) => {
  const p = basePack();
  return createLevelWorld({ def, carry }, p.files, p.hash);
};

describe("campaign levels", () => {
  it("paints islands over an open sea and opens only the level's spells, plus the campaign carry for the player", () => {
    const w = make(level(), { spells: ["raise_land"], buildings: ["watchtower"] });
    const t = w.terrain;
    expect(t.heightAt(20, 32)).toBe(t.sea + 40);
    expect(t.heightAt(48, 32)).toBe(t.sea + 30);
    expect(t.heightAt(48, 40)).toBe(t.sea - 30);
    const e = w.tribes[0].eco;
    const on = (id: string) => e.unlocked[w.cfg.spellIndex.get(id)!];
    expect([on("bolt"), on("raise_land"), on("lightning")]).toEqual([1, 1, 0]);
    expect(e.charges[w.cfg.spellIndex.get("lightning")!]).toBe(0);
    const lock = (b: string) => w.economy.buildingLock(0, w.cfg.buildingIndex.get(b)!);
    expect(lock("dwelling")).toBeNull();
    expect(lock("watchtower")).toBeNull();
    expect(lock("warden_lodge")).toBe("not available in this level");
  });

  it("objectives complete in any order, triggers fire once, and the level is won when all are done", () => {
    const w = make(level());
    w.run(60);
    expect(w.eventCounts.get("triggerFired")).toBe(1);
    expect(w.level!.outcome).toBe(OUTCOME.none);
    // followers (4 settlers) is already met; the shrine is not
    expect(w.level!.done).toEqual([0, 1]);
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: "tribe0.settlers", site: "near" } }]);
    for (let k = 0; k < 400 && w.level!.outcome === OUTCOME.none; k++) w.step();
    expect(w.level!.outcome).toBe(OUTCOME.won);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "levelWon", level: "test_level" }));
    // the objective trigger fired in the same step and spawned two settlers
    expect(w.eventCounts.get("triggerFired")).toBe(2);
    expect(w.economy.followers(0)).toBe(6);
    const end = w.level!.endedAt;
    w.run(40);
    expect(w.level!.endedAt).toBe(end);
    expect(w.eventCounts.get("levelWon")).toBe(1);
  });

  it("hearthLost loses the level when the player's Hearth falls", () => {
    const w = make(level({ lose: [{ type: "hearthLost" }] }));
    w.run(5);
    expect(w.level!.outcome).toBe(OUTCOME.none);
    w.kill(w.ents.index(w.tribes[0].hearth), "destroyed");
    w.step();
    expect(w.level!.outcome).toBe(OUTCOME.lost);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "levelLost", why: "hearthLost" }));
  });

  it("maxTroops caps a tribe's training in a level: orders are trimmed to the room left, then refused (BACKLOG 83)", () => {
    const w = make(level({ tribes: [{ maxTroops: 2 }] }));
    const lodge = w.spawnBuilding("warden_lodge", 0, 22, 34);
    w.step();
    const settlers = [0, 1, 2].map((k) => w.spawnUnit("settler", 0, 18 + k, 36));
    w.step([{ tick: w.tick, tribe: 0, type: "train", args: { building: lodge, units: settlers } }]);
    expect(w.combat.troopCount(0)).toBe(2);
    expect(w.combat.troopRoom(0)).toBe(0);
    w.step([{ tick: w.tick, tribe: 0, type: "train", args: { building: lodge, count: 1 } }]);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "commandRejected", reason: "this level caps your troops" }));
    expect(w.combat.troopCount(0)).toBe(2);
  });

  it("a time limit loses the level", () => {
    const w = make(level({ lose: [{ type: "timeLimit", seconds: 3 }] }));
    w.run(3 * w.cfg.tickHz + 5);
    expect(w.level!.outcome).toBe(OUTCOME.lost);
    expect(w.eventCounts.get("levelLost")).toBe(1);
    expect(w.level!.endedAt).toBe(3 * w.cfg.tickHz - 1);
  });

  it("level state survives snapshot and restore with identical hashes", () => {
    const def = level();
    const w = make(def);
    w.run(50);
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: "tribe0.settlers", site: "near" } }]);
    w.run(30);
    const p = basePack();
    const r = World.restore({ pack: p.files, packHash: p.hash, seed: def.seed, map: levelMap(def), populate: false, level: { def } }, w.snapshot());
    expect(r.hash().all).toBe(w.hash().all);
    for (let k = 0; k < 200; k++) {
      w.step();
      r.step();
    }
    expect(r.hash().all).toBe(w.hash().all);
    expect(r.level!.outcome).toBe(OUTCOME.won);
  });

  it("completeObjectives (god mode) wins the level in the same step; players cannot send it", () => {
    const w = make(level());
    w.step([{ tick: 0, tribe: 0, type: "completeObjectives", args: {} }]);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "commandRejected" }));
    w.step([{ tick: w.tick, tribe: -1, type: "completeObjectives", args: {} }]);
    expect(w.level!.outcome).toBe(OUTCOME.won);
  });

  it("validateLevel catches broken references", () => {
    const bad = { ...level(), objectives: [{ type: "worship", site: "nowhere" }], tribes: [{ ai: "aggressive" }] };
    const msgs = validateLevel(bad, basePack().files).issues.map((i) => i.message);
    expect(msgs).toContain("no site tagged nowhere");
    expect(msgs).toContain("tribe 0 is the player");
  });
});

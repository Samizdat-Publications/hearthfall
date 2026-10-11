// Campaign level runtime (M9): painted maps, per-level unlocks and carry, objectives, lose
// conditions, triggers, and level state through snapshot and restore.
import { describe, expect, it } from "vitest";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { createLevelWorld, levelMap, levelWorldInit, OUTCOME } from "../src/level.ts";
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

  it("a win beats a loss on the same tick: the last rival and the player fall together (BACKLOG 86)", () => {
    const base = level();
    const p = basePack();
    const idle = (spec: { tribe: number }) => ({ tribe: spec.tribe, every: 30, offset: 0, decide: () => [] });
    const w = createLevelWorld(
      {
        def: level({
          tribes: [{}, { ai: "turtle" }],
          setup: [...base.setup, { spawn: "hearth", tribe: 1, at: [44, 32] }, { spawn: "shaper", tribe: 1, at: [46, 32] }],
          objectives: [{ type: "eliminateAll" }],
          lose: [{ type: "hearthLost" }],
        }),
      },
      p.files,
      p.hash,
      idle,
    );
    w.run(5);
    expect(w.level!.outcome).toBe(OUTCOME.none);
    for (const t of [0, 1]) {
      w.kill(w.ents.index(w.tribes[t].hearth), "destroyed");
      w.kill(w.ents.index(w.tribes[t].shaper), "destroyed");
      for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === t) w.kill(i, "destroyed");
    }
    w.step();
    expect(w.tribes[0].alive).toBe(false);
    expect(w.level!.outcome).toBe(OUTCOME.won);
    expect(w.eventCounts.get("levelLost") ?? 0).toBe(0);
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

  it("stretch 3: reach, staged build and destroy objectives; area and followers triggers; beacons mark the reach target", () => {
    const base = level();
    const p = basePack();
    const idle = (spec: { tribe: number }) => ({ tribe: spec.tribe, every: 30, offset: 0, decide: () => [] });
    const def = level({
      tribes: [{}, { ai: "turtle" }],
      buildings: undefined,
      setup: [...base.setup, { spawn: "hearth", tribe: 1, at: [44, 32] }, { spawn: "shaper", tribe: 1, at: [46, 32] }, { spawn: "watchtower", tribe: 1, at: [50, 32] }],
      objectives: [
        { type: "reach", at: [30, 26], r: 2 },
        { type: "build", building: "dwelling", n: 1, after: 0 },
        { type: "destroy", tribe: 1, building: "watchtower" },
      ],
      triggers: [
        { when: { type: "area", at: [30, 26], r: 2, unit: "shaper" }, do: [{ type: "message", text: "area" }] },
        { when: { type: "followers", n: 99 }, do: [{ type: "message", text: "never" }] },
      ],
    });
    const w = createLevelWorld({ def }, p.files, p.hash, idle);
    w.spawnBuilding("dwelling", 0, 12, 38);
    w.run(5);
    const lv = w.level!;
    // the staged build objective is closed (unchecked) while the reach is open; a beacon marks the target
    expect(lv.done).toEqual([0, 0, 0]);
    expect(lv.open(1)).toBe(false);
    expect(w.eventCounts.get("beacon") ?? 0).toBeGreaterThan(0);
    expect(w.eventCounts.get("triggerFired") ?? 0).toBe(0);
    const sh = w.ents.index(w.tribes[0].shaper);
    w.ents.x[sh] = 30;
    w.ents.y[sh] = 26.5;
    w.step();
    expect(lv.done).toEqual([1, 1, 0]);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "levelMessage", text: "area" }));
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === 1 && w.ents.type[i] === w.cfg.buildingIndex.get("watchtower") && w.ents.cat[i] === 2) w.kill(i, "destroyed");
    w.step();
    expect(lv.done).toEqual([1, 1, 1]);
    expect(lv.outcome).toBe(OUTCOME.won);
    expect(validateLevel({ ...def, objectives: [{ type: "destroy", tribe: 1, building: "fire_lodge" }, { type: "reach", at: [1, 1], r: 1, after: 1 }] }, p.files).issues.map((i) => i.message)).toEqual([
      "tribe 1 starts with no fire_lodge",
      "after names no other objective (1)",
    ]);
  });

  it("validateLevel checks prayer chains: awaken names a dormant site and every dormant site can wake", () => {
    const base = level();
    const site = (tag: string, dormant: boolean, rewards: object[]) => ({ spawn: "shrine", at: [20, 32], site: { tag, dormant, rewards } });
    const msgs = (setup: object[]) => validateLevel({ ...base, setup: [...base.setup, ...setup] }, basePack().files).issues.map((i) => i.message);
    expect(msgs([site("a", false, [{ type: "awaken", site: "b" }]), site("b", true, [{ type: "message", text: "hi" }])])).toEqual([]);
    expect(msgs([site("b", true, [{ type: "message", text: "hi" }])])).toContain("dormant site b is never awakened");
    expect(msgs([site("a", false, [{ type: "awaken", site: "zz" }])])).toContain("no dormant site tagged zz");
  });

  // S2 block H: levels may name victory rules (a victory objective) and open with a Forge
  const duel = (over: Partial<LevelDef>) =>
    level({
      tribes: [{}, { ai: "turtle" }],
      buildings: undefined,
      setup: [
        { spawn: "hearth", tribe: 0, at: [16, 32] },
        { spawn: "shaper", tribe: 0, at: [20, 30] },
        { spawn: "settler", tribe: 0, near: [20, 36], count: 4 },
        { spawn: "hearth", tribe: 1, at: [48, 32] },
        { spawn: "shaper", tribe: 1, at: [46, 30] },
        { spawn: "reliquary", at: [26, 32], site: { tag: "hill", rewards: [] } },
      ],
      map: { generator: "flat", size: 64, landAboveSea: 30 },
      objectives: [{ type: "victory" }],
      triggers: [],
      ...over,
    });

  // a rival that never acts (the AI is not under test here)
  const idleAi = (spec: { tribe: number }) => ({ tribe: spec.tribe, every: 1000, offset: 0, decide: () => [] });
  const makeDuel = (def: LevelDef) => createLevelWorld({ def }, basePack().files, basePack().hash, idleAi);

  it("a level with rules wins when the player wins them and is outplayed when a rival does", () => {
    for (const [tribe, outcome, why] of [[0, OUTCOME.won, "objectives"], [1, OUTCOME.lost, "outplayed"]] as const) {
      const w = makeDuel(duel({ rules: "king_of_hill" }));
      expect(w.rules?.def.type).toBe("kingOfHill");
      // presence only counts once a second: stand people at the hill and fast-forward the score
      w.rules!.held[tribe] = w.rules!.goalTicks() - w.cfg.tickHz;
      w.step([{ tick: 0, tribe, type: "move", args: { units: `tribe${tribe}.${tribe ? "shapers" : "settlers"}`, to: [26, 32] } }]);
      w.run(20 * w.cfg.tickHz);
      expect(w.rules!.winner).toBe(tribe);
      expect(w.level!.outcome).toBe(outcome);
      expect(w.eventCounts.get(outcome === OUTCOME.won ? "levelWon" : "levelLost")).toBe(1);
      expect(w.level!.endedAt).toBe(w.rules!.endedAt);
      if (outcome === OUTCOME.lost) expect([...w.recent].reverse().find((e) => e.type === "levelLost")?.why).toBe(why);
    }
  });

  it("a level with a Forge freezes its timers until the Forge ends; saves keep rules and Forge", () => {
    const def = duel({ forge: true, rules: "hold_sites", objectives: [{ type: "victory" }], lose: [{ type: "timeLimit", seconds: 3 }] });
    const w = makeDuel(def);
    expect(w.forge?.running()).toBe(true);
    w.run(10 * w.cfg.tickHz);
    expect(w.level!.outcome).toBe(OUTCOME.none);
    const p = basePack();
    const r = World.restore(levelWorldInit({ def }, p.files, p.hash), w.snapshot());
    expect(r.forge?.running()).toBe(true);
    expect(r.rules?.def.id).toBe("hold_sites");
    expect(r.hash().all).toBe(w.hash().all);
    for (const x of [w, r]) {
      x.step([{ tick: x.tick, tribe: 0, type: "forgeReady", args: {} }, { tick: x.tick, tribe: 1, type: "forgeReady", args: {} }]);
      x.run(3 * x.cfg.tickHz + 2);
      expect(x.level!.outcome).toBe(OUTCOME.lost);
      expect(x.level!.endedAt).toBe(x.forge!.endedAt + 3 * x.cfg.tickHz - 1);
    }
    expect(r.hash().all).toBe(w.hash().all);
  });

  it("validateLevel checks rules and the victory objective", () => {
    const ok = duel({ rules: "hold_sites" });
    const msgs = (over: object) => validateLevel({ ...ok, ...over }, basePack().files).issues.map((i) => i.message);
    expect(msgs({ rules: undefined })).toContain("a victory objective needs level rules");
    expect(msgs({ rules: "nope" })).toContain("unknown victory rules nope");
    expect(msgs({ rules: "hold_sites", forge: true })).toEqual([]);
    expect(msgs({ rules: "king_of_hill", setup: ok.setup.filter((s) => !s.site) })).toContain("king_of_hill needs a worship site to hold");
  });
});

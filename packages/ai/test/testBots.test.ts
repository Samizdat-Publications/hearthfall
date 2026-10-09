import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { RandomLegalBot, SpellSpammerBot, makeBot } from "../src/index.ts";

function match(bot: string, seed: number, minutes: number) {
  const p = basePack();
  const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
  const b = makeBot({ type: bot, tribe: 0, offset: 0 });
  w.controllers.push(b, makeBot({ type: "opponent", tribe: 1, personality: "aggressive", offset: 1 }));
  for (let t = 0; t < minutes * 60 * w.cfg.tickHz; t++) {
    w.step([]);
    const v = w.invariants();
    if (v.length) throw new Error(`${bot} tick ${w.tick}: ${v[0]}`);
  }
  return { w, b };
}

describe("test bots (M7)", () => {
  it("the random legal bot fuzzes the whole Command API without breaking invariants, deterministically", () => {
    const { w, b } = match("randomLegal", 1005, 4);
    const issued = (b as RandomLegalBot).stats.issued;
    expect(Object.keys(issued).length).toBeGreaterThanOrEqual(12);
    expect(w.eventCounts.get("commandRejected") ?? 0).toBeGreaterThan(0);
    expect(match("randomLegal", 1005, 1).w.hash()).toEqual(match("randomLegal", 1005, 1).w.hash());
  }, 60000);

  it("the spell spammer casts several spell types at the enemy", () => {
    const { w, b } = match("spellSpammer", 1006, 6);
    expect(Object.keys((b as SpellSpammerBot).stats.casts).length).toBeGreaterThanOrEqual(2);
    expect(w.eventCounts.get("spellCast") ?? 0).toBeGreaterThan(2);
  }, 60000);

  it("the rusher attacks early and the turtle bot never leaves home", () => {
    // BACKLOG 0c: the lodge waits on stone too, so the first wave lands in minute 7
    const r = match("rusher", 1007, 7).b as unknown as { stats: { waves: number } };
    const t = match("turtleBot", 1007, 6).b as unknown as { stats: { waves: number; actions: Record<string, number> } };
    expect(r.stats.waves).toBeGreaterThan(0);
    expect(t.stats.waves).toBe(0);
    expect(t.stats.actions.buildTower ?? 0).toBeGreaterThan(0);
  }, 60000);
});

describe("economy bot sites (BACKLOG 0a terraces, economy soak seed 1003)", () => {
  it("picks the spot with the least flattening over its first two rings, on level ground the nearest", async () => {
    const { EconomyBot } = await import("../src/economyBot.ts");
    const p = basePack();
    const make = () => {
      const w = new World({ pack: p.files, packHash: p.hash, seed: 1, map: { generator: "flat", size: 64, tribes: 1 } });
      w.spawnBuilding("hearth", 0, 32, 32);
      return w;
    };
    const bot = new EconomyBot({ tribe: 0 });
    const flat = make();
    const d = flat.cfg.buildingIndex.get("dwelling")!;
    const a = bot.findSpot(flat, "dwelling", 32, 32)!;
    expect(Math.hypot(a[0] - 32, a[1] - 32)).toBeLessThan(5.5);
    // tilt everything but a western wedge: the bot leaves the first spot it would have found for level ground
    const w = make();
    const t = w.terrain;
    const land = t.get(5, 5);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (x >= 30) t.heights[t.idx(x, y)] = land + 5 * (x - 29);
    t.version++;
    const b = bot.findSpot(w, "dwelling", 32, 32)!;
    expect(w.economy.planBlocker(d, b[0], b[1])).toBeNull();
    expect(w.economy.flattenWork(d, b[0], b[1])).toBe(0);
    expect(Math.hypot(b[0] - 32, b[1] - 32)).toBeLessThan(6.5);
  });
});

describe("stone buildings (BACKLOG 0c)", () => {
  it("the bots find no site for a tower without a rock in reach, and one once a rock stands nearby", async () => {
    const { EconomyBot } = await import("../src/economyBot.ts");
    const p = basePack();
    const w = new World({ pack: p.files, packHash: p.hash, seed: 1, map: { generator: "flat", size: 64, tribes: 1 } });
    w.spawnBuilding("hearth", 0, 32, 32);
    const bot = new EconomyBot({ tribe: 0 });
    expect(bot.findSpot(w, "watchtower", 32, 32)).toBeNull();
    expect(bot.findSpot(w, "dwelling", 32, 32)).not.toBeNull();
    w.spawnRock(44, 44);
    const s = bot.findSpot(w, "watchtower", 32, 32)!;
    expect(w.economy.planBlocker(w.cfg.buildingIndex.get("watchtower")!, s[0], s[1])).toBeNull();
  });
});

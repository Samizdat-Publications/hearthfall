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
    const r = match("rusher", 1007, 6).b as unknown as { stats: { waves: number } };
    const t = match("turtleBot", 1007, 6).b as unknown as { stats: { waves: number; actions: Record<string, number> } };
    expect(r.stats.waves).toBeGreaterThan(0);
    expect(t.stats.waves).toBe(0);
    expect(t.stats.actions.buildTower ?? 0).toBeGreaterThan(0);
  }, 60000);
});

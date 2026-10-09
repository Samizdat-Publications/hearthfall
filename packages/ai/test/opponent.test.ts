import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { basePack, world } from "../../sim/test/helpers.ts";
import { OpponentAI, makeBot, type Personality } from "../src/index.ts";

function vsIdle(personality: string, seed: number, minutes: number): { w: World; ai: OpponentAI } {
  const p = basePack();
  const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
  const ai = makeBot({ type: "opponent", tribe: 0, personality }) as OpponentAI;
  w.controllers.push(ai);
  for (let t = 0; t < minutes * 60 * w.cfg.tickHz && w.tribes[1].alive; t++) {
    w.step([]);
    const v = w.invariants();
    if (v.length) throw new Error(`tick ${w.tick}: ${v[0]}`);
  }
  return { w, ai };
}

const bold: Personality = { id: "test_bold", economyTargetPop: 20, armyMix: { warden: 1 }, aggression: 1, firstAttackMinute: 0, spellPrefs: ["raise_land", "bolt"], scouting: 0, towerAffinity: 0 };

describe("OpponentAI (M7)", () => {
  it("the aggressive personality builds lodges, trains, casts and eliminates an idle tribe", () => {
    const { w, ai } = vsIdle("aggressive", 1001, 25);
    expect(w.tribes[1].alive).toBe(false);
    expect(w.tick / (60 * w.cfg.tickHz)).toBeLessThan(25);
    expect(ai.stats.actions.buildLodge).toBeGreaterThan(0);
    expect(ai.stats.waves).toBeGreaterThan(0);
    expect(Object.keys(ai.stats.casts).length).toBeGreaterThan(0);
    expect(ai.stats.scoutedAtTick).toBeGreaterThan(0);
  }, 60000);

  it("personality data drives the plan: the turtle attacks later and builds more towers than the aggressor", () => {
    const a = vsIdle("aggressive", 1002, 25).ai.stats;
    const t = vsIdle("turtle", 1002, 25).ai.stats;
    expect(t.actions.buildTower ?? 0).toBeGreaterThan(a.actions.buildTower ?? 0);
    expect(t.decisions).toBeGreaterThan(a.decisions);
  }, 60000);

  it("difficulty sets the decision cadence from reactionSeconds", () => {
    expect(new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "easy" }).every).toBe(120);
    expect(new OpponentAI({ tribe: 0, personality: "turtle" }).every).toBe(60);
    expect(new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "hard" }).every).toBe(30);
  });

  it("opponent matches are deterministic", () => {
    const run = () => {
      const p = basePack();
      const w = new World({ pack: p.files, packHash: p.hash, seed: 1004, map: { generator: "continents", size: 128, tribes: 2 } });
      w.controllers.push(makeBot({ type: "opponent", tribe: 0, personality: "sneaky", offset: 0 }), makeBot({ type: "opponent", tribe: 1, personality: "aggressive", offset: 1 }));
      w.run(3 * 60 * 20);
      return w.hash();
    };
    expect(run()).toEqual(run());
  }, 60000);

  it("with no walkable route to the enemy the Shaper raises land across the water", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnBuilding("hearth", 1, 44, 32);
    w.spawnUnit("shaper", 0, 14, 34);
    w.spawnUnit("shaper", 1, 46, 34);
    for (let k = 0; k < 4; k++) w.spawnUnit("warden", 0, 16 + k, 28);
    for (let k = 0; k < 8; k++) w.spawnUnit("settler", 0, 8 + k, 38);
    const t = w.terrain;
    for (let y = 0; y < 64; y++) for (const x of [28, 29, 30, 60, 61, 62]) t.heights[t.idx(x, y)] = 0;
    t.version++;
    w.tribes[0].eco.charges[w.cfg.spellIndex.get("raise_land")!] = 2;
    const ai = new OpponentAI({ tribe: 0, personality: bold, difficulty: "hard" });
    w.controllers.push(ai);
    const comp = (x: number, y: number) => w.units.pf.comp[w.units.pf.nearestWalkable(t.idx(x, y), 6)];
    w.step([]);
    expect(comp(12, 34)).not.toBe(comp(44, 34));
    let cast = false;
    for (let k = 0; k < 60 * 20 && !cast; k++) {
      w.step([]);
      cast = w.events.some((e) => e.type === "spellCast" && e.spell === "raise_land");
    }
    expect(ai.stats.bridges).toBeGreaterThan(0);
    expect(cast).toBe(true);
    w.step([]);
    w.units.pf.refresh();
    expect(comp(12, 34)).toBe(comp(44, 34));
  }, 30000);

  it("a hurt Shaper is pulled back to the Hearth and covered by idle troops", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnBuilding("hearth", 1, 44, 32);
    const s = w.ents.index(w.spawnUnit("shaper", 0, 30, 32));
    w.spawnUnit("shaper", 1, 46, 34);
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 0, 14 + k, 28);
    w.step([]);
    w.ents.hp[s] = 10;
    const ai = new OpponentAI({ tribe: 0, personality: "turtle" });
    const out = ai.decide(w);
    const moves = out.filter((c) => c.type === "move");
    expect(moves.some((c) => (c.args.units as number[]).includes(w.ents.idOf(s)) && !c.args.attack)).toBe(true);
    expect(moves.some((c) => c.args.attack && (c.args.units as number[]).length === 3)).toBe(true);
    expect(ai.stats.actions.protectShaper).toBe(1);
  });

  it("tower minded personalities post one sentinel per tower, and fill the towers when enemies reach the Hearth", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnBuilding("hearth", 1, 44, 32);
    w.spawnUnit("shaper", 0, 10, 36);
    w.spawnUnit("shaper", 1, 46, 34);
    const tower = w.ents.index(w.spawnBuilding("watchtower", 0, 16, 32));
    for (let k = 0; k < 4; k++) w.spawnUnit("warden", 0, 14 + k, 28);
    w.step([]);
    const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "hard" });
    const garrisons = () => ai.decide(w).filter((c) => c.type === "garrison");
    const calm = garrisons();
    expect(calm.length).toBe(1);
    expect((calm[0].args.units as number[]).length).toBe(1);
    expect(calm[0].args.building).toBe(w.ents.idOf(tower));
    // raiders at the Hearth: the tower takes a full garrison
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 1, 20 + k, 36);
    const alarm = garrisons();
    expect((alarm[0].args.units as number[]).length).toBe(w.combat.garrisonOf(w.ents.type[tower]));
  });
});


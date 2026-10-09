import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { CAT } from "../../sim/src/entities.ts";
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

  it("difficulty sets the decision cadence from reactionSeconds in data", () => {
    const w = world({ generator: "flat", size: 32, tribes: 2 });
    for (const d of w.cfg.pack.ai.difficulties) {
      const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty: d.id });
      ai.decide(w);
      expect(ai.period).toBe(Math.round(d.reactionSeconds * w.cfg.tickHz));
    }
    expect(w.cfg.pack.ai.difficulties.map((d) => d.id)).toContain("brutal");
    // decisions land only on tick % period === offset
    const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "hard", offset: 3 });
    w.spawnBuilding("hearth", 0, 8, 8);
    w.spawnUnit("shaper", 0, 10, 10);
    const ran: number[] = [];
    for (let k = 0; k < 70; k++) {
      const before = ai.stats.decisions;
      ai.decide(w);
      if (ai.stats.decisions > before) ran.push(w.tick);
      w.step([]);
    }
    expect(ran).toEqual([3, 33, 63]);
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

  it("a personality without a bridge spell in its prefs still charges one once the enemy is out of reach (regression, ai-idle soak seed 1003)", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnUnit("shaper", 0, 14, 34);
    w.spawnUnit("shaper", 1, 46, 34);
    for (let k = 0; k < 5; k++) w.spawnUnit("warden", 0, 16 + k, 28);
    const t = w.terrain;
    for (let y = 0; y < 64; y++) for (const x of [28, 29, 30, 60, 61, 62]) t.heights[t.idx(x, y)] = 0;
    t.version++;
    w.step([]);
    const ai = new OpponentAI({ tribe: 0, personality: { ...bold, spellPrefs: ["bolt"] }, every: 1 });
    const charged = () => ai.decide(w).some((c) => c.type === "setAutoCharge" && c.args.spell === "raise_land" && c.args.on);
    expect(charged()).toBe(false);
    expect(charged()).toBe(true);
  });

  it("a tribe whose Hearth fell is hunted down through its Shaper (regression, ai-idle soak seed 1000)", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnUnit("shaper", 0, 13, 34);
    // tribe 1 has no Hearth left, only its Shaper, so it is still alive
    const enemy = w.ents.index(w.spawnUnit("shaper", 1, 40, 20));
    for (let k = 0; k < 5; k++) w.spawnUnit("warden", 0, 14 + k, 28);
    w.step([]);
    expect(w.tribes[1].alive).toBe(true);
    const ai = new OpponentAI({ tribe: 0, personality: bold, every: 1 });
    const out = ai.decide(w);
    const wave = out.find((c) => c.type === "move" && c.args.attack);
    expect(wave).toBeDefined();
    const [x, y] = wave!.args.to as number[];
    expect(Math.abs(x - w.ents.x[enemy]) + Math.abs(y - w.ents.y[enemy])).toBeLessThan(2);
  });

  it("a hunted Shaper stranded out of reach on foot is struck down with a Shaper-killing spell (regression, ai-idle soak seed 1003)", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnUnit("shaper", 0, 14, 34);
    const enemy = w.ents.index(w.spawnUnit("shaper", 1, 44, 32));
    for (let k = 0; k < 5; k++) w.spawnUnit("warden", 0, 16 + k, 28);
    // a moat around a 3 by 3 island holding the Hearthless tribe's Shaper
    const t = w.terrain;
    for (let y = 27; y <= 37; y++) for (let x = 39; x <= 49; x++) if (Math.max(Math.abs(x - 44), Math.abs(y - 32)) >= 2 && Math.max(Math.abs(x - 44), Math.abs(y - 32)) <= 4) t.heights[t.idx(x, y)] = 0;
    t.version++;
    w.tribes[0].eco.charges[w.cfg.spellIndex.get("lightning")!] = 2;
    const ai = new OpponentAI({ tribe: 0, personality: { ...bold, spellPrefs: ["lightning"] }, difficulty: "hard" });
    w.controllers.push(ai);
    let struck = false;
    for (let k = 0; k < 90 * 20 && w.tribes[1].alive; k++) {
      w.step([]);
      struck ||= w.events.some((e) => e.type === "spellCast" && e.spell === "lightning");
    }
    expect(struck).toBe(true);
    expect(w.ents.alive[enemy] === 1 && w.ents.tribe[enemy] === 1).toBe(false);
    expect(w.tribes[1].alive).toBe(false);
  }, 30000);

  it("no spell is aimed beyond range at a cluster on another landmass (regression, ai soak seed 1002)", () => {
    const castAt = (moat: boolean) => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 12, 32);
      w.spawnBuilding("hearth", 1, 56, 32);
      w.spawnUnit("shaper", 0, 24, 32);
      w.spawnUnit("shaper", 1, 58, 32);
      for (let k = 0; k < 3; k++) w.spawnUnit("warden", 1, 33 + k * 0.5, 32);
      if (moat) {
        const t = w.terrain;
        for (let y = 26; y <= 38; y++) for (let x = 28; x <= 40; x++) if (Math.max(Math.abs(x - 34), Math.abs(y - 32)) >= 3 && Math.max(Math.abs(x - 34), Math.abs(y - 32)) <= 5) t.heights[t.idx(x, y)] = 0;
        t.version++;
      }
      w.step([]);
      w.tribes[0].eco.charges[w.cfg.spellIndex.get("bolt")!] = 2;
      const ai = new OpponentAI({ tribe: 0, personality: { ...bold, spellPrefs: ["bolt"], firstAttackMinute: 99 }, every: 1 });
      return ai.decide(w).some((c) => c.type === "cast");
    };
    expect(castAt(false)).toBe(true);
    expect(castAt(true)).toBe(false);
  });

  it("a hurt Shaper is pulled back to the Hearth and covered by idle troops", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnBuilding("hearth", 1, 44, 32);
    const s = w.ents.index(w.spawnUnit("shaper", 0, 30, 32));
    w.spawnUnit("shaper", 1, 46, 34);
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 0, 14 + k, 28);
    w.step([]);
    w.ents.hp[s] = 10;
    const ai = new OpponentAI({ tribe: 0, personality: "turtle", every: 1 });
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
    const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "hard", every: 1 });
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

  it("a personality with shades builds a Shade Den, keeps two Shades and sends them at enemy buildings (BACKLOG 2)", () => {
    // the sneaky data minus its waves, with Shades from minute 2, against an economy bot that builds
    const p = basePack();
    const sneaky = p.files.ai.personalities.find((x) => x.id === "sneaky")!;
    expect(sneaky.shades?.count).toBeGreaterThan(0);
    const spy: Personality = { ...sneaky, id: "test_spy", firstAttackMinute: 99, shades: { count: 2, fromMinute: 2 } };
    const w = new World({ pack: p.files, packHash: p.hash, seed: 1003, map: { generator: "continents", size: 128, tribes: 2 } });
    const ai = makeBot({ type: "opponent", tribe: 0, personality: spy }) as OpponentAI;
    w.controllers.push(ai, makeBot({ type: "economy", tribe: 1 }));
    let maxShades = 0;
    for (let t = 0; t < 18 * 60 * w.cfg.tickHz; t++) {
      w.step([]);
      if (t % 300 === 0) maxShades = Math.max(maxShades, w.count((i) => w.ents.tribe[i] === 0 && w.combat.isSaboteur(w.ents.type[i]) && w.ents.cat[i] === CAT.unit));
    }
    expect(w.invariants()).toEqual([]);
    expect(ai.stats.actions.buildDen).toBeGreaterThan(0);
    expect(maxShades).toBe(2);
    expect(ai.stats.sabotages ?? 0).toBeGreaterThan(0);
    expect(w.eventCounts.get("sabotaged") ?? 0).toBeGreaterThan(0);
    // personalities without shades never score the Shade actions
    const t = vsIdle("turtle", 1003, 12).ai.stats;
    expect(t.actions.buildDen ?? 0).toBe(0);
  }, 90000);
});

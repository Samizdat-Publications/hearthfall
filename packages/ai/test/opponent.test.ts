import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { CAT } from "../../sim/src/entities.ts";
import { TASK } from "../../sim/src/economy.ts";
import { STANCE } from "../../sim/src/combat.ts";
import { basePack, world } from "../../sim/test/helpers.ts";
import { OpponentAI, makeBot, type Personality } from "../src/index.ts";
import { AI_SHARED_DEFAULTS, type LevelDef } from "@hearthfall/data";
import { createLevelWorld } from "../../sim/src/level.ts";

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
  // BACKLOG 87: a locked spell may be cast from charges anywhere (spells.ts), which only matters in levels;
  // a skirmish must never hand out charges of a spell its tribe has not unlocked
  it("in a skirmish no tribe ever holds charges of a locked spell", () => {
    const p = basePack();
    const w = new World({ pack: p.files, packHash: p.hash, seed: 1003, map: { generator: "continents", size: 128, tribes: 2 } });
    w.controllers.push(makeBot({ type: "opponent", tribe: 0, personality: "aggressive" }), makeBot({ type: "opponent", tribe: 1, personality: "turtle", offset: 1 }));
    const bad: string[] = [];
    let charged = 0;
    for (let t = 0; t < 12 * 60 * w.cfg.tickHz && bad.length === 0; t++) {
      w.step([]);
      charged += w.events.filter((e) => e.type === "charged").length;
      if (t % 20) continue;
      for (const tr of w.tribes) tr.eco.charges.forEach((c, s) => c > 0 && !tr.eco.unlocked[s] && bad.push(`tick ${w.tick} tribe ${tr.index} holds ${c} of locked spell ${s}`));
    }
    expect(bad).toEqual([]);
    expect(charged).toBeGreaterThan(0);
  });

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

  it("BACKLOG 23: setFocus leans the AI toward one action for a while, saves with the state and rejects unknown actions", () => {
    const run = (focus: string | null) => {
      const p = basePack();
      const w = new World({ pack: p.files, packHash: p.hash, seed: 1002, map: { generator: "continents", size: 128, tribes: 2 } });
      const ai = makeBot({ type: "opponent", tribe: 0, personality: "aggressive" }) as OpponentAI;
      w.controllers.push(ai);
      for (let t = 0; t < 8 * 60 * w.cfg.tickHz; t++) {
        if (focus && t % (30 * w.cfg.tickHz) === 0) ai.setFocus(focus, w.tick + 30 * w.cfg.tickHz);
        w.step([]);
      }
      return ai;
    };
    const plain = run(null);
    const towers = run("buildTower");
    expect(towers.stats.actions.buildTower ?? 0).toBeGreaterThan(plain.stats.actions.buildTower ?? 0);
    const st = towers.saveState();
    expect(st.focus?.[0]).toBe("buildTower");
    const copy = makeBot({ type: "opponent", tribe: 0, personality: "aggressive" }) as OpponentAI;
    copy.loadState(JSON.parse(JSON.stringify(st)));
    expect(copy.saveState()).toEqual(st);
    expect(() => towers.setFocus("fly_to_moon", 10)).toThrow();
  }, 60000);

  it("BACKLOG 69: the shared AI numbers come from ai_personalities.json shared (older packs: the old literals)", () => {
    const p = basePack();
    const { $comment: _c, ...shipped } = p.files.ai.shared!;
    expect(shipped).toEqual(AI_SHARED_DEFAULTS);
    const sizeWith = (shared: Record<string, number> | undefined) => {
      const files = structuredClone(p.files);
      if (shared) files.ai.shared = { ...AI_SHARED_DEFAULTS, ...shared };
      else delete files.ai.shared;
      const w = new World({ pack: files, packHash: p.hash, seed: 1, map: { generator: "flat", size: 32, tribes: 2 } });
      const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty: "normal" });
      ai.decide(w);
      return (ai as unknown as { waveSize(): number; keep(): number }).waveSize() * 1000 + (ai as unknown as { keep(): number }).keep();
    };
    expect(sizeWith(undefined)).toBe(sizeWith({}));
    expect(sizeWith({ waveBase: 6 })).toBe(sizeWith({}) + 2000);
    expect(sizeWith({ keepMin: 90 }) % 1000).toBe(90);
  });

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

  it("a difficulty with a resource multiplier applies it to its own tribe's income through the sim (BACKLOG 6)", () => {
    for (const [difficulty, want] of [["brutal", 1.25], ["normal", 1]] as const) {
      const w = world({ generator: "flat", size: 48, tribes: 2 });
      w.spawnBuilding("hearth", 1, 30, 30);
      w.spawnUnit("shaper", 1, 32, 32);
      w.controllers.push(makeBot({ type: "opponent", tribe: 1, personality: "turtle", difficulty, offset: 0 }));
      for (let k = 0; k < 70; k++) w.step([]);
      expect(w.tribes[1].eco.incomeMult).toBe(want);
      expect(w.tribes[0].eco.incomeMult).toBe(1);
    }
    expect(world({ generator: "flat", size: 32, tribes: 2 }).cfg.pack.ai.difficulties.find((d) => d.id === "brutal")!.resourceMultiplier).toBe(1.25);
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

  it("BACKLOG 67: stats count waves that reached their target, and saves keep the watched waves", () => {
    const p = basePack();
    const w = new World({ pack: p.files, packHash: p.hash, seed: 1004, map: { generator: "continents", size: 128, tribes: 2 } });
    const bots = [makeBot({ type: "opponent", tribe: 0, personality: "sneaky", offset: 0 }), makeBot({ type: "opponent", tribe: 1, personality: "aggressive", offset: 1 })] as OpponentAI[];
    w.controllers.push(...bots);
    w.run(15 * 60 * 20);
    const waves = bots.reduce((s, b) => s + b.stats.waves, 0);
    const arrived = bots.reduce((s, b) => s + (b.stats.wavesArrived ?? 0), 0);
    expect(arrived).toBeGreaterThan(0);
    expect(arrived).toBeLessThanOrEqual(waves);
    const st = bots[1].saveState();
    const copy = new OpponentAI({ tribe: 1, personality: "aggressive" });
    copy.loadState(JSON.parse(JSON.stringify(st)));
    expect(copy.saveState()).toEqual(st);
  }, 60000);

  it("BACKLOG 88: worshipAfterSeconds holds the AI's worshippers until then, whatever its settler count", () => {
    const firstWorship = (after?: number) => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 10, 32);
      w.spawnBuilding("hearth", 1, 50, 32);
      w.spawnUnit("shaper", 1, 52, 34);
      for (let k = 0; k < 14; k++) w.spawnUnit("settler", 1, 46 + (k % 7), 36 + Math.floor(k / 7));
      w.worship.addSite("shrine", 40, 32, { tag: "s", worshippers: 4, prayerSeconds: 45, rewards: [] });
      w.controllers.push(makeBot({ type: "opponent", tribe: 1, personality: "turtle", offset: 0, ...(after !== undefined ? { worshipAfterSeconds: after } : {}) }));
      const E = w.ents;
      for (let t = 0; t < 3000; t++) {
        w.step([]);
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.tribe[i] === 1 && (E.task[i] === TASK.toWorship || E.task[i] === TASK.worship)) return w.tick;
      }
      return -1;
    };
    const free = firstWorship();
    const held = firstWorship(60);
    expect(free).toBeGreaterThan(0);
    expect(free).toBeLessThan(60 * 20);
    expect(held).toBeGreaterThanOrEqual(60 * 20);
  });

  it("S3: a site held by enemy guardians gets troops first and worshippers only once it is clear", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 8, 32);
    w.spawnBuilding("hearth", 1, 50, 32);
    w.spawnUnit("shaper", 1, 52, 34);
    for (let k = 0; k < 14; k++) w.spawnUnit("settler", 1, 46 + (k % 7), 36 + Math.floor(k / 7));
    for (let k = 0; k < 6; k++) w.spawnUnit("warden", 1, 44 + (k % 3), 30 + Math.floor(k / 3));
    w.worship.addSite("shrine", 38, 32, { tag: "s", worshippers: 4, prayerSeconds: 45, rewards: [] });
    const E = w.ents;
    const guards = [0, 1].map((k) => w.spawnUnit("warden", 0, 38 + k, 33));
    for (const g of guards) E.stance[E.index(g)] = STANCE.defensive;
    // the AI reads its tribe's vision, which the first steps fill in
    for (let t = 0; t < 5; t++) w.step([]);
    w.controllers.push(makeBot({ type: "opponent", tribe: 1, personality: "turtle", offset: 0, worshipAfterSeconds: 0 }));
    let prayedWhileGuarded = false;
    let prayed = -1;
    for (let t = 0; t < 4000 && prayed < 0; t++) {
      w.step([]);
      const held = guards.some((g) => E.index(g) >= 0);
      for (let i = 0; i < E.hi; i++)
        if (E.alive[i] && E.tribe[i] === 1 && (E.task[i] === TASK.toWorship || E.task[i] === TASK.worship)) {
          if (held) prayedWhileGuarded = true;
          prayed = w.tick;
        }
    }
    expect(prayedWhileGuarded).toBe(false);
    expect(guards.every((g) => E.index(g) < 0)).toBe(true);
    expect(prayed).toBeGreaterThan(0);
  });

  it("S3: a wolf den by a site is cleared by troops before any worshipper goes", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 8, 32);
    w.spawnBuilding("hearth", 1, 50, 32);
    w.spawnUnit("shaper", 0, 8, 36);
    w.spawnUnit("shaper", 1, 52, 34);
    for (let k = 0; k < 14; k++) w.spawnUnit("settler", 1, 46 + (k % 7), 36 + Math.floor(k / 7));
    for (let k = 0; k < 6; k++) w.spawnUnit("warden", 1, 44 + (k % 3), 30 + Math.floor(k / 3));
    w.worship.addSite("shrine", 36, 32, { tag: "s", worshippers: 4, prayerSeconds: 45, rewards: [] });
    w.beasts.addDen("wolf", 34, 33, 3);
    const E = w.ents;
    for (let t = 0; t < 5; t++) w.step([]);
    w.controllers.push(makeBot({ type: "opponent", tribe: 1, personality: "turtle", offset: 0, worshipAfterSeconds: 0 }));
    let prayedWithWolves = false;
    let prayed = -1;
    for (let t = 0; t < 5000 && prayed < 0; t++) {
      w.step([]);
      const wolves = w.beasts.dens[0].members.length > 0 && !w.beasts.dens[0].cleared;
      for (let i = 0; i < E.hi; i++)
        if (E.alive[i] && E.tribe[i] === 1 && (E.task[i] === TASK.toWorship || E.task[i] === TASK.worship)) {
          if (wolves) prayedWithWolves = true;
          prayed = w.tick;
        }
    }
    expect(prayedWithWolves).toBe(false);
    expect(w.beasts.dens[0].cleared).toBe(true);
    expect(prayed).toBeGreaterThan(0);
  });

  it("S3: idle troops clear a wolf den near home, with no worship site in sight", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 8, 32);
    w.spawnBuilding("hearth", 1, 50, 32);
    w.spawnUnit("shaper", 0, 8, 36);
    w.spawnUnit("shaper", 1, 52, 34);
    for (let k = 0; k < 6; k++) w.spawnUnit("warden", 1, 44 + (k % 3), 30 + Math.floor(k / 3));
    w.beasts.addDen("wolf", 32, 22, 3);
    w.controllers.push(makeBot({ type: "opponent", tribe: 1, personality: "turtle", offset: 0 }));
    for (let t = 0; t < 4000 && !w.beasts.dens[0].cleared; t++) w.step([]);
    expect(w.beasts.dens[0].cleared).toBe(true);
  });

  it("S3: a grown village plans a Spirit Well, and a Mending Hut once it fields troops", () => {
    const plans = (troops: number) => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 20, 32);
      w.spawnBuilding("hearth", 1, 56, 32);
      w.spawnUnit("shaper", 0, 22, 32);
      w.spawnUnit("shaper", 1, 58, 32);
      for (let k = 0; k < 4; k++) w.spawnRock(14 + k * 2, 24, 16);
      for (let k = 0; k < 12; k++) w.spawnTree(8 + (k % 4) * 2, 18 + Math.floor(k / 4) * 2);
      for (let k = 0; k < 30; k++) w.spawnUnit("settler", 0, 14 + (k % 10), 38 + Math.floor(k / 10));
      for (let k = 0; k < troops; k++) w.spawnUnit("warden", 0, 26 + (k % 3), 28 + Math.floor(k / 3));
      w.controllers.push(makeBot({ type: "opponent", tribe: 0, personality: "turtle", offset: 0 }));
      const E = w.ents;
      const out = new Set<string>();
      for (let t = 0; t < 2400; t++) {
        w.step([]);
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building && E.tribe[i] === 0) out.add(w.cfg.pack.buildings.buildings[E.type[i]].id);
      }
      return [...out];
    };
    // plenty of plan slots, so the test sees the choice and not the wood race (the pack is shared: restore it)
    const eco = world({ generator: "flat", size: 32, tribes: 1 }).cfg.pack.balance.economy as { maxOpenPlansPerTribe: number };
    const keep = eco.maxOpenPlansPerTribe;
    eco.maxOpenPlansPerTribe = 12;
    try {
      const built = plans(0);
      expect(built).toContain("spirit_well");
      expect(built).not.toContain("mending_hut");
    } finally {
      eco.maxOpenPlansPerTribe = keep;
    }
  });

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

  it("in a level, the bot playing tribe 0 sends its wave at an open destroy objective before the Hearth (stretch 3)", () => {
    const p = basePack();
    const def: LevelDef = {
      id: "destroy_test", name: "Destroy test", order: 99, description: "test", seed: 3,
      map: { generator: "flat", size: 64, landAboveSea: 20 },
      tribes: [{}, {}], spells: [],
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 32] }, { spawn: "shaper", tribe: 0, at: [13, 34] },
        { spawn: "hearth", tribe: 1, at: [50, 32] }, { spawn: "shaper", tribe: 1, at: [50, 35] },
        { spawn: "signal_pyre", tribe: 1, at: [32, 12] },
      ],
      objectives: [{ type: "destroy", tribe: 1, building: "signal_pyre" }],
    };
    const w = createLevelWorld({ def }, p.files, p.hash);
    for (let k = 0; k < 5; k++) w.spawnUnit("warden", 0, 14 + k, 28);
    w.step([]);
    let pi = -1;
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.cat[i] === CAT.building && w.ents.tribe[i] === 1 && w.ents.type[i] === w.cfg.buildingIndex.get("signal_pyre")) pi = i;
    expect(pi).toBeGreaterThanOrEqual(0);
    const ai = new OpponentAI({ tribe: 0, personality: bold, every: 1 });
    const wave = ai.decide(w).find((c) => c.type === "move" && c.args.attack);
    expect(wave).toBeDefined();
    const [x, y] = wave!.args.to as number[];
    expect(Math.abs(x - w.ents.x[pi]) + Math.abs(y - w.ents.y[pi])).toBeLessThan(2);
    // once the Pyre is gone the wave goes for the Hearth again
    w.kill(pi, "test");
    w.step([]);
    const next = new OpponentAI({ tribe: 0, personality: bold, every: 1 }).decide(w).find((c) => c.type === "move" && c.args.attack);
    expect((next!.args.to as number[])[0]).toBeCloseTo(w.ents.x[w.ents.index(w.tribes[1].hearth)], 0);
  });

  it("in a level, the bot playing tribe 0 hunts far dens of an open clearDens objective and walks its Shaper to a reach goal (stretch 3)", () => {
    const p = basePack();
    const def: LevelDef = {
      id: "goal_test", name: "Goal test", order: 99, description: "test", seed: 4,
      map: { generator: "flat", size: 128, landAboveSea: 20 },
      tribes: [{}], spells: [],
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 64] }, { spawn: "shaper", tribe: 0, at: [14, 66] },
        { spawn: "wolf", tribe: -1, at: [80, 64], count: 1 },
      ],
      objectives: [{ type: "clearDens", at: [80, 64], r: 6 }, { type: "reach", at: [100, 30], r: 3, after: 0 }],
    };
    const w = createLevelWorld({ def }, p.files, p.hash);
    for (let k = 0; k < 12; k++) w.spawnUnit("warden", 0, 16 + (k % 6), 58 + Math.floor(k / 6) * 2);
    w.step([]);
    const ai = new OpponentAI({ tribe: 0, personality: { ...bold, firstAttackMinute: 99 }, every: 1 });
    const hunt = ai.decide(w).find((c) => c.type === "move" && c.args.attack);
    expect(hunt?.args.to).toEqual([80, 64]);
    // the den falls: the reach stage opens and the Shaper heads for it
    for (const id of w.beasts.dens[0].members) w.damage(w.ents.index(id), 1e6, 0, true);
    for (let k = 0; k < 3; k++) w.step([]);
    expect(w.level!.done[0]).toBe(1);
    const shaper = w.tribes[0].shaper;
    const go = ai.decide(w).filter((c) => c.type === "move" && (c.args.units as number[]).includes(shaper));
    expect(go.map((c) => c.args.to)).toEqual([[100, 30]]);
  });

  it("S4: the level bot leaves a stone it lost twice to the enemy for a while, and the memory survives a save", () => {
    const p = basePack();
    const def: LevelDef = {
      id: "stone_test", name: "Stone test", order: 99, description: "test", seed: 4,
      map: { generator: "flat", size: 64, landAboveSea: 20 },
      tribes: [{}, {}], spells: [],
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 32] }, { spawn: "shaper", tribe: 0, at: [14, 34] },
        { spawn: "hearth", tribe: 1, at: [52, 32] }, { spawn: "shaper", tribe: 1, at: [50, 34] },
        { spawn: "settler", tribe: 0, near: [12, 36], count: 12 },
        { spawn: "ley_stone", at: [24, 32], site: { tag: "ley", rewards: [] } },
      ],
      objectives: [{ type: "hold", n: 1, seconds: 600 }],
    };
    const w = createLevelWorld({ def }, p.files, p.hash);
    w.step([]);
    const ai = new OpponentAI({ tribe: 0, personality: { ...bold, firstAttackMinute: 99 }, every: 1 });
    const s = w.worship.find("ley")!;
    const prays = () => ai.decide(w).some((c) => c.type === "worship" && c.args.site === "ley");
    expect(prays()).toBe(true);
    for (let k = 0; k < 2; k++) {
      s.lastBy = 0;
      ai.decide(w);
      s.lastBy = 1;
      w.step([]);
      ai.decide(w);
    }
    expect(prays()).toBe(false);
    const st = ai.saveState();
    expect(st.stones?.[0]?.[0]).toBe("ley");
    const again = new OpponentAI({ tribe: 0, personality: { ...bold, firstAttackMinute: 99 }, every: 1 });
    again.loadState(st);
    expect(again.saveState().stones).toEqual(st.stones);
    // after stoneGiveUpMinutes the stone is fair game again
    for (let k = 0; k < (AI_SHARED_DEFAULTS.stoneGiveUpMinutes ?? 3) * 60 * w.cfg.tickHz + 2; k++) w.step([]);
    expect(prays()).toBe(true);
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

  it("the spell is chosen by value at its best target, not as the first castable preference (BACKLOG 64)", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 12, 32);
    w.spawnBuilding("hearth", 1, 56, 32);
    w.spawnUnit("shaper", 0, 24, 32);
    w.spawnUnit("shaper", 1, 58, 32);
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 1, 30 + k * 0.5, 32);
    w.step([]);
    for (const id of ["bolt", "lightning"]) w.tribes[0].eco.charges[w.cfg.spellIndex.get(id)!] = 1;
    const ai = new OpponentAI({ tribe: 0, personality: { ...bold, spellPrefs: ["bolt", "lightning"], firstAttackMinute: 99 }, every: 1 });
    const cast = ai.decide(w).find((c) => c.type === "cast");
    expect((cast?.args as { spell?: string } | undefined)?.spell).toBe("lightning");
  });

  it("S3 handoff: traps and terrain spells have value, so Mire beats Bolt on a cluster and Erode aims at the village, not a lone hut", () => {
    const setup = () => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 12, 32);
      w.spawnBuilding("hearth", 1, 56, 32);
      w.spawnUnit("shaper", 0, 24, 32);
      w.spawnUnit("shaper", 1, 58, 32);
      return w;
    };
    const arm = (w: World, ids: string[]) => {
      for (const id of ids) {
        const s = w.cfg.spellIndex.get(id)!;
        w.tribes[0].eco.unlocked[s] = 1;
        w.tribes[0].eco.charges[s] = 1;
      }
    };
    const pick = (w: World, prefs: string[]) => {
      const ai = new OpponentAI({ tribe: 0, personality: { ...bold, spellPrefs: prefs, firstAttackMinute: 99 }, every: 1 });
      return ai.decide(w).find((c) => c.type === "cast")?.args as { spell?: string; target?: [number, number] } | undefined;
    };
    const a = setup();
    for (let k = 0; k < 3; k++) a.spawnUnit("warden", 1, 30 + k * 0.5, 32);
    a.step([]);
    arm(a, ["bolt", "mire"]);
    expect(pick(a, ["bolt", "mire"])?.spell).toBe("mire");
    const b = setup();
    b.spawnBuilding("dwelling", 1, 26, 40);
    for (const [x, y] of [[30, 26], [33, 26], [30, 23], [33, 23]]) b.spawnBuilding("dwelling", 1, x, y);
    b.step([]);
    arm(b, ["erode"]);
    const cast = pick(b, ["erode"]);
    expect(cast?.spell).toBe("erode");
    expect(cast!.target![1]).toBeLessThan(30);
  });

  it("a tower minded personality plans no tower before half its economy target (BACKLOG 64)", () => {
    const towerScore = (target: number) => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 20, 32);
      w.spawnBuilding("hearth", 1, 56, 32);
      w.spawnUnit("shaper", 0, 22, 32);
      w.spawnUnit("shaper", 1, 58, 32);
      for (let k = 0; k < 12; k++) w.spawnUnit("settler", 0, 16 + (k % 4), 28 + Math.floor(k / 4));
      w.spawnRock(26, 38);
      w.step([]);
      const ai = new OpponentAI({ tribe: 0, personality: { ...bold, towerAffinity: 1, towerFromPopShare: 0.5, economyTargetPop: target, firstAttackMinute: 99 }, every: 1 });
      const inner = ai as unknown as { init(w: World): void; census(w: World): unknown; towerScore(c: unknown): number };
      inner.init(w);
      return inner.towerScore(inner.census(w));
    };
    expect(towerScore(90)).toBe(0);
    expect(towerScore(20)).toBeGreaterThan(0);
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

  it("respects fog of war: a warband hidden near the Hearth draws no defense unless the difficulty has mapHack (BACKLOG 3)", () => {
    const run = (difficulty: string) => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      w.spawnBuilding("hearth", 0, 8, 8);
      w.spawnBuilding("hearth", 1, 44, 44);
      w.spawnUnit("shaper", 0, 6, 6);
      for (let k = 0; k < 6; k++) w.spawnUnit("settler", 0, 4 + k, 4);
      for (let k = 0; k < 3; k++) w.spawnUnit("warden", 0, 5 + k, 5);
      w.spawnUnit("settler", 1, 46, 46);
      // 13 cells from the Hearth: inside the AI's threat radius, outside every own sight disc
      const raiders = [0, 1, 2].map((k) => w.spawnUnit("warden", 1, 7 + k, 21));
      const ai = new OpponentAI({ tribe: 0, personality: "turtle", difficulty, every: 1 });
      w.controllers.push(ai);
      w.run(5);
      return { w, ai, raiders };
    };
    const normal = run("normal");
    expect(normal.w.vision.seesEntity(0, normal.w.ents.index(normal.raiders[0]))).toBe(false);
    expect(normal.ai.stats.actions.defend ?? 0).toBe(0);
    expect(run("brutal").ai.stats.actions.defend ?? 0).toBeGreaterThan(0);
  });

  // S4: a level world (64 cells, sea at x 26 to 38 and around x 0) whose only worship site, a shrine, stands on
  // the island east of the strait; the bot plays tribe 0 with 12 settlers on the home island
  const islandLevel = (extra: LevelDef["setup"], buildings?: string[]) => {
    const p = basePack();
    const def: LevelDef = {
      id: "isle_test", name: "Isle test", order: 99, description: "test", seed: 5,
      map: { generator: "flat", size: 64, landAboveSea: 20, paint: [{ shape: "rect", at: [32, 32], size: [12, 64], aboveSea: -30 }, { shape: "rect", at: [0, 32], size: [12, 64], aboveSea: -30 }] },
      tribes: [{}], spells: [], ...(buildings ? { buildings } : {}),
      setup: [
        { spawn: "hearth", tribe: 0, at: [16, 32] }, { spawn: "shaper", tribe: 0, at: [18, 34] },
        { spawn: "settler", tribe: 0, near: [14, 38], count: 12 },
        { spawn: "shrine", at: [48, 32], site: { tag: "isle", rewards: [] } },
        ...extra,
      ],
      objectives: [{ type: "worship", site: "isle" }],
    };
    const w = createLevelWorld({ def }, p.files, p.hash);
    w.step([]);
    return w;
  };
  const comp = (w: World, x: number, y: number) => w.units.pf.comp[w.units.pf.nearestWalkable(w.terrain.idx(Math.round(x), Math.round(y)), 3)];
  const calm: Personality = { ...bold, firstAttackMinute: 99, spellPrefs: [] };

  it("S4: with no home site left the AI ferries worshippers by boat to a site on another island and they pray there", () => {
    const w = islandLevel([{ spawn: "boat", tribe: 0, at: [30, 32] }]);
    const E = w.ents;
    const si = E.index(w.worship.find("isle")!.ent);
    expect(comp(w, 16, 32)).not.toBe(comp(w, E.x[si], E.y[si]));
    const ai = new OpponentAI({ tribe: 0, personality: calm, difficulty: "hard" });
    w.controllers.push(ai);
    let saved: ReturnType<OpponentAI["saveState"]> | null = null;
    let done = false;
    for (let t = 0; t < 4000 && !done; t++) {
      w.step([]);
      if (!saved && ai.saveState().trips?.length) saved = ai.saveState();
      done = w.events.some((e) => e.type === "worshipComplete" && e.site === "isle");
    }
    expect(w.eventCounts.get("boarded") ?? 0).toBeGreaterThanOrEqual(4);
    expect(ai.stats.ferries).toBeGreaterThan(0);
    expect(done).toBe(true);
    expect(w.eventCounts.get("drowned") ?? 0).toBe(0);
    expect(w.invariants()).toEqual([]);
    // the trip memory (worshippers on the way) survives a save
    expect(saved?.trips?.[0]?.[1]).toBe("isle");
    const copy = new OpponentAI({ tribe: 0, personality: calm, difficulty: "hard" });
    copy.loadState(JSON.parse(JSON.stringify(saved)));
    expect(copy.saveState()).toEqual(saved);
  }, 60000);

  it("S4: with no boat route the AI flies worshippers over by balloon, two at a time, but never raises a Skyloft just to pray", () => {
    // no vehicle yet: a Skyloft could stand (18 followers, stone and wood in reach) but prayer alone never raises one
    const bare = islandLevel([{ spawn: "rock", near: [10, 26], count: 2, spacing: 2 }, { spawn: "tree", near: [10, 44], count: 6, spacing: 1.2 }, { spawn: "settler", tribe: 0, near: [20, 26], count: 8 }], ["dwelling", "skyloft"]);
    const plan = new OpponentAI({ tribe: 0, personality: calm, every: 1 }).decide(bare);
    expect(plan.some((c) => c.type === "placePlan" && c.args.building === "skyloft")).toBe(false);
    expect(plan.some((c) => c.type === "placePlan" && c.args.building === "boathouse")).toBe(false);
    expect(plan.some((c) => c.type === "worship")).toBe(false);

    const w = islandLevel([{ spawn: "balloon", tribe: 0, at: [20, 30] }], ["dwelling", "skyloft"]);
    const ai = new OpponentAI({ tribe: 0, personality: calm, difficulty: "hard" });
    w.controllers.push(ai);
    const E = w.ents;
    let most = 0;
    let saved: ReturnType<OpponentAI["saveState"]> | null = null;
    let done = false;
    for (let t = 0; t < 8000 && !done; t++) {
      w.step([]);
      for (const ev of w.events) if (ev.type === "boarded") most = Math.max(most, E.occupants[E.index(ev.vehicle as number)]);
      if (!saved && ai.saveState().flights?.length) saved = ai.saveState();
      done = w.events.some((e) => e.type === "worshipComplete" && e.site === "isle");
    }
    expect(ai.stats.flights ?? 0).toBeGreaterThanOrEqual(2);
    expect(most).toBe(2);
    expect(done).toBe(true);
    expect(w.eventCounts.get("drowned") ?? 0).toBe(0);
    expect(w.invariants()).toEqual([]);
    expect(saved?.flights?.length).toBe(1);
    const copy = new OpponentAI({ tribe: 0, personality: calm, difficulty: "hard" });
    copy.loadState(JSON.parse(JSON.stringify(saved)));
    expect(copy.saveState()).toEqual(saved);
  }, 60000);

  it("S4: balloons someone else commands (a level script) are left alone", () => {
    const w = islandLevel([{ spawn: "balloon", tribe: 0, at: [20, 30] }], ["dwelling", "skyloft"]);
    const E = w.ents;
    let b = -1;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && w.vehicles.isVehicle(i)) b = i;
    // the script sends the balloon off before the AI ever decides
    w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: [E.idOf(b)], to: [24, 20] } }]);
    const ai = new OpponentAI({ tribe: 0, personality: calm, every: 1 });
    ai.decide(w);
    for (let t = 0; t < 200; t++) w.step([]);
    const out = ai.decide(w);
    expect(out.some((c) => c.type === "board")).toBe(false);
    expect(out.some((c) => c.type === "placePlan" && c.args.building === "skyloft")).toBe(false);
    expect(ai.saveState().foreign).toEqual([E.idOf(b)]);
  });
});

import { describe, expect, it } from "vitest";
import { CAT, NO_ENTITY } from "../src/entities.ts";
import { ORDER } from "../src/units.ts";
import { BSTATE, TASK } from "../src/economy.ts";
import { CMODE, STANCE } from "../src/combat.ts";
import { runMatchup } from "../src/matchup.ts";
import { basePack, world } from "./helpers.ts";

const cmd = (tribe: number, type: string, args: Record<string, unknown>) => [{ tick: 0, tribe, type, args }];

/** Two tribes on a flat map, each with a Hearth and a Shaper far from the action so nobody is eliminated. */
function arena(size = 64) {
  const w = world({ generator: "flat", size, tribes: 2 });
  w.spawnBuilding("hearth", 0, 2, 2);
  w.spawnBuilding("hearth", 1, size / 2 + 2, 2);
  w.spawnUnit("shaper", 0, 5, 5);
  w.spawnUnit("shaper", 1, size / 2 + 5, 5);
  return w;
}

describe("combat (M6)", () => {
  it("counter triangle: every matchup produces a winner and the counter wins most seeds", () => {
    const p = basePack();
    for (const [a, b] of [["warden", "firecaller"], ["firecaller", "chanter"], ["chanter", "warden"]]) {
      const rs = [1, 2, 3, 4].map((s) => runMatchup(p.files, p.hash, a, b, s));
      expect(rs.every((r) => r.winner !== "draw")).toBe(true);
      expect(rs.filter((r) => r.winner === "a").length).toBeGreaterThanOrEqual(3);
    }
  }, 60000);

  it("matchups are deterministic", () => {
    const p = basePack();
    expect(runMatchup(p.files, p.hash, "warden", "firecaller", 7)).toEqual(runMatchup(p.files, p.hash, "warden", "firecaller", 7));
  });

  it("an idle aggressive Warden acquires a nearby enemy and kills it with melee swings", () => {
    const w = arena();
    const a = w.ents.index(w.spawnUnit("warden", 0, 30, 30));
    const s = w.ents.index(w.spawnUnit("settler", 1, 35, 30));
    w.run(20 * 20);
    expect(w.ents.alive[s]).toBe(0);
    expect(w.eventCounts.get("melee")).toBeGreaterThan(0);
    expect(w.ents.alive[a]).toBe(1);
    expect(w.ents.mode[a]).toBe(CMODE.none);
  });

  it("aggressive units ignore enemies beyond acquireRadius; passive settlers never start fights", () => {
    const w = arena();
    w.spawnUnit("warden", 0, 20, 30);
    w.spawnUnit("settler", 1, 20 + w.cfg.pack.balance.combat.acquireRadius + 2, 30);
    const s0 = w.ents.index(w.spawnUnit("settler", 0, 40, 40));
    w.spawnUnit("settler", 1, 41, 40);
    w.run(60);
    expect(w.eventCounts.get("melee") ?? 0).toBe(0);
    expect(w.ents.atk[s0]).toBe(0xffffffff);
  });

  it("guards give up a chase past the leash and walk back", () => {
    const w = arena();
    const a = w.ents.index(w.spawnUnit("warden", 0, 20, 30));
    const s = w.ents.index(w.spawnUnit("settler", 1, 25, 30));
    w.run(2);
    expect(w.ents.mode[a]).toBe(CMODE.guard);
    // the settler runs far away
    w.step(cmd(1, "move", { units: [w.ents.idOf(s)], to: [50, 30] }));
    w.run(20 * 20);
    expect(w.ents.alive[s]).toBe(1);
    expect(Math.abs(w.ents.x[a] - 20)).toBeLessThan(2);
  });

  it("an attack-move chase that cannot close on a same-speed runner is a chase give-up, not a stuck unit (regression, war soak seed 1006)", () => {
    const w = arena();
    const g = w.spawnUnit("warden", 0, 8, 40);
    const s = w.spawnUnit("settler", 1, 13, 40);
    const E = w.ents;
    E.stance[E.index(s)] = STANCE.passive;
    w.step(cmd(0, "move", { units: [g], to: [44, 40], attack: true }));
    // the runner keeps exactly Warden speed ahead of it for 15 s
    const per = w.cfg.pack.units.units[E.type[E.index(g)]].speed / w.cfg.tickHz;
    const gave: typeof w.events = [];
    for (let t = 0; t < 15 * 20; t++) {
      E.x[E.index(s)] += per;
      w.step([]);
      gave.push(...w.events.filter((e) => e.type === "orderGaveUp"));
    }
    expect(gave.length).toBeGreaterThan(0);
    expect(gave.filter((e) => e.reachable === 1 && !e.chase)).toEqual([]);
    expect(gave.every((e) => e.chase === 1)).toBe(true);
    // combat dropped the hopeless chase each time and the Warden kept its attack-move
    expect(E.order[E.index(g)] === ORDER.attackMove || E.atk[E.index(g)] !== NO_ENTITY).toBe(true);
    expect(w.invariants()).toEqual([]);
  });

  it("an explicit attack order chases any distance until the target dies", () => {
    const w = arena();
    const a = w.ents.index(w.spawnUnit("warden", 0, 10, 30));
    const s = w.ents.index(w.spawnUnit("settler", 1, 40, 30));
    w.step(cmd(0, "attack", { units: [w.ents.idOf(a)], target: w.ents.idOf(s) }));
    expect(w.ents.mode[a]).toBe(CMODE.forced);
    w.run(40 * 20);
    expect(w.ents.alive[s]).toBe(0);
  });

  it("attack-move fights on the way and then resumes to the goal", () => {
    const w = arena();
    const a = w.ents.index(w.spawnUnit("warden", 0, 10, 30));
    const s = w.ents.index(w.spawnUnit("settler", 1, 20, 31));
    w.step(cmd(0, "move", { units: [w.ents.idOf(a)], to: [40, 30], attack: 2 }));
    w.run(40 * 20);
    expect(w.ents.alive[s]).toBe(0);
    expect(Math.abs(w.ents.x[a] - 40)).toBeLessThan(2);
  });

  it("Firecallers hit an area with knockback and reach farther from high ground", () => {
    const w = arena();
    const f = w.ents.index(w.spawnUnit("firecaller", 0, 20, 30));
    const t = w.ents.index(w.spawnUnit("warden", 1, 26, 30));
    w.ents.stance[t] = STANCE.passive;
    const fr = w.cfg.pack.units.units[w.ents.type[f]].ranged!;
    const flat = w.combat.reachOf(f, t);
    expect(flat).toBeCloseTo(fr.range, 5);
    // raise the shooter two bands
    w.step(cmd(-1, "terrainOp", { op: "raise", x: 20, y: 30, r: 3, amount: 2 * w.cfg.pack.balance.combat.heightBandUnits + 4 }));
    expect(w.combat.reachOf(f, t)).toBeGreaterThan(flat + 1.5);
    w.run(4 * 20);
    expect(w.eventCounts.get("fireball")).toBeGreaterThan(0);
    expect(w.ents.hp[t]).toBeLessThan(w.cfg.pack.units.units[w.ents.type[t]].hp);
  });

  it("a Firecaller cannot fire at a unit hugging it (min range)", () => {
    const w = arena();
    const f = w.ents.index(w.spawnUnit("firecaller", 0, 20, 30));
    const t = w.ents.index(w.spawnUnit("settler", 1, 21, 30));
    w.ents.stance[t] = STANCE.passive;
    w.run(3 * 20);
    expect(w.eventCounts.get("fireball") ?? 0).toBe(0);
    expect(w.ents.alive[f]).toBe(1);
  });

  it("Chanters entrance enemies while channeling, then convert up to the cap", () => {
    const w = arena();
    const c = w.ents.index(w.spawnUnit("chanter", 0, 20, 30));
    const ws = [0, 1, 2, 3].map((k) => w.ents.index(w.spawnUnit("warden", 1, 23, 28.5 + k)));
    for (const i of ws) w.ents.stance[i] = STANCE.passive;
    w.run(4);
    expect(w.ents.chant[c]).toBeGreaterThan(0);
    expect(ws.every((i) => w.ents.trance[i] > 0)).toBe(true);
    w.run(5 * 20);
    expect(w.eventCounts.get("converted")).toBe(w.cfg.pack.units.units[w.ents.type[c]].convert!.maxPerChannel);
    expect(ws.filter((i) => w.ents.tribe[i] === 0).length).toBe(3);
  });

  it("ranged damage interrupts a chant; Shapers and Chanters are never converted", () => {
    const w = arena();
    const c = w.ents.index(w.spawnUnit("chanter", 0, 20, 30));
    const s = w.ents.index(w.spawnUnit("settler", 1, 23, 30));
    w.ents.stance[s] = STANCE.passive;
    w.run(4);
    expect(w.ents.chant[c]).toBeGreaterThan(0);
    w.damage(c, 10, 1, true);
    expect(w.ents.chant[c]).toBe(0);
    expect(w.eventCounts.get("chantInterrupted")).toBe(1);
    const w2 = arena();
    w2.spawnUnit("chanter", 0, 20, 30);
    const enemy = [w2.spawnUnit("chanter", 1, 23, 30), w2.spawnUnit("shaper", 1, 23, 31)].map((id) => w2.ents.index(id));
    w2.run(10 * 20);
    expect(enemy.every((i) => w2.ents.tribe[i] === 1)).toBe(true);
    expect(w2.eventCounts.get("chantBegun") ?? 0).toBe(0);
  });

  it("lodges train queued settlers with mana from the training sink, then send them to the rally point", () => {
    const w = arena();
    const lodge = w.spawnBuilding("warden_lodge", 0, 20, 20);
    const settlers = [0, 1].map((k) => w.spawnUnit("settler", 0, 24 + k, 24));
    w.step(cmd(0, "setRally", { building: lodge, at: [30, 20] }));
    w.step(cmd(0, "train", { building: lodge, count: 2 }));
    const ids = settlers.map((id) => w.ents.index(id));
    expect(ids.every((i) => w.ents.task[i] === TASK.toTrain)).toBe(true);
    // no income yet: the queue asks the sink for mana
    w.run(5 * 20);
    expect(w.tribes[0].eco.trainDemand).toBeGreaterThan(0);
    w.tribes[0].eco.trainMana = 1000;
    w.run(40 * 20);
    const warden = w.cfg.unitIndex.get("warden")!;
    expect(w.eventCounts.get("trained")).toBe(2);
    expect(ids.every((i) => w.ents.type[i] === warden && w.ents.inside[i] < 0)).toBe(true);
    expect(Math.abs(w.ents.x[ids[0]] - 30)).toBeLessThan(3);
    expect(w.tribes[0].eco.trainMana).toBeCloseTo(1000 - 2 * w.cfg.pack.units.units[warden].trainMana!, 5);
    expect(w.invariants()).toEqual([]);
  });

  it("train rejects full queues, non-lodges and other tribes' lodges", () => {
    const w = arena();
    const lodge = w.spawnBuilding("warden_lodge", 0, 20, 20);
    const dwelling = w.spawnBuilding("dwelling", 0, 50, 50);
    for (let k = 0; k < 7; k++) w.spawnUnit("settler", 0, 24 + (k % 3), 24 + Math.floor(k / 3));
    w.step(cmd(0, "train", { building: dwelling, count: 1 }));
    w.step(cmd(1, "train", { building: lodge, count: 1 }));
    w.step(cmd(0, "train", { building: lodge, count: 9 }));
    w.step(cmd(0, "train", { building: lodge, count: 1 }));
    expect(w.eventCounts.get("commandRejected")).toBe(3);
    expect(w.combat.queued().get(w.ents.index(lodge))).toBe(w.cfg.pack.buildings.buildings[w.cfg.buildingIndex.get("warden_lodge")!].queueMax);
  });

  it("Watchtower garrisons are protected, shoot farther, and retreat finds the tower", () => {
    const w = arena();
    const tower = w.spawnBuilding("watchtower", 0, 20, 30);
    const f = w.spawnUnit("firecaller", 0, 22, 32);
    const g = w.spawnUnit("warden", 0, 22, 33);
    w.step(cmd(0, "retreat", { units: [f, g] }));
    w.run(10 * 20);
    const ti = w.ents.index(tower);
    expect(w.ents.occupants[ti]).toBe(2);
    expect(w.eventCounts.get("garrisoned")).toBe(2);
    const fi = w.ents.index(f);
    const enemy = w.ents.index(w.spawnUnit("settler", 1, 29.5, 30));
    w.ents.stance[enemy] = STANCE.passive;
    const bonus = w.cfg.pack.buildings.buildings[w.ents.type[ti]].rangeBonus!;
    expect(w.combat.reachOf(fi, enemy)).toBeCloseTo(w.cfg.pack.units.units[w.ents.type[fi]].ranged!.range + bonus, 5);
    w.damage(fi, 9999, 1, true);
    expect(w.ents.alive[fi]).toBe(1);
    w.run(3 * 20);
    expect(w.eventCounts.get("fireball")).toBeGreaterThan(0);
    w.step(cmd(0, "ungarrison", { building: tower }));
    expect(w.ents.occupants[ti]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("a new move or stop order cancels a walk to a lodge and brings a garrison out (regression)", () => {
    const w = arena();
    const lodge = w.spawnBuilding("warden_lodge", 0, 20, 20);
    const tower = w.spawnBuilding("watchtower", 0, 40, 40);
    const s = w.spawnUnit("settler", 0, 50, 50);
    const g = w.spawnUnit("warden", 0, 42, 42);
    w.step([...cmd(0, "train", { building: lodge, units: [s] }), ...cmd(0, "garrison", { units: [g], building: tower })]);
    expect(w.combat.queued().get(w.ents.index(lodge))).toBe(1);
    w.run(8 * 20);
    expect(w.ents.occupants[w.ents.index(tower)]).toBe(1);
    w.step([...cmd(0, "stop", { units: [s] }), ...cmd(0, "move", { units: [g], to: [30, 30] })]);
    const si = w.ents.index(s);
    expect(w.ents.task[si]).not.toBe(TASK.toTrain);
    expect(w.combat.queued().get(w.ents.index(lodge)) ?? 0).toBe(0);
    expect(w.tribes[0].eco.trainDemand).toBe(0);
    expect(w.ents.occupants[w.ents.index(tower)]).toBe(0);
    expect(w.ents.inside[w.ents.index(g)]).toBe(-1);
    w.run(8 * 20);
    expect(w.ents.occupants[w.ents.index(lodge)]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("a destroyed tower spills its garrison", () => {
    const w = arena();
    const tower = w.spawnBuilding("watchtower", 0, 20, 30);
    const g = w.spawnUnit("warden", 0, 22, 32);
    w.step(cmd(0, "garrison", { units: [g], building: tower }));
    w.run(5 * 20);
    expect(w.ents.inside[w.ents.index(g)]).toBe(w.ents.index(tower));
    w.damage(w.ents.index(tower), 1e9, 1, true);
    expect(w.ents.inside[w.ents.index(g)]).toBe(-1);
    w.run(2);
    expect(w.invariants()).toEqual([]);
  });

  it("troop damage can kill a Shaper; a Shaper out of combat regenerates", () => {
    const w = arena();
    const sh = w.ents.index(w.spawnUnit("shaper", 1, 30, 30));
    const max = w.ents.hp[sh];
    w.damage(sh, 500, 0, true, true);
    w.run(2 * 20);
    expect(w.ents.hp[sh]).toBe(max - 500);
    w.run(10 * 20);
    expect(w.ents.hp[sh]).toBeGreaterThan(max - 500);
    w.damage(sh, 1e9, 0, true, true);
    expect(w.eventCounts.get("shaperDied")).toBe(1);
  });

  it("an eliminated tribe's people walk out of buildings and turn wild", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const h = w.spawnBuilding("hearth", 1, 40, 40);
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    const d = w.spawnBuilding("dwelling", 1, 44, 40);
    const s = w.ents.index(w.spawnUnit("settler", 1, 45, 42));
    const t = w.ents.index(w.spawnUnit("warden", 1, 46, 42));
    const di = w.ents.index(d);
    w.ents.inside[s] = di;
    w.ents.occupants[di] = 1;
    w.ents.task[s] = TASK.home;
    w.damage(w.ents.index(h), 1e9, 0, true);
    w.step();
    expect(w.tribes[1].alive).toBe(false);
    expect(w.eventCounts.get("tribeReleased")).toBe(1);
    const wild = w.cfg.unitIndex.get("wild")!;
    for (const i of [s, t]) {
      expect(w.ents.tribe[i]).toBe(-1);
      expect(w.ents.type[i]).toBe(wild);
      expect(w.ents.inside[i]).toBe(-1);
    }
    expect(w.ents.occupants[di]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("entity arguments accept a tribe selector (scenarios cannot know ids)", () => {
    const w = arena();
    const lodge = w.spawnBuilding("warden_lodge", 0, 20, 20);
    const t = w.spawnUnit("settler", 1, 40, 40);
    expect(w.resolveEntity("tribe0.warden_lodges")).toBe(w.ents.index(lodge));
    expect(w.resolveEntity(lodge)).toBe(w.ents.index(lodge));
    expect(w.resolveEntity("tribe1.settlers")).toBe(w.ents.index(t));
    for (const bad of ["tribe1.warden_lodges", "tribe0.nothings", "warden_lodges", {}, null]) expect(w.resolveEntity(bad)).toBe(-1);
    w.step(cmd(0, "setRally", { building: "tribe0.warden_lodges", at: [30, 20] }));
    expect(w.eventCounts.get("commandRejected") ?? 0).toBe(0);
    w.step(cmd(0, "setRally", { building: "tribe1.warden_lodges", at: [30, 20] }));
    expect(w.eventCounts.get("commandRejected")).toBe(1);
  });

  it("setStance validates and applies", () => {
    const w = arena();
    const a = w.spawnUnit("warden", 0, 20, 30);
    w.step(cmd(0, "setStance", { units: [a], stance: "defensive" }));
    w.step(cmd(0, "setStance", { units: [a], stance: "berserk" }));
    expect(w.ents.stance[w.ents.index(a)]).toBe(STANCE.defensive);
    expect(w.eventCounts.get("commandRejected")).toBe(1);
  });

  it("units in a building or in another tribe's selection cannot be attacked or commanded", () => {
    const w = arena();
    const a = w.spawnUnit("warden", 0, 20, 30);
    const b = w.spawnUnit("warden", 1, 21, 30);
    w.step(cmd(1, "attack", { units: [a], target: b }));
    w.step(cmd(0, "attack", { units: [a], target: a }));
    expect(w.eventCounts.get("commandRejected")).toBe(2);
    expect(w.count((i) => w.ents.cat[i] === CAT.unit && w.ents.order[i] === ORDER.none)).toBeGreaterThan(0);
    expect(BSTATE.done).toBe(3);
  });
});

// S4 L6-C level engine gaps: kill objectives, stage-relative followers, triggers bounded by `until`,
// repeating triggers that skip fallen tribes, and raids that draft only what the trigger just spawned.
import { describe, expect, it } from "vitest";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { CAT } from "../src/entities.ts";
import { ORDER } from "../src/units.ts";
import { createLevelWorld, levelWorldInit } from "../src/level.ts";
import { World } from "../src/world.ts";
import { basePack } from "./helpers.ts";

const base = (over: Partial<LevelDef>): LevelDef => {
  const raw = {
    id: "gaps_test",
    name: "Gaps test",
    order: 99,
    description: "test",
    seed: 5,
    map: { generator: "flat", size: 64, landAboveSea: 20 },
    tribes: [{}, { ai: "turtle" }],
    spells: [],
    setup: [
      { spawn: "hearth", tribe: 0, at: [12, 12] },
      { spawn: "shaper", tribe: 0, at: [16, 12] },
      { spawn: "settler", tribe: 0, near: [12, 16], count: 3 },
      { spawn: "hearth", tribe: 1, at: [44, 44] },
      { spawn: "warden", tribe: 1, near: [40, 44], count: 4 },
    ],
    objectives: [{ type: "survive", seconds: 600 }],
    lose: [{ type: "timeLimit", seconds: 900 }],
    ...over,
  };
  const res = validateLevel(raw, basePack().files);
  if (!res.level) throw new Error(JSON.stringify(res.issues));
  return res.level;
};

const make = (def: LevelDef): World => {
  const p = basePack();
  // an idle stand-in for the opponent AI (the sim package has no AI)
  return createLevelWorld({ def }, p.files, p.hash, (spec) => ({ tribe: spec.tribe, every: 1, offset: 0, decide: () => [] }));
};

const unitsOf = (w: World, tribe: number, unit: string): number[] => {
  const E = w.ents;
  const type = w.cfg.unitIndex.get(unit);
  const out: number[] = [];
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe && E.type[i] === type) out.push(i);
  return out;
};

/** strike units down inside the next step (events from outside a step are dropped when it begins) */
const strike = (w: World, units: number[], by: number): void => {
  const todo = units.slice();
  w.controllers.push({ tribe: 0, every: 1, offset: 0, decide: (x) => (todo.splice(0).forEach((i) => x.damage(i, 1e6, by, true)), []) });
};

describe("S4 L6-C level engine gaps", () => {
  it("kill counts the player's kills of the named tribe while the stage is open, and survives a save", () => {
    const def = base({ objectives: [{ type: "kill", n: 3, tribe: 1, unit: "warden" }, { type: "survive", seconds: 600 }] });
    const w = make(def);
    const lv = w.level!;
    expect(lv.staged).toBe(true);
    const foes = unitsOf(w, 1, "warden");
    // a kill by nobody (a wild hit) does not count
    strike(w, [foes[0]], -1);
    w.step();
    expect(lv.base[0]).toBe(0);
    strike(w, [foes[1], foes[2]], 0);
    w.step();
    expect(lv.base[0]).toBe(2);
    expect(lv.done[0]).toBe(0);
    // the count is state: a restored world finishes the goal on the same kill
    const p = basePack();
    const r = World.restore(levelWorldInit({ def }, p.files, p.hash), w.snapshot());
    expect(r.level!.base[0]).toBe(2);
    for (const x of [w, r]) {
      strike(x, [foes[3]], 0);
      x.step();
      expect(x.level!.done[0]).toBe(1);
    }
    expect(r.hash()).toEqual(w.hash());
  });

  it("kills before a kill objective's stage opens do not count", () => {
    const def = base({ objectives: [{ type: "survive", seconds: 1 }, { type: "kill", n: 1, after: 0 }, { type: "survive", seconds: 600 }] });
    const w = make(def);
    const foes = unitsOf(w, 1, "warden");
    strike(w, [foes[0]], 0);
    w.step();
    expect(w.level!.base[1]).toBe(0);
    while (!w.level!.done[0]) w.step();
    w.step();
    strike(w, [foes[1]], 0);
    w.step();
    w.step();
    expect(w.level!.done[1]).toBe(1);
  });

  it("followers fromStage counts the followers gained after the stage opened", () => {
    const def = base({ objectives: [{ type: "survive", seconds: 1 }, { type: "followers", n: 2, fromStage: true, after: 0 }, { type: "survive", seconds: 600 }] });
    const w = make(def);
    const lv = w.level!;
    while (!lv.done[0]) w.step();
    w.step();
    const at = w.economy.followers(0);
    expect(lv.base[1]).toBe(at);
    expect(lv.done[1]).toBe(0);
    w.spawnUnit("settler", 0, 14, 14);
    w.step();
    expect(lv.done[1]).toBe(0);
    w.spawnUnit("settler", 0, 14, 15);
    w.step();
    expect(lv.done[1]).toBe(1);
  });

  it("a repeating trigger stops at its `until` objective and skips a tribe that has fallen", () => {
    const def = base({
      objectives: [{ type: "survive", seconds: 3 }, { type: "survive", seconds: 600 }],
      triggers: [
        { when: { type: "time", seconds: 1, every: 1 }, until: 0, do: [{ type: "spawn", unit: "warden", n: 1, tribe: 1, at: [44, 40] }] },
        { when: { type: "time", seconds: 4, every: 1 }, do: [{ type: "spawn", unit: "warden", n: 1, tribe: 1, at: [44, 40] }] },
      ],
    });
    const w = make(def);
    const hz = w.cfg.tickHz;
    const count = () => unitsOf(w, 1, "warden").length;
    for (let k = 0; k < 3 * hz + 2; k++) w.step();
    // seconds 1 and 2 fired; second 3 completes objective 0 and the trigger stops
    const after = count();
    expect(after).toBe(4 + 2);
    for (let k = 0; k < 1.5 * hz; k++) w.step();
    // the second trigger fired at second 4
    expect(count()).toBe(after + 1);
    // tribe 1 falls: the repeating spawn no longer brings it back
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === 1) w.kill(i, "killed");
    for (let k = 0; k < 2 && w.tribes[1].alive; k++) w.step();
    expect(w.tribes[1].alive).toBe(false);
    for (let k = 0; k < 3 * hz; k++) w.step();
    expect(count()).toBe(0);
    expect(w.tribes[1].alive).toBe(false);
  });

  it("a fresh raid marches only what the trigger just spawned; the troops at home stay", () => {
    const def = base({
      triggers: [
        {
          when: { type: "time", seconds: 1 },
          do: [
            { type: "spawn", unit: "warden", n: 2, tribe: 1, at: [44, 36] },
            { type: "raid", tribe: 1, to: [12, 12], fresh: true },
          ],
        },
      ],
    });
    const w = make(def);
    const home = unitsOf(w, 1, "warden");
    for (let k = 0; k < w.cfg.tickHz + 2; k++) w.step();
    const ev = w.eventCounts.get("raid");
    expect(ev).toBe(1);
    const all = unitsOf(w, 1, "warden");
    const fresh = all.filter((i) => !home.includes(i));
    expect(fresh.length).toBe(2);
    for (const i of fresh) expect(w.ents.order[i]).toBe(ORDER.attackMove);
    for (const i of home) expect(w.ents.order[i]).not.toBe(ORDER.attackMove);
  });

  it("S4 L7-E: a trigger with `after` waits for its objective and counts its time from there", () => {
    const def = base({
      objectives: [{ type: "survive", seconds: 3 }, { type: "survive", seconds: 600 }],
      triggers: [{ when: { type: "time", seconds: 1, every: 2 }, after: 0, until: 1, do: [{ type: "spawn", unit: "warden", n: 1, tribe: 1, at: [44, 40] }] }],
    });
    const w = make(def);
    const hz = w.cfg.tickHz;
    const c0 = unitsOf(w, 1, "warden").length;
    const count = () => unitsOf(w, 1, "warden").length - c0;
    for (let k = 0; k < 3 * hz - 2; k++) w.step();
    // objective 0 is not done yet: nothing fired although second 1 has passed
    expect(count()).toBe(0);
    while (!w.level!.done[0]) w.step();
    // the first firing waits one second from the objective's tick
    for (let k = 0; k < hz - 2; k++) w.step();
    expect(count()).toBe(0);
    for (let k = 0; k < 3; k++) w.step();
    expect(count()).toBe(1);
    // save and load keep the trigger's start
    const saved = w.level!.save();
    expect(saved.startAt![0]).toBeGreaterThan(0);
    for (let k = 0; k < 2 * hz; k++) w.step();
    expect(count()).toBe(2);
  });

  it("validateLevel checks until and fresh raids", () => {
    const p = basePack();
    const ok = (over: object) => validateLevel({ ...base({}), ...over }, p.files).level !== undefined;
    expect(ok({ triggers: [{ when: { type: "time", seconds: 1 }, until: 5, do: [{ type: "message", text: "x" }] }] })).toBe(false);
    expect(ok({ triggers: [{ when: { type: "time", seconds: 1 }, after: 5, do: [{ type: "message", text: "x" }] }] })).toBe(false);
    expect(ok({ triggers: [{ when: { type: "time", seconds: 1 }, do: [{ type: "raid", tribe: 1, to: [1, 1], fresh: true }] }] })).toBe(false);
    expect(ok({ objectives: [{ type: "kill", n: 1, tribe: 4 }] })).toBe(false);
    expect(ok({ objectives: [{ type: "kill", n: 1, unit: "warden" }] })).toBe(true);
  });
  it("map paint: a cone peaks at its center and meets the land at r; a ridge cuts a band from at to to", () => {
    const def = base({
      map: {
        generator: "flat", size: 64, landAboveSea: 20,
        paint: [
          { shape: "cone", at: [32, 20], r: 10, aboveSea: 60 },
          { shape: "ridge", at: [8, 48], to: [56, 48], width: 4, aboveSea: -20, falloff: 2 },
        ],
      },
    });
    const w = make(def);
    const h = (x: number, y: number) => w.terrain.heights[w.terrain.idx(x, y)] - w.cfg.sea;
    expect(h(32, 20)).toBe(60);
    expect(h(37, 20)).toBe(40);
    expect(h(43, 20)).toBe(20);
    // a trench across the map, solid land beyond its width and falloff
    for (const x of [8, 30, 56]) expect(h(x, 48)).toBe(-20);
    expect(h(30, 51)).toBeGreaterThan(-20);
    expect(h(30, 53)).toBe(20);
    expect(h(60, 48)).toBe(20);
  });

  it("tribes[].buildings replaces the level's building list for that tribe", () => {
    const def = base({ buildings: ["dwelling", "watchtower"], tribes: [{ buildings: ["dwelling"] }, { ai: "turtle" }] });
    const w = make(def);
    const tower = w.cfg.buildingIndex.get("watchtower")!;
    const lodge = w.cfg.buildingIndex.get("warden_lodge")!;
    expect(w.economy.buildingLock(0, tower)).toBe("not available in this level");
    expect(w.economy.buildingLock(1, tower)).not.toBe("not available in this level");
    expect(w.economy.buildingLock(1, lodge)).toBe("not available in this level");
    const p = basePack();
    expect(validateLevel({ ...def, tribes: [{ buildings: ["castle"] }, { ai: "turtle" }] }, p.files).level).toBeUndefined();
  });
});

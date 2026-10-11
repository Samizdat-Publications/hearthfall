// Stretch 3 (living world): shape rewards (gradual land jobs), capturable stones with auras, repeating
// time triggers, skirmish ley stones; snapshots mid-job restore to the same future hashes.
import { describe, expect, it } from "vitest";
import type { LevelDef } from "@hearthfall/data";
import { CAT } from "../src/entities.ts";
import { createLevelWorld } from "../src/level.ts";
import { World } from "../src/world.ts";
import { applyReward } from "../src/worship.ts";
import { basePack, world } from "./helpers.ts";

const SITE = [32, 32] as const;

function camp(kind: string) {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  w.spawnBuilding("hearth", 0, 10, 10);
  w.spawnBuilding("hearth", 1, 54, 54);
  w.spawnUnit("shaper", 0, 12, 12);
  w.spawnUnit("shaper", 1, 52, 52);
  w.worship.addSite(kind, SITE[0], SITE[1], { tag: "s", rewards: [] });
  return w;
}

function pray(w: World, tribe: number, n: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push(w.spawnUnit("settler", tribe, SITE[0] - 2 + k * 0.6, SITE[1] + (tribe ? 1.5 : -1.5)));
  w.step([{ tick: w.tick, tribe, type: "worship", args: { units: ids, site: "s" } }]);
  return ids;
}

function runUntil(w: World, type: string, max: number): number {
  for (let k = 0; k < max; k++) {
    w.step();
    if (w.events.some((e) => e.type === type)) return w.tick;
  }
  return -1;
}

describe("shape rewards", () => {
  it("raise a causeway out of the sea over its seconds, in half-second steps", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1, landAboveSea: -30 });
    const t = w.terrain;
    const before = t.get(32, 32);
    expect(before).toBeLessThan(t.sea);
    applyReward(w, 0, { type: "shape", shape: "line", at: [20, 32], to: [44, 32], width: 3, aboveSea: 12, seconds: 4 }, 0, 0);
    w.step();
    const early = t.get(32, 32);
    expect(early).toBeGreaterThan(before);
    expect(early).toBeLessThan(t.sea + 12);
    for (let k = 0; k < 5 * w.cfg.tickHz; k++) w.step();
    expect(t.get(32, 32)).toBe(t.sea + 12);
    expect(t.get(20, 32)).toBe(t.sea + 12);
    // outside the line plus falloff nothing moved
    expect(t.get(32, 40)).toBe(before);
    expect(w.living.jobs.length).toBe(0);
  });

  it("a sinking ford drowns whoever stands on it", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const id = w.spawnUnit("settler", 0, 32, 32);
    applyReward(w, 0, { type: "shape", shape: "disc", at: [32, 32], r: 5, aboveSea: -30, seconds: 2 }, 0, 0);
    for (let k = 0; k < 3 * w.cfg.tickHz; k++) w.step();
    expect(w.ents.index(id)).toBe(-1);
  });

  it("an instant rect lands in the same tick", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    applyReward(w, 0, { type: "shape", shape: "rect", at: [32, 32], size: [6, 4], aboveSea: 40, falloff: 0 }, 0, 0);
    w.step();
    expect(w.terrain.get(32, 32)).toBe(w.terrain.sea + 40);
    expect(w.terrain.get(34, 33)).toBe(w.terrain.sea + 40);
    expect(w.living.jobs.length).toBe(0);
  });

  it("a snapshot mid-job restores to the same future hashes", () => {
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 1, landAboveSea: -30 } };
    const a = new World(init);
    a.step();
    applyReward(a, 0, { type: "shape", shape: "disc", at: [30, 30], r: 6, aboveSea: 20, seconds: 6 }, 0, 0);
    a.step();
    a.step();
    const snap = a.snapshot();
    expect(snap.living?.jobs.length).toBe(1);
    const b = World.restore(init, snap);
    for (let k = 0; k < 4 * a.cfg.tickHz; k++) {
      a.step();
      b.step();
    }
    expect(b.hash().all).toBe(a.hash().all);
  });
});

describe("capturable stones", () => {
  it("a ley stone is never used up: the holder draws mana until a rival prays it away", () => {
    const w = camp("ley_stone");
    const s = w.worship.sites[0];
    pray(w, 0, 3);
    expect(runUntil(w, "siteCaptured", s.prayTicks * 3)).toBeGreaterThan(0);
    expect(s.lastBy).toBe(0);
    expect(s.usesLeft).toBeGreaterThan(0);
    expect(w.count((i) => w.ents.cat[i] === CAT.worship)).toBe(1);
    w.step();
    const income = w.tribes[0].eco.incomePerMin;
    const rates = new Float64Array(2);
    w.living.addManaRates(rates);
    expect(rates[0]).toBe(150);
    expect(rates[1]).toBe(0);
    expect(income).toBeGreaterThanOrEqual(150);
    // the holder cannot pray again
    const extra = w.spawnUnit("settler", 0, SITE[0], SITE[1] - 2);
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: [extra], site: "s" } }]);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "commandRejected", reason: "your tribe already holds this stone" }));
    // a rival takes it
    pray(w, 1, 3);
    expect(runUntil(w, "siteCaptured", s.prayTicks * 3)).toBeGreaterThan(0);
    expect(w.events).toContainEqual(expect.objectContaining({ type: "siteCaptured", tribe: 1, from: 0 }));
    const r2 = new Float64Array(2);
    w.living.addManaRates(r2);
    expect([r2[0], r2[1]]).toEqual([0, 150]);
  });

  it("a ward stone strikes the nearest enemy in range for its holder", () => {
    const w = camp("ward_stone");
    const s = w.worship.sites[0];
    s.lastBy = 0;
    const near = w.spawnUnit("warden", 1, SITE[0] + 4, SITE[1]);
    const far = w.spawnUnit("warden", 1, SITE[0] + 12, SITE[1]);
    const mine = w.spawnUnit("warden", 0, SITE[0] - 2, SITE[1]);
    const hp0 = w.ents.hp[w.ents.index(near)];
    expect(runUntil(w, "auraStrike", 4 * w.cfg.tickHz)).toBeGreaterThan(0);
    expect(w.ents.hp[w.ents.index(near)]).toBeLessThan(hp0);
    expect(w.ents.hp[w.ents.index(far)]).toBe(hp0);
    expect(w.ents.hp[w.ents.index(mine)]).toBe(w.cfg.pack.units.units[w.ents.type[w.ents.index(mine)]].hp);
  });

  it("a seer stone lets its holder see around it", () => {
    const w = camp("seer_stone");
    if (!w.vision.on) return;
    const s = w.worship.sites[0];
    const spy = w.spawnUnit("warden", 1, SITE[0] + 8, SITE[1]);
    const at = () => [w.ents.x[w.ents.index(spy)], w.ents.y[w.ents.index(spy)]] as const;
    w.vision.update(true);
    expect(w.vision.sees(0, ...at())).toBe(false);
    s.lastBy = 0;
    w.vision.update(true);
    expect(w.vision.sees(0, ...at())).toBe(true);
  });

  it("skirmish ley stones land on dry land, apart, and only when the match asks for them", () => {
    const p = basePack();
    const base = { pack: p.files, packHash: p.hash, seed: 11, map: { generator: "continents", size: 192, tribes: 2 } };
    const plain = new World(base);
    const ley = new World({ ...base, leyStones: 8 });
    const cap = (w: World) => w.worship.sites.filter((s) => w.worship.capturable(s.kind));
    expect(cap(plain).length).toBe(0);
    const stones = cap(ley);
    expect(stones.length).toBeGreaterThan(3);
    expect(stones.length).toBeLessThanOrEqual(8);
    for (const s of stones) {
      const i = ley.ents.index(s.ent);
      expect(ley.terrain.drowns(ley.ents.x[i], ley.ents.y[i])).toBe(false);
    }
    // victory variants do not count ley stones
    expect(plain.hash().terrain).toBe(ley.hash().terrain);
  });
});

describe("repeating triggers", () => {
  it("a time trigger with every fires again on its period (a tide)", () => {
    const def: LevelDef = {
      id: "tide_test",
      name: "Tide test",
      order: 99,
      description: "test",
      seed: 5,
      map: { generator: "flat", size: 64, landAboveSea: 20 },
      tribes: [{}],
      spells: [],
      setup: [{ spawn: "hearth", tribe: 0, at: [12, 12] }, { spawn: "shaper", tribe: 0, at: [16, 12] }, { spawn: "settler", tribe: 0, near: [12, 16], count: 3 }],
      objectives: [{ type: "survive", seconds: 600 }],
      triggers: [{ when: { type: "time", seconds: 2, every: 3 }, do: [{ type: "message", text: "tide" }] }],
    };
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    let n = 0;
    for (let k = 0; k < 9 * w.cfg.tickHz; k++) {
      w.step();
      n += w.events.filter((e) => e.type === "levelMessage").length;
    }
    // at 2, 5 and 8 seconds
    expect(n).toBe(3);
    expect(w.level!.fired[0]).toBe(3);
  });
});

describe("hold and clearDens objectives", () => {
  const base = (objectives: LevelDef["objectives"], extra: LevelDef["setup"] = []): LevelDef => ({
    id: "hold_test",
    name: "Hold test",
    order: 99,
    description: "test",
    seed: 5,
    map: { generator: "flat", size: 64, landAboveSea: 20 },
    tribes: [{}],
    spells: [],
    setup: [{ spawn: "hearth", tribe: 0, at: [12, 12] }, { spawn: "shaper", tribe: 0, at: [16, 12] }, { spawn: "settler", tribe: 0, near: [12, 16], count: 3 }, ...extra],
    objectives,
    lose: [{ type: "timeLimit", seconds: 600 }],
  });

  it("hold needs n stones at once for the whole span; losing one restarts it", () => {
    const def = base([{ type: "hold", n: 2, seconds: 5 }], [
      { spawn: "ley_stone", at: [30, 30], site: { tag: "a", rewards: [] } },
      { spawn: "ley_stone", at: [40, 40], site: { tag: "b", rewards: [] } },
    ]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const lv = w.level!;
    w.worship.find("a")!.lastBy = 0;
    for (let k = 0; k < 6 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[0]).toBe(0);
    w.worship.find("b")!.lastBy = 0;
    for (let k = 0; k < 3 * w.cfg.tickHz; k++) w.step();
    // a rival takes one away: the streak restarts
    w.worship.find("b")!.lastBy = -1;
    w.step();
    expect(lv.holdSince[0]).toBe(-1);
    w.worship.find("b")!.lastBy = 0;
    for (let k = 0; k < 4 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[0]).toBe(0);
    const snap = w.snapshot();
    expect(snap.level?.holdSince?.[0]).toBeGreaterThan(0);
    for (let k = 0; k < 2 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[0]).toBe(1);
    expect(lv.outcome).not.toBe(0);
  });

  it("clearDens is met when the level's dens are cleared", () => {
    const def = base([{ type: "clearDens" }], [{ spawn: "wolf", tribe: -1, at: [40, 40], count: 2 }]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    w.step();
    expect(w.level!.done[0]).toBe(0);
    for (const id of w.beasts.dens[0].members) w.damage(w.ents.index(id), 1e6, 0, true);
    w.step();
    w.step();
    expect(w.level!.done[0]).toBe(1);
  });

  it("clearDens with at and r counts only the dens in that area", () => {
    const def = base([{ type: "clearDens", at: [40, 40], r: 6 }], [
      { spawn: "wolf", tribe: -1, at: [40, 40], count: 1 },
      { spawn: "wolf", tribe: -1, at: [12, 40], count: 1 },
    ]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    for (const id of w.beasts.dens[1].members) w.damage(w.ents.index(id), 1e6, 0, true);
    for (let k = 0; k < 3; k++) w.step();
    expect(w.level!.done[0]).toBe(0);
    for (const id of w.beasts.dens[0].members) w.damage(w.ents.index(id), 1e6, 0, true);
    for (let k = 0; k < 3; k++) w.step();
    expect(w.level!.done[0]).toBe(1);
  });

  it("S4 fromStage: a destroy goal already true when its stage opens completes a tick later, never on the opening tick", () => {
    const def = { ...base([{ type: "reach", at: [40, 40], r: 2 }, { type: "destroy", tribe: 1, building: "watchtower", fromStage: true, after: 0 }, { type: "survive", seconds: 600 }]), tribes: [{}, {}] };
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const lv = w.level!;
    expect(lv.staged).toBe(true);
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 40;
    w.ents.y[si] = 40;
    w.step();
    expect(lv.done[0]).toBe(1);
    // world.tick has moved past the step that opened the stage
    expect(lv.openedAt[1]).toBe(w.tick - 1);
    expect(lv.done[1]).toBe(0);
    w.step();
    expect(lv.done[1]).toBe(1);
    expect(w.snapshot().level?.openedAt?.[1]).toBe(w.tick - 2);
  });

  it("S4 fromStage: a worship goal needs a completion after its stage opened, holding the site before does not count", () => {
    const def = base([{ type: "reach", at: [40, 40], r: 2 }, { type: "worship", site: "w", fromStage: true, after: 0 }, { type: "survive", seconds: 600 }], [{ spawn: "ley_stone", at: [30, 30], site: { tag: "w", rewards: [] } }]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const lv = w.level!;
    w.worship.find("w")!.lastBy = 0;
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 40;
    w.ents.y[si] = 40;
    for (let k = 0; k < 3 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[0]).toBe(1);
    expect(lv.done[1]).toBe(0);
    // a rival takes the stone, the player prays it back: that completion counts
    w.worship.find("w")!.lastBy = 1;
    const ids: number[] = [];
    for (let k = 0; k < 10; k++) ids.push(w.spawnUnit("settler", 0, 28 + (k % 5) * 0.6, 28 + Math.floor(k / 5) * 0.6));
    w.step([{ tick: w.tick, tribe: 0, type: "worship", args: { units: ids, site: "w" } }]);
    let at = -1;
    for (let k = 0; k < 120 * w.cfg.tickHz && at < 0; k++) {
      w.step();
      if (w.events.some((e) => e.type === "worshipComplete" && e.tribe === 0)) at = w.tick;
    }
    expect(at).toBeGreaterThan(0);
    expect(lv.done[1]).toBe(1);
  });

  it("S4 fromStage: clearDens counts only dens cleared after the stage opened", () => {
    const def = base([{ type: "reach", at: [20, 40], r: 2 }, { type: "clearDens", fromStage: true, after: 0 }, { type: "survive", seconds: 600 }], [
      { spawn: "wolf", tribe: -1, at: [40, 40], count: 1 },
      { spawn: "wolf", tribe: -1, at: [50, 20], count: 1 },
    ]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const lv = w.level!;
    for (const id of w.beasts.dens[0].members) w.damage(w.ents.index(id), 1e6, 0, true);
    for (let k = 0; k < 3; k++) w.step();
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 20;
    w.ents.y[si] = 40;
    for (let k = 0; k < 3; k++) w.step();
    expect(lv.done[0]).toBe(1);
    expect(lv.base[1]).toBe(1);
    expect(lv.done[1]).toBe(0);
    for (const id of w.beasts.dens[1].members) w.damage(w.ents.index(id), 1e6, 0, true);
    for (let k = 0; k < 3; k++) w.step();
    expect(lv.done[1]).toBe(1);
  });

  it("S4: a level tribe's maxPopulation caps its population", () => {
    const def = { ...base([{ type: "survive", seconds: 600 }]), tribes: [{ maxPopulation: 4 }] };
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    expect(w.economy.popCap(0)).toBe(4);
    const free = createLevelWorld({ def: base([{ type: "survive", seconds: 600 }]) }, p.files, p.hash);
    expect(free.economy.popCap(0)).toBeGreaterThan(4);
  });

  it("S4: a fromStage victory objective starts the rules clock when its stage opens", () => {
    const def: LevelDef = {
      ...base([{ type: "reach", at: [40, 40], r: 2 }, { type: "victory", fromStage: true, after: 0 }], [
        { spawn: "hearth", tribe: 1, at: [52, 52] },
        { spawn: "shaper", tribe: 1, at: [50, 52] },
        { spawn: "reliquary", at: [24, 32], site: { tag: "a", rewards: [] } },
      ]),
      tribes: [{}, {}],
      rules: "king_of_hill",
    };
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    for (let k = 0; k < 4; k++) w.ents.stance[w.ents.index(w.spawnUnit("warden", 0, 24 + k * 0.5, 32))] = 2;
    for (let k = 0; k < 5 * w.cfg.tickHz; k++) w.step();
    expect(w.level!.rulesSince()).toBe(-1);
    expect(w.rules!.held[0]).toBe(0);
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 40;
    w.ents.y[si] = 40;
    for (let k = 0; k < 5 * w.cfg.tickHz; k++) w.step();
    expect(w.level!.rulesSince()).toBeGreaterThan(0);
    expect(w.rules!.held[0]).toBeGreaterThan(0);
  });

  it("a capturable stone with a tribe in the setup starts held by that tribe", () => {
    const def = base([{ type: "hold", n: 1, seconds: 1 }], [{ spawn: "ley_stone", tribe: 0, at: [30, 30], site: { tag: "a", rewards: [] } }]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    expect(w.worship.find("a")!.lastBy).toBe(0);
    for (let k = 0; k < 2 * w.cfg.tickHz; k++) w.step();
    expect(w.level!.done[0]).toBe(1);
  });

  it("a fromStage survive counts from the tick its stage opened", () => {
    const def = base([{ type: "reach", at: [40, 40], r: 2 }, { type: "survive", seconds: 3, fromStage: true, after: 0 }]);
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const lv = w.level!;
    for (let k = 0; k < 5 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[1]).toBe(0);
    // the Shaper arrives: the 3 s count starts now, not at tick 0
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 40;
    w.ents.y[si] = 40;
    w.step();
    expect(lv.done[0]).toBe(1);
    for (let k = 0; k < 2 * w.cfg.tickHz; k++) w.step();
    expect(lv.done[1]).toBe(0);
    for (let k = 0; k < 1 * w.cfg.tickHz + 2; k++) w.step();
    expect(lv.done[1]).toBe(1);
  });

  it("beastPrey player: wolves leave a rival's units alone but still bite the player's", () => {
    const def: LevelDef = { ...base([{ type: "survive", seconds: 600 }], [{ spawn: "wolf", tribe: -1, at: [40, 40], count: 2 }, { spawn: "settler", tribe: 1, at: [41, 40] }, { spawn: "hearth", tribe: 1, at: [52, 52] }]), tribes: [{}, {}], beastPrey: "player" };
    const p = basePack();
    const w = createLevelWorld({ def }, p.files, p.hash);
    const bites = [0, 0];
    const run = (sec: number) => {
      for (let k = 0; k < sec * w.cfg.tickHz; k++) {
        w.step();
        for (const e of w.events) if (e.type === "beastBite") bites[(e as unknown as { tribe: number }).tribe]++;
      }
    };
    run(4);
    expect(bites[1]).toBe(0);
    const si = w.ents.index(w.tribes[0].shaper);
    w.ents.x[si] = 41;
    w.ents.y[si] = 41;
    run(4);
    expect(bites[0]).toBeGreaterThan(0);
    expect(bites[1]).toBe(0);
  });
});

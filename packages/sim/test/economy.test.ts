import { describe, expect, it } from "vitest";
import { TASK } from "../src/economy.ts";
import { world } from "./helpers.ts";

const flat = () => {
  const w = world({ generator: "flat", size: 64, tribes: 1 });
  return w;
};

describe("mana economy", () => {
  it("start mana becomes Bolt charges (DESIGN section 5)", () => {
    const w = flat();
    const bolt = w.cfg.spellIndex.get("bolt")!;
    expect(w.tribes[0].eco.charges[bolt]).toBe(3);
  });

  it("income follows follower state: Shaper 66, idle settler 9, housed or working 35", () => {
    const w = flat();
    w.spawnUnit("shaper", 0, 10, 10);
    const s = [0, 1, 2].map((k) => w.ents.index(w.spawnUnit("settler", 0, 12 + k, 10)));
    w.step([]);
    expect(w.tribes[0].eco.incomePerMin).toBe(66 + 3 * 9);
    w.ents.task[s[0]] = TASK.chop;
    w.ents.inside[s[1]] = 0;
    expect(w.economy.manaRate(s[0])).toBe(35);
    expect(w.economy.manaRate(s[1])).toBe(35);
    expect(w.economy.manaRate(s[2])).toBe(9);
    w.ents.inside[s[1]] = -1;
  });

  it("a single active sink gets all income; both sinks split by the slider; none is wasted", () => {
    const w = flat();
    w.spawnUnit("shaper", 0, 10, 10);
    const e = w.tribes[0].eco;
    const total = () => e.progress.reduce((a, b) => a + b, 0);
    const p0 = total();
    w.step([]);
    const perTick = 66 / (60 * w.cfg.tickHz);
    expect(total() - p0).toBeCloseTo(perTick, 12);
    // a real training order (a settler walking to a lodge) opens the training sink
    const lodge = w.spawnBuilding("warden_lodge", 0, 20, 20);
    const settler = w.spawnUnit("settler", 0, 50, 50);
    w.step([{ tick: w.tick, tribe: 0, type: "train", args: { building: lodge, units: [settler] } }]);
    expect(e.trainDemand).toBeGreaterThan(0);
    const before = total();
    const t0 = e.trainMana;
    w.step([{ tick: w.tick, tribe: 0, type: "setSplit", args: { spellsPct: 25 } }]);
    const toSpells = total() - before;
    const toTrain = e.trainMana - t0;
    expect(toSpells + toTrain).toBeGreaterThan(0);
    expect(toSpells / (toSpells + toTrain)).toBeCloseTo(0.25, 12);
    w.step([{ tick: w.tick, tribe: 0, type: "stop", args: { units: [settler] } }]);
    expect(e.trainDemand).toBe(0);
    for (const id of ["bolt", "call"]) w.step([{ tick: w.tick, tribe: 0, type: "setAutoCharge", args: { spell: id, on: false } }]);
    const wasted = e.wasted;
    w.step([]);
    expect(e.wasted - wasted).toBeCloseTo(e.incomePerMin / (60 * w.cfg.tickHz), 12);
  });

  it("charging cycles through auto spells, never exceeds max charges, keeps progress below cost", () => {
    const w = flat();
    for (let k = 0; k < 30; k++) w.spawnUnit("settler", 0, 10 + (k % 6), 10 + Math.floor(k / 6));
    w.spawnUnit("shaper", 0, 20, 20);
    const e = w.tribes[0].eco;
    const bolt = w.cfg.spellIndex.get("bolt")!;
    const call = w.cfg.spellIndex.get("call")!;
    w.run(20 * 60 * 2);
    expect(e.charges[bolt]).toBe(4);
    expect(e.charges[call]).toBe(4);
    expect(e.wasted).toBeGreaterThan(0);
    expect(w.invariants()).toEqual([]);
  });

  it("validates economy commands", () => {
    const w = flat();
    w.step([
      { tick: 0, tribe: 0, type: "setSplit", args: { spellsPct: 120 } },
      { tick: 0, tribe: 0, type: "setAutoCharge", args: { spell: "wraith", on: true } },
      { tick: 0, tribe: 0, type: "setPriorities", args: { build: 2, upgrade: 0, breed: 0 } },
      { tick: 0, tribe: 0, type: "placePlan", args: { building: "hearth", at: [30, 30] } },
      { tick: 0, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [30, 30] } },
      { tick: 0, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [30.5, 30.5] } },
    ]);
    expect(w.eventCounts.get("commandRejected")).toBe(5);
    expect(w.eventCounts.get("planPlaced")).toBe(1);
  });
});

describe("trees", () => {
  it("regrow one wood per regrowSecondsPerWood and fully from a stump", () => {
    const w = flat();
    const tr = w.cfg.pack.buildings.trees;
    const a = w.ents.index(w.spawnTree(5, 5));
    const b = w.ents.index(w.spawnTree(9, 9));
    w.ents.wood[a] = 2;
    w.ents.wood[b] = 0;
    w.run(Math.round(tr.regrowSecondsPerWood * w.cfg.tickHz));
    expect(w.ents.wood[a]).toBe(3);
    expect(w.ents.wood[b]).toBe(0);
    w.run(Math.round((tr.regrowFromStumpSeconds - tr.regrowSecondsPerWood) * w.cfg.tickHz));
    expect(w.ents.wood[b]).toBe(tr.maxWood);
  });
});

describe("plans and trees (M4 review regressions)", () => {
  it("a stump inside a new footprint is cleared, not doomed forever", () => {
    const w = flat();
    const stump = w.ents.index(w.spawnTree(30.5, 30.5));
    w.ents.wood[stump] = 0;
    const live = w.ents.index(w.spawnTree(31.2, 31.2));
    w.economy.placePlan(0, w.cfg.buildingIndex.get("dwelling")!, 31, 31);
    expect(w.ents.alive[stump]).toBe(0);
    expect(w.ents.state[live]).toBe(1);
  });

  it("cancelling a plan releases its doomed trees so they regrow", () => {
    const w = flat();
    const tree = w.ents.index(w.spawnTree(31.2, 31.2));
    const plan = w.economy.placePlan(0, w.cfg.buildingIndex.get("dwelling")!, 31, 31);
    expect(w.ents.state[tree]).toBe(1);
    w.step([{ tick: w.tick, tribe: 0, type: "cancelPlan", args: { id: plan } }]);
    expect(w.ents.index(plan)).toBe(-1);
    expect(w.ents.state[tree]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("starting wood is hauled to the first plan, never dropped for a chop job", () => {
    const w = world({ generator: "continents", size: 128, tribes: 1 }, 5);
    const h = w.ents.index(w.tribes[0].hearth);
    const carried = () => w.selectUnits("tribe0.settlers").reduce((a, i) => a + w.ents.carry[i], 0);
    expect(carried()).toBe(5);
    const blocker = w.economy.planBlocker(w.cfg.buildingIndex.get("dwelling")!, w.ents.x[h] + 5, w.ents.y[h]);
    if (blocker) return; // seed-specific terrain; the scenario suite covers the general case
    w.economy.placePlan(0, w.cfg.buildingIndex.get("dwelling")!, w.ents.x[h] + 5, w.ents.y[h]);
    w.run(20 * 20);
    expect(w.eventCounts.get("woodDelivered") ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("settlers only take homes and work on their own landmass (regression, M7 ai-idle soak)", () => {
    const w = flat();
    const t = w.terrain;
    // a sea channel splits the map: the dwelling and a plan sit east of it, the settler west
    for (let y = 0; y < 64; y++) for (const x of [30, 31, 32, 62, 63, 0]) t.heights[t.idx(x, y)] = 0;
    t.version++;
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    w.spawnBuilding("dwelling", 0, 45, 20);
    const s = w.ents.index(w.spawnUnit("settler", 0, 20, 20));
    w.step([{ tick: 0, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [48, 40] } }]);
    let failed = 0;
    for (let k = 0; k < 20 * 20; k++) {
      w.step([]);
      failed += w.events.filter((e) => e.type === "orderFailed").length;
    }
    expect(failed).toBe(0);
    expect([TASK.toHome, TASK.toWork, TASK.haul, TASK.toTree].includes(w.ents.task[s] as never)).toBe(false);
  });
});

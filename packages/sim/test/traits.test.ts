// Stretch 2 (parking lot): tribe traits, small passive bonuses from balance.traits set per tribe at world creation.
import { describe, expect, it } from "vitest";
import { World, originMismatch } from "../src/world.ts";
import { BSTATE } from "../src/economy.ts";
import { basePack } from "./helpers.ts";

const p = basePack();
const make = (traits?: (string | null)[], tribes = 2) => new World({ pack: p.files, packHash: p.hash, seed: 5, map: { generator: "flat", size: 64, tribes }, ...(traits ? { traits } : {}) });

describe("tribe traits", () => {
  it("no trait anywhere keeps the hash of a world without traits; an unknown id throws", () => {
    expect(make([null, null]).hash().all).toBe(make().hash().all);
    expect(make(["devout", null]).hash().all).not.toBe(make().hash().all);
    expect(() => make(["glorious"])).toThrow(/unknown tribe trait/);
  });

  it("devout raises mana income by its factor, only for its tribe", () => {
    const a = make();
    const b = make(["devout", null]);
    for (const w of [a, b]) w.step([]);
    expect(b.tribes[0].eco.incomePerMin).toBeCloseTo(a.tribes[0].eco.incomePerMin * 1.1, 9);
    expect(b.tribes[1].eco.incomePerMin).toBe(a.tribes[1].eco.incomePerMin);
  });

  it("swift units cover more ground; stalwart units take less damage", () => {
    const run = (traits?: (string | null)[]) => {
      const w = make(traits, 1);
      const id = w.spawnUnit("warden", 0, 10, 20);
      w.step([{ tick: 0, tribe: 0, type: "move", args: { units: [id], to: [50, 20] } }]);
      for (let k = 0; k < 40; k++) w.step([]);
      return w.ents.x[w.ents.index(id)] - 10;
    };
    expect(run(["swift"])).toBeCloseTo(run() * 1.08, 1);
    const hit = (traits?: (string | null)[]) => {
      const w = make(traits, 1);
      const i = w.ents.index(w.spawnUnit("warden", 0, 10, 20));
      const before = w.ents.hp[i];
      w.damage(i, 10, -1, true);
      return before - w.ents.hp[i];
    };
    expect(hit()).toBe(10);
    expect(hit(["stalwart"])).toBeCloseTo(9.2, 9);
  });

  it("fertile dwellings fill faster", () => {
    const step = (traits?: (string | null)[]) => {
      const w = make(traits, 1);
      w.spawnUnit("shaper", 0, 8, 8);
      const d = w.ents.index(w.spawnBuilding("dwelling", 0, 32, 32));
      w.ents.state[d] = BSTATE.done;
      w.ents.occupants[d] = 2;
      const before = w.ents.progress[d];
      w.step([]);
      return w.ents.progress[d] - before;
    };
    const plain = step();
    expect(plain).toBeGreaterThan(0);
    expect(step(["fertile"])).toBeCloseTo(plain * 1.12, 9);
  });

  it("traits survive a snapshot and a save must match them", () => {
    const w = make(["stalwart", "swift"]);
    for (let k = 0; k < 50; k++) w.step([]);
    const r = World.restore({ pack: p.files, ...w.origin }, w.snapshot());
    for (let k = 0; k < 50; k++) {
      w.step([]);
      r.step([]);
    }
    expect(r.hash().all).toBe(w.hash().all);
    expect(originMismatch(w.origin, { pack: p.files, ...w.origin, traits: ["swift", "swift"] })).toMatch(/traits/);
  });
});

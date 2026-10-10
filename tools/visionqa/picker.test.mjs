// BACKLOG 23: the move picker's offline parts (situation text, diversity metric). The paid call is not tested here.
import { describe, expect, it } from "vitest";
import { World } from "../../packages/sim/src/world.ts";
import { basePack } from "../../packages/sim/test/helpers.ts";
import { PICKER_MOVES } from "../../packages/ai/src/index.ts";
import { diversity, situation } from "./picker.mjs";

const res = (personality, actions, endMinute = 10, alive = [0]) => ({ ai: { endMinute, alive, ais: [{ personality, stats: { actions } }] } });

describe("move picker (BACKLOG 23)", () => {
  it("summarizes a tribe's situation in under 1,500 characters", () => {
    const p = basePack();
    const w = new World({ pack: p.files, packHash: p.hash, seed: 1, map: { generator: "continents", size: 128, tribes: 3 } });
    for (let k = 0; k < 200; k++) w.step([]);
    const s = situation(w, 0);
    expect(s.length).toBeLessThanOrEqual(1500);
    expect(s).toContain("tribe 0");
    expect(s.match(/Rival tribe/g)?.length).toBe(2);
  });

  it("diversity is 0 for identical action mixes and grows when matches differ", () => {
    const same = diversity([res("turtle", { train: 4, buildTower: 2 }), res("turtle", { train: 8, buildTower: 4 })]);
    expect(same.actionDiversity).toBe(0);
    const apart = diversity([res("turtle", { train: 4 }), res("turtle", { buildTower: 4 })]);
    expect(apart.actionDiversity).toBe(1);
    const some = diversity([res("turtle", { train: 4, buildTower: 2 }), res("turtle", { train: 2, buildTower: 4 }, 20, [0, 1])]);
    expect(some.actionDiversity).toBeGreaterThan(0);
    expect(some.actionDiversity).toBeLessThan(1);
    expect(some.unfinishedShare).toBe(0.5);
    expect(some.endMinuteSd).toBe(5);
  });

  it("every picker move maps to an OpponentAI action id or to hold", () => {
    expect(PICKER_MOVES.hold).toBeNull();
    expect(Object.keys(PICKER_MOVES).length).toBeGreaterThanOrEqual(8);
  });
});

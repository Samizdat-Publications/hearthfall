import { describe, expect, it } from "vitest";
import { ORDER } from "../src/units.ts";
import { world } from "./helpers.ts";

describe("unit orders", () => {
  // regression (M7 bots soak, seeds 1005 and 1007): a move to a point in the sea snaps its goal to
  // the nearest walkable vertex; the unit reached the snapped goal but measured arrival against the
  // raw point, so it stood at the shore and reported "gave up N cells from a reachable goal"
  for (const count of [1, 6]) {
    it(`a move into water arrives at the snapped shore goal (${count === 1 ? "A* path" : "flow field"})`, () => {
      const w = world({ generator: "flat", size: 64, tribes: 2 });
      const t = w.terrain;
      for (let y = 20; y <= 40; y++) for (let x = 30; x <= 40; x++) t.heights[t.idx(x, y)] = 0;
      t.version++;
      const E = w.ents;
      const ids: number[] = [];
      for (let k = 0; k < count; k++) ids.push(E.index(w.spawnUnit("settler", 0, 20 + (k % 3), 29 + Math.floor(k / 3))));
      w.units.order(ids, 33, 30);
      const gaveUp: string[] = [];
      for (let k = 0; k < 30 * 20; k++) {
        w.step([]);
        for (const e of w.events) if (e.type === "orderGaveUp" && e.reachable === 1 && !e.chase) gaveUp.push(JSON.stringify(e));
      }
      expect(gaveUp).toEqual([]);
      for (const i of ids) {
        expect(E.order[i]).toBe(ORDER.none);
        expect(E.alive[i]).toBe(1);
        expect(E.x[i]).toBeGreaterThan(25);
      }
      expect(w.invariants()).toEqual([]);
    });
  }

  // regression (M7 ai soak, seed 1005 turtle v aggressive): terrain changed under a group's flow
  // field (a quake), the rebuilt field was longer, and the units kept their old best progress, so
  // walking the new detour looked like no progress and they gave up on a reachable goal
  it("a flow-field group keeps going when the terrain forces a longer detour", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const t = w.terrain;
    const E = w.ents;
    const ids: number[] = [];
    for (let k = 0; k < 6; k++) ids.push(E.index(w.spawnUnit("settler", 0, 10 + (k % 3), 29 + Math.floor(k / 3))));
    w.units.order(ids, 40, 30);
    for (let k = 0; k < 4 * 20; k++) w.step([]);
    expect(E.x[ids[0]]).toBeGreaterThan(14);
    // walls across the route and the way round the seam, each with one gap near y 0
    for (let y = 3; y <= 60; y++) for (const x of [26, 27, 55, 56]) t.heights[t.idx(x, y)] = 600;
    t.version++;
    const gaveUp: string[] = [];
    for (let k = 0; k < 60 * 20; k++) {
      w.step([]);
      for (const e of w.events) if (e.type === "orderGaveUp" && e.reachable === 1 && !e.chase) gaveUp.push(JSON.stringify(e));
    }
    expect(gaveUp).toEqual([]);
    for (const i of ids) expect(E.x[i]).toBeGreaterThan(34);
  });
});

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

  // BACKLOG 73: a unit standing on the shore vertex ordered a cell or two into the sea gets an empty A*
  // path (start is the snapped goal); it must arrive there, not steer at the raw goal in the water and give up
  it("a move just off the shore from the shore vertex arrives at once", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const t = w.terrain;
    for (let y = 20; y <= 40; y++) for (let x = 30; x <= 40; x++) t.heights[t.idx(x, y)] = 0;
    t.version++;
    const E = w.ents;
    w.step([]);
    const pf = w.units.pf;
    let shore = -1;
    for (let x = 31; x >= 20 && shore < 0; x--) if (pf.nearestWalkable(x + 30 * 64, 0) === x + 30 * 64) shore = x;
    const i = E.index(w.spawnUnit("settler", 0, shore + 0.45, 30.45));
    // farther than crowdArriveRadius, so only the snapped goal can count as arrival
    w.units.order([i], shore + 3.5, 30);
    const gaveUp: string[] = [];
    for (let k = 0; k < 15 * 20; k++) {
      w.step([]);
      for (const e of w.events) if (e.type === "orderGaveUp" || e.type === "orderFailed") gaveUp.push(JSON.stringify(e));
    }
    expect(gaveUp).toEqual([]);
    expect(E.order[i]).toBe(ORDER.none);
    expect(E.alive[i]).toBe(1);
  });

  // regression (BACKLOG 97, ai soak seed 1002 turtle v aggressive): panicked units on a small island picked
  // flee points in the sea, and every repick was a failed full A* search (about 400 orderFailed a match)
  it("a panicked unit on a small island flees only on its island, not to the shore across a strait", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const t = w.terrain;
    const E = w.ents;
    w.step([]);
    const land = t.heights[t.idx(30, 32)];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x < 36 && (Math.abs(x - 30) > 2 || Math.abs(y - 32) > 2)) || x > 60) t.heights[t.idx(x, y)] = 0;
    t.version++;
    expect(land).toBeGreaterThan(t.sea);
    const i = E.index(w.spawnUnit("settler", 0, 30.2, 32.3));
    E.panic[i] = 10 * 20;
    const failed: string[] = [];
    for (let k = 0; k < 10 * 20; k++) {
      w.step([]);
      for (const e of w.events) if (e.type === "orderFailed") failed.push(JSON.stringify(e));
    }
    expect(failed).toEqual([]);
    expect(E.alive[i]).toBe(1);
  });

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

  // regression (BACKLOG 7 ai soak, seed 1008): a wild person's straight path was blocked, the stuck
  // repath found a longer detour round the wrap, but progress was still measured against the old short
  // route, so it gave up 8 cells from a reachable goal while walking the new route
  it("a stuck repath onto a longer detour restarts route progress instead of giving up", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const t = w.terrain;
    const E = w.ents;
    // a wall between the unit and its goal with one gap far to the north
    for (let y = 10; y <= 60; y++) t.heights[t.idx(30, y)] = 600;
    t.version++;
    const i = E.index(w.spawnUnit("settler", 0, 26, 40));
    w.units.order([i], 34, 40);
    w.step([]);
    w.step([]);
    // as if the unit had come within 2 cells along a straight route before a stuck repath
    E.best[i] = 2;
    E.waitPath[i] = 1;
    (w.units as unknown as { queue: number[] }).queue.push(E.idOf(i));
    const gaveUp: string[] = [];
    for (let k = 0; k < 40 * 20; k++) {
      w.step([]);
      for (const e of w.events) if (e.type === "orderGaveUp") gaveUp.push(JSON.stringify(e));
    }
    expect(gaveUp).toEqual([]);
    expect(Math.abs(E.x[i] - 34) + Math.abs(E.y[i] - 40)).toBeLessThan(2);
  });

  // BACKLOG 72 (M7 re-review): every terrain edit used to restart a flow unit's progress, so a truly stuck
  // flow unit never gave up while edits came faster than giveUpSeconds (repeated quakes far away)
  it("a stuck flow-field unit still gives up under repeated terrain edits that do not touch its route", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const E = w.ents;
    const ids = Array.from({ length: 8 }, (_, k) => w.spawnUnit("settler", 0, 8 + (k % 4), 8 + Math.floor(k / 4)));
    w.step([{ tick: 0, tribe: 0, type: "move", args: { units: ids, to: [30, 10] } }]);
    const pinned = E.index(ids[0]);
    expect(E.flowGoal[pinned]).toBeGreaterThanOrEqual(0);
    const px = E.x[pinned];
    const py = E.y[pinned];
    let gaveUp = -1;
    const giveUp = w.cfg.pack.balance.movement.giveUpSeconds * w.cfg.tickHz;
    for (let t = 0; t < 3 * giveUp && gaveUp < 0; t++) {
      // something holds the unit in place (it never makes progress)
      E.x[pinned] = px;
      E.y[pinned] = py;
      const cmds = t % 30 === 0 ? [{ tick: w.tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 40, y: 50, r: 3, depth: 4, seed: t } }] : [];
      w.step(cmds);
      for (const e of w.events) if (e.type === "orderGaveUp" && e.id === ids[0]) gaveUp = w.tick;
    }
    expect(gaveUp).toBeGreaterThan(0);
  });
});

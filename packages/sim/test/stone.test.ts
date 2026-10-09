// BACKLOG 0c: stone, the second harvested resource. Rocks are placed by the generator around each Hearth
// and over the land; settlers quarry them for buildings that cost stone (towers and lodges), and a site
// only finishes once its stone is delivered. A plan that needs stone is refused without a rock on its landmass.
import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import { walkableComponents } from "../src/generator.ts";
import { wrapDelta } from "../src/terrain.ts";
import { BSTATE } from "../src/economy.ts";
import { world } from "./helpers.ts";

const village = () => {
  const w = world({ generator: "flat", size: 64, tribes: 1 });
  w.spawnBuilding("hearth", 0, 32, 32);
  w.tribes[0].eco.tier = 2;
  return w;
};

/** Raise a block of land into a cliff-walled plateau (its own walkable component). */
const plateau = (w: ReturnType<typeof village>, x0: number, y0: number, s: number) => {
  const t = w.terrain;
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) t.heights[t.idx(x, y)] += 80;
  t.version++;
};

describe("stone (BACKLOG 0c)", () => {
  for (const generator of ["continents", "islands"]) {
    for (const seed of [1, 2]) {
      it(`${generator} seed ${seed}: rocks with stone by every Hearth on its landmass, no tree hugging a rock`, () => {
        const w = world({ generator, size: 128, tribes: 4 }, seed);
        const t = w.terrain;
        const E = w.ents;
        const rk = w.cfg.pack.terrain.rocks!;
        const rocks: number[] = [];
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.rock) rocks.push(i);
        expect(rocks.length).toBeGreaterThanOrEqual(4 * rk.perHearth);
        for (const i of rocks) expect(E.stone[i]).toBe(w.cfg.pack.buildings.rocks!.maxStone);
        const comp = walkableComponents(t);
        const d = (a: number, x: number, y: number) => Math.hypot(wrapDelta(E.x[a] - x, 128), wrapDelta(E.y[a] - y, 128));
        for (const tr of w.tribes) {
          const h = E.index(tr.hearth);
          const label = comp.labels[t.idx(E.x[h], E.y[h])];
          const near = rocks.filter((r) => d(r, E.x[h], E.y[h]) <= rk.distance[1] + 1 && comp.labels[t.idx(E.x[r], E.y[r])] === label);
          expect(near.length).toBeGreaterThanOrEqual(1);
          expect(w.economy.stoneInReach(E.x[h], E.y[h])).toBe(true);
        }
        for (let i = 0; i < E.hi; i++) {
          if (!E.alive[i] || E.cat[i] !== CAT.tree) continue;
          for (const r of rocks) expect(d(r, E.x[i], E.y[i])).toBeGreaterThanOrEqual(rk.clearTreesRadius);
        }
      });
    }
  }

  it("plans that cost stone need a rock on their landmass; a rock in the footprint blocks the plan", () => {
    const w = village();
    const tower = w.cfg.buildingIndex.get("watchtower")!;
    const dwelling = w.cfg.buildingIndex.get("dwelling")!;
    expect(w.economy.planBlocker(tower, 36, 32)).toBe("no stone in reach");
    expect(w.economy.planBlocker(dwelling, 36, 30)).toBeNull();
    // a rock up on a cliff-walled plateau is not in reach
    plateau(w, 50, 50, 8);
    w.spawnRock(53, 53);
    expect(w.economy.planBlocker(tower, 36, 32)).toBe("no stone in reach");
    w.spawnRock(44, 32);
    expect(w.economy.planBlocker(tower, 36, 32)).toBeNull();
    expect(w.economy.planBlocker(tower, 44, 32)).toBe("a rock is in the way");
  });

  it("a site with all its wood waits for its stone, then finishes; the rock gives up what was quarried", () => {
    const w = village();
    const E = w.ents;
    for (let k = 0; k < 6; k++) w.spawnUnit("settler", 0, 30 + k, 28);
    for (let k = 0; k < 8; k++) w.spawnTree(20 + (k % 4), 20 + Math.floor(k / 4));
    const s = E.index(w.economy.placePlan(0, w.cfg.buildingIndex.get("watchtower")!, 36, 38));
    // no rock at all: the wood arrives and the pad is levelled, but building cannot start
    w.run(1500);
    expect(E.state[s]).not.toBe(BSTATE.done);
    expect(E.wood[s]).toBe(5);
    expect(E.progress[s]).toBe(0);
    const r = E.index(w.spawnRock(44, 38, 5));
    w.run(900);
    expect(E.state[s]).toBe(BSTATE.done);
    expect(w.eventCounts.get("stoneDelivered")).toBe(2);
    expect(E.stone[r]).toBe(3);
    expect(w.invariants()).toEqual([]);
  });

  it("an emptied rock is quarried away and a drowned one is lost", () => {
    const w = village();
    const E = w.ents;
    for (let k = 0; k < 6; k++) w.spawnUnit("settler", 0, 30 + k, 28);
    for (let k = 0; k < 8; k++) w.spawnTree(20 + (k % 4), 20 + Math.floor(k / 4));
    const a = w.spawnRock(42, 38, 1);
    const b = w.spawnRock(46, 40, 4);
    w.economy.placePlan(0, w.cfg.buildingIndex.get("watchtower")!, 36, 38);
    w.run(1500);
    expect(E.index(a)).toBe(-1);
    expect(w.eventCounts.get("quarried")).toBe(1);
    expect(E.stone[E.index(b)]).toBe(3);
    w.step([{ tick: w.tick, tribe: -1, type: "terrainOp", args: { op: "set", x: 46, y: 40, r: 3, value: 60 } }]);
    expect(E.index(b)).toBe(-1);
    expect(w.count((i) => E.cat[i] === CAT.rock)).toBe(0);
  });
});

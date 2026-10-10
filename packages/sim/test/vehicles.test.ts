import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import { applyEffects } from "../src/effects.ts";
import { TASK } from "../src/economy.ts";
import { NAV } from "../src/units.ts";
import { World, type WorldInit } from "../src/world.ts";
import { basePack } from "./helpers.ts";

// BACKLOG 10 (ADR-016): boats, balloons, the water and air nav layers, shore placement.

/** A 64 map split by two deep north-south straits (x 25 to 39 and its wrap twin): west and east land. */
function straitInit(seed = 5, tribes = 1): WorldInit {
  const p = basePack();
  return {
    pack: p.files,
    packHash: p.hash,
    seed,
    map: {
      generator: "flat",
      size: 64,
      tribes,
      paint: [
        { shape: "rect", at: [32, 32], size: [12, 64], aboveSea: -30 },
        { shape: "rect", at: [0, 32], size: [12, 64], aboveSea: -30 },
      ],
    },
  };
}

function strait(tribes = 1): World {
  const w = new World(straitInit(5, tribes));
  w.spawnBuilding("hearth", 0, 12, 12);
  w.spawnUnit("shaper", 0, 14, 14);
  if (tribes > 1) {
    w.spawnBuilding("hearth", 1, 52, 52);
    w.spawnUnit("shaper", 1, 50, 50);
  }
  return w;
}

const at = (w: World, x: number, y: number) => x + y * w.terrain.size;
const step = (w: World, tribe: number, type: string, args: Record<string, unknown>) => w.step([{ tick: w.tick, tribe, type, args }]);

describe("vehicles (BACKLOG 10)", () => {
  it("the water layer walks only under the sea, the air layer everywhere; land cannot cross the strait", () => {
    const w = strait();
    const [land, water, air] = w.units.pfs;
    for (const pf of [land, water, air]) pf.refresh();
    expect(land.walkable(at(w, 20, 32))).toBe(true);
    expect(land.walkable(at(w, 32, 32))).toBe(false);
    expect(water.walkable(at(w, 32, 32))).toBe(true);
    expect(water.walkable(at(w, 20, 32))).toBe(false);
    expect(air.walkable(at(w, 20, 32)) && air.walkable(at(w, 32, 32))).toBe(true);
    expect(land.astar(at(w, 20, 32), at(w, 44, 32), 20000).ok).toBe(false);
    expect(water.astar(at(w, 27, 10), at(w, 37, 50), 20000).ok).toBe(true);
    expect(air.astar(at(w, 20, 32), at(w, 44, 32), 20000).ok).toBe(true);
    expect(w.units.nav[w.cfg.unitIndex.get("boat")!]).toBe(NAV.water);
    expect(w.units.nav[w.cfg.unitIndex.get("balloon")!]).toBe(NAV.air);
    expect(w.units.nav[w.cfg.unitIndex.get("settler")!]).toBe(NAV.land);
  });

  it("vehicles are not followers, never drown, and a boat ordered inland stops on the nearest water", () => {
    const w = strait();
    const before = w.economy.followers(0);
    const b = w.ents.index(w.spawnUnit("boat", 0, 32, 20));
    w.spawnUnit("balloon", 0, 30, 40);
    expect(w.economy.followers(0)).toBe(before);
    step(w, 0, "move", { units: [w.ents.idOf(b)], to: [20, 20] });
    w.run(200);
    expect(w.ents.alive[b]).toBe(1);
    expect(w.terrain.heightAt(w.ents.x[b], w.ents.y[b])).toBeLessThan(w.terrain.sea);
    expect(w.ents.x[b]).toBeLessThan(27);
    expect(w.invariants()).toEqual([]);
  });

  it("board and unload validate: vehicles cannot board, a full vehicle is refused, unload needs a vehicle", () => {
    const w = strait();
    const boat = w.spawnUnit("boat", 0, 27, 32);
    const other = w.spawnUnit("boat", 0, 27, 36);
    step(w, 0, "board", { units: [other], vehicle: boat });
    step(w, 0, "unload", { units: "tribe0.settlers" });
    const rejected = w.events.filter((e) => e.type === "commandRejected");
    expect(w.eventCounts.get("commandRejected")).toBe(2);
    expect(rejected.at(-1)?.reason).toBe("no vehicles selected");
    // six walkers for five seats: only five set off
    for (let k = 0; k < 6; k++) w.spawnUnit("settler", 0, 20, 28 + k);
    step(w, 0, "board", { units: "tribe0.settlers", vehicle: boat });
    expect(w.count((i) => w.ents.cat[i] === CAT.unit && w.ents.task[i] === TASK.toBoard)).toBe(5);
    w.run(300);
    const bi = w.ents.index(boat);
    expect(w.ents.occupants[bi]).toBe(5);
    step(w, 0, "board", { units: "tribe0.settlers", vehicle: boat });
    expect(w.events.some((e) => e.type === "commandRejected" && e.reason === "the vehicle is full")).toBe(true);
    // riders take no orders of their own: the selector skips them
    expect(w.selectUnits("tribe0.settlers").length).toBe(1);
    expect(w.invariants()).toEqual([]);
  });

  it("a Boathouse needs water beside it", () => {
    const w = strait();
    const bh = w.cfg.buildingIndex.get("boathouse")!;
    expect(w.economy.planBlocker(bh, 16, 44)).toBe("needs water beside it");
    expect(w.economy.planBlocker(bh, 21, 44)).toBeNull();
    expect(w.economy.planBlocker(w.cfg.buildingIndex.get("dwelling")!, 16, 44)).toBeNull();
  });

  it("a world with riders aboard a moving boat restores to the same future hashes", () => {
    const init = straitInit(9);
    const a = new World(init);
    a.spawnBuilding("hearth", 0, 12, 12);
    a.spawnUnit("shaper", 0, 14, 14);
    const boat = a.spawnUnit("boat", 0, 27, 32);
    for (let k = 0; k < 3; k++) a.spawnUnit("settler", 0, 20, 30 + k);
    const cmds = (tick: number) =>
      tick === 1
        ? [{ tick, tribe: 0, type: "board", args: { units: "tribe0.settlers", vehicle: boat } }]
        : tick === 200
          ? [{ tick, tribe: 0, type: "unload", args: { units: [boat], to: [44, 32] } }]
          : [];
    a.run(220, cmds);
    expect(a.count((i) => a.ents.task[i] === TASK.ride)).toBe(3);
    const b = World.restore(init, a.snapshot());
    expect(b.hash()).toEqual(a.hash());
    a.run(400, cmds);
    b.run(400, cmds);
    expect(b.hash()).toEqual(a.hash());
    expect(a.count((i) => a.ents.task[i] === TASK.ride)).toBe(0);
    expect(a.eventCounts.get("unloaded")).toBe(1);
  });

  it("D+F review: a loaded boat is never beguiled; the Shaper cannot board; riders earn idle mana", () => {
    const w = strait(2);
    const E = w.ents;
    const boat = E.index(w.spawnUnit("boat", 0, 27, 32));
    const rider = E.index(w.spawnUnit("settler", 0, 21, 32));
    step(w, 0, "board", { units: "tribe0.shapers", vehicle: E.idOf(boat) });
    expect(w.events.at(-1)?.reason).toBe("the Shaper cannot board");
    step(w, 0, "board", { units: [E.idOf(rider)], vehicle: E.idOf(boat) });
    w.run(200);
    expect(E.inside[rider]).toBe(boat);
    const idle = w.cfg.pack.units.units[E.type[rider]].manaPerMin.idle;
    expect(w.economy.manaRate(rider)).toBe(idle);
    applyEffects({ w, tribe: 1, spell: "beguile", x: E.x[boat], y: E.y[boat], casterX: E.x[boat] + 4, casterY: E.y[boat] }, [{ type: "statusApply", status: "beguiled", seconds: 12, radius: 3 }]);
    expect(E.tribe[boat]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("D+F review: a tribe eliminated at sea drowns its riders whatever their index order", () => {
    const w = strait(2);
    const E = w.ents;
    // the rider is spawned before the boat, so its index is lower
    const rider = E.index(w.spawnUnit("settler", 0, 21, 32));
    const boat = E.index(w.spawnUnit("boat", 0, 27, 32));
    expect(rider).toBeLessThan(boat);
    step(w, 0, "board", { units: [E.idOf(rider)], vehicle: E.idOf(boat) });
    w.run(200);
    step(w, 0, "move", { units: [E.idOf(boat)], to: [32, 50] });
    w.run(300);
    expect(w.terrain.drowns(E.x[boat], E.y[boat])).toBe(true);
    w.combat.releaseTribe(0);
    w.run(1);
    expect(E.alive[boat]).toBe(0);
    expect(E.alive[rider]).toBe(0);
    expect(w.invariants()).toEqual([]);
  });
});

describe("BACKLOG 98: long sea routes", () => {
  it("a boat whose only route runs around a long land wall gets there (more than maxExpandPerSearch)", () => {
    const p = basePack();
    // a 256 sea with two north-south land walls (x 0 and x 128); the x 128 wall has a gap at y 180 to 192
    const w = new World({
      pack: p.files,
      packHash: p.hash,
      seed: 9,
      map: {
        generator: "flat",
        size: 256,
        tribes: 1,
        paint: [
          { shape: "rect", at: [128, 128], size: [256, 256], aboveSea: -30, falloff: 0 },
          { shape: "rect", at: [0, 128], size: [6, 256], aboveSea: 6, falloff: 0 },
          { shape: "rect", at: [128, 90], size: [6, 180], aboveSea: 6, falloff: 0 },
          { shape: "rect", at: [128, 224], size: [6, 64], aboveSea: 6, falloff: 0 },
        ],
      },
    });
    w.spawnBuilding("hearth", 0, 0, 40);
    w.spawnUnit("shaper", 0, 0, 46);
    const water = w.units.pfs[1];
    water.refresh();
    const limit = w.cfg.pack.balance.movement.maxExpandPerSearch;
    const direct = water.astar(at(w, 120, 60), at(w, 136, 60), limit);
    expect(direct.ok).toBe(false);
    expect(direct.expanded).toBeGreaterThan(limit);
    const b = w.ents.index(w.spawnUnit("boat", 0, 120, 60));
    step(w, 0, "move", { units: [w.ents.idOf(b)], to: [136, 60] });
    for (let k = 0; k < 400 && Math.hypot(w.ents.x[b] - 136, w.ents.y[b] - 60) > 3; k++) w.run(30);
    expect(w.eventCounts.get("orderFailed") ?? 0).toBe(0);
    expect(Math.hypot(w.ents.x[b] - 136, w.ents.y[b] - 60)).toBeLessThan(3);
  });
});

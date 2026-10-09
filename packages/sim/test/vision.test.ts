// BACKLOG 3: fog of war. Per tribe visible and explored grids from own units' and buildings' sight.
import { describe, expect, it } from "vitest";
import { World } from "../src/world.ts";
import type { Command } from "../src/commands.ts";
import { basePack, world } from "./helpers.ts";

const duel = (fog?: boolean) => {
  const w = world({ generator: "flat", size: 64, tribes: 2, ...(fog === undefined ? {} : { fog }) });
  w.spawnBuilding("hearth", 0, 8, 8);
  w.spawnBuilding("hearth", 1, 40, 40);
  w.spawnUnit("settler", 0, 6, 6);
  w.spawnUnit("settler", 1, 44, 44);
  return w;
};

describe("fog of war (BACKLOG 3)", () => {
  it("a tribe sees around its own units and buildings, not the enemy far away", () => {
    const w = duel();
    w.step([]);
    const v = w.vision;
    expect(v.on).toBe(true);
    expect(v.sees(0, 8, 8)).toBe(true);
    expect(v.sees(0, 40, 40)).toBe(false);
    expect(v.sees(1, 40, 40)).toBe(true);
    const enemy = w.ents.index(w.spawnUnit("warden", 1, 42, 40));
    expect(v.seesEntity(0, enemy)).toBe(false);
    expect(v.seesEntity(1, enemy)).toBe(true);
    // god mode and own units always see
    expect(v.sees(-1, 40, 40)).toBe(true);
    expect(v.exploredShare(0)).toBeGreaterThan(0);
    expect(v.exploredShare(0)).toBeLessThan(0.2);
  });

  it("explored ground stays mapped after the scout leaves; visible follows the scout", () => {
    const w = duel();
    const s = w.spawnUnit("warden", 0, 20, 20);
    w.step([]);
    expect(w.vision.sees(0, 22, 20)).toBe(true);
    const cmd: Command = { tick: w.tick, tribe: 0, type: "move", args: { units: [s], to: [8, 30] } };
    w.step([cmd]);
    w.run(400);
    expect(w.vision.sees(0, 22, 20)).toBe(false);
    expect(w.vision.seen(0, 22, 20)).toBe(true);
    expect(w.vision.sees(0, 8, 30)).toBe(true);
  });

  it("a tribe that lost its Hearth is revealed to everyone", () => {
    const w = duel();
    w.step([]);
    const far = w.ents.index(w.spawnUnit("warden", 1, 50, 50));
    expect(w.vision.seesEntity(0, far)).toBe(false);
    w.kill(w.ents.index(w.tribes[1].hearth), "test");
    expect(w.vision.seesEntity(0, far)).toBe(true);
  });

  it("can be turned off per map; then nothing is hashed or saved", () => {
    const w = duel(false);
    w.step([]);
    expect(w.vision.on).toBe(false);
    expect(w.vision.sees(0, 40, 40)).toBe(true);
    expect(w.snapshot().vision).toBeUndefined();
  });

  it("snapshot and restore keep the grids (same future hashes)", () => {
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 5, map: { generator: "continents", size: 128, tribes: 2 } };
    const a = new World(init);
    a.run(150);
    const b = World.restore(init, a.snapshot());
    expect(b.vision.exploredShare(0)).toBe(a.vision.exploredShare(0));
    a.run(100);
    b.run(100);
    expect(b.hash().all).toBe(a.hash().all);
  });
});

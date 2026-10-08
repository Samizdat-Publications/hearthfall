import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import { walkableComponents } from "../src/generator.ts";
import { wrapDelta } from "../src/terrain.ts";
import { world } from "./helpers.ts";

describe("planet generator", () => {
  for (const generator of ["continents", "islands"]) {
    for (const seed of [1, 2, 3, 4]) {
      it(`${generator} seed ${seed}: connected hearths, spacing, land, trees, wild`, () => {
        const w = world({ generator, size: 128, tribes: 4 }, seed);
        const t = w.terrain;
        const hearths = w.tribes.map((tr) => w.ents.index(tr.hearth));
        expect(hearths.every((i) => i >= 0)).toBe(true);
        const comp = walkableComponents(t);
        const label = comp.labels[t.idx(w.ents.x[hearths[0]], w.ents.y[hearths[0]])];
        expect(label).toBeGreaterThan(0);
        for (const i of hearths) expect(comp.labels[t.idx(w.ents.x[i], w.ents.y[i])]).toBe(label);
        const minSpacing = w.cfg.pack.terrain.hearth.minSpacingFracOfSize * 128;
        for (const a of hearths) for (const b of hearths) {
          if (a === b) continue;
          const dx = wrapDelta(w.ents.x[a] - w.ents.x[b], 128);
          const dy = wrapDelta(w.ents.y[a] - w.ents.y[b], 128);
          expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThanOrEqual(minSpacing - 1e-9);
        }
        const preset = w.cfg.pack.terrain.presets.find((p) => p.id === generator)!;
        expect(Math.abs(w.mapInfo.landFraction - preset.landFraction)).toBeLessThan(0.03);
        const trees = w.count((i) => w.ents.cat[i] === CAT.tree);
        expect(trees).toBeGreaterThan(40);
        w.count((i) => {
          if (w.ents.cat[i] === CAT.tree) expect(t.heightAt(w.ents.x[i], w.ents.y[i])).toBeGreaterThan(t.sea);
          return false;
        });
        const wild = w.count((i) => w.ents.cat[i] === CAT.unit && w.ents.tribe[i] === -1);
        expect(wild).toBeGreaterThanOrEqual(6 * 4 - 4);
      });
    }
  }

  it("is deterministic: same seed, same planet; different seed, different planet", () => {
    const a = world({ generator: "continents", size: 128, tribes: 2 }, 11).hash();
    const b = world({ generator: "continents", size: 128, tribes: 2 }, 11).hash();
    const c = world({ generator: "continents", size: 128, tribes: 2 }, 12).hash();
    expect(a).toEqual(b);
    expect(a.terrain).not.toBe(c.terrain);
  });
});

describe("world step", () => {
  it("runs deterministically with commands; hash parts pinpoint the changed component", () => {
    const cmds = (tick: number) => (tick === 5 ? [{ tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 20, y: 20, r: 6, depth: 30 } }] : []);
    const a = world({ generator: "flat", size: 64, tribes: 1 }, 3);
    const b = world({ generator: "flat", size: 64, tribes: 1 }, 3);
    a.run(40, cmds);
    b.run(40, cmds);
    expect(a.hash()).toEqual(b.hash());
    const c = world({ generator: "flat", size: 64, tribes: 1 }, 3);
    c.run(40);
    const ha = a.hash();
    const hc = c.hash();
    expect(ha.terrain).not.toBe(hc.terrain);
    expect(ha.entities).toBe(hc.entities);
    expect(ha.meta).toBe(hc.meta);
  });

  it("rejects invalid commands with an event and never throws", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    w.step([
      { tick: 0, tribe: 0, type: "terrainOp", args: { op: "explode", x: 1, y: 1, r: 2 } },
      { tick: 0, tribe: 0, type: "terrainOp", args: { op: "raise", x: 1, y: 1, r: 2 } },
      { tick: 0, tribe: 7, type: "noop", args: {} },
      { tick: 0, tribe: 0, type: "teleport", args: {} },
    ]);
    expect(w.eventCounts.get("commandRejected")).toBe(4);
    expect(w.terrain.version).toBe(0);
  });

  it("units drown when the land under them sinks, trees flood", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    w.spawnUnit("wild", -1, 30, 30);
    w.spawnUnit("wild", -1, 50, 50);
    w.spawnTree(30.5, 30.5);
    w.step([{ tick: 0, tribe: -1, type: "terrainOp", args: { op: "set", x: 30, y: 30, r: 3, value: 60 } }]);
    w.step([{ tick: 1, tribe: 0, type: "terrainOp", args: { op: "set", x: 50, y: 50, r: 3, value: 60 } }]);
    expect(w.eventCounts.get("commandRejected")).toBe(1);
    expect(w.eventCounts.get("drowned")).toBe(1);
    expect(w.eventCounts.get("flooded")).toBe(1);
    expect(w.count((i) => w.ents.cat[i] === CAT.unit)).toBe(1);
  });

  it("entity ids go stale after free and slots are reused with a new generation", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const id = w.spawnTree(1, 1);
    expect(w.ents.index(id)).toBeGreaterThanOrEqual(0);
    w.ents.free(id);
    expect(w.ents.index(id)).toBe(-1);
    const id2 = w.spawnTree(2, 2);
    expect(id2 & 0xffff).toBe(id & 0xffff);
    expect(id2).not.toBe(id);
  });
});

describe("snapshot and restore", () => {
  it("a restored world produces the same future hashes", async () => {
    const { basePack } = await import("./helpers.ts");
    const { World } = await import("../src/world.ts");
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 21, map: { generator: "continents", size: 128, tribes: 2 } };
    const cmds = (tick: number) => (tick % 97 === 0 ? [{ tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: tick % 128, y: (tick * 7) % 128, r: 5, depth: 20 } }] : []);
    const a = new World(init);
    a.spawnTree(3, 3);
    a.run(300, cmds);
    const snap = a.snapshot();
    const b = World.restore(init, snap);
    expect(b.hash()).toEqual(a.hash());
    a.run(300, cmds);
    b.run(300, cmds);
    expect(b.hash()).toEqual(a.hash());
    expect(b.tick).toBe(600);
  });
});

describe("snapshot with moving units and terrain edits (M3 review regression)", () => {
  it("restored world matches after a terrain op while units follow paths", async () => {
    const { basePack } = await import("./helpers.ts");
    const { World } = await import("../src/world.ts");
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 8, map: { generator: "flat_with_lake", size: 64, tribes: 1 } };
    const a = new World(init);
    for (let k = 0; k < 12; k++) a.spawnUnit("settler", 0, 8 + (k % 4), 10 + Math.floor(k / 4));
    a.step([{ tick: 0, tribe: 0, type: "move", args: { units: "tribe0.settlers", to: [56, 54] } }]);
    a.run(30);
    a.step([{ tick: a.tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 20, y: 20, r: 5, depth: 20, seed: 3 } }]);
    const snap = a.snapshot();
    const b = World.restore(init, snap);
    expect(b.hash()).toEqual(a.hash());
    a.run(200);
    b.run(200);
    expect(b.hash()).toEqual(a.hash());
  });
});

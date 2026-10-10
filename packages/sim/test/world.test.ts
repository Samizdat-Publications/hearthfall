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
        // BACKLOG 0a: every village is ringed by a grove (look v2 pine belts)
        const g = w.cfg.pack.terrain.trees.hearthGrove!;
        for (const h of hearths) {
          const ring = w.count((i) => {
            if (w.ents.cat[i] !== CAT.tree) return false;
            const dx = wrapDelta(w.ents.x[i] - w.ents.x[h], 128);
            const dy = wrapDelta(w.ents.y[i] - w.ents.y[h], 128);
            const d = Math.sqrt(dx * dx + dy * dy);
            return d >= g.inner && d <= g.outer;
          });
          // gentle land in the ring (the generator's tree rule), so a coastal village is judged by its land
          let land = 0;
          for (let dy = -g.outer; dy <= g.outer; dy++) {
            for (let dx = -g.outer; dx <= g.outer; dx++) {
              const d2 = dx * dx + dy * dy;
              const x = Math.round(w.ents.x[h]) + dx;
              const y = Math.round(w.ents.y[h]) + dy;
              if (d2 >= g.inner * g.inner && d2 <= g.outer * g.outer && t.get(x, y) >= t.sea + 4 && t.slope(x, y) <= w.cfg.pack.terrain.trees.maxSlope) land++;
            }
          }
          expect(ring).toBeGreaterThanOrEqual(0.12 * land);
        }
      });
    }
  }

  it("terraced presets (BACKLOG 0a): level plateaus and cliff bands, and the walkable land stays connected", async () => {
    const { basePack } = await import("./helpers.ts");
    const { World } = await import("../src/world.ts");
    const on = basePack();
    const offFiles = structuredClone(on.files);
    for (const p of offFiles.terrain.presets) delete p.terrace;
    const stats = (files: typeof on.files, generator: string, seed: number) => {
      const w = new World({ pack: files, packHash: on.hash, seed, map: { generator, size: 128, tribes: 2 } });
      const t = w.terrain;
      let land = 0;
      let level = 0;
      let cliff = 0;
      for (let y = 0; y < 128; y++) {
        for (let x = 0; x < 128; x++) {
          if (!t.isLand(x, y)) continue;
          land++;
          const s = t.slope(x, y);
          if (s <= 2) level++;
          if (s > t.maxWalkSlope * 0.85) cliff++;
        }
      }
      const c = walkableComponents(t);
      return { level: level / land, cliff: cliff / land, connected: c.sizes[c.largest] / land };
    };
    for (const generator of ["continents", "islands"]) {
      expect(on.files.terrain.presets.find((p) => p.id === generator)!.terrace).toBeDefined();
      for (const seed of [1, 2]) {
        const a = stats(offFiles, generator, seed);
        const b = stats(on.files, generator, seed);
        expect(b.level).toBeGreaterThan(2.5 * a.level);
        expect(b.cliff).toBeGreaterThan(1.3 * a.cliff);
        expect(b.connected).toBeGreaterThan(a.connected - 0.05);
      }
    }
  });

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

  it("occupants of a building destroyed on drowned ground drown as they walk out (regression, ai soak seed 1002)", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const E = w.ents;
    const b = E.index(w.spawnBuilding("dwelling", 1, 30, 30));
    const s = E.index(w.spawnUnit("settler", 1, 30, 30));
    E.inside[s] = b;
    E.occupants[b] = 1;
    E.task[s] = 7;
    // the land under the standing dwelling sank (a building is not lost to water by itself)
    const t = w.terrain;
    for (let y = 26; y <= 34; y++) for (let x = 26; x <= 34; x++) t.heights[t.idx(x, y)] = 60;
    t.version++;
    expect(t.drowns(30, 30)).toBe(true);
    w.kill(b, "destroyed");
    expect(E.alive[s]).toBe(0);
    expect(w.eventCounts.get("drowned")).toBe(1);
    expect(w.invariants()).toEqual([]);
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
    expect([...b.eventCounts]).toEqual([...a.eventCounts]);
  });

  it("BACKLOG 35: a snapshot carries its origin; it rebuilds from the pack alone and refuses a different world", async () => {
    const { basePack } = await import("./helpers.ts");
    const { World } = await import("../src/world.ts");
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 21, map: { generator: "continents", size: 128, tribes: 2 }, weather: "rain" as const };
    const a = new World(init);
    a.run(200);
    const snap = JSON.parse(JSON.stringify(a.snapshot(), (_k, v) => (ArrayBuffer.isView(v) ? { $t: v.constructor.name, d: Array.from(v as Int16Array) } : v)), (_k, v) =>
      v && typeof v === "object" && "$t" in v ? new (globalThis as unknown as Record<string, new (d: number[]) => unknown>)[v.$t](v.d) : v,
    );
    expect(snap.origin).toEqual({ packHash: p.hash, seed: 21, map: { generator: "continents", size: 128, tribes: 2 }, weather: "rain" });
    const b = World.fromSnapshot(p.files, snap);
    expect(b.hash()).toEqual(a.hash());
    expect([...b.eventCounts]).toEqual([...a.eventCounts]);
    a.run(100);
    b.run(100);
    expect(b.hash().all).toBe(a.hash().all);
    // same spec in another key order is the same world
    expect(() => World.restore({ ...init, map: { tribes: 2, size: 128, generator: "continents" } }, snap)).not.toThrow();
    expect(() => World.restore({ ...init, seed: 22 }, snap)).toThrow(/seed 21 vs 22/);
    expect(() => World.restore({ ...init, map: { ...init.map, size: 96 } }, snap)).toThrow(/different map/);
    expect(() => World.restore({ ...init, weather: "clear" }, snap)).toThrow(/weather/);
    expect(() => World.restore({ ...init, packHash: "x" }, snap)).toThrow(/different game data/);
    const { origin: _o, ...old } = snap;
    expect(() => World.fromSnapshot(p.files, old)).toThrow(/no origin/);
    expect(World.restore(init, old).hash().all).toBe(World.restore(init, snap).hash().all);
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

  it("a save between a terrain edit and the next unit step keeps lone A* walkers on their routes (S2 e2e regression)", async () => {
    const { basePack } = await import("./helpers.ts");
    const { World } = await import("../src/world.ts");
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 8, map: { generator: "flat_with_lake", size: 64, tribes: 1 } };
    const a = new World(init);
    // a lone walker follows an A* path (no flow field) far from the edit; a group follows a flow field
    const lone = a.spawnUnit("settler", 0, 8, 50);
    for (let k = 0; k < 12; k++) a.spawnUnit("settler", 0, 8 + (k % 4), 10 + Math.floor(k / 4));
    a.step([{ tick: 0, tribe: 0, type: "move", args: { units: [lone], to: [30, 58] } }]);
    a.step([{ tick: a.tick, tribe: 0, type: "move", args: { units: "tribe0.settlers", to: [56, 54] } }]);
    a.run(20);
    a.step([{ tick: a.tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 40, y: 20, r: 4, depth: 20, seed: 3 } }]);
    const snap = a.snapshot();
    expect(snap.terrainDirty?.length).toBeGreaterThan(0);
    const b = World.restore(init, snap);
    for (let k = 0; k < 60; k++) {
      a.step([]);
      b.step([]);
      expect(b.hash().all, `tick ${a.tick}`).toBe(a.hash().all);
    }
  });
});

describe("plans on the seam (M4 soak regression)", () => {
  it("a plan centered on the wrap seam stays inside the map", async () => {
    const { world } = await import("./helpers.ts");
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const id = w.economy.placePlan(0, w.cfg.buildingIndex.get("dwelling")!, 64, 10);
    const i = w.ents.index(id);
    expect(w.ents.x[i]).toBeGreaterThanOrEqual(0);
    expect(w.ents.x[i]).toBeLessThan(64);
    expect(w.invariants()).toEqual([]);
  });
});

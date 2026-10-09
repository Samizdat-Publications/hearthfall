import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import { World } from "../src/world.ts";
import { basePack, world } from "./helpers.ts";

const cmd = (tribe: number, type: string, args: Record<string, unknown>, tick = 0) => [{ tick, tribe, type, args }];

/** Flat map with tribe 0's Shaper at (10, 32) and a deep lake around (45, 32). */
function lakeWorld() {
  const w = world({ generator: "flat", size: 64, tribes: 1 });
  const s = w.spawnUnit("shaper", 0, 10, 32);
  for (let k = 0; k < 6; k++) w.step(cmd(-1, "terrainOp", { op: "lowerTowardSea", x: 45, y: 32, r: 12, amount: 200 }));
  return { w, s };
}

describe("spells (M5 review follow-ups, BACKLOG 54)", () => {
  it("a queued cast at an unreachable target is dropped with castFailed instead of re-ordering forever", () => {
    const { w, s } = lakeWorld();
    expect(w.terrain.isLand(45, 32)).toBe(false);
    w.step(cmd(0, "cast", { spell: "bolt", target: [45, 32] }));
    expect(w.eventCounts.get("castQueued")).toBe(1);
    w.run(40 * 20);
    expect(w.tribes[0].pending).toBeNull();
    expect(w.eventCounts.get("castFailed")).toBe(1);
    expect(w.eventCounts.get("orderFailed") ?? 0).toBeLessThanOrEqual(2);
    expect(w.ents.alive[w.ents.index(s)]).toBe(1);
    const bolt = w.cfg.spellIndex.get("bolt")!;
    expect(w.tribes[0].eco.charges[bolt]).toBeGreaterThan(0);
  });

  it("a queued cast survives a detour: the Shaper keeps walking while she gets closer", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    w.spawnUnit("shaper", 0, 10, 32);
    w.step(cmd(0, "cast", { spell: "bolt", target: [40, 32] }));
    w.run(30 * 20);
    expect(w.eventCounts.get("castFailed") ?? 0).toBe(0);
    expect(w.eventCounts.get("castBegun")).toBe(1);
  });

  it("statusApply max counts enemies only", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnUnit("shaper", 0, 10, 10);
    for (let k = 0; k < 6; k++) w.spawnUnit("settler", 0, 30 + k * 0.2, 30);
    const foes = [0, 1, 2].map((k) => w.ents.index(w.spawnUnit("settler", 1, 30.5 + k * 0.2, 30.5)));
    const { applyEffects } = w as unknown as { applyEffects?: unknown };
    void applyEffects;
    return import("../src/effects.ts").then(({ applyEffects: apply }) => {
      apply({ w, tribe: 0, spell: "hornets", x: 30.5, y: 30.2, casterX: 10, casterY: 10 }, [{ type: "statusApply", status: "panic", seconds: 5, radius: 3, max: 3 }]);
      expect(foes.every((i) => w.ents.panic[i] > 0)).toBe(true);
      let own = 0;
      for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === 0 && w.ents.panic[i] > 0) own++;
      expect(own).toBe(0);
      // own-target statuses (BACKLOG 1) land on the caster's units only, and max counts those
      apply({ w, tribe: 0, spell: "veil", x: 30.5, y: 30.2, casterX: 10, casterY: 10 }, [{ type: "statusApply", status: "veil", targets: "own", seconds: 5, radius: 3, max: 4 }]);
      let veiled = 0;
      for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.veil[i] > 0) veiled += w.ents.tribe[i] === 0 ? 1 : 100;
      expect(veiled).toBe(4);
      expect(() => apply({ w, tribe: 0, spell: "veil", x: 30, y: 30, casterX: 10, casterY: 10 }, [{ type: "statusApply", status: "entranced", seconds: 5, radius: 2 }])).toThrow(/not a spell status/);
    });
  });

  it("a tribe with a Hearth is eliminated once its Shaper is dead and its last follower is gone", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnBuilding("hearth", 1, 40, 40);
    w.spawnUnit("shaper", 0, 12, 12);
    const s1 = w.spawnUnit("shaper", 1, 42, 42);
    const f = w.spawnUnit("settler", 1, 44, 44);
    w.step();
    w.kill(w.ents.index(s1), "test");
    w.run(5);
    expect(w.tribes[1].alive).toBe(true);
    w.kill(w.ents.index(f), "test");
    w.run(5);
    expect(w.tribes[1].alive).toBe(false);
    expect(w.eventCounts.get("tribeEliminated")).toBe(1);
    w.run(40 * 20);
    expect(w.eventCounts.get("shaperRespawned") ?? 0).toBe(0);
    expect(w.eventCounts.get("tribeEliminated")).toBe(1);
  });

  it("a Shaper whose Hearth is gone does not respawn and her tribe falls; two tribes can fall on the same tick", () => {
    const w = world({ generator: "flat", size: 64, tribes: 3 });
    const hs = [w.spawnBuilding("hearth", 0, 10, 10), w.spawnBuilding("hearth", 1, 40, 10), w.spawnBuilding("hearth", 2, 40, 40)];
    const sh = [w.spawnUnit("shaper", 0, 12, 12), w.spawnUnit("shaper", 1, 42, 12), w.spawnUnit("shaper", 2, 42, 42)];
    w.spawnUnit("settler", 1, 44, 12);
    w.spawnUnit("settler", 2, 44, 42);
    w.step();
    for (const t of [1, 2]) {
      w.kill(w.ents.index(hs[t]), "test");
      w.kill(w.ents.index(sh[t]), "test");
    }
    w.step();
    expect(w.tribes[1].alive).toBe(false);
    expect(w.tribes[2].alive).toBe(false);
    expect(w.tribes[0].alive).toBe(true);
    expect(w.eventCounts.get("tribeEliminated")).toBe(2);
    w.run(40 * 20);
    expect(w.eventCounts.get("shaperRespawned") ?? 0).toBe(0);
    expect(w.count((i) => w.ents.cat[i] === CAT.unit && (w.ents.tribe[i] === 1 || w.ents.tribe[i] === 2))).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("a snapshot taken mid-cast restores into the same future", () => {
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 5, map: { generator: "flat", size: 64, tribes: 2 } };
    const a = new World(init);
    a.spawnBuilding("hearth", 0, 10, 10);
    a.spawnBuilding("hearth", 1, 40, 40);
    a.spawnUnit("shaper", 0, 20, 20);
    for (let k = 0; k < 4; k++) a.spawnUnit("settler", 1, 23 + k * 0.3, 21);
    a.step(cmd(0, "cast", { spell: "bolt", target: [23.5, 21] }));
    expect(a.tribes[0].casting).not.toBeNull();
    const b = World.restore(init, a.snapshot());
    expect(b.hash()).toEqual(a.hash());
    a.run(200);
    b.run(200);
    expect(b.hash()).toEqual(a.hash());
    expect(b.eventCounts.get("spellCast")).toBe(1);
  });
});

describe("eliminate (M8 debug forced win)", () => {
  it("god mode eliminate kills the Shaper and Hearth and the tribe is out the same tick; players cannot use it", () => {
    const w = world({ generator: "continents", size: 96, tribes: 2 });
    w.step(cmd(0, "eliminate", { tribe: 1 }));
    expect(w.tribes[1].alive).toBe(true);
    expect(w.eventCounts.get("commandRejected")).toBe(1);
    w.step(cmd(-1, "eliminate", { tribe: 1 }));
    expect(w.tribes[1].alive).toBe(false);
    expect(w.eventCounts.get("tribeEliminated")).toBe(1);
    expect(w.tribes[0].alive).toBe(true);
  });
});

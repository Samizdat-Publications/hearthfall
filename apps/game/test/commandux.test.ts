// BACKLOG 4 command UX: double-click type select, control group camera jump, spell preview counts, undo countdown.
import { describe, expect, it } from "vitest";
import { areaLine } from "@hearthfall/ui";
import { world } from "../../../packages/sim/test/helpers.ts";
import { areaCounts, groupCenter, sameTypeNear, undoLeft } from "../src/troops.ts";

function field(fog?: boolean) {
  const w = world({ generator: "flat", size: 64, tribes: 2, ...(fog === undefined ? {} : { fog }) });
  w.spawnBuilding("hearth", 0, 8, 8);
  w.spawnBuilding("hearth", 1, 40, 40);
  return w;
}

describe("command UX polish (BACKLOG 4)", () => {
  it("double-click selects own units of the same type nearby, not other types, tribes or far ones", () => {
    const w = field();
    const E = w.ents;
    const a = E.index(w.spawnUnit("warden", 0, 20, 20));
    const b = E.index(w.spawnUnit("warden", 0, 24, 22));
    const far = E.index(w.spawnUnit("warden", 0, 50, 50));
    E.index(w.spawnUnit("settler", 0, 21, 20));
    E.index(w.spawnUnit("warden", 1, 22, 20));
    expect(sameTypeNear(w, 0, a, 14).sort()).toEqual([a, b].sort());
    expect(sameTypeNear(w, 0, a, 14)).not.toContain(far);
    expect(sameTypeNear(w, 1, a, 14)).toEqual([]);
  });

  it("the group center wraps around the planet edge", () => {
    const w = field();
    const E = w.ents;
    const g = [E.index(w.spawnUnit("warden", 0, 62, 10)), E.index(w.spawnUnit("warden", 0, 2, 10))];
    const c = groupCenter(w, g)!;
    expect(Math.min(c[0], 64 - c[0])).toBeLessThan(0.01);
    expect(c[1]).toBeCloseTo(10, 5);
    expect(groupCenter(w, [])).toBeNull();
  });

  it("the spell preview counts own units and only the enemies the tribe can see", () => {
    const w = field();
    w.spawnUnit("settler", 0, 30, 30);
    w.spawnUnit("warden", 1, 31, 30);
    w.step([]);
    const fogged = areaCounts(w, 0, 30.5, 30, 3);
    expect(fogged.own).toBe(1);
    // own settler stands next to the enemy, so its sight reveals it
    expect(fogged.enemies).toBe(1);
    expect(areaLine({ enemies: 1, own: 2 })).toBe("1 enemy, 2 of yours in the area");
    expect(areaLine({ enemies: 0, own: 0 })).toBe("nobody in the area");
    expect(areaLine(null)).toBe("");
  });

  it("an enemy out of every own unit's sight is not counted", () => {
    const w = field();
    w.spawnUnit("warden", 1, 31, 30);
    w.step([]);
    expect(areaCounts(w, 0, 31, 30, 3)).toEqual({ enemies: 0, own: 0 });
    expect(areaCounts(w, 1, 31, 30, 3)).toEqual({ enemies: 0, own: 1 });
  });

  it("the undo countdown runs for the cast window and then disappears", () => {
    const w = field();
    w.spawnUnit("shaper", 0, 10, 10);
    const t = w.tribes[0];
    const spell = w.cfg.pack.spells.spells.findIndex((s) => s.id === "bolt");
    expect(undoLeft(w, 0)).toBe(-1);
    t.eco.charges[spell] = 1;
    w.step([{ tick: w.tick, tribe: 0, type: "cast", args: { spell: "bolt", target: [12, 10] } }]);
    expect(w.events.filter((e) => e.type === "commandRejected")).toEqual([]);
    const left = undoLeft(w, 0);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(w.cfg.pack.spells.chargeRules.undoSeconds);
    for (let k = 0; k < w.cfg.tickHz * 2; k++) w.step([]);
    expect(undoLeft(w, 0)).toBe(-1);
  });
});

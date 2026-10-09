// BACKLOG 2: the Shade. Disguised in enemy eyes until a detector (an enemy Shaper or Watchtower) comes
// near or it finishes a sabotage; an attack order on an enemy building (never a Hearth) or a tree starts a
// channel that sets the building alight (it burns down) or burns the tree. Damage breaks the channel.
import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import type { Command } from "../src/commands.ts";
import { world } from "./helpers.ts";

const duel = () => {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  w.spawnBuilding("hearth", 0, 8, 8);
  w.spawnBuilding("hearth", 1, 40, 40);
  // a follower each, so neither tribe counts as eliminated (no Shaper, no followers)
  w.spawnUnit("settler", 0, 6, 6);
  w.spawnUnit("settler", 1, 44, 44);
  return w;
};
const cmd = (w: ReturnType<typeof duel>, tribe: number, type: string, args: Record<string, unknown>): Command => ({ tick: w.tick, tribe, type, args });

describe("Shade (BACKLOG 2)", () => {
  it("is not attacked while disguised, then is once a sabotage reveals it", () => {
    const w = duel();
    const E = w.ents;
    const d = w.spawnBuilding("dwelling", 1, 30, 30);
    const s = w.spawnUnit("shade", 0, 27, 30);
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 1, 33, 28 + 2 * k);
    // the enemy cannot pick the disguised Shade out by hand either
    w.step([cmd(w, 1, "attack", { units: "tribe1.wardens", target: s })]);
    expect(w.eventCounts.get("commandRejected")).toBe(1);
    w.run(100);
    expect(E.hp[E.index(s)]).toBe(600);
    w.step([cmd(w, 0, "attack", { units: [s], target: d })]);
    w.run(200);
    expect(w.eventCounts.get("sabotageBegun")).toBe(1);
    expect(w.eventCounts.get("sabotaged")).toBe(1);
    expect(E.burn[E.index(d)]).toBeGreaterThan(0);
    // revealed: the Wardens close in and cut the Shade down; the dwelling burns down
    w.run(500);
    expect(E.index(s)).toBe(-1);
    expect(E.index(d)).toBe(-1);
    expect(w.invariants()).toEqual([]);
  });

  it("never targets a Hearth, and only Shades may be sent at trees, which burn away", () => {
    const w = duel();
    const E = w.ents;
    const s = w.spawnUnit("shade", 0, 36, 40);
    w.step([cmd(w, 0, "attack", { units: [s], target: w.tribes[1].hearth })]);
    w.run(200);
    expect(w.eventCounts.get("sabotageBegun") ?? 0).toBe(0);
    const tree = w.spawnTree(20, 20);
    const warden = w.spawnUnit("warden", 0, 10, 10);
    w.step([cmd(w, 0, "attack", { units: [warden], target: tree })]);
    expect(w.eventCounts.get("commandRejected")).toBe(1);
    w.step([cmd(w, 0, "attack", { units: [s], target: tree })]);
    w.run(600);
    expect(E.index(tree)).toBe(-1);
    expect(w.count((i) => E.cat[i] === CAT.tree)).toBe(0);
  });

  it("an enemy Watchtower or Shaper nearby reveals it", () => {
    const w = duel();
    const E = w.ents;
    w.spawnBuilding("watchtower", 1, 30, 30);
    const s = E.index(w.spawnUnit("shade", 0, 20, 30));
    w.run(8);
    expect(w.combat.disguised(s)).toBe(true);
    w.step([cmd(w, 0, "move", { units: [E.idOf(s)], to: [27, 30] })]);
    w.run(200);
    expect(w.eventCounts.get("shadeRevealed")).toBe(1);
    expect(w.combat.disguised(s)).toBe(false);
    // away from the tower the disguise returns after revealSeconds
    w.step([cmd(w, 0, "move", { units: [E.idOf(s)], to: [14, 30] })]);
    w.run(16 * 30);
    expect(w.combat.disguised(s)).toBe(true);
    const sh = w.spawnUnit("shaper", 1, 17, 30);
    w.run(8);
    expect(w.eventCounts.get("shadeRevealed")).toBe(2);
    expect(E.alive[E.index(sh)]).toBe(1);
  });

  it("damage breaks a sabotage channel", () => {
    const w = duel();
    const E = w.ents;
    const d = w.spawnBuilding("dwelling", 1, 30, 30);
    const s = w.spawnUnit("shade", 0, 28, 30);
    w.step([cmd(w, 0, "attack", { units: [s], target: d })]);
    w.run(90);
    expect(w.eventCounts.get("sabotageBegun")).toBe(1);
    expect(E.chant[E.index(s)]).toBeGreaterThan(0);
    w.damage(E.index(s), 10, 1, true, true);
    expect(w.eventCounts.get("sabotageBroken")).toBe(1);
    expect(E.chant[E.index(s)]).toBe(0);
  });
});

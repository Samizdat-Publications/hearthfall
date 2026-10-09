// BACKLOG 4: formations on move orders. Each unit gets its own slot around the goal, melee troops in front,
// ranged and chanters behind; slots are wrapped and spaced; a bad formation name is rejected.
import { describe, expect, it } from "vitest";
import type { Command } from "../src/commands.ts";
import { formationRank, formationSlots } from "../src/formation.ts";
import { ORDER } from "../src/units.ts";
import { world } from "./helpers.ts";

const TYPES = ["warden", "warden", "warden", "settler", "settler", "settler", "firecaller", "firecaller", "chanter"];

const army = () => {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  const ids = TYPES.map((t, k) => w.spawnUnit(t, 0, 8 + (k % 3), 30 + Math.floor(k / 3)));
  return { w, ids };
};

describe("formations (BACKLOG 4)", () => {
  it("ranks troops front to back by role", () => {
    const { w } = army();
    const rank = (t: string) => formationRank(w, w.cfg.pack.units.units.findIndex((u) => u.id === t));
    expect(rank("warden")).toBe(0);
    expect(rank("settler")).toBe(1);
    expect(rank("firecaller")).toBe(2);
    expect(rank("chanter")).toBe(2);
    expect(rank("shaper")).toBe(3);
  });

  it("a box gives distinct slots facing the goal, wardens in front and firecallers behind", () => {
    const { w, ids } = army();
    const idx = ids.map((id) => w.ents.index(id));
    const slots = formationSlots(w, idx, 40, 31, "box", 1.2);
    for (let a = 0; a < slots.length; a++)
      for (let b = a + 1; b < slots.length; b++) expect(Math.hypot(slots[a][0] - slots[b][0], slots[a][1] - slots[b][1])).toBeGreaterThan(1.1);
    // facing is +x, so front means larger x
    const front = Math.min(...slots.slice(0, 3).map((s) => s[0]));
    const back = Math.max(...slots.slice(6).map((s) => s[0]));
    expect(front).toBeGreaterThan(back);
    // centered on the goal
    const mx = slots.reduce((a, s) => a + s[0], 0) / slots.length;
    expect(Math.abs(mx - 40)).toBeLessThan(1.3);
    const line = formationSlots(w, idx, 40, 31, "line", 1.2);
    for (const s of line) expect(Math.abs(s[0] - 40)).toBeLessThan(1e-9);
  });

  it("a formation move command walks the group into its slots in the sim", () => {
    const { w, ids } = army();
    const cmd: Command = { tick: w.tick, tribe: 0, type: "move", args: { units: ids, to: [40, 31], formation: "box" } };
    w.step([cmd]);
    for (let k = 0; k < 30 * 25; k++) w.step([]);
    const E = w.ents;
    const idx = ids.map((id) => E.index(id));
    for (const i of idx) expect(E.order[i]).toBe(ORDER.none);
    const wx = idx.slice(0, 3).reduce((a, i) => a + E.x[i], 0) / 3;
    const fx = (E.x[idx[6]] + E.x[idx[7]]) / 2;
    expect(wx).toBeGreaterThan(fx + 1);
    expect(w.invariants()).toEqual([]);
  });

  it("rejects an unknown formation and leaves orders without one unchanged", () => {
    const { w, ids } = army();
    w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: ids, to: [40, 31], formation: "wedge" } }]);
    expect(w.events.some((e) => e.type === "commandRejected")).toBe(true);
    expect(w.ents.order[w.ents.index(ids[0])]).toBe(ORDER.none);
  });
});

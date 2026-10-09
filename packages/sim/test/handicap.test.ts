// BACKLOG 6: an AI difficulty's resource multiplier scales its tribe's mana income through the
// handicap command; a player without an AI controller can never set one, god mode can.
import { describe, expect, it } from "vitest";
import type { World } from "../src/world.ts";
import { world } from "./helpers.ts";

/** run one tick with the command and return its rejection reason, if any */
const reject = (w: World, c: { tribe: number; args: Record<string, unknown> }): string | null => {
  w.step([{ tick: w.tick, type: "handicap", ...c }]);
  const e = w.events.find((x) => x.type === "commandRejected") as { reason?: string } | undefined;
  return e?.reason ?? null;
};

const two = () => {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  for (const tr of [0, 1]) {
    w.spawnUnit("shaper", tr, 10 + tr * 30, 10);
    for (let k = 0; k < 4; k++) w.spawnUnit("settler", tr, 12 + tr * 30 + k, 12);
  }
  return w;
};

describe("difficulty handicap (BACKLOG 6)", () => {
  it("scales the tribe's income and only its own", () => {
    const w = two();
    w.step([]);
    const base = w.tribes[1].eco.incomePerMin;
    expect(base).toBe(w.tribes[0].eco.incomePerMin);
    w.controllers.push({ tribe: 1, every: 1000, offset: 999, decide: () => [] });
    w.step([{ tick: w.tick, tribe: 1, type: "handicap", args: { mult: 1.25 } }]);
    expect(w.tribes[1].eco.incomeMult).toBe(1.25);
    expect(w.tribes[1].eco.incomePerMin).toBeCloseTo(base * 1.25);
    expect(w.tribes[0].eco.incomePerMin).toBe(base);
  });

  it("is refused for a tribe without an AI controller, out of range, or for a missing tribe; god mode names the tribe", () => {
    const w = two();
    expect(reject(w, { tribe: 0, args: { mult: 2 } })).toMatch(/AI controller/);
    expect(w.tribes[0].eco.incomeMult).toBe(1);
    w.controllers.push({ tribe: 0, every: 1000, offset: 999, decide: () => [] });
    expect(reject(w, { tribe: 0, args: { mult: 9 } })).toMatch(/between/);
    expect(reject(w, { tribe: -1, args: { mult: 2, tribe: 7 } })).toMatch(/no such tribe/);
    expect(reject(w, { tribe: -1, args: { mult: 0.5, tribe: 1 } })).toBeNull();
    expect(w.tribes[1].eco.incomeMult).toBe(0.5);
  });

  it("changes the state hash only when set away from 1", () => {
    const a = two();
    const b = two();
    expect(a.hash().all).toBe(b.hash().all);
    b.tribes[1].eco.incomeMult = 1.25;
    expect(a.hash().all).not.toBe(b.hash().all);
  });
});

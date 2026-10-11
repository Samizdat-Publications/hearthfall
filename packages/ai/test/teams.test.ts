// Leg 5 (L5-D, L5-E): opponent AIs on teams fight only the other team, and a team wins together.
import { describe, expect, it } from "vitest";
import { World } from "../../sim/src/world.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { makeBot } from "../src/index.ts";

describe("opponent AI with teams", () => {
  it("two AI teams of two: allies never hurt each other, and the match ends with one team standing", () => {
    const p = basePack();
    const w = new World({ pack: p.files, packHash: p.hash, seed: 17, map: { generator: "continents", size: 128, tribes: 4 }, rules: "conquest", teams: [0, 1, 0, 1] });
    for (let t = 0; t < 4; t++) w.controllers.push(makeBot({ type: "opponent", tribe: t, personality: "aggressive", difficulty: "hard", offset: t }));
    const E = w.ents;
    let friendly = 0;
    let hostile = 0;
    const damage = w.damage.bind(w);
    w.damage = ((i: number, amount: number, by: number, ...rest: unknown[]) => {
      const tr = E.tribe[i];
      if (by >= 0 && tr >= 0 && by !== tr) {
        if (w.allied(by, tr)) friendly++;
        else hostile++;
      }
      return (damage as (...a: unknown[]) => unknown)(i, amount, by, ...rest);
    }) as typeof w.damage;
    const end = 40 * 60 * w.cfg.tickHz;
    while (w.tick < end && w.rules!.winner < 0) w.step([]);
    expect(friendly).toBe(0);
    expect(hostile).toBeGreaterThan(0);
    expect(w.invariants()).toEqual([]);
    expect(w.rules!.winner).toBeGreaterThanOrEqual(0);
    const team = w.teamOf[w.rules!.winner];
    for (const t of w.tribes) if (w.teamOf[t.index] !== team) expect(t.alive).toBe(false);
  }, 300000);
});

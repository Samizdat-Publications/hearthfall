import { describe, expect, it } from "vitest";
import { EconomyBot, OpponentAI } from "@hearthfall/ai";
import { opponentsFor } from "../src/opponents.ts";

describe("skirmish opponents (M7)", () => {
  it("cycle personalities over the non-local tribes with the chosen difficulty", () => {
    const cs = opponentsFor(4, 0, { ai: ["aggressive", "sneaky", "turtle"], difficulty: "hard" });
    expect(cs.map((c) => c.tribe)).toEqual([1, 2, 3]);
    expect(cs.every((c) => c instanceof OpponentAI && c.every === 30)).toBe(true);
  });

  it("accept economy and none, and cycle a short list", () => {
    const cs = opponentsFor(4, 1, { ai: ["economy", "none"], difficulty: "normal" });
    expect(cs.map((c) => c.tribe)).toEqual([0, 3]);
    expect(cs.every((c) => c instanceof EconomyBot)).toBe(true);
  });
});

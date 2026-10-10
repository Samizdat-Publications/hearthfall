import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { createSkirmish, decodeSave, encodeSave, makeSave, restoreSave, type SkirmishParams } from "../src/session.ts";

const pack = loadBasePack().pack!;

const P: SkirmishParams = { seed: 11, level: "continents", size: 96, tribes: 3, ai: ["aggressive", "sneaky"], difficulty: "hard" };

describe("skirmish save games (M8)", () => {
  it("save then load reproduces the hash and the same future, opponents included", () => {
    const a = createSkirmish(pack, P);
    a.run(150 * 20);
    const pending = [{ tick: a.tick, tribe: 0, type: "setSplit", args: { spellsPct: 70 } }];
    const text = encodeSave(makeSave(a, P, [], pending, "2026-10-09T00:00:00Z"));
    expect(text.length).toBeLessThan(4_000_000);
    const save = decodeSave(text);
    const b = restoreSave(pack, save);
    expect(b.hash().all).toBe(a.hash().all);
    // continue both, applying the pending command on the next tick
    a.step(pending);
    b.step(save.pending);
    a.run(90 * 20);
    b.run(90 * 20);
    expect(b.hash().all).toBe(a.hash().all);
  });

  it("BACKLOG 11: a save made mid Forge restores the Forge and the AI's strokes go on the same way", () => {
    const F: SkirmishParams = { seed: 5, level: "continents", size: 96, tribes: 2, ai: ["turtle"], difficulty: "normal", forge: true };
    const a = createSkirmish(pack, F);
    a.run(20 * 20);
    expect(a.forge?.running()).toBe(true);
    expect(a.forge!.ops[1]).toBeGreaterThan(0);
    const b = restoreSave(pack, decodeSave(encodeSave(makeSave(a, F, [], [], "x"))));
    expect(b.forge!.ops).toEqual(a.forge!.ops);
    a.run(150 * 20);
    b.run(150 * 20);
    expect(a.forge!.running()).toBe(false);
    expect(b.hash().all).toBe(a.hash().all);
  });

  it("refuses a save made with different game data or damaged on disk", () => {
    const a = createSkirmish(pack, P);
    a.run(20);
    const s = makeSave(a, P, [], [], "x");
    expect(() => restoreSave(pack, { ...s, packHash: "other" })).toThrow(/different game data/);
    expect(() => restoreSave(pack, { ...s, hash: "0" })).toThrow(/damaged/);
  });
});

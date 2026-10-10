import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { emptyStats, statsFrom } from "../src/achievements.ts";
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

  it("BACKLOG 50: a save records its opponents' specs and a load rebuilds exactly those, whatever the params say", () => {
    const a = createSkirmish(pack, P);
    a.run(400);
    const s = decodeSave(encodeSave(makeSave(a, P, [], [], "x")));
    expect(s.bots).toEqual([
      { type: "opponent", tribe: 1, personality: "aggressive", difficulty: "hard", offset: 1 },
      { type: "opponent", tribe: 2, personality: "sneaky", difficulty: "hard", offset: 2 },
    ]);
    // a future change to how params map to opponents must not change a recorded game
    const b = restoreSave(pack, { ...s, params: { ...s.params, ai: ["turtle"] } });
    expect(b.controllers.map((c) => c.botSpec)).toEqual(s.bots);
    a.run(600);
    b.run(600);
    expect(b.hash().all).toBe(a.hash().all);
    // an older save without specs still builds them from its params
    const { bots: _b, ...old } = s;
    expect(restoreSave(pack, old).controllers.map((c) => c.botSpec)).toEqual(s.bots);
  });

  it("BACKLOG 79: the end screen stats ride along in the save; older or damaged stats load as 0", () => {
    const a = createSkirmish(pack, P);
    a.run(20);
    const stats = { ...emptyStats(), kills: 7, lost: 3, peakFollowers: 41 };
    const s = decodeSave(encodeSave(makeSave(a, P, [], [], "x", stats)));
    expect(statsFrom(s.stats)).toEqual(stats);
    stats.kills = 99; // the save holds a copy
    expect(s.stats!.kills).toBe(7);
    const old = makeSave(a, P, [], [], "x");
    expect("stats" in old).toBe(false);
    expect(statsFrom(old.stats)).toEqual(emptyStats());
    expect(statsFrom({ kills: -1, lost: "3", bogus: 5, peakFollowers: 2 })).toEqual({ ...emptyStats(), peakFollowers: 2 });
  });
});

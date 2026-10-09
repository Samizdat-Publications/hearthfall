import { describe, expect, it } from "vitest";
import { OUTCOME } from "@hearthfall/sim";
import { loadBasePack, loadLevels } from "../../../tools/harness/datapack.mjs";
import { campaignCarry, levelOpen, loadProgress, nextLevel, recordWin } from "../src/campaign.ts";
import { campaignParams, createSkirmish, decodeSave, encodeSave, makeSave, restoreSave } from "../src/session.ts";
import { MemoryKV } from "../src/storage.ts";

const pack = loadBasePack().pack!;
const { levels, issues } = loadLevels(pack.files);

describe("campaign (M9)", () => {
  it("ships valid levels in campaign order", () => {
    expect(issues).toEqual([]);
    expect(levels.length).toBeGreaterThanOrEqual(3);
  });

  it("opens levels in order and carries earlier unlocks forward", () => {
    const [a, b, c] = levels;
    const kv = new MemoryKV();
    const won = loadProgress(kv);
    expect(won).toEqual([]);
    expect([levelOpen(levels, won, a.id), levelOpen(levels, won, b.id), levelOpen(levels, won, c.id)]).toEqual([true, false, false]);
    expect(recordWin(kv, a.id, won)).toBe(true);
    const back = loadProgress(kv);
    expect(back).toEqual([a.id]);
    expect(levelOpen(levels, back, b.id)).toBe(true);
    expect(nextLevel(levels, a.id)?.id).toBe(b.id);
    expect(nextLevel(levels, levels[levels.length - 1].id)).toBeNull();
    expect(campaignCarry(levels, back, b.id).spells).toEqual(a.unlocks?.spells ?? []);
    // a level never carries its own unlocks or those of levels not won
    expect(campaignCarry(levels, [], c.id)).toEqual({ spells: [], buildings: [] });
  });

  it("a damaged progress record reads as no progress", () => {
    const kv = new MemoryKV();
    kv.setItem("hearthfall.campaign.v1", "{not json");
    expect(loadProgress(kv)).toEqual([]);
  });

  it("a campaign level saves and loads with the same hash and future, opponents and level state included", () => {
    const def = levels.find((l) => l.tribes.some((t) => t.ai))!;
    const P = campaignParams(def, { spells: ["raise_land"] });
    const a = createSkirmish(pack, P);
    expect(a.level?.def.id).toBe(def.id);
    a.run(60 * 20);
    const save = decodeSave(encodeSave(makeSave(a, P, [], [], "2026-10-09T00:00:00Z")));
    expect(save.params.campaign?.def.id).toBe(def.id);
    const b = restoreSave(pack, save);
    expect(b.hash().all).toBe(a.hash().all);
    a.run(60 * 20);
    b.run(60 * 20);
    expect(b.hash().all).toBe(a.hash().all);
    expect(b.level!.outcome).toBe(a.level!.outcome);
    expect([OUTCOME.none, OUTCOME.won, OUTCOME.lost]).toContain(b.level!.outcome);
  });
});

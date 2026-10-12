import { describe, expect, it } from "vitest";
import { OUTCOME } from "@hearthfall/sim";
import { loadBasePack, loadLevels } from "../../../tools/harness/datapack.mjs";
import { chapterPick } from "@hearthfall/ui";
import { validatePack } from "@hearthfall/data";
import { campaignCarry, chapterOf, levelOpen, loadLearned, loadProgress, nextLevel, recordWin, taughtSpells } from "../src/campaign.ts";
import { campaignParams, createSkirmish, decodeSave, encodeSave, makeSave, restoreSave } from "../src/session.ts";
import { MemoryKV } from "../src/storage.ts";

const pack = loadBasePack().pack!;
const { levels, issues } = loadLevels(pack.files);

describe("campaign chapters (S4 L7-A)", () => {
  it("files every level under a chapter by order, and a tab picks the chapter's frontier", () => {
    const ch = pack.files.style.campaignChapters!;
    expect(ch.length).toBeGreaterThanOrEqual(2);
    expect(chapterOf(1, ch)).toBe(0);
    expect(chapterOf(ch[1].from - 1, ch)).toBe(0);
    expect(chapterOf(ch[1].from, ch)).toBe(1);
    expect(chapterOf(999, ch)).toBe(ch.length - 1);
    expect(chapterOf(7)).toBe(0);
    const view = levels.map((l, k) => ({ id: l.id, name: l.name, description: "", open: k <= 14, won: k < 14, chapter: chapterOf(l.order, ch) }));
    // chapter 1 is all won: its tab shows its first level; chapter 2's tab shows the frontier
    expect(chapterPick(view, 0)?.id).toBe(view[0].id);
    expect(chapterPick(view, 1)?.id).toBe(view[14].id);
    expect(chapterPick(view, 9)).toBeUndefined();
  });

  it("refuses chapters that do not start at 1 or do not rise", () => {
    const raw = (c: unknown) => {
      const files: Record<string, unknown> = {};
      for (const [name, key] of Object.entries({ "manifest.json": "manifest", "balance.json": "balance", "style.json": "style", "units.json": "units", "buildings.json": "buildings", "spells.json": "spells", "ai_personalities.json": "ai", "terrain.json": "terrain" }))
        files[name] = (pack.files as unknown as Record<string, unknown>)[key];
      files["style.json"] = { ...pack.files.style, campaignChapters: c };
      return validatePack(files).issues.length;
    };
    expect(raw([{ name: "a", from: 1 }, { name: "b", from: 9 }])).toBe(0);
    expect(raw([{ name: "a", from: 2 }])).toBeGreaterThan(0);
    expect(raw([{ name: "a", from: 1 }, { name: "b", from: 1 }])).toBeGreaterThan(0);
  });
});

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

  it("spells a level taught in play carry into later levels; records without them still load (BACKLOG 9)", () => {
    const [a, b, c] = levels;
    const kv = new MemoryKV();
    kv.setItem("hearthfall.campaign.v1", JSON.stringify({ won: [a.id] }));
    expect(loadProgress(kv)).toEqual([a.id]);
    expect(loadLearned(kv)).toEqual({});
    const won = loadProgress(kv);
    const learned = loadLearned(kv);
    const taught = taughtSpells(["raise_land", "bolt", "whirlwind"], b, { spells: ["raise_land"] });
    expect(taught).toEqual(["whirlwind"].filter((s) => !b.spells.includes(s)));
    expect(recordWin(kv, b.id, won, learned, ["whirlwind"])).toBe(true);
    expect(loadLearned(kv)).toEqual({ [b.id]: ["whirlwind"] });
    expect(campaignCarry(levels, loadProgress(kv), c.id, loadLearned(kv)).spells).toContain("whirlwind");
    // a replay of the level that teaches nothing new keeps what it taught before
    expect(recordWin(kv, b.id, won, learned, [])).toBe(true);
    expect(loadLearned(kv)[b.id]).toEqual(["whirlwind"]);
    // the level itself and levels before it never get its teachings
    expect(campaignCarry(levels, loadProgress(kv), b.id, loadLearned(kv)).spells).not.toContain("whirlwind");
  });

  it("a damaged progress record reads as no progress", () => {
    const kv = new MemoryKV();
    kv.setItem("hearthfall.campaign.v1", "{not json");
    expect(loadProgress(kv)).toEqual([]);
  });

  it("a campaign level saved mid-play loads with the same hash and future, opponents and level state included", () => {
    const def = levels.find((l) => l.id === "contested_shrine")!;
    const P = campaignParams(def, { spells: ["raise_land"] });
    const a = createSkirmish(pack, P);
    expect(a.level?.def.id).toBe(def.id);
    a.run(20 * 20);
    expect(a.level!.outcome).toBe(OUTCOME.none);
    const save = decodeSave(encodeSave(makeSave(a, P, [], [], "2026-10-09T00:00:00Z")));
    expect(save.params.campaign?.def.id).toBe(def.id);
    const b = restoreSave(pack, save);
    expect(b.hash().all).toBe(a.hash().all);
    // an idle player loses the shrine race in both worlds, on the same tick
    a.run(200 * 20);
    b.run(200 * 20);
    expect(b.hash().all).toBe(a.hash().all);
    expect(a.level!.outcome).toBe(OUTCOME.lost);
    expect(b.level!.outcome).toBe(OUTCOME.lost);
    expect(b.level!.endedAt).toBe(a.level!.endedAt);
  });
});

import { describe, expect, it } from "vitest";
import { OUTCOME } from "@hearthfall/sim";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { applyTool, draftIssues, goalOf, loadDraft, newDraft, parseDraft, previewWorld, setField, setGoal, setOpponent, storeDraft, draftJson } from "../src/editor.ts";
import { campaignParams, createSkirmish } from "../src/session.ts";
import { MemoryKV } from "../src/storage.ts";

const pack = loadBasePack().pack!;

describe("map editor (BACKLOG 12)", () => {
  it("a new draft is a valid two-tribe level on land or sea", () => {
    for (const base of ["land", "sea"] as const) {
      const d = newDraft(96, base);
      expect(draftIssues(d, pack.files)).toEqual([]);
      expect(d.tribes.length).toBe(2);
      expect(d.setup.filter((s) => s.spawn === "hearth").map((s) => s.tribe)).toEqual([0, 1]);
    }
  });

  it("tools never change their input, paint discs and place props", () => {
    const d = newDraft();
    const before = draftJson(d);
    let e = applyTool(d, "hill", 50, 20, { radius: 5 });
    e = applyTool(e, "sea", 48, 70);
    e = applyTool(e, "tree", 30, 30);
    e = applyTool(e, "rock", 32, 66);
    expect(draftJson(d)).toBe(before);
    expect(e.map.paint!.map((p) => p.aboveSea)).toEqual([62, -30]);
    expect(e.map.paint![0]).toMatchObject({ at: [50, 20], r: 5 });
    expect(e.setup.filter((s) => s.spawn === "tree" || s.spawn === "rock").length).toBe(2);
    expect(draftIssues(e, pack.files)).toEqual([]);
  });

  it("a Hearth replaces its tribe's start, adds the next tribe and erasing the last one removes it", () => {
    let d = newDraft();
    d = applyTool(d, "hearth", 20, 20, { tribe: 0 });
    expect(d.setup.filter((s) => s.tribe === 0).length).toBe(3);
    expect(d.setup.find((s) => s.spawn === "hearth" && s.tribe === 0)!.at).toEqual([20, 20]);
    // tribe 7 clamps to the next free tribe (2)
    d = applyTool(d, "hearth", 48, 80, { tribe: 7 });
    expect(d.tribes.length).toBe(3);
    expect(d.tribes[2].ai).toBeTruthy();
    expect(draftIssues(d, pack.files)).toEqual([]);
    d = applyTool(d, "erase", 49, 81);
    expect(d.tribes.length).toBe(2);
    expect(d.setup.some((s) => s.tribe === 2)).toBe(false);
    // erasing open ground removes the newest paint disc there
    d = applyTool(applyTool(d, "hill", 10, 90), "erase", 11, 90);
    expect(d.map.paint!.length).toBe(0);
  });

  it("goals set objectives and rules, and validation names what is missing", () => {
    let d = newDraft();
    d = setGoal(d, "hold");
    expect(goalOf(d)).toBe("hold");
    expect(draftIssues(d, pack.files).join()).toContain("needs a worship site");
    d = applyTool(d, "reliquary", 48, 30);
    d = applyTool(d, "reliquary", 48, 66);
    expect(d.setup.filter((s) => s.site).map((s) => s.site!.tag)).toEqual(["reliquary_1", "reliquary_2"]);
    expect(draftIssues(d, pack.files)).toEqual([]);
    d = setGoal(d, "worship");
    expect(d.rules).toBeUndefined();
    expect(d.objectives).toEqual([{ type: "worship", site: "reliquary_1" }]);
    // the worship goal follows the first site when it is erased
    d = applyTool(d, "erase", 48, 30);
    expect(d.objectives).toEqual([{ type: "worship", site: "reliquary_2" }]);
    for (const g of ["conquest", "survive", "followers", "hill"] as const) expect(draftIssues(setGoal(d, g), pack.files)).toEqual([]);
    d = setOpponent(d, 1, "turtle", "easy");
    d = setField(setField(setField(d, "timeLimit", 900), "forge", true), "name", "Ridge Duel");
    expect(d.tribes[1]).toEqual({ ai: "turtle", difficulty: "easy" });
    expect(d.lose).toEqual([{ type: "timeLimit", seconds: 900 }]);
    expect(setField(d, "timeLimit", 0).lose).toBeUndefined();
    expect(draftIssues(d, pack.files)).toEqual([]);
  });

  it("stores and parses drafts, rejecting what is not level-shaped", () => {
    const kv = new MemoryKV();
    expect(loadDraft(kv)).toBeNull();
    const d = applyTool(newDraft(64), "shrine", 32, 10);
    expect(storeDraft(kv, d)).toBe(true);
    expect(loadDraft(kv)).toEqual(d);
    expect(parseDraft("{")).toBeNull();
    expect(parseDraft(JSON.stringify({ id: "x" }))).toBeNull();
  });

  it("the preview world places what it can, and a valid draft plays as a level session", () => {
    let d = applyTool(newDraft(), "tree", 30, 30);
    d = applyTool(d, "reliquary", 48, 48);
    const w = previewWorld(d, pack.files, pack.hash);
    expect(w.worship.sites.length).toBe(1);
    expect(w.tribes.length).toBe(2);
    // a setup entry the validator rejects is left out of the preview instead of failing it
    const bad = { ...d, setup: [...d.setup, { spawn: "dragon", at: [5, 5] as [number, number] }] };
    expect(draftIssues(bad, pack.files).join()).toContain("unknown spawn dragon");
    expect(previewWorld(bad, pack.files, pack.hash).worship.sites.length).toBe(1);
    const s = createSkirmish(pack, campaignParams(d, {}));
    s.run(30 * 20);
    expect(s.level!.outcome).toBe(OUTCOME.none);
    expect(s.tribes.every((t) => t.alive)).toBe(true);
  });
});

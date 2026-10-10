import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateAchievements, type AchievementsFile } from "@hearthfall/data";
import { CAT } from "@hearthfall/sim";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { addMatch, emptyRecords, emptyStats, loadRecords, noteEvent, passes, recordMatch, RECORDS_KEY, storeRecords } from "../src/achievements.ts";
import { createSkirmish } from "../src/session.ts";
import { MemoryKV } from "../src/storage.ts";

const pack = loadBasePack().pack!;
const raw = JSON.parse(readFileSync(new URL("../../../data/achievements.json", import.meta.url), "utf8"));
const file = validateAchievements(raw, pack.files).file as AchievementsFile;
const byId = (id: string) => file.achievements.find((a) => a.id === id)!;

describe("achievements and records (BACKLOG 21)", () => {
  it("the shipped file validates; bad files are refused with a reason", () => {
    expect(file.achievements.length).toBeGreaterThan(10);
    const dup = { ...raw, achievements: [...raw.achievements, raw.achievements[0]] };
    expect(validateAchievements(dup, pack.files).issues[0].message).toMatch(/duplicate/);
    const diff = { ...raw, achievements: [{ ...raw.achievements[0], difficulty: ["godlike"] }] };
    expect(validateAchievements(diff, pack.files).issues[0].message).toMatch(/unknown difficulty/);
    const noBound = { ...raw, achievements: [{ ...raw.achievements[0], when: [{ stat: "won" }] }] };
    expect(validateAchievements(noBound, pack.files).issues.length).toBeGreaterThan(0);
  });

  it("counts the local tribe's events only", () => {
    const s = emptyStats();
    const ev = (type: string, d: Record<string, number | string>) => noteEvent(s, { tick: 1, type, ...d }, 0);
    ev("killed", { cat: CAT.unit, tribe: 1, by: 0 });
    ev("drowned", { cat: CAT.unit, tribe: 2, by: 0 });
    ev("killed", { cat: CAT.unit, tribe: 1, by: 2 }); // someone else's kill
    ev("killed", { cat: CAT.unit, tribe: 0, by: 1 });
    ev("killed", { cat: CAT.tree, tribe: -1, by: 0 });
    ev("destroyed", { cat: CAT.building, tribe: 1, by: 0 });
    ev("spellCast", { tribe: 0, spell: "bolt" });
    ev("spellCast", { tribe: 0, spell: "bolt", by: "site" });
    ev("spellCast", { tribe: 1, spell: "bolt" });
    ev("converted", { to: 0, from: 1 });
    ev("shaperDied", { tribe: 0 });
    expect(s).toMatchObject({ kills: 2, drownedFoes: 1, lost: 1, buildingsRazed: 1, spellsCast: 1, converted: 1, shaperDeaths: 1 });
  });

  it("counts a real match's births and buildings", () => {
    const w = createSkirmish(pack, { seed: 5, level: "continents", size: 96, tribes: 2, ai: ["aggressive"], difficulty: "normal" });
    const s = emptyStats();
    for (let t = 0; t < 3000; t++) {
      w.step([]);
      for (const e of w.events) noteEvent(s, e, 1);
    }
    expect(s.born).toBeGreaterThan(0);
    expect(s.buildingsBuilt).toBeGreaterThan(0);
  });

  it("match and career thresholds, mode and difficulty filters; each achievement is earned once", () => {
    const rec = emptyRecords();
    const m = { ...emptyStats(), won: 1, minutes: 10, kills: 3 };
    const got = recordMatch(file, rec, m, { mode: "skirmish", difficulty: "normal" }, "t1").map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining(["first_light", "unbroken", "swift_hand"]));
    expect(got).not.toContain("against_the_storm");
    expect(rec.career.matches).toBe(1);
    // a level win is not a skirmish: no Swift Hand there, and nothing twice
    const again = recordMatch(file, rec, { ...emptyStats(), won: 1, minutes: 5 }, { mode: "level", difficulty: "hard" }, "t2").map((a) => a.id);
    expect(again).toEqual([]);
    expect(passes(byId("against_the_storm"), { ...emptyStats(), won: 1 }, rec.career, { mode: "skirmish", difficulty: "brutal" })).toBe(true);
    expect(passes(byId("unbroken"), { ...emptyStats(), won: 1, shaperDeaths: 1 }, rec.career, { mode: "skirmish", difficulty: "normal" })).toBe(false);
    // career: peak keeps the largest, the rest sum
    const c = addMatch({ ...emptyStats(), peakFollowers: 90, kills: 5 }, { ...emptyStats(), peakFollowers: 40, kills: 7 });
    expect(c.peakFollowers).toBe(90);
    expect(c.kills).toBe(12);
    for (let k = 0; k < 8; k++) recordMatch(file, rec, emptyStats(), { mode: "skirmish", difficulty: "easy" }, "t");
    expect(Object.keys(rec.unlocked)).toContain("veteran");
    expect(rec.unlocked.first_light).toBe("t1");
  });

  it("records survive storage; damaged records start over", () => {
    const kv = new MemoryKV();
    const rec = emptyRecords();
    recordMatch(file, rec, { ...emptyStats(), won: 1, kills: 4 }, { mode: "skirmish", difficulty: "normal" }, "t1");
    expect(storeRecords(kv, rec)).toBe(true);
    expect(loadRecords(kv)).toEqual(rec);
    kv.setItem(RECORDS_KEY, "{broken");
    expect(loadRecords(kv)).toEqual(emptyRecords());
    kv.setItem(RECORDS_KEY, JSON.stringify({ career: { kills: -3, won: "x", lost: 2 } }));
    expect(loadRecords(kv).career).toMatchObject({ kills: 0, won: 0, lost: 2 });
  });
});

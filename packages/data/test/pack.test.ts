import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, mergeById, validatePack } from "../src/index.ts";

const dir = new URL("../../../data/base/", import.meta.url);
const loadBase = () => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8"))]));

describe("data pack", () => {
  it("base pack validates with no issues", () => {
    const res = validatePack(loadBase());
    expect(res.issues).toEqual([]);
    expect(res.pack?.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("packs frozen for golden replays still hash to their folder name (schema defaults must not change old packs)", () => {
    const golden = new URL("../../../replays/golden/", import.meta.url);
    const frozen = new URL("pack/", golden);
    const used = new Set(readdirSync(golden).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, golden), "utf8")).packHash as string));
    expect(used.size).toBeGreaterThan(0);
    for (const h of used) {
      const d = new URL(h + "/", frozen);
      const raw = Object.fromEntries(readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(new URL(f, d), "utf8"))]));
      expect(validatePack(raw).pack?.hash, h).toBe(h);
    }
  });

  it("rejects a lightingDefault that names no preset (BACKLOG 14)", () => {
    const raw = loadBase();
    (raw["style.json"] as { lightingDefault?: string }).lightingDefault = "dusk";
    expect(JSON.stringify(validatePack(raw).issues)).toContain("lightingDefault");
  });

  it("rejects typos and broken references", () => {
    const raw = loadBase();
    (raw["units.json"] as { units: { speeed?: number }[] }).units[0].speeed = 2;
    expect(validatePack(raw).issues.length).toBeGreaterThan(0);
    const raw2 = loadBase();
    (raw2["ai_personalities.json"] as { personalities: { spellPrefs: string[] }[] }).personalities[0].spellPrefs.push("nope");
    expect(validatePack(raw2).issues.some((i) => i.message.includes("nope"))).toBe(true);    type Tiers = { progression: { tiers: { followers: number; buildings: string[] }[] } };
    const raw3 = loadBase();
    (raw3["balance.json"] as Tiers).progression.tiers[1].buildings.push("castle");
    expect(validatePack(raw3).issues.some((i) => i.message.includes("castle"))).toBe(true);
    const raw4 = loadBase();
    (raw4["balance.json"] as Tiers).progression.tiers[2].followers = 1;
    expect(validatePack(raw4).issues.some((i) => i.message.includes("must increase"))).toBe(true);
  });

  it("rejects spell statuses aimed at the wrong side or unknown, and Ward poppers that are not spells (BACKLOG 1)", () => {
    type Fx = { type: string; status?: string; targets?: string; poppedBy?: string[] };
    const spellFx = (raw: Record<string, unknown>, id: string) => (raw["spells.json"] as { spells: { id: string; effects: Fx[] }[] }).spells.find((s) => s.id === id)!.effects[0];
    const raw = loadBase();
    delete spellFx(raw, "veil").targets;
    expect(validatePack(raw).issues.some((i) => i.message.includes("veil must target own units"))).toBe(true);
    const raw2 = loadBase();
    spellFx(raw2, "ward").poppedBy = ["thunder"];
    expect(validatePack(raw2).issues.some((i) => i.message.includes("thunder"))).toBe(true);
    const raw3 = loadBase();
    spellFx(raw3, "beguile").status = "charmed";
    expect(validatePack(raw3).issues.length).toBeGreaterThan(0);
  });

  it("canonical json ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });

  it("mergeById overrides, removes and appends", () => {
    const base = [{ id: "a", v: 1 }, { id: "b", v: 2 }];
    expect(mergeById(base, [{ id: "a", v: 9 }, { id: "b", $remove: true }, { id: "c", v: 3 }])).toEqual([{ id: "a", v: 9 }, { id: "c", v: 3 }]);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, mergeById, validatePack, validateUi } from "../src/index.ts";

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

  it("BACKLOG 31: a terrainOp spell effect needs its op's own fields and takes no others", () => {
    type Fx = Record<string, unknown>;
    const issuesWith = (edit: (fx: Fx[]) => void) => {
      const raw = loadBase();
      const spells = (raw["spells.json"] as { spells: { effects: Fx[] }[] }).spells;
      edit(spells.flatMap((s) => s.effects).filter((e) => e.type === "terrainOp"));
      return JSON.stringify(validatePack(raw).issues);
    };
    expect(issuesWith(() => {})).toBe("[]");
    const ridge = (fx: Fx[]) => fx.find((e) => e.op === "ridgeLine")!;
    const crater = (fx: Fx[]) => fx.find((e) => e.op === "crater")!;
    expect(issuesWith((fx) => delete ridge(fx).width)).toContain("width");
    expect(issuesWith((fx) => (crater(fx).seconds = 3))).toContain("seconds");
    expect(issuesWith((fx) => (crater(fx).shape = "dome"))).toContain("shape");
    expect(issuesWith((fx) => (crater(fx).op = "smooth"))).not.toBe("[]");
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

  it("BACKLOG 78: data/ui.json validates against the pack, and the skirmish menu is out of the pack hash", () => {
    const pack = validatePack(loadBase()).pack!;
    const ui = JSON.parse(readFileSync(new URL("../../../data/ui.json", import.meta.url), "utf8"));
    expect(validateUi(ui, pack.files).issues).toEqual([]);
    const bad = (edit: (u: typeof ui) => void) => {
      const u = JSON.parse(JSON.stringify(ui));
      edit(u);
      return validateUi(u, pack.files).issues.map((i) => i.path);
    };
    expect(bad((u) => (u.skirmish.maps = ["atlantis"]))).toEqual(["skirmish.maps.0"]);
    expect(bad((u) => (u.skirmish.defaultSize = 160))).toEqual(["skirmish.defaultSize"]);
    expect(bad((u) => (u.skirmish.defaultDifficulty = "nightmare"))).toEqual(["skirmish.defaultDifficulty"]);
    expect(bad((u) => (u.skirmish.defaultOpponents = ["grumpy"]))).toEqual(["skirmish.defaultOpponents.0"]);
    expect(bad((u) => (u.notes.max = 0))).toEqual(["notes.max"]);
    expect(bad((u) => (u.combos[0].then = "teleport"))).toEqual(["combos.0.then"]);
    // the shipped pack no longer carries the menu, so a menu edit cannot change the hash
    expect(pack.files.balance.skirmish).toBeUndefined();
  });

  it("mergeById overrides, removes and appends", () => {
    const base = [{ id: "a", v: 1 }, { id: "b", v: 2 }];
    expect(mergeById(base, [{ id: "a", v: 9 }, { id: "b", $remove: true }, { id: "c", v: 3 }])).toEqual([{ id: "a", v: 9 }, { id: "c", v: 3 }]);
  });
});

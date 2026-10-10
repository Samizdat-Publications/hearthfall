// BACKLOG 18 (ADR-021): mod packs merge onto the base files before validation.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMods, parseModList, validatePack, type ModPack } from "../src/index.ts";

const dir = new URL("../../../data/base/", import.meta.url);
const loadBase = (): Record<string, unknown> => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8"))]));
const manifest = (id: string, loadOrder = 1) => ({ id, name: id, version: "1.0.0", loadOrder });
const mod = (id: string, files: Record<string, unknown>, loadOrder = 1): ModPack => ({ id, files: { "manifest.json": manifest(id, loadOrder), ...files } });
type Unit = { id: string; hp: number; speed: number };
const units = (raw: Record<string, unknown>) => (raw["units.json"] as { units: Unit[] }).units;

describe("mod packs (BACKLOG 18)", () => {
  it("no mods: the same files and the same hash as the base", () => {
    const base = loadBase();
    const res = applyMods(base, []);
    expect(res.issues).toEqual([]);
    expect(validatePack(res.raw).pack!.hash).toBe(validatePack(base).pack!.hash);
  });

  it("overrides fields by id, deep merges objects, appends and removes, without touching the base", () => {
    const base = loadBase();
    const warden = units(base).find((u) => u.id === "warden")!;
    const res = applyMods(base, [
      mod("tweak", {
        "units.json": { units: [{ id: "warden", speed: 2 }] },
        "balance.json": { economy: { decideEverySeconds: 2 } },
      }),
    ]);
    expect(res.issues).toEqual([]);
    const w = units(res.raw).find((u) => u.id === "warden")!;
    expect(w.speed).toBe(2);
    expect(w.hp).toBe(warden.hp);
    expect(warden.speed).not.toBe(2);
    const eco = (res.raw["balance.json"] as { economy: Record<string, unknown> }).economy;
    expect(eco.decideEverySeconds).toBe(2);
    expect(Object.keys(eco).length).toBe(Object.keys((base["balance.json"] as { economy: object }).economy).length);
    const v = validatePack(res.raw);
    expect(v.issues).toEqual([]);
    expect(v.pack!.hash).not.toBe(validatePack(base).pack!.hash);
    expect(res.applied).toEqual([{ id: "tweak", name: "tweak", version: "1.0.0" }]);

    const added = applyMods(base, [mod("more", { "units.json": { units: [{ ...warden, id: "warden_b" }, { id: "warden", $remove: true }] } })]);
    const ids = units(added.raw).map((u) => u.id);
    expect(ids).toContain("warden_b");
    expect(ids).not.toContain("warden");
  });

  it("applies in loadOrder and reports values two mods both set", () => {
    const base = loadBase();
    const a = mod("a", { "units.json": { units: [{ id: "warden", speed: 2, hp: 3000 }] } }, 5);
    const b = mod("b", { "units.json": { units: [{ id: "warden", speed: 1 }] } }, 2);
    const c = mod("c", { "units.json": { units: [{ id: "warden", $remove: true }] } }, 9);
    const res = applyMods(base, [a, b]);
    expect(units(res.raw).find((u) => u.id === "warden")!.speed).toBe(2);
    expect(res.applied.map((m) => m.id)).toEqual(["b", "a"]);
    expect(res.conflicts).toEqual([{ path: "units.json.units[warden].speed", mods: ["b", "a"] }]);
    const rm = applyMods(base, [a, c]);
    expect(rm.conflicts.map((x) => x.path)).toEqual(["units.json.units[warden]"]);
    expect(rm.conflicts[0].mods).toEqual(["a", "c"]);
  });

  it("reports bad manifests and unknown files and skips them", () => {
    const base = loadBase();
    const res = applyMods(base, [
      { id: "nomani", files: { "units.json": { units: [] } } },
      { id: "wrong", files: { "manifest.json": manifest("other") } },
      { id: "zero", files: { "manifest.json": manifest("zero", 0) } },
      mod("odd", { "levels.json": {} }),
    ]);
    expect(res.issues.map((i) => i.mod)).toEqual(["nomani", "wrong", "zero", "odd"]);
    expect(res.applied.map((m) => m.id)).toEqual(["odd"]);
  });

  it("a patch that breaks the schema fails validation of the merged pack", () => {
    const res = applyMods(loadBase(), [mod("bad", { "units.json": { units: [{ id: "warden", hp: -5 }] } })]);
    expect(validatePack(res.raw).pack).toBeUndefined();
  });

  it("parses a mod list", () => {
    expect(parseModList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseModList(null)).toEqual([]);
  });
});

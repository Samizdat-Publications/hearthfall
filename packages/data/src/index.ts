// Data pack loading: validation, cross references, canonical hashing and mod merge rules.
// Browser safe (no node imports); disk access lives in tools/harness.
import { PACK_FILES, type PackFileName, type PackFiles } from "./schemas.ts";

export * from "./schemas.ts";

/** Canonical JSON: sorted object keys, no whitespace. Line endings in source files never matter. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.filter((k) => obj[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** FNV-1a 32 bit over UTF-16 code units, returned as 8 hex chars. */
export function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface PackIssue {
  file: string;
  path: string;
  message: string;
}

export interface ValidatedPack {
  files: PackFiles;
  hash: string;
}

const FILE_KEYS: Record<PackFileName, keyof PackFiles> = {
  "manifest.json": "manifest",
  "balance.json": "balance",
  "style.json": "style",
  "units.json": "units",
  "buildings.json": "buildings",
  "spells.json": "spells",
  "ai_personalities.json": "ai",
  "terrain.json": "terrain",
};

/** Validate raw parsed JSON files of one pack. Returns issues (empty when valid) and the typed pack. */
export function validatePack(raw: Partial<Record<string, unknown>>): { issues: PackIssue[]; pack?: ValidatedPack } {
  const issues: PackIssue[] = [];
  const out: Partial<Record<keyof PackFiles, unknown>> = {};
  for (const name of Object.keys(raw)) if (!(name in PACK_FILES)) issues.push({ file: name, path: "", message: "unknown pack file (add a schema in packages/data/src/schemas.ts)" });
  for (const name of Object.keys(PACK_FILES) as PackFileName[]) {
    const value = raw[name];
    if (value === undefined) {
      issues.push({ file: name, path: "", message: "missing file" });
      continue;
    }
    const res = PACK_FILES[name].safeParse(value);
    if (!res.success) {
      for (const iss of res.error.issues) issues.push({ file: name, path: iss.path.join("."), message: iss.message });
    } else out[FILE_KEYS[name]] = res.data;
  }
  if (issues.length) return { issues };
  const files = out as PackFiles;
  issues.push(...crossCheck(files));
  if (issues.length) return { issues };
  return { issues, pack: { files, hash: fnv1aHex(canonicalJson(files)) } };
}

function dupes(file: string, ids: string[], issues: PackIssue[]): Set<string> {
  const seen = new Set<string>();
  for (const i of ids) {
    if (seen.has(i)) issues.push({ file, path: i, message: "duplicate id" });
    seen.add(i);
  }
  return seen;
}

function crossCheck(p: PackFiles): PackIssue[] {
  const issues: PackIssue[] = [];
  const units = dupes("units.json", p.units.units.map((u) => u.id), issues);
  const buildings = dupes("buildings.json", p.buildings.buildings.map((b) => b.id), issues);
  const spells = dupes("spells.json", p.spells.spells.map((s) => s.id), issues);
  dupes("ai_personalities.json", p.ai.personalities.map((x) => x.id), issues);
  const need = (file: string, path: string, set: Set<string>, ref: string, kind: string) => {
    if (!set.has(ref)) issues.push({ file, path, message: `unknown ${kind} id "${ref}"` });
  };
  for (const u of p.units.units) {
    if (u.trainedAt) need("units.json", `${u.id}.trainedAt`, buildings, u.trainedAt, "building");
    for (const t of u.prefersTarget ?? []) need("units.json", `${u.id}.prefersTarget`, units, t, "unit");
    for (const t of u.trainableInto ?? []) need("units.json", `${u.id}.trainableInto`, units, t, "unit");
    for (const t of u.convert?.cannotConvert ?? []) need("units.json", `${u.id}.convert.cannotConvert`, units, t, "unit");
  }
  for (const b of p.buildings.buildings) if (b.trains) need("buildings.json", `${b.id}.trains`, units, b.trains, "unit");
  for (const per of p.ai.personalities) {
    for (const s of per.spellPrefs) need("ai_personalities.json", `${per.id}.spellPrefs`, spells, s, "spell");
    for (const u of Object.keys(per.armyMix)) need("ai_personalities.json", `${per.id}.armyMix`, units, u, "unit");
  }
  const b = p.balance.terrain.bands;
  const order = [p.balance.terrain.seaLevel, b.shore, b.lowland, b.grass, b.highland, b.rock, b.peak];
  for (let i = 1; i < order.length; i++) if (order[i] <= order[i - 1]) issues.push({ file: "balance.json", path: "terrain.bands", message: "bands must rise strictly above sea level" });
  return issues;
}

/**
 * Merge a mod list onto a base list by id: objects with a known id override fields (shallow),
 * `"$remove": true` deletes, unknown ids append.
 */
export function mergeById<T extends { id: string }>(base: readonly T[], mod: readonly (Partial<T> & { id: string; $remove?: boolean })[]): T[] {
  const out = base.map((x) => ({ ...x }));
  for (const m of mod) {
    const i = out.findIndex((x) => x.id === m.id);
    if (m.$remove) {
      if (i >= 0) out.splice(i, 1);
      continue;
    }
    const { $remove: _r, ...rest } = m;
    if (i >= 0) out[i] = { ...out[i], ...rest } as T;
    else out.push(rest as unknown as T);
  }
  return out;
}

/** Convert authored seconds to whole sim ticks (at least 1 for any positive duration). */
export function secondsToTicks(seconds: number, tickHz: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * tickHz));
}

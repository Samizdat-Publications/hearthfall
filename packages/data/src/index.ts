// Data pack loading: validation, cross references, canonical hashing and mod merge rules.
// Browser safe (no node imports); disk access lives in tools/harness.
import { LevelSchema, PACK_FILES, type LevelDef, type PackFileName, type PackFiles, type Reward } from "./schemas.ts";

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

/** Terrain ops a spell may queue and the effect fields each one needs. */
export const SPELL_TERRAIN_OPS: Record<string, readonly string[] | undefined> = {
  ridgeLine: ["width", "heightAboveSea"],
  flattenToAverage: ["radius"],
  noiseScar: ["radius", "depth"],
  crater: ["radius", "height"],
  lowerTowardSea: ["radius", "depth"],
  raise: ["radius", "height"],
  lower: ["radius", "depth"],
};

/** statusApply statuses the sim implements; the rest belong to backlog spells and throw when cast. */
export const IMPLEMENTED_STATUSES = ["panic", "burning"] as const;

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
  p.balance.progression.tiers.forEach((t, k, all) => {
    for (const b of t.buildings) need("balance.json", `progression.tiers.${t.id}.buildings`, buildings, b, "building");
    if (k === 0 && t.followers !== 0) issues.push({ file: "balance.json", path: `progression.tiers.${t.id}`, message: "the first tier must need 0 followers" });
    if (k > 0 && t.followers <= all[k - 1].followers) issues.push({ file: "balance.json", path: `progression.tiers.${t.id}`, message: "tier follower thresholds must increase" });
  });
  for (const b of p.buildings.buildings) if (b.trains) need("buildings.json", `${b.id}.trains`, units, b.trains, "unit");
  for (const u of p.units.units) if (u.isCaster && !u.respawn) issues.push({ file: "units.json", path: `${u.id}.respawn`, message: "the caster needs respawn timings" });
  // effect fields the sim reads without a fallback (packages/sim/src/effects.ts)
  for (const s of p.spells.spells) {
    s.effects.forEach((e, k) => {
      const at = `${s.id}.effects.${k}`;
      if (e.type === "terrainOp") {
        const fields = SPELL_TERRAIN_OPS[e.op];
        if (!fields) issues.push({ file: "spells.json", path: at, message: `terrainOp ${e.op} is not available to spells` });
        else for (const f of fields) if ((e as Record<string, unknown>)[f] === undefined) issues.push({ file: "spells.json", path: at, message: `terrainOp ${e.op} needs ${f}` });
      }
      if (e.type === "spawnEntity" && e.radius === undefined) issues.push({ file: "spells.json", path: at, message: "spawnEntity needs radius" });
      if (e.type === "statusApply" && (IMPLEMENTED_STATUSES as readonly string[]).includes(e.status) && e.radius === undefined) issues.push({ file: "spells.json", path: at, message: `statusApply ${e.status} needs radius` });
    });
  }
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

/**
 * Validate one level file (data/levels/<id>.json, M9) against its schema and a pack: every spell,
 * building, unit, worship kind, personality and difficulty exists, and site tags that objectives,
 * lose conditions and triggers name are placed in the setup. Levels are not part of the pack hash.
 */
export function validateLevel(raw: unknown, pack: PackFiles, file = "level"): { issues: PackIssue[]; level?: LevelDef } {
  const res = LevelSchema.safeParse(raw);
  if (!res.success) return { issues: res.error.issues.map((i) => ({ file, path: i.path.join("."), message: i.message })) };
  const lv = res.data;
  const issues: PackIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ file, path, message });
  const spells = new Set(pack.spells.spells.map((s) => s.id));
  const buildings = new Set(pack.buildings.buildings.map((b) => b.id));
  const units = new Set(pack.units.units.map((u) => u.id));
  const kinds = new Set((pack.buildings.worship.kinds ?? []).map((k) => k.id));
  const persons = new Set(pack.ai.personalities.map((p) => p.id));
  const diffs = new Set(pack.ai.difficulties.map((d) => d.id));
  lv.spells.forEach((s, k) => spells.has(s) || bad(`spells.${k}`, `unknown spell ${s}`));
  lv.buildings?.forEach((b, k) => buildings.has(b) || bad(`buildings.${k}`, `unknown building ${b}`));
  lv.unlocks?.spells?.forEach((s, k) => spells.has(s) || bad(`unlocks.spells.${k}`, `unknown spell ${s}`));
  lv.unlocks?.buildings?.forEach((b, k) => buildings.has(b) || bad(`unlocks.buildings.${k}`, `unknown building ${b}`));
  lv.tribes.forEach((t, k) => {
    if (k === 0 && t.ai) bad("tribes.0.ai", "tribe 0 is the player");
    if (k > 0 && !t.ai) bad(`tribes.${k}.ai`, "opponents need a personality");
    if (t.ai && !persons.has(t.ai)) bad(`tribes.${k}.ai`, `unknown personality ${t.ai}`);
    if (t.difficulty && !diffs.has(t.difficulty)) bad(`tribes.${k}.difficulty`, `unknown difficulty ${t.difficulty}`);
  });
  const reward = (r: Reward, path: string) => {
    if ((r.type === "charges" || r.type === "unlockSpell" || r.type === "spell") && !spells.has(r.spell)) bad(path, `unknown spell ${r.spell}`);
    if (r.type === "unlockBuilding" && !buildings.has(r.building)) bad(path, `unknown building ${r.building}`);
    if (r.type === "spawn" && !units.has(r.unit)) bad(path, `unknown unit ${r.unit}`);
    if (r.type === "spawn" && r.tribe !== undefined && r.tribe >= lv.tribes.length) bad(path, `no tribe ${r.tribe}`);
  };
  const tags = new Set<string>();
  const hearths = new Set<number>();
  lv.setup.forEach((s, k) => {
    const path = `setup.${k}`;
    if (!s.at && !s.near) bad(path, "needs at or near");
    if (s.tribe !== undefined && s.tribe >= lv.tribes.length) bad(path, `no tribe ${s.tribe}`);
    if (kinds.has(s.spawn)) {
      if (!s.site) bad(path, `worship object ${s.spawn} needs a site`);
      if (s.site?.tag) {
        if (tags.has(s.site.tag)) bad(path, `duplicate site tag ${s.site.tag}`);
        tags.add(s.site.tag);
      }
      s.site?.rewards.forEach((r, j) => reward(r, `${path}.site.rewards.${j}`));
    } else if (s.site) bad(path, `${s.spawn} is not a worship object`);
    else if (s.spawn !== "tree" && !units.has(s.spawn) && !buildings.has(s.spawn)) bad(path, `unknown spawn ${s.spawn}`);
    if (s.spawn === "hearth" && s.tribe !== undefined && s.tribe >= 0) hearths.add(s.tribe);
  });
  lv.tribes.forEach((_, k) => hearths.has(k) || bad("setup", `tribe ${k} has no hearth`));
  lv.objectives.forEach((o, k) => o.type === "worship" && !tags.has(o.site) && bad(`objectives.${k}`, `no site tagged ${o.site}`));
  lv.lose?.forEach((o, k) => o.type === "siteLost" && !tags.has(o.site) && bad(`lose.${k}`, `no site tagged ${o.site}`));
  lv.triggers?.forEach((t, k) => {
    if (t.when.type === "worship" && !tags.has(t.when.site)) bad(`triggers.${k}.when`, `no site tagged ${t.when.site}`);
    if (t.when.type === "objective" && t.when.index >= lv.objectives.length) bad(`triggers.${k}.when`, `no objective ${t.when.index}`);
    t.do.forEach((r, j) => reward(r, `triggers.${k}.do.${j}`));
  });
  if (lv.objectives.some((o) => o.type === "eliminateAll") && lv.tribes.length < 2) bad("objectives", "eliminateAll needs an opponent");
  return issues.length ? { issues } : { issues, level: lv };
}


// Data pack loading: validation, cross references, canonical hashing and mod merge rules.
// Browser safe (no node imports); disk access lives in tools/harness.
import { AchievementsFileSchema, LevelSchema, PACK_FILES, UiFileSchema, type AchievementsFile, type UiFile, type LevelDef, type PackFileName, type PackFiles, type Reward } from "./schemas.ts";

export * from "./schemas.ts";
export * from "./colorVision.ts";
export * from "./mods.ts";

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

/** statusApply statuses the sim implements ("entranced" is the Chanter's channel, not a spell status). */
export const IMPLEMENTED_STATUSES = ["panic", "burning", "veil", "ward", "beguiled"] as const;

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
  // BACKLOG 10: a building makes vehicles only, and riders that fire from a vehicle are real units
  for (const b of p.buildings.buildings) {
    if (!b.makes) continue;
    need("buildings.json", `${b.id}.makes.unit`, units, b.makes.unit, "unit");
    const u = p.units.units.find((x) => x.id === b.makes!.unit);
    if (u && !u.vehicle) issues.push({ file: "buildings.json", path: `${b.id}.makes.unit`, message: `${u.id} is not a vehicle` });
  }
  for (const u of p.units.units) for (const f of u.vehicle?.fireFrom ?? []) need("units.json", `${u.id}.vehicle.fireFrom`, units, f, "unit");
  for (const u of p.units.units) if (u.isCaster && !u.respawn) issues.push({ file: "units.json", path: `${u.id}.respawn`, message: "the caster needs respawn timings" });
  // effect fields the sim reads without a fallback (packages/sim/src/effects.ts)
  for (const s of p.spells.spells) {
    s.effects.forEach((e, k) => {
      const at = `${s.id}.effects.${k}`;
      if (e.type === "spawnEntity" && e.radius === undefined) issues.push({ file: "spells.json", path: at, message: "spawnEntity needs radius" });
      if (e.type === "statusApply" && (IMPLEMENTED_STATUSES as readonly string[]).includes(e.status) && e.radius === undefined) issues.push({ file: "spells.json", path: at, message: `statusApply ${e.status} needs radius` });
      if (e.type === "statusApply" && !(IMPLEMENTED_STATUSES as readonly string[]).includes(e.status)) issues.push({ file: "spells.json", path: at, message: `statusApply ${e.status} is not a spell status` });
      if (e.type === "statusApply" && (e.status === "veil" || e.status === "ward") && e.targets !== "own") issues.push({ file: "spells.json", path: at, message: `statusApply ${e.status} must target own units` });
      if (e.type === "summon" || e.type === "moverPath") if (e.entity !== s.id) issues.push({ file: "spells.json", path: at, message: `${e.type} entity must be the spell id (${s.id})` });
      if (e.type === "statusApply") for (const x of e.poppedBy ?? []) need("spells.json", `${at}.poppedBy`, spells, x, "spell");
    });
  }
  for (const per of p.ai.personalities) {
    for (const s of per.spellPrefs) need("ai_personalities.json", `${per.id}.spellPrefs`, spells, s, "spell");
    for (const u of Object.keys(per.armyMix)) need("ai_personalities.json", `${per.id}.armyMix`, units, u, "unit");
  }
  // BACKLOG 95: effect colors name real spells
  for (const s of Object.keys(p.style.render?.vfxColors?.spells ?? {})) need("style.json", "render.vfxColors.spells", spells, s, "spell");
  const kinds = new Set((p.buildings.worship.kinds ?? []).map((k) => k.id));
  p.balance.skirmishWorship?.sites.forEach((site, k) => {
    const at = `skirmishWorship.sites.${k}`;
    need("balance.json", `${at}.kind`, kinds, site.kind, "worship kind");
    site.rewards.forEach((r, j) => {
      if (r.type === "charges" || r.type === "unlockSpell" || r.type === "spell") need("balance.json", `${at}.rewards.${j}`, spells, r.spell, "spell");
      else if (r.type === "unlockBuilding") need("balance.json", `${at}.rewards.${j}`, buildings, r.building, "building");
      else if (r.type === "spawn") need("balance.json", `${at}.rewards.${j}`, units, r.unit, "unit");
      // a skirmish map has no fixed tribes or points to name
      if (r.type === "raid" || (r.type === "spawn" && r.tribe !== undefined) || ("at" in r && r.at)) issues.push({ file: "balance.json", path: `${at}.rewards.${j}`, message: `skirmish site rewards cannot name a tribe or a point` });
    });
  });
  if (p.balance.beasts) {
    const b = p.units.units.find((u) => u.id === p.balance.beasts!.kind);
    if (!b?.beast || !b.melee) issues.push({ file: "balance.json", path: "beasts.kind", message: `${p.balance.beasts.kind} is not a beast unit with melee` });
  }
  p.balance.skirmishLey?.kinds.forEach((k, j) => {
    need("balance.json", `skirmishLey.kinds.${j}`, kinds, k, "worship kind");
    if (!p.buildings.worship.kinds?.find((x) => x.id === k)?.capturable) issues.push({ file: "balance.json", path: `skirmishLey.kinds.${j}`, message: `${k} is not a capturable kind` });
  });
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
    if (r.type === "raid" && r.tribe >= lv.tribes.length) bad(path, `no tribe ${r.tribe}`);
    if (r.type === "awaken") awakens.push({ site: r.site, path });
    if (r.type === "shape") {
      if (r.shape === "disc" && r.r === undefined) bad(path, "a disc shape needs r");
      if (r.shape === "rect" && !r.size) bad(path, "a rect shape needs size");
      if (r.shape === "line" && (!r.to || r.width === undefined)) bad(path, "a line shape needs to and width");
    }
  };
  const awakens: { site: string; path: string }[] = [];
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
    else if (s.spawn !== "tree" && s.spawn !== "rock" && !units.has(s.spawn) && !buildings.has(s.spawn)) bad(path, `unknown spawn ${s.spawn}`);
    if (s.spawn === "hearth" && s.tribe !== undefined && s.tribe >= 0) hearths.add(s.tribe);
  });
  lv.tribes.forEach((_, k) => hearths.has(k) || bad("setup", `tribe ${k} has no hearth`));
  // prayer chains: every awaken names a dormant site, and every dormant site can be woken
  const dormant = new Set(lv.setup.flatMap((s) => (s.site?.dormant && s.site.tag ? [s.site.tag] : [])));
  lv.setup.forEach((s, k) => s.site?.dormant && !s.site.tag && bad(`setup.${k}.site`, "a dormant site needs a tag"));
  lv.objectives.forEach((o, k) => {
    const path = `objectives.${k}`;
    if (o.type === "worship" && !tags.has(o.site)) bad(path, `no site tagged ${o.site}`);
    if (o.after !== undefined && (o.after >= lv.objectives.length || o.after === k)) bad(path, `after names no other objective (${o.after})`);
    if ((o.type === "destroy" || o.type === "build") && !buildings.has(o.building)) bad(path, `unknown building ${o.building}`);
    if (o.type === "destroy" && o.tribe >= lv.tribes.length) bad(path, `no tribe ${o.tribe}`);
    if (o.type === "destroy" && !lv.setup.some((s) => s.spawn === o.building && s.tribe === o.tribe)) bad(path, `tribe ${o.tribe} starts with no ${o.building}`);
    if (o.type === "reach" && o.unit && !units.has(o.unit)) bad(path, `unknown unit ${o.unit}`);
    if (o.type === "hold") {
      const capturable = new Set((pack.buildings.worship.kinds ?? []).filter((x) => x.capturable).map((x) => x.id));
      if (o.kind && !capturable.has(o.kind)) bad(path, `${o.kind} is not a capturable worship kind`);
      const placed = lv.setup.filter((s) => capturable.has(s.spawn) && (!o.kind || s.spawn === o.kind)).reduce((a, s) => a + (s.count ?? 1), 0);
      if (placed < o.n) bad(path, `the level places ${placed} matching stones, fewer than ${o.n}`);
    }
    if (o.type === "clearDens") {
      if ((o.at === undefined) !== (o.r === undefined)) bad(path, "at and r go together");
      const inArea = (p: readonly number[] | undefined) => !o.at || !o.r || (p !== undefined && (p[0] - o.at[0]) * (p[0] - o.at[0]) + (p[1] - o.at[1]) * (p[1] - o.at[1]) <= o.r * o.r);
      const dens = lv.setup.filter((s) => (s.tribe ?? -1) < 0 && pack.units.units.find((u) => u.id === s.spawn)?.beast && inArea(s.near ?? s.at)).length;
      if (dens < (o.n ?? 1)) bad(path, `the level has ${dens} beast dens${o.at ? " in the area" : ""}, fewer than ${o.n ?? 1}`);
    }
    if ("fromStage" in o && o.fromStage && o.after === undefined) bad(path, "fromStage needs after");
  });
  lv.lose?.forEach((o, k) => {
    if (o.type !== "siteLost") return;
    if (!tags.has(o.site)) bad(`lose.${k}`, `no site tagged ${o.site}`);
    for (const g of [o.after, o.before]) if (g !== undefined && g >= lv.objectives.length) bad(`lose.${k}`, `names no objective (${g})`);
  });
  lv.triggers?.forEach((t, k) => {
    if (t.when.type === "worship" && !tags.has(t.when.site)) bad(`triggers.${k}.when`, `no site tagged ${t.when.site}`);
    if (t.when.type === "objective" && t.when.index >= lv.objectives.length) bad(`triggers.${k}.when`, `no objective ${t.when.index}`);
    if (t.when.type === "area" && t.when.unit && !units.has(t.when.unit)) bad(`triggers.${k}.when`, `unknown unit ${t.when.unit}`);
    t.do.forEach((r, j) => reward(r, `triggers.${k}.do.${j}`));
  });
  awakens.forEach((a) => dormant.has(a.site) || bad(a.path, `no dormant site tagged ${a.site}`));
  dormant.forEach((tag) => awakens.some((a) => a.site === tag) || bad("setup", `dormant site ${tag} is never awakened`));
  if (lv.objectives.some((o) => o.type === "eliminateAll") && lv.tribes.length < 2) bad("objectives", "eliminateAll needs an opponent");
  const variants = pack.balance.victory?.variants ?? [];
  const variant = variants.find((v) => v.id === lv.rules);
  if (lv.rules && !variant) bad("rules", `unknown victory rules ${lv.rules}`);
  if ((variant?.type === "holdSites" || variant?.type === "kingOfHill") && !lv.setup.some((s) => s.site)) bad("rules", `${lv.rules} needs a worship site to hold`);
  if (lv.objectives.some((o) => o.type === "victory") && !lv.rules) bad("objectives", "a victory objective needs level rules");
  if (lv.forge && !pack.balance.forge) bad("forge", "this pack has no balance.forge");
  return issues.length ? { issues } : { issues, level: lv };
}

/** BACKLOG 21: validate data/achievements.json against its schema and a pack (difficulties exist, ids unique). */
/** BACKLOG 78: data/ui.json against the pack (skirmish maps, opponents and difficulty must exist). */
export function validateUi(raw: unknown, pack: PackFiles, file = "data/ui.json"): { issues: PackIssue[]; file?: UiFile } {
  const res = UiFileSchema.safeParse(raw);
  if (!res.success) return { issues: res.error.issues.map((i) => ({ file, path: i.path.join("."), message: i.message })) };
  const issues: PackIssue[] = [];
  const sk = res.data.skirmish;
  const maps = new Set(pack.terrain.presets.map((p) => p.id));
  sk.maps.forEach((m, k) => maps.has(m) || issues.push({ file, path: `skirmish.maps.${k}`, message: `unknown map generator ${m}` }));
  if (!sk.mapSizes.includes(sk.defaultSize)) issues.push({ file, path: "skirmish.defaultSize", message: `defaultSize ${sk.defaultSize} is not one of mapSizes` });
  const opp = new Set(["economy", "none", ...pack.ai.personalities.map((p) => p.id)]);
  sk.defaultOpponents.forEach((o, k) => opp.has(o) || issues.push({ file, path: `skirmish.defaultOpponents.${k}`, message: `unknown opponent ${o}` }));
  if (sk.defaultOpponents.length > sk.maxOpponents) issues.push({ file, path: "skirmish.defaultOpponents", message: `more than maxOpponents (${sk.maxOpponents})` });
  if (!pack.ai.difficulties.some((d) => d.id === sk.defaultDifficulty)) issues.push({ file, path: "skirmish.defaultDifficulty", message: `unknown difficulty ${sk.defaultDifficulty}` });
  // stretch 2: spell combo hints name spells of the pack
  const spells = new Set(pack.spells.spells.map((sp) => sp.id));
  res.data.combos?.forEach((c, k) => {
    for (const f of ["after", "then"] as const) if (!spells.has(c[f])) issues.push({ file, path: `combos.${k}.${f}`, message: `unknown spell ${c[f]}` });
  });
  return issues.length ? { issues } : { issues, file: res.data };
}

export function validateAchievements(raw: unknown, pack: PackFiles, file = "data/achievements.json"): { issues: PackIssue[]; file?: AchievementsFile } {
  const res = AchievementsFileSchema.safeParse(raw);
  if (!res.success) return { issues: res.error.issues.map((i) => ({ file, path: i.path.join("."), message: i.message })) };
  const issues: PackIssue[] = [];
  const diffs = new Set(pack.ai.difficulties.map((d) => d.id));
  const seen = new Set<string>();
  res.data.achievements.forEach((a, k) => {
    if (seen.has(a.id)) issues.push({ file, path: `achievements.${k}.id`, message: `duplicate achievement ${a.id}` });
    seen.add(a.id);
    a.difficulty?.forEach((d, j) => diffs.has(d) || issues.push({ file, path: `achievements.${k}.difficulty.${j}`, message: `unknown difficulty ${d}` }));
    if (a.scope === "career" && (a.difficulty || a.mode)) issues.push({ file, path: `achievements.${k}`, message: "difficulty and mode apply to match achievements only" });
  });
  return issues.length ? { issues } : { issues, file: res.data };
}

// BACKLOG 18 (ADR-021): mod packs. A mod is a folder `mods/<id>/` with a manifest.json and any subset of
// the pack files as patches. applyMods merges mods onto the raw base files before validation, so a
// modded pack validates, cross checks and hashes like the base (the hash changes with the mods, which
// keeps replays and saves from loading against the wrong rules). Pure: no file access here.
import { ManifestSchema, PACK_FILES } from "./schemas.ts";

export interface ModPack {
  /** the folder name; must match manifest.id */
  id: string;
  /** parsed JSON files of the folder by file name, manifest.json included */
  files: Record<string, unknown>;
}

export interface ModIssue {
  mod: string;
  file: string;
  message: string;
}

/** Two or more mods set the same value (or one removes what another changed); the last in load order wins. */
export interface ModConflict {
  path: string;
  mods: string[];
}

export interface ModResult {
  raw: Record<string, unknown>;
  issues: ModIssue[];
  conflicts: ModConflict[];
  /** the mods applied, in load order */
  applied: { id: string; name: string; version: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const idList = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === "string");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Merge `mods` onto the raw `base` files (not mutated). Mods apply in manifest `loadOrder` (then id) order.
 * Objects merge key by key, lists of objects with ids merge by id (fields deep merged, `"$remove": true`
 * deletes, unknown ids append), anything else replaces. `$comment` keys are ignored.
 */
export function applyMods(base: Record<string, unknown>, mods: readonly ModPack[]): ModResult {
  const raw = clone(base);
  const issues: ModIssue[] = [];
  const conflicts: ModConflict[] = [];
  const applied: ModResult["applied"] = [];
  const touched: { path: string; mod: string }[] = [];
  const ordered: { mod: ModPack; order: number; name: string; version: string }[] = [];
  const seen = new Set<string>();
  for (const mod of mods) {
    const m = ManifestSchema.safeParse(mod.files["manifest.json"]);
    if (!m.success) {
      issues.push({ mod: mod.id, file: "manifest.json", message: m.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") });
      continue;
    }
    if (m.data.id !== mod.id) issues.push({ mod: mod.id, file: "manifest.json", message: `id "${m.data.id}" must match the folder name "${mod.id}"` });
    else if (m.data.loadOrder < 1) issues.push({ mod: mod.id, file: "manifest.json", message: "loadOrder must be 1 or more (0 is the base pack)" });
    else if (seen.has(mod.id)) issues.push({ mod: mod.id, file: "manifest.json", message: "listed twice" });
    else {
      seen.add(mod.id);
      ordered.push({ mod, order: m.data.loadOrder, name: m.data.name, version: m.data.version });
    }
  }
  ordered.sort((a, b) => a.order - b.order || (a.mod.id < b.mod.id ? -1 : a.mod.id > b.mod.id ? 1 : 0));

  const touch = (path: string, mod: string) => {
    for (const t of touched) {
      if (t.mod === mod) continue;
      const overlap = t.path === path || path.startsWith(t.path + ".") || path.startsWith(t.path + "[") || t.path.startsWith(path + ".") || t.path.startsWith(path + "[");
      if (!overlap) continue;
      const at = t.path.length <= path.length ? t.path : path;
      const c = conflicts.find((x) => x.path === at);
      if (!c) conflicts.push({ path: at, mods: [t.mod, mod] });
      else if (!c.mods.includes(mod)) c.mods.push(mod);
    }
    touched.push({ path, mod });
  };

  const merge = (target: Record<string, unknown>, patch: Record<string, unknown>, path: string, mod: string) => {
    for (const key of Object.keys(patch)) {
      if (key === "$comment") continue;
      const p = path ? `${path}.${key}` : key;
      const cur = target[key];
      const val = patch[key];
      if (isObj(cur) && isObj(val)) merge(cur, val, p, mod);
      else if (Array.isArray(val) && (idList(cur) || (Array.isArray(cur) && cur.length === 0)) && idList(val)) mergeList(cur as { id: string }[], val, p, mod);
      else {
        target[key] = clone(val);
        touch(p, mod);
      }
    }
  };

  const mergeList = (list: { id: string }[], patch: { id: string; $remove?: unknown }[], path: string, mod: string) => {
    for (const item of patch) {
      const p = `${path}[${item.id}]`;
      const i = list.findIndex((x) => x.id === item.id);
      if (item.$remove === true) {
        if (i >= 0) list.splice(i, 1);
        touch(p, mod);
        continue;
      }
      const { $remove: _r, ...rest } = item;
      if (i >= 0) {
        const { id: _id, ...fields } = rest;
        merge(list[i] as Record<string, unknown>, fields, p, mod);
      } else {
        list.push(clone(rest));
        touch(p, mod);
      }
    }
  };

  for (const { mod, name, version } of ordered) {
    for (const file of Object.keys(mod.files).sort()) {
      if (file === "manifest.json") continue;
      if (!(file in PACK_FILES)) {
        issues.push({ mod: mod.id, file, message: "not a pack file (mods patch the base pack files by name)" });
        continue;
      }
      const patch = mod.files[file];
      if (!isObj(patch) || !isObj(raw[file])) {
        issues.push({ mod: mod.id, file, message: "a patch must be a JSON object" });
        continue;
      }
      merge(raw[file] as Record<string, unknown>, patch, file, mod.id);
    }
    applied.push({ id: mod.id, name, version });
  }
  return { raw, issues, conflicts, applied };
}

/** Mod ids from a comma separated list (a URL or CLI option); blanks dropped, order kept. */
export function parseModList(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

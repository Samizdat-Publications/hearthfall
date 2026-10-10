// Node-side data pack access: read pack folders from disk, validate, generate docs/DATA.md and
// data/schema/*.json. Imports the TypeScript data package directly (Node type stripping).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { AchievementsFileSchema, PACK_FILES, applyMods, validateAchievements, validateLevel, validatePack } from "../../packages/data/src/index.ts";
import { ROOT } from "../guards/lib.mjs";

export function readPackDir(dir = "data/base") {
  const abs = ROOT + dir + "/";
  const raw = {};
  const parseErrors = [];
  for (const f of readdirSync(abs).filter((x) => x.endsWith(".json")).sort()) {
    try {
      raw[f] = JSON.parse(readFileSync(abs + f, "utf8"));
    } catch (e) {
      parseErrors.push({ file: `${dir}/${f}`, path: "", message: String(e.message).split("\n")[0] });
    }
  }
  return { raw, parseErrors };
}

/**
 * The base pack, validated; with `mods` (ids of folders under mods/, BACKLOG 18) the mods are merged on
 * first and the result also carries `mods` (applied, in load order) and `conflicts`.
 */
export function loadBasePack(mods = []) {
  const { raw, parseErrors } = readPackDir();
  if (parseErrors.length) return { issues: parseErrors };
  if (!mods.length) return validatePack(raw);
  const packs = [];
  const issues = [];
  for (const id of mods) {
    const m = readModDir(id);
    issues.push(...m.issues);
    if (m.mod) packs.push(m.mod);
  }
  const merged = applyMods(raw, packs);
  issues.push(...merged.issues.map((i) => ({ file: `mods/${i.mod}/${i.file}`, path: "", message: i.message })));
  if (issues.length) return { issues, conflicts: merged.conflicts };
  return { ...validatePack(merged.raw), mods: merged.applied, conflicts: merged.conflicts };
}

/** Mod folder ids under mods/ (BACKLOG 18), sorted. */
export function listMods() {
  const dir = ROOT + "mods/";
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** One mod folder as a ModPack (its JSON files by name). */
export function readModDir(id) {
  const dir = ROOT + `mods/${id}/`;
  if (!/^[a-z][a-z0-9_]*$/.test(id) || !existsSync(dir)) return { issues: [{ file: `mods/${id}`, path: "", message: "no such mod folder (ids are snake_case)" }] };
  const files = {};
  const issues = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    try {
      files[f] = JSON.parse(readFileSync(dir + f, "utf8"));
    } catch (e) {
      issues.push({ file: `mods/${id}/${f}`, path: "", message: String(e.message).split("\n")[0] });
    }
  }
  return { issues, mod: { id, files } };
}

/** M9 campaign levels: data/levels/*.json validated against the pack, sorted by campaign order. */
export function loadLevels(packFiles) {
  const dir = ROOT + "data/levels/";
  const levels = [];
  const issues = [];
  if (!existsSync(dir)) return { levels, issues };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const file = `data/levels/${f}`;
    let raw;
    try {
      raw = JSON.parse(readFileSync(dir + f, "utf8"));
    } catch (e) {
      issues.push({ file, path: "", message: String(e.message).split("\n")[0] });
      continue;
    }
    const res = validateLevel(raw, packFiles, file);
    issues.push(...res.issues);
    if (res.level) {
      if (f !== `${res.level.id}.json`) issues.push({ file, path: "id", message: `file name must be ${res.level.id}.json` });
      levels.push(res.level);
    }
  }
  const orders = new Set();
  for (const l of levels) {
    if (orders.has(l.order)) issues.push({ file: `data/levels/${l.id}.json`, path: "order", message: `duplicate campaign order ${l.order}` });
    orders.add(l.order);
  }
  levels.sort((a, b) => a.order - b.order);
  return { levels, issues };
}

/** BACKLOG 21: data/achievements.json validated against the pack. */
export function loadAchievements(packFiles) {
  const file = "data/achievements.json";
  let raw;
  try {
    raw = JSON.parse(readFileSync(ROOT + file, "utf8"));
  } catch (e) {
    return { issues: [{ file, path: "", message: String(e.message).split("\n")[0] }] };
  }
  return validateAchievements(raw, packFiles, file);
}

export function jsonSchemas() {
  const out = {};
  for (const [name, schema] of Object.entries(PACK_FILES)) out[name.replace(".json", ".schema.json")] = JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }), null, 2) + "\n";
  out["achievements.schema.json"] = JSON.stringify(z.toJSONSchema(AchievementsFileSchema, { io: "input", unrepresentable: "any" }), null, 2) + "\n";
  return out;
}

function typeOf(s) {
  if (!s || typeof s !== "object") return "any";
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(" or ");
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf).map(typeOf).join(" or ");
  if (s.type === "array") return s.prefixItems ? `[${s.prefixItems.map(typeOf).join(", ")}]` : `${typeOf(s.items)}[]`;
  if (s.type === "object") return s.properties ? "object" : "map";
  if (s.type === "integer") return "int";
  return s.type ?? "any";
}

function rows(schema, prefix, out) {
  const props = schema.properties ?? {};
  const req = new Set(schema.required ?? []);
  for (const k of Object.keys(props)) {
    if (k === "$comment") continue;
    const p = props[k];
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(`| \`${path}\` | ${typeOf(p)} | ${req.has(k) ? "yes" : ""} |`);
    if (p.type === "object" && p.properties) rows(p, path, out);
    if (p.type === "array" && p.items?.type === "object" && p.items.properties) rows(p.items, path + "[]", out);
  }
}

/** Deterministic markdown reference for the data pack. */
export function dataDocs() {
  const lines = [
    "# Data reference (generated)",
    "",
    "Generated by `npm run data:docs` from the zod schemas in `packages/data/src/schemas.ts`. Do not edit by hand; `npm run check` fails if this file is stale. JSON Schemas for editors: `data/schema/`.",
    "",
  ];
  const res = loadBasePack();
  if (res.pack) {
    const f = res.pack.files;
    lines.push(`Base pack \`${f.manifest.id}\` version ${f.manifest.version}, content hash \`${res.pack.hash}\`.`, "");
    lines.push(`- Units: ${f.units.units.map((u) => u.id).join(", ")}`);
    lines.push(`- Buildings: ${f.buildings.buildings.map((b) => b.id).join(", ")}`);
    lines.push(`- Spells (v1 marked *): ${f.spells.spells.map((s) => s.id + (s.v1 ? "*" : "")).join(", ")}`);
    lines.push(`- AI personalities: ${f.ai.personalities.map((p) => p.id).join(", ")}; difficulties: ${f.ai.difficulties.map((d) => d.id).join(", ")}`, "");
  }
  for (const [name, schema] of Object.entries(PACK_FILES)) {
    const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    lines.push(`## ${name}`, "", "| Field | Type | Required |", "|---|---|---|");
    rows(js, "", lines);
    if (name === "spells.json") {
      const effects = js.properties.spells.items.properties.effects.items.oneOf ?? js.properties.spells.items.properties.effects.items.anyOf ?? [];
      lines.push("", "Effect primitives (`spells[].effects[]`, discriminated by `type`):", "");
      // BACKLOG 31: a nested union (terrainOp by op) lists one line per variant
      for (const e of effects.flatMap((x) => x.oneOf ?? x.anyOf ?? [x])) {
        const fields = Object.keys(e.properties).filter((k) => k !== "type" && k !== "$comment" && !(k === "op" && e.properties.op.const));
        const name = e.properties.op?.const ? `${e.properties.type.const} ${e.properties.op.const}` : e.properties.type.const;
        lines.push(`- \`${name}\`: ${fields.map((k) => (e.required?.includes(k) ? k : k + "?")).join(", ")}`);
      }
    }
    lines.push("");
  }
  // BACKLOG 21: outside the pack (not hashed), validated against it
  const ach = z.toJSONSchema(AchievementsFileSchema, { io: "input", unrepresentable: "any" });
  lines.push("## achievements.json (data/, not in the pack hash)", "", "| Field | Type | Required |", "|---|---|---|");
  rows(ach, "", lines);
  lines.push("");
  return lines.join("\n");
}

// BACKLOG 12: the map editor's model, without a renderer so it is unit tested in Node.
// A draft is a plain level definition (data/levels/*.json shape). Tools append terrain paint discs
// and setup entries, presets set the objectives and victory rules, and validation is the same
// validateLevel the campaign loader runs. The game shows a preview world built from the draft and
// playtests it as a campaign level session (campaignParams), so an editor level plays exactly like
// a shipped one.
import { LevelSchema, validateLevel, type LevelDef, type PackFiles, type SiteSpec } from "@hearthfall/data";
import { World, applySetup, levelMap } from "@hearthfall/sim";
import type { KV } from "./storage.ts";

export const EDITOR_TOOLS = ["land", "sea", "hill", "hearth", "tree", "rock", "shrine", "reliquary", "erase"] as const;
export type EditorTool = (typeof EDITOR_TOOLS)[number];
export const EDITOR_GOALS = ["conquest", "worship", "survive", "followers", "hold", "hill"] as const;
export type EditorGoal = (typeof EDITOR_GOALS)[number];
export const EDITOR_SIZES = [64, 96, 128] as const;
export const EDITOR_KEY = "hearthfall.editor.v1";

/** Terrain heights the paint tools write (aboveSea, like the level files). */
const PAINT_HEIGHT: Record<string, number> = { land: 30, sea: -30, hill: 62 };
const DEFAULT_AI = ["aggressive", "turtle", "sneaky"];
/** setup kinds a hearth tool owns for its tribe (placed and erased together) */
const TRIBE_KINDS = new Set(["hearth", "shaper", "settler"]);

export interface ToolOpts {
  /** the tribe a Hearth goes to (clamped to the next free tribe) */
  tribe?: number;
  /** paint disc radius in cells */
  radius?: number;
}

/** A fresh two-tribe draft on land or sea: playable as it is (conquest against an aggressive rival). */
export function newDraft(size = 96, base: "land" | "sea" = "land"): LevelDef {
  const d: LevelDef = {
    id: "custom_level",
    name: "My Level",
    order: 1,
    description: "A level made in the map editor.",
    seed: 4242,
    map: { generator: "flat", size, landAboveSea: base === "land" ? 30 : -30, paint: [] },
    tribes: [{}],
    spells: ["bolt", "raise_land", "lightning"],
    setup: [],
    objectives: [{ type: "eliminateAll" }],
  };
  if (base === "sea") {
    d.map.paint!.push(disc(size * 0.3, size / 2, size * 0.16, 30), disc(size * 0.7, size / 2, size * 0.16, 30));
  }
  let out = applyTool(d, "hearth", Math.round(size * 0.3), Math.round(size / 2), { tribe: 0 });
  out = applyTool(out, "hearth", Math.round(size * 0.7), Math.round(size / 2), { tribe: 1 });
  return out;
}

function disc(x: number, y: number, r: number, aboveSea: number, falloff = 4) {
  return { shape: "disc" as const, at: [Math.round(x), Math.round(y)] as [number, number], r: Math.round(r), aboveSea, falloff };
}

function clone(d: LevelDef): LevelDef {
  return JSON.parse(JSON.stringify(d)) as LevelDef;
}

function pointOf(s: LevelDef["setup"][number]): [number, number] {
  return (s.at ?? s.near ?? [0, 0]) as [number, number];
}

/** Toroidal distance on a map of size n. */
function dist(n: number, ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  dx = Math.min(dx, n - dx);
  dy = Math.min(dy, n - dy);
  return Math.sqrt(dx * dx + dy * dy);
}

function siteTags(d: LevelDef): string[] {
  return d.setup.flatMap((s) => (s.site?.tag ? [s.site.tag] : []));
}

function nextTag(d: LevelDef, kind: string): string {
  const used = new Set(siteTags(d));
  for (let k = 1; ; k++) if (!used.has(`${kind}_${k}`)) return `${kind}_${k}`;
}

const SITE_DEFAULTS: Record<string, SiteSpec> = {
  shrine: { worshippers: 3, prayerSeconds: 20, uses: 1, rewards: [{ type: "charges", spell: "lightning", n: 1 }] },
  reliquary: { worshippers: 3, prayerSeconds: 30, uses: 1, rewards: [{ type: "unlockSpell", spell: "whirlwind" }, { type: "charges", spell: "whirlwind", n: 1 }] },
};

/** Apply one tool at map cell (x, y). Returns a new draft; the input is unchanged (the undo stack keeps it). */
export function applyTool(src: LevelDef, tool: EditorTool, x: number, y: number, opts: ToolOpts = {}): LevelDef {
  const d = clone(src);
  const n = d.map.size;
  const at: [number, number] = [Math.round(((x % n) + n) % n), Math.round(((y % n) + n) % n)];
  switch (tool) {
    case "land":
    case "sea":
    case "hill":
      (d.map.paint ??= []).push(disc(at[0], at[1], opts.radius ?? 6, PAINT_HEIGHT[tool], tool === "hill" ? 7 : 4));
      break;
    case "hearth": {
      const t = Math.max(0, Math.min(opts.tribe ?? 0, d.tribes.length, 3));
      while (d.tribes.length <= t) d.tribes.push({ ai: DEFAULT_AI[(d.tribes.length - 1) % DEFAULT_AI.length], difficulty: "normal" });
      d.setup = d.setup.filter((s) => !(s.tribe === t && TRIBE_KINDS.has(s.spawn)));
      const side = at[0] > n / 2 ? 1 : -1;
      d.setup.push(
        { spawn: "hearth", tribe: t, at },
        { spawn: "shaper", tribe: t, at: [at[0] - 3 * side, at[1] - 3] },
        { spawn: "settler", tribe: t, near: [at[0] + 3 * side, at[1] + 5], count: 10 },
      );
      break;
    }
    case "tree":
      d.setup.push({ spawn: "tree", near: at, count: 8, spacing: 1.2 });
      break;
    case "rock":
      d.setup.push({ spawn: "rock", near: at, count: 3, spacing: 2 });
      break;
    case "shrine":
    case "reliquary":
      d.setup.push({ spawn: tool, at, site: { tag: nextTag(d, tool), ...(JSON.parse(JSON.stringify(SITE_DEFAULTS[tool])) as SiteSpec) } });
      break;
    case "erase":
      return erase(d, at[0], at[1]);
  }
  return refreshGoal(d);
}

/** Remove the nearest setup entry within 5 cells (a Hearth takes its tribe's people along), else the newest paint disc under the point. */
function erase(d: LevelDef, x: number, y: number): LevelDef {
  const n = d.map.size;
  let best = -1;
  let bestD = 5;
  d.setup.forEach((s, k) => {
    const [px, py] = pointOf(s);
    const r = dist(n, x, y, px, py);
    if (r <= bestD) {
      bestD = r;
      best = k;
    }
  });
  if (best >= 0) {
    const s = d.setup[best];
    if (s.tribe !== undefined && s.tribe >= 0 && TRIBE_KINDS.has(s.spawn)) {
      const t = s.tribe;
      d.setup = d.setup.filter((e) => !(e.tribe === t && TRIBE_KINDS.has(e.spawn)));
      // the last opponent goes with its Hearth; a middle one stays (validation then asks for a Hearth)
      if (t > 0 && t === d.tribes.length - 1) d.tribes.pop();
    } else d.setup.splice(best, 1);
    return refreshGoal(d);
  }
  const paint = d.map.paint ?? [];
  for (let k = paint.length - 1; k >= 0; k--) {
    const p = paint[k];
    const r = p.r ?? Math.max(...(p.size ?? [0, 0])) / 2;
    if (dist(n, x, y, p.at[0], p.at[1]) <= r) {
      paint.splice(k, 1);
      break;
    }
  }
  return d;
}

/** Which preset the draft's objectives match (conquest when none does). */
export function goalOf(d: LevelDef): EditorGoal {
  if (d.rules === "hold_sites") return "hold";
  if (d.rules === "king_of_hill") return "hill";
  const o = d.objectives[0];
  if (o?.type === "worship") return "worship";
  if (o?.type === "survive") return "survive";
  if (o?.type === "followers") return "followers";
  return "conquest";
}

/** Set the win condition from a preset (rules for the victory variants). */
export function setGoal(src: LevelDef, goal: EditorGoal): LevelDef {
  const d = clone(src);
  delete d.rules;
  switch (goal) {
    case "conquest":
      d.objectives = [{ type: "eliminateAll" }];
      break;
    case "worship":
      d.objectives = [{ type: "worship", site: siteTags(d)[0] ?? "reliquary_1" }];
      break;
    case "survive":
      d.objectives = [{ type: "survive", seconds: 600 }];
      break;
    case "followers":
      d.objectives = [{ type: "followers", n: 30 }];
      break;
    case "hold":
      d.rules = "hold_sites";
      d.objectives = [{ type: "victory" }];
      break;
    case "hill":
      d.rules = "king_of_hill";
      d.objectives = [{ type: "victory" }];
      break;
  }
  return d;
}

/** A worship goal follows the first site as sites come and go. */
function refreshGoal(d: LevelDef): LevelDef {
  const o = d.objectives[0];
  if (o?.type === "worship") {
    const tags = siteTags(d);
    if (!tags.includes(o.site) && tags.length) o.site = tags[0];
  }
  return d;
}

/** Simple field edits from the panel. */
export function setField(src: LevelDef, field: "name" | "timeLimit" | "forge" | "seed", value: string | number | boolean): LevelDef {
  const d = clone(src);
  if (field === "name") d.name = String(value).slice(0, 40) || "My Level";
  else if (field === "seed") d.seed = Math.trunc(Number(value)) || 1;
  else if (field === "forge") {
    if (value) d.forge = true;
    else delete d.forge;
  } else {
    const s = Number(value);
    d.lose = (d.lose ?? []).filter((l) => l.type !== "timeLimit");
    if (s > 0) d.lose.push({ type: "timeLimit", seconds: s });
    if (!d.lose.length) delete d.lose;
  }
  return d;
}

/** An opponent's personality and difficulty (tribe 0 is the player and has none). */
export function setOpponent(src: LevelDef, tribe: number, ai: string, difficulty?: string): LevelDef {
  const d = clone(src);
  if (tribe <= 0 || tribe >= d.tribes.length) return d;
  d.tribes[tribe] = { ...d.tribes[tribe], ai, ...(difficulty ? { difficulty } : {}) };
  return d;
}

/** Validation messages, empty when the draft is a playable level. */
export function draftIssues(d: LevelDef, pack: PackFiles): string[] {
  return validateLevel(d, pack, "editor").issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
}

/** The preview world: the map and every setup entry that can be placed, with no level runtime, AI or timers. */
export function previewWorld(d: LevelDef, pack: PackFiles, packHash: string): World {
  const w = new World({ pack, packHash, seed: d.seed, map: levelMap(d), populate: false });
  for (const s of d.setup) {
    try {
      applySetup(w, [s]);
    } catch {
      // an entry the validator reports (an unknown kind, a tribe past the list) is left out of the preview
    }
  }
  return w;
}

/** Pretty JSON for the download and the storage slot. */
export function draftJson(d: LevelDef): string {
  return JSON.stringify(d, null, 2);
}

/** Parse a stored or loaded draft; null when it is not level-shaped (validation issues are fine). */
export function parseDraft(text: string | null): LevelDef | null {
  if (!text) return null;
  try {
    const res = LevelSchema.safeParse(JSON.parse(text));
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

export function storeDraft(kv: KV, d: LevelDef): boolean {
  try {
    kv.setItem(EDITOR_KEY, draftJson(d));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(kv: KV): LevelDef | null {
  try {
    return parseDraft(kv.getItem(EDITOR_KEY));
  } catch {
    return null;
  }
}

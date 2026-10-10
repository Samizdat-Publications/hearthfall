// BACKLOG 21 (ADR-019): match stats counted from the sim event log, career records and achievements.
// The sim knows nothing of this: the app notes each tick's events for the local tribe, and when a
// match ends it adds the match to the career totals and tests the data/achievements.json thresholds.
// No renderer here, so it is unit tested in Node.
import { STAT_KEYS, type AchievementDef, type AchievementsFile, type StatKey } from "@hearthfall/data";
import { CAT, type SimEvent } from "@hearthfall/sim";
import type { KV } from "./storage.ts";

export type Stats = Record<StatKey, number>;
/** browser storage key of the career records */
export const RECORDS_KEY = "hearthfall.records";
/** career keeps the largest value of these instead of the sum */
const MAX_KEYS: readonly StatKey[] = ["peakFollowers", "levelsWon"];

export interface Records {
  version: 1;
  career: Stats;
  /** achievement id to the ISO time it was earned */
  unlocked: Record<string, string>;
}

export interface MatchContext {
  mode: "skirmish" | "level";
  /** the opponents' difficulty */
  difficulty: string;
}

export function emptyStats(): Stats {
  const s = {} as Stats;
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

/** Count one sim event into the local tribe's match stats. */
export function noteEvent(s: Stats, e: SimEvent, me: number): void {
  switch (e.type) {
    case "killed":
    case "drowned":
      if (e.cat !== CAT.unit) return;
      if (e.tribe === me) s.lost++;
      else if (e.by === me && typeof e.tribe === "number" && e.tribe >= 0) {
        s.kills++;
        if (e.type === "drowned") s.drownedFoes++;
      }
      return;
    case "destroyed":
      if (e.cat === CAT.building && e.by === me && e.tribe !== me && typeof e.tribe === "number" && e.tribe >= 0) s.buildingsRazed++;
      return;
    case "shaperDied":
      if (e.tribe === me) s.shaperDeaths++;
      return;
    case "spellCast":
      // a Reliquary's reward cast is the site's, not the Shaper's
      if (e.tribe === me && e.by !== "site") s.spellsCast++;
      return;
    case "buildingDone":
      if (e.tribe === me) s.buildingsBuilt++;
      return;
    case "converted":
      if (e.to === me) s.converted++;
      return;
    case "trained":
      if (e.tribe === me) s.trained++;
      return;
    case "born":
      if (e.tribe === me) s.born++;
      return;
    case "worshipComplete":
      if (e.tribe === me) s.worship++;
      return;
  }
}

/** Career totals after one more match: sums, except the largest value for peak stats. */
export function addMatch(career: Stats, match: Stats): Stats {
  const out = emptyStats();
  for (const k of STAT_KEYS) out[k] = MAX_KEYS.includes(k) ? Math.max(career[k], match[k]) : career[k] + match[k];
  return out;
}

/** Whether an achievement holds for a finished match (match scope) or the career after it. */
export function passes(a: AchievementDef, match: Stats, career: Stats, ctx: MatchContext): boolean {
  const s = a.scope === "match" ? match : career;
  if (a.scope === "match") {
    if (a.mode && a.mode !== ctx.mode) return false;
    if (a.difficulty && !a.difficulty.includes(ctx.difficulty)) return false;
  }
  return a.when.every((t) => (t.min === undefined || s[t.stat] >= t.min) && (t.max === undefined || s[t.stat] <= t.max));
}

/**
 * Record a finished match: add it to the career and return the achievements it newly earned. `match.matches`
 * is set to 1 here. The records are changed in place; storing them is the caller's.
 */
export function recordMatch(file: AchievementsFile, rec: Records, match: Stats, ctx: MatchContext, at: string): AchievementDef[] {
  match.matches = 1;
  rec.career = addMatch(rec.career, match);
  const earned = file.achievements.filter((a) => !rec.unlocked[a.id] && passes(a, match, rec.career, ctx));
  for (const a of earned) rec.unlocked[a.id] = at;
  return earned;
}

export function emptyRecords(): Records {
  return { version: 1, career: emptyStats(), unlocked: {} };
}

/** The stored records; missing, damaged or partial records fall back to zeros. */
export function loadRecords(kv: KV): Records {
  const r = emptyRecords();
  try {
    const text = kv.getItem(RECORDS_KEY);
    if (!text) return r;
    const raw = JSON.parse(text) as Partial<Records>;
    for (const k of STAT_KEYS) {
      const v = raw.career?.[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) r.career[k] = v;
    }
    if (raw.unlocked && typeof raw.unlocked === "object") for (const [id, at] of Object.entries(raw.unlocked)) if (typeof at === "string") r.unlocked[id] = at;
  } catch {
    // damaged records start over
  }
  return r;
}

export function storeRecords(kv: KV, r: Records): boolean {
  try {
    kv.setItem(RECORDS_KEY, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

/** A stat for the records screen: minutes with one decimal, the rest whole. */
export function statText(k: StatKey, v: number): string {
  return k === "minutes" ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v));
}

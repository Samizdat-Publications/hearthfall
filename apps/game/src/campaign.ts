// Campaign progress (M9): which levels the player has won (browser storage), which levels are open
// (the first, and any whose predecessor is won) and what a level starts with: the unlocks of every
// earlier level the player has won, plus the spells its Reliquaries and shrines taught (BACKLOG 9,
// ADR-015: `learned`, stored next to `won`; records written before it simply have none). Pure functions
// over the level list, unit tested in Node.
import type { LevelDef } from "@hearthfall/data";
import type { CampaignCarry } from "@hearthfall/sim";
import type { KV } from "./storage.ts";

const PROGRESS_KEY = "hearthfall.campaign.v1";

/** Ids of the levels won so far (empty when storage is unavailable or damaged). */
export function loadProgress(kv: KV): string[] {
  try {
    const raw = kv.getItem(PROGRESS_KEY);
    const o = raw ? (JSON.parse(raw) as { won?: unknown }) : null;
    return Array.isArray(o?.won) ? o.won.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Spells each won level taught the player in play (its sites' unlockSpell rewards), by level id. */
export function loadLearned(kv: KV): Record<string, string[]> {
  try {
    const raw = kv.getItem(PROGRESS_KEY);
    const o = raw ? (JSON.parse(raw) as { learned?: unknown }) : null;
    const out: Record<string, string[]> = {};
    if (o?.learned && typeof o.learned === "object" && !Array.isArray(o.learned)) {
      for (const [k, v] of Object.entries(o.learned as Record<string, unknown>)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Record a won level and the spells it taught (kept from the best earlier win too); false when storage
 * refused the write (progress then lasts this session only).
 */
export function recordWin(kv: KV, id: string, won: string[], learned: Record<string, string[]> = {}, taught: string[] = []): boolean {
  if (!won.includes(id)) won.push(id);
  learned[id] = [...new Set([...(learned[id] ?? []), ...taught])];
  try {
    kv.setItem(PROGRESS_KEY, JSON.stringify({ won, learned }));
    return true;
  } catch {
    return false;
  }
}

/** S4 L7-A: the chapter (index into `chapters`) a campaign order belongs to; 0 without chapters */
export function chapterOf(order: number, chapters: readonly { from: number }[] = []): number {
  let k = 0;
  for (let i = 0; i < chapters.length; i++) if (order >= chapters[i].from) k = i;
  return k;
}

/** Levels sorted by campaign order. */
export function ordered(levels: LevelDef[]): LevelDef[] {
  return [...levels].sort((a, b) => a.order - b.order);
}

export function levelOpen(levels: LevelDef[], won: string[], id: string): boolean {
  const list = ordered(levels);
  const k = list.findIndex((l) => l.id === id);
  return k === 0 || (k > 0 && won.includes(list[k - 1].id));
}

export function nextLevel(levels: LevelDef[], id: string): LevelDef | null {
  const list = ordered(levels);
  const k = list.findIndex((l) => l.id === id);
  return k >= 0 && k + 1 < list.length ? list[k + 1] : null;
}

/** Spells the player holds at the end of a level that neither the level nor the carry opened: taught in play. */
export function taughtSpells(unlocked: string[], def: LevelDef, carry: CampaignCarry): string[] {
  return unlocked.filter((s) => !def.spells.includes(s) && !(carry.spells ?? []).includes(s));
}

/** The unlocks a level starts with: everything earlier levels the player won unlock or taught. */
export function campaignCarry(levels: LevelDef[], won: string[], id: string, learned: Record<string, string[]> = {}): CampaignCarry {
  const me = levels.find((l) => l.id === id);
  const spells = new Set<string>();
  const buildings = new Set<string>();
  for (const l of ordered(levels)) {
    if (!me || l.order >= me.order || !won.includes(l.id)) continue;
    for (const s of l.unlocks?.spells ?? []) spells.add(s);
    for (const s of learned[l.id] ?? []) spells.add(s);
    for (const b of l.unlocks?.buildings ?? []) buildings.add(b);
  }
  return { spells: [...spells], buildings: [...buildings] };
}

// Campaign progress (M9): which levels the player has won (browser storage), which levels are open
// (the first, and any whose predecessor is won) and what a level starts with: the unlocks of every
// earlier level the player has won. Pure functions over the level list, unit tested in Node.
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

/** Record a won level; false when storage refused the write (progress then lasts this session only). */
export function recordWin(kv: KV, id: string, won: string[]): boolean {
  if (!won.includes(id)) won.push(id);
  try {
    kv.setItem(PROGRESS_KEY, JSON.stringify({ won }));
    return true;
  } catch {
    return false;
  }
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

/** The unlocks a level starts with: everything earlier levels the player won unlock. */
export function campaignCarry(levels: LevelDef[], won: string[], id: string): CampaignCarry {
  const me = levels.find((l) => l.id === id);
  const spells = new Set<string>();
  const buildings = new Set<string>();
  for (const l of ordered(levels)) {
    if (!me || l.order >= me.order || !won.includes(l.id)) continue;
    for (const s of l.unlocks?.spells ?? []) spells.add(s);
    for (const b of l.unlocks?.buildings ?? []) buildings.add(b);
  }
  return { spells: [...spells], buildings: [...buildings] };
}

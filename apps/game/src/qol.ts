// QoL part 1 (game speed, quick save, edge scrolling, the level briefing): the decisions as plain functions,
// so they test outside the browser. Game speed only changes how many fixed sim steps a frame runs; the sim
// itself never sees it, so saves, replays and LAN lockstep are unaffected.
import type { LevelDef } from "@hearthfall/data";
import type { KV } from "./storage.ts";

/** the quick save lives in its own storage slot, apart from the manual slots 1..SLOTS */
export const QUICK_SLOT = 0;

export interface SpeedCfg {
  /** offered speeds as multiples of real time, slowest first */
  choices: number[];
  /** the most fixed sim steps one frame may run before the backlog is dropped */
  maxStepsPerFrame: number;
}

/** used when data/ui.json has no speed block */
export const SPEED_DEFAULTS: SpeedCfg = { choices: [0.5, 1, 2, 3], maxStepsPerFrame: 12 };

/** The speed choices from ui.json (sorted, unique, always holding 1x) and the step cap. */
export function speedCfg(raw: Partial<SpeedCfg> | undefined): SpeedCfg {
  const list = (raw?.choices?.length ? raw.choices : SPEED_DEFAULTS.choices).filter((v) => Number.isFinite(v) && v > 0);
  const choices = [...new Set([...list, 1])].sort((a, b) => a - b);
  const cap = raw?.maxStepsPerFrame;
  return { choices, maxStepsPerFrame: typeof cap === "number" && cap >= 1 ? Math.floor(cap) : SPEED_DEFAULTS.maxStepsPerFrame };
}

/** The next speed up (dir 1) or down (dir -1) from `cur`; stays put at either end. */
export function nextSpeed(choices: readonly number[], cur: number, dir: 1 | -1): number {
  if (!choices.length) return 1;
  let k = choices.indexOf(cur);
  if (k < 0) {
    // a speed no longer offered: snap to the nearest choice first
    k = 0;
    for (let i = 1; i < choices.length; i++) if (Math.abs(choices[i] - cur) < Math.abs(choices[k] - cur)) k = i;
    return choices[k];
  }
  return choices[Math.min(choices.length - 1, Math.max(0, k + dir))];
}

/** "1x", "2x", "0.5x" */
export const speedLabel = (v: number): string => `${Number(v.toFixed(2))}x`;

/**
 * Fixed steps for one frame. `acc` already includes this frame's time; each step takes `tickDt` of it.
 * At most `cap` steps run; with `dropBacklog` the time a capped frame could not run is thrown away (a slow
 * frame then plays slower instead of spiralling into ever longer catch-up frames).
 */
export function stepPlan(acc: number, tickDt: number, cap: number, dropBacklog: boolean): { steps: number; rest: number } {
  if (!(tickDt > 0) || !(acc > 0)) return { steps: 0, rest: Math.max(0, acc || 0) };
  let steps = Math.floor(acc / tickDt + 1e-9);
  let rest = acc - steps * tickDt;
  if (steps > cap) {
    rest = dropBacklog ? Math.min(rest, tickDt) : acc - cap * tickDt;
    steps = cap;
  }
  return { steps, rest: Math.max(0, rest) };
}

/** What a match must be for game speed, restart and the quick save: single player, in play, not a replay. */
export interface MatchState {
  inGame: boolean;
  /** a skirmish or campaign session is running (scenarios and the menu backdrop are not) */
  session: boolean;
  ended: boolean;
  net: boolean;
  /** people playing this match (a LAN session has 2) */
  humans: number;
  replay: boolean;
  editor: boolean;
}

/** Game speed applies to single player matches and the campaign only (never LAN play or replays). */
export function speedAllowed(s: MatchState): boolean {
  return s.inGame && !s.net && !s.replay && !s.editor && s.humans <= 1;
}

/** Why a quick save cannot happen now, or null when it can. */
export function quickSaveBlock(s: MatchState): string | null {
  if (s.net || s.humans > 1) return "Quick save is not available in a LAN match.";
  if (s.replay) return "A replay cannot be saved.";
  if (!s.inGame || !s.session || s.editor) return "Only a skirmish or campaign level in progress can be quick saved.";
  if (s.ended) return "The match is over: there is nothing to quick save.";
  return null;
}

/** Why a quick load cannot happen now, or null when it can (the slot itself is checked when it is read). */
export function quickLoadBlock(s: MatchState): string | null {
  if (s.net || s.humans > 1) return "Quick load is not available in a LAN match.";
  if (s.replay) return "Leave the replay before loading a game.";
  if (s.editor) return "Leave the map editor before loading a game.";
  return null;
}

/** Restart offers "level" in a campaign level, "match" in a skirmish, and nothing elsewhere. */
export function restartKind(s: MatchState, campaign: boolean): "level" | "match" | null {
  if (!s.inGame || !s.session || s.net || s.humans > 1 || s.replay || s.editor) return null;
  return campaign ? "level" : "match";
}

/**
 * Edge scrolling: the pan direction for a pointer at (x, y) in a w by h window, each -1, 0 or 1.
 * `right` pans the camera right, `forward` pans it away from the viewer (the top edge).
 */
export function edgePan(x: number, y: number, w: number, h: number, px: number): { right: number; forward: number } {
  if (!(w > 0 && h > 0) || x < 0 || y < 0 || x > w || y > h) return { right: 0, forward: 0 };
  const right = x <= px ? -1 : x >= w - 1 - px ? 1 : 0;
  const forward = y <= px ? 1 : y >= h - 1 - px ? -1 : 0;
  return { right, forward };
}

/** Briefing: the scripted level messages the player has seen so far, in trigger order, without repeats. */
export function briefingMessages(def: Pick<LevelDef, "triggers">, fired: readonly number[], receiver: (k: number) => number, me: number): string[] {
  const out: string[] = [];
  (def.triggers ?? []).forEach((t, k) => {
    if (!fired[k] || receiver(k) !== me) return;
    for (const r of t.do) if (r.type === "message" && !out.includes(r.text)) out.push(r.text);
  });
  return out;
}

// ---- the edge scrolling setting, stored like the other settings (guarded browser storage)
const QOL_KEY = "hearthfall.qol.v1";

export interface QolSettings {
  edgeScroll: boolean;
}

export function loadQol(kv: KV): QolSettings {
  try {
    const raw = kv.getItem(QOL_KEY);
    const o = raw ? (JSON.parse(raw) as Partial<QolSettings>) : {};
    return { edgeScroll: typeof o.edgeScroll === "boolean" ? o.edgeScroll : true };
  } catch {
    return { edgeScroll: true };
  }
}

export function storeQol(kv: KV, q: QolSettings): boolean {
  try {
    kv.setItem(QOL_KEY, JSON.stringify(q));
    return true;
  } catch {
    return false;
  }
}

// Read-only warnings the view draws (chapter 4 prep, never written by the view): where the standing wolf
// dens are (world markers and the minimap) and which neutral level hazards are about to land (a located
// ground ring with a countdown). Both are pure queries over sim state; the hazard schedule itself lives in
// LevelRuntime (hazardWindow), which also emits the `hazardWarn` event the audio cue and the HUD note use.
import type { EffectDef, LevelDef } from "@hearthfall/data";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

/** One standing wild den to mark. `beacon`: an open clearDens objective counts it. */
export interface DenMark {
  /** index in world.beasts.dens */
  index: number;
  x: number;
  y: number;
  kind: string;
  beacon: boolean;
}

/** Does an open, unfinished clearDens objective of the level count this den (its area, when it has one)? */
function countedByOpenGoal(w: World, x: number, y: number): boolean {
  const lv = w.level;
  if (!lv) return false;
  const n = w.terrain.size;
  const objs = lv.def.objectives;
  for (let k = 0; k < objs.length; k++) {
    const o = objs[k];
    if (o.type !== "clearDens" || lv.done[k] === 1 || !lv.open(k)) continue;
    if (!o.at) return true;
    const r = o.r ?? 0;
    const dx = wrapDelta(x - o.at[0], n);
    const dy = wrapDelta(y - o.at[1], n);
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

/**
 * The standing wolf dens the viewer should be shown, written into `out` (entries are reused, so a caller that
 * keeps the array allocates nothing per call); returns how many. `seenBy` is the viewing tribe whose explored
 * ground limits what shows (a den in the dark stays hidden), or null to show every den. A den that an open
 * clearDens objective counts is always shown, flagged `beacon`: the objective already tells the player where.
 */
export function denMarks(w: World, seenBy: number | null, out: DenMark[]): number {
  const dens = w.beasts.dens;
  let n = 0;
  for (let i = 0; i < dens.length; i++) {
    const d = dens[i];
    if (d.cleared) continue;
    const beacon = countedByOpenGoal(w, d.x, d.y);
    if (!beacon && seenBy !== null && !w.vision.seen(seenBy, d.x, d.y)) continue;
    let m = out[n];
    if (!m) m = out[n] = { index: 0, x: 0, y: 0, kind: "", beacon: false };
    m.index = i;
    m.x = d.x;
    m.y = d.y;
    m.kind = d.kind;
    m.beacon = beacon;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- neutral level hazards
/** A time trigger's neutral (tribe -1) harmful spell, found once per level (balance.hazards must exist). */
export interface HazardSpec {
  /** index in the level's triggers */
  trigger: number;
  spell: string;
  /** the reward's own target, or null: the trigger's anchor (the player's Hearth) */
  at: [number, number] | null;
  /** warning ring radius (cells): the widest area the spell's effects cover */
  r: number;
}

/** A spell that only helps (heals, converts, buffs its own side) is no hazard. Pure. */
export function isHarmful(effects: readonly EffectDef[]): boolean {
  return effects.some((e) => e.type !== "healOverTime" && e.type !== "convertRadius" && !(e.type === "statusApply" && e.targets === "own"));
}

/**
 * Warning ring radius: the widest radius among a spell's effects, a ridge's width when it has no radius at all,
 * 1.5 cells at least. A scar, summoned hunter or spawned entity does not widen it. Pure.
 */
export function hazardRadius(effects: readonly EffectDef[]): number {
  let r = 0;
  for (const e of effects) {
    if (e.type === "scar" || e.type === "spawnEntity" || e.type === "summon") continue;
    if ("radius" in e && typeof e.radius === "number") r = Math.max(r, e.radius);
    else if ("width" in e && typeof e.width === "number") r = Math.max(r, e.width);
  }
  return r > 0 ? r : 1.5;
}

/**
 * The neutral hazards of a level: spell rewards with `tribe: -1` in time triggers, whose spell does harm. Worship,
 * area, objective and followers triggers fire the moment their condition holds, so they cannot give a lead time.
 * TODO: a `delay` on those rewards would let them warn too.
 */
export function hazardSpecs(def: LevelDef, w: World): HazardSpec[] {
  const out: HazardSpec[] = [];
  if (!w.cfg.pack.balance.hazards) return out;
  (def.triggers ?? []).forEach((t, k) => {
    if (t.when.type !== "time") return;
    for (const r of t.do) {
      if (r.type !== "spell" || r.tribe === undefined || r.tribe >= 0) continue;
      const s = w.cfg.spellIndex.get(r.spell);
      if (s === undefined) continue;
      const effects = w.cfg.pack.spells.spells[s].effects;
      if (isHarmful(effects)) out.push({ trigger: k, spell: r.spell, at: r.at ?? null, r: hazardRadius(effects) });
    }
  });
  return out;
}

/** A hazard whose warning is open: where it lands and how long is left. */
export interface HazardMark {
  spell: string;
  x: number;
  y: number;
  r: number;
  /** play ticks until the spell lands (fractional between ticks) and the length of the whole warning */
  left: number;
  total: number;
}

/**
 * The open hazard warnings of the level, written into `out` (entries are reused); returns how many. `alpha` is the
 * render interpolation between the last two ticks, so a countdown moves smoothly and follows game speed and pause.
 */
export function hazardMarks(w: World, alpha: number, out: HazardMark[]): number {
  const lv = w.level;
  if (!lv || !lv.hazards.length) return 0;
  const now = w.playTick + alpha;
  let n = 0;
  for (const h of lv.hazards) {
    const win = lv.hazardWindow(h);
    if (!win || now < win.from || now >= win.at) continue;
    let m = out[n];
    if (!m) m = out[n] = { spell: "", x: 0, y: 0, r: 0, left: 0, total: 0 };
    lv.hazardAt(h, scratch);
    m.spell = h.spell;
    m.x = scratch[0];
    m.y = scratch[1];
    m.r = h.r;
    m.left = win.at - now;
    m.total = win.at - win.from;
    n++;
  }
  return n;
}

const scratch: [number, number] = [0, 0];

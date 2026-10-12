// QoL part 2: under attack alerts, spell refusal reasons and idle troops, as plain functions of World state
// so they test outside the browser. Everything here reads the sim and never writes it.
import { CAT, NO_ENTITY, ORDER, shaperIndex, wrapDelta, type World } from "@hearthfall/sim";
import { t } from "@hearthfall/ui";

// ---------------------------------------------------------------- under attack alerts

export interface AlertCfg {
  /** one note per place every this many seconds */
  seconds: number;
  /** hits within this many cells of an earlier alert count as the same place */
  radius: number;
  /** how long a minimap ping shows */
  pingSeconds: number;
  /** idle troops within this many cells of each other are one group */
  idleGroupRadius: number;
}

/** used when data/ui.json has no alerts block */
export const ALERT_DEFAULTS: AlertCfg = { seconds: 15, radius: 14, pingSeconds: 4, idleGroupRadius: 8 };

export function alertCfg(raw: Partial<AlertCfg> | undefined): AlertCfg {
  const ok = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  return {
    seconds: ok(raw?.seconds, ALERT_DEFAULTS.seconds),
    radius: ok(raw?.radius, ALERT_DEFAULTS.radius),
    pingSeconds: ok(raw?.pingSeconds, ALERT_DEFAULTS.pingSeconds),
    idleGroupRadius: ok(raw?.idleGroupRadius, ALERT_DEFAULTS.idleGroupRadius),
  };
}

/** What was hit: the Hearth and the Shaper have their own notes; other buildings, then units. */
export type AlertKind = "hearth" | "shaper" | "building" | "units";

export interface Hit {
  kind: AlertKind;
  x: number;
  y: number;
}

/**
 * Own units and buildings an enemy damaged in the tick that just ran (World.damage stamps hitTick and the
 * attacker's tribe in lastHit). Damage from the own tribe or an ally does not count; a hit with no tribe
 * (wolves, burning, neutral hazards) does. Hits on the Hearth and the Shaper come first.
 */
export function hostileHits(w: World, me: number): Hit[] {
  const E = w.ents;
  const tick = w.tick - 1;
  const tr = w.tribes[me];
  if (!tr || tick <= 0) return [];
  const hearth = E.index(tr.hearth);
  const shaper = shaperIndex(w, me);
  const out: Hit[] = [];
  const rest: Hit[] = [];
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.tribe[i] !== me || E.hitTick[i] !== tick) continue;
    const cat = E.cat[i];
    if (cat !== CAT.unit && cat !== CAT.building) continue;
    const by = E.lastHit[i];
    if (by >= 0 && w.allied(by, me)) continue;
    const kind: AlertKind = i === hearth ? "hearth" : i === shaper ? "shaper" : cat === CAT.building ? "building" : "units";
    (kind === "hearth" || kind === "shaper" ? out : rest).push({ kind, x: E.x[i], y: E.y[i] });
  }
  // buildings before units, so an area under attack names its buildings
  rest.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "building" ? -1 : 1));
  return out.concat(rest);
}

export interface Alert extends Hit {
  /** world tick the alert was raised */
  tick: number;
}

/**
 * The per place throttle. The Hearth and the Shaper each have one slot; other hits share places: a hit within
 * `radius` cells of an alert raised less than `seconds` ago is quiet. Returns the hits that become alerts.
 */
export class AlertThrottle {
  /** recent alerts, oldest first (pruned as they age out) */
  recent: Alert[] = [];
  private readonly cfg: AlertCfg;
  private readonly size: number;
  private readonly hz: number;
  constructor(cfg: AlertCfg, size: number, hz: number) {
    this.cfg = cfg;
    this.size = size;
    this.hz = hz;
  }

  offer(hits: readonly Hit[], tick: number): Alert[] {
    const quiet = this.cfg.seconds * this.hz;
    this.recent = this.recent.filter((a) => tick - a.tick < quiet);
    const out: Alert[] = [];
    for (const h of hits) {
      const near = (a: Alert) => {
        if (h.kind === "hearth" || h.kind === "shaper") return a.kind === h.kind;
        if (a.kind === "hearth" || a.kind === "shaper") return false;
        const dx = wrapDelta(h.x - a.x, this.size);
        const dy = wrapDelta(h.y - a.y, this.size);
        return dx * dx + dy * dy <= this.cfg.radius * this.cfg.radius;
      };
      if (this.recent.some(near)) continue;
      const a = { ...h, tick };
      this.recent.push(a);
      out.push(a);
    }
    return out;
  }

  clear(): void {
    this.recent = [];
  }
}

/** The note for an alert (data/strings/en.json). */
export function alertText(kind: AlertKind): string {
  if (kind === "hearth") return t("alert.hearth");
  if (kind === "shaper") return t("alert.shaper");
  if (kind === "building") return t("alert.building");
  return t("alert.units");
}

/** A minimap ping: where, when it was raised (world tick) and whether it is the Hearth or the Shaper. */
export interface Ping {
  x: number;
  y: number;
  tick: number;
  big: boolean;
}

/**
 * Ring drawing for a ping `age` ticks old that lives `life` ticks: a ring that grows from 3 to 9 pixels
 * once a second and fades out over its life; null once it is gone.
 */
export function pingRing(age: number, life: number, hz: number): { r: number; alpha: number } | null {
  if (age < 0 || age >= life || life <= 0) return null;
  const phase = (age % hz) / hz;
  return { r: 3 + 6 * phase, alpha: Math.max(0, Math.min(1, (1 - age / life) * (1 - 0.5 * phase))) };
}

// ---------------------------------------------------------------- spell refusal reasons

/** Why a cast cannot go ahead, in the order the sim's cast validation checks it. */
export type CastBlock = "locked" | "noCharge" | "busy" | "dead";

/**
 * The sim's cast refusals (packages/sim/src/spells.ts registerCommand("cast").validate) for the local tribe,
 * checked before the command is sent, so the HUD can say why at once. null when the sim would accept it.
 */
export function castBlock(w: World, tribe: number, spell: string): CastBlock | null {
  const tr = w.tribes[tribe];
  const s = w.cfg.spellIndex.get(spell);
  if (!tr || !tr.alive || s === undefined) return null;
  if (!tr.eco.unlocked[s] && tr.eco.charges[s] <= 0) return "locked";
  if (tr.eco.charges[s] <= 0) return "noCharge";
  if (tr.casting) return "busy";
  if (shaperIndex(w, tribe) < 0) return "dead";
  return null;
}

/** A commandRejected reason string for a cast, mapped to the block it stands for (null: some other reason). */
export function rejectBlock(reason: string): CastBlock | null {
  switch (reason) {
    case "spell not unlocked":
      return "locked";
    case "no charge":
      return "noCharge";
    case "already casting":
      return "busy";
    case "the Shaper is dead":
      return "dead";
    default:
      return null;
  }
}

const spellName = (id: string) => id.split("_").map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");

/** The note for a refused cast: what is wrong and what to do about it. */
export function castBlockText(block: CastBlock, spell: string, cost: number, respawnSec: number): string {
  const name = spellName(spell);
  switch (block) {
    case "locked":
      return t("cast.locked", { spell: name });
    case "noCharge":
      return t("cast.noCharge", { spell: name, cost });
    case "busy":
      return t("cast.busy");
    case "dead":
      return respawnSec >= 0 ? t("cast.deadBack", { s: respawnSec }) : t("cast.dead");
  }
}

/** The short cursor text for the targeting line ("" when the cast can go ahead from here). */
export function castHint(block: CastBlock | null, inRange: boolean, onGround: boolean): string {
  if (block === "locked") return t("cast.hintLocked");
  if (block === "noCharge") return t("cast.hintNoCharge");
  if (block === "busy") return t("cast.hintBusy");
  if (block === "dead") return t("cast.hintDead");
  if (!onGround) return t("cast.hintNoGround");
  return inRange ? "" : t("cast.hintRange");
}

/** The note for a castFailed event (the sim gives "unreachable": no spot in range on the Shaper's land). */
export function castFailedText(spell: string, reason: string): string {
  return reason === "unreachable" ? t("cast.unreachable", { spell: spellName(spell) }) : t("cast.failed", { spell: spellName(spell), reason });
}

/** The note for a cast refused for a reason the HUD has no plain words for. */
export function castOtherText(spell: string, reason: string): string {
  return t("cast.failed", { spell: spellName(spell), reason });
}

// ---------------------------------------------------------------- spell tooltips

/** One line on what each spell does (data/strings/en.json, matching data/base/spells.json); "" for unknown ids. */
export function spellTip(id: string): string {
  const tips: Record<string, () => string> = {
    bolt: () => t("spellTip.bolt"),
    call: () => t("spellTip.call"),
    hornets: () => t("spellTip.hornets"),
    veil: () => t("spellTip.veil"),
    ward: () => t("spellTip.ward"),
    raise_land: () => t("spellTip.raise_land"),
    lightning: () => t("spellTip.lightning"),
    beguile: () => t("spellTip.beguile"),
    whirlwind: () => t("spellTip.whirlwind"),
    mire: () => t("spellTip.mire"),
    flatten: () => t("spellTip.flatten"),
    quake: () => t("spellTip.quake"),
    erode: () => t("spellTip.erode"),
    firerain: () => t("spellTip.firerain"),
    wraith: () => t("spellTip.wraith"),
    volcano: () => t("spellTip.volcano"),
    sanctuary: () => t("spellTip.sanctuary"),
    deluge: () => t("spellTip.deluge"),
  };
  return tips[id]?.() ?? "";
}

/** A spell button's tooltip: name and hotkey, what it does, its cost and charges, and the mouse actions. */
export function spellTooltip(s: { id: string; name: string; hotkey: string; cost: number; charges: number; max: number }): string {
  return t("spell.tooltip", { name: s.name, key: s.hotkey ? ` (${s.hotkey})` : "", tip: spellTip(s.id), cost: s.cost, charges: s.charges, max: s.max }).replace(/: {2}/, ": ");
}

// ---------------------------------------------------------------- idle troops

/** A trained fighter (a unit type trained at a lodge): Wardens, Firecallers, Chanters, Shades. */
export function isTroop(w: World, i: number): boolean {
  return w.ents.cat[i] === CAT.unit && Boolean(w.cfg.pack.units.units[w.ents.type[i]]?.trainedAt);
}

/** Own troops standing about: no move order, no attack target, not chanting and not inside a building. */
export function idleTroops(w: World, me: number): number[] {
  const E = w.ents;
  const out: number[] = [];
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.tribe[i] !== me || !isTroop(w, i)) continue;
    if (E.order[i] !== ORDER.none || E.atk[i] !== NO_ENTITY || E.chant[i] > 0 || E.inside[i] >= 0) continue;
    out.push(i);
  }
  return out;
}

/** Idle troops split into groups: troops within `radius` cells of one another (chained) share a group. Groups keep index order. */
export function idleGroups(w: World, idle: readonly number[], radius: number): number[][] {
  const E = w.ents;
  const n = w.terrain.size;
  const r2 = radius * radius;
  const group = new Array<number>(idle.length).fill(-1);
  const groups: number[][] = [];
  for (let a = 0; a < idle.length; a++) {
    if (group[a] >= 0) continue;
    const g: number[] = [];
    group[a] = groups.length;
    const stack = [a];
    while (stack.length) {
      const k = stack.pop()!;
      g.push(idle[k]);
      for (let b = 0; b < idle.length; b++) {
        if (group[b] >= 0) continue;
        const dx = wrapDelta(E.x[idle[b]] - E.x[idle[k]], n);
        const dy = wrapDelta(E.y[idle[b]] - E.y[idle[k]], n);
        if (dx * dx + dy * dy <= r2) {
          group[b] = groups.length;
          stack.push(b);
        }
      }
    }
    groups.push(g.sort((p, q) => p - q));
  }
  return groups;
}

/**
 * The group after the one picked last (`lastId`, the entity id of its first member; -1 at the start), by
 * the entity id of each group's first member, wrapping around. null when there are no groups.
 */
export function nextIdleGroup(groups: readonly number[][], idOf: (i: number) => number, lastId: number): { group: number[]; id: number } | null {
  if (!groups.length) return null;
  const keyed = groups.map((g) => ({ group: g, id: Math.min(...g.map(idOf)) })).sort((a, b) => a.id - b.id);
  return keyed.find((k) => k.id > lastId) ?? keyed[0];
}

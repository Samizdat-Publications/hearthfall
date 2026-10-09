// M6 troop controls: reads sim state for the HUD troop panel and turns troop intents into Commands.
// Pure functions of (World, tribe, selection) so they are unit tested without a browser.
import { BSTATE, CAT, STANCE_NAMES, wrapDelta, type World } from "@hearthfall/sim";
import type { TroopView } from "@hearthfall/ui";

const title = (id: string) => id.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** Own building whose footprint (plus half a cell) contains the point, else -1. */
export function buildingAt(w: World, tribe: number, x: number, y: number): number {
  const E = w.ents;
  const n = w.terrain.size;
  const defs = w.cfg.pack.buildings.buildings;
  for (let b = 0; b < E.hi; b++) {
    if (!E.alive[b] || E.cat[b] !== CAT.building || E.tribe[b] !== tribe) continue;
    const [fw, fh] = defs[E.type[b]].footprint;
    if (Math.abs(wrapDelta(x - E.x[b], n)) <= fw / 2 + 0.5 && Math.abs(wrapDelta(y - E.y[b], n)) <= fh / 2 + 0.5) return b;
  }
  return -1;
}

/** Tag of the worship site under (x, y) that still has something to give, else null (M9). */
export function siteAt(w: World, x: number, y: number): string | null {
  const E = w.ents;
  const n = w.terrain.size;
  for (const s of w.worship.sites) {
    const i = E.index(s.ent);
    if (i < 0 || s.usesLeft <= 0) continue;
    if (Math.abs(wrapDelta(x - E.x[i], n)) <= 1.5 && Math.abs(wrapDelta(y - E.y[i], n)) <= 1.5) return s.tag;
  }
  return null;
}

/** Nearest own finished Watchtower with a free slot for the selection's first unit, else -1. */
export function towerFor(w: World, sel: readonly number[]): number {
  const i = sel.find((k) => w.ents.alive[k] && w.ents.cat[k] === CAT.unit && !w.cfg.pack.units.units[w.ents.type[k]].isCaster);
  return i === undefined ? -1 : w.combat.nearestTower(i, w.combat.queued());
}

/** Selection by unit kind, in data order: count and mean health fraction. */
export function unitMix(w: World, units: readonly number[]): { id: string; name: string; count: number; hpFrac: number }[] {
  const E = w.ents;
  const defs = w.cfg.pack.units.units;
  const by = new Map<number, { count: number; hp: number }>();
  for (const i of units) {
    const k = by.get(E.type[i]) ?? { count: 0, hp: 0 };
    k.count++;
    k.hp += Math.min(1, Math.max(0, E.hp[i] / Math.max(1, defs[E.type[i]].hp)));
    by.set(E.type[i], k);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([t, k]) => ({ id: defs[t].id, name: title(defs[t].id) + (k.count > 1 ? "s" : ""), count: k.count, hpFrac: +(k.hp / k.count).toFixed(3) }));
}

export function troopView(w: World, tribe: number, sel: readonly number[], b: number): TroopView {
  const E = w.ents;
  const none: TroopView = { kind: "none", label: "", stance: null, canGarrison: false, count: 0, max: 0, rally: false, building: false, units: [] };
  if (b >= 0 && E.alive[b] && E.cat[b] === CAT.building && E.tribe[b] === tribe) {
    const def = w.cfg.pack.buildings.buildings[E.type[b]];
    const building = E.state[b] !== BSTATE.done;
    const name = title(def.id) + (building ? " (building)" : "");
    if (w.combat.trainsAt(E.type[b]) >= 0) {
      const count = w.combat.queued().get(b) ?? 0;
      const max = def.queueMax ?? 5;
      return { ...none, kind: "lodge", label: `${name}: ${count}/${max} training`, count, max, rally: E.mode[b] === 1, building };
    }
    const slots = w.combat.garrisonOf(E.type[b]);
    if (slots > 0) return { ...none, kind: "tower", label: `${name}: ${E.occupants[b]}/${slots} inside`, count: E.occupants[b], max: slots, building };
    return none;
  }
  const units = sel.filter((i) => E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe);
  if (!units.length) return none;
  const s0 = E.stance[units[0]];
  const same = units.every((i) => E.stance[i] === s0);
  return { ...none, kind: "units", label: `${units.length} selected`, stance: same ? STANCE_NAMES[s0] : null, canGarrison: towerFor(w, units) >= 0, units: unitMix(w, units) };
}

/** A Command without its tick (Game.command stamps it). */
export interface TroopCommand {
  tribe: number;
  type: string;
  args: Record<string, unknown>;
}

export type TroopIntent =
  | { kind: "train"; n: number }
  | { kind: "rally"; at: [number, number] | null }
  | { kind: "ungarrison" }
  | { kind: "garrison"; tower?: number }
  | { kind: "retreat" }
  | { kind: "stance"; stance: (typeof STANCE_NAMES)[number] };

/** The Command for a troop intent, or null when the selection cannot do it. */
export function troopCommand(w: World, tribe: number, sel: readonly number[], b: number, it: TroopIntent): TroopCommand | null {
  const E = w.ents;
  const ids = sel.filter((i) => E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe).map((i) => E.idOf(i));
  const bid = b >= 0 && E.alive[b] ? E.idOf(b) : -1;
  const c = (type: string, args: Record<string, unknown>): TroopCommand => ({ tribe, type, args });
  switch (it.kind) {
    case "train":
      return bid >= 0 ? c("train", { building: bid, count: it.n }) : null;
    case "rally":
      return bid >= 0 ? c("setRally", { building: bid, at: it.at }) : null;
    case "ungarrison":
      return bid >= 0 ? c("ungarrison", { building: bid }) : null;
    case "garrison": {
      const t = it.tower ?? towerFor(w, sel);
      return ids.length && t >= 0 ? c("garrison", { units: ids, building: E.idOf(t) }) : null;
    }
    case "retreat":
      return ids.length ? c("retreat", { units: ids }) : null;
    case "stance":
      return ids.length ? c("setStance", { units: ids, stance: it.stance }) : null;
  }
}

// ---------------------------------------------------------------- BACKLOG 4: command UX helpers

/** Own living units of the same type as unit i within r cells of it (double-click select), i included. */
export function sameTypeNear(w: World, tribe: number, i: number, r: number): number[] {
  const E = w.ents;
  const n = w.terrain.size;
  const out: number[] = [];
  if (i < 0 || !E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== tribe) return out;
  for (let k = 0; k < E.hi; k++) {
    if (!E.alive[k] || E.cat[k] !== CAT.unit || E.tribe[k] !== tribe || E.type[k] !== E.type[i]) continue;
    const dx = wrapDelta(E.x[k] - E.x[i], n);
    const dy = wrapDelta(E.y[k] - E.y[i], n);
    if (dx * dx + dy * dy <= r * r) out.push(k);
  }
  return out;
}

/** Wrap-aware center of a set of entities (control group camera jump), or null when none is alive. */
export function groupCenter(w: World, idx: readonly number[]): [number, number] | null {
  const E = w.ents;
  const n = w.terrain.size;
  const live = idx.filter((i) => i >= 0 && E.alive[i]);
  if (!live.length) return null;
  const o = live[0];
  let sx = 0;
  let sy = 0;
  for (const i of live) {
    sx += wrapDelta(E.x[i] - E.x[o], n);
    sy += wrapDelta(E.y[i] - E.y[o], n);
  }
  const wrap = (v: number) => ((v % n) + n) % n;
  return [wrap(E.x[o] + sx / live.length), wrap(E.y[o] + sy / live.length)];
}

/** Units inside a spell's area as the caster's tribe sees it: enemies it can see, and its own. */
export function areaCounts(w: World, tribe: number, x: number, y: number, r: number): { enemies: number; own: number } {
  const E = w.ents;
  const n = w.terrain.size;
  let enemies = 0;
  let own = 0;
  for (let k = 0; k < E.hi; k++) {
    if (!E.alive[k] || E.cat[k] !== CAT.unit) continue;
    const dx = wrapDelta(E.x[k] - x, n);
    const dy = wrapDelta(E.y[k] - y, n);
    if (dx * dx + dy * dy > r * r) continue;
    if (E.tribe[k] === tribe) own++;
    else if (E.tribe[k] >= 0 && w.vision.seesEntity(tribe, k)) enemies++;
  }
  return { enemies, own };
}

/** Seconds left to undo the tribe's cast in progress (Backspace), or -1 when there is nothing to undo. */
export function undoLeft(w: World, tribe: number): number {
  const t = w.tribes[tribe];
  if (!t?.casting) return -1;
  const left = w.cfg.pack.spells.chargeRules.undoSeconds - (w.tick - t.casting.startedAt) / w.cfg.tickHz;
  return left > 0 ? left : -1;
}

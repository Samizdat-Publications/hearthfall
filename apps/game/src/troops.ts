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

/** Nearest own finished Watchtower with a free slot for the selection's first unit, else -1. */
export function towerFor(w: World, sel: readonly number[]): number {
  const i = sel.find((k) => w.ents.alive[k] && w.ents.cat[k] === CAT.unit && !w.cfg.pack.units.units[w.ents.type[k]].isCaster);
  return i === undefined ? -1 : w.combat.nearestTower(i, w.combat.queued());
}

export function troopView(w: World, tribe: number, sel: readonly number[], b: number): TroopView {
  const E = w.ents;
  const none: TroopView = { kind: "none", label: "", stance: null, canGarrison: false, count: 0, max: 0, rally: false, building: false };
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
  return { ...none, kind: "units", label: `${units.length} selected`, stance: same ? STANCE_NAMES[s0] : null, canGarrison: towerFor(w, units) >= 0 };
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

// Scenario definitions (JSON in scenarios/) and deterministic setup. Shared by the headless runner,
// golden replays and the game's loadScenario debug hook.
import type { PackFiles, SiteSpec } from "@hearthfall/data";
import type { Command } from "./commands.ts";
import { STANCE } from "./combat.ts";
import { cos, sin } from "./dmath.ts";
import type { MapSpec } from "./generator.ts";
import { wrap } from "./terrain.ts";
import { World } from "./world.ts";

export interface SetupEntry {
  /** unit id (settler, shaper, wild...), building id (hearth, dwelling...), "tree" or "rock" (BACKLOG 0c) */
  spawn: string;
  tribe?: number;
  at?: [number, number];
  /** place `count` entities around this point on a golden-angle spiral */
  near?: [number, number];
  count?: number;
  spacing?: number;
  /** worship kinds (shrine, reliquary, totem): the site's tag, worshippers, uses and rewards */
  site?: SiteSpec;
  /** stretch 3: units start in this stance; "defensive" units are posted guards the opponent AI never sends away */
  stance?: "aggressive" | "defensive" | "passive";
}

export interface ScenarioDef {
  id: string;
  description?: string;
  tags?: string[];
  seed: number;
  map: MapSpec;
  /** spawn generated hearths, trees and wild people (default false for scenarios) */
  populate?: boolean;
  setup?: SetupEntry[];
  commands?: Command[];
  runTicks: number;
  assert?: { at: number; expr: string }[];
  /** M9: play a campaign level (data/levels/<id>.json) instead of seed/map; setup and bots are added on top */
  level?: string;
  carry?: { spells?: string[]; buildings?: string[] };
  /** BACKLOG 13: victory variant from balance.victory (skirmish rules in the sim) */
  rules?: string;
  /** BACKLOG 11: start with a Forge phase (balance.forge) */
  forge?: boolean;
  /** BACKLOG 14b: match weather */
  weather?: "clear" | "rain";
  /** controllers to attach, built by the caller's factory (packages/ai makeBot) */
  bots?: { type: string; tribe: number; [k: string]: unknown }[];
}

export type BotFactory = (spec: { type: string; tribe: number; [k: string]: unknown }) => import("./world.ts").Controller;

const GOLDEN_ANGLE = 2.399963229728653;

export function applySetup(w: World, setup: readonly SetupEntry[]): void {
  const n = w.terrain.size;
  for (const s of setup) {
    const tribe = s.tribe ?? -1;
    const count = s.count ?? 1;
    const base = s.near ?? s.at;
    if (!base) throw new Error(`setup entry for ${s.spawn} needs at or near`);
    const spacing = s.spacing ?? 0.7;
    // stretch 3: a wild beast spawns as a den of `count` (it regrows lost members)
    const ut = w.cfg.unitIndex.get(s.spawn);
    if (ut !== undefined && tribe < 0 && w.cfg.pack.units.units[ut].beast) {
      w.beasts.addDen(s.spawn, base[0], base[1], count);
      continue;
    }
    for (let k = 0; k < count; k++) {
      let x = base[0];
      let y = base[1];
      if (s.near && (count > 1 || k > 0)) {
        const r = spacing * Math.sqrt(k + 0.5);
        x += cos(k * GOLDEN_ANGLE) * r;
        y += sin(k * GOLDEN_ANGLE) * r;
      }
      x = wrap(x, n);
      y = wrap(y, n);
      if (s.spawn === "tree") w.spawnTree(x, y);
      else if (s.spawn === "rock") w.spawnRock(x, y);
      else if (w.cfg.unitIndex.has(s.spawn)) {
        const id = w.spawnUnit(s.spawn, tribe, x, y);
        if (s.stance) w.ents.stance[w.ents.index(id)] = STANCE[s.stance];
      }
      else if (w.cfg.buildingIndex.has(s.spawn)) w.spawnBuilding(s.spawn, tribe, x, y);
      else if (w.worship.kindIndex(s.spawn) >= 0) {
        const id = w.worship.addSite(s.spawn, x, y, s.site ?? { rewards: [] });
        // stretch 3: a capturable stone with a tribe starts held by it
        const site = w.worship.sites[w.worship.sites.length - 1];
        if (tribe >= 0 && site.ent === id && w.worship.capturable(site.kind)) site.lastBy = tribe;
      }
      else throw new Error(`unknown spawn kind ${s.spawn}`);
    }
  }
}

export function createScenarioWorld(def: ScenarioDef, pack: PackFiles, packHash: string, makeBot?: BotFactory): World {
  const w = new World({ pack, packHash, seed: def.seed, map: def.map, populate: def.populate ?? false, ...(def.rules ? { rules: def.rules } : {}), ...(def.forge ? { forge: true } : {}), ...(def.weather === "rain" ? { weather: "rain" as const } : {}) });
  applySetup(w, def.setup ?? []);
  if (def.bots?.length) {
    if (!makeBot) throw new Error("scenario has bots but no bot factory was given");
    for (const b of def.bots) w.controllers.push(makeBot(b));
  }
  return w;
}

/** Index commands by tick for fast lookup during a run. */
export function commandsByTick(cmds: readonly Command[] = []): (tick: number) => Command[] {
  const m = new Map<number, Command[]>();
  for (const c of cmds) {
    const l = m.get(c.tick);
    if (l) l.push(c);
    else m.set(c.tick, [c]);
  }
  return (t) => m.get(t) ?? [];
}

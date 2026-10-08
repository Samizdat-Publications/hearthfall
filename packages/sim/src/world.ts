// The simulation world and its fixed-order step (docs/ARCHITECTURE.md section 3). Inputs are only
// the previous state, this tick's external commands and the seed.
import type { PackFiles } from "@hearthfall/data";
import { COMMANDS, type Command } from "./commands.ts";
import { makeConfig, type SimConfig } from "./config.ts";
import { CAT, Entities, type EntityId, NO_ENTITY } from "./entities.ts";
import { generateMap, type MapSpec } from "./generator.ts";
import { Fnv } from "./hash.ts";
import { Rng } from "./rng.ts";
import type { Terrain, TerrainOpSpec } from "./terrain.ts";

export interface SimEvent {
  tick: number;
  type: string;
  [k: string]: number | string;
}

export const TRIBE_COLORS = ["azure", "crimson", "amber", "jade"] as const;

export interface Tribe {
  index: number;
  color: string;
  hearth: EntityId;
  alive: boolean;
}

export interface WorldInit {
  pack: PackFiles;
  packHash: string;
  seed: number;
  map: MapSpec;
  /** spawn generated hearths, trees and wild people (default true) */
  populate?: boolean;
}

export interface HashParts {
  all: string;
  terrain: string;
  entities: string;
  rng: string;
  meta: string;
}

const RECENT_EVENTS = 50;

export class World {
  readonly cfg: SimConfig;
  readonly seed: number;
  tick = 0;
  rng: Rng;
  terrain: Terrain;
  ents = new Entities();
  tribes: Tribe[] = [];
  /** events emitted during the current or last completed tick */
  events: SimEvent[] = [];
  eventCounts = new Map<string, number>();
  recent: SimEvent[] = [];
  terrainQueue: TerrainOpSpec[] = [];
  readonly mapInfo: { generator: string; seedUsed: number; rerolls: number; landFraction: number };

  constructor(init: WorldInit) {
    this.cfg = makeConfig(init.pack, init.packHash);
    this.seed = init.seed | 0;
    const gen = generateMap(this.cfg, init.map, this.seed);
    this.terrain = gen.terrain;
    this.rng = new Rng(gen.seedUsed || this.seed);
    this.mapInfo = { generator: init.map.generator, seedUsed: gen.seedUsed, rerolls: gen.rerolls, landFraction: gen.landFraction };
    const tribeCount = init.map.tribes ?? gen.hearths.length;
    for (let t = 0; t < tribeCount; t++) this.tribes.push({ index: t, color: TRIBE_COLORS[t % 4], hearth: NO_ENTITY, alive: true });
    if (init.populate !== false) {
      gen.hearths.forEach((h, t) => this.spawnBuilding("hearth", t, h.x, h.y));
      for (const tr of gen.trees) this.spawnTree(tr.x, tr.y);
      for (const w of gen.wild) this.spawnUnit("wild", -1, w.x, w.y);
    }
  }

  // ---------------------------------------------------------------- spawning (setup and effects)
  spawnTree(x: number, y: number): EntityId {
    const id = this.ents.alloc(CAT.tree, 0, -1, x, y, 1);
    this.ents.wood[this.ents.index(id)] = this.cfg.pack.buildings.trees.maxWood;
    return id;
  }

  spawnUnit(kind: string, tribe: number, x: number, y: number): EntityId {
    const type = this.cfg.unitIndex.get(kind);
    if (type === undefined) throw new Error(`unknown unit kind ${kind}`);
    return this.ents.alloc(CAT.unit, type, tribe, x, y, this.cfg.pack.units.units[type].hp);
  }

  spawnBuilding(kind: string, tribe: number, x: number, y: number): EntityId {
    const type = this.cfg.buildingIndex.get(kind);
    if (type === undefined) throw new Error(`unknown building kind ${kind}`);
    const def = this.cfg.pack.buildings.buildings[type];
    const id = this.ents.alloc(CAT.building, type, tribe, x, y, def.hp ?? 1000);
    if (kind === "hearth" && tribe >= 0 && tribe < this.tribes.length) this.tribes[tribe].hearth = id;
    return id;
  }

  kill(i: number, cause: string): void {
    const e = this.ents;
    this.emit(cause === "drowned" ? "drowned" : "died", { id: e.idOf(i), cat: e.cat[i], kind: e.type[i], tribe: e.tribe[i], x: e.x[i], y: e.y[i] });
    e.free(e.idOf(i));
  }

  emit(type: string, data: Record<string, number | string> = {}): void {
    const ev: SimEvent = { tick: this.tick, type, ...data };
    this.events.push(ev);
    this.eventCounts.set(type, (this.eventCounts.get(type) ?? 0) + 1);
    this.recent.push(ev);
    if (this.recent.length > RECENT_EVENTS) this.recent.shift();
  }

  // ---------------------------------------------------------------- the step
  /** Advance one tick. `commands` are the external commands for this tick, in submission order. */
  step(commands: readonly Command[] = []): void {
    this.events = [];
    // 1. external commands (stable order: by tribe, then submission order)
    const ordered = commands.map((c, i) => ({ c, i })).sort((a, b) => a.c.tribe - b.c.tribe || a.i - b.i);
    for (const { c } of ordered) {
      const h = COMMANDS.get(c.type);
      const err = !h ? `unknown command ${c.type}` : c.tribe < -1 || c.tribe >= this.tribes.length ? "bad tribe" : h.validate(this, c);
      if (err) this.emit("commandRejected", { cmd: c.type, tribe: c.tribe, reason: err });
      else h!.apply(this, c);
    }
    // 2-6. AI, tasks, pathing, movement, combat: land in M3 to M7
    // 7. terrain ops, then drowning
    if (this.terrainQueue.length) {
      for (const op of this.terrainQueue) this.terrain.apply(op);
      this.terrainQueue = [];
      this.drownCheck();
    }
    // 8-9. economy, worship, triggers: land in M4 to M9
    // 10. periodic upkeep
    if (this.tick % this.cfg.tickHz === this.cfg.tickHz - 1) this.terrain.healScars();
    this.tick++;
  }

  /** Units standing in water deeper than drownDepth drown; trees under water are lost. */
  drownCheck(): void {
    const e = this.ents;
    for (let i = 0; i < e.hi; i++) {
      if (!e.alive[i]) continue;
      const c = e.cat[i];
      if ((c === CAT.unit || c === CAT.tree) && this.terrain.drowns(e.x[i], e.y[i])) this.kill(i, c === CAT.unit ? "drowned" : "flooded");
    }
  }

  run(ticks: number, commandsAt: (tick: number) => readonly Command[] = () => []): void {
    for (let k = 0; k < ticks; k++) this.step(commandsAt(this.tick));
  }

  // ---------------------------------------------------------------- hashing and snapshots
  hash(): HashParts {
    const terrain = new Fnv().bytes(this.terrain.heights).bytes(this.terrain.scar).hex();
    const ef = new Fnv().u32(this.ents.hi).u32(this.ents.count);
    const cols = this.ents.columns();
    for (const name of Object.keys(cols)) ef.bytes(cols[name]);
    for (const f of this.ents.freeList) ef.u32(f);
    const entities = ef.hex();
    const rng = new Fnv().bytes(this.rng.state).hex();
    const mf = new Fnv().u32(this.tick);
    for (const t of this.tribes) mf.u32(t.hearth).u32(t.alive ? 1 : 0);
    const meta = mf.hex();
    const all = new Fnv().u32(parseInt(terrain, 16)).u32(parseInt(entities, 16)).u32(parseInt(rng, 16)).u32(parseInt(meta, 16)).hex();
    return { all, terrain, entities, rng, meta };
  }

  /** Counts per category and tribe, for summaries and scenario assertions. */
  count(pred: (i: number) => boolean): number {
    let n = 0;
    for (let i = 0; i < this.ents.hi; i++) if (this.ents.alive[i] && pred(i)) n++;
    return n;
  }
}

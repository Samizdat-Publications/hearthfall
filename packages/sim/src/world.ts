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
import { ORDER, UnitSystem } from "./units.ts";

/** Deterministic in-sim decision maker (AI opponent or test bot); emits Commands at its cadence. */
export interface Controller {
  readonly tribe: number;
  /** run when tick % every === offset */
  readonly every: number;
  readonly offset: number;
  decide(w: World): Command[];
}

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

export interface WorldSnapshot {
  tick: number;
  heights: Int16Array;
  scar: Uint16Array;
  terrainVersion: number;
  rng: Uint32Array;
  ents: { hi: number; count: number; freeList: number[]; columns: Record<string, ArrayBufferView> };
  tribes: Tribe[];
  eventCounts: [string, number][];
  paths: [number, Int32Array][];
  pathQueue: number[];
}

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
  /** sandbox and debug: any tribe may issue god-mode commands */
  godMode = false;
  units: UnitSystem;
  controllers: Controller[] = [];
  readonly mapInfo: { generator: string; seedUsed: number; rerolls: number; landFraction: number };

  constructor(init: WorldInit) {
    this.cfg = makeConfig(init.pack, init.packHash);
    this.seed = init.seed | 0;
    const gen = generateMap(this.cfg, init.map, this.seed);
    this.terrain = gen.terrain;
    // distinct from the generator's private Rng so in-sim draws never replay generation numbers
    this.rng = new Rng((gen.seedUsed || this.seed) ^ 0x5f3759df);
    this.mapInfo = { generator: init.map.generator, seedUsed: gen.seedUsed, rerolls: gen.rerolls, landFraction: gen.landFraction };
    this.units = new UnitSystem(this);
    const tribeCount = init.map.tribes ?? gen.hearths.length;
    for (let t = 0; t < tribeCount; t++) this.tribes.push({ index: t, color: TRIBE_COLORS[t % 4], hearth: NO_ENTITY, alive: true });
    if (init.populate !== false) {
      gen.hearths.forEach((h, t) => this.spawnBuilding("hearth", t, h.x, h.y));
      for (const tr of gen.trees) this.spawnTree(tr.x, tr.y);
      for (const w of gen.wild) this.spawnUnit("wild", -1, w.x, w.y);
    }
  }

  // ---------------------------------------------------------------- spawning (setup and effects)
  /** bumps whenever a tree appears, vanishes or changes wood (render cache key; not hashed) */
  treeVersion = 0;

  spawnTree(x: number, y: number): EntityId {
    this.treeVersion++;
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
    this.units.paths[i] = null;
    if (e.cat[i] === CAT.tree) this.treeVersion++;
    this.emit(cause, { id: e.idOf(i), cat: e.cat[i], kind: e.type[i], tribe: e.tribe[i], x: e.x[i], y: e.y[i] });
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
    for (const { c } of ordered) this.exec(c);
    // 2. AI controllers at their cadence (deterministic; not recorded in replays)
    for (const ctl of this.controllers) if (this.tick % ctl.every === ctl.offset) for (const c of ctl.decide(this)) this.exec({ ...c, tick: this.tick, tribe: ctl.tribe });
    // 3. tasks and decisions: land in M4 to M6
    // 4-5. pathing requests (budgeted) and movement
    this.units.update();
    // 6. combat, projectiles, spells and effects: land in M5 and M6
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

  private exec(c: Command): void {
    const h = COMMANDS.get(c.type);
    const err = !h ? `unknown command ${c.type}` : c.tribe < -1 || c.tribe >= this.tribes.length ? "bad tribe" : h.validate(this, c);
    if (err) this.emit("commandRejected", { cmd: c.type, tribe: c.tribe, reason: err });
    else h!.apply(this, c);
  }

  /**
   * Resolve a unit selector: an array of entity ids, or "tribeN.units", "tribeN.<unit id>s",
   * "wild". Returns live entity indices in ascending order.
   */
  selectUnits(sel: unknown): number[] {
    const E = this.ents;
    const out: number[] = [];
    if (Array.isArray(sel)) {
      for (const id of sel) {
        const i = typeof id === "number" ? E.index(id) : -1;
        if (i >= 0 && E.cat[i] === CAT.unit) out.push(i);
      }
      return out.sort((a, b) => a - b);
    }
    if (typeof sel !== "string") return out;
    const m = sel.match(/^(?:tribe(\d)\.(units|[a-z_]+s)|(wild))$/);
    if (!m) return out;
    const tribe = m[3] ? -1 : Number(m[1]);
    const kind = m[3] ? "wild" : m[2] === "units" ? null : m[2].slice(0, -1);
    const type = kind === null ? -1 : (this.cfg.unitIndex.get(kind) ?? -2);
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe && (type === -1 || E.type[i] === type)) out.push(i);
    return out;
  }

  /** Invariant violations at the current tick (soak and tests). Empty when healthy. */
  invariants(): string[] {
    const E = this.ents;
    const out: string[] = [];
    let alive = 0;
    const stuckTicks = Math.round(this.cfg.pack.balance.combat.stuckSeconds * this.cfg.tickHz);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      alive++;
      if (!Number.isFinite(E.x[i]) || !Number.isFinite(E.y[i]) || !Number.isFinite(E.hp[i])) out.push(`entity ${i} has a non-finite column`);
      if (E.x[i] < 0 || E.x[i] >= this.terrain.size || E.y[i] < 0 || E.y[i] >= this.terrain.size) out.push(`entity ${i} outside the map`);
      if (E.cat[i] === CAT.unit) {
        if (this.terrain.drowns(E.x[i], E.y[i])) out.push(`unit ${i} stands in deep water`);
        if (E.order[i] !== ORDER.none && E.stuck[i] > stuckTicks) out.push(`unit ${i} stuck ${E.stuck[i]} ticks`);
      }
    }
    if (alive !== E.count) out.push(`alive ${alive} != count ${E.count}`);
    if (E.freeList.length + E.count !== E.hi) out.push("free list inconsistent");
    return out;
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
    const paths = this.units.paths;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (p) ef.u32(i).u32(p.length).bytes(p);
    }
    for (const q of this.units.queue) ef.u32(q);
    const entities = ef.hex();
    const rng = new Fnv().bytes(this.rng.state).hex();
    const mf = new Fnv().u32(this.tick);
    for (const t of this.tribes) mf.u32(t.hearth).u32(t.alive ? 1 : 0);
    const meta = mf.hex();
    const all = new Fnv().u32(parseInt(terrain, 16)).u32(parseInt(entities, 16)).u32(parseInt(rng, 16)).u32(parseInt(meta, 16)).hex();
    return { all, terrain, entities, rng, meta };
  }

  /**
   * Snapshot between ticks: typed arrays are copies (transferable to a Worker). Together with the
   * WorldInit it was created from, restore() rebuilds an identical world (same future hashes).
   */
  snapshot(): WorldSnapshot {
    if (this.terrainQueue.length) throw new Error("snapshot() must be taken between ticks (terrain queue not empty)");
    const cols = this.ents.columns();
    const columns: Record<string, ArrayBufferView> = {};
    for (const name of Object.keys(cols)) columns[name] = cols[name].slice();
    return {
      tick: this.tick,
      heights: this.terrain.heights.slice(),
      scar: this.terrain.scar.slice(),
      terrainVersion: this.terrain.version,
      rng: this.rng.state.slice(),
      ents: { hi: this.ents.hi, count: this.ents.count, freeList: this.ents.freeList.slice(), columns },
      tribes: this.tribes.map((t) => ({ ...t })),
      eventCounts: [...this.eventCounts],
      paths: this.units.paths.map((p, i) => (p ? ([i, p.slice()] as [number, Int32Array]) : null)).filter((x): x is [number, Int32Array] => x !== null),
      pathQueue: this.units.queue.slice(),
    };
  }

  static restore(init: WorldInit, snap: WorldSnapshot): World {
    const w = new World({ ...init, populate: false });
    w.tick = snap.tick;
    w.terrain.heights.set(snap.heights);
    w.terrain.scar.set(snap.scar);
    w.terrain.version = snap.terrainVersion;
    w.terrain.recountScars();
    w.rng.state.set(snap.rng);
    const e = w.ents;
    while (e.cap < snap.ents.hi) e.reserve(snap.ents.hi);
    const self = e as unknown as Record<string, { set(a: ArrayBufferView): void }>;
    for (const name of Object.keys(snap.ents.columns)) self[name].set(snap.ents.columns[name]);
    e.hi = snap.ents.hi;
    e.count = snap.ents.count;
    e.freeList = snap.ents.freeList.slice();
    w.tribes = snap.tribes.map((t) => ({ ...t }));
    w.eventCounts = new Map(snap.eventCounts);
    for (const [i, p] of snap.paths) w.units.paths[i] = p.slice();
    w.units.queue = snap.pathQueue.slice();
    return w;
  }

  /** Counts per category and tribe, for summaries and scenario assertions. */
  count(pred: (i: number) => boolean): number {
    let n = 0;
    for (let i = 0; i < this.ents.hi; i++) if (this.ents.alive[i] && pred(i)) n++;
    return n;
  }
}

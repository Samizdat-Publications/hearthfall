// The simulation world and its fixed-order step (docs/ARCHITECTURE.md section 3). Inputs are only
// the previous state, this tick's external commands and the seed.
import type { PackFiles } from "@hearthfall/data";
import { COMMANDS, type Command } from "./commands.ts";
import { makeConfig, type SimConfig } from "./config.ts";
import { CAT, Entities, type EntityId, NO_ENTITY } from "./entities.ts";
import { generateMap, type MapSpec } from "./generator.ts";
import { Fnv } from "./hash.ts";
import { Rng } from "./rng.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import type { Terrain, TerrainOpSpec } from "./terrain.ts";
import { ORDER, UnitSystem } from "./units.ts";
import { BSTATE, cloneEco, EconomySystem, newTribeEco, type TribeEco } from "./economy.ts";
import { isShaper, onShaperDeath, updateSpells, type CastState, type PendingCast } from "./spells.ts";
import { updateEffects } from "./effects.ts";
import { CombatSystem } from "./combat.ts";

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
  eco: TribeEco;
  /** the tribe's Shaper (NO_ENTITY while dead), respawn tick (-1 none), cast in progress, queued cast */
  shaper: EntityId;
  respawnAt: number;
  casting: CastState | null;
  pending: PendingCast | null;
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
  unitsTerrainVersion: number;
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
  economy: EconomySystem;
  combat: CombatSystem;
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
    this.economy = new EconomySystem(this);
    this.combat = new CombatSystem(this);
    const tribeCount = init.map.tribes ?? gen.hearths.length;
    for (let t = 0; t < tribeCount; t++) this.tribes.push({ index: t, color: TRIBE_COLORS[t % 4], hearth: NO_ENTITY, alive: true, eco: newTribeEco(this), shaper: NO_ENTITY, respawnAt: -1, casting: null, pending: null });
    if (init.populate !== false) {
      gen.hearths.forEach((h, t) => this.spawnBuilding("hearth", t, h.x, h.y));
      gen.hearths.forEach((h, t) => this.spawnStartUnits(t, h.x, h.y));
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

  /** The Shaper and startPopulation settlers on walkable ground in rings around a Hearth. */
  spawnStartUnits(tribe: number, hx: number, hy: number): void {
    const want = ["shaper", ...Array(this.cfg.pack.units.rules.startPopulation).fill("settler")];
    const n = this.terrain.size;
    let k = 0;
    for (let ring = 2; ring < 8 && k < want.length; ring++) {
      for (let a = 0; a < ring * 6 && k < want.length; a++) {
        const ang = (a / (ring * 6)) * TWO_PI;
        const x = (((hx + cos(ang) * ring) % n) + n) % n;
        const y = (((hy + sin(ang) * ring) % n) + n) % n;
        if (!this.terrain.walkable(Math.round(x), Math.round(y)) || this.terrain.drowns(x, y)) continue;
        const id = this.spawnUnit(want[k++], tribe, x, y);
        if (want[k - 1] === "settler") this.ents.carry[this.ents.index(id)] = this.cfg.pack.balance.economy.startWoodPerSettler;
        a += 2;
      }
    }
  }

  spawnUnit(kind: string, tribe: number, x: number, y: number): EntityId {
    const n = this.terrain.size;
    x = ((x % n) + n) % n;
    y = ((y % n) + n) % n;
    const type = this.cfg.unitIndex.get(kind);
    if (type === undefined) throw new Error(`unknown unit kind ${kind}`);
    const id = this.ents.alloc(CAT.unit, type, tribe, x, y, this.cfg.pack.units.units[type].hp);
    this.ents.stance[this.ents.index(id)] = this.combat.defaultStance(type);
    if (this.cfg.pack.units.units[type].isCaster && tribe >= 0 && tribe < this.tribes.length) this.tribes[tribe].shaper = id;
    return id;
  }

  /**
   * Damage a unit or building. Shapers only die to effects allowed to kill them (lethal); other
   * damage leaves them at least shaperMinHpFromNonLethal. Units inside buildings are safe. Any
   * damage but a melee swing breaks a chant (ranged hits and spells interrupt Chanters).
   */
  damage(i: number, amount: number, fromTribe: number, lethal: boolean, melee = false): void {
    const E = this.ents;
    if (!E.alive[i] || amount <= 0) return;
    if (E.cat[i] === CAT.unit && E.inside[i] >= 0) return;
    if (fromTribe >= 0) E.lastHit[i] = fromTribe;
    E.hitTick[i] = this.tick;
    if (!melee && E.chant[i] > 0) this.combat.interruptChant(i, "hit");
    let hp = E.hp[i] - amount;
    if (E.cat[i] === CAT.unit && isShaper(this, i) && !lethal) hp = Math.max(hp, this.cfg.pack.balance.combat.shaperMinHpFromNonLethal);
    E.hp[i] = hp;
    if (hp <= 0) this.kill(i, E.cat[i] === CAT.building ? "destroyed" : "killed");
  }

  spawnBuilding(kind: string, tribe: number, x: number, y: number): EntityId {
    const n = this.terrain.size;
    x = ((x % n) + n) % n;
    y = ((y % n) + n) % n;
    const type = this.cfg.buildingIndex.get(kind);
    if (type === undefined) throw new Error(`unknown building kind ${kind}`);
    const def = this.cfg.pack.buildings.buildings[type];
    const id = this.ents.alloc(CAT.building, type, tribe, x, y, def.hp);
    const bi = this.ents.index(id);
    this.ents.state[bi] = BSTATE.done;
    if (def.levels) this.ents.level[bi] = 1;
    if (kind === "hearth" && tribe >= 0 && tribe < this.tribes.length) this.tribes[tribe].hearth = id;
    return id;
  }

  kill(i: number, cause: string): void {
    const e = this.ents;
    if (e.cat[i] === CAT.unit && isShaper(this, i) && e.tribe[i] >= 0) onShaperDeath(this, e.tribe[i], cause === "drowned", e.lastHit[i]);
    this.units.paths[i] = null;
    if (e.cat[i] === CAT.tree) this.treeVersion++;
    if (e.cat[i] === CAT.unit && e.inside[i] >= 0) {
      const h = e.inside[i];
      if (e.occupants[h] > 0) e.occupants[h]--;
      e.inside[i] = -1;
    }
    if (e.cat[i] === CAT.building) {
      if (e.state[i] !== BSTATE.done) this.economy.releasePlanTrees(i);
      // occupants walk out of a destroyed building
      for (let k = 0; k < e.hi; k++) {
        if (e.alive[k] && e.inside[k] === i) {
          e.inside[k] = -1;
          e.task[k] = 0;
        }
      }
    }
    this.emit(cause, { id: e.idOf(i), cat: e.cat[i], kind: e.type[i], tribe: e.tribe[i], x: e.x[i], y: e.y[i], by: e.lastHit[i] });
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
    // 3. tasks and decisions (settler autonomy)
    this.economy.updateTasks();
    // 4-5. pathing requests (budgeted) and movement
    this.units.update();
    // 6. spells (queued and resolving casts, respawns, elimination) and persistent effects
    updateSpells(this);
    updateEffects(this);
    // 6b. combat: targeting, swings and shots, chants, training queues, garrisons, Shaper regen
    this.combat.update();
    // 7. terrain ops (breaking nearby chants), then drowning
    if (this.terrainQueue.length) {
      this.combat.onTerrainOps(this.terrainQueue);
      for (const op of this.terrainQueue) this.terrain.apply(op);
      this.terrainQueue = [];
      this.drownCheck();
    }
    // 8. economy: construction, dwellings, breeding, trees, mana
    this.economy.update();
    // 9. worship, triggers, objectives: land in M9
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

  /**
   * Entity argument of a command: an entity id, or a selector "tribeN.<unit or building id>s" naming
   * the lowest-index living match (scenarios cannot know ids). Returns the index or -1.
   */
  resolveEntity(arg: unknown): number {
    const E = this.ents;
    if (typeof arg === "number") return E.index(arg);
    if (typeof arg !== "string") return -1;
    const m = arg.match(/^tribe(\d)\.([a-z_]+)s$/);
    if (!m) return -1;
    const tribe = Number(m[1]);
    const u = this.cfg.unitIndex.get(m[2]);
    const b = this.cfg.buildingIndex.get(m[2]);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.tribe[i] !== tribe) continue;
      if ((u !== undefined && E.cat[i] === CAT.unit && E.type[i] === u) || (b !== undefined && E.cat[i] === CAT.building && E.type[i] === b)) return i;
    }
    return -1;
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
        if (E.inside[i] < 0 && this.terrain.drowns(E.x[i], E.y[i])) out.push(`unit ${i} stands in deep water`);
        if (E.order[i] !== ORDER.none && E.stuck[i] > stuckTicks) out.push(`unit ${i} stuck ${E.stuck[i]} ticks`);
        if (!(E.hp[i] > 0) || E.hp[i] > this.cfg.pack.units.units[E.type[i]].hp + 1e-6) out.push(`unit ${i} hp ${E.hp[i]} out of range`);
        if (E.tribe[i] < 0 && (E.mode[i] !== 0 || E.chant[i] > 0)) out.push(`wild unit ${i} still fighting`);
      }
    }
    if (alive !== E.count) out.push(`alive ${alive} != count ${E.count}`);
    const spells = this.cfg.pack.spells.spells;
    for (const t of this.tribes) {
      const e = t.eco;
      for (let s = 0; s < spells.length; s++) {
        if (e.charges[s] < 0 || e.charges[s] > spells[s].maxCharges) out.push(`tribe ${t.index} spell ${s} charges ${e.charges[s]} out of range`);
        if (!(e.progress[s] >= 0) || e.progress[s] >= spells[s].cost) out.push(`tribe ${t.index} spell ${s} progress ${e.progress[s]} out of range`);
      }
      if (!(e.wasted >= 0) || !(e.trainMana >= 0)) out.push(`tribe ${t.index} mana negative`);
    }
    // occupancy: every dwelling's occupant count matches the units inside and fits its capacity
    const inside = new Map<number, number>();
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.inside[i] >= 0) inside.set(E.inside[i], (inside.get(E.inside[i]) ?? 0) + 1);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building) continue;
      const occ = inside.get(i) ?? 0;
      if (E.occupants[i] !== occ) out.push(`building ${i} occupants ${E.occupants[i]} != units inside ${occ}`);
      if (E.type[i] === this.economy.typeDwelling && E.state[i] === BSTATE.done && occ > this.economy.dwellingLevel(i).capacity) out.push(`dwelling ${i} over capacity`);
      const slots = this.combat.garrisonOf(E.type[i]);
      if (slots > 0 && occ > slots) out.push(`tower ${i} holds ${occ} > ${slots}`);
      const qmax = this.cfg.pack.buildings.buildings[E.type[i]].queueMax;
      if (qmax !== undefined && occ > qmax) out.push(`lodge ${i} holds ${occ} > queue ${qmax}`);
    }
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] < 0) continue;
      const h = E.inside[i];
      if (!E.alive[h] || E.cat[h] !== CAT.building) out.push(`unit ${i} inside a missing building`);
      else if (E.tribe[h] !== E.tribe[i]) out.push(`unit ${i} of tribe ${E.tribe[i]} inside building ${h} of tribe ${E.tribe[h]}`);
    }
    if (E.freeList.length + E.count !== E.hi) out.push("free list inconsistent");
    return out;
  }

  /** Units standing in water deeper than drownDepth drown; trees under water are lost. */
  drownCheck(): void {
    const e = this.ents;
    for (let i = 0; i < e.hi; i++) {
      if (!e.alive[i]) continue;
      const c = e.cat[i];
      if ((c === CAT.unit || c === CAT.tree) && (c !== CAT.unit || e.inside[i] < 0) && this.terrain.drowns(e.x[i], e.y[i])) this.kill(i, c === CAT.unit ? "drowned" : "flooded");
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
    for (const t of this.tribes) {
      mf.u32(t.hearth).u32(t.alive ? 1 : 0).f64(t.eco.wasted).f64(t.eco.spellsPct).u32(t.eco.cursor).f64(t.eco.trainMana);
      mf.u32(t.shaper).f64(t.respawnAt).f64(t.eco.priorities.build).f64(t.eco.priorities.upgrade).f64(t.eco.priorities.breed);
      if (t.casting) mf.u32(t.casting.spell).f64(t.casting.x).f64(t.casting.y).u32(t.casting.startedAt).u32(t.casting.resolveAt);
      if (t.pending) mf.u32(t.pending.spell + 1000).f64(t.pending.x).f64(t.pending.y).f64(t.pending.best);
      mf.bytes(t.eco.charges).bytes(t.eco.progress).bytes(t.eco.auto).bytes(t.eco.unlocked);
    }
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
      tribes: this.tribes.map((t) => ({ ...t, eco: cloneEco(t.eco), casting: t.casting ? { ...t.casting } : null, pending: t.pending ? { ...t.pending } : null })),
      eventCounts: [...this.eventCounts],
      paths: this.units.paths.map((p, i) => (p ? ([i, p.slice()] as [number, Int32Array]) : null)).filter((x): x is [number, Int32Array] => x !== null),
      pathQueue: this.units.queue.slice(),
      unitsTerrainVersion: this.units.lastVersion,
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
    w.tribes = snap.tribes.map((t) => ({ ...t, eco: cloneEco(t.eco), casting: t.casting ? { ...t.casting } : null, pending: t.pending ? { ...t.pending } : null }));
    w.eventCounts = new Map(snap.eventCounts);
    for (const [i, p] of snap.paths) w.units.paths[i] = p.slice();
    w.units.queue = snap.pathQueue.slice();
    w.units.lastVersion = snap.unitsTerrainVersion;
    return w;
  }

  /** Counts per category and tribe, for summaries and scenario assertions. */
  count(pred: (i: number) => boolean): number {
    let n = 0;
    for (let i = 0; i < this.ents.hi; i++) if (this.ents.alive[i] && pred(i)) n++;
    return n;
  }
}

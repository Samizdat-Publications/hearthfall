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
import type { DirtyRect, Terrain, TerrainOpSpec } from "./terrain.ts";
import { ORDER, UnitSystem } from "./units.ts";
import { BSTATE, cloneEco, EconomySystem, newTribeEco, TASK, type TribeEco } from "./economy.ts";
import { isShaper, onShaperDeath, updateSpells, type CastState, type PendingCast } from "./spells.ts";
import { updateEffects } from "./effects.ts";
import { CombatSystem } from "./combat.ts";
import { WorshipSystem, type WorshipState } from "./worship.ts";
import { LevelRuntime, type LevelInit, type LevelSaved } from "./level.ts";
import { RulesRuntime, type RulesSaved } from "./rules.ts";
import { FORGE_COMMANDS, ForgeRuntime, type ForgeSaved } from "./forge.ts";
import { VisionSystem, type VisionState } from "./vision.ts";
import { VehicleSystem } from "./vehicles.ts";

/** Deterministic in-sim decision maker (AI opponent or test bot); emits Commands at its cadence. */
export interface Controller {
  readonly tribe: number;
  /** run when tick % every === offset */
  readonly every: number;
  readonly offset: number;
  decide(w: World): Command[];
  /** M8 save games: controller memory that is not in the world (JSON-safe), and its restore after World.restore */
  saveState?(): unknown;
  loadState?(state: unknown): void;
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
  /** M9 campaign level (createLevelWorld): objectives, lose conditions and triggers run in step 9 */
  level?: LevelInit;
  /** BACKLOG 13 (ADR-014): skirmish victory variant id from balance.victory (absent: no sim rules, older replays) */
  rules?: string;
  /** BACKLOG 11 (ADR-017): start with a Forge phase (balance.forge; absent: none, older replays) */
  forge?: boolean;
  /** BACKLOG 14b: "rain" slows every unit (balance.weather.rain); absent or "clear": no effect, older replays */
  weather?: "clear" | "rain";
}

/** BACKLOG 35: the WorldInit a snapshot came from, without the pack files (plain JSON) */
export type WorldOrigin = Omit<WorldInit, "pack" | "populate">;

/** JSON with sorted object keys, so two equal specs built in different key orders compare equal */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** BACKLOG 35: why a snapshot's origin does not fit this init (null when it fits) */
export function originMismatch(origin: WorldOrigin, init: WorldInit): string | null {
  if (origin.packHash !== init.packHash) return "different game data";
  if ((origin.seed | 0) !== (init.seed | 0)) return `seed ${origin.seed} vs ${init.seed}`;
  if (canon(origin.map) !== canon(init.map)) return "different map";
  if ((origin.rules ?? null) !== (init.rules ?? null)) return `rules ${origin.rules ?? "none"} vs ${init.rules ?? "none"}`;
  if (!!origin.forge !== !!init.forge) return "forge phase differs";
  if ((origin.weather ?? "clear") !== (init.weather ?? "clear")) return "weather differs";
  if ((origin.level?.def.id ?? null) !== (init.level?.def.id ?? null)) return `level ${origin.level?.def.id ?? "none"} vs ${init.level?.def.id ?? "none"}`;
  return null;
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
  /**
   * Terrain edits the unit step has not seen yet (seq after unitsTerrainVersion). Without them a world
   * saved between an edit and the next unit step re-planned every unit instead of those near the edit,
   * and left the live game (e2e BACKLOG 76 check, save at tick 221). Absent in older saves: none.
   */
  terrainDirty?: DirtyRect[];
  /** flow field cache goals (in cache order) valid at the save, rebuilt on restore so the per-tick build budget sees the same cache hits */
  flowKeys?: number[];
  /** M9: present only when the world has worship sites or granted buildings */
  worship?: WorshipState;
  /** BACKLOG 3: present only with fog of war on */
  vision?: VisionState;
  level?: LevelSaved;
  rules?: RulesSaved;
  forge?: ForgeSaved;
  /** BACKLOG 35: the init this world was built from (no pack files); absent in older saves */
  origin?: WorldOrigin;
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
  /** BACKLOG 10: boats and balloons (ADR-016) */
  vehicles: VehicleSystem;
  worship: WorshipSystem;
  /** BACKLOG 3: fog of war (per tribe explored and visible grids) */
  vision: VisionSystem;
  /** null outside campaign levels */
  level: LevelRuntime | null;
  /** BACKLOG 13: skirmish victory rules (null without WorldInit.rules) */
  rules: RulesRuntime | null;
  /** BACKLOG 11: the pre-match Forge phase (null without WorldInit.forge) */
  forge: ForgeRuntime | null;
  /** BACKLOG 14b: match weather, fixed for the match */
  readonly weather: "clear" | "rain";
  /** BACKLOG 35: the init without pack files, carried in every snapshot */
  readonly origin: WorldOrigin;
  /** BACKLOG 14b: unit speed factor from the weather (1 when clear) */
  readonly speedMult: number;
  controllers: Controller[] = [];
  readonly mapInfo: { generator: string; seedUsed: number; rerolls: number; landFraction: number };

  constructor(init: WorldInit) {
    const { pack: _pack, populate: _populate, ...origin } = init;
    this.origin = JSON.parse(JSON.stringify(origin)) as WorldOrigin;
    this.cfg = makeConfig(init.pack, init.packHash);
    this.seed = init.seed | 0;
    this.weather = init.weather === "rain" ? "rain" : "clear";
    this.speedMult = this.weather === "rain" ? (this.cfg.pack.balance.weather?.rain.speedMult ?? 1) : 1;
    const gen = generateMap(this.cfg, init.map, this.seed);
    this.terrain = gen.terrain;
    // distinct from the generator's private Rng so in-sim draws never replay generation numbers
    this.rng = new Rng((gen.seedUsed || this.seed) ^ 0x5f3759df);
    this.mapInfo = { generator: init.map.generator, seedUsed: gen.seedUsed, rerolls: gen.rerolls, landFraction: gen.landFraction };
    this.units = new UnitSystem(this);
    this.vehicles = new VehicleSystem(this);
    this.economy = new EconomySystem(this);
    this.combat = new CombatSystem(this);
    this.worship = new WorshipSystem(this);
    this.level = init.level ? new LevelRuntime(this, init.level.def) : null;
    this.vision = new VisionSystem(this, init.map.fog);
    const tribeCount = init.map.tribes ?? gen.hearths.length;
    this.vision.init(tribeCount);
    for (let t = 0; t < tribeCount; t++) this.tribes.push({ index: t, color: TRIBE_COLORS[t % 4], hearth: NO_ENTITY, alive: true, eco: newTribeEco(this), shaper: NO_ENTITY, respawnAt: -1, casting: null, pending: null });
    this.rules = init.rules ? new RulesRuntime(this, init.rules) : null;
    this.forge = init.forge ? new ForgeRuntime(this) : null;
    if (init.populate !== false) {
      gen.hearths.forEach((h, t) => this.spawnBuilding("hearth", t, h.x, h.y));
      gen.hearths.forEach((h, t) => this.spawnStartUnits(t, h.x, h.y));
      for (const tr of gen.trees) this.spawnTree(tr.x, tr.y);
      for (const w of gen.wild) this.spawnUnit("wild", -1, w.x, w.y);
      for (const r of gen.rocks) this.spawnRock(r.x, r.y);
      // skirmish only: a level places its own sites
      if (!init.level) this.worship.placeSkirmishSites(gen.hearths);
    }
    this.vision.update(true);
  }

  // ---------------------------------------------------------------- spawning (setup and effects)
  /** bumps whenever a tree or rock appears, vanishes or changes wood or stone (render cache key; not hashed) */
  treeVersion = 0;

  spawnTree(x: number, y: number): EntityId {
    this.treeVersion++;
    const id = this.ents.alloc(CAT.tree, 0, -1, x, y, 1);
    this.ents.wood[this.ents.index(id)] = this.cfg.pack.buildings.trees.maxWood;
    return id;
  }

  /** A stone outcrop (BACKLOG 0c) holding `stone` (default buildings.rocks.maxStone); quarried away when empty. */
  spawnRock(x: number, y: number, stone?: number): EntityId {
    this.treeVersion++;
    const id = this.ents.alloc(CAT.rock, 0, -1, x, y, 1);
    this.ents.stone[this.ents.index(id)] = Math.min(255, stone ?? this.cfg.pack.buildings.rocks?.maxStone ?? 16);
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
   * damage but a melee swing breaks a chant (ranged hits and spells interrupt Chanters); a melee swing
   * does too when the Chanter's convert.interruptedBy lists meleeDamage (BACKLOG 7). Any damage breaks
   * a Shade's sabotage channel (BACKLOG 2).
   */
  damage(i: number, amount: number, fromTribe: number, lethal: boolean, melee = false): void {
    const E = this.ents;
    if (!E.alive[i] || amount <= 0) return;
    if (E.cat[i] === CAT.unit && E.inside[i] >= 0) return;
    // Ward (BACKLOG 1): a shielded unit takes no damage until the shield ends or is popped
    if (E.cat[i] === CAT.unit && E.ward[i] > 0) return;
    if (fromTribe >= 0) E.lastHit[i] = fromTribe;
    E.hitTick[i] = this.tick;
    if (E.chant[i] > 0) {
      const cv = this.cfg.pack.units.units[E.type[i]].convert;
      // BACKLOG 65: a Chanter with breakDamage shrugs off ranged and spell hits until the channel's damage adds up
      // (progress2 is free on units and holds the running total)
      if (!melee && cv?.breakDamage && (E.progress2[i] += amount) < cv.breakDamage) {
        // the channel holds
      } else if (!melee) this.combat.interruptChant(i, "hit");
      else if (!cv || cv.interruptedBy.includes("meleeDamage")) this.combat.interruptChant(i, "melee");
    }
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
    if (e.cat[i] === CAT.tree || e.cat[i] === CAT.rock) this.treeVersion++;
    if (e.cat[i] === CAT.unit && e.inside[i] >= 0) {
      const h = e.inside[i];
      if (e.occupants[h] > 0) e.occupants[h]--;
      e.inside[i] = -1;
    }
    const out: number[] = [];
    // a lost vehicle drops its riders where it was (BACKLOG 10): in deep water they drown below
    if (e.cat[i] === CAT.unit && e.occupants[i] > 0) out.push(...this.vehicles.spill(i));
    if (e.cat[i] === CAT.building) {
      if (e.state[i] !== BSTATE.done) this.economy.releasePlanTrees(i);
      // occupants walk out of a destroyed building
      for (let k = 0; k < e.hi; k++) {
        if (e.alive[k] && e.inside[k] === i) {
          e.inside[k] = -1;
          e.task[k] = 0;
          out.push(k);
        }
      }
    }
    this.emit(cause, { id: e.idOf(i), cat: e.cat[i], kind: e.type[i], tribe: e.tribe[i], x: e.x[i], y: e.y[i], by: e.lastHit[i] });
    e.free(e.idOf(i));
    // a building can stand on sunken land; its people step out into deep water and drown at once
    // (BACKLOG 7, ai soak seed 1002: a combat kill came after the tick's drowning pass)
    for (const k of out) if (e.alive[k] && this.terrain.drowns(e.x[k], e.y[k])) this.kill(k, "drowned");
  }

  emit(type: string, data: Record<string, number | string> = {}): void {
    const ev: SimEvent = { tick: this.tick, type, ...data };
    this.events.push(ev);
    this.eventCounts.set(type, (this.eventCounts.get(type) ?? 0) + 1);
    this.recent.push(ev);
    if (this.recent.length > RECENT_EVENTS) this.recent.shift();
  }

  /** BACKLOG 11: ticks since the match proper began (the Forge phase does not count; equals tick without one) */
  get playTick(): number {
    const f = this.forge;
    return !f ? this.tick : f.endedAt < 0 ? 0 : this.tick - f.endedAt;
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
    // BACKLOG 11: during the Forge only the land changes (units, economy, spells and combat are frozen)
    if (this.forge?.running()) {
      this.flushTerrain();
      this.forge.update();
      this.vision.update();
      this.tick++;
      return;
    }
    // 3. tasks and decisions (settler autonomy)
    this.economy.updateTasks();
    // 4-5. pathing requests (budgeted) and movement
    this.units.update();
    // 5b. vehicles: boarding, riders follow, unloading, vehicle production (BACKLOG 10)
    this.vehicles.update();
    // 6. spells (queued and resolving casts, respawns, elimination) and persistent effects
    updateSpells(this);
    updateEffects(this);
    // 6b. combat: targeting, swings and shots, chants, training queues, garrisons, Shaper regen
    this.combat.update();
    // 7. terrain ops (breaking nearby chants), then drowning
    this.flushTerrain();
    // 8. economy: construction, dwellings, breeding, trees, mana
    this.economy.update();
    // 9. worship, victory rules, then level triggers, objectives and outcome (a level with rules reads this tick's winner; rewards may queue terrain ops: applied in the same tick so snapshots stay legal)
    this.worship.update();
    this.rules?.update();
    this.level?.update();
    this.flushTerrain();
    // 10. periodic upkeep
    if (this.tick % this.cfg.tickHz === this.cfg.tickHz - 1) this.terrain.healScars();
    this.vision.update();
    this.tick++;
  }

  private exec(c: Command): void {
    const h = COMMANDS.get(c.type);
    const err = !h
      ? `unknown command ${c.type}`
      : c.tribe < -1 || c.tribe >= this.tribes.length
        ? "bad tribe"
        : this.forge?.running() && !FORGE_COMMANDS.has(c.type)
          ? "the land is still being forged"
          : h.validate(this, c);
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
        if (i >= 0 && E.cat[i] === CAT.unit && E.task[i] !== TASK.ride) out.push(i);
      }
      return out.sort((a, b) => a - b);
    }
    if (typeof sel !== "string") return out;
    const m = sel.match(/^(?:tribe(\d)\.(units|[a-z_]+s)|(wild))$/);
    if (!m) return out;
    const tribe = m[3] ? -1 : Number(m[1]);
    const kind = m[3] ? "wild" : m[2] === "units" ? null : m[2].slice(0, -1);
    const type = kind === null ? -1 : (this.cfg.unitIndex.get(kind) ?? -2);
    // riders aboard a vehicle take no orders of their own (BACKLOG 10): the vehicle carries them
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe && (type === -1 || E.type[i] === type) && E.task[i] !== TASK.ride) out.push(i);
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
        if (E.inside[i] < 0 && this.units.nav[E.type[i]] === 0 && this.terrain.drowns(E.x[i], E.y[i])) out.push(`unit ${i} stands in deep water`);
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
    // vehicles (BACKLOG 10): riders match the count and fit the capacity
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || !this.vehicles.isVehicle(i)) continue;
      const occ = inside.get(i) ?? 0;
      if (E.occupants[i] !== occ) out.push(`vehicle ${i} occupants ${E.occupants[i]} != riders ${occ}`);
      if (occ > this.vehicles.capacityOf(i)) out.push(`vehicle ${i} over capacity`);
    }
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
      if (!E.alive[h] || (E.cat[h] !== CAT.building && !this.vehicles.isVehicle(h))) out.push(`unit ${i} inside a missing building`);
      else if (E.tribe[h] !== E.tribe[i]) out.push(`unit ${i} of tribe ${E.tribe[i]} inside building ${h} of tribe ${E.tribe[h]}`);
    }
    if (E.freeList.length + E.count !== E.hi) out.push("free list inconsistent");
    return out;
  }

  private flushTerrain(): void {
    if (!this.terrainQueue.length) return;
    this.combat.onTerrainOps(this.terrainQueue);
    for (const op of this.terrainQueue) this.terrain.apply(op);
    this.terrainQueue = [];
    this.drownCheck();
  }

  /** Units standing in water deeper than drownDepth drown; trees and rocks under water are lost. */
  drownCheck(): void {
    const e = this.ents;
    for (let i = 0; i < e.hi; i++) {
      if (!e.alive[i]) continue;
      const c = e.cat[i];
      if ((c === CAT.unit || c === CAT.tree || c === CAT.rock) && (c !== CAT.unit || (e.inside[i] < 0 && this.units.nav[e.type[i]] === 0)) && this.terrain.drowns(e.x[i], e.y[i])) this.kill(i, c === CAT.unit ? "drowned" : "flooded");
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
      mf.u32(t.shaper).f64(t.respawnAt).f64(t.eco.priorities.build).f64(t.eco.priorities.upgrade).f64(t.eco.priorities.breed).u32(t.eco.tier);
      if (t.casting) mf.u32(t.casting.spell).f64(t.casting.x).f64(t.casting.y).u32(t.casting.startedAt).u32(t.casting.resolveAt);
      if (t.pending) mf.u32(t.pending.spell + 1000).f64(t.pending.x).f64(t.pending.y).f64(t.pending.best);
      mf.bytes(t.eco.charges).bytes(t.eco.progress).bytes(t.eco.auto).bytes(t.eco.unlocked);
      // BACKLOG 6: hashed only when set, so worlds without a handicap keep their hashes
      if (t.eco.incomeMult !== 1) mf.u32(6006).f64(t.eco.incomeMult);
    }
    this.worship.hashInto(mf);
    this.level?.hashInto(mf);
    this.rules?.hashInto(mf);
    this.forge?.hashInto(mf);
    // BACKLOG 14b: hashed only in rain, so clear worlds keep their hashes
    if (this.weather === "rain") mf.u32(1414).f64(this.speedMult);
    this.vision.hashInto(mf);
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
      ...(this.terrain.dirty.some((d) => d.seq > this.units.lastVersion) ? { terrainDirty: this.terrain.dirty.filter((d) => d.seq > this.units.lastVersion).map((d) => ({ ...d })) } : {}),
      ...(this.units.flowKeys().length ? { flowKeys: this.units.flowKeys() } : {}),
      ...(this.worship.sites.length || this.worship.granted.some((g) => g.length) ? { worship: this.worship.save() } : {}),
      ...(this.level ? { level: this.level.save() } : {}),
      ...(this.rules ? { rules: this.rules.save() } : {}),
      ...(this.forge ? { forge: this.forge.save() } : {}),
      ...(this.vision.on ? { vision: this.vision.save() } : {}),
      origin: JSON.parse(JSON.stringify(this.origin)) as WorldOrigin,
    };
  }

  /** BACKLOG 35: rebuild a world from a snapshot alone (its origin) and the pack files it was made with. */
  static fromSnapshot(pack: PackFiles, snap: WorldSnapshot): World {
    if (!snap.origin) throw new Error("snapshot has no origin (made before BACKLOG 35): restore it with its WorldInit");
    return World.restore({ ...snap.origin, pack }, snap);
  }

  static restore(init: WorldInit, snap: WorldSnapshot): World {
    const why = snap.origin ? originMismatch(snap.origin, init) : null;
    if (why) throw new Error(`snapshot does not belong to this world: ${why}`);
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
    w.terrain.dirty = (snap.terrainDirty ?? []).map((d) => ({ ...d }));
    if (snap.flowKeys) w.units.loadFlows(snap.flowKeys);
    if (snap.worship) w.worship.load(snap.worship);
    if (snap.level && w.level) w.level.load(snap.level);
    if (snap.rules && w.rules) w.rules.load(snap.rules);
    if (snap.forge && w.forge) w.forge.load(snap.forge);
    if (snap.vision && w.vision.on) w.vision.load(snap.vision);
    return w;
  }

  /** Counts per category and tribe, for summaries and scenario assertions. */
  count(pred: (i: number) => boolean): number {
    let n = 0;
    for (let i = 0; i < this.ents.hi; i++) if (this.ents.alive[i] && pred(i)) n++;
    return n;
  }
}

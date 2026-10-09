// Economy (M4): settler autonomy (system step 3), construction, dwellings and breeding, trees,
// mana income and sinks (step 8). All numbers come from the data pack; see DESIGN sections 5, 6, 8.
import { CAT, NO_ENTITY, type EntityId } from "./entities.ts";
import { secondsToTicks } from "./config.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import { ORDER } from "./units.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

/** Settler task states. */
/** Unit tasks. 9 to 12 (training and garrison) are driven by the combat system (M6). */
export const TASK = { idle: 0, toTree: 1, chop: 2, haul: 3, toWork: 4, work: 5, toHome: 6, home: 7, wander: 8, toTrain: 9, training: 10, toGarrison: 11, garrison: 12 } as const;
/** Building states (state column). */
export const BSTATE = { plan: 0, flatten: 1, build: 2, done: 3 } as const;
/** Tree state: 0 normal, 1 doomed (inside a plan footprint, removed when chopped out). */
export const TREE_DOOMED = 1;

export interface TribeEco {
  /** mana per minute last tick (for the HUD) */
  incomePerMin: number;
  /** mana wasted because no sink could absorb it */
  wasted: number;
  spellsPct: number;
  /** per spell (data index): charges, progress toward the next charge, auto-charge flag, unlocked flag */
  charges: Int32Array;
  progress: Float64Array;
  auto: Uint8Array;
  unlocked: Uint8Array;
  cursor: number;
  /** mana into the training sink (consumed in M6) */
  trainMana: number;
  trainDemand: number;
  priorities: { build: number; upgrade: number; breed: number };
  /** highest progression tier reached (balance.progression.tiers index; never goes down) */
  tier: number;
}

export function newTribeEco(w: World): TribeEco {
  const spells = w.cfg.pack.spells;
  const eco = w.cfg.pack.balance.economy;
  const n = spells.spells.length;
  const e: TribeEco = {
    incomePerMin: 0,
    wasted: 0,
    spellsPct: spells.chargeRules.defaultSplitSpellsPct,
    charges: new Int32Array(n),
    progress: new Float64Array(n),
    auto: new Uint8Array(n),
    unlocked: new Uint8Array(n),
    cursor: 0,
    trainMana: 0,
    trainDemand: 0,
    priorities: { ...eco.priorities },
    tier: 0,
  };
  spells.spells.forEach((s, i) => {
    const sel = eco.skirmishSpells;
    e.unlocked[i] = sel === "all" || (sel === "v1" && s.v1) || (Array.isArray(sel) && sel.includes(s.id)) ? 1 : 0;
    e.auto[i] = e.unlocked[i] && eco.defaultAutoCharge.includes(s.id) ? 1 : 0;
  });
  // start mana becomes charges of the cheapest auto-charged spell (DESIGN section 5: 3 Bolts)
  let cheapest = -1;
  spells.spells.forEach((s, i) => {
    if (e.auto[i] && (cheapest < 0 || s.cost < spells.spells[cheapest].cost)) cheapest = i;
  });
  if (cheapest >= 0) {
    const s = spells.spells[cheapest];
    e.charges[cheapest] = Math.min(s.maxCharges, Math.floor(spells.chargeRules.startMana / s.cost));
  }
  return e;
}

export function cloneEco(e: TribeEco): TribeEco {
  return { ...e, charges: e.charges.slice(), progress: e.progress.slice(), auto: e.auto.slice(), unlocked: e.unlocked.slice(), priorities: { ...e.priorities } };
}

export class EconomySystem {
  private readonly w: World;
  readonly typeSettler: number;
  readonly typeShaper: number;
  readonly typeWild: number;
  readonly typeDwelling: number;
  readonly typeHearth: number;

  constructor(w: World) {
    this.w = w;
    const u = w.cfg.unitIndex;
    const b = w.cfg.buildingIndex;
    this.typeSettler = u.get("settler") ?? -1;
    this.typeShaper = u.get("shaper") ?? -1;
    this.typeWild = u.get("wild") ?? -1;
    this.typeDwelling = b.get("dwelling") ?? -1;
    this.typeHearth = b.get("hearth") ?? -1;
  }

  // ---------------------------------------------------------------- queries
  /** Why a building type is locked for a tribe by progression ("needs N followers"), else null. */
  buildingLock(tribe: number, type: number): string | null {
    const t = this.w.tribes[tribe];
    if (!t) return null;
    const id = this.w.cfg.pack.buildings.buildings[type].id;
    const tiers = this.w.cfg.pack.balance.progression.tiers;
    const k = tiers.findIndex((x) => x.buildings.includes(id));
    return k > t.eco.tier ? `needs ${tiers[k].followers} followers` : null;
  }

  followers(tribe: number): number {
    const E = this.w.ents;
    let n = 0;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === tribe && E.type[i] !== this.typeShaper) n++;
    return n;
  }

  popCap(tribe: number): number {
    const w = this.w;
    const E = w.ents;
    const rules = w.cfg.pack.units.rules;
    let supply = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building || E.tribe[i] !== tribe || E.state[i] !== BSTATE.done || E.type[i] !== this.typeDwelling) continue;
      supply += this.dwellingLevel(i).supply;
    }
    return Math.min(rules.populationCap, rules.startPopulation + supply);
  }

  dwellingLevel(i: number): { capacity: number; supply: number; breedSeconds: number; upgradeWood?: number; upgradeWoodAtDoor?: number } {
    const levels = this.w.cfg.pack.buildings.buildings[this.typeDwelling].levels!;
    const lv = levels[Math.max(0, Math.min(levels.length - 1, this.w.ents.level[i] - 1))];
    return lv;
  }

  /** Wood a site needs in total (construction cost). */
  woodCost(i: number): number {
    const def = this.w.cfg.pack.buildings.buildings[this.w.ents.type[i]];
    return def.wood ?? def.levels?.[0]?.wood ?? 0;
  }

  footprint(i: number): { x0: number; y0: number; fw: number; fh: number } {
    const def = this.w.cfg.pack.buildings.buildings[this.w.ents.type[i]];
    const [fw, fh] = def.footprint;
    return { x0: Math.round(this.w.ents.x[i] - fw / 2), y0: Math.round(this.w.ents.y[i] - fh / 2), fw, fh };
  }

  /** Why a building of `type` cannot be planned with its center at (cx, cy), or null. */
  planBlocker(type: number, cx: number, cy: number): string | null {
    const w = this.w;
    const t = w.terrain;
    const E = w.ents;
    const def = w.cfg.pack.buildings.buildings[type];
    if (!def || def.buildable === false || def.milestone === "backlog") return "not buildable";
    const [fw, fh] = def.footprint;
    const x0 = Math.round(cx - fw / 2);
    const y0 = Math.round(cy - fh / 2);
    if (!t.buildable(x0, y0, fw, fh, w.cfg.pack.balance.economy.flattenMaxRange)) return "ground not buildable";
    const gap = w.cfg.pack.balance.economy.buildingGapCells;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building) continue;
      const od = w.cfg.pack.buildings.buildings[E.type[i]];
      const dx = Math.abs(wrapDelta(E.x[i] - (x0 + fw / 2), t.size));
      const dy = Math.abs(wrapDelta(E.y[i] - (y0 + fh / 2), t.size));
      if (dx < (fw + od.footprint[0]) / 2 + gap && dy < (fh + od.footprint[1]) / 2 + gap) return "overlaps a building";
    }
    return null;
  }

  /** Create a plan; trees inside the footprint are doomed (chopped out first). */
  placePlan(tribe: number, type: number, cx: number, cy: number): EntityId {
    const w = this.w;
    const E = w.ents;
    const def = w.cfg.pack.buildings.buildings[type];
    const [fw, fh] = def.footprint;
    const x0 = Math.round(cx - fw / 2);
    const y0 = Math.round(cy - fh / 2);
    const n = w.terrain.size;
    const id = w.spawnBuilding(def.id, tribe, (((x0 + fw / 2) % n) + n) % n, (((y0 + fh / 2) % n) + n) % n);
    const i = E.index(id);
    E.state[i] = BSTATE.plan;
    E.hp[i] = 1;
    E.wood[i] = 0;
    E.progress[i] = 0;
    // flatten target: footprint average, at least shore height
    let sum = 0;
    let cells = 0;
    for (let y = 0; y <= fh; y++) for (let x = 0; x <= fw; x++, cells++) sum += w.terrain.get(x0 + x, y0 + y);
    E.progress2[i] = Math.max(Math.round(sum / cells), w.terrain.sea + 4);
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k] || E.cat[k] !== CAT.tree) continue;
      const dx = wrapDelta(E.x[k] - (x0 + fw / 2), w.terrain.size);
      const dy = wrapDelta(E.y[k] - (y0 + fh / 2), w.terrain.size);
      if (Math.abs(dx) <= fw / 2 + 0.5 && Math.abs(dy) <= fh / 2 + 0.5) {
        if (E.wood[k] === 0) w.kill(k, "cleared");
        else E.state[k] = TREE_DOOMED;
      }
    }
    w.emit("planPlaced", { id, tribe, kind: type });
    return id;
  }

  /** A plan was removed before completion: its doomed trees grow normally again. */
  releasePlanTrees(site: number): void {
    for (const k of this.doomedTreesIn(site)) this.w.ents.state[k] = 0;
  }

  private doomedTreesIn(site: number): number[] {
    const E = this.w.ents;
    const { x0, y0, fw, fh } = this.footprint(site);
    const out: number[] = [];
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k] || E.cat[k] !== CAT.tree || E.state[k] !== TREE_DOOMED) continue;
      const dx = wrapDelta(E.x[k] - (x0 + fw / 2), this.w.terrain.size);
      const dy = wrapDelta(E.y[k] - (y0 + fh / 2), this.w.terrain.size);
      if (Math.abs(dx) <= fw / 2 + 0.5 && Math.abs(dy) <= fh / 2 + 0.5) out.push(k);
    }
    return out;
  }

  private dist2(a: number, b: number): number {
    const E = this.w.ents;
    const n = this.w.terrain.size;
    const dx = wrapDelta(E.x[a] - E.x[b], n);
    const dy = wrapDelta(E.y[a] - E.y[b], n);
    return dx * dx + dy * dy;
  }

  /** Walkable component of the vertex nearest an entity (0 when none is walkable nearby); r 2 for units, snapRadius for buildings. */
  private compOf(i: number, r = 2): number {
    const pf = this.w.units.pf;
    pf.refresh();
    const n = this.w.terrain.size;
    const E = this.w.ents;
    const v = pf.nearestWalkable((((Math.round(E.x[i]) % n) + n) % n) + (((Math.round(E.y[i]) % n) + n) % n) * n, r);
    return v < 0 ? 0 : pf.comp[v];
  }

  /** Nearest tree with wood that a settler can actually walk to (same walkable component). */
  private nearestTree(from: number, maxR = 64): number {
    const E = this.w.ents;
    const home = this.compOf(from);
    let best = -1;
    let bd = maxR * maxR;
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k] || E.cat[k] !== CAT.tree || E.wood[k] === 0 || E.state[k] === TREE_DOOMED) continue;
      if (this.dist2(from, k) >= bd || this.compOf(k) !== home) continue;
      const d = this.dist2(from, k);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  private goTo(i: number, target: number, task: number): void {
    const E = this.w.ents;
    const tid = E.idOf(target);
    const inc = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
    if (task === TASK.toTree) inc(this.jobs.tree, tid);
    else if (task === TASK.toWork) inc(this.jobs.work, tid);
    else if (task === TASK.toHome) inc(this.jobs.home, tid);
    else if (task === TASK.haul) inc(this.jobs.wood, tid);
    E.task[i] = task;
    E.target[i] = E.idOf(target);
    E.timer[i] = 0;
    this.w.units.order([i], E.x[target], E.y[target]);
  }

  /** Walkable spot just outside a building (the door), deterministic. */
  doorOf(h: number): [number, number] {
    const E = this.w.ents;
    const n = this.w.terrain.size;
    const pf = this.w.units.pf;
    pf.refresh();
    const off = this.w.cfg.pack.balance.economy.doorOffset;
    const x = (((E.x[h] + off) % n) + n) % n;
    const v = pf.nearestWalkable((Math.round(x) % n) + (((Math.round(E.y[h]) % n) + n) % n) * n, 4);
    return v < 0 ? [x, E.y[h]] : [v % n, (v - (v % n)) / n];
  }

  private leaveHome(i: number): void {
    const E = this.w.ents;
    const h = E.inside[i];
    if (h < 0) return;
    if (E.alive[h] && E.occupants[h] > 0) E.occupants[h]--;
    E.inside[i] = -1;
    const [dx, dy] = this.doorOf(h);
    E.x[i] = dx;
    E.y[i] = dy;
    E.px[i] = E.x[i];
    E.py[i] = E.y[i];
    E.task[i] = TASK.idle;
  }

  private near(i: number, target: number): boolean {
    const r = this.w.cfg.pack.balance.economy.workRange;
    return this.dist2(i, target) <= r * r;
  }

  // ---------------------------------------------------------------- step 3: tasks and decisions
  updateTasks(): void {
    const w = this.w;
    const E = w.ents;
    const hz = w.cfg.tickHz;
    const eco = w.cfg.pack.balance.economy;
    const chopTicks = secondsToTicks(w.cfg.pack.buildings.trees.chopSecondsPerWood, hz);
    // per-settler state machine
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const task = E.task[i];
      if (task === TASK.idle || task === TASK.home) continue;
      if (task === TASK.wander) {
        if (E.order[i] === ORDER.none) E.task[i] = TASK.idle;
        continue;
      }
      const t = E.index(E.target[i]);
      if (t < 0) {
        this.drop(i);
        continue;
      }
      const moving = E.order[i] !== ORDER.none;
      switch (task) {
        case TASK.toTree:
          if (E.wood[t] === 0) this.drop(i);
          else if (!moving) {
            if (this.near(i, t)) {
              E.task[i] = TASK.chop;
              E.timer[i] = 0;
            } else this.drop(i);
          }
          break;
        case TASK.chop:
          if (E.wood[t] === 0) {
            this.drop(i);
            break;
          }
          if (++E.timer[i] >= chopTicks) {
            E.wood[t]--;
            w.treeVersion++;
            E.carry[i] = eco.carryWood;
            if (E.wood[t] === 0 && E.state[t] === TREE_DOOMED) w.kill(t, "felled");
            const site = E.index(E.progress[i]);
            if (site < 0) this.drop(i);
            else this.goTo(i, site, TASK.haul);
          }
          break;
        case TASK.haul:
          if (!moving) {
            if (this.near(i, t)) {
              E.wood[t] = Math.min(255, E.wood[t] + E.carry[i]);
              E.carry[i] = 0;
              w.emit("woodDelivered", { site: E.idOf(t), tribe: E.tribe[i] });
              E.task[i] = TASK.idle;
            } else this.drop(i);
          }
          break;
        case TASK.toWork:
          if (E.state[t] === BSTATE.done) E.task[i] = TASK.idle;
          else if (!moving) {
            if (this.near(i, t)) E.task[i] = TASK.work;
            else this.drop(i);
          }
          break;
        case TASK.work:
          if (E.state[t] === BSTATE.done) E.task[i] = TASK.idle;
          break;
        case TASK.toHome:
          if (E.state[t] !== BSTATE.done) this.drop(i);
          else if (!moving) {
            const lv = this.dwellingLevel(t);
            if (this.near(i, t) && E.occupants[t] < lv.capacity) {
              E.inside[i] = t;
              E.occupants[t]++;
              E.task[i] = TASK.home;
              E.x[i] = E.x[t];
              E.y[i] = E.y[t];
              w.units.stop(i);
            } else this.drop(i);
          }
          break;
      }
    }
    // job assignment per tribe at its cadence
    const every = secondsToTicks(eco.decideEverySeconds, hz);
    for (const tr of w.tribes) if (w.tick % every === tr.index % every) this.assign(tr.index);
    // wild people wander near where they stand
    const wanderEvery = hz;
    if (w.tick % wanderEvery === 0) {
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.cat[i] !== CAT.unit || E.type[i] !== this.typeWild || E.tribe[i] !== -1 || E.order[i] !== ORDER.none) continue;
        if (!w.rng.chance("misc", eco.wildWanderChancePerSecond)) continue;
        const a = w.rng.float("misc") * TWO_PI;
        const d = 1 + w.rng.float("misc") * eco.wildWanderRadius;
        const n = w.terrain.size;
        const x = (((E.x[i] + cos(a) * d) % n) + n) % n;
        const y = (((E.y[i] + sin(a) * d) % n) + n) % n;
        if (!w.terrain.walkable(Math.round(x), Math.round(y))) continue;
        E.task[i] = TASK.wander;
        w.units.order([i], x, y);
      }
    }
  }

  /** Abandon the current job; carried wood is lost. */
  private drop(i: number): void {
    const E = this.w.ents;
    E.task[i] = TASK.idle;
    E.target[i] = NO_ENTITY;
    E.carry[i] = 0;
  }

  /** Per-pass job counts: wood jobs and work jobs per site, home arrivals per dwelling, choppers per tree. */
  private jobs = { wood: new Map<number, number>(), work: new Map<number, number>(), home: new Map<number, number>(), tree: new Map<number, number>() };

  private countJobs(): void {
    const E = this.w.ents;
    const j = this.jobs;
    j.wood.clear();
    j.work.clear();
    j.home.clear();
    j.tree.clear();
    const inc = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const t = E.task[i];
      if (t === TASK.toTree || t === TASK.chop) {
        inc(j.wood, E.progress[i]);
        inc(j.tree, E.target[i]);
      } else if (t === TASK.haul) inc(j.wood, E.target[i]);
      else if (t === TASK.toWork || t === TASK.work) inc(j.work, E.target[i]);
      else if (t === TASK.toHome) inc(j.home, E.target[i]);
    }
  }

  private inbound(site: number, tasks: number[]): number {
    const id = this.w.ents.idOf(site);
    if (tasks.includes(TASK.toWork)) return this.jobs.work.get(id) ?? 0;
    if (tasks.includes(TASK.toHome)) return this.jobs.home.get(id) ?? 0;
    return this.jobs.wood.get(id) ?? 0;
  }

  private assign(tribe: number): void {
    const w = this.w;
    const E = w.ents;
    const eco = w.cfg.pack.balance.economy;
    const pri = w.tribes[tribe].eco.priorities;
    const bdefs = w.cfg.pack.buildings;
    this.countJobs();
    const sites: number[] = [];
    const homes: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building || E.tribe[i] !== tribe) continue;
      if (E.state[i] !== BSTATE.done) sites.push(i);
      else if (E.type[i] === this.typeDwelling) homes.push(i);
    }
    // candidates: idle settlers outside, then housed settlers (keeping one per home to breed)
    const free: number[] = [];
    const housed: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== tribe || E.type[i] !== this.typeSettler) continue;
      if (E.task[i] === TASK.idle && E.order[i] === ORDER.none && E.mode[i] === 0) free.push(i);
      else if (E.task[i] === TASK.home) housed.push(i);
    }
    // walkable components: a settler only takes work or a home on its own landmass (M7 regression:
    // spells and cliffs split a base and settlers retried unreachable homes every few seconds)
    const snap = w.cfg.pack.balance.movement.snapRadius;
    const comps = new Map<number, number>();
    const compAt = (i: number, r: number) => {
      let c = comps.get(i);
      if (c === undefined) comps.set(i, (c = this.compOf(i, r)));
      return c;
    };
    const take = (near: number): number => {
      let best = -1;
      let bd = Infinity;
      let fromHome = false;
      const nc = compAt(near, E.cat[near] === CAT.building ? snap : 2);
      for (const i of free) {
        if (compAt(i, 2) !== nc) continue;
        const d = this.dist2(i, near);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0) {
        for (const i of housed) {
          const h = E.inside[i];
          if (eco.keepOneOccupantForBreeding && E.occupants[h] <= 1) continue;
          if (compAt(h, snap) !== nc) continue;
          const d = this.dist2(h, near);
          if (d < bd) {
            bd = d;
            best = i;
            fromHome = true;
          }
        }
      }
      if (best < 0) return -1;
      if (fromHome) {
        housed.splice(housed.indexOf(best), 1);
        this.leaveHome(best);
      } else free.splice(free.indexOf(best), 1);
      return best;
    };
    // 1. construction sites
    if (pri.build > 0) {
      for (const s of sites) {
        const doomed = this.doomedTreesIn(s);
        for (const tree of doomed) {
          if (this.inboundTree(tree) > 0) continue;
          const i = take(tree);
          if (i < 0) return;
          this.goTo(i, tree, TASK.toTree);
          E.progress[i] = E.idOf(s);
          this.jobs.wood.set(E.idOf(s), (this.jobs.wood.get(E.idOf(s)) ?? 0) + 1);
        }
        if (doomed.length) continue;
        let need = this.woodCost(s) - E.wood[s] - this.inbound(s, [TASK.toTree, TASK.chop, TASK.haul]);
        // settlers already carrying wood (starting supplies) deliver it first
        for (const i of [...free]) {
          if (need <= 0) break;
          if (E.carry[i] <= 0) continue;
          free.splice(free.indexOf(i), 1);
          this.goTo(i, s, TASK.haul);
          need -= E.carry[i];
        }
        for (let k = 0; k < need; k++) {
          const i = take(s);
          if (i < 0) return;
          if (E.carry[i] > 0) {
            this.goTo(i, s, TASK.haul);
            continue;
          }
          const tree = this.nearestTree(i);
          if (tree < 0) {
            free.push(i);
            break;
          }
          this.goTo(i, tree, TASK.toTree);
          E.progress[i] = E.idOf(s);
          this.jobs.wood.set(E.idOf(s), (this.jobs.wood.get(E.idOf(s)) ?? 0) + 1);
        }
        const slots = bdefs.construction.workersPerSite - this.inbound(s, [TASK.toWork, TASK.work]);
        const canWork = E.state[s] !== BSTATE.build || E.wood[s] * bdefs.construction.buildSecondsPerWood > E.progress[s];
        for (let k = 0; k < slots && canWork; k++) {
          const i = take(s);
          if (i < 0) return;
          this.goTo(i, s, TASK.toWork);
        }
      }
    }
    // 2. dwelling upgrades (full homes collect wood at the door)
    if (pri.upgrade > 0) {
      for (const d of homes) {
        const lv = this.dwellingLevel(d);
        const next = bdefs.buildings[this.typeDwelling].levels![E.level[d]];
        if (!next || E.occupants[d] < lv.capacity) continue;
        const need = (next.upgradeWoodAtDoor ?? 0) - E.wood[d] - this.inbound(d, [TASK.toTree, TASK.chop, TASK.haul]);
        for (let k = 0; k < need; k++) {
          const i = take(d);
          if (i < 0) return;
          const tree = this.nearestTree(i);
          if (tree < 0) {
            free.push(i);
            break;
          }
          this.goTo(i, tree, TASK.toTree);
          E.progress[i] = E.idOf(d);
          this.jobs.wood.set(E.idOf(d), (this.jobs.wood.get(E.idOf(d)) ?? 0) + 1);
        }
      }
    }
    // 3. everyone else moves into a home with space (breeding)
    if (pri.breed > 0) {
      for (const i of [...free]) {
        let best = -1;
        let bd = Infinity;
        for (const d of homes) {
          const space = this.dwellingLevel(d).capacity - E.occupants[d] - this.inbound(d, [TASK.toHome]);
          if (space <= 0 || compAt(d, snap) !== compAt(i, 2)) continue;
          const dd = this.dist2(i, d);
          if (dd < bd) {
            bd = dd;
            best = d;
          }
        }
        if (best < 0) break;
        this.goTo(i, best, TASK.toHome);
      }
    }
  }

  private inboundTree(tree: number): number {
    return this.jobs.tree.get(this.w.ents.idOf(tree)) ?? 0;
  }

  // ---------------------------------------------------------------- step 8: economy
  update(): void {
    const w = this.w;
    const E = w.ents;
    const hz = w.cfg.tickHz;
    const bdefs = w.cfg.pack.buildings;
    const eco = w.cfg.pack.balance.economy;
    const flattenEvery = hz;
    // construction sites
    for (let s = 0; s < E.hi; s++) {
      if (!E.alive[s] || E.cat[s] !== CAT.building || E.state[s] === BSTATE.done) continue;
      let workers = 0;
      const sid = E.idOf(s);
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.task[i] === TASK.work && E.target[i] === sid) workers++;
      if (E.state[s] === BSTATE.plan && workers > 0 && !this.doomedTreesIn(s).length) E.state[s] = BSTATE.flatten;
      if (E.state[s] === BSTATE.flatten && workers > 0 && w.tick % flattenEvery === 0) {
        const { x0, y0, fw, fh } = this.footprint(s);
        const target = E.progress2[s];
        let left = 0;
        for (let y = 0; y <= fh; y++) for (let x = 0; x <= fw; x++) left += Math.abs(w.terrain.get(x0 + x, y0 + y) - target);
        if (left === 0) E.state[s] = BSTATE.build;
        else w.terrainQueue.push({ op: "flattenRect", x: x0, y: y0, w: fw, h: fh, target, step: Math.round(eco.flattenStepPerWorkerSecond * workers) });
      }
      if (E.state[s] === BSTATE.build && workers > 0) {
        const total = this.woodCost(s) * bdefs.construction.buildSecondsPerWood;
        const cap = E.wood[s] * bdefs.construction.buildSecondsPerWood;
        E.progress[s] = Math.min(cap, E.progress[s] + workers / hz);
        if (E.progress[s] >= total) {
          E.state[s] = BSTATE.done;
          const def = bdefs.buildings[E.type[s]];
          E.hp[s] = def.hp;
          E.wood[s] = 0;
          E.progress[s] = 0;
          if (E.type[s] === this.typeDwelling) E.level[s] = 1;
          w.emit("buildingDone", { id: sid, tribe: E.tribe[s], kind: E.type[s] });
        }
      }
    }
    // dwellings: breeding and upgrades
    const pops = w.tribes.map((t) => this.followers(t.index));
    const caps = w.tribes.map((t) => this.popCap(t.index));
    // progression: open every tier the follower count reaches (peak based)
    const tiers = w.cfg.pack.balance.progression.tiers;
    for (const t of w.tribes) {
      while (t.alive && t.eco.tier + 1 < tiers.length && pops[t.index] >= tiers[t.eco.tier + 1].followers) {
        t.eco.tier++;
        w.emit("tierReached", { tribe: t.index, tier: t.eco.tier, id: tiers[t.eco.tier].id });
      }
    }
    const breed = w.cfg.pack.balance.breeding;
    for (let d = 0; d < E.hi; d++) {
      if (!E.alive[d] || E.cat[d] !== CAT.building || E.type[d] !== this.typeDwelling || E.state[d] !== BSTATE.done) continue;
      const tr = E.tribe[d];
      const levels = bdefs.buildings[this.typeDwelling].levels!;
      const next = levels[E.level[d]];
      if (next && E.wood[d] >= (next.upgradeWoodAtDoor ?? Infinity)) {
        E.wood[d] -= next.upgradeWood ?? 0;
        E.level[d]++;
        w.emit("dwellingUpgraded", { id: E.idOf(d), tribe: tr, level: E.level[d] });
      }
      const occ = E.occupants[d];
      if (occ === 0 || tr < 0 || pops[tr] >= caps[tr]) continue;
      const lv = this.dwellingLevel(d);
      const frac = pops[tr] / caps[tr];
      const start = breed.nearCapSlowdownStartPct / 100;
      const near = frac <= start ? 1 : 1 + ((frac - start) / (1 - start)) * (breed.nearCapFactorAtCap - 1);
      const ticks = ((lv.breedSeconds * hz) / (0.5 + 0.5 * occ)) * near;
      E.progress[d] += 1 / ticks;
      if (E.progress[d] >= 1) {
        E.progress[d] = 0;
        const [bx, by] = this.doorOf(d);
        w.spawnUnit("settler", tr, bx, by);
        pops[tr]++;
        w.emit("born", { tribe: tr, home: E.idOf(d) });
      }
    }
    this.updateTrees();
    this.updateMana();
  }

  private updateTrees(): void {
    const w = this.w;
    const E = w.ents;
    const hz = w.cfg.tickHz;
    const tr = w.cfg.pack.buildings.trees;
    const perWood = secondsToTicks(tr.regrowSecondsPerWood, hz);
    const stump = secondsToTicks(tr.regrowFromStumpSeconds, hz);
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k] || E.cat[k] !== CAT.tree || E.state[k] === TREE_DOOMED || E.wood[k] >= tr.maxWood) continue;
      E.timer[k]++;
      if (E.wood[k] === 0) {
        if (E.timer[k] >= stump) {
          E.wood[k] = tr.maxWood;
          E.timer[k] = 0;
          w.treeVersion++;
        }
      } else if (E.timer[k] >= perWood) {
        E.wood[k]++;
        E.timer[k] = 0;
        w.treeVersion++;
      }
    }
    // slow forest spread, once per minute
    if (tr.spread.enabled && w.tick % (60 * hz) === 60 * hz - 1) {
      const n = w.terrain.size;
      const hi = E.hi;
      for (let k = 0; k < hi; k++) {
        if (!E.alive[k] || E.cat[k] !== CAT.tree || E.wood[k] === 0 || !w.rng.chance("spawn", tr.spread.chancePerMinute)) continue;
        const a = w.rng.float("spawn") * TWO_PI;
        const x = (((E.x[k] + cos(a) * 2.2) % n) + n) % n;
        const y = (((E.y[k] + sin(a) * 2.2) % n) + n) % n;
        if (w.terrain.heightAt(x, y) < w.terrain.sea + 4 || w.terrain.slope(Math.round(x), Math.round(y)) > w.cfg.pack.terrain.trees.maxSlope || w.terrain.scarAt(x, y) > 0) continue;
        let crowded = false;
        for (let j = 0; j < E.hi && !crowded; j++) {
          if (!E.alive[j] || (E.cat[j] !== CAT.tree && E.cat[j] !== CAT.building)) continue;
          const dx = wrapDelta(E.x[j] - x, n);
          const dy = wrapDelta(E.y[j] - y, n);
          if (dx * dx + dy * dy < (E.cat[j] === CAT.building ? 6.25 : 1.44)) crowded = true;
        }
        if (!crowded) {
          const id = w.spawnTree(x, y);
          const ni = E.index(id);
          E.wood[ni] = 1;
        }
      }
    }
  }

  /** Mana per minute a unit produces in its current state (DESIGN section 5, units.json). */
  manaRate(i: number): number {
    const E = this.w.ents;
    const def = this.w.cfg.pack.units.units[E.type[i]];
    const m = def.manaPerMin;
    if (def.isCaster) return m.active ?? m.idle ?? 0;
    if (E.type[i] === this.typeSettler) {
      const t = E.task[i];
      const working = E.inside[i] >= 0 || (t >= TASK.toTree && t <= TASK.work);
      return working ? (m.housedOrWorking ?? 0) : (m.idle ?? 0);
    }
    if (m.moving !== undefined && E.order[i] !== ORDER.none) return m.moving;
    return m.idle ?? 0;
  }

  private updateMana(): void {
    const w = this.w;
    const E = w.ents;
    const per = 60 * w.cfg.tickHz;
    const rates = new Float64Array(w.tribes.length);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const tr = E.tribe[i];
      if (tr >= 0 && tr < rates.length) rates[tr] += this.manaRate(i);
    }
    for (const tr of w.tribes) {
      tr.eco.incomePerMin = tr.alive ? rates[tr.index] : 0;
      this.distribute(tr.index, tr.alive ? rates[tr.index] / per : 0);
    }
  }

  /** Inject mana outside the per-tick income (charge steal); flows through the same sinks. */
  addMana(tribe: number, amount: number): void {
    if (this.w.tribes[tribe]) this.distribute(tribe, amount);
  }

  private distribute(tribe: number, income: number): void {
    const w = this.w;
    const spells = w.cfg.pack.spells.spells;
    {
      const tr = w.tribes[tribe];
      const e = tr.eco;
      const spellSink = this.nextSpell(e) >= 0;
      const trainSink = e.trainDemand > 0;
      let toSpells = 0;
      let toTrain = 0;
      if (spellSink && trainSink) {
        toSpells = (income * e.spellsPct) / 100;
        toTrain = income - toSpells;
      } else if (spellSink) toSpells = income;
      else if (trainSink) toTrain = income;
      else e.wasted += income;
      e.trainMana += toTrain;
      while (toSpells > 0) {
        const s = this.nextSpell(e);
        if (s < 0) {
          e.wasted += toSpells;
          break;
        }
        e.cursor = s;
        const cost = spells[s].cost;
        const room = cost - e.progress[s];
        if (toSpells < room) {
          e.progress[s] += toSpells;
          toSpells = 0;
        } else {
          toSpells -= room;
          e.progress[s] = 0;
          e.charges[s]++;
          w.emit("charged", { tribe: tr.index, spell: s, charges: e.charges[s] });
          e.cursor = (s + 1) % spells.length;
        }
      }
    }
  }

  /** Next spell to charge: round robin from the cursor over unlocked, auto, not-full spells. */
  nextSpell(e: TribeEco): number {
    const spells = this.w.cfg.pack.spells.spells;
    for (let k = 0; k < spells.length; k++) {
      const s = (e.cursor + k) % spells.length;
      if (e.unlocked[s] && e.auto[s] && e.charges[s] < spells[s].maxCharges) return s;
    }
    return -1;
  }
}

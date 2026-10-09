// Combat (system order step 6b, M6): target acquisition by stance, chase and leash, melee swings,
// Firecaller fireballs (area damage, height bonus, knockback, chant interruption), Chanter channels
// that entrance and then convert, lodge training queues fed by the training mana sink, rally
// points, Watchtower garrisons, Shaper regeneration and the elimination aftermath. Numbers come
// from balance.json `combat` and units.json; this system keeps no state outside entity columns.
import { CAT, NO_ENTITY } from "./entities.ts";
import { secondsToTicks } from "./config.ts";
import { ORDER } from "./units.ts";
import { BSTATE, TASK } from "./economy.ts";
import { knockUnit } from "./effects.ts";
import { registerCommand, type Command } from "./commands.ts";
import { wrapDelta, type TerrainOpSpec } from "./terrain.ts";
import type { World } from "./world.ts";

export const STANCE = { aggressive: 0, defensive: 1, passive: 2 } as const;
export const STANCE_NAMES = ["aggressive", "defensive", "passive"] as const;
/** combat mode column: none, guard (return to the anchor after a fight), attack-move (resume to the goal), forced (explicit attack order) */
export const CMODE = { none: 0, guard: 1, attackMove: 2, forced: 3 } as const;

const KIND = { none: 0, melee: 1, ranged: 2, chanter: 3 } as const;

export class CombatSystem {
  private readonly w: World;
  /** per unit type: weapon kind, reach, damage per hit, cooldown ticks, preferred target types */
  private readonly kind: number[] = [];
  private readonly reach: number[] = [];
  private readonly hit: number[] = [];
  private readonly cool: number[] = [];
  private readonly minRange: number[] = [];
  private readonly prefers: Set<number>[] = [];
  private readonly convertible: boolean[] = [];
  private readonly stanceOf: number[] = [];
  /** per building type: trained unit type (-1 none), garrison slots */
  private readonly trains: number[] = [];
  private readonly garrisonSlots: number[] = [];
  /** alive building indices, refreshed at the start of each update */
  private readonly buildings: number[] = [];
  /** units per tribe per coarse cell (4 x 4 spatial hash buckets), built from the hash chains each
   * update so acquire skips its bucket scan exactly when no enemy can be in it */
  private tribeGrid = new Int32Array(0);
  private gridC = 0;
  private readonly typeWild: number;
  private readonly chantTicks: number;
  private readonly chantCool: number;

  constructor(w: World) {
    this.w = w;
    const units = w.cfg.pack.units.units;
    const cb = w.cfg.pack.balance.combat;
    const hz = w.cfg.tickHz;
    const swing = secondsToTicks(cb.meleeSwingSeconds, hz);
    let chantTicks = 0;
    let chantCool = 0;
    units.forEach((u, t) => {
      const ids = new Set<number>();
      for (const p of u.prefersTarget ?? []) if (w.cfg.unitIndex.has(p)) ids.add(w.cfg.unitIndex.get(p)!);
      this.prefers.push(ids);
      this.convertible.push(u.convertible !== false && !(u.isCaster === true));
      this.stanceOf.push(STANCE[u.stance]);
      this.minRange.push(u.ranged?.minRange ?? 0);
      if (u.convert) {
        this.kind.push(KIND.chanter);
        this.reach.push(u.convert.radius);
        this.hit.push(0);
        this.cool.push(secondsToTicks(u.convert.cooldownSeconds, hz));
        chantTicks = secondsToTicks(u.convert.channelSeconds, hz);
        chantCool = secondsToTicks(u.convert.cooldownSeconds, hz);
      } else if (u.ranged) {
        this.kind.push(KIND.ranged);
        this.reach.push(u.ranged.range);
        this.hit.push(u.ranged.damage);
        this.cool.push(secondsToTicks(u.ranged.cooldown, hz));
      } else if (u.melee) {
        this.kind.push(KIND.melee);
        this.reach.push(u.melee.range + 2 * cb.unitRadius);
        this.hit.push(u.melee.dps * cb.meleeSwingSeconds);
        this.cool.push(swing);
      } else {
        this.kind.push(KIND.none);
        this.reach.push(0);
        this.hit.push(0);
        this.cool.push(0);
      }
    });
    // chanters may not convert the listed types (Shapers are never convertible)
    for (const u of units) for (const id of u.convert?.cannotConvert ?? []) if (w.cfg.unitIndex.has(id)) this.convertible[w.cfg.unitIndex.get(id)!] = false;
    this.chantTicks = chantTicks;
    this.chantCool = chantCool;
    for (const b of w.cfg.pack.buildings.buildings) {
      this.trains.push(b.trains && b.milestone !== "backlog" ? (w.cfg.unitIndex.get(b.trains) ?? -1) : -1);
      this.garrisonSlots.push(b.garrison ?? 0);
    }
    this.typeWild = w.cfg.unitIndex.get("wild") ?? -1;
  }

  /** Default stance of a unit type (set on spawn and when trained). */
  defaultStance(type: number): number {
    return this.stanceOf[type] ?? STANCE.passive;
  }

  trainsAt(buildingType: number): number {
    return this.trains[buildingType] ?? -1;
  }

  garrisonOf(buildingType: number): number {
    return this.garrisonSlots[buildingType] ?? 0;
  }

  private dist(i: number, x: number, y: number): number {
    const n = this.w.terrain.size;
    const dx = wrapDelta(x - this.w.ents.x[i], n);
    const dy = wrapDelta(y - this.w.ents.y[i], n);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Half the larger footprint side of a building (0 for units): attack ranges reach its edge. */
  private halfSize(j: number): number {
    const E = this.w.ents;
    if (E.cat[j] !== CAT.building) return 0;
    const f = this.w.cfg.pack.buildings.buildings[E.type[j]].footprint;
    return Math.max(f[0], f[1]) / 2;
  }

  /** Elevation bands the attacker stands above the point (ranged bonus), clamped. */
  private bands(i: number, x: number, y: number): number {
    const cb = this.w.cfg.pack.balance.combat;
    const t = this.w.terrain;
    const dh = t.heightAt(this.w.ents.x[i], this.w.ents.y[i]) - t.heightAt(x, y);
    return Math.max(0, Math.min(cb.maxHeightBands, Math.floor(dh / cb.heightBandUnits)));
  }

  /** Reach of unit i against entity j right now (weapon, height bonus, tower bonus, target size). */
  reachOf(i: number, j: number): number {
    const E = this.w.ents;
    const ty = E.type[i];
    let r = this.reach[ty];
    const k = this.kind[ty];
    if (k === KIND.ranged) r += this.bands(i, E.x[j], E.y[j]) * (this.w.cfg.pack.units.units[ty].ranged?.heightRangeBonusPerBand ?? 0);
    if (E.inside[i] >= 0 && E.task[i] === TASK.garrison && k !== KIND.chanter) r += this.w.cfg.pack.buildings.buildings[E.type[E.inside[i]]].rangeBonus ?? 0;
    if (k === KIND.chanter) r -= 0.5;
    return r + this.halfSize(j);
  }

  /** Can unit i (tribe tr) attack or chant at entity j? */
  private validTarget(i: number, j: number): boolean {
    const w = this.w;
    const E = w.ents;
    if (j < 0 || !E.alive[j]) return false;
    const tj = E.tribe[j];
    if (tj < 0 || tj === E.tribe[i] || !w.tribes[tj]?.alive) return false;
    const c = E.cat[j];
    if (c === CAT.unit && E.veil[j] > 0) return false;
    if (this.kind[E.type[i]] === KIND.chanter) return c === CAT.unit && E.inside[j] < 0 && this.convertible[E.type[j]];
    if (c === CAT.unit) return E.inside[j] < 0;
    return c === CAT.building;
  }

  /** Walkable component under (x, y) (snapped like orders are), -1 when there is no walkable cell near. */
  private compAt(x: number, y: number): number {
    const w = this.w;
    const n = w.terrain.size;
    const v = w.units.pf.nearestWalkable((((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n, w.cfg.pack.balance.movement.snapRadius);
    return v < 0 ? -1 : w.units.pf.comp[v];
  }

  /** Could unit i get within reach of j: already in reach, or on the same landmass? (M7 regression: no chase across water or cliffs) */
  private canReach(i: number, j: number, d: number): boolean {
    const E = this.w.ents;
    if (E.inside[i] >= 0 || d <= this.reachOf(i, j)) return true;
    return this.compAt(E.x[i], E.y[i]) === this.compAt(E.x[j], E.y[j]);
  }

  /** Best target for unit i within radius r (and at least minRange away): units first (preferred types count as closer), then buildings. */
  private acquire(i: number, r: number): number {
    const minR = this.minRange[this.w.ents.type[i]];
    const w = this.w;
    const E = w.ents;
    const H = w.units.hash;
    const c = H.cols;
    const n = w.terrain.size;
    const x = E.x[i];
    const y = E.y[i];
    const pref = this.prefers[E.type[i]];
    const bonus = w.cfg.pack.balance.combat.preferTargetBonus;
    const tr = E.tribe[i];
    let br = Math.ceil(r / H.bs) + 1;
    if (2 * br + 1 > c) br = (c - 1) >> 1;
    const bx = ((Math.floor(x / H.bs) % c) + c) % c;
    const by = ((Math.floor(y / H.bs) % c) + c) % c;
    let best = -1;
    let bestScore = Infinity;
    const scan = this.enemyInBuckets(tr, bx, by, br);
    for (let oy = -br; scan && oy <= br; oy++) {
      for (let ox = -br; ox <= br; ox++) {
        const b = ((bx + ox + c * 4) % c) + ((by + oy + c * 4) % c) * c;
        for (let j = H.head[b]; j !== -1; j = H.next[j]) {
          // cheap rejections first (friends and out of range), the full check last
          const tj = E.tribe[j];
          if (tj < 0 || tj === tr) continue;
          const dx = wrapDelta(E.x[j] - x, n);
          const dy = wrapDelta(E.y[j] - y, n);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r || d < minR || !this.validTarget(i, j) || !this.canReach(i, j, d)) continue;
          const s = d - (pref.has(E.type[j]) ? bonus : 0);
          if (s < bestScore || (s === bestScore && j < best)) {
            bestScore = s;
            best = j;
          }
        }
      }
    }
    if (best >= 0 || this.kind[E.type[i]] === KIND.chanter) return best;
    for (const j of this.buildings) {
      if (!E.alive[j] || !this.validTarget(i, j)) continue;
      const d = this.dist(i, E.x[j], E.y[j]) - this.halfSize(j);
      if (d <= r && d < bestScore && this.canReach(i, j, d + this.halfSize(j))) {
        bestScore = d;
        best = j;
      }
    }
    return best;
  }

  private buildTribeGrid(): void {
    const w = this.w;
    const E = w.ents;
    const H = w.units.hash;
    const c = H.cols;
    const C = (c + 3) >> 2;
    const T = w.tribes.length;
    if (this.tribeGrid.length !== C * C * T) this.tribeGrid = new Int32Array(C * C * T);
    else this.tribeGrid.fill(0);
    this.gridC = C;
    for (let b = 0; b < c * c; b++) {
      const cell = ((b % c) >> 2) + (Math.floor(b / c) >> 2) * C;
      for (let j = H.head[b]; j !== -1; j = H.next[j]) {
        const t = E.tribe[j];
        if (t >= 0 && t < T) this.tribeGrid[t * C * C + cell]++;
      }
    }
  }

  /** Could a unit of a tribe other than tr sit in the (2 br + 1)^2 buckets around (bx, by)? */
  private enemyInBuckets(tr: number, bx: number, by: number, br: number): boolean {
    const c = this.w.units.hash.cols;
    const C = this.gridC;
    const T = this.w.tribes.length;
    let lastY = -1;
    for (let oy = -br; oy <= br; oy++) {
      const cy = ((((by + oy) % c) + c) % c) >> 2;
      if (cy === lastY) continue;
      lastY = cy;
      let lastX = -1;
      for (let ox = -br; ox <= br; ox++) {
        const cx = ((((bx + ox) % c) + c) % c) >> 2;
        if (cx === lastX) continue;
        lastX = cx;
        for (let t = 0; t < T; t++) if (t !== tr && this.tribeGrid[t * C * C + cx + cy * C] > 0) return true;
      }
    }
    return false;
  }

  /** End a chant early (ranged hit, spell, knockback, terrain change, new order). */
  interruptChant(i: number, why: string): void {
    const E = this.w.ents;
    if (E.chant[i] <= 0) return;
    E.chant[i] = 0;
    E.cd[i] = this.chantCool;
    this.w.emit("chantInterrupted", { id: E.idOf(i), tribe: E.tribe[i], why });
  }

  /** Forget the current fight and any walk to a lodge or tower (new player order). */
  clear(i: number): void {
    const E = this.w.ents;
    E.atk[i] = NO_ENTITY;
    E.mode[i] = CMODE.none;
    if (E.chant[i] > 0) this.interruptChant(i, "order");
    if (E.inside[i] < 0 && (E.task[i] === TASK.toTrain || E.task[i] === TASK.toGarrison || E.task[i] === TASK.toWorship || E.task[i] === TASK.worship)) {
      E.task[i] = TASK.idle;
      E.target[i] = NO_ENTITY;
    }
  }

  /** Step 7 hook: terrain changed near a chanter breaks its channel. */
  onTerrainOps(ops: readonly TerrainOpSpec[]): void {
    const E = this.w.ents;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.chant[i] <= 0) continue;
      for (const op of ops) {
        const o = op as unknown as { x: number; y: number; r?: number; width?: number };
        if (this.dist(i, o.x, o.y) <= (o.r ?? o.width ?? 4) + 3) {
          this.interruptChant(i, "terrain");
          break;
        }
      }
    }
  }

  /** Move unit i toward (x, y): straight steering when the line is clear, else a budgeted path. */
  private chase(i: number, x: number, y: number, kind: number): void {
    const w = this.w;
    const E = w.ents;
    const n = w.terrain.size;
    const cb = w.cfg.pack.balance.combat;
    const repath = secondsToTicks(cb.chaseRepathSeconds, w.cfg.tickHz);
    const direct = E.order[i] !== ORDER.none && E.flowGoal[i] < 0 && !E.waitPath[i] && w.units.paths[i] === null;
    if (direct && (w.tick + i) % repath !== 0) {
      E.gx[i] = x;
      E.gy[i] = y;
      return;
    }
    if (E.order[i] !== ORDER.none && !direct && (w.tick + i) % repath !== 0) return;
    const v = (((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n;
    if (this.dist(i, x, y) <= cb.leashRadius && w.units.pf.lineWalkableFrom(E.x[i], E.y[i], v)) w.units.steer(i, x, y, kind);
    else w.units.order([i], x, y, kind);
  }

  // ---------------------------------------------------------------- the step
  update(): void {
    const w = this.w;
    const E = w.ents;
    const cb = w.cfg.pack.balance.combat;
    const hz = w.cfg.tickHz;
    const units = w.cfg.pack.units.units;
    const retarget = secondsToTicks(cb.retargetSeconds, hz);
    const idleScan = secondsToTicks(cb.idleAcquireSeconds, hz);
    const giveUp = secondsToTicks(w.cfg.pack.balance.movement.giveUpSeconds, hz);
    this.updateShapers();
    this.updateTrainingAndGarrisons();
    // building indices, ascending, for acquire's fallback scan (a few dozen against thousands of units)
    this.buildings.length = 0;
    for (let j = 0; j < E.hi; j++) if (E.alive[j] && E.cat[j] === CAT.building) this.buildings.push(j);
    this.buildTribeGrid();
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      if (E.cd[i] > 0) E.cd[i]--;
      if (E.trance[i] > 0) {
        E.trance[i]--;
        continue;
      }
      const tr = E.tribe[i];
      const ty = E.type[i];
      const k = this.kind[ty];
      if (tr < 0 || k === KIND.none || E.ktick[i] > 0 || !w.tribes[tr]?.alive) continue;
      const inTower = E.inside[i] >= 0 && E.task[i] === TASK.garrison;
      if (E.inside[i] >= 0 && !inTower) continue;
      if (E.chant[i] > 0) {
        this.channel(i);
        continue;
      }
      if (units[ty].isCaster && (w.tribes[tr].casting || w.tribes[tr].pending)) continue;
      let t = E.index(E.atk[i]);
      if (t >= 0 && !this.validTarget(i, t)) t = -1;
      const stance = E.stance[i];
      // leash: guards return once a chase drags them too far from where they stood (and do not
      // pick a new fight on the way back)
      if (E.mode[i] === CMODE.guard) {
        const leash = stance === STANCE.defensive ? cb.defensiveLeashRadius : cb.leashRadius;
        if (this.dist(i, E.ax[i], E.ay[i]) > leash) {
          this.disengage(i, inTower);
          continue;
        }
      }
      // a chase that gave up (unreachable target) drops the target
      if (t >= 0 && E.order[i] === ORDER.none && E.stuck[i] >= giveUp) {
        E.stuck[i] = 0;
        t = -1;
      }
      // engaged units re-acquire at once when their target is lost; idle and marching ones every idleScan ticks
      const engaged = E.atk[i] !== NO_ENTITY || E.mode[i] !== CMODE.none;
      if (E.mode[i] !== CMODE.forced && ((t < 0 && (engaged || (w.tick + i) % idleScan === 0)) || (w.tick + i) % retarget === 0)) {
        const attackMoving = E.order[i] === ORDER.attackMove || E.mode[i] === CMODE.attackMove;
        const idle = E.order[i] === ORDER.none || E.mode[i] === CMODE.guard;
        let r = -1;
        if (inTower) r = this.reach[ty] + (w.cfg.pack.buildings.buildings[E.type[E.inside[i]]].rangeBonus ?? 0);
        else if (attackMoving || (idle && stance === STANCE.aggressive)) r = cb.acquireRadius;
        else if (idle && stance === STANCE.defensive) r = cb.defensiveAcquireRadius;
        if (r > 0) {
          const nt = this.acquire(i, r);
          if (nt >= 0 && nt !== t) {
            if (E.mode[i] === CMODE.none) {
              if (E.order[i] === ORDER.attackMove) {
                E.mode[i] = CMODE.attackMove;
                E.ax[i] = E.gx[i];
                E.ay[i] = E.gy[i];
              } else {
                E.mode[i] = CMODE.guard;
                E.ax[i] = E.x[i];
                E.ay[i] = E.y[i];
              }
            }
            E.stuck[i] = 0;
            E.best[i] = 1e9;
          }
          if (nt >= 0) t = nt;
        }
      }
      if (t < 0) {
        if (E.atk[i] !== NO_ENTITY || E.mode[i] !== CMODE.none) this.disengage(i, inTower);
        continue;
      }
      E.atk[i] = E.idOf(t);
      const d = this.dist(i, E.x[t], E.y[t]);
      if (E.cat[t] === CAT.unit && d < this.minRange[ty]) {
        // pinned: too close to fire; look for something farther, else stand helpless
        const alt = (w.tick + i) % retarget === 0 ? this.acquire(i, this.reach[ty]) : -1;
        if (alt >= 0) E.atk[i] = E.idOf(alt);
        if (E.order[i] !== ORDER.none) w.units.stop(i);
        continue;
      }
      if (d <= this.reachOf(i, t)) {
        if (E.order[i] !== ORDER.none) w.units.stop(i);
        if (E.cd[i] === 0) this.strike(i, t);
      } else if (!inTower) {
        // a fresh path only when the target is still on our landmass (terrain can split it mid-chase)
        if (E.order[i] === ORDER.none && !this.canReach(i, t, d)) this.disengage(i, false);
        else this.chase(i, E.x[t], E.y[t], E.mode[i] === CMODE.attackMove ? ORDER.attackMove : ORDER.move);
      }
      else if (E.mode[i] !== CMODE.forced) E.atk[i] = NO_ENTITY;
    }
  }

  /** Target lost: attack-movers resume toward their goal, guards walk back to their anchor. */
  private disengage(i: number, inTower: boolean): void {
    const w = this.w;
    const E = w.ents;
    const mode = E.mode[i];
    E.atk[i] = NO_ENTITY;
    E.mode[i] = CMODE.none;
    if (inTower) return;
    if (mode === CMODE.attackMove) w.units.order([i], E.ax[i], E.ay[i], ORDER.attackMove);
    else if (mode === CMODE.guard && this.dist(i, E.ax[i], E.ay[i]) > 1.5) w.units.order([i], E.ax[i], E.ay[i], ORDER.move);
    else if (mode === CMODE.forced && E.order[i] !== ORDER.none) w.units.stop(i);
  }

  /** One swing, shot or chant start against target t. */
  private strike(i: number, t: number): void {
    const w = this.w;
    const E = w.ents;
    const n = w.terrain.size;
    const cb = w.cfg.pack.balance.combat;
    const ty = E.type[i];
    const tr = E.tribe[i];
    const k = this.kind[ty];
    E.cd[i] = this.cool[ty];
    // attacking (a swing, a shot or a chant) reveals a veiled unit
    E.veil[i] = 0;
    if (k === KIND.melee) {
      const dmg = this.hit[ty] * (E.cat[t] === CAT.building ? cb.buildingDamageFactor : 1);
      w.emit("melee", { id: E.idOf(i), tribe: tr, kind: ty, x: E.x[t], y: E.y[t] });
      w.damage(t, dmg, tr, true, true);
      return;
    }
    if (k === KIND.chanter) {
      E.chant[i] = this.chantTicks;
      E.cd[i] = 0;
      w.emit("chantBegun", { id: E.idOf(i), tribe: tr, x: E.x[i], y: E.y[i] });
      this.channel(i);
      return;
    }
    // ranged: an instant fireball at the target's position, area damage and knockback outward
    const rd = w.cfg.pack.units.units[ty].ranged!;
    const x = E.x[t];
    const y = E.y[t];
    const bands = this.bands(i, x, y);
    const dmg = rd.damage * (1 + (bands * cb.heightRangedBonusPctPerBand) / 100);
    w.emit("fireball", { id: E.idOf(i), tribe: tr, x, y, fx: E.x[i], fy: E.y[i], bands });
    const r2 = rd.radius * rd.radius;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.tribe[j] < 0 || E.tribe[j] === tr) continue;
      const dx = wrapDelta(E.x[j] - x, n);
      const dy = wrapDelta(E.y[j] - y, n);
      const d2 = dx * dx + dy * dy;
      if (E.cat[j] === CAT.building) {
        const h = this.halfSize(j) + rd.radius;
        if (d2 <= h * h) w.damage(j, dmg * cb.buildingDamageFactor, tr, true);
        continue;
      }
      if (E.cat[j] !== CAT.unit || E.inside[j] >= 0 || d2 > r2) continue;
      const d = Math.sqrt(d2);
      w.damage(j, dmg * (1 - cb.rangedSplashFalloff * Math.min(1, d / rd.radius)), tr, true);
      if (E.alive[j] && rd.knockback > 0 && E.ktick[j] === 0) {
        // the target itself is pushed away from the shooter
        const px = d < 1e-6 ? wrapDelta(x - E.x[i], n) : dx;
        const py = d < 1e-6 ? wrapDelta(y - E.y[i], n) : dy;
        knockUnit(w, j, px, py, rd.knockback * (1 - Math.min(1, d / rd.radius) * 0.6));
      }
    }
  }

  /** A running chant: entrance enemies in the radius; at the end convert the nearest few. */
  private channel(i: number): void {
    const w = this.w;
    const E = w.ents;
    const cv = w.cfg.pack.units.units[E.type[i]].convert!;
    const tr = E.tribe[i];
    const near = this.inRadius(i, cv.radius);
    for (const j of near) if (cv.entrancedFreeze) E.trance[j] = Math.max(E.trance[j], 2);
    E.chant[i]--;
    if (E.chant[i] > 0) return;
    E.cd[i] = this.chantCool;
    let converted = 0;
    for (const j of near) {
      if (converted >= cv.maxPerChannel) break;
      const from = E.tribe[j];
      this.convertUnit(j, tr);
      converted++;
      w.emit("converted", { id: E.idOf(j), from, to: tr, kind: E.type[j], by: E.idOf(i) });
    }
    w.emit("chantEnded", { id: E.idOf(i), tribe: tr, converted });
  }

  /** Convertible enemy units within r of unit i, nearest first (ties by index). */
  private inRadius(i: number, r: number): number[] {
    const E = this.w.ents;
    const out: { j: number; d: number }[] = [];
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.unit || !this.validTarget(i, j)) continue;
      const d = this.dist(i, E.x[j], E.y[j]);
      if (d <= r) out.push({ j, d });
    }
    out.sort((a, b) => a.d - b.d || a.j - b.j);
    return out.map((o) => o.j);
  }

  /** A unit without a tribe becomes a wild person (elimination, a beguiled unit whose tribe is gone). */
  makeWild(i: number): void {
    const E = this.w.ents;
    const wild = this.typeWild;
    if (wild < 0) return;
    E.type[i] = wild;
    E.hp[i] = Math.min(E.hp[i], this.w.cfg.pack.units.units[wild].hp);
    E.stance[i] = this.defaultStance(wild);
  }

  /** Change a unit's side in place: drops its job, fight, chant and orders. */
  convertUnit(j: number, tribe: number): void {
    const w = this.w;
    const E = w.ents;
    E.tribe[j] = tribe;
    // a side change ends spell statuses that belong to the old side (a beguiled unit converted for good stays)
    E.beguile[j] = 0;
    E.veil[j] = 0;
    E.ward[j] = 0;
    E.atk[j] = NO_ENTITY;
    E.mode[j] = CMODE.none;
    E.chant[j] = 0;
    E.trance[j] = 0;
    E.lastHit[j] = -1;
    if (E.task[j] !== TASK.idle) {
      E.task[j] = TASK.idle;
      E.target[j] = NO_ENTITY;
      E.carry[j] = 0;
    }
    w.units.stop(j);
  }

  /** Shaper regeneration after a quiet spell (BACKLOG 54). */
  private updateShapers(): void {
    const w = this.w;
    const E = w.ents;
    const cb = w.cfg.pack.balance.combat;
    const delay = secondsToTicks(cb.shaperRegenDelaySeconds, w.cfg.tickHz);
    for (const t of w.tribes) {
      const i = E.index(t.shaper);
      if (i < 0) continue;
      const max = w.cfg.pack.units.units[E.type[i]].hp;
      if (E.hp[i] < max && w.tick - E.hitTick[i] >= delay) E.hp[i] = Math.min(max, E.hp[i] + cb.shaperRegenPerSecond / w.cfg.tickHz);
    }
  }

  // ---------------------------------------------------------------- lodges and towers
  /** Walk unit i to building b to train there or garrison it. */
  sendTo(i: number, b: number, task: number): void {
    const w = this.w;
    const E = w.ents;
    if (E.inside[i] >= 0) this.leave(i);
    this.clear(i);
    E.task[i] = task;
    E.target[i] = E.idOf(b);
    E.carry[i] = 0;
    const [dx, dy] = w.economy.doorOf(b);
    w.units.order([i], dx, dy, ORDER.move);
  }

  /** Step out of whatever building unit i is in, at its door. */
  leave(i: number): void {
    const w = this.w;
    const E = w.ents;
    const h = E.inside[i];
    if (h < 0) return;
    if (E.alive[h] && E.occupants[h] > 0) E.occupants[h]--;
    E.inside[i] = -1;
    const [dx, dy] = E.alive[h] ? w.economy.doorOf(h) : [E.x[i], E.y[i]];
    E.x[i] = dx;
    E.y[i] = dy;
    E.px[i] = dx;
    E.py[i] = dy;
    E.task[i] = TASK.idle;
    E.target[i] = NO_ENTITY;
  }

  /** Units walking to or queued at lodge b (one pass map: building index -> count). */
  queued(): Map<number, number> {
    const E = this.w.ents;
    const m = new Map<number, number>();
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const tk = E.task[i];
      if (tk !== TASK.toTrain && tk !== TASK.training && tk !== TASK.toGarrison && tk !== TASK.garrison) continue;
      const b = E.index(E.target[i]);
      if (b >= 0) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  }

  private updateTrainingAndGarrisons(): void {
    const w = this.w;
    const E = w.ents;
    const hz = w.cfg.tickHz;
    const bdefs = w.cfg.pack.buildings.buildings;
    const units = w.cfg.pack.units.units;
    const reach = w.cfg.pack.balance.economy.workRange;
    // arrivals: walkers who stopped near their lodge or tower step inside (or give up)
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] >= 0) continue;
      const tk = E.task[i];
      if (tk !== TASK.toTrain && tk !== TASK.toGarrison) continue;
      const b = E.index(E.target[i]);
      if (b < 0 || E.state[b] !== BSTATE.done || E.tribe[b] !== E.tribe[i]) {
        E.task[i] = TASK.idle;
        E.target[i] = NO_ENTITY;
        continue;
      }
      if (E.order[i] !== ORDER.none) continue;
      const room = tk === TASK.toTrain ? (bdefs[E.type[b]].queueMax ?? 5) : this.garrisonOf(E.type[b]);
      if (this.dist(i, E.x[b], E.y[b]) > reach + this.halfSize(b) + 1 || E.occupants[b] >= room) {
        E.task[i] = TASK.idle;
        E.target[i] = NO_ENTITY;
        continue;
      }
      E.inside[i] = b;
      E.occupants[b]++;
      E.task[i] = tk === TASK.toTrain ? TASK.training : TASK.garrison;
      E.timer[i] = w.tick;
      E.x[i] = E.x[b];
      E.y[i] = E.y[b];
      E.px[i] = E.x[b];
      E.py[i] = E.y[b];
      w.emit(tk === TASK.toTrain ? "enteredLodge" : "garrisoned", { id: E.idOf(i), tribe: E.tribe[i], building: E.idOf(b) });
    }
    // lodges: one trainee at a time in arrival order; pay from the training sink, then train
    const unpaid = new Float64Array(w.tribes.length);
    const queued = this.queued();
    for (let b = 0; b < E.hi; b++) {
      if (!E.alive[b] || E.cat[b] !== CAT.building || E.state[b] !== BSTATE.done) continue;
      const into = this.trains[E.type[b]];
      const tr = E.tribe[b];
      if (into < 0 || tr < 0 || !w.tribes[tr]?.alive) continue;
      const cost = units[into].trainMana ?? 0;
      let cur = E.index(E.target[b]);
      if (cur >= 0 && (E.inside[cur] !== b || E.task[cur] !== TASK.training)) cur = -1;
      if (cur < 0) {
        E.target[b] = NO_ENTITY;
        E.cd[b] = 0;
        E.progress[b] = 0;
        let pick = -1;
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.inside[i] === b && E.task[i] === TASK.training && (pick < 0 || E.timer[i] < E.timer[pick])) pick = i;
        if (pick >= 0) {
          cur = pick;
          E.target[b] = E.idOf(pick);
        }
      }
      const waiting = (queued.get(b) ?? 0) - (cur >= 0 ? 1 : 0);
      unpaid[tr] += waiting * cost;
      if (cur < 0) continue;
      const eco = w.tribes[tr].eco;
      if (E.cd[b] === 0) {
        if (eco.trainMana + 1e-9 >= cost) {
          eco.trainMana = Math.max(0, eco.trainMana - cost);
          E.cd[b] = 1;
        } else {
          unpaid[tr] += cost;
          continue;
        }
      }
      E.progress[b] += 1 / Math.max(1, secondsToTicks(units[into].trainSeconds ?? 10, hz));
      if (E.progress[b] < 1 - 1e-9) continue;
      // graduate: the settler walks out as a troop
      E.progress[b] = 0;
      E.cd[b] = 0;
      E.target[b] = NO_ENTITY;
      this.leave(cur);
      E.type[cur] = into;
      E.hp[cur] = units[into].hp;
      E.stance[cur] = this.defaultStance(into);
      E.carry[cur] = 0;
      E.atk[cur] = NO_ENTITY;
      E.mode[cur] = CMODE.none;
      E.cd[cur] = 0;
      w.emit("trained", { id: E.idOf(cur), tribe: tr, kind: into, lodge: E.idOf(b) });
      if (E.mode[b] === 1) w.units.order([cur], E.ax[b], E.ay[b], ORDER.move);
    }
    for (const t of w.tribes) t.eco.trainDemand = t.alive ? Math.max(0, unpaid[t.index] - t.eco.trainMana) : 0;
  }

  /** Nearest own finished tower with a free slot (counting walkers already headed there), or -1. */
  nearestTower(i: number, inbound: Map<number, number>): number {
    const E = this.w.ents;
    let best = -1;
    let bd = Infinity;
    for (let b = 0; b < E.hi; b++) {
      if (!E.alive[b] || E.cat[b] !== CAT.building || E.tribe[b] !== E.tribe[i] || E.state[b] !== BSTATE.done) continue;
      const slots = this.garrisonOf(E.type[b]);
      if (slots <= 0 || (inbound.get(b) ?? 0) >= slots) continue;
      const d = this.dist(i, E.x[b], E.y[b]);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  /** Elimination aftermath: the tribe's people walk out of every building and become wild. */
  releaseTribe(tribe: number): void {
    const w = this.w;
    const E = w.ents;
    const wild = this.typeWild;
    let released = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== tribe) continue;
      if (E.inside[i] >= 0) this.leave(i);
      this.convertUnit(i, -1);
      if (wild >= 0) this.makeWild(i);
      released++;
    }
    w.tribes[tribe].eco.trainDemand = 0;
    w.emit("tribeReleased", { tribe, units: released });
  }
}

// ---------------------------------------------------------------- commands
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]);

/** Selected units, all owned by the commanding tribe (tribe -1 is god mode), or an error string. */
function ownUnits(w: World, c: Command): number[] | string {
  const idx = w.selectUnits(c.args.units);
  if (!idx.length) return "no units selected";
  if (c.tribe !== -1 && idx.some((i) => w.ents.tribe[i] !== c.tribe)) return "units belong to another tribe";
  return idx;
}

/** An own finished building by id, or an error string. */
function ownBuilding(w: World, c: Command, field = "building"): number | string {
  const b = w.resolveEntity(c.args[field]);
  if (b < 0 || w.ents.cat[b] !== CAT.building) return "no such building";
  if (c.tribe !== -1 && w.ents.tribe[b] !== c.tribe) return "not your building";
  if (w.ents.state[b] !== BSTATE.done) return "building not finished";
  return b;
}

/** Attack an enemy unit or building: args {units, target: id}. Chases until the target is gone. */
registerCommand("attack", {
  validate(w, c) {
    const idx = ownUnits(w, c);
    if (typeof idx === "string") return idx;
    const t = w.resolveEntity(c.args.target);
    if (t < 0 || (w.ents.cat[t] !== CAT.unit && w.ents.cat[t] !== CAT.building)) return "no such target";
    if (w.ents.tribe[t] < 0 || w.ents.tribe[t] === w.ents.tribe[idx[0]]) return "target is not an enemy";
    return null;
  },
  apply(w, c) {
    const E = w.ents;
    const t = w.resolveEntity(c.args.target);
    for (const i of w.selectUnits(c.args.units)) {
      for (const tr of w.tribes) if (tr.pending && E.index(tr.shaper) === i) tr.pending = null;
      w.combat.clear(i);
      if (E.inside[i] >= 0 && E.task[i] !== TASK.garrison) w.combat.leave(i);
      E.atk[i] = E.idOf(t);
      E.mode[i] = CMODE.forced;
      E.stuck[i] = 0;
      E.best[i] = 1e9;
    }
  },
});

/** Stance for units: args {units, stance: "aggressive" | "defensive" | "passive"}. */
registerCommand("setStance", {
  validate(w, c) {
    const idx = ownUnits(w, c);
    if (typeof idx === "string") return idx;
    return STANCE_NAMES.includes(c.args.stance as never) ? null : "stance must be aggressive, defensive or passive";
  },
  apply(w, c) {
    const s = STANCE[c.args.stance as keyof typeof STANCE];
    for (const i of w.selectUnits(c.args.units)) w.ents.stance[i] = s;
  },
});

/**
 * Train settlers at a lodge: args {building: id, units?: settler ids, count?: n}. Without units the
 * nearest free settlers go (outside first, then housed ones, keeping one per dwelling to breed). The
 * lodge queue holds queueMax walkers and trainees.
 */
registerCommand("train", {
  validate(w, c) {
    const b = ownBuilding(w, c);
    if (typeof b === "string") return b;
    if (w.combat.trainsAt(w.ents.type[b]) < 0) return "this building does not train";
    const room = (w.cfg.pack.buildings.buildings[w.ents.type[b]].queueMax ?? 5) - (w.combat.queued().get(b) ?? 0);
    if (room <= 0) return "training queue full";
    if (c.args.units !== undefined) {
      const idx = ownUnits(w, c);
      if (typeof idx === "string") return idx;
      if (idx.some((i) => w.ents.type[i] !== w.economy.typeSettler)) return "only settlers can train";
    } else if (!finite(c.args.count) || (c.args.count as number) < 1) return "train needs units or count >= 1";
    return null;
  },
  apply(w, c) {
    const E = w.ents;
    const b = w.resolveEntity(c.args.building);
    const room = (w.cfg.pack.buildings.buildings[E.type[b]].queueMax ?? 5) - (w.combat.queued().get(b) ?? 0);
    let pick: number[];
    if (c.args.units !== undefined) pick = w.selectUnits(c.args.units);
    else {
      const free: { i: number; d: number; housed: number }[] = [];
      const n = w.terrain.size;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== E.tribe[b] || E.type[i] !== w.economy.typeSettler || E.mode[i] !== CMODE.none) continue;
        const tk = E.task[i];
        let housed = 0;
        if (tk === TASK.home) {
          if (E.occupants[E.inside[i]] <= 1) continue;
          housed = 1;
        } else if (tk !== TASK.idle && tk !== TASK.wander && tk !== TASK.toTree && tk !== TASK.toWork && tk !== TASK.work && tk !== TASK.toHome) continue;
        const dx = wrapDelta(E.x[i] - E.x[b], n);
        const dy = wrapDelta(E.y[i] - E.y[b], n);
        free.push({ i, d: dx * dx + dy * dy, housed });
      }
      free.sort((a, z) => a.housed - z.housed || a.d - z.d || a.i - z.i);
      pick = free.slice(0, Math.floor(c.args.count as number)).map((f) => f.i);
    }
    for (const i of pick.slice(0, room)) w.combat.sendTo(i, b, TASK.toTrain);
    w.emit("trainOrdered", { tribe: E.tribe[b], lodge: E.idOf(b), n: Math.min(room, pick.length) });
  },
});

/** Rally point for a lodge's graduates: args {building: id, at: [x, y] | null}. */
registerCommand("setRally", {
  validate(w, c) {
    const b = ownBuilding(w, c);
    if (typeof b === "string") return b;
    if (w.combat.trainsAt(w.ents.type[b]) < 0) return "only lodges have rally points";
    return c.args.at === null || isPoint(c.args.at) ? null : "setRally needs at: [x, y] or null";
  },
  apply(w, c) {
    const E = w.ents;
    const b = w.resolveEntity(c.args.building);
    if (c.args.at === null) {
      E.mode[b] = 0;
      return;
    }
    const n = w.terrain.size;
    const [x, y] = c.args.at as [number, number];
    E.mode[b] = 1;
    E.ax[b] = ((x % n) + n) % n;
    E.ay[b] = ((y % n) + n) % n;
  },
});

/** Garrison units in a Watchtower: args {units, building: id}. Units beyond the free slots stay out. */
registerCommand("garrison", {
  validate(w, c) {
    const idx = ownUnits(w, c);
    if (typeof idx === "string") return idx;
    const b = ownBuilding(w, c);
    if (typeof b === "string") return b;
    if (w.combat.garrisonOf(w.ents.type[b]) <= 0) return "this building has no garrison";
    if (idx.some((i) => w.cfg.pack.units.units[w.ents.type[i]].isCaster)) return "the Shaper cannot garrison";
    return null;
  },
  apply(w, c) {
    const b = w.resolveEntity(c.args.building);
    let room = w.combat.garrisonOf(w.ents.type[b]) - (w.combat.queued().get(b) ?? 0);
    for (const i of w.selectUnits(c.args.units)) {
      if (room <= 0) break;
      if (w.ents.inside[i] === b) continue;
      room--;
      w.combat.sendTo(i, b, TASK.toGarrison);
    }
  },
});

/** Empty a Watchtower: args {building: id}. */
registerCommand("ungarrison", {
  validate(w, c) {
    const b = ownBuilding(w, c);
    if (typeof b === "string") return b;
    return w.ents.occupants[b] > 0 ? null : "nobody inside";
  },
  apply(w, c) {
    const E = w.ents;
    const b = w.resolveEntity(c.args.building);
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.inside[i] === b && E.task[i] === TASK.garrison) w.combat.leave(i);
  },
});

/** Retreat: each unit runs to the nearest own Watchtower with room, else to the Hearth. args {units}. */
registerCommand("retreat", {
  validate(w, c) {
    const idx = ownUnits(w, c);
    return typeof idx === "string" ? idx : null;
  },
  apply(w, c) {
    const E = w.ents;
    const inbound = w.combat.queued();
    for (const i of w.selectUnits(c.args.units)) {
      if (E.inside[i] >= 0) continue;
      const tower = w.cfg.pack.units.units[E.type[i]].isCaster ? -1 : w.combat.nearestTower(i, inbound);
      if (tower >= 0) {
        inbound.set(tower, (inbound.get(tower) ?? 0) + 1);
        w.combat.sendTo(i, tower, TASK.toGarrison);
        continue;
      }
      w.combat.clear(i);
      const h = E.index(w.tribes[E.tribe[i]]?.hearth ?? NO_ENTITY);
      if (h >= 0) {
        const [dx, dy] = w.economy.doorOf(h);
        w.units.order([i], dx, dy, ORDER.move);
      }
    }
  },
});

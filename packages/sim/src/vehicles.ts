// Vehicles (BACKLOG 10, ADR-016): boats sail on water, balloons float over everything. A vehicle is a unit
// whose type has a `vehicle` def. Riders sit inside it (inside = the vehicle's index, task ride): they are
// safe aboard, take no orders of their own and follow the vehicle. Boarding: a walker with task toBoard steps
// in once it comes within boardRadius. Unloading: a vehicle with task unload sails to its goal, then drops
// its riders on the nearest land. A lost vehicle spills its riders where it was (deep water drowns them).
// Buildings with `makes` keep their tribe stocked with vehicles. All state lives in entity columns, so
// snapshots and hashes need nothing extra.
import { CAT, NO_ENTITY } from "./entities.ts";
import { BSTATE, SHORE_REACH, TASK } from "./economy.ts";
import { NAV, ORDER } from "./units.ts";
import { secondsToTicks } from "./config.ts";
import type { World } from "./world.ts";
import { registerCommand } from "./commands.ts";

interface VehicleDef {
  nav: "water" | "air";
  capacity: number;
  boardRadius: number;
  fireFrom?: string[];
  rangeBonus?: number;
}

/** a walker re-aims at its moving vehicle this often (ticks) and gives up after this many tries */
const BOARD_RETRY_TICKS = 20;
const BOARD_TRIES = 4;

export class VehicleSystem {
  private readonly w: World;
  /** vehicle def per unit type (null for walkers) */
  readonly def: (VehicleDef | null)[];
  /** per unit type: the unit types allowed to fight from aboard (balloon Firecallers) */
  private readonly fireFrom: Set<number>[];
  /** per building type: what it makes, or null */
  private readonly makes: ({ unit: number; max: number; ticks: number } | null)[];
  private readonly anyMaker: boolean;

  constructor(w: World) {
    this.w = w;
    const units = w.cfg.pack.units.units;
    this.def = units.map((u) => u.vehicle ?? null);
    this.fireFrom = units.map((u) => new Set((u.vehicle?.fireFrom ?? []).map((id) => w.cfg.unitIndex.get(id) ?? -1)));
    this.makes = w.cfg.pack.buildings.buildings.map((b) =>
      b.makes && w.cfg.unitIndex.has(b.makes.unit) ? { unit: w.cfg.unitIndex.get(b.makes.unit)!, max: b.makes.max, ticks: secondsToTicks(b.makes.seconds, w.cfg.tickHz) } : null,
    );
    this.anyMaker = this.makes.some((m) => m !== null);
  }

  isVehicle(i: number): boolean {
    const E = this.w.ents;
    return E.cat[i] === CAT.unit && this.def[E.type[i]] !== null;
  }

  isVehicleType(type: number): boolean {
    return this.def[type] !== null;
  }

  capacityOf(i: number): number {
    return this.def[this.w.ents.type[i]]?.capacity ?? 0;
  }

  /** Whether rider i may fight from the vehicle it is in, and the vehicle's range bonus. */
  firesFrom(i: number): number | null {
    const E = this.w.ents;
    const v = E.inside[i];
    if (v < 0 || E.task[i] !== TASK.ride || !E.alive[v]) return null;
    const d = this.def[E.type[v]];
    return d && this.fireFrom[E.type[v]].has(E.type[i]) ? (d.rangeBonus ?? 0) : null;
  }

  private dist(i: number, j: number): number {
    const E = this.w.ents;
    const n = this.w.terrain.size;
    const dx = wrapD(E.x[i] - E.x[j], n);
    const dy = wrapD(E.y[i] - E.y[j], n);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private vertexOf(x: number, y: number): number {
    const n = this.w.terrain.size;
    return (((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n;
  }

  /** Boarding reach of vehicle v (cells). */
  boardRadiusOf(v: number): number {
    return this.w.cfg.pack.units.units[this.w.ents.type[v]].vehicle?.boardRadius ?? 0;
  }

  /** Unit i is walking to a vehicle to board it (its goal moves while the vehicle comes to meet it). */
  isBoarding(i: number): boolean {
    return this.w.ents.task[i] === TASK.toBoard;
  }

  /** Walk unit i to vehicle v and board it (the board command). */
  board(i: number, v: number): void {
    const w = this.w;
    const E = w.ents;
    if (E.inside[i] >= 0) w.combat.leave(i);
    w.combat.clear(i);
    E.task[i] = TASK.toBoard;
    E.target[i] = E.idOf(v);
    E.timer[i] = 0;
    w.units.order([i], E.x[v], E.y[v], ORDER.move);
  }

  /** An idle vehicle comes to meet its boarders: it heads for their middle (a boat stops at the nearest water). */
  meet(v: number, walkers: readonly number[]): void {
    const w = this.w;
    const E = w.ents;
    if (!walkers.length || E.order[v] !== ORDER.none || E.task[v] !== TASK.idle) return;
    const n = w.terrain.size;
    let sx = 0;
    let sy = 0;
    for (const i of walkers) {
      sx += wrapD(E.x[i] - E.x[v], n);
      sy += wrapD(E.y[i] - E.y[v], n);
    }
    const mx = E.x[v] + sx / walkers.length;
    const my = E.y[v] + sy / walkers.length;
    w.units.order([v], (((mx % n) + n) % n), (((my % n) + n) % n), ORDER.move);
  }

  /** Sail vehicle v to (x, y) and unload there; without a point, unload where it is. */
  unload(v: number, x?: number, y?: number): void {
    const w = this.w;
    const E = w.ents;
    w.combat.clear(v);
    if (x === undefined || y === undefined) {
      E.task[v] = TASK.idle;
      w.units.stop(v);
      this.disembark(v, true);
      return;
    }
    E.task[v] = TASK.unload;
    w.units.order([v], x, y, ORDER.move);
  }

  /** Drop v's riders on the nearest land; returns how many stepped off (0 when there is no shore near). */
  disembark(v: number, report: boolean): number {
    const w = this.w;
    const E = w.ents;
    if (E.occupants[v] === 0) return 0;
    const d = this.def[E.type[v]];
    const land = w.units.pfs[NAV.land];
    land.refresh();
    const n = w.terrain.size;
    const lv = land.nearestWalkable(this.vertexOf(E.x[v], E.y[v]), Math.ceil((d?.boardRadius ?? 2) + 2));
    if (lv < 0) {
      if (report) w.emit("orderFailed", { id: E.idOf(v), reason: "no shore to unload", tribe: E.tribe[v], x: E.x[v], y: E.y[v] });
      return 0;
    }
    const lx = lv % n;
    const ly = (lv - lx) / n;
    let k = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] !== v) continue;
      E.inside[i] = -1;
      E.task[i] = TASK.idle;
      E.target[i] = NO_ENTITY;
      // a small fan around the landing vertex; separation spreads them the rest of the way
      E.x[i] = lx + (k % 3) * 0.2 - 0.2;
      E.y[i] = ly + Math.floor(k / 3) * 0.2 - 0.1;
      E.px[i] = E.x[i];
      E.py[i] = E.y[i];
      k++;
    }
    E.occupants[v] = 0;
    w.emit("unloaded", { id: E.idOf(v), tribe: E.tribe[v], n: k, x: lx, y: ly });
    return k;
  }

  /** A vehicle is lost: its riders step out where it was (World.kill drowns them in deep water). */
  spill(v: number): number[] {
    const E = this.w.ents;
    const out: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] !== v || i === v) continue;
      E.inside[i] = -1;
      E.task[i] = TASK.idle;
      E.target[i] = NO_ENTITY;
      E.x[i] = E.x[v];
      E.y[i] = E.y[v];
      E.px[i] = E.x[i];
      E.py[i] = E.y[i];
      out.push(i);
    }
    E.occupants[v] = 0;
    return out;
  }

  /** Step 5b: riders follow, walkers board, vehicles unload, buildings make vehicles. */
  update(): void {
    const w = this.w;
    const E = w.ents;
    // riders ride along; walkers heading for a vehicle step in when close
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const tk = E.task[i];
      if (tk === TASK.ride) {
        const v = E.inside[i];
        if (v < 0 || !E.alive[v]) {
          E.task[i] = TASK.idle;
          continue;
        }
        E.px[i] = E.x[i];
        E.py[i] = E.y[i];
        E.x[i] = E.x[v];
        E.y[i] = E.y[v];
        continue;
      }
      if (tk !== TASK.toBoard) continue;
      const v = E.index(E.target[i]);
      const d = v >= 0 ? this.def[E.type[v]] : null;
      if (v < 0 || !d || E.tribe[v] !== E.tribe[i] || E.occupants[v] >= d.capacity) {
        E.task[i] = TASK.idle;
        E.target[i] = NO_ENTITY;
        continue;
      }
      if (this.dist(i, v) <= d.boardRadius) {
        w.units.stop(i);
        w.combat.clear(i);
        E.inside[i] = v;
        E.occupants[v]++;
        E.task[i] = TASK.ride;
        E.x[i] = E.x[v];
        E.y[i] = E.y[v];
        E.px[i] = E.x[i];
        E.py[i] = E.y[i];
        w.emit("boarded", { id: E.idOf(i), tribe: E.tribe[i], vehicle: E.idOf(v) });
        continue;
      }
      // the vehicle moved, or the walk ended short of it: re-aim a few times, then give up
      if ((w.tick + i) % BOARD_RETRY_TICKS !== 0) continue;
      const n = w.terrain.size;
      const gx = wrapD(E.gx[i] - E.x[v], n);
      const gy = wrapD(E.gy[i] - E.y[v], n);
      if (E.order[i] === ORDER.none || gx * gx + gy * gy > 4) {
        if (++E.timer[i] > BOARD_TRIES) {
          E.task[i] = TASK.idle;
          E.target[i] = NO_ENTITY;
          w.units.stop(i);
          w.emit("orderFailed", { id: E.idOf(i), reason: "could not reach the vehicle", tribe: E.tribe[i], x: E.x[v], y: E.y[v] });
          continue;
        }
        w.units.order([i], E.x[v], E.y[v], ORDER.move);
      }
    }
    // vehicles that reached (or failed to reach) their unload point drop their riders
    for (let v = 0; v < E.hi; v++) {
      if (!E.alive[v] || E.cat[v] !== CAT.unit || E.task[v] !== TASK.unload || E.order[v] !== ORDER.none) continue;
      E.task[v] = TASK.idle;
      this.disembark(v, true);
    }
    if (this.anyMaker) this.make();
  }

  /** Finished makers count up; at the mark a tribe under its stock (max per maker) gets one more vehicle. */
  private make(): void {
    const w = this.w;
    const E = w.ents;
    let due = false;
    for (let b = 0; b < E.hi; b++) {
      if (!E.alive[b] || E.cat[b] !== CAT.building || E.state[b] !== BSTATE.done || E.tribe[b] < 0) continue;
      const mk = this.makes[E.type[b]];
      if (!mk) continue;
      if (E.timer[b] < mk.ticks) E.timer[b]++;
      if (E.timer[b] >= mk.ticks) due = true;
    }
    if (!due) return;
    // stock per (tribe, vehicle type): living vehicles against max times the finished makers
    const have = new Map<number, number>();
    const cap = new Map<number, number>();
    const key = (tribe: number, type: number) => tribe * 4096 + type;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.tribe[i] < 0) continue;
      if (E.cat[i] === CAT.unit && this.def[E.type[i]]) have.set(key(E.tribe[i], E.type[i]), (have.get(key(E.tribe[i], E.type[i])) ?? 0) + 1);
      const mk = E.cat[i] === CAT.building && E.state[i] === BSTATE.done ? this.makes[E.type[i]] : null;
      if (mk) cap.set(key(E.tribe[i], mk.unit), (cap.get(key(E.tribe[i], mk.unit)) ?? 0) + mk.max);
    }
    const n = w.terrain.size;
    for (let b = 0; b < E.hi; b++) {
      if (!E.alive[b] || E.cat[b] !== CAT.building || E.state[b] !== BSTATE.done || E.tribe[b] < 0) continue;
      const mk = this.makes[E.type[b]];
      if (!mk || E.timer[b] < mk.ticks) continue;
      const k = key(E.tribe[b], mk.unit);
      if ((have.get(k) ?? 0) >= (cap.get(k) ?? 0)) continue;
      // a boat launches on the nearest water, a balloon at the door
      let x: number;
      let y: number;
      if (this.def[mk.unit]!.nav === "water") {
        const pf = w.units.pfs[NAV.water];
        pf.refresh();
        const fp = w.cfg.pack.buildings.buildings[E.type[b]].footprint;
        const v = pf.nearestWalkable(this.vertexOf(E.x[b], E.y[b]), Math.ceil(Math.max(fp[0], fp[1]) / 2) + SHORE_REACH);
        if (v < 0) continue;
        x = v % n;
        y = (v - x) / n;
      } else [x, y] = w.economy.doorOf(b);
      E.timer[b] = 0;
      have.set(k, (have.get(k) ?? 0) + 1);
      const id = w.spawnUnit(w.cfg.pack.units.units[mk.unit].id, E.tribe[b], x, y);
      w.emit("vehicleMade", { id, tribe: E.tribe[b], kind: mk.unit, building: E.idOf(b), x, y });
    }
  }
}

function wrapD(d: number, n: number): number {
  if (d > n / 2) return d - n;
  if (d < -n / 2) return d + n;
  return d;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Board a vehicle: args {units, vehicle}. Walkers head for it and step in while there is room. */
registerCommand("board", {
  validate(w, c) {
    const E = w.ents;
    const idx = w.selectUnits(c.args.units);
    if (!idx.length) return "no units selected";
    const v = w.resolveEntity(c.args.vehicle);
    if (v < 0 || !w.vehicles.isVehicle(v)) return "no such vehicle";
    if (c.tribe !== -1 && (E.tribe[v] !== c.tribe || idx.some((i) => E.tribe[i] !== c.tribe))) return "units belong to another tribe";
    if (idx.some((i) => w.vehicles.isVehicle(i))) return "a vehicle cannot board another";
    if (E.occupants[v] >= w.vehicles.capacityOf(v)) return "the vehicle is full";
    return null;
  },
  apply(w, c) {
    const v = w.resolveEntity(c.args.vehicle);
    // only as many walkers as there is room for set off, lowest index first
    let room = w.vehicles.capacityOf(v) - w.ents.occupants[v];
    const going: number[] = [];
    for (const i of w.selectUnits(c.args.units)) {
      if (room <= 0) break;
      for (const t of w.tribes) if (t.pending && w.ents.index(t.shaper) === i) t.pending = null;
      w.vehicles.board(i, v);
      going.push(i);
      room--;
    }
    w.vehicles.meet(v, going);
  },
});

/** Unload vehicles: args {units: vehicles, to?: [x, y]}. With a point they sail there first. */
registerCommand("unload", {
  validate(w, c) {
    const idx = w.selectUnits(c.args.units).filter((i) => w.vehicles.isVehicle(i));
    if (!idx.length) return "no vehicles selected";
    if (c.tribe !== -1 && idx.some((i) => w.ents.tribe[i] !== c.tribe)) return "units belong to another tribe";
    const to = c.args.to;
    if (to !== undefined && !(Array.isArray(to) && to.length === 2 && finite(to[0]) && finite(to[1]))) return "unload to must be [x, y]";
    return null;
  },
  apply(w, c) {
    const n = w.terrain.size;
    const to = c.args.to as [number, number] | undefined;
    for (const v of w.selectUnits(c.args.units)) {
      if (!w.vehicles.isVehicle(v)) continue;
      if (to) w.vehicles.unload(v, (((to[0] % n) + n) % n), (((to[1] % n) + n) % n));
      else w.vehicles.unload(v);
    }
  },
});

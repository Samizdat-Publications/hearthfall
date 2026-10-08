// Unit movement system (system order steps 4 and 5): path requests under a per-tick budget, flow
// fields for group orders, waypoint following, separation via the spatial hash, terrain sliding,
// stuck detection with repath and give-up, drowning. Numbers come from balance.json `movement`.
import { CAT } from "./entities.ts";
import { Pathfinder, SpatialHash } from "./pathing.ts";
import { secondsToTicks } from "./config.ts";
import type { World } from "./world.ts";

export const ORDER = { none: 0, move: 1, attackMove: 2 } as const;

export class UnitSystem {
  readonly pf: Pathfinder;
  readonly hash: SpatialHash;
  /** waypoint vertex indices per entity index (null when following a flow field or idle) */
  paths: (Int32Array | null)[] = [];
  /** FIFO of entity ids waiting for an A* path */
  queue: number[] = [];
  private flows = new Map<number, { field: Float32Array; version: number }>();
  private lastVersion: number;
  expandedLastTick = 0;
  /** orders given since creation (metrics only, not hashed) */
  ordersIssued = 0;

  private readonly w: World;

  constructor(w: World) {
    this.w = w;
    this.pf = new Pathfinder(w.terrain);
    this.hash = new SpatialHash(w.terrain.size);
    this.lastVersion = w.terrain.version;
  }

  private vertexOf(x: number, y: number): number {
    const n = this.w.terrain.size;
    return (((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n;
  }

  /** Give a move order. Groups at or above groupFlowMinUnits share a flow field to the goal. */
  order(indices: number[], gx: number, gy: number, kind: number = ORDER.move): void {
    const E = this.w.ents;
    const m = this.w.cfg.pack.balance.movement;
    this.pf.refresh();
    const goalV = this.pf.nearestWalkable(this.vertexOf(gx, gy));
    const useFlow = indices.length >= m.groupFlowMinUnits && goalV >= 0;
    this.ordersIssued += indices.length;
    for (const i of indices) {
      E.order[i] = kind;
      E.gx[i] = gx;
      E.gy[i] = gy;
      E.stuck[i] = 0;
      E.best[i] = 1e9;
      E.pathPos[i] = 0;
      this.paths[i] = null;
      E.flowGoal[i] = useFlow ? goalV : -1;
      E.waitPath[i] = useFlow ? 0 : 1;
      if (!useFlow) this.queue.push(E.idOf(i));
    }
  }

  stop(i: number): void {
    const E = this.w.ents;
    E.order[i] = ORDER.none;
    E.flowGoal[i] = -1;
    E.waitPath[i] = 0;
    this.paths[i] = null;
    E.vx[i] = 0;
    E.vy[i] = 0;
  }

  private flowFor(goal: number): Float32Array {
    const t = this.w.terrain;
    const f = this.flows.get(goal);
    if (f && f.version === t.version) return f.field;
    const field = this.pf.flowField(goal);
    this.flows.set(goal, { field, version: t.version });
    return field;
  }

  /** Steps 4 and 5 of the tick. */
  update(): void {
    const w = this.w;
    const E = w.ents;
    const t = w.terrain;
    const n = t.size;
    const m = w.cfg.pack.balance.movement;
    const hz = w.cfg.tickHz;
    this.pf.refresh();
    // terrain changed: every A* follower repaths, flow fields are rebuilt lazily
    if (t.version !== this.lastVersion) {
      this.lastVersion = t.version;
      this.flows.clear();
      for (let i = 0; i < E.hi; i++) {
        if (E.alive[i] && E.cat[i] === CAT.unit && E.order[i] !== ORDER.none && E.flowGoal[i] < 0 && !E.waitPath[i]) {
          E.waitPath[i] = 1;
          this.queue.push(E.idOf(i));
        }
      }
    }
    // 4. path requests within the budget, FIFO
    let budget = m.pathBudgetPerTick;
    let expanded = 0;
    while (this.queue.length && budget > 0) {
      const id = this.queue.shift()!;
      const i = E.index(id);
      if (i < 0 || E.order[i] === ORDER.none || !E.waitPath[i]) continue;
      const start = this.pf.nearestWalkable(this.vertexOf(E.x[i], E.y[i]));
      const goal = this.pf.nearestWalkable(this.vertexOf(E.gx[i], E.gy[i]));
      E.waitPath[i] = 0;
      if (start < 0 || goal < 0) {
        w.emit("orderFailed", { id, reason: "no walkable start or goal" });
        this.stop(i);
        continue;
      }
      const r = this.pf.astar(start, goal, m.maxExpandPerSearch);
      budget -= r.expanded + 1;
      expanded += r.expanded;
      if (!r.ok) {
        w.emit("orderFailed", { id, reason: r.expanded > m.maxExpandPerSearch ? "search limit" : "unreachable" });
        this.stop(i);
        continue;
      }
      this.paths[i] = r.waypoints;
      E.pathPos[i] = 0;
    }
    this.expandedLastTick = expanded;
    // 5. movement
    this.hash.rebuild(E.hi, (i) => E.alive[i] === 1 && E.cat[i] === CAT.unit, E.x, E.y);
    const sepR = m.separationRadius;
    const sepR2 = sepR * sepR;
    const repath = secondsToTicks(m.repathSeconds, hz);
    const giveUp = secondsToTicks(m.giveUpSeconds, hz);
    const units = w.cfg.pack.units.units;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      E.px[i] = E.x[i];
      E.py[i] = E.y[i];
      let dx = 0;
      let dy = 0;
      if (E.order[i] !== ORDER.none && !E.waitPath[i]) {
        const speed = units[E.type[i]].speed / hz;
        let tx = E.gx[i];
        let ty = E.gy[i];
        /** remaining route length, the progress measure for stuck detection */
        let route = -1;
        const fg = E.flowGoal[i];
        if (fg >= 0) {
          const field = this.flowFor(fg);
          const v = this.vertexOf(E.x[i], E.y[i]);
          const vx = v % n;
          const vy = (v - vx) / n;
          let best = field[v];
          let bx = vx;
          let by = vy;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const j = ((vx + ox + n) % n) + ((vy + oy + n) % n) * n;
              if (field[j] < best) {
                best = field[j];
                bx = vx + ox;
                by = vy + oy;
              }
            }
          }
          if (field[v] === Infinity && best === Infinity) {
            w.emit("orderFailed", { id: E.idOf(i), reason: "flow unreachable" });
            this.stop(i);
            continue;
          }
          route = field[v];
          if (best > 2) {
            tx = bx;
            ty = by;
          }
        } else {
          const p = this.paths[i];
          if (p && E.pathPos[i] < p.length) {
            // advance when close, or when the next waypoint is already in clear line of sight
            for (;;) {
              const wv = p[E.pathPos[i]];
              const ddx = wrapD((wv % n) - E.x[i], n);
              const ddy = wrapD((wv - (wv % n)) / n - E.y[i], n);
              const d2 = ddx * ddx + ddy * ddy;
              if (E.pathPos[i] >= p.length - 1) break;
              const close = d2 < m.waypointRadius * m.waypointRadius;
              const sees = d2 < 9 && this.pf.lineWalkable(this.vertexOf(E.x[i], E.y[i]), p[E.pathPos[i] + 1]);
              if (!close && !sees) break;
              E.pathPos[i]++;
            }
            const wv = p[E.pathPos[i]];
            tx = wv % n;
            ty = (wv - (wv % n)) / n;
            const rx = wrapD(tx - E.x[i], n);
            const ry = wrapD(ty - E.y[i], n);
            route = Math.sqrt(rx * rx + ry * ry);
            for (let k = E.pathPos[i] + 1; k < p.length; k++) {
              const a = p[k - 1];
              const b = p[k];
              const lx = wrapD((b % n) - (a % n), n);
              const ly = wrapD((b - (b % n)) / n - (a - (a % n)) / n, n);
              route += Math.sqrt(lx * lx + ly * ly);
            }
          }
        }
        const gdx = wrapD(E.gx[i] - E.x[i], n);
        const gdy = wrapD(E.gy[i] - E.y[i], n);
        const gd = Math.sqrt(gdx * gdx + gdy * gdy);
        if (gd < m.arriveRadius || (gd < m.crowdArriveRadius && E.stuck[i] > hz)) {
          this.stop(i);
        } else {
          const sx = wrapD(tx - E.x[i], n);
          const sy = wrapD(ty - E.y[i], n);
          const sd = Math.sqrt(sx * sx + sy * sy);
          if (sd > 1e-9) {
            const s = Math.min(speed, sd);
            dx = (sx / sd) * s;
            dy = (sy / sd) * s;
          }
          // stuck bookkeeping: progress along the route (falls back to straight distance)
          const prog = route >= 0 ? route : gd;
          if (prog < E.best[i] - 0.05) {
            E.best[i] = prog;
            E.stuck[i] = 0;
          } else {
            E.stuck[i]++;
            if (E.stuck[i] >= giveUp) {
              w.emit("orderGaveUp", { id: E.idOf(i) });
              this.stop(i);
            } else if (E.stuck[i] % repath === 0 && E.flowGoal[i] < 0) {
              E.waitPath[i] = 1;
              this.queue.push(E.idOf(i));
            }
          }
        }
      }
      // separation from neighbors
      let sx = 0;
      let sy = 0;
      const xi = E.x[i];
      const yi = E.y[i];
      // inline 3x3 bucket scan (no closure: this loop runs for every unit every tick)
      const H = this.hash;
      const hc = H.cols;
      const hbx = ((Math.floor(xi / H.bs) % hc) + hc) % hc;
      const hby = ((Math.floor(yi / H.bs) % hc) + hc) % hc;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bkt = ((hbx + ox + hc) % hc) + ((hby + oy + hc) % hc) * hc;
          for (let j = H.head[bkt]; j !== -1; j = H.next[j]) {
            if (j === i) continue;
            const qx = wrapD(xi - E.x[j], n);
            const qy = wrapD(yi - E.y[j], n);
            const d2 = qx * qx + qy * qy;
            if (d2 >= sepR2) continue;
            if (d2 < 1e-12) {
              // exact overlap: deterministic nudge by index order
              sx += i < j ? 0.01 : -0.01;
              continue;
            }
            const d = Math.sqrt(d2);
            const push = ((sepR - d) / sepR) * m.separationStrength * 0.1;
            sx += (qx / d) * push;
            sy += (qy / d) * push;
          }
        }
      }
      dx += sx;
      dy += sy;
      if (dx === 0 && dy === 0) {
        E.vx[i] = 0;
        E.vy[i] = 0;
        continue;
      }
      // move with terrain sliding: never step onto an unwalkable vertex
      let nx = xi + dx;
      let ny = yi + dy;
      if (!this.pf.walkable(this.vertexOf(nx, ny))) {
        if (this.pf.walkable(this.vertexOf(xi + dx, yi))) ny = yi;
        else if (this.pf.walkable(this.vertexOf(xi, yi + dy))) nx = xi;
        else {
          nx = xi;
          ny = yi;
        }
      }
      nx = ((nx % n) + n) % n;
      ny = ((ny % n) + n) % n;
      E.vx[i] = wrapD(nx - xi, n);
      E.vy[i] = wrapD(ny - yi, n);
      E.x[i] = nx;
      E.y[i] = ny;
    }
    // drowning (units pushed or standing in deep water)
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && t.drowns(E.x[i], E.y[i])) w.kill(i, "drowned");
  }
}

function wrapD(d: number, n: number): number {
  if (d > n / 2) return d - n;
  if (d < -n / 2) return d + n;
  return d;
}

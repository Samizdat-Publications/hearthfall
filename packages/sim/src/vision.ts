// Fog of war (BACKLOG 3). Each tribe has two grids of `cellSize` cells over the torus: explored (ever
// seen, never cleared) and visible (recomputed every `everySeconds` from the tribe's own units and
// buildings, each stamping a disc of its sight radius). Off when balance.vision is missing or disabled,
// or the map spec says fog: false; then everything counts as seen and nothing is hashed, so older
// replays keep their hashes. A tribe that has lost its Hearth is revealed to everyone (no hide and seek
// with a lone Shaper). The renderer and the opponent AI read these grids; commands do not check them.
import { secondsToTicks } from "./config.ts";
import { CAT, NO_ENTITY } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import type { World } from "./world.ts";

export interface VisionState {
  explored: Uint8Array[];
  visible: Uint8Array[];
}

export class VisionSystem {
  /** fog of war is active for this world */
  readonly on: boolean;
  /** grid cell edge in map cells, and grid width in grid cells */
  readonly cell: number;
  readonly gw: number;
  private readonly every: number;
  private readonly unitSight: number;
  private readonly buildingSight: number;
  private readonly sightUnit: number[] = [];
  private readonly sightBuilding: number[] = [];
  explored: Uint8Array[] = [];
  visible: Uint8Array[] = [];
  /** bumps on every recompute (render cache key; not hashed) */
  version = 0;

  private readonly w: World;

  constructor(w: World, fog: boolean | undefined) {
    this.w = w;
    const v = w.cfg.pack.balance.vision;
    this.on = !!v && v.enabled && fog !== false;
    this.cell = v?.cellSize ?? 2;
    this.gw = Math.ceil(w.terrain.size / this.cell);
    this.every = v ? Math.max(1, secondsToTicks(v.everySeconds, w.cfg.tickHz)) : 1;
    this.unitSight = v?.unitSight ?? 7;
    this.buildingSight = v?.buildingSight ?? 6;
    for (const u of w.cfg.pack.units.units) this.sightUnit.push(v?.sight[u.id] ?? this.unitSight);
    for (const b of w.cfg.pack.buildings.buildings) this.sightBuilding.push(v?.sight[b.id] ?? this.buildingSight);
  }

  /** allocate the grids once the tribes exist */
  init(tribes: number): void {
    const n = this.on ? this.gw * this.gw : 0;
    this.explored = Array.from({ length: tribes }, () => new Uint8Array(n));
    this.visible = Array.from({ length: tribes }, () => new Uint8Array(n));
  }

  private idx(x: number, y: number): number {
    const g = this.gw;
    const cx = ((Math.floor(x / this.cell) % g) + g) % g;
    const cy = ((Math.floor(y / this.cell) % g) + g) % g;
    return cy * g + cx;
  }

  /** does `tribe` see the point (x, y) now? Always true with fog off or for god mode (tribe -1). */
  sees(tribe: number, x: number, y: number): boolean {
    if (!this.on || tribe < 0 || tribe >= this.visible.length) return true;
    return this.visible[tribe][this.idx(x, y)] === 1;
  }

  /** has `tribe` ever seen the point (x, y)? */
  seen(tribe: number, x: number, y: number): boolean {
    if (!this.on || tribe < 0 || tribe >= this.explored.length) return true;
    return this.explored[tribe][this.idx(x, y)] === 1;
  }

  /** can `tribe` see entity i now: its own, a tribe without a Hearth (revealed to all), or in sight */
  seesEntity(tribe: number, i: number): boolean {
    const E = this.w.ents;
    const t = E.tribe[i];
    if (!this.on || tribe < 0 || t === tribe) return true;
    if (t >= 0 && E.index(this.w.tribes[t]?.hearth ?? NO_ENTITY) < 0) return true;
    return this.sees(tribe, E.x[i], E.y[i]);
  }

  /** has `tribe` seen the ground under entity i (buildings stay on the map once their ground was seen) */
  seenEntity(tribe: number, i: number): boolean {
    const E = this.w.ents;
    if (!this.on || tribe < 0 || E.tribe[i] === tribe) return true;
    return this.seesEntity(tribe, i) || this.seen(tribe, E.x[i], E.y[i]);
  }

  /** prayer chains (reveal reward): mark a disc of radius r map cells explored for `tribe` */
  reveal(tribe: number, x: number, y: number, r: number): void {
    if (!this.on || tribe < 0 || tribe >= this.explored.length) return;
    const g = this.gw;
    const rc = r / this.cell + 0.5;
    const R = Math.ceil(rc);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const exp = this.explored[tribe];
    for (let dy = -R; dy <= R; dy++) {
      const yy = (((cy + dy) % g) + g) % g;
      for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= rc * rc) exp[yy * g + ((((cx + dx) % g) + g) % g)] = 1;
    }
    this.version++;
  }

  /** step 10: recompute on the cadence (also called once after world generation) */
  update(force = false): void {
    if (!this.on || (!force && this.w.tick % this.every !== 0)) return;
    const w = this.w;
    const E = w.ents;
    for (const v of this.visible) v.fill(0);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const t = E.tribe[i];
      if (t < 0 || t >= this.visible.length || !w.tribes[t].alive) continue;
      let r: number;
      if (E.cat[i] === CAT.unit) {
        if (E.inside[i] >= 0) continue;
        r = this.sightUnit[E.type[i]];
      } else if (E.cat[i] === CAT.building) r = this.sightBuilding[E.type[i]];
      else continue;
      this.stamp(t, E.x[i], E.y[i], r);
    }
    // stretch 3: held sight stones (living world)
    for (const s of w.living.sightSources()) this.stamp(s.tribe, s.x, s.y, s.r);
    this.version++;
  }

  /** a disc of radius r map cells, in grid cells (cell centers within r + half a cell): visible and explored */
  private stamp(t: number, x: number, y: number, r: number): void {
    if (t < 0 || t >= this.visible.length) return;
    const g = this.gw;
    const rc = r / this.cell + 0.5;
    const R = Math.ceil(rc);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const vis = this.visible[t];
    const exp = this.explored[t];
    for (let dy = -R; dy <= R; dy++) {
      const yy = (((cy + dy) % g) + g) % g;
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > rc * rc) continue;
        const k = yy * g + ((((cx + dx) % g) + g) % g);
        vis[k] = 1;
        exp[k] = 1;
      }
    }
  }

  /** share of the map `tribe` has explored, 0 to 1 (summaries and tests) */
  exploredShare(tribe: number): number {
    if (!this.on) return 1;
    const e = this.explored[tribe];
    let k = 0;
    for (let j = 0; j < e.length; j++) k += e[j];
    return e.length ? k / e.length : 1;
  }

  /** Adds nothing with fog off, so replays recorded before BACKLOG 3 (or with fog off) keep their hashes. */
  hashInto(f: Fnv): void {
    if (!this.on) return;
    f.u32(0xf06f06);
    for (let t = 0; t < this.explored.length; t++) f.bytes(this.explored[t]).bytes(this.visible[t]);
  }

  save(): VisionState {
    return { explored: this.explored.map((a) => a.slice()), visible: this.visible.map((a) => a.slice()) };
  }

  load(st: VisionState): void {
    this.explored = st.explored.map((a) => a.slice());
    this.visible = st.visible.map((a) => a.slice());
    this.version++;
  }
}

// Pathfinding on the torus vertex grid (docs/ARCHITECTURE.md section 3, ADR-004):
// - A* for individual orders (8-connected, no corner cutting, slope-weighted, octile heuristic
//   with wrap deltas), string-pulled to waypoints; searches spend a per-tick expansion budget.
// - Dijkstra flow fields for group orders to one target, cached until the terrain changes.
// - Spatial hash (2x2 cell buckets) rebuilt each tick in entity-index order for separation.
// Everything is deterministic: ties break on node index, buckets fill in index order.
import { wrapDelta, type Terrain } from "./terrain.ts";

const SQRT2 = 1.4142135623730951;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Binary min-heap of (key, node) with deterministic tie-break on node index. */
export class Heap {
  keys = new Float64Array(1024);
  nodes = new Int32Array(1024);
  size = 0;

  clear(): void {
    this.size = 0;
  }

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.nodes[a] < this.nodes[b]);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const n = this.nodes[a];
    this.nodes[a] = this.nodes[b];
    this.nodes[b] = n;
  }

  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const n = new Int32Array(this.size * 2);
      n.set(this.nodes);
      this.nodes = n;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.nodes[i] = node;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Pop the minimum node (call only when size > 0). */
  pop(): number {
    const top = this.nodes[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.nodes[0] = this.nodes[this.size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

export interface PathResult {
  ok: boolean;
  /** waypoint vertex indices from (excluding) start to goal */
  waypoints: Int32Array;
  expanded: number;
}

/** Cost multiplier for stepping onto a vertex; Infinity when not walkable. */
export function stepCost(t: Terrain, x: number, y: number): number {
  if (!t.walkable(x, y)) return Infinity;
  return 1 + t.slope(x, y) / (t.maxWalkSlope * 2);
}

/** What a pathfinder walks on (BACKLOG 10, ADR-016): land units, boats on water, balloons over everything. */
export type NavMode = "land" | "water" | "air";

/** BACKLOG 47: window radii tried in turn when repairing components (each must be 2 or more) */
const REPAIR_WINDOWS = [3, 8, 20];

export class Pathfinder {
  readonly n: number;
  readonly mode: NavMode;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private gen = 1;
  private readonly heap = new Heap();
  /** walkable cache by vertex (rebuilt when the terrain version changes) */
  private walk: Uint8Array;
  private cost: Float32Array;
  /** 8-connected walkable component label per vertex (0 = not walkable) */
  comp: Int32Array;
  private readonly stack: Int32Array;
  private walkVersion = -1;
  /** highest component label handed out (BACKLOG 47: incremental repairs add fresh labels above it) */
  private maxLabel = 0;
  /** BACKLOG 47 scratch for local repairs: window and visit stamps, local component ids */
  private winStamp: Int32Array | null = null;
  private locStamp: Int32Array | null = null;
  private locId: Int32Array | null = null;
  private repairGen = 0;
  /** refresh counters for tests and the bench: full rebuilds, local repairs, repairs that needed a merge scan */
  readonly refreshStats = { full: 0, local: 0, merges: 0 };
  /** heap pops of the last flow field (tests) */
  flowPops = 0;

  readonly t: Terrain;

  constructor(t: Terrain, mode: NavMode = "land") {
    this.t = t;
    this.mode = mode;
    this.n = t.size;
    const nn = t.size * t.size;
    this.g = new Float64Array(nn);
    this.parent = new Int32Array(nn);
    this.stamp = new Int32Array(nn);
    this.closed = new Int32Array(nn);
    this.walk = new Uint8Array(nn);
    this.cost = new Float32Array(nn);
    this.comp = new Int32Array(nn);
    this.stack = new Int32Array(nn);
  }

  /**
   * Refresh the walkability, cost and component caches if the terrain changed (tight loops). BACKLOG 47:
   * edits since the last refresh are applied per dirty rect, and components are repaired locally (see
   * repairComponents); the whole map is rebuilt only when the rects were trimmed, cover a large area, or a
   * component may have split. Labels are compared for equality only, so repaired and rebuilt labels agree.
   */
  refresh(): void {
    if (this.walkVersion === this.t.version) return;
    const rects = this.walkVersion < 0 ? null : this.t.dirtySince(this.walkVersion);
    if (rects === null || !this.refreshRects(rects)) this.rebuildAll();
    this.walkVersion = this.t.version;
  }

  /** Recompute walkability and step cost of one vertex (same expressions as rebuildAll). */
  private computeAt(i: number): void {
    const n = this.n;
    const H = this.t.heights;
    const sea = this.t.sea;
    if (this.mode !== "land") {
      const ok = this.mode === "air" || H[i] < sea;
      this.walk[i] = ok ? 1 : 0;
      this.cost[i] = ok ? 1 : 0;
      return;
    }
    const maxSlope = this.t.maxWalkSlope;
    const x = i % n;
    const y = (i - x) / n;
    const row = y * n;
    const h = H[i];
    const l = H[row + (x === 0 ? n - 1 : x - 1)];
    const r = H[row + (x === n - 1 ? 0 : x + 1)];
    const u = H[(y === 0 ? n - 1 : y - 1) * n + x];
    const d = H[(y === n - 1 ? 0 : y + 1) * n + x];
    let sl = h > l ? h - l : l - h;
    let q = h > r ? h - r : r - h;
    if (q > sl) sl = q;
    q = h > u ? h - u : u - h;
    if (q > sl) sl = q;
    q = h > d ? h - d : d - h;
    if (q > sl) sl = q;
    const ok = h >= sea && sl <= maxSlope;
    this.walk[i] = ok ? 1 : 0;
    this.cost[i] = ok ? 1 + sl / (maxSlope * 2) : 0;
  }

  /** Apply dirty rects: recompute their vertices (plus a one-vertex margin), then repair components. False asks for a full rebuild. */
  private refreshRects(rects: readonly { x: number; y: number; w: number; h: number }[]): boolean {
    if (this.mode === "air") return true;
    const n = this.n;
    let area = 0;
    for (const r of rects) area += (r.w + 2) * (r.h + 2);
    if (area * 4 > n * n) return false;
    const flipped: number[] = [];
    for (const r of rects) {
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        const row = (((y % n) + n) % n) * n;
        for (let x = r.x - 1; x <= r.x + r.w; x++) {
          const i = row + (((x % n) + n) % n);
          const was = this.walk[i];
          this.computeAt(i);
          if (this.walk[i] !== was) flipped.push(i);
        }
      }
    }
    if (!flipped.length) return true;
    // a narrow window can cut a ring of land that is joined further out; widen before giving up
    for (const m of REPAIR_WINDOWS) if (this.repairComponents(flipped, m)) return true;
    return false;
  }

  /**
   * Repair component labels after the walkable vertices in `flipped` changed. A window of radius m (2 or more) around
   * them is flooded locally (same 8-connected corner rule); its border never flipped, and every edge that
   * leaves the window is unchanged. So a local component that touches no border vertex is a whole island
   * (fresh label), and of the ones that do: one old label keeps it, several merge (one scan relabels the
   * map). An old label in two border-touching local components may have split: return false (widen or rebuild).
   */
  private repairComponents(flipped: number[], M: number): boolean {
    const n = this.n;
    const nn = n * n;
    if (!this.winStamp) {
      this.winStamp = new Int32Array(nn);
      this.locStamp = new Int32Array(nn);
      this.locId = new Int32Array(nn);
    }
    const win = this.winStamp;
    const vis = this.locStamp!;
    const lid = this.locId!;
    const g = ++this.repairGen;
    const walk = this.walk;
    const comp = this.comp;
    const cells: number[] = [];
    for (const f of flipped) {
      const fx = f % n;
      const fy = (f - fx) / n;
      for (let dy = -M; dy <= M; dy++) {
        const row = ((((fy + dy) % n) + n) % n) * n;
        for (let dx = -M; dx <= M; dx++) {
          const i = row + ((((fx + dx) % n) + n) % n);
          if (win[i] === g) continue;
          win[i] = g;
          cells.push(i);
        }
      }
      // a window over a quarter of the map costs as much as a rebuild
      if (cells.length * 4 > nn) return false;
    }
    // local flood: lid = local component (1..), its old labels and whether it reaches the window border
    const seenIn = new Map<number, number>();
    const labels: number[][] = [[]];
    const border: boolean[] = [false];
    const stack = this.stack;
    const nb = [0, 0, 0, 0, 0, 0, 0, 0];
    let local = 0;
    for (const s0 of cells) {
      if (!walk[s0] || vis[s0] === g) continue;
      local++;
      labels.push([]);
      border.push(false);
      vis[s0] = g;
      lid[s0] = local;
      let top = 0;
      stack[top++] = s0;
      while (top > 0) {
        const cur = stack[--top];
        const old = comp[cur];
        if (old > 0 && seenIn.get(old) !== local) {
          seenIn.set(old, local);
          labels[local].push(old);
        }
        const cx = cur % n;
        const cy = (cur - cx) / n;
        const xl = cx === 0 ? n - 1 : cx - 1;
        const xr = cx === n - 1 ? 0 : cx + 1;
        const yu = (cy === 0 ? n - 1 : cy - 1) * n;
        const yd = (cy === n - 1 ? 0 : cy + 1) * n;
        const row = cy * n;
        const L = row + xl;
        const R = row + xr;
        const U = yu + cx;
        const D = yd + cx;
        const wl = walk[L];
        const wr = walk[R];
        const wu = walk[U];
        const wd = walk[D];
        nb[0] = L;
        nb[1] = R;
        nb[2] = U;
        nb[3] = D;
        // diagonals only when both orthogonal neighbors are walkable (no corner cutting)
        nb[4] = wl && wu ? yu + xl : -1;
        nb[5] = wr && wu ? yu + xr : -1;
        nb[6] = wl && wd ? yd + xl : -1;
        nb[7] = wr && wd ? yd + xr : -1;
        if (!border[local] && (win[L] !== g || win[R] !== g || win[U] !== g || win[D] !== g || win[yu + xl] !== g || win[yu + xr] !== g || win[yd + xl] !== g || win[yd + xr] !== g)) border[local] = true;
        for (let k = 0; k < 8; k++) {
          const j = nb[k];
          if (j < 0 || !walk[j] || win[j] !== g || vis[j] === g) continue;
          vis[j] = g;
          lid[j] = local;
          stack[top++] = j;
        }
      }
    }
    // an old label may continue past the border from one local component only
    const owner = new Map<number, number>();
    for (let k = 1; k <= local; k++) {
      if (!border[k]) continue;
      for (const l of labels[k]) {
        if (owner.has(l)) return false;
        owner.set(l, k);
      }
    }
    // resolve each local component's label; merged labels remap to the smallest
    const target = new Int32Array(local + 1);
    const remap = new Map<number, number>();
    for (let k = 1; k <= local; k++) {
      const ls = labels[k];
      if (!border[k] || !ls.length) {
        target[k] = ++this.maxLabel;
        continue;
      }
      let m = ls[0];
      for (const l of ls) if (l < m) m = l;
      target[k] = m;
      for (const l of ls) if (l !== m) remap.set(l, m);
    }
    for (const i of cells) comp[i] = walk[i] ? target[lid[i]] : 0;
    if (remap.size) {
      this.refreshStats.merges++;
      for (let i = 0; i < nn; i++) {
        const c = comp[i];
        if (c > 0) {
          const t = remap.get(c);
          if (t !== undefined) comp[i] = t;
        }
      }
    }
    this.refreshStats.local++;
    return true;
  }

  /** Rebuild walkability, cost and components for the whole map. */
  private rebuildAll(): void {
    this.refreshStats.full++;
    const n = this.n;
    const H = this.t.heights;
    const sea = this.t.sea;
    const maxSlope = this.t.maxWalkSlope;
    if (this.mode !== "land") {
      // water: every vertex under the sea at an even cost; air: everything (one component)
      const air = this.mode === "air";
      for (let i = 0; i < n * n; i++) {
        const ok = air || H[i] < sea;
        this.walk[i] = ok ? 1 : 0;
        this.cost[i] = ok ? 1 : 0;
      }
    } else {
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const up = (y === 0 ? n - 1 : y - 1) * n;
      const dn = (y === n - 1 ? 0 : y + 1) * n;
      for (let x = 0; x < n; x++) {
        const i = row + x;
        const h = H[i];
        const l = H[row + (x === 0 ? n - 1 : x - 1)];
        const r = H[row + (x === n - 1 ? 0 : x + 1)];
        const u = H[up + x];
        const d = H[dn + x];
        let sl = h > l ? h - l : l - h;
        let q = h > r ? h - r : r - h;
        if (q > sl) sl = q;
        q = h > u ? h - u : u - h;
        if (q > sl) sl = q;
        q = h > d ? h - d : d - h;
        if (q > sl) sl = q;
        const ok = h >= sea && sl <= maxSlope;
        this.walk[i] = ok ? 1 : 0;
        this.cost[i] = ok ? 1 + sl / (maxSlope * 2) : 0;
      }
    }
    }
    // 8-connected component labels with the search's corner rule, so unreachable goals fail fast
    const comp = this.comp;
    const walk = this.walk;
    comp.fill(0);
    const stack = this.stack;
    let label = 0;
    for (let s0 = 0; s0 < n * n; s0++) {
      if (!walk[s0] || comp[s0]) continue;
      comp[s0] = ++label;
      let top = 0;
      stack[top++] = s0;
      while (top > 0) {
        const cur = stack[--top];
        const cx = cur % n;
        const cy = (cur - cx) / n;
        const xl = cx === 0 ? n - 1 : cx - 1;
        const xr = cx === n - 1 ? 0 : cx + 1;
        const yu = (cy === 0 ? n - 1 : cy - 1) * n;
        const yd = (cy === n - 1 ? 0 : cy + 1) * n;
        const row = cy * n;
        const L = row + xl;
        const R = row + xr;
        const U = yu + cx;
        const D = yd + cx;
        if (walk[L] && !comp[L]) {
          comp[L] = label;
          stack[top++] = L;
        }
        if (walk[R] && !comp[R]) {
          comp[R] = label;
          stack[top++] = R;
        }
        if (walk[U] && !comp[U]) {
          comp[U] = label;
          stack[top++] = U;
        }
        if (walk[D] && !comp[D]) {
          comp[D] = label;
          stack[top++] = D;
        }
        // diagonals only when both orthogonal neighbors are walkable (no corner cutting)
        const wl = walk[L];
        const wr = walk[R];
        const wu = walk[U];
        const wd = walk[D];
        let j = yu + xl;
        if (wl && wu && walk[j] && !comp[j]) {
          comp[j] = label;
          stack[top++] = j;
        }
        j = yu + xr;
        if (wr && wu && walk[j] && !comp[j]) {
          comp[j] = label;
          stack[top++] = j;
        }
        j = yd + xl;
        if (wl && wd && walk[j] && !comp[j]) {
          comp[j] = label;
          stack[top++] = j;
        }
        j = yd + xr;
        if (wr && wd && walk[j] && !comp[j]) {
          comp[j] = label;
          stack[top++] = j;
        }
      }
    }
    this.maxLabel = label;
  }

  walkable(i: number): boolean {
    return this.walk[i] === 1;
  }

  private heuristic(a: number, b: number): number {
    const n = this.n;
    let dx = Math.abs((a % n) - (b % n));
    let dy = Math.abs(Math.floor(a / n) - Math.floor(b / n));
    if (dx > n / 2) dx = n - dx;
    if (dy > n / 2) dy = n - dy;
    return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
  }

  /** Nearest walkable vertex to i within radius r (spiral by ring, index order), or -1. */
  nearestWalkable(i: number, r = 6): number {
    if (this.walk[i]) return i;
    const n = this.n;
    const x0 = i % n;
    const y0 = Math.floor(i / n);
    for (let d = 1; d <= r; d++) {
      let best = -1;
      let bestD = 1e9;
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const j = ((x0 + dx + n) % n) + ((y0 + dy + n) % n) * n;
          const dd = dx * dx + dy * dy;
          if (this.walk[j] && (dd < bestD || (dd === bestD && j < best))) {
            best = j;
            bestD = dd;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** A* from start to goal vertex. maxExpand caps work (failure when exceeded). */
  astar(start: number, goal: number, maxExpand: number): PathResult {
    this.refresh();
    const n = this.n;
    const fail = (expanded: number): PathResult => ({ ok: false, waypoints: new Int32Array(0), expanded });
    if (!this.walk[start] || !this.walk[goal] || this.comp[start] !== this.comp[goal]) return fail(0);
    if (start === goal) return { ok: true, waypoints: new Int32Array(0), expanded: 0 };
    // open ground: a clear straight line needs no search (most combat re-paths in a battle); the
    // line's length in cells is charged as its work so the per-tick budget still bounds a burst
    if (this.lineWalkable(start, goal)) {
      const lx = Math.abs(wrapDelta((goal % n) - (start % n), n));
      const ly = Math.abs(wrapDelta(Math.floor(goal / n) - Math.floor(start / n), n));
      return { ok: true, waypoints: Int32Array.of(goal), expanded: Math.ceil(Math.max(lx, ly)) };
    }
    const gen = ++this.gen;
    const heap = this.heap;
    heap.clear();
    this.g[start] = 0;
    this.stamp[start] = gen;
    this.parent[start] = -1;
    heap.push(this.heuristic(start, goal), start);
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) return { ok: true, waypoints: this.smooth(start, this.trace(goal)), expanded };
      if (++expanded > maxExpand) return fail(expanded);
      const cx = cur % n;
      const cy = (cur - cx) / n;
      for (let k = 0; k < 8; k++) {
        const nx = (cx + DX[k] + n) % n;
        const ny = (cy + DY[k] + n) % n;
        const j = nx + ny * n;
        if (!this.walk[j] || this.closed[j] === gen) continue;
        if (k >= 4 && (!this.walk[((cx + DX[k] + n) % n) + cy * n] || !this.walk[cx + ((cy + DY[k] + n) % n) * n])) continue;
        const ng = this.g[cur] + (k >= 4 ? SQRT2 : 1) * this.cost[j];
        if (this.stamp[j] !== gen || ng < this.g[j]) {
          this.stamp[j] = gen;
          this.g[j] = ng;
          this.parent[j] = cur;
          heap.push(ng + this.heuristic(j, goal), j);
        }
      }
    }
    return fail(expanded);
  }

  private trace(goal: number): number[] {
    const out: number[] = [];
    for (let c = goal; c !== -1; c = this.parent[c]) out.push(c);
    out.reverse();
    return out;
  }

  /** Straight walkable line between vertices a and b (shortest wrap), sampled every half cell. */
  lineWalkable(a: number, b: number): boolean {
    const n = this.n;
    const ax = a % n;
    const ay = Math.floor(a / n);
    let dx = (b % n) - ax;
    let dy = Math.floor(b / n) - ay;
    if (dx > n / 2) dx -= n;
    else if (dx < -n / 2) dx += n;
    if (dy > n / 2) dy -= n;
    else if (dy < -n / 2) dy += n;
    // a segment of half the map or more is ambiguous on the torus (both directions are equally
    // short), so it never counts as a straight line; this keeps every waypoint leg unambiguous
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= n / 2 - 1) return false;
    // fine sampling: a moving unit occupies the vertex nearest its position, so the line must keep
    // every point on walkable vertices (half-cell sampling missed diagonal corners)
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 8);
    for (let s = 1; s < steps; s++) {
      const x = Math.round(ax + (dx * s) / steps);
      const y = Math.round(ay + (dy * s) / steps);
      if (!this.walk[((x % n) + n) % n + (((y % n) + n) % n) * n]) return false;
    }
    return true;
  }

  /** Like lineWalkable but from a continuous position (what a moving unit actually traverses). */
  lineWalkableFrom(ax: number, ay: number, b: number): boolean {
    const n = this.n;
    let dx = (b % n) - ax;
    let dy = Math.floor(b / n) - ay;
    if (dx > n / 2) dx -= n;
    else if (dx < -n / 2) dx += n;
    if (dy > n / 2) dy -= n;
    else if (dy < -n / 2) dy += n;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= n / 2 - 1) return false;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 8);
    for (let s = 1; s < steps; s++) {
      const x = Math.round(ax + (dx * s) / steps);
      const y = Math.round(ay + (dy * s) / steps);
      if (!this.walk[((x % n) + n) % n + (((y % n) + n) % n) * n]) return false;
    }
    return true;
  }

  /** String pulling: keep only the vertices where the straight line would leave walkable land. */
  private smooth(start: number, path: number[]): Int32Array {
    const out: number[] = [];
    let anchor = start;
    for (let i = 1; i < path.length; i++) {
      if (!this.lineWalkable(anchor, path[i])) {
        out.push(path[i - 1]);
        anchor = path[i - 1];
      }
    }
    out.push(path[path.length - 1]);
    return Int32Array.from(out);
  }

  /** Dijkstra integration field from goal over the whole map (flow fields for group orders). */
  flowField(goal: number): Float32Array {
    this.refresh();
    const n = this.n;
    const dist = new Float32Array(n * n).fill(Infinity);
    if (!this.walk[goal]) return dist;
    const heap = this.heap;
    heap.clear();
    dist[goal] = 0;
    heap.push(0, goal);
    this.flowPops = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      this.flowPops++;
      const d = dist[cur];
      const cx = cur % n;
      const cy = (cur - cx) / n;
      for (let k = 0; k < 8; k++) {
        const nx = (cx + DX[k] + n) % n;
        const ny = (cy + DY[k] + n) % n;
        const j = nx + ny * n;
        if (!this.walk[j]) continue;
        if (k >= 4 && (!this.walk[((cx + DX[k] + n) % n) + cy * n] || !this.walk[cx + ((cy + DY[k] + n) % n) * n])) continue;
        // S4 L6-C: compare in float32 like the stored distances; a float64 candidate against a value that
        // rounded up re-pushed the cell on every stale pop, a cascade of tens of millions of pops
        const nd = Math.fround(d + (k >= 4 ? SQRT2 : 1) * this.cost[cur]);
        if (nd < dist[j]) {
          dist[j] = nd;
          heap.push(nd, j);
        }
      }
    }
    return dist;
  }
}

/** Spatial hash over the torus with 2x2-cell buckets; insertion in index order (deterministic). */
export class SpatialHash {
  readonly bs: number;
  readonly cols: number;
  head: Int32Array;
  next: Int32Array;

  readonly size: number;

  constructor(size: number, bucket = 2) {
    this.size = size;
    this.bs = bucket;
    this.cols = Math.ceil(size / bucket);
    this.head = new Int32Array(this.cols * this.cols).fill(-1);
    this.next = new Int32Array(1024).fill(-1);
  }

  bucketOf(x: number, y: number): number {
    const c = this.cols;
    const bx = ((Math.floor(x / this.bs) % c) + c) % c;
    const by = ((Math.floor(y / this.bs) % c) + c) % c;
    return bx + by * c;
  }

  /** Rebuild from entity positions; insert in descending index so each list reads ascending. */
  rebuild(hi: number, include: (i: number) => boolean, xs: Float64Array, ys: Float64Array): void {
    this.head.fill(-1);
    if (this.next.length < hi) this.next = new Int32Array(Math.max(hi, this.next.length * 2));
    for (let i = hi - 1; i >= 0; i--) {
      if (!include(i)) continue;
      const b = this.bucketOf(xs[i], ys[i]);
      this.next[i] = this.head[b];
      this.head[b] = i;
    }
  }

  /** Visit entities in the 3x3 buckets around (x, y), bucket by bucket in a fixed order. */
  near(x: number, y: number, fn: (i: number) => void): void {
    const c = this.cols;
    const bx = ((Math.floor(x / this.bs) % c) + c) % c;
    const by = ((Math.floor(y / this.bs) % c) + c) % c;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const b = ((bx + ox + c) % c) + ((by + oy + c) % c) * c;
        for (let i = this.head[b]; i !== -1; i = this.next[i]) fn(i);
      }
    }
  }
}

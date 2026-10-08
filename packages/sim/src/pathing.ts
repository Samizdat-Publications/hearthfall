// Pathfinding on the torus vertex grid (docs/ARCHITECTURE.md section 3, ADR-004):
// - A* for individual orders (8-connected, no corner cutting, slope-weighted, octile heuristic
//   with wrap deltas), string-pulled to waypoints; searches spend a per-tick expansion budget.
// - Dijkstra flow fields for group orders to one target, cached until the terrain changes.
// - Spatial hash (2x2 cell buckets) rebuilt each tick in entity-index order for separation.
// Everything is deterministic: ties break on node index, buckets fill in index order.
import type { Terrain } from "./terrain.ts";

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

export class Pathfinder {
  readonly n: number;
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
  private walkVersion = -1;

  readonly t: Terrain;

  constructor(t: Terrain) {
    this.t = t;
    this.n = t.size;
    const nn = t.size * t.size;
    this.g = new Float64Array(nn);
    this.parent = new Int32Array(nn);
    this.stamp = new Int32Array(nn);
    this.closed = new Int32Array(nn);
    this.walk = new Uint8Array(nn);
    this.cost = new Float32Array(nn);
    this.comp = new Int32Array(nn);
  }

  /** Refresh the walkability and cost caches if the terrain changed. */
  refresh(): void {
    if (this.walkVersion === this.t.version) return;
    const n = this.n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = x + y * n;
        const c = stepCost(this.t, x, y);
        this.walk[i] = c === Infinity ? 0 : 1;
        this.cost[i] = c === Infinity ? 0 : c;
      }
    }
    // component labels (same 8-connectivity and corner rule as the search) so unreachable goals fail fast
    const comp = this.comp;
    comp.fill(0);
    const stack: number[] = [];
    let label = 0;
    for (let s0 = 0; s0 < n * n; s0++) {
      if (!this.walk[s0] || comp[s0]) continue;
      comp[s0] = ++label;
      stack.push(s0);
      while (stack.length) {
        const cur = stack.pop()!;
        const cx = cur % n;
        const cy = (cur - cx) / n;
        for (let k = 0; k < 8; k++) {
          const j = ((cx + DX[k] + n) % n) + ((cy + DY[k] + n) % n) * n;
          if (!this.walk[j] || comp[j]) continue;
          if (k >= 4 && (!this.walk[((cx + DX[k] + n) % n) + cy * n] || !this.walk[cx + ((cy + DY[k] + n) % n) * n])) continue;
          comp[j] = label;
          stack.push(j);
        }
      }
    }
    this.walkVersion = this.t.version;
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
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
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
    while (heap.size > 0) {
      const cur = heap.pop();
      const d = dist[cur];
      const cx = cur % n;
      const cy = (cur - cx) / n;
      for (let k = 0; k < 8; k++) {
        const nx = (cx + DX[k] + n) % n;
        const ny = (cy + DY[k] + n) % n;
        const j = nx + ny * n;
        if (!this.walk[j]) continue;
        if (k >= 4 && (!this.walk[((cx + DX[k] + n) % n) + cy * n] || !this.walk[cx + ((cy + DY[k] + n) % n) * n])) continue;
        const nd = d + (k >= 4 ? SQRT2 : 1) * this.cost[cur];
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

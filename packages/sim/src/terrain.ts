// Torus heightmap: integer heights at integer vertex coordinates, wrapping on both axes. Every edit
// is one of the ops below, records a dirty rectangle (renderer remesh, path invalidation) and bumps
// `version`. One cell is one world unit across; heights are in height units (balance.json).
import { hash2 } from "./rng.ts";

/** Dirty rectangle: (x, y) is the wrapped start, w and h never exceed the map size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A dirty rect stamped with the terrain version after its op; readers keep their own cursor. */
export interface DirtyRect extends Rect {
  seq: number;
}

/** How many dirty rects the terrain keeps for cursor readers (renderer, pathing). */
export const DIRTY_KEEP = 256;

export interface TerrainParams {
  size: number;
  seaLevel: number;
  heightMax: number;
  drownDepth: number;
  maxWalkSlope: number;
  maxBuildSlope: number;
}

export function wrap(i: number, n: number): number {
  const r = i % n;
  return r < 0 ? r + n : r;
}

/** Shortest signed delta on a ring of length n. */
export function wrapDelta(d: number, n: number): number {
  // fast path (bit-identical: within half the ring the remainder below returns d unchanged); the float
  // remainder was 18 percent of the 2000-unit battle bench
  const h = n / 2;
  if (d <= h && d >= -h) return d;
  let r = d % n;
  if (r > n / 2) r -= n;
  else if (r < -n / 2) r += n;
  return r;
}

/** Op specs as queued by spells, buildings and debug commands (applied in the terrain system). */
export type TerrainOpSpec =
  | { op: "raise"; x: number; y: number; r: number; amount: number }
  | { op: "lower"; x: number; y: number; r: number; amount: number }
  | { op: "set"; x: number; y: number; r: number; value: number }
  | { op: "flattenToAverage"; x: number; y: number; r: number; minAboveSea?: number }
  | { op: "smooth"; x: number; y: number; r: number; strength: number }
  | { op: "crater"; x: number; y: number; r: number; height: number; shape: "cone" | "bowl" }
  | { op: "ridgeLine"; x: number; y: number; x2: number; y2: number; width: number; aboveSea: number }
  | { op: "noiseScar"; x: number; y: number; r: number; depth: number; seed: number }
  | { op: "lowerTowardSea"; x: number; y: number; r: number; amount: number }
  | { op: "scar"; x: number; y: number; r: number; seconds: number }
  | { op: "flattenRect"; x: number; y: number; w: number; h: number; target: number; step: number };

export class Terrain {
  readonly size: number;
  readonly sea: number;
  readonly heightMax: number;
  readonly drownDepth: number;
  readonly maxWalkSlope: number;
  readonly maxBuildSlope: number;
  readonly heights: Int16Array;
  /** Seconds of scarring left per vertex (unbuildable while > 0). */
  readonly scar: Uint16Array;
  dirty: DirtyRect[] = [];
  version = 0;
  /** bumps once per heal pass (readers re-tint scarred areas; not part of the edit version) */
  scarVersion = 0;
  private scarred = 0;

  constructor(p: TerrainParams, heights?: Int16Array, scar?: Uint16Array) {
    this.size = p.size;
    this.sea = p.seaLevel;
    this.heightMax = p.heightMax;
    this.drownDepth = p.drownDepth;
    this.maxWalkSlope = p.maxWalkSlope;
    this.maxBuildSlope = p.maxBuildSlope;
    const n = p.size * p.size;
    this.heights = heights ? new Int16Array(heights) : new Int16Array(n);
    this.scar = scar ? new Uint16Array(scar) : new Uint16Array(n);
    for (let i = 0; i < n; i++) if (this.scar[i] > 0) this.scarred++;
  }

  idx(x: number, y: number): number {
    return wrap(x, this.size) + wrap(y, this.size) * this.size;
  }

  get(x: number, y: number): number {
    return this.heights[this.idx(x, y)];
  }

  private put(i: number, v: number): void {
    this.heights[i] = v < 0 ? 0 : v > this.heightMax ? this.heightMax : v;
  }

  /** Bilinear height at a continuous position (vertex grid, wrapping). */
  heightAt(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = this.get(x0, y0);
    const b = this.get(x0 + 1, y0);
    const c = this.get(x0, y0 + 1);
    const d = this.get(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  isLand(x: number, y: number): boolean {
    return this.get(x, y) >= this.sea;
  }

  /** Max absolute height difference to the 4 neighbors, in height units. */
  slope(x: number, y: number): number {
    const h = this.get(x, y);
    return Math.max(Math.abs(h - this.get(x + 1, y)), Math.abs(h - this.get(x - 1, y)), Math.abs(h - this.get(x, y + 1)), Math.abs(h - this.get(x, y - 1)));
  }

  walkable(x: number, y: number): boolean {
    return this.isLand(x, y) && this.slope(x, y) <= this.maxWalkSlope;
  }

  /** True when standing at (x, y) means drowning (water deeper than drownDepth). */
  drowns(x: number, y: number): boolean {
    return this.sea - this.heightAt(x, y) > this.drownDepth;
  }

  /** A w x h footprint at integer (x, y) can be built: dry, unscarred, flattenable within maxRange. */
  buildable(x: number, y: number, w: number, h: number, maxRange: number): boolean {
    let lo = 1e9;
    let hi = -1e9;
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const k = this.idx(x + i, y + j);
        const v = this.heights[k];
        if (v < this.sea + 2 || this.scar[k] > 0) return false;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    return hi - lo <= maxRange;
  }

  /**
   * Would a w x h footprint at (x, y), flattened to `target`, still connect to the land around it? Walks
   * walkable vertices (the pad at target, everything else as is) from the pad and succeeds on reaching
   * `reach` cells beyond it. BACKLOG 0a: a pad on a terrace edge flattened to its average could raise
   * cliffs on every side and wall its builders and the people born there into a pocket.
   */
  padConnects(x: number, y: number, w: number, h: number, target: number, reach: number): boolean {
    const n = this.size;
    const side = Math.max(w, h) + 2 * reach + 1;
    // local window coordinates: (lx, ly) = (x - reach + lx, y - reach + ly)
    const W = w + 2 * reach + 1;
    const H = h + 2 * reach + 1;
    if (side >= n) return true;
    const hAt = (lx: number, ly: number): number => {
      const px = lx - reach;
      const py = ly - reach;
      return px >= 0 && px <= w && py >= 0 && py <= h ? target : this.get(x + px, y + py);
    };
    const walk = (lx: number, ly: number): boolean => {
      const v = hAt(lx, ly);
      if (v < this.sea) return false;
      return Math.abs(v - hAt(lx + 1, ly)) <= this.maxWalkSlope && Math.abs(v - hAt(lx - 1, ly)) <= this.maxWalkSlope && Math.abs(v - hAt(lx, ly + 1)) <= this.maxWalkSlope && Math.abs(v - hAt(lx, ly - 1)) <= this.maxWalkSlope;
    };
    const seen = new Uint8Array(W * H);
    const queue: number[] = [];
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const lx = reach + i;
        const ly = reach + j;
        if (walk(lx, ly)) {
          seen[lx + ly * W] = 1;
          queue.push(lx + ly * W);
        }
      }
    }
    for (let q = 0; q < queue.length; q++) {
      const lx = queue[q] % W;
      const ly = (queue[q] - lx) / W;
      if (lx === 0 || ly === 0 || lx === W - 1 || ly === H - 1) return true;
      for (const [ax, ay] of [[lx + 1, ly], [lx - 1, ly], [lx, ly + 1], [lx, ly - 1]]) {
        const k = ax + ay * W;
        if (seen[k] || !walk(ax, ay)) continue;
        seen[k] = 1;
        queue.push(k);
      }
    }
    return false;
  }

  /** Minimum sampled height along a straight (shortest-wrap) segment, every quarter cell. */
  minHeightAlong(ax: number, ay: number, bx: number, by: number): number {
    const dx = wrapDelta(bx - ax, this.size);
    const dy = wrapDelta(by - ay, this.size);
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) * 4));
    let m = 1e9;
    for (let s = 0; s <= steps; s++) m = Math.min(m, this.heightAt(ax + (dx * s) / steps, ay + (dy * s) / steps));
    return m;
  }

  scarAt(x: number, y: number): number {
    return this.scar[this.idx(Math.round(x), Math.round(y))];
  }

  private mark(x0: number, y0: number, x1: number, y1: number): void {
    const w = Math.min(this.size, x1 - x0 + 1);
    const h = Math.min(this.size, y1 - y0 + 1);
    this.version++;
    this.dirty.push({ x: wrap(x0, this.size), y: wrap(y0, this.size), w, h, seq: this.version });
    if (this.dirty.length > DIRTY_KEEP) this.dirty.splice(0, this.dirty.length - DIRTY_KEEP);
  }

  /** Visit every vertex within radius r of (cx, cy); t = distance / r in [0, 1]. */
  private disc(cx: number, cy: number, r: number, fn: (i: number, t: number) => void): void {
    const x0 = Math.ceil(cx - r);
    const x1 = Math.floor(cx + r);
    const y0 = Math.ceil(cy - r);
    const y1 = Math.floor(cy + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r) fn(this.idx(x, y), r > 0 ? d / r : 0);
      }
    }
    this.mark(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
  }

  raise(cx: number, cy: number, r: number, amount: number): void {
    this.disc(cx, cy, r, (i, t) => this.put(i, this.heights[i] + Math.round(amount * (1 - t * t))));
  }

  lower(cx: number, cy: number, r: number, amount: number): void {
    this.raise(cx, cy, r, -amount);
  }

  setDisc(cx: number, cy: number, r: number, value: number): void {
    this.disc(cx, cy, r, (i) => this.put(i, value));
  }

  flattenToAverage(cx: number, cy: number, r: number, minAboveSea = 0): number {
    let sum = 0;
    let n = 0;
    this.disc(cx, cy, r, (i) => {
      sum += this.heights[i];
      n++;
    });
    this.dirty.pop();
    this.version--;
    // (measurement pass above must not count as an edit)
    const target = Math.max(n ? Math.round(sum / n) : this.sea, this.sea + minAboveSea);
    this.disc(cx, cy, r, (i, t) => {
      const h = this.heights[i];
      this.put(i, t <= 0.75 ? target : Math.round(h + (target - h) * ((1 - t) / 0.25)));
    });
    return target;
  }

  /** Move every vertex of a footprint at most maxStep toward target. Returns remaining total difference. */
  flattenRect(x: number, y: number, w: number, h: number, target: number, maxStep: number): number {
    let left = 0;
    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) {
        const k = this.idx(x + i, y + j);
        const v = this.heights[k];
        const d = target - v;
        const s = d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
        this.put(k, v + s);
        left += Math.abs(d - s);
      }
    }
    this.mark(x - 1, y - 1, x + w + 1, y + h + 1);
    return left;
  }

  smooth(cx: number, cy: number, r: number, strength: number): void {
    const src = new Int16Array(this.heights);
    this.disc(cx, cy, r, (i) => {
      const x = i % this.size;
      const y = (i - x) / this.size;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += src[this.idx(x + dx, y + dy)];
      const h = src[i];
      this.put(i, h + Math.round((s / 9 - h) * strength));
    });
  }

  crater(cx: number, cy: number, r: number, height: number, shape: "cone" | "bowl"): void {
    this.disc(cx, cy, r, (i, t) => {
      let add: number;
      if (shape === "cone") {
        add = height * (1 - t);
        if (t < 0.15) add -= height * 0.25 * (1 - t / 0.15);
      } else add = -height * (1 - t * t);
      this.put(i, this.heights[i] + Math.round(add));
    });
  }

  /** Raise a land ridge along a segment to at least sea + aboveSea, tapering over 1.5 cells. */
  ridgeLine(ax: number, ay: number, bx: number, by: number, width: number, aboveSea: number): void {
    const dx = wrapDelta(bx - ax, this.size);
    const dy = wrapDelta(by - ay, this.size);
    const len2 = dx * dx + dy * dy;
    const half = width / 2;
    const reach = half + 1.5;
    const x0 = Math.floor(Math.min(ax, ax + dx) - reach);
    const x1 = Math.ceil(Math.max(ax, ax + dx) + reach);
    const y0 = Math.floor(Math.min(ay, ay + dy) - reach);
    const y1 = Math.ceil(Math.max(ay, ay + dy) + reach);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x - ax;
        const py = y - ay;
        let u = len2 > 0 ? (px * dx + py * dy) / len2 : 0;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = px - u * dx;
        const qy = py - u * dy;
        const d = Math.sqrt(qx * qx + qy * qy);
        if (d > reach) continue;
        const f = d <= half ? 1 : 1 - (d - half) / 1.5;
        const target = this.sea + Math.round(aboveSea * f);
        const k = this.idx(x, y);
        if (this.heights[k] < target) this.put(k, target);
      }
    }
    this.mark(x0, y0, x1, y1);
  }

  /** Quake: uneven lowering with deep cracks, noise from a per-cast seed. */
  noiseScar(cx: number, cy: number, r: number, depth: number, seed: number): void {
    this.disc(cx, cy, r, (i, t) => {
      const n = hash2(i % this.size, Math.floor(i / this.size), seed) / 4294967296;
      const crack = n > 0.85 ? 0.8 : 0;
      this.put(i, this.heights[i] - Math.round(depth * (1 - t * t) * (0.4 + 0.6 * n + crack)));
    });
  }

  /** Erosion step: sink land toward drowning depth, never below it. */
  lowerTowardSea(cx: number, cy: number, r: number, amount: number): void {
    const floor = this.sea - this.drownDepth * 2;
    this.disc(cx, cy, r, (i, t) => {
      const h = this.heights[i];
      if (h > floor) this.put(i, Math.max(floor, h - Math.round(amount * (1 - t * t))));
    });
  }

  scarDisc(cx: number, cy: number, r: number, seconds: number): void {
    this.disc(cx, cy, r, (i) => {
      if (this.scar[i] === 0 && seconds > 0) this.scarred++;
      if (this.scar[i] < seconds) this.scar[i] = seconds;
    });
  }

  recountScars(): void {
    this.scarred = 0;
    for (let i = 0; i < this.scar.length; i++) if (this.scar[i] > 0) this.scarred++;
  }

  /** Called once per sim second: every scar heals by one second. */
  healScars(): void {
    if (this.scarred === 0) return;
    this.scarVersion++;
    const s = this.scar;
    for (let i = 0; i < s.length; i++) {
      if (s[i] > 0) {
        s[i]--;
        if (s[i] === 0) this.scarred--;
      }
    }
  }

  apply(o: TerrainOpSpec): void {
    switch (o.op) {
      case "raise":
        return this.raise(o.x, o.y, o.r, o.amount);
      case "lower":
        return this.lower(o.x, o.y, o.r, o.amount);
      case "set":
        return this.setDisc(o.x, o.y, o.r, o.value);
      case "flattenToAverage":
        this.flattenToAverage(o.x, o.y, o.r, o.minAboveSea ?? 0);
        return;
      case "smooth":
        return this.smooth(o.x, o.y, o.r, o.strength);
      case "crater":
        return this.crater(o.x, o.y, o.r, o.height, o.shape);
      case "ridgeLine":
        return this.ridgeLine(o.x, o.y, o.x2, o.y2, o.width, o.aboveSea);
      case "noiseScar":
        return this.noiseScar(o.x, o.y, o.r, o.depth, o.seed);
      case "lowerTowardSea":
        return this.lowerTowardSea(o.x, o.y, o.r, o.amount);
      case "scar":
        return this.scarDisc(o.x, o.y, o.r, o.seconds);
      case "flattenRect":
        this.flattenRect(o.x, o.y, o.w, o.h, o.target, o.step);
        return;
    }
  }

  /**
   * Rects changed after version `since` (a reader's cursor). Returns null when older rects were
   * already trimmed, meaning the reader must rebuild everything. Never mutates terrain state.
   */
  dirtySince(since: number): DirtyRect[] | null {
    if (since >= this.version) return [];
    const first = this.dirty.length ? this.dirty[0].seq : this.version + 1;
    if (first > since + 1) return null;
    return this.dirty.filter((d) => d.seq > since);
  }

  takeDirty(): DirtyRect[] {
    const d = this.dirty;
    this.dirty = [];
    return d;
  }
}

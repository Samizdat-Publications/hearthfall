// Structure-of-arrays entity storage with a LIFO free list and generation counters.
// EntityId = (index | ((generation & 0x7fff) << 16)) >>> 0, index < 65536.
// Columns grow by doubling (copy), which is deterministic. Add columns in COLUMNS and the class.

export type EntityId = number;
export const NO_ENTITY = 0xffffffff;

/** Entity categories. `type` indexes the matching data list (units, buildings) or 0. */
export const CAT = { none: 0, tree: 1, building: 2, unit: 3, effect: 4 } as const;

type Col = Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array | Float64Array;
type ColCtor = new (n: number) => Col;

const COLUMNS: Record<string, ColCtor> = {
  gen: Uint16Array,
  alive: Uint8Array,
  cat: Uint8Array,
  type: Uint16Array,
  tribe: Int8Array,
  x: Float64Array,
  y: Float64Array,
  hp: Float64Array,
  wood: Uint8Array,
  /** generic per-kind state machine value and its timer (ticks) */
  state: Uint8Array,
  timer: Int32Array,
  /** movement (M3): previous position for render interpolation, velocity, order and goal */
  px: Float64Array,
  py: Float64Array,
  vx: Float64Array,
  vy: Float64Array,
  order: Uint8Array,
  gx: Float64Array,
  gy: Float64Array,
  pathPos: Int32Array,
  flowGoal: Int32Array,
  waitPath: Uint8Array,
  stuck: Int32Array,
  best: Float64Array,
  /** economy (M4): settler task, its target entity id, carried wood, building lived in (index, -1 outside) */
  task: Uint8Array,
  target: Uint32Array,
  carry: Uint8Array,
  inside: Int32Array,
  /** buildings: construction or breed progress, flatten target height, dwelling level, occupants */
  progress: Float64Array,
  progress2: Float64Array,
  level: Uint8Array,
  occupants: Uint8Array,
  /** combat (M5): knockback velocity and ticks left, panic and burning ticks, last attacker tribe */
  kvx: Float64Array,
  kvy: Float64Array,
  ktick: Int32Array,
  panic: Int32Array,
  burn: Int32Array,
  lastHit: Int8Array,
};
export const COLUMN_NAMES = Object.keys(COLUMNS);

export class Entities {
  cap: number;
  /** One past the highest index ever used; iterate [0, hi). */
  hi = 0;
  count = 0;
  freeList: number[] = [];
  gen!: Uint16Array;
  alive!: Uint8Array;
  cat!: Uint8Array;
  type!: Uint16Array;
  tribe!: Int8Array;
  x!: Float64Array;
  y!: Float64Array;
  hp!: Float64Array;
  wood!: Uint8Array;
  state!: Uint8Array;
  timer!: Int32Array;
  px!: Float64Array;
  py!: Float64Array;
  vx!: Float64Array;
  vy!: Float64Array;
  order!: Uint8Array;
  gx!: Float64Array;
  gy!: Float64Array;
  pathPos!: Int32Array;
  flowGoal!: Int32Array;
  waitPath!: Uint8Array;
  stuck!: Int32Array;
  best!: Float64Array;
  task!: Uint8Array;
  target!: Uint32Array;
  carry!: Uint8Array;
  inside!: Int32Array;
  progress!: Float64Array;
  progress2!: Float64Array;
  level!: Uint8Array;
  occupants!: Uint8Array;
  kvx!: Float64Array;
  kvy!: Float64Array;
  ktick!: Int32Array;
  panic!: Int32Array;
  burn!: Int32Array;
  lastHit!: Int8Array;

  constructor(cap = 1024) {
    this.cap = cap;
    for (const name of COLUMN_NAMES) (this as unknown as Record<string, Col>)[name] = new COLUMNS[name](cap);
  }

  /** Grow capacity until at least n slots exist. */
  reserve(n: number): void {
    while (this.cap < n) this.grow();
  }

  private grow(): void {
    const next = Math.min(65536, this.cap * 2);
    if (next === this.cap) throw new Error("entity capacity exhausted (65536)");
    const self = this as unknown as Record<string, Col>;
    for (const name of COLUMN_NAMES) {
      const c = new COLUMNS[name](next);
      c.set(self[name] as never);
      self[name] = c;
    }
    this.cap = next;
  }

  alloc(cat: number, type: number, tribe: number, x: number, y: number, hp: number): EntityId {
    let i: number;
    if (this.freeList.length) i = this.freeList.pop()!;
    else {
      if (this.hi >= this.cap) this.grow();
      i = this.hi++;
    }
    this.alive[i] = 1;
    this.cat[i] = cat;
    this.type[i] = type;
    this.tribe[i] = tribe;
    this.x[i] = x;
    this.y[i] = y;
    this.hp[i] = hp;
    this.wood[i] = 0;
    this.state[i] = 0;
    this.timer[i] = 0;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.order[i] = 0;
    this.gx[i] = x;
    this.gy[i] = y;
    this.pathPos[i] = 0;
    this.flowGoal[i] = -1;
    this.waitPath[i] = 0;
    this.stuck[i] = 0;
    this.best[i] = 0;
    this.task[i] = 0;
    this.target[i] = 0xffffffff;
    this.carry[i] = 0;
    this.inside[i] = -1;
    this.progress[i] = 0;
    this.progress2[i] = 0;
    this.level[i] = 0;
    this.occupants[i] = 0;
    this.kvx[i] = 0;
    this.kvy[i] = 0;
    this.ktick[i] = 0;
    this.panic[i] = 0;
    this.burn[i] = 0;
    this.lastHit[i] = -1;
    this.count++;
    return (i | ((this.gen[i] & 0x7fff) << 16)) >>> 0;
  }

  idOf(i: number): EntityId {
    return (i | ((this.gen[i] & 0x7fff) << 16)) >>> 0;
  }

  /** Index of a live entity id, or -1 when the id is stale or dead. */
  index(id: EntityId): number {
    const i = id & 0xffff;
    if (i >= this.hi || !this.alive[i] || (this.gen[i] & 0x7fff) !== (id >>> 16)) return -1;
    return i;
  }

  free(id: EntityId): boolean {
    const i = this.index(id);
    if (i < 0) return false;
    this.alive[i] = 0;
    this.gen[i] = (this.gen[i] + 1) & 0x7fff;
    this.freeList.push(i);
    this.count--;
    return true;
  }

  columns(): Record<string, Col> {
    const self = this as unknown as Record<string, Col>;
    const out: Record<string, Col> = {};
    for (const name of COLUMN_NAMES) out[name] = self[name].subarray(0, this.hi);
    return out;
  }
}

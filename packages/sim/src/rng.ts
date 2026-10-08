// Seeded PRNG: sfc32, one independent stream per purpose so adding a feature that draws from one
// stream never shifts the numbers another stream produces. State is one Uint32Array (hashable,
// snapshot friendly).

export const STREAMS = { terrain: 0, gen: 1, combat: 2, ai: 3, spawn: 4, weather: 5, misc: 6 } as const;
export type StreamName = keyof typeof STREAMS;
const N_STREAMS = 7;

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  readonly state: Uint32Array;

  constructor(seed: number, state?: Uint32Array) {
    this.state = state ? new Uint32Array(state) : new Uint32Array(N_STREAMS * 4);
    if (!state) {
      for (let s = 0; s < N_STREAMS; s++) {
        const sm = splitmix32(Math.imul(seed >>> 0, 0x27d4eb2d) ^ Math.imul(s + 1, 0x165667b1));
        for (let k = 0; k < 4; k++) this.state[s * 4 + k] = sm();
        for (let k = 0; k < 12; k++) this.nextU32(s);
      }
    }
  }

  /** Raw 32-bit output of stream `s`. */
  nextU32(s: number): number {
    const st = this.state;
    const o = s * 4;
    let a = st[o];
    let b = st[o + 1];
    let c = st[o + 2];
    let d = st[o + 3];
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    st[o] = a;
    st[o + 1] = b;
    st[o + 2] = c;
    st[o + 3] = d;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(stream: StreamName): number {
    return this.nextU32(STREAMS[stream]) / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(stream: StreamName, n: number): number {
    return Math.floor(this.float(stream) * n);
  }

  range(stream: StreamName, lo: number, hi: number): number {
    return lo + (hi - lo) * this.float(stream);
  }

  chance(stream: StreamName, p: number): boolean {
    return this.float(stream) < p;
  }
}

/** Stateless integer hash for lattice noise and per-cell decisions (no stream consumption). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

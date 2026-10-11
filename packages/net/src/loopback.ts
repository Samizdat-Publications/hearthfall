// Leg 5: an in-memory transport hub for tests and headless soaks. Messages travel through a virtual clock
// with a seeded random latency, so delivery order between and within peers can shuffle (the relay keeps
// per-sender order; `reorder` also breaks that to stress the core). Deterministic: no Math.random, no clocks.
import type { NetMsg, Transport } from "./lockstep.ts";

export interface LoopbackOptions {
  seed: number;
  /** latency range in virtual time units */
  minLatency: number;
  maxLatency: number;
  /** also shuffle messages from one sender (a relay never does; the core must not care) */
  reorder?: boolean;
}

interface Flight {
  at: number;
  seq: number;
  to: number;
  m: NetMsg;
}

export class LoopbackHub {
  now = 0;
  private s: number;
  private seq = 0;
  private flights: Flight[] = [];
  private readonly handlers: ((m: NetMsg) => void)[] = [];
  /** last delivery time per sender and receiver, to keep sender order when reorder is off */
  private readonly lastAt = new Map<string, number>();
  /** seats whose outgoing messages are dropped (a cut cable) */
  readonly cut = new Set<number>();

  private readonly o: LoopbackOptions;

  constructor(o: LoopbackOptions) {
    this.o = o;
    this.s = o.seed >>> 0 || 1;
  }

  private rnd(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }

  /** The transport for `seat`. */
  connect(seat: number): Transport {
    return {
      send: (m) => {
        if (this.cut.has(seat)) return;
        for (let to = 0; to < this.handlers.length; to++) {
          if (to === seat) continue;
          let at = this.now + this.o.minLatency + this.rnd() * (this.o.maxLatency - this.o.minLatency);
          const key = `${seat}>${to}`;
          if (!this.o.reorder) at = Math.max(at, this.lastAt.get(key) ?? 0);
          this.lastAt.set(key, at);
          // a deep copy, as JSON on a socket would make it
          this.flights.push({ at, seq: this.seq++, to, m: JSON.parse(JSON.stringify(m)) as NetMsg });
        }
      },
      onMessage: (fn) => {
        this.handlers[seat] = fn;
      },
    };
  }

  /** Advance the virtual clock and deliver everything due, in arrival order. */
  pump(dt: number): number {
    this.now += dt;
    const due = this.flights.filter((f) => f.at <= this.now).sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.flights = this.flights.filter((f) => f.at > this.now);
    for (const f of due) this.handlers[f.to]?.(f.m);
    return due.length;
  }

  get inFlight(): number {
    return this.flights.length;
  }
}

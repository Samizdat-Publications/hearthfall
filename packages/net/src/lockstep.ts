// Leg 5 (BACKLOG 15): lockstep over any message transport. Every peer runs the whole sim; only Commands
// cross the wire. A peer sends exactly one batch per tick (empty batches too) `delay` ticks ahead of the tick
// it is running, and a tick runs only when every peer's batch for it is in, so every peer feeds World.step
// the same commands on the same tick. Peers report a state hash every `hashEvery` ticks; a mismatch is a
// desync and stops the match. Pure: no clocks, no timers, no DOM (the driver owns time and the socket).
import type { Command } from "@hearthfall/sim";

export type NetMsg =
  | { t: "batch"; peer: number; tick: number; cmds: Command[] }
  | { t: "hash"; peer: number; tick: number; hash: string };

/** Delivers messages to every other peer (a relay or an in-memory hub). Order between peers is not assumed. */
export interface Transport {
  send(m: NetMsg): void;
  onMessage(fn: (m: NetMsg) => void): void;
}

export interface LockstepOptions {
  /** peers in the match (seat 0 is the host) */
  peers: number;
  /** this peer's seat */
  self: number;
  /** input delay in ticks (at least 1): a command issued while running tick t lands on tick t + delay */
  delay: number;
  /** report and compare the state hash every this many ticks (0: never) */
  hashEvery: number;
  /** ingress rule for a command in `peer`'s batch: why it is dropped, or null to keep it. Every peer runs the same rule, so drops stay in lockstep. */
  filter?: (c: Command, peer: number) => string | null;
}

export interface Desync {
  tick: number;
  /** hash per seat */
  hashes: string[];
}

export class Lockstep {
  /** the next tick to run */
  tick = 0;
  desync: Desync | null = null;
  /** commands dropped by the filter: [tick, peer, reason] */
  readonly refused: [number, number, string][] = [];
  /** protocol problems from peers (late or duplicate batches, bad seats) */
  readonly faults: string[] = [];
  private readonly batches = new Map<number, (Command[] | undefined)[]>();
  private readonly hashes = new Map<number, (string | undefined)[]>();
  private outbox: Omit<Command, "tick">[] = [];
  private sentUpTo: number;
  readonly opts: LockstepOptions;
  private readonly transport: Transport;

  constructor(opts: LockstepOptions, transport: Transport) {
    this.opts = opts;
    this.transport = transport;
    if (opts.delay < 1) throw new Error("lockstep delay must be at least 1 tick");
    if (opts.self < 0 || opts.self >= opts.peers) throw new Error(`seat ${opts.self} outside 0..${opts.peers - 1}`);
    // ticks 0 .. delay-1 run with no commands from anyone
    this.sentUpTo = opts.delay - 1;
    transport.onMessage((m) => this.receive(m));
  }

  /** Queue a local command; it goes out with this peer's next batch. */
  local(c: Omit<Command, "tick">): void {
    this.outbox.push({ tribe: c.tribe, type: c.type, args: c.args });
  }

  /** Send this peer's batches up to tick + delay (the queued commands ride in the first unsent one). */
  flush(): void {
    const last = this.tick + this.opts.delay;
    while (this.sentUpTo < last) {
      const t = ++this.sentUpTo;
      const cmds = this.outbox.map((c) => ({ tick: t, tribe: c.tribe, type: c.type, args: c.args }));
      this.outbox = [];
      this.put(this.opts.self, t, cmds);
      this.transport.send({ t: "batch", peer: this.opts.self, tick: t, cmds });
    }
  }

  /** Seats whose batch for the next tick has not arrived (empty: the tick can run). */
  waitingOn(): number[] {
    if (this.tick < this.opts.delay || this.desync) return this.desync ? [-1] : [];
    const row = this.batches.get(this.tick);
    const out: number[] = [];
    for (let p = 0; p < this.opts.peers; p++) if (!row || !row[p]) out.push(p);
    return out;
  }

  ready(): boolean {
    return !this.desync && this.waitingOn().length === 0;
  }

  /** The commands for the next tick (seat order, then each seat's order) and advance. Throws when not ready. */
  step(): Command[] {
    if (!this.ready()) throw new Error(`tick ${this.tick} is not ready (waiting on ${this.waitingOn().join(", ")})`);
    const row = this.batches.get(this.tick);
    const out: Command[] = [];
    if (row)
      for (let p = 0; p < this.opts.peers; p++)
        for (const c of row[p]!) {
          const why = this.opts.filter ? this.opts.filter(c, p) : null;
          if (why) this.refused.push([this.tick, p, why]);
          else out.push(c);
        }
    this.batches.delete(this.tick);
    this.tick++;
    return out;
  }

  /** True when the tick just run (tick - 1) is a hash tick: the driver then calls reportHash with the state hash. */
  hashDue(): boolean {
    const t = this.tick - 1;
    return this.opts.hashEvery > 0 && t >= 0 && t % this.opts.hashEvery === 0;
  }

  /** This peer's state hash after running `tick`; compared once every seat has reported it. */
  reportHash(tick: number, hash: string): void {
    this.putHash(this.opts.self, tick, hash);
    this.transport.send({ t: "hash", peer: this.opts.self, tick, hash });
  }

  /**
   * Run up to `max` ready ticks: flush, then for each ready tick hand its commands to `run` (which steps the
   * world) and report `hashOf()` on hash ticks. Returns the ticks run (0 when stalled on a peer).
   */
  advance(max: number, run: (cmds: Command[]) => void, hashOf: () => string): number {
    let n = 0;
    this.flush();
    while (n < max && this.ready()) {
      run(this.step());
      n++;
      if (this.hashDue()) this.reportHash(this.tick - 1, hashOf());
      this.flush();
    }
    return n;
  }

  private receive(m: NetMsg): void {
    if (m.peer < 0 || m.peer >= this.opts.peers || m.peer === this.opts.self) {
      this.faults.push(`message from bad seat ${m.peer}`);
      return;
    }
    if (m.t === "batch") {
      if (m.tick < this.tick) this.faults.push(`late batch from seat ${m.peer} for tick ${m.tick} (running ${this.tick})`);
      else this.put(m.peer, m.tick, m.cmds.map((c) => ({ ...c, tick: m.tick })));
    } else if (m.t === "hash") this.putHash(m.peer, m.tick, m.hash);
  }

  private put(peer: number, tick: number, cmds: Command[]): void {
    let row = this.batches.get(tick);
    if (!row) this.batches.set(tick, (row = new Array<Command[] | undefined>(this.opts.peers)));
    if (row[peer]) {
      this.faults.push(`duplicate batch from seat ${peer} for tick ${tick}`);
      return;
    }
    row[peer] = cmds;
  }

  private putHash(peer: number, tick: number, hash: string): void {
    let row = this.hashes.get(tick);
    if (!row) this.hashes.set(tick, (row = new Array<string | undefined>(this.opts.peers)));
    row[peer] = hash;
    for (let p = 0; p < this.opts.peers; p++) if (row[p] === undefined) return;
    this.hashes.delete(tick);
    if (!this.desync && row.some((h) => h !== row[0])) this.desync = { tick, hashes: row as string[] };
  }
}

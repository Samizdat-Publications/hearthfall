// Leg 5 (L5-A): the lockstep core on an in-memory transport with random latency and reordering.
import { describe, expect, it } from "vitest";
import { World, peerCommandRefusal, type Command } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { Lockstep, LoopbackHub, parseNetMsg, type LockstepOptions } from "../src/index.ts";

function pair(o: Partial<LockstepOptions> = {}, hubSeed = 7, reorder = true) {
  const hub = new LoopbackHub({ seed: hubSeed, minLatency: 0, maxLatency: 3, reorder });
  const peers = [0, 1].map((self) => new Lockstep({ peers: 2, self, delay: 2, hashEvery: 10, ...o }, hub.connect(self)));
  return { hub, peers };
}

const cmd = (tribe: number, type = "stop", args: Record<string, unknown> = { units: [] }) => ({ tribe, type, args });

describe("lockstep core", () => {
  it("runs the first delay ticks alone, then waits for every seat's batch", () => {
    const { hub, peers } = pair();
    const [a] = peers;
    a.flush();
    expect(a.step()).toEqual([]);
    expect(a.step()).toEqual([]);
    a.flush();
    // tick 2: seat 0 sent, seat 1 has not
    expect(a.waitingOn()).toEqual([1]);
    expect(() => a.step()).toThrow(/not ready/);
    peers[1].flush();
    hub.pump(10);
    expect(a.ready()).toBe(true);
  });

  it("both seats get the same commands on the same tick, seat order first", () => {
    const { hub, peers } = pair();
    const [a, b] = peers;
    b.local(cmd(1, "stop", { units: [9] }));
    a.local(cmd(0, "stop", { units: [5] }));
    const got: Command[][][] = [[], []];
    for (let frame = 0; frame < 40; frame++) {
      hub.pump(1);
      peers.forEach((p, k) => p.advance(4, (c) => got[k].push(c), () => "h"));
    }
    expect(a.tick).toBeGreaterThan(10);
    const n = Math.min(got[0].length, got[1].length);
    expect(got[0].slice(0, n)).toEqual(got[1].slice(0, n));
    const landed = got[0].findIndex((c) => c.length > 0);
    expect(landed).toBe(2);
    expect(got[0][2].map((c) => [c.tribe, c.tick])).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it("the filter drops a peer command on every seat alike", () => {
    const filter = (c: Command, peer: number) => peerCommandRefusal(c, peer);
    const { hub, peers } = pair({ filter });
    peers[1].local(cmd(0)); // seat 1 tries to command tribe 0
    peers[1].local(cmd(-1)); // and god mode
    const got: Command[][] = [[], []];
    for (let frame = 0; frame < 20; frame++) {
      hub.pump(1);
      peers.forEach((p, k) => p.advance(4, (c) => got[k].push(...c), () => "h"));
    }
    expect(got[0]).toEqual([]);
    expect(got[1]).toEqual([]);
    for (const p of peers) expect(p.refused.map((r) => r[1])).toEqual([1, 1]);
  });

  it("records late, duplicate and bad-seat batches as faults and ignores them", () => {
    const { peers } = pair();
    const [a] = peers;
    const recv = (m: unknown) => (a as unknown as { receive(m: unknown): void }).receive(m);
    a.flush();
    a.step();
    recv({ t: "batch", peer: 1, tick: 0, cmds: [] });
    recv({ t: "batch", peer: 1, tick: 5, cmds: [] });
    recv({ t: "batch", peer: 1, tick: 5, cmds: [] });
    recv({ t: "batch", peer: 3, tick: 6, cmds: [] });
    expect(a.faults.length).toBe(3);
  });

  it("parseNetMsg keeps well formed messages and drops the rest", () => {
    expect(parseNetMsg('{"t":"batch","peer":1,"tick":4,"cmds":[{"tick":99,"tribe":1,"type":"stop","args":{}}]}')).toEqual({ t: "batch", peer: 1, tick: 4, cmds: [{ tick: 4, tribe: 1, type: "stop", args: {} }] });
    expect(parseNetMsg({ t: "hash", peer: 0, tick: 10, hash: "abc" })).toEqual({ t: "hash", peer: 0, tick: 10, hash: "abc" });
    for (const bad of ["nope", "{}", '{"t":"batch","peer":-1,"tick":0,"cmds":[]}', '{"t":"batch","peer":0,"tick":0,"cmds":[{"tribe":0,"type":"x","args":[]}]}', '{"t":"hash","peer":0,"tick":1.5,"hash":"a"}'])
      expect(parseNetMsg(bad)).toBeNull();
  });
});

/**
 * A seat bot: it runs on one peer only, so it must never draw from the world's rng (that is hashed state).
 * It orders its tribe's settlers and wardens around with its own xorshift.
 */
function seatBot(tribe: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    tribe,
    every: 30,
    offset: tribe * 7,
    decide(): Omit<Command, "tick">[] {
      const kind = rnd() < 0.5 ? "settlers" : "units";
      if (rnd() < 0.15) return [{ tribe, type: "stop", args: { units: `tribe${tribe}.${kind}` } }];
      return [{ tribe, type: "move", args: { units: `tribe${tribe}.${kind}`, to: [Math.floor(rnd() * 128), Math.floor(rnd() * 128)] } }];
    },
  };
}

/** Two seats, each with its own world and a seat bot for its own tribe whose commands go through the lockstep. */
function botMatch(ticks: number, hubSeed: number, tamper?: { seat: number; tick: number }) {
  const p = basePack();
  const init = { pack: p.files, packHash: p.hash, seed: 4242, map: { generator: "continents", size: 128, tribes: 2 } } as const;
  const hub = new LoopbackHub({ seed: hubSeed, minLatency: 0, maxLatency: 4, reorder: true });
  const seats = [0, 1].map((self) => {
    const w = new World(init);
    const bot = seatBot(self, 99 + self);
    const ls = new Lockstep({ peers: 2, self, delay: 3, hashEvery: 20 }, hub.connect(self));
    return { w, bot, ls, log: [] as Command[][] };
  });
  let frames = 0;
  while (seats.some((s) => s.ls.tick < ticks) && frames < ticks * 6 && !seats.some((s) => s.ls.desync)) {
    frames++;
    hub.pump(1);
    for (const [k, s] of seats.entries()) {
      if (s.ls.tick >= ticks) continue;
      const { w, bot, ls } = s;
      if (w.tick === ls.tick && w.tick % bot.every === bot.offset) for (const c of bot.decide()) ls.local(c);
      ls.advance(1 + ((frames + k) % 3), (cmds) => {
        s.log.push(cmds);
        w.step(cmds);
        // a bug stand-in: one seat's land drifts outside the command stream
        if (tamper && tamper.seat === k && w.tick === tamper.tick) w.terrain.heights[0] += 1;
      }, () => w.hash().all);
    }
  }
  return { seats, init };
}

describe("lockstep bot match", () => {
  it("two seats with bots stay in step through 3 minutes of random latency and reordering, and match a replay", () => {
    const { seats, init } = botMatch(3600, 11);
    for (const s of seats) {
      expect(s.ls.desync).toBeNull();
      expect(s.ls.faults).toEqual([]);
      expect(s.ls.tick).toBe(3600);
    }
    const [a, b] = seats;
    expect(a.w.hash().all).toBe(b.w.hash().all);
    expect(a.log.filter((c) => c.length).length).toBeGreaterThan(20);
    // a replay of the agreed command stream on a fresh world lands on the same state
    const r = new World(init);
    for (const cmds of a.log) r.step(cmds);
    expect(r.hash().all).toBe(a.w.hash().all);
  }, 60000);

  it("a world that drifts is caught as a desync within one hash interval", () => {
    const { seats } = botMatch(1200, 3, { seat: 1, tick: 300 });
    const d = seats[0].ls.desync ?? seats[1].ls.desync;
    expect(d).not.toBeNull();
    expect(d!.tick).toBeGreaterThanOrEqual(300);
    expect(d!.tick).toBeLessThanOrEqual(300 + 20);
    expect(d!.hashes[0]).not.toBe(d!.hashes[1]);
  }, 60000);
});

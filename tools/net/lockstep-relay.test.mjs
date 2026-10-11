// Leg 5 (L5-B gate): two seats, each with its own world, play in lockstep through the real relay over
// sockets (Node's WebSocket client), and end on the same state hash.
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { Relay } from "./relay.mjs";
import { Lockstep, RelayClient } from "../../packages/net/src/index.ts";
import { World } from "../../packages/sim/src/index.ts";
import { basePack } from "../../packages/sim/test/helpers.ts";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("lockstep over the LAN relay", () => {
  it("two seats host, join, start and stay in step for 1200 ticks", async () => {
    const server = createServer((_q, r) => r.writeHead(404).end());
    new Relay().attach(server);
    const sockets = new Set();
    server.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `ws://127.0.0.1:${server.address().port}/net`;
    const started = [];
    const clients = [0, 1].map(() => {
      const ws = new WebSocket(url);
      let seen = null;
      const c = new RelayClient(ws, { start: (p) => (seen = p) });
      started.push(() => seen);
      return { ws, c, open: new Promise((r) => ws.addEventListener("open", () => r())) };
    });
    try {
      await Promise.all(clients.map((x) => x.open));
      const [host, peer] = clients.map((x) => x.c);
      host.host(2);
      while (!host.code) await tick();
      peer.join(host.code);
      while (host.present.length < 2) await tick();
      const p = basePack();
      host.start({ seed: 31, size: 128 });
      while (!started[1]()) await tick();
      const params = started[1]();
      const seats = [host, peer].map((rc) => {
        const w = new World({ pack: p.files, packHash: p.hash, seed: params.seed, map: { generator: "continents", size: params.size, tribes: 2 } });
        const ls = new Lockstep({ peers: 2, self: rc.seat, delay: 3, hashEvery: 20 }, rc.transport());
        return { w, ls, rc };
      });
      for (let frame = 0; frame < 20000 && seats.some((s) => s.ls.tick < 1200); frame++) {
        for (const s of seats) {
          if (s.ls.tick % 60 === 0 && s.ls.tick < 1200) s.ls.local({ tribe: s.rc.seat, type: "move", args: { units: `tribe${s.rc.seat}.settlers`, to: [(s.ls.tick * 7) % 128, (s.ls.tick * 3) % 128] } });
          if (s.ls.tick < 1200) s.ls.advance(Math.min(5, 1200 - s.ls.tick), (cmds) => s.w.step(cmds), () => s.w.hash().all);
        }
        await tick();
      }
      for (const s of seats) {
        expect(s.ls.desync).toBeNull();
        expect(s.ls.faults).toEqual([]);
        expect(s.rc.dropped).toBe(0);
        expect(s.ls.tick).toBe(1200);
      }
      expect(seats[0].w.hash().all).toBe(seats[1].w.hash().all);
    } finally {
      for (const x of clients) x.ws.close();
      await new Promise((r) => {
        server.close(() => r());
        for (const s of sockets) s.destroy();
      });
    }
  }, 60000);
});

// Leg 5 (L5-B): the LAN relay over real sockets (Node's built-in WebSocket client against tools/net/relay.mjs).
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { FrameReader, Relay, acceptKey, encodeFrame } from "./relay.mjs";

function listen() {
  const server = createServer((_q, r) => r.writeHead(404).end());
  const relay = new Relay().attach(server);
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      done({
        relay,
        url: `ws://127.0.0.1:${port}/net`,
        port,
        close: () => new Promise((r) => {
          server.close(() => r());
          for (const s of sockets) s.destroy();
        }),
      });
    }),
  );
}

/** A client that queues every message so tests can await the next one of an op. */
function client(url) {
  const ws = new WebSocket(url);
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const w = waiters.findIndex((x) => x.op === m.op);
    if (w >= 0) waiters.splice(w, 1)[0].done(m);
    else inbox.push(m);
  });
  const next = (op) => {
    const k = inbox.findIndex((m) => m.op === op);
    if (k >= 0) return Promise.resolve(inbox.splice(k, 1)[0]);
    return new Promise((done, fail) => {
      waiters.push({ op, done });
      setTimeout(() => fail(new Error(`no ${op} message`)), 3000);
    });
  };
  const opened = new Promise((r) => ws.addEventListener("open", () => r()));
  return { ws, next, opened, send: (m) => ws.send(JSON.stringify(m)), inbox };
}

describe("LAN relay", () => {
  it("computes the RFC 6455 accept key", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("frame reader unmasks, joins fragments and refuses unmasked or oversized frames", () => {
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = (op, fin, text) => {
      const p = Buffer.from(text);
      const body = Buffer.from(p.map((b, i) => b ^ mask[i & 3]));
      return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | p.length]), mask, body]);
    };
    const r = new FrameReader(100);
    const both = Buffer.concat([masked(1, false, "hel"), masked(0, true, "lo")]);
    // split mid-frame to check buffering
    expect(r.push(both.subarray(0, 5))).toEqual([]);
    const got = r.push(both.subarray(5));
    expect(got.map((f) => [f.opcode, f.payload.toString()])).toEqual([[1, "hello"]]);
    expect(() => new FrameReader().push(encodeFrame("x"))).toThrow(/masked/);
    expect(() => new FrameReader(10).push(masked(1, true, "x".repeat(20)))).toThrow(/too large/);
  });

  it("hosts, joins, starts and relays messages in order between seats", async () => {
    const s = await listen();
    const a = client(s.url);
    const b = client(s.url);
    try {
      await Promise.all([a.opened, b.opened]);
      a.send({ op: "host", seats: 2 });
      const room = await a.next("room");
      expect(room).toMatchObject({ seat: 0, seats: 2 });
      expect(room.code).toMatch(/^[A-Z]{4}$/);
      b.send({ op: "join", code: room.code.toLowerCase() });
      expect(await b.next("room")).toMatchObject({ seat: 1, code: room.code });
      expect((await a.next("joined")).present).toEqual([0, 1]);
      b.send({ op: "start", params: {} });
      expect((await b.next("error")).why).toMatch(/only the host/);
      a.send({ op: "start", params: { seed: 7 } });
      expect((await b.next("start")).params).toEqual({ seed: 7 });
      for (let k = 0; k < 20; k++) b.send({ op: "msg", data: { k } });
      const seen = [];
      for (let k = 0; k < 20; k++) seen.push((await a.next("msg")).data.k);
      expect(seen).toEqual([...Array(20).keys()]);
      // the sender does not get its own messages back
      expect(b.inbox.filter((m) => m.op === "msg")).toEqual([]);
      // a third socket cannot join a started match
      const c = client(s.url);
      await c.opened;
      c.send({ op: "join", code: room.code });
      expect((await c.next("error")).why).toMatch(/started/);
      c.ws.close();
      b.ws.close();
      expect((await a.next("left")).seat).toBe(1);
    } finally {
      a.ws.close();
      b.ws.close();
      await s.close();
    }
  });

  it("refuses unknown codes, bad seat counts and non-relay upgrade paths, and drops empty rooms", async () => {
    const s = await listen();
    const a = client(s.url);
    try {
      await a.opened;
      a.send({ op: "join", code: "ZZZZ" });
      expect((await a.next("error")).why).toMatch(/no room/);
      a.send({ op: "host", seats: 9 });
      expect((await a.next("error")).why).toMatch(/2 to 4/);
      a.send({ op: "host", seats: 2 });
      await a.next("room");
      expect(s.relay.rooms.size).toBe(1);
      a.ws.close();
      for (let k = 0; k < 50 && s.relay.rooms.size; k++) await new Promise((r) => setTimeout(r, 20));
      expect(s.relay.rooms.size).toBe(0);
      const bad = new WebSocket(`ws://127.0.0.1:${s.port}/other`);
      const failed = await new Promise((r) => {
        bad.addEventListener("error", () => r(true));
        bad.addEventListener("open", () => r(false));
      });
      expect(failed).toBe(true);
    } finally {
      a.ws.close();
      await s.close();
    }
  });
});

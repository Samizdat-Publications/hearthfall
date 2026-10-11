// Leg 5 (L5-B): the LAN relay. A small WebSocket endpoint (RFC 6455 handshake and framing written here, so
// no new dependency) that groups sockets into rooms by a short code and fans each message out to the other
// seats in arrival order. It holds no game logic: the lockstep core in packages/net runs in every browser.
// Mounted at /net on `npm run serve` (tools/harness/serve.mjs).
//
// Protocol (JSON text frames). Client to relay:
//   {op:"host", seats}        open a room for `seats` players (2 to 4); reply {op:"room", code, seat:0, seats}
//   {op:"join", code}         take the next free seat; reply {op:"room", code, seat, seats}, everyone gets {op:"joined", seat, present}
//   {op:"start", params}      host only: everyone gets {op:"start", params}; the room takes no more joins
//   {op:"msg", data}          every other seat gets {op:"msg", from, data} (data is opaque here)
// Relay to client on problems: {op:"error", why}. When a socket closes the others get {op:"left", seat}.
import { createHash, randomInt } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const MAX_FRAME = 64 * 1024;
const MAX_ROOMS = 64;
const CODE_LETTERS = "ACDEFHJKMNPRTUVWXY";

/** The Sec-WebSocket-Accept value for a client key (RFC 6455 section 4.2.2). */
export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/** One unmasked server frame (fin set). */
export function encodeFrame(payload, opcode = 1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const n = body.length;
  const head = n < 126 ? Buffer.alloc(2) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (n < 126) head[1] = n;
  else if (n < 65536) {
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, body]);
}

/**
 * Incremental frame parser for client frames (which must be masked). push(chunk) returns complete frames
 * {opcode, payload}; fragmented messages are joined. Throws on a protocol error (the socket is then dropped).
 */
export class FrameReader {
  constructor(maxFrame = MAX_FRAME) {
    this.buf = Buffer.alloc(0);
    this.max = maxFrame;
    this.parts = [];
    this.partOp = 0;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const fin = (this.buf[0] & 0x80) !== 0;
      const opcode = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) break;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) break;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.max)) throw new Error("frame too large");
        len = Number(big);
        at = 10;
      }
      if (!masked) throw new Error("client frames must be masked");
      if (len > this.max) throw new Error("frame too large");
      if (this.buf.length < at + 4 + len) break;
      const mask = this.buf.subarray(at, at + 4);
      const payload = Buffer.from(this.buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(at + 4 + len);
      if (opcode === 0) {
        if (!this.partOp) throw new Error("continuation without a first fragment");
        this.parts.push(payload);
        if (this.parts.reduce((s, p) => s + p.length, 0) > this.max) throw new Error("message too large");
        if (fin) {
          out.push({ opcode: this.partOp, payload: Buffer.concat(this.parts) });
          this.parts = [];
          this.partOp = 0;
        }
      } else if (opcode >= 8) out.push({ opcode, payload });
      else if (fin) out.push({ opcode, payload });
      else {
        this.partOp = opcode;
        this.parts = [payload];
      }
    }
    return out;
  }
}

export class Relay {
  constructor(opts = {}) {
    this.path = opts.path ?? "/net";
    this.rooms = new Map();
    this.log = opts.log ?? (() => {});
  }

  /** Answer WebSocket upgrades on `path` of an http server; other upgrade requests are refused. */
  attach(server) {
    server.on("upgrade", (req, socket) => this.upgrade(req, socket));
    return this;
  }

  upgrade(req, socket) {
    const url = (req.url ?? "").split("?")[0];
    const key = req.headers["sec-websocket-key"];
    if (url !== this.path || typeof key !== "string" || (req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
    socket.setNoDelay(true);
    const client = { socket, reader: new FrameReader(), room: null, seat: -1, open: true };
    socket.on("data", (chunk) => {
      let frames;
      try {
        frames = client.reader.push(chunk);
      } catch (e) {
        this.drop(client, 1002, String(e.message));
        return;
      }
      for (const f of frames) this.frame(client, f);
    });
    socket.on("close", () => this.gone(client));
    socket.on("error", () => this.gone(client));
  }

  frame(client, f) {
    if (f.opcode === 8) return this.drop(client, 1000, "");
    if (f.opcode === 9) return this.raw(client, encodeFrame(f.payload, 10));
    if (f.opcode !== 1) return;
    let m;
    try {
      m = JSON.parse(f.payload.toString("utf8"));
    } catch {
      return this.send(client, { op: "error", why: "not JSON" });
    }
    this.handle(client, m);
  }

  handle(client, m) {
    if (!m || typeof m !== "object") return this.send(client, { op: "error", why: "not an object" });
    if (m.op === "host") {
      if (client.room) return this.send(client, { op: "error", why: "already in a room" });
      const seats = Number(m.seats ?? 2);
      if (!Number.isInteger(seats) || seats < 2 || seats > 4) return this.send(client, { op: "error", why: "seats must be 2 to 4" });
      if (this.rooms.size >= MAX_ROOMS) return this.send(client, { op: "error", why: "the relay is full" });
      let code;
      do code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
      while (this.rooms.has(code));
      const room = { code, seats, members: [client], started: false };
      this.rooms.set(code, room);
      client.room = room;
      client.seat = 0;
      this.log(`room ${code} opened for ${seats}`);
      return this.send(client, { op: "room", code, seat: 0, seats });
    }
    if (m.op === "join") {
      if (client.room) return this.send(client, { op: "error", why: "already in a room" });
      const room = this.rooms.get(String(m.code ?? "").toUpperCase());
      if (!room) return this.send(client, { op: "error", why: "no room with that code" });
      if (room.started) return this.send(client, { op: "error", why: "that match has already started" });
      const seat = room.members.findIndex((c) => !c);
      const at = seat >= 0 ? seat : room.members.length;
      if (at >= room.seats) return this.send(client, { op: "error", why: "that room is full" });
      room.members[at] = client;
      client.room = room;
      client.seat = at;
      this.send(client, { op: "room", code: room.code, seat: at, seats: room.seats });
      return this.broadcast(room, { op: "joined", seat: at, present: this.present(room) });
    }
    if (!client.room) return this.send(client, { op: "error", why: "host or join a room first" });
    if (m.op === "start") {
      if (client.seat !== 0) return this.send(client, { op: "error", why: "only the host starts the match" });
      client.room.started = true;
      return this.broadcast(client.room, { op: "start", params: m.params ?? null });
    }
    if (m.op === "msg") return this.broadcast(client.room, { op: "msg", from: client.seat, data: m.data }, client);
    return this.send(client, { op: "error", why: `unknown op ${String(m.op)}` });
  }

  present(room) {
    return room.members.map((c, k) => (c ? k : -1)).filter((k) => k >= 0);
  }

  broadcast(room, m, except = null) {
    const frame = encodeFrame(JSON.stringify(m));
    for (const c of room.members) if (c && c !== except) this.raw(c, frame);
  }

  send(client, m) {
    this.raw(client, encodeFrame(JSON.stringify(m)));
  }

  raw(client, frame) {
    if (client.open && !client.socket.destroyed) client.socket.write(frame);
  }

  drop(client, code, why) {
    if (!client.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(why));
    body.writeUInt16BE(code, 0);
    body.write(why, 2);
    this.raw(client, encodeFrame(body, 8));
    client.socket.end();
    this.gone(client);
  }

  gone(client) {
    if (!client.open) return;
    client.open = false;
    const room = client.room;
    if (!room) return;
    room.members[client.seat] = null;
    if (room.members.every((c) => !c)) {
      this.rooms.delete(room.code);
      this.log(`room ${room.code} closed`);
    } else this.broadcast(room, { op: "left", seat: client.seat });
  }
}

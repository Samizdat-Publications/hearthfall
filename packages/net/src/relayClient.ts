// Leg 5 (L5-B): the browser (or Node) side of the LAN relay (tools/net/relay.mjs). It speaks the room
// protocol over any WebSocket-like object handed in (no globals here) and exposes a lockstep Transport whose
// incoming messages are wire checked and must come from the seat the relay says sent them.
import type { NetMsg, Transport } from "./lockstep.ts";
import { parseNetMsg } from "./wire.ts";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: "message", fn: (e: { data: unknown }) => void): void;
  addEventListener(type: "close", fn: () => void): void;
}

export interface RelayEvents {
  room?(code: string, seat: number, seats: number): void;
  joined?(present: number[]): void;
  start?(params: unknown): void;
  left?(seat: number): void;
  /** L5-F: a seat that dropped came back (rejoin) */
  back?(seat: number): void;
  /** L5-F: a match control message from another seat (snapshot chunks) */
  ctl?(from: number, data: unknown): void;
  error?(why: string): void;
  closed?(): void;
}

export class RelayClient {
  seat = -1;
  seats = 0;
  code = "";
  present: number[] = [];
  started = false;
  closed = false;
  /** messages dropped by the wire check or for a forged seat */
  dropped = 0;
  private readonly sock: SocketLike;
  private readonly on: RelayEvents;
  private handler: ((m: NetMsg) => void) | null = null;
  /** lockstep messages that arrived before the transport was wired */
  private early: NetMsg[] = [];

  constructor(sock: SocketLike, on: RelayEvents = {}) {
    this.sock = sock;
    this.on = on;
    sock.addEventListener("message", (e) => this.receive(e.data));
    sock.addEventListener("close", () => {
      this.closed = true;
      this.on.closed?.();
    });
  }

  host(seats: number): void {
    this.sock.send(JSON.stringify({ op: "host", seats }));
  }

  join(code: string): void {
    this.sock.send(JSON.stringify({ op: "join", code: code.trim().toUpperCase() }));
  }

  /** L5-F: take a seat back in a started match after the socket dropped */
  rejoin(code: string, seat: number): void {
    this.sock.send(JSON.stringify({ op: "rejoin", code: code.trim().toUpperCase(), seat }));
  }

  /** L5-F: send a match control message to the other seats */
  sendCtl(data: unknown): void {
    this.sock.send(JSON.stringify({ op: "ctl", data }));
  }

  start(params: unknown): void {
    this.sock.send(JSON.stringify({ op: "start", params }));
  }

  close(): void {
    this.sock.close();
  }

  /** The lockstep transport over this room. */
  transport(): Transport {
    return {
      send: (m) => this.sock.send(JSON.stringify({ op: "msg", data: m })),
      onMessage: (fn) => {
        this.handler = fn;
        for (const m of this.early) fn(m);
        this.early = [];
      },
    };
  }

  private receive(raw: unknown): void {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(String(raw)) as Record<string, unknown>;
    } catch {
      this.dropped++;
      return;
    }
    switch (m.op) {
      case "room":
        this.code = String(m.code);
        this.seat = Number(m.seat);
        this.seats = Number(m.seats);
        this.present = Array.isArray(m.present) ? (m.present as number[]) : [this.seat];
        if (m.started === true) this.started = true;
        this.on.room?.(this.code, this.seat, this.seats);
        break;
      case "joined":
        this.present = Array.isArray(m.present) ? (m.present as number[]) : this.present;
        this.on.joined?.(this.present);
        break;
      case "start":
        this.started = true;
        this.on.start?.(m.params);
        break;
      case "left":
        this.present = this.present.filter((s) => s !== m.seat);
        this.on.left?.(Number(m.seat));
        break;
      case "back":
        this.present = Array.isArray(m.present) ? (m.present as number[]) : this.present;
        this.on.back?.(Number(m.seat));
        break;
      case "ctl":
        if (typeof m.from === "number") this.on.ctl?.(m.from, m.data);
        else this.dropped++;
        break;
      case "error":
        this.on.error?.(String(m.why));
        break;
      case "msg": {
        const msg = parseNetMsg(m.data);
        // the relay stamps the sender's seat; a message claiming another seat is forged
        if (!msg || msg.peer !== m.from) {
          this.dropped++;
          return;
        }
        if (this.handler) this.handler(msg);
        else this.early.push(msg);
        break;
      }
      default:
        this.dropped++;
    }
  }
}

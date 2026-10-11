// Leg 5 (L5-C): a LAN match in the app. The lobby runs over the relay (tools/net/relay.mjs at /net on
// `npm run serve`): the host opens a room and shows its code, the partner joins with it, and the host's Start
// sends the skirmish params so both pages build the same world. Then every order goes through the lockstep
// core (packages/net) instead of the local queue, and Game.frame steps the world only on ticks every seat has
// sent. Kept apart from game.ts so the lobby and seat rules are unit tested without a renderer.
import { Lockstep, RelayClient, type SocketLike } from "@hearthfall/net";
import { peerCommandRefusal, type Command } from "@hearthfall/sim";
import type { SkirmishParams } from "./session.ts";

export interface NetConfig {
  inputDelayTicks: number;
  hashEveryTicks: number;
  stallNoticeSeconds: number;
  /** L5-F: how long the host waits for a dropped partner to rejoin before the AI takes their tribe */
  rejoinWaitSeconds: number;
  /** L5-F: how many times (one second apart) a dropped partner page tries to rejoin */
  reconnectTries: number;
}

export const NET_DEFAULTS: NetConfig = { inputDelayTicks: 4, hashEveryTicks: 20, stallNoticeSeconds: 2, rejoinWaitSeconds: 30, reconnectTries: 10 };

/** L5-F: snapshot text goes out in chunks well under the relay's 64 KB frame cap */
export const SNAP_CHUNK = 32000;

/** reconnecting: this page lost the relay mid-match and is rejoining; resyncing: rejoined, waiting for the host's snapshot */
export type NetState = "connecting" | "lobby" | "playing" | "reconnecting" | "resyncing" | "closed";

/** The relay URL next to the page (ws on http, wss on https). */
export function relayUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/net`;
}

/**
 * Head to head over LAN: seat k plays tribe k, the other tribes keep the setup's opponents. The match has at
 * least as many tribes as seats.
 */
export function versusParams(sp: SkirmishParams, seats: number): SkirmishParams {
  const tribes = Math.max(sp.tribes, seats);
  return { ...sp, tribes, humans: Array.from({ length: seats }, (_, k) => k), campaign: undefined };
}

/**
 * Leg 5 (L5-E): together against the AI. The seats share team 0 and play the first tribes; every AI rival of
 * the setup joins, all on team 1, so the match has seats + rivals tribes.
 */
export function coopParams(sp: SkirmishParams, seats: number): SkirmishParams {
  const rivals = Math.max(1, sp.tribes - 1);
  const tribes = seats + rivals;
  return { ...sp, tribes, humans: Array.from({ length: seats }, (_, k) => k), teams: Array.from({ length: tribes }, (_, t) => (t < seats ? 0 : 1)), campaign: undefined };
}

/**
 * The ingress rule every seat applies to every batch: the host (seat 0) may also send god-mode (tribe -1)
 * commands (debug tools); any seat may command only its own tribe (BACKLOG 46).
 */
export function seatFilter(humans: readonly number[]): (c: Command, seat: number) => string | null {
  return (c, seat) => (seat === 0 && c.tribe === -1 ? null : peerCommandRefusal(c, humans[seat] ?? -2));
}

/** The start message the host sends; checked on arrival (a partner page trusts nothing it cannot rebuild). */
export function parseStart(v: unknown): SkirmishParams | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<SkirmishParams>;
  const int = (x: unknown) => typeof x === "number" && Number.isInteger(x);
  if (!int(p.seed) || !int(p.size) || !int(p.tribes) || typeof p.level !== "string" || typeof p.difficulty !== "string" || !Array.isArray(p.ai)) return null;
  if (!Array.isArray(p.humans) || !p.humans.every(int)) return null;
  if (p.teams !== undefined && (!Array.isArray(p.teams) || p.teams.length !== p.tribes || !p.teams.every(int))) return null;
  return p as SkirmishParams;
}

/** L5-F: what a page saves when a desync stops the match (the end screen offers it as a download) */
export interface DesyncReport {
  kind: "hearthfall-desync";
  seat: number;
  tick: number;
  hashes: string[];
  params: SkirmishParams | null;
  /** the commands of the last ticks run, oldest first */
  recent: Command[];
}

export function desyncReport(seat: number, d: { tick: number; hashes: string[] }, params: SkirmishParams | null, recent: readonly Command[]): DesyncReport {
  return { kind: "hearthfall-desync", seat, tick: d.tick, hashes: [...d.hashes], params, recent: recent.map((c) => ({ ...c })) };
}

/** commands kept for a desync report */
const RECENT = 400;

export interface NetEvents {
  /** the lobby or match changed (the menus redraw) */
  changed(): void;
  /** the host pressed Start: build this world and play tribe `tribe` */
  started(params: SkirmishParams, tribe: number): void;
  /** a seat left or the socket closed during a match, and it is not coming back: the AI takes over */
  lost(why: "partnerLeft" | "closed"): void;
  /** L5-F (host): a dropped seat is back; the encoded save of the world now, and its tick */
  snapshot(): { text: string; tick: number };
  /** L5-F (rejoining page): load this encoded save; its tick, or null when it cannot be loaded */
  resume(text: string): number | null;
}

type Sock = SocketLike & { addEventListener(type: "open", fn: () => void): void };
export type SocketFactory = () => Sock;

export class NetPlay {
  state: NetState = "connecting";
  message: string | null = null;
  ls: Lockstep | null = null;
  params: SkirmishParams | null = null;
  /** seconds the match has been waiting on a partner's batch (the HUD shows it past stallNoticeSeconds) */
  stalled = 0;
  /** L5-F (host): seats that dropped mid-match and may rejoin, and how long the first has been gone */
  readonly away = new Set<number>();
  awayFor = 0;
  /** L5-F: rejoin attempts made since this page lost the relay */
  tries = 0;
  /** L5-F: resyncs this match went through (tests and the debug hook read it) */
  resyncs = 0;
  /** L5-F: the commands of the last ticks run (for a desync report) */
  readonly recent: Command[] = [];
  client: RelayClient;
  readonly cfg: NetConfig;
  private readonly ev: NetEvents;
  private readonly reopen: SocketFactory | null;
  private role: "host" | "join" | null = null;
  private opened = false;
  private pendingCode = "";
  /** this page's seat in the match (kept across a reconnect) */
  private seat = -1;
  private snap: { id: number; parts: (string | undefined)[]; got: number } | null = null;
  private snapId = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  /** seats that said they are leaving on purpose (no rejoin wait for them) */
  private readonly byes = new Set<number>();

  constructor(sock: Sock, cfg: Partial<NetConfig>, ev: NetEvents, reopen: SocketFactory | null = null) {
    this.cfg = { ...NET_DEFAULTS, ...cfg };
    this.ev = ev;
    this.reopen = reopen;
    this.client = this.wire(sock);
  }

  private wire(sock: Sock): RelayClient {
    const client: RelayClient = new RelayClient(sock, {
      room: () => {
        if (this.client !== client) return;
        if (this.state === "reconnecting") {
          // back in the started match: wait for the host's snapshot
          this.state = "resyncing";
          this.message = null;
        } else {
          this.state = "lobby";
          this.message = null;
        }
        this.ev.changed();
      },
      joined: () => this.ev.changed(),
      start: (p) => this.begin(p),
      left: (seat) => {
        if (this.client !== client) return;
        if (this.state === "playing") {
          if (this.isHost && this.cfg.rejoinWaitSeconds > 0 && !this.byes.has(seat)) {
            if (!this.away.size) this.awayFor = 0;
            this.away.add(seat);
          } else this.ev.lost("partnerLeft");
        }
        this.ev.changed();
      },
      back: (seat) => {
        if (this.client !== client) return;
        this.away.delete(seat);
        if (this.state === "playing" && this.isHost) this.resync();
        this.ev.changed();
      },
      ctl: (from, data) => {
        if (this.client !== client) return;
        if ((data as { k?: unknown } | null)?.k === "bye") this.byes.add(from);
        else if (from === 0) this.onCtl(data);
      },
      error: (why) => {
        if (this.client !== client) return;
        this.message = why;
        // a refused rejoin: drop this socket, the close handler tries again
        if (this.state === "reconnecting") client.close();
        this.ev.changed();
      },
      closed: () => {
        if (this.client !== client) return;
        const was = this.state;
        const inMatch = was === "playing" || was === "reconnecting" || was === "resyncing";
        if (inMatch && !this.isHost && this.reopen) return this.reconnect();
        this.state = "closed";
        if (inMatch) this.ev.lost("closed");
        else if (!this.message) this.message = "The connection to the host closed.";
        this.ev.changed();
      },
    });
    this.opened = false;
    sock.addEventListener("open", () => {
      if (this.client !== client) return;
      this.opened = true;
      if (this.state === "reconnecting") client.rejoin(this.pendingCode, this.seat);
      else if (this.role === "host") client.host(2);
      else if (this.role === "join" && this.pendingCode) client.join(this.pendingCode);
    });
    return client;
  }

  /** Open a room (the code shows when the relay answers). */
  host(): void {
    this.role = "host";
    if (this.opened) this.client.host(2);
  }

  join(code: string): void {
    this.role = "join";
    this.pendingCode = code;
    if (this.opened) this.client.join(code);
  }

  get isHost(): boolean {
    return (this.seat >= 0 ? this.seat : this.client.seat) === 0;
  }

  /** The host starts once every seat is present. */
  canStart(): boolean {
    return this.isHost && this.state === "lobby" && this.client.present.length >= this.client.seats;
  }

  /** The host's Start: head to head (versus) or one team against the setup's AI rivals (coop). */
  start(sp: SkirmishParams, mode: "versus" | "coop" = "versus"): void {
    if (!this.canStart()) return;
    this.client.start(mode === "coop" ? coopParams(sp, this.client.seats) : versusParams(sp, this.client.seats));
  }

  leave(): void {
    // a partner who quits on purpose says so, so the host does not wait for a rejoin
    if (this.state === "playing" && !this.client.closed) this.client.sendCtl({ k: "bye" });
    this.state = "closed";
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.client.close();
  }

  /** Run up to `max` agreed ticks (`run` steps the world); 0 while not playing. Keeps the recent commands. */
  advance(max: number, run: (cmds: Command[]) => void, hashOf: () => string): number {
    if (this.state !== "playing" || !this.ls) return 0;
    return this.ls.advance(
      max,
      (cmds) => {
        for (const c of cmds) this.recent.push(c);
        if (this.recent.length > RECENT) this.recent.splice(0, this.recent.length - RECENT);
        run(cmds);
      },
      hashOf,
    );
  }

  /** Debug and e2e: drop this page's socket as if the network failed (a partner page then rejoins). */
  dropSocket(): void {
    this.client.close();
  }

  private makeLockstep(start: number): Lockstep {
    const humans = this.params!.humans!;
    return new Lockstep({ peers: humans.length, self: this.seat, delay: this.cfg.inputDelayTicks, hashEvery: this.cfg.hashEveryTicks, filter: seatFilter(humans), start }, this.client.transport());
  }

  private begin(raw: unknown): void {
    const p = parseStart(raw);
    if (!p) {
      this.message = "The host sent a match this page cannot build.";
      this.ev.changed();
      return;
    }
    this.seat = this.client.seat;
    this.pendingCode = this.client.code;
    this.params = p;
    this.ls = this.makeLockstep(0);
    this.state = "playing";
    this.ev.started(p, p.humans![this.seat]);
    this.ev.changed();
  }

  /** L5-F (host): send the others a snapshot of the world now and restart the lockstep at its tick. */
  private resync(): void {
    const old = this.ls;
    const { text, tick } = this.ev.snapshot();
    const id = ++this.snapId;
    const n = Math.max(1, Math.ceil(text.length / SNAP_CHUNK));
    for (let i = 0; i < n; i++) this.client.sendCtl({ k: "snap", id, i, n, tick, text: text.slice(i * SNAP_CHUNK, (i + 1) * SNAP_CHUNK) });
    this.ls = this.makeLockstep(tick);
    // orders this page sent for ticks not run yet go out again in the new stream
    for (const c of old?.ownPending() ?? []) this.ls.local(c);
    this.stalled = 0;
    this.resyncs++;
  }

  /** L5-F (rejoining page): collect the host's snapshot chunks, load it, and restart the lockstep there. */
  private onCtl(data: unknown): void {
    const m = data as { k?: unknown; id?: unknown; i?: unknown; n?: unknown; text?: unknown } | null;
    if (!m || m.k !== "snap" || typeof m.id !== "number" || typeof m.i !== "number" || typeof m.n !== "number" || typeof m.text !== "string") return;
    if (!Number.isInteger(m.n) || !Number.isInteger(m.i) || m.n < 1 || m.n > 512 || m.i < 0 || m.i >= m.n) return;
    if (this.state !== "resyncing" && this.state !== "playing") return;
    if (!this.snap || this.snap.id !== m.id || this.snap.parts.length !== m.n) this.snap = { id: m.id, parts: new Array<string | undefined>(m.n), got: 0 };
    if (this.snap.parts[m.i] === undefined) {
      this.snap.parts[m.i] = m.text;
      this.snap.got++;
    }
    if (this.snap.got < this.snap.parts.length) return;
    const text = this.snap.parts.join("");
    this.snap = null;
    const tick = this.ev.resume(text);
    if (tick === null) {
      this.message = "The host's snapshot could not be loaded.";
      this.state = "closed";
      this.client.close();
      this.ev.lost("closed");
      this.ev.changed();
      return;
    }
    this.ls = this.makeLockstep(tick);
    this.state = "playing";
    this.stalled = 0;
    this.tries = 0;
    this.resyncs++;
    this.ev.changed();
  }

  /** L5-F (partner page): the relay dropped mid-match; try to take the seat back, one second apart. */
  private reconnect(): void {
    if (this.tries >= this.cfg.reconnectTries) {
      this.state = "closed";
      this.ev.lost("closed");
      this.ev.changed();
      return;
    }
    this.state = "reconnecting";
    this.ev.changed();
    this.retry = setTimeout(
      () => {
        this.retry = null;
        if (this.state !== "reconnecting") return;
        this.tries++;
        this.client = this.wire(this.reopen!());
      },
      this.tries ? 1000 : 50,
    );
  }
}

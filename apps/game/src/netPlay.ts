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
}

export const NET_DEFAULTS: NetConfig = { inputDelayTicks: 4, hashEveryTicks: 20, stallNoticeSeconds: 2 };

export type NetState = "connecting" | "lobby" | "playing" | "closed";

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

export interface NetEvents {
  /** the lobby or match changed (the menus redraw) */
  changed(): void;
  /** the host pressed Start: build this world and play tribe `tribe` */
  started(params: SkirmishParams, tribe: number): void;
  /** a seat left or the socket closed during a match */
  lost(why: "partnerLeft" | "closed"): void;
}

export class NetPlay {
  state: NetState = "connecting";
  message: string | null = null;
  ls: Lockstep | null = null;
  params: SkirmishParams | null = null;
  /** seconds the match has been waiting on a partner's batch (the HUD shows it past stallNoticeSeconds) */
  stalled = 0;
  readonly client: RelayClient;
  readonly cfg: NetConfig;
  private readonly ev: NetEvents;
  private role: "host" | "join" | null = null;

  constructor(sock: SocketLike & { addEventListener(type: "open", fn: () => void): void }, cfg: NetConfig, ev: NetEvents) {
    this.cfg = cfg;
    this.ev = ev;
    this.client = new RelayClient(sock, {
      room: () => {
        this.state = "lobby";
        this.message = null;
        this.ev.changed();
      },
      joined: () => this.ev.changed(),
      start: (p) => this.begin(p),
      left: () => {
        if (this.state === "playing") this.ev.lost("partnerLeft");
        this.ev.changed();
      },
      error: (why) => {
        this.message = why;
        this.ev.changed();
      },
      closed: () => {
        const was = this.state;
        this.state = "closed";
        if (was === "playing") this.ev.lost("closed");
        else if (!this.message) this.message = "The connection to the host closed.";
        this.ev.changed();
      },
    });
    sock.addEventListener("open", () => {
      if (this.role === "host") this.client.host(2);
      else if (this.role === "join" && this.pendingCode) this.client.join(this.pendingCode);
      this.opened = true;
    });
  }

  private opened = false;
  private pendingCode = "";

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
    return this.client.seat === 0;
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
    this.state = "closed";
    this.client.close();
  }

  private begin(raw: unknown): void {
    const p = parseStart(raw);
    if (!p) {
      this.message = "The host sent a match this page cannot build.";
      this.ev.changed();
      return;
    }
    const humans = p.humans!;
    const seat = this.client.seat;
    this.params = p;
    this.ls = new Lockstep({ peers: humans.length, self: seat, delay: this.cfg.inputDelayTicks, hashEvery: this.cfg.hashEveryTicks, filter: seatFilter(humans) }, this.client.transport());
    this.state = "playing";
    this.ev.started(p, humans[seat]);
    this.ev.changed();
  }
}

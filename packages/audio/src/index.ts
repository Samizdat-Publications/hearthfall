// @hearthfall/audio public API. M6: event hooks that turn sim events into audio cues through the
// style.json `audio.cues` table (and `audio.alias`, cue to the asset that serves it). Playback is a
// sink the app supplies (M10: WebAudioPlayer in player.ts); cues whose asset is not available are
// counted as silent stubs, never errors.
export { busGain, busOf, spatial, MusicDirector, type Bus, type DirectorEvent, type Listener, type Stem, type Volumes } from "./mix.ts";
export { WebAudioPlayer, type PlayerStats } from "./player.ts";

export interface CueRule {
  cue: string;
  maxPerTick?: number;
  /** heard from every tribe even without a position (BACKLOG 93) */
  global?: boolean;
  where?: Record<string, string | number>;
}

export interface AudioEvent {
  type: string;
  tick: number;
  [k: string]: unknown;
}

export interface CuePlay {
  cue: string;
  event: string;
  tick: number;
  x?: number;
  y?: number;
  /** no asset for this cue yet: the hook fired but nothing plays */
  silent: boolean;
}

export interface AudioStats {
  played: number;
  silent: number;
  dropped: number;
  byCue: Record<string, number>;
}

const FIELD = /\{([a-zA-Z0-9_]+)\}/g;

/** Read only consumer of sim events; owns no sim state. */
export class AudioHooks {
  private stats_: AudioStats = { played: 0, silent: 0, dropped: 0, byCue: {} };
  private tick = -1;
  private perTick = new Map<string, number>();

  private readonly rules: Readonly<Record<string, CueRule>>;
  private readonly available: ReadonlySet<string>;
  private readonly sink: (p: CuePlay) => void;
  private readonly alias: Readonly<Record<string, string>>;
  /** the listening tribe: a rival's cue with no position (charged, trained, born) is not heard; -1 hears all */
  localTribe = -1;

  constructor(rules: Readonly<Record<string, CueRule>>, available: ReadonlySet<string>, sink: (p: CuePlay) => void = () => {}, alias: Readonly<Record<string, string>> = {}) {
    this.rules = rules;
    this.available = available;
    this.sink = sink;
    this.alias = alias;
  }

  /** Map one batch of events (any number of ticks, in order) to cue plays. */
  consume(events: readonly AudioEvent[]): CuePlay[] {
    const out: CuePlay[] = [];
    for (const e of events) {
      const r = this.rules[e.type];
      if (!r) continue;
      if (r.where && Object.entries(r.where).some(([k, v]) => e[k] !== v)) continue;
      const placed = typeof e.x === "number" && typeof e.y === "number";
      if (!placed && !r.global && this.localTribe >= 0 && typeof e.tribe === "number" && e.tribe >= 0 && e.tribe !== this.localTribe) continue;
      if (e.tick !== this.tick) {
        this.tick = e.tick;
        this.perTick.clear();
      }
      const n = this.perTick.get(e.type) ?? 0;
      if (r.maxPerTick !== undefined && n >= r.maxPerTick) {
        this.stats_.dropped++;
        continue;
      }
      this.perTick.set(e.type, n + 1);
      const named = r.cue.replace(FIELD, (_, f: string) => String(e[f] ?? ""));
      const cue = this.alias[named] ?? named;
      const silent = !this.available.has(cue);
      const p: CuePlay = { cue, event: e.type, tick: e.tick, silent };
      if (typeof e.x === "number" && typeof e.y === "number") {
        p.x = e.x;
        p.y = e.y;
      }
      if (silent) this.stats_.silent++;
      else this.stats_.played++;
      this.stats_.byCue[cue] = (this.stats_.byCue[cue] ?? 0) + 1;
      out.push(p);
      if (!silent) this.sink(p);
    }
    return out;
  }

  stats(): AudioStats {
    return { ...this.stats_, byCue: { ...this.stats_.byCue } };
  }
}

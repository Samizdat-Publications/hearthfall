// M10 Web Audio playback (browser only): master, sfx, voice and music buses fed by the stored volume
// settings, decoded buffers cached by cue id, positional one-shots with distance gain and stereo pan,
// and looping music stems that crossfade. The context starts suspended until the first user gesture
// (browser autoplay rules); cues before that are skipped, never queued. A failed decode marks the cue
// silent; playback never throws into the game loop.
import { busGain, busOf, spatial, type Bus, type Listener, type Stem, type Volumes } from "./mix.ts";

export interface PlayerStats {
  state: string;
  played: number;
  skipped: number;
  failed: string[];
  loaded: number;
  stem: Stem | null;
}

export class WebAudioPlayer {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = new Map<Bus, GainNode>();
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private failed = new Set<string>();
  private played = 0;
  private skipped = 0;
  private music: { stem: Stem; src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantStem: Stem | null = null;
  private volumes: Volumes;
  listener: Listener = { x: 0, z: 0, size: 128, radius: 60 };
  yaw = 0;

  private readonly urls: ReadonlyMap<string, string>;
  private readonly crossfade: number;

  constructor(urls: ReadonlyMap<string, string>, volumes: Volumes, crossfade = 2) {
    this.urls = urls;
    this.volumes = { ...volumes };
    this.crossfade = crossfade;
  }

  /** Create or resume the context; call from a user gesture handler. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const b of ["sfx", "voice", "music"] as Bus[]) {
          const g = this.ctx.createGain();
          g.connect(this.master);
          this.buses.set(b, g);
        }
        this.applyVolumes();
        if (this.wantStem) this.setStem(this.wantStem);
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = 1;
    for (const [b, g] of this.buses) g.gain.value = busGain(this.volumes, b);
  }

  private running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  private buffer(cue: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(cue);
    if (!p) {
      const url = this.urls.get(cue);
      const ctx = this.ctx!;
      p = url
        ? fetch(url)
            .then((r) => r.arrayBuffer())
            .then((b) => ctx.decodeAudioData(b))
            .catch(() => {
              this.failed.add(cue);
              return null;
            })
        : Promise.resolve(null);
      this.buffers.set(cue, p);
    }
    return p;
  }

  /** One-shot cue at a world position (or centered without one). */
  play(cue: string, x?: number, y?: number): void {
    if (!this.running() || !this.urls.has(cue) || this.failed.has(cue)) {
      this.skipped++;
      return;
    }
    const s = spatial(this.listener, x, y, this.yaw);
    if (s.gain <= 0.01) {
      this.skipped++;
      return;
    }
    const ctx = this.ctx!;
    const bus = this.buses.get(busOf(cue))!;
    void this.buffer(cue).then((buf) => {
      if (!buf || !this.ctx) return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = s.gain;
        const pan = ctx.createStereoPanner();
        pan.pan.value = s.pan;
        src.connect(g).connect(pan).connect(bus);
        src.start();
        this.played++;
      } catch {
        this.skipped++;
      }
    });
  }

  /** Switch the looping music stem with a crossfade (no-op when it already plays). */
  setStem(stem: Stem): void {
    this.wantStem = stem;
    if (!this.ctx || this.music?.stem === stem) return;
    const ctx = this.ctx;
    const cue = `music.${stem}`;
    const old = this.music;
    void this.buffer(cue).then((buf) => {
      if (!buf || this.wantStem !== stem || this.music?.stem === stem) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + this.crossfade);
      src.connect(gain).connect(this.buses.get("music")!);
      src.start();
      const prev = this.music ?? old;
      this.music = { stem, src, gain };
      if (prev) {
        prev.gain.gain.setValueAtTime(prev.gain.gain.value, t);
        prev.gain.gain.linearRampToValueAtTime(0, t + this.crossfade);
        prev.src.stop(t + this.crossfade + 0.05);
      }
    });
  }

  stats(): PlayerStats {
    return { state: this.ctx?.state ?? "none", played: this.played, skipped: this.skipped, failed: [...this.failed].sort(), loaded: this.buffers.size, stem: this.music?.stem ?? null };
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}

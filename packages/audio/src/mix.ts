// M10 audio mixing decisions, kept pure so Node tests cover them: the bus a cue plays on, bus gains
// from the stored volume settings, wrap-aware distance attenuation and stereo pan around the camera
// focus, and the music director that picks the calm, tension or battle stem from recent events.

export type Bus = "sfx" | "music" | "voice";

export const busOf = (cue: string): Bus => (cue.startsWith("music.") ? "music" : cue.startsWith("voice.") ? "voice" : "sfx");

/** Stored settings are 0 to 100; squared so the slider feels even (perceived loudness). */
export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export function busGain(v: Volumes, bus: Bus): number {
  const f = (x: number) => Math.min(1, Math.max(0, x / 100));
  const m = f(v.master);
  const b = bus === "music" ? f(v.music) : f(v.sfx);
  return m * m * b * b;
}

export interface Listener {
  x: number;
  z: number;
  /** map size for the torus wrap */
  size: number;
  /** cells at which a positional sound is inaudible (grows with camera zoom) */
  radius: number;
}

/**
 * Gain and pan of a sound at (x, y) heard from the listener: full volume inside a quarter of the
 * radius, linear falloff to silence at the radius, panned by the horizontal offset. Sounds without a
 * position (UI, voice) play centered at full volume. `yaw` turns the offset into screen space.
 */
export function spatial(l: Listener, x: number | undefined, y: number | undefined, yaw = 0): { gain: number; pan: number } {
  if (x === undefined || y === undefined) return { gain: 1, pan: 0 };
  let dx = x - l.x;
  let dz = y - l.z;
  dx -= Math.round(dx / l.size) * l.size;
  dz -= Math.round(dz / l.size) * l.size;
  const d = Math.hypot(dx, dz);
  const inner = l.radius * 0.25;
  const gain = d <= inner ? 1 : d >= l.radius ? 0 : 1 - (d - inner) / (l.radius - inner);
  const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const pan = Math.max(-1, Math.min(1, sx / Math.max(1, l.radius * 0.5))) * 0.8;
  return { gain, pan };
}

export type Stem = "calm" | "tension" | "battle";

export interface DirectorEvent {
  type: string;
  x?: number;
  y?: number;
  tribe?: number;
  cat?: number;
}

const COMBAT = new Set(["melee", "fireball", "destroyed", "shaperDied", "chantBegun"]);

/**
 * Picks the music stem: battle while fighting happens near the camera, tension while it happens
 * anywhere (or a raid is coming), calm after a quiet spell. Upgrades are immediate; a downgrade waits
 * until the current stem has held for `holdSeconds`. Time is sim seconds, so it is reproducible.
 */
export class MusicDirector {
  stem: Stem = "calm";
  private lastNear = -1e9;
  private lastAny = -1e9;
  private since = 0;
  private readonly nearCells: number;
  private readonly battleSeconds: number;
  private readonly tensionSeconds: number;
  private readonly holdSeconds: number;

  constructor(nearCells = 24, battleSeconds = 15, tensionSeconds = 35, holdSeconds = 20) {
    this.nearCells = nearCells;
    this.battleSeconds = battleSeconds;
    this.tensionSeconds = tensionSeconds;
    this.holdSeconds = holdSeconds;
  }

  /** Feed one batch of events at sim time `t` (seconds); returns the stem to play. */
  update(t: number, events: readonly DirectorEvent[], l: Listener, localTribe: number): Stem {
    for (const e of events) {
      const combat = COMBAT.has(e.type) || (e.type === "killed" && e.cat === 3);
      const raid = e.type === "raid" && e.tribe !== localTribe;
      if (!combat && !raid) continue;
      this.lastAny = t;
      if (combat && e.x !== undefined && e.y !== undefined && spatial({ ...l, radius: this.nearCells }, e.x, e.y).gain > 0) this.lastNear = t;
    }
    const want: Stem = t - this.lastNear < this.battleSeconds ? "battle" : t - this.lastAny < this.tensionSeconds ? "tension" : "calm";
    const rank = { calm: 0, tension: 1, battle: 2 } as const;
    if (want !== this.stem && (rank[want] > rank[this.stem] || t - this.since >= this.holdSeconds)) {
      this.stem = want;
      this.since = t;
    }
    return this.stem;
  }
}

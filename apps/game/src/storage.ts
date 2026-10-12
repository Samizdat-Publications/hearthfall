// Settings and save slots in browser storage (M8). Every access is guarded: storage can be missing,
// full or throw (private windows, blocked site data), and then the game keeps working with an
// in-memory fallback and says so in the menus.
import { defaultKeymap, sanitizeKeymap, type Keymap } from "@hearthfall/ui";
import { decodeSave, encodeSave, type SaveGame } from "./session.ts";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** In-memory storage used when the browser's is unavailable. */
export class MemoryKV implements KV {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

/** window.localStorage when it works, else a MemoryKV (persistent false). */
export function browserKV(): { kv: KV; persistent: boolean } {
  try {
    const ls = globalThis.localStorage;
    const probe = "hearthfall.probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return { kv: ls, persistent: true };
  } catch {
    return { kv: new MemoryKV(), persistent: false };
  }
}

export const QUALITIES = ["high", "medium", "low"] as const;

/** BACKLOG 8: tribe color sets (style.json tribePalettes; "default" is the plain palette) */
export const PALETTES = ["default", "colorblind"] as const;
/** S4 L7-F: the interface scale in percent, a slider from min to max in steps; the setting 0 fits it to the screen */
export const UI_SCALE = { min: 75, max: 200, step: 5 } as const;

/** S4 L7-F: the fit-to-screen interface scale: 100 percent at 1080p, 135 at 1440p, 200 at 4K, never under 100 */
export function autoUiScale(w: number, h: number): number {
  const raw = Math.min(w / 1920, h / 1080) * 100;
  return Math.min(UI_SCALE.max, Math.max(100, Math.round(raw / UI_SCALE.step) * UI_SCALE.step));
}

/** a stored interface scale: 0 (fit to screen) or a slider step inside the range; anything else falls back to `d` */
export function sanitizeUiScale(v: unknown, d: number): number {
  if (v === 0) return 0;
  if (typeof v !== "number" || !Number.isFinite(v)) return d;
  const r = Math.round(v / UI_SCALE.step) * UI_SCALE.step;
  return r >= UI_SCALE.min && r <= UI_SCALE.max ? r : d;
}
/** BACKLOG 14a: tilt-shift miniature focus ("default" follows style.json render.tiltShift.defaultOn) */
export const MINIATURE = ["default", "on", "off"] as const;
/** BACKLOG 14: lighting presets ("default" follows style.json lightingDefault) and visual weather */
export const LIGHTING = ["default", "day", "golden", "evening"] as const;
export const WEATHER = ["clear", "rain"] as const;
/** render polish: health bars over units and buildings (only when damaged, always, or off; key L cycles them) */
export const HEALTH_BARS = ["damaged", "always", "off"] as const;
/** the Health bars key: damaged, then always, then off, then damaged again */
export function nextHealthBars(m: (typeof HEALTH_BARS)[number]): (typeof HEALTH_BARS)[number] {
  return HEALTH_BARS[(HEALTH_BARS.indexOf(m) + 1) % HEALTH_BARS.length];
}
/** note shown when the key changes the mode */
export function healthBarsNote(m: (typeof HEALTH_BARS)[number]): string {
  return m === "damaged" ? "Health bars: when damaged" : m === "always" ? "Health bars: always" : "Health bars: off";
}

export interface Settings {
  quality: (typeof QUALITIES)[number];
  master: number;
  music: number;
  sfx: number;
  keymap: Keymap;
  /** BACKLOG 8 accessibility */
  palette: (typeof PALETTES)[number];
  /** percent; 0 fits it to the screen (autoUiScale) */
  uiScale: number;
  subtitles: boolean;
  miniature: (typeof MINIATURE)[number];
  lighting: (typeof LIGHTING)[number];
  weather: (typeof WEATHER)[number];
  /** stretch 2: first skirmish tips (turned off when the last tip is done) */
  tips: boolean;
  /** render polish: health bars mode and ambient life (smoke, birds, fireflies, dust) */
  healthBars: (typeof HEALTH_BARS)[number];
  ambient: boolean;
}

const SETTINGS_KEY = "hearthfall.settings.v1";

export function defaultSettings(): Settings {
  return { quality: "high", master: 80, music: 60, sfx: 80, keymap: defaultKeymap(), palette: "default", uiScale: 0, subtitles: true, miniature: "default", lighting: "default", weather: "clear", tips: true, healthBars: "damaged", ambient: true };
}

const vol = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : d);

export function loadSettings(kv: KV): Settings {
  const d = defaultSettings();
  try {
    const raw = kv.getItem(SETTINGS_KEY);
    if (!raw) return d;
    const o = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: (QUALITIES as readonly string[]).includes(o.quality as string) ? (o.quality as Settings["quality"]) : d.quality,
      master: vol(o.master, d.master),
      music: vol(o.music, d.music),
      sfx: vol(o.sfx, d.sfx),
      keymap: sanitizeKeymap(o.keymap),
      palette: (PALETTES as readonly string[]).includes(o.palette as string) ? (o.palette as Settings["palette"]) : d.palette,
      uiScale: sanitizeUiScale(o.uiScale, d.uiScale),
      subtitles: typeof o.subtitles === "boolean" ? o.subtitles : d.subtitles,
      miniature: (MINIATURE as readonly string[]).includes(o.miniature as string) ? (o.miniature as Settings["miniature"]) : d.miniature,
      lighting: (LIGHTING as readonly string[]).includes(o.lighting as string) ? (o.lighting as Settings["lighting"]) : d.lighting,
      weather: (WEATHER as readonly string[]).includes(o.weather as string) ? (o.weather as Settings["weather"]) : d.weather,
      tips: typeof o.tips === "boolean" ? o.tips : d.tips,
      healthBars: (HEALTH_BARS as readonly string[]).includes(o.healthBars as string) ? (o.healthBars as Settings["healthBars"]) : d.healthBars,
      ambient: typeof o.ambient === "boolean" ? o.ambient : d.ambient,
    };
  } catch {
    return d;
  }
}

export function storeSettings(kv: KV, s: Settings): boolean {
  try {
    kv.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const SLOTS = 3;
const slotKey = (n: number) => `hearthfall.save.${n}`;
const metaKey = (n: number) => `hearthfall.save.${n}.meta`;

export interface SlotMeta {
  savedAt: string;
  tick: number;
  map: string;
  opponents: string;
}

export function slotMeta(kv: KV, n: number): SlotMeta | null {
  try {
    const raw = kv.getItem(metaKey(n));
    return raw ? (JSON.parse(raw) as SlotMeta) : null;
  } catch {
    return null;
  }
}

/** Write a save; the error is player-readable (storage full, unavailable). */
export function writeSlot(kv: KV, n: number, s: SaveGame): string | null {
  const c = s.params.campaign;
  const meta: SlotMeta = c
    ? { savedAt: s.savedAt, tick: s.tick, map: `campaign: ${c.def.name}`, opponents: s.params.ai.filter((x) => x !== "none").join(", ") || "none" }
    : { savedAt: s.savedAt, tick: s.tick, map: `${s.params.level} ${s.params.size}, seed ${s.params.seed}`, opponents: `${s.params.ai.join(", ")} (${s.params.difficulty})` };
  // a failed write must not cost the player the save already in the slot: put the old pair back
  const prevSlot = kv.getItem(slotKey(n));
  const prevMeta = kv.getItem(metaKey(n));
  try {
    kv.setItem(slotKey(n), encodeSave(s));
    kv.setItem(metaKey(n), JSON.stringify(meta));
    return null;
  } catch (e) {
    try {
      if (prevSlot !== null) kv.setItem(slotKey(n), prevSlot);
      else kv.removeItem(slotKey(n));
      if (prevMeta !== null) kv.setItem(metaKey(n), prevMeta);
      else kv.removeItem(metaKey(n));
    } catch {
      // storage refuses even the old value; nothing more to do
    }
    return `could not save: ${String((e as Error).message ?? e).slice(0, 80)}`;
  }
}

export function readSlot(kv: KV, n: number): SaveGame {
  const raw = kv.getItem(slotKey(n));
  if (!raw) throw new Error("slot is empty");
  return decodeSave(raw);
}

export function deleteSlot(kv: KV, n: number): void {
  try {
    kv.removeItem(slotKey(n));
    kv.removeItem(metaKey(n));
  } catch {
    // nothing to do: the slot stays as it was
  }
}

// Skirmish sessions and save games (M8), without a renderer so they are unit tested in Node.
// A save is the world snapshot (typed arrays as base64), the skirmish params that rebuild the
// WorldInit and the opponents, each controller's saveState, the local command log and the commands
// queued for the next tick. Loading restores the snapshot, recreates the opponents from the params
// and hands each its state back, so the loaded game has the same hash and the same future.
// M9: a campaign level is a session too; its params carry the level definition itself (and the
// campaign carry), so a save restores the level it was made in even after the level file changes.
import type { LevelDef, ValidatedPack } from "@hearthfall/data";
import { makeBot } from "@hearthfall/ai";
import { World, createLevelWorld, levelWorldInit, type CampaignCarry, type Command, type WorldInit, type WorldSnapshot } from "@hearthfall/sim";
import { levelOpponents, opponentsFor } from "./opponents.ts";

export interface SkirmishParams {
  seed: number;
  /** map generator: continents or islands */
  level: string;
  size: number;
  /** tribes including the local player */
  tribes: number;
  /** opponent per non-local tribe (personality id, "economy" or "none"), cycled */
  ai: string[];
  difficulty: string;
  /** BACKLOG 13 (ADR-014): victory variant id (balance.victory) run by the sim; absent in older saves (app-side conquest) */
  rules?: string;
  /** BACKLOG 11 (ADR-017): start with a Forge phase (absent in older saves) */
  forge?: boolean;
  /** M9: set when this session is a campaign level (the other fields then mirror the level) */
  campaign?: { def: LevelDef; carry: CampaignCarry };
}

export const LOCAL_TRIBE = 0;

/** Session params for a campaign level and the unlocks earned in the levels before it. */
export function campaignParams(def: LevelDef, carry: CampaignCarry): SkirmishParams {
  return {
    seed: def.seed,
    level: def.map.generator,
    size: def.map.size,
    tribes: def.tribes.length,
    ai: def.tribes.slice(1).map((t) => t.ai ?? "none"),
    difficulty: def.tribes.find((t) => t.difficulty)?.difficulty ?? "normal",
    campaign: { def, carry: { spells: [...(carry.spells ?? [])], buildings: [...(carry.buildings ?? [])] } },
  };
}

export function skirmishInit(pack: ValidatedPack, p: SkirmishParams): WorldInit {
  if (p.campaign) return levelWorldInit({ def: p.campaign.def, carry: p.campaign.carry }, pack.files, pack.hash);
  return { pack: pack.files, packHash: pack.hash, seed: p.seed, map: { generator: p.level, size: p.size, tribes: p.tribes }, ...(p.rules ? { rules: p.rules } : {}), ...(p.forge ? { forge: true } : {}) };
}

/** A new skirmish (or campaign level) world with its opponents attached. */
export function createSkirmish(pack: ValidatedPack, p: SkirmishParams): World {
  if (p.campaign) return createLevelWorld({ def: p.campaign.def, carry: p.campaign.carry }, pack.files, pack.hash, makeBot);
  const w = new World(skirmishInit(pack, p));
  for (const c of opponentsFor(w.tribes.length, LOCAL_TRIBE, p)) w.controllers.push(c);
  return w;
}

export const SAVE_VERSION = 1;

export interface SaveGame {
  version: number;
  packHash: string;
  params: SkirmishParams;
  /** wall clock ISO time (app side, never read by the sim) */
  savedAt: string;
  tick: number;
  /** world hash at save time; a load must reproduce it */
  hash: string;
  snapshot: WorldSnapshot;
  controllers: { tribe: number; state: unknown }[];
  /** local player commands so far (tail), for debugging and future replays */
  log: Command[];
  /** commands queued for the next tick when the game was saved */
  pending: Command[];
}

export const LOG_TAIL = 5000;

export function makeSave(w: World, params: SkirmishParams, log: Command[], pending: Command[], savedAt: string): SaveGame {
  return {
    version: SAVE_VERSION,
    packHash: w.cfg.packHash,
    params: { ...params, ai: [...params.ai], ...(params.campaign ? { campaign: structuredClone(params.campaign) } : {}) },
    savedAt,
    tick: w.tick,
    hash: w.hash().all,
    snapshot: w.snapshot(),
    controllers: w.controllers.filter((c) => c.saveState).map((c) => ({ tribe: c.tribe, state: c.saveState!() })),
    log: log.slice(-LOG_TAIL),
    pending: pending.map((c) => ({ ...c })),
  };
}

/** Rebuild the world from a save; throws with a player-readable reason when it cannot. */
export function restoreSave(pack: ValidatedPack, s: SaveGame): World {
  if (s.version !== SAVE_VERSION) throw new Error(`save version ${s.version} is not supported`);
  if (s.packHash !== pack.hash) throw new Error("save was made with different game data");
  const w = World.restore(skirmishInit(pack, s.params), s.snapshot);
  const cs = s.params.campaign ? levelOpponents(s.params.campaign.def) : opponentsFor(w.tribes.length, LOCAL_TRIBE, s.params);
  for (const c of cs) {
    const st = s.controllers.find((x) => x.tribe === c.tribe);
    if (st && c.loadState) c.loadState(st.state);
    w.controllers.push(c);
  }
  if (w.hash().all !== s.hash) throw new Error("save is damaged (hash mismatch)");
  return w;
}

// ---------------------------------------------------------------- text encoding
const TYPED: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
};

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** JSON with typed arrays as base64 and non-finite numbers kept (JSON alone turns them into null). */
export function encodeSave(s: SaveGame): string {
  return JSON.stringify(s, function (this: unknown, _k, v) {
    if (ArrayBuffer.isView(v)) {
      const name = v.constructor.name;
      if (!TYPED[name]) throw new Error(`cannot save ${name}`);
      return { __ta: name, b64: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (typeof v === "number" && !Number.isFinite(v)) return { __num: String(v) };
    return v;
  });
}

export function decodeSave(text: string): SaveGame {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === "object" && "__ta" in v) {
      const Ctor = TYPED[(v as { __ta: string }).__ta];
      if (!Ctor) throw new Error("save is damaged (unknown array type)");
      return new Ctor(fromB64((v as { b64: string }).b64));
    }
    if (v && typeof v === "object" && "__num" in v) return Number((v as { __num: string }).__num);
    return v;
  }) as SaveGame;
}

// BACKLOG 19 (ADR-018): replays. The sim is deterministic and the opponents run inside it, so a match is
// its session params, the save it was loaded from (or nothing for a fresh start) and the local player's
// commands by tick. ReplayRun rebuilds that world and steps it with those commands; it keeps a checkpoint
// save every `every` ticks so seeking back restores the nearest one instead of replaying from the start.
// No renderer here, so it is unit tested in Node.
import type { ValidatedPack } from "@hearthfall/data";
import type { BotSpec, Command, World } from "@hearthfall/sim";
import { createSkirmish, decodeData, encodeData, makeSave, recordedBots, restoreSave, type SaveGame, type SkirmishParams } from "./session.ts";

export const REPLAY_VERSION = 1;
/** browser storage key of the last finished match's replay */
export const REPLAY_KEY = "hearthfall.replay.last";

export interface Replay {
  version: number;
  packHash: string;
  params: SkirmishParams;
  /** the save the session was loaded from (its own pending commands are in `commands`); null for a fresh match */
  start: SaveGame | null;
  /** the local player's commands, each stamped with the tick it ran in */
  commands: Command[];
  endTick: number;
  /** world hash at endTick; a replay that reaches it is verified */
  endHash: string;
  /** wall clock ISO time (app side) */
  savedAt: string;
  /** BACKLOG 50: the specs of the opponents that ran; playback builds exactly these (older replays: from params) */
  bots?: BotSpec[];
}

export function makeReplay(w: World, params: SkirmishParams, start: SaveGame | null, commands: Command[], savedAt: string): Replay {
  return {
    version: REPLAY_VERSION,
    packHash: w.cfg.packHash,
    params: { ...params, ai: [...params.ai], ...(params.campaign ? { campaign: structuredClone(params.campaign) } : {}) },
    start: start ? { ...start, log: [], pending: [] } : null,
    commands: commands.map((c) => ({ ...c })),
    endTick: w.tick,
    endHash: w.hash().all,
    savedAt,
    ...(recordedBots(w) ? { bots: recordedBots(w) } : {}),
  };
}

export function encodeReplay(r: Replay): string {
  return encodeData(r);
}

/** Parse a replay; throws with a player-readable reason when it cannot be played with this game data. */
export function decodeReplay(text: string, pack: ValidatedPack): Replay {
  let r: Replay;
  try {
    r = decodeData<Replay>(text);
  } catch {
    throw new Error("not a replay file");
  }
  if (!r || typeof r !== "object" || !Array.isArray(r.commands) || !r.params) throw new Error("not a replay file");
  if (r.version !== REPLAY_VERSION) throw new Error(`replay version ${r.version} is not supported`);
  if (r.packHash !== pack.hash) throw new Error("replay was made with different game data");
  return r;
}

export class ReplayRun {
  world: World;
  readonly startTick: number;
  private readonly byTick = new Map<number, Command[]>();
  /** checkpoint saves by ascending tick (the first is the start) */
  private readonly checkpoints: SaveGame[] = [];

  private readonly pack: ValidatedPack;
  readonly replay: Replay;
  /** ticks between checkpoint saves */
  readonly every: number;

  constructor(pack: ValidatedPack, replay: Replay, every = 1200) {
    this.pack = pack;
    this.replay = replay;
    this.every = every;
    for (const c of replay.commands) {
      const list = this.byTick.get(c.tick);
      if (list) list.push(c);
      else this.byTick.set(c.tick, [c]);
    }
    this.world = replay.start ? restoreSave(pack, { ...replay.start, pending: [] }) : createSkirmish(pack, replay.params, replay.bots);
    this.startTick = this.world.tick;
    this.checkpoint();
  }

  get tick(): number {
    return this.world.tick;
  }

  get done(): boolean {
    return this.world.tick >= this.replay.endTick;
  }

  /** null until the end is reached, then whether the world hash there matches the recorded one */
  verified(): boolean | null {
    return this.world.tick === this.replay.endTick ? this.world.hash().all === this.replay.endHash : null;
  }

  private checkpoint(): void {
    const w = this.world;
    const last = this.checkpoints[this.checkpoints.length - 1];
    if (last && last.tick >= w.tick) return;
    this.checkpoints.push(makeSave(w, this.replay.params, [], [], ""));
  }

  /** One tick with the recorded commands of this tick (no-op at the end). */
  step(): void {
    if (this.done) return;
    this.world.step((this.byTick.get(this.world.tick) ?? []).map((c) => ({ ...c, args: { ...c.args } })));
    if ((this.world.tick - this.startTick) % this.every === 0) this.checkpoint();
  }

  /**
   * Move toward `tick` (clamped to the replay): going back restores the nearest checkpoint at or before it,
   * then at most `budget` ticks are stepped. Returns true once the world is at `tick`. A restore makes a new
   * World, so callers compare `world` before and after to rebind views.
   */
  seek(tick: number, budget = Infinity): boolean {
    const t = Math.max(this.startTick, Math.min(this.replay.endTick, Math.floor(tick)));
    if (t < this.world.tick) {
      let cp = this.checkpoints[0];
      for (const c of this.checkpoints) if (c.tick <= t) cp = c;
      this.world = restoreSave(this.pack, cp);
    }
    for (let k = 0; k < budget && this.world.tick < t; k++) this.step();
    return this.world.tick === t;
  }
}

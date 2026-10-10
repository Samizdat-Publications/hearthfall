// BACKLOG 11 (ADR-017): Forge mode. An optional pre-match phase (WorldInit.forge) in which units are
// frozen and each tribe reshapes the land around its own Hearth for free with forgeOp brush strokes.
// While it runs, World.step executes commands (only the forge and settings ones are accepted), lets the
// controllers decide, applies the terrain ops and the drowning check, and skips every other system. It
// ends after balance.forge.seconds or as soon as every living tribe has sent forgeReady. Match clocks
// (victory timers, level timers, the AI's minute) read World.playTick, which starts at the forge's end.
import type { PackFiles } from "@hearthfall/data";
import type { Fnv } from "./hash.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

export type ForgeDef = NonNullable<PackFiles["balance"]["forge"]>;

export const FORGE_BRUSHES = ["raise", "lower", "flatten", "smooth"] as const;
export type ForgeBrush = (typeof FORGE_BRUSHES)[number];

/** commands accepted while the forge runs (settings, debug and the forge's own) */
export const FORGE_COMMANDS = new Set(["forgeOp", "forgeReady", "terrainOp", "handicap", "noop", "setSplit", "setAutoCharge", "setPriorities", "setStance", "grantCharges", "eliminate", "completeObjectives"]);

export interface ForgeSaved {
  ready: boolean[];
  ops: number[];
  endedAt: number;
}

export class ForgeRuntime {
  readonly def: ForgeDef;
  /** the tick the forge ends at the latest */
  readonly endsAt: number;
  /** per tribe: sent forgeReady */
  ready: boolean[];
  /** per tribe: brush strokes used */
  ops: number[];
  /** first tick of the match proper (-1 while the forge runs) */
  endedAt = -1;
  private w: World;

  constructor(w: World) {
    const d = w.cfg.pack.balance.forge;
    if (!d) throw new Error("this pack has no balance.forge");
    this.w = w;
    this.def = d;
    this.endsAt = Math.round(d.seconds * w.cfg.tickHz);
    this.ready = w.tribes.map(() => false);
    this.ops = w.tribes.map(() => 0);
  }

  running(): boolean {
    return this.endedAt < 0;
  }

  /** ticks left (0 once ended) */
  remaining(): number {
    return this.running() ? Math.max(0, this.endsAt - this.w.tick) : 0;
  }

  /** Why `tribe` cannot stroke the brush at (x, y), or null: inside its forge ring, clear of its Hearth. */
  blocker(tribe: number, x: number, y: number): string | null {
    const w = this.w;
    if (!this.running()) return "the forge is over";
    const t = w.tribes[tribe];
    if (!t || !t.alive) return "no such tribe";
    const h = w.ents.index(t.hearth);
    if (h < 0) return "no Hearth to forge around";
    if (this.ops[tribe] >= this.def.maxOps) return "no forge strokes left";
    const n = w.terrain.size;
    const dx = wrapDelta(x - w.ents.x[h], n);
    const dy = wrapDelta(y - w.ents.y[h], n);
    const d2 = dx * dx + dy * dy;
    const r = this.def.brushRadius;
    if (d2 > (this.def.radius - r) * (this.def.radius - r)) return "too far from your Hearth";
    if (d2 < (this.def.hearthClear + r) * (this.def.hearthClear + r)) return "too close to your Hearth";
    return null;
  }

  /** Step, after commands and terrain: end on time or when every living tribe is ready. */
  update(): void {
    if (!this.running()) return;
    const w = this.w;
    const timeUp = w.tick + 1 >= this.endsAt;
    if (!timeUp && !w.tribes.every((t) => !t.alive || this.ready[t.index])) return;
    this.endedAt = w.tick + 1;
    w.emit("forgeEnded", { why: timeUp ? "time" : "ready" });
  }

  hashInto(f: Fnv): void {
    f.u32(0xf0e9e).f64(this.endedAt);
    for (let t = 0; t < this.ops.length; t++) f.u32(this.ops[t]).u32(this.ready[t] ? 1 : 0);
  }

  save(): ForgeSaved {
    return { ready: this.ready.slice(), ops: this.ops.slice(), endedAt: this.endedAt };
  }

  load(s: ForgeSaved): void {
    this.ready = s.ready.slice();
    this.ops = s.ops.slice();
    this.endedAt = s.endedAt;
  }
}

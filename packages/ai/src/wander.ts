// Test bot: idle units of its tribe wander to random walkable points nearby. Deterministic: draws
// only from the world rng "ai" stream and visits units in index order. Used by soak and bench.
import { CAT, ORDER, dmath, type Command, type Controller, type World } from "@hearthfall/sim";

export interface WanderOptions {
  tribe: number;
  /** ticks between decisions */
  every?: number;
  offset?: number;
  /** chance per decision that an idle unit picks a new target */
  chance?: number;
  minDist?: number;
  maxDist?: number;
}

export class WanderBot implements Controller {
  readonly tribe: number;
  readonly every: number;
  readonly offset: number;
  private readonly chance: number;
  private readonly minDist: number;
  private readonly maxDist: number;

  constructor(o: WanderOptions) {
    this.tribe = o.tribe;
    this.every = o.every ?? 20;
    this.offset = o.offset ?? 0;
    this.chance = o.chance ?? 0.5;
    this.minDist = o.minDist ?? 4;
    this.maxDist = o.maxDist ?? 18;
  }

  decide(w: World): Command[] {
    const E = w.ents;
    const n = w.terrain.size;
    const out: Command[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== this.tribe || E.order[i] !== ORDER.none) continue;
      if (!w.rng.chance("ai", this.chance)) continue;
      const a = w.rng.float("ai") * dmath.TWO_PI;
      const d = this.minDist + w.rng.float("ai") * (this.maxDist - this.minDist);
      const x = (((E.x[i] + dmath.cos(a) * d) % n) + n) % n;
      const y = (((E.y[i] + dmath.sin(a) * d) % n) + n) % n;
      if (!w.terrain.walkable(Math.round(x), Math.round(y))) continue;
      out.push({ tick: w.tick, tribe: this.tribe, type: "move", args: { units: [E.idOf(i)], to: [x, y] } });
    }
    return out;
  }
}

// Economy bot (M4): keeps an unharassed tribe growing by placing dwelling plans near its Hearth
// whenever housing runs short. Settlers do the rest autonomously. Deterministic: fixed spiral
// search, no randomness. M7 opponents build on this.
import { BSTATE, CAT, dmath, type Command, type Controller, type World } from "@hearthfall/sim";

export interface EconomyBotOptions {
  tribe: number;
  every?: number;
  offset?: number;
  /** plan another dwelling when free housing (cap minus population) drops below this */
  housingSlack?: number;
  minRing?: number;
  maxRing?: number;
}

/** flattening work (height units summed over the pad) that one ring farther from the Hearth is worth */
const RING_COST = 24;

export class EconomyBot implements Controller {
  readonly tribe: number;
  readonly every: number;
  readonly offset: number;
  private readonly slack: number;
  private readonly minRing: number;
  private readonly maxRing: number;

  constructor(o: EconomyBotOptions) {
    this.tribe = o.tribe;
    this.every = o.every ?? 40;
    this.offset = o.offset ?? 0;
    this.slack = o.housingSlack ?? 4;
    this.minRing = o.minRing ?? 4;
    this.maxRing = o.maxRing ?? 22;
  }

  decide(w: World): Command[] {
    const E = w.ents;
    const h = E.index(w.tribes[this.tribe]?.hearth ?? 0xffffffff);
    if (h < 0) return [];
    let open = 0;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building && E.tribe[i] === this.tribe && E.state[i] !== BSTATE.done) open++;
    const limit = Math.min(w.cfg.pack.balance.economy.maxOpenPlansPerTribe, 1 + Math.floor(w.economy.followers(this.tribe) / 12));
    if (open >= limit) return [];
    const pop = w.economy.followers(this.tribe);
    const cap = w.economy.popCap(this.tribe);
    if (cap - pop >= this.slack + open * 3) return [];
    const spot = this.findSpot(w, "dwelling", E.x[h], E.y[h]);
    return spot ? [{ tick: w.tick, tribe: this.tribe, type: "placePlan", args: { building: "dwelling", at: spot } }] : [];
  }

  /**
   * Buildable, tree-free spot for a building on rings around the Hearth (deterministic order): the least
   * flattening work over the first ring with a spot and the next one (one ring farther costs RING_COST).
   * BACKLOG 0a: on terraced land the first spot found often straddled a step and took a minute to level.
   */
  findSpot(w: World, building: string, hx: number, hy: number): [number, number] | null {
    // BACKLOG 0c: every candidate would be refused for want of stone, so skip the ring scan
    if ((w.cfg.pack.buildings.buildings[w.cfg.buildingIndex.get(building)!].stone ?? 0) > 0 && !w.economy.stoneInReach(hx, hy)) return null;
    // prefer tree-free ground; fall back to wooded spots (trees in a footprint are chopped out first)
    return this.scan(w, building, hx, hy, true) ?? this.scan(w, building, hx, hy, false);
  }

  private scan(w: World, building: string, hx: number, hy: number, treeFree: boolean): [number, number] | null {
    const type = w.cfg.buildingIndex.get(building)!;
    const [fw, fh] = w.cfg.pack.buildings.buildings[type].footprint;
    const n = w.terrain.size;
    const E = w.ents;
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    let firstRing = -1;
    for (let r = this.minRing; r <= this.maxRing; r++) {
      if (firstRing >= 0 && r > firstRing + 1) break;
      const steps = Math.max(6, Math.floor(r * 2));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * dmath.TWO_PI + r * 0.37;
        const cx = Math.round((((hx + dmath.cos(a) * r) % n) + n) % n - fw / 2) + fw / 2;
        const cy = Math.round((((hy + dmath.sin(a) * r) % n) + n) % n - fh / 2) + fh / 2;
        if (w.economy.planBlocker(type, cx, cy)) continue;
        let tree = false;
        for (let i = 0; i < E.hi && !tree && treeFree; i++) {
          if (!E.alive[i] || E.cat[i] !== CAT.tree) continue;
          let dx = Math.abs(E.x[i] - cx);
          let dy = Math.abs(E.y[i] - cy);
          if (dx > n / 2) dx = n - dx;
          if (dy > n / 2) dy = n - dy;
          if (dx <= fw / 2 + 0.6 && dy <= fh / 2 + 0.6) tree = true;
        }
        if (tree) continue;
        if (firstRing < 0) firstRing = r;
        const score = w.economy.flattenWork(type, cx, cy) + RING_COST * (r - firstRing);
        if (score < bestScore) {
          bestScore = score;
          best = [cx, cy];
        }
      }
    }
    return best;
  }
}

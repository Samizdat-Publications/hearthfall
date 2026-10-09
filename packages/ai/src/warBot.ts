// War bot (M6 test bot, base of the M7 opponents): runs the economy bot, then builds one lodge per
// troop type in its mix and a Watchtower, trains settlers toward the mix while keeping a working
// population, rallies graduates by the Hearth and sends attack-move waves at the nearest enemy
// Hearth. Deterministic: entity index order, no randomness.
import { BSTATE, CAT, wrapDelta, type Command, type Controller, type World } from "@hearthfall/sim";
import { EconomyBot } from "./economyBot.ts";

export interface WarBotOptions {
  tribe: number;
  every?: number;
  offset?: number;
  /** troop unit id -> weight */
  mix?: Record<string, number>;
  /** settlers kept out of training */
  keepSettlers?: number;
  /** idle troops needed before a wave goes out */
  waveSize?: number;
  tower?: boolean;
}

export class WarBot implements Controller {
  readonly tribe: number;
  readonly every: number;
  readonly offset: number;
  private readonly eco: EconomyBot;
  private readonly mix: [string, number][];
  private readonly keep: number;
  private readonly wave: number;
  private readonly tower: boolean;
  waves = 0;

  constructor(o: WarBotOptions) {
    this.tribe = o.tribe;
    this.every = o.every ?? 40;
    this.offset = o.offset ?? 0;
    this.eco = new EconomyBot({ tribe: o.tribe, every: this.every, offset: this.offset });
    this.mix = Object.entries(o.mix ?? { warden: 1, firecaller: 1, chanter: 1 });
    this.keep = o.keepSettlers ?? 12;
    this.wave = o.waveSize ?? 8;
    this.tower = o.tower ?? true;
  }

  decide(w: World): Command[] {
    const tr = w.tribes[this.tribe];
    if (!tr?.alive) return [];
    const E = w.ents;
    const h = E.index(tr.hearth);
    if (h < 0) return [];
    const out = this.eco.decide(w);
    const cmd = (type: string, args: Record<string, unknown>) => out.push({ tick: w.tick, tribe: this.tribe, type, args });
    const units = w.cfg.pack.units.units;
    const bdefs = w.cfg.pack.buildings.buildings;

    // census in index order
    const lodges = new Map<string, number[]>();
    let towers = 0;
    let open = 0;
    let settlers = 0;
    const troops = new Map<string, number>();
    const idleTroops: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.tribe[i] !== this.tribe) continue;
      if (E.cat[i] === CAT.building) {
        const id = bdefs[E.type[i]].id;
        if (E.state[i] !== BSTATE.done) open++;
        if (bdefs[E.type[i]].trains) lodges.set(id, [...(lodges.get(id) ?? []), i]);
        if (w.combat.garrisonOf(E.type[i]) > 0) towers++;
      } else if (E.cat[i] === CAT.unit) {
        const def = units[E.type[i]];
        if (E.type[i] === w.economy.typeSettler) settlers++;
        else if (def.trainedAt) {
          troops.set(def.id, (troops.get(def.id) ?? 0) + 1);
          if (E.inside[i] < 0 && E.mode[i] === 0 && E.order[i] === 0) idleTroops.push(i);
        }
      }
    }

    // 1. one lodge per troop type in the mix, then a tower (one new plan per decision)
    const limit = w.cfg.pack.balance.economy.maxOpenPlansPerTribe;
    if (settlers >= this.keep && open < limit) {
      let want: string | null = null;
      for (const [unit] of this.mix) {
        const lodge = units[w.cfg.unitIndex.get(unit)!].trainedAt;
        if (lodge && !lodges.has(lodge)) {
          want = lodge;
          break;
        }
      }
      if (!want && this.tower && towers === 0) want = "watchtower";
      if (want) {
        const spot = this.eco.findSpot(w, want, E.x[h], E.y[h]);
        if (spot) cmd("placePlan", { building: want, at: spot });
      }
    }

    // 2. train toward the mix while keeping a working population
    const queued = w.combat.queued();
    let spare = settlers - this.keep;
    const total = this.mix.reduce((a, [, k]) => a + k, 0);
    const have = (u: string) => troops.get(u) ?? 0;
    const ordered = [...this.mix].sort((a, b) => have(a[0]) / a[1] - have(b[0]) / b[1] || (a[0] < b[0] ? -1 : 1));
    for (const [unit] of ordered) {
      if (spare <= 0 || total <= 0) break;
      const lodgeId = units[w.cfg.unitIndex.get(unit)!].trainedAt;
      for (const b of lodgeId ? (lodges.get(lodgeId) ?? []) : []) {
        if (E.state[b] !== BSTATE.done) continue;
        if (E.mode[b] === 0) cmd("setRally", { building: E.idOf(b), at: [E.x[h] + 3, E.y[h] + 3] });
        if ((queued.get(b) ?? 0) >= 2) continue;
        cmd("train", { building: E.idOf(b), count: 1 });
        spare--;
        break;
      }
    }

    // 3. waves: attack-move idle troops at the nearest living enemy Hearth reachable on foot (other
    // landmasses need Raise Land or boats, which belong to the M7 opponent AI)
    if (idleTroops.length >= this.wave) {
      const n = w.terrain.size;
      const pf = w.units.pf;
      const snap = w.cfg.pack.balance.movement.snapRadius;
      const comp = (x: number, y: number) => {
        const v = pf.nearestWalkable((((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n, snap);
        return v < 0 ? -1 : pf.comp[v];
      };
      const home = comp(E.x[h], E.y[h]);
      let best = -1;
      let bestD = Infinity;
      for (const t of w.tribes) {
        if (t.index === this.tribe || !t.alive) continue;
        const eh = E.index(t.hearth);
        if (eh < 0 || home < 0 || comp(E.x[eh], E.y[eh]) !== home) continue;
        const dx = wrapDelta(E.x[eh] - E.x[h], n);
        const dy = wrapDelta(E.y[eh] - E.y[h], n);
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = eh;
        }
      }
      if (best >= 0) {
        cmd("move", { units: idleTroops.map((i) => E.idOf(i)), to: [E.x[best], E.y[best]], attack: true });
        this.waves++;
      }
    }
    return out;
  }
}

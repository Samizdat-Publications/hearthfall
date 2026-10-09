// Test bot personalities (M7): fixtures for soaks and fuzzing, not opponents a player picks.
// rusher and turtleBot are OpponentAI presets with extreme numbers; SpellSpammerBot fires every
// charged spell at enemy targets; RandomLegalBot issues random well-formed commands (many are
// rejected, which is the point: rejections must never break invariants). Deterministic: the
// world's "ai" rng stream only.
import { CAT, STANCE_NAMES, type Command, type Controller, type World } from "@hearthfall/sim";
import { EconomyBot } from "./economyBot.ts";
import { OpponentAI, type Personality } from "./opponent.ts";

export const RUSHER: Personality = { id: "test_rusher", economyTargetPop: 24, armyMix: { warden: 1 }, aggression: 1, firstAttackMinute: 3, spellPrefs: ["bolt"], scouting: 1, towerAffinity: 0 };
export const TURTLE_BOT: Personality = { id: "test_turtle", economyTargetPop: 90, armyMix: { warden: 0.4, firecaller: 0.6 }, aggression: 0, firstAttackMinute: 60, spellPrefs: ["lightning", "flatten"], scouting: 0, towerAffinity: 1 };

export function rusher(o: { tribe: number; offset?: number; difficulty?: string }): OpponentAI {
  return new OpponentAI({ ...o, personality: RUSHER });
}

export function turtleBot(o: { tribe: number; offset?: number; difficulty?: string }): OpponentAI {
  return new OpponentAI({ ...o, personality: TURTLE_BOT });
}

/** Living enemy entities (units and buildings) of any other tribe, in index order. */
function enemies(w: World, tribe: number): number[] {
  const E = w.ents;
  const out: number[] = [];
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.tribe[i] < 0 || E.tribe[i] === tribe || !w.tribes[E.tribe[i]]?.alive) continue;
    if (E.cat[i] === CAT.unit || E.cat[i] === CAT.building) out.push(i);
  }
  return out;
}

export interface SpellSpammerOptions {
  tribe: number;
  every?: number;
  offset?: number;
}

/** Auto-charges every unlocked spell, keeps the economy growing, and casts whatever is charged at a random enemy. */
export class SpellSpammerBot implements Controller {
  readonly tribe: number;
  readonly every: number;
  readonly offset: number;
  readonly stats = { casts: {} as Record<string, number> };
  private eco: EconomyBot;
  private setUp = false;

  constructor(o: SpellSpammerOptions) {
    this.tribe = o.tribe;
    this.every = o.every ?? 40;
    this.offset = o.offset ?? 0;
    this.eco = new EconomyBot({ tribe: o.tribe, every: this.every, offset: this.offset });
  }

  decide(w: World): Command[] {
    const t = w.tribes[this.tribe];
    if (!t?.alive) return [];
    const out = this.eco.decide(w);
    const cmd = (type: string, args: Record<string, unknown>) => out.push({ tick: w.tick, tribe: this.tribe, type, args });
    const spells = w.cfg.pack.spells.spells;
    if (!this.setUp) {
      this.setUp = true;
      spells.forEach((s, i) => {
        if (t.eco.unlocked[i] && !t.eco.auto[i]) cmd("setAutoCharge", { spell: s.id, on: true });
      });
    }
    if (t.casting || t.pending) return out;
    const charged = spells.map((_, i) => i).filter((i) => t.eco.unlocked[i] && t.eco.charges[i] > 0);
    const foes = enemies(w, this.tribe);
    if (!charged.length || !foes.length) return out;
    const s = charged[w.rng.int("ai", charged.length)];
    const f = foes[w.rng.int("ai", foes.length)];
    cmd("cast", { spell: spells[s].id, target: [w.ents.x[f], w.ents.y[f]] });
    this.stats.casts[spells[s].id] = (this.stats.casts[spells[s].id] ?? 0) + 1;
    return out;
  }
}

export interface RandomLegalOptions {
  tribe: number;
  every?: number;
  offset?: number;
  /** commands per decision */
  burst?: number;
}

/** Fuzzer: random but well-formed commands over the whole Command API from its own entities. */
export class RandomLegalBot implements Controller {
  readonly tribe: number;
  readonly every: number;
  readonly offset: number;
  private readonly burst: number;
  readonly stats = { issued: {} as Record<string, number> };

  constructor(o: RandomLegalOptions) {
    this.tribe = o.tribe;
    this.every = o.every ?? 20;
    this.offset = o.offset ?? 0;
    this.burst = o.burst ?? 2;
  }

  decide(w: World): Command[] {
    if (!w.tribes[this.tribe]?.alive) return [];
    const E = w.ents;
    const n = w.terrain.size;
    const r = (k: number) => w.rng.int("ai", Math.max(1, k));
    const units: number[] = [];
    const buildings: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.tribe[i] !== this.tribe) continue;
      if (E.cat[i] === CAT.unit) units.push(E.idOf(i));
      else if (E.cat[i] === CAT.building) buildings.push(E.idOf(i));
    }
    const h = E.index(w.tribes[this.tribe].hearth);
    const near = (): [number, number] => (h >= 0 ? [E.x[h] + r(41) - 20, E.y[h] + r(41) - 20] : [r(n), r(n)]);
    const some = () => {
      const k = 1 + r(Math.min(8, units.length));
      const pick: number[] = [];
      for (let j = 0; j < k && units.length; j++) {
        const u = units[r(units.length)];
        if (!pick.includes(u)) pick.push(u);
      }
      return pick;
    };
    const anyBuilding = () => (buildings.length ? buildings[r(buildings.length)] : 0);
    const bdefs = w.cfg.pack.buildings.buildings.filter((b) => b.buildable !== false && b.milestone !== "backlog");
    const spells = w.cfg.pack.spells.spells;
    const gen: [string, () => Record<string, unknown>][] = [
      ["move", () => ({ units: some(), to: near(), attack: r(2) === 1 })],
      ["stop", () => ({ units: some() })],
      ["placePlan", () => ({ building: bdefs[r(bdefs.length)].id, at: near() })],
      ["cancelPlan", () => ({ building: anyBuilding() })],
      ["setSplit", () => ({ spellsPct: r(101) })],
      ["setAutoCharge", () => ({ spell: spells[r(spells.length)].id, on: r(2) === 1 })],
      ["setPriorities", () => ({ build: r(2), upgrade: r(2), breed: r(2) })],
      ["cast", () => ({ spell: spells[r(spells.length)].id, target: near() })],
      ["cancelCast", () => ({})],
      ["train", () => ({ building: anyBuilding(), count: 1 + r(3) })],
      ["setRally", () => ({ building: anyBuilding(), at: r(4) === 0 ? null : near() })],
      ["setStance", () => ({ units: some(), stance: STANCE_NAMES[r(STANCE_NAMES.length)] })],
      ["garrison", () => ({ units: some(), building: anyBuilding() })],
      ["ungarrison", () => ({ building: anyBuilding() })],
      ["retreat", () => ({ units: some() })],
    ];
    const out: Command[] = [];
    for (let k = 0; k < this.burst; k++) {
      const [type, args] = gen[r(gen.length)];
      out.push({ tick: w.tick, tribe: this.tribe, type, args: args() });
      this.stats.issued[type] = (this.stats.issued[type] ?? 0) + 1;
    }
    return out;
  }
}

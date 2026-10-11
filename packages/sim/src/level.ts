// Campaign levels (M9): data/levels/*.json validated by validateLevel (packages/data). A level is a
// handmade map (flat generator plus painted islands), a setup list, objectives, lose conditions and
// triggers. LevelRuntime evaluates them in step 9 after worship; the player is tribe 0. The outcome is
// sim state (hashed and snapshotted), so a replay of a level proves the same win or loss.
import type { LevelDef, PackFiles } from "@hearthfall/data";
import { registerCommand } from "./commands.ts";
import { BSTATE } from "./economy.ts";
import { CAT } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import { wrapDelta } from "./terrain.ts";
import type { MapSpec } from "./generator.ts";
import { applySetup, type BotFactory } from "./scenario.ts";
import { applyReward } from "./worship.ts";
import { World, type WorldInit } from "./world.ts";

export const PLAYER = 0;
export const OUTCOME = { none: 0, won: 1, lost: 2 } as const;

/** Unlocks the campaign carries into a level for the player (earlier levels won). */
export interface CampaignCarry {
  spells?: string[];
  buildings?: string[];
}

export interface LevelInit {
  def: LevelDef;
  carry?: CampaignCarry;
}

export interface LevelSaved {
  done: number[];
  fired: number[];
  outcome: number;
  /** tick the outcome was decided (-1 none) */
  endedAt: number;
  /** stretch 3: per objective, the tick a `hold` began (-1 not holding); absent when none ever held */
  holdSince?: number[];
  /** S4: per objective, the tick its stage opened (-1 not yet) and its clearDens baseline; only in levels with fromStage goals */
  openedAt?: number[];
  base?: number[];
}

export function levelMap(def: LevelDef): MapSpec {
  return { generator: def.map.generator, size: def.map.size, tribes: def.tribes.length, landAboveSea: def.map.landAboveSea, paint: def.map.paint };
}

export class LevelRuntime {
  readonly def: LevelDef;
  done: number[];
  fired: number[];
  outcome: number = OUTCOME.none;
  endedAt = -1;
  /** stretch 3: per objective, the tick its `hold` streak began, or a `fromStage` survive's stage opened (-1 none) */
  holdSince: number[];
  /** S4: per objective, the tick its stage first opened (-1 not yet), kept only when `staged` */
  openedAt: number[];
  /** S4: per objective, cleared dens in its area when a fromStage clearDens opened */
  base: number[];
  /** S4: the level has stage-relative goals (fromStage) or kill counts (kept in base), so openedAt and base are state */
  readonly staged: boolean;
  /** building types every tribe may build in this level (null: all) */
  readonly allowed: Set<number> | null;
  private w: World;

  /** S4: the level's cap on a tribe's people (followers), or -1 for none */
  popCap(tribe: number): number {
    return this.def.tribes[tribe]?.maxPopulation ?? -1;
  }

  /**
   * S4: with a fromStage `victory` objective the rules count only once its stage is open, from that tick
   * (-1 while it is still closed; 0 when the rules count from the start).
   */
  rulesSince(): number {
    let since = 0;
    this.def.objectives.forEach((o, k) => {
      if (o.type !== "victory" || !o.fromStage || since < 0) return;
      since = this.openedAt[k] < 0 ? -1 : Math.max(since, this.openedAt[k]);
    });
    return since;
  }

  /** BACKLOG 83: the level's cap on a tribe's trained troops, or -1 for none */
  troopCap(tribe: number): number {
    return this.def.tribes[tribe]?.maxTroops ?? -1;
  }

  constructor(w: World, def: LevelDef) {
    this.w = w;
    this.def = def;
    this.done = def.objectives.map(() => 0);
    this.fired = (def.triggers ?? []).map(() => 0);
    this.holdSince = def.objectives.map(() => -1);
    this.openedAt = def.objectives.map(() => -1);
    this.base = def.objectives.map(() => 0);
    this.staged = def.objectives.some((o) => ("fromStage" in o && o.fromStage === true) || o.type === "kill");
    this.allowed = def.buildings ? new Set(def.buildings.map((b) => w.cfg.buildingIndex.get(b)!).filter((b) => b !== undefined)) : null;
  }

  private siteBy(tag: string): number {
    return this.w.worship.find(tag)?.lastBy ?? -1;
  }

  private objectiveMet(k: number): boolean {
    const w = this.w;
    const o = this.def.objectives[k];
    const me = w.tribes[PLAYER];
    // S4: a fromStage goal cannot be met on the tick its stage opens (a trigger on the earlier stage may
    // still be placing its targets), so a goal already true at the opening does not complete at once
    const later = !("fromStage" in o && o.fromStage === true) || w.tick > this.openedAt[k];
    switch (o.type) {
      case "eliminateAll":
        return later && w.tribes.every((t) => t.index === PLAYER || !t.alive);
      case "worship":
        if (o.fromStage) return later && w.events.some((e) => e.type === "worshipComplete" && e.tribe === PLAYER && e.site === o.site);
        return this.siteBy(o.site) === PLAYER;
      case "survive": {
        const need = Math.round(o.seconds * w.cfg.tickHz);
        if (!o.fromStage) return me.alive && w.playTick + 1 >= need;
        // stretch 3: counted from the tick the stage opened (holdSince doubles as the stage start)
        if (this.holdSince[k] < 0) this.holdSince[k] = w.tick;
        return me.alive && w.tick - this.holdSince[k] + 1 >= need;
      }
      case "followers":
        if (!o.fromStage) return w.economy.followers(PLAYER) >= o.n;
        // S4 L6-C: gained since the stage opened
        if (w.tick === this.openedAt[k]) this.base[k] = w.economy.followers(PLAYER);
        return later && w.economy.followers(PLAYER) >= this.base[k] + o.n;
      case "kill":
        return this.base[k] >= o.n;
      case "victory":
        return w.rules?.winner === PLAYER;
      case "destroy":
        // an eliminated tribe's leftover buildings cannot be targeted, so its fall counts too
        return later && (!w.tribes[o.tribe]?.alive || this.countBuildings(o.tribe, o.building, false) === 0);
      case "build":
        return this.countBuildings(PLAYER, o.building, true) >= o.n;
      case "reach":
        return this.unitNear(o.at[0], o.at[1], o.r, o.unit ?? "shaper");
      case "hold": {
        if (this.held(o.kind) < o.n) {
          this.holdSince[k] = -1;
          return false;
        }
        if (this.holdSince[k] < 0) this.holdSince[k] = w.tick;
        return w.tick - this.holdSince[k] + 1 >= Math.max(1, Math.round(o.seconds * w.cfg.tickHz));
      }
      case "clearDens": {
        const n = w.terrain.size;
        const at = o.at;
        const r = o.r ?? 0;
        const dens = at ? w.beasts.dens.filter((d) => {
          const dx = wrapDelta(d.x - at[0], n);
          const dy = wrapDelta(d.y - at[1], n);
          return dx * dx + dy * dy <= r * r;
        }) : w.beasts.dens;
        const cleared = dens.filter((d) => d.cleared).length;
        if (o.fromStage) {
          // S4: only dens cleared after the stage opened count (every den still standing then, when n is absent)
          if (w.tick === this.openedAt[k]) this.base[k] = cleared;
          const need = o.n ?? dens.length - this.base[k];
          return later && cleared - this.base[k] >= need;
        }
        return dens.length > 0 && cleared >= (o.n ?? dens.length);
      }
    }
  }

  /** S4 L6-C: units of `tribe` (any rival when undefined) of type `unit` the player killed this tick (struck down or drowned after its hit) */
  private kills(tribe: number | undefined, unit: string | undefined): number {
    const w = this.w;
    const type = unit === undefined ? -1 : (w.cfg.unitIndex.get(unit) ?? -2);
    let n = 0;
    for (const e of w.events) {
      if ((e.type !== "killed" && e.type !== "drowned") || e.cat !== CAT.unit || e.by !== PLAYER) continue;
      const t = e.tribe as number;
      if ((tribe === undefined ? t < 1 : t !== tribe) || (type !== -1 && e.kind !== type)) continue;
      n++;
    }
    return n;
  }

  /** capturable stones the player holds now (of `kind`, any when undefined) */
  held(kind: string | undefined): number {
    const w = this.w;
    const kt = kind === undefined ? -1 : w.worship.kindIndex(kind);
    let n = 0;
    for (const s of w.worship.sites) if (s.lastBy === PLAYER && !s.dormant && w.worship.capturable(s.kind) && (kt < 0 || s.kind === kt) && w.ents.index(s.ent) >= 0) n++;
    return n;
  }

  /** buildings of type `id` that `tribe` owns (only finished ones when `done`) */
  private countBuildings(tribe: number, id: string, done: boolean): number {
    const w = this.w;
    const E = w.ents;
    const type = w.cfg.buildingIndex.get(id);
    let n = 0;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building && E.tribe[i] === tribe && E.type[i] === type && (!done || E.state[i] === BSTATE.done)) n++;
    return n;
  }

  /** does one of the player's units (of type `unit`, any when undefined) stand within r of (x, y)? */
  private unitNear(x: number, y: number, r: number, unit: string | undefined): boolean {
    const w = this.w;
    const E = w.ents;
    const n = w.terrain.size;
    const type = unit === undefined ? -1 : (w.cfg.unitIndex.get(unit) ?? -2);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== PLAYER || E.inside[i] >= 0 || (type !== -1 && E.type[i] !== type)) continue;
      const dx = wrapDelta(E.x[i] - x, n);
      const dy = wrapDelta(E.y[i] - y, n);
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /** a staged objective is open once the objective it follows is done */
  open(k: number): boolean {
    const after = this.def.objectives[k].after;
    return after === undefined || this.done[after] === 1;
  }

  private lost(): string | null {
    const w = this.w;
    if (!w.tribes[PLAYER].alive) return "eliminated";
    // BACKLOG 13: a rival won the level's victory rules
    if (w.rules && w.rules.winner >= 0 && w.rules.winner !== PLAYER) return "outplayed";
    for (const l of this.def.lose ?? []) {
      if (l.type === "timeLimit" && w.playTick + 1 >= Math.round(l.seconds * w.cfg.tickHz)) return "timeLimit";
      if (l.type === "hearthLost" && w.ents.index(w.tribes[PLAYER].hearth) < 0) return "hearthLost";
      if (l.type === "siteLost") {
        // S4: gated to a stretch of the level (after one objective, until another)
        if ((l.after !== undefined && this.done[l.after] !== 1) || (l.before !== undefined && this.done[l.before] === 1)) continue;
        const by = this.siteBy(l.site);
        if (by >= 0 && by !== PLAYER) return "siteLost";
      }
    }
    return null;
  }

  /** Step 9, after worship: triggers, objectives, then the outcome (a win beats a loss on the same tick). */
  update(): void {
    if (this.outcome !== OUTCOME.none) return;
    const w = this.w;
    this.def.objectives.forEach((o, k) => {
      if (this.openedAt[k] < 0 && this.open(k)) this.openedAt[k] = w.tick;
      if (o.type === "kill" && !this.done[k] && this.open(k)) this.base[k] += this.kills(o.tribe, o.unit);
      if (!this.done[k] && this.open(k) && this.objectiveMet(k)) {
        this.done[k] = 1;
        w.emit("objectiveComplete", { index: k, kind: o.type });
      }
    });
    // stretch 3: every 2 s a beacon event marks open reach objectives (render only reads it)
    if (w.tick % (2 * w.cfg.tickHz) === 0)
      this.def.objectives.forEach((o, k) => {
        if (o.type === "reach" && !this.done[k] && this.open(k)) w.emit("beacon", { x: o.at[0], y: o.at[1], r: o.r });
      });
    (this.def.triggers ?? []).forEach((t, k) => {
      // stretch 3: a repeating time trigger counts its firings in `fired`
      const repeat = t.when.type === "time" && t.when.every !== undefined;
      if (this.fired[k] && !repeat) return;
      if (t.until !== undefined && this.done[t.until]) return;
      let tribe = PLAYER;
      let x = 0;
      let y = 0;
      const when = t.when;
      if (when.type === "time") {
        if (w.playTick + 1 < Math.round((when.seconds + this.fired[k] * (when.every ?? 0)) * w.cfg.tickHz)) return;
      } else if (when.type === "objective") {
        if (!this.done[when.index]) return;
      } else if (when.type === "followers") {
        if (w.economy.followers(PLAYER) < when.n) return;
      } else if (when.type === "area") {
        if (!this.unitNear(when.at[0], when.at[1], when.r, when.unit)) return;
        x = when.at[0];
        y = when.at[1];
      } else {
        const s = w.worship.find(when.site);
        if (!s || s.lastBy < 0) return;
        tribe = s.lastBy;
        const si = w.ents.index(s.ent);
        if (si >= 0) {
          x = w.ents.x[si];
          y = w.ents.y[si];
        }
      }
      // anchor for rewards without `at`: the site, else the player's Hearth, else the Shaper, else the map center
      if (when.type !== "worship" && when.type !== "area") {
        let h = w.ents.index(w.tribes[PLAYER].hearth);
        if (h < 0) h = w.ents.index(w.tribes[PLAYER].shaper);
        if (h >= 0) {
          x = w.ents.x[h];
          y = w.ents.y[h];
        } else {
          x = w.terrain.size / 2;
          y = w.terrain.size / 2;
        }
      }
      this.fired[k] = repeat ? this.fired[k] + 1 : 1;
      w.emit("triggerFired", { index: k });
      const spawned: number[] = [];
      for (const r of t.do) {
        // S4 L6-C: a repeating trigger no longer spawns for, or raids with, a tribe that has fallen
        const owner = r.type === "spawn" ? (r.tribe ?? tribe) : r.type === "raid" ? r.tribe : -1;
        if (repeat && owner >= 0 && !w.tribes[owner]?.alive) continue;
        applyReward(w, tribe, r, x, y, spawned);
      }
    });
    if (this.done.every((d) => d === 1)) this.finish(OUTCOME.won, "objectives");
    else {
      const why = this.lost();
      if (why) this.finish(OUTCOME.lost, why);
    }
  }

  private finish(outcome: number, why: string): void {
    this.outcome = outcome;
    this.endedAt = this.w.tick;
    this.w.emit(outcome === OUTCOME.won ? "levelWon" : "levelLost", { level: this.def.id, why });
  }

  hashInto(f: Fnv): void {
    f.u32(0x1e7e1).u32(this.outcome).f64(this.endedAt);
    for (const d of this.done) f.u32(d);
    for (const d of this.fired) f.u32(d);
    if (this.holdSince.some((h) => h >= 0)) for (const h of this.holdSince) f.u32(h + 1);
    if (this.staged) for (let k = 0; k < this.openedAt.length; k++) f.u32(this.openedAt[k] + 1).u32(this.base[k]);
  }

  save(): LevelSaved {
    return { done: this.done.slice(), fired: this.fired.slice(), outcome: this.outcome, endedAt: this.endedAt, ...(this.holdSince.some((h) => h >= 0) ? { holdSince: this.holdSince.slice() } : {}), ...(this.staged ? { openedAt: this.openedAt.slice(), base: this.base.slice() } : {}) };
  }

  load(s: LevelSaved): void {
    this.done = s.done.slice();
    this.fired = s.fired.slice();
    this.outcome = s.outcome;
    this.endedAt = s.endedAt;
    this.holdSince = s.holdSince ? s.holdSince.slice() : this.def.objectives.map(() => -1);
    this.openedAt = s.openedAt ? s.openedAt.slice() : this.def.objectives.map(() => -1);
    this.base = s.base ? s.base.slice() : this.def.objectives.map(() => 0);
  }
}

/** God mode (tests and the e2e flow): mark every objective done; the level is won in this tick's step 9. */
registerCommand("completeObjectives", {
  validate(w, c) {
    if (c.tribe !== -1 && !w.godMode) return "completeObjectives is god mode only";
    if (!w.level) return "not a campaign level";
    return w.level.outcome === OUTCOME.none ? null : "the level is over";
  },
  apply(w) {
    w.level!.done = w.level!.done.map(() => 1);
  },
});

/** The WorldInit of a level (fresh or restored from a save): its painted map, rules and Forge. */
export function levelWorldInit(init: LevelInit, pack: PackFiles, packHash: string): WorldInit {
  const def = init.def;
  return { pack, packHash, seed: def.seed, map: levelMap(def), populate: false, level: init, ...(def.rules ? { rules: def.rules } : {}), ...(def.forge ? { forge: true } : {}), ...(def.weather === "rain" ? { weather: "rain" as const } : {}) };
}

/**
 * Build a level world: the painted map, per-level spell unlocks (plus the campaign carry for the
 * player), setup, and AI controllers for tribes 1+ from `makeAi` (packages/ai OpponentAI).
 */
export function createLevelWorld(init: LevelInit, pack: PackFiles, packHash: string, makeAi?: BotFactory): World {
  const def = init.def;
  const w = new World(levelWorldInit(init, pack, packHash));
  const spells = w.cfg.pack.spells.spells;
  const auto = w.cfg.pack.balance.economy.defaultAutoCharge;
  for (const t of w.tribes) {
    spells.forEach((s, i) => {
      const on = def.spells.includes(s.id) || (t.index === PLAYER && (init.carry?.spells ?? []).includes(s.id));
      t.eco.unlocked[i] = on ? 1 : 0;
      t.eco.auto[i] = on && auto.includes(s.id) ? 1 : 0;
      // the skirmish start charges only survive for spells the level opens
      if (!on) t.eco.charges[i] = 0;
    });
  }
  for (const b of init.carry?.buildings ?? []) {
    const type = w.cfg.buildingIndex.get(b);
    if (type === undefined) continue;
    while (w.worship.granted.length <= PLAYER) w.worship.granted.push([]);
    if (!w.worship.granted[PLAYER].includes(type)) w.worship.granted[PLAYER].push(type);
  }
  applySetup(w, def.setup);
  def.tribes.forEach((t, k) => {
    if (k === PLAYER || !t.ai) return;
    if (!makeAi) throw new Error("level has AI tribes but no controller factory was given");
    w.controllers.push(makeAi({ type: "opponent", tribe: k, personality: t.ai, difficulty: t.difficulty ?? "normal", offset: k - 1, ...(t.worshipAfterSeconds !== undefined ? { worshipAfterSeconds: t.worshipAfterSeconds } : {}) }));
  });
  return w;
}

// Campaign levels (M9): data/levels/*.json validated by validateLevel (packages/data). A level is a
// handmade map (flat generator plus painted islands), a setup list, objectives, lose conditions and
// triggers. LevelRuntime evaluates them in step 9 after worship; the player is tribe 0. The outcome is
// sim state (hashed and snapshotted), so a replay of a level proves the same win or loss.
import type { LevelDef, PackFiles } from "@hearthfall/data";
import { registerCommand } from "./commands.ts";
import type { Fnv } from "./hash.ts";
import type { MapSpec } from "./generator.ts";
import { applySetup, type BotFactory } from "./scenario.ts";
import { applyReward } from "./worship.ts";
import { World } from "./world.ts";

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
  /** building types every tribe may build in this level (null: all) */
  readonly allowed: Set<number> | null;
  private w: World;

  constructor(w: World, def: LevelDef) {
    this.w = w;
    this.def = def;
    this.done = def.objectives.map(() => 0);
    this.fired = (def.triggers ?? []).map(() => 0);
    this.allowed = def.buildings ? new Set(def.buildings.map((b) => w.cfg.buildingIndex.get(b)!).filter((b) => b !== undefined)) : null;
  }

  private siteBy(tag: string): number {
    return this.w.worship.find(tag)?.lastBy ?? -1;
  }

  private objectiveMet(k: number): boolean {
    const w = this.w;
    const o = this.def.objectives[k];
    const me = w.tribes[PLAYER];
    switch (o.type) {
      case "eliminateAll":
        return w.tribes.every((t) => t.index === PLAYER || !t.alive);
      case "worship":
        return this.siteBy(o.site) === PLAYER;
      case "survive":
        return me.alive && w.tick + 1 >= Math.round(o.seconds * w.cfg.tickHz);
      case "followers":
        return w.economy.followers(PLAYER) >= o.n;
    }
  }

  private lost(): string | null {
    const w = this.w;
    if (!w.tribes[PLAYER].alive) return "eliminated";
    for (const l of this.def.lose ?? []) {
      if (l.type === "timeLimit" && w.tick + 1 >= Math.round(l.seconds * w.cfg.tickHz)) return "timeLimit";
      if (l.type === "hearthLost" && w.ents.index(w.tribes[PLAYER].hearth) < 0) return "hearthLost";
      if (l.type === "siteLost") {
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
      if (!this.done[k] && this.objectiveMet(k)) {
        this.done[k] = 1;
        w.emit("objectiveComplete", { index: k, kind: o.type });
      }
    });
    (this.def.triggers ?? []).forEach((t, k) => {
      if (this.fired[k]) return;
      let tribe = PLAYER;
      let x = 0;
      let y = 0;
      const when = t.when;
      if (when.type === "time") {
        if (w.tick + 1 < Math.round(when.seconds * w.cfg.tickHz)) return;
      } else if (when.type === "objective") {
        if (!this.done[when.index]) return;
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
      if (when.type !== "worship") {
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
      this.fired[k] = 1;
      w.emit("triggerFired", { index: k });
      for (const r of t.do) applyReward(w, tribe, r, x, y);
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
  }

  save(): LevelSaved {
    return { done: this.done.slice(), fired: this.fired.slice(), outcome: this.outcome, endedAt: this.endedAt };
  }

  load(s: LevelSaved): void {
    this.done = s.done.slice();
    this.fired = s.fired.slice();
    this.outcome = s.outcome;
    this.endedAt = s.endedAt;
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

/**
 * Build a level world: the painted map, per-level spell unlocks (plus the campaign carry for the
 * player), setup, and AI controllers for tribes 1+ from `makeAi` (packages/ai OpponentAI).
 */
export function createLevelWorld(init: LevelInit, pack: PackFiles, packHash: string, makeAi?: BotFactory): World {
  const def = init.def;
  const w = new World({ pack, packHash, seed: def.seed, map: levelMap(def), populate: false, level: init });
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
    w.controllers.push(makeAi({ type: "opponent", tribe: k, personality: t.ai, difficulty: t.difficulty ?? "normal", offset: k - 1 }));
  });
  return w;
}

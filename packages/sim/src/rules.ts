// BACKLOG 13 (ADR-014): skirmish victory rules in the sim. A skirmish world names a variant from
// balance.victory (WorldInit.rules); RulesRuntime decides the winner in step 9, so the outcome is
// hashed, snapshotted and replayable like a campaign level's. The last tribe standing wins under every
// variant. holdSites and kingOfHill read presence at the skirmish Reliquaries (their ground is kept
// even after a Reliquary sinks); lastStand ends on a timer and the most followers win.
import type { PackFiles } from "@hearthfall/data";
import { CAT } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

export type VictoryDef = NonNullable<PackFiles["balance"]["victory"]>["variants"][number];

export interface RulesSaved {
  held: number[];
  winner: number;
  endedAt: number;
  why: string;
  spots: { x: number; y: number }[] | null;
}

export class RulesRuntime {
  readonly def: VictoryDef;
  /** per tribe, in ticks: holdSites the current run holding every site, kingOfHill the total on top */
  held: number[];
  /** winning tribe (-1 while the match runs) */
  winner = -1;
  /** tick the match was decided (-1 none) */
  endedAt = -1;
  /** how it was won: conquest, holdSites, kingOfHill or lastStand */
  why = "";
  /** site ground, taken from the worship sites on the first update (null before) */
  spots: { x: number; y: number }[] | null = null;
  private w: World;

  constructor(w: World, id: string) {
    const v = w.cfg.pack.balance.victory?.variants.find((x) => x.id === id);
    if (!v) throw new Error(`unknown victory rules ${id}`);
    this.w = w;
    this.def = v;
    this.held = w.tribes.map(() => 0);
  }

  /** ticks a tribe needs (holdSites, kingOfHill) or the tick the match ends (lastStand); 0 for conquest */
  goalTicks(): number {
    const hz = this.w.cfg.tickHz;
    const d = this.def;
    if (d.type === "holdSites" || d.type === "kingOfHill") return Math.round(d.seconds * hz);
    if (d.type === "lastStand") return Math.round(d.minutes * 60 * hz);
    return 0;
  }

  /** the sites this variant counts: every site for holdSites, the first for kingOfHill */
  counted(): { x: number; y: number }[] {
    const s = this.spots ?? [];
    return this.def.type === "kingOfHill" ? s.slice(0, 1) : this.def.type === "holdSites" ? s : [];
  }

  /** people of each tribe within controlRadius of (x, y), not inside a building */
  presence(x: number, y: number): number[] {
    const w = this.w;
    const E = w.ents;
    const n = w.terrain.size;
    const r = w.cfg.pack.balance.victory!.controlRadius;
    const out = w.tribes.map(() => 0);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] < 0 || E.inside[i] >= 0 || w.vehicles.isVehicle(i)) continue;
      const dx = wrapDelta(E.x[i] - x, n);
      const dy = wrapDelta(E.y[i] - y, n);
      if (dx * dx + dy * dy <= r * r) out[E.tribe[i]]++;
    }
    return out;
  }

  /** Step 9, after the level: conquest, then the variant (presence is read once a second). */
  update(): void {
    if (this.winner >= 0) return;
    const w = this.w;
    if (!this.spots) {
      this.spots = w.worship.sites.map((s) => {
        const i = w.ents.index(s.ent);
        return { x: w.ents.x[i], y: w.ents.y[i] };
      });
    }
    const alive = w.tribes.filter((t) => t.alive);
    if (w.tribes.length > 1 && alive.length === 1) return this.finish(alive[0].index, "conquest");
    if (!alive.length) return;
    const d = this.def;
    const hz = w.cfg.tickHz;
    if (d.type === "lastStand") {
      if (w.tick + 1 < this.goalTicks()) return;
      let best = alive[0].index;
      for (const t of alive) if (w.economy.followers(t.index) > w.economy.followers(best)) best = t.index;
      return this.finish(best, "lastStand");
    }
    const sites = this.counted();
    if (!sites.length || w.tick % hz !== hz - 1) return;
    const counts = sites.map((s) => this.presence(s.x, s.y));
    if (d.type === "holdSites") {
      for (const t of w.tribes) {
        const holds = t.alive && counts.every((c) => c[t.index] > 0 && c.every((k, o) => o === t.index || k === 0));
        this.held[t.index] = holds ? this.held[t.index] + hz : 0;
      }
    } else {
      const c = counts[0];
      let top = -1;
      for (let t = 0; t < c.length; t++) if (w.tribes[t].alive && c[t] > 0 && (top < 0 || c[t] > c[top])) top = t;
      // a tie scores nobody
      if (top >= 0 && c.every((k, o) => o === top || k < c[top])) this.held[top] += hz;
    }
    const goal = this.goalTicks();
    for (let t = 0; t < this.held.length; t++) if (this.held[t] >= goal) return this.finish(t, d.type);
  }

  private finish(tribe: number, why: string): void {
    this.winner = tribe;
    this.endedAt = this.w.tick;
    this.why = why;
    this.w.emit("matchWon", { tribe, why, rules: this.def.id });
  }

  hashInto(f: Fnv): void {
    f.u32(0x7a1e5).u32(this.winner + 1).f64(this.endedAt);
    for (const h of this.held) f.f64(h);
  }

  save(): RulesSaved {
    return { held: this.held.slice(), winner: this.winner, endedAt: this.endedAt, why: this.why, spots: this.spots ? this.spots.map((s) => ({ ...s })) : null };
  }

  load(s: RulesSaved): void {
    this.held = s.held.slice();
    this.winner = s.winner;
    this.endedAt = s.endedAt;
    this.why = s.why;
    this.spots = s.spots ? s.spots.map((p) => ({ ...p })) : null;
  }
}

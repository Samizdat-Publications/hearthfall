// Worship objects (DESIGN 10, M9, system order step 9). A site is a CAT.worship entity plus a record
// here: followers ordered to worship walk to a ring around it and pray; at full count a prayer takes
// prayerSeconds, each missing worshipper multiplies the speed by missingWorshipperSpeedFactor, and
// progress decays while a tribe has nobody praying. The first tribe to finish gets the site's rewards
// (the same reward vocabulary level triggers use); a site that runs out of uses sinks or stays spent.
import type { Reward, SiteSpec } from "@hearthfall/data";
import { registerCommand } from "./commands.ts";
import { secondsToTicks } from "./config.ts";
import { cos, sin } from "./dmath.ts";
import { TASK } from "./economy.ts";
import { applyEffects } from "./effects.ts";
import { CAT, NO_ENTITY, type EntityId } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import { wrap, wrapDelta } from "./terrain.ts";
import { ORDER } from "./units.ts";
import type { World } from "./world.ts";

const GOLDEN_ANGLE = 2.399963229728653;

export interface Site {
  ent: EntityId;
  /** index into buildings.worship.kinds */
  kind: number;
  tag: string;
  need: number;
  prayTicks: number;
  usesLeft: number;
  rewards: Reward[];
  /** per tribe, in full-speed ticks */
  progress: number[];
  /** tribe that last completed it (-1 none) */
  lastBy: number;
}

export interface WorshipState {
  sites: Site[];
  /** per tribe: building types granted by unlockBuilding rewards */
  granted: number[][];
}

export class WorshipSystem {
  sites: Site[] = [];
  granted: number[][] = [];

  private w: World;

  constructor(w: World) {
    this.w = w;
  }

  private kinds() {
    return this.w.cfg.pack.buildings.worship.kinds ?? [];
  }

  kindIndex(id: string): number {
    return this.kinds().findIndex((k) => k.id === id);
  }

  radius(): number {
    return this.w.cfg.pack.buildings.worship.radius ?? 3;
  }

  /** Place a worship object of kind `kindId` at (x, y). */
  addSite(kindId: string, x: number, y: number, spec: SiteSpec): EntityId {
    const w = this.w;
    const k = this.kindIndex(kindId);
    if (k < 0) throw new Error(`unknown worship kind ${kindId}`);
    const kind = this.kinds()[k];
    const ws = w.cfg.pack.buildings.worship;
    const n = w.terrain.size;
    const id = w.ents.alloc(CAT.worship, k, -1, wrap(x, n), wrap(y, n), 1);
    this.sites.push({
      ent: id,
      kind: k,
      tag: spec.tag ?? `${kindId}_${this.sites.length}`,
      need: spec.worshippers ?? kind.worshippers,
      prayTicks: Math.max(1, secondsToTicks(spec.prayerSeconds ?? kind.prayerSeconds ?? ws.shrinePrayerSeconds, w.cfg.tickHz)),
      usesLeft: spec.uses ?? kind.uses,
      rewards: spec.rewards.map((r) => ({ ...r })),
      progress: w.tribes.map(() => 0),
      lastBy: -1,
    });
    return id;
  }

  /** Site record for an entity index, a site entity id, or a tag. */
  find(arg: unknown): Site | undefined {
    if (typeof arg === "string") return this.sites.find((s) => s.tag === arg);
    if (typeof arg !== "number") return undefined;
    const i = this.w.ents.index(arg);
    return i < 0 ? undefined : this.sites.find((s) => this.w.ents.index(s.ent) === i);
  }

  isGranted(tribe: number, type: number): boolean {
    return this.granted[tribe]?.includes(type) ?? false;
  }

  /** Send units to pray at a site: each walks to its own slot on a ring inside the prayer radius. */
  send(units: readonly number[], site: Site): void {
    const w = this.w;
    const E = w.ents;
    const si = E.index(site.ent);
    if (si < 0) return;
    const ring = Math.max(0.8, this.radius() - 1);
    units.forEach((i, k) => {
      if (E.inside[i] >= 0) w.combat.leave(i);
      w.combat.clear(i);
      E.task[i] = TASK.toWorship;
      E.target[i] = site.ent;
      const a = k * GOLDEN_ANGLE;
      w.units.order([i], wrap(E.x[si] + cos(a) * ring, w.terrain.size), wrap(E.y[si] + sin(a) * ring, w.terrain.size), ORDER.move);
    });
  }

  private dist2(i: number, si: number): number {
    const E = this.w.ents;
    const n = this.w.terrain.size;
    const dx = wrapDelta(E.x[i] - E.x[si], n);
    const dy = wrapDelta(E.y[i] - E.y[si], n);
    return dx * dx + dy * dy;
  }

  /** Step 9: arrivals, prayer counts, progress, completion and rewards. */
  update(): void {
    if (!this.sites.length) return;
    const w = this.w;
    const E = w.ents;
    const ws = w.cfg.pack.buildings.worship;
    const r = this.radius();
    const r2 = r * r;
    const T = w.tribes.length;
    // counts[site][tribe] and Shaper presence
    const counts = this.sites.map(() => new Array<number>(T).fill(0));
    const shapers = this.sites.map(() => new Array<boolean>(T).fill(false));
    const siteOf = new Map<number, number>();
    this.sites.forEach((s, k) => {
      const si = E.index(s.ent);
      if (si >= 0) siteOf.set(si, k);
    });
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      const task = E.task[i];
      if (task !== TASK.toWorship && task !== TASK.worship) continue;
      const si = E.index(E.target[i]);
      const k = si < 0 ? undefined : siteOf.get(si);
      if (k === undefined || this.sites[k].usesLeft <= 0) {
        E.task[i] = TASK.idle;
        E.target[i] = NO_ENTITY;
        continue;
      }
      const d2 = this.dist2(i, si);
      if (task === TASK.toWorship) {
        if (E.order[i] !== ORDER.none) continue;
        if (d2 > r2) {
          // arrived but could not get close enough (water, cliffs)
          E.task[i] = TASK.idle;
          E.target[i] = NO_ENTITY;
          w.emit("worshipFailed", { tribe: E.tribe[i], site: this.sites[k].tag });
          continue;
        }
        E.task[i] = TASK.worship;
      }
      if (d2 > r2 || E.order[i] !== ORDER.none || E.mode[i] !== 0 || E.inside[i] >= 0) continue;
      const t = E.tribe[i];
      if (t < 0 || t >= T) continue;
      counts[k][t]++;
      if (E.type[i] === w.economy.typeShaper) shapers[k][t] = true;
    }
    const factor = ws.missingWorshipperSpeedFactor;
    const decay = ((ws.decayPerSecond ?? 0) / w.cfg.tickHz);
    this.sites.forEach((s, k) => {
      if (s.usesLeft <= 0 || E.index(s.ent) < 0) return;
      const shaperOnly = this.kinds()[s.kind].shaperOnly === true;
      let winner = -1;
      for (let t = 0; t < T; t++) {
        const c = shaperOnly ? (shapers[k][t] ? s.need : 0) : counts[k][t];
        if (c <= 0) {
          s.progress[t] = Math.max(0, s.progress[t] - decay * s.prayTicks);
          continue;
        }
        let speed = 1;
        for (let m = c; m < s.need; m++) speed *= factor;
        s.progress[t] += speed;
        if (winner < 0 && s.progress[t] >= s.prayTicks) winner = t;
      }
      if (winner >= 0) this.complete(s, winner);
    });
  }

  private complete(s: Site, tribe: number): void {
    const w = this.w;
    const E = w.ents;
    const si = E.index(s.ent);
    const x = E.x[si];
    const y = E.y[si];
    s.usesLeft--;
    s.lastBy = tribe;
    s.progress.fill(0);
    const kind = this.kinds()[s.kind];
    w.emit("worshipComplete", { tribe, site: s.tag, kind: kind.id, x, y, usesLeft: s.usesLeft });
    for (const r of s.rewards) applyReward(w, tribe, r, x, y);
    // everyone praying here (any tribe) stands down
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit) continue;
      if ((E.task[i] === TASK.toWorship || E.task[i] === TASK.worship) && E.index(E.target[i]) === si) {
        E.task[i] = TASK.idle;
        E.target[i] = NO_ENTITY;
      }
    }
    if (s.usesLeft <= 0 && kind.sinks) {
      w.emit("siteSank", { site: s.tag, x, y });
      w.kill(si, "sank");
    }
  }

  // ---------------------------------------------------------------- hash and snapshot
  /** Adds nothing when the map has no sites, so pre-M9 replay hashes are unchanged. */
  hashInto(f: Fnv): void {
    if (!this.sites.length && !this.granted.some((g) => g.length)) return;
    f.u32(0x5717e5).u32(this.sites.length);
    for (const s of this.sites) {
      f.u32(s.ent).u32(s.kind).u32(s.need).u32(s.prayTicks).u32(s.usesLeft).u32(s.lastBy + 1);
      for (const p of s.progress) f.f64(p);
    }
    this.granted.forEach((g, t) => {
      f.u32(t).u32(g.length);
      for (const b of g) f.u32(b);
    });
  }

  save(): WorshipState {
    return { sites: this.sites.map((s) => ({ ...s, rewards: s.rewards.map((r) => ({ ...r })), progress: s.progress.slice() })), granted: this.granted.map((g) => g.slice()) };
  }

  load(st: WorshipState): void {
    this.sites = st.sites.map((s) => ({ ...s, rewards: s.rewards.map((r) => ({ ...r })), progress: s.progress.slice() }));
    this.granted = st.granted.map((g) => g.slice());
  }
}

/** Give one reward to `tribe` at (x, y) (a site, or a level trigger's anchor). */
export function applyReward(w: World, tribe: number, r: Reward, x: number, y: number): void {
  const t = w.tribes[tribe];
  switch (r.type) {
    case "charges": {
      const s = w.cfg.spellIndex.get(r.spell);
      if (s === undefined || !t) return;
      t.eco.charges[s] = Math.min(w.cfg.pack.spells.spells[s].maxCharges, t.eco.charges[s] + r.n);
      w.emit("rewardCharges", { tribe, spell: r.spell, n: r.n });
      return;
    }
    case "unlockSpell": {
      const s = w.cfg.spellIndex.get(r.spell);
      if (s === undefined || !t) return;
      t.eco.unlocked[s] = 1;
      if (w.cfg.pack.balance.economy.defaultAutoCharge.includes(r.spell)) t.eco.auto[s] = 1;
      w.emit("spellUnlocked", { tribe, spell: r.spell });
      return;
    }
    case "unlockBuilding": {
      const b = w.cfg.buildingIndex.get(r.building);
      if (b === undefined || !t) return;
      while (w.worship.granted.length <= tribe) w.worship.granted.push([]);
      if (!w.worship.granted[tribe].includes(b)) w.worship.granted[tribe].push(b);
      w.emit("buildingUnlocked", { tribe, building: r.building });
      return;
    }
    case "spell": {
      const s = w.cfg.spellIndex.get(r.spell);
      if (s === undefined) return;
      // cast from the site toward `at` (a totem raising a bridge), or on the site itself
      const [px, py] = r.at ?? [x, y];
      applyEffects({ w, tribe, spell: r.spell, x: px, y: py, casterX: x, casterY: y }, w.cfg.pack.spells.spells[s].effects);
      w.emit("spellCast", { tribe, spell: r.spell, x: px, y: py, cx: x, cy: y, by: "site" });
      return;
    }
    case "spawn": {
      const owner = r.tribe ?? tribe;
      const [bx, by] = r.at ?? [x, y];
      const n = w.terrain.size;
      for (let k = 0; k < r.n; k++) {
        const rr = 1.2 + 0.7 * Math.sqrt(k + 0.5);
        w.spawnUnit(r.unit, owner, wrap(bx + cos(k * GOLDEN_ANGLE) * rr, n), wrap(by + sin(k * GOLDEN_ANGLE) * rr, n));
      }
      w.emit("rewardSpawn", { tribe: owner, unit: r.unit, n: r.n });
      return;
    }
    case "message":
      w.emit("levelMessage", { tribe, text: r.text });
      return;
  }
}

/** Order units to worship: args {units, site: entity id or site tag}. */
registerCommand("worship", {
  validate(w, c) {
    const idx = w.selectUnits(c.args.units);
    if (!idx.length) return "no units selected";
    if (c.tribe !== -1 && idx.some((i) => w.ents.tribe[i] !== c.tribe)) return "units belong to another tribe";
    const s = w.worship.find(c.args.site);
    if (!s || w.ents.index(s.ent) < 0) return "no such worship site";
    if (s.usesLeft <= 0) return "this site has nothing left to give";
    return null;
  },
  apply(w, c) {
    const s = w.worship.find(c.args.site)!;
    for (const t of w.tribes) if (t.pending && w.selectUnits(c.args.units).includes(w.ents.index(t.shaper))) t.pending = null;
    w.worship.send(w.selectUnits(c.args.units), s);
  },
});

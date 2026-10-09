// Opponent AI (M7): utility scoring over the considerations a personality declares in
// ai_personalities.json (economy target, army mix, aggression, first attack minute, spell
// preferences, scouting, tower affinity). Every decision it scores a fixed list of actions, adds
// difficulty noise from the world's "ai" rng stream, and runs the best ones (score >= 0.5, at most
// three) through ordinary Commands. Dwelling upkeep is delegated to the EconomyBot. Deterministic:
// entity index order, arrays only, the ai rng stream for noise and picks.
import { BSTATE, CAT, NO_ENTITY, TASK, wrapDelta, type Command, type Controller, type World } from "@hearthfall/sim";
import { EconomyBot } from "./economyBot.ts";

export interface Personality {
  id: string;
  economyTargetPop: number;
  armyMix: Record<string, number>;
  aggression: number;
  firstAttackMinute: number;
  spellPrefs: string[];
  scouting: number;
  towerAffinity: number;
}

export interface OpponentState {
  known: number[];
  scout: number;
  stats: OpponentStats;
}

export interface OpponentOptions {
  tribe: number;
  /** personality id from ai_personalities.json, or an inline personality (test bots) */
  personality: string | Personality;
  difficulty?: string;
  /** decision period in ticks; default is the difficulty's reactionSeconds from data */
  every?: number;
  /** decision phase within the period (spreads tribes over ticks) */
  offset?: number;
}

/** What the controller did, for soak logs and tests (lives outside the sim, never hashed). */
export interface OpponentStats {
  decisions: number;
  actions: Record<string, number>;
  casts: Record<string, number>;
  waves: number;
  /** waves with at least two troop types */
  mixedWaves: number;
  bridges: number;
  scoutedAtTick: number;
}

interface Census {
  w: World;
  h: number;
  si: number;
  minute: number;
  pop: number;
  settlers: number[];
  troops: Map<string, number>;
  idle: number[];
  lodges: Map<string, number[]>;
  towers: number[];
  open: number;
  /** enemy units near the Hearth (defense) */
  threats: number[];
  /** enemy Hearths: [tribe, index], nearest first */
  enemies: [number, number][];
}

type Action = { id: string; score: (c: Census) => number; act: (c: Census, out: Command[]) => void };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class OpponentAI implements Controller {
  readonly tribe: number;
  /** World calls the controller every tick; it decides only when tick % period === phase */
  readonly every = 1;
  readonly offset = 0;
  readonly stats: OpponentStats = { decisions: 0, actions: {}, casts: {}, waves: 0, mixedWaves: 0, bridges: 0, scoutedAtTick: -1 };
  private readonly spec: string | Personality;
  readonly difficulty: string;
  private readonly phase: number;
  private readonly periodOverride: number | undefined;
  private periodTicks = 0;
  private p!: Personality;
  private noise = 0;
  private eco: EconomyBot;
  private ready = false;
  private known = new Set<number>();
  /** set once a wave found no walkable route: bridge spells join the prefs even if the personality lacks them */
  private needBridge = false;
  private scout = NO_ENTITY;
  private readonly actions: Action[];

  constructor(o: OpponentOptions) {
    this.tribe = o.tribe;
    this.spec = o.personality;
    this.difficulty = o.difficulty ?? "normal";
    this.phase = o.offset ?? 0;
    this.periodOverride = o.every;
    // the EconomyBot is called directly at our cadence, so its own every/offset are unused
    this.eco = new EconomyBot({ tribe: o.tribe });
    this.actions = [
      { id: "protectShaper", score: (c) => this.protectScore(c), act: (c, out) => this.protect(c, out) },
      { id: "defend", score: (c) => (c.threats.length ? 0.9 : 0), act: (c, out) => this.defend(c, out) },
      { id: "scout", score: (c) => this.scoutScore(c), act: (c, out) => this.sendScout(c, out) },
      { id: "buildLodge", score: (c) => this.lodgeScore(c), act: (c, out) => this.buildLodge(c, out) },
      { id: "buildTower", score: (c) => this.towerScore(c), act: (c, out) => this.build(c, out, "watchtower") },
      { id: "garrison", score: (c) => this.garrisonScore(c), act: (c, out) => this.garrison(c, out) },
      { id: "train", score: (c) => this.trainScore(c), act: (c, out) => this.train(c, out) },
      { id: "attack", score: (c) => this.attackScore(c), act: (c, out) => this.attack(c, out) },
      { id: "cast", score: (c) => this.castScore(c), act: (c, out) => this.cast(c, out) },
      // M9: only scored on maps with worship sites, so worlds without them draw the same noise as before
      { id: "worship", score: (c) => this.worshipScore(c), act: (c, out) => this.worship(c, out) },
    ];
  }

  /** Save game memory: scouted tribes, the scout and the stats (decisions also gate the one-time setup). */
  saveState(): OpponentState {
    const st = this.stats;
    return { known: [...this.known], scout: this.scout, stats: { ...st, actions: { ...st.actions }, casts: { ...st.casts } } };
  }

  loadState(state: unknown): void {
    const o = state as OpponentState;
    this.known = new Set(o.known);
    this.scout = o.scout;
    Object.assign(this.stats, { ...o.stats, actions: { ...o.stats.actions }, casts: { ...o.stats.casts } });
  }

  get personality(): Personality {
    return this.p;
  }

  /** decision period in ticks (resolved from data on the first call; 0 before) */
  get period(): number {
    return this.periodTicks;
  }

  private init(w: World): void {
    const ai = w.cfg.pack.ai;
    if (typeof this.spec === "string") {
      const found = ai.personalities.find((x) => x.id === this.spec);
      if (!found) throw new Error(`unknown personality ${this.spec}`);
      this.p = found;
    } else this.p = this.spec;
    const d = ai.difficulties.find((x) => x.id === this.difficulty);
    if (!d) throw new Error(`unknown difficulty ${this.difficulty}`);
    this.noise = d.decisionNoise;
    this.periodTicks = this.periodOverride ?? Math.max(1, Math.round(d.reactionSeconds * w.cfg.tickHz));
    if (this.phase >= this.periodTicks) throw new Error("offset must be below the decision period");
    this.ready = true;
  }

  decide(w: World): Command[] {
    if (!this.ready) this.init(w);
    if (w.tick % this.periodTicks !== this.phase) return [];
    const tr = w.tribes[this.tribe];
    if (!tr?.alive) return [];
    const c = this.census(w);
    if (!c) return [];
    const out = this.eco.decide(w);
    this.stats.decisions++;
    // every decision: spells unlocked mid-match (worship sites) start charging too
    this.setup(w, out);
    const acts = w.worship.sites.length ? this.actions : this.actions.filter((a) => a.id !== "worship");
    const scored = acts.map((a, k) => ({ a, k, s: a.score(c) + (w.rng.float("ai") - 0.5) * 2 * this.noise }));
    scored.sort((x, y) => y.s - x.s || x.k - y.k);
    let ran = 0;
    for (const { a, s } of scored) {
      if (s < 0.5 || ran >= 3) break;
      const before = out.length;
      a.act(c, out);
      if (out.length > before) {
        ran++;
        this.stats.actions[a.id] = (this.stats.actions[a.id] ?? 0) + 1;
      }
    }
    return out.map((x) => ({ ...x, tick: w.tick, tribe: this.tribe }));
  }

  /** auto-charge the preferred spells the tribe has unlocked (once each: only when not yet on) */
  private setup(w: World, out: Command[]): void {
    const eco = w.tribes[this.tribe].eco;
    for (const id of this.spellPrefs(w)) {
      const s = w.cfg.spellIndex.get(id);
      if (s !== undefined && eco.unlocked[s] && !eco.auto[s]) out.push(this.cmd(w, "setAutoCharge", { spell: id, on: true }));
    }
  }

  /** the personality's spell prefs, plus any bridge spell once the enemy is out of reach on foot (BACKLOG 7,
   * ai-idle seed 1003: a Shaper thrown onto another landmass outlived a personality that never bridges) */
  private spellPrefs(w: World): string[] {
    if (!this.needBridge) return this.p.spellPrefs;
    const extra = w.cfg.pack.spells.spells.filter((s) => s.aiTarget === "bridge" && !this.p.spellPrefs.includes(s.id)).map((s) => s.id);
    return [...this.p.spellPrefs, ...extra];
  }

  private cmd(w: World, type: string, args: Record<string, unknown>): Command {
    return { tick: w.tick, tribe: this.tribe, type, args };
  }

  private census(w: World): Census | null {
    const E = w.ents;
    const tr = w.tribes[this.tribe];
    const h = E.index(tr.hearth);
    if (h < 0) return null;
    const units = w.cfg.pack.units.units;
    const bdefs = w.cfg.pack.buildings.buildings;
    const n = w.terrain.size;
    const c: Census = { w, h, si: E.index(tr.shaper), minute: w.tick / (60 * w.cfg.tickHz), pop: w.economy.followers(this.tribe), settlers: [], troops: new Map(), idle: [], lodges: new Map(), towers: [], open: 0, threats: [], enemies: [] };
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.tribe[i] === this.tribe) {
        if (E.cat[i] === CAT.building) {
          if (E.state[i] !== BSTATE.done) c.open++;
          const id = bdefs[E.type[i]].id;
          if (bdefs[E.type[i]].trains) c.lodges.set(id, [...(c.lodges.get(id) ?? []), i]);
          if (w.combat.garrisonOf(E.type[i]) > 0) c.towers.push(i);
        } else if (E.cat[i] === CAT.unit) {
          const def = units[E.type[i]];
          if (E.type[i] === w.economy.typeSettler) c.settlers.push(i);
          else if (def.trainedAt) {
            c.troops.set(def.id, (c.troops.get(def.id) ?? 0) + 1);
            if (E.inside[i] < 0 && E.mode[i] === 0 && E.order[i] === 0 && E.atk[i] === NO_ENTITY && i !== E.index(this.scout)) c.idle.push(i);
          }
        }
      } else if (E.tribe[i] >= 0 && E.cat[i] === CAT.unit && E.veil[i] === 0 && w.tribes[E.tribe[i]]?.alive) {
        // veiled enemies are invisible to the AI as they are to a player (no map hacks)
        const def = units[E.type[i]];
        if (!def.trainedAt && !def.isCaster) continue;
        const dx = wrapDelta(E.x[i] - E.x[h], n);
        const dy = wrapDelta(E.y[i] - E.y[h], n);
        if (dx * dx + dy * dy < 14 * 14) c.threats.push(i);
      }
    }
    const ds: [number, number, number][] = [];
    for (const t of w.tribes) {
      if (t.index === this.tribe || !t.alive) continue;
      let eh = E.index(t.hearth);
      if (eh < 0) {
        // the Hearth fell but the tribe lives on while its Shaper does: hunt her (BACKLOG 7, ai-idle
        // seed 1000: a Shaper that slipped the first wave kept an idle tribe alive for the whole match)
        const s = E.index(t.shaper);
        if (s < 0 || E.veil[s] !== 0) continue;
        eh = s;
        this.known.add(t.index);
      }
      const dx = wrapDelta(E.x[eh] - E.x[h], n);
      const dy = wrapDelta(E.y[eh] - E.y[h], n);
      ds.push([dx * dx + dy * dy, t.index, eh]);
      // scouting: an own unit near an enemy Hearth reveals it for good
      if (!this.known.has(t.index) && this.near(w, E.x[eh], E.y[eh], 14)) {
        this.known.add(t.index);
        if (this.stats.scoutedAtTick < 0) this.stats.scoutedAtTick = w.tick;
      }
    }
    ds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    c.enemies = ds.map(([, t, eh]) => [t, eh]);
    return c;
  }

  /** is any own unit within r cells of (x, y)? */
  private near(w: World, x: number, y: number, r: number): boolean {
    const E = w.ents;
    const n = w.terrain.size;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== this.tribe) continue;
      const dx = wrapDelta(E.x[i] - x, n);
      const dy = wrapDelta(E.y[i] - y, n);
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /** walkable component near (x, y): snapped like orders by default, r 1 to test the cell itself */
  private comp(w: World, x: number, y: number, r = w.cfg.pack.balance.movement.snapRadius): number {
    const n = w.terrain.size;
    const v = w.units.pf.nearestWalkable((((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n, r);
    return v < 0 ? -1 : w.units.pf.comp[v];
  }

  // ------------------------------------------------------------------ considerations and actions

  private keep(): number {
    return Math.max(8, Math.round(this.p.economyTargetPop * 0.35));
  }

  /** settlers kept out of training: the economy floor, or a bare 6 while enemies are at the Hearth */
  private floor(c: Census): number {
    return c.threats.length ? Math.min(6, this.keep()) : this.keep();
  }

  private protectScore(c: Census): number {
    if (c.si < 0) return 0;
    const E = c.w.ents;
    const hpFrac = E.hp[c.si] / Math.max(1, c.w.cfg.pack.units.units[E.type[c.si]].hp);
    if (hpFrac < 0.45) return 1;
    return this.enemiesNear(c.w, E.x[c.si], E.y[c.si], 5) >= 3 ? 0.95 : 0;
  }

  private enemiesNear(w: World, x: number, y: number, r: number): number {
    const E = w.ents;
    const n = w.terrain.size;
    let k = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] < 0 || E.tribe[i] === this.tribe || E.veil[i] > 0) continue;
      if (!w.cfg.pack.units.units[E.type[i]].trainedAt) continue;
      const dx = wrapDelta(E.x[i] - x, n);
      const dy = wrapDelta(E.y[i] - y, n);
      if (dx * dx + dy * dy <= r * r) k++;
    }
    return k;
  }

  /** Shaper protection: pull her home and send idle troops to cover her */
  private protect(c: Census, out: Command[]): void {
    const E = c.w.ents;
    const [dx, dy] = c.w.economy.doorOf(c.h);
    const n = c.w.terrain.size;
    const far = Math.abs(wrapDelta(E.x[c.si] - dx, n)) + Math.abs(wrapDelta(E.y[c.si] - dy, n)) > 3;
    if (far) {
      if (c.w.tribes[this.tribe].pending) out.push(this.cmd(c.w, "cancelCast", {}));
      out.push(this.cmd(c.w, "move", { units: [E.idOf(c.si)], to: [dx, dy] }));
    }
    const guards = c.idle.slice(0, 6);
    if (guards.length) out.push(this.cmd(c.w, "move", { units: guards.map((i) => E.idOf(i)), to: [E.x[c.si], E.y[c.si]], attack: true }));
  }

  private defend(c: Census, out: Command[]): void {
    const E = c.w.ents;
    const n = c.w.terrain.size;
    const t = c.threats[0];
    // every troop not already fighting answers, towers fill up
    const ids: number[] = [];
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== this.tribe || E.inside[i] >= 0) continue;
      if (!c.w.cfg.pack.units.units[E.type[i]].trainedAt || E.atk[i] !== NO_ENTITY) continue;
      const dx = wrapDelta(E.x[i] - E.x[c.h], n);
      const dy = wrapDelta(E.y[i] - E.y[c.h], n);
      if (dx * dx + dy * dy < 30 * 30) ids.push(E.idOf(i));
    }
    if (ids.length) out.push(this.cmd(c.w, "move", { units: ids, to: [E.x[t], E.y[t]], attack: true }));
  }

  /** nearest reachable worship site still giving, with how many own units already pray there */
  private worshipTarget(c: Census): { tag: string; si: number; need: number; have: number } | null {
    const w = c.w;
    const E = w.ents;
    const n = w.terrain.size;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    const kinds = w.cfg.pack.buildings.worship.kinds ?? [];
    let best: { tag: string; si: number; need: number; have: number } | null = null;
    let bd = Infinity;
    for (const s of w.worship.sites) {
      const si = E.index(s.ent);
      // totems are level scripting for the player's Shaper
      if (si < 0 || s.usesLeft <= 0 || kinds[s.kind]?.shaperOnly) continue;
      if (this.comp(w, E.x[si], E.y[si]) !== home) continue;
      let have = 0;
      for (const i of c.settlers) if ((E.task[i] === TASK.toWorship || E.task[i] === TASK.worship) && E.index(E.target[i]) === si) have++;
      if (have >= s.need) continue;
      const dx = wrapDelta(E.x[si] - E.x[c.h], n);
      const dy = wrapDelta(E.y[si] - E.y[c.h], n);
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = { tag: s.tag, si, need: s.need, have };
      }
    }
    return best;
  }

  private worshipScore(c: Census): number {
    if (c.threats.length) return 0;
    const t = this.worshipTarget(c);
    // keep a working economy at home
    return t && c.settlers.length >= t.need - t.have + 4 ? 0.75 : 0;
  }

  private worship(c: Census, out: Command[]): void {
    const t = this.worshipTarget(c);
    if (!t) return;
    const E = c.w.ents;
    const n = c.w.terrain.size;
    const free = c.settlers
      .filter((i) => E.task[i] !== TASK.toWorship && E.task[i] !== TASK.worship && E.inside[i] < 0)
      .map((i) => {
        const dx = wrapDelta(E.x[i] - E.x[t.si], n);
        const dy = wrapDelta(E.y[i] - E.y[t.si], n);
        return [dx * dx + dy * dy, i] as const;
      })
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, t.need - t.have)
      .map(([, i]) => E.idOf(i));
    if (free.length) out.push(this.cmd(c.w, "worship", { units: free, site: t.tag }));
  }

  private scoutScore(c: Census): number {
    if (!c.enemies.length || c.enemies.every(([t]) => this.known.has(t))) return 0;
    if (c.w.ents.index(this.scout) >= 0) return 0;
    // keen scouts go early (minute 1 at scouting 1, minute 8 at scouting 0)
    return c.minute >= 1 + (1 - this.p.scouting) * 7 ? 0.5 + this.p.scouting * 0.4 : 0;
  }

  private sendScout(c: Census, out: Command[]): void {
    const E = c.w.ents;
    const target = c.enemies.find(([t]) => !this.known.has(t));
    if (!target) return;
    // a troop if one is idle, else a settler (the cheapest pair of eyes)
    const pick = c.idle[0] ?? c.settlers[c.settlers.length - 1];
    if (pick === undefined || c.settlers.length < 6) return;
    this.scout = E.idOf(pick);
    out.push(this.cmd(c.w, "move", { units: [this.scout], to: [E.x[target[1]], E.y[target[1]]] }));
  }

  private missingLodge(c: Census): string | null {
    const w = c.w;
    const mix = Object.entries(this.p.armyMix).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [unit, weight] of mix) {
      if (weight <= 0) continue;
      const ui = w.cfg.unitIndex.get(unit);
      const lodge = ui === undefined ? undefined : w.cfg.pack.units.units[ui].trainedAt;
      if (!lodge || c.lodges.has(lodge)) continue;
      const bt = w.cfg.buildingIndex.get(lodge);
      if (bt === undefined || w.economy.buildingLock(this.tribe, bt)) continue;
      return lodge;
    }
    return null;
  }

  private lodgeScore(c: Census): number {
    if (c.open >= c.w.cfg.pack.balance.economy.maxOpenPlansPerTribe || c.settlers.length < this.keep() * 0.6) return 0;
    const l = this.missingLodge(c);
    if (!l) return 0;
    const unit = c.w.cfg.pack.units.units.find((u) => u.trainedAt === l)!;
    return 0.45 + 0.45 * (this.p.armyMix[unit.id] ?? 0) + 0.1 * this.p.aggression;
  }

  private buildLodge(c: Census, out: Command[]): void {
    const l = this.missingLodge(c);
    if (l) this.build(c, out, l);
  }

  private towerScore(c: Census): number {
    if (c.open >= c.w.cfg.pack.balance.economy.maxOpenPlansPerTribe || c.settlers.length < this.keep() * 0.5) return 0;
    if (c.w.economy.buildingLock(this.tribe, c.w.cfg.buildingIndex.get("watchtower")!)) return 0;
    const want = Math.round(this.p.towerAffinity * 3);
    return c.towers.length < want ? 0.3 + 0.6 * this.p.towerAffinity : 0;
  }

  private build(c: Census, out: Command[], building: string): void {
    const E = c.w.ents;
    const spot = this.eco.findSpot(c.w, building, E.x[c.h], E.y[c.h]);
    if (spot) out.push(this.cmd(c.w, "placePlan", { building, at: spot }));
  }

  /** finished own towers with a free slot, nearest the Hearth first */
  private openTowers(c: Census): number[] {
    const E = c.w.ents;
    return c.towers.filter((b) => E.state[b] === BSTATE.done && E.occupants[b] < this.manned(c, b));
  }

  /** one sentinel per tower in peace, a full garrison while enemies are at the Hearth */
  private manned(c: Census, b: number): number {
    return c.threats.length ? c.w.combat.garrisonOf(c.w.ents.type[b]) : 1;
  }

  private garrisonScore(c: Census): number {
    if (this.p.towerAffinity < 0.3 || !c.idle.length || !this.openTowers(c).length) return 0;
    return 0.3 + 0.5 * this.p.towerAffinity + (c.threats.length ? 0.2 : 0);
  }

  /** tower minded personalities man their towers before anything marches out */
  private garrison(c: Census, out: Command[]): void {
    const E = c.w.ents;
    for (const b of this.openTowers(c)) {
      const room = this.manned(c, b) - E.occupants[b];
      const units = c.idle.splice(0, room);
      if (!units.length) break;
      out.push(this.cmd(c.w, "garrison", { units: units.map((i) => E.idOf(i)), building: E.idOf(b) }));
    }
  }

  private trainScore(c: Census): number {
    if (!c.lodges.size || c.settlers.length <= this.floor(c)) return 0;
    if (c.threats.length) return 0.85;
    const growth = clamp01(c.pop / this.p.economyTargetPop);
    return 0.25 + 0.55 * growth + 0.25 * this.p.aggression;
  }

  private train(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const queued = w.combat.queued();
    let spare = Math.min(4, c.settlers.length - this.floor(c));
    const total = Object.values(this.p.armyMix).reduce((a, b) => a + b, 0) || 1;
    const army = [...c.troops.values()].reduce((a, b) => a + b, 0) + 1;
    // largest deficit against the mix first
    const order = Object.entries(this.p.armyMix)
      .filter(([, k]) => k > 0)
      .map(([u, k]) => [u, k / total - (c.troops.get(u) ?? 0) / army] as [string, number])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [unit] of order) {
      if (spare <= 0) break;
      const ui = w.cfg.unitIndex.get(unit);
      const lodgeId = ui === undefined ? undefined : w.cfg.pack.units.units[ui].trainedAt;
      for (const b of lodgeId ? (c.lodges.get(lodgeId) ?? []) : []) {
        if (E.state[b] !== BSTATE.done) continue;
        if (E.mode[b] === 0) out.push(this.cmd(w, "setRally", { building: E.idOf(b), at: [E.x[c.h] + 3, E.y[c.h] + 3] }));
        const room = Math.min(2 - (queued.get(b) ?? 0), spare);
        if (room <= 0) continue;
        out.push(this.cmd(w, "train", { building: E.idOf(b), count: room }));
        spare -= room;
        break;
      }
    }
  }

  private waveSize(): number {
    return Math.round(4 + (1 - this.p.aggression) * 10);
  }

  private attackScore(c: Census): number {
    if (c.minute < this.p.firstAttackMinute || !c.enemies.length) return 0;
    const ratio = c.idle.length / this.waveSize();
    if (ratio < 1) return 0;
    // mixed waves: hold a single-type wave while a second lodge is up or still being built (BACKLOG 7:
    // waiting only for a finished one let fast single-type waves end the match first), for up to 3 minutes
    const kinds = new Set(c.idle.map((i) => c.w.ents.type[i])).size;
    const lodgeKinds = [...c.lodges.values()].filter((l) => l.length > 0).length;
    if (kinds < 2 && lodgeKinds >= 2 && c.minute < this.p.firstAttackMinute + 3) return 0;
    return clamp01(0.35 + 0.5 * this.p.aggression + 0.15 * (ratio - 1));
  }

  private attack(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    // known enemies first, then any start site (a wave scouts as it goes)
    const ranked = [...c.enemies.filter(([t]) => this.known.has(t)), ...c.enemies.filter(([t]) => !this.known.has(t))];
    const target = ranked.find(([, eh]) => this.comp(w, E.x[eh], E.y[eh]) === home);
    if (!target) {
      if (E.cat[ranked[0][1]] === CAT.unit) this.approach(c, out, ranked[0][1], home);
      this.bridge(c, out, ranked[0][1]);
      return;
    }
    const eh = target[1];
    out.push(this.cmd(w, "move", { units: c.idle.map((i) => E.idOf(i)), to: [E.x[eh], E.y[eh]], attack: true }));
    this.stats.waves++;
    // a healthy Shaper follows the wave and stops short of the Hearth, so her spells reach the fight
    if (c.si >= 0 && this.protectScore(c) === 0 && !w.tribes[this.tribe].pending) {
      const n = w.terrain.size;
      const dx = wrapDelta(E.x[eh] - E.x[c.h], n);
      const dy = wrapDelta(E.y[eh] - E.y[c.h], n);
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const back = 6 + (1 - this.p.aggression) * 4;
      out.push(this.cmd(w, "move", { units: [E.idOf(c.si)], to: [E.x[eh] - (dx / d) * back, E.y[eh] - (dy / d) * back] }));
    }
    const kinds = new Set(c.idle.map((i) => E.type[i]));
    if (kinds.size >= 2) this.stats.mixedWaves++;
  }

  /** A hunted Shaper out of reach on foot (BACKLOG 7, ai-idle seed 1003: stranded in a one-cell pocket among
   * cliffs): our Shaper walks to the nearest cell of our landmass within 10 of her, so a spell reaches. */
  private approach(c: Census, out: Command[], e: number, home: number): void {
    const w = c.w;
    const E = w.ents;
    if (c.si < 0 || w.tribes[this.tribe].casting || w.tribes[this.tribe].pending || this.protectScore(c) > 0) return;
    const n = w.terrain.size;
    const pf = w.units.pf;
    const ex = Math.round(E.x[e]);
    const ey = Math.round(E.y[e]);
    let best = -1;
    let bestD = 101;
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= bestD) continue;
        const v = ((((ex + dx) % n) + n) % n) + ((((ey + dy) % n) + n) % n) * n;
        if (pf.nearestWalkable(v, 0) !== v || pf.comp[v] !== home) continue;
        best = v;
        bestD = d;
      }
    }
    if (best < 0) return;
    const bx = best % n;
    const by = (best - bx) / n;
    const sx = wrapDelta(bx - E.x[c.si], n);
    const sy = wrapDelta(by - E.y[c.si], n);
    if (sx * sx + sy * sy < 4) return;
    out.push(this.cmd(w, "move", { units: [E.idOf(c.si)], to: [bx, by] }));
  }

  /** terrain attack: no walkable route to the enemy, so the Shaper raises land from the nearest shore toward it */
  private bridge(c: Census, out: Command[], eh: number): void {
    const w = c.w;
    const E = w.ents;
    this.needBridge = true;
    if (c.si < 0 || w.tribes[this.tribe].casting || w.tribes[this.tribe].pending) return;
    const spell = this.chargedSpell(w, "bridge");
    if (!spell) return;
    const n = w.terrain.size;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    const dx = wrapDelta(E.x[eh] - E.x[c.h], n);
    const dy = wrapDelta(E.y[eh] - E.y[c.h], n);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) return;
    // walk the line from home toward the enemy; the last cell on our landmass is the shore
    let sx = E.x[c.h];
    let sy = E.y[c.h];
    for (let k = 1; k < d; k++) {
      const x = E.x[c.h] + (dx * k) / d;
      const y = E.y[c.h] + (dy * k) / d;
      if (this.comp(w, x, y, 1) !== home) break;
      sx = x;
      sy = y;
    }
    // first walk the Shaper to the shore (a cast aimed over water cannot path her there), then
    // raise a ridge from where she stands across the water
    const ux = dx / d;
    const uy = dy / d;
    const fx = wrapDelta(E.x[c.si] - sx, n);
    const fy = wrapDelta(E.y[c.si] - sy, n);
    if (fx * fx + fy * fy > 2.5 * 2.5) {
      out.push(this.cmd(w, "move", { units: [E.idOf(c.si)], to: [sx - ux, sy - uy] }));
      return;
    }
    const s = w.cfg.pack.spells.spells[w.cfg.spellIndex.get(spell)!];
    const reach = Math.min(s.range - 1, 8);
    const tx = E.x[c.si] + ux * reach;
    const ty = E.y[c.si] + uy * reach;
    out.push(this.cmd(w, "cast", { spell, target: [tx, ty] }));
    this.stats.bridges++;
    this.stats.casts[spell] = (this.stats.casts[spell] ?? 0) + 1;
  }

  /** first preferred spell with a charge whose aiTarget matches */
  private chargedSpell(w: World, kind: string): string | null {
    const eco = w.tribes[this.tribe].eco;
    for (const id of this.spellPrefs(w)) {
      const s = w.cfg.spellIndex.get(id);
      if (s === undefined || !eco.unlocked[s] || eco.charges[s] <= 0) continue;
      if (w.cfg.pack.spells.spells[s].aiTarget === kind) return id;
    }
    return null;
  }

  private castScore(c: Census): number {
    const t = c.w.tribes[this.tribe];
    if (c.si < 0 || t.casting || t.pending || this.protectScore(c) > 0) return 0;
    return this.pickCast(c) ? 0.55 + 0.3 * this.p.aggression : 0;
  }

  /** best preferred spell and target within reach of the Shaper (range plus a short walk) */
  private pickCast(c: Census): { spell: string; x: number; y: number } | null {
    const w = c.w;
    const E = w.ents;
    const eco = w.tribes[this.tribe].eco;
    const n = w.terrain.size;
    for (const id of this.p.spellPrefs) {
      const s = w.cfg.spellIndex.get(id);
      if (s === undefined || !eco.unlocked[s] || eco.charges[s] <= 0) continue;
      const def = w.cfg.pack.spells.spells[s];
      const reach = def.range + 10;
      const kind = def.aiTarget ?? "none";
      if (kind === "none" || kind === "bridge") continue;
      const killsCaster = def.effects.some((e) => e.type === "damageRadius" && (e.canKill?.length ?? 0) > 0);
      let best = -1;
      let bestScore = 0;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i]) continue;
        const tribe = E.tribe[i];
        let ok = false;
        if (kind === "ownFighting" || kind === "ownMarching") {
          // own trained troops: Ward on those already fighting, Veil on a wave still on its way
          if (tribe !== this.tribe || E.cat[i] !== CAT.unit || !w.cfg.pack.units.units[E.type[i]].trainedAt) continue;
          ok = kind === "ownFighting" ? E.atk[i] !== NO_ENTITY && E.ward[i] === 0 : E.order[i] !== 0 && E.atk[i] === NO_ENTITY && E.veil[i] === 0;
        } else if (kind === "wild") ok = E.cat[i] === CAT.unit && E.type[i] === w.economy.typeWild;
        else if (tribe >= 0 && tribe !== this.tribe && w.tribes[tribe]?.alive) ok = kind === "buildings" ? E.cat[i] === CAT.building && E.state[i] === BSTATE.done : E.cat[i] === CAT.unit && E.veil[i] === 0;
        if (!ok) continue;
        const dx = wrapDelta(E.x[i] - E.x[c.si], n);
        const dy = wrapDelta(E.y[i] - E.y[c.si], n);
        if (dx * dx + dy * dy > reach * reach) continue;
        // value: units in a cluster (or the building's own worth) near the point
        // a spell that can kill a Shaper values one even alone (BACKLOG 7: the last Shaper of a fallen tribe)
        const score =
          kind === "buildings"
            ? 2 + (w.cfg.pack.buildings.buildings[E.type[i]].id === "hearth" ? 3 : 0)
            : this.clusterAt(w, i, kind === "wild") + (kind === "units" && killsCaster && w.cfg.pack.units.units[E.type[i]].isCaster ? 2 : 0);
        // own-troop spells need a real group (a lone soldier is not worth the charge)
        if ((kind === "ownFighting" || kind === "ownMarching") && score < 3) continue;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const min = kind === "buildings" ? 1 : 2;
      if (best >= 0 && bestScore >= min) return { spell: id, x: E.x[best], y: E.y[best] };
    }
    return null;
  }

  private clusterAt(w: World, i: number, wild: boolean): number {
    const E = w.ents;
    const n = w.terrain.size;
    let k = 0;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.unit || E.veil[j] > 0) continue;
      if (wild ? E.type[j] !== w.economy.typeWild : E.tribe[j] !== E.tribe[i]) continue;
      const dx = wrapDelta(E.x[j] - E.x[i], n);
      const dy = wrapDelta(E.y[j] - E.y[i], n);
      if (dx * dx + dy * dy <= 9) k++;
    }
    return k;
  }

  private cast(c: Census, out: Command[]): void {
    const pick = this.pickCast(c);
    if (!pick) return;
    out.push(this.cmd(c.w, "cast", { spell: pick.spell, target: [pick.x, pick.y] }));
    this.stats.casts[pick.spell] = (this.stats.casts[pick.spell] ?? 0) + 1;
  }
}

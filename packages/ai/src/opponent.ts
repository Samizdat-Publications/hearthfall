// Opponent AI (M7): utility scoring over the considerations a personality declares in
// ai_personalities.json (economy target, army mix, aggression, first attack minute, spell
// preferences, scouting, tower affinity). Every decision it scores a fixed list of actions, adds
// difficulty noise from the world's "ai" rng stream, and runs the best ones (score >= 0.5, at most
// three) through ordinary Commands. Dwelling upkeep is delegated to the EconomyBot. Deterministic:
// entity index order, arrays only, the ai rng stream for noise and picks.
import { BSTATE, CAT, NAV, NO_ENTITY, STANCE, TASK, dmath, wrapDelta, type Command, type Controller, type World } from "@hearthfall/sim";
import { AI_SHARED_DEFAULTS, type AiShared } from "@hearthfall/data";
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
  towerFromPopShare?: number;
  /** BACKLOG 2: keep this many Shades from this match minute on */
  shades?: { count: number; fromMinute: number };
  /** BACKLOG 11: the Forge plan (moat, wall or flatten strokes on a ring around the Hearth) */
  forge?: { plan: "moat" | "wall" | "flatten"; ring: number; strokes: number; perDecision: number };
}

export interface OpponentState {
  known: number[];
  scout: number;
  stats: OpponentStats;
  /** BACKLOG 10: [boat id, tick of its last boarding order] (absent in older saves) */
  ferried?: [number, number][];
  /** BACKLOG 98: [boat id, x, y] of a contested site a loaded boat carries its wave to (absent in older saves) */
  goals?: [number, number, number][];
  /** BACKLOG 67: waves still watched for arrival (absent in older saves) */
  waves?: { ids: number[]; x: number; y: number; until: number }[];
  /** BACKLOG 23: [focused action id, until tick] set by a move picker (absent when none) */
  focus?: [string, number];
}

/**
 * BACKLOG 23 (docs/VISIONQA.md section 7): the macro moves a move picker chooses from, each the OpponentAI
 * action it focuses (hold focuses nothing). The picker never issues unit commands; the AI still decides.
 */
export const PICKER_MOVES: Record<string, string | null> = {
  build_army_lodge: "buildLodge",
  build_defense: "buildTower",
  train_troops: "train",
  raid_enemy: "attack",
  defend_hearth: "defend",
  claim_shrine: "worship",
  contest_site: "contest",
  cast_spells: "cast",
  scout: "scout",
  sabotage: "sabotage",
  hold: null,
};

export interface OpponentOptions {
  tribe: number;
  /** personality id from ai_personalities.json, or an inline personality (test bots) */
  personality: string | Personality;
  difficulty?: string;
  /** decision period in ticks; default is the difficulty's reactionSeconds from data */
  every?: number;
  /** decision phase within the period (spreads tribes over ticks) */
  offset?: number;
  /** BACKLOG 88: no worshippers before this much play time (a level's explicit delay) */
  worshipAfterSeconds?: number;
}

/** What the controller did, for soak logs and tests (lives outside the sim, never hashed). */
export interface OpponentStats {
  decisions: number;
  actions: Record<string, number>;
  /** BACKLOG 2: Shades sent at enemy buildings */
  sabotages?: number;
  casts: Record<string, number>;
  waves: number;
  /** waves with at least two troop types */
  mixedWaves: number;
  bridges: number;
  /** BACKLOG 10: loaded boats sent to unload on an enemy shore */
  ferries: number;
  scoutedAtTick: number;
  /** BACKLOG 67: waves with a member alive within shared.threatRadius of their target within WAVE_WATCH_MINUTES (effects, not intents; absent in older saves) */
  wavesArrived?: number;
}

/** BACKLOG 67: how long a sent wave is watched for arrival (a stats window, not a tuning number) */
const WAVE_WATCH_MINUTES = 5;

interface Census {
  w: World;
  h: number;
  si: number;
  minute: number;
  pop: number;
  settlers: number[];
  troops: Map<string, number>;
  idle: number[];
  /** BACKLOG 2: own Shades (kept out of troops, idle and waves) */
  shades: number[];
  lodges: Map<string, number[]>;
  towers: number[];
  open: number;
  /** enemy units near the Hearth (defense) */
  threats: number[];
  /** enemy Hearths: [tribe, index], nearest first */
  enemies: [number, number][];
  /** BACKLOG 10: own boats, and whether a Boathouse stands or is planned */
  boats: number[];
  boathouse: boolean;
}

type Action = { id: string; score: (c: Census) => number; act: (c: Census, out: Command[]) => void };

/** BACKLOG 10: seconds before the AI boards the same boat again */
const FERRY_BACKOFF_SECONDS = 90;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** BACKLOG 2: actions scored only for personalities with shades, so the others draw the same noise as before */
const SHADE_ACTIONS = new Set(["buildDen", "trainShade", "sabotage"]);

export class OpponentAI implements Controller {
  readonly tribe: number;
  /** World calls the controller every tick; it decides only when tick % period === phase */
  readonly every = 1;
  readonly offset = 0;
  readonly stats: OpponentStats = { decisions: 0, actions: {}, casts: {}, waves: 0, mixedWaves: 0, bridges: 0, ferries: 0, scoutedAtTick: -1 };
  private readonly spec: string | Personality;
  readonly difficulty: string;
  private readonly phase: number;
  private readonly periodOverride: number | undefined;
  private periodTicks = 0;
  private p!: Personality;
  /** BACKLOG 69: the shared AI numbers (ai_personalities.json shared, defaults for older packs) */
  private sh: AiShared = AI_SHARED_DEFAULTS;
  private noise = 0;
  /** BACKLOG 3: difficulty data lets this AI see through fog of war */
  private mapHack = false;
  /** BACKLOG 6: the difficulty's mana income multiplier, applied through the handicap command */
  private resourceMult = 1;
  private eco: EconomyBot;
  private ready = false;
  private known = new Set<number>();
  /** BACKLOG 10: boat id to the tick of its last boarding order (a boat is boarded at most once per FERRY_BACKOFF_SECONDS) */
  private ferried = new Map<number, number>();
  private readonly worshipAfter: number;
  /** BACKLOG 67: sent waves watched until a member reaches the target or the window ends */
  private watched: { ids: number[]; x: number; y: number; until: number }[] = [];
  /** BACKLOG 98: boat id to the contested site its wave was boarded for (sail() lands it there, not at a Hearth) */
  private goals = new Map<number, [number, number]>();
  /** set once a wave found no walkable route: bridge spells join the prefs even if the personality lacks them */
  private needBridge = false;
  private scout = NO_ENTITY;
  private readonly actions: Action[];
  /** BACKLOG 23: action a move picker focuses until focusUntil (a tick) */
  private focus: string | null = null;
  private focusUntil = -1;

  constructor(o: OpponentOptions) {
    this.tribe = o.tribe;
    this.spec = o.personality;
    this.difficulty = o.difficulty ?? "normal";
    this.phase = o.offset ?? 0;
    this.periodOverride = o.every;
    this.worshipAfter = o.worshipAfterSeconds ?? 0;
    // the EconomyBot is called directly at our cadence, so its own every/offset are unused
    this.eco = new EconomyBot({ tribe: o.tribe });
    this.actions = [
      { id: "protectShaper", score: (c) => this.protectScore(c), act: (c, out) => this.protect(c, out) },
      { id: "defend", score: (c) => (c.threats.length ? 0.9 : 0), act: (c, out) => this.defend(c, out) },
      { id: "scout", score: (c) => this.scoutScore(c), act: (c, out) => this.sendScout(c, out) },
      { id: "buildLodge", score: (c) => this.lodgeScore(c), act: (c, out) => this.buildLodge(c, out) },
      { id: "buildTower", score: (c) => this.towerScore(c), act: (c, out) => this.build(c, out, "watchtower") },
      // stretch 3: Spirit Well and Mending Hut once the village stands (scores 0 in packs without them)
      { id: "buildSupport", score: (c) => (this.supportBuilding(c) ? 0.5 : 0), act: (c, out) => this.build(c, out, this.supportBuilding(c)!) },
      { id: "garrison", score: (c) => this.garrisonScore(c), act: (c, out) => this.garrison(c, out) },
      { id: "train", score: (c) => this.trainScore(c), act: (c, out) => this.train(c, out) },
      { id: "attack", score: (c) => this.attackScore(c), act: (c, out) => this.attack(c, out) },
      { id: "cast", score: (c) => this.castScore(c), act: (c, out) => this.cast(c, out) },
      // M9: only scored on maps with worship sites, so worlds without them draw the same noise as before
      { id: "worship", score: (c) => this.worshipScore(c), act: (c, out) => this.worship(c, out) },
      { id: "buildDen", score: (c) => this.denScore(c), act: (c, out) => this.buildDen(c, out) },
      { id: "trainShade", score: (c) => this.trainShadeScore(c), act: (c, out) => this.trainShade(c, out) },
      { id: "sabotage", score: (c) => this.sabotageScore(c), act: (c, out) => this.sabotage(c, out) },
      // BACKLOG 13: only scored under a hold or hill victory variant, so other worlds draw the same noise
      { id: "contest", score: (c) => this.contestScore(c), act: (c, out) => this.contest(c, out) },
      // stretch 3: only scored while a wolf den lives, so worlds without dens draw the same noise as before
      { id: "hunt", score: (c) => (this.homeDen(c) ? 0.55 : 0), act: (c, out) => this.hunt(c, out) },
    ];
  }

  // ------------------------------------------------------------------ victory variants (BACKLOG 13)

  /** the sites a hold or hill victory variant counts (empty otherwise) */
  private contested(w: World): { x: number; y: number }[] {
    const r = w.rules;
    return r && (r.def.type === "holdSites" || r.def.type === "kingOfHill") ? r.counted() : [];
  }

  /** a troop standing at a contested site holds it and stays out of waves */
  private posted(w: World, i: number): boolean {
    const sites = this.contested(w);
    if (!sites.length) return false;
    const E = w.ents;
    const n = w.terrain.size;
    const r = w.cfg.pack.balance.victory!.controlRadius;
    return sites.some((s) => {
      const dx = wrapDelta(E.x[i] - s.x, n);
      const dy = wrapDelta(E.y[i] - s.y, n);
      return dx * dx + dy * dy <= r * r;
    });
  }

  /**
   * the nearest contested site that we do not control, with whether a rival leads the race and its landmass:
   * sites on our landmass first; otherwise one on another landmass, which the wave reaches by boat (BACKLOG 98)
   */
  private contestTarget(c: Census): { x: number; y: number; behind: boolean; land: number; home: number } | null {
    const w = c.w;
    const E = w.ents;
    const n = w.terrain.size;
    const r = w.rules!;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    let best: { x: number; y: number; behind: boolean; land: number; home: number } | null = null;
    let bd = Infinity;
    const lead = Math.max(0, ...r.held.filter((_, t) => t !== this.tribe));
    for (const s of this.contested(w)) {
      const land = this.comp(w, s.x, s.y);
      if (land < 0) continue;
      const p = r.presence(s.x, s.y);
      const ours = p[this.tribe] > 0 && p.every((k, t) => t === this.tribe || k === 0);
      if (ours) continue;
      const dx = wrapDelta(s.x - E.x[c.h], n);
      const dy = wrapDelta(s.y - E.y[c.h], n);
      // any site on our landmass beats every site over the water
      const d = dx * dx + dy * dy + (land === home ? 0 : 1e9);
      if (d < bd) {
        bd = d;
        best = { x: s.x, y: s.y, behind: lead > (r.held[this.tribe] ?? 0), land, home };
      }
    }
    return best;
  }

  private contestScore(c: Census): number {
    if (c.threats.length || c.idle.length < 3) return 0;
    const t = this.contestTarget(c);
    return t ? 0.6 + (t.behind ? 0.3 : 0) : 0;
  }

  /** idle troops march on the site, attacking whatever holds it */
  private contest(c: Census, out: Command[]): void {
    const t = this.contestTarget(c);
    if (!t) return;
    const E = c.w.ents;
    if (t.land !== t.home) {
      this.ferry(c, out, t.x, t.y, t.home, true);
      return;
    }
    out.push(this.cmd(c.w, "move", { units: c.idle.map((i) => E.idOf(i)), to: [t.x, t.y], attack: true }));
    c.idle.length = 0;
  }

  /** BACKLOG 67: a watched wave counts as arrived once a living member is within threatRadius of its target. */
  private watchWaves(w: World): void {
    if (!this.watched.length) return;
    const E = w.ents;
    const n = w.terrain.size;
    const r2 = this.sh.threatRadius * this.sh.threatRadius;
    this.watched = this.watched.filter((v) => {
      let alive = false;
      for (const id of v.ids) {
        const i = E.index(id);
        if (i < 0) continue;
        alive = true;
        const dx = wrapDelta(E.x[i] - v.x, n);
        const dy = wrapDelta(E.y[i] - v.y, n);
        if (dx * dx + dy * dy <= r2) {
          this.stats.wavesArrived = (this.stats.wavesArrived ?? 0) + 1;
          return false;
        }
      }
      return alive && w.tick < v.until;
    });
  }

  /**
   * BACKLOG 23: a move picker (outside the sim) focuses one action until a tick: its utility score gets
   * `shared.focusBoost`, so the AI leans that way while every other consideration still counts.
   */
  setFocus(action: string | null, untilTick: number): void {
    if (action !== null && !this.actions.some((a) => a.id === action)) throw new Error(`unknown AI action ${action}`);
    this.focus = action;
    this.focusUntil = untilTick;
  }

  /** Save game memory: scouted tribes, the scout and the stats (decisions also gate the one-time setup). */
  saveState(): OpponentState {
    const st = this.stats;
    return { known: [...this.known], scout: this.scout, stats: { ...st, actions: { ...st.actions }, casts: { ...st.casts } }, ferried: [...this.ferried], goals: [...this.goals].map(([b, g]) => [b, g[0], g[1]]), waves: this.watched.map((v) => ({ ...v, ids: [...v.ids] })), ...(this.focus ? { focus: [this.focus, this.focusUntil] as [string, number] } : {}) };
  }

  loadState(state: unknown): void {
    const o = state as OpponentState;
    this.known = new Set(o.known);
    this.scout = o.scout;
    this.ferried = new Map(o.ferried ?? []);
    this.goals = new Map((o.goals ?? []).map(([b, x, y]) => [b, [x, y]]));
    this.watched = (o.waves ?? []).map((v) => ({ ...v, ids: [...v.ids] }));
    this.focus = o.focus?.[0] ?? null;
    this.focusUntil = o.focus?.[1] ?? -1;
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
    this.sh = { ...AI_SHARED_DEFAULTS, ...(ai.shared ?? {}) };
    const d = ai.difficulties.find((x) => x.id === this.difficulty);
    if (!d) throw new Error(`unknown difficulty ${this.difficulty}`);
    this.noise = d.decisionNoise;
    this.mapHack = d.mapHack ?? false;
    this.resourceMult = d.resourceMultiplier;
    this.periodTicks = this.periodOverride ?? Math.max(1, Math.round(d.reactionSeconds * w.cfg.tickHz));
    if (this.phase >= this.periodTicks) throw new Error("offset must be below the decision period");
    this.ready = true;
  }

  decide(w: World): Command[] {
    if (!this.ready) this.init(w);
    if (w.tick % this.periodTicks !== this.phase) return [];
    const tr = w.tribes[this.tribe];
    if (!tr?.alive) return [];
    if (w.forge?.running()) return this.forge(w).map((x) => ({ ...x, tick: w.tick, tribe: this.tribe }));
    const c = this.census(w);
    if (!c) return [];
    const out = this.eco.decide(w);
    this.landed(c, out);
    this.sail(c, out);
    // BACKLOG 6: the difficulty's resource multiplier goes through the sim as a command (hashed, replayable)
    if (tr.eco.incomeMult !== this.resourceMult) out.push({ tick: w.tick, tribe: this.tribe, type: "handicap", args: { mult: this.resourceMult } });
    this.stats.decisions++;
    this.watchWaves(w);
    // every decision: spells unlocked mid-match (worship sites) start charging too
    this.setup(w, out);
    const acts = this.actions.filter((a) => (a.id !== "worship" || w.worship.sites.length > 0) && (a.id !== "contest" || this.contested(w).length > 0) && (a.id !== "hunt" || w.beasts.dens.some((d) => !d.cleared)) && (a.id !== "buildSupport" || w.cfg.buildingIndex.has("spirit_well") || w.cfg.buildingIndex.has("mending_hut")) && (this.p.shades || !SHADE_ACTIONS.has(a.id)));
    const boost = this.focus !== null && w.tick < this.focusUntil ? (this.sh.focusBoost ?? 0.6) : 0;
    const scored = acts.map((a, k) => ({ a, k, s: a.score(c) + (w.rng.float("ai") - 0.5) * 2 * this.noise + (a.id === this.focus ? boost : 0) }));
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

  /**
   * BACKLOG 11 (ADR-017): Forge phase. The personality's plan (moat, wall or flatten) is a fixed list of brush
   * strokes around the Hearth; the next ones are those after the strokes already accepted (ForgeRuntime.ops),
   * so no extra state is saved. Ready once the list is done (at once without a plan).
   */
  private forge(w: World): Command[] {
    const f = w.forge!;
    const tr = w.tribes[this.tribe];
    const out: Command[] = [];
    if (f.ready[this.tribe]) return out;
    if (tr.eco.incomeMult !== this.resourceMult) out.push(this.cmd(w, "handicap", { mult: this.resourceMult }));
    const plan = this.p.forge;
    const h = w.ents.index(tr.hearth);
    const strokes = plan && h >= 0 ? this.forgeStrokes(w, h) : [];
    const done = f.ops[this.tribe];
    for (let k = done; k < strokes.length && k < done + (plan?.perDecision ?? 0); k++) out.push(this.cmd(w, "forgeOp", strokes[k]));
    if (done + (plan?.perDecision ?? 0) >= strokes.length) out.push(this.cmd(w, "forgeReady", {}));
    return out;
  }

  /** the plan's strokes in order: 24 points a pass on the ring (flatten: 12), gaps toward and away from the nearest rival */
  private forgeStrokes(w: World, h: number): { brush: string; x: number; y: number }[] {
    const plan = this.p.forge!;
    const E = w.ents;
    const n = w.terrain.size;
    const hx = E.x[h];
    const hy = E.y[h];
    let base = 0;
    let best = Infinity;
    for (const t of w.tribes) {
      const o = t.index === this.tribe || !t.alive ? -1 : E.index(t.hearth);
      if (o < 0) continue;
      const dx = wrapDelta(E.x[o] - hx, n);
      const dy = wrapDelta(E.y[o] - hy, n);
      if (dx * dx + dy * dy < best) {
        best = dx * dx + dy * dy;
        base = dmath.atan2(dy, dx);
      }
    }
    const brush = plan.plan === "moat" ? "lower" : plan.plan === "wall" ? "raise" : "flatten";
    const out: { brush: string; x: number; y: number }[] = [];
    // a moat or wall needs strokes about one brush radius apart to join up; three are skipped for each gap
    const per = plan.plan === "flatten" ? 12 : 24;
    for (let s = 0; out.length < plan.strokes && s < plan.strokes * 3; s++) {
      const q = s % per;
      if (plan.plan !== "flatten" && (q <= 1 || q === per - 1 || (q >= per / 2 - 1 && q <= per / 2 + 1))) continue;
      const ring = plan.plan === "flatten" && ((s / per) | 0) % 2 === 1 ? plan.ring - 2 : plan.ring;
      const a = base + (q * dmath.TWO_PI) / per;
      const x = (((hx + dmath.cos(a) * ring) % n) + n) % n;
      const y = (((hy + dmath.sin(a) * ring) % n) + n) % n;
      if (w.forge!.blocker(this.tribe, x, y) === null) out.push({ brush, x, y });
    }
    return out;
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
    const c: Census = { w, h, si: E.index(tr.shaper), minute: w.playTick / (60 * w.cfg.tickHz), pop: w.economy.followers(this.tribe), settlers: [], troops: new Map(), idle: [], shades: [], lodges: new Map(), towers: [], open: 0, threats: [], enemies: [], boats: [], boathouse: false };
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.tribe[i] === this.tribe) {
        if (E.cat[i] === CAT.building) {
          if (E.state[i] !== BSTATE.done) c.open++;
          const id = bdefs[E.type[i]].id;
          if (bdefs[E.type[i]].trains) c.lodges.set(id, [...(c.lodges.get(id) ?? []), i]);
          if (w.combat.garrisonOf(E.type[i]) > 0) c.towers.push(i);
          if (bdefs[E.type[i]].makes?.unit === "boat") c.boathouse = true;
        } else if (E.cat[i] === CAT.unit) {
          const def = units[E.type[i]];
          if (w.units.nav[E.type[i]] === NAV.water) c.boats.push(i);
          if (E.type[i] === w.economy.typeSettler) c.settlers.push(i);
          else if (w.combat.isSaboteur(E.type[i])) c.shades.push(i);
          else if (def.trainedAt) {
            c.troops.set(def.id, (c.troops.get(def.id) ?? 0) + 1);
            // stretch 3: a unit on the defensive stance is a posted guard (levels place them; the AI never sets it)
            if (E.inside[i] < 0 && E.mode[i] === 0 && E.order[i] === 0 && E.atk[i] === NO_ENTITY && E.stance[i] !== STANCE.defensive && i !== E.index(this.scout) && !this.posted(w, i)) c.idle.push(i);
          }
        }
      } else if (E.tribe[i] >= 0 && E.cat[i] === CAT.unit && E.veil[i] === 0 && !w.combat.disguised(i) && w.tribes[E.tribe[i]]?.alive && this.sees(w, i)) {
        // veiled enemies, disguised Shades and units in the fog are invisible to the AI as they are to a player
        const def = units[E.type[i]];
        if (!def.trainedAt && !def.isCaster) continue;
        const dx = wrapDelta(E.x[i] - E.x[h], n);
        const dy = wrapDelta(E.y[i] - E.y[h], n);
        if (dx * dx + dy * dy < this.sh.threatRadius * this.sh.threatRadius) c.threats.push(i);
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
      if (!this.known.has(t.index) && this.near(w, E.x[eh], E.y[eh], this.sh.scoutRadius)) {
        this.known.add(t.index);
        if (this.stats.scoutedAtTick < 0) this.stats.scoutedAtTick = w.tick;
      }
    }
    ds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    c.enemies = ds.map(([, t, eh]) => [t, eh]);
    return c;
  }

  /** BACKLOG 3: can this AI see enemy entity i now (fog of war; a map hack sees everything) */
  private sees(w: World, i: number): boolean {
    return this.mapHack || w.vision.seesEntity(this.tribe, i);
  }

  /** ...or has it seen the ground a building stands on (buildings stay mapped once seen) */
  private seenB(w: World, i: number): boolean {
    return this.mapHack || w.vision.seenEntity(this.tribe, i);
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
    return Math.max(this.sh.keepMin, Math.round(this.p.economyTargetPop * this.sh.keepShare));
  }

  /** settlers kept out of training: the economy floor, or a bare 6 while enemies are at the Hearth */
  private floor(c: Census): number {
    return c.threats.length ? Math.min(this.sh.keepUnderThreat, this.keep()) : this.keep();
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
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] < 0 || E.tribe[i] === this.tribe || E.veil[i] > 0 || w.combat.disguised(i) || !this.sees(w, i)) continue;
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
      if (dx * dx + dy * dy < this.sh.defendRadius * this.sh.defendRadius) ids.push(E.idOf(i));
    }
    if (ids.length) out.push(this.cmd(c.w, "move", { units: ids, to: [E.x[t], E.y[t]], attack: true }));
  }

  /** nearest reachable worship site still giving, with how many own units already pray there; a site held by
   * seen enemy troops (level guardians) only when no free site is left, flagged so troops clear it first */
  private worshipTarget(c: Census): { tag: string; si: number; need: number; have: number; guarded: boolean } | null {
    const w = c.w;
    const E = w.ents;
    const n = w.terrain.size;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    const kinds = w.cfg.pack.buildings.worship.kinds ?? [];
    let best: { tag: string; si: number; need: number; have: number; guarded: boolean } | null = null;
    let bd = Infinity;
    for (const s of w.worship.sites) {
      const si = E.index(s.ent);
      // totems are level scripting for the player's Shaper
      if (si < 0 || s.usesLeft <= 0 || s.dormant || kinds[s.kind]?.shaperOnly) continue;
      // stretch 3: a ley stone this tribe already holds has nothing to pray for
      if (kinds[s.kind]?.capturable && s.lastBy === this.tribe) continue;
      if (this.comp(w, E.x[si], E.y[si]) !== home) continue;
      // stretch 3: never walk worshippers into a site held by seen enemy troops (level guardians)
      const guarded = this.guarded(w, si);
      let have = 0;
      for (const i of c.settlers) if ((E.task[i] === TASK.toWorship || E.task[i] === TASK.worship) && E.index(E.target[i]) === si) have++;
      if (have >= s.need) continue;
      const dx = wrapDelta(E.x[si] - E.x[c.h], n);
      const dy = wrapDelta(E.y[si] - E.y[c.h], n);
      const d = dx * dx + dy * dy + (guarded ? 1e9 : 0);
      if (d < bd) {
        bd = d;
        best = { tag: s.tag, si, need: s.need, have, guarded };
      }
    }
    return best;
  }

  /** stretch 3: the nearest living wolf den within 30 cells of the Hearth, when idle troops could clear it */
  private homeDen(c: Census): { x: number; y: number } | null {
    if (c.threats.length || c.idle.length < 3) return null;
    const E = c.w.ents;
    const n = c.w.terrain.size;
    let best: { x: number; y: number } | null = null;
    let bestD = 900;
    for (const d of c.w.beasts.dens) {
      if (d.cleared || !d.members.length) continue;
      const dx = wrapDelta(d.x - E.x[c.h], n);
      const dy = wrapDelta(d.y - E.y[c.h], n);
      if (dx * dx + dy * dy < bestD) {
        bestD = dx * dx + dy * dy;
        best = d;
      }
    }
    return best;
  }

  /** idle troops attack-move on a den by home (wolves bite settlers and worshippers) */
  private hunt(c: Census, out: Command[]): void {
    const d = this.homeDen(c);
    if (!d) return;
    out.push(this.cmd(c.w, "move", { units: c.idle.map((i) => c.w.ents.idOf(i)), to: [d.x, d.y], attack: true }));
    c.idle.length = 0;
  }

  /** stretch 3: a living wolf den within its pack's reach of the site (dens are known landmarks, like sites) */
  private guardDen(w: World, si: number): { x: number; y: number } | null {
    const E = w.ents;
    const n = w.terrain.size;
    for (const d of w.beasts.dens) {
      if (d.cleared || !d.members.length) continue;
      const dx = wrapDelta(d.x - E.x[si], n);
      const dy = wrapDelta(d.y - E.y[si], n);
      if (dx * dx + dy * dy < 256) return d;
    }
    return null;
  }

  private guarded(w: World, si: number): boolean {
    const E = w.ents;
    const units = w.cfg.pack.units.units;
    if (this.guardDen(w, si)) return true;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.unit || E.tribe[j] === this.tribe || E.inside[j] >= 0) continue;
      if (E.tribe[j] < 0) continue;
      if (units[E.type[j]].trainedAt && this.dist2(w, j, si) < 64 && this.sees(w, j)) return true;
    }
    return false;
  }

  private worshipScore(c: Census): number {
    if (c.threats.length || c.w.playTick < this.worshipAfter * c.w.cfg.tickHz) return 0;
    const t = this.worshipTarget(c);
    if (t?.guarded) return c.idle.length >= 3 ? 0.75 : 0;
    // keep a working economy at home
    return t && c.settlers.length >= t.need - t.have + (this.sh.worshipKeepSettlers ?? 4) ? 0.75 : 0;
  }

  private worship(c: Census, out: Command[]): void {
    const t = this.worshipTarget(c);
    if (!t) return;
    const E = c.w.ents;
    const n = c.w.terrain.size;
    if (t.guarded) {
      // clear the guardians with idle troops; worshippers follow once the site is free
      const den = this.guardDen(c.w, t.si);
      const to = den ? [den.x, den.y] : [E.x[t.si], E.y[t.si]];
      if (c.idle.length >= 3) out.push(this.cmd(c.w, "move", { units: c.idle.map((i) => E.idOf(i)), to, attack: true }));
      return;
    }
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
    if (!l || !this.supplied(c, l)) return 0;
    const unit = c.w.cfg.pack.units.units.find((u) => u.trainedAt === l)!;
    return 0.45 + 0.45 * (this.p.armyMix[unit.id] ?? 0) + 0.1 * this.p.aggression;
  }

  private buildLodge(c: Census, out: Command[]): void {
    const l = this.missingLodge(c);
    if (l) this.build(c, out, l);
  }

  private towerScore(c: Census): number {
    if (c.open >= c.w.cfg.pack.balance.economy.maxOpenPlansPerTribe || c.settlers.length < this.keep() * 0.5) return 0;
    if (c.w.economy.buildingLock(this.tribe, c.w.cfg.buildingIndex.get("watchtower")!) || !this.supplied(c, "watchtower")) return 0;
    // BACKLOG 64: towers wait for a share of the economy target (unless the Hearth is under threat), so the
    // turtle does not spend its early wood and settlers on them and fall behind
    if (!c.threats.length && c.pop < this.p.economyTargetPop * (this.p.towerFromPopShare ?? 0)) return 0;
    const want = Math.round(this.p.towerAffinity * 3);
    return c.towers.length < want ? 0.3 + 0.6 * this.p.towerAffinity : 0;
  }

  /** stretch 3: the support building the tribe still lacks: a Spirit Well past 60 percent of the economy target,
   * a Mending Hut once 6 troops stand; none at the open plan limit or while the Hearth is threatened */
  private supportBuilding(c: Census): string | null {
    const w = c.w;
    if (c.threats.length || c.open >= w.cfg.pack.balance.economy.maxOpenPlansPerTribe || c.settlers.length < this.keep() * 0.5) return null;
    const E = w.ents;
    const want = (id: string, when: boolean): boolean => {
      const b = w.cfg.buildingIndex.get(id);
      if (b === undefined || !when || w.economy.buildingLock(this.tribe, b) || !this.supplied(c, id)) return false;
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building && E.tribe[i] === this.tribe && E.type[i] === b) return false;
      return true;
    };
    let troops = 0;
    for (const v of c.troops.values()) troops += v;
    if (want("spirit_well", c.pop >= this.p.economyTargetPop * 0.6)) return "spirit_well";
    if (want("mending_hut", troops >= 6)) return "mending_hut";
    return null;
  }

  /** BACKLOG 0c: a building that needs stone is only worth planning with a rock on the Hearth's landmass. */
  private supplied(c: Census, building: string): boolean {
    const def = c.w.cfg.pack.buildings.buildings[c.w.cfg.buildingIndex.get(building)!];
    return !(def.stone ?? 0) || c.w.economy.stoneInReach(c.w.ents.x[c.h], c.w.ents.y[c.h]);
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
    if (!c.lodges.size || c.settlers.length <= this.floor(c) || c.w.combat.troopRoom(this.tribe) <= 0) return 0;
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

  // ------------------------------------------------------------------ BACKLOG 2: Shades

  private denScore(c: Census): number {
    const sh = this.p.shades;
    if (!sh || c.minute < sh.fromMinute || c.lodges.has("shade_den") || c.threats.length) return 0;
    if (c.open >= c.w.cfg.pack.balance.economy.maxOpenPlansPerTribe || c.settlers.length < this.keep() * 0.6) return 0;
    const bt = c.w.cfg.buildingIndex.get("shade_den");
    if (bt === undefined || c.w.economy.buildingLock(this.tribe, bt) || !this.supplied(c, "shade_den")) return 0;
    return 0.65;
  }

  private buildDen(c: Census, out: Command[]): void {
    this.build(c, out, "shade_den");
  }

  /** the finished Shade Den, or -1 */
  private den(c: Census): number {
    return (c.lodges.get("shade_den") ?? []).find((b) => c.w.ents.state[b] === BSTATE.done) ?? -1;
  }

  private trainShadeScore(c: Census): number {
    const sh = this.p.shades;
    const d = this.den(c);
    if (!sh || d < 0 || c.threats.length || c.settlers.length <= this.floor(c)) return 0;
    return c.shades.length + (c.w.combat.queued().get(d) ?? 0) < sh.count ? 0.6 : 0;
  }

  private trainShade(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const d = this.den(c);
    if (d < 0) return;
    if (E.mode[d] === 0) out.push(this.cmd(w, "setRally", { building: E.idOf(d), at: [E.x[c.h] - 3, E.y[c.h] + 3] }));
    out.push(this.cmd(w, "train", { building: E.idOf(d), count: 1 }));
  }

  /** own Shades with nothing to do */
  private idleShades(c: Census): number[] {
    const E = c.w.ents;
    return c.shades.filter((i) => E.inside[i] < 0 && E.order[i] === 0 && E.atk[i] === NO_ENTITY && E.chant[i] === 0);
  }

  /**
   * a sabotage target for Shade i: the nearest finished building of a scouted enemy that is not a Hearth,
   * not already alight and not within detection of one of that tribe's Watchtowers or its Shaper
   */
  private sabotageTarget(c: Census, i: number): number {
    const w = c.w;
    const E = w.ents;
    const n = w.terrain.size;
    const sab = w.cfg.pack.units.units[E.type[i]].sabotage!;
    const detB = new Set(sab.detectors.map((d) => w.cfg.buildingIndex.get(d)).filter((d) => d !== undefined));
    const detU = new Set(sab.detectors.map((d) => w.cfg.unitIndex.get(d)).filter((d) => d !== undefined));
    const home = this.comp(w, E.x[i], E.y[i]);
    const guards: number[] = [];
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.tribe[j] < 0 || E.tribe[j] === this.tribe || E.inside[j] >= 0) continue;
      if (E.cat[j] === CAT.building ? detB.has(E.type[j]) && this.seenB(w, j) : E.cat[j] === CAT.unit && detU.has(E.type[j]) && this.sees(w, j)) guards.push(j);
    }
    const r = sab.detectRadius + 3;
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.building || E.state[j] !== BSTATE.done || E.burn[j] > 0) continue;
      const tj = E.tribe[j];
      if (tj < 0 || tj === this.tribe || !this.known.has(tj) || !w.tribes[tj]?.alive || w.tribes[tj].hearth === E.idOf(j) || detB.has(E.type[j]) || !this.seenB(w, j)) continue;
      if (guards.some((g) => E.tribe[g] === tj && this.dist2(w, g, j) < r * r)) continue;
      if (this.comp(w, E.x[j], E.y[j]) !== home) continue;
      const dx = wrapDelta(E.x[j] - E.x[i], n);
      const dy = wrapDelta(E.y[j] - E.y[i], n);
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  }

  private dist2(w: World, a: number, b: number): number {
    const n = w.terrain.size;
    const dx = wrapDelta(w.ents.x[a] - w.ents.x[b], n);
    const dy = wrapDelta(w.ents.y[a] - w.ents.y[b], n);
    return dx * dx + dy * dy;
  }

  private sabotageScore(c: Census): number {
    if (!this.p.shades || !c.enemies.length) return 0;
    return this.idleShades(c).length ? 0.7 : 0;
  }

  /** each idle Shade goes for a target; with none in reach it slips toward an unscouted enemy start site */
  private sabotage(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const taken = new Set<number>();
    for (const i of this.idleShades(c)) {
      const t = this.sabotageTarget(c, i);
      if (t >= 0 && !taken.has(t)) {
        taken.add(t);
        out.push(this.cmd(w, "attack", { units: [E.idOf(i)], target: E.idOf(t) }));
        this.stats.sabotages = (this.stats.sabotages ?? 0) + 1;
        continue;
      }
      const home = this.comp(w, E.x[i], E.y[i]);
      const site = c.enemies.find(([tr, eh]) => !this.known.has(tr) && this.comp(w, E.x[eh], E.y[eh]) === home);
      if (site) out.push(this.cmd(w, "move", { units: [E.idOf(i)], to: [E.x[site[1]], E.y[site[1]]] }));
    }
  }

  private waveSize(): number {
    return Math.round(this.sh.waveBase + (1 - this.p.aggression) * this.sh.waveAggressionSpan);
  }

  private attackScore(c: Census): number {
    if (c.minute < this.p.firstAttackMinute || !c.enemies.length) return 0;
    const ratio = c.idle.length / this.waveSize();
    if (ratio < 1) return 0;
    // mixed waves: hold a single-type wave while a second lodge is up or still being built (BACKLOG 7:
    // waiting only for a finished one let fast single-type waves end the match first), for up to 3 minutes
    const kinds = new Set(c.idle.map((i) => c.w.ents.type[i])).size;
    const lodgeKinds = [...c.lodges.values()].filter((l) => l.length > 0).length;
    if (kinds < 2 && lodgeKinds >= 2 && c.minute < this.p.firstAttackMinute + this.sh.mixedHoldMinutes) return 0;
    return clamp01(this.sh.attackScoreBase + this.sh.attackScoreAggression * this.p.aggression + this.sh.attackScoreSurplus * (ratio - 1));
  }

  private attack(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    // known enemies first, then any start site (a wave scouts as it goes)
    const ranked = [...c.enemies.filter(([t]) => this.known.has(t)), ...c.enemies.filter(([t]) => !this.known.has(t))];
    // stretch 3: a level's open destroy objective for this tribe (the bot playing tribe 0) comes before any Hearth
    const goal = this.destroyTarget(c, home);
    const target: [number, number] | undefined = goal >= 0 ? [E.tribe[goal], goal] : ranked.find(([, eh]) => this.comp(w, E.x[eh], E.y[eh]) === home);
    if (!target) {
      if (E.cat[ranked[0][1]] === CAT.unit) this.approach(c, out, ranked[0][1], home);
      this.ferry(c, out, E.x[ranked[0][1]], E.y[ranked[0][1]], home, false);
      this.bridge(c, out, ranked[0][1]);
      return;
    }
    const eh = target[1];
    out.push(this.cmd(w, "move", { units: c.idle.map((i) => E.idOf(i)), to: [E.x[eh], E.y[eh]], attack: true }));
    this.stats.waves++;
    this.watched.push({ ids: c.idle.map((i) => E.idOf(i)), x: E.x[eh], y: E.y[eh], until: w.tick + WAVE_WATCH_MINUTES * 60 * w.cfg.tickHz });
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

  /** stretch 3: nearest building named by an open `destroy` objective of the level (tribe 0 only), on the home landmass, or -1 */
  private destroyTarget(c: Census, home: number): number {
    const w = c.w;
    const lv = w.level;
    if (!lv || this.tribe !== 0) return -1;
    const E = w.ents;
    const n = w.terrain.size;
    let best = -1;
    let bestD = Infinity;
    lv.def.objectives.forEach((o, k) => {
      if (o.type !== "destroy" || lv.done[k] || !lv.open(k) || !w.tribes[o.tribe]?.alive) return;
      const type = w.cfg.buildingIndex.get(o.building);
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.cat[i] !== CAT.building || E.tribe[i] !== o.tribe || E.type[i] !== type || this.comp(w, E.x[i], E.y[i]) !== home) continue;
        const dx = wrapDelta(E.x[i] - E.x[c.h], n);
        const dy = wrapDelta(E.y[i] - E.y[c.h], n);
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      }
    });
    return best;
  }

  /** BACKLOG 10: no land route to the enemy, so boats carry the wave. Without a boat the tribe raises a
   * Boathouse once it may; an empty idle boat takes the idle troops on the home landmass; a loaded boat
   * whose walkers have all boarded sails to the enemy shore and unloads (landed() sends them on). */
  private ferry(c: Census, out: Command[], tx: number, ty: number, home: number, toSite: boolean): void {
    const w = c.w;
    const E = w.ents;
    if (!c.boats.length) {
      const bh = w.cfg.buildingIndex.get("boathouse");
      if (!c.boathouse && bh !== undefined && !w.economy.buildingLock(this.tribe, bh)) this.build(c, out, "boathouse");
      return;
    }
    const walkers = c.idle.filter((i) => this.comp(w, E.x[i], E.y[i]) === home);
    for (const b of c.boats) {
      if (E.order[b] !== 0 || E.task[b] === TASK.unload) continue;
      const id = E.idOf(b);
      let boarding = 0;
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.task[i] === TASK.toBoard && E.target[i] === id) boarding++;
      if (boarding > 0) continue;
      if (E.occupants[b] > 0) continue;
      const seats = w.vehicles.capacityOf(b);
      if (walkers.length < Math.min(seats, this.waveSize())) continue;
      // board only a boat docked at our shore (ai soak seed 1009: a boat on another sea drew walkers
      // that could never reach it, every decision); otherwise sail it to our shore when that sea is its own
      const pf = w.units.pf;
      const n = w.terrain.size;
      const dock = pf.nearestWalkable((((Math.round(E.x[b]) % n) + n) % n) + (((Math.round(E.y[b]) % n) + n) % n) * n, Math.ceil(w.vehicles.boardRadiusOf(b)));
      if (dock < 0 || pf.comp[dock] !== home) {
        const shore = this.shore(c, E.x[c.h], E.y[c.h], home, b);
        if (shore) out.push(this.cmd(w, "move", { units: [id], to: shore }));
        continue;
      }
      // load only for a shore the boat can reach (D+F review: a wave locked aboard), and not again within
      // the backoff (a trip that failed unloads at home; without it the wave would board every decision)
      if (!this.shore(c, tx, ty, this.comp(w, tx, ty), b)) continue;
      const last = this.ferried.get(id);
      if (last !== undefined && w.tick - last < FERRY_BACKOFF_SECONDS * w.cfg.tickHz) continue;
      this.ferried.set(id, w.tick);
      // BACKLOG 98: a wave boarded for a contested site sails there; one boarded to attack forgets an old site
      if (toSite) this.goals.set(id, [tx, ty]);
      else this.goals.delete(id);
      out.push(this.cmd(w, "board", { units: walkers.splice(0, seats).map((i) => E.idOf(i)), vehicle: id }));
    }
  }

  /** BACKLOG 10: every decision, a loaded boat whose walkers have all boarded sails for the shore of the first
   * enemy out of reach on foot (known enemies first) and unloads there */
  private sail(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    if (!c.boats.length) return;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    const ranked = [...c.enemies.filter(([t]) => this.known.has(t)), ...c.enemies.filter(([t]) => !this.known.has(t))];
    const far = ranked.find(([, eh]) => this.comp(w, E.x[eh], E.y[eh]) !== home);
    for (const b of c.boats) {
      if (E.occupants[b] === 0 || E.order[b] !== 0 || E.task[b] === TASK.unload) continue;
      const id = E.idOf(b);
      let boarding = 0;
      for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.task[i] === TASK.toBoard && E.target[i] === id) boarding++;
      if (boarding > 0) continue;
      const goal = this.goals.get(id);
      const land = goal
        ? this.shore(c, goal[0], goal[1], this.comp(w, goal[0], goal[1]), b)
        : far
          ? this.shore(c, E.x[far[1]], E.y[far[1]], this.comp(w, E.x[far[1]], E.y[far[1]]), b)
          : null;
      this.goals.delete(id);
      if (land) {
        out.push(this.cmd(w, "unload", { units: [id], to: land }));
        this.stats.ferries++;
        continue;
      }
      // no enemy shore in reach (the enemy fell, or a bridge joined the land): bring the wave home
      const back = this.shore(c, E.x[c.h], E.y[c.h], home, b);
      out.push(this.cmd(w, "unload", back ? { units: [id], to: back } : { units: [id] }));
    }
  }

  /** the shore of landmass `land` facing boat b: walk from (x0, y0) toward the boat while still on that
   * landmass; null when the water off that shore is not the boat's water (another sea) */
  private shore(c: Census, x0: number, y0: number, land: number, b: number): [number, number] | null {
    const w = c.w;
    const E = w.ents;
    const n = w.terrain.size;
    if (land < 0) return null;
    const dx = wrapDelta(E.x[b] - x0, n);
    const dy = wrapDelta(E.y[b] - y0, n);
    const d = Math.sqrt(dx * dx + dy * dy);
    let lx = x0;
    let ly = y0;
    for (let k = 1; k < d; k++) {
      const x = x0 + (dx * k) / d;
      const y = y0 + (dy * k) / d;
      if (this.comp(w, x, y, 1) !== land) break;
      lx = x;
      ly = y;
    }
    const sea = w.units.pfs[NAV.water];
    const snap = w.cfg.pack.balance.movement.snapRadius;
    const cell = (x: number, y: number) => (((Math.round(x) % n) + n) % n) + (((Math.round(y) % n) + n) % n) * n;
    const off = sea.nearestWalkable(cell(lx, ly), snap);
    const at = sea.nearestWalkable(cell(E.x[b], E.y[b]), snap);
    if (off < 0 || at < 0 || sea.comp[off] !== sea.comp[at]) return null;
    return [((lx % n) + n) % n, ((ly % n) + n) % n];
  }

  /** BACKLOG 10: idle troops standing on an enemy's landmass (put ashore by a boat) attack that enemy's Hearth;
   * BACKLOG 98: under a hold or hill variant they march on a site there that we do not hold first */
  private landed(c: Census, out: Command[]): void {
    const w = c.w;
    const E = w.ents;
    const home = this.comp(w, E.x[c.h], E.y[c.h]);
    const groups = new Map<number, number[]>();
    for (const i of c.idle) {
      const k = this.comp(w, E.x[i], E.y[i]);
      if (k < 0 || k === home) continue;
      const g = groups.get(k);
      if (g) g.push(i);
      else groups.set(k, [i]);
    }
    for (const [k, units] of groups) {
      // BACKLOG 98: under a hold or hill variant a site here that we do not hold comes first (the wave was
      // most likely ferried for it, and holding wins), else the enemy Hearth here
      const r = w.rules;
      const site = this.contested(w).find((s) => {
        if (this.comp(w, s.x, s.y) !== k) return false;
        const p = r!.presence(s.x, s.y);
        return !(p[this.tribe] > 0 && p.every((n, t) => t === this.tribe || n === 0));
      });
      const target = site ? null : c.enemies.find(([, eh]) => this.comp(w, E.x[eh], E.y[eh]) === k);
      if (!target && !site) continue;
      const to = site ? [site.x, site.y] : [E.x[target![1]], E.y[target![1]]];
      out.push(this.cmd(w, "move", { units: units.map((i) => E.idOf(i)), to, attack: true }));
      c.idle = c.idle.filter((i) => !units.includes(i));
    }
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
    // BACKLOG 64: every castable preferred spell is valued at its best target and the best value wins, with a
    // small tilt toward earlier preferences (it used to be the first castable spell, whatever it would hit)
    let pick: { spell: string; x: number; y: number } | null = null;
    let pickValue = 0;
    for (let rank = 0; rank < this.p.spellPrefs.length; rank++) {
      const id = this.p.spellPrefs[rank];
      const s = w.cfg.spellIndex.get(id);
      if (s === undefined || !eco.unlocked[s] || eco.charges[s] <= 0) continue;
      const def = w.cfg.pack.spells.spells[s];
      const reach = def.range + this.sh.castReachSlack;
      const kind = def.aiTarget ?? "none";
      if (kind === "none" || kind === "bridge") continue;
      const heals = def.effects.some((e) => e.type === "healOverTime");
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
          ok = kind === "ownFighting" ? E.atk[i] !== NO_ENTITY && (heals ? E.hp[i] < 0.7 * w.cfg.pack.units.units[E.type[i]].hp : E.ward[i] === 0) : E.order[i] !== 0 && E.atk[i] === NO_ENTITY && E.veil[i] === 0;
        } else if (kind === "wild") ok = E.cat[i] === CAT.unit && E.type[i] === w.economy.typeWild;
        else if (tribe >= 0 && tribe !== this.tribe && w.tribes[tribe]?.alive) ok = kind === "buildings" ? E.cat[i] === CAT.building && E.state[i] === BSTATE.done && this.seenB(w, i) : E.cat[i] === CAT.unit && E.veil[i] === 0 && !w.combat.disguised(i) && this.sees(w, i);
        if (!ok) continue;
        const dx = wrapDelta(E.x[i] - E.x[c.si], n);
        const dy = wrapDelta(E.y[i] - E.y[c.si], n);
        if (dx * dx + dy * dy > reach * reach) continue;
        // value: units in a cluster (or the building's own worth) near the point
        // a spell that can kill a Shaper values one even alone (BACKLOG 7: the last Shaper of a fallen tribe)
        const score =
          kind === "buildings"
            ? this.buildingsAt(w, i, this.reachRadius(def))
            : this.clusterAt(w, i, kind === "wild") + (kind === "units" && killsCaster && w.cfg.pack.units.units[E.type[i]].isCaster ? 2 : 0);
        // own-troop spells need a real group (a lone soldier is not worth the charge)
        if ((kind === "ownFighting" || kind === "ownMarching") && score < 3) continue;
        // beyond range the cast walks the Shaper in, which fails on another landmass (BACKLOG 0a, ai soak
        // seed 1002: a Lightning queued and failed every decision, overriding the approach move)
        if (score > bestScore && dx * dx + dy * dy > def.range * def.range && this.comp(w, E.x[i], E.y[i]) !== this.comp(w, E.x[c.si], E.y[c.si])) continue;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const min = kind === "buildings" ? 1 : 2;
      if (best < 0 || bestScore < min) continue;
      // a damage spell is worth its kill power on the cluster; a utility spell (Ward, Veil, Call) its group size
      const value = bestScore * (1 + this.power(def)) * (1 - 0.06 * rank);
      if (value > pickValue) {
        pickValue = value;
        pick = { spell: id, x: E.x[best], y: E.y[best] };
      }
    }
    return pick;
  }

  /**
   * rough kill power of a spell, 0 to 1: radius damage per target over a Warden's hp, plus (S3 handoff:
   * the AI never cast Mire, Erode or Volcano because they scored 0 here) traps that kill, land that sinks
   * or burns, storms and building damage
   */
  private power(def: { effects: readonly { type: string; damage?: number; kills?: number; op?: string; damagePct?: number; count?: number; damagePerSecond?: number; seconds?: number }[] }): number {
    let p = 0;
    for (const e of def.effects) {
      if (e.type === "damageRadius" && e.damage) p += e.damage / 2600;
      else if (e.type === "trap" && e.kills) p += Math.min(1, e.kills / 10);
      else if (e.type === "terrainOp" && (e.op === "lowerTowardSea" || e.op === "crater" || e.op === "noiseScar")) p += 0.6;
      else if (e.type === "damageBuildingsRadius" && e.damagePct) p += e.damagePct / 100;
      else if (e.type === "projectileStorm" && e.damage && e.count) p += (e.damage * e.count) / 2600 / 4;
      else if (e.type === "areaOverTime" && e.damagePerSecond && e.seconds) p += (e.damagePerSecond * e.seconds) / 2600;
    }
    return Math.min(1, p);
  }

  /** the widest radius among a spell's effects (how much of a village one cast covers) */
  private reachRadius(def: { effects: readonly object[] }): number {
    let r = 1;
    for (const e of def.effects) {
      const er = (e as { radius?: unknown }).radius;
      if (typeof er === "number" && er > r) r = er;
    }
    return r;
  }

  /** value of a building target: finished, seen rival buildings within r of building i (a Hearth counts 4) */
  private buildingsAt(w: World, i: number, r: number): number {
    const E = w.ents;
    const n = w.terrain.size;
    let v = 0;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.building || E.tribe[j] !== E.tribe[i] || E.state[j] !== BSTATE.done) continue;
      const dx = wrapDelta(E.x[j] - E.x[i], n);
      const dy = wrapDelta(E.y[j] - E.y[i], n);
      if (dx * dx + dy * dy > r * r || !this.seenB(w, j)) continue;
      v += w.cfg.pack.buildings.buildings[E.type[j]].id === "hearth" ? 4 : 1;
    }
    return v + 1;
  }

  private clusterAt(w: World, i: number, wild: boolean): number {
    const E = w.ents;
    const n = w.terrain.size;
    let k = 0;
    for (let j = 0; j < E.hi; j++) {
      if (!E.alive[j] || E.cat[j] !== CAT.unit || E.veil[j] > 0 || w.combat.disguised(j) || !this.sees(w, j)) continue;
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

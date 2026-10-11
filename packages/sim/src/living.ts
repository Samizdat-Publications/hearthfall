// Stretch 3 (living world): land that moves on a schedule and capturable sites that work for whoever
// holds them. Shape rewards (level triggers, site rewards) start land jobs: a box of target heights the
// land walks toward in half-second steps (tides, rising causeways, sinking fords; units on land that
// goes under drown in the same tick). Held capturable sites (ley stones) run their aura each `every`
// seconds: mana income, a strike on the nearest enemy, healing, or sight. Step 9b, after worship. An
// idle system adds nothing to the hash or snapshot, so worlds without it keep their replays.
import type { Aura, Reward } from "@hearthfall/data";
import { secondsToTicks } from "./config.ts";
import { healUnit } from "./effects.ts";
import { CAT } from "./entities.ts";
import type { Fnv } from "./hash.ts";
import { wrap, wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

/** one reshaping in progress: a w by h box from (x0, y0), row-major targets (-1: untouched) */
export interface LandJob {
  x0: number;
  y0: number;
  w: number;
  h: number;
  target: number[];
  stepsLeft: number;
  /** tick of the next step */
  next: number;
}

export interface LivingState {
  jobs: LandJob[];
}

/** land jobs step this often */
export const LAND_STEP_SECONDS = 0.5;

type ShapeReward = Extract<Reward, { type: "shape" }>;

export class LivingSystem {
  jobs: LandJob[] = [];
  private w: World;

  constructor(w: World) {
    this.w = w;
  }

  // ---------------------------------------------------------------- land jobs
  /** Start a shape reward anchored at (ax, ay) (its `at` wins). Instant shapes go in this tick. */
  startShape(r: ShapeReward, ax: number, ay: number): void {
    const w = this.w;
    const t = w.terrain;
    const n = t.size;
    const [cx, cy] = r.at ?? [ax, ay];
    const fall = r.falloff ?? 3;
    const goal = t.sea + r.aboveSea;
    // the shape as a distance-outside function in local coordinates (center at 0, 0)
    // box in local cells (x from lx0 to lx1, y from ly0 to ly1) around the shape plus its falloff
    let lx0: number;
    let lx1: number;
    let ly0: number;
    let ly1: number;
    let out: (ox: number, oy: number) => number;
    if (r.shape === "disc") {
      const rr = r.r ?? 4;
      lx0 = ly0 = -(rr + fall + 1);
      lx1 = ly1 = rr + fall + 1;
      out = (ox, oy) => Math.sqrt(ox * ox + oy * oy) - rr;
    } else if (r.shape === "rect") {
      const hx = (r.size?.[0] ?? 8) / 2;
      const hy = (r.size?.[1] ?? 8) / 2;
      lx0 = -(hx + fall + 1);
      lx1 = hx + fall + 1;
      ly0 = -(hy + fall + 1);
      ly1 = hy + fall + 1;
      out = (ox, oy) => Math.max(Math.abs(ox) - hx, Math.abs(oy) - hy, 0);
    } else {
      const to = r.to ?? [cx, cy];
      const ex = wrapDelta(to[0] - cx, n);
      const ey = wrapDelta(to[1] - cy, n);
      const hw = (r.width ?? 2) / 2;
      const len2 = ex * ex + ey * ey;
      const pad = hw + fall + 1;
      lx0 = Math.min(0, ex) - pad;
      lx1 = Math.max(0, ex) + pad;
      ly0 = Math.min(0, ey) - pad;
      ly1 = Math.max(0, ey) + pad;
      out = (ox, oy) => {
        const k = len2 > 0 ? Math.max(0, Math.min(1, (ox * ex + oy * ey) / len2)) : 0;
        const dx = ox - ex * k;
        const dy = oy - ey * k;
        return Math.sqrt(dx * dx + dy * dy) - hw;
      };
    }
    const bx0 = Math.floor(cx + lx0);
    const by0 = Math.floor(cy + ly0);
    const bw = Math.min(n, Math.ceil(cx + lx1) - bx0 + 1);
    const bh = Math.min(n, Math.ceil(cy + ly1) - by0 + 1);
    const target = new Array<number>(bw * bh).fill(-1);
    let moved = false;
    for (let j = 0; j < bh; j++) {
      for (let i = 0; i < bw; i++) {
        const gx = bx0 + i;
        const gy = by0 + j;
        const d = out(gx - cx, gy - cy);
        if (d > 0 && d >= fall) continue;
        const h = t.get(wrap(gx, n), wrap(gy, n));
        const k = d <= 0 ? 1 : 1 - d / fall;
        const v = Math.round(h + (goal - h) * k);
        if (v === h) continue;
        target[j * bw + i] = v;
        moved = true;
      }
    }
    if (!moved) return;
    const steps = Math.max(1, Math.round((r.seconds ?? 0) / LAND_STEP_SECONDS));
    const job: LandJob = { x0: wrap(bx0, n), y0: wrap(by0, n), w: bw, h: bh, target, stepsLeft: steps, next: w.tick };
    w.emit("landShape", { x: cx, y: cy, r: Math.max(lx1 - lx0, ly1 - ly0) / 2, seconds: r.seconds ?? 0, aboveSea: r.aboveSea });
    this.jobs.push(job);
    this.stepJobs();
  }

  /** Queue one step of every job that is due (finished jobs drop out). */
  private stepJobs(): void {
    const w = this.w;
    const every = Math.max(1, secondsToTicks(LAND_STEP_SECONDS, w.cfg.tickHz));
    for (const j of this.jobs) {
      if (j.stepsLeft <= 0 || w.tick < j.next) continue;
      w.terrainQueue.push({ op: "toward", x: j.x0 + j.w / 2, y: j.y0 + j.h / 2, r: Math.max(j.w, j.h) / 2, x0: j.x0, y0: j.y0, w: j.w, h: j.h, target: j.target, steps: j.stepsLeft });
      j.stepsLeft--;
      j.next = w.tick + every;
    }
    if (this.jobs.some((j) => j.stepsLeft <= 0)) this.jobs = this.jobs.filter((j) => j.stepsLeft > 0);
  }

  // ---------------------------------------------------------------- site auras
  /** Read-only for the renderer: the aura site k runs and its holder, or null when it runs none. */
  siteAura(k: number): { aura: Aura; holder: number } | null {
    const h = this.held(k);
    return h ? { aura: h.aura, holder: h.holder } : null;
  }

  /** the aura a site runs for its holder, or null (dormant, unheld, not capturable, holder gone) */
  private held(k: number): { aura: Aura; holder: number; i: number } | null {
    const w = this.w;
    const s = w.worship.sites[k];
    const aura = s.aura ?? w.worship.kindAura(s.kind);
    if (!aura || s.dormant || s.lastBy < 0 || !w.tribes[s.lastBy]?.alive) return null;
    const i = w.ents.index(s.ent);
    return i < 0 ? null : { aura, holder: s.lastBy, i };
  }

  /** Mana auras add their amount (mana per minute) to the holder's income (economy step 8). */
  addManaRates(rates: Float64Array): void {
    for (let k = 0; k < this.w.worship.sites.length; k++) {
      const h = this.held(k);
      if (h && h.aura.type === "mana" && h.holder < rates.length) rates[h.holder] += h.aura.amount;
    }
  }

  /** Sight auras: held stones see like a building (vision step). */
  sightSources(): { tribe: number; x: number; y: number; r: number }[] {
    const out: { tribe: number; x: number; y: number; r: number }[] = [];
    if (!this.w.worship.hasAuras) return out;
    for (let k = 0; k < this.w.worship.sites.length; k++) {
      const h = this.held(k);
      if (h && h.aura.type === "sight") out.push({ tribe: h.holder, x: this.w.ents.x[h.i], y: this.w.ents.y[h.i], r: h.aura.r });
    }
    return out;
  }

  private runAuras(): void {
    const w = this.w;
    const E = w.ents;
    w.worship.sites.forEach((_s, k) => {
      const h = this.held(k);
      if (!h || h.aura.type === "mana" || h.aura.type === "sight") return;
      const every = Math.max(1, secondsToTicks(h.aura.every, w.cfg.tickHz));
      if ((w.tick + k) % every !== 0) return;
      const x = E.x[h.i];
      const y = E.y[h.i];
      const a = h.aura;
      const n = w.terrain.size;
      const r2 = a.r * a.r;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] >= 0) continue;
        const tr = E.tribe[i];
        const dx = wrapDelta(E.x[i] - x, n);
        const dy = wrapDelta(E.y[i] - y, n);
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        if (a.type === "heal") {
          if (tr === h.holder) healUnit(w, i, a.amount);
        } else if (tr >= 0 && tr !== h.holder && d2 < bestD) {
          best = i;
          bestD = d2;
        }
      }
      if (a.type === "strike" && best >= 0) {
        w.emit("auraStrike", { tribe: h.holder, site: w.worship.sites[k].tag, x, y, tx: E.x[best], ty: E.y[best] });
        w.damage(best, a.amount, h.holder, false);
      } else if (a.type === "heal") w.emit("auraHeal", { tribe: h.holder, x, y, r: a.r });
    });
  }

  /** Step 9b: land jobs, then auras. */
  update(): void {
    if (this.jobs.length) this.stepJobs();
    if (this.w.worship.hasAuras) this.runAuras();
  }

  // ---------------------------------------------------------------- skirmish ley stones
  /**
   * Scatter up to `count` capturable stones (balance.skirmishLey) on dry walkable land, clear of every
   * Hearth and of each other: candidates on a golden-ratio lattice over the map (no rng), first fit wins.
   */
  placeLeyStones(hearths: readonly { x: number; y: number }[], count: number): void {
    const w = this.w;
    const cfg = w.cfg.pack.balance.skirmishLey;
    if (!cfg || count <= 0) return;
    const n = w.terrain.size;
    const max = Math.min(count, Math.floor((n * n) / cfg.cellsPerStone));
    const far = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
      const dx = wrapDelta(p.x - q.x, n);
      const dy = wrapDelta(p.y - q.y, n);
      return dx * dx + dy * dy >= d * d;
    };
    const sitesNow = w.worship.sites.map((s) => {
      const i = w.ents.index(s.ent);
      return { x: w.ents.x[i], y: w.ents.y[i] };
    });
    const placed: { x: number; y: number }[] = [];
    const tries = max * 64;
    const off = (w.seed >>> 0) % 997;
    for (let k = 0; k < tries && placed.length < max; k++) {
      const m = k + off;
      // R2 low-discrepancy sequence (plastic number): even coverage without an rng
      const fx = (0.5 + m * 0.7548776662466927) % 1;
      const fy = (0.5 + m * 0.5698402909980532) % 1;
      const p = { x: Math.floor(fx * n), y: Math.floor(fy * n) };
      if (!w.worship.dryRing(p.x, p.y)) continue;
      if (!hearths.every((h) => far(p, h, cfg.minHearthDistance))) continue;
      if (!placed.every((q) => far(p, q, cfg.minSpacing)) || !sitesNow.every((q) => far(p, q, cfg.minSpacing))) continue;
      placed.push(p);
    }
    placed.forEach((p, j) => w.worship.addSite(cfg.kinds[j % cfg.kinds.length], p.x, p.y, { rewards: [] }));
  }

  // ---------------------------------------------------------------- hash and snapshot
  hashInto(f: Fnv): void {
    if (!this.jobs.length) return;
    f.u32(0x11f1).u32(this.jobs.length);
    for (const j of this.jobs) {
      f.u32(j.x0).u32(j.y0).u32(j.w).u32(j.h).u32(j.stepsLeft).u32(j.next);
      for (const v of j.target) f.u32(v + 1);
    }
  }

  save(): LivingState | null {
    return this.jobs.length ? { jobs: this.jobs.map((j) => ({ ...j, target: j.target.slice() })) } : null;
  }

  load(st: LivingState): void {
    this.jobs = st.jobs.map((j) => ({ ...j, target: j.target.slice() }));
  }
}

// Spell effect primitives (docs/ARCHITECTURE.md section 6). A spell is data: a list of effects with
// parameters, applied at the target. New spells should need no code; a new primitive is registered
// here with a test. Persistent effects (areaOverTime) live as effect entities ticked in step 6.
import type { EffectDef } from "@hearthfall/data";
import { CAT } from "./entities.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import { secondsToTicks } from "./config.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

export interface EffectCtx {
  w: World;
  tribe: number;
  /** spell id (for kill attribution rules like canKill) */
  spell: string;
  x: number;
  y: number;
  casterX: number;
  casterY: number;
}

type EffectFn = (ctx: EffectCtx, e: EffectDef) => void;
export const EFFECTS = new Map<string, EffectFn>();

export function registerEffect(type: string, fn: EffectFn): void {
  EFFECTS.set(type, fn);
}

/** Effect entity kinds (state column of CAT.effect entities). */
export const FX = { area: 1 } as const;

export function applyEffects(ctx: EffectCtx, effects: readonly EffectDef[]): void {
  for (const e of effects) {
    const fn = EFFECTS.get(e.type);
    if (!fn) throw new Error(`no effect primitive registered for "${e.type}"`);
    fn(ctx, e);
  }
}

/** Live entity indices of a category within radius r of (x, y), ascending. */
export function within(w: World, cat: number, x: number, y: number, r: number): number[] {
  const E = w.ents;
  const n = w.terrain.size;
  const out: number[] = [];
  const r2 = r * r;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.cat[i] !== cat) continue;
    if (cat === CAT.unit && E.inside[i] >= 0) continue;
    const dx = wrapDelta(E.x[i] - x, n);
    const dy = wrapDelta(E.y[i] - y, n);
    if (dx * dx + dy * dy <= r2) out.push(i);
  }
  return out;
}

function unitIs(w: World, i: number, ids: readonly string[] | undefined): boolean {
  if (!ids) return false;
  return ids.includes(w.cfg.pack.units.units[w.ents.type[i]].id);
}

registerEffect("damageRadius", (c, e) => {
  if (e.type !== "damageRadius") return;
  const w = c.w;
  const casterH = w.terrain.heightAt(c.casterX, c.casterY);
  for (const i of within(w, CAT.unit, c.x, c.y, e.radius)) {
    if (w.ents.tribe[i] === c.tribe) continue;
    let dmg = e.damage;
    if (e.downhillBonusPct && w.terrain.heightAt(w.ents.x[i], w.ents.y[i]) < casterH) dmg *= 1 + e.downhillBonusPct / 100;
    w.damage(i, dmg, c.tribe, unitIs(w, i, e.canKill));
  }
});

/**
 * Push a unit `travel` cells along (dx, dy) over knockbackTicks with decay (ignores walkability:
 * cliffs and water are the point). Stops its order and breaks a chant (spell interruption).
 */
export function knockUnit(w: World, i: number, dx: number, dy: number, travel: number): void {
  const E = w.ents;
  const ticks = w.cfg.pack.balance.combat.knockbackTicks;
  const decay = w.cfg.pack.balance.combat.knockbackDecay;
  // total travel = v0 * (1 - decay^ticks) / (1 - decay); solve v0 for the wanted travel
  let sum = 0;
  let f = 1;
  for (let k = 0; k < ticks; k++) {
    sum += f;
    f *= decay;
  }
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-6) {
    dx = 1;
    dy = 0;
    d = 1e-6;
  }
  E.kvx[i] = (dx / Math.max(d, 1e-6)) * (travel / sum);
  E.kvy[i] = (dy / Math.max(d, 1e-6)) * (travel / sum);
  E.ktick[i] = ticks;
  w.units.stop(i);
  if (E.chant[i] > 0) w.combat.interruptChant(i, "knockback");
}

registerEffect("knockback", (c, e) => {
  if (e.type !== "knockback") return;
  const w = c.w;
  const E = w.ents;
  const n = w.terrain.size;
  for (const i of within(w, CAT.unit, c.x, c.y, e.radius)) {
    if (E.tribe[i] === c.tribe) continue;
    const dx = wrapDelta(E.x[i] - c.x, n);
    const dy = wrapDelta(E.y[i] - c.y, n);
    const d = Math.sqrt(dx * dx + dy * dy);
    knockUnit(w, i, dx, dy, e.force * (1 - Math.min(1, d / e.radius) * 0.6));
  }
});

registerEffect("convertRadius", (c, e) => {
  if (e.type !== "convertRadius") return;
  const w = c.w;
  const E = w.ents;
  if (c.tribe < 0) return;
  let room = w.economy.popCap(c.tribe) - w.economy.followers(c.tribe);
  let converted = 0;
  const settler = w.cfg.unitIndex.get("settler");
  for (const i of within(w, CAT.unit, c.x, c.y, e.radius)) {
    if (converted >= e.max || room <= 0) break;
    if (E.tribe[i] === c.tribe || unitIs(w, i, e.excludes)) continue;
    if (e.targets && !unitIs(w, i, e.targets)) continue;
    if (!w.cfg.pack.units.units[E.type[i]].convertible) continue;
    const from = E.tribe[i];
    E.tribe[i] = c.tribe;
    // wild people join as settlers; trained troops keep their kind
    if (unitIs(w, i, ["wild"]) && settler !== undefined) {
      E.type[i] = settler;
      E.hp[i] = Math.min(E.hp[i], w.cfg.pack.units.units[settler].hp);
    }
    w.units.stop(i);
    E.task[i] = 0;
    converted++;
    room--;
    w.emit("converted", { id: E.idOf(i), from, to: c.tribe });
  }
});

registerEffect("statusApply", (c, e) => {
  if (e.type !== "statusApply") return;
  const w = c.w;
  const E = w.ents;
  const ticks = secondsToTicks(e.seconds, w.cfg.tickHz);
  let left = e.max ?? Infinity;
  for (const i of within(w, CAT.unit, c.x, c.y, e.radius ?? 1)) {
    if (left-- <= 0) break;
    if (E.tribe[i] === c.tribe) continue;
    if (e.status === "panic") {
      E.panic[i] = Math.max(E.panic[i], ticks);
      E.task[i] = 0;
    } else if (e.status === "burning") E.burn[i] = Math.max(E.burn[i], ticks);
  }
});

registerEffect("terrainOp", (c, e) => {
  if (e.type !== "terrainOp") return;
  const w = c.w;
  const sea = w.terrain.sea;
  void sea;
  switch (e.op) {
    case "ridgeLine": {
      // from the caster toward the target, at most `length` cells
      const n = w.terrain.size;
      let dx = wrapDelta(c.x - c.casterX, n);
      let dy = wrapDelta(c.y - c.casterY, n);
      const d = Math.sqrt(dx * dx + dy * dy);
      const len = Math.min(d, e.length ?? d);
      if (d > 1e-6) {
        dx = (dx / d) * len;
        dy = (dy / d) * len;
      }
      w.terrainQueue.push({ op: "ridgeLine", x: c.casterX, y: c.casterY, x2: c.casterX + dx, y2: c.casterY + dy, width: e.width ?? 2, aboveSea: e.heightAboveSea ?? 24 });
      break;
    }
    case "flattenToAverage":
      w.terrainQueue.push({ op: "flattenToAverage", x: c.x, y: c.y, r: e.radius ?? 4, minAboveSea: e.minHeightAboveSea ?? 0 });
      break;
    case "noiseScar":
      w.terrainQueue.push({ op: "noiseScar", x: c.x, y: c.y, r: e.radius ?? 6, depth: e.depth ?? 20, seed: w.rng.nextU32(0) | 0 });
      break;
    case "crater":
      w.terrainQueue.push({ op: "crater", x: c.x, y: c.y, r: e.radius ?? 6, height: e.height ?? 60, shape: e.shape === "bowl" ? "bowl" : "cone" });
      break;
    case "lowerTowardSea":
      w.terrainQueue.push({ op: "lowerTowardSea", x: c.x, y: c.y, r: e.radius ?? 6, amount: e.depth ?? 12 });
      break;
    case "raise":
      w.terrainQueue.push({ op: "raise", x: c.x, y: c.y, r: e.radius ?? 4, amount: e.height ?? 30 });
      break;
    case "lower":
      w.terrainQueue.push({ op: "lower", x: c.x, y: c.y, r: e.radius ?? 4, amount: e.depth ?? 30 });
      break;
    default:
      throw new Error(`terrainOp ${e.op} is not available to spells`);
  }
});

registerEffect("damageBuildingsRadius", (c, e) => {
  if (e.type !== "damageBuildingsRadius") return;
  const w = c.w;
  for (const i of within(w, CAT.building, c.x, c.y, e.radius)) {
    if (w.ents.tribe[i] === c.tribe) continue;
    const def = w.cfg.pack.buildings.buildings[w.ents.type[i]];
    w.damage(i, ((def.hp ?? 1000) * e.damagePct) / 100, c.tribe, true);
  }
});

registerEffect("scar", (c, e) => {
  if (e.type !== "scar") return;
  c.w.terrainQueue.push({ op: "scar", x: c.x, y: c.y, r: e.radius, seconds: Math.min(65535, Math.round(e.healSeconds)) });
});

registerEffect("areaOverTime", (c, e) => {
  if (e.type !== "areaOverTime") return;
  const w = c.w;
  const id = w.ents.alloc(CAT.effect, 0, c.tribe, c.x, c.y, 1);
  const i = w.ents.index(id);
  w.ents.state[i] = FX.area;
  w.ents.progress[i] = e.radius;
  w.ents.progress2[i] = e.damagePerSecond / w.cfg.tickHz;
  w.ents.timer[i] = secondsToTicks(e.seconds, w.cfg.tickHz);
  w.ents.type[i] = w.cfg.spellIndex.get(c.spell) ?? 0;
  w.emit("effectStarted", { id, tribe: c.tribe, spell: c.spell, x: c.x, y: c.y, r: e.radius });
});

registerEffect("spawnEntity", (c, e) => {
  if (e.type !== "spawnEntity") return;
  const w = c.w;
  const def = w.cfg.pack.spells.entities.find((x) => x.id === e.entity);
  if (!def) throw new Error(`unknown spawnable entity ${e.entity}`);
  const n = w.terrain.size;
  const r = e.radius ?? 4;
  for (let k = 0; k < (e.count ?? 1); k++) {
    const a = w.rng.float("combat") * TWO_PI;
    const d = Math.sqrt(w.rng.float("combat")) * r;
    const x = (((c.x + cos(a) * d) % n) + n) % n;
    const y = (((c.y + sin(a) * d) % n) + n) % n;
    applyEffects({ ...c, spell: c.spell, x, y }, def.effects);
  }
});

/** Step 6: tick persistent effect entities and unit statuses (burning damage). */
export function updateEffects(w: World): void {
  const E = w.ents;
  const burnPerTick = w.cfg.pack.balance.statuses.burning.damagePerSecond / w.cfg.tickHz;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    if (E.cat[i] === CAT.effect) {
      if (E.state[i] === FX.area) {
        for (const u of within(w, CAT.unit, E.x[i], E.y[i], E.progress[i])) if (E.tribe[u] !== E.tribe[i]) w.damage(u, E.progress2[i], E.tribe[i], false);
      }
      if (--E.timer[i] <= 0) {
        w.emit("effectEnded", { id: E.idOf(i) });
        E.free(E.idOf(i));
      }
      continue;
    }
    if (E.cat[i] === CAT.unit && E.burn[i] > 0) {
      E.burn[i]--;
      w.damage(i, burnPerTick, -1, false);
    }
  }
}

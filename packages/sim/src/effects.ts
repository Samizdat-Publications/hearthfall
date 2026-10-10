// Spell effect primitives (docs/ARCHITECTURE.md section 6). A spell is data: a list of effects with
// parameters, applied at the target. New spells should need no code; a new primitive is registered
// here with a test. Persistent effects (areaOverTime) live as effect entities ticked in step 6.
import type { EffectDef } from "@hearthfall/data";
import { CAT, NO_ENTITY } from "./entities.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import { secondsToTicks } from "./config.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";
import { STREAMS } from "./rng.ts";

export interface EffectCtx {
  w: World;
  tribe: number;
  /** spell id (for kill attribution rules like canKill) */
  spell: string;
  x: number;
  y: number;
  casterX: number;
  casterY: number;
  /** apply a terrainOp now even when it has a lead-in (the lead-in effect entity firing) */
  now?: boolean;
}

type EffectFn = (ctx: EffectCtx, e: EffectDef) => void;
export const EFFECTS = new Map<string, EffectFn>();

export function registerEffect(type: string, fn: EffectFn): void {
  EFFECTS.set(type, fn);
}

/**
 * Effect entity kinds (state column of CAT.effect entities). Columns: type = spell index (its effect
 * data is read back each tick), progress = radius, timer = ticks left; per kind: storm level = impacts
 * left; mover ax, ay = heading; trap level = kills left; wraith level = kills, target = hunted unit,
 * cd = ticks to the next kill; erode progress2 = depth per step; leadIn (BACKLOG 36) holds a terrainOp
 * with `leadInSeconds` until its timer runs out, ax, ay = the caster position at the cast.
 */
export const FX = { area: 1, erode: 2, storm: 3, mover: 4, trap: 5, wraith: 6, leadIn: 7 } as const;

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
  const pops = wardPoppers(w).has(c.spell);
  for (const i of within(w, CAT.unit, c.x, c.y, e.radius)) {
    if (w.ents.tribe[i] === c.tribe) continue;
    if (pops && w.ents.ward[i] > 0) {
      w.ents.ward[i] = 0;
      w.emit("wardPopped", { id: w.ents.idOf(i), by: c.spell, x: w.ents.x[i], y: w.ents.y[i] });
    }
    let dmg = e.damage;
    if (e.downhillBonusPct && w.terrain.heightAt(w.ents.x[i], w.ents.y[i]) < casterH) dmg *= 1 + e.downhillBonusPct / 100;
    w.damage(i, dmg, c.tribe, unitIs(w, i, e.canKill));
  }
});

/**
 * Push a unit `travel` cells along (dx, dy) over knockbackTicks with decay (ignores walkability:
 * cliffs and water are the point). Stops its order and breaks a chant (spell interruption); a ranged
 * hit's knock (`hit`) does not move a channelling breakDamage Chanter (BACKLOG 65).
 */
export function knockUnit(w: World, i: number, dx: number, dy: number, travel: number, hit = false): void {
  const E = w.ents;
  // Ward: a shielded unit does not move
  if (E.ward[i] > 0) return;
  // BACKLOG 65: a channelling breakDamage Chanter is rooted against ranged hits (the damage counts instead)
  const rooted = hit && E.chant[i] > 0 && !!w.cfg.pack.units.units[E.type[i]].convert?.breakDamage;
  if (rooted) return;
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
    knockUnit(w, i, dx, dy, e.force * (1 - Math.min(1, d / e.radius) * e.edgeFalloff));
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

/** A field the pack cross-check guarantees (packages/data crossCheck); throws instead of guessing. */
function need(v: number | undefined, what: string): number {
  if (v === undefined) throw new Error(`spell data is missing ${what}`);
  return v;
}

/** Spell ids that strip a Ward (statusApply ward poppedBy), cached per pack. */
const poppers = new WeakMap<object, Set<string>>();
function wardPoppers(w: World): Set<string> {
  const key = w.cfg.pack.spells;
  let s = poppers.get(key);
  if (!s) {
    s = new Set<string>();
    for (const sp of key.spells) for (const e of sp.effects) if (e.type === "statusApply" && e.status === "ward") for (const p of e.poppedBy ?? []) s.add(p);
    poppers.set(key, s);
  }
  return s;
}

const isCasterUnit = (w: World, i: number) => w.cfg.pack.units.units[w.ents.type[i]].isCaster === true;

registerEffect("statusApply", (c, e) => {
  if (e.type !== "statusApply") return;
  const w = c.w;
  const E = w.ents;
  const ticks = secondsToTicks(e.seconds, w.cfg.tickHz);
  const own = e.targets === "own";
  let left = e.max ?? Infinity;
  for (const i of within(w, CAT.unit, c.x, c.y, need(e.radius, "statusApply radius"))) {
    // own-target statuses land on the caster's units, the rest on everyone else; only those count against max
    if (own ? E.tribe[i] !== c.tribe : E.tribe[i] === c.tribe) continue;
    if (e.status === "beguiled" && (E.tribe[i] < 0 || isCasterUnit(w, i) || E.beguile[i] > 0)) continue;
    // a boat or balloon is never beguiled (its riders would sail for the enemy) and never panics (D+F review)
    if ((e.status === "beguiled" || e.status === "panic") && w.vehicles.isVehicle(i)) continue;
    if (left-- <= 0) break;
    switch (e.status) {
      case "panic":
        E.panic[i] = Math.max(E.panic[i], ticks);
        E.task[i] = 0;
        break;
      case "burning":
        E.burn[i] = Math.max(E.burn[i], ticks);
        break;
      case "veil":
        E.veil[i] = Math.max(E.veil[i], ticks);
        w.emit("veiled", { id: E.idOf(i), tribe: c.tribe, x: E.x[i], y: E.y[i] });
        break;
      case "ward":
        E.ward[i] = Math.max(E.ward[i], ticks);
        w.emit("warded", { id: E.idOf(i), tribe: c.tribe, x: E.x[i], y: E.y[i] });
        break;
      case "beguiled": {
        const from = E.tribe[i];
        w.combat.convertUnit(i, c.tribe);
        E.home[i] = from;
        E.beguile[i] = ticks;
        w.emit("beguiled", { id: E.idOf(i), from, to: c.tribe, x: E.x[i], y: E.y[i] });
        break;
      }
      default:
        throw new Error(`statusApply ${e.status} is not a spell status`);
    }
  }
});

/** A beguiled unit goes back to its tribe (or turns wild when that tribe is gone). */
export function endBeguile(w: World, i: number, reason: string): void {
  const E = w.ents;
  const home = E.home[i];
  const back = home >= 0 && w.tribes[home]?.alive ? home : -1;
  w.combat.convertUnit(i, back);
  if (back < 0) w.combat.makeWild(i);
  w.emit("beguileEnded", { id: E.idOf(i), to: back, reason });
}

/** Beguile breaks when the caster tribe's Shaper dies: every unit it holds returns at once. */
export function breakBeguiles(w: World, tribe: number): void {
  const E = w.ents;
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.beguile[i] > 0 && E.tribe[i] === tribe) endBeguile(w, i, "casterDied");
}

registerEffect("terrainOp", (c, e) => {
  if (e.type !== "terrainOp") return;
  const w = c.w;
  if (e.leadInSeconds !== undefined && !c.now) {
    // rumble first: an effect entity applies the op when its timer runs out (updateEffects)
    const ticks = secondsToTicks(e.leadInSeconds, w.cfg.tickHz);
    const i = fxEntity(c, FX.leadIn, e.radius ?? 1, ticks + 1);
    w.ents.ax[i] = c.casterX;
    w.ents.ay[i] = c.casterY;
    w.emit("terrainLeadIn", { id: w.ents.idOf(i), tribe: c.tribe, spell: c.spell, x: c.x, y: c.y, r: e.radius ?? 1, seconds: e.leadInSeconds });
    return;
  }
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
      w.terrainQueue.push({ op: "ridgeLine", x: c.casterX, y: c.casterY, x2: c.casterX + dx, y2: c.casterY + dy, width: need(e.width, "ridgeLine width"), aboveSea: need(e.heightAboveSea, "ridgeLine heightAboveSea") });
      break;
    }
    case "flattenToAverage":
      w.terrainQueue.push({ op: "flattenToAverage", x: c.x, y: c.y, r: need(e.radius, "flattenToAverage radius"), minAboveSea: e.minHeightAboveSea ?? 0 });
      break;
    case "noiseScar":
      w.terrainQueue.push({ op: "noiseScar", x: c.x, y: c.y, r: need(e.radius, "noiseScar radius"), depth: need(e.depth, "noiseScar depth"), seed: w.rng.nextU32(STREAMS.terrain) | 0 });
      break;
    case "crater":
      w.terrainQueue.push({ op: "crater", x: c.x, y: c.y, r: need(e.radius, "crater radius"), height: need(e.height, "crater height"), shape: e.shape === "bowl" ? "bowl" : "cone" });
      break;
    case "lowerTowardSea":
      if (e.seconds !== undefined) {
        // Erode: an effect entity applies `depth` once per second for `seconds` (the first step now)
        const r = need(e.radius, "lowerTowardSea radius");
        const i = fxEntity(c, FX.erode, r, secondsToTicks(e.seconds, w.cfg.tickHz));
        w.ents.progress2[i] = need(e.depth, "lowerTowardSea depth");
        w.terrainQueue.push({ op: "lowerTowardSea", x: c.x, y: c.y, r, amount: w.ents.progress2[i] });
        break;
      }
      w.terrainQueue.push({ op: "lowerTowardSea", x: c.x, y: c.y, r: need(e.radius, "lowerTowardSea radius"), amount: need(e.depth, "lowerTowardSea depth") });
      break;
    case "raise":
      w.terrainQueue.push({ op: "raise", x: c.x, y: c.y, r: need(e.radius, "raise radius"), amount: need(e.height, "raise height") });
      break;
    case "lower":
      w.terrainQueue.push({ op: "lower", x: c.x, y: c.y, r: need(e.radius, "lower radius"), amount: need(e.depth, "lower depth") });
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
    w.damage(i, (def.hp * e.damagePct) / 100, c.tribe, true);
  }
});

registerEffect("scar", (c, e) => {
  if (e.type !== "scar") return;
  c.w.terrainQueue.push({ op: "scar", x: c.x, y: c.y, r: e.radius, seconds: Math.min(65535, Math.round(e.healSeconds)) });
});

/** Allocate a persistent effect entity of a kind at the target; returns its index. */
function fxEntity(c: EffectCtx, kind: number, r: number, ticks: number): number {
  const w = c.w;
  const id = w.ents.alloc(CAT.effect, 0, c.tribe, c.x, c.y, 1);
  const i = w.ents.index(id);
  w.ents.state[i] = kind;
  w.ents.progress[i] = r;
  w.ents.timer[i] = ticks;
  w.ents.type[i] = w.cfg.spellIndex.get(c.spell) ?? 0;
  w.emit("effectStarted", { id, tribe: c.tribe, spell: c.spell, x: c.x, y: c.y, r });
  return i;
}

registerEffect("areaOverTime", (c, e) => {
  if (e.type !== "areaOverTime") return;
  const w = c.w;
  const i = fxEntity(c, FX.area, e.radius, secondsToTicks(e.seconds, w.cfg.tickHz));
  w.ents.progress2[i] = e.damagePerSecond / w.cfg.tickHz;
});

registerEffect("projectileStorm", (c, e) => {
  if (e.type !== "projectileStorm") return;
  const i = fxEntity(c, FX.storm, e.radius, secondsToTicks(e.seconds, c.w.cfg.tickHz));
  c.w.ents.level[i] = Math.min(255, e.count);
});

registerEffect("moverPath", (c, e) => {
  if (e.type !== "moverPath") return;
  const w = c.w;
  const i = fxEntity(c, FX.mover, e.radius, secondsToTicks(e.seconds, w.cfg.tickHz));
  // heading: away from the caster (straight on from the cast), a random one when cast on the spot
  const n = w.terrain.size;
  let dx = wrapDelta(c.x - c.casterX, n);
  let dy = wrapDelta(c.y - c.casterY, n);
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.5) {
    const a = w.rng.float("combat") * TWO_PI;
    dx = cos(a);
    dy = sin(a);
    d = 1;
  }
  w.ents.ax[i] = dx / d;
  w.ents.ay[i] = dy / d;
});

registerEffect("trap", (c, e) => {
  if (e.type !== "trap") return;
  const i = fxEntity(c, FX.trap, e.radius, secondsToTicks(e.seconds, c.w.cfg.tickHz));
  c.w.ents.level[i] = Math.min(255, e.kills);
});

registerEffect("summon", (c, e) => {
  if (e.type !== "summon") return;
  const i = fxEntity(c, FX.wraith, 0.6, secondsToTicks(e.seconds, c.w.cfg.tickHz));
  c.w.ents.target[i] = NO_ENTITY;
  c.w.ents.level[i] = 0;
  c.w.ents.cd[i] = 0;
});

registerEffect("spawnEntity", (c, e) => {
  if (e.type !== "spawnEntity") return;
  const w = c.w;
  const def = w.cfg.pack.spells.entities.find((x) => x.id === e.entity);
  if (!def) throw new Error(`unknown spawnable entity ${e.entity}`);
  const n = w.terrain.size;
  const r = need(e.radius, "spawnEntity radius");
  for (let k = 0; k < (e.count ?? 1); k++) {
    const a = w.rng.float("combat") * TWO_PI;
    const d = Math.sqrt(w.rng.float("combat")) * r;
    const x = (((c.x + cos(a) * d) % n) + n) % n;
    const y = (((c.y + sin(a) * d) % n) + n) % n;
    applyEffects({ ...c, spell: c.spell, x, y }, def.effects);
  }
});

/** The spell's effect of a given type behind effect entity i (data is read back, never copied). */
function effectOf<T extends EffectDef["type"]>(w: World, i: number, type: T): Extract<EffectDef, { type: T }> {
  const sp = w.cfg.pack.spells.spells[w.ents.type[i]];
  const e = sp?.effects.find((x) => x.type === type);
  if (!e) throw new Error(`effect entity of ${sp?.id ?? "?"} has no ${type} effect`);
  return e as Extract<EffectDef, { type: T }>;
}

/** Firerain: one impact at a random point in the storm radius. */
function stormImpact(w: World, i: number): void {
  const E = w.ents;
  const e = effectOf(w, i, "projectileStorm");
  const n = w.terrain.size;
  const a = w.rng.float("combat") * TWO_PI;
  const d = Math.sqrt(w.rng.float("combat")) * e.radius;
  const x = (((E.x[i] + cos(a) * d) % n) + n) % n;
  const y = (((E.y[i] + sin(a) * d) % n) + n) % n;
  const tr = E.tribe[i];
  w.emit("meteor", { tribe: tr, x, y, r: e.impactRadius });
  for (const u of within(w, CAT.unit, x, y, e.impactRadius)) {
    if (E.tribe[u] === tr) continue;
    w.damage(u, e.damage, tr, false);
    if (e.knockback && E.alive[u]) knockUnit(w, u, wrapDelta(E.x[u] - x, n), wrapDelta(E.y[u] - y, n), e.knockback);
  }
  for (const b of within(w, CAT.building, x, y, e.impactRadius)) if (E.tribe[b] !== tr) w.damage(b, e.damage, tr, true);
}

/** Whirlwind: wander, fling the units it touches, wear down buildings. */
function moverStep(w: World, i: number): void {
  const E = w.ents;
  const e = effectOf(w, i, "moverPath");
  const n = w.terrain.size;
  const hz = w.cfg.tickHz;
  if (e.wander && w.tick % hz === 0) {
    // a new heading each second, at most about 40 degrees off the old one
    const turn = (w.rng.float("combat") - 0.5) * 1.4;
    const c0 = cos(turn);
    const s0 = sin(turn);
    const ax = E.ax[i] * c0 - E.ay[i] * s0;
    const ay = E.ax[i] * s0 + E.ay[i] * c0;
    E.ax[i] = ax;
    E.ay[i] = ay;
  }
  E.x[i] = (((E.x[i] + (E.ax[i] * e.speed) / hz) % n) + n) % n;
  E.y[i] = (((E.y[i] + (E.ay[i] * e.speed) / hz) % n) + n) % n;
  const tr = E.tribe[i];
  for (const u of within(w, CAT.unit, E.x[i], E.y[i], e.radius)) {
    // the caster's own units are spared; a unit still flying from a fling is not flung again
    if (E.tribe[u] === tr || E.ktick[u] > 0) continue;
    const dx = wrapDelta(E.x[u] - E.x[i], n);
    const dy = wrapDelta(E.y[u] - E.y[i], n);
    // out and round: the outward push plus a quarter turn along the spin
    knockUnit(w, u, dx - dy * 0.8, dy + dx * 0.8, e.flingForce);
    w.emit("flung", { id: E.idOf(u), x: E.x[u], y: E.y[u] });
  }
  if (e.buildingDamagePctPerSecond) {
    for (const b of within(w, CAT.building, E.x[i], E.y[i], e.radius + 0.5)) {
      if (E.tribe[b] === tr) continue;
      const def = w.cfg.pack.buildings.buildings[E.type[b]];
      w.damage(b, (def.hp * e.buildingDamagePctPerSecond) / 100 / hz, tr, true);
    }
  }
}

/** Mire: swallows units of other tribes standing in it (never a caster) until its kills run out. */
function trapStep(w: World, i: number): void {
  const E = w.ents;
  const tr = E.tribe[i];
  for (const u of within(w, CAT.unit, E.x[i], E.y[i], E.progress[i])) {
    if (E.level[i] === 0) break;
    if (E.tribe[u] === tr || isCasterUnit(w, u)) continue;
    E.level[i]--;
    w.emit("mired", { id: E.idOf(u), x: E.x[u], y: E.y[u], tribe: E.tribe[u] });
    E.lastHit[u] = tr;
    w.kill(u, "killed");
  }
  if (E.level[i] === 0) E.timer[i] = 1;
}

/** Wraith: fly to the nearest enemy unit within huntRadius (never a caster, never veiled) and kill it. */
function wraithStep(w: World, i: number): void {
  const E = w.ents;
  const e = effectOf(w, i, "summon");
  const n = w.terrain.size;
  const hz = w.cfg.tickHz;
  const tr = E.tribe[i];
  if (E.cd[i] > 0) E.cd[i]--;
  let t = E.target[i] === NO_ENTITY ? -1 : E.index(E.target[i]);
  const huntable = (u: number) => u >= 0 && E.alive[u] && E.cat[u] === CAT.unit && E.inside[u] < 0 && E.tribe[u] >= 0 && E.tribe[u] !== tr && E.veil[u] === 0 && !w.combat.disguised(u) && E.ward[u] === 0 && !isCasterUnit(w, u) && !w.vehicles.isVehicle(u);
  if (!huntable(t) || w.tick % hz === 0) {
    let best = -1;
    let bd = e.huntRadius * e.huntRadius;
    for (const u of within(w, CAT.unit, E.x[i], E.y[i], e.huntRadius)) {
      if (!huntable(u)) continue;
      const dx = wrapDelta(E.x[u] - E.x[i], n);
      const dy = wrapDelta(E.y[u] - E.y[i], n);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = u;
      }
    }
    t = best;
    E.target[i] = t >= 0 ? E.idOf(t) : NO_ENTITY;
  }
  if (t < 0) return;
  const dx = wrapDelta(E.x[t] - E.x[i], n);
  const dy = wrapDelta(E.y[t] - E.y[i], n);
  const d = Math.sqrt(dx * dx + dy * dy);
  const step = e.speed / hz;
  if (d > 0.6) {
    const k = Math.min(1, step / d);
    E.x[i] = (((E.x[i] + dx * k) % n) + n) % n;
    E.y[i] = (((E.y[i] + dy * k) % n) + n) % n;
    return;
  }
  if (E.cd[i] > 0) return;
  w.emit("wraithKill", { id: E.idOf(t), x: E.x[t], y: E.y[t], tribe: E.tribe[t] });
  E.lastHit[t] = tr;
  w.kill(t, "killed");
  E.target[i] = NO_ENTITY;
  E.cd[i] = secondsToTicks(e.killSeconds, hz);
  E.level[i]++;
  if (E.level[i] >= e.maxKills) E.timer[i] = 1;
}

/** Step 6: tick persistent effect entities, unit statuses (burning damage, Veil, Ward, Beguile, a Shade's
 * reveal) and buildings on fire (BACKLOG 2). */
export function updateEffects(w: World): void {
  const E = w.ents;
  const hz = w.cfg.tickHz;
  const burnPerTick = w.cfg.pack.balance.statuses.burning.damagePerSecond / hz;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    if (E.cat[i] === CAT.effect) {
      switch (E.state[i]) {
        case FX.area:
          for (const u of within(w, CAT.unit, E.x[i], E.y[i], E.progress[i])) if (E.tribe[u] !== E.tribe[i]) w.damage(u, E.progress2[i], E.tribe[i], false);
          break;
        case FX.erode:
          // the first step went in at the cast; one more each full second while time is left
          if (E.timer[i] > 1 && (E.timer[i] - 1) % hz === 0) w.terrainQueue.push({ op: "lowerTowardSea", x: E.x[i], y: E.y[i], r: E.progress[i], amount: E.progress2[i] });
          break;
        case FX.storm: {
          // impacts spread evenly over the storm: one whenever the share of time left falls below the share of impacts left
          const total = secondsToTicks(effectOf(w, i, "projectileStorm").seconds, hz);
          const count = effectOf(w, i, "projectileStorm").count;
          while (E.level[i] > 0 && (E.level[i] - 1) * total >= (E.timer[i] - 1) * count) {
            E.level[i]--;
            stormImpact(w, i);
          }
          break;
        }
        case FX.mover:
          moverStep(w, i);
          break;
        case FX.trap:
          trapStep(w, i);
          break;
        case FX.wraith:
          wraithStep(w, i);
          break;
        case FX.leadIn:
          if (E.timer[i] === 1) {
            const sp = w.cfg.pack.spells.spells[E.type[i]];
            const ctx: EffectCtx = { w, tribe: E.tribe[i], spell: sp.id, x: E.x[i], y: E.y[i], casterX: E.ax[i], casterY: E.ay[i], now: true };
            EFFECTS.get("terrainOp")!(ctx, effectOf(w, i, "terrainOp"));
            w.emit("terrainMoved", { tribe: E.tribe[i], spell: sp.id, x: E.x[i], y: E.y[i], r: E.progress[i] });
          }
          break;
      }
      if (--E.timer[i] <= 0) {
        w.emit("effectEnded", { id: E.idOf(i) });
        E.free(E.idOf(i));
      }
      continue;
    }
    if (E.cat[i] === CAT.building) {
      // set alight by a Shade: a share of the full hp each second, credited to the tribe that lit it
      if (E.burn[i] > 0) {
        E.burn[i]--;
        const def = w.cfg.pack.buildings.buildings[E.type[i]];
        w.damage(i, (def.hp * (w.cfg.pack.balance.statuses.buildingFire?.hpPctPerSecond ?? 6)) / 100 / hz, E.lastHit[i], false);
      }
      continue;
    }
    if (E.cat[i] !== CAT.unit) continue;
    if (E.burn[i] > 0) {
      E.burn[i]--;
      w.damage(i, burnPerTick, -1, false);
      if (!E.alive[i]) continue;
    }
    if (E.reveal[i] > 0) E.reveal[i]--;
    if (E.veil[i] > 0) E.veil[i]--;
    if (E.ward[i] > 0) E.ward[i]--;
    if (E.beguile[i] > 0 && --E.beguile[i] === 0) endBeguile(w, i, "expired");
  }
}

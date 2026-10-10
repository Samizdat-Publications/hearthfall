// Casting and the Shaper's life cycle (M5): the cast command (walks into range, then a short cast
// window during which cancelCast refunds the charge), resolution through effect primitives,
// death and respawn at the Hearth, charge steal for the killer, and the elimination rule.
import { CAT, NO_ENTITY } from "./entities.ts";
import { registerCommand } from "./commands.ts";
import { secondsToTicks } from "./config.ts";
import { applyEffects, breakBeguiles } from "./effects.ts";
import { ORDER } from "./units.ts";
import { wrapDelta } from "./terrain.ts";
import type { World } from "./world.ts";

export interface CastState {
  spell: number;
  x: number;
  y: number;
  startedAt: number;
  resolveAt: number;
}

export interface PendingCast {
  spell: number;
  x: number;
  y: number;
  /** distance to the target when the Shaper was last ordered there; a stop without progress drops the cast */
  best: number;
  /** where she walks: the target, or the nearest reachable point within range of it (BACKLOG 62) */
  ax: number;
  ay: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function shaperIndex(w: World, tribe: number): number {
  const t = w.tribes[tribe];
  return t ? w.ents.index(t.shaper) : -1;
}

function distTo(w: World, i: number, x: number, y: number): number {
  const n = w.terrain.size;
  const dx = wrapDelta(x - w.ents.x[i], n);
  const dy = wrapDelta(y - w.ents.y[i], n);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * BACKLOG 62: where the Shaper walks to cast at (x, y). The target itself when its snapped vertex is on her
 * landmass; else the cell of her landmass within range - 1 of the target nearest to her (over water, an
 * island, across a cliff); null when no such cell exists, so the cast fails at once instead of walking off.
 */
function approachPoint(w: World, si: number, x: number, y: number, range: number): [number, number] | null {
  const E = w.ents;
  const n = w.terrain.size;
  const pf = w.units.pfOf(si);
  pf.refresh();
  const snap = w.cfg.pack.balance.movement.snapRadius;
  const v = (px: number, py: number) => (((Math.round(px) % n) + n) % n) + (((Math.round(py) % n) + n) % n) * n;
  const here = pf.nearestWalkable(v(E.x[si], E.y[si]), snap);
  if (here < 0) return null;
  const home = pf.comp[here];
  const goal = pf.nearestWalkable(v(x, y), snap);
  if (goal >= 0 && pf.comp[goal] === home) return [x, y];
  const r = Math.floor(range - 1);
  const cx = Math.round(x);
  const cy = Math.round(y);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const k = v(cx + dx, cy + dy);
      if (pf.comp[k] !== home) continue;
      const d = distTo(w, si, k % n, (k - (k % n)) / n);
      if (d < best) {
        best = d;
        bx = k % n;
        by = (k - (k % n)) / n;
      }
    }
  return best < Infinity ? [bx, by] : null;
}

function beginCast(w: World, tribe: number, spell: number, x: number, y: number): void {
  const t = w.tribes[tribe];
  const s = w.cfg.pack.spells;
  t.eco.charges[spell]--;
  const castTicks = secondsToTicks(s.chargeRules.castSeconds, w.cfg.tickHz);
  t.casting = { spell, x, y, startedAt: w.tick, resolveAt: w.tick + castTicks };
  t.pending = null;
  const si = shaperIndex(w, tribe);
  if (si >= 0) w.units.stop(si);
  w.emit("castBegun", { tribe, spell: s.spells[spell].id, x, y });
}

registerCommand("cast", {
  validate(w, c) {
    if (c.tribe < 0 || !w.tribes[c.tribe]?.alive) return "no living tribe";
    const s = w.cfg.spellIndex.get(String(c.args.spell));
    if (s === undefined) return `unknown spell ${String(c.args.spell)}`;
    const t = w.tribes[c.tribe];
    // a locked spell can still be cast from one-shot charges (shrine rewards, M9)
    if (!t.eco.unlocked[s] && t.eco.charges[s] <= 0) return "spell not unlocked";
    if (t.eco.charges[s] <= 0) return "no charge";
    if (t.casting) return "already casting";
    if (shaperIndex(w, c.tribe) < 0) return "the Shaper is dead";
    const tg = c.args.target;
    if (!Array.isArray(tg) || tg.length !== 2 || !finite(tg[0]) || !finite(tg[1])) return "cast needs target: [x, y]";
    return null;
  },
  apply(w, c) {
    const s = w.cfg.spellIndex.get(String(c.args.spell))!;
    const n = w.terrain.size;
    const [tx, ty] = c.args.target as [number, number];
    const x = ((tx % n) + n) % n;
    const y = ((ty % n) + n) % n;
    const si = shaperIndex(w, c.tribe);
    const range = w.cfg.pack.spells.spells[s].range;
    if (distTo(w, si, x, y) <= range) {
      beginCast(w, c.tribe, s, x, y);
      return;
    }
    const at = approachPoint(w, si, x, y, range);
    if (!at) {
      w.emit("castFailed", { tribe: c.tribe, spell: w.cfg.pack.spells.spells[s].id, reason: "unreachable" });
      return;
    }
    w.tribes[c.tribe].pending = { spell: s, x, y, best: distTo(w, si, x, y), ax: at[0], ay: at[1] };
    w.units.order([si], at[0], at[1]);
    w.emit("castQueued", { tribe: c.tribe, spell: w.cfg.pack.spells.spells[s].id });
  },
});

/** God mode (sandbox, scenarios): give a tribe spell charges. args {tribe, spell, n}. */
registerCommand("grantCharges", {
  validate(w, c) {
    if (c.tribe !== -1 && !w.godMode) return "grantCharges is god mode only";
    const s = w.cfg.spellIndex.get(String(c.args.spell));
    const t = Number(c.args.tribe);
    if (s === undefined || !w.tribes[t] || !finite(c.args.n)) return "grantCharges needs tribe, spell, n";
    return null;
  },
  apply(w, c) {
    const s = w.cfg.spellIndex.get(String(c.args.spell))!;
    const e = w.tribes[Number(c.args.tribe)].eco;
    e.unlocked[s] = 1;
    e.charges[s] = Math.min(w.cfg.pack.spells.spells[s].maxCharges, e.charges[s] + Math.max(0, Math.floor(c.args.n as number)));
  },
});

/** Debug and tests (M8 e2e forced win): kill a tribe's Shaper and Hearth; step 6 then eliminates it. God mode only. */
registerCommand("eliminate", {
  validate(w, c) {
    if (c.tribe !== -1 && !w.godMode) return "eliminate is god mode only";
    const t = w.tribes[Number(c.args.tribe)];
    if (!t) return "no tribe";
    return t.alive ? null : "tribe already eliminated";
  },
  apply(w, c) {
    const t = w.tribes[Number(c.args.tribe)];
    const si = shaperIndex(w, t.index);
    if (si >= 0) w.kill(si, "killed");
    const h = w.ents.index(t.hearth);
    if (h >= 0) w.kill(h, "destroyed");
  },
});

/** Undo a misclick: refunds the charge while the cast window is still open; also drops a queued cast. */
registerCommand("cancelCast", {
  validate(w, c) {
    const t = w.tribes[c.tribe];
    if (!t) return "no tribe";
    if (t.pending) return null;
    if (!t.casting) return "nothing to cancel";
    const undo = secondsToTicks(w.cfg.pack.spells.chargeRules.undoSeconds, w.cfg.tickHz);
    return w.tick - t.casting.startedAt <= undo ? null : "too late to undo";
  },
  apply(w, c) {
    const t = w.tribes[c.tribe];
    if (t.casting) {
      t.eco.charges[t.casting.spell]++;
      w.emit("castCancelled", { tribe: c.tribe, spell: w.cfg.pack.spells.spells[t.casting.spell].id });
      t.casting = null;
    }
    t.pending = null;
  },
});

/** Step 6 (before effects tick): queued casts, resolving casts, respawns, eliminations. */
export function updateSpells(w: World): void {
  const spells = w.cfg.pack.spells.spells;
  for (const t of w.tribes) {
    const si = shaperIndex(w, t.index);
    // queued cast: cast as soon as the Shaper is in range
    if (t.pending && si >= 0) {
      const p = t.pending;
      if (t.eco.charges[p.spell] <= 0) t.pending = null;
      else if (distTo(w, si, p.x, p.y) <= spells[p.spell].range) beginCast(w, t.index, p.spell, p.x, p.y);
      else if (w.ents.order[si] === ORDER.none) {
        // she stopped short: walk on while each leg gets closer, else the target is unreachable
        const d = distTo(w, si, p.x, p.y);
        if (d < p.best - 0.5) {
          p.best = d;
          w.units.order([si], p.ax ?? p.x, p.ay ?? p.y);
        } else {
          t.pending = null;
          w.emit("castFailed", { tribe: t.index, spell: spells[p.spell].id, reason: "unreachable" });
        }
      }
    }
    // resolve
    if (t.casting && w.tick >= t.casting.resolveAt) {
      const c = t.casting;
      t.casting = null;
      if (si >= 0) {
        applyEffects({ w, tribe: t.index, spell: spells[c.spell].id, x: c.x, y: c.y, casterX: w.ents.x[si], casterY: w.ents.y[si] }, spells[c.spell].effects);
        w.emit("spellCast", { tribe: t.index, spell: spells[c.spell].id, x: c.x, y: c.y, cx: w.ents.x[si], cy: w.ents.y[si] });
      }
    }
    // respawn at the Hearth
    if (si < 0 && t.respawnAt >= 0 && w.tick >= t.respawnAt) {
      const h = w.ents.index(t.hearth);
      if (h >= 0) {
        const [dx, dy] = w.economy.doorOf(h);
        w.spawnUnit("shaper", t.index, dx, dy);
        t.respawnAt = -1;
        w.emit("shaperRespawned", { tribe: t.index });
      }
    }
    // elimination: Shaper dead and (Hearth destroyed or no followers left)
    if (t.alive && shaperIndex(w, t.index) < 0) {
      const hearthGone = w.ents.index(t.hearth) < 0;
      if (hearthGone || w.economy.followers(t.index) === 0) {
        t.alive = false;
        t.pending = null;
        t.casting = null;
        t.respawnAt = -1;
        w.emit("tribeEliminated", { tribe: t.index });
        // a tribe that never had a Hearth (test fixtures) keeps its units
        if (t.hearth !== NO_ENTITY) w.combat.releaseTribe(t.index);
      }
    }
  }
}

/** Called by World.kill when a Shaper dies: respawn timer, cast lost, charge steal for the killer. */
export function onShaperDeath(w: World, tribe: number, drowned: boolean, killer: number): void {
  const t = w.tribes[tribe];
  if (!t) return;
  const def = w.cfg.pack.units.units[w.cfg.unitIndex.get("shaper")!];
  if (!def.respawn) throw new Error("the Shaper needs respawn timings (units.json)");
  const secs = drowned ? def.respawn.drownedSeconds : def.respawn.seconds;
  t.respawnAt = w.tick + secondsToTicks(secs, w.cfg.tickHz);
  t.shaper = NO_ENTITY;
  t.casting = null;
  t.pending = null;
  w.emit("shaperDied", { tribe, killer, drowned: drowned ? 1 : 0 });
  // Beguile breaks on the caster's death (DESIGN section 6 anti-degenerate rule)
  breakBeguiles(w, tribe);
  if (killer < 0 || killer === tribe || !w.tribes[killer]) return;
  const pct = w.cfg.pack.spells.chargeRules.killChargeStealPct;
  const spells = w.cfg.pack.spells.spells;
  // the killer gains pct of the total stored charge value; the victim loses whole charges worth at
  // least that much, most expensive first (ties by spell index)
  let stored = 0;
  for (let s = 0; s < spells.length; s++) stored += t.eco.charges[s] * spells[s].cost;
  const mana = Math.floor((stored * pct) / 100);
  let owed = mana;
  const order = spells.map((_, s) => s).sort((a, b) => spells[b].cost - spells[a].cost || a - b);
  while (owed > 0) {
    // smallest charge that covers the rest, else the most expensive one held
    let pick = -1;
    for (const s of order) if (t.eco.charges[s] > 0 && spells[s].cost >= owed) pick = s;
    if (pick < 0) pick = order.find((s) => t.eco.charges[s] > 0) ?? -1;
    if (pick < 0) break;
    t.eco.charges[pick]--;
    owed -= spells[pick].cost;
  }
  if (mana > 0) {
    w.economy.addMana(killer, mana);
    w.emit("chargesStolen", { from: tribe, to: killer, mana });
  }
}

/** Is entity index i the Shaper of its tribe? */
export function isShaper(w: World, i: number): boolean {
  return w.ents.cat[i] === CAT.unit && w.cfg.pack.units.units[w.ents.type[i]].isCaster === true;
}

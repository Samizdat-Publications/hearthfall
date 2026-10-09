// Casting and the Shaper's life cycle (M5): the cast command (walks into range, then a short cast
// window during which cancelCast refunds the charge), resolution through effect primitives,
// death and respawn at the Hearth, charge steal for the killer, and the elimination rule.
import { CAT, NO_ENTITY } from "./entities.ts";
import { registerCommand } from "./commands.ts";
import { secondsToTicks } from "./config.ts";
import { applyEffects } from "./effects.ts";
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
    if (!t.eco.unlocked[s]) return "spell not unlocked";
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
    if (distTo(w, si, x, y) <= w.cfg.pack.spells.spells[s].range) beginCast(w, c.tribe, s, x, y);
    else {
      w.tribes[c.tribe].pending = { spell: s, x, y };
      w.units.order([si], x, y);
      w.emit("castQueued", { tribe: c.tribe, spell: w.cfg.pack.spells.spells[s].id });
    }
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
      else if (w.ents.order[si] === ORDER.none) w.units.order([si], p.x, p.y);
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
      }
    }
  }
}

/** Called by World.kill when a Shaper dies: respawn timer, cast lost, charge steal for the killer. */
export function onShaperDeath(w: World, tribe: number, drowned: boolean, killer: number): void {
  const t = w.tribes[tribe];
  if (!t) return;
  const def = w.cfg.pack.units.units[w.cfg.unitIndex.get("shaper")!];
  const secs = drowned ? (def.respawn?.drownedSeconds ?? 26) : (def.respawn?.seconds ?? 35);
  t.respawnAt = w.tick + secondsToTicks(secs, w.cfg.tickHz);
  t.shaper = NO_ENTITY;
  t.casting = null;
  t.pending = null;
  w.emit("shaperDied", { tribe, killer, drowned: drowned ? 1 : 0 });
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

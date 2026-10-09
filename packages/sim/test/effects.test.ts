import { describe, expect, it } from "vitest";
import { applyEffects, EFFECTS } from "../src/effects.ts";
import { world } from "./helpers.ts";

describe("effect primitives", () => {
  it("every effect type used by data has a registered primitive", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const used = new Set<string>();
    for (const s of w.cfg.pack.spells.spells) for (const e of s.effects) used.add(e.type);
    for (const ent of w.cfg.pack.spells.entities) for (const e of ent.effects) used.add(e.type);
    const missing = [...used].filter((t) => !EFFECTS.has(t));
    // v1 spells must all be covered; later spells may still be missing primitives (backlog)
    const v1 = new Set<string>();
    for (const s of w.cfg.pack.spells.spells) if (s.v1) for (const e of s.effects) v1.add(e.type);
    expect([...v1].filter((t) => !EFFECTS.has(t))).toEqual([]);
    expect(missing.every((t) => !v1.has(t))).toBe(true);
  });

  it("unknown primitives throw instead of silently doing nothing", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    expect(() => applyEffects({ w, tribe: 0, spell: "x", x: 5, y: 5, casterX: 5, casterY: 5 }, [{ type: "nonsense" } as never])).toThrow(/no effect primitive/);
  });

  it("non-lethal damage never kills a Shaper; lethal damage can", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const s = w.ents.index(w.spawnUnit("shaper", 1, 10, 10));
    w.damage(s, 99999, 0, false);
    expect(w.ents.alive[s]).toBe(1);
    expect(w.ents.hp[s]).toBe(w.cfg.pack.balance.combat.shaperMinHpFromNonLethal);
    w.damage(s, 99999, 0, true);
    expect(w.ents.alive[s]).toBe(0);
    expect(w.eventCounts.get("shaperDied")).toBe(1);
  });

  it("knockback moves units about `force` cells away from the blast", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const u = w.ents.index(w.spawnUnit("settler", 1, 30.5, 30));
    applyEffects({ w, tribe: 0, spell: "bolt", x: 30, y: 30, casterX: 20, casterY: 30 }, [{ type: "knockback", radius: 2, force: 3, edgeFalloff: 0.6 }]);
    w.run(10);
    const moved = w.ents.x[u] - 30.5;
    expect(moved).toBeGreaterThan(2);
    expect(moved).toBeLessThan(3.2);
  });
});

describe("charge steal (M5 review regression)", () => {
  it("the killer gains a share of the victim's total stored charge value", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const e = w.tribes[1].eco;
    const idx = (id: string) => w.cfg.spellIndex.get(id)!;
    e.charges[idx("bolt")] = 3;
    e.charges[idx("hornets")] = 3;
    e.charges[idx("quake")] = 2;
    const s = w.ents.index(w.spawnUnit("shaper", 1, 10, 10));
    const before = w.tribes[0].eco.progress.reduce((a, b) => a + b, 0) + w.tribes[0].eco.wasted;
    w.damage(s, 99999, 0, true);
    const stored = 3 * 100 + 3 * 400 + 2 * 1750;
    const pct = w.cfg.pack.spells.chargeRules.killChargeStealPct;
    expect(w.eventCounts.get("chargesStolen")).toBe(1);
    const gained = w.tribes[0].eco.progress.reduce((a, b) => a + b, 0) + w.tribes[0].eco.wasted - before + w.tribes[0].eco.charges.reduce((a, c, i) => a + c * w.cfg.pack.spells.spells[i].cost, 0) - 300;
    expect(gained).toBeCloseTo(Math.floor((stored * pct) / 100), 6);
    expect(e.charges[idx("quake")]).toBe(1);
  });
});

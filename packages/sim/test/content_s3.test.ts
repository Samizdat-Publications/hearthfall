// Stretch 3 content pack: Spirit Well mana, Mending Hut heal aura, Sanctuary and Deluge spells.
import { describe, expect, it } from "vitest";
import { BSTATE } from "../src/economy.ts";
import { applyEffects } from "../src/effects.ts";
import { world } from "./helpers.ts";

const flat = (tribes = 1) => world({ generator: "flat", size: 64, tribes });
const spell = (w: ReturnType<typeof flat>, id: string) => w.cfg.pack.spells.spells[w.cfg.spellIndex.get(id)!].effects;

describe("stretch 3 content", () => {
  it("a finished Spirit Well adds its manaPerMin to the tribe; a plan adds nothing", () => {
    const w = flat();
    w.spawnUnit("shaper", 0, 10, 10);
    w.step([]);
    const base = w.tribes[0].eco.incomePerMin;
    const well = w.ents.index(w.spawnBuilding("spirit_well", 0, 30, 30));
    w.step([]);
    expect(w.tribes[0].eco.incomePerMin).toBe(base + 105);
    w.ents.state[well] = BSTATE.build;
    w.step([]);
    expect(w.tribes[0].eco.incomePerMin).toBe(base);
  });

  it("a Mending Hut heals own units in its radius once a second, up to full hp, and leaves rivals alone", () => {
    const w = flat(2);
    w.spawnBuilding("mending_hut", 0, 30, 30);
    const E = w.ents;
    const own = E.index(w.spawnUnit("warden", 0, 32, 30));
    const far = E.index(w.spawnUnit("warden", 0, 45, 30));
    const foe = E.index(w.spawnUnit("warden", 1, 31, 32));
    for (const i of [own, far, foe]) E.hp[i] = 1000;
    for (let t = 0; t < w.cfg.tickHz * 2; t++) w.step([]);
    expect(E.hp[own]).toBe(1060);
    expect(E.hp[far]).toBe(1000);
    expect(E.hp[foe]).toBeLessThanOrEqual(1000);
    E.hp[own] = 2590;
    for (let t = 0; t < w.cfg.tickHz * 2; t++) w.step([]);
    expect(E.hp[own]).toBe(2600);
  });

  it("Sanctuary heals the caster tribe's units inside it while it lasts; Deluge flings units and sinks land", () => {
    const w = flat(2);
    const E = w.ents;
    const own = E.index(w.spawnUnit("warden", 0, 30, 30));
    const foe = E.index(w.spawnUnit("warden", 1, 31, 31));
    E.hp[own] = 500;
    E.hp[foe] = 500;
    applyEffects({ w, tribe: 0, spell: "sanctuary", x: 30, y: 30, casterX: 30, casterY: 30 }, spell(w, "sanctuary"));
    for (let t = 0; t < w.cfg.tickHz * 5; t++) w.step([]);
    expect(E.hp[own]).toBeGreaterThan(1000);
    expect(E.hp[foe]).toBeLessThanOrEqual(500);

    const v = flat(2);
    const u = v.ents.index(v.spawnUnit("warden", 1, 33, 30));
    const h0 = v.terrain.heightAt(30, 30);
    applyEffects({ w: v, tribe: 0, spell: "deluge", x: 30, y: 30, casterX: 20, casterY: 30 }, spell(v, "deluge"));
    for (let t = 0; t < v.cfg.tickHz * 5; t++) v.step([]);
    expect(v.ents.x[u]).toBeGreaterThan(33.5);
    expect(v.terrain.heightAt(30, 30)).toBeLessThan(h0);
  });
});

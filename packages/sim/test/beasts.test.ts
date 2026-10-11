// Stretch 3 (living world): wolf dens. Packs bite tribe units near their den, keep to their leash, regrow
// lost members while one lives, are cleared for good when the last dies, and tribes fight back.
import { describe, expect, it } from "vitest";
import { CAT } from "../src/entities.ts";
import { applySetup } from "../src/scenario.ts";
import { World } from "../src/world.ts";
import { basePack, world } from "./helpers.ts";

const DEN = [40, 40] as const;

function den(size = 3) {
  const w = world({ generator: "flat", size: 96, tribes: 2 });
  w.spawnBuilding("hearth", 0, 10, 10);
  w.spawnBuilding("hearth", 1, 86, 86);
  w.spawnUnit("shaper", 0, 12, 12);
  w.spawnUnit("shaper", 1, 84, 84);
  w.beasts.addDen("wolf", DEN[0], DEN[1], size);
  return w;
}
const wolves = (w: World) => w.count((i) => w.ents.cat[i] === CAT.unit && w.ents.tribe[i] === -1 && w.beasts.isBeast(w.ents.type[i]));
const run = (w: World, s: number) => {
  for (let k = 0; k < s * w.cfg.tickHz; k++) w.step();
};

describe("wolf dens", () => {
  it("a pack bites a settler that wanders near and leaves one far away alone", () => {
    const w = den();
    expect(wolves(w)).toBe(3);
    const near = w.spawnUnit("settler", 0, DEN[0] + 4, DEN[1]);
    const far = w.spawnUnit("settler", 0, DEN[0] + 20, DEN[1]);
    let bites = 0;
    let howls = 0;
    for (let k = 0; k < 20 * w.cfg.tickHz; k++) {
      w.step();
      bites += w.events.filter((e) => e.type === "beastBite").length;
      howls += w.events.filter((e) => e.type === "beastHowl").length;
    }
    expect(bites).toBeGreaterThan(0);
    expect(howls).toBeGreaterThan(0);
    expect(w.ents.index(near)).toBe(-1);
    const fi = w.ents.index(far);
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(w.ents.hp[fi]).toBe(w.cfg.pack.units.units[w.ents.type[fi]].hp);
  });

  it("wolves do not chase past their leash and walk home", () => {
    const w = den(1);
    const s = w.spawnUnit("settler", 0, DEN[0] + 5, DEN[1]);
    run(w, 1);
    // the settler flees far away
    w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: [s], x: DEN[0] + 40, y: DEN[1] } }]);
    run(w, 25);
    const wi = w.ents.index(w.beasts.dens[0].members[0]);
    const dx = w.ents.x[wi] - DEN[0];
    const dy = w.ents.y[wi] - DEN[1];
    expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThan(w.cfg.pack.balance.beasts!.roamRadius + 2);
  });

  it("wardens fight back; the last wolf's death clears the den for good", () => {
    const w = den();
    for (let k = 0; k < 4; k++) w.spawnUnit("warden", 0, DEN[0] + 5 + k * 0.6, DEN[1] + 1);
    let cleared = 0;
    for (let k = 0; k < 60 * w.cfg.tickHz && !cleared; k++) {
      w.step();
      cleared += w.events.filter((e) => e.type === "denCleared").length;
    }
    expect(cleared).toBe(1);
    expect(wolves(w)).toBe(0);
    run(w, w.cfg.pack.balance.beasts!.respawnSeconds + 5);
    expect(wolves(w)).toBe(0);
  });

  it("a den with a living wolf regrows a lost one after respawnSeconds", () => {
    const w = den();
    const victim = w.ents.index(w.beasts.dens[0].members[1]);
    w.damage(victim, 1e6, 0, true);
    w.step();
    expect(wolves(w)).toBe(2);
    run(w, w.cfg.pack.balance.beasts!.respawnSeconds - 2);
    expect(wolves(w)).toBe(2);
    run(w, 3);
    expect(wolves(w)).toBe(3);
  });

  it("a snapshot mid-hunt restores to the same future hashes", () => {
    const p = basePack();
    const init = { pack: p.files, packHash: p.hash, seed: 4, map: { generator: "flat", size: 96, tribes: 1 } };
    const a = new World(init);
    a.spawnBuilding("hearth", 0, 10, 10);
    a.spawnUnit("shaper", 0, 12, 12);
    a.beasts.addDen("wolf", 40, 40, 3);
    for (let k = 0; k < 3; k++) a.spawnUnit("warden", 0, 45 + k, 41);
    for (let k = 0; k < 2 * a.cfg.tickHz; k++) a.step();
    const b = World.restore(init, a.snapshot());
    for (let k = 0; k < 6 * a.cfg.tickHz; k++) {
      a.step();
      b.step();
    }
    expect(b.hash().all).toBe(a.hash().all);
  });

  it("level setup turns a tribe -1 wolf entry into a den; skirmish dens keep away from Hearths", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    applySetup(w, [{ spawn: "wolf", tribe: -1, at: [30, 30], count: 4 }]);
    expect(w.beasts.dens.length).toBe(1);
    expect(w.beasts.dens[0].size).toBe(4);
    expect(wolves(w)).toBe(4);
    const p = basePack();
    const base = { pack: p.files, packHash: p.hash, seed: 11, map: { generator: "continents", size: 192, tribes: 2 } };
    expect(new World(base).beasts.dens.length).toBe(0);
    const s = new World({ ...base, wolfDens: 6 });
    expect(s.beasts.dens.length).toBeGreaterThan(2);
    const min = s.cfg.pack.balance.beasts!.minHearthDistance;
    for (const d of s.beasts.dens)
      for (let i = 0; i < s.ents.hi; i++) {
        if (!s.ents.alive[i] || s.ents.cat[i] !== CAT.building) continue;
        const dx = Math.abs(s.ents.x[i] - d.x);
        const dy = Math.abs(s.ents.y[i] - d.y);
        const n = s.terrain.size;
        expect(Math.hypot(Math.min(dx, n - dx), Math.min(dy, n - dy))).toBeGreaterThanOrEqual(min - 1);
      }
    // a small three-tribe map still gets a den (distances shrink to a fifth of the map)
    const small = new World({ ...base, seed: 1, map: { generator: "continents", size: 96, tribes: 3 }, wolfDens: 2 });
    expect(small.beasts.dens.length).toBeGreaterThanOrEqual(1);
  });
});

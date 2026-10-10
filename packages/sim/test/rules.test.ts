// BACKLOG 13 (ADR-014): skirmish victory rules in the sim: conquest under every variant, holding every
// site, the hill, the last stand timer, and rules state through snapshot and restore.
import { describe, expect, it } from "vitest";
import type { PackFiles } from "@hearthfall/data";
import { STANCE } from "../src/combat.ts";
import { World } from "../src/world.ts";
import { basePack } from "./helpers.ts";

const MAP = { generator: "flat", size: 64, tribes: 2 } as const;

/** a flat two tribe world under `rules`, with two Reliquaries at (24, 32) and (40, 32) */
function arena(rules: string, edit?: (p: PackFiles) => void): World {
  const base = basePack();
  let pack = base.files;
  if (edit) {
    pack = structuredClone(base.files);
    edit(pack);
  }
  const w = new World({ pack, packHash: edit ? `${base.hash}-edit` : base.hash, seed: 3, map: MAP, rules });
  w.spawnBuilding("hearth", 0, 8, 32);
  w.spawnBuilding("hearth", 1, 56, 32);
  w.spawnUnit("shaper", 0, 10, 30);
  w.spawnUnit("shaper", 1, 54, 30);
  for (const [x, tag] of [[24, "a"], [40, "b"]] as const) w.worship.addSite("reliquary", x, 32, { tag, rewards: [{ type: "charges", spell: "bolt", n: 1 }] });
  return w;
}

/** run whole seconds (World.run counts ticks) */
const sec = (w: World, s: number) => w.run(Math.round(s * w.cfg.tickHz));

/** n passive Wardens of `tribe` standing at (x, y) (settlers would wander off to work) */
function stand(w: World, tribe: number, n: number, x: number, y = 32, unit = "warden"): void {
  for (let k = 0; k < n; k++) w.ents.stance[w.ents.index(w.spawnUnit(unit, tribe, x + (k % 2) * 0.6, y + Math.floor(k / 2) * 0.6))] = STANCE.passive;
}

describe("victory rules (BACKLOG 13)", () => {
  it("conquest: the last tribe standing wins, and the win is an event and sim state", () => {
    const w = arena("conquest");
    sec(w, 2);
    expect(w.rules!.winner).toBe(-1);
    w.kill(w.ents.index(w.tribes[1].hearth), "destroyed");
    w.kill(w.ents.index(w.tribes[1].shaper), "destroyed");
    sec(w, 1);
    expect(w.rules!.winner).toBe(0);
    expect(w.rules!.why).toBe("conquest");
    expect(w.eventCounts.get("matchWon")).toBe(1);
  });

  it("holdSites: a tribe alone at every site for the variant's seconds wins; a rival at one site resets the run", () => {
    const w = arena("hold_sites");
    const goal = w.rules!.goalTicks();
    stand(w, 0, 2, 24);
    stand(w, 0, 2, 40);
    sec(w, goal / w.cfg.tickHz / 2);
    expect(w.rules!.held[0]).toBeGreaterThan(0);
    stand(w, 1, 1, 40.5, 33);
    sec(w, 2);
    expect(w.rules!.held[0]).toBe(0);
    expect(w.rules!.held[1]).toBe(0);
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.tribe[i] === 1 && i !== w.ents.index(w.tribes[1].shaper)) w.kill(i, "destroyed");
    sec(w, goal / w.cfg.tickHz + 2);
    expect(w.rules!.winner).toBe(0);
    expect(w.rules!.why).toBe("holdSites");
  });

  it("kingOfHill: the tribe with the most people at the first site scores; a tie scores nobody", () => {
    const w = arena("king_of_hill");
    stand(w, 0, 2, 24);
    stand(w, 1, 2, 24.5, 33.5);
    sec(w, 5);
    expect(w.rules!.held).toEqual([0, 0]);
    stand(w, 0, 1, 23.5, 31);
    sec(w, 5);
    expect(w.rules!.held[0]).toBeGreaterThan(0);
    expect(w.rules!.held[1]).toBe(0);
    sec(w, w.rules!.goalTicks() / w.cfg.tickHz);
    expect(w.rules!.winner).toBe(0);
  });

  it("lastStand: when the timer runs out the tribe with the most followers wins", () => {
    const w = arena("last_stand", (p) => {
      for (const v of p.balance.victory!.variants) if (v.type === "lastStand") v.minutes = 0.1;
    });
    stand(w, 1, 4, 50, 40, "settler");
    sec(w, 5);
    expect(w.rules!.winner).toBe(-1);
    sec(w, 2);
    expect(w.rules!.winner).toBe(1);
    expect(w.rules!.why).toBe("lastStand");
  });

  it("rules state survives snapshot and restore with identical hashes; worlds without rules hash as before", () => {
    const w = arena("king_of_hill");
    stand(w, 0, 3, 24);
    sec(w, 6);
    const r = World.restore({ pack: basePack().files, packHash: basePack().hash, seed: 3, map: MAP, rules: "king_of_hill" }, w.snapshot());
    expect(r.hash().all).toBe(w.hash().all);
    sec(w, 3);
    sec(r, 3);
    expect(r.hash().all).toBe(w.hash().all);
    expect(r.rules!.held).toEqual(w.rules!.held);
    const plain = new World({ pack: basePack().files, packHash: basePack().hash, seed: 3, map: MAP });
    const ruled = new World({ pack: basePack().files, packHash: basePack().hash, seed: 3, map: MAP, rules: "conquest" });
    expect(plain.rules).toBeNull();
    expect(ruled.hash().all).not.toBe(plain.hash().all);
  });
});

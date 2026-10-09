import { describe, expect, it } from "vitest";
import { CAT } from "../../sim/src/entities.ts";
import { World } from "../../sim/src/world.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { makeBot } from "../src/index.ts";

function warMatch(seed: number, minutes: number): World {
  const p = basePack();
  const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
  for (let tr = 0; tr < 2; tr++) w.controllers.push(makeBot({ type: "war", tribe: tr, offset: tr }));
  for (let t = 0; t < minutes * 60 * w.cfg.tickHz; t++) {
    w.step([]);
    const v = w.invariants();
    if (v.length) throw new Error(`tick ${w.tick}: ${v[0]}`);
  }
  return w;
}

describe("WarBot (M6)", () => {
  it("builds lodges, trains toward its mix and sends attack waves that fight", () => {
    const w = warMatch(1001, 12);
    const c = (k: string) => w.eventCounts.get(k) ?? 0;
    const lodges = ["warden_lodge", "fire_lodge", "chant_house"].map((b) => w.cfg.buildingIndex.get(b)!);
    let built = 0;
    for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.cat[i] === CAT.building && lodges.includes(w.ents.type[i])) built++;
    expect(built).toBeGreaterThanOrEqual(2);
    expect(c("trained")).toBeGreaterThan(10);
    expect(c("killed") + c("converted")).toBeGreaterThan(0);
  }, 60000);

  it("war matches are deterministic", () => {
    expect(warMatch(1003, 4).hash()).toEqual(warMatch(1003, 4).hash());
  }, 60000);
});

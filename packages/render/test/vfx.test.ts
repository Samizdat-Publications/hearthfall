// M11 combat VFX readability (BACKLOG 57): chant rings keep their violet hue (a normal-blended halo
// under the additive pulse, which washed out to white on bright ground) and a melee hit leaves a
// visible dust halo and flash at the struck unit instead of a lone spark.
import { describe, expect, it } from "vitest";
import { World, type SimEvent } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { makeBendUniforms } from "../src/curve.ts";
import { VfxLayer } from "../src/vfx.ts";

const world = () => {
  const pack = basePack();
  return new World({ pack: pack.files, packHash: pack.hash, seed: 5, map: { generator: "flat", size: 64, tribes: 2 } });
};

describe("vfx layer", () => {
  it("draws a violet halo while a chant runs", () => {
    const w = world();
    const v = new VfxLayer(makeBendUniforms());
    v.consume([{ type: "chantBegun", x: 20, y: 20 } as unknown as SimEvent], w, () => 0, 1);
    v.update(w, 0.5, 20, 20, 1);
    expect(v.drawnBy().halo).toBe(1);
    const c = v.haloColor(0);
    expect(c.b).toBeGreaterThan(c.r);
    expect(c.r).toBeGreaterThan(c.g);
  });

  it("marks a melee hit with a dust halo and a flash", () => {
    const w = world();
    const v = new VfxLayer(makeBendUniforms());
    v.consume([{ type: "melee", id: 1, x: 12, y: 12 } as unknown as SimEvent], w, () => 0, 1);
    v.update(w, 0.1, 12, 12, 1);
    const d = v.drawnBy();
    expect(d.halo).toBe(1);
    expect(d.flash).toBe(1);
    expect(d.spark).toBe(1);
  });

  it("draws the new spell effects: a gold Ward halo, a wraith, a whirlwind funnel, a falling meteor (BACKLOG 1)", () => {
    const w = world();
    const v = new VfxLayer(makeBendUniforms());
    const u = w.ents.index(w.spawnUnit("settler", 0, 20, 20));
    w.ents.ward[u] = 50;
    v.update(w, 0, 20, 20, 1);
    expect(v.drawnBy().halo).toBe(1);
    const c = v.haloColor(0);
    expect(c.r).toBeGreaterThan(c.b);
    expect(c.g).toBeGreaterThan(c.b);
    w.ents.ward[u] = 0;
    const fx = (spell: string, state: number) => {
      const i = w.ents.index(w.ents.alloc(4, 0, 0, 30, 30, 1));
      w.ents.state[i] = state;
      w.ents.progress[i] = 1.6;
      w.ents.type[i] = w.cfg.spellIndex.get(spell) ?? 0;
      return i;
    };
    const wr = fx("wraith", 6);
    v.update(w, 0, 30, 30, 1);
    expect(v.drawnBy().flash).toBe(1);
    expect(v.drawnBy().spark).toBe(10);
    w.ents.free(w.ents.idOf(wr));
    fx("whirlwind", 4);
    v.update(w, 0, 30, 30, 1);
    expect(v.drawnBy().spark).toBe(48);
    v.consume([{ type: "meteor", x: 25, y: 25, r: 1.2 } as unknown as SimEvent], w, () => 1, 1);
    v.update(w, 1.4, 25, 25, 1);
    expect(v.drawnBy().ring).toBe(1);
  });

  it("an erupting volcano draws a smoke column well above its cone, its lava rocks do not (BACKLOG 0a)", () => {
    const w = world();
    const v = new VfxLayer(makeBendUniforms());
    const fx = (r: number) => {
      const i = w.ents.index(w.ents.alloc(4, 0, 0, 30, 30, 1));
      w.ents.progress[i] = r;
      w.ents.type[i] = w.cfg.spellIndex.get("volcano") ?? 0;
      return i;
    };
    const rock = fx(1.2);
    v.update(w, 3, 30, 30, 1);
    expect(v.drawnBy().smoke).toBe(0);
    w.ents.free(w.ents.idOf(rock));
    fx(4);
    const gy = Math.max(w.terrain.heightAt(30, 30), w.terrain.sea);
    for (const now of [0, 2.5, 7.1]) {
      v.update(w, now, 30, 30, 1);
      expect(v.drawnBy().smoke).toBe(30);
      expect(v.smokeTop()).toBeGreaterThan(gy + 8);
    }
  });
});

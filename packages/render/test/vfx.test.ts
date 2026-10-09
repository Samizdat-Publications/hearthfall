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
});

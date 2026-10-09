// M11 unit readability: every tribe unit stands on a disc in its tribe color (wild people do not), and
// the Shaper is drawn larger on a larger disc.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { UnitLayer } from "../src/unitsLayer.ts";

describe("unit layer", () => {
  it("draws a tribe-colored disc under each tribe unit and a larger one under the Shaper", () => {
    const pack = basePack();
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2 } });
    w.spawnUnit("shaper", 0, 10, 10);
    w.spawnUnit("settler", 1, 12, 10);
    w.spawnUnit("wild", -1, 14, 10);
    const pal = { azure: "#2e6fd8", crimson: "#d83a2e" };
    const layer = new UnitLayer(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), pack.files.units.units.map((u) => u.id), pal, ["azure", "crimson"]);
    const cam = new THREE.PerspectiveCamera();
    layer.update(w, 1, 12, 10, 1, 0, 1000, cam, 0, 100, 100, new Set());
    expect(layer.disc.count).toBe(2);
    const scale = (k: number) => {
      const m = new THREE.Matrix4();
      layer.disc.getMatrixAt(k, m);
      return new THREE.Vector3().setFromMatrixScale(m).x;
    };
    const color = (k: number) => {
      const c = new THREE.Color();
      layer.disc.getColorAt(k, c);
      return c.getHexString();
    };
    // spawn order: Shaper (tribe 0) then settler (tribe 1)
    expect(scale(0)).toBeGreaterThan(scale(1) * 1.4);
    expect(color(0)).toBe(new THREE.Color(pal.azure).getHexString());
    expect(color(1)).toBe(new THREE.Color(pal.crimson).getHexString());
  });
});

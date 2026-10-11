// Stretch 3: landscape decor (bushes, logs, mushroom rings, ruins, standing stones) from the prop models.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { DecorLayer, DECOR_DEFAULTS } from "../src/decor.ts";
import type { ModelParts } from "../src/models.ts";

const pack = basePack();
const flat = () => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 128, tribes: 1, landAboveSea: 120 } });
const box = (): ModelParts => ({ body: new THREE.BoxGeometry(1, 1, 1), tint: null, tintShare: 0, size: new THREE.Vector3(1, 1, 1) });
const models = new Map(DECOR_DEFAULTS.kinds.map((k) => [k.id, box()] as const));
const all = (d: DecorLayer) => Object.values(d.counts()).reduce((a, b) => a + b, 0);
const positions = (d: DecorLayer) => {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: [number, number][] = [];
  for (const im of d.meshes)
    for (let k = 0; k < im.count; k++) {
      im.getMatrixAt(k, m);
      p.setFromMatrixPosition(m);
      out.push([p.x, p.z]);
    }
  return out;
};

describe("decor layer", () => {
  it("scatters the same decor for the same cells, within the radius, off the sea and away from buildings", () => {
    const w = flat();
    const a = new DecorLayer(new THREE.MeshBasicMaterial(), models, { density: 0.08 });
    const b = new DecorLayer(new THREE.MeshBasicMaterial(), models, { density: 0.08 });
    a.update(w, 64, 64, 1, 0.3, false);
    b.update(w, 64, 64, 1, 0.3, false);
    expect(all(a)).toBeGreaterThan(50);
    expect(positions(a)).toEqual(positions(b));
    for (const [x, z] of positions(a)) expect(Math.hypot(x - 64, z - 64)).toBeLessThan(DECOR_DEFAULTS.radius + 1.5);
    // a hearth clears its footprint and a one-cell margin
    const f = w.economy.footprint(w.ents.index(w.spawnBuilding("hearth", 0, 60, 60)));
    a.update(w, 64, 64, 1, 0.3, false);
    const inside = (x: number, z: number) => Math.round(x) >= f.x0 && Math.round(x) < f.x0 + f.fw && Math.round(z) >= f.y0 && Math.round(z) < f.y0 + f.fh;
    for (const [x, z] of positions(a)) expect(inside(x, z)).toBe(false);
    // sink the area: nothing grows under water
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) w.terrain.heights[w.terrain.idx(x, y)] = w.terrain.sea - 4;
    w.terrain.version++;
    a.update(w, 64, 64, 1, 0.3, false);
    expect(all(a)).toBe(0);
  });

  it("is hidden above maxZoom and in map view, and draws nothing without its models", () => {
    const w = flat();
    const d = new DecorLayer(new THREE.MeshBasicMaterial(), models);
    d.update(w, 64, 64, 1, 0.9, false);
    expect(all(d)).toBe(0);
    d.update(w, 64, 64, 1, 0.3, true);
    expect(all(d)).toBe(0);
    d.update(w, 64, 64, 1, 0.3, false);
    expect(all(d)).toBeGreaterThan(0);
    const none = new DecorLayer(new THREE.MeshBasicMaterial(), null);
    expect(none.meshes.length).toBe(0);
    none.update(w, 64, 64, 1, 0.3, false);
    expect(none.modelIds).toEqual([]);
  });
});

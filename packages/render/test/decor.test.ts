// Stretch 3: landscape decor (bushes, logs, mushroom rings, ruins, standing stones) from the prop models.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World, createLevelWorld } from "@hearthfall/sim";
import { validateLevel } from "@hearthfall/data";
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

  it("S4 L7-D: shore kinds line the water's edge and settle kinds ring buildings, each in its own zone", () => {
    const w = flat();
    const t = w.terrain;
    // a lake over the west half with a gentle beach: deep to x 59, shelving to the shallows at 62 and 63,
    // a low strand from 64 to 67, then low land
    const beach = (x: number) => (x < 60 ? -6 : x < 61 ? -4 : x < 62 ? -2 : x < 64 ? -1 : x < 68 ? 2 : 5);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) t.heights[t.idx(x, y)] = t.sea + beach(x);
    t.version++;
    const kinds = [
      { id: "reed", weight: 1, low: 0, high: 1, size: 0.8, zone: "shore" as const },
      { id: "pile", weight: 1, low: 0, high: 1, size: 0.8, zone: "settle" as const },
      { id: "bush", weight: 1, low: 0, high: 1, size: 0.8 },
    ];
    const mk = new Map(kinds.map((k) => [k.id, box()] as const));
    const d = new DecorLayer(new THREE.MeshBasicMaterial(), mk, { kinds, density: 0.05, shoreDensity: 0.5, settleDensity: 0.5 });
    const f = w.economy.footprint(w.ents.index(w.spawnBuilding("hearth", 0, 80, 80)));
    d.update(w, 70, 76, 1, 0.3, false);
    const at = (id: string) => {
      const im = d.meshes[d.modelIds.indexOf(id)];
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      return Array.from({ length: im.count }, (_, k) => (im.getMatrixAt(k, m), p.setFromMatrixPosition(m), [p.x, p.z] as [number, number]));
    };
    const reeds = at("reed");
    const piles = at("pile");
    expect(reeds.length).toBeGreaterThan(5);
    expect(piles.length).toBeGreaterThan(3);
    // reeds stand in the shallows and on the strand next to them (cells 62 to 65, with the jitter)
    for (const [x] of reeds) expect(Math.abs(x - 63.5)).toBeLessThan(2.1);
    // piles stand in the ring around the hearth, never on it or its margin
    for (const [x, z] of piles) {
      const cx = Math.round(x);
      const cz = Math.round(z);
      expect(cx >= f.x0 - 3 && cx < f.x0 + f.fw + 3 && cz >= f.y0 - 3 && cz < f.y0 + f.fh + 3).toBe(true);
      expect(cx >= f.x0 - 1 && cx < f.x0 + f.fw + 1 && cz >= f.y0 - 1 && cz < f.y0 + f.fh + 1).toBe(false);
    }
    // the open land kind keeps out of the water
    expect(at("bush").length).toBeGreaterThan(0);
    for (const [x] of at("bush")) expect(x).toBeGreaterThan(63.4);
  });

  it("S4 L7-D: a level's hand placed props stand where the level puts them, and validateLevel checks them", () => {
    const raw = {
      id: "props_test", name: "Props", order: 99, description: "test", seed: 5,
      map: { generator: "flat", size: 64, landAboveSea: 20 },
      tribes: [{}],
      spells: [],
      setup: [{ spawn: "hearth", tribe: 0, at: [12, 12] }, { spawn: "shaper", tribe: 0, at: [16, 12] }],
      objectives: [{ type: "survive", seconds: 600 }],
      lose: [{ type: "timeLimit", seconds: 900 }],
      props: [{ model: "prop.standing_stone", at: [40, 30], rot: 1, size: 2 }, { model: "prop.ruin_a", at: [62, 30] }],
    };
    const res = validateLevel(raw, pack.files);
    expect(res.issues).toEqual([]);
    expect(validateLevel({ ...raw, props: [{ model: "prop.nope", at: [1, 1] }] }, pack.files).issues.length).toBe(1);
    expect(validateLevel({ ...raw, props: [{ model: "prop.ruin_a", at: [70, 1] }] }, pack.files).issues.length).toBe(1);
    const w = createLevelWorld({ def: res.level! }, pack.files, pack.hash, (spec) => ({ tribe: spec.tribe, every: 1, offset: 0, decide: () => [] }));
    const d = new DecorLayer(new THREE.MeshBasicMaterial(), models, { density: 0 , shoreDensity: 0, settleDensity: 0 });
    d.update(w, 40, 30, 1, 0.3, false);
    expect(d.counts()["prop.standing_stone"]).toBe(1);
    expect(d.counts()["prop.ruin_a"]).toBe(1);
    // the ruin at x 62 is drawn as the copy nearest a focus across the seam (x 2 sees it at -2)
    d.update(w, 2, 30, 1, 0.3, false);
    const ruin = d.meshes[d.modelIds.indexOf("prop.ruin_a")];
    const m = new THREE.Matrix4();
    ruin.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(-2);
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

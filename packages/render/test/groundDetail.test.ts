// BACKLOG 39: close-up ground detail (grass tufts, flowers, pebbles) near the focus.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { GroundDetailLayer } from "../src/groundDetail.ts";

const pack = basePack();
const flat = () => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 1 } });
const positions = (im: THREE.InstancedMesh) => {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const out: [number, number][] = [];
  for (let k = 0; k < im.count; k++) {
    im.getMatrixAt(k, m);
    p.setFromMatrixPosition(m);
    out.push([p.x, p.z]);
  }
  return out;
};

describe("ground detail layer", () => {
  it("scatters the same props for the same cells, only within the radius, and none in the sea", () => {
    const w = flat();
    const a = new GroundDetailLayer(new THREE.MeshBasicMaterial(), {}, { radius: 10 });
    const b = new GroundDetailLayer(new THREE.MeshBasicMaterial(), {}, { radius: 10 });
    a.update(w, 40, 40, 1, 0.2, false);
    b.update(w, 40, 40, 1, 0.2, false);
    expect(a.tufts.count).toBeGreaterThan(100);
    expect(positions(a.tufts)).toEqual(positions(b.tufts));
    for (const [x, z] of positions(a.tufts)) expect(Math.hypot(x - 40, z - 40)).toBeLessThan(11.5);
    // sink the area: nothing grows under water
    for (let y = 30; y <= 50; y++) for (let x = 30; x <= 50; x++) w.terrain.heights[w.terrain.idx(x, y)] = w.terrain.sea - 4;
    w.terrain.version++;
    a.update(w, 40, 40, 1, 0.2, false);
    expect(a.tufts.count + a.pebbles.count + a.flowers.count).toBe(0);
  });

  it("is hidden above maxZoom and in map view", () => {
    const w = flat();
    const l = new GroundDetailLayer(new THREE.MeshBasicMaterial(), {}, { radius: 8, maxZoom: 0.5 });
    l.update(w, 20, 20, 1, 0.3, false);
    expect(l.tufts.count).toBeGreaterThan(0);
    l.update(w, 20, 20, 1, 0.7, false);
    expect(l.tufts.count).toBe(0);
    l.update(w, 20, 20, 1, 0.3, true);
    expect(l.tufts.count).toBe(0);
  });

  it("leaves building footprints bare and thins grass toward the heights", () => {
    const w = flat();
    const l = new GroundDetailLayer(new THREE.MeshBasicMaterial(), {}, { radius: 12, tufts: 3 });
    l.update(w, 32, 32, 1, 0.2, false);
    const before = l.tufts.count;
    const b = w.spawnBuilding("dwelling", 0, 32, 32);
    const fp = w.economy.footprint(b);
    l.update(w, 32, 32, 1, 0.2, false);
    expect(l.tufts.count).toBeLessThan(before);
    for (const [x, z] of positions(l.tufts)) expect(x >= fp.x0 && x <= fp.x0 + fp.fw && z >= fp.y0 && z <= fp.y0 + fp.fh).toBe(false);
    // raise everything to the height cap: grass gives way to pebbles
    const t = w.terrain;
    for (let y = 0; y < t.size; y++) for (let x = 0; x < t.size; x++) t.heights[t.idx(x, y)] = t.heightMax;
    t.version++;
    l.update(w, 10, 10, 1, 0.2, false);
    expect(l.tufts.count).toBe(0);
    expect(l.pebbles.count).toBeGreaterThan(0);
  });
});

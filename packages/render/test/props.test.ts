// BACKLOG 0a and 14a-3: the tree layer mixes round clumps, a tall conifer and the GLB tree models by altitude.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAT, World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { ROCK_MODELS, TREE_MODELS, type ModelParts } from "../src/models.ts";
import { clumpShare, ROCK_HEIGHT, ROCK_WIDTH, TREE_MIX_V2, TreeLayer } from "../src/props.ts";

describe("tree layer", () => {
  const world = () => {
    const pack = basePack();
    return new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "continents", size: 96, tribes: 2 } });
  };
  const fakeModels = () => {
    const body = () => {
      const g = new THREE.BoxGeometry(1, 2.5, 1).translate(0, 1.25, 0).toNonIndexed();
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(0.5), 3));
      return g;
    };
    return new Map<string, ModelParts>(TREE_MODELS.map((id) => [id, { body: body(), tint: null, tintShare: 0, size: new THREE.Vector3(1, 2.5, 1) }]));
  };

  it("look v2 mix (no style): about 70 percent conifers and the rest GLB trees, no clumps", () => {
    const w = world();
    const trees = w.count((i) => w.ents.cat[i] === CAT.tree);
    expect(trees).toBeGreaterThan(100);
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, fakeModels(), 8192);
    // two clump variants, the conifer, the tree models, then one placeholder rock mesh
    expect(layer.kinds).toEqual(["clump", "clump", "pine", ...TREE_MODELS.map(() => "model")]);
    expect(layer.meshes.length).toBe(TREE_MODELS.length + 4);
    layer.update(w, 48, 48, 0.02);
    const counts = layer.meshes.map((m) => m.count);
    expect(counts[0] + counts[1]).toBe(0);
    expect(counts.slice(0, layer.kinds.length).reduce((a, b) => a + b, 0)).toBe(trees);
    expect(counts[2] / trees).toBeGreaterThan(1 - TREE_MIX_V2.modelShare - 0.08);
    expect(counts[2] / trees).toBeLessThan(1 - TREE_MIX_V2.modelShare + 0.08);
    // the conifer is taller than it is wide
    const box = new THREE.Box3().setFromBufferAttribute(layer.meshes[2].geometry.getAttribute("position") as THREE.BufferAttribute);
    expect(box.max.y - box.min.y).toBeGreaterThan(2 * (box.max.x - box.min.x));
  });

  it("BACKLOG 14a-3: style mix puts round clumps in the lowlands and conifers on the heights", () => {
    const mix = basePack().files.style.render!.trees!;
    expect(clumpShare(mix, 0)).toBeCloseTo(mix.clumpLow);
    expect(clumpShare(mix, 1)).toBeCloseTo(mix.clumpHigh);
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, fakeModels(), 8192, mix);
    let lowClump = 0;
    let highClump = 0;
    for (let i = 0; i < 2000; i++) {
      if (layer.kinds[layer.kindOf(i, 0)] === "clump") lowClump++;
      if (layer.kinds[layer.kindOf(i, 0.9)] === "clump") highClump++;
    }
    expect(lowClump / 2000).toBeGreaterThan(mix.clumpLow - 0.05);
    expect(highClump / 2000).toBeLessThan(mix.clumpHigh + 0.05);
    // on a real map both kinds show up and every tree is drawn
    const w = world();
    layer.update(w, 48, 48, 0.02);
    const counts = layer.meshes.map((m) => m.count);
    expect(counts[0] + counts[1]).toBeGreaterThan(20);
    expect(counts[2]).toBeGreaterThan(5);
    expect(counts.slice(0, layer.kinds.length).reduce((a, b) => a + b, 0)).toBe(w.count((i) => w.ents.cat[i] === CAT.tree));
    // a clump is round: about as wide as it is tall
    const box = new THREE.Box3().setFromBufferAttribute(layer.meshes[0].geometry.getAttribute("position") as THREE.BufferAttribute);
    expect((box.max.y - box.min.y) / (box.max.x - box.min.x)).toBeLessThan(1.6);
  });

  it("keeps a placeholder broadleaf in place of the models without them", () => {
    const w = world();
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, null, 8192, basePack().files.style.render!.trees!);
    expect(layer.kinds).toEqual(["clump", "clump", "pine", "model"]);
    expect(layer.meshes.length).toBe(5);
    layer.update(w, 48, 48, 0.02);
    expect(layer.meshes.slice(0, 4).reduce((a, m) => a + m.count, 0)).toBe(w.count((i) => w.ents.cat[i] === CAT.tree));
  });

  it("BACKLOG 0c: draws every rock from the rock models, shrinking as its stone is quarried", () => {
    const pack = basePack();
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "continents", size: 96, tribes: 2 } });
    const rocks = w.count((i) => w.ents.cat[i] === CAT.rock);
    expect(rocks).toBeGreaterThan(5);
    const box = (sx: number) => {
      const g = new THREE.BoxGeometry(sx, 1, 1).translate(0, 0.5, 0).toNonIndexed();
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(0.5), 3));
      return g;
    };
    const parts = (sx: number, sy = 0.5): ModelParts => ({ body: box(sx), tint: null, tintShare: 0, size: new THREE.Vector3(sx, sy, 1) });
    const models = new Map<string, ModelParts>([...TREE_MODELS.map((id) => [id, parts(1)] as const), ...ROCK_MODELS.map((id, k) => [id, parts(1 + k)] as const)]);
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, models, 8192);
    expect(layer.modelIds).toEqual(expect.arrayContaining(ROCK_MODELS));
    const r0 = TREE_MODELS.length + 3;
    expect(layer.meshes.length).toBe(r0 + ROCK_MODELS.length);
    layer.update(w, 48, 48, 0.02);
    expect(layer.meshes.slice(r0).reduce((a, m) => a + m.count, 0)).toBe(rocks);
    // the drawn width of a full rock is about ROCK_WIDTH whichever model it uses; a nearly empty one is smaller
    const width = () => {
      const out: number[] = [];
      const m = new THREE.Matrix4();
      const s = new THREE.Vector3();
      for (let k = 0; k < ROCK_MODELS.length; k++) {
        const mesh = layer.meshes[r0 + k];
        for (let j = 0; j < mesh.count; j++) {
          mesh.getMatrixAt(j, m);
          s.setFromMatrixScale(m);
          out.push(s.x * (1 + k));
        }
      }
      return out;
    };
    const full = width();
    for (const v of full) expect(v).toBeGreaterThan(0.8 * ROCK_WIDTH), expect(v).toBeLessThan(1.2 * ROCK_WIDTH);
    // a tall spire model is capped by height instead, so it never stands taller than ROCK_HEIGHT plus jitter
    const spire = new TreeLayer(new THREE.MeshBasicMaterial(), {}, new Map([...models, ["prop.rock_a", parts(1, 4)]]), 8192);
    spire.update(w, 48, 48, 0.02);
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    for (let j = 0; j < spire.meshes[r0].count; j++) {
      spire.meshes[r0].getMatrixAt(j, m);
      expect(s.setFromMatrixScale(m).y * 4).toBeLessThan(ROCK_HEIGHT * 1.16);
    }
    const E = w.ents;
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.rock) E.stone[i] = 1;
    w.treeVersion++; // as quarrying does
    layer.update(w, 48, 48, 0.02);
    const low = width();
    expect(Math.max(...low)).toBeLessThan(Math.min(...full));
  });
});

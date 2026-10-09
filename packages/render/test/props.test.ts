// BACKLOG 0a: the tree layer mixes a tall conifer into the GLB tree models so forests read as pine belts.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAT, World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { TREE_MODELS, type ModelParts } from "../src/models.ts";
import { PINE_SHARE, TreeLayer } from "../src/props.ts";

describe("tree layer", () => {
  it("draws about PINE_SHARE of the trees as the tall conifer when the GLB models are loaded", () => {
    const pack = basePack();
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "continents", size: 96, tribes: 2 } });
    const trees = w.count((i) => w.ents.cat[i] === CAT.tree);
    expect(trees).toBeGreaterThan(100);
    const body = () => {
      const g = new THREE.BoxGeometry(1, 2.5, 1).translate(0, 1.25, 0).toNonIndexed();
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(0.5), 3));
      return g;
    };
    const models = new Map<string, ModelParts>(TREE_MODELS.map((id) => [id, { body: body(), tint: null, tintShare: 0, size: new THREE.Vector3(1, 2.5, 1) }]));
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, models, 8192);
    expect(layer.meshes.length).toBe(TREE_MODELS.length + 1);
    layer.update(w, 48, 48, 0.02);
    const counts = layer.meshes.map((m) => m.count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(trees);
    const pines = counts[TREE_MODELS.length];
    expect(pines / trees).toBeGreaterThan(PINE_SHARE - 0.08);
    expect(pines / trees).toBeLessThan(PINE_SHARE + 0.08);
    // the conifer is taller than it is wide
    const box = new THREE.Box3().setFromBufferAttribute(layer.meshes[TREE_MODELS.length].geometry.getAttribute("position") as THREE.BufferAttribute);
    expect(box.max.y - box.min.y).toBeGreaterThan(2 * (box.max.x - box.min.x));
  });

  it("keeps the two placeholder kinds without models", () => {
    const pack = basePack();
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "continents", size: 96, tribes: 2 } });
    const layer = new TreeLayer(new THREE.MeshBasicMaterial(), {}, null, 8192);
    expect(layer.meshes.length).toBe(2);
    layer.update(w, 48, 48, 0.02);
    expect(layer.meshes[0].count + layer.meshes[1].count).toBe(w.count((i) => w.ents.cat[i] === CAT.tree));
  });
});

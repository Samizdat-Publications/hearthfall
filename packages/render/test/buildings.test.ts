// BACKLOG 0a: building models draw at style.render.buildingScale so villages read as villages next to the
// readability-scaled units, without neighbors overlapping inside the placement gap.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { BuildingLayer } from "../src/buildingsLayer.ts";
import { buildingModelIds, type ModelParts } from "../src/models.ts";

const box = (w: number, h: number) => {
  const g = new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0).toNonIndexed();
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3).fill(0.5), 3));
  return g;
};

describe("building layer", () => {
  it("scales the models by buildingScale, which stays inside the building gap for the largest footprint", () => {
    const pack = basePack();
    const defs = pack.files.buildings.buildings;
    const models = new Map<string, ModelParts>();
    for (const b of defs) for (const id of buildingModelIds(b.id, b.levels?.length ?? 0)) models.set(id, { body: box(b.footprint[0], 1), tint: box(0.3, 0.3), tintShare: 0.1, size: new THREE.Vector3(b.footprint[0], 1, b.footprint[1]) });
    const scale = pack.files.style.render!.buildingScale!;
    expect(scale).toBeGreaterThan(1);
    // two neighbors of the largest footprint, each overhanging (scale - 1) x footprint / 2, fit in the gap
    const big = Math.max(...defs.map((b) => Math.max(b.footprint[0], b.footprint[1])));
    expect((scale - 1) * big).toBeLessThanOrEqual(pack.files.balance.economy.buildingGapCells);
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 1, map: { generator: "flat", size: 64, tribes: 1 } });
    w.spawnBuilding("hearth", 0, 20, 20);
    const layer = new BuildingLayer(new THREE.MeshBasicMaterial(), defs, {}, ["crimson"], models, 64, scale);
    layer.update(w, 20, 20, 0.02);
    const im = layer.group.children.find((c) => (c as THREE.InstancedMesh).count > 0) as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    im.getMatrixAt(0, m);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.x).toBeCloseTo(scale, 5);
  });
});

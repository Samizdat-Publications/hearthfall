// Stretch 3: a held ward stone draws a dashed ring at its aura's reach; an unheld one and a mana stone do not.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { WorshipLayer } from "../src/worshipLayer.ts";

const pack = basePack();

describe("worship layer", () => {
  it("draws the aura reach of a held ward stone only", () => {
    const w = new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2, landAboveSea: 120 } });
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnBuilding("hearth", 1, 50, 50);
    w.worship.addSite("ward_stone", 30, 30, { rewards: [] });
    w.worship.addSite("ley_stone", 20, 40, { rewards: [] });
    const kinds = pack.files.buildings.worship.kinds ?? [];
    const layer = new WorshipLayer(new THREE.MeshBasicMaterial(), kinds, {}, ["azure", "crimson"], null, 64, new THREE.MeshBasicMaterial());
    layer.update(w, 32, 32, 1);
    expect(layer.reachCount).toBe(0);
    for (const s of w.worship.sites) s.lastBy = 1;
    layer.update(w, 32, 32, 1);
    expect(layer.reachCount).toBe(40);
  });
});

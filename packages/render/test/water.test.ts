// BACKLOG 14a-2: painted water samples a per-cell depth texture (sea minus height) per fragment.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Terrain } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { fillDepth, makeWaterMaterial, WATER_LOOK_V2 } from "../src/terrainMesh.ts";

describe("painted water", () => {
  it("fills depth row-major as sea minus height", () => {
    const t = new Terrain({ size: 4, seaLevel: 10, heightMax: 100, drownDepth: 2, maxWalkSlope: 9, maxBuildSlope: 4 });
    t.heights[1 + 2 * 4] = 25;
    const d = fillDepth(t, new Float32Array(16));
    expect(d[0]).toBe(10);
    expect(d[1 + 2 * 4]).toBe(-15);
  });

  it("takes the look knobs from style.json, falling back to the v2 look", () => {
    const w = basePack().files.style.render!.water!;
    const bend = { uCurve: { value: 0 }, uCenter: { value: new THREE.Vector2() } } as never;
    const pal = { water: new THREE.Color(), waterShallow: new THREE.Color(), foam: new THREE.Color() } as never;
    const m = makeWaterMaterial(pal, bend, { value: 0 }, 0.5, w);
    expect(m.uniforms.uLook.value.toArray()).toEqual([w.shallowDepth, w.foamWidth, w.foamRing]);
    const v2 = makeWaterMaterial(pal, bend, { value: 0 }, 0.5);
    expect(v2.uniforms.uLook.value.z).toBe(WATER_LOOK_V2.foamRing);
    expect(v2.uniforms.uDepthSize.value).toBe(0);
  });
});

// BACKLOG 14a-2: painted water samples a per-cell depth texture (sea minus height) per fragment.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Terrain } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { fillDepth, fillDepthRects, makeWaterMaterial, WATER_LOOK_V2 } from "../src/terrainMesh.ts";

describe("painted water", () => {
  it("fills depth row-major as sea minus height", () => {
    const t = new Terrain({ size: 4, seaLevel: 10, heightMax: 100, drownDepth: 2, maxWalkSlope: 9, maxBuildSlope: 4 });
    t.heights[1 + 2 * 4] = 25;
    const d = fillDepth(t, new Float32Array(16));
    expect(d[0]).toBe(10);
    expect(d[1 + 2 * 4]).toBe(-15);
  });

  it("S4: a remesh refills only the dirty rects' cells, wrapping, and matches a full refill", () => {
    const t = new Terrain({ size: 32, seaLevel: 10, heightMax: 100, drownDepth: 2, maxWalkSlope: 9, maxBuildSlope: 4 });
    const d = fillDepth(t, new Float32Array(32 * 32));
    const v = t.version;
    t.raise(31, 0, 3, 20);
    const rects = t.dirtySince(v)!;
    expect(rects.length).toBeGreaterThan(0);
    const before = d.slice();
    const written = fillDepthRects(t, d, rects);
    expect(written).toBeLessThan(32 * 32);
    expect(Array.from(d)).toEqual(Array.from(fillDepth(t, new Float32Array(32 * 32))));
    // far cells were not touched
    expect(d[16 * 32 + 16]).toBe(before[16 * 32 + 16]);
  });

  it("takes the look knobs from style.json, falling back to the v2 look", () => {
    const w = basePack().files.style.render!.water!;
    const bend = { uCurve: { value: 0 }, uCenter: { value: new THREE.Vector2() } } as never;
    const pal = { water: new THREE.Color(), waterShallow: new THREE.Color(), foam: new THREE.Color() } as never;
    const m = makeWaterMaterial(pal, bend, { value: 0 }, 0.5, w);
    expect(m.uniforms.uLook.value.toArray()).toEqual([w.shallowDepth, w.foamWidth, w.foamRing]);
    expect(m.uniforms.uRing.value.toArray()).toEqual([w.ringDrift, w.ringWidth]);
    const v2 = makeWaterMaterial(pal, bend, { value: 0 }, 0.5);
    expect(v2.uniforms.uLook.value.z).toBe(WATER_LOOK_V2.foamRing);
    expect(v2.uniforms.uDepthSize.value).toBe(0);
  });
});

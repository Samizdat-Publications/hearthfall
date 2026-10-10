import { describe, expect, it } from "vitest";
import { basePack } from "../../sim/test/helpers.ts";
import { CAMERA_RIG_DEFAULTS, cameraRig, rigParams } from "../src/camera.ts";

describe("BACKLOG 41: camera rig curves are data", () => {
  it("the defaults and the shipped style give the look v2 rig", () => {
    const z = 0.42;
    const old = { distance: 11 + 120 * z * z + 20 * z, pitch: 0.78 + 0.62 * z, bendK: 0.004 + 0.026 * z * z };
    const s = { x: 0, z: 0, yaw: 0, zoom: z, map: false };
    for (const rig of [CAMERA_RIG_DEFAULTS, cameraRig(basePack().files.style.render?.camera)]) {
      const r = rigParams(s, rig);
      expect(r.distance).toBe(old.distance);
      expect(r.pitch).toBe(old.pitch);
      expect(r.bendK).toBe(old.bendK);
      expect(r.fogFar).toBe(old.distance * 2.6 + 40 + 400 * z * z);
    }
    expect(basePack().files.style.render?.verticalScale).toBe(2);
  });

  it("a style curve replaces only its own default", () => {
    const rig = cameraRig({ distance: { base: 30, linear: 0, quad: 0 } });
    const r = rigParams({ x: 0, z: 0, yaw: 0, zoom: 1, map: false }, rig);
    expect(r.distance).toBe(30);
    expect(r.pitch).toBe(0.78 + 0.62);
    expect(rig.bend).toBe(CAMERA_RIG_DEFAULTS.bend);
  });
});

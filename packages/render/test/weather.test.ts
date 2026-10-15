// BACKLOG 14: lighting presets and visual rain resolve from style.json.
import { describe, expect, it } from "vitest";
import { basePack } from "../../sim/test/helpers.ts";
import * as THREE from "three";
import { RainLayer, resolveLighting, skyHorizonFor, waterTint } from "../src/weather.ts";

describe("lighting presets and weather", () => {
  const style = basePack().files.style;
  const presets = style.lightingPresets!;
  const rain = style.weather!.rain;

  it("ships day, golden, evening and night with golden as the default", () => {
    expect(Object.keys(presets).sort()).toEqual(["day", "evening", "golden", "night"]);
    expect(style.lightingDefault).toBe("golden");
    // evening is dimmer than golden with a brighter hearth, day is the brightest
    expect(presets.evening.keyIntensity).toBeLessThan(presets.golden.keyIntensity);
    expect(presets.evening.hearthGlow).toBeGreaterThan(presets.golden.hearthGlow);
    expect(presets.day.keyIntensity).toBeGreaterThan(presets.golden.keyIntensity);
    // night is the darkest key light with the brightest hearth, so the fires carry the village
    expect(presets.night.keyIntensity).toBeLessThan(presets.evening.keyIntensity);
    expect(presets.night.hearthGlow).toBeGreaterThan(presets.evening.hearthGlow);
  });

  it("falls back to the default preset and folds rain dimming in", () => {
    expect(resolveLighting(presets, "golden", "noon", "clear", rain)).toEqual({ ...presets.golden, rain: null });
    const wet = resolveLighting(presets, "golden", "day", "rain", rain);
    expect(wet.keyIntensity).toBeCloseTo(presets.day.keyIntensity * rain.dim);
    expect(wet.ambient).toBeCloseTo(presets.day.ambient * rain.dim);
    expect(wet.rim).toBe(rain.rim);
    expect(wet.rain).toBe(rain);
    expect(resolveLighting(presets, "golden", "day", "rain", undefined).rain).toBeNull();
  });

  it("tints the unlit water: white under the default preset, darker at dusk and in rain", () => {
    const c = waterTint(presets.golden, presets.golden, new THREE.Color());
    expect([c.r, c.g, c.b].map((v) => +v.toFixed(5))).toEqual([1, 1, 1]);
    const dusk = waterTint(presets.evening, presets.golden, new THREE.Color());
    expect(dusk.b).toBeLessThan(0.7);
    const wet = waterTint(resolveLighting(presets, "golden", "golden", "rain", rain), presets.golden, new THREE.Color());
    expect(wet.g).toBeLessThan(0.8);
  });

  it("S4: the evening preset warms the space horizon; presets without one keep the base", () => {
    expect(skyHorizonFor(presets.evening, "#0f1d3d")).toBe(presets.evening.skyHorizon);
    expect(presets.evening.skyHorizon).toBeDefined();
    expect(skyHorizonFor(presets.golden, "#0f1d3d")).toBe("#0f1d3d");
  });

  it("rain layer shows the configured drop count and hides when clear", () => {
    const r = new RainLayer(1000);
    r.set({ ...rain, drops: 400 });
    expect(r.count).toBe(400);
    expect(r.mesh.geometry.drawRange.count).toBe(800);
    // S4: the streak lean comes from style.json, with the old lean as the fallback
    expect(r.slant[0]).toBeCloseTo(rain.slant?.[0] ?? 0.17);
    r.set({ ...rain, slant: [0.3, -0.1] });
    expect(r.slant[0]).toBeCloseTo(0.3);
    expect(r.slant[1]).toBeCloseTo(-0.1);
    r.set(null);
    expect(r.count).toBe(0);
  });
});

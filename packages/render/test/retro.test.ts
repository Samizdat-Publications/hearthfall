// BACKLOG 14a: tilt-shift knobs resolve from style.json and the settings or URL mode into shader uniforms.
import { describe, expect, it } from "vitest";
import { basePack } from "../../sim/test/helpers.ts";
import { RetroPass, resolveTilt, TILT_OFF, tiltUniforms } from "../src/retro.ts";

describe("tilt-shift", () => {
  const style = basePack().files.style.render!.tiltShift!;

  it("style.json carries the knobs and resolves per mode", () => {
    expect(style).toBeTruthy();
    expect(resolveTilt(style, "off")).toEqual(TILT_OFF);
    expect(resolveTilt(undefined, "on")).toEqual(TILT_OFF);
    expect(resolveTilt(style, "default").order).toBe(style.defaultOn ? style.order : "off");
    expect(resolveTilt(style, "on").order).toBe(style.order);
    expect(resolveTilt(style, "pre").order).toBe("pre");
    expect(resolveTilt(style, "post").order).toBe("post");
    expect(resolveTilt(style, "post").maxBlur).toBe(style.maxBlur);
    expect(resolveTilt({ ...style, defaultOn: false }, "default")).toEqual(TILT_OFF);
  });

  it("maps knobs to uniforms and neutralizes the lift when off", () => {
    const u = tiltUniforms(resolveTilt(style, "pre"));
    expect(u.mode).toBe(1);
    expect(tiltUniforms(resolveTilt(style, "post")).mode).toBe(2);
    expect(u.blur).toBe(style.maxBlur);
    expect(u.band).toEqual([style.bandCenter, style.bandHalf, style.falloff, style.depthWeight]);
    expect(u.lift).toEqual([style.saturation, style.contrast]);
    // the crisp Pixel look (full resolution) uses its own screen-pixel radius
    expect(style.maxBlurCrisp).toBeGreaterThan(style.maxBlur);
    expect(tiltUniforms(resolveTilt(style, "post"), 1).blur).toBe(style.maxBlurCrisp);
    expect(tiltUniforms(resolveTilt(style, "post"), 1, 720).blur).toBeCloseTo((style.maxBlurCrisp! * 720) / 1080);
    expect(tiltUniforms(resolveTilt(style, "post"), 3).blur).toBe(style.maxBlur);
    const off = tiltUniforms(TILT_OFF);
    expect(off).toMatchObject({ mode: 0, blur: 0, lift: [1, 1] });
  });

  it("turns the pass on for tilt alone and off again", () => {
    const p = new RetroPass({ pixelScale: 1, paletteLevels: 0, ditherStrength: 0 });
    expect(p.enabled).toBe(false);
    p.setOptions({ tilt: resolveTilt(style, "post") });
    expect(p.enabled).toBe(true);
    p.setOptions({ tilt: TILT_OFF });
    expect(p.enabled).toBe(false);
  });
});

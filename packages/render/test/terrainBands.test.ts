// BACKLOG 14a-4: look v3 terrain bands, snow caps on high peaks and a pale sandstone stratum on earth cliffs.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { basePack } from "../../sim/test/helpers.ts";
import { faceColor, type TerrainPalette } from "../src/terrainMesh.ts";

const pal = (look: boolean): TerrainPalette => {
  const s = basePack().files.style;
  const C = (k: string) => new THREE.Color(s.palette[k]);
  return {
    sand: C("sand"), sandWet: C("sand"), meadow: C("meadow"), moss: C("moss"), forest: C("forest"), rock: C("rock"), rockDark: C("rockDark"),
    snow: C("snow"), scar: C("scar"), water: C("water"), waterShallow: C("waterShallow"), foam: C("foam"), cliff: C("cliff"), cliffDark: C("cliffDark"),
    bands: { ...basePack().files.balance.terrain.bands },
    look: look ? s.render!.terrainBands : undefined,
    heightScale: 0.06,
    maxWalkSlope: 20,
  };
};
const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe("look v3 terrain bands", () => {
  it("caps flat high ground with snow below the old peak band", () => {
    const b = basePack().files.style.render!.terrainBands!;
    const h = b.snowFull + 15;
    const v3 = faceColor(pal(true), 120, h, h, h, 0, 11, new THREE.Color(), 0);
    const v2 = faceColor(pal(false), 120, h, h, h, 0, 11, new THREE.Color(), 0);
    expect(lum(v3)).toBeGreaterThan(lum(v2) + 0.1);
  });

  it("paints the middle stratum of an earth cliff toward sand", () => {
    // layer = floor(avg / 14) % 3 === 1 at avg 266 (19 * 14); dither moves avg by up to 11, so pick a seed that keeps it
    const p3 = pal(true);
    const p2 = pal(false);
    let found = false;
    for (let seed = 0; seed < 50 && !found; seed++) {
      const v3 = faceColor(p3, 120, 280, 260, 266, 0, seed, new THREE.Color(), 30);
      const v2 = faceColor(p2, 120, 280, 260, 266, 0, seed, new THREE.Color(), 30);
      if (!v3.equals(v2)) {
        found = true;
        expect(lum(v3)).toBeGreaterThan(lum(v2));
      }
    }
    expect(found).toBe(true);
  });
});

describe("L6-B snow tint", () => {
  it("snowTint counters the warm sun: configured caps are bluer than the neutral tint, and the default stays the old cool tint", () => {
    const b = basePack().files.style.render!.terrainBands!;
    const h = b.snowFull + 15;
    const cap = (tint: readonly [number, number, number] | undefined) => {
      const p = pal(true);
      p.look = { ...p.look!, snowTint: tint };
      return faceColor(p, 120, h, h, h, 0, 11, new THREE.Color(), 0);
    };
    const neutral = cap([1, 1, 1]);
    const set = cap(b.snowTint);
    expect(b.snowTint).toBeDefined();
    expect(set.b / set.r).toBeGreaterThan(neutral.b / neutral.r);
    // omitted knob = the look v3 default (0.97, 1, 1.06)
    const dflt = cap(undefined);
    const old = cap([0.97, 1, 1.06]);
    expect(dflt.r).toBeCloseTo(old.r, 6);
    expect(dflt.b).toBeCloseTo(old.b, 6);
  });
});

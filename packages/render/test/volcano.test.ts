// Ambient volcano: painted cones above a height threshold get a soft smoke plume and a dull rim glow, data
// driven from style.json render.ambient.volcano (the block left out turns it off). The frame loop reuses
// scratch poses, so the pose functions take an optional `out` and the embers allocate nothing per frame.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { World, createLevelWorld } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { makeBendUniforms } from "../src/curve.ts";
import {
  AMBIENT_DEFAULTS,
  AmbientLayer,
  VOLCANO_DEFAULTS,
  emberPose,
  hash01,
  resolveAmbient,
  rimGlowLevel,
  rimGlowPixels,
  volcanoPuff,
  volcanoVents,
  type Pose,
} from "../src/ambient.ts";

const pack = basePack();
const V = VOLCANO_DEFAULTS;
const F = AMBIENT_DEFAULTS.fire;

const level = (paint: unknown[]): LevelDef => {
  const raw = {
    id: "volcano_test",
    name: "Volcano test",
    order: 99,
    description: "test",
    seed: 4,
    map: { generator: "flat", size: 64, landAboveSea: 20, paint },
    tribes: [{}],
    spells: [],
    setup: [
      { spawn: "hearth", tribe: 0, at: [10, 10] },
      { spawn: "shaper", tribe: 0, at: [14, 10] },
    ],
    objectives: [{ type: "survive", seconds: 900 }],
    lose: [{ type: "timeLimit", seconds: 1200 }],
  };
  const res = validateLevel(raw, pack.files);
  if (!res.level) throw new Error(JSON.stringify(res.issues));
  return res.level;
};
const make = (paint: unknown[]) => createLevelWorld({ def: level(paint) }, pack.files, pack.hash);
const PAINT = [
  { shape: "cone", at: [40, 40], r: 14, aboveSea: 300 },
  { shape: "cone", at: [20, 44], r: 10, aboveSea: 90 },
  { shape: "disc", at: [50, 14], r: 6, aboveSea: 400 },
];
const flat = () => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2, fog: false, landAboveSea: 20 } });

describe("volcano look", () => {
  it("the block left out means no volcano; a partial block merges over the defaults", () => {
    expect(resolveAmbient(undefined).volcano).toBeUndefined();
    expect(resolveAmbient({ smoke: { puffs: 2 } }).volcano).toBeUndefined();
    expect("volcano" in resolveAmbient({})).toBe(false);
    const a = resolveAmbient({ volcano: { puffs: 3, glowColor: "#ff0000" } });
    expect(a.volcano?.puffs).toBe(3);
    expect(a.volcano?.glowColor).toBe("#ff0000");
    expect(a.volcano?.period).toBe(V.period);
    expect(a.volcano?.enabled).toBe(true);
  });

  it("the shipped style.json block parses and matches the code defaults", () => {
    const style = pack.files.style.render?.ambient?.volcano;
    expect(style).toBeDefined();
    expect(resolveAmbient({ volcano: style }).volcano).toEqual(V);
  });
});

describe("volcanoVents", () => {
  it("finds painted cones that stand tall over the sea, not low hills or discs", () => {
    const w = make(PAINT);
    const vents = volcanoVents(w, V);
    expect(vents).toHaveLength(1);
    expect(vents[0].x).toBe(40);
    expect(vents[0].z).toBe(40);
    // a lower threshold takes the hill too; the disc is never a cone
    expect(volcanoVents(w, { ...V, minAboveSea: 50 })).toHaveLength(2);
    // the cap
    expect(volcanoVents(w, { ...V, minAboveSea: 50, vents: 1 })).toHaveLength(1);
    expect(volcanoVents(w, { ...V, vents: 0 })).toHaveLength(0);
  });

  it("a world without a level has no vents", () => {
    expect(volcanoVents(flat(), V)).toEqual([]);
  });

  it("the shipped Ash Peak level has exactly one volcano", () => {
    const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../../../data/levels/ash_peak.json", import.meta.url)), "utf8"));
    const res = validateLevel(raw, pack.files);
    if (!res.level) throw new Error(JSON.stringify(res.issues));
    // the level has AI tribes (a world needs a controller factory); the vents only read the level def
    const vents = volcanoVents({ level: { def: res.level } } as unknown as World, V);
    expect(vents).toHaveLength(1);
    expect([vents[0].x, vents[0].z]).toEqual([64, 62]);
  });
});

describe("volcanoPuff and rimGlowLevel (pure)", () => {
  it("writes into the given object and returns it, the same at the same time", () => {
    const out: Pose = { phase: 0, dx: 0, dy: 0, dz: 0, r: 0 };
    const a = volcanoPuff(out, 12.5, 3, 2, V);
    expect(a).toBe(out);
    const copy = { ...a };
    expect(volcanoPuff({ phase: 0, dx: 0, dy: 0, dz: 0, r: 0 }, 12.5, 3, 2, V)).toEqual(copy);
    expect(a.dy).toBeCloseTo(V.rise * a.phase);
  });

  it("a puff climbs, widens, leans downwind more and more, and thins out before it restarts", () => {
    const out: Pose = { phase: 0, dx: 0, dy: 0, dz: 0, r: 0 };
    // find the time this puff leaves the crater
    const off = volcanoPuff(out, 0, 5, 1, V).phase;
    const t0 = (1 - off) * V.period;
    expect(volcanoPuff(out, t0 + 1e-6, 5, 1, V).phase).toBeLessThan(1e-3);
    let lastDy = -1;
    for (let s = 1; s < 40; s++) {
      const p = volcanoPuff(out, t0 + (s / 40) * V.period, 5, 1, V);
      expect(p.dy).toBeGreaterThan(lastDy);
      lastDy = p.dy;
    }
    // swells in from nothing, fat at midlife, gone at the end
    expect(volcanoPuff(out, t0 + 1e-6, 5, 1, V).r).toBeLessThan(V.size * 0.05);
    const mid = volcanoPuff(out, t0 + V.period * 0.5, 5, 1, V).r;
    expect(mid).toBeGreaterThan(V.size * 2);
    expect(volcanoPuff(out, t0 + V.period * 0.999, 5, 1, V).r).toBeLessThan(V.size * 0.1);
    // the lean along the wind grows with the square of the life (the jitter and sway are under 1 unit)
    const lowLean = volcanoPuff(out, t0 + V.period * 0.2, 5, 1, V).dx;
    const highLean = volcanoPuff(out, t0 + V.period * 0.7, 5, 1, V).dx;
    expect(highLean - lowLean).toBeGreaterThan(V.drift * 0.3);
    // the puffs of one vent are spread over the life, not stacked
    const phases = Array.from({ length: V.puffs }, (_, k) => volcanoPuff(out, 3, 9, k, V).phase.toFixed(3));
    expect(new Set(phases).size).toBe(V.puffs);
  });

  it("the rim glow breathes within its pulse share, each vent on its own phase", () => {
    const levels = Array.from({ length: 200 }, (_, s) => rimGlowLevel(s * 0.1, 7, V));
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(1 - V.pulse - 1e-9);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1 + V.pulse + 1e-9);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(V.pulse);
    expect(rimGlowLevel(0, 1, V)).not.toBeCloseTo(rimGlowLevel(0, 2, V), 3);
    expect(rimGlowLevel(5, 3, { pulse: 0, pulseRate: 1 })).toBe(1);
  });

  it("the rim texture is a ring: dark in the middle and at the corners, bright between", () => {
    const size = 32;
    const px = rimGlowPixels(size);
    const at = (x: number, y: number) => px[(y * size + x) * 4];
    expect(at(16, 16)).toBeLessThan(40);
    expect(at(0, 0)).toBe(0);
    // 70 percent of the radius out along the row through the middle
    expect(at(16 + Math.round(0.7 * 16), 16)).toBeGreaterThan(200);
  });
});

describe("emberPose without per-frame allocation", () => {
  // the original closure version, as the reference for the values
  const reference = (t: number, seed: number, k: number) => {
    const h = (m: number) => hash01(seed * 37 + k * 11 + m);
    const frac = (x: number) => x - Math.floor(x);
    const phase = frac(t / F.emberPeriod + h(1) + k / Math.max(1, F.embers));
    const a = h(2) * 6.283 + phase * (2 + 3 * h(3));
    const spread = F.emberSpread * (0.3 + phase);
    return { phase, dx: Math.cos(a) * spread, dy: F.emberRise * phase * (0.7 + 0.3 * h(4)), dz: Math.sin(a) * spread, r: F.emberSize * (1 - phase) * (0.6 + 0.4 * h(5)) };
  };

  it("keeps the values and the return shape, with or without an out object", () => {
    for (const [t, seed, k] of [[0, 1, 0], [4.4, 21, 2], [123.456, 59 * 7 + 13, 5], [9.99, 3, 1]] as const) {
      const fresh = emberPose(t, seed, k, F);
      expect(Object.keys(fresh).sort()).toEqual(["dx", "dy", "dz", "phase", "r"]);
      expect(fresh).toEqual(reference(t, seed, k));
    }
  });

  it("writes into the out object and returns it, so a loop can reuse one", () => {
    const out: Pose = { phase: -1, dx: -1, dy: -1, dz: -1, r: -1 };
    const a = emberPose(4.4, 21, 2, F, out);
    expect(a).toBe(out);
    expect(out).toEqual(reference(4.4, 21, 2));
    // a second call overwrites every field
    emberPose(7.7, 5, 3, F, out);
    expect(out).toEqual(reference(7.7, 5, 3));
  });
});

describe("AmbientLayer volcano", () => {
  const draw = (amb: AmbientLayer, w: World, t: number, over: { zoom?: number; map?: boolean; revealAll?: boolean; glow?: number } = {}) =>
    amb.update(w, t, 40, 40, 1, 1000, over.zoom ?? 0.42, over.map ?? false, "golden", false, null, null, 0, over.revealAll ?? true, over.glow ?? 1);
  const volcanic = () => new AmbientLayer(makeBendUniforms(), resolveAmbient({ volcano: {} }));
  const mesh = (amb: AmbientLayer, i: number) => amb.group.children[i] as THREE.InstancedMesh;

  it("without a style block there is no plume, no rim and no extra meshes", () => {
    const w = make(PAINT);
    const amb = new AmbientLayer(makeBendUniforms());
    expect(amb.group.children).toHaveLength(6);
    draw(amb, w, 5);
    expect(amb.counts.plume).toBe(0);
    expect(amb.counts.rims).toBe(0);
    expect(amb.volcanoes(w)).toEqual([]);
    // a block with enabled false is off too
    const off = new AmbientLayer(makeBendUniforms(), resolveAmbient({ volcano: { enabled: false } }));
    expect(off.group.children).toHaveLength(6);
    draw(off, w, 5);
    expect(off.counts.plume).toBe(0);
  });

  it("the new meshes come after the six existing ones", () => {
    const amb = volcanic();
    expect(amb.group.children).toHaveLength(8);
  });

  it("draws a plume above the crater and one rim glow for the one vent", () => {
    const w = make(PAINT);
    const amb = volcanic();
    draw(amb, w, 5);
    expect(amb.counts.rims).toBe(1);
    expect(amb.counts.plume).toBeGreaterThan(0);
    expect(amb.counts.plume).toBeLessThanOrEqual(V.puffs);
    const crater = Math.max(w.terrain.heightAt(40, 40), w.terrain.sea);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const plume = mesh(amb, 6);
    expect(plume.count).toBe(amb.counts.plume);
    for (let i = 0; i < plume.count; i++) {
      plume.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      expect(p.y).toBeGreaterThanOrEqual(crater - 1e-6);
      expect(p.y).toBeLessThanOrEqual(crater + V.rise + 1e-6);
      expect(Math.hypot(p.x - 40, p.z - 40)).toBeLessThan(V.drift + 2);
    }
    // the rim sits near the crater height and is centered on the vent
    const rim = mesh(amb, 7);
    rim.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.z).toBeCloseTo(40, 6);
    expect(p.y).toBeLessThan(crater + 1);
    expect(p.y).toBeGreaterThan(w.terrain.sea - 1);
  });

  it("is the same at the same time and moves as time moves", () => {
    const w = make(PAINT);
    const amb = volcanic();
    const m = new THREE.Matrix4();
    draw(amb, w, 5);
    mesh(amb, 6).getMatrixAt(0, m);
    const first = m.elements.slice();
    draw(amb, w, 5.5);
    mesh(amb, 6).getMatrixAt(0, m);
    expect(m.elements).not.toEqual(first);
    draw(amb, w, 5);
    mesh(amb, 6).getMatrixAt(0, m);
    expect(m.elements).toEqual(first);
  });

  it("the rim brightens with the lighting preset and the plume has no effect on other counts", () => {
    const w = make(PAINT);
    const amb = volcanic();
    const color = (glow: number) => {
      draw(amb, w, 5, { glow });
      const c = new THREE.Color();
      mesh(amb, 7).getColorAt(0, c);
      return c.r;
    };
    expect(color(2)).toBeGreaterThan(color(0.5));
    expect(amb.counts.smoke).toBe(0);
    expect(amb.counts.birds).toBe(0);
  });

  it("hides in map view, zoomed out, and in the dark unless revealed", () => {
    const w = make(PAINT);
    const amb = volcanic();
    draw(amb, w, 5);
    expect(amb.counts.plume).toBeGreaterThan(0);
    draw(amb, w, 5, { map: true });
    expect(amb.counts.plume).toBe(0);
    expect(amb.counts.rims).toBe(0);
    expect(mesh(amb, 6).count).toBe(0);
    expect(mesh(amb, 7).count).toBe(0);
    draw(amb, w, 5, { zoom: 0.95 });
    expect(amb.counts.plume).toBe(0);
    // fog of war: the vent is far from the tribe's hearth
    expect(w.vision.seen(0, 40, 40)).toBe(false);
    draw(amb, w, 5, { revealAll: false });
    expect(amb.counts.plume).toBe(0);
    expect(amb.counts.rims).toBe(0);
    draw(amb, w, 5, { revealAll: true });
    expect(amb.counts.rims).toBe(1);
  });

  it("a vent past the horizon fade is skipped and the plume obeys its cap", () => {
    const w = make(PAINT);
    const amb = new AmbientLayer(makeBendUniforms(), resolveAmbient({ volcano: { max: 3 } }));
    draw(amb, w, 5);
    expect(amb.counts.plume).toBeLessThanOrEqual(3);
    // fadeEnd 10: the focus (40, 40) is on the vent, so move the focus away by 30 cells
    amb.update(w, 5, 10, 10, 1, 10, 0.42, false, "golden", false, null, null, 0, true, 1);
    expect(amb.counts.plume).toBe(0);
    expect(amb.counts.rims).toBe(0);
  });
});

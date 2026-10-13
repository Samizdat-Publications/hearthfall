// Render polish: ambient life. Every puff, bird and firefly is a pure function of the visual time and the
// world, so fixedStep shots stay reproducible; spawn rules (finished smoking buildings, forest or shore
// flocks, dusk presets without rain, walkers on dry land) and the setting turn them on and off.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { UnitLayer } from "../src/unitsLayer.ts";
import { BuildingLayer } from "../src/buildingsLayer.ts";
import { makeBendUniforms } from "../src/curve.ts";
import {
  AMBIENT_DEFAULTS,
  AmbientLayer,
  birdPose,
  dustEligible,
  dustPuff,
  emberPose,
  fireStrength,
  fireflyPose,
  firefliesOut,
  flockAnchors,
  glintFor,
  hearthFlicker,
  resolveAmbient,
  smokePuff,
} from "../src/ambient.ts";

const pack = basePack();
const pal = { azure: "#2e6fd8", crimson: "#d83a2e", cloth: "#d9cbb0" };
const world = (generator = "flat", landAboveSea?: number) =>
  new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator, size: 64, tribes: 2, fog: false, landAboveSea } });
const L = AMBIENT_DEFAULTS;

describe("ambient spawn rules (pure)", () => {
  it("style overrides merge over the defaults per effect", () => {
    const a = resolveAmbient({ smoke: { puffs: 2 }, fireflies: { presets: ["golden"] } });
    expect(a.smoke.puffs).toBe(2);
    expect(a.smoke.period).toBe(L.smoke.period);
    expect(a.fireflies.presets).toEqual(["golden"]);
    expect(a.birds).toEqual(L.birds);
    expect(resolveAmbient(undefined)).toEqual(L);
  });

  it("a smoke puff rises with its phase, is the same at the same time and thins out before it restarts", () => {
    const a = smokePuff(10.25, 42, 1, L.smoke);
    expect(smokePuff(10.25, 42, 1, L.smoke)).toEqual(a);
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(1);
    expect(a.dy).toBeCloseTo(L.smoke.rise * a.phase);
    // walk a puff through one whole life: it rises steadily and its radius goes to zero at the end
    const steps = 40;
    let lastDy = -1;
    let lastR = 0;
    // the time this puff leaves the chimney: its phase offset at t = 0 is (a.phase - 10.25 / period) mod 1
    const off = a.phase - 10.25 / L.smoke.period;
    const t0 = (3 - (off - Math.floor(off))) * L.smoke.period;
    expect(smokePuff(t0 + 1e-6, 42, 1, L.smoke).phase).toBeLessThan(1e-3);
    for (let s = 0; s < steps; s++) {
      const p = smokePuff(t0 + (s / steps) * L.smoke.period * 0.999, 42, 1, L.smoke);
      if (s > 0) expect(p.dy).toBeGreaterThan(lastDy);
      lastDy = p.dy;
      lastR = p.r;
    }
    expect(lastR).toBeLessThan(smokePuff(t0 + L.smoke.period * 0.5, 42, 1, L.smoke).r);
    expect(smokePuff(t0 + L.smoke.period * 0.999, 42, 1, L.smoke).r).toBeLessThan(L.smoke.size * 0.05);
    // the puffs of one chimney are spread over the life, not stacked
    const phases = Array.from({ length: L.smoke.puffs }, (_, k) => smokePuff(3, 9, k, L.smoke).phase);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(L.smoke.puffs);
  });

  it("fireflies come out only under the listed presets and never in rain; they blink", () => {
    expect(firefliesOut(L.fireflies, "evening", false)).toBe(true);
    expect(firefliesOut(L.fireflies, "day", false)).toBe(false);
    expect(firefliesOut(L.fireflies, "evening", true)).toBe(false);
    expect(firefliesOut({ ...L.fireflies, enabled: false }, "evening", false)).toBe(false);
    const glows = Array.from({ length: 60 }, (_, s) => fireflyPose(s * 0.25, 5, 0, L.fireflies).glow);
    expect(Math.min(...glows)).toBe(0);
    expect(Math.max(...glows)).toBeGreaterThan(0.8);
    const f = fireflyPose(12, 5, 3, L.fireflies);
    expect(Math.hypot(f.dx, f.dz)).toBeLessThanOrEqual(L.fireflies.radius * Math.SQRT2 + 1e-9);
    expect(f.dy).toBeGreaterThan(0.3);
  });

  it("water glints: per preset strength and color, none in rain, with the setting off, unlisted presets or low quality", () => {
    const G = L.glints;
    const day = glintFor(G, "day", false, true, 1);
    const night = glintFor(G, "night", false, true, 1);
    expect(day.strength).toBe(G.presets.day.strength);
    expect(day.color).toBe(G.presets.day.color);
    expect(glintFor(G, "evening", false, true, 1).strength).toBeGreaterThan(glintFor(G, "golden", false, true, 1).strength);
    expect(night.strength).toBeGreaterThan(0);
    expect(night.strength).toBeLessThan(day.strength);
    expect(glintFor(G, "day", true, true, 1).strength).toBe(0);
    expect(glintFor({ ...G, rain: 0.5 }, "day", true, true, 1).strength).toBeCloseTo(day.strength * 0.5);
    expect(glintFor(G, "day", false, false, 1).strength).toBe(0);
    expect(glintFor(G, "storm", false, true, 1).strength).toBe(0);
    expect(glintFor(G, "day", false, true, 0.5).strength).toBe(0);
    expect(glintFor(G, "day", false, true, G.minQuality).strength).toBe(day.strength);
    expect(glintFor({ ...G, enabled: false }, "day", false, true, 1).strength).toBe(0);
    expect(resolveAmbient({ glints: { near: 10 } }).glints.presets).toEqual(G.presets);
  });

  it("hearth fire: lit under the fire presets scaled by hearthGlow, dimmed by rain; the flicker stays in its band", () => {
    const F = L.fire;
    expect(fireStrength(F, "golden", false, 1)).toBe(0);
    expect(fireStrength(F, "evening", false, 1.9)).toBeCloseTo(1.9);
    expect(fireStrength(F, "night", false, 1)).toBe(1);
    expect(fireStrength(F, "evening", true, 2)).toBeCloseTo(2 * F.rain);
    expect(fireStrength({ ...F, enabled: false }, "evening", false, 1)).toBe(0);
    const fl = Array.from({ length: 400 }, (_, s) => hearthFlicker(s * 0.037, 7, F));
    expect(Math.min(...fl)).toBeGreaterThanOrEqual(1 - F.flicker - 1e-9);
    expect(Math.max(...fl)).toBeLessThanOrEqual(1 + F.flicker + 1e-9);
    expect(Math.max(...fl) - Math.min(...fl)).toBeGreaterThan(F.flicker);
    expect(hearthFlicker(3.21, 7, F)).toBe(hearthFlicker(3.21, 7, F));
    expect(hearthFlicker(3.21, 7, F)).not.toBe(hearthFlicker(3.21, 8, F));
    expect(hearthFlicker(5, 7, { ...F, flicker: 0 })).toBe(1);
  });

  it("an ember rises from the fire, shrinks to nothing at the top and the embers of one fire are spread over the life", () => {
    const F = L.fire;
    const a = emberPose(4.4, 21, 2, F);
    expect(emberPose(4.4, 21, 2, F)).toEqual(a);
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(1);
    expect(a.dy).toBeGreaterThanOrEqual(0);
    expect(a.dy).toBeLessThanOrEqual(F.emberRise);
    expect(Math.hypot(a.dx, a.dz)).toBeLessThanOrEqual(F.emberSpread * 1.3 + 1e-9);
    // follow one ember through a life: it climbs steadily and its radius goes to zero
    const off = a.phase - 4.4 / F.emberPeriod;
    const t0 = (3 - (off - Math.floor(off))) * F.emberPeriod;
    let lastDy = -1;
    for (let s = 0; s < 30; s++) {
      const e = emberPose(t0 + 1e-6 + (s / 30) * F.emberPeriod * 0.998, 21, 2, F);
      expect(e.dy).toBeGreaterThan(lastDy);
      lastDy = e.dy;
    }
    expect(emberPose(t0 + F.emberPeriod * 0.999, 21, 2, F).r).toBeLessThan(F.emberSize * 0.01);
    const phases = Array.from({ length: F.embers }, (_, k) => emberPose(2, 9, k, F).phase);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(F.embers);
  });

  it("dust only rises behind walkers on dry land near the focus", () => {
    const sea = 120;
    expect(dustEligible(true, sea + 10, sea, 4, L.dust)).toBe(true);
    expect(dustEligible(false, sea + 10, sea, 4, L.dust)).toBe(false);
    expect(dustEligible(true, sea + 1, sea, 4, L.dust)).toBe(false);
    expect(dustEligible(true, sea + 10, sea, (L.dust.radius + 1) ** 2, L.dust)).toBe(false);
    const p = dustPuff(3.3, 17, 0, L.dust);
    expect(p).toEqual(dustPuff(3.3, 17, 0, L.dust));
    expect(p.back).toBeCloseTo(L.dust.trail * p.phase);
  });

  it("birds circle their anchor: same pose at the same time, heading along the circle", () => {
    const a = birdPose(4, 11, 2, L.birds);
    expect(birdPose(4, 11, 2, L.birds)).toEqual(a);
    const b = birdPose(4.01, 11, 2, L.birds);
    const vx = b.dx - a.dx;
    const vz = b.dz - a.dz;
    // the V's nose (+z) turned by the heading points where the bird moves
    expect(Math.sin(a.heading) * vx + Math.cos(a.heading) * vz).toBeGreaterThan(0);
    expect(Math.abs(a.flap)).toBeLessThanOrEqual(1);
  });

  it("flocks gather over forests and shores, not over bare high ground", () => {
    const bare = world("flat", 40);
    expect(flockAnchors(bare, L.birds)).toEqual([]);
    const shore = world("flat", 3);
    const s = flockAnchors(shore, L.birds);
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((a) => a.kind === "shore")).toBe(true);
    const forest = world("flat", 40);
    for (let k = 0; k < 40; k++) forest.spawnTree(10 + (k % 7) * 0.6, 10 + Math.floor(k / 7) * 0.6);
    const f = flockAnchors(forest, L.birds);
    expect(f.length).toBe(1);
    expect(f[0].kind).toBe("forest");
    expect(Math.hypot(f[0].x - 12, f[0].z - 12)).toBeLessThan(L.birds.forestReach + 3);
  });
});

describe("ambient layer", () => {
  const scene = (w: World) => {
    const b = new BuildingLayer(new THREE.MeshBasicMaterial(), pack.files.buildings.buildings, pal, ["azure", "crimson"]);
    const u = new UnitLayer(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), pack.files.units.units.map((x) => x.id), pal, ["azure", "crimson"]);
    b.update(w, 20, 20, 1);
    u.update(w, 1, 20, 20, 1, 0, 1000, new THREE.PerspectiveCamera(), 0, 100, 100, new Set());
    return { b, u };
  };
  const run = (amb: AmbientLayer, w: World, t: number, s: { b: BuildingLayer; u: UnitLayer }, preset = "golden", map = false, zoom = 0.42) =>
    amb.update(w, t, 20, 20, 1, 1000, zoom, map, preset, false, s.u, s.b, 0, false);

  it("smokes over finished Dwellings only, the same at the same time, off with the setting or in map view", () => {
    const w = world();
    const done = w.ents.index(w.spawnBuilding("dwelling", 0, 20, 20));
    const plan = w.ents.index(w.spawnBuilding("dwelling", 0, 26, 20));
    w.ents.state[done] = 3;
    w.ents.state[plan] = 0;
    const s = scene(w);
    const amb = new AmbientLayer(makeBendUniforms());
    run(amb, w, 5, s);
    expect(amb.counts.smoke).toBeGreaterThan(0);
    expect(amb.counts.smoke).toBeLessThanOrEqual(L.smoke.puffs);
    const group = amb.group.children as THREE.InstancedMesh[];
    const smoke = group[0];
    const m = new THREE.Matrix4();
    smoke.getMatrixAt(0, m);
    const first = m.elements.slice();
    // every puff starts above the roof and near the chimney
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.y).toBeGreaterThan(s.b.drawTop[done] - 0.1);
    expect(Math.hypot(p.x - 20, p.z - 20)).toBeLessThan(2);
    run(amb, w, 5.5, s);
    smoke.getMatrixAt(0, m);
    expect(m.elements).not.toEqual(first);
    run(amb, w, 5, s);
    smoke.getMatrixAt(0, m);
    expect(m.elements).toEqual(first);
    amb.enabled = false;
    run(amb, w, 5, s);
    expect(amb.counts.smoke).toBe(0);
    amb.enabled = true;
    run(amb, w, 5, s, "golden", true);
    expect(amb.counts.smoke).toBe(0);
    run(amb, w, 5, s, "golden", false, 0.95);
    expect(amb.counts.smoke).toBe(0);
  });

  it("fireflies circle the Hearth under the evening preset only", () => {
    const w = world();
    const h = w.ents.index(w.spawnBuilding("hearth", 0, 20, 20));
    w.ents.state[h] = 3;
    const s = scene(w);
    const amb = new AmbientLayer(makeBendUniforms());
    run(amb, w, 3, s, "golden");
    expect(amb.counts.fireflies).toBe(0);
    let lit = 0;
    for (let t = 0; t < 4; t += 0.5) {
      run(amb, w, t, s, "evening");
      lit = Math.max(lit, amb.counts.fireflies);
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(L.fireflies.perHearth);
  });

  it("lights the Hearth fire (glow pool, embers) and warm pools round finished homes at evening only, the same at the same time", () => {
    const w = world();
    const h = w.ents.index(w.spawnBuilding("hearth", 0, 20, 20));
    const home = w.ents.index(w.spawnBuilding("dwelling", 0, 25, 20));
    const plan = w.ents.index(w.spawnBuilding("dwelling", 0, 15, 20));
    w.ents.state[h] = 3;
    w.ents.state[home] = 3;
    w.ents.state[plan] = 0;
    const s = scene(w);
    const amb = new AmbientLayer(makeBendUniforms());
    const at = (t: number, preset: string, glow = 1, raining = false) =>
      amb.update(w, t, 20, 20, 1, 1000, 0.42, false, preset, raining, s.u, s.b, 0, false, glow);
    at(2, "golden");
    expect(amb.counts.glows).toBe(0);
    expect(amb.counts.embers).toBe(0);
    expect(amb.fire).toBe(0);
    at(2, "evening", 1.9);
    expect(amb.fire).toBeCloseTo(1.9);
    // one pool for the Hearth and one for the finished home, none for the plan
    expect(amb.counts.glows).toBe(2);
    expect(amb.counts.embers).toBeGreaterThan(0);
    expect(amb.counts.embers).toBeLessThanOrEqual(L.fire.embers);
    const meshes = amb.group.children as THREE.InstancedMesh[];
    const glows = meshes[4];
    const m = new THREE.Matrix4();
    glows.getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(Math.hypot(p.x - s.b.drawX[h], p.z - s.b.drawZ[h])).toBeLessThan(1e-6);
    expect(p.y).toBeGreaterThan(s.b.drawGround[h]);
    const c1 = new THREE.Color();
    glows.getColorAt(0, c1);
    const first = m.elements.slice();
    at(2.37, "evening", 1.9);
    const c2 = new THREE.Color();
    glows.getColorAt(0, c2);
    expect(c2.r).not.toBeCloseTo(c1.r, 6);
    at(2, "evening", 1.9);
    glows.getMatrixAt(0, m);
    expect(m.elements).toEqual(first);
    // brighter with a larger hearthGlow, hearth pool brighter than the home pool
    const home1 = new THREE.Color();
    glows.getColorAt(1, home1);
    expect(c1.r).toBeGreaterThan(home1.r);
    at(2, "evening", 1);
    const dim = new THREE.Color();
    glows.getColorAt(0, dim);
    expect(dim.r).toBeLessThan(c1.r);
    amb.enabled = false;
    at(2, "evening", 1.9);
    expect(amb.counts.glows + amb.counts.embers).toBe(0);
    expect(amb.fire).toBe(0);
  });

  it("kicks up dust behind walking units on dry land, none behind standing ones", () => {
    const w = world();
    const a = w.ents.index(w.spawnUnit("settler", 0, 20, 20));
    w.ents.index(w.spawnUnit("settler", 0, 22, 20));
    w.ents.vx[a] = 0.1;
    const s = scene(w);
    const amb = new AmbientLayer(makeBendUniforms());
    run(amb, w, 2, s);
    expect(amb.counts.dust).toBeGreaterThan(0);
    expect(amb.counts.dust).toBeLessThanOrEqual(L.dust.perUnit);
    w.ents.vx[a] = 0;
    const s2 = scene(w);
    run(amb, w, 2, s2);
    expect(amb.counts.dust).toBe(0);
  });

  it("draws bird flocks over a shore world within the drawn radius", () => {
    const w = world("flat", 3);
    const s = scene(w);
    const amb = new AmbientLayer(makeBendUniforms());
    run(amb, w, 1, s);
    expect(amb.counts.birds).toBeGreaterThan(0);
    expect(amb.counts.birds % L.birds.perFlock).toBe(0);
    expect(amb.flocks(w).length * L.birds.perFlock).toBeGreaterThanOrEqual(amb.counts.birds);
  });
});

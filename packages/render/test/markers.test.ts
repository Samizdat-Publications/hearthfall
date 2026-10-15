// Chapter 4 prep: world markers. The pure helpers (countdown, ring geometry, procedural textures, the fog-free
// shader patch), the look defaults against style.json, and the layer: a pin and ring per explored wolf den, a beam
// and a wide ring on clearDens beacons, a closing ring and a number on a neutral hazard.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { World, createLevelWorld, denMarks } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { BEND_FRAGMENT_FADE, bendMaterial, makeBendUniforms } from "../src/curve.ts";
import {
  DIGIT_CELL,
  DIGIT_FONT,
  MARKER_DEFAULTS,
  MarkerLayer,
  beamPixels,
  countdownDigits,
  denIconPixels,
  digitAtlasPixels,
  hazardProgress,
  hazardSeconds,
  markerPulse,
  pinBob,
  resolveMarkers,
  ringPoint,
  unfoggedFade,
  wrapOffset,
} from "../src/markers.ts";

const pack = basePack();
const flat = (fog?: boolean) => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2, fog } });
const camera = () => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  c.position.set(20, 40, 40);
  c.lookAt(20, 0, 20);
  c.updateMatrixWorld();
  return c;
};
const HS = 2 / 32;
const alphaAt = (px: Uint8Array, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];
const redAt = (px: Uint8Array, w: number, x: number, y: number) => px[(y * w + x) * 4];

describe("marker helpers (pure)", () => {
  it("the countdown reads whole seconds rounded up, in digits", () => {
    expect(hazardSeconds(160, 20)).toBe(8);
    expect(hazardSeconds(141, 20)).toBe(8);
    expect(hazardSeconds(140, 20)).toBe(7);
    expect(hazardSeconds(1, 20)).toBe(1);
    expect(hazardSeconds(0, 20)).toBe(0);
    expect(hazardSeconds(-5, 20)).toBe(0);
    expect(hazardSeconds(1e6, 20)).toBe(99);
    const d: number[] = [];
    expect(countdownDigits(8, d)).toBe(1);
    expect(d[0]).toBe(8);
    expect(countdownDigits(12, d)).toBe(2);
    expect(d.slice(0, 2)).toEqual([1, 2]);
    expect(countdownDigits(60, d)).toBe(2);
    expect(d.slice(0, 2)).toEqual([6, 0]);
    expect(countdownDigits(0, d)).toBe(1);
    expect(d[0]).toBe(0);
  });

  it("progress runs from 0 to 1 over the warning and is clamped", () => {
    expect(hazardProgress(160, 160)).toBe(0);
    expect(hazardProgress(80, 160)).toBe(0.5);
    expect(hazardProgress(0, 160)).toBe(1);
    expect(hazardProgress(-4, 160)).toBe(1);
    expect(hazardProgress(200, 160)).toBe(0);
    expect(hazardProgress(5, 0)).toBe(1);
  });

  it("the pulse stays in [0, 1], quickens with progress, and a pin bob differs per den", () => {
    for (let t = 0; t < 5; t += 0.07) for (const p of [0, 0.5, 1]) expect(markerPulse(t, 2, p)).toBeGreaterThanOrEqual(0), expect(markerPulse(t, 2, p)).toBeLessThanOrEqual(1);
    // a quarter period at rate 1 is the peak; with progress 1 the same time is already 3x further round
    expect(markerPulse(0.25, 1, 0)).toBeCloseTo(1, 9);
    expect(markerPulse(0.25, 1, 1)).not.toBeCloseTo(1, 3);
    expect(pinBob(1.3, 0, 0.2, 2)).not.toBeCloseTo(pinBob(1.3, 1, 0.2, 2), 3);
    expect(Math.abs(pinBob(7, 3, 0.2, 2.2))).toBeLessThanOrEqual(0.2);
  });

  it("ring points lie on the circle and a segment turned by the yaw lies along the tangent", () => {
    const out = { x: 0, z: 0, yaw: 0 };
    const q = new THREE.Quaternion();
    const x = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      ringPoint(10, 20, 4, i, 12, out);
      expect(Math.hypot(out.x - 10, out.z - 20)).toBeCloseTo(4, 9);
      // the local X axis of the segment, turned by yaw about Y, is perpendicular to the radius
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), out.yaw);
      x.set(1, 0, 0).applyQuaternion(q);
      expect(x.x * (out.x - 10) + x.z * (out.z - 20)).toBeCloseTo(0, 9);
    }
  });

  it("the nearest copy of a point on the wrapped planet", () => {
    expect(wrapOffset(60, 4, 64)).toBe(-8);
    expect(wrapOffset(5, 60, 64)).toBe(9);
    expect(wrapOffset(30, 20, 64)).toBe(10);
    expect(wrapOffset(2, 60, 64)).toBe(6);
  });
});

describe("marker textures (procedural, no DOM)", () => {
  it("the den icon is a pin: clear corners, an opaque body, a dark rim and a dark paw on a light body", () => {
    const n = 64;
    const px = denIconPixels(n);
    expect(px.length).toBe(n * n * 4);
    // row 0 is the bottom: the corners are empty, the tip is near the bottom centre and the head is round
    expect(alphaAt(px, n, 0, 0)).toBe(0);
    expect(alphaAt(px, n, n - 1, n - 1)).toBe(0);
    expect(alphaAt(px, n, 32, 6)).toBeGreaterThan(200);
    expect(alphaAt(px, n, 32, 63)).toBe(0);
    // body (light) below the paw, paw (dark) at its pad, rim (dark) at the head's edge
    expect(redAt(px, n, 32, 24)).toBeGreaterThan(220);
    expect(redAt(px, n, 32, 38)).toBeLessThan(80);
    expect(redAt(px, n, 32, 60)).toBeLessThan(80);
    expect(alphaAt(px, n, 32, 60)).toBeGreaterThan(200);
  });

  it("the beam is brightest at its foot and centre, and fades up and to the sides", () => {
    const w = 16;
    const h = 64;
    const px = beamPixels(w, h);
    expect(px.length).toBe(w * h * 4);
    expect(alphaAt(px, w, 8, 1)).toBeGreaterThan(alphaAt(px, w, 8, 30));
    expect(alphaAt(px, w, 8, 30)).toBeGreaterThan(alphaAt(px, w, 8, 60));
    expect(alphaAt(px, w, 8, 10)).toBeGreaterThan(alphaAt(px, w, 1, 10));
    expect(alphaAt(px, w, 8, h - 1)).toBeLessThan(40);
  });

  it("the digit atlas has ten distinct glyphs, each lit inside its own cell with a dark outline", () => {
    const a = digitAtlasPixels();
    expect(a.width).toBe(DIGIT_CELL.w * 10);
    expect(a.height).toBe(DIGIT_CELL.h);
    expect(a.data.length).toBe(a.width * a.height * 4);
    expect(DIGIT_FONT).toHaveLength(10);
    const lit: number[] = [];
    const ink: number[] = [];
    for (let g = 0; g < 10; g++) {
      let l = 0;
      let o = 0;
      for (let y = 0; y < a.height; y++)
        for (let x = g * DIGIT_CELL.w; x < (g + 1) * DIGIT_CELL.w; x++) {
          const i = (y * a.width + x) * 4;
          if (a.data[i + 3] === 255 && a.data[i] === 255) l++;
          else if (a.data[i + 3] === 255) o++;
        }
      lit.push(l);
      ink.push(o);
    }
    // a 1 has fewer lit pixels than an 8; every glyph has an outline; the font rows are 3 wide
    expect(lit[1]).toBeLessThan(lit[8]);
    expect(ink.every((v) => v > 0)).toBe(true);
    expect(DIGIT_FONT.every((rows) => rows.length === 5 && rows.every((r) => r.length === 3))).toBe(true);
    expect(new Set(DIGIT_FONT.map((r) => r.join("|"))).size).toBe(10);
  });
});

describe("fog-free marker material", () => {
  it("drops the fog of war darkening from the bend fragment patch and keeps the horizon fade and far cut", () => {
    const f = unfoggedFade();
    expect(BEND_FRAGMENT_FADE).toContain("uFogOn > 0.5");
    expect(f).not.toContain("uFogOn");
    expect(f).not.toContain("hfFog");
    expect(f).toContain("discard");
    expect(f).toContain("smoothstep");
  });

  it("the patched shader of a marker material has no fog darkening; a plain bend material still has it", () => {
    const u = makeBendUniforms();
    const shaderOf = (mat: THREE.Material) => {
      const sh = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <project_vertex>", fragmentShader: "#include <fog_fragment>" };
      (mat.onBeforeCompile as (s: unknown, r: unknown) => void)(sh, null);
      return sh;
    };
    const plain = shaderOf(bendMaterial(new THREE.MeshBasicMaterial(), u));
    expect(plain.fragmentShader).toContain("uFogOn > 0.5");
    const layer = new MarkerLayer(u);
    const marker = shaderOf(layer.segs.material as THREE.Material);
    expect(marker.fragmentShader).not.toContain("uFogOn > 0.5");
    expect(marker.fragmentShader).toContain("discard");
    expect((layer.segs.material as THREE.Material).customProgramCacheKey()).toBe("hf-bend-nofog");
  });
});

describe("marker look", () => {
  it("style overrides merge over the defaults per block", () => {
    const a = resolveMarkers({ maxZoom: 0.5, den: { size: 3 }, hazard: { segments: 24 } });
    expect(a.maxZoom).toBe(0.5);
    expect(a.den.size).toBe(3);
    expect(a.den.color).toBe(MARKER_DEFAULTS.den.color);
    expect(a.hazard.segments).toBe(24);
    expect(a.beacon).toEqual(MARKER_DEFAULTS.beacon);
    expect(resolveMarkers(undefined)).toEqual(MARKER_DEFAULTS);
  });

  it("style.json render.markers carries the same numbers as the code defaults", () => {
    const { $comment: _c, ...block } = pack.files.style.render!.markers!;
    expect(resolveMarkers(block)).toEqual(MARKER_DEFAULTS);
    expect(block).toEqual(MARKER_DEFAULTS);
  });
});

describe("MarkerLayer: wolf dens", () => {
  const draw = (layer: MarkerLayer, w: World, o: { fx?: number; fz?: number; zoom?: number; reveal?: boolean; hidden?: boolean; tribe?: number } = {}) =>
    layer.update(w, 1.25, o.fx ?? 20, o.fz ?? 20, HS, camera(), 40, o.zoom ?? 0.3, o.tribe ?? 0, o.reveal ?? false, 0, o.hidden ?? false);

  it("draws a pin and a ring over an explored den, above the den, and a ring only when zoomed far out", () => {
    const w = flat(true);
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    w.spawnBuilding("hearth", 1, 54, 54);
    w.beasts.addDen("wolf", 18, 14, 2);
    w.vision.update(true);
    const layer = new MarkerLayer(makeBendUniforms());
    draw(layer, w);
    expect(layer.counts.pins).toBe(1);
    expect(layer.counts.segments).toBe(28);
    expect(layer.counts.beams).toBe(0);
    expect(layer.pins.count).toBe(1);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    layer.pins.getMatrixAt(0, m);
    p.setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(18, 6);
    expect(p.z).toBeCloseTo(14, 6);
    // the pin floats above the ground, by about its own height
    const ground = Math.max(w.terrain.heightAt(18, 14), w.terrain.sea) * HS;
    expect(p.y).toBeGreaterThan(ground + 0.5);
    expect(p.y).toBeLessThan(ground + 6);
    // zoomed out past maxZoom: no pin, the ring stays
    draw(layer, w, { zoom: 0.95 });
    expect(layer.counts.pins).toBe(0);
    expect(layer.pins.count).toBe(0);
    expect(layer.counts.segments).toBe(28);
  });

  it("hides a den in unexplored ground, shows it when the fog is revealed, and nothing when hidden or disabled", () => {
    const w = flat(true);
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    w.spawnBuilding("hearth", 1, 54, 54);
    w.beasts.addDen("wolf", 36, 36, 1);
    w.vision.update(true);
    const layer = new MarkerLayer(makeBendUniforms());
    draw(layer, w, { fx: 36, fz: 36 });
    expect(layer.counts.pins).toBe(0);
    expect(layer.counts.segments).toBe(0);
    draw(layer, w, { fx: 36, fz: 36, reveal: true });
    expect(layer.counts.pins).toBe(1);
    draw(layer, w, { fx: 36, fz: 36, reveal: true, hidden: true });
    expect(layer.counts.pins).toBe(0);
    expect(layer.counts.segments).toBe(0);
    layer.enabled = false;
    draw(layer, w, { fx: 36, fz: 36, reveal: true });
    expect(layer.counts.pins).toBe(0);
    layer.enabled = true;
    const off = new MarkerLayer(makeBendUniforms(), resolveMarkers({ enabled: false }));
    draw(off, w, { fx: 36, fz: 36, reveal: true });
    expect(off.counts.pins).toBe(0);
  });

  it("draws a den the nearest copy of which is across the planet seam, and skips one past the far cut", () => {
    const w = flat(false);
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnBuilding("hearth", 1, 54, 54);
    w.beasts.addDen("wolf", 62, 30, 1);
    const u = makeBendUniforms();
    u.uFadeEnd.value = 30;
    const layer = new MarkerLayer(u);
    // the focus is at x = 2: the den at x = 62 sits 4 cells to the west, at draw x = -2
    draw(layer, w, { fx: 2, fz: 30 });
    expect(layer.counts.pins).toBe(1);
    const m = new THREE.Matrix4();
    layer.pins.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(-2, 6);
    // a focus half a planet away: past the far cut of 30
    draw(layer, w, { fx: 34, fz: 62 });
    expect(layer.counts.pins).toBe(0);
  });
});

describe("MarkerLayer: clearDens beacons and neutral hazards", () => {
  const level = (over: Partial<LevelDef>): LevelDef => {
    const raw = {
      id: "markers_test",
      name: "Markers test",
      order: 99,
      description: "test",
      seed: 5,
      map: { generator: "flat", size: 64, landAboveSea: 20 },
      tribes: [{}],
      spells: [],
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 12] },
        { spawn: "shaper", tribe: 0, at: [16, 12] },
        { spawn: "wolf", tribe: -1, at: [40, 40], count: 2 },
      ],
      objectives: [{ type: "clearDens" }, { type: "survive", seconds: 900 }],
      lose: [{ type: "timeLimit", seconds: 1200 }],
      ...over,
    };
    const res = validateLevel(raw, pack.files);
    if (!res.level) throw new Error(JSON.stringify(res.issues));
    return res.level;
  };
  const make = (def: LevelDef) => createLevelWorld({ def }, pack.files, pack.hash);
  const draw = (layer: MarkerLayer, w: World, fx: number, fz: number, alpha = 0) => layer.update(w, 0.5, fx, fz, HS, camera(), 40, 0.3, 0, false, alpha, false);

  it("a clearDens beacon shows in the dark with a beam, a bigger ring and a gold pin", () => {
    const w = make(level({}));
    const layer = new MarkerLayer(makeBendUniforms());
    expect(w.vision.seen(0, 40, 40)).toBe(false);
    expect(denMarks(w, 0, [])).toBe(1);
    draw(layer, w, 40, 40);
    expect(layer.counts.pins).toBe(1);
    expect(layer.counts.beams).toBe(1);
    // the den ring (28) and the beacon ring (40)
    expect(layer.counts.segments).toBe(68);
    const c = new THREE.Color();
    layer.pins.getColorAt(0, c);
    expect(c.getHexString()).toBe(new THREE.Color(MARKER_DEFAULTS.beacon.color).getHexString());
    // the beam stands on the ground at the den and is as tall as the look says
    const m = new THREE.Matrix4();
    layer.beams.getMatrixAt(0, m);
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    expect(s.y).toBe(MARKER_DEFAULTS.beacon.height);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(40, 6);
  });

  it("no beacon once the clearDens goal is done", () => {
    const w = make(level({}));
    for (const id of w.beasts.dens[0].members.slice()) w.damage(w.ents.index(id), 1e6, 0, true);
    w.step();
    w.step();
    expect(w.level!.done[0]).toBe(1);
    const layer = new MarkerLayer(makeBendUniforms());
    draw(layer, w, 40, 40);
    expect(layer.counts.beams).toBe(0);
    expect(layer.counts.pins).toBe(0);
  });

  it("a neutral hazard draws its outline, a ring closing in and the seconds left, only inside its warning", () => {
    const def = level({
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 12] },
        { spawn: "shaper", tribe: 0, at: [16, 12] },
      ],
      objectives: [{ type: "survive", seconds: 900 }],
      triggers: [{ when: { type: "time", seconds: 20 }, do: [{ type: "spell", spell: "firerain", at: [40, 40], tribe: -1 }] }] as LevelDef["triggers"],
    });
    const w = make(def);
    const hz = w.cfg.tickHz;
    const lead = w.cfg.pack.balance.hazards!.warnSeconds;
    const layer = new MarkerLayer(makeBendUniforms());
    // before the warning: nothing
    for (let k = 0; k < (20 - lead) * hz - 2; k++) w.step();
    draw(layer, w, 40, 40);
    expect(layer.counts.segments).toBe(0);
    expect(layer.counts.digits).toBe(0);
    // 5 s into the 8 s warning: the outline (48 segments), the closing ring and one digit, 3
    for (let k = 0; k < 2 + 5 * hz; k++) w.step();
    draw(layer, w, 40, 40);
    expect(layer.counts.digits).toBe(1);
    expect(layer.digits[3].count).toBe(1);
    const progress = hazardProgress(3 * hz, lead * hz);
    expect(progress).toBeCloseTo(5 / 8, 9);
    expect(layer.counts.segments).toBe(MARKER_DEFAULTS.hazard.segments + Math.max(12, Math.round(MARKER_DEFAULTS.hazard.segments * progress)));
    // the digit floats above the ring centre, 2 lines of ring radius 6 around (40, 40)
    const m = new THREE.Matrix4();
    layer.digits[3].getMatrixAt(0, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(40, 6);
    expect(p.z).toBeCloseTo(40, 6);
    expect(p.y).toBeGreaterThan(Math.max(w.terrain.heightAt(40, 40), w.terrain.sea) * HS + 1);
    // the render interpolation: half a tick less left; the count is unchanged, the number is still 3
    draw(layer, w, 40, 40, 0.5);
    expect(layer.digits[3].count).toBe(1);
    // the last second reads 1, then the spell lands and the ring is gone
    for (let k = 0; k < 2 * hz + 5; k++) w.step();
    draw(layer, w, 40, 40);
    expect(layer.digits[1].count).toBe(1);
    expect(layer.digits[3].count).toBe(0);
    for (let k = 0; k < hz; k++) w.step();
    draw(layer, w, 40, 40);
    expect(layer.counts.segments).toBe(0);
    expect(layer.counts.digits).toBe(0);
  });

  it("a two digit countdown draws two digits side by side; rings stay when zoomed far out but the number goes", () => {
    const def = level({
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 12] },
        { spawn: "shaper", tribe: 0, at: [16, 12] },
      ],
      objectives: [{ type: "survive", seconds: 900 }],
      triggers: [{ when: { type: "time", seconds: 30 }, do: [{ type: "spell", spell: "quake", at: [40, 40], tribe: -1 }] }] as LevelDef["triggers"],
    });
    const layer = new MarkerLayer(makeBendUniforms());
    // a 15 s warning, so there is a two digit countdown to read
    const wide = { ...pack.files, balance: { ...pack.files.balance, hazards: { warnSeconds: 15 } } };
    const w = createLevelWorld({ def }, wide, pack.hash);
    const hz = w.cfg.tickHz;
    for (let k = 0; k < (30 - 15) * hz + 2 * hz; k++) w.step();
    draw(layer, w, 40, 40);
    // 13 s left: digits 1 and 3
    expect(layer.counts.digits).toBe(2);
    expect(layer.digits[1].count).toBe(1);
    expect(layer.digits[3].count).toBe(1);
    const m = new THREE.Matrix4();
    layer.digits[1].getMatrixAt(0, m);
    const a = new THREE.Vector3().setFromMatrixPosition(m);
    layer.digits[3].getMatrixAt(0, m);
    const b = new THREE.Vector3().setFromMatrixPosition(m);
    expect(a.distanceTo(b)).toBeGreaterThan(0.5);
    // zoomed out past maxZoom: the number goes, the rings stay
    layer.update(w, 0.5, 40, 40, HS, camera(), 40, 0.95, 0, false, 0, false);
    expect(layer.counts.digits).toBe(0);
    expect(layer.counts.segments).toBeGreaterThan(0);
    // a world whose warning has not opened yet is quiet
    const early = createLevelWorld({ def }, wide, pack.hash);
    for (let k = 0; k < 50; k++) early.step();
    draw(layer, early, 40, 40);
    expect(layer.counts.segments).toBe(0);
  });

  it("an update does not allocate marker records or arrays after the first frame", () => {
    const w = make(level({}));
    const layer = new MarkerLayer(makeBendUniforms());
    draw(layer, w, 40, 40);
    const dens = (layer as unknown as { dens: object[] }).dens;
    const first = dens[0];
    const len = dens.length;
    for (let k = 0; k < 10; k++) draw(layer, w, 40, 40);
    expect(dens[0]).toBe(first);
    expect(dens.length).toBe(len);
  });
});

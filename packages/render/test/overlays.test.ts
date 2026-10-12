// Render polish: health bars (visibility rules, layout, one instanced mesh for 2000 units) and the hover
// ring (pick and relation, a disguised Shade keeps its disguise).
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { World } from "@hearthfall/sim";
import { basePack } from "../../sim/test/helpers.ts";
import { UnitLayer } from "../src/unitsLayer.ts";
import { BuildingLayer } from "../src/buildingsLayer.ts";
import { makeBendUniforms } from "../src/curve.ts";
import {
  barFrac,
  barLayout,
  barScale,
  barVisible,
  buildingUnder,
  HEALTH_BAR_DEFAULTS,
  HealthBarLayer,
  HoverRing,
  maxHpOf,
  relationOf,
  unitUnder,
} from "../src/overlays.ts";

const pack = basePack();
const flat = (fog?: boolean) => new World({ pack: pack.files, packHash: pack.hash, seed: 3, map: { generator: "flat", size: 64, tribes: 2, fog } });
const pal = { azure: "#2e6fd8", crimson: "#d83a2e", cloth: "#d9cbb0" };
const unitLayer = () => new UnitLayer(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), pack.files.units.units.map((u) => u.id), pal, ["azure", "crimson"]);
const buildingLayer = () => new BuildingLayer(new THREE.MeshBasicMaterial(), pack.files.buildings.buildings, pal, ["azure", "crimson"]);
const camera = () => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  c.position.set(20, 40, 40);
  c.lookAt(20, 0, 20);
  c.updateMatrixWorld();
  return c;
};

describe("health bar rules (pure)", () => {
  it("damaged mode shows only hurt entities, always shows every live one, off shows none", () => {
    expect(barVisible("damaged", 50, 100)).toBe(true);
    expect(barVisible("damaged", 100, 100)).toBe(false);
    expect(barVisible("always", 100, 100)).toBe(true);
    expect(barVisible("off", 10, 100)).toBe(false);
    expect(barVisible("always", 0, 100)).toBe(false);
    expect(barVisible("damaged", 10, 0)).toBe(false);
  });

  it("the fill is anchored at the left edge and the back adds the border on every side", () => {
    const b = barLayout(0.25, 1, 0.2, 0.05);
    expect(b.backW).toBeCloseTo(1.1);
    expect(b.backH).toBeCloseTo(0.3);
    expect(b.fillW).toBeCloseTo(0.25);
    expect(b.fillH).toBeCloseTo(0.2);
    // left edge of the fill = left edge of the bar
    expect(b.fillOffset - b.fillW / 2).toBeCloseTo(-0.5);
    const full = barLayout(1, 1, 0.2, 0.05);
    expect(full.fillOffset).toBeCloseTo(0);
    expect(barLayout(0, 1, 0.2, 0.05).fillW).toBe(0);
    // a nearly dead unit keeps a visible sliver
    expect(barLayout(0.001, 1, 0.2, 0.05).fillW).toBeCloseTo(0.04);
    expect(barLayout(2, 1, 0.2, 0).fillW).toBeCloseTo(1);
    expect(barFrac(30, 120)).toBeCloseTo(0.25);
    expect(barFrac(130, 120)).toBe(1);
  });

  it("bars keep about the same screen size: the scale follows the camera distance within its clamp", () => {
    expect(barScale(HEALTH_BAR_DEFAULTS.refDistance, HEALTH_BAR_DEFAULTS)).toBeCloseTo(1);
    expect(barScale(1, HEALTH_BAR_DEFAULTS)).toBe(HEALTH_BAR_DEFAULTS.minScale);
    expect(barScale(1e4, HEALTH_BAR_DEFAULTS)).toBe(HEALTH_BAR_DEFAULTS.maxScale);
  });
});

describe("health bar layer", () => {
  it("draws a back and a tribe-colored fill per damaged unit, none at full health or in photo mode (clear)", () => {
    const w = flat(false);
    const a = w.ents.index(w.spawnUnit("warden", 0, 20, 20));
    w.spawnUnit("warden", 1, 22, 20);
    w.ents.hp[a] = maxHpOf(w, a) / 2;
    const units = unitLayer();
    units.update(w, 1, 20, 20, 1, 0, 1000, camera(), 0, 100, 100, new Set());
    const bars = new HealthBarLayer(makeBendUniforms());
    bars.setColors([new THREE.Color(pal.azure), new THREE.Color(pal.crimson)], new THREE.Color(pal.cloth));
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(2);
    const c = new THREE.Color();
    bars.mesh.getColorAt(1, c);
    expect(c.getHexString()).toBe(new THREE.Color(pal.azure).getHexString());
    // the fill is half the bar wide, the back is the whole bar plus border
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    bars.mesh.getMatrixAt(0, m);
    s.setFromMatrixScale(m);
    const backW = s.x;
    bars.mesh.getMatrixAt(1, m);
    s.setFromMatrixScale(m);
    expect(s.x).toBeCloseTo(HEALTH_BAR_DEFAULTS.unitWidth / 2, 3);
    expect(backW).toBeCloseTo(HEALTH_BAR_DEFAULTS.unitWidth + 2 * HEALTH_BAR_DEFAULTS.border, 3);
    bars.mode = "always";
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(4);
    bars.mode = "off";
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(0);
    bars.mode = "damaged";
    bars.update(w, units, null, camera(), 40, 0.95, 0, false);
    expect(bars.mesh.count).toBe(0);
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    bars.clear();
    expect(bars.mesh.count).toBe(0);
  });

  it("finished damaged buildings get a wider bar, plans and sites do not", () => {
    const w = flat(false);
    const done = w.ents.index(w.spawnBuilding("dwelling", 0, 20, 20));
    const plan = w.ents.index(w.spawnBuilding("dwelling", 0, 30, 20));
    w.ents.state[done] = 3;
    w.ents.state[plan] = 0;
    w.ents.hp[done] = 100;
    w.ents.hp[plan] = 1;
    const b = buildingLayer();
    b.update(w, 20, 20, 1);
    expect(b.drawn).toBe(2);
    expect(b.drawTop[done]).toBeGreaterThan(b.drawGround[done]);
    const bars = new HealthBarLayer(makeBendUniforms());
    bars.update(w, null, b, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(2);
    const m = new THREE.Matrix4();
    bars.mesh.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(HEALTH_BAR_DEFAULTS.buildingWidth + 2 * HEALTH_BAR_DEFAULTS.border, 3);
  });

  it("no enemy hp is read through the fog of war", () => {
    const w = flat(true);
    w.spawnBuilding("hearth", 0, 8, 8);
    w.spawnBuilding("hearth", 1, 40, 40);
    const foe = w.ents.index(w.spawnUnit("warden", 1, 44, 44));
    w.ents.hp[foe] = 5;
    w.vision.update(true);
    const units = unitLayer();
    units.revealAll = true;
    units.update(w, 1, 40, 40, 1, 0, 1000, camera(), 0, 100, 100, new Set());
    const bars = new HealthBarLayer(makeBendUniforms());
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(0);
    bars.update(w, units, null, camera(), 40, 0.42, 0, true);
    expect(bars.mesh.count).toBe(2);
  });

  it("2000 damaged units fit one instanced mesh (one draw call)", () => {
    const w = flat(false);
    for (let k = 0; k < 2000; k++) {
      const i = w.ents.index(w.spawnUnit("settler", k % 2, 4 + (k % 50), 4 + Math.floor(k / 50)));
      w.ents.hp[i] = maxHpOf(w, i) / 2;
    }
    const units = unitLayer();
    units.update(w, 1, 30, 24, 1, 0, 1000, camera(), 0, 100, 100, new Set());
    expect(units.drawn).toBe(2000);
    const bars = new HealthBarLayer(makeBendUniforms());
    bars.update(w, units, null, camera(), 40, 0.42, 0, false);
    expect(bars.mesh.count).toBe(4000);
  });
});

describe("hover pick and relation", () => {
  it("picks the nearest drawn unit within the pixel radius, and a building by its footprint", () => {
    const units = { drawn: 2, drawnIdx: new Int32Array([3, 5]), screenX: new Float32Array(8).fill(NaN), screenY: new Float32Array(8) };
    units.screenX[3] = 100;
    units.screenY[3] = 100;
    units.screenX[5] = 110;
    units.screenY[5] = 100;
    expect(unitUnder(units, 108, 101, 18)).toBe(5);
    expect(unitUnder(units, 300, 300, 18)).toBe(-1);
    const w = flat(false);
    const b = w.ents.index(w.spawnBuilding("dwelling", 0, 20, 20));
    const layer = { drawn: 1, drawnIdx: new Int32Array([b]) };
    expect(buildingUnder(w, layer, 20.8, 19.4)).toBe(b);
    expect(buildingUnder(w, layer, 25, 25)).toBe(-1);
    // the footprint test wraps around the world edge
    const e = w.ents.index(w.spawnBuilding("dwelling", 0, 0.5, 0.5));
    expect(buildingUnder(w, { drawn: 1, drawnIdx: new Int32Array([e]) }, 63.8, 63.9)).toBe(e);
  });

  it("own is white, rivals red, wild people neutral, and a disguised Shade reads as the viewer's own", () => {
    const w = flat(false);
    const own = w.ents.index(w.spawnUnit("warden", 0, 10, 10));
    const foe = w.ents.index(w.spawnUnit("warden", 1, 12, 10));
    const wild = w.ents.index(w.spawnUnit("wild", -1, 14, 10));
    const shade = w.ents.index(w.spawnUnit("shade", 1, 16, 10));
    expect(relationOf(w, own, 0)).toBe("own");
    expect(relationOf(w, foe, 0)).toBe("enemy");
    expect(relationOf(w, wild, 0)).toBe("neutral");
    expect(w.combat.disguised(shade)).toBe(true);
    expect(relationOf(w, shade, 0)).toBe("own");
    w.ents.reveal[shade] = 50;
    expect(relationOf(w, shade, 0)).toBe("enemy");
    const wolf = w.ents.index(w.spawnUnit("wolf", -1, 18, 10));
    if (w.beasts.isBeast(w.ents.type[wolf])) expect(relationOf(w, wolf, 0)).toBe("enemy");
    const ring = new HoverRing(makeBendUniforms());
    ring.show({ x: 1, y: 2, z: 3, r: 0.6, rel: "enemy" });
    expect(ring.mesh.visible).toBe(true);
    expect((ring.mesh.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(ring.color("enemy").getHexString());
    expect(ring.color("enemy").r).toBeGreaterThan(ring.color("enemy").g * 2);
    expect(ring.color("own").getHexString()).toBe("f4f1ea");
    ring.show(null);
    expect(ring.mesh.visible).toBe(false);
  });
});

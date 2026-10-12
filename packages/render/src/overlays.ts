// Render polish: health bars over damaged units and buildings, and the hover ring under the entity the
// cursor is over. Both read sim state through the unit and building layers' draw records (where each
// entity was drawn this frame) and never write it.
// Health bars are one instanced mesh of camera-facing quads, two instances per bar (a dark back, then the
// tribe-colored fill), so 2000 units cost one draw call; they draw on top of the scene like the targeting
// rings. The hover ring is a single mesh: red under an enemy, soft white under your own.
import * as THREE from "three";
import { CAT, type World } from "@hearthfall/sim";
import { bendMaterial, type BendUniforms } from "./curve.ts";
import type { UnitLayer } from "./unitsLayer.ts";
import type { BuildingLayer } from "./buildingsLayer.ts";

/** Settings: bars on every unit and building, only on damaged ones (default), or none. */
export type HealthBarMode = "always" | "damaged" | "off";
export const HEALTH_BAR_MODES: readonly HealthBarMode[] = ["damaged", "always", "off"];

/** style.json render.healthBars (every key optional there; these are the defaults). */
export interface HealthBarLook {
  /** bar width over a unit and over a building, world units at the reference distance */
  unitWidth: number;
  buildingWidth: number;
  /** bar thickness and the dark border around the fill, world units at the reference distance */
  height: number;
  border: number;
  /** gap above the figure or roof top */
  lift: number;
  /** camera distance at which the sizes above hold; bars keep about the same size on screen within minScale..maxScale */
  refDistance: number;
  minScale: number;
  maxScale: number;
  /** no bars when zoomed out past this (0 close, 1 globe) */
  maxZoom: number;
  /** the back and the empty part of the bar */
  back: string;
  /** buildings get bars too */
  buildings: boolean;
}

export const HEALTH_BAR_DEFAULTS: HealthBarLook = {
  unitWidth: 0.95,
  buildingWidth: 1.9,
  height: 0.16,
  border: 0.05,
  lift: 0.25,
  refDistance: 40,
  minScale: 0.55,
  maxScale: 1.8,
  maxZoom: 0.8,
  back: "#1b1410",
  buildings: true,
};

/** style.json render.hover: ring colors by relation, ring opacity and size. */
export interface HoverLook {
  own: string;
  ally: string;
  neutral: string;
  enemy: string;
  opacity: number;
  /** ring outer radius over a unit (world units; a building uses its footprint) */
  unitRadius: number;
  /** cursor distance in CSS pixels that still hovers a unit */
  pickPx: number;
}

export const HOVER_DEFAULTS: HoverLook = {
  own: "#f4f1ea",
  ally: "#cfe9c4",
  neutral: "#e8c872",
  enemy: "#e2483a",
  opacity: 0.8,
  unitRadius: 0.6,
  pickPx: 18,
};

/** Is a bar shown for an entity with `hp` of `max` under `mode`? Dead or empty entities never get one. Pure. */
export function barVisible(mode: HealthBarMode, hp: number, max: number): boolean {
  if (mode === "off" || !(hp > 0) || !(max > 0)) return false;
  if (mode === "always") return true;
  return hp < max - 1e-6;
}

/** Fill share of the bar in [0, 1]. Pure. */
export function barFrac(hp: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, hp / max));
}

/**
 * Bar quads for a bar of `width`, `height` and `border` filled to `frac`: the back (centered, border added
 * on every side) and the fill, anchored at the left edge (its center `fillOffset` along the camera right
 * axis). Any health left keeps a sliver of at least 4 percent so a nearly dead unit still shows its color;
 * an empty bar has no fill (fillW 0). Pure, unit tested.
 */
export function barLayout(frac: number, width: number, height: number, border: number): { backW: number; backH: number; fillW: number; fillH: number; fillOffset: number } {
  const f = Math.min(1, Math.max(0, frac));
  const fillW = f <= 0 ? 0 : Math.max(f, 0.04) * width;
  return { backW: width + border * 2, backH: height + border * 2, fillW, fillH: height, fillOffset: -width / 2 + fillW / 2 };
}

/** Size multiplier so bars read about the same on screen at any camera distance. Pure. */
export function barScale(distance: number, look: Pick<HealthBarLook, "refDistance" | "minScale" | "maxScale">): number {
  return Math.min(look.maxScale, Math.max(look.minScale, distance / look.refDistance));
}

/** Full hp of entity i (unit kind hp, building def hp; never below its current hp). */
export function maxHpOf(w: World, i: number): number {
  const E = w.ents;
  const c = E.cat[i];
  const def = c === CAT.unit ? w.cfg.pack.units.units[E.type[i]] : c === CAT.building ? w.cfg.pack.buildings.buildings[E.type[i]] : undefined;
  return Math.max(def?.hp ?? 0, E.hp[i]);
}

/**
 * Whether an entity gets a bar now: a live unit or a finished building (plans and sites carry a token hp)
 * that the viewer sees this moment (no hp read through the fog). Pure over the world.
 */
export function barEligible(w: World, i: number, viewTribe: number, revealAll: boolean, buildings: boolean): boolean {
  const E = w.ents;
  if (!E.alive[i]) return false;
  const c = E.cat[i];
  if (c === CAT.building) {
    if (!buildings || E.state[i] !== 3) return false;
  } else if (c !== CAT.unit) return false;
  return revealAll || w.vision.seesEntity(viewTribe, i);
}

/** What the viewer is to entity i: its own, an ally, neutral (wild people, unowned) or an enemy (rivals, beasts). */
export type Relation = "own" | "ally" | "neutral" | "enemy";

/**
 * Relation for the hover ring. A disguised enemy Shade reads as the viewer's own (its disguise must hold);
 * wild beasts are enemies, other unowned entities neutral. Pure over the world.
 */
export function relationOf(w: World, i: number, viewTribe: number): Relation {
  const E = w.ents;
  const t = E.tribe[i];
  if (t === viewTribe) return "own";
  if (t < 0) return E.cat[i] === CAT.unit && w.beasts?.isBeast(E.type[i]) ? "enemy" : "neutral";
  if (viewTribe >= 0 && w.allied(viewTribe, t)) return "ally";
  if (E.cat[i] === CAT.unit && w.combat.disguised(i)) return "own";
  return "enemy";
}

/** Bar fill color per entity: its (shown) tribe color, or the wild color; a disguised Shade wears the viewer's. */
function shownTribe(w: World, i: number, viewTribe: number): number {
  const t = w.ents.tribe[i];
  return t >= 0 && t !== viewTribe && w.ents.cat[i] === CAT.unit && w.combat.disguised(i) ? viewTribe : t;
}

export class HealthBarLayer {
  readonly mesh: THREE.InstancedMesh;
  readonly look: HealthBarLook;
  mode: HealthBarMode = "damaged";
  /** bars drawn in the last update (tests, debug summary) */
  bars = 0;
  private readonly cap: number;
  private tribeColors: THREE.Color[];
  private readonly wild: THREE.Color;
  private readonly back: THREE.Color;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly right = new THREE.Vector3();

  constructor(bend: BendUniforms, look: Partial<HealthBarLook> = {}, cap = 4096) {
    this.look = { ...HEALTH_BAR_DEFAULTS, ...look };
    this.cap = cap;
    const mat = bendMaterial(
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
      bend,
    );
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.count = 0;
    this.tribeColors = [];
    this.wild = new THREE.Color("#d9cbb0");
    this.back = new THREE.Color(this.look.back);
  }

  /** Tribe fill colors (palette names resolved by the renderer, colorblind palette included). */
  setColors(tribe: THREE.Color[], wild: THREE.Color): void {
    this.tribeColors = tribe;
    this.wild.copy(wild);
  }

  /** Hide every bar (photo mode, map view, setting off). */
  clear(): void {
    this.mesh.count = 0;
    this.bars = 0;
  }

  update(w: World, units: UnitLayer | null, buildings: BuildingLayer | null, camera: THREE.Camera, distance: number, zoom: number, viewTribe: number, revealAll: boolean): void {
    const L = this.look;
    if (this.mode === "off" || zoom > L.maxZoom) return this.clear();
    const E = w.ents;
    const k = barScale(distance, L);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    let n = 0;
    const add = (i: number, x: number, top: number, z: number, width: number) => {
      if (n + 2 > this.cap) return;
      const max = maxHpOf(w, i);
      if (!barVisible(this.mode, E.hp[i], max)) return;
      const b = barLayout(barFrac(E.hp[i], max), width * k, L.height * k, L.border * k);
      const y = top + L.lift * k + b.backH / 2;
      this.p.set(x, y, z);
      this.s.set(b.backW, b.backH, 1);
      this.m.compose(this.p, camera.quaternion, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n++, this.back);
      if (b.fillW <= 0) return;
      this.p.set(x + this.right.x * b.fillOffset, y + this.right.y * b.fillOffset, z + this.right.z * b.fillOffset);
      this.s.set(b.fillW, b.fillH, 1);
      this.m.compose(this.p, camera.quaternion, this.s);
      this.mesh.setMatrixAt(n, this.m);
      const t = shownTribe(w, i, viewTribe);
      this.mesh.setColorAt(n++, t >= 0 && this.tribeColors.length ? this.tribeColors[t % this.tribeColors.length] : this.wild);
    };
    if (units) {
      for (let d = 0; d < units.drawn; d++) {
        const i = units.drawnIdx[d];
        if (!barEligible(w, i, viewTribe, revealAll, false)) continue;
        add(i, units.drawX[i], units.drawTop[i], units.drawZ[i], L.unitWidth);
      }
    }
    if (buildings && L.buildings) {
      for (let d = 0; d < buildings.drawn; d++) {
        const i = buildings.drawnIdx[d];
        if (!barEligible(w, i, viewTribe, revealAll, true)) continue;
        add(i, buildings.drawX[i], buildings.drawTop[i], buildings.drawZ[i], L.buildingWidth);
      }
    }
    this.mesh.count = n;
    this.bars = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Nearest drawn unit to a screen point within `px` CSS pixels, or -1 (any tribe; screen positions from the unit layer). Pure over the layer. */
export function unitUnder(units: Pick<UnitLayer, "drawn" | "drawnIdx" | "screenX" | "screenY">, x: number, y: number, px: number): number {
  let best = -1;
  let bestD = px * px;
  for (let d = 0; d < units.drawn; d++) {
    const i = units.drawnIdx[d];
    const sx = units.screenX[i];
    if (Number.isNaN(sx)) continue;
    const dd = (sx - x) * (sx - x) + (units.screenY[i] - y) * (units.screenY[i] - y);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  }
  return best;
}

/** Drawn building whose footprint (plus half a cell) holds the map point (x, z), or -1. Pure over the world. */
export function buildingUnder(w: World, buildings: Pick<BuildingLayer, "drawn" | "drawnIdx">, x: number, z: number): number {
  const E = w.ents;
  const n = w.terrain.size;
  const defs = w.cfg.pack.buildings.buildings;
  const wrap = (d: number) => d - Math.round(d / n) * n;
  for (let d = 0; d < buildings.drawn; d++) {
    const b = buildings.drawnIdx[d];
    if (!E.alive[b]) continue;
    const [fw, fh] = defs[E.type[b]].footprint;
    if (Math.abs(wrap(x - E.x[b])) <= fw / 2 + 0.5 && Math.abs(wrap(z - E.y[b])) <= fh / 2 + 0.5) return b;
  }
  return -1;
}

/** The hover ring: one bent ring mesh, colored by relation, drawn over the ground under the hovered entity. */
export class HoverRing {
  readonly mesh: THREE.Mesh;
  readonly look: HoverLook;
  private readonly colors: Record<Relation, THREE.Color>;

  constructor(bend: BendUniforms, look: Partial<HoverLook> = {}) {
    this.look = { ...HOVER_DEFAULTS, ...look };
    this.colors = {
      own: new THREE.Color(this.look.own),
      ally: new THREE.Color(this.look.ally),
      neutral: new THREE.Color(this.look.neutral),
      enemy: new THREE.Color(this.look.enemy),
    };
    this.mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2),
      bendMaterial(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: this.look.opacity, depthTest: false, depthWrite: false, fog: false, toneMapped: false }), bend),
    );
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  /** Place the ring at world (x, y, z) with outer radius r in the color of `rel`, or hide it with null. */
  show(at: { x: number; y: number; z: number; r: number; rel: Relation } | null): void {
    if (!at) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.position.set(at.x, at.y, at.z);
    this.mesh.scale.set(at.r, 1, at.r);
    (this.mesh.material as THREE.MeshBasicMaterial).color.copy(this.colors[at.rel]);
    this.mesh.visible = true;
  }

  color(rel: Relation): THREE.Color {
    return this.colors[rel];
  }
}

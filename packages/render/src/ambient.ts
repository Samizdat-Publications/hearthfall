// Ambient life (render only, never touches the sim): thin chimney smoke over finished Dwellings and the
// Hearth, small bird flocks circling high over forests and shores, fireflies around the village under the
// dusk lighting presets, and a little dust at the feet of units walking on dry land.
// Every effect is stateless: each puff, bird and firefly is a pure function of the visual time and of the
// world (hashed seeds per entity or anchor), so the shot harness's fixedStep mode (visual time = sim tick
// time) renders the same pixels for the same tick. Each effect is one instanced mesh with a hard cap.
import * as THREE from "three";
import { CAT, type World } from "@hearthfall/sim";
import { bendMaterial, type BendUniforms } from "./curve.ts";
import type { UnitLayer } from "./unitsLayer.ts";
import type { BuildingLayer } from "./buildingsLayer.ts";

export interface SmokeLook {
  enabled: boolean;
  /** puffs per chimney at once, seconds for one puff to rise and fade */
  puffs: number;
  period: number;
  /** rise over a puff's life, and its drift along the wind */
  rise: number;
  drift: number;
  /** wind direction on the map (x, z), normalized at use */
  wind: [number, number];
  /** start radius of a puff and how much it grows over its life (1 + grow) */
  size: number;
  grow: number;
  color: string;
  opacity: number;
  /** building ids that smoke when finished */
  sources: string[];
  max: number;
}

export interface BirdsLook {
  enabled: boolean;
  /** flock anchor grid spacing in cells; a cell becomes a flock when it is forest or shore */
  spacing: number;
  /** trees within `forestReach` cells of the anchor that make it forest */
  forestTrees: number;
  forestReach: number;
  /** height units above or below sea level that still count as shore */
  shoreBand: number;
  perFlock: number;
  /** circle radius, height above the ground, speed along the circle (world units per second) */
  radius: number;
  height: number;
  speed: number;
  /** wing span and wing beats per second */
  size: number;
  flap: number;
  color: string;
  max: number;
}

export interface FirefliesLook {
  enabled: boolean;
  /** lighting presets that bring them out (style.json lightingPresets names) */
  presets: string[];
  perHearth: number;
  perDwelling: number;
  /** wander radius around the building, size, blinks per second */
  radius: number;
  size: number;
  blink: number;
  color: string;
  max: number;
}

export interface DustLook {
  enabled: boolean;
  /** puffs trailing each walker, seconds per puff */
  perUnit: number;
  period: number;
  /** only walkers within this many world units of the camera focus */
  radius: number;
  /** height units above sea level the ground must be to count as dry */
  dryAbove: number;
  size: number;
  trail: number;
  color: string;
  opacity: number;
  max: number;
}

export interface AmbientLook {
  /** no ambient life past this zoom (0 close, 1 globe) */
  maxZoom: number;
  smoke: SmokeLook;
  birds: BirdsLook;
  fireflies: FirefliesLook;
  dust: DustLook;
}

export const AMBIENT_DEFAULTS: AmbientLook = {
  maxZoom: 0.85,
  smoke: { enabled: true, puffs: 5, period: 4, rise: 2.4, drift: 0.7, wind: [0.8, 0.35], size: 0.13, grow: 2.2, color: "#d9d3c9", opacity: 0.42, sources: ["dwelling", "hearth"], max: 640 },
  birds: { enabled: true, spacing: 24, forestTrees: 14, forestReach: 5, shoreBand: 6, perFlock: 5, radius: 4.5, height: 9, speed: 2.2, size: 0.55, flap: 2.6, color: "#2b2622", max: 160 },
  fireflies: { enabled: true, presets: ["evening"], perHearth: 10, perDwelling: 2, radius: 3.2, size: 0.07, blink: 0.45, color: "#e9ff8c", max: 240 },
  dust: { enabled: true, perUnit: 2, period: 0.7, radius: 24, dryAbove: 4, size: 0.11, trail: 0.45, color: "#c9b48a", opacity: 0.5, max: 400 },
};

/** Style overrides merged over the defaults per effect (any key may be left out). Pure. */
export function resolveAmbient(o?: { maxZoom?: number; smoke?: Partial<SmokeLook>; birds?: Partial<BirdsLook>; fireflies?: Partial<FirefliesLook>; dust?: Partial<DustLook> }): AmbientLook {
  const d = AMBIENT_DEFAULTS;
  return {
    maxZoom: o?.maxZoom ?? d.maxZoom,
    smoke: { ...d.smoke, ...(o?.smoke ?? {}) },
    birds: { ...d.birds, ...(o?.birds ?? {}) },
    fireflies: { ...d.fireflies, ...(o?.fireflies ?? {}) },
    dust: { ...d.dust, ...(o?.dust ?? {}) },
  };
}

/** Stable hash of an integer to [0, 1). Pure. */
export function hash01(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const frac = (x: number) => x - Math.floor(x);

/**
 * Puff k of a chimney with seed `seed` at time t: its life phase in [0, 1) (0 just out of the chimney),
 * and its offset from the chimney top (dx, dy, dz) and radius. Pure, unit tested.
 */
export function smokePuff(t: number, seed: number, k: number, L: SmokeLook): { phase: number; dx: number; dy: number; dz: number; r: number } {
  const phase = frac(t / L.period + hash01(seed) + k / L.puffs);
  const wl = Math.hypot(L.wind[0], L.wind[1]) || 1;
  const sway = Math.sin(t * 1.3 + seed * 0.7 + k * 2.1) * 0.12 * phase;
  const d = L.drift * phase * phase;
  // grow over the life, then thin out over the last fifth so a puff never pops off
  const fade = phase > 0.8 ? (1 - phase) / 0.2 : 1;
  return { phase, dx: (L.wind[0] / wl) * d + sway, dy: L.rise * phase, dz: (L.wind[1] / wl) * d - sway * 0.5, r: L.size * (1 + L.grow * phase) * fade };
}

/** Bird flock anchors: grid points (cells) over forest or shore, jittered off the grid. */
export interface FlockAnchor {
  x: number;
  z: number;
  seed: number;
  kind: "forest" | "shore";
}

/**
 * Flock anchors of a world: every `spacing` cells (jittered by a hash), a point with at least `forestTrees`
 * trees within `forestReach` cells is forest, else a point whose ground is within `shoreBand` height units of
 * the sea is shore. Pure over the world (trees bucketed once), unit tested.
 */
export function flockAnchors(w: World, L: Pick<BirdsLook, "spacing" | "forestTrees" | "forestReach" | "shoreBand">): FlockAnchor[] {
  const t = w.terrain;
  const n = t.size;
  const g = Math.max(1, Math.floor(n / Math.max(4, L.spacing)));
  const step = n / g;
  const counts = new Int32Array(g * g);
  const E = w.ents;
  const reach2 = L.forestReach * L.forestReach;
  const anchors: { x: number; z: number; seed: number }[] = [];
  for (let gz = 0; gz < g; gz++)
    for (let gx = 0; gx < g; gx++) {
      const seed = gz * g + gx + 1;
      const x = (gx + 0.5 + (hash01(seed * 3) - 0.5) * 0.5) * step;
      const z = (gz + 0.5 + (hash01(seed * 7) - 0.5) * 0.5) * step;
      anchors.push({ x, z, seed });
    }
  const wrap = (d: number) => d - Math.round(d / n) * n;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.cat[i] !== CAT.tree) continue;
    const gx = Math.floor(E.x[i] / step) % g;
    const gz = Math.floor(E.y[i] / step) % g;
    // a tree only counts toward the anchor of its own grid cell and the eight around it
    for (let oz = -1; oz <= 1; oz++)
      for (let ox = -1; ox <= 1; ox++) {
        const a = (((gz + oz) % g) + g) % g * g + ((((gx + ox) % g) + g) % g);
        const an = anchors[a];
        const dx = wrap(E.x[i] - an.x);
        const dz = wrap(E.y[i] - an.z);
        if (dx * dx + dz * dz <= reach2) counts[a]++;
      }
  }
  const out: FlockAnchor[] = [];
  anchors.forEach((a, k) => {
    if (counts[k] >= L.forestTrees) out.push({ ...a, kind: "forest" });
    else if (Math.abs(t.heightAt(((a.x % n) + n) % n, ((a.z % n) + n) % n) - t.sea) <= L.shoreBand) out.push({ ...a, kind: "shore" });
  });
  return out;
}

/** Bird k of a flock at time t: offset from the anchor, heading (radians about +y) and wing flap in [-1, 1]. Pure. */
export function birdPose(t: number, seed: number, k: number, L: Pick<BirdsLook, "perFlock" | "radius" | "speed" | "flap">): { dx: number; dy: number; dz: number; heading: number; flap: number } {
  const dir = hash01(seed * 11) < 0.5 ? 1 : -1;
  const r = L.radius * (0.75 + 0.35 * hash01(seed * 13 + k));
  const w = (L.speed / Math.max(0.5, r)) * dir;
  const a = t * w + hash01(seed * 17) * Math.PI * 2 + k * 0.42;
  const dx = Math.cos(a) * r;
  const dz = Math.sin(a) * r;
  // tangent of the circle in the direction of travel
  const heading = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
  const flap = Math.sin(t * L.flap * Math.PI * 2 + k * 1.7 + seed);
  return { dx, dy: Math.sin(t * 0.6 + k * 1.3 + seed) * 0.5 + k * 0.12, dz, heading, flap };
}

/** Do fireflies come out under this lighting preset and weather? Pure. */
export function firefliesOut(L: Pick<FirefliesLook, "enabled" | "presets">, preset: string, raining: boolean): boolean {
  return L.enabled && !raining && L.presets.includes(preset);
}

/** Firefly k around a source at time t: offset and glow in [0, 1] (0 = dark this moment). Pure. */
export function fireflyPose(t: number, seed: number, k: number, L: Pick<FirefliesLook, "radius" | "blink">): { dx: number; dy: number; dz: number; glow: number } {
  const h = (m: number) => hash01(seed * 31 + k * 7 + m);
  const a1 = 0.21 + 0.2 * h(1);
  const a2 = 0.17 + 0.2 * h(2);
  const r = L.radius * (0.45 + 0.55 * h(3));
  const dx = Math.sin(t * a1 + h(4) * 6.283) * r;
  const dz = Math.cos(t * a2 + h(5) * 6.283) * r;
  const dy = 0.35 + 0.9 * (0.5 + 0.5 * Math.sin(t * (0.3 + 0.3 * h(6)) + h(7) * 6.283));
  const b = Math.sin(t * L.blink * Math.PI * 2 + h(8) * 6.283);
  return { dx, dy, dz, glow: b > 0 ? Math.sqrt(b) : 0 };
}

/** Dust puff k behind a walker at time t: life phase, distance behind the feet and rise, and radius. Pure. */
export function dustPuff(t: number, seed: number, k: number, L: Pick<DustLook, "perUnit" | "period" | "trail" | "size">): { phase: number; back: number; side: number; dy: number; r: number } {
  const phase = frac(t / L.period + hash01(seed) + k / L.perUnit);
  const r = L.size * (0.5 + phase) * (phase > 0.7 ? (1 - phase) / 0.3 : 1);
  return { phase, back: L.trail * phase, side: (hash01(seed * 5 + k) - 0.5) * 0.3, dy: 0.04 + 0.22 * phase, r };
}

/** Is a walker eligible for dust: walking on land, ground at least dryAbove height units over the sea, near the focus? Pure. */
export function dustEligible(walking: boolean, groundHeight: number, sea: number, dist2: number, L: Pick<DustLook, "dryAbove" | "radius">): boolean {
  return walking && groundHeight >= sea + L.dryAbove && dist2 <= L.radius * L.radius;
}

/** Instance counts drawn in the last update (tests, debug summary). */
export interface AmbientCounts {
  smoke: number;
  birds: number;
  fireflies: number;
  dust: number;
}

export class AmbientLayer {
  readonly group = new THREE.Group();
  readonly look: AmbientLook;
  enabled = true;
  readonly counts: AmbientCounts = { smoke: 0, birds: 0, fireflies: 0, dust: 0 };
  private readonly smoke: THREE.InstancedMesh;
  private readonly birds: THREE.InstancedMesh;
  private readonly flies: THREE.InstancedMesh;
  private readonly dust: THREE.InstancedMesh;
  private anchors: FlockAnchor[] = [];
  private anchorKey = "";
  private anchorWorld: World | null = null;
  private smokeSources = new Set<number>();
  private hearthType = -1;
  private dwellingType = -1;
  private typesFor: World | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(bend: BendUniforms, look: AmbientLook = AMBIENT_DEFAULTS) {
    this.look = look;
    const mat = (color: string, opacity: number, blending: THREE.Blending) =>
      bendMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending, depthWrite: false }), bend);
    const make = (geo: THREE.BufferGeometry, m: THREE.Material, cap: number, order: number) => {
      const im = new THREE.InstancedMesh(geo, m, Math.max(1, cap));
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = order;
      this.group.add(im);
      return im;
    };
    this.smoke = make(new THREE.IcosahedronGeometry(1, 0), mat(look.smoke.color, look.smoke.opacity, THREE.NormalBlending), look.smoke.max, 4);
    // a bird is a shallow V of two wing triangles; scaling y by the flap beats the wings
    const v = new THREE.BufferGeometry();
    v.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.18, -0.5, 0.25, -0.1, 0, 0, -0.12, 0, 0, 0.18, 0, 0, -0.12, 0.5, 0.25, -0.1], 3));
    this.birds = make(v, bendMaterial(new THREE.MeshBasicMaterial({ color: look.birds.color, side: THREE.DoubleSide }), bend), look.birds.max, 3);
    this.flies = make(new THREE.OctahedronGeometry(1, 0), bendMaterial(new THREE.MeshBasicMaterial({ color: look.fireflies.color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }), bend), look.fireflies.max, 6);
    this.dust = make(new THREE.IcosahedronGeometry(1, 0), mat(look.dust.color, look.dust.opacity, THREE.NormalBlending), look.dust.max, 4);
  }

  /** Hide everything (setting off, map view, zoomed out). */
  clear(): void {
    for (const im of [this.smoke, this.birds, this.flies, this.dust]) im.count = 0;
    this.counts.smoke = this.counts.birds = this.counts.fireflies = this.counts.dust = 0;
  }

  /** Flock anchors in use (tests, debug). */
  flocks(w: World): readonly FlockAnchor[] {
    this.syncAnchors(w);
    return this.anchors;
  }

  private syncAnchors(w: World): void {
    const key = `${w.terrain.size}|${w.terrain.version}|${w.treeVersion}`;
    if (key === this.anchorKey && this.anchorWorld === w) return;
    this.anchorKey = key;
    this.anchorWorld = w;
    this.anchors = flockAnchors(w, this.look.birds);
  }

  private syncTypes(w: World): void {
    if (this.typesFor === w) return;
    this.typesFor = w;
    const defs = w.cfg.pack.buildings.buildings;
    this.smokeSources = new Set(defs.flatMap((d, k) => (this.look.smoke.sources.includes(d.id) ? [k] : [])));
    this.hearthType = defs.findIndex((d) => d.id === "hearth");
    this.dwellingType = defs.findIndex((d) => d.id === "dwelling");
  }

  update(
    w: World,
    t: number,
    focusX: number,
    focusZ: number,
    heightScale: number,
    fadeEnd: number,
    zoom: number,
    map: boolean,
    preset: string,
    raining: boolean,
    units: UnitLayer | null,
    buildings: BuildingLayer | null,
    viewTribe: number,
    revealAll: boolean,
  ): void {
    if (!this.enabled || map || zoom > this.look.maxZoom) return this.clear();
    this.syncTypes(w);
    const E = w.ents;
    const T = w.terrain;
    const n = T.size;
    const fade2 = fadeEnd * fadeEnd;
    const L = this.look;
    // chimney smoke over finished smoking buildings
    let c = 0;
    if (L.smoke.enabled && buildings) {
      for (let d = 0; d < buildings.drawn && c < L.smoke.max; d++) {
        const i = buildings.drawnIdx[d];
        if (E.state[i] !== 3 || !this.smokeSources.has(E.type[i])) continue;
        const bx = buildings.drawX[i];
        const bz = buildings.drawZ[i];
        if ((bx - focusX) * (bx - focusX) + (bz - focusZ) * (bz - focusZ) > fade2) continue;
        const top = buildings.drawTop[i] - 0.08;
        for (let k = 0; k < L.smoke.puffs && c < L.smoke.max; k++) {
          const pf = smokePuff(t, i * 977 + E.type[i], k, L.smoke);
          if (pf.r <= 0.001) continue;
          this.p.set(bx + pf.dx, top + pf.dy, bz + pf.dz);
          this.s.setScalar(pf.r);
          this.m.compose(this.p, this.q.identity(), this.s);
          this.smoke.setMatrixAt(c++, this.m);
        }
      }
    }
    this.smoke.count = c;
    this.counts.smoke = c;
    // bird flocks over forests and shores, world-anchored so they never pop as the camera moves
    c = 0;
    if (L.birds.enabled) {
      this.syncAnchors(w);
      for (const a of this.anchors) {
        if (c >= L.birds.max) break;
        let ox = a.x - focusX;
        let oz = a.z - focusZ;
        ox -= Math.round(ox / n) * n;
        oz -= Math.round(oz / n) * n;
        if (ox * ox + oz * oz > fade2) continue;
        if (!revealAll && !w.vision.seen(viewTribe, ((a.x % n) + n) % n, ((a.z % n) + n) % n)) continue;
        const ground = Math.max(T.heightAt(((a.x % n) + n) % n, ((a.z % n) + n) % n), T.sea) * heightScale;
        for (let k = 0; k < L.birds.perFlock && c < L.birds.max; k++) {
          const b = birdPose(t, a.seed, k, L.birds);
          this.p.set(focusX + ox + b.dx, ground + L.birds.height + b.dy, focusZ + oz + b.dz);
          this.q.setFromAxisAngle(this.up, b.heading);
          this.s.set(L.birds.size, L.birds.size * b.flap, L.birds.size);
          this.m.compose(this.p, this.q, this.s);
          this.birds.setMatrixAt(c++, this.m);
        }
      }
    }
    this.birds.count = c;
    this.counts.birds = c;
    // fireflies around Hearths and finished Dwellings at dusk
    c = 0;
    if (buildings && firefliesOut(L.fireflies, preset, raining)) {
      for (let d = 0; d < buildings.drawn && c < L.fireflies.max; d++) {
        const i = buildings.drawnIdx[d];
        if (E.state[i] !== 3) continue;
        const per = E.type[i] === this.hearthType ? L.fireflies.perHearth : E.type[i] === this.dwellingType ? L.fireflies.perDwelling : 0;
        if (!per) continue;
        const bx = buildings.drawX[i];
        const bz = buildings.drawZ[i];
        if ((bx - focusX) * (bx - focusX) + (bz - focusZ) * (bz - focusZ) > fade2) continue;
        for (let k = 0; k < per && c < L.fireflies.max; k++) {
          const f = fireflyPose(t, i * 131 + 7, k, L.fireflies);
          if (f.glow <= 0.02) continue;
          const x = bx + f.dx;
          const z = bz + f.dz;
          const g = Math.max(T.heightAt(((x % n) + n) % n, ((z % n) + n) % n), T.sea) * heightScale;
          this.p.set(x, g + f.dy, z);
          this.s.setScalar(L.fireflies.size * (0.4 + 0.6 * f.glow));
          this.m.compose(this.p, this.q.identity(), this.s);
          this.flies.setMatrixAt(c++, this.m);
        }
      }
    }
    this.flies.count = c;
    this.counts.fireflies = c;
    // dust at the feet of walkers on dry land near the focus
    c = 0;
    if (L.dust.enabled && units) {
      const sea = T.sea;
      for (let d = 0; d < units.drawn && c < L.dust.max; d++) {
        const i = units.drawnIdx[d];
        if (!units.walking[i]) continue;
        const ux = units.drawX[i];
        const uz = units.drawZ[i];
        const d2 = (ux - focusX) * (ux - focusX) + (uz - focusZ) * (uz - focusZ);
        if (!dustEligible(true, units.drawGround[i] / heightScale, sea, d2, L.dust)) continue;
        const f = units.facingOf(i);
        const fx = Math.sin(f);
        const fz = Math.cos(f);
        for (let k = 0; k < L.dust.perUnit && c < L.dust.max; k++) {
          const p = dustPuff(t, i * 613 + 3, k, L.dust);
          if (p.r <= 0.001) continue;
          this.p.set(ux - fx * p.back + fz * p.side, units.drawGround[i] + p.dy, uz - fz * p.back - fx * p.side);
          this.s.setScalar(p.r);
          this.m.compose(this.p, this.q.identity(), this.s);
          this.dust.setMatrixAt(c++, this.m);
        }
      }
    }
    this.dust.count = c;
    this.counts.dust = c;
    for (const im of [this.smoke, this.birds, this.flies, this.dust]) im.instanceMatrix.needsUpdate = true;
  }
}

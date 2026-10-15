// Chapter 4 prep: world markers. Reads sim state through denMarks and hazardMarks (packages/sim warnings.ts) and
// never writes it. Three kinds; pins, beams and digits draw over the scene (no depth test) so they read through hills
// and trees, while the rings lie on the ground under units and trees:
//  - a wolf den: a bobbing paw pin over every standing den the viewer has explored, plus a ground ring where its
//    pack roams;
//  - a clearDens beacon: a light beam and a pulsing wide ring on the dens an open clearDens objective counts,
//    shown even in the dark (the objective already tells the player where);
//  - a neutral hazard: a ring on the ground where a scripted spell will land, a second ring closing in from the
//    centre as the time runs out, and the seconds left as a number above it.
// Everything is instanced and written into reused vectors, so a frame allocates nothing. The countdown follows the
// sim tick (play ticks plus the render interpolation), so it is right at 2x speed and when paused.
import * as THREE from "three";
import { denMarks, hazardMarks, type DenMark, type HazardMark, type World } from "@hearthfall/sim";
import { BEND_FRAGMENT_FADE, bendMaterial, type BendUniforms } from "./curve.ts";
import { barScale } from "./overlays.ts";

/** style.json render.markers (every key optional there; these are the defaults). */
export interface MarkerLook {
  enabled: boolean;
  /** no pins or numbers when zoomed out past this (0 close, 1 globe); rings and beams stay */
  maxZoom: number;
  /** camera distance at which the sizes hold; pins keep about the same size on screen within minScale..maxScale */
  refDistance: number;
  minScale: number;
  maxScale: number;
  den: {
    color: string;
    /** pin height, world units at refDistance */
    size: number;
    /** gap between the ground and the pin tip */
    lift: number;
    /** bob height and speed (radians per second) */
    bob: number;
    bobRate: number;
    /** roaming ring under the pin */
    ringRadius: number;
    ringColor: string;
    ringWidth: number;
  };
  beacon: {
    color: string;
    /** beam height and width, world units */
    height: number;
    width: number;
    ringRadius: number;
    /** pulses per second */
    pulse: number;
  };
  hazard: {
    /** the outline ring at the spell's reach and the ring that closes in on it */
    color: string;
    fillColor: string;
    width: number;
    /** segments per ring */
    segments: number;
    digitSize: number;
    digitLift: number;
    /** pulses per second at the start; the pulse quickens as the impact nears */
    pulse: number;
  };
}

export const MARKER_DEFAULTS: MarkerLook = {
  enabled: true,
  maxZoom: 0.85,
  refDistance: 40,
  minScale: 0.7,
  maxScale: 2.4,
  den: { color: "#e2483a", size: 2.1, lift: 0.5, bob: 0.22, bobRate: 2.2, ringRadius: 3.4, ringColor: "#c8503e", ringWidth: 0.11 },
  beacon: { color: "#ffd23a", height: 16, width: 1.1, ringRadius: 5, pulse: 1.4 },
  hazard: { color: "#ff6a2e", fillColor: "#ffd23a", width: 0.24, segments: 48, digitSize: 1.5, digitLift: 2.2, pulse: 3 },
};

/** Style overrides merged over the defaults per block (any key may be left out; a missing block is the defaults). Pure. */
export function resolveMarkers(o?: {
  enabled?: boolean;
  maxZoom?: number;
  refDistance?: number;
  minScale?: number;
  maxScale?: number;
  den?: Partial<MarkerLook["den"]>;
  beacon?: Partial<MarkerLook["beacon"]>;
  hazard?: Partial<MarkerLook["hazard"]>;
}): MarkerLook {
  const d = MARKER_DEFAULTS;
  return {
    enabled: o?.enabled ?? d.enabled,
    maxZoom: o?.maxZoom ?? d.maxZoom,
    refDistance: o?.refDistance ?? d.refDistance,
    minScale: o?.minScale ?? d.minScale,
    maxScale: o?.maxScale ?? d.maxScale,
    den: { ...d.den, ...(o?.den ?? {}) },
    beacon: { ...d.beacon, ...(o?.beacon ?? {}) },
    hazard: { ...d.hazard, ...(o?.hazard ?? {}) },
  };
}

/** Offset of point v from focus f on the wrapped planet of size n, taking the nearest copy. Pure. */
export function wrapOffset(v: number, f: number, n: number): number {
  const d = v - f;
  return d - Math.round(d / n) * n;
}

// ---------------------------------------------------------------- pure helpers
/** Share of the warning that has run, 0 at the start and 1 at the impact. Pure. */
export function hazardProgress(left: number, total: number): number {
  if (!(total > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - left / total));
}

/** Whole seconds shown on the countdown (rounded up, so the last second reads 1), 0 to 99. Pure. */
export function hazardSeconds(left: number, tickHz: number): number {
  return Math.min(99, Math.max(0, Math.ceil(left / tickHz - 1e-9)));
}

/** Digits of a countdown, most significant first: 8 is [8], 12 is [1, 2]. Pure. */
export function countdownDigits(seconds: number, out: number[]): number {
  const s = Math.min(99, Math.max(0, Math.floor(seconds)));
  let n = 0;
  if (s >= 10) out[n++] = Math.floor(s / 10);
  out[n++] = s % 10;
  return n;
}

/** Pulse in [0, 1] at visual time t, `rate` pulses per second, quickening up to 3x as the warning runs (progress 0..1). Pure. */
export function markerPulse(t: number, rate: number, progress = 0): number {
  return 0.5 + 0.5 * Math.sin(t * rate * Math.PI * 2 * (1 + 2 * progress));
}

/** Point `i` of `n` on a ring of radius r around (cx, cz), and the yaw that lays a flat segment along the ring there. Pure over scalars. */
export function ringPoint(cx: number, cz: number, r: number, i: number, n: number, out: { x: number; z: number; yaw: number }): void {
  const a = ((i + 0.5) / n) * Math.PI * 2;
  out.x = cx + Math.cos(a) * r;
  out.z = cz + Math.sin(a) * r;
  // a plane along local X turned by yaw about Y has its X axis at (cos yaw, 0, -sin yaw); the tangent here is (-sin a, 0, cos a)
  out.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
}

/** Vertical offset of the bobbing pin at visual time t for a den (the phase differs per den). Pure. */
export function pinBob(t: number, index: number, amount: number, rate: number): number {
  return Math.sin(t * rate + index * 1.7) * amount;
}

// ---------------------------------------------------------------- procedural textures (no DOM)
/** Tail-down pin with a paw print on it, RGBA, row 0 at the bottom: white body, dark rim and paw, so a tint colors the body only. */
export function denIconPixels(size = 64): Uint8Array {
  const d = new Uint8Array(size * size * 4);
  const inPin = (x: number, y: number, inset: number): boolean => {
    if ((x - 32) * (x - 32) + (y - 42) * (y - 42) <= (19 - inset) * (19 - inset)) return true;
    const tip = 3 + inset * 2.4;
    if (y < tip || y > 34) return false;
    return Math.abs(x - 32) <= (16.5 - inset) * ((y - tip) / (34 - tip));
  };
  const toes: readonly (readonly [number, number])[] = [[21.5, 47.5], [27.8, 52.5], [36.2, 52.5], [42.5, 47.5]];
  const inPaw = (x: number, y: number): boolean => {
    if (((x - 32) / 8.2) ** 2 + ((y - 38) / 6.2) ** 2 <= 1) return true;
    return toes.some(([tx, ty]) => (x - tx) * (x - tx) + (y - ty) * (y - ty) <= 3.3 * 3.3);
  };
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      let dark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ((x + (sx + 0.5) / SS) / size) * 64;
          const py = ((y + (sy + 0.5) / SS) / size) * 64;
          if (!inPin(px, py, 0)) continue;
          cov++;
          if (!inPin(px, py, 3.2) || inPaw(px, py)) dark++;
        }
      }
      const v = Math.round(255 * (1 - 0.86 * (dark / Math.max(1, cov))));
      d.set([v, v, v, Math.round((255 * cov) / (SS * SS))], (y * size + x) * 4);
    }
  }
  return d;
}

/** A tall soft beam, RGBA white, row 0 at the bottom: bright at the foot, fading to nothing at the top and at the sides. */
export function beamPixels(w = 16, h = 64): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const along = (1 - (y + 0.5) / h) ** 1.6;
      const across = 1 - Math.abs(((x + 0.5) / w) * 2 - 1);
      d.set([255, 255, 255, Math.round(255 * along * across ** 0.8)], (y * w + x) * 4);
    }
  }
  return d;
}

/** 3x5 pixel digits, one string per row, top row first. */
export const DIGIT_FONT: readonly (readonly string[])[] = [
  ["111", "101", "101", "101", "111"],
  ["010", "110", "010", "010", "111"],
  ["111", "001", "111", "100", "111"],
  ["111", "001", "111", "001", "111"],
  ["101", "101", "111", "001", "001"],
  ["111", "100", "111", "001", "111"],
  ["111", "100", "111", "101", "111"],
  ["111", "001", "001", "010", "010"],
  ["111", "101", "111", "101", "111"],
  ["111", "101", "111", "001", "111"],
];
export const DIGIT_CELL = { w: 16, h: 24 } as const;

/** The ten digits side by side (cell 16x24), RGBA, row 0 at the bottom: white glyphs with a dark outline. */
export function digitAtlasPixels(): { data: Uint8Array; width: number; height: number } {
  const { w: cw, h: ch } = DIGIT_CELL;
  const width = cw * 10;
  const height = ch;
  const lit = new Uint8Array(width * height);
  const scale = 4;
  DIGIT_FONT.forEach((rows, g) => {
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] !== "1") continue;
        for (let sy = 0; sy < scale; sy++)
          for (let sx = 0; sx < scale; sx++) {
            const x = g * cw + 2 + rx * scale + sx;
            const y = ch - 1 - (2 + ry * scale + sy);
            lit[y * width + x] = 1;
          }
      }
    });
  });
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (lit[i]) {
        data.set([255, 255, 255, 255], i * 4);
        continue;
      }
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height && lit[yy * width + xx]) {
            near = true;
            break;
          }
        }
      if (near) data.set([28, 24, 22, 255], i * 4);
    }
  }
  return { data, width, height };
}

/** BEND_FRAGMENT_FADE without the fog of war darkening: a marker must stay readable in unexplored ground. Pure. */
export function unfoggedFade(): string {
  return BEND_FRAGMENT_FADE.replace(/if \( uFogOn > 0\.5 \) \{[\s\S]*?\n\}\n/, "");
}

/** Patch a bend material so the fog of war does not darken it (the horizon fade and the far cut stay). */
function noFog<T extends THREE.Material>(mat: T): T {
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(BEND_FRAGMENT_FADE, unfoggedFade());
  };
  mat.customProgramCacheKey = () => "hf-bend-nofog";
  return mat;
}

function dataTexture(data: Uint8Array, w: number, h: number, filter: THREE.MagnificationTextureFilter): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = filter;
  tex.minFilter = filter;
  tex.needsUpdate = true;
  return tex;
}

/** Instance counts drawn in the last update (tests, debug summary). */
export interface MarkerCounts {
  pins: number;
  beams: number;
  /** ring segments */
  segments: number;
  digits: number;
}

const SEG_CAP = 2048;
const PIN_CAP = 64;
const BEAM_CAP = 32;
const DIGIT_CAP = 16;

export class MarkerLayer {
  readonly group = new THREE.Group();
  readonly look: MarkerLook;
  enabled = true;
  readonly counts: MarkerCounts = { pins: 0, beams: 0, segments: 0, digits: 0 };
  private readonly bend: BendUniforms;
  /** the instanced meshes (tests read their matrices): paw pins, beacon beams, ring segments, one mesh per digit 0 to 9 */
  readonly pins: THREE.InstancedMesh;
  readonly beams: THREE.InstancedMesh;
  readonly segs: THREE.InstancedMesh;
  readonly digits: THREE.InstancedMesh[] = [];
  private readonly digitCount = new Array<number>(10).fill(0);
  private readonly dens: DenMark[] = [];
  private readonly hazards: HazardMark[] = [];
  private readonly denColor: THREE.Color;
  private readonly denRing: THREE.Color;
  private readonly beaconColor: THREE.Color;
  private readonly hazardColor: THREE.Color;
  private readonly fillColor: THREE.Color;
  private readonly tint = new THREE.Color();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly right = new THREE.Vector3();
  private readonly pt = { x: 0, z: 0, yaw: 0 };
  private readonly digs: number[] = [0, 0];
  private nPin = 0;
  private nBeam = 0;
  private nSeg = 0;

  constructor(bend: BendUniforms, look: MarkerLook = MARKER_DEFAULTS) {
    this.bend = bend;
    this.look = look;
    this.denColor = new THREE.Color(look.den.color);
    this.denRing = new THREE.Color(look.den.ringColor);
    this.beaconColor = new THREE.Color(look.beacon.color);
    this.hazardColor = new THREE.Color(look.hazard.color);
    this.fillColor = new THREE.Color(look.hazard.fillColor);
    const mat = (extra: THREE.MeshBasicMaterialParameters) =>
      noFog(bendMaterial(new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false, ...extra }), bend));
    const make = (geo: THREE.BufferGeometry, m: THREE.Material, cap: number, order: number, colored = true) => {
      const im = new THREE.InstancedMesh(geo, m, cap);
      if (colored) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = order;
      this.group.add(im);
      return im;
    };
    // rings lie on the ground under units and trees (depth tested, pulled forward so they never sink into a slope); pins, beams and digits read through
    this.segs = make(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      mat({ opacity: 0.72, side: THREE.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      SEG_CAP,
      11,
    );
    this.beams = make(
      new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
      mat({ map: dataTexture(beamPixels(), 16, 64, THREE.LinearFilter), blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      BEAM_CAP,
      12,
    );
    this.pins = make(new THREE.PlaneGeometry(1, 1), mat({ map: dataTexture(denIconPixels(), 64, 64, THREE.LinearFilter) }), PIN_CAP, 13);
    // one mesh per digit, each with the UVs of its cell of the atlas, so no shader needs to know about glyphs
    const atlas = digitAtlasPixels();
    const digitMat = mat({ map: dataTexture(atlas.data, atlas.width, atlas.height, THREE.NearestFilter) });
    for (let g = 0; g < 10; g++) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const uv = geo.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setX(i, (g + uv.getX(i)) / 10);
      this.digits.push(make(geo, digitMat, DIGIT_CAP, 14));
    }
  }

  /** Hide everything (setting off, photo mode). */
  clear(): void {
    this.pins.count = this.beams.count = this.segs.count = 0;
    for (const d of this.digits) d.count = 0;
    this.counts.pins = this.counts.beams = this.counts.segments = this.counts.digits = 0;
  }

  /** Ground height under world point (x, y), sea level at the lowest, in scene units. */
  private ground(w: World, x: number, y: number, hs: number): number {
    const n = w.terrain.size;
    return Math.max(w.terrain.heightAt(((x % n) + n) % n, ((y % n) + n) % n), w.terrain.sea) * hs;
  }

  /** A ring of flat segments hugging the ground, centred on draw-space (gx, gz) for world point (wx, wy). */
  private ring(w: World, gx: number, gz: number, wx: number, wy: number, r: number, width: number, segs: number, color: THREE.Color, hs: number): void {
    if (this.nSeg + segs > SEG_CAP) return;
    const len = ((Math.PI * 2 * r) / segs) * 1.1;
    for (let i = 0; i < segs; i++) {
      ringPoint(gx, gz, r, i, segs, this.pt);
      const y = this.ground(w, wx + (this.pt.x - gx), wy + (this.pt.z - gz), hs) + 0.12;
      this.p.set(this.pt.x, y, this.pt.z);
      this.q.setFromAxisAngle(this.up, this.pt.yaw);
      this.s.set(len, 1, width);
      this.m.compose(this.p, this.q, this.s);
      this.segs.setMatrixAt(this.nSeg, this.m);
      this.segs.setColorAt(this.nSeg++, color);
    }
  }

  /**
   * Redraw every marker. `fx, fz` is the draw focus (the nearest copy of each marker on the wrapped planet is
   * drawn), `alpha` the render interpolation between the last two ticks, `hidden` photo mode. Allocation free.
   */
  update(w: World, visualTime: number, fx: number, fz: number, heightScale: number, camera: THREE.Camera, distance: number, zoom: number, viewTribe: number, revealAll: boolean, alpha: number, hidden: boolean): void {
    if (!this.enabled || !this.look.enabled || hidden) return this.clear();
    const L = this.look;
    const n = w.terrain.size;
    const reach = this.bend.uFadeEnd.value;
    const k = barScale(distance, L);
    const kw = Math.max(1, k);
    const pinsOn = zoom <= L.maxZoom;
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.nPin = this.nBeam = this.nSeg = 0;
    this.digitCount.fill(0);

    const nd = denMarks(w, revealAll ? null : viewTribe, this.dens);
    for (let i = 0; i < nd; i++) {
      const d = this.dens[i];
      const ox = wrapOffset(d.x, fx, n);
      const oz = wrapOffset(d.y, fz, n);
      if (Math.abs(ox) > reach || Math.abs(oz) > reach) continue;
      const gx = fx + ox;
      const gz = fz + oz;
      const gy = this.ground(w, d.x, d.y, heightScale);
      this.ring(w, gx, gz, d.x, d.y, L.den.ringRadius, L.den.ringWidth * kw, 28, this.denRing, heightScale);
      if (pinsOn && this.nPin < PIN_CAP) {
        const size = L.den.size * k;
        this.p.set(gx, gy + L.den.lift * k + size / 2 + pinBob(visualTime, d.index, L.den.bob * k, L.den.bobRate), gz);
        this.s.set(size, size, 1);
        this.m.compose(this.p, camera.quaternion, this.s);
        this.pins.setMatrixAt(this.nPin, this.m);
        this.pins.setColorAt(this.nPin++, d.beacon ? this.beaconColor : this.denColor);
      }
      if (d.beacon) {
        const pulse = markerPulse(visualTime, L.beacon.pulse);
        this.ring(w, gx, gz, d.x, d.y, L.beacon.ringRadius * (0.93 + 0.07 * pulse), L.den.ringWidth * 1.6 * kw, 40, this.beaconColor, heightScale);
        if (this.nBeam < BEAM_CAP) {
          const yaw = Math.atan2(camera.position.x - gx, camera.position.z - gz);
          this.p.set(gx, gy, gz);
          this.q.setFromAxisAngle(this.up, yaw);
          this.s.set(L.beacon.width * (0.85 + 0.15 * pulse) * kw, L.beacon.height, 1);
          this.m.compose(this.p, this.q, this.s);
          this.beams.setMatrixAt(this.nBeam, this.m);
          this.beams.setColorAt(this.nBeam++, this.beaconColor);
        }
      }
    }

    const nh = hazardMarks(w, alpha, this.hazards);
    for (let i = 0; i < nh; i++) {
      const h = this.hazards[i];
      const ox = wrapOffset(h.x, fx, n);
      const oz = wrapOffset(h.y, fz, n);
      if (Math.abs(ox) > reach + h.r || Math.abs(oz) > reach + h.r) continue;
      const gx = fx + ox;
      const gz = fz + oz;
      const progress = hazardProgress(h.left, h.total);
      const glow = 0.7 + 0.3 * markerPulse(visualTime, L.hazard.pulse, progress);
      // the outline at the spell's reach, then the ring that closes in on it
      this.tint.copy(this.hazardColor).multiplyScalar(glow);
      this.ring(w, gx, gz, h.x, h.y, h.r, L.hazard.width * kw, L.hazard.segments, this.tint, heightScale);
      const inner = h.r * progress;
      if (inner > 0.4) this.ring(w, gx, gz, h.x, h.y, inner, L.hazard.width * 0.7 * kw, Math.max(12, Math.round(L.hazard.segments * progress)), this.fillColor, heightScale);
      if (!pinsOn) continue;
      const nDig = countdownDigits(hazardSeconds(h.left, w.cfg.tickHz), this.digs);
      const dh = L.hazard.digitSize * k;
      const dw = (dh * DIGIT_CELL.w) / DIGIT_CELL.h;
      const y = this.ground(w, h.x, h.y, heightScale) + L.hazard.digitLift * k + dh / 2;
      for (let j = 0; j < nDig; j++) {
        const g = this.digs[j];
        if (this.digitCount[g] >= DIGIT_CAP) continue;
        const o = (j - (nDig - 1) / 2) * dw;
        this.p.set(gx + this.right.x * o, y + this.right.y * o, gz + this.right.z * o);
        this.s.set(dw, dh, 1);
        this.m.compose(this.p, camera.quaternion, this.s);
        const mesh = this.digits[g];
        mesh.setMatrixAt(this.digitCount[g], this.m);
        mesh.setColorAt(this.digitCount[g]++, this.fillColor);
      }
    }

    this.commit(this.pins, this.nPin);
    this.commit(this.beams, this.nBeam);
    this.commit(this.segs, this.nSeg);
    let dn = 0;
    for (let g = 0; g < 10; g++) {
      this.commit(this.digits[g], this.digitCount[g]);
      dn += this.digitCount[g];
    }
    this.counts.pins = this.nPin;
    this.counts.beams = this.nBeam;
    this.counts.segments = this.nSeg;
    this.counts.digits = dn;
  }

  private commit(im: THREE.InstancedMesh, count: number): void {
    im.count = count;
    if (!count) return;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
}

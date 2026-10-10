// BACKLOG 39: close-up ground detail. Grass tufts, flowers and pebbles as InstancedMesh, scattered by a
// hash of each terrain cell within a radius of the camera focus, so the same cell always grows the same
// props. Tufts and flowers thin out with altitude and vanish on sand, cliffs, scars and building
// footprints; pebbles take over higher up. Only drawn at close and default zoom (style.json
// render.groundDetail); render only, the sim never sees them.
import * as THREE from "three";
import { CAT, type World } from "@hearthfall/sim";

export interface GroundDetailOptions {
  /** cells from the focus that grow props; the outer quarter shrinks them to nothing (no pop line) */
  radius: number;
  /** camera zoom (0 close, 1 globe) above which the layer is hidden */
  maxZoom: number;
  /** expected props per cell at the lowest grassy altitude */
  tufts: number;
  /** share of tufts that carry a flower */
  flowers: number;
  /** expected pebbles per cell at the highest altitude (half of it on the shore) */
  pebbles: number;
  /** altitude share (0 sea, 1 height cap) below which the ground reads as sand: no tufts */
  shoreBand: number;
  /** altitude share by which tufts and flowers have thinned out to none */
  highBand: number;
  /** cells steeper than this (height units to a neighbor) grow nothing */
  maxSlope: number;
  flowerColors: string[];
}

export const GROUND_DETAIL_DEFAULTS: GroundDetailOptions = {
  radius: 22,
  maxZoom: 0.3,
  tufts: 1.1,
  flowers: 0.25,
  pebbles: 0.5,
  shoreBand: 0.04,
  highBand: 0.55,
  maxSlope: 3,
  flowerColors: ["#f2e6c8", "#e8c33a", "#d86a8a", "#b07cff"],
};

const hashf = (i: number, salt: number) => {
  let h = Math.imul(i ^ salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  return ng;
}

/** Five leaning blades (thin cones) in a ring, about 0.35 units tall. */
export function tuftGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  // close to the ground colors so tufts add texture without competing with units
  const base = new THREE.Color(pal.moss ?? "#548f36").lerp(new THREE.Color(pal.meadow ?? "#7cb64e"), 0.55);
  const tip = new THREE.Color(pal.meadow ?? "#7cb64e").lerp(new THREE.Color("#e6dc78"), 0.4);
  const blades = [0, 1, 2, 3, 4].map((k) => {
    const g = new THREE.ConeGeometry(0.075, 0.36 - (k % 3) * 0.05, 3).translate(0, 0.18 - (k % 3) * 0.025, 0);
    g.rotateZ((k - 2) * 0.22).rotateY(k * 1.26);
    g.translate(Math.cos(k * 1.26) * 0.07, 0, Math.sin(k * 1.26) * 0.07);
    return colored(g, base.clone().lerp(tip, 0.35 + (k % 3) * 0.3));
  });
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  const col: number[] = [];
  for (const b of blades) {
    pos.push(...(b.getAttribute("position").array as Float32Array));
    col.push(...(b.getAttribute("color").array as Float32Array));
  }
  merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return merged;
}

/** A small faceted head on top of a tuft (white, tinted per instance). */
export function flowerGeometry(): THREE.BufferGeometry {
  return colored(new THREE.OctahedronGeometry(0.09, 0).translate(0, 0.34, 0), new THREE.Color("#ffffff"));
}

/** A flattened faceted pebble, about 0.2 units wide. */
export function pebbleGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  return colored(new THREE.DodecahedronGeometry(0.1, 0).scale(1.2, 0.55, 1).translate(0, 0.03, 0), new THREE.Color(pal.stone ?? "#a9a196"));
}

/** Changes when a building or worship site appears or goes (cheap enough to check every frame). */
function buildingSignature(w: World): number {
  const E = w.ents;
  let s = 0;
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && (E.cat[i] === CAT.building || E.cat[i] === CAT.worship)) s = (s * 31 + i + 1) | 0;
  return s;
}

export class GroundDetailLayer {
  readonly tufts: THREE.InstancedMesh;
  readonly flowers: THREE.InstancedMesh;
  readonly pebbles: THREE.InstancedMesh;
  readonly meshes: THREE.InstancedMesh[];
  private readonly o: GroundDetailOptions;
  private readonly flowerColors: THREE.Color[];
  private lastKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(material: THREE.Material, pal: Record<string, string>, opts: Partial<GroundDetailOptions> = {}) {
    this.o = { ...GROUND_DETAIL_DEFAULTS, ...opts };
    this.flowerColors = this.o.flowerColors.map((h) => new THREE.Color(h));
    const r = Math.ceil(this.o.radius);
    const cells = (2 * r + 1) * (2 * r + 1);
    const make = (g: THREE.BufferGeometry, cap: number) => {
      const im = new THREE.InstancedMesh(g, material, Math.max(1, cap));
      im.frustumCulled = false;
      im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
      return im;
    };
    this.tufts = make(tuftGeometry(pal), Math.ceil(cells * (Math.floor(this.o.tufts) + 1)));
    this.flowers = make(flowerGeometry(), Math.ceil(cells * (Math.floor(this.o.tufts) + 1)));
    this.pebbles = make(pebbleGeometry(pal), Math.ceil(cells * (Math.floor(this.o.pebbles) + 1)));
    this.meshes = [this.tufts, this.flowers, this.pebbles];
  }

  /** Cells covered by a building footprint (props there would poke through floors). */
  private blocked(w: World): Set<number> {
    const out = new Set<number>();
    const E = w.ents;
    const n = w.terrain.size;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || (E.cat[i] !== CAT.building && E.cat[i] !== CAT.worship)) continue;
      let x0: number, y0: number, fw: number, fh: number;
      if (E.cat[i] === CAT.building) ({ x0, y0, fw, fh } = w.economy.footprint(i));
      else {
        const r = Math.ceil(w.cfg.pack.buildings.worship?.radius ?? 3);
        x0 = Math.round(E.x[i]) - r;
        y0 = Math.round(E.y[i]) - r;
        fw = fh = 2 * r;
      }
      for (let y = y0 - 1; y <= y0 + fh; y++) for (let x = x0 - 1; x <= x0 + fw; x++) out.add((((y % n) + n) % n) * n + (((x % n) + n) % n));
    }
    return out;
  }

  /** Re-scatter when the focus crossed a cell, the terrain changed or the zoom crossed maxZoom. */
  update(w: World, focusX: number, focusZ: number, heightScale: number, zoom: number, map: boolean): void {
    const show = !map && zoom <= this.o.maxZoom;
    const cx = Math.round(focusX);
    const cz = Math.round(focusZ);
    const t = w.terrain;
    const key = show ? `${cx}|${cz}|${t.version}|${t.scarVersion}|${buildingSignature(w)}` : "hidden";
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const im of this.meshes) im.count = 0;
    if (!show) {
      for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
      return;
    }
    const o = this.o;
    const n = t.size;
    const R = Math.ceil(o.radius);
    const fadeFrom = o.radius * 0.75;
    const span = Math.max(1, t.heightMax - t.sea);
    const blocked = this.blocked(w);
    let nt = 0;
    let nf = 0;
    let np = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > o.radius) continue;
        const gx = (((cx + dx) % n) + n) % n;
        const gy = (((cz + dz) % n) + n) % n;
        const cell = gy * n + gx;
        if (blocked.has(cell)) continue;
        const h = t.get(gx, gy);
        if (h < t.sea + 1 || t.scar[t.idx(gx, gy)] > 0) continue;
        const slope = t.slope(gx, gy);
        if (slope > o.maxSlope) continue;
        const a = (h - t.sea) / span;
        const fade = d <= fadeFrom ? 1 : Math.max(0, 1 - (d - fadeFrom) / Math.max(0.01, o.radius - fadeFrom));
        // grass thins linearly from the shore band to the high band; pebbles grow with altitude
        const grass = a < o.shoreBand ? 0 : Math.max(0, 1 - (a - o.shoreBand) / Math.max(1e-6, o.highBand - o.shoreBand));
        const nTufts = Math.floor(o.tufts * grass + hashf(cell, 0x11));
        const nPebbles = Math.floor(o.pebbles * (a < o.shoreBand ? 0.5 : Math.min(1, a / Math.max(1e-6, o.highBand))) + hashf(cell, 0x12));
        for (let k = 0; k < nTufts + nPebbles; k++) {
          const tuft = k < nTufts;
          const salt = cell * 7 + k;
          const px = cx + dx - 0.5 + hashf(salt, 0x21);
          const pz = cz + dz - 0.5 + hashf(salt, 0x22);
          const sc = fade * (0.7 + 0.6 * hashf(salt, 0x23));
          if (sc < 0.05) continue;
          this.q.setFromAxisAngle(this.up, hashf(salt, 0x24) * 6.283);
          this.s.set(sc, sc * (tuft ? 0.8 + 0.5 * hashf(salt, 0x25) : 1), sc);
          this.p.set(px, t.heightAt(gx - 0.5 + hashf(salt, 0x21), gy - 0.5 + hashf(salt, 0x22)) * heightScale - 0.02, pz);
          this.m.compose(this.p, this.q, this.s);
          if (tuft) {
            this.tufts.setMatrixAt(nt, this.m);
            const g = 0.85 + 0.3 * hashf(salt, 0x26);
            this.tufts.setColorAt(nt++, this.c.setRGB(g, g, g * 0.92));
            if (hashf(salt, 0x27) < o.flowers * grass && this.flowerColors.length) {
              this.flowers.setMatrixAt(nf, this.m);
              this.flowers.setColorAt(nf++, this.flowerColors[Math.floor(hashf(salt, 0x28) * this.flowerColors.length)]);
            }
          } else {
            this.pebbles.setMatrixAt(np, this.m);
            const g = 0.8 + 0.3 * hashf(salt, 0x29);
            this.pebbles.setColorAt(np++, this.c.setRGB(g, g, g));
          }
        }
      }
    }
    this.tufts.count = nt;
    this.flowers.count = nf;
    this.pebbles.count = np;
    for (const im of this.meshes) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const im of this.meshes) {
      im.geometry.dispose();
      im.dispose();
    }
  }
}

// Stretch 3 (living world): landscape decor. Bushes, fallen logs, mushroom rings, ruins and standing
// stones from the prop GLB models, scattered by a hash of each terrain cell within a radius of the camera
// focus (the same cell always grows the same decor). Each kind has an altitude band and a weight; decor
// keeps off water, scars, steep ground, trees, rocks, building footprints and worship sites. Render only
// (style.json render.decor), the sim never sees it; without the models the layer draws nothing.
// S4 L7-D: kinds grow in a zone. "land" is the scatter above; "shore" kinds (reeds, driftwood) grow on the
// water's edge, down to just under the sea line, on slopes up to 3x maxSlope; "settle" kinds (woodpiles,
// pots, fences) grow in a ring around buildings, outside their one-cell margin, on slopes up to 2x. Shore and settle cells have their own densities and are
// tried first, so a village or a beach reads busier than open country.
import * as THREE from "three";
import { CAT, type World } from "@hearthfall/sim";
import type { ModelParts } from "./models.ts";

export interface DecorKind {
  /** model id (assets/models/<id>.glb) */
  id: string;
  /** relative share among the kinds allowed at a cell's altitude */
  weight: number;
  /** altitude band (0 sea, 1 height cap) the kind grows in */
  low: number;
  high: number;
  /** the model's largest footprint side is scaled to this many cells (height follows) */
  size: number;
  /** S4 L7-D: where the kind grows (default land) */
  zone?: DecorZone;
}

export type DecorZone = "land" | "shore" | "settle";

export interface DecorOptions {
  enabled: boolean;
  /** cells from the focus that grow decor; the outer fifth shrinks it to nothing */
  radius: number;
  /** camera zoom (0 close, 1 globe) above which the layer is hidden */
  maxZoom: number;
  /** chance per dry cell that it carries one piece of decor */
  density: number;
  /** cells steeper than this (height units to a neighbor) grow nothing */
  maxSlope: number;
  /** S4 L7-D: chance per shore cell (within shoreReach of water, at most 6 above the sea) of one shore piece */
  shoreDensity: number;
  shoreReach: number;
  /** S4 L7-D: chance per cell in the ring settleReach wide around a building of one settle piece */
  settleDensity: number;
  settleReach: number;
  kinds: DecorKind[];
}

export const DECOR_DEFAULTS: DecorOptions = {
  enabled: true,
  radius: 44,
  maxZoom: 0.62,
  density: 0.022,
  maxSlope: 4,
  shoreDensity: 0.16,
  shoreReach: 2,
  settleDensity: 0.12,
  settleReach: 3,
  kinds: [
    { id: "prop.bush_a", weight: 6, low: 0.03, high: 0.6, size: 0.9 },
    { id: "prop.log_a", weight: 2, low: 0.05, high: 0.55, size: 1.3 },
    { id: "prop.mushroom_ring", weight: 1.5, low: 0.04, high: 0.4, size: 1.2 },
    { id: "prop.ruin_a", weight: 0.5, low: 0.08, high: 0.8, size: 2.4 },
    { id: "prop.standing_stone", weight: 0.8, low: 0.2, high: 1, size: 1.1 },
  ],
};

const hashf = (i: number, salt: number) => {
  let h = Math.imul(i ^ salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/** Changes when a building, worship site, tree or rock appears or goes (cheap enough for every frame). */
function blockSignature(w: World): number {
  const E = w.ents;
  let s = 0;
  for (let i = 0; i < E.hi; i++) {
    const c = E.cat[i];
    if (E.alive[i] && (c === CAT.building || c === CAT.worship || c === CAT.tree || c === CAT.rock)) s = (s * 31 + i + 1) | 0;
  }
  return s;
}

export class DecorLayer {
  readonly meshes: THREE.InstancedMesh[] = [];
  /** model ids this layer draws (kinds whose model is missing drop out) */
  readonly modelIds: string[] = [];
  private readonly kinds: DecorKind[] = [];
  /** per mesh: scale that brings the model to its kind's size */
  private readonly unit: number[] = [];
  private readonly o: DecorOptions;
  private lastKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(material: THREE.Material, models: ReadonlyMap<string, ModelParts> | null, opts: Partial<DecorOptions> = {}) {
    this.o = { ...DECOR_DEFAULTS, ...opts };
    const r = Math.ceil(this.o.radius);
    const cells = (2 * r + 1) * (2 * r + 1);
    for (const k of this.o.kinds) {
      const part = models?.get(k.id);
      if (!part?.body) continue;
      const zone = k.zone ?? "land";
      const dens = zone === "shore" ? this.o.shoreDensity : zone === "settle" ? this.o.settleDensity : this.o.density;
      // room for the scatter plus a level's hand placed props
      const cap = Math.max(16, Math.ceil(cells * dens * 1.5) + 8) + 64;
      // stand the model on its lowest point
      const g = part.body.clone();
      g.computeBoundingBox();
      g.translate(0, -(g.boundingBox?.min.y ?? 0), 0);
      const im = new THREE.InstancedMesh(g, material, cap);
      im.frustumCulled = false;
      im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      this.meshes.push(im);
      this.kinds.push(k);
      this.modelIds.push(k.id);
      this.unit.push(k.size / Math.max(part.size.x, part.size.z, 0.01));
    }
  }

  /** Cells under buildings, worship sites (with their ring), trees and rocks. */
  private blocked(w: World): Set<number> {
    const out = new Set<number>();
    const E = w.ents;
    const n = w.terrain.size;
    const add = (x0: number, y0: number, fw: number, fh: number) => {
      for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) out.add((((y % n) + n) % n) * n + (((x % n) + n) % n));
    };
    const wr = Math.ceil(w.cfg.pack.buildings.worship?.radius ?? 3) + 1;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const c = E.cat[i];
      if (c === CAT.building) {
        const f = w.economy.footprint(i);
        add(f.x0 - 1, f.y0 - 1, f.fw + 2, f.fh + 2);
      } else if (c === CAT.worship) add(Math.round(E.x[i]) - wr, Math.round(E.y[i]) - wr, 2 * wr + 1, 2 * wr + 1);
      else if (c === CAT.tree || c === CAT.rock) add(Math.round(E.x[i]) - 1, Math.round(E.y[i]) - 1, 3, 3);
    }
    return out;
  }

  /** S4 L7-D: cells in the ring settleReach wide around every building's footprint (the margin is blocked anyway) */
  private settled(w: World): Set<number> {
    const out = new Set<number>();
    const E = w.ents;
    const n = w.terrain.size;
    const r = Math.max(0, Math.round(this.o.settleReach));
    if (!r || !this.kinds.some((k) => k.zone === "settle")) return out;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building) continue;
      const f = w.economy.footprint(i);
      for (let y = f.y0 - r; y < f.y0 + f.fh + r; y++) for (let x = f.x0 - r; x < f.x0 + f.fw + r; x++) out.add((((y % n) + n) % n) * n + (((x % n) + n) % n));
    }
    return out;
  }

  /** S4 L7-D: a cell at most 6 above the sea (down to 1 under it) with water within shoreReach */
  private shore(w: World, gx: number, gy: number, h: number): boolean {
    const t = w.terrain;
    if (h < t.sea - 1 || h > t.sea + 6) return false;
    const n = t.size;
    const r = Math.max(1, Math.round(this.o.shoreReach));
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) if ((dx || dy) && t.get((((gx + dx) % n) + n) % n, (((gy + dy) % n) + n) % n) < t.sea) return true;
    return false;
  }

  /** a kind of `zone` allowed at altitude a, picked by the cell's hash and the kinds' weights (-1: none) */
  private pick(zone: DecorZone, a: number, cell: number, allowed: number[]): number {
    allowed.length = 0;
    let total = 0;
    for (let k = 0; k < this.kinds.length; k++) {
      const kd = this.kinds[k];
      if ((kd.zone ?? "land") !== zone || a < kd.low || a > kd.high) continue;
      allowed.push(k);
      total += kd.weight;
    }
    if (!allowed.length) return -1;
    let pick = hashf(cell, 0x52) * total;
    for (const j of allowed) {
      pick -= this.kinds[j].weight;
      if (pick < 0) return j;
    }
    return allowed[allowed.length - 1];
  }

  /** Re-scatter when the focus crossed a cell, the terrain changed or the zoom crossed maxZoom. */
  update(w: World, focusX: number, focusZ: number, heightScale: number, zoom: number, map: boolean): void {
    if (!this.meshes.length) return;
    const show = !map && zoom <= this.o.maxZoom;
    const cx = Math.round(focusX);
    const cz = Math.round(focusZ);
    const t = w.terrain;
    const key = show ? `${cx}|${cz}|${t.version}|${t.scarVersion}|${blockSignature(w)}|${w.level?.def.id ?? ""}` : "hidden";
    if (key === this.lastKey) return;
    this.lastKey = key;
    const counts = this.meshes.map(() => 0);
    if (show) {
      const o = this.o;
      const n = t.size;
      const R = Math.min(Math.ceil(o.radius), Math.floor(n / 2) - 1);
      const fadeFrom = o.radius * 0.8;
      const span = Math.max(1, t.heightMax - t.sea);
      const blocked = this.blocked(w);
      const settled = this.settled(w);
      const allowed: number[] = [];
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > o.radius) continue;
          const gx = (((cx + dx) % n) + n) % n;
          const gy = (((cz + dz) % n) + n) % n;
          const cell = gy * n + gx;
          if (blocked.has(cell)) continue;
          const h = t.get(gx, gy);
          if (t.scar[t.idx(gx, gy)] > 0) continue;
          // beaches and village yards are rougher than open land (the waterline slope counts the drop into the sea)
          const slope = t.slope(gx, gy);
          const a = Math.max(0, (h - t.sea) / span);
          // settle ring first, then the shore, then the open land scatter
          let k = -1;
          if (h >= t.sea + 1 && slope <= 2 * o.maxSlope && settled.has(cell) && hashf(cell, 0x61) < o.settleDensity) k = this.pick("settle", a, cell, allowed);
          if (k < 0 && slope <= 3 * o.maxSlope && hashf(cell, 0x62) < o.shoreDensity && this.shore(w, gx, gy, h)) k = this.pick("shore", a, cell, allowed);
          if (k < 0 && h >= t.sea + 2 && slope <= o.maxSlope && hashf(cell, 0x51) < o.density) k = this.pick("land", a, cell, allowed);
          if (k < 0) continue;
          const fade = d <= fadeFrom ? 1 : Math.max(0, 1 - (d - fadeFrom) / Math.max(0.01, o.radius - fadeFrom));
          const sc = this.unit[k] * fade * (0.8 + 0.4 * hashf(cell, 0x53));
          if (sc < 0.02) continue;
          const ox = hashf(cell, 0x54) - 0.5;
          const oz = hashf(cell, 0x55) - 0.5;
          this.q.setFromAxisAngle(this.up, hashf(cell, 0x56) * 6.283);
          this.s.set(sc, sc, sc);
          this.p.set(cx + dx + ox, t.heightAt(gx + ox, gy + oz) * heightScale - 0.04, cz + dz + oz);
          this.m.compose(this.p, this.q, this.s);
          const im = this.meshes[k];
          im.setMatrixAt(counts[k], this.m);
          const g = 0.88 + 0.24 * hashf(cell, 0x57);
          im.setColorAt(counts[k]++, this.c.setRGB(g, g, g));
          if (counts[k] >= im.instanceMatrix.count) counts[k] = im.instanceMatrix.count - 1;
        }
      }
    }
    if (show) this.placeProps(w, cx, cz, heightScale, counts);
    this.meshes.forEach((im, k) => {
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }

  /** S4 L7-D: the level's hand placed props (`props`), at their cells, wrapped to the copy nearest the focus */
  private placeProps(w: World, cx: number, cz: number, heightScale: number, counts: number[]): void {
    const props = w.level?.def.props;
    if (!props?.length) return;
    const t = w.terrain;
    const n = t.size;
    for (const p of props) {
      const k = this.modelIds.indexOf(p.model);
      if (k < 0) continue;
      const im = this.meshes[k];
      if (counts[k] >= im.instanceMatrix.count) continue;
      const [x, y] = p.at;
      const sc = (this.unit[k] * (p.size ?? this.kinds[k].size)) / this.kinds[k].size;
      this.q.setFromAxisAngle(this.up, p.rot ?? 0);
      this.s.set(sc, sc, sc);
      this.p.set(x + n * Math.round((cx - x) / n), t.heightAt(x, y) * heightScale - 0.04, y + n * Math.round((cz - y) / n));
      this.m.compose(this.p, this.q, this.s);
      im.setMatrixAt(counts[k], this.m);
      im.setColorAt(counts[k]++, this.c.setRGB(1, 1, 1));
    }
  }

  /** decor instances drawn per model id (tests and the debug summary) */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    this.meshes.forEach((im, k) => (out[this.modelIds[k]] = im.count));
    return out;
  }

  dispose(): void {
    for (const im of this.meshes) {
      im.geometry.dispose();
      im.dispose();
    }
  }
}

// Trees and rocks as InstancedMesh, placed at the wrapped copy nearest the focus by instance origin. Real
// GLB models (M10, models.ts) when loaded, else faceted procedural placeholders from the palette.
// BACKLOG 0c: stone outcrops (CAT.rock) draw from the rock models, shrinking as they are quarried.
// BACKLOG 0a: a tall three-tier conifer joins the GLB set and takes PINE_SHARE of the trees, so forests
// read as dark pine belts (the look v2 target) instead of round blobs.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAT, type World } from "@hearthfall/sim";
import { ROCK_MODELS, TREE_MODELS, trimBase, type ModelParts } from "./models.ts";

/** tree models are 2 to 3 units tall; this brings them to the placeholder scale the sim spacing expects */
const TREE_MODEL_SCALE = 0.72;
/** share of trees drawn as the tall conifer when the GLB models are loaded (BACKLOG 0a) */
export const PINE_SHARE = 0.7;
/** footprint width and height cap of a full rock outcrop in world units (BACKLOG 0c): a tall model is
 * scaled down to the cap so no rock reads as a standing stone or monolith */
export const ROCK_WIDTH = 1.7;
export const ROCK_HEIGHT = 1.2;

function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  return ng;
}

export function pineGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5).translate(0, 0.25, 0), new THREE.Color(pal.woodDark ?? "#5e3a1a"));
  const low = colored(new THREE.ConeGeometry(0.5, 0.9, 6).translate(0, 0.8, 0), new THREE.Color(pal.forest ?? "#3f6b2e"));
  const high = colored(new THREE.ConeGeometry(0.36, 0.75, 6).translate(0, 1.3, 0), new THREE.Color(pal.forest ?? "#3f6b2e").lerp(new THREE.Color(pal.moss ?? "#5e8c3a"), 0.35));
  return mergeGeometries([trunk, low, high])!;
}

/** BACKLOG 0a: a tall, narrow conifer in three tiers (about 2.1 units), dark at the base and lighter on top. */
export function tallPineGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  const dark = new THREE.Color(pal.forest ?? "#3f6b2e").multiplyScalar(0.8);
  const light = new THREE.Color(pal.forest ?? "#3f6b2e").lerp(new THREE.Color(pal.moss ?? "#5e8c3a"), 0.45);
  const trunk = colored(new THREE.CylinderGeometry(0.06, 0.09, 0.45, 5).translate(0, 0.22, 0), new THREE.Color(pal.woodDark ?? "#5e3a1a"));
  const tiers = [0, 1, 2].map((k) =>
    colored(new THREE.ConeGeometry(0.46 - k * 0.11, 0.9 - k * 0.12, 7).translate(0, 0.75 + k * 0.48, 0), dark.clone().lerp(light, k / 2)),
  );
  return mergeGeometries([trunk, ...tiers])!;
}

/** BACKLOG 0c: a faceted grey boulder pile, about one unit wide, for when the rock models are not loaded. */
export function rockGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  const base = new THREE.Color(pal.rock ?? "#8a8378");
  const big = colored(new THREE.DodecahedronGeometry(0.45, 0).scale(1, 0.75, 1).translate(0, 0.3, 0), base);
  const small = colored(new THREE.DodecahedronGeometry(0.28, 0).scale(1, 0.8, 1).translate(0.38, 0.18, 0.12), base.clone().multiplyScalar(0.8));
  return mergeGeometries([big, small])!;
}

export function broadleafGeometry(pal: Record<string, string>): THREE.BufferGeometry {
  const trunk = colored(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 5).translate(0, 0.3, 0), new THREE.Color(pal.wood ?? "#8b5a2b"));
  const crown = colored(new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.85, 1).translate(0, 0.95, 0), new THREE.Color(pal.moss ?? "#5e8c3a").lerp(new THREE.Color(pal.meadow ?? "#8dbf5a"), 0.3));
  return mergeGeometries([trunk, crown])!;
}

const hashf = (i: number, salt: number) => {
  let h = Math.imul(i ^ salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

export class TreeLayer {
  readonly meshes: THREE.InstancedMesh[];
  /** model ids drawn by this layer (empty: placeholders) */
  readonly modelIds: string[] = [];
  private readonly unit: number;
  /** mesh index of the tall conifer (-1 with placeholders) */
  private readonly pine: number;
  /** first rock mesh index and per-rock-mesh scale to ROCK_WIDTH (BACKLOG 0c) */
  private readonly rock0: number;
  private readonly rockScale: number[];
  private cap: number;
  private lastKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  constructor(material: THREE.Material, pal: Record<string, string>, models: ReadonlyMap<string, ModelParts> | null = null, cap = 8192) {
    this.cap = cap;
    const real = models && TREE_MODELS.every((id) => models.has(id)) ? TREE_MODELS.map((id) => trimBase(models.get(id)!.body!, models.get(id)!.size.y, 0.2, 0.45)) : null;
    if (real) this.modelIds.push(...TREE_MODELS);
    this.unit = real ? TREE_MODEL_SCALE : 1;
    // with real models the conifer is the last mesh, drawn at its own (placeholder) scale
    this.pine = real ? real.length : -1;
    const trees = real ? [...real, tallPineGeometry(pal)] : [pineGeometry(pal), broadleafGeometry(pal)];
    const rocks = models && ROCK_MODELS.every((id) => models.get(id)?.body) ? ROCK_MODELS.map((id) => models.get(id)!) : null;
    if (rocks) this.modelIds.push(...ROCK_MODELS);
    this.rock0 = trees.length;
    this.rockScale = rocks ? rocks.map((m) => Math.min(ROCK_WIDTH / Math.max(m.size.x, m.size.z, 0.01), ROCK_HEIGHT / Math.max(m.size.y, 0.01))) : [ROCK_WIDTH];
    const rockGeos = rocks ? rocks.map((m) => m.body!) : [rockGeometry(pal)];
    this.meshes = [...trees, ...rockGeos].map((g) => {
      const im = new THREE.InstancedMesh(g, material, cap);
      im.frustumCulled = false;
      im.count = 0;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      return im;
    });
  }

  /** Re-place instances when the focus moved, the terrain changed or trees appeared or vanished. */
  update(w: World, focusX: number, focusZ: number, heightScale: number): void {
    const E = w.ents;
    const n = w.terrain.size;
    const key = `${focusX.toFixed(2)}|${focusZ.toFixed(2)}|${w.terrain.version}|${w.treeVersion}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const counts = this.meshes.map(() => 0);
    const maxStone = w.cfg.pack.buildings.rocks?.maxStone ?? 16;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.cat[i] === CAT.rock) {
        const r = Math.min(this.rockScale.length - 1, Math.floor(hashf(i, 0x2b) * this.rockScale.length));
        const kind = this.rock0 + r;
        const k = counts[kind];
        if (k >= this.cap) continue;
        let x = E.x[i] - focusX;
        let z = E.y[i] - focusZ;
        x -= Math.round(x / n) * n;
        z -= Math.round(z / n) * n;
        const sc = this.rockScale[r] * (0.85 + 0.3 * hashf(i, 0x5d)) * (0.55 + (0.45 * E.stone[i]) / maxStone);
        this.q.setFromAxisAngle(this.up, hashf(i, 0x47) * 6.283);
        this.s.set(sc, sc, sc);
        this.p.set(focusX + x, w.terrain.heightAt(E.x[i], E.y[i]) * heightScale - 0.05, focusZ + z);
        this.m.compose(this.p, this.q, this.s);
        this.meshes[kind].setMatrixAt(k, this.m);
        const g = 0.9 + 0.2 * hashf(i, 0x61);
        this.meshes[kind].setColorAt(k, this.c.setRGB(g, g, g));
        counts[kind]++;
        continue;
      }
      if (E.cat[i] !== CAT.tree) continue;
      const h = hashf(i, 0x51);
      const kind =
        this.pine < 0
          ? h < 0.6 ? 0 : 1
          : h < PINE_SHARE ? this.pine : Math.min(this.pine - 1, Math.floor(((h - PINE_SHARE) / (1 - PINE_SHARE)) * this.pine));
      const isPine = kind === this.pine;
      const k = counts[kind];
      if (k >= this.cap) continue;
      let x = E.x[i] - focusX;
      let z = E.y[i] - focusZ;
      x -= Math.round(x / n) * n;
      z -= Math.round(z / n) * n;
      const y = w.terrain.heightAt(E.x[i], E.y[i]) * heightScale;
      const sc = (isPine ? 1 : this.unit) * (0.8 + 0.5 * hashf(i, 0x77)) * (0.6 + (0.4 * E.wood[i]) / 4);
      this.q.setFromAxisAngle(this.up, hashf(i, 0x33) * 6.283);
      this.s.set(sc, sc * (isPine ? 1.05 + 0.35 * hashf(i, 0x99) : 0.9 + 0.3 * hashf(i, 0x99)), sc);
      this.p.set(focusX + x, y - 0.05, focusZ + z);
      this.m.compose(this.p, this.q, this.s);
      this.meshes[kind].setMatrixAt(k, this.m);
      // real tree models read as dark blobs from afar (M10 sheet), so they are lifted and nudged toward the meadow
      const tint = (this.unit < 1 && !isPine ? 1.35 : 0.85) + 0.3 * hashf(i, 0x13);
      if (this.unit < 1 && !isPine) this.c.setRGB(tint * 0.95, tint * 1.1, tint * 0.8);
      else this.c.setRGB(tint, tint, tint * 0.95);
      this.meshes[kind].setColorAt(k, this.c);
      counts[kind]++;
    }
    this.meshes.forEach((im, kind) => {
      im.count = counts[kind];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
  }
}

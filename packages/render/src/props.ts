// Trees as InstancedMesh, placed at the wrapped copy nearest the focus by instance origin. Real GLB
// tree models (M10, models.ts) when loaded, else faceted procedural placeholders from the palette.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAT, type World } from "@hearthfall/sim";
import { TREE_MODELS, trimBase, type ModelParts } from "./models.ts";

/** tree models are 2 to 3 units tall; this brings them to the placeholder scale the sim spacing expects */
const TREE_MODEL_SCALE = 0.72;

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
    this.meshes = (real ?? [pineGeometry(pal), broadleafGeometry(pal)]).map((g) => {
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
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.tree) continue;
      const h = hashf(i, 0x51);
      const kind = this.meshes.length === 2 ? (h < 0.6 ? 0 : 1) : Math.min(this.meshes.length - 1, Math.floor(h * this.meshes.length));
      const k = counts[kind];
      if (k >= this.cap) continue;
      let x = E.x[i] - focusX;
      let z = E.y[i] - focusZ;
      x -= Math.round(x / n) * n;
      z -= Math.round(z / n) * n;
      const y = w.terrain.heightAt(E.x[i], E.y[i]) * heightScale;
      const sc = this.unit * (0.8 + 0.5 * hashf(i, 0x77)) * (0.6 + (0.4 * E.wood[i]) / 4);
      this.q.setFromAxisAngle(this.up, hashf(i, 0x33) * 6.283);
      this.s.set(sc, sc * (0.9 + 0.3 * hashf(i, 0x99)), sc);
      this.p.set(focusX + x, y - 0.05, focusZ + z);
      this.m.compose(this.p, this.q, this.s);
      this.meshes[kind].setMatrixAt(k, this.m);
      const tint = 0.85 + 0.3 * hashf(i, 0x13);
      this.c.setRGB(tint, tint, tint * 0.95);
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

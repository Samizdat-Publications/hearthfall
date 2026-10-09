// Real GLB models (A4, M10). The asset pipeline normalizes every model to world units with the pivot at
// the base center and palette-snapped vertex colors, no textures (docs/ASSETS.md). Here a model is
// split into an untinted body and a tint part: the triangles painted in the tribe marker color
// (`azure`), recolored white so an instance color paints them per tribe. A building whose model has
// almost no marker color gets a small banner as its tint part, so tribe ownership always reads.
// Layers fall back to their procedural placeholders for any id without a model.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface ModelParts {
  /** untinted structure (vertex colors), or null when the whole model is tint */
  body: THREE.BufferGeometry | null;
  /** white triangles an instance color paints with the tribe color, or null */
  tint: THREE.BufferGeometry | null;
  /** share of the source triangles that were marker colored */
  tintShare: number;
  /** source bounds (world units) */
  size: THREE.Vector3;
}

/** Model ids per kind of thing the renderer draws, by naming convention (assets/models/<id>.glb). */
export function buildingModelIds(id: string, levels: number): string[] {
  if (levels <= 1) return [`building.${id}`];
  const names = ["small", "medium", "large"];
  return Array.from({ length: levels }, (_, k) => `building.${id}_${names[Math.min(k, names.length - 1)]}`);
}
export const unitModelId = (id: string) => (id === "wild" ? "unit.wild_person" : `unit.${id}`);
export const worshipModelId = (id: string) => `building.${id}`;
export const TREE_MODELS = ["prop.tree_a", "prop.tree_b", "prop.tree_c"];
/** BACKLOG 0c: stone outcrops */
export const ROCK_MODELS = ["prop.rock_a", "prop.rock_b", "prop.rock_c"];

/** sRGB hex of a linear vertex color, to compare against palette hex exactly as the pipeline snapped it. */
const scratch = new THREE.Color();
function hexOf(r: number, g: number, b: number): number {
  return scratch.setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHex(THREE.SRGBColorSpace);
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) <= tol && Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) <= tol && Math.abs((a & 255) - (b & 255)) <= tol;
}

function geometryFrom(pos: number[], col: number[]): THREE.BufferGeometry | null {
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * Split a model geometry by marker color: a triangle whose three vertices are all within `tol`
 * (0 to 255 per sRGB channel) of `markerHex` goes to the tint part. Output is non-indexed position
 * plus 3-component color (normals and uvs dropped: the prop material is flat shaded).
 */
export function splitModel(src: THREE.BufferGeometry, markerHex: string, tol = 6): ModelParts {
  const g = src.index ? src.toNonIndexed() : src;
  const p = g.getAttribute("position");
  const c = g.getAttribute("color");
  const marker = new THREE.Color(markerHex).getHex(THREE.SRGBColorSpace);
  const bp: number[] = [];
  const bc: number[] = [];
  const tp: number[] = [];
  const tc: number[] = [];
  let tinted = 0;
  const tris = p.count / 3;
  for (let t = 0; t < tris; t++) {
    let all = !!c;
    for (let v = 0; v < 3 && all; v++) {
      const i = t * 3 + v;
      all = near(hexOf(c.getX(i), c.getY(i), c.getZ(i)), marker, tol);
    }
    if (all) tinted++;
    for (let v = 0; v < 3; v++) {
      const i = t * 3 + v;
      if (all) {
        tp.push(p.getX(i), p.getY(i), p.getZ(i));
        tc.push(1, 1, 1);
      } else {
        bp.push(p.getX(i), p.getY(i), p.getZ(i));
        if (c) bc.push(c.getX(i), c.getY(i), c.getZ(i));
        else bc.push(1, 1, 1);
      }
    }
  }
  g.computeBoundingBox();
  const size = g.boundingBox!.getSize(new THREE.Vector3());
  return { body: geometryFrom(bp, bc), tint: geometryFrom(tp, tc), tintShare: tris ? tinted / tris : 0, size };
}

/**
 * Drop a baked ground plate: triangles entirely in the bottom `yFrac` of the model height that reach
 * past `rMax` from the pivot axis (text-to-3D props sometimes come with a wide root disc that reads as
 * a brown blob on the terrain).
 */
export function trimBase(g: THREE.BufferGeometry, height: number, yFrac: number, rMax: number): THREE.BufferGeometry {
  const p = g.getAttribute("position");
  const c = g.getAttribute("color");
  const pos: number[] = [];
  const col: number[] = [];
  for (let t = 0; t < p.count / 3; t++) {
    let low = true;
    let wide = false;
    for (let v = 0; v < 3; v++) {
      const i = t * 3 + v;
      if (p.getY(i) > height * yFrac) low = false;
      if (Math.hypot(p.getX(i), p.getZ(i)) > rMax) wide = true;
    }
    if (low && wide) continue;
    for (let v = 0; v < 3; v++) {
      const i = t * 3 + v;
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  }
  return geometryFrom(pos, col) ?? g;
}

function solid(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  const n = ng.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return ng;
}

/** Give a model with too little marker color a banner (pole into the body, white flag as tint). */
export function withBanner(parts: ModelParts, wood: THREE.Color, minShare = 0.01): ModelParts {
  if (parts.tint && parts.tintShare >= minShare) return parts;
  const x = parts.size.x * 0.42;
  const z = parts.size.z * 0.42;
  const h = parts.size.y * 0.75 + 0.55;
  const pole = solid(new THREE.CylinderGeometry(0.035, 0.035, h, 4).translate(x, h / 2, z), wood);
  const flag = solid(new THREE.BoxGeometry(0.4, 0.28, 0.06).translate(x + 0.21, h - 0.16, z), new THREE.Color("#ffffff"));
  const body = parts.body ? mergeGeometries([parts.body, pole])! : pole;
  const tint = parts.tint ? mergeGeometries([parts.tint, flag])! : flag;
  return { ...parts, body, tint };
}

/** The first mesh geometry of a parsed glTF scene, with its world transform baked in. */
function sceneGeometry(scene: THREE.Object3D): THREE.BufferGeometry | null {
  scene.updateMatrixWorld(true);
  let out: THREE.BufferGeometry | null = null;
  scene.traverse((o) => {
    if (out || !(o instanceof THREE.Mesh)) return;
    out = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld);
  });
  return out;
}

/** Parse one GLB (ArrayBuffer) into split parts. */
export async function parseModel(data: ArrayBuffer, markerHex: string): Promise<ModelParts | null> {
  const gltf = await new GLTFLoader().parseAsync(data, "");
  const g = sceneGeometry(gltf.scene);
  return g ? splitModel(g, markerHex) : null;
}

export interface ModelLoadReport {
  loaded: string[];
  failed: string[];
}

/**
 * Load models by id from URLs. Failures are reported, never thrown: the layer keeps its placeholder.
 * `fetchBytes` is injectable for tests (Node reads files instead of fetching URLs).
 */
export async function loadModels(
  urls: Readonly<Record<string, string>>,
  markerHex: string,
  fetchBytes: (url: string) => Promise<ArrayBuffer> = async (u) => (await fetch(u)).arrayBuffer(),
): Promise<{ models: Map<string, ModelParts>; report: ModelLoadReport }> {
  const models = new Map<string, ModelParts>();
  const report: ModelLoadReport = { loaded: [], failed: [] };
  await Promise.all(
    Object.entries(urls).map(async ([id, url]) => {
      try {
        const m = await parseModel(await fetchBytes(url), markerHex);
        if (!m) throw new Error("no mesh");
        models.set(id, m);
        report.loaded.push(id);
      } catch {
        report.failed.push(id);
      }
    }),
  );
  report.loaded.sort();
  report.failed.sort();
  return { models, report };
}

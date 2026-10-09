// Placeholder units until real GLB assets land (M10): per unit kind an instanced body (tinted with
// the tribe color through instanceColor) plus an untinted head/detail mesh. Positions interpolate
// between the previous and current sim tick, wrap by instance origin to the copy nearest the focus,
// bob while moving and face their velocity. Also keeps screen positions for picking and selection.
// M11 readability: real models carry little tribe color (a loincloth), so every tribe unit stands on a
// small disc in its tribe color, and the Shaper is drawn larger on a larger disc.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { unitModelId, type ModelParts } from "./models.ts";
import { CAT, type World } from "@hearthfall/sim";

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

interface KindGeo {
  body: THREE.BufferGeometry;
  detail: THREE.BufferGeometry;
}

/** Procedural placeholder silhouettes per unit id (white body = tinted cloth). */
function kindGeometry(id: string, pal: Record<string, string>): KindGeo {
  const W = new THREE.Color("#ffffff");
  const skin = new THREE.Color(pal.skin1 ?? "#e2b48c");
  const wood = new THREE.Color(pal.wood ?? "#8b5a2b");
  const head = (y: number, r = 0.12) => colored(new THREE.IcosahedronGeometry(r, 0).translate(0, y, 0), skin);
  switch (id) {
    case "shaper": {
      const robe = colored(new THREE.ConeGeometry(0.26, 0.8, 7).translate(0, 0.4, 0), W);
      const crown = colored(new THREE.ConeGeometry(0.1, 0.22, 5).translate(0, 1.04, 0), new THREE.Color(pal.magic ?? "#b07cff"));
      const staff = colored(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 4).translate(0.24, 0.55, 0), wood);
      const orb = colored(new THREE.OctahedronGeometry(0.07).translate(0.24, 1.12, 0), new THREE.Color(pal.lightning ?? "#bfe8ff"));
      return { body: robe, detail: mergeGeometries([head(0.88, 0.13), crown, staff, orb])! };
    }
    case "warden": {
      const torso = colored(new THREE.CylinderGeometry(0.2, 0.17, 0.55, 6).translate(0, 0.42, 0), W);
      const shield = colored(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 8).rotateZ(Math.PI / 2).translate(-0.22, 0.45, 0.05), wood);
      const club = colored(new THREE.CylinderGeometry(0.04, 0.07, 0.5, 5).rotateX(0.5).translate(0.22, 0.45, 0.12), new THREE.Color(pal.woodDark ?? "#5e3a1a"));
      return { body: torso, detail: mergeGeometries([head(0.82, 0.13), shield, club])! };
    }
    case "firecaller": {
      const robe = colored(new THREE.ConeGeometry(0.2, 0.7, 6).translate(0, 0.35, 0), W);
      const flame = colored(new THREE.OctahedronGeometry(0.08).translate(0.2, 0.62, 0.05), new THREE.Color(pal.fire ?? "#ff7a1a"));
      return { body: robe, detail: mergeGeometries([head(0.78), flame])! };
    }
    case "chanter": {
      const robe = colored(new THREE.ConeGeometry(0.22, 0.72, 8).translate(0, 0.36, 0), W);
      const hood = colored(new THREE.ConeGeometry(0.13, 0.2, 6).translate(0, 0.92, 0), new THREE.Color(pal.cloth ?? "#d9cbb0"));
      return { body: robe, detail: mergeGeometries([head(0.8), hood])! };
    }
    default: {
      // settler, wild and anything new: simple tunic and head
      const tunic = colored(new THREE.CylinderGeometry(0.13, 0.17, 0.5, 6).translate(0, 0.35, 0), W);
      const legs = colored(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 6).translate(0, 0.06, 0), new THREE.Color(pal.woodDark ?? "#5e3a1a"));
      return { body: tunic, detail: mergeGeometries([head(0.72), legs])! };
    }
  }
}

/** tribe disc radius under each unit (before the readability scale), and the Shaper's extra sizes */
export const DISC_RADIUS = 0.26;
const SHAPER_SCALE = 1.2;
const SHAPER_DISC = 1.5;

export class UnitLayer {
  readonly group = new THREE.Group();
  private kinds: { body: THREE.InstancedMesh; detail: THREE.InstancedMesh }[] = [];
  /** model ids drawn by this layer (the rest are placeholders) */
  readonly modelIds: string[] = [];
  private ring: THREE.InstancedMesh;
  /** tribe discs under units (instance color = tribe), public for tests */
  readonly disc: THREE.InstancedMesh;
  /** per kind draw scale (the Shaper stands out) */
  private kindScale: number[] = [];
  private readonly cap: number;
  private tribeColors: THREE.Color[];
  private wildColor: THREE.Color;
  private facing = new Float32Array(1024);
  /** screen positions (pixels) of units drawn last frame, NaN when not drawn */
  screenX = new Float32Array(1024);
  screenY = new Float32Array(1024);
  drawn = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  /** readability scale: units are tiny on screen, silhouette and tribe color matter most */
  private readonly s = new THREE.Vector3(1.3, 1.3, 1.3);
  private readonly p = new THREE.Vector3();
  private readonly sk = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly v = new THREE.Vector3();

  constructor(material: THREE.Material, ringMaterial: THREE.Material, unitIds: string[], pal: Record<string, string>, tribeColorNames: string[], models: ReadonlyMap<string, ModelParts> | null = null, cap = 8192) {
    this.cap = cap;
    this.tribeColors = tribeColorNames.map((c) => new THREE.Color(pal[c] ?? "#ffffff"));
    this.wildColor = new THREE.Color(pal.cloth ?? "#d9cbb0");
    const empty = () => new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([], 3));
    for (const id of unitIds) {
      // a model's tribe-color triangles are the tinted body, the rest is the untinted detail
      const m = models?.get(unitModelId(id));
      if (m) this.modelIds.push(unitModelId(id));
      const g = m ? { body: m.tint ?? empty(), detail: m.body ?? empty() } : kindGeometry(id, pal);
      const body = new THREE.InstancedMesh(g.body, material, cap);
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      const detail = new THREE.InstancedMesh(g.detail, material, cap);
      for (const im of [body, detail]) {
        im.frustumCulled = false;
        im.count = 0;
        this.group.add(im);
      }
      this.kinds.push({ body, detail });
      this.kindScale.push(id === "shaper" ? SHAPER_SCALE : 1);
    }
    const discGeo = colored(new THREE.CircleGeometry(DISC_RADIUS, 12).rotateX(-Math.PI / 2), new THREE.Color("#ffffff"));
    this.disc = new THREE.InstancedMesh(discGeo, material, cap);
    this.disc.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.disc.frustumCulled = false;
    this.disc.count = 0;
    this.group.add(this.disc);
    const ringGeo = new THREE.RingGeometry(0.32, 0.42, 16).rotateX(-Math.PI / 2);
    this.ring = new THREE.InstancedMesh(ringGeo, ringMaterial, 2048);
    this.ring.frustumCulled = false;
    this.ring.count = 0;
    this.group.add(this.ring);
  }

  private grow(hi: number): void {
    if (this.facing.length >= hi) return;
    const n = Math.max(hi, this.facing.length * 2);
    const f = new Float32Array(n);
    f.set(this.facing);
    this.facing = f;
    this.screenX = new Float32Array(n);
    this.screenY = new Float32Array(n);
  }

  update(w: World, alpha: number, focusX: number, focusZ: number, heightScale: number, visualTime: number, fadeEnd: number, camera: THREE.Camera, bendK: number, viewW: number, viewH: number, selected: ReadonlySet<number>): void {
    const E = w.ents;
    const n = w.terrain.size;
    this.grow(E.hi);
    this.screenX.fill(NaN);
    const counts = new Int32Array(this.kinds.length);
    let rings = 0;
    let discs = 0;
    this.drawn = 0;
    const fade2 = fadeEnd * fadeEnd;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.unit || E.inside[i] >= 0) continue;
      const k = E.type[i];
      if (k >= this.kinds.length) continue;
      // interpolate with wrap-aware delta
      let dx = E.x[i] - E.px[i];
      let dz = E.y[i] - E.py[i];
      if (dx > n / 2) dx -= n;
      else if (dx < -n / 2) dx += n;
      if (dz > n / 2) dz -= n;
      else if (dz < -n / 2) dz += n;
      const ix = E.px[i] + dx * alpha;
      const iz = E.py[i] + dz * alpha;
      let ox = ix - focusX;
      let oz = iz - focusZ;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      if (ox * ox + oz * oz > fade2) continue;
      const moving = E.vx[i] !== 0 || E.vy[i] !== 0;
      if (moving) this.facing[i] = Math.atan2(E.vx[i], E.vy[i]);
      const ground = Math.max(w.terrain.heightAt(((ix % n) + n) % n, ((iz % n) + n) % n), w.terrain.sea - 2) * heightScale;
      const phase = visualTime * 9 + i * 1.7;
      const bob = moving ? Math.abs(Math.sin(phase)) * 0.07 : 0;
      this.p.set(focusX + ox, ground + bob, focusZ + oz);
      this.q.setFromAxisAngle(this.up, this.facing[i]);
      const ks = this.kindScale[k];
      this.sk.copy(this.s).multiplyScalar(ks);
      this.m.compose(this.p, this.q, this.sk);
      const c = counts[k]++;
      if (c >= this.cap) continue;
      const kind = this.kinds[k];
      kind.body.setMatrixAt(c, this.m);
      kind.detail.setMatrixAt(c, this.m);
      kind.body.setColorAt(c, E.tribe[i] >= 0 ? this.tribeColors[E.tribe[i] % this.tribeColors.length] : this.wildColor);
      if (E.tribe[i] >= 0 && discs < this.cap) {
        this.p.y = ground + 0.02;
        this.sk.setScalar(this.s.x * (ks > 1 ? SHAPER_DISC : 1));
        this.m.compose(this.p, this.q, this.sk);
        this.disc.setMatrixAt(discs, this.m);
        this.disc.setColorAt(discs++, this.tribeColors[E.tribe[i] % this.tribeColors.length]);
        this.p.y = ground + bob;
      }
      if (selected.has(i) && rings < 2048) {
        this.p.y = ground + 0.03;
        this.m.compose(this.p, this.q.identity(), this.s);
        this.ring.setMatrixAt(rings++, this.m);
      }
      // screen position of the bent unit center for picking
      const dist2 = ox * ox + oz * oz;
      this.v.set(focusX + ox, ground + 0.45 - bendK * dist2, focusZ + oz).project(camera);
      if (this.v.z < 1) {
        this.screenX[i] = ((this.v.x + 1) / 2) * viewW;
        this.screenY[i] = ((1 - this.v.y) / 2) * viewH;
      }
      this.drawn++;
    }
    this.kinds.forEach((kind, k) => {
      kind.body.count = Math.min(counts[k], this.cap);
      kind.detail.count = Math.min(counts[k], this.cap);
      kind.body.instanceMatrix.needsUpdate = true;
      kind.detail.instanceMatrix.needsUpdate = true;
      if (kind.body.instanceColor) kind.body.instanceColor.needsUpdate = true;
    });
    this.ring.count = rings;
    this.ring.instanceMatrix.needsUpdate = true;
    this.disc.count = discs;
    this.disc.instanceMatrix.needsUpdate = true;
    if (this.disc.instanceColor) this.disc.instanceColor.needsUpdate = true;
  }
}

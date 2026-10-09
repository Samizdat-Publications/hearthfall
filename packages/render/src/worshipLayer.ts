// Worship objects (M9): per kind an untinted structure and a tinted part (the color of the tribe
// leading the prayer, else the last tribe to finish it, else a pale glow). A spent site goes grey.
// Real GLB models (M10) replace the placeholders, scaled up to the prayer ring, with a banner when the
// model has no marker color. Static between sim ticks, so no interpolation.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAT, type World } from "@hearthfall/sim";
import { colored } from "./buildingsLayer.ts";
import { withBanner, worshipModelId, type ModelParts } from "./models.ts";

/** worship models are drawn larger than their building-sized source so the site reads as a landmark */
const WORSHIP_MODEL_SCALE = 1.5;

function worshipGeometry(id: string, pal: Record<string, string>): { body: THREE.BufferGeometry; tint: THREE.BufferGeometry } {
  const C = (k: string, d: string) => new THREE.Color(pal[k] ?? d);
  const stone = C("stone", "#a9a196");
  const dark = C("woodDark", "#5e3a1a");
  const white = new THREE.Color("#ffffff");
  switch (id) {
    case "reliquary": {
      const dais = colored(new THREE.CylinderGeometry(1.5, 1.7, 0.35, 8).translate(0, 0.17, 0), stone);
      const step = colored(new THREE.CylinderGeometry(1.1, 1.2, 0.3, 8).translate(0, 0.5, 0), stone);
      const obelisk = colored(new THREE.CylinderGeometry(0.22, 0.38, 2.4, 4).translate(0, 1.85, 0), stone);
      const cap = colored(new THREE.OctahedronGeometry(0.42).translate(0, 3.25, 0), white);
      return { body: mergeGeometries([dais, step, obelisk])!, tint: cap };
    }
    case "totem": {
      const pole = colored(new THREE.CylinderGeometry(0.2, 0.26, 2.2, 6).translate(0, 1.1, 0), dark);
      const wings = colored(new THREE.BoxGeometry(1.3, 0.18, 0.18).translate(0, 1.75, 0), dark);
      const face = colored(new THREE.BoxGeometry(0.46, 0.5, 0.46).translate(0, 2.45, 0), white);
      return { body: mergeGeometries([pole, wings])!, tint: face };
    }
    default: {
      // shrine: a ring of standing stones around a glowing orb
      const parts: THREE.BufferGeometry[] = [colored(new THREE.CylinderGeometry(1.2, 1.3, 0.2, 10).translate(0, 0.1, 0), stone)];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        parts.push(colored(new THREE.BoxGeometry(0.28, 1.1, 0.22).rotateY(-a).translate(Math.cos(a) * 1.0, 0.65, Math.sin(a) * 1.0), stone));
      }
      parts.push(colored(new THREE.CylinderGeometry(0.22, 0.3, 0.7, 6).translate(0, 0.45, 0), stone));
      const orb = colored(new THREE.IcosahedronGeometry(0.34, 0).translate(0, 1.1, 0), white);
      return { body: mergeGeometries(parts)!, tint: orb };
    }
  }
}

export class WorshipLayer {
  readonly group = new THREE.Group();
  private kinds: { body: THREE.InstancedMesh; tint: THREE.InstancedMesh; scale: number }[] = [];
  /** model ids drawn by this layer (the rest are placeholders) */
  readonly modelIds: string[] = [];
  private tribeColors: THREE.Color[];
  private readonly glow: THREE.Color;
  private readonly spent = new THREE.Color("#6f6a64");
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();

  constructor(material: THREE.Material, kinds: { id: string }[], pal: Record<string, string>, tribeColorNames: string[], models: ReadonlyMap<string, ModelParts> | null = null, cap = 64) {
    this.tribeColors = tribeColorNames.map((c) => new THREE.Color(pal[c] ?? "#ffffff"));
    this.glow = new THREE.Color(pal.lightning ?? "#bfe8ff");
    for (const k of kinds) {
      const src = models?.get(worshipModelId(k.id));
      if (src) this.modelIds.push(worshipModelId(k.id));
      const m = src ? withBanner(src, new THREE.Color(pal.wood ?? "#8b5a2b")) : null;
      const g = m ? { body: m.body!, tint: m.tint! } : worshipGeometry(k.id, pal);
      const body = new THREE.InstancedMesh(g.body, material, cap);
      const tint = new THREE.InstancedMesh(g.tint, material, cap);
      tint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      for (const im of [body, tint]) {
        im.frustumCulled = false;
        im.count = 0;
        this.group.add(im);
      }
      this.kinds.push({ body, tint, scale: m ? WORSHIP_MODEL_SCALE : 1 });
    }
  }

  update(w: World, focusX: number, focusZ: number, heightScale: number): void {
    const E = w.ents;
    const n = w.terrain.size;
    const counts = new Int32Array(this.kinds.length);
    for (const site of w.worship.sites) {
      const i = E.index(site.ent);
      if (i < 0 || !E.alive[i] || E.cat[i] !== CAT.worship) continue;
      const kind = this.kinds[site.kind];
      if (!kind) continue;
      let ox = E.x[i] - focusX;
      let oz = E.y[i] - focusZ;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      const y = Math.max(w.terrain.heightAt(E.x[i], E.y[i]), w.terrain.sea) * heightScale;
      this.p.set(focusX + ox, y - 0.05, focusZ + oz);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2);
      this.m.compose(this.p, this.q, this.s.setScalar(kind.scale));
      let lead = -1;
      let best = 0;
      site.progress.forEach((v, t) => {
        if (v > best) {
          best = v;
          lead = t;
        }
      });
      const who = lead >= 0 ? lead : site.lastBy;
      const col = site.usesLeft <= 0 ? this.spent : who >= 0 ? this.tribeColors[who % this.tribeColors.length] : this.glow;
      const c = counts[site.kind]++;
      kind.body.setMatrixAt(c, this.m);
      kind.tint.setMatrixAt(c, this.m);
      kind.tint.setColorAt(c, col);
    }
    this.kinds.forEach((kind, k) => {
      kind.body.count = counts[k];
      kind.tint.count = counts[k];
      kind.body.instanceMatrix.needsUpdate = true;
      kind.tint.instanceMatrix.needsUpdate = true;
      if (kind.tint.instanceColor) kind.tint.instanceColor.needsUpdate = true;
    });
  }
}

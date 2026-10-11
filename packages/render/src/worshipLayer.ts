// Worship objects (M9): per kind an untinted structure and a tinted part (the color of the tribe
// leading the prayer, else the last tribe to finish it, else a pale glow). A spent site goes grey.
// Real GLB models (M10) replace the placeholders, scaled up to the prayer ring, with a banner when the
// model has no marker color. Static between sim ticks, so no interpolation. BACKLOG 89: while a tribe
// prays, a segmented ring on the ground around the site fills in its color with the prayer's progress.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAT, type World } from "@hearthfall/sim";
import { colored } from "./buildingsLayer.ts";
import { withBanner, worshipModelId, type ModelParts } from "./models.ts";

/** worship models are drawn larger than their building-sized source so the site reads as a landmark */
const WORSHIP_MODEL_SCALE = 1.5;
/** progress ring: segments around the prayer circle, inner and outer radius as a share of it */
const RING_SEGS = 32;
const RING_IN = 0.86;
const RING_OUT = 1.0;

/** one flat annular sector of the progress ring (angle 0 to one segment, minus a small gap), on the ground plane */
function ringSegment(): THREE.BufferGeometry {
  const a1 = ((Math.PI * 2) / RING_SEGS) * 0.8;
  const pts: number[] = [];
  const steps = 3;
  for (let k = 0; k < steps; k++) {
    const t0 = (a1 * k) / steps;
    const t1 = (a1 * (k + 1)) / steps;
    const p = (r: number, t: number) => [Math.cos(t) * r, 0, Math.sin(t) * r];
    pts.push(...p(RING_IN, t0), ...p(RING_OUT, t1), ...p(RING_OUT, t0), ...p(RING_IN, t0), ...p(RING_IN, t1), ...p(RING_OUT, t1));
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}

function worshipGeometry(id: string, pal: Record<string, string>): { body: THREE.BufferGeometry; tint: THREE.BufferGeometry } {
  const C = (k: string, d: string) => new THREE.Color(pal[k] ?? d);
  // BACKLOG 89: worship stone a step lighter than building stone so sites stand out from the grass
  const stone = C("stone", "#a9a196").offsetHSL(0, -0.03, 0.12);
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

/** how far a dormant site sits below the ground, in model units */
const DORMANT_SINK = 0.9;

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
  /** BACKLOG 89: prayer progress ring segments (null without a ring material) */
  private readonly ring: THREE.InstancedMesh | null = null;
  private readonly unlit = new THREE.Color("#6b6256");
  private readonly ringCap: number = 0;

  constructor(material: THREE.Material, kinds: { id: string }[], pal: Record<string, string>, tribeColorNames: string[], models: ReadonlyMap<string, ModelParts> | null = null, cap = 64, ringMat: THREE.Material | null = null) {
    if (ringMat) {
      this.ringCap = cap * RING_SEGS;
      this.ring = new THREE.InstancedMesh(ringSegment(), ringMat, this.ringCap);
      this.ring.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * RING_SEGS * 3), 3);
      this.ring.frustumCulled = false;
      this.ring.count = 0;
      this.ring.renderOrder = 2;
      this.group.add(this.ring);
    }
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
    const ringR = (w.cfg.pack.buildings.worship.radius ?? 3) + 0.4;
    let rings = 0;
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
      // prayer chains: a sleeping site sits half sunk and unlit until another prayer wakes it
      const sunk = site.dormant ? DORMANT_SINK * kind.scale : 0.05;
      this.p.set(focusX + ox, y - sunk, focusZ + oz);
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
      const col = site.usesLeft <= 0 || site.dormant ? this.spent : who >= 0 ? this.tribeColors[who % this.tribeColors.length] : this.glow;
      // BACKLOG 89: the leading tribe's prayer progress as a filling ring (only while someone prays)
      if (this.ring && best > 0 && site.usesLeft > 0 && rings + RING_SEGS <= this.ringCap) {
        const lit = Math.max(1, Math.round((best / site.prayTicks) * RING_SEGS));
        const tc = this.tribeColors[lead % this.tribeColors.length];
        for (let k = 0; k < RING_SEGS; k++) {
          this.p.set(focusX + ox, y + 0.12, focusZ + oz);
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -Math.PI / 2 - (k * Math.PI * 2) / RING_SEGS);
          this.m.compose(this.p, this.q, this.s.set(ringR, 1, ringR));
          this.ring.setMatrixAt(rings, this.m);
          this.ring.setColorAt(rings, k < lit ? tc : this.unlit);
          rings++;
        }
        this.s.set(1, 1, 1);
        // the site model below uses the unscaled matrix
        this.p.set(focusX + ox, y - sunk, focusZ + oz);
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2);
        this.m.compose(this.p, this.q, this.s.setScalar(kind.scale));
      }
      const c = counts[site.kind]++;
      kind.body.setMatrixAt(c, this.m);
      kind.tint.setMatrixAt(c, this.m);
      kind.tint.setColorAt(c, col);
    }
    if (this.ring) {
      this.ring.count = rings;
      this.ring.instanceMatrix.needsUpdate = true;
      if (this.ring.instanceColor) this.ring.instanceColor.needsUpdate = true;
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

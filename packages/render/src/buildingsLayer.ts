// Placeholder buildings until real GLB assets land (M10): per building kind an instanced tinted
// part (banner or cloth, tribe color) and an untinted structure, scaled to the footprint and placed
// at the wrapped copy nearest the focus. Static between sim ticks, so no interpolation.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CAT, type World } from "@hearthfall/sim";

export function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.getAttribute("position").count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute("color", new THREE.BufferAttribute(col, 3));
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  return ng;
}

const banner = (x: number, h: number, wood: THREE.Color) => {
  const pole = colored(new THREE.CylinderGeometry(0.03, 0.03, h, 4).translate(x, h / 2, 0), wood);
  const flag = colored(new THREE.BoxGeometry(0.34, 0.24, 0.1).translate(x + 0.18, h - 0.14, 0), new THREE.Color("#ffffff"));
  return { pole, flag };
};

/** Structure (untinted) and banner (tinted) geometry per building id, in footprint units. */
function buildingGeometry(id: string, pal: Record<string, string>): { body: THREE.BufferGeometry; tint: THREE.BufferGeometry } {
  const C = (k: string, d: string) => new THREE.Color(pal[k] ?? d);
  const wood = C("wood", "#8b5a2b");
  const thatch = C("thatch", "#c9a65a");
  const stone = C("stone", "#a9a196");
  switch (id) {
    case "hearth": {
      const ring = colored(new THREE.CylinderGeometry(0.75, 0.85, 0.25, 9).translate(0, 0.12, 0), stone);
      const fire = colored(new THREE.ConeGeometry(0.35, 0.8, 6).translate(0, 0.62, 0), C("fire", "#ff7a1a"));
      const core = colored(new THREE.ConeGeometry(0.18, 0.5, 5).translate(0, 0.55, 0), C("lava", "#ff3b10"));
      const b = banner(0.85, 1.5, wood);
      return { body: mergeGeometries([ring, fire, core, b.pole])!, tint: b.flag };
    }
    case "watchtower": {
      const legs = colored(new THREE.CylinderGeometry(0.28, 0.4, 1.8, 6).translate(0, 0.9, 0), wood);
      const deck = colored(new THREE.CylinderGeometry(0.5, 0.45, 0.25, 6).translate(0, 1.9, 0), C("woodDark", "#5e3a1a"));
      const roof = colored(new THREE.ConeGeometry(0.55, 0.5, 6).translate(0, 2.3, 0), thatch);
      const b = banner(0.3, 2.9, wood);
      return { body: mergeGeometries([legs, deck, roof, b.pole])!, tint: b.flag };
    }
    case "warden_lodge":
    case "fire_lodge":
    case "chant_house":
    case "shade_den": {
      const hall = colored(new THREE.BoxGeometry(1.8, 0.8, 1.4).translate(0, 0.4, 0), wood);
      const roof = colored(new THREE.ConeGeometry(1.35, 0.9, 4).rotateY(Math.PI / 4).scale(1, 1, 0.8).translate(0, 1.25, 0), thatch);
      const b = banner(1.0, 1.9, wood);
      return { body: mergeGeometries([hall, roof, b.pole])!, tint: b.flag };
    }
    default: {
      // dwelling and anything new: round thatched hut with a cloth door band
      const wall = colored(new THREE.CylinderGeometry(0.6, 0.65, 0.55, 8).translate(0, 0.28, 0), C("cloth", "#d9cbb0"));
      const roof = colored(new THREE.ConeGeometry(0.85, 0.75, 8).translate(0, 0.9, 0), thatch);
      const door = colored(new THREE.BoxGeometry(0.28, 0.36, 0.06).translate(0, 0.18, 0.63), new THREE.Color("#ffffff"));
      return { body: mergeGeometries([wall, roof])!, tint: door };
    }
  }
}

export class BuildingLayer {
  readonly group = new THREE.Group();
  private kinds: { body: THREE.InstancedMesh; tint: THREE.InstancedMesh; scale: number }[] = [];
  private tribeColors: THREE.Color[];
  private readonly neutral: THREE.Color;
  private lastKey = "";
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(material: THREE.Material, buildings: { id: string; footprint: [number, number] }[], pal: Record<string, string>, tribeColorNames: string[], cap = 2048) {
    this.tribeColors = tribeColorNames.map((c) => new THREE.Color(pal[c] ?? "#ffffff"));
    this.neutral = new THREE.Color(pal.cloth ?? "#d9cbb0");
    for (const b of buildings) {
      const g = buildingGeometry(b.id, pal);
      const body = new THREE.InstancedMesh(g.body, material, cap);
      const tint = new THREE.InstancedMesh(g.tint, material, cap);
      tint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      for (const im of [body, tint]) {
        im.frustumCulled = false;
        im.count = 0;
        this.group.add(im);
      }
      this.kinds.push({ body, tint, scale: Math.max(b.footprint[0], b.footprint[1]) / 2 });
    }
  }

  update(w: World, focusX: number, focusZ: number, heightScale: number): void {
    const E = w.ents;
    const n = w.terrain.size;
    // buildings are few; rebuild every frame so plans, construction progress and levels stay current
    void this.lastKey;
    const counts = new Int32Array(this.kinds.length);
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.building) continue;
      const k = E.type[i];
      const kind = this.kinds[k];
      if (!kind) continue;
      let ox = E.x[i] - focusX;
      let oz = E.y[i] - focusZ;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      const y = Math.max(w.terrain.heightAt(E.x[i], E.y[i]), w.terrain.sea) * heightScale;
      this.p.set(focusX + ox, y - 0.05, focusZ + oz);
      // plans rise with construction; dwellings grow with their level
      const st = E.state[i];
      const def = w.cfg.pack.buildings.buildings[k];
      const total = (def.wood ?? def.levels?.[0]?.wood ?? 1) * w.cfg.pack.buildings.construction.buildSecondsPerWood;
      const rise = st === 3 ? 1 : st === 2 ? 0.25 + 0.75 * Math.min(1, E.progress[i] / total) : 0.12;
      const lv = def.levels ? 1 + 0.16 * Math.max(0, E.level[i] - 1) : 1;
      this.s.set(kind.scale * 1.15 * lv, kind.scale * 1.15 * lv * rise, kind.scale * 1.15 * lv);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ((i * 2654435761) >>> 0) / 4294967296 * Math.PI * 2);
      this.m.compose(this.p, this.q, this.s);
      const c = counts[k]++;
      kind.body.setMatrixAt(c, this.m);
      kind.tint.setMatrixAt(c, this.m);
      kind.tint.setColorAt(c, E.tribe[i] >= 0 ? this.tribeColors[E.tribe[i] % this.tribeColors.length] : this.neutral);
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

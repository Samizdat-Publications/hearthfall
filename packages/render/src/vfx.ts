// Placeholder VFX (M5) driven by sim events and effect entities: additive flashes, ground rings,
// lightning beams, splashes and swarms. Timing uses the visual clock (sim tick based in fixedStep
// mode), so captures stay deterministic. Reads sim state only.
import * as THREE from "three";
import { CAT, type SimEvent, type World } from "@hearthfall/sim";
import { bendMaterial, type BendUniforms } from "./curve.ts";

interface Fx {
  kind: "flash" | "ring" | "beam" | "spark";
  x: number;
  z: number;
  y: number;
  t0: number;
  dur: number;
  size: number;
  color: THREE.Color;
}

const SPELL_COLORS: Record<string, string> = {
  bolt: "#ff9a3c",
  call: "#7fd4ff",
  hornets: "#ffd23a",
  raise_land: "#c9a65a",
  lightning: "#bfe8ff",
  flatten: "#d9cbb0",
  quake: "#8a6a4a",
  volcano: "#ff3b10",
};

/** Per-spell impact recipe: flashes, rings, beams, sparks (data-like table, render only). */
const IMPACTS: Record<string, { flash?: number; ring?: number; beam?: boolean; sparks?: number; dur?: number }> = {
  bolt: { flash: 1.8, ring: 2.2, sparks: 10 },
  call: { ring: 2.8, sparks: 8, dur: 1.4 },
  hornets: { ring: 3, sparks: 6 },
  raise_land: { ring: 2, sparks: 12, dur: 1.5 },
  lightning: { flash: 1.2, beam: true, ring: 1.2, sparks: 6, dur: 0.8 },
  flatten: { ring: 5, sparks: 14, dur: 1.6 },
  quake: { ring: 7, sparks: 20, dur: 2 },
  volcano: { flash: 4, ring: 7, sparks: 24, dur: 2.2 },
};

export class VfxLayer {
  readonly group = new THREE.Group();
  private fx: Fx[] = [];
  private flashes: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private swarm: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private seq = 0;

  constructor(bend: BendUniforms, cap = 512) {
    const add = (geo: THREE.BufferGeometry, opacity = 1) => {
      const mat = bendMaterial(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }), bend);
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      im.frustumCulled = false;
      im.count = 0;
      im.renderOrder = 5;
      this.group.add(im);
      return im;
    };
    this.flashes = add(new THREE.IcosahedronGeometry(1, 1));
    this.rings = add(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2));
    this.beams = add(new THREE.CylinderGeometry(0.12, 0.3, 1, 6).translate(0, 0.5, 0));
    this.swarm = add(new THREE.OctahedronGeometry(0.08));
    this.pools = add(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), 0.8);
  }

  /** Turn sim events into transient effects at visual time `now`. */
  consume(events: readonly SimEvent[], w: World, timeOf: (e: SimEvent) => number, heightScale: number): void {
    const t = w.terrain;
    const ground = (x: number, y: number) => Math.max(t.heightAt(x, y), t.sea) * heightScale;
    for (const e of events) {
      const now = timeOf(e);
      const x = Number(e.x ?? NaN);
      const y = Number(e.y ?? NaN);
      if (e.type === "spellCast" && Number.isFinite(x)) {
        const spell = String(e.spell);
        const col = new THREE.Color(SPELL_COLORS[spell] ?? "#b07cff");
        const r = IMPACTS[spell] ?? { flash: 1, ring: 1.5 };
        const dur = r.dur ?? 1;
        const gy = ground(x, y);
        if (r.flash) this.fx.push({ kind: "flash", x, z: y, y: gy + 0.4, t0: now, dur: dur * 0.6, size: r.flash, color: col });
        if (r.ring) this.fx.push({ kind: "ring", x, z: y, y: gy + 0.15, t0: now, dur, size: r.ring, color: col });
        if (r.beam) this.fx.push({ kind: "beam", x, z: y, y: gy, t0: now, dur: dur * 0.5, size: 18, color: col });
        for (let k = 0; k < (r.sparks ?? 0); k++) {
          const h = this.hash(k + this.seq);
          const a = h * Math.PI * 2;
          const d = (r.ring ?? 1) * (0.3 + 0.7 * this.hash(k * 7 + this.seq));
          this.fx.push({ kind: "spark", x: x + Math.cos(a) * d, z: y + Math.sin(a) * d, y: ground(x, y) + 0.3, t0: now + h * 0.2, dur: dur * 0.8, size: 0.18, color: col });
        }
        this.seq += 31;
      } else if (e.type === "castBegun" && Number.isFinite(x)) {
        const col = new THREE.Color(SPELL_COLORS[String(e.spell)] ?? "#b07cff");
        this.fx.push({ kind: "ring", x, z: y, y: ground(x, y) + 0.12, t0: now, dur: 1, size: 1.2, color: col });
      } else if ((e.type === "drowned" || e.type === "flooded") && Number.isFinite(x)) {
        this.fx.push({ kind: "ring", x, z: y, y: t.sea * heightScale + 0.05, t0: now, dur: 1.2, size: 1.2, color: new THREE.Color("#e6f4f8") });
        this.fx.push({ kind: "flash", x, z: y, y: t.sea * heightScale + 0.2, t0: now, dur: 0.4, size: 0.5, color: new THREE.Color("#e6f4f8") });
      } else if ((e.type === "killed" || e.type === "destroyed") && Number.isFinite(x)) {
        this.fx.push({ kind: "flash", x, z: y, y: ground(x, y) + 0.4, t0: now, dur: 0.5, size: e.type === "destroyed" ? 1.6 : 0.6, color: new THREE.Color("#8a8378") });
      } else if (e.type === "converted" || e.type === "born" || e.type === "buildingDone" || e.type === "shaperRespawned") {
        const id = Number(e.id ?? e.home ?? NaN);
        const i = Number.isFinite(id) ? w.ents.index(id) : -1;
        if (i >= 0) {
          const col = new THREE.Color(e.type === "converted" ? "#7fd4ff" : e.type === "born" ? "#8dbf5a" : "#ffd23a");
          this.fx.push({ kind: "ring", x: w.ents.x[i], z: w.ents.y[i], y: ground(w.ents.x[i], w.ents.y[i]) + 0.1, t0: now, dur: 0.9, size: 0.9, color: col });
        }
      }
    }
    if (this.fx.length > 400) this.fx.splice(0, this.fx.length - 400);
  }

  private hash(k: number): number {
    let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Lay out all transient and persistent effects for this frame (wrapped near the focus). */
  update(w: World, now: number, focusX: number, focusZ: number, heightScale: number): void {
    const n = w.terrain.size;
    const wrapX = (x: number) => focusX + (x - focusX - Math.round((x - focusX) / n) * n);
    const wrapZ = (z: number) => focusZ + (z - focusZ - Math.round((z - focusZ) / n) * n);
    const counts = { flash: 0, ring: 0, beam: 0, spark: 0 };
    const target = { flash: this.flashes, ring: this.rings, beam: this.beams, spark: this.swarm };
    this.fx = this.fx.filter((f) => now - f.t0 < f.dur);
    for (const f of this.fx) {
      const a = (now - f.t0) / f.dur;
      if (a < 0) continue;
      const im = target[f.kind];
      const k = counts[f.kind]++;
      if (k >= im.instanceMatrix.count) continue;
      const fade = 1 - a;
      let sx = f.size;
      let sy = f.size;
      let y = f.y;
      if (f.kind === "flash") sx = sy = f.size * (0.4 + 0.8 * a);
      else if (f.kind === "ring") sx = sy = f.size * (0.2 + 0.9 * a);
      else if (f.kind === "beam") {
        sx = 1 + 0.5 * fade;
        sy = f.size;
      } else {
        sx = sy = 1 + fade;
        y += a * 1.6;
      }
      this.p.set(wrapX(f.x), y, wrapZ(f.z));
      this.s.set(sx, f.kind === "beam" ? sy : sx, sx);
      this.m.compose(this.p, this.q.identity(), this.s);
      im.setMatrixAt(k, this.m);
      im.setColorAt(k, this.c.copy(f.color).multiplyScalar(fade * (f.kind === "beam" ? 1.6 : 1)));
    }
    // persistent effect entities: hornet swarms (buzzing dots) and lava pools (pulsing discs)
    const E = w.ents;
    let pools = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.cat[i] !== CAT.effect) continue;
      const spell = w.cfg.pack.spells.spells[E.type[i]]?.id ?? "";
      const r = E.progress[i];
      const gy = Math.max(w.terrain.heightAt(E.x[i], E.y[i]), w.terrain.sea) * heightScale;
      if (spell === "hornets") {
        for (let k = 0; k < 40 && counts.spark < this.swarm.instanceMatrix.count; k++) {
          const ph = now * (2 + this.hash(k + i * 97) * 3) + this.hash(k * 13 + i) * 6.28;
          const rr = r * (0.2 + 0.8 * this.hash(k * 31 + i));
          this.p.set(wrapX(E.x[i] + Math.cos(ph) * rr), gy + 0.5 + 0.4 * Math.sin(ph * 1.7), wrapZ(E.y[i] + Math.sin(ph * 1.3) * rr));
          this.s.setScalar(1.2);
          this.m.compose(this.p, this.q.identity(), this.s);
          this.swarm.setMatrixAt(counts.spark, this.m);
          this.swarm.setColorAt(counts.spark++, this.c.set("#ffd23a"));
        }
      } else if (pools < this.pools.instanceMatrix.count) {
        const pulse = 0.75 + 0.25 * Math.sin(now * 5 + i);
        this.p.set(wrapX(E.x[i]), gy + 0.06, wrapZ(E.y[i]));
        this.s.set(r, 1, r);
        this.m.compose(this.p, this.q.identity(), this.s);
        this.pools.setMatrixAt(pools, this.m);
        this.pools.setColorAt(pools++, this.c.set(SPELL_COLORS[spell] ?? "#ff3b10").multiplyScalar(pulse));
      }
    }
    for (const [kind, im] of Object.entries(target) as [keyof typeof counts, THREE.InstancedMesh][]) {
      im.count = Math.min(counts[kind], im.instanceMatrix.count);
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this.pools.count = pools;
    this.pools.instanceMatrix.needsUpdate = true;
    if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
  }
}

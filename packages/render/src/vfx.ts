// Placeholder VFX (M5) driven by sim events and effect entities: additive flashes, ground rings,
// lightning beams, splashes and swarms. Timing uses the visual clock (sim tick based in fixedStep
// mode), so captures stay deterministic. Reads sim state only.
import * as THREE from "three";
import { CAT, type SimEvent, type World } from "@hearthfall/sim";
import { bendMaterial, type BendUniforms } from "./curve.ts";

interface Fx {
  kind: "flash" | "ring" | "beam" | "spark" | "halo";
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
  lightning: "#8fc8ff",
  flatten: "#d9cbb0",
  quake: "#8a6a4a",
  volcano: "#ff3b10",
  veil: "#9fb4c8",
  ward: "#ffd76a",
  beguile: "#ff7ad9",
  whirlwind: "#d8d2c0",
  mire: "#6b7a2a",
  erode: "#4f7f95",
  firerain: "#ff5a1f",
  wraith: "#b8f0ff",
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
  volcano: { flash: 2.6, ring: 7, sparks: 24, dur: 2.2 },
  veil: { ring: 2, sparks: 6, dur: 1.2 },
  ward: { flash: 1, ring: 2.5, sparks: 8 },
  beguile: { ring: 2.5, sparks: 10, dur: 1.3 },
  whirlwind: { ring: 1.6, sparks: 12 },
  mire: { ring: 2.5, sparks: 8, dur: 1.4 },
  erode: { ring: 6, sparks: 16, dur: 1.8 },
  firerain: { flash: 1.5, ring: 6, dur: 1.2 },
  wraith: { flash: 1.4, ring: 1.5, sparks: 10, dur: 1.2 },
};

/** Persistent unit status halos (BACKLOG 1): Ward gold, Beguile pink, Veil pale (own units only, the rest are hidden). */
const STATUS_COLORS = { ward: "#ffd76a", beguile: "#ff7ad9", veil: "#9fb4c8" };
/** BACKLOG 2: flame colors for burning buildings and a Shade's sabotage sparks */
const FIRE_COLORS = ["#ffb347", "#ff6a1f", "#ffe08a"];

/** Effect entity kinds as the sim numbers them (packages/sim/src/effects.ts FX). */
const FX_STORM = 3;
const FX_MOVER = 4;
const FX_WRAITH = 6;

/** Volcano smoke column (BACKLOG 0a): puffs per erupting cone, column height and rise rate (render only). */
const SMOKE_PUFFS = 30;
const SMOKE_HEIGHT = 13;
const SMOKE_RISE = 0.09;

export class VfxLayer {
  readonly group = new THREE.Group();
  private fx: Fx[] = [];
  private flashes: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private swarm: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  /** Normal-blended rings (M11): colors that must keep their hue on bright ground (chant violet, melee dust). */
  private halos: THREE.InstancedMesh;
  /** Normal-blended ash puffs (BACKLOG 0a): the volcano's smoke column must read dark against the sky. */
  private smoke: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private seq = 0;
  /** The local player's tribe: its veiled units keep a pale halo, other tribes' are hidden. */
  viewTribe = 0;

  constructor(bend: BendUniforms, cap = 512) {
    const add = (geo: THREE.BufferGeometry, opacity = 1, blending: THREE.Blending = THREE.AdditiveBlending) => {
      const mat = bendMaterial(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity, blending, depthWrite: false }), bend);
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
    this.beams = add(new THREE.CylinderGeometry(0.05, 0.16, 1, 6).translate(0, 0.5, 0));
    this.swarm = add(new THREE.OctahedronGeometry(0.08));
    this.pools = add(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), 0.45);
    this.halos = add(new THREE.RingGeometry(0.78, 1, 32).rotateX(-Math.PI / 2), 0.85, THREE.NormalBlending);
    this.smoke = add(new THREE.IcosahedronGeometry(1, 1), 0.62, THREE.NormalBlending);
  }

  /** Effect instances drawn in the last update (shot checks: spell shots must show their VFX). */
  drawn(): number {
    return this.flashes.count + this.rings.count + this.beams.count + this.swarm.count + this.pools.count + this.halos.count + this.smoke.count;
  }

  /** Drawn instances per kind in the last update (render tests). */
  drawnBy(): { halo: number; ring: number; spark: number; flash: number; smoke: number } {
    return { halo: this.halos.count, ring: this.rings.count, spark: this.swarm.count, flash: this.flashes.count, smoke: this.smoke.count };
  }

  /** World-space top of the drawn smoke column (render tests): the highest puff center. */
  smokeTop(): number {
    let top = -Infinity;
    for (let k = 0; k < this.smoke.count; k++) {
      this.smoke.getMatrixAt(k, this.m);
      top = Math.max(top, this.m.elements[13]);
    }
    return top;
  }

  /** Color of a drawn halo instance (render tests). */
  haloColor(k: number): THREE.Color {
    const c = new THREE.Color();
    this.halos.getColorAt(k, c);
    return c;
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
      } else if (e.type === "fireball" && Number.isFinite(x)) {
        // M6: a short arc of sparks from the Firecaller to the target, then a splash flash and ring
        const fx = Number(e.fx ?? x);
        const fy = Number(e.fy ?? y);
        const col = new THREE.Color("#ff7a2e");
        const glow = new THREE.Color("#ff7a2e").multiplyScalar(0.55);
        const n = w.terrain.size;
        let dx = x - fx;
        let dy = y - fy;
        if (dx > n / 2) dx -= n;
        else if (dx < -n / 2) dx += n;
        if (dy > n / 2) dy -= n;
        else if (dy < -n / 2) dy += n;
        const steps = 6;
        const flight = 0.3;
        for (let k = 1; k <= steps; k++) {
          const q = k / steps;
          const px = fx + dx * q;
          const pz = fy + dy * q;
          const lift = 1.6 * 4 * q * (1 - q);
          this.fx.push({ kind: "spark", x: px, z: pz, y: ground(px, pz) + 0.5 + lift, t0: now + q * flight, dur: 0.16, size: 0.45, color: col });
          this.fx.push({ kind: "flash", x: px, z: pz, y: ground(px, pz) + 0.5 + lift, t0: now + q * flight, dur: 0.22, size: 0.22, color: glow });
        }
        this.fx.push({ kind: "flash", x, z: y, y: ground(x, y) + 0.4, t0: now + flight, dur: 0.35, size: 1, color: col });
        this.fx.push({ kind: "ring", x, z: y, y: ground(x, y) + 0.1, t0: now + flight, dur: 0.6, size: 1.2, color: col });
      } else if (e.type === "chantBegun" && Number.isFinite(x)) {
        // M6: pulsing rings for the length of the channel (balance-free: 4 pulses over about 4 s)
        const col = new THREE.Color("#c39bff").multiplyScalar(0.5);
        const violet = new THREE.Color("#8a3cff");
        for (let k = 0; k < 4; k++) {
          this.fx.push({ kind: "halo", x, z: y, y: ground(x, y) + 0.11, t0: now + k, dur: 1, size: 2.6, color: violet });
          this.fx.push({ kind: "ring", x, z: y, y: ground(x, y) + 0.1, t0: now + k, dur: 1, size: 3, color: col });
        }
      } else if (e.type === "chantInterrupted" || e.type === "melee") {
        const id = Number(e.id ?? NaN);
        const i = e.type === "melee" ? -1 : Number.isFinite(id) ? w.ents.index(id) : -1;
        const px = i >= 0 ? w.ents.x[i] : x;
        const pz = i >= 0 ? w.ents.y[i] : y;
        if (Number.isFinite(px)) this.fx.push({ kind: "spark", x: px, z: pz, y: ground(px, pz) + 0.5, t0: now, dur: 0.3, size: e.type === "melee" ? 0.4 : 0.5, color: new THREE.Color(e.type === "melee" ? "#f2e6c8" : "#8a8378") });
        if (e.type === "melee" && Number.isFinite(px)) {
          this.fx.push({ kind: "halo", x: px, z: pz, y: ground(px, pz) + 0.08, t0: now, dur: 0.45, size: 0.7, color: new THREE.Color("#c8b48a") });
          this.fx.push({ kind: "flash", x: px, z: pz, y: ground(px, pz) + 0.55, t0: now, dur: 0.18, size: 0.3, color: new THREE.Color("#fff2d0") });
        }
      } else if (e.type === "meteor" && Number.isFinite(x)) {
        // BACKLOG 1: a meteor falls in a short streak, then a flash and a scorch ring the size of its impact
        const col = new THREE.Color(SPELL_COLORS.firerain);
        const gy = ground(x, y);
        const fall = 0.35;
        for (let k = 0; k < 5; k++) {
          const q = k / 5;
          this.fx.push({ kind: "spark", x: x - 2.4 * (1 - q), z: y - 1.2 * (1 - q), y: gy + 0.4 + 7 * (1 - q), t0: now + q * fall, dur: 0.14, size: 0.5, color: col });
        }
        this.fx.push({ kind: "flash", x, z: y, y: gy + 0.4, t0: now + fall, dur: 0.4, size: 1.1, color: col });
        this.fx.push({ kind: "ring", x, z: y, y: gy + 0.1, t0: now + fall, dur: 0.7, size: Number(e.r ?? 1.2), color: col });
      } else if ((e.type === "flung" || e.type === "mired" || e.type === "wraithKill" || e.type === "wardPopped") && Number.isFinite(x)) {
        const gy = ground(x, y);
        if (e.type === "flung") this.fx.push({ kind: "spark", x, z: y, y: gy + 0.6, t0: now, dur: 0.4, size: 0.45, color: new THREE.Color(SPELL_COLORS.whirlwind) });
        else if (e.type === "mired") {
          this.fx.push({ kind: "halo", x, z: y, y: gy + 0.08, t0: now, dur: 0.9, size: 0.9, color: new THREE.Color("#3f4a18") });
          this.fx.push({ kind: "spark", x, z: y, y: gy + 0.2, t0: now, dur: 0.6, size: 0.35, color: new THREE.Color(SPELL_COLORS.mire) });
        } else if (e.type === "wraithKill") {
          this.fx.push({ kind: "flash", x, z: y, y: gy + 0.6, t0: now, dur: 0.45, size: 0.7, color: new THREE.Color(SPELL_COLORS.wraith) });
          this.fx.push({ kind: "ring", x, z: y, y: gy + 0.1, t0: now, dur: 0.8, size: 1, color: new THREE.Color(SPELL_COLORS.wraith) });
        } else {
          this.fx.push({ kind: "flash", x, z: y, y: gy + 0.6, t0: now, dur: 0.35, size: 0.8, color: new THREE.Color(SPELL_COLORS.ward) });
          this.fx.push({ kind: "ring", x, z: y, y: gy + 0.1, t0: now, dur: 0.6, size: 1.2, color: new THREE.Color(SPELL_COLORS.ward) });
        }
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
    const counts = { flash: 0, ring: 0, beam: 0, spark: 0, halo: 0, smoke: 0 };
    const target = { flash: this.flashes, ring: this.rings, beam: this.beams, spark: this.swarm, halo: this.halos, smoke: this.smoke };
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
      else if (f.kind === "halo") sx = sy = f.size * (0.35 + 0.75 * a);
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
      const level = f.kind === "halo" ? 0.55 + 0.45 * fade : fade * (f.kind === "beam" ? 0.9 : 1);
      im.setColorAt(k, this.c.copy(f.color).multiplyScalar(level));
    }
    // persistent effect entities: hornet swarms (buzzing dots), lava pools, bogs and sinking land
    // (pulsing discs), the whirlwind funnel, the wraith and the firerain zone; then unit status halos
    const E = w.ents;
    let pools = 0;
    const dot = (x: number, y: number, z: number, scale: number, color: THREE.Color | string, im: THREE.InstancedMesh, kind: "spark" | "flash" | "halo" | "ring" | "smoke") => {
      if (counts[kind] >= im.instanceMatrix.count) return;
      this.p.set(wrapX(x), y, wrapZ(z));
      this.s.setScalar(scale);
      this.m.compose(this.p, this.q.identity(), this.s);
      im.setMatrixAt(counts[kind], this.m);
      im.setColorAt(counts[kind]++, typeof color === "string" ? this.c.set(color) : color);
    };
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      if (E.cat[i] === CAT.building && E.burn[i] > 0) {
        // BACKLOG 2: a building set alight by a Shade: flames licking up from the roof and dark smoke
        const gy = w.terrain.heightAt(E.x[i], E.y[i]) * heightScale;
        const fp = w.cfg.pack.buildings.buildings[E.type[i]].footprint;
        const half = Math.max(fp[0], fp[1]) * 0.4;
        for (let k = 0; k < 14; k++) {
          const p = (now * 1.6 + this.hash(k * 7 + i)) % 1;
          const a = this.hash(k * 13 + i) * 6.28;
          const rr = half * this.hash(k * 5 + i);
          dot(E.x[i] + Math.cos(a) * rr, gy + 0.6 + p * 2.2, E.y[i] + Math.sin(a) * rr, 2.6 * (1 - p) + 0.4, FIRE_COLORS[k % 3], this.swarm, "spark");
        }
        for (let k = 0; k < 6; k++) {
          const p = (now * 0.35 + this.hash(k * 19 + i)) % 1;
          const size = (0.3 + 1.1 * p) * Math.min(1, (1 - p) * 5);
          const shade = 0.05 + 0.12 * p;
          dot(E.x[i] + p * 1.5, gy + 1.8 + p * 4, E.y[i] + p * 0.7, size, this.c.setRGB(shade, shade * 0.95, shade * 0.9), this.smoke, "smoke");
        }
        continue;
      }
      if (E.cat[i] === CAT.unit && E.chant[i] > 0 && E.inside[i] < 0 && w.combat.isSaboteur(E.type[i])) {
        // BACKLOG 2: a Shade at work: sparks at its target while the channel runs
        const t = E.index(E.atk[i]);
        if (t >= 0) {
          const gy = w.terrain.heightAt(E.x[t], E.y[t]) * heightScale;
          for (let k = 0; k < 4; k++) {
            const p = (now * 2.4 + this.hash(k * 23 + i)) % 1;
            const a = this.hash(k * 3 + i) * 6.28 + now;
            dot(E.x[t] + Math.cos(a) * 0.4, gy + 0.3 + p * 0.8, E.y[t] + Math.sin(a) * 0.4, 1.4 * (1 - p) + 0.3, FIRE_COLORS[k % 3], this.swarm, "spark");
          }
        }
      }
      if (E.cat[i] === CAT.unit && E.inside[i] < 0 && (E.ward[i] > 0 || E.beguile[i] > 0 || E.veil[i] > 0)) {
        // another tribe's veiled unit is not drawn, so it gets no halo either
        if (E.veil[i] > 0 && E.tribe[i] !== this.viewTribe) continue;
        const col = E.ward[i] > 0 ? STATUS_COLORS.ward : E.beguile[i] > 0 ? STATUS_COLORS.beguile : STATUS_COLORS.veil;
        const pulse = 0.7 + 0.3 * Math.sin(now * 4 + i);
        dot(E.x[i], Math.max(w.terrain.heightAt(E.x[i], E.y[i]), w.terrain.sea) * heightScale + 0.07, E.y[i], 0.55, this.c.set(col).multiplyScalar(pulse), this.halos, "halo");
        continue;
      }
      if (E.cat[i] !== CAT.effect) continue;
      const spell = w.cfg.pack.spells.spells[E.type[i]]?.id ?? "";
      const r = E.progress[i];
      const gy = Math.max(w.terrain.heightAt(E.x[i], E.y[i]), w.terrain.sea) * heightScale;
      const kind = E.state[i];
      if (kind === FX_MOVER) {
        // whirlwind: a funnel of dust that widens with height and spins
        for (let k = 0; k < 48; k++) {
          const hgt = this.hash(k * 5 + 1) * 3.2;
          const ph = now * (5 + 2 * this.hash(k)) + this.hash(k * 11) * 6.28;
          const rr = r * (0.25 + 0.3 * hgt);
          dot(E.x[i] + Math.cos(ph) * rr, gy + 0.2 + hgt, E.y[i] + Math.sin(ph) * rr, 1.4, SPELL_COLORS.whirlwind, this.swarm, "spark");
        }
        continue;
      }
      if (kind === FX_WRAITH) {
        // wraith: a pale core with a circling ring of motes
        const bob = 1.4 + 0.25 * Math.sin(now * 3 + i);
        dot(E.x[i], gy + bob, E.y[i], 0.35, SPELL_COLORS.wraith, this.flashes, "flash");
        for (let k = 0; k < 10; k++) {
          const ph = now * 4 + k * 0.628;
          dot(E.x[i] + Math.cos(ph) * 0.5, gy + bob - 0.2 + 0.1 * Math.sin(ph * 2), E.y[i] + Math.sin(ph) * 0.5, 1, SPELL_COLORS.wraith, this.swarm, "spark");
        }
        continue;
      }
      if (kind === FX_STORM) {
        // firerain: a thin smouldering edge where the meteors can fall (dim, so the impacts stay the loud part)
        dot(E.x[i], gy + 0.09, E.y[i], r, this.c.set(SPELL_COLORS.firerain).multiplyScalar(0.3 + 0.1 * Math.sin(now * 6)), this.rings, "ring");
        continue;
      }
      if (spell === "volcano" && r >= 3) {
        // the erupting cone (not its lava rocks): a leaning column of ash puffs that grow and pale as
        // they rise, shrinking away at the top so the loop never pops, and embers spitting from the vent
        for (let k = 0; k < SMOKE_PUFFS; k++) {
          const p = (now * SMOKE_RISE + this.hash(k * 17 + i)) % 1;
          const lean = p * p * 4;
          const sway = 0.5 * p * Math.sin(now * 0.7 + k);
          const size = (0.5 + 2.4 * p) * Math.min(1, (1 - p) * 5);
          const shade = 0.035 + 0.13 * p;
          dot(E.x[i] + lean + sway, gy + 0.6 + p * SMOKE_HEIGHT, E.y[i] + lean * 0.5 - sway, size, this.c.setRGB(shade, shade * 0.95, shade * 0.9), this.smoke, "smoke");
        }
        for (let k = 0; k < 8; k++) {
          const p = (now * 0.8 + this.hash(k * 29 + i)) % 1;
          const a = this.hash(k * 3 + i) * 6.28;
          dot(E.x[i] + Math.cos(a) * p * 0.8, gy + 0.3 + p * 2.2, E.y[i] + Math.sin(a) * p * 0.8, 1.6 * (1 - p) + 0.2, SPELL_COLORS.volcano, this.swarm, "spark");
        }
      }
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
        this.s.set(r * 0.85, 1, r * 0.85);
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

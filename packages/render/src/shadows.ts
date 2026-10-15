// Look v4: soft contact shadows. One instanced quad per unit, building, tree, rock or decor prop, a radial
// dark blob laid on the terrain slope under it and nudged away from the sun, so models sit on the ground
// instead of floating over it. Each entity layer owns one ContactShadows and refills it whenever it
// refills its own instances (style.json render.contactShadows). Render only; never reads or writes the sim.
import * as THREE from "three";
import type { Terrain } from "@hearthfall/sim";
import { BEND_PROJECT_VERTEX, BEND_VERTEX_PARS, type BendUniforms } from "./curve.ts";

export interface ContactShadowLook {
  enabled: boolean;
  /** darkness at the blob center, 0 to 1 */
  strength: number;
  /** radius multipliers per layer (units: of the selection disc; buildings: of the footprint half size; trees, rocks and decor: of their drawn size) */
  units: number;
  buildings: number;
  trees: number;
  decor: number;
  /** blob center shift away from the sun, as a share of the caster's height */
  sunOffset: number;
  /** decor model ids that cast no shadow (thin reeds, flowers) */
  skip: string[];
}

export const CONTACT_SHADOWS_DEFAULT: ContactShadowLook = {
  enabled: false,
  strength: 0.4,
  units: 1.3,
  buildings: 0.75,
  trees: 0.55,
  decor: 0.5,
  sunOffset: 0.18,
  skip: [],
};

export function resolveContactShadows(o: Partial<ContactShadowLook> | undefined): ContactShadowLook {
  return { ...CONTACT_SHADOWS_DEFAULT, ...(o ?? {}), skip: o?.skip ?? CONTACT_SHADOWS_DEFAULT.skip };
}

/** The shared material: bends with the world, fades out toward the horizon like everything else. */
export function makeShadowMaterial(bend: BendUniforms, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { ...bend, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      ${BEND_VERTEX_PARS}
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 transformed = position;
        ${BEND_PROJECT_VERTEX}
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform float uFadeStart;
      uniform float uFadeEnd;
      varying float vBendDist;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.3, 1.0, r);
        a *= a * (3.0 - 2.0 * a);
        a *= 1.0 - smoothstep(uFadeStart * 0.85, uFadeEnd, vBendDist);
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, uStrength * a);
      }
    `,
  });
}

const UP = new THREE.Vector3(0, 1, 0);

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private readonly cap: number;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();
  /** unit vector on the ground pointing away from the sun */
  private readonly awayX: number;
  private readonly awayZ: number;
  readonly look: ContactShadowLook;

  constructor(material: THREE.Material, cap: number, look: ContactShadowLook, sun: { x: number; z: number } = { x: 0.55, z: 0.3 }) {
    this.cap = cap;
    this.look = look;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // after the opaque world, before the water and the other see-through effects
    this.mesh.renderOrder = -1;
    const len = Math.hypot(sun.x, sun.z) || 1;
    this.awayX = -sun.x / len;
    this.awayZ = -sun.z / len;
  }

  begin(): void {
    this.n = 0;
  }

  /**
   * One blob of `radius` world units under a caster `height` units tall standing at map cell (mapX, mapZ),
   * drawn at (drawX, groundY, drawZ), tilted to the terrain slope around it.
   */
  add(t: Terrain, mapX: number, mapZ: number, drawX: number, drawZ: number, groundY: number, radius: number, height: number, heightScale: number): void {
    if (!this.look.enabled || this.n >= this.cap || radius <= 0.01) return;
    const size = t.size;
    const h = (x: number, z: number) => Math.max(t.heightAt(((x % size) + size) % size, ((z % size) + size) % size), t.sea) * heightScale;
    const r = Math.max(0.5, radius);
    const sx = h(mapX - r, mapZ) - h(mapX + r, mapZ);
    const sz = h(mapX, mapZ - r) - h(mapX, mapZ + r);
    this.nrm.set(sx, 2 * r, sz).normalize();
    this.q.setFromUnitVectors(UP, this.nrm);
    const off = this.look.sunOffset * height;
    this.p.set(drawX + this.awayX * off, groundY + 0.04, drawZ + this.awayZ * off);
    const d = radius * 2;
    // stretch a little along the sun line so tall casters throw a longer shadow
    this.s.set(d * (1 + Math.abs(this.awayX) * off * 0.15), 1, d * (1 + Math.abs(this.awayZ) * off * 0.15));
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.n++, this.m);
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** blobs drawn in the last fill (tests and the debug summary) */
  count(): number {
    return this.mesh.count;
  }
}

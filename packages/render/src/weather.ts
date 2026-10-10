// BACKLOG 14: lighting presets (day, golden, evening) and visual weather (rain). Presets and the rain look
// live in style.json `lightingPresets` and `weather`; the renderer resolves a preset name and a weather
// name into one LightingLook and applies it at runtime (Settings Lighting and Weather, URL `lighting`,
// `weather`). Rain is visual only: streaks falling around the camera focus and a dimmer, greyer light.
import * as THREE from "three";

export interface LightingPreset {
  keyColor: string;
  keyIntensity: number;
  /** hemisphere sky color and intensity scale over the base ambient */
  hemiSky: string;
  ambient: number;
  /** sun direction (towards the sun), normalized at use */
  sunDir: [number, number, number];
  /** hearth point light intensity scale */
  hearthGlow: number;
  /** planet rim haze and fog color */
  rim: string;
}

export interface RainLook {
  drops: number;
  color: string;
  /** fall speed in world units per second */
  speed: number;
  /** light scale while raining (key and ambient) */
  dim: number;
  /** rim haze and fog color while raining */
  rim: string;
}

export interface LightingLook extends LightingPreset {
  rain: RainLook | null;
}

/**
 * The preset named `name` (unknown names fall back to `fallback`, then to the first preset), with the rain
 * dimming and rim folded in when `weather` is "rain" and a rain look exists. Pure, unit tested.
 */
export function resolveLighting(presets: Record<string, LightingPreset>, fallback: string, name: string, weather: string, rain: RainLook | undefined): LightingLook {
  const base = presets[name] ?? presets[fallback] ?? Object.values(presets)[0];
  if (weather !== "rain" || !rain) return { ...base, rain: null };
  return { ...base, keyIntensity: base.keyIntensity * rain.dim, ambient: base.ambient * rain.dim, rim: rain.rim, rain };
}

/**
 * Water tint for `look` relative to the default preset (the water shader is unlit, so this carries the
 * preset into it): white for the default, darker and tinted toward the key color for dimmer presets.
 */
export function waterTint(look: LightingPreset, def: LightingPreset, out: THREE.Color): THREE.Color {
  const scale = 0.6 * (look.keyIntensity / def.keyIntensity) + 0.4 * (look.ambient / def.ambient);
  const k = new THREE.Color(look.keyColor);
  const d = new THREE.Color(def.keyColor);
  out.setRGB(1 + 0.5 * (k.r / Math.max(0.05, d.r) - 1), 1 + 0.5 * (k.g / Math.max(0.05, d.g) - 1), 1 + 0.5 * (k.b / Math.max(0.05, d.b) - 1));
  // a steeper curve than the land: the unlit water otherwise keeps glowing at dusk and in rain
  return out.multiplyScalar(Math.min(1.25, Math.pow(scale, 1.6)));
}

/** Rain streaks in a box around the camera focus; the fall runs in the vertex shader from one time uniform. */
export class RainLayer {
  readonly mesh: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;
  private drops = 0;

  constructor(maxDrops = 4000, box = 36, height = 22) {
    const pos = new Float32Array(maxDrops * 2 * 3);
    const tip = new Float32Array(maxDrops * 2);
    // fixed pseudo-random layout (render only, no sim state)
    let s = 0x2f6e2b1;
    const rnd = () => {
      s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5;
      return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < maxDrops; i++) {
      const x = (rnd() - 0.5) * box;
      const y = rnd() * height;
      const z = (rnd() - 0.5) * box;
      for (let e = 0; e < 2; e++) {
        pos.set([x, y, z], (i * 2 + e) * 3);
        tip[i * 2 + e] = e;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aTip", new THREE.BufferAttribute(tip, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uSpeed: { value: 30 }, uHeight: { value: height }, uColor: { value: new THREE.Color("#bcd4ec") } },
      vertexShader: /* glsl */ `
        attribute float aTip;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uHeight;
        varying float vTip;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * uSpeed, uHeight);
          // a short streak slanted with the wind
          p += aTip * vec3(0.12, 0.7, 0.05);
          vTip = aTip;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vTip;
        void main() { gl_FragColor = vec4(uColor, 0.25 + 0.4 * vTip); }`,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  /** Show `look` (null hides the rain). */
  set(look: RainLook | null): void {
    this.mesh.visible = !!look;
    if (!look) return;
    this.drops = look.drops;
    this.mesh.geometry.setDrawRange(0, Math.min(look.drops, this.mesh.geometry.getAttribute("aTip").count / 2) * 2);
    this.mat.uniforms.uSpeed.value = look.speed;
    this.mat.uniforms.uColor.value.set(look.color);
  }

  get count(): number {
    return this.mesh.visible ? this.drops : 0;
  }

  /** Follow the camera focus (height y) and advance the fall. */
  update(x: number, y: number, z: number, time: number): void {
    if (!this.mesh.visible) return;
    this.mesh.position.set(x, y - 4, z);
    this.mat.uniforms.uTime.value = time;
  }
}

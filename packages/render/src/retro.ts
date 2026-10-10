// Retro render pass (ADR-005): the 3D scene renders into a low-resolution target, then a fullscreen
// quad upscales it with nearest-neighbor filtering, applies tone mapping and color space, and
// quantizes the result to a limited palette with 4x4 Bayer ordered dithering. Knobs live in
// style.json `render`; pixelScale 1 with no quantization turns it off.
// Tilt-shift (BACKLOG 14a, ADR-013): an optional miniature focus band. Outside a horizontal band at
// the camera focus the image blurs with distance from the band and from the focus depth (a
// DepthTexture on the low-res target), with a small saturation and contrast lift. Order "pre"
// blurs the linear scene before palette quantization; "post" averages already quantized pixels.
import * as THREE from "three";

export type TiltOrder = "off" | "pre" | "post";

export interface TiltShiftOptions {
  order: TiltOrder;
  /** focus band centre in screen uv (0 bottom, 1 top) */
  bandCenter: number;
  /** half height of the sharp band in screen uv */
  bandHalf: number;
  /** uv distance over which the blur ramps to full outside the band */
  falloff: number;
  /** blur radius at full strength in low-res pixels */
  maxBlur: number;
  /** 0 = screen band only, 1 = also blur by distance from the focus depth */
  depthWeight: number;
  /** depth difference (as a share of the focus distance) that reaches full depth blur */
  depthRange: number;
  saturation: number;
  contrast: number;
}

export const TILT_OFF: TiltShiftOptions = {
  order: "off",
  bandCenter: 0.5,
  bandHalf: 0.1,
  falloff: 0.3,
  maxBlur: 0,
  depthWeight: 0,
  depthRange: 1,
  saturation: 1,
  contrast: 1,
};

export interface RetroOptions {
  /** screen pixels per rendered pixel (1 disables the downscale) */
  pixelScale: number;
  /** quantization levels per color channel (0 disables quantization) */
  paletteLevels: number;
  /** ordered dither amplitude in palette steps (0 to 1) */
  ditherStrength: number;
  /** miniature focus band (BACKLOG 14a); omitted = off */
  tilt?: TiltShiftOptions;
}

/** style.json `render.tiltShift` knobs (look v3) */
export type TiltStyle = Omit<TiltShiftOptions, "order"> & {
  order: "pre" | "post";
  defaultOn: boolean;
};

/**
 * Tilt options for a settings or URL mode: "default" follows style defaultOn, "on" uses the style
 * order, "pre" and "post" force an order, anything else (or no style block) is off.
 */
export function resolveTilt(
  style: TiltStyle | undefined,
  mode: string,
): TiltShiftOptions {
  if (!style) return TILT_OFF;
  const on =
    mode === "on" ||
    mode === "pre" ||
    mode === "post" ||
    (mode === "default" && style.defaultOn);
  if (!on) return TILT_OFF;
  const { defaultOn: _d, ...knobs } = style;
  return {
    ...knobs,
    order: mode === "pre" || mode === "post" ? mode : style.order,
  };
}

/** Uniform values for the tilt-shift knobs (pure, unit tested). */
export function tiltUniforms(t: TiltShiftOptions | undefined): {
  mode: number;
  band: [number, number, number, number];
  blur: number;
  depthRange: number;
  lift: [number, number];
} {
  const o = t ?? TILT_OFF;
  const mode = o.order === "pre" ? 1 : o.order === "post" ? 2 : 0;
  return {
    mode,
    band: [
      o.bandCenter,
      Math.max(0, o.bandHalf),
      Math.max(1e-3, o.falloff),
      Math.min(1, Math.max(0, o.depthWeight)),
    ],
    blur: mode ? Math.max(0, o.maxBlur) : 0,
    depthRange: Math.max(1e-3, o.depthRange),
    lift: mode ? [o.saturation, o.contrast] : [1, 1],
  };
}

export class RetroPass {
  private rt: THREE.WebGLRenderTarget;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  opts: RetroOptions;

  constructor(opts: RetroOptions) {
    this.opts = opts;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      samples: 0,
    });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
    const tu = tiltUniforms(opts.tilt);
    this.mat = new THREE.ShaderMaterial({
      toneMapped: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.rt.texture },
        tDepth: { value: this.rt.depthTexture },
        uLow: { value: new THREE.Vector2(4, 4) },
        uLevels: { value: opts.paletteLevels },
        uDither: { value: opts.ditherStrength },
        uTilt: { value: tu.mode },
        uBand: { value: new THREE.Vector4(...tu.band) },
        uBlur: { value: tu.blur },
        uDepthRange: { value: tu.depthRange },
        uLift: { value: new THREE.Vector2(...tu.lift) },
        uNearFar: { value: new THREE.Vector2(0.1, 2000) },
        uFocus: { value: 50 },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform sampler2D tDepth;
        uniform vec2 uLow;
        uniform float uLevels;
        uniform float uDither;
        uniform float uTilt;
        uniform vec4 uBand;
        uniform float uBlur;
        uniform float uDepthRange;
        uniform vec2 uLift;
        uniform vec2 uNearFar;
        uniform float uFocus;
        varying vec2 vUv;
        float bayer4(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          int i = int(q.x) + int(q.y) * 4;
          float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
          return m[i] / 16.0 - 0.46875;
        }
        const vec2 TAPS[12] = vec2[12](
          vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
          vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
          vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
        float linDepth(float d) {
          float z = d * 2.0 - 1.0;
          return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
        }
        // 0 = sharp, 1 = full blur: distance from the focus band, raised by distance from the focus depth
        float tiltAmount(vec2 uv) {
          float s = smoothstep(uBand.y, uBand.y + uBand.z, abs(uv.y - uBand.x));
          float d = texture2D(tDepth, uv).x;
          float dz = d >= 1.0 ? 1.0 : clamp(abs(linDepth(d) - uFocus) / (uFocus * uDepthRange), 0.0, 1.0);
          return max(s, dz * uBand.w);
        }
        vec3 lift(vec3 c) {
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, uLift.x);
          return clamp((c - 0.5) * uLift.y + 0.5, 0.0, 1.0);
        }
        // tone map, output color space, lift and palette quantization of one linear scene color
        vec3 finish(vec3 lin, vec2 lowPx) {
          gl_FragColor = vec4(lin, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          vec3 c = lift(gl_FragColor.rgb);
          if (uLevels > 1.0) {
            float steps = uLevels - 1.0;
            vec3 v = c * steps + bayer4(lowPx) * uDither;
            c = clamp(floor(v + 0.5) / steps, 0.0, 1.0);
          }
          return c;
        }
        void main() {
          vec2 texel = 1.0 / uLow;
          float r = uTilt > 0.5 ? tiltAmount(vUv) * uBlur : 0.0;
          vec3 outc;
          if (r < 0.25) {
            outc = finish(texture2D(tScene, vUv).rgb, vUv * uLow);
          } else if (uTilt < 1.5) {
            vec3 acc = texture2D(tScene, vUv).rgb;
            for (int i = 0; i < 12; i++) acc += texture2D(tScene, vUv + TAPS[i] * texel * r).rgb;
            outc = finish(acc / 13.0, vUv * uLow);
          } else {
            vec3 acc = finish(texture2D(tScene, vUv).rgb, vUv * uLow);
            for (int i = 0; i < 12; i++) {
              vec2 uv = vUv + TAPS[i] * texel * r;
              acc += finish(texture2D(tScene, uv).rgb, uv * uLow);
            }
            outc = acc / 13.0;
          }
          gl_FragColor = vec4(outc, 1.0);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get enabled(): boolean {
    return (
      this.opts.pixelScale > 1 ||
      this.opts.paletteLevels > 1 ||
      (this.opts.tilt?.order ?? "off") !== "off"
    );
  }

  setSize(w: number, h: number): void {
    const s = Math.max(1, this.opts.pixelScale);
    const lw = Math.max(1, Math.ceil(w / s));
    const lh = Math.max(1, Math.ceil(h / s));
    this.rt.setSize(lw, lh);
    this.mat.uniforms.uLow.value.set(lw, lh);
  }

  setOptions(o: Partial<RetroOptions>): void {
    this.opts = { ...this.opts, ...o };
    this.mat.uniforms.uLevels.value = this.opts.paletteLevels;
    this.mat.uniforms.uDither.value = this.opts.ditherStrength;
    const tu = tiltUniforms(this.opts.tilt);
    this.mat.uniforms.uTilt.value = tu.mode;
    this.mat.uniforms.uBand.value.set(...tu.band);
    this.mat.uniforms.uBlur.value = tu.blur;
    this.mat.uniforms.uDepthRange.value = tu.depthRange;
    this.mat.uniforms.uLift.value.set(...tu.lift);
  }

  /** Focus distance (camera to its target) and clip planes for the depth blur, set every frame. */
  setFocus(distance: number, near: number, far: number, active = true): void {
    const tu = tiltUniforms(this.opts.tilt);
    this.mat.uniforms.uTilt.value = active ? tu.mode : 0;
    // map view (inactive) drops the saturation and contrast lift too (ADR-013)
    this.mat.uniforms.uLift.value.set(
      ...(active ? tu.lift : ([1, 1] as [number, number])),
    );
    this.mat.uniforms.uFocus.value = distance;
    this.mat.uniforms.uNearFar.value.set(near, far);
  }

  /** Render `scene` through the pass. The scene pass skips tone mapping (it happens in the quad). */
  render(
    gl: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    const tm = gl.toneMapping;
    gl.setRenderTarget(this.rt);
    gl.toneMapping = THREE.NoToneMapping;
    gl.render(scene, camera);
    gl.toneMapping = tm;
    gl.setRenderTarget(null);
    gl.render(this.scene, this.cam);
  }
}

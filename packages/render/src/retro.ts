// Retro render pass (ADR-005): the 3D scene renders into a low-resolution target, then a fullscreen
// quad upscales it with nearest-neighbor filtering, applies tone mapping and color space, and
// quantizes the result to a limited palette with 4x4 Bayer ordered dithering. Knobs live in
// style.json `render`; pixelScale 1 with no quantization turns it off.
import * as THREE from "three";

export interface RetroOptions {
  /** screen pixels per rendered pixel (1 disables the downscale) */
  pixelScale: number;
  /** quantization levels per color channel (0 disables quantization) */
  paletteLevels: number;
  /** ordered dither amplitude in palette steps (0 to 1) */
  ditherStrength: number;
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
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, samples: 0 });
    this.mat = new THREE.ShaderMaterial({
      toneMapped: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.rt.texture },
        uLow: { value: new THREE.Vector2(4, 4) },
        uLevels: { value: opts.paletteLevels },
        uDither: { value: opts.ditherStrength },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene;
        uniform vec2 uLow;
        uniform float uLevels;
        uniform float uDither;
        varying vec2 vUv;
        float bayer4(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          int i = int(q.x) + int(q.y) * 4;
          float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
          return m[i] / 16.0 - 0.46875;
        }
        void main() {
          vec4 c = texture2D(tScene, vUv);
          gl_FragColor = vec4(c.rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          if (uLevels > 1.0) {
            float steps = uLevels - 1.0;
            vec2 lowPx = vUv * uLow;
            vec3 v = gl_FragColor.rgb * steps + bayer4(lowPx) * uDither;
            gl_FragColor.rgb = clamp(floor(v + 0.5) / steps, 0.0, 1.0);
          }
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  get enabled(): boolean {
    return this.opts.pixelScale > 1 || this.opts.paletteLevels > 1;
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
  }

  /** Render `scene` through the pass. The scene pass skips tone mapping (it happens in the quad). */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const tm = gl.toneMapping;
    gl.setRenderTarget(this.rt);
    gl.toneMapping = THREE.NoToneMapping;
    gl.render(scene, camera);
    gl.toneMapping = tm;
    gl.setRenderTarget(null);
    gl.render(this.scene, this.cam);
  }
}

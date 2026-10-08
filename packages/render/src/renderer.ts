// three.js WebGL renderer behind the Renderer interface. Reads a sim World (never writes it):
// terrain chunks remesh from the terrain dirty cursor, chunks render at the wrapped copy nearest the
// camera focus, every world material bends with the curved-world patch.
import * as THREE from "three";
import type { Style } from "@hearthfall/data";
import type { World } from "@hearthfall/sim";
import { applyCamera, CAMERA_PRESETS, type CameraState } from "./camera.ts";
import { bendMaterial, makeBendUniforms, type BendUniforms } from "./curve.ts";
import { CHUNK, makeWaterMaterial, TerrainChunk, type TerrainPalette } from "./terrainMesh.ts";

export interface Renderer {
  setWorld(world: World): void;
  setCamera(s: Partial<CameraState> | string): void;
  render(visualTime: number): void;
  readonly frames: number;
  dispose(): void;
}

export interface RenderStats {
  frames: number;
  chunks: number;
  remeshTotal: number;
  lastRemesh: number;
  fullRebuilds: number;
  drawCalls: number;
  triangles: number;
  cpuMs: number;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  style: Style;
  heightUnitsPerWorldUnit: number;
  /** render-only vertical exaggeration so terrain reads at a distance */
  verticalScale?: number;
}

export class ThreeRenderer implements Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
  readonly bend: BendUniforms = makeBendUniforms();
  readonly time = { value: 0 };
  cam: CameraState = { x: 0, z: 0, yaw: 0.6, zoom: 0.32, map: false };
  frames = 0;
  stats: RenderStats = { frames: 0, chunks: 0, remeshTotal: 0, lastRemesh: 0, fullRebuilds: 0, drawCalls: 0, triangles: 0, cpuMs: 0 };
  private world: World | null = null;
  private chunks: TerrainChunk[] = [];
  private cursor = -1;
  private readonly palette: TerrainPalette;
  private readonly terrainMat: THREE.MeshLambertMaterial;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;

  constructor(o: RendererOptions) {
    this.gl = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(1);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    const pal = o.style.palette;
    const C = (k: string, fb = "#ff00ff") => new THREE.Color(pal[k] ?? fb);
    this.palette = {
      sand: C("sand"),
      sandWet: C("sand").lerp(C("rockDark"), 0.35),
      meadow: C("meadow"),
      moss: C("moss"),
      forest: C("forest"),
      rock: C("rock"),
      rockDark: C("rockDark"),
      snow: C("snow"),
      scar: C("scar"),
      water: C("water"),
      waterShallow: C("waterShallow"),
      foam: C("foam"),
      bands: { shore: 0, lowland: 0, grass: 0, highland: 0, rock: 0, peak: 0 },
      heightScale: (o.verticalScale ?? 1.6) / o.heightUnitsPerWorldUnit,
      maxWalkSlope: 20,
    };
    const L = o.style.lighting;
    this.bend.uHorizon.value.set(L.skyHorizon);
    this.scene.fog = new THREE.Fog(L.fogColor, 60, 200);
    this.scene.add(new THREE.HemisphereLight(L.skyTop, pal.moss ?? "#5e8c3a", 1.25));
    this.sun = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
    this.sun.position.set(0.55, 0.8, 0.3);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.terrainMat = bendMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), this.bend);
    this.waterMat = makeWaterMaterial(this.palette, this.bend, this.time);
    this.sky = makeSky(L.skyTop, L.skyHorizon);
    this.scene.add(this.sky);
  }

  setWorld(world: World): void {
    for (const c of this.chunks) {
      this.scene.remove(c.mesh, c.water);
      c.mesh.geometry.dispose();
      c.water.geometry.dispose();
    }
    this.world = world;
    const t = world.terrain;
    Object.assign(this.palette.bands, world.cfg.bands);
    this.palette.maxWalkSlope = world.cfg.maxWalkSlope;
    const n = t.size / CHUNK;
    this.chunks = [];
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const c = new TerrainChunk(cx, cz, this.terrainMat, this.waterMat);
        this.chunks.push(c);
        this.scene.add(c.mesh, c.water);
      }
    }
    this.rebuildAll();
    this.stats.chunks = this.chunks.length;
  }

  private rebuildAll(): void {
    const t = this.world!.terrain;
    for (const c of this.chunks) c.build(t, this.palette);
    this.cursor = t.version;
    this.stats.fullRebuilds++;
    this.stats.remeshTotal += this.chunks.length;
    this.stats.lastRemesh = this.chunks.length;
  }

  /** Remesh only chunks touched since the last sync. Returns how many were rebuilt. */
  syncTerrain(): number {
    const w = this.world;
    if (!w) return 0;
    const t = w.terrain;
    const rects = t.dirtySince(this.cursor);
    if (rects === null) {
      this.rebuildAll();
      return this.chunks.length;
    }
    if (!rects.length) {
      this.stats.lastRemesh = 0;
      return 0;
    }
    const n = t.size / CHUNK;
    const touched = new Set<number>();
    for (const r of rects) {
      for (let y = r.y; y < r.y + r.h + 1; y += 1) {
        const cz = Math.floor((((y % t.size) + t.size) % t.size) / CHUNK);
        for (let x = r.x; x < r.x + r.w + 1; x += 1) touched.add(cz * n + Math.floor((((x % t.size) + t.size) % t.size) / CHUNK));
      }
    }
    for (const i of touched) this.chunks[i].build(t, this.palette);
    this.cursor = t.version;
    this.stats.remeshTotal += touched.size;
    this.stats.lastRemesh = touched.size;
    return touched.size;
  }

  setCamera(s: Partial<CameraState> | string): void {
    const patch = typeof s === "string" ? CAMERA_PRESETS[s] ?? {} : s;
    this.cam = { ...this.cam, ...patch };
    const size = this.world?.terrain.size ?? 128;
    this.cam.x = ((this.cam.x % size) + size) % size;
    this.cam.z = ((this.cam.z % size) + size) % size;
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(visualTime: number): void {
    const t0 = performance.now();
    this.time.value = visualTime;
    this.syncTerrain();
    const w = this.world;
    if (w) {
      const t = w.terrain;
      const size = t.size;
      const focusY = Math.max(t.heightAt(this.cam.x, this.cam.z), t.sea) * this.palette.heightScale;
      const r = applyCamera(this.camera, this.cam, focusY, size);
      this.bend.uBendK.value = r.bendK;
      this.bend.uBendFocus.value.set(this.cam.x, this.cam.z);
      const half = size / 2;
      this.bend.uFadeEnd.value = this.cam.map ? 1e6 : half - 2;
      this.bend.uFadeStart.value = this.cam.map ? 1e6 : half - 14;
      const fog = this.scene.fog as THREE.Fog;
      fog.near = r.fogNear;
      fog.far = r.fogFar;
      for (const c of this.chunks) c.place(this.cam.x, this.cam.z, size);
      this.sun.target.position.set(this.cam.x, 0, this.cam.z);
      this.sun.position.set(this.cam.x + 40, 80, this.cam.z + 25);
    }
    this.sky.position.copy(this.camera.position);
    this.gl.render(this.scene, this.camera);
    this.frames++;
    this.stats.frames = this.frames;
    this.stats.drawCalls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;
    this.stats.cpuMs = performance.now() - t0;
  }

  /** Deliberate breakage for visual QA calibration (TESTING section 7, VISIONQA section 5). */
  setDebug(f: { hideTerrain?: boolean; blackCanvas?: boolean; magentaMaterials?: boolean }): void {
    for (const c of this.chunks) {
      c.mesh.visible = !f.hideTerrain;
      c.water.visible = !f.hideTerrain;
    }
    this.sky.visible = !f.blackCanvas;
    this.scene.visible = !f.blackCanvas;
    if (f.blackCanvas) this.gl.setClearColor(0x000000, 1);
    this.terrainMat.vertexColors = !f.magentaMaterials;
    this.terrainMat.color.set(f.magentaMaterials ? "#ff00ff" : "#ffffff");
    this.terrainMat.needsUpdate = true;
  }

  dispose(): void {
    this.gl.dispose();
  }
}

function makeSky(top: string, horizon: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main() { float t = smoothstep(-0.15, 0.55, vDir.y); gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

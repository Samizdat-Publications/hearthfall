// three.js WebGL renderer behind the Renderer interface. Reads a sim World (never writes it):
// terrain chunks remesh from the terrain dirty cursor, chunks render at the wrapped copy nearest the
// camera focus, every world material bends with the curved-world patch.
import * as THREE from "three";
import type { Style } from "@hearthfall/data";
import type { World } from "@hearthfall/sim";
import { applyCamera, CAMERA_PRESETS, type CameraState } from "./camera.ts";
import { bendMaterial, makeBendUniforms, type BendUniforms } from "./curve.ts";
import { CHUNK, makeWaterMaterial, TerrainChunk, type TerrainPalette } from "./terrainMesh.ts";
import { TreeLayer } from "./props.ts";
import { UnitLayer } from "./unitsLayer.ts";
import { BuildingLayer } from "./buildingsLayer.ts";
import { VfxLayer } from "./vfx.ts";
import { RetroPass } from "./retro.ts";

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
  unitsDrawn: number;
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
  cam: CameraState = { x: 0, z: 0, yaw: 0.6, zoom: 0.42, map: false };
  frames = 0;
  stats: RenderStats = { frames: 0, chunks: 0, remeshTotal: 0, lastRemesh: 0, fullRebuilds: 0, drawCalls: 0, triangles: 0, cpuMs: 0, unitsDrawn: 0 };
  private world: World | null = null;
  private chunks: TerrainChunk[] = [];
  private cursor = -1;
  private scarCursor = -1;
  private readonly palette: TerrainPalette;
  private readonly terrainMat: THREE.MeshLambertMaterial;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly trees: TreeLayer;
  private readonly propMat: THREE.MeshLambertMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly pal: Record<string, string>;
  private readonly styleRender: RendererOptions["style"]["render"];
  units: UnitLayer | null = null;
  buildings: BuildingLayer | null = null;
  /** sim tick interpolation factor in [0, 1] and the selection to ring (entity indices) */
  alpha = 1;
  selected: ReadonlySet<number> = new Set();
  private ghost: THREE.Mesh;
  readonly vfx: VfxLayer;
  readonly retro: RetroPass;
  private hearthLights: THREE.PointLight[] = [];
  private readonly detail = { amount: { value: 0 }, cells: { value: 3 } };
  private rangeRing: THREE.Mesh;
  private areaRing: THREE.Mesh;
  private viewW = 1280;
  private viewH = 720;
  private renderScale = 1;

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
      cliff: C("cliff", "#8f5e36"),
      cliffDark: C("cliffDark", "#5a371d"),
      bands: { shore: 0, lowland: 0, grass: 0, highland: 0, rock: 0, peak: 0 },
      heightScale: (o.verticalScale ?? 2.0) / o.heightUnitsPerWorldUnit,
      maxWalkSlope: 20,
    };
    const L = o.style.lighting;
    const rs = o.style.render;
    const space = rs?.space;
    // the planet limb fades to an atmospheric rim when the space backdrop is on
    this.bend.uHorizon.value.set(space?.rim ?? L.skyHorizon);
    this.scene.fog = new THREE.Fog(space?.rim ?? L.fogColor, 60, 200);
    this.scene.add(new THREE.HemisphereLight(L.skyTop, pal.moss ?? "#5e8c3a", 1.25 * (rs?.ambientIntensity ?? 1)));
    this.retro = new RetroPass({ pixelScale: rs?.pixelScale ?? 1, paletteLevels: rs?.paletteLevels ?? 0, ditherStrength: rs?.ditherStrength ?? 0 });
    this.detail.amount.value = rs?.detailNoise ?? 0;
    this.detail.cells.value = rs?.detailCellsPerUnit ?? 3;
    for (let k = 0; k < 4; k++) {
      const pl = new THREE.PointLight(rs?.hearthLight.color ?? "#ffa04a", 0, rs?.hearthLight.distance ?? 9, 1.6);
      this.hearthLights.push(pl);
      this.scene.add(pl);
    }
    this.sun = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
    this.sun.position.set(0.55, 0.8, 0.3);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.terrainMat = bendMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), this.bend, this.detail);
    this.waterMat = makeWaterMaterial(this.palette, this.bend, this.time, rs?.foamStrokes ?? 0);
    this.pal = pal;
    this.styleRender = o.style.render;
    this.propMat = bendMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), this.bend);
    this.ringMat = bendMaterial(new THREE.MeshBasicMaterial({ color: pal.foam ?? "#e6f4f8", transparent: true, opacity: 0.9, depthWrite: false }), this.bend);
    this.trees = new TreeLayer(this.propMat, pal);
    for (const m of this.trees.meshes) this.scene.add(m);
    this.ghost = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2), bendMaterial(new THREE.MeshBasicMaterial({ color: "#8dbf5a", transparent: true, opacity: 0.55, depthWrite: false }), this.bend));
    this.ghost.visible = false;
    this.ghost.frustumCulled = false;
    this.scene.add(this.ghost);
    this.vfx = new VfxLayer(this.bend);
    this.scene.add(this.vfx.group);
    const ringMat = (color: string) => bendMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }), this.bend);
    this.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), ringMat("#f4f1ea"));
    this.areaRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2), ringMat("#ffd23a"));
    for (const r of [this.rangeRing, this.areaRing]) {
      r.visible = false;
      r.frustumCulled = false;
      r.renderOrder = 10;
      this.scene.add(r);
    }
    this.sky = space ? makeSpaceSky(space.top, space.horizon, space.stars) : makeSky(L.skyTop, L.skyHorizon);
    this.gl.setClearColor(pal.water ?? "#2f7fb8", 1);
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
    if (this.units) this.scene.remove(this.units.group);
    this.units = new UnitLayer(this.propMat, this.ringMat, world.cfg.pack.units.units.map((u) => u.id), this.pal, world.tribes.map((t) => t.color));
    this.scene.add(this.units.group);
    if (this.buildings) this.scene.remove(this.buildings.group);
    this.buildings = new BuildingLayer(this.propMat, world.cfg.pack.buildings.buildings, this.pal, world.tribes.map((t) => t.color));
    this.scene.add(this.buildings.group);
  }

  private rebuildAll(): void {
    const t = this.world!.terrain;
    for (const c of this.chunks) c.build(t, this.palette);
    this.cursor = t.version;
    this.stats.fullRebuilds++;
    this.stats.remeshTotal += this.chunks.length;
    this.stats.lastRemesh = this.chunks.length;
  }

  /** Feed sim events (collected per tick by the app) to the VFX layer. */
  consumeEvents(events: readonly import("@hearthfall/sim").SimEvent[], timeOf: (e: import("@hearthfall/sim").SimEvent) => number): void {
    if (this.world) this.vfx.consume(events, this.world, timeOf, this.palette.heightScale);
  }

  /** Remesh only chunks touched since the last sync. Returns how many were rebuilt. */
  syncTerrain(): number {
    const w = this.world;
    if (!w) return 0;
    const t = w.terrain;
    if (t.scarVersion !== this.scarCursor) {
      // heal pass: re-tint only chunks that hold scars
      this.scarCursor = t.scarVersion;
      for (const c of this.chunks) if (c.hasScar) c.build(t, this.palette);
    }
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

  /** Internal render resolution scale (settings quality: 1, 0.75, 0.5). Picking and HUD keep CSS pixels. */
  setRenderScale(s: number): void {
    this.renderScale = Math.min(1, Math.max(0.25, s));
    this.resize(this.viewW, this.viewH);
  }

  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
    const s = this.renderScale;
    // the retro pass renders the scene into a low-res target: scale that; without it scale the canvas buffer
    this.retro.setSize(w * s, h * s);
    if (this.retro.enabled) this.gl.setSize(w, h, false);
    else this.gl.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(visualTime: number): void {
    const t0 = performance.now();
    this.time.value = visualTime;
    this.syncTerrain();
    const w = this.world;
    const r = this.syncCamera();
    if (w && r) {
      const size = w.terrain.size;
      const half = size / 2;
      this.bend.uFadeEnd.value = this.cam.map ? 1e6 : half - 2;
      this.bend.uFadeStart.value = this.cam.map ? 1e6 : half - 14;
      const fog = this.scene.fog as THREE.Fog;
      fog.near = r.fogNear;
      fog.far = r.fogFar;
      for (const c of this.chunks) c.place(this.cam.x, this.cam.z, size);
      this.trees.update(w, this.cam.x, this.cam.z, this.palette.heightScale);
      this.buildings?.update(w, this.cam.x, this.cam.z, this.palette.heightScale);
      this.units?.update(w, this.alpha, this.cam.x, this.cam.z, this.palette.heightScale, visualTime, this.bend.uFadeEnd.value, this.camera, this.bend.uBendK.value, this.viewW, this.viewH, this.selected);
      this.stats.unitsDrawn = this.units?.drawn ?? 0;
      this.vfx.update(w, visualTime, this.cam.x, this.cam.z, this.palette.heightScale);
      this.sun.target.position.set(this.cam.x, 0, this.cam.z);
      this.sun.position.set(this.cam.x + 40, 80, this.cam.z + 25);
    }
    this.placeHearthLights();
    this.sky.visible = !this.cam.map && this.scene.visible;
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar((this.camera.far * 0.9) / 900);
    if (this.retro.enabled && this.scene.visible) this.retro.render(this.gl, this.scene, this.camera);
    else this.gl.render(this.scene, this.camera);
    this.frames++;
    this.stats.frames = this.frames;
    this.stats.drawCalls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;
    this.stats.cpuMs = performance.now() - t0;
  }

  /** Warm firelight on up to four Hearths nearest the camera focus (wrapped near the focus). */
  private placeHearthLights(): void {
    const w = this.world;
    for (const l of this.hearthLights) l.intensity = 0;
    if (!w) return;
    const n = w.terrain.size;
    const E = w.ents;
    const rs = this.styleRender;
    const found: { d: number; x: number; z: number; y: number }[] = [];
    for (const t of w.tribes) {
      const h = E.index(t.hearth);
      if (h < 0) continue;
      let ox = E.x[h] - this.cam.x;
      let oz = E.y[h] - this.cam.z;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      const y = Math.max(w.terrain.heightAt(E.x[h], E.y[h]), w.terrain.sea) * this.palette.heightScale;
      found.push({ d: ox * ox + oz * oz, x: this.cam.x + ox, z: this.cam.z + oz, y });
    }
    found.sort((a, b) => a.d - b.d);
    found.slice(0, this.hearthLights.length).forEach((f, k) => {
      const l = this.hearthLights[k];
      l.position.set(f.x, f.y + 1.2 - this.bend.uBendK.value * f.d, f.z);
      l.intensity = rs?.hearthLight.intensity ?? 14;
    });
  }

  /** Spell targeting preview: range ring around the Shaper and the effect area at the cursor. */
  setTargeting(t: { cx: number; cz: number; range: number; x: number; z: number; r: number; inRange: boolean } | null): void {
    if (!t || !this.world) {
      this.rangeRing.visible = false;
      this.areaRing.visible = false;
      return;
    }
    const w = this.world;
    const n = w.terrain.size;
    const s = this.palette.heightScale;
    const place = (m: THREE.Mesh, x: number, z: number, r: number) => {
      let ox = x - this.cam.x;
      let oz = z - this.cam.z;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      m.position.set(this.cam.x + ox, Math.max(w.terrain.heightAt(((x % n) + n) % n, ((z % n) + n) % n), w.terrain.sea) * s + 0.15, this.cam.z + oz);
      m.scale.set(r, 1, r);
      m.visible = true;
    };
    place(this.rangeRing, t.cx, t.cz, t.range);
    place(this.areaRing, t.x, t.z, t.r);
    (this.areaRing.material as THREE.MeshBasicMaterial).color.set(t.inRange ? "#ffd23a" : "#e0a12a");
  }

  /** Show or hide the building placement ghost (footprint quad, green when buildable, red when not). */
  setPlacement(p: { x: number; z: number; w: number; h: number; ok: boolean } | null): void {
    if (!p || !this.world) {
      this.ghost.visible = false;
      return;
    }
    const t = this.world.terrain;
    let top = t.sea;
    for (let y = 0; y <= p.h; y++) for (let x = 0; x <= p.w; x++) top = Math.max(top, t.get(Math.round(p.x - p.w / 2) + x, Math.round(p.z - p.h / 2) + y));
    this.ghost.visible = true;
    this.ghost.scale.set(p.w + 0.4, 1, p.h + 0.4);
    let ox = p.x - this.cam.x;
    let oz = p.z - this.cam.z;
    const n = t.size;
    ox -= Math.round(ox / n) * n;
    oz -= Math.round(oz / n) * n;
    this.ghost.position.set(this.cam.x + ox, top * this.palette.heightScale + 0.08, this.cam.z + oz);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(p.ok ? "#8dbf5a" : "#c8312e");
  }

  /**
   * Terrain point under a screen pixel: march the camera ray against the bent heightfield (the
   * same bend as the shader) and refine by bisection. Water counts as a surface. Returns wrapped
   * map coordinates or null when the ray misses the world.
   */
  pickTerrain(px: number, py: number): { x: number; z: number } | null {
    const p = this.march(px, py, false);
    if (!p) return null;
    const n = this.world!.terrain.size;
    return { x: ((p.x % n) + n) % n, z: ((p.z % n) + n) % n };
  }

  /**
   * Point under a screen pixel on the bent sea-level surface, ignoring hills, NOT wrapped (so a
   * view footprint stays one connected shape). The minimap view outline uses it.
   */
  pickGround(px: number, py: number): { x: number; z: number } | null {
    return this.march(px, py, true);
  }

  /**
   * Apply the camera rig state to the three.js camera and the bend uniforms. render() calls it every frame;
   * picking calls it too, so a pick right after setCamera (before the next frame) sees the new view.
   */
  private syncCamera(): ReturnType<typeof applyCamera> | null {
    const w = this.world;
    if (!w) return null;
    const t = w.terrain;
    const focusY = Math.max(t.heightAt(this.cam.x, this.cam.z), t.sea) * this.palette.heightScale;
    const r = applyCamera(this.camera, this.cam, focusY, t.size);
    this.bend.uBendK.value = r.bendK;
    this.bend.uBendFocus.value.set(this.cam.x, this.cam.z);
    this.camera.updateMatrixWorld();
    return r;
  }

  private march(px: number, py: number, flat: boolean): { x: number; z: number } | null {
    const w = this.world;
    if (!w) return null;
    this.syncCamera();
    const t = w.terrain;
    const n = t.size;
    const s = this.palette.heightScale;
    const ndc = new THREE.Vector2((px / this.viewW) * 2 - 1, 1 - (py / this.viewH) * 2);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const k = this.bend.uBendK.value;
    const fx = this.bend.uBendFocus.value.x;
    const fz = this.bend.uBendFocus.value.y;
    const above = (dist: number) => {
      const x = o.x + d.x * dist;
      const z = o.z + d.z * dist;
      const ground = flat ? t.sea * s : Math.max(t.heightAt(((x % n) + n) % n, ((z % n) + n) % n), t.sea) * s;
      const ddx = x - fx;
      const ddz = z - fz;
      return o.y + d.y * dist - (ground - k * (ddx * ddx + ddz * ddz));
    };
    const step = 0.4;
    const maxDist = this.camera.far;
    let prev = 0;
    for (let dist = step; dist < maxDist; dist += step) {
      if (above(dist) <= 0) {
        let lo = prev;
        let hi = dist;
        for (let it = 0; it < 12; it++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        return { x: o.x + d.x * hi, z: o.z + d.z * hi };
      }
      prev = dist;
    }
    return null;
  }

  /** Deliberate breakage for visual QA calibration (TESTING section 7, VISIONQA section 5). */
  setDebug(f: { hideTerrain?: boolean; blackCanvas?: boolean; magentaMaterials?: boolean }): void {
    for (const c of this.chunks) {
      c.mesh.visible = !f.hideTerrain;
      c.water.visible = !f.hideTerrain;
    }
    for (const m of this.trees.meshes) m.visible = !f.hideTerrain;
    this.sky.visible = !f.blackCanvas;
    this.scene.visible = !f.blackCanvas;
    this.gl.setClearColor(f.blackCanvas ? 0x000000 : this.palette.water, 1);
    this.terrainMat.vertexColors = !f.magentaMaterials;
    this.terrainMat.color.set(f.magentaMaterials ? "#ff00ff" : "#ffffff");
    this.terrainMat.needsUpdate = true;
    this.propMat.vertexColors = !f.magentaMaterials;
    this.propMat.color.set(f.magentaMaterials ? "#ff00ff" : "#ffffff");
    this.propMat.needsUpdate = true;
  }

  dispose(): void {
    this.gl.dispose();
  }
}

/** Dark space backdrop: a gradient toward the horizon plus hashed pixel stars (look v2). */
function makeSpaceSky(top: string, horizon: string, stars: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) }, uStars: { value: stars } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; uniform float uStars; varying vec3 vDir;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = mix(uHorizon, uTop, smoothstep(-0.35, 0.6, d.y));
        vec3 cell = floor(d * 220.0);
        float h = h3(cell);
        float thr = 1.0 - 0.012 * uStars;
        if (h > thr) col += vec3(0.75, 0.8, 1.0) * (0.35 + 0.65 * h3(cell + 3.1));
        vec3 big = floor(d * 70.0);
        if (h3(big + 9.7) > 1.0 - 0.0025 * uStars) col += vec3(1.0, 0.95, 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

function makeSky(top: string, horizon: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
      void main() { float t = smoothstep(-0.02, 0.32, vDir.y); gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

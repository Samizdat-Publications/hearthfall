// three.js WebGL renderer behind the Renderer interface. Reads a sim World (never writes it):
// terrain chunks remesh from the terrain dirty cursor, chunks render at the wrapped copy nearest the
// camera focus, every world material bends with the curved-world patch.
import * as THREE from "three";
import type { Style } from "@hearthfall/data";
import type { World } from "@hearthfall/sim";
import { applyCamera, CAMERA_PRESETS, cameraRig, type CameraRig, type CameraState } from "./camera.ts";
import { bendMaterial, makeBendUniforms, type BendUniforms } from "./curve.ts";
import {
  RainLayer,
  skyHorizonFor,
  resolveLighting,
  waterTint,
  type LightingLook,
} from "./weather.ts";
import {
  CHUNK,
  chunksTouched,
  fillDepth,
  fillDepthRects,
  makeWaterMaterial,
  strokeLookFor,
  TerrainChunk,
  type TerrainPalette,
} from "./terrainMesh.ts";
import { TreeLayer } from "./props.ts";
import { ContactShadows, makeShadowMaterial, resolveContactShadows } from "./shadows.ts";
import { DecorLayer } from "./decor.ts";
import { GroundDetailLayer } from "./groundDetail.ts";
import { UnitLayer } from "./unitsLayer.ts";
import { BuildingLayer } from "./buildingsLayer.ts";
import { WorshipLayer } from "./worshipLayer.ts";
import { VfxLayer } from "./vfx.ts";
import { buildingUnder, HealthBarLayer, HoverRing, relationOf, unitUnder, type HealthBarMode, type Relation } from "./overlays.ts";
import { AmbientLayer, glintFor, hearthFlicker, resolveAmbient } from "./ambient.ts";
import { RetroPass, resolveTilt } from "./retro.ts";
import { applyModelFixes, loadModels, type ModelLoadReport, type ModelParts } from "./models.ts";

/** Real model state (M10): pending while loading; `drawn` lists the model ids the current layers use. */
export interface ModelStatus {
  pending: boolean;
  loaded: string[];
  failed: string[];
  drawn: string[];
}

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
  /** BACKLOG 37/40: map view is a straight top-down orthographic projection fitted to the window */
  readonly mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  /** map view frame: masks outside the world square plus a coarse grid; visible only in map view */
  readonly mapFrame = new THREE.Group();
  private mapFrameSize = 0;
  readonly bend: BendUniforms = makeBendUniforms();
  readonly time = { value: 0 };
  cam: CameraState = { x: 0, z: 0, yaw: 0.6, zoom: 0.42, map: false };
  frames = 0;
  stats: RenderStats = {
    frames: 0,
    chunks: 0,
    remeshTotal: 0,
    lastRemesh: 0,
    fullRebuilds: 0,
    drawCalls: 0,
    triangles: 0,
    cpuMs: 0,
    unitsDrawn: 0,
  };
  private world: World | null = null;
  private chunks: TerrainChunk[] = [];
  private cursor = -1;
  private scarCursor = -1;
  private readonly palette: TerrainPalette;
  private readonly terrainMat: THREE.MeshLambertMaterial;
  private readonly waterMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  /** S4: the backdrop horizon color with no preset override */
  private readonly skyBase: string;
  private readonly sun: THREE.DirectionalLight;
  /** BACKLOG 14: lighting preset and weather in force (null without style lightingPresets) */
  private readonly hemi: THREE.HemisphereLight;
  private readonly baseAmbient: number;
  private lighting: LightingLook | null = null;
  readonly rain = new RainLayer();
  private trees: TreeLayer;
  /** BACKLOG 39: grass tufts, flowers and pebbles near the focus (null when style.json turns it off) */
  private groundDetail: GroundDetailLayer | null = null;
  private decor: DecorLayer | null = null;
  /** Look v4: one contact shadow set per entity layer, kept across layer rebuilds (null when off) */
  private readonly contact: { units: ContactShadows; buildings: ContactShadows; trees: ContactShadows; decor: ContactShadows } | null = null;
  private models: Map<string, ModelParts> | null = null;
  private modelReport: ModelLoadReport | null = null;
  private modelsPending = false;
  private readonly propMat: THREE.MeshLambertMaterial;
  /** BACKLOG 5: the prop material plus the procedural unit animation */
  private readonly unitMat: THREE.MeshLambertMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private pal: Record<string, string>;
  /** BACKLOG 8: the style palette before any tribe color override */
  private basePal: Record<string, string> = {};
  private readonly styleRender: RendererOptions["style"]["render"];
  private readonly style: RendererOptions["style"];
  units: UnitLayer | null = null;
  buildings: BuildingLayer | null = null;
  worship: WorshipLayer | null = null;
  /** sim tick interpolation factor in [0, 1] and the selection to ring (entity indices) */
  alpha = 1;
  selected: ReadonlySet<number> = new Set();
  private ghost: THREE.Mesh;
  /** Rally flag of the selected lodge (pole plus pennant), hidden when none. */
  readonly rally = new THREE.Group();
  readonly vfx: VfxLayer;
  /** BACKLOG 41: camera rig curves (style.json render.camera) */
  private readonly rig: CameraRig;
  readonly retro: RetroPass;
  private hearthLights: THREE.PointLight[] = [];
  private readonly detail = { amount: { value: 0 }, cells: { value: 3 } };
  private rangeRing: THREE.Mesh;
  private areaRing: THREE.Mesh;
  private viewW = 1280;
  private viewH = 720;
  private renderScale = 1;
  /** render polish: health bars (Settings Health bars), the hover ring and ambient life (Settings Ambient life) */
  readonly healthBars: HealthBarLayer;
  readonly hoverRing: HoverRing;
  readonly ambient: AmbientLayer;
  /** photo mode (the app sets it): no health bars and no hover ring */
  hideOverlays = false;
  /** cursor in CSS pixels over the canvas, or null (the app sets it from its mousemove) */
  private hoverAt: { x: number; y: number } | null = null;
  private hoverHit: { index: number; relation: Relation } | null = null;
  private hoverKey = "";
  private hoverBuilding = -1;
  /** lighting preset name in force (fireflies come out under some) */
  private lightingName = "";
  private readonly glintColor = new THREE.Color();

  constructor(o: RendererOptions) {
    this.gl = new THREE.WebGLRenderer({
      canvas: o.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.gl.setPixelRatio(1);
    // stats count the whole frame (scene pass plus the retro upscale), so reset by hand in render()
    this.gl.info.autoReset = false;
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
      look: o.style.render?.terrainBands,
      heightScale: (o.verticalScale ?? o.style.render?.verticalScale ?? 2.0) / o.heightUnitsPerWorldUnit,
      maxWalkSlope: 20,
    };
    const L = o.style.lighting;
    const rs = o.style.render;
    const space = rs?.space;
    // the planet limb fades to an atmospheric rim when the space backdrop is on
    this.bend.uHorizon.value.set(space?.rim ?? L.skyHorizon);
    this.scene.fog = new THREE.Fog(space?.rim ?? L.fogColor, 60, 200);
    this.baseAmbient = 1.25 * (rs?.ambientIntensity ?? 1);
    this.hemi = new THREE.HemisphereLight(
      L.skyTop,
      pal.moss ?? "#5e8c3a",
      this.baseAmbient,
    );
    this.scene.add(this.hemi);
    this.scene.add(this.rain.mesh);
    this.retro = new RetroPass({
      pixelScale: rs?.pixelScale ?? 1,
      paletteLevels: rs?.paletteLevels ?? 0,
      ditherStrength: rs?.ditherStrength ?? 0,
    });
    this.detail.amount.value = rs?.detailNoise ?? 0;
    this.detail.cells.value = rs?.detailCellsPerUnit ?? 3;
    for (let k = 0; k < 4; k++) {
      const pl = new THREE.PointLight(
        rs?.hearthLight.color ?? "#ffa04a",
        0,
        rs?.hearthLight.distance ?? 9,
        1.6,
      );
      this.hearthLights.push(pl);
      this.scene.add(pl);
    }
    this.sun = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
    this.sun.position.set(0.55, 0.8, 0.3);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.terrainMat = bendMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      this.bend,
      this.detail,
    );
    this.waterMat = makeWaterMaterial(
      this.palette,
      this.bend,
      this.time,
      rs?.foamStrokes ?? 0,
      rs?.water,
    );
    this.styleRender = o.style.render;
    this.applyStrokeLook(rs?.pixelScale ?? 1);
    this.pal = pal;
    this.basePal = pal;
    this.styleRender = o.style.render;
    this.style = o.style;
    this.propMat = bendMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      this.bend,
    );
    this.unitMat = bendMaterial(
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      this.bend,
      undefined,
      true,
    );
    this.ringMat = bendMaterial(
      new THREE.MeshBasicMaterial({
        color: pal.foam ?? "#e6f4f8",
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
      this.bend,
    );
    this.trees = new TreeLayer(this.propMat, pal, null, 8192, rs?.trees);
    for (const m of this.trees.meshes) this.scene.add(m);
    const cs = resolveContactShadows(rs?.contactShadows);
    if (cs.enabled) {
      const sm = makeShadowMaterial(this.bend, cs.strength);
      this.contact = { units: new ContactShadows(sm, 4096, cs), buildings: new ContactShadows(sm, 2048, cs), trees: new ContactShadows(sm, 8192, cs), decor: new ContactShadows(sm, 4096, cs) };
      for (const c of Object.values(this.contact)) this.scene.add(c.mesh);
    }
    this.trees.shadows = this.contact?.trees ?? null;
    if (rs?.groundDetail?.enabled ?? true) {
      this.groundDetail = new GroundDetailLayer(this.propMat, pal, rs?.groundDetail);
      for (const m of this.groundDetail.meshes) this.scene.add(m);
    }
    this.ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2),
      bendMaterial(
        new THREE.MeshBasicMaterial({
          color: "#8dbf5a",
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
        this.bend,
      ),
    );
    this.ghost.visible = false;
    this.ghost.frustumCulled = false;
    this.scene.add(this.ghost);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 1.6, 5).translate(0, 0.8, 0),
      bendMaterial(new THREE.MeshBasicMaterial({ color: "#5a3d26" }), this.bend),
    );
    const pennant = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute([0, 1.55, 0, 0.75, 1.35, 0, 0, 1.12, 0], 3),
      ),
      bendMaterial(
        new THREE.MeshBasicMaterial({ color: "#e0a12a", side: THREE.DoubleSide }),
        this.bend,
      ),
    );
    this.rally.add(pole, pennant);
    this.rally.visible = false;
    for (const m of [pole, pennant]) m.frustumCulled = false;
    this.scene.add(this.rally);
    this.mapFrame.visible = false;
    this.mapFrame.renderOrder = 50;
    this.scene.add(this.mapFrame);
    this.vfx = new VfxLayer(this.bend, undefined, o.style.render?.vfxColors);
    this.rig = cameraRig(o.style.render?.camera);
    this.scene.add(this.vfx.group);
    const ringMat = (color: string) =>
      bendMaterial(
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
        }),
        this.bend,
      );
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2),
      ringMat("#f4f1ea"),
    );
    this.areaRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2),
      ringMat("#ffd23a"),
    );
    for (const r of [this.rangeRing, this.areaRing]) {
      r.visible = false;
      r.frustumCulled = false;
      r.renderOrder = 10;
      this.scene.add(r);
    }
    this.healthBars = new HealthBarLayer(this.bend, stripComment(rs?.healthBars));
    this.scene.add(this.healthBars.mesh);
    this.hoverRing = new HoverRing(this.bend, stripComment(rs?.hover));
    this.scene.add(this.hoverRing.mesh);
    this.ambient = new AmbientLayer(this.bend, resolveAmbient(rs?.ambient));
    this.scene.add(this.ambient.group);
    this.sky = space
      ? makeSpaceSky(space.top, space.horizon, space.stars)
      : makeSky(L.skyTop, L.skyHorizon);
    this.skyBase = space ? space.horizon : L.skyHorizon;
    this.gl.setClearColor(pal.water ?? "#2f7fb8", 1);
    this.scene.add(this.sky);
    this.setLighting("default", "clear");
  }

  /**
   * BACKLOG 14: apply a lighting preset ("default" = style lightingDefault) and weather ("clear" or "rain")
   * from style.json. A style without lightingPresets keeps its base lighting.
   */
  setLighting(preset: string, weather: string): void {
    const st = this.style;
    if (!st.lightingPresets) return;
    const def = st.lightingDefault ?? "golden";
    const look = resolveLighting(
      st.lightingPresets,
      def,
      preset === "default" ? def : preset,
      weather,
      st.weather?.rain,
    );
    this.lighting = look;
    const want = preset === "default" ? def : preset;
    this.lightingName = st.lightingPresets[want] ? want : st.lightingPresets[def] ? def : (Object.keys(st.lightingPresets)[0] ?? "");
    this.sun.color.set(look.keyColor);
    this.sun.intensity = look.keyIntensity;
    this.hemi.color.set(look.hemiSky);
    this.hemi.intensity = this.baseAmbient * look.ambient;
    (this.scene.fog as THREE.Fog).color.set(look.rim);
    if (st.render?.space) this.bend.uHorizon.value.set(look.rim);
    // S4 (14c): the backdrop horizon follows the preset (evening warms it), else the style's space horizon
    const skyU = (this.sky.material as THREE.ShaderMaterial).uniforms;
    if (skyU?.uHorizon) skyU.uHorizon.value.set(skyHorizonFor(look, this.skyBase));
    this.rain.set(look.rain);
    waterTint(
      look,
      st.lightingPresets[def] ?? look,
      this.waterMat.uniforms.uLight.value,
    );
  }

  /** Lighting and weather in force (debug API and tests). */
  lightingState(): { key: string; intensity: number; rain: number } {
    return {
      key: "#" + this.sun.color.getHexString(),
      intensity: this.sun.intensity,
      rain: this.rain.count,
    };
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
    this.buildLayers(world);
  }

  /** BACKLOG 3: the tribe whose fog of war is drawn (the local player) */
  viewTribe = 0;
  /** BACKLOG 3: draw the whole map (debug and god view); the sim keeps its fog */
  revealFog = false;
  private fogTex: THREE.DataTexture | null = null;
  private depthTex: THREE.DataTexture | null = null;
  private fogKey = "";

  /** Upload the viewer's explored and visible grids to the fog texture when they change. */
  private syncFog(w: World): void {
    const v = w.vision;
    for (const l of [this.units, this.buildings, this.vfx]) {
      if (!l) continue;
      l.viewTribe = this.viewTribe;
      l.revealAll = this.revealFog;
    }
    const on =
      v.on &&
      !this.revealFog &&
      this.viewTribe >= 0 &&
      this.viewTribe < v.visible.length;
    this.bend.uFogOn.value = on ? 1 : 0;
    if (!on) return;
    const key = `${v.version}|${this.viewTribe}|${v.gw}`;
    if (key === this.fogKey && this.fogTex) return;
    this.fogKey = key;
    const g = v.gw;
    if (!this.fogTex || this.fogTex.image.width !== g) {
      this.fogTex?.dispose();
      this.fogTex = new THREE.DataTexture(
        new Uint8Array(g * g),
        g,
        g,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      this.fogTex.wrapS = this.fogTex.wrapT = THREE.RepeatWrapping;
      this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter;
      this.bend.uFogTex.value = this.fogTex;
      this.bend.uFogSize.value = g * v.cell;
    }
    const data = this.fogTex.image.data as Uint8Array;
    const vis = v.visible[this.viewTribe];
    const exp = v.explored[this.viewTribe];
    for (let k = 0; k < data.length; k++)
      data[k] = vis[k] ? 255 : exp[k] ? 128 : 0;
    this.fogTex.needsUpdate = true;
  }

  /**
   * BACKLOG 8: override the tribe colors (style.json tribePalettes, keyed by tribe color name), or null
   * for the plain palette. Rebuilds the entity layers so units, rings and buildings repaint.
   */
  setTribeColors(over: Record<string, string> | null): void {
    this.pal = { ...this.basePal, ...(over ?? {}) };
    if (this.world) this.buildLayers(this.world);
    else this.syncBarColors([]);
  }

  /** (Re)create the entity layers for a world, with the real models when they are loaded. */
  private buildLayers(world: World): void {
    const colors = world.tribes.map((t) => t.color);
    if (this.units) disposeGroup(this.scene, this.units.group);
    this.units = new UnitLayer(
      this.unitMat,
      this.ringMat,
      world.cfg.pack.units.units.map((u) => u.id),
      this.pal,
      colors,
      this.models,
      undefined,
      this.styleRender?.unitScale,
    );
    this.units.shadows = this.contact?.units ?? null;
    this.scene.add(this.units.group);
    if (this.buildings) disposeGroup(this.scene, this.buildings.group);
    this.buildings = new BuildingLayer(
      this.propMat,
      world.cfg.pack.buildings.buildings,
      this.pal,
      colors,
      this.models,
      2048,
      this.styleRender?.buildingScale ?? 1,
    );
    this.buildings.shadows = this.contact?.buildings ?? null;
    this.scene.add(this.buildings.group);
    if (this.worship) disposeGroup(this.scene, this.worship.group);
    this.worship = new WorshipLayer(
      this.propMat,
      world.cfg.pack.buildings.worship.kinds ?? [],
      this.pal,
      colors,
      this.models,
      64,
      bendMaterial(new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }), this.bend),
    );
    this.scene.add(this.worship.group);
    this.syncBarColors(colors);
  }

  /** Health bar fill colors from the tribe palette in force. */
  private syncBarColors(colors: string[]): void {
    this.healthBars.setColors(
      colors.map((c) => new THREE.Color(this.pal[c] ?? "#ffffff")),
      new THREE.Color(this.pal.cloth ?? "#d9cbb0"),
    );
  }

  /** Settings Health bars: "damaged" (default), "always" or "off". */
  setHealthBars(mode: HealthBarMode | string): void {
    this.healthBars.mode = mode === "always" || mode === "off" ? mode : "damaged";
  }

  /** Settings Ambient life: chimney smoke, birds, fireflies, walking dust, water glints and Hearth firelight on or off. */
  setAmbientLife(on: boolean): void {
    this.ambient.enabled = on;
  }

  /**
   * The cursor over the canvas in CSS pixels (null when it leaves or is over the HUD). The pick runs at
   * most once per frame inside render(): the nearest drawn unit within a few pixels, else the drawn
   * building under the terrain point (the terrain ray only re-marches when the cursor or camera moved).
   */
  setHover(p: { x: number; y: number } | null): void {
    this.hoverAt = p;
  }

  /** The entity the hover ring is on and how the viewer relates to it, or null (debug summary, e2e). */
  hovered(): { index: number; relation: Relation } | null {
    return this.hoverHit;
  }

  /** Pick the hovered entity and place the hover ring (once per frame, after the layers updated). */
  private updateHover(w: World): void {
    const at = this.hoverAt;
    if (!at || this.hideOverlays || this.cam.map) {
      this.hoverHit = null;
      this.hoverRing.show(null);
      return;
    }
    const L = this.hoverRing.look;
    let i = this.units ? unitUnder(this.units, at.x, at.y, L.pickPx) : -1;
    let r = 0;
    let x = 0;
    let z = 0;
    let y = 0;
    if (i >= 0 && this.units) {
      const u = this.units;
      r = L.unitRadius * (u.scaleOf(w.ents.type[i]) / 1.3);
      x = u.drawX[i];
      z = u.drawZ[i];
      y = u.drawGround[i] + 0.05;
    } else if (this.buildings) {
      const c = this.cam;
      const key = `${at.x}|${at.y}|${c.x}|${c.z}|${c.yaw}|${c.zoom}|${w.terrain.version}`;
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        const p = this.pickTerrain(at.x, at.y);
        this.hoverBuilding = p ? buildingUnder(w, this.buildings, p.x, p.z) : -1;
      }
      const b = this.hoverBuilding;
      const B = this.buildings;
      let drawn = false;
      for (let d = 0; d < B.drawn && b >= 0; d++) if (B.drawnIdx[d] === b) drawn = true;
      if (drawn && w.ents.alive[b]) {
        i = b;
        const [fw, fh] = w.cfg.pack.buildings.buildings[w.ents.type[b]].footprint;
        r = (Math.max(fw, fh) / 2) * 1.15 + 0.35;
        x = B.drawX[b];
        z = B.drawZ[b];
        y = B.drawGround[b] + 0.06;
      }
    }
    if (i < 0) {
      this.hoverHit = null;
      this.hoverRing.show(null);
      return;
    }
    const relation = relationOf(w, i, this.viewTribe);
    this.hoverHit = { index: i, relation };
    this.hoverRing.show({ x, y, z, r, rel: relation });
  }

  /**
   * Load the real GLB models (id to URL) and swap them in for the placeholders. The game never waits:
   * placeholders draw until this resolves, and an id that fails to load keeps its placeholder.
   */
  async loadModels(
    urls: Readonly<Record<string, string>>,
    fetchBytes?: (url: string) => Promise<ArrayBuffer>,
  ): Promise<ModelStatus> {
    this.modelsPending = true;
    try {
      const { models, report } = await loadModels(
        urls,
        this.basePal.azure ?? "#2e6fd8",
        fetchBytes,
      );
      applyModelFixes(models, this.styleRender?.modelFix);
      this.models = models;
      this.modelReport = report;
      for (const m of this.trees.meshes) {
        this.scene.remove(m);
        m.dispose();
      }
      this.trees = new TreeLayer(
        this.propMat,
        this.pal,
        this.models,
        8192,
        this.styleRender?.trees,
      );
      this.trees.shadows = this.contact?.trees ?? null;
      for (const m of this.trees.meshes) this.scene.add(m);
      if (this.styleRender?.decor?.enabled ?? true) {
        if (this.decor) for (const m of this.decor.meshes) this.scene.remove(m);
        this.decor?.dispose();
        this.decor = new DecorLayer(this.propMat, this.models, this.styleRender?.decor);
        this.decor.shadows = this.contact?.decor ?? null;
        for (const m of this.decor.meshes) this.scene.add(m);
      }
      if (this.world) this.buildLayers(this.world);
    } finally {
      this.modelsPending = false;
    }
    return this.modelStatus();
  }

  modelStatus(): ModelStatus {
    const drawn = [
      ...this.trees.modelIds,
      ...(this.units?.modelIds ?? []),
      ...(this.buildings?.modelIds ?? []),
      ...(this.worship?.modelIds ?? []),
      ...(this.decor?.modelIds ?? []),
    ];
    return {
      pending: this.modelsPending,
      loaded: this.modelReport?.loaded ?? [],
      failed: this.modelReport?.failed ?? [],
      drawn: [...new Set(drawn)].sort(),
    };
  }

  /** look v3: re-upload the per-cell water depth texture after any terrain change (S4: only the dirty rects' cells are refilled when given) */
  private syncDepth(rects?: readonly { x: number; y: number; w: number; h: number }[]): void {
    const t = this.world!.terrain;
    const n = t.size;
    if (!this.depthTex || this.depthTex.image.width !== n) {
      rects = undefined;
      this.depthTex?.dispose();
      this.depthTex = new THREE.DataTexture(
        new Float32Array(n * n),
        n,
        n,
        THREE.RedFormat,
        THREE.FloatType,
      );
      this.depthTex.wrapS = this.depthTex.wrapT = THREE.RepeatWrapping;
      // float textures filter linearly only with OES_texture_float_linear; nearest is a safe fallback
      this.depthTex.magFilter = this.depthTex.minFilter =
        this.gl.extensions.has("OES_texture_float_linear")
          ? THREE.LinearFilter
          : THREE.NearestFilter;
      this.waterMat.uniforms.uDepthTex.value = this.depthTex;
      this.waterMat.uniforms.uDepthSize.value = n;
    }
    if (rects) fillDepthRects(t, this.depthTex.image.data as Float32Array, rects);
    else fillDepth(t, this.depthTex.image.data as Float32Array);
    this.depthTex.needsUpdate = true;
  }

  private rebuildAll(): void {
    const t = this.world!.terrain;
    this.syncDepth();
    for (const c of this.chunks) c.build(t, this.palette);
    this.cursor = t.version;
    this.stats.fullRebuilds++;
    this.stats.remeshTotal += this.chunks.length;
    this.stats.lastRemesh = this.chunks.length;
  }

  /** BACKLOG 45: draw a red marker at the target of this failed or abandoned player order when it is consumed. */
  markFailedOrder(e: import("@hearthfall/sim").SimEvent): void {
    this.vfx.failedOrders.add(e);
  }

  /** Feed sim events (collected per tick by the app) to the VFX layer. */
  consumeEvents(
    events: readonly import("@hearthfall/sim").SimEvent[],
    timeOf: (e: import("@hearthfall/sim").SimEvent) => number,
  ): void {
    if (this.world)
      this.vfx.consume(events, this.world, timeOf, this.palette.heightScale);
    this.units?.consume(events, timeOf);
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
    const touched = chunksTouched(rects, t.size);
    for (const i of touched) this.chunks[i].build(t, this.palette);
    this.syncDepth(rects);
    this.cursor = t.version;
    this.stats.remeshTotal += touched.size;
    this.stats.lastRemesh = touched.size;
    return touched.size;
  }

  setCamera(s: Partial<CameraState> | string): void {
    const patch = typeof s === "string" ? (CAMERA_PRESETS[s] ?? {}) : s;
    this.cam = { ...this.cam, ...patch };
    const size = this.world?.terrain.size ?? 128;
    this.cam.x = ((this.cam.x % size) + size) % size;
    this.cam.z = ((this.cam.z % size) + size) % size;
  }

  /**
   * BACKLOG 14a: tilt-shift miniature focus. `mode` is "default" (style.json defaultOn), "on" (style
   * order), "off", "pre" or "post" (an explicit order, for shots and the URL param).
   */
  setTiltShift(mode: string): void {
    this.retro.setOptions({
      tilt: resolveTilt(this.styleRender?.tiltShift, mode),
    });
    this.resize(this.viewW, this.viewH);
  }

  /** Retro pixel size override (URL `pixel`, look comparisons); null restores style.json. */
  setPixelScale(n: number | null): void {
    const ps = Math.max(1, Math.round(n ?? this.styleRender?.pixelScale ?? 1));
    this.retro.setOptions({ pixelScale: ps });
    this.applyStrokeLook(ps);
    this.resize(this.viewW, this.viewH);
  }

  /** Crisp (pixel scale 1) draws soft tapered foam strokes, Retro keeps the hard ones (style.json render.water). */
  private applyStrokeLook(pixelScale: number): void {
    const v = strokeLookFor(this.styleRender?.water, pixelScale === 1);
    (this.waterMat.uniforms.uStrokeLook.value as THREE.Vector3).set(v[0], v[1], v[2]);
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
    else
      this.gl.setSize(
        Math.max(1, Math.round(w * s)),
        Math.max(1, Math.round(h * s)),
        false,
      );
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Where the world is drawn around. Map view snaps it to a chunk corner, so the terrain chunks (each placed
   * within half a world of it) tile exactly the world square the map camera frames (BACKLOG 37/40).
   */
  private drawFocus(): [number, number] {
    if (!this.cam.map) return [this.cam.x, this.cam.z];
    return [Math.round(this.cam.x / CHUNK) * CHUNK, Math.round(this.cam.z / CHUNK) * CHUNK];
  }

  /** The camera the scene is drawn and picked through: the orthographic map camera in map view. */
  get view(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.cam.map ? this.mapCam : this.camera;
  }

  render(visualTime: number): void {
    const t0 = performance.now();
    this.gl.info.reset();
    this.time.value = visualTime;
    this.syncTerrain();
    const w = this.world;
    const r = this.syncCamera();
    const [fx, fz] = this.drawFocus();
    if (w && r) {
      const size = w.terrain.size;
      const half = size / 2;
      this.bend.uFadeEnd.value = this.cam.map ? 1e6 : half - 2;
      this.bend.uFadeStart.value = this.cam.map ? 1e6 : half - 14;
      const fog = this.scene.fog as THREE.Fog;
      fog.near = r.fogNear;
      fog.far = r.fogFar;
      for (const c of this.chunks) c.place(fx, fz, size);
      this.syncFog(w);
      this.trees.update(w, fx, fz, this.palette.heightScale);
      this.groundDetail?.update(w, fx, fz, this.palette.heightScale, this.cam.zoom, this.cam.map);
      this.decor?.update(w, fx, fz, this.palette.heightScale, this.cam.zoom, this.cam.map);
      this.buildings?.update(
        w,
        fx,
        fz,
        this.palette.heightScale,
      );
      this.worship?.update(w, fx, fz, this.palette.heightScale);
      this.units?.update(
        w,
        this.alpha,
        fx,
        fz,
        this.palette.heightScale,
        visualTime,
        this.bend.uFadeEnd.value,
        this.view,
        this.bend.uBendK.value,
        this.viewW,
        this.viewH,
        this.selected,
      );
      this.stats.unitsDrawn = this.units?.drawn ?? 0;
      if (this.hideOverlays || this.cam.map) this.healthBars.clear();
      else
        this.healthBars.update(w, this.units, this.buildings, this.view, r.distance, this.cam.zoom, this.viewTribe, this.revealFog);
      this.updateHover(w);
      this.ambient.update(
        w,
        visualTime,
        fx,
        fz,
        this.palette.heightScale,
        this.bend.uFadeEnd.value,
        this.cam.zoom,
        this.cam.map,
        this.lightingName,
        (this.lighting?.rain ?? null) !== null,
        this.units,
        this.buildings,
        this.viewTribe,
        this.revealFog,
        this.lighting?.hearthGlow ?? 1,
      );
      this.syncGlints();
      this.vfx.update(
        w,
        visualTime,
        fx,
        fz,
        this.palette.heightScale,
      );
      this.sun.target.position.set(fx, 0, fz);
      const d = this.lighting?.sunDir ?? [0.4, 0.8, 0.25];
      const k = 95 / Math.hypot(d[0], d[1], d[2]);
      this.sun.position.set(
        fx + d[0] * k,
        d[1] * k,
        fz + d[2] * k,
      );
      this.rain.update(
        fx,
        w.terrain.heightAt(fx, fz) * this.palette.heightScale,
        fz,
        visualTime,
      );
    }
    this.placeHearthLights(visualTime);
    this.sky.visible = !this.cam.map && this.scene.visible;
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar((this.camera.far * 0.9) / 900);
    const view = this.view;
    if (r)
      this.retro.setFocus(
        r.distance,
        view.near,
        view.far,
        !this.cam.map,
      );
    if (this.retro.enabled && this.scene.visible)
      this.retro.render(this.gl, this.scene, view);
    else this.gl.render(this.scene, view);
    this.frames++;
    this.stats.frames = this.frames;
    this.stats.drawCalls = this.gl.info.render.calls;
    this.stats.triangles = this.gl.info.render.triangles;
    this.stats.cpuMs = performance.now() - t0;
  }

  /**
   * Ambient life: sun or moon glints on the water under the preset in force (style.json render.ambient.glints),
   * none in rain by default, with the setting off, in the map view, past maxZoom or below the quality floor.
   */
  private syncGlints(): void {
    const L = this.ambient.look;
    const on = this.ambient.enabled && !this.cam.map && this.cam.zoom <= L.maxZoom;
    const g = glintFor(L.glints, this.lightingName, (this.lighting?.rain ?? null) !== null, on, this.renderScale);
    const u = this.waterMat.uniforms;
    const c = this.glintColor.set(g.color);
    u.uGlint.value.set(c.r, c.g, c.b, g.strength);
    u.uGlintLook.value.set(L.glints.cell, L.glints.rate, L.glints.near, L.glints.density);
  }

  /** Warm firelight on up to four Hearths nearest the camera focus (wrapped near the focus). */
  private placeHearthLights(t = 0): void {
    const w = this.world;
    for (const l of this.hearthLights) l.intensity = 0;
    if (!w) return;
    const n = w.terrain.size;
    const E = w.ents;
    const rs = this.styleRender;
    const found: { i: number; d: number; x: number; z: number; y: number }[] = [];
    for (const t of w.tribes) {
      const h = E.index(t.hearth);
      if (h < 0) continue;
      let ox = E.x[h] - this.cam.x;
      let oz = E.y[h] - this.cam.z;
      ox -= Math.round(ox / n) * n;
      oz -= Math.round(oz / n) * n;
      const y =
        Math.max(w.terrain.heightAt(E.x[h], E.y[h]), w.terrain.sea) *
        this.palette.heightScale;
      found.push({
        i: h,
        d: ox * ox + oz * oz,
        x: this.cam.x + ox,
        z: this.cam.z + oz,
        y,
      });
    }
    found.sort((a, b) => a.d - b.d);
    // ambient life: while the fires are lit (evening and night) the light flickers in step with the glow pool
    const flick = this.ambient.fire > 0;
    found.slice(0, this.hearthLights.length).forEach((f, k) => {
      const l = this.hearthLights[k];
      l.position.set(f.x, f.y + 1.2 - this.bend.uBendK.value * f.d, f.z);
      l.intensity =
        (rs?.hearthLight.intensity ?? 14) *
        (this.lighting?.hearthGlow ?? 1) *
        (flick ? hearthFlicker(t, f.i, this.ambient.look.fire) : 1);
    });
  }

  /** Spell targeting preview: range ring around the Shaper and the effect area at the cursor. */
  setTargeting(
    t: {
      cx: number;
      cz: number;
      range: number;
      x: number;
      z: number;
      r: number;
      inRange: boolean;
    } | null,
  ): void {
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
      m.position.set(
        this.cam.x + ox,
        Math.max(
          w.terrain.heightAt(((x % n) + n) % n, ((z % n) + n) % n),
          w.terrain.sea,
        ) *
          s +
          0.15,
        this.cam.z + oz,
      );
      m.scale.set(r, 1, r);
      m.visible = true;
    };
    place(this.rangeRing, t.cx, t.cz, t.range);
    place(this.areaRing, t.x, t.z, t.r);
    (this.areaRing.material as THREE.MeshBasicMaterial).color.set(
      t.inRange ? "#ffd23a" : "#e0a12a",
    );
  }

  /** Order feedback: a closing ring at grid point (x, z) where the player just sent units. */
  markOrder(x: number, z: number, kind: import("./vfx.ts").OrderMark): void {
    this.vfx.markOrder(x, z, kind);
  }

  /** Show the rally flag at grid point (x, z), or hide it with null. */
  setRally(p: { x: number; z: number } | null): void {
    if (!p || !this.world) {
      this.rally.visible = false;
      return;
    }
    const t = this.world.terrain;
    let ox = p.x - this.cam.x;
    let oz = p.z - this.cam.z;
    ox -= Math.round(ox / t.size) * t.size;
    oz -= Math.round(oz / t.size) * t.size;
    const h = Math.max(t.sea, t.get(Math.round(p.x), Math.round(p.z)));
    this.rally.position.set(this.cam.x + ox, h * this.palette.heightScale, this.cam.z + oz);
    this.rally.visible = true;
  }

  /** Show or hide the building placement ghost (footprint quad, green when buildable, red when not). */
  setPlacement(
    p: { x: number; z: number; w: number; h: number; ok: boolean } | null,
  ): void {
    if (!p || !this.world) {
      this.ghost.visible = false;
      return;
    }
    const t = this.world.terrain;
    let top = t.sea;
    for (let y = 0; y <= p.h; y++)
      for (let x = 0; x <= p.w; x++)
        top = Math.max(
          top,
          t.get(Math.round(p.x - p.w / 2) + x, Math.round(p.z - p.h / 2) + y),
        );
    this.ghost.visible = true;
    this.ghost.scale.set(p.w + 0.4, 1, p.h + 0.4);
    let ox = p.x - this.cam.x;
    let oz = p.z - this.cam.z;
    const n = t.size;
    ox -= Math.round(ox / n) * n;
    oz -= Math.round(oz / n) * n;
    this.ghost.position.set(
      this.cam.x + ox,
      top * this.palette.heightScale + 0.08,
      this.cam.z + oz,
    );
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(
      p.ok ? "#8dbf5a" : "#c8312e",
    );
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
    const focusY =
      Math.max(t.heightAt(this.cam.x, this.cam.z), t.sea) *
      this.palette.heightScale;
    const r = applyCamera(this.camera, this.cam, focusY, t.size, this.rig);
    this.bend.uBendK.value = r.bendK;
    this.bend.uBendFocus.value.set(this.cam.x, this.cam.z);
    this.camera.updateMatrixWorld();
    this.mapFrame.visible = this.cam.map;
    if (this.cam.map) this.fitMapCamera(t.size, focusY);
    return r;
  }

  /**
   * BACKLOG 37/40: fit the orthographic map camera so the whole world square shows with a small margin,
   * whatever the window aspect, and place the frame (masks past the world edge, grid) around it.
   */
  private fitMapCamera(size: number, focusY: number): void {
    const c = this.mapCam;
    const [fx, fz] = this.drawFocus();
    const aspect = this.viewW / Math.max(1, this.viewH);
    let halfH = (size / 2) * 1.06;
    if (aspect < 1) halfH /= aspect;
    const halfW = halfH * aspect;
    c.left = -halfW;
    c.right = halfW;
    c.top = halfH;
    c.bottom = -halfH;
    c.near = 1;
    c.far = 400;
    c.position.set(fx, focusY + 150, fz);
    c.up.set(0, 0, -1);
    c.lookAt(fx, focusY, fz);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    if (this.mapFrameSize !== size) this.buildMapFrame(size);
    this.mapFrame.position.set(fx, focusY + 140, fz);
    this.mapFrame.updateMatrixWorld(true);
  }

  private buildMapFrame(size: number): void {
    for (const ch of [...this.mapFrame.children]) {
      this.mapFrame.remove(ch);
      const m = ch as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.mapFrameSize = size;
    const half = size / 2;
    const far = size * 4;
    const mask = new THREE.MeshBasicMaterial({ color: this.styleRender?.mapFrame?.mask ?? "#1b2633", transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    // four bars covering everything outside the world square [-half, half]
    const bars: [number, number, number, number][] = [
      [0, -half - far / 2, far * 2 + size, far],
      [0, half + far / 2, far * 2 + size, far],
      [-half - far / 2, 0, far, size],
      [half + far / 2, 0, far, size],
    ];
    for (const [x, z, w, d] of bars) {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mask);
      m.position.set(x, 0, z);
      m.renderOrder = 51;
      m.frustumCulled = false;
      this.mapFrame.add(m);
    }
    const step = this.styleRender?.mapFrame?.gridCells ?? 16;
    const pts: number[] = [];
    for (let v = -half; v <= half + 1e-6; v += step) {
      pts.push(v, 0, -half, v, 0, half, -half, 0, v, half, 0, v);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lm = new THREE.LineBasicMaterial({ color: this.styleRender?.mapFrame?.grid ?? "#f2e6c8", transparent: true, opacity: this.styleRender?.mapFrame?.gridOpacity ?? 0.14, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const lines = new THREE.LineSegments(lg, lm);
    lines.renderOrder = 52;
    lines.frustumCulled = false;
    this.mapFrame.add(lines);
  }

  private march(
    px: number,
    py: number,
    flat: boolean,
  ): { x: number; z: number } | null {
    const w = this.world;
    if (!w) return null;
    this.syncCamera();
    const t = w.terrain;
    const n = t.size;
    const s = this.palette.heightScale;
    const ndc = new THREE.Vector2(
      (px / this.viewW) * 2 - 1,
      1 - (py / this.viewH) * 2,
    );
    const ray = new THREE.Raycaster();
    const view = this.view;
    ray.setFromCamera(ndc, view);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    const k = this.bend.uBendK.value;
    const fx = this.bend.uBendFocus.value.x;
    const fz = this.bend.uBendFocus.value.y;
    const above = (dist: number) => {
      const x = o.x + d.x * dist;
      const z = o.z + d.z * dist;
      const ground = flat
        ? t.sea * s
        : Math.max(t.heightAt(((x % n) + n) % n, ((z % n) + n) % n), t.sea) * s;
      const ddx = x - fx;
      const ddz = z - fz;
      return o.y + d.y * dist - (ground - k * (ddx * ddx + ddz * ddz));
    };
    const step = 0.4;
    const maxDist = view.far;
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

  /** Look v4: contact shadow blobs drawn per layer in the last fill (null when off; the debug look summary) */
  contactCounts(): Record<string, number> | null {
    if (!this.contact) return null;
    const out: Record<string, number> = {};
    for (const [k, c] of Object.entries(this.contact)) out[k] = c.count();
    return out;
  }

  /** Deliberate breakage for visual QA calibration (TESTING section 7, VISIONQA section 5). */
  setDebug(f: {
    hideTerrain?: boolean;
    blackCanvas?: boolean;
    magentaMaterials?: boolean;
  }): void {
    for (const c of this.chunks) {
      c.mesh.visible = !f.hideTerrain;
      c.water.visible = !f.hideTerrain;
    }
    for (const m of this.trees.meshes) m.visible = !f.hideTerrain;
    if (this.contact) for (const c of Object.values(this.contact)) c.mesh.visible = !f.hideTerrain;
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
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
      uStars: { value: stars },
    },
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
    uniforms: {
      uTop: { value: new THREE.Color(top) },
      uHorizon: { value: new THREE.Color(horizon) },
    },
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

/** A style block without its `$comment` (the layers take plain partial looks). */
function stripComment<T extends object>(o: T | undefined): Omit<T, "$comment"> {
  if (!o) return {} as Omit<T, "$comment">;
  const { $comment: _c, ...rest } = o as T & { $comment?: string };
  return rest;
}

/** Remove a replaced layer and free its GPU buffers (geometries and instance attributes; shared materials stay). */
function disposeGroup(scene: THREE.Scene, group: THREE.Object3D): void {
  scene.remove(group);
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    // shared model geometry stays uploaded across setWorld (BACKLOG 93)
    if (o instanceof THREE.Mesh && !o.geometry.userData.shared) o.geometry.dispose();
  });
}

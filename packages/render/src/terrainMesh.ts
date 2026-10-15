// Terrain and water chunks (32 x 32 cells). Terrain is non-indexed so every triangle carries its own
// color: crisp faceted bands, stepped rock strata on steep faces, scar tint (art direction ref_04).
// Only dirty chunks are rebuilt. Reads sim terrain, never writes it.
import * as THREE from "three";
import type { Terrain } from "@hearthfall/sim";
import { BEND_FRAGMENT_FADE, BEND_FRAGMENT_PARS, BEND_PROJECT_VERTEX, BEND_VERTEX_PARS, type BendUniforms } from "./curve.ts";

export const CHUNK = 32;

export interface TerrainPalette {
  sand: THREE.Color;
  sandWet: THREE.Color;
  meadow: THREE.Color;
  moss: THREE.Color;
  forest: THREE.Color;
  rock: THREE.Color;
  rockDark: THREE.Color;
  snow: THREE.Color;
  scar: THREE.Color;
  water: THREE.Color;
  waterShallow: THREE.Color;
  foam: THREE.Color;
  /** brown earth on steep faces (look v2 terraced cliffs) */
  cliff: THREE.Color;
  cliffDark: THREE.Color;
  bands: { shore: number; lowland: number; grass: number; highland: number; rock: number; peak: number };
  /** look v3 bands (BACKLOG 14a-4, style.json render.terrainBands); omitted = the look v2 bands */
  look?: TerrainBandsLook;
  heightScale: number;
  maxWalkSlope: number;
}

/**
 * BACKLOG 14a-4: snow caps from snowStart (first flecks) to snowFull (solid) in height units, and terrace
 * cliffs whose middle stratum is pale sandstone (strataSand is its sand share, 0 = plain earth).
 */
export interface TerrainBandsLook {
  snowStart: number;
  snowFull: number;
  strataSand: number;
  /** snow brightness over the palette color, with a slight cool tint, so caps stay white under the warm sun */
  snowBright: number;
  /** per channel multiplier of the snow color (before snowBright); counters the warm sun so caps read white. Default SNOW_TINT_DEFAULT. */
  snowTint?: readonly [number, number, number];
  /** cliff tint starts at this share of maxWalkSlope (default 0.85) */
  cliffStart?: number;
  /** cliff tint share at cliffStart (default 0.5: a hard step); lower values fade slopes in instead */
  cliffFloor?: number;
  /** slope span (in maxWalkSlope units) over which the cliff tint grows to full (default 0.4) */
  cliffFade?: number;
  /** per triangle brightness jitter (default 0.12: faces vary from 0.93 to 1.05) */
  faceJitter?: number;
}

export const SNOW_TINT_DEFAULT: readonly [number, number, number] = [0.97, 1, 1.06];

const tmp = new THREE.Color();
const tmp2 = new THREE.Color();
const tmp3 = new THREE.Color();

function faceHash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Color of one terrain triangle from its three vertex heights. */
export function faceColor(p: TerrainPalette, sea: number, h0: number, h1: number, h2: number, scar: number, seed: number, out: THREE.Color, cellSpan = -1): THREE.Color {
  // slope is judged per cell (both triangles agree) so steep cones do not checker
  const span = cellSpan >= 0 ? cellSpan : Math.max(h0, h1, h2) - Math.min(h0, h1, h2);
  const b = p.bands;
  // dither the height used for banding so band borders break up into facets instead of hard lines
  const avg = (h0 + h1 + h2) / 3 + (faceHash(seed * 3 + 7) - 0.5) * 22;
  const stops: [number, THREE.Color][] = [
    [sea, p.sand],
    [b.shore, p.sand],
    [b.shore + 14, tmp2.copy(p.meadow).lerp(p.sand, 0.3)],
    [b.grass, p.meadow],
    [b.highland, p.moss],
    [b.rock - 30, p.forest],
    [b.rock, p.rock],
    [p.look ? p.look.snowStart : b.peak - 20, p.rock],
    [p.look ? p.look.snowFull : b.peak + 10, p.snow],
  ];
  const st = p.look?.snowTint ?? SNOW_TINT_DEFAULT;
  const snow = p.look ? tmp3.copy(p.snow).multiply(tmp.setRGB(p.look.snowBright * st[0], p.look.snowBright * st[1], p.look.snowBright * st[2])) : p.snow;
  stops[stops.length - 1][1] = snow;
  if (avg < sea) out.copy(p.sandWet).lerp(p.water, Math.min(1, (sea - avg) / 60));
  else if (avg >= stops[stops.length - 1][0]) out.copy(snow);
  else {
    let k = 1;
    while (k < stops.length - 1 && avg >= stops[k][0]) k++;
    const [h0s, c0] = stops[k - 1];
    const [h1s, c1] = stops[k];
    const f = h1s > h0s ? Math.min(1, Math.max(0, (avg - h0s) / (h1s - h0s))) : 1;
    out.copy(c0).lerp(c1, f * f * (3 - 2 * f));
  }
  // steep faces turn to brown earth cliffs with layered strata (rock above the rock band)
  const cs = p.look?.cliffStart ?? 0.85;
  if (avg >= sea && span > p.maxWalkSlope * cs) {
    const layer = Math.floor(avg / 14) % 3;
    const high = avg >= b.rock - 10;
    tmp.copy(high ? p.rock : p.cliff).lerp(high ? p.rockDark : p.cliffDark, layer === 0 ? 0.65 : layer === 1 ? 0.2 : 0.4);
    // look v3: the middle stratum of earth cliffs reads as a pale sandstone band
    if (p.look && !high && layer === 1) tmp.lerp(p.sand, p.look.strataSand);
    out.lerp(tmp, Math.min(0.95, (p.look?.cliffFloor ?? 0.5) + (span - p.maxWalkSlope * cs) / (p.maxWalkSlope * (p.look?.cliffFade ?? 0.4))));
  }
  if (scar > 0) out.lerp(p.scar, Math.min(0.85, scar / 60));
  const fj = p.look?.faceJitter ?? 0.12;
  const j = 0.99 - fj / 2 + fj * faceHash(seed);
  return out.multiplyScalar(j);
}

/**
 * Chunk indices (cz * n + cx) a set of dirty rects touches on a wrapped map of `size` cells. A rect covers its
 * cells plus the vertex row and column after it (a height edit also moves the faces that share that vertex),
 * and wraps across the map edges.
 */
export function chunksTouched(rects: readonly { x: number; y: number; w: number; h: number }[], size: number): Set<number> {
  const n = size / CHUNK;
  const touched = new Set<number>();
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h + 1; y += 1) {
      const cz = Math.floor((((y % size) + size) % size) / CHUNK);
      for (let x = r.x; x < r.x + r.w + 1; x += 1) touched.add(cz * n + Math.floor((((x % size) + size) % size) / CHUNK));
    }
  }
  return touched;
}

export class TerrainChunk {
  readonly mesh: THREE.Mesh;
  readonly water: THREE.Mesh;
  readonly cx: number;
  readonly cz: number;
  /** true when the last build saw any scarred vertex (re-tinted as scars heal) */
  hasScar = false;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly wDepth: Float32Array;
  private readonly wPos: Float32Array;

  constructor(cx: number, cz: number, terrainMat: THREE.Material, waterMat: THREE.Material) {
    this.cx = cx;
    this.cz = cz;
    const verts = CHUNK * CHUNK * 6;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Mesh(g, terrainMat);
    this.mesh.frustumCulled = false;
    // water: a tessellated grid (2 cells per segment) so it can bend
    const seg = CHUNK / 2;
    const wg = new THREE.PlaneGeometry(CHUNK, CHUNK, seg, seg);
    wg.rotateX(-Math.PI / 2);
    wg.translate(CHUNK / 2, 0, CHUNK / 2);
    this.wPos = wg.getAttribute("position").array as Float32Array;
    this.wDepth = new Float32Array(wg.getAttribute("position").count);
    wg.setAttribute("aDepth", new THREE.BufferAttribute(this.wDepth, 1));
    this.water = new THREE.Mesh(wg, waterMat);
    this.water.frustumCulled = false;
    this.water.renderOrder = 1;
  }

  /** Rebuild geometry and colors from the sim terrain. */
  build(t: Terrain, p: TerrainPalette): void {
    const s = p.heightScale;
    const x0 = this.cx * CHUNK;
    const z0 = this.cz * CHUNK;
    let v = 0;
    const put = (lx: number, lz: number, h: number, c: THREE.Color) => {
      this.pos[v * 3] = lx;
      this.pos[v * 3 + 1] = h * s;
      this.pos[v * 3 + 2] = lz;
      this.col[v * 3] = c.r;
      this.col[v * 3 + 1] = c.g;
      this.col[v * 3 + 2] = c.b;
      v++;
    };
    const c = new THREE.Color();
    this.hasScar = false;
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const gx = x0 + x;
        const gz = z0 + z;
        const a = t.get(gx, gz);
        const b = t.get(gx + 1, gz);
        const d = t.get(gx, gz + 1);
        const e = t.get(gx + 1, gz + 1);
        const sc = t.scar[t.idx(gx, gz)];
        if (sc > 0) this.hasScar = true;
        const seed = gx * 7919 + gz * 104729;
        const cs = Math.max(a, b, d, e) - Math.min(a, b, d, e);
        if (((gx + gz) & 1) === 0) {
          faceColor(p, t.sea, a, d, b, sc, seed, c, cs);
          put(x, z, a, c);
          put(x, z + 1, d, c);
          put(x + 1, z, b, c);
          faceColor(p, t.sea, b, d, e, sc, seed + 1, c, cs);
          put(x + 1, z, b, c);
          put(x, z + 1, d, c);
          put(x + 1, z + 1, e, c);
        } else {
          faceColor(p, t.sea, a, e, b, sc, seed, c, cs);
          put(x, z, a, c);
          put(x + 1, z + 1, e, c);
          put(x + 1, z, b, c);
          faceColor(p, t.sea, a, d, e, sc, seed + 1, c, cs);
          put(x, z, a, c);
          put(x, z + 1, d, c);
          put(x + 1, z + 1, e, c);
        }
      }
    }
    const g = this.mesh.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    // water depth per vertex for shoreline foam and shallow color
    for (let i = 0; i < this.wDepth.length; i++) {
      const wx = this.wPos[i * 3];
      const wz = this.wPos[i * 3 + 2];
      this.wDepth[i] = t.sea - t.heightAt(x0 + wx, z0 + wz);
      this.wPos[i * 3 + 1] = t.sea * s;
    }
    (this.water.geometry.getAttribute("aDepth") as THREE.BufferAttribute).needsUpdate = true;
    (this.water.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Place this chunk at the wrapped copy nearest the focus (world units, one cell = one unit). */
  place(focusX: number, focusZ: number, worldSize: number): void {
    let ox = this.cx * CHUNK + CHUNK / 2 - focusX;
    let oz = this.cz * CHUNK + CHUNK / 2 - focusZ;
    ox -= Math.round(ox / worldSize) * worldSize;
    oz -= Math.round(oz / worldSize) * worldSize;
    const px = focusX + ox - CHUNK / 2;
    const pz = focusZ + oz - CHUNK / 2;
    this.mesh.position.set(px, 0, pz);
    this.water.position.set(px, 0, pz);
  }
}

/** look v3 painted water knobs (style.json render.water, BACKLOG 14a); depths in height units */
export interface WaterLook {
  /** depth where the shallow color has fully turned deep */
  shallowDepth: number;
  /** width of the pale shore foam line */
  foamWidth: number;
  /** depth of the second, fainter foam ring that pulses offshore (0 turns it off) */
  foamRing: number;
  /** S4: ring cycles per second (absent 0.12) and its width as a share of foamWidth (absent 0.35) */
  ringDrift?: number;
  ringWidth?: number;
  /** foam stroke half width (share of a stroke row, absent 0.2) and opacity (absent 0.9) in the Crisp look; Retro keeps 0.2 and 0.9 */
  strokeWidthCrisp?: number;
  strokeAlphaCrisp?: number;
}

/** Foam stroke look for the water material: half width, opacity and taper (1 = soft tapered brush strokes, 0 = the retro hard strokes). */
export function strokeLookFor(look: WaterLook | undefined, crisp: boolean): [number, number, number] {
  if (!crisp) return [0.2, 0.9, 0];
  return [look?.strokeWidthCrisp ?? 0.2, look?.strokeAlphaCrisp ?? 0.9, 1];
}

export const WATER_LOOK_V2: WaterLook = { shallowDepth: 30, foamWidth: 10, foamRing: 0 };

/**
 * Per-cell water depth (sea minus height, height units) for the water shader, row-major x then z like
 * the heightmap; sampled per fragment with linear filtering and repeat wrap (the torus).
 */
export function fillDepth(t: Terrain, out: Float32Array): Float32Array {
  const n = t.size;
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out[z * n + x] = t.sea - t.get(x, z);
  return out;
}

/**
 * S4 (14c): refill only the cells the dirty rects cover (wrapped, edges inclusive like chunksTouched);
 * returns how many cells were written. A rect as wide or tall as the map refills whole rows or columns.
 */
export function fillDepthRects(t: Terrain, out: Float32Array, rects: readonly { x: number; y: number; w: number; h: number }[]): number {
  const n = t.size;
  let written = 0;
  for (const r of rects) {
    const h = Math.min(n, r.h + 1);
    const w = Math.min(n, r.w + 1);
    for (let dy = 0; dy < h; dy++) {
      const z = (((r.y + dy) % n) + n) % n;
      for (let dx = 0; dx < w; dx++) {
        const x = (((r.x + dx) % n) + n) % n;
        out[z * n + x] = t.sea - t.get(x, z);
        written++;
      }
    }
  }
  return written;
}

/** Water: depth-tinted shallows, shoreline foam and (look v2) world-anchored drifting foam strokes. */
export function makeWaterMaterial(p: TerrainPalette, bend: BendUniforms, time: { value: number }, strokes = 0, look: WaterLook = WATER_LOOK_V2): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uDeep: { value: p.water.clone() },
        uShallow: { value: p.waterShallow.clone() },
        uFoam: { value: p.foam.clone() },
        uSun: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
        uStrokes: { value: strokes },
        uDepthTex: { value: new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 2, 2, THREE.RedFormat, THREE.FloatType) },
        uDepthSize: { value: 0 },
        uLook: { value: new THREE.Vector3(look.shallowDepth, look.foamWidth, look.foamRing) },
        uRing: { value: new THREE.Vector2(look.ringDrift ?? 0.12, look.ringWidth ?? 0.35) },
        uStrokeLook: { value: new THREE.Vector3(0.2, 0.9, 0) },
        uLight: { value: new THREE.Color(1, 1, 1) },
        // ambient life: sun or moon glints (rgb color, w strength; 0 skips the branch) and their look
        // (cell size, twinkles per second, radius around the focus, share of lit cells); see ambient.ts glintFor
        uGlint: { value: new THREE.Vector4(1, 1, 1, 0) },
        uGlintLook: { value: new THREE.Vector4(0.9, 1.1, 24, 0.3) },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      ${BEND_VERTEX_PARS}
      uniform float uTime;
      attribute float aDepth;
      varying float vDepth;
      varying vec3 vWorld;
      void main() {
        vec3 transformed = position;
        vec4 w0 = modelMatrix * vec4(position, 1.0);
        transformed.y += 0.06 * sin(w0.x * 0.9 + uTime * 1.3) * cos(w0.z * 0.7 - uTime * 1.1);
        vDepth = aDepth;
        ${BEND_PROJECT_VERTEX}
        vWorld = hfWorld.xyz;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      ${BEND_FRAGMENT_PARS}
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uFoam;
      uniform vec3 uSun;
      uniform float uTime;
      uniform float uStrokes;
      uniform vec3 uStrokeLook;
      uniform sampler2D uDepthTex;
      uniform float uDepthSize;
      uniform vec3 uLook;
      uniform vec2 uRing;
      uniform vec3 uLight;
      uniform vec4 uGlint;
      uniform vec4 uGlintLook;
      varying float vDepth;
      float wh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      // short wave strokes: rows of cells along a slowly turning swell direction, a hashed share lit
      float strokeAt(vec2 xz, float density, float scale) {
        float a = 0.5 + 0.35 * sin(xz.x * 0.031 + xz.y * 0.027);
        vec2 dir = vec2(cos(a), sin(a));
        vec2 q = vec2(dot(xz, dir), dot(xz, vec2(-dir.y, dir.x))) * scale;
        q.x += uTime * 0.35;
        float row = floor(q.y / 0.55);
        q.x += wh(vec2(row, 3.7)) * 4.0;
        vec2 cell = vec2(floor(q.x / 1.7), row);
        float h = wh(cell);
        if (h > density) return 0.0;
        vec2 f = vec2(fract(q.x / 1.7), fract(q.y / 0.55));
        float len = 0.35 + 0.4 * wh(cell + 1.3);
        float start = 0.1 + 0.3 * wh(cell + 2.9);
        float bend = 0.16 * sin((f.x - start) / len * 3.1416);
        if (uStrokeLook.z < 0.5) return step(start, f.x) * step(f.x, start + len) * step(abs(f.y - 0.5 + bend), 0.2);
        // Crisp: a brush stroke that tapers at both ends, with soft anti-aliased edges
        float u = (f.x - start) / len;
        if (u < 0.0 || u > 1.0) return 0.0;
        float w = uStrokeLook.x * (0.25 + 0.75 * sin(u * 3.1416));
        float d = abs(f.y - 0.5 + bend);
        float aa = max(fwidth(f.y) * 1.2, 0.01);
        return 1.0 - smoothstep(w - aa, w + aa, d);
      }
      varying vec3 vWorld;
      void main() {
        if (vDepth < -2.0) discard;
        // look v3: depth per fragment from the heightmap texture (smooth shallows and a crisp foam line);
        // without it (uDepthSize 0) the coarse per-vertex depth
        float dep = uDepthSize > 0.0 ? texture2D(uDepthTex, (vWorld.xz + 0.5) / uDepthSize).r : vDepth;
        if (dep < 0.0) discard;
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        float t = smoothstep(0.0, uStrokes > 0.0 ? uLook.x : 70.0, dep);
        vec3 col = mix(uShallow, uDeep, t);
        col *= 0.82 + 0.25 * max(dot(n, uSun), 0.0);
        float wob = 0.18 * sin(vWorld.x * 1.7 + uTime * 0.8) * sin(vWorld.z * 1.3 - uTime * 0.6);
        float foam = (1.0 - smoothstep(0.0, uLook.y, dep + wob * uLook.y)) * (0.75 + 0.25 * sin(uTime * 2.2 + dep * 0.9));
        if (uLook.z > 0.0) {
          // a fainter foam ring offshore that drifts out and fades, like a painted wave line
          float ph = fract(uTime * uRing.x);
          float ring = 1.0 - smoothstep(0.0, uLook.y * uRing.y, abs(dep - uLook.z * (0.6 + 0.8 * ph) + wob * uLook.y));
          foam = max(foam, ring * 0.55 * (1.0 - ph));
        }
        col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.9);
        if (uStrokes > 0.0) {
          float near = 1.0 - smoothstep(4.0, 40.0, dep);
          float s1 = strokeAt(vWorld.xz, uStrokes * (0.3 + 0.4 * near), 0.42);
          float s2 = strokeAt(vWorld.xz + 31.7, uStrokes * 0.45, 0.33);
          col = mix(col, uFoam, s1 * uStrokeLook.y);
          col = mix(col, uDeep * 0.7, s2 * (1.0 - s1) * 0.5);
        }
        // BACKLOG 14: the lighting preset and weather tint the water and its foam (white under the default preset)
        col *= uLight;
        float alpha = mix(0.72, 0.94, t);
        if (uGlint.w > 0.0 && vBendDist < uGlintLook.z) {
          // ambient life: a hashed share of world-anchored cells each hold one sparkle that twinkles on its own
          // beat, off the foam line and fading out toward the edge of the radius around the camera focus
          vec2 gq = vWorld.xz / uGlintLook.x;
          vec2 gc = floor(gq);
          float gh = wh(gc + 7.31);
          if (gh < uGlintLook.w) {
            vec2 go = (vec2(wh(gc + 1.7), wh(gc + 4.3)) - 0.5) * 0.5;
            float gd = 1.0 - smoothstep(0.06, 0.2, length(fract(gq) - 0.5 - go));
            float tw = max(sin(uTime * uGlintLook.y * (0.6 + 0.8 * wh(gc + 9.9)) * 6.2832 + gh * 40.0), 0.0);
            tw *= tw; tw *= tw; tw *= tw;
            float gnear = 1.0 - smoothstep(uGlintLook.z * 0.45, uGlintLook.z, vBendDist);
            float gopen = smoothstep(uLook.y * 0.6, uLook.y * 1.4, dep);
            float g = uGlint.w * gd * tw * gnear * gopen;
            col += uGlint.rgb * g;
            alpha = max(alpha, g);
          }
        }
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        ${BEND_FRAGMENT_FADE}
      }`,
  });
  // shared uniform objects (merge() clones, so attach the live ones afterwards)
  Object.assign(mat.uniforms, bend, { uTime: time });
  return mat;
}

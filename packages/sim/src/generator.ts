// Procedural planet generator: seeded tileable fbm heights, Hearth sites on one connected walkable
// landmass (DESIGN section 11), trees by height band and clusters, wild people near each Hearth.
// Also the tiny handmade test maps used by scenarios (flat, flat_with_channel).
import type { SimConfig } from "./config.ts";
import { bandOf } from "./config.ts";
import { cos, sin, TWO_PI } from "./dmath.ts";
import { fbm, valueNoise } from "./noise.ts";
import { Rng } from "./rng.ts";
import { Terrain, wrap, wrapDelta } from "./terrain.ts";

export interface MapSpec {
  /** "continents" | "islands" (data presets) or a test map: "flat" | "flat_with_channel" */
  generator: string;
  size: number;
  /** number of tribes needing Hearth sites (procedural maps only) */
  tribes?: number;
  /** flat maps: land height above sea (default 40) */
  landAboveSea?: number;
  /** flat maps (levels, M9): shapes painted over the base height in order */
  paint?: PaintSpec[];
}

/** A disc (r) or rectangle (size) set to sea + aboveSea, blended into its surroundings over `falloff` cells. */
export interface PaintSpec {
  shape: "disc" | "rect";
  at: [number, number];
  r?: number;
  size?: [number, number];
  aboveSea: number;
  falloff?: number;
}

function paintShape(t: Terrain, sea: number, p: PaintSpec): void {
  const n = t.size;
  const fall = p.falloff ?? 3;
  const target = sea + p.aboveSea;
  const hx = p.shape === "disc" ? (p.r ?? 4) : (p.size?.[0] ?? 8) / 2;
  const hy = p.shape === "disc" ? (p.r ?? 4) : (p.size?.[1] ?? 8) / 2;
  const reach = Math.ceil(Math.max(hx, hy) + fall) + 1;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = Math.round(p.at[0]) + dx;
      const y = Math.round(p.at[1]) + dy;
      const ox = x - p.at[0];
      const oy = y - p.at[1];
      // distance outside the shape (0 inside)
      const out = p.shape === "disc" ? Math.sqrt(ox * ox + oy * oy) - hx : Math.max(Math.abs(ox) - hx, Math.abs(oy) - hy, 0);
      const i = t.idx(wrap(x, n), wrap(y, n));
      if (out <= 0) t.heights[i] = target;
      else if (out < fall) {
        const k = 1 - out / fall;
        t.heights[i] = Math.round(t.heights[i] + (target - t.heights[i]) * k);
      }
    }
  }
}

export interface GeneratedMap {
  terrain: Terrain;
  seedUsed: number;
  rerolls: number;
  hearths: { x: number; y: number }[];
  trees: { x: number; y: number }[];
  wild: { tribe: number; x: number; y: number }[];
  landFraction: number;
}

function newTerrain(cfg: SimConfig, size: number): Terrain {
  return new Terrain({ size, seaLevel: cfg.sea, heightMax: cfg.heightMax, drownDepth: cfg.drownDepth, maxWalkSlope: cfg.maxWalkSlope, maxBuildSlope: cfg.maxBuildSlope });
}

function testMap(cfg: SimConfig, spec: MapSpec): GeneratedMap {
  const t = newTerrain(cfg, spec.size);
  const land = cfg.sea + (spec.landAboveSea ?? 40);
  t.heights.fill(land);
  if (spec.generator === "flat_with_channel") {
    // a north-south channel of deep water at x in [size/4, size*5/16]
    const x0 = Math.floor(spec.size / 4);
    const x1 = Math.floor((spec.size * 5) / 16);
    for (let y = 0; y < spec.size; y++) for (let x = x0; x <= x1; x++) t.heights[t.idx(x, y)] = cfg.sea - 40;
  } else if (spec.generator === "flat_with_lake") {
    // a round deep lake of radius size/6 in the middle
    const c = spec.size / 2;
    const r = spec.size / 6;
    for (let y = 0; y < spec.size; y++) for (let x = 0; x < spec.size; x++) if ((x - c) * (x - c) + (y - c) * (y - c) <= r * r) t.heights[t.idx(x, y)] = cfg.sea - 40;
  } else if (spec.generator === "flat_with_wall") {
    // unwalkable cliffs at x = 0 and x = size/2 (2 cells thick); the middle one has a 5 cell gap
    const mid = spec.size / 2;
    for (let y = 0; y < spec.size; y++) {
      for (const x0 of [0, mid]) {
        if (x0 === mid && Math.abs(y - mid) <= 2) continue;
        for (let x = x0; x < x0 + 2; x++) t.heights[t.idx(x, y)] = land + 300;
      }
    }
  } else if (spec.generator !== "flat") throw new Error(`unknown map generator "${spec.generator}"`);
  for (const p of spec.paint ?? []) paintShape(t, cfg.sea, p);
  return { terrain: t, seedUsed: 0, rerolls: 0, hearths: [], trees: [], wild: [], landFraction: 1 };
}

/** Label 4-connected walkable components; returns labels (0 = not walkable) and the largest label. */
export function walkableComponents(t: Terrain): { labels: Int32Array; largest: number; sizes: number[] } {
  const n = t.size;
  const labels = new Int32Array(n * n);
  const sizes = [0];
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < n * n; start++) {
    if (labels[start] || !t.walkable(start % n, Math.floor(start / n))) continue;
    let count = 0;
    labels[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      count++;
      const x = i % n;
      const y = (i - x) / n;
      const nb = [t.idx(x + 1, y), t.idx(x - 1, y), t.idx(x, y + 1), t.idx(x, y - 1)];
      for (const j of nb) {
        if (labels[j]) continue;
        const jx = j % n;
        if (!t.walkable(jx, (j - jx) / n)) continue;
        labels[j] = next;
        stack.push(j);
      }
    }
    sizes.push(count);
    next++;
  }
  let largest = 0;
  for (let l = 1; l < sizes.length; l++) if (largest === 0 || sizes[l] > sizes[largest]) largest = l;
  return { labels, largest, sizes };
}

function torusDist2(n: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = wrapDelta(bx - ax, n);
  const dy = wrapDelta(by - ay, n);
  return dx * dx + dy * dy;
}

export function generateMap(cfg: SimConfig, spec: MapSpec, seed: number): GeneratedMap {
  const preset = cfg.pack.terrain.presets.find((p) => p.id === spec.generator);
  if (!preset) return testMap(cfg, spec);
  const tf = cfg.pack.terrain;
  const [genMin, genMax] = cfg.pack.balance.terrain.generatorRange;
  const n = spec.size;
  const tribes = spec.tribes ?? 2;
  let lastErr = "";
  for (let attempt = 0; attempt <= tf.maxRerolls; attempt++) {
    const s = (seed + Math.imul(attempt, 7919)) | 0;
    const rng = new Rng(s);
    const t = newTerrain(cfg, n);
    // 1. heights from fbm, thresholded so landFraction of vertices are above sea
    const v = new Float64Array(n * n);
    const hist = new Int32Array(1024);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const f = fbm(x, y, n, preset.basePeriod, preset.octaves, preset.persistence, s);
        v[x + y * n] = f;
        hist[Math.min(1023, Math.floor(f * 1024))]++;
      }
    }
    const waterCount = Math.round((1 - preset.landFraction) * n * n);
    let acc = 0;
    let bin = 0;
    while (bin < 1023 && acc + hist[bin] < waterCount) acc += hist[bin++];
    const thr = (bin + 0.5) / 1024;
    let vmax = thr;
    for (let i = 0; i < n * n; i++) vmax = Math.max(vmax, v[i]);
    const span = vmax > thr ? vmax - thr : 1;
    let landN = 0;
    // land height above sea + 2 per vertex (-1 for water), terraced in a second pass
    const above = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const f = v[i];
      if (f < thr) {
        above[i] = -1;
        t.heights[i] = Math.round(genMin + (cfg.sea - 2 - genMin) * (f / thr));
        continue;
      }
      const u = (f - thr) / span;
      const curved = u * (1 - preset.peakiness) + u * u * preset.peakiness;
      above[i] = (genMax - cfg.sea - 2) * curved;
      landN++;
    }
    // BACKLOG 0a terraced plateaus: each step level for its lower share, then a linear ramp; the level share
    // shrinks with the local slope so a ramp stays near rampSlope (cliff colored yet walkable)
    const tc = preset.terrace;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = x + y * n;
        let a = above[i];
        if (a < 0) continue;
        if (tc) {
          let s0 = 0;
          for (const k of [((x + 1) % n) + y * n, ((x + n - 1) % n) + y * n, x + ((y + 1) % n) * n, x + ((y + n - 1) % n) * n]) s0 = Math.max(s0, Math.abs(Math.max(0, above[k]) - a));
          const flat = Math.min(tc.flat, Math.max(0, 1 - s0 / tc.rampSlope));
          const q = Math.floor(a / tc.step);
          const g = a / tc.step - q;
          a = (q + (g < flat ? 0 : (g - flat) / (1 - flat))) * tc.step;
        }
        t.heights[i] = Math.round(cfg.sea + 2 + a);
      }
    }
    // 2. Hearth sites on the largest walkable component, spread by farthest-point sampling
    const comp = walkableComponents(t);
    const hp = tf.hearth;
    const r = Math.ceil(hp.flatRadius);
    const cands: number[] = [];
    for (let y = 0; y < n; y += 2) {
      for (let x = 0; x < n; x += 2) {
        const i = x + y * n;
        if (comp.labels[i] !== comp.largest || t.heights[i] < cfg.sea + hp.minHeightAboveSea) continue;
        let lo = 1e9;
        let hi = -1e9;
        let ok = true;
        for (let dy = -r; dy <= r && ok; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const k = t.idx(x + dx, y + dy);
            if (comp.labels[k] !== comp.largest) {
              ok = false;
              break;
            }
            lo = Math.min(lo, t.heights[k]);
            hi = Math.max(hi, t.heights[k]);
          }
        }
        if (ok && hi - lo <= hp.maxSiteRange) cands.push(i);
      }
    }
    if (cands.length < tribes) {
      lastErr = `only ${cands.length} hearth candidates (largest walkable component ${comp.sizes[comp.largest] ?? 0} of ${landN} land vertices)`;
      continue;
    }
    const sites: number[] = [cands[rng.int("gen", cands.length)]];
    while (sites.length < tribes) {
      let best = -1;
      let bestD = -1;
      for (const c of cands) {
        let m = 1e18;
        for (const sIdx of sites) m = Math.min(m, torusDist2(n, c % n, Math.floor(c / n), sIdx % n, Math.floor(sIdx / n)));
        if (m > bestD) {
          bestD = m;
          best = c;
        }
      }
      sites.push(best);
    }
    const minSpacing = hp.minSpacingFracOfSize * n;
    let spaced = true;
    for (let a = 0; a < sites.length; a++) for (let b = a + 1; b < sites.length; b++) if (torusDist2(n, sites[a] % n, Math.floor(sites[a] / n), sites[b] % n, Math.floor(sites[b] / n)) < minSpacing * minSpacing) spaced = false;
    if (tribes > 1 && !spaced) {
      lastErr = "hearth sites too close";
      continue;
    }
    const hearths = sites.map((i) => ({ x: i % n, y: Math.floor(i / n) }));
    for (const h of hearths) t.flattenToAverage(h.x, h.y, hp.flatRadius + 1, hp.minHeightAboveSea);
    // 3. trees: band density times a cluster mask, away from hearths, on gentle land; a grove ring around
    // each Hearth (BACKLOG 0a: villages ringed by pine forest, the look v2 target) wherever its band grows trees
    const trees: { x: number; y: number }[] = [];
    const clear2 = tf.trees.clearRadiusAroundHearth * tf.trees.clearRadiusAroundHearth;
    const grove = tf.trees.hearthGrove;
    const groveAt = (x: number, y: number): number => {
      if (!grove) return 0;
      for (const hh of hearths) {
        const d2 = torusDist2(n, x, y, hh.x, hh.y);
        if (d2 >= grove.inner * grove.inner && d2 <= grove.outer * grove.outer) return grove.density;
      }
      return 0;
    };
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const h = t.get(x, y);
        if (h < cfg.sea + 4 || t.slope(x, y) > tf.trees.maxSlope) continue;
        const cluster = valueNoise((x / n) * tf.trees.clusterPeriod, (y / n) * tf.trees.clusterPeriod, tf.trees.clusterPeriod, s ^ 0x5bd1e995);
        const band = tf.trees.densityByBand[bandOf(cfg, h)];
        const ring = band > 0 ? groveAt(x, y) : 0;
        if (cluster < tf.trees.clusterThreshold && ring === 0) continue;
        const dens = Math.max(ring, cluster < tf.trees.clusterThreshold ? 0 : band * (cluster - tf.trees.clusterThreshold) / (1 - tf.trees.clusterThreshold) * 4);
        if (!rng.chance("gen", dens)) continue;
        if (hearths.some((hh) => torusDist2(n, x, y, hh.x, hh.y) < clear2)) continue;
        const tx = wrap(x + 0.2 + rng.float("gen") * 0.6, n);
        const ty = wrap(y + 0.2 + rng.float("gen") * 0.6, n);
        if (t.heightAt(tx, ty) < cfg.sea + 4) continue;
        trees.push({ x: tx, y: ty });
      }
    }
    // 4. wild people around each hearth on the main landmass
    const [wMin, wMax] = cfg.pack.units.units.find((u) => u.id === "wild")?.spawnPerTribe ?? [0, 0];
    const [dMin, dMax] = tf.wild.distance;
    const finalComp = walkableComponents(t);
    if (hearths.some((h) => finalComp.labels[t.idx(h.x, h.y)] !== finalComp.labels[t.idx(hearths[0].x, hearths[0].y)] || finalComp.labels[t.idx(h.x, h.y)] === 0)) {
      lastErr = "hearth sites not connected after flattening";
      continue;
    }
    const home = finalComp.labels[t.idx(hearths[0].x, hearths[0].y)];
    const wild: { tribe: number; x: number; y: number }[] = [];
    hearths.forEach((h, ti) => {
      const count = wMin + rng.int("gen", wMax - wMin + 1);
      for (let k = 0; k < count; k++) {
        for (let tryN = 0; tryN < 24; tryN++) {
          const a = rng.float("gen") * TWO_PI;
          const d = dMin + rng.float("gen") * (dMax - dMin);
          const x = wrap(h.x + cos(a) * d, n);
          const y = wrap(h.y + sin(a) * d, n);
          const xi = Math.round(x);
          const yi = Math.round(y);
          if (finalComp.labels[t.idx(xi, yi)] !== home) continue;
          wild.push({ tribe: ti, x, y });
          break;
        }
      }
    });
    t.takeDirty();
    t.version = 0;
    return { terrain: t, seedUsed: s, rerolls: attempt, hearths, trees, wild, landFraction: landN / (n * n) };
  }
  throw new Error(`planet generator failed after ${tf.maxRerolls + 1} attempts: ${lastErr}`);
}

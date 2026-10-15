// Minimap painter (HUD layout v2): reads sim state, never writes it. Terrain colors are cached per
// terrain version; units, buildings, Shapers and the camera view are drawn on top every refresh.
// M8: the view outline is the screen border picked onto the curved sea-level surface (pickGround,
// hills ignored so the footprint stays smooth), so it widens toward the horizon and stops at it;
// cached per camera state. BACKLOG 3: fog of war darkens unexplored and unseen ground and hides what
// the local tribe cannot see (renderer.revealFog shows everything). BACKLOG 80: the footprint is clipped
// to the terrain fade radius (half the world less 2), where drawing stops, so on small maps it never
// reaches past the antipode and folds into a V across the wrap.
import { CAT, denMarks, type DenMark, type World } from "@hearthfall/sim";
import type { Game } from "./game.ts";
import { pingRing } from "./alerts.ts";

let cache: { version: number; scar: number; size: number; img: ImageData } | null = null;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function terrainImage(game: Game, ctx: CanvasRenderingContext2D): ImageData {
  const w = game.world;
  const t = w.terrain;
  if (cache && cache.version === t.version && cache.scar === t.scarVersion && cache.size === t.size) return cache.img;
  const pal = game.pack.files.style.palette;
  const deep = hex(pal.water ?? "#1d6a96");
  const shallow = hex(pal.waterShallow ?? "#33bcc6");
  const sand = hex(pal.sand ?? "#e8d2a0");
  const meadow = hex(pal.meadow ?? "#8dbf5a");
  const forest = hex(pal.forest ?? "#3f6b2e");
  const rock = hex(pal.rock ?? "#8a8378");
  const snow = hex(pal.snow ?? "#f4f1ea");
  const b = w.cfg.bands;
  const n = t.size;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const h = t.get(x, y);
      let c: [number, number, number];
      if (h < t.sea) c = t.sea - h < 30 ? shallow : deep;
      else if (h < b.shore) c = sand;
      else if (h < b.highland) c = meadow;
      else if (h < b.rock) c = forest;
      else if (h < b.peak) c = rock;
      else c = snow;
      const o = (y * n + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  cache = { version: t.version, scar: t.scarVersion, size: n, img };
  return img;
}

let fogCache: { key: string; img: ImageData } | null = null;

/** The terrain image darkened by the local tribe's fog of war (cached per vision and terrain version). */
function fogImage(game: Game, ctx: CanvasRenderingContext2D, base: ImageData): ImageData {
  const v = game.world.vision;
  const tribe = game.renderer.viewTribe;
  if (!v.on || game.renderer.revealFog || tribe < 0 || tribe >= v.visible.length) return base;
  const t = game.world.terrain;
  const key = `${v.version} ${tribe} ${t.version} ${t.scarVersion} ${t.size}`;
  if (fogCache?.key === key) return fogCache.img;
  const n = t.size;
  const img = ctx.createImageData(n, n);
  const vis = v.visible[tribe];
  const exp = v.explored[tribe];
  for (let y = 0; y < n; y++) {
    const row = Math.floor(y / v.cell) * v.gw;
    for (let x = 0; x < n; x++) {
      const k = row + Math.floor(x / v.cell);
      const f = vis[k] ? 1 : exp[k] ? 0.6 : 0.2;
      const o = (y * n + x) * 4;
      img.data[o] = base.data[o] * f;
      img.data[o + 1] = base.data[o + 1] * f;
      img.data[o + 2] = base.data[o + 2] * f;
      img.data[o + 3] = 255;
    }
  }
  fogCache = { key, img };
  return img;
}

let view: { key: string; pts: [number, number][] | null } | null = null;

/** Screen border samples projected onto the curved ground in unwrapped map units; null when the center misses. */
/** Cache key of the camera footprint: viewport, camera and terrain. */
export function viewKey(game: Game): string {
  const cam = game.renderer.cam;
  const t = game.world.terrain;
  return `${game.canvas.clientWidth}x${game.canvas.clientHeight} ${cam.x} ${cam.z} ${cam.yaw} ${cam.zoom} ${cam.map} ${t.version} ${t.size}`;
}

/** viewKey of the footprint the minimap last drew (tests check it follows the camera within a few frames). */
export let drawnViewKey = "";

/**
 * BACKLOG 80: pull every footprint point farther than `r` from the focus (cx, cz) back onto that circle,
 * so the outline stays inside one map copy. Points are unwrapped map units; returns a new array.
 */
export function clipFootprint(pts: readonly [number, number][], cx: number, cz: number, r: number): [number, number][] {
  return pts.map(([x, z]) => {
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    return d > r ? [cx + (dx * r) / d, cz + (dz * r) / d] : [x, z];
  });
}

export function viewOutline(game: Game, fresh = false): [number, number][] | null {
  const W = game.canvas.clientWidth;
  const H = game.canvas.clientHeight;
  const key = viewKey(game);
  if (!fresh && view && view.key === key) return view.pts;
  const pick = (x: number, y: number) => game.renderer.pickGround(x, y);
  const cx = W / 2;
  const cy = H / 2;
  const c = pick(cx, cy);
  let pts: [number, number][] | null = null;
  if (c && W > 0 && H > 0) {
    const border: [number, number][] = [];
    const K = 6;
    for (let k = 0; k < K; k++) border.push([(W * k) / K, 0]);
    for (let k = 0; k < K; k++) border.push([W, (H * k) / K]);
    for (let k = 0; k < K; k++) border.push([W - (W * k) / K, H]);
    for (let k = 0; k < K; k++) border.push([0, H - (H * k) / K]);
    pts = [];
    for (const [bx, by] of border) {
      let p = pick(bx, by);
      if (!p) {
        // the border sees sky: walk back toward the center to the horizon
        let lo = 0;
        let hi = 1;
        p = c;
        for (let it = 0; it < 7; it++) {
          const m = (lo + hi) / 2;
          const q = pick(cx + (bx - cx) * m, cy + (by - cy) * m);
          if (q) {
            p = q;
            lo = m;
          } else hi = m;
        }
      }
      pts.push([p.x, p.z]);
    }
    const cam = game.renderer.cam;
    if (!cam.map) pts = clipFootprint(pts, cam.x, cam.z, game.world.terrain.size / 2 - 2);
  }
  view = { key, pts };
  return pts;
}

/**
 * QoL 2: under attack pings, a pulsing ring at each alert that fades over ui.json alerts.pingSeconds (world
 * ticks, so a paused game holds them and fixedStep captures match). The Hearth and the Shaper ping in ember.
 */
function drawPings(game: Game, ctx: CanvasRenderingContext2D): void {
  const w = game.world;
  const hz = w.cfg.tickHz;
  const life = game.alertCfg.pingSeconds * hz;
  const n = w.terrain.size;
  for (const p of game.pings) {
    const ring = pingRing(w.tick - p.tick, life, hz);
    if (!ring) continue;
    const r = ring.r * (p.big ? 1.4 : 1) * Math.max(1, n / 128);
    for (const dx of [-n, 0, n])
      for (const dz of [-n, 0, n]) {
        const x = p.x + dx;
        const z = p.y + dz;
        if (x < -r || z < -r || x > n + r || z > n + r) continue;
        ctx.globalAlpha = ring.alpha;
        ctx.lineWidth = Math.max(1.5, n / 96);
        ctx.strokeStyle = "rgba(13, 11, 9, 0.85)";
        ctx.beginPath();
        ctx.arc(x, z, r + 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = p.big ? "#e8913a" : "#ff5a3c";
        ctx.beginPath();
        ctx.arc(x, z, r, 0, Math.PI * 2);
        ctx.stroke();
      }
  }
  ctx.globalAlpha = 1;
}

/** The slice of the 2D context the den icons use (tests pass a recorder). */
export type DenCtx = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "lineTo" | "closePath" | "fill" | "stroke" | "arc" | "fillStyle" | "strokeStyle" | "lineWidth">;

const denBuf: DenMark[] = [];

/**
 * Chapter 4 prep: a diamond over every standing wolf den the viewer has explored (everything with the fog revealed):
 * red with a dark rim, gold with a ring for a den an open clearDens objective counts (shown even in the dark).
 * Reads sim state only; returns how many dens were drawn. The icons grow with the map so they read at any size.
 */
export function drawDens(w: World, viewer: number, reveal: boolean, ctx: DenCtx, buf: DenMark[] = denBuf): number {
  const n = denMarks(w, reveal ? null : viewer, buf);
  const k = Math.max(1, w.terrain.size / 128);
  for (let i = 0; i < n; i++) {
    const d = buf[i];
    const x = Math.floor(d.x);
    const y = Math.floor(d.y);
    const diamond = (r: number) => {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    };
    if (d.beacon) {
      ctx.lineWidth = Math.max(1.5, k);
      ctx.strokeStyle = "#ffd23a";
      ctx.beginPath();
      ctx.arc(x, y, 6 * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(13, 11, 9, 0.9)";
    diamond(4 * k);
    ctx.fill();
    ctx.fillStyle = d.beacon ? "#ffd23a" : "#e2483a";
    diamond(2.6 * k);
    ctx.fill();
  }
  return n;
}

export function drawMinimap(game: Game, canvas: HTMLCanvasElement): void {
  const w = game.world;
  const n = w.terrain.size;
  if (canvas.width !== n) {
    canvas.width = n;
    canvas.height = n;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(fogImage(game, ctx, terrainImage(game, ctx)), 0, 0);
  const E = w.ents;
  const viewer = game.renderer.viewTribe;
  const reveal = game.renderer.revealFog;
  const defs = w.cfg.pack.units.units;
  const shapers: number[] = [];
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const cat = E.cat[i];
    if (cat !== CAT.unit && cat !== CAT.building) continue;
    if (!reveal && !(cat === CAT.unit ? w.vision.seesEntity(viewer, i) : w.vision.seenEntity(viewer, i))) continue;
    if (cat === CAT.unit && E.veil[i] > 0 && E.tribe[i] !== viewer) continue;
    if (cat === CAT.unit && defs[E.type[i]].isCaster) {
      shapers.push(i);
      continue;
    }
    const tr = w.tribes[E.tribe[i]];
    ctx.fillStyle = tr ? game.tribePal[tr.color] ?? "#d9cbb0" : "#d9cbb0";
    const s = cat === CAT.building ? 3 : 1;
    ctx.fillRect(Math.floor(E.x[i]) - (s >> 1), Math.floor(E.y[i]) - (s >> 1), s, s);
  }
  // Shapers on top: a light ring around a tribe colored dot
  for (const i of shapers) {
    const tr = w.tribes[E.tribe[i]];
    const x = Math.floor(E.x[i]);
    const y = Math.floor(E.y[i]);
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.fillStyle = tr ? game.tribePal[tr.color] ?? "#d9cbb0" : "#d9cbb0";
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  drawDens(w, viewer, reveal, ctx);
  drawPings(game, ctx);
  const pts = viewOutline(game);
  drawnViewKey = viewKey(game);
  const span = (k: 0 | 1) => (pts ? Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])) : 0);
  // a view that sees most of the planet (globe zoom) has no useful outline: mark the focus instead
  const outline = pts && pts.length > 2 && span(0) < 0.85 * n && span(1) < 0.85 * n;
  const cam = game.renderer.cam;
  for (const [style, width] of [["rgba(18, 12, 8, 0.75)", 3], ["#f4f1ea", 1]] as const) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    for (const dx of [-n, 0, n])
      for (const dz of [-n, 0, n]) {
        ctx.beginPath();
        if (outline) {
          ctx.moveTo(pts[0][0] + dx, pts[0][1] + dz);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0] + dx, pts[k][1] + dz);
          ctx.closePath();
        } else {
          const x = Math.round(cam.x + dx) + 0.5;
          const z = Math.round(cam.z + dz) + 0.5;
          ctx.moveTo(x - 6, z);
          ctx.lineTo(x + 6, z);
          ctx.moveTo(x, z - 6);
          ctx.lineTo(x, z + 6);
        }
        ctx.stroke();
      }
  }
}

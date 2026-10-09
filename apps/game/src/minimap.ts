// Minimap painter (HUD layout v2): reads sim state, never writes it. Terrain colors are cached per
// terrain version; units, buildings, Shapers and the camera view are drawn on top every refresh.
// M8: the view outline is the screen border picked onto the curved sea-level surface (pickGround,
// hills ignored so the footprint stays smooth), so it widens toward the horizon and stops at it;
// cached per camera state.
import { CAT } from "@hearthfall/sim";
import type { Game } from "./game.ts";

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

let view: { key: string; pts: [number, number][] | null } | null = null;

/** Screen border samples projected onto the curved ground in unwrapped map units; null when the center misses. */
export function viewOutline(game: Game): [number, number][] | null {
  const W = game.canvas.clientWidth;
  const H = game.canvas.clientHeight;
  const cam = game.renderer.cam;
  const t = game.world.terrain;
  const key = `${W}x${H} ${cam.x} ${cam.z} ${cam.yaw} ${cam.zoom} ${cam.map} ${t.version} ${t.size}`;
  if (view && view.key === key) return view.pts;
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
  }
  view = { key, pts };
  return pts;
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
  ctx.putImageData(terrainImage(game, ctx), 0, 0);
  const E = w.ents;
  const pal = game.pack.files.style.palette;
  const defs = w.cfg.pack.units.units;
  const shapers: number[] = [];
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const cat = E.cat[i];
    if (cat !== CAT.unit && cat !== CAT.building) continue;
    if (cat === CAT.unit && defs[E.type[i]].isCaster) {
      shapers.push(i);
      continue;
    }
    const tr = w.tribes[E.tribe[i]];
    ctx.fillStyle = tr ? pal[tr.color] ?? "#d9cbb0" : "#d9cbb0";
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
    ctx.fillStyle = tr ? pal[tr.color] ?? "#d9cbb0" : "#d9cbb0";
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }
  const pts = viewOutline(game);
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

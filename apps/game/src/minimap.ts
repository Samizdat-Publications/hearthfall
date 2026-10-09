// Minimap painter (HUD layout v2): reads sim state, never writes it. Terrain colors are cached per
// terrain version; units, buildings and the camera focus are drawn on top every refresh.
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
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const cat = E.cat[i];
    if (cat !== CAT.unit && cat !== CAT.building) continue;
    const tr = w.tribes[E.tribe[i]];
    ctx.fillStyle = tr ? pal[tr.color] ?? "#d9cbb0" : "#d9cbb0";
    const s = cat === CAT.building ? 3 : 1;
    ctx.fillRect(Math.floor(E.x[i]) - (s >> 1), Math.floor(E.y[i]) - (s >> 1), s, s);
  }
  const cam = game.renderer.cam;
  ctx.strokeStyle = "#f4f1ea";
  ctx.lineWidth = 1;
  const half = 10 + 30 * cam.zoom;
  for (const dx of [-n, 0, n]) for (const dz of [-n, 0, n]) ctx.strokeRect(Math.round(cam.x - half + dx) + 0.5, Math.round(cam.z - half + dz) + 0.5, Math.round(half * 2), Math.round(half * 2));
}

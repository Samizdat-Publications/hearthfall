// Browser side of the harness: Vite build and in-process preview server (127.0.0.1, closed in
// finally), Playwright launch in the screenshot mode the doctor recorded, capture and pixel stats.
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { LATEST, ROOT, doctorEnv } from "./lib.mjs";

const CONFIG = ROOT + "apps/game/vite.config.ts";
export const BASE_ARGS = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion"];
export const GPU_ARGS = ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"];

export async function viteBuild(mode) {
  const { build } = await import("vite");
  await build({ configFile: CONFIG, mode, logLevel: "error", root: ROOT + "apps/game" });
  return ROOT + `apps/game/${mode === "test" ? "dist-test" : "dist"}`;
}

export async function build(out, mode) {
  const t0 = Date.now();
  try {
    const dir = await viteBuild(mode);
    out.line(`built ${mode} bundle to ${dir.replace(ROOT, "")} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return out.finish("PASS");
  } catch (e) {
    out.line(String(e.message ?? e).split("\n")[0]);
    return out.finish("FAIL", "1 (vite build)");
  }
}

/** Start `vite preview` in-process on the test build, with the LAN relay at /net (Leg 5); returns {url, close}. */
export async function startPreview(port = 5181) {
  const { preview } = await import("vite");
  const { Relay } = await import("../net/relay.mjs");
  const server = await preview({ configFile: CONFIG, mode: "test", root: ROOT + "apps/game", logLevel: "error", preview: { host: "127.0.0.1", port, strictPort: true }, build: { outDir: "dist-test" } });
  new Relay().attach(server.httpServer);
  const url = `http://127.0.0.1:${port}/`;
  return {
    url,
    close: () => new Promise((res) => server.httpServer.close(() => res())),
  };
}

/** Launch Chromium. mode: {headless, gpuArgs, channel} as recorded by the doctor. */
export async function launch(mode) {
  const { chromium } = await import("@playwright/test");
  return chromium.launch({
    headless: mode.headless,
    channel: mode.channel,
    args: [...BASE_ARGS, ...(mode.gpuArgs ? GPU_ARGS : [])],
    timeout: 60000,
  });
}

export function shotMode() {
  return doctorEnv()?.screenshotMode ?? { headless: true, gpuArgs: true, channel: "chromium" };
}

/** Load a URL, wait until the game has rendered at least `minFrames` frames, return the page. */
export async function openGame(browser, url, { width = 1280, height = 720, minFrames = 3, timeoutMs = 30000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || (m.type() === "warning" && /webgl|GL_/i.test(m.text()))) consoleErrors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 300)));
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  await page.waitForFunction((n) => window.__game && window.__game.frames() >= n, minFrames, { timeout: timeoutMs });
  // real models load asynchronously (M10); captures and checks wait for them so pixels are stable
  await page.waitForFunction(() => !window.__game.models().pending, null, { timeout: timeoutMs });
  const f = await page.evaluate(() => window.__game.frames());
  await page.waitForFunction((n) => window.__game.frames() >= n, f + 2, { timeout: timeoutMs });
  return { page, consoleErrors };
}

/** Pixel statistics for the blank check: luminance std dev and the dominant 4-bit color share. */
/**
 * BACKLOG 32: the part of the page that shows the 3D view, measured in the page (CSS px): the game canvas
 * rect minus every visible HUD or menu element (`[data-hud]`, `[data-ui]`), so blank and coverage checks
 * judge the world and not the HUD drawn over it. Pass to page.evaluate.
 */
export function viewRegionFn() {
  const c = document.getElementById("view");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const holes = [];
  for (const e of document.querySelectorAll("[data-hud], [data-ui]")) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || !e.getClientRects().length) continue;
    const b = e.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) holes.push([b.left, b.top, b.right, b.bottom]);
  }
  return { cssWidth: innerWidth, rect: [r.left, r.top, r.right, r.bottom], holes };
}

/** Pixel mask (1 = sample) for a region from viewRegionFn on an image of the given size; null samples all. */
export function regionMask(region, width, height) {
  if (!region) return null;
  const s = width / region.cssWidth;
  const box = (b) => [Math.max(0, Math.floor(b[0] * s)), Math.max(0, Math.floor(b[1] * s)), Math.min(width, Math.ceil(b[2] * s)), Math.min(height, Math.ceil(b[3] * s))];
  const m = new Uint8Array(width * height);
  const [x0, y0, x1, y1] = box(region.rect);
  for (let y = y0; y < y1; y++) m.fill(1, y * width + x0, y * width + x1);
  for (const h of region.holes) {
    const [a, b, c, d] = box(h);
    for (let y = b; y < d; y++) if (c > a) m.fill(0, y * width + a, y * width + c);
  }
  return m;
}

/** Share of the image a mask samples (1 without a mask). */
export function maskShare(mask) {
  if (!mask) return 1;
  let k = 0;
  for (let i = 0; i < mask.length; i++) k += mask[i];
  return k / mask.length;
}

/** Below this share of visible view the region checks fall back to the whole page (a menu covers the world). */
export const MIN_VIEW_SHARE = 0.1;

/** Luma and color stats over the sampled pixels (the whole image, or the 3D view region; BACKLOG 32). */
export function pixelStats(pngPath, region = null) {
  const png = PNG.sync.read(readFileSync(pngPath));
  return pixelStatsOf(png, region);
}

export function pixelStatsOf(png, region = null) {
  const { data, width, height } = png;
  let mask = regionMask(region, width, height);
  const share = maskShare(mask);
  if (share < MIN_VIEW_SHARE) mask = null;
  let n = 0;
  let sum = 0;
  let sum2 = 0;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (mask && !mask[i >> 2]) continue;
    n++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += l;
    sum2 += l * l;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  let dom = 0;
  for (const v of buckets.values()) dom = Math.max(dom, v);
  return { width, height, sampled: mask ? "view" : "page", viewShare: +share.toFixed(3), lumaMean: +mean.toFixed(2), lumaStd: +std.toFixed(2), dominantShare: +(dom / n).toFixed(4), colors: buckets.size };
}

export function blankCheck(stats) {
  const ok = stats.lumaStd > 8 && stats.dominantShare < 0.9 && stats.colors > 24;
  return { ok, reason: ok ? "" : `blank-ish: lumaStd ${stats.lumaStd}, dominant ${stats.dominantShare}, colors ${stats.colors}` };
}

export async function shotCmd(out, cmd, args) {
  if (!readFileSafe(ROOT + "tools/harness/shotsets/smoke.json")) return out.finish("SKIP", `${cmd} lands at M2 (no shot sets yet; doctor capture is reports/latest/doctor-shot.png)`);
  const { runShots } = await import("./shots.mjs");
  return runShots(out, cmd, args);
}

function readFileSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

export { LATEST };

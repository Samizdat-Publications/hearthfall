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

/** Start `vite preview` in-process on the test build; returns {url, close}. */
export async function startPreview(port = 5181) {
  const { preview } = await import("vite");
  const server = await preview({ configFile: CONFIG, mode: "test", root: ROOT + "apps/game", logLevel: "error", preview: { host: "127.0.0.1", port, strictPort: true }, build: { outDir: "dist-test" } });
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
export function pixelStats(pngPath) {
  const png = PNG.sync.read(readFileSync(pngPath));
  const { data, width, height } = png;
  const n = width * height;
  let sum = 0;
  let sum2 = 0;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
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
  return { width, height, lumaMean: +mean.toFixed(2), lumaStd: +std.toFixed(2), dominantShare: +(dom / n).toFixed(4), colors: buckets.size };
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

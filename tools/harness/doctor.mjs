// npm run doctor (docs/TESTING.md section 9). Fails only on Node, npm install state or no working
// screenshot mode; optional tools (Blender, API keys) produce WARN lines.
import { spawnSync } from "node:child_process";
import { existsSync, statfsSync, writeFileSync } from "node:fs";
import { ENV_FILE, LATEST, ROOT, gitSha, writeReport } from "./lib.mjs";
import { blankCheck, launch, openGame, pixelStats, startPreview, viteBuild } from "./web.mjs";

const KEYS = ["MESHY_API_KEY", "TRIPO_API_KEY", "PIXELLAB_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"];
const BLENDER_DEFAULTS = [
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe",
  "C:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe",
];

// Screenshot modes in preference order: headless first, headed last (a window flashes).
const MODES = [
  { id: "headless-shell", headless: true, gpuArgs: false },
  { id: "headless-shell-gpu", headless: true, gpuArgs: true },
  { id: "headless-new-gpu", headless: true, gpuArgs: true, channel: "chromium" },
  { id: "headed-gpu", headless: false, gpuArgs: true },
];

const isSoftware = (r) => /swiftshader|llvmpipe|software|basic render/i.test(r ?? "");

export async function doctor(out) {
  const rep = { when: new Date().toISOString(), checks: {}, warns: [], fails: [] };
  const warn = (m) => {
    rep.warns.push(m);
    out.line(`WARN ${m}`);
  };
  const fail = (m) => {
    rep.fails.push(m);
    out.line(`FAIL ${m}`);
  };

  // Node and install state
  const [maj, min] = process.versions.node.split(".").map(Number);
  rep.checks.node = process.versions.node;
  if (maj < 22 || (maj === 22 && min < 18)) fail(`Node ${process.versions.node} < 22.18`);
  rep.checks.lockfile = existsSync(ROOT + "package-lock.json");
  rep.checks.workspaces = ["sim", "data", "ai", "render", "ui", "audio", "game"].every((p) => existsSync(ROOT + `node_modules/@hearthfall/${p}`));
  if (!rep.checks.lockfile || !rep.checks.workspaces) fail("npm install incomplete (lockfile or workspace links missing)");

  // Python, Blender
  const py = spawnSync(ROOT + ".venv/Scripts/python.exe", ["--version"], { encoding: "utf8", timeout: 20000, windowsHide: true });
  rep.checks.python = py.status === 0 ? py.stdout.trim() : null;
  if (!rep.checks.python) warn("project .venv python missing (asset pipeline disabled)");
  const blenderPath = [process.env.BLENDER_EXE, ...BLENDER_DEFAULTS].find((p) => p && existsSync(p));
  if (blenderPath) {
    const b = spawnSync(blenderPath, ["--version"], { encoding: "utf8", timeout: 60000, windowsHide: true });
    rep.checks.blender = { path: blenderPath, version: (b.stdout ?? "").split(/\r?\n/)[0].trim() || null };
    if (process.env.BLENDER_EXE && blenderPath !== process.env.BLENDER_EXE) warn(`BLENDER_EXE not found, using ${blenderPath}`);
  } else warn("Blender not found (asset normalize disabled)");

  // API keys: presence only, never values
  rep.checks.keys = Object.fromEntries(KEYS.map((k) => [k, Boolean(process.env[k] && process.env[k].trim())]));
  const missing = KEYS.filter((k) => !rep.checks.keys[k]);
  if (missing.length) warn(`API keys missing: ${missing.join(", ")}`);

  // Disk and git
  try {
    const s = statfsSync(ROOT);
    rep.checks.freeGb = +((s.bavail * s.bsize) / 1e9).toFixed(1);
    if (rep.checks.freeGb < 10) warn(`low disk: ${rep.checks.freeGb} GB free`);
  } catch {
    rep.checks.freeGb = null;
  }
  rep.checks.git = gitSha();

  // Build the test bundle, serve it in-process, try screenshot modes
  let preview;
  rep.checks.screenshot = [];
  try {
    await viteBuild("test");
    preview = await startPreview();
    rep.checks.previewUrl = preview.url;
    let chosen = null;
    let fallback = null;
    for (const mode of MODES) {
      const t0 = Date.now();
      const res = { mode: mode.id, ok: false };
      let browser;
      try {
        browser = await launch(mode);
        const { page, consoleErrors } = await openGame(browser, preview.url, { timeoutMs: 30000 });
        const shot = LATEST + `doctor-${mode.id}.png`;
        await page.screenshot({ path: shot });
        const gl = await page.evaluate(() => window.__game.webgl());
        const gpu = await page.evaluate(async () => {
          if (!("gpu" in navigator)) return "no navigator.gpu";
          try {
            const a = await navigator.gpu.requestAdapter();
            return a ? "adapter ok" : "no adapter";
          } catch (e) {
            return "error " + String(e).slice(0, 80);
          }
        });
        const stats = pixelStats(shot);
        const blank = blankCheck(stats);
        Object.assign(res, { ok: blank.ok, renderer: gl.renderer, webgl: gl.version, webgpu: gpu, stats, consoleErrors: consoleErrors.slice(0, 3), ms: Date.now() - t0 });
        if (!blank.ok) res.reason = blank.reason;
      } catch (e) {
        res.error = String(e.message ?? e).split("\n")[0].slice(0, 200);
      } finally {
        if (browser) await browser.close().catch(() => {});
      }
      rep.checks.screenshot.push(res);
      if (res.ok && !fallback) fallback = { mode, res };
      if (res.ok && !isSoftware(res.renderer)) {
        chosen = { mode, res };
        break;
      }
    }
    chosen = chosen ?? fallback;
    if (!chosen) fail("no screenshot mode produced a non-blank WebGL capture");
    else {
      const { mode, res } = chosen;
      if (isSoftware(res.renderer)) warn(`only software WebGL works (${res.renderer})`);
      if (!mode.headless) warn("screenshots need headed mode (a window flashes during shot runs)");
      rep.checks.screenshotMode = { id: mode.id, headless: mode.headless, gpuArgs: mode.gpuArgs, channel: mode.channel ?? null, renderer: res.renderer };
      const { copyFileSync } = await import("node:fs");
      copyFileSync(LATEST + `doctor-${mode.id}.png`, LATEST + "doctor-shot.png");
      writeFileSync(ENV_FILE, JSON.stringify({ when: rep.when, screenshotMode: { headless: mode.headless, gpuArgs: mode.gpuArgs, channel: mode.channel }, modeId: mode.id, renderer: res.renderer, webgpu: res.webgpu }, null, 2));
      out.line(`screenshot mode: ${mode.id} | ${res.renderer} | lumaStd ${res.stats.lumaStd}`);
    }
  } catch (e) {
    fail(`preview or browser: ${String(e.message ?? e).split("\n")[0].slice(0, 160)}`);
  } finally {
    if (preview) await preview.close();
  }

  out.line(`node ${rep.checks.node} | python ${rep.checks.python ?? "none"} | blender ${rep.checks.blender?.version ?? "none"} | disk ${rep.checks.freeGb} GB | git ${rep.checks.git.sha}${rep.checks.git.dirty ? " dirty" : ""}`);
  out.line(`keys present: ${KEYS.filter((k) => rep.checks.keys[k]).map((k) => k.replace("_API_KEY", "")).join(", ") || "none"}`);
  writeReport("doctor.json", rep);
  return out.finish(rep.fails.length ? "FAIL" : "PASS", rep.fails.length ? `${rep.fails.length} (see reports/latest/doctor.json)` : "");
}

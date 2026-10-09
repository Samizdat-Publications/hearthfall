// npm run bench:render [-- --frames N] [--save]: renderer CPU time per frame in Playwright Chromium
// at 1440p against docs/ARCHITECTURE.md section 9 (under 6 ms median with 1000 visible units and 2000
// total). The time is measured inside Renderer.render (performance.now around the scene update and the
// WebGL submit), not from rAF intervals, which vsync caps. The world is scenarios/render_bench_2000.json;
// the camera follows a fixed orbit over the crowd, stepping one sim tick per frame so units move. The
// pass runs with the real models and, for information, with the placeholder meshes (?models=0).
// Like npm run bench, the orbit runs ROUNDS times and each frame keeps its fastest time, so OS
// preemption on this often fully loaded PC does not masquerade as renderer cost (the raw median of
// every sample is printed beside it); costs that appear in every round remain.
// Fails on the budget or when fewer than 900 units are drawn (the measure would not be the budgeted
// one); warns when the median regresses more than 35 percent from reports/baselines/bench-render.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ROOT, writeReport } from "./lib.mjs";
import { launch, openGame, shotMode, startPreview, viteBuild } from "./web.mjs";

const BUDGET_MEDIAN_MS = 6;
const MIN_DRAWN = 900;
const ROUNDS = 3;
const BASE = ROOT + "reports/baselines/bench-render.json";
const URL_PARAMS = "scenario=render_bench_2000&paused=1&fixedStep=1&quality=high";

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function pass(browser, url, frames) {
  const { page, consoleErrors } = await openGame(browser, url, { width: 2560, height: 1440, timeoutMs: 60000 });
  try {
    const samples = await page.evaluate(async ([n, rounds]) => {
      const g = window.__game;
      const nextFrame = async () => {
        const f = g.frames();
        for (let k = 0; k < 200 && g.frames() <= f; k++) await new Promise((r) => requestAnimationFrame(r));
      };
      const out = [];
      const warm = 30;
      for (let round = 0; round < rounds; round++) {
        for (let i = 0; i < n + warm; i++) {
          const t = i / (n + warm);
          g.setCamera({ x: 40, z: 40, yaw: 0.6 + t * 6.2832, zoom: 0.3 + 0.08 * Math.sin(t * 12.566) });
          g.step(1);
          await nextFrame();
          const r = g.getSummary().render;
          if (i < warm) continue;
          const k = i - warm;
          if (round === 0) out.push({ ms: r.cpuMs, raw: [r.cpuMs], drawn: r.unitsDrawn, calls: r.drawCalls, tris: r.triangles });
          else {
            out[k].ms = Math.min(out[k].ms, r.cpuMs);
            out[k].raw.push(r.cpuMs);
          }
        }
      }
      return out;
    }, [frames, ROUNDS]);
    const models = await page.evaluate(() => window.__game.models());
    const ms = samples.map((s) => s.ms);
    return {
      frames: samples.length,
      medianMs: +pct(ms, 50).toFixed(3),
      p95Ms: +pct(ms, 95).toFixed(3),
      maxMs: +Math.max(...ms).toFixed(3),
      rawMedianMs: +pct(samples.flatMap((s) => s.raw), 50).toFixed(3),
      unitsDrawnMedian: pct(samples.map((s) => s.drawn), 50),
      drawCallsMedian: pct(samples.map((s) => s.calls), 50),
      trianglesMedian: pct(samples.map((s) => s.tris), 50),
      models: { loaded: models.loaded.length, failed: models.failed.length },
      consoleErrors: consoleErrors.slice(0, 5),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

export default async function benchRender(out, cmd, args) {
  const frames = Number(args.frames) > 0 ? Number(args.frames) : 240;
  await viteBuild("test");
  const preview = await startPreview();
  let browser;
  const report = { when: new Date().toISOString(), budgetMedianMs: BUDGET_MEDIAN_MS, viewport: "2560x1440" };
  try {
    browser = await launch(shotMode());
    report.real = await pass(browser, `${preview.url}?${URL_PARAMS}`, frames);
    report.placeholders = await pass(browser, `${preview.url}?${URL_PARAMS}&models=0`, frames);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await preview.close();
  }
  const r = report.real;
  const p = report.placeholders;
  out.line(`real models: median ${r.medianMs} ms (raw ${r.rawMedianMs}), p95 ${r.p95Ms} ms, max ${r.maxMs} ms | ${r.unitsDrawnMedian} units drawn | ${r.drawCallsMedian} calls | ${(r.trianglesMedian / 1e6).toFixed(2)}M tris | models ${r.models.loaded} loaded, ${r.models.failed} failed`);
  out.line(`placeholders: median ${p.medianMs} ms, p95 ${p.p95Ms} ms | ${p.drawCallsMedian} calls | ${(p.trianglesMedian / 1e6).toFixed(2)}M tris (information)`);
  const fails = [];
  const warns = [];
  if (r.medianMs > BUDGET_MEDIAN_MS) fails.push(`median ${r.medianMs} ms over the ${BUDGET_MEDIAN_MS} ms budget`);
  if (r.unitsDrawnMedian < MIN_DRAWN) fails.push(`only ${r.unitsDrawnMedian} units drawn (need ${MIN_DRAWN})`);
  if (r.models.failed > 0) fails.push(`${r.models.failed} models failed to load`);
  if (r.consoleErrors.length) fails.push(`console errors: ${r.consoleErrors[0]}`);
  if (existsSync(BASE)) {
    const base = JSON.parse(readFileSync(BASE, "utf8"));
    if (base.real && r.medianMs > base.real.medianMs * 1.35) warns.push(`median regressed from ${base.real.medianMs} ms to ${r.medianMs} ms`);
  }
  if (args.save) {
    writeFileSync(BASE, JSON.stringify({ when: report.when, real: { medianMs: r.medianMs, p95Ms: r.p95Ms }, placeholders: { medianMs: p.medianMs } }, null, 2) + "\n");
    out.line("saved reports/baselines/bench-render.json");
  }
  report.fails = fails;
  report.warns = warns;
  out.line(`report ${writeReport("bench-render.json", report)}`);
  for (const w of warns) out.line(`warn: ${w}`);
  for (const f of fails) out.line(`fail: ${f}`);
  if (fails.length) return out.finish("FAIL", String(fails.length));
  return out.finish(warns.length ? "WARN" : "PASS");
}

// Shot runner (docs/TESTING.md section 7): npm run shot -- --set smoke | shot:approve -- --set smoke --reason "..." | sheet -- --set smoke
// Serves the test build in-process, captures each shot deterministically (paused + fixedStep, waits
// on the frame counter), runs code-only checks and writes reports/latest/shots.json + sheet(s).
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { LATEST, ROOT, writeReport } from "./lib.mjs";
import { blankCheck, launch, openGame, pixelStats, shotMode, startPreview, viteBuild } from "./web.mjs";

const SHOT_DIR = LATEST + "shots/";
const BASE_DIR = (set) => ROOT + `reports/baselines/shots/${set}/`;
const DIFF_MAX = 0.002;

function loadSet(set) {
  const p = ROOT + `tools/harness/shotsets/${set}.json`;
  if (!existsSync(p)) throw new Error(`no shot set ${set}`);
  return JSON.parse(readFileSync(p, "utf8")).shots;
}

/** Fractions of green (vegetation), blue (water or sky) and other pixels. */
export function colorCoverage(pngPath) {
  const { data } = PNG.sync.read(readFileSync(pngPath));
  let green = 0;
  let blue = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    n++;
    if (g >= r && g > b + 8) green++;
    else if (b > r + 15) blue++;
  }
  return { green: +(green / n).toFixed(3), blue: +(blue / n).toFixed(3), other: +((n - green - blue) / n).toFixed(3) };
}

function domCheckFn() {
  const els = [...document.querySelectorAll("[data-hud]")].filter((e) => {
    const cs = getComputedStyle(e);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
  const W = innerWidth;
  const H = innerHeight;
  const issues = [];
  const rects = els.map((e) => ({ id: e.getAttribute("data-hud"), r: e.getBoundingClientRect(), e }));
  for (const { id, r, e } of rects) {
    if (r.left < 0 || r.top < 0 || r.right > W || r.bottom > H) issues.push(`${id} off-screen`);
    if (e.scrollWidth > e.clientWidth + 1) issues.push(`${id} text overflow`);
  }
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const A = rects[a].r;
      const B = rects[b].r;
      const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ix > 2 && iy > 2) issues.push(`${rects[a].id} overlaps ${rects[b].id}`);
    }
  }
  return { count: els.length, issues };
}

async function runSteps(page, steps) {
  for (const s of steps ?? []) {
    const f0 = await page.evaluate(() => window.__game.frames());
    if (s.setCamera) await page.evaluate((c) => window.__game.setCamera(c), s.setCamera);
    if (s.step) await page.evaluate((n) => window.__game.step(n), s.step);
    if (s.setDebug) await page.evaluate((d) => window.__game.setDebug(d), s.setDebug);
    if (s.command) await page.evaluate((c) => window.__game.command(c), s.command);
    if (s.terrainAtFocus)
      await page.evaluate((a) => {
        const c = window.__game.getSummary().camera;
        window.__game.command({ tribe: -1, type: "terrainOp", args: { ...a, x: c.x, y: c.z } });
      }, s.terrainAtFocus);
    await page.waitForFunction((n) => window.__game.frames() >= n, f0 + 3, { timeout: 20000 });
  }
}

export async function captureSet(set, { onlyIds } = {}) {
  const shots = loadSet(set).filter((s) => !onlyIds || onlyIds.includes(s.id));
  mkdirSync(SHOT_DIR, { recursive: true });
  await viteBuild("test");
  const preview = await startPreview();
  const results = [];
  let browser;
  try {
    browser = await launch(shotMode());
    for (const shot of shots) {
      const t0 = Date.now();
      const res = { id: shot.id, file: `reports/latest/shots/${shot.id}.png`, kind: shot.kind, ok: true, reasons: [], checks: {} };
      const fail = (r) => {
        res.ok = false;
        res.reasons.push(r);
      };
      let page;
      try {
        const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(shot.params ?? {}).map(([k, v]) => [k, String(v)])), paused: "1", fixedStep: "1" });
        const opened = await openGame(browser, `${preview.url}?${q}`, { width: shot.width ?? 1280, height: shot.height ?? 720 });
        page = opened.page;
        const before = await page.evaluate(() => window.__game.getSummary().render);
        await runSteps(page, shot.steps);
        const after = await page.evaluate(() => window.__game.getSummary());
        res.summary = { tick: after.tick, render: after.render, camera: after.camera };
        if (shot.expectRemesh) {
          const [lo, hi] = shot.expectRemesh;
          const remeshed = after.render.remeshTotal - before.remeshTotal;
          res.checks.remesh = { remeshed, fullRebuilds: after.render.fullRebuilds - before.fullRebuilds };
          if (remeshed < lo || remeshed > hi) fail(`remeshed ${remeshed} chunks, expected ${lo}..${hi}`);
          if (after.render.fullRebuilds !== before.fullRebuilds) fail("terrain edit triggered a full rebuild");
        }
        const path = SHOT_DIR + shot.id + ".png";
        await page.screenshot({ path });
        res.checks.dom = await page.evaluate(domCheckFn);
        const domIssues = res.checks.dom.issues;
        if (res.checks.dom.count < (shot.minHud ?? 1)) fail(`dom: only ${res.checks.dom.count} HUD elements`);
        if (shot.expectDomIssue) {
          if (!domIssues.some((x) => x.includes(shot.expectDomIssue))) fail(`dom: expected an issue matching "${shot.expectDomIssue}" (negative check did not fire)`);
        } else for (const i of domIssues) fail(`dom: ${i}`);
        res.checks.console = opened.consoleErrors.slice(0, 5);
        if (opened.consoleErrors.length) fail(`console: ${opened.consoleErrors[0].slice(0, 120)}`);
        const stats = pixelStats(path);
        res.checks.blank = { ...stats, ...blankCheck(stats) };
        if (!res.checks.blank.ok) fail(res.checks.blank.reason);
        const cov = colorCoverage(path);
        res.checks.coverage = cov;
        for (const [k, [lo, hi]] of Object.entries(shot.coverage ?? {})) if (cov[k] < lo || cov[k] > hi) fail(`coverage ${k} ${cov[k]} outside ${lo}..${hi}`);
        const base = BASE_DIR(set) + shot.id + ".png";
        if (existsSync(base)) {
          const a = PNG.sync.read(readFileSync(path));
          const b = PNG.sync.read(readFileSync(base));
          if (a.width !== b.width || a.height !== b.height) fail("baseline size differs");
          else {
            const diff = new PNG({ width: a.width, height: a.height });
            const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
            const frac = changed / (a.width * a.height);
            res.checks.baseline = { changedFrac: +frac.toFixed(5) };
            if (frac > DIFF_MAX) {
              writeFileSync(SHOT_DIR + shot.id + ".diff.png", PNG.sync.write(diff));
              fail(`baseline diff ${(frac * 100).toFixed(2)}% > ${DIFF_MAX * 100}%`);
            }
          }
        } else res.checks.baseline = { missing: true };
      } catch (e) {
        fail(`capture error: ${String(e.message ?? e).split("\n")[0].slice(0, 160)}`);
      } finally {
        if (page) await page.close().catch(() => {});
      }
      res.ms = Date.now() - t0;
      results.push(res);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await preview.close();
  }
  return results;
}

/** Contact sheet(s): an HTML grid of labeled tiles rendered by Chromium (max 9 tiles per sheet). */
export async function buildSheets(results, title) {
  const tiles = results.filter((r) => existsSync(ROOT + r.file));
  const sheets = [];
  const browser = await launch({ headless: true, gpuArgs: false });
  try {
    for (let s = 0; s * 9 < tiles.length; s++) {
      const part = tiles.slice(s * 9, s * 9 + 9);
      const cells = part
        .map((r) => {
          const b64 = readFileSync(ROOT + r.file).toString("base64");
          const tag = r.ok ? "" : `<b style="color:#c8312e"> FAIL</b>`;
          return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${r.id}${tag}</figcaption></figure>`;
        })
        .join("");
      const html = `<!doctype html><html><body style="margin:0;background:#2b2622;font:14px system-ui;color:#f4f1ea;width:1280px">
        <div style="padding:8px 12px;font-weight:700">${title} (${s + 1})</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 8px 8px">${cells}</div>
        <style>figure{margin:0}img{width:100%;display:block;border-radius:4px}figcaption{padding:3px 2px}</style></body></html>`;
      const page = await browser.newPage({ viewport: { width: 1280, height: 400 }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "load" });
      const name = s === 0 ? "sheet.png" : `sheet-${s + 1}.png`;
      await page.screenshot({ path: LATEST + name, fullPage: true });
      await page.close();
      sheets.push(`reports/latest/${name}`);
    }
  } finally {
    await browser.close();
  }
  return sheets;
}

export async function runShots(out, cmd, args = {}) {
  const set = typeof args.set === "string" ? args.set : "smoke";
  if (cmd === "shot-approve") {
    if (typeof args.reason !== "string" || args.reason.length < 8) return out.finish("FAIL", '1 (shot:approve needs --reason "...")');
    const rep = JSON.parse(readFileSync(LATEST + "shots.json", "utf8"));
    if (rep.set !== set) return out.finish("FAIL", `1 (latest shots are set ${rep.set}, not ${set})`);
    const blocking = rep.results.filter((r) => !r.ok && r.reasons.some((x) => !x.startsWith("baseline diff")));
    if (blocking.length) return out.finish("FAIL", `${blocking.length} (fix failing shots before approving)`);
    mkdirSync(BASE_DIR(set), { recursive: true });
    for (const r of rep.results) copyFileSync(ROOT + r.file, BASE_DIR(set) + r.id + ".png");
    appendFileSync(ROOT + "reports/baselines/APPROVALS.md", `- ${new Date().toISOString().slice(0, 16)} set ${set} (${rep.results.length} shots): ${args.reason}\n`);
    out.line(`approved ${rep.results.length} baselines for ${set}`);
    return out.finish("PASS");
  }
  if (cmd === "sheet") {
    const rep = JSON.parse(readFileSync(LATEST + "shots.json", "utf8"));
    const sheets = await buildSheets(rep.results, `Hearthfall ${rep.set} shots`);
    out.line(`sheets: ${sheets.join(", ")}`);
    return out.finish("PASS");
  }
  const only = typeof args.id === "string" ? args.id.split(",") : undefined;
  const results = await captureSet(set, { onlyIds: only });
  const sheets = await buildSheets(results, `Hearthfall ${set} shots`);
  writeReport("shots.json", { set, when: new Date().toISOString(), sheets, results });
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) out.line(`${r.id}: ${r.reasons.slice(0, 2).join("; ")}`.slice(0, 200));
  const missing = results.filter((r) => r.checks.baseline?.missing).length;
  out.line(`shots: ${results.length - bad.length}/${results.length} pass${missing ? `, ${missing} without baseline` : ""} | sheet ${sheets[0] ?? "none"}`);
  return out.finish(bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} (see reports/latest/shots.json)` : "");
}

export function listBaselines(set) {
  return existsSync(BASE_DIR(set)) ? readdirSync(BASE_DIR(set)) : [];
}

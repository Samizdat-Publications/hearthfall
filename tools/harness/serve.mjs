// M11 production build served as plain static files (no Vite at runtime).
//   npm run serve            serve apps/game/dist on http://127.0.0.1:5182/ until Ctrl+C (for playing)
//   npm run qa -- prod layer build production, serve it in-process, boot the game in Chromium, check
//                            the first frame, all models loaded, no console errors, boot screen gone
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { ROOT, writeReport } from "./lib.mjs";
import { launch, openGame, shotMode, viteBuild } from "./web.mjs";

const DIST = ROOT + "apps/game/dist";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** Serve a folder of static files on 127.0.0.1; returns {url, close}. */
export function startStatic(dir = DIST, port = 5182) {
  const base = resolve(dir) + sep;
  const server = createServer((req, res) => {
    try {
      let path;
      try {
        path = decodeURIComponent((req.url ?? "/").split("?")[0]);
      } catch {
        res.writeHead(400).end("bad request");
        return;
      }
      // resolved path must stay inside the folder (the trailing separator keeps sibling folders such as dist-test out)
      const file = resolve(join(base, path.endsWith("/") ? path + "index.html" : path));
      if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const at = server.address();
      const p = typeof at === "object" && at ? at.port : port;
      done({ url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export async function serveCmd(out, args = {}) {
  if (!existsSync(DIST + "/index.html")) return out.finish("FAIL", "no production build: run npm run build first");
  // BACKLOG 96: --port N (default 5182) and a readable message when the port is taken
  const port = args.port === undefined ? 5182 : Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return out.finish("FAIL", `--port must be a port number, got ${args.port}`);
  let s;
  try {
    s = await startStatic(DIST, port);
  } catch (e) {
    if (e?.code === "EADDRINUSE") return out.finish("FAIL", `port ${port} is in use (is Hearthfall already being served?); try npm run serve -- --port ${port + 1}`);
    throw e;
  }
  console.log(`Hearthfall is being served at ${s.url} (Ctrl+C to stop)`);
  await new Promise(() => {});
}

export async function prodCmd(out) {
  await viteBuild("production");
  const s = await startStatic(DIST, 5183);
  const problems = [];
  const report = {};
  let browser;
  try {
    browser = await launch(shotMode());
    // the production bundle has no debug API unless debug=1 is passed; any param skips the main menu
    const { page, consoleErrors } = await openGame(browser, `${s.url}?debug=1&seed=7`, { timeoutMs: 60000 });
    report.models = await page.evaluate(() => window.__game.models());
    report.boot = await page.evaluate(() => getComputedStyle(document.getElementById("boot")).display);
    report.summary = await page.evaluate(() => ({ tick: window.__game.getSummary().tick, tribes: window.__game.getSummary().tribes.length }));
    if (report.models.failed.length) problems.push(`models failed: ${report.models.failed.join(", ")}`);
    if (report.models.loaded.length < 20) problems.push(`only ${report.models.loaded.length} models loaded`);
    if (report.boot !== "none") problems.push("boot screen still showing");
    if (consoleErrors.length) problems.push(`console: ${consoleErrors[0]}`);
    await page.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    await s.close();
  }
  report.problems = problems;
  out.line(`production build served statically: ${report.models?.loaded.length ?? 0} models, ${report.summary?.tribes ?? 0} tribes, boot ${report.boot}`);
  out.line(`report ${writeReport("prod.json", report)}`);
  for (const p of problems) out.line(`fail: ${p}`);
  return out.finish(problems.length ? "FAIL" : "PASS", problems.length ? String(problems.length) : "");
}

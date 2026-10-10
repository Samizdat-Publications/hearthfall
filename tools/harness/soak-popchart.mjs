// BACKLOG 48: renders the population curves of an economy soak (every tribe of every seed, followers per
// minute) as a line chart PNG for reviews and the making-of archive:
// node tools/harness/soak-popchart.mjs [soak.json] [out.png] [title]
import { readFileSync } from "node:fs";
import { LATEST } from "./lib.mjs";
import { launch } from "./web.mjs";

const src = process.argv[2] ?? LATEST + "soak.json";
const out = process.argv[3] ?? LATEST + "soak-population.png";
const rep = JSON.parse(readFileSync(src, "utf8"));
const curves = (rep.results ?? []).flatMap((r) => (r.metrics?.popByMinute ?? []).map((c, t) => ({ seed: r.seed, tribe: t, ok: r.ok, c })));
if (!curves.length) {
  console.log(`RESULT: FAIL no population curves in ${src}`);
  process.exit(1);
}
const title = process.argv[4] ?? "Economy soak: followers per minute";
const W = 980;
const H = 420;
const maxM = Math.max(...curves.map((k) => k.c.length - 1));
const maxP = Math.max(...curves.map((k) => Math.max(...k.c)));
const px = (m) => 50 + (m / maxM) * (W - 70);
const py = (p) => H - 30 - (p / maxP) * (H - 50);
const palette = ["#e0b04a", "#8fae5a", "#6fa3c8", "#7fc8b4", "#b49ad0", "#d9d27a"];
const lines = curves
  .map((k) => `<polyline fill="none" stroke="${k.ok ? palette[k.tribe % palette.length] : "#ff4040"}" stroke-width="2" stroke-opacity="0.8" points="${k.c.map((p, m) => `${px(m).toFixed(1)},${py(p).toFixed(1)}`).join(" ")}"/>`)
  .join("");
const grid = [0, 0.25, 0.5, 0.75, 1]
  .map((f) => Math.round(f * maxP))
  .map((p) => `<line x1="50" x2="${W - 20}" y1="${py(p)}" y2="${py(p)}" stroke="#4a423a"/><text x="42" y="${py(p) + 5}" text-anchor="end">${p}</text>`)
  .join("");
const ticks = Array.from({ length: Math.floor(maxM / 5) + 1 }, (_, i) => i * 5)
  .map((m) => `<text x="${px(m)}" y="${H - 8}" text-anchor="middle">${m}</text>`)
  .join("");
const seeds = new Set(curves.map((k) => k.seed)).size;
const clean = (rep.results ?? []).filter((r) => r.ok).length;
const html = `<!doctype html><html><body>
<h1>${title}</h1>
<p>${seeds} seeds x ${curves.length / seeds} tribes, economy bot only, ${clean}/${seeds} seeds clean. One line per tribe, colored by tribe; red marks a failed seed; a flat line is a tribe whose island is full. Minutes along the bottom.</p>
<svg width="${W}" height="${H}" font-size="14" fill="#cfc6b8">${grid}${ticks}${lines}</svg>
<style>body{margin:0;padding:28px 36px;width:1028px;background:#2b2622;color:#f4f1ea;font:18px system-ui}h1{font-size:30px;margin:0 0 6px}p{color:#cfc6b8;margin:0 0 18px}</style></body></html>`;
const browser = await launch({ headless: true, gpuArgs: false });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 400 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out, fullPage: true });
} finally {
  await browser.close();
}
console.log(`RESULT: PASS ${out}`);

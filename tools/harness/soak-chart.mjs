// BACKLOG 6: renders the last difficulty soak (reports/latest/soak.json, --mode difficulty) as a bar
// chart PNG for reviews and the making-of archive: node tools/harness/soak-chart.mjs [out.png]
import { readFileSync } from "node:fs";
import { LATEST } from "./lib.mjs";
import { launch } from "./web.mjs";

const out = process.argv[2] ?? LATEST + "soak-difficulty.png";
const rep = JSON.parse(readFileSync(LATEST + "soak.json", "utf8"));
const per = rep.metrics?.difficulty;
if (!per) {
  console.log("RESULT: FAIL no difficulty soak in reports/latest/soak.json");
  process.exit(1);
}
const order = ["easy", "hard", "brutal"].filter((k) => per[k]);
const colors = { won: "#e0b04a", ahead: "#8fae5a", behind: "#6d6a8a", lost: "#b8453a" };
const bars = order
  .map((lv) => {
    const v = per[lv];
    const seg = (k) => `<div style="flex:${v[k]};background:${colors[k]}" title="${k} ${v[k]}">${v[k] ? v[k] : ""}</div>`;
    return `<div class="row"><div class="lv">${lv}</div><div class="bar">${seg("won")}${seg("ahead")}${seg("behind")}${seg("lost")}</div><div class="sc">${v.score.toFixed(2)}</div></div>`;
  })
  .join("");
const legend = Object.entries(colors)
  .map(([k, c]) => `<span><i style="background:${c}"></i>${k === "ahead" || k === "behind" ? "unfinished, " + k : k}</span>`)
  .join("");
const html = `<!doctype html><html><body>
<h1>Difficulty levels v a normal opponent</h1>
<p>${rep.metrics.minutes} min matches, ${per[order[0]].n} seeds per level, same personality both sides, sides alternated. Score: win 1, unfinished but ahead 0.5.</p>
${bars}<div class="legend">${legend}</div>
<style>body{margin:0;padding:28px 36px;width:1028px;background:#2b2622;color:#f4f1ea;font:18px system-ui}h1{font-size:30px;margin:0 0 6px}p{color:#cfc6b8;margin:0 0 26px}
.row{display:flex;align-items:center;gap:14px;margin:14px 0}.lv{width:90px;font-weight:700;text-transform:capitalize;font-size:22px}.bar{flex:1;display:flex;height:54px;border-radius:6px;overflow:hidden;background:#3a332d}
.bar div{display:flex;align-items:center;justify-content:center;font-weight:700;color:#1d1915}.sc{width:70px;text-align:right;font-size:26px;font-weight:800;color:#e0b04a}
.legend{margin-top:22px;display:flex;gap:22px;color:#cfc6b8}.legend i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:-2px}</style></body></html>`;
const browser = await launch({ headless: true, gpuArgs: false });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 300 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out, fullPage: true });
} finally {
  await browser.close();
}
console.log(`RESULT: PASS ${out}`);

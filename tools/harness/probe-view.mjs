// Debug probe: print the minimap view outline for a URL and camera (node tools/harness/probe-view.mjs "<query>" '<camera json>').
import { launch, openGame, shotMode, startPreview, viteBuild } from "./web.mjs";

const [query = "?seed=7&level=continents&tribes=2&camera=default&paused=1&fixedStep=1", cam = '{"zoom":0.12}'] = process.argv.slice(2);
await viteBuild("test");
const preview = await startPreview();
let browser;
try {
  browser = await launch(shotMode());
  const { page } = await openGame(browser, preview.url + query);
  await page.evaluate((c) => window.__game.setCamera(c), JSON.parse(cam));
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = await page.evaluate(() => ({ cam: window.__game.getSummary().camera, pts: window.__game.viewOutline(), center: window.__game.pickTerrain(innerWidth / 2, innerHeight / 2), corner: window.__game.pickTerrain(0, 0) }));
  console.log(JSON.stringify({ cam: out.cam, center: out.center, corner: out.corner }));
  console.log((out.pts ?? []).map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" "));
} finally {
  if (browser) await browser.close();
  await preview.close();
}

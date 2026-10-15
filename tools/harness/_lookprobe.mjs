// Dev probe: shoot a few in-game views at a given size for a look audit (node tools/harness/_lookprobe.mjs <outDir> [width] [height] [extraQuery] [build:0|1]).
import { launch, openGame, shotMode, startPreview, viteBuild } from "./web.mjs";
const [outDir, w = "2560", h = "1440", extra = "", doBuild = "1"] = process.argv.slice(2);
if (doBuild === "1") await viteBuild("test");
const preview = await startPreview();
const views = [
  ["village_default", "?seed=7&level=continents&tribes=2&camera=default&paused=1&fixedStep=1", null],
  ["village_close", "?seed=7&level=continents&tribes=2&camera=close&paused=1&fixedStep=1", null],
  ["camp_hill", "?campaign=the_hill&camera=default&paused=1&fixedStep=1", null],
  ["camp_ash_peak", "?campaign=ash_peak&camera=default&reveal=1&paused=1&fixedStep=1", null],
];
let browser;
try {
  browser = await launch(shotMode());
  for (const [id, q] of views) {
    const { page } = await openGame(browser, preview.url + q + extra, { width: +w, height: +h, minFrames: 8 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outDir}/${id}.png` });
    await page.close();
    console.log("shot", id);
  }
} finally {
  if (browser) await browser.close();
  await preview.close();
}

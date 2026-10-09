// M8 end-to-end flow (docs/TESTING.md section 6): main menu, settings with a key rebind, skirmish
// setup, play, pause, save, load (same tick and hash), forced win via the debug API, end screen,
// back to the main menu. Runs at 1280x720 and 2560x1440 with the DOM layout check on every screen
// and fails on any console error. Captures each screen to reports/latest/e2e/.
import { mkdirSync } from "node:fs";
import { LATEST, writeReport } from "./lib.mjs";
import { domCheckFn } from "./shots.mjs";
import { launch, openGame, shotMode, startPreview, viteBuild } from "./web.mjs";

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 2560, height: 1440 },
];
const DIR = LATEST + "e2e/";

async function flow(browser, url, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const res = { viewport: tag, ok: true, screens: [], problems: [] };
  const { page, consoleErrors } = await openGame(browser, url + "?menu=1", vp);
  const problem = (s) => {
    res.ok = false;
    res.problems.push(s);
  };
  const screenIs = (s) => page.waitForFunction((x) => window.__game.screen() === x, s, { timeout: 15000 });
  const click = (ui) => page.click(`[data-ui="${ui}"]`, { timeout: 10000 });
  const settle = async () => {
    const f0 = await page.evaluate(() => window.__game.frames());
    await page.waitForFunction((n) => window.__game.frames() >= n, f0 + 3, { timeout: 15000 });
  };
  const check = async (name) => {
    await settle();
    const dom = await page.evaluate(domCheckFn);
    if (!dom.count) problem(`${name}: no data-hud elements`);
    for (const i of dom.issues) problem(`${name}: ${i}`);
    await page.screenshot({ path: `${DIR}${tag}-${name}.png` });
    res.screens.push({ name, count: dom.count, issues: dom.issues.length });
  };
  try {
    await screenIs("main");
    await check("main");
    // settings: rebind the help key to J, then reset
    await click("settings");
    await screenIs("settings");
    await click("key-help");
    await page.keyboard.press("j");
    const bound = await page.textContent('[data-ui="key-help"]');
    if (bound?.trim() !== "J") problem(`rebind: help key shows ${bound}`);
    await check("settings");
    await click("keys-reset");
    await click("back");
    await screenIs("main");
    // skirmish setup: small map, two opponents
    await click("skirmish");
    await screenIs("setup");
    await page.selectOption('[data-ui="setup-size"]', "96");
    await click("setup-add");
    await check("setup");
    await click("start");
    await screenIs("none");
    const tribes = await page.evaluate(() => window.__game.getSummary().tribes.length);
    if (tribes !== 3) problem(`skirmish has ${tribes} tribes, expected 3`);
    await page.evaluate(() => window.__game.step(200));
    await check("play");
    // pause, save to slot 1, load it back
    await page.keyboard.press("p");
    await screenIs("pause");
    await check("pause");
    await click("save");
    await screenIs("saves");
    await click("save-1");
    await page.waitForFunction(() => window.__game.lastSave() !== null, null, { timeout: 15000 });
    await check("saves");
    await click("back");
    await screenIs("pause");
    await click("load");
    await screenIs("saves");
    await click("load-1");
    await screenIs("none");
    const saved = await page.evaluate(() => window.__game.lastSave());
    const loaded = await page.evaluate(() => window.__game.lastLoad());
    res.save = { saved, loaded };
    if (!loaded || loaded.hash !== saved.hash || loaded.tick !== saved.tick) problem(`load: ${JSON.stringify(loaded)} differs from save ${JSON.stringify(saved)}`);
    // forced win, end screen, back to the menu
    const ended = await page.evaluate(() => window.__game.forceWin());
    if (!ended?.won) problem(`forceWin: ended ${JSON.stringify(ended)}`);
    await screenIs("end");
    await check("end");
    const title = await page.textContent('[data-ui="end-title"]');
    if (title?.trim() !== "Victory") problem(`end title ${title}`);
    await click("main-menu");
    await screenIs("main");
    await settle();
  } catch (e) {
    problem(String(e.message ?? e).split("\n")[0].slice(0, 200));
  }
  for (const c of consoleErrors) problem(`console: ${c}`);
  await page.context().close();
  return res;
}

export default async function e2eCmd(out) {
  mkdirSync(DIR, { recursive: true });
  await viteBuild("test");
  const preview = await startPreview();
  const results = [];
  let browser;
  try {
    browser = await launch(shotMode());
    for (const vp of VIEWPORTS) results.push(await flow(browser, preview.url, vp));
  } finally {
    if (browser) await browser.close();
    await preview.close();
  }
  writeReport("e2e.json", results);
  let bad = 0;
  for (const r of results) {
    out.line(`${r.viewport}: ${r.ok ? "ok" : "FAIL"} (${r.screens.length} screens${r.save?.loaded ? `, load tick ${r.save.loaded.tick} hash ${r.save.loaded.hash.slice(0, 8)}` : ""})`);
    for (const p of r.problems.slice(0, 4)) out.line(`  ${p}`);
    if (!r.ok) bad++;
  }
  return out.finish(bad ? "FAIL" : "PASS", bad ? `${bad} (see reports/latest/e2e.json)` : "");
}

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

/** M11: a startup failure shows the fatal panel with the reason instead of a blank page. */
async function bootFailure(browser, url) {
  const res = { viewport: "startup failure", ok: true, screens: [], problems: [] };
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(url + "?scenario=__missing_scenario__", { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("fatal")).display !== "none", null, { timeout: 15000 });
    const msg = await page.evaluate(() => document.getElementById("fatal-msg").textContent);
    if (!/unknown scenario/.test(msg)) res.problems.push(`fatal panel reason: ${msg}`);
    res.screens.push("fatal");
  } catch (e) {
    res.problems.push(`fatal panel never showed: ${String(e.message).split("\n")[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  // a frame that throws every time must stop the loop with the fatal panel, not spin behind a notice
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await p2.goto(url + "?seed=7", { waitUntil: "load", timeout: 30000 });
    await p2.waitForFunction(() => window.__game && window.__game.frames() > 0, null, { timeout: 30000 });
    await p2.evaluate(() => window.__game.forceFrameError());
    await p2.waitForFunction(() => getComputedStyle(document.getElementById("fatal")).display !== "none", null, { timeout: 30000 });
    const why = await p2.evaluate(() => document.getElementById("fatal-why").textContent);
    if (!/repeated errors/.test(why)) res.problems.push(`frame failure panel text: ${why}`);
    res.screens.push("fatal-frame");
  } catch (e) {
    res.problems.push(`frame failure never showed the fatal panel: ${String(e.message).split("\n")[0]}`);
  } finally {
    await p2.close().catch(() => {});
  }
  res.ok = res.problems.length === 0;
  return res;
}

async function flow(browser, url, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const res = { viewport: tag, ok: true, screens: [], problems: [] };
  const { page, consoleErrors } = await openGame(browser, url + "?menu=1", vp);
  const problem = (s) => {
    res.ok = false;
    res.problems.push(s);
  };
  const screenIs = (s) => page.waitForFunction((x) => window.__game.screen() === x, s, { timeout: 15000 });
  // M11 boot screen: gone once the first frame is drawn and the models are in
  const bootShown = await page.evaluate(() => getComputedStyle(document.getElementById("boot")).display !== "none");
  if (bootShown) problem("boot screen still showing after the models loaded");
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
    // BACKLOG 8: colorblind tribe colors and a 125 percent interface apply at once and pass the layout checks
    await page.selectOption('[data-ui="set-palette"]', "colorblind");
    await page.selectOption('[data-ui="set-uiscale"]', "125");
    const a11y = await page.evaluate(() => window.__game.a11y());
    if (a11y.uiScale !== "1.25" || a11y.tribePal.crimson !== "#E95D0B") problem(`a11y settings: ${JSON.stringify(a11y)}`);
    await check("settings-a11y");
    // BACKLOG 14a: the miniature focus setting switches the tilt-shift pass at once
    await page.selectOption('[data-ui="set-miniature"]', "off");
    const lookOff = await page.evaluate(() => window.__game.look());
    await page.selectOption('[data-ui="set-miniature"]', "default");
    const lookOn = await page.evaluate(() => window.__game.look());
    if (lookOff.tilt !== "off" || lookOn.tilt === "off") problem(`miniature setting: off gave ${lookOff.tilt}, default gave ${lookOn.tilt}`);
    // BACKLOG 14: lighting and weather settings apply at once (evening dims the sun, rain draws streaks)
    await page.selectOption('[data-ui="set-lighting"]', "evening");
    await page.selectOption('[data-ui="set-weather"]', "rain");
    const dusk = await page.evaluate(() => window.__game.look());
    await page.selectOption('[data-ui="set-lighting"]', "default");
    await page.selectOption('[data-ui="set-weather"]', "clear");
    const gold = await page.evaluate(() => window.__game.look());
    if (!(dusk.intensity < gold.intensity) || dusk.rain <= 0 || gold.rain !== 0) problem(`lighting settings: evening rain ${JSON.stringify(dusk)}, default clear ${JSON.stringify(gold)}`);
    await page.selectOption('[data-ui="set-uiscale"]', "100");
    await click("keys-reset");
    await click("back");
    await screenIs("main");
    // skirmish setup: small map, two opponents
    await click("skirmish");
    await screenIs("setup");
    await page.selectOption('[data-ui="setup-size"]', "96");
    await click("setup-add");
    // a map the generator cannot make (continents 96, 4 tribes, seed 11) keeps the setup open with an error
    await click("setup-add");
    await page.fill('[data-ui="setup-seed"]', "11");
    await page.dispatchEvent('[data-ui="setup-seed"]', "change");
    await click("start");
    await settle();
    const genErr = await page.evaluate(() => ({ screen: window.__game.screen(), err: document.querySelector(".menu-error")?.textContent ?? "" }));
    if (genErr.screen !== "setup" || !/could not be generated/.test(genErr.err)) problem(`generator failure on start: ${JSON.stringify(genErr)}`);
    await click("setup-remove-3");
    await page.fill('[data-ui="setup-seed"]', "1");
    await page.dispatchEvent('[data-ui="setup-seed"]', "change");
    // BACKLOG 13: a victory variant from the setup reaches the sim, the HUD and the end screen
    await page.selectOption('[data-ui="setup-victory"]', "king_of_hill");
    const vicText = await page.textContent('[data-ui="setup-victory-text"]');
    if (!/4 minutes/.test(vicText ?? "")) problem(`victory hint for King of the Hill: ${vicText}`);
    await check("setup");
    await click("start");
    await screenIs("none");
    const rules = await page.evaluate(() => window.__game.rules());
    if (rules?.id !== "king_of_hill" || rules.winner !== -1) problem(`skirmish rules ${JSON.stringify(rules)}`);
    const tribes = await page.evaluate(() => window.__game.getSummary().tribes.length);
    if (tribes !== 3) problem(`skirmish has ${tribes} tribes, expected 3`);
    await page.evaluate(() => window.__game.step(200));
    await check("play");
    // BACKLOG 8: ordering the Shaper speaks a bark, which shows its subtitle
    await page.keyboard.press("s");
    await page.mouse.click(vp.width / 2 + 30, vp.height / 2 + 30, { button: "right" });
    const sub = await page.waitForSelector('[data-hud="subtitle"]', { timeout: 5000 }).then((e) => e.textContent(), () => null);
    if (!sub || !/^Shaper:/.test(sub.trim())) problem(`no Shaper subtitle after an order: ${JSON.stringify(await page.evaluate(() => window.__game.a11y().subtitle))}`);
    // the music director runs every frame, not only on frames with sim events (M10 review)
    const m0 = await page.evaluate(() => window.__game.audio().music);
    await settle();
    const m1 = await page.evaluate(() => window.__game.audio().music);
    if (!(m1.updates > m0.updates) || m1.stem !== "calm") problem(`music director idle while paused: ${JSON.stringify([m0, m1])}`);
    // the minimap footprint must not depend on whether a frame was rendered since the camera moved
    await page.evaluate(() => window.__game.setCamera("mid"));
    await settle();
    const before = await page.evaluate(() => {
      window.__game.setCamera({ yaw: 1.1, zoom: 0.2 });
      return window.__game.viewOutline(true);
    });
    await settle();
    const after = await page.evaluate(() => window.__game.viewOutline(true));
    // and the minimap must redraw within a few animation frames of a camera move while paused (as in shots),
    // not on the 250 ms HUD timer
    const current = await page.evaluate(async () => {
      window.__game.pause(true);
      window.__game.setCamera({ yaw: 0.4, zoom: 0.25 });
      for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
      const ok = window.__game.minimapCurrent();
      window.__game.pause(false);
      return ok;
    });
    if (!current) problem("minimap still shows the old camera footprint 4 frames after a camera move");
    if (JSON.stringify(before) !== JSON.stringify(after)) problem(`minimap footprint before the next frame differs from after it: ${JSON.stringify(before?.slice(0, 2))} vs ${JSON.stringify(after?.slice(0, 2))}`);
    // BACKLOG 82: a control group (the selected Shaper) and a camera bookmark, which a load must clear
    await page.keyboard.press("Control+1");
    await page.keyboard.press("Control+F1");
    const ctl0 = await page.evaluate(() => window.__game.controls());
    if (ctl0.groups[1] < 1 || ctl0.bookmarks !== 1) problem(`control group or bookmark not set: ${JSON.stringify(ctl0)}`);
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
    // BACKLOG 76: 200 ticks on from the save, then the same 200 ticks on from the loaded game must agree
    const ahead = await page.evaluate(() => {
      window.__game.step(window.__game.lastSave().tick + 200 - window.__game.getSummary().tick);
      return { tick: window.__game.getSummary().tick, hash: window.__game.hash() };
    });
    await click("load");
    await screenIs("saves");
    await click("load-1");
    await screenIs("none");
    const saved = await page.evaluate(() => window.__game.lastSave());
    const loaded = await page.evaluate(() => window.__game.lastLoad());
    res.save = { saved, loaded };
    if (!loaded || loaded.hash !== saved.hash || loaded.tick !== saved.tick) problem(`load: ${JSON.stringify(loaded)} differs from save ${JSON.stringify(saved)}`);
    // the frame loop may already have run a tick since the load: step to the same absolute tick, paused
    const again = await page.evaluate(() => {
      window.__game.pause(true);
      window.__game.step(window.__game.lastSave().tick + 200 - window.__game.getSummary().tick);
      window.__game.pause(false);
      return { tick: window.__game.getSummary().tick, hash: window.__game.hash() };
    });
    res.loadStep = { ahead, again };
    if (again.tick !== ahead.tick || again.hash !== ahead.hash) problem(`200 ticks after load ${JSON.stringify(again)} differ from 200 ticks after the save ${JSON.stringify(ahead)}`);
    // BACKLOG 82: the load cleared groups and bookmarks, and loading the same save twice more leaks no geometry
    await settle();
    const ctl1 = await page.evaluate(() => window.__game.controls());
    if (ctl1.groups.some((g) => g > 0) || ctl1.bookmarks !== 0) problem(`a load kept control groups or bookmarks: ${JSON.stringify(ctl1)}`);
    const geos = [ctl1.geometries];
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press("p");
      await screenIs("pause");
      await click("load");
      await screenIs("saves");
      await click("load-1");
      await screenIs("none");
      await settle();
      geos.push((await page.evaluate(() => window.__game.controls())).geometries);
    }
    res.geometries = geos;
    if (geos[2] > geos[1] || geos[1] > geos[0] + 8) problem(`GPU geometries grow across reloads of one save: ${geos.join(", ")}`);
    // forced win, end screen, back to the menu
    const ended = await page.evaluate(() => window.__game.forceWin());
    if (!ended?.won) problem(`forceWin: ended ${JSON.stringify(ended)}`);
    await screenIs("end");
    await check("end");
    const title = await page.textContent('[data-ui="end-title"]');
    if (title?.trim() !== "Victory") problem(`end title ${title}`);
    const tag = await page.textContent('[data-ui="end-tag"]');
    const vic = await page.evaluate(() => window.__game.rules());
    if (vic?.winner !== 0 || vic.why !== "conquest" || tag?.trim() !== "Every rival tribe has fallen.") problem(`variant end: ${JSON.stringify(vic)} tag ${tag}`);
    await click("main-menu");
    await screenIs("main");
    await settle();
    // M9 campaign: only the first level is open; win it, go on to the next, and the menu remembers
    await click("campaign");
    await screenIs("campaign");
    const order = await page.$$eval('.route-node[data-ui^="level-"]', (els) => els.map((e) => ({ ui: e.getAttribute("data-ui"), disabled: e.disabled })));
    if (order.length < 3 || order[0].disabled || !order.slice(1).every((l) => l.disabled)) problem(`campaign: open levels ${JSON.stringify(order)}`);
    await check("campaign");
    // BACKLOG 9: the route map picks the frontier level; its card plays it
    const card = await page.textContent('[data-ui="campaign-card"]');
    if (!card?.includes("1.")) problem(`campaign card does not show the first level: ${card}`);
    await click(order[0].ui);
    await click("level-play");
    await screenIs("none");
    await page.evaluate(() => window.__game.step(60));
    const lv = await page.evaluate(() => window.__game.level());
    if (!lv || `level-${lv.id}` !== order[0].ui) problem(`campaign: running level ${JSON.stringify(lv)}`);
    const objectives = await page.$$eval('[data-hud-part^="objective-"]', (els) => els.length);
    if (!objectives) problem("campaign: no level objectives in the HUD");
    await check("level");
    const won = await page.evaluate(() => window.__game.winLevel());
    if (!won?.won) problem(`winLevel: ended ${JSON.stringify(won)}`);
    await screenIs("end");
    const lvTitle = await page.textContent('[data-ui="end-title"]');
    if (lvTitle?.trim() !== "Level won") problem(`level end title ${lvTitle}`);
    await check("level-end");
    await click("next-level");
    await screenIs("none");
    const next = await page.evaluate(() => window.__game.level());
    if (!next || `level-${next.id}` !== order[1].ui) problem(`next level: ${JSON.stringify(next)}`);
    await page.keyboard.press("p");
    await screenIs("pause");
    await click("quit");
    await screenIs("main");
    await click("campaign");
    await screenIs("campaign");
    const open2 = await page.$eval(`[data-ui="${order[1].ui}"]`, (e) => !e.disabled);
    if (!open2) problem("campaign: the second level is still closed after winning the first");
    // BACKLOG 85: a real loss: an idle player loses the shrine race of level 2, and the end screen says why
    await click(order[1].ui);
    await click("level-play");
    await screenIs("none");
    await page.evaluate(() => window.__game.step(20 * 240));
    await screenIs("end");
    const lost = { title: await page.textContent('[data-ui="end-title"]'), tag: await page.textContent('[data-ui="end-tag"]') };
    if (lost.title?.trim() !== "Level lost" || lost.tag?.trim() !== "A rival tribe claimed the site first.") problem(`level loss end screen ${JSON.stringify(lost)}`);
    if (await page.$('[data-ui="next-level"]')) problem("a lost level offers Next level");
    await click("main-menu");
    await screenIs("main");
    // and the last level's win completes the campaign: no Next level
    const last = order[order.length - 1].ui.slice("level-".length);
    await page.evaluate((id) => window.__game.playLevel(id), last);
    await screenIs("none");
    await page.evaluate(() => window.__game.winLevel());
    await screenIs("end");
    const fin = await page.textContent('[data-ui="end-tag"]');
    if (!/campaign is complete/.test(fin ?? "") || (await page.$('[data-ui="next-level"]'))) problem(`last level end screen: ${fin}`);
    await click("main-menu");
    await screenIs("main");
    // BACKLOG 11: a Forge skirmish: the setup option starts a Forge, a real left click lands a brush stroke,
    // orders wait, and Ready (with the AI's own) ends it so the match runs
    await click("skirmish");
    await screenIs("setup");
    await page.selectOption('[data-ui="setup-forge"]', "on");
    await click("start");
    await screenIs("none");
    const f0 = await page.evaluate(() => window.__game.forge());
    if (!f0?.running || !(await page.$('[data-hud="forge"]'))) problem(`Forge did not start: ${JSON.stringify(f0)}`);
    await click("forge-lower");
    const spot = await page.evaluate(() => window.__game.forgeSpot());
    if (!spot) problem("no screen spot inside the Forge ring");
    else {
      await page.mouse.click(spot[0], spot[1]);
      await page.evaluate(() => window.__game.step(1));
      const f1 = await page.evaluate(() => window.__game.forge());
      if (f1?.ops[0] !== 1) problem(`a left click in the Forge ring made ${f1?.ops[0]} strokes`);
    }
    await check("forge");
    await click("forge-ready");
    await page.evaluate(() => window.__game.step(20 * 125));
    const f2 = await page.evaluate(() => window.__game.forge());
    if (f2?.running || !f2?.ready[0] || (await page.$('[data-hud="forge"]'))) problem(`Forge did not end: ${JSON.stringify(f2)}`);
    // BACKLOG 75: the defeat path: the local tribe is eliminated and the Defeat end screen shows
    const lostS = await page.evaluate(() => window.__game.forceLose());
    if (!lostS || lostS.won) problem(`forceLose: ended ${JSON.stringify(lostS)}`);
    await screenIs("end");
    const defeat = { title: await page.textContent('[data-ui="end-title"]'), tag: await page.textContent('[data-ui="end-tag"]') };
    if (defeat.title?.trim() !== "Defeat" || defeat.tag?.trim() !== "Your tribe is no more.") problem(`defeat end screen ${JSON.stringify(defeat)}`);
    await click("main-menu");
    await screenIs("main");
    // BACKLOG 12: the map editor: a real left click paints, a goal without its sites blocks Playtest, Save stores
    // the draft, Playtest runs it as a level and quitting the playtest returns to the editor with the draft
    await click("editor");
    await page.waitForSelector('[data-hud="editor"]', { timeout: 10000 });
    const ed0 = await page.evaluate(() => window.__game.editor());
    if (!ed0 || ed0.issues.length) problem(`editor did not open on a valid draft: ${JSON.stringify(ed0?.issues)}`);
    await click("editor-tool-hill");
    const spotE = await page.evaluate(() => {
      const r = document.getElementById("view").getBoundingClientRect();
      return [r.left + r.width * 0.62, r.top + r.height * 0.55];
    });
    await page.mouse.click(spotE[0], spotE[1]);
    const ed1 = await page.evaluate(() => window.__game.editor());
    if ((ed1?.draft.map.paint?.length ?? 0) !== (ed0?.draft.map.paint?.length ?? 0) + 1) problem("a left click in the editor did not paint a hill");
    await page.selectOption('[data-ui="editor-goal"]', "hold");
    if (!(await page.$eval('[data-ui="editor-playtest"]', (e) => e.disabled))) problem("Playtest is enabled while the draft has issues");
    await check("editor");
    await click("editor-tool-reliquary");
    await page.evaluate(() => {
      const n = window.__game.editor().draft.map.size;
      window.__game.editorAt(n / 2, n * 0.3);
      window.__game.editorAt(n / 2, n * 0.7);
    });
    const ed2 = await page.evaluate(() => window.__game.editor());
    if (ed2?.issues.length) problem(`editor issues after placing the sites: ${JSON.stringify(ed2.issues)}`);
    await click("editor-save");
    const stored = await page.evaluate(() => localStorage.getItem("hearthfall.editor.v1"));
    if (!stored?.includes("hold_sites")) problem("Save did not store the draft");
    await click("editor-playtest");
    await page.waitForFunction(() => window.__game.editorTest() && window.__game.level() !== null, null, { timeout: 15000 });
    await page.evaluate(() => window.__game.step(40));
    const lvE = await page.evaluate(() => window.__game.level());
    if (lvE?.id !== "custom_level") problem(`editor playtest runs ${JSON.stringify(lvE)}`);
    await page.keyboard.press("p");
    await screenIs("pause");
    const backTxt = await page.textContent('[data-ui="quit"]');
    if (backTxt?.trim() !== "Back to the editor") problem(`playtest pause quit reads ${backTxt}`);
    await click("quit");
    await page.waitForSelector('[data-hud="editor"]', { timeout: 10000 });
    const ed3 = await page.evaluate(() => window.__game.editor());
    if (ed3?.draft.rules !== "hold_sites" || ed3.draft.setup.filter((x) => x.site).length !== 2) problem("the editor reopened without the draft");
    await click("editor-exit");
    await screenIs("main");
    await click("campaign");
    await screenIs("campaign");
    await click("back");
    await screenIs("main");
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
    results.push(await bootFailure(browser, preview.url));
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

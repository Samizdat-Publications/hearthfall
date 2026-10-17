// Showcase film capture (landing page and README media, not QA).
//   node tools/showcase/film.mjs [--shot village,battle,...] [--nobuild] [--width 1920 --height 1080] [--probe]
// Serves the test build in-process (the window.__game debug API), replaces requestAnimationFrame and
// performance.now with a virtual clock, then advances the page one 1/30 s frame at a time and pipes each
// captured frame into ffmpeg (x264, +faststart). Capture runs slower than real time but the game never
// sees it, so the footage is smooth. Output: reports/showcase/film/<shot>.mp4 plus film.json (shot list).
// Camera moves are scripted per shot; the sim and the AI tribes play themselves (no hand play).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ROOT } from "../harness/lib.mjs";
import { launch, shotMode, startPreview, viteBuild } from "../harness/web.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const flag = (k) => args.includes(`--${k}`);
const W = Number(opt("width", 1920));
const H = Number(opt("height", 1080));
const FPS = 30;
const OUT = ROOT + "reports/showcase/film/";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[film ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

const SKIRMISH = { seed: "11", level: "continents", tribes: "4", ai: "aggressive,sneaky,turtle", difficulty: "normal", reveal: "1" };

/** Shot list. setup runs once after load (fast-forward, find a subject); cam(t, ctx) gives the camera at t in 0..1. */
const SHOTS = {
  village: {
    seconds: 14,
    hud: false,
    params: { ...SKIRMISH, lighting: "golden" },
    async setup(page) {
      await page.evaluate(() => window.__game.step(7200));
      return page.evaluate(() => window.__game.getSummary().tribes[1].hearth);
    },
    cam: (t, h) => ({ x: h[0] + lerp(-3, 2, t), z: h[1] + lerp(2, -1, t), zoom: lerp(0.24, 0.14, ease(t)), yaw: lerp(0.2, 0.9, t) }),
  },
  evening: {
    seconds: 10,
    hud: false,
    params: { ...SKIRMISH, lighting: "evening" },
    async setup(page) {
      await page.evaluate(() => window.__game.step(9000));
      return page.evaluate(() => window.__game.getSummary().tribes[2].hearth);
    },
    cam: (t, h) => ({ x: h[0], z: h[1], zoom: lerp(0.1, 0.16, ease(t)), yaw: lerp(1.6, 2.3, t) }),
  },
  battle: {
    seconds: 16,
    hud: false,
    params: { ...SKIRMISH, lighting: "golden" },
    // scan the AI match for the busiest fight (melee, fireballs, spells with a map position), then film it
    async setup(page) {
      const spot = await page.evaluate(() => {
        const g = window.__game;
        const fights = new Set(["melee", "fireball", "spellCast", "unitDied", "chantBegun", "arrow", "towerShot"]);
        let best = null;
        let win = [];
        for (let k = 0; k < 2400; k++) {
          g.step(10);
          const s = g.getSummary();
          const evs = s.lastEvents.filter((e) => e.tick > s.tick - 10 && fights.has(e.type) && typeof e.x === "number");
          win.push(...evs.map((e) => ({ x: e.x, y: e.y, tick: e.tick })));
          win = win.filter((e) => e.tick > s.tick - 200);
          if (win.length >= 12 && s.tick > 6000) {
            const cx = win.reduce((a, e) => a + e.x, 0) / win.length;
            const cy = win.reduce((a, e) => a + e.y, 0) / win.length;
            const near = win.filter((e) => Math.abs(e.x - cx) < 10 && Math.abs(e.y - cy) < 10).length;
            if (!best || near > best.n) best = { n: near, x: cx, y: cy, tick: s.tick };
            if (near >= 18) break;
          }
        }
        return best;
      });
      log("battle spot", JSON.stringify(spot));
      if (!spot) throw new Error("no fight found");
      // replay deterministically to just before the fight
      await page.reload();
      await waitReady(page);
      await page.evaluate((n) => window.__game.step(n), Math.max(0, spot.tick - 200));
      return [spot.x, spot.y];
    },
    cam: (t, p) => ({ x: p[0] + lerp(-1.5, 1.5, t), z: p[1] + lerp(1, -1, t), zoom: lerp(0.11, 0.07, ease(t)), yaw: lerp(0.5, 1.0, t) }),
  },
  hud: {
    seconds: 12,
    hud: true,
    params: { campaign: "storm_coast", camera: "default", reveal: "1" },
    async setup(page) {
      await page.evaluate(() => window.__game.step(1500));
      return page.evaluate(() => window.__game.getSummary().camera);
    },
    cam: (t, c) => ({ x: c.x + lerp(0, 10, ease(t)), z: c.z + lerp(0, 6, ease(t)), zoom: lerp(0.3, 0.2, ease(t)), yaw: lerp(c.yaw, c.yaw + 0.5, t) }),
  },
  volcano: {
    seconds: 12,
    hud: false,
    params: { campaign: "wild_heart", camera: "default", reveal: "1" },
    async setup(page) {
      await page.evaluate(() => window.__game.step(1500));
      return [128, 134];
    },
    cam: (t, p) => ({ x: p[0] + lerp(-3, 3, t), z: p[1], zoom: lerp(0.38, 0.3, ease(t)), yaw: lerp(0.1, 0.6, t) }),
  },
  menu: {
    seconds: 9,
    hud: true,
    params: { menu: "1" },
    async setup() {
      return null;
    },
    // main menu for 4 s, then the campaign route map
    async during(page, f) {
      if (f === 4 * FPS) await page.evaluate(() => document.querySelector("[data-ui=campaign]")?.click());
    },
    cam: null,
  },
};

/** Spell reel: one tiny scenario per spell, filmed from the start; clips are concatenated into spells.mp4. */
const SPELLS = [
  ["volcano", "spell_volcano_erupts", { x: 32, z: 32 }, 4.5],
  ["raise_land", "spell_raise_land_bridges", { x: 19, z: 32 }, 3.5],
  ["quake", "spell_quake_breaks_buildings", { x: 32, z: 32 }, 4.5],
  ["firerain", "spell_firerain_storm", { x: 27, z: 32 }, 5],
];
for (const [id, scenario, c, seconds] of SPELLS)
  SHOTS[`spell_${id}`] = {
    seconds,
    hud: false,
    params: { scenario, camera: "default", reveal: "1" },
    async setup() {
      return c;
    },
    cam: (t, p) => ({ x: p.x, z: p.z, zoom: lerp(0.13, 0.1, t), yaw: lerp(0.6, 0.85, t) }),
  };

async function waitReady(page) {
  await page.waitForFunction(() => window.__game && window.__game.frames() >= 3, null, { timeout: 120000 });
  await page.waitForFunction(() => !window.__game.models().pending && (!window.__game.fonts || window.__game.fonts()), null, { timeout: 120000 });
}

const CLOCK = (fps) => {
  const realRaf = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  let manual = false;
  let now = 0;
  let queue = [];
  let nextId = 1;
  window.requestAnimationFrame = (cb) => {
    if (!manual) return realRaf(cb);
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (id) => {
    queue = queue.filter((q) => q.id !== id);
    realCancel(id);
  };
  performance.now = () => (manual ? now : realNow());
  window.__film = {
    begin() {
      now = realNow();
      manual = true;
    },
    step() {
      now += 1000 / fps;
      const run = queue;
      queue = [];
      for (const q of run) q.cb(now);
    },
  };
};

async function film(browser, url, id, shot) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  await page.addInitScript(CLOCK, FPS);
  const q = new URLSearchParams({ nosound: "1", ...shot.params });
  await page.goto(`${url}?${q}`, { waitUntil: "load", timeout: 120000 });
  await waitReady(page);
  const ctx = await shot.setup(page);
  // after setup: a setup may reload the page
  if (!shot.hud) await page.addStyleTag({ content: "#hud, #replay, .notes, [data-hud]:not([data-hud^=menu]) { visibility: hidden !important; }" });
  // settle a few real frames so the HUD fits and models upload
  await page.evaluate(() => window.__game.settleHud?.());
  await new Promise((r) => setTimeout(r, 1500));
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => window.__film.begin());
  const file = OUT + id + ".mp4";
  const enc = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const n = Math.round(shot.seconds * FPS);
  for (let f = 0; f < n; f++) {
    const cam = shot.cam ? shot.cam(f / (n - 1), ctx) : null;
    await page.evaluate((c) => {
      if (c) window.__game.setCamera(c);
      window.__film.step();
    }, cam);
    if (shot.during) await shot.during(page, f);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    const buf = Buffer.from(data, "base64");
    if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once("drain", r));
  }
  enc.stdin.end();
  await new Promise((r) => enc.on("close", r));
  const tick = await page.evaluate(() => window.__game.getSummary().tick);
  await page.close();
  log(`${id}: ${n} frames, tick ${tick}, errors ${errors.length}`);
  return { id, file: file.replace(ROOT, ""), seconds: shot.seconds, frames: n, tick, errors: errors.slice(0, 3) };
}

const want = opt("shot", Object.keys(SHOTS).join(",")).split(",");
if (!flag("nobuild")) {
  await viteBuild("test");
  log("test build done");
}
const preview = await startPreview(5193);
let browser;
const results = [];
try {
  browser = await launch(shotMode());
  for (const id of want) {
    if (!SHOTS[id]) throw new Error(`unknown shot ${id}`);
    try {
      results.push(await film(browser, preview.url, id, SHOTS[id]));
    } catch (e) {
      log(`${id} FAILED: ${String(e.message ?? e).split("\n")[0]}`);
      results.push({ id, error: String(e.message ?? e).split("\n")[0] });
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  await preview.close();
}
writeFileSync(OUT + `film-${Date.now()}.json`, JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.error);
console.log(`RESULT: ${bad.length ? "FAIL" : "PASS"} ${results.length - bad.length}/${results.length} shots`);

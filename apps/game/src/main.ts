// Entry point: builds the Game from URL params, mounts the HUD, runs the frame loop and exposes
// window.__game in dev and test builds (docs/ARCHITECTURE.md section 8).
import type { TroopIntent } from "./troops.ts";
import { Game, parseParams, type DebugFlags } from "./game.ts";
import { mountGameHud } from "./hudBridge.ts";
import { fitHud, hudFits } from "./hudFit.ts";
import { mountGameMenus } from "./menuBridge.ts";
import { mountGameEditor } from "./editorBridge.ts";
import { mountGameReplay } from "./replayBridge.ts";
import { drawnViewKey, viewKey, viewOutline } from "./minimap.ts";
import type { CameraState } from "@hearthfall/render";
import { validateLevel, validatePack, type LevelDef } from "@hearthfall/data";
import { makeBot } from "@hearthfall/ai";
import { commandsByTick, createLevelWorld, createScenarioWorld, type CampaignCarry, type ScenarioDef } from "@hearthfall/sim";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const bootEl = document.getElementById("boot");
const noticeEl = document.getElementById("notice");

/** M11: a failure the game cannot recover from shows a readable panel with its cause. */
function showFatal(e: unknown, why?: string): void {
  if (bootEl) bootEl.style.display = "none";
  const msg = String((e as Error)?.message ?? e);
  const w = document.getElementById("fatal-why");
  if (w)
    w.textContent =
      why ??
      (/webgl/i.test(msg)
        ? "The game could not start. It needs a browser with WebGL 2 (a recent Chrome, Edge or Firefox) and hardware acceleration turned on."
        : "The game could not start. The reason is below; details are in the browser console (F12).");
  const m = document.getElementById("fatal-msg");
  if (m) m.textContent = msg.slice(0, 300);
  const f = document.getElementById("fatal");
  if (f) f.style.display = "flex";
}

/** Startup failure (no WebGL, a broken pack, an unknown scenario, a HUD mount error): panel, then rethrow. */
function fatal(e: unknown): never {
  showFatal(e);
  throw e;
}

/** M11: a short non-blocking notice (frame errors, lost graphics context). */
let noticeTimer = 0;
function notice(text: string, ms = 6000): void {
  if (!noticeEl) return;
  noticeEl.textContent = text;
  noticeEl.style.display = "block";
  clearTimeout(noticeTimer);
  if (ms > 0) noticeTimer = window.setTimeout(() => (noticeEl.style.display = "none"), ms);
}

// lost graphics context: three.js restores it itself; if it has not come back after 20 s, give up visibly
let contextTimer = 0;
canvas.addEventListener("webglcontextlost", () => {
  notice("Graphics context lost; restoring...", 0);
  clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => showFatal(new Error("WebGL context lost and not restored"), "The graphics context was lost and did not come back. Reload the page."), 20000);
});
canvas.addEventListener("webglcontextrestored", () => {
  clearTimeout(contextTimer);
  notice("Graphics restored.", 3000);
});
const hudEl = document.getElementById("hud")!;
/** BACKLOG 8: window size and wanted scale the HUD was last fitted to (refitHud) */
let fitKey = "";
function resize() {
  game.renderer.resize(window.innerWidth, window.innerHeight);
}

// everything up to the first frame counts as startup: any throw here shows the fatal panel
let game: Game;
let hud: ReturnType<typeof mountGameHud>;
try {
  game = new Game(canvas, parseParams(location.search));
  hud = mountGameHud(hudEl, game);
  const menus = mountGameMenus(document.getElementById("menus")!, game);
  const editorUi = mountGameEditor(document.getElementById("editor")!, game);
  const replayUi = mountGameReplay(document.getElementById("replay")!, game);
  game.onChange = () => {
    // the HUD hides under a menu screen (and so stays out of the menus' DOM layout checks) and in the map editor
    hudEl.style.display = game.screen === "none" && !game.editor ? "" : "none";
    hud.refresh();
    menus.refresh();
    editorUi.refresh();
    replayUi.refresh();
    refitHud();
  };
  game.onChange();
  window.addEventListener("resize", resize);
  resize();
} catch (e) {
  fatal(e);
}
// BACKLOG 8: refit the HUD scale when the setting or the window changes, or when grown content overlaps
function refitHud() {
  if (game.screen !== "none" || game.editor) return;
  // the visual QA calibration flag overlaps panels on purpose: leave them at the wanted scale
  if (document.body.classList.contains("debug-overlap-hud")) {
    fitKey = "";
    hudEl.style.setProperty("--hud-scale", String(game.uiScaleWanted));
    return;
  }
  const key = `${game.uiScaleWanted} ${innerWidth}x${innerHeight}`;
  if (key !== fitKey || !hudFits(hudEl)) {
    fitKey = key;
    fitHud(hudEl, game.uiScaleWanted);
  }
}
// mana and charges change every tick: refresh the HUD a few times a second
setInterval(() => {
  if (game.screen === "none") hud.refresh();
  refitHud();
}, 250);

// a camera move redraws the HUD (minimap footprint) on the next frame, also while paused, so captures
// taken a few frames after setCamera never show the previous view
let camKey = "";
let frameErrors = 0;
let errorStreak = 0;
/** frames in a row that may throw before the loop gives up and shows the fatal panel */
const FATAL_STREAK = 60;
let forceFrameError = false;
const bootStart = performance.now();
function frame(now: number) {
  try {
    if (forceFrameError) throw new Error("forced frame error (debug)");
    game.frame(now);
    // the boot screen stays until the first frame is drawn and the models are in (or 6 s have passed)
    if (bootEl && bootEl.style.display !== "none" && game.renderer.frames > 0 && (!game.renderer.modelStatus().pending || now - bootStart > 6000)) bootEl.style.display = "none";
    const c = game.renderer.cam;
    const k = `${c.x} ${c.z} ${c.yaw} ${c.zoom} ${c.map}`;
    if (k !== camKey && game.screen === "none") {
      camKey = k;
      hud.refresh();
    }
    errorStreak = 0;
  } catch (e) {
    // a stray error keeps the loop alive (reported the first time and every 100th after it); a frame
    // that fails every time, or a game that never drew its first frame, stops with the fatal panel
    errorStreak++;
    if (frameErrors++ % 100 === 0) {
      console.error("frame error", e);
      notice("Something went wrong in this frame; the game keeps running. Details are in the browser console (F12).");
    }
    if (errorStreak >= FATAL_STREAK || (game.renderer.frames === 0 && now - bootStart > 6000)) {
      console.error("frame loop stopped", e);
      showFatal(e, "The game stopped after repeated errors in its frame loop. Reload the page; details are in the browser console (F12).");
      return;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (__DEBUG_API__ || game.params.debug) {
  (window as unknown as { __game: unknown }).__game = {
    frames: () => game.renderer.frames,
    /** e2e (M11 review): make every frame throw, to check the loop stops with the fatal panel */
    forceFrameError: () => {
      forceFrameError = true;
    },
    getSummary: () => game.summary(),
    /** BACKLOG 14a: the live look knobs (tilt-shift order, retro pixel size) */
    look: () => ({ tilt: game.renderer.retro.opts.tilt?.order ?? "off", pixelScale: game.renderer.retro.opts.pixelScale, ...game.renderer.lightingState() }),
    /**
     * BACKLOG 14a: CPU plus GPU time of one frame (render, then gl.finish waits for the GPU), with the
     * tilt-shift mode switched for the measure ("off", "pre", "post"; the setting comes back after).
     */
    gpuFrameMs: (tilt: string) => {
      game.renderer.setTiltShift(tilt);
      const ctx = game.renderer.gl.getContext();
      const t0 = performance.now();
      game.renderer.render(performance.now() / 1000);
      ctx.finish();
      const ms = performance.now() - t0;
      game.applyQuality();
      return ms;
    },
    getState: (paths?: string[]) => {
      const s = game.summary() as Record<string, unknown>;
      return paths ? Object.fromEntries(paths.map((p) => [p, s[p]])) : s;
    },
    command: (c: { type: string; tribe?: number; args?: Record<string, unknown> }) => game.command(c),
    step: (n = 1) => game.step(n),
    pause: (p = true) => {
      game.paused = p;
    },
    setCamera: (c: string | Partial<CameraState>) => game.renderer.setCamera(c),
    /** shots: terrain height above sea at a cell (BACKLOG 36 quake_sunk) */
    height: (x: number, z: number) => game.world.terrain.get(Math.round(x), Math.round(z)) - game.world.terrain.sea,
    /** look shots: the highest terrain cell as [x, z, height] */
    peak: () => {
      const t = game.world.terrain;
      let best = 0;
      for (let i = 1; i < t.heights.length; i++) if (t.heights[i] > t.heights[best]) best = i;
      return [best % t.size, Math.floor(best / t.size), t.heights[best]];
    },
    /** look shots: the nearest low beach cell to (x, z) (land at most 6 above sea, water at least `deep` within 3 cells) */
    shore: (fx: number, fz: number, deep = 6) => {
      const t = game.world.terrain;
      const x = Math.round(fx);
      const z = Math.round(fz);
      for (let r = 0; r < t.size / 2; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || t.get(x + dx, z + dz) < t.sea || t.get(x + dx, z + dz) > t.sea + 6) continue;
            if (t.sea - t.get(x + dx + 3, z + dz) >= deep || t.sea - t.get(x + dx, z + dz + 3) >= deep || t.sea - t.get(x + dx - 3, z + dz) >= deep || t.sea - t.get(x + dx, z + dz - 3) >= deep)
              return [x + dx, z + dz];
          }
      return [x, z];
    },
    /** BACKLOG 3: draw through the fog of war (render only) */
    setReveal: (on = true) => {
      game.renderer.revealFog = on;
      game.onChange();
    },
    /** BACKLOG 5: pose gallery: every unit plays clip (slot index mod clip count) (render only) */
    setAnimProbe: (on = true) => {
      if (game.renderer.units) game.renderer.units.forceClip = on ? (i: number) => i % 8 : null;
    },
    loadScenario: (id: string) => game.load(id),
    select: (ids: number[]) => {
      game.selection = new Set(ids.map((id) => game.world.ents.index(id)).filter((i) => i >= 0));
      game.onChange();
    },
    selectBox: (x0: number, y0: number, x1: number, y1: number) => game.selectBox(x0, y0, x1, y1, false),
    getSelection: () => [...game.selection].map((i) => game.world.ents.idOf(i)),
    /** M6 troop panel: select an own building by id (lodge or tower), then send a troop intent */
    selectBuilding: (id: number) => {
      game.selectedBuilding = game.world.ents.index(id);
      if (game.selectedBuilding >= 0) game.selection.clear();
      game.onChange();
      return game.selectedBuilding >= 0;
    },
    troop: (it: TroopIntent) => game.troop(it),
    pickTerrain: (px: number, py: number) => game.renderer.pickTerrain(px, py),
    orderAt: (px: number, py: number) => game.orderAt(px, py),
    /** Placement through the real input path: ghost at a screen pixel, then confirm. */
    castAtScreen: (spell: string, px: number, py: number) => {
      game.startTargeting(spell);
      game.updateTargeting(px, py);
      return game.castAt(px, py);
    },
    placeAtScreen: (building: string, px: number, py: number) => {
      game.startPlacing(building);
      game.updatePlacement(px, py);
      const blocked = game.placeBlocked;
      game.confirmPlacement();
      return blocked;
    },
    unitPos: (id: number) => {
      const i = game.world.ents.index(id);
      return i >= 0 ? [game.world.ents.x[i], game.world.ents.y[i]] : null;
    },
    unitScreen: (id: number) => {
      const i = game.world.ents.index(id);
      const u = game.renderer.units;
      return i >= 0 && u ? [u.screenX[i], u.screenY[i]] : null;
    },
    setDebug: (f: DebugFlags) => game.setDebug(f),
    /** M8 game flow: current menu screen, a forced win (god mode eliminate of every rival), save and load records */
    screen: () => game.screen,
    forceWin: () => {
      for (const t of game.world.tribes) if (t.index !== game.localTribe && t.alive) game.command({ tribe: -1, type: "eliminate", args: { tribe: t.index } });
      game.step(1);
      return game.ended;
    },
    /** BACKLOG 75: a forced defeat (god mode eliminate of the local tribe) */
    forceLose: () => {
      game.command({ tribe: -1, type: "eliminate", args: { tribe: game.localTribe } });
      game.step(1);
      return game.ended;
    },
    /** BACKLOG 13: the skirmish victory rules in the sim (null for a level or an old save) */
    rules: () => {
      const r = game.world.rules;
      return r ? { id: r.def.id, winner: r.winner, why: r.why, held: [...r.held] } : null;
    },
    /** BACKLOG 12: the map editor (null outside it), a tool applied at a map cell, and whether a playtest runs */
    editor: () => {
      const ed = game.editor;
      return ed ? { tool: ed.tool, tribe: ed.tribe, issues: [...ed.issues], undo: ed.undo.length, note: ed.note, draft: JSON.parse(JSON.stringify(ed.draft)) } : null;
    },
    editorAt: (x: number, z: number, erase = false) => {
      game.editorApply(x, z, erase);
      return game.editor ? game.editor.issues.length : -1;
    },
    editorTest: () => game.editorTest,
    /** BACKLOG 19: the replay being watched (null outside one), and test hooks to watch, seek and toggle */
    replay: () => {
      const rp = game.replay;
      return rp ? { tick: rp.run.tick, startTick: rp.run.startTick, endTick: rp.run.replay.endTick, speed: rp.speed, follow: rp.follow, verified: rp.verified, seeking: rp.seekTo >= 0, paused: game.paused, hash: game.world.hash().all } : null;
    },
    lastReplay: () => (game.lastReplay ? { endTick: game.lastReplay.endTick, endHash: game.lastReplay.endHash, commands: game.lastReplay.commands.length } : null),
    watchLastReplay: () => {
      if (game.lastReplay) game.watchReplay(game.lastReplay);
      return game.replay !== null;
    },
    replaySeek: (t: number) => game.replaySeek(t, true),
    /** BACKLOG 11: the Forge phase (null without one) and a screen pixel where the local brush may land */
    forge: () => {
      const f = game.world.forge;
      return f ? { running: f.running(), ops: [...f.ops], ready: [...f.ready], endedAt: f.endedAt, secondsLeft: f.remaining() / game.world.cfg.tickHz } : null;
    },
    forgeSpot: () => {
      const f = game.world.forge;
      const c = game.canvas.getBoundingClientRect();
      for (let py = c.top + 40; f && py < c.bottom - 40; py += 16)
        for (let px = c.left + 40; px < c.right - 40; px += 16) {
          const p = game.renderer.pickTerrain(px, py);
          if (p && f.blocker(game.localTribe, p.x, p.z) === null) return [px, py];
        }
      return null;
    },
    /** M9 campaign: the running level (id, outcome 0 none 1 won 2 lost, objectives done), levels won, and a forced level win */
    level: () => (game.world.level ? { id: game.world.level.def.id, outcome: game.world.level.outcome, done: [...game.world.level.done] } : null),
    campaignWon: () => [...game.campaignWon],
    /** BACKLOG 85: start any campaign level (open or not) for the e2e flow */
    playLevel: (id: string) => game.playLevel(id, true),
    winLevel: () => {
      // a level that opens with a Forge decides nothing until it ends: every tribe readies first
      if (game.world.forge?.running()) {
        for (const t of game.world.tribes) game.command({ tribe: t.index, type: "forgeReady" });
        game.step(1);
      }
      game.command({ tribe: -1, type: "completeObjectives" });
      game.step(1);
      return game.ended;
    },
    /** BACKLOG 8: applied accessibility settings (HUD scale CSS variable, tribe colors, current subtitle) */
    a11y: () => ({ uiScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(), hudScale: hudEl.style.getPropertyValue("--hud-scale"), tribePal: { ...game.tribePal }, subtitle: game.subtitle }),
    /** M10 audio: cue hook stats (played, silent stubs, by cue) and the Web Audio player state */
    audio: () => ({ hooks: game.audio.stats(), player: game.player.stats(), music: { stem: game.music.stem, updates: game.music.updates } }),
    /** M10 real models: pending while loading, ids loaded and failed, ids the current layers draw */
    models: () => game.renderer.modelStatus(),
    /** minimap camera outline: screen border samples picked onto the terrain (unwrapped around the view center) */
    viewOutline: (fresh = false) => viewOutline(game, fresh),
    minimapCurrent: () => drawnViewKey === viewKey(game),
    lastSave: () => game.lastSave,
    /** BACKLOG 82: control group sizes, camera bookmarks set and live GPU geometries (a new world resets the first two) */
    /** BACKLOG 37/40: whether the scene is drawn through the orthographic map camera, and its half extents */
    view: () => ({ ortho: (game.renderer.view as { isOrthographicCamera?: boolean }).isOrthographicCamera === true, top: game.renderer.mapCam.top, right: game.renderer.mapCam.right }),
    controls: () => ({ groups: game.groups.map((g) => g.length), bookmarks: game.bookmarks.filter(Boolean).length, geometries: game.renderer.gl.info.memory.geometries }),
    /** BACKLOG 76: the full state hash of the running world */
    hash: () => game.world.hash().all,
    lastLoad: () => game.lastLoad,
    /** Run a scenario-style definition headless in this page (cross-engine determinism check). */
    runDef: (def: ScenarioDef & { levelDef?: unknown; carry?: CampaignCarry }, rawPack: Record<string, unknown>, every = 100) => {
      const res = validatePack(rawPack);
      if (!res.pack) return { error: "pack invalid" };
      // BACKLOG 84: a golden may embed a whole level; scenario and level bots come from makeBot
      let lv: LevelDef | null = null;
      if (def.levelDef) {
        lv = validateLevel(def.levelDef, res.pack.files).level ?? null;
        if (!lv) return { error: "level invalid" };
      }
      const w = lv ? createLevelWorld({ def: lv, carry: def.carry }, res.pack.files, res.pack.hash, makeBot) : createScenarioWorld(def, res.pack.files, res.pack.hash, makeBot);
      const cmds = commandsByTick(def.commands);
      const out: { tick: number; all: string }[] = [];
      while (w.tick < def.runTicks) {
        w.step(cmds(w.tick));
        if (w.tick % every === 0 || w.tick === def.runTicks) out.push({ tick: w.tick, all: w.hash().all });
      }
      return { packHash: res.pack.hash, checkpoints: out };
    },
    webgl: () => {
      const gl = game.renderer.gl.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return { version: gl.getParameter(gl.VERSION) as string, renderer: dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : "unknown" };
    },
  };
}

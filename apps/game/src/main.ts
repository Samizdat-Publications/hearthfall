// Entry point: builds the Game from URL params, mounts the HUD, runs the frame loop and exposes
// window.__game in dev and test builds (docs/ARCHITECTURE.md section 8).
import type { TroopIntent } from "./troops.ts";
import { Game, parseParams, type DebugFlags } from "./game.ts";
import { mountGameHud } from "./hudBridge.ts";
import { mountGameMenus } from "./menuBridge.ts";
import { drawnViewKey, viewKey, viewOutline } from "./minimap.ts";
import type { CameraState } from "@hearthfall/render";
import { validatePack } from "@hearthfall/data";
import { commandsByTick, createScenarioWorld, type ScenarioDef } from "@hearthfall/sim";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const game = new Game(canvas, parseParams(location.search));
const hudEl = document.getElementById("hud")!;
const hud = mountGameHud(hudEl, game);
const menus = mountGameMenus(document.getElementById("menus")!, game);
game.onChange = () => {
  // the HUD hides under a menu screen (and so stays out of the menus' DOM layout checks)
  hudEl.style.display = game.screen === "none" ? "" : "none";
  hud.refresh();
  menus.refresh();
};
game.onChange();
// mana and charges change every tick: refresh the HUD a few times a second
setInterval(() => {
  if (game.screen === "none") hud.refresh();
}, 250);

function resize() {
  game.renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

// a camera move redraws the HUD (minimap footprint) on the next frame, also while paused, so captures
// taken a few frames after setCamera never show the previous view
let camKey = "";
function frame(now: number) {
  game.frame(now);
  const c = game.renderer.cam;
  const k = `${c.x} ${c.z} ${c.yaw} ${c.zoom} ${c.map}`;
  if (k !== camKey && game.screen === "none") {
    camKey = k;
    hud.refresh();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (__DEBUG_API__ || game.params.debug) {
  (window as unknown as { __game: unknown }).__game = {
    frames: () => game.renderer.frames,
    getSummary: () => game.summary(),
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
    /** minimap camera outline: screen border samples picked onto the terrain (unwrapped around the view center) */
    viewOutline: (fresh = false) => viewOutline(game, fresh),
    minimapCurrent: () => drawnViewKey === viewKey(game),
    lastSave: () => game.lastSave,
    lastLoad: () => game.lastLoad,
    /** Run a scenario-style definition headless in this page (cross-engine determinism check). */
    runDef: (def: ScenarioDef, rawPack: Record<string, unknown>, every = 100) => {
      const res = validatePack(rawPack);
      if (!res.pack) return { error: "pack invalid" };
      const w = createScenarioWorld(def, res.pack.files, res.pack.hash);
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

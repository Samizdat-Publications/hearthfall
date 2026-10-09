// Entry point: builds the Game from URL params, mounts the HUD, runs the frame loop and exposes
// window.__game in dev and test builds (docs/ARCHITECTURE.md section 8).
import { Game, parseParams, type DebugFlags } from "./game.ts";
import { mountGameHud } from "./hudBridge.ts";
import type { CameraState } from "@hearthfall/render";
import { validatePack } from "@hearthfall/data";
import { commandsByTick, createScenarioWorld, type ScenarioDef } from "@hearthfall/sim";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const game = new Game(canvas, parseParams(location.search));
const hud = mountGameHud(document.getElementById("hud")!, game);
game.onChange = hud.refresh;
// mana and charges change every tick: refresh the HUD a few times a second
setInterval(() => hud.refresh(), 250);

function resize() {
  game.renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

function frame(now: number) {
  game.frame(now);
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
    pickTerrain: (px: number, py: number) => game.renderer.pickTerrain(px, py),
    orderAt: (px: number, py: number) => game.orderAt(px, py),
    /** Placement through the real input path: ghost at a screen pixel, then confirm. */
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

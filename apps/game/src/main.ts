// Entry point: builds the Game from URL params, mounts the HUD, runs the frame loop and exposes
// window.__game in dev and test builds (docs/ARCHITECTURE.md section 8).
import { Game, parseParams, type DebugFlags } from "./game.ts";
import { mountHud } from "./hud.tsx";
import "./hud.css";
import type { CameraState } from "@hearthfall/render";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const game = new Game(canvas, parseParams(location.search));
const hud = mountHud(document.getElementById("hud")!, game);
game.onChange = hud.refresh;

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
    setDebug: (f: DebugFlags) => game.setDebug(f),
    webgl: () => {
      const gl = game.renderer.gl.getContext();
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return { version: gl.getParameter(gl.VERSION) as string, renderer: dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : "unknown" };
    },
  };
}

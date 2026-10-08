// Minimal Preact HUD until packages/ui lands at M4: title, tick and map line, controls hint.
// Every element carries data-hud so the DOM layout check can find it.
import { render } from "preact";
import { signal } from "@preact/signals";
import type { Game } from "./game.ts";

const info = signal({ tick: 0, map: "", paused: false });

function Hud() {
  const v = info.value;
  return (
    <>
      <div data-hud="title" class="hud-panel hud-title">
        <span class="hud-name">Hearthfall</span>
        <span class="hud-sub">
          {v.map} | tick {v.tick}
          {v.paused ? " | paused" : ""}
        </span>
      </div>
      <div data-hud="help" class="hud-panel hud-help">Q/E rotate | wheel zoom | arrows pan | M map view | F1-F4 bookmarks (Ctrl to set) | Space pause</div>
      <div data-hud="debug-overlap" class="hud-panel hud-overlap">overlap test panel</div>
    </>
  );
}

export function mountHud(el: HTMLElement, game: Game) {
  render(<Hud />, el);
  const refresh = () => {
    const w = game.world;
    info.value = { tick: w.tick, map: `${w.mapInfo.generator} ${w.terrain.size} seed ${w.seed}`, paused: game.paused };
  };
  refresh();
  return { refresh };
}

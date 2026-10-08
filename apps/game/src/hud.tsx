// Minimal Preact HUD until packages/ui lands at M4: title, tick and map line, selection, controls
// hint, box-select overlay. Every panel carries data-hud so the DOM layout check can find it.
import { render } from "preact";
import { signal } from "@preact/signals";
import type { Game } from "./game.ts";

const info = signal({ tick: 0, map: "", paused: false, selected: 0, attack: false, box: null as null | { x0: number; y0: number; x1: number; y1: number } });

function Hud() {
  const v = info.value;
  const b = v.box;
  return (
    <>
      <div data-hud="title" class="hud-panel hud-title">
        <span class="hud-name">Hearthfall</span>
        <span class="hud-sub">
          {v.map} | tick {v.tick}
          {v.paused ? " | paused" : ""}
        </span>
      </div>
      {v.selected > 0 ? (
        <div data-hud="selection" class="hud-panel hud-selection">
          {v.selected} selected{v.attack ? " | attack-move: click a target" : " | right click to move"}
        </div>
      ) : null}
      <div data-hud="help" class="hud-panel hud-help">Drag to select | right click move | A attack-move | S Shaper | Q/E rotate | wheel zoom | M map | Ctrl+1-9 groups</div>
      <div data-hud="debug-overlap" class="hud-panel hud-overlap">overlap test panel</div>
      {b ? <div class="hud-box" style={{ left: Math.min(b.x0, b.x1) + "px", top: Math.min(b.y0, b.y1) + "px", width: Math.abs(b.x1 - b.x0) + "px", height: Math.abs(b.y1 - b.y0) + "px" }} /> : null}
    </>
  );
}

export function mountHud(el: HTMLElement, game: Game) {
  render(<Hud />, el);
  const refresh = () => {
    const w = game.world;
    info.value = { tick: w.tick, map: `${w.mapInfo.generator} ${w.terrain.size} seed ${w.seed}`, paused: game.paused, selected: game.selection.size, attack: game.attackMode, box: game.box };
  };
  refresh();
  return { refresh };
}

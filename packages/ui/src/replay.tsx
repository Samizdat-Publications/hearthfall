// BACKLOG 19: the replay bar. Renders the replay view model; every intent goes back through ReplayActions.
// Shown over the HUD while a replay plays: play or pause, a timeline to scrub, speed (cycles), Follow and Exit.
import { render } from "preact";
import { signal } from "@preact/signals";

export interface ReplayView {
  tick: number;
  startTick: number;
  endTick: number;
  /** clock text for the current tick and the end */
  now: string;
  end: string;
  playing: boolean;
  speed: number;
  speeds: number[];
  follow: boolean;
  seeking: boolean;
  /** null until the end is reached, then whether the world matched the recorded match */
  verified: boolean | null;
}

export interface ReplayActions {
  toggle(): void;
  speed(n: number): void;
  seek(tick: number): void;
  follow(on: boolean): void;
  exit(): void;
}

export const replayModel = signal<ReplayView | null>(null);

function Bar({ act }: { act: ReplayActions }) {
  const m = replayModel.value;
  if (!m) return null;
  return (
    <div data-hud="replay" class="menu-panel replay-bar">
      <span class="replay-tag">Replay</span>
      <button class="menu-small replay-play" data-ui="replay-play" onClick={() => act.toggle()}>
        {m.playing ? "Pause" : m.tick >= m.endTick ? "Again" : "Play"}
      </button>
      <input
        class="replay-time"
        data-ui="replay-time"
        type="range"
        min={m.startTick}
        max={m.endTick}
        step={1}
        value={m.tick}
        onChange={(e) => act.seek(Number((e.target as HTMLInputElement).value))}
      />
      <span class="replay-clock" data-ui="replay-clock">
        {m.seeking ? "seeking" : `${m.now} / ${m.end}`}
      </span>
      <button class="menu-small replay-speed" data-ui="replay-speed" title="Speed" onClick={() => act.speed(m.speeds[(m.speeds.indexOf(m.speed) + 1) % m.speeds.length])}>
        {m.speed}x
      </button>
      <label class="menu-small replay-follow">
        <input type="checkbox" data-ui="replay-follow" checked={m.follow} onChange={(e) => act.follow((e.target as HTMLInputElement).checked)} /> Follow
      </label>
      <button class="menu-small" data-ui="replay-exit" onClick={() => act.exit()}>
        Exit
      </button>
      {m.verified !== null ? (
        <span class={"replay-verified " + (m.verified ? "ok" : "bad")} data-ui="replay-verified">
          {m.verified ? "Verified" : "Out of sync"}
        </span>
      ) : null}
    </div>
  );
}

export function mountReplay(el: HTMLElement, act: ReplayActions): void {
  render(<Bar act={act} />, el);
}

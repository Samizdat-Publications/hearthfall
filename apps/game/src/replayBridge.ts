// BACKLOG 19: the replay bar's view model from Game.replay, and its actions back into Game.
import { mountReplay, replayModel, type ReplayView } from "@hearthfall/ui";
import type { Game } from "./game.ts";

const SPEEDS = [1, 2, 4, 8];

const clock = (ticks: number, hz: number) => {
  const s = Math.floor(ticks / hz);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function mountGameReplay(el: HTMLElement, game: Game): { refresh: () => void } {
  const view = (): ReplayView | null => {
    const rp = game.replay;
    if (!rp || game.screen !== "none") return null;
    const hz = game.world.cfg.tickHz;
    const run = rp.run;
    return {
      tick: run.tick,
      startTick: run.startTick,
      endTick: run.replay.endTick,
      now: clock(run.tick, hz),
      end: clock(run.replay.endTick, hz),
      playing: !game.paused && rp.seekTo < 0 && !run.done,
      speed: rp.speed,
      speeds: SPEEDS,
      follow: rp.follow,
      seeking: rp.seekTo >= 0,
      verified: rp.verified,
    };
  };
  mountReplay(el, {
    toggle: () => game.replayToggle(),
    speed: (n) => game.replaySpeed(n),
    seek: (t) => game.replaySeek(t),
    follow: (on) => game.replayFollow(on),
    exit: () => game.showMainMenu(),
  });
  const refresh = () => {
    replayModel.value = view();
  };
  refresh();
  return { refresh };
}

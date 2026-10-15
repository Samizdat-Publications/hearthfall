// Regression: a survive objective with fromStage counts down from the tick its stage opened, not from the level
// start (the HUD used to subtract the whole level clock, so a later stage showed far too little time left).
import { describe, expect, it } from "vitest";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { createLevelWorld, type World } from "@hearthfall/sim";
import { levelObjectives } from "../src/hudBridge.ts";
import type { Game } from "../src/game.ts";
import { basePack } from "../../../packages/sim/test/helpers.ts";

const def = (objectives: unknown[]): LevelDef => {
  const raw = {
    id: "objectives_test",
    name: "Objectives test",
    order: 99,
    description: "test",
    seed: 3,
    map: { generator: "flat", size: 64, landAboveSea: 20 },
    tribes: [{}],
    spells: [],
    setup: [
      { spawn: "hearth", tribe: 0, at: [12, 12] },
      { spawn: "shaper", tribe: 0, at: [16, 12] },
      { spawn: "settler", tribe: 0, near: [12, 16], count: 3 },
    ],
    objectives,
    lose: [{ type: "timeLimit", seconds: 900 }],
  };
  const res = validateLevel(raw, basePack().files);
  if (!res.level) throw new Error(JSON.stringify(res.issues));
  return res.level;
};

const make = (objectives: unknown[]): World => {
  const p = basePack();
  return createLevelWorld({ def: def(objectives) }, p.files, p.hash);
};

/** the HUD reads only the world and the local tribe */
const texts = (w: World): string[] => levelObjectives({ world: w, localTribe: 0 } as unknown as Game).map((o) => o.text);

const run = (w: World, seconds: number): void => {
  for (let k = 0; k < seconds * w.cfg.tickHz; k++) w.step();
};

describe("survive objective countdown", () => {
  it("a level-long survive counts down from the level start", () => {
    const w = make([{ type: "survive", seconds: 120 }]);
    expect(texts(w)[0]).toBe("Survive 2:00 (2:00 left)");
    run(w, 30);
    expect(texts(w)[0]).toBe("Survive 2:00 (1:30 left)");
  });

  it("a fromStage survive counts down from the tick its stage opened, not from the level start", () => {
    const w = make([
      { type: "survive", seconds: 30 },
      { type: "survive", seconds: 60, fromStage: true, after: 0 },
    ]);
    // the second stage is closed until the first is done: only the first goal and the time limit show
    expect(texts(w)).toHaveLength(2);
    while (!w.level!.done[0]) w.step();
    const opened = w.level!.holdSince[1];
    expect(opened).toBeGreaterThan(0);
    // whole seconds into the stage: the level is 30 s old, the stage is not
    const at = (s: number): string => {
      while (w.tick < opened + s * w.cfg.tickHz) w.step();
      return texts(w)[1];
    };
    expect(at(1)).toBe("Survive 1:00 (0:59 left)");
    expect(at(11)).toBe("Survive 1:00 (0:49 left)");
    expect(at(50)).toBe("Survive 1:00 (0:10 left)");
  });

  it("a finished fromStage survive drops its countdown and ends 20 s after the stage opened", () => {
    const w = make([
      { type: "survive", seconds: 10 },
      { type: "survive", seconds: 20, fromStage: true, after: 0 },
    ]);
    let k = 0;
    while (!w.level!.done[1] && k++ < 40 * w.cfg.tickHz) w.step();
    expect(w.level!.done[1]).toBe(1);
    // done objectives drop the countdown
    expect(texts(w)[1]).toBe("Survive 0:20");
    // the stage opened at 10 s and the goal ended 20 s later
    expect(Math.abs(w.playTick - 30 * w.cfg.tickHz)).toBeLessThanOrEqual(2);
  });

  it("each stage of a chain of fromStage survives counts from its own opening", () => {
    const w = make([
      { type: "survive", seconds: 10 },
      { type: "survive", seconds: 10, fromStage: true, after: 0 },
      { type: "survive", seconds: 45, fromStage: true, after: 1 },
    ]);
    while (!w.level!.done[1]) w.step();
    const opened = w.level!.holdSince[2];
    expect(opened).toBeGreaterThan(w.level!.holdSince[1]);
    while (w.tick < opened + 15 * w.cfg.tickHz) w.step();
    // 20 s of stages are behind it, 15 s of its own: 30 s are left
    expect(texts(w)[2]).toBe("Survive 0:45 (0:30 left)");
  });
});

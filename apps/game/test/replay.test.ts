import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { ReplayRun, decodeReplay, encodeReplay, makeReplay } from "../src/replay.ts";
import { createSkirmish, makeSave, restoreSave, type SkirmishParams } from "../src/session.ts";
import type { BotSpec, Command } from "@hearthfall/sim";
import { makeBot } from "@hearthfall/ai";

const pack = loadBasePack().pack!;
const P: SkirmishParams = { seed: 21, level: "continents", size: 96, tribes: 2, ai: ["aggressive"], difficulty: "normal" };

/** a short match with a few local commands; returns the world, its log and the hash at every 100 ticks */
function play(ticks: number) {
  const w = createSkirmish(pack, P);
  const log: Command[] = [];
  const marks = new Map<number, string>();
  while (w.tick < ticks) {
    const cmds: Command[] = [];
    if (w.tick === 40) cmds.push({ tick: w.tick, tribe: 0, type: "setSplit", args: { spellsPct: 70 } });
    if (w.tick === 260) cmds.push({ tick: w.tick, tribe: 0, type: "setSplit", args: { spellsPct: 20 } });
    if (w.tick === 60) {
      // a real order changes the world (the split alone is not in the hash until it moves mana)
      const h = w.ents.index(w.tribes[0].hearth);
      cmds.push({ tick: w.tick, tribe: 0, type: "move", args: { units: "tribe0.settlers", to: [Math.round(w.ents.x[h]) + 5, Math.round(w.ents.y[h]) + 3] } });
    }
    log.push(...cmds);
    w.step(cmds);
    if (w.tick % 100 === 0) marks.set(w.tick, w.hash().all);
  }
  return { w, log, marks };
}

describe("replays (BACKLOG 19)", () => {
  it("a replay of a fresh match reaches the recorded end hash, and seeking back reproduces earlier hashes", () => {
    const { w, log, marks } = play(600);
    const r = decodeReplay(encodeReplay(makeReplay(w, P, null, log, "x")), pack);
    const run = new ReplayRun(pack, r, 200);
    expect(run.tick).toBe(0);
    expect(run.verified()).toBeNull();
    expect(run.seek(600)).toBe(true);
    expect(run.verified()).toBe(true);
    // back to a checkpoint and between checkpoints
    for (const t of [400, 300, 100, 500]) {
      run.seek(t);
      expect(run.tick).toBe(t);
      expect(run.world.hash().all).toBe(marks.get(t));
    }
    // a budgeted seek moves at most budget ticks per call
    run.seek(0);
    expect(run.seek(300, 120)).toBe(false);
    expect(run.tick).toBe(120);
    // past the end clamps
    expect(run.seek(10_000)).toBe(true);
    expect(run.tick).toBe(600);
    expect(run.done).toBe(true);
  });

  it("BACKLOG 50: a replay records its opponents' specs and plays them back even when the params would build others", () => {
    const { w, log } = play(600);
    const r = decodeReplay(encodeReplay(makeReplay(w, P, null, log, "x")), pack);
    expect(r.bots).toEqual([{ type: "opponent", tribe: 1, personality: "aggressive", difficulty: "normal", offset: 1 }]);
    const run = new ReplayRun(pack, { ...r, params: { ...r.params, ai: ["turtle"] } }, 200);
    expect(run.seek(600)).toBe(true);
    expect(run.verified()).toBe(true);
    // a checkpoint taken during playback keeps the recorded opponents too
    run.seek(300);
    expect(run.world.controllers.map((c) => c.botSpec)).toEqual(r.bots);
  });

  it("a replay of a session loaded from a save starts at the save", () => {
    const a = createSkirmish(pack, P);
    a.run(300);
    const save = makeSave(a, P, [], [], "x");
    const w = restoreSave(pack, save);
    const log: Command[] = [{ tick: w.tick, tribe: 0, type: "setSplit", args: { spellsPct: 90 } }];
    w.step(log);
    w.run(200);
    const run = new ReplayRun(pack, makeReplay(w, P, save, log, "x"));
    expect(run.startTick).toBe(300);
    expect(run.seek(run.replay.endTick)).toBe(true);
    expect(run.verified()).toBe(true);
  });

  it("L6-A: an AI takeover mid-match is recorded as a controller change and attached at its tick on playback", () => {
    const { w, log } = play(300);
    const bot: BotSpec = { type: "opponent", tribe: 0, personality: "turtle", difficulty: "normal", offset: 0 };
    w.controllers.push(makeBot(bot));
    const changes = [{ tick: w.tick, bot }];
    w.run(500);
    const r = decodeReplay(encodeReplay(makeReplay(w, P, null, log, "x", changes)), pack);
    // the recorded opponents are the ones from the start; the takeover comes in at its tick
    expect(r.bots).toEqual([{ type: "opponent", tribe: 1, personality: "aggressive", difficulty: "normal", offset: 1 }]);
    expect(r.controllerChanges).toEqual(changes);
    const run = new ReplayRun(pack, r, 200);
    expect(run.seek(800)).toBe(true);
    expect(run.verified()).toBe(true);
    // seeking back before the takeover and forward again attaches it once
    run.seek(100);
    expect(run.world.controllers.length).toBe(1);
    run.seek(800);
    expect(run.world.controllers.length).toBe(2);
    expect(run.verified()).toBe(true);
    // without the change the AI never plays tribe 0 and the end does not match
    const bare = new ReplayRun(pack, { ...r, controllerChanges: undefined }, 200);
    bare.seek(800);
    expect(bare.verified()).toBe(false);
  });

  it("a replay with a different command log does not verify; foreign data is refused", () => {
    const { w, log } = play(300);
    const r = makeReplay(w, P, null, log.filter((c) => c.type !== "move"), "x");
    const run = new ReplayRun(pack, r);
    run.seek(300);
    expect(run.verified()).toBe(false);
    expect(() => decodeReplay(encodeReplay({ ...r, packHash: "other" }), pack)).toThrow(/different game data/);
    expect(() => decodeReplay("{}", pack)).toThrow(/not a replay/);
    expect(() => decodeReplay("not json", pack)).toThrow(/not a replay/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QUICK_SLOT, SPEED_DEFAULTS, briefingMessages, edgePan, levelLighting, loadQol, nextSpeed, quickLoadBlock, quickSaveBlock, restartKind, speedAllowed, speedCfg, speedLabel, stepPlan, storeQol, type MatchState } from "../src/qol.ts";
import { MemoryKV, SLOTS, readSlot, slotMeta, writeSlot } from "../src/storage.ts";
import { validateUi } from "@hearthfall/data";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { createSkirmish, makeSave } from "../src/session.ts";

const solo: MatchState = { inGame: true, session: true, ended: false, net: false, humans: 1, replay: false, editor: false };

describe("game speed (QoL)", () => {
  it("steps through the ui.json choices and stays put at either end", () => {
    const c = [0.5, 1, 2, 3];
    expect(nextSpeed(c, 1, 1)).toBe(2);
    expect(nextSpeed(c, 2, 1)).toBe(3);
    expect(nextSpeed(c, 3, 1)).toBe(3);
    expect(nextSpeed(c, 1, -1)).toBe(0.5);
    expect(nextSpeed(c, 0.5, -1)).toBe(0.5);
    // a speed no longer offered snaps to the nearest choice
    expect(nextSpeed(c, 2.4, 1)).toBe(2);
    expect(speedLabel(0.5)).toBe("0.5x");
    expect(speedLabel(3)).toBe("3x");
  });

  it("the choices always hold 1x, sorted, and the step cap falls back to the default", () => {
    expect(speedCfg({ choices: [3, 2] }).choices).toEqual([1, 2, 3]);
    expect(speedCfg(undefined)).toEqual(SPEED_DEFAULTS);
    expect(speedCfg({ choices: [2], maxStepsPerFrame: 0 }).maxStepsPerFrame).toBe(SPEED_DEFAULTS.maxStepsPerFrame);
  });

  it("speed only changes how many fixed steps a frame runs: 3x runs three times the steps of 1x", () => {
    const hz = 20;
    const frames = (speed: number) => {
      let acc = 0;
      let steps = 0;
      for (let f = 0; f < 60; f++) {
        const p = stepPlan(acc + 1 / 60, 1 / (hz * speed), 12, speed !== 1);
        steps += p.steps;
        acc = p.rest;
      }
      return steps;
    };
    expect(frames(1)).toBe(20);
    expect(frames(2)).toBe(40);
    expect(frames(3)).toBe(60);
    expect(frames(0.5)).toBe(10);
  });

  it("a slow frame is capped and drops its backlog, so it cannot spiral", () => {
    const tickDt = 1 / 60; // 3x at 20 Hz
    const p = stepPlan(0.25, tickDt, 12, true);
    expect(p.steps).toBe(12);
    expect(p.rest).toBeLessThanOrEqual(tickDt);
    // the next normal frame runs a normal number of steps again
    expect(stepPlan(p.rest + 1 / 60, tickDt, 12, true).steps).toBeLessThanOrEqual(2);
    // without dropping (replays) the backlog is kept for later frames
    const keep = stepPlan(0.25, tickDt, 12, false);
    expect(keep.steps).toBe(12);
    expect(keep.rest).toBeCloseTo(0.25 - 12 * tickDt, 9);
    expect(stepPlan(0, tickDt, 12, true)).toEqual({ steps: 0, rest: 0 });
  });

  it("applies to single player matches and the campaign only, never LAN play, replays or the editor", () => {
    expect(speedAllowed(solo)).toBe(true);
    expect(speedAllowed({ ...solo, net: true })).toBe(false);
    expect(speedAllowed({ ...solo, humans: 2 })).toBe(false);
    expect(speedAllowed({ ...solo, replay: true })).toBe(false);
    expect(speedAllowed({ ...solo, editor: true })).toBe(false);
    expect(speedAllowed({ ...solo, inGame: false })).toBe(false);
  });

  it("data/ui.json carries a valid speed block and edge scroll tunables", () => {
    const raw = JSON.parse(readFileSync(new URL("../../../data/ui.json", import.meta.url), "utf8"));
    const res = validateUi(raw, loadBasePack().pack!.files);
    expect(res.issues).toEqual([]);
    expect(res.file?.speed?.choices).toContain(3);
    expect(res.file?.input.edgeScrollPx).toBeGreaterThan(0);
    expect(res.file?.input.edgeScrollSpeed).toBeGreaterThan(0);
  });
});

describe("quick save slot (QoL)", () => {
  it("is its own slot, apart from the manual slots, and round trips a save", () => {
    expect(QUICK_SLOT < 1 || QUICK_SLOT > SLOTS).toBe(true);
    const pack = loadBasePack().pack!;
    const kv = new MemoryKV();
    const sp = { seed: 3, level: "continents", size: 96, tribes: 2, ai: ["economy"], difficulty: "normal" };
    const w = createSkirmish(pack, sp);
    for (let i = 0; i < 20; i++) w.step([]);
    const s = makeSave(w, sp, [], [], "2026-10-12T00:00:00.000Z");
    expect(writeSlot(kv, QUICK_SLOT, s)).toBe(null);
    for (let n = 1; n <= SLOTS; n++) expect(slotMeta(kv, n)).toBe(null);
    expect(readSlot(kv, QUICK_SLOT).hash).toBe(s.hash);
    expect(slotMeta(kv, QUICK_SLOT)?.tick).toBe(20);
  });

  it("says why it cannot save or load", () => {
    expect(quickSaveBlock(solo)).toBe(null);
    expect(quickSaveBlock({ ...solo, net: true })).toMatch(/LAN/);
    expect(quickSaveBlock({ ...solo, ended: true })).toMatch(/over/);
    expect(quickSaveBlock({ ...solo, session: false })).toMatch(/skirmish or campaign/);
    expect(quickSaveBlock({ ...solo, replay: true })).toMatch(/replay/);
    expect(quickLoadBlock(solo)).toBe(null);
    expect(quickLoadBlock({ ...solo, ended: true })).toBe(null);
    expect(quickLoadBlock({ ...solo, humans: 2 })).toMatch(/LAN/);
  });
});

describe("restart and briefing (QoL)", () => {
  it("offers Restart level in the campaign and Restart match in a skirmish, never in LAN play", () => {
    expect(restartKind(solo, true)).toBe("level");
    expect(restartKind(solo, false)).toBe("match");
    expect(restartKind({ ...solo, net: true }, false)).toBe(null);
    expect(restartKind({ ...solo, session: false }, false)).toBe(null);
  });

  it("lists the messages of fired triggers the player received, once each, in trigger order", () => {
    const def = {
      triggers: [
        { when: { type: "time" as const, seconds: 5 }, do: [{ type: "message" as const, text: "First" }] },
        { when: { type: "time" as const, seconds: 50 }, do: [{ type: "message" as const, text: "Not yet" }] },
        { when: { type: "worship" as const, site: "shrine" }, do: [{ type: "message" as const, text: "Rival prayed" }] },
        { when: { type: "time" as const, seconds: 9, every: 9 }, do: [{ type: "message" as const, text: "Tide" }, { type: "message" as const, text: "First" }] },
      ],
    } as unknown as Parameters<typeof briefingMessages>[0];
    const receiver = (k: number) => (k === 2 ? 1 : 0);
    expect(briefingMessages(def, [1, 0, 1, 3], receiver, 0)).toEqual(["First", "Tide"]);
    expect(briefingMessages(def, [0, 0, 0, 0], receiver, 0)).toEqual([]);
    expect(briefingMessages({}, [], receiver, 0)).toEqual([]);
  });
});

describe("edge scrolling (QoL)", () => {
  it("pans toward the edge the pointer touches and not elsewhere", () => {
    expect(edgePan(0, 300, 1280, 720, 4)).toEqual({ right: -1, forward: 0 });
    expect(edgePan(1279, 300, 1280, 720, 4)).toEqual({ right: 1, forward: 0 });
    expect(edgePan(600, 2, 1280, 720, 4)).toEqual({ right: 0, forward: 1 });
    expect(edgePan(600, 719, 1280, 720, 4)).toEqual({ right: 0, forward: -1 });
    expect(edgePan(1, 1, 1280, 720, 4)).toEqual({ right: -1, forward: 1 });
    expect(edgePan(640, 360, 1280, 720, 4)).toEqual({ right: 0, forward: 0 });
    expect(edgePan(-5, 300, 1280, 720, 4)).toEqual({ right: 0, forward: 0 });
  });

  it("the setting defaults on and survives storage, and broken storage falls back", () => {
    const kv = new MemoryKV();
    expect(loadQol(kv).edgeScroll).toBe(true);
    expect(storeQol(kv, { edgeScroll: false })).toBe(true);
    expect(loadQol(kv).edgeScroll).toBe(false);
    const broken = { getItem: () => "{oops", setItem: () => { throw new Error("full"); }, removeItem: () => {} };
    expect(loadQol(broken).edgeScroll).toBe(true);
    expect(storeQol(broken, { edgeScroll: true })).toBe(false);
  });
});

describe("level lighting (S4 L8-B)", () => {
  it("a level's mood applies under the default setting; a chosen setting wins", () => {
    expect(levelLighting("default", "night")).toBe("night");
    expect(levelLighting("default", undefined)).toBe("default");
    expect(levelLighting("golden", "night")).toBe("golden");
    expect(levelLighting("day", undefined)).toBe("day");
  });
});

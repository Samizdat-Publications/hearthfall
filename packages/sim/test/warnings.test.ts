// Chapter 4 prep: wolf den marks (world markers, minimap, clearDens beacons) and neutral level hazard
// warnings (a located ground ring with a countdown, one hazardWarn event, balance.hazards).
import { describe, expect, it } from "vitest";
import { validateLevel, type LevelDef } from "@hearthfall/data";
import { createLevelWorld, levelWorldInit } from "../src/level.ts";
import { denMarks, hazardMarks, hazardRadius, isHarmful, type DenMark, type HazardMark } from "../src/warnings.ts";
import { World } from "../src/world.ts";
import { basePack, world } from "./helpers.ts";

const level = (over: Partial<LevelDef>): LevelDef => {
  const raw = {
    id: "warn_test",
    name: "Warn test",
    order: 99,
    description: "test",
    seed: 5,
    map: { generator: "flat", size: 64, landAboveSea: 20 },
    tribes: [{}],
    spells: [],
    setup: [
      { spawn: "hearth", tribe: 0, at: [12, 12] },
      { spawn: "shaper", tribe: 0, at: [16, 12] },
      { spawn: "settler", tribe: 0, near: [12, 16], count: 3 },
    ],
    objectives: [{ type: "survive", seconds: 900 }],
    lose: [{ type: "timeLimit", seconds: 1200 }],
    ...over,
  };
  const res = validateLevel(raw, basePack().files);
  if (!res.level) throw new Error(JSON.stringify(res.issues));
  return res.level;
};

const make = (def: LevelDef): World => {
  const p = basePack();
  return createLevelWorld({ def }, p.files, p.hash);
};

const marks = (w: World, seenBy: number | null = null): DenMark[] => {
  const out: DenMark[] = [];
  const n = denMarks(w, seenBy, out);
  return out.slice(0, n);
};

/** step a world, noting the tick (after the step) of every hazardWarn and spellCast event; the loop is bounded */
const track = (w: World, ticks: number): { warn: { tick: number; ev: Record<string, unknown> }[]; cast: number[] } => {
  const out = { warn: [] as { tick: number; ev: Record<string, unknown> }[], cast: [] as number[] };
  for (let k = 0; k < ticks; k++) {
    w.step();
    for (const e of w.events) {
      if (e.type === "hazardWarn") out.warn.push({ tick: w.tick, ev: e });
      if (e.type === "spellCast") out.cast.push(w.tick);
    }
  }
  return out;
};

describe("wolf den marks", () => {
  it("marks every standing den, not a cleared one, and reuses its entries between calls", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnBuilding("hearth", 1, 54, 54);
    w.beasts.addDen("wolf", 30, 30, 2);
    w.beasts.addDen("wolf", 50, 20, 2);
    const out: DenMark[] = [];
    expect(denMarks(w, null, out)).toBe(2);
    const first = out[0];
    expect(first).toMatchObject({ index: 0, x: 30, y: 30, kind: "wolf", beacon: false });
    // the last wolf of a den falls: it is cleared for good and drops out; the entry objects are reused
    for (const id of w.beasts.dens[0].members.slice()) w.damage(w.ents.index(id), 1e6, 0, true);
    w.step();
    expect(w.beasts.dens[0].cleared).toBe(true);
    expect(denMarks(w, null, out)).toBe(1);
    expect(out[0]).toBe(first);
    expect(out[0].index).toBe(1);
  });

  it("hides a den the viewer has not explored, but shows one it has", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 10, 10);
    w.spawnUnit("shaper", 0, 12, 12);
    w.spawnBuilding("hearth", 1, 54, 54);
    const near = w.beasts.addDen("wolf", 16, 10, 1);
    const far = w.beasts.addDen("wolf", 36, 36, 1);
    w.vision.update(true);
    expect(w.vision.on).toBe(true);
    expect(w.vision.seen(0, 16, 10)).toBe(true);
    expect(w.vision.seen(0, 36, 36)).toBe(false);
    expect(marks(w, 0).map((m) => m.index)).toEqual([near]);
    expect(marks(w, null).map((m) => m.index)).toEqual([near, far]);
  });

  it("flags the dens an open clearDens objective counts as beacons, within its area, until it is done", () => {
    const def = level({
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 12] },
        { spawn: "shaper", tribe: 0, at: [16, 12] },
        { spawn: "wolf", tribe: -1, at: [40, 40], count: 2 },
        { spawn: "wolf", tribe: -1, at: [52, 14], count: 2 },
      ],
      objectives: [{ type: "survive", seconds: 5 }, { type: "clearDens", at: [40, 40], r: 6, after: 0 }, { type: "survive", seconds: 900 }],
    });
    const w = make(def);
    // the clearDens stage is closed: no beacons yet
    expect(marks(w).map((m) => m.beacon)).toEqual([false, false]);
    for (let k = 0; k < 200 && !w.level!.done[0]; k++) w.step();
    expect(w.level!.done[0]).toBe(1);
    w.step();
    // open: only the den inside its area is a beacon, and a beacon shows even in the dark
    expect(w.vision.seen(0, 40, 40)).toBe(false);
    expect(marks(w, 0).map((m) => [m.index, m.beacon])).toEqual([[0, true]]);
    expect(marks(w).map((m) => [m.index, m.beacon])).toEqual([[0, true], [1, false]]);
    // clearing that den completes the goal: no beacon is left
    for (const id of w.beasts.dens[0].members.slice()) w.damage(w.ents.index(id), 1e6, 0, true);
    w.step();
    w.step();
    expect(w.level!.done[1]).toBe(1);
    expect(marks(w).map((m) => [m.index, m.beacon])).toEqual([[1, false]]);
  });

  it("an objective with no area makes every standing den a beacon", () => {
    const def = level({
      setup: [
        { spawn: "hearth", tribe: 0, at: [12, 12] },
        { spawn: "shaper", tribe: 0, at: [16, 12] },
        { spawn: "wolf", tribe: -1, at: [40, 40], count: 2 },
        { spawn: "wolf", tribe: -1, at: [52, 14], count: 2 },
      ],
      objectives: [{ type: "clearDens" }, { type: "survive", seconds: 900 }],
    });
    const w = make(def);
    expect(marks(w, 0).map((m) => m.beacon)).toEqual([true, true]);
  });
});

describe("neutral hazard warnings", () => {
  const spell = (over: object = {}) => ({ type: "spell" as const, spell: "firerain", at: [40, 40] as [number, number], tribe: -1, ...over });
  const hazardLevel = (when: object = { type: "time", seconds: 20, every: 30 }, extra: Partial<LevelDef> = {}) =>
    level({ triggers: [{ when, do: [spell()] }] as LevelDef["triggers"], ...extra });

  it("sizes and filters hazards by what the spell does", () => {
    const spells = basePack().files.spells.spells;
    const fx = (id: string) => spells.find((s) => s.id === id)!.effects;
    expect(hazardRadius(fx("firerain"))).toBe(6);
    expect(hazardRadius(fx("quake"))).toBe(7);
    // the volcano's scar and spawned rocks do not widen it: its crater (7) does
    expect(hazardRadius(fx("volcano"))).toBe(7);
    // a ridge has no radius: its width counts
    expect(hazardRadius(fx("raise_land"))).toBe(2);
    expect(isHarmful(fx("firerain"))).toBe(true);
    expect(isHarmful(fx("quake"))).toBe(true);
    expect(isHarmful(fx("ward"))).toBe(false);
    expect(isHarmful(fx("sanctuary"))).toBe(false);
    expect(isHarmful(fx("call"))).toBe(false);
  });

  it("emits one hazardWarn warnSeconds before each firing, located at the target, and the ring counts down", () => {
    const w = make(hazardLevel());
    expect(w.level!.hazards).toHaveLength(1);
    const hz = w.cfg.tickHz;
    const lead = w.cfg.pack.balance.hazards!.warnSeconds;
    const out: HazardMark[] = [];
    // the first cast is at second 20: the warning opens 8 s before
    const first = track(w, 20 * hz);
    expect(first.warn).toHaveLength(1);
    expect(first.warn[0].tick).toBe((20 - lead) * hz);
    expect(first.warn[0].ev).toMatchObject({ type: "hazardWarn", tribe: -1, spell: "firerain", x: 40, y: 40, r: 6, seconds: lead, impact: 20 * hz });
    expect(first.cast).toEqual([20 * hz]);
    // the spell has just landed: no ring until the next window (50 s minus 8 s)
    expect(hazardMarks(w, 0, out)).toBe(0);
    // 3 s into the window of the second firing: 5 s left of 8
    const later = track(w, (50 - lead - 20) * hz + 3 * hz);
    expect(later.warn).toHaveLength(1);
    expect(later.warn[0].tick).toBe((50 - lead) * hz);
    expect(hazardMarks(w, 0, out)).toBe(1);
    expect(out[0]).toMatchObject({ spell: "firerain", x: 40, y: 40, r: 6, total: lead * hz });
    expect(out[0].left).toBeCloseTo(5 * hz, 9);
    // the render interpolation moves the countdown by a fraction of a tick
    hazardMarks(w, 0.5, out);
    expect(out[0].left).toBeCloseTo(5 * hz - 0.5, 9);
    // and the ring closes when the spell lands
    const landed = track(w, 5 * hz);
    expect(landed.cast).toEqual([50 * hz]);
    expect(hazardMarks(w, 0, out)).toBe(0);
  });

  it("a hazard that lands soon after the start warns from the first tick, with the time left", () => {
    const w = make(hazardLevel({ type: "time", seconds: 3 }));
    const hz = w.cfg.tickHz;
    const r = track(w, 3 * hz);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0].tick).toBe(1);
    expect(r.warn[0].ev.seconds).toBeCloseTo((3 * hz - 1) / hz, 9);
    expect(r.cast).toEqual([3 * hz]);
  });

  it("no warning for the player's own spell, a benign spell, a trigger that fires at once; a one-shot warns once", () => {
    const quiet = (when: object, reward: object): World => make(level({ triggers: [{ when, do: [reward] }] as LevelDef["triggers"] }));
    const at12 = { type: "time", seconds: 12 };
    // the caster tribe is the player (no tribe field): not neutral
    let w = quiet(at12, { type: "spell", spell: "firerain", at: [40, 40] });
    expect(w.level!.hazards).toHaveLength(0);
    expect(track(w, 12 * w.cfg.tickHz).warn).toHaveLength(0);
    // a Ward cast by nobody is no danger
    w = quiet(at12, spell({ spell: "ward" }));
    expect(w.level!.hazards).toHaveLength(0);
    // an area trigger fires the moment its condition holds: no lead time to warn with
    w = quiet({ type: "area", at: [40, 40], r: 4 }, spell());
    expect(w.level!.hazards).toHaveLength(0);
    // a one-shot warns once and is quiet after it fired
    w = quiet(at12, spell());
    expect(w.level!.hazards).toHaveLength(1);
    const hz = w.cfg.tickHz;
    expect(track(w, 14 * hz).warn).toHaveLength(1);
    expect(hazardMarks(w, 0, [])).toBe(0);
    expect(track(w, 30 * hz).warn).toHaveLength(0);
  });

  it("a trigger gated by `after` warns on its own clock", () => {
    const def = level({
      objectives: [{ type: "survive", seconds: 4 }, { type: "survive", seconds: 900 }],
      triggers: [{ when: { type: "time", seconds: 10, every: 20 }, after: 0, until: 1, do: [spell()] }] as LevelDef["triggers"],
    });
    const w = make(def);
    const hz = w.cfg.tickHz;
    // closed until objective 0 is done: no ring
    expect(hazardMarks(w, 0, [])).toBe(0);
    const r = track(w, 12 * hz);
    const start = w.level!.startAt[0];
    expect(start).toBeGreaterThan(0);
    expect(r.warn).toHaveLength(1);
    expect(r.warn[0].tick).toBe(start + 10 * hz - 8 * hz);
    expect(r.warn[0].ev.impact).toBe(start + 10 * hz);
  });

  it("a short repeat interval keeps the warning from reaching back before the last cast", () => {
    const w = make(hazardLevel({ type: "time", seconds: 10, every: 5 }));
    const hz = w.cfg.tickHz;
    const r = track(w, 21 * hz);
    // first cast at 10 s (warned at 2 s), then every 5 s: each later warning opens right after the previous cast
    expect(r.warn.map((e) => e.tick)).toEqual([2 * hz, 10 * hz + 1, 15 * hz + 1, 20 * hz + 1]);
    expect(r.cast).toEqual([10 * hz, 15 * hz, 20 * hz]);
  });

  it("a snapshot taken mid-warning restores to the same ring and the same future hashes", () => {
    const p = basePack();
    const def = hazardLevel();
    const a = make(def);
    const hz = a.cfg.tickHz;
    track(a, 14 * hz);
    const ra: HazardMark[] = [];
    const rb: HazardMark[] = [];
    expect(hazardMarks(a, 0, ra)).toBe(1);
    const b = World.restore(levelWorldInit({ def }, p.files, p.hash), a.snapshot());
    expect(hazardMarks(b, 0, rb)).toBe(1);
    expect(rb[0]).toEqual(ra[0]);
    for (let k = 0; k < 10 * hz; k++) {
      a.step();
      b.step();
    }
    expect(b.hash().all).toBe(a.hash().all);
  });

  it("without balance.hazards the level has no hazards and no events", () => {
    const p = basePack();
    const balance = { ...p.files.balance } as Record<string, unknown>;
    delete balance.hazards;
    const files = { ...p.files, balance: balance as unknown as typeof p.files.balance };
    const w = createLevelWorld({ def: hazardLevel() }, files, p.hash);
    expect(w.level!.hazards).toHaveLength(0);
    expect(track(w, 20 * w.cfg.tickHz).warn).toHaveLength(0);
    expect(hazardMarks(w, 0, [])).toBe(0);
  });
});

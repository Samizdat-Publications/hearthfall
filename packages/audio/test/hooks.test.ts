import { describe, expect, it } from "vitest";
import { AudioHooks, type CuePlay } from "../src/index.ts";
import { basePack } from "../../sim/test/helpers.ts";
import { world } from "../../sim/test/helpers.ts";

describe("audio hooks (M6)", () => {
  const rules = basePack().files.style.audio!.cues;

  it("maps combat events to cues, throttles per tick and stubs missing assets", () => {
    const played: CuePlay[] = [];
    const h = new AudioHooks(rules, new Set(["sfx.died"]), (p) => played.push(p));
    const ev = (type: string, tick: number, extra: Record<string, unknown> = {}) => ({ type, tick, x: 1, y: 2, ...extra });
    const out = h.consume([
      ...Array.from({ length: 9 }, () => ev("melee", 5)),
      ev("melee", 6),
      ev("killed", 6, { cat: 3 }),
      ev("killed", 6, { cat: 1 }),
      ev("spellCast", 7, { spell: "bolt" }),
      ev("noSuchEvent", 7),
    ]);
    const melee = out.filter((p) => p.event === "melee");
    expect(melee.length).toBe(rules.melee.maxPerTick! + 1);
    expect(out.filter((p) => p.event === "killed").length).toBe(1);
    expect(out.find((p) => p.event === "spellCast")?.cue).toBe("sfx.bolt_cast");
    expect(played.map((p) => p.cue)).toEqual(["sfx.died"]);
    expect(played[0]).toMatchObject({ x: 1, y: 2, silent: false });
    const s = h.stats();
    expect(s.played).toBe(1);
    expect(s.dropped).toBe(9 - rules.melee.maxPerTick!);
    expect(s.silent).toBe(out.length - 1);
  });

  it("every combat event the sim emits has a cue", () => {
    for (const t of ["melee", "fireball", "chantBegun", "chantInterrupted", "converted", "trained", "killed", "tribeEliminated"]) expect(rules[t]).toBeDefined();
  });

  it("a real skirmish fires combat cues", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnBuilding("hearth", 0, 2, 2);
    w.spawnBuilding("hearth", 1, 34, 2);
    w.spawnUnit("shaper", 0, 5, 5);
    w.spawnUnit("shaper", 1, 37, 5);
    for (let k = 0; k < 4; k++) w.spawnUnit("warden", 0, 28, 30 + k);
    for (let k = 0; k < 3; k++) w.spawnUnit("settler", 1, 33, 30 + k);
    const h = new AudioHooks(rules, new Set());
    for (let t = 0; t < 30 * 20; t++) {
      w.step([]);
      h.consume(w.events);
    }
    const s = h.stats();
    expect(s.byCue["sfx.melee_hit"]).toBeGreaterThan(0);
    expect(s.byCue["sfx.died"]).toBeGreaterThan(0);
  });
  it("a rival's unpositioned cue is not heard; positioned and global ones are (BACKLOG 93)", () => {
    const played: string[] = [];
    const avail = new Set(["sfx.charged", "sfx.trained", "sfx.eliminated", "sfx.chant"]);
    const h = new AudioHooks(rules, avail, (p) => played.push(p.cue));
    h.localTribe = 0;
    h.consume([
      { type: "charged", tick: 1, tribe: 1, spell: 0 },
      { type: "trained", tick: 1, tribe: 2 },
      { type: "charged", tick: 2, tribe: 0, spell: 0 },
      { type: "chantBegun", tick: 2, tribe: 1, x: 3, y: 4 },
      { type: "tribeEliminated", tick: 3, tribe: 2 },
    ]);
    expect(played).toEqual(["sfx.charged", "sfx.chant", "sfx.eliminated"]);
  });
});

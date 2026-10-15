import { describe, expect, it } from "vitest";
import type { SimEvent } from "@hearthfall/sim";
import { comboHint, hazardNote, leadInWarning, orderNote } from "../src/orderNotes.ts";
import { world } from "../../../packages/sim/test/helpers.ts";

const ev = (o: Record<string, unknown>) =>
  ({ tick: 1, ...o }) as unknown as SimEvent;

const yes = () => true;

describe("order feedback notes (BACKLOG 45)", () => {
  it("notes the local player's failed and abandoned orders", () => {
    expect(orderNote(ev({ type: "orderFailed", tribe: 0 }), 0, yes)?.key).toBe(
      "orderFailed",
    );
    expect(
      orderNote(ev({ type: "orderGaveUp", tribe: 0, chase: 0 }), 0, yes)?.key,
    ).toBe("orderGaveUp");
  });

  it("stays silent for rivals, combat chases and other events", () => {
    expect(orderNote(ev({ type: "orderFailed", tribe: 1 }), 0, yes)).toBeNull();
    expect(
      orderNote(ev({ type: "orderGaveUp", tribe: 0, chase: 1 }), 0, yes),
    ).toBeNull();
    expect(orderNote(ev({ type: "killed", tribe: 0 }), 0, yes)).toBeNull();
  });

  it("ignores units the player did not order (settlers on errands, combat acquisition)", () => {
    const ordered = (id: number) => id === 7;
    expect(
      orderNote(ev({ type: "orderFailed", tribe: 0, id: 9 }), 0, ordered),
    ).toBeNull();
    expect(
      orderNote(ev({ type: "orderFailed", tribe: 0, id: 7 }), 0, ordered)?.key,
    ).toBe("orderFailed");
  });
});

describe("terrain lead-in warning (BACKLOG 36)", () => {
  it("warns when a rival quake is about to move land under own units, not for own casts or far away", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnUnit("settler", 0, 20, 20);
    const q = (o: Record<string, unknown>) => ev({ type: "terrainLeadIn", spell: "quake", r: 7, seconds: 1.5, ...o });
    expect(leadInWarning(q({ tribe: 1, x: 24, y: 22 }), w, 0)?.key).toBe("leadIn");
    expect(leadInWarning(q({ tribe: 0, x: 24, y: 22 }), w, 0)).toBeNull();
    expect(leadInWarning(q({ tribe: 1, x: 50, y: 50 }), w, 0)).toBeNull();
  });

  it("warns for a neutral quake (tribe below 0, a level hazard) too: placed, only near own units", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    w.spawnUnit("settler", 0, 20, 20);
    const q = (o: Record<string, unknown>) => ev({ type: "terrainLeadIn", spell: "quake", r: 7, seconds: 1.5, ...o });
    const n = leadInWarning(q({ tribe: -1, x: 24, y: 22 }), w, 0);
    expect(n).toMatchObject({ key: "leadInWild", throttleSec: 6, at: [24, 22] });
    expect(n?.text).toContain("get your people clear");
    // far from every unit: silent; a rival's quake keeps its own key and stays unplaced
    expect(leadInWarning(q({ tribe: -1, x: 50, y: 50 }), w, 0)).toBeNull();
    expect(leadInWarning(q({ tribe: 1, x: 24, y: 22 }), w, 0)?.at).toBeUndefined();
    // a rival unit alone does not count: the units must be the viewer's
    const lone = world({ generator: "flat", size: 64, tribes: 2 });
    lone.spawnUnit("settler", 1, 20, 20);
    expect(leadInWarning(q({ tribe: -1, x: 24, y: 22 }), lone, 0)).toBeNull();
  });
});

describe("neutral hazard warning note (chapter 4 prep)", () => {
  const warn = (o: Record<string, unknown>) => ev({ type: "hazardWarn", tribe: -1, spell: "firerain", x: 40, y: 30, r: 6, seconds: 8, impact: 400, ...o });
  it("names the danger and the seconds left, placed on the ring", () => {
    const n = hazardNote(warn({}));
    expect(n).toMatchObject({ key: "hazard:firerain", throttleSec: 2, at: [40, 30] });
    expect(n?.text).toBe("Fire will rain on the marked ground in 8 seconds. Get your people clear!");
    expect(hazardNote(warn({ spell: "quake", seconds: 2.6 }))?.text).toContain("crack open in 3 seconds");
    // an unlisted spell still gets a note, and a short lead never reads as zero seconds
    expect(hazardNote(warn({ spell: "mystery", seconds: 0.2 }))?.text).toContain("Something will strike the marked ground in 1 second. Get");
  });
  it("ignores other events and events with no place", () => {
    expect(hazardNote(ev({ type: "terrainLeadIn", tribe: -1, x: 1, y: 1 }))).toBeNull();
    expect(hazardNote(warn({ x: undefined }))).toBeNull();
  });
});

describe("spell combo hints (stretch 2)", () => {
  const combos = [
    { after: "raise_land", then: "erode", text: "moat" },
    { after: "hornets", then: "mire", text: "bog" },
  ];
  it("suggests the follow-up only after the local player's cast and only when it is castable", () => {
    const cast = (tribe: number, spell: string) => ev({ type: "spellCast", tribe, spell });
    expect(comboHint(cast(0, "raise_land"), 0, combos, ["raise_land", "erode"])).toEqual({ key: "combo:raise_land:erode", text: "moat", throttleSec: Infinity });
    expect(comboHint(cast(1, "raise_land"), 0, combos, ["raise_land", "erode"])).toBeNull();
    expect(comboHint(cast(0, "raise_land"), 0, combos, ["raise_land"])).toBeNull();
    expect(comboHint(cast(0, "bolt"), 0, combos, ["bolt", "erode", "mire"])).toBeNull();
    expect(comboHint(ev({ type: "killed", tribe: 0 }), 0, combos, ["erode"])).toBeNull();
  });
});

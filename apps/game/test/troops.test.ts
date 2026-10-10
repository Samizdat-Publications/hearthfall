// M6 HUD troop controls: selection and intents become Commands the sim accepts.
import { describe, expect, it } from "vitest";
import { STANCE, TASK } from "@hearthfall/sim";
import { world } from "../../../packages/sim/test/helpers.ts";
import { buildingAt, rallyMarker, siteAt, troopCommand, troopView } from "../src/troops.ts";

function arena() {
  const w = world({ generator: "flat", size: 64, tribes: 2 });
  w.spawnBuilding("hearth", 0, 4, 4);
  w.spawnBuilding("hearth", 1, 40, 4);
  w.spawnUnit("shaper", 0, 6, 6);
  w.spawnUnit("shaper", 1, 42, 6);
  return w;
}

const run = (w: ReturnType<typeof arena>, c: { tribe: number; type: string; args: Record<string, unknown> } | null) => {
  expect(c).not.toBeNull();
  w.step([{ ...c!, tick: w.tick }]);
  expect(w.events.filter((e) => e.type === "commandRejected")).toEqual([]);
};

describe("HUD troop controls (M6)", () => {
  it("a lodge selection trains and sets a rally point; the view tracks the queue", () => {
    const w = arena();
    const lodge = w.ents.index(w.spawnBuilding("warden_lodge", 0, 20, 20));
    for (let k = 0; k < 4; k++) w.spawnUnit("settler", 0, 24 + k, 24);
    expect(buildingAt(w, 0, 21, 19)).toBe(lodge);
    expect(buildingAt(w, 1, 21, 19)).toBe(-1);
    expect(troopView(w, 0, [], lodge)).toMatchObject({ kind: "lodge", count: 0, max: 5, rally: false, building: false });
    run(w, troopCommand(w, 0, [], lodge, { kind: "train", n: 3 }));
    expect(troopView(w, 0, [], lodge).count).toBe(3);
    run(w, troopCommand(w, 0, [], lodge, { kind: "rally", at: [30, 30] }));
    expect(troopView(w, 0, [], lodge).rally).toBe(true);
    expect(rallyMarker(w, 0, lodge)).toEqual({ x: 30, z: 30 });
    expect(rallyMarker(w, 1, lodge)).toBeNull();
    expect(rallyMarker(w, 0, -1)).toBeNull();
    run(w, troopCommand(w, 0, [], lodge, { kind: "rally", at: null }));
    expect(troopView(w, 0, [], lodge).rally).toBe(false);
    expect(rallyMarker(w, 0, lodge)).toBeNull();
  });

  it("a unit selection sets stance, garrisons in the nearest tower and ungarrisons; retreat is accepted", () => {
    const w = arena();
    const tower = w.ents.index(w.spawnBuilding("watchtower", 0, 30, 30));
    const sel = [0, 1, 2].map((k) => w.ents.index(w.spawnUnit("warden", 0, 26 + k, 30)));
    expect(troopView(w, 0, sel, -1)).toMatchObject({ kind: "units", label: "", canGarrison: true });
    run(w, troopCommand(w, 0, sel, -1, { kind: "stance", stance: "passive" }));
    expect(sel.every((i) => w.ents.stance[i] === STANCE.passive)).toBe(true);
    expect(troopView(w, 0, sel, -1).stance).toBe("passive");
    w.ents.stance[sel[0]] = STANCE.aggressive;
    expect(troopView(w, 0, sel, -1).stance).toBeNull();
    run(w, troopCommand(w, 0, sel, -1, { kind: "garrison" }));
    w.run(20 * 10);
    expect(w.ents.occupants[tower]).toBe(2);
    expect(troopView(w, 0, [], tower)).toMatchObject({ kind: "tower", count: 2, max: 2 });
    expect(troopView(w, 0, sel, -1).canGarrison).toBe(false);
    run(w, troopCommand(w, 0, [], tower, { kind: "ungarrison" }));
    w.run(20);
    expect(w.ents.occupants[tower]).toBe(0);
    expect(sel.every((i) => w.ents.task[i] !== TASK.garrison)).toBe(true);
    const far = w.ents.index(w.spawnUnit("warden", 0, 12, 30));
    run(w, troopCommand(w, 0, [...sel, far], -1, { kind: "retreat" }));
    w.run(20 * 30);
    // two retreat into the tower (2 slots), the rest run home to the Hearth
    expect(w.ents.occupants[tower]).toBe(2);
    const n = w.terrain.size;
    const atHome = [...sel, far].filter((i) => w.ents.inside[i] !== tower && Math.hypot(((w.ents.x[i] - 4 + n / 2) % n) - n / 2, ((w.ents.y[i] - 4 + n / 2) % n) - n / 2) < 6);
    expect(atHome.length).toBe(2);
  });

  it("intents the selection cannot do give no command; enemy units are filtered out", () => {
    const w = arena();
    const foe = w.ents.index(w.spawnUnit("warden", 1, 30, 30));
    expect(troopCommand(w, 0, [], -1, { kind: "train", n: 1 })).toBeNull();
    expect(troopCommand(w, 0, [foe], -1, { kind: "retreat" })).toBeNull();
    expect(troopCommand(w, 0, [foe], -1, { kind: "garrison" })).toBeNull();
    expect(troopView(w, 0, [foe], -1).kind).toBe("none");
  });
});

describe("selected units panel (M8)", () => {
  it("groups the selection by kind in data order with mean health", () => {
    const w = arena();
    const E = w.ents;
    const a = E.index(w.spawnUnit("settler", 0, 10, 10));
    const b = E.index(w.spawnUnit("settler", 0, 11, 10));
    const s = E.index(w.spawnUnit("shaper", 0, 12, 10));
    E.hp[b] = E.hp[b] / 2;
    const v = troopView(w, 0, [s, a, b], -1);
    // units.json order: shaper before settler
    expect(v.units.map((u) => [u.name, u.count])).toEqual([
      ["Shaper", 1],
      ["Settlers", 2],
    ]);
    expect(v.units.find((u) => u.count === 2)!.hpFrac).toBeCloseTo(0.75, 3);
    expect(troopView(w, 0, [], -1).units).toEqual([]);
  });

  it("BACKLOG 49: an unfinished building shows what it needs and can be cancelled; a finished one cannot", () => {
    const w = arena();
    w.spawnTree(30, 40);
    w.step([{ tick: w.tick, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [20, 20] } }]);
    const plan = buildingAt(w, 0, 20, 20);
    expect(plan).toBeGreaterThanOrEqual(0);
    const v = troopView(w, 0, [], plan);
    expect(v).toMatchObject({ kind: "site", building: true });
    expect(v.label).toMatch(/wood 0\/\d+/);
    expect(troopCommand(w, 1, [], plan, { kind: "cancelPlan" })).toBeNull();
    run(w, troopCommand(w, 0, [], plan, { kind: "cancelPlan" }));
    expect(w.ents.alive[plan]).toBe(0);
    expect(w.eventCounts.get("planCancelled")).toBe(1);
    const hearth = buildingAt(w, 0, 4, 4);
    expect(troopView(w, 0, [], hearth).kind).toBe("none");
    expect(troopCommand(w, 0, [], hearth, { kind: "cancelPlan" })).toBeNull();
  });

  it("M9: right-clicking a worship site that still has a use targets it", () => {
    const w = arena();
    w.worship.addSite("shrine", 30, 30, { tag: "s", rewards: [] });
    expect(siteAt(w, 30.8, 29.4)).toBe("s");
    expect(siteAt(w, 34, 30)).toBeNull();
    w.worship.sites[0].usesLeft = 0;
    expect(siteAt(w, 30, 30)).toBeNull();
  });
});

// BACKLOG 11 (ADR-017): the Forge phase. Units stay frozen and only forge and settings commands run;
// strokes are free inside a tribe's forge ring; the phase ends on time or when every tribe is ready;
// match clocks start at its end; state survives snapshot and restore.
import { describe, expect, it } from "vitest";
import { TASK } from "../src/economy.ts";
import { World, type WorldInit } from "../src/world.ts";
import { basePack } from "./helpers.ts";

function init(forge: boolean, rules?: string): WorldInit {
  const p = basePack();
  return { pack: p.files, packHash: p.hash, seed: 4, map: { generator: "flat", size: 64, tribes: 2 }, ...(forge ? { forge: true } : {}), ...(rules ? { rules } : {}) };
}

function arena(forge = true, rules?: string): World {
  const w = new World(init(forge, rules));
  w.spawnBuilding("hearth", 0, 16, 32);
  w.spawnBuilding("hearth", 1, 48, 32);
  w.spawnUnit("shaper", 0, 18, 30);
  w.spawnUnit("shaper", 1, 46, 30);
  for (let k = 0; k < 3; k++) w.spawnUnit("settler", 0, 14 + k, 35);
  return w;
}

const at = (w: World, x: number, y: number) => w.terrain.heights[x + y * w.terrain.size];
const step = (w: World, tribe: number, type: string, args: Record<string, unknown>) => w.step([{ tick: w.tick, tribe, type, args }]);
const lastReject = (w: World) => w.events.filter((e) => e.type === "commandRejected").at(-1)?.reason;

describe("Forge mode (BACKLOG 11)", () => {
  it("without a Forge nothing changes: playTick is the tick and forge commands are refused", () => {
    const w = arena(false);
    w.run(10);
    expect(w.forge).toBeNull();
    expect(w.playTick).toBe(w.tick);
    step(w, 0, "forgeOp", { brush: "raise", x: 26, y: 32 });
    expect(lastReject(w)).toBe("there is no Forge running");
  });

  it("strokes are free inside the ring, refused outside it and next to the Hearth; units stay frozen", () => {
    const w = arena();
    const d = w.forge!.def;
    const progress = w.tribes[0].eco.progress.slice();
    const settler = w.selectUnits("tribe0.settlers")[0];
    const sx = w.ents.x[settler];
    const before = at(w, 26, 32);
    step(w, 0, "forgeOp", { brush: "raise", x: 26, y: 32 });
    expect(at(w, 26, 32)).toBe(before + d.amount);
    expect(w.forge!.ops[0]).toBe(1);
    step(w, 0, "forgeOp", { brush: "lower", x: 16 + d.radius, y: 32 });
    expect(lastReject(w)).toBe("too far from your Hearth");
    step(w, 0, "forgeOp", { brush: "lower", x: 18, y: 32 });
    expect(lastReject(w)).toBe("too close to your Hearth");
    step(w, 0, "forgeOp", { brush: "dig", x: 26, y: 32 });
    expect(lastReject(w)).toMatch(/^brush must be one of/);
    step(w, 0, "move", { units: "tribe0.settlers", to: [30, 30] });
    expect(lastReject(w)).toBe("the land is still being forged");
    w.run(100);
    expect(w.ents.x[settler]).toBe(sx);
    expect(w.ents.task[settler]).not.toBe(TASK.toBoard);
    // no mana flows while the land is forged
    expect([...w.tribes[0].eco.progress]).toEqual([...progress]);
    expect(w.tribes[0].eco.incomePerMin).toBe(0);
    expect(w.playTick).toBe(0);
    expect(w.invariants()).toEqual([]);
  });

  it("ends on time, then the match runs and its clock starts at zero", () => {
    const w = arena();
    const end = w.forge!.endsAt;
    w.run(end - 1);
    expect(w.forge!.running()).toBe(true);
    w.run(1);
    expect(w.forge!.running()).toBe(false);
    expect(w.forge!.endedAt).toBe(end);
    expect(w.eventCounts.get("forgeEnded")).toBe(1);
    expect(w.playTick).toBe(0);
    w.run(40);
    expect(w.playTick).toBe(40);
    step(w, 0, "forgeOp", { brush: "raise", x: 26, y: 32 });
    expect(lastReject(w)).toBe("there is no Forge running");
  });

  it("ends early once every living tribe is ready; Last Stand counts from the end of the Forge", () => {
    const w = arena(true, "last_stand");
    step(w, 0, "forgeReady", {});
    expect(w.forge!.running()).toBe(true);
    w.step([{ tick: w.tick, tribe: 1, type: "forgeReady", args: {} }]);
    expect(w.forge!.running()).toBe(false);
    expect(w.forge!.endedAt).toBe(w.tick);
    expect(w.events.find((e) => e.type === "forgeEnded")?.why).toBe("ready");
    const minutes = w.cfg.pack.balance.victory!.variants.find((v) => v.id === "last_stand");
    expect(minutes?.type).toBe("lastStand");
    expect(w.rules!.goalTicks()).toBeGreaterThan(0);
    // the rules timer reads playTick: two ticks in, the match is two ticks old
    w.run(2);
    expect(w.playTick).toBe(2);
    expect(w.rules!.winner).toBe(-1);
  });

  it("a world restored mid Forge has the same future hashes", () => {
    const a = arena();
    const cmds = (tick: number) =>
      tick === 3
        ? [
            { tick, tribe: 0, type: "forgeOp", args: { brush: "lower", x: 26, y: 32 } },
            { tick, tribe: 1, type: "forgeOp", args: { brush: "flatten", x: 40, y: 30 } },
          ]
        : tick === 9
          ? [{ tick, tribe: 0, type: "forgeOp", args: { brush: "smooth", x: 16, y: 41 } }]
          : [];
    a.run(6, cmds);
    const snap = a.snapshot();
    expect(snap.forge?.ops).toEqual([1, 1]);
    const b = World.restore(init(true), snap);
    expect(b.hash()).toEqual(a.hash());
    a.run(40, cmds);
    b.run(40, cmds);
    expect(b.hash()).toEqual(a.hash());
    expect(b.forge!.ops).toEqual([2, 1]);
  });
});

// BACKLOG 10: the right click on a boat boards it; a loaded boat right clicked onto land unloads there.
import { describe, expect, it } from "vitest";
import { World } from "@hearthfall/sim";
import { basePack } from "../../../packages/sim/test/helpers.ts";
import { vehicleCommand } from "../src/troops.ts";

function strait(): World {
  const p = basePack();
  const w = new World({
    pack: p.files,
    packHash: p.hash,
    seed: 3,
    map: {
      generator: "flat",
      size: 64,
      tribes: 1,
      paint: [
        { shape: "rect", at: [32, 32], size: [12, 64], aboveSea: -30 },
        { shape: "rect", at: [0, 32], size: [12, 64], aboveSea: -30 },
      ],
    },
  });
  w.spawnBuilding("hearth", 0, 12, 12);
  w.spawnUnit("shaper", 0, 14, 14);
  return w;
}

describe("vehicle right clicks (BACKLOG 10)", () => {
  it("walkers board the boat under the cursor; a loaded boat unloads on land, not on water; an empty one just moves", () => {
    const w = strait();
    const E = w.ents;
    const boat = E.index(w.spawnUnit("boat", 0, 27, 32));
    const a = E.index(w.spawnUnit("settler", 0, 20, 31));
    const b = E.index(w.spawnUnit("warden", 0, 20, 33));
    const board = vehicleCommand(w, 0, [a, b], boat, 27, 32);
    expect(board?.type).toBe("board");
    expect(board?.args.vehicle).toBe(E.idOf(boat));
    expect(board?.args.units).toEqual([E.idOf(a), E.idOf(b)]);
    // no vehicle under the cursor, or the boat itself selected: not a boarding
    expect(vehicleCommand(w, 0, [a, b], -1, 27, 32)).toBeNull();
    expect(vehicleCommand(w, 0, [boat], boat, 27, 32)).toBeNull();
    // an empty boat right clicked onto land is an ordinary move
    expect(vehicleCommand(w, 0, [boat], -1, 44, 32)).toBeNull();
    w.step([{ tick: w.tick, ...board! }]);
    w.run(300);
    expect(E.occupants[boat]).toBe(2);
    const unload = vehicleCommand(w, 0, [boat], -1, 44, 32);
    expect(unload?.type).toBe("unload");
    expect(unload?.args.to).toEqual([44, 32]);
    expect(vehicleCommand(w, 0, [boat], -1, 32, 32)).toBeNull();
  });
});

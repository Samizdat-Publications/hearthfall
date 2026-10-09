// Regression (found in BACKLOG 2): alloc did not reset the spell status and stone columns, so a unit
// spawned into a freed slot inherited the dead unit's Ward (no damage), Veil or Beguile (its tribe flipped
// when the inherited Beguile expired).
import { describe, expect, it } from "vitest";
import { world } from "./helpers.ts";

describe("entity slot reuse", () => {
  it("a unit spawned into a freed slot starts with no inherited status or stone", () => {
    const w = world({ generator: "flat", size: 64, tribes: 2 });
    const E = w.ents;
    const a = E.index(w.spawnUnit("warden", 0, 20, 20));
    E.veil[a] = 50;
    E.ward[a] = 50;
    E.beguile[a] = 50;
    E.home[a] = 1;
    E.stone[a] = 7;
    w.kill(a, "killed");
    const b = E.index(w.spawnUnit("warden", 1, 30, 30));
    expect(b).toBe(a);
    expect([E.veil[b], E.ward[b], E.beguile[b], E.home[b], E.stone[b]]).toEqual([0, 0, 0, 0, 0]);
  });
});

// BACKLOG 0a HUD icon audit: every spell, every player building and every trainable or starting unit has its
// asset icon (assets/icons, A3), and the troop panel chips carry the unit icon.
import { describe, expect, it } from "vitest";
import { basePack, world } from "../../../packages/sim/test/helpers.ts";
import { buildingIcon, spellIcon, unitIcon } from "../src/icons.ts";
import { unitMix } from "../src/troops.ts";

describe("HUD icons", () => {
  const pack = basePack().files as unknown as {
    spells: { spells: { id: string }[] };
    buildings: { buildings: { id: string; buildable?: boolean; milestone?: string }[] };
    units: { units: { id: string }[] };
  };

  it("cover every spell, every buildable building and every unit but the summoned shade", () => {
    expect(pack.spells.spells.filter((s) => !spellIcon(s.id)).map((s) => s.id)).toEqual([]);
    const shown = pack.buildings.buildings.filter((b) => b.buildable !== false && b.milestone !== "backlog");
    expect(shown.filter((b) => !buildingIcon(b.id)).map((b) => b.id)).toEqual([]);
    expect(pack.units.units.filter((u) => !unitIcon(u.id)).map((u) => u.id)).toEqual(["shade"]);
  });

  it("troop chips name the unit type so the HUD can show its icon", () => {
    const w = world({ generator: "flat", size: 64, tribes: 1 });
    const a = w.ents.index(w.spawnUnit("warden", 0, 10, 10));
    const b = w.ents.index(w.spawnUnit("chanter", 0, 12, 10));
    expect(unitMix(w, [a, b]).map((u) => u.id)).toEqual(["warden", "chanter"]);
  });
});

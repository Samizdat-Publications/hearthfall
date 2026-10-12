// QoL 2: the HUD's targeting line shows why an armed spell cannot land at the pointer, else the area count.
import { describe, expect, it } from "vitest";
import { targetingLine } from "../src/hud.tsx";

describe("targeting line (QoL 2)", () => {
  it("names the spell, then the reason when there is one, else who is in the area", () => {
    expect(targetingLine("raise_land", null, "")).toBe("Casting raise land: left click a target, right click or Esc to cancel");
    expect(targetingLine("bolt", { enemies: 2, own: 0 }, "")).toBe("Casting bolt: left click a target, right click or Esc to cancel | 2 enemies, 0 of yours in the area");
    expect(targetingLine("bolt", { enemies: 2, own: 0 }, "out of range: the Shaper walks closer first")).toBe("Casting bolt: left click a target, right click or Esc to cancel | out of range: the Shaper walks closer first");
  });
});

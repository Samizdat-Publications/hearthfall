import { describe, expect, it } from "vitest";
import { SPELL_KEYS, spellSlot } from "../src/keys.ts";

describe("spell hotkeys (M5 review regression)", () => {
  it("Shift+M and Shift+N reach slots 7 and 8 although e.key is upper case", () => {
    expect(spellSlot({ key: "M", shiftKey: true, ctrlKey: false })).toBe(6);
    expect(spellSlot({ key: "N", shiftKey: true, ctrlKey: false })).toBe(7);
  });
  it("plain letters map to the first six slots; m alone, ctrl combos and other keys do not cast", () => {
    expect(["z", "x", "c", "v", "b", "n"].map((key) => spellSlot({ key, shiftKey: false, ctrlKey: false }))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(spellSlot({ key: "m", shiftKey: false, ctrlKey: false })).toBe(-1);
    expect(spellSlot({ key: "z", shiftKey: false, ctrlKey: true })).toBe(-1);
    expect(spellSlot({ key: "Escape", shiftKey: false, ctrlKey: false })).toBe(-1);
  });
  it("there is a key for every v1 spell", async () => {
    const { basePack } = await import("../../sim/test/helpers.ts");
    const v1 = basePack().files.spells.spells.filter((s) => s.v1).length;
    expect(SPELL_KEYS.length).toBeGreaterThanOrEqual(v1);
  });
});

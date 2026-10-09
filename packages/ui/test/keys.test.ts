import { describe, expect, it } from "vitest";
import { KEY_ACTIONS, SPELL_KEYS, actionFor, defaultKeymap, keyLabel, rebind, sanitizeKeymap, spellSlot } from "../src/keys.ts";

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

describe("rebindable keys (M8 settings)", () => {
  const ev = (key: string, shiftKey = false, ctrlKey = false) => ({ key, shiftKey, ctrlKey });
  it("defaults are unique, avoid spell keys and map events to actions", () => {
    const km = defaultKeymap();
    const keys = Object.values(km);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(SPELL_KEYS as readonly string[]).not.toContain(k);
    expect(actionFor(km, ev("d"))).toBe("buildDwelling");
    expect(actionFor(km, ev("m"))).toBe("toggleMap");
    expect(actionFor(km, ev("M", true))).toBe(null);
    expect(actionFor(km, ev("d", false, true))).toBe(null);
    expect(actionFor(km, ev("Backspace"))).toBe("cancelCast");
    expect(keyLabel(ev(" "))).toBe("Space");
    expect(keyLabel(ev("Shift", true))).toBe("");
  });
  it("rebinding swaps a taken key and refuses reserved keys", () => {
    const km = defaultKeymap();
    const r = rebind(km, "buildDwelling", "T");
    expect(r.error).toBe(null);
    expect(r.keymap.buildDwelling).toBe("T");
    expect(r.keymap.buildTower).toBe("D");
    expect(rebind(km, "help", "Z").error).toMatch(/reserved/);
    expect(rebind(km, "help", "Escape").error).toMatch(/reserved/);
    expect(rebind(km, "help", "5").error).toMatch(/reserved/);
  });
  it("a stored keymap is sanitized against defaults, junk and duplicates", () => {
    expect(sanitizeKeymap(null)).toEqual(defaultKeymap());
    expect(sanitizeKeymap({ help: "J", bogus: "K" }).help).toBe("J");
    expect(sanitizeKeymap({ help: "Z" }).help).toBe("H");
    // D for help collides with buildDwelling's default: no two actions may share a key
    const km = sanitizeKeymap({ help: "D" });
    expect(new Set(Object.values(km)).size).toBe(KEY_ACTIONS.length);
  });
});

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
  it("the second row (Shift plus a letter) reaches slots 9 to 16 for spells earned at worship sites (BACKLOG 1)", () => {
    expect(["Z", "X", "C", "V", "B", "J", "K", "L"].map((key) => spellSlot({ key, shiftKey: true, ctrlKey: false }))).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(new Set(SPELL_KEYS).size).toBe(16);
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
    expect(actionFor(km, ev("f"))).toBe("photoMode");
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
  it("held camera keys never take a Shift combo (the held key set only sees the bare key)", () => {
    const km = defaultKeymap();
    expect(rebind(km, "rotateLeft", "Shift+Q").error).toMatch(/Shift/);
    const withShift = rebind(km, "help", "Shift+Y").keymap;
    expect(rebind(withShift, "help", "Q").error).toMatch(/Shift/);
    expect(sanitizeKeymap({ rotateRight: "Shift+E" }).rotateRight).toBe("E");
  });
  it("a stored keymap is sanitized against defaults, junk and duplicates", () => {
    expect(sanitizeKeymap(null)).toEqual(defaultKeymap());
    expect(sanitizeKeymap({ help: "J", bogus: "K" }).help).toBe("J");
    expect(sanitizeKeymap({ help: "Z" }).help).toBe("H");
    // D for help collides with buildDwelling's default: no two actions may share a key
    const km = sanitizeKeymap({ help: "D" });
    expect(new Set(Object.values(km)).size).toBe(KEY_ACTIONS.length);
  });

  it("review fix: an old binding on a newer action's default key keeps every custom binding", () => {
    const def = defaultKeymap();
    const clash = KEY_ACTIONS.find((a) => a.id !== "help" && def[a.id] === "L")!;
    const km = sanitizeKeymap({ help: "L", photoMode: def.photoMode });
    expect(km.help).toBe("L");
    expect(km[clash.id]).toBe("");
    expect(km.photoMode).toBe(def.photoMode);
  });

  it("review fix: numpad + and Shift+= speed the game up like =", () => {
    const km = defaultKeymap();
    expect(actionFor(km, { key: "+", shiftKey: false, ctrlKey: false })).toBe("speedUp");
    expect(actionFor(km, { key: "+", shiftKey: true, ctrlKey: false })).toBe("speedUp");
  });
});

describe("QoL keys: game speed, briefing, quick save", () => {
  const ev = (key: string, shiftKey = false, ctrlKey = false) => ({ key, shiftKey, ctrlKey });
  it("speed and briefing are rebindable actions with free default keys", () => {
    const km = defaultKeymap();
    expect(actionFor(km, ev("-"))).toBe("speedDown");
    expect(actionFor(km, ev("="))).toBe("speedUp");
    expect(actionFor(km, ev("o"))).toBe("briefing");
    expect(rebind(km, "speedUp", "]").keymap.speedUp).toBe("]");
  });
  it("F5 and F9 (quick save and load) are reserved, so no binding can take them", () => {
    const km = defaultKeymap();
    expect(rebind(km, "help", "F5").error).toMatch(/reserved/);
    expect(rebind(km, "briefing", "F9").error).toMatch(/reserved/);
    expect(sanitizeKeymap({ help: "F5" }).help).toBe("H");
  });
});

describe("QoL 2 keys: latest alert and idle troops", () => {
  const ev = (key: string, shiftKey = false, ctrlKey = false) => ({ key, shiftKey, ctrlKey });
  it("U jumps to the latest alert and the period key picks the next idle troops; both rebind", () => {
    const km = defaultKeymap();
    expect(actionFor(km, ev("u"))).toBe("lastAlert");
    expect(actionFor(km, ev("."))).toBe("idleTroops");
    // Space stays the pause key, never one of these
    expect(actionFor(km, ev(" "))).toBe(null);
    const r = rebind(km, "idleTroops", ",");
    expect(r.error).toBe(null);
    expect(actionFor(r.keymap, ev(","))).toBe("idleTroops");
    expect(rebind(km, "lastAlert", "Space").error).toMatch(/reserved/);
    expect(new Set(Object.values(km)).size).toBe(KEY_ACTIONS.length);
  });
});

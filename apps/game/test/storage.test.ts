import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { createSkirmish, makeSave } from "../src/session.ts";
import { MemoryKV, defaultSettings, deleteSlot, loadSettings, readSlot, slotMeta, storeSettings, writeSlot, type KV } from "../src/storage.ts";

describe("settings and save slots (M8)", () => {
  it("settings round trip; bad stored values fall back to defaults", () => {
    const kv = new MemoryKV();
    expect(loadSettings(kv)).toEqual(defaultSettings());
    const s = { ...defaultSettings(), quality: "low" as const, music: 15 };
    s.keymap = { ...s.keymap, help: "J" };
    expect(storeSettings(kv, s)).toBe(true);
    expect(loadSettings(kv)).toEqual(s);
    kv.setItem("hearthfall.settings.v1", JSON.stringify({ quality: "ultra", master: 400, sfx: "x", keymap: { help: "Escape" } }));
    const d = loadSettings(kv);
    expect(d.quality).toBe("high");
    expect(d.master).toBe(100);
    expect(d.sfx).toBe(80);
    expect(d.keymap.help).toBe("H");
    kv.setItem("hearthfall.settings.v1", "{not json");
    expect(loadSettings(kv)).toEqual(defaultSettings());
  });

  it("slots write, list, read and delete; a full storage reports an error and leaves the slot empty", () => {
    const pack = loadBasePack().pack!;
    const params = { seed: 4, level: "continents", size: 96, tribes: 2, ai: ["aggressive"], difficulty: "normal" };
    const w = createSkirmish(pack, params);
    w.run(40);
    const save = makeSave(w, params, [], [], "2026-10-09T00:00:00.000Z");
    const kv = new MemoryKV();
    expect(writeSlot(kv, 2, save)).toBeNull();
    expect(slotMeta(kv, 2)).toMatchObject({ tick: 40, map: "continents 96, seed 4" });
    expect(readSlot(kv, 2).hash).toBe(save.hash);
    deleteSlot(kv, 2);
    expect(slotMeta(kv, 2)).toBeNull();
    expect(() => readSlot(kv, 2)).toThrow(/empty/);
    const full: KV = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
    expect(writeSlot(full, 1, save)).toMatch(/could not save: QuotaExceededError/);
  });

  it("a failed overwrite keeps the save already in the slot", () => {
    const pack = loadBasePack().pack!;
    const params = { seed: 4, level: "continents", size: 96, tribes: 2, ai: ["aggressive"], difficulty: "normal" };
    const w = createSkirmish(pack, params);
    const first = makeSave(w, params, [], [], "2026-10-09T00:00:00.000Z");
    w.run(40);
    const second = makeSave(w, params, [], [], "2026-10-09T00:01:00.000Z");
    const kv = new MemoryKV();
    expect(writeSlot(kv, 1, first)).toBeNull();
    let fail = false;
    const flaky: KV = { getItem: (k) => kv.getItem(k), setItem: (k, v) => { if (fail) throw new Error("QuotaExceededError"); kv.setItem(k, v); }, removeItem: (k) => kv.removeItem(k) };
    fail = true;
    expect(writeSlot(flaky, 1, second)).toMatch(/could not save/);
    expect(readSlot(kv, 1).hash).toBe(first.hash);
    expect(slotMeta(kv, 1)?.tick).toBe(first.tick);
  });
});

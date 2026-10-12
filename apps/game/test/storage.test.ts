import { describe, expect, it } from "vitest";
import { loadBasePack } from "../../../tools/harness/datapack.mjs";
import { createSkirmish, makeSave } from "../src/session.ts";
import { MemoryKV, autoUiScale, defaultSettings, deleteSlot, sanitizeUiScale, loadSettings, readSlot, slotMeta, storeSettings, writeSlot, type KV } from "../src/storage.ts";

describe("interface scale (S4 L7-F)", () => {
  it("fits the screen: 100 at 1080p and below, 135 at 1440p, 200 at 4K and up", () => {
    expect(autoUiScale(1280, 720)).toBe(100);
    expect(autoUiScale(1920, 1080)).toBe(100);
    expect(autoUiScale(2560, 1440)).toBe(135);
    expect(autoUiScale(3440, 1440)).toBe(135);
    expect(autoUiScale(3840, 2160)).toBe(200);
    expect(autoUiScale(7680, 4320)).toBe(200);
  });
  it("stores 0 (fit) or a slider step from 75 to 200; anything else falls back", () => {
    expect(sanitizeUiScale(0, 100)).toBe(0);
    expect(sanitizeUiScale(75, 0)).toBe(75);
    expect(sanitizeUiScale(137, 0)).toBe(135);
    expect(sanitizeUiScale(200, 0)).toBe(200);
    expect(sanitizeUiScale(60, 0)).toBe(0);
    expect(sanitizeUiScale(205, 0)).toBe(0);
    expect(sanitizeUiScale("125", 0)).toBe(0);
    expect(sanitizeUiScale(Number.NaN, 0)).toBe(0);
    // the old fixed steps still load
    for (const v of [80, 90, 100, 110, 125, 150]) expect(sanitizeUiScale(v, 0)).toBe(v);
  });
});

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
    // BACKLOG 8: accessibility settings round trip and fall back to the defaults
    expect(storeSettings(kv, { ...defaultSettings(), palette: "colorblind", uiScale: 125, subtitles: false })).toBe(true);
    expect(loadSettings(kv)).toMatchObject({ palette: "colorblind", uiScale: 125, subtitles: false });
    kv.setItem("hearthfall.settings.v1", JSON.stringify({ palette: "sepia", uiScale: 333, subtitles: "yes" }));
    expect(loadSettings(kv)).toMatchObject({ palette: "default", uiScale: 0, subtitles: true });
    // BACKLOG 14a: miniature focus round trips and falls back to "default"
    expect(storeSettings(kv, { ...defaultSettings(), miniature: "off" })).toBe(true);
    expect(loadSettings(kv).miniature).toBe("off");
    kv.setItem("hearthfall.settings.v1", JSON.stringify({ miniature: "blurry" }));
    expect(loadSettings(kv).miniature).toBe("default");
    // BACKLOG 14: lighting and weather round trip and fall back
    expect(storeSettings(kv, { ...defaultSettings(), lighting: "evening", weather: "rain" })).toBe(true);
    expect(loadSettings(kv)).toMatchObject({ lighting: "evening", weather: "rain" });
    kv.setItem("hearthfall.settings.v1", JSON.stringify({ lighting: "noon", weather: "snow" }));
    expect(loadSettings(kv)).toMatchObject({ lighting: "default", weather: "clear" });
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
    // the save write succeeds and the meta write fails: the old save and meta must both come back
    let metaFails = 1;
    const flaky: KV = { getItem: (k) => kv.getItem(k), setItem: (k, v) => { if (k.endsWith(".meta") && metaFails-- > 0) throw new Error("QuotaExceededError"); kv.setItem(k, v); }, removeItem: (k) => kv.removeItem(k) };
    expect(writeSlot(flaky, 1, second)).toMatch(/could not save/);
    expect(readSlot(kv, 1).hash).toBe(first.hash);
    expect(slotMeta(kv, 1)?.tick).toBe(first.tick);
  });
});

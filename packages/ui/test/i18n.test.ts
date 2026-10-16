import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keyText, locale, missingStrings, pseudoize, setKeyNames, setStrings, t } from "../src/i18n.ts";
import { KEY_ACTIONS, defaultKeymap } from "../src/keys.ts";

const en = { "a.hello": "Hello {name}", "a.back": "Back" };

describe("localization scaffold (BACKLOG 22)", () => {
  it("looks keys up with placeholders, falls back to English, then to the key", () => {
    setStrings(en, "xx", { "a.back": "Zuruck" });
    expect(locale()).toBe("xx");
    expect(t("a.back")).toBe("Zuruck");
    expect(t("a.hello", { name: "Shaper" })).toBe("Hello Shaper");
    expect(t("a.hello")).toBe("Hello {name}");
    expect(t("a.none")).toBe("a.none");
    expect([...missingStrings]).toEqual(["a.none"]);
  });

  it("pseudo-localizes every letter, keeps placeholders and pads the text", () => {
    setStrings(en, "pseudo");
    const s = t("a.hello", { name: "Shaper" });
    expect(s.startsWith("[") && s.endsWith("]")).toBe(true);
    expect(s).toContain("Shaper");
    expect(s).not.toContain("Hello");
    expect(pseudoize("Back {n}")).toMatch(/^\[\S+ \{n\}~+\]$/);
    expect(pseudoize("Settings").length).toBeGreaterThanOrEqual(Math.ceil("Settings".length * 1.4) + 2);
  });

  it("names the keys in force: {key:action} reads the binding, defaults until the app sets them (S4 L8-B)", () => {
    setStrings({ "a.dw": "Press {key:buildDwelling} to place a Dwelling, {n} left" }, "en");
    setKeyNames(defaultKeymap());
    expect(t("a.dw", { n: 2 })).toBe("Press D to place a Dwelling, 2 left");
    setKeyNames({ ...defaultKeymap(), buildDwelling: "Shift+K" });
    expect(t("a.dw", { n: 1 })).toBe("Press Shift+K to place a Dwelling, 1 left");
    expect(keyText("Select her with {key:selectShaper}")).toBe("Select her with S");
    // an unknown action keeps its placeholder so a typo is visible
    expect(keyText("{key:nope} x")).toBe("{key:nope} x");
    // pseudo keeps the placeholder whole, then fills it
    setStrings({ "a.dw": "Press {key:buildDwelling}" }, "pseudo");
    expect(t("a.dw")).toContain("Shift+K");
    setKeyNames(defaultKeymap());
  });

  it("every {key:action} in the shipped strings, tips and levels names a real action (S4 L8-B)", () => {
    const root = (rel: string) => fileURLToPath(new URL("../../../" + rel, import.meta.url));
    const files = ["data/strings/en.json", "data/ui.json", ...readdirSync(root("data/levels")).filter((f) => f.endsWith(".json")).map((f) => "data/levels/" + f)];
    const ids = new Set<string>(KEY_ACTIONS.map((a) => a.id));
    let used = 0;
    for (const f of files) {
      for (const m of readFileSync(root(f), "utf8").matchAll(/\{key:(\w+)\}/g)) {
        used++;
        expect(ids.has(m[1]), `${f}: {key:${m[1]}}`).toBe(true);
      }
    }
    expect(used).toBeGreaterThan(10);
  });
});

import { describe, expect, it } from "vitest";
import { locale, missingStrings, pseudoize, setStrings, t } from "../src/i18n.ts";

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
});

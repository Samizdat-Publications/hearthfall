// BACKLOG 8: the colorblind tribe palette keeps every pair of tribe colors apart under simulated
// protanopia, deuteranopia and tritanopia; every voice cue the game plays has a subtitle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { minPairDistance, seenAs } from "../src/index.ts";

const style = JSON.parse(readFileSync(new URL("../../../data/base/style.json", import.meta.url), "utf8"));
const TRIBES = ["azure", "crimson", "amber", "jade"];

describe("accessibility data (BACKLOG 8)", () => {
  it("simulation sanity: red and green collapse for deuteranopia, not for normal vision", () => {
    const d = (v: "normal" | "deutan") => {
      const a = seenAs("#C8312E", v);
      const b = seenAs("#2FA36B", v);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    };
    expect(d("normal")).toBeGreaterThan(2 * d("deutan"));
  });

  it("the colorblind palette keeps all four tribes at least 40 Lab units apart for every vision type, better than the default", () => {
    const cb = TRIBES.map((t) => style.tribePalettes.colorblind[t]);
    const def = TRIBES.map((t) => style.palette[t]);
    for (const v of ["protan", "deutan", "tritan", "normal"] as const) {
      expect(minPairDistance(cb, v)).toBeGreaterThanOrEqual(40);
    }
    const worst = (p: string[]) => Math.min(...(["protan", "deutan", "tritan"] as const).map((v) => minPairDistance(p, v)));
    expect(worst(cb)).toBeGreaterThan(worst(def) + 15);
  });

  it("every voice cue the game plays has a subtitle", () => {
    const src = readFileSync(new URL("../../../apps/game/src/game.ts", import.meta.url), "utf8");
    const cues = new Set(src.match(/voice\.[a-z_]+\.[a-z_]+/g) ?? []);
    expect(cues.size).toBeGreaterThan(3);
    for (const c of cues) expect(style.subtitles[c]?.text, c).toBeTruthy();
  });
});

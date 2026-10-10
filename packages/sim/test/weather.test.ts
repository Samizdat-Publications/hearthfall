// BACKLOG 14b: match weather. Rain slows every unit to balance.weather.rain.speedMult of its speed; a clear
// world keeps its old hash (weather is hashed only in rain).
import { describe, expect, it } from "vitest";
import { World } from "../src/world.ts";
import { basePack } from "./helpers.ts";

const MAP = { generator: "flat", size: 64, tribes: 1 };

function walk(weather?: "clear" | "rain") {
  const p = basePack();
  const w = new World({ pack: p.files, packHash: p.hash, seed: 14, map: MAP, ...(weather ? { weather } : {}) });
  const id = w.spawnUnit("warden", 0, 10, 32);
  w.step([{ tick: w.tick, tribe: 0, type: "move", args: { units: [id], to: [30, 32] } }]);
  for (let k = 0; k < 60; k++) w.step([]);
  return { w, dist: w.ents.x[w.ents.index(id)] - 10 };
}

describe("weather (BACKLOG 14b)", () => {
  it("rain slows travel by the data multiplier", () => {
    const clear = walk();
    const rain = walk("rain");
    const mult = clear.w.cfg.pack.balance.weather!.rain.speedMult;
    expect(rain.w.weather).toBe("rain");
    expect(rain.w.speedMult).toBe(mult);
    expect(clear.dist).toBeGreaterThan(2);
    expect(rain.dist / clear.dist).toBeCloseTo(mult, 1);
    expect(rain.w.invariants()).toEqual([]);
  });

  it("a clear world hashes as before and differs from a rainy one", () => {
    const p = basePack();
    const a = new World({ pack: p.files, packHash: p.hash, seed: 14, map: MAP });
    const b = new World({ pack: p.files, packHash: p.hash, seed: 14, map: MAP, weather: "clear" });
    const c = new World({ pack: p.files, packHash: p.hash, seed: 14, map: MAP, weather: "rain" });
    expect(b.hash().all).toBe(a.hash().all);
    expect(c.hash().all).not.toBe(a.hash().all);
  });
});

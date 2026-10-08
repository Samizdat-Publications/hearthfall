import { describe, expect, it } from "vitest";
import { Fnv } from "../src/hash.ts";
import { Rng, hash2 } from "../src/rng.ts";

describe("rng", () => {
  it("same seed gives the same sequence; different seeds differ", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.float("combat"));
    expect(Array.from({ length: 50 }, () => b.float("combat"))).toEqual(sa);
    expect(Array.from({ length: 50 }, () => c.float("combat"))).not.toEqual(sa);
  });

  it("streams are independent: drawing from one never shifts another", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 1000; i++) b.float("combat");
    expect(Array.from({ length: 20 }, () => a.float("terrain"))).toEqual(Array.from({ length: 20 }, () => b.float("terrain")));
  });

  it("int stays in range and covers it", () => {
    const r = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int("misc", 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      seen.add(v);
    }
    expect(seen.size).toBe(10);
  });

  it("state round-trips through a copy (snapshots)", () => {
    const a = new Rng(9);
    a.float("ai");
    const b = new Rng(0, a.state);
    expect(b.float("ai")).toBe(a.float("ai"));
  });

  it("golden: first outputs are fixed forever (changing them breaks every replay)", () => {
    const r = new Rng(12345);
    expect([r.nextU32(0), r.nextU32(0), r.nextU32(3)]).toMatchSnapshot();
    expect(hash2(3, 4, 5)).toMatchSnapshot();
  });
});

describe("fnv hash", () => {
  it("is stable and order sensitive", () => {
    expect(new Fnv().bytes(new Uint8Array([1, 2, 3])).hex()).toBe(new Fnv().bytes(new Uint8Array([1, 2, 3])).hex());
    expect(new Fnv().u32(1).u32(2).hex()).not.toBe(new Fnv().u32(2).u32(1).hex());
    expect(new Fnv().bytes(new Uint8Array([])).hex()).toBe("811c9dc5");
  });
});

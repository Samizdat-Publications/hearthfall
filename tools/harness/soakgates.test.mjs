import { describe, expect, it } from "vitest";
import { giveUpViolations } from "./soakgates.mjs";

describe("BACKLOG 59: soak give-up gate", () => {
  it("a reachable non-chase give-up fails at once, an unreachable one does not", () => {
    const counts = new Map();
    expect(giveUpViolations([{ type: "orderGaveUp", id: 7, reachable: 1, dist: 4 }], counts, 5)).toHaveLength(1);
    expect(giveUpViolations([{ type: "orderGaveUp", id: 7, reachable: 0, dist: 4 }], counts, 5)).toEqual([]);
  });

  it("chase give-ups are excused until one unit passes the limit, once, across ticks", () => {
    const counts = new Map();
    const chase = (id) => ({ type: "orderGaveUp", id, chase: 1, reachable: 1, dist: 9 });
    for (let k = 0; k < 5; k++) expect(giveUpViolations([chase(3), chase(4)], counts, 5)).toEqual([]);
    const v = giveUpViolations([chase(3)], counts, 5);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("unit 3 gave up a chase 6 times");
    expect(giveUpViolations([chase(3)], counts, 5)).toEqual([]);
    expect(counts.get(4)).toBe(5);
  });
});

// BACKLOG 0c: build buttons name the stone a building costs beside its wood.
import { describe, expect, it } from "vitest";
import { costText } from "../src/hud.tsx";

describe("build cost text", () => {
  it("names wood alone, or wood and stone", () => {
    expect(costText({ wood: 3, stone: 0 })).toBe("3 wood");
    expect(costText({ wood: 5, stone: 2 })).toBe("5 wood, 2 stone");
  });
});

// BACKLOG 17: the main menu build tag is a date and commit in real builds and empty in test builds (stable shots).
import { describe, expect, it } from "vitest";
import { buildTag } from "../vite.config.ts";

describe("build tag", () => {
  it("is empty in test builds and a date with the commit otherwise", () => {
    expect(buildTag("test")).toBe("");
    expect(buildTag("production")).toMatch(/^\d{4}-\d{2}-\d{2}( [0-9a-f]{4,})?$/);
  });
});

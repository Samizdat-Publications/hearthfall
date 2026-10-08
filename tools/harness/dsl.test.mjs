import { describe, expect, it } from "vitest";
import { evaluate, parse } from "./dsl.mjs";

const ctx = { sea: 120, a: { b: 3, f: (x, y) => x + y }, list: [1, 2], count: (s) => s.length };
const run = (src) => evaluate(parse(src), ctx);

describe("scenario DSL", () => {
  it("arithmetic, precedence, comparison and logic", () => {
    expect(run("1 + 2 * 3 == 7")).toBe(true);
    expect(run("(1 + 2) * 3 == 9 && !(2 > 3)")).toBe(true);
    expect(run("-a.b < 0 || false")).toBe(true);
    expect(run("a.f(2, 5) >= sea / 20")).toBe(true);
    expect(run("count([1, 2, 3]) == 3")).toBe(true);
    expect(run("'x' == \"x\"")).toBe(true);
  });

  it("refuses unknown names and prototype access", () => {
    expect(() => run("nope > 1")).toThrow(/unknown name/);
    expect(() => run("a.constructor")).toThrow(/unknown name/);
    expect(() => run("a.__proto__")).toThrow(/unknown name/);
    expect(() => run("list.map")).toThrow(/unknown name/);
  });

  it("rejects malformed input", () => {
    expect(() => parse("1 +")).toThrow();
    expect(() => parse("1 2")).toThrow(/trailing/);
    expect(() => parse("a; b")).toThrow(/unexpected/);
  });

  it("records comparison operands for failure messages", () => {
    const trace = [];
    evaluate(parse("a.b == 4"), ctx, trace);
    expect(trace).toEqual([[3, "==", 4]]);
  });
});

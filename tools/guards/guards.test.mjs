import { describe, expect, it } from "vitest";
import { scan } from "./determinism.mjs";
import { stripCode } from "./lib.mjs";

const msgs = (src, file = "packages/sim/src/x.ts") => scan(file, src).map((i) => i.msg);

describe("determinism guard", () => {
  it("flags banned Math, **, clocks, DOM, for-in, any and imports", () => {
    expect(msgs("const a = Math.sin(1);")[0]).toMatch(/Math.sin/);
    expect(msgs("const a = 2 ** 3;")[0]).toMatch(/\*\*/);
    expect(msgs("const t = Date.now();")[0]).toMatch(/Date/);
    expect(msgs("setTimeout(f, 1);")[0]).toMatch(/setTimeout/);
    expect(msgs("for (const k in obj) {}")[0]).toMatch(/for...in/);
    expect(msgs("let x: any = 1;")[0]).toMatch(/any/);
    expect(msgs('import * as T from "three";')[0]).toMatch(/three/);
    expect(msgs("const r = Math.random();")[0]).toMatch(/Math.random/);
  });

  it("allows the IEEE-exact allowlist and ignores comments and strings", () => {
    expect(msgs("const a = Math.floor(Math.sqrt(2)) + Math.imul(3, 4);")).toEqual([]);
    expect(msgs('// Math.sin is banned\nconst s = "Date ** Math.cos";')).toEqual([]);
    expect(msgs("const d = obj.Date; const w = x.window;")).toEqual([]);
  });

  it("stripCode keeps offsets and newlines", () => {
    const src = 'a /* x\ny */ "s\\"q" // c\nb';
    const out = stripCode(src);
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
  });
});

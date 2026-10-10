import { describe, expect, it } from "vitest";
import { run as runData } from "./data.mjs";
import { scan as dashScan, run as runDashes } from "./dashes.mjs";
import { scan, run as runDeterminism } from "./determinism.mjs";
import { missingCommands, run as runDocs } from "./docs.mjs";
import { scan as importScan, run as runImports } from "./imports.mjs";
import { scan as ipScan, run as runIp } from "./ip-names.mjs";
import { stripCode } from "./lib.mjs";
import { check as stringsCheck, run as runStrings } from "./strings.mjs";

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

  it("flags default sorts, Intl, Symbol and locale APIs (BACKLOG 28)", () => {
    expect(msgs("ids.sort();")[0]).toMatch(/sort\(\) without a comparator/);
    expect(msgs("const b = a.toSorted( );")[0]).toMatch(/toSorted/);
    expect(msgs("const f = new Intl.NumberFormat();")[0]).toMatch(/Intl/);
    expect(msgs("const k = Symbol(\"x\");")[0]).toMatch(/Symbol/);
    expect(msgs("a.name.localeCompare(b.name);")[0]).toMatch(/localeCompare/);
    expect(msgs("const s = n.toLocaleString();")[0]).toMatch(/toLocaleString/);
    expect(msgs("ids.sort((a, b) => a - b); const x = obj.Symbol; const y = obj.sort;")).toEqual([]);
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

// BACKLOG 27: every guard catches a planted violation, passes clean input, and scans real files
describe("guard self-tests", () => {
  it("imports: enforces the layer table and relative escapes", () => {
    expect(importScan("sim", "packages/sim/src/x.ts", 'import { a } from "@hearthfall/render";')).toHaveLength(1);
    expect(importScan("ui", "packages/ui/src/x.ts", 'import * as THREE from "three";')).toHaveLength(1);
    expect(importScan("sim", "packages/sim/src/x.ts", 'import { b } from "../../ai/src/y.ts";')[0].msg).toMatch(/escapes/);
    expect(importScan("ai", "packages/ai/src/x.ts", 'import { W } from "@hearthfall/sim";\nimport { d } from "@hearthfall/data";\nimport { z } from "./z.ts";')).toEqual([]);
  });

  it("ip-names: flags distinctive names in any case and passes our own", () => {
    const banned = ["Sha" + "man", "fire" + "storm", "Arma" + "geddon"];
    for (const b of banned) expect(ipScan("data/x.json", `{"name": "${b}"}`)).toHaveLength(1);
    expect(ipScan("data/x.json", '{"name": "Shaper", "spell": "lightning"}')).toEqual([]);
  });

  it("dashes: flags em and en dashes and their entities", () => {
    const em = String.fromCharCode(0x2014);
    const en = String.fromCharCode(0x2013);
    expect(dashScan("docs/x.md", `a ${em} b`)).toHaveLength(1);
    expect(dashScan("docs/x.md", `1${en}2`)).toHaveLength(1);
    expect(dashScan("docs/x.html", "a &" + "mdash; b")).toHaveLength(1);
    expect(dashScan("docs/x.md", "a - b, c: d")).toEqual([]);
  });

  it("docs: flags commands missing from package.json and a missing section", () => {
    const md = "## 1. Commands\n`npm run qa` and `npm run nope`\n## 2. Next";
    expect(missingCommands(md, { qa: "x" }).map((i) => i.msg)).toEqual(['command "npm run nope" missing from package.json']);
    expect(missingCommands("no sections", {})).toHaveLength(1);
    expect(missingCommands("## 1. Commands\nnothing\n## 2.", {})[0].msg).toMatch(/names no npm command/);
  });

  it("strings: flags missing, unused and mismatched keys", () => {
    const en = { "a.b": "Hi {name}", "a.c": "Unused" };
    const out = stringsCheck(en, [{ file: "x.ts", src: 't("a.b"); t("a.zz");' }], { "fr.json": { "a.b": "Salut", "a.q": "?" } }).map((i) => i.msg);
    expect(out.some((m) => m.includes('"a.zz" is not in'))).toBe(true);
    expect(out.some((m) => m.includes('unused string key "a.c"'))).toBe(true);
    expect(out.some((m) => m.includes('"a.b" placeholders differ'))).toBe(true);
    expect(out.some((m) => m.includes('"a.q" is not in en.json'))).toBe(true);
    expect(stringsCheck({ k: "x" }, [{ file: "x.ts", src: 't("k")' }], {})).toEqual([]);
  });

  it("every guard scans more than 0 files of the live repo and passes", () => {
    for (const run of [runDeterminism, runImports, runData, runDocs, runIp, runDashes, runStrings]) {
      const r = run();
      expect(r.files, r.name).toBeGreaterThan(0);
      expect(r.issues, r.name).toEqual([]);
    }
  }, 60000);
});

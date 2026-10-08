// Determinism guard for packages/sim and packages/ai (docs/ARCHITECTURE.md section 3).
import { isMain, lineOf, read, rel, report, stripCode, walk } from "./lib.mjs";

const MATH_ALLOW = new Set(["abs", "min", "max", "floor", "ceil", "round", "trunc", "sign", "sqrt", "imul", "fround", "clz32"]);
const BANNED_GLOBALS = ["Date", "performance", "setTimeout", "setInterval", "setImmediate", "crypto", "window", "document", "navigator", "globalThis", "requestAnimationFrame", "localStorage", "queueMicrotask", "process"];
const BANNED_IMPORTS = /from\s+["'](three|three\/.*|preact.*|node:.*|fs|path|os|@hearthfall\/(render|ui|audio|game))["']/g;

export function run() {
  const issues = [];
  const files = walk(["packages/sim/src", "packages/ai/src"], [".ts"]);
  for (const abs of files) issues.push(...scan(rel(abs), read(abs)));
  return { name: "determinism", issues, files: files.length };
}

/** Scan one sim/ai source file; exported for the guard self-tests. */
export function scan(file, raw) {
  const issues = [];
  {
    if (file.endsWith("dmath_tables.ts")) {
      if (!raw.startsWith("// GENERATED ONCE by tools/gen/dmath-tables.mjs")) issues.push({ file, line: 1, msg: "dmath_tables.ts must keep its generated header" });
      return issues;
    }
    const src = stripCode(raw);
    const add = (idx, msg) => issues.push({ file, line: lineOf(src, idx), msg });
    for (const m of src.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_]+)/g)) if (!MATH_ALLOW.has(m[1])) add(m.index, `Math.${m[1]} is not on the determinism allowlist (use dmath)`);
    for (const m of src.matchAll(/\*\*/g)) add(m.index, "the ** operator is banned in sim/ai (use explicit multiplication)");
    for (const g of BANNED_GLOBALS) for (const m of src.matchAll(new RegExp(`(?<![.\\w$])${g}\\b`, "g"))) add(m.index, `${g} is banned in sim/ai (no clocks, timers, DOM or I/O)`);
    for (const m of src.matchAll(/\bfor\s*\([^)]*\bin\b/g)) add(m.index, "for...in is banned in sim/ai (key order hazards); iterate arrays");
    if (file.startsWith("packages/sim/")) for (const m of src.matchAll(/(:\s*any\b|\bas\s+any\b|<any>)/g)) add(m.index, "no `any` in packages/sim");
    for (const m of raw.matchAll(BANNED_IMPORTS)) issues.push({ file, line: lineOf(raw, m.index), msg: `forbidden import in sim/ai: ${m[1]}` });
  }
  return issues;
}

if (isMain(import.meta.url)) process.exitCode = report(run());

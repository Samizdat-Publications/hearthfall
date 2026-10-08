#!/usr/bin/env node
// Query a JSON report without dumping it: node tools/harness/q.mjs <file> [path]
// path: dot and bracket notation (checks.screenshot[0].renderer), "*" maps over arrays,
// "keys" lists object keys, "len" gives array length. Output is truncated to 2000 chars.
import { readFileSync } from "node:fs";

const [file, path = ""] = process.argv.slice(2);
if (!file) {
  console.log("usage: node tools/harness/q.mjs <file.json> [path]");
  process.exit(1);
}
let v = JSON.parse(readFileSync(file, "utf8"));
const parts = path.replace(/\[(\d+|\*)\]/g, ".$1").split(".").filter(Boolean);
const step = (x, p) => {
  if (p === "keys") return x && typeof x === "object" ? Object.keys(x) : [];
  if (p === "len") return Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0;
  return x?.[p];
};
for (let i = 0; i < parts.length; i++) {
  const p = parts[i];
  if (p === "*" && Array.isArray(v)) {
    const restPath = parts.slice(i + 1);
    v = v.map((e) => restPath.reduce(step, e));
    break;
  }
  v = step(v, p);
}
const s = typeof v === "string" ? v : JSON.stringify(v, null, 1);
console.log(s === undefined ? "undefined" : s.length > 2000 ? s.slice(0, 2000) + `\n... (${s.length} chars)` : s);

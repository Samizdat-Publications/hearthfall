// Docs freshness guard: docs/DATA.md and data/schema/ regenerate byte-identical, and every npm command
// named in docs/TESTING.md section 1 exists in package.json.
import { existsSync, readFileSync } from "node:fs";
import { dataDocs, jsonSchemas } from "../harness/datapack.mjs";
import { ROOT, isMain, report } from "./lib.mjs";

const norm = (s) => s.replace(/\r\n/g, "\n");

export function run() {
  const issues = [];
  const dataMd = ROOT + "docs/DATA.md";
  if (!existsSync(dataMd) || norm(readFileSync(dataMd, "utf8")) !== dataDocs()) issues.push({ file: "docs/DATA.md", line: 0, msg: "stale, run npm run data:docs" });
  for (const [name, text] of Object.entries(jsonSchemas())) {
    const p = ROOT + "data/schema/" + name;
    if (!existsSync(p) || norm(readFileSync(p, "utf8")) !== text) issues.push({ file: `data/schema/${name}`, line: 0, msg: "stale, run npm run data:docs" });
  }
  const scripts = JSON.parse(readFileSync(ROOT + "package.json", "utf8")).scripts;
  const testing = readFileSync(ROOT + "docs/TESTING.md", "utf8");
  const sec = testing.slice(testing.indexOf("## 1. Commands"), testing.indexOf("## 2."));
  for (const m of sec.matchAll(/`npm run ([a-z:-]+)/g)) if (!scripts[m[1]]) issues.push({ file: "docs/TESTING.md", line: 0, msg: `command "npm run ${m[1]}" missing from package.json` });
  return { name: "docs", issues };
}

if (isMain(import.meta.url)) process.exitCode = report(run());

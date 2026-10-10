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
  issues.push(...missingCommands(readFileSync(ROOT + "docs/TESTING.md", "utf8"), scripts));
  return { name: "docs", issues, files: 3 + Object.keys(jsonSchemas()).length };
}

/** npm commands named in TESTING.md section 1 that package.json lacks; exported for the self-tests (BACKLOG 27). */
export function missingCommands(testing, scripts) {
  const issues = [];
  const at = testing.indexOf("## 1. Commands");
  if (at < 0) return [{ file: "docs/TESTING.md", line: 0, msg: 'section "## 1. Commands" not found' }];
  const sec = testing.slice(at, testing.indexOf("## 2."));
  let n = 0;
  for (const m of sec.matchAll(/`npm run ([a-z0-9:-]+)/g)) {
    n++;
    if (!scripts[m[1]]) issues.push({ file: "docs/TESTING.md", line: 0, msg: `command "npm run ${m[1]}" missing from package.json` });
  }
  if (!n) issues.push({ file: "docs/TESTING.md", line: 0, msg: "section 1 names no npm command" });
  return issues;
}

if (isMain(import.meta.url)) process.exitCode = report(run());

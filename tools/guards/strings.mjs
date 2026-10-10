// Strings guard (BACKLOG 22, ADR-020): every t("key") in the UI and app code has an English entry in
// data/strings/en.json, every English entry is used, and other locale tables only hold English keys
// with the same {placeholders}.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { ROOT, isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

const DIR = "data/strings/";

export function run() {
  const issues = [];
  let en = {};
  try {
    en = JSON.parse(readFileSync(ROOT + DIR + "en.json", "utf8"));
  } catch (e) {
    return { name: "strings", issues: [{ file: DIR + "en.json", line: 0, msg: `unreadable: ${String(e.message).split("\n")[0]}` }] };
  }
  const used = new Set();
  for (const abs of walk(["packages/ui/src", "apps/game/src"], [".ts", ".tsx"])) {
    const src = read(abs);
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) {
      used.add(m[1]);
      if (!(m[1] in en)) issues.push({ file: rel(abs), line: lineOf(src, m.index), msg: `string key "${m[1]}" is not in ${DIR}en.json` });
    }
  }
  for (const k of Object.keys(en)) if (!used.has(k)) issues.push({ file: DIR + "en.json", line: 0, msg: `unused string key "${k}"` });
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  if (existsSync(ROOT + DIR))
    for (const f of readdirSync(ROOT + DIR).filter((x) => x.endsWith(".json") && x !== "en.json")) {
      let tab = {};
      try {
        tab = JSON.parse(readFileSync(ROOT + DIR + f, "utf8"));
      } catch (e) {
        issues.push({ file: DIR + f, line: 0, msg: `unreadable: ${String(e.message).split("\n")[0]}` });
        continue;
      }
      for (const [k, v] of Object.entries(tab)) {
        if (!(k in en)) issues.push({ file: DIR + f, line: 0, msg: `key "${k}" is not in en.json` });
        else if (holes(v) !== holes(en[k])) issues.push({ file: DIR + f, line: 0, msg: `key "${k}" placeholders differ from en.json` });
      }
    }
  return { name: "strings", issues, keys: Object.keys(en).length };
}

if (isMain(import.meta.url)) process.exitCode = report(run());

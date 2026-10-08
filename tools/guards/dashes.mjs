// Text-style guard: no em dash (U+2014) or en dash (U+2013) in docs, data, UI text or app code.
import { isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const RE = new RegExp(`[${EM}${EN}]|&mdash;|&ndash;|\\\\u2014|\\\\u2013`, "g");

export function run() {
  const issues = [];
  const files = walk(["docs", "data", "packages/ui", "apps", "CLAUDE.md", "README.md", "tools/assets/README.md"], [".md", ".json", ".ts", ".tsx", ".html", ".css", ".mjs"]);
  for (const abs of files) {
    const file = rel(abs);
    const src = read(abs);
    for (const m of src.matchAll(RE)) issues.push({ file, line: lineOf(src, m.index), msg: "em or en dash (use a comma, colon, period or spaced hyphen)" });
  }
  return { name: "dashes", issues, files: files.length };
}

if (isMain(import.meta.url)) process.exitCode = report(run());

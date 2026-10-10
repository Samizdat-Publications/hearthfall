// Text-style guard: no em dash (U+2014) or en dash (U+2013) in docs, data, UI text or app code.
import { isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const RE = new RegExp(`[${EM}${EN}]|&mdash;|&ndash;|\\\\u2014|\\\\u2013`, "g");

export function run() {
  const issues = [];
  const files = walk(["docs", "data", "mods", "packages/ui", "apps", "CLAUDE.md", "README.md", "tools/assets/README.md", "making-of"], [".md", ".json", ".ts", ".tsx", ".html", ".css", ".mjs"]);
  for (const abs of files) {
    issues.push(...scan(rel(abs), read(abs)));
  }
  return { name: "dashes", issues, files: files.length };
}

/** Check one file; exported for the guard self-tests (BACKLOG 27). */
export function scan(file, src) {
  return [...src.matchAll(RE)].map((m) => ({ file, line: lineOf(src, m.index), msg: "em or en dash (use a comma, colon, period or spaced hyphen)" }));
}

if (isMain(import.meta.url)) process.exitCode = report(run());

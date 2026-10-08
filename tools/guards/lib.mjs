// Shared helpers for guard scripts. Each guard exports run() -> { name, issues: [{file, line, msg}] }
// and prints a short summary when executed directly.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".venv", "reports", "raw", "__pycache__"]);

export function rel(p) {
  return relative(ROOT, p).split(sep).join("/");
}

/** Recursively list files under root-relative dirs whose names match the extension set. */
export function walk(dirs, exts) {
  const out = [];
  const visit = (abs) => {
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      const base = abs.split(sep).pop();
      if (SKIP_DIRS.has(base)) return;
      for (const e of readdirSync(abs).sort()) visit(join(abs, e));
    } else if (!exts || exts.some((x) => abs.endsWith(x))) out.push(abs);
  };
  for (const d of dirs) visit(join(ROOT, d));
  return out;
}

export function read(abs) {
  return readFileSync(abs, "utf8");
}

/** Line number (1 based) of a character offset. */
export function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Remove // and block comments and string/template contents, keeping offsets and newlines. */
export function stripCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + (j < n ? c : "");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function report(result) {
  const { name, issues } = result;
  for (const iss of issues.slice(0, 12)) console.log(`${iss.file}:${iss.line}  ${iss.msg}`);
  if (issues.length > 12) console.log(`... ${issues.length - 12} more`);
  console.log(issues.length ? `RESULT: FAIL ${issues.length} (${name})` : `RESULT: PASS (${name})`);
  return issues.length ? 1 : 0;
}

export function isMain(metaUrl) {
  return process.argv[1] && fileURLToPath(metaUrl) === process.argv[1];
}

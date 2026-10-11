// Import-direction guard (docs/ARCHITECTURE.md section 2): sim -> data only; ai -> sim, data;
// render, ui, audio -> sim (read only), data; net (lockstep core) -> sim, data; apps/game wires everything.
import { isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

const ALLOWED = {
  data: ["zod"],
  sim: ["data"],
  ai: ["sim", "data"],
  render: ["sim", "data", "three"],
  ui: ["sim", "data", "preact", "@preact/signals"],
  audio: ["sim", "data"],
  net: ["sim", "data"],
};

export function run() {
  const issues = [];
  let count = 0;
  for (const pkg of Object.keys(ALLOWED)) {
    for (const abs of walk([`packages/${pkg}/src`], [".ts", ".tsx"])) {
      count++;
      issues.push(...scan(pkg, rel(abs), read(abs)));
    }
  }
  return { name: "imports", issues, files: count };
}

/** Check one source file of package `pkg`; exported for the guard self-tests (BACKLOG 27). */
export function scan(pkg, file, src) {
  const issues = [];
  const allow = ALLOWED[pkg];
  for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (spec.startsWith(".")) {
      if (/\.\.\/\.\.\//.test(spec) && !spec.includes(`/${pkg}/`)) issues.push({ file, line: lineOf(src, m.index), msg: `relative import escapes package: ${spec}` });
      continue;
    }
    const hf = spec.match(/^@hearthfall\/([a-z]+)/);
    const ok = hf ? allow.includes(hf[1]) : allow.some((a) => spec === a || spec.startsWith(a + "/"));
    if (!ok) issues.push({ file, line: lineOf(src, m.index), msg: `${pkg} may not import "${spec}"` });
  }
  return issues;
}

if (isMain(import.meta.url)) process.exitCode = report(run());

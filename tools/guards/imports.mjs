// Import-direction guard (docs/ARCHITECTURE.md section 2): sim -> data only; ai -> sim, data;
// render, ui, audio -> sim (read only), data; apps/game wires everything.
import { isMain, lineOf, read, rel, report, walk } from "./lib.mjs";

const ALLOWED = {
  data: ["zod"],
  sim: ["data"],
  ai: ["sim", "data"],
  render: ["sim", "data", "three"],
  ui: ["sim", "data", "preact", "@preact/signals"],
  audio: ["sim", "data"],
};

export function run() {
  const issues = [];
  let count = 0;
  for (const [pkg, allow] of Object.entries(ALLOWED)) {
    for (const abs of walk([`packages/${pkg}/src`], [".ts", ".tsx"])) {
      count++;
      const file = rel(abs);
      const src = read(abs);
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
    }
  }
  return { name: "imports", issues, files: count };
}

if (isMain(import.meta.url)) process.exitCode = report(run());

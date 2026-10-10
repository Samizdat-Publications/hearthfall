// Reusable QA steps shared by the CLI and the qa drivers.
import { readFileSync } from "node:fs";
import { Out, ROOT, runNode, writeReport } from "./lib.mjs";

const TSC = ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--pretty", "false"];
const VITEST = "node_modules/vitest/vitest.mjs";

export function typecheck(out) {
  const r = runNode(TSC, { timeoutMs: 110000, log: "typecheck.log" });
  const errs = r.out.split(/\r?\n/).filter((l) => /error TS\d+/.test(l));
  for (const e of errs.slice(0, 8)) out.line(e.replace(/^(.+?)\((\d+),\d+\): error (TS\d+): /, "$1:$2  $3 "));
  if (r.timedOut) out.line("typecheck timed out");
  return { ok: r.code === 0, n: errs.length || (r.code === 0 ? 0 : 1), file: "typecheck.log" };
}

export async function guards(out) {
  const names = ["determinism", "imports", "data", "docs", "ip-names", "dashes", "strings"];
  const results = [];
  for (const n of names) {
    const mod = await import(`../guards/${n}.mjs`);
    const res = mod.run();
    // BACKLOG 27: a guard that scanned nothing (a moved folder, a bad glob) would pass silently
    if (!(res.files > 0)) res.issues.push({ file: `tools/guards/${n}.mjs`, line: 0, msg: `the ${n} guard scanned 0 files` });
    results.push({ name: n, issues: res.issues });
    for (const i of res.issues.slice(0, 4)) out.line(`[${n}] ${i.file}:${i.line}  ${i.msg}`);
  }
  writeReport("guards.json", results);
  const n = results.reduce((a, r) => a + r.issues.length, 0);
  return { ok: n === 0, n, file: "guards.json" };
}

export function unit(out, extra = []) {
  const r = runNode([VITEST, "run", "--reporter=json", "--outputFile=reports/latest/unit.json", ...extra], { timeoutMs: 170000, log: "unit.log" });
  let total = 0;
  let failed = 0;
  try {
    const j = JSON.parse(readFileSafe("reports/latest/unit.json"));
    total = j.numTotalTests;
    failed = j.numFailedTests + (j.numFailedTestSuites ?? 0);
    for (const f of j.testResults ?? []) {
      for (const a of f.assertionResults ?? []) if (a.status === "failed") out.line(`${relPath(f.name)}  ${a.fullName}: ${(a.failureMessages?.[0] ?? "").split("\n")[0].slice(0, 160)}`);
      if (f.status === "failed" && !(f.assertionResults ?? []).some((a) => a.status === "failed")) out.line(`${relPath(f.name)}  ${(f.message ?? "suite failed").split("\n")[0].slice(0, 160)}`);
    }
  } catch {
    out.line("vitest produced no JSON report (see reports/latest/unit.log)");
    failed = Math.max(1, failed);
  }
  out.line(`unit: ${total - failed}/${total} passed`);
  return { ok: r.code === 0 && failed === 0, n: failed || (r.code === 0 ? 0 : 1), file: "unit.log" };
}

function readFileSafe(p) {
  return readFileSync(ROOT + p, "utf8");
}
function relPath(p) {
  return p.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/"), "");
}

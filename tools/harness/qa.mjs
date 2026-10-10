// qa:fast (inner loop) and the resumable full qa driver (docs/TESTING.md section 1).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ROOT, gitSha, readJson, runNode } from "./lib.mjs";
import { guards, typecheck, unit } from "./steps.mjs";

/** Layers of the full qa run, in order. Each runs as its own child process with its own timeout. */
// shot and e2e layers get 7 min: on a loaded PC (100 percent CPU from other work) the smoke set took 4.5 min
const LAYERS = [
  { id: "check", cmd: ["check"], timeoutMs: 120000 },
  { id: "unit", cmd: ["unit"], timeoutMs: 180000 },
  { id: "scenarios", cmd: ["scenarios"], timeoutMs: 300000 },
  { id: "replays", cmd: ["replays"], timeoutMs: 180000 },
  { id: "bench", cmd: ["bench"], timeoutMs: 240000 },
  { id: "bench-render", cmd: ["bench-render"], timeoutMs: 240000 },
  { id: "shot", cmd: ["shot", "--set", "smoke"], timeoutMs: 420000 },
  { id: "shot-spells", cmd: ["shot", "--set", "spells"], timeoutMs: 420000 },
  { id: "shot-combat", cmd: ["shot", "--set", "combat"], timeoutMs: 420000 },
  { id: "shot-spells2", cmd: ["shot", "--set", "spells2"], timeoutMs: 420000 },
  { id: "shot-look", cmd: ["shot", "--set", "look"], timeoutMs: 420000 },
  { id: "shot-menus", cmd: ["shot", "--set", "menus"], timeoutMs: 300000 },
  { id: "e2e", cmd: ["e2e"], timeoutMs: 420000 },
  { id: "prod", cmd: ["prod"], timeoutMs: 240000 },
  { id: "replays-browser", cmd: ["replays", "--browser"], timeoutMs: 180000 },
  { id: "visionqa", cmd: ["visionqa", "--set", "smoke"], timeoutMs: 180000 },
];
const BUDGET_MS = 8.5 * 60 * 1000;

export async function qaFast(out) {
  const t0 = Date.now();
  const t = typecheck(out);
  const g = await guards(out);
  const u = unit(out);
  let s = { ok: true, n: 0, skipped: true };
  const sc = runNode(["tools/harness/cli.mjs", "scenarios", "--tag", "fast"], { timeoutMs: 110000, log: "qa-fast-scenarios.log" });
  const last = sc.out.trim().split(/\r?\n/).pop() ?? "";
  if (!last.startsWith("RESULT: SKIP")) {
    s = { ok: last.startsWith("RESULT: PASS"), n: last.startsWith("RESULT: PASS") ? 0 : 1 };
    if (!s.ok) out.line(`scenarios(fast): ${last}`);
  }
  const rp = runNode(["tools/harness/cli.mjs", "replays"], { timeoutMs: 110000, log: "qa-fast-replays.log" });
  const rl = rp.out.trim().split(String.fromCharCode(10)).pop()?.trim() ?? "";
  const r = { ok: !rl.startsWith("RESULT: FAIL") && !rp.timedOut };
  if (!r.ok) out.line(`replays: ${rl}`);
  const fails = [t, g, u, s, r].filter((x) => !x.ok).length;
  out.line(`typecheck ${t.ok ? "ok" : "FAIL"} | guards ${g.ok ? "ok" : g.n} | unit ${u.ok ? "ok" : "FAIL"} | scenarios ${s.skipped ? "skip" : s.ok ? "ok" : "FAIL"} | replays ${r.ok ? "ok" : "FAIL"} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out.finish(fails ? "FAIL" : "PASS", fails ? `${fails} (see reports/latest/)` : "");
}

/** Key the qa state by commit plus a digest of uncommitted changes, so edits invalidate passes. */
function stateKey() {
  const { sha, dirty } = gitSha();
  if (!dirty) return sha;
  const diff = spawnSync("git", ["diff", "HEAD"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true }).stdout ?? "";
  const untracked = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).stdout ?? "";
  return `${sha}-dirty-${createHash("sha1").update(diff + untracked).digest("hex").slice(0, 10)}`;
}

export async function qaFull(out, args) {
  const t0 = Date.now();
  const key = stateKey();
  const statePath = ROOT + "reports/qa-state.json";
  let state = readJson(statePath, {});
  if (state.key !== key || args.fresh) state = { key, layers: {} };
  const only = typeof args.layers === "string" ? args.layers.split(",") : null;
  let failed = 0;
  let remaining = 0;
  for (const layer of LAYERS) {
    if (only && !only.includes(layer.id)) continue;
    const prev = state.layers[layer.id];
    if (prev && (prev.status === "PASS" || prev.status === "SKIP")) {
      out.line(`${layer.id}: ${prev.status} (cached for ${key})`);
      continue;
    }
    if (Date.now() - t0 + layer.timeoutMs > BUDGET_MS) {
      remaining++;
      continue;
    }
    const r = runNode(["--env-file-if-exists=.env", "tools/harness/cli.mjs", ...layer.cmd], { timeoutMs: layer.timeoutMs, log: `qa-${layer.id}.log` });
    const last = r.out.trim().split(/\r?\n/).pop() ?? "";
    const status = r.timedOut ? "FAIL" : (last.match(/^RESULT: (PASS|SKIP|PARTIAL|FAIL)/)?.[1] ?? "FAIL");
    state.layers[layer.id] = { status, line: last, ms: Date.now() - t0 };
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    out.line(`${layer.id}: ${r.timedOut ? "TIMEOUT" : last.replace(/^RESULT: /, "")}`);
    if (status === "FAIL") failed++;
    if (status === "PARTIAL") remaining++;
  }
  // BACKLOG 96: one aggregate log per run, cached layers included, so a reader sees the whole state at once
  const verdict = failed ? "FAIL" : remaining ? "PARTIAL" : "PASS";
  const rows = LAYERS.filter((l) => !only || only.includes(l.id)).map((l) => `${l.id.padEnd(12)} ${state.layers[l.id] ? `${state.layers[l.id].status.padEnd(7)} ${state.layers[l.id].line}` : "not run (time budget)"}`);
  writeFileSync(ROOT + "reports/latest/qa-full.log", [`npm run qa ${new Date().toISOString()} state ${key}`, ...rows, `RESULT: ${verdict}`, ""].join(String.fromCharCode(10)));
  if (failed) return out.finish("FAIL", `${failed} (see reports/latest/qa-<layer>.log)`);
  if (remaining) return out.finish("PARTIAL", "rerun npm run qa");
  return out.finish("PASS");
}

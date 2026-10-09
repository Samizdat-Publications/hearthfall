// npm run soak -- --seeds 8 --minutes 10 --units 1000 --jobs auto [--map continents --size 128]
// Headless matches in worker_threads (jobs = cores minus 2). M3 mode: wandering units on a planet
// with invariants checked every tick; later milestones add bots vs AI (docs/TESTING.md section 5).
// Any violation fails the seed and writes a repro (seed + spec) to reports/latest/repro/.
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { LATEST, writeReport } from "./lib.mjs";

const WORKER = new URL("./soak-worker.mjs", import.meta.url);

function runSeed(spec) {
  return new Promise((resolve) => {
    const w = new Worker(WORKER, { workerData: spec });
    w.once("message", resolve);
    w.once("error", (e) => resolve({ seed: spec.seed, ok: false, violations: [`worker crashed: ${String(e.message).slice(0, 200)}`] }));
  });
}

/**
 * --mode triangle (M6 gate): the fixed counter triangle matchup (TESTING section 5) over N seeds per
 * pair, in process. Hard: every match produces a winner. Soft: the counter wins at least
 * gates.counterTriangleMinWinPct percent of its seeds.
 */
async function triangle(out, seeds) {
  const { loadBasePack } = await import("./datapack.mjs");
  const { runMatchup } = await import("../../packages/sim/src/matchup.ts");
  const p = loadBasePack().pack;
  const target = p.files.balance.gates.counterTriangleMinWinPct;
  const t0 = Date.now();
  const pairs = [];
  for (const [a, b] of [["warden", "firecaller"], ["firecaller", "chanter"], ["chanter", "warden"]]) {
    const rs = Array.from({ length: seeds }, (_, k) => runMatchup(p.files, p.hash, a, b, 1 + k));
    const wins = rs.filter((r) => r.winner === "a").length;
    const draws = rs.filter((r) => r.winner === "draw").length;
    pairs.push({ counter: a, victim: b, wins, draws, winPct: Math.round((wins * 100) / seeds), avgEndSec: +(rs.reduce((x, r) => x + r.endTick, 0) / seeds / p.files.balance.sim.tickHz).toFixed(1), results: rs });
  }
  const softMet = pairs.every((q) => q.winPct >= target);
  const draws = pairs.reduce((x, q) => x + q.draws, 0);
  const metrics = { mode: "triangle", seeds, wallSec: +((Date.now() - t0) / 1000).toFixed(1), softTargetPct: target, softMet, draws, pairs: pairs.map(({ results: _r, ...q }) => q) };
  writeReport("soak-triangle.json", { metrics, pairs });
  for (const q of pairs) out.line(`${q.counter} vs ${q.victim}: ${q.wins}/${seeds} (${q.winPct}%), draws ${q.draws}, avg ${q.avgEndSec}s`);
  out.line(`triangle soft target ${target}% ${softMet ? "met" : "missed"}`);
  return draws ? out.finish("FAIL", `${draws} matchups ended without a winner`) : out.finish("PASS", "");
}

export default async function soakCmd(out, _cmd, args) {
  if (args.mode === "triangle") return triangle(out, Number(args.seeds ?? 10));
  const seeds = Number(args.seeds ?? 8);
  const minutes = Number(args.minutes ?? 10);
  const jobs = args.jobs && args.jobs !== "auto" ? Number(args.jobs) : Math.max(1, availableParallelism() - 2);
  const base = { mode: typeof args.mode === "string" ? args.mode : "wander", minutes, units: Number(args.units ?? 1000), map: args.map ?? "continents", size: Number(args.size ?? 128), tribes: Number(args.tribes ?? 2), deadlineMs: 8 * 60 * 1000 - 20000 };
  const t0 = Date.now();
  const specs = Array.from({ length: seeds }, (_, k) => ({ ...base, seed: 1000 + k, startMs: t0 }));
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, seeds) }, async () => {
      while (next < specs.length) {
        const spec = specs[next++];
        results.push(await runSeed(spec));
      }
    }),
  );
  results.sort((a, b) => a.seed - b.seed);
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    mkdirSync(LATEST + "repro", { recursive: true });
    for (const r of bad) writeFileSync(LATEST + `repro/soak-seed-${r.seed}.json`, JSON.stringify({ spec: { ...base, seed: r.seed }, violations: r.violations?.slice(0, 20), tick: r.tick }, null, 2));
  }
  const sum = (k) => results.reduce((a, r) => a + (r.metrics?.[k] ?? 0), 0);
  const metrics = { seeds, minutes, units: base.units, wallSec: +((Date.now() - t0) / 1000).toFixed(1), drowned: sum("drowned"), orderFailed: sum("orderFailed"), orderGaveUp: sum("orderGaveUp"), moves: sum("moves"), maxStuckSec: Math.max(...results.map((r) => r.metrics?.maxStuckSec ?? 0)), avgTickMs: +(results.reduce((a, r) => a + (r.metrics?.avgTickMs ?? 0), 0) / results.length).toFixed(2) };
  writeReport("soak.json", { metrics, results });
  for (const r of bad) out.line(`seed ${r.seed}: ${(r.violations ?? []).slice(0, 2).join("; ")}`.slice(0, 200));
  out.line(`soak (${base.mode}): ${results.length - bad.length}/${results.length} seeds clean | ${base.mode === "economy" || base.mode === "war" ? base.mode + " bots" : metrics.units + " units"} x ${minutes} min | wall ${metrics.wallSec}s | avg tick ${metrics.avgTickMs} ms | max stuck ${metrics.maxStuckSec}s`);
  out.line(`orders ${metrics.moves}, failed ${metrics.orderFailed}, gave up ${metrics.orderGaveUp}, drowned ${metrics.drowned}`);
  if (base.mode === "war") {
    for (const k of ["trained", "killed", "converted", "fireballs", "eliminated"]) metrics[k] = sum(k);
    out.line(`war: trained ${metrics.trained}, killed ${metrics.killed}, converted ${metrics.converted}, fireballs ${metrics.fireballs}, tribes eliminated ${metrics.eliminated}`);
    writeReport("soak.json", { metrics, results });
  }
  if (base.mode === "economy") {
    const finals = results.flatMap((r) => (r.metrics?.popByMinute ?? []).map((h) => h[h.length - 1])).sort((a, b) => a - b);
    metrics.popAtEnd = finals;
    metrics.popMedian = finals[Math.floor(finals.length / 2)];
    const { loadBasePack } = await import("./datapack.mjs");
    const g = loadBasePack().pack.files.balance.gates.unharassedPopulationAtMinute10;
    metrics.softTarget = g;
    metrics.softMet = Math.abs(metrics.popMedian - g.target) <= (g.target * g.tolerancePct) / 100;
    out.line(`economy: population at minute ${minutes} median ${metrics.popMedian} (min ${finals[0]}, max ${finals[finals.length - 1]}), soft target ${g.target} +-${g.tolerancePct}% ${metrics.softMet ? "met" : "missed"}`);
    writeReport("soak.json", { metrics, results });
  }
  const partial = results.some((r) => r.partial);
  if (bad.length) return out.finish("FAIL", `${bad.length} (repros in reports/latest/repro/)`);
  return out.finish(partial ? "PARTIAL" : "PASS", partial ? "deadline hit before all ticks ran (reduce --minutes or --units)" : "");
}

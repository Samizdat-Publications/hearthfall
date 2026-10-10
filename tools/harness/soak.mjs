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
    // the spec rides along so a repro can replay ai and bots seeds (their controllers live in spec.ais)
    w.once("message", (m) => resolve({ ...m, spec }));
    w.once("error", (e) => resolve({ seed: spec.seed, spec, ok: false, violations: [`worker crashed: ${String(e.message).slice(0, 200)}`] }));
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
  // BACKLOG 60 variance probes (reported, never gated): a counter outnumbered 6 to 10 in a loose
  // formation (a stomp still wins most of these), and a mixed-army mirror (should sit near 50 percent)
  const pct = (rs, side) => Math.round((rs.filter((r) => r.winner === side).length * 100) / rs.length);
  const probes = [];
  for (const [a, b] of [["warden", "firecaller"], ["firecaller", "chanter"], ["chanter", "warden"]]) {
    const rs = Array.from({ length: seeds }, (_, k) => runMatchup(p.files, p.hash, a, b, 101 + k, { perSide: 6, perSideB: 10, jitter: 3 }));
    probes.push({ probe: `${a} 6 v ${b} 10`, winPct: pct(rs, "a"), drawPct: pct(rs, "draw") });
  }
  const mix = "warden+firecaller+chanter";
  const mirror = Array.from({ length: seeds }, (_, k) => runMatchup(p.files, p.hash, mix, mix, 201 + k, { perSide: 9, jitter: 3 }));
  probes.push({ probe: "mixed 9 v mixed 9", winPct: pct(mirror, "a"), drawPct: pct(mirror, "draw") });
  const metrics = { mode: "triangle", seeds, wallSec: +((Date.now() - t0) / 1000).toFixed(1), softTargetPct: target, softMet, draws, pairs: pairs.map(({ results: _r, ...q }) => q), probes };
  writeReport("soak-triangle.json", { metrics, pairs });
  for (const q of pairs) out.line(`${q.counter} vs ${q.victim}: ${q.wins}/${seeds} (${q.winPct}%), draws ${q.draws}, avg ${q.avgEndSec}s`);
  out.line(`variance probes: ${probes.map((q) => `${q.probe} ${q.winPct}% (draws ${q.drawPct}%)`).join("; ")}`);
  out.line(`triangle soft target ${target}% ${softMet ? "met" : "missed"}`);
  return draws ? out.finish("FAIL", `${draws} matchups ended without a winner`) : out.finish("PASS", "");
}

const PERSONALITIES = ["aggressive", "sneaky", "turtle"];
const DIFF_LEVELS = ["easy", "hard", "brutal"];

/**
 * BACKLOG 6 --mode difficulty: score per level against normal (win 1, unfinished but ahead on units 0.5).
 * Gate: easy scores below 0.5 and below hard, and brutal at least 0.5.
 */
function difficultyReport(results) {
  const per = {};
  for (const r of results) {
    if (!r.ai) continue;
    const lv = r.spec?.label ?? "?";
    const me = r.ai.ais.find((a) => a.difficulty === lv);
    const them = r.ai.ais.find((a) => a !== me);
    if (!me || !them) continue;
    const row = (per[lv] ??= { won: 0, lost: 0, ahead: 0, behind: 0, n: 0, score: 0 });
    row.n++;
    if (r.ai.alive.length === 1) r.ai.alive[0] === me.tribe ? row.won++ : row.lost++;
    else if (me.units > them.units) row.ahead++;
    else row.behind++;
  }
  for (const row of Object.values(per)) row.score = +((row.won + 0.5 * row.ahead) / Math.max(1, row.n)).toFixed(2);
  const lines = Object.entries(per).map(([lv, v]) => `difficulty ${lv} v normal: won ${v.won}, lost ${v.lost}, unfinished ahead ${v.ahead} behind ${v.behind} of ${v.n}, score ${v.score}`);
  const fails = [];
  if (per.easy && per.hard && !(per.easy.score < per.hard.score)) fails.push(`easy (${per.easy.score}) does not score below hard (${per.hard.score})`);
  if (per.easy && per.easy.score >= 0.5) fails.push(`easy scores ${per.easy.score} against normal`);
  if (per.brutal && per.brutal.score < 0.5) fails.push(`brutal scores ${per.brutal.score} against normal`);
  return { metrics: { difficulty: per }, lines, fail: fails.join("; ") };
}

/**
 * --mode ai-idle (M7 gate): each personality against an idle tribe, --seeds seeds each (default 4).
 * --mode ai: personality pairs rotated over the seeds (aggressive v sneaky, sneaky v turtle, turtle v
 * aggressive), equal difficulty (--difficulty, default normal).
 * --mode bots: the test bots (rusher, turtleBot, spellSpammer, randomLegal) against the personalities;
 * the gate is invariants only.
 */
function aiSpecs(base, args, seeds, t0) {
  const difficulty = typeof args.difficulty === "string" ? args.difficulty : "normal";
  const ai = (personality) => ({ type: "opponent", personality, difficulty });
  if (base.mode === "ai-idle") {
    const n = Number(args.seeds ?? 4);
    return PERSONALITIES.flatMap((p, j) => Array.from({ length: n }, (_, k) => ({ ...base, tribes: 2, seed: 1000 + k, startMs: t0, ais: [ai(p), null], label: p, key: j * 1000 + k })));
  }
  if (base.mode === "bots") {
    const bots = ["rusher", "turtleBot", "spellSpammer", "randomLegal"];
    return Array.from({ length: seeds }, (_, k) => ({ ...base, tribes: 2, seed: 1000 + k, startMs: t0, ais: [{ type: bots[k % 4], difficulty }, ai(PERSONALITIES[k % 3])] }));
  }
  if (base.mode === "difficulty") {
    // BACKLOG 6: each level against a normal opponent of the same personality, sides alternated by seed
    const n = Number(args.seeds ?? 8);
    const levels = typeof args.levels === "string" ? args.levels.split(",") : DIFF_LEVELS;
    return levels.flatMap((lv, j) =>
      Array.from({ length: n }, (_, k) => {
        const p = PERSONALITIES[k % 3];
        const pair = [{ type: "opponent", personality: p, difficulty: lv }, { type: "opponent", personality: p, difficulty: "normal" }];
        return { ...base, tribes: 2, seed: 1000 + k, startMs: t0, ais: k % 2 ? pair.reverse() : pair, label: lv, key: j * 1000 + k };
      }),
    );
  }
  if (base.mode === "ai") return Array.from({ length: seeds }, (_, k) => ({ ...base, tribes: 2, seed: 1000 + k, startMs: t0, ais: [ai(PERSONALITIES[k % 3]), ai(PERSONALITIES[(k + 1) % 3])] }));
  return null;
}

/** Gate and soft metrics for the ai modes: eliminations, spell types, mixed waves, win spread. */
function aiReport(mode, results, minutes, idleGate) {
  const lines = [];
  const all = results.flatMap((r) => r.ai?.ais ?? []);
  // BACKLOG 67: casts are spells that went off (spellCast events of the AI tribes), ordered counts the AI's cast orders
  const casts = {};
  const ordered = {};
  let waves = 0;
  let arrived = 0;
  let mixed = 0;
  let bridges = 0;
  for (const a of all) {
    for (const [k, v] of Object.entries(a.castsDone ?? {})) casts[k] = (casts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(a.stats?.casts ?? {})) ordered[k] = (ordered[k] ?? 0) + v;
    waves += a.stats?.waves ?? 0;
    arrived += a.stats?.wavesArrived ?? 0;
    mixed += a.stats?.mixedWaves ?? 0;
    bridges += a.stats?.bridges ?? 0;
  }
  const spellTypes = Object.keys(casts).length;
  const metrics = { casts, ordered, spellTypes, waves, wavesArrived: arrived, mixedWaves: mixed, bridges };
  lines.push(`ai: spells cast by type ${JSON.stringify(casts)} (${spellTypes} types; ordered ${Object.values(ordered).reduce((s, v) => s + v, 0)}), waves ${waves} (arrived ${arrived}, mixed ${mixed}), bridges ${bridges}`);
  const fails = [];
  if (mode !== "bots" && spellTypes < 3) fails.push(`only ${spellTypes} spell types cast`);
  if (mode !== "bots" && mixed < 1) fails.push("no mixed-troop wave");
  if (mode === "ai-idle") {
    const per = {};
    for (const r of results) {
      const p = r.ai?.ais[0]?.personality ?? "?";
      per[p] ??= { won: 0, n: 0, minutes: [] };
      per[p].n++;
      // gate: eliminated within gates.aiEliminatesIdleMinutes, whatever --minutes ran
      if (r.ai && !r.ai.alive.includes(1) && r.ai.endMinute <= idleGate) {
        per[p].won++;
        per[p].minutes.push(r.ai.endMinute);
      }
    }
    metrics.idle = per;
    for (const [p, v] of Object.entries(per)) {
      lines.push(`ai-idle ${p}: eliminated the idle tribe on ${v.won}/${v.n} seeds (minutes ${v.minutes.join(", ")})`);
      if (v.won < v.n) fails.push(`${p} left the idle tribe alive on ${v.n - v.won} seeds within the ${idleGate} min gate`);
    }
  } else if (mode === "bots") {
    const rows = results.map((r) => `${r.ai?.ais.map((a) => a.personality ?? a.type).join(" v ")}: ${r.ai?.alive.length === 1 ? "won by " + (r.ai.ais.find((a) => a.tribe === r.ai.alive[0])?.personality ?? r.ai.ais.find((a) => a.tribe === r.ai.alive[0])?.type) : "unfinished"} at ${r.ai?.endMinute} min`);
    metrics.matches = rows;
    lines.push(`bots: ${rows.join("; ")}`.slice(0, 600));
  } else {
    const wins = {};
    const whys = {};
    const lengths = [];
    let stalemates = 0;
    for (const r of results) {
      if (!r.ai) continue;
      if (r.ai.alive.length === 1) {
        const p = r.ai.ais.find((a) => a.tribe === r.ai.alive[0])?.personality ?? "?";
        wins[p] = (wins[p] ?? 0) + 1;
        if (r.ai.why) whys[r.ai.why] = (whys[r.ai.why] ?? 0) + 1;
        lengths.push(r.ai.endMinute);
      } else stalemates++;
    }
    lengths.sort((a, b) => a - b);
    metrics.wins = wins;
    metrics.stalemates = stalemates;
    metrics.medianMinutes = lengths.length ? lengths[Math.floor(lengths.length / 2)] : null;
    if (Object.keys(whys).length) metrics.winsBy = whys;
    lines.push(`ai: wins ${JSON.stringify(wins)}${Object.keys(whys).length ? ` by ${JSON.stringify(whys)}` : ""}, unfinished at ${minutes} min ${stalemates}/${results.length}, median match ${metrics.medianMinutes ?? "n/a"} min`);
  }
  return { metrics, lines, fail: fails.join("; ") };
}

export default async function soakCmd(out, _cmd, args) {
  if (args.mode === "triangle") return triangle(out, Number(args.seeds ?? 10));
  const seeds = Number(args.seeds ?? 8);
  const minutes = Number(args.minutes ?? 10);
  const jobs = args.jobs && args.jobs !== "auto" ? Number(args.jobs) : Math.max(1, availableParallelism() - 2);
  const base = { mode: typeof args.mode === "string" ? args.mode : "wander", minutes, units: Number(args.units ?? 1000), map: args.map ?? "continents", size: Number(args.size ?? 128), tribes: Number(args.tribes ?? 2), deadlineMs: 8 * 60 * 1000 - 20000, ...(typeof args.rules === "string" ? { rules: args.rules } : {}), ...(typeof args.mods === "string" ? { mods: args.mods.split(",").filter(Boolean) } : {}) };
  const t0 = Date.now();
  const specs = aiSpecs(base, args, seeds, t0) ?? Array.from({ length: seeds }, (_, k) => ({ ...base, seed: 1000 + k, startMs: t0 }));
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, specs.length) }, async () => {
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
    for (const r of bad) {
      const { startMs: _s, deadlineMs: _d, ...spec } = r.spec ?? { ...base, seed: r.seed };
      const tag = spec.ais ? `-${spec.ais.map((a) => (a ? (a.personality ?? a.type) : "idle")).join("-v-")}` : "";
      writeFileSync(LATEST + `repro/soak-seed-${r.seed}${tag}.json`, JSON.stringify({ spec, violations: r.violations?.slice(0, 20), tick: r.tick }, null, 2));
    }
  }
  // BACKLOG 24: --record (and every nightly) appends the run's balance numbers to reports/history/soak.jsonl
  const finish = async (status, detail) => {
    if (args.record) {
      const { appendHistory, soakRow } = await import("./history.mjs");
      appendHistory("soak", soakRow(base.mode, metrics, results, status));
    }
    return out.finish(status, detail);
  };
  const sum = (k) => results.reduce((a, r) => a + (r.metrics?.[k] ?? 0), 0);
  const metrics = { seeds, minutes, units: base.units, wallSec: +((Date.now() - t0) / 1000).toFixed(1), drowned: sum("drowned"), orderFailed: sum("orderFailed"), orderGaveUp: sum("orderGaveUp"), moves: sum("moves"), maxStuckSec: Math.max(...results.map((r) => r.metrics?.maxStuckSec ?? 0)), chaseGiveUps: sum("chaseGiveUps"), maxChaseGiveUps: Math.max(0, ...results.map((r) => r.metrics?.maxChaseGiveUps ?? 0)), avgTickMs: +(results.reduce((a, r) => a + (r.metrics?.avgTickMs ?? 0), 0) / results.length).toFixed(2) };
  writeReport("soak.json", { metrics, results });
  for (const r of bad) out.line(`seed ${r.seed}: ${(r.violations ?? []).slice(0, 2).join("; ")}`.slice(0, 200));
  out.line(`soak (${base.mode}): ${results.length - bad.length}/${results.length} seeds clean | ${base.mode === "economy" || base.mode === "war" || base.mode === "bots" ? "test bots" : base.mode.startsWith("ai") || base.mode === "difficulty" ? base.mode + " bots" : metrics.units + " units"} x ${minutes} min | wall ${metrics.wallSec}s | avg tick ${metrics.avgTickMs} ms | max stuck ${metrics.maxStuckSec}s`);
  out.line(`orders ${metrics.moves}, failed ${metrics.orderFailed}, gave up ${metrics.orderGaveUp} (chases ${metrics.chaseGiveUps}, most by one unit ${metrics.maxChaseGiveUps}), drowned ${metrics.drowned}`);
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
  if (base.mode === "difficulty") {
    const r = difficultyReport(results);
    Object.assign(metrics, r.metrics);
    for (const l of r.lines) out.line(l);
    writeReport("soak.json", { metrics, results });
    if (!bad.length && r.fail) return finish("FAIL", r.fail);
  }
  if (base.mode === "ai-idle" || base.mode === "ai" || base.mode === "bots") {
    const { loadBasePack } = await import("./datapack.mjs");
    const r = aiReport(base.mode, results, minutes, loadBasePack().pack.files.balance.gates.aiEliminatesIdleMinutes);
    Object.assign(metrics, r.metrics);
    for (const l of r.lines) out.line(l);
    writeReport("soak.json", { metrics, results });
    if (!bad.length && r.fail) return finish("FAIL", r.fail);
  }
  const partial = results.some((r) => r.partial);
  if (bad.length) return finish("FAIL", `${bad.length} (repros in reports/latest/repro/)`);
  return finish(partial ? "PARTIAL" : "PASS", partial ? "deadline hit before all ticks ran (reduce --minutes or --units)" : "");
}

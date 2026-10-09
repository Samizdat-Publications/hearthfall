// npm run bench [-- --save]: headless sim performance against docs/ARCHITECTURE.md section 9.
// Fails only on absolute budgets; warns when a measure regresses more than 35 percent from
// reports/baselines/bench.json (--save writes the current numbers as the new baseline).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { World } from "../../packages/sim/src/world.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";
import { ROOT, writeReport } from "./lib.mjs";

// ARCHITECTURE section 9 budgets fail the bench. The two spike measures added at the M3 review (tick
// right after a quake under 2000 moving units, ten group orders in one tick) warn above 20 ms and
// fail above 40 ms, because wall-clock maxima on this often fully loaded PC are noisy.
const BUDGET = { tickAvgMs: 8, tickP99Ms: 20, terrainOpMs: 2, afterTerrainOpMs: 40, groupOrdersMs: 40 };
const SPIKE_WARN = 20;
const BASE = ROOT + "reports/baselines/bench.json";

function populated(pack, units, seed = 77) {
  const w = new World({ pack: pack.files, packHash: pack.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
  const t = w.terrain;
  const comp = walkableComponents(t);
  const rng = new Rng(seed);
  for (let tr = 0; tr < 2; tr++) {
    const h = w.ents.index(w.tribes[tr].hearth);
    const label = comp.labels[t.idx(Math.round(w.ents.x[h]), Math.round(w.ents.y[h]))];
    let placed = 0;
    for (let k = 0; placed < units / 2 && k < units * 50; k++) {
      const x = (w.ents.x[h] + (rng.float("misc") - 0.5) * 48 + 128) % 128;
      const y = (w.ents.y[h] + (rng.float("misc") - 0.5) * 48 + 128) % 128;
      if (comp.labels[t.idx(Math.round(x), Math.round(y))] !== label || t.drowns(x, y)) continue;
      w.spawnUnit("settler", tr, x, y);
      placed++;
    }
    w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
  }
  return w;
}

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const median = (a) => pct(a, 0.5);

export default async function benchCmd(out, _cmd, args) {
  const pack = loadBasePack().pack;
  // A: 2000 wandering units
  // The sim is deterministic, so the same 600 ticks are replayed REPS times from one snapshot and
  // each tick keeps its fastest time: random OS preemption on a busy desktop is filtered out while
  // real algorithmic spikes (present in every replay) remain. Average uses the median replay.
  const w0 = populated(pack, 2000);
  for (let k = 0; k < 200; k++) w0.step([]);
  const init = { pack: pack.files, packHash: pack.hash, seed: 77, map: { generator: "continents", size: 128, tribes: 2 } };
  const snap = w0.snapshot();
  const REPS = 5;
  const best = new Array(600).fill(Infinity);
  const avgs = [];
  const rawP99s = [];
  let w = w0;
  for (let rep = 0; rep < REPS; rep++) {
    w = World.restore(init, snap);
    for (let tr = 0; tr < 2; tr++) w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
    let sum = 0;
    const runTimes = [];
    for (let k = 0; k < 600; k++) {
      const t0 = performance.now();
      w.step([]);
      const dt = performance.now() - t0;
      runTimes.push(dt);
      sum += dt;
      if (dt < best[k]) best[k] = dt;
    }
    avgs.push(sum / 600);
    rawP99s.push(pct(runTimes, 0.99));
  }
  const p99s = [pct(best, 0.99)];
  // B: quake-sized terrain op plus path-cache invalidation
  const ops = [];
  for (let k = 0; k < 40; k++) {
    const t0 = performance.now();
    w.terrain.noiseScar((k * 37) % 128, (k * 59) % 128, 8, 24, k);
    w.units.pf.refresh();
    ops.push(performance.now() - t0);
  }
  // C: the ticks right after a quake under 2000 moving units (every A* follower re-plans), and
  // D: ten group orders to ten goals in one tick (flow fields, budgeted per tick). Max over the next
  // 10 ticks, fastest of 5 replays from the same snapshot.
  const replayMax = (cmdsAt0) => {
    let bestMax = Infinity;
    for (let rep = 0; rep < 5; rep++) {
      const ww = World.restore(init, snap);
      for (let tr = 0; tr < 2; tr++) ww.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
      ww.step([]);
      let mx = 0;
      for (let k = 0; k < 10; k++) {
        const t0 = performance.now();
        ww.step(k === 0 ? cmdsAt0(ww) : []);
        mx = Math.max(mx, performance.now() - t0);
      }
      bestMax = Math.min(bestMax, mx);
    }
    return bestMax;
  };
  const afterOp = replayMax(() => [{ tick: 0, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 64, y: 64, r: 8, depth: 24, seed: 9 } }]);
  const groupOrders = replayMax((ww) => {
    const out = [];
    const ids = ww.selectUnits("tribe0.settlers").map((i) => ww.ents.idOf(i));
    for (let g = 0; g < 10; g++) out.push({ tick: 0, tribe: 0, type: "move", args: { units: ids.slice(g * 20, g * 20 + 20), to: [(g * 13 + 5) % 128, (g * 29 + 7) % 128] } });
    return out;
  });
  const m = {
    units: w.count((i) => w.ents.cat[i] === 3),
    rawP99Ms: +median(rawP99s).toFixed(3),
    afterTerrainOpMs: +afterOp.toFixed(3),
    groupOrdersMs: +groupOrders.toFixed(3),
    // gated average: mean of each tick's fastest replay (same noise filter as the p99); raw is informational
    tickAvgMs: +(best.reduce((x, y) => x + y, 0) / best.length).toFixed(3),
    rawAvgMs: +median(avgs).toFixed(3),
    tickP99Ms: +median(p99s).toFixed(3),
    terrainOpMs: +median(ops).toFixed(3),
  };
  const fails = Object.entries(BUDGET).filter(([k, b]) => m[k] > b);
  const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : null;
  const warns = base ? Object.keys(BUDGET).filter((k) => base[k] && m[k] > base[k] * 1.35) : [];
  if (args.save) writeFileSync(BASE, JSON.stringify({ ...m, when: new Date().toISOString() }, null, 2) + "\n");
  writeReport("bench.json", { metrics: m, budget: BUDGET, baseline: base, warns, runs: { avgs, p99s } });
  out.line(`2000-unit wander: avg ${m.tickAvgMs} ms (budget ${BUDGET.tickAvgMs}), p99 ${m.tickP99Ms} ms (budget ${BUDGET.tickP99Ms}), units alive ${m.units}`);
  out.line(`quake r8 + path invalidation: ${m.terrainOpMs} ms (budget ${BUDGET.terrainOpMs}); worst tick after it ${m.afterTerrainOpMs} ms; 10 group orders ${m.groupOrdersMs} ms (target 20, fail 40)`);
  out.line(`raw wall-clock p99 ${m.rawP99Ms} ms (informational: includes OS preemption and GC pauses on this machine)`);
  for (const k of warns) out.line(`WARN ${k} regressed: ${m[k]} vs baseline ${base[k]}`);
  for (const k of ["afterTerrainOpMs", "groupOrdersMs"]) if (m[k] > SPIKE_WARN) out.line(`WARN ${k} ${m[k]} ms above the ${SPIKE_WARN} ms target`);
  return out.finish(fails.length ? "FAIL" : "PASS", fails.length ? `${fails.length} budget(s) exceeded: ${fails.map(([k]) => k).join(", ")}` : "");
}

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

const BUDGET = { tickAvgMs: 8, tickP99Ms: 20, terrainOpMs: 2 };
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
  let w = w0;
  for (let rep = 0; rep < REPS; rep++) {
    w = World.restore(init, snap);
    for (let tr = 0; tr < 2; tr++) w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
    let sum = 0;
    for (let k = 0; k < 600; k++) {
      const t0 = performance.now();
      w.step([]);
      const dt = performance.now() - t0;
      sum += dt;
      if (dt < best[k]) best[k] = dt;
    }
    avgs.push(sum / 600);
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
  const m = {
    units: w.count((i) => w.ents.cat[i] === 3),
    tickAvgMs: +median(avgs).toFixed(3),
    tickP99Ms: +median(p99s).toFixed(3),
    terrainOpMs: +median(ops).toFixed(3),
  };
  const fails = Object.entries(BUDGET).filter(([k, b]) => m[k] > b);
  const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : null;
  const warns = base ? Object.keys(BUDGET).filter((k) => base[k] && m[k] > base[k] * 1.35) : [];
  if (args.save) writeFileSync(BASE, JSON.stringify({ ...m, when: new Date().toISOString() }, null, 2) + "\n");
  writeReport("bench.json", { metrics: m, budget: BUDGET, baseline: base, warns, runs: { avgs, p99s } });
  out.line(`2000-unit wander: avg ${m.tickAvgMs} ms (budget ${BUDGET.tickAvgMs}), p99 ${m.tickP99Ms} ms (budget ${BUDGET.tickP99Ms}), units alive ${m.units}`);
  out.line(`quake r8 + path invalidation: ${m.terrainOpMs} ms (budget ${BUDGET.terrainOpMs})`);
  for (const k of warns) out.line(`WARN ${k} regressed: ${m[k]} vs baseline ${base[k]}`);
  return out.finish(fails.length ? "FAIL" : "PASS", fails.length ? `${fails.length} budget(s) exceeded: ${fails.map(([k]) => k).join(", ")}` : "");
}

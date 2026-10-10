// npm run bench [-- --save]: headless sim performance against docs/ARCHITECTURE.md section 9.
// Fails only on absolute budgets; warns when a measure regresses more than 35 percent from
// reports/baselines/bench.json (--save writes the current numbers as the new baseline).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { World } from "../../packages/sim/src/world.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { applyEffects } from "../../packages/sim/src/effects.ts";
import { loadBasePack } from "./datapack.mjs";
import { ROOT, writeReport } from "./lib.mjs";

// ARCHITECTURE section 9 budgets fail the bench. The two spike measures added at the M3 review (tick
// right after a quake under 2000 moving units, ten group orders in one tick) warn above 20 ms and
// fail above 40 ms, because wall-clock maxima on this often fully loaded PC are noisy.
const BUDGET = { tickAvgMs: 8, tickP99Ms: 20, terrainOpMs: 2, afterTerrainOpMs: 40, groupOrdersMs: 40, spellStormMs: 40, battleAvgMs: 8, battleP99Ms: 20, economyAvgMs: 8, economyP99Ms: 20 };
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

/**
 * F (M6): 2000 units mid-battle, the ARCHITECTURE section 9 row. Flat 128 map, 1000 troops per tribe
 * (half Wardens, a quarter each Firecallers and Chanters) in 32 x 32 blocks 20 cells apart,
 * attack-moving through each other; Hearths and Shapers sit far away so nobody is eliminated.
 */
function battle(pack) {
  const init = { pack: pack.files, packHash: pack.hash, seed: 91, map: { generator: "flat", size: 128, tribes: 2 } };
  const w = new World(init);
  const cmds = [];
  for (let tr = 0; tr < 2; tr++) {
    w.spawnBuilding("hearth", tr, 10 + tr * 64, 10);
    w.spawnUnit("shaper", tr, 14 + tr * 64, 14);
    const x0 = tr === 0 ? 20 : 72;
    const ids = [];
    for (let k = 0; k < 1000; k++) {
      const kind = k % 4 === 1 ? "firecaller" : k % 4 === 3 ? "chanter" : "warden";
      ids.push(w.spawnUnit(kind, tr, x0 + (k % 32) + 0.5, 48 + Math.floor(k / 32) + 0.5));
    }
    cmds.push({ tick: 0, tribe: tr, type: "move", args: { units: ids, to: [tr === 0 ? 100 : 24, 64], attack: true } });
  }
  w.step(cmds);
  for (let k = 0; k < 120; k++) w.step([]);
  return { init, snap: w.snapshot() };
}

/**
 * G (BACKLOG 51): a bot-driven economy. Four tribes of economy bots on a continents 192 map grow for
 * ECO_WARM_MIN game minutes (dwellings, plans, tree search with walkable components, breeding), then
 * the snapshot is replayed: each tick keeps its fastest of 3 runs, and the economy system's own share
 * (Economy.update, where nearestTree runs) is timed beside the whole tick.
 */
const ECO_WARM_MIN = 6;
function economyWorld(pack) {
  const init = { pack: pack.files, packHash: pack.hash, seed: 41, map: { generator: "continents", size: 192, tribes: 4 } };
  const w = new World(init);
  for (const t of w.tribes) w.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
  for (let k = 0; k < ECO_WARM_MIN * 60 * w.cfg.tickHz; k++) w.step([]);
  return { init, snap: w.snapshot(), units: w.count((i) => w.ents.cat[i] === 3), trees: w.count((i) => w.ents.cat[i] === 1) };
}

function economyBench(pack, ticks = 400, reps = 3) {
  const eco = economyWorld(pack);
  const best = new Array(ticks).fill(Infinity);
  const ecoBest = new Array(ticks).fill(Infinity);
  for (let rep = 0; rep < reps; rep++) {
    const ww = World.restore(eco.init, eco.snap);
    for (const t of ww.tribes) ww.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
    const update = ww.economy.update.bind(ww.economy);
    let ecoMs = 0;
    ww.economy.update = () => {
      const t0 = performance.now();
      update();
      ecoMs = performance.now() - t0;
    };
    for (let k = 0; k < ticks; k++) {
      const t0 = performance.now();
      ww.step([]);
      const dt = performance.now() - t0;
      if (dt < best[k]) best[k] = dt;
      if (ecoMs < ecoBest[k]) ecoBest[k] = ecoMs;
    }
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { avg: avg(best), p99: pct(best, 0.99), ecoAvg: avg(ecoBest), ecoP99: pct(ecoBest, 0.99), units: eco.units, trees: eco.trees };
}

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const median = (a) => pct(a, 0.5);

/** Machine noise probe: a fixed 1 ms workload 60 times; p90 / median far above 1 means a busy PC. */
function noiseRatio() {
  const ts = [];
  let x = 0;
  for (let k = 0; k < 60; k++) {
    const t0 = performance.now();
    for (let i = 0; i < 150000; i++) x += Math.sqrt(i);
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return x > 0 ? ts[Math.floor(ts.length * 0.9)] / ts[Math.floor(ts.length / 2)] : 1;
}

export default async function benchCmd(out, _cmd, args) {
  const noise = noiseRatio();
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
  // same op repeated from the same heights 3 times, fastest kept (OS noise filter, like the tick p99)
  for (let k = 0; k < 40; k++) {
    const saved = w.terrain.heights.slice();
    let best = Infinity;
    for (let rep = 0; rep < 3; rep++) {
      w.terrain.heights.set(saved);
      const t0 = performance.now();
      w.terrain.noiseScar((k * 37) % 128, (k * 59) % 128, 8, 24, k);
      w.units.pf.refresh();
      best = Math.min(best, performance.now() - t0);
    }
    ops.push(best);
  }
  // C: the ticks right after a quake under 2000 moving units (every A* follower re-plans), and
  // D: ten group orders to ten goals in one tick (flow fields, budgeted per tick). Max over the next
  // 10 ticks, fastest of 5 replays from the same snapshot.
  const replayMax = (cmdsAt0) => {
    let bestMax = Infinity;
    for (let rep = 0; rep < 7; rep++) {
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
  // E: spell storm (BACKLOG 54): every v1 spell's effects applied by both tribes at once, spread over
  // the map, then the worst of the next 100 ticks while swarms, pools and burning run (fastest of 3).
  const v1 = pack.files.spells.spells.filter((s) => s.v1);
  let spellStorm = Infinity;
  for (let rep = 0; rep < 3; rep++) {
    const ww = World.restore(init, snap);
    ww.step([]);
    v1.forEach((s, k) => {
      for (let tr = 0; tr < 2; tr++) {
        const x = (k * 16 + tr * 64 + 8) % 128;
        const y = (k * 23 + tr * 40 + 8) % 128;
        applyEffects({ w: ww, tribe: tr, spell: s.id, x, y, casterX: (x + 4) % 128, casterY: y }, s.effects);
      }
    });
    let mx = 0;
    for (let k = 0; k < 100; k++) {
      const t0 = performance.now();
      ww.step([]);
      mx = Math.max(mx, performance.now() - t0);
    }
    spellStorm = Math.min(spellStorm, mx);
  }
  // F: 2000 units mid-battle, 400 ticks, each tick's fastest of 5 replays from one snapshot
  const bt = battle(pack);
  const bBest = new Array(400).fill(Infinity);
  let battleUnits = 0;
  let battleKills = 0;
  for (let rep = 0; rep < 5; rep++) {
    const ww = World.restore(bt.init, bt.snap);
    for (let k = 0; k < 400; k++) {
      const t0 = performance.now();
      ww.step([]);
      const dt = performance.now() - t0;
      if (dt < bBest[k]) bBest[k] = dt;
    }
    battleUnits = ww.count((i) => ww.ents.cat[i] === 3);
    battleKills = ww.eventCounts.get("killed") ?? 0;
  }
  // G: economy (BACKLOG 51)
  const eb = economyBench(pack);
  const m = {
    economyAvgMs: +eb.avg.toFixed(3),
    economyP99Ms: +eb.p99.toFixed(3),
    economyUpdateAvgMs: +eb.ecoAvg.toFixed(3),
    economyUpdateP99Ms: +eb.ecoP99.toFixed(3),
    economyUnits: eb.units,
    economyTrees: eb.trees,
    units: w.count((i) => w.ents.cat[i] === 3),
    battleAvgMs: +(bBest.reduce((x, y) => x + y, 0) / bBest.length).toFixed(3),
    battleP99Ms: +pct(bBest, 0.99).toFixed(3),
    battleUnitsLeft: battleUnits,
    battleKills,
    rawP99Ms: +median(rawP99s).toFixed(3),
    afterTerrainOpMs: +afterOp.toFixed(3),
    groupOrdersMs: +groupOrders.toFixed(3),
    spellStormMs: +spellStorm.toFixed(3),
    // gated average: mean of each tick's fastest replay (same noise filter as the p99); raw is informational
    tickAvgMs: +(best.reduce((x, y) => x + y, 0) / best.length).toFixed(3),
    rawAvgMs: +median(avgs).toFixed(3),
    tickP99Ms: +median(p99s).toFixed(3),
    terrainOpMs: +median(ops).toFixed(3),
  };
  m.noiseRatio = +noise.toFixed(2);
  // on a visibly busy machine the two spike measures (not ARCHITECTURE budgets) only warn
  const noisy = noise > 2;
  const fails = Object.entries(BUDGET).filter(([k, b]) => m[k] > b && !(noisy && (k === "afterTerrainOpMs" || k === "groupOrdersMs" || k === "spellStormMs")));
  if (noisy) out.line(`NOTE machine noise ratio ${m.noiseRatio} (other processes busy): spike measures reported as warnings only`);
  const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, "utf8")) : null;
  const warns = base ? Object.keys(BUDGET).filter((k) => base[k] && m[k] > base[k] * 1.35) : [];
  if (args.save) writeFileSync(BASE, JSON.stringify({ ...m, when: new Date().toISOString() }, null, 2) + "\n");
  writeReport("bench.json", { metrics: m, budget: BUDGET, baseline: base, warns, runs: { avgs, p99s } });
  // BACKLOG 25: every bench run is a point on the perf trend (npm run trends)
  if (!args["no-record"]) {
    const { appendHistory } = await import("./history.mjs");
    const pick = ["tickAvgMs", "tickP99Ms", "battleAvgMs", "battleP99Ms", "economyAvgMs", "economyP99Ms", "economyUpdateAvgMs", "terrainOpMs", "afterTerrainOpMs", "groupOrdersMs", "spellStormMs", "noiseRatio"];
    appendHistory("bench", { ...Object.fromEntries(pick.map((k) => [k, m[k]])), result: fails.length ? "FAIL" : "PASS" });
  }
  out.line(`2000-unit wander: avg ${m.tickAvgMs} ms (budget ${BUDGET.tickAvgMs}), p99 ${m.tickP99Ms} ms (budget ${BUDGET.tickP99Ms}), units alive ${m.units}`);
  out.line(`quake r8 + path invalidation: ${m.terrainOpMs} ms (budget ${BUDGET.terrainOpMs}); worst tick after it ${m.afterTerrainOpMs} ms; 10 group orders ${m.groupOrdersMs} ms (target 20, fail 40)`);
  out.line(`2000-unit battle: avg ${m.battleAvgMs} ms (budget ${BUDGET.battleAvgMs}), p99 ${m.battleP99Ms} ms (budget ${BUDGET.battleP99Ms}), ${m.battleKills} killed, ${m.battleUnitsLeft} units left`);
  out.line(`economy (4 tribes of economy bots, continents 192, after ${ECO_WARM_MIN} min: ${m.economyUnits} units, ${m.economyTrees} trees): avg ${m.economyAvgMs} ms, p99 ${m.economyP99Ms} ms (budget ${BUDGET.economyAvgMs} and ${BUDGET.economyP99Ms}); Economy.update avg ${m.economyUpdateAvgMs} ms, p99 ${m.economyUpdateP99Ms} ms`);
  out.line(`spell storm (${v1.length} v1 spells x 2 tribes at once): worst tick ${m.spellStormMs} ms (target 20, fail 40)`);
  out.line(`raw wall-clock p99 ${m.rawP99Ms} ms (informational: includes OS preemption and GC pauses on this machine)`);
  for (const k of warns) out.line(`WARN ${k} regressed: ${m[k]} vs baseline ${base[k]}`);
  for (const k of ["afterTerrainOpMs", "groupOrdersMs", "spellStormMs"]) if (m[k] > SPIKE_WARN) out.line(`WARN ${k} ${m[k]} ms above the ${SPIKE_WARN} ms target`);
  return out.finish(fails.length ? "FAIL" : "PASS", fails.length ? `${fails.length} budget(s) exceeded: ${fails.map(([k]) => k).join(", ")}` : "");
}

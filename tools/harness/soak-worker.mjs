// One soak seed in a worker thread. Spawns `units` settlers on the walkable landmass around each
// Hearth, attaches a WanderBot per tribe, runs minutes of game time and checks invariants each tick.
import { parentPort, workerData } from "node:worker_threads";
import { World } from "../../packages/sim/src/world.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";

const spec = workerData;
const res = loadBasePack();
const pack = res.pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: spec.seed, map: { generator: spec.map, size: spec.size, tribes: spec.tribes } });
const t = w.terrain;
const n = t.size;
const comp = walkableComponents(t);
const economyMode = spec.mode === "economy";
// war (M6 gate): every tribe runs a WarBot (economy, lodges, training, attack waves)
const warMode = spec.mode === "war";
const place = new Rng(spec.seed ^ 0x51ed);
const perTribe = economyMode || warMode ? 0 : Math.floor(spec.units / spec.tribes);
for (let tr = 0; tr < spec.tribes; tr++) {
  if (warMode) {
    w.controllers.push(makeBot({ type: "war", tribe: tr, offset: tr }));
    continue;
  }
  if (economyMode) {
    w.controllers.push(makeBot({ type: "economy", tribe: tr, offset: tr }));
    continue;
  }
  const h = w.ents.index(w.tribes[tr].hearth);
  const label = comp.labels[t.idx(Math.round(w.ents.x[h]), Math.round(w.ents.y[h]))];
  let placed = 0;
  for (let tries = 0; placed < perTribe && tries < perTribe * 50; tries++) {
    const x = (w.ents.x[h] + (place.float("misc") - 0.5) * 40 + n) % n;
    const y = (w.ents.y[h] + (place.float("misc") - 0.5) * 40 + n) % n;
    if (comp.labels[t.idx(Math.round(x), Math.round(y))] !== label || t.drowns(x, y)) continue;
    w.spawnUnit("settler", tr, x, y);
    placed++;
  }
  w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
}
const ticks = Math.round(spec.minutes * 60 * w.cfg.tickHz);
const minuteTicks = 60 * w.cfg.tickHz;
const popByMinute = w.tribes.map((tr) => [w.economy.followers(tr.index)]);
const violations = [];
let maxStuck = 0;
let partial = false;
const t0 = performance.now();
for (let k = 0; k < ticks; k++) {
  w.step([]);
  if (k % 50 === 0 && performance.now() - t0 + (Date.now() - spec.startMs - (performance.now() - t0)) > spec.deadlineMs) {
    partial = true;
    break;
  }
  const v = w.invariants();
  for (const e of w.events) if (e.type === "orderGaveUp" && e.reachable === 1 && !e.chase) v.push(`unit ${e.id & 0xffff} gave up ${e.dist} cells from a reachable goal`);
  if (v.length) {
    violations.push(...v.slice(0, 5).map((s) => `tick ${w.tick}: ${s}`));
    break;
  }
  if (w.tick % minuteTicks === 0) {
    for (const tr of w.tribes) {
      const pop = w.economy.followers(tr.index);
      const hist = popByMinute[tr.index];
      if (economyMode && pop <= hist[hist.length - 1]) violations.push(`tick ${w.tick}: tribe ${tr.index} did not grow in minute ${hist.length} (${hist[hist.length - 1]} -> ${pop})`);
      hist.push(pop);
    }
    if (violations.length) break;
  }
  if (k % 20 === 0) for (let i = 0; i < w.ents.hi; i++) if (w.ents.alive[i] && w.ents.stuck[i] > maxStuck) maxStuck = w.ents.stuck[i];
}
const ms = performance.now() - t0;
const ec = (k) => w.eventCounts.get(k) ?? 0;
parentPort.postMessage({
  seed: spec.seed,
  ok: violations.length === 0,
  partial,
  tick: w.tick,
  violations,
  metrics: { ticks: w.tick, avgTickMs: +(ms / Math.max(1, w.tick)).toFixed(3), drowned: ec("drowned"), orderFailed: ec("orderFailed"), orderGaveUp: ec("orderGaveUp"), moves: w.units.ordersIssued, maxStuckSec: +(maxStuck / w.cfg.tickHz).toFixed(1), units: w.count((i) => w.ents.cat[i] === 3), popByMinute, born: ec("born"), buildings: ec("buildingDone"), trained: ec("trained"), killed: ec("killed"), converted: ec("converted"), fireballs: ec("fireball"), eliminated: ec("tribeEliminated"), alive: w.tribes.filter((t) => t.alive).length },
});

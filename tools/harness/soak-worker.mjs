// One soak seed in a worker thread. Spawns `units` settlers on the walkable landmass around each
// Hearth, attaches a WanderBot per tribe, runs minutes of game time and checks invariants each tick.
import { parentPort, workerData } from "node:worker_threads";
import { World } from "../../packages/sim/src/world.ts";
import { CAT } from "../../packages/sim/src/entities.ts";
import { BSTATE } from "../../packages/sim/src/economy.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";

const spec = workerData;
const res = loadBasePack(spec.mods ?? []);
const pack = res.pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: spec.seed, map: { generator: spec.map, size: spec.size, tribes: spec.tribes }, ...(spec.rules ? { rules: spec.rules } : {}) });
const t = w.terrain;
const n = t.size;
const comp = walkableComponents(t);
const economyMode = spec.mode === "economy";
// war (M6 gate): every tribe runs a WarBot (economy, lodges, training, attack waves)
const warMode = spec.mode === "war";
const place = new Rng(spec.seed ^ 0x51ed);
// ai (M7 gate): spec.ais[tr] is a makeBot spec (opponent personality or test bot) or null for an
// idle tribe that only has its starting units; the match ends early when one tribe is left
const aiMode = Array.isArray(spec.ais);
const perTribe = economyMode || warMode || aiMode ? 0 : Math.floor(spec.units / spec.tribes);
const ais = [];
for (let tr = 0; tr < spec.tribes; tr++) {
  if (aiMode) {
    const a = spec.ais[tr];
    if (a) {
      const bot = makeBot({ ...a, tribe: tr, offset: tr });
      w.controllers.push(bot);
      ais.push({ tribe: tr, spec: a, bot });
    }
    continue;
  }
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
// BACKLOG 48: a tribe that did not grow in a minute is excused only at a real limit: minute 1 (the first
// dwelling may need its pad flattened), the population cap, or land full (every dwelling at its top level
// and full, and the economy bot finds no spot for another one)
const excused = (tribe, minute, pop) => {
  if (minute === 1 || pop >= w.cfg.pack.units.rules.populationCap) return true;
  if (pop < w.economy.popCap(tribe)) return false;
  const E = w.ents;
  const levels = w.cfg.pack.buildings.buildings[w.cfg.buildingIndex.get("dwelling")].levels;
  for (let d = 0; d < E.hi; d++) {
    if (!E.alive[d] || E.tribe[d] !== tribe || E.cat[d] !== CAT.building) continue;
    if (E.state[d] !== BSTATE.done) return false;
    if (E.type[d] === w.cfg.buildingIndex.get("dwelling") && E.level[d] < levels.length) return false;
  }
  const h = E.index(w.tribes[tribe].hearth);
  const bot = w.controllers.find((c) => c.tribe === tribe && c.findSpot);
  return h >= 0 && !!bot && bot.findSpot(w, "dwelling", E.x[h], E.y[h]) === null;
};
const minuteTicks = 60 * w.cfg.tickHz;
const popByMinute = w.tribes.map((tr) => [w.economy.followers(tr.index)]);
const violations = [];
const castsDone = [];
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
  for (const e of w.events) {
    if (e.type === "orderGaveUp" && e.reachable === 1 && !e.chase) v.push(`unit ${e.id & 0xffff} gave up ${e.dist} cells from a reachable goal`);
    // BACKLOG 67: spells that actually went off, per tribe (the AI stats count casts it ordered)
    else if (e.type === "spellCast" && e.by !== "site") {
      const m = (castsDone[e.tribe] ??= {});
      m[e.spell] = (m[e.spell] ?? 0) + 1;
    }
  }
  if (v.length) {
    violations.push(...v.slice(0, 5).map((s) => `tick ${w.tick}: ${s}`));
    break;
  }
  if (w.tick % minuteTicks === 0) {
    for (const tr of w.tribes) {
      const pop = w.economy.followers(tr.index);
      const hist = popByMinute[tr.index];
      if (economyMode && pop <= hist[hist.length - 1] && !excused(tr.index, hist.length, pop)) violations.push(`tick ${w.tick}: tribe ${tr.index} did not grow in minute ${hist.length} (${hist[hist.length - 1]} -> ${pop})`);
      hist.push(pop);
    }
    if (violations.length) break;
  }
  if (aiMode && (w.tribes.filter((t) => t.alive).length <= 1 || (w.rules && w.rules.winner >= 0))) break;
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
  ai: aiMode ? { ais: ais.map((a) => ({ tribe: a.tribe, type: a.spec.type, personality: a.spec.personality ?? null, difficulty: a.spec.difficulty ?? null, units: w.count((i) => w.ents.cat[i] === 3 && w.ents.tribe[i] === a.tribe), alive: w.tribes[a.tribe].alive, stats: a.bot.stats ?? null, castsDone: castsDone[a.tribe] ?? {} })), alive: w.rules && w.rules.winner >= 0 ? [w.rules.winner] : w.tribes.filter((t) => t.alive).map((t) => t.index), why: w.rules?.why || null, endMinute: +(w.tick / minuteTicks).toFixed(2), spellCast: ec("spellCast") } : null,
});

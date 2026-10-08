// Dev scratch: find tick-time spikes in the 2000-unit wander bench and attribute them.
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "../harness/datapack.mjs";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: 77, map: { generator: "continents", size: 128, tribes: 2 } });
const t = w.terrain, comp = walkableComponents(t), rng = new Rng(77);
for (let tr = 0; tr < 2; tr++) {
  const h = w.ents.index(w.tribes[tr].hearth);
  const label = comp.labels[t.idx(Math.round(w.ents.x[h]), Math.round(w.ents.y[h]))];
  let placed = 0;
  for (let k = 0; placed < 1000 && k < 100000; k++) {
    const x = (w.ents.x[h] + (rng.float("misc") - 0.5) * 48 + 128) % 128, y = (w.ents.y[h] + (rng.float("misc") - 0.5) * 48 + 128) % 128;
    if (comp.labels[t.idx(Math.round(x), Math.round(y))] !== label || t.drowns(x, y)) continue;
    w.spawnUnit("settler", tr, x, y); placed++;
  }
  w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
}
const ctl = w.controllers.map((c) => c.decide.bind(c));
let ctlMs = 0;
w.controllers.forEach((c, k) => (c.decide = (ww) => { const a = performance.now(); const r = ctl[k](ww); ctlMs += performance.now() - a; return r; }));
const upd = w.units.update.bind(w.units);
let updMs = 0;
w.units.update = () => { const a = performance.now(); upd(); updMs += performance.now() - a; };
const acc = {};
for (const name of ['astar', 'nearestWalkable', 'lineWalkable', 'refresh', 'flowField']) {
  const f = w.units.pf[name].bind(w.units.pf);
  w.units.pf[name] = (...a) => { const t0 = performance.now(); const r = f(...a); acc[name] = (acc[name] ?? 0) + performance.now() - t0; return r; };
}
const rows = [];
for (let k = 0; k < 1500; k++) {
  ctlMs = 0; updMs = 0; for (const k in acc) acc[k] = 0;
  const q0 = w.units.queue.length;
  const a = performance.now();
  w.step([]);
  const ms = performance.now() - a;
  rows.push({ tick: w.tick, ms, ctlMs, updMs, exp: w.units.expandedLastTick, q0, ...acc });
}
rows.sort((a, b) => b.ms - a.ms);
const late = rows.filter((r) => r.tick > 200);
const sorted = late.map((r) => r.ms).sort((a, b) => a - b);
console.log("after warmup: p99", sorted[Math.floor(sorted.length * 0.99)].toFixed(2), "max", sorted.at(-1).toFixed(2));
for (const r of rows.slice(0, 8)) console.log(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +(+v).toFixed(2)]))));

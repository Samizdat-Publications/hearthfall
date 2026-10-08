// Dev scratch: per-phase timing of the ticks after a terrain op with 2000 wandering settlers.
import { World } from "../../packages/sim/src/world.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "../harness/datapack.mjs";
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
for (let k = 0; k < 200; k++) w.step([]);
const acc = {};
const wrap = (obj, name, label) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const r = f(...a); acc[label] = (acc[label] ?? 0) + performance.now() - t0; return r; }; };
wrap(w.units, "update", "units");
wrap(w.units.pf, "refresh", "refresh");
wrap(w.units.pf, "astar", "astar");
wrap(w.units.pf, "flowField", "flow");
wrap(w.economy, "updateTasks", "tasks");
wrap(w.economy, "update", "econ");
for (const c of w.controllers) wrap(c, "decide", "bots");
const mode = process.argv[2] ?? "op";
for (let k = 0; k < 12; k++) {
  for (const key in acc) acc[key] = 0;
  let cmds = [];
  if (k === 1 && mode === "op") cmds = [{ tick: w.tick, tribe: -1, type: "terrainOp", args: { op: "noiseScar", x: 64, y: 64, r: 8, depth: 24, seed: 9 } }];
  if (k === 1 && mode === "group") { const ids = w.selectUnits("tribe0.settlers").map((i) => w.ents.idOf(i)); for (let g = 0; g < 10; g++) cmds.push({ tick: w.tick, tribe: 0, type: "move", args: { units: ids.slice(g * 20, g * 20 + 20), to: [(g * 13 + 5) % 128, (g * 29 + 7) % 128] } }); }
  const t0 = performance.now();
  w.step(cmds);
  const ms = performance.now() - t0;
  console.log(k, ms.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(acc).map(([a, b]) => [a, +b.toFixed(1)]))), "queue", w.units.queue.length, "exp", w.units.expandedLastTick);
}

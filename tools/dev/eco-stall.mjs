// Dev scratch: why does a tribe stall? Reachable trees, site states, settler tasks over time.
import { basePack } from "../../packages/sim/test/helpers.ts";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
const p = basePack();
const [seed, tribe] = [Number(process.argv[2] ?? 3), Number(process.argv[3] ?? 1)];
const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
for (const t of w.tribes) w.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
const E = w.ents;
const pf = w.units.pf;
for (let k = 0; k < 20 * 180; k++) {
  w.step([]);
  for (const e of w.events) if (e.tribe === tribe || e.type === "orderFailed" || e.type === "orderGaveUp") if (!["woodDelivered", "charged"].includes(e.type)) console.log("  ev", w.tick, JSON.stringify(e));
}
pf.refresh();
const h = E.index(w.tribes[tribe].hearth);
const comp = (i) => pf.comp[pf.nearestWalkable(Math.round(E.x[i]) % 128 + (Math.round(E.y[i]) % 128) * 128, 2)];
let trees = 0, reach = 0, stumps = 0;
for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 1) { trees++; if (comp(i) === comp(h)) { reach++; if (E.wood[i] === 0) stumps++; } }
console.log("trees", trees, "reachable", reach, "stumps among reachable", stumps, "hearth comp", comp(h));
for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 3 && E.tribe[i] === tribe) console.log(" unit", i, "type", E.type[i], "task", E.task[i], "order", E.order[i], "pos", E.x[i].toFixed(1), E.y[i].toFixed(1), "comp", comp(i));

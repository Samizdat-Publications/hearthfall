// Dev scratch: unharassed growth with the economy bot on a planet; population per minute.
import { basePack } from "../../packages/sim/test/helpers.ts";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
const p = basePack();
const seed = Number(process.argv[2] ?? 1);
const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
for (const t of w.tribes) w.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
const rows = [];
const t0 = performance.now();
for (let m = 1; m <= 10; m++) {
  for (let k = 0; k < 60 * 20; k++) {
    w.step([]);
    const v = w.invariants();
    if (v.length) { console.log("INVARIANT", w.tick, v.slice(0, 3)); process.exit(1); }
  }
  rows.push(w.tribes.map((t) => `${w.economy.followers(t.index)}/${w.economy.popCap(t.index)}`).join(" "));
}
console.log(`seed ${seed}: ` + rows.map((r, i) => `m${i + 1} ${r}`).join(" | "), "rejected", w.eventCounts.get("commandRejected") ?? 0, "ms/tick", ((performance.now() - t0) / w.tick).toFixed(2));
const E = w.ents;
for (const t of w.tribes) {
  const b = [];
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 2 && E.tribe[i] === t.index) b.push(`${E.type[i]}:s${E.state[i]}w${E.wood[i]}`);
  const tasks = {};
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 3 && E.tribe[i] === t.index) tasks[E.task[i]] = (tasks[E.task[i]] ?? 0) + 1;
  console.log(" tribe", t.index, b.join(" "), JSON.stringify(tasks));
}

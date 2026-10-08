// Dev scratch: trace one unit's movement state on a populated planet with economy bots.
import { basePack } from "../../packages/sim/test/helpers.ts";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
const p = basePack();
const [seed, unit, from, to] = process.argv.slice(2).map(Number);
const w = new World({ pack: p.files, packHash: p.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
for (const t of w.tribes) w.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
const E = w.ents;
while (w.tick < to) {
  w.step([]);
  if (w.tick >= from && w.tick % 10 === 0) {
    const i = unit;
    const p2 = w.units.paths[i];
    console.log(w.tick, `pos ${E.x[i].toFixed(2)},${E.y[i].toFixed(2)} task ${E.task[i]} order ${E.order[i]} wait ${E.waitPath[i]} goal ${E.gx[i].toFixed(1)},${E.gy[i].toFixed(1)} pp ${E.pathPos[i]}/${p2 ? Array.from(p2).map((v) => (v % 128) + ":" + Math.floor(v / 128)).join(" ") : "-"} stuck ${E.stuck[i]} best ${E.best[i].toFixed(2)} v ${E.vx[i].toFixed(3)},${E.vy[i].toFixed(3)} walk(goal) ${w.terrain.walkable(Math.round(E.gx[i]), Math.round(E.gy[i]))}`);
  }
}

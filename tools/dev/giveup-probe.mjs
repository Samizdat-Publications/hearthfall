// Dev scratch: reproduce soak give-ups and print each stuck unit's surroundings.
import { World } from "../../packages/sim/src/world.ts";
import { Rng } from "../../packages/sim/src/rng.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "../harness/datapack.mjs";
const seed = Number(process.argv[2] ?? 1007);
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed, map: { generator: "continents", size: 128, tribes: 2 } });
w.controllers.length = 0;
const t = w.terrain, n = 128, comp = walkableComponents(t), place = new Rng(seed ^ 0x51ed);
for (let tr = 0; tr < 2; tr++) {
  const h = w.ents.index(w.tribes[tr].hearth);
  const label = comp.labels[t.idx(Math.round(w.ents.x[h]), Math.round(w.ents.y[h]))];
  let placed = 0;
  for (let k = 0; placed < 500 && k < 25000; k++) {
    const x = (w.ents.x[h] + (place.float("misc") - 0.5) * 40 + n) % n, y = (w.ents.y[h] + (place.float("misc") - 0.5) * 40 + n) % n;
    if (comp.labels[t.idx(Math.round(x), Math.round(y))] !== label || t.drowns(x, y)) continue;
    w.spawnUnit("settler", tr, x, y); placed++;
  }
  w.controllers.push(makeBot({ type: "wander", tribe: tr, every: 1, offset: 0, spread: 20, chance: 0.4 }));
}
// economy autonomy would grab idle settlers: disable for this probe
// economy left on to mirror the soak
const E = w.ents, pf = w.units.pf;
let shown = 0;
const nearCount = (i) => { let c = 0; for (let j = 0; j < E.hi; j++) if (j !== i && E.alive[j] && E.cat[j] === 3) { const dx = E.x[j] - E.x[i], dy = E.y[j] - E.y[i]; if (dx * dx + dy * dy < 1) c++; } return c; };
for (let k = 0; k < 20 * 60 * Number(process.argv[3] ?? 3) && shown < 8; k++) {
  // capture state just before give-up: stuck counter about to hit the limit
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 3 && E.stuck[i] === 119 && shown < 8) {
    shown++;
    const v = Math.round(E.x[i]) % n + (Math.round(E.y[i]) % n) * n;
    const p = w.units.paths[i];
    const ring = [];
    for (let dy = -1; dy <= 1; dy++) { let r = ""; for (let dx = -1; dx <= 1; dx++) r += pf.walkable(((Math.round(E.x[i]) + dx + n) % n) + ((Math.round(E.y[i]) + dy + n) % n) * n) ? "." : "#"; ring.push(r); }
    console.log(`tick ${w.tick} unit ${i} pos ${E.x[i].toFixed(2)},${E.y[i].toFixed(2)} goal ${E.gx[i].toFixed(1)},${E.gy[i].toFixed(1)} flow ${E.flowGoal[i]} wait ${E.waitPath[i]} pp ${E.pathPos[i]}/${p?.length ?? "-"} wp ${p ? (p[E.pathPos[i]] % n) + "," + Math.floor(p[E.pathPos[i]] / n) : "-"} v ${E.vx[i].toFixed(3)},${E.vy[i].toFixed(3)} crowd ${nearCount(i)} ring ${ring.join("|")} slope ${t.slope(Math.round(E.x[i]), Math.round(E.y[i]))}`);
  }
  w.step([]);
}

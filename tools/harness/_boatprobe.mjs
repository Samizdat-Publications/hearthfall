// Dev probe (S4 L8-D boat launch stall): replays a soak repro and traces one boat near a tick.
// Usage: node tools/harness/_boatprobe.mjs <repro.json> <unit index> <from tick> <to tick>
import { readFileSync } from "node:fs";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { NAV } from "../../packages/sim/src/units.ts";
import { loadBasePack } from "./datapack.mjs";
const [file, unitArg, fromArg, toArg] = process.argv.slice(2);
const { spec } = JSON.parse(readFileSync(file, "utf8"));
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: spec.seed, map: { generator: spec.map, size: spec.size, tribes: spec.tribes } });
spec.ais.forEach((a, tr) => a && w.controllers.push(makeBot({ ...a, tribe: tr, offset: tr })));
const E = w.ents; const U = w.units; const n = w.terrain.size;
const i = +unitArg, from = +fromArg, to = +toArg;
const pf = U.pfs[NAV.water];
const vx = (v) => `${v % n},${(v - (v % n)) / n}`;
let lastPath = null;
for (let k = 0; k < to; k++) {
  w.step([]);
  if (w.tick < from) continue;
  const p = U.paths[i];
  const ps = p ? Array.from(p).map(vx).join(" ") : "none";
  if (ps !== lastPath) { console.log(`t${w.tick} path ${ps}`); lastPath = ps; }
  if (w.tick % 10 === 0 || w.tick === from) console.log(`t${w.tick} x${E.x[i].toFixed(3)} y${E.y[i].toFixed(3)} g${E.gx[i].toFixed(2)},${E.gy[i].toFixed(2)} ord${E.order[i]} stuck${E.stuck[i]} best${E.best[i].toFixed(2)} pp${E.pathPos[i]} fg${E.flowGoal[i]} occ${E.occupants?.[i]}`);
  for (const ev of w.events) if ((ev.id & 0xffff) === i || ev.vehicle === E.idOf(i)) console.log(`  ev ${JSON.stringify(ev)}`);
}
const cx = Math.round(E.x[i]), cy = Math.round(E.y[i]);
console.log("water walk map around", cx, cy, "(# blocked, digit comp%10)");
for (let y = cy - 6; y <= cy + 6; y++) { let row = `${String((y + n) % n).padStart(3)} `; for (let x = cx - 8; x <= cx + 8; x++) { const v = ((y + n) % n) * n + ((x + n) % n); row += pf.walk?.[v] === 0 ? "#" : String(pf.comp[v] % 10); } console.log(row); }

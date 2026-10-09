// Near probe: replays a soak repro to a tick and lists effect entities, buildings and events near a unit.
// Usage: node tools/harness/probe-near.mjs <repro.json> <unit index> <from tick> <to tick>
import { readFileSync } from "node:fs";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { CAT } from "../../packages/sim/src/entities.ts";
import { loadBasePack } from "./datapack.mjs";
const [file, unitArg, fromArg, toArg] = process.argv.slice(2);
const { spec } = JSON.parse(readFileSync(file, "utf8"));
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: spec.seed, map: { generator: spec.map, size: spec.size, tribes: spec.tribes } });
spec.ais.forEach((a, tr) => a && w.controllers.push(makeBot({ ...a, tribe: tr, offset: tr })));
const E = w.ents; const n = w.terrain.size; const i = +unitArg;
const wd = (d) => ((d % n) + n + n / 2) % n - n / 2;
while (w.tick < +toArg) {
  w.step([]);
  if (w.tick < +fromArg || !E.alive[i]) continue;
  for (const e of w.events) if (e.id !== undefined && (e.id & 0xffff) === i) console.log("ev", w.tick, JSON.stringify(e));
  if ((w.tick - +fromArg) % 40 !== 0) continue;
  const near = [];
  for (let j = 0; j < E.hi; j++) {
    if (!E.alive[j] || j === i || (E.cat[j] !== CAT.effect && E.cat[j] !== CAT.building)) continue;
    const dx = wd(E.x[j] - E.x[i]), dy = wd(E.y[j] - E.y[i]);
    if (dx * dx + dy * dy < 100) near.push(`${E.cat[j] === CAT.effect ? "fx" + E.state[j] + ":" + (pack.files.spells.spells[E.type[j]]?.id ?? "?") : "b:" + pack.files.buildings.buildings[E.type[j]]?.id}@${dx.toFixed(1)},${dy.toFixed(1)}`);
  }
  console.log(w.tick, `u ${E.x[i].toFixed(2)},${E.y[i].toFixed(2)} k${E.ktick[i]} tr${E.trance[i]}`, near.join(" "));
}

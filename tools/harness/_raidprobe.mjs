// Dev probe (stretch 3): land along a row and rival troop positions at a tick.
import { readFileSync } from "node:fs";
import { createLevelWorld } from "../../packages/sim/src/level.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
const [id, at, row] = process.argv.slice(2);
const def = JSON.parse(readFileSync(`scenarios/${id}.json`, "utf8"));
const pack = loadBasePack().pack;
const lv = loadLevels(pack.files).levels.find((l) => l.id === def.level);
const w = createLevelWorld({ def: lv }, pack.files, pack.hash, makeBot);
for (const b of def.bots ?? []) w.controllers.push(makeBot(b));
const units = pack.units?.units ?? w.cfg.pack.units.units;
while (w.tick < Number(at)) {
  w.step((def.commands ?? []).filter((x) => x.tick === w.tick));
  for (const e of w.events) if (e.type === "raid") console.log(w.tick, JSON.stringify(e));
}
let s = ""; for (let x = 30; x <= 100; x += 2) s += w.terrain.isLand(x, Number(row ?? 64)) ? "#" : "~";
console.log("land", s); let wk = ""; for (let x = 30; x <= 100; x += 2) wk += w.terrain.walkable(x, Number(row ?? 64)) ? "#" : "~"; console.log("walk", wk);
const E = w.ents, pos = [];
for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.tribe[i] === 1 && E.cat[i] === 3 && units[E.type[i]].trainedAt) pos.push([Math.round(E.x[i]), Math.round(E.y[i]), E.order[i]]);
console.log(JSON.stringify(pos));

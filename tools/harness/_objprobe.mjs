// Dev probe (kept): run one level scenario and print the tick each objective is done, then a line every
// `every` ticks with done objectives, live tribes and site holders. Usage: node tools/harness/_objprobe.mjs <scenario id> [ticks] [every]
import { readFileSync } from "node:fs";
import { createLevelWorld } from "../../packages/sim/src/level.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
const [id, ticksArg, everyArg] = process.argv.slice(2);
const def = JSON.parse(readFileSync(`scenarios/${id}.json`, "utf8"));
const pack = loadBasePack().pack;
const lv = loadLevels(pack.files).levels.find((l) => l.id === def.level);
const w = createLevelWorld({ def: lv, carry: def.carry }, pack.files, pack.hash, makeBot);
for (const b of def.bots ?? []) w.controllers.push(makeBot(b));
const max = Number(ticksArg || def.runTicks);
const every = Number(everyArg || 2000);
const seen = w.level.done.slice();
while (w.tick < max && !w.level.outcome) {
  w.step([]);
  for (const e of w.events) if (e.type === "levelLost" || e.type === "tribeEliminated") console.log(w.tick, JSON.stringify(e));
  w.level.done.forEach((d, k) => { if (d && !seen[k]) { seen[k] = 1; console.log(w.tick, "objective", k, "done"); } });
  if (w.tick % every === 0) {
    const sites = (w.worship?.sites ?? []).map((s) => `${s.id ?? s.name}:${s.by ?? s.holder}`).join(" ");
    console.log("tick", w.tick, "done", w.level.done.join(""), "alive", w.tribes.map((t) => (t.alive ? 1 : 0)).join(""), sites.slice(0, 160));
  }
}
console.log("end", w.tick, "outcome", w.level.outcome, "done", w.level.done.join(""));

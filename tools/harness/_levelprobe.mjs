// Dev probe (kept): run one level scenario and print alive tribes, level state and forge state every 1000 ticks.
// Usage: node tools/harness/_levelprobe.mjs <scenario id> [ticks] [event,event,...]
import { readFileSync } from "node:fs";
import { createLevelWorld } from "../../packages/sim/src/level.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
const [id, ticksArg] = process.argv.slice(2);
const def = JSON.parse(readFileSync(`scenarios/${id}.json`, "utf8"));
const pack = loadBasePack().pack;
const lv = loadLevels(pack.files).levels.find((l) => l.id === def.level);
const w = createLevelWorld({ def: lv, carry: def.carry }, pack.files, pack.hash, makeBot);
for (const b of def.bots ?? []) w.controllers.push(makeBot(b));
const max = Number(ticksArg || def.runTicks);
const counts = new Map();
while (w.tick < max) {
  w.step([]);
  for (const e of w.events) if ((process.argv[4] || "tribeEliminated,levelWon,levelLost,forgeEnded,boarded,unloaded,orderFailed,buildingDone").split(",").includes(e.type)) { counts.set(e.type, (counts.get(e.type) ?? 0) + 1); if ((counts.get(e.type) ?? 0) <= 3) console.log(w.tick, JSON.stringify(e).slice(0, 200)); }
  if (w.tick % 1000 === 0) console.log("tick", w.tick, "alive", w.tribes.map((t) => t.alive), "level", w.level?.outcome, "forge", w.forge ? JSON.stringify({ e: w.forge.endedAt }) : "-");
}
console.log([...counts]);

// Dev probe (kept, stretch 3): run one level scenario WITH its commands; print objectives done, alive tribes and level events.
// Usage: node tools/harness/_chainprobe.mjs <scenario id> [ticks] [every]
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
const every = Number(everyArg || 1200);
const show = new Set(["worshipComplete", "siteAwakened", "worshipFailed", "objectiveComplete", "triggerFired", "levelWon", "levelLost", "tribeEliminated", "commandRejected"]);
while (w.tick < max && w.level.outcome === 0) {
  const cmds = (def.commands ?? []).filter((c) => c.tick === w.tick);
  w.step(cmds);
  for (const e of w.events) if (show.has(e.type)) console.log(w.tick, JSON.stringify(e).slice(0, 160));
  if (w.tick % every === 0) console.log("tick", w.tick, "done", w.level.done.join(""), "pop", w.economy.followers(0), w.economy.followers(1), "troops", w.combat.troopCount(0), w.combat.troopCount(1));
}
console.log("end", w.tick, "outcome", w.level.outcome, "done", w.level.done.join(""));

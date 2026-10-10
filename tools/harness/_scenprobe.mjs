// Dev probe (kept): run one scenario and print a timeline of selected events plus the rules state.
// Usage: node tools/harness/_scenprobe.mjs <scenario id> [ticks] [event,event,...]
import { readFileSync } from "node:fs";
import { commandsByTick, createScenarioWorld } from "../../packages/sim/src/scenario.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";
const [id, ticksArg, evArg] = process.argv.slice(2);
const def = JSON.parse(readFileSync(`scenarios/${id}.json`, "utf8"));
const pack = loadBasePack().pack;
const w = createScenarioWorld(def, pack.files, pack.hash, makeBot);
const cmds = commandsByTick(def.commands);
const max = Number(ticksArg || def.runTicks);
const want = new Set((evArg || "boarded,unloaded,tribeEliminated,orderFailed,buildingDone,unitTrained").split(","));
const seen = new Map();
while (w.tick < max) {
  w.step(cmds(w.tick));
  for (const e of w.events) {
    if (!want.has(e.type)) continue;
    const k = `${e.type} ${e.reason ?? ""}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= 3) console.log(w.tick, e.type, JSON.stringify(e).slice(0, 160));
  }
  if (w.tick % 1000 === 0) console.log("tick", w.tick, "rules", w.rules ? JSON.stringify({ winner: w.rules.winner, why: w.rules.why, held: w.rules.held }) : "-", "alive", w.tribes.map((t) => t.alive));
}
console.log([...seen].map(([k, v]) => `${v} ${k}`).join(" | "));

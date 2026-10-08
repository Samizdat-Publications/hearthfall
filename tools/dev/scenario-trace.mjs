// Dev scratch: run a scenario and print unit positions, orders and events every N ticks.
import { readFileSync } from "node:fs";
import { basePack } from "../../packages/sim/test/helpers.ts";
import { createScenarioWorld, commandsByTick } from "../../packages/sim/src/scenario.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
const def = JSON.parse(readFileSync(process.argv[2], "utf8"));
const every = Number(process.argv[3] ?? 100);
const p = basePack();
const w = createScenarioWorld(def, p.files, p.hash, makeBot);
const cmds = commandsByTick(def.commands);
const E = w.ents;
while (w.tick < def.runTicks) {
  w.step(cmds(w.tick));
  for (const e of w.events) if (e.type !== "commandRejected" || true) if (["orderFailed", "orderGaveUp", "commandRejected", "drowned"].includes(e.type)) console.log("  ev", w.tick, JSON.stringify(e));
  if (w.tick % every === 0) {
    const u = [];
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === 3) u.push(`${i}:(${E.x[i].toFixed(1)},${E.y[i].toFixed(1)}) o${E.order[i]} s${E.stuck[i]} pp${E.pathPos[i]}/${w.units.paths[i]?.length ?? "-"}`);
    console.log(w.tick, u.slice(0, 6).join(" "));
  }
}

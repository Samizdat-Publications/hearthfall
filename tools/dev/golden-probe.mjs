// Dev scratch: replay a golden definition and print rejections and the effect of each command tick.
import { readFileSync } from "node:fs";
import { basePack } from "../../packages/sim/test/helpers.ts";
import { createScenarioWorld, commandsByTick } from "../../packages/sim/src/scenario.ts";
const g = JSON.parse(readFileSync(process.argv[2], "utf8"));
const p = basePack();
const w = createScenarioWorld(g.def, p.files, p.hash);
const cmds = commandsByTick(g.def.commands);
while (w.tick < g.def.runTicks) {
  const c = cmds(w.tick);
  const before = w.terrain.version;
  w.step(c);
  if (c.length) console.log(w.tick - 1, c.map((x) => x.args.op).join(","), "versionDelta", w.terrain.version - before, w.events.filter((e) => e.type === "commandRejected").map((e) => e.reason).join(";"));
}

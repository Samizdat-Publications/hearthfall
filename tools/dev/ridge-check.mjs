// Dev scratch: heights along the golden's ridge row before and after the op.
import { readFileSync } from "node:fs";
import { basePack } from "../../packages/sim/test/helpers.ts";
import { createScenarioWorld, commandsByTick } from "../../packages/sim/src/scenario.ts";
const g = JSON.parse(readFileSync("replays/golden/terrain_ops_continents.json", "utf8"));
const p = basePack();
const w = createScenarioWorld(g.def, p.files, p.hash);
const row = () => Array.from({ length: 16 }, (_, i) => w.terrain.get(91 + i, 0)).join(" ");
const cmds = commandsByTick(g.def.commands);
while (w.tick <= 120) w.step(cmds(w.tick));
console.log("after ", row(), "sea", w.terrain.sea);
console.log(JSON.stringify(g.def.commands[2].args));

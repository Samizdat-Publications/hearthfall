// temporary: play a level with bots for tribe 0 and print the outcome
import { createLevelWorld } from "../../packages/sim/src/level.ts";
import { commandsByTick } from "../../packages/sim/src/scenario.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
const pack = loadBasePack().pack;
const { levels } = loadLevels(pack.files);
const [id, botJson, cmdJson, maxS] = process.argv.slice(2);
const def = levels.find((l) => l.id === id);
const w = createLevelWorld({ def, carry: {} }, pack.files, pack.hash, makeBot);
for (const b of JSON.parse(botJson || "[]")) w.controllers.push(makeBot(b));
const cmds = commandsByTick(JSON.parse(cmdJson || "[]"));
const hz = w.cfg.tickHz;
const max = Number(maxS || 900) * hz;
let last = -1;
while (w.tick < max && w.level.outcome === 0) {
  w.step(cmds(w.tick));
  const m = Math.floor(w.tick / (60 * hz));
  if (m !== last && w.tick % (60 * hz) === 0) { last = m; console.log(`min ${m} done ${w.level.done} followers ${w.tribes.map((t) => w.economy.followers(t.index))} alive ${w.tribes.map((t) => t.alive)} sites ${w.worship.sites.map((s) => s.tag + ":" + s.lastBy + "/" + s.usesLeft)} held ${w.rules ? w.rules.held.map((h) => h / hz) : "-"} forge ${w.forge ? w.forge.endedAt : "-"}`); }
}
console.log("END", id, "outcome", w.level.outcome, "at s", (w.tick / hz).toFixed(0), "done", w.level.done, "why", [...w.events].reverse().find((e) => e.type === "levelLost")?.why ?? "", "followers", w.tribes.map((t) => w.economy.followers(t.index)));

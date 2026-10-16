// Dev probe (kept, S4 L8-B): play one level scenario's bots at several offsets and print the tick each
// objective was first done and the outcome. DIAG=[x,y] also prints troop counts (and tribe 0 units near x,y) every 2000 ticks. Usage: node tools/harness/_wintimes.mjs <scenario id> [offsets, e.g. 0,1,2,3] [ticks]
import { readFileSync } from "node:fs";
import { createLevelWorld } from "../../packages/sim/src/level.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
import { makeCtx } from "./scenarios.mjs";
const [id, offArg, ticksArg] = process.argv.slice(2);
const def = JSON.parse(readFileSync(`scenarios/${id}.json`, "utf8"));
const pack = loadBasePack().pack;
const lv = loadLevels(pack.files).levels.find((l) => l.id === def.level);
const limit = (lv.lose ?? []).find((l) => l.type === "timeLimit");
const max = Number(ticksArg || (limit ? limit.seconds * 20 : def.runTicks));
const offsets = offArg ? offArg.split(",").map(Number) : [def.bots?.[0]?.offset ?? 0];
for (const off of offsets) {
  const w = createLevelWorld({ def: lv, carry: def.carry }, pack.files, pack.hash, makeBot);
  for (const b of def.bots ?? []) w.controllers.push(makeBot(b.tribe === 0 ? { ...b, offset: off } : b));
  const first = lv.objectives.map(() => -1);
  const warns = new Map();
  while (w.tick < max && w.level.outcome === 0) {
    w.step([]);
    w.level.done.forEach((d, i) => { if (d && first[i] < 0) first[i] = w.tick; });
    if (process.env.DIAG && w.tick % 2000 === 0) { const c = makeCtx(w); const at = JSON.parse(process.env.DIAG); console.log(w.tick, "t0 troops", c.count(c.tribe0.wardens) + c.count(c.tribe0.firecallers), "t0 near", c.count(c.tribe0.units, c.near(at, 20)), "t1 troops", c.count(c.tribe1.wardens) + c.count(c.tribe1.firecallers), "t0 pop", c.count(c.tribe0.units)); }
    for (const e of w.events) if (e.type === "spellCast" && e.tribe === -1) warns.set(e.spell, (warns.get(e.spell) ?? 0) + 1);
  }
  console.log(`off ${off}: ${w.level.outcome === 1 ? "WON" : w.level.outcome === 2 ? "LOST" : "open"} at ${w.tick} (limit ${max}) stages ${first.join(" ")} hazards ${JSON.stringify([...warns])}`);
}

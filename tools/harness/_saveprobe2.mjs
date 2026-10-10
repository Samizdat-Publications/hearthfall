// Dev probe: first tick and entity columns where a restored save at tick T leaves the live run.
import { loadBasePack } from "./datapack.mjs";
import { makeSave, restoreSave, skirmishInit } from "../../apps/game/src/session.ts";
import { opponentsFor } from "../../apps/game/src/opponents.ts";
import { World } from "../../packages/sim/src/world.ts";

const pack = loadBasePack().pack;
const T = Number(process.argv[2] ?? 221);
const params = { seed: 1, level: "continents", size: 96, tribes: 3, ai: ["aggressive", "aggressive"], difficulty: "normal", rules: "king_of_hill" };
const w = new World(skirmishInit(pack, params));
for (const c of opponentsFor(w.tribes.length, 0, params)) w.controllers.push(c);
while (w.tick < T) w.step([]);
const b = restoreSave(pack, makeSave(w, params, [], [], "x"));
for (let k = 0; k < 200; k++) {
  w.step([]);
  b.step([]);
  const ha = w.hash(), hb = b.hash();
  if (ha.all !== hb.all) {
    console.log(`first diff at tick ${w.tick}:`, Object.keys(ha).filter((x) => ha[x] !== hb[x]).join(","));
    const ca = w.ents.columns(), cb = b.ents.columns();
    for (const name of Object.keys(ca)) {
      const x = ca[name], y = cb[name];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { console.log(` ${name}[${i}] live ${x[i]} restored ${y[i]} cat ${w.ents.cat[i]} type ${w.ents.type[i]} tribe ${w.ents.tribe[i]} task ${w.ents.task?.[i]} order ${w.ents.order?.[i]}`); break; }
    }
    const ev = (ww) => ww.events.filter((e) => true).slice(-6).map((e) => e.type).join(",");
    console.log(" live events", ev(w), "| restored", ev(b));
    break;
  }
}

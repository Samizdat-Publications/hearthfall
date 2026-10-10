// Dev probe (kept): save a skirmish at many ticks, restore each save, step 200 ticks and compare with
// the live world's hash at the same tick (the e2e BACKLOG 76 check, in Node, over many save points).
// node tools/harness/_saveprobe.mjs [from=200] [to=260] [size=96] [rules=king_of_hill] [every=1]
import { loadBasePack } from "./datapack.mjs";
import { makeSave, restoreSave, skirmishInit } from "../../apps/game/src/session.ts";
import { opponentsFor } from "../../apps/game/src/opponents.ts";
import { World } from "../../packages/sim/src/world.ts";

const pack = loadBasePack().pack;
const from = Number(process.argv[2] ?? 200);
const to = Number(process.argv[3] ?? 260);
const every = Number(process.argv[6] ?? 1);
const AHEAD = 200;
const params = { seed: 1, level: "continents", size: Number(process.argv[4] ?? 96), tribes: 3, ai: ["aggressive", "aggressive"], difficulty: "normal", rules: process.argv[5] ?? "king_of_hill" };
const w = new World(skirmishInit(pack, params));
for (const c of opponentsFor(w.tribes.length, 0, params)) w.controllers.push(c);
const saves = new Map();
const live = new Map();
while (w.tick <= to + AHEAD) {
  if (w.tick >= from && w.tick <= to && (w.tick - from) % every === 0) saves.set(w.tick, makeSave(w, params, [], [], "x"));
  live.set(w.tick, w.hash());
  w.step([]);
}
let bad = 0;
for (const [t, s] of saves) {
  const b = restoreSave(pack, s);
  for (let k = 0; k < AHEAD; k++) b.step([]);
  const want = live.get(t + AHEAD);
  const got = b.hash();
  if (want.all !== got.all) {
    bad++;
    const parts = Object.keys(want).filter((k) => want[k] !== got[k]);
    if (bad <= 5) console.log(`save at ${t}: differs after ${AHEAD} ticks in ${parts.join(", ")}`);
  }
}
console.log(`RESULT: ${bad ? "FAIL " + bad : "PASS"} (${saves.size} save points)`);

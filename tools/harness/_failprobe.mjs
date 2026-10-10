// Dev probe (kept): run one ai soak seed and tally orderFailed by issuer (stack frame of the order call). BACKLOG 97.
// Usage: node tools/harness/_failprobe.mjs <seed> <persA> <persB> <minutes>
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";
const [seed, pa, pb, mins] = process.argv.slice(2);
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: Number(seed), map: { generator: "continents", size: 128, tribes: 2 } });
[pa, pb].forEach((p, tr) => w.controllers.push(makeBot({ type: "opponent", personality: p, difficulty: "normal", tribe: tr, offset: tr })));
const E = w.ents;
const issuer = new Map();
const where = () => {
  const s = new Error().stack.split("\n").slice(3, 6).map((l) => l.trim().replace(/^at /, "").replace(/\(.*[\\/]/, "(")).join(" < ");
  return s;
};
const origOrder = w.units.order.bind(w.units);
w.units.order = (idx, gx, gy, kind) => {
  const s = where();
  for (const i of idx) issuer.set(i, s);
  return origOrder(idx, gx, gy, kind);
};
const tally = new Map();
const hz = w.cfg.tickHz;
const max = Number(mins || 25) * 60 * hz;
let firstElim = -1;
while (w.tick < max && w.tribes.filter((t) => t.alive).length > 1) {
  w.step([]);
  for (const e of w.events) {
    if (e.type === "tribeEliminated" && firstElim < 0) firstElim = w.tick;
    if (e.type !== "orderFailed") continue;
    const i = E.index(e.id);
    const tr = e.tribe ?? (i >= 0 ? E.tribe[i] : 0);
    const k = `${e.reason} | t${tr} kind ${i >= 0 ? E.type[i] : "?"} hearth ${w.tribes[tr]?.alive && w.tribes[tr].hearth >= 0 && E.index(w.tribes[tr].hearth) >= 0 ? "up" : "down"} | ${i >= 0 ? issuer.get(i) : "?"}`;
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
}
console.log("end s", (w.tick / hz).toFixed(0), "alive", w.tribes.map((t) => t.alive), "firstElim s", firstElim / hz);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(v, k);

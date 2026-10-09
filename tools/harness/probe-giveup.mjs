// Give-up probe: replays a soak repro (reports/latest/repro/*.json, full spec with ais) until the first
// orderGaveUp on a reachable goal and, for the named unit index, prints its recent movement state, path
// and a walkability map around it. Usage: node tools/harness/probe-giveup.mjs <repro.json> <unit index>
import { readFileSync } from "node:fs";
import { World } from "../../packages/sim/src/world.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";
const [file, unitArg] = process.argv.slice(2);
const { spec } = JSON.parse(readFileSync(file, "utf8"));
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: spec.seed, map: { generator: spec.map, size: spec.size, tribes: spec.tribes } });
spec.ais.forEach((a, tr) => a && w.controllers.push(makeBot({ ...a, tribe: tr, offset: tr })));
const E = w.ents; const U = w.units; const n = w.terrain.size;
const target = +unitArg;
const hist = [];
for (let k = 0; k < spec.minutes * 60 * w.cfg.tickHz; k++) {
  w.step([]);
  const i = target;
  if (E.alive[i]) hist.push(`t${w.tick} x${E.x[i].toFixed(2)} y${E.y[i].toFixed(2)} g${E.gx[i].toFixed(1)},${E.gy[i].toFixed(1)} ord${E.order[i]} stuck${E.stuck[i]} best${E.best[i].toFixed(2)} pp${E.pathPos[i]}/${U.paths[i]?.length ?? -1} fg${E.flowGoal[i]} atk${E.atk[i]} in${E.inside?.[i]} cat${E.cat[i]} type${E.type?.[i]} tribe${E.tribe[i]}`);
  if (hist.length > 400) hist.shift();
  const ev = w.events.find((e) => e.type === "orderGaveUp" && e.reachable === 1 && !e.chase);
  if (ev) {
    const j = ev.id & 0xffff;
    console.log("gaveup", JSON.stringify(ev), "tick", w.tick, "idx", j);
    if (j === target) {
      console.log(hist.filter((_, q) => q % 20 === 0 || q > hist.length - 5).join("\n"));
      const p = U.paths[j];
      if (p) console.log("path", p.slice(0, 40).map((v) => `${v % n},${(v - (v % n)) / n}`).join(" "));
      const sv = U.pf.nearestWalkable(U.vertexOf(E.x[j], E.y[j]), 2), gv = U.pf.nearestWalkable(U.vertexOf(E.gx[j], E.gy[j]), 6);
      console.log("sv", sv % n, (sv - (sv % n)) / n, "comp", U.pf.comp[sv], "gv", gv % n, (gv - gv % n) / n, "comp", U.pf.comp[gv]);
      const cx = Math.round(E.x[j]), cy = Math.round(E.y[j]);
      for (let y = cy - 6; y <= cy + 6; y++) { let row = ""; for (let x = cx - 8; x <= cx + 8; x++) { const v = ((y + n) % n) * n + ((x + n) % n); row += U.pf.walk?.[v] === 0 ? "#" : String(U.pf.comp[v] % 10); } console.log(row); }
    }
    break;
  }
}

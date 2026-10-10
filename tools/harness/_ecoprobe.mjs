// Dev probe (kept, BACKLOG 48): economy bots on a map; prints one tribe's state per minute, its events, and why it stopped growing.
// node tools/harness/_ecoprobe.mjs <map> <size> <tribes> <seed> <tribe> [minutes]
import { World, CAT } from "../../packages/sim/src/index.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";

const [map, size, tribes, seed, tribe, minutes = "3"] = process.argv.slice(2);
const pack = loadBasePack().pack;
const w = new World({ pack: pack.files, packHash: pack.hash, seed: Number(seed), map: { generator: map, size: Number(size), tribes: Number(tribes) } });
for (const t of w.tribes) w.controllers.push(makeBot({ type: "economy", tribe: t.index, offset: t.index }));
const tr = Number(tribe);
const hz = w.cfg.tickHz;
const E = w.ents;
const counts = {};
const fails = {};
for (let m = 1; m <= Number(minutes); m++) {
  for (let k = 0; k < 60 * hz; k++) {
    w.step([]);
    for (const e of w.events) {
      if (e.tribe !== tr) continue;
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === "orderFailed" || e.type === "commandRejected" || e.type === "orderGaveUp") {
        const why = String(e.why ?? e.reason ?? "?");
        fails[why] = (fails[why] ?? 0) + 1;
      }
    }
  }
  let units = 0, bld = 0, plans = 0, trees = 0;
  const h = E.index(w.tribes[tr].hearth);
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    if (E.cat[i] === CAT.tree && h >= 0 && Math.hypot(E.x[i] - E.x[h], E.y[i] - E.y[h]) < 20) trees++;
    if (E.tribe[i] !== tr) continue;
    if (E.cat[i] === CAT.unit) units++;
    if (E.cat[i] === CAT.building) (E.state[i] === 0 ? plans++ : bld++);
  }
  const eco = w.tribes[tr].eco;
  console.log(`min ${m}: pop ${w.economy.followers(tr)} units ${units} bld ${bld} plans ${plans} wood ${eco.wood ?? "?"} trees<20 ${trees}`);
}
const pf = w.units.pf;
pf.refresh?.();
const n = pf.n;
const vid = (x, y) => (((Math.round(y) % n) + n) % n) * n + (((Math.round(x) % n) + n) % n);
const hh = E.index(w.tribes[tr].hearth);
console.log(`hearth at ${E.x[hh].toFixed(1)},${E.y[hh].toFixed(1)} comp ${pf.comp[vid(E.x[hh], E.y[hh] + 2)]}`);
const tasks = {};
for (let i = 0; i < E.hi; i++) {
  if (!E.alive[i] || E.tribe[i] !== tr) continue;
  if (E.cat[i] === CAT.building && E.state[i] !== 3) console.log(`plan ${i} type ${E.type[i]} state ${E.state[i]} at ${E.x[i].toFixed(1)},${E.y[i].toFixed(1)} comp ${pf.comp[vid(E.x[i], E.y[i])]} wood ${E.wood?.[i]} dist ${Math.hypot(E.x[i] - E.x[hh], E.y[i] - E.y[hh]).toFixed(1)}`);
  if (E.cat[i] === CAT.unit) tasks[E.task[i]] = (tasks[E.task[i]] ?? 0) + 1;
}
console.log("tasks", JSON.stringify(tasks), "cap", w.economy.popCap(tr));
console.log("events", JSON.stringify(counts));
console.log("fails", JSON.stringify(fails));
const bot = w.controllers[tr];
console.log("spot", JSON.stringify(bot.findSpot?.(w, "dwelling", E.x[hh], E.y[hh])), "homeComp cells", pf.comp.filter((c) => c === pf.comp[vid(E.x[hh], E.y[hh] + 2)]).length);
const lv = {};
for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.tribe[i] === tr && E.cat[i] === CAT.building) lv[`${E.type[i]}:${E.level[i]}`] = (lv[`${E.type[i]}:${E.level[i]}`] ?? 0) + 1;
console.log("levels", JSON.stringify(lv));
{
  const type = w.cfg.buildingIndex.get("dwelling");
  const why = {};
  const snap = w.cfg.pack.balance.movement.snapRadius;
  const home = w.economy.compAt(E.x[hh], E.y[hh], snap);
  for (let r = 4; r <= 22; r++) for (let k = 0; k < r * 2; k++) {
    const a = (k / (r * 2)) * Math.PI * 2;
    const cx = Math.round(E.x[hh] + Math.cos(a) * r), cy = Math.round(E.y[hh] + Math.sin(a) * r);
    const b = w.economy.planBlocker(type, cx, cy) ?? (w.economy.compAt(cx, cy, snap) !== home ? "othercomp" : "ok");
    why[b] = (why[b] ?? 0) + 1;
  }
  console.log("home", home, "why", JSON.stringify(why));
}
{
  const home = w.economy.compOf(hh);
  let inComp = 0, withWood = 0, doomed = 0, all = 0;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.cat[i] !== CAT.tree) continue;
    all++;
    if (w.economy.compOf(i) !== home) continue;
    inComp++;
    if (E.wood[i] > 0) withWood++;
    if (E.state[i] === 1) doomed++;
  }
  console.log("trees all", all, "homeComp", inComp, "withWood", withWood, "doomed", doomed);
}
{
  const snap = w.cfg.pack.balance.movement.snapRadius;
  const ic = {};
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.tribe[i] === tr && E.cat[i] === CAT.unit && E.task[i] === 0) { const c = w.economy.compOf(i, 2); ic[c] = (ic[c] ?? 0) + 1; }
  console.log("idle comps", JSON.stringify(ic));
  for (let d = 0; d < E.hi; d++) if (E.alive[d] && E.tribe[d] === tr && E.cat[d] === CAT.building && E.type[d] === 0) console.log(`dw ${d} lv ${E.level[d]} occ ${E.occupants[d]}/${w.economy.dwellingLevel(d).capacity} comp ${w.economy.compOf(d, snap)} wood ${E.wood[d]} at ${E.x[d].toFixed(0)},${E.y[d].toFixed(0)}`);
}
{
  const k = {};
  for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.tribe[i] === tr && E.cat[i] === CAT.unit && E.task[i] === 0) { const s = `t${E.type[i]} o${E.order[i]} m${E.mode[i]}`; k[s] = (k[s] ?? 0) + 1; }
  console.log("idle kinds", JSON.stringify(k), "settler", w.economy.typeSettler);
}

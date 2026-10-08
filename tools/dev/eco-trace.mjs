// Dev scratch: watch one tribe build a dwelling, move in and breed on a flat map.
import { basePack } from "../../packages/sim/test/helpers.ts";
import { World } from "../../packages/sim/src/world.ts";
import { CAT } from "../../packages/sim/src/entities.ts";
const p = basePack();
const w = new World({ pack: p.files, packHash: p.hash, seed: 5, map: { generator: "flat", size: 64, tribes: 1 }, populate: false });
w.spawnBuilding("hearth", 0, 32, 32);
w.spawnStartUnits(0, 32, 32);
for (let k = 0; k < 24; k++) w.spawnTree(20 + (k % 6) * 1.5, 22 + Math.floor(k / 6) * 1.5);
const cmds = [{ tick: 2, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [39, 32] } }, { tick: 2, tribe: 0, type: "placePlan", args: { building: "dwelling", at: [33, 40] } }];
const E = w.ents;
const ticks = Number(process.argv[2] ?? 6000);
while (w.tick < ticks) {
  w.step(cmds.filter((c) => c.tick === w.tick));
  for (const e of w.events) if (["commandRejected", "buildingDone", "born", "dwellingUpgraded"].includes(e.type)) console.log("  ev", w.tick, JSON.stringify(e));
  if (w.tick % 600 === 0) {
    const tasks = {};
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.unit && E.tribe[i] === 0) tasks[E.task[i]] = (tasks[E.task[i]] ?? 0) + 1;
    const b = [];
    for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.cat[i] === CAT.building) b.push(`${E.type[i]}:s${E.state[i]} w${E.wood[i]} p${E.progress[i].toFixed(1)} occ${E.occupants[i]} lv${E.level[i]}`);
    const eco = w.tribes[0].eco;
    console.log(w.tick, "pop", w.economy.followers(0), "cap", w.economy.popCap(0), "tasks", JSON.stringify(tasks), "|", b.join(" "), "| mana/min", eco.incomePerMin, "charges", Array.from(eco.charges).join(""), "inv", w.invariants().length);
  }
}

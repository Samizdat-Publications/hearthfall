import { world } from "../../packages/sim/test/helpers.ts";
const w = world({ generator: "flat", size: 64, tribes: 1 });
w.spawnUnit("wild", -1, 30, 30);
w.step([{ tick: 0, tribe: 0, type: "terrainOp", args: { op: "set", x: 30, y: 30, r: 3, value: 60 } }]);
console.log("DBG", w.terrain.get(30, 30), w.terrain.drowns(30, 30), [...w.eventCounts], w.events.map((e) => e.type + ":" + e.reason));

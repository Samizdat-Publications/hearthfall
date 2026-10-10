// BACKLOG 65: try counter triangle balance overrides without editing data/base. Usage:
//   node tools/harness/triangle-probe.mjs --seeds 10 --set chanter.convert.breakDamage=300 --set warden.hp=2200
// Each --set is <unitId>.<path>=<number|true|false>; prints the 10 v 10 triangle, the 6 v 10 variance
// probes and the mixed mirror (same definitions as soak --mode triangle). Read only: nothing is saved.
import { loadBasePack } from "./datapack.mjs";
import { runMatchup } from "../../packages/sim/src/matchup.ts";

const args = process.argv.slice(2);
const sets = [];
let seeds = 10;
for (let k = 0; k < args.length; k++) {
  if (args[k] === "--seeds") seeds = Number(args[++k]);
  else if (args[k] === "--set") sets.push(args[++k]);
}
const p = loadBasePack().pack;
const files = structuredClone(p.files);
for (const s of sets) {
  const [path, raw] = s.split("=");
  const [unit, ...keys] = path.split(".");
  const u = files.units.units.find((x) => x.id === unit);
  if (!u) throw new Error(`no unit ${unit}`);
  let o = u;
  for (const key of keys.slice(0, -1)) o = o[key];
  o[keys[keys.length - 1]] = raw === "true" ? true : raw === "false" ? false : Number(raw);
}
const pct = (rs, side) => Math.round((rs.filter((r) => r.winner === side).length * 100) / rs.length);
const lines = [];
for (const [a, b] of [["warden", "firecaller"], ["firecaller", "chanter"], ["chanter", "warden"]]) {
  const full = Array.from({ length: seeds }, (_, k) => runMatchup(files, p.hash, a, b, 1 + k));
  const out = Array.from({ length: seeds }, (_, k) => runMatchup(files, p.hash, a, b, 101 + k, { perSide: 6, perSideB: 10, jitter: 3 }));
  lines.push(`${a} v ${b}: 10v10 ${pct(full, "a")}% | 6v10 ${pct(out, "a")}%`);
}
const mix = "warden+firecaller+chanter";
const mirror = Array.from({ length: seeds }, (_, k) => runMatchup(files, p.hash, mix, mix, 201 + k, { perSide: 9, jitter: 3 }));
lines.push(`mixed mirror: a ${pct(mirror, "a")}%, draws ${pct(mirror, "draw")}%`);
console.log(`${sets.join(" ") || "(base)"}\n  ${lines.join("\n  ")}`);

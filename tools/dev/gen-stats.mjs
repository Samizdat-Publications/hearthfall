// Dev diagnostic: generator statistics per preset and seed (land, walkable share, largest component, candidates).
import { world, basePack } from "../../packages/sim/test/helpers.ts";
import { walkableComponents } from "../../packages/sim/src/generator.ts";
const [gen = "continents", seeds = "1,2,3,4", tribes = "4"] = process.argv.slice(2);
for (const seed of seeds.split(",").map(Number)) {
  try {
    const w = world({ generator: gen, size: 128, tribes: +tribes }, seed);
    const t = w.terrain;
    let land = 0, walk = 0, maxH = 0, slopeSum = 0;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { if (t.isLand(x, y)) { land++; slopeSum += t.slope(x, y); if (t.walkable(x, y)) walk++; } maxH = Math.max(maxH, t.get(x, y)); }
    const c = walkableComponents(t);
    console.log(gen, seed, `rerolls ${w.mapInfo.rerolls} land ${(land / 16384).toFixed(2)} walk/land ${(walk / land).toFixed(2)} largest/land ${(c.sizes[c.largest] / land).toFixed(2)} meanSlope ${(slopeSum / land).toFixed(1)} maxH ${maxH}`);
  } catch (e) { console.log(gen, seed, "FAIL", e.message); }
}

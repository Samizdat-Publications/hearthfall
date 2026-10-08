// Dev scratch: find a short land-water-land segment on a generated map (for golden replay ops).
import { world } from "../../packages/sim/test/helpers.ts";
const [gen, seed, size, tribes] = ["continents", 4242, 128, 3];
const w = world({ generator: gen, size, tribes }, seed);
const t = w.terrain;
for (let y = 0; y < size; y += 3) {
  for (let x = 0; x < size; x++) {
    if (!t.isLand(x, y) || t.isLand(x + 1, y)) continue;
    for (let k = 3; k < 12; k++) if (t.isLand(x + k, y) && t.get(x + k, y) >= t.sea + 4) { console.log(JSON.stringify({ x, y, x2: x + k, y2: y })); process.exit(0); }
  }
}

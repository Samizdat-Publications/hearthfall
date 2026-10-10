import { describe, expect, it } from "vitest";
import { blankCheck, pixelStatsOf, regionMask } from "./web.mjs";

/** A w x h RGBA image: a flat grey world with a noisy HUD strip of `hud` rows at the top. */
function image(w, h, hud) {
  const data = new Uint8Array(w * h * 4);
  let s = 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y < hud) {
        s = (s * 1103515245 + 12345) % 2147483648;
        data[i] = s & 255;
        data[i + 1] = (s >> 8) & 255;
        data[i + 2] = (s >> 16) & 255;
      } else data[i] = data[i + 1] = data[i + 2] = 90;
      data[i + 3] = 255;
    }
  return { data, width: w, height: h };
}

describe("BACKLOG 32: blank and coverage checks sample the 3D view", () => {
  it("a flat canvas under a busy HUD passes as a whole page but fails as the view", () => {
    const png = image(80, 60, 20);
    // the HUD strip is a hole in the canvas region (CSS px at half the image size: scale 2)
    const region = { cssWidth: 40, rect: [0, 0, 40, 30], holes: [[0, 0, 40, 10]] };
    const page = pixelStatsOf(png);
    expect(page.sampled).toBe("page");
    expect(blankCheck(page).ok).toBe(true);
    const view = pixelStatsOf(png, region);
    expect(view.sampled).toBe("view");
    expect(view.viewShare).toBeCloseTo(2 / 3, 2);
    expect(blankCheck(view).ok).toBe(false);
  });

  it("falls back to the whole page when a menu hides almost all of the view", () => {
    const png = image(80, 60, 20);
    const region = { cssWidth: 40, rect: [0, 0, 40, 30], holes: [[0, 0, 40, 29]] };
    const s = pixelStatsOf(png, region);
    expect(s.sampled).toBe("page");
    expect(s.viewShare).toBeLessThan(0.1);
  });

  it("the mask clips the canvas rect to the image and leaves holes at zero", () => {
    const m = regionMask({ cssWidth: 10, rect: [-5, 2, 20, 4], holes: [[3, 0, 5, 10]] }, 10, 5);
    const rows = [...Array(5)].map((_, y) => [...m.slice(y * 10, y * 10 + 10)].join(""));
    expect(rows).toEqual(["0000000000", "0000000000", "1110011111", "1110011111", "0000000000"]);
    expect(regionMask(null, 10, 5)).toBeNull();
  });
});

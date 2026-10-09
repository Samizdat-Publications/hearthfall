// BACKLOG 8: color vision checks for palettes. Simulates protanopia, deuteranopia and tritanopia
// (Machado, Oliveira and Fernandes 2009, severity 1, applied in linear sRGB) and measures how far apart
// colors stay in CIE Lab (CIE76 distance). Used by tests to keep the colorblind tribe palette readable.

export type Vision = "normal" | "protan" | "deutan" | "tritan";

const MACHADO: Record<Vision, number[][]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** "#RRGGBB" to linear sRGB in 0..1 */
export function linearRgb(hex: string): [number, number, number] {
  const v = (k: number) => toLinear(parseInt(hex.slice(k, k + 2), 16) / 255);
  return [v(1), v(3), v(5)];
}

/** Linear sRGB to CIE Lab (D65). */
export function lab([r, g, b]: [number, number, number]): [number, number, number] {
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** Lab color of `hex` as seen with `vision`. */
export function seenAs(hex: string, vision: Vision): [number, number, number] {
  const c = linearRgb(hex);
  const m = MACHADO[vision];
  const s = m.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2]))) as [number, number, number];
  return lab(s);
}

/** Smallest Lab distance between any two of the colors under `vision`. */
export function minPairDistance(hexes: string[], vision: Vision): number {
  const L = hexes.map((h) => seenAs(h, vision));
  let mn = Infinity;
  for (let i = 0; i < L.length; i++)
    for (let j = i + 1; j < L.length; j++) mn = Math.min(mn, Math.hypot(L[i][0] - L[j][0], L[i][1] - L[j][1], L[i][2] - L[j][2]));
  return mn;
}

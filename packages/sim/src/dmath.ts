// Deterministic math for the sim and AI. Only IEEE-exact operations (+ - * /, floor, sqrt) on top of
// committed literal tables, so results are bit-identical in Node and every browser.
import { ATAN_TABLE, ATAN_TABLE_N, SIN_TABLE, SIN_TABLE_N } from "./dmath_tables.ts";

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const INV_TWO_PI = 0.15915494309189535;

/** Table sine with linear interpolation. Max abs error about 5e-6. */
export function sin(x: number): number {
  let t = x * INV_TWO_PI;
  t -= Math.floor(t);
  const f = t * SIN_TABLE_N;
  const i = Math.floor(f);
  const a = SIN_TABLE[i];
  return a + (SIN_TABLE[i + 1] - a) * (f - i);
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

function atanUnit(r: number): number {
  const f = r * ATAN_TABLE_N;
  const i = Math.floor(f);
  if (i >= ATAN_TABLE_N) return ATAN_TABLE[ATAN_TABLE_N];
  const a = ATAN_TABLE[i];
  return a + (ATAN_TABLE[i + 1] - a) * (f - i);
}

/** Table atan2 in radians, range (-PI, PI]. Max abs error about 1e-6. */
export function atan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let a = ax >= ay ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Tileable value noise on the torus from a stateless integer hash (no transcendental math).
import { hash2 } from "./rng.ts";

function lattice(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  return hash2(x, y, seed) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Value noise in [0, 1) at (u, v) in lattice units, tiling every `period` lattice cells. */
export function valueNoise(u: number, v: number, period: number, seed: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = fade(u - x0);
  const fy = fade(v - y0);
  const a = lattice(x0, y0, period, seed);
  const b = lattice(x0 + 1, y0, period, seed);
  const c = lattice(x0, y0 + 1, period, seed);
  const d = lattice(x0 + 1, y0 + 1, period, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

/**
 * Fractal sum over octaves. (x, y) are map coordinates in [0, size); octave k uses period
 * basePeriod * 2^k lattice cells across the whole map so every octave tiles the torus.
 */
export function fbm(x: number, y: number, size: number, basePeriod: number, octaves: number, persistence: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise((x / size) * period, (y / size) * period, period, (seed + Math.imul(o, 0x3c6ef372)) | 0);
    norm += amp;
    amp *= persistence;
    period *= 2;
  }
  return sum / norm;
}

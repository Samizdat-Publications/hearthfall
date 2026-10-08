// Generates packages/sim/src/dmath_tables.ts ONCE. The output is committed as literal numbers so the
// sim never calls Math.sin/atan at runtime (V8 in Node and Chromium may differ in the last bit).
// Re-running this script must produce a byte-identical file; the determinism guard checks the header.
import { writeFileSync } from "node:fs";

const SIN_N = 1024; // samples per full turn, plus one wrap sample
const ATAN_N = 1024; // samples over [0, 1], plus the endpoint

const sin = [];
for (let i = 0; i <= SIN_N; i++) sin.push(Math.sin((i / SIN_N) * 2 * Math.PI));
const atan = [];
for (let i = 0; i <= ATAN_N; i++) atan.push(Math.atan(i / ATAN_N));

const fmt = (arr) => {
  const lines = [];
  for (let i = 0; i < arr.length; i += 6) lines.push("  " + arr.slice(i, i + 6).map((v) => String(v)).join(", ") + ",");
  return lines.join("\n");
};

const out = `// GENERATED ONCE by tools/gen/dmath-tables.mjs and committed. Do not edit by hand.
// Literal tables keep trig deterministic across JavaScript engines.

export const SIN_TABLE_N = ${SIN_N};
export const ATAN_TABLE_N = ${ATAN_N};

/** sin(2*PI*i/SIN_TABLE_N) for i in [0, SIN_TABLE_N] */
export const SIN_TABLE: readonly number[] = [
${fmt(sin)}
];

/** atan(i/ATAN_TABLE_N) for i in [0, ATAN_TABLE_N] */
export const ATAN_TABLE: readonly number[] = [
${fmt(atan)}
];
`;
writeFileSync(new URL("../../packages/sim/src/dmath_tables.ts", import.meta.url), out.replace(/\r\n/g, "\n"));
console.log(`wrote dmath_tables.ts (${sin.length} sin, ${atan.length} atan samples)`);

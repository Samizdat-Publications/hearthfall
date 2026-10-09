#!/usr/bin/env node
// Hearthfall harness CLI. Every command prints at most ~15 lines and ends with a RESULT line:
//   RESULT: PASS | RESULT: SKIP <why> | RESULT: PARTIAL ... | RESULT: FAIL <n> (see reports/latest/<file>)
// SKIP means the layer does not exist yet (its milestone is ahead); the qa driver treats it as passed.
import { Out, ROOT, parseArgs } from "./lib.mjs";
import { guards, typecheck, unit } from "./steps.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

const LAYER_MILESTONE = { scenarios: "M1", replays: "M1", soak: "M3", bench: "M3", "bench-render": "M10", visionqa: "M2" };

async function main() {
  const out = new Out();
  switch (cmd) {
    case "typecheck": {
      const r = typecheck(out);
      return out.finish(r.ok ? "PASS" : "FAIL", r.ok ? "" : `${r.n} (see reports/latest/${r.file})`);
    }
    case "check": {
      const t = typecheck(out);
      const g = await guards(out);
      const n = (t.ok ? 0 : t.n) + g.n;
      out.line(`typecheck ${t.ok ? "ok" : "FAIL"}, guards ${g.ok ? "ok" : g.n + " issues"}`);
      return out.finish(n ? "FAIL" : "PASS", n ? `${n} (see reports/latest/${t.ok ? "guards.json" : "typecheck.log"})` : "");
    }
    case "unit": {
      const r = unit(out);
      return out.finish(r.ok ? "PASS" : "FAIL", r.ok ? "" : `${r.n} (see reports/latest/unit.json)`);
    }
    case "data-check": {
      const mod = await import("../guards/data.mjs");
      const res = mod.run();
      for (const i of res.issues.slice(0, 12)) out.line(`${i.file}  ${i.msg}`);
      if (!res.issues.length) out.line(`base pack valid, hash ${res.hash}`);
      return out.finish(res.issues.length ? "FAIL" : "PASS", res.issues.length ? `${res.issues.length}` : "");
    }
    case "data-docs": {
      const { dataDocs, jsonSchemas } = await import("./datapack.mjs");
      const { mkdirSync, writeFileSync } = await import("node:fs");
      writeFileSync(ROOT + "docs/DATA.md", dataDocs());
      mkdirSync(ROOT + "data/schema", { recursive: true });
      const schemas = jsonSchemas();
      for (const [n, t] of Object.entries(schemas)) writeFileSync(ROOT + "data/schema/" + n, t);
      out.line(`wrote docs/DATA.md and ${Object.keys(schemas).length} JSON Schemas in data/schema/`);
      return out.finish("PASS");
    }
    case "qa-fast": {
      const { qaFast } = await import("./qa.mjs");
      return qaFast(out);
    }
    case "qa": {
      const { qaFull } = await import("./qa.mjs");
      return qaFull(out, args);
    }
    case "e2e": {
      const { default: e2eCmd } = await import("./e2e.mjs");
      return e2eCmd(out, args);
    }
    case "making-of": {
      const { makingOfCmd } = await import("./makingof.mjs");
      return makingOfCmd(out, args);
    }
    case "doctor": {
      const { doctor } = await import("./doctor.mjs");
      return doctor(out, args);
    }
    case "build":
    case "build-test": {
      const { build } = await import("./web.mjs");
      return build(out, cmd === "build-test" ? "test" : "production");
    }
    case "shot":
    case "shot-approve":
    case "sheet": {
      const { shotCmd } = await import("./web.mjs");
      return shotCmd(out, cmd, args);
    }
    case "visionqa-probe":
    case "visionqa-spend":
    case "visionqa-calibrate":
    case "visionqa": {
      const { visionCmd } = await import("../visionqa/cli.mjs").catch((e) => (e.code === "ERR_MODULE_NOT_FOUND" && e.message.includes("visionqa/cli.mjs") ? { visionCmd: null } : Promise.reject(e)));
      if (!visionCmd) return out.finish("SKIP", "VisionQA module not built yet (lands with the probe, M0 to M2)");
      return visionCmd(out, cmd, args);
    }
    case "scenarios":
    case "replays":
    case "rebless":
    case "soak":
    case "bench":
    case "bench-render": {
      const layer = cmd === "rebless" ? "replays" : cmd;
      const modPath = { scenarios: "./scenarios.mjs", replays: "./replays.mjs", soak: "./soak.mjs", bench: "./bench.mjs", "bench-render": "./bench-render.mjs" }[layer];
      const mod = await import(modPath).catch((e) => (e.code === "ERR_MODULE_NOT_FOUND" && e.message.includes(modPath.slice(2)) ? null : Promise.reject(e)));
      if (!mod) return out.finish("SKIP", `${layer} layer lands at ${LAYER_MILESTONE[layer]}`);
      return mod.default(out, cmd, args);
    }
    default:
      console.log("usage: node tools/harness/cli.mjs <typecheck|check|unit|qa-fast|qa|e2e|doctor|data-check|data-docs|build|build-test|shot|shot-approve|sheet|visionqa|visionqa-probe|scenarios|replays|rebless|soak|bench|bench-render>");
      console.log("RESULT: FAIL 1 (unknown command)");
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.log(String(e?.stack ?? e).split("\n").slice(0, 6).join("\n"));
    console.log("RESULT: FAIL 1 (harness crashed)");
    process.exitCode = 1;
  },
);

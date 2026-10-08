// npm run test:scenarios [-- --tag fast] [--id <id>]: runs scenarios/*.json headless and checks
// their assertions with the DSL. Report: reports/latest/scenarios.json.
import { readFileSync, readdirSync } from "node:fs";
import { CAT } from "../../packages/sim/src/entities.ts";
import { commandsByTick, createScenarioWorld } from "../../packages/sim/src/scenario.ts";
import { wrapDelta } from "../../packages/sim/src/terrain.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack } from "./datapack.mjs";
import { evaluate, parse } from "./dsl.mjs";
import { ROOT, writeReport } from "./lib.mjs";

export function loadScenarios(filter = {}) {
  const dir = ROOT + "scenarios/";
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const def = JSON.parse(readFileSync(dir + f, "utf8"));
    def.__file = `scenarios/${f}`;
    if (filter.tag && !(def.tags ?? []).includes(filter.tag)) continue;
    if (filter.id && def.id !== filter.id) continue;
    out.push(def);
  }
  return out;
}

/** Query context for assertions against a world at its current tick. */
export function makeCtx(w) {
  const E = w.ents;
  const t = w.terrain;
  const n = t.size;
  const sel = (pred) => ({ pred });
  const unitOf = (kind, tribe) => {
    const type = kind === null ? null : w.cfg.unitIndex.get(kind);
    return sel((i) => E.cat[i] === CAT.unit && (type === null || E.type[i] === type) && (tribe === null || E.tribe[i] === tribe));
  };
  const buildingOf = (kind, tribe) => {
    const type = kind === null ? null : w.cfg.buildingIndex.get(kind);
    return sel((i) => E.cat[i] === CAT.building && (type === null || E.type[i] === type) && (tribe === null || E.tribe[i] === tribe));
  };
  const tribeCtx = (tr) => {
    const o = { units: unitOf(null, tr), buildings: buildingOf(null, tr) };
    for (const u of w.cfg.pack.units.units) o[u.id + "s"] = unitOf(u.id, tr);
    for (const b of w.cfg.pack.buildings.buildings) o[b.id + "s"] = buildingOf(b.id, tr);
    o.hearth = buildingOf("hearth", tr);
    o.alive = w.tribes[tr]?.alive ?? false;
    return o;
  };
  const ctx = {
    tick: w.tick,
    sea: t.sea,
    size: n,
    terrain: {
      version: t.version,
      height: (p) => t.heightAt(p[0], p[1]),
      minHeightAlong: (a, b) => t.minHeightAlong(a[0], a[1], b[0], b[1]),
      isLand: (p) => t.heightAt(p[0], p[1]) >= t.sea,
      drowns: (p) => t.drowns(p[0], p[1]),
      walkable: (p) => t.walkable(Math.round(p[0]), Math.round(p[1])),
      slope: (p) => t.slope(Math.round(p[0]), Math.round(p[1])),
      scar: (p) => t.scarAt(p[0], p[1]),
      buildable: (p, fw, fh) => t.buildable(Math.round(p[0]), Math.round(p[1]), fw, fh, w.cfg.maxBuildRange),
    },
    events: { count: (type) => w.eventCounts.get(type) ?? 0 },
    trees: sel((i) => E.cat[i] === CAT.tree),
    units: unitOf(null, null),
    buildings: buildingOf(null, null),
    wild: unitOf("wild", -1),
    count: (s, ...preds) => w.count((i) => s.pred(i) && preds.every((p) => p(i))),
    hp: (s) => {
      let sum = 0;
      w.count((i) => {
        if (s.pred(i)) sum += E.hp[i];
        return false;
      });
      return sum;
    },
    near: (p, r) => (i) => {
      const dx = wrapDelta(E.x[i] - p[0], n);
      const dy = wrapDelta(E.y[i] - p[1], n);
      return dx * dx + dy * dy <= r * r;
    },
    /** per-entity predicates for count(): standing in drowning-deep water, or on dry land */
    inWater: (i) => t.drowns(E.x[i], E.y[i]),
    moving: (i) => E.order[i] !== 0,
    idle: (i) => E.order[i] === 0,
    invariants: () => w.invariants().length,
    onLand: (i) => t.heightAt(E.x[i], E.y[i]) >= t.sea,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
  };
  for (let tr = 0; tr < 4; tr++) ctx["tribe" + tr] = tribeCtx(tr);
  return ctx;
}

const fmt = (v) => (typeof v === "number" ? +v.toFixed(3) : JSON.stringify(v));

export function runScenario(def, pack) {
  const t0 = Date.now();
  const failures = [];
  let w;
  try {
    for (const k of ["id", "seed", "map", "runTicks"]) if (def[k] === undefined) throw new Error(`missing "${k}"`);
    w = createScenarioWorld(def, pack.files, pack.hash, makeBot);
    const asserts = (def.assert ?? []).map((a, idx) => ({ ...a, idx, ast: parse(a.expr) }));
    if (!asserts.length) throw new Error("scenario has no assertions");
    for (const a of asserts) {
      if (!Number.isInteger(a.at) || a.at < 0) throw new Error(`assert[${a.idx}] at must be an integer tick >= 0`);
      if (a.at > def.runTicks) throw new Error(`assert[${a.idx}] at ${a.at} is after runTicks ${def.runTicks}`);
    }
    const cmds = commandsByTick(def.commands);
    const check = () => {
      for (const a of asserts) {
        if (a.at !== w.tick) continue;
        const trace = [];
        let ok = false;
        try {
          ok = Boolean(evaluate(a.ast, makeCtx(w), trace));
        } catch (e) {
          failures.push(`assert[${a.idx}] at ${a.at}: ${a.expr}  ERROR ${e.message}`);
          continue;
        }
        if (!ok) failures.push(`assert[${a.idx}] at ${a.at}: ${a.expr}  (got ${trace.map(([l, op, r]) => `${fmt(l)} ${op} ${fmt(r)}`).join(", ")})`);
      }
    };
    check();
    while (w.tick < def.runTicks) {
      w.step(cmds(w.tick));
      check();
    }
  } catch (e) {
    failures.push(`ERROR ${String(e.message ?? e).split("\n")[0]}`);
  }
  return { id: def.id, file: def.__file, ok: failures.length === 0, failures, ms: Date.now() - t0, hash: w?.hash().all, rejected: w?.eventCounts.get("commandRejected") ?? 0 };
}

export default async function scenariosCmd(out, _cmd, args) {
  const res = loadBasePack();
  if (!res.pack) {
    out.line("data pack invalid; run npm run data:check");
    return out.finish("FAIL", "1");
  }
  const defs = loadScenarios({ tag: typeof args.tag === "string" ? args.tag : undefined, id: typeof args.id === "string" ? args.id : undefined });
  if (!defs.length) return out.finish("SKIP", "no matching scenarios");
  const results = defs.map((d) => runScenario(d, res.pack));
  writeReport("scenarios.json", results);
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) for (const f of r.failures.slice(0, 3)) out.line(`${r.file}  ${f}`.slice(0, 220));
  const ms = results.reduce((a, r) => a + r.ms, 0);
  out.line(`scenarios: ${results.length - bad.length}/${results.length} passed in ${(ms / 1000).toFixed(1)}s`);
  return out.finish(bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} (see reports/latest/scenarios.json)` : "");
}

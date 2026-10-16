// npm run test:scenarios [-- --tag fast] [--id <id>]: runs scenarios/*.json headless and checks
// their assertions with the DSL. Report: reports/latest/scenarios.json.
import { readFileSync, readdirSync } from "node:fs";
import { CAT } from "../../packages/sim/src/entities.ts";
import { applySetup, commandsByTick, createScenarioWorld } from "../../packages/sim/src/scenario.ts";
import { OUTCOME, createLevelWorld } from "../../packages/sim/src/level.ts";
import { wrapDelta } from "../../packages/sim/src/terrain.ts";
import { makeBot } from "../../packages/ai/src/index.ts";
import { loadBasePack, loadLevels } from "./datapack.mjs";
import { evaluate, parse } from "./dsl.mjs";
import { ROOT, writeReport } from "./lib.mjs";

export function loadScenarios(filter = {}) {
  const dir = ROOT + "scenarios/";
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const def = JSON.parse(readFileSync(dir + f, "utf8"));
    def.__file = `scenarios/${f}`;
    if (filter.tag && !(def.tags ?? []).includes(filter.tag)) continue;
    if (filter.skipTag && (def.tags ?? []).includes(filter.skipTag)) continue;
    if (filter.id && def.id !== filter.id) continue;
    out.push(def);
  }
  return out;
}

/** Split scenarios into n shards of similar total runTicks (longest first, each to the lightest shard) and keep shard k (1-based), in file order. */
export function pickShard(defs, k, n) {
  const load = new Array(n).fill(0);
  const keep = [];
  const order = defs.map((_, i) => i).sort((a, b) => defs[b].runTicks - defs[a].runTicks || a - b);
  for (const i of order) {
    let s = 0;
    for (let j = 1; j < n; j++) if (load[j] < load[s]) s = j;
    load[s] += defs[i].runTicks;
    if (s === k - 1) keep.push(i);
  }
  return keep.sort((a, b) => a - b).map((i) => defs[i]);
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
    rocks: sel((i) => E.cat[i] === CAT.rock),
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
    /** spell statuses (BACKLOG 1) */
    veiled: (i) => E.veil[i] > 0,
    warded: (i) => E.ward[i] > 0,
    beguiled: (i) => E.beguile[i] > 0,
    riding: (i) => E.inside[i] >= 0 && w.vehicles.isVehicle(E.inside[i]),
    effects: sel((i) => E.cat[i] === CAT.effect),
    charges: (tribe, spell) => w.tribes[tribe]?.eco.charges[w.cfg.spellIndex.get(spell)] ?? -1,
    alive: (tribe) => w.tribes[tribe]?.alive ?? false,
    /** BACKLOG 3 and Leg 5: does `tribe` see the point now (always true with fog off) */
    sees: (tribe, p) => w.vision.sees(tribe, p[0], p[1]),
    /** M9: campaign level state and worship sites by tag */
    level: {
      won: w.level?.outcome === OUTCOME.won,
      lost: w.level?.outcome === OUTCOME.lost,
      objectivesDone: w.level ? w.level.done.filter((d) => d).length : 0,
    },
    /** BACKLOG 13: skirmish victory rules (winner -1 while running, why, held seconds per tribe) */
    rules: {
      winner: w.rules ? w.rules.winner : -2,
      why: w.rules ? w.rules.why : "",
      held: (tribe) => (w.rules ? (w.rules.held[tribe] ?? 0) / w.cfg.tickHz : -1),
    },
    /** BACKLOG 11: the Forge (running, strokes per tribe, readiness; ops -1 without one) and the match clock */
    forge: {
      running: w.forge ? w.forge.running() : false,
      endedAt: w.forge ? w.forge.endedAt : -2,
      ops: (tribe) => (w.forge ? (w.forge.ops[tribe] ?? 0) : -1),
      ready: (tribe) => (w.forge ? w.forge.ready[tribe] === true : false),
    },
    playTick: w.playTick,
    site: (tag) => {
      const s = w.worship.find(tag);
      return { by: s ? s.lastBy : -2, usesLeft: s ? s.usesLeft : -1, progress: s ? Math.max(...s.progress) / s.prayTicks : 0 };
    },
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
    for (const k of def.level ? ["id", "runTicks"] : ["id", "seed", "map", "runTicks"]) if (def[k] === undefined) throw new Error(`missing "${k}"`);
    if (def.level) {
      // a campaign level (data/levels) played by the scenario's bots and commands
      const { levels, issues } = loadLevels(pack.files);
      const lv = levels.find((l) => l.id === def.level);
      if (!lv) throw new Error(issues.find((i) => i.file.endsWith(`/${def.level}.json`))?.message ?? `no level ${def.level}`);
      w = createLevelWorld({ def: lv, carry: def.carry }, pack.files, pack.hash, makeBot);
      applySetup(w, def.setup ?? []);
      for (const b of def.bots ?? []) w.controllers.push(makeBot(b));
    } else w = createScenarioWorld(def, pack.files, pack.hash, makeBot);
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
  let defs = loadScenarios({ tag: typeof args.tag === "string" ? args.tag : undefined, id: typeof args.id === "string" ? args.id : undefined, skipTag: typeof args["skip-tag"] === "string" ? args["skip-tag"] : undefined });
  // --shard k/n keeps one of n shards balanced by runTicks, so a long tag can run as several qa layers
  if (typeof args.shard === "string") { const [k, n] = args.shard.split("/").map(Number); defs = pickShard(defs, k, n); }
  if (!defs.length) return out.finish("SKIP", "no matching scenarios");
  const results = defs.map((d) => runScenario(d, res.pack));
  writeReport("scenarios.json", results);
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) for (const f of r.failures.slice(0, 3)) out.line(`${r.file}  ${f}`.slice(0, 220));
  const ms = results.reduce((a, r) => a + r.ms, 0);
  out.line(`scenarios: ${results.length - bad.length}/${results.length} passed in ${(ms / 1000).toFixed(1)}s`);
  return out.finish(bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} (see reports/latest/scenarios.json)` : "");
}

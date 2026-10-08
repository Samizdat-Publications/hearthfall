// Golden replays (docs/TESTING.md section 4).
//   npm run test:replays                      replay every replays/golden/*.json against its frozen pack
//   npm run replays:rebless -- --reason "why" [--id x]   re-record checkpoints with the current data pack
// A golden holds a scenario-style definition (seed, map, setup, commands, runTicks), the pack hash it
// was blessed with, and hash checkpoints every `every` ticks. The pack is frozen to
// replays/golden/pack/<hash>/ so balance edits in data/base never turn goldens red.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createScenarioWorld, commandsByTick } from "../../packages/sim/src/scenario.ts";
import { loadBasePack, readPackDir } from "./datapack.mjs";
import { validatePack } from "../../packages/data/src/index.ts";
import { ROOT, writeReport } from "./lib.mjs";
import { makeBot } from "../../packages/ai/src/index.ts";

const DIR = ROOT + "replays/golden/";
const PARTS = ["terrain", "entities", "rng", "meta"];

function goldens(id) {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, g: JSON.parse(readFileSync(DIR + f, "utf8")) }))
    .filter((x) => !id || x.g.id === id);
}

function frozenPack(hash) {
  const dir = `replays/golden/pack/${hash}`;
  if (!existsSync(ROOT + dir)) return { error: `frozen pack ${dir} missing` };
  const { raw, parseErrors } = readPackDir(dir);
  if (parseErrors.length) return { error: parseErrors[0].message };
  const res = validatePack(raw);
  if (!res.pack) return { error: `frozen pack ${hash} no longer validates: ${res.issues[0]?.file} ${res.issues[0]?.path} ${res.issues[0]?.message}` };
  return { pack: res.pack };
}

function freeze(pack) {
  const dir = ROOT + `replays/golden/pack/${pack.hash}/`;
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(ROOT + "data/base").filter((x) => x.endsWith(".json"))) copyFileSync(ROOT + "data/base/" + f, dir + f);
}

/** Run a golden definition, calling onCheckpoint(tick, hashParts) every `every` ticks and at the end. */
function play(g, pack, onCheckpoint) {
  const w = createScenarioWorld(g.def, pack.files, pack.hash, makeBot);
  const cmds = commandsByTick(g.def.commands);
  const every = g.every ?? 100;
  while (w.tick < g.def.runTicks) {
    w.step(cmds(w.tick));
    if (w.tick % every === 0 || w.tick === g.def.runTicks) {
      if (onCheckpoint(w.tick, w.hash()) === false) return w;
    }
  }
  return w;
}

function rebless(out, args) {
  if (typeof args.reason !== "string" || args.reason.length < 8) {
    out.line('rebless needs --reason "<why the sim results intentionally changed>"');
    return out.finish("FAIL", "1 (no reason)");
  }
  const res = loadBasePack();
  if (!res.pack) return out.finish("FAIL", "1 (data pack invalid)");
  freeze(res.pack);
  const list = goldens(typeof args.id === "string" ? args.id : undefined);
  if (!list.length) return out.finish("FAIL", "1 (no goldens matched)");
  const lines = [];
  for (const { file, g } of list) {
    const before = g.checkpoints?.at(-1)?.all ?? "none";
    const cps = [];
    play(g, res.pack, (tick, h) => {
      cps.push({ tick, ...h });
    });
    g.packHash = res.pack.hash;
    g.checkpoints = cps;
    writeFileSync(DIR + file, JSON.stringify(g, null, 1) + "\n");
    lines.push(`- ${g.id}: final ${before} -> ${cps.at(-1).all} (pack ${res.pack.hash})`);
    out.line(`reblessed ${g.id}: ${cps.length} checkpoints, final ${cps.at(-1).all}`);
  }
  appendFileSync(DIR + "CHANGELOG.md", `\n## ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\nReason: ${args.reason}\n${lines.join("\n")}\n`);
  return out.finish("PASS");
}

function verify(out, args) {
  const list = goldens(typeof args.id === "string" ? args.id : undefined);
  if (!list.length) return out.finish("SKIP", "no golden replays yet");
  const results = [];
  for (const { file, g } of list) {
    const t0 = Date.now();
    const r = { id: g.id, file: `replays/golden/${file}`, ok: true };
    if (!g.checkpoints?.length) {
      Object.assign(r, { ok: false, error: "never blessed (run replays:rebless)" });
    } else {
      const fp = frozenPack(g.packHash);
      if (fp.error) Object.assign(r, { ok: false, error: fp.error });
      else {
        const expected = new Map(g.checkpoints.map((c) => [c.tick, c]));
        let seen = 0;
        play(g, fp.pack, (tick, h) => {
          const exp = expected.get(tick);
          if (!exp) return true;
          seen++;
          if (exp.all !== h.all) {
            Object.assign(r, { ok: false, divergedAt: tick, parts: PARTS.filter((p) => exp[p] !== h[p]) });
            return false;
          }
          return true;
        });
        if (r.ok && seen !== g.checkpoints.length) Object.assign(r, { ok: false, error: `only ${seen}/${g.checkpoints.length} checkpoints reached` });
      }
    }
    r.ms = Date.now() - t0;
    results.push(r);
  }
  writeReport("replays.json", results);
  const bad = results.filter((r) => !r.ok);
  for (const r of bad) out.line(`${r.file}  ${r.error ?? `diverged by tick ${r.divergedAt} in ${r.parts.join(", ")}`}`);
  out.line(`replays: ${results.length - bad.length}/${results.length} match`);
  return out.finish(bad.length ? "FAIL" : "PASS", bad.length ? `${bad.length} (see reports/latest/replays.json)` : "");
}

/** Replay every golden inside Chromium (test build) and compare with the blessed Node hashes. */
async function verifyBrowser(out, args) {
  const { launch, openGame, shotMode, startPreview, viteBuild } = await import("./web.mjs");
  const list = goldens(typeof args.id === "string" ? args.id : undefined);
  if (!list.length) return out.finish("SKIP", "no golden replays yet");
  await viteBuild("test");
  const preview = await startPreview();
  let browser;
  const results = [];
  try {
    browser = await launch(shotMode());
    const { page } = await openGame(browser, preview.url + "?paused=1&fixedStep=1&size=64&level=flat");
    for (const { file, g } of list) {
      const dir = `replays/golden/pack/${g.packHash}`;
      const { raw } = readPackDir(dir);
      const r = await page.evaluate(([def, pack, every]) => window.__game.runDef(def, pack, every), [g.def, raw, g.every ?? 100]);
      const exp = new Map(g.checkpoints.map((c) => [c.tick, c.all]));
      const bad = (r.checkpoints ?? []).find((c) => exp.get(c.tick) !== c.all);
      const ok = !r.error && r.packHash === g.packHash && !bad && r.checkpoints.length === g.checkpoints.length;
      results.push({ id: g.id, file, ok, error: r.error, divergedAt: bad?.tick });
      if (!ok) out.line(`${file}: browser ${r.error ?? (bad ? "diverged at tick " + bad.tick : "pack or checkpoint mismatch")}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await preview.close();
  }
  writeReport("replays-browser.json", results);
  const nbad = results.filter((r) => !r.ok).length;
  out.line(`browser replays: ${results.length - nbad}/${results.length} match Node bit for bit`);
  return out.finish(nbad ? "FAIL" : "PASS", nbad ? `${nbad}` : "");
}

export default async function replaysCmd(out, cmd, args) {
  if (cmd === "rebless") return rebless(out, args);
  return args.browser ? verifyBrowser(out, args) : verify(out, args);
}

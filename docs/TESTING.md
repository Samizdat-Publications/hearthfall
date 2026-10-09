# Self-test harness (living)

Goal: Claude Code can prove its own work for 24+ hours with no human, spending as few tokens as possible. Evidence order, cheapest first:

1. exit codes and one-line summaries
2. JSON reports queried with small scripts
3. `getSummary()` state JSON
4. pixel statistics and image diffs computed in code
5. OpenAI Decisions checks on screenshots (optional, `docs/VISIONQA.md`)
6. Claude looking at a screenshot (only when flagged, see section 8)

## 1. Commands

All commands are npm scripts that call `node tools/harness/...` with a hard internal timeout and print **at most ~15 lines**. Full logs and JSON go to `reports/<run-id>/` and `reports/latest/`. **Every command finishes in under 9 minutes** (foreground Bash calls are capped around 10); anything bigger is split or resumable, never run in the background. npm scripts run in cmd.exe on Windows, so they call `node` only.

| Command | What it does | Max |
|---|---|---|
| `npm run qa:fast` | typecheck + guards + unit tests + scenarios tagged `fast` (the inner loop) | 2 min |
| `npm run check` | typecheck + all guards (determinism, import direction, data schemas, docs freshness, IP names, dash characters) | 2 min |
| `npm run test:scenarios` | all `scenarios/*.json` headless, parallel workers | 5 min |
| `npm run test:replays` | golden replays, compare hash checkpoints | 3 min |
| `npm run soak -- --seeds 8 --minutes 45 --jobs auto` | bot vs AI matches headless in worker_threads (jobs = cores minus 2), invariants and metrics | 9 min |
| `npm run bench` | sim perf, median of 5 runs after warmup | 4 min |
| `npm run bench:render` | renderer CPU ms per frame in Playwright (measured inside the frame, not rAF intervals, which vsync caps) | 4 min |
| `npm run shot -- --set smoke` | Playwright captures + pixel checks + baseline diff + DOM layout checks | 5 min |
| `npm run visionqa -- --set smoke` | Decisions checks on the latest shots (no-op if provider is off) | 3 min |
| `npm run visionqa:calibrate` | capture the labeled calibration set (good and broken variants), pick per-check thresholds | 5 min |
| `npm run making-of -- add <file> ...` | archive an image for the making-of story (`making-of/README.md`) | 1 min |
| `npm run qa` | resumable driver: runs the layers above (not soak) that have not passed for the current commit, stops before 8.5 min and prints `RESULT: PARTIAL, rerun npm run qa` if layers remain; state in `reports/qa-state.json` keyed by commit sha | 9 min per call |
| `npm run doctor` | environment checks (section 9) | 3 min |

Output contract: the last line is `RESULT: PASS`, `RESULT: SKIP <why>`, `RESULT: PARTIAL ...` or `RESULT: FAIL <n> (see reports/latest/<file>)`. `SKIP` means the layer does not exist yet (its milestone is ahead); the qa driver counts it as passed. Reports go to `reports/latest/` (overwritten each run); machine facts the doctor found persist in `reports/doctor-env.json`. Hours since run start for the STATUS line: `node tools/harness/status.mjs`. Failures print `file:line  first error line` only. Never `cat` a full log; use `node tools/harness/q.mjs <report> <jsonpath>` or grep.

The harness starts the Vite preview server **in-process** (`import { preview } from "vite"`, host 127.0.0.1, `strictPort`), using a test build (`vite build --mode test`, which keeps `window.__game`), and closes it in `finally`. No command leaves a process running.

## 2. Layer 1: unit tests (Vitest)

Pure functions in `sim`, `data`, `ai`: terrain ops and wrap seams, pathfinding on torus, mana distribution math, breeding timers, damage and knockback, conversion rules, command validation, PRNG streams, hash stability, schema validation of every data file. Fast (under 30 s total).

## 3. Layer 2: scenario tests (the workhorse)

A scenario is data, so adding a test costs a JSON file, not code:

```json
{
  "id": "spell_raise_land_bridges_water",
  "seed": 7,
  "map": {"generator": "flat_with_channel", "size": 64},
  "setup": [
    {"spawn": "shaper", "tribe": 0, "at": [10, 32]},
    {"spawn": "settler", "tribe": 0, "count": 5, "near": [10, 32]}
  ],
  "commands": [
    {"tick": 1, "tribe": -1, "type": "grantCharges", "args": {"tribe": 0, "spell": "raise_land", "n": 1}},
    {"tick": 2, "tribe": 0, "type": "cast", "args": {"spell": "raise_land", "target": [22, 32]}},
    {"tick": 40, "tribe": 0, "type": "move", "args": {"units": "tribe0.settlers", "to": [30, 32]}}
  ],
  "runTicks": 600,
  "assert": [
    {"at": 30, "expr": "terrain.minHeightAlong([10,32],[22,32]) > sea"},
    {"at": 600, "expr": "count(tribe0.settlers, near([30,32], 3)) == 5"},
    {"at": 600, "expr": "events.count('drowned') == 0"}
  ]
}
```

Assertion expressions use a tiny safe query DSL implemented in the harness (no `eval`; `tools/harness/dsl.mjs`). Vocabulary (`tools/harness/scenarios.mjs` makeCtx): `tick, sea, size`; `terrain.height/minHeightAlong/isLand/drowns/walkable/slope/scar/buildable/version`; `events.count('type')`; selectors `trees, units, buildings, wild` and `tribeN.units/buildings/hearth/<unit id>s/<building id>s`; `count(selector, near([x,y], r)...)` with entity predicates `moving, idle, inWater, onLand`, `hp(selector)`, `charges(tribe, 'spell')`, `alive(tribe)`, `effects` (selector of live effect entities), `invariants()` (number of invariant violations now), `abs/min/max`. Command entity arguments (`target`, `building`) take an entity id or a selector `"tribeN.<unit or building id>s"` naming the lowest-index living match (`World.resolveEntity`), so scenarios never hard-code ids; `units` takes ids or `"tribeN.<unit id>s"`. Scenarios may attach deterministic bots: `"bots": [{"type": "wander", "tribe": 0}]`. Assertions run when `world.tick == at` (0 is before the first step). Setup entries: `{spawn, tribe, at}` or `{spawn, near, count, spacing}` (golden-angle spiral); `populate: true` spawns the generated Hearths, trees and wild people. Scenarios carry `"tags": ["fast"]` when they run under about 2 seconds; those run in `qa:fast`. Every feature in the roadmap ships with at least one scenario. Every bug fixed gets a regression scenario first.

## 4. Layer 3: golden replays

`replays/golden/*.json` = seed + data pack hash + command log + expected hash every 100 ticks. At bless time the exact data pack is frozen to `replays/golden/pack/<hash>/`, and goldens always replay against their frozen pack, so balance tweaks in `data/base` never turn goldens red; only sim code changes need a rebless. `npm run test:replays` replays and compares. On mismatch the report names the first divergent tick and which hash component changed (terrain, entities, rng).

`npm run test:replays -- --browser` replays every golden inside Chromium (test build, `window.__game.runDef`) and requires the Node hashes bit for bit: the cross-engine determinism check (part of `npm run qa`).

When a change intentionally alters simulation results: run `npm run replays:rebless -- --reason "<why>"`, which rewrites expected hashes and appends the reason to `replays/golden/CHANGELOG.md`. Never rebless to make a red test green without a reason that matches an intended change.

## 5. Layer 4: soak playtests (bots vs AI)

`npm run soak` runs N seeds of 2 to 4 tribes (mix of test-bot personalities and opponent AI) for M game minutes, headless, at max speed.

**Invariants checked every tick** (any violation fails the run and saves a repro replay to `reports/latest/repro/`):
- no NaN or Infinity in any numeric column
- entity counts consistent with free list; no dangling ids in tasks
- population never exceeds cap; mana and charges never negative or above max
- every unit stands on land or is drowning this tick; buildings only on valid flattened land
- no unit with an order makes zero progress for more than 10 s ("stuck")
- every tribe either still alive or has an elimination event

`--mode economy` (M4 gate) runs each tribe with only the economy bot and fails any tribe that does not grow in some minute; it reports population at the end against the soft target. Matches still running at `--minutes` count as stalemates. Tick time is recorded as a metric only (wall clock flakes on a busy desktop). **Metrics** written to `reports/latest/soak.json`: winner distribution by personality, match length, time to first dwelling, population curve, mana income per tribe, spells cast by type, kills by unit type matchup (counter triangle check), drownings, stalemates (no tribe lost a building in 10 minutes).

`--mode war` (M6 gate) gives every tribe a WarBot (`packages/ai/src/warBot.ts`: the economy bot plus one lodge per unit type and a watchtower, training toward a mix with a rally point, and attack-move waves of `waveSize` idle troops at the nearest enemy Hearth). It fails on any invariant violation or any `orderGaveUp` with `reachable: 1` and `chase: 0`; a chase give-up (`chase: 1`, the unit was re-aimed at a moving target it could not close on) is combat dropping a hopeless chase, not a stuck unit. It reports trained, killed, converted, fireballs and eliminated tribes. Combat invariants checked every tick: unit hp in (0, maxHp], wild units have no stance mode or chant, tower occupancy at most its slots, lodge occupancy at most `queueMax`, and a unit inside a building shares its tribe.

**Counter triangle matchup** (fixed definition): flat 64x64 map, two groups of 10 placed 20 cells apart, both attack-move, no spells, no Shapers, 10 seeds; the side with survivors at 90 s wins. `npm run soak -- --mode triangle [--seeds 10]` runs it in process (`runMatchup` in `packages/sim/src/matchup.ts`), fails on any draw (M6 hard gate) and reports each counter's win percent against `gates.counterTriangleMinWinPct` in `soak-triangle.json` (so a war soak does not overwrite it).

**Balance gates are soft** (tunable in `data/base/balance.json` `gates`): they guide tuning but never block a milestone. After at most 2 `playtest-analyst` passes (45 minutes total) record the numbers under "Balance gaps" in PROGRESS and move on. Targets: counter triangle wins at least 65 percent; no personality wins more than 70 percent across seeds at equal difficulty; median skirmish length 12 to 35 minutes; unharassed tribe hits 60 population by minute 10 plus or minus 20 percent.

The `playtest-analyst` subagent reads `soak.json` and proposes data changes. Balance changes go through data only.

## 6. Layer 5: performance

`npm run bench` runs fixed headless scenarios (2000 wandering units from M3; 2000-unit battle once combat exists at M6; terrain spam; 4-tribe late game) 5 times after a warmup and uses the median. Because the sim is deterministic, the bench replays the same ticks from one snapshot several times and keeps each tick's fastest time for the p99, so OS preemption on a busy desktop (this PC often runs at 100 percent CPU with sync services) does not masquerade as an algorithmic spike; spikes that appear in every replay remain. The raw wall-clock p99 is printed next to it for information. The battle measure (M6) puts 1000 troops per tribe (half Wardens, a quarter each Firecallers and Chanters) in 32 x 32 blocks 20 cells apart on a flat 128 map, attack-moving through each other, and gates 400 mid-battle ticks (fastest of 5 replays per tick) against the same 8 ms average and 20 ms p99. Three spike measures sit beside the ARCHITECTURE budgets: the worst tick right after a quake under 2000 moving units (selective re-planning), ten group orders in one tick (flow fields are built at most `maxFlowBuildsPerTick` per tick), and a spell storm (every v1 spell's effects applied by both tribes on one tick, worst of the next 100 ticks while swarms, pools and burning run); they warn above 20 ms and fail above 40 ms, and only warn when the bench's own noise probe (a fixed 1 ms workload, p90 over median above 2) shows the PC is busy with other work. The quake measure keeps the fastest of 3 repeats from identical heights. It **fails** only when an absolute budget in `ARCHITECTURE.md` section 9 is exceeded, and **warns** when a measure regresses more than 35 percent from `reports/baselines/bench.json`. `npm run bench:render` measures renderer CPU time per frame inside the page with a fixed camera path.

## 7. Layer 6: visual capture (screenshots without reading them)

`npm run shot -- --set <name>` serves the test build in-process (section 1), opens Playwright Chromium with WebGLRenderer at `deviceScaleFactor: 1` and launch args `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion` (plus `--use-angle=d3d11 --ignore-gpu-blocklist` if the doctor found them necessary), loads a deterministic URL (`?seed&scenario&camera&paused=1&fixedStep=1`), steps the sim, waits for `frames() >= 3` after the last change, and captures. Shot sets are data in `tools/harness/shotsets/*.json` (smoke: 12 shots including the HUD troop panel `hud_troops`; spells: 8; combat: 3 (fireball, chant, melee, each stepped until its event fires, `expectVfx: 1`), all three run in `npm run qa`; full: about 24 covering terrain bands, wrap seam, globe zoom, map view, battle, each v1 spell, HUD states, menus). Optional per-shot checks: `expectRemesh: [lo, hi]` (chunks remeshed by the steps), `expectDomIssue` (a negative DOM check must fire), `expectVfx: n` (at least n effect instances drawn; every spells shot sets 1, so a spell whose VFX stopped drawing fails).

In test mode every time-driven visual (water, foam, particles, toy animation, sky) reads the fixedStep counter and a seeded RNG, never `THREE.Clock` or wall time, so identical inputs give identical pixels.

Automatic checks per image, all in code (sharp or pngjs + pixelmatch), no model needed:
- **blank check:** luminance standard deviation above threshold, not mostly one color (catches black, white, magenta-missing-texture frames)
- **coverage checks:** fraction of terrain-colored, water-colored, sky-colored pixels inside expected ranges for that preset
- **baseline diff:** pixelmatch against `reports/baselines/shots/<set>/<id>.png` on the same machine and Chromium build; fail if changed pixels over threshold
- **DOM layout checks** (HUD shots): Playwright reads bounding boxes of all HUD elements; fail on any overlap, element off-screen, or text overflow (`scrollWidth > clientWidth`). This replaces most "UI overlap" visual judging and costs nothing.
- **console check:** any browser console error or WebGL warning fails the shot

Outputs: `reports/latest/shots/*.png`, a **contact sheet** `reports/latest/sheet.png` (1280 px wide, at most 9 labeled tiles; bigger sets produce several sheets), and `shots.json` with per-check results.

Baselines: `npm run shot:approve -- --set smoke --reason "<why>"` copies current shots to baselines and logs the reason. Approve only after the shots passed blank and coverage checks and, at milestone ends, after the contact sheet was viewed once.

## 8. Screenshot flag policy (token rule)

Claude Code looks at an image only when one of these is true:
1. a shot failed an automatic check and the JSON reason does not explain the cause,
2. a VisionQA check is below its confidence threshold or contradicts the code checks,
3. a milestone exit that changed visuals (view the contact sheet once),
4. a visual feature was just built (view its sheet or one shot, then add a coverage check).

Each sheet viewing ends with up to 3 concrete visual improvements logged to `docs/BACKLOG.md` (or fixed right away if small). The goal is a game that looks charming, not only one that passes checks.

Otherwise, trust the JSON. When viewing, view a contact sheet or a single crop, never a folder of full-resolution PNGs.

## 9. Doctor (`npm run doctor`)

Runs at session start and after any environment error. Checks and writes `reports/latest/doctor.json`:
- Node version, npm workspaces install state, lockfile present
- Playwright Chromium installed; WebGL capture **headless** gives non-blank pixels; if blank, retries with `--use-angle=d3d11 --ignore-gpu-blocklist`, then **headed** (a window flashes on screen); records which mode works and the `UNMASKED_RENDERER_WEBGL` string (it should name the RTX, not SwiftShader); all later shot runs use that mode. Prefer headless whenever it works
- WebGPU probe (headed and headless) recorded for future use, never required
- Vite preview binds 127.0.0.1 and is reachable
- Python and Blender paths (`BLENDER_EXE` in `.env`, default `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`), Blender version
- presence (not values) of API keys: `MESHY_API_KEY, TRIPO_API_KEY, PIXELLAB_API_KEY, ELEVENLABS_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY`
- free disk space, git status clean or not

Doctor prints `RESULT: PASS` with `WARN` lines when optional items (Blender, any API key) are missing; those disable the dependent feature, are noted in PROGRESS, and never block the core build. It fails only on Node, npm install state, or no working screenshot mode.

**Docs freshness check** (part of `npm run check`): `docs/DATA.md` regenerates byte-identical, every command in section 1 exists in package.json, and every data file validates.

## 10. Process rules for the autonomous run

- Every external command has a timeout. A hang is a failure, not a wait.
- Inner loop: change, `npm run qa:fast`, plus the scenario and replay layers touched, commit when green. Full `npm run qa` (rerun until PASS) at every milestone exit and at least every 4 hours; soak at M3, M6, M7 and after balance changes.
- Commit on every green checkpoint with a message `M<n>: <what>`. Tag milestone exits `m<n>-done`.
- If the same failure survives 3 fix attempts, stop, write the facts to `docs/PROGRESS.md` under "Blocked", revert to the last green commit if needed, and move to the next independent task. Come back later with fresh context or a subagent.
- Flaky test: quarantine it in `tests/QUARANTINE.md` with an owner note; never delete a failing test to get green.

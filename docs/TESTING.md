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
| `npm run check` | typecheck + all guards (determinism, import direction, data schemas, docs freshness, IP names, dash characters, string keys); a guard that scans 0 files fails (BACKLOG 27); the guards' own self-tests are `tools/guards/guards.test.mjs` (in the unit layer) | 2 min |
| `npm run test:scenarios` | all `scenarios/*.json` headless, parallel workers | 5 min |
| `npm run test:replays` | golden replays, compare hash checkpoints | 3 min |
| `npm run soak -- --seeds 8 --minutes 45 --jobs auto` | bot vs AI matches headless in worker_threads (jobs = cores minus 2), invariants and metrics | 9 min |
| `npm run soak:nightly` | BACKLOG 24: the nightly-style soak set (ai 64 seeds x 20 min, ai-idle 4 x 25, difficulty 8 x 20, economy 16 x 10, war 8 x 20), each recorded to the run history, then the trend chart; `-- --only ai,war` runs a subset; summary in `reports/latest/nightly.json` | 9 min |
| `npm run trends` | BACKLOG 24 and 25: redraws `reports/latest/trends.svg` from the run history (ai win share, match length, failed orders, difficulty scores, economy population, sim bench ticks and spikes, render bench) | 1 min |
| `npm run bench` | sim perf, median of 5 runs after warmup | 4 min |
| `npm run bench:render` | renderer CPU ms per frame in Playwright (measured inside the frame, not rAF intervals, which vsync caps) | 4 min |
| `npm run shot -- --set smoke` | Playwright captures + pixel checks + baseline diff + DOM layout checks (the smoke HUD shots run at 1280x720, 2560x1440 `hud_1440p` and 1024x640 `hud_narrow`) | 5 min |
| `npm run e2e` | M8 game flow in Playwright at 1280x720 and 2560x1440: main menu, settings rebind, skirmish setup (an ungeneratable map must show an error), play (BACKLOG 49: a dwelling placed near the Hearth, selected with a left click, shows its wood need and is cancelled from the troop panel; the minimap footprint must not depend on frame timing; BACKLOG 37/40 map view draws through the orthographic camera and ground picks move linearly with the pointer), pause, a control group and a camera bookmark, save, load (same tick and hash; 200 ticks on from the save and from the load agree, BACKLOG 76; the match stats survive the load, BACKLOG 79; the load cleared groups and bookmarks and two more loads keep the GPU geometry count, BACKLOG 82), forced win, end screen, BACKLOG 21 the win counts in the career records and the end screen lists First Light, BACKLOG 19 Watch replay from the end screen (seek to the end: Verified and the recorded hash; seek back and play), Exit to the main menu where the stored replay is offered, BACKLOG 21 the Records screen shows First Light earned; BACKLOG 8 accessibility (colorblind palette and 125 percent scale applied, a Shaper bark shows its subtitle); then the M9 campaign: only level 1 open, play it (level objectives in the HUD), forced level win, Next level, quit, level 2 now open; BACKLOG 75 a forced defeat after the Forge skirmish shows Defeat and "Your tribe is no more."; BACKLOG 12 the map editor (a real left click paints a hill, a Hold the Reliquaries goal without sites disables Playtest, Save stores the draft, Playtest runs it as a level and Quit returns to the editor with the draft); DOM layout check on every screen, any console error fails; screens in `reports/latest/e2e/` | 5 min |
| `npm run visionqa -- --set smoke` | Decisions checks on the latest shots (no-op if provider is off) | 3 min |
| `npm run visionqa:calibrate` | capture the labeled calibration set (good and broken variants), pick per-check thresholds | 5 min |
| `npm run mods` | BACKLOG 18: validate every mod under `mods/` alone and all together (or `-- --mods a,b`), print the load order and conflicts | 1 min |
| `npm run making-of -- add <file> ...` | archive an image for the making-of story (`making-of/README.md`) | 1 min |
| `npm run qa` | resumable driver: runs the layers above (not soak) that have not passed for the current commit, stops before 8.5 min and prints `RESULT: PARTIAL, rerun npm run qa` if layers remain; state in `reports/qa-state.json` keyed by commit sha | 9 min per call; every run writes `reports/latest/qa-full.log` with each layer's status, cached ones included (BACKLOG 96) |
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

Assertion expressions use a tiny safe query DSL implemented in the harness (no `eval`; `tools/harness/dsl.mjs`). Vocabulary (`tools/harness/scenarios.mjs` makeCtx): `tick, sea, size`; `terrain.height/minHeightAlong/isLand/drowns/walkable/slope/scar/buildable/version`; `events.count('type')`; selectors `trees, rocks, units, buildings, wild` and `tribeN.units/buildings/hearth/<unit id>s/<building id>s`; `count(selector, near([x,y], r)...)` with entity predicates `moving, idle, inWater, onLand, veiled, warded, beguiled, riding` (`riding`: aboard a vehicle, BACKLOG 10; vehicle scenarios carry the tag `vehicles`), `hp(selector)`, `charges(tribe, 'spell')`, `alive(tribe)`, `effects` (selector of live effect entities), `invariants()` (number of invariant violations now), `abs/min/max`. Command entity arguments (`target`, `building`) take an entity id or a selector `"tribeN.<unit or building id>s"` naming the lowest-index living match (`World.resolveEntity`), so scenarios never hard-code ids; `units` takes ids or `"tribeN.<unit id>s"`. Scenarios may attach deterministic bots: `"bots": [{"type": "wander", "tribe": 0}]`. A scenario with `"level": "<id>"` (M9) plays a campaign level from `data/levels/` instead of `seed` and `map` (optional `carry`, extra `setup`, `bots` and `commands` on top) and can assert `level.won`, `level.lost`, `level.objectivesDone` and `site('tag').by/usesLeft/progress`. A scenario with `"rules": "<variant id>"` (BACKLOG 13) runs the skirmish victory rules and can assert `rules.winner` (-1 while running, -2 without rules), `rules.why` and `rules.held(tribe)` (seconds). A scenario with `"forge": true` (BACKLOG 11) starts with a Forge phase and can assert `forge.running`, `forge.endedAt` (-2 without one), `forge.ops(tribe)`, `forge.ready(tribe)` and `playTick` (ticks since the match proper began); Forge scenarios carry the tag `forge`. A scenario with `"weather": "rain"` (BACKLOG 14b) plays in rain (every unit at `balance.weather.rain.speedMult`). Assertions run when `world.tick == at` (0 is before the first step). Setup entries (`spawn` is a unit or building id, `tree` or `rock`): `{spawn, tribe, at}` or `{spawn, near, count, spacing}` (golden-angle spiral); `populate: true` spawns the generated Hearths, trees and wild people. Scenarios carry `"tags": ["fast"]` when they run under about 2 seconds; those run in `qa:fast`. Every feature in the roadmap ships with at least one scenario. Every bug fixed gets a regression scenario first.

## 4. Layer 3: golden replays

`replays/golden/*.json` = seed + data pack hash + command log + expected hash every 100 ticks. At bless time the exact data pack is frozen to `replays/golden/pack/<hash>/`, and goldens always replay against their frozen pack, so balance tweaks in `data/base` never turn goldens red; only sim code changes need a rebless. `npm run test:replays` replays and compares. A golden may embed a whole campaign level (`def.levelDef`, a LevelDef with the player only, plus optional `carry`) instead of `seed`, `map` and `setup` (BACKLOG 84: `level_old_reliquary`). Goldens may attach bots like scenarios; `opponent_skirmish` (BACKLOG 66) plays two OpponentAI tribes for 15 minutes on a populated continents planet (economy, worship, spells, waves, conversions, Shaper deaths), so drift anywhere in `packages/ai` turns it red. On mismatch the report names the first divergent tick and which hash component changed (terrain, entities, rng).

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

`--mode economy` (M4 gate) runs each tribe with only the economy bot and fails any tribe that does not grow in some minute (BACKLOG 48: except minute 1, a tribe at the population cap, and a tribe whose land is full: every dwelling at its top level and full, and the bot finds no spot for another; run it also with `--map islands --size 128 --tribes 4 --minutes 20` and `--map continents --size 192 --tribes 4 --minutes 20`, both 6/6 clean); it reports population at the end against the soft target. Matches still running at `--minutes` count as stalemates. Tick time is recorded as a metric only (wall clock flakes on a busy desktop). **Metrics** written to `reports/latest/soak.json`: winner distribution by personality, match length, time to first dwelling, population curve, mana income per tribe, spells cast by type, kills by unit type matchup (counter triangle check), drownings, stalemates (no tribe lost a building in 10 minutes).

`--mode war` (M6 gate) gives every tribe a WarBot (`packages/ai/src/warBot.ts`: the economy bot plus one lodge per unit type and a watchtower, training toward a mix with a rally point, and attack-move waves of `waveSize` idle troops at the nearest enemy Hearth). It fails on any invariant violation or any `orderGaveUp` with `reachable: 1` and `chase: 0`; a chase give-up (`chase: 1`, the unit was re-aimed at a moving target it could not close on) is combat dropping a hopeless chase, not a stuck unit, until one unit gives up more than `balance.gates.maxChaseGiveUpsPerUnit` (5) chases, which fails the seed as stuck while holding a target (BACKLOG 59, every soak mode; `tools/harness/soakgates.mjs`, the orders line prints the chase give-ups and the most by one unit). It reports trained, killed, converted, fireballs and eliminated tribes. Combat invariants checked every tick: unit hp in (0, maxHp], wild units have no stance mode or chant, tower occupancy at most its slots, lodge occupancy at most `queueMax`, and a unit inside a building shares its tribe.

`--mode ai-idle` (M7 gate) runs each opponent personality (aggressive, sneaky, turtle) against an idle tribe that has only its starting units, on `--seeds` seeds each (default 4, run with `--minutes 25`), and fails unless every seed eliminates the idle tribe within `gates.aiEliminatesIdleMinutes` minutes (repro files carry the full spec, `ais` included; `node tools/harness/probe-giveup.mjs <repro> <unit>` replays one to its first give-up; `node tools/harness/probe-near.mjs <repro> <unit> <from tick> <to tick>` lists effect entities, buildings and the unit's events near it in that window (BACKLOG 7: tells a push from a pathing fault); `node tools/harness/probe-view.mjs "<url query>" '<camera json>'` prints the camera, footprint corners and minimap outline points for a view). `--mode ai` runs personality pairs rotated over 8 seeds at equal `--difficulty` (default normal) and reports wins by personality (and by `why` with `--rules <variant id>`, BACKLOG 13), unfinished matches and median match minutes against the soft gates. `--mode bots` runs the test bots (rusher, turtleBot, spellSpammer, randomLegal) against the personalities; its gate is invariants only. `--mode difficulty` (BACKLOG 6) runs easy, hard and brutal (or `--levels easy,hard`) each against a normal opponent of the same personality, `--seeds` per level (default 8, personalities rotated, sides alternated by seed; run with `--minutes 20`), scores a win 1 and an unfinished match ahead on units 0.5, and fails unless easy scores below 0.5 and below hard and brutal scores at least 0.5. `node tools/harness/soak-chart.mjs [out.png]` renders the last difficulty soak as a bar chart (default `reports/latest/soak-difficulty.png`). The ai modes stop a match when one tribe is left, fail on fewer than 3 spell types cast or no mixed-troop wave (ai and ai-idle), and write casts by spell, waves, mixed waves and bridges to `soak.json`. BACKLOG 67: the casts and the 3-type gate count spells that went off (`spellCast` events of each AI tribe, site rewards excluded), with the AI's cast orders beside them as `ordered`; `wavesArrived` counts waves with a member alive within `shared.threatRadius` of their target within 5 minutes (OpponentAI `stats.wavesArrived`, kept in saves).

**Counter triangle matchup** (fixed definition): flat 64x64 map, two groups of 10 placed 20 cells apart, both attack-move, no spells, no Shapers, 10 seeds; the side with survivors at 90 s wins. `npm run soak -- --mode triangle [--seeds 10]` runs it in process (`runMatchup` in `packages/sim/src/matchup.ts`), fails on any draw (M6 hard gate) and reports each counter's win percent against `gates.counterTriangleMinWinPct` in `soak-triangle.json` (so a war soak does not overwrite it). It also reports BACKLOG 60 variance probes, never gated: each counter outnumbered 6 to 10 in a loose formation (jitter 3 cells), and a mixed-army mirror of 9 (`runMatchup` accepts armies as `warden+firecaller+chanter`), which should sit near 50 percent. The `ai` shot set (`npm run shot -- --set ai`, no baselines, not in `npm run qa`) frames the aggressive opponent's first raid on an idle home for reviews and the making-of archive.

**Balance gates are soft** (tunable in `data/base/balance.json` `gates`): they guide tuning but never block a milestone. After at most 2 `playtest-analyst` passes (45 minutes total) record the numbers under "Balance gaps" in PROGRESS and move on. Targets: counter triangle wins at least 65 percent; no personality wins more than 70 percent across seeds at equal difficulty; median skirmish length 12 to 35 minutes; unharassed tribe hits 60 population by minute 10 plus or minus 20 percent.

**Run history (BACKLOG 24 and 25).** `npm run soak -- ... --record`, every `npm run soak:nightly` mode, `npm run bench` and `npm run bench:render` (unless `--no-record`) append one compact row to `reports/history/<soak|bench|bench-render>.jsonl`, stamped with the time and commit (`+` when the tree was dirty). The folder is local to this PC (reports/ is ignored) and nothing deletes it. `npm run trends` draws it as small-multiple line charts, one point per recorded run labeled by commit (`tools/harness/history.mjs`, tested in `history.test.mjs`).

The `playtest-analyst` subagent reads `soak.json` and proposes data changes. Balance changes go through data only.

## 6. Layer 5: performance

`npm run bench` runs fixed headless scenarios (2000 wandering units from M3; 2000-unit battle once combat exists at M6; terrain spam; 4-tribe late game) 5 times after a warmup and uses the median. Because the sim is deterministic, the bench replays the same ticks from one snapshot several times and keeps each tick's fastest time for the p99, so OS preemption on a busy desktop (this PC often runs at 100 percent CPU with sync services) does not masquerade as an algorithmic spike; spikes that appear in every replay remain. The raw wall-clock p99 is printed next to it for information. The battle measure (M6) puts 1000 troops per tribe (half Wardens, a quarter each Firecallers and Chanters) in 32 x 32 blocks 20 cells apart on a flat 128 map, attack-moving through each other, and gates 400 mid-battle ticks (fastest of 5 replays per tick) against the same 8 ms average and 20 ms p99. Three spike measures sit beside the ARCHITECTURE budgets: the worst tick right after a quake under 2000 moving units (selective re-planning), ten group orders in one tick (flow fields are built at most `maxFlowBuildsPerTick` per tick), and a spell storm (every v1 spell's effects applied by both tribes on one tick, worst of the next 100 ticks while swarms, pools and burning run); they warn above 20 ms and fail above 40 ms, and only warn when the bench's own noise probe (a fixed 1 ms workload, p90 over median above 2) shows the PC is busy with other work. The quake measure keeps the fastest of 3 repeats from identical heights. BACKLOG 51 adds a bot-driven economy measure: four tribes of economy bots grow on a continents 192 map for 6 game minutes, then 400 ticks are replayed 3 times (fastest per tick), timing the whole tick (8 ms average and 20 ms p99 budgets, like the wander case) and `Economy.update` alone, where the tree and rock searches run (first run: 0.36 ms a tick, 0.06 ms in Economy.update with 149 units and 1380 trees, so the per-tree component lookup needs no index). It **fails** only when an absolute budget in `ARCHITECTURE.md` section 9 is exceeded, and **warns** when a measure regresses more than 35 percent from `reports/baselines/bench.json`. The `prod` layer of `npm run qa` (M11, `node tools/harness/cli.mjs prod`) builds the production bundle, serves `apps/game/dist` as plain static files from an in-process Node server (no Vite), boots `?debug=1&seed=7` in Chromium and fails when a model fails to load, fewer than 20 load, the boot screen stays up, or the page logs an error. The e2e layer also checks that the boot screen is gone after load and that a startup failure (`?scenario=__missing_scenario__`) shows the fatal panel with its reason, and that a frame that throws every time (debug `forceFrameError()`) stops the loop with the fatal panel. `npm run bench:render` measures renderer CPU time per frame inside the page with a fixed camera path. As built (M10, `tools/harness/bench-render.mjs`, part of `npm run qa`): Playwright Chromium at 2560x1440 loads `scenarios/render_bench_2000.json` (2000 units, 1000 per tribe around each Hearth, so one crowd is in view, plus 500 trees and dwellings), orbits the camera over 240 frames after 30 warmup frames while stepping one tick per frame, three times, and reads `getSummary().render.cpuMs` (time inside `Renderer.render`, scene update plus WebGL submit) after each frame; each frame keeps its fastest time of the three rounds (as `npm run bench` does), so OS preemption does not count as renderer cost, and the raw median of every sample is printed beside it. It fails when the real-model median exceeds 6 ms, fewer than 900 units are drawn, a model fails to load, or the page logs an error; it warns when the median regresses more than 35 percent from `reports/baselines/bench-render.json` (`--save` writes it). A second pass with `?models=0` reports the placeholder cost for information. Draw calls and triangles count the whole frame (the renderer resets `gl.info` by hand, since the retro upscale is a second render call). BACKLOG 14a adds a GPU-inclusive measure: 40 frames rendered with `gl.finish()` (debug `gpuFrameMs(mode)`), best of 3 each, with the tilt-shift off and `post`; the extra cost warns above 1.5 ms and fails above 3 ms. The `look` shot set (tilt-shift off, pre and post at pixel size 3, off and post on the close camera, plus `coast_off` and `coast_post` framed on the nearest low beach to the player Hearth via debug `shore(x, z)`, `peak_post` on the highest peak via debug `peak()`, `huts_post` on built dwellings, and `light_day`, `light_evening`, `light_rain` for the lighting presets and weather) guards the look v3 knobs; it runs in `npm run qa` as the `shot-look` layer. The `menus` shot set (BACKLOG 81: main menu with the title illustration, settings, skirmish setup and campaign at 1280x720, BACKLOG 19 `replay_bar` (the replay bar over a watched match), BACKLOG 21 `menu_records` (the records screen after a forced win), BACKLOG 22 `menu_main_pseudo` and `menu_settings_pseudo` (the pseudo locale; every menu button and label must fit its padded text and no string key may be missing), plus BACKLOG 12 `menu_editor` with painted sea, a Reliquary and trees, opened by clicking the `data-ui` buttons) runs as the `shot-menus` layer.

## 7. Layer 6: visual capture (screenshots without reading them)

`npm run shot -- --set <name>` serves the test build in-process (section 1), opens Playwright Chromium with WebGLRenderer at `deviceScaleFactor: 1` and launch args `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling --disable-features=CalculateNativeWinOcclusion` (plus `--use-angle=d3d11 --ignore-gpu-blocklist` if the doctor found them necessary), loads a deterministic URL (`?seed&scenario&camera&paused=1&fixedStep=1`), steps the sim, waits for `frames() >= 3` after the last change (and, since M10, for the GLB models to finish loading: `models().pending` false), and captures. Shot sets are data in `tools/harness/shotsets/*.json` (smoke: 12 shots including the HUD troop panel `hud_troops`; spells: 8; combat: 3 (fireball, chant, melee, each stepped until its event fires, `expectVfx: 1`), all three run in `npm run qa`; levels: 5 (M9 worship sites in campaign levels via `?campaign=<id>`, plus the Sky Road sea stack and the Forge level's moat with `reveal`; review only); spells2: 9 (BACKLOG 1: the eight later spells, `expectVfx: 1` each, plus `hud_all_spells`, which grants all 16 and asserts the spell bar wraps to two rows; runs in `npm run qa` as `shot-spells2`); full: about 24 covering terrain bands, wrap seam, globe zoom, map view, battle, each v1 spell, HUD states, menus). Scenario shots in the spells, spells2 and combat sets pass `reveal: "1"` (BACKLOG 3) since they check spell and combat visuals, not the fog of war; smoke and levels keep the fog. Optional per-shot checks: `expectRemesh: [lo, hi]` (chunks remeshed by the steps), `expectDomIssue` (a negative DOM check must fire), `expectVfx: n` (at least n effect instances drawn; every spells shot sets 1, so a spell whose VFX stopped drawing fails).

In test mode every time-driven visual (water, foam, particles, toy animation, sky) reads the fixedStep counter and a seeded RNG, never `THREE.Clock` or wall time, so identical inputs give identical pixels.

Automatic checks per image, all in code (sharp or pngjs + pixelmatch), no model needed:
- **blank check:** luminance standard deviation above threshold, not mostly one color (catches black, white, magenta-missing-texture frames)
- **coverage checks:** fraction of terrain-colored, water-colored, sky-colored pixels inside expected ranges for that preset
- both sample only the 3D view (BACKLOG 32): the `#view` canvas rect minus every visible `[data-hud]` and `[data-ui]` box (`viewRegionFn` and `regionMask` in `web.mjs`), so a busy HUD or a green minimap cannot hide a blank or wrong world; when a menu leaves under 10 percent of the view visible they fall back to the whole page. The report records `sampled` (view or page) and `viewShare`; `pixels.test.mjs` covers it
- **baseline diff:** pixelmatch against `reports/baselines/shots/<set>/<id>.png` on the same machine and Chromium build; fail if changed pixels over threshold
- **DOM layout checks** (HUD shots and every e2e screen): Playwright reads bounding boxes of all visible `[data-hud]` elements (elements under a `display:none` ancestor, like the HUD while a menu is up, are skipped); fail on any overlap, panels closer than 4 px, element off-screen, or text overflow (`scrollWidth > clientWidth`). This replaces most "UI overlap" visual judging and costs nothing. BACKLOG 74 looks inside scrolling panels (the menus are one `[data-hud]` rect each): their parts (`[data-ui]` controls, `[data-hud-part]` and labels) fail on overlapping each other, sticking out of the panel sideways or clipping button text, and any panel whose content is taller than it fails unless it scrolls (`overflow-y` auto or scroll). The result carries `parts` and `scrolls` (panels that need scrolling at that size).
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

Accessibility tests (BACKLOG 8): `packages/data/test/a11y.test.ts` simulates protan, deutan and tritan vision on the tribe palettes (the colorblind set must keep every pair at least 40 apart in Lab for every vision type and beat the default by 15) and checks every voice cue the game plays has a subtitle; `apps/game/test/hudFit.test.ts` covers the HUD fit steps; the combat shot set has `colorblind` (1920x1080, 125 percent) and `uiscale_fit` (150 percent asked at 1280x720, the DOM checks fail on any overlap).

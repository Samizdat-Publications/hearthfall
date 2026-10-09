# Progress log (append only)

One line per entry: `MM/DD/YYYY HH:MM  M<n>  what happened`. Never read this file whole; append with a script or a single Edit at the end.

10/08/2026 15:55  M0  workspace skeleton, harness RESULT contract, 6 guards, data pack + zod, doctor PASS (headless GPU capture), first commit
10/08/2026 16:00  M0  A0 asset pipeline landed (Gemini, Meshy, ElevenLabs smoke ok, $0.14); making-of archive added per Stewart's request
10/08/2026 16:20  M0  milestone review: fixed dmath.sin NaN on tiny negatives (+ golden tests), import catches; 7 issues to BACKLOG; tagged m0-done
10/08/2026 16:55  M1  sim core, terrain ops, generator, scenarios + DSL, golden replay, snapshot; review fixes (seam tests for every op, golden ridge over water, god-mode gating, param bounds); tagged m1-done
10/08/2026 17:35  M2  renderer, camera, debug API, shot pipeline + baselines, VisionQA calibration, browser replay determinism
10/08/2026 18:20  M2  tagged m2-done at ed1f5c8; review fixes: deterministic fixedStep visuals (0 px diff), scar heal re-tint, tree cache key, DOM negative shot; A2 buildings and props assets landed ($5.34 total spend)
10/08/2026 19:30  M3  pathing, movement, selection, units/buildings placeholders, soak+bench gates pass
10/08/2026 19:05  M3  note: earlier log times in this file were estimates; real local time is UTC-4 and the run started 17:28 local (21:28Z). Times from here on come from the clock.
10/08/2026 19:42  M3  Opus review fixes: snapshot cursor, strict reachable-give-up soak check (651 -> 0 give-ups), torus-ambiguous waypoint bug, fine line of sight, selective re-plan, fast refresh, ridge bridge scenario, bench spike measures; tagged m3-done
10/08/2026 20:09  M4  economy core, economy bot, HUD v1, placement, economy soak gate (growth every minute, median 59 at 10 min)
10/08/2026 20:41  M4  review fixes: stump deadlock and cancelled-plan tree leak fixed with tests, occupancy invariants, priorities hashed, spread rng stream; tagged m4-done. Stewart asked for Gemini prompts for a retro pixel look; inbox making-of/inbox/ waits for his pick
10/08/2026 20:48  M5  spells v1 complete; A3 assets landed
10/08/2026 21:02  M5  gates pass; art direction v2 decided with Stewart (ADR-005: 3D + retro render pass, benchmark retro-candidate-3); session handoff prepared
10/08/2026 21:28  M5  review fixes (charge steal, making-of paths), retro render pass v1 with re-approved baselines, Stewart's pick recorded as target; tagged m5-done; run paused by Stewart
- 2026-10-09T01:57Z look v2 committed (8ab91b5); M6 started (data: stances, combat radii, Shaper regen, lodge queues).
- 2026-10-09T02:40Z M6 combat core green (qa:fast, 25 scenarios, browser replays identical after rebless). Fixes on the way: leash reacquire loop, trainees heading home were skipped, new orders now cancel lodge and tower walks, fixtures without a Hearth keep their units on elimination. ADR-006.
- 2026-10-09T03:20Z BACKLOG 54 closed: castFailed for unreachable queued casts, statusApply max counts enemies and unimplemented statuses throw, effect fields required by a pack cross-check (no sim fallbacks), building hp required, knockback edgeFalloff as data, STREAMS.terrain, SPELL_KEYS (Shift+M fixed, Shift+N for the 8th spell), spells.test.ts (elimination, respawn without Hearth, double elimination, mid-cast snapshot), expectVfx on spell shots (8/8), spell storm bench 23 ms worst tick on a busy PC (warn only).

## 2026-10-09 M6 war gate
- WarBot (packages/ai/src/warBot.ts): economy bot plus lodges, a watchtower, training toward a mix, rally, attack-move waves. Tests in packages/ai/test/warBot.test.ts.
- soak --mode war: 8/8 seeds x 20 min clean. Fixes on the way: path invalidation resets progress (regression scenario path_long_detour_after_terrain_change); orderGaveUp now carries chase (1 when combat re-aimed the unit at a moving target), the soak counts only reachable non-chase give-ups (regression test in combat.test.ts, seed 1006).
- New per-tick invariants: hp range, wild units neutral, tower and lodge occupancy, inside units share the building's tribe.

## 2026-10-09 M6 audio hooks, triangle soak, battle bench
- AudioHooks (packages/audio) with style.json audio.cues; silent stubs until A4. Game summary reports audio stats.
- soak --mode triangle: 100, 100, 100 percent after the perf changes (90, 100, 100 before), no draws.
- Bench F (2000-unit battle) failed at 16.6 ms avg; profile: acquire 65 percent (full-entity building scan, friend checks), then A* re-paths of disengaged attack-movers. Fixed: building list, cheap rejections, per-tribe coarse grid early-out (all exact, same 1452 kills), idleAcquireSeconds 0.2 for unengaged units, A* straight-line shortcut. Now about 4.4 to 7.5 ms avg, 10 to 18 ms p99 on a noisy machine. Goldens reblessed (final hashes unchanged), browser replays identical.
- WarBot waves only target enemy Hearths reachable on foot (test). orderFailed in war soak rose to 95 (melee chases across water): BACKLOG 55.
- 2026-10-09T05:20Z M6 done: combat core, WarBot and war soak 8/8 x 20 min clean, triangle 10/10 each pair, battle bench in budget, AudioHooks stubs, combat VFX and combat shot set, HUD troop panel; full qa PASS; Sonnet review TAG (3 fixes, BACKLOG 58-61 logged). Tag m6-done.
- 2026-10-09T05:50Z BACKLOG 0b done: progression tiers by followers gate the Watchtower and lodges (data, eco.tier hashed, placePlan lock, WarBot skips, HUD greyed buttons and next-unlock line); replays reblessed, baselines reapproved; war soak 8/8 x 20 min clean. Second resource split to 0c.

## 2026-10-09 M7: opponent AI and test bots
- OpponentAI in packages/ai/src/opponent.ts (ADR-007): census, 8 scored actions, difficulty noise from the ai stream, spell targets by `aiTarget`; Shaper escorts waves; bridge walks her to the shore before casting raise land (a cast aimed over water fails at once, BACKLOG 62).
- Test bots in testBots.ts; makeBot types opponent, rusher, turtleBot, spellSpammer, randomLegal. Tests: opponent.test.ts (6), testBots.test.ts (3).
- Soak modes ai-idle, ai, bots. First ai-idle run had 33074 orderFailed: combat chased targets across quake cliffs every tick, and economy sent settlers to homes on another landmass. Fixed with regression tests in combat.test.ts and economy.test.ts; 145 remain (BACKLOG 63). War soak numbers unchanged; replays unchanged.
- ai soak: sneaky dominates (6 of 7), turtle never wins: playtest-analyst pass next.
- Analyst pass (2 passes, ai_personalities.json only): sneaky firstAttack 8 to 10, mix .35/.3/.35, aggression .45, spell order; turtle pop 55, mix .45/.45/.1, firstAttack 12, lightning first. Then code: emergency training floor, garrison action (sentinel per tower, full under threat). Final ai soak 12 seeds: sneaky 8, aggressive 3, turtle 0, unfinished 1, median 14.1 (BACKLOG 64). Chanter cap 3 to 2 tried and reverted (no effect on probes, BACKLOG 65).
- Skirmish opponents in the app: opponents.ts with ?ai= and ?difficulty=. Full npm run qa PASS. ai shot set and making-of m7 images (first raid highlight).

## 2026-10-09 M7 review fixes (Opus milestone-reviewer: FIX FIRST)
- Blocker: `soak --mode bots --minutes 30` was 6/8 (give-ups 7 and 64 cells from reachable goals). Probe (tools/harness/probe-giveup.mjs) showed a move into the sea: the goal snaps to the nearest walkable vertex, the unit reached it but arrival was measured to the raw point. Fix in units.ts: steer to and arrive at the snapped vertex (flow goal or last waypoint) when it differs from the raw goal. Regression: units.test.ts (A* and flow cases).
- The fix shifted the ai soak and exposed a second give-up (seed 1005 turtle v aggressive): a quake rebuilt a group's flow field with a longer route but flow units kept their old best progress. Fix: terrain changes reset best for flow-field units too. Regression: units.test.ts detour test. Replays unchanged.
- OpponentAI cadence now comes from difficulty reactionSeconds (controller runs every tick, gates itself to the period on its offset phase); test loops all difficulties.
- soak.mjs: ai-idle counts an elimination only within gates.aiEliminatesIdleMinutes; repro files carry the full spec including ais (named seed-label).
- Docs: nine actions and the data-driven cadence (ARCHITECTURE, ADR-007), movement note, TESTING ai-idle wording. Review items 6 to 11 logged as BACKLOG 66 to 71.
- Soaks: ai-idle 12/12 (8.8 to 15.8 min), ai 12/12 x 40 (sneaky 8, aggressive 2, turtle 2, median 13.4, 0 unfinished), bots 8/8 x 30 (0 give-ups), war 8/8.
- Full qa after the fixes: one shot failed (units_select_move): its click hit an unwalkable spot 1 to 2 cells from the units and passed only by overshooting toward it. Click moved to (1100, 420), baseline reapproved (APPROVALS.md). Full `npm run qa` PASS.
- Sonnet re-review: TAG (all FIX FIRST items verified). Notes logged as BACKLOG 72 (flow progress reset on any terrain change) and 73 (empty A* path when standing on the snapped goal). Tagged m7-done.

## 2026-10-09 M8 exit
- HUD v2 committed (676e23f). Full qa then failed: browser replays (zod default on balance.skirmish changed frozen pack d811a61b's hash; now optional with SKIRMISH_DEFAULTS, pack.test.ts checks golden packs hash to their folder, Node replays check it too) and bolt/fireball minimap flake (pickGround used stale camera matrices when the HUD drew before the next frame; renderer.syncCamera before picking, e2e regression). Fixed in 65aa809, full qa PASS.
- Opus review: FIX FIRST. Fixed: Start with an ungeneratable map (continents 96, 4 tribes, seed 11) now shows an error (e2e), failed slot overwrite keeps the old save (storage.test.ts), control groups and bookmarks reset per world, rotate keys refuse Shift combos (keys.test.ts), replaced unit and building layers disposed. Logged BACKLOG 74 to 81. Making-of: M8 menus and HUD v2 sheets, main menu highlight.
- Full qa after the review fixes: wrap_seam minimap flake (HUD redrew only on a 250 ms timer, so a paused capture 3 frames after setCamera showed the old footprint). main.ts refreshes the HUD on the first frame after a camera change; e2e regression (paused, 4 frames); wrap_seam rebaselined.
- Opus re-review: TAG. Minor notes fixed (slot restore branch tested, only generator give-ups become a setup error); BACKLOG 82 for missing regressions. Tagged m8-done.
- 2026-10-09T08:10Z M9 review fixes: contested_shrine shrine moved to (34,48) and rival 6 settlers (late start still wins, idle loses), hold_the_line gains hearthLost lose, extra raid and allied wardens, abandoned-loses scenario; completeObjectives and hearthLost tests; levels baselines re-approved; BACKLOG 83 to 89.
- 2026-10-09 M10 asset and audio integration: GLB models with tribe tint, HUD icons, Web Audio (buses, spatial, music director, aliases, live volumes), bench:render 4.6 ms median at 1440p, shot sets re-approved, npm run qa PASS. Commits 5b0e3e3, fe5d601.
- 2026-10-09 M10 exit: Sonnet review FIX FIRST (music director only ran on event frames, kept old fight after a new world); fixed with a regression test and an e2e check, Shaper bark local only, model load catch; bench:render made noise robust (min of 3 rounds); BACKLOG 93; npm run qa PASS; tag m10-done.
- 2026-10-09 M11 polish and handoff: tribe rings and larger Shaper, lighter trees, combat VFX readability (57), boot screen, fatal panel, frame and context error handling, static production server with prod qa layer, harness shot routing fix with a regression test, State of the game written, BACKLOG re-ranked (94 to 96).
- 2026-10-09 M11 exit: Opus review DO NOT TAG with 3 blockers (frame loop could fail forever behind the boot screen, static server path prefix and malformed-escape crash, wrong spell keys in How to play); all fixed with tests (e2e forceFrameError, serve.test.mjs). Bench needed one rerun at 85 percent CPU from other processes (sim unchanged). npm run qa PASS. Tagged m11-done.

## 2026-10-09 BACKLOG 1: the eight later spells
- Sim (c75a715): statuses veil, ward, beguiled (own-target statusApply), effect kinds erode, storm, mover, trap, wraith; 9 scenarios; goldens reblessed (schema change).
- Then: VFX and status halos, veiled enemies hidden (viewTribe), skirmish Reliquaries (balance.skirmishWorship, ADR-010), AI aiTarget ownFighting and ownMarching plus setup every decision, 16 spell keys and a wrapping spell bar, 8 icons via asset-producer (Gemini, $0.27).
- Bug found by the bots soak: a unit beguiled into a tower stayed inside when it went home (invariant: unit inside another tribe's building). Fix: convertUnit leaves the building first; regression test in effects.test.ts.
- Soaks (8 seeds, 30 min): ai PASS (wins sneaky 5, aggressive 1, turtle 1), ai-idle PASS, bots PASS. spells2 shots 9/9 approved; qa:fast PASS.

## 2026-10-09 BACKLOG 7: balance pass (soft gates)
- Root cause of single-type AI armies: lodges paid from the training sink in building index order, so the Warden lodge (150) took every payment before the Fire lodge (180) or Chant house could. Payments now go oldest trainee first per tribe; regression test in combat.test.ts.
- Chanter: channel 4 to 6 s, entrancedFreeze off, meleeDamage interrupts (the frozen front line walled the Wardens out). Chanter 6 v Warden 10 dropped from 100 to 40 percent. Firecaller 6 v Chanter 10 stays 100 (ranged hits interrupt every chant).
- AI: hunts a Hearthless tribe's Shaper; charges a bridge spell once a wave finds no route; walks its Shaper toward a stranded enemy Shaper and values her for Lightning. Fixed two ai-idle stalls (seed 1000 turtle, seed 1003 aggressive). Personality data: turtle and sneaky economy targets and spells.
- Sim: stuck repaths onto a longer detour restart route progress (not in chases); occupants let out of a building destroyed on drowned land drown at once (ai soak seed 1002 invariant).
- Soaks: ai-idle PASS (12 of 12, all waves mixed), ai PASS (sneaky 6, turtle 5, aggressive 1), bots PASS. qa:fast PASS, replays unchanged.

## 2026-10-09 BACKLOG 0a part 1 and a bench regression
- Tall three-tier conifers take 70 percent of the trees when GLB models load (props.ts, render test); generator rings every Hearth with a grove (terrain.trees.hearthGrove, annulus 9 to 15, density 0.25; world test checks the ring per Hearth). Smoke and spells2 baselines approved.
- Grove-era ai soak found two loops: Lightning cast 154 times at a cluster beyond range on another landmass (pickCast now skips those, opponent test) and settlers sent to a lodge across a cliff (train by count picks only same-component settlers, combat test). Order spam after a Hearth falls logged as BACKLOG 97.
- Full qa then failed the 2000-unit battle bench (11.3 ms avg): bisected to BACKLOG 7, where the Chanter freeze went away so about twice as many units fight at once (real load, not a bug). acquire now skips box corners beyond reach plus a bucket and pre-rejects by squared distance (results bit-identical: same kills, replays unchanged, exactness test against a full scan), and a non-freezing chant scans its radius only on its last tick. 4.9 ms avg, 9.1 ms p99. Full npm run qa PASS.

- 2026-10-09T17:15Z BACKLOG 0a DONE. Terraced plateaus (7b16ca2): generator terrace step 30, flat 0.6 scaled by the local gradient over rampSlope 18 (plain terraces split the land, largest component 0.83 to 0.6; gradient-aware flats keep it), trees.maxSlope 20 (terraces halved the trees). Economy soak seed 1003 regressions: a flattened pad walled in by its own cut (planBlocker now checks Terrain.padConnects) and no growth in minute 1 (bot site choice by least flatten work over two rings). Soaks: economy median 61, ai-idle 12/12 eliminations, ai and bots clean. Volcano smoke column: normal-blended ash puffs and embers in vfx.ts (linear color, shade 0.035 to 0.165 to read dark). Baselines approved: smoke, spells, spells2.

## 2026-10-09 BACKLOG 0c: stone
- Stone is the second harvested resource. Rocks are entities (CAT.rock, new `stone` column) placed by the generator (3 per Hearth 8 to 14 cells out on its landmass, scatter 1.2 per 1000 land cells, trees cleared within 1.5). Settlers quarry 1 stone per 4 s and haul it; construction is held to the delivered share of the stone cost (watchtower 2, lodges 3, skyloft 4).
- planBlocker: "no stone in reach" (no rock on the pad's walkable component) and "a rock is in the way". The stoneInReach cache first keyed on tick alone and missed a rock spawned in the same tick; it now keys on tick, treeVersion and terrain version.
- Economy bot findSpot and opponent lodge and tower scores skip stone buildings without a rock. The rusher's first wave slips to minute 7 (test bot match lengthened).
- Render: rocks in the tree layer from the rock GLBs. One model is a tall spire that read as a monolith at footprint scale, so the scale is also capped by ROCK_HEIGHT; ROCK_WIDTH raised to 1.7 so outcrops read as a resource.
- Replays reblessed (new entity column). Soaks economy, ai-idle, ai, bots PASS; smoke and spells2 baselines re-approved.

## 2026-10-09 BACKLOG 2: Shade and Shade Den
- Shade (combat kind saboteur, data `sabotage` block): disguised while the new `reveal` column is 0; enemies, the Wraith and the AI census skip it and the renderer draws it in the viewer's color. An attack order on an enemy building (never a Hearth, not already alight) or a tree starts a channel (6 s, 2 s for a tree); damage, a new order or the target leaving reach breaks it. A building catches fire (`balance.statuses.buildingFire`, 6 percent of full hp per second for 20 s), a tree burns at once, and the Shade is revealed for 12 s. Enemy Shapers and finished Watchtowers within 5 cells reveal it (checked every 4 ticks).
- Regression found on the way: EntityStore.alloc did not reset veil, ward, beguile, home or stone, so a reused slot inherited statuses (slotReuse.test.ts failed first, now passes).
- Any damage breaks a Shade channel (World.damage: no convert block means every hit interrupts).
- Shade Den unlocked in the town tier. Models and icons by the asset producer (Gemini concept plus Meshy, $0.667).
- AI: optional personality `shades: {count, fromMinute}` (sneaky: 2 from minute 8). Actions buildDen, trainShade and sabotage are scored only when it is set, so other personalities draw the same noise. Shades stay out of waves, go for the nearest finished building of a scouted enemy away from its detectors, and scout an unscouted start site otherwise. Against an economy bot two Shades finished 40 sabotages in 20 minutes (watch for a human player: counters are a Watchtower near the core and the Shaper).
- Render: flames and smoke on burning buildings, sparks at a Shade's target while it channels.
- Scenarios shade_burns_dwelling, shade_detected_by_tower; sim test shade.test.ts (4), AI test. Replays reblessed (new column). Smoke hud_troops now expects 5 locked buildings at start.
- Soaks: economy median 61; ai-idle all 12 (sneaky 11 to 13 min); ai wins aggressive 3, sneaky 3, turtle 2, median 16.6 min; bots PASS. Shot sets smoke, spells, spells2, combat, levels re-approved (Shade Den row in the build panel).
- Full npm run qa PASS after BACKLOG 2. VisionQA flagged spells2/beguile (artifact_suspect 0.64, pink Beguile rings); Claude looked, false positive. New: `npm run visionqa -- --reviewed <id> --reason ...` records a reviewed flag by PNG sha256 in tools/visionqa/reviewed.json (docs/VISIONQA.md).

## 2026-10-09 BACKLOG 3: fog of war
- `packages/sim/src/vision.ts`: per tribe explored and visible grids (cell 2, every 0.5 s, sight radii in balance.vision), hashed and saved only when on; Hearthless tribes revealed to all; MapSpec fog:false. ADR-011.
- AI: threats, enemiesNear, spell targets, clusters and Shade targets filtered by sight; difficulty mapHack (brutal) skips it. Test: an unseen raid draws no defense on normal, does on brutal.
- Render: fog texture in the shared bend uniforms (unexplored 0.16, explored 0.55), units, halos and buildings hidden, minimap fog overlay; reveal=1 and __game.setReveal render only; summary fog block.
- Golden replays unchanged (frozen packs have no vision block). Soaks: economy 61, ai-idle 12/12, ai sneaky 5 aggressive 2 turtle 1 median 15.2, bots PASS. Spell and combat scenario shots pass reveal=1; smoke, spells2, levels re-approved.

## 2026-10-09 BACKLOG 4 command UX polish
- Sim: `move` takes optional `formation` ("box" or "line"); packages/sim/src/formation.ts ranks units front to back (trained melee, settlers and others, ranged and convert, caster) and assigns wrapped slots facing the goal; per-unit A* orders for 2 to `balance.movement.formation.maxUnits` (30) units, spacing 1.2. Optional schema field, so frozen packs and replays are unchanged.
- App: player moves of 2+ units send formation box; double-click selects own same-type units within 14 cells; a control group digit pressed twice within 0.4 s centers the camera (wrap-aware center); spell preview line counts visible enemies and own units in the area; HUD counts down the Backspace undo while a cast is in its window (undoSeconds 1 equals castSeconds 1, no retune).
- Tests: packages/sim/test/formation.test.ts (4), apps/game/test/commandux.test.ts (5), scenario formation_box_ranks, combat shot formation. Help line shortened; smoke, combat, spells, spells2, levels re-approved (help text diffs 1.3 to 1.7 percent; units_select_move also shows the formation).
- Stewart's art note: tilt-shift tabletop ref (making-of/a1 style-ref-06) recorded as second reference, BACKLOG 14a, ASSETS decisions; making-of entry highlighted.

## 2026-10-09 BACKLOG 5 animated units (ADR-012)
- Procedural vertex animation instead of rig plus VAT: packages/render/src/unitAnim.ts (unitClip from sim state, pure unitPose and deathPose, rigGeometry aRig = model height and x share, GLSL chunk after begin_vertex via bendMaterial anim flag). UnitLayer writes instanceAnim per instance (shared by body and detail meshes, geometries cloned per kind) and draws 1.2 s death ghosts from killed and drowned events (Renderer.consumeEvents).
- Debug: __game.setAnimProbe(on). Scenario anim_gallery and combat shot anim_gallery (two rows, all clips). Tests: packages/render/test/unitAnim.test.ts (4). bench:render median 3.7 ms, 1000 drawn. smoke and combat re-approved (walking legs, idle breathing).
- Blender 5.1.2 present (doctor); rig plus VAT kept as BACKLOG 5a.

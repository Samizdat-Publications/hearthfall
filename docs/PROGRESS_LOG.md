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

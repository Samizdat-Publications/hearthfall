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

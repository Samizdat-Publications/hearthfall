# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M7 exit in progress (full qa PASS at ef1a0c0; review then tag m7-done). M7 shipped: OpponentAI (opponent.ts, ADR-007: utility scoring of 9 actions from ai_personalities.json, difficulty cadence and noise, spell `aiTarget`, scouting, mixed waves with Shaper escort, raise-land bridge, Shaper protection, tower sentinels and full garrisons under threat), test bots (rusher, turtleBot, spellSpammer, randomLegal), soak modes ai-idle/ai/bots, skirmish opponents from `?ai=` and `?difficulty=` (opponents.ts, default aggressive, sneaky, turtle), ai shot set (review only). Gate: ai-idle 12/12 eliminations (about 9, 12, 15 min), 6 spell types, mixed waves; ai 12/12 x 40 min clean; bots 8/8 x 30 min clean. Sim fixes from soaks: no chase across water or cliffs, same-landmass economy assignment. M6 done (tag m6-done).
- M1 shipped: sfc32 rng streams, FNV hash parts, SoA entities, torus terrain with all ops + dirty cursor (dirtySince), tileable fbm generator (continents, islands, flat test maps) with connected Hearth sites, trees, wild people; Command registry (god-mode terrainOp is tribe -1 or godMode only); World step order, drowning, snapshot/restore; scenario runner + safe DSL (4 scenarios); golden replay with frozen pack (terrain_ops_continents). 66 unit tests. qa:fast now includes replays.
- M2 shipped: renderer (faceted chunks, water, curved world, wrap, sky, trees), camera rig, debug API, shot pipeline (pixel-exact baselines in fixedStep), VisionQA calibrated, browser replay determinism.
- M3 shipped: SoA movement columns, pathing (A* + component labels + budget, flow fields, spatial hash separation, route-progress stuck detection; ADR-004), move/stop/impulse commands, Controller hook + WanderBot, starting Shaper + 5 settlers per Hearth, unit and building placeholder layers with tribe tint and interpolation, selection (click, box, groups) + right-click move via bent-terrain picking, 7 pathing scenarios, soak (8 seeds x 10 min x 1000 units clean), bench (2000 units avg 3.3 ms, algorithmic p99 2.2 ms).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A0 to A3 done (buildings, props, units as GLB; 21 SFX, Shaper barks, 3 music stems, 7 VFX textures, 27 icons; indexes in assets/*/index.json). Spend $8.21 of $30. A4 (integration) is M10.
- M4 shipped: economy (jobs, construction, dwellings, breeding, trees, mana and charging), EconomyBot, HUD v1, placement; gate soak passes (median 59 at minute 10).
- M5 shipped: cast command with walk-into-range, cast window and undo, effect primitive registry, 8 v1 spells as data with 10 scenarios, Shaper death/respawn/charge steal/elimination, VFX layer, targeting rings, spells shot set, spells_duel golden (Node and Chromium identical).
- Art direction v2 (ADR-005 + addendum): target = Stewart's pick, making-of/a1 retro-candidate-1 (dense village on a planet in space, terraced cliffs, foamy sea, stone-framed HUD); technique = candidate 3. Retro render pass v1 is ON (style.json render: pixelScale 3, 20-level palette, Bayer dither, terrain pixel noise, Hearth firelight, dusk light, stone and wood HUD). Baselines re-approved.
- Machine: another project (tallgrass/ecosystem-sim node process) runs CPU-heavy simulations; bench has a noise probe. Ask Stewart to pause it only if a clean perf baseline is ever required.
- Machine note: this PC often runs at 100 percent CPU (OneDrive sync); wall-clock timing is noisy, bench uses deterministic replay minima.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md.
- Subagents: project agents are registered again (milestone-reviewer, qa-runner, ...); call them by type.

## Next 3 actions
1. M7 review (Opus milestone-reviewer) and its fixes, then tag m7-done.
2. M8 game flow and UI per ROADMAP: main menu, skirmish setup (map size, seed, opponents and difficulty feed opponents.ts), pause, settings, win and loss, save and load (snapshot + command log), HUD v2; Playwright e2e gate.
3. BACKLOG 64 and 65 (personality balance, triangle stomps) when M8 is done.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 3, turtle 0, unfinished 1 (8 percent, ok), median 14.1 min (ok). Sneaky over the 70 percent cap; 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64).
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).

## State of the game (for Stewart)
(written when the run is done)

# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M4 done (tag m4-done after review). Next M5: the Shaper and spells v1.
- M1 shipped: sfc32 rng streams, FNV hash parts, SoA entities, torus terrain with all ops + dirty cursor (dirtySince), tileable fbm generator (continents, islands, flat test maps) with connected Hearth sites, trees, wild people; Command registry (god-mode terrainOp is tribe -1 or godMode only); World step order, drowning, snapshot/restore; scenario runner + safe DSL (4 scenarios); golden replay with frozen pack (terrain_ops_continents). 66 unit tests. qa:fast now includes replays.
- M2 shipped: renderer (faceted chunks, water, curved world, wrap, sky, trees), camera rig, debug API, shot pipeline (pixel-exact baselines in fixedStep), VisionQA calibrated, browser replay determinism.
- M3 shipped: SoA movement columns, pathing (A* + component labels + budget, flow fields, spatial hash separation, route-progress stuck detection; ADR-004), move/stop/impulse commands, Controller hook + WanderBot, starting Shaper + 5 settlers per Hearth, unit and building placeholder layers with tribe tint and interpolation, selection (click, box, groups) + right-click move via bent-terrain picking, 7 pathing scenarios, soak (8 seeds x 10 min x 1000 units clean), bench (2000 units avg 3.3 ms, algorithmic p99 2.2 ms).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A2 + A2b done (11 buildings, 6 props, 6 units as GLB; sheets reports/latest/assets_*_sheet.png). Warden club sticks out in z (accepted for v1; review at M10). Spend $7.01 of $30.
- M4 shipped: economy.ts (settler jobs, construction, dwellings occupancy/upgrade/breeding, trees regrow and spread, mana income + split + round-robin charging, start Bolt charges, start wood supplies), EconomyBot (AI tribes run it until M7), commands placePlan/cancelPlan/setSplit/setAutoCharge/setPriorities, HUD v1 in packages/ui (resources, split slider, priorities, spell bar with charge rings and auto toggles, build menu, D places a dwelling with a ghost), plan and level visuals, economy soak gate (every tribe grows every minute; median 59 at minute 10).
- Machine note: this PC often runs at 100 percent CPU (OneDrive sync); wall-clock timing is noisy, bench uses deterministic replay minima.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md.
- Subagents: project agents not registered in this session; use general-purpose with the agent file's rules and model pasted in.

## Next 3 actions
1. M5: Shaper control (select with S, cast range ring), death and respawn at the Hearth, charge steal, elimination rule.
2. M5: effect primitives as a registry (damageRadius, damageBuildingsRadius, knockback, terrainOp, convertRadius, statusApply panic, spawnEntity, areaOverTime, scar) and the 8 v1 spells as data with a cast command, preview, cancel and 1 s undo.
3. M5: placeholder VFX per primitive; one scenario per spell; spell shots; replay determinism with spells; Opus review.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

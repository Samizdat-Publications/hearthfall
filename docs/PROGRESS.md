# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M3 done (tag m3-done after Opus review fixes). Now M4: economy and construction (core sim already in, see below).
- M1 shipped: sfc32 rng streams, FNV hash parts, SoA entities, torus terrain with all ops + dirty cursor (dirtySince), tileable fbm generator (continents, islands, flat test maps) with connected Hearth sites, trees, wild people; Command registry (god-mode terrainOp is tribe -1 or godMode only); World step order, drowning, snapshot/restore; scenario runner + safe DSL (4 scenarios); golden replay with frozen pack (terrain_ops_continents). 66 unit tests. qa:fast now includes replays.
- M2 shipped: renderer (faceted chunks, water, curved world, wrap, sky, trees), camera rig, debug API, shot pipeline (pixel-exact baselines in fixedStep), VisionQA calibrated, browser replay determinism.
- M3 shipped: SoA movement columns, pathing (A* + component labels + budget, flow fields, spatial hash separation, route-progress stuck detection; ADR-004), move/stop/impulse commands, Controller hook + WanderBot, starting Shaper + 5 settlers per Hearth, unit and building placeholder layers with tribe tint and interpolation, selection (click, box, groups) + right-click move via bent-terrain picking, 7 pathing scenarios, soak (8 seeds x 10 min x 1000 units clean), bench (2000 units avg 3.3 ms, algorithmic p99 2.2 ms).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A2 + A2b done (11 buildings, 6 props, 6 units as GLB; sheets reports/latest/assets_*_sheet.png). Warden club sticks out in z (accepted for v1; review at M10). Spend $7.01 of $30.
- M4 in tree: economy.ts (settler jobs: chop, haul, flatten, build, move in; dwellings occupancy/upgrade/breeding; trees regrow and spread; mana income, split, round-robin charging, start charges), EconomyBot, commands placePlan/cancelPlan/setSplit/setAutoCharge/setPriorities. Breed seconds tuned 50/80/100: unharassed tribes reach about 45 to 60 at minute 10.
- Machine note: this PC often runs at 100 percent CPU (OneDrive sync); wall-clock timing is noisy, bench uses deterministic replay minima.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md.
- Subagents: project agents not registered in this session; use general-purpose with the agent file's rules and model pasted in.

## Next 3 actions
1. M4: economy scenarios (build a dwelling, breeding under cap, upgrade, mana math unit tests, tree regrowth), unharassed-growth gate check (every minute for 10 min) as a scenario or soak mode.
2. M4: HUD v1 in packages/ui (population/cap, mana income + split slider, spell charges with auto toggles), build placement input (B key ghost), DOM layout checks; dwelling and plan visuals.
3. M4 exit: rebaseline shots, Sonnet review, tag; A3 audio batch can start (SFX list from event types).

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

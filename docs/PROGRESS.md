# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M8 done (tag m8-done; Opus review FIX FIRST fixed, full qa PASS incl. e2e). Next: M9 worship and levels. M8 shipped: main menu over a turning planet, skirmish setup (map, size, seed, opponents, difficulty; generator failures show an error), pause, settings (render quality scale, stored volumes, rebindable keys), save and load in 3 localStorage slots (ADR-008: snapshot plus controller state, hash checked; a failed overwrite keeps the old save), victory and defeat screens, god mode `eliminate`; HUD v2 (spell ETA and waste warning, unit chips, objectives, notifications, minimap camera footprint and Shaper markers); `npm run e2e` gate at 1280x720 and 2560x1440 (same tick and hash after load). Fixes: frozen pack hashes kept (balance.skirmish optional), picking syncs the camera rig, groups and bookmarks reset per world, replaced render layers disposed. M7 done (tag m7-done).
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
1. M9 per ROADMAP: Shrine, Reliquary, Totem (worship mechanics as data plus primitives with tests), level data format (map, tribes, objectives, triggers, unlocks) with zod schema, campaign progression save.
2. M9: 3 teaching levels (raise land, shrine race, defend against a rush), each with a bot scenario proving its objective; then the exit ritual (Sonnet reviewer).
3. M10 asset and audio integration (A4), wiring the stored volume settings (BACKLOG 77); BACKLOG 64, 65, 72 to 81 after.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 2, turtle 2, unfinished 0, median 13.4 min (ok). Sneaky takes 8 of 12 wins (its pair win rates are over the 70 percent cap); 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64, 71).
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).

## State of the game (for Stewart)
(written when the run is done)

# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Full npm run qa PASS at e4183f0 (2026-10-09T21:15Z) after the battle bench perf fix (5.2 ms) and spells and spells2 re-approval for unit poses; soaks PASS: economy median 61, ai-idle 12/12, ai (sneaky 4, aggressive 1, turtle 1, 2 unfinished, median 14.3 min, 10 spell types), bots, difficulty.
- BACKLOG 6 DONE: difficulty levels: handicap command applies resourceMultiplier through the sim (eco.incomeMult), easy retuned (8 s reaction, 0.7x income), soak --mode difficulty gate (easy 0.13, hard 0.88, brutal 0.88 v normal); campaign level 2 rival now claims the shrine at 195 s (tests widened).
- BACKLOG 5 DONE (ADR-012): procedural unit animation in the vertex shader (aRig per vertex, instanceAnim pose per instance; walk, work, attack, shoot, cast, pray, panic, idle from sim state; toppling and drowning death ghosts), pose gallery shot, render bench 3.7 ms; rigged clips left as BACKLOG 5a.
- BACKLOG 4 DONE: command UX polish: box formations for player group moves (sim `move` formation arg, slots ranked melee front to Shaper back, balance.movement.formation), double-click type select, control group jump, spell preview counts, Backspace undo countdown; smoke, combat, spells, spells2 and levels re-approved (help line). Stewart's art note (10/09): tilt-shift miniature ref making-of/a1 style-ref-06 is a second reference (trees, huts, water, tilt-shift), BACKLOG 14a.
- BACKLOG 3 DONE: fog of war (sim VisionSystem, per tribe explored and visible grids, ADR-011), AI sees only what its tribe sees (brutal has mapHack), shader fog on every bent material, units and buildings hidden, minimap fog, reveal=1 and __game.setReveal. Soaks with fog: economy 61, ai-idle all 12, ai (sneaky 5, aggressive 2, turtle 1, median 15.2 min), bots PASS; smoke, spells2 and levels re-approved, spell and combat shots use reveal=1.
- Earlier BACKLOG DONE: 1 (all 16 spells, ADR-010), 0a (conifers, terraces, icons), 0c (stone), 7 (fair lodges, Chanter rework, AI hunts Hearthless Shaper), 2 (Shade and Shade Den; spend $9.15 of $30). Full npm run qa PASS at 6988e09 (16:50Z) and after BACKLOG 3 (about 18:24Z). Details in PROGRESS_LOG.
- Milestone: M11 done (tag m11-done; roadmap complete, now BACKLOG top down). M11 shipped: tribe rings under units and a larger Shaper, lighter trees, combat VFX readability (BACKLOG 57), boot screen, fatal panel with cause, frame loop failure and context loss handling, production build served statically (npm run serve, prod qa layer), State of the game section below. Opus review: 3 blockers fixed (frame error handling, static server containment, controls text), follow-ups in BACKLOG 96. M10 done (tag m10-done).
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
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md. Making-of page (Stewart's request): https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5, rebuild with `npm run making-of -- page` and republish to that URL after every backlog item (README steps).
- Subagents: project agents are registered again (milestone-reviewer, qa-runner, ...); call them by type.

## Next 3 actions
1. BACKLOG P1 8 (accessibility: colorblind-safe tribe palettes, UI scale, remappable keys, bark subtitles); then P2 from 9 with 14a (tilt-shift) early.
2. Full npm run qa at least every 4 hours (last PASS 21:15Z, next by about 01:15Z).
3. Re-run the full soak and shot sets every 3 backlog items (next after 6).

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 2, turtle 2, unfinished 0, median 13.4 min (ok). Sneaky takes 8 of 12 wins (its pair win rates are over the 70 percent cap); 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64, 71).
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).
- BACKLOG 7 (2026-10-09): triangle still 100 percent every pair; probes Warden 6 v Firecaller 10 0, Firecaller 6 v Chanter 10 100 (ranged hits break every chant, 3 s cooldown: needs a design change, 60 and 65), Chanter 6 v Warden 10 40 (was 100), mixed mirror 60. ai soak 12 x 30 min: sneaky 6, turtle 5, aggressive 1 (aggressive now the weakest), unfinished 0, median 17.6 min, 74 of 74 waves mixed. ai-idle: all 12 eliminated (aggressive 9 to 13 min, sneaky 11 to 12, turtle 13 to 13.5). Hold the Line (83) not tuned.

## State of the game (for Stewart)
Written at the M11 exit (2026-10-09). The run continues with docs/BACKLOG.md after this.

**What works**
- A complete skirmish loop on a small curved, wrapping planet: your Shaper and settlers start at a Hearth, settlers chop wood, build Dwellings and breed; followers produce mana; you train Wardens (melee), Firecallers (ranged) and Chanters (convert) from lodges; you win by eliminating the rival tribes and lose when your tribe is gone.
- Eight working spells: Bolt, Call, Hornets, Raise Land, Lightning, Flatten, Quake, Volcano. Terrain is fully deformable and water kills: sink land under an enemy village or raise a bridge across a channel.
- Opponent AI with three personalities (aggressive, sneaky, turtle) and four difficulty presets, all through the same commands a player uses.
- Campaign of three levels with objectives, triggers, hints and worship sites (Shrine, Reliquary, Totem): The Narrow Water, The Contested Shrine, Hold the Line. Progress is kept in the browser.
- Menus: main menu, skirmish setup (map, size, seed, difficulty), settings (quality, volumes, key rebinding), pause, save and load, end screen with stats.
- Look: retro pixel render pass (palette, dither, golden-hour light, firelight), real 3D models for units, buildings and trees with tribe tint and tribe rings under units, spell and combat VFX, stone and wood HUD with icons, minimap.
- Audio: sound effects, Shaper voice lines and adaptive music (calm, tension, battle) with volume sliders.
- Determinism: every match replays bit-identically from its command log (Node and Chromium agree); golden replays guard it.
- Production build served as plain static files; a boot screen while loading and a clear error panel if WebGL 2 is missing.
- QA: `npm run qa` runs typecheck, guards, about 200 unit tests, scenarios, golden replays, sim and render benchmarks (2000 units at 1440p in budget), screenshot baselines, browser end-to-end checks and the production build check.

**How to play**
```
cd C:\Users\stewa\Documents\Claude\Hearthfall
npm run build
npm run serve
```
Then open http://127.0.0.1:5182/ in Chrome or Edge. Pick Skirmish (try continents, normal) or Campaign.
- Mouse: drag to box-select, click a unit or building to select it, right click to move (on your tower: garrison), wheel to zoom, Q and E to rotate.
- Keys: A attack-move, R retreat, G garrison, S select the Shaper, D place a Dwelling, T a Watchtower, M map view, H help, P or Esc pause menu (Esc first cancels targeting or a selection). Spells: Z, X, C, V, B, N for the first six, Shift+M and Shift+N for the next two, and Shift+Z X C V B J K L for the eight spells taught at the Reliquaries between the villages (then click a target); Backspace undoes a cast during its short undo window. Most keys can be rebound in Settings.
- The top-left slider splits followers between praying for mana (Spells) and training troops (Training). Reach 10 followers to unlock the Watchtower and Warden Lodge, more for the other lodges.
- Tip: keep the Shaper safe. If she dies she respawns at the Hearth after a delay, and her killer can steal spell charges.

**Known issues**
- Balance: the sneaky AI wins most AI versus AI matches, and the counter triangle is lopsided (each counter wins every time instead of about 70 percent). Hold the Line is beatable by doing nothing at low raid counts. See "Balance gaps" above and BACKLOG 64, 65, 83.
- Eight more spells (Veil, Ward, Beguile, Whirlwind, Mire, Erode, Firerain, Wraith), the Shade, boats and the Skyloft exist only as data or placeholders; they are not playable yet.
- Units do not animate (they glide); a few models and sounds are placeholders (docs/ASSETS.md A4 list).
- No fog of war: you and the AI see the whole map.
- Tribe rings can clip into steep slopes; text in menus is small at 1280x720.

**Top 5 next items**
1. Finish the eight remaining spells with a scenario and a shot each (BACKLOG 1).
2. Balance pass on AI personalities and the counter triangle, with Hold the Line tuned so idling loses (BACKLOG 7 with 64, 65, 83).
3. Fog of war and scouting, with an AI that respects it (BACKLOG 3).
4. Animated units via vertex animation textures (BACKLOG 5).
5. Look v2 follow-ups: pine forest belts, terraced cliffs, a volcano smoke column (BACKLOG 0a).

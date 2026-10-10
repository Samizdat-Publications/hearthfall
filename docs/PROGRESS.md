# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 2 started: 2026-10-10T00:25:00Z (24 h, ends 2026-10-11T00:25:00Z or when STOP exists). Plan: BACKLOG 14a look v3, polish, balance, rules and victory variants, campaign, boats and Skyloft, Forge, map editor (CLAUDE.md "Stretch 2").
- S2 backlog S items DONE (qa:fast green each; scenarios after sim edits; e2e after 79, 35, 50, 78; goldens unchanged): 79 end screen stats survive a load, 44 treeVersion on chop test, 72 flow progress kept away from edits, 35 self-contained saves (`World.fromSnapshot`, origin check), 50 controller specs in saves and replays, 61 chanter reach inset data, 69 AI shared tuning data, 30 formula strings retired, 31 terrainOp nested union, 78 data/ui.json outside the pack hash (ADR-022, base pack hash changed once). Then 34 terrain and generator literals (terrain.json gen and ops), 66 opponent_skirmish golden, 67 soak AI effect metrics, 68 AI bridge scenario, 59 chase give-up soak gate, 88 level worship delay, 95 vfx colors in style.json (38 superseded), 41 camera rig and tree size in style.json render.
- S2 backlog S items DONE after s2h 13: 32 shot coverage sampled on the game view only, 33 and 43 VisionQA calibration (30 shots, held-out half), 51 economy bench case, 52 hud_narrow shot, 58 long front war soak (`war-long` in the nightly), 26 asset re-generation tool (`tools/assets/regen.py`). Every S item is now done or out of scope (29).
- S2 backlog S items DONE after s2h 11: 42 render unit tests, 74 menu DOM checks in scrolling panels, 47 incremental pathfinder refresh (about 0.4 ms per edit vs 2.2 ms full at 256), 46 host-only peer command and debug gates, 24/25 `npm run soak:nightly` plus `npm run trends` (history in reports/history/). The first 64-seed nightly found seed 1047: births into a sunken dwelling's deep water, fixed (births, graduations, respawns wait for a dry door; last drowning pass per tick), scenario eco_sunken_dwelling_does_not_breed_into_sea. Full npm run qa PASS at a1cd54d (s2h 13).
- S2 backlog DONE after the reserve: 49 cancel plans without wood (HUD Cancel plan, Delete), 14b rain slows units (skirmish Weather row), 27 and 28 guard self-tests and stricter determinism guard, 18 mod packs (ADR-021, `npm run mods`, `?mods=`). Save/load drift fixed at 5b87037 (snapshots carry pending terrain edits and flow keys; the e2e load check had failed now and then).
- S2 reserve DONE: BACKLOG 19 replay viewer (ADR-018), 21 achievements and records (ADR-019), 22 localization scaffold (ADR-020), 48 economy robustness (islands 128 and continents 192, 4 tribes, 20 min, 6/6 clean each; four economy fixes). Full npm run qa PASS at 39e154e (s2h 10.5); soaks economy, ai, bots PASS. Making-of v17.
- S2 block J DONE (full npm run qa PASS at db865c4 plus the smoke re-approval; soaks ai, ai-idle PASS): 92 SFX cues and 98 vehicle follow-ups DONE (AI ferries to off-home Reliquaries). Full qa caught two regressions qa:fast misses (it runs only fast-tagged scenarios): BACKLOG 73 stalled workers at land goals (level_the_forge), BACKLOG 94 ring fit cost 4 ms a frame (now cached); after sim changes run the full scenarios layer too. robustness 97, 55, 70, 73, 62, 63 DONE (ai soak failed orders 882 to 71, ai-idle about 145 to 35); tests 75, 76, 82, 87, 93, 96 DONE (96 leaves the bench re-baseline); map view 37/40 (orthographic, framed, grid), 94 (rings follow slopes), 80 (minimap footprint clipped) DONE; the e2e reload check caught and fixed a BACKLOG 93 geometry leak. Making-of v13.
- S2 block I DONE (map editor, BACKLOG 12): Main menu Map editor over a live preview planet: land, sea and hill paint, Hearths per tribe, trees, rocks, Shrines, Reliquaries, erase, undo; rival AI and difficulty, goal presets incl. Hold the Reliquaries and King of the Hill, time limit, Forge; live validateLevel, autosave to browser storage, Download level JSON, Playtest as a level session (Quit returns to the editor, no campaign progress). editor.ts unit tests, e2e flow, menu_editor shot.
- S2 block H DONE (campaign part 2) at cf97d79: levels 8 to 13 (Across the Strait, The Sky Road, The Twin Reliquaries, The Hill, The Forge, Sea of Fires), level `rules` with a `victory` objective (a rival winning loses as outplayed) and level `forge`; bot or scripted win and idle loss scenarios each. Sonnet review: no blockers; follow-ups done (rules need a site, HUD victory line names conquest, Sky Road text, Twin Reliquaries 25 min limit, moat shot assert, probe documented).
- S2 block G DONE (Forge mode, ADR-017) at 4b739e0: optional 2 min pre-match Forge, AI forges by personality, setup row, HUD panel, scenarios, golden, e2e, forge shots.
- S2 block F DONE (vehicles, ADR-016) at cbac714: boats and balloons, Boathouse and Skyloft, water and air nav, AI ferries; Opus review blockers fixed (follow-ups BACKLOG 98). Full npm run qa PASS. Assets: stretch $2.33 of $8, total about $11.48 of $30.
- S2 blocks A to E DONE: A look v3 (ADR-013: tilt-shift, painted water, clump trees, thatched huts, lighting presets, rain), B polish (45, 56, 81, 36), C balance (65 counter triangle, 64/71 AI spells and turtle, 83 level troop caps), D victory variants in the sim (ADR-014), E campaign part 1 (ADR-015: learned spells, route map, levels 4 to 7). Soak settings: ai-idle --minutes 25, difficulty --minutes 20 (defaults fail).
- Run 1 done 2026-10-09T23:58Z (about 26.5 h): m0-done to m11-done tagged, every P1 done or cut (5a, see Cuts); full npm run qa PASS at 5b2587a; its sentinel line is in PROGRESS_LOG.
- Run started: 2026-10-08T21:25:00Z
- Earlier work: BACKLOG 0a to 8 and M0 to M11 (details in PROGRESS_LOG and ARCHITECTURE).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Machine: often at 100 percent CPU (OneDrive sync; another project's simulations and GPU benchmarks with their own headless browsers, leave them alone). Wall-clock timing is noisy; bench uses deterministic replay minima; full qa needs several reruns.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md. Making-of page (Stewart's request): https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5, rebuild with `npm run making-of -- page` and republish to that URL after every backlog item (README steps).

## Next 3 actions
1. BACKLOG 23 done (not adopted, VISIONQA section 7). Next: full npm run qa (due), then parking lot (photo mode, tribe traits), then remaining BACKLOG.
2. Full npm run qa every 4 h (last PASS at a1cd54d around s2h 13, next due by s2h 17); soaks after sim or AI changes (`npm run soak:nightly`); full scenarios layer after any sim change.
3. At s2h >= 23 or STOP: end ritual (full qa, soaks, State of the game plus First human playtest, PROGRESS_LOG, tag s2-done, making-of, STRETCH 2 DONE).

## Blocked
(none)

## Cuts and deferrals
- BACKLOG 5a (rigged clips, P1 but conditional: "only if close-zoom quality needs it"). Cut 10/09/2026: at the closest camera zoom with the retro pass (pixelScale 3) units are about 60 to 90 screen px tall and the procedural poses (walk, work, attack, shoot, cast, pray, panic, idle) read clearly in the combat anim_gallery shot, so the condition is not met; Meshy rigging would also spend asset budget for little visible gain. Revisit if a close-up or portrait camera ships (ADR-012 fallback stays valid: same instanceAnim attribute).

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 2, turtle 2, unfinished 0, median 13.4 min (ok). Sneaky takes 8 of 12 wins (its pair win rates are over the 70 percent cap); 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64, 71).
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).
- BACKLOG 7 (2026-10-09): triangle still 100 percent every pair; probes Warden 6 v Firecaller 10 0, Firecaller 6 v Chanter 10 100 (ranged hits break every chant, 3 s cooldown: needs a design change, 60 and 65), Chanter 6 v Warden 10 40 (was 100), mixed mirror 60. ai soak 12 x 30 min: sneaky 6, turtle 5, aggressive 1 (aggressive now the weakest), unfinished 0, median 17.6 min, 74 of 74 waves mixed. ai-idle: all 12 eliminated (aggressive 9 to 13 min, sneaky 11 to 12, turtle 13 to 13.5). Hold the Line (83) not tuned.

## State of the game (for Stewart)
Written at the M11 exit and rewritten when every P1 backlog item was done or cut (2026-10-09, about 25 h into the run). The game keeps growing from docs/BACKLOG.md P2 onward.

**What works**
- A complete skirmish loop on a small curved, wrapping planet: your Shaper and settlers start at a Hearth, settlers chop wood and quarry stone, build Dwellings and breed; followers produce mana; you train Wardens (melee), Firecallers (ranged), Chanters (convert) and Shades (disguise and sabotage) from lodges; you win by eliminating the rival tribes and lose when your tribe is gone.
- All 16 spells: Bolt, Call, Hornets, Raise Land, Lightning, Flatten, Quake, Volcano, plus Veil, Ward, Beguile, Whirlwind, Mire, Erode, Firerain and Wraith (the last eight taught at Reliquaries). Terrain is fully deformable and water kills.
- Fog of war with scouting and a fogged minimap; the AI sees only what its tribe sees (brutal cheats on purpose).
- Opponent AI with three personalities (aggressive, sneaky, turtle) and four difficulty levels, verified by soaks against a normal opponent: easy wins about 13 percent, hard and brutal about 88 percent. The brutal income bonus and the easy penalty go through the simulation, so they show in replays.
- Command polish: box formations for group moves, double-click to select a type, control groups with jump, spell previews with counts, and Backspace undo of a cast.
- Units animate (walk, work, attack, shoot, cast, pray, panic, topple and drown) through procedural vertex animation of the 3D models.
- Campaign of three levels with objectives, triggers, hints and worship sites. Progress is kept in the browser.
- Menus: main menu, skirmish setup (map, size, seed, difficulty), settings, pause, save and load, end screen with stats.
- Accessibility: a colorblind-safe tribe palette (checked by simulating the three common color blindness types), UI scale 80 to 150 percent (the HUD shrinks itself if the window is too small), subtitles for the Shaper's voice lines, rebindable keys.
- Look: retro pixel render pass (palette, dither, golden-hour light, firelight), conifer groves and terraced cliffs, 3D models with tribe tint and rings, spell and combat VFX, stone and wood HUD with icons.
- Audio: sound effects, Shaper voice lines and adaptive music (calm, tension, battle) with volume sliders.
- Determinism: every match replays bit-identically from its command log (Node and Chromium agree); golden replays guard it.
- QA: `npm run qa` (resumable, rerun until PASS) runs typecheck, guards, 272 unit tests, 52 scenarios, golden replays, sim and render benchmarks, four screenshot sets, VisionQA, browser end-to-end checks at 1280x720 and 2560x1440, and the production build check. Last full PASS at 5b2587a.
- Making-of page with captioned screenshots for every milestone and backlog item: https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5

**How to play**
```
cd C:\Users\stewa\Documents\Claude\Hearthfall
npm run build
npm run serve
```
Then open http://127.0.0.1:5182/ in Chrome or Edge. Pick Skirmish (try continents, normal) or Campaign.
- Mouse: drag to box-select (double-click selects every unit of that type), click a unit or building to select it, right click to move (groups form up; on your tower: garrison), wheel to zoom, Q and E to rotate.
- Keys: A attack-move, R retreat, G garrison, S select the Shaper, D place a Dwelling, T a Watchtower, M map view, H help, P or Esc pause menu (Esc first cancels targeting or a selection), Ctrl+0-9 set a group, 0-9 select it (twice to jump). Spells: Z, X, C, V, B, N for the first six, Shift+M and Shift+N for the next two, and Shift+Z X C V B J K L for the eight Reliquary spells (then click a target); Backspace undoes a cast during its short undo window. Keys, tribe colors, UI scale and subtitles are in Settings.
- The top-left slider splits followers between praying for mana (Spells) and training troops (Training). Reach 10 followers to unlock the Watchtower and Warden Lodge, more for the other lodges.
- Tip: keep the Shaper safe. If she dies she respawns at the Hearth after a delay, and her killer can steal spell charges.

**Known issues**
- Balance: the counter triangle is still lopsided (each counter wins every time instead of about 70 percent; ranged hits break every chant) and sneaky or turtle win most AI versus AI matches. See "Balance gaps" above and BACKLOG 64, 65, 83.
- Boats and the Skyloft exist only as data (BACKLOG 10); the campaign has three of the 25 planned levels (BACKLOG 9).
- Rigged animation clips were cut (BACKLOG 5a): the procedural poses read well at every camera zoom the game has.
- The PC is often fully loaded by other work, so benchmark and screenshot timing is noisy; the full qa run needs several reruns to finish.

**Top 5 next items**
1. Tilt-shift miniature look from your second reference, tried before and after the pixel pass (BACKLOG 14a).
2. Campaign: ten more levels, Reliquary progression and a level select map (BACKLOG 9).
3. Counter triangle redesign so each counter wins about 70 percent, starting with chants and ranged hits (BACKLOG 65).
4. Boats, Boathouse and the Skyloft with pathing over water (BACKLOG 10).
5. Forge mode and victory variants (BACKLOG 11, 13).

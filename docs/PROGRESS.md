# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 2 started: 2026-10-10T00:25:00Z (24 h, ends 2026-10-11T00:25:00Z or when STOP exists). Plan: BACKLOG 14a look v3, polish, balance, rules and victory variants, campaign, boats and Skyloft, Forge, map editor (CLAUDE.md "Stretch 2").
- S2 block E DONE (campaign part 1, ADR-015) at 376ee1d: BACKLOG 9 part (spells taught at a Reliquary carry as campaign `learned`), route map level select, levels 4 to 7 (Old Reliquary, Stone Totem, Many Mouths, Two Fires; bot win and idle loss scenarios each, levels tag 14), 84 golden replay with an embedded level, 85 e2e real level loss and campaign complete, 86 same-tick win beats loss, 89 prayer ring and HUD percent, no false mana warning. Making-of v9.
- S2 block D DONE (rules, ADR-014) at 460fe89: BACKLOG 13 victory variants in the sim (RulesRuntime): conquest, Hold the Reliquaries (120 s), King of the Hill (240 s), Last Stand (20 min) in balance.victory; skirmish setup picker, HUD progress on the rivals line, AI contest action, soak --rules (12 seeds: 7 by hold, 11 by hill, 2 by last stand), 4 rules scenarios, e2e variant check. Old replays and saves keep their hashes (rules hashed only when set). Sim tickHz is 20.
- S2 block C DONE (balance): 65 chant breakDamage 600 plus rooted against ranged knock, Warden and Chanter retune (triangle soak 6 v 10 probes 70, 60, 80 percent); 64/71 AI spells by value, turtle towers after half its economy (towerFromPopShare), turtle first wave minute 9 (24-seed ai soak aggressive 9, turtle 8, sneaky 6); 83 level maxTroops, Hold the Line rival cap 8 and second wave 6 (idle loses, turtle defender wins). Soaks ai-idle 12/12, difficulty PASS (easy 0, hard 0.44, brutal 0.75), bots PASS. Playtest-analyst not needed (targets met by probes). Soak minutes: ai-idle 25, difficulty 20 (defaults fail).
- S2 block B DONE (polish): 45 order failed toast and red marker, 56 troop panel stance icons, build cost chips, rally flag, 81 menu title art, larger menu text, menus shot set (shot-menus qa layer), 36 quake lead-in (terrainOp leadInSeconds, FX.leadIn, edge, dust, warning toast). Full npm run qa PASS at 4c16b37 (about 03:35Z). Soak ai clean after 81 and 36.
- S2 block A DONE (look v3, ADR-013): 14a-1 tilt-shift post on by default, 14a-2 painted water, 14a-3 clumped trees by altitude, 14a-4 v3 thatched dwellings (alias) and snow and strata bands, 14 lighting presets (day, golden, evening) and visual rain. All shot sets re-approved, look set (12) in npm run qa, bench:render baseline re-saved at 3.7 ms (busy PC noise). Sonnet review: no blocker; minor fixes done, rest in BACKLOG 14a (14c).
- Run 1 done 2026-10-09T23:58Z (about 26.5 h): m0-done to m11-done tagged, every P1 done or cut (5a, see Cuts); full npm run qa PASS at 5b2587a; its sentinel line is in PROGRESS_LOG.
- Run started: 2026-10-08T21:25:00Z
- Earlier BACKLOG DONE: 8 (accessibility), 6 (difficulty levels), 4 (command UX, formations), 3 (fog of war, ADR-011), 5 (procedural unit animation, ADR-012), 1 (all 16 spells, ADR-010), 0a (conifers, terraces, icons), 0c (stone), 7 (fair lodges, Chanter rework, AI hunts Hearthless Shaper), 2 (Shade and Shade Den; spend $9.15 of $30). Full npm run qa PASS at 6988e09 (16:50Z) and after BACKLOG 3 (about 18:24Z). Details in PROGRESS_LOG.
- Milestone: M11 done (tag m11-done; roadmap complete, now BACKLOG top down). M11 shipped: tribe rings under units and a larger Shaper, lighter trees, combat VFX readability (BACKLOG 57), boot screen, fatal panel with cause, frame loop failure and context loss handling, production build served statically (npm run serve, prod qa layer), State of the game section below. Opus review: 3 blockers fixed (frame error handling, static server containment, controls text), follow-ups in BACKLOG 96. M10 done (tag m10-done).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A0 to A3 done (buildings, props, units as GLB; 21 SFX, Shaper barks, 3 music stems, 7 VFX textures, 27 icons; indexes in assets/*/index.json). Spend $8.21 of $30. A4 (integration) is M10.
- Art direction v2 (ADR-005 + addendum): target = Stewart's pick, making-of/a1 retro-candidate-1 (dense village on a planet in space, terraced cliffs, foamy sea, stone-framed HUD); technique = candidate 3. Retro render pass v1 is ON (style.json render: pixelScale 3, 20-level palette, Bayer dither, terrain pixel noise, Hearth firelight, dusk light, stone and wood HUD). Baselines re-approved.
- Machine: often at 100 percent CPU (OneDrive sync; another project's simulations and GPU benchmarks with their own headless browsers, leave them alone). Wall-clock timing is noisy; bench uses deterministic replay minima; full qa needs several reruns.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md. Making-of page (Stewart's request): https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5, rebuild with `npm run making-of -- page` and republish to that URL after every backlog item (README steps).
- Subagents: project agents are registered again (milestone-reviewer, qa-runner, ...); call them by type.
- M1 to M5 shipped details: PROGRESS_LOG (and ARCHITECTURE).

## Next 3 actions
1. Block E exit: full npm run qa until PASS (levels and menus shots already re-approved).
2. S2 block F vehicles (ADR-016): water nav layer, boat (carries 5) with embark and disembark commands, Boathouse, AI ferries on islands, Skyloft and balloon, cue SFX (92). Opus milestone-reviewer after D and F.
3. Then G Forge, H campaign levels 8 to 13, I map editor, J robustness.

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

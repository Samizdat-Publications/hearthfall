# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 3 started: 2026-10-10T21:45:00Z (Stewart after playing levels 1 to 3: "legitimately good"; wants levels far more complex as the campaign ramps: more buildings, resources, spells, objectives, plus the handoff items). Quota is tight (62 percent used, resets Thursday): Haiku for QA digging and docs, Sonnet for soaks and level drafts, main session for sim code. No run sentinel or STATUS line this stretch.
- S3 DONE: prayer chains (ed566ba): dormant sites, awaken and reveal rewards, validation, sunk render.
- S3 DONE: AI uses the unused spells: spell value counts traps, sinking land, storms and building damage, building targets value the whole village; prefs gain call, volcano, erode, mire. ai soak 16 x 20: call 51, mire 4, volcano 1, erode 1 (were 0); wins aggressive 2, sneaky 4, turtle 4, unfinished 6.
Stretch 2 started: 2026-10-10T00:25:00Z (24 h, ends 2026-10-11T00:25:00Z or when STOP exists). Plan: BACKLOG 14a look v3, polish, balance, rules and victory variants, campaign, boats and Skyloft, Forge, map editor (CLAUDE.md "Stretch 2").
- S2 backlog S items DONE (qa:fast green each; scenarios after sim edits; e2e after 79, 35, 50, 78; goldens unchanged): 79 end screen stats survive a load, 44 treeVersion on chop test, 72 flow progress kept away from edits, 35 self-contained saves (`World.fromSnapshot`, origin check), 50 controller specs in saves and replays, 61 chanter reach inset data, 69 AI shared tuning data, 30 formula strings retired, 31 terrainOp nested union, 78 data/ui.json outside the pack hash (ADR-022, base pack hash changed once). Then 34 terrain and generator literals (terrain.json gen and ops), 66 opponent_skirmish golden, 67 soak AI effect metrics, 68 AI bridge scenario, 59 chase give-up soak gate, 88 level worship delay, 95 vfx colors in style.json (38 superseded), 41 camera rig and tree size in style.json render.
- Stretch 2 end ritual (queue empty, plan allows it before s2h 23): full npm run qa PASS at 5e11f16 (s2h 18.7); soak:nightly and bots PASS; State of the game and First human playtest rewritten; tag s2-done.
- S2 playtest pass after s2h 17.7: soak:nightly PASS (ai, ai-idle, difficulty, economy, war, war-long); first match tips (six steps under the spell bar, a setting that turns itself off), How to play page (main and pause menus). Full npm run qa PASS at 67ca873 (s2h 18.5).
- S2 after s2h 13.8: 23 move picker evaluated and not adopted (diversity 0.32 vs 0.368, VISIONQA section 7), photo mode, tribe traits, spell combo hints; 20 WebGPU cut. Full npm run qa PASS at f4f0c49.
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
1. Handoff: counter tuning at equal numbers toward 75 percent (playtest-analyst, data only).
2. Level primitives for complex levels: objectives destroy (tagged building), reach (area), and multi-site worship; triggers on area entered, site awakened, followers; guarded sites (wild or neutral camps).
3. Campaign build-out: complexity pass on levels 6 to 13, then levels 14 to 25 built on chains, multi-stage objectives and 3 to 4 tribes; new buildings, a resource and new spells as the curve needs them (assets via asset-producer within budget).

## Blocked
(none)

## Cuts and deferrals
- BACKLOG 20 (WebGPU renderer, P2) cut in stretch 2 (10/10/2026): the curved planet is a GLSL `onBeforeCompile` injection on every material (curve.ts) and the retro, terrain, weather and renderer passes are custom ShaderMaterials (5 files); three r186 WebGPURenderer supports neither, so the port is a TSL rewrite of the whole look, and its QA would be headed only. The WebGL2 path holds its budgets (bench:render median about 4 ms CPU at 2560x1440). Revisit only if a GPU bound shows up.
- BACKLOG 5a (rigged clips, P1 but conditional: "only if close-zoom quality needs it"). Cut 10/09/2026: at the closest camera zoom with the retro pass (pixelScale 3) units are about 60 to 90 screen px tall and the procedural poses (walk, work, attack, shoot, cast, pray, panic, idle) read clearly in the combat anim_gallery shot, so the condition is not met; Meshy rigging would also spend asset budget for little visible gain. Revisit if a close-up or portrait camera ships (ADR-012 fallback stays valid: same instanceAnim attribute).

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 2, turtle 2, unfinished 0, median 13.4 min (ok). Sneaky takes 8 of 12 wins (its pair win rates are over the 70 percent cap); 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64, 71).
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).
- BACKLOG 7 (2026-10-09): triangle still 100 percent every pair; probes Warden 6 v Firecaller 10 0, Firecaller 6 v Chanter 10 100 (ranged hits break every chant, 3 s cooldown: needs a design change, 60 and 65), Chanter 6 v Warden 10 40 (was 100), mixed mirror 60. ai soak 12 x 30 min: sneaky 6, turtle 5, aggressive 1 (aggressive now the weakest), unfinished 0, median 17.6 min, 74 of 74 waves mixed. ai-idle: all 12 eliminated (aggressive 9 to 13 min, sneaky 11 to 12, turtle 13 to 13.5). Hold the Line (83) not tuned.
- Stretch 2 end (2026-10-10): BACKLOG 65 met for outnumbered probes (Warden 6 v Firecaller 10 70, Firecaller 6 v Chanter 10 60, Chanter 6 v Warden 10 80, mixed mirror 40); equal-number pairs still 100 percent. ai soak 64 x 20 min: aggressive 16, sneaky 15, turtle 13, unfinished 20 (the M7 sneaky skew is gone).

## State of the game (for Stewart)
Rewritten at the end of stretch 2 (2026-10-11, about 47 h after the first run started). Run 1 built the whole game (m0 to m11); stretch 2 added the look, the modes and the polish listed below. BACKLOG is done except the four items that need you (15 online play, 16 desktop build, 17 public deploy, 29 path cleanup before any push).

**What works**
- The core god game: a small curved, wrapping planet where your Shaper leads a tribe from a Hearth. Settlers gather wood and stone, build Dwellings and breed; followers pray for mana or train Wardens (melee), Firecallers (ranged), Chanters (convert) and Shades (disguise and sabotage). Terrain is fully deformable and water kills.
- All 16 spells, eight of them taught at Reliquaries. Fog of war, a fogged minimap and an orthographic map view (M).
- Opponent AI with three personalities and four difficulties. Nightly soak, 64 matches of 20 minutes: wins aggressive 16, sneaky 15, turtle 13 (balanced; run 1 had sneaky at 8 of 12). Against normal: easy never wins, hard wins 4 of the 6 decided matches, brutal wins all 6 decided.
- New in stretch 2:
  - Look v3, the "miniature diorama": tilt-shift focus, painted shallow water with foam lines, round clump trees, thatched huts, snow caps, lighting presets (day, golden, evening) and rain. All in Settings.
  - Victory variants decided inside the simulation, so they replay exactly: Conquest, Hold the Reliquaries, King of the Hill and Last Stand.
  - Forge mode: an optional 2 minute pre-match phase to reshape the land around your Hearth. The AI forges by personality: the turtle digs a moat.
  - Boats and the Boathouse, balloons and the Skyloft. Right click your boat to board it, and right click a shore to unload. The AI ferries its waves across water.
  - Campaign of 13 levels on a route map. Each level teaches one idea, and spells learned at Reliquaries carry forward.
  - Map editor (main menu): paint land, sea and hills, place Hearths, trees, shrines and Reliquaries, set the goal, then playtest or download the level.
  - Tribe traits (skirmish option), weather, photo mode (F), spell combo tips, and first match tips with a How to play page.
  - Replays with a timeline bar, records and achievements, mod packs and a localization scaffold.
- Counter triangle redesigned (BACKLOG 65): chants break on accumulated damage, not on any hit. Outnumbered 6 against 10, each counter now wins 60 to 80 percent: Warden over Firecaller 70, Firecaller over Chanter 60, Chanter over Warden 80. At equal numbers a counter still wins every time, which is intended.
- Determinism and QA:
  - Every match replays bit for bit, and 8 golden replays guard it.
  - `npm run qa` covers typecheck, 7 code guards, 435 unit tests, 90 scenarios, golden replays in Node and Chromium, sim and render benches, 9 screenshot sets with VisionQA, end-to-end browser checks at 1280x720 and 2560x1440, and the production build.
  - `npm run soak:nightly` runs about 130 headless AI matches.
  - Last full PASS at 5e11f16 (s2h 18.7).
- Making-of page with every stage of the build: https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5

**Known issues**
- Counters at equal numbers win 100 percent. Mixed armies decide real games, so it plays fine, but the numbers are sharper than DESIGN asks.
- About a third of AI versus AI matches are still undecided at 20 minutes. Human games should end sooner, because people attack.
- In 64 soak matches the AI never cast Volcano or Call and rarely Mire, Erode or Firerain.
- Online multiplayer, a desktop exe and a public URL are not built (BACKLOG 15, 16, 17).
- The PC is often fully loaded by other work, so a full qa run needs several reruns to finish. That is a test timing artifact, not a game bug.

**Top 5 next items**
1. Your playtest notes. They beat any soak.
2. Static web deploy so the game opens from a link (BACKLOG 17; needs your OK and a Cloudflare account choice).
3. Teach the AI the unused spells (Volcano, Mire, Erode combos) and rival boat raids.
4. Counter tuning at equal numbers (aim for about 75 percent) and more campaign levels toward the 25 in DESIGN.
5. Online co-op against the AI (BACKLOG 15).

## First human playtest
**Ready: yes.**
- The whole loop works from the main menu to the end screen in Chrome and Edge, and saves, loads and replays work.
- A new player gets a How to play page, six first match tips and a campaign that teaches one idea per level.
- Full qa passes and about 130 headless AI matches run clean: no stuck units, no crashes, no drift.
- What it cannot tell you is whether it is fun, how fast a real match feels, and whether the spells feel strong enough. That is what this playtest is for.

**Start it**
```
cd C:\Users\stewa\Documents\Claude\Hearthfall
npm run build
npm run serve
```
Then open http://127.0.0.1:5182/ in Chrome or Edge, and press Ctrl+C in that window when you are done. A full screen window at 1920x1080 or larger looks best. Interface size is in Settings.

**How to play (the short version)**
- **Goal:** destroy every rival Hearth (or meet the variant goal shown at the top right) and keep your own Hearth and Shaper alive. Land that sinks drowns whoever stands on it.
- **Grow:** settlers gather on their own. Press D and click near the Hearth for Dwellings, which breed followers. At 10 followers you unlock the Watchtower (T) and the Warden Lodge.
- **Mana:** the slider at the top left splits followers between praying (mana) and training (troops).
- **Spells:** press Z, X, C, V, B or N (Shift plus a letter for the later ones), then click a target. Right click a spell to auto-charge it, and Backspace takes back a cast that has not landed.
- **Army:** drag to select (double-click selects every unit of that type). Right click moves. A then click attack-moves, R retreats, G garrisons. Ctrl plus a digit saves a group.
- **Camera:** wheel to zoom, Q and E to rotate, M for the map, click the minimap to jump. P or Esc pauses, H lists every key, and F is photo mode (Enter saves a PNG).

**What to try, in this order (about 2 hours)**
1. **Main menu > How to play,** then **Campaign** levels 1 to 3 (about 30 min). Do the hints make sense? Is Raise Land fun?
2. **Skirmish,** continents, one opponent on easy, default options, with the first match tips on (about 20 min).
   - Note anything confusing: the HUD, what you can build, why a spell will not cast.
   - Once you find the rival village, try to drown it with Erode or Quake.
3. **Skirmish on normal** against the aggressive AI. Does its first attack come too early, too late, or about right?
4. **One mode at a time:**
   - Forge on, with King of the Hill.
   - The islands map with boats.
   - The rain weather.
   - Each tribe trait.
5. **Map editor:** make a small map, press Playtest, then quit back to the editor.
6. **Settings:** compare miniature focus on and off and the three lighting presets. Is the tilt-shift look what you wanted from your reference?
7. **After a match:** Records, then Main menu > Last replay. Scrub the timeline.

**What to tell me afterwards** (a few lines each is plenty)
- The best moment and the most frustrating moment.
- Anything you could not figure out without asking.
- Speed: matches too slow or too fast? Mana too scarce?
- Which spells felt weak or useless.
- Any visual bug: grab it with photo mode (F, then Enter), or note the seed and the minute.
- Frame rate on your laptop: smooth, or does it stutter when zoomed out?

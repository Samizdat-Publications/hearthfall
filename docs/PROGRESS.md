# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 4 started: 2026-10-11T16:34:00Z (Stewart: work the remaining queue and backlog autonomously for 24 h, workflows for the full playtest, then plan the next leg and start it). Commit prefix S4. Stretch 3 done: tag s3-done at 146a467 (summary in PROGRESS_LOG).
- S4 DONE: stage-relative goals (0cb646a), raid pray and worship under threat (95b6a65), AI worship across water by boat or balloon (02d5a68), siteLost stage gate (b359244).
- S4 DONE Leg 5 LAN play (BACKLOG 15): L5-A to L5-F plus the campaign together (7c0f1df). Internet play waits for Stewart (public relay, deploy).
- S4 DONE BACKLOG 9: 25 levels (22 Cloud Isles, 23 Stolen Stones, 24 Ember Crown); campaign rerun workflow over all 25 (bd7fb5e), every level scenario green.
- S4 Leg 6 "ready for people" (ROADMAP): L6-A LAN replays and L6-D playtest kit (46c4690), L6-B look follow-ups (d9a2209), L6-C level engine gaps (aec6dd9 flow field hang, 8b9c38d, 3991e46, c95fe13) DONE. Now: campaign fix round workflow wf_215155fe-3ad over 11 levels (critic follow-ups 1 to 10). Left: L6-E balance.
- Stretch 2 (2026-10-10, 24 h) DONE: tag s2-done, full npm run qa PASS at 5e11f16. Run 1 done 2026-10-09T23:58Z: m0-done to m11-done tagged. Run started: 2026-10-08T21:25:00Z.
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Machine: often at 100 percent CPU (other projects' sims and benchmarks, leave them alone). Wall-clock timing is noisy, and bench readings of 6 to 7 ms while agents run scenarios are load, not regressions (idle: 3.7 ms).
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of page: https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5 (version 33), rebuild with `npm run making-of -- page` and republish after every backlog item (README steps).

## Next 3 actions
1. Campaign fix round (running, wf_215155fe-3ad): review its diff, delete stray zz_probe files, scenarios --tag levels, qa:fast, commit; rerun the curve numbers into Balance gaps.
2. L6-E balance (equal probe jitter, triangle retune; playtest-analyst passes), full npm run qa.
3. Making-of republish, PROGRESS_LOG entry, then plan Leg 7 (BACKLOG top down) and start it.

## Blocked
(none)

## Cuts and deferrals
- L6-C deferred (S4, 2026-10-11): "an attack wave leaves a vehicle home for worship trips" and "destroyTarget off the home landmass" (both AI vehicle logistics; no level needs them after the fix round's data changes). `keepRaiders` ships off by default: on for every rival it reshaped Ember Crown, Ley Crown and Stolen Stones.
- BACKLOG 20 (WebGPU renderer, P2) cut in stretch 2 (10/10/2026): the curved planet is a GLSL `onBeforeCompile` injection on every material (curve.ts) and the retro, terrain, weather and renderer passes are custom ShaderMaterials (5 files); three r186 WebGPURenderer supports neither, so the port is a TSL rewrite of the whole look, and its QA would be headed only. The WebGL2 path holds its budgets (bench:render median about 4 ms CPU at 2560x1440). Revisit only if a GPU bound shows up.
- BACKLOG 5a (rigged clips, P1 but conditional: "only if close-zoom quality needs it"). Cut 10/09/2026: at the closest camera zoom with the retro pass (pixelScale 3) units are about 60 to 90 screen px tall and the procedural poses (walk, work, attack, shoot, cast, pray, panic, idle) read clearly in the combat anim_gallery shot, so the condition is not met; Meshy rigging would also spend asset budget for little visible gain. Revisit if a close-up or portrait camera ships (ADR-012 fallback stays valid: same instanceAnim attribute).

## Balance gaps
- Stretch 3 (2026-10-10): equal-number counters stay 100 percent by design decision: the 10 v 10 probe has no formation jitter, so each pair is deterministic; real games mix armies and the outnumbered probes (70, 60, 80) carry the counter feel. Revisit only with jitter in the equal probe (tools/harness/soak.mjs, triangle-probe.mjs) and a full retune.
- S4 campaign rerun (2026-10-11, bd7fb5e): verified bot wins by order 5300, 7100, 8550, 8883, 12530, 12405, 14650, 13400, 16400, 17116, 18870, 20251, 20500, 21750, 24000, 23505, 20708, 21473, 26770, 28324, 31693, 28400, 30100, 33750, 37900 (target line about 5000 + 1208 per level, band 25 percent). Out of band: stone_totem +27 percent (paced by the bot's build-up). Dips: 17 and 18 below 14 to 16; 22 and 23 below 21; near ties 5/6, 7/8, 15/16. Critic follow-ups: (1) last_hearthfall: 2 of 8 offsets never win (tribe 3 towers); (2) ley_crown: unbounded warden spawn, offset 12 stalemates; (3) drowned_fords ward hold and wolf_country late hold uncontested, aim 24000 to 25500; (4) hold_the_line survive stage won by the starting wardens; (5) old_reliquary followers 44 met idle; (6) the_forge followers 55 already met for a slow human; (7) stolen_stones old_ley raid never arrives; (8) stone_totem overshoot accepted; (9) small text fixes (many_mouths, sky_road clock message, cloud_isles sky_gate text); (10) variety: 15 of 25 levels end in eliminateAll.
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
Two computers or a group session: see `docs/PLAYTEST.md` (LAN setup, what to try together, what to bring back).

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

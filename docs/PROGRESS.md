# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 4 started: 2026-10-11T16:34:00Z (Stewart: work the remaining queue and backlog autonomously for 24 h, workflows for the full playtest, then plan the next leg and start it). Commit prefix S4. Stretch 3 done: tag s3-done at 146a467 (summary in PROGRESS_LOG).
- S4 DONE: stage-relative goals (0cb646a), raid pray and worship under threat (95b6a65), AI worship across water by boat or balloon (02d5a68), siteLost stage gate (b359244).
- S4 DONE Leg 5 LAN play (BACKLOG 15): L5-A to L5-F plus the campaign together (7c0f1df). Internet play waits for Stewart (public relay, deploy).
- S4 DONE BACKLOG 9: 25 levels (22 Cloud Isles, 23 Stolen Stones, 24 Ember Crown); campaign rerun workflow over all 25 (bd7fb5e), every level scenario green.
- S4 DONE Leg 6 "ready for people": L6-A to L6-D, L6-E probe (ed779c0), campaign fix round over 11 levels (6dc6c30). Full npm run qa PASS at a043684 (2026-10-12T02:50Z). Aggressive retune moved to L7-E.
- S4 Leg 7 "more campaign, more detail" (ROADMAP): L7-A chapters, L7-D map detail v2 (1bdb641), L7-B level-author workflow (b95869d), L7-F UI v2 stone and scale (a09ae2e, a043684; ADR-024; canvas https://claude.ai/artifact/W7zGavMKosrktxgD55pj9Q) DONE. L7-C chapter 3 'The Far Shores' DONE (43d2cf6 draft, 3abdb41 fix round; 35 levels, levels layer 71/71). Leg 7 DONE (2026-10-12): L7-E gaps 1, 2, 3 (063dd04) and 7 (a00a3f6) built, 4, 6, 8 design, 5 deferred; retune logged. Full npm run qa PASS at 8a5b969 plus later sim-only commits (qa:fast and levels layer 71/71 green). Leg 8 planned in ROADMAP. PAUSED for the weekly usage cap: Leg 8 needs multi-agent workflows; resume after 2026-10-15T18:00Z. Dev probe tools/harness/_objprobe.mjs prints each objective's done tick.
- S4 Leg 8 started early on Stewart's request (2026-10-12, after his playtest: "exactly what I was hoping for"). Playtest asks DONE (86e2d8a): a closing ring marks every accepted right-click order (green move, red attack, gold special) and clicking the Shaper portrait selects her. L8-D DONE except a nav bug: aggressive economyTargetPop 60 in skirmish, 40 kept in the campaign (ADR-025); ai soak 96 x 25: aggressive 29, sneaky 26, turtle 27 (was 14, 35, 28); levels layer 71/71; balloon unload at the wrap seam fixed. L8-A, L8-B, L8-C still wait for the weekly reset (workflows).
- S4 2026-10-12 evening (Stewart, before his long playthrough from level 3): L8-A and the boat launch stall DONE (9be218b), full npm run qa PASS, ai soak 96 x 25 PASS (30, 26, 27). Chapter 4 briefs ready (tools/workflows/chapter4-briefs.json, tab "The Wild Heart" from 36), held until after the playtest. Polish workflow wf_c3d9a461-2fe running: game speed, restart, quick save F5/F9, briefing, edge scroll, attack alerts and minimap pings, spell refusal reasons and tooltips, idle troops key, health bars, hover highlight, ambient life, chapter 3 props (L8-C).
- USAGE CAP (Stewart, 2026-10-12 evening, raised): stop at about 90 percent of the weekly all-models limit (76 percent at 03:20Z; resets 2026-10-15T18:00Z). Check get_usage between steps, start no new workflows, pause cleanly at about 84 percent.
- Stretch 2 (2026-10-10, 24 h) DONE: tag s2-done, full npm run qa PASS at 5e11f16. Run 1 done 2026-10-09T23:58Z: m0-done to m11-done tagged. Run started: 2026-10-08T21:25:00Z.
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Machine: often at 100 percent CPU (other projects' sims and benchmarks, leave them alone). Wall-clock timing is noisy, and bench readings of 6 to 7 ms while agents run scenarios are load, not regressions (idle: 3.7 ms).
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of page: https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5 (version 36), rebuild with `npm run making-of -- page` and republish after every backlog item (README steps).

## Next 3 actions
1. Polish workflow wf_c3d9a461-2fe: read its review defects, fix the high and medium ones, full npm run qa until PASS, npm run build, commit, tell Stewart.
2. Republish the making-of page (npm run making-of -- page) with the Leg 8 shots.
3. After Stewart's playthrough notes: fix them first, then L8-B chapter 4 (Workflow level-author with tools/workflows/chapter4-briefs.json as args, perAgent 2), then its campaign-playtest fix round.

## Blocked
- (none)

## Cuts and deferrals
- L6-C deferred (S4, 2026-10-11): "an attack wave leaves a vehicle home for worship trips" and "destroyTarget off the home landmass" (both AI vehicle logistics; no level needs them after the fix round's data changes). `keepRaiders` ships off by default: on for every rival it reshaped Ember Crown, Ley Crown and Stolen Stones.
- BACKLOG 20 (WebGPU renderer, P2) cut in stretch 2 (10/10/2026): the curved planet is a GLSL `onBeforeCompile` injection on every material (curve.ts) and the retro, terrain, weather and renderer passes are custom ShaderMaterials (5 files); three r186 WebGPURenderer supports neither, so the port is a TSL rewrite of the whole look, and its QA would be headed only. The WebGL2 path holds its budgets (bench:render median about 4 ms CPU at 2560x1440). Revisit only if a GPU bound shows up.
- BACKLOG 5a (rigged clips, P1 but conditional: "only if close-zoom quality needs it"). Cut 10/09/2026: at the closest camera zoom with the retro pass (pixelScale 3) units are about 60 to 90 screen px tall and the procedural poses (walk, work, attack, shoot, cast, pray, panic, idle) read clearly in the combat anim_gallery shot, so the condition is not met; Meshy rigging would also spend asset budget for little visible gain. Revisit if a close-up or portrait camera ships (ADR-012 fallback stays valid: same instanceAnim attribute).

## Balance gaps
- Chapter 3 fix round (S4, wf_6db6e827-33c): bot wins 14778, 17350, 19100, 23730, 24084, 25788, 27750, 31250, 34250, 36000 (monotonic, each inside +-25 percent of its target). Skeptic notes left for L7-E (stage-relative triggers fix most): salt_marsh only holds at the pinned bot offset (o0 34246, the rival can fall during the hold so destroy finishes at once); sunken_road hold stage and night_of_wolves final hill lightly contested; hearth_unbroken summit worship (objective 3) uncontested.
- Stretch 3 (2026-10-10): equal-number counters stay 100 percent by design decision: the 10 v 10 probe has no formation jitter, so each pair is deterministic; real games mix armies and the outnumbered probes (70, 60, 80) carry the counter feel. Revisit only with jitter in the equal probe (tools/harness/soak.mjs, triangle-probe.mjs) and a full retune.
- S4 campaign rerun (2026-10-11, bd7fb5e): verified bot wins by order 5300, 7100, 8550, 8883, 12530, 12405, 14650, 13400, 16400, 17116, 18870, 20251, 20500, 21750, 24000, 23505, 20708, 21473, 26770, 28324, 31693, 28400, 30100, 33750, 37900 (target line about 5000 + 1208 per level, band 25 percent). Out of band: stone_totem +27 percent (paced by the bot's build-up). Dips: 17 and 18 below 14 to 16; 22 and 23 below 21; near ties 5/6, 7/8, 15/16. Critic follow-ups: (1) last_hearthfall: 2 of 8 offsets never win (tribe 3 towers); (2) ley_crown: unbounded warden spawn, offset 12 stalemates; (3) drowned_fords ward hold and wolf_country late hold uncontested, aim 24000 to 25500; (4) hold_the_line survive stage won by the starting wardens; (5) old_reliquary followers 44 met idle; (6) the_forge followers 55 already met for a slow human; (7) stolen_stones old_ley raid never arrives; (8) stone_totem overshoot accepted; (9) small text fixes (many_mouths, sky_road clock message, cloud_isles sky_gate text); (10) variety: 15 of 25 levels end in eliminateAll.
- S4 campaign fix round (2026-10-11, wf_215155fe-3ad, 11 levels): bot wins now 3:7900, 4:8750, 6:12450, 9:16500, 12:19000, 16:20500, 17:24150, 18:25850, 22:31275, 23:33100, 25:35500 (last_hearthfall wins on every probed offset). Follow-ups 1 to 7 and 9 done; stolen_stones time limit raised to 3400 s (2x its win). Accepted: hold_the_line's kill stage is also made by towers and the starting wardens (level 3 is the defence tutorial; an idle player still loses at about 8500); the_forge, ley_crown and drowned_fords can finish their last destroy or eliminate at once when the rival already fell (a fast player just ends sooner). Left: ley_crown (16) now dips under 13 to 15; near ties 21/22 and 23/24. Engine gaps (L7-E): the AI clears site guardians only on its home landmass (drowned_fords and cloud_isles pace on that stall); a non-repeating spawn or raid still acts for a fallen tribe.
(soft gate numbers that missed their targets, with the milestone)
- M7 ai soak (12 seeds x 40 min, normal): wins sneaky 8, aggressive 2, turtle 2, unfinished 0, median 13.4 min (ok). Sneaky takes 8 of 12 wins (its pair win rates are over the 70 percent cap); 2 analyst passes plus garrison and training code did not fix it (BACKLOG 64, 71).
- S4 L6-E (2026-10-11, 20 seeds): the loose equal-number probe is also 100 percent every pair, so the tight-rank result was not an artifact; outnumbered 6 v 10 sits at 65, 65, 70 (inside the 65 to 80 band), mixed mirror 35 (side a, 20 seeds). Decision: no triangle retune. A counter is worth about 1.7 of its victim, and lowering the equal-number rate into the band would drop the outnumbered probes to near 0; the band is read from the outnumbered probes.
- S4 L6-E ai soak (2026-10-11, 48 seeds x 25 min): wins sneaky 19, turtle 15, aggressive 4, unfinished 10 of 48, median 15 min. Aggressive is the weak personality again (Stretch 2 had 16, 15, 13): a data-only retune is L7-E.
- S4 L8-D (2026-10-12, ai soak 96 x 25): aggressive economyTargetPop 60 (skirmish only): wins aggressive 29, sneaky 26, turtle 27, unfinished 14, median 15.6 min; pairs aggressive v sneaky 18-11, sneaky v turtle 15-11, aggressive v turtle 11-16. Probes that did not help: aggression 0.4 (bigger waves, 11 wins); trait fertile (identical, soak worlds pass no traits, so Swift never mattered in soaks); firstAttackMinute 8 adds nothing over the economy alone. ai-idle 4 x 25: all eliminated at 8.6 to 12 min.
- S4 L7-E retune tried (2026-10-12, ai soak 96 x 25 min, 1 min wall each): baseline sneaky 35, turtle 28, aggressive 14; aggression 0.7 plus first attack minute 6: 36, 35, 14; army mix 0.4/0.3/0.3: 36, 27, 16; plus economy 45 and minute 7: 38, 31, 15; towerAffinity 0.45 alone (Watchtowers detect Shades): 33, 30, 17 (noise is about 4). Data knobs do not move it: the gap is structural (sneaky's Shades, Swift the weakest trait) and the level bots play aggressive, so any change would also move 33 level scenarios. Logged, no change; a code-side look (Shade defense, trait value) is a later item.
- M6/M7 counter triangle: 100 percent every pair (target band 65 to 80); probes: Firecaller 6 v Chanter 10 and Chanter 6 v Warden 10 still win 100 percent, mixed mirror 40 to 50 percent (BACKLOG 65).
- BACKLOG 7 (2026-10-09): triangle still 100 percent every pair; probes Warden 6 v Firecaller 10 0, Firecaller 6 v Chanter 10 100 (ranged hits break every chant, 3 s cooldown: needs a design change, 60 and 65), Chanter 6 v Warden 10 40 (was 100), mixed mirror 60. ai soak 12 x 30 min: sneaky 6, turtle 5, aggressive 1 (aggressive now the weakest), unfinished 0, median 17.6 min, 74 of 74 waves mixed. ai-idle: all 12 eliminated (aggressive 9 to 13 min, sneaky 11 to 12, turtle 13 to 13.5). Hold the Line (83) not tuned.
- Stretch 2 end (2026-10-10): BACKLOG 65 met for outnumbered probes (Warden 6 v Firecaller 10 70, Firecaller 6 v Chanter 10 60, Chanter 6 v Warden 10 80, mixed mirror 40); equal-number pairs still 100 percent. ai soak 64 x 20 min: aggressive 16, sneaky 15, turtle 13, unfinished 20 (the M7 sneaky skew is gone).

## State of the game (for Stewart)
Rewritten 2026-10-12 evening, before Stewart's long playtest. Full `npm run qa` PASS at 9be218b, ai soak 96 x 25 clean, production build fresh. Run 1 built the game (m0 to m11), stretch 2 added the look and the modes, stretch 3 grew the campaign, stretch 4 added LAN play, chapters 2 and 3, map detail, the stone UI and the Leg 8 fixes. BACKLOG items that need you: 16 desktop build, 17 public deploy, 29 path strip.

**What works**
- The core god game: a small curved, wrapping planet where your Shaper leads a tribe from a Hearth. Settlers gather and build, followers pray for mana or train Wardens, Firecallers, Chanters and Shades. All 16 spells, eight taught at Reliquaries. Fog of war, minimap and map view (M).
- Campaign of 35 hand-made levels in three chapters ("The First Fires" 1 to 12, "The Wide Waters" 13 to 25, "The Far Shores" 26 to 35) on a route map with chapter tabs. Every level has a scenario where a bot wins it and one where an idle player loses; bot wins ramp per chapter, and every time limit is at least twice the bot's win.
- New tonight: the level bot raises a Boathouse a goal asks for at once, and four levels were retuned around it (Across the Strait, Salt Marsh, Sunken Road, Pilgrim Stones); boats fresh from a Boathouse no longer stall at the shore; right-click orders show a closing ring (green move, red attack, gold special) and the Shaper portrait selects her.
- UI v2 "carved hearthstone": stone panels, Marcellus SC and Alegreya Sans, interface size fits your screen (135 percent at 2560x1440) with a 75 to 200 percent slider in Settings.
- Look v3 "miniature diorama" (tilt-shift, painted shallow water, thatched huts, lighting presets, rain) plus map detail v2 (shore plants, village clutter, authored props).
- Modes: skirmish with victory variants, Forge pre-match, boats and balloons, map editor, LAN versus and co-op (campaign together, watchable replays), photo mode, replays, records and achievements.
- Opponent AI: three personalities, four difficulties, worships across water by boat or balloon, raids worship sites. Personalities now win about equally (aggressive 30, sneaky 26, turtle 27 of 96).
- QA: 543 unit tests, 120 scenarios plus 71 level scenarios, golden replays in Node and Chromium, benches, 11 shot sets with VisionQA, end-to-end at 1280x720 and 2560x1440, production build.

**Known issues**
- Counters at equal numbers still win every time; mixed armies decide real games.
- Salt Marsh's bot win varies a lot with the start (about 18000 to 32000 ticks); its last stage is a long siege. Across the Strait's rival is smaller than before (if it feels easy, tell me).
- The AI clears guardians only on its home landmass.
- Online play, a desktop exe and a public URL are not built (they need you).

**Top 5 next items**
1. Your playtest notes from tonight.
2. Chapter 4 (L8-B, 10 levels in two batches), then its fix round.
3. Map detail v3 (L8-C) for chapters 3 and 4.
4. Static web deploy so the game opens from a link (BACKLOG 17; needs your OK).
5. Engine gaps the tuners logged: posted guards count toward maxTroops; a destroy goal that stays open if its tribe falls early.

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

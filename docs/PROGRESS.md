# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
Stretch 3 started: 2026-10-10T21:45:00Z (Stewart after playing levels 1 to 3: "legitimately good"; wants levels far more complex as the campaign ramps: more buildings, resources, spells, objectives, plus the handoff items). Quota is tight (62 percent used, resets Thursday): Haiku for QA digging and docs, Sonnet for soaks and level drafts, main session for sim code. No run sentinel or STATUS line this stretch.
- S3 DONE: prayer chains (ed566ba): dormant sites, awaken and reveal rewards, validation, sunk render.
- S3 DONE: level primitives: objectives destroy, reach (gold beacon ring), build, and staged objectives (`after`, hidden until open); triggers area and followers; site woke and reveal bursts.
- S3 closed: counter tuning at equal numbers (analyst, 7 probe runs): 10 v 10 is a deterministic cliff (100 to 0 percent per pair), so equal numbers cannot sit at 65 to 80 by data without breaking the 6 v 10 probes, which already meet the band. Equal 100 percent accepted (see Balance gaps).
- S3 DONE: AI uses the unused spells: spell value counts traps, sinking land, storms and building damage, building targets value the whole village; prefs gain call, volcano, erode, mire. ai soak 16 x 20: call 51, mire 4, volcano 1, erode 1 (were 0); wins aggressive 2, sneaky 4, turtle 4, unfinished 6.
- S3 DONE: campaign level 14 The Waking Stones (three-site chain, warden guardians, minute 20 bridge raid, minute 30 Reliquary race); primitives: spawn stance (defensive = posted guard), raid cap `n`, spell `from`; AI clears guarded sites with troops before worshipping. Bot win at tick 31913, idle loss at 25679; goldens unchanged.
- Stretch 2 (2026-10-10, 24 h) DONE: tag s2-done, full npm run qa PASS at 5e11f16; its Now lines moved to PROGRESS_LOG (S3 trim).
- Run 1 done 2026-10-09T23:58Z (about 26.5 h): m0-done to m11-done tagged, every P1 done or cut (5a, see Cuts); full npm run qa PASS at 5b2587a; its sentinel line is in PROGRESS_LOG.
- Run started: 2026-10-08T21:25:00Z
- Earlier work: BACKLOG 0a to 8 and M0 to M11 (details in PROGRESS_LOG and ARCHITECTURE).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Machine: often at 100 percent CPU (OneDrive sync; another project's simulations and GPU benchmarks with their own headless browsers, leave them alone). Wall-clock timing is noisy; bench uses deterministic replay minima; full qa needs several reruns.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md. Making-of page (Stewart's request): https://claude.ai/artifact/7ypAnF57hVkHQ83aRDHGf5, rebuild with `npm run making-of -- page` and republish to that URL after every backlog item (README steps).

## Next 3 actions
1. Content for the ramp: new buildings, a second resource and new spells (design pass in DESIGN, data first, sim primitives with tests, assets via asset-producer within the $30 budget, about $18 left).
2. Campaign levels 14 to 25 built on prayer chains, staged objectives (after), destroy, reach, build, area triggers and 3 to 4 tribes; Sonnet drafts JSON, main session reviews; each level gets a scripted or bot win scenario.
3. Complexity pass on levels 6 to 13 with the new primitives (guarded sites: rival or wild units placed at a site in setup).

## Blocked
(none)

## Cuts and deferrals
- BACKLOG 20 (WebGPU renderer, P2) cut in stretch 2 (10/10/2026): the curved planet is a GLSL `onBeforeCompile` injection on every material (curve.ts) and the retro, terrain, weather and renderer passes are custom ShaderMaterials (5 files); three r186 WebGPURenderer supports neither, so the port is a TSL rewrite of the whole look, and its QA would be headed only. The WebGL2 path holds its budgets (bench:render median about 4 ms CPU at 2560x1440). Revisit only if a GPU bound shows up.
- BACKLOG 5a (rigged clips, P1 but conditional: "only if close-zoom quality needs it"). Cut 10/09/2026: at the closest camera zoom with the retro pass (pixelScale 3) units are about 60 to 90 screen px tall and the procedural poses (walk, work, attack, shoot, cast, pray, panic, idle) read clearly in the combat anim_gallery shot, so the condition is not met; Meshy rigging would also spend asset budget for little visible gain. Revisit if a close-up or portrait camera ships (ADR-012 fallback stays valid: same instanceAnim attribute).

## Balance gaps
- Stretch 3 (2026-10-10): equal-number counters stay 100 percent by design decision: the 10 v 10 probe has no formation jitter, so each pair is deterministic; real games mix armies and the outnumbered probes (70, 60, 80) carry the counter feel. Revisit only with jitter in the equal probe (tools/harness/soak.mjs, triangle-probe.mjs) and a full retune.
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

# Backlog (prioritized, living)

Order matters: work top down after M11. Re-rank when new findings arrive; keep each item small enough for one commit cycle or split it. Format: `P<n> [size S/M/L] item: acceptance`.

## P1: make the core game great
0. [M] (done 10/09/2026, look v2 on top) Retro render pass (ADR-005): low-res render target with nearest upscale, palette quantization and ordered dither, pixel-noise detail textures, dusk and firelight lighting, stone and wood HUD frame; knobs in style.json; rebaseline shots once. Do this right after the M5 review so every later shot uses the final look.
0a. [M] Look v2 follow-ups (gap to retro-candidate-1 after the look v2 pass): dense pine forest belts around villages (generator tree clusters, taller conifer props), villages that read as villages (M10 building and unit models at a larger on-screen scale), terraced plateaus from the generator (stepped height quantization on land) so cliffs form bands instead of slope patches, a volcano and smoke column that reads at mid zoom, HUD icons from assets/icons (A3) in the spell row and build column.
0b. [M] In-match progression (DESIGN 3a): data-driven unlock tiers by follower count and worship, HUD "next unlock" panel; evaluate a second harvested resource (stone or clay).
1. [M] Remaining v1 spells as data: Veil, Ward, Beguile, Whirlwind, Mire, Erode, Firerain, Wraith: one scenario each, shot per spell.
2. [M] Shade unit and Shade Den: disguise, sabotage, scenarios for detection and burn.
3. [M] Fog of war and scouting, minimap reveal, AI respects fog (no map hacks unless difficulty data says so).
4. [M] Command UX polish: formations, double-click type select, control group jump, spell target previews refined, undo window tuned from playtest feedback.
5. [L] Animated units: rig the chosen unit meshes (Meshy or Tripo rigging), generate clips (idle, walk, work, attack, cast, pray, die, drown), bake to vertex animation textures in Blender for InstancedMesh; `bench:render` must stay in budget. Needs Blender; if missing, log under Cuts.
6. [M] Difficulty levels (decision quality, reaction time, optional resource multipliers) with soak verification per level.
7. [M] Balance pass driven by soak metrics, with `playtest-analyst` proposals reviewed against DESIGN pillars.
8. [S] Accessibility: colorblind-safe tribe palettes, UI scale, remappable keys, subtitle text for barks.

## P2: content and modes
9. [L] Campaign: 10 more levels (25 target), progression unlocks via Reliquaries, level select map.
10. [M] Boats and Boathouse; Skyloft and balloons (only Firecallers fire from vehicles); pathing over water.
11. [M] Forge mode: 2-minute pre-match terraforming phase with free land edits.
12. [M] Map editor in-game (terrain brushes, place shrines, triggers), saves level JSON.
13. [M] Victory variants: hold reliquaries, timed survival, king of the hill.
14. [S] Day and evening lighting presets and weather (rain slows units, visual only at first).

## P3: platform and growth
15. [L] Online multiplayer: lockstep over WebSocket, desync detection via per-tick hash, lobby; co-op vs AI.
16. [M] Electron desktop build (exe), auto-update later.
17. [M] Static web deploy (Cloudflare Pages or Workers static assets) with a version banner.
18. [M] Mod packs: load `mods/<name>` from a folder, mod manifest, conflict report.
19. [M] Replay viewer: load a command log, scrub timeline, follow camera.
20. [M] WebGPU renderer behind the interface (headed QA only), compare perf.
21. [S] Achievements and stats screen from event logs.
22. [S] Localization scaffold (string tables).

## P4: tooling and QA
23. [M] VisionQA move picker evaluation (VISIONQA section 7) over 16 seeds; keep or remove based on diversity metrics.
24. [S] Nightly-style full soak (64 seeds) script with trend chart of balance metrics over commits.
25. [S] Perf trend chart from bench history.
26. [S] Asset re-generation tool for a single asset with a new prompt, with before/after sheet.
27. [S] Guard self-tests for imports, ip-names, dashes, docs and data guards; every guard asserts it scanned more than 0 files (M0 review).
28. [S] Determinism guard: flag `.sort()` without a comparator, `Intl`, `Symbol` based APIs in sim/ai (M0 review).
29. [S] Before any public push: strip absolute personal paths from CLAUDE.md, README.md, OPENING_PROMPT.md and docs/research (M0 review).
30. [S] Replace free-form formula strings (balance.breeding.formula, units.rules.popCapFormula) with structured params when M4 consumes them; never eval (M0 review).
31. [S] Tighten the spells terrainOp schema into a union discriminated by `op` with required params per op (M5, M0 review).
32. [S] Shot blank and coverage checks sample the canvas region, not the whole page (M2, M0 review).
33. [S] Add `visionqa:calibrate` and `visionqa:spend` npm scripts when calibration lands (VISIONQA.md names them).
34. [S] Move tunable terrain and generator literals into data before spell tuning (M1 review): generator shoreline gaps (sea-2, sea+2), tree min height sea+4, tree density x4, jitter 0.2/0.6, wild tries 24, candidate stride 2; terrain buildable sea+2, lowerTowardSea floor drownDepth*2, flatten plateau 0.75, ridge taper 1.5, crater 0.15/0.25, noiseScar 0.85/0.8/0.4/0.6; world hp fallback 1000, RECENT_EVENTS 50, TRIBE_COLORS vs style palette.
35. [S] Self-contained saves: embed WorldInit (seed, map spec, pack hash) in the snapshot; hash or compare eventCounts in the restore test; renderer treats a restore as a full rebuild (M1 review).
37. [S] Map view: orthographic camera with straight edges and a grid, fitted to the window (M2 sheet review).
38. [S] Sky: more blue above the horizon and a few faceted clouds; golden haze only near the horizon (M2 sheet review).
39. [M] Close-up detail: grass tufts, small rocks and flowers as instanced props by band; islands preset reads too sandy in lowlands (M2 sheet review).
40. [S] Map view still renders as a distorted pillow with ragged corners: verify bend is 0 in map mode, switch to an orthographic camera (pairs with 37) (M2 review).
41. [S] Render tunables into data (style.json render block): camera distance/pitch/bend curve, verticalScale, fog and fade, water wave constants, tree size formulas (M2 review).
42. [S] packages/render unit tests: syncTerrain chunk selection from dirty rects, wrap placement, faceColor bands; an automated seam continuity check on the wrap_seam shot (M2 review).
43. [S] VisionQA: hold out calibration samples (fit on half, score on half) before trusting ui_overlap; grow the set (M2 review).
44. [S] Bump world.treeVersion when a tree wood value changes (chopping, M4) so the tree layer rescales (M2 review).
45. [S] Player feedback when an order fails or gives up (orderFailed, orderGaveUp events): a short notification and a red marker at the target (M8 HUD v2, M3 review).
46. [S] Before any network play: tribe -1 skips ownership and god-mode checks in move/stop/impulse, and the __game.command hook turns on with ?debug=1; gate both behind a host-only flag (M3 review).
47. [S] Pathfinder refresh still rebuilds walkability and components for the whole map on any edit (about 4 ms at 128); make it incremental per dirty rect for 256+ maps (M3 review follow-up).
48. [M] Economy robustness beyond the default map: islands 128 and continents 192 with 4 tribes and 20-minute runs showed stalls (homes emptied by many plans) and reachable give-ups; widen the economy soak matrix and fix (M4 review).
49. [S] Economy bot cancels plans that cannot get wood (no reachable tree) and the HUD gets a cancel-plan control (M4 review).
50. [S] Record controller (bot) specs in scenario and replay headers so a future command recorder never desyncs (M4 review).
51. [S] Bench economy cost (nearestTree computes components per tree) with a bot-driven economy bench case (M4 review).
52. [S] HUD: real spell and resource icons (A3), a short label on the training side of the split slider, narrow-width DOM check (M4 review).
53. [S] Spell hotkeys: 8 v1 spells but 7 keys (Volcano has none); add a second row or let players rebind (M5).
54. [M] DONE (M6): M5 review follow-ups, all closed (wild aftermath and Shaper regen in the combat core; castFailed, statusApply max and throws, data-required effect fields with a pack cross-check, STREAMS.terrain, SPELL_KEYS with Shift+M and Shift+N, TESTING example, elimination, respawn and mid-cast snapshot tests in packages/sim/test/spells.test.ts, expectVfx on spell shots, spell storm bench). Original list: eliminated tribes keep breeding and acting (decide: units turn wild, freeze or die); a queued cast at an unreachable target never clears (drop it with castFailed); Shapers never regenerate and sit at 1 hp after non-lethal damage (add regen or troop lethality before M6); statusApply counts own units against max and unknown statuses should throw; data for knockback falloff, terrainOp and respawn fallbacks, STREAMS.terrain for the quake seed; Shift+M hotkey never matches (e.key is "M") and Volcano has no key; TESTING.md grantCharges example lacks args.tribe; tests for elimination at 0 followers, respawn with no Hearth, double elimination, mid-cast snapshot; spell shots should assert VFX are drawn; bench spell and effect load.
55. [S] Melee troops acquire and chase enemies standing in another walkable component (across water), so the chase re-orders into `orderFailed unreachable` every repath (war soak seeds 1002 and 1007: 50 and 36 per 20 minutes, no invariant broken); acquire should skip unreachable targets for melee and Chanters, ranged units may still shoot across (M6).
36. [S] Spells that drown units need a readable lead-in (rumble, crack VFX, short delay) so players see cause and effect (M5, M1 review).

## Parking lot (ideas, unranked)
- Wild people tribe that can be Called (converted) for growth.
- Tribe traits (small passive bonuses) as data.
- Spell combos (Raise Land then Erode for a moat) highlighted by a hint system.
- Photo mode.

# Backlog (prioritized, living)

Order matters: work top down after M11. Re-rank when new findings arrive; keep each item small enough for one commit cycle or split it. Format: `P<n> [size S/M/L] item: acceptance`.

## P1: make the core game great
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

## Parking lot (ideas, unranked)
- Wild people tribe that can be Called (converted) for growth.
- Tribe traits (small passive bonuses) as data.
- Spell combos (Raise Land then Erode for a moat) highlighted by a hint system.
- Photo mode.

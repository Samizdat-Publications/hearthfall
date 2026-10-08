# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M1 done (tag m1-done). Now M2: renderer v1 and capture pipeline.
- M1 shipped: sfc32 rng streams, FNV hash parts, SoA entities, torus terrain with all ops + dirty cursor (dirtySince), tileable fbm generator (continents, islands, flat test maps) with connected Hearth sites, trees, wild people; Command registry (god-mode terrainOp is tribe -1 or godMode only); World step order, drowning, snapshot/restore; scenario runner + safe DSL (4 scenarios); golden replay with frozen pack (terrain_ops_continents). 66 unit tests. qa:fast now includes replays.
- M2 in progress (uncommitted pieces committed with m1 tag are typechecked, not yet rendered): packages/render (curve.ts bend patch + radial horizon fade, terrainMesh.ts faceted chunks + water shader, camera.ts rig, renderer.ts), apps/game (game.ts wiring, debug API, HUD stub).
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A1 bake-off done (4 Meshy units; route B image-to-3D recommended, 15 credits). Spend $1.17 of $30. Pick pending: view reports/latest/unit_bakeoff_sheet.png once.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md.
- Subagents: project agents not registered in this session; use general-purpose with the agent file's rules and model pasted in.

## Next 3 actions
1. M2: first render through `npm run shot` (shot sets smoke.json: overview, close, seam, globe, map, islands), pixel checks, contact sheet via a Playwright-rendered HTML grid, baselines.
2. Tune the look against the chosen direction (one contact sheet view), archive it for making-of; DOM layout check scaffold; dirty-chunk debug counter assertion.
3. VisionQA check catalog + calibration with setDebug breakage flags; then M2 exit ritual.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

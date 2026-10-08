# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M2 done (tag m2-done). Now M3: units, movement, selection.
- M1 shipped: sfc32 rng streams, FNV hash parts, SoA entities, torus terrain with all ops + dirty cursor (dirtySince), tileable fbm generator (continents, islands, flat test maps) with connected Hearth sites, trees, wild people; Command registry (god-mode terrainOp is tribe -1 or godMode only); World step order, drowning, snapshot/restore; scenario runner + safe DSL (4 scenarios); golden replay with frozen pack (terrain_ops_continents). 66 unit tests. qa:fast now includes replays.
- M2 shipped: ThreeRenderer (faceted 32x32 chunks remeshed from the terrain dirty cursor, water shader with foam, curved-world bend + radial horizon fade, nearest-copy wrap, gradient sky, instanced placeholder trees), camera rig (orbit, zoom to globe, map view, F1-F4 bookmarks), Game app + window.__game (getSummary, step, command, setCamera, setDebug, runDef). Shot pipeline: smoke set 7 shots, blank/coverage/baseline/DOM/console checks, HTML contact sheet, approved baselines (stable to 0.006%). VisionQA calibrated (tools/visionqa/thresholds.json) and in npm run qa. Golden replays verified bit-identical in Chromium.
- Screenshot mode: headless-shell + GPU args (RTX 5070 Ti Laptop). VisionQA provider ON (about $0.00003 per low shot).
- Art direction: ref_04 crisp flat-shaded polygon + ref_05 golden-hour light (data/base/style.json `direction`).
- Asset track: A1 done (route: Meshy image-to-3D from Gemini concepts). A2 buildings and props running in background (thumbnail fix first). Spend about $1.2 of $30 before A2.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present; Tripo, PixelLab missing.
- Making-of archive: making-of/ via `npm run making-of -- add`; storyboard in making-of/README.md.
- Subagents: project agents not registered in this session; use general-purpose with the agent file's rules and model pasted in.

## Next 3 actions
1. M3: SoA motion columns, Settler and Shaper kinds, spatial hash on torus, path cost field, sectors+portals, flow fields, steering, drowning on push.
2. M3: input selection (click, box on the curved surface via CPU raymarch), move orders, instanced placeholder units with tribe tint, interpolation.
3. M3 gate: pathing scenarios (ridges, water, wrap), soak no-stuck invariant 1000 units x 10 min, bench 2000 units; Opus milestone review.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

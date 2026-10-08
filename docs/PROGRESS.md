# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M0 done (tag m0-done). Now M1: sim core and terrain.
- M1 so far (committed, typechecked, mostly untested): rng.ts (sfc32 streams), hash.ts, entities.ts (SoA), terrain.ts (all ops), noise.ts, generator.ts (continents/islands/flat/flat_with_channel), config.ts, commands.ts (registry: terrainOp, noop), world.ts (step order, drowning, hash parts). Not yet: snapshot, scenario runner + DSL, golden replays, unit tests for terrain ops and wrap seams, PRNG/hash tests.
- Screenshot mode: headless-shell + GPU args (ANGLE D3D11, RTX 5070 Ti Laptop), WebGPU adapter available headless. Stored in reports/doctor-env.json.
- VisionQA provider: ON (decisions). 315 input tokens per 1280x720 low-detail shot (about $0.00003), p50 423 ms. docs/visionqa-calibration.md.
- Asset track: A0 done (pipeline in tools/assets, Gemini/Meshy/ElevenLabs smoke ok, $0.14 spent). A1 next (style refs, unit bake-off; Tripo key missing so Meshy only). Blender 5.1.2 needs export_vertex_color ACTIVE.
- Keys: Meshy, ElevenLabs, Gemini, OpenAI present. Tripo, PixelLab missing.
- Making-of archive (Stewart's request): making-of/ + `npm run making-of -- add`; storyboard in making-of/README.md. Archive every kept image with a milestone tag.
- Subagents: project agents in .claude/agents are not registered in this session; spawn general-purpose with the agent file's rules and model pasted in.

## Next 3 actions
1. M1 unit tests: every terrain op incl. wrap seams, PRNG streams independence, hash stability, generator connectivity.
2. Scenario runner with assertion DSL (tools/harness/scenarios.mjs) + 3 scenarios; snapshot().
3. Golden replay record/compare + replays:rebless; then M1 exit ritual. Kick off A1 asset batch in parallel.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

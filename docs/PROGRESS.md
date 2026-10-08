# Progress (current state)

Read this first after any restart or context compaction. Keep "Now" under 25 lines. History goes to `docs/PROGRESS_LOG.md` (append only, never read it whole).

## Now
- Run started: 2026-10-08T21:25:00Z
- Milestone: M0 (gate passing: check + doctor PASS); finishing VisionQA probe, A0 report, tag
- Last green commit: see `git log -1` (M0: workspace skeleton, harness, guards, doctor)
- Screenshot mode on this PC: headless-shell + GPU args (ANGLE D3D11, RTX 5070 Ti Laptop); WebGPU adapter available headless
- VisionQA provider: off (probe not run yet)
- Asset track: A0 running via general-purpose subagent (Sonnet) with the asset-producer rules pasted in
- Keys present: Meshy, ElevenLabs, Gemini, OpenAI. Missing: Tripo (bake-off skipped, Meshy does units), PixelLab (unused)
- Session note: project subagents in `.claude/agents/` were not registered (session started outside the project folder). Use `general-purpose` with the agent file's rules and model pasted into the prompt until a fresh session loads them.

## Next 3 actions
1. VisionQA module + probe (VISIONQA section 3) using reports/latest/doctor-shot.png; keep provider off if anything fails.
2. Collect A0 report, commit asset pipeline, milestone-reviewer (Sonnet), tag m0-done.
3. M1: seeded PRNG streams, tick loop, Command bus, torus heightmap and terrain ops.

## Blocked
(none)

## Cuts and deferrals
(none)

## Balance gaps
(soft gate numbers that missed their targets, with the milestone)

## State of the game (for Stewart)
(written when the run is done)

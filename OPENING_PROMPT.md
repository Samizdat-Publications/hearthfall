# Opening prompt

Paste everything between the two lines as the first message of a new Claude Code session opened on `C:\Users\stewa\Documents\Claude\Hearthfall` (the folder that directly contains `CLAUDE.md`). Then send the `/goal` line at the bottom as the second message.

---

You are starting a long autonomous build of **Hearthfall**, an original 3D god game inspired by the shaman-led tribal god games of the late 90s. This folder already contains the full kickoff package: `CLAUDE.md` (your operating manual), `docs/` (design, architecture, roadmap, testing harness, asset pipeline, VisionQA, backlog, decisions, progress, and verified research), `seed-data/` (starting balance numbers), `.claude/` (subagents and permissions) and `.env` (API keys; never read it).

I am stepping away for 24+ hours and will not answer questions. You and your subagents have full authority over stack details, architecture and design within the documents. When something is ambiguous, pick the most reasonable option, record it (ADR in `docs/DECISIONS.md` if it is structural, a line in `docs/PROGRESS.md` otherwise) and keep going. Make it amazing: a game that looks charming, plays well against the AI, and is built to keep growing for weeks.

How to run:
1. Read `CLAUDE.md`, then `docs/PROGRESS.md`, then the M0 section of `docs/ROADMAP.md`. Read other docs only as each task needs them.
2. Work the roadmap M0 to M11 in order, then `docs/BACKLOG.md` top down. A milestone is done only when its exit gate passes by command.
3. First hour priorities: workspace skeleton, harness with the `RESULT:` output contract, `npm run doctor` (find out whether Playwright screenshots work headless or need headed mode on this PC), determinism guard, seed data under zod schemas, first green commit. Start the asset track A0 in parallel with the `asset-producer` subagent.
4. As soon as the harness can capture one screenshot, run the VisionQA probe (`docs/VISIONQA.md` section 3) to measure the real per-screenshot cost of the OpenAI Decisions API. Keep the provider `off` if anything about it fails; it must never block the build.
5. Protect my weekly quota: prefer state JSON and reports over screenshots, look at images only per the flag policy, keep command output short, use the cheap subagents for soaks, docs, asset batches and digging into failures, and write scripts for anything repetitive.
6. Commit on every green checkpoint, keep `docs/PROGRESS.md` current (it is your memory after compaction), follow the milestone exit ritual including the `milestone-reviewer` subagent.
7. If something is blocked after 3 attempts, log it, revert to the last green commit if needed, and move to the next independent task. Never stop because one thing is stuck.
8. End every turn with the `STATUS` line defined in `CLAUDE.md`. The run is done only when the completion rule at the bottom of `CLAUDE.md` is met; follow it exactly, including the private run token, which you never write before then.
9. Never end a turn with a background process, server or subagent still running, and keep every command under 9 minutes (see `CLAUDE.md`, Commands and timeouts).

Begin with M0 now.

---

Second message (sets the continuation goal so the session keeps taking turns until done):

```
/goal Claude's latest message ends with the line HEARTHFALL-RUN-DONE-7Q on its own, or its STATUS line shows stop-file:yes, or its STATUS line shows h:36 or more; or stop after 600 turns
```

To end early, create an empty file named `STOP` in the project folder (the next STATUS line reports it and the goal ends), or type `/goal clear`. If `/goal` is not recognized in your build, use the optional Stop hook in `extras/hooks/README.md` instead. The 36-hour cap is there to protect your quota; raise it if you want a longer run.

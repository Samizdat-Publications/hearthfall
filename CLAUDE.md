# Hearthfall: operating manual for Claude Code

Hearthfall is an original 3D god game inspired by late-90s shaman-led tribal god games: a mortal avatar caster, population-powered mana, deformable curved planet, water kills. You are building it autonomously for 24+ hours, then it grows for weeks. Stewart gave you full authority over stack, architecture and design. He will not answer questions during the run: decide, record the decision, keep going.

Project path on Stewart's PC: `C:\Users\stewa\Documents\Claude\Hearthfall`. Never read or write outside it. Never touch `OneDrive\Documents` or `C:\Users\stewa\Claude` (dead on purpose). Paths and names inside `docs/research/` are examples only.

## Read order (only what the task needs)
1. `docs/PROGRESS.md` (always first; your memory across compactions). Never read `docs/PROGRESS_LOG.md` whole; append only.
2. `docs/ROADMAP.md` (current milestone only)
3. `docs/ARCHITECTURE.md`, `docs/TESTING.md` (sections you are touching)
4. `docs/DESIGN.md` (intent), `data/base/*.json` (live numbers win over DESIGN)
5. `docs/ASSETS.md`, `docs/VISIONQA.md` for those tracks
6. `docs/research/*.md` only for facts you need; grep, never read whole

## Non-negotiables
- **Determinism:** `packages/sim` and `packages/ai` use only the Math allowlist in ARCHITECTURE section 3, no `**`, no clocks, timers, DOM or unseeded randomness. `npm run check` enforces it.
- **Data first:** tunable numbers, units, buildings, spells, AI personalities, levels live in `data/base/*.json` with zod schemas. New content is data; new mechanics are reusable primitives with tests.
- **Layering:** sim depends only on data. Renderer, UI, audio read sim state and never write it. Every player, AI and bot action is a Command.
- **Every feature ships with a test;** every bug fix starts with a failing regression scenario.
- **Pinned:** `three@0.186.1`, `@playwright/test@1.64.0`. No unprompted upgrades of pinned or major dependencies.
- **Original IP:** never use the original game's title, tribe, unit, building, spell or level names, or its assets and audio. `tools/guards/ip-names.mjs` enforces the list. Our names: `docs/DESIGN.md` section 2 (the game is Hearthfall; the avatar caster is the Shaper).
- **Secrets:** never read, print, log or commit `.env` values. Report key presence only. Node loads it with `--env-file-if-exists=.env`; Python with python-dotenv.
- **Git:** commit locally on every green checkpoint (`M<n>: <what>`), tag milestone exits `m<n>-done`. Never push, never change git config, never force, never `reset --hard` or `clean`. To revert: `git restore --source=<green-sha> --staged --worktree -- .` then commit.
- **Docs current:** behavior, data shape, command or architecture changes update the matching doc in the same commit. `docs/DATA.md` is generated (`npm run data:docs`).
- **Text style:** no em dashes or en dashes in docs, data, UI text (guard enforced).

## Auto-mode etiquette (an unattended run must never hit a permission wall)
- The shell is Git Bash. npm scripts run in cmd.exe: scripts call `node` only (no rm, cp, VAR=x, single quotes).
- Never retry a denied action. Change approach and log it in PROGRESS.
- Never write under `.claude/` and never delete kickoff files (`seed-data/`, `extras/`, `docs/research/`).
- No `curl | sh`, no global installs, no `git lfs`, no process kills by name. Kill only children you started, by PID: `taskkill /PID <pid> /T /F`.
- All network installs (npm, Playwright browser, pip into `.venv`) happen in M0 while Stewart is present. Quiet flags: `npm i --no-audit --no-fund --loglevel=error`, Playwright install output to a log file.

## Commands and timeouts
- Every command finishes in under 9 minutes by design; pass an explicit Bash timeout on every `npm run`. Long work is split (see `docs/TESTING.md` section 1), never backgrounded.
- **Never end a turn with a background shell, server, watcher or subagent still running.** Never run `npm run dev` yourself; the harness starts Vite in-process on 127.0.0.1 and closes it in `finally`.

## The loop
1. Take the next task from `docs/PROGRESS.md` "Next 3 actions" (or the current milestone).
2. Implement the smallest slice that moves the milestone gate.
3. `npm run qa:fast` (under 2 minutes) directly, not via a subagent. Before each commit also run the scenario and replay layers touched.
4. Green: commit, update PROGRESS "Now" and "Next 3 actions". Red: fix. Same failure after 3 attempts: log under "Blocked", revert to last green if needed, move to an independent task.
5. Milestone exit: follow the ritual in `docs/ROADMAP.md`. Full QA at milestone exits and at least every 4 hours.
6. After M11, continue with `docs/BACKLOG.md` top down. The run does not end at M11.

## Token discipline (quota is the scarce resource)
- Prefer state over pixels: `getSummary()` JSON, harness reports, event logs. Images only per the flag policy in `docs/TESTING.md` section 8.
- Commands print a short summary and a final `RESULT:` line; full output goes to `reports/latest/`. Never dump logs, large JSON, manifests, replays or generated files into context. Query them with `node tools/harness/q.mjs <file> <path>` or grep.
- Read files in ranges; grep before reading; do not re-read files you just wrote.
- Use subagents for long or digging work only (table below) and ask for short conclusions. Write a script instead of repeating a manual task twice.
- Keep this file under 200 lines and PROGRESS "Now" under 25 lines.

## Subagents (`.claude/agents/`)
| Agent | Model | Use for |
|---|---|---|
| `qa-runner` | haiku | digging into failures of full QA layers or soaks, not routine qa:fast |
| `playtest-analyst` | sonnet | soaks, metrics, data-only balance proposals (max 2 passes per milestone) |
| `asset-producer` | sonnet | asset pipeline batches within budgets |
| `docs-keeper` | haiku | docs from a diff summary, DATA.md, PROGRESS tidy |
| `researcher` | sonnet | current API or library facts when something fails or is unknown |
| `milestone-reviewer` | opus at M3, M5, M7, M8, M11; pass `model: sonnet` for other milestones | adversarial review before tagging |

Run independent subagents in parallel, and wait for all of them before ending a turn. The main session owns architecture, sim code and final decisions.

## Decisions
Make the call yourself. Architecture, data shape or pinned-tool changes get an ADR in `docs/DECISIONS.md`. Prefer reversible choices and record the fallback.

## Environment notes (Windows 11, RTX GPU)
- `npm run doctor` at session start; it records whether Playwright screenshots work headless or need headed mode, and the WebGL renderer string.
- Blender runs only via `python tools/assets/blender_run.py ...` (path from `BLENDER_EXE`). Python packages go in the project `.venv`.
- Missing optional tools (Blender, any API key, VisionQA) disable that feature and get logged; they never block the core game.
- Shell commands written into docs for Stewart start with an explicit `cd` to the project folder.

## End-of-turn status line and the run sentinel
At M0, write `Run started: <ISO timestamp>` in PROGRESS "Now". End every turn with exactly one line:
`STATUS M<n>/M11 <milestone> | h:<hours since run start> | qa:<green|red|n/a> | stop-file:<yes|no> | next:<few words>`
(check `test -f STOP` each turn for `stop-file`).

The run sentinel is a private token. Do not write it anywhere, quote it, or mention it until the run is truly done. The run is done when `git tag --list "m*-done"` shows m0-done through m11-done and every P1 item in `docs/BACKLOG.md` is done or logged under "Cuts" (items blocked by a missing optional tool count once logged). Then put the token as the first line under "## Now" in PROGRESS, write the "State of the game" section, and end your message with the token on its own line. The token is the word HEARTHFALL, a hyphen, the word RUN, a hyphen, the word DONE, a hyphen, then 7Q.

# Compact instructions
When compacting, keep: current milestone and gate status, last green commit hash, run start timestamp, open failures with file:line, decisions made since the last PROGRESS update, and the next 3 actions. Drop: command output, file contents, images, research text. After compaction, re-read `docs/PROGRESS.md` before doing anything else.

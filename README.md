# Hearthfall kickoff package

Everything Claude Code needs to build **Hearthfall** (our original shaman god game) unattended for 24+ hours and keep growing it after.

## What is in here

| Path | What it is |
|---|---|
| `OPENING_PROMPT.md` | The first message to paste into Claude Code, plus the `/goal` line |
| `CLAUDE.md` | Claude Code's operating manual (loaded every session automatically) |
| `docs/DESIGN.md` | Game design: pillars, original names, loop, mana, units, buildings, spells, terrain, AI, UI, art |
| `docs/ARCHITECTURE.md` | Stack, repo layout, deterministic sim, data packs, renderer, debug API, perf budgets |
| `docs/ROADMAP.md` | Milestones M0 to M11 with exit gates that pass by command |
| `docs/TESTING.md` | Self-test harness: unit, scenario, golden replay, soak, perf, screenshot checks, flag policy |
| `docs/ASSETS.md` | Asset pipeline: Gemini, Meshy, Tripo, ElevenLabs, Blender, manifest, budgets |
| `docs/VISIONQA.md` | OpenAI Decisions API module: probe, checks, calibration, optional move picker |
| `docs/BACKLOG.md` | Prioritized work after the first 24 hours |
| `docs/DECISIONS.md` | Decision records (ADR-001: why TypeScript + three.js over Godot) |
| `docs/PROGRESS.md` | Claude Code's current state and memory across context compactions (history goes to `docs/PROGRESS_LOG.md`) |
| `docs/research/` | The four research reports behind every decision (mechanics, stack, Decisions API, asset APIs) |
| `seed-data/` | Starting numbers for units, buildings, spells, balance gates, AI personalities, palette |
| `.claude/agents/` | Six subagents (cheap models for QA, soaks, docs, assets, research; Opus for milestone review) |
| `.claude/settings.json` | Permission allowlist so routine commands do not stop the run |
| `.env.example` | Key names and budget caps |
| `.gitignore`, `.gitattributes` | Keep `.env` and generated files out of git; LF line endings so data hashes match |
| `extras/hooks/` | Optional Stop hook that keeps the run going if `/goal` is unavailable |

## Launch checklist (about 30 minutes)

1. **Extract the zip so it creates the project folder.** `hearthfall_kickoff.zip` contains one folder, `Hearthfall`, with everything inside it (including the hidden `.claude` folder). You extract into the **parent** folder `C:\Users\stewa\Documents\Claude`, and the `Hearthfall` folder appears there by itself. Do not create a `Hearthfall` folder first, or you will end up with `Hearthfall\Hearthfall`.

   **Option A, File Explorer:**
   1. In Downloads, right-click `hearthfall_kickoff.zip` and choose **Extract All...**
   2. Windows suggests a path ending in `\hearthfall_kickoff`. Replace the whole box with exactly `C:\Users\stewa\Documents\Claude` (otherwise Windows adds an extra `hearthfall_kickoff` folder level).
   3. Click **Extract**.

   **Option B, PowerShell:**

   ```powershell
   cd C:\Users\stewa\Documents\Claude
   Test-Path .\Hearthfall   # must print False; if True, rename the old folder first
   Expand-Archive -Path "$env:USERPROFILE\Downloads\hearthfall_kickoff.zip" -DestinationPath C:\Users\stewa\Documents\Claude
   ```

   **Check it landed right** (all three lines must match):

   ```powershell
   cd C:\Users\stewa\Documents\Claude\Hearthfall
   Test-Path .\CLAUDE.md               # True
   Test-Path .\.claude\settings.json   # True
   Test-Path .\Hearthfall              # False (no doubled folder)
   ```

   The project root is `C:\Users\stewa\Documents\Claude\Hearthfall`, with `CLAUDE.md`, `README.md`, `docs`, `seed-data` and `.claude` directly inside it. Do not extract into `Documents\Claude\Projects` (that is the junction to `ClaudeProjects`, which is on hold for the folder move) or anywhere under `OneDrive`.

2. **Check prerequisites:**

   ```powershell
   cd C:\Users\stewa\Documents\Claude\Hearthfall
   node --version     # need v22.18 or newer
   git --version
   git config --global user.name    # must print a name
   git config --global user.email   # must print an email
   git config --global commit.gpgsign   # must print nothing or false
   python --version   # need 3.11 or newer
   & "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --version   # optional, assets only
   ```

   If name or email is empty, set them yourself (`git config --global user.name "Stewart Gregerson"` and your email). Claude Code is told never to touch git config.

3. **Make the PC hands-free for 24+ hours** (any of these will silently stop the run):
   - Settings > System > Power: Screen off **Never** and Sleep **Never** while plugged in. You can still switch the monitor itself off.
   - Settings > Accounts > Sign-in options: "If you've been away, when should Windows require you to sign in again?" **Never**, and no screen saver lock.
   - Settings > Windows Update: **Pause updates for 1 week** so it cannot restart overnight.
   - Leave the Claude desktop app open and the PC on the network.

4. **Create `.env`:** in `C:\Users\stewa\Documents\Claude\Hearthfall`, copy `.env.example` to `.env` and paste key values yourself from your existing project `.env` files. Claude Code is told never to read this file. Set `BLENDER_EXE` if Blender lives elsewhere.

5. **Buy the $10 OpenAI credits** before starting; the Decisions cost probe runs in the first couple of hours. Without a key the game still builds; VisionQA just stays off. The ElevenLabs music endpoint needs a paid plan; if it is missing, the pipeline skips music and logs it.

6. **Optional but recommended: tell Auto mode what this project is allowed to do.** Auto mode can fall back to asking permission after repeated safety blocks, which would stall an unattended run. Project settings cannot set this, so it goes in your user settings file `C:\Users\stewa\.claude\settings.json` (create it if missing; if it exists, add the key alongside what is there):

   ```json
   {
     "autoMode": {
       "environment": [
         "$defaults",
         "Project C:\\Users\\stewa\\Documents\\Claude\\Hearthfall may call api.openai.com, api.meshy.ai, api.tripo3d.ai, api.elevenlabs.io and generativelanguage.googleapis.com with keys from its own .env, run npm, npx, node, python and git commands inside the project, and install packages from registry.npmjs.org, pypi.org and the Playwright browser download host"
       ]
     }
   }
   ```

   This is a change to your own Claude Code configuration, so it is your call; the build works without it but is more likely to pause for a click.

7. **Open Claude Code on the project folder** `C:\Users\stewa\Documents\Claude\Hearthfall` (the one that directly contains `CLAUDE.md`, not its parent) in the desktop app Code tab. When creating the thread pick the model (Opus 5.5 recommended for the main session) and **High** effort, since effort can only be set when the thread starts. In the permission mode selector pick **Auto**.

8. **Paste the opening prompt** from `OPENING_PROMPT.md`, then send the `/goal` line as the second message.

9. **Stay for the first 20 to 30 minutes**, until the M0 installs (npm packages, Playwright browser, Python venv) finish and the first commit lands. Approve any permission prompt that is plainly safe (npm, node, python, git commit) with "always allow". After that it should go hands-off. If a browser window flashes open now and then, that is Playwright taking screenshots in headed mode.

## While it runs

- Progress at a glance: `docs/PROGRESS.md` ("Now" section) and `git log --oneline`.
- Try the game any time: `cd C:\Users\stewa\Documents\Claude\Hearthfall` then `npm run dev` and open the printed `http://127.0.0.1` link.
- **To stop the run cleanly:** create an empty file named `STOP` in the project folder (the next turn reports it and the goal ends), or type `/goal clear` in the session.
- Spend tracking: `npm run visionqa:spend` and `tools/assets/ledger.jsonl`.

## What to expect after 24 hours

A playable skirmish on a curved, wrapping planet against three AI personalities, 8 spells including terrain shaping and Volcano, settlers who build and breed, three troop types with a counter triangle, menus and save/load, generated models and audio where budgets allowed (placeholders elsewhere), and a test harness that keeps future changes honest. `docs/PROGRESS.md` will end with a "State of the game" section and the top next items.

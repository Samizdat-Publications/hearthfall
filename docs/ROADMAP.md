# Roadmap for the first 24+ hours (living)

Work top to bottom. A milestone is done only when its **exit gate** passes by command, not by opinion. After M11, continue with `docs/BACKLOG.md` in priority order. The run does not stop when the roadmap ends.

**Hard vs soft gates.** Hard gates (must pass): tests, determinism, replays, invariants, screenshot checks, e2e, performance budgets, functional AI behavior. **Balance numbers are soft**: after at most 2 `playtest-analyst` passes (45 minutes total) record the numbers under "Balance gaps" in PROGRESS, tag, and move on.

**Pacing (cumulative hours from run start):** M0 1.5, M1 3.5, M2 5.5, M3 8, M4 10.5, M5 13, M6 15, M7 17.5, M8 19.5, M9 21, M10 22.5, M11 24. If you are more than 2 hours behind, cut the current milestone to its minimum gate, log the cut under "Cuts", and move on. The priority is a playable skirmish against an AI as early as possible; polish comes after.

The asset track (A0 to A4, `docs/ASSETS.md` section 5) runs in parallel via the `asset-producer` subagent and never blocks a code milestone.

## Milestone exit ritual (every milestone)

1. `npm run qa` until it prints PASS (layers that exist so far); soak where the milestone says so.
2. `docs/PROGRESS.md` "Now" updated (shipped, cut, known issues, next 3); one dated line appended to `docs/PROGRESS_LOG.md`.
3. `docs/DATA.md` regenerated; other docs touched by the change updated in the same commit.
4. If the milestone changed visuals, view its contact sheet once and log up to 3 visual improvements. Archive that sheet plus the best single shot (as `--highlight`) with `npm run making-of -- add` (storyboard in `making-of/README.md`).
5. Spawn `milestone-reviewer` with `git diff --stat` since the last tag plus at most 8 key files and the report paths (Opus at M3, M5, M7, M8, M11; Sonnet otherwise). Fix blockers, log the rest to BACKLOG.
6. Commit, tag `m<n>-done`.

---

## M0: Bootstrap and doctor (about 1.5 h)
- npm workspaces skeleton per `ARCHITECTURE.md` section 2, TS strict, Vite app that renders a colored test scene, Vitest, Playwright pinned, Preact.
- `tools/harness` CLI skeleton with the output contract (`RESULT:` line), timeouts, `reports/latest/`.
- Guards: determinism scan (Math allowlist, no `**`), import-direction scan, data schema validation, docs freshness, IP-name scan (`tools/guards/ip-names.mjs`), dash-character scan over docs/, data/, packages/ui/ and apps/.
- Generate `packages/sim/src/dmath_tables.ts` once with a script and commit it as literal numbers.
- `npm run doctor` complete (TESTING section 9). Record which screenshot mode works (headless or headed).
- Write `Run started: <ISO timestamp>` into PROGRESS "Now". `.env.example`, `.gitignore`, `.gitattributes` already exist; git init, first commit.
- Do every network install now while Stewart is present: npm packages, Playwright Chromium, Python `.venv` with `tools/assets/requirements.txt`.
- Copy the seed data from `seed-data/` into `data/base/`, write zod schemas that accept it (reshape fields if needed, keep the values), `npm run data:check`.
- ADR-002 recording exact tool versions installed.
- Kick off asset track A0 via subagent. Run `npm run visionqa:probe` (VISIONQA section 3) once the harness can capture a shot (may slip to M2).
- **Gate:** `npm run check` and `npm run doctor` print PASS (WARN lines allowed); the doctor's WebGL capture passes the blank check.

## M1: Simulation core and terrain (about 2.5 h)
- Seeded PRNG streams, fixed 20 Hz tick, Command bus, events, `hash()`, snapshot.
- Torus heightmap with all terrain ops and dirty rects; sea level; scar map; buildability and walkability queries.
- Procedural planet generator (seeded noise, islands and continents presets, tree placement).
- Scenario runner with the assertion DSL; golden replay record and compare; `replays:rebless`.
- **Gate:** unit tests for every terrain op including wrap seams; 3 scenarios; 1 golden replay; `npm run qa:fast` PASS.

## M2: Renderer v1 and capture pipeline (about 2.5 h)
- Three.js WebGLRenderer behind the `Renderer` interface; chunked terrain with height-band vertex colors; water plane with shoreline; curved-world bend; seamless wrap; sky and fog.
- Camera rig: orbit, rotate, zoom to globe, map view toggle, bookmarks.
- `window.__game` debug API, URL params, `frames()` counter, debug breakage flags.
- `npm run shot` with the smoke shot set, pixel checks, contact sheet, baselines; DOM layout check scaffold.
- VisionQA probe and calibration if not done (provider stays `off` if anything fails).
- **Gate:** smoke shots pass blank and coverage checks including a wrap-seam shot and a globe-zoom shot; contact sheet viewed once and approved; terrain edit in the running game updates only dirty chunks (assert via debug counter).

## M3: Units, movement, selection (about 3 h)
- Entity SoA storage, Settler and Shaper kinds, spatial hash on torus.
- Pathfinding: cost field, sectors and portals, flow fields, steering and separation; path invalidation on terrain change; drowning.
- Input: selection (click, box on curved surface, groups), move orders, attack-move stub.
- Instanced placeholder units with tribe tint and toy animation; interpolation.
- **Gate:** scenarios for pathing across ridges and around water, wrap-around pathing, drown on push; soak invariant "no stuck unit" holds for 1000 wandering units over 10 game minutes; `npm run bench` meets the tick budget with 2000 wandering units.

## M4: Economy and construction (about 3 h)
- Trees and wood, chopping, regrowth; build plans; footprint flattening by settlers; dwellings (3 sizes, auto-upgrade); breeding with population cap.
- Mana income by follower state, sinks (spell charging, training queue), split slider, charges.
- Settler autonomy with the tribe priority panel; Hearth (destructible, see DESIGN section 4).
- Wild people: the planet generator spawns 6 to 10 wandering wild people per tribe (targets for Call in M5).
- Deterministic **economy bot** in `packages/ai` (places dwelling plans, keeps settlers busy) so headless economy scenarios have someone making decisions; M7 builds on it.
- HUD v1: population, mana income and split, spell charge display (placeholder icons).
- **Gate (hard):** economy bot grows an unharassed tribe every minute for 10 game minutes with no invariant violations; mana math unit tests; DOM layout check passes on HUD shots. **Soft:** population near the balance target at minute 10.

## M5: The Shaper and spells v1 (about 3 h)
- Shaper control, death, respawn at Hearth, charge steal on kill, elimination rule.
- Effect primitives: damageRadius, damageBuildingsRadius, knockback (water kills), terrainOp (incl. ridgeLine, flattenToAverage, noiseScar, crater), convertRadius, statusApply (panic), spawnEntity, areaOverTime, scar.
- Spells as data: Bolt, Call, Lightning, Raise Land, Flatten, Quake, Hornets, Volcano. Cast range, previews on the curved surface, cancel, misclick undo.
- Placeholder VFX per primitive.
- **Gate:** one scenario per spell asserting its effect; shot set includes each spell mid-cast and passes checks; replay determinism holds with spells.

## M6: Combat and troops (about 3 h)
- Warden, Firecaller, Chanter (with the entranced status while chanting); lodges and training queue; Watchtower garrison and height range bonus; stances, attack-move, rally points, retreat to tower; conversion rules and interruption.
- Combat events feed audio hooks (silent stubs until A3 lands).
- **Gate (hard):** no invariant violations over 8 seeds x 20 minutes; each counter matchup produces a winner. **Soft:** counter triangle at the balance target (TESTING section 5 defines the matchup).

## M7: Opponent AI (about 3 h)
- Utility AI framework and three personalities from data (aggressive, sneaky, turtle); scouting, build orders, army composition, attack waves, spell use including terrain attacks, Shaper protection.
- Test bot personalities (rusher, turtle, spell spammer, random legal).
- **Gate (hard):** each personality eliminates an idle opponent within 25 game minutes on 4 seeds; AI uses at least 3 spell types and attacks with mixed troops in soak logs; no invariant violations over 8 seeds. **Soft:** win-rate spread, match length and stalemate rate at their balance targets.

## M8: Game flow and UI (about 2 h)
- Main menu, skirmish setup (map size, seed, opponents, difficulty), pause, settings (quality, audio, keybinds), win and loss screens, save and load (snapshot + command log).
- HUD v2: minimap with curvature-aware markers, selected units panel, notifications, spell bar with ETA and waste warning, objectives.
- **Gate:** Playwright e2e: menu to skirmish to forced win via debug to menu, with no console errors; DOM layout checks pass at 1280x720 and 2560x1440; save then load reproduces the same hash.

## M9: Worship and levels (about 2 h)
- Shrine, Reliquary, Totem; level data format (map, tribes, objectives, triggers, unlocks); campaign progression save.
- 3 handcrafted teaching levels (raise land, shrine race, defend against a rush) plus the procedural skirmish.
- **Gate:** each level has a scenario proving its objective is completable by a scripted bot; level files validate.

## M10: Asset and audio integration (about 2 h)
- Renderer loads GLB assets by manifest id with fallback; tribe tint on real meshes; icons in HUD; SFX and music layers via `packages/audio` driven by events; volume settings.
- **Gate:** full shot set re-baselined after a contact sheet review; `npm run bench:render` within budget with real assets; no missing-asset warnings for v1 content (or placeholders logged).

## M11: Polish, hardening, handoff (about 2 h, then continue)
- Visual polish pass (lighting, fog, water, spell VFX, unit readability at all zooms), performance pass, error handling, loading screen.
- Production build (`npm run build`) served statically; optional Electron packaging spike if time allows (otherwise BACKLOG).
- Docs complete and current; BACKLOG re-prioritized with findings; final `npm run qa`.
- **Gate:** `npm run qa` PASS, PROGRESS has a "State of the game" section written for Stewart (what works, how to play, known issues, top 5 next items).

## After M11
Continue with `docs/BACKLOG.md` top down, one item per commit cycle, same gates and rituals. Re-run the full soak and shot sets every 3 backlog items.

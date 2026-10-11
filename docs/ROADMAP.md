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

## Leg 5 (planned in S4): LAN play (BACKLOG 15)
Goal: two people on one home network play Hearthfall together, first head to head, then side by side against the AI. The sim is already deterministic and every action is a Command, so this is lockstep: each peer runs the full sim and only Commands cross the wire. No new npm dependencies (Node 24 and browsers ship WebSocket clients; the relay speaks the WebSocket handshake and framing itself).

- **L5-A Lockstep core** (`packages/net`, pure, unit tested with an in-memory transport): input delay D ticks (data, `balance.net`), every peer sends one batch per tick (empty batches too), a tick runs only when every peer's batch for it is in, batches apply in peer order then command order. State hash exchange every N ticks; a mismatch stops the match with a desync report (tick, both hashes, the last commands) written for the harness. Gate: two cores on a loopback transport with random latency and reordering finish 10 minutes of a bot skirmish with equal hashes every tick, and a forced divergence is caught within N ticks.
- **L5-B Relay** (`tools/net/relay.mjs`, mounted at `/net` on `npm run serve`): rooms by a short code, fan-out of batches in arrival order, no game logic. `npm run serve -- --lan` binds 0.0.0.0 on purpose (opt-in, prints the LAN URL); the default stays 127.0.0.1. Gate: relay unit tests (handshake, framing, rooms, close) and a two-client Node test.
- **L5-C Versus over LAN**: main menu Play together: Host (room code shown) or Join (type the code); skirmish setup is the host's, peers get the map seed and params in the start message. `Game.role` becomes "peer" on the joiner (no debug hook), the host checks peer commands with `peerCommandRefusal`. Gate: an e2e with two Playwright pages on one relay plays 3 minutes with bots in both seats and equal hashes; a closed peer shows a readable "your partner left" end screen. Done (S4): the e2e plays 300 ticks with orders from both pages and a forged order instead of 3 minutes of bots (the 3600 tick bot match runs in the L5-A unit test, which is cheaper and checks every 20 ticks the same way); `vite preview` in the harness carries the relay too.
- **L5-D Teams in the sim**: `teams` in match params (default every tribe alone), hostility reads the team, shared victory and defeat, allied fog sharing as a data flag. Reuses for 2 v 2 AI skirmishes. Gate: scenarios for allied units not fighting, team victory, team fog; goldens unchanged when teams are absent. Done (S4).
- **L5-E Co-op against the AI**: Host can seat the partner on the player's team against 1 to 2 AI tribes; a co-op skirmish preset. Gate: e2e co-op 3 minutes with equal hashes, soak of 2 bot partners vs 2 AI. Done (S4): no separate preset, the setup's rivals (any count) become team 1 (`coopParams`); the opponent AI and the war bot are team aware (packages/ai/test/teams.test.ts, 2 v 2 AI); the soak is a unit test (two hard bot partners vs two AI, conquest to the end, zero friendly hits) and the e2e co-op run plays 300 ticks like L5-C.
- **L5-F Robustness**: late join refused after start; pause when a peer stalls past a timeout; reconnect by snapshot (the host sends a save at a tick, the peer loads and resumes); desync report download. Gate: e2e kills a peer socket and reconnects. Done (S4): late join is refused by the relay (a dropped seat may `rejoin` its own seat); the match pauses on its own while a partner stalls (the lockstep waits) and a banner says why; a partner whose socket drops rejoins and the host restarts the lockstep from a snapshot at its tick (chunked over the relay's `ctl` channel, the host's unsent orders carried over); the host waits `balance.net.rejoinWaitSeconds` (button to stop waiting) and then the AI takes the tribe; a partner who quits on purpose says bye so the AI takes over at once; a desync end screen downloads a report (tick, hashes, params, the last 400 commands). The e2e drops the partner's socket in both LAN runs.
- Later in the leg: campaign co-op (done S4: both seats share tribe 0 of the host's next open level, so hand-made levels keep their layout and balance; `campaignCoopParams`, humans [0, 0]; after the level both go back to the lobby), and a public relay only if Stewart asks (out of scope: no deploys without him).

## Leg 6 (planned in S4): ready for people
Goal: the game holds up when Stewart and a partner sit down with it: LAN matches leave watchable replays, the level engine covers what the S4 level agents had to work around, the look follow-ups from 14a and 14c are closed, and a playtest kit says what to try. Sim and AI changes wait until the S4 campaign rerun has landed (it tunes against the current engine), then every level scenario reruns.
- **L6-A LAN replays**: a LAN match's replay plays back on either computer: every seat's commands are already logged; an AI takeover is recorded as a controller change at its tick (`Replay.controllerChanges`) and playback attaches it there; a resync restarts the rejoined page's replay from the snapshot. Gate: e2e watches the ended LAN match's replay to a verified end on both pages; unit test for a takeover replay.
- **L6-B Look follow-ups** (14a, 14c): golden thatch instead of orange (per-model shift or re-snap), snow that reads white under the warm sun, the small v3 hut without its baked ground plate, and a tilt-shift blur strength check from shots. Gate: before and after shots in making-of, shot set green. As built: `style.render.modelFix` per model (color remaps above a height fraction: the v3 dwelling roofs go from the skin brown the palette snap picked to golden straw; `dropPlate` removes the small hut's baked ground plate), `terrainBands.snowTint` with `snowBright` 1.7 reads neutral white on peaks; blur kept at maxBlur 2.5 and depthWeight 0.6 (at default zoom the play area stays sharp, the blur lands on unexplored ground, sea and the globe's curve). Tests in packages/render (models, terrainBands); before and after pairs in making-of/s4.
- **L6-C Level engine gaps** (after the rerun): the level bot works `build` objectives; `raid` takes the troops a trigger just spawned (`fresh`); the opponent AI leaves units on a scripted raid alone (praying raiders); an attack wave leaves a vehicle home for worship trips; map paint `cone` and `ridge` shapes; per-tribe building lists (`tribes[].buildings`). Gate: one scenario per primitive, every level scenario green. As built (S4): a flow field Dijkstra cascade (float64 compare against float32 distances) froze wolf_country behind a rising causeway; fixed with Math.fround, regression test, levels layer 390 s to 202 s. New: `kill` objective, `followers` `fromStage`, trigger `until`, repeating triggers skip a fallen tribe, raid `fresh`, the level bot plans `build` goals first (crossing and support buildings keep the AI's own timing), `tribes[].keepRaiders` (off by default), map paint `cone` and `ridge`, `tribes[].buildings`; unit tests in sim levelgaps.test.ts and ai opponent.test.ts, levels 51/51. Deferred: a wave leaving a vehicle home, destroyTarget off the home landmass (PROGRESS Cuts).
- **L6-D Playtest kit**: How to play gains a Play together page; `docs/PLAYTEST.md` for Stewart (start a LAN match, what to try in versus, co-op and the campaign together, what to write down); the PROGRESS "First human playtest" section points to it. Gate: e2e opens the new How to play page; docs guard green.
- **L6-E Balance**: jitter in the equal-number counter probe and a counter triangle retune toward the 65 to 80 band (Balance gaps), playtest-analyst passes only. Gate: soak triangle and ai soak inside their bands or logged.
- Out of scope without Stewart: Electron build (needs an npm install of a large binary), a public deploy or relay.

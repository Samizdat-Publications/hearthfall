# Decision records

Append new ADRs at the bottom. Format: context, decision, consequences. Never rewrite an old ADR; supersede it.

## ADR-001: Stack is a pure TypeScript simulation core + three.js WebGL renderer + Node test harness (10/08/2026)

**Context.** Hearthfall's build runs autonomously for 24+ hours on Stewart's Windows 11 PC (RTX GPU) and then grows for weeks. The top criterion is how well Claude Code can verify its own work without a human; then extensibility, how reliably models write correct code for the stack, graphics and performance for 2000 units, and asset import. Candidates: Godot 4.7.2 (GDScript or C#), TypeScript + three.js r186 or Babylon 9, and a hybrid with an engine-agnostic sim core. Evidence was gathered by running each in a sandbox: `docs/research/stack_options.md`.

**Decision.** TypeScript everywhere. Deterministic simulation in `packages/sim` with no DOM or renderer imports, run headless in Node for unit, scenario, replay, soak and perf tests. Rendering with three.js `0.186.1` **WebGLRenderer** behind a `Renderer` interface. Playwright `1.64.0` Chromium for screenshots and browser e2e, with the game exposing `window.__game` state JSON. Vite for dev and build. Electron for a desktop exe later.

**Why.**
- The whole sim, AI and bots run in plain Node: fastest and cheapest self-testing loop, verified deterministic, and roughly 6x faster than the same trivial sim in GDScript in the sandbox measurement.
- Screenshots, state reads and DOM layout checks are all automatable from one tool (Playwright). Godot's `--headless` mode has no rendering at all (verified: image capture returns null), so Godot screenshots need a real window; workable on Windows but a weaker automation story.
- TypeScript and three.js are the most heavily represented in model training data; Godot 4 GDScript tends to drift toward Godot 3 syntax.
- Stewart's previous game builds were Node.js; web-first gives a shareable URL later, Electron gives an exe.
- A renderer-agnostic sim keeps the engine choice reversible: if the visual ceiling ever demands Godot, the sim can be ported or driven over a socket.

**Consequences.**
- Graphics ceiling is lower than Godot's; acceptable for a stylized low-poly look; budget polish time for lighting, fog and VFX.
- JavaScript is single threaded: SoA typed arrays, budgets and a Worker-ready snapshot API from day one.
- WebGPU deferred (headless captures blank; drops `onBeforeCompile` used by the curved-world bend).
- Pins on three and Playwright; no unprompted upgrades.
- Runner-up if this fails: Godot 4.7.2 with strict typed GDScript, sim in `RefCounted` classes tested by GUT 9.7.1, windowed screenshot capture.

## ADR-002: Exact tool versions installed at M0 (10/08/2026)

**Context.** ARCHITECTURE section 1 pins three and Playwright and asks for the rest to be recorded.

**Decision.** Installed and locked in `package-lock.json`:

| Tool | Version | Note |
|---|---|---|
| Node | 24.19.0 | newer than the 22.18 floor in `engines`; Node type stripping is on by default |
| npm | 11.17.0 | workspaces |
| TypeScript | 7.0.2 (exact) | native compiler, `tsc -p tsconfig.json` |
| Linter | none | tsc plus plain-script guards (ARCHITECTURE section 1) |
| Vite | 8.3.4 | JSX via the built-in oxc transform (`importSource: preact`), no Babel plugin |
| Vitest | 5.0.3 | |
| three | 0.186.1 (exact) | @types/three 0.186.0 |
| @playwright/test | 1.64.0 (exact) | chromium-headless-shell 156.0.8078.4 (build 1248) |
| Preact / @preact/signals | 11.0.1 / 2.11.3 | |
| zod | 4.6.5 | `z.toJSONSchema` generates data/schema |
| pngjs / pixelmatch | 7.0.0 / 8.0.0 | pixel checks |
| Python | 3.14.3 | project `.venv`, `tools/assets/requirements.txt` |
| Blender | 5.1.2 | 5.2 LTS is not installed on this PC; the pipeline falls back to the 5.1 path |

**Consequences.** Upgrades of pinned or major versions need their own commit, full QA and an ADR. Blender 5.1 vs 5.2 differences are watched by the asset track; if a 5.2-only API is needed, log it.

## ADR-003: Node runs the TypeScript packages directly via type stripping (10/08/2026)

**Context.** The harness (plain `.mjs`) must run the sim, data and AI headless without a build step or a transpiling loader.

**Decision.** All TypeScript is written as erasable syntax only (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`; no enums, namespaces or parameter properties) and relative imports carry the `.ts` extension. Node 24 strips types natively, so `tools/harness` imports `packages/*/src/*.ts` directly; Vite and Vitest consume the same files.

**Consequences.** No `dist` for packages and no loader dependency. Workspace packages export `./src/index.ts`. If a future Node drops or changes stripping, fall back to running the harness under `vite-node` or a one-file esbuild bundle (reversible, harness only).

## ADR-004: Pathfinding v1 is grid A* plus flow fields, hierarchical sectors deferred (10/08/2026)

**Context.** ARCHITECTURE section 3 sketches hierarchical pathfinding (16x16 sectors with a portal graph) plus flow fields and steering. The default map is 128 x 128 (16k vertices) and the M3 gates are performance budgets and the no-stuck soak.

**Decision.** v1 uses A* on the full vertex grid for individual orders (8-connected, no corner cutting, slope-weighted cost, octile heuristic with torus wrap, string-pulled waypoints), 8-connected component labels so unreachable goals fail in O(1), a per-tick node-expansion budget for fairness, and Dijkstra flow fields for group orders (cached until the terrain changes). Separation uses a torus spatial hash. Stuck detection measures progress along the route (remaining waypoint distance or flow-field value), repaths after `repathSeconds` and gives up after `giveUpSeconds`. All tunables live in `balance.json` `movement`.

**Consequences.** Measured at M3: 2000 wandering units average about 3.3 ms per tick with an algorithmic p99 of about 2.2 ms; 8 seeds x 10 minutes x 1000 units soak clean. Maps of 256+ cells or many simultaneous long orders may need the sector and portal layer: add it behind `Pathfinder` (same API) when `npm run bench` warns. Fallback if A* cost grows: cap per-search expansions lower and resume searches across ticks.

## ADR-005: Art direction v2, retro pixel look on the 3D build (10/08/2026)

**Context.** Stewart asked for a 90s nostalgia, almost pixelated look on a modern build, generated 7 Gemini candidates (archived in making-of/a1 as retro-candidate-1 to 7) and asked which is feasible. Candidates 1, 4, 5 and 7 are 2D pixel art and candidate 2 is HD-2D sprites: they need hand-made or PixelLab sprite sets in many directions and animations, and sprites fight the deformable curved terrain that is the game's core pillar.

**Decision.** Stay 3D. Benchmark = candidate 3 (stylized low-poly planet with pixel-textured surfaces, dusk light, pixel fire), with candidate 6's crisp dithered shading and candidate 5's stone and wood HUD frame. Implementation: a retro render pass in packages/render (render target at 1/2 to 1/4 resolution, nearest-neighbor upscale, palette quantization with ordered dithering, optional outline), low-res nearest-filtered detail textures on terrain bands and thatch, warm point light at hearths, cooler ambient, shadows. All knobs in style.json (pixel scale, palette size, dither strength) so the look is tunable and can be switched off. PixelLab stays unused.

**Consequences.** Existing GLB assets and placeholder meshes keep working under the pass. Shot baselines are re-approved once when the pass lands. Fallback: pass off (current flat-shaded look).

### ADR-005 addendum (10/08/2026)
Stewart's pick (Downloads file "... - stewarts pick.jpg") is candidate 1, not 3. Candidate 1 becomes the target look (composition, space sky, terraced cliffs, foamy sea, stone-framed HUD layout); candidate 3 stays the technique reference for how a 3D build reaches it. Still no sprites and no PixelLab.

### ADR-005 addendum 2: look v2 (10/09/2026)
Pushed the 3D build toward candidate 1 without new assets: a dark starry space backdrop (style.json `render.space`) with the planet limb fading to an atmospheric rim instead of a golden horizon; a steeper camera rig with stronger bend (pitch 0.78 + 0.62 zoom, bend 0.004 + 0.026 zoom squared, default zoom 0.42) so the curve and space show at play zoom; turquoise sea with world-anchored drifting foam strokes (`render.foamStrokes`); brown earth cliff strata on steep faces (palette `cliff`, `cliffDark`); HUD layout v2 (Shaper portrait and mana/followers bars top-left, spells top-center, build column right, minimap with population bottom-right). Fallback: drop `render.space` and set `foamStrokes` 0 to get the v1 sky and water; the camera curve is in packages/render/src/camera.ts. Baselines re-approved for smoke and spells.

## ADR-006: Combat model v1 (10/09/2026)

**Context.** M6 needs melee, ranged and conversion troops, stances, training and garrisons, plus answers to three M5 review questions: what happens to an eliminated tribe's people, whether troops can kill the Shaper, and how she recovers from chip damage.

**Decision.** A single `CombatSystem` (packages/sim/src/combat.ts) runs after spells and effects each tick. Per-unit state lives in hashed entity columns (target, cooldown, stance, mode, anchor point, trance, chant, last hit tick). Targets come from the existing spatial hash with a preferred-type bonus and an index tiebreak, so acquisition is deterministic. Chases steer directly while the line is walkable and fall back to A* on a repath cadence. Ranged splash falls off from the center, a min range stops point-blank fire, and a short knockback immunity stops massed fire from pinning a unit. Troop damage is lethal to the Shaper; she regenerates after a delay out of combat. An eliminated tribe's people leave every building and become wild (tribe -1); a tribe that never had a Hearth (test fixtures) keeps its units. Conversion ignores the population cap. Training is mana-gated through the training sink, so trainDemand is real (unpaid queued cost minus banked training mana) and recomputed each tick before mana distribution. All tunables are in `balance.combat` and per-unit blocks.

**Consequences.** Golden replays were reblessed (new hashed columns). The counter triangle is measured by `runMatchup` (flat map, 10 versus 10, attack-move, 90 s): warden over firecaller 9 of 10 seeds at first, 10 of 10 after the M6 acquire changes (idleAcquireSeconds, LOS path shortcut), firecaller over chanter 10 of 10, chanter over warden 10 of 10. Fallbacks: splash falloff and knockback immunity are data (set to 1 and 0 to disable); `eliminatedUnitsBecome` only allows "wild" today; the enum leaves room for a freeze or die variant.

## ADR-007: Opponent AI is utility scoring over data personalities; test bots live in code (10/09/2026)

**Context.** M7 needs three opponent personalities from `ai_personalities.json`, spell use including terrain attacks, Shaper protection, and four test bots for soaks. Spell targeting could be hardcoded per spell id, and the test bots could be extra personalities in the data pack.

**Decision.** `OpponentAI` scores a fixed list of nine actions from the personality numbers each decision, adds difficulty noise from the `ai` rng stream and runs the best ones (score at least 0.5, at most three) as ordinary Commands; cadence comes from the difficulty's `reactionSeconds` (the controller runs every tick and gates itself to `round(reactionSeconds * tickHz)`, because World reads `every` before the difficulty is known). Spells carry an optional `aiTarget` (units, buildings, wild, bridge, none) in `spells.json` so the AI picks targets by kind, never by spell id. The rusher and turtle test bots are OpponentAI presets in `packages/ai/src/testBots.ts`, not data, because they are fixtures with extreme numbers that must not appear in the M8 skirmish opponent list; the spell spammer and random legal bots are small controllers there too.

**Consequences.** New personalities and new spells need data only. Controller stats live outside the sim and are never hashed, so soaks can read them without touching replays. Fallback: move the test presets into a `testPersonalities` data block if a mod ever needs them.

## ADR-008: Save games are a world snapshot plus controller state, checked by hash (10/09/2026)

**Context.** M8 needs save and load that reproduce the same game. Options: replay the full command log from tick 0 (small files, but loading a long match means re-simulating it, and OpponentAI state would have to replay too), or store the state.

**Decision.** A save (`apps/game/src/session.ts`, `SAVE_VERSION` 1) holds the skirmish params, `World.snapshot()` (typed arrays as base64, non-finite numbers kept), each controller's optional `saveState()` (OpponentAI: known enemies, scout target, stats), the commands queued for the next tick, the tail of the local command log (debugging and future replays) and the world hash. Loading rebuilds the WorldInit from the params, restores the snapshot, recreates the opponents from the params, hands each its state back and refuses the save when the pack hash or the world hash differs. Saves live in localStorage slots (three) with a small meta entry for the list.

**Consequences.** Loading is instant and a loaded game has the same future as the saved one (unit test: save at 150 s, load, step 90 s with a pending command, hashes match; e2e: same tick and hash in the browser). Saves are tied to the data pack hash, so a balance change invalidates old saves with a readable message. A controller with private state must implement `saveState` and `loadState`. Fallback: if saves grow past localStorage limits on big maps, compress the snapshot or move slots to IndexedDB.

## ADR-009: Worship sites and campaign levels are sim state driven by data (10/09/2026)

**Context.** M9 adds Shrines, Reliquaries and Totems, a level format and three teaching levels. Worship could live in the app (scripted UI events) or in the sim; levels could be generated maps with hand placement or handmade maps.

**Decision.** Worship objects are `CAT.worship` entities with a `WorshipSystem` record (`packages/sim/src/worship.ts`), kinds and tuning in `buildings.json` `worship` (optional fields, so frozen packs keep their hash). Levels are `data/levels/<id>.json` (`LevelSchema`, cross-checked by `validateLevel` and the data guard): a flat map at `landAboveSea` with painted discs and rectangles (`MapSpec.paint`), per-level spells and buildings, setup (worship objects take a `site` spec), objectives (eliminateAll, worship, survive, followers), lose conditions (eliminated always, timeLimit, siteLost, hearthLost) and triggers (time, worship, objective) whose actions share the worship reward vocabulary (charges, unlockSpell, unlockBuilding, spell, spawn, raid, message). `LevelRuntime` runs in step 9 after worship; its outcome, objectives and fired triggers are hashed and snapshotted; `WorldInit.level` rebuilds it on restore. Campaign carry (spells, buildings from won levels) is applied at creation for the player only. Opponents in levels are OpponentAI; it gained a worship action that only joins its action list on maps with sites, so the noise draws and every existing replay are unchanged.

**Consequences.** Levels replay and save like skirmishes, and each level has a scenario (`"level": "<id>"`) proving it can be won (and one proving it can be lost). Handmade maps are limited to painted shapes; a level editor or heightmap import can replace painting later without changing the runtime. Fallback: if levels need richer scripting, add trigger conditions and actions to the union; the evaluation order (triggers, objectives, outcome) stays fixed.

## ADR-010: Skirmish earns the eight later spells at Reliquaries between the Hearths (10/09/2026)

**Context.** BACKLOG 1 adds Veil, Ward, Beguile, Whirlwind, Mire, Erode, Firerain and Wraith. In campaign levels they unlock through level data. Skirmish maps are generated and had no worship sites, so the new spells would either be unreachable or start unlocked (16 spells from minute one, against DESIGN section 10: stronger spells come from Shrines and Reliquaries).

**Decision.** `balance.skirmishWorship` (optional, so frozen packs keep their hash) places Reliquaries on generated maps when units are populated and there is no level: one at the midpoint of each pair of Hearths and one at its opposite on the wrapped planet (both equally far from the two Hearths), each moved to the nearest dry cell with its prayer ring on land, at least `minHearthDistance` from every Hearth and `minSpacing` from each other, at most `maxSites`. Sites take the `sites` list in turn: the first teaches veil, ward, beguile and whirlwind, the second mire, erode, firerain and wraith. The opponent AI already worships when sites exist, and its auto-charge setup now runs every decision so a newly taught spell starts charging. Hotkeys gain a second row (Shift+Z X C V B J K L) so all 16 spells fit the bar (BACKLOG 53).

**Consequences.** Every skirmish now has contested ground in the middle, which changes match flow and the soak numbers (the goldens were reblessed; the balance pass, BACKLOG 7, tunes the rest). Flat test maps have no Hearths, so scenarios and old replays are unchanged. Fallback: set `maxSites` to 0 to turn the sites off, or set `economy.skirmishSpells` to `"all"` to have every spell unlocked from the first tick.

## ADR-011: Fog of war is a sim system the AI reads, drawn by one shared shader rule (10/09/2026)

**Context.** BACKLOG 3 asks for fog of war, scouting and an AI that respects it. The AI used to read the whole world. Fog could be render only (cheap, but the AI would still cheat) or sim state (deterministic, hashed, shared by AI and renderer).

**Decision.** `VisionSystem` lives in the sim: per tribe explored and visible grids at 2 map cells, recomputed every 0.5 s from units and buildings with data sight radii, hashed and snapshotted when on. Commands never check sight (a player may cast into the fog, as in the genre); the AI filters what it reacts to through `seesEntity` and `seenEntity`, and only a difficulty with `mapHack` (brutal) skips that. A tribe without a Hearth is revealed to all, so endgames do not stall on a hidden Shaper. Buildings show wherever their ground was ever explored (v1 shortcut: a building put up later in explored but unseen ground shows too; a per tribe last-seen memory is the upgrade). The renderer applies one fog rule in the shared bend fragment, so terrain, water, trees, props and units darken together; `reveal=1` is render only.

**Consequences.** Live-pack worlds hash the grids; golden replays run on their frozen packs, which have no vision block, so they kept their hashes (fog determinism is covered by the snapshot and restore test in `vision.test.ts`). The ai-idle and ai soaks still pass (the AI already scouts start sites). Spell and combat shot scenarios pass `reveal=1`. Fallback: `balance.vision.enabled: false` turns it off everywhere.

## ADR-012: Units animate procedurally in the vertex shader before any rig and bake (10/09/2026)

**Context.** BACKLOG 5 asks for animated units: rig the Meshy unit meshes, generate eight clips, bake them to vertex animation textures in Blender for the instanced meshes, within the render bench budget. Blender 5.1.2 is present, but a rig and bake route means paid rigging calls per unit, a clip library per model, a texture per model and a new shader path, and it would only pay off at close zoom. The game is played at mid zoom behind the retro pixel pass (pixelScale 3), where a unit is about 20 to 40 pixels tall.

**Decision.** Animate the existing static meshes procedurally. Every unit geometry gets a per-vertex `aRig` attribute (model height, x as a share of it) and every instance a pose `instanceAnim` (leg swing, torso pitch, right arm raise, both arms raise). The unit material is the prop material plus a vertex chunk (`UNIT_ANIM_VERTEX` in `packages/render/src/unitAnim.ts`, injected after `begin_vertex` by `bendMaterial(..., anim = true)`) that bends regions of the mesh: legs below the hip swing in opposite phase, outer vertices between waist and shoulder lift as arms, everything above the waist pitches about it. The CPU picks a clip from sim state each frame (`unitClip`: walk, work, attack, shoot, cast, pray, panic, idle) and evaluates a pure pose function (`unitPose`). Death and drowning, which remove the entity at once in the sim, leave a render-only ghost for 1.2 s that topples or flails and sinks (`UnitLayer.consume` reads `killed` and `drowned` events).

**Consequences.** No new assets, no spend, no sim change (replays and hashes untouched); 16 bytes per instance per frame; render bench median 3.7 ms with 1000 units drawn (budget 6). The bends are approximate and depend on the models having legs near the center line and arms at the sides, which the current GLBs do; a shield or staff far from the body moves with the arm region. Fallback and next step: the rig and vertex animation texture route stays possible behind the same `instanceAnim` attribute (BACKLOG 5a), if close-zoom quality ever matters more than cost.

## ADR-013: Look v3 is a tilt-shift miniature on top of the retro pass, blurred after quantization (10/10/2026)

**Context.** Stewart's second reference (making-of/a1 style-ref-06, a tabletop diorama planet) asks for a tilt-shift miniature look (BACKLOG 14a): a sharp band at the camera focus, blur above and below, a small saturation and contrast lift. The retro pass (ADR-005) renders the scene into a low-res target and quantizes it to a dithered palette in one fullscreen quad, so the blur can sit before or after the quantization.

**Decision.** The retro quad gains the tilt-shift (`packages/render/src/retro.ts`): a `DepthTexture` on the low-res target, a blur amount from the screen-y distance to the focus band (`style.json render.tiltShift` bandCenter, bandHalf, falloff) raised by the depth distance from the camera focus (depthWeight, depthRange; the sky counts as far), 12 Poisson taps up to `maxBlur` low-res pixels, and the lift. Order `pre` blurs the linear scene and then quantizes; `post` quantizes every tap and averages the results. Both were shot side by side at pixel sizes 3 and 2 (shot set `look`): `pre` keeps dither grain inside the blur, which reads as noise, while `post` keeps the focus band pixel-crisp and gives a smooth lens blur outside it, which sells the miniature. Chosen: `post`, on by default (`defaultOn`), pixel size stays 3. Players switch it in Settings (Miniature focus: Default, On, Off); `?tiltshift=off|on|pre|post` and `?pixel=N` override for shots. Map view turns it off.

**Consequences.** Every shot baseline changes once (re-approved at the end of look v3). GPU-inclusive frame time (bench:render, `gl.finish`) rises about 0.1 to 0.3 ms at 2560x1440 (noise on a busy PC spans that range) (budget 1.5 ms warn, 3 ms fail). Fallback: Settings Off, or `defaultOn: false` in style.json; the `look` shot set keeps all three orders guarded.

## ADR-014: Skirmish victory rules run in the sim as data variants; levels keep their own runtime (10/10/2026)

**Context.** Skirmish win and loss was decided in the app (`game.ts checkEnd`, every rival eliminated), so the outcome was not hashed, saved or replayable, and BACKLOG 13 asks for victory variants (hold the Reliquaries, a timer, king of the hill). Campaign levels already decide their outcome in the sim (`LevelRuntime`, ADR-009).

**Decision.** `balance.victory` lists the variants as data (`controlRadius`, `default`, and `variants` of type conquest, holdSites {seconds}, kingOfHill {seconds} or lastStand {minutes}, each with a menu name and text). A skirmish world names one (`WorldInit.rules`, carried in `SkirmishParams` and so in saves); `RulesRuntime` (`packages/sim/src/rules.ts`, `world.rules`) runs in step 9 after the level. The last tribe standing wins under every variant. holdSites and kingOfHill read presence (units of each tribe within `controlRadius`, not inside a building) at the skirmish Reliquaries, once a second: holdSites needs a tribe alone at every site for an unbroken run, kingOfHill adds time to the strict leader at the first site (a tie scores nobody). The site ground is captured on the first step and kept, because a Reliquary runs out of uses and sinks. lastStand ends at its timer and the most followers win. The winner is sim state (`matchWon` event); the app only maps `why` to the end screen text. The opponent AI gains a `contest` action (attack-move its idle troops to the nearest site it does not control, scored higher when a rival leads) and treats troops posted at a site as busy. Level objectives stay in `LevelRuntime` (no shared registry yet): the two runtimes share nothing but step 9, and a registry is worth it only when a level wants a skirmish variant.

**Consequences.** Rules hash and snapshot only when present, so every golden replay and old save keeps its hash (old saves without rules fall back to the app's elimination check). New skirmishes default to `conquest`, which plays exactly as before. Soaks take `--rules <id>` and report wins by `why`. Fallback: dropping `rules` from the setup restores the app-side check.

## ADR-015: Campaign progression keeps what levels taught; the level select is a route map (10/10/2026)

**Context.** Campaign levels carried only their static `unlocks` forward (`apps/game/src/campaign.ts`), so a spell a Reliquary taught in play was lost at the next level, and the level list did not read as a campaign (BACKLOG 9, 84 to 86, 89).

**Decision.** The progress record (browser storage key `hearthfall.campaign.v1`) gains `learned`: per won level, the spells the player held at the win that neither the level nor the carry opened (`taughtSpells`), merged with what an earlier win of the same level taught. `campaignCarry` adds them, with the static `unlocks`, for later levels only. Records without `learned` load as before, so the key keeps its name. The level select is a route map: numbered nodes along a path (won gold, open green, locked grey), the frontier level picked by default, and a card with the description and Play. Golden replays may embed a whole level (`def.levelDef`, player only, plus `carry`) so a level and its sites are covered by Node and Chromium determinism without freezing `data/levels`. Levels 4 to 7 each teach one thing: Reliquary uses and a taught spell, the totem and a building unlock, a followers goal under raids, two rivals under fog.

**Consequences.** A player who wins a level by a different route than intended still keeps what they earned. Levels that teach through sites need no `unlocks` entry (The Old Reliquary relies on `learned` for Whirlwind). Fallback: drop `learned` from `campaignCarry` and list taught spells in `unlocks` again.

## ADR-016: Vehicles are units with a nav layer; riders live inside them like a garrison (10/10/2026)

**Context.** Boats and balloons (BACKLOG 10) need water and air movement, carrying, and the rule that water kills, without a second movement system or a second entity kind.

**Decision.** A unit type with a `vehicle` block (`nav: water|air`, `capacity`, `boardRadius`, optional `fireFrom` and `rangeBonus`) is a vehicle. `UnitSystem` keeps one `Pathfinder` per nav (`pfs[NAV.land|water|air]`, `pathing.ts` mode: water walks only cells under the sea, air walks everything at cost 1), and orders, flow fields (cache keyed by goal and nav), waypoints, stuck checks and sliding use the unit's own layer; a mixed selection is split per nav and each part snaps its own goal. Riders reuse the garrison column (`inside` = vehicle index, task `ride`), so they are hidden, untargetable, never drown and follow the vehicle each tick (`packages/sim/src/vehicles.ts`, step 5b). Commands: `board {units, vehicle}` (walkers set off with task `toBoard`, an idle vehicle comes to meet them, a walker boards within `boardRadius`, gives up after 4 tries) and `unload {units, to?}` (sail or fly to `to`, then drop riders on the nearest land within `boardRadius + 2`). Vehicles are not followers, give no mana, never drown, ignore knockback and cannot be hit in melee; ranged attacks and spells can sink them, and a lost vehicle spills its riders where it was, so riders over deep water drown. A rider whose type is in `fireFrom` shoots with `rangeBonus` like a tower guard. Buildings with `makes {unit, max, seconds}` keep up to `max` vehicles per finished building; `placement: "shore"` needs water within `SHORE_REACH` (3) cells of the footprint. The opponent AI ferries: with no land route to the enemy it raises a Boathouse, boards idle troops of the home landmass, sails a loaded boat to the enemy shore facing it (only when that water is the boat's sea) and sends troops it finds on an enemy landmass at that Hearth.

**Review fixes (S2 D+F Opus review).** Vehicles are never beguiled or panicked and the Wraith does not hunt them; the Shaper cannot board (like a garrison); an eliminated tribe's vehicles are wrecked before its people are released, so riders at sea drown whatever their index; riders earn the idle mana rate, not the housed one; a maker at full stock restarts its count, so a lost vehicle comes back one period later; the AI loads a boat only for a shore that boat can reach, brings a loaded wave home when no enemy shore is in reach, and boards a boat at most once per 90 s.

**Consequences.** No new entity kind, snapshot section or render path: vehicles are units, so selection, fog, combat, saves and replays cover them. The pack hash changed (two units, two buildings now live). Fallback: give `boathouse` and `skyloft` back `milestone: "backlog"` and drop boat and balloon from units.json; the code paths are inert without vehicle types.

## ADR-017: Forge mode is a sim phase that freezes every system but terrain (10/10/2026)

**Context.** BACKLOG 11 asks for a pre-match terraforming phase with free land edits. It must be deterministic and replayable like the rest of the match, must not let a tribe edit a rival's land, and must not shift match clocks (victory timers, level timers, the AI's first wave).

**Decision.** `WorldInit.forge` (skirmish option `SkirmishParams.forge`, scenario `forge: true`) builds a `ForgeRuntime` (`packages/sim/src/forge.ts`) from `balance.forge` (seconds, radius, hearthClear, brushRadius, amount, smoothStrength, maxOps). While it runs, `World.step` executes commands and controllers, flushes terrain ops (drowning stays on: water still kills), updates the Forge and vision, and returns: units, vehicles, economy, spells, effects, combat, worship, level and rules do not run. Only `FORGE_COMMANDS` (the forge's own `forgeOp` and `forgeReady`, settings such as `setSplit` and `handicap`, debug commands) pass validation; anything else is rejected with "the land is still being forged". A `forgeOp {brush: raise|lower|flatten|smooth, x, y}` is one free brush stroke whose centre must lie within `radius - brushRadius` of the tribe's own Hearth and at least `hearthClear + brushRadius` from it, at most `maxOps` per tribe. The Forge ends after `seconds` or on the tick every living tribe is ready (`forgeEnded` event). `World.playTick` (tick minus the Forge's end, equal to tick without one) drives the Last Stand timer, level timers and the AI's minute. Forge state is hashed, saved and restored only when present, so old replays and saves keep their hashes. The opponent AI forges by a personality `forge` plan (moat, wall or flatten strokes on a ring around its Hearth, two gaps toward and away from the nearest rival) computed from `ForgeRuntime.ops`, so it saves no extra state, then declares ready.

**Consequences.** One branch in `step` and one runtime class; every frozen system is untouched, so the risk is low. The app reuses the spell targeting ring for the Forge ring and brush. Fallback: if a later feature needs units to act during a pre-match phase (scouting, placing plans), widen `FORGE_COMMANDS` and run the needed systems in the branch. Campaign levels can opt in later through the level def (block H).

## ADR-018: Replays are params, a start save and the local commands; the viewer reruns the sim (10/10/2026)

**Context.** BACKLOG 19 asks for a replay viewer with a scrubbable timeline and a follow camera. The sim is deterministic and the opponents run inside it, so a match is fully described by how it started and what the local player ordered. Saves keep only a tail of the command log, and a session can start from a loaded save.

**Decision.** `apps/game/src/replay.ts` defines `Replay {version, packHash, params, start, commands, endTick, endHash, savedAt}`: `start` is the save the session was loaded from (null for a fresh match, its own log and pending commands dropped), `commands` every local command with the tick it ran in (the app keeps a full `replayLog` beside the save tail). When a match ends the app builds the replay, keeps it for the end screen (Watch replay, Download) and stores it under `hearthfall.replay.last` in browser storage (skipped silently over the quota). The main menu offers the stored replay and opens a downloaded file; `decodeReplay` refuses other versions and other game data (pack hash). `ReplayRun` rebuilds the world and steps it with the recorded commands, saving a checkpoint every 1200 ticks so seeking back restores the nearest checkpoint and steps forward; the app spreads a seek over frames (20 ms per frame). Reaching `endTick` compares the world hash with `endHash` and the bar shows Verified or Out of sync. While watching, orders are ignored, fog is revealed, speed is 1x to 8x and Follow keeps the camera on the first tribe's Shaper (its Hearth while she is down).

**Consequences.** Replays are small (commands only) and double as a desync check of the shipped build. A replay is tied to its game data; any data change makes older replays unplayable (refused with a reason, never wrong). Fallback: if replays must survive data changes, embed the pack in the file. Follow-ups: a viewpoint tribe selector, replays of scenarios and campaign levels from the level select, a size limit or compression for very long matches.

## ADR-019: Achievements and records are app-side thresholds over event-log stats, in a data file outside the pack hash (10/10/2026)

**Context.** BACKLOG 21 asks for achievements and a stats screen from the event logs. They must not change the deterministic sim, saves or replays, and new achievements should be data, not code.

**Decision.** The app counts the local tribe's match stats from each tick's sim events (`apps/game/src/achievements.ts`, `noteEvent`: kills and drowned foes, units lost, Shaper deaths, spells cast, buildings raised and razed, followers won over, troops trained, births, worship) and samples the tribe size every 30 ticks. When a skirmish or campaign level ends (not an editor playtest, not a replay) `recordMatch` adds the match to career totals (sums, the largest value for `peakFollowers` and `levelsWon`) and tests every not yet earned achievement in `data/achievements.json`: `scope` match or career, `when` a list of `{stat, min?, max?}` that must all hold, and for match scope an optional `mode` (skirmish or level) and `difficulty` list. Records `{career, unlocked: id to ISO time}` live under `hearthfall.records` in browser storage. The file has a zod schema (`AchievementsFileSchema`, stat names an enum) and `validateAchievements` checks it against the pack; the data guard and `npm run data:docs` cover it. It is not part of the pack hash, like `data/levels`, so adding achievements never invalidates replays or goldens. The end screen lists achievements the match earned; the main menu Records screen shows the career stats (labels and order from the file) and every achievement, earned or not.

**Consequences.** New achievements are a JSON edit; a new kind of stat is one enum entry and one `noteEvent` case. Stats after loading a save count from the load on (the match length uses the world's play time). Fallback: if achievements ever need state the event log does not carry, add an event in the sim (hashed) rather than reading sim internals from the app. Follow-ups: per-level bests, an in-match toast when a match achievement is earned, stats graphs from the event log.

## ADR-020: UI text comes from flat string tables by key, with a pseudo locale for layout tests (10/10/2026)

**Context.** BACKLOG 22 asks for a localization scaffold. Text is spread over Preact components and app bridges; a full translation is not the goal yet, but new text should stop being hard-coded and layouts should be checked against longer languages.

**Decision.** `packages/ui/src/i18n.ts` holds the active table: `t(key, vars)` looks a key up in the locale table, then in English, then returns the key itself (remembered in `missingStrings`); `{name}` placeholders take values. Tables are flat JSON in `data/strings/<locale>.json`, English (`en.json`) the base; the app picks one with `?lang=<id>` (`apps/game/src/locale.ts`, before the Game is built). The `pseudo` locale is derived from English: every letter accented, placeholders kept, text padded by about 40 percent and bracketed. The strings guard (`tools/guards/strings.mjs`, part of `npm run check`) fails on a `t("key")` without an English entry, an English entry nobody uses, and other tables with unknown keys or different placeholders. The menus and the replay bar are migrated (76 keys); the game title stays untranslated. Shots `menu_main_pseudo` and `menu_settings_pseudo` run in the pseudo locale and fail when any menu button or label clips its text.

**Consequences.** Translating the migrated screens is a new JSON file. Not yet migrated (follow-ups, visible as plain English in the pseudo shots): the HUD, the map editor, menu bridge texts (end screen lines and reasons, choice labels, notes), key action names, and data-driven names (spells, units, levels, achievements), which would get keys derived from their ids. Fallback: if string keys become unwieldy, generate them from the English text at build time.

## ADR-021: Mod packs patch the raw base files before validation (10/10/2026)

**Context.** BACKLOG 18 asks for mod packs loaded from `mods/<name>` with a manifest and a conflict report. ARCHITECTURE section 4 already promised that packs merge by `id` in load order with `"$remove": true`. Saves and replays must not load against different rules.

**Decision.** `packages/data/src/mods.ts` `applyMods(baseRaw, mods)` is pure, with no file access. It merges each mod's JSON files onto the raw base files before `validatePack`:
- Mods apply in manifest `loadOrder`, then by id. The base is 0 and mods must be 1 or more.
- Objects merge key by key.
- Lists of objects with ids merge by id: fields are deep merged, `$remove` deletes, unknown ids append.
- Anything else replaces. `$comment` is ignored.

Every value a mod sets is recorded by path (`units.json.units[warden].speed`). When two mods touch overlapping paths, the result has a conflict (path, mods in load order, last wins). A removal conflicts with any change under it.

Issues go back by mod and file: a bad manifest, an id that does not match the folder, `loadOrder` below 1, a file that is not a pack file. Those mods are skipped.

The merged pack then validates, cross checks and hashes like the base. A modded game has its own pack hash, so the existing save and replay hash checks refuse a mismatched mod set.

Where mods load:
- Node: `loadBasePack(mods)` in `tools/harness/datapack.mjs`.
  - `npm run mods` checks each mod alone and all (or `--mods a,b`) together, and prints the load order and conflicts.
  - The data guard fails on any mod under `mods/` that is invalid on its own.
  - `npm run soak -- --mods a,b` plays with mods.
- App: Vite bundles `mods/*/*.json`. `?mods=a,b` applies them in `loadPack`, where an unknown mod is a fatal startup error and conflicts go to the console. The main menu names the active mods, and `getSummary().mods` lists them.

Two example mods ship: `swift_wardens`, a list patch, and `rainy_season`, an object patch. `mods/README.md` is the modder's guide.

**Consequences.**
- Patches stay small and readable.
- New pack files need no mod code.
- Levels, achievements and strings are not moddable yet.
- Mods are picked by URL. There is no in-game mod picker yet, and replay files do not name their mods (the pack hash only refuses a mismatch).

## ADR-022: App-only UI tunables live in data/ui.json, outside the pack hash (10/10/2026)

**Context.** BACKLOG 78 (M8 review): the skirmish menu defaults sat in `balance.skirmish`, inside the sim pack hash, so changing a default map size invalidated every save and replay. HUD timings (notification seconds, max notes, subtitle seconds, order feedback window), input throttles (double-click radius, group jump window) and the quality render scales were literals in `game.ts` and `storage.ts`.

**Decision.** A new file `data/ui.json` (schema `UiFileSchema`, `data/schema/ui.schema.json`) holds `skirmish`, `notes`, `input` and `qualityScale`. Like `achievements.json` it sits beside `data/base/`, not in it, so it never enters the pack hash. `validateUi(raw, pack)` cross checks it against the pack (maps are terrain presets, defaultSize is one of mapSizes, opponents are personalities or economy, the difficulty exists); the data guard runs it and the app fails fast on an invalid file (`loadUiDefs`). `balance.skirmish` is removed from the base pack but stays an optional, unread schema field so the frozen golden packs keep validating with their hashes.

**Consequences.**
- Editing a menu default or a HUD timing never invalidates saves or replays.
- The base pack hash changed once (saves from before this commit refuse to load, as for any pack change).
- `ui.json` is not moddable yet (mods patch `data/base/` only). Fallback: move the block back into balance and bump the hash.

Fallback: if deep merging of list entries proves surprising, switch list entries back to the shallow `mergeById` behavior and record it here.

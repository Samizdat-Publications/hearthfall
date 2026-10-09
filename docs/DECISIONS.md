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


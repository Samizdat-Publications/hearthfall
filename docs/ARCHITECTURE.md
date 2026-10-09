# Architecture (living)

Decision record: `docs/DECISIONS.md` ADR-001. Evidence: `docs/research/stack_options.md`.

## 1. Stack (pinned)

| Layer | Choice | Pin |
|---|---|---|
| Language | TypeScript, `strict: true`, no `any` in `packages/sim`. No ESLint in v1: `tsc` + plain-script guards do the enforcing | TypeScript 7.0.x (research found 7.0.2); record in ADR-002 |
| Runtime | Node 22.18+ (Windows 11); env via `--env-file-if-exists=.env` | `engines` field in package.json |
| Monorepo | npm workspaces | no Nx, no Turbo |
| Sim | pure TS, zero DOM and zero three imports | n/a |
| Renderer | three.js **WebGLRenderer** (not WebGPU in v1) | `three@0.186.1` exact |
| Dev server and build | Vite | latest 8.x, lockfile |
| Unit and scenario tests | Vitest | latest 5.x, lockfile |
| Browser automation, screenshots | Playwright + bundled Chromium | `@playwright/test@1.64.0` exact |
| HUD | Preact + @preact/signals, DOM overlay | lockfile |
| Validation | zod schemas for every data file | lockfile |
| Asset tooling | Python 3.11+ in a project `.venv` + Blender 5.2 LTS CLI (via `tools/assets/blender_run.py`) | `tools/assets/requirements.txt` |
| Desktop exe (later) | Electron | backlog |

Never upgrade a pinned package unprompted. To upgrade: read the migration guide, bump in its own commit, run full QA, record an ADR.

Why not WebGPU now: headless WebGPU captures come back blank, and WebGPURenderer drops `onBeforeCompile`, which the curved-world bend uses. WebGPU is a backlog item behind the renderer interface.

## 2. Repository layout

```
hearthfall/
  CLAUDE.md                     lean operating manual (under 200 lines)
  docs/                         DESIGN, ARCHITECTURE, ROADMAP, TESTING, ASSETS, VISIONQA, BACKLOG, PROGRESS, DECISIONS, DATA (generated), research/
  data/
    base/                       the base data pack (JSON): units, buildings, spells, effects, ai, balance, style, levels/
    schema/                     generated JSON Schema from zod (for editors and mods)
  packages/
    sim/                        deterministic simulation (no DOM, no three, no Math.random, no Date)
    data/                       zod schemas, pack loader, merge rules, tick conversion
    ai/                         deterministic AI controllers (opponents and test bots), same Command API as players
    render/                     three.js renderer, reads sim snapshots, never writes sim state
    ui/                         Preact HUD and menus
    audio/                      Web Audio wrapper, positional SFX, music layers
  apps/
    game/                       Vite app: wires sim + render + ui + input; exposes window.__game debug API
  tools/
    harness/                    Node CLI: run, scenario, replay, soak, bench, shot, sheet, doctor, qa
    visionqa/                   OpenAI Decisions adapter (optional, switchable)
    assets/                     Python asset pipeline + Blender scripts + assets.json manifest
    guards/                     determinism (Math allowlist), import direction, docs freshness, IP names, dash characters
  scenarios/                    JSON scenario tests (initial state + commands + assertions)
  replays/golden/               golden command logs + expected hash checkpoints
  reports/                      generated (gitignored except reports/baselines/)
  assets/                       generated runtime assets (glb, ogg, png) + thumbnails, committed (no git LFS; keep under ~300 MB)
```

Dependency direction is strict: `sim` depends only on `data`. `ai` depends on `sim` and `data`. `render`, `ui`, `audio` depend on `sim` types (read only). `apps/game` wires everything. `tools/harness` may import anything. Enforce with a guard script that scans imports.

## 3. Simulation core (`packages/sim`)

- **Fixed tick 20 Hz.** Data is authored in seconds; the loader converts to ticks. Rendering interpolates between the last two snapshots.
- **Pure step:** `step(state, commands[]) -> state` mutating in place for speed, but the only inputs are the previous state, the external commands for this tick, and the seed. No wall clock, no I/O.
- **Determinism rules** (enforced by `tools/guards/determinism.mjs`, run in `npm run check`):
  - **Math allowlist** in `packages/sim` and `packages/ai`: only `Math.abs, min, max, floor, ceil, round, trunc, sign, sqrt, imul, fround, clz32` (all IEEE exact). Every other `Math.*` and the `**` operator are banned. Trig and other transcendental functions come from `dmath`, whose tables are **generated once and committed as literal numbers** in `packages/sim/src/dmath_tables.ts` (never built at runtime with `Math.sin`, which may differ between the V8 in Node and in Chromium).
  - Also banned: `Math.random`, `Date`, `performance`, `setTimeout`, `setInterval`, `crypto`, any DOM global.
  - Ordering: every sort comparator ends with an entity-id tiebreak; Map and Set are fine only when insertion order is itself deterministic; never iterate object keys built from runtime data.
  - Hashing of data packs uses canonical JSON (sorted keys, LF line endings) so Windows line endings never change a hash.
  - One seeded PRNG per sim (`xoshiro128**` or `sfc32`), streams split by purpose (combat, ai, weather) so adding a feature does not shift other streams.
- **Entity storage:** structure-of-arrays in typed arrays with a free list and generation counters (`EntityId = (index | ((generation & 0x7fff) << 16)) >>> 0`, index under 65536). Components are column groups: transform, motion, health, tribe, unitKind, task/state machine, building, tree, projectile, status effects.
- **System order per tick** (each a pure function over the state):
  1. apply external commands (validated; invalid commands are dropped and logged as events)
  2. AI controllers emit commands (every N ticks, deterministic)
  3. tasks and decisions (settler job assignment, troop target selection)
  4. pathing requests (budgeted per tick)
  5. movement and collision (spatial hash on torus)
  6. combat, projectiles, spells and effects
  7. terrain ops queue (applies edits, marks dirty chunks, drowns units now under water)
  8. economy (mana income and sink distribution, wood, breeding, construction)
  9. worship, triggers, objectives, win/loss
  10. events flush, hash checkpoint if `tick % hashEvery == 0`
- **Commands:** `{tick, tribe, type, args}` plain JSON. Every player action, AI action and bot action is a Command. Replays, bots, multiplayer lockstep and save games all reuse this format.
- **Events:** sim emits an ordered event list per tick (unitDied, spellCast, buildingDone, drowned, conversion, shaperDied). Renderer and audio consume events; tests assert on them. As built (M6): `packages/audio` `AudioHooks` maps events to cues through `style.json` `audio.cues` (`cue` with `{field}` substitution, `maxPerTick` throttle, `where` filter); cues without an available asset count as silent stubs until A4 wires Web Audio in M10, and the debug summary reports `audio` stats.
- **Hash:** `sim.hash()` FNV-1a or xxhash32 over heightmap, entity columns and RNG state. Golden replays assert checkpoint hashes; the first divergent tick pinpoints a bug.
- **Snapshots:** `sim.snapshot()` returns transferable typed arrays so the sim can move to a Web Worker later without refactoring. Save game = snapshot + data pack hashes + command log tail.

### Terrain
Torus heightmap `Int16Array(w*h)`, modulo indexing everywhere through one helper. Height scale: `heightUnitsPerWorldUnit` (default 32) in `balance.json`; one cell is one world unit horizontally. Ops: raise, lower, set, flattenToAverage, smooth, crater, ridgeLine, noiseScar, lowerTowardSea, scar. Dirty rectangles per op feed (a) chunk remesh in the renderer and (b) path-graph invalidation. Scar map `Uint16Array` holds seconds of scarring left per vertex and heals one second per sim second. As built (M1): heights live at integer vertex coordinates and `heightAt` interpolates bilinearly with wrap; a unit drowns when water at its position is deeper than `drownDepthHeightUnits`, while shallower water is impassable for pathing but survivable; every op lives in `packages/sim/src/terrain.ts` and is reachable as data through `TerrainOpSpec` (spells, buildings and the god-mode `terrainOp` command).

### Planet generator
`packages/sim/src/generator.ts`, tuned by `data/base/terrain.json`: tileable fbm value noise (integer lattice hash, no transcendental math), thresholded by histogram so `landFraction` of vertices are land, land heights normalized to the generator range with a `peakiness` curve. Hearth sites are chosen on the largest walkable component by farthest-point sampling and flattened; the seed rerolls (`seed + attempt * 7919`) when sites are too few, too close or disconnected. Trees by height band times a cluster mask; 6 to 10 wild people per Hearth on the same landmass. Test maps: `flat`, `flat_with_channel`.

### Pathfinding
Cost field per cell from slope and water. Hierarchical: 16x16 cell sectors with portal graph for long routes (A* on portals), flow fields for group moves to one target, local steering and separation for crowds. Dirty terrain invalidates only touched sectors. Per-tick path budget; units waiting on a path keep their last order. Invariant tested: no unit stays "stuck" (no progress, has order) longer than 10 s in soak runs. As built (M3, ADR-004): full-grid A* with component labels and a per-tick expansion budget, flow fields for groups of `groupFlowMinUnits` or more, torus spatial hash separation, route-progress stuck detection with repath and give-up; sectors and portals deferred until a bench warns. Since M6 `astar` returns the goal directly when `lineWalkable` (1/8-cell sampling) clears the straight line, charging the line length in cells to the per-tick budget. AI controllers (`Controller` in `packages/sim/src/world.ts`, implementations in `packages/ai`) run in system step 2 and issue ordinary Commands.

### Economy (M4)
`packages/sim/src/economy.ts`: settler job state machine and per-tribe assignment (system step 3: chop, haul, flatten, build, move home; one occupant stays to breed), construction sites and dwellings with occupancy, auto-upgrade and breeding under the population cap, tree regrowth and spread, mana income by follower state into the spell and training sinks with the split slider (step 8). Tribe economy state (`TribeEco`) is part of the hash and snapshots. The economy bot (`packages/ai/src/economyBot.ts`) only places dwelling plans; everything else is autonomy.

## 4. Data packs (`data/`, `packages/data`)

- Files: `units.json, buildings.json, spells.json, effects.json, ai_personalities.json, balance.json, terrain.json, style.json, levels/*.json`.
- Every file validated by a zod schema; JSON Schema exported to `data/schema/` and a human reference generated to `docs/DATA.md` by `npm run data:docs`.
- Packs merge by `id`: `base` then any `mods/<name>` pack in load order; a mod can add, override fields, or remove (`"$remove": true`). Each pack has a manifest with version and a content hash (part of replays and saves).
- Hot reload in dev: editing a data file reloads it in the running game (dev only, not deterministic).
- Rule: if a value is a number that a designer might tune, it lives in data, not code.

## 5. AI (`packages/ai`)

Controllers implement `decide(view: SimView, rng) -> Command[]` and run inside the sim step at their own cadence, so they are deterministic and replays need no AI commands recorded. Opponent AI = utility scoring over considerations declared in `ai_personalities.json` (economy target, army mix, aggression curve, spell preferences, scouting). Test bots reuse the same framework with scripted personalities (rusher, turtle, spell spammer, random legal). An **external** controller (human, the optional Decisions move-picker) is recorded into the command log because it is not deterministic.

As built (M6): `packages/ai` registers controllers by type (`wander`, `economy`, `war`). The WarBot wraps the economy bot (its public `findSpot` places lodges and towers too) and issues only ordinary commands (placePlan, train, setRally, move with `attack`). The movement layer's `orderGaveUp` event carries `reachable` and `chase` so harnesses can tell a stuck unit from a chase combat abandons.

## 6. Spells and effects as composition

A spell in data is a list of effect primitives with parameters:

`damageRadius, damageBuildingsRadius, knockback, terrainOp, convertRadius, statusApply (ward, veil, beguiled, burning, panic, entranced), spawnEntity, projectile, projectileStorm, areaOverTime, moverPath (whirlwind), summon (wraith), scar, lavaFlow`.

Example (illustrative): Volcano = `terrainOp(crater cone up) + areaOverTime(lava damage) + scar + spawnEntity(lavaRocks)`. New spells should be pure data. If a new spell needs a new primitive, add the primitive with tests, never a one-off spell class.

As built (M5): `packages/sim/src/effects.ts` registers damageRadius (Shapers only die to effects whose `canKill` lists them), knockback (displacement that ignores walkability, so water and cliffs kill), convertRadius (capped by free housing), statusApply (panic, burning), terrainOp (ridgeLine from the caster, flattenToAverage, noiseScar, crater, lowerTowardSea, raise, lower), damageBuildingsRadius, scar, areaOverTime (persistent effect entities) and spawnEntity (sub-entities from `spells.json` `entities`, such as lava rocks). `packages/sim/src/spells.ts` owns the cast command (walks into range, a `castSeconds` window during which `cancelCast` refunds), resolution, Shaper death, respawn at the Hearth, charge steal and elimination.

## 7. Renderer (`packages/render`)

- `Renderer` interface (`init, setSnapshot, setCamera, render, captureReady, dispose`) so WebGPU or another engine can replace it.
- **Terrain:** 32x32 cell chunks as BufferGeometry with vertex colors from height band, slope and scar; only dirty chunks remesh. Water is one shader plane at sea level plus shoreline foam from a depth texture or vertex attribute.
- **Curved world:** a shared material factory patches every world material (terrain, water, units, props, VFX) in `onBeforeCompile`, replacing the `project_vertex` chunk so the bend happens in **world space after the instance matrix**: `worldPos.y -= k * dist2(worldPos.xz, focus)`. Shadow casters get a matching `customDepthMaterial`. `k` grows with zoom so close-up is nearly flat and globe view reads as a small planet (a later option: true angular sphere mapping for the globe view). Map view sets `k = 0` with a top-down camera.
- **Culling:** bent geometry no longer matches its bounds, so terrain chunks use `frustumCulled = false` (or bounds expanded by the bend at their distance); units are culled on the CPU by distance from the focus.
- **Wrapping:** each terrain chunk renders at the wrapped copy nearest the camera focus; units and props wrap by their **instance origin** (never per vertex). Fog fades everything to the sky color before half the world width minus one chunk, so the nearest-copy jump is never visible, even in globe view. Seam shots live in the visual suite.
- **Water:** a tessellated grid (not a 2-triangle plane, which cannot bend) at sea level, with shoreline foam from a depth attribute.
- **Spell previews and range rings:** terrain shader uniforms (center, radius, shape, color), not decals, so they follow the bent surface exactly.
- **Units and props:** `InstancedMesh` per (kind, LOD); only changed instance matrices update. Procedural placeholder meshes from the `style.json` palette until glTF assets exist; the loader swaps them in by manifest id with automatic fallback.
- **Picking:** CPU raymarch against the bent heightfield (apply the same bend function), so clicks and spell previews are accurate on the curve. Unit picking uses the spatial hash near the hit point.
- **Post:** fog to horizon, ACES tone mapping, light bloom for spells, optional SSAO later. All toggles in a quality preset.
- Budgets (on Stewart's RTX desktop): 60 fps at 1440p with 1000 visible units and 2000 total; renderer CPU under 6 ms per frame.

## 8. App and debug API (`apps/game`)

URL params: `?seed=123&level=skirmish_small&scenario=<id>&camera=<preset>&paused=1&quality=low&debug=1&fixedStep=1`. As built (M2): `level` is a generator preset (`continents`, `islands`, or a test map), plus `size` and `tribes`; camera presets are `default, close, mid, globe, map` (`packages/render/src/camera.ts`).

`window.__game` (always present in dev and test builds):

| Method | Purpose |
|---|---|
| `getSummary()` | compact JSON for agents and bots: tick, per tribe counts, mana, charges, buildings, Shaper state, last 20 events, warnings |
| `getState(paths?)` | detailed state slices on request |
| `command(cmd)` | inject a Command as the local player |
| `step(n)` | advance n ticks when paused (deterministic test mode) |
| `setCamera(preset or {focus, yaw, zoom})` | for captures |
| `frames()` | rendered frame counter, captures wait for `frames() >= n` not wall time |
| `loadScenario(id)`, `setDebug(flags)` | test hooks, including deliberate breakage flags used to calibrate visual QA (`hideTerrain, blackCanvas, magentaMaterials, overlapHud, freezeCamera`) |
| `pause(bool)`, `runDef(def, rawPack)`, `webgl()` | pause toggle; run a scenario definition headless in the page (cross-engine determinism); WebGL renderer string |
| `selectBuilding(id)`, `troop(intent)` | M6 troop panel: select an own lodge or tower, then send a troop intent (`train`, `rally`, `garrison`, `ungarrison`, `retreat`, `stance`); returns false when the selection cannot do it |

Troop controls (M6): `apps/game/src/troops.ts` holds pure functions of (World, tribe, selection, selected building) that build the HUD `TroopView` and turn intents into Commands; Game routes HUD buttons, the R (retreat) and G (garrison) hotkeys, and right clicks through them (right click with a lodge selected sets its rally point; with units selected on an own Watchtower it garrisons). Unit tests live in `apps/game/test/`.

Agents read `getSummary()` and headless harness output first. Screenshots are the last resort.

## 9. Performance budgets (gated by `npm run bench`)

| Measure | Budget |
|---|---|
| Sim tick, 2000 units mid-battle, Node | under 8 ms average, under 20 ms p99 (bench measure F since M6; met by a per-tribe coarse grid that lets `acquire` skip empty neighborhoods exactly, a per-tick building list, `idleAcquireSeconds` for unengaged units, and the A* straight-line shortcut) |
| Soak run, 4 tribes, 30 game minutes, headless | under 60 s wall time |
| Terrain op (Quake radius 8) incl. path invalidation | under 2 ms |
| Renderer CPU time per frame, 1440p, 1000 visible units (`npm run bench:render`) | under 6 ms median |

## 10. Extension points (design for weeks of growth)

New unit, building, spell, AI personality, level, terrain biome, or mod pack: data only. New effect primitive, new system, new renderer backend, new controller type: code with a test, registered through a registry, never a switch statement buried in a system. Multiplayer later: lockstep over WebSocket using the same Command stream and per-tick hash comparison for desync detection.

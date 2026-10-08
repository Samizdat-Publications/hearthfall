// @hearthfall/sim public API. Deterministic: see docs/ARCHITECTURE.md section 3.
export * as dmath from "./dmath.ts";
export { Rng, STREAMS, hash2 } from "./rng.ts";
export { Fnv } from "./hash.ts";
export { CAT, Entities, NO_ENTITY, type EntityId } from "./entities.ts";
export { Terrain, wrap, wrapDelta, DIRTY_KEEP, type Rect, type DirtyRect, type TerrainOpSpec } from "./terrain.ts";
export { generateMap, walkableComponents, type MapSpec, type GeneratedMap } from "./generator.ts";
export { makeConfig, bandOf, secondsToTicks, type SimConfig, type BandName } from "./config.ts";
export { COMMANDS, registerCommand, type Command, type CommandHandler } from "./commands.ts";
export { World, TRIBE_COLORS, type SimEvent, type Tribe, type WorldInit, type HashParts, type WorldSnapshot } from "./world.ts";
export { applySetup, createScenarioWorld, commandsByTick, type ScenarioDef, type SetupEntry } from "./scenario.ts";

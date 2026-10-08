// zod schemas for every file in a data pack. Times are authored in seconds; packages/data converts
// them to ticks when building the runtime pack. Unknown keys are rejected so typos fail loudly;
// "$comment" is allowed anywhere a designer might want a note.
import { z } from "zod";

const comment = { $comment: z.string().optional() };
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids are snake_case");
const pos = z.number().nonnegative();
const range2 = z.tuple([z.number(), z.number()]);

// ---------------------------------------------------------------- balance.json
export const BalanceSchema = z.strictObject({
  ...comment,
  sim: z.strictObject({ tickHz: z.number().int().positive(), hashEverySeconds: pos }),
  terrain: z.strictObject({
    defaultSize: z.number().int().min(64).max(512),
    heightMax: z.number().int().positive(),
    heightUnitsPerWorldUnit: z.number().int().positive(),
    seaLevel: z.number().int().nonnegative(),
    generatorRange: range2,
    bands: z.strictObject({
      shore: z.number().int(),
      lowland: z.number().int(),
      grass: z.number().int(),
      highland: z.number().int(),
      rock: z.number().int(),
      peak: z.number().int(),
    }),
    maxWalkSlope: pos,
    maxBuildSlope: pos,
    maxBuildRange: pos,
    drownDepthHeightUnits: pos,
    skirmishRequiresConnectedLand: z.boolean(),
  }),
  breeding: z.strictObject({
    formula: z.string(),
    nearCapSlowdownStartPct: z.number().min(0).max(100),
    nearCapFactorAtCap: z.number().min(1),
  }),
  combat: z.strictObject({ heightRangedBonusPctPerBand: z.number(), stuckSeconds: pos }),
  gates: z.strictObject({
    ...comment,
    counterTriangleMinWinPct: z.number(),
    maxPersonalityWinPct: z.number(),
    medianMatchMinutes: range2,
    unharassedPopulationAtMinute10: z.strictObject({ target: z.number(), tolerancePct: z.number() }),
    maxStalematePct: z.number(),
    aiEliminatesIdleMinutes: z.number(),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;

// ---------------------------------------------------------------- style.json
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const StyleSchema = z.strictObject({
  ...comment,
  styleVersion: z.number().int().positive(),
  palette: z.record(z.string(), hex),
  lighting: z.strictObject({
    keyColor: hex,
    keyIntensity: pos,
    skyTop: hex,
    skyHorizon: hex,
    fogColor: hex,
  }),
  promptStyleSuffix: z.string(),
  promptNegative: z.string(),
  triBudgets: z.record(z.string(), range2),
});
export type Style = z.infer<typeof StyleSchema>;

// ---------------------------------------------------------------- units.json
const Melee = z.strictObject({ dps: pos, range: pos });
const Ranged = z.strictObject({
  damage: pos,
  radius: pos,
  range: pos,
  cooldown: pos,
  knockback: pos,
  heightRangeBonusPerBand: z.number(),
});
const Convert = z.strictObject({
  radius: pos,
  channelSeconds: pos,
  maxPerChannel: z.number().int().positive(),
  entrancedFreeze: z.boolean(),
  cannotConvert: z.array(id),
  interruptedBy: z.array(z.enum(["rangedDamage", "spell", "terrainChangeNear"])),
});
export const UnitSchema = z.strictObject({
  ...comment,
  id,
  hp: z.number().positive(),
  speed: pos,
  manaPerMin: z.record(z.string(), z.number().nonnegative()),
  melee: Melee.optional(),
  ranged: Ranged.optional(),
  convert: Convert.optional(),
  sabotage: z.strictObject({ burnSeconds: pos, disguise: z.boolean() }).optional(),
  isCaster: z.boolean().optional(),
  respawn: z.strictObject({ seconds: pos, drownedSeconds: pos }).optional(),
  trainableInto: z.array(id).optional(),
  prefersTarget: z.array(id).optional(),
  trainedAt: id.optional(),
  trainSeconds: pos.optional(),
  trainMana: pos.optional(),
  convertible: z.boolean(),
  wanders: z.boolean().optional(),
  spawnPerTribe: range2.optional(),
  milestone: z.string().optional(),
});
export const UnitsFileSchema = z.strictObject({
  ...comment,
  units: z.array(UnitSchema),
  rules: z.strictObject({
    ...comment,
    populationCap: z.number().int().positive(),
    startPopulation: z.number().int().nonnegative(),
    spiritManaPerMin: z.number().nonnegative(),
    popCapFormula: z.string(),
  }),
});
export type UnitDef = z.infer<typeof UnitSchema>;
export type UnitsFile = z.infer<typeof UnitsFileSchema>;

// ---------------------------------------------------------------- buildings.json
const DwellingLevel = z.strictObject({
  level: z.number().int().positive(),
  wood: z.number().int().nonnegative().optional(),
  upgradeWood: z.number().int().nonnegative().optional(),
  upgradeWoodAtDoor: z.number().int().nonnegative().optional(),
  capacity: z.number().int().positive(),
  supply: z.number().int().nonnegative(),
  breedSeconds: pos,
});
export const BuildingSchema = z.strictObject({
  ...comment,
  id,
  footprint: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  wood: z.number().int().nonnegative().optional(),
  levels: z.array(DwellingLevel).optional(),
  garrison: z.number().int().nonnegative().optional(),
  rangeBonus: z.number().optional(),
  trains: id.optional(),
  respawnPoint: z.boolean().optional(),
  buildable: z.boolean().optional(),
  hp: pos.optional(),
  destructible: z.boolean().optional(),
  rebuildable: z.boolean().optional(),
  milestone: z.string().optional(),
});
export const BuildingsFileSchema = z.strictObject({
  ...comment,
  buildings: z.array(BuildingSchema),
  construction: z.strictObject({
    flattenToAverage: z.boolean(),
    workersPerSite: z.number().int().positive(),
    buildSecondsPerWood: pos,
  }),
  trees: z.strictObject({
    maxWood: z.number().int().positive(),
    regrowSecondsPerWood: pos,
    regrowFromStumpSeconds: pos,
    chopSecondsPerWood: pos,
    spread: z.strictObject({ enabled: z.boolean(), chancePerMinute: z.number().min(0).max(1) }),
  }),
  worship: z.strictObject({ shrinePrayerSeconds: pos, missingWorshipperSpeedFactor: z.number().min(0).max(1) }),
});
export type BuildingDef = z.infer<typeof BuildingSchema>;
export type BuildingsFile = z.infer<typeof BuildingsFileSchema>;

// ---------------------------------------------------------------- spells.json (effect primitives)
const Effect = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("damageRadius"), radius: pos, damage: pos, downhillBonusPct: z.number().optional(), canKill: z.array(id).optional() }),
  z.strictObject({ type: z.literal("knockback"), radius: pos, force: pos }),
  z.strictObject({ type: z.literal("convertRadius"), radius: pos, max: z.number().int().positive(), excludes: z.array(id).optional(), targets: z.array(id).optional() }),
  z.strictObject({ type: z.literal("areaOverTime"), radius: pos, seconds: pos, damagePerSecond: pos }),
  z.strictObject({
    type: z.literal("statusApply"),
    status: z.enum(["ward", "veil", "beguiled", "burning", "panic", "entranced"]),
    seconds: pos,
    radius: pos.optional(),
    max: z.number().int().positive().optional(),
    poppedBy: z.array(id).optional(),
    breaksOnCasterDeath: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("terrainOp"),
    op: z.enum(["raise", "lower", "set", "flattenToAverage", "smooth", "crater", "ridgeLine", "noiseScar", "lowerTowardSea", "scar"]),
    from: z.enum(["caster", "target"]).optional(),
    width: pos.optional(),
    heightAboveSea: z.number().optional(),
    length: pos.optional(),
    radius: pos.optional(),
    minHeightAboveSea: z.number().optional(),
    depth: z.number().optional(),
    seconds: pos.optional(),
    shape: z.string().optional(),
    height: z.number().optional(),
  }),
  z.strictObject({ type: z.literal("moverPath"), entity: id, seconds: pos, wander: z.boolean().optional(), flingForce: pos.optional(), damagesBuildings: z.boolean().optional() }),
  z.strictObject({ type: z.literal("spawnEntity"), entity: id, radius: pos.optional(), killsFirst: z.number().int().optional(), visible: z.boolean().optional(), count: z.number().int().positive().optional() }),
  z.strictObject({ type: z.literal("damageBuildingsRadius"), radius: pos, damagePct: z.number().min(0).max(100) }),
  z.strictObject({ type: z.literal("projectileStorm"), count: z.number().int().positive(), radius: pos, seconds: pos, damage: pos, knockback: pos.optional() }),
  z.strictObject({ type: z.literal("summon"), entity: id, seconds: pos, maxKills: z.number().int().positive().optional() }),
  z.strictObject({ type: z.literal("scar"), radius: pos, healSeconds: pos }),
]);
export type EffectDef = z.infer<typeof Effect>;
export const SpellSchema = z.strictObject({
  ...comment,
  id,
  tier: z.number().int().min(1).max(4),
  cost: z.number().positive(),
  maxCharges: z.number().int().positive(),
  range: pos,
  v1: z.boolean().optional(),
  effects: z.array(Effect).min(1),
});
export const SpellsFileSchema = z.strictObject({
  ...comment,
  chargeRules: z.strictObject({
    startMana: z.number().nonnegative(),
    defaultSplitSpellsPct: z.number().min(0).max(100),
    singleSinkGetsAll: z.boolean(),
    killChargeStealPct: z.number().min(0).max(100),
  }),
  spells: z.array(SpellSchema),
});
export type SpellDef = z.infer<typeof SpellSchema>;
export type SpellsFile = z.infer<typeof SpellsFileSchema>;

// ---------------------------------------------------------------- ai_personalities.json
export const PersonalitySchema = z.strictObject({
  ...comment,
  id,
  tribeColorDefault: z.enum(["azure", "crimson", "amber", "jade"]),
  economyTargetPop: z.number().int().positive(),
  armyMix: z.record(id, z.number().min(0).max(1)),
  aggression: z.number().min(0).max(1),
  firstAttackMinute: pos,
  spellPrefs: z.array(id),
  scouting: z.number().min(0).max(1),
  towerAffinity: z.number().min(0).max(1),
});
export const DifficultySchema = z.strictObject({
  ...comment,
  id,
  reactionSeconds: pos,
  decisionNoise: z.number().min(0).max(1),
  resourceMultiplier: z.number().positive(),
});
export const AiFileSchema = z.strictObject({
  ...comment,
  personalities: z.array(PersonalitySchema),
  difficulties: z.array(DifficultySchema),
});
export type AiFile = z.infer<typeof AiFileSchema>;

// ---------------------------------------------------------------- terrain.json (planet generator)
const BandMap = z.strictObject({ shore: z.number(), lowland: z.number(), grass: z.number(), highland: z.number(), rock: z.number(), peak: z.number() });
export const TerrainPresetSchema = z.strictObject({
  ...comment,
  id,
  basePeriod: z.number().int().positive(),
  octaves: z.number().int().min(1).max(8),
  persistence: z.number().min(0).max(1),
  landFraction: z.number().min(0.05).max(0.95),
  peakiness: z.number().min(0).max(1),
});
export const TerrainFileSchema = z.strictObject({
  ...comment,
  presets: z.array(TerrainPresetSchema).min(1),
  trees: z.strictObject({
    densityByBand: BandMap,
    clusterPeriod: z.number().int().positive(),
    clusterThreshold: z.number().min(0).max(1),
    clearRadiusAroundHearth: pos,
    maxSlope: pos,
  }),
  hearth: z.strictObject({ flatRadius: pos, minHeightAboveSea: pos, maxSiteRange: pos, minSpacingFracOfSize: z.number().min(0).max(0.5) }),
  wild: z.strictObject({ distance: range2 }),
  maxRerolls: z.number().int().min(0).max(100),
});
export type TerrainFile = z.infer<typeof TerrainFileSchema>;

// ---------------------------------------------------------------- manifest.json
export const ManifestSchema = z.strictObject({
  ...comment,
  id,
  name: z.string(),
  version: z.string(),
  loadOrder: z.number().int(),
});

/** Every pack file name and its schema. Order is the load and docs order. */
export const PACK_FILES = {
  "manifest.json": ManifestSchema,
  "balance.json": BalanceSchema,
  "style.json": StyleSchema,
  "units.json": UnitsFileSchema,
  "buildings.json": BuildingsFileSchema,
  "spells.json": SpellsFileSchema,
  "ai_personalities.json": AiFileSchema,
  "terrain.json": TerrainFileSchema,
} as const;
export type PackFileName = keyof typeof PACK_FILES;

export interface PackFiles {
  manifest: z.infer<typeof ManifestSchema>;
  balance: Balance;
  style: Style;
  units: UnitsFile;
  buildings: BuildingsFile;
  spells: SpellsFile;
  ai: AiFile;
  terrain: TerrainFile;
}

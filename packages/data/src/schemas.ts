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
  movement: z.strictObject({
    ...comment,
    separationRadius: pos,
    separationStrength: pos,
    waypointRadius: pos,
    arriveRadius: pos,
    crowdArriveRadius: pos,
    repathSeconds: pos,
    giveUpSeconds: pos,
    pathBudgetPerTick: z.number().int().positive(),
    maxExpandPerSearch: z.number().int().positive(),
    groupFlowMinUnits: z.number().int().positive(),
    flowLookaheadCost: pos,
    sightRadius: pos,
    progressEpsilon: pos,
    overlapNudge: pos,
    separationScale: pos,
    snapRadius: z.number().int().positive(),
    maxFlowBuildsPerTick: z.number().int().positive(),
    flowCacheSize: z.number().int().positive(),
  }),
  economy: z.strictObject({
    ...comment,
    decideEverySeconds: pos,
    flattenStepPerWorkerSecond: pos,
    flattenMaxRange: pos,
    carryWood: z.number().int().positive(),
    startWoodPerSettler: z.number().int().nonnegative(),
    workRange: pos,
    keepOneOccupantForBreeding: z.boolean(),
    maxOpenPlansPerTribe: z.number().int().positive(),
    buildingGapCells: z.number().int().nonnegative(),
    defaultAutoCharge: z.array(id),
    skirmishSpells: z.union([z.literal("v1"), z.literal("all"), z.array(id)]),
    wildWanderRadius: pos,
    wildWanderChancePerSecond: z.number().min(0).max(1),
    doorOffset: pos,
    priorities: z.strictObject({ build: z.number().min(0), upgrade: z.number().min(0), breed: z.number().min(0) }),
  }),
  breeding: z.strictObject({
    formula: z.string(),
    nearCapSlowdownStartPct: z.number().min(0).max(100),
    nearCapFactorAtCap: z.number().min(1),
  }),
  combat: z.strictObject({
    ...comment,
    heightRangedBonusPctPerBand: z.number(),
    stuckSeconds: pos,
    knockbackTicks: z.number().int().positive(),
    knockbackDecay: z.number().min(0).max(1),
    shaperMinHpFromNonLethal: pos,
    /** M6: troops scan for enemies inside acquireRadius every retargetSeconds and drop targets past leashRadius */
    acquireRadius: pos,
    leashRadius: pos,
    retargetSeconds: pos,
    /** units not engaged (no target, no combat mode) look for enemies only this often (a 2000-unit battle stays in budget) */
    idleAcquireSeconds: pos,
    chaseRepathSeconds: pos,
    /** body radius added to attack ranges on both sides */
    unitRadius: z.number().nonnegative(),
    /** elevation per ranged bonus band (height units) and the most bands that count */
    heightBandUnits: pos,
    maxHeightBands: z.number().int().nonnegative(),
    shaperRegenPerSecond: z.number().nonnegative(),
    shaperRegenDelaySeconds: z.number().nonnegative(),
    /** what the units of an eliminated tribe turn into */
    eliminatedUnitsBecome: z.enum(["wild"]),
    buildingDamageFactor: z.number().nonnegative(),
    /** melee lands as swings of dps x meleeSwingSeconds (one audio hook per swing) */
    meleeSwingSeconds: pos,
    /** ranged area damage falls off linearly to (1 - this) at the edge of the blast */
    rangedSplashFalloff: z.number().min(0).max(1),
    /** after a troop knockback ends, further troop knockbacks are ignored this long (spells still push) */
    knockbackImmuneSeconds: z.number().nonnegative(),
    /** cells subtracted from a preferred target's distance when choosing whom to attack */
    preferTargetBonus: z.number().nonnegative(),
    /** defensive stance: acquire only this close, never chase farther than the leash from where it stood */
    defensiveAcquireRadius: pos,
    defensiveLeashRadius: pos,
  }),
  statuses: z.strictObject({
    ...comment,
    panic: z.strictObject({ fleeDistance: pos, repickSeconds: pos }),
    burning: z.strictObject({ damagePerSecond: pos }),
    buildingFire: z.strictObject({ ...comment, seconds: pos, hpPctPerSecond: pos }).optional(),
  }),
  /** BACKLOG 3: fog of war (sight radii in cells; `sight` overrides per unit or building id) */
  vision: z
    .strictObject({
      ...comment,
      enabled: z.boolean(),
      cellSize: z.number().int().min(1).max(8),
      everySeconds: pos,
      unitSight: pos,
      buildingSight: pos,
      sight: z.record(id, pos),
    })
    .optional(),
  progression: z.strictObject({
    ...comment,
    /** in-match unlock tiers (DESIGN 3a): a tier opens once the tribe's followers reach `followers` (peak, never lost) */
    tiers: z
      .array(z.strictObject({ ...comment, id: z.string(), followers: z.number().int().min(0), buildings: z.array(z.string()) }))
      .min(1),
  }),
  /**
   * M8 skirmish setup choices (map sizes are multiples of the 32 cell render chunk; tribes = opponents + 1, at most 4).
   * App only, never read by the sim. Optional so packs frozen before M8 (golden replays) validate with an
   * unchanged hash (a zod default would add the key and change it); the app falls back to SKIRMISH_DEFAULTS.
   */
  skirmish: z
    .strictObject({
      ...comment,
      mapSizes: z.array(z.number().int().min(64).multipleOf(32)).min(1),
      defaultSize: z.number().int(),
      maps: z.array(z.string()).min(1),
      maxOpponents: z.number().int().min(1).max(3),
      defaultOpponents: z.array(z.string()).min(1),
      defaultDifficulty: z.string(),
    })
    .optional(),
  /**
   * BACKLOG 1: worship sites on generated (skirmish) maps, at points equidistant from each pair of Hearths
   * and at that point's opposite on the wrapped planet; sites take the list entries in turn. Optional so
   * frozen packs keep their hash.
   */
  skirmishWorship: z
    .strictObject({
      ...comment,
      maxSites: z.number().int().min(0).max(12),
      minSpacing: pos,
      minHearthDistance: pos,
      searchRadius: z.number().int().min(0).max(32),
      sites: z
        .array(
          z.strictObject({
            ...comment,
            kind: id,
            worshippers: z.number().int().min(1).max(8).optional(),
            prayerSeconds: pos.optional(),
            rewards: z.array(z.lazy(() => RewardSchema)).min(1),
          }),
        )
        .min(1),
    })
    .optional(),
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
  direction: z.strictObject({ primaryRef: z.string(), lightingRef: z.string(), chosen: z.string(), notes: z.string() }).optional(),
  /** retro render pass and look knobs (ADR-005); all optional with defaults in the renderer */
  render: z
    .strictObject({
      ...comment,
      pixelScale: z.number().int().min(1).max(8),
      paletteLevels: z.number().int().min(0).max(64),
      ditherStrength: z.number().min(0).max(1),
      detailNoise: z.number().min(0).max(0.5),
      detailCellsPerUnit: z.number().positive(),
      hearthLight: z.strictObject({ color: hex, intensity: pos, distance: pos }),
      ambientIntensity: pos,
      /** look v2: dark starry space around the planet */
      space: z.strictObject({ ...comment, top: hex, horizon: hex, stars: z.number().min(0).max(1), rim: hex }).optional(),
      /** look v2: density of white foam strokes on open water (0 turns them off) */
      foamStrokes: z.number().min(0).max(1).optional(),
      /** look v2 (BACKLOG 0a): draw scale of the building models, so villages read as villages next to the
       * 1.3x readability-scaled units; keep (scale - 1) x the largest footprint within the building gap */
      buildingScale: z.number().min(0.5).max(2).optional(),
    })
    .optional(),
  /** sim event type to audio cue (packages/audio AudioHooks); cues without an asset play as silent stubs */
  audio: z
    .strictObject({
      ...comment,
      cues: z.record(
        z.string(),
        z.strictObject({
          /** asset id; `{field}` is replaced by that event field (spellCast: sfx.{spell}_cast) */
          cue: z.string().min(1),
          /** at most this many plays of the rule per sim tick (battles stay readable) */
          maxPerTick: z.number().int().positive().optional(),
          /** play only when every listed event field equals the value */
          where: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
        }),
      ),
      /** M10: cue id to the asset id that serves it (one clip for several cues) */
      alias: z.record(z.string(), z.string().min(1)).optional(),
    })
    .optional(),
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
  /** M6: cannot fire at units closer than this (melee troops that reach a Firecaller pin it) */
  minRange: z.number().nonnegative().optional(),
});
const Convert = z.strictObject({
  radius: pos,
  channelSeconds: pos,
  maxPerChannel: z.number().int().positive(),
  entrancedFreeze: z.boolean(),
  cannotConvert: z.array(id),
  /** BACKLOG 7: meleeDamage lets a melee swing break the channel too (ranged hits and spells always do) */
  interruptedBy: z.array(z.enum(["rangedDamage", "spell", "terrainChangeNear", "meleeDamage"])),
  cooldownSeconds: pos,
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
  sabotage: z
    .strictObject({
      ...comment,
      channelSeconds: pos,
      treeChannelSeconds: pos,
      cooldownSeconds: pos,
      range: pos,
      disguise: z.boolean(),
      detectRadius: pos,
      revealSeconds: pos,
      detectors: z.array(id),
    })
    .optional(),
  isCaster: z.boolean().optional(),
  respawn: z.strictObject({ seconds: pos, drownedSeconds: pos }).optional(),
  trainableInto: z.array(id).optional(),
  prefersTarget: z.array(id).optional(),
  trainedAt: id.optional(),
  trainSeconds: pos.optional(),
  trainMana: pos.optional(),
  convertible: z.boolean(),
  /** default combat stance (M6): aggressive acquires and chases, defensive fights in reach, passive never auto-fights */
  stance: z.enum(["aggressive", "defensive", "passive"]),
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
  /** BACKLOG 0c: stone quarried from rocks, delivered like wood before the site can finish */
  stone: z.number().int().nonnegative().optional(),
  levels: z.array(DwellingLevel).optional(),
  garrison: z.number().int().nonnegative().optional(),
  rangeBonus: z.number().optional(),
  trains: id.optional(),
  /** training queue length per lodge (M6) */
  queueMax: z.number().int().positive().optional(),
  respawnPoint: z.boolean().optional(),
  buildable: z.boolean().optional(),
  hp: pos,
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
  /** BACKLOG 0c: stone outcrops (optional so frozen packs keep their hash; without it no rock holds stone) */
  rocks: z.strictObject({ ...comment, maxStone: z.number().int().positive().max(255), mineSecondsPerStone: pos }).optional(),
  /**
   * Worship objects (DESIGN 10, M9). The M9 fields are optional so packs frozen before M9 keep their hash;
   * a pack without `kinds` has no worship objects.
   */
  worship: z.strictObject({
    ...comment,
    shrinePrayerSeconds: pos,
    missingWorshipperSpeedFactor: z.number().min(0).max(1),
    /** a unit prays when within this many cells of the object */
    radius: pos.optional(),
    /** share of full progress lost per second while a tribe with progress has nobody praying */
    decayPerSecond: z.number().min(0).max(1).optional(),
    kinds: z
      .array(
        z.strictObject({
          ...comment,
          id,
          /** default worshippers needed for full speed (1 to 8); a site can override */
          worshippers: z.number().int().min(1).max(8),
          /** default full-speed prayer seconds (else shrinePrayerSeconds) */
          prayerSeconds: pos.optional(),
          /** default number of times it grants its rewards */
          uses: z.number().int().min(1),
          /** removed from the map when its uses run out (a shrine sinks) */
          sinks: z.boolean(),
          /** only the Shaper's prayer counts (and it counts as all worshippers) */
          shaperOnly: z.boolean().optional(),
        }),
      )
      .optional(),
  }),
});
export type BuildingDef = z.infer<typeof BuildingSchema>;
export type BuildingsFile = z.infer<typeof BuildingsFileSchema>;

// ---------------------------------------------------------------- spells.json (effect primitives)
const Effect = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("damageRadius"), radius: pos, damage: pos, downhillBonusPct: z.number().optional(), canKill: z.array(id).optional() }),
  /** edgeFalloff: share of the force lost at the rim (0 = same push everywhere) */
  z.strictObject({ type: z.literal("knockback"), radius: pos, force: pos, edgeFalloff: z.number().min(0).max(1) }),
  z.strictObject({ type: z.literal("convertRadius"), radius: pos, max: z.number().int().positive(), excludes: z.array(id).optional(), targets: z.array(id).optional() }),
  z.strictObject({ type: z.literal("areaOverTime"), radius: pos, seconds: pos, damagePerSecond: pos }),
  z.strictObject({
    type: z.literal("statusApply"),
    status: z.enum(["ward", "veil", "beguiled", "burning", "panic", "entranced"]),
    seconds: pos,
    radius: pos.optional(),
    max: z.number().int().positive().optional(),
    /** who it lands on (default enemy): Veil and Ward are cast on your own units */
    targets: z.enum(["enemy", "own"]).optional(),
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
    /** lowerTowardSea only: spread over this many seconds, `depth` applied once per second */
    seconds: pos.optional(),
    shape: z.string().optional(),
    height: z.number().optional(),
  }),
  /** a vortex that wanders from the target (cells per second), flings units it touches and wears down buildings */
  z.strictObject({ type: z.literal("moverPath"), entity: id, seconds: pos, radius: pos, speed: pos, wander: z.boolean().optional(), flingForce: pos, buildingDamagePctPerSecond: z.number().min(0).max(100).optional() }),
  z.strictObject({ type: z.literal("spawnEntity"), entity: id, radius: pos.optional(), count: z.number().int().positive().optional() }),
  /** a visible bog: kills the first `kills` non-caster units of other tribes that stand in it */
  z.strictObject({ type: z.literal("trap"), radius: pos, kills: z.number().int().positive(), seconds: pos }),
  z.strictObject({ type: z.literal("damageBuildingsRadius"), radius: pos, damagePct: z.number().min(0).max(100) }),
  /** `count` impacts spread evenly over `seconds`, each at a random point within `radius`, hitting units and buildings within `impactRadius` */
  z.strictObject({ type: z.literal("projectileStorm"), count: z.number().int().positive(), radius: pos, impactRadius: pos, seconds: pos, damage: pos, knockback: pos.optional() }),
  /** a flying hunter: flies (cells per second) to the nearest enemy unit within huntRadius and kills it, one kill per killSeconds */
  z.strictObject({ type: z.literal("summon"), entity: id, seconds: pos, speed: pos, huntRadius: pos, killSeconds: pos, maxKills: z.number().int().positive().max(255) }),
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
  /** opponent AI targeting hint (M7): enemy unit clusters, enemy buildings, wild people, or a land bridge toward an enemy */
  /** how the opponent AI aims it; ownFighting (Ward) and ownMarching (Veil) aim at the AI's own troops (BACKLOG 1) */
  aiTarget: z.enum(["units", "buildings", "wild", "bridge", "ownFighting", "ownMarching", "none"]).optional(),
  effects: z.array(Effect).min(1),
});
export const SpellsFileSchema = z.strictObject({
  ...comment,
  chargeRules: z.strictObject({
    startMana: z.number().nonnegative(),
    defaultSplitSpellsPct: z.number().min(0).max(100),
    singleSinkGetsAll: z.boolean(),
    killChargeStealPct: z.number().min(0).max(100),
    castSeconds: pos,
    undoSeconds: pos,
  }),
  spells: z.array(SpellSchema),
  /** sub-entities spells can spawn (spawnEntity), each a list of effects applied where it lands */
  entities: z.array(z.strictObject({ ...comment, id, effects: z.array(Effect).min(1) })).default([]),
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
  /** BACKLOG 2: keep this many Shades from this match minute on and send them at enemy buildings */
  shades: z.strictObject({ ...comment, count: z.number().int().positive(), fromMinute: pos }).optional(),
});
export const DifficultySchema = z.strictObject({
  ...comment,
  id,
  reactionSeconds: pos,
  decisionNoise: z.number().min(0).max(1),
  /** BACKLOG 3: the AI ignores fog of war (sees every unit and building) */
  mapHack: z.boolean().optional(),
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
  /** look v2 (BACKLOG 0a): land quantized into plateaus `step` height units apart; up to `flat` of each step
   * is level and the rest a linear ramp. The level share shrinks where the land is already steep so a ramp
   * stays near `rampSlope` (per cell): above the brown cliff threshold, at or under the walk limit, so the
   * bands read as cliffs without cutting the land apart. Slopes already steeper stay untouched. */
  terrace: z.strictObject({ step: z.number().positive(), flat: z.number().min(0).max(0.9), rampSlope: z.number().positive() }).optional(),
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
    /** BACKLOG 0a: a grove ring around each Hearth (cells from its center), planted at least at this density */
    hearthGrove: z.strictObject({ inner: pos, outer: pos, density: z.number().min(0).max(1) }).optional(),
  }),
  hearth: z.strictObject({ flatRadius: pos, minHeightAboveSea: pos, maxSiteRange: pos, minSpacingFracOfSize: z.number().min(0).max(0.5) }),
  wild: z.strictObject({ distance: range2 }),
  /** BACKLOG 0c: stone outcrops per Hearth (cells from its center) and scattered over the land (per 1000 land vertices) */
  rocks: z
    .strictObject({ ...comment, perHearth: z.number().int().min(0), distance: range2, scatterPerThousandLand: z.number().min(0), clearTreesRadius: z.number().min(0) })
    .optional(),
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

/** Skirmish setup used when a pack has no `balance.skirmish` (packs frozen before M8). */
export const SKIRMISH_DEFAULTS = { mapSizes: [96, 128, 192], defaultSize: 128, maps: ["continents", "islands"], maxOpponents: 3, defaultOpponents: ["aggressive"], defaultDifficulty: "normal" };

// ---------------------------------------------------------------- worship sites, levels (M9, data/levels/*.json)
const point = z.tuple([z.number(), z.number()]);

/** What a worship site (or a level trigger) gives. Rewards go to the tribe that completed the prayer. */
export const RewardSchema = z.discriminatedUnion("type", [
  /** one-shot charges: usable even when the spell is not unlocked, never recharged unless it is */
  z.strictObject({ type: z.literal("charges"), spell: id, n: z.number().int().min(1) }),
  /** permanent spell unlock (reliquary) */
  z.strictObject({ type: z.literal("unlockSpell"), spell: id }),
  /** permanent building unlock, ignoring follower tiers and level limits */
  z.strictObject({ type: z.literal("unlockBuilding"), building: id }),
  /** a spell's effects at a point (the site when `at` is absent), cast by nobody: totem land bridges */
  z.strictObject({ type: z.literal("spell"), spell: id, at: point.optional() }),
  /** units for the rewarded tribe (or `tribe`, -1 for wild people) near a point (the site by default) */
  z.strictObject({ type: z.literal("spawn"), unit: id, n: z.number().int().min(1).max(50), tribe: z.number().int().min(-1).optional(), at: point.optional() }),
  /** level scripting: every trained troop of `tribe` attack-moves to `to` (a war band crossing) */
  z.strictObject({ type: z.literal("raid"), tribe: z.number().int().min(0), to: point }),
  /** a message for the player (HUD notification) */
  z.strictObject({ type: z.literal("message"), text: z.string().min(1).max(160) }),
]);
export type Reward = z.infer<typeof RewardSchema>;

/** One worship object on a map. Unset fields come from its kind in buildings.json worship.kinds. */
export const SiteSpecSchema = z.strictObject({
  tag: id.optional(),
  worshippers: z.number().int().min(1).max(8).optional(),
  prayerSeconds: pos.optional(),
  uses: z.number().int().min(1).optional(),
  rewards: z.array(RewardSchema),
});
export type SiteSpec = z.infer<typeof SiteSpecSchema>;

const LevelSetup = z.strictObject({
  /** unit, building, worship kind or "tree" */
  spawn: id,
  tribe: z.number().int().min(-1).optional(),
  at: point.optional(),
  near: point.optional(),
  count: z.number().int().min(1).max(200).optional(),
  spacing: pos.optional(),
  site: SiteSpecSchema.optional(),
});

export const ObjectiveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("eliminateAll"), text: z.string().optional() }),
  z.strictObject({ type: z.literal("worship"), site: id, text: z.string().optional() }),
  z.strictObject({ type: z.literal("survive"), seconds: pos, text: z.string().optional() }),
  z.strictObject({ type: z.literal("followers"), n: z.number().int().min(1), text: z.string().optional() }),
]);
export type Objective = z.infer<typeof ObjectiveSchema>;

export const LoseSchema = z.discriminatedUnion("type", [
  /** the player's tribe is eliminated (always on) */
  z.strictObject({ type: z.literal("eliminated") }),
  z.strictObject({ type: z.literal("timeLimit"), seconds: pos }),
  /** a rival completes this site first */
  z.strictObject({ type: z.literal("siteLost"), site: id }),
  /** the player's Hearth is destroyed (the tribe may live on through its Shaper) */
  z.strictObject({ type: z.literal("hearthLost") }),
]);
export type LoseCondition = z.infer<typeof LoseSchema>;

export const TriggerSchema = z.strictObject({
  when: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("time"), seconds: pos }),
    z.strictObject({ type: z.literal("worship"), site: id }),
    z.strictObject({ type: z.literal("objective"), index: z.number().int().min(0) }),
  ]),
  /** actions use the reward vocabulary; the receiving tribe is the player (0) unless the trigger is a worship by another tribe */
  do: z.array(RewardSchema).min(1),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const LevelSchema = z.strictObject({
  ...comment,
  id,
  name: z.string().min(1).max(40),
  /** campaign order (1 first) */
  order: z.number().int().min(1),
  description: z.string().min(1).max(300),
  seed: z.number().int(),
  /** a handmade map: the flat generator at landAboveSea (negative for open sea) with painted islands, straits and hills */
  map: z.strictObject({
    generator: z.string(),
    size: z.number().int().min(32).multipleOf(32),
    landAboveSea: z.number().optional(),
    paint: z
      .array(
        z.strictObject({
          shape: z.enum(["disc", "rect"]),
          at: point,
          r: pos.optional(),
          size: point.optional(),
          aboveSea: z.number(),
          falloff: z.number().min(0).optional(),
        }),
      )
      .optional(),
  }),
  /** tribe 0 is the player; the others are AI opponents by personality */
  tribes: z.array(z.strictObject({ ai: id.optional(), difficulty: id.optional() })).min(1).max(4),
  /** spells unlocked at the start for every tribe (campaign unlocks are added for the player) */
  spells: z.array(id),
  /** buildings every tribe may build (others need an unlockBuilding reward); absent means all */
  buildings: z.array(id).optional(),
  setup: z.array(LevelSetup).min(1),
  objectives: z.array(ObjectiveSchema).min(1),
  lose: z.array(LoseSchema).optional(),
  triggers: z.array(TriggerSchema).optional(),
  /** carried forward in the campaign when the level is won */
  unlocks: z.strictObject({ spells: z.array(id).optional(), buildings: z.array(id).optional() }).optional(),
});
export type LevelDef = z.infer<typeof LevelSchema>;

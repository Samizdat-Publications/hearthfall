// zod schemas for every file in a data pack. Times are authored in seconds; packages/data converts
// them to ticks when building the runtime pack. Unknown keys are rejected so typos fail loudly;
// "$comment" is allowed anywhere a designer might want a note.
import { z } from "zod";

const comment = { $comment: z.string().optional() };

/** M8 skirmish setup choices (map sizes are multiples of the 32 cell render chunk; tribes = opponents + 1, at most 4). App only. */
export const SkirmishMenuSchema = z.strictObject({
  ...comment,
  mapSizes: z.array(z.number().int().min(64).multipleOf(32)).min(1),
  defaultSize: z.number().int(),
  maps: z.array(z.string()).min(1),
  maxOpponents: z.number().int().min(1).max(3),
  defaultOpponents: z.array(z.string()).min(1),
  defaultDifficulty: z.string(),
});
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids are snake_case");
const pos = z.number().nonnegative();
const range2 = z.tuple([z.number(), z.number()]);

// ---------------------------------------------------------------- balance.json
export const BalanceSchema = z.strictObject({
  ...comment,
  sim: z.strictObject({
    tickHz: z.number().int().positive(),
    hashEverySeconds: pos,
  }),
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
    /** BACKLOG 4: move orders with a formation give each unit a slot (cells apart); bigger groups keep the shared flow field */
    formation: z
      .strictObject({ spacing: pos, maxUnits: z.number().int().min(2) })
      .optional(),
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
    priorities: z.strictObject({
      build: z.number().min(0),
      upgrade: z.number().min(0),
      breed: z.number().min(0),
    }),
  }),
  breeding: z.strictObject({
    ...comment,
    /** BACKLOG 30: retired free-form text, never read (frozen golden packs still carry it); the rule is the structured fields */
    formula: z.string().optional(),
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
    buildingFire: z
      .strictObject({ ...comment, seconds: pos, hpPctPerSecond: pos })
      .optional(),
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
      .array(
        z.strictObject({
          ...comment,
          id: z.string(),
          followers: z.number().int().min(0),
          buildings: z.array(z.string()),
        }),
      )
      .min(1),
  }),
  /**
   * Retired (BACKLOG 78, ADR-022): the skirmish menu defaults live in data/ui.json, outside the pack hash, so a menu
   * edit no longer invalidates saves. Kept optional so frozen golden packs (which carry it) still validate; never read.
   */
  skirmish: SkirmishMenuSchema.optional(),
  /**
   * BACKLOG 13 (ADR-014): skirmish victory variants, run by the sim's RulesRuntime. Conquest (the last tribe
   * standing wins) applies under every variant. holdSites: a tribe that alone has people within controlRadius
   * of every site for `seconds` in a row wins; kingOfHill: the tribe with the most people at the first site
   * scores, `seconds` in all wins; lastStand: after `minutes` the tribe with the most followers wins.
   * Optional so frozen packs keep their hash.
   */
  victory: z
    .strictObject({
      ...comment,
      controlRadius: pos,
      default: id,
      variants: z
        .array(
          z.discriminatedUnion("type", [
            z.strictObject({ ...comment, id, type: z.literal("conquest"), name: z.string(), text: z.string() }),
            z.strictObject({ ...comment, id, type: z.literal("holdSites"), seconds: pos, name: z.string(), text: z.string() }),
            z.strictObject({ ...comment, id, type: z.literal("kingOfHill"), seconds: pos, name: z.string(), text: z.string() }),
            z.strictObject({ ...comment, id, type: z.literal("lastStand"), minutes: pos, name: z.string(), text: z.string() }),
          ]),
        )
        .min(1),
    })
    .optional(),
  /**
   * BACKLOG 14b: match weather. In rain every unit moves at `speedMult` of its speed (a skirmish or level
   * option; the app also shows the rain). Optional so frozen packs keep their hash.
   */
  weather: z
    .strictObject({
      ...comment,
      rain: z.strictObject({ ...comment, speedMult: z.number().min(0.3).max(1) }),
    })
    .optional(),
  /**
   * Parking lot (stretch 2): tribe traits, small passive bonuses a skirmish tribe may carry. Each trait scales
   * one or more of: mana income, unit move speed, dwelling birth rate, and damage its units take (armor is
   * the share removed). Optional so frozen packs keep their hash.
   */
  traits: z
    .array(
      z.strictObject({
        ...comment,
        id,
        name: z.string().min(1),
        desc: z.string().min(1),
        income: z.number().min(0.5).max(2).optional(),
        speed: z.number().min(0.5).max(2).optional(),
        breed: z.number().min(0.5).max(2).optional(),
        armor: z.number().min(0).max(0.5).optional(),
      }),
    )
    .optional(),
  /**
   * BACKLOG 11 (ADR-017): Forge mode, an optional pre-match phase of `seconds` in which units are frozen and
   * each tribe reshapes the land for free within `radius` cells of its own Hearth (never within `hearthClear`
   * cells of it), one brush stroke (raise, lower, flatten, smooth: radius `brushRadius`, `amount` height units,
   * smooth `smoothStrength`) per forgeOp, at most `maxOps` per tribe. It ends early when every living tribe
   * is ready. Optional so frozen packs keep their hash.
   */
  forge: z
    .strictObject({
      ...comment,
      seconds: pos,
      radius: pos,
      hearthClear: pos,
      brushRadius: pos,
      amount: z.number().int().min(1).max(200),
      smoothStrength: z.number().min(0).max(1),
      maxOps: z.number().int().min(1).max(1000),
    })
    .optional(),
  /**
   * BACKLOG 98: vehicle tuning (ADR-016). A walker boarding a moving vehicle re-aims every `boardRetryTicks`
   * and gives up after `boardTries`; riders unload on land within the vehicle's boardRadius plus `unloadReach`
   * cells; a Boathouse needs water within `shoreReach` cells of its footprint and launches boats there.
   * Optional so frozen packs keep their hash (code defaults 20, 4, 2, 3).
   */
  vehicles: z
    .strictObject({
      ...comment,
      boardRetryTicks: z.number().int().min(1).max(200),
      boardTries: z.number().int().min(1).max(20),
      unloadReach: z.number().int().min(0).max(8),
      shoreReach: z.number().int().min(1).max(8),
    })
    .optional(),
  /**
   * BACKLOG 1: worship sites on generated (skirmish) maps, at points equidistant from each pair of Hearths
   * and at that point's opposite on the wrapped planet; sites take the list entries in turn. Optional so
   * frozen packs keep their hash.
   */
  /**
   * Stretch 3 (living world): capturable ley stones scattered over skirmish maps when the match asks for
   * them (WorldInit.leyStones). One stone per cellsPerStone of map area at most, on dry land at least
   * minHearthDistance from every Hearth and minSpacing apart; kinds are taken in turn.
   */
  skirmishLey: z
    .strictObject({
      ...comment,
      cellsPerStone: pos,
      minSpacing: pos,
      minHearthDistance: pos,
      kinds: z.array(id).min(1),
    })
    .optional(),
  /**
   * Stretch 3 (living world): wild beast dens. A den holds a pack of beast units (tribe -1) that attack any
   * tribe's unit within the beast's aggroRadius while it stays within leashRadius of the den; a den with a
   * living member regrows a lost one every respawnSeconds, a den whose last member dies is cleared for good.
   * Skirmish maps get dens when the match asks for them (WorldInit.wolfDens), placed like ley stones.
   */
  beasts: z
    .strictObject({
      ...comment,
      respawnSeconds: pos,
      /** idle members roam this far from the den */
      roamRadius: pos,
      cellsPerDen: pos,
      minSpacing: pos,
      minHearthDistance: pos,
      packSize: z.number().int().min(1).max(8),
      kind: id,
    })
    .optional(),
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
    unharassedPopulationAtMinute10: z.strictObject({
      target: z.number(),
      tolerancePct: z.number(),
    }),
    maxStalematePct: z.number(),
    aiEliminatesIdleMinutes: z.number(),
    /** BACKLOG 59: a soak seed fails when one unit gives up a chase more often than this (optional for frozen packs; default 5) */
    maxChaseGiveUpsPerUnit: z.number().int().positive().optional(),
  }),
});
export type Balance = z.infer<typeof BalanceSchema>;

// ---------------------------------------------------------------- style.json
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const StyleSchema = z
  .strictObject({
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
    /** BACKLOG 14: named lighting presets (render/src/weather.ts LightingPreset) and the default one */
    lightingPresets: z
      .record(
        z.string().regex(/^[a-z]+$/),
        z.strictObject({
          keyColor: hex,
          keyIntensity: pos,
          hemiSky: hex,
          ambient: pos,
          sunDir: z.tuple([z.number(), z.number().positive(), z.number()]),
          hearthGlow: z.number().min(0),
          rim: hex,
        }),
      )
      .optional(),
    lightingDefault: z.string().optional(),
    /** BACKLOG 14: visual weather (rain does not touch the sim yet) */
    weather: z
      .strictObject({
        rain: z.strictObject({
          drops: z.number().int().min(0).max(4000),
          color: hex,
          speed: pos,
          dim: z.number().min(0.1).max(1),
          rim: hex,
        }),
      })
      .optional(),
    direction: z
      .strictObject({
        primaryRef: z.string(),
        lightingRef: z.string(),
        chosen: z.string(),
        notes: z.string(),
      })
      .optional(),
    /** retro render pass and look knobs (ADR-005); all optional with defaults in the renderer */
    render: z
      .strictObject({
        ...comment,
        pixelScale: z.number().int().min(1).max(8),
        paletteLevels: z.number().int().min(0).max(64),
        ditherStrength: z.number().min(0).max(1),
        detailNoise: z.number().min(0).max(0.5),
        detailCellsPerUnit: z.number().positive(),
        hearthLight: z.strictObject({
          color: hex,
          intensity: pos,
          distance: pos,
        }),
        ambientIntensity: pos,
        /** look v2: dark starry space around the planet */
        space: z
          .strictObject({
            ...comment,
            top: hex,
            horizon: hex,
            stars: z.number().min(0).max(1),
            rim: hex,
          })
          .optional(),
        /** look v2: density of white foam strokes on open water (0 turns them off) */
        foamStrokes: z.number().min(0).max(1).optional(),
        /** model id to the id of the file that replaces it (BACKLOG 14a-4, models.ts aliasModels) */
        modelAlias: z
          .record(
            z.string().regex(/^[a-z]+\.[a-z0-9_]+$/),
            z.string().regex(/^[a-z]+\.[a-z0-9_]+$/),
          )
          .optional(),
        /** look v3 snow caps and sandstone strata (BACKLOG 14a-4, terrainMesh.ts TerrainBandsLook), height units */
        terrainBands: z
          .strictObject({
            snowStart: z.number().int().min(0),
            snowFull: z.number().int().min(0),
            strataSand: z.number().min(0).max(1),
            snowBright: z.number().min(0.5).max(2),
          })
          .refine(
            (b) => b.snowFull > b.snowStart,
            "snowFull must be above snowStart",
          )
          .optional(),
        /** look v3 tree mix by altitude band (BACKLOG 14a-3, props.ts TreeMix) */
        trees: z
          .strictObject({
            clumpLow: z.number().min(0).max(1),
            clumpHigh: z.number().min(0).max(1),
            bandLow: z.number().min(0).max(1),
            bandHigh: z.number().min(0).max(1),
            modelShare: z.number().min(0).max(1),
            hueJitter: z.number().min(0).max(0.5),
            /** BACKLOG 41: tree scale = (sizeBase + sizeJitter * hash) * (sizeAtNoWood + (1 - sizeAtNoWood) * wood / woodFull) */
            sizeBase: pos.optional(),
            sizeJitter: z.number().min(0).optional(),
            sizeAtNoWood: z.number().min(0).max(1).optional(),
            woodFull: pos.optional(),
          })
          .optional(),
        /** BACKLOG 39: close-up grass tufts, flowers and pebbles (render groundDetail.ts); omitted = code defaults */
        groundDetail: z
          .strictObject({
            enabled: z.boolean(),
            radius: z.number().min(4).max(64),
            maxZoom: z.number().min(0).max(1),
            tufts: z.number().min(0).max(6),
            flowers: z.number().min(0).max(1),
            pebbles: z.number().min(0).max(4),
            shoreBand: z.number().min(0).max(1),
            highBand: z.number().min(0).max(1),
            maxSlope: pos,
            flowerColors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8),
          })
          .refine((g) => g.highBand > g.shoreBand, "highBand must be above shoreBand")
          .optional(),
        /** Stretch 3: landscape decor from the prop models (render decor.ts); omitted = code defaults */
        decor: z
          .strictObject({
            enabled: z.boolean(),
            radius: z.number().min(4).max(96),
            maxZoom: z.number().min(0).max(1),
            density: z.number().min(0).max(0.5),
            maxSlope: pos,
            kinds: z
              .array(z.strictObject({ id: z.string().min(1), weight: z.number().min(0), low: z.number().min(0).max(1), high: z.number().min(0).max(1), size: pos }))
              .max(16),
          })
          .optional(),
        /** BACKLOG 41: the camera rig against zoom z (0 close, 1 globe): distance = base + quad z^2 + linear z,
         * pitch = base + linear z (radians), bend = base + quad z^2, fog from distance * nearMul to
         * distance * farMul + farAdd + farQuad z^2. Absent keys keep the look v2 rig. */
        camera: z
          .strictObject({
            ...comment,
            distance: z.strictObject({ base: pos, linear: z.number().min(0), quad: z.number().min(0) }).optional(),
            pitch: z.strictObject({ base: z.number().min(0.1).max(1.57), linear: z.number() }).optional(),
            bend: z.strictObject({ base: z.number().min(0), quad: z.number().min(0) }).optional(),
            fog: z.strictObject({ nearMul: pos, farMul: pos, farAdd: z.number().min(0), farQuad: z.number().min(0) }).optional(),
          })
          .optional(),
        /** BACKLOG 41: world units drawn per world unit of height (times balance terrain heightUnitsPerWorldUnit); default 2 */
        verticalScale: z.number().min(0.25).max(8).optional(),
        /** look v3 painted water (BACKLOG 14a): per-fragment depth shallows, crisp foam line, offshore ring */
        water: z
          .strictObject({
            shallowDepth: z.number().positive(),
            foamWidth: z.number().positive(),
            foamRing: z.number().min(0),
          })
          .optional(),
        /** look v2 (BACKLOG 0a): draw scale of the building models, so villages read as villages next to the
         * 1.3x readability-scaled units; keep (scale - 1) x the largest footprint within the building gap */
        buildingScale: z.number().min(0.5).max(2).optional(),
        /** BACKLOG 96: per-unit-kind draw scale (default 1; the Shaper stands taller) */
        unitScale: z.record(z.string(), z.number().min(0.5).max(2)).optional(),
        /** BACKLOG 96: effect colors (render/src/vfx.ts VfxColors); any key left out keeps its default */
        vfxColors: z
          .strictObject({
            ...comment,
            spells: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
            statuses: z.strictObject({ ward: z.string(), beguile: z.string(), veil: z.string() }).optional(),
            fire: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).length(3).optional(),
            fallback: z.string().optional(),
            chantRing: z.string().optional(),
            chantHalo: z.string().optional(),
            melee: z.string().optional(),
            chantBreak: z.string().optional(),
            glow: z.string().optional(),
          })
          .optional(),
        /** BACKLOG 37/40: orthographic map view frame: the mask color past the world edge and the grid */
        mapFrame: z
          .strictObject({
            mask: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            grid: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
            gridOpacity: z.number().min(0).max(1).optional(),
            gridCells: z.number().int().min(4).max(64).optional(),
          })
          .optional(),
        /** look v3 (BACKLOG 14a, ADR-013): tilt-shift miniature focus band; `defaultOn` is the settings default */
        tiltShift: z
          .strictObject({
            ...comment,
            defaultOn: z.boolean(),
            order: z.enum(["pre", "post"]),
            bandCenter: z.number().min(0).max(1),
            bandHalf: z.number().min(0).max(0.5),
            falloff: z.number().positive().max(1),
            maxBlur: z.number().min(0).max(8),
            depthWeight: z.number().min(0).max(1),
            depthRange: z.number().positive(),
            saturation: z.number().min(0).max(2),
            contrast: z.number().min(0.5).max(2),
          })
          .optional(),
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
            /** BACKLOG 93: heard from every tribe even without a position (else a rival's unpositioned cue is skipped) */
            global: z.boolean().optional(),
            /** play only when every listed event field equals the value */
            where: z
              .record(z.string(), z.union([z.string(), z.number()]))
              .optional(),
          }),
        ),
        /** M10: cue id to the asset id that serves it (one clip for several cues) */
        alias: z.record(z.string(), z.string().min(1)).optional(),
      })
      .optional(),
    /** BACKLOG 8: alternative tribe colors by palette id (settings: colorblind), keyed by TRIBE_COLORS name */
    tribePalettes: z
      .record(
        z.string(),
        z.record(z.enum(["azure", "crimson", "amber", "jade"]), hex),
      )
      .optional(),
    /** BACKLOG 8: subtitle shown for a voice cue (the barks are in the Shaper's tongue): speaker and meaning */
    subtitles: z
      .record(
        z.string(),
        z.strictObject({ speaker: z.string().min(1), text: z.string().min(1) }),
      )
      .optional(),
    promptStyleSuffix: z.string(),
    promptNegative: z.string(),
    triBudgets: z.record(z.string(), range2),
  })
  .refine(
    (s) =>
      !s.lightingDefault ||
      !s.lightingPresets ||
      s.lightingDefault in s.lightingPresets,
    {
      message: "lightingDefault must name a lightingPresets entry",
      path: ["lightingDefault"],
    },
  );
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
  interruptedBy: z.array(
    z.enum(["rangedDamage", "spell", "terrainChangeNear", "meleeDamage"]),
  ),
  cooldownSeconds: pos,
  /** BACKLOG 65: damage taken during one channel that breaks it (hits below this total do not); absent = any hit breaks */
  breakDamage: pos.optional(),
  /** BACKLOG 61: the chanter closes to this far inside its convert radius before it channels (absent = 0.5) */
  reachInset: z.number().nonnegative().optional(),
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
  /** stretch 3: a wild beast (tribe -1, balance.beasts): bites tribe units within aggroRadius while within leashRadius of its den; tribes fight back */
  beast: z.strictObject({ aggroRadius: pos, leashRadius: pos, biteSeconds: pos }).optional(),
  /** BACKLOG 10 (ADR-016): a vehicle carries other units; nav water sails, air floats over everything */
  vehicle: z
    .strictObject({
      nav: z.enum(["water", "air"]),
      capacity: z.number().int().positive().max(8),
      /** a unit boards when it comes within this many cells */
      boardRadius: pos,
      /** unit ids that keep fighting from aboard (others ride passive) */
      fireFrom: z.array(id).optional(),
      rangeBonus: z.number().optional(),
    })
    .optional(),
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
    /** BACKLOG 30: retired free-form text, never read (frozen golden packs still carry it) */
    popCapFormula: z.string().optional(),
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
  footprint: z.tuple([
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
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
  /** BACKLOG 10: "shore" needs water next to the footprint (Boathouse) */
  placement: z.enum(["shore"]).optional(),
  /** BACKLOG 10: a finished building keeps up to max of this vehicle per building, one every seconds */
  makes: z.strictObject({ unit: id, max: z.number().int().positive(), seconds: pos }).optional(),
  /** stretch 3: a finished building heals its tribe's units within radius, perSecond hp each (Mending Hut) */
  heal: z.strictObject({ radius: pos, perSecond: pos }).optional(),
  /** stretch 3: a finished building adds this much mana per minute to its tribe (Spirit Well) */
  manaPerMin: pos.optional(),
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
    spread: z.strictObject({
      enabled: z.boolean(),
      chancePerMinute: z.number().min(0).max(1),
    }),
  }),
  /** BACKLOG 0c: stone outcrops (optional so frozen packs keep their hash; without it no rock holds stone) */
  rocks: z
    .strictObject({
      ...comment,
      maxStone: z.number().int().positive().max(255),
      mineSecondsPerStone: pos,
    })
    .optional(),
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
          /** stretch 3 (living world): never used up; whoever prayed last holds it until a rival prays it away */
          capturable: z.boolean().optional(),
          /** stretch 3: what the site does for its holder while held (a site can override) */
          aura: z.lazy(() => AuraSchema).optional(),
        }),
      )
      .optional(),
  }),
});
export type BuildingDef = z.infer<typeof BuildingSchema>;
export type BuildingsFile = z.infer<typeof BuildingsFileSchema>;

// ---------------------------------------------------------------- spells.json (effect primitives)
/** BACKLOG 31: a terrainOp spell effect for one op: the shared fields plus that op's own */
function terrainOpVariant<O extends string, S extends z.ZodRawShape>(op: O, shape: S) {
  return z.strictObject({
    type: z.literal("terrainOp"),
    op: z.literal(op),
    from: z.enum(["caster", "target"]).optional(),
    /** BACKLOG 36: the land moves this many seconds after the cast (rumble and cracks first) so players see cause and effect */
    leadInSeconds: pos.optional(),
    ...shape,
  });
}

const Effect = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("damageRadius"),
    radius: pos,
    damage: pos,
    downhillBonusPct: z.number().optional(),
    canKill: z.array(id).optional(),
  }),
  /** edgeFalloff: share of the force lost at the rim (0 = same push everywhere) */
  z.strictObject({
    type: z.literal("knockback"),
    radius: pos,
    force: pos,
    edgeFalloff: z.number().min(0).max(1),
  }),
  z.strictObject({
    type: z.literal("convertRadius"),
    radius: pos,
    max: z.number().int().positive(),
    excludes: z.array(id).optional(),
    targets: z.array(id).optional(),
  }),
  z.strictObject({
    type: z.literal("areaOverTime"),
    radius: pos,
    seconds: pos,
    damagePerSecond: pos,
  }),
  /** stretch 3: a mending ground that heals the caster tribe's units inside it, up to their full hp (Sanctuary) */
  z.strictObject({
    type: z.literal("healOverTime"),
    radius: pos,
    seconds: pos,
    healPerSecond: pos,
  }),
  z.strictObject({
    type: z.literal("statusApply"),
    status: z.enum([
      "ward",
      "veil",
      "beguiled",
      "burning",
      "panic",
      "entranced",
    ]),
    seconds: pos,
    radius: pos.optional(),
    max: z.number().int().positive().optional(),
    /** who it lands on (default enemy): Veil and Ward are cast on your own units */
    targets: z.enum(["enemy", "own"]).optional(),
    poppedBy: z.array(id).optional(),
    breaksOnCasterDeath: z.boolean().optional(),
  }),
  /** BACKLOG 31: one variant per op, each with its required parameters (the ops spells can use) */
  z.discriminatedUnion("op", [
    terrainOpVariant("ridgeLine", {
      /** a wall from the caster toward the target, at most `length` cells */
      width: pos,
      heightAboveSea: z.number(),
      length: pos.optional(),
    }),
    terrainOpVariant("flattenToAverage", { radius: pos, minHeightAboveSea: z.number().optional() }),
    terrainOpVariant("noiseScar", { radius: pos, depth: z.number() }),
    terrainOpVariant("crater", { radius: pos, height: z.number(), shape: z.enum(["bowl", "cone"]).optional() }),
    terrainOpVariant("lowerTowardSea", {
      radius: pos,
      depth: z.number(),
      /** spread over this many seconds, `depth` applied once per second */
      seconds: pos.optional(),
    }),
    terrainOpVariant("raise", { radius: pos, height: z.number() }),
    terrainOpVariant("lower", { radius: pos, depth: z.number() }),
  ]),
  /** a vortex that wanders from the target (cells per second), flings units it touches and wears down buildings */
  z.strictObject({
    type: z.literal("moverPath"),
    entity: id,
    seconds: pos,
    radius: pos,
    speed: pos,
    wander: z.boolean().optional(),
    flingForce: pos,
    buildingDamagePctPerSecond: z.number().min(0).max(100).optional(),
  }),
  z.strictObject({
    type: z.literal("spawnEntity"),
    entity: id,
    radius: pos.optional(),
    count: z.number().int().positive().optional(),
  }),
  /** a visible bog: kills the first `kills` non-caster units of other tribes that stand in it */
  z.strictObject({
    type: z.literal("trap"),
    radius: pos,
    kills: z.number().int().positive(),
    seconds: pos,
  }),
  z.strictObject({
    type: z.literal("damageBuildingsRadius"),
    radius: pos,
    damagePct: z.number().min(0).max(100),
  }),
  /** `count` impacts spread evenly over `seconds`, each at a random point within `radius`, hitting units and buildings within `impactRadius` */
  z.strictObject({
    type: z.literal("projectileStorm"),
    count: z.number().int().positive(),
    radius: pos,
    impactRadius: pos,
    seconds: pos,
    damage: pos,
    knockback: pos.optional(),
  }),
  /** a flying hunter: flies (cells per second) to the nearest enemy unit within huntRadius and kills it, one kill per killSeconds */
  z.strictObject({
    type: z.literal("summon"),
    entity: id,
    seconds: pos,
    speed: pos,
    huntRadius: pos,
    killSeconds: pos,
    maxKills: z.number().int().positive().max(255),
  }),
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
  aiTarget: z
    .enum([
      "units",
      "buildings",
      "wild",
      "bridge",
      "ownFighting",
      "ownMarching",
      "none",
    ])
    .optional(),
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
  entities: z
    .array(z.strictObject({ ...comment, id, effects: z.array(Effect).min(1) }))
    .default([]),
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
  /** stretch 2: the balance.traits id this personality carries when a skirmish is played with traits */
  trait: id.optional(),
  /** BACKLOG 64: no tower is planned before this share of economyTargetPop is reached (unless threatened) */
  towerFromPopShare: z.number().min(0).max(1).optional(),
  /** BACKLOG 2: keep this many Shades from this match minute on and send them at enemy buildings */
  shades: z
    .strictObject({
      ...comment,
      count: z.number().int().positive(),
      fromMinute: pos,
    })
    .optional(),
  /**
   * BACKLOG 11 (ADR-017): what the AI does in a Forge phase: moat (lower) or wall (raise) brush strokes, 24 a
   * pass on a circle of `ring` cells around its Hearth, with two gaps (toward and away from the nearest rival), or
   * flatten building room on rings `ring` and `ring` - 2; `strokes` in all, `perDecision` at a time, then ready.
   */
  forge: z
    .strictObject({
      ...comment,
      plan: z.enum(["moat", "wall", "flatten"]),
      ring: pos,
      strokes: z.number().int().positive(),
      perDecision: z.number().int().positive(),
    })
    .optional(),
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
/** BACKLOG 69: numbers every personality shares (they were literals in opponent.ts); absent in older packs = these defaults */
export const AiSharedSchema = z.strictObject({
  ...comment,
  /** enemy troops and casters this close to the Hearth are threats (cells) */
  threatRadius: pos,
  /** an own unit this close to an enemy Hearth scouts it for good (cells) */
  scoutRadius: pos,
  /** troops this close to the Hearth answer a threat (cells) */
  defendRadius: pos,
  /** attack wave size = round(waveBase + (1 - aggression) * waveAggressionSpan) */
  waveBase: pos,
  waveAggressionSpan: z.number().nonnegative(),
  /** settlers kept out of training: max(keepMin, round(economyTargetPop * keepShare)); keepUnderThreat while enemies are at the Hearth */
  keepShare: z.number().min(0).max(1),
  keepMin: z.number().int().nonnegative(),
  keepUnderThreat: z.number().int().nonnegative(),
  /** a single-type wave waits for a second unit type up to this many minutes after firstAttackMinute */
  mixedHoldMinutes: z.number().nonnegative(),
  /** attack score = clamp01(attackScoreBase + attackScoreAggression * aggression + attackScoreSurplus * (idle / wave - 1)) */
  attackScoreBase: z.number(),
  attackScoreAggression: z.number(),
  attackScoreSurplus: z.number(),
  /** targets for a spell are searched this far beyond its range (cells) */
  castReachSlack: z.number().nonnegative(),
  /** BACKLOG 88: settlers kept home besides the ones sent to worship (optional: shared blocks frozen before it; default 4) */
  worshipKeepSettlers: z.number().int().nonnegative().optional(),
  /** BACKLOG 23: score added to the action a move picker focuses on (OpponentAI.setFocus) */
  focusBoost: z.number().nonnegative().optional(),
});
export type AiShared = z.infer<typeof AiSharedSchema>;
export const AI_SHARED_DEFAULTS: AiShared = {
  threatRadius: 14,
  scoutRadius: 14,
  defendRadius: 30,
  waveBase: 4,
  waveAggressionSpan: 10,
  keepShare: 0.35,
  keepMin: 8,
  keepUnderThreat: 6,
  mixedHoldMinutes: 3,
  attackScoreBase: 0.35,
  attackScoreAggression: 0.5,
  attackScoreSurplus: 0.15,
  castReachSlack: 10,
  worshipKeepSettlers: 4,
};
export const AiFileSchema = z.strictObject({
  ...comment,
  personalities: z.array(PersonalitySchema),
  difficulties: z.array(DifficultySchema),
  shared: AiSharedSchema.optional(),
});
export type AiFile = z.infer<typeof AiFileSchema>;

// ---------------------------------------------------------------- terrain.json (planet generator)
const BandMap = z.strictObject({
  shore: z.number(),
  lowland: z.number(),
  grass: z.number(),
  highland: z.number(),
  rock: z.number(),
  peak: z.number(),
});
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
  terrace: z
    .strictObject({
      step: z.number().positive(),
      flat: z.number().min(0).max(0.9),
      rampSlope: z.number().positive(),
    })
    .optional(),
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
    hearthGrove: z
      .strictObject({
        inner: pos,
        outer: pos,
        density: z.number().min(0).max(1),
      })
      .optional(),
  }),
  hearth: z.strictObject({
    flatRadius: pos,
    minHeightAboveSea: pos,
    maxSiteRange: pos,
    minSpacingFracOfSize: z.number().min(0).max(0.5),
  }),
  wild: z.strictObject({ distance: range2 }),
  /** BACKLOG 0c: stone outcrops per Hearth (cells from its center) and scattered over the land (per 1000 land vertices) */
  rocks: z
    .strictObject({
      ...comment,
      perHearth: z.number().int().min(0),
      distance: range2,
      scatterPerThousandLand: z.number().min(0),
      clearTreesRadius: z.number().min(0),
    })
    .optional(),
  maxRerolls: z.number().int().min(0).max(100),
  /** BACKLOG 34: generator constants. Optional so frozen golden packs keep their hash; code defaults = GEN_DEFAULTS. */
  gen: z
    .strictObject({
      ...comment,
      /** generated sea stays at or below sea - shoreGap, generated land starts at sea + shoreGap */
      shoreGap: z.number().int().min(0),
      /** trees, rocks and tree regrowth need at least this height above sea */
      treeMinAboveSea: z.number().int().min(0),
      /** multiplies the clustered tree density from densityByBand */
      treeDensityScale: pos,
      /** a tree sits at cell + jitterMin + random * jitterSpan on each axis */
      treeJitterMin: z.number().min(0).max(1),
      treeJitterSpan: z.number().min(0).max(1),
      /** random placement attempts per wild person or rock */
      placeTries: z.number().int().positive(),
      /** Hearth site candidates are tested every this many vertices */
      hearthCandidateStride: z.number().int().positive(),
      /** rocks keep this far from each other, and Hearths clear this much past the tree clear radius */
      rockSpacing: pos,
      rockHearthExtra: z.number().min(0),
    })
    .optional(),
  /** BACKLOG 34: terrain op shapes. Optional like gen; code defaults = TERRAIN_OPS_DEFAULTS. */
  ops: z
    .strictObject({
      ...comment,
      /** a footprint is buildable only at or above sea + buildableAboveSea */
      buildableAboveSea: z.number().int().min(0),
      /** erosion never sinks land below sea - drownDepth * erodeFloorDrownDepths */
      erodeFloorDrownDepths: pos,
      /** flattenToAverage: the inner share of the disc is level, the rest blends back */
      flattenPlateau: z.number().min(0).max(0.99),
      /** ridgeLine: cells beyond the half width taper to sea over this many cells */
      ridgeTaper: pos,
      /** crater cone: inside craterVentRadius (share of radius) the summit drops by craterVentDepth * height */
      craterVentRadius: z.number().positive().max(1),
      craterVentDepth: z.number().min(0).max(1),
      /** noiseScar: depth * (scarBase + scarNoise * n), plus scarCrack where n > scarCrackAbove */
      scarCrackAbove: z.number().min(0).max(1),
      scarCrack: z.number().min(0),
      scarBase: z.number().min(0),
      scarNoise: z.number().min(0),
    })
    .optional(),
});
export type TerrainFile = z.infer<typeof TerrainFileSchema>;
export type TerrainGen = NonNullable<TerrainFile["gen"]>;
export type TerrainOps = NonNullable<TerrainFile["ops"]>;
/** BACKLOG 34: the literals these blocks replaced (packs without them generate and edit exactly as before). */
export const GEN_DEFAULTS: TerrainGen = {
  shoreGap: 2,
  treeMinAboveSea: 4,
  treeDensityScale: 4,
  treeJitterMin: 0.2,
  treeJitterSpan: 0.6,
  placeTries: 24,
  hearthCandidateStride: 2,
  rockSpacing: 3,
  rockHearthExtra: 3,
};
export const TERRAIN_OPS_DEFAULTS: TerrainOps = {
  buildableAboveSea: 2,
  erodeFloorDrownDepths: 2,
  flattenPlateau: 0.75,
  ridgeTaper: 1.5,
  craterVentRadius: 0.15,
  craterVentDepth: 0.25,
  scarCrackAbove: 0.85,
  scarCrack: 0.8,
  scarBase: 0.4,
  scarNoise: 0.6,
};

// ---------------------------------------------------------------- manifest.json
export const ManifestSchema = z.strictObject({
  ...comment,
  id,
  name: z.string(),
  version: z.string(),
  loadOrder: z.number().int(),
  /** BACKLOG 18: a mod's one-line description (mods/<id>/manifest.json) */
  description: z.string().optional(),
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

/**
 * BACKLOG 78 (ADR-022): data/ui.json, app only and outside the pack hash (like achievements.json): the skirmish
 * menu defaults and the HUD and input tunables. Editing it never invalidates saves or replays.
 */
export const UiFileSchema = z.strictObject({
  ...comment,
  skirmish: SkirmishMenuSchema,
  /** parking lot (stretch 2): after the player casts `after`, a one-time HUD tip suggests `then` (if castable) */
  combos: z.array(z.strictObject({ ...comment, after: id, then: id, text: z.string().min(1).max(110) })).optional(),
  /** stretch 2 playtest pass: first skirmish tips, one at a time in the objectives panel; each step id has a done check in apps/game/src/tips.ts */
  tips: z.array(z.strictObject({ ...comment, id: z.enum(["dwelling", "cast", "lodge", "train", "attack", "win"]), text: z.string().min(1).max(140) })).optional(),
  notes: z.strictObject({
    ...comment,
    /** how long a HUD notification stays up */
    seconds: pos,
    /** notifications shown at once (older ones drop) */
    max: z.number().int().positive(),
    /** BACKLOG 8: how long a voice subtitle stays up */
    subtitleSeconds: pos,
    /** BACKLOG 45: a failed or abandoned order counts as the player's for this long after the click */
    orderFeedbackSeconds: pos,
  }),
  input: z.strictObject({
    ...comment,
    /** BACKLOG 4: double-click selects own units of the clicked type within this many cells */
    sameTypeRadius: pos,
    /** BACKLOG 4: a control group key pressed twice within this many milliseconds centers the camera */
    groupJumpMs: pos,
  }),
  /** render scale per graphics quality setting (high, medium, low) */
  qualityScale: z.strictObject({ high: z.number().min(0.25).max(2), medium: z.number().min(0.25).max(2), low: z.number().min(0.25).max(2) }),
});
export type UiFile = z.infer<typeof UiFileSchema>;

/** Skirmish setup used when there is no data/ui.json skirmish block (kept for tools and tests). */
export const SKIRMISH_DEFAULTS = {
  mapSizes: [96, 128, 192, 256],
  defaultSize: 128,
  maps: ["continents", "islands"],
  maxOpponents: 3,
  defaultOpponents: ["aggressive"],
  defaultDifficulty: "normal",
};

// ---------------------------------------------------------------- worship sites, levels (M9, data/levels/*.json)
const point = z.tuple([z.number(), z.number()]);

/** What a worship site (or a level trigger) gives. Rewards go to the tribe that completed the prayer. */
export const RewardSchema = z.discriminatedUnion("type", [
  /** one-shot charges: usable even when the spell is not unlocked, never recharged unless it is */
  z.strictObject({
    type: z.literal("charges"),
    spell: id,
    n: z.number().int().min(1),
  }),
  /** permanent spell unlock (reliquary) */
  z.strictObject({ type: z.literal("unlockSpell"), spell: id }),
  /** permanent building unlock, ignoring follower tiers and level limits */
  z.strictObject({ type: z.literal("unlockBuilding"), building: id }),
  /** a spell's effects at a point (the site when `at` is absent), cast by nobody from `from` (the site by default): totem land bridges, scripted raids */
  z.strictObject({ type: z.literal("spell"), spell: id, at: point.optional(), from: point.optional() }),
  /** units for the rewarded tribe (or `tribe`, -1 for wild people) near a point (the site by default) */
  z.strictObject({
    type: z.literal("spawn"),
    unit: id,
    n: z.number().int().min(1).max(50),
    tribe: z.number().int().min(-1).optional(),
    at: point.optional(),
    /** stretch 3: "defensive" spawns posted guards (the opponent AI never sends them away) */
    stance: z.enum(["aggressive", "defensive", "passive"]).optional(),
  }),
  /** level scripting: every trained troop of `tribe` (at most `n`, posted guards excluded) attack-moves to `to` (a war band crossing) */
  z.strictObject({
    type: z.literal("raid"),
    tribe: z.number().int().min(0),
    to: point,
    n: z.number().int().min(1).max(200).optional(),
  }),
  /** prayer chains: wake a dormant site (by tag) so it can be worshipped; it rises from the ground */
  z.strictObject({ type: z.literal("awaken"), site: id }),
  /** lift the fog over a disc (the site by default) for the rewarded tribe: shows where a chain leads */
  z.strictObject({ type: z.literal("reveal"), at: point.optional(), r: z.number().min(1).max(64) }),
  /**
   * stretch 3 (living world): reshape land over `seconds` (instant when 0 or absent): a disc (r), rect
   * (size) or line (at to `to`, `width` wide) moves toward sea + aboveSea, blended over `falloff` cells.
   * Tides, rising causeways, sinking fords; whoever stands on land that goes under drowns.
   */
  z.strictObject({
    type: z.literal("shape"),
    shape: z.enum(["disc", "rect", "line"]),
    at: point.optional(),
    r: pos.optional(),
    size: point.optional(),
    to: point.optional(),
    width: pos.optional(),
    aboveSea: z.number().min(-60).max(120),
    falloff: z.number().min(0).max(16).optional(),
    seconds: z.number().min(0).max(600).optional(),
  }),
  /** a message for the player (HUD notification) */
  z.strictObject({
    type: z.literal("message"),
    text: z.string().min(1).max(160),
  }),
]);
export type Reward = z.infer<typeof RewardSchema>;

/**
 * Stretch 3 (living world): what a held capturable site does for its holder every `every` seconds:
 * mana (amount is mana per minute, added to income), strike (damage to the nearest enemy unit within r),
 * heal (each own unit within r), sight (reveals r around the site).
 */
export const AuraSchema = z.strictObject({
  type: z.enum(["mana", "strike", "heal", "sight"]),
  amount: z.number().min(0),
  r: z.number().min(0).max(32),
  every: pos,
});
export type Aura = z.infer<typeof AuraSchema>;

/** One worship object on a map. Unset fields come from its kind in buildings.json worship.kinds. */
export const SiteSpecSchema = z.strictObject({
  tag: id.optional(),
  worshippers: z.number().int().min(1).max(8).optional(),
  prayerSeconds: pos.optional(),
  uses: z.number().int().min(1).optional(),
  /** prayer chains: asleep (sunk, cannot be worshipped) until an awaken reward names it */
  dormant: z.boolean().optional(),
  /** stretch 3: replaces the kind's aura */
  aura: AuraSchema.optional(),
  rewards: z.array(RewardSchema),
});
export type SiteSpec = z.infer<typeof SiteSpecSchema>;

const LevelSetup = z.strictObject({
  /** unit, building, worship kind, "tree" or "rock" */
  spawn: id,
  tribe: z.number().int().min(-1).optional(),
  at: point.optional(),
  near: point.optional(),
  count: z.number().int().min(1).max(200).optional(),
  spacing: pos.optional(),
  site: SiteSpecSchema.optional(),
  /** stretch 3: units start in this stance; "defensive" units are posted guards the opponent AI never sends away */
  stance: z.enum(["aggressive", "defensive", "passive"]).optional(),
});

/** stretch 3: a staged objective stays hidden and unchecked until objective `after` is done */
const stage = { text: z.string().optional(), after: z.number().int().min(0).optional() };

export const ObjectiveSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("eliminateAll"), ...stage }),
  z.strictObject({ type: z.literal("worship"), site: id, ...stage }),
  /** `fromStage`: count from the tick the stage opened (its `after` is done), not from the match start */
  z.strictObject({ type: z.literal("survive"), seconds: pos, fromStage: z.boolean().optional(), ...stage }),
  z.strictObject({ type: z.literal("followers"), n: z.number().int().min(1), ...stage }),
  /** BACKLOG 13 in the campaign: win the level's victory rules (`rules`); a rival winning them loses the level */
  z.strictObject({ type: z.literal("victory"), ...stage }),
  /** stretch 3: `tribe` has no `building` left (any state), e.g. raze a rival's Watchtowers */
  z.strictObject({ type: z.literal("destroy"), tribe: z.number().int().min(1), building: id, ...stage }),
  /** stretch 3: one of the player's `unit` (default the Shaper) stands within `r` of `at` */
  z.strictObject({ type: z.literal("reach"), at: point, r: pos, unit: id.optional(), ...stage }),
  /** stretch 3: the player owns `n` finished `building` */
  z.strictObject({ type: z.literal("build"), building: id, n: z.number().int().min(1), ...stage }),
  /** stretch 3: the player holds `n` capturable stones (of `kind`, any when absent) at once for `seconds` without a break */
  z.strictObject({ type: z.literal("hold"), n: z.number().int().min(1), kind: id.optional(), seconds: z.number().min(0), ...stage }),
  /** stretch 3: `n` beast dens are cleared (every den when absent); with `at` and `r` only dens within r of at count */
  z.strictObject({ type: z.literal("clearDens"), n: z.number().int().min(1).optional(), at: point.optional(), r: pos.optional(), ...stage }),
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
    /** stretch 3: with `every` the trigger fires again every that many seconds (tides, eruptions) */
    z.strictObject({ type: z.literal("time"), seconds: pos, every: pos.optional() }),
    z.strictObject({ type: z.literal("worship"), site: id }),
    z.strictObject({
      type: z.literal("objective"),
      index: z.number().int().min(0),
    }),
    /** stretch 3: one of the player's `unit` (any unit when absent) enters the disc; rewards anchor at `at` */
    z.strictObject({ type: z.literal("area"), at: point, r: pos, unit: id.optional() }),
    /** stretch 3: the player reaches `n` followers */
    z.strictObject({ type: z.literal("followers"), n: z.number().int().min(1) }),
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
  tribes: z
    /** maxTroops (BACKLOG 83): the tribe may not train past this many troops (alive, walking to or in training) */
    /** worshipAfterSeconds (BACKLOG 88): the AI sends no worshippers before this much play time */
    .array(z.strictObject({ ai: id.optional(), difficulty: id.optional(), maxTroops: z.number().int().min(0).optional(), worshipAfterSeconds: z.number().min(0).optional() }))
    .min(1)
    .max(4),
  /** spells unlocked at the start for every tribe (campaign unlocks are added for the player) */
  spells: z.array(id),
  /** buildings every tribe may build (others need an unlockBuilding reward); absent means all */
  buildings: z.array(id).optional(),
  /** BACKLOG 13: a balance.victory variant id; holdSites and kingOfHill count this level's worship sites (the first for kingOfHill) */
  rules: id.optional(),
  /** BACKLOG 11: the level opens with a Forge phase (balance.forge); level timers start at its end */
  forge: z.boolean().optional(),
  /** stretch 3: "player" makes the level's beasts hunt only the player's tribe (rival villages are left alone); default "all" */
  beastPrey: z.enum(["all", "player"]).optional(),
  /** BACKLOG 14b: the level is played in rain (balance.weather.rain) */
  weather: z.enum(["clear", "rain"]).optional(),
  setup: z.array(LevelSetup).min(1),
  objectives: z.array(ObjectiveSchema).min(1),
  lose: z.array(LoseSchema).optional(),
  triggers: z.array(TriggerSchema).optional(),
  /** carried forward in the campaign when the level is won */
  unlocks: z
    .strictObject({
      spells: z.array(id).optional(),
      buildings: z.array(id).optional(),
    })
    .optional(),
});
export type LevelDef = z.infer<typeof LevelSchema>;

// ---------------------------------------------------------------- BACKLOG 21: achievements and records
/**
 * Stats the app counts from the event log of each finished match (MatchStats) and sums or maxes over
 * all matches (career). `won` is 1 for a won match; `minutes` is the match length; `matches` and
 * `levelsWon` are career only. Achievements are thresholds over these; they never touch the sim, so
 * this file is not part of the pack hash (like data/levels).
 */
export const STAT_KEYS = [
  "matches",
  "won",
  "levelsWon",
  "minutes",
  "kills",
  "drownedFoes",
  "lost",
  "shaperDeaths",
  "spellsCast",
  "buildingsBuilt",
  "buildingsRazed",
  "converted",
  "trained",
  "born",
  "worship",
  "peakFollowers",
] as const;
export const StatKeySchema = z.enum(STAT_KEYS);
export type StatKey = z.infer<typeof StatKeySchema>;

const StatTest = z
  .strictObject({
    stat: StatKeySchema,
    /** inclusive bounds; at least one */
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((t) => t.min !== undefined || t.max !== undefined, "a test needs min or max");

export const AchievementSchema = z.strictObject({
  id,
  name: z.string().min(1).max(32),
  /** one line shown under the name */
  description: z.string().min(1).max(90),
  /** match: tested on the stats of one finished match; career: on the totals after it */
  scope: z.enum(["match", "career"]),
  /** every test must hold */
  when: z.array(StatTest).min(1),
  /** match scope only: limit to a difficulty (the highest opponent difficulty), skirmish or campaign levels */
  difficulty: z.array(id).optional(),
  mode: z.enum(["skirmish", "level"]).optional(),
});
export type AchievementDef = z.infer<typeof AchievementSchema>;

export const AchievementsFileSchema = z.strictObject({
  /** the records screen: which career stats to list, in order, and their labels */
  records: z.array(z.strictObject({ stat: StatKeySchema, label: z.string().min(1).max(28) })).min(1),
  achievements: z.array(AchievementSchema).min(1),
});
export type AchievementsFile = z.infer<typeof AchievementsFileSchema>;

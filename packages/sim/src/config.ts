// Runtime configuration derived from a validated data pack: seconds become ticks, ids become
// indices. The sim reads numbers only from here (or the pack), never from literals in code.
import { secondsToTicks, type PackFiles } from "@hearthfall/data";

export { secondsToTicks };

export interface SimConfig {
  pack: PackFiles;
  packHash: string;
  tickHz: number;
  hashEveryTicks: number;
  sea: number;
  heightMax: number;
  drownDepth: number;
  maxWalkSlope: number;
  maxBuildSlope: number;
  maxBuildRange: number;
  bands: { shore: number; lowland: number; grass: number; highland: number; rock: number; peak: number };
  unitIndex: Map<string, number>;
  buildingIndex: Map<string, number>;
  spellIndex: Map<string, number>;
}

export function makeConfig(pack: PackFiles, packHash: string): SimConfig {
  const b = pack.balance;
  const idx = (ids: string[]) => new Map(ids.map((id, i) => [id, i]));
  return {
    pack,
    packHash,
    tickHz: b.sim.tickHz,
    hashEveryTicks: secondsToTicks(b.sim.hashEverySeconds, b.sim.tickHz),
    sea: b.terrain.seaLevel,
    heightMax: b.terrain.heightMax,
    drownDepth: b.terrain.drownDepthHeightUnits,
    maxWalkSlope: b.terrain.maxWalkSlope,
    maxBuildSlope: b.terrain.maxBuildSlope,
    maxBuildRange: b.terrain.maxBuildRange,
    bands: b.terrain.bands,
    unitIndex: idx(pack.units.units.map((u) => u.id)),
    buildingIndex: idx(pack.buildings.buildings.map((x) => x.id)),
    spellIndex: idx(pack.spells.spells.map((s) => s.id)),
  };
}

export type BandName = "shore" | "lowland" | "grass" | "highland" | "rock" | "peak";

/** Height band of a height value (below sea counts as shore for band purposes). */
export function bandOf(cfg: SimConfig, h: number): BandName {
  const b = cfg.bands;
  if (h < b.shore) return "shore";
  if (h < b.lowland) return "lowland";
  if (h < b.grass) return "grass";
  if (h < b.highland) return "highland";
  if (h < b.rock) return "rock";
  return "peak";
}

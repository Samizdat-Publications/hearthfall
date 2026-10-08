import { readFileSync, readdirSync } from "node:fs";
import { validatePack, type ValidatedPack } from "@hearthfall/data";
import { World } from "../src/world.ts";
import type { MapSpec } from "../src/generator.ts";
import { Terrain } from "../src/terrain.ts";

let cached: ValidatedPack | undefined;
export function basePack(): ValidatedPack {
  if (cached) return cached;
  const dir = new URL("../../../data/base/", import.meta.url);
  const raw = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8"))]));
  const res = validatePack(raw);
  if (!res.pack) throw new Error(JSON.stringify(res.issues.slice(0, 3)));
  cached = res.pack;
  return cached;
}

export function world(map: MapSpec, seed = 1): World {
  const p = basePack();
  return new World({ pack: p.files, packHash: p.hash, seed, map });
}

export function flatTerrain(size = 32, h = 160): Terrain {
  const t = new Terrain({ size, seaLevel: 120, heightMax: 1023, drownDepth: 8, maxWalkSlope: 20, maxBuildSlope: 6 });
  t.heights.fill(h);
  return t;
}

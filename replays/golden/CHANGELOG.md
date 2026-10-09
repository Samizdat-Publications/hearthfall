# Golden replay changelog

Every rebless appends its reason here (`npm run replays:rebless -- --reason "..."`). A rebless without an intended sim change is a bug.

## 2026-10-08 22:10 UTC
Reason: M1: first golden replay, terrain ops on a continents planet
- terrain_ops_continents: final none -> 0df1bbfc (pack 46ad2aff)

## 2026-10-08 22:19 UTC
Reason: M1 review: world rng seeded apart from the generator rng; golden ridgeLine moved to cross water (94..103, y 0) so it protects that op
- terrain_ops_continents: final 0df1bbfc -> 3de2299d (pack 46ad2aff)

## 2026-10-08 22:20 UTC
Reason: M1 review: golden ridgeLine actually moved to cross water (92..105, y 0); the previous rebless did not apply the coordinate change
- terrain_ops_continents: final 3de2299d -> 9f543758 (pack 46ad2aff)

## 2026-10-08 22:40 UTC
Reason: M3: entity movement columns (prev pos, velocity, order, goal, path state) and the unit movement system with separation change entity hashes; balance.movement added
- terrain_ops_continents: final 9f543758 -> ed637462 (pack 968c9535)

## 2026-10-08 23:01 UTC
Reason: M3: populated worlds now spawn each tribe's Shaper and startPopulation settlers around the Hearth (DESIGN section 4)
- terrain_ops_continents: final ed637462 -> a9287b42 (pack 98511ae5)

## 2026-10-08 23:29 UTC
Reason: M3 review + M4: economy state in tribe hash (mana, charges), economy entity columns, settler autonomy and tree regrowth, movement fixes (fine line of sight, blocked-step recovery, selective re-plan after terrain edits)
- terrain_ops_continents: final a9287b42 -> ea078df0 (pack 87a15ca2)

## 2026-10-08 23:31 UTC
Reason: M3 soak fix: line of sight refuses torus-ambiguous half-map segments, changing smoothed paths
- terrain_ops_continents: final ea078df0 -> ea078df0 (pack 87a15ca2)

## 2026-10-08 23:51 UTC
Reason: M4: starting settlers carry startWoodPerSettler and deliver it first; spawns wrap positions; economy data schema grew
- terrain_ops_continents: final ea078df0 -> 1fea2859 (pack 52b4ba78)

## 2026-10-09 00:30 UTC
Reason: M5: combat and status entity columns, Shaper and cast state in the tribe hash, spells and effect primitives in the step
- terrain_ops_continents: final 1fea2859 -> 38553ea7 (pack cefcd6de)

## 2026-10-09 00:34 UTC
Reason: M4 review: priorities in the tribe hash, forest spread on its own rng stream, stumps cleared at plan placement
- terrain_ops_continents: final 38553ea7 -> 7e6e82ec (pack cefcd6de)

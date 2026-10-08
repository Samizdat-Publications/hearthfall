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

# HEARTHFALL: Game Design Document (living)

Title: **Hearthfall** (codename `hearthfall`). The name comes from the core loop: your caster, the Shaper, falls and returns to the Hearth, and the great spells fall from the sky. An original god game inspired by the systems of the late-90s shaman-led tribal god games. We lift system relationships (population powers magic, a mortal avatar caster, deformable curved world, water kills), never names, art, audio, or level designs. Research backing every number: `docs/research/populous_mechanics.md`.

This file is the source of truth for intent. Numbers here are starting values; the live values are in `data/base/*.json` and win any conflict. When you change a rule, update this file in the same commit.

---

## 1. Pillars

1. **Shape the world, not just the army.** Terrain is the main weapon and the main puzzle. Raising, sinking, flattening and breaking land must feel physical and consequential.
2. **Your people are your power.** Mana comes from followers living and working. Every soldier trained and every settler lost is felt in spell charge time.
3. **The avatar is mortal.** One caster, limited range, dies and returns. Protecting and positioning her is the core skill.
4. **Readable chaos.** Hundreds of units, big spells, but you can always tell who is who, what is charging, and why you lost a fight.
5. **Built to grow.** Every unit, building, spell, AI personality and level is data. New content should rarely need new engine code.

## 2. Fiction and naming (original)

| Concept | Our name | Notes |
|---|---|---|
| Avatar caster | **the Shaper** | Sole spellcaster of a tribe. Directly controlled. |
| Respawn point | **Hearth** | Shaper returns here after death. No Hearth and no followers means defeat. |
| Worker | **Settler** | Builds, gathers wood, breeds, prays, can be trained. |
| Melee troop | **Warden** | Tough, slow. Beats Firecallers. |
| Ranged troop | **Firecaller** | Area fireballs, range bonus from height and towers. Beats Chanters. |
| Converter | **Chanter** | Chants enemies (not Shapers or Chanters) to your side. Beats Wardens. |
| Saboteur | **Shade** | Disguises as enemy color, burns buildings and trees. |
| Housing | **Dwelling** (small/medium/large) | Holds settlers, breeds new ones. |
| Defense | **Watchtower** | Garrison for range and protection. |
| Training | **Warden Lodge, Fire Lodge, Chant House, Shade Den** | Convert a settler into a troop. |
| One-shot reward | **Shrine** | Worship it to gain one-shot spells or a one-time building. |
| Permanent unlock | **Reliquary** | Worship to permanently unlock a spell or building. |
| Map trigger | **Totem** | Scripted map effects. |
| Tribes | **Azure** (player default), **Crimson**, **Amber**, **Jade** | Colors only, no lore names yet. |
| Currency | **Mana** | Generic term, kept. |

Avoid anywhere in code, data, UI and assets: the original title, its tribe names, unit name set, building names, incantations, level names, sprites, music.

## 3. Core loop

Moment to moment: settlers chop trees, build and expand dwellings, which breed more settlers, which generate mana. Mana charges spells for the Shaper and pays for training troops. The Shaper walks to the front, casts within range, and the tribe fights over land, shrines and reliquaries. Terrain spells open routes (raise land across water), destroy bases (quake, erode, volcano) and kill by drowning.

Match arc: settle (0 to 5 min), expand and claim shrines (5 to 15 min), war and terrain escalation (15+ min), collapse of a tribe.

## 3a. Progression (Stewart's priority)

The heart of the loop: the Shaper gathers followers, followers make mana, and growth unlocks new options. Progression must be felt within a match and across a campaign:
- In a match: tiers unlocked by population and by worship. Dwellings first; lodges and the Watchtower unlock at follower thresholds (data); stronger spells come from Shrines (one-shot) and Reliquaries (permanent). The HUD shows the next unlock and what it needs.
- Harvesting: settlers chop and haul wood, and quarry stone from rock outcrops for towers and lodges (BACKLOG 0c).
- Across a campaign: each level unlocks spells and buildings carried forward (M9 level data, BACKLOG campaign item).
Tone: traditional tribal villagers and a Shaper in feathers and hides, not a glossy mobile look (ADR-005).

## 4. Win and loss

- Starting state: a Hearth, the Shaper, 5 settlers (each carrying 1 wood of starting supplies, `balance.economy.startWoodPerSettler`), and a few wild people wandering nearby.
- The **Hearth** has 4000 HP and can be destroyed by troops and spells. It never rebuilds in v1.
- A tribe is **eliminated** when its Shaper is dead and either its Hearth is destroyed or it has zero settlers and troops. Its surviving people walk out of every building and become wild, free to be converted by anyone.
- Skirmish victory: last tribe (or alliance) standing. Optional victory variants in data: hold all reliquaries for N minutes, timed survival.
- Shaper death: respawns at Hearth after `respawnSeconds` (start 35, 26 if drowned). The killing tribe gains `killChargeStealPct` (start 25 percent) of her stored charges as mana. Death throttles the economy because the Shaper is the single largest mana producer.

## 5. Mana economy

Per follower per minute (starting values, ratios lifted, scale ours):

| State | Mana/min |
|---|---|
| Shaper alive | 66 |
| Settler housed or working (building, chopping, praying) | 35 |
| Trained troop moving or fighting | 11 |
| Anyone idle | 9 |
| Summoned or spectral units | 0 |

Rules:
- **No bank.** Income flows into active sinks: the spell currently charging and the training queue. Default split 50/50 when both are active; if only one sink is active it gets 100 percent (improvement over the original, which wasted the idle half). The split is a player slider (0 to 100) in the HUD.
- Each spell has a cost and **max stored charges** (4 for cheap, 3, 2, 1 for ultimates). Charging cycles through spells the player has toggled "auto-charge"; the HUD shows ETA per spell and a waste warning when nothing can absorb income.
- Start: 300 mana worth of charges (3 Bolts, or as level data says).
- Training a settler into a troop costs mana from the training sink plus the settler, and cuts that follower's income to about a third. That trade-off is intended.

## 6. Population

- Start 5 settlers + Shaper. Population cap: `popCap = min(200, 5 + sum of dwelling supply)` (data).
- Dwellings: capacity small 3, medium 4, large 5; supply contribution 3/5/7. Dwellings auto-upgrade when full (every bed taken) and wood is delivered (upgrade needs 3 wood delivered, consumes 2).
- Breeding: each dwelling has a progress bar. `breedSeconds = base / (0.5 + 0.5 * occupants) * nearCapFactor`, with base small 200 s, medium 150 s, large 100 s; `nearCapFactor` rises from 1 once population passes 70 percent of popCap. A dwelling with zero occupants does not breed. Tune in data with soak tests (target: an unharassed tribe reaches ~60 population at 10 minutes). Tuned at M4 with `npm run soak -- --mode economy`: base 40 / 80 / 100 s, chop 3 s per wood, build 2.5 s per wood; median 59 at minute 10 across 8 seeds, every tribe growing every minute. Settlers live inside dwellings (hidden, counted as housed for mana); one occupant always stays to breed while others leave for jobs.

## 7. Units

Starting stats. Speed in cells per second (1 cell = 1 heightmap cell).

| Unit | HP | Speed | Role and rules |
|---|---|---|---|
| Shaper | 2500 | 1.5 | Casts. Light melee. Can be shielded. Respawns. |
| Settler | 1000 | 1.6 | Worker. Weak melee. Becomes any troop at a lodge. |
| Warden | 2000 | 1.6 | Melee, kills ~6 settlers alone. Prefers attacking Firecallers. |
| Firecaller | 700 | 1.25 | Ranged area fireball (range 7, min range 2, splash falls off from the center), knockback. +range per height band and in towers. |
| Chanter | 1100 | 1.3 | Chants in a radius of 5 for a 6 s channel, then the nearest enemies convert (up to 3 per channel). Interrupted by ranged damage, melee hits, spells, and terrain change nearby. BACKLOG 7: enemies are no longer frozen while the channel runs (`entrancedFreeze` false), because a frozen front line made Chanters unbeatable by any number of Wardens; Wardens now win by reaching the Chanters inside the channel. Cannot convert Shapers, Chanters, or units inside buildings. |
| Shade | 600 | 1.5 | Disguised: enemies see it in their own color and neither target, convert nor hunt it. An attack order on an enemy building (never a Hearth) or a tree starts a 6 s channel (2 s for a tree) at melee range; damage, a new order or the target leaving reach breaks it. A finished channel sets the building alight (`balance.statuses.buildingFire`: 6 percent of full hp per second for 20 s, so it burns down) or burns the tree at once, and reveals the Shade for 12 s. An enemy Shaper or finished Watchtower within 5 cells reveals it too (BACKLOG 2). Trained at the Shade Den (town tier). |

Stances (M6): aggressive units acquire enemies within `combat.acquireRadius` and chase up to `leashRadius` from where they stood, defensive units only answer threats within a few cells, passive units never start fights. Troops default to aggressive, the Shaper to defensive, settlers and Shades to passive. Explicit attack orders chase any distance; attack-move fights on the way and then resumes. A unit just knocked back is immune to further knockback for `knockbackImmuneSeconds`, so massed fire cannot pin a target forever. Troop damage can kill the Shaper; out of combat she regenerates `shaperRegenPerSecond` after `shaperRegenDelaySeconds`. Conversion ignores the population cap (the cap only gates breeding).

Training: a settler walks to a lodge (queue of `queueMax`, walkers included), pays the unit's `trainMana` from the training sink, trains for `trainSeconds`, and walks out to the lodge's rally point. A new move or stop order cancels the walk; a move order brings trainees and garrisons back out (a trainee that leaves after paying loses that mana).

Counter triangle (must be statistically verified by soak tests): Warden beats Firecaller, Firecaller beats Chanter, Chanter beats Warden. Height matters: units on higher ground deal +X percent ranged damage and Bolt knockback is stronger downhill.

**Water is death:** any unit pushed or walking into water deeper than `drownDepthHeightUnits` drowns instantly (boats, balloons and their riders exempt; a sunk boat drowns its riders). Knockback into water is a core kill tool.

## 8. Buildings

| Building | Wood | Stone | Footprint | Notes |
|---|---|---|---|---|
| Dwelling (small) | 3 | 0 | 2x2 | Upgrades to medium, large |
| Watchtower | 5 | 2 | 1x1 | Garrison 1 to 2, range bonus |
| Warden Lodge / Fire Lodge / Chant House / Shade Den | 8 | 3 | 3x3 | Training queues |
| Boathouse | 5 | 0 | 3x3 | Built beside water; keeps up to 2 boats (one per 45 s), each carries 5 |
| Spirit Well (S3) | 6 | 3 | 2x2 | Adds 105 mana per minute (three housed settlers); town tier |
| Mending Hut (S3) | 5 | 1 | 2x2 | Heals own units within 5 cells by 30 hp/s; village tier |
| Signal Pyre (S3) | 3 | 1 | 1x1 | Sight 18, spots Shades; village tier |
| Skyloft | 11 | 4 | 3x3 | Keeps up to 2 balloons (one per 70 s), each carries 2; only Firecallers fire from vehicles (+2 range) |

Construction: player places a plan; settlers auto-assign, flatten the footprint toward its average height, deliver wood, build. Footprint must be above water and below a max slope after flattening. Plans blocked by trees or units resolve automatically (units step aside, trees get chopped first).

Wood: trees hold up to 4 wood, regrow 1 wood per 68 s, regrow fully from a stump in 330 s. Forests spread slowly onto suitable land (data toggle).

Stone (BACKLOG 0c): rock outcrops hold 16 stone and never regrow; a settler quarries 1 stone per 4 s and carries it to the site. The generator puts 3 outcrops 8 to 14 cells from each Hearth on its landmass, plus a light scatter. A building that costs stone cannot be planned without an outcrop on its landmass, and its construction only runs as far as its delivered stone allows. Emptied outcrops vanish; flooded ones are lost. Live numbers: `data/base/buildings.json` `rocks` and per-building `stone`, `data/base/terrain.json` `rocks`.

## 9. Spells

Composable from effect primitives (see `docs/ARCHITECTURE.md` section 6). Range is measured from the Shaper. Cost in mana; charges = max stored.

| Tier | Spell | Cost | Charges | Range | Effect |
|---|---|---|---|---|---|
| 1 | **Bolt** | 100 | 4 | 6 | Small blast, damage + knockback |
| 1 | **Call** | 100 | 4 | 16 | Converts wild people in a small radius (v1); enemy settlers only via a later upgrade, if ever |
| 2 | **Hornets** | 400 | 4 | 12 | Swarm that panics and scatters units |
| 2 | **Veil** | 500 | 4 | 8 | Invisibility on a group |
| 2 | **Ward** | 600 | 4 | 8 | Shield on up to 6 units for 120 s |
| 2 | **Raise Land** | 650 | 4 | 10 | Ridge of land from Shaper toward target, bridges water |
| 2 | **Lightning** | 800 | 4 | 12 | Single target heavy damage, can kill a Shaper |
| 2 | **Beguile** | 850 | 3 | 8 | Units fight for you for 40 s |
| 2 | **Whirlwind** | 900 | 3 | 8 | Moving vortex, flings units and buildings |
| 2 | **Sanctuary** (S3) | 550 | 3 | 10 | Mending ground: own units inside heal 120 hp/s for 10 s |
| 3 | **Mire** | 1000 | 3 | 8 | Sinkhole bog that kills the first 10 units entering |
| 3 | **Flatten** | 1250 | 3 | 8 | Levels a region |
| 3 | **Quake** | 1750 | 2 | 8 | Cracks and lowers land, damages buildings |
| 3 | **Erode** | 2100 | 2 | 8 | Sinks land toward water |
| 3 | **Deluge** (S3) | 1500 | 2 | 9 | Wave out of the ground: flings units outward and sinks the land a little |
| 4 | **Firerain** | 4000 | 2 | 8 | Meteor storm |
| 4 | **Wraith** | 5100 | 1 | 6 | Summoned flying killer, 200 s or 40 kills |
| 4 | **Volcano** | 8000 | 1 | 6 | Raises a cone, lava, leaves scarred unbuildable land that heals slowly |

**v1 (first 24 h) must ship:** Bolt, Call, Lightning, Raise Land, Flatten, Quake, Hornets, Volcano. Others land through the backlog as pure data where possible.

Spell combo hints (stretch 2): after the player casts a spell, a one-time HUD tip suggests a follow-up that works with it, if that spell is castable (Raise Land then Erode for a moat, Hornets then Mire, Quake then Erode near the shore, Veil then Lightning on the rival Shaper). The list is data (`data/ui.json combos`, outside the pack hash; the data guard checks the spell ids).

First match tips (stretch 2 playtest pass): a skirmish started from the setup screen shows one tip at a time in a panel under the spell bar ("Tip 2/6"): place a Dwelling, cast Bolt, build a lodge or tower, train three troops, attack-move, then how to win. A step is skipped once the player has done it, and the last tip leaves after 45 game seconds and turns the "First match tips" setting off, so only the first match shows them (the setting turns them back on). Campaign levels have their own hints. Texts are data (`data/ui.json tips`), the step checks live in `apps/game/src/tips.ts` and only read sim state.

How to play (stretch 2 playtest pass): a one page guide on the main menu and the pause menu, six short parts (the goal, growing the village, mana and spells, the army, camera and keys, where to start). The text is in `data/strings/en.json` (`howto.*`).

Anti-degenerate rules (fixes from the original's banned-spell meta): every powerful spell has a counter (Ward is popped by Lightning; Mire is visible; Beguile breaks when the caster dies), plus optional per-spell cooldowns in data.

Spell UX: hover shows exact area preview on the curved terrain, range ring around the Shaper, red if out of range; right click or Esc cancels; a 1 s "undo" on misclick refunds the charge if the cast has not resolved. As built (M5): spell bar click or hotkeys Z X C V B N, Shift+M and Shift+N, then a second row Shift+Z X C V B J K L for the eight later spells (BACKLOG 1 and 53; the bar wraps to two rows; M stays the map view; one table, SPELL_KEYS in packages/ui) enter targeting; left click casts (out of range the Shaper walks there first, or, when the target lies over water or on land she cannot reach, to the nearest point of her own landmass within range, BACKLOG 62; with no such point the cast fails at once; if she stops without getting closer the queued cast is dropped with `castFailed` and no charge is spent); Backspace undoes within the cast window; right click on a spell button toggles auto-charge.

## 10. Worship objects

- **Shrine:** needs N worshippers (1 to 8). Each missing worshipper halves prayer speed. Default prayer 37.5 s at full count. Grants one-shot spell charges or one building, then sinks.
- **Prayer chains (stretch 3):** a level site can start dormant (sunk, refuses worship) and wake when another site's `awaken` reward names it; a `reveal` reward lifts the fog over a disc. Praying at one place opens the way to the next.
- **Level scripting primitives (stretch 3):** staged objectives (`after`), `destroy`, `reach` (a pulsing beacon) and `build` objectives; `area` and `followers` triggers; `spawn` with a `stance` (a `defensive` unit is a posted guard the AI never drafts); `raid` with an optional cap `n` (posted guards stay); `spell` with a `from` point (scripted land bridges). The AI sends troops to clear a site held by enemy guardians before it sends worshippers. A living wolf den within 16 cells of a site also counts as a guardian (dens are known landmarks, so fog does not hide them), and the troops attack-move on the den. A `hunt` action sends 3 or more idle troops against the nearest living den within 30 cells of the Hearth; it is only scored while a living den exists, so worlds without dens draw the same AI noise as before.
- **Campaign level 14, The Waking Stones:** a three-site prayer chain across islands; wardens guard the last Reliquary, and at minute 6 the hard eastern rival raises its bridges, raids and sends priests to pray the player's stones away. Stages: wake the shore stone (Shaper only), clear the wolf dens, pray at the middle shrine, take the Reliquary, take the eastern ley and hold three ley stones for three minutes against the priests, then break the tribe while its counter war band and a dug-in warden ring answer the hold.
- **Reliquary:** same mechanic, grants a permanent spell or building unlock (campaign progression and skirmish objective).
- **Totem:** level-scripted trigger (raise a land bridge, spawn wild people, reveal map).

### Living world (Stretch 3)

The land and the shrines keep moving after the match starts.

- **Capturable stones:** three kinds of stone stand on dry land and work for whoever holds them. A **ley stone** needs 3 worshippers for 20 s and pays its holder 150 mana per minute. A **ward stone** needs 3 worshippers for 24 s and strikes the nearest enemy unit within 8 cells for 220 every 3 s. A **seer stone** needs 2 worshippers for 15 s and lets its holder see within 18 cells. A held ward or seer stone draws a dashed ring on the ground at its reach, in its holder's color.
- **Holding:** whoever prayed last holds a stone. A rival can pray it away; the holder cannot pray at it again. Stones are never used up, and the victory variants do not count them.
- **Shaping:** shape rewards (a disc, rect or line) raise causeways or sink fords gradually over their seconds, not at once. A unit on land that goes under drowns. Repeating time triggers (`every`) allow tides.
- **Skirmish option "Ley stones":** none, 3, 6 or 12 (default 6). Stones go on dry land, at least 20 cells from every Hearth and 18 cells from each other, at most one per 1,800 cells of map. Placement is spread evenly over the map and is the same for the same seed.
- **Map sizes:** skirmish now offers 96, 128, 192 and 256.
- **Wolves:** wolf dens hold packs of three. A wolf (750 hp, faster than people) bites any tribe's unit that comes within 6 cells while it stays within 11 cells of its den, then walks home. A den with a living wolf regrows a lost one every 75 s; kill the whole pack and the den is cleared for good. Warriors of every kind but Chanters fight wolves on sight. Skirmish option "Wolves": none, 2, 4 or 8 dens (default 4), at least 26 cells from every Hearth (a fifth of the map width on maps smaller than 130). Levels place dens in their setup.
- **Level objectives:** `hold` (hold n capturable stones, optionally of one kind, at once for a continuous span; losing one restarts the count) and `clearDens` (clear n wolf dens, every den when n is absent, or only the dens in an `at` and `r` area). A `survive` stage with `fromStage` counts from when its stage opens. S4: `fromStage` also works on `worship` (the player must complete the site after the stage opens; holding it before does not count), `destroy` and `eliminateAll` (never met on the opening tick, so a trigger on the earlier stage can place the targets first), `clearDens` (only dens cleared after the opening count) and `victory` (the level's rules clocks, site holds and the Last Stand timer, start when the stage opens). A `hold` is stage relative already: its streak starts once the stage is open. A level tribe's `maxPopulation` caps its population, so late rivals neither snowball nor collapse. A `raid` reward with `pray` sends the war band to pray at a stone (contesting the holder) instead of attack-moving. The opponent AI may still pray at a site far from a threat on its village (`shared.worshipUnderThreat`), and the bot playing tribe 0 in a level leaves a stone it lost twice to the enemy alone for three minutes (`stoneGiveUpLosses`, `stoneGiveUpMinutes`). Stones may start held by a rival (setup `tribe`), and `beastPrey: "player"` makes a level's wolves hunt only the player.

## 11. Terrain

- Heightmap on a **torus** (wraps both axes), default 128 x 128 cells (data: 64 to 512). Height in integer units 0 to 1023 with 32 height units per world unit (one cell is one world unit across); sea level 120; the generator produces land between about 60 and 520. Rendered with a curved horizon so the world reads as a small planet.
- **Skirmish maps are connected:** the generator flood-fills walkable land and rerolls the seed until every Hearth site shares one landmass (there are no boats in v1). Island maps exist only as handmade levels that hand out Raise Land.
- All terrain edits are sim operations on integer heights with dirty-region tracking: raise, lower, set, flatten-to-average, smooth, crater, ridge-line, noise-scar. Spells, flattening for buildings, and erosion all use the same ops.
- Rules: max walk slope, max build slope, water impassable (drowns), "scarred land" flag (unbuildable, heals over time), tree growth by height band.
- Height bands drive visuals and rules: shore, lowland, grass, highland, rock, peak.
- A flat top-down **map view** toggle for precise planning, and a minimap with curvature-aware markers.

## 12. Camera and controls

- Camera orbits a focus point on the surface: rotate 360 (Q/E or middle drag), zoom from close-up to globe view (wheel), pan with arrow keys, screen edge, or Ctrl + middle drag, double-tap a group key to jump. Four bookmark slots (F1 to F4). Map view toggle (M). Photo mode (F, rebindable; parking lot, stretch 2): hides the HUD, selection rings and rally markers and pauses the match; the camera keeps orbiting (left or middle drag, Q/E), panning, zooming, map view and bookmarks; Enter saves the frame as a PNG download (`hearthfall-<time>-t<tick>.png`); F or Escape returns and the match resumes as it was.
- Selection: click, box select that works on the curved surface, double-click selects all of that type on screen, control groups 1 to 9, tab cycles unit types in selection. As built (BACKLOG 4): double-click selects own units of the clicked type within 14 cells; Ctrl+digit stores a group, the digit selects it and a second press within 0.4 s centers the camera on it (wrap-aware center).
- Orders: right click move/attack/garrison/worship, attack-move (A), stances (aggressive, defensive, hold), formations for groups, rally points on lodges, queued orders (Shift), "retreat to nearest tower" (R). As built (BACKLOG 4): moves and attack-moves of 2 or more units march in a box formation (Wardens in front, ranged and Chanters behind, the Shaper at the back). The spell target preview line counts the enemies the tribe can see and its own units inside the area, and while a cast is still in its window the HUD counts down the Backspace undo. The undo window stays at `chargeRules.undoSeconds` 1 s, which already equals the whole `castSeconds` window, so no retune was needed.
- Shaper: hotkey S selects and centers her. Spells on Z X C V B N, Shift+M, Shift+N, then Shift+Z X C V B J K L (in spell bar order) or click the HUD. No Alt chords (a lone Alt press steals focus in Chrome on Windows).
- Settlers are mostly autonomous with a tribe-wide priority panel (build / chop / breed / pray), so the player manages intent, not individuals. As built (M4): toggles Build, Upgrade, Breed in the resource panel; chopping happens on demand for sites and upgrades; D places a dwelling plan (Z X C V B N M stay reserved for spells).

## 13. AI opponents

- Utility-based AI driven by **personality data**: aggressive (Crimson: early Warden rushes, Bolt harassment), sneaky (Amber: Chanters, Shades, Veil, skirmish raids), turtle (Jade: towers, Mire, Quake from range).
- Same command API as the player. Spell preferences are filtered to spells the AI actually has unlocked. No hidden cheats by default; difficulty scales decision quality, reaction time and optional resource multipliers declared in data.
- Plays under the same fog of war as the player (section 13a); only a difficulty with `mapHack` in data sees through it (brutal).
- Difficulty levels (BACKLOG 6, `ai_personalities.json` difficulties): easy reacts every 8 s with decision noise 0.35 and 0.7x mana income; normal 3 s, noise 0.15; hard 1.5 s, noise 0.05; brutal 1 s, no noise, 1.25x income and map hack. Against a normal opponent of the same personality (`npm run soak -- --mode difficulty`, 8 seeds per level, 20 min) easy scores about 0.13, hard and brutal about 0.88. The income multiplier is applied through the sim (`handicap` command), never in hidden AI code, so it shows in the HUD income and in replays.
- S4: once no worship site is left at home, an AI that already has a boat, a balloon or a Skyloft carries worshippers to a free site on another island (never one guarded or within 30 cells of an enemy Hearth), and a wave with no boat route crosses by balloon, two riders at a time, raising a Skyloft if it may. The level bot playing tribe 0 does the same.
- Must scout, contest shrines and reliquaries, adapt army composition to what it sees, and react to Shaper threats. Show AI intent subtly in-world (gathering banners before an attack) so losses feel fair.

## 13a. Fog of war (BACKLOG 3)

Each tribe sees around its own units (7 cells; the Shaper 10, Shades 8) and buildings (6; Hearth 9, Watchtower 12). Ground never seen is dark; ground seen before is dimmed and keeps the buildings that stood there when it was last in view; only ground in sight shows units and live effects. The minimap shares the same three states. A tribe that loses its Hearth is revealed to everyone, so the end of a match is never a hunt for one hidden Shaper. Spells may be cast into the fog (commands do not check sight). Watchtowers double as the long-sight scouting building. Numbers live in `balance.vision`; a map spec may turn fog off.

## 14. Modes

1. **Skirmish** (primary for v1): 1 player vs 1 to 3 AI tribes on a seeded procedural planet or a handmade map.
2. **Campaign** (data-driven levels): each level is a data file with map, tribes, objectives, triggers, unlocks. v1 shipped 3 levels; Stretch 2 has 13, each teaching one system: Raise Land, shrine races, defense, Reliquaries, totems and unlocks, growth, fog scouting, boats (8), balloons (9), Hold the Reliquaries (10), King of the Hill (11), the Forge (12) and a three-island finale (13). A level can name victory rules (its objective is then to win them) and open with a Forge.
3. **Sandbox/God mode** (dev and fun): free spells, spawn units, edit terrain. Also used by tests.
4. **Forge** (skirmish option, BACKLOG 11): a 2 minute pre-match phase. Units stand still; each tribe reshapes the land within 14 cells of its own Hearth for free (raise, lower, flatten, smooth; up to 120 strokes), then the match starts when every tribe is ready or time runs out. The AI digs a moat (turtle), raises walls (sneaky) or flattens building room (aggressive), always leaving gaps.
5. **Tribe traits** (skirmish option, stretch 2): the player picks one small passive bonus from `balance.traits` (Devout 10 percent more mana, Swift units 8 percent faster, Fertile dwellings 12 percent faster births, Stalwart units take 8 percent less damage); with a trait picked, each AI tribe carries its personality's trait (aggressive Swift, sneaky Devout, turtle Stalwart; economy bots none). Off by default, so plain skirmishes are unchanged.
6. **Play together** (Leg 5, LAN versus): two computers on one home network. One player runs `npm run serve -- --lan` and both open the printed address. Main menu, Play together: the host presses Host and reads out the four letter room code; the partner types it and presses Join. The host's Skirmish setup decides the match (map, seed, size, rivals, rules, options): the host plays the first tribe, the partner the second, and the setup's AI rivals fill the other seats. The host picks "Play against each other", "Play together against the AI", or "Play the campaign together" (the host's next campaign level, both players commanding the same tribe and its Shaper; a won level counts on both computers) (both players on one team, every AI rival of the setup on the other; allies share sight and win or lose together). A LAN match never pauses (the menus open over it) and saving and loading are off. If the partner's connection drops, their page rejoins by itself and picks the match up from the host's game; the host sees a banner and waits up to 30 seconds (or presses "Let the AI play their tribe"). If a partner quits, or does not come back, the AI takes over their tribe and the match goes on for the one still playing. While a partner's game lags, the match waits for it and a banner says so. If the two games ever disagree (a desync), the end screen offers a report file to send to the developer.

## 15. Art direction

Stylized low-poly, flat or soft-faceted shading, vertex colors from one shared palette (`data/base/style.json`), warm golden-hour key light, soft fog toward the horizon, saturated tribe colors on clothing and banners only so units read instantly. Terrain: banded colors (sand, meadow, moss, rock, snow) with subtle noise. Water: stylized, animated, with shoreline foam. Spells must be loud and readable (big silhouettes, color-coded by tier). Units are tiny on screen: silhouette and tribe color matter more than detail.

Before any external asset arrives, everything renders with **procedural placeholder meshes** generated in code from the same palette, so the game is always playable and testable.

## 16. Audio

Short positional SFX for every action, spell cast and impact; tribal percussion music layers that intensify with combat; voice barks for the Shaper (wordless or invented-language chants, never real-language catchphrases from the original). Generated via ElevenLabs (see `docs/ASSETS.md`).

## 17. UI

DOM overlay HUD (layout v2, ADR-005 addendum 2: Shaper portrait with mana and followers bars top-left, spell row top-center, build tools in a right column, minimap with population bottom-right, stone-framed panels): spell bar with charge rings and ETA, mana income breakdown and split slider, population and supply, selected unit panel, minimap, objectives, notifications (Shaper under attack, shrine claimed). Must stay readable at 1280x720 and scale to 4K. No overlaps (automated check).

Accessibility (BACKLOG 8), all in Settings and stored with the other settings:
- Tribe colors: `default` or `colorblind` (`style.json` tribePalettes; azure #1D3FE8, crimson #E95D0B, amber #853488, jade #76E7BF). The colorblind set was picked by simulating protan, deutan and tritan vision (Machado 2009) and maximizing the smallest Lab distance between any two tribes: at least 40 for every vision type, against about 22 for the default set. It recolors units, rings, buildings and the minimap.
- UI scale: 80 to 150 percent for the HUD and menus. On a window too small for the chosen scale the HUD steps down in 5 percent steps until no panel overlaps (125 percent needs about 1920x1080; 1280x720 fits about 105).
- Subtitles (on by default): every Shaper bark shows its line with a translation for 4 s, centered 30 percent down the screen (clear of the spell bar and the troop panel) (`style.json` subtitles).
- Remappable keys: since M8 (Settings, Controls).

## 18. Out of scope for v1

Online multiplayer, full campaign, mod browser, achievements, localization. All are in `docs/BACKLOG.md`.

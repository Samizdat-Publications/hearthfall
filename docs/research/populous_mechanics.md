# Populous: The Beginning (Bullfrog, 1998): Mechanics Research

Purpose: give a team enough concrete, quantitative detail on the systems of *Populous: The Beginning* (PTB) to build an ORIGINAL shaman-led tribal god/RTS hybrid inspired by them. Not a clone: do not reuse its names, art, audio, tribe names, or spell/building names verbatim (see section 13).

Confidence tags used below: [H] multiple sources or data-file derived, [M] single fan source, [L] inferred or conflicting.

## 0. Units and conventions used in this document

- **Game turn**: the simulation ticks at 12 turns per second. Timers in data files are in turns (e.g. 450 turns = 37.5 s). [H]
- **Mana units ("OPG units")**: the cheapest spell (Blast) costs 100 units. Some fan pages list the same costs x100 (Blast = 10,000) and call 1 Blast = "one blast" of mana. I use OPG units and also give the cost in "blasts" (cost / 100). The follower mana rates in section 2 are in the same OPG units per minute; I verified this by recomputing two published charge-time tests (see section 2). [H]
- **Land cell**: the world is a 128 x 128 grid of height samples. [H] Spell ranges below use the wiki's range units (internal value / 512); treat them as roughly cells, so an 8-range spell covers about 1/16 of the map width. [L]
- Fan-community "mana" numbers are sometimes quoted at different scales; always use ratios, not absolutes, when porting.

---

## 1. Core loop and win/lose conditions

### 1.1 Moment-to-moment loop
1. The player controls one **Shaman** (a unit on the map who is the ONLY spellcaster) plus a tribe of automatically behaving followers.
2. Build a settlement around the **Reincarnation Site** (a ring of 8 monoliths): huts, then training huts, towers, vehicles. Only wood is needed to build; only mana is needed to train troops or charge spells.
3. Huts breed **Braves** for free over time. Followers generate **mana** continuously. Mana flows into **spell charging** and **troop training** (split 50/50).
4. Send followers (or the Shaman) to **worship** map objects (Stone Heads, Totems, Obelisks, Vaults) to gain spells, buildings, mana, or map effects.
5. Attack: Shaman casts spells at range while a troop force (Warriors, Firewarriors, Preachers, Spies, boats, balloons) breaks defenses. Goal is to wipe out each enemy tribe (all followers and the Shaman) or complete a scripted alternate objective.
6. Defend: towers with Firewarriors, Shaman camping in a tower, terrain denial (Landbridge/Erode/Flatten), Swamp blocking.

### 1.2 Win / lose [H]
- **Win** (most levels): eliminate every enemy tribe. Some levels have a different objective (worship a particular object before a timer, free an imprisoned Shaman, survive with no followers, etc.).
- **Lose**: (a) your Shaman dies and you have no followers left; (b) your Shaman dies and no Reincarnation Site exists; (c) a timed level runs out.
- **Shaman death is not game over** if you still have at least one follower and a Reincarnation Site: she reincarnates at the site after roughly **38 s** (about **28 s** if she drowned, because the body vanishes at once). Fan guides quote 35 to 38.75 s; community data says drowning 28 s, other deaths 38.75 s. [M]
- While dead you cannot cast. On death, about **25% of the Shaman's accumulated charge is transferred to the tribe that killed her** (constant names SHAMEN_DEAD_MANA_%_LOST / _GAIN). [M]
- Reincarnation burst: expands a ring that burns wood in range, scares enemy followers like Swarm, flattens land to the Shaman's height (and creates land if underwater), and converts any wildmen standing inside the ring. [H]
- The Reincarnation Site cannot be spell-targeted by the enemy; it is only removed when its tribe is fully eliminated. The ground around it always re-forms as land even if everything else is sunk. [H]
- Enemy-tribe elimination also converts that tribe's still-hypnotised followers to you permanently. [M]

### 1.3 Campaign structure [H]
- 25 single-player levels, each on a different unnamed planet in a solar system. Player (Blue tribe, female Shaman) starts on the farthest planet and works inward. Level 24 is the last "real" fight; level 25 is a bonus "you are now a god" finale.
- Opponents: three AI tribes (Red "Dakini", Yellow "Chumara", Green "Matak"), identical in ability, differing only in colour, base look, and AI personality (section 9). Early levels have 1 enemy; from level 6 onward there can be 2 or 3 enemy tribes on one map, with a few levels containing AI-vs-AI alliances.
- Difficulty labels in the level data run Beginner (1-4), Easy (5-6), Medium (7-11, 13), Intermediate (12, 14, 22), Hard (15, 17, 19, 21, 23), Very Hard (16, 20, 24, 25), Diabolical (18).
- Levels 16 to 19 are the "guest spell" levels and can be played in any order; Level 21 (Volcano) unlocks after 18 and 19. [M]
- Expansion *Undiscovered Worlds* (1999): 12 more single-player and 12 more multiplayer levels, with twists like receding landscapes and removed powers. [H]
- Mission structure is hand-scripted puzzle-ish maps, not procedurally generated. Levels 1 to 4 teach one new thing at a time; later levels remix.

### 1.4 Level progression: what each level unlocks (permanent items come from Vaults of Knowledge)

| # | Level | Tribes incl. player | Difficulty | Permanent unlock (Vault) | Notable temporary rewards / twist |
|---|---|---|---|---|---|
| 1 | The Journey Begins | 2 | Beginner | Warrior Training Hut | Stone Heads: Landbridge (infinite), Lightning x4. Blast known from start. Tiny 3-island map |
| 2 | Night Falls | 2 | Beginner | Swarm | Stone Head Tornado x3; Totem opens a land path |
| 3 | Crisis of Faith | 2 | Beginner | Temple (Preachers) | Totem casts Erode to open a path |
| 4 | Combined Forces | 2 | Beginner | Guard Tower, Lightning | Stone Head Convert x4; first level where enemy attacks with army + Shaman |
| 5 | Death From Above | 2 | Easy | none | First TIMED level. Gargoyle gives 5 Angels of Death; if the timer ends the enemy Shaman gets it and you lose |
| 6 | Building Bridges | 3 | Easy | Convert, Landbridge | Stone Heads: Swamp x3, Hypnotise x3, Firestorm x1. First multi-enemy level |
| 7 | Unseen Enemy | 2 | Medium | Invisibility | Stone Head Erode x2 |
| 8 | Continental Divide | 2 | Medium | Firewarrior Training Hut | Stone Heads Magical Shield x3, Tornado x4 |
| 9 | Fire In The Mist | 2 | Medium | Boat Hut | Stone Heads Tornado x2, Earthquake x1, Volcano x1 |
| 10 | From The Depths | 2 | Medium | none | Timed. Totem raises sunken land (Atlantis effect) |
| 11 | Treacherous Souls | 3 | Medium | Hypnotise, Swamp | Stone Heads Swamp x3, Flatten x3 |
| 12 | An Easy Target | 4 | Intermediate | Spy Training Hut, Tornado, Erode | AI tribes also fight each other |
| 13 | Aerial Bombardment | 3 | Medium | Earthquake, Balloon Hut | Stone Heads Shield x3, Volcano x1, Firestorm x1 |
| 14 | Attacked From All Sides | 4 | Intermediate | Firestorm, Magical Shield, Flatten | AI tribes allied against you; Stone Head Angel of Death x1 |
| 15 | Incarcerated | 2 | Hard | none | Your Shaman starts imprisoned (cannot be selected); 7:30 timer; Obelisk gives Volcano x1 |
| 16 | Bloodlust | 4 | Very Hard | none (guest spell Bloodlust) | Stone Heads: Bloodlust, Angel of Death x1 |
| 17 | Middle Ground | 4 | Hard | none (guest spell Armageddon) | Single Armageddon Stone Head everyone fights over |
| 18 | Head Hunter | 4 | Diabolical | none (Armageddon) | Stone Heads Armageddon, Volcano x2 |
| 19 | Unlikely Allies | 3 | Hard | none (guest spell Teleport) | You and Yellow are allied vs Red; Stone Heads Teleport x3, Volcano, Firestorm |
| 20 | Archipelago | 2 | Very Hard | Angel of Death | Boat-heavy; Stone Heads Landbridge, Flatten, Firestorm, Volcano |
| 21 | Fractured Earth | 2 | Hard | Volcano | Cracks in the land erupt into volcanoes unless you fill them with terrain spells |
| 22 | Solo | 4 | Intermediate | none | You start with only a Shaman: no followers, no Reincarnation Site, no Convert. Obelisks give full spell charges and mana boosts; you must Hypnotise people to get a tribe |
| 23 | Inferno | 4 | Hard | none | Stone Head Firestorm x3 |
| 24 | Journey's End | 4 | Very Hard | none | Everything unlocked; all three AI tribes pre-built; you start with only three large huts and must build all training huts |
| 25 | The Beginning | 4 | Very Hard | none | "God mode": unlimited spell range, no Reincarnation Site, 50 followers in large huts, enemies attack early |

Design takeaways: (1) One new capability per early level, taught with a safe sandbox; (2) permanent unlocks gated behind guarded vaults that sit inside enemy bases, so progression is spatial and combat-gated; (3) levels reuse systems with twists (timer, prison, no base, no followers, rising land, erupting cracks, god mode) which keeps 25 levels from feeling identical, though critics still found them repetitive.

---

## 2. Mana economy

### 2.1 Generation (OPG units per minute, per follower) [H, measured and data-file derived]

| Follower state | Mana / min | Ratio vs working brave |
|---|---|---|
| Shaman (alive) | 66.6 | 1.92 |
| Brave inside a hut or working (building, chopping, carrying) | 34.6 | 1.00 |
| Warrior / Firewarrior / Preacher / Spy, moving or active | 11.3 | 0.33 |
| Any follower, idle | 9.1 | 0.26 |
| Angel of Death, ghosts (Ghost Army) | 0 | 0 |

Notes:
- A brave inside a hut produces the same as a working brave, regardless of hut size (small/medium/large) per published tests. Idle braves only yield about a quarter. So "keep braves housed or busy" is the optimization. [M]
- No separate bonus for praying at a shrine or totem is documented: the only modifiers are role (brave vs trained), state (housed/working vs moving vs idle), and the Shaman being alive. Worshippers presumably count as active. [L]
- Training a brave into a troop cuts its mana to about one third (three to four troops equal one working brave). This is the core tension: army vs economy.
- Neutral wildmen belong to no tribe, so presumably contribute nothing until converted. [L] Converting an enemy follower (Preacher) or a contested wildman is a two-sided swing: they lose one, you gain one.
- Starting mana: enough for about 1.5 Blasts plus 1.5 Converts (300 units). If Convert is disabled you start with 3 Blasts' worth; if both disabled, nothing.
- Example from the wiki: Shaman + 7 working braves + 2 Warriors + 2 Preachers = 66.6 + 7x34.6 + 2x11.3 + 2x11.3 = **354 mana/min**.
- Tribe size drives everything: income is roughly linear in population, so more huts, more braves, more mana, faster spells.

Validation of units: with 35 braves and the Shaman all working, charging 3 Blasts (300 units) takes about 300 / ((66.6 + 35x34.6)/60) = 14 s; published test says 15 s. With the same 35 braves all idle: about 47 s computed, 47 s published. [H]

### 2.2 Allocation: no global bank [H]
- Incoming mana is split **50/50 between spell charging and troop training**. If only one sink is active it gets 100%. If neither is active the mana is WASTED (the mana bar flashes red).
- The spell half is divided equally among all spells currently charging; the training half is divided equally among training huts that are actively training.
- There is no stockpile. Spells hold their own charges (see 2.3); mana does not accumulate between uses. Player control is "which spells are toggled to charge right now" (right-click a spell icon to toggle; Ctrl+right-click isolates one; Shift+right-click toggles all).
- Typical micro: turn off all charging except the one you need, so it charges several times faster; stop training to double spell speed, or stop spells to double training speed.
- A training hut can only absorb mana up to a maximum rate (about one trained follower per 7 to 10 s per hut, up to about 18 warriors per minute with three or more huts at high population). Extra mana beyond that is wasted, so building more training huts raises throughput once saturated. [M]
- Training mana cost per troop type is separate for human and AI (HUMAN_TRAIN_MANA_* vs CP_TRAIN_MANA_*), and constant names (TRAIN_MANA_BAND_00_03 through 21+) suggest cost scales with how many trained followers you already have. Numeric values not published. [L]
- Constants also exist for a global maximum mana and human vs computer mana multipliers (HUMAN_MANA_ADJUST / COMPUTER_MANA_ADJUST): the AI difficulty lever. Values not published. [M]

### 2.3 Spell charge and stacking rules [H]
- Each spell holds up to N "shots" (max charges) and charges one shot at a time. N scales inversely with cost:
  - 4 charges: Blast, Convert, Swarm, Invisibility, Magical Shield, Landbridge, Lightning, Ghost Army, plus guest Bloodlust and Teleport
  - 3 charges: Hypnotise, Tornado, Swamp, Flatten
  - 2 charges: Earthquake, Erode, Firestorm
  - 1 charge: Angel of Death, Volcano, Armageddon
- Spell slots are limited: **max 17 spell types in single player, 18 in multiplayer**. There is one "guest spell" slot (Bloodlust, Armageddon, or Teleport) that holds only one type at a time and normally can only be filled from worship objects. [H]
- Spells earned from Stone Heads/Obelisks are TEMPORARY (consumed shots, no recharge). Spells earned from Vaults are PERMANENT and can be recharged with mana. [H]
- The Shaman is the only caster. Casting needs the target within the spell's range circle (shown around her); she must stand in range. A tower or balloon extends her range. In-game option "autocast" makes her walk into range. After casting she is locked in an animation of about 0.9 s (vulnerable to lightning), which skilled players cancel by issuing a move order. [M]

### 2.4 Approximate charge times (computed, single spell charging, no training, Shaman alive, all braves working)

Rate per second R = (66.6 + 34.6 x N_braves) / 60.

| Spell (cost) | 25 braves | 50 braves | 100 braves | 150 braves |
|---|---|---|---|---|
| Blast / Convert (100) | 6 s | 3 s | 2 s | 1 s |
| Swarm (400) | 26 s | 13 s | 7 s | 5 s |
| Lightning (800) | 52 s | 27 s | 14 s | 9 s |
| Tornado (900) | 58 s | 30 s | 15 s | 10 s |
| Earthquake (1750) | 113 s | 58 s | 30 s | 20 s |
| Firestorm (4000) | 258 s | 134 s | 68 s | 46 s |
| Angel of Death (5100) | 329 s | 170 s | 87 s | 58 s |
| Volcano (8000) | 515 s | 267 s | 136 s | 91 s |

If training is also active, charge time doubles. A published 140-brave Lightning test measured about 10 s versus a computed 9.8 s. [H]

Design takeaways: income per capita is high and power is gated by population; the 50/50 split with waste-if-unused makes you always want something charging; low max charges on expensive spells plus a 1-use cap on mega spells makes them rare events rather than spam; shaman is worth ~2 braves of income so killing her also throttles economy.

---

## 3. Spell list

Costs in OPG units (blasts = cost / 100). "Terrain" marks spells that deform heightmap/surface. Range in cells (map is 128 wide). Unlock = level of the permanent Vault; earlier levels may offer one-shot Stone Head versions.

### 3.1 Standard spells in unlock order [cost / range / durations from data tables, H unless noted]

| # | Spell | Cost (blasts) | Max charges | Range | Duration / limit | Permanent unlock | Terrain? | Effect |
|---|---|---|---|---|---|---|---|---|
| 1 | Blast | 100 (1) | 4 | 6 | instant | start | no | Homing fireball that knocks a target back and usually kills braves, preachers, spies, firewarriors in one hit but not Warriors or Shamans. Used to push units into water, off cliffs, to cancel fall damage or lava, to speed allied units, and (5 blasts) to remove one wood piece from a hut. Damage higher on targets on lower ground |
| 2 | Convert | 100 (1) | 4 | 16 | about 3 s | L6 | no | Turns wildmen into your Braves (not enemy followers). Longest-range spell |
| 3 | Swarm | 400 (4) | 4 | 12 | 15 s | L2 | no | Enemy followers scatter and run screaming; cast beside a hut or tower (not on it) to eject occupants; disrupts Preachers and boat/balloon crews. Light damage |
| 4 | Invisibility | 500 (5) | 4 | 8 | 2 min | L7 | no | Your followers (not Shaman) become invisible until they attack; Preachers and Angels of Death can still see them; footprints show |
| 5 | Magical Shield | 600 (6) | 4 | 8 | 2 min | L14 | no | Up to 6 units become immune to directly cast spells (except Hypnotise) and to Firewarrior fire; direct spells rebound to a random spot about 8 cells away. Swamp and indirect Swarm/Earthquake still work. Banned in most multiplayer |
| 6 | Landbridge | 600 to 700 (6-7) | 4 | 10 | land stays; about 5 s to raise | L6 | YES | Raises ground between the Shaman and target to connect islands, make ramps, create land from sea, or build high platforms. Quirk: repeated casts can build tall hills |
| 7 | Lightning | 800 (8) | 4 | 12 | instant, delayed by distance | L4 | no | Kills a follower (or sets a building on fire); precise, with splash. Does not hurt the caster. Main Shaman-killer. Dodge by changing direction |
| 8 | Hypnotise | 850 (8.5) | 3 | 8 | 40 s | L11 | no | All enemy followers in the area fight for you for 40 s; permanent if you train them into a new type or the enemy tribe dies |
| 9 | Tornado | 900 (9) | 3 | 8 | about 7 to 17 s | L12 | minor (flattens building site) | Wanders, destroying huts outright and flinging followers (often into water). Wood from destroyed buildings is scattered, not lost |
| 10 | Swamp | 1000 (10) | 3 | 8 | until it kills 10 followers | L11 | surface hazard | Instantly kills the first 10 units (including Shamans) that enter, then vanishes. Used to block paths and Stone Heads. Shift+right-click removes your own |
| 11 | Flatten | 1250 (12.5) | 3 | 8 | instant | L14 | YES | Levels an area to one height: makes land from sea, destroys cliffs, levels bases, can drop or lift the Shaman |
| 12 | Earthquake | 1750 (17.5) | 2 | 8 | about 5 to 10 s | L13 | YES | Cracks the ground, spills lava, sinks or breaks huts. Random outcome; on low land can sink to water; on high land lowers terrain. Lava kills units but not your Shaman; can drown her |
| 13 | Erode | 2100 (21) | 2 | 8 | about 5 s | L12 | YES | Fast-forwards erosion: lowers and roughens ground, collapses huts, sinks coasts. Expensive and easy to counter with Landbridge |
| 14 | Firestorm | 4000 (40) | 2 | 8 | 18 s | L14 | scorches land | Rain of fireballs: kills most followers outside towers, destroys up to about 4 huts; spares your own units; mostly ineffective on towers; blocked by Magical Shield |
| 15 | Angel of Death | 5100 (51) | 1 | 6 | until killed, 2,500 turns (about 208 s), or 40 kills | L20 | no | Giant flying creature (10,000 HP) that hunts and eats followers and the Shaman, damaging buildings it snatches from. Counters: Ghost Army decoys, massed Firewarriors, Firestorm, 4 direct Lightning hits, or your own Angel |
| 16 | Volcano | 8000 (80) | 1 | 6 | 13 s | L21 | YES (large) | Erupts a cone and lava flows that wreck a base and leave unbuildable "damaged" land; lava meeting water makes new land. Lava flows farther from a hill |

### 3.2 Special and guest spells
| Spell | Cost | Charges | Notes |
|---|---|---|---|
| Ghost Army | 180 (1.8) | 4 | Mostly multiplayer (not in the campaign). Casting on a brave or empty ground makes 6 ghost braves; on a trained unit makes 3 ghosts of that type; on the Shaman makes 1 ghost Shaman. Ghosts cannot build or enter regular huts, die to a hit, produce no mana, but can be trained, absorb tower fire and distract Angels |
| Bloodlust (guest) | 10,000 (100) | 4 | Followers become very strong, fast fighters for 2 min and are immune to Preachers |
| Armageddon (guest) | 10,000 (100) | 1 | Ends the level: arena is carved, all Shamans (shielded, casting Blast at each other) and up to 199 followers per tribe teleport in one by one; winning tribe's Shaman lightnings the others. Each completed hut adds one extra Brave, so players dismantle huts first |
| Teleport (guest) | 10,000 (100) | 4 | Shaman lands anywhere on the map at lightning-bolt delay; can land in empty boats/balloons; shockwave lowers nearby high ground |
| Forge World spells (multiplayer only, 5 free shots each, alt-click raises/lowers land for free) | n/a | 5 | Hill, Valley, Raise, Lower, Trees, Wildmen, plus Flatten, Landbridge, Erode. A 2-minute pre-match terraforming phase around your Reincarnation Site |

### 3.3 Terrain-modifying spells
Landbridge, Flatten, Erode, Earthquake, Volcano (strongest), Tornado (minor, when destroying a building), Teleport (shockwave lowers high ground), Armageddon (flattens an arena), Swamp (surface hazard only), Firestorm/Volcano/Earthquake lava (creates "damaged" land). Also level-script effects: Atlantis land rise, lava flows, erupting fissures.

### 3.4 Offensive strength order (community ranking)
Blast, Swarm, Lightning, Hypnotise, Tornado, Flatten, Swamp, Erode, Earthquake, Firestorm, Angel of Death, Volcano.

### 3.5 Cut content worth knowing
"Plague" (from earlier Populous games) was removed because it was too frustrating. A "Burn" spell (burn trees only) existed in alphas. Both survive only as constant names.

---

## 4. Units and followers

All four tribes use the same seven follower types; only colour differs. [H]

### 4.1 Stats (Populous constants file as published by the community) [M]

| Unit | Health | Walk speed | Mana state (see 2.1) | How obtained |
|---|---|---|---|---|
| Wildman | very low | n/a | 0 | Neutral; converted to Brave by Convert, or when a Reincarnation ring forms over them |
| Brave | 1,000 | 70 (fastest) | 34.6 working / 9.1 idle | Bred in huts for free; also via Convert |
| Warrior | 1,800 (tankiest) | 59 | 11.3 / 9.1 | Brave (or any follower) trained at Warrior Training Hut |
| Preacher | 1,100 | 58 | 11.3 / 9.1 | Trained at Temple |
| Firewarrior | 700 | 55 (slowest) | 11.3 / 9.1 | Trained at Firewarrior Training Hut |
| Spy | 600 | 66 | 11.3 / 9.1 | Trained at Spy Training Hut |
| Shaman | not published (the strongest follower in melee terms is the Warrior; the Shaman is "physically weaker") | not published | 66.6 | Respawns at Reincarnation Site |
| Angel of Death | 10,000 | flying | 0 | Spell |
| Boat / Balloon | 5,000 each | n/a | n/a | Vehicle huts |

A unit's damage output scales with its current health (wounded Warriors hit weaker). [M]

Wiki infobox "life/strength" ratings (Brave 6/3, Warrior 12/14, Firewarrior 4/3 with ranged 14, Preacher 8/3, Spy 3/3, Shaman 14/3) are relative UI ratings, not the raw constants. [M]

### 4.2 Roles and strengths/counters (rock-paper-scissors)

| Unit | Does | Strong against | Weak against |
|---|---|---|---|
| Brave | Builds, chops wood, repairs, generates the most mana; source for every trained unit | nothing; swarms of braves can push a Shaman into water | everything; 2 to 3 Warriors can wipe out about 20 braves |
| Warrior | Only melee specialist; better than other units at knocking down buildings; one Warrior kills about 5 to 7 braves; can kill a Shaman if it reaches her | Braves, Spies, Preachers in melee, small Firewarrior groups in melee, buildings | Firewarrior mass fire (AoE), Preachers (get converted), Blast knockback, Swarm, Swamp, Hypnotise |
| Firewarrior | Ranged AoE fireballs (they cast a Blast-like shot); best in towers, on hills, in balloons/boats, and hidden inside huts to ambush a Shaman | Groups of anything in one cell (30 stacked Warriors can die to a few), enemy Shamans, Preachers at range, vehicles' crews | Melee Warriors rushing them, Blast groups (5 blasts can kill a whole group), Ghost Army baiting, they barely damage towers |
| Preacher | Stands idle and chants; enemy followers who wander into earshot are entranced and, if left undisturbed for several seconds, convert permanently, keeping their unit type. Does not work on Shamans or Preachers; cannot convert units inside huts | Warriors, Braves, Firewarriors (anything that comes near without interrupting) | Anything that interrupts: attack by Preacher or Shaman, an offensive spell, a nearby terrain spell, Firewarrior fire from range, Swarm, a Spy disguised as the preacher's colour, Bloodlust units |
| Spy | Disguises as any enemy tribe's colour (click the enemy tribe icon), sneaks in, sets huts and trees on fire, and attacks training huts and vehicle huts to cut production. Looks like a Brave to the enemy | Undefended huts, training huts, trees | Anything once revealed (right-click reveal, a Spy in a tower unmasks all in a large area); 3 Spies are needed to kill 1 Brave |
| Shaman | Only caster; also fights in melee; can enter huts and towers | Everything via spells at range | Lightning from another Shaman, massed Warriors, Firewarriors from several sides, water, a Swamp, falls |

Simple triangle to remember: Warriors beat Firewarriors in melee; Firewarriors beat Preachers at range; Preachers beat Warriors by conversion; spells (Shaman) break all three; Swarm and Ghost Army bait or neutralise Firewarriors and Preachers.

### 4.3 Conversion rules summary
- **Convert spell**: neutral Wildmen to Brave only. Wildmen have short lifespans and can die in water.
- **Preacher**: converts enemy Braves, Warriors, Firewarriors (Spies presumably; not stated). Cannot convert Shamans or enemy Preachers. Enemy Preachers can re-convert. Units inside a hut cannot be converted. Magical Shield and Bloodlust protect against it. Invisible units can still be converted.
- **Hypnotise**: temporary (about 40 s); permanent if the target is trained into a new class or its tribe dies.
- Preachers placed in tower groups stop mixed assaults; AI Chumara use Preachers heavily.

### 4.4 Training buildings
- Braves (or any follower, including hypnotised ones) are sent into a training hut and consume mana (section 2.2) to come out as the specialised unit. A trained unit cannot become a Brave again.
- Training huts cannot be upgraded. Each costs 8 wood. Warrior and Firewarrior huts produce mana only through their occupants.

### 4.5 Population growth [M]
- A tribe's population starts with a cap of **5**, gaining supply per hut (supply 3 / 5 / 7 for small / medium / large per one fan analysis; another wiki page says 3 / 6 / 9, which does not reconcile with the published hut counts to reach the 199 hard cap). Hard cap **199**.
- Huts: three sizes. Capacity (units that can stand inside): small 3, medium 4, large 5. Every new hut starts small and can be upgraded twice (small to medium to large); large cannot be upgraded further.
- A hut has two progress bars: a **green bar** (spawns a new Brave when full) and a **red bar** (upgrade progress, filled only when occupied). The green bar starts full, so completing a hut spawns a Brave immediately; empty huts still breed.
- Breeding rate multipliers from the constants file: base time by hut level 4000 / 3000 / 2000 (large is 2x faster than small); occupant multiplier 0.5 + 0.5 per occupant (so 0 occupants = 0.5, 1 = 1.0, 2 = 1.5, ... any follower including the Shaman counts); population bands of 5 followers each (values 30, 35, 40 ... for 0-4, 5-9, 10-14 ...) that make breeding slower as total population grows. [M]
- The "dismantle trick": partly dismantle then rebuild a hut to spawn a Brave instantly (resets the upgrade bar).
- Huts needed to reach 199 population: 65 small, 39 medium, or 28 large.

---

## 5. Buildings and worship objects

### 5.1 Construction and costs [H unless noted]
- Player picks a building from the Buildings panel, clicks the ground to place a **plan** (Space rotates it, Ctrl-click places many). Braves assigned automatically (or by command) build it: about half of the assigned braves fetch wood, the other half flatten the ground; construction advances in visible stages as wood arrives. Only Braves build.
- Huts and training huts appear to need to be placed near the existing settlement (a constant NEAR_BLDG_CELLS exists); Guard Towers and Guard Posts are the exceptions and can seed new settlements. [M]
- Doors have an orientation; **a tree or other object at the door blocks hut upgrades**.
- Building on a tree wastes that tree's wood.

| Building | Wood | Footprint (cells) | Function |
|---|---|---|---|
| Hut (small) | 3 | 3 x 3 | Houses 3; breeds Braves; upgradeable |
| Hut (medium, upgrade) | upgrade needs 3 wood piled at the door but consumes 2 (a wiki table lists 4 for a medium hut, which conflicts) | 3 x 3 | Houses 4 |
| Hut (large, upgrade) | same rule (wiki table lists 5) | 3 x 3 | Houses 5; fastest breeding |
| Guard Tower | 5 | 1 x 1 | Holds 1 unit; extends that unit's range (Shaman spells, Firewarrior fire; Braves see further); rings an alarm; Warrior inside enables "Call to Arms"; Spy inside unmasks enemy spies and hides area from the world view; reveals invisible units on the minimap; can be built anywhere and start a new settlement; stronger when built on high ground |
| Warrior Training Hut | 8 | 3 x 3 | Trains Warriors |
| Temple (Preacher hut) | 8 | 4 x 3 | Trains Preachers |
| Firewarrior Training Hut | 8 | 4 x 4 | Trains Firewarriors (bigger footprint) |
| Spy Training Hut | 8 | 2 x 2 | Trains Spies (smallest building after tower) |
| Boat Hut | 5 | 3 x 3 | Must touch a coast; sinks a patch of water as a slipway; holds up to 5 Braves, each builds a boat; vulnerable to Flatten/Erode |
| Boat | 4 per boat | n/a | Carries 5 followers over water only; only Firewarriors can attack from a boat; melee cannot reach occupants; Swarm ejects/drowns crew |
| Balloon Hut | 11 (largest building) | 5 x 4 | Braves use 3 wood per balloon |
| Balloon | 3 per balloon | n/a | Carries 2 units over land and water, faster, increases Shaman and Firewarrior range; explodes if left empty; capturable by a unit entering; Swarm dismounts crew |
| Guard Post | 0 | 1 x 1 | Free, invisible to enemies, anywhere; followers circle it (guard) or chain posts into patrols; Shift+right-click removes |
| Magical Prison | n/a | 3 x 3 | Scripted only. Stone, cannot burn or sink. Traps a Shaman at level start; acts like walls otherwise |

- Repairs cost wood (1 piece per 200 damage; minor repair 1, major 2) and one brave repairs as fast as several.
- Huts can be set on fire by Lightning (1 wood of damage) or Spies; Tornado destroys outright; Firestorm destroys about 4 huts.
- Shaman and Firewarriors can hide inside huts; enemies cannot see occupants.

### 5.2 Worship objects (the spell/building unlock system) [H]

| Object | Who can worship | Reward | Notes |
|---|---|---|---|
| Stone Head | Any follower | One-use spell shots (e.g. Lightning x4) or a one-time building, or mana | Needs a number of worshippers shown by right-click (levels use 1 to 8, typically 4 to 6). At or above the number = full speed; each missing worshipper HALVES speed (so 5 of 6 is half speed, 4 of 6 is a quarter). Progress decays when nobody worships (but not while at least 1 does). Full-speed prayer time defaults to 450 turns (37.5 s). Sinks into the ground after its reward count is used up. Cannot be targeted by spells or sunk. Players Swamp the access path to stop rival prayer |
| Totem Pole | Any follower | A scripted map effect (bridge appears, lava flows, land rises, boat granted, Erode cast) | Cannot hold a spell reward; makes unreachable areas reachable or hurts the enemy |
| Obelisk | Shaman only | Anything: a high-level spell, full charges for all spells, a mana boost | Two sections rotate 90 degrees when done; if the Shaman stops or dies mid-rotation the reward goes to the player's tribe |
| Gargoyle | Shaman only | Rare, high-value (e.g. 5 Angels of Death that win the level) | Stone Angel of Death statue |
| Vault of Knowledge | Shaman (worship, then enter) | **Permanent** spell or building learned from an enemy tribe | Usually heavily guarded in an enemy base. Each AI tribe's vaults reflect its personality: Dakini (Tornado, Firestorm, Angel of Death, Volcano, Warrior and Firewarrior huts), Chumara (Convert, Invisibility, Hypnotise, Shield, Temple, Spy hut), Matak (Erode, Swamp, Lightning, Swarm, Flatten, Landbridge, Earthquake, Guard Tower) |

Rewards are configured by map "triggers" with a cell radius, a pray time, an occurrence count, an inactive-decay setting, a required-worshipper count, and up to 10 linked effects or discoveries. A good data-driven design.

Design takeaway: worship objects turn map control into a resource game. They make the player split forces (guard the vault, pray at the head), create PvP flashpoints, and gate power through exploration and objective-play rather than a tech tree.

---

## 6. Resources

- **Only two resources: wood and mana.** There is no food, gold, upkeep, or per-unit cost besides mana training and wood for buildings.
- **Trees**: hold up to 4 pieces of wood (rare "super trees" more). A tree regrows 1 piece every **68 s**; if cut to nothing, it regrows from scratch in about **330 s** (about 5x slower) in the same spot. Maps have fixed tree sites. Cutting repeatedly does not slow regrowth. [M]
- Braves carry one wood piece at a time. They prefer to pick up spare wood piles over chopping. Wood piles left on the ground eventually vanish.
- A destroyed building drops its wood back out only if killed by a Tornado; other destruction (fire, quakes, sinking) loses it.
- **Harvesting / "farming"**: skilled players take 2 to 3 Braves to a tree, ctrl-click a tree then ground, pulling wood without felling the last piece, so trees keep growing quickly. Trees are scarce on competitive maps, so wood is a real constraint there.
- **Land is the third resource**: flat, dry, buildable land. Damaged land (scorched by lava, quake) cannot be built on or sunk until it recovers.
- **Water** is lethal terrain, not a resource (see section 7).
- **Wildmen** are a neutral population resource: a free Convert-spell source of early Braves that also die quickly if ignored.

---

## 7. Terrain

### 7.1 World model [H]
- Heightmap of **128 x 128 cells**. Objects are positioned in even coordinates 0 to 254 (2 per cell).
- Topology is a **torus** (leave one edge, reappear at the opposite side), but the renderer projects the local view onto a **sphere** so the horizon curves away, giving the illusion of a planet. A "world view" shows the whole globe.
- Terrain textures are chosen by altitude band and blended with masks, which cheaply produced varied planets. Land below the water line is ocean (colour can vary by planet, including lava-coloured "water" which still drowns).
- Altitude affects gameplay through 8 altitude bands in the constants (names ALT_BAND_0 to 7 for spell and Firewarrior increments), suggesting stepped range bonuses by height. Numeric values not published. [L]
- Slope limits are constants: WALK_ALT_DIFF2 (max walkable height step) and BUILD_ALT_DIFF2 (max buildable step). Fans patch them (walk 600 to 900, build 200 to 300) to cure pathfinding and "tiny bump blocks building" problems, implying the defaults are too strict. Default values not published. [M]

### 7.2 Height and placement [M]
- Huts need dry, near-flat land. Braves flatten the plan area as they build; small bumps can still block placement; buildings cannot be placed on or very near water (only the Boat Hut must be on the coast).
- A tree on a hut's doorstep blocks its upgrade.
- High ground gives: extended tower range for the occupant (Firewarriors, Shaman, Preachers), better Firewarrior performance on hills/in balloons, and defensive chokepoints. Levels are designed with plateaus, causeways, and cliff walls.
- Blast does more damage to targets on lower ground and less to targets on higher ground.
- Shaman fall damage after being blasted is her main damage source; casting a spell mid-air cancels it.

### 7.3 Water and drowning [H]
- Any follower or Shaman that enters water dies instantly (drowns). A drowned Shaman reincarnates faster (about 28 s).
- Water kills are a core tactic: Blast and Tornado push units into the sea; Flatten/Erode sink coastal land; Landbridge can rescue a falling Shaman by raising land under her.
- Lava makes land when it meets water. A Volcano cast in water creates new land.
- Boats and balloons cross water; Swarm over a boat can drown its crew.

### 7.4 What each terrain spell does to the heightmap
- **Landbridge**: raises ground from the Shaman's position toward the target, forming a ramp/causeway or new land; on the far shore of a strait it joins two landmasses; repeated casts ratchet height up in steps; can climb cliffs; "flatten from above" trick lowers high ground by bridging down.
- **Flatten**: levels an area to a single height (affects Shaman height too), can also fill sea cells to make land or drop cells below sea level if aimed carelessly.
- **Erode**: lowers and roughens ground, undermining huts, sinking land near water.
- **Earthquake**: random fault lines with lava (lava does 1 hit point of damage to buildings but kills units); on high land mostly lowers, on low land can open to water and swallow buildings.
- **Volcano**: creates a cone and lava flows (lava flows farther if cast on a hill); leaves damaged land.
- **Tornado**: leaves small dents where buildings are destroyed.
- **Teleport** lands with a ground shockwave that lowers very high nearby terrain.
- **Armageddon** carves a flat arena.
- Damaged land (lava, destruction) refuses to sink until it heals.
- Map scripts also use terrain events: Atlantis (land rises from the sea), lava flows from totems, fissures that erupt unless sealed with terrain spells (level 21).

### 7.5 Design takeaway
Terrain editing is not a constant god-power as in earlier Populous games. In PTB it is a situational tool (bridge, defend, sink, scar) constrained by range, charges and cost. The height-based range bonus and water-as-death rule create the tactical spine. The torus-plus-sphere projection is a rendering trick on a plain 2D heightmap, cheap to implement.

---

## 8. Camera and controls

### 8.1 Camera [H]
- Full 3D, variable-height camera that rotates 360 degrees around the focus. Zoom cycles through normal view, bird's-eye view, and a **world view** that shows the whole globe (limited actions; used for awareness and minimap-style scouting). Return key toggles world view; Shift+Return skips the animation.
- Scroll with arrow keys, screen edge, or mouse wheel button drag; rotation with left/right arrows (configurable to Ctrl).
- Four saved camera slots (Shift+Z/X/C/V to save, Z/X/C/V to recall); H jumps to the Reincarnation Site; a key centres on the Shaman; Space jumps to a tower under attack; a "follow last-commanded unit" key tracks a moving group.
- Characters remain 2D sprites on a 3D terrain; spell effects and terrain deformation are real-time.

### 8.2 Selecting and commanding followers [H]
- Mouse: click a follower or drag-select; right-click deselects or queries an object.
- The Followers panel lists counts per type. Shift-click a type icon = select all of that type. Ctrl-click = select 5. A "commandee toggle" limits selection to units on screen.
- Command groups: Shift+1 to 6 assigns; 1 to 6 selects; Alt+1 to 6 selects and jumps camera.
- Orders: left-click a location (move), a tree (chop), a plan (build), an enemy (attack), a hut or vehicle (enter). Ctrl queues up to 8 commands; Shift forces a command (ignore distractions on the way); Ctrl+Alt sets patrol points; N releases queued units simultaneously (used to synchronise attacks); G makes units guard the Shaman; D scatters units to dodge; Guard Posts are patrol anchors.
- Autonomy: Braves automatically build assigned plans, fetch wood, upgrade huts, breed, and repair. Troops auto-engage enemies in range and respond to tower alarms (B = Call to Arms). Units ordered somewhere unreachable raise their hands and slowly die (a famous pathing flaw).
- **The Shaman is controlled like a follower** (move/queue/patrol) but is the sole spell source: select a spell icon, a range circle appears around her, click inside it to cast; Ctrl-click keeps the spell selected for repeated casts; Alt-click toggles autocast; spells cannot be queued with N.
- Spell panel toggles charging per spell (see 2.2).

Design takeaway: the shaman-as-avatar plus high-level group orders was a strong fusion of RTS and god-game. Weaknesses were no formations, weak stance control, and having to micromanage dozens of tiny sprites in fights.

---

## 9. AI opponents [M]

- AI is **scripted per level**: each of up to 3 AI tribes per level gets a compiled script file (cpscrNNN.dat) plus an attribute file that sets which spells and buildings it may use. Scripts run every game turn and can be written with IF/ELSE and EVERY n turns (powers of 2) blocks, user variables (max 64), and engine variables.
- Known script knobs: INT_ATTR_EXPANSION (how aggressively to expand), INT_ATTR_MAX_BUILDINGS_ON_GO, INT_ATTR_HOUSE_PERCENTAGE; commands like BUILD_AT (fixed coordinates), CONVERT_AT_MARKER (use Convert on wildmen near a marker), SPELL_ATTACK (spell, count, target), TRIGGER_THING, GIVE_UP_AND_SULK, COUNT_PEOPLE_IN_MARKER. So the AI is a mix of preplaced bases and scripted behaviors, not a general planner.
- **Cheats are explicitly encouraged by the level-design guide**: start the AI with a full base, extra spells the player lacks, extra mana, and larger Convert range; separate human vs computer mana and training constants exist. In one level the AI Shaman casts far more Erodes than its charge limit.
- Typical AI attack force (Dakini): about 4 Preachers + 6 Warriors + 6 to 8 Firewarriors, arriving by a predictable route.
- **Tribe personalities** (all use identical rules):
  - Red Dakini: aggressive and brute force; big armies, boat attacks, defenders in towers with Firewarriors; spells such as Firestorm, Angel of Death, Volcano late; predictable direction of attack.
  - Yellow Chumara: sneaky; Preachers, Spies, Invisibility, Hypnotise, Magical Shield on strike forces, balloons and boats; unpredictable attack times and directions; often alone on an island.
  - Green Matak: defensive "turtle/boomer"; many towers, balanced forces, small attacks; Shaman spells like Erode, Earthquake, Swamp, Swarm (and sometimes kills herself in her own Swamp).
- Difficulty comes from level design (starting base, land, timers, AI scripts, spell restrictions) more than from AI cleverness. Reviewers noted the AI repeats similar attack patterns; once learned, it gets easy. Some called AI weak and single-player less compelling than multiplayer. [M]

Design takeaway: give each enemy faction a distinct, legible behaviour and spell kit (the personality was the best part), but build a real adaptive AI layer (scouting, target selection, retreat) on top of scripted set pieces, and keep cheats modest and visible.

---

## 10. Reception, what worked, what did not, keep vs fix

### 10.1 Reception [H]
- Aggregate about 80% (GameRankings); IGN 8.6/10, GameSpot 7.5/10, Edge 8/10; won Best Strategy Game at the 1999 Milia D'Or. Reviewers praised the 3D presentation, atmosphere, music, spell variety and physics-flavoured interactions (knockback into water, tornado, quake, volcano). The PlayStation port fared much worse (GameSpot scored it 4.1, citing controls and tiny units). [H]
- Criticisms: (1) hard to direct followers in hectic fights; (2) too automated and simple (no upgrades, little resource depth), lowering replay value; (3) missions become repetitive; (4) identity crisis between god game and RTS (Edge said it was "less show-stopping" and did neither perfectly); (5) clunky UI and pathfinding; (6) weak AI; (7) single-player thinner than multiplayer. [H]
- A fan community keeps multiplayer alive through community lobbies and map packs (hundreds of fan maps). EA re-released it on Steam in March 2024, where it shows about 88% positive from roughly 436 reviews. [M]

### 10.2 What was fun
- Charismatic, readable power fantasy: a few big spells (Volcano, Angel of Death, Firestorm, Swamp, Earthquake) feel decisive.
- Mana tied to population makes growth meaningful; the army-vs-economy trade-off.
- Vault and Stone Head rewards drive exploration and PvP/PvE objectives.
- Each tribe has a recognisable attack style; maps teach and test one trick.
- Water as death and knockback physics generate emergent, funny, skilful play.
- High-skill multiplayer micro (animation cancelling, Blast tricks, tower camping, spell-walking, harvesting) that sustained a community for decades.

### 10.3 Keep
1. Avatar spellcaster who can die, respawn at a base, and is the sole caster; her death throttles economy.
2. Population-driven mana with idle/active/trained modifiers; training competes with spells for the same pool.
3. Limited spell range from the avatar plus tower/balloon/height range bonuses.
4. Charge-based spells with max charges inversely scaled to cost; permanent (vault) vs temporary (shrine) spells.
5. Worship-object rewards as map objectives that lock progression to exploration and combat.
6. Water = death, terrain spells for bridging and sinking, with scarring ("damaged land") as a cost.
7. A small, legible unit set with a clear triangle (melee beats ranged, ranged beats priests, priests beat melee) and spies as sabotage.
8. Distinct faction AI personalities and hand-built, theme-twisted levels.
9. Spherical-looking world from a plain heightmap with wrapping edges.

### 10.4 Fix or modernise
1. **Pathfinding and terrain slope rules**: tune walk/build slope tolerances; never let units get stuck waving their hands; handle plans blocked by wildmen or trees; use flow-field or navmesh over a heightfield.
2. **Command UX**: add formations, stances (guard/hold/aggressive), attack-move, rally points, control groups with more slots, hotkeyed unit-type selection, reliable "retreat to tower", box select that works across the curved view; reduce need for Ctrl/Alt/Shift chords.
3. **Hectic-fight micromanagement**: give troops sensible default behaviour (focus fire, avoid AoE stacking, auto-retreat when low), plus spell-target previews and an undo for misclicks; show unit-type icons clearly (reviewers could not tell units apart).
4. **Mana feedback**: show per-spell ETA, income breakdown, and waste warnings; tooltips for the 50/50 split; allow priority sliders instead of toggle-fiddling.
5. **Economy depth without bloat**: a light upgrade layer (hut tiers, troop veterancy, tower upgrades) addresses "too simple". Avoid adding gold-style resources.
6. **Mission variety and pacing**: more objective types (escort, defend a shrine, capture with timers) and AI that adapts; avoid long idle build phases; add checkpoints/autosave.
7. **AI**: real scouting, targeting of vaults/shrines, adaptive army composition, difficulty ramps by decision quality as well as cheats; show AI intentions in the world view.
8. **Information/UI**: clear hut green/red bar equivalents, population cap and supply breakdown, fog-of-war reveals, minimap with curvature-aware markers.
9. **Terrain rendering**: keep the curved horizon but ensure picking/aiming is accurate on the sphere projection; supply a flat "map view".
10. **Multiplayer**: include AI skirmish and co-op from day one (the original had no AI in multiplayer).
11. **Balance**: Magical Shield plus balloons made Firewarriors invulnerable and got banned; Swamp, Hypnotise and Angel of Death were often banned; design spells with counters (cooldown or interruption) so they do not need community bans.

---

## 11. Multiplayer [H unless noted]

- Up to **4 players** over LAN, modem or Internet via an external matchmaker (official servers closed 2004; the community lobby "Reincarnated" keeps it alive). No computer opponents in multiplayer. Teams (2v2) and alliances are toggled with the tribe icons (both sides must ally).
- Stock maps: 2-player (Hills Divide Us, Eye of the Storm, Two Crabs, Skirmish, All Around the World), 3-player (Linked Isles, Skirmish, Three-Way, Avenging Angels, Sandy Castles), 4-player (Two on Two, Craters, Dead Sea, Face Off, Pressure Point). Expansion adds 12 more.
- **Default multiplayer restriction set** (the spells and buildings generally allowed): Blast, Convert, Swarm, Ghost Army, Landbridge, Lightning, Tornado, Flatten, Earthquake, Firestorm, Volcano (sometimes); Hut, Guard Tower, Warrior Training Hut, Firewarrior Training Hut. Preachers, Spies, Hypnotise, Swamp, Shield, Invisibility, Erode, Angel of Death, vehicles are usually off. Hosts configure spells and buildings per game. [M]
- Multiplayer-only features: Ghost Army, 18th spell slot, Forge World (2-minute pre-match terraforming with free alt-click raise/lower and 5 shots each of 9 land spells), guest spells configured by the map, "Blast wars / Light wars" arenas, instant reincarnation in some maps.
- Meta: rushing (hard rush, light rush, late rush), camping in towers, siding/backdooring, doubling (two allies on one enemy), harvesting trees, spell-walking, animation cancelling, defend vs attack on a "pressure point" middle. Map makers are advised to include a stone head objective, keep object counts under about 300, and make bases roughly fair but asymmetric.
- The Reincarnated community also supplies map editors, scripting tools, ranking and patches.

---

## 12. Uncertainties and conflicts to resolve before relying on numbers

1. **Mana scale**: some fan pages list Blast at 10,000, others 100. I use 100 (OPG); ratios are consistent. Follower mana rates (34.6 etc.) fit the 100 scale based on two published charge-time tests. An older community page claims braves give about 6 mana/min depending on hut size; it disagrees with tests and with the constants-derived rates, so I treated it as outdated.
2. **Landbridge cost**: 600 (guide table) vs 700 (OPG/wiki).
3. **Hut supply**: 3 / 5 / 7 (consistent with the 199 hut-count table) vs 3 / 6 / 9 (another wiki page).
4. **Reincarnation time**: 28 s (drowned) and 38 to 38.75 s (other), vs a 35 s figure elsewhere.
5. **Shaman health, training mana cost per unit, exact slope limits, altitude-band bonuses, preacher conversion time, warriors-per-minute caps** were not found as hard numbers; need playtesting or reading the constants file.
6. **Tornado duration** quoted as 7 s in a text note but 17 s in the table.
7. **Spell total**: sources say 22, 26, or 20 depending on whether Forge World, guest and removed spells are counted. The campaign effectively offers 16 permanent spells plus 3 guest spells (and Ghost Army only via scripting or multiplayer).
8. **Level pages** list "player count" including AI tribes; enemy tribe identities for a few levels were not extracted.
9. Review text for IGN, Eurogamer and the PC GameSpot review was not retrievable; reception is based on Wikipedia's summary, a PlayStation GameSpot review, a fan review, and a retrospective. Treat precise quotes of those as unverified.

---

## 13. Notes for an ORIGINAL game inspired by these systems

- Avoid: the title and "Populous", tribe names (Dakini, Chumara, Matak), unit names Brave/Warrior/Firewarrior/Preacher/Spy/Shaman as a set, building names (Vault of Knowledge, Reincarnation Site, Stone Head), spell incantation words, the sprite look, music, and the specific level names. Spell concepts (fireball, lightning, tornado, quake, volcano, swarm) are generic and fine; rename and re-theme.
- Keep the system relationships (formulas, ratios, tiers) but change the numbers and the surface fiction. Suggested original skeleton: an avatar-mage who dies and returns at a hearth; settlers who breed in dwellings and produce "spirit" energy at rates by role; shrines that give one-shot or permanent powers; curved-horizon heightmap world with water as hazard; faction AI personalities.
- Parameters you can lift as starting values: 12 sim ticks per second; 128 x 128 heightmap; population cap about 199; spell charge tiers 1 / 4-9 / 10-21 / 40-80 / 100 blasts; max charges 4 / 3 / 2 / 1; income ratios shaman 1.9 : worker 1 : soldier 0.33 : idle 0.26; mana split 50/50 spells vs training; tree regrowth 68 s partial / 330 s full; shrine worship speed halves per missing worshipper.

---

## Sources

Primary mechanics data:
- Populous Wiki (popre.net): https://wiki.popre.net/Mana , /Blast , /Convert , /Swarm , /Invisibility , /Magical_Shield , /Landbridge , /Lightning , /Hypnotise , /Tornado , /Swamp , /Flatten , /Erode , /Earthquake , /Firestorm , /Angel_of_Death , /Volcano , /Teleport , /Armageddon , /Ghost_Army , /Guest_Spell , /Forge_World , /Brave , /Warrior , /Firewarrior , /Preacher , /Spy , /Shaman , /Wildmen , /Hut , /Upgrading , /Dismantle_Trick , /Guard_Tower , /Temple , /Warrior_Training_Hut , /Firewarrior_Training_Hut , /Spy_Training_Hut , /Boat_Hut , /Balloon_Hut , /Boat , /Balloon , /Guard_Post , /Magical_Prison , /Stone_Head , /Vault_of_Knowledge , /Obelisk , /Totem_Pole , /Gargoyle , /Reincarnation , /Reincarnation_Site , /Tree , /Wood , /Water , /Path_finding , /Keyboard_Shortcuts , /Worldview , /Fog_of_War , /Constant , /Tribes , /Multiplayer , /Rush , /Camping , /Spellwalking , /Harvesting , /Effect , /Triggering , /Tutorial:AI_Scripting , /Tutorial:Map_Making , /Dat_Format , /Object_Data , /Header_Format , /Single_Player , /Solar_System , /Pressure_Point , and each of the 25 level pages (e.g. /The_Journey_Begins, /Night_Falls, /Building_Bridges, /Fractured_Earth, /Solo, /Journey's_End, /The_Beginning)
- Populous Reincarnated player guide (strategy pages): https://ts.popre.net/websites/poptb.com/guide/basic-gameplay/spells/index.html , .../basic-gameplay/mana/index.html , .../basic-gameplay/miscellaneous/index.html , .../basic-gameplay/building/index.html , .../basic-gameplay/shaman/index.html , .../getting-started/buildings-structures/index.html , .../getting-started/controls/index.html , .../getting-started/followers/index.html , .../tactics/index.html
- CD Player's Populous strategy pages: https://cdplayer.popre.net/strategy/mana.htm , /spells.htm , /interface.htm , /followers.htm , /attacking.htm , /trees.htm , /buildings.htm , https://cdplayer.popre.net/strategy/maps/map_support.htm

Reception, history, design commentary:
- Wikipedia, Populous: The Beginning: https://en.wikipedia.org/wiki/Populous:_The_Beginning
- Wikipedia, Populous (series): https://en.wikipedia.org/wiki/Populous_(series)
- Hardcore Gaming 101: https://www.hardcoregaming101.net/populous-the-beginning/
- Populous Reincarnated review by Khickman (PTB, Undiscovered Worlds, New Worlds): https://ts.popre.net/popre2004/Khickman/review.asp
- GameSpot PlayStation review: https://gamespot.com/reviews/populous-the-beginning-review/1900-2548942/
- Game Developer, "God Games: Impostors in the Pantheon": https://www.gamedeveloper.com/design/god-games-impostors-in-the-pantheon
- PopMatters, "Tribal Spirituality in Populous The Beginning": https://www.popmatters.com/post/131166-tribal-spirituality-in-populous-the-beginning/
- GameRevolution: https://www.gamerevolution.com/game/populous-the-beginning
- Games Like Finder: https://gameslikefinder.com/review/populous-the-beginning/
- Steam store page: https://store.steampowered.com/app/2616430/Populous_The_Beginning/

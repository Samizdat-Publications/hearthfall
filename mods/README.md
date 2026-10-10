# Hearthfall mods

A mod is a folder here, `mods/<id>/`, that changes the game's data without touching the base pack.
The id is snake_case and matches the folder name.

## What goes in a mod folder

- `manifest.json` (required):
  - `id`: the folder name.
  - `name` and `version`: shown on the main menu.
  - `loadOrder`: 1 or more. Lower loads first, so higher wins.
  - `description`: one optional line.
- Any of the pack files from `data/base/`, as patches holding only what changes: `balance.json`, `style.json`, `units.json`, `buildings.json`, `spells.json`, `ai_personalities.json`, `terrain.json`.

## How patches merge

- Objects merge key by key. `{"weather": {"rain": {"speedMult": 0.7}}}` changes one number.
- Lists of things with an `id` (units, buildings, spells, personalities, presets) merge by id:
  - A known id changes only the fields you give.
  - A new id adds a new entry. A new entry must be complete, like the base entries.
  - `{"id": "x", "$remove": true}` removes an entry.
- Anything else (numbers, strings, plain lists) is replaced.
- `$comment` keys are ignored.

The merged pack is validated like the base pack: every schema, every cross reference. A mod that breaks a rule fails with the file and path. The merged pack gets its own hash, so saves and replays only load with the same mods.

## Trying a mod

Run both commands from the project folder:

```bash
cd C:\Users\stewa\Documents\Claude\Hearthfall
npm run mods
```

`npm run mods` checks every mod on its own, then all of them together. It prints the load order and any conflicts, where two mods set the same value. The one later in load order wins. To check a chosen set, use `npm run mods -- --mods a,b`.

To play with mods, add `?mods=a,b` to the game URL, for example `http://127.0.0.1:5182/?mods=swift_wardens` under `npm run serve`. The main menu lists the active mods.

To balance-test a mod headless, run `npm run soak -- --mode ai --mods swift_wardens`.

## Example mods

- `swift_wardens`: Wardens run faster and train for less mana. This is a list patch by id.
- `rainy_season`: rain slows every unit to 70 percent. This is an object patch. Pick Rain in the skirmish setup.

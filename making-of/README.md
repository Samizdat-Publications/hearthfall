# Making of Hearthfall (image archive)

Stewart asked (10/08/2026) for every generated image to be kept so a "making of" artifact can later show the game's progression from first pixels and concept art to the finished game. This folder is that archive. It is committed to git; keep it curated (target under 60 MB) by archiving representative images, not every test frame.

## How it works

- Add an image: `npm run making-of -- add <file> --milestone M2 --kind screenshot --caption "what it shows" [--highlight] [--slug short-name]`
- List: `npm run making-of -- list [--milestone M2]`
- Files land in `making-of/<milestone>/<UTC stamp>_<slug>.<ext>` and get an entry in `making-of/index.json`: `file, milestone, kind, caption, highlight, when, source, bytes`.
- Milestone tags: `M0` to `M11` (code roadmap), `A0` to `A4` (asset track), `B<n>` (backlog item n), `run` (end of run summary).
- Kinds: `concept`, `screenshot`, `contact-sheet`, `asset-sheet`, `asset-thumb`, `comparison`, `diagram`.
- `highlight: true` marks the one or two images that best represent that chapter; the artifact uses highlights as chapter heroes and the rest as a gallery.

## When images get archived (built into the workflow)

1. Milestone exit ritual step 4: the contact sheet that was viewed is archived, plus the single best shot as a highlight.
2. Asset track: every concept reference, the style-direction pick, bake-off comparison sheets and each class contact sheet.
3. Any visual "before and after" (lighting pass, water shader, new spell VFX): archive both as `comparison`.
4. The doctor capture at M0 (first pixels), and a final hero shot at the end of the run (`run`).

## Storyboard (pre-planned chapters)

| Chapter | Tag | What the images should show |
|---|---|---|
| 1. First pixels | M0 | Bootstrap scene captured headless on the GPU; SwiftShader vs GPU comparison |
| 2. Finding the look | A0, A1 | First concept image, the 6 style references as a sheet, the chosen direction, unit bake-off sheet |
| 3. A world on a torus | M1, M2 | Generated planet heightmap (continents vs islands), first rendered terrain, wrap seam, globe zoom, map view |
| 4. People appear | M3 | Hundreds of placeholder settlers pathing over ridges; selection box on the curve |
| 5. A village grows | M4 | Dwellings rising, trees chopped, HUD v1, population curve |
| 6. The Shaper's power | M5 | One frame per v1 spell mid-cast (Bolt, Call, Lightning, Raise Land, Flatten, Quake, Hornets, Volcano) |
| 7. War | M6, M7 | Counter-triangle battle, towers, an AI attack wave crossing a land bridge |
| 8. A real game | M8, M9 | Main menu, skirmish setup, win screen, the teaching levels |
| 9. Real assets and sound | M10, A2 to A4 | Placeholder vs real assets comparison, building and unit sheets |
| 10. Polish | M11 | Before and after of the lighting, fog, water and VFX pass; final hero shots |
| 11. Growing for weeks | B<n>, run | New spells, fog of war, campaign levels as they land |

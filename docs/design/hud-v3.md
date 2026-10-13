# HUD v3 "Ember Grove" (Stewart, 2026-10-12)

Stewart rejected the CSS-only "Grove and Bone" canvas as too simple. He picked Gemini concept D:
`tools/assets/raw/gemini/ui/concept_d.png` (gitignored raw; a copy is in `making-of/`). Reference mockups he
liked are in `tools/assets/raw/_ui_refs/` (1.webp to 8.webp). What he called out: the tip text on a hide scroll
stretched between sticks, a real painted Shaper portrait (not pixel art), the minimap set beside a lava
cauldron, and a bottom stance bar overgrown with vines on one side and lava on the other. No big tree; a small
volcano sits in the bottom-left corner instead.

## Pieces

Painted by Gemini on magenta (`tools/assets/ui_gen.py`, prompts in `tools/assets/raw/_ui_refs/pieces/`),
keyed to transparent WebP by `tools/assets/ui_key.py` into `assets/ui/hud/` (sizes in `index.json`).

| Piece | Use |
|---|---|
| `shaper_frame` | top-left status panel: bone portrait slot on the left, dark recess on the right for mana and followers bars and wood and stone |
| `portrait` | painted elder Shaper portrait, already framed; sits in the shaper frame's slot |
| `title_plaque` | "HEARTHFALL" ember plaque above the shaper panel |
| `spellbar_frame` | top-center branch beam with an empty basalt tray for the spell buttons |
| `rune_disc` | one spell button background; the existing glyph and charge badge go on top |
| `tip_hide` | hide scroll between two sticks under the spell bar; the tip text goes on it |
| `objectives_frame` | top-right lashed stick frame with parchment |
| `build_panel` | right-side basalt column with a header tab; build buttons inside |
| `build_button` | one build button background |
| `stance_frame` | bottom-center vine and lava plank with a top tab ("Stance" or the selection line) |
| `stance_button` | one stance button background (grey stone) |
| `cauldron` | bottom-right: lava cauldron with a bone ring beside it; the minimap canvas shows through the ring's transparent hole |
| `volcano_corner` | bottom-left corner ornament (pointer-events none) |
| `level_plaque` | bottom-left plaque for the level name, beside the volcano |
| `small_plaque` | small labels (Population, header tabs) |

## Rules

- Text, numbers, bars, glyphs and buttons stay live HTML on top of the art, never baked in.
- Designed at 1920 x 1080 with concept D's proportions; `--ui-scale` (auto 133 percent at 2560 x 1440) multiplies it.
- Ornaments never take pointer events and never cover the middle of the world view.
- Fonts: Marcellus SC for headings and plaques, Alegreya Sans for body (already bundled).

## As built (2026-10-12)

- `apps/game/src/hudArt.ts` imports every piece with Vite `?url` and `applyHudArt` sets them on the document root as CSS custom properties `--art-<piece>` (for example `--art-build-button`); `hudBridge.ts` calls it once at import. `packages/ui` never imports the images (the imports guard keeps it inside its package), it only reads the variables, so `menus.css` can use them too.
- Panels that grow use 9-slice `border-image` (slices in source pixels, widths in design pixels, `fill`, `border: 0 solid transparent` so padding places the content). Fixed pieces (rune disc, build button, small plaque, cauldron, ornaments) use `background-size: 100% 100%` or `contain` at the piece's own aspect, so nothing is distorted. Art that hangs outside a box (the spell bar's lower beam) uses `border-image-outset`, never a child, so the DOM overlap and overflow checks still measure the real box.
- Ornaments are `.hud-deco` divs (`deco-title`, `deco-shaper`, `deco-volcano`): no `data-hud`, not `.hud-panel`, `pointer-events: none`, same zoom as the panels.
- Top left: `title_plaque` over `shaper_frame`; the Shaper panel (`data-hud="shaper"`: portrait button, name strip, health track) sits in the bone slot and the resources panel (`data-hud="resources"`) in the dark recess. Tribes keep no wood or stone stockpile (wood is carried to sites), so the recess holds the mana and followers bars (the "wasting" warning is a tag inside the mana bar), the spell and training split and the build, upgrade, breed priorities instead of wood and stone counts.
- Top center: the spell bar (shifted right of center by `--spell-shift`, 50px, so the Shaper panel and the objectives leave it equal room) in the tray of `spellbar_frame`, each spell on a `rune_disc` (ring, icon, glyph, hotkey, charge badge, ETA, armed, auto, charging and locked states kept). The tip and the Forge panel sit under it on `tip_hide` in dark ink; when the bar wraps to more rows, `main.ts` publishes its bottom as `--spell-bottom` and they move down with it.
- Top right: `.hud-right` stacks objectives (`objectives_frame`, dark ink, a check mark on done lines and a diamond on open ones) over the build list (`build_panel`, three columns of `build_button` so the right column stays short and the HUD can scale up, each with icon, name, hotkey and cost; locked buttons dim but keep their cost).
- Bottom center: `.hud-bottom` stacks undo, the selection line, the idle chip and the troops panel on `stance_frame`; the frame's tab names the view (Stance, Lodge, Tower, Site or Plan) and the buttons are `stance_button` stone with dark text and an ember glow when on.
- Bottom row (2026-10-12, Stewart: the stance plank took too much play area): `--hud-low` (0.8) multiplies the zoom of the bottom center stack, the minimap cauldron, the level plaque and the volcano, so the bottom row is smaller than the rest of the HUD.
- Voice subtitle (2026-10-13): the first item of the bottom center column, above undo and the selection line. It used to float at 30 percent height; once the smaller bottom row let the fitter pick a larger HUD scale, the build panel ran into it (the subtitle is not a .hud-panel, so hudFits never sees it, and a chant line should not shrink the HUD).
- Troops panel (2026-10-12): the panel carries the class `troops-units` (its kind), so the chip row rule is scoped to `.hud-troops .troops-units`; a bare `.troops-units` max-width used to shrink the whole panel below the 600px the frame art is laid out for. Padding 72px 186px 52px 80px keeps chips and buttons on the wood board (off the rails and the lava rocks), the four stance buttons share one row, and the tab label sits at left 252px, top 17px, the center of the painted tab.
- Shaper selection: S selects her in place (the camera stays put); S again while only she is selected, or a click on the portrait, centers on her (`keySelectCenters` in `apps/game/src/troops.ts`).
- Bottom right: the whole square minimap sits inside the hole of the cauldron's bone ring on a dark disc (no clipped corners, so every ping and corner stays visible and clickable); the cauldron is drawn over it by `::after`, which starts 24px above the panel box so the build panel can come closer. Population is on `small_plaque` (it keeps its tooltip).
- Bottom left: `volcano_corner` ornament and the level panel (`data-hud="title"`) on `level_plaque` with the level name, tick and the game speed control.
- Notes sit under the Shaper panel on the left; the help line (H, off at start; a note at match start says which key shows it, and the level plaque reads "H keys" while it is hidden) is centered on `small_plaque`; the subtitle sits at 30 percent height so it clears the help; other small panels (notes, selection, undo, idle, subtitle, Forge) use the `build_button` plank as a 9-slice.
- The replay bar (outside the HUD root) sits in the tip slot under the spell bar at `202px * --hud-scale`; `main.ts` mirrors the fitted `--hud-scale` onto `#replay`, which zooms its panel by it.
- Fit: the HUD reaches 1.5 at 2560 x 1440, 1.1 at 1920 x 1080 and 0.75 at 1280 x 720 before panels touch; small text (costs, hotkeys, ETAs, charges, the level sub line) is 13 to 14 design px. The HUD art preloads at startup so the first frames have it.

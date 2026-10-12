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

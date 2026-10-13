// HUD v3 "Ember Grove" (docs/design/hud-v3.md): the painted HUD pieces in assets/ui/hud (keyed to transparent
// WebP by tools/assets/ui_key.py) as Vite asset URLs. packages/ui may not import assets (tools/guards/imports.mjs),
// so the app sets them as CSS custom properties (--art-<piece>, a url() value) on the document root, where
// hud.css and menus.css use them as backgrounds and border images. Text, numbers and buttons stay live HTML.
import buildButton from "../../../assets/ui/hud/build_button.webp?url";
import buildPanel from "../../../assets/ui/hud/build_panel.webp?url";
import cauldron from "../../../assets/ui/hud/cauldron.webp?url";
import levelPlaque from "../../../assets/ui/hud/level_plaque.webp?url";
import objectivesFrame from "../../../assets/ui/hud/objectives_frame.webp?url";
import portrait from "../../../assets/ui/hud/portrait.webp?url";
import runeDisc from "../../../assets/ui/hud/rune_disc.webp?url";
import shaperFrame from "../../../assets/ui/hud/shaper_frame.webp?url";
import smallPlaque from "../../../assets/ui/hud/small_plaque.webp?url";
import spellbarFrame from "../../../assets/ui/hud/spellbar_frame.webp?url";
import stanceButton from "../../../assets/ui/hud/stance_button.webp?url";
import stanceFrame from "../../../assets/ui/hud/stance_frame.webp?url";
import tipHide from "../../../assets/ui/hud/tip_hide.webp?url";
import titlePlaque from "../../../assets/ui/hud/title_plaque.webp?url";
import volcanoCorner from "../../../assets/ui/hud/volcano_corner.webp?url";

/** piece id (assets/ui/hud/index.json) to its served URL */
export const HUD_ART: Record<string, string> = {
  build_button: buildButton,
  build_panel: buildPanel,
  cauldron,
  level_plaque: levelPlaque,
  objectives_frame: objectivesFrame,
  portrait,
  rune_disc: runeDisc,
  shaper_frame: shaperFrame,
  small_plaque: smallPlaque,
  spellbar_frame: spellbarFrame,
  stance_button: stanceButton,
  stance_frame: stanceFrame,
  tip_hide: tipHide,
  title_plaque: titlePlaque,
  volcano_corner: volcanoCorner,
};

/** CSS custom property name for a piece: build_button gives --art-build-button. */
export const artVar = (id: string): string => `--art-${id.replace(/_/g, "-")}`;

/** Sets every --art-<piece> custom property on `el` (the document root, so the menus can use them too). */
export function applyHudArt(el: HTMLElement): void {
  for (const [id, url] of Object.entries(HUD_ART)) {
    el.style.setProperty(artVar(id), `url("${url}")`);
    // start every download now, not when a panel first shows, so the first frames (and shots) have the art
    if (typeof Image !== "undefined") new Image().src = url;
  }
}

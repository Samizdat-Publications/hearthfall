// @hearthfall/ui: Preact HUD and menus. Renders view models; intents go back through callbacks.
export { KEY_ACTIONS, SPELL_KEYS, actionFor, defaultKeymap, keyLabel, rebind, sanitizeKeymap, spellSlot, type KeyAction, type Keymap } from "./keys.ts";
export { STANCES, areaLine, hudModel, mountHud, type ForgeView, type HudActions, type HudModel, type NoteView, type ObjectiveView, type SpellView, type TroopView } from "./hud.tsx";
export { editorModel, mountEditor, type EditorActions, type EditorView } from "./editor.tsx";
export { replayModel, mountReplay, type ReplayActions, type ReplayView } from "./replay.tsx";
export { chapterPick, menuModel, mountMenus, type Choice, type MenuActions, type MenuModel, type Screen, type SettingsPatch, type SettingsView, type SetupPatch, type SetupView, type SlotView, type LevelView } from "./menus.tsx";
export { keyText, locale, missingStrings, pseudoize, setKeyNames, setStrings, t, type StringTable } from "./i18n.ts";

// Spell bar hotkeys (DESIGN section 12): slot k of the bar uses SPELL_KEYS[k]. The second row (BACKLOG 1
// and 53) covers the spells earned at worship sites, so all 16 can be on the bar at once.
export const SPELL_KEYS = ["Z", "X", "C", "V", "B", "N", "Shift+M", "Shift+N", "Shift+Z", "Shift+X", "Shift+C", "Shift+V", "Shift+B", "Shift+J", "Shift+K", "Shift+L"] as const;

/** Spell bar slot for a key event, or -1. Ctrl combos never cast. e.key is "M" when Shift is held. */
export function spellSlot(e: { key: string; shiftKey: boolean; ctrlKey: boolean }): number {
  if (e.ctrlKey || e.key.length !== 1) return -1;
  const label = (e.shiftKey ? "Shift+" : "") + e.key.toUpperCase();
  return (SPELL_KEYS as readonly string[]).indexOf(label);
}

// Rebindable commands (M8 settings). Spell keys, control groups (0-9, Ctrl+0-9), camera bookmarks
// (F1-F4), quick save and load (F5, F9), arrows, Escape and Space stay fixed so a rebind can never lock the player out.
export const KEY_ACTIONS = [
  { id: "buildDwelling", label: "Place dwelling", key: "D" },
  { id: "buildTower", label: "Place watchtower", key: "T" },
  { id: "attackMove", label: "Attack-move", key: "A" },
  { id: "retreat", label: "Retreat", key: "R" },
  { id: "garrison", label: "Garrison", key: "G" },
  { id: "selectShaper", label: "Select the Shaper", key: "S" },
  { id: "rotateLeft", label: "Rotate camera left", key: "Q" },
  { id: "rotateRight", label: "Rotate camera right", key: "E" },
  { id: "toggleMap", label: "Map view", key: "M" },
  { id: "help", label: "Help panel", key: "H" },
  { id: "pauseMenu", label: "Pause menu", key: "P" },
  { id: "cancelCast", label: "Undo a cast", key: "Backspace" },
  { id: "cancelPlan", label: "Cancel the selected plan", key: "Delete" },
  { id: "photoMode", label: "Photo mode", key: "F" },
  // QoL: game speed (single player) and the campaign level briefing
  { id: "speedDown", label: "Slower game", key: "-" },
  { id: "speedUp", label: "Faster game", key: "=" },
  { id: "briefing", label: "Level briefing", key: "O" },
  // render polish: cycle the health bars (when damaged, always, off)
  { id: "healthBars", label: "Health bars", key: "L" },
  // QoL part 2: jump to the latest under attack alert, select the next idle troop group
  { id: "lastAlert", label: "Jump to the latest alert", key: "U" },
  { id: "idleTroops", label: "Next idle troops", key: "." },
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number]["id"];
export type Keymap = Record<KeyAction, string>;

/** Keys a binding may not take (fixed controls listed above, plus every spell key). */
const RESERVED = new Set<string>(["Escape", "Space", "F1", "F2", "F3", "F4", "F5", "F9", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab", ...SPELL_KEYS, ..."0123456789"]);

/** Actions polled as held keys every frame; the held key set stores bare keys, so these cannot use Shift combos. */
const HELD = new Set<string>(["rotateLeft", "rotateRight"]);
const heldOk = (action: string, label: string) => !HELD.has(action) || !label.startsWith("Shift+");

export function defaultKeymap(): Keymap {
  return Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.key])) as Keymap;
}

/** Display label of a key event: "D", "Shift+M", "Backspace", "Space"; "" for bare modifier presses. */
export function keyLabel(e: { key: string; shiftKey: boolean }): string {
  if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return "";
  const base = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return (e.shiftKey && e.key.length === 1 && e.key !== " " ? "Shift+" : "") + base;
}

/** The action bound to a key event, or null. Ctrl combos never trigger a binding. */
export function actionFor(km: Keymap, e: { key: string; shiftKey: boolean; ctrlKey: boolean }): KeyAction | null {
  if (e.ctrlKey) return null;
  const label = keyLabel(e);
  if (!label) return null;
  for (const a of KEY_ACTIONS) if (km[a.id] === label) return a.id;
  // numpad + and Shift+= mean the = key (speed up)
  if (label === "+" || label === "Shift++") for (const a of KEY_ACTIONS) if (km[a.id] === "=") return a.id;
  return null;
}

/**
 * Bind `action` to `label`. A key held by another action swaps over, so no two actions share a key;
 * reserved keys are refused with a reason.
 */
export function rebind(km: Keymap, action: KeyAction, label: string): { keymap: Keymap; error: string | null } {
  if (!label) return { keymap: km, error: "press a key" };
  if (RESERVED.has(label)) return { keymap: km, error: `${label} is reserved` };
  if (!heldOk(action, label)) return { keymap: km, error: "camera rotation keys cannot use Shift" };
  const out = { ...km };
  const other = KEY_ACTIONS.find((a) => a.id !== action && out[a.id] === label);
  if (other && !heldOk(other.id, km[action])) return { keymap: km, error: `${label} rotates the camera, which cannot take ${km[action]} (Shift)` };
  if (other) out[other.id] = km[action];
  out[action] = label;
  return { keymap: out, error: null };
}

/** A stored keymap merged over the defaults (unknown actions dropped, missing ones defaulted, duplicates reset). */
export function sanitizeKeymap(stored: unknown): Keymap {
  const km = defaultKeymap();
  if (!stored || typeof stored !== "object") return km;
  const seen = new Set<string>();
  for (const a of KEY_ACTIONS) {
    const v = (stored as Record<string, unknown>)[a.id];
    if (typeof v === "string" && v && !RESERVED.has(v) && !seen.has(v) && heldOk(a.id, v)) {
      km[a.id] = v;
      seen.add(v);
    }
  }
  // a stored binding may now hold a newer action's default key: the player's binding wins and the newer action
  // starts unbound (they can bind it in Settings), so no custom binding is lost
  for (const a of KEY_ACTIONS) {
    const v = (stored as Record<string, unknown>)[a.id];
    const kept = typeof v === "string" && km[a.id] === v;
    if (!kept && seen.has(km[a.id])) km[a.id] = "";
  }
  return km;
}

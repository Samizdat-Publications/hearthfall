// Spell bar hotkeys (DESIGN section 12): slot k of the bar uses SPELL_KEYS[k].
export const SPELL_KEYS = ["Z", "X", "C", "V", "B", "N", "Shift+M", "Shift+N"] as const;

/** Spell bar slot for a key event, or -1. Ctrl combos never cast. e.key is "M" when Shift is held. */
export function spellSlot(e: { key: string; shiftKey: boolean; ctrlKey: boolean }): number {
  if (e.ctrlKey || e.key.length !== 1) return -1;
  const label = (e.shiftKey ? "Shift+" : "") + e.key.toUpperCase();
  return (SPELL_KEYS as readonly string[]).indexOf(label);
}

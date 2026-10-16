// BACKLOG 22 (ADR-020): localization scaffold. UI text is looked up by key in a flat string table
// (data/strings/<locale>.json, loaded by the app); `{name}` placeholders take values. A missing key
// falls back to English, then to the key itself, and is remembered so tests can report it. The
// "pseudo" locale accents every letter and pads the text by about 40 percent, so the DOM layout
// checks catch labels that would not fit a longer language.

import { defaultKeymap } from "./keys.ts";

export type StringTable = Record<string, string>;

let base: StringTable = {};
let table: StringTable = {};
let current = "en";
/** keys asked for that no table has (dev and test aid) */
export const missingStrings = new Set<string>();

const ACCENT: Record<string, string> = {
  a: "à", e: "é", i: "î", o: "ö", u: "ü", c: "ç", n: "ñ", y: "ý",
  A: "À", E: "É", I: "Î", O: "Ö", U: "Ü", C: "Ç", N: "Ñ", Y: "Ý",
};

/** Pseudo-localize one string: accented letters, placeholders (and {key:action} names) kept, padded and bracketed. */
export function pseudoize(s: string): string {
  const parts = s.split(/(\{(?:key:)?\w+\})/);
  const body = parts.map((p) => (/^\{(?:key:)?\w+\}$/.test(p) ? p : p.replace(/[a-zA-Z]/g, (ch) => ACCENT[ch] ?? ch))).join("");
  const letters = s.replace(/\{(?:key:)?\w+\}/g, "").length;
  return "[" + body + "~".repeat(Math.ceil(letters * 0.4)) + "]";
}

/** Install the English base table and, optionally, a locale over it ("pseudo" derives from English). */
export function setStrings(en: StringTable, locale: string = "en", tableFor: StringTable | null = null): void {
  base = en;
  current = locale;
  if (locale === "pseudo") table = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, pseudoize(v)]));
  else table = tableFor ?? {};
  missingStrings.clear();
}

export function locale(): string {
  return current;
}

/** S4 L8-B: the key each rebindable action is bound to now (the player's keymap, set by the app with its settings; the defaults until then). */
let keyNames: Record<string, string> = defaultKeymap();

/** Install the current key bindings, so help text names the keys the player really uses. */
export function setKeyNames(names: Readonly<Record<string, string>>): void {
  keyNames = { ...names };
}

/**
 * Fill `{key:action}` with the key bound to that action (`{key:buildDwelling}` reads "D" by default). Used by t()
 * and for text that does not come from the string table (level objectives and messages, first match tips). An
 * action with no binding keeps its placeholder, so a typo shows up in the DOM checks instead of reading as a key.
 */
export function keyText(s: string): string {
  return s.indexOf("{key:") < 0 ? s : s.replace(/\{key:(\w+)\}/g, (m, a: string) => keyNames[a] ?? m);
}

/** The text for a key, with `{name}` placeholders filled from vars and `{key:action}` from the key bindings. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = table[key] ?? base[key];
  if (s === undefined) {
    missingStrings.add(key);
    s = key;
  }
  return keyText(vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);
}

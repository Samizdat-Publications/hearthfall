// BACKLOG 22 (ADR-020): picks the UI string table. English is the base; `?lang=<id>` picks
// data/strings/<id>.json over it, and `?lang=pseudo` pseudo-localizes English to test layouts.
import { setStrings, type StringTable } from "@hearthfall/ui";

const files = import.meta.glob("../../../data/strings/*.json", { eager: true, import: "default" }) as Record<string, StringTable>;

const tables: Record<string, StringTable> = {};
for (const [path, json] of Object.entries(files)) tables[path.split("/").pop()!.replace(".json", "")] = json;

/** The locales the game can show (English, any translated tables, and the pseudo test locale). */
export function locales(): string[] {
  return [...Object.keys(tables).sort(), "pseudo"];
}

/** Install the string table for a locale; an unknown locale falls back to English. Returns the locale used. */
export function applyLocale(lang: string | null): string {
  const en = tables.en ?? {};
  const id = lang && (lang === "pseudo" || tables[lang]) ? lang : "en";
  setStrings(en, id, id === "en" || id === "pseudo" ? null : tables[id]);
  return id;
}

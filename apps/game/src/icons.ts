// M10: HUD icons from the asset pipeline (assets/icons/icon.<kind>.<id>_128.png, docs/ASSETS.md). An id
// without an icon returns undefined and the HUD keeps its text glyph.
const files = import.meta.glob("../../../assets/icons/icon.*_128.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const urls = new Map(Object.entries(files).map(([p, u]) => [p.split("/").pop()!.replace(/_128\.png$/, ""), u]));

/** Icon URL for a spell id. */
export const spellIcon = (id: string): string | undefined => urls.get(`icon.spell.${id}`);

/** Icon URL for a building id (a leveled building shows its first level). */
export const buildingIcon = (id: string): string | undefined => urls.get(`icon.building.${id}`) ?? urls.get(`icon.building.${id}_small`);

/** Icon URL for a resource: mana or population. */
export const resourceIcon = (id: "mana" | "population"): string | undefined => urls.get(`icon.resource.${id}`);

/** Every icon id the build found (debug API and tests). */
export const iconIds = (): string[] => [...urls.keys()].sort();

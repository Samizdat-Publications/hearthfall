// Stretch 2 playtest pass: first skirmish tips. One tip at a time sits in the objectives panel; a step is
// done (and skipped, if the player got there first) once its check below passes. Texts are data/ui.json
// tips; the app only reads sim state, so tips never touch the simulation.
import { CAT, type SimEvent, type World } from "@hearthfall/sim";

export type TipId = "dwelling" | "cast" | "lodge" | "train" | "attack" | "win";

export interface TipView {
  id: TipId;
  text: string;
  /** 1-based step and step count, for the "Tip 2 of 6" label */
  step: number;
  of: number;
}

const LODGES = new Set(["watchtower", "warden_lodge", "fire_lodge", "chant_house", "shade_den"]);
const NOT_TROOPS = new Set(["settler", "shaper", "wild", "boat", "balloon"]);
/** game seconds the last tip stays up */
export const LAST_TIP_SECONDS = 45;

export class FirstMatchTips {
  private i = 0;
  private cast = false;
  private attack = false;
  private dwellings0 = -1;
  private lastShown = -1;
  private readonly texts: readonly { id: TipId; text: string }[];

  constructor(texts: readonly { id: TipId; text: string }[]) {
    this.texts = texts;
  }

  /** the local player cast a spell */
  observe(e: SimEvent, me: number): void {
    if (e.type === "spellCast" && e.tribe === me) this.cast = true;
  }

  /** the local player gave an attack-move order */
  attackOrdered(): void {
    this.attack = true;
  }

  get finished(): boolean {
    return this.i >= this.texts.length;
  }

  /** Advance past every step already done and return the current tip, or null once finished. */
  update(w: World, me: number): TipView | null {
    while (!this.finished && this.done(this.texts[this.i].id, w, me)) {
      this.i++;
      this.lastShown = -1;
    }
    if (this.finished) return null;
    const t = this.texts[this.i];
    return { id: t.id, text: t.text, step: this.i + 1, of: this.texts.length };
  }

  private done(id: TipId, w: World, me: number): boolean {
    const c = count(w, me);
    if (this.dwellings0 < 0) this.dwellings0 = c.dwellings;
    switch (id) {
      case "dwelling":
        return c.dwellings > this.dwellings0;
      case "cast":
        return this.cast;
      case "lodge":
        return c.lodges > 0;
      case "train":
        return c.troops >= 3;
      case "attack":
        return this.attack;
      case "win":
        if (this.lastShown < 0) this.lastShown = w.tick;
        return w.tick - this.lastShown >= LAST_TIP_SECONDS * w.cfg.tickHz;
    }
  }
}

function count(w: World, me: number): { dwellings: number; lodges: number; troops: number } {
  const E = w.ents;
  const blds = w.cfg.pack.buildings.buildings;
  const units = w.cfg.pack.units.units;
  let dwellings = 0;
  let lodges = 0;
  let troops = 0;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.tribe[i] !== me) continue;
    if (E.cat[i] === CAT.building) {
      const id = blds[E.type[i]].id;
      if (id === "dwelling") dwellings++;
      else if (LODGES.has(id)) lodges++;
    } else if (E.cat[i] === CAT.unit && !NOT_TROOPS.has(units[E.type[i]].id)) troops++;
  }
  return { dwellings, lodges, troops };
}

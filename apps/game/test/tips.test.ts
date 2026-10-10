// Stretch 2 playtest pass: first skirmish tips advance on game state and skip steps already done.
import { describe, expect, it } from "vitest";
import type { SimEvent } from "@hearthfall/sim";
import { readFileSync } from "node:fs";
import { FirstMatchTips, LAST_TIP_SECONDS } from "../src/tips.ts";
import { world } from "../../../packages/sim/test/helpers.ts";

const texts = (["dwelling", "cast", "lodge", "train", "attack", "win"] as const).map((id) => ({ id, text: id }));
const flat = () => world({ generator: "flat", size: 64, tribes: 2 });

describe("first match tips", () => {
  it("walks the steps in order as the player does each thing", () => {
    const w = flat();
    const tips = new FirstMatchTips(texts);
    expect(tips.update(w, 0)).toMatchObject({ id: "dwelling", step: 1, of: 6 });
    w.spawnBuilding("dwelling", 1, 10, 10); // a rival's Dwelling does not count
    expect(tips.update(w, 0)?.id).toBe("dwelling");
    w.spawnBuilding("dwelling", 0, 20, 20);
    expect(tips.update(w, 0)?.id).toBe("cast");
    tips.observe({ tick: 1, type: "spellCast", tribe: 1, spell: "bolt" } as unknown as SimEvent, 0);
    expect(tips.update(w, 0)?.id).toBe("cast");
    tips.observe({ tick: 1, type: "spellCast", tribe: 0, spell: "bolt" } as unknown as SimEvent, 0);
    expect(tips.update(w, 0)?.id).toBe("lodge");
    w.spawnBuilding("warden_lodge", 0, 26, 20);
    expect(tips.update(w, 0)?.id).toBe("train");
    for (let k = 0; k < 3; k++) w.spawnUnit("warden", 0, 22 + k, 24);
    expect(tips.update(w, 0)?.id).toBe("attack");
    tips.attackOrdered();
    expect(tips.update(w, 0)?.id).toBe("win");
    expect(tips.finished).toBe(false);
    w.tick += LAST_TIP_SECONDS * w.cfg.tickHz;
    expect(tips.update(w, 0)).toBeNull();
    expect(tips.finished).toBe(true);
  });

  it("skips steps the player already did", () => {
    const w = flat();
    const tips = new FirstMatchTips(texts);
    tips.update(w, 0);
    w.spawnBuilding("watchtower", 0, 20, 20);
    tips.attackOrdered();
    w.spawnBuilding("dwelling", 0, 30, 30);
    tips.observe({ tick: 1, type: "spellCast", tribe: 0, spell: "bolt" } as unknown as SimEvent, 0);
    // dwelling and cast done, lodge done (a tower counts), train not yet
    expect(tips.update(w, 0)?.id).toBe("train");
  });

  it("ships a text for every step in data/ui.json", () => {
    const ui = JSON.parse(readFileSync(new URL("../../../data/ui.json", import.meta.url), "utf8")) as { tips?: { id: string; text: string }[] };
    expect(ui.tips?.map((t) => t.id)).toEqual(texts.map((t) => t.id));
    for (const t of ui.tips ?? []) for (const c of [0x2013, 0x2014]) expect(t.text).not.toContain(String.fromCharCode(c));
  });
});

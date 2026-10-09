// Builds the HUD view model from the Game each refresh and maps HUD intents to Commands.
import { hudModel, mountHud, type HudModel, type SpellView } from "@hearthfall/ui";
import "../../../packages/ui/src/hud.css";
import type { Game } from "./game.ts";

const SPELL_KEYS = ["Z", "X", "C", "V", "B", "N", "M"];
const title = (id: string) => id.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function hudFor(game: Game): HudModel {
  const w = game.world;
  const tr = w.tribes[game.localTribe];
  const spells = w.cfg.pack.spells.spells;
  const sv: SpellView[] = [];
  if (tr) {
    const cursor = w.economy.nextSpell(tr.eco);
    let k = 0;
    spells.forEach((s, i) => {
      if (!tr.eco.unlocked[i]) return;
      sv.push({ id: s.id, name: title(s.id), tier: s.tier, cost: s.cost, charges: tr.eco.charges[i], max: s.maxCharges, progress: tr.eco.progress[i] / s.cost, auto: tr.eco.auto[i] === 1, charging: cursor === i, hotkey: SPELL_KEYS[k++] ?? "" });
    });
  }
  const bdefs = w.cfg.pack.buildings.buildings;
  return {
    title: "Hearthfall",
    mapLine: `${w.mapInfo.generator} ${w.terrain.size} seed ${w.seed}`,
    tick: w.tick,
    paused: game.paused,
    pop: tr ? w.economy.followers(tr.index) : 0,
    cap: tr ? w.economy.popCap(tr.index) : 0,
    manaPerMin: tr?.eco.incomePerMin ?? 0,
    spellsPct: tr?.eco.spellsPct ?? 50,
    wasting: tr ? w.economy.nextSpell(tr.eco) < 0 && tr.eco.trainDemand <= 0 : false,
    spells: sv,
    selected: game.selection.size,
    attack: game.attackMode,
    placing: game.placing,
    placeBlocked: game.placeBlocked,
    buildable: bdefs.filter((b) => b.buildable !== false && b.milestone !== "backlog" && b.id === "dwelling").map((b) => ({ id: b.id, name: title(b.id), wood: b.levels?.[0]?.wood ?? b.wood ?? 0, key: "D" })),
    box: game.box,
    showHelp: game.showHelp,
    priorities: tr ? { ...tr.eco.priorities } : { build: 1, upgrade: 1, breed: 1 },
  };
}

export function mountGameHud(el: HTMLElement, game: Game): { refresh: () => void } {
  mountHud(el, {
    setSplit: (pct) => game.command({ tribe: game.localTribe, type: "setSplit", args: { spellsPct: pct } }),
    toggleAuto: (spell) => {
      const w = game.world;
      const i = w.cfg.spellIndex.get(spell);
      const on = i !== undefined && w.tribes[game.localTribe]?.eco.auto[i] === 1;
      game.command({ tribe: game.localTribe, type: "setAutoCharge", args: { spell, on: !on } });
    },
    startPlacing: (b) => game.startPlacing(b),
    cancel: () => game.cancelPlacing(),
    togglePriority: (key) => {
      const p = { ...(game.world.tribes[game.localTribe]?.eco.priorities ?? { build: 1, upgrade: 1, breed: 1 }) };
      p[key] = p[key] > 0 ? 0 : 1;
      game.command({ tribe: game.localTribe, type: "setPriorities", args: p });
    },
  });
  const refresh = () => {
    hudModel.value = hudFor(game);
  };
  refresh();
  return { refresh };
}

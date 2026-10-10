// Builds the HUD view model from the Game each refresh and maps HUD intents to Commands.
import { SPELL_KEYS, hudModel, mountHud, type HudModel, type ObjectiveView, type SpellView, type TroopView } from "@hearthfall/ui";
import "../../../packages/ui/src/hud.css";
import { shaperIndex } from "@hearthfall/sim";
import type { Game } from "./game.ts";
import { drawMinimap } from "./minimap.ts";
import { troopView, undoLeft } from "./troops.ts";
import { etaLabel, spellEtas } from "./eta.ts";
import { buildingIcon, resourceIcon, spellIcon, unitIcon } from "./icons.ts";

/** build tool hotkeys (the rest of the build column is click only) */
const BUILD_KEYS: Record<string, string> = { dwelling: "D", watchtower: "T" };

const title = (id: string) => id.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export function hudFor(game: Game): HudModel {
  const w = game.world;
  const tr = w.tribes[game.localTribe];
  const spells = w.cfg.pack.spells.spells;
  const sv: SpellView[] = [];
  if (tr) {
    const e = tr.eco;
    const cursor = w.economy.nextSpell(e);
    const etas = spellEtas({ costs: spells.map((s) => s.cost), maxCharges: spells.map((s) => s.maxCharges), charges: e.charges, progress: e.progress, auto: e.auto, unlocked: e.unlocked, cursor: e.cursor, incomePerMin: e.incomePerMin, spellsPct: e.spellsPct, trainDemand: e.trainDemand });
    let k = 0;
    spells.forEach((s, i) => {
      // M9: a locked spell shows while it holds charges from a shrine or a level reward
      if (!e.unlocked[i] && e.charges[i] <= 0) return;
      sv.push({ id: s.id, name: title(s.id), tier: s.tier, cost: s.cost, charges: e.charges[i], max: s.maxCharges, progress: e.progress[i] / s.cost, auto: e.auto[i] === 1, charging: cursor === i, hotkey: SPELL_KEYS[k++] ?? "", eta: etaLabel(etas[i]), icon: spellIcon(s.id) });
    });
  }
  const bdefs = w.cfg.pack.buildings.buildings;
  const nextTier = tr ? w.cfg.pack.balance.progression.tiers[tr.eco.tier + 1] : undefined;
  const si = tr ? shaperIndex(w, tr.index) : -1;
  const cursor = tr ? w.economy.nextSpell(tr.eco) : -1;
  const shaperHp = si >= 0 ? w.ents.hp[si] / Math.max(1, w.cfg.pack.units.units[w.ents.type[si]].hp) : 0;
  const respawnSec = tr && tr.alive && tr.respawnAt >= 0 ? Math.max(0, Math.ceil((tr.respawnAt - w.tick) / w.cfg.tickHz)) : -1;
  return {
    title: "Hearthfall",
    mapLine: w.level ? `Campaign: ${w.level.def.name}` : `${w.mapInfo.generator} ${w.terrain.size} seed ${w.seed}`,
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
    targeting: game.targeting,
    buildable: bdefs.filter((b) => b.buildable !== false && b.milestone !== "backlog").map((b) => ({ id: b.id, name: title(b.id), wood: b.levels?.[0]?.wood ?? b.wood ?? 0, stone: b.stone ?? 0, key: BUILD_KEYS[b.id] ?? "", locked: tr ? w.economy.buildingLock(tr.index, w.cfg.buildingIndex.get(b.id)!) : null, icon: buildingIcon(b.id) })),
    icons: { mana: resourceIcon("mana"), pop: resourceIcon("population") },
    objectives: objectivesFor(game, nextTier ? { name: title(nextTier.id), followers: nextTier.followers, opens: nextTier.buildings.map(title) } : null),
    notes: game.notes.filter((n) => n.until > w.tick).map((n) => ({ id: n.id, text: n.text, kind: n.kind })),
    subtitle: game.subtitle && game.subtitle.until > w.tick ? { speaker: game.subtitle.speaker, text: game.subtitle.text } : null,
    box: game.box,
    showHelp: game.showHelp,
    priorities: tr ? { ...tr.eco.priorities } : { build: 1, upgrade: 1, breed: 1 },
    shaper: { alive: si >= 0, respawnSec, hpFrac: Math.min(1, Math.max(0, shaperHp)) },
    manaFrac: tr && cursor >= 0 ? tr.eco.progress[cursor] / spells[cursor].cost : 0,
    troops: withUnitIcons(troopView(w, game.localTribe, [...game.selection], game.selectedBuilding)),
    pointing: game.pointing,
    targetCounts: game.targetCounts,
    undoSec: tr ? undoLeft(w, tr.index) : -1,
  };
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, "0")}`;
const words = (id: string) => id.replace(/_/g, " ");

/** M9: a campaign level's objectives (its own text, else one from the type) and its lose conditions. */
function levelObjectives(game: Game): ObjectiveView[] {
  const w = game.world;
  const lv = w.level!;
  const hz = w.cfg.tickHz;
  const left = (sec: number) => clock(Math.max(0, sec - w.tick / hz));
  const out: ObjectiveView[] = lv.def.objectives.map((o, k) => {
    const done = lv.done[k] === 1;
    const auto =
      o.type === "eliminateAll"
        ? "Defeat every rival tribe"
        : o.type === "worship"
          ? `Worship at the ${words(o.site)}`
          : o.type === "survive"
            ? `Survive ${clock(o.seconds)}${done ? "" : ` (${left(o.seconds)} left)`}`
            : `Reach ${o.n} followers (${w.economy.followers(game.localTribe)})`;
    return { text: o.text ?? auto, done, part: `objective-${k}` };
  });
  (lv.def.lose ?? []).forEach((l, k) => {
    if (l.type === "timeLimit") out.push({ text: `Time left: ${left(l.seconds)}`, done: false, part: `lose-${k}` });
    if (l.type === "hearthLost") out.push({ text: "Keep your Hearth standing", done: false, part: `lose-${k}` });
    if (l.type === "siteLost") out.push({ text: `Do not let a rival claim the ${words(l.site)}`, done: false, part: `lose-${k}` });
  });
  return out;
}

/** BACKLOG 13: the victory variant's progress line (null for conquest, which the rivals line covers). */
export function rulesLine(w: Game["world"], me: number): string | null {
  const r = w.rules;
  if (!r || r.def.type === "conquest") return null;
  const hz = w.cfg.tickHz;
  const goal = r.goalTicks() / hz;
  const rivals = w.tribes.filter((t) => t.index !== me && t.alive);
  if (r.def.type === "lastStand") {
    const best = Math.max(0, ...rivals.map((t) => w.economy.followers(t.index)));
    return `Last Stand ${clock(Math.max(0, goal - w.tick / hz))} left: you ${w.economy.followers(me)}, best rival ${best} followers`;
  }
  const best = Math.max(0, ...rivals.map((t) => r.held[t.index] ?? 0)) / hz;
  const mine = (r.held[me] ?? 0) / hz;
  const what = r.def.type === "holdSites" ? `Hold all ${r.counted().length} Reliquaries` : "Hold the hill";
  return `${what} ${clock(mine)} of ${clock(goal)} (rival ${clock(best)})`;
}

/** Objectives (M8): rivals left in a skirmish, keep the Hearth standing, and the next unlock tier. */
function objectivesFor(game: Game, next: { name: string; followers: number; opens: string[] } | null): ObjectiveView[] {
  const w = game.world;
  const me = w.tribes[game.localTribe];
  const out: ObjectiveView[] = [];
  if (!me) return out;
  if (w.level) return levelObjectives(game);
  if (game.skirmish && w.tribes.length > 1) {
    const rivals = w.tribes.filter((t) => t.index !== me.index);
    const left = rivals.filter((t) => t.alive).length;
    const rl = rulesLine(w, me.index);
    // a victory variant shares the rivals line (conquest still wins under every variant) so the panel keeps its height
    if (rl) out.push({ text: left ? `${rl}, or defeat ${left} ${left === 1 ? "rival" : "rivals"}` : "Every rival tribe has fallen", done: w.rules!.winner === me.index || left === 0, part: "rules" });
    else out.push({ text: left ? `Defeat the rival tribes: ${left} of ${rivals.length} left` : "Every rival tribe has fallen", done: left === 0 });
    out.push({ text: w.ents.index(me.hearth) >= 0 ? "Keep your Hearth standing" : "Your Hearth has fallen: protect your Shaper", done: false });
  }
  if (next) out.push({ text: `Reach ${next.followers} followers for ${next.name} (${next.opens.join(", ")})`, done: false, part: "next-unlock" });
  return out;
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
    drawMinimap: (canvas) => drawMinimap(game, canvas),
    minimapJump: (u, v) => {
      const n = game.world.terrain.size;
      game.renderer.setCamera({ x: u * n, z: v * n });
    },
    target: (spell) => game.startTargeting(spell),
    cancel: () => game.cancelPlacing(),
    train: (n) => game.troop({ kind: "train", n }),
    startRally: () => {
      game.pointing = "rally";
      game.onChange();
    },
    clearRally: () => game.troop({ kind: "rally", at: null }),
    ungarrison: () => game.troop({ kind: "ungarrison" }),
    garrison: () => game.troop({ kind: "garrison" }),
    retreat: () => game.troop({ kind: "retreat" }),
    setStance: (stance) => game.troop({ kind: "stance", stance }),
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

/** BACKLOG 0a: troop chips carry their unit icon (troops.ts stays free of asset imports). */
function withUnitIcons(t: TroopView): TroopView {
  return t.units.length ? { ...t, units: t.units.map((u) => ({ ...u, icon: unitIcon(u.id) })) } : t;
}

// Builds the menu view model from the Game and maps menu intents to game flow calls (M8). The
// setup screen state lives here: it only becomes SkirmishParams when Start is pressed.
import { KEY_ACTIONS, defaultKeymap, keyLabel, menuModel, mountMenus, rebind, t, type Choice, type MenuModel, type SetupPatch } from "@hearthfall/ui";
import "../../../packages/ui/src/menus.css";
import titleArt from "../../../assets/ui/title.webp?url";
import type { Game } from "./game.ts";
import { makeSave, restoreSave, type SkirmishParams } from "./session.ts";
import { levelOpen } from "./campaign.ts";
import { decodeReplay, encodeReplay } from "./replay.ts";
import { statText } from "./achievements.ts";
import { LIGHTING, MINIATURE, PALETTES, WEATHER, QUALITIES, SLOTS, UI_SCALES, deleteSlot, readSlot, slotMeta, storeSettings, writeSlot } from "./storage.ts";

const title = (id: string) => id[0].toUpperCase() + id.slice(1);
const clock = (ticks: number, hz: number) => {
  const s = Math.floor(ticks / hz);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** end screen line for why a campaign level was lost (LevelRuntime reasons) */
const LOST_WHY: Record<string, string> = {
  eliminated: "Your tribe is no more.",
  timeLimit: "Time ran out.",
  siteLost: "A rival tribe claimed the site first.",
  hearthLost: "Your Hearth has fallen.",
  outplayed: "A rival tribe won the day first.",
};

/** BACKLOG 13: end screen lines for a skirmish decided by the sim rules (won, lost) */
const RULES_WHY: Record<string, [string, string]> = {
  conquest: ["Every rival tribe has fallen.", "A rival tribe conquered the planet."],
  holdSites: ["You held every Reliquary.", "A rival tribe held every Reliquary."],
  kingOfHill: ["You held the hill.", "A rival tribe held the hill."],
  lastStand: ["Your tribe was the largest when time ran out.", "A rival tribe was larger when time ran out."],
  eliminated: ["", "Your tribe is no more."],
};

/** generator limit: TRIBE_COLORS has four entries */
const MAX_TRIBES = 4;

interface SetupState {
  map: string;
  size: number;
  seed: number;
  opponents: string[];
  difficulty: string;
  victory: string;
  /** BACKLOG 11: "on" starts the match with a Forge phase */
  forge: string;
  weather: string;
  /** stretch 2: the player's trait id, "" for none */
  trait: string;
  error: string | null;
}

export function mountGameMenus(el: HTMLElement, game: Game): { refresh: () => void } {
  const sk = game.ui.skirmish;
  const ai = game.pack.files.ai;
  const vic = game.pack.files.balance.victory;
  const setup: SetupState = { map: sk.maps[0], size: sk.defaultSize, seed: 1, opponents: [...sk.defaultOpponents], difficulty: sk.defaultDifficulty, victory: vic?.default ?? "", forge: "off", weather: "clear", trait: "", error: null };
  const saves = { mode: "load" as "save" | "load", message: null as string | null };
  let settingsMsg: string | null = null;
  /** BACKLOG 19: why the last replay file or stored replay could not be watched */
  let replayMsg: string | null = null;
  const maxOpponents = Math.min(sk.maxOpponents, MAX_TRIBES - 1);

  const persistNote = () => (game.persistent ? null : "Browser storage is unavailable: settings and saves last until this tab closes.");
  const saveSettings = () => {
    if (!storeSettings(game.kv, game.settings)) settingsMsg = "Could not store settings in this browser.";
  };

  const model = (): MenuModel => {
    const hz = game.world.cfg.tickHz;
    const w = game.world;
    const me = w.tribes[game.localTribe];
    const opts = (ids: readonly string[], label = title): Choice[] => ids.map((v) => ({ value: v, label: label(v) }));
    return {
      screen: game.screen,
      mods: game.mods.map((m) => `${m.name} ${m.version}`),
      setup: {
        maps: opts(sk.maps),
        sizes: sk.mapSizes.map((n) => ({ value: String(n), label: `${n} (${n <= 96 ? "small" : n <= 128 ? "medium" : "large"})` })),
        personalities: opts(ai.personalities.map((p) => p.id)),
        difficulties: opts(ai.difficulties.map((d) => d.id)),
        maxOpponents,
        map: setup.map,
        size: setup.size,
        seed: setup.seed,
        opponents: setup.opponents,
        difficulty: setup.difficulty,
        victories: (vic?.variants ?? []).map((v) => ({ value: v.id, label: v.name })),
        victory: setup.victory,
        victoryText: vic?.variants.find((v) => v.id === setup.victory)?.text ?? "",
        forges: game.pack.files.balance.forge ? [{ value: "off", label: "Off" }, { value: "on", label: `On (${Math.round(game.pack.files.balance.forge.seconds / 60)} min)` }] : [],
        forge: setup.forge,
        // BACKLOG 14b: rain slows every unit (balance.weather.rain)
        weathers: game.pack.files.balance.weather ? [{ value: "clear", label: t("setup.weatherClear") }, { value: "rain", label: t("setup.weatherRain", { pct: Math.round((1 - game.pack.files.balance.weather.rain.speedMult) * 100) }) }] : [],
        weather: setup.weather,
        traits: game.pack.files.balance.traits?.length ? [{ value: "", label: t("setup.traitNone") }, ...game.pack.files.balance.traits.map((x) => ({ value: x.id, label: `${x.name}: ${x.desc}` }))] : [],
        trait: setup.trait,
        error: setup.error,
      },
      settings: {
        qualities: opts(QUALITIES),
        quality: game.settings.quality,
        master: game.settings.master,
        music: game.settings.music,
        sfx: game.settings.sfx,
        keys: KEY_ACTIONS.map((a) => ({ id: a.id, label: a.label, key: game.settings.keymap[a.id] })),
        palettes: opts(PALETTES, (v) => (v === "colorblind" ? "Colorblind safe" : "Default")),
        palette: game.settings.palette,
        uiScales: opts(UI_SCALES.map(String), (v) => `${v}%`),
        uiScale: String(game.settings.uiScale),
        subtitles: game.settings.subtitles ? "on" : "off",
        tips: game.settings.tips ? "on" : "off",
        miniatures: opts(MINIATURE, (v) => (v === "default" ? "Default" : v === "on" ? "On" : "Off")),
        miniature: game.settings.miniature,
        lightings: opts(LIGHTING, (v) => (v === "default" ? "Default" : v[0].toUpperCase() + v.slice(1))),
        lighting: game.settings.lighting,
        weathers: opts(WEATHER, (v) => (v === "clear" ? "Clear" : "Rain")),
        weather: game.settings.weather,
        rebinding: game.rebinding,
        message: settingsMsg ?? (game.params.quality ? `Quality is set by the URL (${game.params.quality}) for this session.` : persistNote()),
      },
      saves: {
        mode: saves.mode,
        slots: Array.from({ length: SLOTS }, (_, k) => {
          const m = slotMeta(game.kv, k + 1);
          return m
            ? { slot: k + 1, empty: false, label: `Slot ${k + 1}: ${m.map}`, detail: `${m.opponents}, ${clock(m.tick, hz)} in, saved ${new Date(m.savedAt).toLocaleString()}` }
            : { slot: k + 1, empty: true, label: `Slot ${k + 1}`, detail: "Empty" };
        }),
        message: saves.message ?? persistNote(),
      },
      end: game.ended
        ? {
            won: game.ended.won,
            ...(w.level
              ? {
                  title: game.ended.won ? "Level won" : "Level lost",
                  tag: game.ended.won ? `${w.level.def.name} is yours.${game.nextLevelId() ? "" : " The campaign is complete."}` : (LOST_WHY[game.ended.why ?? ""] ?? "Your tribe is no more."),
                }
              : game.ended.why && RULES_WHY[game.ended.why]
                ? { tag: RULES_WHY[game.ended.why][game.ended.won ? 0 : 1] }
                : {}),
            lines: [
              { label: "Time", value: clock(w.tick, hz) },
              { label: "Followers", value: String(me ? w.economy.followers(me.index) : 0) },
              w.level
                ? { label: "Objectives", value: `${w.level.done.filter((d) => d === 1).length} of ${w.level.done.length}` }
                : { label: "Rivals out", value: `${w.tribes.filter((t) => t.index !== game.localTribe && !t.alive).length} of ${w.tribes.length - 1}` },
              { label: "Foes defeated", value: String(game.stats.kills) },
              { label: "Units lost", value: String(game.stats.lost) },
            ],
            next: game.ended.won && game.nextLevelId() !== null,
            achievements: game.newAchievements.map((a) => ({ name: a.name, description: a.description })),
          }
        : null,
      campaign: {
        levels: game.levels.map((l) => ({ id: l.id, name: l.name, description: l.description, open: levelOpen(game.levels, game.campaignWon, l.id), won: game.campaignWon.includes(l.id) })),
        message: game.persistent ? null : "Browser storage is unavailable: campaign progress lasts until this tab closes.",
      },
      titleArt,
      canSave: game.inGame && game.skirmish !== null && !game.ended,
      editorTest: game.editorTest,
      records:
        game.screen === "records"
          ? {
              rows: game.achievements.records.map((r) => ({ label: r.label, value: statText(r.stat, game.records.career[r.stat]) })),
              achievements: game.achievements.achievements.map((a) => ({ id: a.id, name: a.name, description: a.description, earned: game.records.unlocked[a.id] ? new Date(game.records.unlocked[a.id]).toLocaleDateString() : null })),
              summary: `${game.achievements.achievements.filter((a) => game.records.unlocked[a.id]).length} of ${game.achievements.achievements.length} achievements earned`,
              message: game.persistent ? null : "Browser storage is unavailable: records last until this tab closes.",
            }
          : undefined,
      replay: { last: game.screen === "main" && game.hasStoredReplay(), ended: game.lastReplay !== null && game.ended !== null, message: replayMsg },
    };
  };

  const refresh = () => {
    menuModel.value = model();
  };

  const start = () => {
    const seed = Math.floor(Number(setup.seed));
    if (!Number.isFinite(seed) || seed < 1) {
      setup.error = "Seed must be a whole number of 1 or more.";
      return refresh();
    }
    if (!setup.opponents.length) {
      setup.error = "Add at least one opponent.";
      return refresh();
    }
    setup.error = null;
    const sp: SkirmishParams = { seed, level: setup.map, size: setup.size, tribes: 1 + setup.opponents.length, ai: [...setup.opponents], difficulty: setup.difficulty, ...(setup.victory ? { rules: setup.victory } : {}), ...(setup.forge === "on" ? { forge: true } : {}), ...(setup.weather === "rain" ? { weather: "rain" as const } : {}), ...(setup.trait ? { trait: setup.trait } : {}) };
    try {
      game.startSkirmish(sp);
    } catch (e) {
      // only the planet generator's give-up is a player-facing setup problem; anything else is a bug
      if (!/planet generator failed/.test(String((e as Error)?.message ?? e))) throw e;
      setup.error = "This map could not be generated with these settings. Try another seed, a larger map or fewer opponents.";
      refresh();
    }
  };

  game.onRebindKey = (e) => {
    const action = game.rebinding;
    if (!action) return;
    if (e.key === "Escape") {
      game.rebinding = null;
      settingsMsg = null;
      return refresh();
    }
    const label = keyLabel(e);
    if (!label) return;
    const r = rebind(game.settings.keymap, action, label);
    game.rebinding = null;
    settingsMsg = r.error;
    if (!r.error) {
      game.settings = { ...game.settings, keymap: r.keymap };
      saveSettings();
    }
    refresh();
  };

  mountMenus(el, {
    go: (s) => game.go(s),
    back: () => game.menuBack(),
    setSetup: (p: SetupPatch) => {
      Object.assign(setup, p);
      if (setup.opponents.length > maxOpponents) setup.opponents = setup.opponents.slice(0, maxOpponents);
      setup.error = null;
      refresh();
    },
    randomSeed: () => {
      setup.seed = 1 + Math.floor(Math.random() * 99999);
      refresh();
    },
    start,
    resume: () => game.resume(),
    openSaves: (mode) => {
      saves.mode = mode;
      saves.message = null;
      game.go("saves");
    },
    saveSlot: (n) => {
      const sp = game.skirmish;
      if (!sp || !game.inGame || game.ended) {
        saves.message = "Only a skirmish or campaign level in progress can be saved.";
        return refresh();
      }
      const s = makeSave(game.world, sp, game.log, game.pendingCommands(), new Date().toISOString(), game.stats);
      const err = writeSlot(game.kv, n, s);
      if (!err) game.lastSave = { tick: s.tick, hash: s.hash };
      saves.message = err ?? `Saved to slot ${n}.`;
      refresh();
    },
    loadSlot: (n) => {
      try {
        const s = readSlot(game.kv, n);
        game.adoptSave(restoreSave(game.pack, s), s);
        saves.message = null;
      } catch (e) {
        saves.message = `Could not load slot ${n}: ${(e as Error).message}`;
        refresh();
      }
    },
    deleteSlot: (n) => {
      deleteSlot(game.kv, n);
      saves.message = `Slot ${n} deleted.`;
      refresh();
    },
    setSetting: (p) => {
      game.settings = { ...game.settings, ...p } as typeof game.settings;
      if (p.quality || p.miniature || p.lighting || p.weather) game.applyQuality();
      if (p.palette !== undefined || p.uiScale !== undefined) game.applyA11y();
      game.player.setVolumes(game.settings);
      settingsMsg = null;
      saveSettings();
      refresh();
    },
    startRebind: (action) => {
      game.rebinding = action as typeof game.rebinding;
      settingsMsg = "Press a key, or Escape to keep the old one.";
      refresh();
    },
    resetKeys: () => {
      game.settings = { ...game.settings, keymap: defaultKeymap() };
      game.rebinding = null;
      settingsMsg = "Keys reset to the defaults.";
      saveSettings();
      refresh();
    },
    quitToMenu: () => (game.editorTest ? game.openEditor() : game.showMainMenu()),
    openEditor: () => game.openEditor(),
    playAgain: () => {
      if (game.skirmish) game.startSkirmish(game.skirmish);
    },
    watchReplay: (which) => {
      const r = which === "ended" ? game.lastReplay : game.storedReplay();
      replayMsg = r ? null : game.hasStoredReplay() ? "The last replay cannot be played with this version of the game." : "There is no replay to watch.";
      try {
        if (r) return game.watchReplay(r);
      } catch (e) {
        replayMsg = `Could not play the replay: ${(e as Error).message}.`;
      }
      refresh();
    },
    downloadReplay: () => {
      const r = game.lastReplay;
      if (!r) return;
      const url = URL.createObjectURL(new Blob([encodeReplay(r)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `hearthfall-replay-${r.params.level}-${r.params.seed}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    openReplayFile: (text) => {
      try {
        game.watchReplay(decodeReplay(text, game.pack));
        replayMsg = null;
      } catch (e) {
        replayMsg = `Could not open the replay: ${(e as Error).message}.`;
        refresh();
      }
    },
    playLevel: (id) => game.playLevel(id),
    nextLevel: () => {
      const id = game.nextLevelId();
      if (id) game.playLevel(id);
    },
  });
  refresh();
  return { refresh };
}

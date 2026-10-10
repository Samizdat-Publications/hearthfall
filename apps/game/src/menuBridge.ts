// Builds the menu view model from the Game and maps menu intents to game flow calls (M8). The
// setup screen state lives here: it only becomes SkirmishParams when Start is pressed.
import { SKIRMISH_DEFAULTS } from "@hearthfall/data";
import { KEY_ACTIONS, defaultKeymap, keyLabel, menuModel, mountMenus, rebind, type Choice, type MenuModel, type SetupPatch } from "@hearthfall/ui";
import "../../../packages/ui/src/menus.css";
import type { Game } from "./game.ts";
import { makeSave, restoreSave, type SkirmishParams } from "./session.ts";
import { levelOpen } from "./campaign.ts";
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
};

/** generator limit: TRIBE_COLORS has four entries */
const MAX_TRIBES = 4;

interface SetupState {
  map: string;
  size: number;
  seed: number;
  opponents: string[];
  difficulty: string;
  error: string | null;
}

export function mountGameMenus(el: HTMLElement, game: Game): { refresh: () => void } {
  const sk = game.pack.files.balance.skirmish ?? SKIRMISH_DEFAULTS;
  const ai = game.pack.files.ai;
  const setup: SetupState = { map: sk.maps[0], size: sk.defaultSize, seed: 1, opponents: [...sk.defaultOpponents], difficulty: sk.defaultDifficulty, error: null };
  const saves = { mode: "load" as "save" | "load", message: null as string | null };
  let settingsMsg: string | null = null;
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
          }
        : null,
      campaign: {
        levels: game.levels.map((l) => ({ id: l.id, name: l.name, description: l.description, open: levelOpen(game.levels, game.campaignWon, l.id), won: game.campaignWon.includes(l.id) })),
        message: game.persistent ? null : "Browser storage is unavailable: campaign progress lasts until this tab closes.",
      },
      canSave: game.inGame && game.skirmish !== null && !game.ended,
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
    const sp: SkirmishParams = { seed, level: setup.map, size: setup.size, tribes: 1 + setup.opponents.length, ai: [...setup.opponents], difficulty: setup.difficulty };
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
      const s = makeSave(game.world, sp, game.log, game.pendingCommands(), new Date().toISOString());
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
    quitToMenu: () => game.showMainMenu(),
    playAgain: () => {
      if (game.skirmish) game.startSkirmish(game.skirmish);
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

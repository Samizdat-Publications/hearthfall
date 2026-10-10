// Game wiring: data pack + sim World + renderer + input + the window.__game debug API.
// The sim advances at a fixed tickHz with an accumulator; in fixedStep mode it advances only through
// step(n), and every time-driven visual reads the frame counter, so captures are deterministic.
// M8: the game flow (main menu, skirmish, pause, saves, settings, end screen) is a `screen` here; the
// sim only runs while no menu screen is up. menuBridge.ts turns this state into the menu view model.
// M9: campaign levels (data/levels) run as sessions too; the level runtime decides the end.
import { leadInWarning, orderNote } from "./orderNotes.ts";
import type { SessionRole } from "./netGate.ts";
import {
  validateUi,
  type UiFile,
  applyMods,
  parseModList,
  validateAchievements,
  validateLevel,
  validatePack,
  type AchievementDef,
  type AchievementsFile,
  type LevelDef,
  type ValidatedPack,
} from "@hearthfall/data";
import {
  CAT,
  OUTCOME,
  World,
  commandsByTick,
  createScenarioWorld,
  shaperIndex,
  wrapDelta,
  type Command,
  type ScenarioDef,
  type SimEvent,
} from "@hearthfall/sim";
import {
  aliasModels,
  ThreeRenderer,
  type CameraState,
} from "@hearthfall/render";
import { makeBot } from "@hearthfall/ai";
import { EDITOR_TOOLS, applyTool, draftIssues, draftJson, loadDraft, newDraft, previewWorld, setField, setGoal, setOpponent, storeDraft, type EditorGoal, type EditorTool } from "./editor.ts";
import { DEFAULT_AI } from "./opponents.ts";
import {
  actionFor,
  spellSlot,
  type KeyAction,
  type Screen,
} from "@hearthfall/ui";
import {
  LOG_TAIL,
  campaignParams,
  createSkirmish,
  type SaveGame,
  type SkirmishParams,
} from "./session.ts";
import {
  campaignCarry,
  levelOpen,
  loadLearned,
  loadProgress,
  nextLevel,
  ordered,
  recordWin,
  taughtSpells,
} from "./campaign.ts";
import { emptyStats, loadRecords, statsFrom, noteEvent, recordMatch, storeRecords, type Records, type Stats } from "./achievements.ts";
import { REPLAY_KEY, ReplayRun, decodeReplay, encodeReplay, makeReplay, type Replay } from "./replay.ts";
import {
  browserKV,
  loadSettings,
  type KV,
  type Settings,
} from "./storage.ts";
import { AudioHooks, MusicDirector, WebAudioPlayer } from "@hearthfall/audio";
import {
  areaCounts,
  buildingAt,
  groupCenter,
  rallyMarker,
  sameTypeNear,
  siteAt,
  troopCommand,
  type TroopIntent,
  vehicleCommand,
} from "./troops.ts";

const packFiles = import.meta.glob("../../../data/base/*.json", {
  eager: true,
  import: "default",
});
// BACKLOG 18 (ADR-021): mod packs under mods/<id>/, applied with ?mods=a,b
const modFiles = import.meta.glob("../../../mods/*/*.json", {
  eager: true,
  import: "default",
});
const scenarioFiles = import.meta.glob("../../../scenarios/*.json", {
  eager: true,
  import: "default",
});
const levelFiles = import.meta.glob("../../../data/levels/*.json", {
  eager: true,
  import: "default",
});
const achievementFiles = import.meta.glob("../../../data/achievements.json", {
  eager: true,
  import: "default",
});
// BACKLOG 78 (ADR-022): menu defaults and HUD tunables, outside the pack hash
const uiFiles = import.meta.glob("../../../data/ui.json", {
  eager: true,
  import: "default",
});
// M10: real GLB models by id (assets/models/<id>.glb); bake-off candidates are not game content
const modelFiles = import.meta.glob(
  ["../../../assets/models/*.glb", "!../../../assets/models/*bakeoff*"],
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;
// M10: audio clips by id (assets/audio/<id>.ogg, indexed in assets/audio/index.json)
/** photo mode draws no selection rings */
const NO_SELECTION: ReadonlySet<number> = new Set();
const audioFiles = import.meta.glob("../../../assets/audio/*.ogg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export const AUDIO_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(audioFiles).map(([p, u]) => [
    p
      .split("/")
      .pop()!
      .replace(/\.ogg$/, ""),
    u,
  ]),
);
export const MODEL_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(modelFiles).map(([p, u]) => [
    p
      .split("/")
      .pop()!
      .replace(/\.glb$/, ""),
    u,
  ]),
);

/** BACKLOG 18: the mods applied to the loaded pack (id, name, version), in load order */
export const activeMods: { id: string; name: string; version: string }[] = [];

export function loadPack(): ValidatedPack {
  let raw: Record<string, unknown> = {};
  for (const [path, json] of Object.entries(packFiles))
    raw[path.split("/").pop()!] = json;
  const want = parseModList(
    typeof location === "undefined"
      ? null
      : new URLSearchParams(location.search).get("mods"),
  );
  if (want.length) {
    const mods = want.map((id) => {
      const files: Record<string, unknown> = {};
      for (const [path, json] of Object.entries(modFiles)) {
        const parts = path.split("/");
        if (parts[parts.length - 2] === id) files[parts[parts.length - 1]] = json;
      }
      if (!Object.keys(files).length)
        throw new Error(`mod "${id}" not found under mods/`);
      return { id, files };
    });
    const merged = applyMods(raw, mods);
    if (merged.issues.length)
      throw new Error(
        "mods invalid: " +
          merged.issues
            .slice(0, 3)
            .map((i) => `${i.mod}/${i.file} ${i.message}`)
            .join("; "),
      );
    for (const c of merged.conflicts)
      console.warn(`mod conflict ${c.path}: ${c.mods.join(" then ")}`);
    activeMods.splice(0, activeMods.length, ...merged.applied);
    raw = merged.raw;
  }
  const res = validatePack(raw);
  if (!res.pack)
    throw new Error(
      "data pack invalid: " +
        res.issues
          .slice(0, 3)
          .map((i) => `${i.file} ${i.path} ${i.message}`)
          .join("; "),
    );
  return res.pack;
}

/** Campaign levels in order; a level that fails validation is a build bug (the data guard checks them too). */
export function loadLevels(pack: ValidatedPack): LevelDef[] {
  const out: LevelDef[] = [];
  for (const [path, json] of Object.entries(levelFiles)) {
    const res = validateLevel(json, pack.files, path.split("/").pop());
    if (!res.level)
      throw new Error(
        "level invalid: " +
          res.issues
            .slice(0, 3)
            .map((i) => `${i.file} ${i.path} ${i.message}`)
            .join("; "),
      );
    out.push(res.level);
  }
  return ordered(out);
}

/** BACKLOG 21: achievements and the records screen layout; an invalid file is a build bug (the data guard checks it too). */
export function loadAchievementDefs(pack: ValidatedPack): AchievementsFile {
  const res = validateAchievements(Object.values(achievementFiles)[0], pack.files);
  if (!res.file) throw new Error("achievements invalid: " + res.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join("; "));
  return res.file;
}

/** BACKLOG 78: data/ui.json (menu defaults, HUD and input tunables); an invalid file is a build bug (the data guard checks it too). */
export function loadUiDefs(pack: ValidatedPack): UiFile {
  const res = validateUi(Object.values(uiFiles)[0], pack.files);
  if (!res.file) throw new Error("ui.json invalid: " + res.issues.slice(0, 3).map((i) => `${i.path} ${i.message}`).join("; "));
  return res.file;
}

export function findScenario(id: string): ScenarioDef | undefined {
  for (const json of Object.values(scenarioFiles))
    if ((json as ScenarioDef).id === id) return json as ScenarioDef;
  return undefined;
}

export interface GameParams {
  seed: number;
  level: string;
  size: number;
  tribes: number;
  scenario: string | null;
  camera: string | null;
  paused: boolean;
  fixedStep: boolean;
  debug: boolean;
  /** render quality override (high, medium, low); null uses the stored setting */
  quality: string | null;
  /** start on the main menu: no URL params at all, or menu=1 (any other params boot straight into play) */
  menu: boolean;
  /** opponent controller per non-local tribe in order: a personality id, "economy" or "none" (cycled) */
  ai: string[];
  difficulty: string;
  /** BACKLOG 13: victory variant (rules=hold_sites); null uses balance.victory.default */
  rules: string | null;
  /** M9: boot straight into this campaign level (shots and debugging; ignores campaign progress) */
  campaign: string | null;
  /** M10: load the real GLB models (models=0 keeps the procedural placeholders) */
  models: boolean;
  /** BACKLOG 3: reveal=1 draws the whole map through the fog of war (render only; the sim and AI keep it) */
  reveal: boolean;
  /** BACKLOG 8: tribe palette and HUD scale overrides (palette=colorblind, uiScale=125); null uses the stored setting */
  palette: string | null;
  uiScale: number | null;
  /** BACKLOG 14a: tilt-shift override (off, on, pre, post); null uses the stored setting */
  tiltshift: string | null;
  /** BACKLOG 14: lighting preset and weather overrides; null uses the stored setting */
  lighting: string | null;
  weather: string | null;
  /** retro pixel size override for look comparisons (pixel=2); null uses style.json */
  pixel: number | null;
}

export function parseParams(search: string): GameParams {
  const q = new URLSearchParams(search);
  const num = (k: string, d: number) =>
    q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d;
  return {
    seed: num("seed", 1),
    level: q.get("level") ?? "continents",
    size: num("size", 128),
    tribes: num("tribes", 2),
    scenario: q.get("scenario"),
    camera: q.get("camera"),
    paused: q.get("paused") === "1",
    fixedStep: q.get("fixedStep") === "1",
    debug: q.get("debug") === "1",
    quality: q.get("quality"),
    menu: [...q.keys()].length === 0 || q.get("menu") === "1",
    ai: q.get("ai") ? q.get("ai")!.split(",").filter(Boolean) : DEFAULT_AI,
    difficulty: q.get("difficulty") ?? "normal",
    rules: q.get("rules"),
    campaign: q.get("campaign"),
    models: q.get("models") !== "0",
    reveal: q.get("reveal") === "1",
    palette: q.get("palette"),
    uiScale: q.has("uiScale") ? num("uiScale", 100) : null,
    tiltshift: q.get("tiltshift"),
    lighting: q.get("lighting"),
    weather: q.get("weather"),
    pixel: q.has("pixel") ? num("pixel", 3) : null,
  };
}

export interface Note {
  id: number;
  text: string;
  kind: "good" | "bad" | "info";
  /** tick the note disappears */
  until: number;
}


export interface DebugFlags {
  hideTerrain?: boolean;
  blackCanvas?: boolean;
  magentaMaterials?: boolean;
  overlapHud?: boolean;
  freezeCamera?: boolean;
}

export class Game {
  readonly pack = loadPack();
  /** BACKLOG 18: the mods merged into `pack` (?mods=), in load order */
  get mods(): readonly { id: string; name: string; version: string }[] {
    return activeMods;
  }
  readonly levels = loadLevels(this.pack);
  /** campaign levels won (browser storage; this session only when storage is unavailable) */
  campaignWon: string[] = [];
  /** BACKLOG 9: spells each won level taught in play, carried into later levels */
  campaignLearned: Record<string, string[]> = {};
  world!: World;
  readonly renderer: ThreeRenderer;
  params: GameParams;
  /** BACKLOG 46: every session hosts until network play exists; a peer gets no debug hook */
  readonly role: SessionRole = "host";
  paused: boolean;
  private queue: Command[] = [];
  private scenarioCmds: ((tick: number) => Command[]) | null = null;
  private acc = 0;
  private last = 0;
  private keys = new Set<string>();
  bookmarks: (CameraState | null)[] = [null, null, null, null];
  debugFlags: DebugFlags = {};
  /** local player selection (entity indices, UI state only) and control groups of entity ids */
  selection = new Set<number>();
  groups: number[][] = Array.from({ length: 10 }, () => []);
  attackMode = false;
  /** box select rectangle in screen pixels while dragging (for the HUD overlay) */
  box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  readonly localTribe = 0;
  /** building id being placed (ghost follows the cursor), and why the current spot is blocked */
  placing: string | null = null;
  /** BACKLOG 11: the Forge brush in hand and why it cannot land under the cursor ("" when it can) */
  forgeBrush = "raise";
  forgeBlocked = "";
  private forgeShown = false;
  placeBlocked: string | null = null;
  private placeAt: [number, number] | null = null;
  showHelp = true;
  /** Parking lot: photo mode hides the HUD, selection and markers and pauses the match; the camera stays free */
  photo = false;
  private photoWasPaused = false;
  /** last saved photo file name (e2e and the hint line) */
  photoSaved = "";
  /** spell id being targeted (preview follows the cursor) */
  targeting: string | null = null;
  /** BACKLOG 4: units under the spell preview (enemies the tribe can see, and its own) */
  targetCounts: { enemies: number; own: number } | null = null;
  private lastGroupKey = { g: -1, at: 0 };
  /** M6: selected own building index (lodge or tower panel), -1 for none; "rally" while picking a rally point */
  selectedBuilding = -1;
  pointing: string | null = null;
  private events: SimEvent[] = [];
  /** combat and world events to audio cues, played by `player` (cues without a clip are silent stubs) */
  readonly audio: AudioHooks;
  /** M10 Web Audio playback; silent until the first user gesture (browser autoplay rules) */
  readonly player: WebAudioPlayer;
  readonly music = new MusicDirector();
  private selKey = "";
  private ackFlip = 0;
  private lastCastVoice = -1e9;
  onChange: () => void = () => {};

  readonly canvas: HTMLCanvasElement;

  // ---- M8 game flow
  screen: Screen = "none";
  /** BACKLOG 12: the map editor (null outside it); the world is then the draft's preview and the sim does not step */
  editor: { draft: LevelDef; undo: LevelDef[]; tool: EditorTool; tribe: number; issues: string[]; note: string | null } | null = null;
  /** the running level is an editor playtest: it records no campaign win and quitting returns to the editor */
  editorTest = false;
  /** screens to return to with Back or Escape */
  backStack: Screen[] = [];
  /** true while a match is loaded (pause menu, saving); false on the main menu backdrop */
  inGame = true;
  /** the running skirmish (null for scenarios and the menu backdrop): what a save rebuilds from */
  skirmish: SkirmishParams | null = null;
  /** local commands applied so far this session (tail kept), stored in saves */
  log: Command[] = [];
  ended: { won: boolean; why?: string } | null = null;
  /** BACKLOG 21: this match's stats for the local tribe, counted from the event log */
  stats: Stats = emptyStats();
  /** BACKLOG 21: career records and earned achievements (browser storage) and their definitions */
  records: Records;
  readonly achievements: AchievementsFile;
  /** BACKLOG 78: data/ui.json */
  readonly ui: UiFile;
  /** BACKLOG 21: achievements the match that just ended earned (end screen) */
  newAchievements: AchievementDef[] = [];
  /** BACKLOG 19: every local command this session with the tick it ran in (the save log keeps only a tail) */
  replayLog: Command[] = [];
  /** BACKLOG 19: the save this session was loaded from; its replay starts there */
  replayStart: SaveGame | null = null;
  /** BACKLOG 19: the replay being watched (null in a normal session); seekTo is a pending seek tick or -1 */
  replay: { run: ReplayRun; speed: number; follow: boolean; seekTo: number; verified: boolean | null } | null = null;
  /** BACKLOG 19: the replay of the match that just ended (end screen Watch and Download) */
  lastReplay: Replay | null = null;
  readonly kv: KV;
  readonly persistent: boolean;
  settings: Settings;
  /** key action waiting for its new key in the settings screen */
  rebinding: KeyAction | null = null;
  /** set by the menu bridge while a key binding waits for its key */
  onRebindKey: ((e: KeyboardEvent) => void) | null = null;
  /** HUD notifications (sim ticks, so fixedStep captures see the same list); newest last */
  notes: Note[] = [];
  /** BACKLOG 8: the UI scale setting as a factor (the HUD may run smaller to fit the window, see hudFit.ts) */
  uiScaleWanted = 1;
  /** BACKLOG 8: tribe color name to hex for the current palette setting */
  tribePal: Record<string, string> = {};
  /** BACKLOG 8: the last voice line's subtitle, shown until the tick `until` */
  subtitle: { speaker: string; text: string; until: number } | null = null;
  private noteSeq = 0;
  /** BACKLOG 45: entity id to the tick of the player's last move order for it */
  private ordered = new Map<number, number>();
  private noteLast = new Map<string, number>();
  lastSave: { tick: number; hash: string } | null = null;
  lastLoad: { tick: number; hash: string } | null = null;

  constructor(canvas: HTMLCanvasElement, params: GameParams) {
    this.canvas = canvas;
    this.params = params;
    this.paused = params.paused || params.fixedStep;
    this.renderer = new ThreeRenderer({
      canvas,
      style: this.pack.files.style,
      heightUnitsPerWorldUnit:
        this.pack.files.balance.terrain.heightUnitsPerWorldUnit,
    });
    // the game never waits for models: placeholders draw until they arrive
    if (params.models)
      void this.renderer
        .loadModels(
          aliasModels(MODEL_URLS, this.pack.files.style.render?.modelAlias),
        )
        .then(() => this.onChange())
        .catch((e: unknown) =>
          console.warn("model layers kept their placeholders:", e),
        );
    const store = browserKV();
    this.kv = store.kv;
    this.persistent = store.persistent;
    this.settings = loadSettings(this.kv);
    this.player = new WebAudioPlayer(
      new Map(Object.entries(AUDIO_URLS)),
      this.settings,
    );
    const st = this.pack.files.style.audio;
    this.audio = new AudioHooks(
      st?.cues ?? {},
      new Set(Object.keys(AUDIO_URLS)),
      (p) => this.player.play(p.cue, p.x, p.y),
      st?.alias ?? {},
    );
    this.campaignWon = loadProgress(this.kv);
    this.campaignLearned = loadLearned(this.kv);
    this.achievements = loadAchievementDefs(this.pack);
    this.ui = loadUiDefs(this.pack);
    this.records = loadRecords(this.kv);
    this.applyQuality();
    this.applyA11y();
    if (params.campaign && !params.scenario)
      this.playLevel(params.campaign, true);
    else if (params.menu && !params.scenario) this.showMainMenu();
    else this.load();
    this.bindInput();
  }

  /** Render scale from the URL override or the stored setting. */
  applyQuality(): void {
    const q = this.params.quality ?? this.settings.quality;
    this.renderer.setRenderScale(this.ui.qualityScale[q as keyof UiFile["qualityScale"]] ?? 1);
    if (this.params.pixel !== null)
      this.renderer.setPixelScale(this.params.pixel);
    this.renderer.setTiltShift(
      this.params.tiltshift ?? this.settings.miniature,
    );
    this.renderer.setLighting(
      this.params.lighting ?? this.settings.lighting,
      // BACKLOG 14b: a rainy match always shows its rain
      this.world?.weather === "rain" ? "rain" : (this.params.weather ?? this.settings.weather),
    );
  }

  /**
   * BACKLOG 8: tribe colors (colorblind palette) and HUD scale from the URL override or the stored
   * setting. The renderer rebuilds its entity layers; the minimap reads `tribePal`.
   */
  applyA11y(): void {
    const style = this.pack.files.style;
    const id = this.params.palette ?? this.settings.palette;
    const over = style.tribePalettes?.[id] ?? null;
    this.tribePal = { ...style.palette, ...(over ?? {}) };
    this.renderer.setTribeColors(over);
    const scale = Math.min(
      2,
      Math.max(0.5, (this.params.uiScale ?? this.settings.uiScale) / 100),
    );
    this.uiScaleWanted = scale;
    if (typeof document !== "undefined")
      document.documentElement.style.setProperty("--ui-scale", String(scale));
  }

  /** BACKLOG 8: play a voice cue and, with subtitles on, show its line (style.json subtitles) for a few seconds. */
  private voice(cue: string): void {
    this.player.play(cue);
    const sub = this.settings.subtitles
      ? this.pack.files.style.subtitles?.[cue]
      : undefined;
    if (sub)
      this.subtitle = {
        speaker: sub.speaker,
        text: sub.text,
        until: this.world.tick + this.ui.notes.subtitleSeconds * this.world.cfg.tickHz,
      };
  }

  /** (Re)build the world from params: a scenario id, or a procedural planet. */
  load(
    scenarioId: string | null = this.params.scenario,
    session?: SkirmishParams,
  ): void {
    const p = this.pack;
    const def = scenarioId ? findScenario(scenarioId) : undefined;
    if (scenarioId && !def) throw new Error(`unknown scenario ${scenarioId}`);
    const sp: SkirmishParams = session ?? {
      seed: this.params.seed,
      level: this.params.level,
      size: this.params.size,
      tribes: this.params.tribes,
      ai: [...this.params.ai],
      difficulty: this.params.difficulty,
      ...(this.params.rules ?? p.files.balance.victory?.default ? { rules: (this.params.rules ?? p.files.balance.victory?.default)! } : {}),
    };
    this.world = def
      ? createScenarioWorld(def, p.files, p.hash, makeBot)
      : createSkirmish(p, sp);
    this.scenarioCmds = def ? commandsByTick(def.commands) : null;
    this.afterWorld();
    this.skirmish = def ? null : sp;
    this.inGame = true;
    this.screen = "none";
    this.backStack = [];
    this.onChange();
  }

  /** Reset the per-match UI state and point the renderer and camera at the current world. */
  private afterWorld(): void {
    this.selection.clear();
    // entity ids and camera spots belong to the old world
    this.groups = Array.from({ length: 10 }, () => []);
    this.bookmarks = [null, null, null, null];
    this.selectedBuilding = -1;
    this.placing = null;
    this.placeAt = null;
    this.targeting = null;
    this.pointing = null;
    this.attackMode = false;
    this.queue = [];
    this.events = [];
    this.log = [];
    this.replayLog = [];
    this.replayStart = null;
    this.replay = null;
    this.ended = null;
    this.stats = emptyStats();
    this.newAchievements = [];
    this.notes = [];
    this.noteLast.clear();
    this.renderer.setPlacement(null);
    this.renderer.setTargeting(null);
    this.renderer.setWorld(this.world);
    this.applyQuality(); // BACKLOG 14b: the match weather
    this.renderer.viewTribe = this.localTribe;
    this.renderer.revealFog = this.params.reveal;
    const home = this.world.tribes[0]
      ? this.world.ents.index(this.world.tribes[0].hearth)
      : -1;
    const size = this.world.terrain.size;
    this.renderer.setCamera({
      x: home >= 0 ? this.world.ents.x[home] : size / 2,
      z: home >= 0 ? this.world.ents.y[home] + 1 : size / 2,
    });
    this.renderer.setCamera(this.params.camera ?? "default");
  }

  // ---------------------------------------------------------------- game flow (M8)
  /** A new skirmish from the setup screen (or Play again): the params replace the URL ones. */
  startSkirmish(sp: SkirmishParams): void {
    const prev = this.params;
    this.params = {
      ...this.params,
      seed: sp.seed,
      level: sp.level,
      size: sp.size,
      tribes: sp.tribes,
      ai: [...sp.ai],
      difficulty: sp.difficulty,
      rules: sp.rules ?? null,
      scenario: null,
      camera: null,
    };
    try {
      this.load(null, sp);
    } catch (e) {
      // the generator can fail for a seed and size (the menu shows it); keep the current world and params
      this.params = prev;
      throw e;
    }
    this.paused = this.params.fixedStep;
  }

  /** Start a campaign level (it must be open) with the unlocks of the levels won before it. */
  playLevel(id: string, anyway = false): void {
    const def = this.levels.find((l) => l.id === id);
    if (!def) throw new Error(`unknown level ${id}`);
    if (!anyway && !levelOpen(this.levels, this.campaignWon, id)) return;
    this.startSkirmish(
      campaignParams(def, campaignCarry(this.levels, this.campaignWon, id, this.campaignLearned)),
    );
  }

  /** The level after the current campaign level, or null. */
  nextLevelId(): string | null {
    const c = this.skirmish?.campaign;
    return c ? (nextLevel(this.levels, c.def.id)?.id ?? null) : null;
  }

  /** The main menu over a still planet (no opponents, the sim does not run). */
  showMainMenu(): void {
    this.editor = null;
    this.editorTest = false;
    const sk = this.ui.skirmish;
    this.params = { ...this.params, scenario: null };
    this.world = createSkirmish(this.pack, {
      seed: this.params.seed,
      level: sk.maps[0],
      size: sk.defaultSize,
      tribes: 2,
      ai: ["none"],
      difficulty: sk.defaultDifficulty,
    });
    this.scenarioCmds = null;
    this.afterWorld();
    this.skirmish = null;
    this.inGame = false;
    this.screen = "main";
    this.backStack = [];
    this.onChange();
  }

  /** Take over a world restored from a save (session.restoreSave checked its hash). */
  adoptSave(w: World, s: SaveGame): void {
    const sp = s.params;
    this.params = {
      ...this.params,
      seed: sp.seed,
      level: sp.level,
      size: sp.size,
      tribes: sp.tribes,
      ai: [...sp.ai],
      difficulty: sp.difficulty,
      rules: sp.rules ?? null,
      scenario: null,
      camera: null,
    };
    this.world = w;
    this.scenarioCmds = null;
    this.afterWorld();
    this.stats = statsFrom(s.stats); // BACKLOG 79: the end screen keeps the kills and losses from before the save
    this.skirmish = { ...sp, ai: [...sp.ai] };
    this.log = [...s.log];
    this.replayStart = s;
    this.queue = s.pending.map((c) => ({ ...c }));
    this.inGame = true;
    this.lastLoad = { tick: w.tick, hash: w.hash().all };
    this.screen = "none";
    this.backStack = [];
    this.paused = this.params.fixedStep;
    this.onChange();
  }

  // ---------------------------------------------------------------- BACKLOG 12: map editor
  /** Open the map editor on the stored draft (or a new one) over its preview world. */
  openEditor(): void {
    const draft = loadDraft(this.kv) ?? newDraft();
    this.editor = { draft, undo: [], tool: "land", tribe: 0, issues: [], note: null };
    this.editorTest = false;
    this.screen = "none";
    this.backStack = [];
    this.inGame = false;
    this.skirmish = null;
    this.scenarioCmds = null;
    this.editorRebuild(false);
  }

  /** Rebuild the preview world from the draft (keeping the camera after an edit) and revalidate. */
  private editorRebuild(keepCamera: boolean): void {
    const ed = this.editor;
    if (!ed) return;
    const cam = { ...this.renderer.cam };
    this.world = previewWorld(ed.draft, this.pack.files, this.pack.hash);
    this.afterWorld();
    this.renderer.revealFog = true;
    const n = ed.draft.map.size;
    this.renderer.setCamera(keepCamera ? { x: cam.x, z: cam.z, yaw: cam.yaw, zoom: cam.zoom, map: cam.map } : { x: n / 2, z: n / 2, zoom: 0.58, yaw: 0.6, map: false });
    ed.issues = draftIssues(ed.draft, this.pack.files);
    this.onChange();
  }

  /** Replace the draft (undoable), store it in the browser and rebuild the preview. */
  editorEdit(next: LevelDef, rebuild = true): void {
    const ed = this.editor;
    if (!ed) return;
    ed.undo.push(ed.draft);
    if (ed.undo.length > 40) ed.undo.shift();
    ed.draft = next;
    ed.note = storeDraft(this.kv, next) ? null : "Could not store the draft in this browser.";
    if (rebuild) this.editorRebuild(true);
    else {
      ed.issues = draftIssues(next, this.pack.files);
      this.onChange();
    }
  }

  /** Apply the current tool (or erase) at map cell (x, z). */
  editorApply(x: number, z: number, erase = false): void {
    const ed = this.editor;
    if (!ed) return;
    const tool = erase ? "erase" : ed.tool;
    const next = applyTool(ed.draft, tool, x, z, { tribe: ed.tribe });
    if (draftJson(next) === draftJson(ed.draft)) return;
    this.editorEdit(next);
    ed.tribe = Math.min(ed.tribe, ed.draft.tribes.length);
  }

  /** Apply the tool at a screen pixel (false when it misses the planet). */
  editorAt(px: number, py: number, erase = false): boolean {
    const p = this.renderer.pickTerrain(px, py);
    if (!this.editor || !p) return false;
    this.editorApply(p.x, p.z, erase);
    return true;
  }

  editorTool(t: EditorTool): void {
    if (!this.editor) return;
    this.editor.tool = t;
    this.onChange();
  }

  editorTribe(k: number): void {
    if (!this.editor) return;
    this.editor.tribe = Math.max(0, Math.min(k, this.editor.draft.tribes.length, 3));
    this.onChange();
  }

  editorGoal(g: EditorGoal): void {
    if (this.editor) this.editorEdit(setGoal(this.editor.draft, g), false);
  }

  editorOpponent(k: number, ai: string, difficulty: string): void {
    if (this.editor) this.editorEdit(setOpponent(this.editor.draft, k, ai, difficulty), false);
  }

  editorField(f: "name" | "timeLimit" | "forge", v: string | number | boolean): void {
    if (this.editor) this.editorEdit(setField(this.editor.draft, f, v), false);
  }

  /** A fresh draft of this size on land or sea (undoable). */
  editorNew(size: number, base: "land" | "sea"): void {
    if (!this.editor) return;
    this.editorEdit(newDraft(size, base), false);
    this.editor.tribe = 0;
    this.editorRebuild(false);
  }

  editorUndo(): void {
    const ed = this.editor;
    const prev = ed?.undo.pop();
    if (!ed || !prev) return;
    ed.draft = prev;
    ed.tribe = Math.min(ed.tribe, prev.tribes.length);
    storeDraft(this.kv, prev);
    this.editorRebuild(true);
  }

  editorSave(): void {
    const ed = this.editor;
    if (!ed) return;
    ed.note = storeDraft(this.kv, ed.draft) ? (this.persistent ? "Saved in this browser." : "Saved until this tab closes (browser storage is unavailable).") : "Could not store the draft in this browser.";
    this.onChange();
  }

  /** Download the draft as a level JSON file (data/levels shape). */
  editorDownload(): void {
    const ed = this.editor;
    if (!ed) return;
    const url = URL.createObjectURL(new Blob([draftJson(ed.draft)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ed.draft.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ed.note = `Downloaded ${ed.draft.id}.json.`;
    this.onChange();
  }

  /** Play the draft as a level session; quitting it returns to the editor. */
  editorPlaytest(): boolean {
    const ed = this.editor;
    if (!ed || ed.issues.length) return false;
    storeDraft(this.kv, ed.draft);
    const def = ed.draft;
    this.editor = null;
    try {
      this.startSkirmish(campaignParams(def, {}));
    } catch (e) {
      // the editor stays open with the reason (startSkirmish keeps the preview world when it throws)
      this.editor = ed;
      ed.note = `The level could not start: ${(e as Error).message}`;
      this.onChange();
      return false;
    }
    this.editorTest = true;
    return true;
  }

  editorExit(): void {
    this.showMainMenu();
  }

  /** Editor keys: 1 to 9 pick a tool, Ctrl+Z undoes, camera keys pan and turn. */
  private editorKey(e: KeyboardEvent): void {
    if ((e.target as Element | null)?.closest?.("input, select, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      this.editorUndo();
      return;
    }
    const d = Number(e.key);
    if (Number.isInteger(d) && d >= 1 && d <= EDITOR_TOOLS.length) {
      this.editorTool(EDITOR_TOOLS[d - 1]);
      return;
    }
    this.keys.add(e.key.toLowerCase());
  }

  go(screen: Screen): void {
    this.backStack.push(this.screen);
    this.screen = screen;
    this.rebinding = null;
    this.onChange();
  }

  /** Back button and Escape on a menu screen. */
  menuBack(): void {
    if (this.screen === "pause") return this.resume();
    if (
      this.screen === "main" ||
      this.screen === "end" ||
      this.screen === "none"
    )
      return;
    this.screen = this.backStack.pop() ?? (this.inGame ? "pause" : "main");
    this.rebinding = null;
    this.onChange();
  }

  openPause(): void {
    if (!this.inGame || this.ended) return;
    this.cancelModes();
    this.screen = "pause";
    this.backStack = [];
    this.onChange();
  }

  resume(): void {
    this.screen = "none";
    this.backStack = [];
    this.rebinding = null;
    this.onChange();
  }

  /** Clear every pointer mode (targeting, placing, rally pick, attack-move). */
  private cancelModes(): void {
    this.targeting = null;
    this.renderer.setTargeting(null);
    this.placing = null;
    this.placeAt = null;
    this.renderer.setPlacement(null);
    this.pointing = null;
    this.attackMode = false;
  }

  private hasMode(): boolean {
    return Boolean(
      this.targeting ||
      this.placing ||
      this.pointing ||
      this.attackMode ||
      this.selection.size ||
      this.selectedBuilding >= 0,
    );
  }

  /** Victory when every rival tribe is eliminated, defeat when the local tribe is (skirmish only).
   * In a campaign level the level runtime decides, and a win is recorded in the campaign progress. */
  private checkEnd(): void {
    if (!this.skirmish || this.ended) return;
    const lv = this.world.level;
    if (lv) {
      if (lv.outcome === OUTCOME.none) return;
      const won = lv.outcome === OUTCOME.won;
      const me = this.world.tribes[this.localTribe];
      const unlocked = this.pack.files.spells.spells.filter((_, i) => me?.eco.unlocked[i]).map((sp) => sp.id);
      const taught = taughtSpells(unlocked, lv.def, this.skirmish.campaign?.carry ?? {});
      const shipped = !this.editorTest && this.levels.some((l) => l.id === lv.def.id);
      if (won && shipped && !recordWin(this.kv, lv.def.id, this.campaignWon, this.campaignLearned, taught))
        this.notify(
          "progress",
          "Campaign progress could not be stored in this browser.",
          "info",
        );
      this.ended = {
        won,
        why: [...this.world.events]
          .reverse()
          .find((e) => e.type === "levelLost")?.why as string | undefined,
      };
      if (won) this.voice("voice.shaper.victory");
      this.keepRecords(won);
      this.keepReplay();
      this.cancelModes();
      this.screen = "end";
      this.backStack = [];
      this.onChange();
      return;
    }
    if (this.world.tribes.length < 2) return;
    const ts = this.world.tribes;
    const me = ts[this.localTribe];
    const rules = this.world.rules;
    if (rules) {
      // BACKLOG 13 (ADR-014): the sim decides the winner; losing the local tribe ends the match for the player
      if (me?.alive && rules.winner < 0) return;
      this.ended = { won: Boolean(me?.alive) && rules.winner === this.localTribe, why: me?.alive ? rules.why : "eliminated" };
    } else {
      // saves from before the sim rules: every rival out wins, the local tribe out loses
      const rivalsOut = ts.every((t) => t.index === this.localTribe || !t.alive);
      if (me?.alive && !rivalsOut) return;
      this.ended = { won: Boolean(me?.alive) };
    }
    if (this.ended.won) this.voice("voice.shaper.victory");
    this.keepRecords(this.ended.won);
    this.keepReplay();
    this.cancelModes();
    this.screen = "end";
    this.backStack = [];
    this.onChange();
  }

  /** Commands queued for the next tick (saved with the game). */
  pendingCommands(): Command[] {
    return this.queue.map((c) => ({ ...c }));
  }

  /** Queue a command from the local player (applied on the next tick). A replay takes no orders. */
  command(c: Partial<Command> & { type: string }): void {
    if (this.replay) return;
    this.queue.push({
      tick: this.world.tick,
      tribe: c.tribe ?? 0,
      type: c.type,
      args: c.args ?? {},
    });
  }

  private stepOnce(): void {
    if (this.replay) return this.replayStep();
    const local = this.queue.map((c) => ({ ...c, tick: this.world.tick }));
    const cmds = [
      ...(this.scenarioCmds ? this.scenarioCmds(this.world.tick) : []),
      ...local,
    ];
    this.queue = [];
    this.world.step(cmds);
    if (this.skirmish && local.length) {
      this.log.push(...local);
      if (this.log.length > 2 * LOG_TAIL) this.log = this.log.slice(-LOG_TAIL);
      this.replayLog.push(...local);
    }
    for (const e of this.world.events) {
      this.events.push(e);
      noteEvent(this.stats, e, this.localTribe);
      this.noteFor(e);
      this.cueFor(e);
    }
    if (this.world.tick % 30 === 0) this.samplePeak();
    const si = shaperIndex(this.world, this.localTribe);
    const E = this.world.ents;
    if (
      si >= 0 &&
      E.hitTick[si] === this.world.tick - 1 &&
      E.lastHit[si] >= 0 &&
      E.lastHit[si] !== this.localTribe
    )
      this.notify("shaperHit", "Your Shaper is under attack!", "bad", 15);
    this.checkEnd();
  }

  // ---------------------------------------------------------------- BACKLOG 21: records and achievements
  private samplePeak(): void {
    if (this.world.tribes[this.localTribe]) this.stats.peakFollowers = Math.max(this.stats.peakFollowers, this.world.economy.followers(this.localTribe));
  }

  /** Add the ended match to the career records and note the achievements it earned (not for editor playtests). */
  private keepRecords(won: boolean): void {
    this.newAchievements = [];
    if (!this.skirmish || this.editorTest) return;
    const s = this.stats;
    this.samplePeak();
    s.won = won ? 1 : 0;
    s.minutes = Math.round(this.world.playTick / this.world.cfg.tickHz / 6) / 10;
    s.levelsWon = this.campaignWon.length;
    const ctx = { mode: this.world.level ? ("level" as const) : ("skirmish" as const), difficulty: this.skirmish.difficulty };
    this.newAchievements = recordMatch(this.achievements, this.records, s, ctx, new Date().toISOString());
    if (!storeRecords(this.kv, this.records)) this.notify("records", "Records could not be stored in this browser.", "info");
  }

  // ---------------------------------------------------------------- BACKLOG 19: replays
  /** The ended match as a replay, kept for the end screen and stored as the last replay when it fits. */
  private keepReplay(): void {
    if (!this.skirmish) return;
    this.lastReplay = makeReplay(this.world, this.skirmish, this.replayStart, this.replayLog, new Date().toISOString());
    try {
      this.kv.setItem(REPLAY_KEY, encodeReplay(this.lastReplay));
    } catch {
      // over the storage quota (a long match loaded from a save): the end screen can still watch or download it
    }
  }

  /** Whether a last replay is stored (cheap: the main menu asks on every refresh). */
  hasStoredReplay(): boolean {
    try {
      return this.kv.getItem(REPLAY_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** The stored last replay, or null (absent, damaged or made with other game data). */
  storedReplay(): Replay | null {
    try {
      const text = this.kv.getItem(REPLAY_KEY);
      return text ? decodeReplay(text, this.pack) : null;
    } catch {
      return null;
    }
  }

  /** Watch a replay: its world from the start, every tribe revealed, orders off, the replay bar shown. */
  watchReplay(r: Replay): void {
    const run = new ReplayRun(this.pack, r);
    const sp = r.params;
    this.params = { ...this.params, seed: sp.seed, level: sp.level, size: sp.size, tribes: sp.tribes, ai: [...sp.ai], difficulty: sp.difficulty, rules: sp.rules ?? null, scenario: null, camera: null };
    this.editor = null;
    this.editorTest = false;
    this.world = run.world;
    this.scenarioCmds = null;
    this.afterWorld();
    this.replay = { run, speed: 1, follow: false, seekTo: -1, verified: null };
    this.renderer.revealFog = true;
    this.skirmish = null;
    this.inGame = true;
    this.screen = "none";
    this.backStack = [];
    this.paused = this.params.fixedStep;
    this.onChange();
  }

  /** Seek the replay to a tick: at once when `now` (tests), else spread over frames by frame(). */
  replaySeek(tick: number, now = false): void {
    const rp = this.replay;
    if (!rp) return;
    rp.seekTo = Math.max(rp.run.startTick, Math.min(rp.run.replay.endTick, Math.floor(tick)));
    if (now) this.replaySeekSome(Infinity);
    this.onChange();
  }

  replaySpeed(speed: number): void {
    if (this.replay) this.replay.speed = speed;
    this.onChange();
  }

  replayFollow(on: boolean): void {
    if (this.replay) this.replay.follow = on;
    this.onChange();
  }

  /** Play or pause; Play at the end starts over. */
  replayToggle(): void {
    const rp = this.replay;
    if (!rp) return;
    if (this.paused && rp.run.done) this.replaySeek(rp.run.startTick, true);
    this.paused = !this.paused;
    this.onChange();
  }

  private replayStep(): void {
    const rp = this.replay!;
    rp.run.step();
    this.world = rp.run.world;
    for (const e of this.world.events) this.events.push(e);
    if (rp.run.done) {
      rp.verified = rp.run.verified();
      this.paused = true;
    }
  }

  /** Advance a pending seek within a time budget (ms); a restore swaps the world and rebinds the renderer. */
  private replaySeekSome(budgetMs: number): void {
    const rp = this.replay;
    if (!rp || rp.seekTo < 0) return;
    const before = rp.run.world;
    const t0 = performance.now();
    let there = false;
    do there = rp.run.seek(rp.seekTo, 60);
    while (!there && performance.now() - t0 < budgetMs);
    this.world = rp.run.world;
    if (this.world !== before) {
      this.selection.clear();
      this.renderer.setWorld(this.world);
      this.applyQuality();
    }
    this.events = [];
    if (there) {
      rp.seekTo = -1;
      rp.verified = rp.run.verified();
    }
  }

  /** Add a HUD notification; `key` throttles repeats to one per `throttleSec` of game time. */
  notify(key: string, text: string, kind: Note["kind"], throttleSec = 0): void {
    const hz = this.world.cfg.tickHz;
    const t = this.world.tick;
    const last = this.noteLast.get(key);
    if (last !== undefined && t - last < throttleSec * hz) return;
    this.noteLast.set(key, t);
    this.notes = [
      ...this.notes.filter((n) => n.until > t),
      { id: ++this.noteSeq, text, kind, until: t + this.ui.notes.seconds * hz },
    ].slice(-this.ui.notes.max);
  }

  /** Player-facing voice and UI cues the sim cue table does not cover (own tribe only). */
  private cueFor(e: SimEvent): void {
    if (e.tribe !== this.localTribe) return;
    if (e.type === "commandRejected") this.player.play("sfx.ui_error");
    else if (e.type === "shaperDied") this.voice("voice.shaper.under_attack");
    else if (
      e.type === "spellCast" &&
      this.world.tick - this.lastCastVoice > 20 * this.world.cfg.tickHz
    ) {
      this.lastCastVoice = this.world.tick;
      this.voice("voice.shaper.casting");
    }
  }

  /** Order feedback: a move click, and the Shaper's acknowledgement when the Shaper is in the order. */
  private orderSound(): void {
    this.player.play("sfx.order_move");
    const si = shaperIndex(this.world, this.localTribe);
    if (si >= 0 && this.selection.has(si))
      this.voice(
        this.ackFlip++ % 2
          ? "voice.shaper.acknowledged_b"
          : "voice.shaper.acknowledged",
      );
  }

  private noteFor(e: SimEvent): void {
    const me = this.localTribe;
    const rival = (t: unknown) => typeof t === "number" && t >= 0 && t !== me;
    switch (e.type) {
      case "shaperDied":
        if (e.tribe === me)
          this.notify(
            "shaperDied",
            "Your Shaper has fallen and will return at the Hearth.",
            "bad",
          );
        break;
      case "shaperRespawned":
        if (e.tribe === me)
          this.notify(
            "shaperBack",
            "Your Shaper is back at the Hearth.",
            "good",
          );
        break;
      case "killed":
        if (e.tribe === me && rival(e.by))
          this.notify(
            "underAttack",
            "Your followers are under attack!",
            "bad",
            20,
          );
        break;
      case "destroyed":
        if (e.tribe === me)
          this.notify(
            "lostBuilding",
            "One of your buildings was destroyed.",
            "bad",
            5,
          );
        break;
      case "tribeEliminated":
        if (rival(e.tribe)) {
          const left = this.world.tribes.filter(
            (t) => t.index !== me && t.alive,
          ).length;
          const name = this.world.tribes[e.tribe as number]?.color ?? "rival";
          this.notify(
            `out${e.tribe}`,
            `The ${name} tribe has fallen${left ? `: ${left} left` : ""}.`,
            "good",
          );
        }
        break;
      case "tierReached":
        if (e.tribe === me)
          this.notify(
            `tier${e.tier}`,
            `New tier: ${String(e.id).replace(/_/g, " ")}. New buildings are open.`,
            "good",
          );
        break;
      // BACKLOG 45: tell the player when a move order fails or units give up (combat chases excluded)
      case "orderFailed":
      case "orderGaveUp": {
        const n = orderNote(
          e,
          me,
          (id) =>
            this.world.tick - (this.ordered.get(id) ?? -Infinity) <=
            this.ui.notes.orderFeedbackSeconds * this.world.cfg.tickHz,
        );
        if (!n) break;
        this.ordered.delete(Number(e.id));
        this.notify(n.key, n.text, "info", n.throttleSec);
        this.renderer.markFailedOrder(e);
        break;
      }
      case "terrainLeadIn": {
        const n = leadInWarning(e, this.world, me);
        if (n) this.notify(n.key, n.text, "bad", n.throttleSec);
        break;
      }
      case "castFailed":
        if (e.tribe === me)
          this.notify(
            "castFailed",
            "The spell failed: the Shaper could not reach the target.",
            "info",
            3,
          );
        break;
      // M9 worship and campaign levels
      case "levelMessage":
        if (e.tribe === me)
          this.notify(`msg${this.noteSeq}`, String(e.text), "info");
        break;
      case "rewardSpawn":
        if (e.tribe === me)
          this.notify(
            `rs${this.world.tick}`,
            `${e.n} ${String(e.unit).replace(/_/g, " ")}${e.n === 1 ? " has" : "s have"} joined your tribe.`,
            "good",
          );
        break;
      case "objectiveComplete": {
        const o = this.world.level?.def.objectives[e.index as number];
        this.notify(
          `obj${e.index}`,
          `Objective complete${o?.text ? `: ${o.text}` : "."}`,
          "good",
        );
        break;
      }
      case "worshipComplete":
        if (e.tribe === me)
          this.notify(
            `ws${e.site}`,
            `The prayers at the ${e.kind} were answered.`,
            "good",
          );
        else
          this.notify(
            `ws${e.site}`,
            `A rival tribe has claimed the ${e.kind}.`,
            "bad",
          );
        break;
      case "worshipFailed":
        if (e.tribe === me)
          this.notify(
            "worshipFailed",
            "Your worshippers could not reach the site.",
            "info",
            5,
          );
        break;
      case "spellUnlocked":
        if (e.tribe === me)
          this.notify(
            `sp${e.spell}`,
            `New spell: ${String(e.spell).replace(/_/g, " ")}.`,
            "good",
          );
        break;
      case "buildingUnlocked":
        if (e.tribe === me)
          this.notify(
            `bu${e.building}`,
            `New building: ${String(e.building).replace(/_/g, " ")}.`,
            "good",
          );
        break;
      case "rewardCharges":
        if (e.tribe === me)
          this.notify(
            `ch${e.spell}${this.world.tick}`,
            `Gained ${e.n} ${String(e.spell).replace(/_/g, " ")} charge${e.n === 1 ? "" : "s"}.`,
            "good",
          );
        break;
      case "raid":
        if (e.tribe !== me)
          this.notify("raid", "Raiders are coming!", "bad", 10);
        break;
      default:
        break;
    }
  }

  step(n = 1): number {
    for (let i = 0; i < n && !this.ended; i++) this.stepOnce();
    this.onChange();
    return this.world.tick;
  }

  frame(now: number): void {
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.replay && this.replay.seekTo >= 0) {
      this.replaySeekSome(20);
      this.onChange();
    } else if (!this.paused && this.screen === "none" && !this.editor) {
      this.acc += dt;
      const speed = this.replay ? this.replay.speed : 1;
      const tickDt = 1 / (this.world.cfg.tickHz * speed);
      let n = 0;
      while (this.acc >= tickDt && n < 8 * speed && !this.ended && !this.paused) {
        this.stepOnce();
        this.acc -= tickDt;
        n++;
      }
      if (n) this.onChange();
    } else this.acc = 0;
    // the main menu backdrop turns slowly (not in fixedStep captures)
    if (
      this.screen === "main" &&
      !this.params.fixedStep &&
      !this.debugFlags.freezeCamera
    )
      this.renderer.setCamera({ yaw: this.renderer.cam.yaw + 0.04 * dt });
    // BACKLOG 19: Follow keeps the camera on the first tribe's Shaper (its Hearth while she is down)
    if (this.replay?.follow) {
      const t = this.world.tribes[0];
      const E = this.world.ents;
      const f = t ? (E.index(t.shaper) >= 0 ? E.index(t.shaper) : E.index(t.hearth)) : -1;
      if (f >= 0) this.renderer.setCamera({ x: E.x[f], z: E.y[f] });
    }
    this.pollKeys(dt);
    this.pruneSelection();
    const sk = this.selection.size
      ? `${this.selection.size}:${this.selection.values().next().value}`
      : "";
    if (sk !== this.selKey) {
      if (sk) this.player.play("sfx.unit_selected");
      this.selKey = sk;
    }
    this.renderer.selected = this.photo ? NO_SELECTION : this.selection;
    // positional audio hears around the camera focus; the radius grows as the camera pulls out
    const cam = this.renderer.cam;
    this.player.listener = {
      x: cam.x,
      z: cam.z,
      size: this.world.terrain.size,
      radius: cam.map ? 0 : 24 + 96 * cam.zoom,
    };
    this.player.yaw = cam.yaw;
    this.renderer.alpha = this.paused
      ? 1
      : Math.min(1, this.acc * this.world.cfg.tickHz);
    if (this.events.length) {
      const hz = this.world.cfg.tickHz;
      const wall = now / 1000;
      this.renderer.consumeEvents(
        this.events,
        this.params.fixedStep ? (e) => (e.tick + 1) / hz : () => wall,
      );
      this.audio.localTribe = this.localTribe;
      this.audio.consume(this.events);
    }
    // every frame, events or not: the battle, tension and hold windows only lapse when the director runs
    this.player.setStem(
      this.music.update(
        this.world.tick / this.world.cfg.tickHz,
        this.events,
        this.player.listener,
        this.localTribe,
      ),
    );
    this.events = [];
    // fixedStep: visuals follow the sim tick, so re-rendering the same tick gives identical pixels
    const visualTime = this.params.fixedStep
      ? this.world.tick / this.world.cfg.tickHz
      : now / 1000;
    this.renderer.setRally(this.photo ? null : rallyMarker(this.world, this.localTribe, this.selectedBuilding));
    this.renderer.render(visualTime);
  }

  // ---------------------------------------------------------------- selection and orders
  private pruneSelection(): void {
    const E = this.world.ents;
    for (const i of [...this.selection])
      if (!E.alive[i] || E.tribe[i] !== this.localTribe)
        this.selection.delete(i);
    if (this.selectedBuilding >= 0 && !E.alive[this.selectedBuilding])
      this.selectedBuilding = -1;
  }

  /** Own unit nearest to a screen point within 16 px, or -1. */
  unitAt(px: number, py: number): number {
    const u = this.renderer.units;
    if (!u) return -1;
    const E = this.world.ents;
    let best = -1;
    let bestD = 16 * 16;
    for (let i = 0; i < E.hi; i++) {
      const sx = u.screenX[i];
      if (Number.isNaN(sx) || !E.alive[i] || E.tribe[i] !== this.localTribe)
        continue;
      const d =
        (sx - px) * (sx - px) + (u.screenY[i] - py) * (u.screenY[i] - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  selectBox(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    add: boolean,
  ): void {
    const u = this.renderer.units;
    if (!u) return;
    if (!add) this.selection.clear();
    const E = this.world.ents;
    const [lx, hx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ly, hy] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (let i = 0; i < E.hi; i++) {
      const sx = u.screenX[i];
      if (Number.isNaN(sx) || !E.alive[i] || E.tribe[i] !== this.localTribe)
        continue;
      if (sx >= lx && sx <= hx && u.screenY[i] >= ly && u.screenY[i] <= hy)
        this.selection.add(i);
    }
    if (this.selection.size) this.selectedBuilding = -1;
    this.onChange();
  }

  /** M6 troop intents (HUD buttons, hotkeys, right clicks) as Commands. */
  troop(it: TroopIntent): boolean {
    const c = troopCommand(
      this.world,
      this.localTribe,
      [...this.selection],
      this.selectedBuilding,
      it,
    );
    if (c) this.command(c);
    return c !== null;
  }

  /** Select the own building under a screen pixel (clears the unit selection); -1 when none. */
  selectBuildingAt(px: number, py: number): number {
    const p = this.renderer.pickTerrain(px, py);
    const b = p ? buildingAt(this.world, this.localTribe, p.x, p.z) : -1;
    this.selectedBuilding = b;
    if (b >= 0) this.selection.clear();
    this.onChange();
    return b;
  }

  /** Order the selection to the terrain point under a screen pixel. With a lodge selected, set its rally
   * point; with units selected and an own Watchtower under the cursor, garrison there. */
  orderAt(px: number, py: number, attack = false): boolean {
    const p = this.renderer.pickTerrain(px, py);
    if (!p) return false;
    if (!this.selection.size && this.selectedBuilding >= 0)
      return this.troop({ kind: "rally", at: [p.x, p.z] });
    if (!this.selection.size) return false;
    const E = this.world.ents;
    // BACKLOG 10: right click an own boat or balloon to board it; a loaded vehicle right clicked onto land unloads there
    const vc = attack ? null : vehicleCommand(this.world, this.localTribe, [...this.selection], this.unitAt(px, py), p.x, p.z);
    if (vc) {
      this.command(vc);
      this.orderSound();
      return true;
    }
    const b = attack ? -1 : buildingAt(this.world, this.localTribe, p.x, p.z);
    if (b >= 0 && this.world.combat.garrisonOf(E.type[b]) > 0)
      return this.troop({ kind: "garrison", tower: b });
    const site = attack ? null : siteAt(this.world, p.x, p.z);
    if (site) {
      this.command({
        tribe: this.localTribe,
        type: "worship",
        args: { units: [...this.selection].map((i) => E.idOf(i)), site },
      });
      return true;
    }
    // BACKLOG 4: two or more units march in a box (melee in front, ranged and the Shaper behind)
    const formation = this.selection.size >= 2 ? { formation: "box" } : {};
    this.command({
      tribe: this.localTribe,
      type: "move",
      args: {
        units: [...this.selection].map((i) => E.idOf(i)),
        to: [p.x, p.z],
        attack,
        ...formation,
      },
    });
    for (const i of this.selection)
      this.ordered.set(E.idOf(i), this.world.tick);
    this.orderSound();
    return true;
  }

  startPlacing(building: string): void {
    const type = this.world.cfg.buildingIndex.get(building);
    // progression: a locked building cannot be picked (god mode sandboxes ignore locks)
    if (
      type !== undefined &&
      !this.world.godMode &&
      this.world.economy.buildingLock(this.localTribe, type)
    )
      return;
    this.placing = building;
    this.attackMode = false;
    this.onChange();
  }

  cancelPlacing(): void {
    this.placing = null;
    this.placeAt = null;
    this.renderer.setPlacement(null);
    this.onChange();
  }

  /** Move the placement ghost to the terrain under a screen pixel (snapped to the footprint grid). */
  updatePlacement(px: number, py: number): void {
    if (!this.placing) return;
    const w = this.world;
    const type = w.cfg.buildingIndex.get(this.placing);
    const p = this.renderer.pickTerrain(px, py);
    if (type === undefined || !p) {
      this.renderer.setPlacement(null);
      return;
    }
    const [fw, fh] = w.cfg.pack.buildings.buildings[type].footprint;
    const cx = Math.round(p.x - fw / 2) + fw / 2;
    const cy = Math.round(p.z - fh / 2) + fh / 2;
    const blocker = w.economy.planBlocker(type, cx, cy);
    this.placeAt = [cx, cy];
    if (blocker !== this.placeBlocked) {
      this.placeBlocked = blocker;
      this.onChange();
    }
    this.renderer.setPlacement({ x: cx, z: cy, w: fw, h: fh, ok: !blocker });
  }

  confirmPlacement(): void {
    if (!this.placing || !this.placeAt || this.placeBlocked) return;
    this.command({
      tribe: this.localTribe,
      type: "placePlan",
      args: { building: this.placing, at: this.placeAt },
    });
    this.cancelPlacing();
  }

  /** Spells the local tribe can cast, in spell bar order (hotkeys: SPELL_KEYS in @hearthfall/ui). */
  castable(): string[] {
    const w = this.world;
    const tr = w.tribes[this.localTribe];
    if (!tr) return [];
    // a locked spell with charges from a shrine or a level reward is castable until they run out
    return w.cfg.pack.spells.spells
      .filter((_, i) => tr.eco.unlocked[i] || tr.eco.charges[i] > 0)
      .map((s) => s.id);
  }

  startTargeting(spell: string): void {
    this.cancelPlacing();
    this.targeting = spell;
    this.onChange();
  }

  cancelTargeting(): void {
    this.targeting = null;
    this.targetCounts = null;
    this.renderer.setTargeting(null);
    this.onChange();
  }

  updateTargeting(px: number, py: number): void {
    if (!this.targeting) return;
    const w = this.world;
    const si = shaperIndex(w, this.localTribe);
    const s = w.cfg.pack.spells.spells[w.cfg.spellIndex.get(this.targeting)!];
    const p = this.renderer.pickTerrain(px, py);
    if (si < 0 || !p) {
      this.renderer.setTargeting(null);
      return;
    }
    const n = w.terrain.size;
    const dx = wrapDelta(p.x - w.ents.x[si], n);
    const dy = wrapDelta(p.z - w.ents.y[si], n);
    const radius = Math.max(
      0.8,
      ...s.effects.map((e) =>
        "radius" in e && typeof e.radius === "number" ? e.radius : 0,
      ),
    );
    this.renderer.setTargeting({
      cx: w.ents.x[si],
      cz: w.ents.y[si],
      range: s.range,
      x: p.x,
      z: p.z,
      r: radius,
      inRange: Math.sqrt(dx * dx + dy * dy) <= s.range,
    });
    const counts = areaCounts(w, this.localTribe, p.x, p.z, radius);
    if (
      counts.enemies !== this.targetCounts?.enemies ||
      counts.own !== this.targetCounts?.own
    ) {
      this.targetCounts = counts;
      this.onChange();
    }
  }

  /** BACKLOG 11: the Forge ring around the local Hearth and the brush under the cursor (cleared once it ends). */
  updateForge(px: number, py: number): void {
    const w = this.world;
    const f = w.forge;
    const h = w.ents.index(w.tribes[this.localTribe]?.hearth ?? -1);
    const p = this.renderer.pickTerrain(px, py);
    if (!f || !f.running() || h < 0 || !p) {
      if (this.forgeShown && !this.targeting) this.renderer.setTargeting(null);
      this.forgeShown = Boolean(f?.running());
      return;
    }
    const why = f.blocker(this.localTribe, p.x, p.z) ?? "";
    this.renderer.setTargeting({ cx: w.ents.x[h], cz: w.ents.y[h], range: f.def.radius - f.def.brushRadius, x: p.x, z: p.z, r: f.def.brushRadius, inRange: !why });
    this.forgeShown = true;
    if (why !== this.forgeBlocked) {
      this.forgeBlocked = why;
      this.onChange();
    }
  }

  /** BACKLOG 11: one Forge brush stroke at the cursor (refused strokes say why in the Forge panel). */
  forgeAt(px: number, py: number): boolean {
    const f = this.world.forge;
    const p = this.renderer.pickTerrain(px, py);
    if (!f || !f.running() || !p) return false;
    const why = f.blocker(this.localTribe, p.x, p.z);
    if (why) {
      this.forgeBlocked = why;
      this.onChange();
      return false;
    }
    this.command({ tribe: this.localTribe, type: "forgeOp", args: { brush: this.forgeBrush, x: p.x, y: p.z } });
    return true;
  }

  forgeReady(): void {
    if (this.world.forge?.running()) this.command({ tribe: this.localTribe, type: "forgeReady", args: {} });
  }

  castAt(px: number, py: number): boolean {
    if (!this.targeting) return false;
    const p = this.renderer.pickTerrain(px, py);
    if (!p) return false;
    this.command({
      tribe: this.localTribe,
      type: "cast",
      args: { spell: this.targeting, target: [p.x, p.z] },
    });
    this.cancelTargeting();
    return true;
  }

  selectKind(kind: string, center = true): void {
    const idx = this.world.selectUnits(`tribe${this.localTribe}.${kind}s`);
    this.selection = new Set(idx);
    if (center && idx.length)
      this.renderer.setCamera({
        x: this.world.ents.x[idx[0]],
        z: this.world.ents.y[idx[0]],
      });
    this.onChange();
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    let down: { x: number; y: number } | null = null;
    // audio may only start from a user gesture; every button click (menus and HUD) clicks
    const unlock = () => this.player.unlock();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    document.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element | null)?.closest?.("button"))
          this.player.play("sfx.ui_click");
      },
      true,
    );
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.photo) return;
      // BACKLOG 12: in the map editor a left click applies the tool and a right click erases
      if (this.editor) {
        if (e.button === 0 || e.button === 2) this.editorAt(e.clientX, e.clientY, e.button === 2);
        return;
      }
      // BACKLOG 11: in the Forge a left click is a brush stroke (orders wait for the match)
      if (e.button === 0 && this.world.forge?.running()) {
        this.forgeAt(e.clientX, e.clientY);
        return;
      }
      if (this.placing) {
        if (e.button === 0) this.confirmPlacement();
        else this.cancelPlacing();
        return;
      }
      if (this.targeting) {
        if (e.button === 0) this.castAt(e.clientX, e.clientY);
        else this.cancelTargeting();
        return;
      }
      if (this.pointing) {
        if (e.button === 0) this.orderAt(e.clientX, e.clientY);
        this.pointing = null;
        this.onChange();
        return;
      }
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.orderAt(e.clientX, e.clientY, this.attackMode);
        this.attackMode = false;
      }
    });
    window.addEventListener("mousemove", (e) => {
      if (this.forgeShown || this.world.forge?.running()) this.updateForge(e.clientX, e.clientY);
      if (this.placing) this.updatePlacement(e.clientX, e.clientY);
      if (this.targeting) this.updateTargeting(e.clientX, e.clientY);
      if (
        down &&
        (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)
      ) {
        this.box = { x0: down.x, y0: down.y, x1: e.clientX, y1: e.clientY };
        this.onChange();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0 || !down) return;
      if (this.box)
        this.selectBox(
          this.box.x0,
          this.box.y0,
          this.box.x1,
          this.box.y1,
          e.shiftKey,
        );
      else if (this.attackMode) {
        this.orderAt(e.clientX, e.clientY, true);
        this.attackMode = false;
      } else {
        const i = this.unitAt(e.clientX, e.clientY);
        if (!e.shiftKey) this.selection.clear();
        if (i >= 0 && e.detail === 2) {
          // BACKLOG 4: double-click selects every own unit of that type nearby
          this.selectedBuilding = -1;
          for (const k of sameTypeNear(
            this.world,
            this.localTribe,
            i,
            this.ui.input.sameTypeRadius,
          ))
            this.selection.add(k);
        } else if (i >= 0) {
          this.selectedBuilding = -1;
          if (e.shiftKey && this.selection.has(i)) this.selection.delete(i);
          else this.selection.add(i);
        } else if (!e.shiftKey) this.selectBuildingAt(e.clientX, e.clientY);
        this.onChange();
      }
      down = null;
      this.box = null;
      this.onChange();
    });
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("keyup", (e) =>
      this.keys.delete(e.key.toLowerCase()),
    );
    window.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const z = this.renderer.cam.zoom + Math.sign(e.deltaY) * 0.05;
        this.renderer.setCamera({ zoom: Math.min(1, Math.max(0, z)) });
      },
      { passive: false },
    );
    let drag: { x: number; y: number; pan: boolean } | null = null;
    this.canvas.addEventListener("mousedown", (e) => {
      // photo mode: a left drag orbits (Ctrl pans) like the middle button
      if (e.button === 1 || (e.button === 0 && this.photo)) {
        e.preventDefault();
        drag = { x: e.clientX, y: e.clientY, pan: e.ctrlKey };
      }
    });
    window.addEventListener("mouseup", () => (drag = null));
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) this.pan(-dx * 0.05, -dy * 0.05);
      else this.renderer.setCamera({ yaw: this.renderer.cam.yaw - dx * 0.005 });
    });
  }

  /** Photo mode on or off: the match pauses while it is on and resumes as it was. */
  setPhoto(on: boolean): void {
    if (on === this.photo || (on && (this.screen !== "none" || this.editor || this.ended))) return;
    if (on) {
      this.cancelPlacing();
      this.cancelTargeting();
      this.pointing = null;
      this.attackMode = false;
      this.photoWasPaused = this.paused;
      this.paused = true;
    } else this.paused = this.photoWasPaused;
    this.photo = on;
    this.onChange();
  }

  /** Photo mode keys: the camera keys keep working (held keys), Enter saves a PNG, Escape or the photo key leaves. */
  private photoKey(e: KeyboardEvent): void {
    if (e.key === "Escape" || actionFor(this.settings.keymap, e) === "photoMode") {
      e.preventDefault();
      return this.setPhoto(false);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      this.savePhoto();
      return;
    }
    if (actionFor(this.settings.keymap, e) === "toggleMap") this.renderer.setCamera({ map: !this.renderer.cam.map });
    const f = ["F1", "F2", "F3", "F4"].indexOf(e.key);
    if (f >= 0 && this.bookmarks[f]) {
      e.preventDefault();
      this.renderer.setCamera(this.bookmarks[f]!);
    }
  }

  /** Download the current frame as a PNG (the canvas keeps its drawing buffer, and the HUD is DOM, so it is not in it). */
  savePhoto(): string {
    this.renderer.render(this.params.fixedStep ? this.world.tick / this.world.cfg.tickHz : performance.now() / 1000);
    const name = `hearthfall-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}-t${this.world.tick}.png`;
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
    this.photoSaved = name;
    this.player.play("sfx.ui_click");
    this.onChange();
    return name;
  }

  /** Keyboard: rebinding first, then menus (Escape goes back), then play. Rebindable actions use the keymap. */
  private onKey(e: KeyboardEvent): void {
    if (this.rebinding) {
      e.preventDefault();
      this.onRebindKey?.(e);
      return;
    }
    if (this.screen !== "none") {
      if (e.key === "Escape") this.menuBack();
      return;
    }
    if (this.editor) return this.editorKey(e);
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (this.photo) return this.photoKey(e);
    const sel = this.selection.size > 0;
    switch (actionFor(this.settings.keymap, e)) {
      case "buildDwelling":
        this.startPlacing("dwelling");
        break;
      case "buildTower":
        this.startPlacing("watchtower");
        break;
      case "retreat":
        if (sel) this.troop({ kind: "retreat" });
        break;
      case "garrison":
        if (sel) this.troop({ kind: "garrison" });
        break;
      case "cancelPlan":
        if (this.selectedBuilding >= 0) this.troop({ kind: "cancelPlan" });
        break;
      case "attackMove":
        if (sel) this.attackMode = true;
        break;
      case "selectShaper":
        this.selectKind("shaper");
        break;
      case "toggleMap":
        this.renderer.setCamera({ map: !this.renderer.cam.map });
        break;
      case "help":
        this.showHelp = !this.showHelp;
        this.onChange();
        break;
      case "cancelCast":
        this.command({ tribe: this.localTribe, type: "cancelCast", args: {} });
        break;
      case "pauseMenu":
        return this.openPause();
      case "photoMode":
        return this.setPhoto(true);
      default:
        break;
    }
    const slot = spellSlot(e);
    if (slot >= 0) {
      const sp = this.castable()[slot];
      if (sp) this.startTargeting(sp);
    }
    if (k === "escape") {
      if (!this.hasMode()) return this.openPause();
      this.cancelModes();
      this.selection.clear();
      this.selectedBuilding = -1;
      this.onChange();
    }
    if (/^[0-9]$/.test(k)) {
      const g = Number(k);
      const E = this.world.ents;
      if (e.ctrlKey) {
        e.preventDefault();
        this.groups[g] = [...this.selection].map((i) => E.idOf(i));
      } else {
        this.selection = new Set(
          this.groups[g].map((id) => E.index(id)).filter((i) => i >= 0),
        );
        // BACKLOG 4: pressing the group key again quickly centers the camera on the group
        const now = performance.now();
        if (
          this.lastGroupKey.g === g &&
          now - this.lastGroupKey.at < this.ui.input.groupJumpMs
        ) {
          const c = groupCenter(this.world, [...this.selection]);
          if (c) this.renderer.setCamera({ x: c[0], z: c[1] });
        }
        this.lastGroupKey = { g, at: now };
        this.onChange();
      }
    }
    if (k === " ") {
      e.preventDefault();
      this.paused = !this.paused;
      this.onChange();
    }
    const f = ["F1", "F2", "F3", "F4"].indexOf(e.key);
    if (f >= 0) {
      e.preventDefault();
      if (e.ctrlKey || e.shiftKey) this.bookmarks[f] = { ...this.renderer.cam };
      else if (this.bookmarks[f]) this.renderer.setCamera(this.bookmarks[f]!);
    }
  }

  private pan(right: number, forward: number): void {
    const c = this.renderer.cam;
    const s = 1 + c.zoom * 6;
    const sy = Math.sin(c.yaw);
    const cy = Math.cos(c.yaw);
    this.renderer.setCamera({
      x: c.x + (cy * right - sy * forward) * s,
      z: c.z + (-sy * right - cy * forward) * s,
    });
  }

  private pollKeys(dt: number): void {
    if (this.debugFlags.freezeCamera) return;
    const k = this.keys;
    const sp = 18 * dt;
    const km = this.settings.keymap;
    if (k.has(km.rotateLeft.toLowerCase()))
      this.renderer.setCamera({ yaw: this.renderer.cam.yaw + 1.6 * dt });
    if (k.has(km.rotateRight.toLowerCase()))
      this.renderer.setCamera({ yaw: this.renderer.cam.yaw - 1.6 * dt });
    if (k.has("arrowleft")) this.pan(-sp, 0);
    if (k.has("arrowright")) this.pan(sp, 0);
    if (k.has("arrowup")) this.pan(0, sp);
    if (k.has("arrowdown")) this.pan(0, -sp);
  }

  // ---------------------------------------------------------------- debug API
  summary(): Record<string, unknown> {
    const w = this.world;
    const E = w.ents;
    return {
      tick: w.tick,
      paused: this.paused,
      photo: this.photo,
      traits: w.origin.traits ?? null,
      screen: this.screen,
      ended: this.ended,
      seed: w.seed,
      map: { ...w.mapInfo, size: w.terrain.size },
      packHash: w.cfg.packHash,
      mods: activeMods.map((m) => m.id),
      hash: w.hash().all,
      tribes: w.tribes.map((t) => {
        const h = E.index(t.hearth);
        return {
          index: t.index,
          color: t.color,
          alive: t.alive,
          hearth: h >= 0 ? [+E.x[h].toFixed(2), +E.y[h].toFixed(2)] : null,
          units: w.count(
            (i) => E.cat[i] === CAT.unit && E.tribe[i] === t.index,
          ),
          buildings: w.count(
            (i) => E.cat[i] === CAT.building && E.tribe[i] === t.index,
          ),
          explored: +w.vision.exploredShare(t.index).toFixed(3),
        };
      }),
      fog: {
        on: w.vision.on,
        revealed: this.renderer.revealFog,
        visibleEnemyUnits: w.count(
          (i) =>
            E.cat[i] === CAT.unit &&
            E.tribe[i] !== this.localTribe &&
            E.tribe[i] >= 0 &&
            w.vision.seesEntity(this.localTribe, i),
        ),
      },
      counts: {
        trees: w.count((i) => E.cat[i] === CAT.tree),
        wild: w.count((i) => E.cat[i] === CAT.unit && E.tribe[i] === -1),
        entities: E.count,
      },
      terrainVersion: w.terrain.version,
      sites: w.worship.sites.map((s) => {
        const i = E.index(s.ent);
        return {
          tag: s.tag,
          kind: s.kind,
          at: i >= 0 ? [+E.x[i].toFixed(2), +E.y[i].toFixed(2)] : null,
          usesLeft: s.usesLeft,
          lastBy: s.lastBy,
        };
      }),
      render: { ...this.renderer.stats, vfx: this.renderer.vfx.drawn() },
      audio: this.audio.stats(),
      camera: { ...this.renderer.cam },
      lastEvents: w.recent.slice(-20),
      warnings: [] as string[],
    };
  }

  setDebug(flags: DebugFlags): void {
    this.debugFlags = { ...this.debugFlags, ...flags };
    this.renderer.setDebug(this.debugFlags);
    document.body.classList.toggle(
      "debug-overlap-hud",
      Boolean(this.debugFlags.overlapHud),
    );
    this.onChange();
  }
}

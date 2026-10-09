// Game wiring: data pack + sim World + renderer + input + the window.__game debug API.
// The sim advances at a fixed tickHz with an accumulator; in fixedStep mode it advances only through
// step(n), and every time-driven visual reads the frame counter, so captures are deterministic.
// M8: the game flow (main menu, skirmish, pause, saves, settings, end screen) is a `screen` here; the
// sim only runs while no menu screen is up. menuBridge.ts turns this state into the menu view model.
import { SKIRMISH_DEFAULTS, validatePack, type ValidatedPack } from "@hearthfall/data";
import { CAT, World, commandsByTick, createScenarioWorld, shaperIndex, wrapDelta, type Command, type ScenarioDef, type SimEvent } from "@hearthfall/sim";
import { ThreeRenderer, type CameraState } from "@hearthfall/render";
import { DEFAULT_AI } from "./opponents.ts";
import { actionFor, spellSlot, type KeyAction, type Screen } from "@hearthfall/ui";
import { LOG_TAIL, createSkirmish, type SaveGame, type SkirmishParams } from "./session.ts";
import { QUALITY_SCALE, browserKV, loadSettings, type KV, type Settings } from "./storage.ts";
import { AudioHooks } from "@hearthfall/audio";
import { buildingAt, troopCommand, type TroopIntent } from "./troops.ts";

const packFiles = import.meta.glob("../../../data/base/*.json", { eager: true, import: "default" });
const scenarioFiles = import.meta.glob("../../../scenarios/*.json", { eager: true, import: "default" });

export function loadPack(): ValidatedPack {
  const raw: Record<string, unknown> = {};
  for (const [path, json] of Object.entries(packFiles)) raw[path.split("/").pop()!] = json;
  const res = validatePack(raw);
  if (!res.pack) throw new Error("data pack invalid: " + res.issues.slice(0, 3).map((i) => `${i.file} ${i.path} ${i.message}`).join("; "));
  return res.pack;
}

export function findScenario(id: string): ScenarioDef | undefined {
  for (const json of Object.values(scenarioFiles)) if ((json as ScenarioDef).id === id) return json as ScenarioDef;
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
}

export function parseParams(search: string): GameParams {
  const q = new URLSearchParams(search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
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
  };
}

export interface Note {
  id: number;
  text: string;
  kind: "good" | "bad" | "info";
  /** tick the note disappears */
  until: number;
}

const NOTE_SECONDS = 8;
const MAX_NOTES = 4;

export interface DebugFlags {
  hideTerrain?: boolean;
  blackCanvas?: boolean;
  magentaMaterials?: boolean;
  overlapHud?: boolean;
  freezeCamera?: boolean;
}

export class Game {
  readonly pack = loadPack();
  world!: World;
  readonly renderer: ThreeRenderer;
  params: GameParams;
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
  placeBlocked: string | null = null;
  private placeAt: [number, number] | null = null;
  showHelp = true;
  /** spell id being targeted (preview follows the cursor) */
  targeting: string | null = null;
  /** M6: selected own building index (lodge or tower panel), -1 for none; "rally" while picking a rally point */
  selectedBuilding = -1;
  pointing: string | null = null;
  private events: SimEvent[] = [];
  /** combat and world events to audio cues; no playback sink until A4 (M10), so every cue is a silent stub */
  readonly audio: AudioHooks;
  onChange: () => void = () => {};

  readonly canvas: HTMLCanvasElement;

  // ---- M8 game flow
  screen: Screen = "none";
  /** screens to return to with Back or Escape */
  backStack: Screen[] = [];
  /** true while a match is loaded (pause menu, saving); false on the main menu backdrop */
  inGame = true;
  /** the running skirmish (null for scenarios and the menu backdrop): what a save rebuilds from */
  skirmish: SkirmishParams | null = null;
  /** local commands applied so far this session (tail kept), stored in saves */
  log: Command[] = [];
  ended: { won: boolean } | null = null;
  stats = { kills: 0, lost: 0 };
  readonly kv: KV;
  readonly persistent: boolean;
  settings: Settings;
  /** key action waiting for its new key in the settings screen */
  rebinding: KeyAction | null = null;
  /** set by the menu bridge while a key binding waits for its key */
  onRebindKey: ((e: KeyboardEvent) => void) | null = null;
  /** HUD notifications (sim ticks, so fixedStep captures see the same list); newest last */
  notes: Note[] = [];
  private noteSeq = 0;
  private noteLast = new Map<string, number>();
  lastSave: { tick: number; hash: string } | null = null;
  lastLoad: { tick: number; hash: string } | null = null;

  constructor(canvas: HTMLCanvasElement, params: GameParams) {
    this.canvas = canvas;
    this.params = params;
    this.paused = params.paused || params.fixedStep;
    this.renderer = new ThreeRenderer({ canvas, style: this.pack.files.style, heightUnitsPerWorldUnit: this.pack.files.balance.terrain.heightUnitsPerWorldUnit });
    this.audio = new AudioHooks(this.pack.files.style.audio?.cues ?? {}, new Set());
    const store = browserKV();
    this.kv = store.kv;
    this.persistent = store.persistent;
    this.settings = loadSettings(this.kv);
    this.applyQuality();
    if (params.menu && !params.scenario) this.showMainMenu();
    else this.load();
    this.bindInput();
  }

  /** Render scale from the URL override or the stored setting. */
  applyQuality(): void {
    const q = this.params.quality ?? this.settings.quality;
    this.renderer.setRenderScale(QUALITY_SCALE[q] ?? 1);
  }

  /** (Re)build the world from params: a scenario id, or a procedural planet. */
  load(scenarioId: string | null = this.params.scenario): void {
    const p = this.pack;
    const def = scenarioId ? findScenario(scenarioId) : undefined;
    if (scenarioId && !def) throw new Error(`unknown scenario ${scenarioId}`);
    const sp: SkirmishParams = { seed: this.params.seed, level: this.params.level, size: this.params.size, tribes: this.params.tribes, ai: [...this.params.ai], difficulty: this.params.difficulty };
    this.world = def ? createScenarioWorld(def, p.files, p.hash) : createSkirmish(p, sp);
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
    this.selectedBuilding = -1;
    this.placing = null;
    this.placeAt = null;
    this.targeting = null;
    this.pointing = null;
    this.attackMode = false;
    this.queue = [];
    this.events = [];
    this.log = [];
    this.ended = null;
    this.stats = { kills: 0, lost: 0 };
    this.notes = [];
    this.noteLast.clear();
    this.renderer.setPlacement(null);
    this.renderer.setTargeting(null);
    this.renderer.setWorld(this.world);
    const home = this.world.tribes[0] ? this.world.ents.index(this.world.tribes[0].hearth) : -1;
    const size = this.world.terrain.size;
    this.renderer.setCamera({ x: home >= 0 ? this.world.ents.x[home] : size / 2, z: home >= 0 ? this.world.ents.y[home] + 1 : size / 2 });
    this.renderer.setCamera(this.params.camera ?? "default");
  }

  // ---------------------------------------------------------------- game flow (M8)
  /** A new skirmish from the setup screen (or Play again): the params replace the URL ones. */
  startSkirmish(sp: SkirmishParams): void {
    this.params = { ...this.params, seed: sp.seed, level: sp.level, size: sp.size, tribes: sp.tribes, ai: [...sp.ai], difficulty: sp.difficulty, scenario: null, camera: null };
    this.load(null);
    this.paused = this.params.fixedStep;
  }

  /** The main menu over a still planet (no opponents, the sim does not run). */
  showMainMenu(): void {
    const sk = this.pack.files.balance.skirmish ?? SKIRMISH_DEFAULTS;
    this.params = { ...this.params, scenario: null };
    this.world = createSkirmish(this.pack, { seed: this.params.seed, level: sk.maps[0], size: sk.defaultSize, tribes: 2, ai: ["none"], difficulty: sk.defaultDifficulty });
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
    this.params = { ...this.params, seed: sp.seed, level: sp.level, size: sp.size, tribes: sp.tribes, ai: [...sp.ai], difficulty: sp.difficulty, scenario: null, camera: null };
    this.world = w;
    this.scenarioCmds = null;
    this.afterWorld();
    this.skirmish = { ...sp, ai: [...sp.ai] };
    this.log = [...s.log];
    this.queue = s.pending.map((c) => ({ ...c }));
    this.inGame = true;
    this.lastLoad = { tick: w.tick, hash: w.hash().all };
    this.screen = "none";
    this.backStack = [];
    this.paused = this.params.fixedStep;
    this.onChange();
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
    if (this.screen === "main" || this.screen === "end" || this.screen === "none") return;
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
    return Boolean(this.targeting || this.placing || this.pointing || this.attackMode || this.selection.size || this.selectedBuilding >= 0);
  }

  /** Victory when every rival tribe is eliminated, defeat when the local tribe is (skirmish only). */
  private checkEnd(): void {
    if (!this.skirmish || this.ended || this.world.tribes.length < 2) return;
    const ts = this.world.tribes;
    const me = ts[this.localTribe];
    const rivalsOut = ts.every((t) => t.index === this.localTribe || !t.alive);
    if (me?.alive && !rivalsOut) return;
    this.ended = { won: Boolean(me?.alive) };
    this.cancelModes();
    this.screen = "end";
    this.backStack = [];
    this.onChange();
  }

  /** Commands queued for the next tick (saved with the game). */
  pendingCommands(): Command[] {
    return this.queue.map((c) => ({ ...c }));
  }

  /** Queue a command from the local player (applied on the next tick). */
  command(c: Partial<Command> & { type: string }): void {
    this.queue.push({ tick: this.world.tick, tribe: c.tribe ?? 0, type: c.type, args: c.args ?? {} });
  }

  private stepOnce(): void {
    const local = this.queue.map((c) => ({ ...c, tick: this.world.tick }));
    const cmds = [...(this.scenarioCmds ? this.scenarioCmds(this.world.tick) : []), ...local];
    this.queue = [];
    this.world.step(cmds);
    if (this.skirmish && local.length) {
      this.log.push(...local);
      if (this.log.length > 2 * LOG_TAIL) this.log = this.log.slice(-LOG_TAIL);
    }
    for (const e of this.world.events) {
      this.events.push(e);
      if ((e.type === "killed" || e.type === "drowned") && e.cat === CAT.unit) {
        if (e.tribe === this.localTribe) this.stats.lost++;
        else if (e.by === this.localTribe && typeof e.tribe === "number" && e.tribe >= 0) this.stats.kills++;
      }
      this.noteFor(e);
    }
    const si = shaperIndex(this.world, this.localTribe);
    const E = this.world.ents;
    if (si >= 0 && E.hitTick[si] === this.world.tick - 1 && E.lastHit[si] >= 0 && E.lastHit[si] !== this.localTribe) this.notify("shaperHit", "Your Shaper is under attack!", "bad", 15);
    this.checkEnd();
  }

  /** Add a HUD notification; `key` throttles repeats to one per `throttleSec` of game time. */
  notify(key: string, text: string, kind: Note["kind"], throttleSec = 0): void {
    const hz = this.world.cfg.tickHz;
    const t = this.world.tick;
    const last = this.noteLast.get(key);
    if (last !== undefined && t - last < throttleSec * hz) return;
    this.noteLast.set(key, t);
    this.notes = [...this.notes.filter((n) => n.until > t), { id: ++this.noteSeq, text, kind, until: t + NOTE_SECONDS * hz }].slice(-MAX_NOTES);
  }

  private noteFor(e: SimEvent): void {
    const me = this.localTribe;
    const rival = (t: unknown) => typeof t === "number" && t >= 0 && t !== me;
    switch (e.type) {
      case "shaperDied":
        if (e.tribe === me) this.notify("shaperDied", "Your Shaper has fallen and will return at the Hearth.", "bad");
        break;
      case "shaperRespawned":
        if (e.tribe === me) this.notify("shaperBack", "Your Shaper is back at the Hearth.", "good");
        break;
      case "killed":
        if (e.tribe === me && rival(e.by)) this.notify("underAttack", "Your followers are under attack!", "bad", 20);
        break;
      case "destroyed":
        if (e.tribe === me) this.notify("lostBuilding", "One of your buildings was destroyed.", "bad", 5);
        break;
      case "tribeEliminated":
        if (rival(e.tribe)) {
          const left = this.world.tribes.filter((t) => t.index !== me && t.alive).length;
          const name = this.world.tribes[e.tribe as number]?.color ?? "rival";
          this.notify(`out${e.tribe}`, `The ${name} tribe has fallen${left ? `: ${left} left` : ""}.`, "good");
        }
        break;
      case "tierReached":
        if (e.tribe === me) this.notify(`tier${e.tier}`, `New tier: ${String(e.id).replace(/_/g, " ")}. New buildings are open.`, "good");
        break;
      case "castFailed":
        if (e.tribe === me) this.notify("castFailed", "The spell failed: the Shaper could not reach the target.", "info", 3);
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
    if (!this.paused && this.screen === "none") {
      this.acc += dt;
      const tickDt = 1 / this.world.cfg.tickHz;
      let n = 0;
      while (this.acc >= tickDt && n < 8 && !this.ended) {
        this.stepOnce();
        this.acc -= tickDt;
        n++;
      }
      if (n) this.onChange();
    } else this.acc = 0;
    // the main menu backdrop turns slowly (not in fixedStep captures)
    if (this.screen === "main" && !this.params.fixedStep && !this.debugFlags.freezeCamera) this.renderer.setCamera({ yaw: this.renderer.cam.yaw + 0.04 * dt });
    this.pollKeys(dt);
    this.pruneSelection();
    this.renderer.selected = this.selection;
    this.renderer.alpha = this.paused ? 1 : Math.min(1, this.acc * this.world.cfg.tickHz);
    if (this.events.length) {
      const hz = this.world.cfg.tickHz;
      const wall = now / 1000;
      this.renderer.consumeEvents(this.events, this.params.fixedStep ? (e) => (e.tick + 1) / hz : () => wall);
      this.audio.consume(this.events);
      this.events = [];
    }
    // fixedStep: visuals follow the sim tick, so re-rendering the same tick gives identical pixels
    const visualTime = this.params.fixedStep ? this.world.tick / this.world.cfg.tickHz : now / 1000;
    this.renderer.render(visualTime);
  }

  // ---------------------------------------------------------------- selection and orders
  private pruneSelection(): void {
    const E = this.world.ents;
    for (const i of [...this.selection]) if (!E.alive[i] || E.tribe[i] !== this.localTribe) this.selection.delete(i);
    if (this.selectedBuilding >= 0 && !E.alive[this.selectedBuilding]) this.selectedBuilding = -1;
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
      if (Number.isNaN(sx) || !E.alive[i] || E.tribe[i] !== this.localTribe) continue;
      const d = (sx - px) * (sx - px) + (u.screenY[i] - py) * (u.screenY[i] - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  selectBox(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const u = this.renderer.units;
    if (!u) return;
    if (!add) this.selection.clear();
    const E = this.world.ents;
    const [lx, hx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [ly, hy] = y0 < y1 ? [y0, y1] : [y1, y0];
    for (let i = 0; i < E.hi; i++) {
      const sx = u.screenX[i];
      if (Number.isNaN(sx) || !E.alive[i] || E.tribe[i] !== this.localTribe) continue;
      if (sx >= lx && sx <= hx && u.screenY[i] >= ly && u.screenY[i] <= hy) this.selection.add(i);
    }
    if (this.selection.size) this.selectedBuilding = -1;
    this.onChange();
  }

  /** M6 troop intents (HUD buttons, hotkeys, right clicks) as Commands. */
  troop(it: TroopIntent): boolean {
    const c = troopCommand(this.world, this.localTribe, [...this.selection], this.selectedBuilding, it);
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
    if (!this.selection.size && this.selectedBuilding >= 0) return this.troop({ kind: "rally", at: [p.x, p.z] });
    if (!this.selection.size) return false;
    const E = this.world.ents;
    const b = attack ? -1 : buildingAt(this.world, this.localTribe, p.x, p.z);
    if (b >= 0 && this.world.combat.garrisonOf(E.type[b]) > 0) return this.troop({ kind: "garrison", tower: b });
    this.command({ tribe: this.localTribe, type: "move", args: { units: [...this.selection].map((i) => E.idOf(i)), to: [p.x, p.z], attack } });
    return true;
  }

  startPlacing(building: string): void {
    const type = this.world.cfg.buildingIndex.get(building);
    // progression: a locked building cannot be picked (god mode sandboxes ignore locks)
    if (type !== undefined && !this.world.godMode && this.world.economy.buildingLock(this.localTribe, type)) return;
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
    this.command({ tribe: this.localTribe, type: "placePlan", args: { building: this.placing, at: this.placeAt } });
    this.cancelPlacing();
  }

  /** Spells the local tribe can cast, in spell bar order (hotkeys: SPELL_KEYS in @hearthfall/ui). */
  castable(): string[] {
    const w = this.world;
    const tr = w.tribes[this.localTribe];
    if (!tr) return [];
    return w.cfg.pack.spells.spells.filter((_, i) => tr.eco.unlocked[i]).map((s) => s.id);
  }

  startTargeting(spell: string): void {
    this.cancelPlacing();
    this.targeting = spell;
    this.onChange();
  }

  cancelTargeting(): void {
    this.targeting = null;
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
    const radius = Math.max(0.8, ...s.effects.map((e) => ("radius" in e && typeof e.radius === "number" ? e.radius : 0)));
    this.renderer.setTargeting({ cx: w.ents.x[si], cz: w.ents.y[si], range: s.range, x: p.x, z: p.z, r: radius, inRange: Math.sqrt(dx * dx + dy * dy) <= s.range });
  }

  castAt(px: number, py: number): boolean {
    if (!this.targeting) return false;
    const p = this.renderer.pickTerrain(px, py);
    if (!p) return false;
    this.command({ tribe: this.localTribe, type: "cast", args: { spell: this.targeting, target: [p.x, p.z] } });
    this.cancelTargeting();
    return true;
  }

  selectKind(kind: string, center = true): void {
    const idx = this.world.selectUnits(`tribe${this.localTribe}.${kind}s`);
    this.selection = new Set(idx);
    if (center && idx.length) this.renderer.setCamera({ x: this.world.ents.x[idx[0]], z: this.world.ents.y[idx[0]] });
    this.onChange();
  }

  // ---------------------------------------------------------------- input
  private bindInput(): void {
    let down: { x: number; y: number } | null = null;
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("mousedown", (e) => {
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
      if (this.placing) this.updatePlacement(e.clientX, e.clientY);
      if (this.targeting) this.updateTargeting(e.clientX, e.clientY);
      if (down && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)) {
        this.box = { x0: down.x, y0: down.y, x1: e.clientX, y1: e.clientY };
        this.onChange();
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button !== 0 || !down) return;
      if (this.box) this.selectBox(this.box.x0, this.box.y0, this.box.x1, this.box.y1, e.shiftKey);
      else if (this.attackMode) {
        this.orderAt(e.clientX, e.clientY, true);
        this.attackMode = false;
      } else {
        const i = this.unitAt(e.clientX, e.clientY);
        if (!e.shiftKey) this.selection.clear();
        if (i >= 0) {
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
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const z = this.renderer.cam.zoom + Math.sign(e.deltaY) * 0.05;
      this.renderer.setCamera({ zoom: Math.min(1, Math.max(0, z)) });
    }, { passive: false });
    let drag: { x: number; y: number; pan: boolean } | null = null;
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
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
    const k = e.key.toLowerCase();
    this.keys.add(k);
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
        this.selection = new Set(this.groups[g].map((id) => E.index(id)).filter((i) => i >= 0));
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
    this.renderer.setCamera({ x: c.x + (cy * right - sy * forward) * s, z: c.z + (-sy * right - cy * forward) * s });
  }

  private pollKeys(dt: number): void {
    if (this.debugFlags.freezeCamera) return;
    const k = this.keys;
    const sp = 18 * dt;
    const km = this.settings.keymap;
    if (k.has(km.rotateLeft.toLowerCase())) this.renderer.setCamera({ yaw: this.renderer.cam.yaw + 1.6 * dt });
    if (k.has(km.rotateRight.toLowerCase())) this.renderer.setCamera({ yaw: this.renderer.cam.yaw - 1.6 * dt });
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
      screen: this.screen,
      ended: this.ended,
      seed: w.seed,
      map: { ...w.mapInfo, size: w.terrain.size },
      packHash: w.cfg.packHash,
      hash: w.hash().all,
      tribes: w.tribes.map((t) => {
        const h = E.index(t.hearth);
        return {
          index: t.index,
          color: t.color,
          alive: t.alive,
          hearth: h >= 0 ? [+E.x[h].toFixed(2), +E.y[h].toFixed(2)] : null,
          units: w.count((i) => E.cat[i] === CAT.unit && E.tribe[i] === t.index),
          buildings: w.count((i) => E.cat[i] === CAT.building && E.tribe[i] === t.index),
        };
      }),
      counts: { trees: w.count((i) => E.cat[i] === CAT.tree), wild: w.count((i) => E.cat[i] === CAT.unit && E.tribe[i] === -1), entities: E.count },
      terrainVersion: w.terrain.version,
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
    document.body.classList.toggle("debug-overlap-hud", Boolean(this.debugFlags.overlapHud));
    this.onChange();
  }
}

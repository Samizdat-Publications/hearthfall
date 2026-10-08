// Game wiring: data pack + sim World + renderer + input + the window.__game debug API.
// The sim advances at a fixed tickHz with an accumulator; in fixedStep mode it advances only through
// step(n), and every time-driven visual reads the frame counter, so captures are deterministic.
import { validatePack, type ValidatedPack } from "@hearthfall/data";
import { CAT, World, commandsByTick, createScenarioWorld, type Command, type ScenarioDef } from "@hearthfall/sim";
import { ThreeRenderer, type CameraState } from "@hearthfall/render";

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
  quality: string;
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
    quality: q.get("quality") ?? "high",
  };
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
  onChange: () => void = () => {};

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, params: GameParams) {
    this.canvas = canvas;
    this.params = params;
    this.paused = params.paused || params.fixedStep;
    this.renderer = new ThreeRenderer({ canvas, style: this.pack.files.style, heightUnitsPerWorldUnit: this.pack.files.balance.terrain.heightUnitsPerWorldUnit });
    this.load();
    this.bindInput();
  }

  /** (Re)build the world from params: a scenario id, or a procedural planet. */
  load(scenarioId: string | null = this.params.scenario): void {
    const p = this.pack;
    const def = scenarioId ? findScenario(scenarioId) : undefined;
    if (scenarioId && !def) throw new Error(`unknown scenario ${scenarioId}`);
    this.world = def ? createScenarioWorld(def, p.files, p.hash) : new World({ pack: p.files, packHash: p.hash, seed: this.params.seed, map: { generator: this.params.level, size: this.params.size, tribes: this.params.tribes } });
    this.scenarioCmds = def ? commandsByTick(def.commands) : null;
    this.selection.clear();
    this.renderer.setWorld(this.world);
    const home = this.world.tribes[0] ? this.world.ents.index(this.world.tribes[0].hearth) : -1;
    const size = this.world.terrain.size;
    this.renderer.setCamera({ x: home >= 0 ? this.world.ents.x[home] : size / 2, z: home >= 0 ? this.world.ents.y[home] + 6 : size / 2 });
    this.renderer.setCamera(this.params.camera ?? "default");
    this.onChange();
  }

  /** Queue a command from the local player (applied on the next tick). */
  command(c: Partial<Command> & { type: string }): void {
    this.queue.push({ tick: this.world.tick, tribe: c.tribe ?? 0, type: c.type, args: c.args ?? {} });
  }

  private stepOnce(): void {
    const cmds = [...(this.scenarioCmds ? this.scenarioCmds(this.world.tick) : []), ...this.queue.map((c) => ({ ...c, tick: this.world.tick }))];
    this.queue = [];
    this.world.step(cmds);
  }

  step(n = 1): number {
    for (let i = 0; i < n; i++) this.stepOnce();
    this.onChange();
    return this.world.tick;
  }

  frame(now: number): void {
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.paused) {
      this.acc += dt;
      const tickDt = 1 / this.world.cfg.tickHz;
      let n = 0;
      while (this.acc >= tickDt && n < 8) {
        this.stepOnce();
        this.acc -= tickDt;
        n++;
      }
      if (n) this.onChange();
    }
    this.pollKeys(dt);
    this.pruneSelection();
    this.renderer.selected = this.selection;
    this.renderer.alpha = this.paused ? 1 : Math.min(1, this.acc * this.world.cfg.tickHz);
    // fixedStep: visuals follow the sim tick, so re-rendering the same tick gives identical pixels
    const visualTime = this.params.fixedStep ? this.world.tick / this.world.cfg.tickHz : now / 1000;
    this.renderer.render(visualTime);
  }

  // ---------------------------------------------------------------- selection and orders
  private pruneSelection(): void {
    const E = this.world.ents;
    for (const i of [...this.selection]) if (!E.alive[i] || E.tribe[i] !== this.localTribe) this.selection.delete(i);
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
    this.onChange();
  }

  /** Order the selection to the terrain point under a screen pixel. */
  orderAt(px: number, py: number, attack = false): boolean {
    if (!this.selection.size) return false;
    const p = this.renderer.pickTerrain(px, py);
    if (!p) return false;
    const E = this.world.ents;
    this.command({ tribe: this.localTribe, type: "move", args: { units: [...this.selection].map((i) => E.idOf(i)), to: [p.x, p.z], attack } });
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
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
      if (e.button === 2) {
        this.orderAt(e.clientX, e.clientY, this.attackMode);
        this.attackMode = false;
      }
    });
    window.addEventListener("mousemove", (e) => {
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
          if (e.shiftKey && this.selection.has(i)) this.selection.delete(i);
          else this.selection.add(i);
        }
        this.onChange();
      }
      down = null;
      this.box = null;
      this.onChange();
    });
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "escape") {
        this.selection.clear();
        this.attackMode = false;
        this.onChange();
      }
      if (k === "a" && this.selection.size) this.attackMode = true;
      if (k === "s" && !e.ctrlKey) this.selectKind("shaper");
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
    });
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      const k = e.key;
      if (k === "m" || k === "M") this.renderer.setCamera({ map: !this.renderer.cam.map });
      if (k === " ") this.paused = !this.paused;
      const f = ["F1", "F2", "F3", "F4"].indexOf(k);
      if (f >= 0) {
        e.preventDefault();
        if (e.ctrlKey || e.shiftKey) this.bookmarks[f] = { ...this.renderer.cam };
        else if (this.bookmarks[f]) this.renderer.setCamera(this.bookmarks[f]!);
      }
    });
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
    if (k.has("q")) this.renderer.setCamera({ yaw: this.renderer.cam.yaw + 1.6 * dt });
    if (k.has("e")) this.renderer.setCamera({ yaw: this.renderer.cam.yaw - 1.6 * dt });
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
      render: { ...this.renderer.stats },
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

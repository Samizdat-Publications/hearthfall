// HUD (M4, layout v2 after ADR-005): Preact DOM overlay driven by a plain HudModel. The UI never
// touches the sim: it renders the model and calls back into the app, which turns intents into
// Commands. Layout follows the target look: Shaper portrait and bars top-left, spells top-center,
// build tools in the right column, minimap with population bottom-right.
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";

export interface SpellView {
  id: string;
  name: string;
  tier: number;
  cost: number;
  charges: number;
  max: number;
  /** 0..1 progress toward the next charge */
  progress: number;
  auto: boolean;
  charging: boolean;
  hotkey: string;
  /** time to the next charge ("12s", "3m"), "" when full, manual or without income */
  eta: string;
}

/** M6 troop panel: what the selection can be told to do. */
export interface TroopView {
  kind: "none" | "units" | "lodge" | "tower";
  label: string;
  /** stance shared by the whole unit selection, else null (mixed) */
  stance: "aggressive" | "defensive" | "passive" | null;
  /** an own Watchtower with free room exists (units: Garrison button) */
  canGarrison: boolean;
  /** lodge: walkers and trainees queued; tower: units inside */
  count: number;
  /** lodge: queue size; tower: garrison slots */
  max: number;
  /** lodge has a rally point */
  rally: boolean;
  /** lodge or tower is still being built */
  building: boolean;
  /** unit selection by kind (M8 selected units panel) */
  units: { name: string; count: number; hpFrac: number }[];
}

export interface NoteView {
  id: number;
  text: string;
  kind: "good" | "bad" | "info";
}

export interface ObjectiveView {
  text: string;
  done: boolean;
  /** data-hud-part tag for tests */
  part?: string;
}

export const STANCES = ["aggressive", "defensive", "passive"] as const;

export interface HudModel {
  title: string;
  mapLine: string;
  tick: number;
  paused: boolean;
  pop: number;
  cap: number;
  manaPerMin: number;
  spellsPct: number;
  wasting: boolean;
  spells: SpellView[];
  selected: number;
  attack: boolean;
  placing: string | null;
  placeBlocked: string | null;
  targeting: string | null;
  /** build tools; `locked` says what progression still needs ("needs 10 followers") */
  buildable: { id: string; name: string; wood: number; key: string; locked: string | null }[];
  /** next progression tier: name, followers needed and what it opens; null when all are open */
  /** M8: objectives panel (rivals left, Hearth, next tier) and event notifications, newest last */
  objectives: ObjectiveView[];
  notes: NoteView[];
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  showHelp: boolean;
  priorities: { build: number; upgrade: number; breed: number };
  /** Shaper state for the portrait: alive, or seconds until respawn (-1 when eliminated) */
  shaper: { alive: boolean; respawnSec: number; hpFrac: number };
  /** 0..1 progress of the spell currently charging (the mana bar) */
  manaFrac: number;
  troops: TroopView;
  /** "rally" while the next left click sets the selected lodge's rally point */
  pointing: string | null;
}

export interface HudActions {
  setSplit(pct: number): void;
  toggleAuto(spell: string): void;
  startPlacing(building: string): void;
  cancel(): void;
  togglePriority(key: "build" | "upgrade" | "breed"): void;
  target(spell: string): void;
  /** paint the minimap into a canvas (the app reads sim state; the UI only hosts the canvas) */
  drawMinimap(canvas: HTMLCanvasElement): void;
  /** jump the camera to a normalized minimap point */
  minimapJump(u: number, v: number): void;
  /** M6 troop controls */
  train(n: number): void;
  startRally(): void;
  clearRally(): void;
  ungarrison(): void;
  garrison(): void;
  retreat(): void;
  setStance(s: (typeof STANCES)[number]): void;
}

function Troops({ t, act, pointing }: { t: TroopView; act: HudActions; pointing: string | null }) {
  if (t.kind === "none") return null;
  return (
    <div data-hud="troops" class="hud-panel hud-troops">
      <span class="troops-label">{t.label}</span>
      {t.units.length ? (
        <div class="troops-units">
          {t.units.map((u) => (
            <span key={u.name} class="unit-chip" title={`${u.count} ${u.name}, health ${Math.round(u.hpFrac * 100)}%`}>
              <b>{u.count}</b> {u.name}
              <span class="unit-hp" style={{ width: Math.round(u.hpFrac * 100) + "%" }} />
            </span>
          ))}
        </div>
      ) : null}
      {t.kind === "units" ? (
        <div class="troops-row">
          {STANCES.map((s) => (
            <button key={s} class={"prio" + (t.stance === s ? " on" : "")} title={`Stance: ${s}`} onClick={() => act.setStance(s)}>
              {s[0].toUpperCase() + s.slice(1, 3)}
            </button>
          ))}
          <button class="prio" title="Run to the nearest own Watchtower, else the Hearth (R)" onClick={() => act.retreat()}>
            Retreat
          </button>
          {t.canGarrison ? (
            <button class="prio" title="Garrison in the nearest Watchtower with room (G)" onClick={() => act.garrison()}>
              Garrison
            </button>
          ) : null}
        </div>
      ) : null}
      {t.kind === "lodge" && !t.building ? (
        <div class="troops-row">
          <button class="prio" title="Send the nearest free settler to train" onClick={() => act.train(1)} disabled={t.count >= t.max}>
            Train 1
          </button>
          <button class="prio" title="Send up to five free settlers to train" onClick={() => act.train(5)} disabled={t.count >= t.max}>
            Train 5
          </button>
          <button class={"prio" + (pointing === "rally" ? " on" : "")} title="Then left click the ground where graduates gather. With a lodge selected, right click also sets it." onClick={() => act.startRally()}>
            Rally
          </button>
          {t.rally ? (
            <button class="prio" title="Graduates stay at the lodge door" onClick={() => act.clearRally()}>
              No rally
            </button>
          ) : null}
        </div>
      ) : null}
      {t.kind === "tower" && !t.building ? (
        <div class="troops-row">
          <button class="prio" title="Everyone inside steps out" onClick={() => act.ungarrison()} disabled={t.count <= 0}>
            Ungarrison
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const hudModel = signal<HudModel | null>(null);

function SpellButton({ s, act }: { s: SpellView; act: HudActions }) {
  const ring = 2 * Math.PI * 17;
  const full = s.charges >= s.max;
  return (
    <button class={"spell" + (s.auto ? " auto" : "") + (full ? " full" : "")} title={`${s.name}: ${s.cost} mana, ${s.charges}/${s.max} charges. Click to cast, right click to toggle auto-charge.`} onClick={() => act.target(s.id)} onContextMenu={(e) => { e.preventDefault(); act.toggleAuto(s.id); }} data-tier={s.tier}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="17" class="ring-bg" />
        <circle cx="22" cy="22" r="17" class="ring" style={{ strokeDasharray: `${ring * (full ? 1 : s.progress)} ${ring}` }} transform="rotate(-90 22 22)" />
        <text x="22" y="27" text-anchor="middle" class="glyph">
          {s.name.slice(0, 2)}
        </text>
      </svg>
      <span class="charges">{s.charges}</span>
      {s.eta ? <span class="eta">{s.eta}</span> : null}
      <span class="hotkey">{s.hotkey}</span>
    </button>
  );
}

function Portrait() {
  // placeholder Shaper portrait: feathered headdress, hide cloak, carved staff (icons arrive in M10)
  return (
    <svg class="portrait" viewBox="0 0 32 32" width="64" height="64" aria-hidden="true" shape-rendering="crispEdges">
      <rect width="32" height="32" fill="#141a2e" />
      <rect x="3" y="2" width="2" height="1" fill="#f4f1ea" />
      <rect x="26" y="5" width="1" height="1" fill="#f4f1ea" />
      <rect x="7" y="4" width="2" height="26" fill="#8b5a2b" />
      <rect x="6" y="3" width="4" height="3" fill="#b07cff" />
      <rect x="13" y="4" width="2" height="5" fill="#c8312e" />
      <rect x="16" y="3" width="2" height="6" fill="#e0a12a" />
      <rect x="19" y="4" width="2" height="5" fill="#2fa36b" />
      <rect x="13" y="9" width="8" height="2" fill="#5e3a1a" />
      <rect x="14" y="11" width="6" height="6" fill="#b98058" />
      <rect x="15" y="13" width="1" height="1" fill="#2b1d13" />
      <rect x="18" y="13" width="1" height="1" fill="#2b1d13" />
      <rect x="11" y="17" width="12" height="13" fill="#7c5a3a" />
      <rect x="16" y="17" width="2" height="13" fill="#2e6fd8" />
      <rect x="9" y="19" width="3" height="3" fill="#b98058" />
    </svg>
  );
}

function Bar({ kind, frac, label }: { kind: "mana" | "pop"; frac: number; label: string }) {
  return (
    <div class={"bar bar-" + kind} title={label}>
      <span class="bar-glyph" aria-hidden="true">{kind === "mana" ? "◆" : "✚"}</span>
      <span class="bar-track">
        <span class="bar-fill" style={{ width: Math.round(Math.min(1, Math.max(0, frac)) * 100) + "%" }} />
        <span class="bar-text">{label}</span>
      </span>
    </div>
  );
}

function Minimap({ m, act }: { m: HudModel; act: HudActions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) act.drawMinimap(ref.current);
  });
  return (
    <div data-hud="minimap" class="hud-panel hud-minimap">
      <div class="mm-pop" title="Followers / housing">
        <span class="mm-icon" aria-hidden="true">{"☺"}</span>
        <b class={m.pop >= m.cap ? "warn" : ""}>{m.pop}</b>
        <span class="mm-cap">/{m.cap}</span>
      </div>
      <canvas
        ref={ref}
        class="mm-canvas"
        width={128}
        height={128}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
          act.minimapJump((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }}
      />
    </div>
  );
}

function Hud({ act }: { act: HudActions }) {
  const m = hudModel.value;
  if (!m) return null;
  const b = m.box;
  return (
    <>
      <div data-hud="shaper" class={"hud-panel hud-shaper" + (m.shaper.alive ? "" : " dead")}>
        <Portrait />
        <span class="shaper-name">{m.shaper.alive ? "Shaper" : m.shaper.respawnSec >= 0 ? `back in ${m.shaper.respawnSec}s` : "fallen"}</span>
        <span class="shaper-hp" style={{ width: Math.round(m.shaper.hpFrac * 100) + "%" }} />
      </div>
      <div data-hud="resources" class="hud-panel hud-resources">
        <Bar kind="mana" frac={m.manaFrac} label={`Mana ${Math.round(m.manaPerMin)}/min`} />
        <Bar kind="pop" frac={m.cap > 0 ? m.pop / m.cap : 0} label={`Followers ${m.pop}/${m.cap}`} />
        {m.wasting ? <span class="waste" title="No spell or training can absorb mana: toggle auto-charge on a spell">mana wasting: auto-charge a spell</span> : null}
        <label class="res-row split">
          <span class="res-label">Spells {m.spellsPct}%</span>
          <input type="range" min="0" max="100" step="5" value={m.spellsPct} onInput={(e) => act.setSplit(Number((e.target as HTMLInputElement).value))} aria-label="Mana split between spells and training" />
          <span class="res-label">Training</span>
        </label>
        <div class="res-row priorities" title="What idle settlers do on their own">
          {(["build", "upgrade", "breed"] as const).map((k) => (
            <button key={k} class={"prio" + (m.priorities[k] > 0 ? " on" : "")} onClick={() => act.togglePriority(k)}>
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div data-hud="spellbar" class={"hud-panel hud-spellbar" + (m.wasting ? " wasting" : "")} title={m.wasting ? "Mana is wasting: no spell is auto-charging and nothing is training. Right click a spell to auto-charge it." : undefined}>
        {m.spells.map((s) => (
          <SpellButton key={s.id} s={s} act={act} />
        ))}
      </div>
      <div data-hud="build" class="hud-panel hud-build">
        {m.buildable.map((bd) => (
          <button key={bd.id} class={"build-btn" + (m.placing === bd.id ? " active" : "") + (bd.locked ? " locked" : "")} disabled={bd.locked !== null} onClick={() => (m.placing === bd.id ? act.cancel() : act.startPlacing(bd.id))} title={`${bd.name}: ${bd.wood} wood${bd.key ? ` (${bd.key})` : ""}${bd.locked ? `, locked: ${bd.locked}` : ""}`}>
            {bd.name} {bd.key ? <span class="hotkey">{bd.key}</span> : null}
          </button>
        ))}
      </div>
      <div data-hud="title" class="hud-panel hud-title">
        <span class="hud-name">{m.title}</span>
        <span class="hud-sub">
          {m.mapLine} | tick {m.tick}
          {m.paused ? " | paused" : ""}
        </span>
      </div>
      <Minimap m={m} act={act} />
      {m.objectives.length ? (
        <div data-hud="objectives" class="hud-panel hud-objectives">
          <span class="obj-head">Objectives</span>
          {m.objectives.map((o) => (
            <span key={o.text} class={"obj" + (o.done ? " done" : "")} data-hud-part={o.part}>
              {o.done ? "\u2713 " : "\u25c7 "}
              {o.text}
            </span>
          ))}
        </div>
      ) : null}
      {m.notes.length ? (
        <div data-hud="notes" class="hud-panel hud-notes">
          {m.notes.map((n) => (
            <span key={n.id} class={"note " + n.kind}>
              {n.text}
            </span>
          ))}
        </div>
      ) : null}
      <Troops t={m.troops} act={act} pointing={m.pointing} />
      {m.selected > 0 || m.placing || m.targeting || m.pointing ? (
        <div data-hud="selection" class="hud-panel hud-selection">
          {m.pointing === "rally" ? "Rally point: left click the ground, right click or Esc to cancel" : m.targeting ? `Casting ${m.targeting.replace("_", " ")}: left click a target, right click or Esc to cancel, Backspace undoes a cast` : m.placing ? `Placing ${m.placing}: left click to place, Esc to cancel${m.placeBlocked ? ` (${m.placeBlocked})` : ""}` : `${m.selected} selected${m.attack ? " | attack-move: click a target" : " | right click to move"}`}
        </div>
      ) : null}
      {m.showHelp ? (
        <div data-hud="help" class="hud-panel hud-help">
          Drag select | click a building to select it | right click move (on a tower: garrison) | A attack-move | R retreat | G garrison | S Shaper | Z-N spells | D dwelling | T tower | Q/E rotate | wheel zoom | M map | H help
        </div>
      ) : null}
      <div data-hud="debug-overlap" class="hud-panel hud-overlap">
        overlap test panel
      </div>
      {b ? <div class="hud-box" style={{ left: Math.min(b.x0, b.x1) + "px", top: Math.min(b.y0, b.y1) + "px", width: Math.abs(b.x1 - b.x0) + "px", height: Math.abs(b.y1 - b.y0) + "px" }} /> : null}
    </>
  );
}

export function mountHud(el: HTMLElement, act: HudActions): void {
  render(<Hud act={act} />, el);
}

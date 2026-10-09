// HUD v1 (M4): Preact DOM overlay driven by a plain HudModel. The UI never touches the sim: it
// renders the model and calls back into the app, which turns intents into Commands.
import { render } from "preact";
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
}

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
  buildable: { id: string; name: string; wood: number; key: string }[];
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  showHelp: boolean;
  priorities: { build: number; upgrade: number; breed: number };
}

export interface HudActions {
  setSplit(pct: number): void;
  toggleAuto(spell: string): void;
  startPlacing(building: string): void;
  cancel(): void;
  togglePriority(key: "build" | "upgrade" | "breed"): void;
}

export const hudModel = signal<HudModel | null>(null);

function SpellButton({ s, act }: { s: SpellView; act: HudActions }) {
  const ring = 2 * Math.PI * 17;
  const full = s.charges >= s.max;
  return (
    <button class={"spell" + (s.auto ? " auto" : "") + (full ? " full" : "")} title={`${s.name}: ${s.cost} mana, ${s.charges}/${s.max} charges. Click to toggle auto-charge.`} onClick={() => act.toggleAuto(s.id)} data-tier={s.tier}>
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="17" class="ring-bg" />
        <circle cx="22" cy="22" r="17" class="ring" style={{ strokeDasharray: `${ring * (full ? 1 : s.progress)} ${ring}` }} transform="rotate(-90 22 22)" />
        <text x="22" y="27" text-anchor="middle" class="glyph">
          {s.name.slice(0, 2)}
        </text>
      </svg>
      <span class="charges">{s.charges}</span>
      <span class="hotkey">{s.hotkey}</span>
    </button>
  );
}

function Hud({ act }: { act: HudActions }) {
  const m = hudModel.value;
  if (!m) return null;
  const b = m.box;
  return (
    <>
      <div data-hud="title" class="hud-panel hud-title">
        <span class="hud-name">{m.title}</span>
        <span class="hud-sub">
          {m.mapLine} | tick {m.tick}
          {m.paused ? " | paused" : ""}
        </span>
      </div>
      <div data-hud="resources" class="hud-panel hud-resources">
        <div class="res-row">
          <span class="res-label">Population</span>
          <b class={m.pop >= m.cap ? "warn" : ""}>
            {m.pop}/{m.cap}
          </b>
        </div>
        <div class="res-row">
          <span class="res-label">Mana</span>
          <b>{Math.round(m.manaPerMin)}/min</b>
          {m.wasting ? <span class="waste" title="No spell or training can absorb mana: toggle auto-charge on a spell">wasting</span> : null}
        </div>
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
      <div data-hud="spellbar" class="hud-panel hud-spellbar">
        {m.spells.map((s) => (
          <SpellButton key={s.id} s={s} act={act} />
        ))}
      </div>
      <div data-hud="build" class="hud-panel hud-build">
        {m.buildable.map((bd) => (
          <button key={bd.id} class={"build-btn" + (m.placing === bd.id ? " active" : "")} onClick={() => (m.placing === bd.id ? act.cancel() : act.startPlacing(bd.id))} title={`${bd.name}: ${bd.wood} wood (${bd.key})`}>
            {bd.name} <span class="hotkey">{bd.key}</span>
          </button>
        ))}
      </div>
      {m.selected > 0 || m.placing ? (
        <div data-hud="selection" class="hud-panel hud-selection">
          {m.placing ? `Placing ${m.placing}: left click to place, Esc to cancel${m.placeBlocked ? ` (${m.placeBlocked})` : ""}` : `${m.selected} selected${m.attack ? " | attack-move: click a target" : " | right click to move"}`}
        </div>
      ) : null}
      {m.showHelp ? (
        <div data-hud="help" class="hud-panel hud-help">
          Drag select | right click move | A attack-move | S Shaper | D dwelling | Q/E rotate | wheel zoom | M map | H help
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

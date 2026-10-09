// Menus (M8): main menu, skirmish setup, pause, saves, settings and the end screen. Like the HUD,
// a Preact overlay driven by a plain MenuModel; every intent goes back through MenuActions. Each
// screen is one centered panel tagged data-hud (so the DOM layout checks cover it) and its buttons
// carry data-ui names for the e2e test. M9 adds the campaign screen (levels open in order).
import { Fragment, render } from "preact";
import { signal } from "@preact/signals";

export type Screen = "none" | "main" | "campaign" | "setup" | "pause" | "settings" | "saves" | "end";

export interface Choice {
  value: string;
  label: string;
}

export interface SetupView {
  maps: Choice[];
  sizes: Choice[];
  personalities: Choice[];
  difficulties: Choice[];
  maxOpponents: number;
  map: string;
  size: number;
  seed: number;
  opponents: string[];
  difficulty: string;
  error: string | null;
}

export interface SettingsView {
  qualities: Choice[];
  quality: string;
  master: number;
  music: number;
  sfx: number;
  keys: { id: string; label: string; key: string }[];
  /** BACKLOG 8 accessibility: tribe palette, HUD scale (percent, as a string for the select), voice subtitles ("on" or "off") */
  palettes: Choice[];
  palette: string;
  uiScales: Choice[];
  uiScale: string;
  subtitles: string;
  /** action id waiting for a key press */
  rebinding: string | null;
  message: string | null;
}

export interface SlotView {
  slot: number;
  empty: boolean;
  label: string;
  detail: string;
}

export interface LevelView {
  id: string;
  name: string;
  description: string;
  open: boolean;
  won: boolean;
}

export interface MenuModel {
  screen: Screen;
  setup: SetupView;
  settings: SettingsView;
  saves: { mode: "save" | "load"; slots: SlotView[]; message: string | null };
  end: { won: boolean; title?: string; tag?: string; lines: { label: string; value: string }[]; next: boolean } | null;
  campaign: { levels: LevelView[]; message: string | null };
  /** saving needs a skirmish in progress (scenarios and the menu backdrop cannot be saved) */
  canSave: boolean;
}

export type SetupPatch = Partial<Pick<SetupView, "map" | "size" | "seed" | "opponents" | "difficulty">>;
export type SettingsPatch = Partial<Pick<SettingsView, "quality" | "master" | "music" | "sfx" | "palette">> & { uiScale?: number; subtitles?: boolean };

export interface MenuActions {
  go(screen: Screen): void;
  back(): void;
  setSetup(p: SetupPatch): void;
  randomSeed(): void;
  start(): void;
  resume(): void;
  openSaves(mode: "save" | "load"): void;
  saveSlot(slot: number): void;
  loadSlot(slot: number): void;
  deleteSlot(slot: number): void;
  setSetting(p: SettingsPatch): void;
  startRebind(action: string): void;
  resetKeys(): void;
  quitToMenu(): void;
  playAgain(): void;
  playLevel(id: string): void;
  nextLevel(): void;
}

export const menuModel = signal<MenuModel | null>(null);

function Btn({ ui, onClick, children, disabled, primary }: { ui: string; onClick: () => void; children: preact.ComponentChildren; disabled?: boolean; primary?: boolean }) {
  return (
    <button class={"menu-btn" + (primary ? " primary" : "")} data-ui={ui} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const ONOFF: Choice[] = [
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

function Select({ ui, value, options, onChange }: { ui: string; value: string; options: Choice[]; onChange: (v: string) => void }) {
  return (
    <select class="menu-select" data-ui={ui} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Main({ act }: { act: MenuActions }) {
  return (
    <div data-hud="menu-main" class="menu-panel menu-main">
      <h1 class="menu-title">Hearthfall</h1>
      <p class="menu-tag">Shape the land. Lead your tribe. Keep them out of the sea.</p>
      <Btn ui="campaign" primary onClick={() => act.go("campaign")}>
        Campaign
      </Btn>
      <Btn ui="skirmish" onClick={() => act.go("setup")}>
        Skirmish
      </Btn>
      <Btn ui="load" onClick={() => act.openSaves("load")}>
        Load game
      </Btn>
      <Btn ui="settings" onClick={() => act.go("settings")}>
        Settings
      </Btn>
    </div>
  );
}

function Setup({ s, act }: { s: SetupView; act: MenuActions }) {
  return (
    <div data-hud="menu-setup" class="menu-panel menu-setup">
      <h2 class="menu-head">Skirmish</h2>
      <div class="menu-grid">
        <label class="menu-label">Map</label>
        <Select ui="setup-map" value={s.map} options={s.maps} onChange={(v) => act.setSetup({ map: v })} />
        <label class="menu-label">Size</label>
        <Select ui="setup-size" value={String(s.size)} options={s.sizes} onChange={(v) => act.setSetup({ size: Number(v) })} />
        <label class="menu-label">Seed</label>
        <span class="menu-row">
          <input class="menu-input" data-ui="setup-seed" type="number" min="1" value={s.seed} onChange={(e) => act.setSetup({ seed: Number((e.target as HTMLInputElement).value) })} />
          <button class="menu-small" data-ui="setup-random" onClick={() => act.randomSeed()}>
            Random
          </button>
        </span>
        <label class="menu-label">Difficulty</label>
        <Select ui="setup-difficulty" value={s.difficulty} options={s.difficulties} onChange={(v) => act.setSetup({ difficulty: v })} />
        {s.opponents.map((o, k) => (
          <Fragment key={k}>
            <label class="menu-label">Opponent {k + 1}</label>
            <span class="menu-row">
              <Select ui={`setup-opponent-${k + 1}`} value={o} options={s.personalities} onChange={(v) => act.setSetup({ opponents: s.opponents.map((x, j) => (j === k ? v : x)) })} />
              {s.opponents.length > 1 ? (
                <button class="menu-small" data-ui={`setup-remove-${k + 1}`} title="Remove this opponent" onClick={() => act.setSetup({ opponents: s.opponents.filter((_, j) => j !== k) })}>
                  Remove
                </button>
              ) : null}
            </span>
          </Fragment>
        ))}
      </div>
      {s.opponents.length < s.maxOpponents ? (
        <button class="menu-small" data-ui="setup-add" onClick={() => act.setSetup({ opponents: [...s.opponents, s.opponents[s.opponents.length - 1]] })}>
          Add opponent
        </button>
      ) : null}
      {s.error ? <p class="menu-error">{s.error}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          Back
        </Btn>
        <Btn ui="start" primary onClick={() => act.start()}>
          Start
        </Btn>
      </div>
    </div>
  );
}

function Campaign({ m, act }: { m: MenuModel; act: MenuActions }) {
  const v = m.campaign;
  return (
    <div data-hud="menu-campaign" class="menu-panel menu-saves">
      <h2 class="menu-head">Campaign</h2>
      {v.levels.map((l, k) => (
        <div key={l.id} class="slot">
          <span class="slot-text">
            <b>
              {k + 1}. {l.name}
              {l.won ? " (won)" : ""}
            </b>
            <span class="slot-detail level-desc">{l.open ? l.description : "Win the level before this one to open it."}</span>
          </span>
          <button class="menu-small" data-ui={`level-${l.id}`} disabled={!l.open} onClick={() => act.playLevel(l.id)}>
            {l.won ? "Replay" : "Play"}
          </button>
        </div>
      ))}
      {v.message ? <p class="menu-note">{v.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          Back
        </Btn>
      </div>
    </div>
  );
}

function Pause({ m, act }: { m: MenuModel; act: MenuActions }) {
  return (
    <div data-hud="menu-pause" class="menu-panel menu-main">
      <h2 class="menu-head">Paused</h2>
      <Btn ui="resume" primary onClick={() => act.resume()}>
        Resume
      </Btn>
      <Btn ui="save" disabled={!m.canSave} onClick={() => act.openSaves("save")}>
        Save game
      </Btn>
      <Btn ui="load" onClick={() => act.openSaves("load")}>
        Load game
      </Btn>
      <Btn ui="settings" onClick={() => act.go("settings")}>
        Settings
      </Btn>
      <Btn ui="quit" onClick={() => act.quitToMenu()}>
        Quit to menu
      </Btn>
    </div>
  );
}

function Saves({ m, act }: { m: MenuModel; act: MenuActions }) {
  const v = m.saves;
  return (
    <div data-hud="menu-saves" class="menu-panel menu-saves">
      <h2 class="menu-head">{v.mode === "save" ? "Save game" : "Load game"}</h2>
      {v.slots.map((s) => (
        <div key={s.slot} class="slot">
          <span class="slot-text">
            <b>{s.label}</b>
            <span class="slot-detail">{s.detail}</span>
          </span>
          {v.mode === "save" ? (
            <button class="menu-small" data-ui={`save-${s.slot}`} onClick={() => act.saveSlot(s.slot)}>
              {s.empty ? "Save" : "Overwrite"}
            </button>
          ) : (
            <button class="menu-small" data-ui={`load-${s.slot}`} disabled={s.empty} onClick={() => act.loadSlot(s.slot)}>
              Load
            </button>
          )}
          <button class="menu-small" data-ui={`delete-${s.slot}`} disabled={s.empty} onClick={() => act.deleteSlot(s.slot)}>
            Delete
          </button>
        </div>
      ))}
      {v.message ? <p class="menu-note">{v.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          Back
        </Btn>
      </div>
    </div>
  );
}

function Slider({ ui, label, value, onInput }: { ui: string; label: string; value: number; onInput: (v: number) => void }) {
  return (
    <>
      <label class="menu-label">{label}</label>
      <span class="menu-row">
        <input class="menu-range" data-ui={ui} type="range" min="0" max="100" step="5" value={value} onInput={(e) => onInput(Number((e.target as HTMLInputElement).value))} />
        <span class="menu-value">{value}</span>
      </span>
    </>
  );
}

function Settings({ s, act }: { s: SettingsView; act: MenuActions }) {
  return (
    <div data-hud="menu-settings" class="menu-panel menu-settings">
      <h2 class="menu-head">Settings</h2>
      <div class="settings-cols">
        <div class="menu-grid">
          <label class="menu-label">Quality</label>
          <Select ui="set-quality" value={s.quality} options={s.qualities} onChange={(v) => act.setSetting({ quality: v })} />
          <Slider ui="set-master" label="Master volume" value={s.master} onInput={(v) => act.setSetting({ master: v })} />
          <Slider ui="set-music" label="Music" value={s.music} onInput={(v) => act.setSetting({ music: v })} />
          <Slider ui="set-sfx" label="Effects" value={s.sfx} onInput={(v) => act.setSetting({ sfx: v })} />
          <label class="menu-label">Tribe colors</label>
          <Select ui="set-palette" value={s.palette} options={s.palettes} onChange={(v) => act.setSetting({ palette: v })} />
          <label class="menu-label">Interface size</label>
          <Select ui="set-uiscale" value={s.uiScale} options={s.uiScales} onChange={(v) => act.setSetting({ uiScale: Number(v) })} />
          <label class="menu-label">Subtitles</label>
          <Select ui="set-subtitles" value={s.subtitles} options={ONOFF} onChange={(v) => act.setSetting({ subtitles: v === "on" })} />
        </div>
        <div class="keys">
          {s.keys.map((k) => (
            <div key={k.id} class="key-row">
              <span class="key-label">{k.label}</span>
              <button class={"key-btn" + (s.rebinding === k.id ? " waiting" : "")} data-ui={`key-${k.id}`} onClick={() => act.startRebind(k.id)}>
                {s.rebinding === k.id ? "press a key" : k.key}
              </button>
            </div>
          ))}
          <button class="menu-small" data-ui="keys-reset" onClick={() => act.resetKeys()}>
            Reset keys
          </button>
        </div>
      </div>
      {s.message ? <p class="menu-note">{s.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          Back
        </Btn>
      </div>
    </div>
  );
}

function End({ m, act }: { m: MenuModel; act: MenuActions }) {
  const e = m.end;
  if (!e) return null;
  return (
    <div data-hud="menu-end" class={"menu-panel menu-main " + (e.won ? "won" : "lost")}>
      <h1 class="menu-title" data-ui="end-title">
        {e.title ?? (e.won ? "Victory" : "Defeat")}
      </h1>
      <p class="menu-tag">{e.tag ?? (e.won ? "Every rival tribe has fallen." : "Your tribe is no more.")}</p>
      <div class="menu-grid end-lines">
        {e.lines.map((l) => (
          <Fragment key={l.label}>
            <span class="menu-label">{l.label}</span>
            <b>{l.value}</b>
          </Fragment>
        ))}
      </div>
      {e.next ? (
        <Btn ui="next-level" primary onClick={() => act.nextLevel()}>
          Next level
        </Btn>
      ) : null}
      <Btn ui="play-again" primary={!e.next} onClick={() => act.playAgain()}>
        {e.won ? "Play again" : "Try again"}
      </Btn>
      <Btn ui="main-menu" onClick={() => act.quitToMenu()}>
        Main menu
      </Btn>
    </div>
  );
}

function Menus({ act }: { act: MenuActions }) {
  const m = menuModel.value;
  if (!m || m.screen === "none") return null;
  return (
    <div class={"menu-backdrop" + (m.screen === "main" ? " title" : "")}>
      {m.screen === "main" ? <Main act={act} /> : null}
      {m.screen === "campaign" ? <Campaign m={m} act={act} /> : null}
      {m.screen === "setup" ? <Setup s={m.setup} act={act} /> : null}
      {m.screen === "pause" ? <Pause m={m} act={act} /> : null}
      {m.screen === "saves" ? <Saves m={m} act={act} /> : null}
      {m.screen === "settings" ? <Settings s={m.settings} act={act} /> : null}
      {m.screen === "end" ? <End m={m} act={act} /> : null}
    </div>
  );
}

export function mountMenus(el: HTMLElement, act: MenuActions): void {
  render(<Menus act={act} />, el);
}

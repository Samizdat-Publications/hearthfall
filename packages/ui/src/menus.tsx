// Menus (M8): main menu, skirmish setup, pause, saves, settings and the end screen. Like the HUD,
// a Preact overlay driven by a plain MenuModel; every intent goes back through MenuActions. Each
// screen is one centered panel tagged data-hud (so the DOM layout checks cover it) and its buttons
// carry data-ui names for the e2e test. M9 adds the campaign screen (levels open in order), drawn as a
// route map since BACKLOG 9 (pick a node, then Play on its card).
import { Fragment, render } from "preact";
import { signal } from "@preact/signals";

export type Screen = "none" | "main" | "campaign" | "setup" | "pause" | "settings" | "saves" | "end" | "records";

export interface Choice {
  value: string;
  label: string;
}

export interface SetupView {
  maps: Choice[];
  sizes: Choice[];
  personalities: Choice[];
  difficulties: Choice[];
  /** BACKLOG 13: victory variants (balance.victory); empty for packs without them */
  victories: Choice[];
  victory: string;
  /** the chosen variant's rule text */
  victoryText: string;
  /** BACKLOG 11: Forge phase choices (off, on; empty for packs without balance.forge) and the choice */
  forges: Choice[];
  forge: string;
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
  /** BACKLOG 14a: tilt-shift miniature focus (default, on, off) */
  miniatures: Choice[];
  miniature: string;
  /** BACKLOG 14: lighting preset (default, day, golden, evening) and weather (clear, rain) */
  lightings: Choice[];
  lighting: string;
  weathers: Choice[];
  weather: string;
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
  end: { won: boolean; title?: string; tag?: string; lines: { label: string; value: string }[]; next: boolean; achievements?: { name: string; description: string }[] } | null;
  /** BACKLOG 21: the records screen: career stats and every achievement (earned shows its date) */
  records?: { rows: { label: string; value: string }[]; achievements: { id: string; name: string; description: string; earned: string | null }[]; summary: string; message: string | null };
  campaign: { levels: LevelView[]; message: string | null };
  /** title illustration URL for the main menu (BACKLOG 81), omitted in tests */
  titleArt?: string;
  /** saving needs a skirmish in progress (scenarios and the menu backdrop cannot be saved) */
  canSave: boolean;
  /** BACKLOG 12: the match is a map editor playtest (quitting returns to the editor) */
  editorTest?: boolean;
  /** BACKLOG 19: a stored last replay (main menu), the ended match's replay (end screen), a replay file problem */
  replay?: { last: boolean; ended: boolean; message: string | null };
}

export type SetupPatch = Partial<Pick<SetupView, "map" | "size" | "seed" | "opponents" | "difficulty" | "victory" | "forge">>;
export type SettingsPatch = Partial<Pick<SettingsView, "quality" | "master" | "music" | "sfx" | "palette" | "miniature" | "lighting" | "weather">> & { uiScale?: number; subtitles?: boolean };

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
  openEditor(): void;
  /** BACKLOG 19: watch the ended match ("ended") or the stored last replay ("last") */
  watchReplay(which: "ended" | "last"): void;
  downloadReplay(): void;
  /** the text of a replay file the player picked */
  openReplayFile(text: string): void;
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

/** BACKLOG 19: main menu replay row: the last match's replay and a replay file */
function Replays({ m, act }: { m: MenuModel; act: MenuActions }) {
  const r = m.replay;
  if (!r) return null;
  return (
    <Fragment>
      <div class="menu-row replay-row">
        <button class="menu-small" data-ui="records" onClick={() => act.go("records")}>
          Records
        </button>
        <button class="menu-small" data-ui="replay-last" disabled={!r.last} onClick={() => act.watchReplay("last")}>
          Last replay
        </button>
        <label class="menu-small replay-file">
          Open replay file
          <input
            type="file"
            accept=".json,application/json"
            data-ui="replay-file"
            style="display: none"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void f.text().then((t) => act.openReplayFile(t));
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </label>
      </div>
      {r.message ? <p class="menu-note" data-ui="replay-message">{r.message}</p> : null}
    </Fragment>
  );
}

function Main({ act, art, m }: { act: MenuActions; art?: string; m: MenuModel }) {
  return (
    <div data-hud="menu-main" class="menu-panel menu-main">
      {art ? <img class="menu-art" src={art} alt="A tiny tribe village on a round island diorama" /> : null}
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
      <Btn ui="editor" onClick={() => act.openEditor()}>
        Map editor
      </Btn>
      <Btn ui="settings" onClick={() => act.go("settings")}>
        Settings
      </Btn>
      <Replays m={m} act={act} />
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
        {s.victories.length ? (
          <Fragment>
            <label class="menu-label">Victory</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-victory" value={s.victory} options={s.victories} onChange={(v) => act.setSetup({ victory: v })} />
              <span class="menu-hint" data-ui="setup-victory-text">
                {s.victoryText}
              </span>
            </span>
          </Fragment>
        ) : null}
        {s.forges.length ? (
          <Fragment>
            <label class="menu-label">Forge</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-forge" value={s.forge} options={s.forges} onChange={(v) => act.setSetup({ forge: v })} />
              <span class="menu-hint">Reshape the land near your Hearth first.</span>
            </span>
          </Fragment>
        ) : null}
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

/** BACKLOG 9: the campaign route: the selected level on the map (null: the frontier, the first open level not yet won) */
const pickedLevel = signal<string | null>(null);

/** node positions on the route, in percent of the map box: left to right, zigzagging along a gentle wave so neighbors never touch */
function routePoint(k: number, n: number): [number, number] {
  const x = n > 1 ? 7 + (86 * k) / (n - 1) : 50;
  const y = 50 + (k % 2 ? 17 : -17) + 12 * Math.sin(k * 0.7 + 0.4);
  return [x, y];
}

function Campaign({ m, act }: { m: MenuModel; act: MenuActions }) {
  const v = m.campaign;
  const n = v.levels.length;
  const frontier = v.levels.find((l) => l.open && !l.won) ?? v.levels[n - 1];
  const sel = v.levels.find((l) => l.id === pickedLevel.value) ?? frontier;
  const k = sel ? v.levels.indexOf(sel) : -1;
  const pts = v.levels.map((_, i) => routePoint(i, n));
  return (
    <div data-hud="menu-campaign" class="menu-panel menu-campaign">
      <h2 class="menu-head">Campaign</h2>
      <div class="route" data-ui="campaign-map">
        <svg class="route-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {pts.slice(1).map((p, i) => (
            <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} class={v.levels[i].won ? "route-seg won" : "route-seg"} />
          ))}
        </svg>
        {v.levels.map((l, i) => (
          <button
            key={l.id}
            class={"route-node" + (l.won ? " won" : l.open ? " open" : " locked") + (sel?.id === l.id ? " picked" : "")}
            style={{ left: `${pts[i][0]}%`, top: `${pts[i][1]}%` }}
            data-ui={`level-${l.id}`}
            disabled={!l.open}
            title={l.open ? l.name : "Win the level before this one to open it."}
            onClick={() => (pickedLevel.value = l.id)}
          >
            {i + 1}
          </button>
        ))}
      </div>
      {sel ? (
        <div class="slot route-card" data-ui="campaign-card">
          <span class="slot-text">
            <b>
              {k + 1}. {sel.name}
              {sel.won ? " (won)" : ""}
            </b>
            <span class="slot-detail level-desc">{sel.open ? sel.description : "Win the level before this one to open it."}</span>
          </span>
          <button class="menu-small" data-ui="level-play" disabled={!sel.open} onClick={() => act.playLevel(sel.id)}>
            {sel.won ? "Replay" : "Play"}
          </button>
        </div>
      ) : null}
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
        {m.editorTest ? "Back to the editor" : "Quit to menu"}
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
          <h3 class="menu-sub">Display and sound</h3>
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
          <label class="menu-label">Miniature focus</label>
          <Select ui="set-miniature" value={s.miniature} options={s.miniatures} onChange={(v) => act.setSetting({ miniature: v })} />
          <label class="menu-label">Lighting</label>
          <Select ui="set-lighting" value={s.lighting} options={s.lightings} onChange={(v) => act.setSetting({ lighting: v })} />
          <label class="menu-label">Weather</label>
          <Select ui="set-weather" value={s.weather} options={s.weathers} onChange={(v) => act.setSetting({ weather: v })} />
        </div>
        <div class="keys">
          <h3 class="menu-sub">Keys</h3>
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
      <p class="menu-tag" data-ui="end-tag">{e.tag ?? (e.won ? "Every rival tribe has fallen." : "Your tribe is no more.")}</p>
      <div class="menu-grid end-lines">
        {e.lines.map((l) => (
          <Fragment key={l.label}>
            <span class="menu-label">{l.label}</span>
            <b>{l.value}</b>
          </Fragment>
        ))}
      </div>
      {e.achievements?.length ? (
        <div class="end-achievements" data-ui="end-achievements">
          {e.achievements.map((a) => (
            <p key={a.name} class="achievement earned">
              <b>{a.name}</b> <span>{a.description}</span>
            </p>
          ))}
        </div>
      ) : null}
      {e.next ? (
        <Btn ui="next-level" primary onClick={() => act.nextLevel()}>
          Next level
        </Btn>
      ) : null}
      <Btn ui="play-again" primary={!e.next} onClick={() => act.playAgain()}>
        {e.won ? "Play again" : "Try again"}
      </Btn>
      {m.replay?.ended ? (
        <div class="menu-row replay-row">
          <button class="menu-small" data-ui="end-replay" onClick={() => act.watchReplay("ended")}>
            Watch replay
          </button>
          <button class="menu-small" data-ui="end-replay-download" onClick={() => act.downloadReplay()}>
            Download replay
          </button>
        </div>
      ) : null}
      <Btn ui="main-menu" onClick={() => act.quitToMenu()}>
        {m.editorTest ? "Back to the editor" : "Main menu"}
      </Btn>
    </div>
  );
}

function Records({ m, act }: { m: MenuModel; act: MenuActions }) {
  const r = m.records;
  if (!r) return null;
  return (
    <div data-hud="menu-records" class="menu-panel menu-records">
      <h2 class="menu-head">Records</h2>
      <div class="records-body">
        <div class="menu-grid records-grid" data-ui="records-stats">
          {r.rows.map((l) => (
            <Fragment key={l.label}>
              <span class="menu-label">{l.label}</span>
              <b>{l.value}</b>
            </Fragment>
          ))}
        </div>
        <div class="records-achievements" data-ui="records-achievements">
          <p class="menu-note">{r.summary}</p>
          {r.achievements.map((a) => (
            <p key={a.id} class={"achievement " + (a.earned ? "earned" : "locked")} data-ui={"achievement-" + a.id} title={a.earned ? `Earned ${a.earned}` : "Not yet earned"}>
              <b>{a.name}</b> <span>{a.description}</span>
            </p>
          ))}
        </div>
      </div>
      {r.message ? <p class="menu-note">{r.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          Back
        </Btn>
      </div>
    </div>
  );
}

function Menus({ act }: { act: MenuActions }) {
  const m = menuModel.value;
  if (!m || m.screen === "none") return null;
  return (
    <div class={"menu-backdrop" + (m.screen === "main" ? " title" : "")}>
      {m.screen === "main" ? <Main act={act} art={m.titleArt} m={m} /> : null}
      {m.screen === "campaign" ? <Campaign m={m} act={act} /> : null}
      {m.screen === "setup" ? <Setup s={m.setup} act={act} /> : null}
      {m.screen === "pause" ? <Pause m={m} act={act} /> : null}
      {m.screen === "saves" ? <Saves m={m} act={act} /> : null}
      {m.screen === "settings" ? <Settings s={m.settings} act={act} /> : null}
      {m.screen === "end" ? <End m={m} act={act} /> : null}
      {m.screen === "records" ? <Records m={m} act={act} /> : null}
    </div>
  );
}

export function mountMenus(el: HTMLElement, act: MenuActions): void {
  render(<Menus act={act} />, el);
}

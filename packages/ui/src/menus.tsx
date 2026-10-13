// Menus (M8): main menu, skirmish setup, pause, saves, settings and the end screen. Like the HUD,
// a Preact overlay driven by a plain MenuModel; every intent goes back through MenuActions. Each
// screen is one centered panel tagged data-hud (so the DOM layout checks cover it) and its buttons
// carry data-ui names for the e2e test. M9 adds the campaign screen (levels open in order), drawn as a
// route map since BACKLOG 9 (pick a node, then Play on its card).
import { Fragment, render } from "preact";
import { signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { t } from "./i18n.ts";

export type Screen = "none" | "main" | "campaign" | "setup" | "pause" | "settings" | "saves" | "end" | "records" | "howto" | "together" | "briefing";

/** Leg 5 (L5-C): the LAN lobby and match state */
export interface NetView {
  state: "idle" | "connecting" | "lobby" | "playing" | "reconnecting" | "resyncing" | "closed";
  code: string;
  /** this page's seat (0 hosts), -1 before the relay answers */
  seat: number;
  /** seats present and seats in the room */
  present: number;
  seats: number;
  canStart: boolean;
  /** a partner has been silent past the stall notice (the HUD and pause menu say so) */
  waiting: boolean;
  /** Leg 5 (host): the name of the campaign level "Play the campaign together" starts */
  campaignLevel?: string;
  /** L5-F (host): seconds left to wait for a dropped partner to rejoin (0: nobody away) */
  away?: number;
  message: string | null;
}

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
  /** stretch 3 (living world): ley stone choices (count as the value; empty for packs without balance.skirmishLey) and the choice */
  leys: Choice[];
  ley: string;
  /** stretch 3: wolf den choices (count as the value; empty for packs without balance.beasts) and the choice */
  wolfChoices: Choice[];
  wolves: string;
  /** BACKLOG 14b: weather choices (clear, rain; empty for packs without balance.weather) and the choice */
  weathers: Choice[];
  weather: string;
  /** stretch 2: tribe trait choices (none plus balance.traits; empty for packs without traits) and the player's pick */
  traits: Choice[];
  trait: string;
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
  /** S4 L7-F: interface scale percent, 0 = fit to screen (then uiAuto is the scale in use) */
  uiScale: number;
  uiAuto: number;
  subtitles: string;
  /** stretch 2: first skirmish tips ("on" or "off") */
  tips: string;
  /** BACKLOG 14a: tilt-shift miniature focus (default, on, off) */
  miniatures: Choice[];
  miniature: string;
  /** S4: crisp (full resolution) or retro pixels */
  pixelLooks: Choice[];
  pixelLook: string;
  /** BACKLOG 14: lighting preset (default, day, golden, evening) and weather (clear, rain) */
  lightings: Choice[];
  lighting: string;
  weathers: Choice[];
  weather: string;
  /** render polish: health bars (damaged, always, off) and ambient life ("on" or "off"); absent hides the rows */
  healthBarChoices?: Choice[];
  healthBars?: string;
  ambient?: string;
  /** QoL: edge scrolling ("on" or "off"; absent hides the row) */
  edgeScroll?: string;
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
  /** S4 L7-A: index into the campaign's chapters (0 without chapters) */
  chapter?: number;
}

export interface MenuModel {
  screen: Screen;
  setup: SetupView;
  settings: SettingsView;
  /** QoL: `quick` is the quick save slot (F5 and F9), listed apart from the manual slots when loading */
  saves: { mode: "save" | "load"; slots: SlotView[]; message: string | null; quick?: SlotView | null };
  /** QoL: pause menu extras: Restart ("level" in a campaign, "match" in a skirmish, null: none) waiting for its
   * confirm, and whether the level briefing can be read */
  pause?: { restart: "level" | "match" | null; confirming: boolean; briefing: boolean };
  /** QoL: the campaign level briefing: the level text, its objectives with their state, the level messages so far */
  briefing?: { name: string; description: string; objectives: { text: string; done: boolean }[]; messages: string[] } | null;
  end: { won: boolean; title?: string; tag?: string; lines: { label: string; value: string }[]; next: boolean; achievements?: { name: string; description: string }[]; desync?: boolean } | null;
  /** BACKLOG 21: the records screen: career stats and every achievement (earned shows its date) */
  records?: { rows: { label: string; value: string }[]; achievements: { id: string; name: string; description: string; earned: string | null }[]; summary: string; message: string | null };
  campaign: { levels: LevelView[]; message: string | null; /** S4 L7-A: chapter names in order (none: one route) */ chapters?: string[] };
  /** title illustration URL for the main menu (BACKLOG 81), omitted in tests */
  titleArt?: string;
  /** saving needs a skirmish in progress (scenarios and the menu backdrop cannot be saved) */
  canSave: boolean;
  /** BACKLOG 12: the match is a map editor playtest (quitting returns to the editor) */
  editorTest?: boolean;
  /** BACKLOG 19: a stored last replay (main menu), the ended match's replay (end screen), a replay file problem */
  replay?: { last: boolean; ended: boolean; message: string | null };
  /** BACKLOG 18: the active mods ("Name version", load order), empty without mods */
  mods?: string[];
  /** Leg 5: LAN play (absent outside the lobby and LAN matches) */
  net?: NetView;
}

export type SetupPatch = Partial<Pick<SetupView, "map" | "size" | "seed" | "opponents" | "difficulty" | "victory" | "forge" | "ley" | "wolves" | "weather" | "trait">>;
export type SettingsPatch = Partial<Pick<SettingsView, "quality" | "master" | "music" | "sfx" | "palette" | "miniature" | "pixelLook" | "lighting" | "weather">> & { uiScale?: number; subtitles?: boolean; tips?: boolean; edgeScroll?: boolean; healthBars?: string; ambient?: boolean };

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
  /** Leg 5: LAN lobby: host a room, join one by code, start (host), leave */
  hostNet(): void;
  joinNet(code: string): void;
  /** versus: head to head; coop: one team against the setup's AI rivals */
  startNet(mode: "versus" | "coop" | "campaign"): void;
  leaveNet(): void;
  /** L5-F (host): stop waiting for a dropped partner; the AI plays their tribe */
  netGiveUp(): void;
  /** L5-F: download the desync report of the match that just stopped */
  downloadDesync(): void;
  /** QoL: pause menu Restart asks first; confirm starts the level or match over, cancel keeps playing */
  askRestart(): void;
  confirmRestart(): void;
  cancelRestart(): void;
  /** QoL: load the quick save slot (the saves screen in load mode) */
  loadQuick(): void;
}

export const menuModel = signal<MenuModel | null>(null);

function Btn({ ui, onClick, children, disabled, primary }: { ui: string; onClick: () => void; children: preact.ComponentChildren; disabled?: boolean; primary?: boolean }) {
  return (
    <button class={"menu-btn" + (primary ? " primary" : "")} data-ui={ui} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const ONOFF = (): Choice[] => [
  { value: "on", label: t("settings.on") },
  { value: "off", label: t("settings.off") },
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
          {t("menu.records")}
        </button>
        <button class="menu-small" data-ui="replay-last" disabled={!r.last} onClick={() => act.watchReplay("last")}>
          {t("menu.lastReplay")}
        </button>
        <label class="menu-small replay-file">
          {t("menu.openReplayFile")}
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
      {art ? <img class="menu-art" src={art} alt={t("menu.artAlt")} /> : null}
      <h1 class="menu-title">Hearthfall</h1>
      <p class="menu-tag">{t("menu.tagline")}</p>
      <Btn ui="campaign" primary onClick={() => act.go("campaign")}>
        {t("menu.campaign")}
      </Btn>
      <Btn ui="skirmish" onClick={() => act.go("setup")}>
        {t("menu.skirmish")}
      </Btn>
      <Btn ui="together" onClick={() => act.go("together")}>
        {t("menu.together")}
      </Btn>
      <Btn ui="howto" onClick={() => act.go("howto")}>
        {t("menu.howto")}
      </Btn>
      <Btn ui="load" onClick={() => act.openSaves("load")}>
        {t("menu.loadGame")}
      </Btn>
      <Btn ui="editor" onClick={() => act.openEditor()}>
        {t("menu.mapEditor")}
      </Btn>
      <Btn ui="settings" onClick={() => act.go("settings")}>
        {t("menu.settings")}
      </Btn>
      <Replays m={m} act={act} />
      {m.mods?.length ? (
        <p class="menu-note" data-ui="mods-active">
          {t("menu.mods", { list: m.mods.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

function Setup({ s, act }: { s: SetupView; act: MenuActions }) {
  return (
    <div data-hud="menu-setup" class="menu-panel menu-setup">
      <h2 class="menu-head">{t("menu.skirmish")}</h2>
      <div class="menu-grid">
        <label class="menu-label">{t("setup.map")}</label>
        <Select ui="setup-map" value={s.map} options={s.maps} onChange={(v) => act.setSetup({ map: v })} />
        <label class="menu-label">{t("setup.size")}</label>
        <Select ui="setup-size" value={String(s.size)} options={s.sizes} onChange={(v) => act.setSetup({ size: Number(v) })} />
        <label class="menu-label">{t("setup.seed")}</label>
        <span class="menu-row">
          <input class="menu-input" data-ui="setup-seed" type="number" min="1" value={s.seed} onChange={(e) => act.setSetup({ seed: Number((e.target as HTMLInputElement).value) })} />
          <button class="menu-small" data-ui="setup-random" onClick={() => act.randomSeed()}>
            {t("setup.random")}
          </button>
        </span>
        <label class="menu-label">{t("setup.difficulty")}</label>
        <Select ui="setup-difficulty" value={s.difficulty} options={s.difficulties} onChange={(v) => act.setSetup({ difficulty: v })} />
        {s.victories.length ? (
          <Fragment>
            <label class="menu-label">{t("setup.victory")}</label>
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
            <label class="menu-label">{t("setup.forge")}</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-forge" value={s.forge} options={s.forges} onChange={(v) => act.setSetup({ forge: v })} />
              <span class="menu-hint">{t("setup.forgeHint")}</span>
            </span>
          </Fragment>
        ) : null}
        {s.leys.length ? (
          <Fragment>
            <label class="menu-label">{t("setup.ley")}</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-ley" value={s.ley} options={s.leys} onChange={(v) => act.setSetup({ ley: v })} />
              <span class="menu-hint">{t("setup.leyHint")}</span>
            </span>
          </Fragment>
        ) : null}
        {s.wolfChoices.length ? (
          <Fragment>
            <label class="menu-label">{t("setup.wolves")}</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-wolves" value={s.wolves} options={s.wolfChoices} onChange={(v) => act.setSetup({ wolves: v })} />
              <span class="menu-hint">{t("setup.wolvesHint")}</span>
            </span>
          </Fragment>
        ) : null}
        {s.weathers.length ? (
          <Fragment>
            <label class="menu-label">{t("setup.weather")}</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-weather" value={s.weather} options={s.weathers} onChange={(v) => act.setSetup({ weather: v })} />
              <span class="menu-hint">{t("setup.weatherHint")}</span>
            </span>
          </Fragment>
        ) : null}
        {s.traits.length ? (
          <Fragment>
            <label class="menu-label">{t("setup.trait")}</label>
            <span class="menu-row menu-victory">
              <Select ui="setup-trait" value={s.trait} options={s.traits} onChange={(v) => act.setSetup({ trait: v })} />
              <span class="menu-hint">{t("setup.traitHint")}</span>
            </span>
          </Fragment>
        ) : null}
        {s.opponents.map((o, k) => (
          <Fragment key={k}>
            <label class="menu-label">{t("setup.opponent", { n: k + 1 })}</label>
            <span class="menu-row">
              <Select ui={`setup-opponent-${k + 1}`} value={o} options={s.personalities} onChange={(v) => act.setSetup({ opponents: s.opponents.map((x, j) => (j === k ? v : x)) })} />
              {s.opponents.length > 1 ? (
                <button class="menu-small" data-ui={`setup-remove-${k + 1}`} title={t("setup.removeTitle")} onClick={() => act.setSetup({ opponents: s.opponents.filter((_, j) => j !== k) })}>
                  {t("setup.remove")}
                </button>
              ) : null}
            </span>
          </Fragment>
        ))}
      </div>
      {s.opponents.length < s.maxOpponents ? (
        <button class="menu-small" data-ui="setup-add" onClick={() => act.setSetup({ opponents: [...s.opponents, s.opponents[s.opponents.length - 1]] })}>
          {t("setup.addOpponent")}
        </button>
      ) : null}
      {s.error ? <p class="menu-error">{s.error}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
        </Btn>
        <Btn ui="start" primary onClick={() => act.start()}>
          {t("setup.start")}
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

/** S4 L7-A: the level a chapter tab picks: its frontier (first open level not yet won), else its first level */
export function chapterPick(levels: LevelView[], chapter: number): LevelView | undefined {
  const own = levels.filter((l) => (l.chapter ?? 0) === chapter);
  return own.find((l) => l.open && !l.won) ?? own[0];
}

function Campaign({ m, act }: { m: MenuModel; act: MenuActions }) {
  const v = m.campaign;
  const n = v.levels.length;
  const frontier = v.levels.find((l) => l.open && !l.won) ?? v.levels[n - 1];
  const sel = v.levels.find((l) => l.id === pickedLevel.value) ?? frontier;
  const k = sel ? v.levels.indexOf(sel) : -1;
  // S4 L7-A: one chapter's route at a time (the picked level's); tabs for the chapters that have levels
  const chapter = sel?.chapter ?? 0;
  const tabs = (v.chapters ?? []).map((name, c) => ({ name, c })).filter((x) => v.levels.some((l) => (l.chapter ?? 0) === x.c));
  const shown = v.levels.filter((l) => (l.chapter ?? 0) === chapter);
  const pts = shown.map((_, i) => routePoint(i, shown.length));
  return (
    <div data-hud="menu-campaign" class="menu-panel menu-campaign">
      <h2 class="menu-head">{t("menu.campaign")}</h2>
      {tabs.length > 1 ? (
        <div class="route-tabs" data-ui="campaign-chapters">
          {tabs.map((x) => (
            <button
              key={x.c}
              class={"menu-small route-tab" + (x.c === chapter ? " picked" : "")}
              data-ui={`chapter-${x.c}`}
              onClick={() => (pickedLevel.value = chapterPick(v.levels, x.c)?.id ?? null)}
            >
              {x.name}
            </button>
          ))}
        </div>
      ) : null}
      <div class="route" data-ui="campaign-map">
        <svg class="route-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {pts.slice(1).map((p, i) => (
            <line key={i} x1={pts[i][0]} y1={pts[i][1]} x2={p[0]} y2={p[1]} class={shown[i].won ? "route-seg won" : "route-seg"} />
          ))}
        </svg>
        {shown.map((l, i) => (
          <button
            key={l.id}
            class={"route-node" + (l.won ? " won" : l.open ? " open" : " locked") + (sel?.id === l.id ? " picked" : "")}
            style={{ left: `${pts[i][0]}%`, top: `${pts[i][1]}%` }}
            data-ui={`level-${l.id}`}
            disabled={!l.open}
            title={l.open ? l.name : t("campaign.locked")}
            onClick={() => (pickedLevel.value = l.id)}
          >
            {v.levels.indexOf(l) + 1}
          </button>
        ))}
      </div>
      {sel ? (
        <div class="slot route-card" data-ui="campaign-card">
          <span class="slot-text">
            <b>
              {k + 1}. {sel.name}
              {sel.won ? " " + t("campaign.wonMark") : ""}
            </b>
            <span class="slot-detail level-desc">{sel.open ? sel.description : t("campaign.locked")}</span>
          </span>
          <button class="menu-small" data-ui="level-play" disabled={!sel.open} onClick={() => act.playLevel(sel.id)}>
            {sel.won ? t("campaign.replay") : t("campaign.play")}
          </button>
        </div>
      ) : null}
      {v.message ? <p class="menu-note">{v.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
        </Btn>
      </div>
    </div>
  );
}

function Pause({ m, act }: { m: MenuModel; act: MenuActions }) {
  return (
    <div data-hud="menu-pause" class="menu-panel menu-main">
      <h2 class="menu-head">{t("pause.title")}</h2>
      <Btn ui="resume" primary onClick={() => act.resume()}>
        {t("pause.resume")}
      </Btn>
      {m.net?.state === "playing" ? (
        <p class="menu-note" data-ui="pause-net">
          {m.net.waiting ? t("together.waitingPartner") : t("together.noPause")}
        </p>
      ) : null}
      {m.pause?.briefing ? (
        <Btn ui="briefing" onClick={() => act.go("briefing")}>
          {t("pause.briefing")}
        </Btn>
      ) : null}
      <Btn ui="save" disabled={!m.canSave} onClick={() => act.openSaves("save")}>
        {t("pause.saveGame")}
      </Btn>
      <Btn ui="load" disabled={m.net?.state === "playing"} onClick={() => act.openSaves("load")}>
        {t("menu.loadGame")}
      </Btn>
      <Btn ui="settings" onClick={() => act.go("settings")}>
        {t("menu.settings")}
      </Btn>
      <Btn ui="howto" onClick={() => act.go("howto")}>
        {t("menu.howto")}
      </Btn>
      {m.pause?.restart && m.pause.confirming ? (
        <div class="menu-confirm" data-ui="restart-confirm">
          <p class="menu-note">{m.pause.restart === "level" ? t("pause.restartLevelAsk") : t("pause.restartMatchAsk")}</p>
          <span class="confirm-row">
            <button class="menu-small confirm-yes" data-ui="restart-yes" onClick={() => act.confirmRestart()}>
              {t("pause.restartYes")}
            </button>
            <button class="menu-small" data-ui="restart-no" onClick={() => act.cancelRestart()}>
              {t("pause.restartNo")}
            </button>
          </span>
        </div>
      ) : m.pause?.restart ? (
        <Btn ui="restart" onClick={() => act.askRestart()}>
          {m.pause.restart === "level" ? t("pause.restartLevel") : t("pause.restartMatch")}
        </Btn>
      ) : null}
      <Btn ui="quit" onClick={() => act.quitToMenu()}>
        {m.editorTest ? t("menu.backToEditor") : t("pause.quit")}
      </Btn>
    </div>
  );
}

function Saves({ m, act }: { m: MenuModel; act: MenuActions }) {
  const v = m.saves;
  return (
    <div data-hud="menu-saves" class="menu-panel menu-saves">
      <h2 class="menu-head">{v.mode === "save" ? t("pause.saveGame") : t("menu.loadGame")}</h2>
      {v.mode === "load" && v.quick ? (
        <div class="slot slot-quick">
          <span class="slot-text">
            <b>{v.quick.label}</b>
            <span class="slot-detail">{v.quick.detail}</span>
          </span>
          <button class="menu-small" data-ui="load-quick" disabled={v.quick.empty} onClick={() => act.loadQuick()}>
            {t("saves.load")}
          </button>
        </div>
      ) : null}
      {v.slots.map((s) => (
        <div key={s.slot} class="slot">
          <span class="slot-text">
            <b>{s.label}</b>
            <span class="slot-detail">{s.detail}</span>
          </span>
          {v.mode === "save" ? (
            <button class="menu-small" data-ui={`save-${s.slot}`} onClick={() => act.saveSlot(s.slot)}>
              {s.empty ? t("saves.save") : t("saves.overwrite")}
            </button>
          ) : (
            <button class="menu-small" data-ui={`load-${s.slot}`} disabled={s.empty} onClick={() => act.loadSlot(s.slot)}>
              {t("saves.load")}
            </button>
          )}
          <button class="menu-small" data-ui={`delete-${s.slot}`} disabled={s.empty} onClick={() => act.deleteSlot(s.slot)}>
            {t("saves.delete")}
          </button>
        </div>
      ))}
      {v.message ? <p class="menu-note">{v.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
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
      <h2 class="menu-head">{t("menu.settings")}</h2>
      <div class="settings-cols">
        <div class="menu-grid">
          <h3 class="menu-sub">{t("settings.display")}</h3>
          <label class="menu-label">{t("settings.quality")}</label>
          <Select ui="set-quality" value={s.quality} options={s.qualities} onChange={(v) => act.setSetting({ quality: v })} />
          <Slider ui="set-master" label={t("settings.master")} value={s.master} onInput={(v) => act.setSetting({ master: v })} />
          <Slider ui="set-music" label={t("settings.music")} value={s.music} onInput={(v) => act.setSetting({ music: v })} />
          <Slider ui="set-sfx" label={t("settings.sfx")} value={s.sfx} onInput={(v) => act.setSetting({ sfx: v })} />
          <label class="menu-label">{t("settings.palette")}</label>
          <Select ui="set-palette" value={s.palette} options={s.palettes} onChange={(v) => act.setSetting({ palette: v })} />
          <label class="menu-label" for="set-uiscale">{t("settings.uiScale")}</label>
          <span class="menu-row menu-scale">
            {/* S4 L7-F: a slider (applied on release, so the panel does not rescale under the pointer) and fit to screen */}
            <input id="set-uiscale" class="menu-range" data-ui="set-uiscale" type="range" min="75" max="200" step="5" value={s.uiScale || s.uiAuto} onChange={(e) => act.setSetting({ uiScale: Number((e.target as HTMLInputElement).value) })} />
            <span class="menu-value scale-value" data-ui="uiscale-value">{s.uiScale || s.uiAuto}%</span>
            <button class={`menu-small${s.uiScale ? "" : " picked"}`} data-ui="set-uiscale-fit" title={t("settings.uiScaleFitHint")} onClick={() => act.setSetting({ uiScale: 0 })}>
              {t("settings.uiScaleFit")}
            </button>
          </span>
          <label class="menu-label">{t("settings.subtitles")}</label>
          <Select ui="set-subtitles" value={s.subtitles} options={ONOFF()} onChange={(v) => act.setSetting({ subtitles: v === "on" })} />
          <label class="menu-label" title={t("settings.tipsHint")}>{t("settings.tips")}</label>
          <Select ui="set-tips" value={s.tips} options={ONOFF()} onChange={(v) => act.setSetting({ tips: v === "on" })} />
          <label class="menu-label">{t("settings.pixelLook")}</label>
          <Select ui="set-pixellook" value={s.pixelLook} options={s.pixelLooks} onChange={(v) => act.setSetting({ pixelLook: v })} />
          <label class="menu-label">{t("settings.miniature")}</label>
          <Select ui="set-miniature" value={s.miniature} options={s.miniatures} onChange={(v) => act.setSetting({ miniature: v })} />
          <label class="menu-label">{t("settings.lighting")}</label>
          <Select ui="set-lighting" value={s.lighting} options={s.lightings} onChange={(v) => act.setSetting({ lighting: v })} />
          <label class="menu-label">{t("settings.weather")}</label>
          <Select ui="set-weather" value={s.weather} options={s.weathers} onChange={(v) => act.setSetting({ weather: v })} />
          {s.healthBarChoices && s.healthBars !== undefined ? (
            <>
              <label class="menu-label" title={t("settings.healthBarsHint")}>{t("settings.healthBars")}</label>
              <Select ui="set-healthbars" value={s.healthBars} options={s.healthBarChoices} onChange={(v) => act.setSetting({ healthBars: v })} />
            </>
          ) : null}
          {s.ambient !== undefined ? (
            <>
              <label class="menu-label" title={t("settings.ambientHint")}>{t("settings.ambient")}</label>
              <Select ui="set-ambient" value={s.ambient} options={ONOFF()} onChange={(v) => act.setSetting({ ambient: v === "on" })} />
            </>
          ) : null}
          {s.edgeScroll !== undefined ? (
            <>
              <label class="menu-label" title={t("settings.edgeScrollHint")}>{t("settings.edgeScroll")}</label>
              <Select ui="set-edgescroll" value={s.edgeScroll} options={ONOFF()} onChange={(v) => act.setSetting({ edgeScroll: v === "on" })} />
            </>
          ) : null}
        </div>
        <div class="keys">
          <h3 class="menu-sub">{t("settings.keys")}</h3>
          {s.keys.map((k) => (
            <div key={k.id} class="key-row">
              <span class="key-label">{k.label}</span>
              <button class={"key-btn" + (s.rebinding === k.id ? " waiting" : "")} data-ui={`key-${k.id}`} onClick={() => act.startRebind(k.id)}>
                {s.rebinding === k.id ? t("settings.pressKey") : k.key}
              </button>
            </div>
          ))}
          <button class="menu-small" data-ui="keys-reset" onClick={() => act.resetKeys()}>
            {t("settings.resetKeys")}
          </button>
        </div>
      </div>
      {s.message ? <p class="menu-note">{s.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
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
        {e.title ?? (e.won ? t("end.victory") : t("end.defeat"))}
      </h1>
      <p class="menu-tag" data-ui="end-tag">{e.tag ?? (e.won ? t("end.wonTag") : t("end.lostTag"))}</p>
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
          {t("end.nextLevel")}
        </Btn>
      ) : null}
      {m.net ? null : (
        <Btn ui="play-again" primary={!e.next} onClick={() => act.playAgain()}>
          {e.won ? t("end.playAgain") : t("end.tryAgain")}
        </Btn>
      )}
      {m.replay?.ended ? (
        <div class="menu-row replay-row">
          <button class="menu-small" data-ui="end-replay" onClick={() => act.watchReplay("ended")}>
            {t("end.watchReplay")}
          </button>
          <button class="menu-small" data-ui="end-replay-download" onClick={() => act.downloadReplay()}>
            {t("end.downloadReplay")}
          </button>
        </div>
      ) : null}
      {e.desync ? (
        <button class="menu-small" data-ui="end-desync-report" onClick={() => act.downloadDesync()}>
          {t("end.desyncReport")}
        </button>
      ) : null}
      <Btn ui="main-menu" onClick={() => act.quitToMenu()}>
        {m.editorTest ? t("menu.backToEditor") : t("end.mainMenu")}
      </Btn>
    </div>
  );
}

/** Leg 5 (L5-C): Play together over LAN: host a room or join one by its code. */
function Together({ m, act }: { m: MenuModel; act: MenuActions }) {
  const n = m.net ?? { state: "idle", code: "", seat: -1, present: 0, seats: 2, canStart: false, waiting: false, message: null };
  const code = useRef<HTMLInputElement>(null);
  return (
    <div data-hud="menu-together" class="menu-panel menu-main">
      <h2 class="menu-head">{t("menu.together")}</h2>
      {n.state === "idle" || n.state === "closed" ? (
        <Fragment>
          <p class="menu-note">{t("together.help")}</p>
          <Btn ui="net-host" primary onClick={() => act.hostNet()}>
            {t("together.host")}
          </Btn>
          <span class="menu-row">
            <input ref={code} class="menu-input" data-ui="net-code" maxLength={4} placeholder={t("together.codeLabel")} />
            <button class="menu-small" data-ui="net-join" onClick={() => act.joinNet(code.current?.value ?? "")}>
              {t("together.join")}
            </button>
          </span>
        </Fragment>
      ) : n.state === "connecting" || n.seat < 0 ? (
        <p class="menu-note" data-ui="net-status">{t("together.connecting")}</p>
      ) : n.seat === 0 ? (
        <Fragment>
          <p class="menu-tag" data-ui="net-code-shown">
            {t("together.roomCode", { code: n.code })}
          </p>
          <p class="menu-note" data-ui="net-status">
            {n.present >= n.seats ? t("together.partnerHere") : t("together.waiting")}
          </p>
          <p class="menu-note">{t("together.hostNote")}</p>
          <Btn ui="net-start" primary disabled={!n.canStart} onClick={() => act.startNet("versus")}>
            {t("together.start")}
          </Btn>
          <Btn ui="net-start-coop" disabled={!n.canStart} onClick={() => act.startNet("coop")}>
            {t("together.startCoop")}
          </Btn>
          {n.campaignLevel ? (
            <Btn ui="net-start-campaign" disabled={!n.canStart} onClick={() => act.startNet("campaign")}>
              {t("together.startCampaign", { level: n.campaignLevel })}
            </Btn>
          ) : null}
        </Fragment>
      ) : (
        <p class="menu-note" data-ui="net-status">
          {t("together.joined", { code: n.code })}
        </p>
      )}
      {n.message ? (
        <p class="menu-note" data-ui="net-message">
          {n.message}
        </p>
      ) : null}
      <Btn ui="net-leave" onClick={() => act.leaveNet()}>
        {t("together.leave")}
      </Btn>
    </div>
  );
}

function Records({ m, act }: { m: MenuModel; act: MenuActions }) {
  const r = m.records;
  if (!r) return null;
  return (
    <div data-hud="menu-records" class="menu-panel menu-records">
      <h2 class="menu-head">{t("menu.records")}</h2>
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
            <p key={a.id} class={"achievement " + (a.earned ? "earned" : "locked")} data-ui={"achievement-" + a.id} title={a.earned ? t("records.earned", { date: a.earned }) : t("records.notEarned")}>
              <b>{a.name}</b> <span>{a.description}</span>
            </p>
          ))}
        </div>
      </div>
      {r.message ? <p class="menu-note">{r.message}</p> : null}
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
        </Btn>
      </div>
    </div>
  );
}

/** Stretch 2 playtest pass: a one page guide (main menu and pause menu). */
const howto = () => [
  [t("howto.goal.head"), t("howto.goal.text")],
  [t("howto.grow.head"), t("howto.grow.text")],
  [t("howto.spells.head"), t("howto.spells.text")],
  [t("howto.army.head"), t("howto.army.text")],
  [t("howto.camera.head"), t("howto.camera.text")],
  [t("howto.together.head"), t("howto.together.text")],
  [t("howto.start.head"), t("howto.start.text")],
];
function HowTo({ act }: { act: MenuActions }) {
  return (
    <div data-hud="menu-howto" class="menu-panel menu-howto">
      <h2 class="menu-head">{t("menu.howto")}</h2>
      <div class="howto-body" data-ui="howto-body">
        {howto().map(([head, text]) => (
          <section key={head} class="howto-part">
            <h3>{head}</h3>
            <p>{text}</p>
          </section>
        ))}
      </div>
      <div class="menu-actions">
        <Btn ui="back" onClick={() => act.back()}>
          {t("menu.back")}
        </Btn>
      </div>
    </div>
  );
}

/** QoL: the campaign level briefing, readable mid-level: the level text, objectives with their state, messages so far. */
function Briefing({ m, act }: { m: MenuModel; act: MenuActions }) {
  const b = m.briefing;
  if (!b) return null;
  return (
    <div data-hud="menu-briefing" class="menu-panel menu-briefing">
      <h2 class="menu-head">{b.name}</h2>
      <p class="briefing-text" data-ui="briefing-description">
        {b.description}
      </p>
      <h3 class="menu-sub">{t("briefing.objectives")}</h3>
      <ul class="briefing-list" data-ui="briefing-objectives">
        {b.objectives.map((o, k) => (
          <li key={k} class={"briefing-obj" + (o.done ? " done" : "")}>
            {o.done ? "✓ " : "◇ "}
            {o.text}
          </li>
        ))}
      </ul>
      <h3 class="menu-sub">{t("briefing.messages")}</h3>
      {b.messages.length ? (
        <div class="briefing-msgs" data-ui="briefing-messages">
          {b.messages.map((text, k) => (
            <p key={k} class="briefing-msg">
              {text}
            </p>
          ))}
        </div>
      ) : (
        <p class="menu-note" data-ui="briefing-messages">
          {t("briefing.noMessages")}
        </p>
      )}
      <div class="menu-actions">
        <Btn ui="back" primary onClick={() => act.back()}>
          {t("briefing.back")}
        </Btn>
      </div>
    </div>
  );
}

/** L5-F: over the running match, while a partner stalls, dropped out, or this page is rejoining */
function NetBanner({ n, act }: { n: NetView; act: MenuActions }) {
  const text =
    n.state === "reconnecting"
      ? t("together.reconnecting")
      : n.state === "resyncing"
        ? t("together.resyncing")
        : n.away
          ? t("together.awayWait", { s: String(Math.ceil(n.away)) })
          : n.waiting
            ? t("together.waitingPartner")
            : "";
  if (!text) return null;
  return (
    <div class="net-banner" data-ui="net-banner">
      <span>{text}</span>
      {n.away ? (
        <button class="menu-small" data-ui="net-give-up" onClick={() => act.netGiveUp()}>
          {t("together.giveUp")}
        </button>
      ) : null}
    </div>
  );
}

function Menus({ act }: { act: MenuActions }) {
  const m = menuModel.value;
  if (m && m.screen === "none" && m.net) return <NetBanner n={m.net} act={act} />;
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
      {m.screen === "howto" ? <HowTo act={act} /> : null}
      {m.screen === "together" ? <Together m={m} act={act} /> : null}
      {m.screen === "briefing" ? <Briefing m={m} act={act} /> : null}
    </div>
  );
}

export function mountMenus(el: HTMLElement, act: MenuActions): void {
  render(<Menus act={act} />, el);
}

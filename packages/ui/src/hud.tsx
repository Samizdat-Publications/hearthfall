// HUD (M4, layout v2 after ADR-005): Preact DOM overlay driven by a plain HudModel. The UI never
// touches the sim: it renders the model and calls back into the app, which turns intents into
// Commands. Layout follows the target look: Shaper portrait and bars top-left, spells top-center,
// build tools in the right column, minimap with population bottom-right. HUD v3 "Ember Grove"
// (docs/design/hud-v3.md) paints the panels with the keyed pieces in assets/ui/hud through the
// --art-<piece> CSS custom properties the app sets (apps/game/src/hudArt.ts); all text stays live.
import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { keyText } from "./i18n.ts";

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
  /** M10: icon URL (the two-letter glyph shows without one) */
  icon?: string;
  /** QoL 2: the full tooltip (name, hotkey, what it does, cost and charges); a short built-in one without it */
  tip?: string;
}

/** M6 troop panel: what the selection can be told to do. */
export interface TroopView {
  kind: "none" | "units" | "lodge" | "tower" | "site";
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
  /** the selected building is still a plan or being built (BACKLOG 49: it can be cancelled) */
  building: boolean;
  /** unit selection by kind (M8 selected units panel) */
  /** id is the unit type; icon (BACKLOG 0a) is its HUD icon URL when one exists */
  units: { id: string; name: string; count: number; hpFrac: number; icon?: string }[];
}

export interface NoteView {
  id: number;
  text: string;
  kind: "good" | "bad" | "info";
  /** QoL 2: the note has a place: clicking it looks there; this is its tooltip */
  jump?: string;
}

export interface ObjectiveView {
  text: string;
  done: boolean;
  /** data-hud-part tag for tests */
  part?: string;
}

/** Build button cost text, "5 wood" or "5 wood, 2 stone" (BACKLOG 0c). */
export const costText = (c: { wood: number; stone: number }): string => `${c.wood} wood${c.stone > 0 ? `, ${c.stone} stone` : ""}`;

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
  buildable: { id: string; name: string; wood: number; stone: number; key: string; locked: string | null; icon?: string }[];
  /** M10: resource icons for the mana and follower bars (text glyphs without them) */
  icons?: { mana?: string; pop?: string };
  /** next progression tier: name, followers needed and what it opens; null when all are open */
  /** M8: objectives panel (rivals left, Hearth, next tier) and event notifications, newest last */
  objectives: ObjectiveView[];
  notes: NoteView[];
  /** BACKLOG 8: the current voice line's subtitle */
  subtitle?: { speaker: string; text: string } | null;
  /** stretch 2 playtest pass: the current first skirmish tip ("Tip 2/6") */
  tip?: { label: string; text: string } | null;
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
  /** BACKLOG 4: units inside the spell preview (enemies the tribe can see, own units) */
  targetCounts?: { enemies: number; own: number } | null;
  /** BACKLOG 4: seconds left to undo the cast in progress with Backspace (absent or negative: none) */
  undoSec?: number;
  /** BACKLOG 11: the Forge phase (absent or null outside it) */
  forge?: ForgeView | null;
  /** QoL: single player game speed ("2x") and whether it can go down or up; absent or null where speed does not apply (LAN play) */
  speed?: { label: string; canDown: boolean; canUp: boolean } | null;
  /** QoL 2: idle troops count ("3 idle") and its tooltip; absent or null when no troops stand idle */
  idle?: { n: number; label: string; title: string } | null;
  /** QoL 2: why the armed spell cannot land where the pointer is ("out of range: ..."), "" when it can */
  targetHint?: string;
}

/** BACKLOG 11: the Forge panel: time and strokes left, the brush in hand, whether this tribe is ready */
export interface ForgeView {
  secondsLeft: number;
  strokesLeft: number;
  brush: string;
  brushes: string[];
  ready: boolean;
  /** why the brush cannot land under the cursor ("" when it can) */
  blocked: string;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, "0")}`;

/** BACKLOG 11: the Forge panel above the play area. */
export function ForgePanel({ f, act }: { f: ForgeView; act: HudActions }) {
  return (
    <div data-hud="forge" class="hud-panel hud-forge">
      <span class="forge-title">
        The Forge: left click to reshape the land around your Hearth ({mmss(f.secondsLeft)} left, {f.strokesLeft} strokes){f.blocked ? ` | ${f.blocked}` : ""}
      </span>
      <span class="troops-row">
        {f.brushes.map((b) => (
          <button key={b} data-ui={`forge-${b}`} class={"prio" + (f.brush === b ? " on" : "")} onClick={() => act.forgeBrush(b)}>
            {b[0].toUpperCase() + b.slice(1)}
          </button>
        ))}
        <button data-ui="forge-ready" class="prio forge-ready" disabled={f.ready} onClick={() => act.forgeReady()}>
          {f.ready ? "Waiting for rivals" : "Ready"}
        </button>
      </span>
    </div>
  );
}

const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** BACKLOG 4: the spell preview line, e.g. "3 enemies, 1 of yours in the area" */
export function areaLine(c: { enemies: number; own: number } | null | undefined): string {
  if (!c) return "";
  if (!c.enemies && !c.own) return "nobody in the area";
  return `${plural(c.enemies, "enemy", "enemies")}, ${c.own} of yours in the area`;
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
  /** BACKLOG 49: cancel the selected unfinished building */
  cancelPlan(): void;
  garrison(): void;
  retreat(): void;
  setStance(s: (typeof STANCES)[number]): void;
  /** BACKLOG 11: pick the Forge brush, end this tribe's Forge */
  forgeBrush(b: string): void;
  forgeReady(): void;
  /** click the Shaper portrait: select the Shaper and center the camera on her */
  selectShaper(): void;
  /** QoL: one game speed step slower (-1) or faster (1) */
  speedStep?(dir: 1 | -1): void;
  /** QoL 2: click a note that has a place: look there */
  noteJump?(id: number): void;
  /** QoL 2: select the next idle troop group and look at it */
  idleTroops?(): void;
}

/** QoL 2: the idle troops chip (in the troop panel, or on its own where the troop panel would be). */
function IdleChip({ idle, act, alone }: { idle: { n: number; label: string; title: string }; act: HudActions; alone: boolean }) {
  return (
    <button data-ui="idle-troops" class={"prio idle-chip" + (alone ? " alone" : "")} title={idle.title} onClick={() => act.idleTroops?.()}>
      {idle.label}
    </button>
  );
}

/** QoL 2: the selection line while a spell is armed, with why it cannot land here when it cannot. */
export function targetingLine(spell: string, counts: { enemies: number; own: number } | null | undefined, hint: string | undefined): string {
  return `Casting ${spell.replace(/_/g, " ")}: left click a target, right click or Esc to cancel${hint ? ` | ${hint}` : counts ? ` | ${areaLine(counts)}` : ""}`;
}

/** Small stance glyphs: crossed blades, a shield, an open palm. */
export function StanceIcon({ s }: { s: (typeof STANCES)[number] }) {
  const d =
    s === "aggressive"
      ? "M3 3l10 10M13 3L3 13M2 12l2 2M14 12l-2 2"
      : s === "defensive"
        ? "M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4z"
        : "M5 14V7M7.5 14V4M10 14V5M12.5 14V8M5 14h7.5";
  return (
    <svg class="stance-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

/** HUD v3: the word on the stance plank's top tab */
const TROOP_TAB: Record<TroopView["kind"], string> = { none: "", units: "Stance", lodge: "Lodge", tower: "Tower", site: "Site" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Troops({ t, act, pointing, idle }: { t: TroopView; act: HudActions; pointing: string | null; idle?: { n: number; label: string; title: string } | null }) {
  if (t.kind === "none") return null;
  return (
    <div data-hud="troops" class={"hud-panel hud-troops troops-" + t.kind}>
      <span class="troops-tab" aria-hidden="true">
        {t.building ? "Plan" : TROOP_TAB[t.kind]}
      </span>
      {t.label || idle ? (
        <span class="troops-head">
          {t.label ? <span class="troops-label">{t.label}</span> : <span />}
          {idle ? <IdleChip idle={idle} act={act} alone={false} /> : null}
        </span>
      ) : null}
      {t.units.length ? (
        <div class="troops-units">
          {t.units.map((u) => (
            <span key={u.name} class="unit-chip" title={`${u.count} ${u.name}, health ${Math.round(u.hpFrac * 100)}%`}>
              {u.icon ? <img class="unit-icon" src={u.icon} alt="" /> : null}
              <b>{u.count}</b> {u.name}
              <span class="unit-hp" style={{ width: Math.round(u.hpFrac * 100) + "%" }} />
            </span>
          ))}
        </div>
      ) : null}
      {t.kind === "units" ? (
        <div class="troops-row">
          {STANCES.map((s) => (
            <button key={s} class={"prio stance" + (t.stance === s ? " on" : "")} title={`Stance: ${s}`} aria-label={`Stance: ${s}`} data-stance={s} onClick={() => act.setStance(s)}>
              <StanceIcon s={s} />
              <span class="stance-name">{cap(s)}</span>
            </button>
          ))}
          <button class="prio" title={keyText("Run to the nearest own Watchtower, else the Hearth ({key:retreat})")} onClick={() => act.retreat()}>
            Retreat
          </button>
          {t.canGarrison ? (
            <button class="prio" title={keyText("Garrison in the nearest Watchtower with room ({key:garrison})")} onClick={() => act.garrison()}>
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
      {t.building ? (
        <div class="troops-row">
          <button class="prio" data-act="cancel-plan" title="Cancel this unfinished building (Delete). Wood already delivered is lost." onClick={() => act.cancelPlan()}>
            Cancel plan
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const hudModel = signal<HudModel | null>(null);

/** HUD v3: a spell is a painted rune disc (CSS background); the charge ring sits on the disc's inner rim. */
function SpellButton({ s, act }: { s: SpellView; act: HudActions }) {
  const ring = 2 * Math.PI * 19;
  const full = s.charges >= s.max;
  return (
    <button class={"spell" + (s.auto ? " auto" : "") + (full ? " full" : "") + (s.charging ? " charging" : "")} data-spell={s.id} title={s.tip ?? `${s.name}: ${s.cost} mana, ${s.charges}/${s.max} charges. Click to cast, right click to toggle auto-charge.`} onClick={() => act.target(s.id)} onContextMenu={(e) => { e.preventDefault(); act.toggleAuto(s.id); }} data-tier={s.tier}>
      <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r="19" class="ring-bg" />
        <circle cx="28" cy="28" r="19" class="ring" style={{ strokeDasharray: `${ring * (full ? 1 : s.progress)} ${ring}` }} transform="rotate(-90 28 28)" />
        {s.icon ? (
          <image href={s.icon} x="14" y="14" width="28" height="28" class="icon" />
        ) : (
          <text x="28" y="33" text-anchor="middle" class="glyph">
            {s.name.slice(0, 2)}
          </text>
        )}
      </svg>
      <span class="charges">{s.charges}</span>
      {s.eta ? <span class="eta">{s.eta}</span> : null}
      <span class="hotkey">{s.hotkey}</span>
    </button>
  );
}

/** HUD v3: the painted elder Shaper portrait (--art-portrait, set by the app) in the bone slot of the Shaper frame. */
function Portrait() {
  return <span class="portrait" role="img" aria-label="The Shaper" />;
}

function Bar({ kind, frac, label, icon, warn }: { kind: "mana" | "pop"; frac: number; label: string; icon?: string; warn?: { text: string; title: string } | null }) {
  return (
    <div class={"bar bar-" + kind} title={label}>
      {icon ? <img class="bar-icon" src={icon} alt="" /> : <span class="bar-glyph" aria-hidden="true">{kind === "mana" ? "◆" : "✚"}</span>}
      <span class="bar-track">
        <span class="bar-fill" style={{ width: Math.round(Math.min(1, Math.max(0, frac)) * 100) + "%" }} />
        <span class="bar-text">{label}</span>
        {warn ? (
          <span class="waste" title={warn.title}>
            {warn.text}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** HUD v3: the minimap shows through the bone ring beside the lava cauldron; Population sits on a small plaque. */
function Minimap({ m, act }: { m: HudModel; act: HudActions }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) act.drawMinimap(ref.current);
  });
  return (
    <div data-hud="minimap" class="hud-panel hud-minimap">
      <div class="mm-pop" title="Followers / housing">
        <span class="mm-label">Population</span>
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
  const undo = m.undoSec !== undefined && m.undoSec > 0;
  return (
    <>
      {/* HUD v3 "Ember Grove": painted ornaments (no data-hud, never take the pointer); live panels sit on top */}
      <div class="hud-deco deco-title" role="img" aria-label={m.title} />
      <div class="hud-deco deco-shaper" aria-hidden="true" />
      <div class="hud-deco deco-volcano" aria-hidden="true" />
      <div data-hud="shaper" class={"hud-panel hud-shaper" + (m.shaper.alive ? "" : " dead")}>
        <button class="portrait-btn" onClick={() => act.selectShaper()} disabled={!m.shaper.alive} title={keyText("Center on the Shaper ({key:selectShaper} selects in place)")} aria-label="Select the Shaper">
          <Portrait />
        </button>
        <span class="shaper-name">{m.shaper.alive ? "Shaper" : m.shaper.respawnSec >= 0 ? `back in ${m.shaper.respawnSec}s` : "fallen"}</span>
        <span class="shaper-hp-track">
          <span class="shaper-hp" style={{ width: Math.round(m.shaper.hpFrac * 100) + "%" }} />
        </span>
      </div>
      <div data-hud="resources" class="hud-panel hud-resources">
        <Bar kind="mana" frac={m.manaFrac} label={`Mana ${Math.round(m.manaPerMin)}/min`} icon={m.icons?.mana} warn={m.wasting ? { text: "wasting", title: "Mana is wasting: no spell or training can absorb it. Right click a spell to auto-charge it." } : null} />
        <Bar
          kind="pop"
          frac={m.cap > 0 ? m.pop / m.cap : 0}
          label={m.pop > m.cap ? `Followers ${m.pop} · homes ${m.cap}` : `Followers ${m.pop}/${m.cap}`}
          icon={m.icons?.pop}
          warn={m.pop > m.cap ? { text: "full", title: "More followers than homes: no one breeds until you build or upgrade Dwellings." } : null}
        />
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
      <div data-hud="title" class="hud-panel hud-title">
        <span class="hud-name">{m.mapLine}</span>
        <span class="hud-sub">
          tick {m.tick}
          {m.paused ? " | paused" : ""}
          {m.showHelp ? "" : keyText(" | {key:help} keys")}
        </span>
        {m.speed ? (
          <span data-ui="speed" class="hud-speed" title="Game speed (- and = keys)">
            <button class="prio speed-btn" data-ui="speed-down" disabled={!m.speed.canDown} onClick={() => act.speedStep?.(-1)} aria-label="Slower game">
              -
            </button>
            <span class="speed-value" data-ui="speed-value">
              {m.speed.label}
            </span>
            <button class="prio speed-btn" data-ui="speed-up" disabled={!m.speed.canUp} onClick={() => act.speedStep?.(1)} aria-label="Faster game">
              +
            </button>
          </span>
        ) : null}
      </div>
      <Minimap m={m} act={act} />
      {/* the right column stacks the objectives over the build list, so a long objectives panel pushes the list down */}
      <div class="hud-right">
        {m.objectives.length ? (
          <div data-hud="objectives" class="hud-panel hud-objectives">
            <span class="obj-head">Objectives</span>
            {m.objectives.map((o) => (
              <span key={o.part ?? o.text} class={"obj" + (o.done ? " done" : "")} data-hud-part={o.part}>
                <i class="obj-mark" aria-hidden="true">
                  {o.done ? "✓" : "◆"}
                </i>
                <span class="obj-text">{o.text}</span>
              </span>
            ))}
          </div>
        ) : null}
        <div data-hud="build" class="hud-panel hud-build">
          <span class="build-head" aria-hidden="true">
            Build
          </span>
          {m.buildable.map((bd) => (
            <button key={bd.id} class={"build-btn" + (m.placing === bd.id ? " active" : "") + (bd.locked ? " locked" : "")} disabled={bd.locked !== null} onClick={() => (m.placing === bd.id ? act.cancel() : act.startPlacing(bd.id))} title={`${bd.name}: ${costText(bd)}${bd.key ? ` (${bd.key})` : ""}${bd.locked ? `, locked: ${bd.locked}` : ""}`}>
              {bd.icon ? <img class="build-icon" src={bd.icon} alt="" /> : null}
              <span class="build-name">
                {bd.name}
                {bd.key ? <span class="hotkey">{bd.key}</span> : null}
              </span>
              <span class="build-cost" data-cost>
                {bd.wood}
                <i class="res-wood" />
                {bd.stone > 0 ? (
                  <>
                    {" "}
                    {bd.stone}
                    <i class="res-stone" />
                  </>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
      {m.notes.length ? (
        <div data-hud="notes" class="hud-panel hud-notes">
          {m.notes.map((n) =>
            n.jump ? (
              <span key={n.id} class={"note at " + n.kind} data-ui="note-jump" role="button" title={n.jump} onClick={() => act.noteJump?.(n.id)}>
                {n.text}
              </span>
            ) : (
              <span key={n.id} class={"note " + n.kind}>
                {n.text}
              </span>
            ),
          )}
        </div>
      ) : null}
      {/* bottom center, top to bottom: voice subtitle, undo, selection line, idle chip, then the stance plank at the screen edge */}
      <div class="hud-bottom">
        {m.subtitle ? (
          <div data-hud="subtitle" class="hud-subtitle">
            <b>{m.subtitle.speaker}:</b> {m.subtitle.text}
          </div>
        ) : null}
        {undo ? (
          <div data-hud="undo" class="hud-panel hud-undo">
            Backspace undoes this cast ({(m.undoSec ?? 0).toFixed(1)} s)
          </div>
        ) : null}
        {m.selected > 0 || m.placing || m.targeting || m.pointing ? (
          <div data-hud="selection" class="hud-panel hud-selection">
            {m.pointing === "rally" ? "Rally point: left click the ground, right click or Esc to cancel" : m.targeting ? targetingLine(m.targeting, m.targetCounts, m.targetHint) : m.placing ? `Placing ${m.placing}: left click to place, Esc to cancel${m.placeBlocked ? ` (${m.placeBlocked})` : ""}` : `${m.selected} selected${m.attack ? " | attack-move: click a target" : " | right click to move"}`}
          </div>
        ) : null}
        {m.idle && m.troops.kind === "none" && !undo ? (
          <div data-hud="idle" class="hud-panel hud-idle">
            <IdleChip idle={m.idle} act={act} alone={true} />
          </div>
        ) : null}
        <Troops t={m.troops} act={act} pointing={m.pointing} idle={m.idle} />
      </div>
      {m.forge ? <ForgePanel f={m.forge} act={act} /> : null}
      {m.tip && !m.forge ? (
        <div data-hud="tip" class="hud-panel hud-tip">
          <b>{m.tip.label}</b> {m.tip.text}
        </div>
      ) : null}
      {m.showHelp ? (
        <div data-hud="help" class="hud-panel hud-help">
          Drag select | double-click: same type | Ctrl+0-9 set group, 0-9 select, twice to jump | click a building to select it | right click move (on a tower: garrison) | A attack-move | R retreat | G garrison | S Shaper | Z-N spells | D dwelling | T tower | Q/E rotate | wheel zoom | M map | H help | P&nbsp;pause | F&nbsp;photo | L health bars | -/= speed | F5/F9 quick save/load | O briefing | U latest alert | . idle troops
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

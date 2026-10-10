// BACKLOG 12: the map editor panel. Renders the editor view model; every intent goes back through EditorActions.
// The planet behind it is the live preview: left click applies the tool, right click erases.
import { render } from "preact";
import { signal } from "@preact/signals";
import type { Choice } from "./menus.tsx";

export interface EditorView {
  tool: string;
  tools: { id: string; label: string; key: string }[];
  /** the tribe the Hearth tool places */
  tribe: number;
  tribes: { index: number; ai?: string; difficulty?: string }[];
  personalities: Choice[];
  difficulties: Choice[];
  goal: string;
  goals: Choice[];
  name: string;
  size: number;
  /** level time limit in seconds (0: none) */
  timeLimit: number;
  forge: boolean;
  /** validation messages; empty means the level can be playtested */
  issues: string[];
  canUndo: boolean;
  note: string | null;
}

export interface EditorActions {
  tool(id: string): void;
  tribe(k: number): void;
  goal(id: string): void;
  opponent(k: number, ai: string, difficulty: string): void;
  field(f: "name" | "timeLimit" | "forge", v: string | number | boolean): void;
  newMap(size: number, base: "land" | "sea"): void;
  undo(): void;
  playtest(): void;
  save(): void;
  download(): void;
  exit(): void;
}

export const editorModel = signal<EditorView | null>(null);

const LIMITS: Choice[] = [
  { value: "0", label: "No time limit" },
  { value: "600", label: "10 minutes" },
  { value: "900", label: "15 minutes" },
  { value: "1200", label: "20 minutes" },
  { value: "1800", label: "30 minutes" },
];

function Sel({ ui, value, options, onChange }: { ui: string; value: string; options: Choice[]; onChange: (v: string) => void }) {
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

function Editor({ act }: { act: EditorActions }) {
  const m = editorModel.value;
  if (!m) return null;
  const tribeChoices = [...m.tribes.map((t) => ({ value: String(t.index), label: t.index === 0 ? "You (tribe 1)" : `Rival ${t.index}` })), ...(m.tribes.length < 4 ? [{ value: String(m.tribes.length), label: "New rival" }] : [])];
  return (
    <div data-hud="editor" class="menu-panel editor-panel">
      <h2 class="menu-head">Map editor</h2>
      <div class="menu-row">
        <input class="menu-input editor-name" data-ui="editor-name" value={m.name} maxLength={40} onChange={(e) => act.field("name", (e.target as HTMLInputElement).value)} />
      </div>
      <p class="menu-sub">Tools (left click places, right click erases)</p>
      <div class="editor-tools">
        {m.tools.map((t) => (
          <button key={t.id} class={"menu-small" + (m.tool === t.id ? " on" : "")} data-ui={`editor-tool-${t.id}`} title={`Key ${t.key}`} onClick={() => act.tool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {m.tool === "hearth" ? (
        <div class="menu-row">
          <span class="menu-label">Hearth for</span>
          <Sel ui="editor-tribe" value={String(m.tribe)} options={tribeChoices} onChange={(v) => act.tribe(Number(v))} />
        </div>
      ) : null}
      <p class="menu-sub">Rivals</p>
      {m.tribes.length < 2 ? <p class="menu-note">No rivals: place a Hearth for a new rival.</p> : null}
      {m.tribes
        .filter((t) => t.index > 0)
        .map((t) => (
          <div key={t.index} class="menu-row">
            <span class="menu-label editor-rival">Rival {t.index}</span>
            <Sel ui={`editor-ai-${t.index}`} value={t.ai ?? ""} options={m.personalities} onChange={(v) => act.opponent(t.index, v, t.difficulty ?? "normal")} />
            <Sel ui={`editor-diff-${t.index}`} value={t.difficulty ?? "normal"} options={m.difficulties} onChange={(v) => act.opponent(t.index, t.ai ?? "aggressive", v)} />
          </div>
        ))}
      <p class="menu-sub">Win and lose</p>
      <div class="menu-row">
        <Sel ui="editor-goal" value={m.goal} options={m.goals} onChange={(v) => act.goal(v)} />
      </div>
      <div class="menu-row">
        <Sel ui="editor-limit" value={String(m.timeLimit)} options={LIMITS.some((l) => l.value === String(m.timeLimit)) ? LIMITS : [...LIMITS, { value: String(m.timeLimit), label: `${Math.round(m.timeLimit / 60)} minutes` }]} onChange={(v) => act.field("timeLimit", Number(v))} />
        <label class="menu-small editor-check">
          <input type="checkbox" data-ui="editor-forge" checked={m.forge} onChange={(e) => act.field("forge", (e.target as HTMLInputElement).checked)} /> Forge
        </label>
      </div>
      {m.issues.length ? (
        <ul class="editor-issues" data-ui="editor-issues">
          {m.issues.slice(0, 4).map((i) => (
            <li key={i}>{i}</li>
          ))}
          {m.issues.length > 4 ? <li>and {m.issues.length - 4} more</li> : null}
        </ul>
      ) : (
        <p class="menu-note editor-ok" data-ui="editor-valid">
          Ready to playtest.
        </p>
      )}
      {m.note ? <p class="menu-note">{m.note}</p> : null}
      <button class="menu-btn primary" data-ui="editor-playtest" disabled={m.issues.length > 0} onClick={() => act.playtest()}>
        Playtest
      </button>
      <div class="editor-actions">
        <button class="menu-small" data-ui="editor-undo" disabled={!m.canUndo} onClick={() => act.undo()}>
          Undo
        </button>
        <button class="menu-small" data-ui="editor-save" onClick={() => act.save()}>
          Save
        </button>
        <button class="menu-small" data-ui="editor-download" onClick={() => act.download()}>
          Download
        </button>
      </div>
      <div class="editor-actions">
        <button class="menu-small" data-ui="editor-new-land" onClick={() => act.newMap(m.size, "land")}>
          New land map
        </button>
        <button class="menu-small" data-ui="editor-new-sea" onClick={() => act.newMap(m.size, "sea")}>
          New island map
        </button>
        <button class="menu-small" data-ui="editor-exit" onClick={() => act.exit()}>
          Exit
        </button>
      </div>
    </div>
  );
}

export function mountEditor(el: HTMLElement, act: EditorActions): void {
  render(<Editor act={act} />, el);
}

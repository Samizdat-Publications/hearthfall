// BACKLOG 12: the map editor panel's view model from Game.editor, and its actions back into Game.
import { editorModel, mountEditor, type EditorView } from "@hearthfall/ui";
import { EDITOR_GOALS, EDITOR_TOOLS, goalOf, type EditorGoal, type EditorTool } from "./editor.ts";
import type { Game } from "./game.ts";

const TOOL_LABEL: Record<EditorTool, string> = {
  land: "Land",
  sea: "Sea",
  hill: "Hill",
  hearth: "Hearth",
  tree: "Trees",
  rock: "Rocks",
  shrine: "Shrine",
  reliquary: "Reliquary",
  erase: "Erase",
};
const GOAL_LABEL: Record<EditorGoal, string> = {
  conquest: "Defeat every rival",
  worship: "Pray at the first site",
  survive: "Survive 10 minutes",
  followers: "Reach 30 followers",
  hold: "Hold the Reliquaries",
  hill: "King of the Hill",
};

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export function mountGameEditor(el: HTMLElement, game: Game): { refresh: () => void } {
  const ai = game.pack.files.ai;
  const view = (): EditorView | null => {
    const ed = game.editor;
    if (!ed) return null;
    const d = ed.draft;
    return {
      tool: ed.tool,
      tools: EDITOR_TOOLS.map((t, k) => ({ id: t, label: TOOL_LABEL[t], key: String(k + 1) })),
      tribe: ed.tribe,
      tribes: d.tribes.map((t, k) => ({ index: k, ...(t.ai ? { ai: t.ai } : {}), ...(t.difficulty ? { difficulty: t.difficulty } : {}) })),
      personalities: ai.personalities.map((p) => ({ value: p.id, label: title(p.id) })),
      difficulties: ai.difficulties.map((x) => ({ value: x.id, label: title(x.id) })),
      goal: goalOf(d),
      goals: EDITOR_GOALS.map((g) => ({ value: g, label: GOAL_LABEL[g] })),
      name: d.name,
      size: d.map.size,
      timeLimit: d.lose?.find((l) => l.type === "timeLimit")?.seconds ?? 0,
      forge: !!d.forge,
      issues: ed.issues,
      canUndo: ed.undo.length > 0,
      note: ed.note,
    };
  };
  mountEditor(el, {
    tool: (t) => game.editorTool(t as EditorTool),
    tribe: (k) => game.editorTribe(k),
    goal: (g) => game.editorGoal(g as EditorGoal),
    opponent: (k, a, d) => game.editorOpponent(k, a, d),
    field: (f, v) => game.editorField(f, v),
    newMap: (size, base) => game.editorNew(size, base),
    undo: () => game.editorUndo(),
    playtest: () => game.editorPlaytest(),
    save: () => game.editorSave(),
    download: () => game.editorDownload(),
    exit: () => game.editorExit(),
  });
  const refresh = () => {
    editorModel.value = view();
    el.style.display = game.editor ? "" : "none";
  };
  refresh();
  return { refresh };
}

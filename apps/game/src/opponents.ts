// Skirmish opponents (M7): which controller runs each non-local tribe, from the URL params (and the
// M8 skirmish setup). Kept apart from game.ts so it is unit tested without a renderer.
import { makeBot } from "@hearthfall/ai";
import type { LevelDef } from "@hearthfall/data";
import type { Controller } from "@hearthfall/sim";

/** Default opponents cycle through the three personalities. */
export const DEFAULT_AI = ["aggressive", "sneaky", "turtle"];

/** Controllers for every tribe but the local one: OpponentAI personalities (M7), the economy bot, or none. */
export function opponentsFor(tribes: number, local: number, p: { ai: string[]; difficulty: string }): Controller[] {
  const out: Controller[] = [];
  const list = p.ai.length ? p.ai : DEFAULT_AI;
  let k = 0;
  for (let t = 0; t < tribes; t++) {
    if (t === local) continue;
    const kind = list[k++ % list.length];
    if (kind === "none") continue;
    out.push(kind === "economy" ? makeBot({ type: "economy", tribe: t, offset: t }) : makeBot({ type: "opponent", tribe: t, personality: kind, difficulty: p.difficulty, offset: t }));
  }
  return out;
}

/** Campaign level opponents, built exactly as createLevelWorld builds them (a restored save needs the same). */
export function levelOpponents(def: LevelDef): Controller[] {
  const out: Controller[] = [];
  def.tribes.forEach((t, k) => {
    if (k === 0 || !t.ai) return;
    out.push(makeBot({ type: "opponent", tribe: k, personality: t.ai, difficulty: t.difficulty ?? "normal", offset: k - 1 }));
  });
  return out;
}

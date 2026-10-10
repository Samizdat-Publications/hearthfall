// BACKLOG 45: HUD feedback when the local player's move order fails or units give up. Only units the
// player ordered recently count: settlers on their own errands and combat chases (orderGaveUp with
// chase 1, re-aimed at moving targets) fail often and stay silent.
import { CAT, wrapDelta, type SimEvent, type World } from "@hearthfall/sim";

export interface OrderNote {
  key: string;
  text: string;
  /** seconds of game time between repeats (a group order fails once per unit) */
  throttleSec: number;
}

export function orderNote(
  e: SimEvent,
  me: number,
  ordered: (id: number) => boolean,
): OrderNote | null {
  if (e.tribe !== me || !ordered(Number(e.id))) return null;
  if (e.type === "orderFailed")
    return {
      key: "orderFailed",
      text: "Your units cannot reach that place.",
      throttleSec: 4,
    };
  if (e.type === "orderGaveUp" && !Number(e.chase))
    return {
      key: "orderGaveUp",
      text: "Your units are stuck and gave up the order.",
      throttleSec: 6,
    };
  return null;
}

/**
 * Parking lot (stretch 2): a spell combo tip (ui.json combos) after the local player casts its first spell,
 * when the follow-up spell is castable. The key is per combo, so with an endless throttle it shows once a match.
 */
export function comboHint(e: SimEvent, me: number, combos: readonly { after: string; then: string; text: string }[], castable: readonly string[]): OrderNote | null {
  if (e.type !== "spellCast" || e.tribe !== me) return null;
  const c = combos.find((x) => x.after === e.spell && castable.includes(x.then));
  return c ? { key: `combo:${c.after}:${c.then}`, text: c.text, throttleSec: Infinity } : null;
}

/**
 * BACKLOG 36: a rival terrain spell with a lead-in (quake) is about to move land under the local
 * player's units: warn while there is still time to run.
 */
export function leadInWarning(e: SimEvent, w: World, me: number): OrderNote | null {
  if (e.type !== "terrainLeadIn" || e.tribe === me || Number(e.tribe) < 0) return null;
  const E = w.ents;
  const n = w.terrain.size;
  const r = Number(e.r) + 2;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== me) continue;
    const dx = wrapDelta(E.x[i] - Number(e.x), n);
    const dy = wrapDelta(E.y[i] - Number(e.y), n);
    if (dx * dx + dy * dy <= r * r) return { key: "leadIn", text: "The ground is cracking: get your people clear!", throttleSec: 6 };
  }
  return null;
}

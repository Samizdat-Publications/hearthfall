// BACKLOG 45: HUD feedback when the local player's move order fails or units give up. Only units the
// player ordered recently count: settlers on their own errands and combat chases (orderGaveUp with
// chase 1, re-aimed at moving targets) fail often and stay silent.
import type { SimEvent } from "@hearthfall/sim";

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

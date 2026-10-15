// BACKLOG 45: HUD feedback when the local player's move order fails or units give up. Only units the
// player ordered recently count: settlers on their own errands and combat chases (orderGaveUp with
// chase 1, re-aimed at moving targets) fail often and stay silent.
import { CAT, wrapDelta, type SimEvent, type World } from "@hearthfall/sim";

export interface OrderNote {
  key: string;
  text: string;
  /** seconds of game time between repeats (a group order fails once per unit) */
  throttleSec: number;
  /** a placed note: the HUD can jump the camera to this spot */
  at?: [number, number];
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
 * BACKLOG 36: a terrain spell with a lead-in (quake) is about to move land under the local player's units:
 * warn while there is still time to run. A rival's quake says so; a neutral one (tribe below 0, a level hazard)
 * is the land itself and is placed, so the HUD can show where. Own casts stay silent.
 */
export function leadInWarning(e: SimEvent, w: World, me: number): OrderNote | null {
  if (e.type !== "terrainLeadIn" || e.tribe === me) return null;
  const wild = Number(e.tribe) < 0;
  const E = w.ents;
  const n = w.terrain.size;
  const r = Number(e.r) + 2;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.cat[i] !== CAT.unit || E.tribe[i] !== me) continue;
    const dx = wrapDelta(E.x[i] - Number(e.x), n);
    const dy = wrapDelta(E.y[i] - Number(e.y), n);
    if (dx * dx + dy * dy > r * r) continue;
    if (wild) return { key: "leadInWild", text: "The land itself is cracking: get your people clear!", throttleSec: 6, at: [Number(e.x), Number(e.y)] };
    return { key: "leadIn", text: "The ground is cracking: get your people clear!", throttleSec: 6 };
  }
  return null;
}

/** What a neutral level hazard will do to the marked ground, by spell id (balance.hazards, the hazardWarn event). */
const HAZARD_PHRASE: Readonly<Record<string, string>> = {
  firerain: "Fire will rain on the marked ground",
  quake: "The marked ground will crack open",
  volcano: "A volcano will burst through the marked ground",
  deluge: "A flood will sweep the marked ground",
  erode: "The marked ground will wash away",
  bolt: "Lightning will strike the marked ground",
  lightning: "Lightning will strike the marked ground",
  hornets: "Hornets will swarm the marked ground",
  whirlwind: "A whirlwind will cross the marked ground",
  mire: "The marked ground will turn to mire",
};

/** A neutral level hazard has opened its warning (a ring with a countdown): say what and when, placed on the spot. */
export function hazardNote(e: SimEvent): OrderNote | null {
  if (e.type !== "hazardWarn") return null;
  const x = Number(e.x);
  const y = Number(e.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const what = HAZARD_PHRASE[String(e.spell)] ?? "Something will strike the marked ground";
  const secs = Math.max(1, Math.round(Number(e.seconds)));
  return { key: `hazard:${String(e.spell)}`, text: `${what} in ${secs} ${secs === 1 ? "second" : "seconds"}. Get your people clear!`, throttleSec: 2, at: [x, y] };
}

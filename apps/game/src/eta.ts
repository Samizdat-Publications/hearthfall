// Spell charge ETAs for the HUD spell bar (M8, DESIGN 3: "the HUD shows ETA per spell"). Plays the
// economy's round robin forward at the current income (Economy.distribute and nextSpell): the spell
// sink gets spellsPct of income while training also wants mana, all of it otherwise. A UI estimate
// only; income changes as followers come and go.

export interface EtaInput {
  costs: readonly number[];
  maxCharges: readonly number[];
  charges: ArrayLike<number>;
  progress: ArrayLike<number>;
  auto: ArrayLike<number>;
  unlocked: ArrayLike<number>;
  cursor: number;
  incomePerMin: number;
  spellsPct: number;
  trainDemand: number;
}

/** Seconds until each spell gains its next charge; -1 when it is full, not auto-charging, or income is zero. */
export function spellEtas(e: EtaInput): number[] {
  const n = e.costs.length;
  const out = new Array<number>(n).fill(-1);
  const perSec = (e.incomePerMin / 60) * (e.trainDemand > 0 ? e.spellsPct / 100 : 1);
  if (!(perSec > 0)) return out;
  const charges = Array.from(e.charges);
  const progress = Array.from(e.progress);
  let cursor = e.cursor;
  let t = 0;
  // every auto spell gets its ETA within one lap per charge slot, so 4 laps are always enough
  for (let guard = 0; guard < n * 4; guard++) {
    let s = -1;
    for (let k = 0; k < n; k++) {
      const c = (cursor + k) % n;
      if (e.unlocked[c] && e.auto[c] && charges[c] < e.maxCharges[c]) {
        s = c;
        break;
      }
    }
    if (s < 0) break;
    t += (e.costs[s] - progress[s]) / perSec;
    progress[s] = 0;
    charges[s]++;
    if (out[s] < 0) out[s] = t;
    if (out.every((v, i) => v >= 0 || !e.unlocked[i] || !e.auto[i] || e.charges[i] >= e.maxCharges[i])) break;
    cursor = (s + 1) % n;
  }
  return out;
}

/** "12s", "3m", or "" for no ETA. */
export function etaLabel(sec: number): string {
  if (sec < 0) return "";
  if (sec < 100) return `${Math.max(1, Math.ceil(sec))}s`;
  return `${Math.round(sec / 60)}m`;
}

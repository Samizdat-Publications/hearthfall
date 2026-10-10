// Per-tick soak checks on the sim event list (BACKLOG 59), pure so tools/harness/soakgates.test.mjs can feed them events.

/**
 * Give-ups that mean a unit is stuck: a non-chase order given up with the goal reachable fails at once; chase
 * give-ups are excused one by one (the target moved off), but past `limit` for one unit it is stuck too.
 * `counts` (Map id -> chase give-ups) carries over between ticks. Returns violation strings.
 */
export function giveUpViolations(events, counts, limit) {
  const v = [];
  for (const e of events) {
    if (e.type !== "orderGaveUp") continue;
    if (!e.chase) {
      if (e.reachable === 1) v.push(`unit ${e.id & 0xffff} gave up ${e.dist} cells from a reachable goal`);
      continue;
    }
    const n = (counts.get(e.id) ?? 0) + 1;
    counts.set(e.id, n);
    if (n === limit + 1) v.push(`unit ${e.id & 0xffff} gave up a chase ${n} times (gates.maxChaseGiveUpsPerUnit ${limit}): stuck while holding a target`);
  }
  return v;
}

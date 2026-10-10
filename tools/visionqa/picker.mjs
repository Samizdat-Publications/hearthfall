// BACKLOG 23 (docs/VISIONQA.md section 7): the optional playtest variety move picker. Every 30 game
// seconds a soak run (`npm run soak -- --mode ai --picker`) sends each opponent AI's situation as a short
// text summary with one choice question over the macro moves in PICKER_MOVES; the chosen move only
// focuses one OpponentAI action for the next 30 s (OpponentAI.setFocus). Off unless --picker is given.
import { ask } from "./decisions.mjs";

const UNIT_CAT = 3;
const BUILDING_CAT = 2;

/** A compact text summary of tribe t's situation (under 1,500 characters). */
export function situation(w, t) {
  const E = w.ents;
  const units = w.cfg.pack.units.units;
  const blds = w.cfg.pack.buildings.buildings;
  const per = w.tribes.map(() => ({ army: {}, buildings: {}, people: 0 }));
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.tribe[i] < 0 || E.tribe[i] >= per.length) continue;
    const row = per[E.tribe[i]];
    if (E.cat[i] === UNIT_CAT) {
      const id = units[E.type[i]].id;
      row.people++;
      if (id !== "settler" && id !== "shaper") row.army[id] = (row.army[id] ?? 0) + 1;
    } else if (E.cat[i] === BUILDING_CAT) {
      const id = blds[E.type[i]].id;
      row.buildings[id] = (row.buildings[id] ?? 0) + 1;
    }
  }
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  const me = w.tribes[t];
  const h = E.index(me.hearth);
  const lines = [
    `Real-time tribal god game. You advise tribe ${t} at minute ${(w.tick / (60 * w.cfg.tickHz)).toFixed(1)}.`,
    `Your people ${per[t].people} (followers ${w.economy.followers(t)}), army: ${fmt(per[t].army)}; buildings: ${fmt(per[t].buildings)}; Hearth ${h >= 0 ? Math.round((100 * E.hp[h]) / blds[E.type[h]].hp) + " percent" : "lost"}.`,
  ];
  for (const o of w.tribes) {
    if (o.index === t || !o.alive) continue;
    const oh = E.index(o.hearth);
    const d = oh >= 0 && h >= 0 ? Math.round(Math.hypot(E.x[oh] - E.x[h], E.y[oh] - E.y[h])) : -1;
    lines.push(`Rival tribe ${o.index}: people ${per[o.index].people}, army: ${fmt(per[o.index].army)}, Hearth ${d >= 0 ? d + " cells away" : "unknown"}.`);
  }
  if (w.worship.sites.length) lines.push(`Worship sites: ${w.worship.sites.length}.`);
  return lines.join("\n").slice(0, 1500);
}

/** Ask for one macro move; returns {move, usd} or {move: null, error}. */
export async function pickMove(w, t, moves) {
  const choices = Object.keys(moves).map((value) => ({ value, description: value.replace(/_/g, " ") }));
  const r = await ask({
    text: situation(w, t),
    questions: [{ type: "choice", name: "move", instructions: "Pick the macro move this tribe should lean toward for the next 30 seconds to make the match more varied and interesting while still trying to win.", choices }],
    check: "picker",
    timeoutMs: 15000,
  });
  if (!r.ok) return { move: null, usd: 0, error: r.error };
  const a = r.answers[0];
  return { move: a?.type === "refusal" ? null : (a?.choice ?? null), usd: r.usd };
}

/**
 * Strategy diversity of a set of ai soak results: for each personality, the mean pairwise Jensen-Shannon
 * distance between the action mixes of its matches (0 identical play every match, 1 nothing shared), plus
 * the share of unfinished matches (stalemates) and the spread of match end minutes.
 */
export function diversity(results) {
  const js = (p, q) => {
    const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
    let d = 0;
    for (const k of keys) {
      const a = p[k] ?? 0;
      const b = q[k] ?? 0;
      const m = (a + b) / 2;
      if (a > 0) d += 0.5 * a * Math.log2(a / m);
      if (b > 0) d += 0.5 * b * Math.log2(b / m);
    }
    return Math.sqrt(Math.max(0, d));
  };
  const norm = (o) => {
    const s = Object.values(o).reduce((x, y) => x + y, 0) || 1;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / s]));
  };
  const mixes = {};
  const ends = [];
  let unfinished = 0;
  let n = 0;
  for (const r of results) {
    if (!r.ai) continue;
    n++;
    ends.push(r.ai.endMinute);
    if (r.ai.alive.length > 1) unfinished++;
    for (const a of r.ai.ais) if (a.personality && a.stats) (mixes[a.personality] ??= []).push(norm(a.stats.actions));
  }
  const per = {};
  for (const [p, ms] of Object.entries(mixes)) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) (s += js(ms[i], ms[j])), c++;
    per[p] = c ? +(s / c).toFixed(3) : 0;
  }
  const vals = Object.values(per);
  const mean = ends.reduce((x, y) => x + y, 0) / Math.max(1, ends.length);
  const sd = Math.sqrt(ends.reduce((x, y) => x + (y - mean) * (y - mean), 0) / Math.max(1, ends.length));
  return { matches: n, actionDiversity: +(vals.reduce((x, y) => x + y, 0) / Math.max(1, vals.length)).toFixed(3), perPersonality: per, unfinishedShare: +(unfinished / Math.max(1, n)).toFixed(3), endMinuteSd: +sd.toFixed(2) };
}

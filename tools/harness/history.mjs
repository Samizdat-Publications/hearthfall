// BACKLOG 24 and 25: run history and trend charts. Soak (with --record, and every `npm run soak:nightly`)
// and bench runs append one compact row each to reports/history/<kind>.jsonl, stamped with the commit;
// `npm run trends` draws them as small-multiple line charts in reports/latest/trends.svg. The history
// folder is local to this machine (reports/ is ignored) and nothing else deletes it.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { gitSha, ROOT } from "./lib.mjs";

export const HISTORY = ROOT + "reports/history/";

export function appendHistory(kind, row) {
  mkdirSync(HISTORY, { recursive: true });
  const { sha, dirty } = gitSha();
  appendFileSync(HISTORY + kind + ".jsonl", JSON.stringify({ at: new Date().toISOString(), sha: sha + (dirty ? "+" : ""), ...row }) + "\n");
}

export function readHistory(kind) {
  const p = HISTORY + kind + ".jsonl";
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** The balance numbers of one soak run worth following over commits. */
export function soakRow(mode, metrics, results, result) {
  const n = results.length;
  const row = {
    mode,
    seeds: metrics.seeds,
    minutes: metrics.minutes,
    matches: n,
    clean: results.filter((r) => r.ok).length,
    result,
    failedPer10: n ? +((metrics.orderFailed * 10) / n).toFixed(2) : 0,
    gaveUpPer10: n ? +((metrics.orderGaveUp * 10) / n).toFixed(2) : 0,
    drowned: metrics.drowned,
    avgTickMs: metrics.avgTickMs,
  };
  if (mode === "ai") {
    const decided = Object.values(metrics.wins ?? {}).reduce((s, v) => s + v, 0);
    row.winShare = Object.fromEntries(Object.entries(metrics.wins ?? {}).map(([k, v]) => [k, decided ? Math.round((v * 100) / decided) : 0]));
    row.unfinishedPct = n ? Math.round(((metrics.stalemates ?? 0) * 100) / n) : 0;
    row.medianMinutes = metrics.medianMinutes;
    row.spellTypes = metrics.spellTypes;
    row.wavesArrivedPct = metrics.waves ? Math.round((metrics.wavesArrived * 100) / metrics.waves) : null;
  }
  if (mode === "ai-idle") row.idleWins = Object.fromEntries(Object.entries(metrics.idle ?? {}).map(([k, v]) => [k, Math.round((v.won * 100) / Math.max(1, v.n))]));
  if (mode === "difficulty") row.scores = Object.fromEntries(Object.entries(metrics.difficulty ?? {}).map(([k, v]) => [k, v.score]));
  if (mode === "economy") row.popMedian = metrics.popMedian;
  if (mode === "war" || mode === "war-long") Object.assign(row, { killed: metrics.killed, converted: metrics.converted, combatMinutes: metrics.combatMinutesMedian, lastKillMinute: metrics.lastKillMinuteMedian });
  return row;
}

/**
 * Small-multiple line charts as one SVG. panels: [{title, labels, series: [{label, color, values}], min?, max?}],
 * one value per run and one x label per run (the commit). Gaps (null) break a line.
 */
export function trendSvg(title, panels) {
  const W = 460;
  const H = 210;
  const cols = 2;
  const pad = { l: 46, r: 12, t: 30, b: 34 };
  const rows = Math.ceil(panels.length / cols);
  const total = { w: cols * W + 20, h: rows * H + 50 };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${total.w}" height="${total.h}" font-family="Trebuchet MS, Segoe UI, sans-serif" font-size="11">`, `<rect width="100%" height="100%" fill="#f6efe2"/>`, `<text x="12" y="26" font-size="16" font-weight="bold" fill="#3a281b">${esc(title)}</text>`];
  panels.forEach((p, k) => {
    const labels = p.labels;
    const n = labels.length;
    const ox = 10 + (k % cols) * W;
    const oy = 40 + Math.floor(k / cols) * H;
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const vals = p.series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined && Number.isFinite(v)));
    let lo = vals.length ? Math.min(...vals) : 0;
    let hi = vals.length ? Math.max(...vals) : 1;
    if (p.min !== undefined) lo = Math.min(lo, p.min);
    if (p.max !== undefined) hi = Math.max(hi, p.max);
    if (hi - lo < 1e-9) hi = lo + 1;
    const X = (i) => ox + pad.l + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
    const Y = (v) => oy + pad.t + ih - ((v - lo) * ih) / (hi - lo);
    parts.push(`<rect x="${ox}" y="${oy}" width="${W - 10}" height="${H - 10}" fill="#fffaf0" stroke="#d8cbb4"/>`);
    parts.push(`<text x="${ox + 8}" y="${oy + 18}" font-size="12" font-weight="bold" fill="#3a281b">${esc(p.title)}</text>`);
    for (let g = 0; g <= 4; g++) {
      const v = lo + ((hi - lo) * g) / 4;
      const y = Y(v);
      parts.push(`<line x1="${ox + pad.l}" x2="${ox + pad.l + iw}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eadfcb"/>`);
      parts.push(`<text x="${ox + pad.l - 4}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#7a6a55">${+v.toFixed(2)}</text>`);
    }
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) parts.push(`<text x="${X(i).toFixed(1)}" y="${oy + H - 18}" text-anchor="middle" fill="#7a6a55">${esc(labels[i])}</text>`);
    let lx = ox + pad.l;
    for (const s of p.series) {
      let d = "";
      let pen = false;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined || !Number.isFinite(v)) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      });
      if (d) parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
      s.values.forEach((v, i) => {
        if (v !== null && v !== undefined && Number.isFinite(v)) parts.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.5" fill="${s.color}"/>`);
      });
      parts.push(`<rect x="${lx}" y="${oy + H - 14}" width="8" height="8" fill="${s.color}"/><text x="${lx + 11}" y="${oy + H - 7}" fill="#3a281b">${esc(s.label)}</text>`);
      lx += 14 + s.label.length * 6;
    }
  });
  parts.push("</svg>");
  return parts.join("\n");
}

const COLORS = ["#b8453a", "#3f7cac", "#8fae5a", "#e0b04a", "#6d6a8a", "#a0522d"];

/** Panels for the soak history (one point per recorded run of each mode) and the bench history. */
export function trendPanels(soak, bench, render) {
  const panels = [];
  const ai = soak.filter((r) => r.mode === "ai");
  const series = (rows, keys, get) => keys.map((k, j) => ({ label: k, color: COLORS[j % COLORS.length], values: rows.map((r) => get(r, k) ?? null) }));
  const labels = {};
  if (ai.length) {
    labels.ai = ai.map((r) => r.sha);
    panels.push({ title: `ai soak: win share per personality (%)`, min: 0, max: 100, series: series(ai, ["aggressive", "sneaky", "turtle"], (r, k) => r.winShare?.[k] ?? 0), labels: labels.ai });
    panels.push({ title: "ai soak: median match (min) and unfinished (%)", min: 0, series: [{ label: "median min", color: COLORS[1], values: ai.map((r) => r.medianMinutes ?? null) }, { label: "unfinished %", color: COLORS[0], values: ai.map((r) => r.unfinishedPct ?? null) }], labels: labels.ai });
    panels.push({ title: "ai soak: failed and given-up orders per 10 matches", min: 0, series: [{ label: "failed", color: COLORS[0], values: ai.map((r) => r.failedPer10) }, { label: "gave up", color: COLORS[4], values: ai.map((r) => r.gaveUpPer10) }], labels: labels.ai });
  }
  const diff = soak.filter((r) => r.mode === "difficulty");
  if (diff.length) panels.push({ title: "difficulty soak: score against normal", min: 0, max: 1, series: series(diff, ["easy", "hard", "brutal"], (r, k) => r.scores?.[k]), labels: diff.map((r) => r.sha) });
  const eco = soak.filter((r) => r.mode === "economy");
  if (eco.length) panels.push({ title: "economy soak: median population at the end", min: 0, series: [{ label: "population", color: COLORS[2], values: eco.map((r) => r.popMedian ?? null) }], labels: eco.map((r) => r.sha) });
  if (bench.length)
    panels.push({ title: "bench: sim tick (ms)", min: 0, series: [{ label: "2000 wander avg", color: COLORS[1], values: bench.map((r) => r.tickAvgMs) }, { label: "battle avg", color: COLORS[0], values: bench.map((r) => r.battleAvgMs) }, { label: "wander p99", color: COLORS[4], values: bench.map((r) => r.tickP99Ms) }], labels: bench.map((r) => r.sha) });
  if (bench.some((r) => r.economyAvgMs !== undefined)) panels.push({ title: "bench: economy tick (ms)", min: 0, series: [{ label: "tick avg", color: COLORS[2], values: bench.map((r) => r.economyAvgMs ?? null) }, { label: "tick p99", color: COLORS[4], values: bench.map((r) => r.economyP99Ms ?? null) }, { label: "Economy.update avg", color: COLORS[3], values: bench.map((r) => r.economyUpdateAvgMs ?? null) }], labels: bench.map((r) => r.sha) });
  if (bench.length) panels.push({ title: "bench: spikes (ms)", min: 0, series: [{ label: "quake", color: COLORS[3], values: bench.map((r) => r.terrainOpMs) }, { label: "after quake", color: COLORS[0], values: bench.map((r) => r.afterTerrainOpMs) }, { label: "spell storm", color: COLORS[5], values: bench.map((r) => r.spellStormMs) }], labels: bench.map((r) => r.sha) });
  if (render.length) panels.push({ title: "render bench: CPU per frame at 1440p (ms)", min: 0, series: [{ label: "median", color: COLORS[1], values: render.map((r) => r.medianMs) }, { label: "p95", color: COLORS[0], values: render.map((r) => r.p95Ms) }], labels: render.map((r) => r.sha) });
  return panels;
}

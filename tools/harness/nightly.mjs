// BACKLOG 24: `npm run soak:nightly`, the nightly-style full soak: 64 ai seeds plus the other balance soaks,
// each recorded to reports/history/soak.jsonl, then the trend chart (`npm run trends`). Fits one command
// (each mode keeps the soak's own 8 minute deadline; the whole run takes a few minutes on this PC).
import { writeFileSync } from "node:fs";
import { LATEST, writeReport } from "./lib.mjs";
import { readHistory, trendPanels, trendSvg } from "./history.mjs";

export const NIGHTLY = [
  { mode: "ai", seeds: 64, minutes: 20 },
  { mode: "ai-idle", seeds: 4, minutes: 25 },
  { mode: "difficulty", seeds: 8, minutes: 20 },
  { mode: "economy", seeds: 16, minutes: 10 },
  { mode: "war", seeds: 8, minutes: 20 },
];

/** Captures a sub-command's lines instead of printing them. */
class Quiet {
  constructor() {
    this.lines = [];
  }
  line(s) {
    this.lines.push(s);
  }
  finish(status, detail = "") {
    this.status = status;
    this.detail = detail;
    return status === "FAIL" ? 1 : 0;
  }
}

export function writeTrends(out) {
  const panels = trendPanels(readHistory("soak"), readHistory("bench"), readHistory("bench-render"));
  const file = LATEST + "trends.svg";
  writeFileSync(file, trendSvg("Hearthfall trends (one point per recorded run, labeled by commit)", panels));
  out.line(`trends: ${panels.length} panels, reports/latest/trends.svg`);
  return panels.length;
}

export async function nightly(out, only) {
  const soak = (await import("./soak.mjs")).default;
  const runs = [];
  for (const m of NIGHTLY.filter((x) => !only || only.includes(x.mode))) {
    const q = new Quiet();
    const t0 = Date.now();
    await soak(q, "soak", { mode: m.mode, seeds: String(m.seeds), minutes: String(m.minutes), record: true, _: [] });
    const sec = Math.round((Date.now() - t0) / 1000);
    runs.push({ ...m, status: q.status, detail: q.detail, sec, lines: q.lines });
    // the soak line with the balance numbers is the last one it printed before RESULT
    out.line(`${m.mode} ${m.seeds}x${m.minutes}: ${q.status}${q.detail ? " " + q.detail : ""} (${sec}s) | ${(q.lines[q.lines.length - 1] ?? "").slice(0, 140)}`);
  }
  writeReport("nightly.json", { runs });
  writeTrends(out);
  const bad = runs.filter((r) => r.status === "FAIL");
  return out.finish(bad.length ? "FAIL" : "PASS", bad.length ? `${bad.map((r) => r.mode).join(", ")} (see reports/latest/nightly.json)` : "");
}

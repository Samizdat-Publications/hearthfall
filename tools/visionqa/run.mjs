// VisionQA runner and calibration (docs/VISIONQA.md sections 4 to 6). One Decisions request per image
// packs every applicable question. Shots are flagged for Claude only when a calibrated check fails,
// an answer is a refusal or uncertain, or VisionQA disagrees with the code checks.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ROOT, writeReport } from "../harness/lib.mjs";
import { ask } from "./decisions.mjs";

// flags Claude looked at and judged false positives, keyed by the PNG's sha256 (a changed image is judged again)
const REVIEWED_FILE = ROOT + "tools/visionqa/reviewed.json";
const reviewedMap = () => (existsSync(REVIEWED_FILE) ? JSON.parse(readFileSync(REVIEWED_FILE, "utf8")).reviewed : {});
const pngHash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** `npm run visionqa -- --reviewed <shot id> --reason "..."`: record a flagged shot of the latest run as looked at. */
export function markReviewed(out, id, reason) {
  if (!reason || reason === true) return out.finish("FAIL", "1 (--reason is required)");
  const shots = JSON.parse(readFileSync(ROOT + "reports/latest/shots.json", "utf8"));
  const s = shots.results.find((r) => r.id === id);
  if (!s || !existsSync(ROOT + s.file)) return out.finish("FAIL", `1 (no shot ${id} in the latest set ${shots.set})`);
  const all = reviewedMap();
  all[pngHash(ROOT + s.file)] = { set: shots.set, id, reason, at: new Date().toISOString().slice(0, 10) };
  writeFileSync(REVIEWED_FILE, JSON.stringify({ $comment: "VisionQA flags reviewed by Claude, keyed by PNG sha256 (docs/VISIONQA.md)", reviewed: all }, null, 2) + "\n");
  out.line(`reviewed ${shots.set}/${id}`);
  return out.finish("PASS");
}

const CHECKS = () => JSON.parse(readFileSync(ROOT + "tools/visionqa/checks.json", "utf8")).checks;
const THRESH_FILE = ROOT + "tools/visionqa/thresholds.json";
const thresholds = () => (existsSync(THRESH_FILE) ? JSON.parse(readFileSync(THRESH_FILE, "utf8")).checks : {});

function questionsFor(kind) {
  return CHECKS()
    .filter((c) => c.appliesTo.includes(kind))
    .map((c) => {
      const q = { type: c.type, name: c.id, instructions: c.instructions };
      if (c.type === "choice") q.choices = c.choices;
      if (c.type === "score") q.levels = c.levels;
      return q;
    });
}

/** Ask all applicable checks about one PNG; returns {answers: {id: answer}, usd, error}. */
export async function judge(pngPath, kind, label) {
  const qs = questionsFor(kind);
  if (!qs.length) return { answers: {}, usd: 0 };
  const r = await ask({ images: [readFileSync(pngPath)], questions: qs, detail: "low", check: `shot:${label}` });
  if (!r.ok) return { answers: {}, usd: 0, error: r.error };
  const answers = {};
  r.answers.forEach((a, i) => (answers[qs[i].name] = a));
  return { answers, usd: r.usd };
}

function verdict(check, ans, kind, th) {
  if (!ans) return { status: "unavailable" };
  if (ans.type === "refusal") return { status: "refusal" };
  const t = th[check.id]?.threshold ?? 0.5;
  const advisory = th[check.id]?.advisory ?? !th[check.id];
  if (check.passWhen === "never") return { status: "info", value: +ans.score.toFixed(2) };
  if (check.type === "choice") {
    const want = check.expectByKind?.[kind];
    if (ans.confidence < 0.5) return { status: "uncertain", value: ans.choice, advisory };
    return { status: !want || ans.choice === want ? "pass" : "fail", value: ans.choice, advisory };
  }
  const p = ans.probability;
  const ok = check.passWhen === "below" ? p < t : p > t;
  return { status: ok ? "pass" : "fail", value: +p.toFixed(3), threshold: t, advisory };
}

export async function runChecks(out) {
  const shots = JSON.parse(readFileSync(ROOT + "reports/latest/shots.json", "utf8"));
  const th = thresholds();
  const checks = CHECKS();
  const results = [];
  const reviewed = reviewedMap();
  let usd = 0;
  for (const s of shots.results) {
    const path = ROOT + s.file;
    if (!existsSync(path)) continue;
    const j = await judge(path, s.kind, s.id);
    usd += j.usd;
    const per = {};
    let flag = Boolean(j.error);
    const why = j.error ? [`unavailable: ${j.error.slice(0, 80)}`] : [];
    for (const c of checks.filter((c) => c.appliesTo.includes(s.kind))) {
      const v = verdict(c, j.answers[c.id], s.kind, th);
      per[c.id] = v;
      if (v.status === "refusal" || v.status === "uncertain") {
        flag = true;
        why.push(`${c.id} ${v.status}`);
      }
      // a planted overlap (expectDomIssue shots) that the DOM check also found: VisionQA agrees, no flag
      const planted = c.id === "ui_overlap" && (s.checks?.dom?.issues ?? []).some((i) => i.includes(" overlaps "));
      if (v.status === "fail" && planted) v.expected = true;
      else if (v.status === "fail" && !v.advisory) {
        flag = true;
        why.push(`${c.id} failed (${v.value})`);
      }
    }
    if (s.ok && why.some((w) => w.includes("failed"))) why.push("disagrees with code checks");
    const rv = flag && !j.error ? reviewed[pngHash(path)] : undefined;
    if (rv) {
      flag = false;
      why.push(`reviewed ${rv.at}: ${rv.reason}`);
    }
    results.push({ id: s.id, flag, why, checks: per });
  }
  writeReport("visionqa.json", { set: shots.set, usd, results });
  const flagged = results.filter((r) => r.flag);
  for (const r of flagged) out.line(`FLAG ${r.id}: ${r.why.join("; ")}`.slice(0, 200));
  const q = results.map((r) => r.checks.visual_quality?.value).filter((v) => v !== undefined);
  out.line(`visionqa: ${results.length - flagged.length}/${results.length} unflagged, quality avg ${q.length ? (q.reduce((a, b) => a + b, 0) / q.length).toFixed(2) : "n/a"} of 3, $${usd.toFixed(5)}`);
  return out.finish(flagged.length ? "PARTIAL" : "PASS", flagged.length ? `${flagged.length} shot(s) flagged for a look (reports/latest/visionqa.json)` : "");
}

/** Best threshold (ties go to the one nearest 0.5) for probability answers against boolean labels. */
export function bestThreshold(rows, id) {
  let best = { t: 0.5, acc: -1 };
  for (let k = 1; k <= 19; k++) {
    const t = k / 20;
    const acc = rows.filter((x) => x.answers[id].probability > t === x.labels[id]).length / rows.length;
    if (acc > best.acc + 1e-9 || (Math.abs(acc - best.acc) < 1e-9 && Math.abs(t - 0.5) < Math.abs(best.t - 0.5))) best = { t, acc };
  }
  return best;
}

/**
 * BACKLOG 43: stratified half split (rows sorted by label then id, alternating), so each half holds both
 * labels; the threshold is fit on the first half and scored on the held-out second half. A check is
 * trusted (not advisory) only when both its fit and held-out accuracy reach 85 percent.
 */
export function fitChecks(samples, checks) {
  const res = {};
  for (const c of checks) {
    if (c.type === "score") continue;
    const rows = samples.filter((x) => x.labels[c.id] !== undefined && x.answers[c.id] && x.answers[c.id].type !== "refusal");
    if (!rows.length) continue;
    if (c.type === "choice") {
      const acc = rows.filter((x) => x.answers[c.id].choice === x.labels[c.id]).length / rows.length;
      res[c.id] = { accuracy: +acc.toFixed(3), n: rows.length, advisory: acc < 0.85 };
      continue;
    }
    const sorted = [...rows].sort((a, b) => Number(a.labels[c.id]) - Number(b.labels[c.id]) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const fit = sorted.filter((_, i) => i % 2 === 0);
    const hold = sorted.filter((_, i) => i % 2 === 1);
    const best = bestThreshold(fit, c.id);
    const score = (rs) => (rs.length ? rs.filter((x) => x.answers[c.id].probability > best.t === x.labels[c.id]).length / rs.length : 0);
    const held = hold.length ? score(hold) : best.acc;
    const all = score(rows);
    res[c.id] = { threshold: best.t, accuracy: +all.toFixed(3), fitAccuracy: +best.acc.toFixed(3), holdoutAccuracy: +held.toFixed(3), n: rows.length, nHoldout: hold.length, advisory: best.acc < 0.85 || held < 0.85 };
  }
  return res;
}

/** Calibrate thresholds on the labeled calibration shot set; checks under 85% fit or held-out accuracy become advisory. */
export async function calibrate(out) {
  const { captureSet } = await import("../harness/shots.mjs");
  const set = JSON.parse(readFileSync(ROOT + "tools/harness/shotsets/calibration.json", "utf8")).shots;
  const shots = await captureSet("calibration");
  const samples = [];
  let usd = 0;
  for (const s of shots) {
    const def = set.find((d) => d.id === s.id);
    const j = await judge(ROOT + s.file, s.kind, s.id);
    usd += j.usd;
    if (!j.error) samples.push({ id: s.id, labels: def.labels, answers: j.answers });
  }
  const out2 = { $comment: "Generated by npm run visionqa:calibrate. Thresholds are fit on one half of the labeled calibration set and scored on the other (BACKLOG 43).", when: new Date().toISOString(), samples: samples.length, checks: fitChecks(samples, CHECKS()) };
  writeFileSync(THRESH_FILE, JSON.stringify(out2, null, 2) + "\n");
  writeReport("visionqa-calibration.json", { samples });
  for (const [id, v] of Object.entries(out2.checks)) out.line(`${id}: accuracy ${v.accuracy}${v.holdoutAccuracy !== undefined ? `, held out ${v.holdoutAccuracy}` : ""}${v.threshold !== undefined ? ` at ${v.threshold}` : ""}${v.advisory ? " (advisory)" : ""}`);
  out.line(`calibrated on ${samples.length} images, $${usd.toFixed(5)}`);
  return out.finish("PASS");
}

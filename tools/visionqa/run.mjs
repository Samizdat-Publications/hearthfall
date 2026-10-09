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
      if (v.status === "fail" && !v.advisory) {
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

/** Calibrate thresholds on the labeled calibration shot set; checks under 85% accuracy become advisory. */
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
  const out2 = { $comment: "Generated by npm run visionqa:calibrate. Thresholds maximize accuracy on the labeled calibration set.", when: new Date().toISOString(), samples: samples.length, checks: {} };
  for (const c of CHECKS()) {
    if (c.type === "score") continue;
    const rows = samples.filter((x) => x.labels[c.id] !== undefined && x.answers[c.id] && x.answers[c.id].type !== "refusal");
    if (!rows.length) continue;
    if (c.type === "choice") {
      const acc = rows.filter((x) => x.answers[c.id].choice === x.labels[c.id]).length / rows.length;
      out2.checks[c.id] = { accuracy: +acc.toFixed(3), n: rows.length, advisory: acc < 0.85 };
      continue;
    }
    let best = { t: 0.5, acc: -1 };
    for (let t = 0.05; t < 0.951; t += 0.05) {
      const acc = rows.filter((x) => x.answers[c.id].probability > t === x.labels[c.id]).length / rows.length;
      if (acc > best.acc + 1e-9 || (Math.abs(acc - best.acc) < 1e-9 && Math.abs(t - 0.5) < Math.abs(best.t - 0.5))) best = { t: +t.toFixed(2), acc };
    }
    out2.checks[c.id] = { threshold: best.t, accuracy: +best.acc.toFixed(3), n: rows.length, advisory: best.acc < 0.85 };
  }
  writeFileSync(THRESH_FILE, JSON.stringify(out2, null, 2) + "\n");
  for (const [id, v] of Object.entries(out2.checks)) out.line(`${id}: accuracy ${v.accuracy}${v.threshold !== undefined ? ` at ${v.threshold}` : ""}${v.advisory ? " (advisory)" : ""}`);
  out.line(`calibrated on ${samples.length} images, $${usd.toFixed(5)}`);
  return out.finish("PASS");
}

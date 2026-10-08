// npm run visionqa / visionqa:probe entry. With the provider off every call is a no-op SKIP.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { ROOT, writeReport } from "../harness/lib.mjs";
import { USD_PER_INPUT_TOKEN, ask, provider, spend } from "./decisions.mjs";

const PROBE_CAP_USD = 0.05;
const PROBE_MINUTES = 6;

function crop(buf, size = 512) {
  const src = PNG.sync.read(buf);
  const dst = new PNG({ width: size, height: size });
  const ox = Math.max(0, ((src.width - size) / 2) | 0);
  const oy = Math.max(0, ((src.height - size) / 2) | 0);
  PNG.bitblt(src, dst, ox, oy, Math.min(size, src.width), Math.min(size, src.height), 0, 0);
  return PNG.sync.write(dst);
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null;
};

async function probe(out) {
  const shotPath = ROOT + "reports/latest/doctor-shot.png";
  if (!process.env.OPENAI_API_KEY) return out.finish("SKIP", "OPENAI_API_KEY missing, provider stays off");
  if (!existsSync(shotPath)) return out.finish("FAIL", "1 (run npm run doctor first to capture reports/latest/doctor-shot.png)");
  const full = readFileSync(shotPath);
  const small = crop(full);
  const deadline = Date.now() + PROBE_MINUTES * 60000;
  const startSpend = spend().total;
  const spent = () => spend().total - startSpend;
  const q1 = [{ type: "predicate", name: "landscape", instructions: "Is a landscape with land and water clearly visible?" }];
  const rows = [];
  const notes = [];
  let firstError = null;
  const call = async (label, opts) => {
    if (Date.now() > deadline || spent() > PROBE_CAP_USD) return null;
    const r = await ask({ ...opts, check: "probe:" + label });
    if (!r.ok && !firstError) firstError = `${label}: ${r.status ?? ""} ${r.error}`;
    return r;
  };

  // 1. detail levels x two image sizes
  for (const [imgName, img, dims] of [["full", full, "1280x720"], ["crop", small, "512x512"]]) {
    for (const detail of ["low", "auto", "high", "original"]) {
      const r = await call(`${imgName}-${detail}`, { images: [img], questions: q1, detail });
      if (r?.ok) rows.push({ image: dims, detail, tokens: r.inputTokens, usd: r.usd, ms: r.ms, p: r.answers[0].probability });
      else if (r) rows.push({ image: dims, detail, error: `${r.status ?? ""} ${r.error}`.slice(0, 120) });
      if (!r?.ok && detail === "low" && imgName === "full") break;
    }
    if (firstError && rows.every((x) => x.error)) break;
  }
  const working = rows.some((x) => !x.error);

  // 2. latency: 20 sequential + 10 parallel at low detail
  const seq = [];
  let headers = {};
  if (working) {
    for (let i = 0; i < 20; i++) {
      const r = await call("seq", { images: [full], questions: q1, detail: "low" });
      if (r?.ok) {
        seq.push(r.ms);
        headers = r.headers;
      }
    }
  }
  const par = [];
  if (working) {
    const rs = await Promise.all(Array.from({ length: 10 }, () => call("par", { images: [full], questions: q1, detail: "low" })));
    for (const r of rs) if (r?.ok) par.push(r.ms);
  }

  // 3. packing: 6 predicates on one image; 8 images in one request
  let multiQ = null;
  let multiImg = null;
  if (working) {
    const six = ["Is a landscape with land and water clearly visible?", "Is this frame essentially blank or a single flat color?", "Are there small colored cone shapes on the land?", "Is there any text visible in the top left corner?", "Is there bright magenta (missing texture) anywhere?", "Do any interface panels overlap or run off screen?"].map((instructions, i) => ({ type: "predicate", name: "q" + i, instructions }));
    const r6 = await call("six-questions", { images: [full], questions: six, detail: "low" });
    if (r6?.ok) multiQ = { tokens: r6.inputTokens, ms: r6.ms, answers: r6.answers.map((a) => (a.type === "predicate" ? +a.probability.toFixed(3) : a.type)) };
    const r8 = await call("eight-images", { images: Array(8).fill(full), questions: q1, detail: "low" });
    if (r8?.ok) multiImg = { tokens: r8.inputTokens, ms: r8.ms };
  }

  const lowFull = rows.find((x) => x.image === "1280x720" && x.detail === "low" && !x.error);
  const highFull = rows.find((x) => x.image === "1280x720" && x.detail === "high" && !x.error);
  const perShotLow = lowFull ? lowFull.tokens * USD_PER_INPUT_TOKEN : null;
  const ok = working && seq.length >= 15;
  if (!ok) notes.push(`probe failed or incomplete: ${firstError ?? "too few successful calls"}`);
  const report = { when: new Date().toISOString(), ok, rows, latency: { seqP50: pct(seq, 50), seqP95: pct(seq, 95), parP50: pct(par, 50), parP95: pct(par, 95), seqN: seq.length, parN: par.length }, rateHeaders: headers, multiQ, multiImg, probeSpendUsd: +spent().toFixed(6), notes };
  writeReport("visionqa-probe.json", report);
  writeFileSync(ROOT + "tools/visionqa/state.json", JSON.stringify({ probeOk: ok, provider: ok ? "decisions" : "off", when: report.when, reason: ok ? "probe succeeded" : notes[0] }, null, 2) + "\n");

  const md = [
    "# VisionQA calibration: probe results",
    "",
    `Measured by \`npm run visionqa:probe\` on ${report.when.slice(0, 10)} against \`gpt-6-luna\` on \`POST /v1/decisions\`. USD computed from \`usage.input_tokens\` at $0.10 per 1M input tokens. Probe spend: $${report.probeSpendUsd}. Verdict: **${ok ? "provider on (decisions)" : "provider stays off"}**.`,
    "",
    "| Image | Detail | Input tokens | USD per call | Latency ms |",
    "|---|---|---|---|---|",
    ...rows.map((x) => (x.error ? `| ${x.image} | ${x.detail} | error: ${x.error.replace(/\|/g, "/")} | | |` : `| ${x.image} | ${x.detail} | ${x.tokens} | ${x.usd.toFixed(7)} | ${x.ms} |`)),
    "",
    `Latency at low detail: sequential p50 ${report.latency.seqP50} ms, p95 ${report.latency.seqP95} ms (n=${seq.length}); parallel p50 ${report.latency.parP50} ms, p95 ${report.latency.parP95} ms (n=${par.length}).`,
    "",
    multiQ ? `Six predicates on one image (low): ${multiQ.tokens} input tokens, ${multiQ.ms} ms, answers ${JSON.stringify(multiQ.answers)}.` : "Six-predicate packing: not measured.",
    multiImg ? `Eight images in one request (low): ${multiImg.tokens} input tokens, ${multiImg.ms} ms.` : "Eight-image packing: not measured.",
    "",
    perShotLow !== null ? `Projected cost: smoke set (6 shots, low) $${(6 * perShotLow).toFixed(5)}; full set (24 shots, low) $${(24 * perShotLow).toFixed(5)}${highFull ? `; full set at high $${(24 * highFull.tokens * USD_PER_INPUT_TOKEN).toFixed(5)}` : ""}.` : "Projected cost: unknown (no successful low-detail call).",
    "",
    ...notes.map((n) => `Note: ${n}`),
    "",
  ].join("\n");
  writeFileSync(ROOT + "docs/visionqa-calibration.md", md);

  out.line(`calls ok: ${rows.filter((x) => !x.error).length + seq.length + par.length}, spend $${report.probeSpendUsd}`);
  if (lowFull) out.line(`1280x720 low: ${lowFull.tokens} tok, ${lowFull.ms} ms; high: ${highFull ? highFull.tokens + " tok" : "n/a"}`);
  out.line(`latency seq p50/p95 ${report.latency.seqP50}/${report.latency.seqP95} ms, par p50/p95 ${report.latency.parP50}/${report.latency.parP95} ms`);
  if (firstError) out.line(`first error: ${firstError.slice(0, 160)}`);
  out.line(`provider now: ${ok ? "decisions" : "off"} (tools/visionqa/state.json), doc: docs/visionqa-calibration.md`);
  return out.finish("PASS", ok ? "" : "(provider stays off; probe failure never blocks the build)");
}

export async function visionCmd(out, cmd, args) {
  if (cmd === "visionqa-probe") return probe(out);
  if (provider() === "off") return out.finish("SKIP", "VisionQA provider is off");
  if (!existsSync(ROOT + "reports/latest/shots.json")) return out.finish("SKIP", "no shots.json yet (shot sets land at M2)");
  const { runChecks } = await import("./run.mjs").catch(() => ({ runChecks: null }));
  if (!runChecks) return out.finish("SKIP", "check catalog lands at M2");
  return runChecks(out, args);
}

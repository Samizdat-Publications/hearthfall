// VisionQA providers: OpenAI Decisions API via raw fetch (no SDK), and the no-op "off" provider.
// Never sends anything but game screenshots and short game-state text. Never logs the key.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ROOT } from "../guards/lib.mjs";

const URL_DECISIONS = "https://api.openai.com/v1/decisions";
const MODEL = "gpt-6-luna";
export const USD_PER_INPUT_TOKEN = 0.1 / 1e6;
const LEDGER_DIR = ROOT + "reports/visionqa/";
const LEDGER = LEDGER_DIR + "ledger.jsonl";
const STATE = ROOT + "tools/visionqa/state.json";

const Answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("predicate"), name: z.string().nullish(), probability: z.number() }),
  z.object({ type: z.literal("choice"), name: z.string().nullish(), choice: z.union([z.string(), z.boolean()]), probabilities: z.array(z.object({ value: z.union([z.string(), z.boolean()]), probability: z.number() })), confidence: z.number() }),
  z.object({ type: z.literal("score"), name: z.string().nullish(), score: z.number(), probabilities: z.array(z.object({ value: z.number(), probability: z.number() }).loose()), confidence: z.number() }),
  z.object({ type: z.literal("refusal"), name: z.string().nullish() }),
]);
export const DecisionResponse = z.object({
  model: z.string(),
  answers: z.array(Answer),
  usage: z.object({ input_tokens: z.number() }).loose(),
}).loose();

/** Effective provider: an explicit non-off env value wins; otherwise the probe's recorded verdict. */
export function provider() {
  const env = (process.env.VISIONQA_PROVIDER ?? "").trim();
  if (env && env !== "off") return env === "disabled" ? "off" : env;
  try {
    const st = JSON.parse(readFileSync(STATE, "utf8"));
    return st.probeOk ? st.provider : "off";
  } catch {
    return "off";
  }
}

export function spend() {
  let total = 0;
  let today = 0;
  const day = new Date().toISOString().slice(0, 10);
  try {
    for (const l of readFileSync(LEDGER, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const e = JSON.parse(l);
      total += e.usd ?? 0;
      if (String(e.ts).startsWith(day)) today += e.usd ?? 0;
    }
  } catch {
    /* no ledger yet */
  }
  return { total, today };
}

export function budgetOk(extraUsd = 0) {
  const s = spend();
  const daily = Number(process.env.VISIONQA_DAILY_USD ?? 1);
  const total = Number(process.env.VISIONQA_TOTAL_USD ?? 8);
  return s.today + extraUsd <= daily && s.total + extraUsd <= total;
}

export function pngDataUrl(buf) {
  return "data:image/png;base64," + Buffer.from(buf).toString("base64");
}

/**
 * One Decisions request. images: Buffer[] (PNG); questions: API question objects.
 * Returns {ok, answers, inputTokens, usd, ms, status, headers, error}.
 */
export async function ask({ images = [], text = "Screenshot from a stylized low-poly god game in development.", questions, detail = "low", check = "adhoc", timeoutMs = 20000 }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, error: "OPENAI_API_KEY missing" };
  if (!budgetOk()) return { ok: false, error: "visionqa budget cap reached" };
  const body = {
    model: MODEL,
    input: [{ role: "user", content: [{ type: "input_text", text }, ...images.map((b) => ({ type: "input_image", image_url: pngDataUrl(b), detail }))] }],
    questions,
  };
  let last = { ok: false, error: "not sent" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(URL_DECISIONS, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Date.now() - t0;
      const headers = Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith("x-ratelimit") || k === "openai-processing-ms"));
      const raw = await res.text();
      if (!res.ok) {
        last = { ok: false, status: res.status, ms, headers, error: raw.slice(0, 300) };
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return last;
      }
      const parsed = DecisionResponse.safeParse(JSON.parse(raw));
      if (!parsed.success) return { ok: false, status: res.status, ms, error: "schema mismatch: " + parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ") };
      const inputTokens = parsed.data.usage.input_tokens;
      const usd = inputTokens * USD_PER_INPUT_TOKEN;
      mkdirSync(LEDGER_DIR, { recursive: true });
      appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), check, provider: "decisions", detail, images: images.length, questions: questions.length, input_tokens: inputTokens, usd, ms }) + "\n");
      return { ok: true, answers: parsed.data.answers, inputTokens, usd, ms, status: res.status, headers };
    } catch (e) {
      last = { ok: false, ms: Date.now() - t0, error: String(e.message ?? e).slice(0, 200) };
    }
  }
  return last;
}

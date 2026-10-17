// Gemini review of the showcase clips (landing page media, not QA).
//   node --env-file-if-exists=.env tools/showcase/review.mjs site/media/village.mp4 [...]
// Sends each clip inline to Gemini and asks for a short verdict as JSON; writes reports/showcase/review.json.
// Prints only the verdicts, never the key.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ROOT } from "../harness/lib.mjs";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.log("RESULT: SKIP (GEMINI_API_KEY missing)");
  process.exit(0);
}
const MODEL = process.env.GEMINI_REVIEW_MODEL ?? "gemini-2.5-flash";
const PROMPT = `You review a short muted gameplay clip for the public landing page of "Hearthfall", a 3D god game (a low poly tribe on a small curved planet, a caster called the Shaper, spells that reshape land).
Answer as JSON: {"ok": boolean, "score": 1-10, "shows": "one sentence of what the clip shows", "problems": ["visible defects: black or blank frames, stutter, broken UI, cut-off text, glitches, a camera that shows nothing interesting"], "caption": "a 6 to 12 word marketing caption, no dashes"}.
ok is false only for a defect that would embarrass a public page.`;

const out = [];
for (const f of process.argv.slice(2)) {
  const data = readFileSync(ROOT + f).toString("base64");
  const body = { contents: [{ parts: [{ inline_data: { mime_type: "video/mp4", data } }, { text: PROMPT }] }], generationConfig: { responseMimeType: "application/json" } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
  const j = await r.json();
  let v;
  try {
    v = JSON.parse(j.candidates[0].content.parts.map((p) => p.text ?? "").join(""));
  } catch {
    v = { ok: false, error: `HTTP ${r.status} ${JSON.stringify(j.error ?? {}).slice(0, 160)}` };
  }
  out.push({ file: f, ...v });
  console.log(`${f}: ok ${v.ok} score ${v.score ?? "-"} | ${v.shows ?? v.error} | problems: ${(v.problems ?? []).join("; ") || "none"}`);
}
mkdirSync(ROOT + "reports/showcase", { recursive: true });
writeFileSync(ROOT + "reports/showcase/review.json", JSON.stringify(out, null, 2));
console.log(`RESULT: ${out.every((v) => v.ok) ? "PASS" : "FLAG"} ${out.filter((v) => v.ok).length}/${out.length} clips ok`);

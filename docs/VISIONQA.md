# VisionQA: OpenAI Decisions API module (optional, switchable)

Verified facts and sources: `docs/research/decisions_api.md` (checked 10/08/2026). This module is a cheap second opinion on screenshots and an optional source of playtest variety. It is **never** the core bot and **never** required for QA to pass. With no key or `VISIONQA_PROVIDER=off`, every call is a no-op that returns `skipped`.

## 1. What the API is (verified)

- `POST https://api.openai.com/v1/decisions`, `Authorization: Bearer $OPENAI_API_KEY`, model `gpt-6-luna` (only accepted value). Public beta since 10/06/2026.
- Request: `model`, `input` (string, or user messages with `input_text` and `input_image` parts), `questions[]`.
- Images: base64 data URLs only, up to 128 per request, `detail`: low, high, auto, original.
- Question types: `predicate` (returns probability 0 to 1), `choice` (2 to 255 options, returns choice, per-option probabilities, confidence), `score` (ordered levels, returns fractional weighted index and confidence). Any answer can be `refusal`; handle it.
- Response: `{model, answers[] (same order as questions), usage{input_tokens, ...}}`. No response id, no logprobs.
- Price: $0.10 per 1M input tokens, output free on this endpoint. Build tier ($5+ purchased) limits listed as 5,000 RPM, 2M TPM for Luna; Decisions-specific limits undocumented.
- Not verified: image token cost for gpt-6-luna (estimated ~1,100 tokens for 1280x720 at high, ~170 at low, i.e. about $0.0001 per screenshot), real latency (plan 150 to 400 ms), what `confidence` means, max questions per request.

## 2. Package layout (`tools/visionqa`)

```
tools/visionqa/
  src/provider.ts        interface VisionJudge { ask(images, questions, opts) -> Answers }
  src/decisions.ts       raw fetch implementation (no SDK dependency, avoids SDK churn); zod-validated response
  src/responses.ts       fallback: Responses API on gpt-6-luna with strict json_schema enums (no probabilities)
  src/off.ts             no-op provider
  src/ledger.ts          append-only reports/visionqa/ledger.jsonl {ts, check, provider, detail, input_tokens, usd, ms}
  src/budget.ts          hard caps: VISIONQA_DAILY_USD (default 1.00), VISIONQA_TOTAL_USD (default 8.00 of the 10.00)
  checks/*.json          check catalog (data, see section 4)
  probe.ts               cost and latency probe (section 3)
  calibrate.ts           threshold calibration from synthetic labeled shots (section 5)
```

As built (M0): the module is plain ESM in `tools/visionqa/` (`decisions.mjs` provider, ledger and budget; `cli.mjs` probe and check runner) rather than the `.ts` layout above. The ledger lives at `reports/visionqa/ledger.jsonl` (machine local). Provider precedence: a `VISIONQA_PROVIDER` value other than `off` wins (`disabled` forces it off); with `off` or unset, the verdict the probe wrote to `tools/visionqa/state.json` decides. Measured costs: `docs/visionqa-calibration.md`.

Config in `.env`: `VISIONQA_PROVIDER=decisions|responses|off` (default `off` until the probe has run successfully), `VISIONQA_DETAIL=low`, budget caps. Retries: 2 with backoff on 429 and 5xx, then `skipped` with reason. A provider error never fails QA by itself; it marks the check `unavailable`.

## 3. First task: measure the real per-screenshot cost (`npm run visionqa:probe`)

1. Capture one 1280x720 smoke shot and one 512x512 crop with the harness.
2. Send each at `detail` low, auto, high, original with one trivial predicate. Log `usage.input_tokens` and latency per call.
3. Send 20 sequential low-detail calls and 10 parallel ones; record p50/p95 latency and any `x-ratelimit-*` headers.
4. Send one request with 6 predicates on one image to confirm multi-question packing, and one with 8 images to confirm multi-image token scaling.
5. Write `docs/visionqa-calibration.md` with a table: detail level, image size, input tokens, USD per call, latency, plus projected cost of one smoke set and one full set. Compute USD from tokens with the verified $0.10 per 1M rate. Total probe spend must stay under $0.05.
6. If the endpoint is unreachable or the schema differs from the research file, switch the default provider to `off`, note it in PROGRESS, and continue the build. Do not spend more than 20 minutes on it.

## 4. Check catalog (data driven)

Each check: `{id, appliesTo: [shot ids or tags], questions: [...], passRule, threshold, detail}`. Pack all questions for one image into one request.

| Check id | Question type | Passes when |
|---|---|---|
| `not_blank` | predicate "Is this frame essentially blank, black, white or a single flat color?" | P below threshold |
| `terrain_visible` | predicate "Is a landscape with land and water clearly visible?" | P above threshold (world shots) |
| `units_visible` | predicate "Are many small figures (people) visible on the land?" | P above threshold (populated shots) |
| `ui_overlap` | predicate "Do any interface panels or texts overlap, clip, or run off screen?" | P below threshold (HUD shots), secondary to DOM checks |
| `scene_kind` | choice world_view, map_view, menu, loading, error_or_blank, other | matches the shot's expected kind |
| `spell_visible` | predicate per spell shot, e.g. "Is there a large fiery cone or lava?" | P above threshold |
| `visual_quality` | score levels broken, rough, acceptable, polished | trend tracked per milestone, never gates |
| `artifact_suspect` | predicate "Are there obvious rendering glitches: stretched polygons, holes, flickering seams, missing textures (bright magenta), z-fighting stripes?" | P below threshold |

Choice-order bias guard: for `scene_kind`, if confidence is below threshold, ask again with the option order reversed; disagreement marks the check `uncertain`, which flags the shot for Claude.

## 5. Calibration with synthetic negatives (`npm run visionqa:calibrate`)

The debug API can break rendering on purpose: `setDebug({hideTerrain, blackCanvas, magentaMaterials, overlapHud, hideUnits, freezeCamera})`. The harness captures each preset in good and broken variants to build a labeled set (about 60 images), runs every check, and picks per-check thresholds that maximize accuracy, stored in `tools/visionqa/checks/thresholds.json` with the measured accuracy. Checks below 85 percent accuracy are set to `advisory` (logged, never flag). Re-run calibration when the art style changes noticeably. Expected cost: well under $0.05. As built (BACKLOG 43): 30 images (overview, globe, islands, map, close and coast presets, each good, no terrain, black, magenta and HUD overlap). `fitChecks` in `tools/visionqa/run.mjs` splits each check's rows in two stratified halves (sorted by label then id, alternating), fits the threshold on one half and scores it on the held-out half; a check is trusted only when both reach 85 percent (`fitAccuracy`, `holdoutAccuracy` in thresholds.json). Per-image answers go to `reports/latest/visionqa-calibration.json`. The first held-out run showed the blank and terrain checks reading the HUD minimap (land in a black frame), so both now tell the model to judge only the large game view; after that every predicate check held out at 93 percent or better.

## 6. How results flow

`npm run visionqa -- --set smoke` reads `reports/latest/shots.json`, runs applicable checks, writes `reports/latest/visionqa.json` with per-shot answers, and prints a summary. A shot is **flagged for Claude** only if a calibrated check fails, the answer is `uncertain` or `refusal`, or VisionQA disagrees with the code checks. Unflagged shots are never looked at by Claude. After looking at a flagged shot and finding nothing wrong, `npm run visionqa -- --reviewed <shot id> --reason "..."` records it in `tools/visionqa/reviewed.json` keyed by the PNG's sha256, so the same image is no longer flagged (a changed image is judged again); a real defect gets fixed instead.

## 7. Optional: playtest variety move picker

Purpose: make soak runs less predictable than scripted bots, cheaply. Off by default (`VISIONQA_MOVES=off`).

- Every 30 game seconds, a `decisions` external controller sends a compact text summary of the bot tribe's situation (from `getSummary()`, under 1,500 characters) and optionally a minimap PNG at low detail, with one `choice` question over **predefined macro moves**: expand_economy, build_defense, train_wardens, train_firecallers, train_chanters, claim_nearest_shrine, raid_weakest_neighbor, defend_hearth, terrain_attack_enemy_base, bridge_to_new_land, hold.
- The deterministic bot executes the chosen macro (the model never issues raw unit commands). Chosen moves are recorded as external Commands, so the match replays deterministically afterward.
- Cost guard: a 30-minute match is 60 calls, roughly a cent or less. Disabled automatically when the daily budget is hit.
- Value check before adopting widely: compare soak metrics (strategy diversity, stalemate rate) with and without the picker over 16 seeds. Keep it only if diversity improves.

## 8. Rules

- Never send anything but game screenshots and game state text to the API. No source code, no keys, no personal paths.
- Never let VisionQA be the only evidence that a feature works; the code checks and state JSON come first.
- The ledger is the source of truth for spend; `npm run visionqa:spend` prints totals.

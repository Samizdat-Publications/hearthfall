# OpenAI Decisions API: verified integration notes

Research date: 10/08/2026. Method: read OpenAI's own docs pages (guide, API reference, changelog, model page, pricing, rate limits, data controls, images guide), inspected the published Python SDK wheel (openai 3.26.1) by reading its source without running it, checked PyPI and npm release metadata, and cross-read third-party coverage for anything OpenAI does not state.

Legend used below:
- VERIFIED = read directly on an OpenAI-owned page or in the official SDK package on 10/08/2026.
- SECONDARY = reported by third parties, not confirmed on an OpenAI page.
- ASSUMED = my inference; must be confirmed by a runtime probe.

---

## 0. Bottom line

The Decisions API is real, documented, and callable today, but a few things in the request ("~0.1s latency", image token cost, Decisions-specific rate limits) are not documented the way the summary implies. Details below.

| Claim in the brief | Status |
| --- | --- |
| Called "Decisions API", public beta, launched 10/06/2026 | VERIFIED (changelog entry dated Oct 6; guide says public beta) |
| Model "GPT-6 Luna" | VERIFIED. Model ID is `gpt-6-luna`, the only model the endpoint accepts |
| About $0.10 per 1M input tokens | VERIFIED. Output tokens, cache reads, and cache writes are not charged on this endpoint |
| About 0.1 second latency | NOT VERIFIED as an absolute number. OpenAI only says "about 10x faster than the Responses API". A DevDay slide figure of 150 ms is SECONDARY. Early user measurements are 160 ms to 350 ms typical (anecdotal) |
| Returns choices / yes-no / scores from predefined options | PARTLY. Three question types: `predicate` (a probability that a statement is true, not a hard yes/no), `choice` (one of your supplied values, string or boolean), `score` (probability-weighted position on ordered levels). Predicate has no predefined options |
| Accepts base64 screenshots | VERIFIED. Base64 data URLs are the only image input |

---

## 1. Existence, name, dates, status

- Official name: Decisions API. Docs nav lists it under Core concepts next to the Responses API. (VERIFIED)
- Launch: changelog entry dated Oct 6, 2026, tagged `gpt-6-luna` and `v1/decisions`, described as released in beta. (VERIFIED)
- Corroboration of the date: the Python SDK 3.26.0 was uploaded to PyPI on 10/06/2026 at 21:31 UTC and the Node SDK 7.30.0 on 10/06/2026 at 21:59 UTC. (VERIFIED from registry metadata)
- Status: public beta. The guide says OpenAI expects GA "in the coming weeks". No GA date, no SLA. (VERIFIED wording, no date exists)
- Earlier limited preview at DevDay 2026, with a spokesperson saying details would follow at broad rollout. (SECONDARY)
- Model: `gpt-6-luna` is the only value accepted for `model`. The model catalog describes GPT-6 Luna as OpenAI's most efficient model for focused, high-volume tasks; 1.05M context window, text and image input, knowledge cutoff May 18, 2026. (VERIFIED)
- Third-party reports describe the endpoint as a constrained mode of Luna that outputs answers from a finite set. OpenAI's pages do not describe the internals. (SECONDARY)
- A Playground for the endpoint exists at platform.openai.com/decisions (login required, not opened). (VERIFIED link, content not inspected)

Documentation inconsistencies found on 10/08/2026 (worth knowing before trusting any one page):
1. The `gpt-6-luna` model page endpoint list does not include `v1/decisions`, even though the changelog tags that endpoint with this model and the data-controls page lists `gpt-6-luna` as the supported model for `/v1/decisions`. A news site flagged the same omission on 10/06.
2. The images guide sizing table and the image cost calculator list `gpt-5.6-luna` but not `gpt-6-luna`. So the image token profile for the Decisions model is not stated anywhere I could find.
3. The main pricing page has no Decisions row. The $0.10 rate is stated only in the guide.
4. The guide says to give each question a unique `name`; the API schema marks `name` optional and the response `name` nullable.

---

## 2. Endpoint and request schema

- URL: `POST https://api.openai.com/v1/decisions` (VERIFIED). Regional hosts such as `eu.api.openai.com` and `us.api.openai.com` are listed for data residency. For the EU host, the data-controls table says Modified Abuse Monitoring or Zero Data Retention is required. (VERIFIED)
- Auth: standard bearer token header, `Authorization: Bearer $OPENAI_API_KEY`, plus `Content-Type: application/json`. (VERIFIED)
- Streaming: none documented. Response is a single JSON object.

### Top-level request fields (VERIFIED from API reference and SDK types)

| Field | Required | Notes |
| --- | --- | --- |
| `model` | yes | Must be `gpt-6-luna` |
| `input` | yes | Either a plain string, or an array of user messages. Each message has `role: "user"`, optional `type: "message"`, and `content` as a string or an ordered array of parts |
| `questions` | yes | Array of question objects. Answers come back in the same order |
| `safety_identifier` | no | Opaque end-user id string, max 128 chars |

Content parts: `{"type":"input_text","text":...}` (text up to 10,485,760 characters per part in the schema) and `{"type":"input_image","image_url":"data:image/...;base64,...","detail":...}`.

Not allowed: non-user roles, function calls, function call outputs, files, audio, item references, tools. All questions in one request share the same `input`.

### How options and labels are defined

Every question has `type`, `instructions` (required string), and an optional `name`.

| Type | Extra fields | Use for |
| --- | --- | --- |
| `predicate` | none | Yes/no style check. Returns P(true) |
| `choice` | `choices`: 2 to 255 unique items, each `{value, description?}`. `value` can be a string or a boolean (a string "true" and boolean true are distinct) | Single-label classification. Boolean values give you a native yes/no choice |
| `score` | `levels`: ordered array of `{label, description?}`, lowest to highest. Indices start at 0 | Ordinal rating, for example severity 0 to 2 |

Multi-label: there is no multi-select type. The documented pattern is to put several independent questions in one `questions` array (for example one `predicate` per label). Dependent decisions need a second request.

Other documented guidance: include a fallback option such as `other` in a choice list; write questions around observable criteria; keep concerns in separate questions; make adjacent score levels clearly different. (VERIFIED)

### Images

- Format: inline base64 data URL only. Hosted http(s) URLs and `file_id` are rejected by design. (VERIFIED)
- Max images: 128 image parts across all messages in one request. (VERIFIED, API reference and SDK docstring)
- `detail`: optional, one of `low`, `high`, `auto`, `original`, or null. Default `auto`. Resolution is governed by "the selected model's image profile", which is not tabulated for `gpt-6-luna`. (VERIFIED field, profile ASSUMED)
- File types: the Decisions pages do not list them. The general vision guide lists PNG, JPEG, WEBP, and non-animated GIF, with up to 512 MB total payload and a 30,000-patch per-image rejection limit. A community plugin README reportedly accepts the same four types for Decisions. (general guide VERIFIED, Decisions-specific ASSUMED)
- The schema allows an `image_url` string up to about 1 GiB; that is a schema cap, not a practical limit.
- Data-controls note: all image inputs are scanned for CSAM, and a flagged image is retained for manual review even under ZDR. (VERIFIED)

### Batch

- No batch mode for Decisions is documented. Batching happens by packing many questions on one input (up to an undocumented cap) or by parallel requests.
- The Batch API and Flex (50 percent rates) are documented for ordinary `gpt-6-luna` requests, but the guide says the Decisions rate applies to `/v1/decisions` and other Luna requests follow normal tier pricing. Whether `/v1/decisions` can be queued through `/v1/batches` is NOT documented. (UNVERIFIED)
- Max questions per request: not documented. Max score levels: not documented in the pages I read. (UNVERIFIED)

---

## 3. Response schema

Top level (VERIFIED from API reference and SDK model definitions):

```
{
  "model": "gpt-6-luna",
  "answers": [ ... ],      // same order as questions
  "usage": {
    "input_tokens": int,
    "input_tokens_details": { "cached_tokens": int, "cache_write_tokens": int },
    "output_tokens": int,
    "output_tokens_details": { "reasoning_tokens": int },
    "total_tokens": int
  }
}
```

There is no response `id` field in the documented schema. Each answer is a tagged union on `type`:

| `type` | Fields | Notes |
| --- | --- | --- |
| `predicate` | `name`, `probability` | Float 0 to 1 |
| `choice` | `name`, `choice`, `probabilities[]`, `confidence` | `choice` is one of your supplied values. `probabilities` is a list of `{value, probability}` covering every option. `confidence` is a float |
| `score` | `name`, `score`, `probabilities[]`, `confidence` | `score` is the probability-weighted mean of level indices, so range is 0 to (levels minus 1) and can be fractional. Each probability entry has `value` (int index), `label`, `probability` |
| `refusal` | `name` (nullable) | The model declined that one question. Other questions in the same request still get answers. Your code must handle this branch |

Documented worked example: score probabilities 0.1, 0.7, 0.2 over three levels give score 1.1 and confidence 0.55. A choice example shows top probability 0.95 with confidence 0.93. So `confidence` is not simply the max probability, and OpenAI does not define how it is computed. Treat it as an opaque calibrated-ish number and set thresholds empirically with your own labeled examples, which is exactly what the guide recommends. (VERIFIED example, semantics UNDOCUMENTED)

No logprobs, no token-level data, no reasoning summary.

---

## 4. Pricing, image token accounting, rate limits

### Price (VERIFIED)

- Input: $0.10 per 1M tokens on `/v1/decisions`.
- Output, cache reads, cache writes: no charge on this endpoint.
- Surcharges that still apply: regional processing adds 10 percent (models released after March 5, 2026); prompts above 272K input tokens double the input rate for the whole request.
- No per-request fee is documented. No free tier: the `gpt-6-luna` rate-limit table shows "Free: Not supported".
- For comparison, ordinary `gpt-6-luna` on Responses or Chat Completions: $0.10 input, $0.01 cached input, $0.125 cache write, $0.50 output per 1M; Batch and Flex at 50 percent; Fast mode at 2x. (VERIFIED, pricing page and model page)

### Image tokens (the gap)

OpenAI's images guide defines a patch-based scheme for current vision models: 32 by 32 pixel patches, a 1.2x multiplier applied once to the patch count, `low` fits within 512 by 512, `high` caps at 2,048 pixels per side and 2,500 patches, `original` and `auto` keep native size for the `gpt-5.6-luna` row. The formula reproduces OpenAI's own worked examples exactly (1,229, 3,000 and 2,458 tokens), which I confirmed with a script. But `gpt-6-luna` is not in that table, so applying it to Decisions is ASSUMED.

Estimates under the assumed profile, image tokens only, at $0.10 per 1M:

| Image size | detail | Patches | Tokens | Cost per image | Images per $1 |
| --- | --- | --- | --- | --- | --- |
| 512 x 512 | any | 256 | 308 | $0.0000308 | about 32,000 |
| 1280 x 720 | low | 144 (resized to 512 x 288) | 173 | $0.0000173 | about 57,800 |
| 1280 x 720 | high / auto / original | 920 | 1,104 | $0.0001104 | about 9,000 |
| 1920 x 1080 | high / auto / original | 2,040 | 2,448 | $0.000245 | about 4,100 |

Add the instruction and choice-description text (roughly 150 to 400 tokens for a few questions) on top. A $10 prepaid balance buys on the order of 75,000 calls with one 1280 x 720 screenshot plus about 200 text tokens each (before the 10 percent regional premium). One early user reported a short curl call using 310 input tokens (SECONDARY), so measure rather than trust the arithmetic.

How to resolve the gap with certainty: the response always returns `usage.input_tokens`. Send one 1280 x 720 PNG at each `detail` value and log the numbers. That costs a fraction of a cent.

### Rate limits and tier for a new $10 prepaid account

- Tier names changed on 10/06/2026: five tiers collapsed into three paid tiers, Build, Launch, Grow, plus Free. "Tier 1" no longer exists as a label. (VERIFIED, changelog and rate-limits guide)
- Build qualifies at $5 in total credit purchases, so a $10 prepaid account lands in Build. Upgrades are automatic as purchases reach thresholds; I could not confirm how fast the upgrade registers after a payment. (VERIFIED thresholds)
- Build-tier limits for Luna-class models: 5,000 requests per minute and 2,000,000 tokens per minute (model page and rate-limits guide agree). Batch queue limit 20,000,000. Image tokens count toward TPM. (VERIFIED for `gpt-6-luna`)
- Decisions-specific limits: NOT documented. It is unconfirmed whether `/v1/decisions` shares the `gpt-6-luna` bucket or has its own. Check Settings > Organization > Limits in the dashboard, and read the `x-ratelimit-*` headers on real responses. (UNVERIFIED)
- At about 1,300 tokens per call, the 2,000,000 TPM figure would allow roughly 1,500 calls per minute if the bucket is shared, so TPM binds before RPM.
- Ramp guidance from OpenAI: once traffic passes about 1M TPM, grow it by no more than about 50 percent per 15 minutes or expect `429 slow_down`. 503 `server_is_overloaded` is a separate transient case. Follow `Retry-After`. (VERIFIED)
- Spend limits: configurable hard limit returns 429 once reached. Monthly usage limit for Build is $500. (VERIFIED)

### Latency

- Official: "about 10x faster than the Responses API". No absolute numbers, no conditions. (VERIFIED wording)
- DevDay slide reportedly showed 150 ms for Decisions versus 1.6 s for plain Luna. (SECONDARY, test conditions unknown)
- Early user measurements on launch day: p50 about 346 ms and p95 about 860 ms via a router (sample under 600 calls); another user saw 160 to 175 ms typical with p95 about 285 ms. (SECONDARY, anecdotal)
- Plan for 150 to 400 ms per call including network, not 100 ms, until you measure from your own host with a real screenshot payload. Base64 upload time of a 1 to 2 MB image adds to wall clock and is not part of any vendor number.

---

## 5. SDK support and a minimal example

Official SDK support (VERIFIED from the guide, registry data, and the 3.26.1 wheel source):

| Language | Minimum version | Registry state on 10/08/2026 | Method |
| --- | --- | --- | --- |
| Python | 3.26.0 | latest 3.26.1 | `client.decisions.create(...)` |
| JavaScript / Node | 7.30.0 | latest 7.30.1 | `client.decisions.create({...})` |
| Go | 3.73.0 | not checked | `client.Decisions.New(ctx, params)` |
| Ruby | 0.101.0 | not checked | `client.decisions.create(...)` |
| Java | 4.78.0 | not checked | `client.decisions().create(params)` |

Python specifics seen in source: keyword-only `create(input=, model=, questions=, safety_identifier=)`, plus `extra_headers`, `extra_query`, `extra_body`, `timeout`; also `with_raw_response` and `with_streaming_response` helpers and an async twin. Returned object is a typed `Decision` whose `answers` items are a discriminated union on `type`. Note the Python SDK in this version imports an `httpx2` package, so pin and test it in a clean virtual environment before relying on it in the build.

### My own minimal example (Python, game-screenshot flavored)

```python
import base64
from openai import OpenAI

client = OpenAI()  # picks up OPENAI_API_KEY from the environment


def ask_about_frame(png: bytes, detail: str = "auto") -> dict:
    """Send one screenshot with three question types; return plain Python values."""
    url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    resp = client.decisions.create(
        model="gpt-6-luna",
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Screenshot from a god-game build."},
                {"type": "input_image", "image_url": url, "detail": detail},
            ],
        }],
        questions=[
            {"type": "predicate", "name": "ui_overlapping",
             "instructions": "Do any UI panels visibly overlap or clip each other?"},
            {"type": "choice", "name": "scene",
             "instructions": "Which scene is shown?",
             "choices": [
                 {"value": "world_view", "description": "Terrain with followers visible."},
                 {"value": "menu", "description": "A menu or dialog fills most of the frame."},
                 {"value": "other", "description": "Anything else, including blank frames."},
             ]},
            {"type": "score", "name": "visual_clutter",
             "instructions": "How cluttered is the frame?",
             "levels": [
                 {"label": "clean", "description": "Few elements, clear focus."},
                 {"label": "busy", "description": "Many elements but readable."},
                 {"label": "chaotic", "description": "Hard to tell what is on screen."},
             ]},
        ],
        timeout=20.0,
    )
    out = {"_input_tokens": resp.usage.input_tokens}
    for a in resp.answers:
        if a.type == "refusal":
            out[a.name] = None
        elif a.type == "predicate":
            out[a.name] = a.probability
        elif a.type == "choice":
            out[a.name] = (a.choice, a.confidence)
        else:  # score
            out[a.name] = (a.score, a.confidence)
    return out
```

---

## 6. Limitations, accuracy caveats, data retention

Limitations (VERIFIED unless noted):
- Beta: OpenAI says limits and pricing can change before GA. Single model alias, no dated snapshot visible, so silent model updates are possible. (alias point SECONDARY)
- Output is constrained to answer shapes you define. It does not write free text or tool arguments. For arbitrary JSON use Structured Outputs on the Responses API; for tool calls use function calling.
- No images by URL or file id, no non-user roles, no tools, no audio, no streaming.
- Refusals are possible per question; code must handle them.
- Undocumented: question count cap, score level cap, image byte cap specific to Decisions, Decisions-specific rate limits, image token profile for this model, batch eligibility, determinism.
- The vision guide's general caveats apply: weak at precise spatial localization, small text, rotated content, unusual shapes; not for medical imaging.

Accuracy caveats (SECONDARY, small and early):
- A hiring-site relevance test reportedly found the OpenAI endpoint about 5 to 10 percent less accurate than a competitor (TypeSafe Jev) at about twice the cost. A forum tester reported roughly three times as many confident wrong answers on nuanced judgment calls, with narrow yes/no checks about even. Predicate probabilities reportedly tracked expectations better than choice probabilities, and choice results shifted with option order.
- One user reported lower and sometimes under-threshold confidence on ambiguous UI-component tasks, and four failed calls out of a few hundred during launch week.
- No independent, matched-panel benchmark was found. Treat everything above as anecdote and run your own labeled set. Randomize or test option order for choice questions.

Data handling (VERIFIED, data-controls page):
- Not used for training by default.
- Abuse-monitoring logs retained up to 30 days by default.
- Zero Data Retention available for eligible customers; HIPAA use allowed under an executed OpenAI Business Associate and Healthcare Addendum. Private Retention with PSP is listed as "pending confirmation".
- Prompt caching may hold encrypted key/value tensors on GPU-local storage for up to 24 hours.
- Images are CSAM-scanned and flagged ones are retained even under ZDR.
- Regional processing in the US and Europe (EEA plus Switzerland); availability in other regions does not guarantee in-region inference.

---

## 7. If you want to be careful: integration approach

Even though the contract is documented, it is a days-old beta with several doc gaps, so:

1. Put an adapter in front of it. One interface, for example `judge(image_png, questions) -> list[Answer]`, with a `refusal` variant and a normalized answer shape (probability or index plus per-option probabilities plus raw usage). Backends: `DecisionsBackend` (`/v1/decisions`), `ResponsesEnumBackend` (fallback below), and a fake backend for tests.
2. Probe at startup or in a one-time script, not by assumption:
   - Call `/v1/decisions` with a tiny text input. A 404 or 400 on the route or model means the account lacks access or the route moved; fall back automatically.
   - Send a 1280 x 720 PNG at `low`, `high`, `auto` and log `usage.input_tokens` to settle the real image profile.
   - Read `x-ratelimit-*` headers from a raw response (`with_raw_response`) to find the real Decisions limits.
   - Time 20 calls from the build host to get your own p50 and p95.
3. Log `usage` and wall-clock per call and keep a budget guard, since output is free but images dominate cost.
4. Handle `refusal`, 429 (`Retry-After`), and 503 explicitly; cap retries; keep SDK retries from stacking with your own.
5. Downscale screenshots before upload (for example to 1280 x 720 or smaller) unless the question needs fine text; keep the encoded payload small to cut upload latency.
6. Pin the SDK version and test in a clean virtual environment.

### Closest existing features (fallback)

Responses API with Structured Outputs on `gpt-6-luna`:
- Request shape: `text.format` with `type: "json_schema"`, a schema `name`, `strict: true`, and a `schema` object. A string field with an `enum` works in strict mode (enum appears in OpenAI's own examples); a boolean field covers yes/no; an integer field with enum covers scores. The Python helper `client.responses.parse(..., text_format=PydanticModel)` returns `output_parsed`. (VERIFIED from the Structured Outputs guide; whether that guide allows image input in the same request is not stated there, but `gpt-6-luna` accepts image input on Responses per the model page.)
- Set `reasoning.effort` to `none` for the lowest latency; the model page lists `none` as supported on Luna. (VERIFIED)
- Price: $0.10 input, $0.50 output, $0.01 cached input per 1M; Batch and Flex half price ($0.05 / $0.25). Output for a one-field JSON answer is only a handful of tokens, so cost per call stays within a small multiple of the Decisions price; image tokens are the same order. (VERIFIED prices; per-call estimate is mine)
- Trade-offs versus Decisions: you lose the built-in per-option probabilities and confidence (unverified whether Luna exposes logprobs on Responses, I did not check), and latency is higher (OpenAI's own claim is that Decisions is about 10x faster).
- Cheapest alternatives on the docs site: `gpt-5.6-luna` is $0.20 input and $1.20 output, so `gpt-6-luna` is the cheaper current vision model; `gpt-5.4-nano` and older nano models are listed as deprecated.

---

## 8. Open questions to settle with one probe session

1. Real `input_tokens` for a 1280 x 720 and a 512 x 512 screenshot at each `detail` value.
2. Decisions rate-limit bucket and headers on a Build-tier account.
3. Observed p50 and p95 latency from the build host, with and without downscaling.
4. Max questions and max levels per request (try 8, 16, 32 predicates).
5. Whether `/v1/batches` accepts `/v1/decisions` items.
6. Stability of choice probabilities under option reordering on your own labeled screenshots.

---

## Sources

OpenAI-owned (primary):
- https://developers.openai.com/api/docs/guides/decisions
- https://developers.openai.com/api/reference/resources/decisions
- https://developers.openai.com/api/reference/resources/decisions/methods/create
- https://developers.openai.com/api/docs/changelog
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/models/all
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/rate-limits
- https://developers.openai.com/api/docs/guides/images-vision
- https://developers.openai.com/api/docs/guides/image-cost-calculator
- https://developers.openai.com/api/docs/guides/your-data
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://pypi.org/pypi/openai/json (release metadata; wheel openai-3.26.1 source inspected)
- https://registry.npmjs.org/openai (release metadata)

Third-party (secondary, used only where marked SECONDARY):
- https://www.unite.ai/openai-releases-decisions-api-in-public-beta-powered-by-gpt-6-luna/
- https://smartscope.blog/en/blog/openai-decisions-api-use-pricing-public-beta-october-2026/
- https://mixed-news.com/en/openai-decisions-api-beta-gpt-6-luna-endpoint-table/
- https://www.stackone.com/blog/openai-decisions-api/
- https://www.firecrawl.dev/blog/openai-decisions-api-vs-jev
- https://thenewstack.io/openai-decision-api-luna/
- https://www.orcarouter.ai/blog/openai-decisions-api-gpt-6-luna
- https://explainx.ai/blog/openai-decisions-api-developer-verdict-vs-jev-2026

# Asset API Research: Automated Pipeline for a Stylized Low-Poly 3D God Game

Research date: 2026-10-08. Every service below was checked against its live docs or pricing page on this date. Items tagged [UNVERIFIED] are inferred, come from third-party pages, or were not retrievable from the vendor. All dollar figures are USD list prices.

Target driver: an autonomous coding agent (Claude Code) on Windows 11 with Python and Node, calling REST APIs and a headless Blender.

---

## 0. Decision summary

| Asset class | Primary path | Cost per asset (list) | Notes |
|---|---|---|---|
| Villagers, rigged and animated | Gemini concept image -> Meshy image-to-3D (Smart Topology, `meshy-t2`, textured) -> Meshy rig -> Meshy animations -> Blender palette pass | about 30 credits = $0.45 to $0.60 | Challenger: Tripo P-series or H-series with `smart_low_poly`, then Tripo rig and retarget. Run a small bake-off first. |
| Huts, towers, totems | Gemini concept -> Meshy image-to-3D `meshy-t2` (5 credits untextured, 15 textured) -> Blender palette pass | $0.08 to $0.30 | `meshy-t2` yields natively separated parts, which helps per-part palette assignment. |
| Trees, rocks | Meshy `meshy-t2` untextured (5 credits) or procedural Blender | $0.08 to $0.10 | A few AI variants plus procedural scatter keeps the look cohesive and cheap. |
| Spell VFX textures | Gemini `gemini-nano-banana-2.1`, 1K, black background for additive blending | $0.034 each (half price in Batch) | No alpha channel; use black-as-transparent or chroma-key. |
| Terrain textures | Gemini 2K plus scripted seam repair, or fully procedural | $0.050 each | No native tileable mode documented. |
| Building and unit icons | Blender thumbnail renders of the final GLBs | free | Guarantees the icon matches the 3D art. |
| Spell and resource icons | Gemini 1K with style references, downscale and key out background | $0.034 each | PixelLab only if the UI is deliberately pixel art ($0.007 to $0.02 per sprite). |
| Voice barks | ElevenLabs TTS (`eleven_v3` or `eleven_v4` for expression, Flash for cheap) with Voice Design for tribe voices | about $0.001 to $0.003 per short bark | |
| SFX | ElevenLabs `POST /v1/sound-generation` | about $0.002 per second of audio | 0.5 to 30 s per call, `loop` supported. |
| Music | ElevenLabs `POST /v1/music`, `model_id: music_v2_5`, `force_instrumental: true` | about $0.15 per minute | Pass the model explicitly; the API default is still `music_v1`. |

Biggest cost reality: per-asset costs are pennies. Real spend is subscription minimums (Meshy Pro, ElevenLabs paid plan for the Music API, Gemini billing) and retries. Budget the retries, not the first attempt.

Dates that will bite during the build (details in section 11):

| Date | Event |
|---|---|
| 2026-10-10 | Meshy `meshy-5` retires |
| 2026-10-12 | ElevenLabs v4 promotional pricing ends |
| 2026-10-23 | Tripo `chat_image_1` retires |
| 2026-10-30 | Meshy `model_type: lowpoly` retires (use `smart-topology` + `meshy-t2`) |
| 2026-11-01 | Tripo V2 API stops serving (use V3 only) |

---

## 1. Cross-service matrix

| | Meshy | Tripo | PixelLab | ElevenLabs | Gemini image |
|---|---|---|---|---|---|
| Base URL | `https://api.meshy.ai/openapi` | `https://openapi.tripo3d.com/v3` | `https://api.pixellab.ai/v2` | `https://api.elevenlabs.io` | `https://generativelanguage.googleapis.com/v1beta` |
| Auth | `Authorization: Bearer msy_...` | `Authorization: Bearer tsk_...` | `Authorization: Bearer <token>` | header `xi-api-key: <key>` | header `x-goog-api-key: <key>` |
| Pattern | async: create, poll or SSE or webhook | async: create, poll or webhook | mixed: some sync, most async via job id | sync: binary audio in the response | sync: base64 image in the response |
| Terminal states | `SUCCEEDED`, `FAILED`, `CANCELED` | `success`, `failed`, `cancelled`, `banned`, `expired` | `completed`, `failed` | HTTP 200 | HTTP 200 |
| Output retention | 3 days (non-Enterprise) | short-lived signed URLs, download at once | jobs cleaned up after completion, download at once | returned inline | returned inline |
| Rate or concurrency | 20 req/s; 10 queued tasks on Pro | per-key rate limit plus per-category concurrency (5 to 10 default) | 429 concurrent jobs, 529 rate limit; numbers unpublished | concurrency by plan (3 on Starter to 15 on Scale) | tiered RPM, TPM, IPM, visible in AI Studio |
| Billing unit | credits | credits ($0.01 each) | USD credits or subscription generations | characters, seconds, minutes | tokens per image |

API keys: all five support secret keys that must stay server side. Meshy and ElevenLabs keys can carry their own credit cap; set one before an unattended 24 hour run.

---

## 2. Meshy API

### 2.1 Auth and basics
- Base `https://api.meshy.ai/openapi/`. Header `Authorization: Bearer msy_<key>`. Keys are made at the Developer Platform keys page and shown once.
- A per-key monthly credit limit can be set at key creation. Use it as a hard stop for the autonomous run.
- The shared test-mode key was retired on 2026-09-16 and now returns 401. There is no free dry-run key; use the Playground for a real test.
- The API does not allow CORS; call from a server or script only.
- Timestamps are Unix epoch milliseconds.
- API access needs a paid plan (Pro and above). Free plan is web only.

### 2.2 Endpoints

| Purpose | Method and path |
|---|---|
| Text to 3D (preview and refine) | `POST /v2/text-to-3d`, `GET /v2/text-to-3d/{id}`, list, `/stream`, `DELETE` |
| Image to 3D | `POST /v1/image-to-3d` (+ `{id}`, `/stream`) |
| Multi-image to 3D | `POST /v1/multi-image-to-3d` |
| Retexture | `POST /v1/retexture` |
| Remesh (topology, polycount, format) | `POST /v1/remesh` |
| Convert format | `POST /v1/convert` |
| Resize (height, origin) | `POST /v1/resize` |
| UV unwrap | `POST /v1/uv-unwrap` |
| Rigging | `POST /v1/rigging` |
| Animation | `POST /v1/animations`, `GET /v1/animations/library` |
| Text to motion | documented but not in the OpenAPI spec (prime 10 credits, swift 3 credits) |
| Text to image, image to image | `POST /v1/text-to-image`, `POST /v1/image-to-image` |
| Balance | `GET /v1/balance` |

The legacy path `/v2/text-to-3d` without the `/openapi` prefix is deprecated; always use `/openapi/v2/...`.

### 2.3 Async pattern
1. `POST` returns `{"result": "<task_id>"}`.
2. Poll `GET .../{id}` until terminal; honor the `Retry-After` header (default 5 s), or use `/stream` (SSE) or a registered webhook.
3. Download from `model_urls.glb` (and `fbx`, `obj`, `usdz`, `stl`, `blend` on remesh; `3mf` only if requested). Omitted keys mean that format was not produced. Check the key exists before downloading.
4. Text to 3D is two stage: `mode: preview` (untextured mesh), then `mode: refine` with `preview_task_id` and optional `enable_pbr`, `texture_prompt` or `texture_image_url`, `texture_resolution` of 2k, 4k, 8k.
5. Rigging then animation: `POST /v1/rigging` with `input_task_id` (or `model_url`), then `POST /v1/animations` with `rig_task_id` and `action_id` or `action_ids` (up to 10, merged into one file with one clip per action).

### 2.4 Low-poly control (the important part for this game)

| Option | Setting | Range | Notes |
|---|---|---|---|
| Smart Topology | `model_type: "smart-topology"`, `ai_model: "meshy-t2"`, `target_polycount` | 100 to 15,000 (default 4,000) | Triangles only; `quad` is an error; `should_remesh` and `decimation_mode` are ignored; native part separation. Docs say about 2 seconds for T2. |
| Standard plus remesh | `should_remesh: true`, `target_polycount`, `topology` quad or triangle | 100 to 300,000 (default 30,000) | `decimation_mode` 1 to 4 overrides `target_polycount`. |
| Post remesh | `POST /v1/remesh` | 100 to 300,000 | 5 credits. Accepts glb, gltf, obj, fbx, stl input. |
| Legacy `lowpoly` | `model_type: "lowpoly"` | n/a | Retires 2026-10-30. Do not build on it. |

Model names: `meshy-7.1` (alias `latest`), `meshy-6`, `meshy-6-lite`, `meshy-t2` (Smart Topology). `meshy-7` is deprecated, `meshy-5` retires 2026-10-10. `geometry_resolution` of `2k` or `4k` adds 5 credits on 7.1. `pose_mode` can force `a-pose` or `t-pose`, useful for characters you will rig.

### 2.5 Rigging and animation limits
- Humanoid, bipedal, textured models only; documented as working well only for standard humanoids.
- `input_task_id` models above 300,000 faces are rejected; remesh first.
- With `model_url`, the character must face +Z or pose estimation fails with 422.
- Rig output: rigged GLB and FBX, plus basic walking and running clips bundled. Animation output: `animation_glb_url`, `animation_fbx_url`, optional processed USDZ, armature FBX, fps-changed FBX (24, 25, 30, 60).
- Animation library is browsable free at `GET /v1/animations/library`; action ids are not contiguous.

### 2.6 Output formats
GLB (embedded textures), FBX, OBJ plus MTL, USDZ, STL, 3MF, and BLEND on remesh. PBR maps (`base_color`, `metallic`, `roughness`, `normal`, sometimes `emission`) are exposed under `texture_urls` when `enable_pbr` is true.

### 2.7 Time
- Smart Topology T2: about 2 s per Meshy docs (third-party marketing says about 10 s image to mesh).
- Meshy 6 and 7 class models: about 1 minute for geometry; a third party measured 30 to 90 s end to end.
- Refine, rig, animation: not published [UNVERIFIED]; plan on 1 to 3 minutes each and poll.

### 2.8 Cost (credits per request)

| Operation | Credits |
|---|---|
| Text to 3D preview, `meshy-7.1` or `meshy-6` | 20 |
| Text to 3D preview, `meshy-6-lite` or `meshy-t2` | 5 |
| Text to 3D refine (2K or 4K / 8K) | 10 / 15 |
| Image to 3D, mesh only (7.1 / 6 / 6-lite / t2) | 20 / 20 / 5 / 5 |
| Image to 3D with 2K textures (7.1 / 6 / 6-lite / t2) | 30 / 30 / 15 / 15 |
| Image to 3D with 4K or 8K textures (7.1) | 30 / 35 |
| Ultra geometry surcharge (7.1 only) | +5 |
| Retexture (2K or 4K / 8K) | 10 / 15 |
| Remesh | 5 |
| Convert, Resize | 1 each |
| UV unwrap | 5 |
| Auto-rig | 5 |
| Animation | 3 per action (up to 10 per request) |
| Text to image: nano-banana / nano-banana-2 / nano-banana-pro / GPT Image | 3 / 6 / 9 / 9 |

Credit to dollars: Meshy's own docs do not show a price per credit. A third-party page lists Pro at $20 per month for 1,000 credits ($0.020 each) and Studio at $60 for 4,000 ($0.015 each) [UNVERIFIED; confirm in the billing page]. At those rates: 5 credits is $0.075 to $0.10; a textured `meshy-t2` asset (15) is $0.23 to $0.30; a rigged villager with four clips (15 + 5 + 12 = 32) is about $0.48 to $0.64.

Failed tasks report 0 credits and are refunded. `consumed_credits` is on every task object; record it.

### 2.9 Rate limits (per account, shared across keys)

| Tier | Requests per second | Queued tasks | Priority |
|---|---|---|---|
| Pro | 20 | 10 | default |
| Premium | 20 | 30 | higher |
| Ultra | 20 | 100 | highest |
| Studio | 20 | 20 | higher |
| Enterprise | 100 | 100 default, customizable | highest |

Queued tasks counted: text to 3D, image to 3D, text to texture, remesh. Two kinds of 429: request rate (has `Retry-After`) and queue full (`NoMorePendingTasks`, no `Retry-After`; `NoMoreConcurrentTasks` when credits are depleted). Responses carry `X-RateLimit-Limit`, `-Remaining`, `-Reset`.

### 2.10 Gotchas
- Assets are deleted after 3 days. Download immediately and verify.
- `DELETE` on an `IN_PROGRESS` task returns 409 and the task keeps running; only `PENDING` tasks cancel with a refund.
- If both `texture_prompt` and `texture_image_url` are sent, the prompt wins. In retexture, if both text and image style inputs are sent, the image wins.
- `texture_resolution` 4k and 8k need `meshy-6` or newer. `meshy-6-lite` is 2K only.
- Text-to-3D prompt cap is 800 characters.
- `should_remesh` defaults to false on Meshy 6 and 7 models, so you get a high face count unless you set it.
- Rigging needs a textured humanoid; untextured Smart Topology previews cannot be rigged directly.
- Meshy ships an MCP server (`@meshy-ai/meshy-mcp-server`); for a resumable pipeline prefer plain REST.
- Rate-limit table in `llms.txt` and the rate-limits page disagree on Enterprise queue size (50+ versus 100). Irrelevant unless you are Enterprise.

---

## 3. Tripo API

### 3.1 Auth and basics
- Base `https://openapi.tripo3d.com/v3`. Header `Authorization: Bearer <key>`; keys are `tsk_...`, shown once, created in the Tripo console (`platform.tripo3d.ai` for the global site).
- Unified response: `{"code":0,"data":{...}}`; errors have non-zero `code`, `message`, `suggestion`, `request_id`.
- V2 (`/v2/openapi/task`) is end of life: unmaintained from 2026-10-01, stops serving 2026-11-01. The official Python SDK (`tripo3d==0.4.2`) is still mostly V2, so call V3 with plain `requests` or use the JS, Go or Rust SDKs.

### 3.2 Endpoints

| Purpose | Method and path |
|---|---|
| Text, image, multiview to 3D | `POST /generation/text-to-model`, `/generation/image-to-model`, `/generation/multiview-to-model` |
| Image generation | `POST /generation/text-to-image`, `/image-to-image`, `/image-to-multiview`, `/edit-multiview` |
| Texture | `POST /models/texture` |
| Convert | `POST /models/convert` |
| Stylize | `POST /models/stylize` (styles lego, voxel, voronoi, minecraft per the ComfyUI node reference; no standalone doc page) |
| Retopology | `POST /mesh/decimate` |
| Segmentation, part completion | `POST /mesh/segment`, `/mesh/complete` |
| Rig check, rig, retarget | `POST /animations/rig-check`, `/animations/rig`, `/animations/retarget` |
| Task query, batch query | `GET /tasks/{task_id}`, `POST /tasks/list` |
| Upload | `POST /files` (multipart; images 20 MB, models 150 MB), `POST /files/presign` (large files, 30 minute URL) |
| Account | `GET /account/balance`, `GET /account/usage` |

### 3.3 Async pattern
1. `POST` returns `{"code":0,"data":{"task_id":"task_..."}}`.
2. Poll `GET /tasks/{task_id}` every 1 to 2 s, with a 5 minute timeout. Statuses: `queued`, `running`, `success`, `failed`, `banned` (content policy), `expired`, `cancelled`. Use `POST /tasks/list` to poll many at once.
3. On `success`, `output.model_url` (GLB for most tasks) and `output.rendered_image_url`. Download immediately: URLs are temporary signed links, and tasks later become `expired`. One fetch summary of the quick start said about 5 minutes; treat that as the working assumption [UNVERIFIED].
4. Webhooks exist (`task.completed`, `task.failed`, `balance.low`, HMAC-SHA256 signature).
5. Inputs use a single `input` field that accepts a `task_id`, a `file_token` or a public URL (auto-detected).

### 3.4 Models

| Series | Model ids as written in the reference pages | Notes |
|---|---|---|
| H (standard) | `v3.1-20260211` (latest), `v3.0-20250812`, `v2.5-20250123` | Face limit up to 1.5M tri (2M Ultra). `smart_low_poly: true` gives hand-crafted low-poly topology, 500 to 20,000 tri (10,000 quad). `quad`, `generate_parts`, `geometry_quality`, `auto_size`, `compress` need v3.0 or newer. |
| P (low poly) | `P1-20260311`, `P2-20260801` (preview, adds `quad`) | `face_limit` 50 to 20,000 on P1, 48 to 50,000 on P2 (25,000 quad). Best results start at 150 faces (simple) or 250 (complex). |

Texture options: `texture` and `pbr` both default to true (omitting them gives a textured, PBR result). `texture_quality`: `fast`, `standard`, `detailed`, `extreme` (8K). `texture_version`: `v3.5-20260815` (needed for `fast` and `delight`), `v3.0-20250812`, `v2.5-20250123`. Seeds: `model_seed`, `texture_seed`, `image_seed`.

Id inconsistency: the Models page and quick start use aliases like `tripo-v3.1` and `tripo-p1`, while the endpoint pages use the dated strings above. Pin the dated strings and smoke test them.

### 3.5 Rigging and animation
- `POST /animations/rig-check` is free. Run it first.
- `POST /animations/rig`: `model` `v1.0-20240301` is biped only with 90+ animation presets; `v2.5-20260210` adds quadruped, hexapod, octopod, avian, serpentine and aquatic rigs. `spec: "mixamo"` gives Mixamo bone names (handy for engine retargeting); `out_format` glb or fbx.
- `POST /animations/retarget`: single `animation` or a list in `animations`, with `bake_animation`, `animate_in_place`. Biped presets include idle, walk, run, jump, slash, hurt, fall, climb, turn, and (on rig v1) cheer, cast_a_spell, dig, sit and many more.
- Input to rig or retarget can be a prior `task_id`, a `file_token`, or a URL; formats GLB, GLTF, FBX, OBJ, STL; 150 MB max.

### 3.6 Output formats
Generation returns GLB. `POST /models/convert` exports GLTF, FBX, USDZ, OBJ, STL, 3MF with options: `face_limit`, `quad` (forces FBX), `flatten_bottom`, `texture_size` (default 4096), `texture_format`, `export_vertex_colors` (OBJ and GLTF only), `pivot_to_center_bottom`, `scale_factor`, `with_animation`, `bake`. Leave `export_orientation` unset during generation if you plan any post step; setting it can silently mis-orient later results while still reporting success.

### 3.7 Time
Quick start says 10 to 120 seconds for generation. A third party measured about 25 to 30 s on v2.5 and about 100 s on v3.0. P-series timing not published [UNVERIFIED].

### 3.8 Cost (credits; 1 credit = $0.01)

| Operation | Credits | Dollars |
|---|---|---|
| H series text to 3D, no texture / standard texture | 10 / 20 | $0.10 / $0.20 |
| H series image to 3D, no texture / standard texture | 20 / 30 | $0.20 / $0.30 |
| Multiview to 3D | 20 / 30 | $0.20 / $0.30 |
| Add-ons: HD texture +10, 8K texture +20, HD geometry +20, quad +5, smart low-poly +10, generate parts +20 | | |
| Texture task: fast 10, standard 10, HD 20, 8K 30 | | |
| Convert: basic 5, advanced 10 (any non-default option) | | |
| Retopology: v2.0 smart 30, v1.0 basic 10 | | $0.30 / $0.10 |
| Segmentation 40; part completion 50 (default) or 30 (quick) | | |
| Rig check | free | |
| Auto rig | 25 | $0.25 |
| Animation retarget | 10 per animation | $0.10 |
| Image generation (seedream, banana): 5 to 15 by model and size; GPT quality tiers 20 to 50 | | $0.05 to $0.50 |
| P2 (V3 changelog): 100 no texture; 110 / 120 / 130 for standard / detailed / extreme texture | | $1.00 to $1.30 |
| P1 (legacy V2 pricing page): text 30 / 40, image 40 / 50, plus texture quality +10 / +20 / +30 | | about $0.30 to $0.80 [UNVERIFIED] |

The live V3 pricing page has a P Series tab that did not render in the static fetch, so P1 and P2 prices should be confirmed by reading `credits_consumed` from the first few real tasks (`GET /account/usage` also lists them). Credits are frozen at task creation, deducted on success, and returned on failure or cancel. `credits_consumed` and `balance` are decimals with two places; never parse them as integers.

Consumer plan context (third party, [UNVERIFIED]): Free 200 credits, Pro $19.90 for 3,000, Max $89.90 for 25,000. API pricing is separate pay-as-you-go at $0.01 per credit.

### 3.9 Rate limits and concurrency
- Rate limit per API key, with `X-RateLimit-Limit/-Remaining/-Reset`; generation endpoints have lower limits than query endpoints; exceeded returns HTTP 429 code 1007.
- Concurrency per account and per category (separate pools):

| Category | Default |
|---|---|
| 3D generation, H series | 10 |
| 3D generation, P series | 5 |
| Image generation | 1 |
| Animation (rig, rig-check, retarget) | 10 |
| Model processing (texture, convert, refine) | 5 |
| Mesh operations (segment, complete, retopology) | 10 |

Full concurrency returns 429 with code 2000 and a `Retry-After` header. The error-code table labels 2000 as plain rate limit, so key your retry logic on HTTP 429 plus headers, not on the code alone.

### 3.10 Gotchas
- Image generation concurrency is 1 by default; do not rely on Tripo for bulk concept art. Use Gemini for that.
- `generate_parts` cannot combine with texture, pbr, quad or smart_low_poly (request rejected with code 1004 if texture is left at its default true).
- `quad=true` on P1 returns 400; quad needs P2 (or H series with v3.0+).
- Status `banned` means content policy; change the input, do not blindly retry.
- Model URLs expire; store files immediately.
- Python SDK is V2 era; V2 ends 2026-11-01.
- Doc ids for the same model differ between pages (see 3.4).
- Error code 2018 means the input model is too complex for rig, retopo or convert.

---

## 4. PixelLab API

### 4.1 Auth and basics
Base `https://api.pixellab.ai/v2`. Bearer token from the account page. OpenAPI spec at `/v2/openapi.json`, agent-friendly index at `/v2/llms.txt`. Official SDKs: `pip install pixellab`, a JS SDK, and an MCP server. Balance via `GET /balance` (USD credits and remaining subscription generations).

### 4.2 Endpoints that matter (99 paths exist; these are the useful ones)

| Need | Endpoint | Sizes | Sync or async |
|---|---|---|---|
| Fast pixel image | `POST /create-image-pixen` | 16 up to 512 px; multiple of 4; square if a side is under 32 | sync (image in response) |
| Pixflux / Bitforge | `POST /create-image-pixflux`, `/create-image-bitforge` | area up to 400x400 / 200x200; bitforge takes a style image | sync |
| Pro image | `POST /generate-image-v2`, `/generate-with-style-v2` | up to 512 px; returns a grid of variants (64 at 42 px or less, 16, 4, or 1 above 170 px) | async job |
| Image to pixel art | `POST /image-to-pixelart` | input up to 2048, output up to 512 | sync |
| Character, 8 directions | `POST /create-character-v3` | reference up to 256; from scratch 32 to 256 | async job |
| 4 or 8 directions (template) | `POST /create-character-with-4-directions`, `/with-8-directions` | about 48 to 64 px | async |
| 8 rotations of a sprite | `POST /generate-8-rotations-v3` | up to 256x256 | async job, 30 to 180 s |
| Single rotate | `POST /rotate` | up to 128 | sync |
| Objects | `POST /create-1-direction-object`, `/create-8-direction-object` | up to 168 | async |
| Animation | `POST /animate-with-text-v3` (up to 16 frames, 256 px), `/animate-with-skeleton-v3`, `/animate-character` | | async |
| Tilesets | `POST /create-tileset` (16 or 25 Wang tiles), `/create-tiles-pro` (hex, iso, square, oblique, building kits; 16 to 128 px, 32 recommended), `/create-isometric-tile` (16 to 64 px) | | async |
| UI | `POST /generate-ui-v2`, `/create-ui-asset` | up to 512 | async |
| Cleanup | `/remove-background`, `/unzoom`, `/reduce-colors`, `/resize`, `/correct-pixelart` | | sync |
| Jobs | `GET /background-jobs/{id}` (poll 5 to 10 s, 2 to 5 s for rotations), `DELETE` to cancel a queued job (not charged) | | |

### 4.3 Async pattern
POST returns `background_job_id` (plus an object, character or tileset id on some). Poll `GET /background-jobs/{id}` until `completed` or `failed`; results are in `last_response`. While processing, `queue_position` and `estimated_wait_seconds` show GPU wait. Jobs are cleaned up after completion, so download at once. Tilesets and objects also have their own GET-by-id endpoints.

### 4.4 Output
PNG images (base64 in the response or downloadable), spritesheet and ZIP exports for characters and objects, transparent backgrounds supported, optional forced palettes on several endpoints.

### 4.5 Cost (estimated USD, from the vendor API page)

| Operation | Price |
|---|---|
| Pixen image 32 / 64 / 128 / 256 / 512 px | $0.0070 / $0.0072 / $0.0079 / $0.0089 / $0.0169 |
| Pixflux 64 to 400 px | $0.0079 to $0.0132 |
| Image to pixel art 64 to 256 | $0.006 to $0.012 |
| Character v3 (8 dir) 64 / 128 / 168 | $0.041 / $0.042 / $0.045 |
| 8 rotations v3, 32 to 256 px | $0.029 to $0.038 |
| Animate with text v3, 4 to 16 frames | $0.013 to $0.042 |
| Tileset (16 or 32 px tiles) | $0.0079 / $0.0099 |
| Isometric tile 32 / 64 | $0.0156 / $0.0166 |
| Pro tools (image, UI, animation): up to 256 / 341 / 512 px | $0.095 / $0.125 / $0.185 |
| Pro Flash image | 5 generation units provisionally; query `GET /pro-flash/cost` |

### 4.6 Limits and gotchas
- Rate limits are not published. 429 means too many concurrent jobs; 529 means rate limit exceeded. Add backoff and a small worker pool (2).
- Run any user-supplied or upscaled pixel art through `/unzoom` before using it as a reference; the docs call this the top cause of poor results.
- Some endpoints are beta and tier gated (for example PixMiniMax needs Tier 1 or higher).
- Relevance to a stylized low-poly 3D game: indirect. Pixel art clashes with a smooth low-poly look unless the UI is intentionally retro. Reasonable uses: pixel-style minimap markers, a deliberate retro UI skin, sprite icons, or isometric and top-down tilesets if you add a 2D layer. Not a source of 3D textures. Pixel art at 64 px upscaled in 3D UI needs nearest-neighbor filtering.
- PixelLab has no seamless 3D texture mode; `create-tileset` gives Wang transition tiles for 2D maps only.

---

## 5. ElevenLabs API

### 5.1 Auth and basics
Header `xi-api-key: <key>`. Keys can be scoped to endpoints, given a credit quota, and IP allowlisted. Regional bases exist (`api.us.`, `api.eu.residency.`, `api.in.residency.`, `api.sg.residency.elevenlabs.io`). Official SDKs for Python (`pip install elevenlabs`) and Node. There is also an ElevenLabs MCP server and CLI. The Music API requires a paid plan.

### 5.2 Endpoints

| Need | Endpoint | Key parameters |
|---|---|---|
| Sound effects | `POST /v1/sound-generation` | `text`; `duration_seconds` 0.5 to 30 (omit to let it choose); `prompt_influence` 0 to 1 (default 0.3); `loop` boolean (v2 model only); `model_id` `eleven_text_to_sound_v2`; query `output_format` |
| Text to speech | `POST /v1/text-to-speech/{voice_id}` | `text`, `model_id`, `voice_settings` (stability, similarity_boost, style, speed), `seed`, `previous_text`/`next_text`, `language_code`, `apply_text_normalization`, query `output_format` |
| Music | `POST /v1/music` | `prompt` or `composition_plan` (not both); `music_length_ms` 3,000 to 600,000 in the reference (capability page says 5 minute max); `model_id` `music_v1` (API default during transition), `music_v2`, `music_v2_5`; `force_instrumental`; `seed` (plan mode only per the schema note); `finetune_id`; `store_for_inpainting`; `sign_with_c2pa` |
| Voice design | `POST /v1/text-to-voice/design` then create from preview | `voice_description`, sample `text`, `model_id` e.g. `eleven_multilingual_ttv_v2` |
| Models and voices | `GET /v1/models`, `GET /v1/voices` | |

TTS model ids: `eleven_v4` (most expressive, 10,000 character limit), `eleven_v4_turbo` (about 100 ms), `eleven_v3` (5,000 char limit, audio tags, multi-speaker), `eleven_multilingual_v2`, `eleven_flash_v2_5` (about 75 ms, 40,000 char limit, 50% lower per-character price).

### 5.3 Pattern
Synchronous: the HTTP response body is the audio file. No job polling. Write bytes to disk straight away and record the request headers (for music, the song id in the response headers is needed later for inpainting or reference chunks).

### 5.4 Output formats
`output_format` strings follow `codec_samplerate_bitrate`: `mp3_22050_32` through `mp3_44100_192`, `pcm_8000` through `pcm_48000`, `opus_48000_32` to `_192`, `ulaw_8000`, `alaw_8000`; TTS also lists `wav_*`; music adds `mp3_48000_128/192/240/320`. Plan gating: 192 kbps MP3 needs Creator or higher; 44.1 kHz PCM or WAV needs Pro or higher. Capability pages state SFX are MP3 for everything, plus 48 kHz WAV for non-looping effects, but the SFX reference enumerates only mp3, pcm, opus and law codecs; wrap PCM into WAV yourself if you need WAV on a lower plan [UNVERIFIED]. For game audio use Opus or OGG-Vorbis conversion with ffmpeg after download.

### 5.5 Cost
API pay-as-you-go list prices (the page also shows tiered subscriptions: Starter $6, Creator $22, Pro $99, Scale $299, Business $990 per month):

| Product | Price |
|---|---|
| TTS `eleven_v4` | $0.08 per 1K characters; promo $0.022 until 2026-10-12 |
| TTS `eleven_v4_turbo` | $0.04 per 1K; promo $0.011 until 2026-10-12 |
| TTS `eleven_v3`, `eleven_multilingual_v2` | $0.08 per 1K |
| TTS Flash or Turbo, v3 Conversational | $0.04 per 1K |
| Sound effects | $0.12 per minute of audio (docs also state 40 credits per second when a duration is set) |
| Music | $0.15 per minute (commercial-use licensing on Starter and above) |

Per-asset math: a 30 character bark on v4 is about $0.0024; on Flash about $0.0012. A 2 second SFX is about $0.004. A 3 minute music track is about $0.45. SFX cost does not depend on the prompt text, only duration and settings.

### 5.6 Limits

| Plan | Concurrency (Multilingual v2) | Concurrency (Flash) | Music concurrency |
|---|---|---|---|
| Free | 2 | 4 | 0 |
| Starter | 3 | 6 | 2 |
| Creator | 5 | 10 | 2 |
| Pro | 10 | 20 | 2 |
| Scale or Business | 15 | 30 | 5 |

Excess requests queue (about 50 ms extra) rather than fail; response headers `current-concurrent-requests` and `maximum-concurrent-requests` let you self-throttle.

### 5.7 Gotchas
- Music model default in the API is still `music_v1`; pass `music_v2_5` explicitly.
- No native seamless loop for music. For loops, crossfade the tail into the head in ffmpeg or Python, or compose with a plan that resolves to the opening chord.
- SFX `loop: true` works only on the v2 SFX model (the default); durations above 30 s are not possible in one call.
- `seed` on TTS and music is best-effort, not a reproducibility guarantee.
- Music is cleared for most commercial uses including games, but terms vary by plan; keep the plan and date in the manifest for licensing evidence.
- TTS `language_code` is ignored by `eleven_multilingual_v2`. For invented tribal gibberish, use v3 or v4 with audio tags and Voice Design; test for pronunciation drift.
- Only HTTPS bytes returned; no usage object. Compute cost from characters, seconds and minutes.

---

## 6. Gemini image generation

### 6.1 Current models (as of 2026-10-08)
Google's family is branded Nano Banana. Imagen is shut down (`imagen-4.0-*` ended 2026-08-17). Do not use Imagen ids.

| Model id | Name | Notes |
|---|---|---|
| `gemini-nano-banana-2.1` | Nano Banana 2.1 (released 2026-10-06) | Recommended default: Flash-class speed and price, 1K, 2K, 4K, search grounding, multi-turn consistency |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | 1K only; cheapest class; weaker with multiple references and multi-turn editing |
| `gemini-3.1-flash-image` | Nano Banana 2 | Adds 512 px; docs recommend 2.1 for new work |
| `gemini-3-pro-image` | Nano Banana Pro | Highest quality, 3 style reference slots, higher price |
| `gemini-2.5-flash-image` | original Nano Banana | Legacy. The deprecation table says shutdown March 15, 2027, while the pricing page says October 2, 2026. Do not use. |

### 6.2 Calling it
Docs now lead with the Interactions API:
- `POST https://generativelanguage.googleapis.com/v1beta/interactions` with header `x-goog-api-key`.
- Body: `model`, `input` (text, or an array mixing `{"type":"text"}` and `{"type":"image","mime_type":..., "data":<base64>}` parts), optional `response_format: {"type":"image","aspect_ratio":"1:1","image_size":"1K","mime_type":"image/png"}`, optional `previous_interaction_id` for multi-turn edits.
- Response: base64 image in the output (SDK convenience property `output_image`). Always PNG or JPEG bytes; no alpha.
- The older `generateContent` route is still referenced in the Imagen migration note (`client.models.generate_content`); smoke test both and pick the one that works with your SDK version.
- `image_size` must use an uppercase K (512px, 1K, 2K, 4K). Lowercase fails.
- Aspect ratios include 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9.
- Reference images: up to 14 total; on 2.1 and 3.1 Flash, up to 10 object references and 4 character references; on Pro, 6 objects, 5 characters and 3 style references; on Lite, up to 14 object references and no character slots.
- Thinking is on by default and cannot be turned off; interim thought images are not billed.

### 6.3 Pricing (paid tier; image output tokens)

| Model | 1K image | 2K image | 4K image | Batch |
|---|---|---|---|---|
| Nano Banana 2.1 | $0.0336 | $0.0504 | $0.113 | 50% off ($0.0168 1K) |
| Nano Banana 2 Lite | $0.0336 | n/a | n/a | $0.0168 |
| Nano Banana 2 | $0.067 (0.5K $0.045) | $0.101 | $0.151 | $0.034 1K |
| Nano Banana Pro | $0.134 | $0.134 | $0.24 | about half |

There is no free tier for image output. Input tokens are billed too (a few thousandths of a cent per reference image on Pro; more on Flash at $1.50 per million). Search grounding is extra after 5,000 free monthly queries.

### 6.4 Limits
Rate limits depend on usage tier (Tier 1 needs a linked billing account; Tier 2 after $100 paid plus 3 days; Tier 3 after $1,000 plus 30 days) and are shown per model in AI Studio. Image-specific limits are expressed as images per minute (IPM). A rolling 10 minute spend cap applies per tier ($10 on Tier 1, $50 on Tier 2, $200 on Tier 3). Treat 429 with exponential backoff.

### 6.5 Typical latency
Not published [UNVERIFIED]. Expect seconds for Flash-class 1K; budget up to tens of seconds for 4K or Pro.

### 6.6 Textures, icons, concept art
- Concept art for image-to-3D: very good. Ask for a single object, centered, neutral flat background, 3/4 front view, no text, soft even light, flat shading.
- Icons: good with a style reference and "no text, centered, transparent-style plain background" phrasing; then chroma-key. Gemini cannot output real transparency.
- VFX textures: generate on pure black, then use additive blending in-engine so black becomes transparent. Avoids keying entirely.
- Tileable textures: the docs do not document any seamless mode. Prompting for "seamless tileable" produces approximations. Reliable approach: generate, then scripted seam repair: roll the image by half width and height with numpy, ask the model (same interaction) to repaint only the visible cross-shaped seam, roll back, then verify with an edge-difference metric (mean absolute difference between opposite edges under a threshold). [UNVERIFIED technique; validate with 3 sample textures before scaling.] For a low-poly game, small palette-based tiling noise textures or fully procedural terrain colors are often better than AI photo-like tiles.
- All outputs carry a SynthID watermark (invisible); fine for game use but note it for content-policy reviews.
- Note the free-tier data-use clause: on the free tier Google may use inputs and outputs to improve products; on the paid tier it does not.

---

## 7. Blender command-line automation (Windows)

### 7.1 Versions in 2026
Releases: 4.5 LTS (2025-07), 5.0 (2025-11), 5.1 (2026-03), 5.2 LTS (2026-07-14, latest). Pin the pipeline to 5.2 LTS (or 4.5 LTS if you want the most battle-tested add-on ecosystem). Use a portable ZIP from blender.org pinned in a `tools\` folder rather than relying on the Store or winget so every machine runs the same binary.

Version notes that affect scripts:

| Version | Change | Impact |
|---|---|---|
| 5.0 | EEVEE engine id is `BLENDER_EEVEE` (was `BLENDER_EEVEE_NEXT` in 4.2 to 4.5) | Guard engine selection by checking the enum items. |
| 5.0 | `ImageFormatSettings.media_type` must be set before `file_format` | Set `media_type = 'IMAGE'` first when configuring output. |
| 5.0 | Dict-style access to `bpy.props`-defined runtime properties removed | Do not read add-on settings via `obj['cycles']`. |
| 5.0 | `scene.node_tree` removed; `scene.use_nodes` deprecated (always true); compositor reorganized (`scene.compositing_node_group`) | Avoid compositor scripting for thumbnails; render passes directly. |
| 5.0 | Render pass names changed (for example `Z` is now `Depth`) | Only matters if you parse passes. |
| 5.0 | USD export options renamed or removed; logging output format changed | Do not parse render stdout. |
| 5.1 | Bundled Python is 3.13 | Any bundled pip wheels must match 3.13. |
| 5.1 | `gpu.init()` added for `--background` | Useful if you do GPU work headless. |
| 5.2 | Geometry Nodes modifier inputs moved to RNA properties | Only matters if you drive modifiers by name. |
| 4.1 and later | `Mesh.shade_flat()` and `shade_smooth()` exist as methods | Prefer them over operators in background mode. |

Confirmed API names used below: `Mesh.shade_flat()`, `bpy.data.meshes.new_from_object`, `bpy.ops.export_scene.gltf` options listed in the 5.x reference.

### 7.2 CLI shape

```bat
cd /d C:\populous
"C:\tools\blender-5.2-windows-x64\blender.exe" --background --factory-startup -noaudio --python-exit-code 1 --python "C:\populous\art\blender\normalize_export.py" -- --in "C:\populous\art\raw\meshy\unit_villager_a\model.glb" --out "C:\populous\art\out\glb\unit_villager_a.glb" --spec "C:\populous\art\work\unit_villager_a\spec.json"
```

Key arguments (from the Blender manual): `--background` (no UI), `--factory-startup` (ignore the user's startup file and prefs for repeatability), `--python <file>`, `--python-expr`, `--python-exit-code <n>` (non-zero exit when the script raises, essential for pipelines), `-noaudio`, `--threads N`, `--addons a,b`, `--log "<match>"`, `--python-use-system-env` (only if you must import from PYTHONPATH). A newer `-c/--command` mode exists. Everything after a bare `--` is ignored by Blender and left in `sys.argv` for your script.

Windows specifics:
- Quote paths with spaces and avoid MAX_PATH (260 char) problems: keep the repo near the drive root and enable long paths if needed.
- Set `PYTHONUTF8=1` for the orchestrator, and launch Blender with `subprocess.run([...], check=True, timeout=300, capture_output=True)` with a list (no shell).
- Each Blender process uses one core for Python work; run 4 to 8 in parallel through a process pool, one asset per process.
- Remote desktop sessions can break GPU contexts. For thumbnails use the Workbench engine (no GPU shading dependency) and keep EEVEE for optional hero renders.

### 7.3 Operations in headless mode

| Task | Approach |
|---|---|
| Import | `bpy.ops.wm.read_factory_settings(use_empty=True)`, then `bpy.ops.import_scene.gltf(filepath=...)`. Blender converts glTF Y-up to Z-up on import. |
| Batch decimate | Add a `DECIMATE` modifier (`ratio` = target faces / current faces), then bake it with `bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))` and swap the mesh data. This avoids `bpy.ops.object.modifier_apply` context errors in background mode. Skip decimation on skinned meshes; request the face count from the API instead. |
| Normalize scale and pivot | Bake `matrix_world` into the mesh (`mesh.transform(obj.matrix_world)`; reset the matrix), compute the bounding box, scale uniformly to the class height, translate so the lowest point is at Z=0 and the footprint center at XY=0. Pivot at the base center is what god-game placement logic wants. |
| Apply palette materials | Sample the base color texture per face (UV centroid) into a palette snap, write a `CORNER` color attribute, replace materials with one shared Principled BSDF fed by a Color Attribute node (roughness 1, metallic 0). See section 9. |
| Flat shading | `mesh.shade_flat()` |
| Thumbnails | Workbench engine, `shading.light='STUDIO'`, `shading.color_type='VERTEX'` (or MATERIAL), orthographic camera at a fixed 3/4 angle, `film_transparent=True`, 256 or 512 px, `bpy.ops.render.render(write_still=True)`. |
| Export glTF | `bpy.ops.export_scene.gltf(filepath=..., export_format='GLB', use_selection=True, export_apply=False, export_yup=True, export_materials='EXPORT', export_vertex_color='MATERIAL', export_image_format='NONE', export_animations=<bool>, export_cameras=False, export_lights=False)` |

glTF exporter facts from the current API reference: `export_apply=True` bakes modifiers but disables shape-key export. `export_vertex_color` accepts `MATERIAL` (only if a material uses it), `ACTIVE`, `NAME`, `NONE`. `export_image_format` accepts `AUTO`, `JPEG`, `WEBP`, `NONE`. Mesh compression options: Draco, meshopt, and a gltfpack integration (KTX2, quantization, simplification). Use Draco or meshopt only if your engine's importer supports it; otherwise leave it off.

### 7.4 Script skeleton (normalize and export)

```python
# art/blender/normalize_export.py  (run with the CLI shown in 7.2)
import sys, json, argparse
import bpy
import numpy as np
from mathutils import Matrix

def args():
    a = sys.argv
    a = a[a.index("--") + 1:] if "--" in a else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--spec", required=True)
    return p.parse_args(a)

def bake_modifiers(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    bpy.data.meshes.remove(old)

def main():
    A = args()
    spec = json.load(open(A.spec, encoding="utf-8"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=A.inp)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert meshes, "no mesh imported"
    rigged = any(o.find_armature() for o in meshes)

    for obj in meshes:
        obj.data.transform(obj.matrix_world)       # bake transform into the mesh
        obj.matrix_world = Matrix.Identity(4)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if not rigged and tris > spec["tri_max"]:
            m = obj.modifiers.new("Decimate", "DECIMATE")
            m.ratio = spec["tri_max"] / tris
            bake_modifiers(obj)

    # uniform scale to class height, pivot at base center
    co = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in meshes])
    mn, mx = co.min(axis=0), co.max(axis=0)
    s = spec["height"] / max(mx[2] - mn[2], 1e-6)
    off = np.array([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]])
    for o in meshes:
        for v in o.data.vertices:
            v.co.x, v.co.y, v.co.z = ((np.array(v.co[:]) - off) * s)
        o.data.shade_flat()

    # (palette snap and color attribute write goes here, see section 9)

    for o in bpy.context.scene.objects: o.select_set(False)
    for o in meshes: o.select_set(True)
    if rigged:
        for o in bpy.context.scene.objects:
            if o.type == "ARMATURE": o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=A.out, export_format="GLB", use_selection=True,
        export_apply=False, export_yup=True, export_materials="EXPORT",
        export_vertex_color="MATERIAL", export_image_format="NONE",
        export_animations=rigged, export_cameras=False, export_lights=False)

main()
```

Caveats: scaling armature-driven meshes needs the armature scaled too (apply scale on both, or scale the armature object and apply). The loop above is fine for static props; handle rigged characters with a dedicated branch that scales the armature and applies transforms with `bpy.context.temp_override` around `bpy.ops.object.transform_apply`.

### 7.5 Thumbnail skeleton

```python
# art/blender/thumb.py
import sys, math, bpy
from mathutils import Vector

def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    glb, out = argv[0], argv[1]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 256
    sc.render.image_settings.media_type = "IMAGE"   # required before file_format in 5.x
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = out
    objs = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr, size = (lo + hi) / 2, max((hi - lo).length, 0.1)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type, cam.data.ortho_scale = "ORTHO", size * 1.1
    sc.collection.objects.link(cam); sc.camera = cam
    cam.location = ctr + Vector((size, -size, size * 0.8))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.render.render(write_still=True)

main()
```

---

## 8. Which service for which asset class

Why this split: the 3D vendors are strongest at turning a clean concept image into a mesh, Gemini is the strongest and cheapest source of consistent concept art (14 reference images, multi-turn editing), ElevenLabs is the only service here for audio, and Blender is the style enforcer. Keep every 3D asset image-first, not text-first; text-to-3D varies far more run to run.

| Asset class | Generate | Rig or animate | Normalize and style | Final |
|---|---|---|---|---|
| Villagers | Gemini concept (T-pose or A-pose, front 3/4) -> Meshy image-to-3D `meshy-t2`, `pose_mode: a-pose`, textured | Meshy rig + `action_ids` list (idle, walk, run, work) | Blender palette pass (no decimate on skinned mesh) | GLB with skeleton and clips |
| Villager alternative | Tripo P1 or H + `smart_low_poly` | Tripo `rig-check` (free) -> `rig` with `spec: mixamo` -> `retarget` | same | GLB |
| Huts and towers | Gemini concept -> Meshy `meshy-t2`, `target_polycount` 800 to 2,500 | none | palette pass, pivot at base | GLB |
| Totems | same as huts, add glow as emissive in-engine | optional idle bob in engine | palette pass | GLB |
| Trees and rocks | Meshy `meshy-t2` untextured, 150 to 600 tris, or procedural | none | palette pass, 3 to 5 variants each | GLB |
| Spell VFX | Gemini on black, 1K, additive | engine particles use the texture | Pillow: crop, resize 512 or 256, optional 4x4 flipbook | PNG |
| Terrain | procedural palette first; Gemini tiles only for accent layers | none | seam check script | PNG |
| Icons | Blender renders for units and buildings; Gemini for spells and resources | none | resize, key, pad | PNG |
| Barks | ElevenLabs TTS + Voice Design | none | trim silence, loudness normalize, convert to OGG | OGG |
| SFX | ElevenLabs sound-generation | none | trim, normalize | OGG |
| Music | ElevenLabs music instrumental | none | loop crossfade | OGG |

Recommended first action: a one-hour bake-off with three representative prompts (villager, hut, tree) on Meshy `meshy-t2` and Tripo P1 (and H + `smart_low_poly`), scored by the same automated QA (section 9.3). Record results in the manifest so the choice is evidence-based and revisitable.

---

## 9. Enforcing a consistent art style

### 9.1 Style bible as data
Create `art/style/style.json` and `palette.json`, versioned. Fields:
- Palette: 24 to 40 hex colors with named roles (skin tones, cloth, wood, stone, foliage, water, sky, magic, UI), plus allowed ramps.
- Shading rules: flat shaded, one shared material, no baked shadows or highlights, roughness 1, optional emissive for magic.
- Shape rules: chunky silhouettes, big hands and feet or similar exaggeration, bevel-like planes, no fine surface detail.
- Poly budgets per class (starting points): villager 800 to 1,500 tris; hut 300 to 1,000; tower 800 to 2,500; tree 150 to 600; rock 50 to 300; totem 200 to 800.
- Height bands per class in world units.
- A constant "style prompt block" appended to every Gemini prompt, and a constant negative list.
- `style_version` string. It goes into every request hash (section 10), so changing the bible intentionally invalidates old outputs.

### 9.2 Reference images and prompt discipline
- Generate 4 to 6 approved hero references in Gemini, accept them manually once, and store them in `art/style/refs/`. Pass 2 to 4 of them as references on every concept call (Nano Banana 2.1 allows 10 object and 4 character references; Pro offers 3 dedicated style slots).
- For asset families (all huts, all villagers), use `previous_interaction_id` to chain edits from one anchor image so proportions stay consistent.
- Fix camera language: same angle, same background, same light direction wording in every concept prompt.
- Feed the same reference as the texture guide: Meshy refine `texture_image_url` or retexture `image_style_url`; Tripo texture `style_image`.

### 9.3 Deterministic Blender post-process (the real enforcer)
1. Import GLB, drop all AI textures after sampling.
2. Per face: sample the base color at the UV centroid, convert to OKLab, snap to the nearest palette color, write that color to a `CORNER` color attribute (same value for the face corners).
3. Replace materials with one shared palette material fed by a Color Attribute node.
4. `shade_flat()`, merge by distance, normalize scale and pivot, enforce tri budget.
5. Export GLB without images, vertex colors included (`export_vertex_color='MATERIAL'`). Check that your engine's importer enables vertex-color albedo (Godot's glTF importer does this when COLOR_0 is present [UNVERIFIED; check in a smoke test]).
6. Optional: a palette atlas variant (a 32x1 palette texture with face UVs pointed at palette cells) if your engine prefers textures over vertex colors.

Automated QA gates written into the manifest per asset:
- tri count within budget; bounding box height within the class band; origin at base; no non-manifold edges; single material; 95% or more of face colors within a small OKLab distance of a palette color; exported GLB size under a cap.
- A cheap vision-model check of a Blender thumbnail contact sheet against the style references (score 0 to 1), with a threshold; failures retry with a new seed or prompt tweak up to N attempts, then park for human review.

### 9.4 Audio consistency
Use one designed voice per tribe or role (Voice Design, then saved voice id in the manifest), fix `voice_settings`, reuse `previous_text` hints for line batches, and normalize loudness to one target. For SFX, fix a prompt template (material, size, perspective, "dry, no reverb"). For music, keep a fixed style string and `force_instrumental`.

---

## 10. Manifest-driven, idempotent, resumable pipeline

### 10.1 Files

```
populous\art\
  style\            style.json, palette.json, refs\*.png
  manifest\         assets.json (source of truth), ledger.jsonl (append-only events), pricing.json
  raw\<provider>\<asset_id>\   immutable downloads
  work\<asset_id>\            intermediates (spec.json, blender logs)
  out\glb|png|ogg\            game-ready outputs (what the engine imports)
  blender\                    normalize_export.py, thumb.py
```

### 10.2 `assets.json` schema (one record per asset)

```json
{
  "schema_version": 1,
  "style_version": "2026-10-08.1",
  "budget": {"cap_usd": 120.0, "per_provider_usd": {"meshy": 50, "tripo": 30, "gemini": 15, "elevenlabs": 20, "pixellab": 5}},
  "assets": [
    {
      "id": "unit.villager.brave_a",
      "class": "character_rigged",
      "spec": {"tri_max": 1500, "height": 1.0},
      "status": "approved",
      "steps": [
        {
          "name": "concept",
          "provider": "gemini",
          "endpoint": "interactions",
          "model": "gemini-nano-banana-2.1",
          "prompt": "...",
          "params": {"aspect_ratio": "1:1", "image_size": "1K"},
          "refs": [{"path": "art/style/refs/hero_01.png", "sha256": "..."}],
          "req_hash": "<sha256 of canonical request + style_version + ref hashes>",
          "state": "approved",
          "remote_id": null,
          "attempts": 1,
          "outputs": [{"path": "raw/gemini/unit.villager.brave_a/concept.png", "sha256": "...", "bytes": 912334}],
          "cost": {"amount": 0.0336, "unit": "usd", "source": "computed"},
          "started_at": "2026-10-08T14:02:11Z",
          "finished_at": "2026-10-08T14:02:19Z",
          "error": null
        },
        {"name": "mesh", "provider": "meshy", "endpoint": "v1/image-to-3d", "depends_on": "concept", "remote_id": "0192...", "cost": {"amount": 15, "unit": "credits", "source": "consumed_credits"}},
        {"name": "rig", "provider": "meshy", "endpoint": "v1/rigging", "depends_on": "mesh"},
        {"name": "anim", "provider": "meshy", "endpoint": "v1/animations", "depends_on": "rig"},
        {"name": "blender", "provider": "local", "script": "normalize_export.py"},
        {"name": "qa", "provider": "local", "metrics": {"tris": 1432, "bbox_h": 1.0, "palette_cov": 0.97, "vision": 0.84}}
      ]
    }
  ]
}
```

### 10.3 Rules that make it idempotent and resumable
1. Step state machine: `planned -> submitting -> submitted -> running -> downloaded -> postprocessed -> validated -> approved`, with `rejected` (retry counter) and `failed` as exits.
2. Request hash: `sha256(canonical_json({provider, endpoint, model, params, prompt, ref_file_hashes, upstream_output_hashes, style_version}))`. If an `approved` step has the same hash and its output files exist with matching `sha256`, skip it. If the hash changed, mark downstream steps stale.
3. Persist the remote task id the moment a create call returns (atomic write: temp file then `os.replace`). On restart, a step in `submitted` or `running` with a `remote_id` is resumed by polling, never re-submitted.
4. No vendor here documents an idempotency key. So write state `submitting` with an attempt id before POST. On restart, a step stuck in `submitting` without a `remote_id` is reconciled: Meshy list endpoints sorted newest first, Tripo `POST /tasks/list`, then match by prompt and time; if nothing matches, accept a possible duplicate charge. Budget caps bound that loss.
5. Download at once and hash. Meshy purges after 3 days; Tripo links are short-lived; PixelLab cleans jobs. Raw files are write-once; later steps never modify them.
6. Cost ledger: after every task, append an event to `ledger.jsonl` (provider, asset, step, credits or units, USD estimate, timestamp). Sources: Meshy `consumed_credits`; Tripo `credits_consumed` (decimal); PixelLab usage object; Gemini token usage; ElevenLabs characters, seconds and minutes computed locally. A `pricing.json` table with a `verified_on` date drives pre-flight estimates. Refuse to submit if projected spend exceeds a per-asset, per-provider or global cap.
7. Concurrency: per-provider semaphores sized under the account limits (Meshy 5 of 10, Tripo 3 per category, ElevenLabs equals plan concurrency minus 1, PixelLab 2, Gemini 4). Retry 429 and 5xx with exponential backoff and jitter, honoring `Retry-After` and reset headers. Never retry `banned` or validation errors.
8. Dry-run mode prints the plan and estimated cost without calling any API. Run it before every large batch.
9. Seeds: store them (Tripo `model_seed`/`texture_seed`, ElevenLabs `seed`, PixelLab seed). Meshy and Gemini do not document seeds, so regeneration is not reproducible; idempotency there means "do not regenerate an approved result", not "get the same bytes".
10. Atomic writes plus a lock file prevent two agent sessions from corrupting `assets.json`. Keep `ledger.jsonl` append-only so a crash cannot lose spend history.
11. Failure budget: at most 3 attempts per step; after that mark `needs_review` and continue with other assets so a 24 hour unattended run never stalls on one bad prompt.

### 10.4 Small helper (hashing and atomic save)

```python
import hashlib, json, os, pathlib

def canon(o) -> str:
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def sha256_file(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def req_hash(step: dict, style_version: str, upstream: list[str], ref_hashes: list[str]) -> str:
    body = {k: step.get(k) for k in ("provider", "endpoint", "model", "params", "prompt")}
    body.update(style_version=style_version, upstream=upstream, refs=ref_hashes)
    return hashlib.sha256(canon(body).encode("utf-8")).hexdigest()

def save_atomic(path: pathlib.Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
```

---

## 11. Budget model and risk register

### 11.1 Illustrative first content set (list prices, with 3x retry allowance)

| Item | Count | Unit cost | With 3x retries |
|---|---|---|---|
| Rigged villagers, 4 clips each (Meshy 32 credits at $0.02) | 6 | $0.64 | $11.5 |
| Buildings and towers (Meshy 15 credits) | 10 | $0.30 | $9.0 |
| Totems and props | 8 | $0.30 | $7.2 |
| Trees and rocks (Meshy 5 credits) | 12 | $0.10 | $3.6 |
| Concept images (Gemini 1K, 3 per asset) | 100 | $0.034 | $3.4 |
| VFX and icon images (Gemini 1K) | 60 | $0.034 | $2.0 |
| Terrain tiles (Gemini 2K) | 8 | $0.050 | $1.2 |
| Barks (about 30 characters, v4) | 60 | $0.0024 | $0.4 |
| SFX (about 2 s) | 60 | $0.004 | $0.7 |
| Music (2 minutes) | 6 | $0.30 | $5.4 |
| **Total (excluding subscriptions)** | | | **about $45** |

Subscription minimums dominate: Meshy Pro ($20 per month, API requires a paid plan), an ElevenLabs paid tier for the Music API (Starter $6), Gemini billing enabled, Tripo and PixelLab top-ups.

### 11.2 Date-driven risks

| Risk | Date | Action |
|---|---|---|
| Meshy `meshy-5` retired | 2026-10-10 | Use `meshy-6-lite`, `meshy-t2` or 7.1. |
| ElevenLabs v4 promo ends | 2026-10-12 | Recompute TTS cost at $0.08 per 1K. |
| Tripo `chat_image_1` retired | 2026-10-23 | Not needed; use Gemini for images. |
| Meshy `lowpoly` retired | 2026-10-30 | Use Smart Topology T2. |
| Tripo V2 endpoints stop | 2026-11-01 | V3 only; avoid the V2-era Python SDK. |
| Gemini `gemini-2.5-flash-image` end date conflict (Oct 2026 versus Mar 2027) | unclear | Do not use. |
| Gemini 3.1 Flash preview ids | already shut down | Use stable ids only. |

### 11.3 Cross-service gotcha list
- Download immediately everywhere; do not store signed URLs as references.
- Never assume a format key exists in Meshy `model_urls`.
- Tripo P-series and H-series have different concurrency pools and different parameters; keep separate request builders.
- Tripo `texture` and `pbr` default to true; set them false explicitly for geometry-only runs (and for `generate_parts`).
- Meshy `should_remesh` defaults off on current models; target counts do nothing unless Smart Topology or `should_remesh` is set.
- Rigging needs textured humanoids, +Z facing when uploading a URL, and under 300,000 faces (Meshy).
- AI meshes often have no sensible pivot, wrong scale, flipped normals or doubled faces; the Blender pass must always normalize.
- Gemini returns no alpha; plan for black-background or chroma-key workflows.
- ElevenLabs music default model is `music_v1`; always pass `model_id`.
- Rate-limit semantics differ: Meshy has two kinds of 429; Tripo has per-category concurrency; PixelLab uses 429 and 529; ElevenLabs queues rather than fails.
- All API keys belong in environment variables or an untracked `.env`; never in the manifest. Use per-key caps (Meshy, ElevenLabs) for unattended runs.
- Licensing: keep plan tier and date per provider in the manifest. Meshy free plan output is CC BY 4.0 (attribution), paid plans own the output; ElevenLabs music commercial use depends on plan; check Gemini and Tripo terms for your tier before shipping.

---

## 12. Smoke-test checklist (run once before the autonomous build)

1. Balance calls: Meshy `GET /v1/balance`, Tripo `GET /v3/account/balance`, PixelLab `GET /v2/balance`, ElevenLabs `GET /v1/models`, Gemini one 1K image.
2. One Meshy `meshy-t2` image-to-3D (with a Gemini concept), download GLB, run Blender normalize and thumbnail; confirm credits match the table.
3. One Meshy rig plus two actions on a textured humanoid; import the GLB in the engine.
4. One Tripo P1 and one H + `smart_low_poly` task; record `credits_consumed` to settle the unverified P-series prices; try the dated model ids.
5. One Tripo rig-check, rig (`spec: mixamo`) and retarget.
6. One Gemini seamless texture attempt with the roll-and-repair routine; measure edge difference.
7. One ElevenLabs bark (v4), SFX with `loop: true`, and a 30 second `music_v2_5` instrumental; verify output formats on your plan.
8. Resume test: kill the orchestrator mid-poll and confirm it resumes without a duplicate submit.
9. Cap test: lower a cap to a tiny value and confirm the pipeline refuses to submit.

---

## Sources

- Meshy docs index and agent notes: https://docs.meshy.ai/llms.txt
- Meshy full docs corpus: https://docs.meshy.ai/llms-full.txt
- Meshy OpenAPI spec: https://docs.meshy.ai/openapi.yaml
- Meshy Text to 3D: https://docs.meshy.ai/en/api/text-to-3d
- Meshy Image to 3D: https://docs.meshy.ai/en/api/image-to-3d
- Meshy Remesh: https://docs.meshy.ai/en/api/remesh
- Meshy Retexture: https://docs.meshy.ai/en/api/retexture
- Meshy Rigging: https://docs.meshy.ai/en/api/rigging-and-animation
- Meshy Animation: https://docs.meshy.ai/en/api/animation
- Meshy API pricing: https://docs.meshy.ai/en/api/pricing
- Meshy rate limits: https://docs.meshy.ai/en/api/rate-limits
- Meshy asset retention: https://docs.meshy.ai/en/api/asset-retention
- Meshy plan pricing (third party, for per-credit estimate): https://stacksheriff.com/ai-tools/meshy-ai-pricing/?format=md
- Tripo API documentation corpus: https://developers.tripo3d.com/llms-full.txt
- Tripo docs index: https://developers.tripo3d.com/llms.txt
- Tripo introduction: https://developers.tripo3d.com/en/docs/introduction
- Tripo quick start: https://developers.tripo3d.com/en/docs/quick-start
- Tripo models and versions: https://developers.tripo3d.com/en/docs/models-and-versions
- Tripo rate limits and concurrency: https://developers.tripo3d.com/en/docs/rate-limits
- Tripo changelog: https://developers.tripo3d.com/en/docs/changelog
- Tripo API pricing page: https://developers.tripo3d.ai/en/pricing
- Tripo legacy P1 pricing and V2 sunset notice: https://docs.tripo3d.ai/get-started/pricing.html
- Tripo consumer plan prices (third party): https://www.costbench.com/software/ai-3d-generation/tripo-ai/
- Tripo Python SDK: https://github.com/VAST-AI-Research/tripo-python-sdk
- Third-party 3D API comparison (timing figures): https://www.3daistudio.com/blog/best-3d-model-generation-apis-2026
- PixelLab LLM index: https://api.pixellab.ai/v2/llms.txt
- PixelLab OpenAPI spec: https://api.pixellab.ai/v2/openapi.json
- PixelLab interactive docs: https://api.pixellab.ai/v2/docs
- PixelLab API and price estimates: https://www.pixellab.ai/pixellab-api
- PixelLab docs: https://www.pixellab.ai/docs/getting-started
- ElevenLabs docs index: https://elevenlabs.io/docs/llms.txt
- ElevenLabs sound generation API: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
- ElevenLabs sound effects overview: https://elevenlabs.io/docs/overview/capabilities/sound-effects
- ElevenLabs music API: https://elevenlabs.io/docs/api-reference/music/compose
- ElevenLabs music overview: https://elevenlabs.io/docs/overview/capabilities/music
- ElevenLabs text to speech API: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- ElevenLabs models, concurrency and character limits: https://elevenlabs.io/docs/overview/models
- ElevenLabs API authentication: https://elevenlabs.io/docs/api-reference/authentication
- ElevenLabs voice design guide: https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/voice-design
- ElevenLabs API pricing: https://elevenlabs.io/pricing/api
- Gemini image generation (Nano Banana): https://ai.google.dev/gemini-api/docs/image-generation
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Gemini Imagen shutdown and migration note: https://ai.google.dev/gemini-api/docs/imagen
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Blender releases: https://www.blender.org/download/releases/
- Blender 5.0 Python API release notes: https://developer.blender.org/docs/release_notes/5.0/python_api/
- Blender 5.1 Python API release notes: https://developer.blender.org/docs/release_notes/5.1/python_api/
- Blender 5.2 Python API release notes: https://developer.blender.org/docs/release_notes/5.2/python_api/
- Blender command line arguments: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
- Blender Python API, glTF export operator (bpy.ops.export_scene): https://docs.blender.org/api/current/bpy.ops.export_scene.html
- Blender Python API, Mesh type: https://docs.blender.org/api/current/bpy.types.Mesh.html
- Blender Python API, ImageFormatSettings: https://docs.blender.org/api/current/bpy.types.ImageFormatSettings.html

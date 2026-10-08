# Asset pipeline (living)

Verified endpoints, prices and gotchas: `docs/research/asset_apis.md` (checked 10/08/2026). Read the relevant section of that file before writing a provider client; do not rely on memory for these APIs.

## 0. Principles

1. **The game never waits for assets.** Procedural placeholder meshes, colors and synthesized beeps exist from M2 onward. Real assets replace placeholders by manifest id with automatic fallback.
2. **Manifest driven, idempotent, resumable.** Every asset is a row in `tools/assets/assets.json`; re-running the pipeline skips finished steps and resumes in-flight jobs by remote id.
3. **One art style, enforced by code.** Style bible + Blender normalization pass, not hope.
4. **Cheap workers run it.** The `asset-producer` subagent (Sonnet) drives batches; the main agent only reviews flagged thumbnails and contact sheets.
5. **Hard budgets.** Per-provider and total caps; the pipeline refuses to start a job that would exceed them.

## 1. Asset classes and routes

| Class | Route | Target |
|---|---|---|
| Concept and style references | Gemini `gemini-nano-banana-2.1` (Interactions API) | 6 hero reference images that define the look |
| Buildings, totems, shrines, reliquary, hearth | Gemini concept, then Meshy image-to-3D `ai_model: meshy-t2`, `model_type: smart-topology`, 800 to 3000 tris, then Blender pass | GLB, 1 shared palette material |
| Trees, rocks, props | Meshy `meshy-t2` untextured (cheap) for 3 to 5 variants each, or procedural in Blender | GLB, 100 to 800 tris |
| Units (Shaper, Settler, Warden, Firecaller, Chanter, wild people) | Bake-off first: Meshy vs Tripo v3 (`smart_low_poly`) on Settler and Warden; winner does all. **v1 units are static meshes in a relaxed standing pose** (prompt for it explicitly; never an A-pose or T-pose) | GLB, 600 to 2000 tris, not rigged |
| Unit runtime animation | v1: rigid "toy" animation (bob, lean, swing, tilt) on instanced static meshes. Rigging, animation clips and VAT baking are BACKLOG P1 item 5 | see BACKLOG |
| Spell VFX textures | Gemini 1K on black background (additive blending), keyed in Python | PNG/KTX2 |
| Terrain detail textures | Procedural first; Gemini 2K + scripted seam repair later | PNG |
| Icons (buildings, units) | Blender thumbnail renders of final GLBs, consistent framing | 128 and 256 px PNG |
| Icons (spells, resources) | Gemini 1K with the style refs, background keyed | 128 and 256 px PNG |
| SFX | ElevenLabs `POST /v1/sound-generation` (`eleven_text_to_sound_v2`) | OGG, normalized loudness |
| Voice barks (Shaper, troops) | ElevenLabs Voice Design once per voice, then TTS short invented-language chants and grunts | OGG |
| Music | ElevenLabs `POST /v1/music` with `model_id: music_v2_5` explicitly, `force_instrumental: true`; layered stems (calm, tension, battle) | OGG loops |
| Pixel art | PixelLab only if a pixel-art UI style is ever chosen | n/a |

Do not use: Meshy `meshy-5` (retires 10/10/2026), Meshy `model_type: lowpoly` (retires 10/30), Tripo V2 API (stops 11/01), Tripo `chat_image_1` (retires 10/23), Imagen (shut down).

## 2. Style bible (`data/base/style.json`, versioned)

- Palette: 24 to 32 colors in OKLab (earth, foliage, stone, wood, cloth, skin tones, 4 tribe colors, spell colors).
- Shading: flat or soft faceted, vertex colors only, one shared material per class (`world`, `unit`, `vfx`).
- Tribe color: units and banners carry a vertex color channel flagged `tribe` that the renderer tints per tribe (one mesh serves all tribes).
- Scale: 1 world unit = 1 heightmap cell. Settler height 0.9, Warden 1.0, Shaper 1.1, small dwelling footprint 2x2, lodge 3x3.
- Pivot at base center, +Y up, faces +Z.
- Triangle budgets per class (above). Texture budget: none for meshes (vertex colors), 1K for VFX.
- Prompt fragments: a shared style suffix (for example "stylized low-poly diorama, chunky shapes, warm earthy palette, clean silhouette, no text, plain background") and negative cues, stored in style.json so every provider uses the same words.
- `style_version` bumps when the look changes; it is part of every asset's request hash, so a bump marks dependent assets stale.

## 3. Manifest (`tools/assets/assets.json`)

Per asset: `id, class, prompt, refs[], provider, params, style_version, request_hash, steps{concept, model, rig, animate, post, thumb}` where each step has `status (pending|submitted|done|failed|needs_review|skipped), remote_id, started, finished, cost, output_path, sha256, attempts, error`. Plus `approved: bool` and `qa{tris, bounds, palette_delta, warnings}`.

Rules (from the research file section 10): save `remote_id` right after the POST; atomic writes (`os.replace`); append-only `tools/assets/ledger.jsonl` for every paid call; download and hash outputs immediately (Meshy deletes after 3 days, Tripo URLs expire); max 3 attempts per step then `needs_review`; per-provider semaphores matching rate limits; `--dry-run` prints what would be spent.

## 4. Pipeline commands (`tools/assets`, Python 3.11+)

| Command | Does |
|---|---|
| `python tools/assets/gen.py plan` | dry run: lists pending steps and projected cost per provider |
| `python tools/assets/gen.py run --class buildings --max-usd 5 --max-minutes 8` | submits, polls, downloads, records, respects caps; returns within 8 minutes and resumes in-flight jobs by remote_id on the next call |
| `python tools/assets/gen.py status` | one-line-per-class summary |
| `python tools/assets/blender_run.py normalize --in tools/assets/raw/x.glb --out assets/models/x.glb` (wraps `BLENDER_EXE --background --factory-startup -noaudio --python-exit-code 1 --python tools/assets/blender/normalize.py -- ...`) | decimate to budget, merge by distance, recalc normals, snap colors to palette into vertex colors (units snap to a restricted subset without water, snow, foliage or fire colors, so blue cloth lands on `azure` and not `water`), apply flat shading, set pivot and scale, export glTF with `export_vertex_color='ACTIVE'` (Blender 5.1.2 wrote all-white colors with `'MATERIAL'`, measured in A0) |
| `python tools/assets/blender_run.py thumbs --class buildings` | consistent 3/4 view thumbnails for icons and review sheets |
| `python tools/assets/qa.py` | tri counts, bounds vs class size, palette distance, non-manifold count, file size; writes qa into manifest; builds `reports/latest/assets_sheet.png` |
| `python tools/assets/audio_post.py` | trim silence, normalize loudness, convert to OGG |

Blender 5.x gotchas (from research): engine id `BLENDER_EEVEE`, set `media_type` before `file_format`, `scene.node_tree` removed, Python 3.13 inside Blender, `export_apply` disables shape keys.

## 5. Order of work (runs in parallel with the code roadmap)

1. **A0 (during M0):** pipeline skeleton, manifest schema, dry-run, ledger, budget caps, provider clients with a single cheap smoke call each (concept image, 5-credit Meshy untextured model, 1 s SFX). Record real costs in `docs/ASSETS.md` section 7.
2. **A1 (during M2 to M3):** style refs (6 Gemini images). Main agent views the 6 refs once as a contact sheet and picks the direction, writes the choice into style.json. Then 2 unit bake-off models per provider; main agent views one comparison sheet and picks. Every `gen.py run` call returns within 8 minutes; the subagent calls it repeatedly and never leaves a job running at turn end (remote jobs keep running server side and are resumed by id).
3. **A2 (during M4 to M6):** all buildings, props, trees, rocks; then static units in a relaxed standing pose.
4. **A3 (during M6 to M8):** SFX list (from sim event types), Shaper and troop barks, 3 music stems, spell VFX textures, icons.
5. **A4 (M10):** renderer swaps placeholders for assets; shot sets re-baselined after the contact sheet review.

Every concept reference, style pick, bake-off comparison and class contact sheet is also archived for the making-of story: `npm run making-of -- add <file> --milestone A1 --kind concept --caption "..."` (see `making-of/README.md`).

### Decisions so far
- Art direction (A1, 10/08/2026): concept.ref_04 crisp flat-shaded polygon, lit like ref_05 (warm golden hour); recorded in `data/base/style.json` `direction`.
- Unit route (A1 bake-off, 10/08/2026): Meshy image-to-3D (meshy-t2, smart-topology, textured, about 1400 tris, 15 credits) from a Gemini single-unit concept that uses ref_04 as a style reference. Chunkier, more readable silhouettes than text-to-3D and colors come from the texture. Text-to-3D (5 credits) stays the fallback. Tripo was not evaluated (no key).

## 6. Budgets (defaults in `.env`, change freely)

| Provider | Cap for the first 24 h |
|---|---|
| Meshy | $15 |
| Tripo | $5 (bake-off only unless it wins) |
| Gemini | $5 |
| ElevenLabs | $5 (needs a paid plan for the music endpoint; if music returns a plan error, skip music and log it) |
| PixelLab | $0 (not used in v1) |
| Total | $30 |

The pipeline stops a class when its cap is reached and logs the shortfall in PROGRESS; placeholders remain.

## 7. Measured costs (fill in during A0 and A1)

| Provider and call | Expected (research) | Measured | Date |
|---|---|---|---|
| Gemini 1K image | $0.034 | $0.0336 (1120 image output tokens; 1064 thought tokens also reported, billing of those unverified; route worked: `generateContent`, Interactions returned a 4xx) | 2026-10-08 |
| Meshy meshy-t2 smart-topology untextured | 5 credits | 5 credits (`consumed_credits` 5.0 and balance 1136 to 1131), text-to-3D preview, 322 tris, done in about 15 s; USD per credit not published, ledger assumes $0.02 | 2026-10-08 |
| Meshy meshy-t2 textured image-to-3D (`image_url` data URI, `should_texture: true`, smart-topology, 1400 tris) | 15 credits | 15 credits each (`consumed_credits` 15.0, 2 models, balance 1131 to 1091 with the two 5-credit text previews), done in about 40 s, GLB 2.2 MB with embedded texture, 1424 and 1486 tris | 2026-10-08 |
| Meshy rig / animation | 5 / 3 per action | | |
| Tripo v3 image-to-3D + smart_low_poly | 30 to 40 credits | | |
| Gemini 1K image with one reference image (unit concepts) | $0.034 | $0.0336 each, `generateContent` route again | 2026-10-08 |
| ElevenLabs SFX per second | ~$0.002 | 1.0 s clip, 17 KB mp3_44100_128 accepted on this plan; USD computed at $0.12/min (response header `character-cost: 5`, not a USD figure) | 2026-10-08 |
| ElevenLabs music per minute | ~$0.15 | | |

## 8. Keys and safety

Keys live only in the project `.env` (gitignored), loaded by `python-dotenv` and Node `--env-file`. Never print key values, never write them into reports, manifests, logs or commits. `npm run doctor` reports presence only.

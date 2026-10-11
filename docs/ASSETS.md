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
| `python tools/assets/regen.py prepare --id building.hearth --prompt "..." [--from concept]` | re-generate one asset (BACKLOG 26): archives its current outputs and manifest row under `tools/assets/raw/history/<id>/<stamp>/`, sets the new prompt, resets the steps from `--from` on to pending, unapproves it and prints the projected cost (free, nothing is sent). Then `gen.py run --only <id> --max-usd N` makes the new version |
| `python tools/assets/regen.py sheet --id X` / `restore --id X` / `selftest` | before and after sheet (concept, thumbnail, both prompts) to `reports/latest/regen_<id>.png`; restore puts the newest archive back (the replaced version is archived first); selftest runs all three on a temporary copy |
| `python tools/assets/audio_post.py` | trim silence, normalize loudness, convert to OGG |

Blender 5.x gotchas (from research): engine id `BLENDER_EEVEE`, set `media_type` before `file_format`, `scene.node_tree` removed, Python 3.13 inside Blender, `export_apply` disables shape keys.

## 5. Order of work (runs in parallel with the code roadmap)

1. **A0 (during M0):** pipeline skeleton, manifest schema, dry-run, ledger, budget caps, provider clients with a single cheap smoke call each (concept image, 5-credit Meshy untextured model, 1 s SFX). Record real costs in `docs/ASSETS.md` section 7.
2. **A1 (during M2 to M3):** style refs (6 Gemini images). Main agent views the 6 refs once as a contact sheet and picks the direction, writes the choice into style.json. Then 2 unit bake-off models per provider; main agent views one comparison sheet and picks. Every `gen.py run` call returns within 8 minutes; the subagent calls it repeatedly and never leaves a job running at turn end (remote jobs keep running server side and are resumed by id).
3. **A2 (during M4 to M6):** all buildings, props, trees, rocks; then static units in a relaxed standing pose.
4. **A3 (during M6 to M8):** SFX list (from sim event types), Shaper and troop barks, 3 music stems, spell VFX textures, icons.
5. **A4 (M10):** renderer swaps placeholders for assets; shot sets re-baselined after the contact sheet review.

### A4 integration (M10, done)
- **Models:** `packages/render/src/models.ts` loads every `assets/models/*.glb` (bake-off files excluded) once per page with GLTFLoader and never throws; a failed or missing id keeps its placeholder mesh. Ids: `building.<id>` (dwellings by level: `_small`, `_medium`, `_large`), `unit.<id>` (`wild` uses `unit.wild_person`), worship sites `building.<id>`, trees `prop.tree_a|b|c`. Tribe tint: triangles whose three vertex colors are the azure marker (`#2E6FD8`) form a separate white part painted per instance; buildings with under 1 percent marker get a banner (pole and white flag) as their tint part. Tree models drop their root disc (`trimBase`). `?models=0` forces placeholders; `__game.models()` reports pending, loaded, failed and drawn ids.
- **Icons:** `assets/icons/icon.<kind>.<id>_128.png` in the spell bar, the build menu (dwellings use `_small`) and the mana and population bars (`apps/game/src/icons.ts`).
- **Audio:** `packages/audio` plays `assets/audio/<id>.ogg` through Web Audio (`player.ts`) with sfx, voice and music buses fed by the volume settings, distance falloff and pan around the camera focus, and a music director (`mix.ts`) choosing the calm, tension or battle stem. `style.json` `audio.alias` lets a cue borrow another clip.
- **Placeholders still in use (logged, not blocking):** no models (`building.boathouse`, `building.skyloft`, `unit.boat`, `unit.balloon` got GLBs and icons in BACKLOG 10; `building.shade_den` and `unit.shade` in B1); no sound cue is silent any more (BACKLOG 92 added `sfx.chant`, `sfx.chant_break`, `sfx.converted`, `sfx.trained`, `sfx.eliminated` and own cast clips for firerain, whirlwind, erode, mire, veil, ward, beguile, wraith, lightning). Still borrowed by alias: hornets, raise_land, flatten, quake, volcano casts (their clip is the cast sound), `sfx.fireball`, `sfx.melee_hit`, `sfx.building_down`, `sfx.terrain_moved`. `packages/audio/test/mix.test.ts` pins that every cue is covered so a new cue without a clip fails a test.

Every concept reference, style pick, bake-off comparison and class contact sheet is also archived for the making-of story: `npm run making-of -- add <file> --milestone A1 --kind concept --caption "..."` (see `making-of/README.md`).

### Decisions so far
- Art direction (A1, 10/08/2026): concept.ref_04 crisp flat-shaded polygon, lit like ref_05 (warm golden hour); recorded in `data/base/style.json` `direction`.
- Second reference (Stewart, 10/09/2026): `making-of/a1/20261008-2206_style-ref-06.jpg` (tilt-shift tabletop miniature). He likes its trees, thatched huts, water and the tilt-shift view (not its people) and prefers it to the current look; it guides the next look pass (BACKLOG 14a) without replacing the retro direction outright.
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
| Meshy meshy-t2 image-to-3D mesh only (`should_texture: false`, hearth, discarded) | 5 credits | 5 credits, 33 KB untextured GLB (building rows lacked `textured: true`, fixed) | 2026-10-08 |
| Meshy meshy-t2 textured building (smart-topology, target 900 to 2200) | 15 credits | 15 credits each, 11 buildings plus 2 retries; ledger rate $0.02 per credit = $0.30 each; returned tris 643 to 2180 (target 900 gave 643 on the small dwelling, 1500 gave 1269) | 2026-10-08 |
| Meshy meshy-t2 text-to-3D preview props (trees, rocks) | 5 credits | 5 credits each, 300 to 356 tris trees, 152 to 232 tris rocks | 2026-10-08 |
| Meshy meshy-t2 textured image-to-3D, v1 units (smart-topology, target 1400) | 15 credits | 15 credits each, 6 models (4 new plus 2 redos), $0.30 each at the ledger rate; Gemini concept with ref_04 style reference $0.0336 each; returned tris 1394 to 1520 | 2026-10-08 |
| Meshy meshy-t2 textured image-to-3D plus Gemini concept (B1: `unit.shade`, `building.shade_den`) | 15 credits + $0.034 | 15 credits each ($0.30 at the ledger rate) + $0.0336 each = $0.667 for the pair; returned tris 1443 and 2127, no QA warnings, no redraws | 2026-10-09 |
| Meshy meshy-t2 textured image-to-3D plus Gemini concept with the tilt-shift style-ref-06 as reference (BACKLOG 14a-4, 3 candidate dwellings `building.dwelling_*.bakeoff_v3`) | 15 credits + $0.034 each | 15 credits each ($0.30 at the ledger rate) + $0.0336 each = $1.00 for the set; returned tris 1014, 1458, 1891, no QA warnings, no redraws | 2026-10-09 |
| Meshy meshy-t2 textured image-to-3D plus Gemini concept (BACKLOG 10 vehicles: `building.boathouse`, `building.skyloft`, `unit.boat`, `unit.balloon`; vehicles use param `no_pose` so the person pose text is skipped) | 15 credits + $0.034 each | 15 credits ($0.30) + $0.0336 each = $1.334 for the four; no redraws; returned tris 1885, 1988, 1264, 1426; tint faces boat 82 (6.5 percent), balloon 129 (9.0 percent) | 2026-10-10 |
| Stretch 3 content pack: 3 buildings (Gemini concept with ref_04 + Meshy textured image-to-3D, 15 credits each), 2 spell icons (Gemini 1K magenta key), 2 cast SFX (ElevenLabs 1.6 and 2.0 s) | 15 credits + $0.034 per building | buildings $1.00 for three ($0.30 + $0.0336 each), spell icons $0.067, SFX $0.007; total $1.075; tris 1158 (spirit_well), 1219 (mending_hut), 1752 (signal_pyre), no QA warnings, no redraws | 2026-10-11 |
| Meshy rig / animation | 5 / 3 per action | | |
| Tripo v3 image-to-3D + smart_low_poly | 30 to 40 credits | | |
| Gemini 1K image with one reference image (unit concepts) | $0.034 | $0.0336 each, `generateContent` route again | 2026-10-08 |
| ElevenLabs SFX per second | ~$0.002 | 1.0 s clip, 17 KB mp3_44100_128 accepted on this plan; USD computed at $0.12/min (response header `character-cost: 5`, not a USD figure) | 2026-10-08 |
| ElevenLabs music per minute (`music_v2_5`, `force_instrumental`, 75 s, `mp3_44100_128`) | ~$0.15 | accepted on the pay-as-you-go plan (no plan error), 1.2 MB per 75 s stem, about 5 s to return; ledger computes $0.1875 per stem at list price (3 stems); no USD figure is returned | 2026-10-08 |
| ElevenLabs SFX, 21 clips of 0.5 to 2 s | ~$0.002 per second | 28 s total, $0.052 at list price; response header `character-cost` 3 credits for 0.5 s. One 0.5 s clip came back near silent (peak -50 dB) and was regenerated for another $0.001, so budget 5 percent for redraws | 2026-10-08 |
| ElevenLabs SFX, 14 clips of 0.8 to 2.5 s (BACKLOG 92: chant, chant_break, converted, trained, eliminated, 9 spell casts) | ~$0.002 per second | 22 s total, $0.043 at list price, no redraws needed; all landed within 0.5 dB of the -18 LUFS target (chant_break -21, a short transient), 26 to 44 KB each | 2026-10-10 |
| ElevenLabs Voice Design (one call, 3 previews, then save preview 0) | not published | accepted; ledger assumes $0.01, real cost not visible in the response | 2026-10-08 |
| ElevenLabs TTS `eleven_v4`, 5 short invented-language barks (10 to 25 chars) | $0.08 per 1K chars | 94 chars total, $0.0076 at list price (the ledger estimate; the promo rate would be lower) | 2026-10-08 |
| Gemini 1K image on pure black (VFX) and on magenta with ref_04 (icons) | $0.034 | $0.0336 each, `generateContent` route; 17 images = $0.571, no redraws needed (magenta pockets fixed in the key, not by regenerating); 8 more spell icons (veil to wraith) $0.269, same $0.0336 each | 2026-10-08 |

## 8. Keys and safety

Keys live only in the project `.env` (gitignored), loaded by `python-dotenv` and Node `--env-file`. Never print key values, never write them into reports, manifests, logs or commits. `npm run doctor` reports presence only.

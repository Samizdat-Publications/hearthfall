# tools/assets: asset pipeline

Manifest-driven, idempotent, resumable. Design: `docs/ASSETS.md`. API facts: `docs/research/asset_apis.md`.
Run everything with the project venv: `.venv/Scripts/python tools/assets/<script>.py ...` from the project root.

## Commands

| Command | Does |
|---|---|
| `gen.py seed` | add any missing v1 rows (43 of them) to `assets.json`; never overwrites existing rows |
| `gen.py plan [--class X] [--only ID ...]` | dry run, no API calls: pending steps, projected, spent and cap per provider |
| `gen.py run --class X --max-usd N --max-minutes M [--only ID ...]` | submit, poll, download, hash, post-process, QA. Returns within M minutes. Meshy jobs left in flight are resumed by `remote_id` on the next call, never re-submitted |
| `gen.py status` | one line per class, plus spend versus caps |
| `gen.py repost --only ID ...` | reset the free local post and thumb steps (after changing normalize.py), then `gen.py run --only ID ...` |
| `bakeoff_sheet.py` | A1 unit bake-off sheet `reports/latest/unit_bakeoff_sheet.png` (2x2 renders plus the Gemini concepts) |
| `gen.py balance` | key presence per provider (never values) and the Meshy credit balance |
| `blender_run.py normalize --in raw.glb --out assets/models/x.glb [--height H \| --footprint F]` | Blender normalize pass |
| `blender_run.py thumbs --class X` | 256 px and 128 px thumbnails for finished models |
| `qa.py [--class X]` | tri count, bounds, palette distance, non-manifold edges, file size, written into the manifest; builds `reports/latest/assets_sheet.png` |
| `audio_post.py [--check]` | trim leading silence, loudness normalize, convert to OGG (stub with a printed plan if ffmpeg is missing) |

Classes: `concept`, `buildings`, `props`, `units`, `sfx`, `music`.

## Safety and budgets

- Keys and caps come from `.env` (`*_API_KEY`, `BUDGET_<PROVIDER>_USD`, `BUDGET_TOTAL_USD`). Only presence is ever printed.
- Before every paid job the runner checks provider cap, total cap and `--max-usd` against `ledger.jsonl` plus the estimate. If any would be exceeded the job is skipped and noted.
- `ledger.jsonl` is append-only. A Meshy job writes a `submit` line (estimate) then a `settled` line (actual credits); the last line per (asset, step, attempt) counts.
- Three attempts per step, then `needs_review`. A run never leaves a process behind; a lock file `raw/.gen.lock` stops two runs from overlapping.
- Meshy credit price is not published; `common.PRICING` assumes $0.02 per credit (conservative). Gemini Interactions is tried first, then `generateContent` on a 4xx (the Gemini 1K smoke used the fallback).

## Where outputs land

| What | Path |
|---|---|
| Raw downloads (write once, gitignored) | `tools/assets/raw/<provider>/<asset id>/` |
| Blender scratch (palette json, reports, job lists) | `tools/assets/raw/_work/` |
| Normalized models | `assets/models/<id>.glb` |
| Thumbnails | `assets/icons/<id>.png` and `<id>_128.png` |
| Audio (OGG) | `assets/audio/<id>.ogg` |
| Contact sheet | `reports/latest/assets_sheet.png` |
| Manifest, ledger | `tools/assets/assets.json`, `ledger.jsonl` |
| Style text | `data/base/style.json` (`promptStyleSuffix`, `promptNegative`, `styleVersion`, palette, triBudgets) is the single source; `style_prompt.json` holds only per-class fragments (camera, mesh suffix, unit pose, style-reference note, templates) |

## Meshy image-to-3D (verified 2026-10-08, A1)

Checked against docs.meshy.ai/en/api/image-to-3d and confirmed by two real calls. `POST /openapi/v1/image-to-3d` body that worked:
`image_url` (base64 data URI `data:image/jpeg;base64,...` of the Gemini JPEG, or a public URL), `ai_model: "meshy-t2"`, `model_type: "smart-topology"`, `target_polycount: 1400`, `should_texture: true` (false gives the 5-credit mesh-only variant). Returns `{"result": id}`; poll `GET /openapi/v1/image-to-3d/{id}`; `model_urls.glb`; `consumed_credits` 15 textured. `enable_pbr` is only valid with `should_texture: true` (left off). `should_remesh`, `topology` and `save_pre_remeshed_model` are ignored for smart-topology. `pose_mode` exists but is left unset (never force a-pose or t-pose for static units). Task row param `textured: true` selects the 15-credit estimate.

## Unit coloring

- Textured Meshy output (route B): normalize samples the texture per face at the UV centroid and snaps to the unit palette subset (`blender_run.UNIT_PALETTE`).
- Untextured output (route A): `--scheme unit` colors by height slab (feet, bare legs, torso garment, a tribe-colored band at 46 to 55 percent of height, arms or shield and club beside the torso, head, hair). Deterministic but crude; the band exists whether or not the mesh has real cloth there.
- The report lists `palette_faces`, `tribe_faces` and `tribe_height_range`; `qa.py` warns when a unit with a `tribe_color` param has no tribe-colored faces. Tribe colors are azure, crimson, amber, jade.

## Blender notes

- `BLENDER_EXE` from `.env`; if unset or missing, `blender_run.py` falls back to the newest `C:\Program Files\Blender Foundation\Blender *\blender.exe` and prints a warning. This PC has Blender 5.1.
- Export uses `export_vertex_color='ACTIVE'` (the single `Col` attribute). With `'MATERIAL'` on Blender 5.1.2 the exporter wrote all-white COLOR_0 even with a Color Attribute node wired to Base Color, so the research recommendation did not hold here.
- The palette is read from `data/base/style.json` when it exists, otherwise `seed-data/style.json`.

## Not done yet

- Tripo client is written but untested (bake-off is A1); rigging and animation steps are `skipped` (v1 units are static).
- Voice barks, VFX textures and icons from Gemini have no rows yet (A3).

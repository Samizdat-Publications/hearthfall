"""v1 asset list for the manifest. `python tools/assets/gen.py seed` adds any missing rows (never overwrites).

Subjects are written in Hearthfall's own vocabulary (docs/DESIGN.md section 2). Nothing here may borrow names
from the late-90s game that inspired the genre.
"""
from __future__ import annotations

from common import new_step

CONCEPT_PARAMS = {"aspect_ratio": "1:1", "image_size": "1K"}


def _concepts():
    rows = [
        ("concept.ref_01", "wide establishing view of a tiny tribal hill village diorama around a glowing stone hearth, thatched round huts, a few trees, a winding path", "16:9"),
        ("concept.ref_02", "the Shaper, a robed tribal caster with a tall carved staff and a glowing ember charm, heroic proportions, big hands and feet", "1:1"),
        ("concept.ref_03", "cluster of three stylized trees and two boulders on a small grassy mound, layered foliage shapes, rounded rocks", "1:1"),
        ("concept.ref_04", "carved wooden totem pole beside a small stone shrine with offerings, painted bands in clay red and ochre", "1:1"),
        ("concept.ref_05", "a stout log watchtower next to a timber warden lodge with a pointed roof and a banner, palisade fence", "1:1"),
        ("concept.ref_06", "a fire lodge with a red clay chimney and a bright orange fire glow at the door, sparks rising, stone base", "1:1"),
    ]
    out = []
    for aid, subject, ar in rows:
        steps = {"concept": new_step("pending", "gemini")}
        for s in ("model", "rig", "animate", "post", "thumb"):
            steps[s] = new_step("skipped")
        out.append({
            "id": aid, "class": "concept", "prompt": subject, "refs": [], "provider": "gemini",
            "params": {**CONCEPT_PARAMS, "aspect_ratio": ar, "kind": "style_ref"}, "steps": steps,
        })
    return out


def _buildings():
    # (id, subject, target tris, footprint in world units (cells), extra)
    rows = [
        ("building.hearth", "tribal village hearth: a ring of stacked stones around a large glowing ember bowl on a raised round stone platform", 1800, {"footprint": 2.6}),
        ("building.dwelling_small", "small round tribal dwelling with a thatched cone roof, wooden door, wattle walls", 900, {"footprint": 2.0}),
        ("building.dwelling_medium", "medium tribal longhouse with a thatched roof, a chimney hole, and a timber porch", 1400, {"footprint": 2.5}),
        ("building.dwelling_large", "large tribal hall house with a double thatched roof, carved roof beams, and two doors", 2000, {"footprint": 3.0}),
        ("building.watchtower", "tall timber watchtower on stilts with a lookout platform and a small pointed roof, rope ladder", 1600, {"footprint": 2.0}),
        ("building.warden_lodge", "sturdy timber warden lodge with a pointed roof, a banner pole, and a rack of spears at the door", 2200, {"footprint": 3.0}),
        ("building.fire_lodge", "fire lodge with a red clay chimney, stone base, glowing orange doorway, thatch and clay roof", 2200, {"footprint": 3.0}),
        ("building.chant_house", "open-sided chant house with a domed thatched roof on carved pillars, a ring of seats, hanging wind chimes", 2200, {"footprint": 3.0}),
        ("building.shrine", "small stone shrine: a stacked stone cairn under a little peaked roof with ribbons and a glowing gem", 1000, {"footprint": 2.0}),
        ("building.reliquary", "stone reliquary vault: a squat round stone building with a carved door and a glowing crystal on top", 1800, {"footprint": 2.0}),
        ("building.totem", "tall carved wooden totem pole with stacked animal faces, painted bands of clay red and ochre, small stone base", 900, {"height": 2.6}),
    ]
    out = []
    for aid, subject, tris, scale in rows:
        steps = {"concept": new_step("pending", "gemini"), "model": new_step("pending", "meshy"),
                 "rig": new_step("skipped"), "animate": new_step("skipped"),
                 "post": new_step("pending", "local"), "thumb": new_step("pending", "local")}
        out.append({
            "id": aid, "class": "buildings", "prompt": subject, "refs": [], "provider": "meshy",
            "params": {**CONCEPT_PARAMS, "route": "image", "target_polycount": tris, "budget_class": "building",
                       "scheme": "sample", "default_color": "stone", **scale},
            "steps": steps,
        })
    return out


def _props():
    rows = [
        ("prop.tree_a", "a small stylized low-poly broadleaf tree with a short brown trunk and a rounded, layered green canopy", 400, 2.0, "tree"),
        ("prop.tree_b", "a stylized low-poly pine tree with a slim trunk and three stacked cone-shaped green tiers", 350, 2.4, "tree"),
        ("prop.tree_c", "a stylized low-poly old gnarled tree with a thick twisted trunk and a wide flat canopy", 450, 1.8, "tree"),
        ("prop.rock_a", "a rounded stylized low-poly boulder with a few big flat facets", 200, 0.7, "rock"),
        ("prop.rock_b", "a flat stylized low-poly stone slab with chunky chipped edges", 180, 0.5, "rock"),
        ("prop.rock_c", "a tall stylized low-poly standing stone with angular facets, slightly leaning", 220, 1.0, "rock"),
    ]
    out = []
    for aid, subject, tris, height, scheme in rows:
        steps = {"concept": new_step("skipped"), "model": new_step("pending", "meshy"),
                 "rig": new_step("skipped"), "animate": new_step("skipped"),
                 "post": new_step("pending", "local"), "thumb": new_step("pending", "local")}
        out.append({
            "id": aid, "class": "props", "prompt": subject, "refs": [], "provider": "meshy",
            "params": {"route": "text", "target_polycount": tris, "height": height, "budget_class": "prop",
                       "scheme": scheme, "default_color": "rock"},
            "steps": steps,
        })
    return out


def _units():
    # v1 units are static meshes in a relaxed standing pose (docs/ASSETS.md section 1). Provider chosen by the A1 bake-off.
    rows = [
        ("unit.shaper", "the Shaper, a tribal caster in a long hooded robe holding a tall carved staff topped with a glowing ember", 1.1),
        ("unit.settler", "a tribal settler in a simple tunic with a woven carry basket on one hip", 0.9),
        ("unit.warden", "a tribal warden in light wooden armor with a round shield on one arm and a short spear held upright", 1.0),
        ("unit.firecaller", "a tribal firecaller in a red and orange robe holding a clay bowl of glowing embers", 1.05),
        ("unit.chanter", "a tribal chanter in a long pale robe holding a small hand drum, mouth open mid song", 1.0),
        ("unit.wild_person", "an unaligned wild person in a ragged fur wrap with messy hair and a wooden club resting on one shoulder", 0.95),
    ]
    out = []
    for aid, subject, height in rows:
        steps = {"concept": new_step("pending", "gemini"), "model": new_step("pending", "meshy"),
                 "rig": new_step("skipped"), "animate": new_step("skipped"),
                 "post": new_step("pending", "local"), "thumb": new_step("pending", "local")}
        out.append({
            "id": aid, "class": "units", "prompt": subject, "refs": [], "provider": "meshy",
            "params": {**CONCEPT_PARAMS, "route": "image", "target_polycount": 1400, "height": height,
                       "budget_class": "unit", "scheme": "sample", "default_color": "cloth", "pose": "relaxed_standing",
                       "bakeoff": ["meshy", "tripo"]},
            "steps": steps,
        })
    return out


def _sfx():
    rows = [
        ("sfx.ui_click", "a short soft wooden click", 0.5),
        ("sfx.ui_confirm", "a warm two-note wooden chime, confirming a choice", 1.0),
        ("sfx.unit_select", "a soft hand drum tap with a short rising hum", 0.6),
        ("sfx.build_place", "a heavy wooden thud with a little stone scrape, placing a building", 1.2),
        ("sfx.build_complete", "a bright rising chime with a soft wooden knock, construction finished", 1.5),
        ("sfx.terrain_raise", "a deep earth rumble with crumbling soil, ground rising", 2.0),
        ("sfx.water_splash", "a big splash of water with a short gurgle", 1.2),
        ("sfx.fire_burst", "a roaring whoosh of fire with crackling embers", 1.5),
        ("sfx.lightning_strike", "a sharp crack of lightning with a short rolling thunder tail", 1.5),
        ("sfx.convert_chime", "a gentle magical shimmer with a soft bell, a wild person joining the tribe", 1.2),
        ("sfx.mana_pulse", "a low warm pulsing hum, magical energy gathering", 1.5),
    ]
    out = []
    for aid, subject, dur in rows:
        steps = {s: new_step("skipped") for s in ("concept", "rig", "animate", "thumb")}
        steps["model"] = new_step("pending", "elevenlabs")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "sfx", "prompt": subject, "refs": [], "provider": "elevenlabs",
            "params": {"duration_seconds": dur, "prompt_influence": 0.3, "output_format": "mp3_44100_128", "loop": False},
            "steps": steps,
        })
    return out


def _music():
    rows = [
        ("music.calm", "calm peaceful village theme, slow tempo, soft flute and plucked strings, gentle drone", 60000),
        ("music.tension", "rising tension theme, slow pulsing low drums, sparse minor-key strings, uneasy", 60000),
        ("music.battle", "driving battle theme, fast hand drums, bold brass-like horns, urgent and heroic", 60000),
    ]
    out = []
    for aid, subject, ms in rows:
        steps = {s: new_step("skipped") for s in ("concept", "rig", "animate", "thumb")}
        steps["model"] = new_step("pending", "elevenlabs")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "music", "prompt": subject, "refs": [], "provider": "elevenlabs",
            "params": {"length_ms": ms, "model_id": "music_v2_5", "force_instrumental": True, "output_format": "mp3_44100_128",
                       "note": "needs a paid ElevenLabs plan; on a plan error skip and log it"},
            "steps": steps,
        })
    return out


def v1_assets() -> list:
    rows = _concepts() + _buildings() + _props() + _units() + _sfx() + _music()
    for r in rows:
        r.setdefault("style_version", 1)
        r.setdefault("request_hash", None)
        r.setdefault("approved", False)
        r.setdefault("qa", {})
    return rows

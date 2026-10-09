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


def _bakeoff_units():
    """A1 step 2: Meshy route A (text-to-3D preview, untextured) vs route B (Gemini concept -> image-to-3D, textured)."""
    subjects = [
        ("settler", 0.9, "a humble tribal villager standing relaxed with arms hanging loosely at the sides, simple knee-length undyed linen tunic with a wide bright azure blue cloth band tied around the waist, bare arms and lower legs, simple sandals, short brown hair, carries nothing"),
        ("warden", 1.0, "a sturdy tribal guard standing relaxed, broad shoulders, short leather jerkin with a bright azure blue cloth sash across the chest, a thick wooden club held down in the right hand and a round hide shield with a wooden rim strapped to the left forearm, bare arms, sturdy boots"),
    ]
    out = []
    for name, height, subject in subjects:
        for route, letter in (("text", "a"), ("image", "b")):
            steps = {"concept": new_step("skipped" if route == "text" else "pending", None if route == "text" else "gemini"),
                     "model": new_step("pending", "meshy"), "rig": new_step("skipped"), "animate": new_step("skipped"),
                     "post": new_step("pending", "local"), "thumb": new_step("pending", "local")}
            params = {**CONCEPT_PARAMS, "route": route, "target_polycount": 1400, "height": height,
                      "budget_class": "unit", "scheme": "unit" if route == "text" else "sample", "default_color": "cloth",
                      "pose": "relaxed_standing", "bakeoff": f"meshy_route_{letter}", "tribe_color": "azure"}
            if name == "warden":
                params.update(side_color="wood", torso_color="thatch")
            if route == "image":
                params["textured"] = True
            out.append({"id": f"unit.{name}.bakeoff_{letter}", "class": "units", "prompt": subject,
                        "refs": ["tools/assets/raw/gemini/concept.ref_04/concept.jpg"] if route == "image" else [],
                        "provider": "meshy", "params": params, "steps": steps})
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
        ("music.calm", "calm peaceful village theme at 70 bpm, soft tribal frame drums, a warm wooden flute melody, gentle drone, relaxed", 75000),
        ("music.tension", "slow building tension at 80 bpm, low tribal floor toms pulsing, sparse wooden flute fragments in a minor mode, uneasy", 75000),
        ("music.battle", "driving battle theme at 130 bpm, fast tribal hand drums and war drums, urgent wooden flute riffs, heroic and fierce", 75000),
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


# ----------------------------------------------------------------------------- A3 (audio, voice, VFX, icons)
REF04 = "tools/assets/raw/gemini/concept.ref_04/concept.jpg"


def _a3_sfx():
    # (id, subject, seconds). Sim event types and UI actions, then the v1 spells' cast and impact sounds.
    rows = [
        ("sfx.unit_selected", "a soft wooden click, a light tap of wood on wood", 0.5),
        ("sfx.order_move", "one short tribal hand drum tap, a warm acknowledgement", 0.6),
        ("sfx.chop", "a single axe chop into a log, with a wood crack", 0.7),
        ("sfx.wood_delivered", "a dull wooden thunk of a log dropped onto a pile of logs", 0.8),
        ("sfx.building_done", "a warm soft chime followed by two hammer knocks on wood", 1.5),
        ("sfx.born", "a soft rising wooden flute note, gentle and bright", 1.2),
        ("sfx.drowned", "a splash followed by a short gurgle of water closing over", 1.5),
        ("sfx.died", "a low dull thud, quiet and final", 0.8),
        ("sfx.plan_placed", "a wooden stake driven into soft earth, a thump and a little soil", 0.8),
        ("sfx.charged", "a magical shimmer, a rising sparkle with a soft chime", 1.2),
        ("sfx.ui_error", "a dull wooden knock, low and short, a refusal", 0.5),
        ("sfx.bolt_cast", "a quick fiery bolt launch, a hiss and a short whoosh", 0.9),
        ("sfx.bolt_impact", "a sharp electric crackle and a short blast", 1.2),
        ("sfx.call_cast", "a gentle chant swell of soft humming voices rising", 1.8),
        ("sfx.lightning_impact", "a thunder crack, a sharp lightning strike then a short rolling rumble", 2.0),
        ("sfx.raise_land", "a deep rumble of rising earth, rocks grinding upward", 2.0),
        ("sfx.flatten", "a grinding settle of earth, heavy stones sliding and compacting", 1.5),
        ("sfx.quake", "a long heavy rumble with cracking rock and crumbling earth", 2.0),
        ("sfx.hornets", "an angry buzzing swarm of hornets", 2.0),
        ("sfx.volcano", "a volcanic eruption roar with an explosive blast and deep rumble", 2.0),
    ]
    out = []
    for aid, subject, dur in rows:
        steps = {s: new_step("skipped") for s in ("concept", "rig", "animate", "thumb")}
        steps["model"] = new_step("pending", "elevenlabs")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "sfx", "prompt": subject, "refs": [], "provider": "elevenlabs",
            "params": {"duration_seconds": dur, "prompt_influence": 0.45, "output_format": "mp3_44100_128", "loop": False},
            "steps": steps,
        })
    return out


SHAPER_VOICE = {
    "key": "shaper",
    "name": "Hearthfall Shaper",
    "description": ("An older woman with a warm, low, resonant voice and great natural authority, calm and commanding like a tribal elder "
                    "and ritual caller. Slight gravel and breath, steady pace, melodic, speaking an invented chanting language."),
    "sample_text": ("Ihra sovenu, kael thuora vessen alu. Marun tevi sorrenu, ahe dru kaleshi vo. "
                    "Ora venai, thessa ruun alai, ihra sovenu mor."),
}


def _a3_voice():
    # Invented-language barks: not real words, nothing from the 1998 game. Ids voice.shaper.*
    rows = [
        ("voice.shaper.acknowledged", "Ihra sovenu.", "acknowledged an order, calm and brief"),
        ("voice.shaper.acknowledged_b", "Vael tanuri.", "acknowledged an order, a second variant"),
        ("voice.shaper.casting", "Kael-thu ora, vessen alu!", "casting a spell, rising and commanding"),
        ("voice.shaper.under_attack", "Dru karesh! Alun mor!", "under attack, sharp and urgent"),
        ("voice.shaper.victory", "Ohe thavuni, sorrenu ai!", "victory, proud and ringing"),
    ]
    out = []
    for aid, text, note in rows:
        steps = {s: new_step("skipped") for s in ("concept", "rig", "animate", "thumb")}
        steps["model"] = new_step("pending", "elevenlabs")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "voice", "prompt": note, "refs": [], "provider": "elevenlabs",
            "params": {"voice_key": "shaper", "text": text, "model_id": "eleven_v4", "output_format": "mp3_44100_128",
                       "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.35}},
            "steps": steps,
        })
    return out


def _a3_vfx():
    rows = [
        ("vfx.bolt_burst", "a radial burst of hot orange and white energy with angular spark shards, a starburst impact flash"),
        ("vfx.lightning_streak", "a single jagged branching streak of pale blue-white lightning with a bright core, floating centered with tapering ends"),
        ("vfx.hornet_swarm", "a loose cloud of many tiny glowing amber hornet shapes with faint motion streaks, a swarm particle sprite"),
        ("vfx.lava_splash", "a splash of molten lava, red-orange droplets and chunky blobs flying outward from a bright yellow core"),
        ("vfx.magic_glow_ring", "a thin glowing violet magic ring, perfectly circular and centered, soft inner glow and a few sparkles, empty center"),
        ("vfx.dust_puff", "a soft puff of warm tan earthen dust, rounded faceted billows, centered"),
        ("vfx.water_splash", "a crown-shaped splash of blue and white water droplets and foam, stylized angular droplets, centered"),
    ]
    out = []
    for aid, subject in rows:
        steps = {s: new_step("skipped") for s in ("model", "rig", "animate", "thumb")}
        steps["concept"] = new_step("pending", "gemini")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "vfx", "prompt": subject, "refs": [], "provider": "gemini",
            "params": {**CONCEPT_PARAMS, "kind": "vfx"},
            "steps": steps,
        })
    return out


def _a3_icons():
    rows = [
        ("icon.spell.bolt", "a hurled bolt of fiery orange and white energy with a short comet tail, spell icon"),
        ("icon.spell.call", "a carved wooden horn with three glowing pale green sound rings radiating from it, spell icon"),
        ("icon.spell.hornets", "three angry amber and black striped hornets swarming together, spell icon"),
        ("icon.spell.raise_land", "a jagged brown earthen ridge of rock rising up out of flat green ground with lifting chunks, spell icon"),
        ("icon.spell.lightning", "a bright blue-white forked lightning bolt striking down out of a dark storm cloud, spell icon"),
        ("icon.spell.flatten", "a perfectly level slab of earth with a smooth flat top and a heavy stone pressing down on it, spell icon"),
        ("icon.spell.quake", "cracked ground split by a deep jagged fissure with flying rock chunks, spell icon"),
        ("icon.spell.volcano", "a small volcano cone erupting with glowing orange lava and dark smoke, spell icon"),
        ("icon.spell.veil", "a pale blue-grey translucent shroud of mist draped like a hooded cloak, hiding small shadowy figures within it, spell icon"),
        ("icon.spell.ward", "a golden protective dome shield of glowing light with a bright rim and a simple rune on its face, spell icon"),
        ("icon.spell.beguile", "a glowing pink-violet heart-shaped charm swirling with sparkles and a looping ribbon of magic, spell icon"),
        ("icon.spell.whirlwind", "a dusty white tornado funnel spinning with swirling bands of wind, dust and small flying debris, spell icon"),
        ("icon.spell.mire", "an olive-green sucking bog, a swirling whirlpool of dark mud with bubbles and a few grasping reeds, spell icon"),
        ("icon.spell.erode", "a chunk of brown land crumbling and sinking into rippling blue water, with a foamy shoreline, spell icon"),
        ("icon.spell.firerain", "three flaming meteors falling diagonally from above, trailing orange and yellow fire, spell icon"),
        ("icon.spell.wraith", "a pale cyan flying ghost hunter, a streamlined spectral wisp with glowing eyes and a trailing tail, spell icon"),
        ("icon.resource.mana", "a glowing blue-violet crystal droplet of magical energy with a few small sparkles, resource icon"),
        ("icon.resource.population", "three small stylized tribal people standing close together in simple tunics, resource icon"),
    ]
    out = []
    for aid, subject in rows:
        steps = {s: new_step("skipped") for s in ("model", "rig", "animate", "thumb")}
        steps["concept"] = new_step("pending", "gemini")
        steps["post"] = new_step("pending", "local")
        out.append({
            "id": aid, "class": "icons", "prompt": subject, "refs": [REF04], "provider": "gemini",
            "params": {**CONCEPT_PARAMS, "kind": "icon"},
            "steps": steps,
        })
    return out


def v1_assets() -> list:
    rows = _concepts() + _buildings() + _props() + _units() + _bakeoff_units() + _sfx() + _music() + _a3_sfx() + _a3_voice() + _a3_vfx() + _a3_icons()
    for r in rows:
        r.setdefault("style_version", 1)
        r.setdefault("request_hash", None)
        r.setdefault("approved", False)
        r.setdefault("qa", {})
    return rows

"""Blender thumbnail renderer: EEVEE, vertex-color material, warm key + cool fill + world ambient, 3/4 ortho view.

Usage (after the bare "--"): --jobs jobs.json   where jobs.json is
[{"in": "x.glb", "out": "x.png", "size": 256, "transparent": false}, ...]
One Blender process renders every job; failures are reported per job without stopping the batch.
Blender 5.1: engine id BLENDER_EEVEE, media_type is set before file_format.
"""
import json
import math
import sys

import bpy
from mathutils import Vector

BG = (0.62, 0.60, 0.56, 1.0)  # neutral warm grey (linear-ish, reads as mid grey)


def vertex_color_material(layer_name):
    mat = bpy.data.materials.new("ThumbVC")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    attr = nt.nodes.new("ShaderNodeVertexColor")
    if layer_name:
        attr.layer_name = layer_name
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    for name in ("Specular IOR Level", "Specular"):
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def add_sun(name, energy, color, euler):
    data = bpy.data.lights.new(name, "SUN")
    data.energy = energy
    data.color = color
    data.angle = math.radians(25)
    obj = bpy.data.objects.new(name, data)
    obj.rotation_euler = euler
    bpy.context.scene.collection.objects.link(obj)


def render_one(glb, out, size, transparent=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in engines else ("BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else sc.render.engine)
    try:
        sc.eevee.taa_render_samples = 16
    except Exception:  # noqa: BLE001
        pass
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = bool(transparent)
    sc.render.resolution_x = sc.render.resolution_y = int(size)
    sc.render.resolution_percentage = 100
    sc.render.image_settings.media_type = "IMAGE"  # required before file_format in Blender 5.x
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = out

    # world: neutral background that also lights the shadow side
    world = bpy.data.worlds.new("ThumbWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = BG
    bg.inputs["Strength"].default_value = 0.9
    sc.world = world

    objs = [o for o in sc.objects if o.type == "MESH"]
    for o in objs:
        me = o.data
        layer = None
        try:
            if len(me.color_attributes):
                ca = me.color_attributes.active_color or me.color_attributes[0]
                layer = ca.name
        except Exception:  # noqa: BLE001
            layer = None
        me.materials.clear()
        me.materials.append(vertex_color_material(layer))

    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr, diag = (lo + hi) / 2, max((hi - lo).length, 0.1)

    # lights: warm key from front-right-above, cool fill from left (camera sits at +X, -Y, +Z after glTF import)
    add_sun("Key", 3.2, (1.0, 0.88, 0.69), (math.radians(52), 0, math.radians(35)))
    add_sun("Fill", 1.0, (0.72, 0.82, 1.0), (math.radians(65), 0, math.radians(-120)))

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    cam_data.type, cam_data.ortho_scale = "ORTHO", diag * 1.05
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = ctr + Vector((diag, -diag, diag * 0.8))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    jobs = json.load(open(argv[argv.index("--jobs") + 1], encoding="utf-8"))
    results = []
    for j in jobs:
        try:
            render_one(j["in"], j["out"], j.get("size", 256), j.get("transparent", False))
            results.append({"in": j["in"], "ok": True})
        except Exception as e:  # noqa: BLE001
            results.append({"in": j["in"], "ok": False, "error": f"{type(e).__name__}: {e}"})
    print("THUMBS_RESULT " + json.dumps(results))


main()

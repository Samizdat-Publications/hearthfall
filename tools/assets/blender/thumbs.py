"""Blender thumbnail renderer (Workbench, orthographic 3/4 view, transparent background).

Usage (after the bare "--"): --jobs jobs.json   where jobs.json is [{"in": "x.glb", "out": "x.png", "size": 256}, ...]
One Blender process renders every job; failures are reported per job without stopping the batch.
"""
import json
import sys

import bpy
from mathutils import Vector


def render_one(glb, out, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    sc = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_WORKBENCH" if "BLENDER_WORKBENCH" in engines else sc.render.engine
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "VERTEX"
    sc.display.shading.show_cavity = False
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = int(size)
    sc.render.resolution_percentage = 100
    sc.render.image_settings.media_type = "IMAGE"  # required before file_format in Blender 5.x
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = out
    objs = [o for o in sc.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr, diag = (lo + hi) / 2, max((hi - lo).length, 0.1)
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
            render_one(j["in"], j["out"], j.get("size", 256))
            results.append({"in": j["in"], "ok": True})
        except Exception as e:  # noqa: BLE001
            results.append({"in": j["in"], "ok": False, "error": f"{type(e).__name__}: {e}"})
    print("THUMBS_RESULT " + json.dumps(results))


main()

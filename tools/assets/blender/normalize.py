"""Blender normalize pass (run through tools/assets/blender_run.py; Blender 5.x, headless).

import GLB -> bake transforms -> join -> merge by distance -> recalc normals -> decimate to budget
-> per-face color (scheme or texture/material sample) snapped to the palette in OKLab -> one shared
vertex-color material -> flat shading -> uniform scale + base-center pivot (+Y up on export) -> export GLB.

Usage (after the bare "--"):
  --in X.glb --out Y.glb --palette palette.json --report report.json
  [--height H | --footprint F] [--tri-min N] [--tri-max N] [--scheme sample|tree|rock] [--default-color NAME]
"""
import argparse
import json
import math
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix


def get_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--palette", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--height", type=float, default=None)
    p.add_argument("--footprint", type=float, default=None)
    p.add_argument("--tri-min", type=int, default=0)
    p.add_argument("--tri-max", type=int, default=0)
    p.add_argument("--scheme", default="sample")
    p.add_argument("--default-color", default="stone")
    return p.parse_args(argv)


# ----------------------------------------------------------------- color math
def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_oklab(rgb):
    rgb = np.asarray(rgb, dtype=np.float64)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ], axis=-1)


def hex_to_linear(h):
    h = h.lstrip("#")
    return srgb_to_linear(np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]))


class Palette:
    def __init__(self, path):
        d = json.load(open(path, encoding="utf-8"))
        self.names = list(d.keys())
        self.lin = np.array([hex_to_linear(d[n]) for n in self.names])
        self.lab = linear_to_oklab(self.lin)

    def snap(self, lin_colors):
        lab = linear_to_oklab(lin_colors)
        d = ((lab[:, None, :] - self.lab[None, :, :]) ** 2).sum(-1)
        idx = d.argmin(axis=1)
        return idx

    def color(self, name):
        return self.lin[self.names.index(name)]


# ------------------------------------------------------------- scene helpers
def tri_count(mesh):
    return int(sum(len(p.vertices) - 2 for p in mesh.polygons))


def principled_base(mat):
    if not mat or not mat.node_tree:
        return None, None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            sock = n.inputs["Base Color"]
            tex = None
            if sock.is_linked and sock.links[0].from_node.type == "TEX_IMAGE":
                tex = sock.links[0].from_node.image
            return np.array(sock.default_value[:3], dtype=np.float64), tex
    return None, None


def image_pixels(img, cache):
    if img.name not in cache:
        w, h = img.size
        arr = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        cache[img.name] = (w, h, arr.reshape(h, w, 4))
    return cache[img.name]


def sample_face_colors(obj, default_lin):
    """Per-face linear RGB for one imported mesh object: texture at the UV centroid, else material base color.
    Texture pixels are treated as sRGB-encoded (byte images); base color default_value is already linear."""
    mesh = obj.data
    cache = {}
    uv = mesh.uv_layers.active.data if mesh.uv_layers.active else None
    out = np.tile(default_lin, (len(mesh.polygons), 1))
    for i, p in enumerate(mesh.polygons):
        mat = obj.material_slots[p.material_index].material if obj.material_slots and p.material_index < len(obj.material_slots) else None
        base, tex = principled_base(mat)
        if tex is not None and uv is not None and tex.size[0] > 0:
            w, h, px = image_pixels(tex, cache)
            u = float(np.mean([uv[l].uv[0] for l in p.loop_indices])) % 1.0
            v = float(np.mean([uv[l].uv[1] for l in p.loop_indices])) % 1.0
            out[i] = srgb_to_linear(px[min(h - 1, int(v * h)), min(w - 1, int(u * w))][:3])
        elif base is not None:
            out[i] = base
    return out


def write_corner_colors(mesh, face_lin, name="Col"):
    while mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    attr = mesh.color_attributes.new(name, "BYTE_COLOR", "CORNER")
    flat = np.ones((len(mesh.loops), 4), dtype=np.float32)
    for i, p in enumerate(mesh.polygons):
        flat[p.loop_start:p.loop_start + p.loop_total, :3] = face_lin[i]
    attr.data.foreach_set("color", flat.ravel())
    mesh.color_attributes.active_color = attr
    mesh.color_attributes.render_color_index = mesh.color_attributes.find(name)


def read_face_colors(mesh, name="Col"):
    attr = mesh.color_attributes.get(name)
    n = len(mesh.loops)
    buf = np.empty(n * 4, dtype=np.float32)
    attr.data.foreach_get("color", buf)
    buf = buf.reshape(n, 4)
    out = np.zeros((len(mesh.polygons), 3))
    for i, p in enumerate(mesh.polygons):
        out[i] = buf[p.loop_start:p.loop_start + p.loop_total, :3].mean(axis=0)
    return out


def vertex_bbox(mesh):
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return co.min(axis=0), co.max(axis=0)


def main():
    A = get_args()
    pal = Palette(A.palette)
    warnings = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=A.inp)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh imported")
    tris_in = 0
    default_lin = pal.color(A.default_color) if A.default_color in pal.names else pal.lin[0]

    # bake world transforms, drop parents, remember sampled colors (sample scheme only)
    for o in meshes:
        if A.scheme == "sample":
            write_corner_colors(o.data, sample_face_colors(o, default_lin))
        mw = o.matrix_world.copy()
        o.data.transform(mw)
        o.parent = None
        o.matrix_basis = Matrix.Identity(4)
        tris_in += tri_count(o.data)
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)

    obj = meshes[0]
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=obj, object=obj, selected_editable_objects=meshes, selected_objects=meshes):
            bpy.ops.object.join()
    mesh = obj.data
    obj.name = "asset"

    # merge by distance + recalc normals
    lo, hi = vertex_bbox(mesh)
    size = float(max(hi - lo))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=max(size * 1e-4, 1e-6))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()

    # decimate to the class budget
    tris = tri_count(mesh)
    decimated = False
    if A.tri_max and tris > A.tri_max:
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = max(0.02, A.tri_max / tris)
        dg = bpy.context.evaluated_depsgraph_get()
        new_mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        old = obj.data
        obj.modifiers.clear()
        obj.data = new_mesh
        bpy.data.meshes.remove(old)
        mesh = obj.data
        decimated = True
        tris = tri_count(mesh)
    if A.tri_min and tris < A.tri_min:
        warnings.append(f"tris {tris} below class minimum {A.tri_min}")

    # colors: scheme or sampled, then snap to palette
    lo, hi = vertex_bbox(mesh)
    nf = len(mesh.polygons)
    if A.scheme == "sample":
        face_lin = read_face_colors(mesh) if mesh.color_attributes.get("Col") else np.tile(default_lin, (nf, 1))
    else:
        face_lin = np.zeros((nf, 3))
        zrange = max(float(hi[2] - lo[2]), 1e-6)
        for i, p in enumerate(mesh.polygons):
            zf = (p.center.z - lo[2]) / zrange
            if A.scheme == "tree":
                name = "wood" if zf < 0.25 else ("moss" if zf > 0.8 else "forest")
            else:  # rock
                name = "rock" if p.normal.z > 0.45 else "rockDark"
            face_lin[i] = pal.color(name) if name in pal.names else default_lin
    idx = pal.snap(face_lin)
    snapped = pal.lin[idx]
    write_corner_colors(mesh, snapped)

    # one shared palette material fed by the color attribute
    mat = bpy.data.materials.new("palette")
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    mesh.materials.clear()
    mesh.materials.append(mat)
    for p in mesh.polygons:
        p.material_index = 0
    mesh.shade_flat()

    # uniform scale + pivot at base center
    lo, hi = vertex_bbox(mesh)
    ext = hi - lo
    if A.footprint:
        s = A.footprint / max(float(max(ext[0], ext[1])), 1e-6)
    elif A.height:
        s = A.height / max(float(ext[2]), 1e-6)
    else:
        s = 1.0
    off = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    M = Matrix.Scale(s, 4) @ Matrix.Translation((-off[0], -off[1], -off[2]))
    mesh.transform(M)
    mesh.update()
    lo, hi = vertex_bbox(mesh)

    # export
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=A.out, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_materials="EXPORT", export_vertex_color="ACTIVE", export_image_format="NONE",
        export_animations=False, export_cameras=False, export_lights=False)

    used = sorted(set(pal.names[i] for i in idx))
    rep = {
        "tris_in": tris_in, "tris_out": tri_count(mesh), "decimated": decimated, "scale": round(float(s), 5),
        "bounds_min": [round(float(v), 4) for v in lo], "bounds_max": [round(float(v), 4) for v in hi],
        "scheme": A.scheme, "palette_used": used, "warnings": warnings,
        "blender": bpy.app.version_string,
    }
    json.dump(rep, open(A.report, "w", encoding="utf-8"), indent=2)
    print("NORMALIZE_OK", json.dumps({"tris_out": rep["tris_out"], "size": [round(float(v), 3) for v in (hi - lo)]}))


main()

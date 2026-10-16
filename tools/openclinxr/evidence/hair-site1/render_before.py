"""Groom1 studio render: strand children under target2's studio rig.

Why a new file (not _blender_render.py): the scorer script carries the
v3-scorer light rig (3 suns + dark world, transparent-film IDs). The
card requires renders under the SAME lighting as the aisha-v3 source
renders (target2 RESULT: world solid mid-grey 0.5, 12 m light-grey
backdrop plane at y+2.2, key/fill/rim Area lights 100/40/60 W, film
opaque) so render and target are directly comparable. Body treatment
is also target2's: library hair topper removed (keeps brow/lash),
pink shirt override. Strand material is strands1's (Principled Hair
BSDF HUANG COLOR direct COLOR + look7 COLOR, Transmission 0.5).

Reads: --strands (E/strands.npz), --params (look7 best-params.json),
--cameras (pinned scorer-v3 manifest), --body-glb, --outdir, --opened.
Writes: outdir/{front,three_quarter,profile_90,back}.png (studio
beauty) + outdir/{view}-id.png (white-override strand-alpha IDs,
transparent film) + render-times.json.
Cycles 1024 px / 64 spp / seed 7 / OIDN, same as target2 sources.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

SIZE = 1024
SPP = 64
SEED = 7
HEAD_Z = 1.385
TRANSMISSION = 0.5
VIEWS = ("front", "three_quarter", "profile_90", "back")

# groom2 env hooks (defaults reproduce groom1 exactly):
# HAIR_SIZE / HAIR_SPP (fast colour-search renders), HAIR_VIEWS
# (comma subset), HAIR_ID_ONLY=1 (re-render groom1 IDs with the fixed
# pass without redoing beauties), HAIR_BEAUTY_ONLY=1 (colour search),
# HAIR_COLOR_SCALE (multiplies direct COLOR), HAIR_R / HAIR_TRT /
# HAIR_TT / HAIR_ROUGH (lobe/roughness overrides for the colour search).
import os as _os


def _env():
    size = int(_os.environ.get("HAIR_SIZE", str(SIZE)))
    spp = int(_os.environ.get("HAIR_SPP", str(SPP)))
    raw = _os.environ.get("HAIR_VIEWS", "")
    views = tuple(s for s in raw.split(",") if s) or VIEWS
    return size, spp, views


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--strands", required=True)
    p.add_argument("--params", required=True)
    p.add_argument("--cameras", required=True)
    p.add_argument("--body-glb", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--opened", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_body(glb, opened):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    opened.append(str(Path(glb).resolve()))
    imported = [o for o in bpy.data.objects if o not in before]
    removed = []
    for o in list(imported):
        low = o.name.lower()
        if o.type == "MESH" and "hair" in low and "brow" not in low \
                and "lash" not in low:
            removed.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    print("REMOVED_TOPPERS %s" % (sorted(removed),), flush=True)
    pink = bpy.data.materials.new("GROOM1_PINK_SHIRT")
    pink.use_nodes = True
    bsdf = pink.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.91, 0.55, 0.64, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    for o in bpy.data.objects:
        if o.type == "MESH" and "toigo_t_shirt" in o.name.lower():
            o.data.materials.clear()
            o.data.materials.append(pink)
            print("PINK_SHIRT %s" % o.name, flush=True)
    meshes = [o for o in bpy.data.objects
              if o.type == "MESH" and o.name not in removed]
    for o in meshes:
        if o.name.lower() == "icosphere":
            o.hide_render = True
            o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower()
            and not o.hide_render and "brow" not in o.name.lower()
            and "lash" not in o.name.lower()]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    vis = [o for o in meshes if not o.hide_render
           and o.name.lower() != "icosphere"]
    main = max(vis, key=lambda o: len(o.data.vertices))
    small = [o for o in vis if any(
        k in o.name.lower() for k in ("eyebrow", "eyelash", "teeth",
                                      "tongue"))]
    return main, vis, [o.name for o in small]


def make_head_proxy(main):
    import bmesh
    from mathutils import Vector
    mesh = main.data.copy()
    mw = main.matrix_world.copy()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    faces = list(bm.faces)
    keep = set()
    for f in faces:
        c = sum((vv.co for vv in f.verts), Vector((0, 0, 0))) / len(f.verts)
        if (mw @ c).z > HEAD_Z:
            keep.add(f.index)
    bmesh.ops.delete(bm, geom=[f for f in faces if f.index not in keep],
                     context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new("HEAD_holdout", mesh)
    bpy.context.scene.collection.objects.link(o)
    print("HEAD_PROXY faces=%d (z>%.3f of %s)" % (
        len(mesh.polygons), HEAD_Z, main.name), flush=True)
    return o


def build_strand_hair(points, radii, params):
    n, P, _ = points.shape
    data = bpy.data.hair_curves.new("OCLX_strandsG1")
    data.add_curves([P] * n)
    data.attributes["position"].data.foreach_set(
        "vector", np.ascontiguousarray(points, dtype=np.float32).ravel())
    if "radius" in data.attributes:
        data.attributes["radius"].data.foreach_set(
            "value", np.ascontiguousarray(radii, dtype=np.float32).ravel())
    else:
        attr = data.attributes.new("radius", "FLOAT", "POINT")
        attr.data.foreach_set(
            "value", np.ascontiguousarray(radii, dtype=np.float32).ravel())
    obj = bpy.data.objects.new("OCLX_strandsG1", data)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("OCLX_strandG1_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfHairPrincipled")
    bsdf.model = "HUANG"
    bsdf.parametrization = "COLOR"
    s = {x.identifier: x for x in bsdf.inputs}
    dc = params["directColorLinear"]
    s["Color"].default_value = (float(dc[0]), float(dc[1]),
                                 float(dc[2]), 1.0)
    # groom2 colour-search overrides (env; defaults = params file).
    _rgb = _os.environ.get("HAIR_COLOR_RGB", "")
    if _rgb:
        _c = [float(x) for x in _rgb.split(",")]
        s["Color"].default_value = (_c[0], _c[1], _c[2], 1.0)
    else:
        s["Color"].default_value = tuple(
            float(c) * float(_os.environ.get("HAIR_COLOR_SCALE", "1.0"))
            for c in s["Color"].default_value[:3]) + (1.0,)
    s["R lobe"].default_value = float(
        _os.environ.get("HAIR_R", str(s["R lobe"].default_value)))
    s["TRT lobe"].default_value = float(
        _os.environ.get("HAIR_TRT", str(s["TRT lobe"].default_value)))
    s["Roughness"].default_value = float(
        _os.environ.get("HAIR_ROUGH",
                        str(s["Roughness"].default_value)))
    s["TT lobe"].default_value = float(
        _os.environ.get("HAIR_TT", str(TRANSMISSION)))
    if "Random" in s:
        s["Random"].default_value = float(params.get("random", 0.0))
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    data.materials.append(mat)
    rec = {"model": str(bsdf.model),
           "parametrization": str(bsdf.parametrization),
           "Color": [float(x) for x in s["Color"].default_value],
           "R lobe": float(s["R lobe"].default_value),
           "TRT lobe": float(s["TRT lobe"].default_value),
           "TT lobe": float(s["TT lobe"].default_value),
           "Roughness": float(s["Roughness"].default_value)}
    obj.update_tag()
    bpy.context.view_layer.update()
    print("HAIR curves=%d pts=%d" % (n, P), flush=True)
    return obj, rec


def setup_studio():
    """target2 make_sources rig verbatim (stated values)."""
    bpy.ops.mesh.primitive_plane_add(size=12.0, location=(0.0, 2.2, 1.0))
    backdrop = bpy.context.active_object
    backdrop.rotation_euler[0] = 0.0
    bmat = bpy.data.materials.new("GROOM1_BACKDROP")
    bmat.use_nodes = True
    bbsdf = bmat.node_tree.nodes["Principled BSDF"]
    bbsdf.inputs["Base Color"].default_value = (0.72, 0.72, 0.74, 1.0)
    bbsdf.inputs["Roughness"].default_value = 1.0
    backdrop.data.materials.append(bmat)

    def area(name, loc, energy, size=2.0):
        bpy.ops.object.light_add(type="AREA", location=loc)
        lamp = bpy.context.active_object
        lamp.name = name
        lamp.data.energy = energy
        lamp.data.size = size
        lamp.data.color = (1.0, 1.0, 1.0)
        return lamp

    area("KEY", (-1.5, -2.0, 2.2), 100.0)
    area("FILL", (1.5, -2.0, 1.8), 40.0)
    area("RIM", (0.0, 2.0, 2.6), 60.0, size=1.5)
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("WORLD")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs["Strength"].default_value = 1.0


def setup_cycles():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SPP
    sc.cycles.seed = SEED
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"


def main():
    t_all = time.time()
    args = cli()
    opened = [str(Path(__file__).resolve())]
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cams = json.loads(Path(args.cameras).read_text())
    opened.append(str(Path(args.cameras).resolve()))
    params = json.loads(Path(args.params).read_text())
    opened.append(str(Path(args.params).resolve()))
    color = params["params"] if "params" in params else params

    main_body, vis, small_names = load_body(Path(args.body_glb), opened)
    small_objs = [bpy.data.objects[n] for n in small_names]

    doc = np.load(args.strands, allow_pickle=True)
    opened.append(str(Path(args.strands).resolve()))
    points = np.asarray(doc["points"], dtype=np.float64)
    radii = np.asarray(doc["radii"], dtype=np.float64)
    hair, mat_rec = build_strand_hair(points, radii, color)
    proxy = make_head_proxy(main_body)

    setup_studio()
    setup_cycles()
    size, spp, views_sel = _env()
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.cycles.samples = spp
    cam_data = bpy.data.cameras.new("GROOM1_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("GROOM1_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    views = {}
    for v in VIEWS:
        rec = cams["views"][v]
        views[v] = (Matrix(rec["matrixWorld"]), float(rec["lensMm"]))

    times = {}
    sc = bpy.context.scene
    def set_body(mode):
        for o in bpy.data.objects:
            if o.type != "MESH":
                continue
            n = o.name.lower()
            if n == "icosphere" or "groom1_backdrop" in n:
                o.hide_render = (mode == "holdout")
                continue
            if o.name == "HEAD_holdout":
                # groom2: the full body is the holdout in ID mode, so
                # the head proxy is redundant there (hidden); beauty
                # mode unchanged (proxy hidden, body visible).
                o.hide_render = True
                o.is_holdout = False
                continue
            elif o in small_objs:
                o.hide_render = (mode != "beauty")
                o.is_holdout = (mode == "holdout")
            else:
                # groom2: in ID mode the whole body renders as a
                # holdout (occludes hair behind it) so the ID pass
                # matches what the camera sees. groom1 hid the torso
                # (no holdout), so hair hidden behind the chest still
                # wrote ID alpha -- the 160 px front 'excess' on the
                # chest. Beauty mode unchanged (body visible).
                if mode == "holdout":
                    o.hide_render = False
                    o.is_holdout = True
                else:
                    o.hide_render = False
                    o.is_holdout = False

    def beauty(name, mat, lens):
        cam.matrix_world = mat
        cam_data.lens = lens
        bpy.context.view_layer.update()
        set_body("beauty")
        hair.hide_render = False
        sc.render.film_transparent = False
        sc.render.image_settings.color_mode = "RGB"
        bpy.context.view_layer.material_override = None
        t0 = time.time()
        sc.render.filepath = str(outdir / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        times[name] = round(time.time() - t0, 1)
        opened.append(str((outdir / (name + ".png")).resolve()))
        print("RENDER %s %.1fs" % (name, times[name]), flush=True)

    skip_beauty = _os.environ.get("HAIR_ID_ONLY", "") == "1"
    skip_id = _os.environ.get("HAIR_BEAUTY_ONLY", "") == "1"

    if not skip_beauty:
        for v in VIEWS:
            if v in views_sel:
                beauty(v, *views[v])

    wmat = bpy.data.materials.new("ID_white")
    wmat.use_nodes = True
    wmat.node_tree.nodes.clear()
    wout = wmat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    wbsdf = wmat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    wbsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    wbsdf.inputs["Roughness"].default_value = 1.0
    wmat.node_tree.links.new(wbsdf.outputs["BSDF"], wout.inputs["Surface"])

    def idpass(name, view):
        cam.matrix_world, cam_data.lens = views[view][0], views[view][1]
        bpy.context.view_layer.update()
        set_body("holdout")
        hair.hide_render = False
        bpy.context.view_layer.material_override = wmat
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = "RGBA"
        t0 = time.time()
        sc.render.filepath = str(outdir / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        times[name] = round(time.time() - t0, 1)
        opened.append(str((outdir / (name + ".png")).resolve()))
        print("RENDER %s %.1fs" % (name, times[name]), flush=True)

    if not skip_id:
        for v in VIEWS:
            if v in views_sel:
                idpass(v + "-id", v)

    (outdir / "render-times.json").write_text(
        json.dumps({"seconds": times,
                    "total": round(time.time() - t_all, 1),
                    "size": size, "spp": spp, "seed": SEED,
                    "views": list(views_sel),
                    "idBodyHoldout": True,
                    "envOverrides": {
                        k: _os.environ.get(k, "")
                        for k in ("HAIR_COLOR_SCALE", "HAIR_R",
                                  "HAIR_TRT", "HAIR_TT", "HAIR_ROUGH")},
                    "engine": "CYCLES-CPU",
                    "material": mat_rec,
                    "transmissionNote": "TT lobe 0.5 per card; look7 "
                                        "lobe_T recorded in params, unused",
                    "rig": "target2 studio rig verbatim: world 0.5 grey, "
                           "12m backdrop (0.72,0.72,0.74) at y+2.2, Area "
                           "key 100W/2m front-left, fill 40W/2m "
                           "front-right, rim 60W/1.5m behind-top, film "
                           "opaque (beauty)",
                    "relitNote": "none (studio rig only)"},
                   indent=2, sort_keys=True) + "\n")
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("STUDIO_RENDER_DONE total=%.1fs" % (time.time() - t_all),
          flush=True)


if __name__ == "__main__":
    main()

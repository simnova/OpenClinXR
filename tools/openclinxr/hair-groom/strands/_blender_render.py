"""S9 STEP 4 (Blender): render frame-transport strand children.

Reads (all via CLI args): E/strands.npz (points/radii, metres), the
look7 direct-COLOR params (read-only), the pinned v3-scorer camera
manifest (read-only), the body GLB (library topper hidden).
Writes: E/renders/*.png (7 beauty: 4 pinned + held-out + relit +
crown_top coverage view; 5 holdout ID: 4 pinned + crown_top),
E/renders/render-times.json, E/blender-opened.txt.

Hair material: Cycles Principled Hair BSDF, model HUANG,
parametrization COLOR, Color = directColorLinear verbatim (same
convention as the v3 scorer), R lobe = reflection, TRT lobe =
secondaryReflection, Roughness = roughness, Transmission = 0.5 (card
stated; the look7 lobe_T 0.968 is recorded but not used), Random =
best random. Denoise OIDN like the shell lane for comparability.

Light rig: v3-scorer rig geometry from the rig1 search-best record
(key elev/azimuth below), exposure-matched sun energies 5.0/1.0/1.5
and world 0.03 identical to the shell lane (comparability is the
point). Stated: rig geometry = key el 28.995 deg / key daz -34.262
deg; energies are the shell-lane exposure match, not scorer joules.

ID passes: head-holdout IDs (HEAD_holdout proxy = body faces with
world z > 1.385 m + brow/lash/teeth/tongue objects, is_holdout=True,
white override, transparent film): skin visible through strand gaps
counts as NOT hair.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

SIZE = 1024
SPP = 64
SEED = 7
HEAD_Z = 1.385

KEY_EL_DEG = 28.995110058505865
KEY_DAZ_DEG = -34.261880624326544
KEY_ENERGY, FILL_ENERGY, RIM_ENERGY = 5.0, 1.0, 1.5
FILL_SUN = (-0.5, -0.4, 0.35)
RIM_SUN = (0.0, 0.8, 0.5)
TRANSMISSION = 0.5


def key_sun_vec():
    el = math.radians(KEY_EL_DEG)
    daz = math.radians(KEY_DAZ_DEG)
    return (math.sin(daz) * math.cos(el),
            -math.cos(daz) * math.cos(el), math.sin(el))


KEY_SUN = key_sun_vec()


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
    imported = sorted([o for o in bpy.data.objects if o not in before],
                      key=lambda o: o.name)
    meshes = [o for o in imported if o.type == "MESH"]
    topper = [o for o in meshes if "library" in o.name.lower()
              and "hair" in o.name.lower()]
    if not topper:
        raise RuntimeError("ASSERT FAIL: no library hair topper to exclude")
    for o in topper:
        o.hide_render = True
        o.hide_viewport = True
    for o in meshes:
        if o.name.lower() == "icosphere":
            o.hide_render = True
            o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower()
            and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    vis = [o for o in meshes if not o.hide_render
           and o.name.lower() != "icosphere"]
    main = max(vis, key=lambda o: len(o.data.vertices))
    small = [o for o in vis if any(
        k in o.name.lower() for k in ("eyebrow", "eyelash", "teeth", "tongue"))]
    return main, vis, sorted(o.name for o in topper), [o.name for o in small]


def make_head_proxy(main):
    import bmesh
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
    data = bpy.data.hair_curves.new("OCLX_strands9")
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
    obj = bpy.data.objects.new("OCLX_strands9", data)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("OCLX_strand9_mat")
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
    s["R lobe"].default_value = float(params["reflection"])
    s["TRT lobe"].default_value = float(params["secondaryReflection"])
    s["Roughness"].default_value = float(params["roughness"])
    s["TT lobe"].default_value = TRANSMISSION
    if "Random" in s:
        s["Random"].default_value = float(params.get("random", 0.0))
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    data.materials.append(mat)
    # Read-back record (node truth).
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


def setup_lights(key_vec):
    for name in ("KEY", "FILL", "RIM"):
        d = bpy.data.lights.new(name=name, type="SUN")
        o = bpy.data.objects.new(name, d)
        bpy.context.scene.collection.objects.link(o)
    bpy.data.objects["KEY"].data.energy = KEY_ENERGY
    bpy.data.objects["FILL"].data.energy = FILL_ENERGY
    bpy.data.objects["RIM"].data.energy = RIM_ENERGY
    for o in bpy.data.objects:
        if o.type == "LIGHT":
            o.data.use_shadow = (o.name == "KEY")
    key = Vector(key_vec).normalized()
    bpy.data.objects["KEY"].rotation_euler = key.to_track_quat(
        "-Z", "Y").to_euler()
    kf = Vector(FILL_SUN).normalized()
    bpy.data.objects["FILL"].rotation_euler = kf.to_track_quat(
        "-Z", "Y").to_euler()
    kr = Vector(RIM_SUN).normalized()
    bpy.data.objects["RIM"].rotation_euler = kr.to_track_quat(
        "-Z", "Y").to_euler()
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("WORLD")
        bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.03, 0.03, 0.03, 1.0)
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
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"


def lookat_matrix(loc, target):
    fwd = (target - loc).normalized()
    z = -fwd
    up = Vector((0, 0, 1))
    x = (up.cross(z)).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x, loc.x),
                   (x.y, y.y, z.y, loc.y),
                   (x.z, y.z, z.z, loc.z),
                   (0, 0, 0, 1)))


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

    main_body, vis, topper_names, small_names = load_body(
        Path(args.body_glb), opened)
    small_objs = [bpy.data.objects[n] for n in small_names]
    enum_pts = list(enumerate(
        [main_body.matrix_world @ v.co for v in main_body.data.vertices]))
    bi = max(enum_pts, key=lambda t: (t[1].z, -t[0]))[0]
    crown = enum_pts[bi][1]
    crown_z = float(crown.z)
    xs = [p.x for _, p in enum_pts]
    cx = (min(xs) + max(xs)) * 0.5
    target = Vector((float(cx), 0.0, crown_z - 0.12))

    doc = np.load(args.strands, allow_pickle=True)
    opened.append(str(Path(args.strands).resolve()))
    points = np.asarray(doc["points"], dtype=np.float64)
    radii = np.asarray(doc["radii"], dtype=np.float64)
    hair, mat_rec = build_strand_hair(points, radii, color)
    proxy = make_head_proxy(main_body)

    setup_lights(KEY_SUN)
    setup_cycles()
    cam_data = bpy.data.cameras.new("STRANDS9_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("STRANDS9_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    views = {}
    for v in ("front", "three_quarter", "profile_90", "back", "crown_top"):
        rec = cams["views"][v]
        views[v] = (Matrix(rec["matrixWorld"]), float(rec["lensMm"]))
    F = np.array(cams["views"]["front"]["location"], float)
    Q = np.array(cams["views"]["three_quarter"]["location"], float)
    ang = (math.atan2(F[1], F[0]) + math.atan2(Q[1], Q[0])) / 2.0
    rad = (float(np.hypot(F[0], F[1])) + float(np.hypot(Q[0], Q[1]))) / 2.0
    Hz = float((F[2] + Q[2]) / 2.0)
    H = Vector((rad * math.cos(ang), rad * math.sin(ang), Hz))
    views["heldout_22p5"] = (lookat_matrix(H, target), 50.0)

    times = {}
    sc = bpy.context.scene

    def set_body(mode):
        for o in bpy.data.objects:
            if o.type != "MESH":
                continue
            n = o.name.lower()
            if (("library" in n and "hair" in n) or n == "icosphere"):
                o.hide_render = True
                continue
            if o.name == "HEAD_holdout":
                o.hide_render = (mode != "holdout")
                o.is_holdout = (mode == "holdout")
            elif o in small_objs:
                o.hide_render = (mode != "beauty")
                o.is_holdout = (mode == "holdout")
            else:
                o.hide_render = (mode != "beauty")

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

    for v in ("front", "three_quarter", "profile_90", "back", "heldout_22p5",
               "crown_top"):
        beauty(v, *views[v])
    kx, ky, kz = KEY_SUN
    a = math.radians(40.0)
    key2 = (kx * math.cos(a) - ky * math.sin(a),
            kx * math.sin(a) + ky * math.cos(a), kz)
    kv = Vector(key2).normalized()
    bpy.data.objects["KEY"].rotation_euler = kv.to_track_quat(
        "-Z", "Y").to_euler()
    beauty("front-relit", *views["front"])

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

    for v in ("front", "three_quarter", "profile_90", "back", "crown_top"):
        idpass(v + "-id", v)

    (outdir / "render-times.json").write_text(
        json.dumps({"seconds": times,
                    "total": round(time.time() - t_all, 1),
                    "size": SIZE, "spp": SPP, "seed": SEED,
                    "engine": "CYCLES-CPU",
                    "material": mat_rec,
                    "transmissionNote": "TT lobe 0.5 per card; look7 "
                                        "lobe_T recorded in params, unused",
                    "keySun": list(KEY_SUN),
                    "keyAngles": {"elDeg": KEY_EL_DEG,
                                  "dazDeg": KEY_DAZ_DEG},
                    "keyEnergy": KEY_ENERGY, "fillEnergy": FILL_ENERGY,
                    "rimEnergy": RIM_ENERGY,
                    "relitNote": "front-relit: key azimuth +40 deg"},
                   indent=2, sort_keys=True) + "\n")
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("BUILD_RENDER_DONE total=%.1fs" % (time.time() - t_all), flush=True)


if __name__ == "__main__":
    main()

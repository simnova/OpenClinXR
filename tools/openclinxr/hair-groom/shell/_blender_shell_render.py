"""S8 STEP 3b+4 (Blender): shade the shell, export shell.glb, render.

Reads: E/shell.npz (outer verts/faces/flow-UV), E/textures/*.png,
look7 best-params.json (direct COLOR, read-only), pinned scorer-v3
cameras, body GLB mpfb-peds-parent-aisha.glb (topper hidden).
Writes: E/shell.glb, E/renders/*.png (6 beauty + 4 ID),
E/renders/render-times.json, E/body-geo.npz (rulers fixtures),
E/blender-opened-render.txt.

Material (Cycles Principled BSDF; Blender exposes no strand BSDF for
meshes): Anisotropic 0.6, rotation = flowR - 0.25 (same base
quarter-turn as cards0: default U tangent onto the V strand axis);
alpha = atlas A x facing-ratio edge fade (Layer Weight Facing, 1 =
facing camera, 0 = grazing; smoothstep 0.05..0.50 -> 0..1, so the
silhouette is an alpha-edged fade, not a hard helmet edge); base =
atlasRGB x root-tip gradient x sRGB(directColorLinear) x EXPOSURE_GAIN;
0.3 Translucent mix for backlight; roughness fixed 0.40 (no cardRand on
a shell); double-sided (no backface culling: the rind boundary has two
walls). No target photo is projected anywhere: appearance is procedural
from the shape + flow UVs.

Light rig: key direction from the scorer rig block
(hair-score/rig_params.json rig: key_elev 28.995 deg, key_daz -34.262
deg; convention stated here: az from the front (-Y) axis toward +X,
elev above horizon; toward-sun = (sin daz * cos el, -cos daz * cos el,
sin el)). Fill/rim directions are cards0's (the rig block gives no
fill/rim direction). Energies are EXPOSURE-MATCHED (key 5.0 / fill 1.0
/ rim 1.5; cards0 3.0/0.5/1.0 raised because the direct color reads
near-black under the key rig): the rig block's 132/51/12 values belong
to its look-dev light model and are NOT transferred as sun energies.

Views: four pinned scorer-v3 cameras at 1024 px / 64 spp Cycles CPU
seed 7, one computed held-out (az 22.5 deg between front and
three_quarter), one relit front (key azimuth +40 deg). ID passes (four
scorer views): shell only, white override, transparent film.
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
EXPOSURE_GAIN = 2.2

# scorer rig block angles (hair-score/rig_params.json rig)
KEY_EL_DEG = 28.995110058505865
KEY_DAZ_DEG = -34.261880624326544
KEY_ENERGY, FILL_ENERGY, RIM_ENERGY = 5.0, 1.0, 1.5
FILL_SUN = (-0.5, -0.4, 0.35)  # cards0 (rig block gives no fill/rim dir)
RIM_SUN = (0.0, 0.8, 0.5)


def key_sun_vec():
    el = math.radians(KEY_EL_DEG)
    daz = math.radians(KEY_DAZ_DEG)
    return (math.sin(daz) * math.cos(el),
            -math.cos(daz) * math.cos(el), math.sin(el))


KEY_SUN = key_sun_vec()


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--shell", required=True)
    p.add_argument("--glb-out", required=True)
    p.add_argument("--body-glb", required=True)
    p.add_argument("--body-geo-out", required=True)
    p.add_argument("--texdir", required=True)
    p.add_argument("--cameras", required=True)
    p.add_argument("--params", required=True)
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


def srgb(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1.0 / 2.4) - 0.055


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
    env = [o for o in meshes if o.name.lower() == "icosphere"]
    for o in env:
        o.hide_render = True
        o.hide_viewport = True
    if [o.name for o in meshes if "hair" in o.name.lower()
            and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    vis = [o for o in meshes
           if not o.hide_render and o not in env]
    main = max([o for o in vis if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    return main, vis, sorted(o.name for o in topper)


def dump_body_geo(keep, out, body_sha, topper_names):
    vall, tall, tmesh, names = [], [], [], []
    for mi, o in enumerate(sorted(keep, key=lambda o: o.name)):
        M = o.matrix_world
        v = np.array([M @ vc.co for vc in o.data.vertices],
                     dtype=np.float64)
        o.data.calc_loop_triangles()
        t = np.array([tuple(vv for vv in tr.vertices)
                      for tr in o.data.loop_triangles], dtype=np.int64)
        off = sum(len(vv) for vv in vall)
        vall.append(v)
        tall.append(t + off)
        tmesh.append(np.full(len(t), mi, dtype=np.int64))
        names.append(o.name)
    verts = np.ascontiguousarray(np.vstack(vall))
    tris = np.ascontiguousarray(np.vstack(tall))
    tri_mesh = np.ascontiguousarray(np.concatenate(tmesh))
    garments = ("pants", "shirt", "shoe")
    clear = np.array([0 if any(g in n.lower() for g in garments) else 1
                      for n in names], dtype=np.int64)
    np.savez(str(out), verts=verts, tris=tris, triMesh=tri_mesh,
             clearGroup=np.ascontiguousarray(clear[tri_mesh]),
             meshNames=np.array(names),
             topperHidden=np.array(sorted(topper_names)),
             bodySha256=np.array(body_sha))
    print("BODY_GEO meshes=%d verts=%d tris=%d" % (
        len(keep), len(verts), len(tris)), flush=True)


def build_shell(npz_path, texdir, hair_rgb, opened):
    z = np.load(npz_path)
    opened.append(str(Path(npz_path).resolve()))
    verts = z["verts"].astype(float)
    faces = z["faces"].astype(int)
    uv = z["uv"].astype(float)
    mesh = bpy.data.meshes.new("SHELL_mesh")
    mesh.from_pydata([tuple(v) for v in verts], [],
                     [tuple(int(i) for i in f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new("SHELL", mesh)
    bpy.context.scene.collection.objects.link(obj)
    # flow UVs over the FULL strand maps (cards0 used atlas quadrants;
    # a shell has no card cells): U = u, V = 1 - v (image row 0 = root).
    uv_layer = mesh.uv_layers.new(name="ShellFlow")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = int(mesh.loops[li].vertex_index)
            uv_layer.data[li].uv = (float(uv[vi, 0]),
                                    1.0 - float(uv[vi, 1]))
    mesh.update()
    mat = bpy.data.materials.new("SHELL_mat")
    mat.use_nodes = True
    mat.blend_method = "HASHED"
    if hasattr(mat, "shadow_method"):
        mat.shadow_method = "HASHED"
    mat.use_backface_culling = False
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    princ = tree.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Metallic"].default_value = 0.0
    princ.inputs["Roughness"].default_value = 0.40
    princ.inputs["Anisotropic"].default_value = 0.6
    trans = tree.nodes.new("ShaderNodeBsdfTranslucent")
    mix = tree.nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.3
    tex_atlas = tree.nodes.new("ShaderNodeTexImage")
    tex_atlas.image = bpy.data.images.load(str(texdir / "strand-atlas.png"))
    tex_atlas.image.colorspace_settings.name = "sRGB"
    tex_flow = tree.nodes.new("ShaderNodeTexImage")
    tex_flow.image = bpy.data.images.load(str(texdir / "flow-map.png"))
    tex_flow.image.colorspace_settings.name = "Non-Color"
    tex_grad = tree.nodes.new("ShaderNodeTexImage")
    tex_grad.image = bpy.data.images.load(str(texdir / "root-tip-gradient.png"))
    tex_grad.image.colorspace_settings.name = "Non-Color"
    for t in (tex_atlas, tex_flow, tex_grad):
        t.extension = "CLIP"
        um = tree.nodes.new("ShaderNodeUVMap")
        um.uv_map = "ShellFlow"
        tree.links.new(um.outputs["UV"], t.inputs["Vector"])
    opened.append(str((texdir / "strand-atlas.png").resolve()))
    opened.append(str((texdir / "flow-map.png").resolve()))
    opened.append(str((texdir / "root-tip-gradient.png").resolve()))
    sep = tree.nodes.new("ShaderNodeSeparateColor")
    tree.links.new(tex_flow.outputs["Color"], sep.inputs["Color"])
    rot = tree.nodes.new("ShaderNodeMath")
    rot.operation = "ADD"
    tree.links.new(sep.outputs["Red"], rot.inputs[0])
    rot.inputs[1].default_value = -0.25
    tree.links.new(rot.outputs["Value"], princ.inputs["Anisotropic Rotation"])
    # alpha = atlas A x facing-ratio edge fade (silhouette soft edge)
    facing = tree.nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    eramp = tree.nodes.new("ShaderNodeMapRange")
    eramp.data_type = "FLOAT"
    eramp.interpolation_type = "SMOOTHSTEP"
    eramp.inputs["From Min"].default_value = 0.05
    eramp.inputs["From Max"].default_value = 0.50
    eramp.inputs["To Min"].default_value = 0.0
    eramp.inputs["To Max"].default_value = 1.0
    tree.links.new(facing.outputs["Facing"], eramp.inputs["Value"])
    amul = tree.nodes.new("ShaderNodeMath")
    amul.operation = "MULTIPLY"
    tree.links.new(tex_atlas.outputs["Alpha"], amul.inputs[0])
    tree.links.new(eramp.outputs["Result"], amul.inputs[1])
    tree.links.new(amul.outputs["Value"], princ.inputs["Alpha"])
    # base = atlasRGB x gradient x sRGB(direct) x exposure gain
    mul1 = tree.nodes.new("ShaderNodeVectorMath")
    mul1.operation = "MULTIPLY"
    tree.links.new(tex_atlas.outputs["Color"], mul1.inputs[0])
    mul1.inputs[1].default_value = hair_rgb[:3]
    mul2 = tree.nodes.new("ShaderNodeVectorMath")
    mul2.operation = "MULTIPLY"
    tree.links.new(mul1.outputs["Vector"], mul2.inputs[0])
    tree.links.new(tex_grad.outputs["Color"], mul2.inputs[1])
    tree.links.new(mul2.outputs["Vector"], princ.inputs["Base Color"])
    tree.links.new(mul2.outputs["Vector"], trans.inputs["Color"])
    tree.links.new(princ.outputs["BSDF"], mix.inputs[1])
    tree.links.new(trans.outputs["BSDF"], mix.inputs[2])
    tree.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mesh.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


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
    bpy.data.objects["KEY"].rotation_euler = key.to_track_quat("-Z", "Y").to_euler()
    kf = Vector(FILL_SUN).normalized()
    bpy.data.objects["FILL"].rotation_euler = kf.to_track_quat("-Z", "Y").to_euler()
    kr = Vector(RIM_SUN).normalized()
    bpy.data.objects["RIM"].rotation_euler = kr.to_track_quat("-Z", "Y").to_euler()
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
    M = Matrix(((x.x, y.x, z.x, loc.x),
                (x.y, y.y, z.y, loc.y),
                (x.z, y.z, z.z, loc.z),
                (0, 0, 0, 1)))
    return M


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
    dc = params["params"]["directColorLinear"]
    hair_rgb = (min(1.0, srgb(dc[0]) * EXPOSURE_GAIN),
                min(1.0, srgb(dc[1]) * EXPOSURE_GAIN),
                min(1.0, srgb(dc[2]) * EXPOSURE_GAIN), 1.0)
    print("HAIR_RGB sRGBx%.1f=%.4f %.4f %.4f from linear=[%.6f %.6f %.6f]" % (
        EXPOSURE_GAIN, hair_rgb[0], hair_rgb[1], hair_rgb[2],
        dc[0], dc[1], dc[2]), flush=True)
    print("KEY_SUN toward=%s energies=%.1f/%.1f/%.1f (scorer rig angles "
          "el=%.2f daz=%.2f; exposure-matched)" % (
              [round(float(x), 3) for x in KEY_SUN],
              KEY_ENERGY, FILL_ENERGY, RIM_ENERGY,
              KEY_EL_DEG, KEY_DAZ_DEG), flush=True)

    main_body, vis, topper_names = load_body(Path(args.body_glb), opened)
    enum_pts = list(enumerate(
        [main_body.matrix_world @ v.co for v in main_body.data.vertices]))
    bi = max(enum_pts, key=lambda t: (t[1].z, -t[0]))[0]
    crown = enum_pts[bi][1]
    crown_z = float(crown.z)
    xs = [p.x for _, p in enum_pts]
    cx = (min(xs) + max(xs)) * 0.5
    target = Vector((float(cx), 0.0, crown_z - 0.12))
    print("CROWN z=%.5f cx=%.5f" % (crown_z, cx), flush=True)

    shell_obj = build_shell(Path(args.shell), Path(args.texdir),
                            hair_rgb, opened)
    dump_body_geo(vis, Path(args.body_geo_out),
                  sha256(args.body_glb), topper_names)
    opened.append(str(Path(args.body_geo_out).resolve()))

    glb_path = Path(args.glb_out)
    bpy.ops.object.select_all(action="DESELECT")
    shell_obj.select_set(True)
    bpy.context.view_layer.objects.active = shell_obj
    bpy.ops.export_scene.gltf(filepath=str(glb_path),
                              export_format="GLB", use_selection=True)
    opened.append(str(glb_path.resolve()))
    print("SHELL_GLB bytes=%d" % glb_path.stat().st_size, flush=True)

    setup_lights(KEY_SUN)
    setup_cycles()
    cam_data = bpy.data.cameras.new("SHELL_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("SHELL_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    views = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        rec = cams["views"][v]
        views[v] = (Matrix(rec["matrixWorld"]), float(rec["lensMm"]))
    F = np.array(cams["views"]["front"]["location"], float)
    Q = np.array(cams["views"]["three_quarter"]["location"], float)
    ang = (math.atan2(F[1], F[0]) + math.atan2(Q[1], Q[0])) / 2.0
    rad = (float(np.hypot(F[0], F[1])) + float(np.hypot(Q[0], Q[1]))) / 2.0
    Hz = float((F[2] + Q[2]) / 2.0)
    H = Vector((rad * math.cos(ang), rad * math.sin(ang), Hz))
    views["heldout_22p5"] = (lookat_matrix(H, target), 50.0)
    print("HELDOUT loc=%s" % ([round(float(x), 4) for x in H]), flush=True)

    times = {}
    sc = bpy.context.scene

    def beauty(name, mat, lens):
        cam.matrix_world = mat
        cam_data.lens = lens
        bpy.context.view_layer.update()
        sc.render.film_transparent = False
        sc.render.image_settings.color_mode = "RGB"
        bpy.context.view_layer.material_override = None
        for o in bpy.data.objects:
            if o.type == "MESH" and "SHELL" not in o.name:
                n = o.name.lower()
                o.hide_render = (("library" in n and "hair" in n)
                                 or n == "icosphere")
        t0 = time.time()
        sc.render.filepath = str(outdir / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        times[name] = round(time.time() - t0, 1)
        opened.append(str((outdir / (name + ".png")).resolve()))
        print("RENDER %s %.1fs" % (name, times[name]), flush=True)

    for v in ("front", "three_quarter", "profile_90", "back", "heldout_22p5"):
        beauty(v, *views[v])
    kx, ky, kz = KEY_SUN
    a = math.radians(40.0)
    key2 = (kx * math.cos(a) - ky * math.sin(a),
            kx * math.sin(a) + ky * math.cos(a), kz)
    kv = Vector(key2).normalized()
    bpy.data.objects["KEY"].rotation_euler = kv.to_track_quat("-Z", "Y").to_euler()
    print("RELIT key=%s" % ([round(float(x), 3) for x in kv]), flush=True)
    beauty("front-relit", *views["front"])

    for o in bpy.data.objects:
        if o.type == "MESH" and "SHELL" not in o.name:
            o.hide_render = True
    wmat = bpy.data.materials.new("ID_white")
    wmat.use_nodes = True
    wmat.node_tree.nodes.clear()
    wout = wmat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    wbsdf = wmat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    wbsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    wbsdf.inputs["Roughness"].default_value = 1.0
    wmat.node_tree.links.new(wbsdf.outputs["BSDF"], wout.inputs["Surface"])
    bpy.context.view_layer.material_override = wmat
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    for v in ("front", "three_quarter", "profile_90", "back"):
        cam.matrix_world, cam_data.lens = views[v][0], views[v][1]
        bpy.context.view_layer.update()
        t0 = time.time()
        sc.render.filepath = str(outdir / (v + "-id.png"))
        bpy.ops.render.render(write_still=True)
        times[v + "-id"] = round(time.time() - t0, 1)
        opened.append(str((outdir / (v + "-id.png")).resolve()))
        print("RENDER %s-id %.1fs" % (v, times[v + "-id"]), flush=True)

    (outdir / "render-times.json").write_text(
        json.dumps({"seconds": times,
                    "total": round(time.time() - t_all, 1),
                    "size": SIZE, "spp": SPP, "seed": SEED,
                    "engine": "CYCLES-CPU",
                    "keySun": list(KEY_SUN),
                    "keyAngles": {"elDeg": KEY_EL_DEG,
                                  "dazDeg": KEY_DAZ_DEG},
                    "keyEnergy": KEY_ENERGY, "fillEnergy": FILL_ENERGY,
                    "rimEnergy": RIM_ENERGY,
                    "exposureGain": EXPOSURE_GAIN,
                    "relitNote": "front-relit: key azimuth +40 deg"},
                   indent=2, sort_keys=True) + "\n")
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("BUILD_RENDER_DONE total=%.1fs" % (time.time() - t_all),
          flush=True)


if __name__ == "__main__":
    main()

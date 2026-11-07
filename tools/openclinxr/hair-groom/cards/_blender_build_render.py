"""Build the card mesh, shade it, export cards.glb, render beauty + ID.

Runs inside Blender background mode. Reads: cards.npz, textures/*.png,
the L7 best-params.json (direct COLOR values, read-only), the pinned
cameras file, the body GLB. Writes: E/cards.glb, E/renders/*.png (6
beauty + 4 ID), E/render-times.json, E/blender-opened-render.txt.

Material (Cycles, stated): Principled BSDF (Blender exposes no strand
BSDF for meshes) with Anisotropic 0.6, rotation = 0.25 + (flowR - 0.5) *
0.2 (0.25 turns the default U-aligned shading tangent onto the V strand
axis; flow tilt modulates it), alpha from the strand atlas (blend +
shadow HASHED), base color = atlas value x root-tip gradient x the L7
direct color converted linear -> sRGB, plus a 0.3 Translucent mix for
backlight. Double-sided cards (Cycles shades both faces).

Views: the four pinned scorer-v3 cameras at 1024 px / 64 spp, one
computed held-out camera (azimuth 22.5 deg between front and
three_quarter, same radius/height mean, lookAt the station target), and
one relit front (key sun azimuth +40 deg). ID passes (four scorer views)
use a white override material on transparent film: alpha = coverage.
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

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-cards0")
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2")
GROOM = ROOT / "tools/openclinxr/hair-groom"
SIZE = 1024
SPP = 64
SEED = 7

KEY_SUN = (0.5, -0.6, 0.9)  # toward-sun vector, base rig (stated)
FILL_SUN = (-0.5, -0.4, 0.35)
RIM_SUN = (0.0, 0.8, 0.5)


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--cards", required=True)
    p.add_argument("--glb", required=True)
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
    for o in meshes:
        n = o.name.lower()
        if ("library" in n and "hair" in n) or n == "icosphere":
            o.hide_render = True
            o.hide_viewport = True
    vis = [o for o in meshes if not o.hide_render]
    if [o.name for o in meshes if "hair" in o.name.lower()
            and not o.hide_render]:
        raise RuntimeError("ASSERT FAIL: hair object still visible")
    main = max([o for o in vis if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    return main, vis


def build_cards(npz_path, texdir, hair_rgb, opened):
    z = np.load(npz_path)
    opened.append(str(Path(npz_path).resolve()))
    verts = z["card_verts"].astype(float)
    faces = z["card_tris"].astype(int)
    uv = z["card_uv"].astype(float)
    vcard = z["vert_card"].astype(int)
    cell = z["card_cell"].astype(int)
    crand = z["card_rand"].astype(float)
    mesh = bpy.data.meshes.new("CARDS_mesh")
    mesh.from_pydata([tuple(v) for v in verts], [],
                     [tuple(int(i) for i in f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new("CARDS", mesh)
    bpy.context.scene.collection.objects.link(obj)
    # atlas-cell UVs: card u,v in [0,1] -> cell quadrant; v flipped
    # (image row 0 = root = Blender UV top).
    uv_layer = mesh.uv_layers.new(name="CardAtlas")
    for poly in mesh.polygons:
        cid = int(vcard[int(mesh.loops[poly.loop_indices[0]].vertex_index)])
        cx, cy = cid % 2, cid // 2
        for li in poly.loop_indices:
            vi = int(mesh.loops[li].vertex_index)
            u, v = float(uv[vi, 0]), float(uv[vi, 1])
            uv_layer.data[li].uv = ((cx + u) / 2.0, (cy + (1.0 - v)) / 2.0)
    rand_attr = mesh.attributes.new(name="cardRand", type="FLOAT",
                                    domain="POINT")
    for i in range(len(verts)):
        rand_attr.data[i].value = float(crand[int(vcard[i])])
    mesh.update()
    # material
    mat = bpy.data.materials.new("CARDS_mat")
    mat.use_nodes = True
    mat.blend_method = "HASHED"
    if hasattr(mat, "shadow_method"):
        mat.shadow_method = "HASHED"
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    princ = tree.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Metallic"].default_value = 0.0
    princ.inputs["Roughness"].default_value = 0.42
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
    for t, p in ((tex_atlas, "CardAtlas"), (tex_flow, "CardAtlas"),
                 (tex_grad, "CardAtlas")):
        um = tree.nodes.new("ShaderNodeUVMap")
        um.uv_map = p
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
    # NOTE: Principled rotation input is 0..1; flow R (0..1, centred 0.5)
    # minus 0.25 == 0.25 + (flowR - 0.5): the 0.25 base turns the
    # default U-aligned shading tangent onto the V strand axis.
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
    tree.links.new(tex_atlas.outputs["Alpha"], princ.inputs["Alpha"])
    tree.links.new(princ.outputs["BSDF"], mix.inputs[1])
    tree.links.new(trans.outputs["BSDF"], mix.inputs[2])
    tree.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    mesh.materials.append(mat)
    # per-card random -> slight roughness variation
    rmap = tree.nodes.new("ShaderNodeMapRange")
    rmap.inputs["From Min"].default_value = 0.0
    rmap.inputs["From Max"].default_value = 1.0
    rmap.inputs["To Min"].default_value = 0.36
    rmap.inputs["To Max"].default_value = 0.48
    attr = tree.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "cardRand"
    tree.links.new(attr.outputs["Fac"], rmap.inputs["Value"])
    tree.links.new(rmap.outputs["Result"], princ.inputs["Roughness"])
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def setup_lights(key_vec):
    for name in ("KEY", "FILL", "RIM"):
        d = bpy.data.lights.new(name=name, type="SUN")
        o = bpy.data.objects.new(name, d)
        bpy.context.scene.collection.objects.link(o)
    bpy.data.objects["KEY"].data.energy = 3.0
    bpy.data.objects["FILL"].data.energy = 0.5
    bpy.data.objects["RIM"].data.energy = 1.0
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
    hair_rgb = (srgb(dc[0]), srgb(dc[1]), srgb(dc[2]), 1.0)
    print("HAIR_RGB sRGB=%.4f %.4f %.4f from linear=[%.6f %.6f %.6f]" % (
        hair_rgb[0], hair_rgb[1], hair_rgb[2], dc[0], dc[1], dc[2]), flush=True)

    main_body, _ = load_body(Path(args.glb), opened)
    enum_pts = list(enumerate(
        [main_body.matrix_world @ v.co for v in main_body.data.vertices]))
    bi = max(enum_pts, key=lambda t: (t[1].z, -t[0]))[0]
    crown = enum_pts[bi][1]
    crown_z = float(crown.z)
    xs = [p.x for _, p in enum_pts]
    cx = (min(xs) + max(xs)) * 0.5
    target = Vector((float(cx), 0.0, crown_z - 0.12))
    print("CROWN z=%.5f cx=%.5f" % (crown_z, cx), flush=True)

    cards_obj = build_cards(Path(args.cards), Path(args.cards).parent / "textures",
                            hair_rgb, opened)
    glb_path = E / "cards.glb"
    bpy.ops.object.select_all(action="DESELECT")
    cards_obj.select_set(True)
    bpy.context.view_layer.objects.active = cards_obj
    bpy.ops.export_scene.gltf(filepath=str(glb_path), export_format="GLB",
                              use_selection=True)
    opened.append(str(glb_path.resolve()))
    print("CARDS_GLB bytes=%d" % glb_path.stat().st_size, flush=True)

    setup_lights(KEY_SUN)
    setup_cycles()
    cam_data = bpy.data.cameras.new("CARD_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("CARD_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    views = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        rec = cams["views"][v]
        views[v] = (Matrix(rec["matrixWorld"]), float(rec["lensMm"]))
    # held-out: azimuth 22.5 deg between front and three_quarter
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
            if o.type == "MESH" and "CARDS" not in o.name:
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
    # relit front: key sun azimuth +40 deg about z
    kx, ky, kz = KEY_SUN
    a = math.radians(40.0)
    key2 = (kx * math.cos(a) - ky * math.sin(a),
            kx * math.sin(a) + ky * math.cos(a), kz)
    kv = Vector(key2).normalized()
    bpy.data.objects["KEY"].rotation_euler = kv.to_track_quat("-Z", "Y").to_euler()
    print("RELIT key=%s" % ([round(float(x), 3) for x in kv]), flush=True)
    beauty("front-relit", *views["front"])

    # ID passes: cards only, white override, transparent film
    for o in bpy.data.objects:
        if o.type == "MESH" and "CARDS" not in o.name:
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
                    "relitNote": "front-relit: key azimuth +40 deg"},
                   indent=2, sort_keys=True) + "\n")
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("BUILD_RENDER_DONE total=%.1fs" % (time.time() - t_all), flush=True)


if __name__ == "__main__":
    main()

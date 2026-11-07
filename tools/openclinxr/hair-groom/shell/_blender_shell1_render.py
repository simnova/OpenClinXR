"""S8 shell1 STEP 3b+4 (Blender): opaque shell + inner, export, render.

Reads: E1/shell.npz (cut outer + partial inner, flow UVs), shell0
shell.npz (uncut mesh for one before-basis front ID), shell0 textures
(strand-atlas.png, flow-map.png, root-tip-gradient.png, read-only),
look7 best-params.json (direct COLOR, read-only), pinned scorer-v3
cameras, body GLB mpfb-peds-parent-aisha.glb (topper hidden).
Writes: E1/shell.glb (outer SHELL1_mat + inner SHELL1_inner_mat),
E1/renders/*.png (6 beauty + 4 holdout ID + 4 body-hidden ID + 1
shell0-mesh holdout front ID + 2 shell-only RGBA opacity passes),
E1/renders/render-times.json, E1/body-geo.npz, E1/blender-opened.txt.

Outer material (Cycles Principled): front-face ALPHA = 1 -
breakup*(1-strandA), breakup = max(1-edge, hemM),
edge = smoothstep(0.00,0.30,facing) (Layer Weight Facing, 1 = facing
camera: silhouette band is the facing-ratio 0.00-0.30 range),
hemM = smoothstep(0.90,0.98,v) with v = 1-V along the ShellFlow UV
(crown v=0, hem v~0.95). Back faces (Geometry Backfacing: the far side
seen through openings, whose Facing is ~0 over the whole surface, not
just the silhouette) use alpha = 1-hemM*(1-strandA): opaque except at
the hem. So: alpha = 1 (opaque) over the body; strand-atlas breakup
ONLY in the front-face silhouette band and at the hem. HASHED blend
for the dithered soft edge; 0.15 Translucent mix (fiber glow;
skin show-through is blocked by alpha=1 plus the inner layer).

Inner material: opaque dark hair (base = hairRGB x root-tip gradient,
roughness 0.55, OPAQUE blend, alpha 1, no translucency).

Light rig: identical to shell0 (scorer rig key angles, exposure-matched
5.0/1.0/1.5, world 0.03): comparability is the point.

ID passes: head-holdout IDs (HEAD_holdout proxy = body-mesh faces with
world z > 1.385 m + brow/lash/teeth/tongue objects, is_holdout=True,
white override, transparent film): skin visible through the face
opening or strand gaps counts as NOT hair, so R1-front is reliable.
Body-hidden IDs (same as shell0) are rendered too for the
before/after face-hole count on a common basis. Opacity passes:
shell-only beauty RGBA (transparent film, real materials) for the
alpha<0.95 fraction measure.
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
HEAD_Z = 1.385

KEY_EL_DEG = 28.995110058505865
KEY_DAZ_DEG = -34.261880624326544
KEY_ENERGY, FILL_ENERGY, RIM_ENERGY = 5.0, 1.0, 1.5
FILL_SUN = (-0.5, -0.4, 0.35)
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
    p.add_argument("--shell0", required=True)
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
    vis = [o for o in meshes if not o.hide_render and o not in env]
    main = max([o for o in vis if o.type == "MESH"],
               key=lambda o: len(o.data.vertices))
    small = [o for o in vis if any(
        k in o.name.lower() for k in ("eyebrow", "eyelash", "teeth", "tongue"))]
    return main, vis, sorted(o.name for o in topper), [o.name for o in small]


def dump_body_geo(keep, out, body_sha, topper_names):
    vall, tall, tmesh, names = [], [], [], []
    for mi, o in enumerate(sorted(keep, key=lambda o: o.name)):
        M = o.matrix_world
        v = np.array([M @ vc.co for vc in o.data.vertices], dtype=np.float64)
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


def mesh_from_npz(npz_path, verts_key, faces_key, uv_key, name, opened):
    z = np.load(npz_path)
    opened.append(str(Path(npz_path).resolve()))
    verts = z[verts_key].astype(float)
    faces = z[faces_key].astype(int)
    uv = z[uv_key].astype(float)
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata([tuple(v) for v in verts], [],
                     [tuple(int(i) for i in f) for f in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    # Flow UVs over the FULL strand maps (V = 1 - v, image row 0 = root)
    # plus a per-face-loop u-seam weld: faces crossing the u 0/1 cut
    # (back midline) get their low side +1, so fragments interpolate
    # within one period instead of smearing the whole atlas width
    # (images use REPEAT; the shell1 map tiles, so the wrap samples
    # continuous content).
    uv_layer = mesh.uv_layers.new(name="ShellFlow")
    u_all = uv[:, 0]
    for poly in mesh.polygons:
        lvi = [int(mesh.loops[li].vertex_index)
               for li in poly.loop_indices]
        uu = u_all[lvi]
        shift = uu.max() - uu.min() > 0.5
        for li, vi in zip(poly.loop_indices, lvi):
            u = float(u_all[vi])
            if shift and u < 0.5:
                u += 1.0
            uv_layer.data[li].uv = (u, 1.0 - float(uv[vi, 1]))
    mesh.update()
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def build_outer_mat(texdir, hair_rgb, opened):
    mat = bpy.data.materials.new("SHELL1_mat")
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
    mix.inputs[0].default_value = 0.15
    tex_atlas = tree.nodes.new("ShaderNodeTexImage")
    tex_atlas.image = bpy.data.images.load(str(texdir / "strand-atlas.png"))
    tex_atlas.image.colorspace_settings.name = "sRGB"
    tex_flow = tree.nodes.new("ShaderNodeTexImage")
    tex_flow.image = bpy.data.images.load(str(texdir / "flow-map.png"))
    tex_flow.image.colorspace_settings.name = "Non-Color"
    tex_grad = tree.nodes.new("ShaderNodeTexImage")
    tex_grad.image = bpy.data.images.load(str(texdir / "root-tip-gradient.png"))
    tex_grad.image.colorspace_settings.name = "Non-Color"
    um_nodes = []
    for t in (tex_atlas, tex_flow, tex_grad):
        t.extension = "REPEAT"  # u-seam weld needs wrap sampling
        um = tree.nodes.new("ShaderNodeUVMap")
        um.uv_map = "ShellFlow"
        tree.links.new(um.outputs["UV"], t.inputs["Vector"])
        um_nodes.append(um)
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
    # edge = smoothstep(0.00, 0.30, facing): silhouette band
    facing = tree.nodes.new("ShaderNodeLayerWeight")
    facing.inputs["Blend"].default_value = 0.5
    eramp = tree.nodes.new("ShaderNodeMapRange")
    eramp.data_type = "FLOAT"
    eramp.interpolation_type = "SMOOTHSTEP"
    eramp.inputs["From Min"].default_value = 0.00
    eramp.inputs["From Max"].default_value = 0.30
    eramp.inputs["To Min"].default_value = 0.0
    eramp.inputs["To Max"].default_value = 1.0
    tree.links.new(facing.outputs["Facing"], eramp.inputs["Value"])
    # hemM = smoothstep(0.80, 0.95, v), v = 1 - V
    sepxyz = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(um_nodes[0].outputs["UV"], sepxyz.inputs["Vector"])
    one_minus_v = tree.nodes.new("ShaderNodeMath")
    one_minus_v.operation = "SUBTRACT"
    one_minus_v.inputs[0].default_value = 1.0
    tree.links.new(sepxyz.outputs["Y"], one_minus_v.inputs[1])
    hramp = tree.nodes.new("ShaderNodeMapRange")
    hramp.data_type = "FLOAT"
    hramp.interpolation_type = "SMOOTHSTEP"
    hramp.inputs["From Min"].default_value = 0.90
    hramp.inputs["From Max"].default_value = 0.98
    hramp.inputs["To Min"].default_value = 0.0
    hramp.inputs["To Max"].default_value = 1.0
    tree.links.new(one_minus_v.outputs["Value"], hramp.inputs["Value"])
    # breakup = max(1-edge, hemM); alpha = 1-breakup*(1-strandA)
    one_minus_edge = tree.nodes.new("ShaderNodeMath")
    one_minus_edge.operation = "SUBTRACT"
    one_minus_edge.inputs[0].default_value = 1.0
    tree.links.new(eramp.outputs["Result"], one_minus_edge.inputs[1])
    breakup = tree.nodes.new("ShaderNodeMath")
    breakup.operation = "MAXIMUM"
    tree.links.new(one_minus_edge.outputs["Value"], breakup.inputs[0])
    tree.links.new(hramp.outputs["Result"], breakup.inputs[1])
    one_minus_a = tree.nodes.new("ShaderNodeMath")
    one_minus_a.operation = "SUBTRACT"
    one_minus_a.inputs[0].default_value = 1.0
    tree.links.new(tex_atlas.outputs["Alpha"], one_minus_a.inputs[1])
    m2 = tree.nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    tree.links.new(breakup.outputs["Value"], m2.inputs[0])
    tree.links.new(one_minus_a.outputs["Value"], m2.inputs[1])
    alpha = tree.nodes.new("ShaderNodeMath")
    alpha.operation = "SUBTRACT"
    alpha.inputs[0].default_value = 1.0
    tree.links.new(m2.outputs["Value"], alpha.inputs[1])
    # back faces: opaque except at the hem (their Facing is ~0 over the
    # whole surface, so the front-face rule would gap them everywhere).
    alpha_back_m = tree.nodes.new("ShaderNodeMath")
    alpha_back_m.operation = "MULTIPLY"
    tree.links.new(hramp.outputs["Result"], alpha_back_m.inputs[0])
    tree.links.new(one_minus_a.outputs["Value"], alpha_back_m.inputs[1])
    alpha_back = tree.nodes.new("ShaderNodeMath")
    alpha_back.operation = "SUBTRACT"
    alpha_back.inputs[0].default_value = 1.0
    tree.links.new(alpha_back_m.outputs["Value"], alpha_back.inputs[1])
    geo = tree.nodes.new("ShaderNodeNewGeometry")
    one_minus_bf = tree.nodes.new("ShaderNodeMath")
    one_minus_bf.operation = "SUBTRACT"
    one_minus_bf.inputs[0].default_value = 1.0
    tree.links.new(geo.outputs["Backfacing"], one_minus_bf.inputs[1])
    front_w = tree.nodes.new("ShaderNodeMath")
    front_w.operation = "MULTIPLY"
    tree.links.new(alpha.outputs["Value"], front_w.inputs[0])
    tree.links.new(one_minus_bf.outputs["Value"], front_w.inputs[1])
    back_w = tree.nodes.new("ShaderNodeMath")
    back_w.operation = "MULTIPLY"
    tree.links.new(geo.outputs["Backfacing"], back_w.inputs[0])
    tree.links.new(alpha_back.outputs["Value"], back_w.inputs[1])
    alpha_mix = tree.nodes.new("ShaderNodeMath")
    alpha_mix.operation = "ADD"
    tree.links.new(front_w.outputs["Value"], alpha_mix.inputs[0])
    tree.links.new(back_w.outputs["Value"], alpha_mix.inputs[1])
    tree.links.new(alpha_mix.outputs["Value"], princ.inputs["Alpha"])
    # base = atlasRGB x gradient x hairRGB
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
    return mat


def build_inner_mat(texdir, hair_rgb):
    mat = bpy.data.materials.new("SHELL1_inner_mat")
    mat.use_nodes = True
    mat.blend_method = "OPAQUE"
    mat.use_backface_culling = False
    tree = mat.node_tree
    tree.nodes.clear()
    out = tree.nodes.new("ShaderNodeOutputMaterial")
    princ = tree.nodes.new("ShaderNodeBsdfPrincipled")
    princ.inputs["Metallic"].default_value = 0.0
    princ.inputs["Roughness"].default_value = 0.55
    princ.inputs["Anisotropic"].default_value = 0.3
    tex_grad = tree.nodes.new("ShaderNodeTexImage")
    tex_grad.image = bpy.data.images.load(str(texdir / "root-tip-gradient.png"))
    tex_grad.image.colorspace_settings.name = "Non-Color"
    tex_grad.extension = "REPEAT"
    um = tree.nodes.new("ShaderNodeUVMap")
    um.uv_map = "ShellFlow"
    tree.links.new(um.outputs["UV"], tex_grad.inputs["Vector"])
    mul = tree.nodes.new("ShaderNodeVectorMath")
    mul.operation = "MULTIPLY"
    tree.links.new(tex_grad.outputs["Color"], mul.inputs[0])
    mul.inputs[1].default_value = hair_rgb[:3]
    tree.links.new(mul.outputs["Vector"], princ.inputs["Base Color"])
    tree.links.new(princ.outputs["BSDF"], out.inputs["Surface"])
    return mat


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
    dc = params["params"]["directColorLinear"]
    hair_rgb = (min(1.0, srgb(dc[0]) * EXPOSURE_GAIN),
                min(1.0, srgb(dc[1]) * EXPOSURE_GAIN),
                min(1.0, srgb(dc[2]) * EXPOSURE_GAIN), 1.0)
    print("HAIR_RGB sRGBx%.1f=%.4f %.4f %.4f" % (
        EXPOSURE_GAIN, hair_rgb[0], hair_rgb[1], hair_rgb[2]), flush=True)

    main_body, vis, topper_names, small_names = load_body(Path(args.body_glb), opened)
    small_objs = [bpy.data.objects[n] for n in small_names]
    enum_pts = list(enumerate(
        [main_body.matrix_world @ v.co for v in main_body.data.vertices]))
    bi = max(enum_pts, key=lambda t: (t[1].z, -t[0]))[0]
    crown = enum_pts[bi][1]
    crown_z = float(crown.z)
    xs = [p.x for _, p in enum_pts]
    cx = (min(xs) + max(xs)) * 0.5
    target = Vector((float(cx), 0.0, crown_z - 0.12))

    outer = mesh_from_npz(Path(args.shell), "verts", "faces", "uv",
                          "SHELL1", opened)
    outer.data.materials.append(
        build_outer_mat(Path(args.texdir), hair_rgb, opened))
    inner = mesh_from_npz(Path(args.shell), "innerVerts", "innerFaces",
                          "innerUv", "SHELL1_inner", opened)
    inner.data.materials.append(build_inner_mat(Path(args.texdir), hair_rgb))
    cmp0 = mesh_from_npz(Path(args.shell0), "verts", "faces", "uv",
                         "SHELL0cmp", opened)
    print("MESH outer=%d/%d inner=%d/%d cmp0=%d/%d" % (
        len(outer.data.vertices), len(outer.data.polygons),
        len(inner.data.vertices), len(inner.data.polygons),
        len(cmp0.data.vertices), len(cmp0.data.polygons)), flush=True)
    dump_body_geo(vis, Path(args.body_geo_out),
                  sha256(args.body_glb), topper_names)
    opened.append(str(Path(args.body_geo_out).resolve()))
    proxy = make_head_proxy(main_body)

    glb_path = Path(args.glb_out)
    bpy.ops.object.select_all(action="DESELECT")
    outer.select_set(True)
    inner.select_set(True)
    bpy.context.view_layer.objects.active = outer
    bpy.ops.export_scene.gltf(filepath=str(glb_path),
                              export_format="GLB", use_selection=True)
    opened.append(str(glb_path.resolve()))
    print("SHELL_GLB bytes=%d" % glb_path.stat().st_size, flush=True)

    setup_lights(KEY_SUN)
    setup_cycles()
    cam_data = bpy.data.cameras.new("SHELL1_cam")
    cam_data.sensor_width = float(cams["sensorWidthMm"])
    cam = bpy.data.objects.new("SHELL1_cam", cam_data)
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

    times = {}
    sc = bpy.context.scene
    hair_objs = (outer, inner, cmp0)

    def set_body(mode):
        # beauty: full body, proxy off, small normal
        # hidden: everything off (shell-only)
        # holdout: body off, proxy+small as holdout
        for o in bpy.data.objects:
            if o.type != "MESH":
                continue
            n = o.name.lower()
            if (("library" in n and "hair" in n) or n == "icosphere"):
                o.hide_render = True
                continue
            if o in hair_objs:
                o.hide_render = False
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
        cmp0.hide_render = True
        sc.render.film_transparent = False
        sc.render.image_settings.color_mode = "RGB"
        bpy.context.view_layer.material_override = None
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
    beauty("front-relit", *views["front"])

    wmat = bpy.data.materials.new("ID_white")
    wmat.use_nodes = True
    wmat.node_tree.nodes.clear()
    wout = wmat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    wbsdf = wmat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    wbsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    wbsdf.inputs["Roughness"].default_value = 1.0
    wmat.node_tree.links.new(wbsdf.outputs["BSDF"], wout.inputs["Surface"])

    def idpass(name, view, use_cmp0, holdout):
        cam.matrix_world, cam_data.lens = views[view][0], views[view][1]
        bpy.context.view_layer.update()
        set_body("holdout" if holdout else "hidden")
        cmp0.hide_render = not use_cmp0
        if use_cmp0:
            outer.hide_render = True
            inner.hide_render = True
        bpy.context.view_layer.material_override = wmat
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = "RGBA"
        t0 = time.time()
        sc.render.filepath = str(outdir / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        times[name] = round(time.time() - t0, 1)
        opened.append(str((outdir / (name + ".png")).resolve()))
        print("RENDER %s %.1fs" % (name, times[name]), flush=True)
        outer.hide_render = False
        inner.hide_render = False

    for v in ("front", "three_quarter", "profile_90", "back"):
        idpass(v + "-id", v, False, True)
    for v in ("front", "three_quarter", "profile_90", "back"):
        idpass(v + "-hidden-id", v, False, False)
    idpass("front-id-shell0holdout", "front", True, True)

    def opacity_pass(name, view):
        cam.matrix_world, cam_data.lens = views[view][0], views[view][1]
        bpy.context.view_layer.update()
        set_body("hidden")
        cmp0.hide_render = True
        bpy.context.view_layer.material_override = None
        sc.render.film_transparent = True
        sc.render.image_settings.color_mode = "RGBA"
        t0 = time.time()
        sc.render.filepath = str(outdir / (name + ".png"))
        bpy.ops.render.render(write_still=True)
        times[name] = round(time.time() - t0, 1)
        opened.append(str((outdir / (name + ".png")).resolve()))
        print("RENDER %s %.1fs" % (name, times[name]), flush=True)

    for v, n in (("front", "front-opaque"), ("profile_90", "profile_90-opaque")):
        opacity_pass(n, v)

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
                    "alphaBands": {"edgeFacing": [0.0, 0.30],
                                   "hemV": [0.90, 0.98],
                                   "backface": "opaque-except-hem"},
                    "relitNote": "front-relit: key azimuth +40 deg"},
                   indent=2, sort_keys=True) + "\n")
    Path(args.opened).write_text("\n".join(sorted(set(opened))) + "\n")
    print("BUILD_RENDER_DONE total=%.1fs" % (time.time() - t_all), flush=True)


if __name__ == "__main__":
    main()

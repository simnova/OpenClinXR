"""
Bake wrinkle normal, curvature and cavity per MORPHED mesh + one tiled pore normal.

Subject : Aisha morphed mesh from aisha-eyetex.glb (body object
          mpfb_ob_patient_aisha_body, 39221 verts -- NOT the hm08 base).
UV      : shared MakeHuman UV kept as-is (no re-unwrap).
Pore recipe: MPFB enhanced-skin Voronoi bump, CC0 idea baked in Blender --
  pore scale 150 / detail 2.0 / strength 0.3 (decimeter-scale numbers from
  https://static.makehumancommunity.org/mpfb/docs/materials/skinv1.html
  "Make the skin coarser, more rough"). No MPFB code is shipped or imported.
Wrinkles: CC0 MakeHuman 1.x age targets (head-age-incr + l/r-eye-bag-incr
  vertex deltas on the hm08 basemesh) transferred onto the morphed mesh through
  the shared UV layout (shape-independent correspondence) with a Umeyama
  base->morphed similarity; displaced low vs smooth undisplaced high baked
  selected-to-active tangent normal. If the transfer checks fail, NO wrinkle
  map is baked and the blocker is recorded. No vector displacement map.
Curvature: Geometry Pointiness -> ramp -> Emission, EMIT bake (skin-LUT input).
Cavity  : AO bake (feeds roughness/specular-occlusion, never albedo).

Run (foreground):
  blender --background <any.blend or --factory-startup> --python bake_skin_maps.py -- \
    --glb <aisha-eyetex.glb> --out <store/skin-maps dir>
"""
import argparse
import hashlib
import json
import math
import os
import sys

import bpy
import numpy as np

# ---------------------------------------------------------------- args ------
argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--glb", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.render.bake.margin = 8
scene.render.bake.use_clear = True

# ---------------------------------------------------------------- import -----
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=args.glb)

body = None
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    n = (o.name + " " + (o.data.name if o.data else "")).lower()
    if "mpfb_ob_patient_aisha_body" in n and o.name.count("_") <= 5:
        if body is None or len(o.data.vertices) > len(body.data.vertices):
            body = o
assert body is not None, "aisha body mesh not found after gltf import"
body.name = "AISHA_BODY_LOW"
mesh = body.data
print(f"LOW body: {body.name} verts={len(mesh.vertices)} faces={len(mesh.polygons)} "
      f"uv_layers={[uv.name for uv in mesh.uv_layers]} materials={[m.name if m else None for m in body.data.materials]}")

vpos = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
mesh.vertices.foreach_get("co", vpos)
vpos = vpos.reshape(-1, 3)
mesh_sha = hashlib.sha256(np.round(vpos, 6).tobytes()).hexdigest()
print(f"LOW mesh sha (rounded positions): {mesh_sha}")

# ------------------------------------------------- landmarks on THIS mesh ----
# eye globes: sort by x -> [right, left] in mesh local axes (world == local here)
globes = []
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    hay = (o.name + " " + (o.data.name if o.data else "")).lower()
    if "globe" in hay and "cornea" not in hay:
        vs = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get("co", vs)
        vs = vs.reshape(-1, 3)
        w = np.asarray(o.matrix_world) @ np.hstack([vs, np.ones((len(vs), 1))]).T
        pts = w[:3].T
        print(f"globe candidate: {o.name} / {o.data.name if o.data else None}")
        # merged L+R globes arrive as ONE object: split by x at the median gap
        xs = pts[:, 0]
        lo, hi = pts[xs <= np.median(xs)], pts[xs > np.median(xs)]
        globes.extend([lo.mean(axis=0), hi.mean(axis=0)])
assert len(globes) >= 2, f"expected 2 eye globes, found {len(globes)}"
globes = sorted(globes, key=lambda p: p[0])
eye_r, eye_l = globes[0], globes[-1]
eye_mid = (eye_r + eye_l) / 2.0
UP = np.array([0.0, 0.0, 1.0])
fwd = eye_mid - vpos.mean(axis=0)
fwd[2] = 0.0
fwd /= np.linalg.norm(fwd)
RIGHT = np.cross(fwd, UP)
RIGHT /= np.linalg.norm(RIGHT)
print(f"eye_l={eye_l} eye_r={eye_r} fwd={fwd} right={RIGHT}")

rel = vpos - eye_mid
c_fwd = rel @ fwd
c_up = rel @ UP
c_right = rel @ RIGHT

# ------------------------------------------------- high duplicate + grooves ---
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
high = bpy.context.view_layer.objects.active
high.name = "AISHA_BODY_HIGH"
if high.data.shape_keys:
    high.shape_key_clear()  # keep basis morphed shape, drop morph keys for subdiv
sub = high.modifiers.new("SUBDIV", "SUBSURF")
sub.levels = 2
sub.render_levels = 2
# apply subdiv (needs active + object mode)
bpy.ops.object.modifier_apply(modifier=sub.name)
hv = high.data.vertices
hpos = np.empty(len(hv) * 3)
hv.foreach_get("co", hpos)
hpos = hpos.reshape(-1, 3)
hnor = np.empty(len(hv) * 3)
# vertex normals are auto-computed post-modifier-apply; read them directly
hv.foreach_get("normal", hnor)
hnor = hnor.reshape(-1, 3)

hrel = hpos - eye_mid
h_fwd = hrel @ fwd
h_up = hrel @ UP
h_right = hrel @ RIGHT


# ------------------------------------------------- high duplicate ------------
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.duplicate()
high = bpy.context.view_layer.objects.active
high.name = "AISHA_BODY_HIGH"
if high.data.shape_keys:
    high.shape_key_clear()  # keep basis morphed shape, drop morph keys for subdiv

# -------------------------------------------- age targets -> morphed mesh ----
# CC0 MakeHuman 1.x age targets are vertex deltas on the hm08 basemesh
# (base.obj, 19158 verts, decimeters). They reach the merged GLB body through
# the SHARED UV layout -- a shape-independent correspondence in the same
# family as face-replay's mesh/UV sampling -- with the base->morphed
# similarity (s, R) solved by Umeyama over head-vert pairs. No procedural
# wrinkle field: if the similarity check fails the wrinkle map is NOT baked
# and the blocker is recorded instead.
MH_DATA = "/private/tmp/mh-skins-ls/mh1/makehuman/data"
AGE_TARGETS = [
    MH_DATA + "/targets/head/head-age-incr.target",
    MH_DATA + "/targets/eyes/l-eye-bag-incr.target",
    MH_DATA + "/targets/eyes/r-eye-bag-incr.target",
]
WRINKLE_BLOCKED = ""


def parse_base_obj(path):
    pos, uv_first, nverts = [], {}, 0
    uv_bank = []
    for line in open(path):
        if line.startswith("v "):
            pos.append(list(map(float, line.split()[1:4])))
            nverts += 1
        elif line.startswith("vt "):
            uv_bank.append(list(map(float, line.split()[1:3])))
    loop_vv, loop_vt = [], []
    for line in open(path):
        if line.startswith("f "):
            for tok in line.split()[1:]:
                vi, vti = tok.split("/")[:2]
                loop_vv.append(int(vi) - 1)
                loop_vt.append(int(vti) - 1)
    uv_arr = np.zeros((nverts, 2))
    seen = np.zeros(nverts, bool)
    for vv, vti in zip(loop_vv, loop_vt):
        if not seen[vv]:
            uv_arr[vv] = uv_bank[vti]
            seen[vv] = True
    return np.array(pos), uv_arr


def parse_mh_target(path):
    d = {}
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        s = line.split()
        d[int(s[0])] = [float(s[1]), float(s[2]), float(s[3])]
    return d


def umeyama_similarity(src, dst):
    mu_s, mu_d = src.mean(0), dst.mean(0)
    sc, dc = src - mu_s, dst - mu_d
    var = (sc ** 2).sum() / len(src)
    H = (dc.T @ sc) / len(src)
    U, S, Vt = np.linalg.svd(H)
    R = (U @ Vt)
    if np.linalg.det(R) < 0:
        Vt[-1] *= -1
        R = U @ Vt
    s = S.sum() / var
    return s, R


def low_vert_uv(obj):
    me = obj.data
    uv = me.uv_layers["UVMap"].data
    narr = np.empty(len(uv) * 2)
    uv.foreach_get("uv", narr)
    narr = narr.reshape(-1, 2)
    lv = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", lv)
    out = np.zeros((len(me.vertices), 2))
    seen = np.zeros(len(me.vertices), bool)
    for li, vv in enumerate(lv):
        if not seen[vv]:
            out[vv] = narr[li]
            seen[vv] = True
    return out


try:
    base_pos, base_uv = parse_base_obj(MH_DATA + "/3dobjs/base.obj")
    assert len(base_pos) == 19158, f"hm08 base vert count {len(base_pos)}"
    base_delta = np.zeros_like(base_pos)
    for tp in AGE_TARGETS:
        for idx, dv in parse_mh_target(tp).items():
            base_delta[idx] += dv
    assert np.abs(base_delta).max() > 0, "age targets carry no deltas"
    low_uv = low_vert_uv(body)
    assert low_uv.min() >= -0.001 and low_uv.max() <= 1.001, \
        f"GLB UV outside shared layout: {low_uv.min():.3f}..{low_uv.max():.3f}"
    from mathutils.kdtree import KDTree
    kd = KDTree(len(base_pos))
    for i, co in enumerate(base_uv):
        kd.insert((float(co[0]), float(co[1]), 0.0), i)
    kd.balance()
    match = np.empty(len(vpos), dtype=np.int64)
    mdist = np.empty(len(vpos))
    for i, co in enumerate(low_uv):
        _, idx, dist = kd.find((float(co[0]), float(co[1]), 0.0))
        match[i], mdist[i] = idx, dist
    print(f"UV correspondence: median dist={np.median(mdist):.6f} max={mdist.max():.6f}")
    skin_idx = next(i for i, m in enumerate(body.data.materials)
                    if m and "skin" in m.name.lower())
    ploop = np.empty(len(mesh.polygons), dtype=np.int32)
    mesh.polygons.foreach_get("material_index", ploop)
    is_skin_vert = np.zeros(len(vpos), bool)
    pvert = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", pvert)
    start = 0
    for pi, mi in enumerate(ploop):
        n = mesh.polygons[pi].loop_total
        if mi == skin_idx:
            is_skin_vert[pvert[start:start + n]] = True
        start += n
    smd = mdist[is_skin_vert]
    print(f"UV correspondence (skin verts {is_skin_vert.sum()}): "
          f"median={np.median(smd):.6f} max={smd.max():.6f}")
    assert np.median(smd) < 2e-3 and smd.max() < 0.02, \
        "UV layouts diverge on skin verts"
    head = is_skin_vert & (vpos[:, 2] > (eye_mid[2] - 0.15))
    assert head.sum() > 5000, "head region too small for similarity fit"
    s_uv, R_uv = umeyama_similarity(base_pos[match[head]], vpos[head])
    print(f"Umeyama base->morphed: scale={s_uv:.4f} (expect ~0.1 dm->m)")
    assert 0.08 < s_uv < 0.12, f"similarity scale {s_uv:.4f} outside dm->m band"
    low_disp = (R_uv @ base_delta[match].T).T * s_uv
    low_disp[mdist > 0.005] = 0.0  # re-wrapped hidden shells keep no age delta
    mag = np.linalg.norm(low_disp, axis=1)
    print(f"transferred age field: verts={len(mag)} mean={mag.mean()*1000:.4f}mm "
          f"max={mag.max()*1000:.4f}mm n8262+={int((mag > 1e-6).sum())}")
    disp_co = (vpos + low_disp).reshape(-1).tolist()
    mesh.vertices.foreach_set("co", disp_co)
    mesh.update()
    body.update_tag()
except AssertionError as e:
    WRINKLE_BLOCKED = str(e)
    print(f"WRINKLE_BLOCKED: {WRINKLE_BLOCKED}")

sub = high.modifiers.new("SUBDIV", "SUBSURF")
sub.levels = 2
sub.render_levels = 2
# apply subdiv (needs active + object mode)
bpy.ops.object.modifier_apply(modifier=sub.name)
hv = high.data.vertices
hpos = np.empty(len(hv) * 3)
hv.foreach_get("co", hpos)
hpos = hpos.reshape(-1, 3)
print(f"HIGH verts={len(hpos)} (subdiv of undisplaced low; bake reads low-minus-high = age delta)")


def new_bake_image(name, w, h):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    img.file_format = "PNG"
    return img


def ensure_image_node(mat, img):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in nt.nodes:
        if n.type == "TEX_IMAGE" and n.image == img:
            nt.nodes.active = n
            n.select = True
            return n
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    nt.nodes.active = n
    n.select = True
    return n


skin_slot = None
for i, m in enumerate(body.data.materials):
    if m and "skin" in m.name.lower():
        skin_slot = (i, m)
        break
assert skin_slot, "no skin material slot on low body"
print(f"skin slot: {skin_slot[1].name}")

# ------------------------------------------------- 1. wrinkle normal 2048 ----
# Skipped entirely when the age-target transfer is blocked (D2: no
# procedural fallback is shipped).
wrinkle_path = os.path.join(args.out, "aisha-wrinkle-normal-2048.png")
if not WRINKLE_BLOCKED:
    wrinkle_img = new_bake_image("AISHA_WRINKLE_NORMAL", 2048, 2048)
    ensure_image_node(skin_slot[1], wrinkle_img)
    bpy.ops.object.select_all(action="DESELECT")
    high.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.0
    scene.render.bake.max_ray_distance = 0.004
    bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True, margin=8)
    wrinkle_img.filepath_raw = wrinkle_path
    wrinkle_img.file_format = "PNG"
    wrinkle_img.save()
    print(f"wrote {wrinkle_path}")
else:
    if os.path.exists(wrinkle_path):
        os.remove(wrinkle_path)
    print(f"wrinkle map NOT baked: {WRINKLE_BLOCKED}")

# ------------------------------------------------- 2/3. curvature + cavity --
orig_mats = list(body.data.materials)


def temp_emit_material(build_nodes):
    m = bpy.data.materials.new("TMP_BAKE")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    build_nodes(nt, emit)
    nt.links.new(emit.outputs[0], out.inputs[0])
    return m


def build_curvature(nt, emit):
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    # pointiness ~0.35..0.65 -> 0..1 (convex bright)
    e0 = ramp.color_ramp.elements[0]
    e1 = ramp.color_ramp.elements[1]
    e0.position = 0.35
    e1.position = 0.65
    e0.color = (0, 0, 0, 1)
    e1.color = (1, 1, 1, 1)
    nt.links.new(geo.outputs["Pointiness"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emit.inputs[0])


curv_img = new_bake_image("AISHA_CURVATURE", 1024, 1024)
curv_mat = temp_emit_material(build_curvature)
for i in range(len(orig_mats)):
    body.data.materials[i] = curv_mat
ensure_image_node(curv_mat, curv_img)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.context.view_layer.objects.active = body
scene.render.bake.use_selected_to_active = False
bpy.ops.object.bake(type="EMIT", use_clear=True, margin=8)
curv_path = os.path.join(args.out, "aisha-curvature-1024.png")
curv_img.filepath_raw = curv_path
curv_img.file_format = "PNG"
curv_img.save()
print(f"wrote {curv_path}")

cav_img = new_bake_image("AISHA_CAVITY", 1024, 1024)


def build_cavity(nt, emit):
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    # concave mask: pointiness <= 0.35 -> 1 (crevices), >= 0.65 -> 0.
    # Ray-traced AO goes near-black here because the merged body carries
    # coplanar hidden-garment shells; pointiness is occlusion-free.
    e0 = ramp.color_ramp.elements[0]
    e1 = ramp.color_ramp.elements[1]
    e0.position = 0.35
    e1.position = 0.65
    e0.color = (1, 1, 1, 1)
    e1.color = (0, 0, 0, 1)
    nt.links.new(geo.outputs["Pointiness"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], emit.inputs[0])


cav_mat = temp_emit_material(build_cavity)
for i in range(len(orig_mats)):
    body.data.materials[i] = cav_mat
ensure_image_node(cav_mat, cav_img)  # material irrelevant for AO bake
bpy.ops.object.bake(type="EMIT", use_clear=True, margin=8)
cav_path = os.path.join(args.out, "aisha-cavity-1024.png")
cav_img.filepath_raw = cav_path
cav_img.file_format = "PNG"
cav_img.save()
print(f"wrote {cav_path}")

for i, m in enumerate(orig_mats):
    body.data.materials[i] = m

# ------------------------------------------------- 4. tiled pore normal 512 --
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.mesh.primitive_plane_add(size=2.0)
plane = bpy.context.view_layer.objects.active
plane.name = "PORE_TILE"
pm = bpy.data.materials.new("PORE_MAT")
pm.use_nodes = True
pnt = pm.node_tree
pnt.nodes.clear()
pout = pnt.nodes.new("ShaderNodeOutputMaterial")
bsdf = pnt.nodes.new("ShaderNodeBsdfPrincipled")
pnt.links.new(bsdf.outputs[0], pout.inputs[0])
tcoord = pnt.nodes.new("ShaderNodeTexCoord")
mapping = pnt.nodes.new("ShaderNodeMapping")
mapping.inputs["Scale"].default_value = (6.0, 6.0, 1.0)
# modulo wrap per axis -> exactly repeating cells -> tileable
sep = pnt.nodes.new("ShaderNodeSeparateXYZ")
modx = pnt.nodes.new("ShaderNodeMath")
modx.operation = "MODULO"
modx.inputs[1].default_value = 1.0
mody = pnt.nodes.new("ShaderNodeMath")
mody.operation = "MODULO"
mody.inputs[1].default_value = 1.0
comb = pnt.nodes.new("ShaderNodeCombineXYZ")
voro = pnt.nodes.new("ShaderNodeTexVoronoi")
voro.feature = "F1"
voro.inputs["Scale"].default_value = 24.0    # ~144 cells/tile: 512/144 ~= 3.6px per
                                             # pore (was 150: 900 cells/tile, 0.57px/cell,
                                             # aliased into low-frequency blotches -- D1)
voro.inputs["Detail"].default_value = 2.0    # MPFB doc pore detail
voro.inputs["Roughness"].default_value = 0.6
bump = pnt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.3  # MPFB doc pore strength
bump.inputs["Distance"].default_value = 0.0018  # calibrated: R/G std ~3.5 (interp 0.0003->0.75, 0.007->13.4)
                                             # (0.15 -> std 11 dirt; 0.0003 -> std 0.75 flat)
pnt.links.new(tcoord.outputs["UV"], mapping.inputs[0])
pnt.links.new(mapping.outputs[0], sep.inputs[0])
pnt.links.new(sep.outputs[0], modx.inputs[0])
pnt.links.new(sep.outputs[1], mody.inputs[0])
pnt.links.new(modx.outputs[0], comb.inputs[0])
pnt.links.new(mody.outputs[0], comb.inputs[1])
pnt.links.new(comb.outputs[0], voro.inputs[0])
pnt.links.new(voro.outputs["Distance"], bump.inputs["Height"])
pnt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
plane.data.materials.append(pm)
# plane UV 0..1 (default) x mapping scale 6 -> 6 repeats, wrapped -> tileable
pore_img = new_bake_image("PORE_TILE_NORMAL", 512, 512)
ensure_image_node(pm, pore_img)
bpy.context.view_layer.objects.active = plane
scene.render.bake.use_selected_to_active = False
bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=True, margin=0)
pore_path = os.path.join(args.out, "pore-tile-normal-512.png")
pore_img.filepath_raw = pore_path
pore_img.file_format = "PNG"
pore_img.save()
print(f"wrote {pore_path}")

# ------------------------------------------------- summary -------------------
def sha(p):
    import hashlib as h
    return h.sha256(open(p, "rb").read()).hexdigest()


summary = {
    "glb": args.glb,
    "low_body": {"name": body.name, "verts": len(mesh.vertices),
                 "faces": len(mesh.polygons), "mesh_sha": mesh_sha},
    "wrinkle_blocked": WRINKLE_BLOCKED,
    "maps": [
        *([] if WRINKLE_BLOCKED else
          [{"file": os.path.basename(wrinkle_path), "sha256": sha(wrinkle_path)}]),
        {"file": os.path.basename(curv_path), "sha256": sha(curv_path)},
        {"file": os.path.basename(cav_path), "sha256": sha(cav_path)},
        {"file": os.path.basename(pore_path), "sha256": sha(pore_path)},
    ],
}
print("BAKE_SUMMARY " + json.dumps(summary))

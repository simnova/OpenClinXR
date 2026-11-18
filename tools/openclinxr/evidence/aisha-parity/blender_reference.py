#!/usr/bin/env python3
"""P1a Blender reference for lane aisha-parity (headless, --factory-startup).

Reference the three.js runtime must match: the shipped Aisha GLB rendered
with its materials EXACTLY as imported (no material edits, no modifiers
added), lit only by the studio HDRI.

Usage (inside heavy slot):
  Blender -b --factory-startup -P blender_reference.py -- \
    --glb <aisha.glb> --hdri <studio_small_09_2k.hdr> --out <E> [--samples N]

Writes under <E>: beauty/<cam>.{png,exr}, masks/<cam>.png,
calib/spheres.{png,exr}, cameras.json, manifest.json.
sheet.png is built afterwards outside Blender (PIL) and patched into the
manifest by that step.
"""

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

EXPECTED_GLB_SHA256 = "37e905ea9fa0d4f3664d95a1c34ab45219a77ed63a46b4976b0bb1a063443ce9"
BODY_MESH = "mpfb_ob_patient_aisha_v1_body"
EYES_MESH = "makeclothes_library_eyes_low_poly_mpfb_ob_patient_aisha_v1_mesh"

HEAD_VFOV = 24.0
BODY_VFOV = 30.0
HEAD_RES = (1536, 1536)
BODY_RES = (1152, 2048)
HEAD_FILL = 0.78
BODY_FILL = 0.90
HEAD_TOP_OFFSET_FRAC = 0.075  # head centre = AABB top minus 7.5% of height
HEAD_HEIGHT_FRAC = 1.0 / 7.5  # assumed head height = bodyH / 7.5 (recorded)
YAW_DEG = 35.0  # 3/4 views: camera swung toward the subject's left

# glTF Y-up (x right, y up, z toward viewer) as Blender sees it after import
# is Z-up; three.js target frame is Y-up with three = (x_b, z_b, -y_b).
C_T = ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0))

MASK_COLORS = {
    "skin": (1.0, 0.0, 0.0, 1.0),      # red
    "eyes": (0.0, 1.0, 0.0, 1.0),      # green
    "clothing": (0.0, 0.0, 1.0, 1.0),  # blue
    "hair": (1.0, 1.0, 0.0, 1.0),      # yellow
    "teeth": (1.0, 0.0, 1.0, 1.0),     # magenta
}

CLOTHING_MATS = {
    "mat_makeclothes_library_female_tight_jeans_pants",
    "mat_makeclothes_library_footwear_toigo_mj_cloth_shoes",
    "mat_makeclothes_library_toigo_t_shirt",
}
HAIR_MATS = {
    "openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_v1_mat",
    "openclinxr_fitted_eyebrow_mindfront_eyebrows_05_mpfb_ob_patient_aisha_v1_mat",
    "openclinxr_fitted_eyelash_mindfront_eyelashes_01_mpfb_ob_patient_aisha_v1_mat",
}
TEETH_MATS = {
    "mat_openclinxr_hm08_teeth_mpfb_ob_patient_aisha_v1_mesh",
    "mat_openclinxr_hm08_tongue_mpfb_ob_patient_aisha_v1_mesh",
    "mat_openclinxr_fitted_teeth_mpfb_ob_patient_aisha_mesh",
    "mat_openclinxr_fitted_tongue_mpfb_ob_patient_aisha_mesh",
}


def log(msg):
    print(msg, flush=True)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--hdri", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--samples", type=int, default=1024)
    p.add_argument("--seed", type=int, default=0)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def mask_category(mat_name):
    if mat_name == "mpfb_skin_ob_patient_aisha_v1":
        return "skin"
    if mat_name.startswith("mat_makeclothes_library_eyes_"):
        return "eyes"
    if mat_name in CLOTHING_MATS:
        return "clothing"
    if mat_name in HAIR_MATS:
        return "hair"
    if mat_name in TEETH_MATS:
        return "teeth"
    if mat_name.startswith("openclinxr_hidden_"):
        return "hidden"
    return None


def lookat_matrix(loc, target, up=Vector((0, 0, 1))):
    fwd = (target - loc).normalized()
    z = -fwd
    x = (up.cross(z)).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x, loc.x),
                   (x.y, y.y, z.y, loc.y),
                   (x.z, y.z, z.z, loc.z),
                   (0, 0, 0, 1)))


def rot_z(v, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return Vector((c * v.x - s * v.y, s * v.x + c * v.y, v.z))


def find_mesh(name):
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        if o.name == name:
            return o
        data = o.data
        if data is not None and data.name in (name, name + ".001"):
            return o
    return None


def world_aabb(obj):
    ws = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [p.x for p in ws]
    ys = [p.y for p in ws]
    zs = [p.z for p in ws]
    return (Vector((min(xs), min(ys), min(zs))),
            Vector((max(xs), max(ys), max(zs))))


def mesh_centroid_world(obj):
    mesh = obj.data
    n = len(mesh.vertices)
    acc = Vector((0, 0, 0))
    for v in mesh.vertices:
        acc += obj.matrix_world @ v.co
    return acc / n


def main():
    t_all = time.time()
    args = cli()
    glb = Path(args.glb)
    hdri = Path(args.hdri)
    out = Path(args.out)
    (out / "beauty").mkdir(parents=True, exist_ok=True)
    (out / "masks").mkdir(parents=True, exist_ok=True)
    (out / "calib").mkdir(parents=True, exist_ok=True)

    glb_sha = sha256_of(glb)
    log("GLB_SHA256 %s" % glb_sha)
    if glb_sha != EXPECTED_GLB_SHA256:
        raise SystemExit("REFUSE: GLB sha256 mismatch (expected %s, got %s)"
                         % (EXPECTED_GLB_SHA256, glb_sha))
    hdri_sha = sha256_of(hdri)
    log("HDRI_SHA256 %s" % hdri_sha)

    sc = bpy.context.scene

    # ---- start from an empty scene (drop factory-startup Cube/Light/Cam) ----
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    log("SCENE_CLEARED")

    # ---- stock glTF import, defaults, no edits ----
    bpy.ops.import_scene.gltf(filepath=str(glb))
    imported = [o for o in bpy.context.selected_objects]
    log("IMPORTED_OBJECTS %d" % len(imported))

    try:
        import addon_utils
        importer_ver = None
        for m in addon_utils.modules():
            if m.__name__ == "io_scene_gltf2":
                v = m.bl_info.get("version", None)
                importer_ver = ".".join(str(x) for x in v) if v else None
    except Exception:
        importer_ver = None
    log("IMPORTER io_scene_gltf2 version=%s blender=%s"
        % (importer_ver, bpy.app.version_string))

    # ---- rest pose: drop every imported action, park armatures at REST ----
    action_names = sorted(a.name for a in bpy.data.actions)
    for o in bpy.data.objects:
        if o.animation_data is not None:
            o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    for arm in armatures:
        arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    anim_state = {"actions_found": action_names,
                  "actions_removed": action_names,
                  "armatures_set_rest": sorted(a.name for a in armatures)}
    log("ANIM actions_removed=%s armatures_rest=%s"
        % (action_names, anim_state["armatures_set_rest"]))

    # ---- body AABB (world), hair mesh excluded by construction ----
    body = find_mesh(BODY_MESH)
    if body is None:
        raise SystemExit("REFUSE: body mesh %r not found; mesh objects=%s"
                         % (BODY_MESH,
                            sorted((o.name, o.data.name if o.data else None)
                                   for o in bpy.data.objects
                                   if o.type == "MESH")))
    bb_min, bb_max = world_aabb(body)
    size = bb_max - bb_min
    centre = (bb_min + bb_max) * 0.5
    log("AABB min=%s max=%s size=%s" % (tuple(round(v, 5) for v in bb_min),
                                       tuple(round(v, 5) for v in bb_max),
                                       tuple(round(v, 5) for v in size)))

    # ---- facing: eyes centroid minus body centre, horizontal ----
    eyes = find_mesh(EYES_MESH)
    if eyes is None:
        raise SystemExit("REFUSE: eyes mesh %r not found; mesh objects=%s"
                         % (EYES_MESH,
                            sorted((o.name, o.data.name if o.data else None)
                                   for o in bpy.data.objects
                                   if o.type == "MESH")))
    fwd = mesh_centroid_world(eyes) - centre
    fwd.z = 0.0
    if fwd.length < 1e-4:
        raise SystemExit("REFUSE: degenerate facing vector")
    fwd = fwd / fwd.length
    log("FACING %s (eyes-centroid minus body-centre, horizontal)"
        % (tuple(round(v, 5) for v in fwd),))

    # ---- world: HDRI only, strength 1.0, Z rotation 0 ----
    world = bpy.data.worlds.new("P1A_WORLD")
    sc.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    out_node = nt.nodes.get("Material Output") or nt.nodes.get("World Output")
    tex = nt.nodes.new("ShaderNodeTexEnvironment")
    tex.image = bpy.data.images.load(str(hdri))
    # colorspace left at the as-loaded default for .hdr (scene-linear).
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Rotation"].default_value = (0.0, 0.0, 0.0)
    nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    log("WORLD hdri strength=1.0 zrot=0 (mapping node, generated coords)")

    # ---- cycles + colour management ----
    device_used = "CPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        devs = [(d.name, d.type, bool(d.use)) for d in prefs.devices]
        metal = [d for d in prefs.devices if d.type == "METAL"]
        if metal:
            for d in prefs.devices:
                d.use = (d.type == "METAL")
            sc.cycles.device = "GPU"
            device_used = "GPU/METAL"
        else:
            sc.cycles.device = "CPU"
            log("DEVICES no METAL in %s; using CPU" % devs)
    except Exception as e:
        sc.cycles.device = "CPU"
        log("DEVICES fallback CPU (%r)" % e)
    try:
        dev_list = [(d.name, d.type, bool(d.use)) for d in
                    bpy.context.preferences.addons["cycles"].preferences.devices]
    except Exception:
        dev_list = []
    log("DEVICE %s %s" % (device_used, dev_list))

    sc.render.engine = "CYCLES"
    sc.cycles.samples = int(args.samples)
    sc.cycles.seed = int(args.seed)
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.render.film_transparent = False
    vs = sc.view_settings
    vs.view_transform = "AgX"
    vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    color_mgmt = {"view_transform": vs.view_transform, "look": vs.look,
                  "exposure": vs.exposure, "gamma": vs.gamma,
                  "display_device": sc.display_settings.display_device}
    log("CYCLES samples=%d seed=%d device=%s denoiser=OIDN adaptive=off"
        % (sc.cycles.samples, sc.cycles.seed, device_used))
    log("COLOR %s" % color_mgmt)

    # ---- cameras, deterministic from AABB ----
    body_h = size.z
    head_h = body_h * HEAD_HEIGHT_FRAC
    head_target = Vector((centre.x, centre.y,
                          bb_max.z - HEAD_TOP_OFFSET_FRAC * body_h))
    d_head = (head_h / HEAD_FILL / 2.0) / math.tan(math.radians(HEAD_VFOV / 2.0))
    d_body = (body_h / BODY_FILL / 2.0) / math.tan(math.radians(BODY_VFOV / 2.0))
    log("HEAD_H assumed=%.5f target=%s d=%.5f"
        % (head_h, tuple(round(v, 5) for v in head_target), d_head))
    log("BODY_H %.5f target=%s d=%.5f"
        % (body_h, tuple(round(v, 5) for v in centre), d_body))

    specs = [
        ("head_front", head_target, fwd, d_head, HEAD_VFOV, HEAD_RES, HEAD_FILL),
        ("head_34", head_target, rot_z(fwd, YAW_DEG), d_head, HEAD_VFOV, HEAD_RES, HEAD_FILL),
        ("body_front", centre, fwd, d_body, BODY_VFOV, BODY_RES, BODY_FILL),
        ("body_34", centre, rot_z(fwd, YAW_DEG), d_body, BODY_VFOV, BODY_RES, BODY_FILL),
    ]
    import numpy as np
    Cb = np.array(C_T, dtype=np.float64)

    cam_recs = []
    cam_objs = {}
    for name, target, direction, dist, vfov, res, fill in specs:
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        loc = target + direction * dist
        cd = bpy.data.cameras.new(name)
        cd.sensor_fit = "VERTICAL"
        cd.sensor_width = 36.0
        cd.sensor_height = 24.0
        cd.lens = (cd.sensor_height / 2.0) / math.tan(math.radians(vfov / 2.0))
        cd.clip_start = 0.01
        cd.clip_end = 100.0
        co = bpy.data.objects.new(name, cd)
        sc.collection.objects.link(co)
        co.matrix_world = lookat_matrix(loc, target)
        sc.camera = co
        bpy.context.view_layer.update()
        got_vfov = math.degrees(cd.angle_y)
        if abs(got_vfov - vfov) > 1e-3:
            raise SystemExit("REFUSE: %s angle_y=%.6f != vfov %.6f"
                             % (name, got_vfov, vfov))
        cam_objs[name] = co
        Mw = co.matrix_world
        Rb = np.array([[Mw[0][0], Mw[0][1], Mw[0][2]],
                       [Mw[1][0], Mw[1][1], Mw[1][2]],
                       [Mw[2][0], Mw[2][1], Mw[2][2]]], dtype=np.float64)
        tb = np.array([Mw[0][3], Mw[1][3], Mw[2][3]], dtype=np.float64)
        Rt = Cb @ Rb @ Cb.T
        tt = Cb @ tb
        quat = Matrix(Rt.tolist()).to_quaternion()  # (w,x,y,z)
        # self-check: re-derive Blender matrix from the three record
        Rb2 = Cb.T @ Rt @ Cb
        tb2 = Cb.T @ tt
        diff = float(max(np.abs(Rb2 - Rb).max(), np.abs(tb2 - tb).max()))
        if diff >= 1e-5:
            raise SystemExit("REFUSE: camera self-check failed for %s (diff %g)"
                             % (name, diff))
        tgt_t = (Cb @ np.array([target.x, target.y, target.z])).tolist()
        rec = {"name": name, "resolution": [res[0], res[1]],
               "vfov_deg": vfov, "near": cd.clip_start, "far": cd.clip_end,
               "blender": {"matrix_world": [[float(Mw[r][c]) for c in range(4)]
                                            for r in range(4)]},
               "three": {"position": [float(v) for v in tt],
                         "target": [float(v) for v in tgt_t],
                         "up": [0, 1, 0],
                         "quaternion": [float(quat.x), float(quat.y),
                                        float(quat.z), float(quat.w)]},
               "framing": {"target_blender": [float(target.x), float(target.y),
                                              float(target.z)],
                           "distance_m": float(dist), "fill": fill,
                           "selfcheck_maxabsdiff": diff}}
        cam_recs.append(rec)
        log("CAM %s loc=%s vfov=%.1f lens=%.3f selfcheck=%.2e"
            % (name, [round(float(v), 5) for v in (loc.x, loc.y, loc.z)],
               vfov, cd.lens, diff))

    cameras_doc = {
        "glb": {"path": str(glb), "sha256": glb_sha},
        "hdri": {"path": str(hdri), "sha256": hdri_sha,
                 "strength": 1.0, "z_rotation_deg": 0},
        "aabb_world": {"min": [float(v) for v in bb_min],
                       "max": [float(v) for v in bb_max]},
        "facing_blender": [float(v) for v in fwd],
        "head_height_assumed_m": float(head_h),
        "yaw_deg_toward_subject_left": YAW_DEG,
        "cameras": cam_recs,
    }
    with open(out / "cameras.json", "w") as f:
        json.dump(cameras_doc, f, indent=2)
    log("WROTE cameras.json")

    # ---- beauty renders: one Cycles render per cam, saved twice ----
    timings = {}

    def save_views(stem_png, stem_exr=None):
        img = bpy.data.images["Render Result"]
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGB"
        sc.render.image_settings.color_depth = "16"
        img.save_render(str(stem_png))
        if stem_exr is not None:
            # OPEN_EXR output is scene-linear (view transform not applied).
            sc.render.image_settings.file_format = "OPEN_EXR"
            sc.render.image_settings.color_depth = "32"
            img.save_render(str(stem_exr))

    for rec in cam_recs:
        name = rec["name"]
        w, h = rec["resolution"]
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.resolution_percentage = 100
        sc.camera = cam_objs[name]
        bpy.context.view_layer.update()
        t0 = time.time()
        bpy.ops.render.render()
        dt = time.time() - t0
        timings["beauty_" + name] = dt
        save_views(out / "beauty" / (name + ".png"),
                   out / "beauty" / (name + ".exr"))
        log("BEAUTY %s %.1fs" % (name, dt))
    log("BEAUTY_METHOD single Cycles render per camera; Render Result saved "
        "via save_render as PNG16 (display-referred, AgX) then OPEN_EXR32 "
        "(scene-linear, no view transform)")

    # ---- ID masks: flat emission per category, 1 sample, black world ----
    emit_mats = {}
    for cat, rgba in MASK_COLORS.items():
        m = bpy.data.materials.new("P1A_MASK_" + cat)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            m.node_tree.nodes.remove(bsdf)
        outn = m.node_tree.nodes.get("Material Output")
        em = m.node_tree.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = rgba
        em.inputs["Strength"].default_value = 1.0
        m.node_tree.links.new(em.outputs["Emission"], outn.inputs["Surface"])
        emit_mats[cat] = m

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    swap = []  # (slot, original_material)
    seen_cats = set()
    for o in mesh_objs:
        for slot in o.material_slots:
            mat = slot.material
            mname = mat.name if mat is not None else None
            cat = mask_category(mname) if mname else None
            if cat is None:
                raise SystemExit("REFUSE: unmapped material %r on %r"
                                 % (mname, o.name))
            seen_cats.add(cat)
            if cat != "hidden":
                swap.append((slot, mat))
                slot.material = emit_mats[cat]
    log("MASK_SWAP slots=%d categories=%s" % (len(swap), sorted(seen_cats)))

    black_world = bpy.data.worlds.new("P1A_BLACK")
    black_world.use_nodes = True
    bbg = black_world.node_tree.nodes.get("Background")
    bbg.inputs["Color"].default_value = (0, 0, 0, 1.0)
    bbg.inputs["Strength"].default_value = 1.0

    prev_samples = sc.cycles.samples
    prev_seed = sc.cycles.seed
    prev_denoise = sc.cycles.use_denoising
    prev_adaptive = sc.cycles.use_adaptive_sampling
    prev_vt = (vs.view_transform, vs.look, vs.exposure, vs.gamma)
    sc.cycles.samples = 1
    sc.cycles.seed = 0
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    if hasattr(sc.cycles, "filter_width"):
        sc.cycles.filter_width = 0.01
        log("MASK filter_width=0.01")
    else:
        raise SystemExit("REFUSE: scene.cycles has no filter_width")
    sc.cycles.pixel_filter_type = "BOX"
    vs.view_transform = "Standard"
    vs.look = "None"
    vs.exposure = 0.0
    vs.gamma = 1.0
    sc.world = black_world  # black background for masks
    sc.render.film_transparent = False

    mask_counts = {}
    for rec in cam_recs:
        name = rec["name"]
        w, h = rec["resolution"]
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.resolution_percentage = 100
        sc.camera = cam_objs[name]
        bpy.context.view_layer.update()
        t0 = time.time()
        bpy.ops.render.render()
        dt = time.time() - t0
        timings["mask_" + name] = dt
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGB"
        sc.render.image_settings.color_depth = "8"
        mask_path = out / "masks" / (name + ".png")
        bpy.data.images["Render Result"].save_render(str(mask_path))
        # Count from the file on disk (loaded back), so the numbers
        # describe the artifact, not the in-memory buffer.
        chk = bpy.data.images.load(str(mask_path))
        px = np.array(chk.pixels[:],
                      dtype=np.float64).reshape(-1, 4)[:, :3]
        bpy.data.images.remove(chk)
        counts = {}
        counts["skin"] = int((((px[:, 0] > 0.9) & (px[:, 1] < 0.1)
                               & (px[:, 2] < 0.1))).sum())
        counts["eyes"] = int((((px[:, 1] > 0.9) & (px[:, 0] < 0.1)
                               & (px[:, 2] < 0.1))).sum())
        counts["clothing"] = int((((px[:, 2] > 0.9) & (px[:, 0] < 0.1)
                                   & (px[:, 1] < 0.1))).sum())
        counts["hair"] = int((((px[:, 0] > 0.9) & (px[:, 1] > 0.9)
                               & (px[:, 2] < 0.1))).sum())
        counts["teeth"] = int((((px[:, 0] > 0.9) & (px[:, 2] > 0.9)
                                & (px[:, 1] < 0.1))).sum())
        counts["black"] = int((((px.max(axis=1)) < 0.1)).sum())
        counts["other"] = int(px.shape[0] - sum(counts.values()))
        mask_counts[name] = counts
        log("MASK %s %.1fs %s" % (name, dt, counts))

    for slot, mat in swap:
        slot.material = mat
    sc.cycles.samples = prev_samples
    sc.cycles.seed = prev_seed
    sc.cycles.use_denoising = prev_denoise
    sc.cycles.use_adaptive_sampling = prev_adaptive
    vs.view_transform, vs.look, vs.exposure, vs.gamma = prev_vt
    sc.world = world
    log("MASK restored %d slots, HDRI world back" % len(swap))

    # ---- calibration spheres at head_front framing, subject hidden ----
    for o in imported:
        o.hide_render = True
    for co in cam_objs.values():
        co.hide_render = False
    head_rec = cam_recs[0]
    w, h = head_rec["resolution"]
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.camera = cam_objs["head_front"]
    cam_mat = cam_objs["head_front"].matrix_world
    right = Vector((cam_mat[0][0], cam_mat[1][0], cam_mat[2][0])).normalized()
    depth_pt = Vector(head_rec["framing"]["target_blender"])
    sph_r = 0.035
    gap = 0.048
    calib_info = {"radius_m": sph_r, "gap_m": gap,
                  "depth_point_blender": [float(v) for v in depth_pt]}
    for side, kind in ((-1, "chrome"), (1, "grey")):
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=64, ring_count=32, radius=sph_r,
            location=depth_pt + right * (side * gap))
        s = bpy.context.view_layer.objects.active
        s.name = "P1A_CALIB_" + kind
        m = bpy.data.materials.new("P1A_CALIB_" + kind)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if kind == "chrome":
            bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
            bsdf.inputs["Metallic"].default_value = 1.0
            bsdf.inputs["Roughness"].default_value = 0.0
        else:
            bsdf.inputs["Base Color"].default_value = (0.18, 0.18, 0.18, 1)
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.5
        s.data.materials.clear()
        s.data.materials.append(m)
        s.hide_render = False
    # shade smooth
    for s in (bpy.data.objects["P1A_CALIB_chrome"],
              bpy.data.objects["P1A_CALIB_grey"]):
        for poly in s.data.polygons:
            poly.use_smooth = True
    bpy.context.view_layer.update()
    t0 = time.time()
    bpy.ops.render.render()
    timings["calib_spheres"] = time.time() - t0
    save_views(out / "calib" / "spheres.png",
               out / "calib" / "spheres.exr")
    log("CALIB spheres.png/exr %.1fs" % timings["calib_spheres"])

    # ---- manifest ----
    files = {}
    for p in sorted(out.rglob("*")):
        if p.is_file() and p.name not in ("manifest.json",):
            files[str(p.relative_to(out))] = sha256_of(p)
    manifest = {
        "blender_version": bpy.app.version_string,
        "importer": {"addon": "io_scene_gltf2", "version": importer_ver,
                     "options": "defaults (stock import, no material edits, "
                                "no modifiers added, geometry untouched)"},
        "animation": anim_state,
        "device": device_used,
        "devices_seen": dev_list,
        "samples": int(args.samples),
        "seed": int(args.seed),
        "adaptive_sampling": False,
        "denoiser": "OpenImageDenoise",
        "light_paths": "defaults",
        "color_management": color_mgmt,
        "mask_render": {"samples": 1, "seed": 0, "filter_width": 0.01,
                        "pixel_filter": "BOX", "view_transform": "Standard",
                        "background": "black", "denoise": False},
        "exr_method": "single Cycles render per camera; Render Result saved "
                      "via save_render as PNG16 (display-referred, AgX) then "
                      "OPEN_EXR32 float (scene-linear, no view transform)",
        "calibration": calib_info,
        "wall_seconds": timings,
        "total_wall_seconds": time.time() - t_all,
        "mask_pixel_counts": mask_counts,
        "files_sha256": files,
    }
    with open(out / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    log("WROTE manifest.json total=%.1fs" % manifest["total_wall_seconds"])

    # ---- gate: masks must show skin; head cams must show eyes ----
    for name, counts in mask_counts.items():
        if counts["skin"] <= 0:
            raise SystemExit("REFUSE: mask %s has no skin pixels" % name)
        if name.startswith("head_") and counts["eyes"] <= 0:
            raise SystemExit("REFUSE: mask %s has no eye pixels" % name)
    log("GATES_OK every mask has skin>0; head cams have eyes>0")
    log("RESULT_DIR %s" % out)


main()

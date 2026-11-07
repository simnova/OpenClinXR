"""Hair image 04a: EXPOSURE-ONLY fix of the overexposed image03b frame.

Run from repo root, fresh process:
  MISE_TRUSTED_CONFIG_PATHS=$PWD OPENCLINXR_HAIR_EDITOR_BLEND=<hair.blend> blender \\
    --background --python tools/openclinxr/evidence/hair-image/image04a.py -- \\
    --out-dir tools/openclinxr/evidence/hair-image

Stage order: setup -> mask -> delete -> sockets -> sweep -> select -> render -> compose -> measure.

Lever: overall exposure ONLY (scene.view_settings.exposure; light powers
scaled by one shared lightScale). Controls: Amount 4, duplicate Radius 0.002,
profile radius 0.0001, masks, clothing, camera, hair BSDF, light POSITIONS and
relative ratios.
"""
import argparse
import copy as _copy_module  # noqa: F401 (kept for parity with image02 helpers)
import json
import math
import os
import subprocess
import sys
import traceback

import numpy as _np
from PIL import Image as PILImage

STAGES = ("setup", "mask", "delete", "sockets", "sweep", "select", "render", "compose", "measure")


class _SocketReadbackMismatch(Exception):
    def __init__(self, got_amount, got_radius):
        super().__init__("socket read-back mismatch")
        self.got_amount = got_amount
        self.got_radius = got_radius

MACROS = {"gender": 0.0, "age": 0.6191, "weight": 0.5024, "muscle": 0.5}
HAIR_ASSET = "straight_hair_to_shoulder"
PART_HALF_WIDTH = 0.0015  # 3 mm seam
FRONT_Y_MARGIN = 0.02
AISHA_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb"
PREV_BEST = "tools/openclinxr/evidence/hair-cards-probe/arm-c-head.png"
TARGET_GIT_PATH = ("packages/openclinxr/factory-stations/src/hair_editor/evidence/"
                   "target-front-imagine.png")
TARGET_GIT_BRANCH = "wt/hair-editor-apply"
TARGET_GIT_SHA = "e55b8ede9"
EVAL_SCRIPT = "tools/openclinxr/evidence/hair-eval/evaluate.py"


def fail(out_dir, stage, err, extra=None):
    rep = {
        "ok": False,
        "stage": stage,
        "error": err,
        "blenderVersion": extra.get("blenderVersion", "unknown") if extra else "unknown",
    }
    if extra:
        rep.update({k: v for k, v in extra.items() if k != "blenderVersion"})
    try:
        import bpy  # noqa
        rep["blenderVersion"] = bpy.app.version_string
    except Exception:
        pass
    with open(os.path.join(out_dir, "row4a.json"), "w") as h:
        json.dump(rep, h, indent=1)
    print(err[:4000])


def track_cam(cam, target_loc):
    from mathutils import Vector
    d = Vector(target_loc) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def setup_rig(head_cx, crown_z):
    """CONTROL (image02 verbatim): grey world, 3 area lights, 50mm cam at front."""
    import bpy
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("OCLX_grey_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs["Strength"].default_value = 0.3
    sc.world = world
    tgt = (head_cx, 0.0, crown_z - 0.12)
    def area(name, loc, power, size, aim):
        d = bpy.data.lights.new(name, "AREA")
        d.energy = power
        d.size = size
        o = bpy.data.objects.new(name, d)
        bpy.context.scene.collection.objects.link(o)
        o.location = loc
        track_cam(o, aim)
        return o
    area("OCLX_key", (head_cx - 1.2, -1.5, crown_z + 0.6), 150.0, 1.4, tgt)
    area("OCLX_fill", (head_cx + 1.5, -1.0, crown_z + 0.2), 40.0, 1.7, tgt)
    area("OCLX_rim", (head_cx + 1.0, 1.2, crown_z + 0.8), 80.0, 1.0, tgt)
    cam = bpy.data.objects.get("OCLX_cam")
    if cam is None:
        cam_data = bpy.data.cameras.new("OCLX_cam")
        cam_data.lens = 50
        cam = bpy.data.objects.new("OCLX_cam", cam_data)
        bpy.context.scene.collection.objects.link(cam)
    sc.camera = cam
    target = (head_cx, 0.0, crown_z - 0.12)
    cam.location = (head_cx, -0.7, crown_z - 0.10)
    track_cam(cam, target)
    return cam, target


def aim_renders(head_cx, crown_z, out_dir,
                front_name="front4a.png", three_name="three_quarter4a.png"):
    import bpy
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    if sc.cycles.samples < 128:
        sc.cycles.samples = 128
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    cam, target = setup_rig(head_cx, crown_z)
    sc.render.filepath = os.path.join(out_dir, front_name)
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    # three_quarter: same camera rotated 40 deg about Z around head centre
    ang = math.radians(40.0)
    pivot = Vector(target)
    off = Vector(cam.location) - pivot
    ca, sa = math.cos(ang), math.sin(ang)
    off = Vector((off.x * ca - off.y * sa, off.x * sa + off.y * ca, off.z))
    cam.location = pivot + off
    track_cam(cam, target)
    sc.render.filepath = os.path.join(out_dir, three_name)
    bpy.ops.render.render(write_still=True)


def ensure_head_material(head_obj):
    import bpy
    if len(head_obj.data.materials) == 0:
        mat = bpy.data.materials.new("OCLX_head_skin")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = (0.75, 0.60, 0.50, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.6
        head_obj.data.materials.append(mat)


def compose_3up(out_dir):
    from PIL import Image, ImageDraw
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    # target: git show from wt branch, fallback to /tmp extract
    target_png = os.path.join(out_dir, "_target2.png")
    if not os.path.exists(target_png):
        spec = "%s:%s" % (TARGET_GIT_BRANCH, TARGET_GIT_PATH)
        repo = os.getcwd()
        try:
            blob = subprocess.run(
                ["git", "show", spec], cwd=repo, capture_output=True, check=True)
            with open(target_png, "wb") as h:
                h.write(blob.stdout)
        except Exception:
            pass
    prev_png = os.path.join(out_dir, "front.png")
    front_png = os.path.join(out_dir, "front3b.png")
    panels = []
    for label, path in (("target", target_png),
                        ("previous best", prev_png),
                        ("new front", front_png)):
        im = Image.open(path).convert("RGB")
        w, h = im.size
        nw = max(1, round(w * 512.0 / h))
        im = im.resize((nw, 512), resample)
        panels.append((label, im))
    total_w = sum(im.size[0] for _, im in panels)
    sheet = Image.new("RGB", (total_w, 512 + 28), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    x = 0
    for label, im in panels:
        draw.text((x + 8, 6), label, fill=(255, 255, 0))
        sheet.paste(im, (x, 28))
        x += im.size[0]
    out = os.path.join(out_dir, "3up2.png")
    sheet.save(out, compress_level=1)
    if os.path.getsize(out) < 300000:
        sheet.save(out, compress_level=0)
    return out


def run_evaluator(out_dir):
    front = os.path.join(out_dir, "front.png")
    eval_path = os.path.join(os.getcwd(), EVAL_SCRIPT)
    proc = subprocess.run(
        ["python3", eval_path, front, "--json"],
        capture_output=True, text=True, cwd=os.getcwd())
    if proc.returncode != 0:
        raise RuntimeError("evaluator failed: %s" % (proc.stderr or proc.stdout))
    return json.loads(proc.stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--cells", type=int, default=9)
    ap.add_argument("--iterations", type=int, default=6)
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:]
    args = ap.parse_args(argv)
    out_dir = args.out_dir
    max_cells = max(1, min(9, args.cells))
    os.makedirs(out_dir, exist_ok=True)

    import bpy

    blender_version = bpy.app.version_string
    stage = "setup"
    eye_source = "unknown"
    crown_z = brow_z = hairline_z = 0.0
    deleted_fringe = deleted_part = 0
    remaining = 0
    has_surface_uv = False
    head_source = "unknown"
    material_fallback = None
    hidden_names = []
    shown_clothing_names = []
    strands_before = 0
    strands_after = 0
    hair_radius = 0.0
    dup_amount_socket = "unknown"
    cycles_samples = 128

    try:
        # ---- (1) SETUP exactly as probe.py ----
        bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
        bpy.ops.preferences.addon_enable(module="io_scene_gltf2")
        from bl_ext.user_default.mpfb.services.humanservice import HumanService
        from bl_ext.user_default.mpfb.services.targetservice import TargetService
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete(use_global=False)
        macros = TargetService.get_default_macro_info_dict()
        macros.update(MACROS)
        basemesh = HumanService.create_human(
            mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
            feet_on_ground=True, scale=0.1, macro_detail_dict=macros)
        TargetService.bake_targets(basemesh)
        bpy.context.view_layer.update()
        basemesh.name = "Human"
        bpy.context.view_layer.objects.active = basemesh
        bpy.ops.mpfb.setup_hair_operator()
        bpy.ops.mpfb.apply_hair_operator(hair_asset=HAIR_ASSET)
        curves = bpy.context.view_layer.objects.active
        if curves is None or curves.type != "CURVES":
            curves = bpy.data.objects.get(HAIR_ASSET)
        if curves is None or curves.type != "CURVES":
            raise RuntimeError("no curves object after apply_hair_operator")
        bpy.ops.object.select_all(action="DESELECT")
        curves.select_set(True)
        bpy.context.view_layer.objects.active = curves
        # Realize DENSE strands: base object holds 252 guides; the
        # duplicate/interpolate modifier evaluates to 10,191. Mask the dense copy.
        deps = bpy.context.evaluated_depsgraph_get()
        ev = curves.evaluated_get(deps)
        dense_data = ev.data.copy()
        dense = bpy.data.objects.new("OCLX_dense_hair", dense_data)
        bpy.context.scene.collection.objects.link(dense)
        dense.matrix_world = curves.matrix_world.copy()
        curves.hide_render = True
        curves.hide_viewport = True
        curves = dense
        bpy.ops.object.select_all(action="DESELECT")
        curves.select_set(True)
        bpy.context.view_layer.objects.active = curves
        n_curves = len(curves.data.curves)
        print("DBG dense n_curves=%d" % n_curves)

        # ---- import Aisha head AFTER hair work (or basemesh fallback) ----
        bpy.context.view_layer.update()
        aisha_path = os.path.join(os.getcwd(), AISHA_GLB)
        head_obj = basemesh
        if os.path.exists(aisha_path):
            try:
                before = set(bpy.data.objects)
                bpy.ops.import_scene.gltf(filepath=aisha_path)
                new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
                if new:
                    head_obj = max(new, key=lambda o: len(o.data.vertices))
                    head_source = "aisha-glb"
                else:
                    head_source = "basemesh"
            except Exception as e:
                head_source = "basemesh-import-failed: %s" % e
        else:
            head_source = "basemesh"
        # Isolate: render ONLY dense curves + one head. Hide the Aisha mesh
        # hair (its own blunt fringe), clothes, masks/helpers, and the MPFB
        # basemesh body so nothing else covers the face.
        HIDE_SUB = ("hair",
                    "mask", "helper", "glasses", "hat", "cap_")
        for o in bpy.data.objects:
            if o is curves or o is head_obj:
                continue
            n = o.name.lower()
            if o is basemesh or any(s in n for s in HIDE_SUB):
                o.hide_render = True
                o.hide_viewport = True
                hidden_names.append(o.name)
            elif any(t in n for t in ("cloth", "shirt", "pant", "jean", "shoe", "sweater")):
                shown_clothing_names.append(o.name)
        if head_source == "basemesh":
            head_obj = basemesh
            basemesh.hide_render = False
            basemesh.hide_viewport = False
        print("DBG head=%s kept head_obj=%s" % (
            head_source, head_obj.name if head_obj else None))

        # ---- (2) HEAD FRAME in world space (BASEMESH: hair's own frame) ----
        mw = basemesh.matrix_world
        verts = [mw @ v.co for v in basemesh.data.vertices]
        xs = [v.x for v in verts]
        ys = [v.y for v in verts]
        zs = [v.z for v in verts]
        crown_z = max(zs)
        head_cx = (min(xs) + max(xs)) / 2
        head_cy = (min(ys) + max(ys)) / 2
        apex_y = verts[zs.index(crown_z)].y
        # eye-socket centre: vertex group or eye objects, else fallback
        brow_z = None
        try:
            vg_names = [vg.name for vg in head_obj.vertex_groups]
            eye_vg = next((n for n in vg_names if "eye" in n.lower() and "socket" in n.lower()), None)
            if eye_vg is None:
                eye_vg = next((n for n in vg_names if "eye" in n.lower()), None)
            if eye_vg is not None:
                idx = head_obj.vertex_groups[eye_vg].index
                pts = [mw @ v.co for v in head_obj.data.vertices
                       if any(g.group == idx for g in v.groups)]
                if pts:
                    brow_z = sum(p.z for p in pts) / len(pts)
                    eye_source = "vertex-group:%s" % eye_vg
        except Exception:
            pass
        if brow_z is None:
            eye_objs = [o for o in bpy.data.objects if "eye" in o.name.lower() and o.type == "MESH"]
            if eye_objs:
                c = sum((o.matrix_world.translation.z for o in eye_objs), 0.0) / len(eye_objs)
                brow_z = c
                eye_source = "eye-objects"
        if brow_z is None:
            brow_z = crown_z - 0.11
            eye_source = "fallback:crown-0.11"
        hairline_z = brow_z + 0.62 * (crown_z - brow_z)
        # head-centre y from the skull cap (basemesh verts above hairline),
        # not the whole-body bbox: helpers drag the bbox centre forward.
        upper = [v for v in verts if v.z > hairline_z]
        head_cy_head = (sum(v.y for v in upper) / len(upper)) if upper else head_cy
        front_y_thresh = head_cy_head - FRONT_Y_MARGIN

        # ---- (3) MASK on roots ----
        stage = "mask"
        cmw = curves.matrix_world
        roots = [cmw @ curves.data.curves[i].points[0].position
                 for i in range(n_curves)]
        rz = sorted(r.z for r in roots)
        ry = sorted(r.y for r in roots)
        rx = sorted(r.x for r in roots)
        def pct(s, q):
            return s[min(n_curves - 1, int(q * n_curves))]
        print("DBG frame head_cx=%.4f head_cy=%.4f apex_y=%.4f hairlineZ=%.4f head_cy_head=%.4f front_thresh=%.4f" % (
            head_cx, head_cy, apex_y, hairline_z, head_cy_head, front_y_thresh))
        print("DBG rootz min=%.4f p10=%.4f p50=%.4f p90=%.4f max=%.4f nBelowHairline=%d" % (
            rz[0], pct(rz, 0.10), pct(rz, 0.50), pct(rz, 0.90), rz[-1],
            sum(1 for r in roots if r.z < hairline_z)))
        print("DBG rooty min=%.4f p10=%.4f p50=%.4f p90=%.4f max=%.4f nFront=%d" % (
            ry[0], pct(ry, 0.10), pct(ry, 0.50), pct(ry, 0.90), ry[-1],
            sum(1 for r in roots if r.y < head_cy - FRONT_Y_MARGIN)))
        print("DBG rootx min=%.4f p50=%.4f max=%.4f nSeam=%d" % (
            rx[0], pct(rx, 0.50), rx[-1],
            sum(1 for r in roots if abs(r.x - head_cx) < PART_HALF_WIDTH)))
        doomed = set()
        for i in range(n_curves):
            root = cmw @ curves.data.curves[i].points[0].position
            if root.z < hairline_z and root.y < front_y_thresh:
                doomed.add(i)  # FRINGE
            elif abs(root.x - head_cx) < PART_HALF_WIDTH and root.y <= apex_y:
                doomed.add(i)  # PART 3 mm seam, not behind crown apex
        # recount by class for the report
        deleted_fringe = sum(
            1 for i in range(n_curves)
            if (cmw @ curves.data.curves[i].points[0].position).z < hairline_z
            and (cmw @ curves.data.curves[i].points[0].position).y < front_y_thresh)
        deleted_part = len(doomed) - deleted_fringe

        # ---- delete via geometry-nodes Delete Geometry on a per-curve boolean ----
        stage = "delete"
        attr = curves.data.attributes.get("doomed")
        if attr is None:
            attr = curves.data.attributes.new("doomed", "BOOLEAN", "CURVE")
        for i in range(n_curves):
            attr.data[i].value = (i in doomed)
        print("DBG attr domain=%s datalen=%d trueback=%d" % (
            attr.domain, len(attr.data),
            sum(1 for i in range(n_curves) if attr.data[i].value)))
        print("DBG n_curves=%d doomed=%d" % (n_curves, len(doomed)))
        ng = bpy.data.node_groups.new("OCLX_doom_delete", "GeometryNodeTree")
        try:
            ng.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
            ng.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
        except Exception:
            pass
        nin = ng.nodes.new("NodeGroupInput")
        nout = ng.nodes.new("NodeGroupOutput")
        nattr = ng.nodes.new("GeometryNodeInputNamedAttribute")
        try:
            nattr.data_type = "BOOLEAN"
        except Exception:
            pass
        try:
            nattr.inputs["Name"].default_value = "doomed"
        except Exception:
            pass
        ndel = ng.nodes.new("GeometryNodeDeleteGeometry")
        try:
            ndel.domain = "CURVE"
        except Exception:
            pass
        ng.links.new(nin.outputs[0], ndel.inputs[0])
        src = nattr.outputs[0]
        ng.links.new(src, ndel.inputs[1])
        ng.links.new(ndel.outputs[0], nout.inputs[0])
        bpy.ops.object.select_all(action="DESELECT")
        curves.select_set(True)
        bpy.context.view_layer.objects.active = curves
        mod = curves.modifiers.new("OCLX_doom_delete", "NODES")
        mod.node_group = ng
        bpy.ops.object.modifier_apply(modifier=mod.name)
        try:
            curves.data.attributes.remove(curves.data.attributes.get("doomed"))
        except Exception:
            pass
        remaining = len(curves.data.curves)
        print("DBG remaining=%d" % remaining)
        strands_before = remaining

        # ---- sockets: resolve Amount + Radius by NAME -> IDENTIFIER, set by
        # identifier on the modifier, READ BACK from the modifier. ----
        stage = "sockets"
        pack = os.environ.get("OPENCLINXR_HAIR_EDITOR_BLEND", "")
        if not pack or not os.path.exists(pack):
            cand = os.path.expanduser(
                "~/.openclinxr-tools/haireditor/unpacked/hair/haireditor/hair.blend")
            if os.path.exists(cand):
                pack = cand
        if not pack or not os.path.exists(pack):
            raise RuntimeError("hair pack blend not found (OPENCLINXR_HAIR_EDITOR_BLEND) Error")
        with bpy.data.libraries.load(pack, link=False) as (src_lib, dst_lib):
            names = [n for n in src_lib.node_groups
                     if n in ("Duplicate Hair Curves", "Set Hair Curve Profile")]
            if "Duplicate Hair Curves" not in names:
                raise RuntimeError("Duplicate Hair Curves missing from pack Error: %s" % names)
            dst_lib.node_groups = names
        dup = bpy.data.node_groups.get("Duplicate Hair Curves")
        prof = bpy.data.node_groups.get("Set Hair Curve Profile")
        dup_sockets = [(s.name, s.identifier) for s in dup.interface.items_tree]
        print("DBG dup sockets: %s" % dup_sockets)
        # Amount + Radius resolved by name -> identifier.
        def socket_id(name):
            for s in dup.interface.items_tree:
                if s.name == name and getattr(s, "in_out", "") == "INPUT":
                    return s.identifier
            return None
        amount_key = socket_id("Amount")
        radius_key = socket_id("Radius")
        if amount_key is None:
            raise RuntimeError("Duplicate Hair Curves has no Amount input Error: %s" % dup_sockets)
        if radius_key is None:
            raise RuntimeError("Duplicate Hair Curves has no Radius input Error: %s" % dup_sockets)
        # Record group defaults for Distribution Shape and Seed.
        dist_default = seed_default = viewport_default = even_default = tip_default = None
        try:
            pass
        except Exception:
            pass
        for s in dup.interface.items_tree:
            if getattr(s, "in_out", "") != "INPUT":
                continue
            dv = None
            try:
                dv = s.default_value
                if hasattr(dv, "__len__") and not isinstance(dv, (str, bytes)):
                    dv = list(dv)
            except Exception:
                dv = None
            if s.name == "Distribution Shape":
                dist_default = dv
            elif s.name == "Seed":
                seed_default = dv
            elif s.name == "Viewport Amount":
                viewport_default = dv
            elif s.name == "Even Thickness":
                even_default = dv
            elif s.name == "Tip Roundness":
                tip_default = dv
        print("DBG amount_key=%s radius_key=%s dist=%s seed=%s" % (
            amount_key, radius_key, dist_default, seed_default))

        # ---- MATERIAL (rig/BSDF are CONTROLS; keep stage enum: stay in sockets) ----
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        mat = bpy.data.materials.new("OCLX_hair_dark")
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        nodes.clear()
        out = nodes.new("ShaderNodeOutputMaterial")
        try:
            hair = nodes.new("ShaderNodeBsdfHairPrincipled")
            try:
                hair.parametrization = "MELANIN"
            except Exception:
                pass
            try:
                hair.parametrization = "HUANG"
            except Exception:
                pass
            for sock, val in (("Melanin", 0.80), ("Melanin Redness", 0.6),
                              ("Roughness", 0.25), ("Radial Roughness", 0.2),
                              ("Coat", 0.05), ("IOR", 1.55),
                              ("Random Color", 0.03), ("Random Roughness", 0.1)):
                if sock in hair.inputs:
                    hair.inputs[sock].default_value = val
            if "Tint" in hair.inputs:
                hair.inputs["Tint"].default_value = (0.03, 0.02, 0.01, 1.0)
            if not hair.outputs or not out.inputs:
                raise RuntimeError("hair shader has no outputs/inputs")
            links.new(hair.outputs[0], out.inputs["Surface"])
        except Exception as e:
            material_fallback = "principled-bsdf: %s" % e
            nodes.clear()
            out = nodes.new("ShaderNodeOutputMaterial")
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.inputs["Base Color"].default_value = (0.03, 0.02, 0.01, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.3
            links.new(bsdf.outputs[0], out.inputs["Surface"])
        curves.data.materials.clear()
        curves.data.materials.append(mat)
        ensure_head_material(head_obj)

        # ---- reference count for faceSkinRatio (image01 front.png, rescaled) ----
        def skin_band_count(png_path, size=None):
            im = PILImage.open(png_path).convert("RGB")
            if size is not None:
                im = im.resize(size, PILImage.BILINEAR)
            a = _np.asarray(im).astype(_np.float64) / 255.0
            H, W, _ = a.shape
            lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
            band = lum[int(H * 0.30):int(H * 0.50), int(W * 0.30):int(W * 0.70)]
            return int((band > 0.55).sum())

        ref_front = os.path.join(out_dir, "front.png")
        ref_count = skin_band_count(ref_front, size=(512, 512))
        print("DBG ref skin band count=%d" % ref_count)

        def run_measure(png_path):
            env = dict(os.environ)
            env["MISE_TRUSTED_CONFIG_PATHS"] = os.getcwd()
            mpath = os.path.abspath(os.path.join(
                os.getcwd(), "tools/openclinxr/evidence/hair-image/measure.py"))
            proc = subprocess.run(
                ["python3", mpath, os.path.abspath(png_path)],
                capture_output=True, text=True, cwd=os.getcwd(), env=env)
            if proc.returncode != 0:
                raise RuntimeError("measure failed Error: %s" % (proc.stderr or proc.stdout))
            return json.loads(proc.stdout)

        # ---- EXPOSURE BISECTION: fixed Amount 4 / Radius 0.002 /
        # profile Radius 0.0001 (CONTROLS), iterate exposureStops only ----
        # Reset per cell by removing all OCLX_dup/OCLX_hair modifiers
        # (profile + dup are APPLIED, so restore from a saved data copy).
        stage = "sweep"
        setup_rig(head_cx, crown_z)  # CONTROL rig, same as image02
        # Base light powers (CONTROL positions/ratios; sole lever = shared scale).
        BASE_POWERS = {"OCLX_key": 150.0, "OCLX_fill": 40.0, "OCLX_rim": 80.0}
        sc.render.resolution_x = 512
        sc.render.resolution_y = 512
        sc.cycles.samples = 64
        try:
            sc.cycles.use_denoising = False
        except Exception:
            pass
        sweep_grid = [(4, 0.002)]
        cells = []
        thumb_paths = []
        # Snapshot the masked base geometry: copy curves data once; per cell,
        # restore by swapping a fresh copy back onto the object (modifiers are
        # APPLIED, so they cannot be un-applied).
        sc = bpy.context.scene
        base_data = curves.data.copy()
        base_data.use_fake_user = True  # pin: 0-user datablocks can be purged

        def restore_base(ro):
            fresh = base_data.copy()
            old = ro.data
            ro.data = fresh
            try:
                bpy.data.curves.remove(old)
            except Exception:
                pass
            for m in [m for m in ro.modifiers if m.name.startswith("OCLX_")]:
                try:
                    ro.modifiers.remove(m)
                except Exception:
                    pass
            return ro

        def apply_cell_ro(amount, radius, ro):
            # CONTROL thickness: profile Radius 0.0001 m everywhere, read back.
            prof_radius_readback = None
            if prof is not None:
                modp = ro.modifiers.new("OCLX_hair_profile", "NODES")
                modp.node_group = prof
                prof_key = None
                for s in prof.interface.items_tree:
                    if s.name == "Radius" and getattr(s, "in_out", "") == "INPUT":
                        prof_key = s.identifier
                        break
                if prof_key is None:
                    prof_key = "Radius"
                modp[prof_key] = 0.0001
                # Set profile sockets by IDENTIFIER (names differ: Density->Socket_0).
                _prof_id = {}
                for s2 in prof.interface.items_tree:
                    if getattr(s2, "in_out", "") == "INPUT":
                        _prof_id[s2.name] = s2.identifier
                def _pset(_name, _val):
                    _id = _prof_id.get(_name)
                    if _id is None:
                        return
                    try:
                        modp[_id] = _val
                    except Exception:
                        pass
                _pset("Density", 1.0)
                _pset("Length", 1.0)
                _pset("Replace Radius", True)
                _pset("Radius", 0.0001)
                _pset("Shape", 0.5)
                _pset("Factor Min", 0.0)
                _pset("Factor Max", 1.0)
                prof_radius_readback = float(modp[prof_key]) if not hasattr(modp[prof_key], "__len__") else float(list(modp[prof_key])[0])
                if abs(prof_radius_readback - 0.0001) > 1e-9:
                    raise RuntimeError(
                        "profile Radius read-back %s != 0.0001 Error" % prof_radius_readback)
                bpy.ops.object.select_all(action="DESELECT")
                ro.select_set(True)
                bpy.context.view_layer.objects.active = ro
                bpy.ops.object.modifier_apply(modifier=modp.name)
            mod = ro.modifiers.new("OCLX_dup_children", "NODES")
            mod.node_group = dup
            # Set by IDENTIFIER, then read back from the modifier.
            try:
                mod[amount_key] = amount
            except Exception:
                raise RuntimeError("cannot set Amount socket Error: %s" % amount_key)
            try:
                mod[radius_key] = radius
            except Exception:
                raise RuntimeError("cannot set Radius socket Error: %s" % radius_key)
            got_amount = int(mod[amount_key])
            got_radius = float(mod[radius_key])
            if got_amount != amount or abs(got_radius - radius) > 1e-9:
                fail(out_dir, "sockets",
                     "Error: modifier read-back differs: wrote Amount=%s Radius=%s, "
                     "read Amount=%s Radius=%s" % (amount, radius, got_amount, got_radius),
                     {"blenderVersion": blender_version, "dupSockets": dup_sockets,
                      "wrote": {"amount": amount, "radius": radius},
                      "readBack": {"amount": got_amount, "radius": got_radius},
                      "cells": [], "selected": None,
                      "strandsBefore": strands_before, "remaining": remaining})
                raise _SocketReadbackMismatch(got_amount, got_radius)
            bpy.ops.object.select_all(action="DESELECT")
            ro.select_set(True)
            bpy.context.view_layer.objects.active = ro
            bpy.ops.object.modifier_apply(modifier=mod.name)
            return got_amount, got_radius

        def apply_exposure(stops, light_scale):
            """Sole lever: shared lightScale on 3 area lights + view exposure."""
            sc.view_settings.exposure = stops
            for lname, base in BASE_POWERS.items():
                lo = bpy.data.objects.get(lname)
                if lo is not None and lo.data is not None:
                    lo.data.energy = base * light_scale

        # Apply FIXED geometry once (CONTROL: Amount 4 / Radius 0.002).
        ro = restore_base(curves)
        apply_cell_ro(4, 0.002, ro)
        ro.data.materials.clear()
        ro.data.materials.append(mat)
        bpy.context.view_layer.update()
        try:
            deps = bpy.context.evaluated_depsgraph_get()
            eo = ro.evaluated_get(deps)
            ec = getattr(getattr(eo, "data", None), "curves", None)
            sa = len(ec) if ec is not None else strands_before
        except Exception:
            sa = strands_before
        strands_after = sa
        expected_sa = strands_before * 5
        print("GEO amount=4 radius=0.002 after=%d expected=%d" % (sa, expected_sa))

        # ---- exposure bisection in [-3.0, 0.0], at most --iterations ----
        iterations = []
        lo, hi = -3.0, 0.0
        best = None
        for ci in range(max(1, args.iterations)):
            stops = (lo + hi) / 2.0
            light_scale = 2.0 ** stops
            apply_exposure(stops, light_scale)
            cell_png = os.path.join(out_dir, "_cell%d.png" % ci)
            sc.render.filepath = cell_png
            bpy.ops.render.render(write_still=True)
            meas = run_measure(cell_png)
            face_lum = float(meas.get("faceMeanLuminance", -1))
            bg_lum = float(meas.get("backgroundLuminance", -1))
            in_face = 0.55 <= face_lum <= 0.70
            in_bg = 0.45 <= bg_lum <= 0.55
            iterations.append({
                "exposureStops": stops, "lightScale": light_scale,
                "faceMeanLuminance": face_lum, "backgroundLuminance": bg_lum,
                "meanHairLuminance": meas.get("meanHairLuminance"),
                "volume": meas.get("volume")})
            print("ITER %d stops=%.3f scale=%.4f face=%.3f bg=%.3f hair=%.3f vol=%.3f %s" % (
                ci, stops, light_scale, face_lum, bg_lum,
                meas.get("meanHairLuminance", -1), meas.get("volume", -1),
                "BOTH" if (in_face and in_bg) else ""))
            thumb_paths.append(cell_png)
            if in_face and in_bg:
                best = {"exposureStops": stops, "lightScale": light_scale,
                        "faceMeanLuminance": face_lum,
                        "backgroundLuminance": bg_lum,
                        "meanHairLuminance": meas.get("meanHairLuminance"),
                        "volume": meas.get("volume")}
                break
            # too bright -> darker (lower hi); too dark -> brighter (raise lo)
            if face_lum > 0.70 or bg_lum > 0.55:
                hi = stops
            else:
                lo = stops
        cells = iterations
        print("TABLE " + json.dumps(iterations))

        # ---- SELECT ----
        stage = "select"
        if best is None:
            fail(out_dir, "select",
                 "Error: no exposure iteration landed in both bands "
                 "(face 0.55-0.70, bg 0.45-0.55); table: %s" % json.dumps(iterations),
                 {"blenderVersion": blender_version,
                  "exposureStops": None, "lightScale": None,
                  "iterations": iterations, "strandsAfter": strands_after,
                  "ok": False})
            # still write expo strip below? no: honest negative now.
            return
        print("SELECTED stops=%.3f scale=%.4f face=%.3f bg=%.3f" % (
            best["exposureStops"], best["lightScale"],
            best["faceMeanLuminance"], best["backgroundLuminance"]))

        # ---- RENDER accepted exposure at 1024/128 ----
        # Geometry already applied on ro; re-apply exposure, do NOT rebuild.
        stage = "render"
        apply_exposure(best["exposureStops"], best["lightScale"])
        sc.render.resolution_x = 1024
        sc.render.resolution_y = 1024
        sc.cycles.samples = 128
        try:
            sc.cycles.use_denoising = False
        except Exception:
            pass
        # rig/camera are CONTROLS: reuse image02 helper verbatim (front3b + 40deg Z)
        aim_renders(head_cx, crown_z, out_dir,
                    front_name="front4a.png", three_name="three_quarter4a.png")

        # ---- COMPOSE expo.png + 3up4a.png ----
        stage = "compose"
        thumbs = []
        for ci, p in enumerate(thumb_paths):
            im = PILImage.open(p).convert("RGB")
            im = im.resize((256, 256), PILImage.BILINEAR)
            from PIL import ImageDraw as _D
            dr = _D.Draw(im)
            c = cells[ci]
            dr.text((4, 4), "stops=%.2f" % c["exposureStops"], fill=(255, 255, 0))
            dr.text((4, 18), "face=%.3f bg=%.3f" % (
                c["faceMeanLuminance"], c["backgroundLuminance"]), fill=(255, 255, 0))
            dr.text((4, 32), "hair=%.3f vol=%.3f" % (
                c.get("meanHairLuminance", -1), c.get("volume", -1)), fill=(255, 255, 0))
            okcell = (0.55 <= c["faceMeanLuminance"] <= 0.70
                      and 0.45 <= c["backgroundLuminance"] <= 0.55)
            dr.text((4, 46), "OK" if okcell else "no",
                    fill=(0, 255, 0) if okcell else (255, 0, 0))
            thumbs.append(im)
        n = max(1, len(thumbs))
        cols = 3
        rows = (n + cols - 1) // cols
        sheet = PILImage.new("RGB", (256 * cols, 256 * rows), (20, 20, 20))
        for i, t in enumerate(thumbs):
            sheet.paste(t, ((i % cols) * 256, (i // cols) * 256))
        sheet.save(os.path.join(out_dir, "expo.png"))
        # 3up4a = target | front3b | front4a. Resolve refs via git show to
        # temp under out-dir; NEVER fail on a missing ref: record missingRefs.
        missingRefs = []
        f3b = os.path.join(out_dir, "front3b.png")
        if not os.path.exists(f3b):
            missingRefs.append("front3b.png")
        tgt_png = os.path.join(out_dir, "_target4.png")
        try:
            with open(tgt_png, "wb") as fh:
                subprocess.run(["git", "show",
                                "%s:%s" % (TARGET_GIT_BRANCH, TARGET_GIT_PATH)],
                               cwd=os.getcwd(), stdout=fh, check=True)
        except Exception:
            # Fallback: known-good branch carrying the imagine target.
            try:
                with open(tgt_png, "wb") as fh:
                    subprocess.run(["git", "show",
                                    "wt/hair-editor-apply:%s" % TARGET_GIT_PATH],
                                   cwd=os.getcwd(), stdout=fh, check=True)
            except Exception:
                missingRefs.append("target:%s" % TARGET_GIT_PATH)
                if os.path.exists(tgt_png):
                    try:
                        os.remove(tgt_png)
                    except Exception:
                        pass
        panels = []
        for p in (tgt_png, f3b, os.path.join(out_dir, "front4a.png")):
            try:
                im = PILImage.open(p).convert("RGB")
            except Exception:
                missingRefs.append(os.path.basename(p))
                continue
            w, h = im.size
            im = im.resize((int(w * 512 / h), 512), PILImage.BILINEAR)
            panels.append(im)
        if not panels:
            raise RuntimeError("compose Error: no panels available; missing=%s" % missingRefs)
        W = sum(i.size[0] for i in panels)
        up = PILImage.new("RGB", (W, 512 + 24), (20, 20, 20))
        from PIL import ImageDraw as _D2
        d2 = _D2.Draw(up)
        labels = ("target", "image03b front3b",
                  "image04a front4a stops=%.2f scale=%.3f" % (
                      best["exposureStops"], best["lightScale"]))
        x = 0
        for im, lb in zip(panels, labels):
            up.paste(im, (x, 24))
            d2.text((x + 4, 4), lb, fill=(255, 255, 0))
            x += im.size[0]
        up.save(os.path.join(out_dir, "3up4a.png"))
        for p in thumb_paths:
            try:
                os.remove(p)
            except Exception:
                pass
        try:
            os.remove(tgt_png)
        except Exception:
            pass

        # ---- MEASURE final ----
        # Card schema: ok, stage, error, blenderVersion, exposureStops,
        # lightScale, iterations, strandsAfter, front4a, threeQuarter4a,
        # threeUp4a, widths{target,front3b,front4a}, missingRefs.
        stage = "measure"
        fmeas = run_measure(os.path.join(out_dir, "front4a.png"))
        widths = {}
        t3 = os.path.join(out_dir, "_target4.png")
        if not os.path.exists(t3):
            try:
                with open(t3, "wb") as fh:
                    subprocess.run(["git", "show",
                                    "wt/hair-editor-apply:%s" % TARGET_GIT_PATH],
                                   cwd=os.getcwd(), stdout=fh, check=True)
            except Exception:
                pass
        for key, png in (("target", t3),
                         ("front3b", os.path.join(out_dir, "front3b.png")),
                         ("front4a", os.path.join(out_dir, "front4a.png"))):
            if os.path.exists(png):
                try:
                    widths[key] = run_measure(png)
                except Exception:
                    widths[key] = None
            else:
                widths[key] = None
        row = {
            "ok": True,
            "stage": "measure",
            "error": "",
            "blenderVersion": blender_version,
            "exposureStops": best["exposureStops"],
            "lightScale": best["lightScale"],
            "iterations": iterations,
            "strandsAfter": strands_after,
            "front4a": "front4a.png",
            "threeQuarter4a": "three_quarter4a.png",
            "threeUp4a": "3up4a.png",
            "widths": widths,
            "missingRefs": missingRefs,
        }
        with open(os.path.join(out_dir, "row4a.json"), "w") as h:
            json.dump(row, h, indent=1)
        print("DONE stops=%.3f scale=%.4f vol=%.3f final_vol=%.3f" % (
            best["exposureStops"], best["lightScale"],
            best["volume"], fmeas.get("volume", -1)))
    except _SocketReadbackMismatch:
        # fail() already wrote row4a.json with stage sockets; do not overwrite.
        print("SOCKETS read-back mismatch (row4a.json written)")
        return
    except Exception:
        fail(out_dir, stage, traceback.format_exc(), {
            "blenderVersion": blender_version,
            "dupSockets": dup_sockets if "dup_sockets" in dir() else [],
            "cells": cells if "cells" in dir() else [],
            "selected": None,
        })


if __name__ == "__main__":
    main()

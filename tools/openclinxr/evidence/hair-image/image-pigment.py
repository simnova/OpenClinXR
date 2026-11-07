"""Hair pigment sweep on the repaired, hair-only ID mask.

Run from repo root, fresh process:
  MISE_TRUSTED_CONFIG_PATHS=$PWD OPENCLINXR_HAIR_EDITOR_BLEND=<hair.blend> blender \\
    --background --python tools/openclinxr/evidence/hair-image/image-pigment.py -- \\
    --out-dir tools/openclinxr/evidence/hair-image

Stage order: setup -> mask -> delete -> sockets -> sweep -> select -> render -> compose -> measure.

Lever: Principled Hair parametrization and pigment values only. All geometry,
camera, lighting, exposure, and reflection-lobe controls are pinned.
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

STAGES = ("rig", "sockets", "sweep", "idpass", "select", "render", "measure")


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
    with open(os.path.join(out_dir, "row-pigment.json"), "w") as h:
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
    if any(o.type == "LIGHT" and o.name.startswith("OCLX_") for o in sc.objects):
        cam = bpy.data.objects.get("OCLX_cam")
        sc.camera = cam
        return cam, (head_cx, 0.0, crown_z - 0.12)
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
                front_name="front-tone.png", three_name="three_quarter-tone.png"):
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
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = argv[1:]
    args = ap.parse_args(argv)
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)

    import bpy

    blender_version = bpy.app.version_string
    stage = "rig"
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
        stage = "rig"
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
        stage = "rig"
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
        hair = nodes.new("ShaderNodeBsdfHairPrincipled")
        shader_socket_names = [sock.name for sock in hair.inputs]
        parametrization_enum_values = [
            item.identifier
            for item in hair.bl_rna.properties["parametrization"].enum_items
        ]
        print("PIGMENT shader sockets: %s" % shader_socket_names)
        print("PIGMENT parametrization enum values: %s" % parametrization_enum_values)
        if "MELANIN" not in parametrization_enum_values or "ABSORPTION" not in parametrization_enum_values:
            raise RuntimeError("Error: required hair parametrizations unavailable: %s" % parametrization_enum_values)
        hair.parametrization = "MELANIN"
        for sock, val in (("Roughness", 0.25), ("Radial Roughness", 0.2),
                          ("Coat", 0.1), ("IOR", 1.55),
                          ("Random Color", 0.03), ("Random Roughness", 0.1)):
            if sock not in hair.inputs:
                raise RuntimeError("Error: required hair shader socket missing: %s" % sock)
            hair.inputs[sock].default_value = val
        if not hair.outputs or not out.inputs:
            raise RuntimeError("Error: hair shader has no outputs/inputs")
        links.new(hair.outputs[0], out.inputs["Surface"])
        # Write introspection before any pigment value is requested or rendered.
        with open(os.path.join(out_dir, "row-pigment.json"), "w") as h:
            json.dump({
                "ok": False,
                "stage": "shader-introspection",
                "error": "Error: pigment sweep not yet complete",
                "blenderVersion": blender_version,
                "shaderSocketNames": shader_socket_names,
                "parametrizationEnumValues": parametrization_enum_values,
                "cells": [],
                "selected": None,
            }, h, indent=1)
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

        # ---- THICKNESS SWEEP: fixed Amount 4 / duplicate Radius 0.002 /
        # profile Radius 0.0001 (CONTROLS), iterate exposureStops only ----
        # Reset per cell by removing all OCLX_dup/OCLX_hair modifiers
        # (profile + dup are APPLIED, so restore from a saved data copy).
        stage = "sweep"
        setup_rig(head_cx, crown_z)  # CONTROL rig, same as image02
        # Base light powers (CONTROL positions/ratios; sole lever = shared scale).
        BASE_POWERS = {"OCLX_key": 150.0, "OCLX_fill": 40.0, "OCLX_rim": 80.0}
        sc.render.resolution_x = 1024
        sc.render.resolution_y = 1024
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

        def apply_cell_ro(amount, duplicate_radius, profile_radius, ro):
            # The sole lever is Set Hair Curve Profile / Radius.
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
                modp[prof_key] = profile_radius
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
                _pset("Radius", profile_radius)
                _pset("Shape", 0.5)
                _pset("Factor Min", 0.0)
                _pset("Factor Max", 1.0)
                prof_radius_readback = float(modp[prof_key]) if not hasattr(modp[prof_key], "__len__") else float(list(modp[prof_key])[0])
                if abs(prof_radius_readback - profile_radius) > 1e-9:
                    raise RuntimeError(
                        "profile Radius read-back %s != %s Error" % (
                            prof_radius_readback, profile_radius))
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
                mod[radius_key] = duplicate_radius
            except Exception:
                raise RuntimeError("cannot set Radius socket Error: %s" % radius_key)
            got_amount = int(mod[amount_key])
            got_radius = float(mod[radius_key])
            if got_amount != amount or abs(got_radius - duplicate_radius) > 1e-9:
                fail(out_dir, "sockets",
                     "Error: modifier read-back differs: wrote Amount=%s Radius=%s, "
                     "read Amount=%s Radius=%s" % (amount, duplicate_radius, got_amount, got_radius),
                     {"blenderVersion": blender_version, "dupSockets": dup_sockets,
                      "wrote": {"amount": amount, "radius": duplicate_radius},
                      "readBack": {"amount": got_amount, "radius": got_radius},
                      "cells": [], "selected": None,
                      "strandsBefore": strands_before, "remaining": remaining})
                raise _SocketReadbackMismatch(got_amount, got_radius)
            bpy.ops.object.select_all(action="DESELECT")
            ro.select_set(True)
            bpy.context.view_layer.objects.active = ro
            bpy.ops.object.modifier_apply(modifier=mod.name)
            return prof_radius_readback

        def apply_exposure(stops, light_scale):
            """Sole lever: shared lightScale on 3 area lights + view exposure."""
            sc.view_settings.exposure = stops
            for lname, base in BASE_POWERS.items():
                lo = bpy.data.objects.get(lname)
                if lo is not None and lo.data is not None:
                    lo.data.energy = base * light_scale

        def strand_count(ro):
            bpy.context.view_layer.update()
            deps = bpy.context.evaluated_depsgraph_get()
            eo = ro.evaluated_get(deps)
            ec = getattr(getattr(eo, "data", None), "curves", None)
            return len(ec) if ec is not None else len(ro.data.curves)

        def configure_render(size, samples, transparent=False):
            sc.render.resolution_x = size
            sc.render.resolution_y = size
            sc.render.resolution_percentage = 100
            sc.cycles.samples = samples
            sc.render.film_transparent = transparent
            try:
                sc.cycles.use_denoising = True
            except Exception:
                pass

        def render_id(ro, path, size):
            """Render hair-only alpha coverage, restoring every scene control."""
            nonlocal stage
            stage = "idpass"
            hidden = {o.name: o.hide_render for o in bpy.context.scene.objects}
            mesh_materials = {}
            old_transparent = sc.render.film_transparent
            old_world = sc.world
            deps = bpy.context.evaluated_depsgraph_get()
            print("IDPASS evaluated objects:")
            for inst in deps.object_instances:
                obj = inst.object
                print("  name=%s type=%s instance=%s parent=%s" % (
                    obj.name, obj.type, bool(inst.is_instance),
                    obj.parent.name if obj.parent else "-"))
            ero = ro.evaluated_get(deps)
            from mathutils import Vector
            corners = [ro.matrix_world @ Vector(v) for v in ero.bound_box]
            print("IDPASS ro=%s type=%s surface=%s bounds=(%.6f %.6f %.6f)-(%.6f %.6f %.6f)" % (
                ro.name, ro.type,
                getattr(getattr(ro.data, "surface", None), "name", None),
                min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners),
                max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))

            # Use a clean curves-only copy so no surface link or later modifier
            # can add a non-hair geometry component to the ID object.  Visible
            # scene meshes become holdouts below: hiding the face/body would
            # expose dense strands behind them and falsely fill face/neck alpha.
            id_data = ro.data.copy()
            if hasattr(id_data, "surface"):
                id_data.surface = None
            id_ro = bpy.data.objects.new("OCLX_hair_id_curves_only", id_data)
            bpy.context.scene.collection.objects.link(id_ro)
            id_ro.matrix_world = ro.matrix_world.copy()
            id_world = bpy.data.worlds.get("OCLX_id_world")
            if id_world is None:
                id_world = bpy.data.worlds.new("OCLX_id_world")
                id_world.use_nodes = True
            bg = id_world.node_tree.nodes.get("Background")
            if bg is not None:
                bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
                bg.inputs["Strength"].default_value = 0.0
            emission = bpy.data.materials.get("OCLX_hair_id")
            if emission is None:
                emission = bpy.data.materials.new("OCLX_hair_id")
                emission.use_nodes = True
                en = emission.node_tree.nodes
                el = emission.node_tree.links
                en.clear()
                eo = en.new("ShaderNodeOutputMaterial")
                ee = en.new("ShaderNodeEmission")
                ee.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
                ee.inputs["Strength"].default_value = 1.0
                el.new(ee.outputs[0], eo.inputs["Surface"])
            holdout = bpy.data.materials.get("OCLX_id_holdout")
            if holdout is None:
                holdout = bpy.data.materials.new("OCLX_id_holdout")
                holdout.use_nodes = True
                hn = holdout.node_tree.nodes
                hl = holdout.node_tree.links
                hn.clear()
                ho = hn.new("ShaderNodeOutputMaterial")
                hh = hn.new("ShaderNodeHoldout")
                hl.new(hh.outputs[0], ho.inputs["Surface"])
            try:
                for o in bpy.context.scene.objects:
                    if o.name == id_ro.name:
                        o.hide_render = False
                    elif o.type == "MESH" and not hidden[o.name]:
                        mesh_materials[o.name] = list(o.data.materials)
                        o.data.materials.clear()
                        o.data.materials.append(holdout)
                        o.hide_render = False
                    elif o.type in {"CURVES", "CURVE", "SURFACE", "META", "FONT"}:
                        o.hide_render = True
                id_data.materials.clear()
                id_data.materials.append(emission)
                sc.world = id_world
                configure_render(size, 16, transparent=True)
                sc.render.filepath = path
                sc.render.image_settings.file_format = "PNG"
                sc.render.image_settings.color_mode = "RGBA"
                bpy.ops.render.render(write_still=True)
            finally:
                bpy.data.objects.remove(id_ro, do_unlink=True)
                for name, materials in mesh_materials.items():
                    obj = bpy.data.objects.get(name)
                    if obj is not None:
                        obj.data.materials.clear()
                        for material in materials:
                            obj.data.materials.append(material)
                for name, was_hidden in hidden.items():
                    obj = bpy.data.objects.get(name)
                    if obj is not None:
                        obj.hide_render = was_hidden
                sc.world = old_world
                sc.render.film_transparent = old_transparent
                sc.render.image_settings.color_mode = "RGBA"

        def coverage_stats(beauty_path, id_path):
            beauty = _np.asarray(PILImage.open(beauty_path).convert("RGB"), dtype=_np.float64) / 255.0
            alpha = _np.asarray(PILImage.open(id_path).convert("RGBA"), dtype=_np.float64)[..., 3] / 255.0
            covered = alpha >= 0.9
            count = int(covered.sum())
            if count:
                rgb = beauty[covered]
                lum = (0.2126 * beauty[..., 0] + 0.7152 * beauty[..., 1]
                       + 0.0722 * beauty[..., 2])[covered]
                vals = _np.percentile(lum, [10, 50, 90])
                stats = {"mean": float(lum.mean()), "p10": float(vals[0]),
                         "p50": float(vals[1]), "p90": float(vals[2])}
                mean_rgb = rgb.mean(axis=0)
                color = {
                    "meanRgb": [float(v) for v in mean_rgb],
                    "meanRBRatio": float(mean_rgb[0] / max(mean_rgb[2], 1e-9)),
                    "meanRBSpread": float(mean_rgb[0] - mean_rgb[2]),
                }
            else:
                stats = {"mean": 0.0, "p10": 0.0, "p50": 0.0, "p90": 0.0}
                color = {"meanRgb": [0.0, 0.0, 0.0], "meanRBRatio": 0.0,
                         "meanRBSpread": 0.0}
            return count, stats, color

        # Pinned controls: exposure -0.375; key/fill/rim 150/40/40 W;
        # duplicate/profile radii 0.002/0.0003; reflection lobe 0.25/0.2/0.1.
        exposure_stops = -0.375
        sc.view_settings.exposure = exposure_stops
        light_scale = 0.7711054127039704
        for lname, watts in (("OCLX_key", 150.0), ("OCLX_fill", 40.0),
                             ("OCLX_rim", 40.0)):
            light = bpy.data.objects.get(lname)
            if light is None or light.data is None:
                raise RuntimeError("Error: missing scene light %s" % lname)
            light.data.energy = watts * light_scale
            light["nominalWatts"] = watts

        pigment_specs = [
            {"cell": 1, "parametrization": "MELANIN", "melanin": 0.95,
             "melaninRedness": 0.5},
            {"cell": 2, "parametrization": "MELANIN", "melanin": 1.0,
             "melaninRedness": 0.3},
            {"cell": 3, "parametrization": "ABSORPTION",
             "sigmaA": [1.0, 1.4, 2.0]},
            {"cell": 4, "parametrization": "ABSORPTION",
             "sigmaA": [2.5, 3.5, 5.0]},
        ]

        def configure_pigment(spec):
            hair.parametrization = spec["parametrization"]
            if hair.parametrization != spec["parametrization"]:
                raise RuntimeError("Error: parametrization read-back differs: requested %s got %s" % (
                    spec["parametrization"], hair.parametrization))
            requested = {"parametrization": spec["parametrization"]}
            read_back = {"parametrization": hair.parametrization}
            if spec["parametrization"] == "MELANIN":
                for name, key in (("Melanin", "melanin"),
                                  ("Melanin Redness", "melaninRedness")):
                    if name not in hair.inputs:
                        raise RuntimeError("Error: required hair shader socket missing: %s" % name)
                    value = float(spec[key])
                    hair.inputs[name].default_value = value
                    got = float(hair.inputs[name].default_value)
                    requested[key] = value
                    read_back[key] = got
                    if abs(got - value) > 1e-6:
                        raise RuntimeError("Error: %s read-back differs: requested %s got %s" % (
                            name, value, got))
            else:
                name = "Absorption Coefficient"
                if name not in hair.inputs:
                    raise RuntimeError("Error: required hair shader socket missing: %s" % name)
                value = [float(v) for v in spec["sigmaA"]]
                hair.inputs[name].default_value = value
                got = [float(v) for v in hair.inputs[name].default_value[:3]]
                requested["sigmaA"] = value
                read_back["sigmaA"] = got
                if any(abs(a - b) > 1e-6 for a, b in zip(got, value)):
                    raise RuntimeError("Error: %s read-back differs: requested %s got %s" % (
                        name, value, got))
            return requested, read_back

        cells = []
        beauty_paths = []
        id_paths = []
        control_volume = float(run_measure(os.path.join(out_dir, "front-thick.png"))["volume"])
        for spec in pigment_specs:
            stage = "sweep"
            requested, pigment_read_back = configure_pigment(spec)
            ro = restore_base(curves)
            radius_read_back = apply_cell_ro(4, 0.002, 0.0003, ro)
            ro.data.materials.clear()
            ro.data.materials.append(mat)
            after = strand_count(ro)
            beauty_name = "pigment-%d.png" % spec["cell"]
            id_name = "hair-id-pigment-%d.png" % spec["cell"]
            beauty_path = os.path.join(out_dir, beauty_name)
            id_path = os.path.join(out_dir, id_name)
            configure_render(1024, 128, transparent=False)
            sc.render.filepath = beauty_path
            sc.render.image_settings.file_format = "PNG"
            sc.render.image_settings.color_mode = "RGBA"
            bpy.ops.render.render(write_still=True)
            meas = run_measure(beauty_path)
            render_id(ro, id_path, 1024)
            coverage_pixels, coverage_lum, coverage_color = coverage_stats(beauty_path, id_path)
            cell = {
                "cell": spec["cell"],
                "requested": requested,
                "readBack": pigment_read_back,
                "rimWatts": 40.0,
                "rimReadBackWatts": float(bpy.data.objects["OCLX_rim"].get("nominalWatts", -1.0)),
                "radius": 0.0003,
                "radiusReadBack": radius_read_back,
                "amount": 4,
                "strandsAfter": after,
                "volume": control_volume,
                "thresholdVolume": float(meas["volume"]),
                "faceMeanLuminance": float(meas["faceMeanLuminance"]),
                "backgroundLuminance": float(meas["backgroundLuminance"]),
                "coveragePixels": coverage_pixels,
                "coverageHairLuminance": coverage_lum,
                "coverageHairColor": coverage_color,
                "beautyPng": beauty_name,
                "idPng": id_name,
            }
            cell["feasible"] = bool(
                coverage_lum["p50"] <= 0.12
                and coverage_lum["p90"] <= 0.24
                and coverage_lum["p10"] >= 0.03
                and 1.2 <= coverage_color["meanRBRatio"] <= 1.8
                and coverage_color["meanRBSpread"] < 0.12
                and abs(control_volume - 0.224) <= 0.01
                and after == 50265
                and 0.55 <= cell["faceMeanLuminance"] <= 0.70
                and 0.45 <= cell["backgroundLuminance"] <= 0.55
                and coverage_pixels >= 100000)
            cells.append(cell)
            beauty_paths.append(beauty_path)
            id_paths.append(id_path)
            print("PIGMENT cell=%d requested=%s readBack=%s strands=%d coverage=%d p10=%.4f p50=%.4f p90=%.4f R/B=%.4f spread=%.4f feasible=%s" % (
                spec["cell"], requested, pigment_read_back, after, coverage_pixels,
                coverage_lum["p10"], coverage_lum["p50"], coverage_lum["p90"],
                coverage_color["meanRBRatio"], coverage_color["meanRBSpread"],
                cell["feasible"]))

        print("TABLE " + json.dumps(cells, sort_keys=True))
        from PIL import ImageDraw
        sheet = PILImage.new("RGB", (512 * len(cells), 512), (20, 20, 20))
        for ci, (cell, path) in enumerate(zip(cells, beauty_paths)):
            panel = PILImage.open(path).convert("RGB").resize((512, 512), PILImage.Resampling.LANCZOS)
            draw = ImageDraw.Draw(panel)
            draw.rectangle((0, 0, 511, 76), fill=(12, 12, 12))
            req = cell["requested"]
            label = ("melanin=%.2f redness=%.2f" % (req["melanin"], req["melaninRedness"])
                     if req["parametrization"] == "MELANIN"
                     else "sigma_a=(%.1f, %.1f, %.1f)" % tuple(req["sigmaA"]))
            draw.text((6, 5), "cell %d %s" % (cell["cell"], label), fill=(255, 255, 0))
            draw.text((6, 25), "p10=%.3f p50=%.3f p90=%.3f" % (
                cell["coverageHairLuminance"]["p10"], cell["coverageHairLuminance"]["p50"],
                cell["coverageHairLuminance"]["p90"]), fill=(255, 255, 0))
            draw.text((6, 45), "coverage=%d R/B=%.3f spread=%.3f" % (
                cell["coveragePixels"], cell["coverageHairColor"]["meanRBRatio"],
                cell["coverageHairColor"]["meanRBSpread"]), fill=(255, 255, 0))
            draw.text((6, 63), "feasible=%s" % cell["feasible"],
                      fill=(0, 255, 0) if cell["feasible"] else (255, 80, 80))
            sheet.paste(panel, (ci * 512, 0))
        sheet.save(os.path.join(out_dir, "sweep-pigment.png"), compress_level=1)

        stage = "select"
        feasible = [c for c in cells if c["feasible"]]
        selected = (max(feasible, key=lambda c: c["coverageHairLuminance"]["p10"])
                    if feasible else min(cells, key=lambda c: c["coverageHairLuminance"]["p50"]))
        selected_index = cells.index(selected)
        front_path = os.path.join(out_dir, "front-pigment.png")
        id_final = os.path.join(out_dir, "hair-id-pigment.png")
        PILImage.open(beauty_paths[selected_index]).save(front_path, compress_level=1)
        PILImage.open(id_paths[selected_index]).save(id_final, compress_level=1)
        beauty_arr = _np.asarray(PILImage.open(front_path).convert("RGB"), dtype=_np.float64)
        alpha_arr = (_np.asarray(PILImage.open(id_final).convert("RGBA"), dtype=_np.float64)[..., 3] / 255.0)
        overlay = beauty_arr.copy()
        mask = alpha_arr >= 0.9
        overlay[mask] = 0.55 * overlay[mask] + 0.45 * _np.array([255.0, 0.0, 0.0])
        PILImage.fromarray(_np.clip(overlay, 0, 255).astype(_np.uint8)).save(
            os.path.join(out_dir, "mask-overlay-pigment.png"), compress_level=1)

        stage = "measure"
        light_count = len([o for o in bpy.context.scene.objects if o.type == "LIGHT"])
        if light_count != 3:
            raise RuntimeError("Error: rig light count %d != 3" % light_count)
        row_ok = bool(feasible)
        floor_note = ("floor is surface reflection; next lever roughness 0.25->0.45 and coat 0.1->0"
                      if cells[3]["coverageHairLuminance"]["p50"] > 0.12 else None)
        row = {
            "ok": row_ok,
            "stage": "measure",
            "error": "" if row_ok else "Error: no pigment cell satisfies all bars; lowest p50 selected",
            "blenderVersion": blender_version,
            "shaderSocketNames": shader_socket_names,
            "parametrizationEnumValues": parametrization_enum_values,
            "controls": {"rimWatts": 40.0, "keyWatts": 150.0, "fillWatts": 40.0,
                         "radius": 0.0003, "amount": 4, "exposureStops": exposure_stops,
                         "roughness": 0.25, "radialRoughness": 0.2, "coat": 0.1},
            "bars": {"p50Max": 0.12, "p90Max": 0.24, "p10Min": 0.03,
                     "meanRBRatio": [1.2, 1.8], "volumeTarget": 0.224,
                     "volumeTolerance": 0.01, "strandsAfter": 50265,
                     "faceMeanLuminance": [0.55, 0.70],
                     "backgroundLuminance": [0.45, 0.55], "coveragePixelsMin": 100000,
                     "meanRBSpreadMaxExclusive": 0.12},
            "referenceTriple": {"p10": 0.039, "p50": 0.078, "p90": 0.159},
            "lightCount": light_count,
            "cells": cells,
            "selected": selected,
            "front": "front-pigment.png",
            "idPng": "hair-id-pigment.png",
            "maskOverlay": "mask-overlay-pigment.png",
            "floorNote": floor_note,
        }
        with open(os.path.join(out_dir, "row-pigment.json"), "w") as h:
            json.dump(row, h, indent=1)
        print("SELECTED cell=%d coverage=%d p50=%.4f ok=%s" % (
            selected["cell"], selected["coveragePixels"],
            selected["coverageHairLuminance"]["p50"], row_ok))
        return


    except _SocketReadbackMismatch:
        # fail() already wrote row-pigment.json with stage sockets; do not overwrite.
        print("SOCKETS read-back mismatch (row-pigment.json written)")
        return
    except Exception:
        fail(out_dir, stage, traceback.format_exc(), {
            "blenderVersion": blender_version,
            "dupSockets": dup_sockets if "dup_sockets" in dir() else [],
            "cells": cells if "cells" in dir() else [],
            "selected": selected if "selected" in dir() else None,
            "lightCount": len([o for o in bpy.context.scene.objects if o.type == "LIGHT"]),
            "exposureStops": exposure_stops if "exposure_stops" in dir() else None,
            "shaderSocketNames": shader_socket_names if "shader_socket_names" in dir() else [],
            "parametrizationEnumValues": parametrization_enum_values if "parametrization_enum_values" in dir() else [],
            "front": "front-pigment.png" if os.path.exists(os.path.join(out_dir, "front-pigment.png")) else None,
            "idPng": "hair-id-pigment.png" if os.path.exists(os.path.join(out_dir, "hair-id-pigment.png")) else None,
        })


if __name__ == "__main__":
    main()

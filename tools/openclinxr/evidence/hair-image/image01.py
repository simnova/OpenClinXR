"""Hair image 01: dense strands, fringe deleted, centre part (Blender 5.1 headless).

Run from repo root, fresh process:
  OPENCLINXR_HAIR_EDITOR_BLEND=<hair.blend> blender --background --python \\
    tools/openclinxr/evidence/hair-image/image01.py -- \\
    --out-dir tools/openclinxr/evidence/hair-image

Stage order: setup -> mask -> delete -> material -> render -> compose -> evaluate.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import traceback

STAGES = ("setup", "mask", "delete", "material", "render", "compose", "evaluate")

MACROS = {"gender": 0.0, "age": 0.6191, "weight": 0.5024, "muscle": 0.5}
HAIR_ASSET = "straight_hair_to_shoulder"
PART_HALF_WIDTH = 0.0015  # 3 mm seam
FRONT_Y_MARGIN = 0.02
AISHA_GLB = "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb"
PREV_BEST = "tools/openclinxr/evidence/hair-cards-probe/arm-c-head.png"
TARGET_GIT_PATH = ("packages/openclinxr/factory-stations/src/hair_editor/evidence/"
                   "target-front-imagine.png")
TARGET_GIT_BRANCH = "wt/hair-editor-apply"
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
    with open(os.path.join(out_dir, "row.json"), "w") as h:
        json.dump(rep, h, indent=1)
    print(err[:4000])


def track_cam(cam, target_loc):
    from mathutils import Vector
    d = Vector(target_loc) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def aim_renders(head_cx, crown_z, out_dir):
    import bpy
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 128
    sc.render.resolution_x = 1024
    sc.render.resolution_y = 1024
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    # world: mid-grey 0.5, strength 0.4
    world = bpy.data.worlds.new("OCLX_grey_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    bg.inputs["Strength"].default_value = 0.4
    sc.world = world
    # sun front-left ~45 deg, energy 3.0
    sun_data = bpy.data.lights.new("OCLX_sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("OCLX_sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.location = (-2.0, -3.0, 4.0)
    track_cam(sun, (head_cx, 0.0, crown_z - 0.12))
    # camera 50 mm
    cam_data = bpy.data.cameras.new("OCLX_cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("OCLX_cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    sc.camera = cam
    target = (head_cx, 0.0, crown_z - 0.12)
    cam.location = (head_cx, -0.7, crown_z - 0.10)
    track_cam(cam, target)
    sc.render.filepath = os.path.join(out_dir, "front.png")
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
    sc.render.filepath = os.path.join(out_dir, "three_quarter.png")
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
    target_png = os.path.join(out_dir, "_target.png")
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
    prev_png = os.path.join(os.getcwd(), PREV_BEST)
    front_png = os.path.join(out_dir, "front.png")
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
    out = os.path.join(out_dir, "3up.png")
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
    stage = "setup"
    eye_source = "unknown"
    crown_z = brow_z = hairline_z = 0.0
    deleted_fringe = deleted_part = 0
    remaining = 0
    has_surface_uv = False
    head_source = "unknown"
    material_fallback = None

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
        HIDE_SUB = ("hair", "cloth", "shirt", "jean", "pant", "shoe",
                    "mask", "helper", "glasses", "hat", "cap_")
        for o in bpy.data.objects:
            if o is curves or o is head_obj:
                continue
            n = o.name.lower()
            if o is basemesh or any(s in n for s in HIDE_SUB):
                o.hide_render = True
                o.hide_viewport = True
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
        has_surface_uv = "surface_uv_coordinate" in curves.data.attributes

        if remaining < 3000 or remaining > 10191:
            raise RuntimeError("remaining %d outside [3000, 10191]" % remaining)

        # ---- (4) MATERIAL ----
        stage = "material"
        sc = bpy.context.scene
        sc.render.engine = "CYCLES"
        sc.cycles.samples = 128
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
            if "Melanin" in hair.inputs:
                hair.inputs["Melanin"].default_value = 0.95
            if "Melanin Redness" in hair.inputs:
                hair.inputs["Melanin Redness"].default_value = 0.5
            for sock in ("Roughness", "Radial Roughness"):
                if sock in hair.inputs:
                    hair.inputs[sock].default_value = 0.3
            for sock, val in (("Coat", 0.1), ("IOR", 1.55), ("Random Color", 0.05)):
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

        # ---- (5) RIG ----
        stage = "render"
        aim_renders(head_cx, crown_z, out_dir)

        # ---- (6) COMPOSE ----
        stage = "compose"
        compose_3up(out_dir)

        # ---- (7) EVALUATE ----
        stage = "evaluate"
        front_eval = run_evaluator(out_dir)
        row = {
            "ok": True,
            "stage": "evaluate",
            "error": "",
            "blenderVersion": blender_version,
            "eyeSource": eye_source,
            "crownZ": crown_z,
            "browZ": brow_z,
            "hairlineZ": hairline_z,
            "frontYMargin": FRONT_Y_MARGIN,
            "partHalfWidth": PART_HALF_WIDTH,
            "deletedFringe": deleted_fringe,
            "deletedPart": deleted_part,
            "remaining": remaining,
            "hasSurfaceUV": has_surface_uv,
            "headSource": head_source,
            "front": "front.png",
            "threeQuarter": "three_quarter.png",
            "threeUp": "3up.png",
            "evaluator": {"front": front_eval},
        }
        if material_fallback:
            row["materialFallback"] = material_fallback
        if deleted_part == 0:
            row["partWasEmpty"] = True
            row["partEmptyReason"] = (
                "no roots within 1.5 mm of headCentreX at or in front of crown apex y")
        with open(os.path.join(out_dir, "row.json"), "w") as h:
            json.dump(row, h, indent=1)
        print("DONE remaining=%d fringe=%d part=%d" % (remaining, deleted_fringe, deleted_part))
    except Exception:
        fail(out_dir, stage, traceback.format_exc(), {
            "blenderVersion": blender_version,
            "eyeSource": eye_source,
            "crownZ": crown_z, "browZ": brow_z, "hairlineZ": hairline_z,
            "deletedFringe": deleted_fringe, "deletedPart": deleted_part,
            "remaining": remaining, "hasSurfaceUV": has_surface_uv,
            "headSource": head_source,
        })


if __name__ == "__main__":
    main()

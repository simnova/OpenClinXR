"""Persistent Blender hair evaluator: one JSON request/result per line.

Run with Blender 5.1.1 from the repository root.  The expensive MPFB/hair/head
scene is built once; each request restores the repaired guide data, applies
Profile(length)/Duplicate by interface identifier, renders beauty + the repaired
curves-only holdout ID pass, and returns measured metrics.
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
import time
import traceback

import bpy
import numpy as np
from PIL import Image
from bpy_extras.object_utils import world_to_camera_view


ROOT = os.getcwd()
OUT = os.path.join(ROOT, "tools/openclinxr/evidence/hair-search2")
PACK = os.environ.get("OPENCLINXR_HAIR_EDITOR_BLEND", os.path.expanduser(
    "~/.openclinxr-tools/haireditor/unpacked/hair/haireditor/hair.blend"))
AISHA = os.path.join(ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb")
MACROS = {"gender": 0.0, "age": 0.6191, "weight": 0.5024, "muscle": 0.5}
HAIR_ASSET = "straight_hair_to_shoulder"
PART_HALF_WIDTH = 0.0015
FRONT_Y_MARGIN = 0.02


def load_shared():
    """Reuse the established hair-image rig/material helpers without executing it."""
    path = os.path.join(ROOT, "tools/openclinxr/evidence/hair-image/image-rim.py")
    spec = importlib.util.spec_from_file_location("hair_image_rim_shared", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SHARED = load_shared()


def socket_identifier(group, name):
    for socket in group.interface.items_tree:
        if socket.name == name and getattr(socket, "in_out", "") == "INPUT":
            return socket.identifier
    return None


def set_socket(modifier, group, name, value, required=True):
    ident = socket_identifier(group, name)
    if ident is None:
        if required:
            raise RuntimeError("node group %s has no input %s" % (group.name, name))
        return None
    modifier[ident] = value
    got = modifier[ident]
    if hasattr(got, "__len__") and not isinstance(got, str):
        got = list(got)
    return ident, got


def apply_modifier(obj, name, group, values):
    mod = obj.modifiers.new(name, "NODES")
    mod.node_group = group
    reads = {}
    for socket_name, value in values.items():
        result = set_socket(mod, group, socket_name, value, required=False)
        if result is not None:
            reads[socket_name] = result[1]
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    return reads


def build_scene():
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
    basemesh.name = "Human"
    bpy.context.view_layer.objects.active = basemesh
    bpy.ops.mpfb.setup_hair_operator()
    bpy.ops.mpfb.apply_hair_operator(hair_asset=HAIR_ASSET)
    guides = bpy.context.view_layer.objects.active
    if guides is None or guides.type != "CURVES":
        guides = bpy.data.objects.get(HAIR_ASSET)
    if guides is None or guides.type != "CURVES":
        raise RuntimeError("no curves object after apply_hair_operator")

    # Realize the pack interpolation once, matching the repaired image-rim path.
    deps = bpy.context.evaluated_depsgraph_get()
    dense_data = guides.evaluated_get(deps).data.copy()
    hair = bpy.data.objects.new("OCLX_dense_hair", dense_data)
    bpy.context.scene.collection.objects.link(hair)
    hair.matrix_world = guides.matrix_world.copy()
    guides.hide_render = guides.hide_viewport = True

    head = basemesh
    if os.path.exists(AISHA):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=AISHA)
        meshes = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        if meshes:
            head = max(meshes, key=lambda o: len(o.data.vertices))
    for obj in bpy.data.objects:
        if obj in (hair, head):
            continue
        lowered = obj.name.lower()
        if obj is basemesh or any(s in lowered for s in ("hair", "mask", "helper", "glasses", "hat", "cap_")):
            obj.hide_render = obj.hide_viewport = True
    if head is basemesh:
        head.hide_render = head.hide_viewport = False

    mw = basemesh.matrix_world
    verts = [mw @ v.co for v in basemesh.data.vertices]
    xs, ys, zs = ([v.x for v in verts], [v.y for v in verts], [v.z for v in verts])
    crown_z = max(zs)
    head_cx = (min(xs) + max(xs)) / 2.0
    apex_y = verts[zs.index(crown_z)].y
    brow_z = None
    try:
        names = [group.name for group in head.vertex_groups]
        eye_name = next((n for n in names if "eye" in n.lower() and "socket" in n.lower()), None)
        if eye_name is None:
            eye_name = next((n for n in names if "eye" in n.lower()), None)
        if eye_name is not None:
            group_index = head.vertex_groups[eye_name].index
            points = [mw @ v.co for v in head.data.vertices
                      if any(g.group == group_index for g in v.groups)]
            if points:
                brow_z = sum(p.z for p in points) / len(points)
    except Exception:
        pass
    if brow_z is None:
        eye_objs = [o for o in bpy.data.objects if "eye" in o.name.lower() and o.type == "MESH"]
        if eye_objs:
            brow_z = sum(o.matrix_world.translation.z for o in eye_objs) / len(eye_objs)
    if brow_z is None:
        brow_z = crown_z - 0.11
    hairline_z = brow_z + 0.62 * (crown_z - brow_z)
    upper = [v for v in verts if v.z > hairline_z]
    head_cy = sum(v.y for v in upper) / len(upper)

    # Repaired root mask: delete fringe and 3 mm part seam on CURVE domain.
    roots = [hair.matrix_world @ c.points[0].position for c in hair.data.curves]
    doomed = {
        i for i, root in enumerate(roots)
        if ((root.z < hairline_z and root.y < head_cy - FRONT_Y_MARGIN)
            or (abs(root.x - head_cx) < PART_HALF_WIDTH and root.y <= apex_y))
    }
    attr = hair.data.attributes.new("doomed", "BOOLEAN", "CURVE")
    for i in range(len(roots)):
        attr.data[i].value = i in doomed
    group = bpy.data.node_groups.new("OCLX_doom_delete", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nin, nout = group.nodes.new("NodeGroupInput"), group.nodes.new("NodeGroupOutput")
    named = group.nodes.new("GeometryNodeInputNamedAttribute")
    named.data_type = "BOOLEAN"
    named.inputs["Name"].default_value = "doomed"
    delete = group.nodes.new("GeometryNodeDeleteGeometry")
    delete.domain = "CURVE"
    group.links.new(nin.outputs[0], delete.inputs[0])
    group.links.new(named.outputs[0], delete.inputs[1])
    group.links.new(delete.outputs[0], nout.inputs[0])
    apply_modifier(hair, "OCLX_doom_delete", group, {})
    hair.data.attributes.remove(hair.data.attributes.get("doomed"))
    repaired_count = len(hair.data.curves)

    if not os.path.exists(PACK):
        raise RuntimeError("hair pack blend not found: %s" % PACK)
    wanted = ("Duplicate Hair Curves", "Set Hair Curve Profile")
    with bpy.data.libraries.load(PACK, link=False) as (src, dst):
        dst.node_groups = [n for n in wanted if n in src.node_groups]
    dup = bpy.data.node_groups.get("Duplicate Hair Curves")
    profile = bpy.data.node_groups.get("Set Hair Curve Profile")
    if dup is None or profile is None:
        raise RuntimeError("required hair node groups missing")

    # Reusable material; candidate values are changed in place.
    material = bpy.data.materials.new("OCLX_hair_search")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfHairPrincipled")
    try:
        shader.parametrization = "HUANG"
    except Exception:
        shader.parametrization = "MELANIN"
    material.node_tree.links.new(shader.outputs[0], output.inputs["Surface"])
    SHARED.ensure_head_material(head)

    _cam, light_target = SHARED.setup_rig(head_cx, crown_z)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = -0.375
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    try:
        scene.cycles.use_denoising = True
    except Exception:
        pass
    base_data = hair.data.copy()
    base_data.use_fake_user = True
    chin_candidates = [p for p in verts
                       if crown_z - 0.30 <= p.z <= crown_z - 0.14
                       and abs(p.x - head_cx) <= 0.012]
    chin_world = min(chin_candidates, key=lambda p: p.y) if chin_candidates else min(verts, key=lambda p: abs(p.x-head_cx)+abs(p.z-(crown_z-.22)))
    return {
        "scene": scene, "hair": hair, "head": head, "shader": shader, "material": material,
        "base_data": base_data, "dup": dup, "profile": profile,
        "repairedGuides": repaired_count,
        "chinWorld": chin_world, "lightTarget": light_target,
        "frontCameraLocation": scene.camera.location.copy(),
        "frontCameraRotation": scene.camera.rotation_euler.copy(),
    }


def restore_hair(state):
    hair = state["hair"]
    old = hair.data
    hair.data = state["base_data"].copy()
    if old is not state["base_data"]:
        try:
            bpy.data.hair_curves.remove(old)
        except (TypeError, RuntimeError):
            pass
    for mod in list(hair.modifiers):
        hair.modifiers.remove(mod)
    return hair


def configure_candidate(state, params):
    hair = restore_hair(state)
    length = float(params.get("length", 1.0))
    profile_reads = apply_modifier(hair, "OCLX_profile", state["profile"], {
        "Density": 1.0, "Length": 1.0 * length, "Replace Radius": True,
        "Radius": 0.0003, "Shape": 0.5, "Factor Min": 0.0, "Factor Max": 1.0,
    })
    length_readback = float(profile_reads["Length"])
    if abs(length_readback - length) > 1e-6:
        raise RuntimeError("Length read-back mismatch: wrote %s read %s" % (length, length_readback))
    reads = apply_modifier(hair, "OCLX_duplicate", state["dup"], {
        "Amount": 4, "Radius": 0.002, "Seed": 0,
    })
    if int(reads["Amount"]) != 4:
        raise RuntimeError("Amount read-back mismatch: %s" % reads["Amount"])
    hair.data.materials.clear()
    hair.data.materials.append(state["material"])

    shader = state["shader"]
    for name, value in (("Melanin", params["melanin"]),
                        ("Melanin Redness", params["redness"]),
                        ("Roughness", params["roughness"])):
        if name in shader.inputs:
            shader.inputs[name].default_value = float(value)

    # Preserve azimuth/distance, set requested elevation and size/power.
    from mathutils import Vector
    target = Vector(state["lightTarget"])
    key = bpy.data.objects["OCLX_key"]
    fill = bpy.data.objects["OCLX_fill"]
    rim = bpy.data.objects["OCLX_rim"]
    for light, elev, power, size in (
        (key, params["key_elev_deg"], 150.0, params["key_size_m"]),
        (fill, params["fill_elev_deg"], params["fill_W"], 1.7),
        (rim, 40.0, params["rim_W"], 1.0),
    ):
        dx, dy = light.location.x - target.x, light.location.y - target.y
        radial = math.hypot(dx, dy)
        light.location.z = target.z + radial * math.tan(math.radians(float(elev)))
        light.data.energy = float(power)
        light.data.size = float(size)
        SHARED.track_cam(light, target)
    return length_readback


def render_id(state, path, size):
    """Repaired hair-only alpha pass with visible meshes as holdouts."""
    scene, hair = state["scene"], state["hair"]
    hidden = {o.name: o.hide_render for o in scene.objects}
    materials = {}
    old_world, old_transparent = scene.world, scene.render.film_transparent
    id_data = hair.data.copy()
    if hasattr(id_data, "surface"):
        id_data.surface = None
    id_obj = bpy.data.objects.new("OCLX_hair_id_curves_only", id_data)
    scene.collection.objects.link(id_obj)
    id_obj.matrix_world = hair.matrix_world.copy()
    world = bpy.data.worlds.get("OCLX_id_world") or bpy.data.worlds.new("OCLX_id_world")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    bg.inputs["Strength"].default_value = 0
    emission = bpy.data.materials.get("OCLX_hair_id") or bpy.data.materials.new("OCLX_hair_id")
    emission.use_nodes = True
    emission.node_tree.nodes.clear()
    out = emission.node_tree.nodes.new("ShaderNodeOutputMaterial")
    emit = emission.node_tree.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.node_tree.links.new(emit.outputs[0], out.inputs["Surface"])
    holdout = bpy.data.materials.get("OCLX_id_holdout") or bpy.data.materials.new("OCLX_id_holdout")
    holdout.use_nodes = True
    holdout.node_tree.nodes.clear()
    hout = holdout.node_tree.nodes.new("ShaderNodeOutputMaterial")
    holdout.node_tree.links.new(holdout.node_tree.nodes.new("ShaderNodeHoldout").outputs[0], hout.inputs[0])
    try:
        for obj in scene.objects:
            if obj is id_obj:
                obj.hide_render = False
            elif obj.type == "MESH" and not hidden[obj.name]:
                materials[obj.name] = list(obj.data.materials)
                obj.data.materials.clear()
                obj.data.materials.append(holdout)
                obj.hide_render = False
            elif obj.type in {"CURVES", "CURVE", "SURFACE", "META", "FONT"}:
                obj.hide_render = True
        id_data.materials.clear()
        id_data.materials.append(emission)
        scene.world = world
        scene.render.film_transparent = True
        scene.cycles.samples = 16
        scene.render.resolution_x = scene.render.resolution_y = size
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.data.objects.remove(id_obj, do_unlink=True)
        try:
            bpy.data.hair_curves.remove(id_data)
        except (TypeError, RuntimeError):
            pass
        for name, mats in materials.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.data.materials.clear()
                for mat in mats:
                    obj.data.materials.append(mat)
        for name, value in hidden.items():
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = value
        scene.world, scene.render.film_transparent = old_world, old_transparent


def projected_chin_row(state, size):
    """Project the front-centre lower-head vertex; deterministic mesh chin proxy."""
    scene = state["scene"]
    ndc = world_to_camera_view(scene, scene.camera, state["chinWorld"])
    return max(0, min(size - 1, int(round((1.0 - ndc.y) * (size - 1)))))


def metrics_from_png(state, beauty_path, id_path):
    rgb = np.asarray(Image.open(beauty_path).convert("RGB"), dtype=np.float64) / 255.0
    alpha = np.asarray(Image.open(id_path).convert("RGBA"), dtype=np.float64)[..., 3] / 255.0
    mask = alpha >= 0.9
    pixels = rgb[mask]
    if pixels.size == 0:
        raise RuntimeError("hair-only ID mask is empty")
    lum = 0.2126*pixels[:, 0] + 0.7152*pixels[:, 1] + 0.0722*pixels[:, 2]
    p10, p50, p90 = np.percentile(lum, [10, 50, 90])
    mean_rgb = pixels.mean(axis=0)
    spread = float(np.mean(pixels[:, 0] - pixels[:, 2]))
    h, w = mask.shape
    full_lum = 0.2126*rgb[..., 0] + 0.7152*rgb[..., 1] + 0.0722*rgb[..., 2]
    face_region = full_lum[int(.25*h):int(.60*h), int(.30*w):int(.70*w)]
    face_values = face_region[face_region > .30]
    face = float(face_values.mean()) if face_values.size else 0.0
    mid = face_region.shape[1] // 2
    left, right = face_region[:, :mid], face_region[:, mid:]
    lv, rv = left[left > .30], right[right > .30]
    lmean = float(lv.mean()) if lv.size else 0.0
    rmean = float(rv.mean()) if rv.size else 0.0
    face_lr = min(lmean, rmean) / max(lmean, rmean, 1e-9)
    patch = max(1, int(h * 32 / 1024))
    bg = float(np.mean([full_lum[:patch, :patch].mean(), full_lum[:patch, -patch:].mean(),
                        full_lum[-patch:, :patch].mean(), full_lum[-patch:, -patch:].mean()]))
    x0, x1, y1 = int(.15*w), int(.85*w), int(.75*h)
    volume = float((full_lum[:y1, x0:x1] < .30).mean())
    ys = np.nonzero(mask)[0]
    top, bottom = int(ys.min()), int(ys.max())
    bright = mask & (full_lum > float(p90))
    crown_cut = top + max(1, int(.30 * (bottom-top+1)))
    bright_count = int(bright.sum())
    sheen_top_frac = (float(bright[:crown_cut+1].sum()) / bright_count
                      if bright_count else 0.0)
    chin = projected_chin_row(state, h)
    length = max(0.0, (bottom - chin) / max(1.0, chin - top))
    return {
        "p10": float(p10), "p50": float(p50), "p90": float(p90),
        "rb": float(mean_rgb[0] / max(mean_rgb[2], 1e-9)),
        "meanRGB": [float(v) for v in mean_rgb], "meanRBSpread": spread,
        "face": face, "bg": bg, "faceLR": float(face_lr), "volume": volume,
        "lengthBelowChinFrac": float(length),
        "sheenTopFrac": sheen_top_frac,
        "maskPx": int(round(mask.sum() * (1024.0 / h) ** 2)),
        "maskPxNative": int(mask.sum()),
        "hairTopPx": top, "hairBottomPx": bottom, "chinPx": chin,
    }


def profile_metrics_from_mask(state, id_path):
    """Ungraded silhouette descriptors for the fixed 90-degree profile."""
    alpha = np.asarray(Image.open(id_path).convert("RGBA"), dtype=np.float64)[..., 3] / 255.0
    mask = alpha >= .9
    ys, xs = np.nonzero(mask)
    if not len(ys):
        raise RuntimeError("profile hair-only ID mask is empty")
    top, bottom, left, right = map(int, (ys.min(), ys.max(), xs.min(), xs.max()))
    # Fixed framing descriptor so the supplied target-profile mask can be
    # measured identically without access to its source mesh.
    chin = int(round(.60 * (mask.shape[0]-1)))
    denom = max(1.0, chin-top)
    return {
        "hairBottomRowBelowChinFraction": max(0.0, (bottom-chin)/denom),
        "hairBackExtent": float(right-left+1) / max(1.0, bottom-top+1),
        "hairTopPx": top, "hairBottomPx": bottom, "chinPx": chin,
        "hairLeftPx": left, "hairRightPx": right,
    }


def evaluate(state, request):
    started = time.monotonic()
    index = int(request["index"])
    size = int(request.get("size", 512))
    samples = int(request.get("samples", 32))
    stem = request.get("stem", "eval-%04d" % index)
    beauty = os.path.join(OUT, stem + ".png")
    id_path = os.path.join(OUT, stem + "-id.png")
    length_readback = configure_candidate(state, request["params"])
    scene = state["scene"]
    scene.camera.location = state["frontCameraLocation"].copy()
    scene.camera.rotation_euler = state["frontCameraRotation"].copy()
    if request.get("camera") == "profile":
        from mathutils import Vector
        target = Vector(state["lightTarget"])
        off = scene.camera.location-target
        scene.camera.location = target + Vector((-off.y, off.x, off.z))
        SHARED.track_cam(scene.camera, target)
    world_strength = request.get("worldStrength")
    if world_strength is not None:
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = float(world_strength)
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.cycles.samples = samples
    scene.cycles.seed = int(request.get("cyclesSeed", 0))
    scene.render.film_transparent = False
    scene.render.filepath = beauty
    render_started = time.monotonic()
    bpy.ops.render.render(write_still=True)
    render_id(state, id_path, size)
    render_seconds = time.monotonic() - render_started
    deps = bpy.context.evaluated_depsgraph_get()
    strands = len(state["hair"].evaluated_get(deps).data.curves)
    metrics = metrics_from_png(state, beauty, id_path)
    result = {
        "ok": True, "index": index, "metrics": metrics,
        "renderSeconds": render_seconds, "wallSeconds": time.monotonic() - started,
        "beautyPath": beauty, "idPath": id_path,
        "lengthReadBack": length_readback,
        "strandsAfter": strands,
        "repairedGuides": state["repairedGuides"],
    }
    if request.get("camera") == "profile":
        result["profileMetrics"] = profile_metrics_from_mask(state, id_path)
    return result


def main():
    os.makedirs(OUT, exist_ok=True)
    try:
        state = build_scene()
    except Exception:
        print(json.dumps({"ok": False, "stage": "setup", "error": traceback.format_exc()}), flush=True)
        return
    print(json.dumps({"ok": True, "ready": True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            if request.get("quit"):
                break
            result = evaluate(state, request)
        except Exception:
            result = {"ok": False, "index": request.get("index") if "request" in locals() else None,
                      "error": traceback.format_exc()}
        print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()

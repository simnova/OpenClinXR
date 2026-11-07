#!/usr/bin/env python3
"""Integrate hair-geo6 f1 with hair-look4 and diagnose the bright part.

All generated files stay below hair-int1.  The source geometry, material,
camera rig, target photos, landmarks, and judge are read-only inputs.
"""
from __future__ import annotations

import colorsys
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L4 = ROOT / "tools/openclinxr/evidence/hair-look4"
L3 = ROOT / "tools/openclinxr/evidence/hair-look3"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back")

sys.path[:0] = [str(L2), str(K1), str(L3), str(JUDGE)]
import experiment as X  # noqa: E402
import cell_rel as C  # noqa: E402
import material as M  # noqa: E402

ST = X.ST
PARAMS = json.load(open(L4 / "cells/best/metrics.json"))["params"]
PARAMS.update({"model": "HUANG"})


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


J = load_module("hair_int1_judge_v6", JUDGE / "hair_judge.py")


def huang_material(state, obj, params):
    local = dict(state)
    local["station"] = ST
    mat = M.material(local, obj, params, model="HUANG")
    for node in mat.node_tree.nodes:
        if node.bl_idname == "ShaderNodeBsdfHairPrincipled":
            for socket in node.inputs:
                if socket.identifier == "Random" or socket.name == "Random":
                    socket.default_value = float(params.get("random", 0.0))
    return mat


def build_hair(state, points, radii, name, params=PARAMS):
    obj = state["bp"].build_blend_curves(state["handle"], state["cap"], points, "UVMap", name)
    obj.data.attributes["radius"].data.foreach_set("value", np.asarray(radii, np.float32).ravel())
    huang_material(state, obj, params)
    return obj


def scalp_patch(state):
    """A cap-only dark scalp liner; it never reaches the face."""
    source = state["cap"]
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = "OCLX_part_scalp_liner"
    bpy.context.collection.objects.link(obj)
    # Move a hair-width above the skin to avoid coplanar flicker, while still
    # remaining below the 0.05 mm root fibres.
    for vertex in obj.data.vertices:
        vertex.co += vertex.normal * 0.00002
    mat = bpy.data.materials.new("OCLX_dark_scalp_under_hair")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    # Dark brown derived from the L4 base, deliberately diffuse to model the
    # pigment + hair-shadow product rather than a second glossy hair layer.
    bsdf.inputs["Base Color"].default_value = (0.022, 0.009, 0.005, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.72
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.hide_render = obj.hide_viewport = True
    return obj


def visibility(state, hairs, patch, patch_on):
    keep = set(hairs)
    for obj in bpy.data.objects:
        if obj.type == "CURVES":
            obj.hide_render = obj.hide_viewport = obj not in keep
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    for obj in hairs:
        obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], hairs[0])
    for obj in hairs[1:]:
        obj.hide_render = obj.hide_viewport = False
    patch.hide_render = patch.hide_viewport = not patch_on


def render_beauty(scene, path, size, samples):
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def render_full(state, obj, patch, tag, patch_on=False):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    ST.lights(state, PARAMS)
    old = state["handle"].hair
    state["handle"].hair = obj
    scene = bpy.context.scene
    try:
        for view in VIEWS:
            visibility(state, [obj], patch, patch_on)
            state["c3"].set_final_view(state["handle"], view)
            C.place_camera_relative(state, PARAMS, view)
            render_beauty(scene, cell / f"{view}.png", 1024, 64)
            # ID masks intentionally exclude the scalp liner.
            patch.hide_render = True
            state["hs"]._render_id(state["handle"], cell / f"{view}-id.png", 1024)
            print("FULL", tag, view, flush=True)
    finally:
        state["handle"].hair = old


def closeup_camera(state):
    cap = np.load(CAP)
    verts = np.asarray(cap["verts"], float)
    front = verts[(np.abs(verts[:, 0] - float(cap["cx"])) < 0.010) & (verts[:, 1] < float(cap["apex_y"]))]
    target = Vector((float(cap["cx"]), float(np.percentile(front[:, 1], 42)), float(np.percentile(front[:, 2], 82))))
    direction = Vector((0.0, -0.72, 0.69)).normalized()
    camera = state["handle"].camera
    camera.location = target + 0.25 * direction
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = 58.0
    return target


def render_closeup(state, hairs, patch, tag, patch_on=False, id_obj=None):
    out = E / "part-probes" / tag
    out.mkdir(parents=True, exist_ok=True)
    ST.lights(state, PARAMS)
    C.place_camera_relative(state, PARAMS, "front")
    closeup_camera(state)
    visibility(state, hairs, patch, patch_on)
    old = state["handle"].hair
    state["handle"].hair = id_obj or hairs[0]
    try:
        render_beauty(bpy.context.scene, out / "closeup.png", 512, 64)
        patch.hide_render = True
        # For roughness split objects the baseline ID is geometrically exact;
        # the probe does not alter geometry. Other probes render their own ID.
        state["hs"]._render_id(state["handle"], out / "closeup-id.png", 512)
    finally:
        state["handle"].hair = old
    print("CLOSEUP", tag, flush=True)
    return out


def part_world_lines():
    cap = np.load(CAP)
    verts = np.asarray(cap["verts"], float)
    cx, apex = float(cap["cx"]), float(cap["apex_y"])
    candidate = verts[(np.abs(verts[:, 0] - cx) <= 0.006) & (verts[:, 1] <= apex + 0.010)]
    lo, hi = np.percentile(candidate[:, 1], (3, 97))
    edges = np.linspace(lo, hi, 42)
    center = []
    for a, b in zip(edges[:-1], edges[1:]):
        q = candidate[(candidate[:, 1] >= a) & (candidate[:, 1] < b)]
        if len(q):
            center.append([cx, float(np.median(q[:, 1])), float(np.max(q[:, 2]) + 0.0001)])
    center = np.asarray(center)
    return center


def project_polyline(scene, camera, points, x_offset, size=512):
    out = []
    for p in points:
        q = np.asarray(p, float).copy()
        q[0] += x_offset
        ndc = world_to_camera_view(scene, camera, Vector(q))
        out.append((float(ndc.x * size), float((1.0 - ndc.y) * size)))
    return out


def strip_mask(scene, camera, points, inner_mm, outer_mm=None, size=512):
    def one(half_mm):
        left = project_polyline(scene, camera, points, -half_mm / 1000.0, size)
        right = project_polyline(scene, camera, points, half_mm / 1000.0, size)
        im = Image.new("L", (size, size), 0)
        ImageDraw.Draw(im).polygon(left + list(reversed(right)), fill=255)
        return np.asarray(im) >= 128
    inner = one(inner_mm)
    return inner if outer_mm is None else one(outer_mm) & ~inner


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def idmask(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230


def lum(a):
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def hue(a, mask):
    px = a[mask]
    if not len(px):
        return None
    hsv = np.asarray([colorsys.rgb_to_hsv(*p) for p in px])
    weights = np.maximum(hsv[:, 1], .02)
    ang = hsv[:, 0] * 2 * math.pi
    return float(math.degrees(math.atan2(np.sum(np.sin(ang) * weights), np.sum(np.cos(ang) * weights))) % 360)


def close_metrics(state, folder):
    image = rgb(folder / "closeup.png")
    hair = idmask(folder / "closeup-id.png")
    center = part_world_lines()
    band = strip_mask(bpy.context.scene, state["handle"].camera, center, 3.0)
    sides = strip_mask(bpy.context.scene, state["handle"].camera, center, 7.0, 24.0)
    y = lum(image)
    hp, sp = band & hair, band & ~hair
    return {
        "bandDefinition": "projected +/-3 mm strip around cap centreline; sides are 7--24 mm from centre",
        "bandPixels": int(band.sum()),
        "hairFraction": float(hp.sum() / max(band.sum(), 1)),
        "skinFraction": float(sp.sum() / max(band.sum(), 1)),
        "hair": {"pixels": int(hp.sum()), "meanLuminance": float(y[hp].mean()) if hp.any() else None, "meanHueDeg": hue(image, hp)},
        "skin": {"pixels": int(sp.sum()), "meanLuminance": float(y[sp].mean()) if sp.any() else None, "meanHueDeg": hue(image, sp)},
        "bandLuminance": float(y[band].mean()),
        "sideLuminance": float(y[sides].mean()),
        "partSide": float(y[band].mean() / max(y[sides].mean(), 1e-12)),
    }


def full_metrics(cell):
    views = {v: X.photometrics(cell / f"{v}.png", cell / f"{v}-id.png", v) for v in VIEWS}
    views["front"].update(X.face_and_part(cell / "front.png", cell / "front-id.png"))
    return views


def triple(row, keys):
    return ",".join(str(row[key]) for key in keys)


def judge(cell, tag):
    lm = json.load(open(LANDMARKS))["judge"]
    out = cell / "judge"
    out.mkdir(exist_ok=True)
    return J.judge(
        str(cell / "front.png"), str(cell / "front-id.png"), tag,
        triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col")), str(out),
        target_set="back", id_mask_path=str(cell / "front-id.png"),
        profile_mask_path=str(cell / "profile_90-id.png"),
        profile_landmarks=triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col")),
        back_mask_path=str(cell / "back-id.png"),
        back_landmarks=triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col")),
        target_front_mask=str(TARGET_MASKS / "mask-front-v2.png"),
        target_profile_mask=str(TARGET_MASKS / "mask-profile-v2.png"),
        target_back_mask=str(TARGET_MASKS / "mask-back-v3.png"), overlay_prefix="overlay-",
    )


def target_close_metrics(state):
    # Same registered crop as the requested sheet; ID class comes from target
    # mask, with the projected physical strip used only for our diagnostic.
    image = rgb(TARGET / "target-front.png")
    mask = np.asarray(Image.open(TARGET_MASKS / "mask-front-v2.png").convert("L")) >= 128
    y = lum(image)
    yy, xx = np.nonzero(mask)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    Y, Xg = np.indices(mask.shape)
    crown = mask & (Y <= y0 + .35*h) & (Xg >= x0 + .35*w) & (Xg <= x0 + .65*w)
    sides = mask & (Y >= y0 + .18*h) & (Y <= y0 + .68*h) & ((Xg <= x0 + .28*w) | (Xg >= x0 + .72*w))
    return {"frontPartSide": float(y[crown].mean() / y[sides].mean())}


def main():
    E.mkdir(parents=True, exist_ok=True)
    src = np.load(G6 / "cells/f1/strands.npz")
    points = np.asarray(src["points"], float)
    roots = np.asarray(src["roots"], float)
    radii = np.asarray(src["radii"], np.float32)
    cx = float(src["cx"])
    state = ST.build_state()
    patch = scalp_patch(state)

    baseline = build_hair(state, points, radii, "hair_int1_i0")
    render_full(state, baseline, patch, "i0", False)
    i0_close = render_closeup(state, [baseline], patch, "i0", False, baseline)
    i0_close_metrics = close_metrics(state, i0_close)

    # A: scalp-only pigmentation/shadow liner.
    a_dir = render_closeup(state, [baseline], patch, "a_scalp_dark", True, baseline)
    a_metrics = close_metrics(state, a_dir)

    # B: deterministic +50% duplicate roots inside the 6 mm full-width band.
    near6 = np.flatnonzero((np.abs(roots[:, 0] - cx) <= .003) & (roots[:, 1] <= float(src["apex_y"])))
    add_ids = near6[::2]
    add = points[add_ids].copy()
    add_r = radii[add_ids].copy()
    side = np.where(add[:, 0, 0] >= cx, 1.0, -1.0)
    add[:, :, 0] += side[:, None] * 0.00004
    b_points = np.concatenate([points, add])
    b_radii = np.concatenate([radii, add_r])
    root_dense = build_hair(state, b_points, b_radii, "hair_int1_root_dense")
    b_dir = render_closeup(state, [root_dense], patch, "b_root_density", False, root_dense)
    b_metrics = close_metrics(state, b_dir)

    # C: only strands rooted within 15 mm get roughness +0.15.
    near15 = (np.abs(roots[:, 0] - cx) <= .015) & (roots[:, 1] <= float(src["apex_y"]))
    far_obj = build_hair(state, points[~near15], radii[~near15], "hair_int1_rough_far")
    rough_params = dict(PARAMS)
    rough_params["roughness"] = min(1.0, float(PARAMS["roughness"]) + .15)
    rough_obj = build_hair(state, points[near15], radii[near15], "hair_int1_rough_near", rough_params)
    c_dir = render_closeup(state, [far_obj, rough_obj], patch, "c_root_roughness", False, baseline)
    # Copy the baseline ID because this probe changes material only and the
    # station's ID helper accepts one hair object.
    c_metrics = close_metrics(state, c_dir)

    target = target_close_metrics(state)
    baseline_error = abs(i0_close_metrics["partSide"] - 1.0)
    candidates = {}
    for key, label, met in (
        ("a", "scalp darkened under cap", a_metrics),
        ("b", "+50% roots within 6 mm", b_metrics),
        ("c", "roughness +0.15 within 15 mm", c_metrics),
    ):
        improvement = baseline_error - abs(met["partSide"] - 1.0)
        # A useful correction must reduce the part/side contrast, not merely
        # darken the whole cap.  The latter made the side reference darker
        # still in probe A and therefore increased the visible line ratio.
        supported = improvement > 0.01 and met["bandLuminance"] <= i0_close_metrics["bandLuminance"]
        candidates[key] = {"label": label, "status": "SUPPORTED" if supported else "REFUTED", "improvementTowardUnity": improvement, **met}

    supported = [k for k, v in candidates.items() if v["status"] == "SUPPORTED"]
    # Use only fixes that reduce the bright line. Material-only roughness is
    # included by itself only if it beats the more causal scalp/density probes.
    use_a = "a" in supported
    use_b = "b" in supported
    use_c = "c" in supported and candidates["c"]["partSide"] < min(candidates["a"]["partSide"], candidates["b"]["partSide"])
    i1_points, i1_radii = (b_points, b_radii) if use_b else (points, radii)
    i1 = build_hair(state, i1_points, i1_radii, "hair_int1_i1", rough_params if use_c else PARAMS)
    render_full(state, i1, patch, "i1", use_a)
    i1_close = render_closeup(state, [i1], patch, "i1", use_a, i1)
    i1_close_metrics = close_metrics(state, i1_close)

    i0_views = full_metrics(E / "cells/i0")
    i1_views = full_metrics(E / "cells/i1")
    i0_judge = judge(E / "cells/i0", "i0")
    i1_judge = judge(E / "cells/i1", "i1")
    for tag, views, judged in (("i0", i0_views, i0_judge), ("i1", i1_views, i1_judge)):
        doc = {
            "tag": tag, "geometrySource": str(G6 / "cells/f1/strands.npz"),
            "materialSource": str(L4 / "cells/best/metrics.json"), "params": PARAMS,
            "views": views,
            "judge": {"front": judged["iou"], "profile": judged["profile_view"]["iou"], "back": judged["back_view"]["iou"]},
        }
        (E / f"cells/{tag}/metrics.json").write_text(json.dumps(doc, indent=2) + "\n")

    diagnosis = {
        "schemaVersion": 1,
        "band": i0_close_metrics,
        "target": target,
        "candidates": candidates,
        "appliedToI1": {"scalpDarkening": use_a, "rootDensity50Percent": use_b, "roughnessPlus015": use_c, "supported": supported},
        "i1Band": i1_close_metrics,
        "closeupCamera": {"distanceFromHairlineM": .25, "view": "top-front", "resolution": 512, "samples": 64},
    }
    (E / "part-diagnosis.json").write_text(json.dumps(diagnosis, indent=2) + "\n")
    print("DIAGNOSIS", json.dumps(diagnosis["appliedToI1"]), flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Hair-look-2 measurement and one-variable render station.

The immutable geometry input is hair-look1/cells/g1/strands.npz and the
immutable lighting/material baseline is hair-look1/cells/g6/params.json.
No .blend is written.  All rendered evidence is rooted beside this file.
"""
from __future__ import annotations

import argparse
import colorsys
import importlib.util
import json
import math
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
K = ROOT / "tools/openclinxr/evidence/hair-look1"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back")
PROBE_VIEWS = VIEWS


def load_station():
    spec = importlib.util.spec_from_file_location("hair_look1_station_for_look2", K / "station.py")
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(K))
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


ST = load_station()
BASE_PARAMS = json.load(open(K / "cells/g6/params.json"))["params"]
BASE_METRICS = json.load(open(K / "cells/g6/metrics.json"))


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float64) / 255.0


def mask_rgba(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230


def mask_l(path):
    return np.asarray(Image.open(path).convert("L")) >= 128


def luminance(a):
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def resize_mask(mask, shape):
    if mask.shape == tuple(shape):
        return mask
    im = Image.fromarray((mask * 255).astype(np.uint8)).resize((shape[1], shape[0]), Image.Resampling.NEAREST)
    return np.asarray(im) >= 128


def hue_sat_bright(image, mask):
    y = luminance(image)
    vals = y[mask]
    if not len(vals):
        return {"hueDeg": None, "saturation": None, "pixels": 0}
    bright = mask & (y >= np.percentile(vals, 90))
    px = image[bright]
    hsv = np.asarray([colorsys.rgb_to_hsv(*q) for q in px])
    weights = np.maximum(hsv[:, 1], .02)
    ang = hsv[:, 0] * 2 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(ang) * weights), np.sum(np.cos(ang) * weights))) % 360
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(px))}


def back_profile(image, mask):
    """Ten top-to-hem luminance bins in the central 40% of the hair sheet."""
    y = luminance(image)
    yy, xx = np.nonzero(mask)
    if not len(yy):
        return {"bins": [None] * 10, "topMinusHemOverMean": None, "pixels": 0}
    y0, y1 = int(yy.min()), int(yy.max()) + 1
    xc = float(np.median(xx))
    half = .20 * (float(xx.max()) - float(xx.min()) + 1)
    X = np.indices(mask.shape)[1]
    band = mask & (X >= xc - half) & (X <= xc + half)
    edges = np.linspace(y0, y1, 11).astype(int)
    bins = []
    for i in range(10):
        m = band.copy()
        m[:edges[i]] = False
        m[edges[i + 1]:] = False
        bins.append(float(np.mean(y[m])) if m.any() else None)
    valid = np.asarray([v for v in bins if v is not None])
    contrast = (bins[0] - bins[-1]) / max(float(valid.mean()), 1e-12) if bins[0] is not None and bins[-1] is not None else None
    return {"bins": bins, "topMinusHemOverMean": float(contrast), "pixels": int(band.sum())}


def target_image(view):
    stem = "profile" if view == "profile_90" else view
    return TARGET / f"target-{stem}.png"


def target_mask(view):
    names = {"front": "mask-front-v2.png", "three_quarter": "mask-three_quarter.png", "profile_90": "mask-profile-v2.png", "back": "mask-back-v3.png"}
    return TARGET_MASKS / names[view]


def photometrics(image_path, id_path, view):
    a = rgb(image_path)
    m = mask_rgba(id_path)
    vals = luminance(a)[m]
    tm = resize_mask(mask_l(target_mask(view)), m.shape)
    intersection = int((m & tm).sum())
    union = int((m | tm).sum())
    out = {
        "p50": float(np.percentile(vals, 50)),
        "p90": float(np.percentile(vals, 90)),
        "highlight": hue_sat_bright(a, m),
        "iou": intersection / max(union, 1),
        "maskPx": int(m.sum()),
    }
    if view == "back":
        out["backProfile"] = back_profile(a, m)
    return out


def target_photometrics(view):
    a = rgb(target_image(view))
    m = mask_l(target_mask(view))
    vals = luminance(a)[m]
    out = {"p50": float(np.percentile(vals, 50)), "p90": float(np.percentile(vals, 90)), "highlight": hue_sat_bright(a, m)}
    if view == "back":
        out["backProfile"] = back_profile(a, m)
    return out


def face_and_part(image_path, id_path):
    a = rgb(image_path)
    m = mask_rgba(id_path)
    y = luminance(a)
    yy, xx = np.nonzero(m)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    Y, X = np.indices(m.shape)
    crown = m & (Y <= y0 + .35 * h) & (X >= x0 + .35 * w) & (X <= x0 + .65 * w)
    sides = m & (Y >= y0 + .18 * h) & (Y <= y0 + .68 * h) & ((X <= x0 + .28 * w) | (X >= x0 + .72 * w))
    cheek = (Y >= .40 * m.shape[0]) & (Y <= .52 * m.shape[0]) & (X >= .39 * m.shape[1]) & (X <= .61 * m.shape[1]) & ~m
    return {"partSide": float(y[crown].mean() / max(y[sides].mean(), 1e-12)), "faceP50": float(np.percentile(y[cheek], 50))}


def curve_shape_readback(scene):
    found = {}
    for owner_name, owner in (("scene.cycles", scene.cycles), ("scene.render", scene.render)):
        for name in dir(owner):
            low = name.lower()
            if any(k in low for k in ("curve", "hair", "subdiv", "width")):
                try:
                    value = getattr(owner, name)
                    if isinstance(value, (str, int, float, bool)):
                        found[f"{owner_name}.{name}"] = value
                except Exception:
                    pass
    return found


def material_readback(obj):
    rows = []
    for mat in obj.data.materials:
        for node in mat.node_tree.nodes:
            rec = {"name": node.name, "type": node.bl_idname}
            if hasattr(node, "parametrization"):
                rec["parametrization"] = node.parametrization
            rec["inputs"] = {}
            for inp in node.inputs:
                try:
                    v = inp.default_value
                    if hasattr(v, "__len__") and not isinstance(v, str):
                        v = [float(x) for x in v]
                    elif isinstance(v, (int, float, bool, str)):
                        v = v
                    else:
                        v = str(v)
                    rec["inputs"][inp.name] = v
                except Exception as exc:
                    rec["inputs"][inp.name] = f"UNREADABLE:{exc}"
            rows.append(rec)
    return rows


def set_curve_shape(scene, shape):
    before = curve_shape_readback(scene)
    changed = []
    if shape:
        for owner in (scene.cycles, scene.render):
            for name in ("curve_shape", "hair_shape", "curves_shape"):
                if hasattr(owner, name):
                    try:
                        setattr(owner, name, shape)
                        changed.append(f"{type(owner).__name__}.{name}={shape}")
                    except Exception as exc:
                        changed.append(f"{type(owner).__name__}.{name}:FAILED:{exc}")
    return {"requested": shape, "changes": changed, "before": before, "after": curve_shape_readback(scene)}


def make_material(state, obj, params):
    return ST.material(state, obj, params)


def make_object(state, kids, tag, radius_mm=.05, params=None, tip_ratio=1.0):
    obj = state["bp"].build_blend_curves(state["handle"], state["cap"], kids, "UVMap", tag)
    ar = ST.arc(kids)
    remain = ar[:, -1, None] - ar
    taper = np.clip(remain / .030, 0, 1)
    radii = np.full((len(kids), kids.shape[1]), radius_mm / 1000.0, dtype=np.float32)
    radii *= tip_ratio + (1 - tip_ratio) * ST.smooth(taper)
    obj.data.attributes["radius"].data.foreach_set("value", radii.ravel())
    make_material(state, obj, params or BASE_PARAMS)
    return obj


def density_geometry(kids, factor):
    if factor == 1:
        return kids
    if factor == .5:
        return kids[::2]
    if factor == 2:
        # A deterministic, sub-radius duplicate is enough to measure optical
        # density while preserving the accepted g1 silhouette and endpoints.
        dup = kids.copy()
        dup[:, :, 0] += 0.000025
        return np.concatenate([kids, dup], axis=0)
    raise ValueError(factor)


def configure_lights(state, params, mode):
    ST.lights(state, params)
    target = state["handle"].target
    if mode == "no_backlight":
        for light in state["handle"].lights:
            if light.name == "OCLX_rim":
                light.data.energy = 0
    elif mode == "front_key":
        # Put key on the camera/front side of the head plane (negative Y),
        # keep fill soft, and remove the rear rim.
        for light in state["handle"].lights:
            if light.name == "OCLX_key":
                light.location.y = min(float(target.y) - .8, -.8)
                light.data.energy = float(params.get("key_energy", 105.0))
                light.rotation_euler = (ST.Vector(target) - light.location).to_track_quat("-Z", "Y").to_euler()
            elif light.name == "OCLX_rim":
                light.data.energy = 0


def render_cell(state, kids, tag, params, radius_mm=.05, density=1, light_mode="base", size=1024, samples=64, views=PROBE_VIEWS, seed=0, curve_shape=None, tip_ratio=1.0):
    cell = HERE / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    use_kids = density_geometry(kids, density)
    obj = make_object(state, use_kids, "look2_" + tag, radius_mm, params, tip_ratio)
    shape = set_curve_shape(bpy.context.scene, curve_shape)
    ST.visibility(state, obj)
    configure_lights(state, params, light_mode)
    scene = bpy.context.scene
    scene.cycles.samples = samples
    if hasattr(scene.cycles, "transparent_max_bounces") and params.get("transparent_max_bounces") is not None:
        scene.cycles.transparent_max_bounces = int(params["transparent_max_bounces"])
    old = state["handle"].hair
    state["handle"].hair = obj
    renders = {}
    try:
        for view in views:
            state["c3"].set_final_view(state["handle"], view)
            beauty, ident = cell / f"{view}.png", cell / f"{view}-id.png"
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.cycles.samples = samples
            scene.cycles.seed = seed
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], ident, size)
            renders[view] = {"png": str(beauty), "id": str(ident)}
            print("RENDERED", tag, view, flush=True)
    finally:
        state["handle"].hair = old
    metrics = {view: photometrics(cell / f"{view}.png", cell / f"{view}-id.png", view) for view in views}
    if "front" in views:
        metrics["front"].update(face_and_part(cell / "front.png", cell / "front-id.png"))
    doc = {"tag": tag, "params": params, "radiusMm": radius_mm, "densityFactor": density, "lightMode": light_mode, "curveShape": shape, "renders": renders, "views": metrics}
    (cell / "metrics.json").write_text(json.dumps(doc, indent=2) + "\n")
    return doc


def render_patch(state, kids, tag, count):
    cd = np.load(ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz")
    centre = float(cd["cx"])
    in_band = np.nonzero(np.abs(kids[:, 0, 0] - centre) <= .020)[0]
    ids = in_band if count is None else in_band[np.linspace(0, len(in_band) - 1, min(count, len(in_band))).astype(int)]
    obj = make_object(state, kids[ids], "patch_" + tag, .05, BASE_PARAMS)
    ST.visibility(state, obj)
    configure_lights(state, BASE_PARAMS, "base")
    # Groom-only: retain lights/camera/world but hide all scene meshes.
    mesh_visibility = {}
    for o in bpy.data.objects:
        if o.type == "MESH":
            mesh_visibility[o.name] = (o.hide_render, o.hide_viewport)
            o.hide_render = True
    scene = bpy.context.scene
    state["c3"].set_final_view(state["handle"], "back")
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 64
    scene.render.film_transparent = False
    out = HERE / "patches"
    out.mkdir(exist_ok=True)
    scene.render.filepath = str(out / f"{tag}.png")
    bpy.ops.render.render(write_still=True)
    for name, visibility in mesh_visibility.items():
        o = bpy.data.objects.get(name)
        if o is not None:
            o.hide_render, o.hide_viewport = visibility
    return {"tag": tag, "count": int(len(ids)), "bandCount": int(len(in_band)), "png": str(out / f"{tag}.png")}


def patch_sheet():
    box = (320, 280, 704, 664)
    sources = [("TS", target_image("back")), ("400 fibres", HERE / "patches/sparse.png"), ("full band", HERE / "patches/full.png")]
    canvas = Image.new("RGB", (384 * 3, 416), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (label, path) in enumerate(sources):
        im = Image.open(path).convert("RGB").crop(box)
        canvas.paste(im, (384 * i, 32))
        draw.text((384 * i + 8, 9), label, fill="black")
    canvas.save(HERE / "sparse-patch.png")


def diagnosis():
    state = ST.build_state()
    src = np.load(K / "cells/g1/strands.npz")
    kids = np.asarray(src["points"], dtype=np.float64)
    obj = make_object(state, kids, "b7_diagnosis", .05, BASE_PARAMS)
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    radius = np.empty(len(evaluated.points), dtype=np.float32)
    evaluated.attributes["radius"].data.foreach_get("value", radius)
    curve_counts = np.empty(len(evaluated.curves) + 1, dtype=np.int64)
    evaluated.curve_offset_data.foreach_get("value", curve_counts)
    curve_counts = np.diff(curve_counts)
    evaluated_doc = {
        "objectType": obj.type,
        "curves": int(len(evaluated.curves)),
        "points": int(len(evaluated.points)),
        "pointsPerCurve": {"min": int(curve_counts.min()), "max": int(curve_counts.max()), "median": float(np.median(curve_counts))},
        "radiusMetres": {"min": float(radius.min()), "p05": float(np.percentile(radius, 5)), "median": float(np.median(radius)), "p95": float(np.percentile(radius, 95)), "max": float(radius.max())},
        "radiusMillimetresMedian": float(np.median(radius) * 1000),
        "curveSettings": curve_shape_readback(bpy.context.scene),
        "dataProperties": {k: getattr(evaluated, k) for k in ("surface_uv_map",) if hasattr(evaluated, k)},
    }
    material_doc = material_readback(obj)
    target = {v: target_photometrics(v) for v in VIEWS}
    ours = {v: photometrics(K / "cells/g6" / f"{v}.png", K / "cells/g6" / f"{v}-id.png", v) for v in VIEWS}
    ours["front"].update(face_and_part(K / "cells/g6/front.png", K / "cells/g6/front-id.png"))
    lights = []
    for light in state["handle"].lights:
        lights.append({"name": light.name, "position": [float(x) for x in light.location], "energy": float(light.data.energy), "size": float(light.data.size), "relativeToHeadTarget": [float(light.location[i] - state["handle"].target[i]) for i in range(3)]})
    sparse = render_patch(state, kids, "sparse", 400)
    full = render_patch(state, kids, "full", None)
    patch_sheet()
    doc = {
        "schemaVersion": 1,
        "baseline": "b7 = g1 geometry + g6 light/material",
        "precedesChanges": True,
        "evaluatedHair": evaluated_doc,
        "materialNodes": material_doc,
        "lights": lights,
        "photometrics": {"ours": ours, "target": target},
        "sparsePatch": {"sparse": sparse, "full": full, "registeredCrop": [320, 280, 704, 664], "sheet": str(HERE / "sparse-patch.png")},
        "candidates": {
            "a_representation": {"status": "UNKNOWN", "probe": "p1 pending", "number": {"evaluatedRadiusMm": float(np.median(radius) * 1000), "curveSettings": evaluated_doc["curveSettings"]}},
            "b_bsdf": {"status": "UNKNOWN", "probe": "p2 pending", "number": {"baselineTopHighlight": ours["back"]["highlight"]}},
            "c_occlusion": {"status": "UNKNOWN", "probe": "p4 pending", "number": {"baselineBackProfile": ours["back"]["backProfile"]}},
            "d_density": {"status": "UNKNOWN", "probe": "p4 density ladder pending", "number": {"curves": evaluated_doc["curves"], "radiusMm": float(np.median(radius) * 1000)}},
            "e_light": {"status": "UNKNOWN", "probe": "p3/p5 pending", "number": {"baselineTopHighlight": ours["back"]["highlight"]}},
        },
    }
    (HERE / "diagnosis.json").write_text(json.dumps(doc, indent=2, default=str) + "\n")
    print("DIAGNOSIS_DONE", json.dumps({"radiusMm": doc["evaluatedHair"]["radiusMillimetresMedian"], "curves": doc["evaluatedHair"]["curves"]}), flush=True)


PROBES = {
    "b7": {"params": BASE_PARAMS, "radius": .05, "density": 1, "light": "base"},
    "p1": {"params": BASE_PARAMS, "radius": .05, "density": 1, "light": "base", "shape": "THICK", "tip_ratio": .30},
    "p2": {"params": {**BASE_PARAMS, "melanin": .94, "redness": .15, "roughness": .30, "root_dark": .05}, "radius": .05, "density": 1, "light": "base"},
    "p3": {"params": BASE_PARAMS, "radius": .05, "density": 1, "light": "no_backlight"},
    "p4-bounces": {"params": {**BASE_PARAMS, "transparent_max_bounces": 32}, "radius": .05, "density": 1, "light": "base"},
    "p4-half": {"params": BASE_PARAMS, "radius": .07, "density": .5, "light": "base"},
    "p4-double": {"params": BASE_PARAMS, "radius": .035, "density": 2, "light": "base"},
    "p5": {"params": {**BASE_PARAMS, "key_energy": 105.0, "fill_W": 80.0}, "radius": .05, "density": 1, "light": "front_key"},
}


def probes(tags):
    if not (HERE / "diagnosis.json").exists():
        raise RuntimeError("G1: diagnosis.json must exist before probes")
    kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
    state = ST.build_state()
    for tag in tags:
        spec = PROBES[tag]
        render_cell(state, kids, tag, spec["params"], spec["radius"], spec["density"], spec["light"], 1024, 64, PROBE_VIEWS, 0, spec.get("shape"), spec.get("tip_ratio", 1.0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("phase", choices=("diagnosis", "probes", "render"))
    ap.add_argument("--tags", default=",".join(PROBES))
    ap.add_argument("--tag")
    ap.add_argument("--params")
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--samples", type=int, default=32)
    ap.add_argument("--seed", type=int, default=0)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    a = ap.parse_args(argv)
    if a.phase == "diagnosis":
        diagnosis()
    elif a.phase == "probes":
        probes([x for x in a.tags.split(",") if x])
    else:
        if not (HERE / "diagnosis.json").exists():
            raise RuntimeError("G1: diagnosis.json must exist before render")
        params = json.load(open(a.params))
        kids = np.asarray(np.load(K / "cells/g1/strands.npz")["points"], float)
        state = ST.build_state()
        render_cell(state, kids, a.tag, params, .05, 1, params.pop("light_mode", "front_key"), a.size, a.samples, VIEWS, a.seed, "THICK")


if __name__ == "__main__":
    main()

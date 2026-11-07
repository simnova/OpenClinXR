#!/usr/bin/env python3
"""Hair look-6: tint, random-roughness band breakup, and part crossings.

Run inside Blender.  All source evidence is immutable and all outputs stay
below hair-look6.  No .blend is written.
"""
from __future__ import annotations

import argparse
import colorsys
import importlib.util
import json
import math
import shutil
import sys
import time
from collections import deque
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
REAL1 = ROOT / "tools/openclinxr/evidence/hair-real1"
LOOK5 = ROOT / "tools/openclinxr/evidence/hair-look5"
TOP1 = ROOT / "tools/openclinxr/evidence/hair-top1"
INT1 = ROOT / "tools/openclinxr/evidence/hair-int1"
LOOK2 = ROOT / "tools/openclinxr/evidence/hair-look2"
LOOK1 = ROOT / "tools/openclinxr/evidence/hair-look1"
GEO6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back")
ALL_VIEWS = (*VIEWS, "crown_top")
TARGET_NAMES = {"front": "target-front.png", "three_quarter": "target-three_quarter.png", "profile_90": "target-profile.png", "back": "target-back.png"}
TARGET_MASK_NAMES = {"front": "mask-front-v2.png", "three_quarter": "mask-three-quarter.png", "profile_90": "mask-profile-v2.png", "back": "mask-back-v3.png"}
BACK_CROP_1024 = (320, 280, 704, 664)
TS_BACK_LINEAR = (0.01599629336550963, 0.011612245179743885, 0.009134058702220787)
BASE_PARAMS = json.load(open(LOOK5 / "cells/best/metrics.json"))["params"]
BASE_FACE = float(json.load(open(LOOK5 / "cells/best/metrics.json"))["views"]["front"]["faceP50"])

sys.path[:0] = [str(INT1), str(LOOK2), str(LOOK1), str(GEO6)]
import run_blender as R  # noqa: E402
import cell_rel as C  # noqa: E402
import base_children  # noqa: E402


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


TOP_METRIC = load_module("hair_look6_top_metric", TOP1 / "metric.py")


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--step1", action="store_true")
    p.add_argument("--step2", action="store_true")
    p.add_argument("--step3", action="store_true")
    p.add_argument("--step4-5", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = p.parse_args(argv)
    if sum((a.step1, a.step2, a.step3, a.step4_5)) != 1:
        p.error("select exactly one step")
    return a


def source_geometry():
    d = np.load(REAL1 / "cells/a1/strands.npz")
    return {k: np.asarray(d[k]) for k in d.files}


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def alpha(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3]


def mask(path, threshold=230):
    return alpha(path) >= threshold


def lum(a):
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def hair_node(obj):
    for mat in obj.data.materials:
        for node in mat.node_tree.nodes:
            if node.bl_idname == "ShaderNodeBsdfHairPrincipled":
                return node
    raise RuntimeError("Principled Hair node not found")


def configure_material(obj, spec):
    node = hair_node(obj)
    sockets = {socket.identifier: socket for socket in node.inputs}
    if "directColorLinear" in spec:
        node.parametrization = "COLOR"
        sockets["Color"].default_value = (*spec["directColorLinear"], 1.0)
    if "tint" in spec:
        sockets["Tint"].default_value = (*spec["tint"], 1.0)
    if "randomRoughness" in spec:
        sockets["Random Roughness"].default_value = float(spec["randomRoughness"])
    if "aspectRatio" in spec:
        sockets["Aspect Ratio"].default_value = float(spec["aspectRatio"])
    return {
        "model": node.model,
        "parametrization": node.parametrization,
        "Tint": [float(x) for x in sockets["Tint"].default_value],
        "Color": [float(x) for x in sockets["Color"].default_value],
        "Random Roughness": float(sockets["Random Roughness"].default_value),
        "Aspect Ratio": float(sockets["Aspect Ratio"].default_value),
    }


def set_lights(state):
    R.ST.lights(state, BASE_PARAMS)
    for light in state["handle"].lights:
        if light.name == "OCLX_rim":
            light.data.energy = float(BASE_PARAMS["rim_W"])


def visibility(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)


def render_cell(tag, material_spec, points=None, radii=None, size=512, samples=32, views=VIEWS, render_ids=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    state = R.ST.build_state()
    data = source_geometry()
    points = data["points"] if points is None else points
    radii = data["radii"] if radii is None else radii
    obj = R.build_hair(state, points, radii, f"hair_look6_{tag}", BASE_PARAMS)
    readback = configure_material(obj, material_spec)
    visibility(state, obj)
    set_lights(state)
    out = E / "cells" / tag
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    old = state["handle"].hair
    state["handle"].hair = obj
    timings = {}
    try:
        for view in views:
            state["c3"].set_final_view(state["handle"], view)
            if view in VIEWS:
                C.place_camera_relative(state, BASE_PARAMS, view)
            scene.render.resolution_x = scene.render.resolution_y = size
            scene.render.resolution_percentage = 100
            scene.cycles.samples = samples
            scene.cycles.seed = 0
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(out / f"{view}.png")
            started = time.perf_counter()
            bpy.ops.render.render(write_still=True)
            timings[view] = time.perf_counter() - started
            if render_ids:
                state["hs"]._render_id(state["handle"], out / f"{view}-id.png", size)
            print("RENDERED", tag, view, f"{timings[view]:.2f}s", flush=True)
    finally:
        state["handle"].hair = old
    return state, readback, timings


def copy_ids(src_tag, dst_tag, views=VIEWS):
    dst = E / "cells" / dst_tag
    dst.mkdir(parents=True, exist_ok=True)
    for view in views:
        shutil.copy2(E / "cells" / src_tag / f"{view}-id.png", dst / f"{view}-id.png")


def hue_sat(image, m):
    vals = lum(image)[m]
    bright = m & (lum(image) >= np.percentile(vals, 90))
    hsv = np.asarray([colorsys.rgb_to_hsv(*q) for q in image[bright]])
    weights = np.maximum(hsv[:, 1], .02)
    angle = hsv[:, 0] * 2 * math.pi
    hue = math.degrees(math.atan2(np.sum(np.sin(angle) * weights), np.sum(np.cos(angle) * weights))) % 360
    return {"hueDeg": float(hue), "saturation": float(np.median(hsv[:, 1])), "pixels": int(len(hsv))}


def photometrics(cell, view):
    image = rgb(cell / f"{view}.png")
    m = mask(cell / f"{view}-id.png")
    vals = lum(image)[m]
    return {"p50": float(np.percentile(vals, 50)), "p90": float(np.percentile(vals, 90)), "highlight": hue_sat(image, m), "maskPx": int(m.sum())}


def face_p50(cell):
    return float(R.X.face_and_part(cell / "front.png", cell / "front-id.png")["faceP50"])


def silhouette_delta(base, cell, views=VIEWS):
    out = {}
    for view in views:
        a, b = mask(base / f"{view}-id.png"), mask(cell / f"{view}-id.png")
        iou = float((a & b).sum() / max((a | b).sum(), 1))
        out[view] = {"iouVsBase": iou, "deltaIou": iou - 1.0}
    return out


def cell_metrics(tag, base_tag="base"):
    cell = E / "cells" / tag
    base = E / "cells" / base_tag
    views = {view: photometrics(cell, view) for view in VIEWS}
    face = face_p50(cell)
    base_face = face_p50(base)
    sil = silhouette_delta(base, cell)
    return {"views": views, "faceCheekP50": face, "faceMoveFraction": abs(face - base_face) / max(base_face, 1e-12), "silhouette": sil,
            "commonGates": {"absDeltaIouAtMost001EachView": all(abs(x["deltaIou"]) <= .01 for x in sil.values()), "faceCheekWithin5Percent": abs(face - base_face) / max(base_face, 1e-12) <= .05}}


def choose_colour(cells):
    def penalty(row):
        back = row["views"]["back"]
        h = back["highlight"]["hueDeg"]
        p50 = back["p50"]
        base50 = cells["base"]["views"]["back"]["p50"]
        sat = row["views"]["front"]["highlight"]["saturation"]
        return max(18-h, 0, h-23) * 10 + max(abs(p50-base50)-.01, 0) * 1000 + max(sat-.25, 0) * 100 + abs(h-20.5)
    passing = [tag for tag in ("t1", "t2", "t3") if cells[tag]["gates"]["colour"] and all(cells[tag]["commonGates"].values())]
    return min(passing, key=lambda tag: penalty(cells[tag])) if passing else "base"


def step1():
    E.mkdir(parents=True, exist_ok=True)
    specs = {
        "base": ({}, "look5 HUANG base; a1 strands"),
        "t1": ({"tint": (1.0, .92, .72)}, "Tint (1.0, 0.92, 0.72)"),
        "t2": ({"tint": (1.0, .88, .62)}, "Tint (1.0, 0.88, 0.62)"),
        "t3": ({"directColorLinear": TS_BACK_LINEAR}, "Direct Coloring from TS back hair-mask RGB median"),
    }
    cells = {}
    for index, (tag, (spec, label)) in enumerate(specs.items()):
        _state, readback, timings = render_cell(tag, spec, render_ids=index == 0)
        if index:
            copy_ids("base", tag)
        row = cell_metrics(tag)
        base50 = row["views"]["back"]["p50"] if tag == "base" else cells["base"]["views"]["back"]["p50"]
        row.update({"label": label, "materialSpec": spec, "materialReadback": readback, "renderSeconds": timings})
        row["gates"] = {"colour": 18 <= row["views"]["back"]["highlight"]["hueDeg"] <= 23 and abs(row["views"]["back"]["p50"] - base50) <= .01 and row["views"]["front"]["highlight"]["saturation"] <= .25}
        cells[tag] = row
    selected = choose_colour(cells)
    doc = {"schemaVersion": 1, "resolution": 512, "samples": 32, "geometrySource": str(REAL1 / "cells/a1/strands.npz"), "materialBase": BASE_PARAMS,
           "directColorMeasurement": {"source": str(TARGET / "target-back.png"), "mask": str(TARGET_MASKS / "mask-back-v3.png"), "sRGBMedian": [0.13333333333333333, 0.10980392156862745, 0.09411764705882353], "linearRGB": list(TS_BACK_LINEAR)},
           "cells": cells, "selected": selected, "selectionRule": "passing colour/common gates, then minimum bounded gate penalty and distance to TS back hue 20.5deg; revert to base when none pass"}
    (E / "colour.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("COLOUR", selected, json.dumps({t: {"backHue": r["views"]["back"]["highlight"]["hueDeg"], "backP50": r["views"]["back"]["p50"], "frontSat": r["views"]["front"]["highlight"]["saturation"], "gate": r["gates"]["colour"]} for t, r in cells.items()}), flush=True)


def scaled_crop(size):
    return tuple(int(round(x * size / 1024)) for x in BACK_CROP_1024)


def resize_target(size):
    image = Image.open(TARGET / "target-back.png").convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    m = Image.open(TARGET_MASKS / "mask-back-v3.png").convert("L").resize((size, size), Image.Resampling.NEAREST)
    return np.asarray(image, float) / 255.0, np.asarray(m) >= 128


def connected_components(binary):
    seen = np.zeros(binary.shape, bool)
    areas = []
    h, w = binary.shape
    for y, x in np.argwhere(binary):
        if seen[y, x]:
            continue
        q = deque([(int(y), int(x))]); seen[y, x] = True; area = 0
        while q:
            yy, xx = q.popleft(); area += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = yy + dy, xx + dx
                    if (dy or dx) and 0 <= ny < h and 0 <= nx < w and binary[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True; q.append((ny, nx))
        areas.append(area)
    return areas


def band_metrics_arrays(image, hair, size):
    x0, y0, x1, y1 = scaled_crop(size)
    image, hair = image[y0:y1, x0:x1], hair[y0:y1, x0:x1]
    y = lum(image)
    threshold = float(np.percentile(y[hair], 90))
    areas = connected_components(hair & (y > threshold))
    columns = np.asarray([float(y[:, x][hair[:, x]].mean()) if hair[:, x].any() else np.nan for x in range(hair.shape[1])])
    good = np.isfinite(columns)
    columns[~good] = np.interp(np.flatnonzero(~good), np.flatnonzero(good), columns[good])
    window = min(51, len(columns) // 2 * 2 - 1)
    trend = np.convolve(np.pad(columns, window // 2, mode="reflect"), np.ones(window) / window, mode="valid")
    signal = columns - trend; signal -= signal.mean()
    corr = np.correlate(signal, signal, mode="full")[len(signal)-1:]
    corr /= max(float(corr[0]), 1e-12)
    min_lag, max_lag = max(3, int(round(12 * size / 1024))), min(len(corr)-1, int(round(325 * size / 1024)))
    peaks = [i for i in range(min_lag + 1, max_lag) if corr[i] > corr[i-1] and corr[i] >= corr[i+1]]
    best = max(peaks, key=lambda i: corr[i], default=None)
    return {"crop1024": list(BACK_CROP_1024), "cropAtResolution": [x0, y0, x1, y1], "hairP90Luminance": threshold,
            "brightComponents": {"count": len(areas), "meanAreaPx": float(np.mean(areas)) if areas else 0.0, "areasPx": areas},
            "columnLuminanceAutocorrelation": {"peak": float(corr[best]) if best else None, "periodPx": int(best) if best else None, "minimumLagPx": min_lag}}


def band_metrics_cell(tag):
    cell = E / "cells" / tag
    return band_metrics_arrays(rgb(cell / "back.png"), mask(cell / "back-id.png"), 512)


def select_bands(cells, base_band):
    base_count = base_band["brightComponents"]["count"]
    passing = [t for t in ("r1", "r2", "r3") if cells[t]["gates"]["bands"] and all(cells[t]["commonGates"].values())]
    if passing:
        return max(passing, key=lambda t: cells[t]["bands"]["brightComponents"]["count"])
    return "base"


def step2():
    colour = json.load(open(E / "colour.json"))
    colour_tag = colour["selected"]
    colour_spec = colour["cells"][colour_tag]["materialSpec"]
    specs = {
        "r1": ({**colour_spec, "randomRoughness": .3}, "Random Roughness 0.3"),
        "r2": ({**colour_spec, "randomRoughness": .5}, "Random Roughness 0.5"),
        "r3": ({**colour_spec, "randomRoughness": .5, "aspectRatio": .85}, "Random Roughness 0.5 + Aspect Ratio 0.85"),
    }
    base_band = band_metrics_cell("base")
    selected_colour_band = band_metrics_cell(colour_tag)
    cells = {}
    for tag, (spec, label) in specs.items():
        _state, readback, timings = render_cell(tag, spec, render_ids=False)
        copy_ids("base", tag)
        row = cell_metrics(tag)
        row.update({"label": label, "materialSpec": spec, "materialReadback": readback, "renderSeconds": timings, "bands": band_metrics_cell(tag)})
        peak = row["bands"]["columnLuminanceAutocorrelation"]["peak"]
        row["gates"] = {"bands": row["bands"]["brightComponents"]["count"] >= 5 * base_band["brightComponents"]["count"] and peak is not None and peak <= .3}
        cells[tag] = row
    ts_image, ts_mask = resize_target(512)
    ts = band_metrics_arrays(ts_image, ts_mask, 512)
    selected = select_bands(cells, base_band)
    doc = {"schemaVersion": 1, "resolution": 512, "samples": 32, "colourSource": colour_tag, "base": base_band, "selectedColourBeforeRoughness": selected_colour_band,
           "targetScaledTo512": ts, "cells": cells, "selected": selected, "selectedPassed": selected != "base" and cells[selected]["gates"]["bands"] and all(cells[selected]["commonGates"].values()),
           "gate": "bright component count >=5x card base and column-luminance autocorrelation peak <=0.3"}
    (E / "bands.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("BANDS", selected, json.dumps({t: {"components": r["bands"]["brightComponents"]["count"], "meanArea": r["bands"]["brightComponents"]["meanAreaPx"], "peak": r["bands"]["columnLuminanceAutocorrelation"]["peak"], "gate": r["gates"]["bands"]} for t, r in cells.items()}), flush=True)


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)), np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def part_geometry():
    data = source_geometry()
    points = np.asarray(data["points"], float).copy()
    roots = np.asarray(data["roots"], float).copy()
    cx, apex = float(data["cx"]), float(data["apex_y"])
    near = np.flatnonzero((np.abs(roots[:, 0] - cx) <= .003) & (roots[:, 1] <= apex))
    aa = arc(points)
    at20 = np.argmin(np.abs(aa[near] - .020), axis=1)
    endx = points[near, at20, 0]
    mirrored = 2 * roots[near, 0] - endx
    candidate = near[np.sign(roots[near, 0] - cx) * np.sign(mirrored - cx) < 0]
    rng = np.random.default_rng(20261014 + 606)
    wanted = int(round(.04 * len(near)))
    chosen = np.sort(rng.choice(candidate, size=wanted, replace=False))
    chosen_mask = np.zeros(len(points), bool); chosen_mask[chosen] = True
    fade = (1.0 - smooth(np.clip((aa - .020) / .010, 0.0, 1.0))) * chosen_mask[:, None]
    dx = points[:, :, 0] - roots[:, None, 0]
    points[:, :, 0] -= 2.0 * dx * fade

    # Seeded +/-15 degree root lean variation around the local fore-aft axis,
    # fading back into the frozen a1 flow from 20 to 30 mm.
    angles = np.zeros(len(points), float)
    angles[near] = rng.uniform(-15.0, 15.0, len(near))
    theta = np.radians(angles)[:, None]
    root_fade = 1.0 - smooth(np.clip((aa - .020) / .010, 0.0, 1.0))
    qx = points[:, :, 0] - roots[:, None, 0]
    qz = points[:, :, 2] - roots[:, None, 2]
    rx = np.cos(theta) * qx + np.sin(theta) * qz
    rz = -np.sin(theta) * qx + np.cos(theta) * qz
    points[:, :, 0] += (rx - qx) * root_fade
    points[:, :, 2] += (rz - qz) * root_fade

    # Make the requested crossing true after the lean perturbation: selected
    # fibres land 1 mm beyond the centreline from 10--20 mm, then rejoin by
    # 30 mm.  Roots themselves remain on their original side of the slit.
    chosen_at20 = np.argmin(np.abs(aa[chosen] - .020), axis=1)
    side = np.where(roots[chosen, 0] >= cx, 1.0, -1.0)
    target_x = cx - side * .001
    correction = target_x - points[chosen, chosen_at20, 0]
    crossing_shape = smooth(aa[chosen] / .010) * (1.0 - smooth(np.clip((aa[chosen] - .020) / .010, 0.0, 1.0)))
    points[chosen, :, 0] += correction[:, None] * crossing_shape
    points[chosen, :, 2] += .020 * crossing_shape
    points, collider = base_children.repair_outside(points, R.ST.build_state()["handle"])
    aa2 = arc(points)
    remain = aa2[:, -1, None] - aa2
    radii = (.00005 * (.30 + .70 * smooth(np.clip(remain / .025, 0.0, 1.0)))).astype(np.float32)
    at20_all = np.argmin(np.abs(aa2[chosen] - .020), axis=1)
    crossed = np.sign(roots[chosen, 0] - cx) * np.sign(points[chosen, at20_all, 0] - cx) < 0
    audit = {"source": str(REAL1 / "cells/a1/strands.npz"), "seed": 20261620, "nearPartWithin3mm": int(len(near)), "selectedCrossings": int(len(chosen)),
             "selectedFraction": float(len(chosen) / len(near)), "crossedAt20mmAfterRepair": int(crossed.sum()), "crossedFractionOfNearPart": float(crossed.sum() / len(near)),
             "flow": "selected strands mirror lateral displacement about their root through 20mm, smooth rejoin by 30mm", "rootLeanDeg": {"population": "roots within 3mm of part", "min": float(angles[near].min()), "max": float(angles[near].max()), "p50Abs": float(np.median(np.abs(angles[near])))}, "collider": collider}
    return points, roots, radii, audit


def crown_frame(state, size):
    bpy.context.view_layer.update()
    cap = np.load(CAP); verts = np.asarray(cap["verts"], float); cx, apex = float(cap["cx"]), float(cap["apex_y"])
    forehead = verts[np.asarray(cap["forehead"], int).ravel()]
    hairline = float(np.median(forehead[np.abs(forehead[:, 0] - cx) <= .003, 1])); y0 = hairline + .010
    camera, scene = state["handle"].camera, bpy.context.scene
    def surface(x, y):
        score = ((verts[:, 0] - x) / .002) ** 2 + ((verts[:, 1] - y) / .002) ** 2
        return verts[int(np.argmin(score))]
    def project(p):
        q = world_to_camera_view(scene, camera, Vector(tuple(p)))
        return float(q.x * size), float((1.0 - q.y) * size)
    def strip(inner, outer):
        ys = np.linspace(y0, apex, 80); im = Image.new("L", (size, size), 0); draw = ImageDraw.Draw(im)
        for sign in (-1., 1.):
            a = [project(surface(cx + sign * outer / 1000, y)) for y in ys]
            b = [project(surface(cx + sign * inner / 1000, y)) for y in ys[::-1]]
            draw.polygon(a + b, fill=255)
        return np.asarray(im) >= 128
    return {"strip": strip, "hairlineY": hairline, "startY": y0, "apexY": apex}


def part_metrics(state, cell, size):
    frame = crown_frame(state, size)
    a = alpha(cell / "crown_top-id.png"); y = lum(rgb(cell / "crown_top.png"))
    part, sides, box = frame["strip"](0, 3), frame["strip"](7, 24), frame["strip"](0, 50)
    tiles = {}
    for label, lo, hi in (("0-10", 3, 10), ("10-20", 10, 20), ("20-30", 20, 30), ("30-50", 30, 50)):
        m = frame["strip"](lo, hi)
        tiles[label] = {"pixels": int(m.sum()), "bareFraction": float((m & (a < 30)).sum() / max(m.sum(), 1)), "partialFraction": float((m & (a >= 30) & (a < 230)).sum() / max(m.sum(), 1))}
    return {"definition": "hair-top1 physical crown strip, own hairline+10mm through apex; part +/-3mm; sides 7-24mm; crown box +/-50mm",
            "partSide": float(y[part].mean() / max(y[sides].mean(), 1e-12)), "crownBox": {"pixels": int(box.sum()), "bareFraction": float((box & (a < 30)).sum() / max(box.sum(), 1)), "partialFraction": float((box & (a >= 30) & (a < 230)).sum() / max(box.sum(), 1))}, "tiles": tiles}


def step3():
    bands = json.load(open(E / "bands.json")); colour = json.load(open(E / "colour.json"))
    band_tag = bands["selected"]
    spec = bands["cells"][band_tag]["materialSpec"] if band_tag in bands["cells"] else colour["cells"][colour["selected"]]["materialSpec"]
    points, roots, radii, audit = part_geometry()
    out = E / "cells/part"; out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "strands.npz", points=points.astype(np.float32), roots=roots.astype(np.float32), radii=radii, apex_y=float(source_geometry()["apex_y"]), cx=float(source_geometry()["cx"]))
    (out / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    state, readback, timings = render_cell("part", spec, points, radii, 512, 32, ALL_VIEWS, True)
    metrics = cell_metrics("part")
    pm = part_metrics(state, out, 512)
    gates = {**metrics["commonGates"], "partSideBetween1And1p1": 1.0 <= pm["partSide"] <= 1.1, "crownBoxBareAtMost5Percent": pm["crownBox"]["bareFraction"] <= .05, "colliderInsideZero": audit["collider"]["post_inside_total"] == 0}
    doc = {"schemaVersion": 1, "resolution": 512, "samples": 32, "colourSource": colour["selected"], "bandSource": band_tag, "materialSpec": spec, "materialReadback": readback,
           "audit": audit, "metrics": metrics, "honestPart": pm, "renderSeconds": timings, "gates": gates, "selected": all(gates.values())}
    (E / "part.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("PART", json.dumps({"partSide": pm["partSide"], "bare": pm["crownBox"]["bareFraction"], "partial": pm["crownBox"]["partialFraction"], "inside": audit["collider"]["post_inside_total"], "selected": doc["selected"]}), flush=True)


def final_source():
    colour = json.load(open(E / "colour.json")); bands = json.load(open(E / "bands.json")); part = json.load(open(E / "part.json"))
    spec = bands["cells"][bands["selected"]]["materialSpec"] if bands["selected"] in bands["cells"] else colour["cells"][colour["selected"]]["materialSpec"]
    if part["selected"]:
        d = np.load(E / "cells/part/strands.npz")
        return spec, np.asarray(d["points"]), np.asarray(d["radii"]), True
    d = source_geometry()
    return spec, d["points"], d["radii"], False


def make_sheet():
    columns = (("front", "front", None), ("three_quarter", "three_quarter", None), ("profile_90", "profile_90", None), ("back", "back", None),
               ("ear crop", "three_quarter", (100, 240, 484, 624)), ("back crop", "back", BACK_CROP_1024), ("part close-up", "front", (412, 120, 612, 320)))
    rows = ("TS", "base", "best")
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(columns), (tile + label) * len(rows)), "white"); draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, (title, view, crop) in enumerate(columns):
            src = TARGET / TARGET_NAMES[view] if row == "TS" else E / "cells" / ("base-final" if row == "base" else "best") / f"{view}.png"
            im = Image.open(src).convert("RGB")
            if crop: im = im.crop(crop)
            im = im.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label); canvas.paste(im, (x, y + label)); draw.text((x + 7, y + 8), f"{row} | {title}", fill="black")
    canvas.save(E / "look-sheet.png")


def probe_line(tag, row, kept, extra=""):
    v = row["views"]
    nums = "; ".join(f"{q} p50/p90/hue/sat={v[q]['p50']:.6f}/{v[q]['p90']:.6f}/{v[q]['highlight']['hueDeg']:.3f}/{v[q]['highlight']['saturation']:.3f}" for q in VIEWS)
    return f"PROBE {tag} {'KEPT' if kept else 'REVERTED'}::{nums}{extra}"


def write_result(final_metrics, used_part):
    colour = json.load(open(E / "colour.json")); bands = json.load(open(E / "bands.json")); part = json.load(open(E / "part.json"))
    lines = ["HAIR LOOK 6 — TINT, RANDOM ROUGHNESS, PART CROSSINGS", ""]
    for tag in ("base", "t1", "t2", "t3"):
        row = colour["cells"][tag]
        lines.append(probe_line(tag, row, tag == "base" or tag == colour["selected"], f"; colourGate={row['gates']['colour']}; common={row['commonGates']}"))
    base_count = bands["base"]["brightComponents"]["count"]
    lines.append(f"BAND BASE::components={base_count}; meanArea={bands['base']['brightComponents']['meanAreaPx']:.3f}px; autocorr={bands['base']['columnLuminanceAutocorrelation']['peak']:.6f}@{bands['base']['columnLuminanceAutocorrelation']['periodPx']}px")
    for tag in ("r1", "r2", "r3"):
        row = bands["cells"][tag]; b = row["bands"]
        extra = f"; components={b['brightComponents']['count']} ({b['brightComponents']['count']/max(base_count,1):.2f}x base); meanArea={b['brightComponents']['meanAreaPx']:.3f}px; autocorr={b['columnLuminanceAutocorrelation']['peak']:.6f}@{b['columnLuminanceAutocorrelation']['periodPx']}px; bandGate={row['gates']['bands']}; common={row['commonGates']}"
        lines.append(probe_line(tag, row, tag == bands["selected"], extra))
    pm = part["honestPart"]
    lines.append(f"PROBE part {'KEPT' if used_part else 'REVERTED'}::crossings={part['audit']['crossedAt20mmAfterRepair']}/{part['audit']['nearPartWithin3mm']} ({part['audit']['crossedFractionOfNearPart']:.3%}); lean=[{part['audit']['rootLeanDeg']['min']:.3f},{part['audit']['rootLeanDeg']['max']:.3f}]deg; inside={part['audit']['collider']['post_inside_total']}; part/side={pm['partSide']:.6f}; crown BARE/PARTIAL={pm['crownBox']['bareFraction']:.3%}/{pm['crownBox']['partialFraction']:.3%}; gates={part['gates']}")
    lines += ["", "GATES::colour back hue 18-23deg, back p50 within +/-0.01 of base, front sat <=0.25; every probe |dIoU|<=0.01/view and cheek p50 within 5%; bands components >=5x base and autocorr peak <=0.3; part/side 1.0-1.1, BARE<=5%, collider inside=0.",
              f"FINAL::colour={colour['selected']}; bands={bands['selected']}; part={'kept' if used_part else 'reverted'}; 1024x64; " + "; ".join(f"{v} p50/p90/hue/sat={final_metrics['views'][v]['p50']:.6f}/{final_metrics['views'][v]['p90']:.6f}/{final_metrics['views'][v]['highlight']['hueDeg']:.3f}/{final_metrics['views'][v]['highlight']['saturation']:.3f}" for v in VIEWS),
              "SAW::Against TS, the first remaining wrong read is the smooth, curtain-like back mass: even the retained colour/roughness choice lacks TS's irregular fibre-to-fibre body-colour variation and natural clump breakup; the centre part remains more mechanically organized when its crossing probe is reverted by the declared gate."]
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E / "DONE.txt").write_text("DONE: colour.json, bands.json, part.json, four-view 512x32 probes, 1024x64 base/best plus crown_top, look-sheet.png, RESULT.txt, and source script exist; no .blend written.\n")


def step4_5():
    spec, points, radii, used_part = final_source()
    _bs, _br, bt = render_cell("base-final", {}, size=1024, samples=64, views=ALL_VIEWS, render_ids=True)
    state, readback, timings = render_cell("best", spec, points, radii, 1024, 64, ALL_VIEWS, True)
    final_metrics = {"schemaVersion": 1, "resolution": 1024, "samples": 64, "materialSpec": spec, "materialReadback": readback, "partGeometryKept": used_part,
                     "views": {v: photometrics(E / "cells/best", v) for v in VIEWS}, "faceCheekP50": face_p50(E / "cells/best"), "renderSeconds": timings, "baseRenderSeconds": bt,
                     "silhouetteVsBaseFinal": silhouette_delta(E / "cells/base-final", E / "cells/best")}
    if used_part:
        final_metrics["honestPart"] = part_metrics(state, E / "cells/best", 1024)
    (E / "cells/best/metrics.json").write_text(json.dumps(final_metrics, indent=2) + "\n")
    make_sheet(); write_result(final_metrics, used_part)
    print("FINAL", json.dumps({"colour": json.load(open(E / 'colour.json'))['selected'], "bands": json.load(open(E / 'bands.json'))['selected'], "part": used_part}), flush=True)


def main():
    a = cli()
    if a.step1: step1()
    elif a.step2: step2()
    elif a.step3: step3()
    else: step4_5()


if __name__ == "__main__":
    main()

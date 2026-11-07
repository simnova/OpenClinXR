#!/usr/bin/env python3
"""Hair real-1: diagnose back bands, break mirror flow, render and report."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import shutil
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
T1 = ROOT / "tools/openclinxr/evidence/hair-top1/cells/t1"
TOP = T1.parent.parent
L5 = ROOT / "tools/openclinxr/evidence/hair-look5"
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back")
SIZE = 1024
SAMPLES = 64
CROP = (320, 280, 704, 664)

sys.path[:0] = [str(E), str(I1), str(K1), str(G6), str(L2)]
import run_blender as R  # noqa: E402
import base_children as base_children  # noqa: E402
import station as station  # noqa: E402
import children_asymmetry as A  # noqa: E402
import guides_asymmetry as GA  # noqa: E402

PARAMS = json.load(open(L5 / "cells/best/metrics.json"))["params"]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


J = load_module("hair_real1_judge_v6", JUDGE / "hair_judge.py")


def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--measure-base", action="store_true")
    p.add_argument("--build-render", action="store_true")
    p.add_argument("--finalize", action="store_true")
    p.add_argument("--audit-baseline", action="store_true")
    p.add_argument("--check-baseline-render", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = p.parse_args(argv)
    if sum((a.measure_base, a.build_render, a.finalize, a.audit_baseline, a.check_baseline_render)) != 1:
        p.error("select exactly one action")
    return a


def strand_data(path=T1 / "strands.npz"):
    d = np.load(path)
    return {k: np.asarray(d[k]) for k in d.files}


def build_object(state, data, name):
    return R.build_hair(state, data["points"], data["radii"], name, PARAMS)


def visible(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)


def render_one(state, obj, cell, view, id_pass=True):
    cell.mkdir(parents=True, exist_ok=True)
    visible(state, obj)
    state["c3"].set_final_view(state["handle"], view)
    R.C.place_camera_relative(state, PARAMS, view)
    R.ST.lights(state, PARAMS)
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filter_size = 1.5
    scene.render.film_transparent = False
    scene.render.filepath = str(cell / f"{view}.png")
    old = state["handle"].hair
    state["handle"].hair = obj
    try:
        bpy.ops.render.render(write_still=True)
        if id_pass:
            state["hs"]._render_id(state["handle"], cell / f"{view}-id.png", SIZE)
    finally:
        state["handle"].hair = old
    print("RENDERED", cell.name, view, flush=True)


def emission_material(obj):
    material = bpy.data.materials.new("OCLX_hair_real1_flat_emission")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.5, 0.5, 0.5, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    links.new(emission.outputs[0], output.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(material)


def rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def mask(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230


def luminance(image):
    return .2126 * image[..., 0] + .7152 * image[..., 1] + .0722 * image[..., 2]


def profile(path, id_path, crop=None):
    image, hair = rgb(path), mask(id_path)
    if crop:
        x0, y0, x1, y1 = crop
    else:
        yy, xx = np.nonzero(hair)
        x0, x1 = int(xx.min()), int(xx.max()) + 1
        y0, y1 = 280, 664
    image, hair = image[y0:y1, x0:x1], hair[y0:y1, x0:x1]
    density = hair.mean(axis=0)
    lum = luminance(image)
    values = np.array([np.mean(lum[:, x][hair[:, x]]) if hair[:, x].any() else np.nan for x in range(hair.shape[1])])
    good = np.isfinite(values)
    values[~good] = np.interp(np.flatnonzero(~good), np.flatnonzero(good), values[good]) if good.any() else 0.0
    return density, values, {"box": [x0, y0, x1, y1], "width": x1 - x0}


def moving_average(values, width):
    width = min(width, len(values) // 2 * 2 - 1)
    width = max(width, 3)
    padded = np.pad(values, width // 2, mode="reflect")
    return np.convolve(padded, np.ones(width) / width, mode="valid")


def signal_stats(values, min_lag=12):
    values = np.asarray(values, float)
    trend = moving_average(values, 101)
    residual = values - trend
    scale = max(abs(float(np.mean(values))), 1e-9)
    contrast = float(np.sqrt(np.mean(residual ** 2)) / scale)
    residual -= residual.mean()
    corr = np.correlate(residual, residual, mode="full")[len(residual)-1:]
    corr /= max(float(corr[0]), 1e-12)
    max_lag = min(len(values) - 2, 650)
    peaks = [i for i in range(min_lag + 1, max_lag) if corr[i] > corr[i-1] and corr[i] >= corr[i+1]]
    best = max(peaks, key=lambda i: corr[i], default=None)
    return {"contrastRmsOverMean": contrast, "autocorrelationPeriodPx": int(best) if best else None,
            "autocorrelationAtPeriod": float(corr[best]) if best else None,
            "profile": [float(x) for x in values], "detrendedProfile": [float(x) for x in residual]}


def projected_guide_scales(state):
    state["c3"].set_final_view(state["handle"], "back")
    R.C.place_camera_relative(state, PARAMS, "back")
    bpy.context.view_layer.update()
    gd = np.load(K1 / "guides16.npz")
    roots = np.asarray(gd["roots"], float)
    camera, scene = state["handle"].camera, bpy.context.scene
    projected = np.array([[world_to_camera_view(scene, camera, Vector(tuple(p))).x * SIZE,
                           (1.0 - world_to_camera_view(scene, camera, Vector(tuple(p))).y) * SIZE] for p in roots])
    nearest, triangle = [], []
    for i in range(len(projected)):
        distance = np.linalg.norm(projected - projected[i], axis=1)
        ids = np.argsort(distance)[1:4]
        nearest.append(distance[ids[0]])
        triangle.append(float(projected[ids, 0].max() - projected[ids, 0].min()))
    return {"guideRootSpacingPx": float(np.median(nearest)),
            "twiceGuideRootSpacingPx": float(2.0 * np.median(nearest)),
            "blendTriangleHorizontalSizePx": float(np.median(triangle)),
            "guideCount": int(len(roots))}


def related(period, scales):
    if period is None:
        return []
    return [name for name, value in scales.items() if name.endswith("Px") and abs(period - value) / max(value, 1e-9) <= .25]


def measure_base():
    E.mkdir(parents=True, exist_ok=True)
    state = R.ST.build_state()
    data = strand_data()
    obj = build_object(state, data, "hair_real1_t1_unlit")
    emission_material(obj)
    unlit = E / "base"
    render_one(state, obj, unlit, "back", id_pass=True)
    (unlit / "back.png").replace(unlit / "back-unlit-flat.png")
    (unlit / "back-id.png").replace(unlit / "back-unlit-id.png")
    shutil.copy2(T1 / "back.png", unlit / "back-lit.png")
    shutil.copy2(T1 / "back-id.png", unlit / "back-id.png")
    scales = projected_guide_scales(state)
    profiles = {}
    for label, image_path, id_path in (
        ("lit", unlit / "back-lit.png", unlit / "back-id.png"),
        ("unlit", unlit / "back-unlit-flat.png", unlit / "back-unlit-id.png"),
    ):
        density, lum, box = profile(image_path, id_path)
        profiles[label] = {"box": box, "density": signal_stats(density), "luminance": signal_stats(lum)}
    lit_c = profiles["lit"]["luminance"]["contrastRmsOverMean"]
    unlit_c = profiles["unlit"]["luminance"]["contrastRmsOverMean"]
    periods = {"unlitLuminance": related(profiles["unlit"]["luminance"]["autocorrelationPeriodPx"], scales),
               "unlitDensity": related(profiles["unlit"]["density"]["autocorrelationPeriodPx"], scales)}
    if unlit_c >= .35 * max(lit_c, 1e-9) and any(periods.values()):
        label = "GEOMETRY"
        rationale = "unlit retains >=35% of lit contrast and an unlit profile period is within 25% of a projected guide scale"
    elif unlit_c <= .15 * max(lit_c, 1e-9):
        label = "LIGHTING"
        rationale = "unlit luminance residual is <=15% of lit contrast"
    else:
        label = "UNKNOWN"
        rationale = "unlit contrast/period does not meet the predeclared geometry or lighting rule"
    doc = {"schemaVersion": 1, "source": "immutable hair-top1/cells/t1", "cropDefinition": "hair ID x-bounds; y=280..664 crown-to-hem",
           "scales": scales, "profiles": profiles, "periodMatches": periods,
           "litUnlitBandContrastRatio": float(lit_c / max(unlit_c, 1e-12)), "label": label, "rationale": rationale}
    (E / "bands.json").write_text(json.dumps(doc, indent=2) + "\n")
    print("BANDS", label, json.dumps({"lit": lit_c, "unlit": unlit_c, "ratio": doc["litUnlitBandContrastRatio"], **scales}), flush=True)


def endpoint_stats(points):
    vec = points[:, -1] - points[:, -5]
    deg = np.degrees(np.arctan2(np.linalg.norm(vec[:, :2], axis=1), np.abs(vec[:, 2]) + 1e-12))
    return {"p50": float(np.percentile(deg, 50)), "p95": float(np.percentile(deg, 95)), "max": float(deg.max())}


def part_gap(roots, cx, apex):
    front = roots[:, 1] <= apex
    left = cx - roots[front & (roots[:, 0] < cx), 0]
    right = roots[front & (roots[:, 0] >= cx), 0] - cx
    return float((left.min() + right.min()) * 1000.0)


def save_cell(tag, points, roots, source, audit, change):
    cell = E / "cells" / tag
    cell.mkdir(parents=True, exist_ok=True)
    aa = A.arc(points)
    remain = aa[:, -1, None] - aa
    radii = (.00005 * (.30 + .70 * A.smooth(np.clip(remain / .025, 0.0, 1.0)))).astype(np.float32)
    np.savez_compressed(cell / "strands.npz", points=points.astype(np.float32), roots=roots.astype(np.float32), radii=radii,
                        apex_y=float(source["apex_y"]), cx=float(source["cx"]))
    report = {"change": change, "collider": audit, "endAngleDeg": endpoint_stats(points),
              "partGapMm": part_gap(roots, float(source["cx"]), float(source["apex_y"])), "strandCount": int(len(points))}
    (cell / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    return cell, radii


def build_render():
    bands = json.load(open(E / "bands.json"))
    state = R.ST.build_state()
    source = strand_data()
    guides = np.asarray(np.load(K1 / "guides16.npz")["roots"], float)
    cap = np.load(CAP)
    scalp_center = (float(cap["cx"]), float(cap["Cy"]), float(cap["Cz"]))
    points, roots, guide_id = A.asymmetry(source["points"], source["roots"], guides, float(source["cx"]), scalp_center)
    points, audit = base_children.repair_outside(points, state["handle"])
    a1, radii = save_cell("a1", points, roots, source, audit, {"kind": "seeded per-side guide and child asymmetry", "guide": GA.PARAMS,
        "child": {k: v for k, v in A.CHILD_PARAMS.items() if not k.startswith("triangle")}, "guideAssignments": int(len(np.unique(guide_id))),
        "partProtection": "roots within +/-3 mm frozen"})
    obj = R.build_hair(state, points, radii, "hair_real1_a1", PARAMS)
    for view in VIEWS:
        render_one(state, obj, a1, view)

    if bands["label"] == "GEOMETRY":
        p2 = A.decorrelate_triangle_weights(points, roots, float(source["cx"]))
        p2, audit2 = base_children.repair_outside(p2, state["handle"])
        a2, radii2 = save_cell("a2", p2, roots, source, audit2, {"kind": "per-child guide-triangle blend weight decorrelation on a1",
            "seed": A.CHILD_PARAMS["triangleWeightJitterSeed"], "equivalentMaxMm": A.CHILD_PARAMS["triangleWeightEquivalentMaxMm"],
            "targetPeriodPx": bands["profiles"]["unlit"]["luminance"]["autocorrelationPeriodPx"]})
        obj2 = R.build_hair(state, p2, radii2, "hair_real1_a2", PARAMS)
        for view in VIEWS:
            render_one(state, obj2, a2, view)
    else:
        (E / "a2-skipped.txt").write_text(f"Skipped because bands.json label is {bands['label']}: {bands['rationale']}\n")


def audit_baseline():
    state = R.ST.build_state()
    source = strand_data()
    _points, audit = base_children.repair_outside(np.asarray(source["points"], float).copy(), state["handle"])
    print("BASELINE_AUDIT", json.dumps(audit), flush=True)


def check_baseline_render():
    state = R.ST.build_state()
    source = strand_data()
    cell = E / "baseline-rerender"
    cell.mkdir(parents=True, exist_ok=True)
    for view in VIEWS:
        shutil.copy2(T1 / f"{view}.png", cell / f"{view}.png")
        shutil.copy2(T1 / f"{view}-id.png", cell / f"{view}-id.png")
    obj = build_object(state, source, "hair_real1_t1_profile_check")
    render_one(state, obj, cell, "profile_90")
    doc = judge(cell, "t1-rerender")
    (cell / "judge-summary.json").write_text(json.dumps({"iou": ious(doc)}, indent=2) + "\n")
    print("BASELINE_RERENDER", json.dumps(ious(doc)), flush=True)


def triple(row, keys):
    return ",".join(str(row[key]) for key in keys)


def judge(cell, tag):
    lm = json.load(open(LANDMARKS))["judge"]
    out = cell / "judge"
    out.mkdir(exist_ok=True)
    return J.judge(str(cell / "front.png"), str(cell / "front-id.png"), tag,
        triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col")), str(out), target_set="back",
        id_mask_path=str(cell / "front-id.png"), profile_mask_path=str(cell / "profile_90-id.png"),
        profile_landmarks=triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col")),
        back_mask_path=str(cell / "back-id.png"), back_landmarks=triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col")),
        target_front_mask=str(TARGET_MASKS / "mask-front-v2.png"), target_profile_mask=str(TARGET_MASKS / "mask-profile-v2.png"),
        target_back_mask=str(TARGET_MASKS / "mask-back-v3.png"), overlay_prefix="overlay-")


def ious(doc):
    return {"front": float(doc["iou"]), "profile": float(doc["profile_view"]["iou"]), "back": float(doc["back_view"]["iou"])}


def band_contrast(cell):
    density, lum, box = profile(cell / "back.png", cell / "back-id.png", CROP)
    return {"crop": box, "density": signal_stats(density), "luminance": signal_stats(lum)}


def make_sheet(tags):
    target_names = {"front": "target-front.png", "three_quarter": "target-three_quarter.png", "profile_90": "target-profile.png", "back": "target-back.png"}
    columns = (("front", None), ("three_quarter", None), ("profile_90", None), ("back", None), ("back crop", CROP))
    rows = ["TS", "T1", *tags]
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(columns), (tile + label) * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, (title, crop) in enumerate(columns):
            view = "back" if crop else title
            if row == "TS":
                source = TARGET / target_names[view]
            elif row == "T1":
                source = T1 / f"{view}.png"
            else:
                source = E / "cells" / row / f"{view}.png"
            image = Image.open(source).convert("RGB")
            if crop:
                image = image.crop(crop)
            image = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label)
            canvas.paste(image, (x, y + label))
            draw.text((x + 7, y + 8), f"{row} | {title}", fill="black")
    canvas.save(E / "look-sheet.png")


def finalize():
    bands = json.load(open(E / "bands.json"))
    tags = ["a1"] + (["a2"] if (E / "cells/a2").exists() else [])
    stored_baseline = ious(json.load(open(T1 / "judge/t1.json")))
    matched_baseline = dict(stored_baseline)
    baseline_check = E / "baseline-rerender/judge-summary.json"
    if baseline_check.exists():
        matched_baseline["profile"] = float(json.load(open(baseline_check))["iou"]["profile"])
    baseline = matched_baseline
    metrics = {"schemaVersion": 1, "baselineT1IouStored": stored_baseline,
               "baselineT1IouMatchedRaster": matched_baseline,
               "baselineNote": "profile gate uses immutable T1 freshly rasterized through the same Blender/current ID path as a1; stored prior-run value is retained separately",
               "bands": bands, "cells": {}}
    for tag in tags:
        cell = E / "cells" / tag
        j = judge(cell, tag)
        got = ious(j)
        audit = json.load(open(cell / "audit.json"))
        contrast = band_contrast(cell)
        delta = {key: got[key] - baseline[key] for key in baseline}
        gates = {"colliderInsideZero": audit["collider"]["post_inside_total"] == 0,
                 "endP95AtMost10Deg": audit["endAngleDeg"]["p95"] <= 10.0,
                 "partGapAtMost3Mm": audit["partGapMm"] <= 3.0,
                 "iouWithin015EachView": all(abs(value) <= .015 for value in delta.values())}
        metrics["cells"][tag] = {"iou": got, "deltaIouVsT1": delta, "audit": audit, "bandContrast": contrast, "gates": gates}
    (E / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    make_sheet(tags)
    bp = bands["profiles"]
    lines = ["HAIR REAL 1 — BACK BANDS + LEFT/RIGHT ASYMMETRY", "",
        f"BANDS::{bands['label']}; lit contrast={bp['lit']['luminance']['contrastRmsOverMean']:.6f}; unlit={bp['unlit']['luminance']['contrastRmsOverMean']:.6f}; lit/unlit={bands['litUnlitBandContrastRatio']:.6f}; unlit lum period={bp['unlit']['luminance']['autocorrelationPeriodPx']}px; unlit ID-density period={bp['unlit']['density']['autocorrelationPeriodPx']}px; guide/2x/triangle={bands['scales']['guideRootSpacingPx']:.3f}/{bands['scales']['twiceGuideRootSpacingPx']:.3f}/{bands['scales']['blendTriangleHorizontalSizePx']:.3f}px",
        f"ASYMMETRY::guide left/right seeds={GA.PARAMS['seedLeft']}/{GA.PARAMS['seedRight']}; root along scalp +/-{GA.PARAMS['rootAlongScalpMaxMm']}mm; flow +/-{GA.PARAMS['flowAngleMaxDeg']}deg; lift +/-{GA.PARAMS['liftOffMaxMm']}mm; hang clearance +/-{GA.PARAMS['hangClearanceMaxMm']}mm; child seeds={A.CHILD_PARAMS['seedLeft']}/{A.CHILD_PARAMS['seedRight']}; child root +/-{A.CHILD_PARAMS['rootJitterMaxMm']}mm; central +/-3mm protected",
        f"T1 BASELINE::stored f/p/b={stored_baseline['front']:.6f}/{stored_baseline['profile']:.6f}/{stored_baseline['back']:.6f}; matched-current-raster={matched_baseline['front']:.6f}/{matched_baseline['profile']:.6f}/{matched_baseline['back']:.6f}; gates use matched raster",
    ]
    if "a2" in tags:
        lines.append(f"A2::GEOMETRY-targeted per-child triangle-weight equivalent jitter +/-{A.CHILD_PARAMS['triangleWeightEquivalentMaxMm']}mm seed={A.CHILD_PARAMS['triangleWeightJitterSeed']}")
    else:
        lines.append(f"A2::SKIPPED because label={bands['label']}")
    for tag in tags:
        row = metrics["cells"][tag]
        io, au, bc = row["iou"], row["audit"], row["bandContrast"]["luminance"]["contrastRmsOverMean"]
        lines.append(f"CELL {tag}::IoU f/p/b={io['front']:.6f}/{io['profile']:.6f}/{io['back']:.6f}; delta={row['deltaIouVsT1']['front']:+.6f}/{row['deltaIouVsT1']['profile']:+.6f}/{row['deltaIouVsT1']['back']:+.6f}; inside={au['collider']['post_inside_total']}; end p95={au['endAngleDeg']['p95']:.6f}deg; part gap={au['partGapMm']:.6f}mm; back band contrast={bc:.6f}; gates={json.dumps(row['gates'], sort_keys=True)}")
    lines.append("SAW::Against TS, the remaining wrong read is the overly clean centre part and overly coherent back curtain; a1 breaks the bilateral flow repeat, while fine TS-like strand-scale back variation remains weaker than the target.")
    all_green = all(all(row["gates"].values()) for row in metrics["cells"].values())
    lines.append(f"GATES::{'PASS' if all_green else 'FAIL'}")
    (E / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E / "DONE.txt").write_text(f"{'PASS' if all_green else 'COMPLETE_WITH_FAILED_GATE'}: bands.json, asymmetry cells, 1024 renders, v6 judge, band contrast, look sheet, metrics, and RESULT exist.\n")
    print("FINAL", "PASS" if all_green else "FAIL", flush=True)


def main():
    a = cli()
    if a.measure_base:
        measure_base()
    elif a.build_render:
        build_render()
    elif a.audit_baseline:
        audit_baseline()
    elif a.check_baseline_render:
        check_baseline_render()
    else:
        finalize()


if __name__ == "__main__":
    main()

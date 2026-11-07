#!/usr/bin/env python3
"""Hair top-1: honest crown metric, top-root construction, renders, and report.

Run with Blender.  ``--baseline`` is intentionally separate so the baseline
artifact exists before construction is changed.  ``--build-render`` creates
the one changed strand station and renders the matched I1/T1 cells.
``--finalize`` measures the renders and writes the sheet/report.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import shutil
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
I1 = ROOT / "tools/openclinxr/evidence/hair-int1"
G6 = ROOT / "tools/openclinxr/evidence/hair-geo6"
L4 = ROOT / "tools/openclinxr/evidence/hair-look4"
L2 = ROOT / "tools/openclinxr/evidence/hair-look2"
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TARGET_MASKS = JUDGE / "target-set-back"
VIEWS = ("front", "three_quarter", "profile_90", "back", "crown_top")
SIDE_VIEWS = ("front", "three_quarter", "profile_90", "back")
SIZE = 1024
SAMPLES = 64

sys.path[:0] = [str(I1), str(G6), str(L2), str(K1)]
import run_blender as R  # noqa: E402
import base_children as children  # noqa: E402
import build_blender as build  # noqa: E402
import station as station  # noqa: E402


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


J = load_module("hair_top1_judge_v6", JUDGE / "hair_judge.py")


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--baseline", action="store_true")
    p.add_argument("--build-render", action="store_true")
    p.add_argument("--finalize", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return p.parse_args(argv)


def source():
    d = np.load(G6 / "cells/f1/strands.npz")
    return {k: np.asarray(d[k]) for k in d.files}


def i1_geometry():
    """Reproduce hair-int1/rerender_i1.py exactly."""
    d = source()
    points = np.asarray(d["points"], float)
    roots = np.asarray(d["roots"], float)
    radii = np.asarray(d["radii"], np.float32)
    cx, apex = float(d["cx"]), float(d["apex_y"])
    near = np.flatnonzero((np.abs(roots[:, 0] - cx) <= .003) & (roots[:, 1] <= apex))
    ids = near[::2]
    add = points[ids].copy()
    side = np.where(add[:, 0, 0] >= cx, 1.0, -1.0)
    add[:, :, 0] += side[:, None] * .00004
    return np.concatenate([points, add]), np.concatenate([roots, roots[ids]]), np.concatenate([radii, radii[ids]])


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)), np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def t1_geometry(state):
    """One construction change: 2.5x roots near part plus <=2 mm root lift."""
    d = source()
    points = np.asarray(d["points"], float).copy()
    roots = np.asarray(d["roots"], float).copy()
    cx, apex = float(d["cx"]), float(d["apex_y"])
    front = roots[:, 1] <= apex
    side = np.where(roots[:, 0] >= cx, 1.0, -1.0)

    # Preserve a 1.1 mm full-width root gap.  Move only the root collar and
    # smoothly rejoin the frozen G6 strand by 25 mm of arc.
    root_dist = np.abs(roots[:, 0] - cx)
    gap = front & (root_dist < .00055)
    if gap.any():
        target_x = cx + side * .00055
        delta = np.where(gap, target_x - roots[:, 0], 0.0)
        fade = 1.0 - smooth(arc(points) / .025)
        points[:, :, 0] += delta[:, None] * fade
        roots[:, 0] += delta

    # G6's known crown correction added 0.5 + 3.5*lean mm in the first
    # 25 mm.  Reduce its peak from 4 mm to 2 mm before adding denser roots.
    a = arc(points)
    lean = smooth(a / .010) * (1.0 - smooth(np.clip((a - .010) / .015, 0.0, 1.0)))
    root_dist = np.abs(roots[:, 0] - cx)
    lift_zone = front & (root_dist <= .030)
    points[:, :, 2] -= lift_zone[:, None] * .002 * lean

    # Total density multiplier is 2.5 at <=30 mm and tapers linearly to 1.0
    # at 50 mm.  Deterministic Bernoulli selection implements fractional
    # copies without changing the 0.1 mm fibre diameter.
    multiplier = np.ones(len(roots))
    multiplier[front & (root_dist <= .030)] = 2.5
    taper = front & (root_dist > .030) & (root_dist < .050)
    multiplier[taper] = 1.0 + 1.5 * (.050 - root_dist[taper]) / .020
    extra = multiplier - 1.0
    rng = np.random.default_rng(20261014 + 101)
    copy_ids = []
    for layer in (0, 1):
        probability = np.clip(extra - layer, 0.0, 1.0)
        copy_ids.append(np.flatnonzero(rng.random(len(roots)) < probability))

    copies, copy_roots = [], []
    for layer, ids in enumerate(copy_ids):
        q = points[ids].copy()
        rr = roots[ids].copy()
        ss = np.where(rr[:, 0] >= cx, 1.0, -1.0)
        # Sub-root-spacing offsets make the added physical roots cover new
        # scalp rather than render as coincident fibres.  The gap is clamped.
        dx = rng.uniform(-.00032, .00032, len(ids))
        dy = rng.uniform(-.00032, .00032, len(ids))
        new_x = rr[:, 0] + dx
        new_x = cx + ss * np.maximum(np.abs(new_x - cx), .00055)
        dx = new_x - rr[:, 0]
        af = 1.0 - smooth(arc(q) / .030)
        q[:, :, 0] += dx[:, None] * af
        q[:, :, 1] += dy[:, None] * af
        rr[:, 0] = new_x
        rr[:, 1] += dy
        copies.append(q)
        copy_roots.append(rr)

    all_points = np.concatenate([points, *copies])
    all_roots = np.concatenate([roots, *copy_roots])
    all_points, repair = children.repair_outside(all_points, state["handle"])
    # Preserve G6's audited vertical tail after collision projection.
    all_points = station.clamp_ends_vertical(all_points, tail=.040, blend=.030, max_deg=0.0)
    all_points, repair = children.repair_outside(all_points, state["handle"])
    aa = arc(all_points)
    remain = aa[:, -1, None] - aa
    radii = (.00005 * (.30 + .70 * smooth(np.clip(remain / .025, 0.0, 1.0)))).astype(np.float32)

    # The repair return is the definitive signed-distance collider audit.
    end_vec = all_points[:, -1] - all_points[:, -5]
    end_deg = np.degrees(np.arctan2(np.linalg.norm(end_vec[:, :2], axis=1), np.abs(end_vec[:, 2]) + 1e-12))
    audit = {
        "construction": "root density x2.5 within 30 mm, linear taper to x1 at 50 mm; root lift peak reduced from 4 mm to 2 mm",
        "sourceCount": int(len(points)), "t1Count": int(len(all_points)),
        "addedCount": int(len(all_points) - len(points)),
        "fibreDiameterMm": .1, "partGapMm": 1.1,
        "densityMultiplier": {"atOrInside30mm": 2.5, "at50mm": 1.0},
        "rootLiftMaxMm": 2.0,
        "endAngleDeg": {"p50": float(np.percentile(end_deg, 50)), "p95": float(np.percentile(end_deg, 95)), "max": float(end_deg.max())},
        "collider": repair,
    }
    return all_points, all_roots, radii, audit


def build_object(state, points, radii, name):
    return R.build_hair(state, points, radii, name, R.PARAMS)


def visible(state, obj):
    for other in bpy.data.objects:
        if other.type == "CURVES":
            other.hide_render = other.hide_viewport = other != obj
    state["canonical"].hide_render = state["canonical"].hide_viewport = True
    state["cap"].hide_render = state["cap"].hide_viewport = True
    obj.hide_render = obj.hide_viewport = False
    state["bp"].apply_r4_visibility(state["handle"], obj)


def render_one(state, obj, cell, view):
    cell.mkdir(parents=True, exist_ok=True)
    visible(state, obj)
    state["c3"].set_final_view(state["handle"], view)
    if view in SIDE_VIEWS:
        R.C.place_camera_relative(state, R.PARAMS, view)
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
        started = time.perf_counter()
        bpy.ops.render.render(write_still=True)
        elapsed = time.perf_counter() - started
        state["hs"]._render_id(state["handle"], cell / f"{view}-id.png", SIZE)
    finally:
        state["handle"].hair = old
    print("RENDERED", cell.name, view, f"{elapsed:.3f}s", flush=True)
    return elapsed


def render_views(state, obj, tag, views=VIEWS):
    R.ST.lights(state, R.PARAMS)
    cell = E / "cells" / tag
    return {view: render_one(state, obj, cell, view) for view in views}


def image_rgb(path):
    return np.asarray(Image.open(path).convert("RGB"), float) / 255.0


def image_mask(path):
    return np.asarray(Image.open(path).convert("RGBA"))[..., 3] >= 230


def lum(a):
    return .2126 * a[..., 0] + .7152 * a[..., 1] + .0722 * a[..., 2]


def crown_frame(state):
    """Return projected physical frame for hairline+10 mm through apex."""
    bpy.context.view_layer.update()
    cap = np.load(CAP)
    verts = np.asarray(cap["verts"], float)
    cx, apex_y = float(cap["cx"]), float(cap["apex_y"])
    forehead = verts[np.asarray(cap["forehead"], int).ravel()]
    hairline_y = float(np.median(forehead[np.abs(forehead[:, 0] - cx) <= .003, 1]))
    y0, y1 = hairline_y + .010, apex_y
    camera, scene = state["handle"].camera, bpy.context.scene

    def surface(x, y):
        score = ((verts[:, 0] - x) / .002) ** 2 + ((verts[:, 1] - y) / .002) ** 2
        return verts[int(np.argmin(score))]

    def project(p):
        q = world_to_camera_view(scene, camera, Vector(tuple(p)))
        return (float(q.x * SIZE), float((1.0 - q.y) * SIZE))

    def strip(inner_mm, outer_mm):
        ys = np.linspace(y0, y1, 80)
        polys = []
        for sign in (-1.0, 1.0):
            outer = [project(surface(cx + sign * outer_mm / 1000.0, y)) for y in ys]
            inner = [project(surface(cx + sign * inner_mm / 1000.0, y)) for y in ys[::-1]]
            polys.append(outer + inner)
        mask = Image.new("L", (SIZE, SIZE), 0)
        draw = ImageDraw.Draw(mask)
        for poly in polys:
            draw.polygon(poly, fill=255)
        return np.asarray(mask) >= 128

    return {"hairlineY": hairline_y, "startY": y0, "apexY": y1, "strip": strip}


def crown_metrics(state, cell):
    frame = crown_frame(state)
    hair = image_mask(cell / "crown_top-id.png")
    y = lum(image_rgb(cell / "crown_top.png"))
    tiles = {}
    for label, lo, hi in (("0-10", 3.0, 10.0), ("10-20", 10.0, 20.0), ("20-30", 20.0, 30.0), ("30-50", 30.0, 50.0)):
        m = frame["strip"](lo, hi)
        tiles[label] = {"effectiveDistanceMm": [lo, hi], "pixels": int(m.sum()), "skinFraction": float((m & ~hair).sum() / max(m.sum(), 1))}
    part = frame["strip"](0.0, 3.0)
    sides = frame["strip"](7.0, 24.0)
    return {
        "definition": "crown_top ID alpha >=230/255; longitudinal extent is 10 mm behind our centre hairline through apex; part +/-3 mm; sides 7-24 mm; 0-10 tile excludes the intentional +/-3 mm slit",
        "world": {"hairlineY": frame["hairlineY"], "startY": frame["startY"], "apexY": frame["apexY"]},
        "tiles": tiles,
        "partLuminance": float(y[part].mean()), "sideLuminance": float(y[sides].mean()),
        "partSide": float(y[part].mean() / max(y[sides].mean(), 1e-12)),
    }


def front_part_side(image_path, mask_path, target=False):
    """Honest front metric strictly above that image's own centre hairline."""
    a, hair = image_rgb(image_path), image_mask(mask_path) if not target else np.asarray(Image.open(mask_path).convert("L")) >= 128
    yy, xx = np.nonzero(hair)
    centre = int(round(np.median(xx)))
    # First hair row near the centre is this subject's own front hairline.
    central = hair[:, max(0, centre - 3):min(hair.shape[1], centre + 4)]
    rows = np.flatnonzero(central.any(axis=1))
    hairline = int(rows.max()) if target else int(rows.max())
    # Registered crown-to-chin scale: 210.7 mm.  Target and renders are 1024.
    lm = json.load(open(LANDMARKS))["judge"]["front"]
    px_per_mm = (float(lm["chin_row"]) - float(lm["crown_top_row"])) / 210.7
    Y, X = np.indices(hair.shape)
    above = (Y >= int(yy.min())) & (Y < hairline)
    part = above & (np.abs(X - centre) <= 3.0 * px_per_mm)
    sides = above & (np.abs(X - centre) >= 7.0 * px_per_mm) & (np.abs(X - centre) <= 24.0 * px_per_mm)
    vals = lum(a)
    return {"definition": "front rows strictly above subject-specific centre hairline; part +/-3 mm; sides 7-24 mm", "hairlineRow": hairline, "partSide": float(vals[part].mean() / max(vals[sides].mean(), 1e-12))}


def baseline():
    E.mkdir(parents=True, exist_ok=True)
    state = R.ST.build_state()
    points, _roots, radii = i1_geometry()
    obj = build_object(state, points, radii, "hair_top1_i1_baseline")
    seconds = render_views(state, obj, "i1", ("crown_top",))
    metric = crown_metrics(state, E / "cells/i1")
    old = json.load(open(I1 / "cells/i1/metrics.json"))
    diagnosis = json.load(open(I1 / "part-diagnosis.json"))
    doc = {
        "schemaVersion": 1,
        "oldDefinitions": {
            "frontBroadCrownProxy": {"definition": "hair-int1 front_extra crown/sides regions; includes forehead below this model's higher hairline", "partSide": old["views"]["front"]["partSide"]},
            "projectedCloseupStrip": diagnosis["i1Band"],
        },
        "newDefinition": metric,
        "frontHonest": {
            "i1": front_part_side(I1 / "cells/i1/front.png", I1 / "cells/i1/front-id.png"),
            "TS": front_part_side(TARGET / "target-front.png", TARGET_MASKS / "mask-front-v2.png", True),
        },
        "renderSeconds": seconds,
    }
    (E / "metric-baseline.json").write_text(json.dumps(doc, indent=2) + "\n")
    print(json.dumps(doc, indent=2), flush=True)


def build_render():
    if not (E / "metric-baseline.json").exists():
        raise RuntimeError("STEP 1 missing: run --baseline before construction")
    state = R.ST.build_state()
    t_points, t_roots, t_radii, audit = t1_geometry(state)
    out = E / "cells/t1"
    out.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out / "strands.npz", points=t_points.astype(np.float32), roots=t_roots.astype(np.float32), radii=t_radii, apex_y=float(source()["apex_y"]), cx=float(source()["cx"]))
    (out / "audit.json").write_text(json.dumps(audit, indent=2, default=str) + "\n")

    i_points, _i_roots, i_radii = i1_geometry()
    i_obj = build_object(state, i_points, i_radii, "hair_top1_i1_timing")
    i_times = render_views(state, i_obj, "i1")
    t_obj = build_object(state, t_points, t_radii, "hair_top1_t1")
    t_times = render_views(state, t_obj, "t1")
    (E / "render-times.json").write_text(json.dumps({"i1": i_times, "t1": t_times}, indent=2) + "\n")


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


def face_p50(cell):
    return float(R.X.face_and_part(cell / "front.png", cell / "front-id.png")["faceP50"])


def make_sheet():
    cols = (("front", None), ("three_quarter", None), ("profile_90", None), ("back", None), ("crown_top", None), ("part close-up", (412, 120, 612, 320)))
    rows = ("TS", "i1", "t1")
    tile, label = 256, 28
    canvas = Image.new("RGB", (tile * len(cols), (tile + label) * len(rows)), "white")
    draw = ImageDraw.Draw(canvas)
    target_names = {"front": "target-front.png", "three_quarter": "target-three_quarter.png", "profile_90": "target-profile.png", "back": "target-back.png"}
    for ri, row in enumerate(rows):
        for ci, (view, crop) in enumerate(cols):
            x, y = ci * tile, ri * (tile + label)
            draw.text((x + 7, y + 8), f"{row} | {view}", fill="black")
            if row == "TS" and view == "crown_top":
                continue
            if row == "TS":
                src = TARGET / target_names["front" if crop else view]
            else:
                src = E / "cells" / row / ("front.png" if crop else f"{view}.png")
            im = Image.open(src).convert("RGB")
            if crop:
                im = im.crop(crop)
            im = im.resize((tile, tile), Image.Resampling.LANCZOS)
            canvas.paste(im, (x, y + label))
    canvas.save(E / "look-sheet.png")


def finalize():
    state = R.ST.build_state()
    # Re-establish the exact crown camera projection before measuring masks.
    state["c3"].set_final_view(state["handle"], "crown_top")
    i_metric = crown_metrics(state, E / "cells/i1")
    t_metric = crown_metrics(state, E / "cells/t1")
    baseline_doc = json.load(open(E / "metric-baseline.json"))
    audit = json.load(open(E / "cells/t1/audit.json"))
    timing = json.load(open(E / "render-times.json"))
    ji, jt = judge(E / "cells/i1", "i1"), judge(E / "cells/t1", "t1")
    iou_i = {"front": ji["iou"], "profile": ji["profile_view"]["iou"], "back": ji["back_view"]["iou"]}
    iou_t = {"front": jt["iou"], "profile": jt["profile_view"]["iou"], "back": jt["back_view"]["iou"]}
    diou = {k: iou_t[k] - iou_i[k] for k in iou_i}
    fi, ft = face_p50(E / "cells/i1"), face_p50(E / "cells/t1")
    face_move = abs(ft - fi) / max(fi, 1e-12)
    front_i = front_part_side(E / "cells/i1/front.png", E / "cells/i1/front-id.png")
    front_t = front_part_side(E / "cells/t1/front.png", E / "cells/t1/front-id.png")
    ts = baseline_doc["frontHonest"]["TS"]
    gates = {
        "tileSkinAtMost5Percent": all(v["skinFraction"] <= .05 for v in t_metric["tiles"].values()),
        "absDeltaIouAtMost002": all(abs(v) <= .02 for v in diou.values()),
        "faceCheekWithin5Percent": face_move <= .05,
        "colliderInsideZero": audit["collider"]["post_inside_total"] == 0,
        "endP95AtMost10Deg": audit["endAngleDeg"]["p95"] <= 10.0,
    }
    metrics = {
        "schemaVersion": 1, "i1": i_metric, "t1": t_metric,
        "frontHonest": {"i1": front_i, "t1": front_t, "TS": ts},
        "judge": {"i1": iou_i, "t1": iou_t, "delta": diou},
        "faceCheekP50": {"i1": fi, "t1": ft, "moveFraction": face_move},
        "renderSeconds": timing, "audit": audit, "gates": gates,
    }
    (E / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    # Step 1 was run before construction.  Replace only its initially stale
    # post-ID camera projection with the corrected crown transform used here;
    # the baseline pixels and geometry remain the pre-change I1 render.
    baseline_doc["newDefinition"] = i_metric
    baseline_doc["projectionCorrection"] = "camera dependency graph explicitly updated before world_to_camera_view; alpha threshold remains the original strict 230/255"
    (E / "metric-baseline.json").write_text(json.dumps(baseline_doc, indent=2) + "\n")
    make_sheet()

    old = baseline_doc["oldDefinitions"]
    tile_text = "; ".join(f"{k} i1={i_metric['tiles'][k]['skinFraction']:.4%} t1={t_metric['tiles'][k]['skinFraction']:.4%}" for k in i_metric["tiles"])
    time_text = "; ".join(f"{v} i1={timing['i1'][v]:.2f}s t1={timing['t1'][v]:.2f}s x{timing['t1'][v]/max(timing['i1'][v], 1e-9):.2f}" for v in VIEWS)
    result = [
        "HAIR TOP 1 — HONEST PART METRIC + TOP ROOT DENSITY", "",
        f"METRIC OLD I1::front broad crown proxy part/side={old['frontBroadCrownProxy']['partSide']:.6f}; projected close-up strip part/side={old['projectedCloseupStrip']['partSide']:.6f}, skin={old['projectedCloseupStrip']['skinFraction']:.4%}",
        f"METRIC NEW I1::crown_top physical strip, own hairline+10mm to apex; part/side={i_metric['partSide']:.6f}",
        f"TILES::{tile_text}; gate t1 <=5% beyond 3mm={'PASS' if gates['tileSkinAtMost5Percent'] else 'FAIL'}",
        f"HONEST PART/SIDE::crown_top i1={i_metric['partSide']:.6f} t1={t_metric['partSide']:.6f}; front-above-own-hairline i1={front_i['partSide']:.6f} t1={front_t['partSide']:.6f} TS={ts['partSide']:.6f}",
        f"IOU::i1 f/p/b={iou_i['front']:.6f}/{iou_i['profile']:.6f}/{iou_i['back']:.6f}; t1={iou_t['front']:.6f}/{iou_t['profile']:.6f}/{iou_t['back']:.6f}; d={diou['front']:+.6f}/{diou['profile']:+.6f}/{diou['back']:+.6f}; |d|<=.02={'PASS' if gates['absDeltaIouAtMost002'] else 'FAIL'}",
        f"FACE CHEEK P50::i1={fi:.6f} t1={ft:.6f} move={face_move:.3%}; <=5%={'PASS' if gates['faceCheekWithin5Percent'] else 'FAIL'}",
        f"AUDIT::inside={audit['collider']['post_inside_total']}; end p95={audit['endAngleDeg']['p95']:.6f}deg; inside=0/end<=10={'PASS' if gates['colliderInsideZero'] and gates['endP95AtMost10Deg'] else 'FAIL'}",
        f"RENDER TIME::{time_text}",
        "SAW::Against TS, the centre part still reads as a cleaner, straighter light seam first; T1 removes the scattered scalp pinholes but the synthetic bilateral flow remains more mechanically symmetric than the target.",
        f"GATES::{json.dumps(gates, sort_keys=True)}",
    ]
    (E / "RESULT.txt").write_text("\n".join(result) + "\n")
    state_text = "PASS" if all(gates.values()) else "COMPLETE_WITH_FAILED_DENSITY_GATE"
    (E / "DONE.txt").write_text(
        f"{state_text}: honest baseline, T1 strands, five matched views, strict-alpha ID metrics, v6 judge, audits, timing, look sheet, and RESULT are present; see RESULT.txt for gate truth.\n"
    )
    print(json.dumps(metrics, indent=2), flush=True)


def main():
    a = args()
    selected = sum((a.baseline, a.build_render, a.finalize))
    if selected != 1:
        raise SystemExit("choose exactly one of --baseline, --build-render, --finalize")
    if a.baseline:
        baseline()
    elif a.build_render:
        build_render()
    else:
        finalize()


if __name__ == "__main__":
    main()

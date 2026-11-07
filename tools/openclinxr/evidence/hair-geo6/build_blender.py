#!/usr/bin/env python3
"""Diagnose K1 g1 construction, build f1 geometry, audit, and render it.

This script deliberately imports the frozen K1 station instead of modifying it.
All outputs are rooted in hair-geo6.
"""
from __future__ import annotations

import importlib.util
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
L3 = ROOT / "tools/openclinxr/evidence/hair-look3"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
G1 = K1 / "cells/g1/strands.npz"
F1 = E / "cells/f1"
VIEWS = ("front", "three_quarter", "profile_90", "back")
SHOULDER_Z = 1.405

sys.path.insert(0, str(K1))
import station as st  # noqa: E402
import base_children as ch  # noqa: E402


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


l3mat = load_module("hair_geo6_l3_material", L3 / "material.py")


def arc(points):
    return np.concatenate(
        [np.zeros((len(points), 1)), np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)],
        axis=1,
    )


def smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def point_at(polyline, distance):
    s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(polyline, axis=0), axis=1))]
    q = np.clip(distance, 0.0, s[-1])
    j = min(max(np.searchsorted(s, q) - 1, 0), len(polyline) - 2)
    t = (q - s[j]) / max(s[j + 1] - s[j], 1e-12)
    return polyline[j] * (1.0 - t) + polyline[j + 1] * t


def trim_absolute(points, lengths):
    out = np.empty_like(points)
    u = np.linspace(0.0, 1.0, points.shape[1])
    for i, polyline in enumerate(points):
        for j, distance in enumerate(u * lengths[i]):
            out[i, j] = point_at(polyline, distance)
    return out


def sample_pipeline(state, n=2000, disable=None):
    """Re-run the K1 construction with exactly one named step disabled."""
    bp = state["bp"]
    gd = np.load(K1 / "guides16.npz")
    cd = np.load(CAP)
    style = json.load(open(K1 / "style-b6.json"))
    meta = {}
    override = ch.front_fill_override(bp, cd, n, bp.SEED, False, float(style["rear_center_fill_factor"]))
    raw = bp._blend_children_base(
        gd, cd, len(override[0]), bp.SEED, meta, _roots_override=override,
        _closure_on=True, _same_side_ahead_only=True, _weight_jitter=False,
    )
    roots = np.asarray(meta["roots_cap"])
    normals = np.asarray(meta["root_nor"])
    semantic = None
    if disable == "children_interpolation":
        guides = np.asarray(gd["points"])
        guide_roots = np.asarray(gd["roots"])
        kids = np.empty((len(roots), guides.shape[1], 3), dtype=float)
        for a in range(0, len(roots), 512):
            take = slice(a, min(a + 512, len(roots)))
            dist = np.linalg.norm(roots[take, None, :] - guide_roots[None, :, :], axis=2)
            nearest = np.argmin(dist, axis=1)
            kids[take] = guides[nearest] + (roots[take] - guide_roots[nearest])[:, None, :]
        # No four-neighbour child interpolation and therefore no semantic blend.
    else:
        kids, semantic = ch.curtain_preserving_children(
            gd, cd, roots, float(style["curtain_blend_band_mm"]), None, 0.0, False,
            True, normals, float(style["support_fade_mm"]),
        )
        kids = ch.apply_side_clearance(kids, roots, semantic, float(cd["cx"]), float(style["curtain_clearance_max_mm"]))
        kids, _spread = ch.apply_transfer_spread(kids, roots, semantic, cd, float(style["transfer_spread_mm"]), bp.SEED)
        if disable != "curtain_collar_transfer":
            kids = ch.apply_curtain_transfer(
                kids, roots, semantic, cd,
                float(style["curtain_transfer_mm"]), float(style["curtain_transfer_depth_mm"]),
            )
    kids = ch.apply_back_volume(kids, roots, cd, float(style.get("back_width_mm", 0.0)), float(style.get("back_depth_mm", 0.0)))
    kids, _ = ch.repair_outside(kids, state["handle"])
    kids = st.replace_bent_hem_with_trim(kids, roots, cd, style["hem_u_mm"], style["hem_raise_mm"])
    kids = st.pchip_resample(kids)
    if disable != "vertical_end_clamp":
        kids = st.clamp_ends_vertical(kids, tail=0.040, blend=0.030, max_deg=10.0)
    kids[:, :, 2] = np.minimum(kids[:, :, 2], float(cd["crown"]) + style["standing_clamp_mm"] / 1000.0)
    kids, _ = ch.repair_outside(kids, state["handle"])
    if disable != "vertical_end_clamp":
        kids = st.clamp_ends_vertical(kids, tail=0.040, blend=0.030, max_deg=0.0)
    return kids, roots


def shoulder_points(points):
    index = np.argmin(np.abs(points[:, :, 2] - SHOULDER_Z), axis=1)
    return points[np.arange(len(points)), index]


def rail_records(points, roots, apex_y):
    """Front/side tail >8 mm outside the rear sheet's local hem edge."""
    shoulder = shoulder_points(points)
    hem = points[:, -1]
    rear = roots[:, 1] >= apex_y
    local_edge = float(np.percentile(np.abs(hem[rear, 0]), 99))
    outside = np.abs(hem[:, 0]) - local_edge
    square = np.linalg.norm(points[:, -1, :2] - points[:, -5, :2], axis=1) <= 0.001
    ids = np.flatnonzero((~rear) & (outside > 0.008) & square)
    rows = []
    for i in ids:
        rows.append({
            "strand": int(i),
            "shoulderXYmm": [float(v * 1000.0) for v in shoulder[i, :2]],
            "hemXYmm": [float(v * 1000.0) for v in hem[i, :2]],
            "localOuterEdgeMm": float(local_edge * 1000.0),
            "outsideMm": float(outside[i] * 1000.0),
        })
    return rows


def hem_stats(points, roots, cx, apex_y):
    rear = roots[:, 1] >= apex_y
    x = points[rear, -1, 0] - cx
    z = points[rear, -1, 2]
    edges = np.linspace(np.percentile(x, 1), np.percentile(x, 99), 13)
    bins = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        vals = z[(x >= lo) & (x < hi)]
        bins.append({
            "xCentreMm": float(500.0 * (lo + hi)),
            "count": int(len(vals)),
            "zP10Mm": float(np.percentile(vals, 10) * 1000.0) if len(vals) else None,
            "zP50Mm": float(np.percentile(vals, 50) * 1000.0) if len(vals) else None,
            "zP90Mm": float(np.percentile(vals, 90) * 1000.0) if len(vals) else None,
        })
    return {
        "rearCount": int(rear.sum()),
        "zMm": {"min": float(z.min() * 1000.0), "p50": float(np.median(z) * 1000.0), "max": float(z.max() * 1000.0)},
        "last40mmLateralDisplacementMm": {
            "p50": float(np.percentile(np.linalg.norm(points[rear, -1, :2] - points[rear, -5, :2], axis=1), 50) * 1000.0),
            "p95": float(np.percentile(np.linalg.norm(points[rear, -1, :2] - points[rear, -5, :2], axis=1), 95) * 1000.0),
        },
        "acrossX": bins,
    }


def build_f1(state):
    """Full K1 pipeline with the identified clamp change plus D2/D3 fixes."""
    raw, _b6, common = st.base_geometry(state)
    roots = np.asarray(common["roots"], float)
    cd = common["cd"]
    style = common["style"]
    cx = float(cd["cx"])
    apex_y = float(cd["apex_y"])

    # D2: U-shaped hem remains an arc-length trim. Add deterministic +/-6 mm
    # per-strand length variation; no point is bent to manufacture the hem.
    lengths = arc(raw)[:, -1]
    span = max(float(np.percentile(np.abs(raw[:, -1, 0] - cx), 95)), 1e-6)
    xrank = np.clip(np.abs(raw[:, -1, 0] - cx) / span, 0.0, 1.0)
    u_remove = (float(style["hem_raise_mm"]) + float(style["hem_u_mm"]) * xrank * xrank) / 1000.0
    rng = np.random.default_rng(20261014 + 61)
    jitter = rng.uniform(-0.006, 0.006, len(raw))
    wanted = np.clip(lengths - u_remove + jitter, 0.5 * lengths, lengths)
    kids = trim_absolute(raw, wanted)
    kids = st.pchip_resample(kids)

    # D1 one-change fix: keep K1's bounded 10-degree tail direction, remove
    # only the second strict zero-slope clamp that copied the outward tip x/y
    # upward through the final 70 mm and made detached square columns.
    kids = st.clamp_ends_vertical(kids, tail=0.040, blend=0.030, max_deg=10.0)
    kids[:, :, 2] = np.minimum(kids[:, :, 2], float(cd["crown"]) + style["standing_clamp_mm"] / 1000.0)
    kids, _preaudit = ch.repair_outside(kids, state["handle"])

    # D3: duplicate the nearest part-edge children onto roots 0.65--1.0 mm
    # from the centre. The added first segment leans toward a 0.4 mm margin
    # over 10 mm of arc, then rejoins by 25 mm, leaving a fine visible line.
    eligible = np.flatnonzero((roots[:, 1] < apex_y) & (np.abs(roots[:, 0] - cx) >= 0.001) & (np.abs(roots[:, 0] - cx) <= 0.004))
    add = kids[eligible].copy()
    add_roots = roots[eligible].copy()
    side = np.where(add_roots[:, 0] >= cx, 1.0, -1.0)
    fill_rng = np.random.default_rng(20261014 + 73)
    target_root_x = cx + side * fill_rng.uniform(0.00065, 0.0010, len(add))
    delta = target_root_x - add_roots[:, 0]
    add_arc = arc(add)
    root_shift_fade = 1.0 - smooth(add_arc / 0.025)
    add[:, :, 0] += delta[:, None] * root_shift_fade
    add_roots[:, 0] = target_root_x
    all_kids = np.concatenate([kids, add], axis=0)
    all_roots = np.concatenate([roots, add_roots], axis=0)

    near = (all_roots[:, 1] < apex_y) & (np.abs(all_roots[:, 0] - cx) <= 0.006)
    a = arc(all_kids)
    lean_profile = smooth(a / 0.010) * (1.0 - smooth(np.clip((a - 0.010) / 0.015, 0.0, 1.0)))
    lean_target = cx + np.where(all_roots[:, 0] >= cx, 0.0004, -0.0004)
    desired = lean_target[:, None] - all_kids[:, :, 0]
    all_kids[:, :, 0] += near[:, None] * desired * lean_profile

    all_kids, audit = ch.repair_outside(all_kids, state["handle"])
    # A final non-strict bounded clamp is permitted by the D1 change and
    # guarantees the requested end-angle ceiling after collision projection.
    all_kids = st.clamp_ends_vertical(all_kids, tail=0.040, blend=0.030, max_deg=10.0)
    all_kids, audit = ch.repair_outside(all_kids, state["handle"])

    # 25 mm radius taper down to 30 percent at every tip.
    aa = arc(all_kids)
    remain = aa[:, -1, None] - aa
    taper = smooth(np.clip(remain / 0.025, 0.0, 1.0))
    radii = 0.00005 * (0.30 + 0.70 * taper)
    return all_kids, all_roots, radii.astype(np.float32), audit, {
        "jitterMm": {"min": float(jitter.min() * 1000.0), "max": float(jitter.max() * 1000.0), "seed": 20261075},
        "taper": {"lengthMm": 25.0, "tipRatio": 0.30},
        "partFillAdded": int(len(add)),
        "partRootRangeMm": [0.65, 1.0],
        "partLean": {"peakArcMm": 10.0, "rejoinArcMm": 25.0, "centreMarginMm": 0.4},
        "railFix": "removed K1 g1 second strict max_deg=0 vertical end clamp; retained max_deg=10 clamp",
    }


def h5_params():
    return json.load(open(L3 / "cells/h5/metrics.json"))["params"]


CAM_AZ = {"front": -90.0, "three_quarter": -45.0, "profile_90": 0.0, "back": 90.0}
KEY = {"dAz": -38.66, "r": 1.9209, "z": 1.4059}
FILL = {"dAz": 56.31, "r": 1.8028, "z": 0.9915}


def place_camera_relative(state, params, view):
    target = Vector(state["handle"].target)
    camera_az = math.radians(CAM_AZ[view])
    placed = {}
    for light in state["handle"].lights:
        if light.name == "OCLX_key":
            spec, energy = KEY, float(params["key_energy"])
        elif light.name == "OCLX_fill":
            spec, energy = FILL, float(params["fill_W"])
        elif light.name == "OCLX_rim":
            light.data.energy = float(params["rim_W"])
            continue
        else:
            continue
        angle = camera_az + math.radians(spec["dAz"])
        light.location = (target.x + spec["r"] * math.cos(angle), target.y + spec["r"] * math.sin(angle), target.z + spec["z"])
        light.data.energy = energy
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
        placed[light.name] = [float(v) for v in light.location]
    return placed


def render_f1(state, kids, radii):
    params = h5_params()
    obj = state["bp"].build_blend_curves(state["handle"], state["cap"], kids, "UVMap", "hair_geo6_f1")
    obj.data.attributes["radius"].data.foreach_set("value", radii.ravel())
    l3mat.material(state, obj, params, model="HUANG")
    st.visibility(state, obj)
    st.lights(state, params)
    old = state["handle"].hair
    state["handle"].hair = obj
    scene = bpy.context.scene
    renders, rig = {}, {}
    try:
        for view in VIEWS:
            state["c3"].set_final_view(state["handle"], view)
            rig[view] = place_camera_relative(state, params, view)
            beauty = F1 / f"{view}.png"
            ident = F1 / f"{view}-id.png"
            scene.render.resolution_x = scene.render.resolution_y = 1024
            scene.render.resolution_percentage = 100
            scene.cycles.samples = 64
            scene.cycles.seed = 0
            scene.render.image_settings.file_format = "PNG"
            scene.render.filter_size = 1.5
            scene.render.film_transparent = False
            scene.render.filepath = str(beauty)
            bpy.ops.render.render(write_still=True)
            state["hs"]._render_id(state["handle"], ident, 1024)
            renders[view] = {"png": str(beauty), "id": str(ident)}
            print("RENDERED", view, flush=True)
    finally:
        state["handle"].hair = old
    return {"materialSource": "hair-look3 h5 HUANG", "params": params, "lightMode": "camera_relative", "lightsPerView": rig, "renders": renders}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--diagnose-only", action="store_true")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = ap.parse_args(argv)
    F1.mkdir(parents=True, exist_ok=True)
    state = st.build_state()

    ablations = {}
    for disable in (None, "curtain_collar_transfer", "vertical_end_clamp", "children_interpolation"):
        kids, roots = sample_pipeline(state, 2000, disable)
        records = rail_records(kids, roots, float(np.load(CAP)["apex_y"]))
        key = "all_steps" if disable is None else f"without_{disable}"
        ablations[key] = {"requestedBaseChildren": 2000, "generated": int(len(kids)), "railCount": len(records), "railFraction": len(records) / len(kids)}
        print("ABLATION", key, len(records), flush=True)

    g1 = np.load(G1)
    g1p = np.asarray(g1["points"], float)
    g1r = np.asarray(g1["roots"], float)
    g1rails = rail_records(g1p, g1r, float(g1["apex_y"]))
    cd = np.load(CAP)
    diagnosis_blender = {
        "railDefinition": "front/side-root hem |x| >8 mm outside the rear sheet's local p99 hem |x| edge, with final five controls <=1 mm x/y travel; shoulder and hem x/y are reported at landmark z=1.405 m",
        "g1RailCount": len(g1rails),
        "g1RailStrands": g1rails,
        "ablation2000": ablations,
        "identifiedConstructionStep": "vertical end clamp from K1 g1",
        "hem": hem_stats(g1p, g1r, float(g1["cx"]), float(g1["apex_y"])),
    }
    (E / "diagnosis-blender.json").write_text(json.dumps(diagnosis_blender, indent=2) + "\n")

    if args.diagnose_only:
        print("DIAGNOSIS_ONLY_DONE", flush=True)
        return

    kids, roots, radii, audit, change = build_f1(state)
    np.savez_compressed(
        F1 / "strands.npz", points=kids.astype(np.float32), roots=roots.astype(np.float32),
        radii=radii, apex_y=float(cd["apex_y"]), cx=float(cd["cx"]),
    )
    (F1 / "audit.json").write_text(json.dumps(audit, indent=2, default=str) + "\n")
    render_doc = render_f1(state, kids, radii)
    (F1 / "station.json").write_text(json.dumps({"change": change, "audit": audit, **render_doc}, indent=2, default=str) + "\n")
    print("F1_DONE", len(kids), flush=True)


if __name__ == "__main__":
    main()

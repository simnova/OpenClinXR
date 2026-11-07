#!/usr/bin/env python3
"""Assemble diagnosis, v6 judge metrics, look sheet, and final reports."""
from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
L3 = ROOT / "tools/openclinxr/evidence/hair-look3"
LANDMARKS = ROOT / "tools/openclinxr/evidence/hair-curtain3/landmarks.json"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"
G1 = K1 / "cells/g1"
F1 = E / "cells/f1"
TARGET = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
JUDGE = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge")
TARGET_MASKS = JUDGE / "target-set-back"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


dg = load_module("hair_geo6_diagnose", K1 / "diagnose.py")
sys.path.insert(0, str(JUDGE))
judge_mod = load_module("hair_geo6_judge_v6", JUDGE / "hair_judge.py")


def triple(row, keys):
    return ",".join(str(row[key]) for key in keys)


def run_judge():
    lm = json.load(open(LANDMARKS))["judge"]
    front = triple(lm["front"], ("crown_top_row", "chin_row", "face_centre_col"))
    profile = triple(lm["profile"], ("crown_top_row", "chin_row", "forehead_front_col"))
    back = triple(lm["back"], ("crown_top_row", "shoulder_row", "hair_centre_col"))
    out = F1 / "judge"
    out.mkdir(exist_ok=True)
    return judge_mod.judge(
        str(F1 / "front.png"), str(F1 / "front-id.png"), "f1", front, str(out),
        target_set="back", id_mask_path=str(F1 / "front-id.png"),
        profile_mask_path=str(F1 / "profile_90-id.png"), profile_landmarks=profile,
        back_mask_path=str(F1 / "back-id.png"), back_landmarks=back,
        target_front_mask=str(TARGET_MASKS / "mask-front-v2.png"),
        target_profile_mask=str(TARGET_MASKS / "mask-profile-v2.png"),
        target_back_mask=str(TARGET_MASKS / "mask-back-v3.png"), overlay_prefix="overlay-",
    )


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)), np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def point_at(polyline, distance):
    s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(polyline, axis=0), axis=1))]
    q = np.clip(distance, 0.0, s[-1])
    j = min(max(np.searchsorted(s, q) - 1, 0), len(polyline) - 2)
    t = (q - s[j]) / max(s[j + 1] - s[j], 1e-12)
    return polyline[j] * (1.0 - t) + polyline[j + 1] * t


def rail_count(points, roots, apex):
    rear = roots[:, 1] >= apex
    local_edge = float(np.percentile(np.abs(points[rear, -1, 0]), 99))
    detached = (~rear) & ((np.abs(points[:, -1, 0]) - local_edge) > 0.008)
    square = np.linalg.norm(points[:, -1, :2] - points[:, -5, :2], axis=1) <= 0.001
    return int((detached & square).sum())


def root_density(roots, cx, apex):
    ahead = roots[:, 1] < apex
    dist = np.abs(roots[:, 0] - cx)
    rows = []
    for lo, hi in ((0.0, 0.003), (0.003, 0.006), (0.006, 0.010)):
        count = int((ahead & (dist >= lo) & (dist < hi)).sum())
        rows.append({"bandMm": [lo * 1000.0, hi * 1000.0], "count": count, "countPerMmHalfWidth": count / ((hi - lo) * 1000.0)})
    return rows


def gap_rows(points, roots, cap, cx, apex, sample_arc_mm=0.0):
    hairline = float(np.percentile(roots[roots[:, 1] < apex, 1], 2))
    ys = np.linspace(hairline + 0.006, apex - 0.004, 4)
    verts = np.asarray(cap["verts"], float)
    rows = []
    sample = roots.copy()
    if sample_arc_mm > 0:
        sample = np.asarray([point_at(p, sample_arc_mm / 1000.0) for p in points])
    for y in ys:
        band = np.abs(roots[:, 1] - y) <= 0.004
        left = cx - sample[band & (sample[:, 0] < cx), 0]
        right = sample[band & (sample[:, 0] > cx), 0] - cx
        vband = np.abs(verts[:, 1] - y) <= 0.003
        slit = 2.0 * np.min(np.abs(verts[vband, 0] - cx))
        gap = float((left.min() + right.min()) * 1000.0) if len(left) and len(right) else None
        rows.append({"yMm": float(y * 1000.0), "hairGapMm": gap, "capSlitMm": float(slit * 1000.0)})
    return rows


def hem_shape(points, roots, cx, apex):
    rear = roots[:, 1] >= apex
    x = points[rear, -1, 0] - cx
    z = points[rear, -1, 2]
    edges = np.linspace(np.percentile(x, 2), np.percentile(x, 98), 9)
    med = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        vals = z[(x >= lo) & (x < hi)]
        med.append(float(np.median(vals) * 1000.0))
    centre = np.median(z[np.abs(x) <= np.percentile(np.abs(x), 20)])
    sides = np.median(z[np.abs(x) >= np.percentile(np.abs(x), 80)])
    return {
        "zMm": {"min": float(z.min() * 1000.0), "p50": float(np.median(z) * 1000.0), "max": float(z.max() * 1000.0)},
        "binMedianZMmLeftToRight": med,
        "roundedUCenterBelowSidesMm": float((sides - centre) * 1000.0),
        "tipZStdMm": float(np.std(z) * 1000.0),
    }


def front_part_side(image_path, id_path):
    image = dg.rgb(image_path)
    mask = dg.ours_mask(id_path)
    y = dg.lum(image)
    yy, xx = np.nonzero(mask)
    y0, y1, x0, x1 = yy.min(), yy.max(), xx.min(), xx.max()
    h, w = y1 - y0 + 1, x1 - x0 + 1
    Y, X = np.indices(mask.shape)
    crown = mask & (Y <= y0 + 0.35 * h) & (X >= x0 + 0.35 * w) & (X <= x0 + 0.65 * w)
    sides = mask & (Y >= y0 + 0.18 * h) & (Y <= y0 + 0.68 * h) & ((X <= x0 + 0.28 * w) | (X >= x0 + 0.72 * w))
    return float(y[crown].mean() / max(y[sides].mean(), 1e-12))


def make_sheet():
    target_names = {"front": "target-front.png", "three_quarter": "target-three_quarter.png", "profile_90": "target-profile.png", "back": "target-back.png"}
    columns = [
        ("front", "front", None), ("three_quarter", "three_quarter", None),
        ("profile_90", "profile_90", None), ("back", "back", None),
        ("ear crop", "three_quarter", (100, 240, 484, 624)),
        ("back crop", "back", (320, 280, 704, 664)),
    ]
    rows = ("TS", "g1", "f1")
    tile, label_h = 384, 32
    canvas = Image.new("RGB", (tile * len(columns), len(rows) * (tile + label_h)), "white")
    draw = ImageDraw.Draw(canvas)
    for ri, row in enumerate(rows):
        for ci, (label, view, crop) in enumerate(columns):
            if row == "TS":
                source = TARGET / target_names[view]
            elif row == "g1":
                source = L3 / "cells/best" / f"{view}.png"
            else:
                source = F1 / f"{view}.png"
            image = Image.open(source).convert("RGB")
            if crop:
                image = image.crop(crop)
            image = image.resize((tile, tile), Image.Resampling.LANCZOS)
            x, y = ci * tile, ri * (tile + label_h)
            canvas.paste(image, (x, y + label_h))
            draw.text((x + 6, y + 8), f"{row} | {label}", fill="black")
    canvas.save(E / "look-sheet.png")


def main():
    diagnosis = json.load(open(E / "diagnosis-blender.json"))
    g1z = np.load(G1 / "strands.npz")
    f1z = np.load(F1 / "strands.npz")
    cap = np.load(CAP)
    g1p, g1r = np.asarray(g1z["points"], float), np.asarray(g1z["roots"], float)
    f1p, f1r = np.asarray(f1z["points"], float), np.asarray(f1z["roots"], float)
    cx, apex = float(g1z["cx"]), float(g1z["apex_y"])
    diagnosis["part"] = {
        "rootDensity": root_density(g1r, cx, apex),
        "gapHairlineToCrown": gap_rows(g1p, g1r, cap, cx, apex),
        "measurement": "root x gap in +/-4 mm y windows; cap slit from nearest cap vertices in +/-3 mm y windows",
    }
    (E / "diagnosis.json").write_text(json.dumps(diagnosis, indent=2) + "\n")

    judged = run_judge()
    g1m = json.load(open(G1 / "metrics.json"))
    f1_iou = {"front": judged["iou"], "profile": judged["profile_view"]["iou"], "back": judged["back_view"]["iou"]}
    g1_iou = {"front": g1m["silhouette"]["front"], "profile": g1m["silhouette"]["profile"], "back": g1m["silhouette"]["back"]}
    delta = {key: f1_iou[key] - g1_iou[key] for key in f1_iou}
    audit = json.load(open(F1 / "audit.json"))
    ends = dg.end_angles(f1p, f1r, apex)
    metrics = {
        "railCount": {"g1": int(diagnosis["g1RailCount"]), "f1": rail_count(f1p, f1r, apex)},
        "part": {
            "rootDensity": root_density(f1r, cx, apex),
            "gapAt10mmArc": gap_rows(f1p, f1r, cap, cx, apex, 10.0),
            "rootGap": gap_rows(f1p, f1r, cap, cx, apex, 0.0),
            "frontPartSide": front_part_side(F1 / "front.png", F1 / "front-id.png"),
        },
        "hem": hem_shape(f1p, f1r, cx, apex),
        "iou": {"f1": f1_iou, "g1": g1_iou, "delta": delta, "within002": all(abs(v) <= 0.02 for v in delta.values())},
        "inside": audit["post_inside_total"],
        "endTangents": ends,
        "endP95MaxDeg": max(v["p95Deg"] for v in ends.values()),
        "partSideBar": 1.6,
    }
    (F1 / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    make_sheet()

    gap_values = [row["hairGapMm"] for row in metrics["part"]["rootGap"]]
    ablation = diagnosis["ablation2000"]
    result = f"""hair-geo6 RESULT

D1 SIDE RAILS
Cause: K1 g1's second strict max_deg=0 vertical end clamp turns interpolated outer curtain children into rails. The 2,000-base-child ablation counted rails as all={ablation['all_steps']['railCount']}, without collar transfer={ablation['without_curtain_collar_transfer']['railCount']}, without vertical clamp={ablation['without_vertical_end_clamp']['railCount']}, without child interpolation={ablation['without_children_interpolation']['railCount']}; interpolation supplies the affected population, while disabling the clamp directly removes the column-forming operation.
Change: at the identified clamp step, arc-trim >8 mm outliers to 6 mm inside the threshold before collision-safe verticalization; the final end direction remains bounded.
Rail strands: {metrics['railCount']['g1']} before -> {metrics['railCount']['f1']} after (>8 mm detached-square-tail definition; per-strand g1 coordinates are in diagnosis.json).

D2 SQUARE HEM
Cause: g1 had a deterministic arc trim followed by identical-radius, square-ended vertical tails; last-40 mm distribution is recorded across x in diagnosis.json.
Change: arc-length-only U trim, deterministic per-strand length jitter {json.load(open(F1/'station.json'))['change']['jitterMm']['min']:.3f}..{json.load(open(F1/'station.json'))['change']['jitterMm']['max']:.3f} mm, and a 25 mm radius taper to 30%; no hem bending.
Hem: centre is {metrics['hem']['roundedUCenterBelowSidesMm']:.3f} mm below sides; tip z std={metrics['hem']['tipZStdMm']:.3f} mm; z min/p50/max={metrics['hem']['zMm']['min']:.3f}/{metrics['hem']['zMm']['p50']:.3f}/{metrics['hem']['zMm']['max']:.3f} mm.

D3 CENTRE PART
Cause: g1 root counts by half-width band 0-3/3-6/6-10 mm were {'/'.join(str(row['count']) for row in diagnosis['part']['rootDensity'])}; the four root gaps and cap slit widths are in diagnosis.json.
Change: added {json.load(open(F1/'station.json'))['change']['partFillAdded']} roots at 0.65-1.0 mm from the part plus a 10 mm first-segment lean toward a 0.4 mm centre margin, rejoining by 25 mm.
Part: root gap at four hairline-to-crown points={', '.join(f'{v:.3f}' for v in gap_values)} mm (max {max(gap_values):.3f} mm); 10 mm-arc post-collision gap is separately recorded in metrics.json; front part/side ratio={metrics['part']['frontPartSide']:.4f} (bar 1.6).

GATES
IoU front/profile/back f1={f1_iou['front']:.6f}/{f1_iou['profile']:.6f}/{f1_iou['back']:.6f}; g1={g1_iou['front']:.6f}/{g1_iou['profile']:.6f}/{g1_iou['back']:.6f}; delta={delta['front']:+.6f}/{delta['profile']:+.6f}/{delta['back']:+.6f}; |delta|<=0.02={metrics['iou']['within002']}.
Collider inside points={metrics['inside']}; end-angle p95 max={metrics['endP95MaxDeg']:.4f} deg.

SAW: versus TS, the first remaining wrong read is the rigid rectangular curtain/helmet silhouette; residual sparse side fringe and the bright warm part still read before the improved rounded, tapered hem does.
"""
    (E / "RESULT.txt").write_text(result)
    (E / "DONE.txt").write_text("DONE: diagnosis, f1 strands, collider/end audit, v6 judge, 1024 camera-relative renders, comparison sheet, and RESULT are present.\n")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()

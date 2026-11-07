#!/usr/bin/env python3
"""Final D1/end gate repair: trim clamp outliers to the neighbouring sheet."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from mathutils import Vector

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
F1 = E / "cells/f1"
sys.path.insert(0, str(E))
sys.path.insert(0, str(K1))
import build_blender as build  # noqa: E402
import base_children as ch  # noqa: E402
import station as st  # noqa: E402


def load_collision():
    spec = importlib.util.spec_from_file_location("hair_geo6_collision", K1 / "guides.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def audit_only(points, handle):
    gm = load_collision()
    objs, bvhs = gm.colliders(handle)
    counts = {}
    for obj in objs:
        bvh = bvhs[obj.name]
        count = 0
        for point in points.reshape(-1, 3):
            value = gm.signed_distance(bvh, point)
            if value is not None and value < 0:
                count += 1
        counts[obj.name] = count
    return {"colliders": [o.name for o in objs], "post_inside": counts, "post_inside_total": int(sum(counts.values())), "mode": "read-only signed-distance audit after final clamp"}


def outward_safe_vertical(points, edge, affected, tail=0.040, transition=0.015):
    """Use repaired tail's outward y envelope while keeping x in sheet."""
    out = points.copy()
    for i, polyline in enumerate(points):
        if not affected[i]:
            continue
        s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(polyline, axis=0), axis=1))]
        length = s[-1]
        tail_ids = np.flatnonzero((length - s) <= tail)
        tip_x = float(np.clip(polyline[-1, 0], -(edge + 0.0075), edge + 0.0075))
        target = np.array([tip_x, float(np.max(polyline[tail_ids, 1]) + 0.050)])
        for j in range(len(polyline)):
            remain = length - s[j]
            if remain <= tail:
                out[i, j, :2] = target
            elif remain <= tail + transition:
                w = build.smooth((tail + transition - remain) / transition)
                out[i, j, :2] = (1.0 - w) * out[i, j, :2] + w * target
    return out


def main():
    state = st.build_state()
    data = np.load(F1 / "strands.npz")
    points = np.asarray(data["points"], float)
    roots = np.asarray(data["roots"], float)
    apex, cx = float(data["apex_y"]), float(data["cx"])
    rear = roots[:, 1] >= apex
    edge = float(np.percentile(np.abs(points[rear, -1, 0]), 99))
    square = np.linalg.norm(points[:, -1, :2] - points[:, -5, :2], axis=1) <= 0.001
    rails = np.flatnonzero((~rear) & ((np.abs(points[:, -1, 0]) - edge) > 0.008) & square)

    lengths = build.arc(points)[:, -1]
    target_lengths = lengths.copy()
    limit = edge + 0.006
    for strand in rails:
        polyline = points[strand]
        s = build.arc(polyline[None])[0]
        unsafe = np.flatnonzero(np.abs(polyline[:, 0]) > limit)
        if len(unsafe):
            first = int(unsafe[0])
            target_lengths[strand] = s[max(1, first - 1)]
    points = build.trim_absolute(points, target_lengths)
    points = st.pchip_resample(points)
    points, _ = ch.repair_outside(points, state["handle"])

    # K1's strict clamp is now safe because outlying tips were replaced by an
    # arc trim at the neighbouring sheet. It supplies the hard p95 end gate.
    points = st.clamp_ends_vertical(points, tail=0.040, blend=0.030, max_deg=0.0)
    audit = audit_only(points, state["handle"])
    if audit["post_inside_total"]:
        strict = points.copy()
        points, _ = ch.repair_outside(points, state["handle"])
        affected = np.max(np.linalg.norm(points - strict, axis=2), axis=1) > 1e-7
        points = outward_safe_vertical(points, edge, affected)
        audit = audit_only(points, state["handle"])
    if audit["post_inside_total"]:
        # The envelope leaves at most numerical boundary stragglers; project
        # those exact points once. This cannot move the p95 end statistic.
        points, _ = ch.repair_outside(points, state["handle"])
        audit = audit_only(points, state["handle"])
    if audit["post_inside_total"]:
        print(json.dumps(audit, indent=2), flush=True)
        raise RuntimeError(f"outward-safe vertical clamp retained {audit['post_inside_total']} inside points")

    aa = build.arc(points)
    remain = aa[:, -1, None] - aa
    radii = (0.00005 * (0.30 + 0.70 * build.smooth(np.clip(remain / 0.025, 0.0, 1.0)))).astype(np.float32)
    np.savez_compressed(F1 / "strands.npz", points=points.astype(np.float32), roots=roots.astype(np.float32), radii=radii, apex_y=apex, cx=cx)
    (F1 / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    station = json.load(open(F1 / "station.json"))
    station["change"]["railOutliersTrimmed"] = int(len(rails))
    station["change"]["railLocalEdgeMm"] = edge * 1000.0
    station["change"]["railFix"] = "at the identified vertical-clamp step, arc-trim >8 mm outliers to 6 mm inside the threshold before strict verticalization"
    station["audit"] = audit
    station.update(build.render_f1(state, points, radii))
    (F1 / "station.json").write_text(json.dumps(station, indent=2, default=str) + "\n")
    print("GATE_REPAIR", len(rails), audit["post_inside_total"], flush=True)


if __name__ == "__main__":
    main()

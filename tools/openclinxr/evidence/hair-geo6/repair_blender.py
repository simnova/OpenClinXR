#!/usr/bin/env python3
"""Close the measured post-collision part gap and end-angle failures."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
K1 = ROOT / "tools/openclinxr/evidence/hair-look1"
F1 = E / "cells/f1"
sys.path.insert(0, str(E))
sys.path.insert(0, str(K1))
import build_blender as build  # noqa: E402
import base_children as ch  # noqa: E402
import station as st  # noqa: E402


def anchored_tail(points, tail=0.040, transition=0.015, allowance=0.0075):
    """Vertical final 40 mm no farther than 7.5 mm from the upper sheet."""
    out = points.copy()
    for i, polyline in enumerate(points):
        s = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(polyline, axis=0), axis=1))]
        length = s[-1]
        upper = build.point_at(polyline, max(0.0, length - tail - transition))
        anchor = build.point_at(polyline, max(0.0, length - tail))
        lateral = polyline[-1, :2] - anchor[:2]
        mag = np.linalg.norm(lateral)
        target = anchor[:2] + lateral * min(1.0, allowance / max(mag, 1e-12))
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
    cx, apex = float(data["cx"]), float(data["apex_y"])

    # The first build added 691 roots. Add two deterministic, sub-millimetre
    # variants of those fill strands; all stay within 1 mm of the part line.
    base_n = 54529
    fill = points[base_n:].copy()
    fill_roots = roots[base_n:].copy()
    copies, copy_roots = [], []
    rng = np.random.default_rng(20261014 + 79)
    for _ in range(2):
        q = fill.copy()
        r = fill_roots.copy()
        side = np.where(r[:, 0] >= cx, 1.0, -1.0)
        new_x = cx + side * rng.uniform(0.00055, 0.00095, len(q))
        dx = new_x - r[:, 0]
        a = build.arc(q)
        q[:, :, 0] += dx[:, None] * (1.0 - build.smooth(a / 0.025))
        q[:, :, 1] += rng.uniform(-0.0005, 0.0005, len(q))[:, None] * (1.0 - build.smooth(a / 0.030))
        r[:, 0] = new_x
        copies.append(q)
        copy_roots.append(r)
    points = np.concatenate([points, *copies], axis=0)
    roots = np.concatenate([roots, *copy_roots], axis=0)

    # Keep the part-covering segment outside the crown before collision
    # projection. At 10 mm arc it is lifted 4 mm and leaned to +/-0.4 mm.
    near = (roots[:, 1] < apex) & (np.abs(roots[:, 0] - cx) <= 0.006)
    a = build.arc(points)
    lean = build.smooth(a / 0.010) * (1.0 - build.smooth(np.clip((a - 0.010) / 0.015, 0.0, 1.0)))
    target = cx + np.where(roots[:, 0] >= cx, 0.0004, -0.0004)
    points[:, :, 0] += near[:, None] * (target[:, None] - points[:, :, 0]) * lean
    points[:, :, 2] += near[:, None] * (0.0005 + 0.0035 * lean)

    points, _ = ch.repair_outside(points, state["handle"])
    points = anchored_tail(points)
    points, audit = ch.repair_outside(points, state["handle"])
    points = anchored_tail(points)
    points, audit = ch.repair_outside(points, state["handle"])

    aa = build.arc(points)
    remain = aa[:, -1, None] - aa
    radii = (0.00005 * (0.30 + 0.70 * build.smooth(np.clip(remain / 0.025, 0.0, 1.0)))).astype(np.float32)
    np.savez_compressed(F1 / "strands.npz", points=points.astype(np.float32), roots=roots.astype(np.float32), radii=radii, apex_y=apex, cx=cx)
    (F1 / "audit.json").write_text(json.dumps(audit, indent=2, default=str) + "\n")
    station = json.load(open(F1 / "station.json"))
    station["change"]["partFillAdded"] = int(len(points) - base_n)
    station["change"]["postCollisionCorrection"] = "4 mm crown-outward part-cover lift; anchor-preserving final-40-mm tail limited to 7.5 mm from upper sheet"
    station["audit"] = audit
    render = build.render_f1(state, points, radii)
    station.update(render)
    (F1 / "station.json").write_text(json.dumps(station, indent=2, default=str) + "\n")
    print("REPAIRED", len(points), audit["post_inside_total"], flush=True)


if __name__ == "__main__":
    main()

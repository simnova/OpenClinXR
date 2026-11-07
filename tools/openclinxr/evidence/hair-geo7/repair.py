#!/usr/bin/env python3
"""STEP 2 (hair-geo7) collider audit inside Blender.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background \
       --python repair.py -- <cell> [<cell> ...]
For each cell: load strands_raw.npz, run the EXISTING
base_children.repair_outside audit (frozen guide gate colliders), write
strands.npz + audit.json + gates (inside/ end-p95 / part-gap).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path[:0] = [str(ROOT / "tools/openclinxr/evidence/hair-int1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look1"),
                str(ROOT / "tools/openclinxr/evidence/hair-look2")]
import run_blender as R  # noqa: E402
import base_children as B  # noqa: E402


def endpoint_stats(points: np.ndarray) -> dict:
    vec = points[:, -1] - points[:, -5]
    deg = np.degrees(np.arctan2(np.linalg.norm(vec[:, :2], axis=1),
                                np.abs(vec[:, 2]) + 1e-12))
    return {"p50": float(np.percentile(deg, 50)), "p95": float(np.percentile(deg, 95)),
            "max": float(deg.max())}


def part_gap(roots: np.ndarray, cx: float, apex: float) -> float:
    front = roots[:, 1] <= apex
    left = cx - roots[front & (roots[:, 0] < cx), 0]
    right = roots[front & (roots[:, 0] >= cx), 0] - cx
    return float((left.min() + right.min()) * 1000.0)


def clamp_ends_vertical(kids: np.ndarray, tail: float = 0.040, blend: float = 0.030) -> np.ndarray:
    """Replica of station.clamp_ends_vertical (hair-look1), strict max_deg=0."""
    out = kids.copy()

    def smooth(x):
        x = np.clip(x, 0.0, 1.0)
        return x * x * (3.0 - 2.0 * x)

    for i, p in enumerate(out):
        s = np.r_[0., np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        L = s[-1]
        target_xy = p[-1, :2].copy()
        for j in range(p.shape[0]):
            remain = L - s[j]
            if remain > tail + blend:
                continue
            w = smooth((tail + blend - remain) / blend) if remain > tail else 1.0
            out[i, j, :2] = (1 - w) * out[i, j, :2] + w * target_xy
    return out


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    assert argv, "pass cell names"
    state = R.ST.build_state()
    for tag in argv:
        cell = E / "cells" / tag
        raw = dict(np.load(cell / "strands_raw.npz"))
        points = np.asarray(raw["points"], float)
        roots = np.asarray(raw["roots"], float)
        # raw is already clamped; repair tilts repaired tails, so alternate
        # repair -> strict clamp (the accepted pipeline's final order), then
        # one last repair pass whose audit is the recorded gate.
        audits = []
        for _ in range(3):
            points, audit = B.repair_outside(points, state["handle"])
            audits.append(audit)
            points = clamp_ends_vertical(points)
        points, audit = B.repair_outside(points, state["handle"])
        audits.append(audit)
        np.savez_compressed(cell / "strands.npz", points=points.astype(np.float32),
                            roots=roots.astype(np.float32), radii=np.asarray(raw["radii"]),
                            apex_y=np.asarray(raw["apex_y"]), cx=np.asarray(raw["cx"]))
        report = {"change": json.loads((cell / "loft_meta.json").read_text()),
                  "colliderPasses": audits, "collider": audit, "endAngleDeg": endpoint_stats(points),
                  "partGapMm": part_gap(roots, float(np.asarray(raw["cx"])),
                                        float(np.asarray(raw["apex_y"]))),
                  "strandCount": int(len(points))}
        report["gates"] = {"colliderInsideZero": audit["post_inside_total"] == 0,
                           "endP95AtMost10Deg": report["endAngleDeg"]["p95"] <= 10.0,
                           "partGapAtMost3Mm": report["partGapMm"] <= 3.0}
        (cell / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
        print("REPAIRED", tag, json.dumps(report["gates"]), json.dumps(report["endAngleDeg"]),
              report["partGapMm"], flush=True)


if __name__ == "__main__":
    main()

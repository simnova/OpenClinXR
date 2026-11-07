#!/usr/bin/env python3
"""STEP 3 (hair-geo7) Change B: one guide-level change.

RULE (stated): rear guides (root y >= apex_y) get a backward (+y) sweep of
their sub-ear portion: dy = tan(8deg) * (earz - z), ramped in with a
smoothstep over the 20 mm below the ear-lobe line (C1-continuous at the ear),
capped at 12 mm. Guides rooted at/above the ear line, curtain/front guides,
and roots are untouched.

TARGET ANGLE (from STEP 1, where.json): profile row4_back needs ours(-33.9)
-> target(-19.6), i.e. +14 deg backward; row3_back needs +4.5 deg; the k5
residual at profile row4_back is still +14.5 deg. This B applies HALF that
(+8 deg tilt) to protect the silhouette IoU; the keep-criterion decides.

Children for b1 are built with the better-of-A method (K=5 frame transport).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
GUIDES = ROOT / "tools/openclinxr/evidence/hair-look1/guides16.npz"
CAP = ROOT / "tools/openclinxr/evidence/hair-cap8/cap-v8.npz"

ANGLE_DEG = 8.0
CAP_MM = 12.0
RAMP_MM = 20.0


def main() -> None:
    gd = dict(np.load(GUIDES))
    gpts = np.asarray(gd["points"], float).copy()
    groots = np.asarray(gd["roots"], float)
    cap = np.load(CAP)
    apex_y = float(cap["apex_y"])
    earz = float(np.asarray(cap["pinna_lobe_L"])[2])
    k = math.tan(math.radians(ANGLE_DEG))
    rear = groots[:, 1] >= apex_y
    depth = np.clip(earz - gpts[:, :, 2], 0.0, None)          # >0 below ear
    ramp = np.clip(depth / (RAMP_MM / 1000.0), 0.0, 1.0)
    ramp = ramp * ramp * (3.0 - 2.0 * ramp)
    dy = np.minimum(k * depth * ramp, CAP_MM / 1000.0)
    dy[~rear] = 0.0
    # roots untouched: zero shift at the root point explicitly
    dy[:, 0] = 0.0
    gpts[:, :, 1] += dy
    n_affected = int((dy.max(axis=1) > 0).sum())
    cell = HERE / "cells" / "b1"
    cell.mkdir(parents=True, exist_ok=True)
    gd["points"] = gpts
    np.savez(cell / "guides_b1.npz", **{k: np.asarray(v) for k, v in gd.items()})
    rule = {"rule": "rear guides (root y>=apex_y): dy=tan(8deg)*(earz-z), smoothstep ramp 20mm below ear, cap 12mm, roots fixed",
            "angleDeg": ANGLE_DEG, "capMm": CAP_MM, "rampMm": RAMP_MM,
            "apexY": apex_y, "earLobeZ": earz,
            "rearGuides": int(rear.sum()), "affectedGuides": n_affected,
            "maxShiftMm": round(float(dy.max()) * 1000.0, 3),
            "targetAngle": "profile row4_back residual +14.5deg (step1 where.json; k5 where_k5.json); half-step +8deg to protect IoU",
            "sourceGuides": "hair-look1/guides16.npz (untouched; modified copy stored here)"}
    (cell / "guide_rule.json").write_text(json.dumps(rule, indent=2) + "\n")
    print(json.dumps(rule, indent=2), flush=True)


if __name__ == "__main__":
    main()

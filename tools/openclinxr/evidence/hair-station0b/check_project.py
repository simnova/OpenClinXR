#!/usr/bin/env python3
"""Evidence-only: verify the S projector reproduces the pinned triples.

Projects the station-frame 3D landmarks with S/envelope.py and compares
against the pinned registration render triples (<0.5 px required, same
bar as run.py). Also reports mm-per-pixel pitch per view at the crown.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import envelope as ENV  # noqa: E402

TRIPLE = {
    "front": ("crown", "menton", "face_centre"),
    "profile_90": ("crown", "menton", "brow"),
    "back": ("crown", "shoulder", "face_centre"),
}


def main():
    frame = np.load("/tmp/station0b-run/station-frame.npz")
    cams = json.loads(
        (ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json")
        .read_text()
    )
    pts = {
        name: np.array(frame["point3d/%s" % name], dtype=np.float64)
        for name in ("crown", "menton", "brow", "face_centre", "shoulder")
    }
    worst = 0.0
    sensor = float(cams["sensorWidthMm"])
    for view in ("front", "profile_90", "back"):
        rn, rm, rc = TRIPLE[view]
        pr = {}
        for name in ("crown", "menton", "brow", "face_centre", "shoulder"):
            c, r, d = ENV.project_to_render(
                pts[name][None, :], cams["views"][view], sensor)
            pr[name] = (float(r[0]), float(c[0]), float(d[0]))
        a_r, b_r, c_r = cams["registrationRenderTriples"][view]
        got = (pr[rn][0], pr[rm][0], pr[rc][1])
        want = (a_r, b_r, c_r)
        deltas = [abs(g - w) for g, w in zip(got, want)]
        worst = max(worst, max(deltas))
        focal = 50.0 / 36.0 * 1024.0
        pitch = pr[rn][2] * 1000.0 / focal
        print("%-11s got=%s want=%s d=%s pitch=%.3fmm/px" % (
            view, [round(v, 2) for v in got], want,
            [round(v, 3) for v in deltas], pitch))
    print("WORST %.4f px" % worst)
    assert worst < 0.5, "projector does not reproduce the pinned frame"
    print("PROJECTOR_OK")


if __name__ == "__main__":
    main()

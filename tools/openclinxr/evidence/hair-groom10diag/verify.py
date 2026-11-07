#!/usr/bin/env python3
"""Fail-closed artifact verification for hair-groom10diag."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom10diag")
EXPECTED_SHA = "01cc58ab3ca99a5bddbd8ea293e0f54ee3a22fc8b919160b188c49335d25b803"
STAGES = ["far_snap", "part_sweep", "persistent_offset", "depth_servo",
          "coarse_clump", "fine_clump", "length_jitter", "hairline_taper",
          "ear_keepout", "sdf_project_outside", "part_clamp_reproject"]
DEFECTS = ["back-knot", "behind-ear-loops", "sideburn-tuft", "hairline-band"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    final = STORE / "final-strands.npz"
    raw = STORE / "raw-interpolation.npz"
    assert final.exists() and raw.exists()
    assert sha256(final) == EXPECTED_SHA
    sd = np.load(E / "stage-displacements.npz", allow_pickle=True)
    assert list(map(str, sd["stage_names"])) == STAGES
    assert sd["max_mm"].shape == (283100, len(STAGES))
    assert sd["argmax_sample"].shape == (283100, len(STAGES))
    assert sd["final_guide_idx"].shape == (283100, 4)
    assert sd["final_guide_w"].shape == (283100, 4)
    assert np.isfinite(sd["max_mm"]).all()
    assert np.all(sd["max_mm"] >= 0)
    assert np.all(sd["argmax_sample"] < 32)
    assert np.allclose(sd["final_guide_w"].sum(axis=1), 1.0, atol=2e-6)
    analysis = json.loads((E / "strand-analysis.json").read_text())
    assert set(analysis["defects"]) == set(DEFECTS + ["control"])
    assert analysis["defects"]["control"]["nChildren"] == 512
    for name in DEFECTS:
        p = E / ("defect-" + name + "-abc.png")
        assert p.exists() and Image.open(p).width > 700
        assert analysis["defects"][name]["nChildren"] > 0
        assert analysis["defects"][name]["rawChildrenOver120Deg"] > 0
    assert not list(E.rglob("*.blend"))
    result = (E / "RESULT.txt").read_text()
    for phrase in ("GUIDE PATH | YES", "INTERPOLATION / CHILD DENSITY | YES",
                   "candidate explanation", "NEXT"):
        assert phrase in result
    print("PASS hair-groom10diag: exact SHA, stage schema, selections, renders, attribution, no blend")


if __name__ == "__main__":
    main()

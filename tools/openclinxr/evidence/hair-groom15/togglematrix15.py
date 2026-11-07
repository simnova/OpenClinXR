#!/usr/bin/env python3
"""hair-groom15 stage-toggle matrix.

Rebuilds the child station once per toggle (density 1.2M) and measures the
two quantities that decide whether the brief's gates can pass at all:
  * parietal / temple child skull-SDF depth p50 / p90 / std (arc 10-80 mm)
  * insideBody: shell samples (points p1..p40) with exact SDF < 0

Writes E/toggles15.json. Reproducible provenance for the RESULT table.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
from children import sdf_sampler  # noqa: E402

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz"
ROOTS = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
DENSITY = "1200000"

BASE = {
    "density": DENSITY, "seed": "7", "scalp-roots": str(ROOTS),
    "part-by-islands": "1", "clump-factor": "0.2", "lateral-keep": "0.0",
    "root-band": "0.070", "sideburn-tuck": "1", "above-surface": "0.0",
    "shrink-offset": "0.001", "smooth-steps": "2", "smooth-amount": "0.15",
    "smooth-iters": "1", "depth-classes": "3", "interp-guides": "3",
}

TOGGLES = [
    ("alloff", {"skip-clump": "1", "skip-noise": "1",
                "skip-shrink": "1", "skip-smooth": "1"}),
    ("base", {}),
    ("noshrink", {"skip-shrink": "1"}),
    ("nosmooth", {"skip-smooth": "1"}),
    ("noclumpnoise", {"skip-clump": "1", "skip-noise": "1"}),
    ("singleclass", {"depth-classes": "1"}),
    ("above05", {"above-surface": "0.5"}),
    ("nodrape", {"lateral-keep": "1.0", "sideburn-tuck": "0"}),
    ("pureinterp", {"skip-clump": "1", "skip-noise": "1",
                    "skip-shrink": "1", "skip-smooth": "1",
                    "depth-classes": "1"}),
    ("interp1", {"interp-guides": "1"}),
    ("interp4", {"interp-guides": "4"}),
    ("interp8", {"interp-guides": "8"}),
    ("dg005", {"distance-to-guides": "0.05"}),
    ("dg001", {"distance-to-guides": "0.01"}),
    ("headonly", {"colliders": "OCLX_Aisha_head"}),
]

ORDER = ["density", "seed", "scalp-roots", "part-by-islands", "clump-factor",
         "lateral-keep", "root-band", "sideburn-tuck", "above-surface",
         "shrink-offset", "smooth-steps", "smooth-amount", "smooth-iters",
         "depth-classes", "interp-guides", "distance-to-guides",
         "colliders", "skip-clump", "skip-noise", "skip-shrink",
         "skip-smooth"]


def build(tag, over, outp):
    flags = dict(BASE)
    flags.update(over)
    cmd = [BLENDER, "--background", "--python",
           str(STRANDS / "blender_children.py"), "--",
           "--guides", str(GUIDES), "--out", str(outp)]
    for k in ORDER:
        if k in flags:
            cmd += ["--" + k, flags[k]]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError(tag + " build failed: " + r.stderr[-1500:])
    return flags


def probe(path, sample):
    doc = np.load(str(path), allow_pickle=True)
    pts = np.asarray(doc["points"], dtype=np.float64)
    flat = pts[:, 1:, :].reshape(-1, 3)
    vals, inside = sample(flat)
    n_inside = int((inside & (vals < 0.0)).sum())

    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(pts), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    shell = (arc >= 0.010) & (arc <= 0.080)
    vv = np.where(inside, vals, np.nan).reshape(-1)
    bandm = {
        "parietal": (np.abs(pts[:, 0, 0] * 1000.0) >= 50.0)
        & (np.abs(pts[:, 0, 0] * 1000.0) < 85.0),
        "temple": (np.abs(pts[:, 0, 0] * 1000.0) >= 35.0)
        & (np.abs(pts[:, 0, 0] * 1000.0) < 85.0)
        & (pts[:, 0, 1] * 1000.0 >= -135.0)
        & (pts[:, 0, 1] * 1000.0 < -40.0),
    }
    out = {"n": int(len(pts)), "insideBody": n_inside}
    for bn, bm in bandm.items():
        sel = (shell[:, 1:] & bm[:, None]).reshape(-1)
        v = vv[sel]
        v = v[np.isfinite(v)]
        out[bn] = {"p50": round(float(np.percentile(v, 50)), 2) if v.size else 0.0,
                   "p90": round(float(np.percentile(v, 90)), 2) if v.size else 0.0,
                   "std": round(float(v.std()), 2) if v.size else 0.0}
    return out


def main():
    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    tmp = Path(tempfile.mkdtemp(prefix="hg15tog-"))
    res = {}
    try:
        for tag, over in TOGGLES:
            outp = tmp / (tag + ".npz")
            flags = build(tag, over, outp)
            res[tag] = {"args": over, "measure": probe(outp, sample)}
            outp.unlink(missing_ok=True)
            print("TOGGLE", tag, json.dumps(res[tag]["measure"]), flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    (E / "toggles15.json").write_text(json.dumps(res, indent=1))
    print("WROTE", E / "toggles15.json")


if __name__ == "__main__":
    main()

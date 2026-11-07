#!/usr/bin/env python3
"""hair-groom20 defect ABC inputs: raw interpolation + box-selected ids.

Raw = positional station blend BEFORE downstream stages
(root + sum w (G(f) - G(0)), P=32 resampled guides), same weights the
final build used (E/build/strands.npz guide_idx/guide_w). Ids = children
with any final sample projecting into each groom10diag box (scorer-v3
cameras, no depth gate; deterministic, documented approximation of the
diag selection which also required depth proximity).
Writes E/defect-raw.npz + E/defect-ids.json.
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

CAME = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"
BOXES = {
    "back-knot": ("back", [150, 420, 512, 765]),
    "behind-ear-loops": ("profile_90", [270, 550, 250, 530]),
    "sideburn-tuft": ("three_quarter", [330, 610, 380, 660]),
    "hairline-band": ("front", [98, 196, 291, 733]),
}
P = 32


def main():
    gdoc = np.load(E / "build" / "guides-20.npz", allow_pickle=True)
    crown = np.asarray(gdoc["crown"], dtype=np.float64)
    gw = F.head_to_world(np.asarray(gdoc["curves_head"], dtype=np.float64),
                         crown)
    gres = np.stack([F.resample_arc(g, P) for g in gw])
    sdoc = np.load(E / "build" / "strands.npz", allow_pickle=True)
    pts = np.asarray(sdoc["points"], dtype=np.float64)
    gi = np.asarray(sdoc["guide_idx"], dtype=np.int64)
    w = np.asarray(sdoc["guide_w"], dtype=np.float64)
    roots = np.asarray(sdoc["roots"], dtype=np.float64)
    G = gres[gi]
    raw = roots[:, None, :] + ((G - G[:, :, 0:1, :]) * w[:, :, None, None]).sum(axis=1)
    np.savez_compressed(E / "defect-raw.npz",
                        points=raw.astype(np.float32))
    cams = json.loads(CAME.read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        M = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        proj[v] = (np.linalg.inv(M),
                   float(cams["views"][v]["lensMm"]) / sensor * 1024.0)
    ids = {}
    for name, (view, (r0, r1, c0, c1)) in BOXES.items():
        inv, f = proj[view]
        flat = pts.reshape(-1, 3)
        hw = np.ones((len(flat), 4))
        hw[:, :3] = flat
        lc = (inv @ hw.T).T
        dep = -lc[:, 2]
        cc = np.full(len(flat), -1.0)
        rr = np.full(len(flat), -1.0)
        ok = dep > 0
        cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
        rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
        hit = (cc >= c0) & (cc < c1) & (rr >= r0) & (rr < r1)
        sel = hit.reshape(len(pts), -1).any(axis=1)
        ids[name] = {"n": int(sel.sum()),
                     "ids": np.nonzero(sel)[0].astype(np.int64).tolist()[:4000]}
    (E / "defect-ids.json").write_text(json.dumps(
        {k: {"n": v["n"], "ids": v["ids"]} for k, v in ids.items()},
        indent=1) + "\n")
    print(json.dumps({k: v["n"] for k, v in ids.items()}, indent=1))


if __name__ == "__main__":
    main()

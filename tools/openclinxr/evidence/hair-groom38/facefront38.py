#!/usr/bin/env python3
"""groom38 NEW GATE: face-front + sub-lobe loop strand counts.

Face-front (per side): strand with any sample anterior of the face
plane through the outer eye corners (y < facePlaneY from
faceland38.json, Blender-measured lash outer corners) AND above the
jaw line (z > jawZ = chin underside from the body midline profile),
side-matched by x sign. Measured on groom36 first; groom38 must not
exceed groom36's count per side.

Sub-lobe loop (per side, report only): strand with any sample below
the lobe (z < sides zmin) AND anterior of the ear front plane
(y < sides yfront), side-matched.

Usage: facefront38.py (paths fixed: faceland38.json, store 36/38).
Writes E38/facefront-38.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                      / "strands"))
import gates34 as G  # noqa: E402

STORE = Path("/Volumes/files/openclinxr-assets/store")
S36 = STORE / "hair-groom36/build-36/strands.npz"
S38 = STORE / "hair-groom38/build-38/strands.npz"


def counts(pts, plane_y, jaw_z, sides):
    out = {}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        s = sides[nm]
        m = ((pts[:, :, 1] < plane_y) & (pts[:, :, 2] > jaw_z)
             & ((pts[:, :, 0] * sgn) > 0)).any(axis=1)
        sub = ((pts[:, :, 2] < s["zmin"]) & (pts[:, :, 1] < s["yfront"])
               & ((pts[:, :, 0] * sgn) > 0)).any(axis=1)
        out[nm] = {"faceFront": int(m.sum()), "subLobe": int(sub.sum()),
                   "faceFrontEx": [int(i) for i in np.nonzero(m)[0][:10]],
                   "subLobeEx": [int(i) for i in np.nonzero(sub)[0][:10]]}
    return out


def main():
    land = json.loads((E / "faceland38.json").read_text())
    plane_y, jaw_z = land["facePlaneY"], land["jawZ"]
    sides = G.mirrored_sides()
    res = {"facePlaneY": plane_y, "jawZ": jaw_z,
           "landmarkProvenance": "faceland38.json (lash outer corners "
           "per side from body GLB; jaw = chin-underside slice)"}
    for tag, sp in (("groom36", S36), ("groom38", S38)):
        D = np.load(str(sp), allow_pickle=True)
        pts = np.asarray(D["points"], dtype=np.float64)
        res[tag] = counts(pts, plane_y, jaw_z, sides)
        print("%s faceFront +x=%d -x=%d | subLobe +x=%d -x=%d"
              % (tag, res[tag]["xpos"]["faceFront"],
                 res[tag]["xneg"]["faceFront"],
                 res[tag]["xpos"]["subLobe"],
                 res[tag]["xneg"]["subLobe"]), flush=True)
    ok = all(res["groom38"][nm]["faceFront"]
             <= res["groom36"][nm]["faceFront"] for nm in ("xpos", "xneg"))
    res["gatePass"] = bool(ok)
    print("face-front gate (38<=36 both sides): %s" % ok, flush=True)
    (E / "facefront-38.json").write_text(json.dumps(res, indent=1) + "\n")


if __name__ == "__main__":
    main()

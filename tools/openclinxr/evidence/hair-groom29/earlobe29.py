#!/usr/bin/env python3
"""hair-groom29 earlobe column count (report-only, not gated).

Same geometry as groom26 earlobe_gate.py (operator FIX3 definition).
Reads store strands-29.npz + E/renders-29. Writes E/earlobe29-gate.json.

3D: strand samples (s>=1, any radii -- no hiding by trims) with
z < lobe-lowest zmin, y in [yback, yfront] (ear front-to-back span),
|x| in [xmin-5mm, xmax] (ear column, same side). Curtain samples with
y < yback do NOT count. Counted per side: strands + samples, plus
strand tips in the same volume, plus the 25mm-bounded variant
(z in [zmin-25mm, zmin]) matching the image box depth.
IMAGE: hair-ID pixels (alpha>=230) in the under-lobe pixel box
(lobe bottom to 25 mm below x ear front-to-back span) in 3q and
profile_90, camera-side (xpos) boxes; far-side (xneg) boxes are
occluded in these views (3q-xneg projects onto the mouth, profile-xneg
onto head interior) and reported as N/A with the projection evidence.
Box pixel coordinates are stated in the output.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STORE25 = Path("/Volumes/files/openclinxr-assets/store/hair-groom25")
STORE26 = Path("/Volumes/files/openclinxr-assets/store/hair-groom26")
E25 = E.parent / "hair-groom25"
CAME = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                   "/cameras-scorer-v3.json").read_text())
SENSOR = float(CAME["sensorWidthMm"])
PROJ = {}
for _v in ("three_quarter", "profile_90"):
    _m = np.array(CAME["views"][_v]["matrixWorld"], dtype=np.float64)
    PROJ[_v] = (np.linalg.inv(_m),
                float(CAME["views"][_v]["lensMm"]) / SENSOR * 1024.0)


def project(pts, v):
    inv, f = PROJ[v]
    hw = np.ones((len(pts), 4))
    hw[:, :3] = np.asarray(pts, dtype=np.float64)
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0)
    rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
    return cc, rr, dep


STORE29 = Path("/Volumes/files/openclinxr-assets/store/hair-groom29")
STRANDS = {"groom29": STORE29 / "strands-29.npz"}
RENDERS = {"groom29": E / "renders-29"}


def main():
    pin = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull3"
                      "/workspace/ear_pinna.npz"), allow_pickle=True)
    xyz = np.asarray(pin["xyz"], dtype=np.float64)
    sides = {}
    for key, sgn, nm in (("idx_earXpos", 1.0, "xpos"),
                         ("idx_earXneg", -1.0, "xneg")):
        pv = xyz[np.asarray(pin[key])]
        sides[nm] = {"sgn": sgn, "zmin": float(pv[:, 2].min()),
                     "yfront": float(pv[:, 1].max()),
                     "yback": float(pv[:, 1].min()),
                     "xmin": float(np.abs(pv[:, 0]).min()),
                     "xmax": float(np.abs(pv[:, 0]).max())}
    out = {"sidesM": sides, "gates3d": {}, "boxes": {}, "gatesImg": {}}
    # pixel boxes: project 3D box corners (mid-ear |x| plane) per view.
    for v in ("three_quarter", "profile_90"):
        for nm, s in sides.items():
            xm = s["sgn"] * (s["xmin"] + s["xmax"]) / 2.0
            corners = np.array([
                [xm, s["yback"], s["zmin"]],
                [xm, s["yfront"], s["zmin"]],
                [xm, s["yback"], s["zmin"] - 0.025],
                [xm, s["yfront"], s["zmin"] - 0.025]])
            cc, rr, dep = project(corners, v)
            out["boxes"]["%s/%s" % (v, nm)] = {
                "rows": [round(float(rr.min()), 1),
                         round(float(rr.max()), 1)],
                "cols": [round(float(cc.min()), 1),
                         round(float(cc.max()), 1)],
                "intRows": [int(np.floor(rr.min())), int(np.ceil(rr.max()))],
                "intCols": [int(np.floor(cc.min())), int(np.ceil(cc.max()))]}
    for tag, sp in STRANDS.items():
        D = np.load(str(sp), allow_pickle=True)
        pts = np.asarray(D["points"], dtype=np.float64)
        n, P, _ = pts.shape
        g = {"n": int(n), "sides": {}}
        for nm, s in sides.items():
            sgn = s["sgn"]
            flat = pts[:, 1:, :].reshape(-1, 3)
            sm = ((flat[:, 2] < s["zmin"])
                  & (flat[:, 1] >= s["yback"])
                  & (flat[:, 1] <= s["yfront"])
                  & ((flat[:, 0] * sgn) > 0)
                  & (np.abs(flat[:, 0]) >= s["xmin"] - 0.005)
                  & (np.abs(flat[:, 0]) <= s["xmax"]))
            has = sm.reshape(n, P - 1).any(axis=1)
            sm25 = sm & (flat[:, 2] >= s["zmin"] - 0.025)
            has25 = sm25.reshape(n, P - 1).any(axis=1)
            tips = pts[:, -1, :]
            tm = ((tips[:, 2] < s["zmin"])
                  & (tips[:, 1] >= s["yback"])
                  & (tips[:, 1] <= s["yfront"])
                  & ((tips[:, 0] * sgn) > 0)
                  & (np.abs(tips[:, 0]) >= s["xmin"] - 0.005)
                  & (np.abs(tips[:, 0]) <= s["xmax"]))
            tm25 = tm & (tips[:, 2] >= s["zmin"] - 0.025)
            g["sides"][nm] = {
                "strands": int(has.sum()),
                "samples": int(sm.sum()),
                "tips": int(tm.sum()),
                "strands25mm": int(has25.sum()),
                "samples25mm": int(sm25.sum()),
                "tips25mm": int(tm25.sum())}
        g["hard3dUnbounded"] = (g["sides"]["xpos"]["strands"]
                                + g["sides"]["xneg"]["strands"]) == 0
        g["hard3d25mm"] = (g["sides"]["xpos"]["strands25mm"]
                           + g["sides"]["xneg"]["strands25mm"]) == 0
        out["gates3d"][tag] = g
        print("3D %s xpos=%s xneg=%s (strands, unbounded)" % (
            tag, g["sides"]["xpos"]["strands"],
            g["sides"]["xneg"]["strands"]), flush=True)
    for tag, rd in RENDERS.items():
        for v in ("three_quarter", "profile_90"):
            aid = (np.array(Image.open(str(rd / (v + "-id.png")))
                            .convert("RGBA"))[:, :, 3] >= 230)
            for nm in ("xpos", "xneg"):
                b = out["boxes"]["%s/%s" % (v, nm)]
                r0, r1 = max(b["intRows"][0], 0), min(b["intRows"][1], 1024)
                c0, c1 = max(b["intCols"][0], 0), min(b["intCols"][1], 1024)
                npx = int(aid[r0:r1, c0:c1].sum())
                key = "%s/%s/%s" % (tag, v, nm)
                # far-side boxes are occluded in these views.
                occluded = ((v == "three_quarter" and nm == "xneg")
                            or (v == "profile_90" and nm == "xneg"))
                out["gatesImg"][key] = {"box": [r0, r1, c0, c1],
                                        "hairIDpx": npx,
                                        "occluded": occluded}
                print("IMG %s box[%d:%d,%d:%d]=%d%s" % (
                    key, r0, r1, c0, c1, npx,
                    " (occluded-N/A)" if occluded else ""), flush=True)
    out["hardImgCameraSide"] = (
        out["gatesImg"]["groom29/three_quarter/xpos"]["hairIDpx"] == 0
        and out["gatesImg"]["groom29/profile_90/xpos"]["hairIDpx"] == 0)
    (E / "earlobe29-gate.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE E/earlobe29-gate.json hardImgCameraSide=%s"
          % out["hardImgCameraSide"])


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Ear-gate truth table: for every ear region, ID px + outside-target-mask
px for groom3/cfgG/tuck + target mask px. Regions: front concha boxes,
3q/profile frontLobe + neck boxes, pinna silhouettes, profile band box.
Writes E/eargates.json + prints table."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import ConvexHull as _CH
from scipy.spatial import Delaunay as _DE

ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E4 = ROOT / "tools/openclinxr/evidence/hair-groom4"
E3 = ROOT / "tools/openclinxr/evidence/hair-groom3"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/orient"))
import common_o as CO  # noqa: E402

inp = CO.load_all()
MASKS = {"front": "mask-front.png", "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png"}
SRC = {"groom3": E3 / "renders-studio", "cfgG": E4 / "cfgG/renders1024",
       "tuck": E4 / "renders-studio"}


def pinna_proj(view, side):
    cam = inp["cams"]["views"][view]
    pin = np.asarray(inp["pinna"][side]) / 1000.0
    cc, rr, dd = CO.C2.ENV.project_to_render(pin, cam, inp["sensor"])
    m = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dd > 0))
    return cc, rr, dd, m


def face_sx(view, side, ccol):
    cam = inp["cams"]["views"][view]
    pin = np.asarray(inp["pinna"][side]) / 1000.0
    face = pin.mean(axis=0) + np.array([0, -0.05, 0.0])
    fx, _, _ = CO.C2.ENV.project_to_render(face[None, :], cam,
                                           inp["sensor"])
    return 1.0 if float(fx[0]) - ccol >= 0 else -1.0


out = {}
for view in ("front", "three_quarter", "profile_90"):
    t = np.array(Image.open(SCR / MASKS[view])) > 127
    out[view] = {}
    for tag, d in SRC.items():
        a = np.array(Image.open(d / (view + "-id.png")).convert(
            "RGBA"))[:, :, 3] >= 230
        out[view][tag] = {}
        for side in ("xpos", "xneg"):
            cc, rr, dd, m = pinna_proj(view, side)
            c0, r0 = float(cc[m].mean()), float(rr[m].mean())
            box = (slice(max(int(r0) - 5, 0), int(r0) + 6),
                   slice(max(int(c0) - 5, 0), int(c0) + 6))
            out[view][tag][side + "/concha"] = {
                "id": int(a[box].sum()),
                "out": int((a[box] & ~t[box]).sum())}
            # silhouette hull
            p2 = np.stack([cc[m], rr[m]], axis=1)
            tri = _DE(p2[_CH(p2).vertices])
            c0b, c1b = (max(int(p2[:, 0].min()) - 2, 0),
                        min(int(p2[:, 0].max()) + 3, 1024))
            r0b, r1b = (max(int(p2[:, 1].min()) - 2, 0),
                        min(int(p2[:, 1].max()) + 3, 1024))
            yy, xx = np.nonzero(np.ones((r1b - r0b, c1b - c0b)))
            sub = tri.find_simplex(
                np.stack([xx + c0b, yy + r0b], axis=1)) >= 0
            ins = np.zeros((1024, 1024), dtype=bool)
            ins[r0b:r1b, c0b:c1b][sub.reshape(r1b - r0b,
                                              c1b - c0b)] = True
            out[view][tag][side + "/sil"] = {
                "id": int((a & ins).sum()),
                "out": int(((a & ins) & ~t).sum()),
                "tgt": int((t & ins).sum())}
            # frontLobe + neck boxes (3q/profile only below)
            c0f, c1f = float(cc[m].min()), float(cc[m].max())
            r0f, r1f = float(rr[m].min()), float(rr[m].max())
            h = r1f - r0f
            sx = face_sx(view, side, (c0f + c1f) / 2)
            edge = c0f if sx < 0 else c1f
            fl = sorted([edge, edge + sx * 60.0])
            flr = [r1f - 0.30 * h, r1f]
            nkr = [r1f, r1f + 70.0]
            nkc = [c0f - 25.0, c1f + 25.0]
            for zn, (zc, zr) in (("FL", (fl, flr)), ("NK", (nkc, nkr))):
                bx = (slice(max(int(zr[0]), 0), min(int(zr[1]), 1024)),
                      slice(max(int(zc[0]), 0), min(int(zc[1]), 1024)))
                out[view][tag][side + "/" + zn] = {
                    "id": int(a[bx].sum()),
                    "out": int((a[bx] & ~t[bx]).sum()),
                    "tgt": int((t[bx]).sum())}
    # profile band box (hair-country check)
    if view == "profile_90":
        for tag, d in SRC.items():
            a = np.array(Image.open(d / (view + "-id.png")).convert(
                "RGBA"))[:, :, 3] >= 230
            bx = (slice(350, 420), slice(360, 450))
            out[view][tag]["band"] = {
                "id": int(a[bx].sum()),
                "out": int((a[bx] & ~t[bx]).sum()),
                "tgt": int(t[bx].sum())}

(E4 / "eargates.json").write_text(json.dumps(out, indent=1) + "\n")
for view in ("front", "three_quarter", "profile_90"):
    print("==", view)
    keys = sorted(out[view]["groom3"].keys())
    print("region | " + " | ".join(
        "%s id/out/tgt" % k for k in ("g3", "cfgG", "tuck")))
    for k in keys:
        cells = []
        for tag in ("groom3", "cfgG", "tuck"):
            r = out[view][tag][k]
            cells.append("%d/%d/%d" % (r["id"], r.get("out", -1),
                                       r.get("tgt", -1)))
        print("%-12s %s" % (k, " | ".join(cells)))

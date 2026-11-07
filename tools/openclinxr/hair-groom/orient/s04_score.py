#!/usr/bin/env python3
"""STEP 4: score orient guides (tubes + orientation agreement).

Tubes (3 mm, same raster as route2): visible cover per view via
occluded_union (identity transforms) vs the aisha-v3 masks --
whole-mask and regional (row-thirds of the mask bbox + left/right
halves, stated) boundary p50/p95 excess+miss, plus face guards (0).

Orientation agreement (new primary measure): projected guide tangents
vs each view's 2D orientation map (s01): per 1 mm sample, tangent from
central differences of the projected polyline -> filter-frame angle
a = mod(atan2(-du, dv)) (s02 inverse mapping) vs map angle;
conf-weighted mean absolute angular difference inside the hair mask
(+ unweighted p50/p95, n). Computed identically for route2's guides
(E hair-route2/guides.npz, 41-pt head-mm -> world) as reference.

Output E/score.json.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

S10 = Path(__file__).resolve().parent
sys.path.insert(0, str(S10))
import common_o as CO  # noqa: E402
import measure as ME  # noqa: E402


def orient_agreement(curves_mm, inp, o2):
    """{view: {wmean, p50, p95, n}} conf-weighted agreement.

    Tangents are central differences over a +-3 mm baseline
    (scale-matched to the Gabor bank support: wavelength 4 px,
    sigma 3 px at 1024 ~ 3-6 mm; robust to 1 mm resample jitter).
    Identical code path for both guide sets.
    """
    HALF = 3
    out = {}
    cams, sensor = inp["cams"], inp["sensor"]
    for view in CO.VIEWS4:
        cam = cams["views"][view]
        mask = np.array(o2[view + "/mask"], dtype=bool)
        ang = np.array(o2[view + "/angle"])
        cf = np.array(o2[view + "/conf"])
        diffs, ww = [], []
        for c in curves_mm:
            pts = np.asarray(c, dtype=np.float64) / 1000.0
            if len(pts) < 2 * HALF + 1:
                continue
            cc, rr, dep = CO.C2.ENV.project_to_render(pts, cam,
                                                     sensor)
            du = cc[2 * HALF:] - cc[:-2 * HALF]
            dv = rr[2 * HALF:] - rr[:-2 * HALF]
            mid = np.arange(HALF, len(pts) - HALF)
            ok = ((np.hypot(du, dv) > 1e-9)
                  & (cc[mid] >= 0) & (cc[mid] < 1024)
                  & (rr[mid] >= 0) & (rr[mid] < 1024)
                  & (dep[mid] > 0)
                  & (np.abs(dep[2 * HALF:] - dep[:-2 * HALF])
                     < 0.005))
            if not ok.any():
                continue
            ap = np.mod(np.degrees(np.arctan2(-du[ok], dv[ok])),
                        180.0)
            ci = np.clip(np.rint(cc[mid][ok]).astype(np.int64),
                         0, 1023)
            ri = np.clip(np.rint(rr[mid][ok]).astype(np.int64),
                         0, 1023)
            inmask = mask[ri, ci]
            if not inmask.any():
                continue
            am = ang[ri[inmask], ci[inmask]].astype(np.float64)
            d = np.abs(ap[inmask] - am)
            d = np.minimum(d, 180.0 - d)
            w = cf[ri[inmask], ci[inmask]].astype(np.float64)
            diffs.append(d)
            ww.append(w)
        if not diffs:
            out[view] = {"wmean": None, "p50": None, "p95": None,
                         "n": 0}
            continue
        d = np.concatenate(diffs)
        w = np.concatenate(ww)
        out[view] = {
            "wmean": round(float((w * d).sum() / w.sum()), 2),
            "p50": round(float(np.percentile(d, 50)), 2),
            "p95": round(float(np.percentile(d, 95)), 2),
            "n": int(d.size)}
        print("AGREE %s wmean=%.1f p50=%.1f p95=%.1f n=%d" % (
            view, out[view]["wmean"], out[view]["p50"],
            out[view]["p95"], out[view]["n"]), flush=True)
    return out


def regions_of(mask):
    """Whole + row-thirds of mask bbox + left/right halves."""
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    h = (y1 - y0) / 3.0
    regs = {"whole": np.ones_like(mask)}
    names = ["crown", "mid", "hem"]
    for i, nm in enumerate(names):
        r = np.zeros_like(mask)
        r[int(y0 + i * h):int(y0 + (i + 1) * h), :] = True
        regs[nm] = r
    rl = np.zeros_like(mask)
    rl[:, :(x0 + x1) // 2] = True
    regs["left"] = rl
    regs["right"] = ~rl
    return regs


def regional_scores(fitted, target):
    regs = regions_of(target)
    out = {}
    for name, reg in regs.items():
        f = fitted & reg
        t = target & reg
        if not f.any() or not t.any():
            out[name] = {"excessP50": 0.0, "excessP95": 0.0,
                         "missP50": 0.0, "missP95": 0.0,
                         "empty": True}
            continue
        s = ME.regional_pq(f, t)
        s["empty"] = False
        out[name] = s
    return out


def face_guards(render_cover, inp):
    proj = CO.C2.ENV.project_to_render
    sensor = inp["sensor"]
    cams = inp["cams"]
    crown = np.asarray(inp["crown"])
    fc, fr, _ = proj(np.array([crown, inp["brow"], inp["menton"]]),
                     cams["views"]["front"], sensor)
    pc, pr, _ = proj(np.array([crown, inp["brow"], inp["menton"]]),
                     cams["views"]["profile_90"], sensor)
    landmarks = {
        "front": {"eye_row": float(fr[1]),
                  "chin_row": float(fr[2]),
                  "crown_top_row": float(fr[0]),
                  "face_centre_col": float(fc[2])},
        "profile": {"crown_top_row": float(pr[0]),
                    "chin_row": float(pr[2]),
                    "forehead_front_col": float(pc[1])}}
    guards = CO.C2.INS.guard_definitions(landmarks)
    guards["back"] = {}
    boxes = CO.C2.INS.guard_boxes_render(guards, inp["transforms"])
    refs = CO.C2.INS.face_ref_depths(
        {"brow": inp["brow"], "menton": inp["menton"]}, cams)
    cover3 = {v: render_cover[v] for v in ("front", "profile_90",
                                          "back")}
    return CO.C2.INS.face_guard_depth(cover3, refs, boxes)


def main():
    t0 = time.time()
    CO.track(S10 / "s04_score.py")
    inp = CO.load_all()
    o2 = np.load(str(CO.E0 / "orient2d.npz"))
    G = np.load(str(CO.E0 / "grown.npz"))
    n = len(G["roots_mm"])
    curves = [np.array(G["curves_mm"][j])
              for j in range(n)]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    curves = [c for c in curves if len(c) >= 2]

    R2 = np.load(str(CO.track(
        CO.ROOT / "tools/openclinxr/evidence/hair-route2/guides.npz")))
    r2crown = np.array(R2["crown"], dtype=np.float64)
    r2curves = [ME.resample_1mm(
        CO.head_to_world(np.array(R2["curves_head"][j]),
                         r2crown) * 1000.0)
        for j in range(len(R2["curves_head"]))]
    curves = [ME.resample_1mm(c) for c in curves]
    print("GUIDES orient=%d route2=%d" % (len(curves),
                                          len(r2curves)), flush=True)

    body_maps = {v: (np.array(inp["body"][v]["cover"], dtype=bool),
                     np.array(inp["body"][v]["depth"],
                              dtype=np.float64))
                 for v in CO.VIEWS4}
    score = {"nOrient": len(curves), "nRoute2": len(r2curves)}
    for tag, cc in (("orient", curves), ("route2", r2curves)):
        rc = ME.tube_raster4(cc, inp)
        union = ME.occluded_union(rc, body_maps, inp["transforms"])
        reg = {}
        for view in CO.VIEWS4:
            tgt = np.array(inp["masks"][view], dtype=bool)
            reg[view] = regional_scores(union[view], tgt)
        score[tag + "Regional"] = reg
        score[tag + "FaceGuards"] = face_guards(rc, inp)
        print("%s faceCoveredPx=%d" % (
            tag, score[tag + "FaceGuards"]["totalCoveredPx"]),
            flush=True)
        for view in CO.VIEWS4:
            w = reg[view]["whole"]
            print("%s %s whole p50 %.1f/%.1f p95 %.1f/%.1f" % (
                tag, view, w["excessP50"], w["missP50"],
                w["excessP95"], w["missP95"]), flush=True)

    print("--- orientation agreement: orient guides ---", flush=True)
    score["orientAgree"] = orient_agreement(curves, inp, o2)
    print("--- orientation agreement: route2 guides ---", flush=True)
    score["route2Agree"] = orient_agreement(r2curves, inp, o2)

    CO.E0.mkdir(parents=True, exist_ok=True)
    (CO.E0 / "score.json").write_text(
        json.dumps(score, indent=1) + "\n")
    CO.write_inputs_log([S10 / "s04_score.py", CO.E0 / "score.json"])
    print("STEP4 done in %.0fs" % (time.time() - t0), flush=True)


if __name__ == "__main__":
    main()

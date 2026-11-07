#!/usr/bin/env python3
"""Evidence-only: STEP 4 split-hem consistency (target-inconsistency test).

Separate profile-only fits already exist (E/fit-split-curtain.json,
E/fit-split-back.json: hem params fitted against the target profile rays).
This script measures the TARGET-side disagreement: the front-view target
curtain-hem ray and the back-view target hem ray (rule-based hem pixels,
mirroring the split_hem_rays anterior/posterior-band rule), and the 3D
distance from each separately-fitted hem endpoint to the OTHER view's ray:
  D_curtain = dist(profile-fitted curtain end, front curtain ray)
  D_back    = dist(profile-fitted back end, back hem ray)
> 30 mm on either -> STOP (the target views are mutually inconsistent).
Triangulated hem points (front x profile, back x profile rays) are
reported as a print-only cross-check. Writes E/split-hem.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/cage"))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import cage as CAGE  # noqa: E402
import instruments as INS  # noqa: E402
from PIL import Image  # noqa: E402

OPENED = []


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def hem_pixel_band(mask, c0, c1):
    cc = np.arange(INS.FRAME)
    inband = (cc >= c0) & (cc < c1)
    sub = mask[:, inband]
    rr, _ = np.nonzero(sub)
    if rr.size == 0:
        return None
    top = rr.max() - 5
    sel = sub & (np.arange(INS.FRAME)[:, None] >= top)
    pr, pc = np.nonzero(sel)
    hem_row = float(pr.max())
    band_cols = np.nonzero(inband)[0]
    hem_col = float(np.median(band_cols[pc[pr == pr.max()]]))
    return hem_row, hem_col


def ray_for(cams, transforms, view, pixel):
    t = transforms[view]
    s = float(t["scale"])
    rc = (pixel[1] - float(t["tx"])) / s
    rr = (pixel[0] - float(t["ty"])) / s
    origin, direction = INS.pixel_ray(
        cams["views"][view], rc, rr, INS.sensor_of(cams))
    return np.array(origin), np.array(direction)


def dist_point_ray(pt, origin, direction):
    rel = np.asarray(pt) - np.asarray(origin)
    along = float(rel @ direction)
    return float(np.linalg.norm(rel - along * np.asarray(direction)))


def closest_between(o1, d1, o2, d2):
    """Closest points on two rays + their distance (mm given metres in)."""
    w0 = o1 - o2
    a, b, c = float(d1 @ d1), float(d1 @ d2), float(d2 @ d2)
    d, e = float(d1 @ w0), float(d2 @ w0)
    denom = a * c - b * b
    if abs(denom) < 1e-12:
        return None
    s = (b * e - c * d) / denom
    t = (a * e - b * d) / denom
    p1, p2 = o1 + s * d1, o2 + t * d2
    return p1, p2, float(np.linalg.norm(p1 - p2))


def main():
    for name in ("cage.py", "instruments.py"):
        track(ROOT / "tools/openclinxr/hair-groom/cage" / name)
    manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                           / "aisha_straight_long.json").read_text())
    cams = INS.load_cameras(str(track(ROOT / manifest["camerasFile"][
        "path"])))
    transforms = INS.transforms_of(cams)
    land = json.loads(track(Path(manifest["targets"]["landmarks"][
        "path"])).read_text())
    masks = {}
    for v, f in (("front", "mask-front-v2.png"),
                 ("profile_90", "mask-profile-v2.png"),
                 ("back", "mask-back-v3.png")):
        p = track(Path("/Users/patrick/.grok/worktrees/src-openclinxr/"
                       "hair-judge/tools/openclinxr/evidence/hair-judge/"
                       "target-set-back/" + f))
        masks[v] = np.asarray(Image.open(p).convert("L")) > 127
    regions = INS.region_definitions(land)
    split = json.loads(track(E / "split-rays.json").read_text())

    # front curtain hem: lowest-5-row median in each side-curtain box,
    # averaged (mirrors the profile anterior-band rule in spirit)
    front_px = []
    for box in (regions["front"]["side_curtain_L"],
                regions["front"]["side_curtain_R"]):
        r0, r1, c0, c1 = box
        got = hem_pixel_band(masks["front"], max(int(c0), 0), int(c1))
        if got is not None and got[0] >= r0:
            front_px.append(got)
    front_hem = (float(np.mean([p[0] for p in front_px])),
                 float(np.mean([p[1] for p in front_px])))
    # back hem: lowest-5-row median col over the central mass
    cols = np.nonzero(masks["back"].any(axis=0))[0]
    c0b, c1b = float(cols.min()), float(cols.max()) + 1
    back_hem = hem_pixel_band(masks["back"], c0b, c1b)

    o_f, d_f = ray_for(cams, transforms, "front", front_hem)
    o_b, d_b = ray_for(cams, transforms, "back", back_hem)
    o_pc, d_pc = (np.array(split["curtain"]["rayOriginM"]),
                  np.array(split["curtain"]["rayDir"]))
    o_pb, d_pb = (np.array(split["back"]["rayOriginM"]),
                  np.array(split["back"]["rayDir"]))

    fit_c = json.loads(track(E / "fit-split-curtain.json").read_text())
    fit_b = json.loads(track(E / "fit-split-back.json").read_text())
    end_c = np.array(fit_c["endM"])
    end_b = np.array(fit_b["endM"])

    d_curt = dist_point_ray(end_c, o_f, d_f)
    d_back = dist_point_ray(end_b, o_b, d_b)
    tri_c = closest_between(o_f, d_f, o_pc, d_pc)
    tri_b = closest_between(o_b, d_b, o_pb, d_pb)
    payload = {
        "frontCurtainHemPixel": [round(float(v), 1) for v in front_hem],
        "backHemPixel": [round(float(v), 1) for v in back_hem],
        "profileCurtainEndM": [round(float(v), 4) for v in end_c],
        "profileBackEndM": [round(float(v), 4) for v in end_b],
        "distCurtainEndToFrontRayMm": round(d_curt * 1000.0, 1),
        "distBackEndToBackRayMm": round(d_back * 1000.0, 1),
        "triangulatedCurtainM": [round(float(v), 4) for v in
                                 ((tri_c[0] + tri_c[1]) / 2)]
        if tri_c else None,
        "triangulationGapCurtainMm": round(tri_c[2] * 1000.0, 1)
        if tri_c else None,
        "triangulatedBackM": [round(float(v), 4) for v in
                              ((tri_b[0] + tri_b[1]) / 2)]
        if tri_b else None,
        "triangulationGapBackMm": round(tri_b[2] * 1000.0, 1)
        if tri_b else None,
        "thresholdMm": 30.0,
        "stop": bool(max(d_curt, d_back) * 1000.0 > 30.0),
    }
    (E / "split-hem.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print("SPLITHEM curtain-to-front-ray %.1f mm, back-to-back-ray %.1f mm"
          % (d_curt * 1000.0, d_back * 1000.0), flush=True)
    print("SPLITHEM triangulated curtain %s gap %.1f mm" % (
        payload["triangulatedCurtainM"],
        payload["triangulationGapCurtainMm"] or -1), flush=True)
    print("SPLITHEM triangulated back %s gap %.1f mm" % (
        payload["triangulatedBackM"],
        payload["triangulationGapBackMm"] or -1), flush=True)
    print("SPLITHEM_%s" % ("STOP" if payload["stop"] else "CONSISTENT"),
          flush=True)
    CAGE.append_inputs(E, OPENED)


if __name__ == "__main__":
    main()

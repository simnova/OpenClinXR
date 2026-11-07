#!/usr/bin/env python3
"""Three-quarter target registration from independently located landmarks.

Fits ONE bounded similarity transform, target frame -> render frame,
    p_r = scale * p_t + t
(scale + 2D translation; in-plane rotation is fixed at 0 degrees so the
stored form matches the station register.py model exactly), by ordinary
least squares over all six observed landmark pairs. Bounds: scale in
[0.5, 2.0] (a fit outside the bounds is rejected as INSUFFICIENT).

Gate: p95 of per-landmark residuals (target-frame px) <= 8 px.
  - PASS: writes registration-3q.json with status REGISTERED plus the
    inverted render->target transform in the same schema as the other
    station views (renderTriple / targetTriple / transform{scale,tx,ty} /
    residuals / renderH / targetH). The frame-3q.png overlay (registered
    target mask over the 3/4 beauty) is then rendered as a separate
    Blender step.
  - FAIL: writes registration-3q.json with status
    REGISTRATION_INSUFFICIENT, per-landmark residuals and p95, and NO
    transform key. The station must not carve the 3/4 view from it.

Usage: register3q.py <outdir>

Deterministic: pinned landmark constants, sorted keys, no timestamps.
Pure NumPy + stdlib: imports nothing from the repo and reads no files.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

FRAME = 1024
GATE_P95_PX = 8.0
SCALE_LO, SCALE_HI = 0.5, 2.0
ROTATION_DEG = 0.0  # fixed; station model has no rotation term

# (name, render(col,row) from pinned 3/4 Blender projection,
#  target(col,row) from detector + mask apex). Column 0 = left.
PAIRS = (
    ("crown/skull_top", (430.2980651855469, 111.48809814453125), (527.50, 129.00)),
    ("menton/chin", (288.5628356933594, 578.5343017578125), (451.98, 569.51)),
    ("nose_tip", (228.26829528808594, 415.97869873046875), (421.19, 431.81)),
    ("philtrum", (248.85519409179688, 453.30438232421875), (436.55, 488.26)),
    ("acromion", (817.9437255859375, 815.2571563720703), (739.20, 711.11)),
    ("shoulder/neck_base", (512.00, 650.4205627441406), (560.72, 716.485)),
)

PROVENANCE = {
    "targetImage": "target-three_quarter.png",
    "targetSha256": "7c05831a88e478abebf6f0cbf8060e1982e1e8179e9efb2aff72b90e26bc7022",
    "targetMask": "mask-three_quarter.png",
    "targetMaskSha256": "9d25c81aebd6a8fa5665a457b28c94ad4b13c0b562a02e2d6c147c348cad6fd3",
    "detector": "MediaPipe tasks FaceLandmarker + PoseLandmarker, mediapipe 1.1.1 (Apache-2.0)",
    "faceBundleSha256": "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    "poseBundleSha256": "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    "bodyId": "mpfb-peds-parent-aisha",
    "bodySha256": "5cab66767a6bec8cb22d4d021ccccc416955f8f617fdc243d38d56e17f185dde",
    "rotationDeg": ROTATION_DEG,
    "scaleBounds": [SCALE_LO, SCALE_HI],
    "gateP95Px": GATE_P95_PX,
}


def fit_target_to_render():
    """Least squares p_r = s * p_t + t over all pairs. Returns (s, tx, ty)."""
    rows, rhs = [], []
    for _, (ru, rv), (tu, tv) in PAIRS:
        rows.append((tu, 1.0, 0.0))
        rhs.append(ru)
        rows.append((tv, 0.0, 1.0))
        rhs.append(rv)
    sol, _, _, _ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
    return float(sol[0]), float(sol[1]), float(sol[2])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("outdir")
    parser.add_argument("--camera", action="store_true",
                        help="solve the target 3/4 perspective camera (3qb)")
    args = parser.parse_args()
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    if args.camera:
        sys.exit(main_camera(outdir))

    s, tx, ty = fit_target_to_render()
    bounded = bool(SCALE_LO <= s <= SCALE_HI)

    per, mags = [], []
    for name, (ru, rv), (tu, tv) in PAIRS:
        mu, mv = s * tu + tx, s * tv + ty
        du, dv = mu - ru, mv - rv
        mag = float(np.hypot(du, dv))
        mags.append(mag / s)  # target-frame px (station frame)
        per.append({"pair": name, "dx_render_px": du, "dy_render_px": dv,
                    "resid_render_px": mag, "resid_target_px": mag / s})
    p95 = float(np.percentile(np.array(mags), 95))

    base = {
        "schemaVersion": "openclinxr.hair-groom.register3q.v1",
        "frame": FRAME,
        "view": "three_quarter",
        "provenance": PROVENANCE,
        "pairs": [{"pair": name,
                   "render": [ru, rv], "target": [tu, tv]}
                  for name, (ru, rv), (tu, tv) in PAIRS],
        "fitTargetToRender": {"scale": s, "tx": tx, "ty": ty,
                              "scaleBounded": bounded},
        "perLandmark": per,
        "p95TargetPx": p95,
        "maxTargetPx": float(max(mags)),
    }

    if bounded and p95 <= GATE_P95_PX:
        s_inv = 1.0 / s
        transform = {"scale": s_inv, "tx": -tx * s_inv, "ty": -ty * s_inv}
        a_r, b_r = PAIRS[0][1][1], PAIRS[1][1][1]
        c_r = 288.5628356933594  # render face-centre col
        a_t, b_t = PAIRS[0][2][1], PAIRS[1][2][1]
        c_t = (421.19 + 436.55 + 451.98) / 3.0  # target centre-line col
        base["status"] = "REGISTERED"
        base["renderTriple"] = [a_r, b_r, c_r]
        base["targetTriple"] = [a_t, b_t, c_t]
        base["transform"] = transform
        base["renderH"] = float(b_r - a_r)
        base["targetH"] = float(b_t - a_t)
        print("REGISTERED p95=%.2fpx" % p95, flush=True)
    else:
        base["status"] = "REGISTRATION_INSUFFICIENT"
        base["reason"] = ("p95 %.2fpx exceeds gate %.2fpx" % (p95, GATE_P95_PX)
                          if bounded else
                          "scale %.4f outside bounds %s" % (s, [SCALE_LO, SCALE_HI]))
        # No transform key by design: the station must not carve 3/4 from this.
        print("REGISTRATION_INSUFFICIENT p95=%.2fpx" % p95, flush=True)

    (outdir / "registration-3q.json").write_text(
        json.dumps(base, indent=2, sort_keys=True) + "\n"
    )


# ---------------------------------------------------------------------------
# 3qb: target three-quarter perspective-camera solve.
#
# The 2D similarity (above) is INSUFFICIENT for the 3/4 view: the target was
# taken from a camera turned noticeably less than the pinned 45-degree
# three_quarter camera (nose-tip vs skull-top offset ~106 px in target vs
# ~202 px in the pinned render), so no 2D similarity can align them. This
# section solves the target's 3/4 camera pose instead: yaw about the
# vertical axis through the head, pitch, distance, and image-plane
# translation, lens fixed at the scorer's 50 mm / 36 mm sensor as pinned.
# A free-focal variant is tried as a residual check (reported, not stored).
# HEAD-ONLY (crown, menton, nose, philtrum) is fitted as a check against
# body-proportion mismatch. scipy least_squares, starts across yaw 0-60 deg.
# Deterministic: pinned constants, fixed start grid, sorted keys.
# ---------------------------------------------------------------------------

CAM_LENS_MM = 50.0
CAM_SENSOR_MM = 36.0
# Scorer fixation: front/profile/three_quarter view dirs meet at
# (0, 0, 1.4735846981706866) (from cameras-scorer-v3.json matrixWorld).
CAM_FIXATION = (0.0, 0.0, 1.4735846981706866)

# Matching 3D MPFB Aisha points (projected-3q.json point3d, body sha 5cab..).
P3D = {
    "crown": (1.1403722410818773e-09, -0.053241077810525894, 1.6599169969558716),
    "menton": (9.141150059122083e-10, -0.1348039209842682, 1.4492578506469727),
    "nose_tip": (2.1785400150520218e-09, -0.16444358229637146, 1.517953634262085),
    "philtrum": (-1.305282104624439e-08, -0.1545179933309555, 1.502658724784851),
    "acromion": (0.18937425315380096, -0.019576245918869972, 1.3607940673828125),
    "neck_base": (0.0, 0.0, 1.4050170183181763),
}

CAM_PAIRS = (
    ("crown", (527.50, 129.00)),
    ("menton", (451.98, 569.51)),
    ("nose_tip", (421.19, 431.81)),
    ("philtrum", (436.55, 488.26)),
    ("acromion", (739.20, 711.11)),
    ("neck_base", (560.72, 716.485)),
)
CAM_HEAD_IDX = (0, 1, 2, 3)
CAM_ALL_IDX = (0, 1, 2, 3, 4, 5)
CAM_START_YAWS = (5.0, 15.0, 25.0, 35.0, 45.0, 55.0)
CAM_START_PITCHS = (-2.0, 2.0, 5.0)
CAM_START_DISTS = (0.6, 0.7, 0.9)

CAM_PROVENANCE = {
    "targetImage": "target-three_quarter.png",
    "targetSha256": "7c05831a88e478abebf6f0cbf8060e1982e1e8179e9efb2aff72b90e26bc7022",
    "bodyId": "mpfb-peds-parent-aisha",
    "bodySha256": "5cab66767a6bec8cb22d4d021ccccc416955f8f617fdc243d38d56e17f185dde",
    "bodyPoints": "tools/openclinxr/evidence/hair-reg3q/projected-3q.json point3d",
    "camerasPin": "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json",
    "lensMm": CAM_LENS_MM,
    "sensorWidthMm": CAM_SENSOR_MM,
    "fixation": list(CAM_FIXATION),
    "focalSolved": False,
    "gateP95Px": GATE_P95_PX,
}


def _cam_project(params, pts3, lens_mm=CAM_LENS_MM):
    """Perspective projection for orbit params (yaw,pitch,dist,tx,ty)."""
    yaw, pitch, dist, tx, ty = (float(params[0]), float(params[1]),
                               float(params[2]), float(params[3]),
                               float(params[4]))
    yw = math.radians(yaw)
    pi = math.radians(pitch)
    u = np.array([math.sin(yw) * math.cos(pi),
                  -math.cos(yw) * math.cos(pi),
                  math.sin(pi)])
    loc = np.array(CAM_FIXATION) + dist * u
    zcol = u
    xcol = np.cross(np.array([0.0, 0.0, 1.0]), zcol)
    xcol = xcol / np.linalg.norm(xcol)
    ycol = np.cross(zcol, xcol)
    rmat = np.column_stack([xcol, ycol, zcol])
    out = []
    for p in pts3:
        q = rmat.T @ (np.array(p) - loc)
        xn = float(q[0] / (-q[2]))
        yn = float(q[1] / (-q[2]))
        col = (0.5 + xn * (lens_mm / CAM_SENSOR_MM)) * FRAME + tx
        row = (0.5 - yn * (lens_mm / CAM_SENSOR_MM)) * FRAME + ty
        out.append((col, row))
    # location + rotation (columns X,Y,Z) for the camera record
    mat = np.eye(4)
    mat[:3, :3] = rmat
    mat[:3, 3] = loc
    return out, loc, mat


def _cam_residuals(params, idx, lens_mm=CAM_LENS_MM):
    from scipy.optimize import least_squares  # noqa: F401 (ensures dep)
    pts3 = [P3D[CAM_PAIRS[i][0]] for i in idx]
    pred, _, _ = _cam_project(params, pts3, lens_mm=lens_mm)
    res = []
    for (c, r), i in zip(pred, idx):
        tu, tv = CAM_PAIRS[i][1]
        res.append(c - tu)
        res.append(r - tv)
    return np.array(res)


def fit_camera_idx(idx, lens_mm=CAM_LENS_MM):
    """Least-squares orbit fit over start grid. Returns (params, cost)."""
    from scipy.optimize import least_squares
    best = None
    for y0 in CAM_START_YAWS:
        for p0 in CAM_START_PITCHS:
            for d0 in CAM_START_DISTS:
                x0 = np.array([y0, p0, d0, 0.0, 0.0])
                sol = least_squares(
                    lambda p: _cam_residuals(p, idx, lens_mm=lens_mm),
                    x0,
                    bounds=([0.0, -10.0, 0.3, -300.0, -300.0],
                            [60.0, 20.0, 2.0, 300.0, 300.0]),
                    max_nfev=5000, ftol=1e-10, xtol=1e-10,
                )
                cost = float(np.sum(sol.fun ** 2))
                if best is None or cost < best[0]:
                    best = (cost, np.array(sol.x, dtype=float))
    return best[1], best[0]


def camera_mags(params, idx, lens_mm=CAM_LENS_MM):
    pts3 = [P3D[CAM_PAIRS[i][0]] for i in idx]
    pred, _, _ = _cam_project(params, pts3, lens_mm=lens_mm)
    mags, per = [], []
    for (c, r), i in zip(pred, idx):
        name = CAM_PAIRS[i][0]
        tu, tv = CAM_PAIRS[i][1]
        mag = float(math.hypot(c - tu, r - tv))
        mags.append(mag)
        per.append({"pair": name, "pred": [c, r], "target": [tu, tv],
                    "dx_px": c - tu, "dy_px": r - tv, "resid_px": mag})
    p95 = float(np.percentile(np.array(mags), 95))
    return mags, p95, per, pred


def main_camera(outdir):
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    fits = {}
    for label, idx in (("all", CAM_ALL_IDX), ("headOnly", CAM_HEAD_IDX)):
        params, cost = fit_camera_idx(idx)
        mags, p95, per, _ = camera_mags(params, idx)
        _, loc, mat = _cam_project(params,
                                   [P3D[CAM_PAIRS[i][0]] for i in idx])
        fits[label] = {
            "params": {"yawDeg": float(params[0]), "pitchDeg": float(params[1]),
                       "distanceM": float(params[2]),
                       "txPx": float(params[3]), "tyPx": float(params[4])},
            "location": [float(v) for v in loc],
            "cost": cost,
            "perLandmark": per,
            "p95Px": p95,
            "maxPx": float(max(mags)),
        }
        print("CAMFIT %s yaw=%.2f pitch=%.2f dist=%.4f tx=%.1f ty=%.1f "
              "p95=%.2fpx" % (label, params[0], params[1], params[2],
                              params[3], params[4], p95), flush=True)
    # Free-focal check (reported only, never stored).
    from scipy.optimize import least_squares
    free = {}
    for label, idx in (("all", CAM_ALL_IDX), ("headOnly", CAM_HEAD_IDX)):
        best = None
        for y0 in CAM_START_YAWS:
            x0 = np.array([y0, 2.0, 0.7, 0.0, 0.0, CAM_LENS_MM])

            def _res(p, _idx=idx):
                pts3 = [P3D[CAM_PAIRS[i][0]] for i in _idx]
                pred, _, _ = _cam_project(p[:5], pts3, lens_mm=float(p[5]))
                res = []
                for (c, r), i in zip(pred, _idx):
                    tu, tv = CAM_PAIRS[i][1]
                    res += [c - tu, r - tv]
                return np.array(res)

            sol = least_squares(
                _res, x0,
                bounds=([0.0, -10.0, 0.3, -300.0, -300.0, 30.0],
                        [60.0, 20.0, 2.0, 300.0, 300.0, 80.0]),
                max_nfev=8000, ftol=1e-10, xtol=1e-10)
            cost = float(np.sum(sol.fun ** 2))
            if best is None or cost < best[0]:
                best = (cost, np.array(sol.x, dtype=float))
        cost, p = best
        _, p95, _, _ = camera_mags(p[:5], idx, lens_mm=float(p[5]))
        free[label] = {"lensMm": float(p[5]), "p95Px": p95, "cost": cost}
        print("CAMFIT_FREEFOCAL %s lens=%.2f p95=%.2fpx" %
              (label, p[5], p95), flush=True)

    passed = {k: v["p95Px"] <= GATE_P95_PX for k, v in fits.items()}
    verdict = "REGISTERED" if any(passed.values()) else \
        "REGISTRATION_INSUFFICIENT"
    winner = ("all" if passed.get("all") else
              "headOnly" if passed.get("headOnly") else None)

    record = {
        "schemaVersion": "openclinxr.hair-groom.register3qb.v1",
        "frame": FRAME,
        "view": "three_quarter",
        "status": verdict,
        "provenance": CAM_PROVENANCE,
        "fits": fits,
        "freeFocalCheck": free,
        "gateP95Px": GATE_P95_PX,
        "pass": passed,
    }
    if winner is not None:
        w = fits[winner]
        tx, ty = w["params"]["txPx"], w["params"]["tyPx"]
        _, _, mat = _cam_project(
            [w["params"]["yawDeg"], w["params"]["pitchDeg"],
             w["params"]["distanceM"], tx, ty],
            [P3D[CAM_PAIRS[i][0]] for i in
             (CAM_ALL_IDX if winner == "all" else CAM_HEAD_IDX)])
        cam = {
            "sensorWidthMm": CAM_SENSOR_MM,
            "views": {
                "target_three_quarter": {
                    "lensMm": CAM_LENS_MM,
                    "location": w["location"],
                    "matrixWorld": mat.tolist(),
                    "shiftX": tx / FRAME,
                    "shiftY": -ty / FRAME,
                    "translationPx": [tx, ty],
                }
            },
            "source": {
                "schemaVersion": "openclinxr.hair-score.v3",
                "fit": winner,
                "params": w["params"],
                "p95Px": w["p95Px"],
            },
        }
        (outdir / "camera-target3q.json").write_text(
            json.dumps(cam, indent=2, sort_keys=True) + "\n")
        record["cameraFile"] = "camera-target3q.json"
        record["cameraView"] = "target_three_quarter"
        print("REGISTERED via %s p95=%.2fpx" % (winner, w["p95Px"]),
              flush=True)
    else:
        best_all = fits["all"]["p95Px"]
        best_head = fits["headOnly"]["p95Px"]
        record["reason"] = ("p95 all %.2fpx / head-only %.2fpx exceed gate "
                            "%.2fpx; lens fixed at %.1fmm (free-focal check: "
                            "all %.2fpx @ %.2fmm, head %.2fpx @ %.2fmm "
                            "- no help)" % (
                                best_all, best_head, GATE_P95_PX,
                                CAM_LENS_MM, free["all"]["p95Px"],
                                free["all"]["lensMm"],
                                free["headOnly"]["p95Px"],
                                free["headOnly"]["lensMm"]))
        print("REGISTRATION_INSUFFICIENT all p95=%.2fpx head p95=%.2fpx" %
              (best_all, best_head), flush=True)
    (outdir / "registration-3qb.json").write_text(
        json.dumps(record, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

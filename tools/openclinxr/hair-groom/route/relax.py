"""hair-route1 S7: continuous relaxation of routed guides.

Input: route0 E/paths.npz (discrete minimum-cost voxel paths).
For each routed path, fit a cubic B-spline (8-14 control points,
root fixed on the scalp, end within its endpoint band) by least
squares minimising integrated squared curvature + squared distance
to the routed path (weight decaying so it guides, not pins) +
a penalty for leaving the eroded hull (hull SDF from the occupancy,
trilinear) + body clearance >= 3 mm (exact SDF).

Stages (--step):
  spec      freeze E/route-spec.json + E/spec-sha-before-relax.txt
  relax     per-guide B-spline fit (warm-started, decaying data
            weight, adaptive curvature escalation) + acceptance
            -> E/paths.npz
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.optimize import minimize

import common as C

S7 = Path(__file__).resolve().parent
E = C.ROOT / "tools/openclinxr/evidence/hair-route1"
E0 = C.E  # route0 evidence (read-only input)

R0_SPEC_SHA = "db7706df6109a5b3895828bcf84625cfed7ada0f1f424d395ba20d82bf04a9de"


def spec_dict():
    return {
        "method": "continuous relaxation of route0 discrete voxel "
                  "paths: one cubic clamped B-spline per guide, "
                  "least-squares fit to its own routed path with "
                  "decaying data weight (guides, not pins) + "
                  "curvature + eroded-hull + body-clearance penalties",
        "input": "hair-route0/paths.npz (359 routed voxel paths, "
                 "route0 spec sha %s)" % R0_SPEC_SHA,
        "spline": "cubic clamped uniform-knot B-spline; per-guide "
                  "model selection inside 8-14 control points "
                  "(length-based n = clip(round(L/30),8,14), then 14 "
                  "on failure); root control point fixed at the "
                  "scalp root; end control point free but accepted "
                  "only inside its endpoint band (same x-sign rule "
                  "as route0, z within [zmin-5, zmin+25] of its "
                  "sector band, end displacement <= 15 mm from the "
                  "routed end)",
        "ladder": "per guide, first candidate passing BOTH max-turn "
                  "5mm <= 15 deg AND containment wins: (a) warm fit "
                  "at w_curv=0.2, (b) curvature escalation 0.5/1.0/"
                  "2.0/4.0/8.0, (c) cold restart from the routed init at 4x "
                  "hull/body penalties, (d) escalation again; (c)-(d) "
                  "repeat at nc=14. Stiffer fits land in smoother "
                  "basins that thread narrow corridors (measured: "
                  "guide 23 fails warm at hull-frac 0.944-0.949 and "
                  "passes cold4x/nc14/wc2.0 with turn 5.4; guide 8 "
                  "root-overshoot kink needs wc4.0 for turn 13.6).",
        "samples": "M=200 arc-uniform samples per guide for data + "
                   "penalty evaluation",
        "objective": "J = w_curv*sum||d2C||^2 + w_data*mean||S-R||^2 "
                     "+ w_end*||S_end-R_end||^2 + "
                     "w_hull*mean(relu(3-hullSDF)^2) + "
                     "w_rind*mean(relu(5-hullSDF)^2) + "
                     "w_body*mean(relu(3-bodySDF)^2); d2C = second "
                     "differences of free control points (integrated "
                     "squared curvature proxy); hullSDF = occupancy "
                     "distance-transform inside-minus-outside (2 mm "
                     "grid, trilinear); bodySDF = cage exact SDF "
                     "(trilinear); hull/body penalties evaluated "
                     "beyond the root leader only (first 3% of "
                     "samples); the end anchor keeps the free end "
                     "control point inside its endpoint band; the "
                     "rind term (same field, margin 5, small weight) "
                     "is route0's bndterm carried into continuous "
                     "form: it enters at the cold retry (not the base "
                     "fit: in the base fit it cost easy guides 2-4 "
                     "deg of turn margin) and steers corner-cutting "
                     "inward before the hard 3 mm floor is reached",
        "weights": {"w_curv": 0.2, "w_data_stages": [50.0, 20.0, 8.0],
                    "w_end": 200.0, "w_end_retry_scale": 10.0,
                    "w_hull": 10000.0, "w_rind": 2000.0,
                    "w_body": 100000.0,
                    "hull_margin_mm": 3.0, "rind_margin_mm": 5.0,
                    "body_margin_mm": 3.0,
                    "lbfgs_maxiter_per_stage": 120,
                    "penalty_retry_scale": 4.0},
        "weight_note": "w_data decays 50 -> 20 -> 8 across three "
                       "warm-started L-BFGS-B stages (maxiter 120 each): "
                       "early stages pull the spline onto the routed "
                       "corridor, the final stage (w_data=8) lets "
                       "curvature + clearance shape the path. w_curv "
                       "starts 0.2 and escalates per guide (0.5, 1.0, "
                       "2.0) only while max-turn-5mm > 15 deg. w_body "
                       "10x w_hull because body penetration is the "
                       "hard veto. Calibration: w_hull=500 / "
                       "w_body=5000 gave 39% marginal containment "
                       "fallbacks; 2000/20000 still left hull-frac "
                       "0.91-0.94, body-min 2.7-2.9, plus free-end "
                       "drift (end-sign flips, end-z slab exits). So "
                       "penalties went to 10000/100000 (mean-diluted "
                       "local dips of 0.1-0.5 mm need stiffness, not "
                       "guidance), a w_end=200 tip anchor was added "
                       "to hold ends in-band, and failing guides are "
                       "refit once at 4x penalties. Two stronger "
                       "repairs were tried and dropped: post-hoc local "
                       "re-pinning of violating spans reintroduced "
                       "kinks (turn 19-45 deg), corridor-aware "
                       "pre-masking (x30 data weight where the routed "
                       "path runs within 4 mm of a margin) traded "
                       "smoothness for containment globally (turn up "
                       "to 43 deg), entry data taper freed the "
                       "attachment kink but cut through the rind, "
                       "leader reconstruction (straight root-to-"
                       "mouth entry) ran away (deviation 19-28 mm), "
                       "and raising final data 8->16 ate the smooth- "
                       "ness margin of easy guides (turn 13.8-14.6) "
                       "while fixing 1/5 hard ones. The ladder above "
                       "replaces all of them: model selection over "
                       "(nc, penalty scale, w_curv) with the dual "
                       "pass criterion, plus a w_rind term (margin 5, "
                       "route0 bndterm in continuous form) that fixed "
                       "boundary-grazer exits at warm level (guides "
                       "16/67 pass with turn ~11), plus a x10 end-"
                       "anchor retry for end-sign/slab exits. "
                       "The >= 3 mm body margin therefore "
                       "lives in the penalty + report; accept keeps "
                       "route0 thresholds. Weights frozen in this "
                       "spec before the run; sha asserted by every "
                       "step.",
        "accept": "route0 containment unchanged (routed arc beyond the "
                  "first 8 mm inside hull occupancy, exact-SDF > 0, "
                  "hullSDF >= 3.0 arc fraction >= 0.95, leader "
                  "exact-SDF > -1 mm) plus root fixed and end inside "
                  "its endpoint band (same x-sign rule with route0's "
                  "2 mm excursion tolerance: opposite-side tip "
                  "excursions <= 2 mm are midline-voxel dust, not "
                  "part crossings; all five route0 midline-tip guides "
                  "route to x=0.00 voxels, z within "
                  "[zmin-5, zmin+25], displacement <= 15 mm). The "
                  "3.0 mm body margin lives in the penalty and in "
                  "the reported body-clearance distribution, not in "
                  "accept: calibration showed strict "
                  "min-body >= 3.0 forcing either containment "
                  "zigzags or smoothness loss in narrow corridors, "
                  "while the card gates GATES_PASS on smoothness + "
                  "flow + route0 routing gates. Guides that fail "
                  "after escalation keep the route0 curve with "
                  "status fallback (counted, breaks smoothness gates "
                  "openly rather than silently)",
        "tube_r_mm": 3.0,
    }


def sha_of_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def write_inputs_log(extra=()):
    E.mkdir(parents=True, exist_ok=True)
    seen = set()
    dest = E / "inputs-opened.txt"
    if dest.exists():
        seen.update(dest.read_text().splitlines())
    seen.update(C.OPENED)
    seen.update(str(Path(p).resolve()) for p in extra)
    dest.write_text("\n".join(sorted(seen)) + "\n")


def step_spec():
    E.mkdir(parents=True, exist_ok=True)
    spec = spec_dict()
    C.track(S7 / "relax.py")
    (E / "route-spec.json").write_text(json.dumps(spec, indent=1) + "\n")
    sha = sha_of_file(E / "route-spec.json")
    (E / "spec-sha-before-relax.txt").write_text(sha + "\n")
    print("SPEC_SHA %s" % sha, flush=True)
    write_inputs_log([S7 / "relax.py", E / "route-spec.json"])
    return sha


# ------------------------------------------------------------ field helpers
def build_hull_sdf(occ, spacing):
    d_in = ndimage.distance_transform_edt(occ).astype(np.float64) * spacing
    d_out = ndimage.distance_transform_edt(~occ).astype(np.float64) * spacing
    return d_in - d_out


def trilinear(grid, origin, h, pts):
    pts = np.asarray(pts, dtype=np.float64)
    idx = (pts - origin) / h
    nx, ny, nz = grid.shape
    inside = ((idx[:, 0] >= 0) & (idx[:, 0] <= nx - 1)
              & (idx[:, 1] >= 0) & (idx[:, 1] <= ny - 1)
              & (idx[:, 2] >= 0) & (idx[:, 2] <= nz - 1))
    out = np.full(len(pts), -50.0)
    sub = np.clip(idx[inside], 0, np.array(grid.shape) - 1 - 1e-9)
    lo = np.floor(sub).astype(np.int64)
    fr = sub - lo
    i0, j0, k0 = lo[:, 0], lo[:, 1], lo[:, 2]
    fx, fy, fz = fr[:, 0], fr[:, 1], fr[:, 2]
    g = grid
    c00 = g[i0, j0, k0] * (1 - fx) + g[i0 + 1, j0, k0] * fx
    c10 = g[i0, j0 + 1, k0] * (1 - fx) + g[i0 + 1, j0 + 1, k0] * fx
    c01 = g[i0, j0, k0 + 1] * (1 - fx) + g[i0 + 1, j0, k0 + 1] * fx
    c11 = g[i0, j0 + 1, k0 + 1] * (1 - fx) + g[i0 + 1, j0 + 1, k0 + 1] * fx
    out[inside] = (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (
        c01 * (1 - fy) + c11 * fy) * fz
    return out


def bspline_mat(t, n, d=3):
    t = np.asarray(t, dtype=np.float64)
    M = len(t)
    nk = n + d + 1
    interior = np.linspace(0, 1, n - d + 1)[1:-1] if n > d + 1 else np.zeros(0)
    knots = np.concatenate([np.zeros(d + 1), interior, np.ones(d + 1)])
    B = np.zeros((M, nk - 1))
    for i in range(nk - 1):
        B[:, i] = ((t >= knots[i]) & (t < knots[i + 1])).astype(float)
    for k in range(1, d + 1):
        Bn = np.zeros((M, nk - 1 - k))
        for i in range(nk - 1 - k):
            a = (0.0 if knots[i + k] == knots[i]
                 else (t - knots[i]) / (knots[i + k] - knots[i]))
            b = (0.0 if knots[i + k + 1] == knots[i + 1]
                 else (knots[i + k + 1] - t)
                 / (knots[i + k + 1] - knots[i + 1]))
            Bn[:, i] = a * B[:, i] + b * B[:, i + 1]
        B = Bn
    B[t == 1.0, :] = 0.0
    B[t == 1.0, -1] = 1.0
    return B


def resample_arc(pts, m):
    pts = np.asarray(pts, dtype=float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    L = float(cum[-1])
    tt = np.linspace(0, L, m)
    out = np.zeros((m, 3))
    j = 0
    for k in range(m):
        while j < len(seg) - 1 and cum[j + 1] < tt[k]:
            j += 1
        f = (0.0 if cum[j + 1] == cum[j]
             else (tt[k] - cum[j]) / (cum[j + 1] - cum[j]))
        out[k] = pts[j] * (1 - f) + pts[j + 1] * f
    return out, L


def max_turn5(S):
    seg = np.linalg.norm(np.diff(S, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    L = float(arc[-1])
    n = max(int(L) + 1, 7)
    tt = np.linspace(0, L, n)
    out = np.zeros((n, 3))
    j = 0
    for k in range(n):
        while j < len(seg) - 1 and arc[j + 1] < tt[k]:
            j += 1
        f = (0.0 if arc[j + 1] == arc[j]
             else (tt[k] - arc[j]) / (arc[j + 1] - arc[j]))
        out[k] = S[j] * (1 - f) + S[j + 1] * f
    T = np.diff(out, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    if len(T) < 6:
        return 0.0
    d = (T[5:] * T[:-5]).sum(axis=1).clip(-1, 1)
    return float(np.degrees(np.arccos(d)).max())


# ------------------------------------------------------------------- relax
LEAD_FRAC = 0.03  # first 3% of samples ~= root leader, penalties exempt


def step_relax():
    E.mkdir(parents=True, exist_ok=True)
    sha = (E / "spec-sha-before-relax.txt").read_text().strip()
    assert sha == sha_of_file(E / "route-spec.json"), "spec sha drift!"
    spec = json.loads((E / "route-spec.json").read_text())
    w = spec["weights"]
    C.track(S7 / "relax.py")
    C.track(E0 / "paths.npz")
    inp = C.load_all()
    hull = inp["hull"]
    occ = np.array(hull["occupancy"], dtype=bool)
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)
    spacing = float(hull["spacing"])
    hsdf_grid = build_hull_sdf(occ, spacing)
    origin = np.array([xs[0], ys[0], zs[0]])
    egrid = inp["egrid"]

    P0f = np.load(str(E0 / "paths.npz"))
    assert str(P0f["spec_sha"][0]) == R0_SPEC_SHA, "route0 input changed!"
    n = len(P0f["roots_mm"])
    rxyz = np.array(P0f["roots_mm"], dtype=np.float64)
    ends0 = np.array(P0f["ends"])
    g0 = np.load(str(E0 / "graph.npz"))
    end_xyz0 = np.array(g0["node_xyz"])[ends0]
    y_ear = float(P0f["y_ear_mm"])
    status0 = [str(s) for s in P0f["status"]]
    assert all(s == "smooth" for s in status0)

    # sector band zmin per guide (route0 rule: curtain y<y_ear else back)
    fam_c = rxyz[:, 1] < y_ear
    # band zmin from route0 graph bands: recompute cheaply from end pool
    xyz_all = np.array(g0["node_xyz"])
    band_zmin = {}
    for key, sel in (("C", fam_c), ("B", ~fam_c)):
        zz = xyz_all[:, 2]
        band_zmin[key] = float(zz.min())
    # per-guide sector zmin approximated by family pool min of ends
    zmin_per = np.where(
        fam_c,
        np.where(rxyz[:, 0] < 0,
                 float(end_xyz0[fam_c & (rxyz[:, 0] < 0)][:, 2].min()),
                 float(end_xyz0[fam_c & (rxyz[:, 0] >= 0)][:, 2].min())),
        np.where(rxyz[:, 0] < 0,
                 float(end_xyz0[~fam_c & (rxyz[:, 0] < 0)][:, 2].min()),
                 float(end_xyz0[~fam_c & (rxyz[:, 0] >= 0)][:, 2].min())))

    M = spec["samples_M"] if "samples_M" in spec else 200
    stages = list(w["w_data_stages"])
    maxiter = int(spec["weights"]["lbfgs_maxiter_per_stage"])
    wc0 = float(w["w_curv"])
    pen_base = {"wh": float(w["w_hull"]), "wr": 0.0,
                "wb": float(w["w_body"]), "wend": float(w["w_end"])}
    retry_scale = float(spec["weights"]["penalty_retry_scale"])
    pen_cold = {"wh": pen_base["wh"] * retry_scale,
                "wr": float(w["w_rind"]),
                "wb": pen_base["wb"] * retry_scale,
                "wend": pen_base["wend"]}
    pen_end = dict(pen_base)
    pen_end["wend"] = pen_base["wend"] * float(
        spec["weights"]["w_end_retry_scale"])
    guides = [None] * n
    status = ["unreachable"] * n
    stat = {"relaxed": 0, "fallback": 0, "cold": 0, "end_retry": 0,
            "w_curv_hist": {}, "nc_hist": {}}
    t_start = time.time()

    def make_val(nc, B, P0, R, nl):
        def val(x, wd, wc, pen):
            CP = np.vstack([P0[None, :], x.reshape(nc - 1, 3)])
            S = B @ CP
            dd = CP[:-2] - 2 * CP[1:-1] + CP[2:]
            curv = float((dd ** 2).sum())
            data = float(((S - R) ** 2).sum(axis=1).mean())
            end = float(((S[-1] - R[-1]) ** 2).sum())
            Sm = S[nl:]
            hh = trilinear(hsdf_grid, origin, spacing, Sm)
            pen_h = float((np.clip(3.0 - hh, 0, None) ** 2).mean())
            pen_r = float((np.clip(5.0 - hh, 0, None) ** 2).mean())
            bb = C.EXACT.query_exact(egrid, Sm)
            pen_b = float((np.clip(3.0 - bb, 0, None) ** 2).mean())
            J = (wc * curv + wd * data + pen["wend"] * end
                 + pen["wh"] * pen_h + pen["wr"] * pen_r
                 + pen["wb"] * pen_b)
            return J, S
        return val

    def run_stages(val, x, wct, pen):
        for wd in stages:
            r = minimize(lambda v: val(v, wd, wct, pen)[0], x,
                         method="L-BFGS-B",
                         options={"maxiter": maxiter})
            x = r.x
        return x

    def eval_guide(val, x, wct, pen, P0, rte_end, root, zmin):
        _, S = val(x, stages[-1], wct, pen)
        t5 = max_turn5(S)
        ok, info = check_relaxed(S, P0, rte_end, root, zmin, occ, xs,
                                 ys, zs, spacing, hsdf_grid, origin,
                                 egrid)
        return S, t5, ok, info

    WC_LADDER = (wc0, 0.5, 1.0, 2.0, 4.0, 8.0)

    for i in range(n):
        c = np.array(P0f["curves_mm"][i])
        c = c[np.isfinite(c).all(axis=1)]
        R, L = resample_arc(c, M)
        nc0 = min(14, max(8, round(L / 30)))
        P0 = rxyz[i]
        nl = max(int(M * LEAD_FRAC), 1)
        t = np.linspace(0, 1, M)
        solution = None
        t5, info = float("nan"), "no-eval"
        # ladder: nc in {length-based, 14}; warm base, curvature
        # escalation, cold 4x-penalty restart, escalation again.
        # First candidate passing BOTH turn <= 15 and containment
        # wins (stiffer fits land in smoother basins that thread
        # narrow corridors: guide 23 needs nc14/cold4x/wc2.0).
        for nc in dict.fromkeys([nc0, 14]):
            B = bspline_mat(t, nc)
            val = make_val(nc, B, P0, R, nl)
            init, _ = resample_arc(c, nc)
            init[0] = P0
            x = init[1:].ravel()
            x = run_stages(val, x, wc0, pen_base)
            for wct in WC_LADDER:
                if wct > wc0:
                    x = run_stages(val, x, wct, pen_base)
                S, t5, ok, info = eval_guide(
                    val, x, wct, pen_base, P0, end_xyz0[i], rxyz[i],
                    zmin_per[i])
                if t5 <= 15.0 and ok:
                    solution = (S, nc, wct)
                    break
            if solution is not None:
                break
            x = init[1:].ravel()
            x = run_stages(val, x, wc0, pen_cold)
            stat["cold"] += 1
            for wct in WC_LADDER:
                if wct > wc0:
                    x = run_stages(val, x, wct, pen_cold)
                S, t5, ok, info = eval_guide(
                    val, x, wct, pen_cold, P0, end_xyz0[i], rxyz[i],
                    zmin_per[i])
                if t5 <= 15.0 and ok:
                    solution = (S, nc, wct)
                    break
            if solution is not None:
                break
        if solution is None and info.split(" ")[0] in (
                "end-sign", "end-z", "end-displaced"):
            # tip drifted out of band while the body is fine:
            # one warm retry at 10x end anchor (last x, all wc)
            B = bspline_mat(t, nc0)
            val = make_val(nc0, B, P0, R, nl)
            init, _ = resample_arc(c, nc0)
            init[0] = P0
            x = init[1:].ravel()
            x = run_stages(val, x, wc0, pen_end)
            for wct in WC_LADDER:
                if wct > wc0:
                    x = run_stages(val, x, wct, pen_end)
                S, t5, ok, info = eval_guide(
                    val, x, wct, pen_end, P0, end_xyz0[i], rxyz[i],
                    zmin_per[i])
                if t5 <= 15.0 and ok:
                    solution = (S, nc0, wct)
                    stat["end_retry"] += 1
                    break
        if solution is not None:
            S, nc, wct = solution
            guides[i] = S
            status[i] = "relaxed"
            stat["relaxed"] += 1
            stat["w_curv_hist"][str(wct)] = stat["w_curv_hist"].get(
                str(wct), 0) + 1
            stat["nc_hist"][str(nc)] = stat["nc_hist"].get(
                str(nc), 0) + 1
        else:
            guides[i] = R  # openly keep the routed curve
            status[i] = "fallback"
            stat["fallback"] += 1
            print("FALLBACK i=%d turn=%.1f reason=%s" % (i, t5, info),
                  flush=True)
        if (i + 1) % 50 == 0:
            print("relaxed %d/%d fallback=%d cold=%d %.0fs" % (
                i + 1, n, stat["fallback"], stat["cold"],
                time.time() - t_start), flush=True)

    print(json.dumps(stat), flush=True)
    maxlen = max(len(gg) for gg in guides)
    arr = np.full((n, maxlen, 3), np.nan)
    for i, gg in enumerate(guides):
        arr[i, :len(gg)] = gg
    np.savez_compressed(
        str(E / "paths.npz"), curves_mm=arr,
        status=np.array(status), roots_mm=rxyz,
        roots_side=np.array(P0f["roots_side"]),
        roots_sel=np.array(P0f["roots_sel"]), attach=np.array(P0f["attach"]),
        ends=ends0, leader_mm=np.array(P0f["leader_mm"]),
        y_ear_mm=np.float64(y_ear),
        poisson_spacing_mm=np.float64(float(P0f["poisson_spacing_mm"])),
        spec_sha=np.array([sha]), crown=np.asarray(P0f["crown"]),
        route0_spec_sha=np.array([R0_SPEC_SHA]),
        stats=np.array([json.dumps(stat)]))
    print("WROTE paths.npz bytes=%d" % (
        (E / "paths.npz").stat().st_size), flush=True)
    write_inputs_log([S7 / "relax.py", E0 / "paths.npz"])


def check_relaxed(S, P0, routed_end, root, zmin, occ, xs, ys, zs, spacing,
                  hsdf_grid, origin, egrid):
    # root fixed
    if float(np.linalg.norm(S[0] - P0)) > 1e-6:
        return False, "root-moved"
    # end within band: same-sign, z slab, displacement.
    # Same-sign carries route0's 2 mm excursion rule (route0 part
    # crossings: opposite-side excursions <= 2 mm are sub-voxel
    # midline dust, not crossings): tips at x=0 midline voxels flip
    # sign by < 1 mm of smoothing noise.
    rx = float(root[0])
    ex = float(S[-1, 0])
    if abs(rx) >= 3.0 and ex * rx < 0 and (-ex * np.sign(rx)) > 2.0:
        return False, "end-sign"
    ez = float(S[-1, 2])
    if not (zmin - 5.0 <= ez <= zmin + 25.0):
        return False, "end-z %.1f zmin %.1f" % (ez, zmin)
    if float(np.linalg.norm(S[-1] - routed_end)) > 15.0:
        return False, "end-displaced"
    # containment beyond first 8 mm (route0 rule)
    seg = np.linalg.norm(np.diff(S, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    lead = arc <= 8.0
    body = ~lead
    if not body.any():
        return False, "short"
    ix = np.rint((S[:, 0] - xs[0]) / spacing).astype(int)
    iy = np.rint((S[:, 1] - ys[0]) / spacing).astype(int)
    iz = np.rint((S[:, 2] - zs[0]) / spacing).astype(int)
    nx, ny, nz = occ.shape
    inb = ((ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
           & (iz >= 0) & (iz < nz))
    if not inb.all():
        return False, "out-of-grid"
    if not occ[ix[body], iy[body], iz[body]].all():
        return False, "outside-hull"
    sdf = C.EXACT.query_exact(egrid, S)
    if not (sdf[body] > 0).all():
        return False, "body-min %.2f" % float(sdf[body].min())
    if not (sdf[lead] > -1.0).all():
        return False, "leader-buried"
    hh = trilinear(hsdf_grid, origin, spacing, S[body])
    frac_h = float((hh >= 3.0).mean())
    if frac_h < 0.95:
        return False, "hull-frac %.3f min %.2f" % (frac_h,
                                                   float(hh.min()))
    return True, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True, choices=["spec", "relax"])
    args = ap.parse_args()
    if args.step == "spec":
        step_spec()
    else:
        step_relax()


if __name__ == "__main__":
    main()

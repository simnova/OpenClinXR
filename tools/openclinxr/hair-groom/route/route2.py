"""hair-route2: route0-method routing + route1-method relaxation on hull3.

Target: ear-tucked Imagine-on-Aisha set aisha-v3 (manifest
aisha_straight_long_v4.json, identity registration, four calibrated
views); hull3 (ear-tucked carve, commit e99c708ec).

Why this file + common2.py exist (and route.py/relax.py/gates.py/
gates1.py/export1.py are untouched): common.py hardcodes the route0
evidence dir, the v1 manifest, the hull0c hull and 3 views, so the new
inputs (hull3, v4 manifest, three_quarter view + body-depth, ear-pinna
sets) and the new gates (ear gate, per-view regional gating on the
aisha-v3 masks) cannot run through the old modules unmodified. This
driver reuses the route0/route1 code paths VERBATIM by importing the
modules and patching only their E/C globals and spec_dict inputs --
no algorithm edit -- and adds the route2-only stages (band/shoulder
report, ear gate, 4-view regional gating, vs-target figure).

Method (unchanged from route0): directed-A* minimum-cost paths on the
26-neighbour eroded-hull graph, same six-term edge cost, same weights,
same Poisson roots (300-500), same endpoint-band rule (per-sector
lowest-voxel hem pools), same Catmull-Rom + acceptance. Endpoint bands
are derived from hull3's lowest voxels per sector by that rule; the
front sector has no hair below the shoulder plane, which the band
derivation respects automatically (reported, not hand-tuned).

Relax (unchanged from route1): one cubic clamped uniform-knot B-spline
per guide, same ladder (warm w_curv=0.2, escalation to 8.0, cold 4x
restart, nc in {length-based, 14}), same weights/accept. Route1's
RESULT recommends NO relax-spec change (its findings concern routing
resolution for the 15 voxel-corner residuals and recalibrating the flow
gate to drape physics -- both out of scope for this card, which keeps
the gates as specified). So: same spec, new inputs.

Stages (--step, each ends with a file):
  spec-graph  freeze E2/route-spec.json (route2 spec) + graph -> graph.npz
  route       Poisson roots, hull3 endpoint bands, directed A*,
              smooth + accept -> paths.npz (backup -> routed.npz)
  relax       B-spline relaxation -> paths.npz (overwrites routed)
  gates       all card gates -> gates.json
  export      guides.npz + Blender figure + vs-target composite
  result      RESULT.txt + DONE.txt
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

S7 = Path(__file__).resolve().parent
sys.path.insert(0, str(S7))
import common2 as C2  # noqa: E402
import gates as G  # noqa: E402
import gates1 as G1  # noqa: E402
import relax as RX  # noqa: E402
import route as R  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

E2 = C2.E
VIEWS4 = ("front", "three_quarter", "profile_90", "back")

# Reuse tested code paths verbatim; only inputs/outputs differ.
R.C = C2
R.E = E2
RX.C = C2
RX.E = E2
RX.E0 = E2
G.E = E2

TURN_GATE = 15.0
FLOW_P50_GATE = 20.0
FLOW_P95_GATE = 40.0
BOUNDARY_GATE = 0.5
GAP_GATE_MM = 20.0
EAR_CLEAR_MM = 3.0
REG_P50_PX = 12.0
REG_P95_PX = 24.0


def route2_spec():
    s = copy.deepcopy(R.__dict__.get("_route2_base__", None) or {})
    spec = {
        "method": "directed-A* minimum-cost paths on 26-neighbour "
                  "eroded-hull graph; no gravity blend, no "
                  "streamline-then-project (route0 method, unchanged)",
        "input": "hair-hull3/hull.npz (ear-tucked carve, 479750 vox, "
                 "spacing 2.0) + hair-scalp1/roots.npz (14155) + "
                 "aisha_straight_long_v4.json (aisha-v3, identity "
                 "registration)",
        "coverage_radius_mm": 3.0,
        "erosion_rule": "hull occupancy distance-transform >= 3.0 mm "
                        "(2 mm grid) AND exact-SDF >= 3.0 mm",
        "graph": "26-neighbour over eroded voxels",
        "roots": {"source": "hair-scalp1/roots.npz (14155)",
                  "rule": "greedy Poisson subset, crown-first order, "
                          "adaptive spacing to land 300-500 roots",
                  "attach": "nearest eroded-graph node (euclidean, mm)",
                  "side": "sign(root_x_mm) vs centre part x=0 "
                          "(|x|<1mm -> +1)"},
        "ear_plane_rule": "y_ear_mm = median y of scalp hairline-loop "
                          "points with |x| above the 80th percentile "
                          "(sideburn anchor, data-driven); root world y < "
                          "y_ear -> curtain family, else back family. "
                          "With the ears tucked, side hair passes BEHIND "
                          "the ear: the hull itself clears the pinnae "
                          "(hull3 ear gate <= 2% coverage, min clearance "
                          "2.17 mm), so minimum-cost paths through the "
                          "hull pass behind/clear of the ears; measured "
                          "by the new ear gate, no routing term added.",
        "endpoint_bands": "per (sector, side): curtain-L/R (root x<0 / "
                          "x>=0, y<y_ear), back-L/R (root x<0 / x>=0, "
                          "y>=y_ear; pools overlap +-2 mm so bundles can "
                          "meet at the occiput). Pool = x-binned (10 mm "
                          "bins) lowest 25 eroded voxels per bin within "
                          "z <= sector_min_z + 20 mm: a hem-spanning "
                          "pool derived from hull3's lowest voxels per "
                          "sector. The front sector has no hair below "
                          "the shoulder plane (hull3 diag (d): front 0 "
                          "vox below z=1405), so the curtain pools sit "
                          "at/above the shoulder line by construction; "
                          "per-band zmin vs shoulder reported. "
                          "Assignment is quantile-matched in lateral "
                          "scalp order with hard same-sign rule, global "
                          "x-monotonicity, preferred spacing 4 mm "
                          "(relax 2.5 mm) over a hard distinct-voxel "
                          "floor (no endpoint voxel ever shared).",
        "part_rule": "w_part * len_mm added on nodes whose x-sign "
                     "opposes the root's sign (roots |x|<3 mm exempt)",
        "edge_cost": "w_len*len_mm + w_up*max(0,dz_mm) + "
                     "w_curve*turn_rad + w_body*bodyterm*len_mm + "
                     "w_bnd*bndterm*len_mm + w_coh*min(usage,3)*len_mm",
        "components": "routing graph = largest 26-connected component "
                      "of the eroded set (sliver labels dropped at "
                      "graph build; count recorded)",
        "weights": {"w_len": 1.0, "w_up": 8.0, "w_curve": 16.0,
                    "w_body": 6.0, "w_bnd": 4.0, "w_coh": 1.0,
                    "w_part": 5.0},
        "bodyterm": "((clip(8-sdf_mm,0,8))/8)^2",
        "bndterm": "((clip(6-bnd_mm,0,6))/6)^2",
        "heuristic": "weighted A* (eps=3.0) on w_len * euclidean mm",
        "expansions_cap": 600000,
        "expansions_note": "route0 froze 150000 on the hull0c graph; "
                           "hull3's eroded graph is ~2x larger (376523 "
                           "nodes) with longer thin side corridors, and "
                           "a 150k run left 54/359 unreachable while "
                           "acceptance-passing paths for them exist "
                           "(proven by zero-usage re-search: e.g. guide "
                           "178 passes eroded-frac 0.970). The cap only "
                           "truncates search, never changes the cost or "
                           "the accepted paths, so 600k is a compute- "
                           "budget recalibration inside the same method, "
                           "not a cost change. Primary passes and retry "
                           "levels unchanged.",
        "order": "scalp order (y, x) with usage-map coherence; retry "
                 "passes over unreachable roots at usage scales 1.0, "
                 "0.25, 0.0; levels recorded",
        "smooth": "centripetal Catmull-Rom through path nodes, 2 mm "
                  "resample; fallback = collinear-decimated voxel "
                  "polyline (always inside eroded hull, SDF>=3)",
        "accept": "routed portion (arc beyond the first 8 mm) must lie "
                  "inside hull occupancy with exact-SDF > 0 and arc "
                  "fraction inside the eroded hull >= 0.95; root leader "
                  "(first 8 mm) exempt from hull/eroded containment "
                  "but exact-SDF > -1 mm",
        "tube_r_mm": 3.0,
    }
    assert not s
    return spec


def relax2_spec(route_sha):
    return {
        "method": "continuous relaxation of route2 discrete voxel "
                  "paths: one cubic clamped B-spline per guide, "
                  "least-squares fit to its own routed path with "
                  "decaying data weight + curvature + eroded-hull + "
                  "body-clearance penalties (route1 method, unchanged; "
                  "route1 RESULT recommends no relax-spec change)",
        "input": "hair-route2/relax-in/paths.npz (307 smooth-routed "
                 "guides, route2 spec sha %s). Carried without "
                 "relaxation, route1-carry precedent (counted openly): "
                 "2 route-stage fallbacks (keep routed curve) + 50 "
                 "unreachable (no curve; hull3 thin-shell/air-gap "
                 "mechanism, see RESULT). Relax code path itself is "
                 "route1-verbatim (input all-smooth assert holds)." % route_sha,
        "spline": "cubic clamped uniform-knot B-spline; per-guide "
                  "model selection inside 8-14 control points "
                  "(length-based n = clip(round(L/30),8,14), then 14 "
                  "on failure); root control point fixed at the scalp "
                  "root; end free but accepted only inside its "
                  "endpoint band",
        "ladder": "per guide, first candidate passing BOTH max-turn "
                  "5mm <= 15 deg AND containment wins: (a) warm fit "
                  "at w_curv=0.2, (b) curvature escalation 0.5/1.0/"
                  "2.0/4.0/8.0, (c) cold restart from the routed init "
                  "at 4x hull/body penalties, (d) escalation again; "
                  "(c)-(d) repeat at nc=14",
        "samples": "M=200 arc-uniform samples per guide",
        "objective": "J = w_curv*sum||d2C||^2 + w_data*mean||S-R||^2 "
                     "+ w_end*||S_end-R_end||^2 + "
                     "w_hull*mean(relu(3-hullSDF)^2) + "
                     "w_rind*mean(relu(5-hullSDF)^2) + "
                     "w_body*mean(relu(3-bodySDF)^2); penalties beyond "
                     "the root leader only (first 3% of samples)",
        "weights": {"w_curv": 0.2, "w_data_stages": [50.0, 20.0, 8.0],
                    "w_end": 200.0, "w_end_retry_scale": 10.0,
                    "w_hull": 10000.0, "w_rind": 2000.0,
                    "w_body": 100000.0,
                    "hull_margin_mm": 3.0, "rind_margin_mm": 5.0,
                    "body_margin_mm": 3.0,
                    "lbfgs_maxiter_per_stage": 120,
                    "penalty_retry_scale": 4.0},
        "accept": "route0 containment unchanged (routed arc beyond the "
                  "first 8 mm inside hull occupancy, exact-SDF > 0, "
                  "hullSDF >= 3.0 arc fraction >= 0.95, leader "
                  "exact-SDF > -1 mm) plus root fixed and end inside "
                  "its endpoint band (same x-sign rule with 2 mm "
                  "excursion tolerance, z within [zmin-5, zmin+25], "
                  "displacement <= 15 mm). Guides that fail after "
                  "escalation keep the routed curve with status "
                  "fallback (counted openly)",
        "tube_r_mm": 3.0,
    }


def sha_of_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def step_spec_graph():
    E2.mkdir(parents=True, exist_ok=True)
    C2.track(S7 / "route2.py")
    R.spec_dict = route2_spec
    return R.step_spec_graph()


def step_route():
    R.spec_dict = route2_spec
    R.step_route()
    shutil.copy(str(E2 / "paths.npz"), str(E2 / "routed.npz"))
    # band/shoulder report: bands derived from hull3 lowest voxels;
    # front sector must hold no hair below the shoulder plane.
    P = np.load(str(E2 / "paths.npz"))
    gr = np.load(str(E2 / "graph.npz"))
    xyz = np.array(gr["node_xyz"])
    ends = np.array(P["ends"])
    rxyz = np.array(P["roots_mm"])
    y_ear = float(P["y_ear_mm"])
    shoulder = float(np.load(str(
        C2.ROOT / "tools/openclinxr/evidence/hair-hull3/hull.npz"))[
            "shoulder_plane_z"])
    fam_c = rxyz[:, 1] < y_ear
    ex = xyz[ends]
    rep = {"yEarMm": round(y_ear, 1), "shoulderZ": shoulder}
    for name, m in (("curtainL", fam_c & (rxyz[:, 0] < 0)),
                    ("curtainR", fam_c & (rxyz[:, 0] >= 0)),
                    ("backL", ~fam_c & (rxyz[:, 0] < 0)),
                    ("backR", ~fam_c & (rxyz[:, 0] >= 0))):
        ez = ex[m][:, 2]
        rep[name] = {"n": int(m.sum()),
                     "endZmin": round(float(ez.min()), 1),
                     "endZmax": round(float(ez.max()), 1),
                     "nEndsBelowShoulder": int((ez < shoulder).sum())}
    (E2 / "bands.json").write_text(json.dumps(rep, indent=1) + "\n")
    print("BANDS " + json.dumps(rep), flush=True)
    C2.write_inputs_log([S7 / "route2.py"])


def step_relax():
    route_sha = (E2 / "spec-sha-before-route.txt").read_text().strip()
    assert route_sha == sha_of_file(E2 / "route-spec.json"), \
        "route spec drift!"
    shutil.copy(str(E2 / "route-spec.json"),
                str(E2 / "route-spec-route.json"))
    RX.R0_SPEC_SHA = route_sha
    RX.spec_dict = lambda: relax2_spec(route_sha)
    RX.step_spec()
    shutil.copy(str(E2 / "route-spec.json"),
                str(E2 / "route-spec-relax.json"))
    # relax input: smooth-routed guides only (relax.py asserts an
    # all-smooth input; route-stage fallbacks + unreachable are
    # carried without relaxation, route1-carry precedent).
    PR = np.load(str(E2 / "routed.npz"))
    nR = len(PR["roots_mm"])
    stR = [str(s) for s in PR["status"]]
    smooth_idx = np.array([i for i in range(nR) if stR[i] == "smooth"],
                          dtype=np.int64)
    print("RELAX-INPUT smooth=%d fallback=%d unreachable=%d" % (
        len(smooth_idx),
        sum(1 for s in stR if s == "fallback"),
        sum(1 for s in stR if s == "unreachable")), flush=True)
    rin = E2 / "relax-in"
    rin.mkdir(parents=True, exist_ok=True)
    sub = {}
    for k in PR.files:
        a = np.array(PR[k])
        if a.shape and a.shape[0] == nR and k not in (
                "spec_sha", "crown", "y_ear_mm", "poisson_spacing_mm"):
            sub[k] = a[smooth_idx]
        else:
            sub[k] = a
    np.savez_compressed(str(rin / "paths.npz"), **sub)
    shutil.copy(str(E2 / "graph.npz"), str(rin / "graph.npz"))
    RX.E0 = rin
    RX.step_relax()
    merge_relaxed(route_sha)
    C2.write_inputs_log([S7 / "route2.py"])


def merge_relaxed(route_sha):
    # merge: relaxed curves back into the full 359 frame; carried
    # guides keep routed curves (fallback) or no curve (unreachable).
    PR = np.load(str(E2 / "routed.npz"))
    nR = len(PR["roots_mm"])
    stR = [str(s) for s in PR["status"]]
    smooth_idx = np.array([i for i in range(nR) if stR[i] == "smooth"],
                          dtype=np.int64)
    P1 = np.load(str(E2 / "paths.npz"))
    c1 = [np.array(P1["curves_mm"][i]) for i in range(len(smooth_idx))]
    L1 = max(cc.shape[0] for cc in c1)
    L0r = int(np.array(PR["curves_mm"]).shape[1])
    L = max(L1, L0r)
    full = np.full((nR, L, 3), np.nan)
    for j, i in enumerate(smooth_idx):
        cc = np.array(P1["curves_mm"][j])
        cc = cc[np.isfinite(cc).all(axis=1)]
        full[i, :len(cc)] = cc
    s1 = [str(s) for s in P1["status"]]
    assert set(s1) <= {"relaxed", "fallback"}, set(s1)
    print("RELAX-OUT relaxed=%d fallback=%d" % (
        sum(1 for s in s1 if s == "relaxed"),
        sum(1 for s in s1 if s == "fallback")), flush=True)
    carr = np.array(PR["curves_mm"])
    for i in range(nR):
        if stR[i] == "fallback":
            cc = np.array(carr[i])
            cc = cc[np.isfinite(cc).all(axis=1)]
            full[i, :len(cc)] = cc
    status_full = list(stR)
    for j, i in enumerate(smooth_idx):
        status_full[i] = s1[j]  # relaxed, or fallback (kept routed)
    assert sum(1 for s in status_full if s in ("relaxed", "fallback")) \
        == len(smooth_idx) + sum(1 for s in stR if s == "fallback")
    np.savez_compressed(
        str(E2 / "paths.npz"), curves_mm=full,
        status=np.array(status_full), roots_mm=np.array(PR["roots_mm"]),
        roots_side=np.array(PR["roots_side"]),
        roots_sel=np.array(PR["roots_sel"]), attach=np.array(PR["attach"]),
        ends=np.array(PR["ends"]), leader_mm=np.array(PR["leader_mm"]),
        y_ear_mm=np.array(PR["y_ear_mm"]),
        poisson_spacing_mm=np.array(PR["poisson_spacing_mm"]),
        spec_sha=np.array(P1["spec_sha"]),
        crown=np.asarray(P1["crown"]),
        route0_spec_sha=np.array([route_sha]),
        stats=np.array([json.dumps(
            {"relaxed": int((np.array(status_full) == "relaxed").sum()),
             "fallback": int((np.array(status_full) == "fallback").sum()),
             "unreachable": int((np.array(status_full)
                                 == "unreachable").sum()),
             "relax_stats": json.loads(str(P1["stats"][0]))})]))
    C2.write_inputs_log([S7 / "route2.py"])


def resample_1mm(c):
    c = np.asarray(c, dtype=np.float64)
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    L = float(arc[-1])
    n = max(int(L) + 1, 2)
    tt = np.linspace(0, L, n)
    out = np.zeros((n, 3))
    j = 0
    for k in range(n):
        while j < len(seg) - 1 and arc[j + 1] < tt[k]:
            j += 1
        f = (0.0 if arc[j + 1] == arc[j]
             else (tt[k] - arc[j]) / (arc[j + 1] - arc[j]))
        out[k] = c[j] * (1 - f) + c[j + 1] * f
    return out


def tube_raster4(curves_mm, inp, tube_r_mm=3.0):
    sensor = inp["sensor"]
    cams = inp["cams"]
    out = {}
    for view in VIEWS4:
        cam = cams["views"][view]
        focal = float(cam["lensMm"]) / float(sensor) * 1024
        cover = np.zeros((1024, 1024), dtype=bool)
        depth = np.full((1024, 1024), np.inf)
        bdepth = np.array(inp["body"][view]["depth"], dtype=np.float64)
        for c in curves_mm:
            pts = np.asarray(c, dtype=np.float64) / 1000.0
            cols, rows, dep = C2.ENV.project_to_render(pts, cam, sensor)
            rr = tube_r_mm / 1000.0 * focal / np.maximum(dep, 1e-6)
            for k in range(len(pts)):
                if dep[k] <= 0:
                    continue
                r = float(rr[k])
                if r < 0.5:
                    r = 0.5
                c0, r0 = float(cols[k]), float(rows[k])
                xlo, xhi = max(int(c0 - r), 0), min(int(c0 + r), 1023)
                ylo, yhi = max(int(r0 - r), 0), min(int(r0 + r), 1023)
                if xhi < xlo or yhi < ylo:
                    continue
                yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
                disc = (xx - c0) ** 2 + (yy - r0) ** 2 <= r * r
                if not disc.any():
                    continue
                win_b = bdepth[ylo:yhi + 1, xlo:xhi + 1]
                vis = disc & (dep[k] < win_b - 0.0005)
                if not vis.any():
                    continue
                sub = np.zeros_like(disc, dtype=bool)
                cur = depth[ylo:yhi + 1, xlo:xhi + 1]
                sub[vis] = dep[k] < cur[vis]
                cur[sub] = dep[k]
                depth[ylo:yhi + 1, xlo:xhi + 1] = cur
                cov = cover[ylo:yhi + 1, xlo:xhi + 1]
                cov |= vis
                cover[ylo:yhi + 1, xlo:xhi + 1] = cov
        out[view] = (cover, depth)
    return out


def ear_gate(curves, pinna, inp):
    """New gate: no guide passes within 3 mm of the pinna or in front
    of the ear. In-front is view-correct: a sample inside the pinna's
    projected hull (front/three_quarter/profile_90) and closer to the
    camera than the nearest pinna vert (minus 3 mm) covers the ear.
    (A raw (x,z)-cylinder proxy over-flags: at temple height the head
    surface sits ~26 mm anterior of the pinna plane by curvature, so
    temple hair reads 'anterior' without covering the ear. The
    occlusion test matches hull3's own ear-coverage lineage.)"""
    from scipy.spatial import ConvexHull, Delaunay
    res = {}
    cams = inp["cams"]
    sensor = inp["sensor"]
    for side in ("xpos", "xneg"):
        pv = np.asarray(pinna[side], dtype=np.float64)
        t3 = cKDTree(pv)
        dmins = []
        near = []
        for c in curves:
            pts = resample_1mm(c)
            d, _ = t3.query(pts, k=1)
            dmins.append(float(d.min()))
            near.append(bool(float(d.min()) < EAR_CLEAR_MM))
        dmins = np.array(dmins)
        res[side] = {
            "nGuidesNear3mm": int(np.sum(near)),
            "nearIdx": [int(i) for i, v in enumerate(near) if v],
            "minDistMm": round(float(dmins.min()), 2),
            "p50DistMm": round(float(np.percentile(dmins, 50)), 2)}
    pv_all = np.vstack([np.asarray(pinna["xpos"]),
                        np.asarray(pinna["xneg"])]) / 1000.0
    covering = {}
    n_behind = n_cover = 0
    for view in ("front", "three_quarter", "profile_90"):
        cam = cams["views"][view]
        pc, pr, pd = C2.ENV.project_to_render(pv_all, cam, sensor)
        m = ((pd > 0) & (pc >= 0) & (pc < 1024) & (pr >= 0) & (pr < 1024))
        pts2 = np.stack([pc[m], pr[m]], axis=1)
        pdep = pd[m]
        tri = Delaunay(pts2[ConvexHull(pts2).vertices])
        t2 = cKDTree(pts2)
        for j, c in enumerate(curves):
            s = resample_1mm(c) / 1000.0
            cc, rr, dd = C2.ENV.project_to_render(s, cam, sensor)
            inside = ((cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024)
                      & (dd > 0)
                      & (tri.find_simplex(np.stack([cc, rr], axis=1))
                         >= 0))
            if not inside.any():
                continue
            _, ji = t2.query(np.stack([cc[inside], rr[inside]], axis=1),
                             k=1)
            ref = pdep[ji]
            is_cover = dd[inside] < ref - 0.003
            is_behind = dd[inside] > ref + 0.003
            n_cover += int(is_cover.sum())
            n_behind += int(is_behind.sum())
            if is_cover.any():
                covering.setdefault(view, []).append(
                    (j, int(is_cover.sum())))
    cov_guides = sorted(set(j for v in covering.values() for j, _ in v))
    res["occlusion"] = {
        "coveringSamples": n_cover, "behindSamples": n_behind,
        "nGuidesCovering": len(cov_guides), "coveringIdx": cov_guides,
        "perView": {v: covering.get(v, []) for v in
                    ("front", "three_quarter", "profile_90")}}
    res["gate"] = {"clearMm": EAR_CLEAR_MM, "pass": bool(
        res["xpos"]["nGuidesNear3mm"] == 0
        and res["xneg"]["nGuidesNear3mm"] == 0
        and len(cov_guides) == 0)}
    return res


def step_gates():
    E2.mkdir(parents=True, exist_ok=True)
    C2.track(S7 / "route2.py")
    inp = C2.load_all()
    P1 = np.load(str(E2 / "paths.npz"))
    n = len(P1["roots_mm"])
    status = [str(s) for s in P1["status"]]
    okidx = np.array([i for i in range(n)
                      if status[i] in ("relaxed", "fallback")],
                     dtype=np.int64)
    curves1 = [np.array(P1["curves_mm"][i]) for i in okidx]
    curves1 = [c[np.isfinite(c).all(axis=1)] for c in curves1]
    P0 = np.load(str(E2 / "routed.npz"))
    curves0 = [np.array(P0["curves_mm"][i]) for i in okidx]
    curves0 = [c[np.isfinite(c).all(axis=1)] for c in curves0]
    assert all(len(c) for c in curves1 + curves0)
    P1f = {"roots_mm": np.array(P1["roots_mm"])[okidx]}
    relax_sha = (E2 / "spec-sha-before-relax.txt").read_text().strip()
    assert str(P1["spec_sha"][0]) == relax_sha
    route_sha = (E2 / "spec-sha-before-route.txt").read_text().strip()
    assert str(P1["route0_spec_sha"][0]) == route_sha
    assert str(P0["spec_sha"][0]) == route_sha
    status = [str(s) for s in P1["status"]]
    occ = np.array(inp["hull"]["occupancy"], dtype=bool)
    hull = inp["hull"]
    xs = np.array(hull["xs"], dtype=np.float64)
    ys = np.array(hull["ys"], dtype=np.float64)
    zs = np.array(hull["zs"], dtype=np.float64)

    gates = {"nGuides": n,
             "nRelaxed": int(sum(1 for s in status if s == "relaxed")),
             "nFallback": int(sum(1 for s in status if s == "fallback")),
             "unreachable": int(sum(1 for s in status
                                    if s == "unreachable")),
             "specSha": relax_sha, "routeSpecSha": route_sha}
    gates["endpointCoverage"] = G.endpoint_coverage(P1)
    gates["boundaryFrac4mm"] = round(G.boundary_frac(
        curves1, occ, xs, ys, zs, 2.0), 4)
    gates["boundaryGate"] = BOUNDARY_GATE
    gates["partCrossings"] = G.part_crossings(P1f, curves1)
    gates["backCentreGap"] = G.back_gap(P1)
    gates["backCentreGapGateMm"] = GAP_GATE_MM
    leader = np.array(P1["leader_mm"], dtype=np.float64)
    gates["leaderMm"] = {"max": round(float(leader.max()), 2),
                         "p95": round(float(np.percentile(leader, 95)), 2),
                         "p50": round(float(np.percentile(leader, 50)), 2),
                         "nOver8mm": int((leader > 8).sum())}
    gates["yEarMm"] = float(P1["y_ear_mm"])

    ends = np.array(P1["ends"])[okidx]
    ex = np.array(np.load(str(E2 / "graph.npz"))["node_xyz"])[ends]
    disp = np.array([float(np.linalg.norm(curves1[j][-1] - ex[j]))
                     for j in range(len(okidx))])
    gates["endDisplacementMm"] = {
        "max": round(float(disp.max()), 2),
        "p95": round(float(np.percentile(disp, 95)), 2),
        "p50": round(float(np.percentile(disp, 50)), 2)}

    verts, vn = G1.scalp_normals(inp)
    tree = cKDTree(verts)
    roots_mm = np.array(P1["roots_mm"])[okidx]
    roots0_mm = np.array(P0["roots_mm"])[okidx]
    gates["crownBandMm"] = [1570.0, 1640.0]
    gates["flowRouted"] = G1.flow_angles(
        curves0, roots0_mm, verts, vn, tree)
    gates["flowRelaxed"] = G1.flow_angles(curves1, roots_mm, verts, vn,
                                          tree)
    gates["turnRouted"] = G1.turn_stats(curves0)
    gates["turnRelaxed"] = G1.turn_stats(curves1)
    gates["latticeRelaxed"] = G1.lattice_runs(curves1, roots_mm, verts,
                                              vn, tree)
    gates["latticeRouted"] = G1.lattice_runs(
        curves0, roots0_mm, verts, vn, tree)

    gates["ear"] = ear_gate(curves1, inp["pinna"], inp)

    render_cover = tube_raster4(curves1, inp)
    body_maps = {v: (np.array(inp["body"][v]["cover"], dtype=bool),
                      np.array(inp["body"][v]["depth"], dtype=np.float64))
                 for v in VIEWS4}
    union = C2.INS.occluded_union(render_cover, body_maps,
                                  inp["transforms"], views=VIEWS4)
    reg = {}
    for view in VIEWS4:
        tgt = np.array(inp["masks"][view], dtype=bool)
        stats, _ = G.regional_pq(union[view], tgt)
        reg[view] = stats
    gates["regionalWholeMask"] = reg
    gates["regionalGatePx"] = {"p50": REG_P50_PX, "p95": REG_P95_PX}

    # face guards from our own render-frame geometry (same formulas as
    # guard_definitions, rows/cols projected with the pinned cameras).
    proj = C2.ENV.project_to_render
    sensor = inp["sensor"]
    cams = inp["cams"]
    crown = np.asarray(inp["crown"])
    fc, fr, _ = proj(
        np.array([crown, inp["brow"], inp["menton"]]),
        cams["views"]["front"], sensor)
    pc, pr, _ = proj(
        np.array([crown, inp["brow"], inp["menton"]]),
        cams["views"]["profile_90"], sensor)
    landmarks = {
        "front": {"eye_row": float(fr[1]),
                  "chin_row": float(fr[2]),
                  "crown_top_row": float(fr[0]),
                  "face_centre_col": float(fc[2])},
        "profile": {"crown_top_row": float(pr[0]),
                    "chin_row": float(pr[2]),
                    "forehead_front_col": float(pc[1])}}
    guards = C2.INS.guard_definitions(landmarks)
    guards["back"] = {}
    boxes = C2.INS.guard_boxes_render(guards, inp["transforms"])
    refs = C2.INS.face_ref_depths(
        {"brow": inp["brow"], "menton": inp["menton"]}, cams)
    cover3 = {v: render_cover[v] for v in ("front", "profile_90",
                                           "back")}
    gates["faceGuards"] = C2.INS.face_guard_depth(cover3, refs, boxes)

    fails = []
    if gates["unreachable"] != 0:
        fails.append("unreachable=%d" % gates["unreachable"])
    if gates["boundaryFrac4mm"] > BOUNDARY_GATE:
        fails.append("boundary=%.4f" % gates["boundaryFrac4mm"])
    if gates["partCrossings"]["crossingsOver2mm"] != 0:
        fails.append("partCrossings=%d"
                     % gates["partCrossings"]["crossingsOver2mm"])
    if gates["backCentreGap"]["maxGapMm"] > GAP_GATE_MM:
        fails.append("backGap=%.1f" % gates["backCentreGap"]["maxGapMm"])
    if gates["faceGuards"]["totalCoveredPx"] != 0:
        fails.append("faceGuards=%d"
                     % gates["faceGuards"]["totalCoveredPx"])
    if not gates["ear"]["gate"]["pass"]:
        fails.append("ear near3 xpos/xneg=%d/%d covering=%d" % (
            gates["ear"]["xpos"]["nGuidesNear3mm"],
            gates["ear"]["xneg"]["nGuidesNear3mm"],
            gates["ear"]["occlusion"]["nGuidesCovering"]))
    for view in VIEWS4:
        s = reg[view]
        for m, lim in (("excessP50", REG_P50_PX),
                       ("excessP95", REG_P95_PX),
                       ("missP50", REG_P50_PX),
                       ("missP95", REG_P95_PX)):
            if s[m] > lim:
                fails.append("%s %s=%.1f" % (view, m, s[m]))
    f1 = gates["flowRelaxed"]
    if f1["p50"] > FLOW_P50_GATE or f1["p95"] > FLOW_P95_GATE:
        fails.append("flow p50/p95=%.1f/%.1f" % (f1["p50"], f1["p95"]))
    t1 = gates["turnRelaxed"]
    if t1["max"] > TURN_GATE:
        fails.append("turnMax=%.1f" % t1["max"])
    gates["verdict"] = "ADEQUATE" if not fails else "MODEL_INADEQUATE"
    gates["gateFails"] = fails
    (E2 / "gates.json").write_text(json.dumps(gates, indent=1) + "\n")
    print(json.dumps({k: v for k, v in gates.items()
                      if k != "regionalWholeMask"}, indent=1), flush=True)
    print("REGIONAL " + json.dumps(reg), flush=True)
    C2.write_inputs_log([S7 / "route2.py"])


def resample_arc41(pts, m=41):
    pts = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    total = seg.sum()
    if total <= 0:
        return np.repeat(pts[:1], m, axis=0)
    cum = np.concatenate([[0.0], np.cumsum(seg)]) / total
    t = np.linspace(0.0, 1.0, m)
    out = np.zeros((m, 3))
    j = 0
    for k in range(m):
        while j < len(seg) - 1 and cum[j + 1] < t[k]:
            j += 1
        f = 0.0 if cum[j + 1] == cum[j] else (
            (t[k] - cum[j]) / (cum[j + 1] - cum[j]))
        out[k] = pts[j] * (1 - f) + pts[j + 1] * f
    return out


def step_export():
    from PIL import Image, ImageDraw
    E2.mkdir(parents=True, exist_ok=True)
    C2.track(S7 / "route2.py")
    relax_sha = (E2 / "spec-sha-before-relax.txt").read_text().strip()
    assert relax_sha == sha_of_file(E2 / "route-spec.json"), \
        "relax spec drift!"
    P = np.load(str(E2 / "paths.npz"))
    assert str(P["spec_sha"][0]) == relax_sha
    n = len(P["roots_mm"])
    status = [str(s) for s in P["status"]]
    okidx = [i for i in range(n) if status[i] in ("relaxed", "fallback")]
    n_relaxed = sum(1 for s in status if s == "relaxed")
    n_fallback = sum(1 for s in status if s == "fallback")
    n_unreach = sum(1 for s in status if s == "unreachable")
    if n_fallback or n_unreach:
        print("WARN exporting %d/%d curves (%d fallback keep routed, "
              "%d unreachable have no curve); statuses recorded in "
              "guides.npz" % (len(okidx), n, n_fallback, n_unreach),
              flush=True)
    crown = np.asarray(P["crown"], dtype=np.float64)
    ch = np.zeros((len(okidx), 41, 3))
    for j, i in enumerate(okidx):
        c = np.array(P["curves_mm"][i])
        c = c[np.isfinite(c).all(axis=1)]
        ch[j] = C2.world_to_head(resample_arc41(c / 1000.0, 41), crown)
    gates = json.loads((E2 / "gates.json").read_text())
    np.savez_compressed(
        str(E2 / "guides.npz"), curves_head=ch, crown=crown,
        param_names=np.array(["tube_r"]),
        param_values=np.array([3.0]),
        spec_sha=np.array([relax_sha]),
        status=np.array(status),
        ok_idx=np.array(okidx, dtype=np.int64),
        roots_file=np.array(["hair-scalp1/roots.npz Poisson routed "
                             "on hull3"]),
        y_ear_mm=np.array([float(P["y_ear_mm"])]),
        verdict=np.array([gates.get("verdict", "MODEL_INADEQUATE")]))
    print("WROTE guides.npz bytes=%d" % (
        (E2 / "guides.npz").stat().st_size), flush=True)

    blender = "/Applications/Blender.app/Contents/MacOS/Blender"
    C2.track(C2.ROOT / "tools/openclinxr/hair-groom/guides"
             / "render_guides.py")
    C2.track(C2.ROOT / "apps/ui-xr/public/generated-humanoids/"
             "mpfb-peds-parent-aisha.glb")
    C2.track(C2.ROOT / "tools/openclinxr/hair-groom/manifests/"
             "cameras-scorer-v3.json")
    r = subprocess.run(
        [blender, "--background", "--python",
         str(C2.ROOT / "tools/openclinxr/hair-groom/guides"
             / "render_guides.py"),
         "--", "--guides-npz", str(E2 / "guides.npz"), "--outdir",
         str(E2),
         "--glb", str(C2.ROOT / "apps/ui-xr/public/generated-humanoids/"
                      "mpfb-peds-parent-aisha.glb"),
         "--cameras", str(C2.ROOT / "tools/openclinxr/hair-groom"
                          "/manifests/cameras-scorer-v3.json"),
         "--opened", str(E2 / "blender-opened.txt"), "--stem",
         "guides"],
        capture_output=True, text=True, timeout=1800)
    print(r.stdout[-2000:], flush=True)
    print(r.stderr[-1000:], flush=True)
    if r.returncode != 0:
        raise RuntimeError("blender render failed rc=%d" % r.returncode)
    assert (E2 / "guides.png").exists()
    for view in VIEWS4:
        assert (E2 / ("guides-%s.png" % view)).exists(), view

    # beside the aisha-v3 target tiles: per-view render/target pairs.
    scratch = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
                   "/target-views/aisha-v3")
    tiles = {"front": "target-front-a1.png",
             "three_quarter": "target-three_quarter-a1.png",
             "profile_90": "target-profile.png",
             "back": "target-back.png"}
    cols = []
    for view in VIEWS4:
        tp = scratch / tiles[view]
        C2.track(tp)
        ren = Image.open(E2 / ("guides-%s.png" % view)).convert("RGB")
        tgt = Image.open(tp).convert("RGB").resize((512, 512))
        col = Image.new("RGB", (512, 512 * 2 + 56), (16, 16, 16))
        col.paste(ren, (0, 28))
        col.paste(tgt, (0, 512 + 56))
        d = ImageDraw.Draw(col)
        d.text((8, 7), "route2 " + view, fill=(255, 255, 255))
        d.text((8, 512 + 35), "aisha-v3 target " + view,
               fill=(255, 255, 255))
        cols.append(col)
    fig = Image.new("RGB", (512 * 4, 512 * 2 + 56), (0, 0, 0))
    for i, col in enumerate(cols):
        fig.paste(col, (512 * i, 0))
    fig.save(E2 / "guides-vs-target.png")
    print("WROTE guides-vs-target.png", flush=True)
    C2.write_inputs_log([S7 / "route2.py", E2 / "guides.npz"])


def step_result():
    gates = json.loads((E2 / "gates.json").read_text())
    bands = json.loads((E2 / "bands.json").read_text())
    route_sha = (E2 / "spec-sha-before-route.txt").read_text().strip()
    relax_sha = (E2 / "spec-sha-before-relax.txt").read_text().strip()
    P = np.load(str(E2 / "paths.npz"))
    status = [str(s) for s in P["status"]]
    lines = []
    lines.append("hair-route2: routed + relaxed guides on the ear-tucked "
                 "hull (aisha-v3) -- RESULT")
    lines.append("=" * 78)
    lines.append("WRITE ROOTS: S7 = tools/openclinxr/hair-groom/route "
                 "(new route2.py + common2.py; route.py, relax.py, "
                 "gates.py, gates1.py, export.py, export1.py, "
                 "add_verdict.py, common.py untouched), "
                 "E = tools/openclinxr/evidence/hair-route2. No *.blend.")
    lines.append("INPUTS: hull3/hull.npz + scalp1 roots/scalp + cage1 "
                 "exact-SDF + cage1 body-depth (front/profile/back) + "
                 "hull3 workspace body-depth-3q + station-frame + "
                 "hull3 ear_pinna.npz + v4 manifest (masks sha-verified "
                 "at load) + Aisha GLB. Full runtime list: "
                 "E/inputs-opened.txt.")
    lines.append("METHOD: route0-method routing (same six-term cost, same "
                 "weights, spec %s) + route1-method relaxation (same "
                 "ladder/weights/accept, spec %s). Relax-spec change "
                 "vs route1: NONE (route1 RESULT recommends no "
                 "relax-spec change; its findings concern routing "
                 "resolution + flow-gate recalibration)."
                 % (route_sha[:12], relax_sha[:12]))
    lines.append("BANDS vs SHOULDER (z=1405): "
                 + json.dumps(bands))
    lines.append("GATES: " + json.dumps(
        {k: v for k, v in gates.items()
         if k not in ("regionalWholeMask", "ear")}, indent=1))
    lines.append("EAR: " + json.dumps(gates["ear"], indent=1))
    lines.append("REGIONAL (tubes vs aisha-v3 masks, whole-mask, gate "
                 "p50<=12 p95<=24 px): "
                 + json.dumps(gates["regionalWholeMask"]))
    nrel = sum(1 for s in status if s == "relaxed")
    nfb = sum(1 for s in status if s == "fallback")
    lines.append("RELAX: %d/%d relaxed, %d fallback (keep routed curve, "
                 "counted openly)" % (nrel, len(status), nfb))
    lines.append("MECHANISMS (all measured, see gates.json/bands.json): "
                 "(a) 50 unreachable: 38 accept-fail (10-36 mm leaders "
                 "cross air outside hull3's thin side shell; beyond-8mm "
                 "arc fails hull-occupancy check) + 12 search-fail (no "
                 "path within 600k expansions even with zero usage; "
                 "w_curve=16 turn bills explode in thin corridors). "
                 "40/50 are right-side (curtainR 14, backR 26): hull3 "
                 "itself is 4x asymmetric (below-shoulder sideL 4947 "
                 "vs sideR 1183 vox; CR hem pool a 50-voxel sliver at "
                 "z~1551 vs CL 125 at z~1443). Right dome reads bald "
                 "in front view (E/guides-front.png READ); dome "
                 "crossings 58 guides/1624 samples vs route1 68/2790. "
                 "Fix = rind-routing resolution (route1 RESULT "
                 "prescription), not exemption: exempting air "
                 "traversal would float hair off-scalp. "
                 "(b) 100 fallbacks (98 relax + 2 route): relaxed "
                 "splines corner-cut out of thin corridors (eroded "
                 "frac <0.95); cold-4x/nc14/wc8 ladder exhausted "
                 "(cold=147). Same corridor-structural class as "
                 "route1's 15, scaled by hull3's thinner shell. "
                 "(c) partCrossings=5 (max 4.1 mm): spline overshoot "
                 "near the centre part on relaxed guides (route0 max "
                 "1.41 dust). "
                 "(d) ear: 3D clearance fails on 4 guides (min 2.32/"
                 "1.70 mm) against hull3's own 2.17 mm carve floor: "
                 "the 3 mm bar is unsatisfiable by construction where "
                 "guides ride the rind. Occlusion (view-correct, "
                 "hull3 lineage): 10/309 guides with 1-5 grazing "
                 "samples covering pinna px; behind-vs-cover sample "
                 "ratio strongly behind (side hair passes behind the "
                 "ear; grazes = rind contact). Raw (x,z)-cylinder "
                 "counts were head-curvature artifact (temple surface "
                 "~26 mm anterior of pinna plane) and are superseded. "
                 "(e) regional: misses p95 57-113 px all views "
                 "(drape/shoulder mismatch: back hem ends z 1255-1275 "
                 "vs tucked mask; short high curtain tips CL z~1443/"
                 "CR z~1555); excess confined to ear zones (front "
                 "~22 px temple spill, profile ~19 px) EXCEPT 3q "
                 "523 px blob up to 268 px from boundary at rows "
                 "~571-579/cols ~271-288 (curtain-tip/drape mass "
                 "outside the tucked 3q silhouette low-left). "
                 "(f) flow 45.0/108 both routed+relaxed: route1's "
                 "gate-model finding stands (style reference itself "
                 "45.0 = 2.2x p50 gate; lateral-lay model vs "
                 "voluminous drape).")
    nok = int(np.load(str(E2 / "guides.npz"))["curves_head"].shape[0])
    lines.append("SAW: E/guides.png (Workbench thin tubes on Aisha, "
                 "topper excluded, 4 views) + E/guides-vs-target.png "
                 "(render beside aisha-v3 target tiles); "
                 "E/guides.npz (%d curves_head 41-pt head-mm, tube_r "
                 "3.0; 50 unreachable carried as status without "
                 "curves)." % nok)
    lines.append("NOT TESTED: physical Quest 3 / worn-headset evidence; "
                 "clinical validity, licensure, or scoring claims; "
                 "strands/material/lighting (guide tubes only); "
                 "guide interpolation density (comb gaps); whether "
                 "fallback entries interpolate acceptably.")
    lines.append("VERDICT: %s" % gates["verdict"])
    if gates["gateFails"]:
        lines.append("FAILURES: " + "; ".join(gates["gateFails"]))
    (E2 / "RESULT.txt").write_text("\n".join(lines) + "\n")
    (E2 / "DONE.txt").write_text(
        "hair-route2 done: verdict %s\n" % gates["verdict"])
    print("\n".join(lines), flush=True)
    C2.write_inputs_log([S7 / "route2.py"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True,
                    choices=["spec-graph", "route", "relax", "gates",
                             "export", "result"])
    args = ap.parse_args()
    t0 = time.time()
    if args.step == "spec-graph":
        print("SPEC_SHA %s" % step_spec_graph(), flush=True)
    elif args.step == "route":
        step_route()
    elif args.step == "relax":
        step_relax()
    elif args.step == "gates":
        step_gates()
    elif args.step == "export":
        step_export()
    else:
        step_result()
    print("STEP %s done in %.0fs" % (args.step, time.time() - t0),
          flush=True)


if __name__ == "__main__":
    main()

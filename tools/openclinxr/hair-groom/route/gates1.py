"""hair-route1 STEP 3: gates -> E/gates.json.

Recomputes every route0 routing gate on the relaxed curves, plus:
  flow gate    angle(tangent, expected flow) in the crown band,
               p50 <= 20 deg and p95 <= 40 deg (reported for
               route0 and route1);
  smoothness   max turn angle per 5 mm of arc <= 15 deg (route0
               value reported alongside), and no run longer than
               10 mm parallel to a 26-lattice axis unless that run
               also follows the expected flow (counts reported).
Regional tube scores are reported but NOT gated (target mesh is
being replaced in another worktree).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

import common as C
import gates as G

S7 = Path(__file__).resolve().parent
E = C.ROOT / "tools/openclinxr/evidence/hair-route1"
E0 = C.E
FRAME = 1024
CROWN_BAND = (1570.0, 1640.0)
FLOW_P50_GATE = 20.0
FLOW_P95_GATE = 40.0
TURN_GATE = 15.0
LATTICE_TOL_DEG = 5.0
LATTICE_RUN_MM = 10.0
LATTICE_FLOW_EXEMPT_DEG = 15.0
GAP_GATE_MM = 20.0
BOUNDARY_GATE = 0.5

OFFSETS = np.array(
    [[dx, dy, dz] for dx in (-1, 0, 1) for dy in (-1, 0, 1)
     for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 1 - 1)],
    dtype=np.float64)
_seen = set()
AXES = []
for v in OFFSETS:
    n = v / np.linalg.norm(v)
    if any(abs((n * s).sum()) > 1 - 1e-9 for s in _seen):
        continue
    _seen.add(tuple(n))
    AXES.append(n)
AXES = np.array(AXES)  # 13 axes


def write_inputs_log(extra=()):
    E.mkdir(parents=True, exist_ok=True)
    seen = set()
    dest = E / "inputs-opened.txt"
    if dest.exists():
        seen.update(dest.read_text().splitlines())
    seen.update(C.OPENED)
    seen.update(str(Path(p).resolve()) for p in extra)
    dest.write_text("\n".join(sorted(seen)) + "\n")


def load_curves(Ep):
    P = np.load(str(Ep / "paths.npz"))
    n = len(P["roots_mm"])
    curves = [np.array(P["curves_mm"][i]) for i in range(n)]
    curves = [c[np.isfinite(c).all(axis=1)] for c in curves]
    return P, curves


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


def turn5_of_curve(c):
    pts = resample_1mm(c)
    T = np.diff(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    if len(T) < 6:
        return np.zeros(0)
    d = (T[5:] * T[:-5]).sum(axis=1).clip(-1, 1)
    return np.degrees(np.arccos(d))


def turn_stats(curves):
    per_guide_max = np.array([turn5_of_curve(c).max()
                              if turn5_of_curve(c).size else 0.0
                              for c in curves])
    allv = np.concatenate([turn5_of_curve(c) for c in curves
                           if turn5_of_curve(c).size])
    q = lambda a, p: round(float(np.percentile(a, p)), 2) if a.size else 0.0
    return {"max": round(float(per_guide_max.max()), 2),
            "p95": q(allv, 95), "p50": q(allv, 50),
            "fracGuidesOver15": round(float((per_guide_max > 15).mean()), 4),
            "nGuidesOver15": int((per_guide_max > 15).sum()),
            "gate": TURN_GATE}


# ------------------------------------------------------------- expected flow
def scalp_normals(inp):
    verts = np.array(inp["scalp"]["verts"], dtype=np.float64) * 1000.0
    tris = np.array(inp["scalp"]["tris"], dtype=np.int64)
    a = verts[tris[:, 0]]
    n = np.cross(verts[tris[:, 1]] - a, verts[tris[:, 2]] - a)
    area = np.linalg.norm(n, axis=1, keepdims=True)
    area[area == 0] = 1.0
    n /= area
    vn = np.zeros_like(verts)
    np.add.at(vn, tris[:, 0], n)
    np.add.at(vn, tris[:, 1], n)
    np.add.at(vn, tris[:, 2], n)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True) + 1e-12
    return verts, vn


def expected_flow(pts, roots_x, arc, verts, vn, tree):
    """Expected lock direction: on-scalp lateral (±x vs centre part,
    projected on the scalp tangent) near the root, blending to
    gravity past the release. Release is ARC distance from the root
    (lay zone arc < 15 mm, full gravity beyond 45 mm): route0
    band-samples (good-style reference) run mean|vertical|
    0.55 -> 0.68 over arc 0-40, i.e. locks clear the scalp within
    ~15-45 mm of arc and a z-level release mislabels voluminous
    fall (vertical through the band) as lay error."""
    pts = np.asarray(pts, dtype=np.float64)
    arc = np.asarray(arc, dtype=np.float64)
    _, vi = tree.query(pts)
    n = vn[vi]
    side = np.where(roots_x >= 0, 1.0, -1.0)[:, None]
    lat = np.concatenate([side, np.zeros((len(pts), 2))], axis=1)
    proj = lat - (lat * n).sum(axis=1, keepdims=True) * n
    bad = np.linalg.norm(proj, axis=1) < 1e-6
    proj[bad] = lat[bad]
    proj /= np.linalg.norm(proj, axis=1, keepdims=True) + 1e-12
    a = np.clip((arc - 15.0) / 30.0, 0, 1)
    a = 0.5 - 0.5 * np.cos(a * np.pi)
    g = np.array([0.0, 0.0, -1.0])
    exp = (1 - a)[:, None] * proj + a[:, None] * g
    exp /= np.linalg.norm(exp, axis=1, keepdims=True) + 1e-12
    return exp


def flow_angles(curves, roots_mm, verts, vn, tree):
    angs = []
    for i, c in enumerate(curves):
        pts = resample_1mm(c)
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        sel = ((pts[:-1, 2] >= CROWN_BAND[0])
               & (pts[:-1, 2] <= CROWN_BAND[1]))
        if not sel.any():
            continue
        T = np.diff(pts, axis=0)[sel]
        T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
        rx = np.full(sel.sum(), float(roots_mm[i, 0]))
        exp = expected_flow(pts[:-1][sel], rx, arc[:-1][sel],
                            verts, vn, tree)
        d = (T * exp).sum(axis=1).clip(-1, 1)
        angs.append(np.degrees(np.arccos(d)))
    v = np.concatenate(angs) if angs else np.zeros(0)
    q = lambda a, p: round(float(np.percentile(a, p)), 2) if a.size else 0.0
    return {"p50": q(v, 50), "p95": q(v, 95), "n": int(v.size),
            "p50gate": FLOW_P50_GATE, "p95gate": FLOW_P95_GATE,
            "releaseRule": "arc from root: lateral below 15 mm, "
                           "gravity beyond 45 mm (cosine blend)"}


def lattice_runs(curves, roots_mm, verts, vn, tree):
    tol = np.cos(np.radians(LATTICE_TOL_DEG))
    n_runs = 0
    n_viol = 0
    max_run = 0.0
    for i, c in enumerate(curves):
        pts = resample_1mm(c)
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        arc = np.concatenate([[0.0], np.cumsum(seg)])
        T = np.diff(pts, axis=0)
        T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
        cos = np.abs(T @ AXES.T)
        best = cos.argmax(axis=1)
        aligned = cos.max(axis=1) >= tol
        k = 0
        while k < len(T):
            if not aligned[k]:
                k += 1
                continue
            j = k
            while j < len(T) and aligned[j] and best[j] == best[k]:
                j += 1
            run_len = float(j - k)  # 1 sample per mm
            max_run = max(max_run, run_len)
            if run_len > LATTICE_RUN_MM:
                n_runs += 1
                mid = (pts[k:j + 1]).mean(axis=0, keepdims=True)
                rx = np.array([float(roots_mm[i, 0])])
                amd = np.array([(arc[k] + arc[j]) / 2.0])
                exp = expected_flow(mid, rx, amd, verts, vn, tree)
                tm = T[k:j].mean(axis=0)
                tm /= np.linalg.norm(tm) + 1e-12
                ang = float(np.degrees(np.arccos(
                    np.clip(abs(tm @ exp[0]), -1, 1))))
                if ang > LATTICE_FLOW_EXEMPT_DEG:
                    n_viol += 1
            k = j
    return {"nRunsOver10mm": n_runs, "nViolations": n_viol,
            "maxRunMm": round(max_run, 1),
            "tolDeg": LATTICE_TOL_DEG, "runGateMm": LATTICE_RUN_MM}


def main():
    E.mkdir(parents=True, exist_ok=True)
    C.track(S7 / "gates1.py")
    C.track(S7 / "gates.py")
    C.track(E0 / "paths.npz")
    C.track(E / "paths.npz")
    inp = C.load_all()
    P1, curves1 = load_curves(E)
    P0, curves0 = load_curves(E0)
    sha = (E / "spec-sha-before-relax.txt").read_text().strip()
    assert str(P1["spec_sha"][0]) == sha
    assert str(P1["route0_spec_sha"][0]) == str(P0["spec_sha"][0])
    n = len(curves1)
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
             "specSha": sha, "route0SpecSha": str(P0["spec_sha"][0])}
    # route0 gates, recomputed on the relaxed curves (same ends/graph)
    gates["endpointCoverage"] = G.endpoint_coverage(P1)
    gates["boundaryFrac4mm"] = round(G.boundary_frac(
        curves1, occ, xs, ys, zs, 2.0), 4)
    gates["boundaryGate"] = BOUNDARY_GATE
    gates["crownTangentLegacy"] = G.crown_tangent(curves1)
    gates["partCrossings"] = G.part_crossings(P1, curves1)
    gates["backCentreGap"] = G.back_gap(P1)
    gates["backCentreGapGateMm"] = GAP_GATE_MM
    leader = np.array(P1["leader_mm"], dtype=np.float64)
    gates["leaderMm"] = {"max": round(float(leader.max()), 2),
                         "p95": round(float(np.percentile(leader, 95)), 2),
                         "p50": round(float(np.percentile(leader, 50)), 2),
                         "nOver8mm": int((leader > 8).sum())}
    gates["yEarMm"] = float(P1["y_ear_mm"])

    # end displacement vs routed ends
    ends = np.array(P1["ends"])
    ex = np.array(np.load(str(E0 / "graph.npz"))["node_xyz"])[ends]
    disp = np.array([float(np.linalg.norm(
        curves1[i][-1] - ex[i])) for i in range(n)])
    gates["endDisplacementMm"] = {
        "max": round(float(disp.max()), 2),
        "p95": round(float(np.percentile(disp, 95)), 2),
        "p50": round(float(np.percentile(disp, 50)), 2)}

    # body/hull clearance beyond 8 mm (penalty targets, reported
    # vs route0; accept keeps the route0 SDF > 0 rule)
    from relax import trilinear, build_hull_sdf
    hsdf_grid = build_hull_sdf(occ, 2.0)
    origin = np.array([xs[0], ys[0], zs[0]])

    def clearance(curves):
        bmins, hmins, efrac = [], [], []
        for c in curves:
            seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
            arc = np.concatenate([[0.0], np.cumsum(seg)])
            b = c[arc > 8]
            sdf = np.zeros(len(b))
            for a in range(0, len(b), 200_000):
                sdf[a:a + 200_000] = C.EXACT.query_exact(
                    inp["egrid"], b[a:a + 200_000])
            hh = trilinear(hsdf_grid, origin, 2.0, b)
            bmins.append(float(sdf.min()))
            hmins.append(float(hh.min()))
            efrac.append(float(((hh >= 3.0) & (sdf > 0)).mean()))
        return (np.array(bmins), np.array(hmins), np.array(efrac))

    bmins, hmins, efrac = clearance(curves1)
    bmins0, hmins0, efrac0 = clearance(curves0)
    gates["bodyClearanceMm"] = {
        "min": round(float(bmins.min()), 2),
        "p5": round(float(np.percentile(bmins, 5)), 2),
        "fracBelow3": round(float((bmins < 3).mean()), 4),
        "route0min": round(float(bmins0.min()), 2),
        "route0fracBelow3": round(float((bmins0 < 3).mean()), 4)}
    gates["hullSdfMm"] = {
        "min": round(float(hmins.min()), 2),
        "p5": round(float(np.percentile(hmins, 5)), 2),
        "fracBelow3": round(float((hmins < 3).mean()), 4),
        "route0min": round(float(hmins0.min()), 2)}
    gates["erodedFrac"] = {
        "min": round(float(efrac.min()), 4),
        "route0min": round(float(efrac0.min()), 4),
        "gate": 0.95}

    # flow + smoothness, route0 vs route1
    verts, vn = scalp_normals(inp)
    tree = cKDTree(verts)
    roots_mm = np.array(P1["roots_mm"])
    gates["crownBandMm"] = list(CROWN_BAND)
    gates["flowRoute0"] = flow_angles(
        curves0, np.array(P0["roots_mm"]), verts, vn, tree)
    gates["flowRoute1"] = flow_angles(
        curves1, roots_mm, verts, vn, tree)
    gates["turnRoute0"] = turn_stats(curves0)
    gates["turnRoute1"] = turn_stats(curves1)
    gates["latticeRoute0"] = lattice_runs(
        curves0, np.array(P0["roots_mm"]), verts, vn, tree)
    gates["latticeRoute1"] = lattice_runs(curves1, roots_mm, verts, vn, tree)

    # regional scores, reported not gated
    render_cover = G.tube_raster(curves1, np.asarray(P1["crown"]), inp)
    body_maps = {v: (np.array(inp["body"][v]["cover"], dtype=bool),
                       np.array(inp["body"][v]["depth"], dtype=np.float64))
                  for v in ("front", "profile_90", "back")}
    union = C.INS.occluded_union(render_cover, body_maps, inp["transforms"])
    regions = C.INS.region_definitions(inp["landmarks"])
    rmasks = C.INS.region_masks(regions)
    poke = G.scalp_poke_masks(inp)
    gates["pokePx"] = {v: int(poke[v].sum())
                       for v in ("front", "profile_90", "back")}
    reg = {}
    for view in ("front", "profile_90", "back"):
        reg[view] = {}
        tgt = np.array(inp["masks"][view], dtype=bool)
        for name in ("crown", "side_curtain_L", "side_curtain_R", "hem",
                     "face_opening"):
            m = (rmasks[view][name] if name in rmasks[view]
                 else np.zeros((FRAME, FRAME), dtype=bool))
            stats, _ = G.regional_pq(union[view] & m, tgt & m)
            reg[view][name] = stats
    gates["regional"] = reg
    guards = C.INS.guard_definitions(inp["landmarks"])
    boxes = C.INS.guard_boxes_render(guards, inp["transforms"])
    refs = C.INS.face_ref_depths(
        {"brow": inp["brow"], "menton": inp["menton"]}, inp["cams"])
    gates["faceGuards"] = C.INS.face_guard_depth(render_cover, refs, boxes)

    # verdict: smoothness + flow + route0 routing gates (regional NOT gated)
    fails = []
    if gates["unreachable"] != 0:
        fails.append("unreachable=%d" % gates["unreachable"])
    if gates["nFallback"] != 0:
        fails.append("fallback=%d" % gates["nFallback"])
    if gates["boundaryFrac4mm"] > BOUNDARY_GATE:
        fails.append("boundary=%.4f" % gates["boundaryFrac4mm"])
    if gates["partCrossings"]["crossingsOver2mm"] != 0:
        fails.append("partCrossings=%d"
                     % gates["partCrossings"]["crossingsOver2mm"])
    if gates["backCentreGap"]["maxGapMm"] > GAP_GATE_MM:
        fails.append("backGap=%.1f" % gates["backCentreGap"]["maxGapMm"])
    if gates["faceGuards"]["totalCoveredPx"] != 0:
        fails.append("faceGuards=%d" % gates["faceGuards"]["totalCoveredPx"])
    if gates["erodedFrac"]["min"] < 0.95:
        fails.append("erodedFrac=%.3f" % gates["erodedFrac"]["min"])
    f1 = gates["flowRoute1"]
    if f1["p50"] > FLOW_P50_GATE or f1["p95"] > FLOW_P95_GATE:
        fails.append("flow p50/p95=%.1f/%.1f" % (f1["p50"], f1["p95"]))
    t1 = gates["turnRoute1"]
    if t1["max"] > TURN_GATE:
        fails.append("turnMax=%.1f" % t1["max"])
    if gates["latticeRoute1"]["nViolations"] != 0:
        fails.append("latticeViol=%d"
                     % gates["latticeRoute1"]["nViolations"])
    gates["verdict"] = "ADEQUATE" if not fails else "MODEL_INADEQUATE"
    gates["gateFails"] = fails
    (E / "gates.json").write_text(json.dumps(gates, indent=1) + "\n")
    print(json.dumps({k: v for k, v in gates.items()
                      if k != "regional"}, indent=1), flush=True)
    print("REGIONAL " + json.dumps(reg), flush=True)
    write_inputs_log([S7 / "gates1.py"])


if __name__ == "__main__":
    main()

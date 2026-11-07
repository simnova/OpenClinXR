#!/usr/bin/env python3
"""Guide-field fit: regional contour + depth guard + exact collision.

Reuses by import (never copied): the station projector (envelope), the
registration similarities (register via instruments), regional losses,
the occluded raster warp, the depth-aware face guard (instruments), and
the exact SDF (exact + hair-cage1/body-exact-sdf.npz).

Objective (scipy least_squares, trf, bounded): fixed-length residuals
  - regional: per (view, region, excess/miss side) k=150 sampled
    Huber(3px) contour distances on the OCCLUDED tube raster (front hem
    rows are an occlusion edge: hair behind the shoulders must not be
    penalised in front);
  - face guard: depth-aware covered px (instruments.face_guard_depth);
  - collision: exact-field inside count + fall projection beyond 10 mm;
  - part pinning: per-guide part-plane crossing indicator (gated 0);
  - acromion routing: per-guide side-sector waypoint-anterior hinge;
  - regularizers: fall curvature, neighbour-smoothness (az-sorted
    release/end/waypoint drops), soft mirror symmetry (end drops).

Modes: all | loo-front | loo-profile_90 | loo-back.
Writes E/fit-<mode>.json. No rendering here (figures + Blender after).
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
from scipy.optimize import least_squares

S4 = Path(__file__).resolve().parent
ROOT = S4.parents[3]
sys.path.insert(0, str(S4))
sys.path.insert(0, str(S4.parent / "cage"))
sys.path.insert(0, str(S4.parent))
import grow as GROW  # noqa: E402
import instruments as INS  # noqa: E402
import exact as EXACT  # noqa: E402
import envelope as ENV  # noqa: E402

K = 150
DELTA = 3.0
GUARD_SCALE = {"front": 3.0, "profile_90": 0.5}
COLL_SCALE = 8.0
PROJ_SCALE = 8.0  # per-mm beyond the 10 mm projection gate (max term)
PROJ_MEAN_SCALE = 2.0  # per-mm mean fall projection (smooth signal)
CROSS_SCALE = 60.0  # per part-plane-crossing guide (fixed-length G terms)
ACR_SCALE = 3.0  # per-mm acromion hinge (side-sector waypoint anterior)
W_CURV = 0.02
W_NEIGH = 0.10
W_SYM = 0.10
RASTER_STEP_MM = 4.0  # raster resample spacing (growth stays 41/guide)
RASTER_BUDGET = 26000  # max raster points total; step grows deterministically

OPENED = []


def track(path):
    OPENED.append(str(Path(path).resolve()))
    return Path(path)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sample_fixed(dists, k=K):
    dists = np.asarray(dists, dtype=np.float64)
    if dists.size == 0:
        return np.zeros(k)
    idx = np.linspace(0, dists.size - 1, min(dists.size, k)).astype(int)
    sel = dists[idx]
    if sel.size >= k:
        return sel
    reps = int(np.ceil(k / sel.size))
    return np.tile(sel, reps)[:k]


def huber(d, delta=DELTA):
    a = np.abs(np.asarray(d, dtype=np.float64))
    return np.where(a <= delta, 0.5 * a * a / delta, a - 0.5 * delta)


class Context:
    def __init__(self, evidence, roots_name="roots-v2.npz"):
        manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                               / "aisha_straight_long.json").read_text())
        cams_path = track(ROOT / manifest["camerasFile"]["path"])
        assert sha256_file(cams_path) == manifest["camerasFile"]["sha256"]
        self.cams = INS.load_cameras(str(cams_path))
        self.transforms = INS.transforms_of(self.cams)
        self.sensor = INS.sensor_of(self.cams)
        cage1 = ROOT / "tools/openclinxr/evidence/hair-cage1"
        bdepth = np.load(str(track(cage1 / "body-depth.npz")))
        self.body_maps = {}
        for v in INS.VIEWS:
            self.body_maps[v] = (
                np.array(bdepth["%s/cover" % v], dtype=bool),
                np.array(bdepth["%s/depth" % v], dtype=np.float64))
        land_path = track(Path(manifest["targets"]["landmarks"]["path"]))
        assert sha256_file(land_path) == manifest["targets"][
            "landmarks"]["sha256"]
        self.landmarks = json.loads(land_path.read_text())
        self.targets = {}
        for v in INS.VIEWS:
            mp = track(Path(manifest["targets"]["masks"][v]["path"]))
            assert sha256_file(mp) == manifest["targets"]["masks"][v][
                "sha256"], "mask sha mismatch %s" % v
            from PIL import Image
            self.targets[v] = np.asarray(
                Image.open(mp).convert("L")) > 127
        spec_path = track(evidence / "guide-spec.json")
        self.spec = json.loads(spec_path.read_text())
        self.spec_sha = sha256_file(spec_path)
        self.names = GROW.param_names(self.spec)
        cage_spec_path = track(cage1 / "cage-spec.json")
        cage_spec = json.loads(cage_spec_path.read_text())
        self.anchors = cage_spec["anchors"]
        self.crown = cage_spec["crown"]
        self.egrid = EXACT.load_exact(str(track(
            cage1 / "body-exact-sdf.npz")))
        self.roots = GROW.load_roots(str(track(
            evidence / roots_name)))
        track(S4 / "grow.py")
        track(S4 / "fit_guides.py")
        self.regions = INS.region_definitions(self.landmarks)
        self.masks = INS.region_masks(self.regions)
        self.guards = INS.guard_definitions(self.landmarks)
        self.boxes_render = INS.guard_boxes_render(
            self.guards, self.transforms)
        frame = np.load(str(track(Path(
            "/tmp/station0b-run/station-frame.npz"))))
        self.refs = INS.face_ref_depths(
            {"brow": np.array(frame["point3d/brow"]),
             "menton": np.array(frame["point3d/menton"])}, self.cams)
        self.menton_z_mm = float(frame["point3d/menton"][2]) * 1000.0
        self.tbt = {}
        self.tedt = {}
        for v in INS.VIEWS:
            bt = INS.boundary(self.targets[v])
            self.tbt[v] = bt
            self.tedt[v] = ndimage.distance_transform_edt(~bt)
        self.bounds = ([self.spec["params"][i]["lo"]
                        for i in range(len(self.names))],
                       [self.spec["params"][i]["hi"]
                        for i in range(len(self.names))])
        self.ranges = np.array(self.bounds[1]) - np.array(self.bounds[0])
        # mirror pairs for the soft-symmetry regularizer (az <-> -az)
        az = np.degrees(np.arctan2(self.roots["pos"][:, 0],
                                    self.roots["pos"][:, 1]))
        self.az = az
        self.order = np.argsort(az)
        used = np.zeros(len(az), dtype=bool)
        pairs = []
        for i in range(len(az)):
            if used[i]:
                continue
            best, bd = -1, 1e9
            for j in range(len(az)):
                if used[j] or i == j:
                    continue
                d = abs(az[i] + az[j])
                if d < bd:
                    bd, best = d, j
            if best >= 0 and bd < 12.0:
                used[i] = used[best] = True
                pairs.append((i, best))
        self.sym_pairs = np.array(pairs, dtype=np.int64)
        # per-view focal px for the tube-radius projection
        self.focal = {}
        for v in INS.VIEWS:
            self.focal[v] = (float(self.cams["views"][v]["lensMm"])
                             / float(self.sensor) * INS.FRAME)


def resample_guides(curves_head, step_mm=RASTER_STEP_MM):
    """Resample each guide polyline at <= step_mm for raster coverage.

    Total points are capped at RASTER_BUDGET (step grows by 1.5x until
    the cap holds): bounds the per-eval numpy disc-splat cost no matter
    where the optimizer wanders. Deterministic given the curves."""
    step = float(step_mm)
    while True:
        out, total = [], 0
        for line in curves_head:
            seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
            total_seg = seg.sum()
            n = max(int(np.ceil(total_seg / step)) + 1, 2)
            total += n
            t = np.linspace(0.0, 1.0, n)
            cum = np.concatenate([[0.0], np.cumsum(seg)])
            idx = np.clip(np.searchsorted(cum, t * total_seg) - 1,
                          0, len(seg) - 1)
            frac = np.zeros_like(t)
            for k in range(n):
                lo, hi = cum[idx[k]], cum[idx[k] + 1]
                frac[k] = 0.0 if hi == lo else (
                    t[k] * total_seg - lo) / (hi - lo)
            out.append(line[idx] * (1 - frac)[:, None]
                       + line[idx + 1] * frac[:, None])
        if total <= RASTER_BUDGET:
            return out
        step *= 1.5


def splat_discs(cover, depth, cols, rows, dep, rad):
    """Depth-tested disc splat of tube samples into render-frame buffers."""
    H, W = cover.shape
    for x, y, d, r in zip(cols, rows, dep, rad):
        if not np.isfinite(d) or d <= 0:
            continue
        r = max(float(r), 0.6)
        xi, yi = int(round(x)), int(round(y))
        if r < 1.2:
            if 0 <= xi < W and 0 <= yi < H:
                if d < depth[yi, xi]:
                    depth[yi, xi] = d
                cover[yi, xi] = True
            continue
        xlo, xhi = max(int(x - r), 0), min(int(x + r), W - 1)
        ylo, yhi = max(int(y - r), 0), min(int(y + r), H - 1)
        if xhi < xlo or yhi < ylo:
            continue
        yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
        inside = (xx - x) ** 2 + (yy - y) ** 2 <= r * r
        if not inside.any():
            continue
        sub = depth[ylo:yhi + 1, xlo:xhi + 1]
        upd = inside & (d < sub)
        sub[upd] = d
        cov = cover[ylo:yhi + 1, xlo:xhi + 1]
        cov |= inside
        cover[ylo:yhi + 1, xlo:xhi + 1] = cov


def rasterize(ctx, grown, tube_r, views):
    """Tube raster per view: resampled discs, depth-tested vs the body.

    Returns ({view: target visible mask}, {view: (cover, depth)})."""
    curves = grown["curves_head"]
    lines = resample_guides(curves)
    pts_head = np.vstack(lines)
    pts_world = GROW.head_to_world(pts_head, ctx.crown)
    render_cov = {}
    for v in views:
        cols, rows, dep = ENV.project_to_render(
            pts_world, ctx.cams["views"][v], ctx.sensor)
        rad = (float(tube_r) / 1000.0) * ctx.focal[v] / np.maximum(
            dep, 1e-6)
        # body-occlusion pre-test (vectorized): hair visible iff in front
        bcover, bdepth = ctx.body_maps[v]
        ci = np.clip(np.rint(cols).astype(np.int64), 0, INS.FRAME - 1)
        ri = np.clip(np.rint(rows).astype(np.int64), 0, INS.FRAME - 1)
        vis = bcover[ri, ci] & (dep < bdepth[ri, ci] - 0.0005)
        vis |= ~bcover[ri, ci]  # no body along the ray: visible
        cover = np.zeros((INS.FRAME, INS.FRAME), dtype=bool)
        depth = np.full((INS.FRAME, INS.FRAME), np.inf)
        sel = vis & (dep > 0)
        splat_discs(cover, depth, cols[sel], rows[sel], dep[sel],
                    rad[sel])
        render_cov[v] = (cover, depth)
    union = INS.occluded_union(render_cov, ctx.body_maps, ctx.transforms,
                               views=views)
    return union, render_cov


def regional_residuals(ctx, union, views):
    parts = []
    for v in views:
        fitted = union[v]
        bf = INS.boundary(fitted)
        edt_f = ndimage.distance_transform_edt(~bf)
        for name in ctx.regions[v]:
            mask = ctx.masks[v][name]
            fr, fc = np.nonzero(bf & mask)
            tr, tc = np.nonzero(ctx.tbt[v] & mask)
            tgt = ctx.targets[v]
            de = ctx.tedt[v][fr, fc][~tgt[fr, fc]] \
                if fr.size else np.zeros(0)
            dm = edt_f[tr, tc][~fitted[tr, tc]] \
                if tr.size else np.zeros(0)
            parts.append(huber(sample_fixed(de)))
            parts.append(huber(sample_fixed(dm)))
    return np.concatenate(parts)


def regularizer_parts(ctx, grown):
    curves = grown["curves_head"]
    J = int(ctx.spec.get("shellSamples", 12))
    fall = curves[:, J:, :]
    seg = np.linalg.norm(np.diff(fall, axis=1), axis=2)
    seg = np.maximum(seg.mean(axis=1, keepdims=True), 1e-9)
    curv = np.diff(fall, n=2, axis=1) / seg[:, None, :]
    r_curv = (curv.reshape(-1) * W_CURV)
    d_end = grown["d_end"][ctx.order]
    d_rel = grown["d_rel"][ctx.order]
    u_wp = grown["u_wp"][ctx.order]
    r_neigh = np.concatenate(
        [np.diff(d_end) / 20.0, np.diff(d_rel) / 20.0,
         np.diff(u_wp) / 20.0]) * W_NEIGH
    if ctx.sym_pairs.size:
        de = grown["d_end"]
        r_sym = np.array([(de[i] - de[j]) / 30.0
                          for i, j in ctx.sym_pairs]) * W_SYM
    else:
        r_sym = np.zeros(0)
    return r_curv, r_neigh, r_sym


def objective(ctx, values, views):
    grown = GROW.grow_guides(values, ctx.spec, ctx.roots, ctx.egrid,
                             ctx.anchors)
    p = dict(zip(ctx.names, [float(v) for v in values]))
    # raster + guard always on all views (guard is a view-independent
    # safety constraint, never part of the LOO verdict); regional
    # contour terms only on the requested (train) views.
    union, render_cov = rasterize(ctx, grown, p["tube_r"], INS.VIEWS)
    res = [regional_residuals(ctx, union, views)]
    guard = INS.face_guard_depth(render_cov, ctx.refs, ctx.boxes_render)
    g = {}
    for v in views:
        if v in GUARD_SCALE and v in render_cov:
            g[v] = guard[v]["coveredPx"] * GUARD_SCALE[v]
    for v in sorted(g):
        res.append(np.array([g[v]]))
    pen = [max(0.0, -grown["min_sdf_mm"]) * COLL_SCALE]
    pen.append(max(0.0, grown["max_proj_fall_mm"] - 10.0) * PROJ_SCALE)
    fall_proj = grown["proj_dist"][:, int(ctx.spec.get("shellSamples", 12)):]
    pen.append(float(fall_proj.mean()) * PROJ_MEAN_SCALE)
    pen.append(max(0.0, grown["n_inside_mm"]) * COLL_SCALE)
    res.append(np.array(pen))
    # part-plane pinning + acromion routing: fixed-length per-guide terms
    # (G is fixed given the roots file, so least_squares stays well-posed)
    cross = np.zeros(grown["curves_head"].shape[0])
    cross[grown["cross_idx"]] = CROSS_SCALE
    res.append(cross)
    res.append(np.asarray(grown["acr_hinge"], dtype=np.float64)
               * ACR_SCALE)
    for part in regularizer_parts(ctx, grown):
        res.append(np.asarray(part, dtype=np.float64))
    return np.concatenate(res), grown, union, guard


EVAL_N = 0
EVAL_T = 0.0


def fun_only(ctx, values, views):
    global EVAL_N, EVAL_T
    import time as _t
    t0 = _t.time()
    r, _, _, _ = objective(ctx, values, views)
    EVAL_T += _t.time() - t0
    EVAL_N += 1
    if EVAL_N % 25 == 0:
        print("EVAL %d mean_secs=%.1f" % (EVAL_N, EVAL_T / EVAL_N),
              flush=True)
    return r


def adequacy(ctx, values, views=INS.VIEWS):
    grown = GROW.grow_guides(values, ctx.spec, ctx.roots, ctx.egrid,
                             ctx.anchors)
    p = dict(zip(ctx.names, [float(v) for v in values]))
    union, render_cov = rasterize(ctx, grown, p["tube_r"], views)
    per_view = {}
    for v in views:
        fitted = union[v]
        bf = INS.boundary(fitted)
        edt_f = ndimage.distance_transform_edt(~bf)
        regs = {}
        for name in ctx.regions[v]:
            mask = ctx.masks[v][name]
            fr, fc = np.nonzero(bf & mask)
            tr, tc = np.nonzero(ctx.tbt[v] & mask)
            tgt = ctx.targets[v]
            de = ctx.tedt[v][fr, fc][~tgt[fr, fc]] \
                if fr.size else np.zeros(0)
            dm = edt_f[tr, tc][~fitted[tr, tc]] \
                if tr.size else np.zeros(0)
            pool = np.concatenate([de, dm]) if de.size + dm.size \
                else np.zeros(0)
            regs[name] = {
                "p50": round(float(np.median(pool)), 2) if pool.size else 0.0,
                "p95": round(float(np.quantile(pool, 0.95)), 2)
                if pool.size else 0.0,
                "n": int(pool.size),
                "excessMeanPx": round(float(de.mean()), 2) if de.size else 0.0,
                "excessMaxPx": round(float(de.max()), 2) if de.size else 0.0,
                "excessN": int((de > 0).sum()),
                "missMeanPx": round(float(dm.mean()), 2) if dm.size else 0.0,
                "missMaxPx": round(float(dm.max()), 2) if dm.size else 0.0,
                "missN": int((dm > 0).sum()),
            }
        per_view[v] = regs
    full_cov = dict(render_cov)
    if tuple(views) != tuple(INS.VIEWS):
        _, full_cov = rasterize(ctx, grown, p["tube_r"], INS.VIEWS)
    guard = INS.face_guard_depth(full_cov, ctx.refs, ctx.boxes_render)
    proj = {"n_proj_shell": grown["n_proj_shell"],
            "max_proj_shell_mm": grown["max_proj_shell_mm"],
            "n_proj_fall": grown["n_proj_fall"],
            "max_proj_fall_mm": grown["max_proj_fall_mm"],
            "min_sdf_mm": grown["min_sdf_mm"],
            "n_inside_mm": grown["n_inside_mm"],
            "n_cross_part": grown["n_cross_part"],
            "n_acr_viol": grown["n_acr_viol"],
            "n_side_sector": int(grown["side_sector"].sum())}
    return {"regional": per_view, "guard": guard, "projection": proj,
            "guideHash": GROW.guide_hash(grown)}


def gate_report(adeq, values, spec, views=INS.VIEWS, regional_only=False):
    fails = []
    for v in views:
        for name, r in adeq["regional"][v].items():
            if r["p95"] > 24.0 or r["p50"] > 12.0:
                fails.append("%s/%s p50=%.1f p95=%.1f" % (
                    v, name, r["p50"], r["p95"]))
    if regional_only:
        return fails
    if adeq["guard"]["front"]["coveredPx"] != 0:
        fails.append("front guard covered=%d" % (
            adeq["guard"]["front"]["coveredPx"]))
    if adeq["guard"]["profile_90"]["coveredPx"] != 0:
        fails.append("profile guard covered=%d" % (
            adeq["guard"]["profile_90"]["coveredPx"]))
    pr = adeq["projection"]
    if pr["n_inside_mm"] != 0:
        fails.append("exact collision inside=%d min_sdf=%.2fmm" % (
            pr["n_inside_mm"], pr["min_sdf_mm"]))
    if pr["max_proj_fall_mm"] > 10.0:
        fails.append("fall projection max=%.2fmm > 10mm" % (
            pr["max_proj_fall_mm"]))
    if pr["n_cross_part"] != 0:
        fails.append("part-plane crossing n=%d" % pr["n_cross_part"])
    p = dict(zip([q["name"] for q in spec["params"]], values))
    for prm in spec["params"]:
        v = p[prm["name"]]
        if v <= prm["lo"] + 1e-9 or v >= prm["hi"] - 1e-9:
            fails.append("%s on bound (%.3f in [%.2f, %.2f])"
                         % (prm["name"], v, prm["lo"], prm["hi"]))
    return fails


STARTS = {
    "spec-default": None,
    "behind-shoulder": {"wpu_c0": -90.0, "wpu_c1": -20.0,
                        "relu_c0": -35.0, "spread0": 18.0,
                        "end_c0": 350.0, "end_c1": -80.0, "hem_u": 50.0,
                        "drift": -12.0},
    "long-back-short-front": {"end_c0": 320.0, "end_c1": -100.0,
                              "end_c2": 60.0, "hem_u": 60.0,
                              "rel_c0": 100.0, "relu_c0": -30.0,
                              "wpx_c0": 130.0, "spread0": 16.0},
}


def solve(ctx, fun, xs, scales, max_nfev, bounds=None):
    if bounds is None:
        bounds = (np.array(ctx.bounds[0]), np.array(ctx.bounds[1]))
    lo, hi = bounds
    best = None
    for _ in range(2):
        sol = least_squares(
            fun, xs, bounds=(lo, hi), method="trf", x_scale=scales,
            diff_step=0.05 * scales, ftol=1e-10, xtol=1e-10,
            gtol=1e-10, max_nfev=max_nfev, verbose=0)
        if best is None or sol.cost < best.cost:
            best = sol
        xs = sol.x
    return best


def term_breakdown(ctx, values, views):
    grown = GROW.grow_guides(values, ctx.spec, ctx.roots, ctx.egrid,
                             ctx.anchors)
    p = dict(zip(ctx.names, [float(v) for v in values]))
    union, render_cov = rasterize(ctx, grown, p["tube_r"], views)
    rr = regional_residuals(ctx, union, views)
    guard = INS.face_guard_depth(render_cov, ctx.refs, ctx.boxes_render)
    g = sum((guard[v]["coveredPx"] * GUARD_SCALE[v]) ** 2
            for v in views if v in GUARD_SCALE) / 2
    pen = np.array([max(0.0, -grown["min_sdf_mm"]) * COLL_SCALE,
                    max(0.0, grown["max_proj_fall_mm"] - 10.0)
                    * PROJ_SCALE,
                    float(grown["proj_dist"][
                        :, int(ctx.spec.get("shellSamples", 12)):].mean())
                    * PROJ_MEAN_SCALE,
                    max(0.0, grown["n_inside_mm"]) * COLL_SCALE])
    rc, rn, rs = regularizer_parts(ctx, grown)
    reg = (float(rc @ rc) + float(rn @ rn) + float(rs @ rs)) / 2
    return {"regional": round(float(rr @ rr) / 2, 1),
            "guard": round(g, 1),
            "penalty": round(float(pen @ pen) / 2, 1),
            "regularizer": round(reg, 3)}


def run_one(ctx, evidence, name, max_nfev):
    """One named start; writes E/fit-start-<name>.json immediately."""
    x0 = np.array([p["init"] for p in ctx.spec["params"]])
    over = STARTS[name]
    xs = x0.copy()
    for k, v in (over or {}).items():
        xs[ctx.names.index(k)] = v
    t0 = time.time()
    sol = solve(ctx, lambda v: fun_only(ctx, v, INS.VIEWS), xs,
                ctx.ranges, max_nfev)
    adeq = adequacy(ctx, sol.x)
    fails = gate_report(adeq, sol.x, ctx.spec)
    payload = {
        "specSha": ctx.spec_sha, "start": name,
        "cost": float(sol.cost), "nfev": int(sol.nfev),
        "status": int(sol.status),
        "optimality": float(sol.optimality),
        "secs": round(time.time() - t0, 1),
        "values": [round(float(v), 3) for v in sol.x],
        "terms": term_breakdown(ctx, sol.x, INS.VIEWS),
        "adequacy": adeq, "gateFails": fails,
    }
    (evidence / ("fit-start-%s.json" % name)).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print("FIT all/%s cost=%.1f nfev=%d fails=%d %s" % (
        name, sol.cost, sol.nfev, len(fails), fails[:6]), flush=True)
    return payload


def run_all(ctx, evidence, max_nfev, only=None):
    result = {"specSha": ctx.spec_sha, "starts": {}}
    best = None
    names = [only] if only else list(STARTS)
    for name in names:
        payload = run_one(ctx, evidence, name, max_nfev)
        result["starts"][name] = payload
        if best is None or payload["cost"] < best[0]:
            best = (payload["cost"], name,
                    np.array(payload["values"]))
    if not only:
        result["best"] = {"start": best[1], "cost": float(best[0]),
                          "values": [round(float(v), 3) for v in best[2]]}
        (evidence / "fit-all.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result


def run_loo(ctx, evidence, holdout, max_nfev):
    views = tuple(v for v in INS.VIEWS if v != holdout)
    seed = json.loads((evidence / "fit-all.json").read_text())["best"][
        "values"]
    xs = np.array(seed)
    sol = solve(ctx, lambda v: fun_only(ctx, v, views), xs, ctx.ranges,
                max_nfev)
    adeq = adequacy(ctx, sol.x, views=(holdout,))
    fails = gate_report(adeq, sol.x, ctx.spec, views=(holdout,),
                        regional_only=True)
    payload = {"specSha": ctx.spec_sha, "holdout": holdout,
               "trainViews": list(views), "cost": float(sol.cost),
               "nfev": int(sol.nfev),
               "values": [round(float(v), 3) for v in sol.x],
               "heldOutAdequacy": adeq, "heldOutFails": fails}
    (evidence / ("fit-loo-%s.json" % holdout)).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print("FIT loo-%s cost=%.1f heldout-fails=%d %s" % (
        holdout, sol.cost, len(fails), fails[:6]), flush=True)
    return payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--mode", required=True,
                    choices=["all", "loo-front", "loo-profile_90",
                             "loo-back"])
    ap.add_argument("--max-nfev", type=int, default=80)
    ap.add_argument("--start", default=None)
    ap.add_argument("--collect", action="store_true")
    args = ap.parse_args()
    evidence = Path(args.evidence)
    if args.collect:
        result = {"starts": {}}
        best = None
        for name in STARTS:
            payload = json.loads(
                (evidence / ("fit-start-%s.json" % name)).read_text())
            result["starts"][name] = payload
            if best is None or payload["cost"] < best[0]:
                best = (payload["cost"], name, payload["values"])
        result["specSha"] = result["starts"][
            list(STARTS)[0]]["specSha"]
        result["best"] = {"start": best[1], "cost": float(best[0]),
                          "values": best[2]}
        (evidence / "fit-all.json").write_text(
            json.dumps(result, indent=2, sort_keys=True) + "\n")
        print("COLLECT best=%s cost=%.1f" % (best[1], best[0]),
              flush=True)
        return
    ctx = Context(evidence)
    print("SPEC_SHA %s (before fit)" % ctx.spec_sha, flush=True)
    t0 = time.time()
    if args.mode == "all":
        run_all(ctx, evidence, args.max_nfev, only=args.start)
    else:
        run_loo(ctx, evidence, args.mode[4:], args.max_nfev)
    print("MODE_DONE %s secs=%.0f" % (args.mode, time.time() - t0),
          flush=True)
    dest = evidence / "inputs-opened.txt"
    seen = set(dest.read_text().splitlines()) if dest.exists() else set()
    seen.update(OPENED)
    dest.write_text("\n".join(sorted(seen)) + "\n")


if __name__ == "__main__":
    main()

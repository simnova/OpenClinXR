#!/usr/bin/env python3
"""Guide-cage v4 fit: regional contour + depth guard + exact collision.

Objective (scipy least_squares, trf, bounded): fixed-length residual vector
  - regional: per (view, region, side excess/miss) k=150 sampled Huber(3px)
    contour distances (cage0 regional boxes; excess and miss separate);
  - face guard: depth-aware covered px in the eye/mouth boxes, computed with
    a render-frame CLIPPED triangle scan (same depth test as
    instruments.face_guard_depth, restricted to the guard windows);
  - collision: per-family max penetration beyond 0.0 mm (exact field);
  - root standoff: per-family distance outside the 1-3 mm band.
Adequacy (separate evaluator, raw px): per (view, region) pooled
bidirectional contour p50/p95; excess/miss mean/max/n reported separately;
front face guard (full scan); exact collision below the crown band; roots.

Modes: all | loo-front | loo-profile_90 | loo-back | split-curtain |
split-back. LOO/split modes start from the all-view best fit and fit a
subset (LOO: all params on two views; split: one family's hem params on the
profile view + its hem ray).

Usage: fit_cage.py --evidence <E dir> --mode <mode> [--max-nfev N]
Writes E/fit-<mode>.json. No rendering here (STEP 5 renders the winner).
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

STATION = Path(__file__).resolve().parent
ROOT = STATION.parents[3]
sys.path.insert(0, str(STATION))
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom"))
import cage as CAGE  # noqa: E402
import instruments as INS  # noqa: E402
import exact as EXACT  # noqa: E402
import envelope as ENV  # noqa: E402

K = 150
DELTA = 3.0
GUARD_SCALE = {"front": 3.0, "profile_90": 0.5}
COLL_SCALE = 8.0  # cage0 envelope weight; collision-0 is a hard gate
STAND_SCALE = 8.0  # roots 1-3 mm is a hard gate: weight with collision
RAY_SCALE = 0.3  # per-mm residual weight for split-hem ray distances

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
    def __init__(self, evidence):
        manifest = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests"
                               / "aisha_straight_long.json").read_text())
        cams_path = track(ROOT / manifest["camerasFile"]["path"])
        assert sha256_file(cams_path) == manifest["camerasFile"]["sha256"]
        self.cams = INS.load_cameras(str(cams_path))
        self.transforms = INS.transforms_of(self.cams)
        self.sensor = INS.sensor_of(self.cams)
        bdepth = np.load(str(track(evidence / "body-depth.npz")))
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
            mp = track(Path("/Users/patrick/.grok/worktrees/src-openclinxr/"
                             "hair-judge/tools/openclinxr/evidence/hair-judge/"
                             "target-set-back/"
                             + {"front": "mask-front-v2.png",
                                "profile_90": "mask-profile-v2.png",
                                "back": "mask-back-v3.png"}[v]))
            assert sha256_file(mp) == manifest["targets"]["masks"][v][
                "sha256"], "mask sha mismatch %s" % v
            from PIL import Image
            self.targets[v] = np.asarray(
                Image.open(mp).convert("L")) > 127
        self.spec = json.loads(
            track(evidence / "cage-spec.json").read_text())
        self.spec_sha = sha256_file(evidence / "cage-spec.json")
        self.egrid = EXACT.load_exact(str(track(
            evidence / "body-exact-sdf.npz")))
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
        # static target instruments per view
        self.tbt = {}
        self.tedt = {}
        for v in INS.VIEWS:
            bt = INS.boundary(self.targets[v])
            self.tbt[v] = bt
            self.tedt[v] = ndimage.distance_transform_edt(~bt)
        self.bounds = ([self.spec["params"][i]["lo"]
                        for i in range(len(CAGE.PARAM_ORDER))],
                       [self.spec["params"][i]["hi"]
                        for i in range(len(CAGE.PARAM_ORDER))])
        self.ranges = np.array(self.bounds[1]) - np.array(self.bounds[0])


def build(ctx, values):
    return CAGE.build_cage(values, ctx.spec)


def unions(ctx, cage, views):
    """Occluded visible-hair masks in the target frame (render-frame strip
    depth tested against the body depth maps, then warped)."""
    render_cov = INS.render_depth(
        {f: cage[f]["grid_w"] for f in cage}, ctx.cams, views=views)
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


def guard_clipped(ctx, cage, views):
    """Depth-aware guard via render-frame clipped triangle scan."""
    out = {}
    for v in views:
        if v not in GUARD_SCALE or not ctx.boxes_render[v]:
            continue
        boxes = [(n, ctx.boxes_render[v][n]) for n in ctx.boxes_render[v]]
        r0 = max(int(min(b[0] for _, b in boxes)) - 8, 0)
        r1 = min(int(max(b[1] for _, b in boxes)) + 8, INS.FRAME)
        c0 = max(int(min(b[2] for _, b in boxes)) - 8, 0)
        c1 = min(int(max(b[3] for _, b in boxes)) + 8, INS.FRAME)
        H, W = r1 - r0, c1 - c0
        cover = np.zeros((H, W), dtype=bool)
        depth = np.full((H, W), np.inf)
        for family in sorted(cage):
            left_w, right_w = (np.asarray(a, dtype=np.float64)
                               for a in cage[family]["grid_w"])
            n = left_w.shape[0]
            pts = np.empty((n * 2, 3))
            pts[0::2], pts[1::2] = left_w, right_w
            cols, rows, dep = ENV.project_to_render(
                pts, ctx.cams["views"][v], ctx.sensor)
            cols = cols.reshape(n, 2)
            rows = rows.reshape(n, 2)
            dep = dep.reshape(n, 2)
            for k in range(n - 1):
                tris = (
                    (cols[k, 0], rows[k, 0], dep[k, 0],
                     cols[k, 1], rows[k, 1], dep[k, 1],
                     cols[k + 1, 1], rows[k + 1, 1], dep[k + 1, 1]),
                    (cols[k, 0], rows[k, 0], dep[k, 0],
                     cols[k + 1, 1], rows[k + 1, 1], dep[k + 1, 1],
                     cols[k + 1, 0], rows[k + 1, 0], dep[k + 1, 0]),
                )
                for (x0, y0, d0, x1, y1, d1, x2, y2, d2) in tris:
                    xlo = max(int(np.floor(min(x0, x1, x2))), c0)
                    xhi = min(int(np.ceil(max(x0, x1, x2))), c1 - 1)
                    ylo = max(int(np.floor(min(y0, y1, y2))), r0)
                    yhi = min(int(np.ceil(max(y0, y1, y2))), r1 - 1)
                    if xhi < xlo or yhi < ylo:
                        continue
                    denom = ((y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2))
                    if abs(denom) < 1e-12:
                        continue
                    yy, xx = np.mgrid[ylo:yhi + 1, xlo:xhi + 1]
                    l0 = ((y1 - y2) * (xx - x2) + (x2 - x1) * (yy - y2)) \
                        / denom
                    l1 = ((y2 - y0) * (xx - x2) + (x0 - x2) * (yy - y2)) \
                        / denom
                    l2 = 1.0 - l0 - l1
                    inside = (l0 >= -1e-9) & (l1 >= -1e-9) & (l2 >= -1e-9)
                    if not inside.any():
                        continue
                    dd = l0 * d0 + l1 * d1 + l2 * d2
                    sl = (slice(ylo - r0, yhi + 1 - r0),
                          slice(xlo - c0, xhi + 1 - c0))
                    sub = np.zeros_like(inside, dtype=bool)
                    cur = depth[sl]
                    sub[inside] = dd[inside] < cur[inside]
                    cur[sub] = dd[sub]
                    depth[sl] = cur
                    cov = cover[sl]
                    cov |= inside
                    cover[sl] = cov
        rows_g, cols_g = np.mgrid[r0:r1, c0:c1]
        covered = 0
        for name, box in boxes:
            br0, br1, bc0, bc1 = box
            zone = ((rows_g >= br0) & (rows_g < br1)
                    & (cols_g >= bc0) & (cols_g < bc1))
            hit = (zone & cover
                   & (depth < ctx.refs[v][name] - 0.005))
            covered += int(hit.sum())
        out[v] = covered * GUARD_SCALE[v]
    return out


def penalties(ctx, cage):
    coll = INS.collide_exact(cage, ctx.spec, ctx.egrid, tol_mm=0.0)
    so = EXACT.root_standoff(cage, ctx.spec, ctx.egrid)
    parts = []
    for fam in sorted(cage):
        parts.append(coll["perFamily"][fam]["maxDepthMm"] * COLL_SCALE)
    for fam in sorted(cage):
        v = so["perFamily"][fam]
        parts.append(max(0.0, 1.0 - v, v - 3.0) * STAND_SCALE)
    return np.array(parts), coll, so


def objective(ctx, values, views, ray=None):
    cage = build(ctx, values)
    union, _ = unions(ctx, cage, views)
    res = [regional_residuals(ctx, union, views)]
    g = guard_clipped(ctx, cage, views)
    for v in sorted(g):
        res.append(np.array([g[v]]))
    pen, _, _ = penalties(ctx, cage)
    res.append(pen)
    if ray is not None:
        fam, origin, direction = ray
        end = CAGE.head_to_world(
            np.asarray(cage[fam]["centre_head"][-1])[None, :],
            ctx.spec["crown"])[0]
        rel = end - origin
        along = float(rel @ direction)
        dist = float(np.linalg.norm(rel - along * direction))
        res.append(np.array([dist * 1000.0 * RAY_SCALE]))
    return np.concatenate(res)


def adequacy(ctx, values, views=INS.VIEWS):
    """Raw-px gate metrics per (view, region) + guard + collision."""
    cage = build(ctx, values)
    union, render_cov = unions(ctx, cage, views)
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
        full_cov = INS.render_depth(
            {f: cage[f]["grid_w"] for f in cage}, ctx.cams)  # guard: all
    guard = INS.face_guard_depth(full_cov, ctx.refs, ctx.boxes_render)
    coll = INS.collide_exact(cage, ctx.spec, ctx.egrid, tol_mm=0.0)
    so = EXACT.root_standoff(cage, ctx.spec, ctx.egrid)
    return {"regional": per_view, "guard": guard, "collision": coll,
            "standoff": so}


def gate_report(adeq, values, spec, views=INS.VIEWS, regional_only=False):
    """Adequacy gate: per view AND per region p95<=24, p50<=12; front guard
    0; below-crown collision 0; roots 1-3; no hem param on its bound.
    regional_only: LOO held-out verdict (regional thresholds only)."""
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
    if adeq["collision"]["belowBallMaxMm"] != 0.0:
        fails.append("below-ball collision max=%.2fmm viol=%d" % (
            adeq["collision"]["belowBallMaxMm"],
            sum(f["belowBallViol"]
                for f in adeq["collision"]["perFamily"].values())))
    so = adeq["standoff"]
    for fam, val in so["perFamily"].items():
        if not (1.0 <= val <= 3.0):
            fails.append("root %s standoff=%.2fmm" % (fam, val))
    p = dict(zip(CAGE.PARAM_ORDER, values))
    for i, prm in enumerate(spec["params"]):
        if prm["name"].endswith("_hem_drop"):
            if values[i] <= prm["lo"] + 1e-9 or values[i] >= prm["hi"] - 1e-9:
                fails.append("hem param %s on bound (%.2f in [%.1f, %.1f])"
                             % (prm["name"], values[i], prm["lo"],
                                prm["hi"]))
    return fails


STARTS = {
    "spec-default": None,  # spec inits
    "behind-shoulder": {"curtain_front_sh": -60.0, "curtain_ear_u": 35.0,
                        "curtain_hem_drop": 420.0, "back_post_sh": -130.0,
                        "side_out_sh": 30.0},
    "long-back-short-front": {"curtain_hem_drop": 220.0,
                              "curtain_front_sh": -40.0,
                              "back_hem_drop": 520.0, "nape_hem_drop": 420.0,
                              "back_w_hem": 190.0},
}

SPLIT_SUBSET = {
    "split-curtain": (["curtain_hem_drop", "curtain_front_sh",
                       "curtain_ear_u", "curtain_w_top", "curtain_w_hem"],
                      "temple_L"),
    "split-back": (["back_hem_drop", "back_post_sh", "back_w_top",
                    "back_w_hem"], "back"),
}


def run_all(ctx, evidence, max_nfev):
    x0 = np.array(CAGE.default_values())
    result = {"specSha": ctx.spec_sha, "starts": {}}
    best = None
    for name, over in STARTS.items():
        xs = x0.copy()
        for k, v in (over or {}).items():
            xs[CAGE.PARAM_ORDER.index(k)] = v
        t0 = time.time()
        sol = solve(ctx, lambda v: objective(ctx, v, INS.VIEWS), xs,
                    ctx.ranges, max_nfev)
        adeq = adequacy(ctx, sol.x)
        fails = gate_report(adeq, sol.x, ctx.spec)
        result["starts"][name] = {
            "cost": float(sol.cost), "nfev": int(sol.nfev),
            "njev": int(getattr(sol, "njev", -1)),
            "status": int(sol.status), "message": str(sol.message),
            "optimality": float(sol.optimality), "secs": round(
                time.time() - t0, 1),
            "values": [round(float(v), 3) for v in sol.x],
            "terms": term_breakdown(ctx, sol.x, INS.VIEWS),
            "adequacy": adeq, "gateFails": fails,
        }
        print("FIT all/%s cost=%.1f nfev=%d fails=%d %s" % (
            name, sol.cost, sol.nfev, len(fails), fails[:4]), flush=True)
        if best is None or sol.cost < best[0]:
            best = (sol.cost, name, sol.x)
    result["best"] = {"start": best[1], "cost": float(best[0]),
                      "values": [round(float(v), 3) for v in best[2]]}
    (evidence / "fit-all.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n")
    # profile split-hem rays for the winner (targets + fitted endpoints)
    cage = build(ctx, np.array(best[2]))
    hems = INS.split_hem_rays(ctx.targets["profile_90"], ctx.cams, cage,
                              ctx.transforms)
    (evidence / "split-rays.json").write_text(
        json.dumps({"specSha": ctx.spec_sha, **hems}, indent=2,
                   sort_keys=True) + "\n")
    return result


def run_loo(ctx, evidence, holdout, max_nfev):
    views = tuple(v for v in INS.VIEWS if v != holdout)
    seed = json.loads((evidence / "fit-all.json").read_text())["best"][
        "values"]
    xs = np.array(seed)
    sol = solve(ctx, lambda v: objective(ctx, v, views), xs, ctx.ranges,
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


def run_split(ctx, evidence, mode, max_nfev):
    names, fam = SPLIT_SUBSET[mode]
    idx = [CAGE.PARAM_ORDER.index(n) for n in names]
    seed = np.array(json.loads(
        (evidence / "fit-all.json").read_text())["best"]["values"])
    hems = json.loads((evidence / "split-rays.json").read_text())
    key = "curtain" if fam == "temple_L" else "back"
    ray = (fam, np.array(hems[key]["rayOriginM"]),
           np.array(hems[key]["rayDir"]))
    lo = np.array([ctx.spec["params"][i]["lo"] for i in idx])
    hi = np.array([ctx.spec["params"][i]["hi"] for i in idx])
    rng = np.array([ctx.spec["params"][i]["hi"] - ctx.spec["params"][i][
        "lo"] for i in idx])
    sol = solve(ctx, lambda s: objective(ctx, _plug(seed, idx, s),
                                          ("profile_90",), ray=ray),
                seed[idx], rng, max_nfev, bounds=(lo, hi))
    full = _plug(seed, idx, sol.x)
    cage = build(ctx, full)
    end = CAGE.head_to_world(
        np.asarray(cage[fam]["centre_head"][-1])[None, :],
        ctx.spec["crown"])[0]
    payload = {"specSha": ctx.spec_sha, "mode": mode, "family": fam,
               "subset": names, "cost": float(sol.cost),
               "nfev": int(sol.nfev),
               "values": [round(float(v), 3) for v in full],
               "endM": [round(float(v), 4) for v in end],
               "endHeightMm": round(float(end[2]) * 1000.0, 1),
               "endUMm": round(float(
                   (ctx.spec["crown"][1] - end[1]) * 1000.0), 1)}
    (evidence / ("fit-%s.json" % mode)).write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n")
    print("FIT %s cost=%.1f end z=%.1f U=%.1f" % (
        mode, sol.cost, payload["endHeightMm"], payload["endUMm"]),
        flush=True)
    return payload


def _plug(seed, idx, sub):
    full = np.array(seed, dtype=float)
    full[idx] = sub
    return full


def solve(ctx, fun, xs, scales, max_nfev, bounds=None):
    """Two-pass trf: a polish restart from the first optimum escapes
    trust-region stalls on the quantised raster objective."""
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
    cage = build(ctx, values)
    union, _ = unions(ctx, cage, views)
    rr = regional_residuals(ctx, union, views)
    g = guard_clipped(ctx, cage, views)
    pen, _, _ = penalties(ctx, cage)
    return {"regional": round(float(rr @ rr) / 2, 1),
            "guard": round(sum(v * v for v in g.values()) / 2, 1),
            "penalty": round(float(pen @ pen) / 2, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    ap.add_argument("--mode", required=True,
                    choices=["all", "loo-front", "loo-profile_90",
                             "loo-back", "split-curtain", "split-back"])
    ap.add_argument("--max-nfev", type=int, default=200)
    args = ap.parse_args()
    evidence = Path(args.evidence)
    for name in ("cage.py", "instruments.py", "exact.py", "fit_cage.py",
                 "export_exact_sdf.py"):
        track(STATION / name)
    ctx = Context(evidence)
    print("SPEC_SHA %s (before fit)" % ctx.spec_sha, flush=True)
    t0 = time.time()
    if args.mode == "all":
        run_all(ctx, evidence, args.max_nfev)
    elif args.mode.startswith("loo-"):
        run_loo(ctx, evidence, args.mode[4:], args.max_nfev)
    else:
        run_split(ctx, evidence, args.mode, args.max_nfev)
    print("MODE_DONE %s secs=%.0f" % (args.mode, time.time() - t0),
          flush=True)
    CAGE.append_inputs(evidence, OPENED)


if __name__ == "__main__":
    main()

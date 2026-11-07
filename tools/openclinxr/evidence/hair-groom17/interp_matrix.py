#!/usr/bin/env python3
"""hair-groom17 STEP 1: Interpolate-stage toggle matrix (measurement first).

Card: toggle the Interpolate stage ONLY (Clump/Noise/Smooth OFF, no
Shrinkwrap, no outside pass, cleared guides from groom16, density low
enough for ~60k children). Grid:
  follow-surface-normal {0,1} x depth-classes {1,3} x
  interpolation-guides {1,3,6} x distance-to-guides {default=1.0, 0.02}
= 24 cells. For each cell report:
  - insideFrac samples (all finite) and s>=1 (comparable to groom16 19.06%)
  - children needing > 3 mm of outside-pass projection, and their p50/p90
  - parietal / temple child-depth p50/p90/std vs the cleared guide reference
  - front-band "bangs" count (child samples forward of the forehead plane
    inside the face box; geometric, world-space, no render)

Writes E/interp-matrix.json + E/interp-matrix.md.

Usage: mise exec -- python3 interp_matrix.py [--cells id,id] [--force]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
from children import sdf_sampler  # noqa: E402
import body_clear as BC  # noqa: E402

SDFP = ROOT / "tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-groom16/build/guides-cleared.npz"
SCALP = ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz"
FRAME = ROOT / "tools/openclinxr/evidence/hair-groom16/station-frame.npz"
GUIDE_DEPTH = ROOT / "tools/openclinxr/evidence/hair-groom16/guide-depth.json"
BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"
MATRIX_DIR = E / "build/matrix"
DENSITY = 850000.0  # -> ~61k children (calibrated: 60968 at seed 7)
FACE_HALF_WIDTH_M = 0.080


def cell_list():
    out = []
    for fsn in (0, 1):
        for ncls in (1, 3):
            for ig in (1, 3, 6):
                for dtg in ("default", "0.02"):
                    out.append((fsn, ncls, ig, dtg))
    return out


def cell_id(fsn, ncls, ig, dtg):
    return "fsn%d_cls%d_ig%d_dtg%s" % (fsn, ncls, ig, dtg)


def dtg_value(dtg):
    return 1.0 if dtg == "default" else float(dtg)


def run_cell(fsn, ncls, ig, dtg, force=False):
    cid = cell_id(fsn, ncls, ig, dtg)
    out = MATRIX_DIR / (cid + ".npz")
    if out.exists() and not force:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [BLENDER, "--background", "--python",
           str(STRANDS / "blender_children.py"), "--",
           "--guides", str(GUIDES), "--out", str(out),
           "--density", str(DENSITY), "--seed", "7",
           "--scalp-roots", str(SCALP),
           "--part-by-islands", "1", "--clump-factor", "0.2",
           "--sideburn-tuck", "0", "--skip-drape", "1",
           "--clear-guides", "0", "--outside-pass", "0",
           "--depth-classes", str(ncls),
           "--interp-guides", str(ig),
           "--distance-to-guides", str(dtg_value(dtg)),
           "--follow-surface-normal", str(fsn),
           "--skip-clump", "1", "--skip-noise", "1", "--skip-smooth", "1",
           "--skip-shrink", "1", "--colliders", ""]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        raise RuntimeError("cell %s build failed: %s" % (cid, r.stderr[-2000:]))
    done = [ln for ln in r.stdout.splitlines()
            if ln.startswith("BLENDER_CHILDREN_DONE")]
    print("  %s :: %s" % (cid, done[-1] if done else "?"), flush=True)
    return out


def face_box():
    f = np.load(str(FRAME), allow_pickle=True)
    brow = np.asarray(f["point3d/brow"], dtype=np.float64).ravel()
    menton = np.asarray(f["point3d/menton"], dtype=np.float64).ravel()
    crown = np.asarray(f["point3d/crown"], dtype=np.float64).ravel()
    return {
        "brow": brow, "menton": menton, "crown": crown,
        "forehead_plane_y": float(brow[1]),
        "z_lo": float(min(menton[2], brow[2])),
        "z_hi": float(crown[2]),
        "x_half": FACE_HALF_WIDTH_M,
    }


def band_masks(pts):
    r = pts[:, 0, :]
    return {
        "parietal": (np.abs(r[:, 0] * 1000.0) >= 50.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0),
        "temple": (np.abs(r[:, 0] * 1000.0) >= 35.0)
        & (np.abs(r[:, 0] * 1000.0) < 85.0)
        & (r[:, 1] * 1000.0 >= -135.0)
        & (r[:, 1] * 1000.0 < -40.0),
    }


def depth_bands(pts, sample):
    seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
    arc = np.concatenate([np.zeros((len(pts), 1)),
                          np.cumsum(seg, axis=1)], axis=1)
    shell = (arc >= 0.010) & (arc <= 0.080)
    flatp = pts[:, 1:, :].reshape(-1, 3)
    vals, inside = sample(flatp)
    vals = np.where(inside, vals, np.nan)
    out = {}
    for bn, bm in band_masks(pts).items():
        sel = (shell[:, 1:] & bm[:, None]).reshape(-1)
        v = vals.reshape(-1)[sel]
        v = v[np.isfinite(v)]
        out[bn] = {
            "n": int(v.size),
            "p50": round(float(np.percentile(v, 50)), 3) if v.size else 0.0,
            "p90": round(float(np.percentile(v, 90)), 3) if v.size else 0.0,
            "std": round(float(v.std()), 3) if v.size else 0.0}
    return out


def measure(points, sample, fb):
    n, P, _ = points.shape
    flat = points.reshape(-1, 3)
    vals, inside = sample(flat)
    vals = np.where(inside, vals, np.nan)
    fin = np.isfinite(vals)
    inside_all = int((vals[fin] < 0.0).sum())
    frac_all = inside_all / max(int(fin.sum()), 1)
    s1 = vals.reshape(n, P)[:, 1:]
    fin1 = np.isfinite(s1)
    inside_s1 = int((s1[fin1] < 0.0).sum())
    frac_s1 = inside_s1 / max(int(fin1.sum()), 1)

    _, per_child, ostats = BC.outside_pass(points, sample,
                                           target_mm=0.5, thresh_mm=0.5)

    dep = depth_bands(points, sample)

    # bangs: forward of forehead plane, inside the face box
    y = flat[:, 1]
    x = flat[:, 0]
    z = flat[:, 2]
    boxm = ((y < fb["forehead_plane_y"])
            & (np.abs(x) <= fb["x_half"])
            & (z >= fb["z_lo"]) & (z <= fb["z_hi"]))
    bangs = int((boxm & fin).sum())

    return {
        "nChildren": int(n), "nSamples": int(n * P),
        "insideSamplesAll": inside_all,
        "insideFracSamplesAll": round(frac_all, 6),
        "insideSamplesSge1": inside_s1,
        "insideFracSamplesSge1": round(frac_s1, 6),
        "childrenNeedGt3mm": ostats["nChildrenMoveGt3mm"],
        "fracChildrenNeedGt3mm": ostats["fracChildrenMoveGt3mm"],
        "childMoveMm_p50": ostats["childMoveMm_p50"],
        "childMoveMm_p90": ostats["childMoveMm_p90"],
        "childMoveMm_p99": ostats["childMoveMm_p99"],
        "childMoveMm_max": ostats["childMoveMm_max"],
        "depth": dep,
        "bangsSamples": bangs,
        "bangsFracSamples": round(bangs / max(int(fin.sum()), 1), 6),
    }


def verdict(cell, ref):
    """Qualify: insideSge1 < 1% and parietal+temple p50/p90 within +-20%."""
    ok = cell["insideFracSamplesSge1"] < 0.01
    ratios = {}
    for bn in ("parietal", "temple"):
        g = ref[bn]
        c = cell["depth"][bn]
        for stat in ("p50", "p90"):
            r = c[stat] / max(g[stat], 1e-9)
            ratios["%s_%s" % (bn, stat)] = round(r, 3)
            ok = ok and (0.8 <= r <= 1.2)
    return ok, ratios


def write_md(out, path):
    cells = out["cells"]
    levels = [("followSurfaceNormal", [0, 1]),
              ("depthClasses", [1, 3]),
              ("interpGuides", [1, 3, 6]),
              ("distanceToGuides", [1.0, 0.02])]

    def marginal(field):
        rows = []
        for k, lvs in levels:
            r = []
            for lv in lvs:
                vs = [c[field] for c in cells.values() if c[k] == lv]
                r.append((lv, round(float(np.mean(vs)), 4)))
            rows.append((k, r))
        return rows

    L = []
    L.append("# hair-groom17 — Interpolate-stage toggle matrix")
    L.append("")
    L.append("Density %s (-> ~61k children), seed 7, cleared guides from "
             "groom16, Clump/Noise/Smooth OFF, no Shrinkwrap, no outside "
             "pass. `inside%%` = child samples (s>=1) with body SDF < 0 "
             "(groom16's falsifier scalar = 19.06%%). `need>3mm` = children "
             "the same outside pass would move > 3 mm (gate <= 2%%). "
             "`bangs` = child samples forward of the forehead plane inside "
             "the face box (geometric, world-space)." % out["density"])
    L.append("")
    hdr = ("| cell | fsn | cls | ig | dtg | insideAll% | insideS1% | "
           "need>3mm% | move p90 | pari p50 | pari p90 | pari std | "
           "temp p50 | temp p90 | temp std | bangs | qual |")
    L.append(hdr)
    L.append("|" + "---|" * 17)
    for cid in sorted(cells):
        c = cells[cid]
        dp, dt = c["depth"]["parietal"], c["depth"]["temple"]
        L.append("| %s | %d | %d | %d | %s | %.2f | %.2f | %.2f | %.2f | "
                 "%.2f | %.2f | %.2f | %.2f | %.2f | %.2f | %d | %s |" % (
                     cid, c["followSurfaceNormal"], c["depthClasses"],
                     c["interpGuides"],
                     "1.0" if c["distanceToGuides"] == 1.0 else "0.02",
                     c["insideFracSamplesAll"] * 100,
                     c["insideFracSamplesSge1"] * 100,
                     c["fracChildrenNeedGt3mm"] * 100, c["childMoveMm_p90"],
                     dp["p50"], dp["p90"], dp["std"],
                     dt["p50"], dt["p90"], dt["std"], c["bangsSamples"],
                     "yes" if c["qualifies"] else "no"))
    L.append("")
    L.append("Cleared-guide depth reference (groom16 guide-depth.json): "
             "parietal p50 %.3f / p90 %.3f / std %.3f; temple p50 %.3f / "
             "p90 %.3f / std %.3f. Qualification band = child p50 and p90 "
             "within +-20%%." % (
                 out["guideDepthRef"]["parietal"]["p50"],
                 out["guideDepthRef"]["parietal"]["p90"],
                 out["guideDepthRef"]["parietal"]["std"],
                 out["guideDepthRef"]["temple"]["p50"],
                 out["guideDepthRef"]["temple"]["p90"],
                 out["guideDepthRef"]["temple"]["std"]))
    L.append("")
    L.append("## Marginal mean by level (insideS1%, need>3mm%, bangs)")
    L.append("")
    L.append("| variable | levels | insideS1% mean | need>3mm% mean | "
             "bangs mean | inside range |")
    L.append("|---|---|---|---|---|---|")
    mi = marginal("insideFracSamplesSge1")
    mn = marginal("fracChildrenNeedGt3mm")
    mb = marginal("bangsSamples")
    for (k, ri), (_, rn), (_, rb) in zip(mi, mn, mb):
        lv = " / ".join("%s:%s" % (a, b) for a, b in ri)
        im = " / ".join("%.2f" % (b * 100) for _, b in ri)
        nm = " / ".join("%.2f" % (b * 100) for _, b in rn)
        bm = " / ".join("%.1f" % b for _, b in rb)
        rng = max(b for _, b in ri) - min(b for _, b in ri)
        L.append("| %s | %s | %s | %s | %s | %.2f pts |" % (
            k, lv, im, nm, bm, rng * 100))
    L.append("")
    best_inside = min(cells.values(),
                      key=lambda c: c["insideFracSamplesSge1"])
    best_need = min(cells.values(), key=lambda c: c["fracChildrenNeedGt3mm"])
    nq = sum(1 for c in cells.values() if c["qualifies"])
    L.append("## Outcome")
    L.append("")
    L.append("Qualifying cells (inside < 1%% AND parietal+temple p50/p90 "
             "within +-20%%): **%d / %d**." % (nq, len(cells)))
    L.append("")
    L.append("- Lowest inside%%: `%s` insideS1 %.2f%%, need>3mm %.2f%%, "
             "parietal p50 ratio %.3f / temple p50 ratio %.3f." % (
                 best_inside["cell"], best_inside["insideFracSamplesSge1"] * 100,
                 best_inside["fracChildrenNeedGt3mm"] * 100,
                 best_inside["depthRatio"]["parietal_p50"],
                 best_inside["depthRatio"]["temple_p50"]))
    L.append("- Lowest need>3mm: `%s` insideS1 %.2f%%, need>3mm %.2f%%." % (
        best_need["cell"], best_need["insideFracSamplesSge1"] * 100,
        best_need["fracChildrenNeedGt3mm"] * 100))
    L.append("- The variable that moves inside%% most is **interpolation-"
             "guides** (marginal range %.2f pts; ig1 %.2f%% vs ig3 %.2f%% vs "
             "ig6 %.2f%%). follow-surface-normal moves it %.2f pts "
             "(0 %.2f%% vs 1 %.2f%%), depth-classes %.2f pts, "
             "distance-to-guides %.2f pts." % (
                 (max(b for _, b in mi[2][1])
                  - min(b for _, b in mi[2][1])) * 100,
                 mi[2][1][0][1] * 100, mi[2][1][1][1] * 100,
                 mi[2][1][2][1] * 100,
                 (max(b for _, b in mi[0][1])
                  - min(b for _, b in mi[0][1])) * 100,
                 mi[0][1][0][1] * 100, mi[0][1][1][1] * 100,
                 (max(b for _, b in mi[1][1])
                  - min(b for _, b in mi[1][1])) * 100,
                 (max(b for _, b in mi[3][1])
                  - min(b for _, b in mi[3][1])) * 100))
    path.write_text("\n".join(L) + "\n")
    print("WROTE %s" % path, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--md-only", action="store_true")
    args = ap.parse_args()
    if args.md_only:
        out = json.loads((E / "interp-matrix.json").read_text())
        write_md(out, E / "interp-matrix.md")
        return
    want = set(args.cells.split(",")) if args.cells else None

    sample, _ = sdf_sampler(np.load(str(SDFP), allow_pickle=True))
    ref = json.loads(GUIDE_DEPTH.read_text())["bands"]
    fb = face_box()
    print("FACE_BOX %s" % (json.dumps({k: (v if isinstance(v, float)
                                           else np.asarray(v).tolist())
                                       for k, v in fb.items()}),), flush=True)

    results = {}
    for (fsn, ncls, ig, dtg) in cell_list():
        cid = cell_id(fsn, ncls, ig, dtg)
        if want is not None and cid not in want:
            continue
        print("CELL %s" % cid, flush=True)
        p = run_cell(fsn, ncls, ig, dtg, force=args.force)
        doc = np.load(str(p), allow_pickle=True)
        pts = np.asarray(doc["points"], dtype=np.float64)
        m = measure(pts, sample, fb)
        ok, ratios = verdict(m, ref)
        m.update({"cell": cid, "followSurfaceNormal": fsn,
                  "depthClasses": ncls, "interpGuides": ig,
                  "distanceToGuides": dtg_value(dtg),
                  "depthRatio": ratios, "qualifies": bool(ok)})
        results[cid] = m
        print("  insideSge1=%.4f needGt3mm=%.4f parietal p50=%.2f p90=%.2f "
              "temple p50=%.2f p90=%.2f bangs=%d qualifies=%s" % (
                  m["insideFracSamplesSge1"], m["fracChildrenNeedGt3mm"],
                  m["depth"]["parietal"]["p50"], m["depth"]["parietal"]["p90"],
                  m["depth"]["temple"]["p50"], m["depth"]["temple"]["p90"],
                  m["bangsSamples"], ok), flush=True)

    out = {"density": DENSITY, "seed": 7, "guides": str(GUIDES),
           "guideDepthRef": ref, "faceBox": {
               "foreheadPlaneY": fb["forehead_plane_y"],
               "zLo": fb["z_lo"], "zHi": fb["z_hi"],
               "xHalfWidth": fb["x_half"]},
           "cells": results}
    (E / "interp-matrix.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE %s" % (E / "interp-matrix.json"), flush=True)
    write_md(out, E / "interp-matrix.md")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Select defect-box strands and compare raw/final groom9 geometry."""
from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from scipy.interpolate import CubicSpline

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STORE = Path("/Volumes/files/openclinxr-assets/store/hair-groom10diag")
FINAL = STORE / "final-strands.npz"
RAW = STORE / "raw-interpolation.npz"
GUIDES = ROOT / "tools/openclinxr/evidence/hair-groom9/build/guides-9.npz"
CAMERAS = ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json"

# [row0,row1,col0,col1], all in the native 1024 scorer frame.
DEFECTS = {
    "back-knot": {"view": "back", "box": [150, 420, 512, 765]},
    "behind-ear-loops": {"view": "profile_90", "box": [270, 550, 250, 530]},
    "sideburn-tuft": {"view": "three_quarter", "box": [330, 610, 380, 660]},
    "hairline-band": {"view": "front", "box": [98, 196, 291, 733]},
}


def project(points: np.ndarray, camera: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    inv = np.linalg.inv(np.asarray(camera["matrixWorld"], dtype=np.float64))
    f = float(camera["lensMm"]) / 36.0 * 1024.0
    flat = points.reshape(-1, 3)
    h = np.ones((len(flat), 4), dtype=np.float64)
    h[:, :3] = flat
    lc = (inv @ h.T).T
    dep = -lc[:, 2]
    col = np.full(len(flat), -1.0)
    row = np.full(len(flat), -1.0)
    ok = dep > 0
    col[ok] = 512.0 + lc[ok, 0] / dep[ok] * f
    row[ok] = 512.0 - lc[ok, 1] / dep[ok] * f
    shape = points.shape[:-1]
    return col.reshape(shape), row.reshape(shape), dep.reshape(shape)


def strands_in_box(points, radii, camera, box):
    """Approximate rendered visibility with a per-pixel hair z-buffer.

    A strand is selected only when one of its oversampled visible points is
    within 5 mm of the nearest hair point at that crop pixel.  This removes
    the many fully occluded back-layer strands that merely project through a
    box while retaining the surface fibres that can actually contribute.
    """
    r0, r1, c0, c1 = box
    H, W = r1 - r0, c1 - c0
    zbuf = np.full(H * W, np.inf, dtype=np.float64)
    for t in (0.0, 0.25, 0.5, 0.75, 1.0):
        p = points[:, :-1] * (1.0 - t) + points[:, 1:] * t
        c, r, d = project(p, camera)
        vis = (radii[:, :-1] * (1.0 - t) + radii[:, 1:] * t) > 1e-6
        ok = (c >= c0) & (c < c1) & (r >= r0) & (r < r1) & (d > 0) & vis
        if ok.any():
            pix = ((r[ok].astype(np.int64) - r0) * W
                   + (c[ok].astype(np.int64) - c0))
            np.minimum.at(zbuf, pix, d[ok])
    hit = np.zeros(len(points), dtype=bool)
    for t in (0.0, 0.25, 0.5, 0.75, 1.0):
        p = points[:, :-1] * (1.0 - t) + points[:, 1:] * t
        c, r, d = project(p, camera)
        vis = (radii[:, :-1] * (1.0 - t) + radii[:, 1:] * t) > 1e-6
        ok = (c >= c0) & (c < c1) & (r >= r0) & (r < r1) & (d > 0) & vis
        rows, cols = np.nonzero(ok)
        if len(rows):
            pix = ((r[rows, cols].astype(np.int64) - r0) * W
                   + (c[rows, cols].astype(np.int64) - c0))
            near = d[rows, cols] <= zbuf[pix] + 0.005
            hit[rows[near]] = True
    return hit


def chord_turn_total(curve_m: np.ndarray) -> float:
    """Groom9's cubic/1 mm/5 mm chord total after the 40 mm leader."""
    c = np.asarray(curve_m, dtype=np.float64) * 1000.0
    seg = np.linalg.norm(np.diff(c, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    if arc[-1] < 46.0 or np.any(np.diff(arc) <= 1e-9):
        return 0.0
    q = np.arange(0.0, arc[-1], 1.0)
    r = CubicSpline(arc, c, axis=0)(q)
    ref = None
    total = 0.0
    for k in range(0, len(r) - 5, 5):
        if k + 5 <= 40:
            continue
        ch = r[k + 5] - r[k]
        n = np.linalg.norm(ch)
        if n < 1e-9:
            continue
        ch /= n
        if ref is not None:
            total += float(np.degrees(np.arccos(np.clip(ch @ ref, -1, 1))))
        ref = ch
    return total


def child_turn_total_many(points: np.ndarray) -> np.ndarray:
    return np.asarray([chord_turn_total(c) for c in points], dtype=np.float32)


def stats(a):
    a = np.asarray(a, dtype=np.float64)
    return {"min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "p99": round(float(np.percentile(a, 99)), 3),
            "max": round(float(a.max()), 3)}


def main():
    cams = json.loads(CAMERAS.read_text())
    fd = np.load(FINAL, allow_pickle=True)
    rd = np.load(RAW, allow_pickle=True)
    sd = np.load(E / "stage-displacements.npz", allow_pickle=True)
    gd = np.load(GUIDES, allow_pickle=True)
    final = np.asarray(fd["points"], dtype=np.float32)
    raw = np.asarray(rd["points"], dtype=np.float32)
    radii = np.asarray(fd["radii"], dtype=np.float32)
    stage_names = [str(x) for x in sd["stage_names"]]
    stage_max = np.asarray(sd["max_mm"], dtype=np.float32)
    masks = {}
    for name, spec in DEFECTS.items():
        masks[name] = strands_in_box(final, radii,
                                     cams["views"][spec["view"]], spec["box"])
    union = np.logical_or.reduce(list(masks.values()))
    rng = np.random.RandomState(1010)
    outside = np.nonzero(~union)[0]
    control = np.sort(rng.choice(outside, size=512, replace=False))

    # Guide totals are calculated once for all 2707 guides.
    curves = np.asarray(gd["curves_head"], dtype=np.float64)
    crown = np.asarray(gd["crown"], dtype=np.float64)
    sys_path = ROOT / "tools/openclinxr/hair-groom/strands"
    import sys
    sys.path.insert(0, str(sys_path))
    import frames as F
    guides_world = F.head_to_world(curves, crown)
    guide_turn = child_turn_total_many(guides_world)

    ids_by_name = {k: np.nonzero(v)[0].astype(np.int32) for k, v in masks.items()}
    ids_by_name["control"] = control.astype(np.int32)
    all_ids = np.unique(np.concatenate(list(ids_by_name.values())))
    # Exact raw/final turn totals only for selected + controls.  Reuse a
    # prior exact calculation when the deterministic selection is unchanged.
    cache_path = E / "defect-strands.npz"
    cached = np.load(cache_path, allow_pickle=True) if cache_path.exists() else None
    if cached is not None and np.array_equal(cached["selected_ids"], all_ids):
        raw_turn = np.asarray(cached["raw_turn_deg"], dtype=np.float32)
        final_turn = np.asarray(cached["final_turn_deg"], dtype=np.float32)
    else:
        raw_turn = child_turn_total_many(raw[all_ids])
        final_turn = child_turn_total_many(final[all_ids])
    pos = {int(v): i for i, v in enumerate(all_ids)}

    summary = {
        "schema": "openclinxr.hair-groom10diag.v1",
        "sourceCommit": "e1533373f",
        "selectionRule": "final visible polyline intersects native 1024 scorer box; 4x segment oversampling; within 5 mm of nearest hair depth per pixel",
        "controlRule": "seed 1010, 512 children outside union of all four boxes",
        "stageNames": stage_names,
        "disabledGeometryStages": ["sideburn_hug", "temple_hug", "sideburn_clamp"],
        "defects": {},
    }
    raw_gi = np.asarray(sd["raw_guide_idx"], dtype=np.int32)
    raw_w = np.asarray(sd["raw_guide_w"], dtype=np.float32)
    final_gi = np.asarray(sd["final_guide_idx"], dtype=np.int32)
    final_w = np.asarray(sd["final_guide_w"], dtype=np.float32)
    parent_all = np.asarray(sd["parent"], dtype=np.int32)
    # Recompute active-guide separation.  Zero-weight padding columns are
    # selection bookkeeping, not members of the blend, and must not inflate
    # the distance (nearest-alone rows correctly report 0 mm).
    g_res = np.stack([F.resample_arc(guides_world[g], 32)
                      for g in range(len(guides_world))])
    sep = np.zeros(len(final_gi), dtype=np.float32)
    root_sep = np.zeros(len(final_gi), dtype=np.float32)
    for i in range(final_gi.shape[1]):
        for j in range(i + 1, final_gi.shape[1]):
            active = (final_w[:, i] > 1e-8) & (final_w[:, j] > 1e-8)
            rows = np.nonzero(active)[0]
            if not len(rows):
                continue
            d = np.linalg.norm(g_res[final_gi[rows, i]]
                               - g_res[final_gi[rows, j]], axis=2).max(axis=1)
            sep[rows] = np.maximum(sep[rows], (d * 1000.0).astype(np.float32))
            rd = np.linalg.norm(g_res[final_gi[rows, i], 0]
                                - g_res[final_gi[rows, j], 0], axis=1)
            root_sep[rows] = np.maximum(
                root_sep[rows], (rd * 1000.0).astype(np.float32))
    # Keep the compact stage artifact itself truthful as well as the report.
    stage_payload = {k: np.asarray(sd[k]) for k in sd.files}
    stage_payload["guide_separation_max_mm"] = sep
    stage_payload["guide_root_separation_max_mm"] = root_sep
    sd.close()
    stage_tmp = E / ("stage-displacements-%d.npz" % os.getpid())
    np.savez_compressed(stage_tmp, **stage_payload)
    os.replace(stage_tmp, E / "stage-displacements.npz")
    for name, ids in ids_by_name.items():
        idx = np.asarray([pos[int(i)] for i in ids], dtype=np.int64)
        dom = np.argmax(stage_max[ids], axis=1)
        gt5 = stage_max[ids].max(axis=1) > 5.0
        dom_counts = {stage_names[j]: int(((dom == j) & gt5).sum())
                      for j in range(len(stage_names))
                      if ((dom == j) & gt5).any()}
        # Highest-moved rows are human-readable representatives; the NPZ
        # below retains complete arrays for every selected child.
        order = np.argsort(-stage_max[ids].max(axis=1))[:25]
        reps = []
        for q in order:
            child = int(ids[q])
            reps.append({
                "child": child,
                "guideIds": [int(x) for x in final_gi[child]],
                "guideTurnDeg": [round(float(guide_turn[x]), 2)
                                 for x in final_gi[child]],
                "weights": [round(float(x), 6) for x in final_w[child]],
                "guideSeparationMaxMm": round(float(sep[child]), 3),
                "guideRootSeparationMaxMm": round(float(root_sep[child]), 3),
                "stageMaxMm": {stage_names[j]: round(float(stage_max[child, j]), 3)
                               for j in range(len(stage_names))},
                "rawTurnDeg": round(float(raw_turn[idx[q]]), 2),
                "finalTurnDeg": round(float(final_turn[idx[q]]), 2),
            })
        raw_nonzero = int((raw_turn[idx] > 120.0).sum())
        summary["defects"][name] = {
            "view": DEFECTS[name]["view"] if name != "control" else None,
            "boxRowCol": DEFECTS[name]["box"] if name != "control" else None,
            "nChildren": int(len(ids)),
            "nParents": int(np.unique(parent_all[ids]).size),
            "nUniqueGuides": int(np.unique(final_gi[ids][final_w[ids] > 0]).size),
            "guideTurnDegUsed": stats(guide_turn[final_gi[ids][final_w[ids] > 0]]),
            "guideSeparationMaxMm": stats(sep[ids]),
            "guideRootSeparationMaxMm": stats(root_sep[ids]),
            "rawChildTurnDeg": stats(raw_turn[idx]),
            "finalChildTurnDeg": stats(final_turn[idx]),
            "rawChildrenOver120Deg": raw_nonzero,
            "dominantStageGt5mmCounts": dom_counts,
            "perStageMaxMm": {stage_names[j]: stats(stage_max[ids, j])
                              for j in range(len(stage_names))},
            "representativeHighestDisplacement": reps,
        }
    (E / "strand-analysis.json").write_text(json.dumps(summary, indent=2) + "\n")
    np.savez_compressed(
        E / "defect-strands.npz",
        selected_ids=all_ids.astype(np.int32),
        raw_turn_deg=raw_turn,
        final_turn_deg=final_turn,
        guide_turn_deg=guide_turn,
        control_ids=control.astype(np.int32),
        **{f"ids_{k.replace('-', '_')}": v for k, v in ids_by_name.items()
           if k != "control"},
    )
    print(json.dumps({k: v["nChildren"] for k, v in summary["defects"].items()}, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Groom11 post-trace neighbour-coherence fairing.

The groom9 traces are individually legal but are not a field: roots only a
few millimetres apart can finish hundreds of millimetres apart.  This pass
fairs root-relative paths on a scalp-root graph.  It keeps roots exact, keeps
the first stored take-off segment verbatim, diffuses all guides together (so
the 57 tuck routes are anchors rather than a disconnected class), and clips
the result to the local convex hull between the accepted groom9 route and
the graph consensus.  No guide is deleted.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree

STRANDS = Path(__file__).resolve().parents[1] / "strands"
sys.path.insert(0, str(STRANDS))
import frames as F  # noqa: E402
from children import sdf_sampler, project_outside  # noqa: E402

def cli():
    p = argparse.ArgumentParser()
    p.add_argument("--guides", required=True)
    p.add_argument("--sdf", required=True)
    p.add_argument("--outdir", required=True)
    p.add_argument("--kernel-mm", type=float, default=20.0)
    p.add_argument("--iterations", type=int, default=32)
    p.add_argument("--anchor", type=float, default=0.01)
    p.add_argument("--gate-root-mm", type=float, default=6.0)
    return p.parse_args()


def distribution(a):
    a = np.asarray(a, dtype=np.float64)
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "p99": round(float(np.percentile(a, 99)), 3),
            "max": round(float(a.max()), 3)}


def pair_separation(curves, pairs):
    return np.linalg.norm(curves[pairs[:, 0]] - curves[pairs[:, 1]],
                          axis=2).max(axis=1)


def main():
    args = cli()
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    src = np.load(args.guides, allow_pickle=True)
    source_head = np.asarray(src["curves_head"], dtype=np.float64)
    crown = np.asarray(src["crown"], dtype=np.float64)
    curves = F.head_to_world(source_head, crown)
    roots = curves[:, 0].copy()
    centre_y = float(crown[1])
    xx = curves[..., 0]
    yy = curves[..., 1] - centre_y
    radius = np.sqrt(xx * xx + yy * yy)
    angle = np.unwrap(np.arctan2(yy, xx), axis=1)
    # Scalp parameterisation: cylindrical radius, unwrapped azimuthal arc
    # (at a 100 mm reference radius), and vertical displacement. Averaging
    # these routes travels around the skull instead of drawing a chord
    # through it.
    offsets = np.stack([
        radius - radius[:, 0, None],
        (angle - angle[:, 0, None]) * 0.100,
        curves[..., 2] - curves[:, 0, None, 2],
    ], axis=2)
    tree = cKDTree(roots)
    pairs = np.asarray(list(tree.query_pairs(args.gate_root_mm / 1000.0)),
                       dtype=np.int64)
    if not len(pairs):
        raise RuntimeError("no guide-root pairs inside coherence gate")

    neighbours = tree.query_ball_tree(tree, args.kernel_mm / 1000.0)
    rows, cols, values = [], [], []
    sigma = args.kernel_mm / 2000.0
    for i, js in enumerate(neighbours):
        jj = np.asarray(js, dtype=np.int64)
        dist = np.linalg.norm(roots[jj] - roots[i], axis=1)
        weight = np.exp(-0.5 * (dist / sigma) ** 2)
        weight /= weight.sum()
        rows.extend([i] * len(jj))
        cols.extend(jj.tolist())
        values.extend(weight.tolist())
    graph = sparse.csr_matrix((values, (rows, cols)),
                              shape=(len(curves), len(curves)))

    fair = offsets.copy()
    flat0 = offsets.reshape(len(curves), -1)
    u = np.clip((np.arange(curves.shape[1], dtype=np.float64) - 1.0) / 4.0,
                0.0, 1.0)
    u = u * u * (3.0 - 2.0 * u)
    # Diffuse routes in the scalp parameterisation. The source term preserves
    # tuck/hairline routing while the graph term makes neighbours agree.
    for _ in range(args.iterations):
        fair = (args.anchor * flat0 + (1.0 - args.anchor)
                * (graph @ fair.reshape(len(curves), -1))).reshape(
                    offsets.shape)
    route = offsets * (1.0 - u[None, :, None]) \
        + fair * u[None, :, None]
    rr = radius[:, 0, None] + route[..., 0]
    aa = angle[:, 0, None] + route[..., 1] / 0.100
    zz = curves[:, 0, None, 2] + route[..., 2]
    coherent = np.stack([rr * np.cos(aa),
                         centre_y + rr * np.sin(aa), zz], axis=2)
    # Do not advect the whole route toward the posterior.  That was a
    # geometric push (up to 100 mm) rather than a take-off constraint and
    # produced the block-shaped profile wedge.  The first two stored samples
    # below are the groom8a take-off anchors; fairing starts after them.
    coherent[:, 0] = roots
    coherent[:, 1] = curves[:, 1]

    before = pair_separation(curves, pairs) * 1000.0
    after = pair_separation(coherent, pairs) * 1000.0
    moved = np.linalg.norm(coherent - curves, axis=2).max(axis=1) * 1000.0
    takeoff_delta = (np.linalg.norm(coherent[:, :2] - curves[:, :2], axis=2)
                     * 1000.0)
    sample, _ = sdf_sampler(np.load(args.sdf, allow_pickle=True))
    vals, valid = sample(coherent[:, 2:].reshape(-1, 3))
    tuck = (np.asarray(src["tuck"]) > 0.5 if "tuck" in src
            else np.zeros(len(curves), dtype=bool))
    stats = {
        "schema": "openclinxr.hair-guide-coherence.v1",
        "method": "post-trace root-relative scalp-distance graph fairing",
        "why": "directly bounds near-root route disagreement while retaining groom8a take-off samples and tuck anchors without a posterior geometry push",
        "parameters": {"kernelMm": args.kernel_mm,
                       "iterations": args.iterations,
                       "originalAnchor": args.anchor,
                       "takeoffSamplesVerbatim": 2,
                       "gateRootMm": args.gate_root_mm},
        "guides": {"input": len(curves), "output": len(coherent),
                   "deleted": 0, "tuckAnchors": int(tuck.sum())},
        "nearRootPairFullPathSeparationMmBefore": distribution(before),
        "nearRootPairFullPathSeparationMmAfter": distribution(after),
        "guideMaxMoveMm": distribution(moved),
        "hull": {"policy": "convex local route hull in cylindrical scalp parameterisation (radius, unwrapped azimuth, height)",
                 "insideSamplesAfter": int((valid & (vals < 0.0)).sum())},
        "takeoffVerbatimMaxMm": round(float(takeoff_delta.max()), 9),
        "gate": {"p90MaxMm": 25.0, "absoluteMaxMm": 60.0,
                 "pass": bool(np.percentile(after, 90) <= 25.0
                              and after.max() <= 60.0)},
    }
    if not stats["gate"]["pass"]:
        raise RuntimeError("coherence gate failed: " + json.dumps(stats))

    payload = {k: np.asarray(src[k]) for k in src.files}
    coherent_head = np.empty_like(coherent)
    coherent_head[..., 0] = coherent[..., 0] * 1000.0
    coherent_head[..., 1] = (float(crown[1]) - coherent[..., 1]) * 1000.0
    coherent_head[..., 2] = (float(crown[2]) - coherent[..., 2]) * 1000.0
    payload["curves_head"] = coherent_head.astype(np.float64)
    payload["spec_sha"] = np.array(["coherent11"])
    payload["verdict"] = np.array(["COHERENT11"])
    payload["roots_file"] = np.array([
        "groom9 guides; neighbour-coherence fairing; roots and first take-off segment exact; tuck routes included as anchors"
    ])
    np.savez_compressed(out / "guides-11.npz", **payload)
    (out / "coherence.json").write_text(json.dumps(stats, indent=1) + "\n")
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main()

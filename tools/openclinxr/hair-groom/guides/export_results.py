#!/usr/bin/env python3
"""Export STEP 4 artifacts: E/guides.npz, E/fit.png, E/heights.json.

Loads the best all-view fit, regrows guides, writes the guide curves
(the station's first real artifact), the per-view fit figure (target
outline + occluded raster + region boxes), and the end-height table
(vs shoulder plane z=1.405 m and chin/menton per azimuth bin).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

S4 = Path(__file__).resolve().parent
ROOT = S4.parents[3]
sys.path.insert(0, str(S4))
import fit_guides as FIT  # noqa: E402
import grow as GROW  # noqa: E402
import instruments as INS  # noqa: E402

OPENED = []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", required=True)
    args = ap.parse_args()
    evidence = Path(args.evidence)
    ctx = FIT.Context(evidence)
    print("SPEC_SHA %s" % ctx.spec_sha, flush=True)
    assert ctx.spec_sha == (evidence / "spec-sha-before-fit.txt"
                            ).read_text().strip(), "spec sha drift!"
    fit = json.loads((evidence / "fit-all.json").read_text())
    best = fit["best"]
    values = np.array(best["values"])
    grown = GROW.grow_guides(values, ctx.spec, ctx.roots, ctx.egrid,
                             ctx.anchors)
    print("GUIDES hash=%s n_proj_fall=%d max_proj_fall=%.2fmm "
          "n_proj_shell=%d min_sdf=%.2fmm inside=%d"
          % (GROW.guide_hash(grown), grown["n_proj_fall"],
             grown["max_proj_fall_mm"], grown["n_proj_shell"],
             grown["min_sdf_mm"], grown["n_inside_mm"]), flush=True)
    # guides.npz: the fitted guide curves + fit provenance
    GROW.save_guides(
        evidence / "guides.npz", grown, ctx.spec_sha, values,
        ctx.names,
        extra={"crown": np.asarray(ctx.crown, dtype=np.float64),
               "roots_file": np.array([ctx.roots["path"]]),
               "roots_rule": np.array([ctx.roots["rule"]]),
               "start": np.array([best["start"]]),
               "gate_fails": np.array([" | ".join(
                   fit["starts"][best["start"]]["gateFails"])]),
               })
    # occluded raster at the best fit for the figure
    p = dict(zip(ctx.names, [float(v) for v in values]))
    union, _ = FIT.rasterize(ctx, grown, p["tube_r"], INS.VIEWS)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import matplotlib.patches as patches
    fig, axes = plt.subplots(1, 3, figsize=(15, 5.2))
    for ax, v in zip(axes, INS.VIEWS):
        tgt = ctx.targets[v]
        ax.imshow(np.zeros((*tgt.shape, 3), dtype=np.uint8) + 18)
        ax.contour(tgt, levels=[0.5], colors=["#4da3ff"], linewidths=(1.2,))
        ax.contour(union[v], levels=[0.5], colors=["#ffb020"],
                   linewidths=(1.2,))
        for name, box in ctx.regions[v].items():
            if not box:
                continue
            r0, r1, c0, c1 = box
            ax.add_patch(patches.Rectangle(
                (c0, r0), c1 - c0, r1 - r0, fill=False, edgecolor="#3ddc84",
                linewidth=0.8, linestyle=":"))
        ax.set_title("%s (blue target, amber occluded raster)" % v,
                     fontsize=9, color="white")
        ax.set_xlim(0, 1024)
        ax.set_ylim(1024, 0)
        ax.set_facecolor("#111111")
    fig.suptitle("guides1 best=%s cost=%.0f fails=%d" % (
        best["start"], best["cost"],
        len(fit["starts"][best["start"]]["gateFails"])), color="white")
    fig.patch.set_facecolor("#111111")
    fig.tight_layout()
    fig.savefig(evidence / "fit.png", dpi=110, facecolor=fig.get_facecolor())
    print("WROTE fit.png", flush=True)
    # heights: end height vs shoulder (1405) and chin per azimuth bin
    world = GROW.head_to_world(grown["curves_head"][:, -1, :], ctx.crown)
    z_mm = world[:, 2] * 1000.0
    az = grown["az"]
    bins = {}
    for lo in range(-180, 180, 30):
        sel = (az >= lo) & (az < lo + 30)
        if not sel.any():
            continue
        zm = z_mm[sel]
        bins["%d..%d" % (lo, lo + 30)] = {
            "n": int(sel.sum()),
            "endZmmMean": round(float(zm.mean()), 1),
            "vsShoulderMm": round(float(zm.mean()) - 1405.0, 1),
            "vsChinMm": round(float(zm.mean()) - ctx.menton_z_mm, 1),
        }
    heights = {"shoulderZm": 1405.0, "chinZmm": round(ctx.menton_z_mm, 1),
               "crownZmm": round(float(ctx.crown[2]) * 1000.0, 1),
               "bins": bins,
               "endDropC0mm": round(float(p["end_c0"]), 1)}
    (evidence / "heights.json").write_text(
        json.dumps(heights, indent=2, sort_keys=True) + "\n")
    print("WROTE heights.json", flush=True)
    dest = evidence / "inputs-opened.txt"
    seen = set(dest.read_text().splitlines()) if dest.exists() else set()
    seen.update(FIT.OPENED)
    seen.update([str(Path(__file__).resolve())])
    dest.write_text("\n".join(sorted(seen)) + "\n")


if __name__ == "__main__":
    main()

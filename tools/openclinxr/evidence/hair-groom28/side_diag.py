#!/usr/bin/env python3
"""hair-groom28 STEP 1: per-side (+x vs -x) diagnosis of the back fairing.

Reads guides-19 / guides-25b / guides-8a from the hair-tgt2 tree (read-only).
Replicates the s11 graph (20 mm chord over BACK non-tuck roots) and the
interp_children pool-drop (pool = band<0.5 guides, drop move-vs-8a > 60 mm).

Outputs: E/side-diag.json + E/side-topview.png (top view of back guide
roots coloured by 19->25b displacement, arrows = mean fairing-delta
direction in xy).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

E = Path(__file__).resolve().parent
T2 = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
sys.path.insert(0, str(T2 / "tools/openclinxr/hair-groom/strands"))
import frames as F  # noqa: E402

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

G19 = T2 / "tools/openclinxr/evidence/hair-groom19/build/guides-19.npz"
G25B = T2 / "tools/openclinxr/evidence/hair-groom25/build-25b/guides-25b.npz"
G8A = T2 / "tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz"
Y_EAR = -0.0635
Z_NAPE = 1.51
KERNEL_MM = 20.0
POOL_MAX_MM = 60.0


def load(p):
    d = np.load(str(p), allow_pickle=True)
    head = np.asarray(d["curves_head"], dtype=np.float64)
    crown = np.asarray(d["crown"], dtype=np.float64)
    tuck = (np.asarray(d["tuck"]) > 0.5) if "tuck" in d.files \
        else np.zeros(len(head), dtype=bool)
    band = np.asarray(d["band"], dtype=np.float64) if "band" in d.files \
        else np.zeros(len(head))
    return head, crown, tuck, band


def dist(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    return {"n": int(a.size), "min": round(float(a.min()), 3),
            "mean": round(float(a.mean()), 3),
            "p50": round(float(np.percentile(a, 50)), 3),
            "p90": round(float(np.percentile(a, 90)), 3),
            "p99": round(float(np.percentile(a, 99)), 3),
            "max": round(float(a.max()), 3)}


def main():
    h19, c19, tuck19, band19 = load(G19)
    h25, c25, tuck25, band25 = load(G25B)
    h8a, c8a, _, _ = load(G8A)
    assert h19.shape == h25.shape == h8a.shape, \
        (h19.shape, h25.shape, h8a.shape)
    w19 = F.head_to_world(h19, c19)
    w25 = F.head_to_world(h25, c25)
    w8a = F.head_to_world(h8a, c8a)
    roots = w19[:, 0].copy()

    back = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
    graph = back & ~tuck19
    gidx = np.nonzero(graph)[0]

    # s11 neighbour graph (3D chord, 20 mm) over BACK non-tuck roots
    R = roots[gidx]
    tree = cKDTree(R)
    neigh = tree.query_ball_tree(tree, KERNEL_MM / 1000.0)
    ncount = np.array([len(js) for js in neigh])  # includes self

    # fairing displacement 19 -> 25b (world mm, max over samples)
    move = np.linalg.norm(w25 - w19, axis=2).max(axis=1) * 1000.0
    # pool-drop replication (pool = band<0.5, move vs 8a full-curve max)
    mv8 = np.linalg.norm(w25 - w8a, axis=2).max(axis=1) * 1000.0
    pool = np.nonzero(band25 < 0.5)[0]
    dropped = np.zeros(len(h25), dtype=bool)
    dropped[pool[mv8[pool] > POOL_MAX_MM]] = True

    # mean fairing-delta direction per guide (world mm, all samples)
    delta = (w25 - w19) * 1000.0
    meand = delta.mean(axis=1)

    out = {"inputs": {"guides19": str(G19), "guides25b": str(G25B),
                      "poolRef": str(G8A)},
           "nBack": int(back.sum()), "nGraph": int(graph.sum())}
    sides = {}
    for sname, smask in (("posX", roots[:, 0] >= 0.0),
                         ("negX", roots[:, 0] < 0.0)):
        m = graph & smask
        idx = np.nonzero(m)[0]
        pos = np.searchsorted(gidx, idx)  # positions in graph order
        md = meand[idx]
        meanv = md.mean(axis=0) if len(md) else np.zeros(3)
        norm = float(np.linalg.norm(meanv))
        unit = (meanv / norm).tolist() if norm > 0 else [0.0, 0.0, 0.0]
        sides[sname] = {
            "nGuides": int(m.sum()),
            "moveMm_19to25b": dist(move[idx]),
            "neighbourCount": dist(ncount[pos]),
            "nPoolDropped": int((dropped & m).sum()),
            "nPoolDroppedBackAll": int((dropped & back & smask).sum()),
            "meanDeltaMm": {"x": round(float(meanv[0]), 3),
                            "y": round(float(meanv[1]), 3),
                            "z": round(float(meanv[2]), 3),
                            "normMm": round(norm, 3),
                            "unit": [round(float(v), 4) for v in unit]},
        }
    out["sides"] = sides
    out["poolDropTotal"] = int(dropped.sum())
    out["note"] = ("x: lateral(+x/-x); y: anterior(+)/posterior(-); "
                   "z: up(+)/down(-)")
    (E / "side-diag.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1))

    # top-view plot: back guide roots, colour = displacement, arrow = xy delta
    fig, ax = plt.subplots(figsize=(9, 7))
    sc = ax.scatter(roots[gidx, 0] * 1000.0, roots[gidx, 1] * 1000.0,
                    c=move[gidx], cmap="inferno", s=14, zorder=2)
    plt.colorbar(sc, ax=ax, label="19->25b max move (mm)")
    # quiver: per-guide mean delta xy, subsample for legibility
    sel = np.arange(len(gidx))
    qx = roots[gidx, 0] * 1000.0
    qy = roots[gidx, 1] * 1000.0
    qu = meand[gidx, 0]
    qv = meand[gidx, 1]
    ax.quiver(qx, qy, qu, qv, color="cyan", scale=400.0, width=0.003,
              alpha=0.7, zorder=3)
    ax.axvline(0.0, color="white", lw=0.8, alpha=0.6)
    ax.set_xlabel("world x (mm) +right/-left")
    ax.set_ylabel("world y (mm) -posterior/+anterior")
    ax.set_title("back graph roots: displacement + mean delta dir (top view)")
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(E / "side-topview.png", dpi=110)
    print("WROTE E/side-diag.json E/side-topview.png")


if __name__ == "__main__":
    main()

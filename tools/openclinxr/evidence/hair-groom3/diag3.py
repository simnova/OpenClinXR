#!/usr/bin/env python3
"""hair-groom3 STEP 1 diagnosis: which roots/guides make the frizz, strays, tuft.

Projects groom2 strand samples to three_quarter + profile_90 + back + front
(pinhole from the scorer manifest, same math as children.py _covers) and
attributes in-box strands to parent root regions + guide ids + length/curvature.

Writes E/diag3.json + E/diag3_regions_{3q,profile,back}.png (beauty + strand
dots coloured by root region) + E/diag3_guides_ear.png (dots near the ear
coloured by dominant guide id).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

E3 = Path(__file__).resolve().parent
ROOT = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-tgt2")
E2 = ROOT / "tools/openclinxr/evidence/hair-groom2"
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
sys.path.insert(0, str(ROOT / "tools/openclinxr/hair-groom/strands"))
import common9 as C  # noqa: E402 (helpers only)

BEAUTY = {"front": ("target-front-a1.png", E2 / "renders-studio/front.png"),
          "three_quarter": ("target-three_quarter-a1.png", E2 / "renders-studio/three_quarter.png"),
          "profile_90": ("target-profile.png", E2 / "renders-studio/profile_90.png"),
          "back": ("target-back.png", E2 / "renders-studio/back.png")}
MASKF = {"front": "mask-front.png", "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png", "back": "mask-back.png"}


def load_proj():
    cams = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
    sensor = float(cams["sensorWidthMm"])
    proj = {}
    for v in ("front", "three_quarter", "profile_90", "back"):
        m = np.array(cams["views"][v]["matrixWorld"], dtype=np.float64)
        f = float(cams["views"][v]["lensMm"]) / sensor * 1024.0
        proj[v] = (np.linalg.inv(m), f)
    return proj


def project(pts, inv, f):
    hw = np.ones((len(pts), 4))
    hw[:, :3] = pts
    lc = (inv @ hw.T).T
    dep = -lc[:, 2]
    cc = np.full(len(pts), -1.0)
    rr = np.full(len(pts), -1.0)
    ok = dep > 0
    cc[ok] = 512.0 + (lc[ok, 0] / dep[ok]) * f
    rr[ok] = 512.0 - (lc[ok, 1] / dep[ok]) * f
    return cc, rr, dep


def region_of(xyz):
    """Root region labels (world metres; face = -y)."""
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    lab = np.full(len(xyz), "side", dtype=object)
    lab[(np.abs(x) < 0.008) & (z > 1.575)] = "part"
    lab[(z >= 1.590) & (np.abs(x) >= 0.008)] = "crown"
    lab[(np.abs(x) >= 0.045) & (np.abs(x) < 0.072) & (y >= -0.135) & (y < -0.085)] = "temple"
    lab[(np.abs(x) >= 0.052) & (y >= -0.100) & (y < -0.040)] = "sideburn"
    lab[(y >= 0.0)] = "nape"
    return lab


def main():
    out = {}
    sdoc = np.load(E2 / "strands.npz")
    pts = np.asarray(sdoc["points"], dtype=np.float64)
    rxyz_parent = np.asarray(sdoc["roots"], dtype=np.float64)  # sub-roots (children roots)
    gi = np.asarray(sdoc["guide_idx"])
    gw = gi[:, 0]
    n, P, _ = pts.shape
    rdoc = np.load(ROOT / "tools/openclinxr/evidence/hair-scalp1/roots.npz")
    rxyz = np.asarray(rdoc["xyz"], dtype=np.float64)
    K = n // len(rxyz)
    parent = np.repeat(np.arange(len(rxyz)), K)
    # parent root region via nearest scalp root of each sub-root
    pr = rxyz[parent]
    lab = region_of(pr)
    ulab, counts = np.unique(lab, return_counts=True)
    out["regionCounts"] = {str(k): int(v) for k, v in zip(ulab, counts)}
    # strand length + tortuosity
    seg = np.diff(pts, axis=1)
    seglen = np.linalg.norm(seg, axis=2)
    L = seglen.sum(axis=1)
    chord = np.linalg.norm(pts[:, -1, :] - pts[:, 0, :], axis=1)
    tort = L / np.maximum(chord, 1e-9)
    out["lengthMm"] = {"p50": round(float(np.percentile(L, 50)) * 1000, 1),
                       "p5": round(float(np.percentile(L, 5)) * 1000, 1),
                       "p95": round(float(np.percentile(L, 95)) * 1000, 1)}
    out["tortuosity"] = {"p50": round(float(np.percentile(tort, 50)), 3),
                         "p95": round(float(np.percentile(tort, 95)), 3),
                         "p99": round(float(np.percentile(tort, 99)), 3)}

    proj = load_proj()
    pdoc = np.load(ROOT / "tools/openclinxr/evidence/hair-hull3/workspace/ear_pinna.npz")
    pinna = np.vstack([np.asarray(pdoc["xyz"])[np.asarray(pdoc["idx_earXpos"])],
                       np.asarray(pdoc["xyz"])[np.asarray(pdoc["idx_earXneg"])]])

    # pinna projection per view -> frizz box anterior of ear
    boxes = {}
    for v in ("three_quarter", "profile_90", "front"):
        inv, f = proj[v]
        cc, rr, dep = project(pinna, inv, f)
        m = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dep > 0)
        # face-ward direction in px: project ear centroid shifted -y (anterior)
        c0 = pinna[m].mean(axis=0) if m.any() else pinna.mean(axis=0)
        c_face = c0 + np.array([0, -0.05, 0.01])
        fx, fy, _ = project(c_face[None, :], inv, f)
        ecx, ery = float(cc[m].mean()), float(rr[m].mean())
        dx = float(fx[0]) - ecx
        sx = 1.0 if dx >= 0 else -1.0  # face side in +col or -col
        x0, x1 = (ecx, ecx + sx * 150.0)
        lo, hi = sorted([x0, x1])
        # clip to anterior of ear bbox edge
        boxes[v] = {"cols": [round(lo, 1), round(hi, 1)],
                    "rows": [round(float(rr[m].min()) - 60, 1), round(float(rr[m].max()) + 60, 1)],
                    "earCx": round(ecx, 1), "earCy": round(ery, 1)}
    out["frizzBoxes"] = boxes

    # attribute: strands with >=3 samples in box
    mid = pts[:, 4::4, :].reshape(-1, 3)
    owner = np.repeat(np.arange(n), mid.shape[0] // n if False else 1)
    # rebuild owner properly
    per = pts[:, 4::4, :].shape[1]
    owner = np.repeat(np.arange(n), per)
    attr = {}
    for v in ("three_quarter", "profile_90", "front"):
        inv, f = proj[v]
        cc, rr, dep = project(mid, inv, f)
        b = boxes[v]
        inb = (cc >= b["cols"][0]) & (cc <= b["cols"][1]) & (rr >= b["rows"][0]) & (rr <= b["rows"][1]) & (dep > 0)
        cnt = np.zeros(n, dtype=int)
        np.add.at(cnt, owner[inb], 1)
        sel = cnt >= 3
        rl, rc = np.unique(lab[sel], return_counts=True)
        gl, gc = np.unique(gw[sel], return_counts=True)
        topg = sorted(zip(gl.tolist(), gc.tolist()), key=lambda t: -t[1])[:12]
        attr[v] = {"nStrands": int(sel.sum()),
                   "regions": {str(k): int(z) for k, z in zip(rl, rc)},
                   "lenMmP50": round(float(np.percentile(L[sel], 50)) * 1000, 1) if sel.any() else 0.0,
                   "tortP95": round(float(np.percentile(tort[sel], 95)), 3) if sel.any() else 0.0,
                   "topGuides": [[int(g), int(c)] for g, c in topg]}
    out["frizzAttr"] = attr

    # strays: back view tips >25px outside target mask
    tmask_back = np.array(Image.open(SCR / MASKF["back"])) > 127
    from scipy import ndimage
    edt = ndimage.distance_transform_edt(~tmask_back)
    inv, f = proj["back"]
    tip = pts[:, -1, :]
    cc, rr, dep = project(tip, inv, f)
    ci = np.clip(cc.round().astype(int), 0, 1023)
    ri = np.clip(rr.round().astype(int), 0, 1023)
    ok = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dep > 0)
    d = np.zeros(n)
    d[ok] = edt[ri[ok], ci[ok]]
    stray = ok & (d > 25)
    rl, rc = np.unique(lab[stray], return_counts=True)
    gl, gc = np.unique(gw[stray], return_counts=True)
    out["strayBack"] = {"nStrands": int(stray.sum()),
                        "regions": {str(k): int(z) for k, z in zip(rl, rc)},
                        "lenMmP50": round(float(np.percentile(L[stray], 50)) * 1000, 1) if stray.any() else 0.0,
                        "topGuides": sorted([[int(g), int(c)] for g, c in zip(gl, gc)], key=lambda t: -t[1])[:12]}

    # crown tuft: 3q samples above/outside target mask in crown band (rows < 300)
    tmask_3q = np.array(Image.open(SCR / MASKF["three_quarter"])) > 127
    edt3 = ndimage.distance_transform_edt(~tmask_3q)
    inv, f = proj["three_quarter"]
    up = pts[:, 2:12:2, :].reshape(-1, 3)
    own2 = np.repeat(np.arange(n), up.shape[0] // n)
    cc, rr, dep = project(up, inv, f)
    ci = np.clip(cc.round().astype(int), 0, 1023)
    ri = np.clip(rr.round().astype(int), 0, 1023)
    ok = (cc >= 0) & (cc < 1024) & (rr < 300) & (dep > 0)
    dd = np.zeros(len(up))
    dd[ok] = edt3[ri[ok], ci[ok]]
    bad = ok & (dd > 12)
    cnt = np.zeros(n, dtype=int)
    np.add.at(cnt, own2[bad], 1)
    sel = cnt >= 2
    rl, rc = np.unique(lab[sel], return_counts=True)
    gl, gc = np.unique(gw[sel], return_counts=True)
    out["crownTuft3q"] = {"nStrands": int(sel.sum()),
                          "regions": {str(k): int(z) for k, z in zip(rl, rc)},
                          "topGuides": sorted([[int(g), int(c)] for g, c in zip(gl, gc)], key=lambda t: -t[1])[:12]}

    (E3 / "diag3.json").write_text(json.dumps(out, indent=1) + "\n")

    # plots: beauty + strand dots coloured by region (cap 4000 dots/view)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    REG_COL = {"part": "cyan", "crown": "magenta", "temple": "yellow",
               "sideburn": "red", "nape": "lime", "side": "deepskyblue"}
    rng = np.random.RandomState(0)
    for v, key in (("three_quarter", "three_quarter"), ("profile_90", "profile_90"), ("back", "back")):
        img = np.asarray(Image.open(BEAUTY[v][1]).convert("RGB"))
        inv, f = proj[v]
        samp = pts[:, 6:30:3, :].reshape(-1, 3)
        own3 = np.repeat(np.arange(n), samp.shape[0] // n)
        cc, rr, dep = project(samp, inv, f)
        ok = (cc >= 0) & (cc < 1024) & (rr >= 0) & (rr < 1024) & (dep > 0)
        idx = np.nonzero(ok)[0]
        idx = idx[rng.rand(len(idx)) < 4000 / max(len(idx), 1)]
        fig, ax = plt.subplots(figsize=(10, 10))
        ax.imshow(img, extent=[0, 1024, 1024, 0])
        for r in sorted(set(lab.tolist())):
            m = lab[own3[idx]] == r
            ax.scatter(cc[idx[m]], rr[idx[m]], s=4, c=REG_COL.get(r, "white"), label=r, alpha=0.7)
        if v in boxes:
            b = boxes[v]
            ax.add_patch(plt.Rectangle((b["cols"][0], b["rows"][0]), b["cols"][1] - b["cols"][0],
                                       b["rows"][1] - b["rows"][0], fill=False, ec="white", lw=2))
        ax.set_xlim(0, 1024)
        ax.set_ylim(1024, 0)
        ax.legend(markerscale=3, fontsize=8, loc="lower right")
        ax.set_title("groom2 %s strands by parent-root region" % v)
        fig.savefig(E3 / ("diag3_regions_%s.png" % key), dpi=110)
        plt.close(fig)

    # guide-id plot near ear (3q): dots coloured by dominant guide
    img = np.asarray(Image.open(BEAUTY["three_quarter"][1]).convert("RGB"))
    inv, f = proj["three_quarter"]
    samp = pts[:, 2:32:2, :].reshape(-1, 3)
    own4 = np.repeat(np.arange(n), samp.shape[0] // n)
    cc, rr, dep = project(samp, inv, f)
    b = boxes["three_quarter"]
    ok = (cc >= b["cols"][0] - 60) & (cc <= b["cols"][1] + 60) & (rr >= b["rows"][0] - 60) & \
         (rr <= b["rows"][1] + 60) & (dep > 0)
    idx = np.nonzero(ok)[0]
    fig, ax = plt.subplots(figsize=(10, 10))
    ax.imshow(img, extent=[0, 1024, 1024, 0])
    sc = ax.scatter(cc[idx], rr[idx], s=6, c=gw[own4[idx]] % 20, cmap="tab20", alpha=0.8)
    plt.colorbar(sc, ax=ax, label="guide_id mod 20")
    ax.set_xlim(b["cols"][0] - 60, b["cols"][1] + 60)
    ax.set_ylim(b["rows"][1] + 60, b["rows"][0] - 60)
    ax.set_title("groom2 three_quarter ear zoom by guide id")
    fig.savefig(E3 / "diag3_guides_ear.png", dpi=110)
    plt.close(fig)
    print(json.dumps(out, indent=1))
    print("wrote diag3.json + 4 pngs")


if __name__ == "__main__":
    main()

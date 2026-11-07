#!/usr/bin/env python3
"""hair-groom25 STEP 1: diagnose where the silhouette was lost.

miss-map back/profile: target-minus-ours (miss, red) and ours-minus-target
(excess, cyan) for groom19 vs groom24, same registration (identical studio
rig/cameras, direct pixel compare). Plus row-band + side split of the miss
delta, and per-guide displacement guides-19 -> guides-21 coloured map.

Writes E/miss-map-back.png, E/miss-map-profile.png, E/displacement.png,
E/miss-diag.json.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
G19 = ROOT / "tools/openclinxr/evidence/hair-groom19/renders-studio"
G24 = ROOT / "tools/openclinxr/evidence/hair-groom24/renders-24"
MASKF = {"back": "mask-back.png", "profile_90": "mask-profile.png"}


def load_id(d, v):
    return (np.array(Image.open(str(d / (v + "-id.png"))).convert("RGBA"))[:, :, 3] >= 230)


def load_mask(v):
    return np.array(Image.open(str(SCR / MASKF[v]))) > 127


def band_side_stats(tgt, ours, name):
    miss = tgt & ~ours
    n_miss = int(miss.sum())
    ys = np.nonzero(tgt.any(axis=1))[0]
    y0, y1 = int(ys.min()), int(ys.max())
    h = (y1 - y0 + 1) / 3.0
    bands = {}
    for i, nm in enumerate(("top", "mid", "bot")):
        lo, hi = y0 + int(i * h), y0 + int((i + 1) * h)
        m = miss[lo:hi, :]
        cx = m.shape[1] // 2
        bands[nm] = {"rows": [lo, hi], "missPx": int(m.sum()),
                     "missLeft": int(m[:, :cx].sum()),
                     "missRight": int(m[:, cx:].sum())}
    xs = np.nonzero(tgt.any(axis=0))[0]
    x0, x1 = int(xs.min()), int(xs.max())
    return {"nMiss": n_miss, "tgtBBox": [y0, y1, x0, x1], "bands": bands}


def miss_map(v, g19, g24, tgt):
    miss19 = tgt & ~g19
    exc19 = g19 & ~tgt
    miss24 = tgt & ~g24
    exc24 = g24 & ~tgt
    H, W = tgt.shape
    panel = np.zeros((H, W, 3), dtype=np.uint8)
    # miss red, excess cyan, both-on white-ish; background dark gray
    panel[:, :] = (24, 24, 24)
    return (miss19, exc19, miss24, exc24)


def paint(miss, exc):
    H, W = miss.shape
    im = np.zeros((H, W, 3), dtype=np.uint8) + 24
    im[miss & ~exc] = (255, 60, 60)
    im[exc & ~miss] = (60, 220, 255)
    im[miss & exc] = (230, 230, 230)
    return Image.fromarray(im)


def main():
    out = {}
    for v in ("back", "profile_90"):
        tgt = load_mask(v)
        g19 = load_id(G19, v)
        g24 = load_id(G24, v)
        miss19, exc19, miss24, exc24 = miss_map(v, g19, g24, tgt)
        s19 = band_side_stats(tgt, g19, v)
        s24 = band_side_stats(tgt, g24, v)
        dmiss = {b: s24["bands"][b]["missPx"] - s19["bands"][b]["missPx"]
                 for b in ("top", "mid", "bot")}
        dside = {}
        for b in ("top", "mid", "bot"):
            dside[b] = {"dLeft": s24["bands"][b]["missLeft"] - s19["bands"][b]["missLeft"],
                        "dRight": s24["bands"][b]["missRight"] - s19["bands"][b]["missRight"]}
        out[v] = {"groom19": s19, "groom24": s24, "dMissPx": dmiss, "dSide": dside,
                  "dMissTotal": int(miss24.sum() - miss19.sum()),
                  "dExcessTotal": int(exc24.sum() - exc19.sum()),
                  "tgtBBox": s19["tgtBBox"]}
        # side-by-side: [miss19 | exc19 | miss24 | exc24], full 1024 wide each -> thumb
        row = Image.new("RGB", (4 * 1024, 1024), (16, 16, 16))
        for j, m in enumerate((paint(miss19, np.zeros_like(miss19)),
                               paint(np.zeros_like(exc19), exc19),
                               paint(miss24, np.zeros_like(miss24)),
                               paint(np.zeros_like(exc24), exc24))):
            row.paste(m, (j * 1024, 0))
        row = row.resize((4 * 512, 512))
        from PIL import ImageDraw
        dr = ImageDraw.Draw(row)
        for j, lab in enumerate(("19 MISS", "19 EXCESS", "24 MISS", "24 EXCESS")):
            dr.text((j * 512 + 12, 12), "%s %s" % (v, lab), fill=(240, 240, 240))
        row.save(E / ("miss-map-%s.png" % ("back" if v == "back" else "profile")))
        print(v, "dMissTotal=%d dExcessTotal=%d" % (out[v]["dMissTotal"], out[v]["dExcessTotal"]),
              json.dumps(dmiss), json.dumps(dside), flush=True)

    # per-guide displacement guides-19 -> guides-21 (world mm, max over samples)
    sys_path = str(ROOT / "tools/openclinxr/hair-groom/strands")
    import sys
    sys.path.insert(0, sys_path)
    import frames as F
    d19 = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom19/build/guides-19.npz"),
                  allow_pickle=True)
    d21 = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom21/build/guides-21.npz"),
                  allow_pickle=True)
    h19 = np.asarray(d19["curves_head"], dtype=np.float64)
    h21 = np.asarray(d21["curves_head"], dtype=np.float64)
    crown = np.asarray(d19["crown"], dtype=np.float64)
    w19 = F.head_to_world(h19, crown)
    w21 = F.head_to_world(h21, crown)
    roots = w19[:, 0]
    tuck = (np.asarray(d19["tuck"]) > 0.5)
    back_mask = (roots[:, 1] < -0.0635) & (roots[:, 2] > 1.51)
    moved = np.linalg.norm(w21 - w19, axis=2).max(axis=1) * 1000.0
    hem = np.linalg.norm(w21[:, -1] - w19[:, -1], axis=1) * 1000.0
    out["displacement"] = {
        "backN": int(back_mask.sum()), "tuckN": int(tuck.sum()),
        "movedBackMm": {"p50": round(float(np.median(moved[back_mask])), 1),
                        "p90": round(float(np.percentile(moved[back_mask], 90)), 1),
                        "max": round(float(moved[back_mask].max()), 1)},
        "movedBackNonTuckMm": {"p50": round(float(np.median(moved[back_mask & ~tuck])), 1),
                               "p90": round(float(np.percentile(moved[back_mask & ~tuck], 90)), 1),
                               "max": round(float(moved[back_mask & ~tuck].max()), 1)},
        "hemBackNonTuckMm": {"p50": round(float(np.median(hem[back_mask & ~tuck])), 1),
                             "p90": round(float(np.percentile(hem[back_mask & ~tuck], 90)), 1),
                             "max": round(float(hem[back_mask & ~tuck].max()), 1)},
    }
    # coloured map: back-view plane (x horizontal, z vertical), colour = moved mm
    bm = back_mask
    bx, bz = roots[bm][:, 0] * 1000.0, roots[bm][:, 2] * 1000.0
    bmv = moved[bm]
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(8, 8))
    sc = ax.scatter(bx, bz, c=np.clip(bmv, 0, 120), cmap="inferno", s=14, vmin=0, vmax=120)
    plt.colorbar(sc, ax=ax, label="max displacement guides-19->21 (mm, clip 120)")
    ax.set_xlabel("root x (mm)  [left<0 | 0>right in world?]")
    ax.set_ylabel("root z (mm)")
    ax.set_title("back-guide displacement (non-tuck+tuck, back region)")
    ax.set_aspect("equal")
    fig.savefig(str(E / "displacement.png"), dpi=90)
    plt.close(fig)
    # top-20 movers: root xyz + moved + hem
    idx = np.nonzero(bm)[0]
    order = idx[np.argsort(moved[idx])[::-1][:20]]
    out["topMovers"] = [{"guide": int(i),
                         "rootMm": [round(float(v), 1) for v in roots[i] * 1000.0],
                         "tuck": bool(tuck[i]),
                         "movedMm": round(float(moved[i]), 1),
                         "hemMm": round(float(hem[i]), 1)} for i in order]
    (E / "miss-diag.json").write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE miss-map-back.png miss-map-profile.png displacement.png miss-diag.json")


if __name__ == "__main__":
    main()

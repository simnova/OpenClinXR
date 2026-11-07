#!/usr/bin/env python3
"""hair-groom8a STEP 1: baseline on groom5 and groom7 (numpy-only, no renders).

Per band (parietal |x| 50-85mm, temple tuck-box, crown z>=1.60m,
back y>vertex):
  - child skull-SDF p50/p90 (mm; samples s>=1 of strands.npz points)
  - hull5 thickness p50/p90 (D_out + sdf at the same samples)
Silhouette per view (front/three_quarter/profile_90/back):
  - miss px (target-minus-ours) and excess px (ours-minus-target)
  - ours = ID alpha>=230 (same threshold as rulers/scorers)
Guides (guides-tucked.npz, 567):
  - turn-gate breaches: max turn per 5mm window > 15 deg (1mm resample)
  - projection magnitudes: from build.json projection stats
Writes E/baseline.json.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch"
           "/target-views/aisha-v3")
MASKF = {"front": "mask-front.png",
         "three_quarter": "mask-three_quarter.png",
         "profile_90": "mask-profile.png",
         "back": "mask-back.png"}
VIEWS = ("front", "three_quarter", "profile_90", "back")
Y_VERTEX_M = 0.0342

SN = {"groom5": Path("/Volumes/files/src/openclinxr/.openclinxr/"
                     "asset-production/hair-groom5/strands.npz"),
      "groom7": ROOT / "tools/openclinxr/evidence/hair-groom7/build"
      / "strands.npz"}
IDDIR = {"groom5": ROOT / "tools/openclinxr/evidence/hair-groom5"
         / "renders-studio",
         "groom7": ROOT / "tools/openclinxr/evidence/hair-groom7"
         / "renders-studio"}
BUILD = {"groom5": ROOT / "tools/openclinxr/evidence/hair-groom5"
         / "build/build.json",
         "groom7": ROOT / "tools/openclinxr/evidence/hair-groom7"
         / "build/build.json"}


def sdf_grid():
    d = np.load(str(ROOT / "tools/openclinxr/evidence/hair-cage1"
                    "/body-exact-sdf.npz"), allow_pickle=True)
    return (np.asarray(d["sdf"], dtype=np.float64),
            np.asarray(d["origin"], dtype=np.float64),
            float(np.asarray(d["spacing"]).ravel()[0]))


def sample_trilinear(vol, origin, spacing, pts_m):
    pts_mm = np.asarray(pts_m, dtype=np.float64) * 1000.0
    g = (pts_mm - origin) / spacing
    nx, ny, nz = vol.shape
    out = np.full(len(pts_mm), np.nan)
    inside = ((g[:, 0] >= 0) & (g[:, 0] <= nx - 1)
              & (g[:, 1] >= 0) & (g[:, 1] <= ny - 1)
              & (g[:, 2] >= 0) & (g[:, 2] <= nz - 1))
    if not inside.any():
        return out
    gi = g[inside]
    i0 = np.floor(gi).astype(int)
    i0[:, 0] = np.clip(i0[:, 0], 0, nx - 2)
    i0[:, 1] = np.clip(i0[:, 1], 0, ny - 2)
    i0[:, 2] = np.clip(i0[:, 2], 0, nz - 2)
    f = gi - i0
    i1 = i0 + 1
    c000 = vol[i0[:, 0], i0[:, 1], i0[:, 2]]
    c100 = vol[i1[:, 0], i0[:, 1], i0[:, 2]]
    c010 = vol[i0[:, 0], i1[:, 1], i0[:, 2]]
    c110 = vol[i1[:, 0], i1[:, 1], i0[:, 2]]
    c001 = vol[i0[:, 0], i0[:, 1], i1[:, 2]]
    c101 = vol[i1[:, 0], i0[:, 1], i1[:, 2]]
    c011 = vol[i0[:, 0], i1[:, 1], i1[:, 2]]
    c111 = vol[i1[:, 0], i1[:, 1], i1[:, 2]]
    fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
    out[inside] = (
        c000 * (1 - fx) * (1 - fy) * (1 - fz)
        + c100 * fx * (1 - fy) * (1 - fz)
        + c010 * (1 - fx) * fy * (1 - fz)
        + c110 * fx * fy * (1 - fz)
        + c001 * (1 - fx) * (1 - fy) * fz
        + c101 * fx * (1 - fy) * fz
        + c011 * (1 - fx) * fy * fz
        + c111 * fx * fy * fz)
    return out


def main():
    t0 = time.time()
    sdf, sorigin, sspacing = sdf_grid()
    h = np.load(str(ROOT / "tools/openclinxr/evidence/hair-hull5"
                    "/hull.npz"), allow_pickle=True)
    occ = np.asarray(h["occupancy"], dtype=bool)
    xs = np.asarray(h["xs"])
    hspacing = float(np.asarray(h["spacing"]).ravel()[0])
    horigin = np.array([xs[0], np.asarray(h["ys"])[0],
                        np.asarray(h["zs"])[0]])
    d_out = ndimage.distance_transform_edt(~occ).astype(
        np.float64) * hspacing

    out = {"bands": ("parietal |x| 50-85mm; temple tuck-box "
                     "(|x| 45-85mm, y -135..-40mm); crown z>=1.60m; "
                     "back y>34.2mm"),
           "grooms": {}}
    for tag in ("groom5", "groom7"):
        d = np.load(str(SN[tag]), allow_pickle=True)
        pts = np.asarray(d["points"], dtype=np.float64)  # (C,P,3) metres
        C, P, _ = pts.shape
        seg = np.linalg.norm(np.diff(pts, axis=1), axis=2)
        arc = np.concatenate(
            [np.zeros((C, 1)), np.cumsum(seg, axis=1)], axis=1)
        s1 = pts[:, 1:, :].reshape(-1, 3)
        a1 = arc[:, 1:].reshape(-1)
        # shell window: arc 10-80 mm from the root (the hull-depth
        # zone; root-hugging samples and far fringe excluded). stride
        # for speed.
        shell = (a1 >= 0.010) & (a1 <= 0.080)
        s1 = s1[::4]
        shell = shell[::4]
        sv = sample_trilinear(sdf, sorigin, sspacing, s1)
        th = sample_trilinear(d_out, horigin, hspacing, s1) \
            + np.where(np.isfinite(sv), np.maximum(sv, 0.0), 0.0)
        xm = np.abs(s1[:, 0]) * 1000.0
        bands = {
            "parietal": (xm >= 50.0) & (xm < 85.0),
            "temple": (xm >= 45.0) & (xm < 85.0)
            & (s1[:, 1] >= -0.135) & (s1[:, 1] < -0.040),
            "crown": s1[:, 2] >= 1.60,
            "back": s1[:, 1] > Y_VERTEX_M,
        }
        g = {"children": int(C), "sdf": {}, "thickness": {},
             "shellNote": "sdf/thickness on arc 10-80mm shell samples"}
        for bn, m in bands.items():
            m = m & shell
            v = sv[m]
            v = v[np.isfinite(v)]
            t = th[m]
            t = t[np.isfinite(t)]
            g["sdf"][bn] = {"n": int(v.size),
                            "p50": round(float(np.percentile(v, 50)), 2),
                            "p90": round(float(np.percentile(v, 90)), 2)}
            g["thickness"][bn] = {
                "n": int(t.size),
                "p50": round(float(np.percentile(t, 50)), 2),
                "p90": round(float(np.percentile(t, 90)), 2)}
        # silhouette miss/excess px per view
        g["silhouette"] = {}
        for v in VIEWS:
            tgt = np.array(Image.open(str(SCR / MASKF[v]))) > 127
            ida = Image.open(str(IDDIR[tag] / (v + "-id.png")))
            ours = np.array(ida)[:, :, 3] >= 230 \
                if np.array(ida).shape[2] == 4 \
                else np.array(ida) > 127
            miss = int((tgt & ~ours).sum())
            excess = int((ours & ~tgt).sum())
            inter = int((tgt & ours).sum())
            union = int((tgt | ours).sum())
            g["silhouette"][v] = {"missPx": miss, "excessPx": excess,
                                  "iou": round(inter / union, 4)}
        b = json.loads(BUILD[tag].read_text())["projection"]
        g["projection"] = {"nPushed": b["nPushed"],
                           "maxPushMm": b["maxPushMm"]}
        out["grooms"][tag] = g
        print("BASE %s children=%d done" % (tag, C), flush=True)

    # guide turn-gate breaches on guides-tucked (567 guides, 41-pt)
    gd = np.load(str(ROOT / "tools/openclinxr/evidence/hair-groom4"
                     "/tucked/guides-tucked.npz"), allow_pickle=True)
    ch = np.asarray(gd["curves_head"], dtype=np.float64)  # head-mm
    tuck = np.asarray(gd["tuck"], dtype=np.float64) > 0.5
    # head->world via crown to get mm scale right (translation only
    # matters for differences; rotation? crown is translation+z-rot?
    # use raw head-mm diffs: turns are rotation-invariant)
    breach = 0
    worst = []
    for j in range(ch.shape[0]):
        c = ch[j]
        seg = np.diff(c, axis=0)
        L = np.concatenate([[0.0], np.cumsum(
            np.linalg.norm(seg, axis=1))])
        # 1mm resample
        n = int(L[-1])
        if n < 6:
            continue
        tq = np.linspace(0, L[-1], n + 1)
        r = np.stack([np.interp(tq, L, c[:, k]) for k in range(3)],
                     axis=1)
        d = np.diff(r, axis=0)
        dn = np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
        u = d / dn
        # 5mm windows: angle between u[i] and u[i+5]
        dots = (u[:-5] * u[5:]).sum(axis=1).clip(-1, 1)
        ang = np.degrees(np.arccos(dots))
        mx = float(ang.max()) if ang.size else 0.0
        worst.append(mx)
        if mx > 15.0:
            breach += 1
    worst = np.array(worst)
    out["guides"] = {"n": int(ch.shape[0]),
                     "turnGateBreaches15degPer5mm": int(breach),
                     "turnP50": round(float(np.percentile(worst, 50)), 1),
                     "turnP95": round(float(np.percentile(worst, 95)), 1),
                     "turnMax": round(float(worst.max()), 1),
                     "nTucked": int(tuck.sum())}
    out["seconds"] = round(time.time() - t0, 1)
    (E / "baseline.json").write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out, indent=1)[:3000])
    print("wrote E/baseline.json in %.0fs" % (time.time() - t0))


if __name__ == "__main__":
    main()

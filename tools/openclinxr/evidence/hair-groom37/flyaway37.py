#!/usr/bin/env python3
"""groom37 STEP3: flyaways in front of the ear (report only, no fix).

Flyaway = strand with any sample anterior of the ear front plane
(y > pinna yfront), z between lobe bottom and helix top, and > 5 mm
off the skin (body SDF > 5 mm), on the strand's side within the ear
|x| span +/- 30 mm. Counts per side for groom36 and groom37.

Stage attribution: rebuild the BLENDED path
(root + sum w (G(f) - G(0))) from stored guide_idx/guide_w + guides-36
resampled identically (frames.resample_arc, P=32); a flyaway strand
whose blended path already violates the geometric part (anterior +
z-band + |x| box at the same sample indices) was created at BLEND
time, else DOWNSTREAM (servo/projection/keepout/clump/sweeps).
Usage: flyaway37.py STRANDS36 STRANDS37. Writes E/flyaway-37.json.
"""
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
sys.path.insert(0, str(E.parents[2] / "openclinxr" / "hair-groom"
                        / "strands"))
import frames as F  # noqa: E402
from children import sdf_sampler  # noqa: E402

S36 = Path("/Volumes/files/openclinxr-assets/store/hair-groom36")
SDF = Path("tools/openclinxr/evidence/hair-cage1/body-exact-sdf.npz")
PINNA = Path("/Volumes/files/openclinxr-assets/store/hair-groom35/"
             "ear_pinna-mirror35.npz")
P = 32


def geom(pts, s):
    """Geometric part of the flyaway predicate per side -> bool rows."""
    n, Pm, _ = pts.shape
    out = {}
    for nm, sgn in (("xpos", 1.0), ("xneg", -1.0)):
        b = s[sgn]
        m = ((pts[:, :, 1] > b["yfront"])
             & (pts[:, :, 2] >= b["zmin"] - 0.005)
             & (pts[:, :, 2] <= b["zmax"])
             & ((pts[:, :, 0] * sgn) > 0)
             & (np.abs(pts[:, :, 0]) >= b["xmin"] - 0.030)
             & (np.abs(pts[:, :, 0]) <= b["xmax"] + 0.030))
        out[nm] = m
    return out


def analyze(spath, s, sample, guides_w):
    D = np.load(spath, allow_pickle=True)
    pts = np.ascontiguousarray(np.asarray(D["points"], dtype=np.float64))
    n, Pm, _ = pts.shape
    cxyz = np.asarray(D["roots"], dtype=np.float64)
    gidx = np.asarray(D["guide_idx"], dtype=np.int64)
    gw = np.asarray(D["guide_w"], dtype=np.float64)
    gm = geom(pts, s)
    flat = pts.reshape(-1, 3)
    sd, _ = sample(flat)
    sd = sd.reshape(n, Pm)
    rows = {}
    for nm in ("xpos", "xneg"):
        m = gm[nm] & (sd > 5.0)
        rows[nm] = np.nonzero(m.any(axis=1))[0]
    # blended paths for the flyaway rows only
    stage = {}
    for nm in ("xpos", "xneg"):
        r = rows[nm]
        if not len(r):
            stage[nm] = {"n": 0, "blend": 0, "downstream": 0,
                         "topGuides": []}
            continue
        G = guides_w[gidx[r]]                      # (R,4,P,3)
        bl = cxyz[r, None, :] + (
            (G - G[:, :, 0:1, :]) * gw[r][:, :, None, None]).sum(
                axis=1)
        gb = geom(bl, s)
        is_blend = gb[nm].any(axis=1)
        import collections as _c
        dom = gidx[r, gw[r].argmax(axis=1)]
        stage[nm] = {"n": int(len(r)),
                     "nSamples": int((gm[nm] & (sd > 5.0)).sum()),
                     "blend": int(is_blend.sum()),
                     "downstream": int((~is_blend).sum()),
                     "topGuides": [
                         {"guide": int(gg), "n": int(nn)}
                         for gg, nn in _c.Counter(
                             dom.tolist()).most_common(6)]}
    return stage


def main():
    s36, s37 = sys.argv[1], sys.argv[2]
    pdoc = np.load(str(PINNA), allow_pickle=True)
    s = {}
    for key, sgn in (("idx_earXpos", 1.0), ("idx_earXneg", -1.0)):
        pv = np.asarray(pdoc["xyz"], dtype=np.float64)[
            np.asarray(pdoc[key])]
        s[sgn] = {"zmin": float(pv[:, 2].min()),
                  "zmax": float(pv[:, 2].max()),
                  "yfront": float(pv[:, 1].max()),
                  "xmin": float(np.abs(pv[:, 0]).min()),
                  "xmax": float(np.abs(pv[:, 0]).max())}
    sample, _ = sdf_sampler(np.load(str(SDF), allow_pickle=True))
    gdoc = np.load(str(S36 / "guides-36.npz"), allow_pickle=True)
    crown = np.asarray(gdoc["crown"], dtype=np.float64)
    gw = F.head_to_world(np.asarray(gdoc["curves_head"],
                                    dtype=np.float64), crown)
    guides_w = np.stack([F.resample_arc(gw[g], P)
                         for g in range(gw.shape[0])])
    out = {"def": "y>yfront, zmin-5mm<=z<=zmax, |x| in ear span+-30mm, "
                  "SDF>5mm",
           "boundsM": {str(k): v for k, v in s.items()},
           "groom36": analyze(s36, s, sample, guides_w),
           "groom37": analyze(s37, s, sample, guides_w)}
    for tag in ("groom36", "groom37"):
        for nm in ("xpos", "xneg"):
            st = out[tag][nm]
            print("%s %s n=%d blend=%d downstream=%d top=%s" % (
                tag, nm, st["n"], st["blend"], st["downstream"],
                st["topGuides"][:3]), flush=True)
    (E / "flyaway-37.json").write_text(
        json.dumps(out, indent=1) + "\n")
    print("WROTE E/flyaway-37.json")


if __name__ == "__main__":
    main()

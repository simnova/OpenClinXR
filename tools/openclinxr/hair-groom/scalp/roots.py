"""STEP 4 (pure python): deterministic Poisson-disc roots + R2' ruler + plants.

CORRECTION 1: R2' is measured along the TARGET frontal arc only (forehead
kept + TARGET-interp bridge); temples are PRIOR and carry no R2'.

Density map (stated): w = w_line * w_part, w_line(d) = smoothstep(0,3mm,d)
with d = 3D distance to the full hairline loop (full density TO the hairline,
3mm ramp, no setback zone), w_part(x) = 1 - 0.70*exp(-(x/3.3mm)^2) (centre
valley, FWHM 1.665*3.3 = 5.5mm ~ the target part width 11px x 0.469mm/px).
Two mechanisms, zone-separated (stated): the hairline ramp is acceptance-only
at fixed spacing (saturation fill-in puts roots right to the line, which R2'
needs); the part valley is enforced by VARIABLE EXCLUSION RADII
r(p) = r0/sqrt(max(w_part,0.05)) (acceptance coins cannot hold a valley under
saturation: measured depth 0.32 at coin 0.08). Density then scales with w_part
by packing geometry. Sampler: area-weighted triangle proposals
(area-corrected: uniform per unit 3D area), uniform barycentric, coin = w_line
only, exact 3D spacing check dist >= (r_c+r_e)/2 via hash grid.

Ruler R2' (hairline-based): TARGET forehead samples (0.5mm) -> nearest root
3D (cKDTree); p50/p95/max; gates p95 <= 2mm, max <= 4mm.
Plants: (a) drop roots within 10mm of the TARGET hairline -> R2' p50 must read
10 +/- 1mm; (b) restore -> p50 < 2mm (+ full gates).
Part: root density across the part (crown band z > 1.60, |x| bins) vs the
5.16mm target valley width.

Reads: manifest (seed), E/scalp.npz, E/hairline.json. Writes: E/roots.npz,
E/rulers.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

S2 = Path(__file__).resolve().parent
sys.path.insert(0, str(S2))
import common as C

E = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-light2/tools/openclinxr/evidence/hair-scalp1")
R_SPACING = 0.0016
PART_MM = 11 * 0.4693797782693485
EAR_BOX = dict(x=0.058, y0=-0.066, y1=-0.020, z0=1.5035, z1=1.562)


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def seg_dist(m, a, b):
    ab = b - a
    t = np.clip(((m[:, None, :] - a[None, :, :]) * ab[None, :, :]).sum(axis=2) /
                ((ab * ab).sum(axis=1)[None, :] + 1e-18), 0, 1)
    p = a[None, :, :] + ab[None, :, :] * t[:, :, None]
    return np.linalg.norm(m[:, None, :] - p, axis=2).min(axis=1)


def main():
    doc, _ = C.load_manifest()
    seed = int(doc["seed"])
    z = np.load(E / "scalp.npz")
    V, T, UV = z["verts"], z["tris"].astype(np.int64), z["uv"]
    hl = json.loads((E / "hairline.json").read_text())
    gu, gv = z["graphU"], z["graphV"]

    def graph_inside(quv):
        quv = np.asarray(quv, dtype=np.float64)
        uq = ((quv[..., 0] - gu[0]) % (2.0 * np.pi)) + gu[0]
        return quv[..., 1] > np.interp(uq, gu, gv)

    raw = np.array(hl["loop"]["points"])
    fore = np.array(hl["segments"]["forehead"]["points"])

    # distance fields (chunked): dLoop (density ramp) and dTarget (R2'/plants)
    P0, P1, P2 = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    tri_c = (P0 + P1 + P2) / 3.0
    # per-face loop distances at centroids (density uses face-level ramp)
    d_loop_f = np.full(len(T), 1e9)
    d_tgt_f = np.full(len(T), 1e9)
    LA, LB = raw[:-1], raw[1:]
    FA = fore[:-1]
    FB = fore[1:]
    for s in range(0, len(T), 2000):
        m = tri_c[s:s + 2000]
        best, bt = np.full(len(m), 1e9), np.full(len(m), 1e9)
        for k in range(0, len(LA), 200):
            best = np.minimum(best, seg_dist(m, LA[k:k + 200], LB[k:k + 200]))
        for k in range(0, len(FA), 200):
            bt = np.minimum(bt, seg_dist(m, FA[k:k + 200], FB[k:k + 200]))
        d_loop_f[s:s + 2000] = best
        d_tgt_f[s:s + 2000] = bt

    w_part_w = 0.0033  # gaussian sigma; FWHM 1.665*3.3 = 5.5mm ~ target
    w_part_depth = 0.70
    rng = np.random.default_rng(seed * 100003 + 0x7201)
    e1 = P1 - P0
    e2 = P2 - P0
    areas = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    prob = areas / areas.sum()
    # two-tier spacing grid (stated): cell 4mm, tier-1 ring K=1 (coverage 6mm)
    # catches every violation with (r_c+r_e)/2 <= 6mm; with the r_c<=4.5mm tier
    # this is exact (max possible sum/2 = (4.5+7.16)/2 = 5.83 <= 6). Candidates
    # with r_c > 4.5mm (deep valley, rare) use tier-2 ring K=4 (20mm cover).
    cell = 0.004
    grid: dict[tuple[int, int, int], list[int]] = {}
    pts: list[list[float]] = []
    uvs: list[list[float]] = []
    tri_of: list[int] = []
    rad_of: list[float] = []

    def cellof(p):
        return (int(np.floor(p[0] / cell)), int(np.floor(p[1] / cell)), int(np.floor(p[2] / cell)))

    n_prop = 0
    n_reject_dens = 0
    stale = 0
    STALE_CAP = 60000
    MAX_PROP = 6000000
    window_acc = 0
    WINDOW = 200000
    stop_reason = "stale"
    while stale < STALE_CAP and n_prop < MAX_PROP:
        ti = int(rng.choice(len(T), p=prob))
        r1, r2 = rng.random(), rng.random()
        sq1 = np.sqrt(r1)
        b0, b1, b2 = 1 - sq1, sq1 * (1 - r2), sq1 * r2
        p = b0 * P0[ti] + b1 * P1[ti] + b2 * P2[ti]
        n_prop += 1
        # exact clip: graph test on mesh-interp UV + ear box on xyz
        q = b0 * UV[T[ti][0]] + b1 * UV[T[ti][1]] + b2 * UV[T[ti][2]]
        if not graph_inside(q.reshape(1, -1))[0]:
            stale += 1
            continue
        if abs(p[0]) > EAR_BOX["x"] and EAR_BOX["y0"] <= p[1] <= EAR_BOX["y1"] \
                and EAR_BOX["z0"] <= p[2] <= EAR_BOX["z1"]:
            stale += 1
            continue
        dl = d_loop_f[ti]
        if rng.random() > float(smoothstep(dl / 0.003)):
            n_reject_dens += 1
            stale += 1
            continue
        r_c = R_SPACING / float(np.sqrt(max(1.0 - w_part_depth * float(np.exp(-(p[0] / w_part_w) ** 2)), 0.05)))
        cc = cellof(p)
        ok = True
        K = 4 if r_c > 0.0045 else 1
        cand_idx = []
        for dx in range(-K, K + 1):
            for dy in range(-K, K + 1):
                for dz in range(-K, K + 1):
                    cand_idx.extend(grid.get((cc[0] + dx, cc[1] + dy, cc[2] + dz), ()))
        if cand_idx:
            dd = np.linalg.norm(np.array([pts[j] for j in cand_idx]) - p, axis=1)
            rr = np.array([rad_of[j] for j in cand_idx])
            if bool(((dd < (r_c + rr) * 0.5) & (dd > 1e-12)).any()):
                ok = False
        if not ok:
            stale += 1
            continue
        stale = 0
        window_acc += 1
        grid.setdefault(cc, []).append(len(pts))
        pts.append([float(v) for v in p])
        uvs.append([float(v) for v in q])
        tri_of.append(ti)
        rad_of.append(r_c)
        if n_prop % WINDOW == 0:
            if window_acc < 50:
                stop_reason = "window<50/200k@%d" % n_prop
                break
            window_acc = 0
    P_roots = np.array(pts)
    U_roots = np.array(uvs)
    # face normals at roots
    fn = np.cross(e1[tri_of], e2[tri_of])
    fn = fn / (np.linalg.norm(fn, axis=1, keepdims=True) + 1e-18)
    tree = cKDTree(P_roots)
    nn = tree.query(P_roots, k=2)[0][:, 1]
    # TARGET forehead samples at 0.5mm
    tsamp = []
    for i in range(len(fore) - 1):
        a, b = fore[i], fore[i + 1]
        seg = float(np.linalg.norm(b - a))
        nn_seg = max(1, int(round(seg / 0.0005)))
        for k in range(nn_seg):
            tsamp.append(a + (b - a) * (k / nn_seg))
    tsamp = np.array(tsamp)
    d_r2, _ = tree.query(tsamp)
    d_r2_mm = d_r2 * 1000.0
    r2 = {"p50": float(np.median(d_r2_mm)), "p95": float(np.percentile(d_r2_mm, 95)),
          "max": float(d_r2_mm.max()), "n": int(len(d_r2_mm)),
          "pass": bool(float(np.percentile(d_r2_mm, 95)) <= 2.0 and float(d_r2_mm.max()) <= 4.0)}
    # plants
    d_tgt_pts = np.full(len(P_roots), 1e9)
    for s in range(0, len(P_roots), 4000):
        m = P_roots[s:s + 4000]
        best = np.full(len(m), 1e9)
        for k in range(0, len(FA), 200):
            best = np.minimum(best, seg_dist(m, FA[k:k + 200], FB[k:k + 200]))
        d_tgt_pts[s:s + 4000] = best
    keep10 = d_tgt_pts >= 0.010
    tree10 = cKDTree(P_roots[keep10])
    d10, _ = tree10.query(tsamp)
    p50_10 = float(np.median(d10) * 1000.0)
    plant_a = {"p50mm": p50_10, "pass": bool(9.0 <= p50_10 <= 11.0),
               "nDropped": int((~keep10).sum()), "nKept": int(keep10.sum())}
    plant_b = {"p50mm": r2["p50"], "pass": bool(r2["p50"] < 2.0)}
    # part profile: crown band z > 1.60, |x| < 15mm, 1mm bins
    band = (P_roots[:, 2] > 1.60) & (np.abs(P_roots[:, 0]) < 0.015)
    bins = np.arange(-0.015, 0.015001, 0.001)
    hist, _ = np.histogram(P_roots[band][:, 0], bins=bins)
    mx = float(hist.max())
    dip = 1.0 - hist / max(mx, 1)
    half = np.where(dip >= (dip.max() / 2.0))[0]
    fwhm = float((half.max() - half.min() + 1)) if len(half) else 0.0  # mm
    part = {"targetValleyMm": round(PART_MM, 2),
            "measFwhmMm": round(fwhm, 2),
            "valleyDepth": round(float(dip.max()), 3),
            "nCrownBand": int(band.sum()),
            "pass": bool(abs(fwhm - PART_MM) <= 2.5 and float(dip.max()) >= 0.4)}
    out = {"seed": seed, "spacingMm": R_SPACING * 1000.0,
           "rootCount": int(len(P_roots)),
           "meanSpacingMm": round(float(nn.mean() * 1000.0), 3),
           "nProposals": int(n_prop), "nRejectDensity": int(n_reject_dens),
           "stopReason": stop_reason,
           "partSigmaMm": round(w_part_w, 3),
           "R2": r2, "plantDrop10mm": plant_a, "plantRestore": plant_b,
           "part": part,
           "gatesPass": bool(r2["pass"] and plant_a["pass"] and plant_b["pass"] and part["pass"])}
    np.savez(str(E / "roots.npz"), xyz=P_roots, uv=U_roots, tri=np.array(tri_of, dtype=np.int64),
             normal=fn, spacing=np.float64(R_SPACING), seed=np.int64(seed))
    (E / "rulers.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    C.write_opened(E / "inputs-opened.txt")
    print("ROOTS n=%d meanNN=%.2fmm R2=%s plantA=%s part=%s" % (
        len(P_roots), float(nn.mean() * 1000.0), r2, plant_a["p50mm"], part))


if __name__ == "__main__":
    main()

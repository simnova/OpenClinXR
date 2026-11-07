#!/usr/bin/env python3
"""hair-groom23diag: 3D crossing metric + image-space lock metric (diagnostic only).

Step A: 2D crossing recount (s11 verbatim logic) + 3D filter (<=3 mm
segment-segment 3D distance at the first 2D crossing) + depth-difference
distribution at 2D crossings.
Step B: image-space lock metric in the groom10diag back-knot box
(rows 150-420, cols 512-765, native 1024 back frame): scorer Gabor
orientation (verbatim import) render-vs-target, fraction of hair pixels
with deviation > 25 deg + structure-tensor cross-check + lock maps.
Step C: groom19 guide attribution for deviating pixels via
build/strands.npz guide_idx/guide_w.

Deterministic (no RNG). Reads only; writes only under E (this dir).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
ROOT = E.parents[3]
STRANDS = ROOT / "tools/openclinxr/hair-groom/strands"
sys.path.insert(0, str(STRANDS))
sys.path.insert(0, str(ROOT / "tools/openclinxr/evidence/hair-score"))
import frames as F  # noqa: E402
import orientation as ORI  # noqa: E402 (scorer Gabor machinery, verbatim)

GUIDE_FILES = {
    "guides-8a": ROOT / "tools/openclinxr/evidence/hair-groom8a/build/guides-8a.npz",
    "guides-19": ROOT / "tools/openclinxr/evidence/hair-groom19/build/guides-19.npz",
    "guides-21": ROOT / "tools/openclinxr/evidence/hair-groom21/build/guides-21.npz",
    "guides-21a03": ROOT / "tools/openclinxr/evidence/hair-groom21/guides-21a03.npz",
    "guides-21perm": ROOT / "tools/openclinxr/evidence/hair-groom21/guides-21perm.npz",
    "guides-22": Path("/Volumes/files/openclinxr-assets/store/hair-groom22/guides-22.npz"),
    "guides-22-control": Path("/Volumes/files/openclinxr-assets/store/hair-groom22/guides-22-control.npz"),
}

ARC_LO_M = 0.040
ARC_HI_M = 0.200
Y_EAR = -0.0635
Z_NAPE = 1.51
D3_GATE_MM = 3.0

RENDERS = {
    "8a": ROOT / "tools/openclinxr/evidence/hair-groom8a/renders-studio",
    "8b": ROOT / "tools/openclinxr/evidence/hair-groom8b/renders-studio",
    "12": ROOT / "tools/openclinxr/evidence/hair-groom12/renders-studio-8a",
    "19": ROOT / "tools/openclinxr/evidence/hair-groom19/renders-studio",
}
SCR = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/aisha-v3")
BOX = (150, 420, 512, 765)  # groom10diag back-knot box, native 1024 frame
MARGIN = 8
DEV_GATE_DEG = 25.0


def sha_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for blk in iter(lambda: f.read(1 << 20), b""):
            h.update(blk)
    return h.hexdigest()


def pct(a):
    a = np.asarray(a, dtype=np.float64)
    if not a.size:
        return {"n": 0}
    out = {"n": int(a.size)}
    for p in (10, 25, 50, 75, 90, 99):
        out["p%d" % p] = round(float(np.percentile(a, p)), 3)
    out["min"] = round(float(a.min()), 3)
    out["max"] = round(float(a.max()), 3)
    return out


def orient(ax, ay, bx, by, cx, cy_):
    return (bx - ax) * (cy_ - ay) - (by - ay) * (cx - ax)


def seg_seg_dist(p1, q1, p2, q2):
    """Min distance between segments p1-q1 and p2-q2 (Ericson 5.1.9)."""
    d1 = q1 - p1
    d2 = q2 - p2
    r = p1 - p2
    a = float(d1 @ d1)
    e = float(d2 @ d2)
    f = float(d2 @ r)
    if a <= 1e-18 and e <= 1e-18:
        return float(np.linalg.norm(p1 - p2))
    if a <= 1e-18:
        s = 0.0
        t = np.clip(f / e, 0.0, 1.0)
    else:
        c = float(d1 @ r)
        if e <= 1e-18:
            t = 0.0
            s = np.clip(-c / a, 0.0, 1.0)
        else:
            b = float(d1 @ d2)
            den = a * e - b * b
            s = 0.0 if den <= 1e-18 else np.clip((b * f - c * e) / den, 0.0, 1.0)
            t = (b * s + f) / e
            if t < 0.0:
                t = 0.0
                s = np.clip(-c / a, 0.0, 1.0)
            elif t > 1.0:
                t = 1.0
                s = np.clip((b - c) / a, 0.0, 1.0)
    c1 = p1 + d1 * s
    c2 = p2 + d2 * t
    return float(np.linalg.norm(c1 - c2))


def step_a():
    """2D recount + 3D filter for every guide file."""
    import time
    t0 = time.time()
    out = {}
    for name, path in GUIDE_FILES.items():
        assert path.exists(), str(path)
        d = np.load(path, allow_pickle=True)
        head = np.asarray(d["curves_head"], dtype=np.float64)
        crown = np.asarray(d["crown"], dtype=np.float64)
        n = head.shape[0]
        curves = F.head_to_world(head, crown)  # world metres
        roots = curves[:, 0].copy()
        tuck = (np.asarray(d["tuck"]) > 0.5) if "tuck" in d.files else np.zeros(n, dtype=bool)
        back = (roots[:, 1] < Y_EAR) & (roots[:, 2] > Z_NAPE)
        mask = back & ~tuck
        seg = np.linalg.norm(np.diff(curves, axis=1), axis=2)
        arc = np.concatenate([np.zeros((n, 1)), np.cumsum(seg, axis=1)], axis=1)
        win = (arc >= ARC_LO_M) & (arc <= ARC_HI_M)
        cy = float(crown[1])
        u = np.arctan2(curves[..., 1] - cy, curves[..., 0]) * 0.100
        v = curves[..., 2]
        ok = mask & (win.sum(axis=1) >= 2)
        idx = np.nonzero(ok)[0]
        # window blocks are contiguous (arc monotonic): record base offset
        U = [np.ascontiguousarray(u[i][win[i]]) for i in idx]
        V = [np.ascontiguousarray(v[i][win[i]]) for i in idx]
        base = [int(np.nonzero(win[i])[0][0]) for i in idx]
        PW = [np.ascontiguousarray(curves[i][win[i]]) for i in idx]  # world, window
        S = [(np.stack([UU[:-1], VV[:-1]], axis=1), np.stack([UU[1:], VV[1:]], axis=1))
             for UU, VV in zip(U, V)]
        m = len(idx)
        nPairs = int(m * (m - 1) // 2)
        cross2d = 0
        d3_list = []
        dr_list = []
        dz_list = []
        cross3d = 0
        for i in range(m):
            a0, a1 = S[i]
            for j in range(i + 1, m):
                b0, b1 = S[j]
                if (a0[:, 0].max() < b0[:, 0].min() or b0[:, 0].max() < a0[:, 0].min()
                        or a0[:, 1].max() < b0[:, 1].min()
                        or b0[:, 1].max() < a0[:, 1].min()):
                    continue
                hit = None
                for k in range(len(a0)):
                    d1 = orient(b0[:, 0], b0[:, 1], b1[:, 0], b1[:, 1], a0[k, 0], a0[k, 1])
                    d2 = orient(b0[:, 0], b0[:, 1], b1[:, 0], b1[:, 1], a1[k, 0], a1[k, 1])
                    d3o = orient(a0[k, 0], a0[k, 1], a1[k, 0], a1[k, 1], b0[:, 0], b0[:, 1])
                    d4 = orient(a0[k, 0], a0[k, 1], a1[k, 0], a1[k, 1], b1[:, 0], b1[:, 1])
                    cand = np.nonzero((((d1 > 0) != (d2 > 0)) & ((d3o > 0) != (d4 > 0))
                                       & (d1 != 0) & (d2 != 0) & (d3o != 0) & (d4 != 0)))[0]
                    if len(cand):
                        hit = (k, int(cand[0]))
                        break
                if hit is not None:
                    cross2d += 1
                    k, ell = hit
                    p1 = PW[i][k] * 1000.0
                    q1 = PW[i][k + 1] * 1000.0
                    p2 = PW[j][ell] * 1000.0
                    q2 = PW[j][ell + 1] * 1000.0
                    dd = seg_seg_dist(p1, q1, p2, q2)
                    d3_list.append(dd)
                    mi = (p1 + q1) / 2.0
                    mj = (p2 + q2) / 2.0
                    cymm = float(crown[1]) * 1000.0
                    ri = float(np.hypot(mi[0], mi[1] - cymm))
                    rj = float(np.hypot(mj[0], mj[1] - cymm))
                    dr_list.append(abs(ri - rj))
                    dz_list.append(abs(float(mi[2] - mj[2])))
                    if dd <= D3_GATE_MM:
                        cross3d += 1
        d3a = np.array(d3_list)
        bins = [1, 2, 3, 5, 10, 20, 50, np.inf]
        hist = []
        prev = 0.0
        for bnd in bins:
            c = int(((d3a > prev) & (d3a <= bnd)).sum()) if d3a.size else 0
            hist.append({"lo": prev, "hi": (None if not np.isfinite(bnd) else bnd), "n": c})
            prev = bnd
        out[name] = {
            "file": str(path),
            "sha256": sha_of(path),
            "nGuides": int(n),
            "nBackNonTuck": int(m),
            "nPairs": nPairs,
            "cross2D": int(cross2d),
            "cross3D_le3mm": int(cross3d),
            "frac3Dof2D": round(cross3d / max(cross2d, 1), 4),
            "d3mm_at_2Dcross": pct(d3a),
            "d3_hist_mm": hist,
            "radialSepMM_at_2Dcross": pct(np.array(dr_list)),
            "verticalSepMM_at_2Dcross": pct(np.array(dz_list)),
        }
        print("A %s back=%d pairs=%d cross2D=%d cross3D=%d d3p50=%s"
              % (name, m, nPairs, cross2d, cross3d,
                 out[name]["d3mm_at_2Dcross"].get("p50")), flush=True)
    print("step A done in %.0fs" % (time.time() - t0), flush=True)
    return out


def gray_of(beauty):
    b = np.asarray(beauty, dtype=np.float64)
    if b.max() > 1.0:
        b = b / 255.0
    return 0.2126 * b[..., 0] + 0.7152 * b[..., 1] + 0.0722 * b[..., 2]


def struct_tensor_orientation(gray):
    """Strand-tangent orientation mod 180 via the structure tensor."""
    import cv2
    g = np.asarray(gray, dtype=np.float32)
    dx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    dy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(dx * dx, (0, 0), 1.5)
    jyy = cv2.GaussianBlur(dy * dy, (0, 0), 1.5)
    jxy = cv2.GaussianBlur(dx * dy, (0, 0), 1.5)
    ang = (np.degrees(0.5 * np.arctan2(2.0 * jxy, jxx - jyy)) + 90.0) % 180.0
    trace = jxx + jyy
    aniso = np.sqrt((jxx - jyy) ** 2 + 4.0 * jxy ** 2)
    coh = (aniso / (trace + 1e-9)).astype(np.float64)
    return ang.astype(np.float64), np.clip(coh, 0.0, 1.0)


def _med_field(angle, ksize):
    """Doubled-angle median orientation field (uint8 medianBlur path)."""
    import cv2
    a = np.deg2rad(np.asarray(angle, dtype=np.float64)) * 2.0
    cx = cv2.medianBlur(((np.cos(a) * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8),
                        ksize).astype(np.float64) / 255.0 * 2.0 - 1.0
    sx = cv2.medianBlur(((np.sin(a) * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8),
                        ksize).astype(np.float64) / 255.0 * 2.0 - 1.0
    return (np.degrees(0.5 * np.arctan2(sx, cx)) % 180.0)


def _aniso_darkstats(gbox, H):
    """Gradient-anisotropy ratio + dark-tail component stats over box mask."""
    import cv2 as _cv
    g2 = _cv.GaussianBlur(np.asarray(gbox, dtype=np.float32), (0, 0), 2.0)
    _gx = _cv.Sobel(g2, _cv.CV_32F, 1, 0, ksize=3)
    _gy = _cv.Sobel(g2, _cv.CV_32F, 0, 1, ksize=3)
    aniso = float(np.abs(_gy[H]).mean() / max(np.abs(_gx[H]).mean(), 1e-9)) if H.any() else None
    vals = np.asarray(gbox, dtype=np.float64)[H]
    if vals.size:
        p10 = float(np.percentile(vals, 10))
        dark = np.logical_and(H, np.asarray(gbox, dtype=np.float64) <= p10).astype(np.uint8)
        n, _, st, _ = _cv.connectedComponentsWithStats(dark, 8, _cv.CV_32S)
        ar = st[1:, _cv.CC_STAT_AREA] if n > 1 else np.array([0])
        big = ar[ar >= 500]
    else:
        p10, ar, big = 0.0, np.array([0]), np.array([0])
    return {"gradAniso_gyOvergx": round(aniso, 4) if aniso is not None else None,
            "darkComp_meanAreaPx": round(float(ar.mean()), 2),
            "darkComp_count": int(len(ar)),
            "darkComp_bigFrac": round(float(big.sum() / max(int(H.sum()), 1)), 4),
            "darkComp_p10": round(p10, 4)}


def dispersion_frac(angle, mask, ksize=15, gate=25.0):
    """Render-intrinsic lock signal: fraction of masked pixels whose local
    orientation deviates from the doubled-angle median-filtered field by
    more than gate degrees. Crossing locks are bimodal -> high."""
    med = _med_field(angle, ksize)
    d = np.abs(np.asarray(angle, dtype=np.float64) - med)
    d = np.minimum(d, 180.0 - d)
    sel = d[mask]
    return (round(float((sel > gate).mean()), 4) if sel.size else None,
            round(float(sel.mean()), 3) if sel.size else None)


def cross_scale_stats(angle, mask, small=15, large=65, gate=25.0, min_area=500):
    """Lock-scale signal: small-window flow vs large-window background flow.
    Fine strand texture agrees across scales; coherent lock bands (10-50 px
    patches crossing the background flow) do not. Returns frac>gate of the
    scale-difference map + connected-component stats of (diff>gate)&mask."""
    import cv2 as _cv
    f_small = _med_field(angle, small)
    f_large = _med_field(angle, large)
    d = np.abs(f_small - f_large)
    d = np.minimum(d, 180.0 - d)
    sel = d[mask]
    frac = round(float((sel > gate).mean()), 4) if sel.size else None
    mean = round(float(sel.mean()), 3) if sel.size else None
    cc_n, cc_lab, cc_stat, _ = _cv.connectedComponentsWithStats(
        ((d > gate) & mask).astype(np.uint8), 8, _cv.CV_32S)
    areas = cc_stat[1:, _cv.CC_STAT_AREA] if cc_n > 1 else np.array([0])
    largest = int(areas.max()) if len(areas) else 0
    big = areas[areas >= min_area]
    return {"fracGt25": frac, "mean": mean, "nBig": int(len(big)),
            "bigFrac": round(float(big.sum() / max(mask.sum(), 1)), 4),
            "largestPx": largest}


def reg_transform_back():
    """Judge-v6 similarity render->target for the back view (scorer-exact).

    Render triple from hair-curtain3/landmarks.json == ORI.RENDER_TRIPLES;
    target triple from the judge target-set-back via ORI.target_triples().
    """
    rt = ORI.RENDER_TRIPLES["back"]
    tt = ORI.target_triples()["back"]
    s = (tt[1] - tt[0]) / (rt[1] - rt[0])
    return {"scale": s, "tx": tt[2] - s * rt[2], "ty": tt[0] - s * rt[0],
            "renderTriple": list(rt), "targetTriple": list(tt)}


def map_box_to_target(box, tr):
    """Render-frame box -> target-frame box via the similarity transform."""
    r0, r1, c0, c1 = box
    s = tr["scale"]
    tr0 = int(np.floor(s * r0 + tr["ty"]))
    tr1 = int(np.ceil(s * r1 + tr["ty"]))
    tc0 = int(np.floor(s * c0 + tr["tx"]))
    tc1 = int(np.ceil(s * c1 + tr["tx"]))
    return (max(tr0, 0), min(tr1, 1024), max(tc0, 0), min(tc1, 1024))


def step_b():
    """Image-space lock metric: scorer-registered render vs target.

    Pipeline = the scorer's own (ORI.score_view internals): judge-v6
    similarity render->target, Gabor orientation maps on the box crop
    (+8 px margin ring dropped, kernel radius 7 -> interior exact), angular
    deviation inside registered-render-mask & target-mask. The evaluated
    box is the groom10diag back-knot box mapped render->target.
    Plus a structure-tensor cross-check on the same registered crops.
    """
    from PIL import Image
    import time
    t0 = time.time()
    tr = reg_transform_back()
    t0b, t1b, c0b, c1b = map_box_to_target(BOX, tr)
    cr0, cr1 = t0b - MARGIN, t1b + MARGIN
    cc0, cc1 = c0b - MARGIN, c1b + MARGIN
    tgt = np.array(Image.open(str(SCR / "target-back.png")).convert("RGB"))
    tm = (np.array(Image.open(str(SCR / "mask-back.png")).convert("L")) > 127)
    tg = gray_of(tgt[cr0:cr1, cc0:cc1])
    ta, tc = ORI.orientation_map(tg.astype(np.float64))
    tsa, tscoh = struct_tensor_orientation(tg)
    sl = (slice(MARGIN, -MARGIN), slice(MARGIN, -MARGIN))
    out = {"registration": tr, "targetBox": [t0b, t1b, c0b, c1b]}
    _tH = tm[t0b:t1b, c0b:c1b]
    _tdev_disp, _tdev_mean = dispersion_frac(ta[sl], _tH)
    out["targetIntrinsic"] = {
        "dispersionFracGt25": _tdev_disp,
        "dispersionMean": _tdev_mean,
        "structCohMean": round(float(tscoh[sl][_tH].mean()), 4) if _tH.any() else None,
        "structFracCohLt05": round(float((tscoh[sl][_tH] < 0.5).mean()), 4) if _tH.any() else None,
        "crossScale": cross_scale_stats(ta[sl], _tH),
    }
    out["targetIntrinsic"].update(_aniso_darkstats(
        gray_of(tgt)[t0b:t1b, c0b:c1b], _tH))
    for g, rdir in RENDERS.items():
        rb, rm = ORI.load_beauty_mask(str(rdir / "back.png"), str(rdir / "back-id.png"))
        tb, tm = ORI.load_beauty_mask(str(SCR / "target-back.png"), str(SCR / "mask-back.png"))
        rt = ORI.RENDER_TRIPLES["back"]
        tt = ORI.target_triples()["back"]
        m_o, b_o, transform = ORI.register_view_local(
            rm, rb, rt[0], rt[1], rt[2], tt[0], tt[1], tt[2])
        assert abs(transform["scale"] - tr["scale"]) < 1e-9
        rg = gray_of((np.clip(b_o, 0, 1) * 255 + 0.5).astype(np.uint8)[cr0:cr1, cc0:cc1])
        ra, rc = ORI.orientation_map(rg.astype(np.float64))
        rsa, rscoh = struct_tensor_orientation(rg)
        H = m_o[t0b:t1b, c0b:c1b] & tm[t0b:t1b, c0b:c1b]
        disp_frac, disp_mean = dispersion_frac(ra[sl], H)
        dev = ORI.angular_diff(ra[sl], ta[sl])
        sv = rsa[sl]
        st = tsa[sl]
        sdev = np.abs(sv - st)
        sdev = np.minimum(sdev, 180.0 - sdev)
        hd = dev[H]
        hs = sdev[H]
        import cv2 as _cv
        dev_sm = _cv.blur(dev.astype(np.float32), (15, 15))
        lock_frac = float((dev_sm[H] > 45.0).mean()) if H.any() else 0.0
        cc_n, cc_lab, cc_stat, _ = _cv.connectedComponentsWithStats(
            (((dev > 45.0) & H).astype(np.uint8)), 8, _cv.CV_32S)
        areas = cc_stat[1:, _cv.CC_STAT_AREA] if cc_n > 1 else np.array([0])
        largest = int(areas.max()) if len(areas) else 0
        big = areas[areas >= 500]
        n_big = len(big)
        big_frac = float(big.sum() / max(H.sum(), 1))
        mid = (t1b - t0b) // 2
        Hrow = np.arange(t1b - t0b)[:, None] < mid
        Hu = H & Hrow
        hud = dev[Hu]
        upstairs = {}
        if Hu.any():
            upstairs = {
                "nHairPx": int(Hu.sum()),
                "gabor_fracDevGt25": round(float((hud > 25.0).mean()), 4),
                "gabor_fracDevGt45": round(float((hud > 45.0).mean()), 4),
                "gabor_meanAbsErr": round(float(hud.mean()), 3),
                "lock_coherentDev45": round(float((dev_sm[Hu] > 45.0).mean()), 4),
                "crossScale": cross_scale_stats(ra[sl], Hu),
            }
            # flow scale: sigma-2px blur kills strand-phase, keeps flow direction
            import cv2 as _cv2
            tg2 = _cv2.GaussianBlur(tg.astype(np.float32), (0, 0), 2.0)
            rg2 = _cv2.GaussianBlur(rg.astype(np.float32), (0, 0), 2.0)
            ta2, _ = ORI.orientation_map(tg2.astype(np.float64))
            ra2, _ = ORI.orientation_map(rg2.astype(np.float64))
            dev2 = ORI.angular_diff(ra2[sl], ta2[sl])
            hud2 = dev2[Hu]
            dev2_sm = _cv2.blur(dev2.astype(np.float32), (15, 15))
            cc2_n, _, cc2_stat, _ = _cv2.connectedComponentsWithStats(
                ((dev2 > 45.0) & Hu).astype(np.uint8), 8, _cv2.CV_32S)
            a2 = cc2_stat[1:, _cv2.CC_STAT_AREA] if cc2_n > 1 else np.array([0])
            big2 = a2[a2 >= 500]
            upstairs["flow"] = {
                "gabor_fracDevGt25": round(float((hud2 > 25.0).mean()), 4),
                "gabor_fracDevGt45": round(float((hud2 > 45.0).mean()), 4),
                "gabor_meanAbsErr": round(float(hud2.mean()), 3),
                "lock_coherentDev45": round(float((dev2_sm[Hu] > 45.0).mean()), 4),
                "lock_bigCompFrac": round(float(big2.sum() / max(Hu.sum(), 1)), 4),
                "lock_nBigComp": int(len(big2)),
                "lock_largestCompPx": int(a2.max()) if len(a2) else 0,
            }
            Hcrop = np.zeros_like(ra[sl], dtype=bool)
            Hcrop[Hu] = True
            Hucrop = np.zeros_like(ra, dtype=bool)
            Hucrop[sl][Hu] = True
            h_r = ORI.orientation_histogram(ra, rc, Hucrop)
            h_t = ORI.orientation_histogram(ta, tc, Hucrop)
            upstairs["histEMD_vsTarget"] = round(ORI.hist_emd(h_r, h_t), 3)
            upstairs["histPeakBin_render"] = int(h_r.argmax())
            upstairs["histPeakBin_target"] = int(h_t.argmax())
            upstairs["histPeakMass_render"] = round(float(h_r.max()), 4)
            upstairs["histPeakMass_target"] = round(float(h_t.max()), 4)
        w = (rc[sl][H].astype(np.float64) * tc[sl][H].astype(np.float64))
        cmp_full = {
            "meanAbsErrDeg": round(float((hd * w).sum() / max(w.sum(), 1e-9)), 3) if hd.size else None,
        }
        out[g] = {
            "render": str(rdir / "back.png"),
            "sha256": sha_of(rdir / "back.png"),
            "transform": {k: round(float(v), 4) for k, v in transform.items()},
            "nHairPx": int(H.sum()),
            "gabor_fracDevGt25": round(float((hd > DEV_GATE_DEG).mean()), 4) if hd.size else None,
            "gabor_meanAbsErr": round(float(hd.mean()), 3) if hd.size else None,
            "gabor_confWtMeanAbsErr": cmp_full["meanAbsErrDeg"],
            "struct_fracDevGt25": round(float((hs > DEV_GATE_DEG).mean()), 4) if hs.size else None,
            "struct_meanAbsErr": round(float(hs.mean()), 3) if hs.size else None,
            "gabor_fracDevGt45": round(float((hd > 45.0).mean()), 4) if hd.size else None,
            "gabor_fracDevGt60": round(float((hd > 60.0).mean()), 4) if hd.size else None,
            "gabor_devP90": round(float(np.percentile(hd, 90)), 3) if hd.size else None,
            "intrinsic_dispersionFracGt25": disp_frac,
            "intrinsic_dispersionMean": disp_mean,
            "struct_cohMean": round(float(rscoh[sl][H].mean()), 4) if H.any() else None,
            "struct_fracCohLt05": round(float((rscoh[sl][H] < 0.5).mean()), 4) if H.any() else None,
            "lock_coherentDev45": round(float(lock_frac), 4),
            "lock_bigCompFrac": round(float(big_frac), 4),
            "lock_nBigComp": int(n_big),
            "lock_largestCompPx": int(largest),
            "crossScale": cross_scale_stats(ra[sl], H),
            "upperHalf": upstairs,
        }
        out[g].update(_aniso_darkstats(
            (0.2126 * np.clip(b_o, 0, 1)[..., 0]
             + 0.7152 * np.clip(b_o, 0, 1)[..., 1]
             + 0.0722 * np.clip(b_o, 0, 1)[..., 2])[t0b:t1b, c0b:c1b], H))
        # lock map (target frame): target | registered render | dev heat
        panel_t = tgt[t0b:t1b, c0b:c1b]
        panel_r = (np.clip(b_o[t0b:t1b, c0b:c1b], 0, 1) * 255).astype(np.uint8)
        heat = np.zeros((t1b - t0b, c1b - c0b, 3), dtype=np.uint8)
        dn = np.clip(dev / 90.0, 0, 1)
        heat[..., 0] = (np.clip(dn, 0, 1) * 255).astype(np.uint8)
        heat[..., 1] = (np.clip(1.0 - np.abs(dn - 0.5) * 2.0, 0, 1) * 60).astype(np.uint8)
        heat[..., 2] = ((1.0 - np.clip(dn, 0, 1)) * 255).astype(np.uint8)
        heat[~H] = (panel_r[~H] * 0.35).astype(np.uint8)
        edge = np.zeros_like(H)
        edge[1:, :] |= (H[1:, :] != H[:-1, :])
        edge[:, 1:] |= (H[:, 1:] != H[:, :-1])
        heat[edge] = (255, 255, 255)
        fig = np.zeros((t1b - t0b, (c1b - c0b) * 3 + 16, 3), dtype=np.uint8)
        W = c1b - c0b
        fig[:, :W] = panel_t
        fig[:, W + 8:2 * W + 8] = panel_r
        fig[:, 2 * W + 16:] = heat
        Image.fromarray(fig).save(str(E / ("lock-map-%s.png" % g)))
        print("B %s hairPx=%d gaborFrac25=%.4f structFrac25=%.4f"
              % (g, out[g]["nHairPx"], out[g]["gabor_fracDevGt25"],
                 out[g]["struct_fracDevGt25"]), flush=True)
    print("step B done in %.0fs" % (time.time() - t0), flush=True)
    return out


def project(points, camera):
    inv = np.linalg.inv(np.asarray(camera["matrixWorld"], dtype=np.float64))
    f = float(camera["lensMm"]) / 36.0 * 1024.0
    flat = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    h = np.ones((len(flat), 4), dtype=np.float64)
    h[:, :3] = flat
    lc = (inv @ h.T).T
    dep = -lc[:, 2]
    col = np.full(len(flat), -1.0)
    row = np.full(len(flat), -1.0)
    ok = dep > 0
    col[ok] = 512.0 + lc[ok, 0] / dep[ok] * f
    row[ok] = 512.0 - lc[ok, 1] / dep[ok] * f
    return col, row, dep


def step_c(dev_proxy):
    """Attribute groom19 deviating box pixels to guides via child assignment."""
    import json
    import time
    t0 = time.time()
    from PIL import Image
    r0, r1, c0, c1 = BOX
    cams = json.loads((ROOT / "tools/openclinxr/hair-groom/manifests/cameras-scorer-v3.json").read_text())
    cam = cams["views"]["back"]
    sd = np.load(ROOT / "tools/openclinxr/evidence/hair-groom19/build/strands.npz", allow_pickle=True)
    pts = np.asarray(sd["points"], dtype=np.float64)  # metres, world
    gi = np.asarray(sd["guide_idx"], dtype=np.int64)
    gw = np.asarray(sd["guide_w"], dtype=np.float64)
    nch, P = pts.shape[0], pts.shape[1]
    # project in chunks; keep samples landing in the box
    Hbox, Wbox = r1 - r0, c1 - c0
    zbuf = np.full(Hbox * Wbox, np.inf, dtype=np.float64)
    cols = np.full((nch, P), -1, dtype=np.int64)
    rows = np.full((nch, P), -1, dtype=np.int64)
    deps = np.full((nch, P), np.inf, dtype=np.float64)
    CH = 20000
    for s in range(0, nch, CH):
        e = min(nch, s + CH)
        c, r, dp = project(pts[s:e].reshape(-1, 3), cam)
        c = c.reshape(e - s, P)
        r = r.reshape(e - s, P)
        dp = dp.reshape(e - s, P)
        ok = (c >= c0) & (c < c1) & (r >= r0) & (r < r1) & (dp > 0)
        cc = np.clip(c.astype(np.int64), c0, c1 - 1) - c0
        rr = np.clip(r.astype(np.int64), r0, r1 - 1) - r0
        cols[s:e][ok] = cc[ok]
        rows[s:e][ok] = rr[ok]
        deps[s:e][ok] = dp[ok]
        vo = ok
        if vo.any():
            pix = (rr[vo] * Wbox + cc[vo])
            np.minimum.at(zbuf, pix, dp[vo])
    vis = np.zeros((nch, P), dtype=bool)
    inbox = cols >= 0
    rr2 = rows[inbox]
    cc2 = cols[inbox]
    vis[inbox] = deps[inbox] <= zbuf[rr2 * Wbox + cc2] + 0.005
    # deviating-pixel set in the TARGET frame (registered dev map, as step B)
    tr = reg_transform_back()
    t0b, t1b, c0b, c1b = map_box_to_target(BOX, tr)
    tb, tm = ORI.load_beauty_mask(str(SCR / "target-back.png"), str(SCR / "mask-back.png"))
    rb19, rm19 = ORI.load_beauty_mask(str(RENDERS["19"] / "back.png"),
                                      str(RENDERS["19"] / "back-id.png"))
    rt = ORI.RENDER_TRIPLES["back"]
    tt = ORI.target_triples()["back"]
    m_o, b_o, _ = ORI.register_view_local(rm19, rb19, rt[0], rt[1], rt[2], tt[0], tt[1], tt[2])
    tg = gray_of(tb[t0b - MARGIN:t1b + MARGIN, c0b - MARGIN:c1b + MARGIN]).astype(np.float64)
    rg = gray_of((np.clip(b_o, 0, 1) * 255 + 0.5).astype(np.uint8)
                 [t0b - MARGIN:t1b + MARGIN, c0b - MARGIN:c1b + MARGIN])
    ra, _ = ORI.orientation_map(rg)
    ta, _ = ORI.orientation_map(tg)
    sl = (slice(MARGIN, -MARGIN), slice(MARGIN, -MARGIN))
    dev = ORI.angular_diff(ra[sl], ta[sl])
    H = m_o[t0b:t1b, c0b:c1b] & tm[t0b:t1b, c0b:c1b]
    D = H & (dev > DEV_GATE_DEG)
    Ht, Wt = D.shape
    sc, tx, ty = tr["scale"], tr["tx"], tr["ty"]
    # visible in-box samples (render-frame box coords) -> target frame -> D
    touch = np.zeros(nch, dtype=bool)
    visbox = vis & inbox
    cov_rows = []
    cov_cols = []
    for s in range(0, nch, CH):
        e = min(nch, s + CH)
        vb = visbox[s:e]
        ii, jj = np.nonzero(vb)
        hit = np.zeros(e - s, dtype=bool)
        if len(ii):
            rr_t = np.round(sc * (rows[s:e][ii, jj] + r0) + ty).astype(np.int64) - t0b
            cc_t = np.round(sc * (cols[s:e][ii, jj] + c0) + tx).astype(np.int64) - c0b
            inside = (rr_t >= 0) & (rr_t < Ht) & (cc_t >= 0) & (cc_t < Wt)
            hh = np.zeros(len(ii), dtype=bool)
            hh[inside] = D[rr_t[inside], cc_t[inside]]
            np.logical_or.at(hit, ii[hh], True)
            cov_rows.append(rr_t[inside][hh[inside]])
            cov_cols.append(cc_t[inside][hh[inside]])
        touch[s:e] = hit
    contrib = np.nonzero(touch)[0]
    score = np.zeros(2707, dtype=np.float64)
    np.add.at(score, gi[contrib].ravel(), np.tile(gw[contrib], (1, 1)).ravel())
    order = np.argsort(-score)
    top = [(int(g), round(float(score[g]), 3)) for g in order[:20] if score[g] > 0]
    # pixel coverage: dev pixels touched by any contributing child
    pixcov = np.zeros((Ht, Wt), dtype=bool)
    if cov_rows:
        pixcov[np.concatenate(cov_rows), np.concatenate(cov_cols)] = True
    cov = float((pixcov[D]).sum() / max(D.sum(), 1))
    print("step C done in %.0fs: %d contributing children, top=%s"
          % (time.time() - t0, int(touch.sum()), top[:5]), flush=True)
    return {
        "nChildren": int(nch),
        "nDevPx": int(D.sum()),
        "nContribChildren": int(touch.sum()),
        "devPxTouchedByContrib": round(cov, 4),
        "topGuidesByWeight": [{"guide": g, "weight": w} for g, w in top],
        "note": "no occlusion beyond per-pixel hair z-buffer (32 samples/child, no oversampling); "
                "front-layer strands projecting into the box count as contributors",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", required=True, choices=["a", "b", "c"])
    ap.add_argument("--infile", default="")
    args = ap.parse_args()
    if args.step == "a":
        out = {"crossing3D": step_a()}
    elif args.step == "b":
        out = {"imageLock": step_b()}
    else:
        prev = json.loads(Path(args.infile).read_text()) if args.infile else {}
        out = dict(prev)
        out["guideAttribution19"] = step_c(None)
    (E / ("metrics-step-%s.json" % args.step)).write_text(json.dumps(out, indent=1) + "\n")
    print("WROTE metrics-step-%s.json" % args.step, flush=True)


if __name__ == "__main__":
    main()

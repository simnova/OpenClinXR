#!/usr/bin/env python3
"""Eye/brow detail metrics (aisha-parity P4, cap42 R2): corner darkness, sclera tone/bars, brow albedo/coverage.

Layout mirrors compare.py: ref dir holds beauty/<cam>.png + masks/<cam>.png
(the nohair mask PNGs), cand dir holds <cam>.png. Both sides are measured
through the REF mask (same registration contract as compare.py).

corner_dark (replaces the withdrawn canthus ring, cap42 R2): INSIDE the eye
mask only, per eye (eye mask split at its x centroid), inner and outer
horizontal end zones (each = the outer 20% of that eye's mask width; the
pupil sits in the middle 60% and is excluded). Fraction of zone pixels with
CIE L* < 15. The old ring sampled OUTSIDE the mask where the voids are.

sclera_bars (replaces the withdrawn streak, cap42 R2): per eye, sclera pixels
(eye mask, chroma C* < 12, the same C* cut sclera_L uses), column-mean L*
profile; bars = positive residual after subtracting a RUNNING MEDIAN of that
profile (window = half that eye's sclera column span -- a geometric
derivation, never a width read off the f0 bars). A broad lift or gradient
is tracked by the median (residual ~0); a narrow white bar is not.

CLI: eye_detail.py --ref <refdir> --cand <canddir> --out <json> --tsv <tsv>
  [--cams a,b] [--cand-label name] [--floor noise-floor.json]
Exit 2 (refusal) on missing file.
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare import COLORS, lab_of, load_rgb, region_masks  # noqa: E402

CORNER_L_MAX = 15
CORNER_ZONE_FRAC = 0.20
SCLERA_C_MAX = 12
BROW_ROW_GAP_PX = 3
SKIN_BAND_PX = 10
BROW_DARK_DROP = 15


def _sides(xs: np.ndarray, cx: float):
    return (("L", xs < cx), ("R", xs >= cx))


def corner_dark(L: np.ndarray, eye: np.ndarray) -> dict:
    """Per eye (split at the eye-mask x centroid), per end zone (inner/outer),
    fraction of INSIDE-mask pixels with L* < CORNER_L_MAX. Each zone is the
    outer CORNER_ZONE_FRAC of that eye's mask width."""
    h, w = eye.shape
    ys, xs = np.mgrid[0:h, 0:w]
    out = {}
    if not eye.any():
        for side, _ in _sides(xs, w / 2.0):
            out[side] = {z: {"count": 0, "fraction": 0.0, "band": 0} for z in ("inner", "outer")}
        return out
    cx = float(xs[eye].mean())
    for side, sel in _sides(xs, cx):
        side_eye = eye & sel
        cols = np.unique(xs[side_eye])
        zones: dict = {}
        if cols.size >= 5:
            k = max(1, int(round(CORNER_ZONE_FRAC * cols.size)))
            # Inner = toward the face centre (cx); outer = toward the temple.
            inner_cols = cols[-k:] if side == "L" else cols[:k]
            outer_cols = cols[:k] if side == "L" else cols[-k:]
            for zname, zcols in (("inner", inner_cols), ("outer", outer_cols)):
                zlo, zhi = int(zcols.min()), int(zcols.max())
                band = side_eye & (xs >= zlo) & (xs <= zhi)
                n = int(band.sum())
                dark = int((band & (L < CORNER_L_MAX)).sum())
                zones[zname] = {"count": dark, "fraction": (dark / n) if n else 0.0, "band": n}
        else:
            zones = {z: {"count": 0, "fraction": 0.0, "band": 0} for z in ("inner", "outer")}
        out[side] = zones
    return out


def sclera_bars(L: np.ndarray, C: np.ndarray, eye: np.ndarray) -> dict:
    """Per eye: column-mean L* profile over sclera pixels, running-median
    detrend (window = half that eye's sclera column span), positive residual.
    Reports the max residual and the full residual vector (counts above the
    noise floor are applied at report time, where the floor is known)."""
    from scipy.ndimage import median_filter

    h, w = eye.shape
    ys, xs = np.mgrid[0:h, 0:w]
    out = {}
    if not eye.any():
        for side, _ in _sides(xs, w / 2.0):
            out[side] = {"max_resid": 0.0, "span": 0, "window": 0, "resid": []}
        return out
    cx = float(xs[eye].mean())
    for side, sel in _sides(xs, cx):
        scl = eye & sel & (C < SCLERA_C_MAX)
        cols = np.unique(xs[scl])
        span = int(cols.size)
        if span < 3:
            out[side] = {"max_resid": 0.0, "span": span, "window": 0, "resid": []}
            continue
        prof = np.array([float(L[scl & (xs == x)].mean()) for x in cols])
        window = max(3, span // 2)
        med = median_filter(prof, size=window, mode="reflect")
        resid = np.maximum(prof - med, 0.0)
        out[side] = {
            "max_resid": float(resid.max()),
            "span": span,
            "window": int(window),
            "resid": [float(v) for v in resid],
        }
    return out


def analyze(img_u8: np.ndarray, mask_u8: np.ndarray) -> dict:
    """Detail metrics for one image through its mask. Pure numpy (no I/O)."""
    masks = region_masks(mask_u8)
    lab = lab_of(img_u8)
    L = lab[..., 0]
    C = np.hypot(lab[..., 1], lab[..., 2])
    eye = masks["eyes"]
    hair = masks["hair"]
    skin = masks["skin"]
    h, w = eye.shape
    ys, xs = np.mgrid[0:h, 0:w]

    # (a) corner darkness: inside the eye mask only (cap42 R2).
    corner = corner_dark(L, eye)

    # (b) sclera tone: mean L* of low-chroma eye pixels (unchanged);
    # bars: running-median residual of the column-mean profile (cap42 R2).
    sclera = eye & (C < SCLERA_C_MAX)
    sclera_L = float(L[sclera].mean()) if sclera.any() else 0.0
    bars = sclera_bars(L, C, eye)

    # (c) brow: hair-class rows fully above the eye top minus 3px (nohair
    # masks keep only brows+lashes in hair; lashes sit at/below eye rows).
    # Coverage = fraction of brow pixels darker than the skin band above.
    brow = np.zeros_like(eye, dtype=bool)
    brow_pixels, brow_mean_L, brow_coverage = 0, None, None
    if eye.any() and hair.any():
        eye_top = int(ys[eye].min())
        brow = hair & (ys < eye_top - BROW_ROW_GAP_PX)
        brow_pixels = int(brow.sum())
        if brow_pixels:
            brow_mean_L = float(L[brow].mean())
            brow_top = int(ys[brow].min())
            band_rows = (ys >= brow_top - SKIN_BAND_PX) & (ys < brow_top)
            skinband = skin & band_rows
            if skinband.any():
                thresh = float(np.median(L[skinband])) - BROW_DARK_DROP
                brow_coverage = float((L[brow] < thresh).mean())

    return {
        "corner_dark": corner,
        "sclera_L": sclera_L,
        "sclera_bars": bars,
        "brow": {"pixels": brow_pixels, "mean_L": brow_mean_L, "coverage": brow_coverage},
    }


TSV_COLS = [
    "preset", "cam", "side",
    "corner_L_inner_count", "corner_L_inner_frac",
    "corner_L_outer_count", "corner_L_outer_frac",
    "corner_R_inner_count", "corner_R_inner_frac",
    "corner_R_outer_count", "corner_R_outer_frac",
    "sclera_L", "sclera_bars_L_max", "sclera_bars_R_max",
    "brow_pixels", "brow_mean_L", "brow_coverage",
]

FLOOR_COLS = [
    "F_corner_L_inner", "F_corner_L_outer",
    "F_corner_R_inner", "F_corner_R_outer",
    "F_bars_L", "F_bars_R",
]


def _row(preset: str, cam: str, side: str, m: dict, floor: dict | None = None) -> str:
    c = m["corner_dark"]
    b = m["brow"]
    sb = m["sclera_bars"]
    vals = [
        preset, cam, side,
        str(c["L"]["inner"]["count"]), f"{c['L']['inner']['fraction']:.4f}",
        str(c["L"]["outer"]["count"]), f"{c['L']['outer']['fraction']:.4f}",
        str(c["R"]["inner"]["count"]), f"{c['R']['inner']['fraction']:.4f}",
        str(c["R"]["outer"]["count"]), f"{c['R']['outer']['fraction']:.4f}",
        f"{m['sclera_L']:.2f}", f"{sb['L']['max_resid']:.3f}", f"{sb['R']['max_resid']:.3f}",
        str(b["pixels"]),
        ("NA" if b["mean_L"] is None else f"{b['mean_L']:.2f}"),
        ("NA" if b["coverage"] is None else f"{b['coverage']:.3f}"),
    ]
    if floor is not None:
        f = floor.get(cam, {})
        fc = f.get("corner", {})
        fb = f.get("bars", {})
        vals += [
            f"{fc.get('L', {}).get('inner', float('nan')):.4f}",
            f"{fc.get('L', {}).get('outer', float('nan')):.4f}",
            f"{fc.get('R', {}).get('inner', float('nan')):.4f}",
            f"{fc.get('R', {}).get('outer', float('nan')):.4f}",
            f"{fb.get('L', float('nan')):.3f}",
            f"{fb.get('R', float('nan')):.3f}",
        ]
    return "\t".join(vals)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--cand", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tsv", required=True)
    ap.add_argument("--cams", default=None)
    ap.add_argument("--cand-label", default=None)
    ap.add_argument("--floor", default=None)
    a = ap.parse_args(argv)

    try:
        with open(os.path.join(a.ref, "cameras.json")) as f:
            known = [c["name"] for c in json.load(f)["cameras"]]
    except (OSError, KeyError, json.JSONDecodeError) as e:
        print(f"eye_detail: REFUSED: cannot read ref cameras.json: {e}", file=sys.stderr)
        return 2
    cams = a.cams.split(",") if a.cams else known
    for c in cams:
        if c not in known:
            print(f"eye_detail: REFUSED: unknown cam '{c}'", file=sys.stderr)
            return 2
    floor = None
    if a.floor:
        with open(a.floor) as f:
            floor = json.load(f).get("F", {})
    cand_label = a.cand_label or os.path.basename(os.path.normpath(a.cand))
    ref_label = os.path.basename(os.path.normpath(a.ref))

    out = {"ref": a.ref, "cand": a.cand, "cameras": {}}
    rows = []
    for cam in cams:
        rb = os.path.join(a.ref, "beauty", f"{cam}.png")
        rm = os.path.join(a.ref, "masks", f"{cam}.png")
        cp = os.path.join(a.cand, f"{cam}.png")
        for p in (rb, rm, cp):
            if not os.path.isfile(p):
                print(f"eye_detail: REFUSED: missing file: {p}", file=sys.stderr)
                return 2
        ref_u8, mask_u8, cand_u8 = load_rgb(rb), load_rgb(rm), load_rgb(cp)
        if cand_u8.shape != ref_u8.shape or mask_u8.shape != ref_u8.shape:
            print(f"eye_detail: REFUSED: size mismatch on {cam}", file=sys.stderr)
            return 2
        m_ref, m_cand = analyze(ref_u8, mask_u8), analyze(cand_u8, mask_u8)
        out["cameras"][cam] = {"ref": m_ref, "cand": m_cand}
        rows.append(_row(ref_label, cam, "ref", m_ref, floor))
        rows.append(_row(cand_label, cam, "cand", m_cand, floor))

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
    cols = TSV_COLS + (FLOOR_COLS if floor is not None else [])
    need_hdr = not os.path.isfile(a.tsv)
    with open(a.tsv, "a") as f:
        if need_hdr:
            f.write("\t".join(cols) + "\n")
        f.write("\n".join(rows) + "\n")
    print(f"eye_detail: wrote {a.out} ({len(cams)} cams)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

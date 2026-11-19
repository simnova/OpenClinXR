#!/usr/bin/env python3
"""Eye/brow detail metrics (aisha-parity P4): canthus darkness, sclera tone/streak, brow albedo/coverage.

Layout mirrors compare.py: ref dir holds beauty/<cam>.png + masks/<cam>.png
(the nohair mask PNGs), cand dir holds <cam>.png. Both sides are measured
through the REF mask (same registration contract as compare.py).

CLI: eye_detail.py --ref <refdir> --cand <canddir> --out <json> --tsv <tsv>
  [--cams a,b] [--cand-label name]
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

CANTHUS_L_MAX = 15
CANTHUS_DILATE_PX = 6
SCLERA_C_MAX = 12
BROW_ROW_GAP_PX = 3
SKIN_BAND_PX = 10
BROW_DARK_DROP = 15


def _dilate(mask: np.ndarray, iterations: int) -> np.ndarray:
    from scipy.ndimage import binary_dilation

    if not mask.any():
        return mask
    return binary_dilation(mask, iterations=iterations)


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

    # (a) canthus darkness: 6px ring outside the eye mask (lashes excluded),
    # L* < 15, split at the eye mask x centroid.
    band = _dilate(eye, CANTHUS_DILATE_PX) & ~eye & ~hair
    cx = float(xs[eye].mean()) if eye.any() else w / 2.0
    canthus = {}
    for side, sel in (("L", xs < cx), ("R", xs >= cx)):
        b = band & sel
        n = int(b.sum())
        dark = int((b & (L < CANTHUS_L_MAX)).sum())
        canthus[side] = {"count": dark, "fraction": (dark / n) if n else 0.0, "band": n}

    # (b) sclera tone: mean L* of low-chroma eye pixels; streak = mean over
    # sclera columns of the per-column L* std (vertical streaks raise it).
    sclera = eye & (C < SCLERA_C_MAX)
    sclera_L = float(L[sclera].mean()) if sclera.any() else 0.0
    col_stds = []
    for x in range(w):
        col = L[(sclera & (xs == x))]
        if col.size >= 2:
            col_stds.append(float(col.std()))
    sclera_streak = float(np.mean(col_stds)) if col_stds else 0.0

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
        "canthus_dark": canthus,
        "sclera_L": sclera_L,
        "sclera_streak": sclera_streak,
        "brow": {"pixels": brow_pixels, "mean_L": brow_mean_L, "coverage": brow_coverage},
    }


TSV_COLS = [
    "preset", "cam", "side",
    "canthus_L_count", "canthus_L_frac", "canthus_R_count", "canthus_R_frac",
    "sclera_L", "sclera_streak",
    "brow_pixels", "brow_mean_L", "brow_coverage",
]


def _row(preset: str, cam: str, side: str, m: dict) -> str:
    c = m["canthus_dark"]
    b = m["brow"]
    vals = [
        preset, cam, side,
        str(c["L"]["count"]), f"{c['L']['fraction']:.4f}",
        str(c["R"]["count"]), f"{c['R']['fraction']:.4f}",
        f"{m['sclera_L']:.2f}", f"{m['sclera_streak']:.3f}",
        str(b["pixels"]),
        ("NA" if b["mean_L"] is None else f"{b['mean_L']:.2f}"),
        ("NA" if b["coverage"] is None else f"{b['coverage']:.3f}"),
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
        rows.append(_row(ref_label, cam, "ref", m_ref))
        rows.append(_row(cand_label, cam, "cand", m_cand))

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(out, f, indent=1)
    need_hdr = not os.path.isfile(a.tsv)
    with open(a.tsv, "a") as f:
        if need_hdr:
            f.write("\t".join(TSV_COLS) + "\n")
        f.write("\n".join(rows) + "\n")
    print(f"eye_detail: wrote {a.out} ({len(cams)} cams)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

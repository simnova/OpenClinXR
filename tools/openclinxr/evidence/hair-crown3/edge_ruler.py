#!/usr/bin/env python3
"""hair-crown3 STEP 1 edge ruler: hairline transition width, dark-band area,
part-line width/lum — ours vs target, front + three_quarter crown crops.

(a) transition width: hairline edge pixels from the hair silhouette
    (beauty ID alpha>=30 for ours; target hair mask for target); local tangent
    from ±10px edge neighbourhood PCA; sample luminance ±25px along the normal;
    width = pixel distance between 10% and 90% of the hair-to-skin luminance
    range (>=20 samples per view).
(b) dark-band area: pixels with lum < hair_p50 AND ID alpha<30 inside the
    hairline band (front: rows [hl-10, hl+120] over hairline cols;
    TQ: 12px skin-side strip along the edge curve).
(c) part line (front only): rows hl-100..hl-10 step 10; per row, bg = median
    lum of side strips (cols 430-470, 555-595); peak near centre ±8 of col 512;
    width = run of cols with lum > bg+0.35*(peak-bg) around centre (0 if
    peak-bg<0.05); lum = mean inside run.
Overlay: E/edge-ruler.png (sample normals per view + part rows). MUST be read
before the numbers are used.
Usage: edge_ruler.py --scores DIR --tag TAG --out OUT.json --overlay PNG
  (target side always measured from the frozen target set for the same views)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

E = Path(__file__).resolve().parent
T = Path("/Volumes/files/src/openclinxr/.openclinxr/scratch/target-views/set-back")
TJ = Path("/Users/patrick/.grok/worktrees/src-openclinxr/hair-judge/tools/openclinxr/evidence/hair-judge/target-set-back")
SIZE = 1024


def rgb(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), dtype=float) / 255.0


def lum_im(im: np.ndarray) -> np.ndarray:
    return 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]


def bilin(L: np.ndarray, ys: np.ndarray, xs: np.ndarray) -> np.ndarray:
    ys = np.clip(ys, 0, SIZE - 1.001)
    xs = np.clip(xs, 0, SIZE - 1.001)
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = ys - y0
    fx = xs - x0
    return (L[y0, x0] * (1 - fy) * (1 - fx) + L[y0, x0 + 1] * (1 - fy) * fx
            + L[y0 + 1, x0] * fy * (1 - fx) + L[y0 + 1, x0 + 1] * fy * fx)


def edge_curve_bottom(mask: np.ndarray, cols: np.ndarray,
                     rlo: int, rhi: int, exclude=None) -> tuple[np.ndarray, np.ndarray]:
    """Bottom-most True pixel per column, clipped to [rlo,rhi]."""
    H = mask.shape[0]
    rev = mask[::-1]
    has = mask[:, cols].any(axis=0)
    bot = H - 1 - rev[:, cols].argmax(axis=0)
    ok = has & (bot >= rlo) & (bot <= rhi)
    if exclude is not None:
        ok = ok & ~exclude
    return cols[ok], bot[ok]


def edge_curve_leftmost(mask: np.ndarray, rows: np.ndarray,
                        clo: int, chi: int) -> tuple[np.ndarray, np.ndarray]:
    has = mask[rows][:, clo:chi].any(axis=1)
    left = mask[rows][:, clo:chi].argmax(axis=1) + clo
    ok = has & (left >= clo) & (left < chi)
    return left[ok], rows[ok]


def trans_width(L: np.ndarray, pts: np.ndarray, n_min: int = 20,
                half: int = 25) -> tuple[dict, list]:
    """pts: (N,2) x,y edge pixels. Tangent via local PCA; width via 10-90%."""
    n = len(pts)
    if n < 5:
        return {"n": 0, "medianPx": None, "meanPx": None, "iqrPx": None,
                "widthsPx": []}, []
    # use ALL edge points (capped at 200): medians over 24-point subsamples
    # flip on ID thread-noise; full sampling stabilizes the gate.
    idx = np.linspace(0, n - 1, num=min(n, 200)).astype(int)
    widths, grads, segs = [], [], []
    t = np.arange(-half, half + 1, dtype=float)
    for i in idx:
        lo, hi = max(0, i - 4), min(n, i + 5)
        seg = pts[lo:hi]
        if len(seg) < 3:
            continue
        c = seg.mean(axis=0)
        _, _, vt = np.linalg.svd(seg - c, full_matrices=False)
        tangent = vt[0] / (np.linalg.norm(vt[0]) + 1e-12)
        normal = np.array([-tangent[1], tangent[0]])
        p = pts[i].astype(float)
        prof = bilin(L, p[1] + normal[1] * t, p[0] + normal[0] * t)
        # orient: hair side should be darker; flip if needed
        if np.median(prof[:8]) > np.median(prof[-8:]):
            prof = prof[::-1]
            sgn = -1.0
        else:
            sgn = 1.0
        grad = np.abs(np.diff(prof))
        maxgrad = float(grad.max()) if len(grad) else None
        lo_ref = float(np.median(prof[:6]))
        hi_ref = float(np.median(prof[-6:]))
        span = hi_ref - lo_ref
        if span < 0.03:
            continue
        s = (prof - lo_ref) / span
        # first crossings of 0.1 and 0.9 from the hair side
        try:
            i10 = int(np.argmax(s > 0.10))
            j = np.argmax(s[i10:] > 0.90) + i10
            if s[i10] <= 0.10 or s[j] <= 0.90:
                continue
            # linear refine
            def cross(k, lvl):
                k0 = max(k - 1, 0)
                d = s[k] - s[k0]
                return k0 + (lvl - s[k0]) / d if d > 1e-9 else float(k)
            w = cross(j, 0.90) - cross(i10, 0.10)
        except Exception:
            continue
        if 0 <= w <= half * 2:
            widths.append(float(w))
            grads.append(maxgrad)
            segs.append((p, normal * sgn))
    widths = np.array(widths)
    grads = np.array(grads)
    if len(widths) < 3:
        return {"n": int(len(widths)), "medianPx": None, "meanPx": None,
                "iqrPx": None, "widthsPx": [round(float(w), 2) for w in widths],
                "medianMaxGrad": None}, segs
    return {"n": int(len(widths)), "medianPx": round(float(np.median(widths)), 2),
            "meanPx": round(float(widths.mean()), 2),
            "iqrPx": round(float(np.percentile(widths, 75) - np.percentile(widths, 25)), 2),
            "widthsPx": [round(float(w), 2) for w in widths],
            "medianMaxGrad": round(float(np.median(grads)), 3)}, segs


def part_line(L: np.ndarray, hl_row: float, hb_row: float | None = None) -> dict:
    # rows sit inside HAIR: hb-100..hb-30 (hb = hair-bottom edge), and above
    # the anatomical hairline (hl-15) so liner/forehead never counts.
    ref = hb_row if hb_row else hl_row
    rows = [int(ref + d) for d in (-100, -90, -80, -70, -60, -50, -40, -30)]
    rows = [r for r in rows if 20 <= r < SIZE - 20 and r < hl_row - 15]
    ws, ls = [], []
    for r in rows:
        bg = float(np.median(np.r_[L[r, 430:470], L[r, 555:595]]))
        window = L[r, 488:537]
        peak_i = int(window.argmax())
        peak = float(window[peak_i])
        if peak - bg < 0.05:
            ws.append(0)
            continue
        thr = bg + 0.35 * (peak - bg)
        run = np.flatnonzero(window > thr)
        # contiguous run containing peak
        if len(run) == 0:
            ws.append(0)
            continue
        left = peak_i
        while left - 1 in run:
            left -= 1
        right = peak_i
        while right + 1 in run:
            right += 1
        w = right - left + 1
        ws.append(int(w))
        ls.append(float(L[r, 488 + left:488 + right + 1].mean()))
    det = [w for w in ws if w > 0]
    return {"rows": rows, "widthsPx": ws,
            "detectFrac": round(float(len(det) / max(len(ws), 1)), 3),
            "meanWidthPx": round(float(np.mean(det)), 2) if det else 0.0,
            "medianWidthPx": float(np.median(ws)) if ws else 0.0,
            "meanLum": round(float(np.mean(ls)), 4) if ls else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scores", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--overlay", required=True)
    ap.add_argument("--capmask", default="",
                    help="ours front anatomical-hairline mask (capmask white); "
                    "front ours edge = its bottom edge, fixed across cells")
    a = ap.parse_args()
    D = Path(a.scores)
    rep: dict = {"tag": a.tag, "definition": (
        "hairline edge from hair silhouette (ID alpha>=30) / target mask; "
        "transition width = 10-90% hair-to-skin lum distance along edge "
        "normals; dark band = lum<hair_p50 & alpha<30 in hairline band; "
        "part rows relative to centre hairline row")}
    panels = []
    for view, tmask, tphoto in (("front", "mask-front-v2.png", "target-front.png"),
                                ("three_quarter", "mask-three_quarter.png",
                                 "target-three_quarter.png")):
        im = rgb(D / f"{view}.png")
        L = lum_im(im)
        alpha = np.asarray(Image.open(D / f"{view}-id.png").convert("RGBA"),
                           dtype=np.uint8)[..., 3]
        hair = alpha >= 30
        tim = rgb(T / tphoto)
        tL = lum_im(tim)
        tmask_im = np.asarray(Image.open(TJ / tmask).convert("L")) > 127
        if view == "front":
            cols = np.array([c for c in range(400, 625) if not 500 <= c <= 524])
            if a.capmask:
                capm = np.asarray(Image.open(a.capmask).convert("L")) > 127
                ox, oy = edge_curve_bottom(capm, cols, 80, 320)
            else:
                ox, oy = edge_curve_bottom(hair, cols, 100, 260)
            tx, ty = edge_curve_bottom(tmask_im, cols, 100, 300)
            # hair-bottom edge (silhouette): anchors part rows inside HAIR
            hx, hy = edge_curve_bottom(hair, cols, 80, 320)
            hb = float(np.median(hy)) if len(hy) else None
            # keep hairline rows only: within 25px of the column-median
            # (drops drape-side columns whose bottom edge runs far below)
            if len(oy):
                med = float(np.median(oy))
                keep = np.abs(oy - med) <= 25
                ox, oy = ox[keep], oy[keep]
            if len(ty):
                tmed = float(np.median(ty))
                tkeep = np.abs(ty - tmed) <= 25
                tx, ty = tx[tkeep], ty[tkeep]
            opts = np.c_[ox, oy]
            tpts = np.c_[tx, ty]
            hl = float(np.median(oy)) if len(oy) else None
            thl = float(np.median(ty)) if len(ty) else None
            # hair p50 in crown ROI
            roi = np.zeros_like(hair)
            roi[100:260, 380:640] = True
            hp50 = float(np.median(L[roi & (alpha >= 230)])) if (roi & (alpha >= 230)).any() else None
            # dark band: rows [hl-10, hl+120] over hairline cols
            # dark band: rows [hl-10, hl+60] over hairline cols.
            # hl+60 stops above the brows (brow rows ~300+ are dark,
            # non-hair, and NOT liner — they must not count).
            band = np.zeros_like(hair)
            if hl is not None:
                band[int(max(hl - 10, 0)):int(min(hl + 60, SIZE)), 380:640] = True
            dark = band & (alpha < 30) & (L < hp50)
            tband = np.zeros_like(hair)
            if thl is not None:
                tband[int(max(thl - 10, 0)):int(min(thl + 60, SIZE)), 380:640] = True
            tdark = tband & ~tmask_im & (tL < float(np.median(tL[tmask_im & (tband)])) if (tmask_im & tband).any() else 1.0)
            part = part_line(L, hl, hb) if hl else {}
            tpart = part_line(tL, thl, thl) if thl else {}
        else:
            rows = np.arange(130, 251)
            ox, oy = edge_curve_leftmost(hair, rows, 150, 600)
            tx, ty = edge_curve_leftmost(tmask_im, rows, 150, 700)
            opts = np.c_[ox, oy]
            tpts = np.c_[tx, ty]
            hl = thl = None
            roi = np.zeros_like(hair)
            roi[100:360, 150:650] = True
            hp50 = float(np.median(L[roi & (alpha >= 230)])) if (roi & (alpha >= 230)).any() else None
            # dark band: 12px skin-side strip along edge curve
            band = np.zeros_like(hair)
            for x, y in zip(ox.tolist(), oy.tolist()):
                band[max(y - 6, 0):y + 1, max(x - 12, 0):x] = True
            dark = band & (alpha < 30) & (L < hp50)
            tband = np.zeros_like(hair)
            for x, y in zip(tx.tolist(), ty.tolist()):
                tband[max(y - 6, 0):y + 1, max(x - 12, 0):x] = True
            tref = float(np.median(tL[tmask_im & (tband | (np.zeros_like(hair) == 0) & False)])) if False else None
            tm2 = tmask_im & (tL > -1)
            tref = float(np.median(tL[tm2])) if tm2.any() else 1.0
            tdark = tband & ~tmask_im & (tL < tref)
            part, tpart = {}, {}
        ow, osegs = trans_width(L, opts)
        tw, tsegs = trans_width(tL, tpts)
        rep[view] = {
            "ours": {"hairlineRow": hl, "hairP50": round(hp50, 4) if hp50 else None,
                     "transWidth": ow, "darkBandPx": int(dark.sum()),
                     "darkBandFracOfBand": round(float(dark.sum() / max(band.sum(), 1)), 4),
                     "part": part},
            "target": {"hairlineRow": thl, "transWidth": tw,
                       "darkBandPx": int(tdark.sum()), "part": tpart},
        }
        # overlay panels: crop + sample normals
        for tag2, img, segs, pts in (("ours", im, osegs, opts), ("tgt", tim, tsegs, tpts)):
            if view == "front":
                box = (80, 300, 360, 664)
            else:
                box = (80, 380, 150, 650)
            r0, r1, c0, c1 = box
            panel = Image.fromarray((img[r0:r1, c0:c1] * 255).astype(np.uint8)).copy()
            dr = ImageDraw.Draw(panel)
            for x, y in pts[::max(len(pts) // 60, 1)]:
                if c0 <= x < c1 and r0 <= y < r1:
                    dr.ellipse([x - c0 - 2, y - r0 - 2, x - c0 + 2, y - r0 + 2],
                               outline=(255, 0, 0))
            for p, n in segs:
                x0, y0 = p - n * 25
                x1, y1 = p + n * 25
                dr.line([x0 - c0, y0 - r0, x1 - c0, y1 - r0], fill=(0, 255, 0), width=1)
            dr.text((8, 8), f"{view} {tag2}: RED=edge GREEN=normals(n={len(segs)})",
                    fill=(255, 255, 0))
            panels.append(panel)
    Path(a.out).write_text(json.dumps(rep, indent=1) + "\n")
    print(json.dumps(rep, indent=1), flush=True)
    W = max(p.width for p in panels)
    sheet = Image.new("RGB", (W * 2, panels[0].height + panels[2].height), "black")
    sheet.paste(panels[0], (0, 0))
    sheet.paste(panels[1], (W, 0))
    sheet.paste(panels[2], (0, panels[0].height))
    sheet.paste(panels[3], (W, panels[0].height))
    sheet.save(a.overlay)
    print("saved", a.overlay, sheet.size, flush=True)


if __name__ == "__main__":
    main()

"""Approach F (limbal-edge compress): sharpen ONLY the r115-160 limbus->sclera
transition of iris-centred-e.png into a sharp dark-limbus to bright-sclera
edge (~8px wide smoothstep), crossing at the SAME halfway radius as E so the
centre/radius gates do not move.

Frozen byte-exact: everything with r<110 (pupil disc r<=38 and all iris
interior) and everything with r>=160 (true sclera) per eye. Only the
transition annulus 110<=r<160 is remapped, and only radially: each pixel is
scaled proportionally in RGB (luminance-proportional gain), which preserves
chromaticity exactly (no hue shift, saturation identical by construction).

Per eye, about the dark-pupil centroid:
  D = median 0-255 luminance at r 108..112 (dark limbus plateau)
  S = median 0-255 luminance at r 165..175 (sclera plateau)
  rc = E halfway radius where azimuthal-median luminance = (D+S)/2
  P(r) = D for r<=rc-4, S for r>=rc+4, smoothstep between (8px edge)
  gain(r) = P(r)/Emed(r); pixel *= gain(r), capped at S_max (E's max sclera
  luminance at r 160..180, so the shoulder never overshoots real sclera),
  blended gain->1 over r 156..160 for continuity into the frozen sclera.
No clamp at 140 (that was the iris-annulus ceiling; sclera must stay ~175).
No angular term: no lid shadow, no catchlight (iris annulus untouched)."""

import math
import numpy as np
from PIL import Image

SRC = "tools/openclinxr/asset-pipeline/eyes/iris-centred-e.png"
DST = "tools/openclinxr/asset-pipeline/eyes/iris-centred-f.png"
SEEDS = [(296, 724), (722, 302)]
R_KEEP_IN = 110.0
R_KEEP_OUT = 160.0
HALF_WIDTH = 4.0
FEATHER_START = 156.0


def luminance_px(r, g, b):
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def lab_L(r, g, b):
    def lin(c):
        v = c / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29

    return 116 * f(y) - 16


def pupil_centroid(img, sx, sy):
    xs, ys, n = 0.0, 0.0, 0
    H, W, _ = img.shape
    for y in range(max(0, sy - 60), min(H, sy + 60)):
        for x in range(max(0, sx - 60), min(W, sx + 60)):
            r, g, b = img[y, x]
            # dark-pupil membership via CIELAB L* (same units as
            # iris-png.ts luminanceLStar used by the render gates)
            if lab_L(r, g, b) < 12 and math.hypot(x - sx, y - sy) < 60:
                xs += x
                ys += y
                n += 1
    return xs / n, ys / n


def main():
    base = np.array(Image.open(SRC).convert("RGB")).astype(np.float64)
    out = base.copy()
    H, W, _ = base.shape
    for ei, (sx, sy) in enumerate(SEEDS):
        cx, cy = pupil_centroid(base, sx, sy)
        # azimuthal median luminance profile
        prof = {}
        y0, y1 = max(0, int(cy) - 260), min(H, int(cy) + 260)
        x0, x1 = max(0, int(cx) - 260), min(W, int(cx) + 260)
        for y in range(y0, y1):
            for x in range(x0, x1):
                ri = int(round(math.hypot(x - cx, y - cy)))
                if ri > 260:
                    continue
                prof.setdefault(ri, []).append(luminance_px(*base[y, x]))
        med = {k: float(np.median(v)) for k, v in prof.items()}
        D = float(np.median([med[k] for k in range(108, 113)]))
        S = float(np.median([med[k] for k in range(165, 176)]))
        S_max = float(max(max(prof[k]) for k in range(160, 181)))
        half = (D + S) / 2.0
        rc = None
        for k in range(110, 165):
            if med[k] >= half:
                v0, v1 = med[k - 1], med[k]
                rc = (k - 1) + (half - v0) / (v1 - v0)
                break
        assert rc is not None, f"eye{ei}: no halfway crossing found"
        print(f"eye{ei} centroid=({cx:.2f},{cy:.2f}) D={D:.2f} S={S:.2f} S_max={S_max:.2f} rc={rc:.3f}")

        def target(r):
            if r <= rc - HALF_WIDTH:
                return D
            if r >= rc + HALF_WIDTH:
                return S
            t = (r - (rc - HALF_WIDTH)) / (2 * HALF_WIDTH)
            s = t * t * (3 - 2 * t)
            return D + (S - D) * s

        n_touch = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                r = math.hypot(x - cx, y - cy)
                if not (R_KEEP_IN <= r < R_KEEP_OUT):
                    continue
                ri = int(round(r))
                em = med.get(ri)
                if not em or em <= 0:
                    continue
                g = target(r) / em
                if r >= FEATHER_START:
                    g = 1.0 + (g - 1.0) * (R_KEEP_OUT - r) / (R_KEEP_OUT - FEATHER_START)
                px = base[y, x] * g
                # cap at natural sclera ceiling (luminance-preserving: rescale)
                lum = luminance_px(*px)
                if lum > S_max and lum > 0:
                    px = px * (S_max / lum)
                out[y, x] = np.clip(px, 0, 255)
                n_touch += 1
        print(f"eye{ei} remapped {n_touch} px")
    Image.fromarray(np.round(out).astype(np.uint8)).save(DST)
    print("wrote", DST)


main()

"""P2 report metrics, front view, runtime frame: part width and hairline falloff.

    python3 part_width.py <out.json> <name>=<front.png> [...]

Images must share one frame (target downsampled with runtime_frame.py to-runtime, renders from the head-crop
harness). Per image:
- centre column c: median column of dark (L < .30) pixels in the 20 rows below the hair top;
- hair L = p25 of L over those rows; skin L = median L of a 21x21 window 30 px under the centre hairline;
  threshold t = hair + .5 (skin - hair);
- hairline row at c: first row from the top where L > t holds for 12 consecutive rows;
- part width: per row between hair top + 4 and hairline - 2, the longest run of L > t within c +- 25 px;
  reported as median and p90 in px; part peak L = median over those rows of max L within c +- 25 px;
- hairline falloff: per column in c +- 30..70 px (both sides), the rows the L profile takes to climb from
  10% to 90% of (skin - hair) across its hairline; median px.
Report-only (DESIGN-realism.md, metrics table: part width and hairline falloff are reported vs target, the
grader gates P2).
"""
from __future__ import annotations

import json
import sys

import numpy as np
from PIL import Image

W = np.array([0.2126, 0.7152, 0.0722])


def runs_max(b):
    d = np.diff(np.r_[0, b.astype(int), 0])
    s, e = np.where(d == 1)[0], np.where(d == -1)[0]
    return int((e - s).max()) if len(s) else 0


def measure(path):
    L = (np.asarray(Image.open(path).convert('RGB'), float) / 255.) @ W
    dark = L < 0.30
    rows = np.where(dark.sum(1) > 20)[0]
    top = int(rows.min())
    ys, xs = np.nonzero(dark[top:top + 20])
    c = int(np.median(xs))
    hair = float(np.percentile(L[top:top + 20][dark[top:top + 20]], 25))
    col = L[:, c]
    # provisional threshold from the column itself to locate the hairline, then refine with skin
    t0 = hair + 0.5 * (float(np.percentile(col[top:top + 200], 90)) - hair)
    def hairline(t):
        above = col > t
        for r in range(top + 4, len(col) - 12):
            if above[r:r + 12].all():
                return r
        raise RuntimeError(f'{path}: no hairline at column {c}')
    h0 = hairline(t0)
    skin = float(np.median(L[h0 + 20:h0 + 41, c - 10:c + 11]))
    t = hair + 0.5 * (skin - hair)
    h = hairline(t)
    widths = [runs_max(L[r, c - 25:c + 26] > t) for r in range(top + 4, h - 1)]
    peaks = [float(L[r, c - 25:c + 26].max()) for r in range(top + 4, h - 1)]
    falls = []
    for dx in list(range(-70, -29, 4)) + list(range(30, 71, 4)):
        p = L[top:h + 60, c + dx]
        lo, hi = hair + 0.1 * (skin - hair), hair + 0.9 * (skin - hair)
        # first row of an 8-row skin run, then the last row at or under lo above it
        run = np.convolve(p > hi, np.ones(8), 'valid') == 8
        if not run.any():
            continue
        r90 = int(np.argmax(run))
        below = np.where(p[:r90] <= lo)[0]
        if len(below):
            falls.append(r90 - int(below.max()))
    return dict(hairTop=top, centreCol=c, hairlineRow=h, hairL=round(hair, 3), skinL=round(skin, 3),
                partRows=len(widths), partWidthMedPx=float(np.median(widths)) if widths else 0.0,
                partWidthP90Px=float(np.percentile(widths, 90)) if widths else 0.0,
                partPeakLMed=round(float(np.median(peaks)), 3) if peaks else 0.0,
                hairlineFalloffMedPx=float(np.median(falls)) if falls else None, falloffCols=len(falls))


def main(argv):
    out = {}
    for a in argv[1:]:
        name, path = a.split('=', 1)
        out[name] = dict(path=path, **measure(path))
    open(argv[0], 'w').write(json.dumps(out, indent=1))
    for k, v in out.items():
        print(k, {q: v[q] for q in ('partWidthMedPx', 'partWidthP90Px', 'partPeakLMed', 'hairlineFalloffMedPx', 'hairlineRow', 'centreCol')})


if __name__ == '__main__':
    main(sys.argv[1:])

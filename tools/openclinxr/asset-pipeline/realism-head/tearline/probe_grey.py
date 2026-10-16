#!/usr/bin/env python3
"""Tearline G1 probe: detached grey components inside the wedge box.

Box (1280): (781,728,19,21) +-6px -> x[775,806) y[722,755).
Grey = max-channel < 100 (calibrated to reproduce the lash-tick G1 base:
(100 @775,722 29x5), (43 @788,734 11x14), (30 @782,727 7x10) on the fresh
main render /tmp/tearline-falsifier/facedefects-sheet-front.png).
Detached = fully below the lower-lid margin row (min-y >= LID_MARGIN_Y)
and touching no box border: the graded defect is the BELOW-row wedge;
lid-row darkness (lash roots/liner, the lash-tick domain) is attached.
LID_MARGIN_Y = 734: base/fixed column profiles put the lid-row dark band
at y726-733 and the wedge plateau at y737-741 (probe_grey calibration in
tearline-report.json).

Usage: probe_grey.py <png> [--box x,y,w,h] [--pad N]
"""
import sys
from collections import deque

from PIL import Image

W, H = 1280, 1280
LID_MARGIN_Y = 734


def is_grey(p):
    # Calibrated to reproduce the lash-tick G1 base on the fresh main render
    # (/tmp/tearline-falsifier/facedefects-sheet-front.png): max-channel < 100
    # yields (100 @775,722 29x5), (43 @788,734 11x14), (30 @782,727 7x10).
    return max(p[:3]) < 100


def find_components(px, w, h, x0, y0, x1, y1):
    seen = bytearray(w * h)
    comps = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if seen[y * w + x]:
                continue
            if not is_grey(px[x, y]):
                continue
            q = deque([(x, y)])
            seen[y * w + x] = 1
            xs, ys0 = [], []
            while q:
                cx, cy = q.popleft()
                xs.append(cx)
                ys0.append(cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if nx < x0 or nx >= x1 or ny < y0 or ny >= y1:
                        continue
                    if seen[ny * w + nx]:
                        continue
                    seen[ny * w + nx] = 1
                    if is_grey(px[nx, ny]):
                        q.append((nx, ny))
            mx, my = min(xs), min(ys0)
            touches = mx == x0 or my == y0 or max(xs) == x1 - 1 or max(ys0) == y1 - 1
            detached = (not touches) and my >= LID_MARGIN_Y
            comps.append({"area": len(xs), "x": mx, "y": my,
                          "w": max(xs) - mx + 1, "h": max(ys0) - my + 1,
                          "detached": detached})
    return sorted(comps, key=lambda c: -c["area"])


def main():
    png = sys.argv[1]
    bx, by, bw, bh, pad = 781, 728, 19, 21, 6
    for a in sys.argv[2:]:
        if a.startswith("--box="):
            bx, by, bw, bh = [int(v) for v in a[6:].split(",")]
        elif a.startswith("--pad="):
            pad = int(a[6:])
    im = Image.open(png).convert("RGB")
    assert im.size == (W, H), f"expected 1280x1280 got {im.size} in {png}"
    px = im.load()
    x0, y0 = max(0, bx - pad), max(0, by - pad)
    x1, y1 = min(W, bx + bw + pad), min(H, by + bh + pad)
    comps = find_components(px, W, H, x0, y0, x1, y1)
    big = [c for c in comps if c["area"] > 20]
    det = [c for c in big if c["detached"]]
    print(f"BOX x[{x0},{x1}) y[{y0},{y1}) comps>20px: {len(big)} detached: {len(det)}")
    for c in big[:8]:
        if c["detached"]:
            why = "DETACHED"
        elif c["y"] < LID_MARGIN_Y:
            why = "lid-row"
        else:
            why = "border-touch"
        print(f"  area={c['area']} @({c['x']},{c['y']}) {c['w']}x{c['h']} {why}")
    # darkest pixel in box (wedge min ~70 sRGB per owner record)
    mn = min(min(px[x, y][:3]) for y in range(y0, y1) for x in range(x0, x1))
    print(f"boxMin={mn}")


if __name__ == "__main__":
    main()

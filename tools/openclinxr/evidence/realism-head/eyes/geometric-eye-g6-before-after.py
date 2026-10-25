#!/usr/bin/env python3
"""G6 closeout: before/after eye-band composite + measured labels.

BEFORE = shipped store aisha-lidconform.glb (old painted-sphere eye),
  re-captured this slice through the identical three.js pipeline.
AFTER = geometric-eye-g6-head.glb (Aisha, re-captured this slice) +
  geometric-eye-g6-child-head.glb (second subject, proportional k).
Framing: full frames auto-frame per head, so eye BANDS are scale-
normalized (crop half-width = 5.5x detected iris radius, same aspect) --
same framing at the eye level. Labels carry measured numbers (dot,
ring, parallax shift). Also: socket-at-yaw background probe (cheap).
Out: geometric-eye-g6-before-after.png + geometric-eye-g6-before-after.json
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
SETS = {
    "before": Path("/tmp/g6before"),
    "aisha": Path("/tmp/g6test"),
    "child": Path("/tmp/g6child"),
}
BG = np.array([20, 22, 28], dtype=float)  # scene background #14161c


def lum(im):
    a = np.asarray(im.convert("RGB")).astype(np.float64)
    return 0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]


def sat(im):
    a = np.asarray(im.convert("RGB")).astype(np.float64)
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)


def label_dark(mask):
    lab = np.zeros(mask.shape, dtype=np.int32)
    cur = 0
    H, W = mask.shape
    for y in range(H):
        for x in range(W):
            if mask[y, x] and not lab[y, x]:
                cur += 1
                stack = [(y, x)]
                lab[y, x] = cur
                while stack:
                    cy, cx = stack.pop()
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                                lab[ny, nx] = cur
                                stack.append((ny, nx))
    return lab, cur


def find_irises(im):
    """Per-half darkest-core search in the eye strip -> L/R iris centres.
    Core (<50) isolates pupil/iris from lash lines; radius calibrated on
    the <70 iris mask near the core."""
    L = lum(im)
    H, W = L.shape
    roi = np.zeros_like(L, dtype=bool)
    roi[int(H * 0.24):int(H * 0.42), :] = True
    core = (L < 50) & roi
    lab, n = label_dark(core)
    out = []
    for half, sgn in ((slice(0, W // 2), 1), (slice(W // 2, W), 1)):
        best, bn = 0, 0
        for i in range(1, n + 1):
            ys, xs = np.nonzero((lab == i))
            xs = xs[(xs >= (0 if half.start == 0 else W // 2)) &
                   (xs < (W // 2 if half.start == 0 else W))]
            if 80 < len(xs) < 15000 and len(xs) > best:
                best, bn = len(xs), i
        assert bn, "no iris core in half"
        ys, xs = np.nonzero(lab == bn)
        xs = xs[(xs >= (0 if half.start == 0 else W // 2)) &
               (xs < (W // 2 if half.start == 0 else W))]
        ys = ys[(lab[ys, xs] == bn)] if False else None
        ys_all, xs_all = np.nonzero(lab == bn)
        keep = (xs_all >= (0 if half.start == 0 else W // 2)) & \
               (xs_all < (W // 2 if half.start == 0 else W))
        ys_all, xs_all = ys_all[keep], xs_all[keep]
        cx, cy = float(xs_all.mean()), float(ys_all.mean())
        # iris r = limbus edge: radius of max outward dark->bright gradient
        # on the radial luminance profile (works on painted + fibre irises).
        yy, xx = np.mgrid[0:H, 0:W]
        rr = np.hypot(xx - cx, yy - cy)
        prof = []
        for rad in range(8, 80):
            band = (rr >= rad - 1) & (rr < rad + 1)
            prof.append(float(L[band].mean()) if band.sum() else 0.0)
        grads = np.diff(prof)
        r = float(np.argmax(grads[7:]) + 7 + 8 + 1)  # offset: rad index
        r = min(max(r, 15.0), 60.0)
        # iris-centre station (matches grade.py): centroid of the <70 iris
        # mask within 1.5r of the core, not the pupil core itself.
        iris_m = (L < 70) & (np.hypot(xx - cx, yy - cy) < 1.5 * r)
        ys_i, xs_i = np.nonzero(iris_m)
        if len(xs_i):
            cx, cy = float(xs_i.mean()), float(ys_i.mean())
        out.append({"cx": cx, "cy": cy, "r": r, "n": int(len(xs_all))})
    out.sort(key=lambda d: d["cx"])  # grade.py convention: L = screen-left
    return out


def eye_metrics(im, c):
    L, S = lum(im), sat(im)
    H, W = L.shape
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx - c["cx"], yy - c["cy"]) / max(c["r"], 1)
    inner = d < 0.7
    ann = (d >= 0.85) & (d < 1.15)
    hot = (L > 230) & (d < 1.3)
    n = int(hot.sum())
    m = {"hotCluster": n, "irisR_px": round(c["r"], 1)}
    if n:
        ys, xs = np.nonzero(hot)
        m["hotOffsetRadii"] = round(float(np.hypot(xs.mean() - c["cx"], ys.mean() - c["cy"]) / max(c["r"], 1)), 2)
        m["hotOffsetPx"] = round(float(np.hypot(xs.mean() - c["cx"], ys.mean() - c["cy"])), 1)
        w = float(xs.max() - xs.min() + 1)
        h = float(ys.max() - ys.min() + 1)
        m["hotRound"] = round(max(w, h) / max(min(w, h), 1), 2)
    m["ringLift"] = round(float(L[ann].mean() - L[inner].mean()), 1)
    m["interiorL"] = round(float(L[inner].mean()), 1)
    m["meansat"] = round(float(S[inner].mean()), 4)
    return m


def band_box(c, im):
    H, W = np.asarray(im).shape[:2]
    hw = int(3.4 * c["r"])
    hh = int(2.6 * c["r"])
    return (max(0, int(c["cx"]) - hw), max(0, int(c["cy"]) - hh),
            min(W, int(c["cx"]) + hw), min(H, int(c["cy"]) + hh))


def bg_frac(im, box):
    a = np.asarray(im.convert("RGB")).astype(float)
    x0, y0, x1, y1 = box
    reg = a[y0:y1, x0:x1]
    d = np.abs(reg - BG).sum(axis=2)
    return round(float((d < 30).sum()) / reg.size, 4)


rep = {}
crops = {}
for tag, d in SETS.items():
    front = Image.open(d / "g6-threejs-front.png")
    ir = find_irises(front)
    eyes = []
    for i, c in enumerate(ir):
        side = "L" if i == 0 else "R"  # image-left/right; consistent across takes
        m = eye_metrics(front, c)
        # parallax: iris centroid shift in yaw takes, in iris radii
        shifts = {}
        for yaw in ("yaw-plus-25", "yaw-minus-25"):
            imy = Image.open(d / f"g6-threejs-{yaw}.png")
            iry = find_irises(imy)
            cc = min(iry, key=lambda q: abs(q["cx"] - c["cx"]))
            dx = float(cc["cx"] - c["cx"])
            shifts[yaw] = {"px": round(dx, 1),
                           "radii": round(dx / max(c["r"], 1), 2)}
        m["parallaxShift"] = shifts
        m["cx"] = round(c["cx"], 1)
        m["cy"] = round(c["cy"], 1)
        eyes.append((side, m, c))
    rep[tag] = {s: m for s, m, _ in eyes}
    # socket probe: bg fraction in union band box, front vs yaw
    boxes = [band_box(c, front) for _, _, c in eyes]
    ux = (min(b[0] for b in boxes), min(b[1] for b in boxes),
          max(b[2] for b in boxes), max(b[3] for b in boxes))
    sock = {"front": bg_frac(front, ux)}
    for yaw in ("yaw-plus-25", "yaw-minus-25"):
        sock[yaw] = bg_frac(Image.open(d / f"g6-threejs-{yaw}.png"), ux)
    rep[tag]["socketBgFrac"] = sock
    # normalized crops (same output size => same framing)
    for (side, m, c), box in zip(eyes, boxes):
        crop = front.crop(box).resize((440, 320))
        crops[(tag, side)] = (crop, m)

print(json.dumps(rep, indent=1))

# ---- composite: rows before/aisha/child x cols L/R ----
ROW_H, COL_W = 320, 440
LAB_H = 96
rows = ["before", "aisha", "child"]
try:
    FONT = ImageFont.load_default(size=20)
except TypeError:
    FONT = ImageFont.load_default()
canvas = Image.new("RGB", (COL_W * 2 + 30, (ROW_H + LAB_H) * 3 + 20), (12, 12, 14))
dr = ImageDraw.Draw(canvas)
y = 10
for tag in rows:
    for j, side in enumerate(("L", "R")):
        crop, m = crops[(tag, side)]
        x = 10 + j * (COL_W + 10)
        canvas.paste(crop, (x, y))
    lab = (f"{tag} eye-band | "
           f"dot hot(>230)={rep[tag]['L']['hotCluster']}/{rep[tag]['R']['hotCluster']} "
           f"round={rep[tag]['L'].get('hotRound', 'absent')}/{rep[tag]['R'].get('hotRound', 'absent')}\n"
           f"ring={rep[tag]['L']['ringLift']}/{rep[tag]['R']['ringLift']} "
           f"sat={rep[tag]['L']['meansat']}/{rep[tag]['R']['meansat']} "
           f"parx(px@25deg)={rep[tag]['L']['parallaxShift']['yaw-plus-25']['px']}/{rep[tag]['R']['parallaxShift']['yaw-plus-25']['px']}")
    dr.text((10, y + ROW_H + 4), lab, fill=(235, 235, 240), font=FONT)
    y += ROW_H + LAB_H
canvas.save(HERE / "geometric-eye-g6-before-after.png")
(HERE / "geometric-eye-g6-before-after.json").write_text(json.dumps(rep, indent=1))
print("wrote geometric-eye-g6-before-after.png")

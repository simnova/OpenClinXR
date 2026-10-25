#!/usr/bin/env python3
"""G6 in-human grade (fixed eye boxes from the known framing).

three.js front 1280 (fov24 portrait): eye boxes L-img (375..595, 330..490),
R-img (685..905, 330..490) by inspection of the capture.
EEVEE eyeband (ortho 130mm @ eye height): eyes at 640+/-303, y 640, iris r 53.
Metrics per eye: iris isolate (dark cluster), hotCluster>230 count/offset/
roundness, limbal ringLift (annulus-vs-interior L*), disc meansat.
Seal: bright show-through px in the eye band, bind vs closure, both harnesses.
Out: eye-band crops + geometric-eye-g6-grade.json
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).parent
TDIR = Path("/tmp/g6three")
EDIR = Path("/tmp/g6eevee")


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


def biggest(lab, n):
    best, bn = 0, 0
    for i in range(1, n + 1):
        s = int((lab == i).sum())
        if s > best:
            best, bn = s, i
    ys, xs = np.nonzero(lab == bn)
    return {"n": best, "cx": float(xs.mean()), "cy": float(ys.mean()),
            "x0": int(xs.min()), "x1": int(xs.max()),
            "y0": int(ys.min()), "y1": int(ys.max())}


def disc_metrics(L, S, cx, cy, r, tag, crop_img, crop_box):
    H, W = L.shape
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx - cx, yy - cy) / r
    inner = d < 0.7
    ann = (d >= 0.85) & (d < 1.15)
    hot = (L > 230) & (d < 1.3)
    n = int(hot.sum())
    m = {"hotCluster": n}
    if n:
        ys, xs = np.nonzero(hot)
        m["hotCentroid"] = [round(float(xs.mean()), 1), round(float(ys.mean()), 1)]
        m["hotOffsetRadii"] = round(float(np.hypot(xs.mean() - cx, ys.mean() - cy) / r), 2)
        w = float(xs.max() - xs.min() + 1)
        h = float(ys.max() - ys.min() + 1)
        m["hotRound"] = round(max(w, h) / max(min(w, h), 1), 2)
    m["ringLift"] = round(float(L[ann].mean() - L[inner].mean()), 1)
    m["interiorL"] = round(float(L[inner].mean()), 1)
    m["meansat"] = round(float(S[inner].mean()), 4)
    m.update({"irisCx": round(cx, 1), "irisCy": round(cy, 1), "irisR": round(r, 1)})
    crop_img.crop(crop_box).save(HERE / f"geometric-eye-g6-{tag}.png")
    return m


grade = {"threejs": {}, "eevee": {}}

im = Image.open(TDIR / "g6-threejs-front.png")
L, S = lum(im), sat(im)
for side, (x0, x1) in (("imgL", (375, 595)), ("imgR", (685, 905))):
    box = L[330:490, x0:x1]
    lab, n = label_dark(box < 70)
    c = biggest(lab, n)
    cx, cy = x0 + c["cx"], 330 + c["cy"]
    r = max(c["x1"] - c["x0"], c["y1"] - c["y0"]) / 2
    grade["threejs"][side] = disc_metrics(
        L, S, cx, cy, r, f"threejs-eyeband-{side}", im,
        (int(cx - 110), int(cy - 80), int(cx + 110), int(cy + 80)))

im = Image.open(EDIR / "geometric-eye-g6-eevee-eyeband-bind.png")
L, S = lum(im), sat(im)
H, W = L.shape
for side, ex in (("imgL", 337), ("imgR", 943)):
    grade["eevee"][side] = disc_metrics(
        L, S, ex, H / 2, 53, f"eevee-eyeband-{side}", im,
        (ex - 130, int(H / 2) - 100, ex + 130, int(H / 2) + 100))

seal = {}
bands = {"threejs-bind": (TDIR / "g6-threejs-front.png", (375, 685 - 375 + 220, 330, 490)),
         "threejs-closure": (TDIR / "g6-threejs-blink.png", (375, 375 + 530, 330, 490)),
         "eevee-bind": (EDIR / "geometric-eye-g6-eevee-eyeband-bind.png", None),
         "eevee-closure": (EDIR / "geometric-eye-g6-eevee-eyeband-closure.png", None)}
for tag, (path, fr) in bands.items():
    im = Image.open(path)
    G = lum(im)
    if fr:
        region = np.zeros_like(G, dtype=bool)
        region[fr[2]:fr[3], fr[0]:fr[1]] = True
    else:
        region = np.ones_like(G, dtype=bool)
    seal[tag] = {"bright230": int(((G > 230) & region).sum()),
                 "bright200": int(((G > 200) & region).sum()),
                 "regionPx": int(region.sum())}
grade["seal"] = seal
(HERE / "geometric-eye-g6-grade.json").write_text(json.dumps(grade, indent=1))
print(json.dumps(grade, indent=1))

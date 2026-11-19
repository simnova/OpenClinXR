#!/usr/bin/env python3
"""Headless parity judge: three.js runtime capture vs Blender Cycles reference.

CLI: compare.py --ref <p1a dir> --cand <dir> --out <dir> [--cams a,b] [--label name]
Exit 2 (refusal) on missing file or size mismatch.
"""
import argparse
import hashlib
import json
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

COLORS = {
    "skin": (255, 0, 0),
    "eyes": (0, 255, 0),
    "clothing": (0, 0, 255),
    "hair": (255, 255, 0),
    "teeth": (255, 0, 255),
}
GRADED = ("skin", "eyes", "clothing")
COUNT_ONLY = ("hair", "teeth")
EYE_SUB = ("iris", "sclera", "catchlights", "lid_ring")
EYE_RING_R = 15  # px: the ring p2j/ring-check.py used (binary_dilation iterations=15)
IRIS_C_MIN = 12.0  # chroma floor; mirrors eye_detail.py SCLERA_C_MAX (sclera = C* < 12)
DE_MAX = 20.0  # heatmap range dE 0..20
BG_DE_TOL = 3.0  # silhouette background tolerance


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fail(msg):
    print(f"compare: REFUSED: {msg}", file=sys.stderr)
    return 2


def load_rgb(path):
    return np.array(Image.open(path).convert("RGB"))


def region_masks(mask_rgb):
    # Nearest palette colour (incl. black bg) within 60: P1a masks carry 254/255 blends inside regions; exact match kept ~10% after erosion.
    pal = np.array([(0, 0, 0)] + list(COLORS.values()), dtype=np.int32); d = np.abs(mask_rgb.astype(np.int32)[..., None, :] - pal).sum(-1)
    idx, ok = d.argmin(-1), d.min(-1) < 60
    return {name: ok & (idx == i + 1) for i, name in enumerate(COLORS)}


def erode2(m):
    from scipy.ndimage import binary_erosion

    if not m.any():
        return m
    return binary_erosion(m, iterations=2)


def dilateR(m, r=EYE_RING_R):
    from scipy.ndimage import binary_dilation

    if not m.any():
        return m
    return binary_dilation(m, iterations=r)


def eye_sub_masks(ref_u8, mask_rgb):
    """Four DISJOINT eye sub-masks from ref beauty + ref mask ONLY (never the candidate).

    Rules (CIELAB D65 via skimage rgb2lab; L* = lab[...,0], C* = hypot(a*,b*)):
      eye         = (ref mask class == (0,255,0))          # compare.COLORS['eyes']
      p99         = numpy.percentile(L*[eye], 99)          # per cam, from ref eye pixels
      catchlights = eye & (L* > p99)
      iris        = eye & (C* >= 12) & (L* <= p99)         # chromatic iris tissue
      sclera      = eye & ~(iris | catchlights)           # pupil stays here; excludes nothing else
      lid_ring    = dilate(eye, R=15) & ~eye              # OUTSIDE the aperture; excludes nothing else
    """
    masks = region_masks(mask_rgb)
    eye = masks["eyes"]
    ref_lab = lab_of(ref_u8)
    L = ref_lab[..., 0]
    C = np.hypot(ref_lab[..., 1], ref_lab[..., 2])
    p99 = float(np.percentile(L[eye], 99)) if eye.any() else 0.0
    catchlights = eye & (L > p99)
    iris = eye & (C >= IRIS_C_MIN) & (L <= p99)
    sclera = eye & ~iris & ~catchlights
    lid_ring = dilateR(eye) & ~eye
    sub = {"iris": iris, "sclera": sclera,
           "catchlights": catchlights, "lid_ring": lid_ring}
    names = list(sub)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = sub[names[i]], sub[names[j]]
            assert int((a & b).sum()) == 0, \
                f"eye sub-masks overlap: {names[i]} & {names[j]}"
    return sub, p99


def eye_sides(eye):
    h, w = eye.shape
    ys, xs = np.mgrid[0:h, 0:w]
    cx = float(xs[eye].mean()) if eye.any() else w / 2.0
    return (xs < cx), (xs >= cx), cx


def lab_of(u8):
    from skimage.color import rgb2lab

    return rgb2lab(u8.astype(np.float64) / 255.0)


def de00(lab1, lab2):
    from skimage.color import deltaE_ciede2000

    return deltaE_ciede2000(lab1, lab2)


def ssim_full(l1, l2):
    from skimage.metrics import structural_similarity

    score, smap = structural_similarity(
        l1, l2, data_range=100.0, win_size=7, full=True
    )
    return score, smap


def snap1(x):
    # float-noise snap so bit-identical inputs report exactly 1.0
    return 1.0 if abs(float(x) - 1.0) < 1e-9 else float(x)


def hp_std(L, mask):
    from skimage.filters import gaussian

    hp = L - gaussian(L, sigma=2.0, preserve_range=True)
    vals = hp[mask]
    return float(vals.std()) if vals.size else 0.0


def heatmap(de):
    import matplotlib.cm as cm

    lut = (np.array(cm.turbo(np.linspace(0, 1, 1024)))[:, :3] * 255).astype(np.uint8)
    idx = np.clip((de / DE_MAX * 1023).round(), 0, 1023).astype(np.int64)
    return lut[idx]


def draw_colorbar(panel):
    img = Image.fromarray(panel)
    d = ImageDraw.Draw(img)
    W, H = img.size
    bw, bh, pad = 420, 22, 16
    x0, y0 = W - bw - pad, H - bh - pad - 14
    import matplotlib.cm as cm

    lut = (np.array(cm.turbo(np.linspace(0, 1, bw)))[:, :3] * 255).astype(np.uint8)
    bar = Image.fromarray(np.tile(lut[None, :, :], (bh, 1, 1)))
    img.paste(bar, (x0, y0))
    d.rectangle([x0, y0, x0 + bw - 1, y0 + bh - 1], outline=(255, 255, 255))
    d.text((x0, y0 + bh + 1), "dE00 0", fill=(255, 255, 255))
    d.text((x0 + bw - 14, y0 + bh + 1), "20", fill=(255, 255, 255))
    return np.array(img)


def bg_median_lab(ref_u8):
    b = 5
    ring = np.concatenate(
        [ref_u8[:b].reshape(-1, 3), ref_u8[-b:].reshape(-1, 3),
         ref_u8[:, :b].reshape(-1, 3), ref_u8[:, -b:].reshape(-1, 3)]
    )
    med = np.median(ring, axis=0).round().astype(np.uint8)[None, None, :]
    return lab_of(med)[0, 0]


def compare_cam(cam, ref_beauty_p, ref_mask_p, cand_p):
    from skimage.filters import gaussian  # noqa: F401 (import check)
    t0 = time.perf_counter()
    for p in (ref_beauty_p, ref_mask_p, cand_p):
        if not os.path.isfile(p):
            return None, f"missing file: {p}"
    ref_u8 = load_rgb(ref_beauty_p)
    mask_u8 = load_rgb(ref_mask_p)
    cand_u8 = load_rgb(cand_p)
    if cand_u8.shape != ref_u8.shape:
        return None, (
            f"size mismatch on {cam}: ref {ref_u8.shape[1]}x{ref_u8.shape[0]} "
            f"vs cand {cand_u8.shape[1]}x{cand_u8.shape[0]}"
        )
    if mask_u8.shape != ref_u8.shape:
        return None, f"size mismatch on {cam}: mask vs beauty"

    masks = region_masks(mask_u8)
    ref_lab = lab_of(ref_u8)
    cand_lab = lab_of(cand_u8)
    Lr, Lc = ref_lab[..., 0], cand_lab[..., 0]
    full_de = de00(ref_lab, cand_lab)
    whole_ssim, ssim_map = ssim_full(Lr, Lc)

    regions = {}
    for name in GRADED:
        m = erode2(masks[name])
        n = int(m.sum())
        if n == 0:
            regions[name] = {"n_pixels": 0}
            continue
        d = full_de[m]
        rl = ref_lab[m].mean(axis=0)
        cl = cand_lab[m].mean(axis=0)
        diff = cl - rl
        rs, cs = hp_std(Lr, m), hp_std(Lc, m)
        regions[name] = {
            "n_pixels": n,
            "mean_dE": float(d.mean()),
            "p95_dE": float(np.percentile(d, 95)),
            "ref_mean_Lab": [float(v) for v in rl],
            "cand_mean_Lab": [float(v) for v in cl],
            "dL": float(diff[0]),
            "da": float(diff[1]),
            "db": float(diff[2]),
            "ssim": snap1(float(ssim_map[m].mean())),
            "detail_ref_std": rs,
            "detail_cand_std": cs,
            "detail_ratio": 1.0 if rs <= 1e-12 and cs <= 1e-12
            else (float(cs / rs) if rs > 1e-12 else float("inf")),
        }
    sub, eye_p99 = eye_sub_masks(ref_u8, mask_u8)
    Lsel, Rsel, eye_cx = eye_sides(masks["eyes"])
    for name in EYE_SUB:
        m = sub[name]
        n = int(m.sum())
        if n == 0:
            regions[name] = {"n_pixels": 0, "n_L": 0, "n_R": 0,
                             "eye_p99_Lstar": eye_p99, "eye_cx": eye_cx}
            continue
        d = full_de[m]
        rl = ref_lab[m].mean(axis=0)
        cl = cand_lab[m].mean(axis=0)
        diff = cl - rl
        rs, cs = hp_std(Lr, m), hp_std(Lc, m)
        regions[name] = {
            "n_pixels": n,
            "n_L": int((m & Lsel).sum()),
            "n_R": int((m & Rsel).sum()),
            "eye_p99_Lstar": eye_p99,
            "eye_cx": eye_cx,
            "mean_dE": float(d.mean()),
            "p95_dE": float(np.percentile(d, 95)),
            "ref_mean_Lab": [float(v) for v in rl],
            "cand_mean_Lab": [float(v) for v in cl],
            "dL": float(diff[0]),
            "da": float(diff[1]),
            "db": float(diff[2]),
            "ssim": snap1(float(ssim_map[m].mean())),
            "detail_ref_std": rs,
            "detail_cand_std": cs,
            "detail_ratio": 1.0 if rs <= 1e-12 and cs <= 1e-12
            else (float(cs / rs) if rs > 1e-12 else float("inf")),
        }
    print(f"compare eye-sub {cam}: " + " ".join(
        f"{n}={regions[n]['n_pixels']}(L{regions[n].get('n_L',0)}/R{regions[n].get('n_R',0)})"
        for n in EYE_SUB))
    counts = {n: int(masks[n].sum()) for n in COUNT_ONLY}

    # silhouette IoU (registration hint only)
    bg_lab = bg_median_lab(ref_u8)
    cand_bg = de00(cand_lab,
                   np.broadcast_to(bg_lab, cand_lab.shape)) <= BG_DE_TOL
    ref_fg = np.any(mask_u8 != 0, axis=-1)
    cand_fg = ~cand_bg
    inter = np.logical_and(ref_fg, cand_fg).sum()
    union = np.logical_or(ref_fg, cand_fg).sum()
    iou = float(inter / union) if union else 1.0

    sheet = np.concatenate(
        [ref_u8, cand_u8, draw_colorbar(heatmap(full_de))], axis=1
    )
    wall = time.perf_counter() - t0
    return {
        "regions": regions,
        "counts": counts,
        "whole": {"ssim": snap1(whole_ssim), "silhouette_iou": iou},
        "width": ref_u8.shape[1],
        "height": ref_u8.shape[0],
        "wall_seconds": wall,
        "_sheet": sheet,
    }, None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True)
    ap.add_argument("--cand", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cams", default=None)
    ap.add_argument("--label", default=None)
    a = ap.parse_args(argv)

    try:
        with open(os.path.join(a.ref, "cameras.json")) as f:
            caminfo = json.load(f)
        known = [c["name"] for c in caminfo["cameras"]]
    except (OSError, KeyError, json.JSONDecodeError) as e:
        return fail(f"cannot read ref cameras.json: {e}")
    cams = a.cams.split(",") if a.cams else known
    for c in cams:
        if c not in known:
            return fail(f"unknown cam '{c}' (known: {','.join(known)})")
    label = a.label or os.path.basename(os.path.normpath(a.cand))
    os.makedirs(a.out, exist_ok=True)

    out = {
        "label": label, "ref": a.ref, "cand": a.cand,
        "files": {}, "cameras": {},
    }
    sheets = {}
    for cam in cams:
        rb = os.path.join(a.ref, "beauty", f"{cam}.png")
        rm = os.path.join(a.ref, "masks", f"{cam}.png")
        cp = os.path.join(a.cand, f"{cam}.png")
        res, err = compare_cam(cam, rb, rm, cp)
        if err:
            return fail(err)
        out["files"][cam] = {
            "ref_beauty_sha256": sha256(rb),
            "ref_mask_sha256": sha256(rm),
            "cand_sha256": sha256(cp),
        }
        sheets[cam] = res.pop("_sheet")
        out["cameras"][cam] = res

    with open(os.path.join(a.out, "metrics.json"), "w") as f:
        json.dump(out, f, indent=1)
    for cam, sheet in sheets.items():
        Image.fromarray(sheet).save(os.path.join(a.out, f"{cam}-sheet.png"))

    hdr = "| cam | region | n | mean dE | p95 dE | dL | SSIM | detail |"
    sep = "| --- | --- | --- | --- | --- | --- | --- | --- |"
    lines = [f"# parity {label}", "", hdr, sep]
    for cam in cams:
        for name in list(GRADED) + list(EYE_SUB):
            r = out["cameras"][cam]["regions"][name]
            if r.get("n_pixels", 0) == 0:
                lines.append(f"| {cam} | {name} | EMPTY | - | - | - | - | - |")
            else:
                lines.append(
                    f"| {cam} | {name} | {r['n_pixels']} | {r['mean_dE']:.3f} | "
                    f"{r['p95_dE']:.3f} | "
                    f"{r['dL']:+.3f} | {r['ssim']:.4f} | "
                    f"{r['detail_ratio']:.3f} |"
                )
        w = out["cameras"][cam]["whole"]
        lines.append(
            f"| {cam} | whole | - | - | - | - | {w['ssim']:.4f} | "
            f"IoU {w['silhouette_iou']:.4f} |"
        )
    lines += ["", "eye sub-mask counts per eye (ref-derived):"]
    for cam in cams:
        parts = []
        for name in EYE_SUB:
            r = out["cameras"][cam]["regions"][name]
            parts.append(f"{name}={r.get('n_pixels', 0)}"
                         f"(L{r.get('n_L', 0)}/R{r.get('n_R', 0)})")
        lines.append(f"- {cam}: " + " ".join(parts))
    with open(os.path.join(a.out, "summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"compare: wrote {a.out} ({len(cams)} cams)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

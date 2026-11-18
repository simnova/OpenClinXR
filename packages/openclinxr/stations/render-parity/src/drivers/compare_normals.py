#!/usr/bin/env python3
"""G-probe compare: world-normal passes Blender vs three.js, per P1a region.

Blender: RGBA PNG16, RGB = worldN(Blender frame)*0.5+0.5 sRGB-encoded,
  alpha = coverage. three: RGB PNG8, RGB = worldN(three frame)*0.5+0.5
  sRGB-encoded, background = flat clear colour (modal pixel).
Blender normals are rotated into the three frame with C_T from
blender_reference.py, then per-pixel angular difference (degrees) is reported
per region (P1a masks) + overall, with valid-masks IoU and a heatmap sheet.

Usage:
  python3 -I compare_normals.py --blender <dir> --three <dir>
    --masks <p1a masks dir> --cams body_front,head_front --out <dir>
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, "/Volumes/files/src/wt/aisha-parity-p3/tools/openclinxr/evidence/aisha-parity")
from compare import region_masks  # noqa: E402  (read-only reuse, never copied)

C_T = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])

COLOR_BG_TOL = 12.0  # u8 distance from modal bg colour -> foreground


def srgb_inv(u):
    u = np.asarray(u, dtype=np.float64)
    return np.where(u <= 0.04045, u / 12.92, ((u + 0.055) / 1.055) ** 2.4)


def load_blender(p):
    im = Image.open(p)
    a = np.array(im)
    if a.ndim != 3 or a.shape[2] < 4:
        raise SystemExit("REFUSE: %s has no alpha" % p)
    scale = 65535.0 if a.dtype == np.uint16 else 255.0
    rgb = a[..., :3].astype(np.float64) / scale
    alpha = a[..., 3].astype(np.float64) / scale
    n = srgb_inv(np.clip(rgb, 0, 1)) * 2.0 - 1.0
    n = n @ C_T.T  # Blender frame -> three frame
    ln = np.linalg.norm(n, axis=-1, keepdims=True)
    return n / np.maximum(ln, 1e-9), alpha, ln[..., 0]


def load_three(p):
    rgb = np.array(Image.open(p).convert("RGB")).astype(np.float64)
    flat = rgb.reshape(-1, 3)
    cols, counts = np.unique(flat, axis=0, return_counts=True)
    bg = cols[counts.argmax()].astype(np.float64)
    d = np.abs(rgb - bg).sum(-1)
    n = srgb_inv(np.clip(rgb / 255.0, 0, 1)) * 2.0 - 1.0
    ln = np.linalg.norm(n, axis=-1)
    n = n / np.maximum(ln, 1e-9)[..., None]
    return n, d > COLOR_BG_TOL, ln, bg


def ang_deg(a, b):
    return np.degrees(np.arccos(np.clip((a * b).sum(-1), -1, 1)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blender", required=True)
    ap.add_argument("--three", required=True)
    ap.add_argument("--masks", required=True)
    ap.add_argument("--cams", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cams = [c.strip() for c in a.cams.split(",") if c.strip()]
    summary = {}
    for cam in cams:
        nb, ab, lblen = load_blender(Path(a.blender) / ("%s.normal.png" % cam))
        nt, validt, ltlen, bg = load_three(Path(a.three) / ("%s.normal.png" % cam))
        if nb.shape[:2] != nt.shape[:2]:
            raise SystemExit("REFUSE: shape mismatch %s" % cam)
        mask = np.array(Image.open(Path(a.masks) / ("%s.png" % cam)).convert("RGB"))
        regs = region_masks(mask)
        validb = ab > 0.5
        valid = validb & validt
        ang = ang_deg(nb, nt)
        row = {
            "bg_three_u8": [float(v) for v in bg],
            "frac_valid_blender": float(validb.mean()),
            "frac_valid_three": float(validt.mean()),
            "mask_iou": float((validb & validt).sum() / max(1, (validb | validt).sum())),
            "regions": {},
        }
        h, w = valid.shape
        sheet = np.zeros((h, w, 3), dtype=np.uint8)
        for name, m in regs.items():
            sel = valid & m
            n = int(sel.sum())
            if n == 0:
                row["regions"][name] = {"n": 0}
                continue
            v = ang[sel]
            row["regions"][name] = {
                "n": n,
                "mean_deg": float(v.mean()),
                "median_deg": float(np.median(v)),
                "p95_deg": float(np.percentile(v, 95)),
                "frac_gt2deg": float((v > 2.0).mean()),
            }
            lut = np.clip(v / 10.0 * 255, 0, 255).astype(np.uint8)
            sheet[sel] = np.stack([lut, 255 - lut // 2, np.zeros_like(lut)], -1)
        allv = ang[valid]
        row["overall"] = {
            "n": int(valid.sum()),
            "mean_deg": float(allv.mean()),
            "median_deg": float(np.median(allv)),
            "p95_deg": float(np.percentile(allv, 95)),
            "frac_gt2deg": float((allv > 2.0).mean()),
        }
        row["blender_unit_dev"] = float(np.abs(lblen[validb] - 1).mean())
        row["three_unit_dev"] = float(np.abs(ltlen[validt] - 1).mean())
        summary[cam] = row
        Image.fromarray(sheet).save(out / ("%s-heat.png" % cam))
        print("[norm] %s overall mean=%.3f med=%.3f p95=%.3f iou=%.4f bg=%s" % (
            cam, row["overall"]["mean_deg"], row["overall"]["median_deg"],
            row["overall"]["p95_deg"], row["mask_iou"], bg.astype(int).tolist()), flush=True)
        for name, r in row["regions"].items():
            if r.get("n"):
                print("    %-8s n=%7d mean=%6.3f med=%6.3f p95=%6.3f >2deg=%.3f" % (
                    name, r["n"], r["mean_deg"], r["median_deg"], r["p95_deg"], r["frac_gt2deg"]), flush=True)
    (out / "normals.json").write_text(json.dumps(summary, indent=2) + "\n")
    print("[norm] WROTE %s/normals.json" % out, flush=True)


main()

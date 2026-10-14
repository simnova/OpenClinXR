"""Build roughness map: 0.62 - Tc*T + 0.08*C + 0.05*H clipped [0.3, 0.8], lips 0.45.

Ported from S/shade/build_roughness.py for the face-replay hand-steps chain.
Parameters: tcoef=0.08, lips=0.45 per S/shade/RESULT.md.

T-zone: the scratch script projected UV texels into MediaPipe gate polygons
(forehead/nose/chin). Those polygons are subject-constant landmark boxes, so
the port builds the T-zone from DERIVED landmarks instead (landmarks-uv.json,
row=v*S): disks at the nose-tip and chin landmarks plus a forehead centre
derived from the brow-end-inner landmarks, gated by the derived facecore
mask, then the same dilate-5 / blur-12 softening as the scratch script.
Disk radii are fractions of the map size (no subject constants).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Disk radii as fractions of map size S (same for every subject).
R_NOSE = 0.035
R_CHIN = 0.030
R_FOREHEAD = 0.055
# Forehead centre = brow-mid pushed past the brows away from the nose by
# this fraction of the brow-mid-to-nose distance; fallback (no brow mesh)
# reflects the chin across the nose by this fraction of nose-to-chin.
FOREHEAD_PUSH = 0.5
FOREHEAD_FALLBACK = 0.65


def lab_of(rgb: np.ndarray) -> np.ndarray:
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0).astype(np.float32)


def disk(shape, col, row, radius):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return ((xx - col) ** 2 + (yy - row) ** 2) <= radius ** 2


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--albedo", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ao", type=Path, required=True)
    ap.add_argument("--lip-uv", type=Path, required=True)
    ap.add_argument("--landmarks", type=Path, required=True)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--tcoef", type=float, default=0.08)
    a = ap.parse_args(argv)

    alb = np.array(Image.open(a.albedo).convert("RGB"))
    S = alb.shape[0]
    assert alb.shape == (S, S, 3), alb.shape

    ao_img = Image.open(a.ao).convert("L")
    if ao_img.size != (S, S):
        ao_img = ao_img.resize((S, S), Image.BILINEAR)
    ao = np.array(ao_img).astype(np.float32) / 255.0
    C = np.clip(1.0 - ao, 0, 1)

    Lalb = lab_of(alb)[..., 0].astype(np.float32)
    fine = Lalb - cv2.GaussianBlur(Lalb, (0, 0), 3)
    p99 = float(np.percentile(np.abs(fine), 99))
    H = np.clip(0.5 + fine / (2 * max(p99, 1e-6)), 0, 1)
    print(f"H norm p99={p99:.3f}", flush=True)

    lm = json.loads(a.landmarks.read_text())
    assert lm.get("row") == "v*S", "landmarks must be row=v*S convention"
    sc = S / float(lm["size"])
    pts = {k: (float(v["uv_texel"][0]) * sc, float(v["uv_texel"][1]) * sc)
           for k, v in lm["landmarks"].items()}
    # uv_texel = [u*S, v*S] -> image (col=u*S, row=v*S).
    nose = pts["nose-tip"]
    chin = pts["chin"]
    inners = [pts[k] for k in ("brow-end-L-inner", "brow-end-R-inner")
              if k in pts]
    if len(inners) == 2:
        brow_mid = ((inners[0][0] + inners[1][0]) / 2,
                    (inners[0][1] + inners[1][1]) / 2)
        forehead = (brow_mid[0] + (brow_mid[0] - nose[0]) * FOREHEAD_PUSH,
                    brow_mid[1] + (brow_mid[1] - nose[1]) * FOREHEAD_PUSH)
        how = "brow-end-inner mid pushed past brows"
    else:
        forehead = (nose[0] + (nose[0] - chin[0]) * FOREHEAD_FALLBACK,
                    nose[1] + (nose[1] - chin[1]) * FOREHEAD_FALLBACK)
        how = "FALLBACK nose reflected past chin (no brow landmarks)"
    print(f"T centres nose={nose} chin={chin} forehead={forehead} ({how})",
          flush=True)

    T = np.zeros((S, S), np.float32)
    T[disk((S, S), nose[0], nose[1], R_NOSE * S)] = 1.0
    T[disk((S, S), chin[0], chin[1], R_CHIN * S)] = 1.0
    T[disk((S, S), forehead[0], forehead[1], R_FOREHEAD * S)] = 1.0
    facecore = np.array(Image.open(a.facecore_mask).convert("L"))
    if facecore.shape != (S, S):
        facecore = np.array(Image.fromarray(facecore).resize(
            (S, S), Image.BILINEAR))
    gate = cv2.dilate(((facecore > 0).astype(np.uint8)),
                      np.ones((15, 15), np.uint8))
    T = T * gate
    assert float(T.max()) > 0, "T-zone empty after facecore gate"
    T = cv2.dilate(T, np.ones((5, 5), np.uint8))
    T = cv2.GaussianBlur(T, (0, 0), 12)
    print(f"T peak={float(T.max()):.3f} frac>0.5={float((T > 0.5).mean()):.4f}",
          flush=True)

    rough = 0.62 - float(a.tcoef) * T + 0.08 * C + 0.05 * H
    rough = np.clip(rough, 0.3, 0.8)
    zl = np.load(a.lip_uv)
    core = np.maximum(np.maximum(zl["up"] > 0, zl["hard_up"] > 0),
                      np.maximum(zl["lo"] > 0, zl["hard_lo"] > 0)).astype(np.float32)
    if core.shape != (S, S):
        core = np.array(Image.fromarray((core * 255).astype(np.uint8)).resize(
            (S, S), Image.NEAREST)).astype(np.float32) / 255.0
    feather = cv2.GaussianBlur(core, (0, 0), 6)[..., None]
    rough = (feather[..., 0] * 0.45 + (1 - feather[..., 0]) * rough)
    print(f"rough stats: mean={float(rough.mean()):.3f} "
          f"T-zone={float(rough[T > 0.5].mean()):.3f} "
          f"cheek-open~{float(rough[S // 2, S // 2]):.3f}", flush=True)
    Image.fromarray(np.round(rough * 255).astype(np.uint8)).save(a.out)
    print(f"wrote {a.out} tcoef={a.tcoef}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

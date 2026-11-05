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


def build_t_zone(landmarks: dict, facecore: np.ndarray,
                 size: int) -> tuple[np.ndarray, dict[str, list[float]]]:
    """Build the landmark-driven T-zone without reading files."""
    assert landmarks.get("row") == "v*S", "landmarks must be row=v*S convention"
    sc = size / float(landmarks["size"])
    pts = {
        key: (float(value["uv_texel"][0]) * sc,
              float(value["uv_texel"][1]) * sc)
        for key, value in landmarks["landmarks"].items()
    }
    nose = pts["nose-tip"]
    chin = pts["chin"]
    inners = [pts[key] for key in ("brow-end-L-inner", "brow-end-R-inner")
              if key in pts]
    if len(inners) == 2:
        brow_mid = ((inners[0][0] + inners[1][0]) / 2,
                    (inners[0][1] + inners[1][1]) / 2)
        forehead = (brow_mid[0] + (brow_mid[0] - nose[0]) * FOREHEAD_PUSH,
                    brow_mid[1] + (brow_mid[1] - nose[1]) * FOREHEAD_PUSH)
    else:
        forehead = (nose[0] + (nose[0] - chin[0]) * FOREHEAD_FALLBACK,
                    nose[1] + (nose[1] - chin[1]) * FOREHEAD_FALLBACK)

    t_zone = np.zeros((size, size), np.float32)
    t_zone[disk((size, size), nose[0], nose[1], R_NOSE * size)] = 1.0
    t_zone[disk((size, size), chin[0], chin[1], R_CHIN * size)] = 1.0
    t_zone[disk((size, size), forehead[0], forehead[1], R_FOREHEAD * size)] = 1.0
    gate = cv2.dilate((facecore > 0).astype(np.uint8),
                      np.ones((15, 15), np.uint8))
    t_zone *= gate
    assert float(t_zone.max()) > 0, "T-zone empty after facecore gate"
    t_zone = cv2.dilate(t_zone, np.ones((5, 5), np.uint8))
    t_zone = cv2.GaussianBlur(t_zone, (0, 0), 12)
    return t_zone, {
        "nose": [float(nose[0]), float(nose[1])],
        "chin": [float(chin[0]), float(chin[1])],
        "forehead": [float(forehead[0]), float(forehead[1])],
    }


def relative_t_zone_offset(t_zone: np.ndarray,
                           tcoef: float = 0.08) -> np.ndarray:
    """Return ROUGH's T-zone contribution relative to its T=0 base."""
    return -float(tcoef) * t_zone.astype(np.float32)


def apply_lip_roughness(roughness: np.ndarray, lip_core: np.ndarray,
                        lip_value: float = 0.45) -> np.ndarray:
    """Apply ROUGH's existing soft lip treatment to an arbitrary baseline."""
    lip_hard = lip_core > 0.5
    feather = cv2.GaussianBlur(lip_hard.astype(np.float32), (0, 0), 6)
    result = feather * float(lip_value) + (1 - feather) * roughness
    result[lip_hard] = float(lip_value)
    return result


def build_roughness_map(albedo: np.ndarray, ao: np.ndarray, landmarks: dict,
                        facecore: np.ndarray, lip_core: np.ndarray,
                        tcoef: float = 0.08) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Build roughness and measurement masks from in-memory derived inputs."""
    size = albedo.shape[0]
    assert albedo.shape == (size, size, 3), albedo.shape
    assert ao.shape == (size, size), ao.shape
    assert facecore.shape == (size, size), facecore.shape
    assert lip_core.shape == (size, size), lip_core.shape

    cavity = np.clip(1.0 - ao.astype(np.float32), 0, 1)
    lightness = lab_of(albedo)[..., 0].astype(np.float32)
    fine = lightness - cv2.GaussianBlur(lightness, (0, 0), 3)
    p99 = float(np.percentile(np.abs(fine), 99))
    high = np.clip(0.5 + fine / (2 * max(p99, 1e-6)), 0, 1)
    t_zone, centres = build_t_zone(landmarks, facecore, size)
    roughness = np.clip(0.62 + relative_t_zone_offset(t_zone, tcoef)
                        + 0.08 * cavity + 0.05 * high, 0.3, 0.8)

    lip_hard = lip_core > 0.5
    roughness = apply_lip_roughness(roughness, lip_core)
    cheek_open = ((facecore > 0) & (t_zone < 0.05) & ~lip_hard)
    cheek_open = cv2.erode(cheek_open.astype(np.uint8),
                           np.ones((9, 9), np.uint8)) > 0
    return roughness, {
        "t_zone": t_zone,
        "cheek_open": cheek_open,
        "lips": lip_hard,
        "centres": centres,
        "high": high,
        "cavity": cavity,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--albedo", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--ao", type=Path, required=True)
    lip_group = ap.add_mutually_exclusive_group(required=True)
    lip_group.add_argument("--lip-uv", type=Path)
    lip_group.add_argument("--lip-mask", type=Path)
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

    facecore = np.array(Image.open(a.facecore_mask).convert("L"))
    if facecore.shape != (S, S):
        facecore = np.array(Image.fromarray(facecore).resize(
            (S, S), Image.BILINEAR))
    lm = json.loads(a.landmarks.read_text())
    if a.lip_mask:
        lip_img = Image.open(a.lip_mask).convert("L")
        if lip_img.size != (S, S):
            lip_img = lip_img.resize((S, S), Image.NEAREST)
        lip_core = np.asarray(lip_img, dtype=np.float32) / 255.0
    else:
        zl = np.load(a.lip_uv)
        lip_core = np.maximum(
            np.maximum(zl["up"] > 0, zl["hard_up"] > 0),
            np.maximum(zl["lo"] > 0, zl["hard_lo"] > 0),
        ).astype(np.float32)
        if lip_core.shape != (S, S):
            lip_core = np.asarray(Image.fromarray(
                (lip_core * 255).astype(np.uint8)).resize((S, S), Image.NEAREST),
                dtype=np.float32) / 255.0
    rough, masks = build_roughness_map(
        alb, ao, lm, facecore, lip_core, tcoef=float(a.tcoef),
    )
    T = masks["t_zone"]
    centres = masks["centres"]
    print(f"T centres {centres}", flush=True)
    print(f"T peak={float(T.max()):.3f} frac>0.5={float((T > 0.5).mean()):.4f}",
          flush=True)
    print(f"rough stats: mean={float(rough.mean()):.3f} "
           f"T-zone={float(rough[T > 0.5].mean()):.3f} "
           f"cheek-open={float(rough[masks['cheek_open']].mean()):.3f} "
           f"lips={float(rough[masks['lips']].mean()):.3f}", flush=True)
    Image.fromarray(np.round(rough * 255).astype(np.uint8)).save(a.out)
    print(f"wrote {a.out} tcoef={a.tcoef}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

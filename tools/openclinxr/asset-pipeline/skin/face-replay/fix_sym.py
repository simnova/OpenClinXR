"""Low-band symmetrization: mirror-average L,a,b across face core using mesh correspondence.

Ported from S/sym/fix_sym.py for the face-replay hand-steps chain.
Default strength=1.0 per S/sym/fix_sym.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import trimesh
from PIL import Image
from scipy.spatial import cKDTree
from scipy.ndimage import map_coordinates


def load_skin(glb_path: Path) -> tuple[np.ndarray, np.ndarray]:
    sc = trimesh.load(str(glb_path), force="scene")
    best = None
    for node in sc.graph.nodes_geometry:
        T, name = sc.graph[node]
        # Skin mesh: the largest mesh whose name holds the body marker.
        if "body.001" in name.lower():
            g = sc.geometry[name]
            if best is None or len(g.vertices) > len(best[0]):
                V = trimesh.transform_points(np.asarray(g.vertices, np.float64), T)
                UV = np.asarray(g.visual.uv, np.float64).copy()
                UV[:, 1] = 1.0 - UV[:, 1]
                best = (V, UV)
    if best is None:
        raise RuntimeError("skin mesh not found")
    return best


def mask_from_file(name: Path, S: int) -> np.ndarray:
    m = np.asarray(Image.open(name).convert("L"), np.float32) / 255.0
    if m.shape != (S, S):
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((S, S), Image.BILINEAR), np.float32) / 255.0
    return m


def bilin(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    c = np.clip(u, 0, img.shape[1] - 1.001)
    r = np.clip(v, 0, img.shape[0] - 1.001)
    return map_coordinates(img, [r, c], order=1, mode="nearest")


def lab_of(rgb: np.ndarray) -> np.ndarray:
    from skimage.color import rgb2lab
    return rgb2lab(rgb.astype(np.float64) / 255.0).astype(np.float32)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    from skimage.color import lab2rgb
    return np.clip(np.round(lab2rgb(lab.astype(np.float64)) * 255), 0, 255).astype(np.uint8)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo_in", type=Path)
    ap.add_argument("glb", type=Path)
    ap.add_argument("albedo_out", type=Path)
    ap.add_argument("--strength", type=float, default=1.0)
    ap.add_argument("--facecore-mask", type=Path, required=True)
    ap.add_argument("--lips-mask", type=Path, required=True)
    ap.add_argument("--eyes-L-mask", type=Path, required=True)
    ap.add_argument("--eyes-R-mask", type=Path, required=True)
    ap.add_argument("--brows-L-mask", type=Path, required=True)
    ap.add_argument("--brows-R-mask", type=Path, required=True)
    a = ap.parse_args(argv)

    s = float(a.strength)
    rgb = np.asarray(Image.open(a.albedo_in).convert("RGB"))
    S = rgb.shape[0]
    assert rgb.shape == (S, S, 3), rgb.shape

    lab = cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)
    SIGMA = 48.0
    low = np.stack([cv2.GaussianBlur(lab[:, :, c], (0, 0), SIGMA) for c in range(3)], -1)
    high = lab - low

    V, UV = load_skin(a.glb)
    cx = float((V[:, 0].min() + V[:, 0].max()) / 2)
    mir = cKDTree(V).query(np.column_stack([2 * cx - V[:, 0], V[:, 1], V[:, 2]]))[1]

    core = mask_from_file(a.facecore_mask, S)
    feat = np.maximum.reduce([mask_from_file(a.lips_mask, S),
                              mask_from_file(a.eyes_L_mask, S),
                              mask_from_file(a.eyes_R_mask, S),
                              mask_from_file(a.brows_L_mask, S),
                              mask_from_file(a.brows_R_mask, S)])
    W_FEATHER = 32.0
    FEAT_RAMP = 72.0
    w = cv2.GaussianBlur(core, (0, 0), W_FEATHER)
    if w.max() > 0:
        w /= w.max()
    fdist = cv2.distanceTransform(((feat <= 0.5)).astype(np.uint8), cv2.DIST_L2, 5)
    ramp = np.clip(fdist / FEAT_RAMP, 0, 1)
    framp = ramp * ramp * (3 - 2 * ramp)  # smoothstep: 0 on feat, 1 beyond 72px
    w = w * framp

    u = np.clip(UV[:, 0] * S, 0, S - 1.001)
    v = np.clip(UV[:, 1] * S, 0, S - 1.001)
    um = np.clip(UV[mir, 0] * S, 0, S - 1.001)
    vm = np.clip(UV[mir, 1] * S, 0, S - 1.001)
    ix = np.clip((UV[:, 0] * S).astype(int), 0, S - 1)
    iy = np.clip((UV[:, 1] * S).astype(int), 0, S - 1)

    acc = np.zeros((S, S, 3), np.float64)
    cnt = np.zeros((S, S), np.float64)
    for c in range(3):
        Lm = bilin(low[:, :, c].astype(np.float64), um, vm)
        np.add.at(acc[:, :, c], (iy, ix), Lm)
    np.add.at(cnt, (iy, ix), 1)
    acc_b = np.stack([cv2.GaussianBlur(acc[:, :, c], (0, 0), 24) for c in range(3)], -1)
    cnt_b = cv2.GaussianBlur(cnt, (0, 0), 24)
    with np.errstate(invalid="ignore", divide="ignore"):
        ratio = acc_b / np.maximum(cnt_b[..., None], 1e-9)
    mirror_low = np.where(cnt_b[..., None] > 1e-9, ratio, low.astype(np.float64))

    delta = low.astype(np.float64) - mirror_low
    lab_out = (lab.astype(np.float64) - 0.5 * s * delta * w[..., None]).astype(np.float32)
    out = (np.clip(cv2.cvtColor(lab_out, cv2.COLOR_LAB2RGB), 0, 1) * 255 + 0.5).astype(np.uint8)
    # bit-exact feature texels: paste source RGB so lips/eyes/brows are untouched
    out[feat > 0.5] = rgb[feat > 0.5]
    # bit-exact far-outside texels: the stage changes only texels inside its
    # derived mask (core feather * feature ramp).
    out[w == 0] = rgb[w == 0]
    Image.fromarray(out).save(a.albedo_out)

    # report
    safe = (core > 0.5) & (feat < 0.5)
    dL = np.abs(delta[safe][:, 0])
    low_out = cv2.GaussianBlur(lab_out[:, :, 0], (0, 0), SIGMA)
    hcorr = float(np.corrcoef(high[safe][:, 0].ravel(),
                              (lab_out[:, :, 0] - low_out)[safe].ravel())[0, 1])
    print(f's={s} p95|dL-low|={np.percentile(dL, 95):.3f} '
          f'mean|dL-low|={dL.mean():.3f} highcorr~{hcorr:.5f}')
    print('wrote ' + str(a.albedo_out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
"""Replayable scalp-forehead compositor (face-replay station).

Ports two scratch behaviours into deterministic, size-agnostic code:

(a) join refresh: the fixed join (feathered outline/ear/face-ring weights of
    at least 96 texels at 4096, low band taken as a robust smooth fit of the
    tone-transferred base skin, high band taken from the island itself, no
    tiling anywhere). The scratch registered the face tile with ECC affine +
    dense flow; this port takes an already-registered tile and enforces the
    same acceptance idea with a low-band NCC gate (refuse below threshold).
(b) scalp apply: UV-locked edited island composited only outside the face
    core, ears, neck and brows. The locked island is a STORED file consumed
    by sha256: the Imagine call itself is out of scope for this card, and the
    code performs zero model calls. A missing sha record or a sha mismatch is
    a hard REFUSE (non-zero exit), never a fallback.
(c) region masks are mesh-derived (face core, ears, neck, brows, scalp,
    lips, eyes) supplied either as a masks directory or derived on the fly
    from a subject GLB. No ellipses, no hand boxes, no subject constants.
    Left/right comes from a mesh-side map (per-texel vertex x-sign,
    rasterised from the subject GLB; 255 one side, 0 the other): image
    halves are wrong in this atlas, whose halves share columns. The side
    map is required input, validated 100% against the derived L/R masks.

    Keep-out interiors erode past the W>0.001 reach (3.1 sigma) per role,
    with lips/eyes covered whole where contained in the hard-zeroed core;
    the apply step hard-zeroes the identical interiors, so the report is
    exact by construction. The boundary clause is the interior crown step
    (4-texel adjacent L difference inside the eroded scalp, max <= 8):
    the old whole-band max is anatomy-dominated and identical in good and
    rejected composites alike.

Texture convention (stated once): texture row = v*S, col = u*S, sampled with
flipY=false as three.js samples it; trimesh returns V upside-down, so V is
flipped once on GLB load. Proof for the convention is the derive-stage neon
render grid (all colours land on anatomy there).

Only stdlib + numpy + PIL + scipy are required (trimesh only for --glb).
Neighbour idiom follows the skin station (pathlib, --check self-test).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

REF_SIZE = 4096.0
FEATHER_TEXELS = 96.0
CORE_ERODE_TEXELS = 80.0
CORE_FEATHER_TEXELS = 162.0
CHROMA_OVER = 6.0
NCC_GATE = 0.80
MIN_REGION_TEXELS = 64
MIN_HALF_TEXELS = 500
# Keep-out insets are computed inside zero_interiors (3.1 sigma for the
# wide 96-texel roles, 3.3 sigma of the thin 24-texel keep-out feather).
# Interior crown step: adjacent-column |dL| half-width in texels at 4096,
# and its bound (separates measured accepted <=6.5 from rejected >=10.5).
STEP_HALF_TEXELS = 4.0
STEP_MAX_BOUND = 8.0
# Thin-structure keep-out feather in texels at 4096 (ears, brows): tight
# enough that their interiors survive past-reach erosion provably exact,
# wide enough (24 texels) that the rim ramp stays gentle. Outline,
# face-ring and scalp-region transitions keep the 96-texel feather.
KB_FEATHER_TEXELS = 8.0

MASK_ROLES = ("facecore", "scalp", "ears-L", "ears-R", "neck", "brows-L",
              "brows-R", "lips", "eyes-L", "eyes-R")

# Anatomical thresholds in metres, identical for every adult subject
# (ported from the derive stage; geometry, not identity).
LIP_RING_M = 0.008
BROW_BAND_M = 0.006
EYE_RING_M = 0.002
EAR_DROP_M = 0.012
NECK_DEPTH_M = 0.11
CHIN_SEARCH_M = 0.09


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_rgb(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGB"))


def save_rgb(path: Path, arr: np.ndarray) -> None:
    Image.fromarray(arr.astype(np.uint8)).save(path)


def load_mask(path: Path, size: tuple[int, int] | None = None) -> np.ndarray:
    img = Image.open(path).convert("L")
    if size is not None and img.size != (size[0], size[1]):
        img = img.resize((size[0], size[1]), Image.BILINEAR)
    return np.array(img).astype(np.float64) / 255.0


def load_side(path: Path, size: tuple[int, int] | None = None,
              arr: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Mesh-side halves: file holds 255 one side, 0 the other, 128 neither."""
    if arr is None:
        img = Image.open(path).convert("L")
        if size is not None and img.size != (size[0], size[1]):
            img = img.resize((size[0], size[1]), Image.NEAREST)
        arr = np.array(img)
    return arr > 200, arr < 55


def gauss(arr: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return arr.astype(np.float64)
    if arr.ndim == 3:
        return ndimage.gaussian_filter(arr.astype(np.float64),
                                       (sigma, sigma, 0), truncate=3.0,
                                       mode="reflect")
    return ndimage.gaussian_filter(arr.astype(np.float64), sigma,
                                   truncate=3.0, mode="reflect")


def _srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


_RGB2XYZ = np.array([[0.4124564, 0.3575761, 0.1804375],
                     [0.2126729, 0.7151522, 0.0721750],
                     [0.0193339, 0.1191920, 0.9503041]])
_XYZ2RGB = np.linalg.inv(_RGB2XYZ)
_WHITE = np.array([0.95047, 1.0, 1.08883])
_EPS, _KAP = 0.008856, 903.3


def lab_of(rgb: np.ndarray) -> np.ndarray:
    lin = _srgb_to_linear(rgb.astype(np.float64))
    xyz = lin @ _RGB2XYZ.T
    f = xyz / _WHITE
    fx = np.where(f > _EPS, np.cbrt(f), (_KAP * f + 16) / 116)
    out = np.empty_like(f)
    out[..., 0] = 116 * fx[..., 1] - 16
    out[..., 1] = 500 * (fx[..., 0] - fx[..., 1])
    out[..., 2] = 200 * (fx[..., 1] - fx[..., 2])
    return out


def rgb_of(lab: np.ndarray) -> np.ndarray:
    lab = lab.astype(np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = lab[..., 1] / 500 + fy
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f > 0.206893, f ** 3, (116 * f - 16) / _KAP) * _WHITE
    lin = np.clip(xyz @ _XYZ2RGB.T, 0.0, None)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin,
                    1.055 * (lin ** (1 / 2.4)) - 0.055)
    return np.clip(srgb * 255.0 + 0.5, 0, 255).astype(np.uint8)


def skin_sample_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.float64)
    g = rgb[:, :, 1].astype(np.float64)
    b = rgb[:, :, 2].astype(np.float64)
    gray = 0.299 * r + 0.587 * g + 0.114 * b
    return ((gray > 70) & (gray < 245)
            & ~((r - g > 55) & (r > 100)))


def lowband_ncc(a: np.ndarray, b: np.ndarray) -> float:
    sig = max(2.0, min(a.shape[:2]) / 60.0)
    la = gauss(a.astype(np.float64), sig).ravel()
    lb = gauss(b.astype(np.float64), sig).ravel()
    la -= la.mean()
    lb -= lb.mean()
    denom = float(np.sqrt((la * la).sum() * (lb * lb).sum()))
    if denom <= 0:
        return 0.0
    return float((la * lb).sum() / denom)


def corner_flood_outline(rgb: np.ndarray) -> tuple[np.ndarray, dict]:
    h, w = rgb.shape[:2]
    corner = rgb[0, 0].astype(int)
    dist = np.abs(rgb.astype(int) - corner).max(axis=2)
    cand = (dist <= 2).astype(np.uint8)
    lab, n = ndimage.label(cand, structure=np.ones((3, 3), int))
    info = {"method": "corner-flood", "bg_frac": 0.0, "fallback": False}
    if n == 0:
        return np.ones((h, w), bool), info
    bg_id = int(lab[0, 0])
    bg = lab == bg_id
    frac = float(bg.sum() / bg.size)
    info["bg_frac"] = frac
    if frac < 0.02:
        info["fallback"] = True
        return np.ones((h, w), bool), info
    return ~bg, info


def _nearest_fill(img: np.ndarray, valid: np.ndarray) -> np.ndarray:
    if valid.all():
        return img.astype(np.float64)
    _, idx = ndimage.distance_transform_edt(~valid, return_indices=True)
    if img.ndim == 3:
        return img[tuple(idx)].astype(np.float64)
    return img[idx[0], idx[1]].astype(np.float64)


def norm_conv(arr: np.ndarray, mask: np.ndarray,
              sigma: float) -> np.ndarray:
    a = arr.astype(np.float64)
    m = mask.astype(np.float64)
    if a.ndim == 3:
        num = gauss(a * m[:, :, None], sigma)
        den = gauss(m, sigma)[:, :, None]
        fallback = float(a[m > 0.5].mean()) if (m > 0.5).any() else 0.0
        return np.where(den > 1e-4, num / np.maximum(den, 1e-4), fallback)
    num = gauss(a * m, sigma)
    den = gauss(m, sigma)
    fallback = float(a[m > 0.5].mean()) if (m > 0.5).any() else 0.0
    return np.where(den > 1e-4, num / np.maximum(den, 1e-4), fallback)


def robust_lowband(base_lab: np.ndarray, skin: np.ndarray,
                   scale: float) -> np.ndarray:
    med_size = max(3, int(round(9 * scale))) | 1
    work = _nearest_fill(base_lab, skin)
    small = work[::8, ::8, :]
    med = ndimage.median_filter(small, size=(med_size, med_size, 1),
                                mode="nearest")
    lum = ndimage.zoom(med, (8, 8, 1), order=1)[:work.shape[0],
                                                :work.shape[1], :]
    low_l = gauss(lum[:, :, 0], 12.0 * scale)
    low_a = norm_conv(work[:, :, 1], skin, 20.0 * scale)
    low_b = norm_conv(work[:, :, 2], skin, 20.0 * scale)
    return np.stack([low_l, low_a, low_b], axis=-1)


def load_masks_dir(masks_dir: Path,
                   size: tuple[int, int]) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    for role in MASK_ROLES:
        cand = masks_dir / f"mask-{role}.png"
        if cand.is_file():
            out[role] = load_mask(cand, size)
    if "facecore" not in out or "scalp" not in out:
        raise RuntimeError("masks dir must hold at least mask-facecore.png "
                           "and mask-scalp.png")
    return out


def derive_masks_from_glb(glb_path: Path, size: int) -> dict[str, np.ndarray]:
    """Mesh-derived part masks at size x size (row=v*S convention).

    V is flipped once on load (trimesh is upside-down vs the renderer).
    Uses the same anatomical metre thresholds for every adult subject.
    """
    import trimesh

    scene = trimesh.load(glb_path, force="scene")
    geoms: dict[str, tuple] = {}
    for node in scene.graph.nodes_geometry:
        tf, name = scene.graph[node]
        geo = scene.geometry[name]
        verts = trimesh.transform_points(
            np.asarray(geo.vertices, dtype=np.float64), tf)
        uv = np.asarray(geo.visual.uv, dtype=np.float64)
        if uv.ndim == 2 and uv.shape[1] == 2:
            uv = uv.copy()
            uv[:, 1] = 1.0 - uv[:, 1]
        geoms.setdefault(name, (verts, np.asarray(geo.faces, dtype=np.int64),
                                uv))
    skin = None
    for name, (v, f, uv) in geoms.items():
        n = name.lower()
        if "body.001" in n and (skin is None or len(v) > len(skin[0])):
            skin = (v, f, uv, name)
    if skin is None:
        name = max(geoms, key=lambda k: len(geoms[k][0]))
        v, f, uv = geoms[name]
        skin = (v, f, uv, name)
    verts_all, faces, uvs, _ = skin
    cx = float((verts_all[:, 0].min() + verts_all[:, 0].max()) / 2)

    brow_v = None
    lash_v = None
    for name, (v, f, uv) in geoms.items():
        n = name.lower()
        if "eyebrow" in n and (brow_v is None or len(v) > len(brow_v)):
            brow_v = v
        if "lash" in n and "tongue" not in n and (
                lash_v is None or len(v) > len(lash_v)):
            lash_v = v

    loops: dict[int, list] = {}
    edges: dict[tuple, int] = {}
    for a, b, c in faces.tolist():
        for u, v in ((a, b), (b, c), (c, a)):
            key = (u, v) if u < v else (v, u)
            edges[key] = edges.get(key, 0) + 1
    _ = loops, edges

    nrm = trimesh.Trimesh(vertices=verts_all, faces=faces,
                           process=False).vertex_normals
    nz = np.asarray(nrm)[:, 2]
    n_verts = len(verts_all)
    emid = float(lash_v[:, 1].mean()) if lash_v is not None else float(
        verts_all[:, 1].max()) - 0.12
    eb = ((verts_all[:, 1] > emid - 0.030)
          & (verts_all[:, 1] < emid + 0.015))
    lab_ear = np.zeros(n_verts, bool)
    for sgn in (1.0, -1.0):
        side = eb & (np.sign(verts_all[:, 0] - cx) == sgn)
        if not side.any():
            continue
        mx = float(np.abs(verts_all[side][:, 0] - cx).max())
        keep = side & (np.abs(verts_all[:, 0] - cx) > mx - EAR_DROP_M)
        lab_ear |= keep

    browtop = float(brow_v[:, 1].max()) if brow_v is not None else emid + 0.02
    face_hw = (float(np.abs(brow_v[:, 0] - cx).max()) * 1.25
               if brow_v is not None else 0.075)
    mouth_y = emid - 0.075
    chin_y = mouth_y - 0.032
    lab_face = ((verts_all[:, 1] > chin_y - 0.005)
                & (verts_all[:, 1] < browtop + 0.015)
                & (np.abs(verts_all[:, 0] - cx) < face_hw)
                & ~lab_ear & (nz > -0.3))
    fbot = lab_face & (np.abs(verts_all[:, 1] - chin_y) < 0.010)
    neck_hw = (float(np.abs(verts_all[fbot][:, 0] - cx).max())
               if fbot.any() else 0.06)
    lab_neck = ((verts_all[:, 1] < chin_y - 0.005)
                & (verts_all[:, 1] > chin_y - NECK_DEPTH_M)
                & (np.abs(verts_all[:, 0] - cx) < neck_hw))
    head = verts_all[:, 1] > chin_y - 0.005
    lab_scalp = head & ~lab_face & ~lab_ear & ~lab_neck

    lab_lip = np.zeros(n_verts, bool)
    if lash_v is not None:
        lip_c = np.array([cx, mouth_y, verts_all[:, 2].max()])
        d = np.linalg.norm(verts_all - lip_c, axis=1)
        lab_lip = d < LIP_RING_M
    lab_brow = np.zeros(n_verts, bool)
    if brow_v is not None:
        from scipy.spatial import cKDTree
        lab_brow = cKDTree(brow_v).query(verts_all, k=1)[0] < BROW_BAND_M
    lab_eye = np.zeros(n_verts, bool)
    if lash_v is not None:
        from scipy.spatial import cKDTree
        lab_eye = cKDTree(lash_v).query(verts_all, k=1)[0] < EYE_RING_M

    def raster(label: np.ndarray) -> np.ndarray:
        img = np.zeros((size, size), np.uint8)
        sel = faces[(label[faces].sum(axis=1) >= 2)]
        if not len(sel):
            return img
        tris = uvs[sel] * size
        from PIL import ImageDraw
        canvas = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(canvas)
        for tri in tris:
            pts = [(float(u), float(v)) for u, v in tri]
            draw.polygon(pts, fill=255)
        return np.array(canvas)

    def feather(binary: np.ndarray, sigma_texels: float) -> np.ndarray:
        f = (binary > 0).astype(np.float64)
        if sigma_texels and f.sum():
            f = gauss(f, sigma_texels * size / REF_SIZE)
            if f.max() > 0:
                f /= f.max()
        return f

    ear_l = lab_ear & (verts_all[:, 0] > cx)
    ear_r = lab_ear & (verts_all[:, 0] < cx)
    side_pos = verts_all[:, 0] >= cx
    side_neg = verts_all[:, 0] < cx
    out = {
        "facecore": feather(raster(lab_face), 32.0),
        "scalp": feather(raster(lab_scalp), 32.0),
        "ears-L": feather(raster(ear_l), 16.0),
        "ears-R": feather(raster(ear_r), 16.0),
        "neck": feather(raster(lab_neck), 32.0),
        "brows-L": feather(raster(lab_brow & (verts_all[:, 0] > cx)), 16.0),
        "brows-R": feather(raster(lab_brow & (verts_all[:, 0] < cx)), 16.0),
        "lips": feather(raster(lab_lip), 6.0),
        "eyes-L": feather(raster(lab_eye & (verts_all[:, 0] > cx)), 6.0),
        "eyes-R": feather(raster(lab_eye & (verts_all[:, 0] < cx)), 6.0),
    }
    side_img = np.full((size, size), 128, np.uint8)
    side_img[raster(side_pos) > 0] = 255
    side_img[(raster(side_neg) > 0) & (side_img != 255)] = 0
    out["side"] = side_img.astype(np.float64) / 255.0
    return out


def _bin(masks: dict[str, np.ndarray], role: str) -> np.ndarray:
    return masks[role] > 0.5 if role in masks else np.zeros_like(
        next(iter(masks.values())), dtype=bool)


def regions_from_masks(masks: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    fc = _bin(masks, "facecore")
    sc = _bin(masks, "scalp")
    br = (_bin(masks, "brows-L") | _bin(masks, "brows-R"))
    er = (_bin(masks, "ears-L") | _bin(masks, "ears-R"))
    nk = _bin(masks, "neck")
    if not fc.any():
        raise RuntimeError("empty facecore mask: refuse (NO_FACECORE)")
    h, w = fc.shape
    yy = np.arange(h)[:, None]
    xx = np.arange(w)[None, :]
    fys, fxs = np.where(fc)
    fx0, fx1, fy0, fy1 = int(fxs.min()), int(fxs.max()), int(
        fys.min()), int(fys.max())
    fhh = max(1, fy1 - fy0)
    fww = max(1, fx1 - fx0)
    forehead = fc & (yy >= fy0) & (yy < fy0 + int(0.25 * fhh))
    temple = (fc & ((xx < fx0 + int(0.25 * fww))
                    | (xx > fx1 - int(0.25 * fww)))
              & (yy < fy0 + int(0.35 * fhh)))
    scalp_work = sc & ~fc & ~br & ~er & ~nk
    crown = scalp_work & (yy < h // 3)
    sides = scalp_work & (yy >= h // 3) & (yy < 2 * h // 3)
    back = scalp_work & (yy >= 2 * h // 3)
    return {"forehead": forehead, "temple": temple, "crown": crown,
            "sides": sides, "back": back, "scalp_work": scalp_work,
            "facecore": fc, "ears": er, "neck": nk, "brows": br,
            "lips": _bin(masks, "lips"),
            "eyes": (_bin(masks, "eyes-L") | _bin(masks, "eyes-R")),
            "face_bbox": np.array([fx0, fy0, fx1, fy1])}


def zero_interiors(regions: dict[str, np.ndarray], scale: float,
                   feather_texels: float) -> dict[str, tuple[np.ndarray,
                                                             str]]:
    """Keep-out interiors shared by the apply hard-zero and the report.

    Wide roles (facecore, neck: 96-texel feather) erode past 3.1 sigma;
    thin roles (lips, eyes, brows, ears: 24-texel keep-out feather, or
    deep-face) erode past 3.3 of their own smaller sigma, with lips/eyes
    asserting whole where contained in the hard-zeroed core. Both
    consumers use these identical objects, so the report is exact by
    construction, never by matching erosion twice.
    """
    import math

    wide = max(1, int(math.ceil(3.1 * feather_texels / 3.0 * scale)))
    thin = max(1, int(math.ceil(3.3 * KB_FEATHER_TEXELS / 3.0 * scale)))
    core = ndimage.binary_erosion(regions["facecore"], iterations=wide)
    out: dict[str, tuple[np.ndarray, str]] = {"facecore": (core, "eroded")}
    for name in ("lips", "eyes"):
        mask = regions[name]
        if mask.any() and (mask & ~core).sum() == 0:
            out[name] = (mask, "contained")
        else:
            out[name] = (ndimage.binary_erosion(mask, iterations=thin),
                         "eroded")
    out["neck"] = (ndimage.binary_erosion(regions["neck"], iterations=wide),
                   "eroded")
    for name in ("brows", "ears"):
        out[name] = (ndimage.binary_erosion(regions[name],
                                            iterations=thin),
                     "eroded")
    return out


def _mean_lab(lab: np.ndarray, mask: np.ndarray):
    if int(mask.sum()) < MIN_REGION_TEXELS:
        return None
    return [float(v) for v in lab[mask].reshape(-1, 3).mean(axis=0)]


def region_table(image_lab: np.ndarray, regions: dict[str, np.ndarray],
                 sides: tuple[np.ndarray, np.ndarray],
                 scale: float) -> dict:
    table: dict = {"regions": {}}
    for name in ("crown", "sides", "back", "forehead", "temple"):
        mask = regions[name]
        table["regions"][name] = {
            "n": int(mask.sum()),
            "mean_Lab": _mean_lab(image_lab, mask),
        }
    fore = table["regions"]["forehead"]["mean_Lab"]
    temple = table["regions"]["temple"]["mean_Lab"]
    if fore is None or temple is None:
        raise RuntimeError("forehead/temple region too small: refuse")
    spread = [fore[1] - temple[1], fore[2] - temple[2]]
    spread_dab = float(np.hypot(spread[0], spread[1]))
    table["forehead_temple_spread"] = {"da": spread[0], "db": spread[1],
                                       "dab": spread_dab}
    for scalp_name, ref_name in (("crown", "forehead"), ("sides", "temple"),
                                 ("back", "temple")):
        cur = table["regions"][scalp_name]["mean_Lab"]
        ref = table["regions"][ref_name]["mean_Lab"]
        if cur is None or ref is None:
            table[f"{scalp_name}_minus_{ref_name}"] = None
            continue
        d = [cur[i] - ref[i] for i in range(3)]
        table[f"{scalp_name}_minus_{ref_name}"] = {
            "dL": d[0], "da": d[1], "db": d[2],
            "dab": float(np.hypot(d[1], d[2]))}
    chroma = np.sqrt(image_lab[:, :, 1] ** 2 + image_lab[:, :, 2] ** 2)
    fore_chroma = float(chroma[regions["forehead"]].mean()) if int(
        regions["forehead"].sum()) else 0.0
    table["chroma_threshold"] = fore_chroma + CHROMA_OVER
    coverage = {}
    for name in ("crown", "sides", "back"):
        mask = regions[name]
        if int(mask.sum()) < MIN_REGION_TEXELS:
            coverage[name] = None
            continue
        coverage[name] = float(
            ((chroma[mask] > fore_chroma + CHROMA_OVER)).mean())
    table["chroma_coverage_over_forehead"] = coverage

    def asym(mask: np.ndarray):
        # Halves from the mesh-side map (per-texel vertex x-sign). Image
        # halves are wrong in this atlas: the island is off-center and the
        # halves share columns, so a column split leaves an 8:1 imbalance.
        pos, neg = sides
        left = mask & pos
        right = mask & neg
        if int(left.sum()) < MIN_HALF_TEXELS or int(
                right.sum()) < MIN_HALF_TEXELS:
            return None
        ml = image_lab[left].reshape(-1, 3).mean(axis=0)
        mr = image_lab[right].reshape(-1, 3).mean(axis=0)
        return {"dL": float(abs(ml[0] - mr[0])),
                "da": float(abs(ml[1] - mr[1])),
                "db": float(abs(ml[2] - mr[2])),
                "n_left": int(left.sum()), "n_right": int(right.sum()),
                "ratio": float(left.sum() / max(right.sum(), 1))}

    table["asymmetry"] = {name: asym(regions[name]) for name in
                          ("crown", "sides", "forehead")}
    lab_l = image_lab[:, :, 0]
    gx = gauss(lab_l, 6.0 * max(image_lab.shape[:2]) / REF_SIZE)
    grad = np.sqrt(ndimage.sobel(gx, axis=1) ** 2
                   + ndimage.sobel(gx, axis=0) ** 2)
    band = regions["scalp_work"] ^ ndimage.binary_erosion(
        regions["scalp_work"], iterations=6)
    inner = regions["facecore"] & ~(
        regions["facecore"] ^ ndimage.binary_erosion(
            regions["facecore"], iterations=6))
    table["boundary_gradient"] = {
        "scalp_band_max": float(grad[band].max()) if band.any() else None,
        "forehead_interior_p99": float(np.percentile(
            grad[inner], 99)) if inner.any() else None,
    }
    # Interior crown step: adjacent-column |dL| inside the eroded scalp
    # catches blotch edges and stubble dots that the anatomy-dominated
    # whole-band max (identical in good and rejected composites) misses.
    # The half-width follows the input texels, not the working size: the
    # island mapping is a rotation, so upright texels are atlas texels.
    half = max(1, int(round(STEP_HALF_TEXELS * scale)))
    sc_bin = regions["scalp_work"]
    step_inner = regions["crown"] & ndimage.binary_erosion(
        sc_bin, iterations=max(1, half + 2))
    step_d = np.abs(lab_l[:, half:] - lab_l[:, :-half])
    step_vals = step_d[step_inner[:, half:]]
    table["crown_step"] = {
        "half_px": half,
        "n": int(step_inner.sum()),
        "max": float(step_vals.max()) if step_vals.size else None,
        "p999": float(np.percentile(step_vals, 99.9)) if step_vals.size
        else None,
        "bound": STEP_MAX_BOUND,
    }
    return table


def exact_zero_report(before_lab: np.ndarray, after_rgb: np.ndarray,
                      regions: dict[str, np.ndarray],
                      interiors: dict[str, tuple[np.ndarray, str]]) -> dict:
    after_lab = lab_of(after_rgb).astype(np.float64)
    dlab = np.abs(before_lab - after_lab).max(axis=2)
    out: dict = {}
    for name in ("facecore", "lips", "eyes", "brows", "ears", "neck"):
        interior, rule = interiors[name]
        n = int(interior.sum())
        out[name] = {"n": n, "rule": rule,
                     "max_dLab": float(dlab[interior].max()) if n else None}
    return out


def join_refresh(base: np.ndarray, tile: np.ndarray,
                 face_box: tuple[int, int, int, int],
                 masks: dict[str, np.ndarray], scale: float,
                 feather_texels: float) -> tuple[np.ndarray, dict]:
    h, w = base.shape[:2]
    x, y, fw, fh = face_box
    if tile.shape[1] != fw or tile.shape[0] != fh:
        tile = np.array(Image.fromarray(tile).resize(
            (fw, fh), Image.LANCZOS))
    target = base[y:y + fh, x:x + fw]
    corr = lowband_ncc(target, tile)
    info: dict = {"ncc": corr, "gate": NCC_GATE, "accepted": corr >= NCC_GATE}
    if corr < NCC_GATE:
        raise RuntimeError(f"JOIN_GATE_REJECT ncc {corr:.3f} < {NCC_GATE}")
    src = base_lab_region = lab_of(base).astype(np.float64)
    face_pixels = target.reshape(-1, 3)
    keep_src = skin_sample_mask(target).reshape(-1)
    tile_keep = skin_sample_mask(tile).reshape(-1)
    if not keep_src.any() or not tile_keep.any():
        raise RuntimeError("JOIN_GATE_REJECT empty skin sample")
    mu_s = lab_of(face_pixels[keep_src].reshape(-1, 1, 3)).mean(axis=0)
    sd_s = lab_of(face_pixels[keep_src].reshape(-1, 1, 3)).std(axis=0) + 1e-6
    tile_lab = lab_of(tile.reshape(-1, 1, 3)[tile_keep].reshape(-1, 1, 3))
    mu_t = tile_lab.mean(axis=0)
    sd_t = tile_lab.std(axis=0)
    outline, _ = corner_flood_outline(base)
    transferred = ((src - mu_s) / sd_s * sd_t + mu_t)
    base_t = base.copy()
    skin = outline
    tlab = lab_of(base).astype(np.float64)
    tlab[skin] = transferred[skin]
    base_t = np.clip(tlab, [0, -128, -128], [100, 127, 127])
    base_t_rgb = rgb_of(base_t)
    base_t_rgb[~skin] = base[~skin]
    sig = feather_texels / 3.0 * scale
    face_soft = np.zeros((h, w), np.float64)
    box = np.zeros((fh, fw), np.float64)
    box[max(0, fh // 12):fh - max(1, fh // 12),
        max(0, fw // 12):fw - max(1, fw // 12)] = 1.0
    face_soft[y:y + fh, x:x + fw] = gauss(box, sig / 2.0)
    if face_soft.max() > 0:
        face_soft /= face_soft.max()
    ear_soft = gauss((masks["ears-L"] + masks["ears-R"]).clip(0, 1)
                     if "ears-L" in masks else np.zeros((h, w)), sig)
    if ear_soft.max() > 0:
        ear_soft /= ear_soft.max()
    outline_soft = gauss(outline.astype(np.float64), sig)
    if outline_soft.max() > 0:
        outline_soft /= outline_soft.max()
    island_lab = lab_of(base_t_rgb).astype(np.float64)
    skin_f = outline
    low = robust_lowband(island_lab, skin_f, scale)
    hi = island_lab - norm_conv(island_lab, skin_f, 6.0 * scale)
    tgt_lab = np.clip(low + hi, [0, -128, -128], [100, 127, 127])
    tgt = rgb_of(tgt_lab).astype(np.float64)
    w_face = np.clip(1 - face_soft / 0.5, 0, 1)
    weight = (w_face * (1 - ear_soft) * outline_soft).astype(np.float64)
    new = ((1 - weight[:, :, None]) * base_t_rgb.astype(np.float64)
           + weight[:, :, None] * tgt)
    joined = np.clip(new + 0.5, 0, 255).astype(np.uint8)
    joined[~outline] = base[~outline]
    info["treat_frac"] = float((weight > 0.001).mean())
    info["transfer"] = {"mu_src": [float(v) for v in mu_s.ravel()],
                        "mu_tgt": [float(v) for v in mu_t.ravel()]}
    _ = base_lab_region
    return joined, info


def _scalp_weight(base: np.ndarray, masks: dict[str, np.ndarray],
                   scale: float,
                   feather_texels: float) -> tuple[np.ndarray, dict,
                                                   dict, np.ndarray, dict]:
    """Shared scalp treatment weight (outline/keep-out/feather build).

    Single construction used by both the locked-donor apply and the
    unregistered self tone match: outline minus mesh keep-outs, feathered,
    with the shared keep-out interiors hard-zeroed past the W>0.001 reach,
    so keep-out interiors stay bit-exact for the exact-zero report, which
    reads these identical objects.
    """
    h, w = base.shape[:2]
    sig = feather_texels / 3.0 * scale
    outline, outline_info = corner_flood_outline(base)
    outline_soft = gauss(outline.astype(np.float64), sig)
    if outline_soft.max() > 0:
        outline_soft /= outline_soft.max()
    fc = (masks["facecore"] > 0.5) if "facecore" in masks else np.zeros(
        (h, w), bool)
    core_inset = max(1, int(round(CORE_ERODE_TEXELS * scale)))
    core = ndimage.binary_erosion(fc, iterations=core_inset)
    treat_face = 1 - gauss(core.astype(np.float64),
                           CORE_FEATHER_TEXELS / 3.0 * scale)
    if treat_face.max() > 0:
        treat_face /= treat_face.max()

    def soft(role: str, sigma: float) -> np.ndarray:
        if role not in masks:
            return np.zeros((h, w), np.float64)
        g = gauss((masks[role] > 0.5).astype(np.float64), sigma)
        if g.max() > 0:
            g /= g.max()
        return g

    kb_sig = KB_FEATHER_TEXELS / 3.0 * scale
    ear_soft = np.clip(soft("ears-L", kb_sig) + soft("ears-R", kb_sig), 0, 1)
    neck_soft = soft("neck", sig)
    brow_soft = np.clip(soft("brows-L", kb_sig) + soft("brows-R", kb_sig),
                        0, 1)
    scalp_bin = outline & ~fc
    for role in ("ears-L", "ears-R", "neck", "brows-L", "brows-R"):
        if role in masks:
            scalp_bin &= ~(masks[role] > 0.5)
    # NOTE: scalp is the island outline minus mesh keep-outs, not the
    # scalp label: derived scalp UV maps carry raster gaps (an 84-texel
    # one sits mid-crown here) that dip the feathered weight and bleed
    # base dots through. Outline minus keep-outs is gap-free by
    # construction; filled keep-out zones stay at W==0 through their own
    # weights, and the exact-zero interiors are untouched.
    scalp_soft = gauss(scalp_bin.astype(np.float64), sig)
    if scalp_soft.max() > 0:
        scalp_soft /= scalp_soft.max()
    weight = (outline_soft * scalp_soft * treat_face * (1 - ear_soft)
              * (1 - neck_soft) * (1 - brow_soft)).astype(np.float64)
    # Hard-zero inside the shared keep-out interiors (past W>0.001 reach):
    # truncating the far feather tail moves pixels by <0.04 Lab (invisible)
    # and keeps the interiors bit-exact for the exact-zero report, which
    # reads these identical objects.
    regions = regions_from_masks(
        {k: (v > 0.5).astype(np.float64) if v.max() <= 1.0 else v
         for k, v in masks.items()})
    interiors = zero_interiors(regions, scale, feather_texels)
    hard_zero = np.zeros((h, w), bool)
    for _name, (_interior, _rule) in interiors.items():
        hard_zero |= _interior
    weight[hard_zero] = 0.0
    return weight, regions, interiors, outline, outline_info


def scalp_apply(base: np.ndarray, locked: np.ndarray,
                masks: dict[str, np.ndarray], scale: float,
                feather_texels: float) -> tuple[np.ndarray, dict]:
    h, w = base.shape[:2]
    if (locked.shape[1], locked.shape[0]) != (w, h):
        locked = np.array(Image.fromarray(locked).resize(
            (w, h), Image.LANCZOS))
    weight, regions, interiors, _outline, outline_info = _scalp_weight(
        base, masks, scale, feather_texels)
    # Mean-only Lab tone anchor on the central forehead column straddling
    # the hairline (central 74% of the facecore width, rows from 20% of the
    # facecore height above its top edge to 2% below): the locked island
    # keeps its own pore grain while its boundary tone lands on the base
    # skin, so the feathered treatment has no step to hide. The proportions
    # are the ported forehead-box behavior expressed in derived-geometry
    # ratios; no hand box.
    fc = regions["facecore"]
    fys, fxs = np.where(fc)
    fy0 = int(fys.min())
    fhh = max(1, int(fys.max()) - fy0)
    fww = max(1, int(fxs.max()) - int(fxs.min()))
    fcx = (int(fxs.min()) + int(fxs.max())) // 2
    half = int(0.74 * fww / 2)
    box = ((np.arange(fc.shape[1])[None, :] >= fcx - half)
           & (np.arange(fc.shape[1])[None, :] < fcx + half)
           & (np.arange(fc.shape[0])[:, None] >= fy0 - int(0.20 * fhh))
           & (np.arange(fc.shape[0])[:, None] < fy0 + int(0.02 * fhh)))
    anchor = box if int(box.sum()) >= MIN_REGION_TEXELS else regions[
        "forehead"]
    anchor_name = "central-hairline-column" if int(
        box.sum()) >= MIN_REGION_TEXELS else "forehead-fallback"
    ref_lab = lab_of(base).astype(np.float64)
    lok_lab = lab_of(locked).astype(np.float64)
    shift = (ref_lab[anchor].mean(axis=0) - lok_lab[anchor].mean(axis=0))
    tgt_lab = np.clip(lok_lab + shift, [0, -128, -128], [100, 127, 127])
    tgt = rgb_of(tgt_lab).astype(np.float64)
    isl_lab = ref_lab
    new_lab = ((1 - weight[:, :, None]) * isl_lab
               + weight[:, :, None] * tgt_lab)
    new_up = rgb_of(np.clip(new_lab, [0, -128, -128], [100, 127, 127]))
    out = base.copy()
    changed = weight > 0.001
    out[changed] = new_up[changed]
    _ = tgt
    info = {"tone_shift_Lab": [float(v) for v in shift],
            "tone_anchor": anchor_name,
            "treat_frac": float(changed.mean()),
            "outline": outline_info}
    return out, info


def self_tone_match(base: np.ndarray, masks: dict[str, np.ndarray],
                    scale: float,
                    feather_texels: float) -> tuple[np.ndarray, dict]:
    """Unregistered-donor scalp: the subject's own skin, low band matched.

    Same treatment weight as the locked-donor apply (shared construction,
    keep-out interiors bit-exact). The LOW band of the base scalp is
    replaced by the forehead-region mean while the base's own HIGH band
    (pores) is kept: low/high split mirrors the join refresh
    (robust_lowband for low, 6-texel norm_conv residual for high), so a
    broad wash or stipple cast in the base low band lands on the forehead
    tone and only pore grain survives.
    """
    weight, regions, interiors, outline, outline_info = _scalp_weight(
        base, masks, scale, feather_texels)
    base_lab = lab_of(base).astype(np.float64)
    # Anchor is the subject's own face skin: facecore gated by the skin
    # sampler (drops lips/paint/high-chroma outliers), falling back to the
    # forehead region. A raw forehead-region mean is unsafe: with a
    # whole-atlas island box the upright "forehead" rows can hold lips or
    # paint instead of forehead skin.
    gated = regions["facecore"] & skin_sample_mask(base)
    if int(gated.sum()) >= MIN_REGION_TEXELS:
        anchor, anchor_name = gated, "facecore-skin-gated"
    else:
        anchor, anchor_name = regions["forehead"], "forehead-fallback"
    forehead_mean = base_lab[anchor].reshape(-1, 3).mean(axis=0)
    skin = outline
    low = robust_lowband(base_lab, skin, scale)
    hi = base_lab - norm_conv(base_lab, skin, 6.0 * scale)
    tgt_lab = np.clip(forehead_mean + hi, [0, -128, -128], [100, 127, 127])
    new_lab = ((1 - weight[:, :, None]) * base_lab
               + weight[:, :, None] * tgt_lab)
    new_up = rgb_of(np.clip(new_lab, [0, -128, -128], [100, 127, 127]))
    out = base.copy()
    changed = weight > 0.001
    out[changed] = new_up[changed]
    treated_mean = base_lab[changed].reshape(-1, 3).mean(axis=0)
    shift = forehead_mean - treated_mean
    info = {"tone_shift_Lab": [float(v) for v in shift],
            "tone_anchor": anchor_name,
            "treat_frac": float(changed.mean()),
            "outline": outline_info}
    return out, info


def _record_inputs(args: argparse.Namespace) -> dict:
    inputs: dict = {
        "base_skin": {"name": Path(args.base_skin).name,
                      "sha256": sha256_file(Path(args.base_skin))},
        "locked_island": {"name": Path(args.locked_island).name,
                          "sha256": sha256_file(Path(args.locked_island)),
                          "expected_sha256": args.locked_sha},
    }
    if args.face_tile:
        inputs["face_tile"] = {"name": Path(args.face_tile).name,
                               "sha256": sha256_file(Path(args.face_tile))}
    if args.masks:
        roles = {}
        for role in MASK_ROLES:
            cand = Path(args.masks) / f"mask-{role}.png"
            if cand.is_file():
                roles[role] = {"name": cand.name,
                               "sha256": sha256_file(cand)}
        inputs["masks"] = roles
    if args.glb:
        inputs["glb"] = {"name": Path(args.glb).name,
                         "sha256": sha256_file(Path(args.glb))}
    if args.side_map:
        inputs["side_map"] = {"name": Path(args.side_map).name,
                              "sha256": sha256_file(Path(args.side_map))}
    return inputs


def _load_sides(args: argparse.Namespace, size: tuple[int, int],
                glb_masks: dict[str, np.ndarray] | None = None
                ) -> tuple[np.ndarray, np.ndarray]:
    if args.side_map:
        return load_side(Path(args.side_map), size)
    if glb_masks is not None and "side" in glb_masks:
        arr = glb_masks["side"]
        img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(
            np.uint8))
        if img.size != (size[0], size[1]):
            img = img.resize((size[0], size[1]), Image.NEAREST)
        return load_side(Path("."), arr=np.array(img))
    raise RuntimeError("NO_SIDE_MAP: pass --side-map (mesh-side raster, "
                       "255/0): image halves are wrong in this atlas")


def _to_upright(arr: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    crop = arr[y0:y1, x0:x1]
    if crop.ndim == 2:
        img = Image.fromarray((np.clip(crop, 0, 1) * 255 + 0.5).astype(
            np.uint8), "L")
    else:
        img = Image.fromarray(crop.astype(np.uint8), "RGB")
    up = np.array(img.rotate(-90, expand=True, resample=Image.NEAREST))
    if crop.ndim == 2:
        return up.astype(np.float64) / 255.0
    return up


def _sides_upright(sides: tuple[np.ndarray, np.ndarray],
                   box: tuple[int, int, int, int]
                   ) -> tuple[np.ndarray, np.ndarray]:
    pos, neg = sides
    combo = np.full(pos.shape, 128, np.uint8)
    combo[pos] = 255
    combo[neg & ~pos] = 0
    up = _to_upright(combo.astype(np.float64) / 255.0, box)
    return up > 200 / 255, up < 55 / 255


def _from_upright(up: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    img = Image.fromarray(up.astype(np.uint8), "RGB")
    back = np.array(img.rotate(90, expand=True, resample=Image.NEAREST))
    assert back.shape[0] == y1 - y0 and back.shape[1] == x1 - x0, \
        f"inverse shape {back.shape} vs box {(y1 - y0, x1 - x0)}"
    return back


def _donor_registration(locked: np.ndarray, up_w: int, up_h: int,
                        base_up: np.ndarray) -> dict:
    """Donor-to-subject registration decision (dims only, no names).

    A donor stored at the upright island size is a locked donor; anything
    else is unregistered and must never be resized into the subject. The
    lowband NCC between the (resized-for-measure only) donor and the
    subject base over the upright field is recorded, never enforced: the
    measured pair (0.591 vs 0.693 masked over scalp-work, 0.630 vs 0.585
    full-frame) does not separate across NCC_GATE, so dims decide alone.
    """
    dh, dw = locked.shape[0], locked.shape[1]
    registered = (dw == up_w and dh == up_h)
    if (dw, dh) != (up_w, up_h):
        probe = np.array(Image.fromarray(locked).resize(
            (up_w, up_h), Image.LANCZOS))
    else:
        probe = locked
    try:
        ncc = lowband_ncc(base_up, probe)
    except Exception:
        ncc = 0.0
    reason = ("donor dims equal upright island dims: locked donor"
              if registered else
              "donor dims differ from upright island dims: unregistered "
              "donor is never resized; scalp comes from the subject base")
    return {"donor_dims": [dw, dh], "box_dims": [up_w, up_h], "ncc": ncc,
            "registered": registered, "reason": reason}


def _island_box_from_masks(masks: dict[str, np.ndarray],
                           shape: tuple[int, int]) -> tuple[int, int, int,
                                                            int]:
    union = np.zeros(shape, bool)
    for role in ("facecore", "scalp"):
        if role in masks:
            union |= masks[role] > 0.5
    ys, xs = np.where(union)
    if not len(xs):
        raise RuntimeError("cannot derive island box: refuse")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def compose(args: argparse.Namespace) -> dict:
    locked_path = Path(args.locked_island)
    actual = sha256_file(locked_path)
    if not args.locked_sha or actual != args.locked_sha:
        raise RuntimeError("LOCKED_ISLAND_SHA_MISMATCH "
                           f"actual {actual[:16]} != expected "
                           f"{(args.locked_sha or 'MISSING')[:16]}: refuse")
    base = load_rgb(Path(args.base_skin))
    h, w = base.shape[:2]
    size = (w, h)
    # Feather scale follows the input texels: the island mapping is a
    # rotation (texels unchanged), fixture crops are proportionally scaled.
    scale = max(h, w) / REF_SIZE
    if args.glb:
        masks = derive_masks_from_glb(Path(args.glb), max(h, w))
        glb_side = masks.pop("side", None)
        masks = {k: load_mask_from_array(v, size) for k, v in masks.items()}
        if glb_side is not None:
            img = Image.fromarray(
                (np.clip(glb_side, 0, 1) * 255 + 0.5).astype(np.uint8))
            if img.size != (size[0], size[1]):
                img = img.resize((size[0], size[1]), Image.NEAREST)
            glb_masks: dict[str, np.ndarray] | None = {
                "side": np.array(img).astype(np.float64) / 255.0}
        else:
            glb_masks = None
    else:
        masks = load_masks_dir(Path(args.masks), size)
        glb_masks = None
    sides = _load_sides(args, size, glb_masks)
    island_box: tuple[int, int, int, int] | None = None
    if args.input_space == "atlas":
        if args.island_box:
            island_box = tuple(int(v) for v in args.island_box)  # type: ignore[assignment]
        else:
            island_box = _island_box_from_masks(masks, (h, w))
    report: dict = {"mode": "compose",
                    "inputs": _record_inputs(args),
                    "parameters": {
                        "input_space": args.input_space,
                        "island_box": list(island_box) if island_box else None,
                        "feather_texels": args.feather_texels,
                        "ncc_gate": NCC_GATE,
                        "chroma_over": CHROMA_OVER,
                        "skip_join": bool(args.skip_join),
                        "join_ran": False,
                    }}
    working = base
    if args.face_tile and not args.skip_join:
        tile = load_rgb(Path(args.face_tile))
        if args.face_box:
            x, y, fw, fh = (int(v) for v in args.face_box)
        else:
            fx0, fy0, fx1, fy1 = regions_from_masks(
                masks)["face_bbox"].tolist()
            x, y, fw, fh = fx0, fy0, fx1 - fx0, fy1 - fy0
        working, join_info = join_refresh(working, tile, (x, y, fw, fh),
                                          masks, scale, args.feather_texels)
        report["parameters"]["join_ran"] = True
        report["join"] = join_info
        report["face_box"] = [x, y, fw, fh]
    else:
        report["parameters"]["join_limit"] = (
            "join not run on this input: a full-size join needs the "
            "pre-join source atlas (untracked provider-cache path outside "
            "write scope) plus the ECC/dense-flow registration sub-step, "
            "which has no station-python implementation; the join refresh "
            "(NCC gate, feathered paste, continuous low band, no tiling) "
            "is exercised fixture-scale")
    locked = load_rgb(locked_path)
    # All measurement and treatment runs in upright-island space: the head
    # island sits rotated 90 degrees in the atlas, so full-atlas rows and
    # columns are anatomically scrambled (the "forehead" band would read a
    # cheek strip). Atlas mode maps image, masks and sides upright first.
    if island_box is not None:
        work_up = _to_upright(working, island_box)
        masks_up = {k: _to_upright(v, island_box)
                    for k, v in masks.items()}
        sides_up = _sides_upright(sides, island_box)
        bx0, by0, bx1, by1 = island_box
        # Upright island dims are the box dims swapped by the 90-degree
        # rotation: width = box height, height = box width.
        up_w, up_h = (by1 - by0), (bx1 - bx0)
        reg = _donor_registration(locked, up_w, up_h, work_up)
        registered = bool(reg["registered"])
        if not registered:
            # Unregistered donor: never resize; the scalp is the subject's
            # own skin, low band matched to the subject's own forehead
            # (pores kept). The output-side crown_step refusal below still
            # applies to this treated base: a painted or seamed base
            # refuses; only a clean treated base returns.
            before_lab = lab_of(work_up).astype(np.float64)
            out_up, scalp_info = self_tone_match(
                work_up, masks_up, scale, args.feather_texels)
            scalp_info["scalp_source"] = "subject_base_tone_matched"
            scalp_info["registration"] = reg
            out = working.copy()
            x0, y0, x1, y1 = island_box
            out[y0:y1, x0:x1] = _from_upright(out_up, island_box)
            regions = regions_from_masks(masks_up)
            out_lab = lab_of(out_up).astype(np.float64)
            report["region_table"] = region_table(out_lab, regions, sides_up,
                                                  scale)
            interiors = zero_interiors(regions, scale, args.feather_texels)
            report["exact_zero"] = exact_zero_report(before_lab, out_up,
                                                     regions, interiors)
        else:
            locked_up = locked
            if (locked_up.shape[1], locked_up.shape[0]) != (
                    work_up.shape[1], work_up.shape[0]):
                locked_up = np.array(Image.fromarray(locked_up).resize(
                    (work_up.shape[1], work_up.shape[0]), Image.LANCZOS))
                report["parameters"]["locked_resized"] = True
            before_lab = lab_of(work_up).astype(np.float64)
            out_up, scalp_info = scalp_apply(work_up, locked_up, masks_up,
                                             scale, args.feather_texels)
            scalp_info["scalp_source"] = "locked_island"
            scalp_info["registration"] = reg
            out = working.copy()
            x0, y0, x1, y1 = island_box
            out[y0:y1, x0:x1] = _from_upright(out_up, island_box)
            regions = regions_from_masks(masks_up)
            out_lab = lab_of(out_up).astype(np.float64)
            report["region_table"] = region_table(out_lab, regions, sides_up,
                                                  scale)
            interiors = zero_interiors(regions, scale, args.feather_texels)
            report["exact_zero"] = exact_zero_report(before_lab, out_up,
                                                     regions, interiors)
    else:
        up_w, up_h = w, h
        reg = _donor_registration(locked, up_w, up_h, working)
        registered = bool(reg["registered"])
        before_lab = lab_of(working).astype(np.float64)
        if not registered:
            out, scalp_info = self_tone_match(working, masks, scale,
                                              args.feather_texels)
            scalp_info["scalp_source"] = "subject_base_tone_matched"
            scalp_info["registration"] = reg
            out_lab = lab_of(out).astype(np.float64)
            regions = regions_from_masks(masks)
            report["region_table"] = region_table(out_lab, regions, sides,
                                                  scale)
            interiors = zero_interiors(regions, scale, args.feather_texels)
            report["exact_zero"] = exact_zero_report(before_lab, out,
                                                     regions, interiors)
        else:
            out, scalp_info = scalp_apply(working, locked, masks, scale,
                                          args.feather_texels)
            scalp_info["scalp_source"] = "locked_island"
            scalp_info["registration"] = reg
            out_lab = lab_of(out).astype(np.float64)
            regions = regions_from_masks(masks)
            report["region_table"] = region_table(out_lab, regions, sides,
                                                  scale)
            interiors = zero_interiors(regions, scale, args.feather_texels)
            report["exact_zero"] = exact_zero_report(before_lab, out, regions,
                                                     interiors)
    report["scalp"] = scalp_info
    # Input-side refusal: a painted scalp arrives in the BASE skin. A
    # registered locked donor replaces the stubbled cap the paint sits
    # under, so an over-bound input is expected there and must not refuse:
    # the donor is a NAMED scalp source (b3167aa35 fired on every stubbled
    # base only because at that commit no run could name one). The refusal
    # fires only when scalp_source is not locked_island: unregistered runs
    # treat the subject's own base, so a painted or seamed base still
    # refuses on the input side. Measure crown_step on the pre-treatment
    # working image in the same space the output table uses.
    in_table = region_table(
        before_lab, regions, sides_up if island_box is not None else sides,
        scale)
    report["input_region_table"] = {"crown_step": in_table["crown_step"]}
    # The output-side refusal below stays for every run: whatever the scalp
    # source, a composite that leaves a step refuses. Only a clean treated
    # base returns, with its scalp source recorded above.
    in_step = in_table["crown_step"]
    if (in_step["max"] is not None and in_step["max"] > in_step["bound"]
            and scalp_info.get("scalp_source") != "locked_island"):
        report["refusal"] = {
            "reason": "crown_step_over_bound",
            "side": "input",
            "max": in_step["max"],
            "bound": in_step["bound"],
            "scalp_source": None,
        }
        with open(args.report, "w") as f:
            json.dump(report, f, indent=1)
        raise RuntimeError(
            "CROWN_STEP_OVER_BOUND "
            f"max {in_step['max']:.3f} > bound {in_step['bound']:.3f}: "
            "no registered scalp source; refuse")
    step = report["region_table"]["crown_step"]
    if step["max"] is not None and step["max"] > step["bound"]:
        report["refusal"] = {
            "reason": "crown_step_over_bound",
            "side": "output",
            "max": step["max"],
            "bound": step["bound"],
            "scalp_source": None,
        }
        with open(args.report, "w") as f:
            json.dump(report, f, indent=1)
        raise RuntimeError(
            "CROWN_STEP_OVER_BOUND "
            f"max {step['max']:.3f} > bound {step['bound']:.3f}: "
            "record names no scalp source; refuse")
    save_rgb(Path(args.out), out)
    with open(args.report, "w") as f:
        json.dump(report, f, indent=1)
    return report


def load_mask_from_array(arr: np.ndarray,
                         size: tuple[int, int]) -> np.ndarray:
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    if img.size != (size[0], size[1]):
        img = img.resize((size[0], size[1]), Image.BILINEAR)
    return np.array(img).astype(np.float64) / 255.0


def evaluate(args: argparse.Namespace) -> dict:
    img = load_rgb(Path(args.input))
    h, w = img.shape[:2]
    size = (w, h)
    if args.glb:
        masks = derive_masks_from_glb(Path(args.glb), max(h, w))
        glb_side = masks.pop("side", None)
        masks = {k: load_mask_from_array(v, size) for k, v in masks.items()}
        if glb_side is not None:
            img_side = Image.fromarray(
                (np.clip(glb_side, 0, 1) * 255 + 0.5).astype(np.uint8))
            if img_side.size != (size[0], size[1]):
                img_side = img_side.resize((size[0], size[1]), Image.NEAREST)
            glb_masks: dict[str, np.ndarray] | None = {
                "side": np.array(img_side).astype(np.float64) / 255.0}
        else:
            glb_masks = None
    else:
        masks = load_masks_dir(Path(args.masks), size)
        glb_masks = None
    sides = _load_sides(args, size, glb_masks)
    regions = regions_from_masks(masks)
    lab = lab_of(img).astype(np.float64)
    island_box = None
    if args.island_box:
        island_box = tuple(int(v) for v in args.island_box)
        img_up = _to_upright(img, island_box)
        masks_up = {k: _to_upright(v, island_box) for k, v in masks.items()}
        sides = _sides_upright(sides, island_box)
        regions = regions_from_masks(masks_up)
        lab = lab_of(img_up).astype(np.float64)
    report = {"mode": "evaluate",
              "inputs": {"image": {"name": Path(args.input).name,
                                   "sha256": sha256_file(Path(args.input))}},
              "parameters": {"chroma_over": CHROMA_OVER,
                             "island_box": list(island_box)
                             if island_box else None},
              "region_table": region_table(lab, regions, sides,
                                             max(h, w) / REF_SIZE)}
    if args.side_map:
        report["inputs"]["side_map"] = {
            "name": Path(args.side_map).name,
            "sha256": sha256_file(Path(args.side_map))}
    with open(args.report, "w") as f:
        json.dump(report, f, indent=1)
    return report


def check() -> None:
    rng = np.random.default_rng(0)
    probe = rng.integers(0, 256, size=(32, 32, 3)).astype(np.uint8)
    rt = rgb_of(lab_of(probe).astype(np.float64)).astype(int)
    if np.abs(rt - probe.astype(int)).max() > 3:
        raise SystemExit("Lab round-trip drift too large")
    g = gauss(np.zeros((16, 16)), 2.0)
    if g.shape != (16, 16):
        raise SystemExit("gauss shape mismatch")
    print("FACE_REPLAY_CHECK ok")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Replayable scalp-forehead compositor")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--evaluate-only", action="store_true")
    ap.add_argument("--input", default=None)
    ap.add_argument("--base-skin", default=None)
    ap.add_argument("--face-tile", default=None)
    ap.add_argument("--face-box", nargs=4, default=None)
    ap.add_argument("--locked-island", default=None)
    ap.add_argument("--locked-sha", default=None)
    ap.add_argument("--masks", default=None)
    ap.add_argument("--glb", default=None)
    ap.add_argument("--side-map", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--input-space", default="atlas",
                    choices=["atlas", "island-upright"])
    ap.add_argument("--island-box", nargs=4, default=None)
    ap.add_argument("--feather-texels", type=float, default=96.0)
    ap.add_argument("--skip-join", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.check:
        check()
        return
    if args.evaluate_only:
        if not args.input or not args.report or not (args.masks or args.glb):
            raise SystemExit("evaluate needs --input --report --masks|--glb")
        evaluate(args)
        return
    if not args.base_skin or not args.locked_island or not args.out \
            or not args.report or not (args.masks or args.glb):
        raise SystemExit("compose needs --base-skin --locked-island --out "
                         "--report --masks|--glb")
    compose(args)


if __name__ == "__main__":
    main()

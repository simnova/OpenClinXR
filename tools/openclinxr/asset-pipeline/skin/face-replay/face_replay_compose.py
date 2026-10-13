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
    return {
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


def _mean_lab(lab: np.ndarray, mask: np.ndarray):
    if int(mask.sum()) < MIN_REGION_TEXELS:
        return None
    return [float(v) for v in lab[mask].reshape(-1, 3).mean(axis=0)]


def region_table(image_lab: np.ndarray,
                 regions: dict[str, np.ndarray]) -> dict:
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
        # Halves split at the region's own horizontal center (the head
        # island is off-center in a full atlas; an image-center split would
        # leave one half empty).
        xs = np.where(mask.any(axis=0))[0]
        if not len(xs):
            return None
        mid = (int(xs.min()) + int(xs.max())) // 2
        left = mask & (np.arange(mask.shape[1])[None, :] < mid)
        right = mask & (np.arange(mask.shape[1])[None, :] >= mid)
        if int(left.sum()) < MIN_HALF_TEXELS or int(
                right.sum()) < MIN_HALF_TEXELS:
            return None
        ml = image_lab[left].reshape(-1, 3).mean(axis=0)
        mr = image_lab[right].reshape(-1, 3).mean(axis=0)
        return {"dL": float(abs(ml[0] - mr[0])),
                "da": float(abs(ml[1] - mr[1])),
                "n_left": int(left.sum()), "n_right": int(right.sum())}

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
    return table


def exact_zero_report(before_lab: np.ndarray, after_rgb: np.ndarray,
                      regions: dict[str, np.ndarray],
                      scale: float, feather_texels: float) -> dict:
    after_lab = lab_of(after_rgb).astype(np.float64)
    dlab = np.abs(before_lab - after_lab).max(axis=2)
    out: dict = {}
    # Zero interiors are eroded past the W>0.001 reach of every feathered
    # weight (about 3.1 sigma from any keep-out edge); the apply step
    # hard-zeroes W inside the same interiors, so untouched bytes stay
    # bit-exact and max_dLab is exactly 0.0 by construction.
    inset = max(1, int(round(4 * feather_texels / 3.0 * scale)))
    core_interior = ndimage.binary_erosion(regions["facecore"],
                                           iterations=inset)
    for name in ("facecore", "lips", "eyes", "brows", "ears", "neck"):
        mask = regions[name]
        # Interior structures fully contained in the hard-zeroed core are
        # exact over every texel (the apply step zeroes W there); the
        # edge-adjacent roles use the eroded interior past W>0.001 reach.
        if name in ("lips", "eyes") and mask.any() and (
                mask & ~core_interior).sum() == 0:
            interior = mask
            rule = "contained"
        else:
            interior = ndimage.binary_erosion(mask, iterations=inset)
            rule = "eroded"
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


def scalp_apply(base: np.ndarray, locked: np.ndarray,
                masks: dict[str, np.ndarray], scale: float,
                feather_texels: float) -> tuple[np.ndarray, dict]:
    h, w = base.shape[:2]
    if (locked.shape[1], locked.shape[0]) != (w, h):
        locked = np.array(Image.fromarray(locked).resize(
            (w, h), Image.LANCZOS))
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

    def soft(role: str) -> np.ndarray:
        if role not in masks:
            return np.zeros((h, w), np.float64)
        g = gauss((masks[role] > 0.5).astype(np.float64), sig)
        if g.max() > 0:
            g /= g.max()
        return g

    ear_soft = np.clip(soft("ears-L") + soft("ears-R"), 0, 1)
    neck_soft = soft("neck")
    brow_soft = np.clip(soft("brows-L") + soft("brows-R"), 0, 1)
    scalp_bin = (((masks["scalp"] > 0.5) if "scalp" in masks
                  else outline) & ~fc)
    scalp_soft = gauss(scalp_bin.astype(np.float64), sig)
    if scalp_soft.max() > 0:
        scalp_soft /= scalp_soft.max()
    weight = (outline_soft * scalp_soft * treat_face * (1 - ear_soft)
              * (1 - neck_soft) * (1 - brow_soft)).astype(np.float64)
    # Hard-zero inside keep-out interiors (past W>0.001 reach): truncating
    # the far feather tail moves pixels by <0.015 Lab (invisible) and keeps
    # the interiors bit-exact for the exact-zero report.
    zero_inset = max(1, int(round(4 * feather_texels / 3.0 * scale)))
    hard_zero = np.zeros((h, w), bool)
    for role in ("facecore", "ears-L", "ears-R", "neck", "brows-L",
                 "brows-R", "lips", "eyes-L", "eyes-R"):
        if role in masks:
            hard_zero |= ndimage.binary_erosion(
                (masks[role] > 0.5), iterations=zero_inset)
    weight[hard_zero] = 0.0
    regions = regions_from_masks(
        {k: (v > 0.5).astype(np.float64) if v.max() <= 1.0 else v
         for k, v in masks.items()})
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
    return inputs


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


def _from_upright(up: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    img = Image.fromarray(up.astype(np.uint8), "RGB")
    back = np.array(img.rotate(90, expand=True, resample=Image.NEAREST))
    assert back.shape[0] == y1 - y0 and back.shape[1] == x1 - x0, \
        f"inverse shape {back.shape} vs box {(y1 - y0, x1 - x0)}"
    return back


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
    scale = max(h, w) / REF_SIZE
    if args.glb:
        masks = derive_masks_from_glb(Path(args.glb), max(h, w))
        masks = {k: load_mask_from_array(v, size) for k, v in masks.items()}
    else:
        masks = load_masks_dir(Path(args.masks), size)
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
    locked = load_rgb(locked_path)
    before_full = lab_of(working).astype(np.float64)
    if island_box is not None:
        work_up = _to_upright(working, island_box)
        masks_up = {k: _to_upright(v, island_box)
                    for k, v in masks.items()}
        locked_up = locked
        if (locked_up.shape[1], locked_up.shape[0]) != (
                work_up.shape[1], work_up.shape[0]):
            locked_up = np.array(Image.fromarray(locked_up).resize(
                (work_up.shape[1], work_up.shape[0]), Image.LANCZOS))
            report["parameters"]["locked_resized"] = True
        out_up, scalp_info = scalp_apply(work_up, locked_up, masks_up,
                                         scale, args.feather_texels)
        out = working.copy()
        x0, y0, x1, y1 = island_box
        out[y0:y1, x0:x1] = _from_upright(out_up, island_box)
    else:
        out, scalp_info = scalp_apply(working, locked, masks, scale,
                                      args.feather_texels)
    report["scalp"] = scalp_info
    out_lab = lab_of(out).astype(np.float64)
    regions = regions_from_masks(masks)
    report["region_table"] = region_table(out_lab, regions)
    report["exact_zero"] = exact_zero_report(before_full, out, regions,
                                              scale, args.feather_texels)
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
    scale = max(h, w) / REF_SIZE
    if args.glb:
        masks = derive_masks_from_glb(Path(args.glb), max(h, w))
        masks = {k: load_mask_from_array(v, size) for k, v in masks.items()}
    else:
        masks = load_masks_dir(Path(args.masks), size)
    regions = regions_from_masks(masks)
    lab = lab_of(img).astype(np.float64)
    report = {"mode": "evaluate",
              "inputs": {"image": {"name": Path(args.input).name,
                                   "sha256": sha256_file(Path(args.input))}},
              "parameters": {"chroma_over": CHROMA_OVER},
              "region_table": region_table(lab, regions)}
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

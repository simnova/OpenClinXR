"""Replayable global colour solve (face-replay station).

Ports the scratch lab6fix transfer into deterministic, size-agnostic
code: a GLOBAL Lab affine of 6 numbers (face-core mean + std), sourced
in ALBEDO space with a recorded render-to-albedo offset D. It replaces
the closed-loop regional solve whose per-region corrections were never
stored and which left a midline split on a changed composite.

Two modes. SOLVE (human/orchestrator; any renderer use stays outside
this module): measures source stats in albedo space under the
mesh-derived face-core mask and render stats under supplied
render-space masks, then WRITES solve-parameters.json carrying the
subject id, the six numbers, the offset, the mask/input/goal shas and
the method version. With --chroma-grid NxM (+ --chroma-pre-json,
--chroma-goal-json, --landmarks-uv, --mouth-mask) SOLVE additionally
fits a stored regional chroma field: per-cell goal-minus-render a*/b*
means over the below-brow band in landmark-normalised coordinates,
evaluation-patch cells excluded, demeaned, gaussian-smoothed, mapped to
albedo UV through the mesh-derived UV anchors. REPLAY: reads the
parameters, verifies the input albedo + mask shas, measures the source
stats LIVE from the supplied input, applies the affine globally (plus
the stored field when present), writes the output. Zero renders,
zero model calls, zero child processes on the replay path. A recorded
input sha mismatch is a hard REFUSE (non-zero exit), never a fallback.

The first version of this transfer was wrong because it applied
render-space statistics in albedo space; the offset D carries that
fix (target albedo mean = goal render mean - D).

Texture convention: same as the compositor (row=v*S, flipY=false).
Lab helpers are reused from face_replay_compose (single implementation).
Only stdlib + numpy + PIL are required.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face_replay_compose as C

METHOD_VERSION = "global-lab6-v2"
MIN_MASK_TEXELS = 64
MIN_HALF_TEXELS = 500

REGIONAL_CHROMA_METHOD = "regional-chroma-v1"
# Normalised render-space grid extent in midline units (x-cx)/ied.
# Cheek patches sit at |nx| ~ 0.43-0.51 (115px/ied); +-0.65 covers the
# band sides with margin. Vertical ny=(y-brow)/(mouth-brow); the band
# bottom (mouth+0.25*ied) maps to ~1.17-1.23, set per solve from the
# pre-solve mask JSON and recorded.
CHROMA_NX_RANGE = (-0.65, 0.65)
MIN_CELL_TEXELS = 200


def face_stats(rgb: np.ndarray, mask: np.ndarray) -> tuple[list, list, int]:
    px = C.lab_of(rgb)[mask > 0.5]
    n = int(px.shape[0])
    if n < MIN_MASK_TEXELS:
        raise RuntimeError(f"COLOUR_MASK_TOO_SMALL n={n}: refuse")
    mean = [float(v) for v in px.mean(axis=0)]
    std = [float(v) + 1e-6 for v in px.std(axis=0)]
    return mean, std, n


def solve_compute(tex_mean: list, tex_sd: list, pre_mean: list,
                  pre_sd: list, goal_mean: list, goal_sd: list) -> tuple[list, list, list]:
    """Compute six numbers with render-space gain for std.
    
    The mean target in albedo space = goal_render_mean - D (where D = pre_render_mean - albedo_mean).
    The std target in albedo space = albedo_std * gain, where gain_c = goal_render_std_c / pre_render_std_c.
    This avoids baking lighting contrast (which increases render std) into the albedo texture.
    """
    offset = [float(a - b) for a, b in zip(pre_mean, tex_mean)]
    # Mean target: goal render mean minus the render→albedo offset
    tgt_mean = [float(g - d) for g, d in zip(goal_mean, offset)]
    # Std target: albedo std scaled by render-space gain (goal_render / pre_render)
    gain = [float(g / max(p, 1e-6)) for g, p in zip(goal_sd, pre_sd)]
    tgt_sd = [float(tex_sd[i] * gain[i]) for i in range(3)]
    six = tgt_mean + tgt_sd
    return six, offset, gain


def apply_transfer(rgb: np.ndarray, src_mean: list, src_sd: list,
                   tgt_mean: list, tgt_sd: list) -> np.ndarray:
    lab = C.lab_of(rgb).astype(np.float64)
    mu_s = np.array(src_mean, dtype=np.float64)
    sd_s = np.array(src_sd, dtype=np.float64)
    mu_t = np.array(tgt_mean, dtype=np.float64)
    sd_t = np.array(tgt_sd, dtype=np.float64)
    out = (lab - mu_s) / np.maximum(sd_s, 1e-6) * sd_t + mu_t
    out[..., 0] = np.clip(out[..., 0], 0.0, 100.0)
    return C.rgb_of(out)


def _norm_anchors(mask_json: dict) -> dict:
    """Landmark anchors from a make_belowbrow_mask.py JSON."""
    return {
        "cx": float(mask_json["cx"]),
        "ied": float(mask_json["ied"]),
        "brow_row": float(mask_json["brow_row"]),
        "mouth_bottom": float(mask_json["mouth_bottom"]),
        "eye_row": float(mask_json["eye_row"]),
    }


def _render_nxny(xs: np.ndarray, ys: np.ndarray, a: dict) -> tuple[np.ndarray, np.ndarray]:
    nx = (xs - a["cx"]) / a["ied"]
    ny = (ys - a["brow_row"]) / (a["mouth_bottom"] - a["brow_row"])
    return nx, ny


def _eval_patch_rects(mask_json: dict, half: float = 20.0) -> list:
    """40x40 evaluation patches (same centres/half-size as the mask
    script: PATCH_R=20) as normalised rects (nx0, ny0, nx1, ny1)."""
    a = _norm_anchors(mask_json)
    rects = []
    for name in ("L_cheek", "R_cheek", "forehead", "chin"):
        cxp, cyp = mask_json["regions"][name]["center"]
        xs = np.array([cxp - half, cxp + half])
        ys = np.array([cyp - half, cyp + half])
        nx, ny = _render_nxny(xs, ys, a)
        rects.append((name, float(nx[0]), float(ny[0]),
                      float(nx[1]), float(ny[1])))
    return rects


def _cells_overlapping(nx_edges: np.ndarray, ny_edges: np.ndarray,
                       rect: tuple) -> set:
    _, x0, y0, x1, y1 = rect
    hit = set()
    for iy in range(len(ny_edges) - 1):
        if ny_edges[iy + 1] < y0 or ny_edges[iy] > y1:
            continue
        for ix in range(len(nx_edges) - 1):
            if nx_edges[ix + 1] < x0 or nx_edges[ix] > x1:
                continue
            hit.add((ix, iy))
    return hit


def _cell_bins(nx: np.ndarray, ny: np.ndarray,
               nx_edges: np.ndarray, ny_edges: np.ndarray) -> tuple:
    """Bin kept-pixel normalised coords to grid cells (shared binning for
    every channel so all means cover identical pixel sets)."""
    ix = np.clip(np.digitize(nx, nx_edges) - 1, 0, len(nx_edges) - 2)
    iy = np.clip(np.digitize(ny, ny_edges) - 1, 0, len(ny_edges) - 2)
    return ix, iy, len(ny_edges) - 1, len(nx_edges) - 1


def _binned_means(feat: np.ndarray, flat: np.ndarray,
                  ny_cells: int, nx_cells: int) -> tuple:
    """Mean of per-pixel feature rows (n, k) per grid cell; count grid.
    Same stable-sort/searchsorted walk as the original a*/b* helper, so
    refactored channels reproduce its numbers exactly."""
    k = feat.shape[1]
    means = np.full((ny_cells, nx_cells, k), np.nan)
    counts = np.zeros((ny_cells, nx_cells), dtype=np.int64)
    if flat.size:
        order = np.argsort(flat, kind="stable")
        srt = flat[order]
        bounds = np.searchsorted(srt, np.arange(1, nx_cells * ny_cells + 1))
        prev = 0
        for ci, b in enumerate(bounds):
            n = int(b - prev)
            counts[ci // nx_cells, ci % nx_cells] = n
            if n >= MIN_CELL_TEXELS:
                means[ci // nx_cells, ci % nx_cells] = \
                    feat[order[prev:b]].mean(axis=0)
            prev = b
    return means, counts


def _cell_means_ab(rgb: np.ndarray, keep: np.ndarray,
                   nx: np.ndarray, ny: np.ndarray,
                   nx_edges: np.ndarray, ny_edges: np.ndarray) -> tuple:
    """Mean a*/b* per grid cell over kept pixels; count grid."""
    lab = C.lab_of(rgb).astype(np.float64)
    ix, iy, ny_cells, nx_cells = _cell_bins(nx, ny, nx_edges, ny_edges)
    # ix/iy/nx/ny are already kept-pixels-only from coords(); ab is masked
    # from the full Lab image with the same keep mask, so rows align.
    flat = iy * nx_cells + ix
    ab = np.stack([lab[..., 1], lab[..., 2]], axis=-1)[keep]
    if flat.size:
        means, counts = _binned_means(ab, flat, ny_cells, nx_cells)
    else:
        means = np.full((ny_cells, nx_cells, 2), np.nan)
        counts = np.zeros((ny_cells, nx_cells), dtype=np.int64)
    return means, counts


def _cell_means_l(rgb: np.ndarray, keep: np.ndarray,
                  ix: np.ndarray, iy: np.ndarray,
                  ny_cells: int, nx_cells: int) -> tuple:
    """Mean L per grid cell over the SAME binned pixel sets as a*/b*."""
    lab = C.lab_of(rgb).astype(np.float64)
    flat = iy * nx_cells + ix
    L = lab[..., 0][keep][..., None]
    if flat.size:
        means, counts = _binned_means(L, flat, ny_cells, nx_cells)
    else:
        means = np.full((ny_cells, nx_cells, 1), np.nan)
        counts = np.zeros((ny_cells, nx_cells), dtype=np.int64)
    return means, counts


def _nearest_fill(raw: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Fill invalid cells with the nearest valid cell value (grid is tiny;
    brute force)."""
    out = raw.copy()
    vy, vx = np.where(valid)
    for iy in range(raw.shape[0]):
        for ix in range(raw.shape[1]):
            if valid[iy, ix]:
                continue
            d2 = (vy - iy) ** 2 + (vx - ix) ** 2
            j = int(np.argmin(d2))
            out[iy, ix] = raw[vy[j], vx[j]]
    return out


def solve_regional_chroma(pre_rgb: np.ndarray, pre_keep: np.ndarray,
                          pre_json: dict, goal_rgb: np.ndarray,
                          goal_keep: np.ndarray, goal_json: dict,
                          landmarks: dict, mouth_t: float,
                          nx_cells: int, ny_cells: int,
                           sigma_cells: float,
                          mirror: bool = False,
                          notch: bool = False,
                          notch_cores: str = "0.20,0.32,0.70;0.26,0.80,1.00",
                          luminance: bool = False) -> dict:
    """Fit the stored regional chroma field.

    Per cell: goal-minus-pre mean a*/b* over the below-brow band in
    landmark-normalised coordinates (each image with its own mask-JSON
    anchors). Cells overlapping any of the 4 evaluation patches (in
    either image's coordinates) are EXCLUDED from the fit. With mirror,
    the raw deltas are averaged about the midline first, so the stored
    field adds no left/right difference of its own (the render-space
    midline-asymmetry gate must not grow while an asymmetric residual is
    corrected). The fit mean is removed (global tone stays with the six
    numbers; L untouched), then a Gaussian smooth propagates fit values
    into excluded cells so held-out patches generalise from neighbours.

    With luminance=True the same machinery additionally fits a
    low-frequency L channel (same cells, same fit/eval split, same
    demean/smooth/notch): the global six keep the face mean while the
    field carries local lightness (HB3: matched-anatomy cheeks/forehead
    miss on L, which no a*/b* field can move).
    """
    a_pre = _norm_anchors(pre_json)
    a_goal = _norm_anchors(goal_json)
    # Patch half-size shared literally with the mask script (same 40x40
    # evaluation boxes the report measures); lazy import so the replay
    # path never pays for cv2/skimage.
    import make_belowbrow_mask as _mbm
    patch_half = float(_mbm.PATCH_R)
    ny1 = 1.0 + 0.25 * a_pre["ied"] / (a_pre["mouth_bottom"] - a_pre["brow_row"])
    nx_edges = np.linspace(CHROMA_NX_RANGE[0], CHROMA_NX_RANGE[1], nx_cells + 1)
    ny_edges = np.linspace(0.0, ny1, ny_cells + 1)

    def coords(rgb, keep, a):
        h, w = keep.shape
        ys, xs = np.where(keep)
        nx, ny = _render_nxny(xs.astype(np.float64),
                              ys.astype(np.float64), a)
        return xs, ys, nx, ny

    _, _, pnx, pny = coords(pre_rgb, pre_keep, a_pre)
    _, _, gnx, gny = coords(goal_rgb, goal_keep, a_goal)
    pre_m, pre_n = _cell_means_ab(pre_rgb, pre_keep, pnx, pny,
                                  nx_edges, ny_edges)
    goal_m, goal_n = _cell_means_ab(goal_rgb, goal_keep, gnx, gny,
                                    nx_edges, ny_edges)
    covered = (~np.isnan(pre_m[..., 0])) & (~np.isnan(goal_m[..., 0]))
    eval_cells: set = set()
    for js in (pre_json, goal_json):
        for rect in _eval_patch_rects(js, half=patch_half):
            eval_cells |= _cells_overlapping(nx_edges, ny_edges, rect)
    fit = covered & np.array(
        [[(ix, iy) not in eval_cells
          for ix in range(nx_cells)] for iy in range(ny_cells)])
    if int(fit.sum()) < 4:
        raise RuntimeError(f"CHROMA_TOO_FEW_FIT_CELLS n={int(fit.sum())}: refuse")

    raw = np.where(covered[..., None],
                   goal_m - pre_m, np.nan)
    if mirror:
        for iy in range(ny_cells):
            for ix in range(nx_cells):
                jx = nx_cells - 1 - ix
                if jx <= ix:
                    continue
                a, b = covered[iy, ix], covered[iy, jx]
                if a and b:
                    avg = (raw[iy, ix] + raw[iy, jx]) / 2
                    raw[iy, ix] = raw[iy, jx] = avg
                elif b:
                    raw[iy, ix] = raw[iy, jx]
                elif a:
                    raw[iy, jx] = raw[iy, ix]
    filled = raw.copy()
    for c in range(2):
        plane = raw[..., c]
        filled[..., c] = _nearest_fill(
            np.where(np.isnan(plane), 0.0, plane), covered)
    demean = [float(filled[..., c][fit].mean()) for c in range(2)]
    zero_mean = filled - np.array(demean)
    # Gaussian smooth (C.gauss: separable, truncate 3, reflect): suppresses
    # per-cell sampling noise and, crucially, bleeds fit values into the
    # held-out evaluation cells so they inherit neighbour corrections.
    smooth = C.gauss(zero_mean, float(sigma_cells))
    notch_desc = None
    if notch:
        # Spare curved-midline zones (nose slopes, mouth, chin cleft):
        # their render-vs-goal delta is mostly key-light shading, not
        # albedo, so baking it in cannot converge and only feeds
        # asymmetric render response (measured: the a* asymmetry excess
        # sits at |nx|<0.2, not in the smooth cheek/forehead eval zones).
        # Cosine-ramped per-cell weights on the smoothed field; the
        # bilinear replay lookup keeps the applied field continuous.
        # Core geometry comes from --chroma-notch-cores as universal
        # face proportions in normalised units (recorded verbatim).
        try:
            cores = [tuple(float(v) for v in c.split(","))
                     for c in notch_cores.split(";")]
            assert all(len(c) == 3 for c in cores)
        except (ValueError, AssertionError, AttributeError):
            raise SystemExit("--chroma-notch-cores must look like "
                             "\"hx,ny0,ny1;hx,ny0,ny1\"")
        ramp = 0.10
        wcell = np.ones((ny_cells, nx_cells))
        ccx = (nx_edges[:-1] + nx_edges[1:]) / 2
        ccy = (ny_edges[:-1] + ny_edges[1:]) / 2
        for iy in range(ny_cells):
            for ix in range(nx_cells):
                w = 1.0
                for hx, y0, y1 in cores:
                    dx = max(0.0, abs(ccx[ix]) - hx)
                    dy = max(0.0, ccy[iy] - y1, y0 - ccy[iy])
                    d = (dx * dx + dy * dy) ** 0.5
                    if d <= 0.0:
                        w = 0.0
                    elif d < ramp:
                        w = min(w, 0.5 - 0.5 * np.cos(np.pi * d / ramp))
                wcell[iy, ix] = w
        smooth = smooth * wcell[..., None]
        notch_desc = {"cores": [{"half_nx": c[0], "ny0": c[1], "ny1": c[2]}
                               for c in cores],
                      "ramp": ramp,
                      "why": "curved-midline render delta is shading, not "
                             "albedo; sparing it removes asymmetric render "
                             "response without touching smooth eval zones"}

    cells_l = None
    demean_l = None
    if luminance:
        # Same pixel sets, same fit/eval split, same mirror/demean/smooth/
        # notch as the chroma channels: local lightness the six cannot
        # supply (they match the face mean, not the cheek/forehead shape).
        p_ix, p_iy, p_nyc, p_nxc = _cell_bins(pnx, pny, nx_edges, ny_edges)
        g_ix, g_iy, _, _ = _cell_bins(gnx, gny, nx_edges, ny_edges)
        pre_l, _ = _cell_means_l(pre_rgb, pre_keep, p_ix, p_iy, p_nyc, p_nxc)
        goal_l, _ = _cell_means_l(goal_rgb, goal_keep, g_ix, g_iy, p_nyc, p_nxc)
        raw_l = np.where(covered, goal_l[..., 0] - pre_l[..., 0], np.nan)
        if mirror:
            for iy in range(ny_cells):
                for ix in range(nx_cells):
                    jx = nx_cells - 1 - ix
                    if jx <= ix:
                        continue
                    a, b = covered[iy, ix], covered[iy, jx]
                    if a and b:
                        avg = (raw_l[iy, ix] + raw_l[iy, jx]) / 2
                        raw_l[iy, ix] = raw_l[iy, jx] = avg
                    elif b:
                        raw_l[iy, ix] = raw_l[iy, jx]
                    elif a:
                        raw_l[iy, jx] = raw_l[iy, ix]
        filled_l = _nearest_fill(
            np.where(np.isnan(raw_l), 0.0, raw_l), covered)
        demean_l = float(filled_l[fit].mean())
        smooth_l = C.gauss(filled_l - demean_l, float(sigma_cells))
        if notch:
            smooth_l = smooth_l * wcell
        cells_l = [[float(smooth_l[iy, ix]) for ix in range(nx_cells)]
                   for iy in range(ny_cells)]

    lms = landmarks["landmarks"]
    def uv(name):
        return lms[name]["uv_texel"]
    eye_l = (np.array(uv("eye-corner-L-inner")) + np.array(uv("eye-corner-L-outer"))) / 2
    eye_r = (np.array(uv("eye-corner-R-inner")) + np.array(uv("eye-corner-R-outer"))) / 2
    brow_rows = [uv(k)[0] for k in ("brow-end-L-inner", "brow-end-L-outer",
                                    "brow-end-R-inner", "brow-end-R-outer")]
    return {
        "method": REGIONAL_CHROMA_METHOD,
        "mirror": bool(mirror),
        "notch": notch_desc,
        "grid": {"nx": nx_cells, "ny": ny_cells,
                 "nx_range": list(CHROMA_NX_RANGE),
                 "ny_range": [0.0, float(ny1)]},
        "render_anchors": {"pre": a_pre, "goal": a_goal},
        "uv_anchors": {
            # uv_texel = [u*S, v*S]; u runs down the face, v across it:
            # horizontal s = v*S, vertical t = u*S.
            "mid_s": float((np.array(uv("nose-tip"))[1] + np.array(uv("chin"))[1]) / 2),
            "ied_s": float(abs(eye_r[1] - eye_l[1])),
            "brow_t": float(sum(brow_rows) / len(brow_rows)),
            "mouth_t": float(mouth_t),
            "mouth_source": "mean u*S of mesh-derived lip-mask texels",
            "landmarks_size": int(landmarks.get("size", 4096)),
        },
        "cells_ab": [[[float(smooth[iy, ix, 0]), float(smooth[iy, ix, 1])]
                      for ix in range(nx_cells)] for iy in range(ny_cells)],
        "luminance": bool(luminance),
        "cells_l": cells_l,
        "demean_l": demean_l,
        "fit_cells": sorted([list(c) for c in
                             [(ix, iy) for iy in range(ny_cells)
                              for ix in range(nx_cells) if fit[iy, ix]]]),
        "eval_cells": sorted([list(c) for c in eval_cells]),
        "unfit_cells": sorted([[ix, iy] for iy in range(ny_cells)
                               for ix in range(nx_cells)
                               if not covered[iy, ix]]),
        "demean_ab": demean,
        "smoothing": {"kernel": "separable-gaussian", "sigma_cells": float(sigma_cells),
                      "truncate": 3.0, "mode": "reflect",
                      "why": "suppress per-cell sampling noise and bleed fit "
                             "values into held-out evaluation cells so they "
                             "inherit neighbour corrections"},
    }


def apply_regional_chroma(lab: np.ndarray, face: np.ndarray,
                          field: dict, albedo_size: int) -> np.ndarray:
    """Add the stored a*/b* field to albedo Lab (plus the stored L channel
    when the field carries one; fields without it behave exactly as
    before, and field-free params never reach this function).

    Texel (row=v*S across, col=u*S down) -> normalised coords via the
    mesh-derived UV anchors, bilinear sample of the smoothed grid
    (clamped at the edges), weighted by the facecore mask value so
    non-face texels are untouched and edges blend without a seam.
    """
    g = field["grid"]
    nx_cells, ny_cells = int(g["nx"]), int(g["ny"])
    (nx0, nx1), (ny0, ny1) = g["nx_range"], g["ny_range"]
    u = field["uv_anchors"]
    f = albedo_size / float(u["landmarks_size"])
    s0, ieds = u["mid_s"] * f, u["ied_s"] * f
    bt, mt = u["brow_t"] * f, u["mouth_t"] * f
    h, w = lab.shape[:2]
    ss = np.tile(np.arange(h, dtype=np.float64)[:, None], (1, w))
    tt = np.tile(np.arange(w, dtype=np.float64)[None, :], (h, 1))
    nx = (ss - s0) / ieds
    ny = (tt - bt) / (mt - bt)
    gx = (nx - nx0) / (nx1 - nx0) * nx_cells - 0.5
    gy = (ny - ny0) / (ny1 - ny0) * ny_cells - 0.5
    gx = np.clip(gx, 0.0, nx_cells - 1.0)
    gy = np.clip(gy, 0.0, ny_cells - 1.0)
    x0 = np.floor(gx).astype(np.int64)
    y0 = np.floor(gy).astype(np.int64)
    x1 = np.minimum(x0 + 1, nx_cells - 1)
    y1 = np.minimum(y0 + 1, ny_cells - 1)
    fx = (gx - x0)[..., None]
    fy = (gy - y0)[..., None]

    def sample(cells):
        v00 = cells[y0, x0]
        v10 = cells[y0, x1]
        v01 = cells[y1, x0]
        v11 = cells[y1, x1]
        return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + \
            (v01 * (1 - fx) + v11 * fx) * fy

    cells = np.array(field["cells_ab"], dtype=np.float64)
    delta = sample(cells)
    wgt = np.clip(face, 0.0, 1.0)[..., None]
    out = lab.copy()
    out[..., 1] += delta[..., 0] * wgt[..., 0]
    out[..., 2] += delta[..., 1] * wgt[..., 0]
    if field.get("cells_l") is not None:
        cells_l = np.array(field["cells_l"], dtype=np.float64)[..., None]
        out[..., 0] += sample(cells_l)[..., 0] * wgt[..., 0]
    return out


def cheek_delta_l(rgb: np.ndarray, face: np.ndarray, side_path: Path,
                  size: tuple[int, int]) -> tuple[float | None, int, int]:
    img = Image.open(side_path).convert("L")
    if img.size != (size[0], size[1]):
        img = img.resize((size[0], size[1]), Image.NEAREST)
    arr = np.array(img)
    left = (arr > 200) & (face > 0.5)
    right = (arr < 55) & (face > 0.5)
    nl, nr = int(left.sum()), int(right.sum())
    if nl < MIN_HALF_TEXELS or nr < MIN_HALF_TEXELS:
        return None, nl, nr
    lab = C.lab_of(rgb)
    return float(lab[left][:, 0].mean() - lab[right][:, 0].mean()), nl, nr


def _mask_or_refuse(path: Path, size: tuple[int, int]) -> np.ndarray:
    mask = C.load_mask(path, size)
    if int((mask > 0.5).sum()) < MIN_MASK_TEXELS:
        raise RuntimeError(f"COLOUR_MASK_TOO_SMALL {path.name}: refuse")
    return mask


def cmd_solve(args: argparse.Namespace) -> dict:
    albedo = C.load_rgb(Path(args.input_albedo))
    h, w = albedo.shape[:2]
    face = _mask_or_refuse(Path(args.albedo_mask), (w, h))
    pre = C.load_rgb(Path(args.pre_render))
    goal = C.load_rgb(Path(args.goal_render))
    pw, ph = pre.shape[1], pre.shape[0]
    gw, gh = goal.shape[1], goal.shape[0]
    pre_mask = _mask_or_refuse(Path(args.pre_mask), (pw, ph))
    goal_mask = _mask_or_refuse(Path(args.goal_mask), (gw, gh))
    tex_mean, tex_sd, tex_n = face_stats(albedo, face)
    pre_mean, pre_sd, pre_n = face_stats(pre, pre_mask)
    goal_mean, goal_sd, goal_n = face_stats(goal, goal_mask)
    six, offset, gain = solve_compute(tex_mean, tex_sd, pre_mean, pre_sd, goal_mean, goal_sd)
    params = {
        "subject": args.subject,
        "method": METHOD_VERSION,
        "six": six,
        "offset_D_render_minus_albedo": offset,
        "gain_albedo_std": gain,
        "source_albedo": {"mean": tex_mean, "std": tex_sd, "n": tex_n},
        "pre_render": {"mean": pre_mean, "std": pre_sd, "n": pre_n},
        "goal_render": {"mean": goal_mean, "std": goal_sd, "n": goal_n},
        "shas": {
            "input_albedo": C.sha256_file(Path(args.input_albedo)),
            "albedo_mask": C.sha256_file(Path(args.albedo_mask)),
            "pre_render": C.sha256_file(Path(args.pre_render)),
            "pre_mask": C.sha256_file(Path(args.pre_mask)),
            "goal_render": C.sha256_file(Path(args.goal_render)),
            "goal_mask": C.sha256_file(Path(args.goal_mask)),
        },
        "files": {
            "input_albedo": Path(args.input_albedo).name,
            "albedo_mask": Path(args.albedo_mask).name,
            "pre_render": Path(args.pre_render).name,
            "pre_mask": Path(args.pre_mask).name,
            "goal_render": Path(args.goal_render).name,
            "goal_mask": Path(args.goal_mask).name,
        },
        "albedo_size": [w, h],
    }
    if args.chroma_grid:
        for need, label in ((args.chroma_pre_json, "--chroma-pre-json"),
                            (args.chroma_goal_json, "--chroma-goal-json"),
                            (args.landmarks_uv, "--landmarks-uv"),
                            (args.mouth_mask, "--mouth-mask")):
            if not need:
                raise SystemExit(f"chroma field needs {label}")
        try:
            nx_s, ny_s = args.chroma_grid.lower().split("x")
            nx_cells, ny_cells = int(nx_s), int(ny_s)
        except ValueError:
            raise SystemExit("chroma_grid must look like 6x5")
        pre_json = json.loads(Path(args.chroma_pre_json).read_text(encoding="utf8"))
        goal_json = json.loads(Path(args.chroma_goal_json).read_text(encoding="utf8"))
        landmarks = json.loads(Path(args.landmarks_uv).read_text(encoding="utf8"))
        mouth_mask = C.load_mask(Path(args.mouth_mask), (w, h))
        _my, _mx = np.where(mouth_mask > 0.5)
        if _my.size < MIN_MASK_TEXELS:
            raise RuntimeError("CHROMA_MOUTH_MASK_TOO_SMALL: refuse")
        # u runs down the face = array columns of the mask image.
        mouth_t = float(_mx.mean()) * float(landmarks.get("size", 4096)) / float(w)
        pre_keep = (C.load_mask(Path(args.pre_mask), (pw, ph)) > 0.5)
        goal_keep = (C.load_mask(Path(args.goal_mask), (gw, gh)) > 0.5)
        field = solve_regional_chroma(pre, pre_keep, pre_json, goal, goal_keep,
                                      goal_json, landmarks, mouth_t,
                                      nx_cells, ny_cells,
                                      float(args.chroma_sigma),
                                      mirror=bool(args.chroma_mirror),
                                      notch=bool(args.chroma_notch),
                                      notch_cores=args.chroma_notch_cores,
                                      luminance=bool(args.chroma_luminance))
        field["files"] = {
            "pre_mask_json": Path(args.chroma_pre_json).name,
            "goal_mask_json": Path(args.chroma_goal_json).name,
            "landmarks_uv": Path(args.landmarks_uv).name,
            "mouth_mask": Path(args.mouth_mask).name,
        }
        field["shas"] = {
            "pre_mask_json": C.sha256_file(Path(args.chroma_pre_json)),
            "goal_mask_json": C.sha256_file(Path(args.chroma_goal_json)),
            "landmarks_uv": C.sha256_file(Path(args.landmarks_uv)),
            "mouth_mask": C.sha256_file(Path(args.mouth_mask)),
        }
        params["regional_chroma"] = field
    out = Path(args.out_params)
    out.write_text(json.dumps(params, indent=1) + "\n", encoding="utf8")
    return params


def cmd_replay(args: argparse.Namespace) -> dict:
    params = json.loads(Path(args.params).read_text(encoding="utf8"))
    if params.get("method") not in ("global-lab6-v1", "global-lab6-v2"):
        raise RuntimeError(f"COLOUR_METHOD_MISMATCH "
                           f"{params.get('method')}: refuse")
    albedo_path = Path(args.input_albedo)
    mask_path = Path(args.albedo_mask)
    actual_albedo = C.sha256_file(albedo_path)
    if actual_albedo != params["shas"]["input_albedo"]:
        raise RuntimeError("COLOUR_INPUT_SHA_MISMATCH "
                           f"actual {actual_albedo[:16]} != expected "
                           f"{params['shas']['input_albedo'][:16]}: refuse")
    actual_mask = C.sha256_file(mask_path)
    if actual_mask != params["shas"]["albedo_mask"]:
        raise RuntimeError("COLOUR_MASK_SHA_MISMATCH "
                           f"actual {actual_mask[:16]} != expected "
                           f"{params['shas']['albedo_mask'][:16]}: refuse")
    rgb = C.load_rgb(albedo_path)
    h, w = rgb.shape[:2]
    face = _mask_or_refuse(mask_path, (w, h))
    # Use the FIXED source stats from the solve (source_albedo), not live stats.
    # The six numbers in params were computed against these fixed stats.
    src_mean = params["source_albedo"]["mean"]
    src_sd = params["source_albedo"]["std"]
    src_n = params["source_albedo"]["n"]
    six = params["six"]
    out = apply_transfer(rgb, src_mean, src_sd, six[:3], six[3:])
    field = params.get("regional_chroma")
    if field is not None:
        if field.get("method") != REGIONAL_CHROMA_METHOD:
            raise RuntimeError(f"COLOUR_CHROMA_METHOD_MISMATCH "
                               f"{field.get('method')}: refuse")
        # Stored a*/b* field on top of the global affine (L untouched).
        # Params without a field take the byte-identical path above.
        lab = C.lab_of(out).astype(np.float64)
        lab = apply_regional_chroma(lab, face, field, w)
        out = C.rgb_of(lab)
    d_before: float | None = None
    d_after: float | None = None
    nl = nr = 0
    if args.side_map:
        d_before, nl, nr = cheek_delta_l(rgb, face, Path(args.side_map),
                                         (w, h))
        d_after, _, _ = cheek_delta_l(out, face, Path(args.side_map),
                                      (w, h))
    C.save_rgb(Path(args.out), out)
    
    # Build per-region table (B3): forehead, cheeks L/R, nose, chin, upper lip
    # Mean Lab before | after | goal, and L/R cheek difference before | after
    # This requires the masks at the input size and the goal render stats.
    region_table = {}
    if "goal_render" in params:
        goal_mean = params["goal_render"]["mean"]
        goal_sd = params["goal_render"]["std"]
        
        # Load masks at input resolution
        masks = {}
        masks_dir = mask_path.parent
        for role in C.MASK_ROLES:
            cand = masks_dir / f"mask-{role}.png"
            if cand.is_file():
                masks[role] = C.load_mask(cand, (w, h))
        
        regions = C.regions_from_masks(masks)
        before_lab = C.lab_of(rgb).astype(np.float64)
        after_lab = C.lab_of(out).astype(np.float64)
        
        # Cheek L/R
        if "side" in masks:
            pos = masks["side"] > 0.78  # 200/255
            neg = masks["side"] < 0.22  # 55/255
        else:
            pos = neg = None
        
        fc = regions["facecore"]
        fys, fxs = np.where(fc)
        if len(fys) > 0:
            fy0, fy1 = int(fys.min()), int(fys.max())
            fx0, fx1 = int(fxs.min()), int(fxs.max())
            fhh = fy1 - fy0
            fww = fx1 - fx0
            cheek_top = fy0 + int(0.35 * fhh)
            cheek_mask = fc & (np.arange(h)[:, None] >= cheek_top)
            if pos is not None:
                left = cheek_mask & pos
                right = cheek_mask & neg
                dL_before = float(before_lab[left][:, 0].mean() - before_lab[right][:, 0].mean()) if int(left.sum()) >= 500 and int(right.sum()) >= 500 else None
                dL_after = float(after_lab[left][:, 0].mean() - after_lab[right][:, 0].mean()) if int(left.sum()) >= 500 and int(right.sum()) >= 500 else None
            else:
                dL_before = dL_after = None
        else:
            dL_before = dL_after = None
        
        # Per-region means
        for name in ["forehead", "cheeks", "nose", "chin", "upper_lip"]:
            if name == "forehead":
                mask = regions["forehead"]
            elif name == "cheeks":
                # Use cheek_mask from above
                mask = cheek_mask if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "nose":
                # Use facecore center region as proxy for nose
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.2 * fhh)) & (np.arange(h)[:, None] < fy0 + int(0.6 * fhh)) & (np.abs(np.arange(w)[None, :] - (fx0 + fx1) // 2) < int(0.15 * fww)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "chin":
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.7 * fhh)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            elif name == "upper_lip":
                mask = regions["facecore"] & (np.arange(h)[:, None] >= fy0 + int(0.55 * fhh)) & (np.arange(h)[:, None] < fy0 + int(0.7 * fhh)) if len(fys) > 0 else np.zeros_like(fc, dtype=bool)
            
            if int(mask.sum()) >= 64:
                before_m = before_lab[mask].mean(axis=0)
                after_m = after_lab[mask].mean(axis=0)
                region_table[name] = {
                    "before_Lab": [float(before_m[0]), float(before_m[1]), float(before_m[2])],
                    "after_Lab": [float(after_m[0]), float(after_m[1]), float(after_m[2])],
                    "goal_Lab": goal_mean,
                }
    
    report = {
        "mode": "colour-replay",
        "subject": params.get("subject"),
        "method": params.get("method"),
        "regional_chroma": (params.get("regional_chroma") or {}).get("method"),
        "six": six,
        "offset_D_render_minus_albedo":
            params.get("offset_D_render_minus_albedo"),
        "source_measured": {"mean": src_mean, "std": src_sd, "n": src_n},
        "cheek_delta_L": {"before": d_before, "after": d_after,
                          "n_left": nl, "n_right": nr},
        "region_table": region_table,
        "output_sha256": C.sha256_file(Path(args.out)),
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=1) + "\n",
                                      encoding="utf8")
    return report


def check() -> None:
    rng = np.random.default_rng(0)
    probe = rng.integers(0, 256, size=(32, 32, 3)).astype(np.uint8)
    rt = C.rgb_of(C.lab_of(probe).astype(np.float64)).astype(int)
    if np.abs(rt - probe.astype(int)).max() > 3:
        raise SystemExit("Lab round-trip drift too large")
    print("FACE_REPLAY_COLOUR_CHECK ok")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Replayable global colour solve")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--solve", action="store_true")
    ap.add_argument("--replay", action="store_true")
    ap.add_argument("--input-albedo", default=None)
    ap.add_argument("--albedo-mask", default=None)
    ap.add_argument("--pre-render", default=None)
    ap.add_argument("--pre-mask", default=None)
    ap.add_argument("--goal-render", default=None)
    ap.add_argument("--goal-mask", default=None)
    ap.add_argument("--subject", default=None)
    ap.add_argument("--out-params", default=None)
    ap.add_argument("--params", default=None)
    ap.add_argument("--side-map", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--report", default=None)
    ap.add_argument("--chroma-grid", default=None,
                    help="opt-in regional chroma field, e.g. 6x5 "
                         "(columns x rows over the below-brow band)")
    ap.add_argument("--chroma-sigma", type=float, default=1.0,
                    help="gaussian smooth of the field in cell units")
    ap.add_argument("--chroma-pre-json", default=None,
                    help="below-brow mask JSON for --pre-render")
    ap.add_argument("--chroma-goal-json", default=None,
                    help="below-brow mask JSON for --goal-render")
    ap.add_argument("--landmarks-uv", default=None,
                    help="derive landmarks-uv.json (mesh UV anchors)")
    ap.add_argument("--mouth-mask", default=None,
                    help="derive mask-lips.png (mesh mouth anchor)")
    ap.add_argument("--chroma-mirror", action="store_true",
                    help="average raw cell deltas about the midline so the "
                         "field adds no left/right difference of its own")
    ap.add_argument("--chroma-notch", action="store_true",
                    help="cosine-ramped spare of curved-midline cells "
                         "(nose/mouth shading zones)")
    ap.add_argument("--chroma-notch-cores", default="0.20,0.32,0.70;0.26,0.80,1.00",
                    help="notch cores as hx,ny0,ny1 triples in normalised units")
    ap.add_argument("--chroma-luminance", action="store_true",
                    help="add an optional low-frequency L channel to the "
                         "stored field (same grid/smoothing/fit-eval split; "
                         "fields without it replay exactly as before)")
    return ap


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.check:
        check()
        return
    if args.solve:
        if not args.input_albedo or not args.albedo_mask \
                or not args.pre_render or not args.pre_mask \
                or not args.goal_render or not args.goal_mask \
                or not args.subject or not args.out_params:
            raise SystemExit("solve needs --input-albedo --albedo-mask "
                             "--pre-render --pre-mask --goal-render "
                             "--goal-mask --subject --out-params")
        cmd_solve(args)
        return
    if args.replay:
        if not args.input_albedo or not args.albedo_mask \
                or not args.params or not args.out:
            raise SystemExit("replay needs --input-albedo --albedo-mask "
                             "--params --out")
        cmd_replay(args)
        return
    raise SystemExit("need --check, --solve or --replay")


if __name__ == "__main__":
    main()

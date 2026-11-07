"""Coarse symmetric strand-volume envelope for the station0b volume check.

Model: 7 stacked ellipse rings on the head frame (X lateral, U anterior+,
Z up, origin at the crown point) plus apex/hem fans. Ring geometry derives
from frozen head-section anchors (body surface half-width / front / back
per drop below crown) plus fitted offset parameters with bounds in mm.

Raster: pure NumPy projection with the pinned station cameras (matrixWorld
+ lens + sensor width verbatim); triangles filled with PIL polygon fill.
No Cycles, no renderer in the loop. Collision: offline voxel signed field
of the body (negative inside); envelope samples must stay at >= 0.

This module imports numpy/PIL/scipy only and never touches the network,
the renderer, or any look-card evidence path.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

FRAME = 1024
LOOP_N = 64

PARAM_ORDER = (
    "cap_top",
    "crown_w",
    "apex_front",
    "apex_back",
    "hairline_z",
    "side_hl",
    "back_hl",
    "side_ear",
    "back_ear",
    "curtain_front_ear",
    "side_jaw",
    "jaw_front",
    "back_jaw",
    "hem_drop",
    "hem_halfw",
    "hem_front",
    "hem_back",
)

DEFAULTS = {
    # name: (init_mm, lo_mm, hi_mm)
    "cap_top": (15.0, 6.0, 40.0),
    "crown_w": (60.0, 40.0, 95.0),
    "apex_front": (40.0, 15.0, 70.0),
    "apex_back": (45.0, 15.0, 80.0),
    "hairline_z": (70.0, 40.0, 105.0),
    "side_hl": (12.0, 3.0, 45.0),
    "back_hl": (12.0, 3.0, 45.0),
    "side_ear": (18.0, 3.0, 65.0),
    "back_ear": (18.0, 3.0, 65.0),
    "curtain_front_ear": (55.0, -40.0, 110.0),
    "side_jaw": (25.0, 3.0, 85.0),
    "jaw_front": (45.0, -60.0, 110.0),
    "back_jaw": (25.0, 3.0, 85.0),
    "hem_drop": (380.0, 260.0, 560.0),
    "hem_halfw": (105.0, 55.0, 175.0),
    "hem_front": (30.0, -80.0, 130.0),
    "hem_back": (-100.0, -170.0, -20.0),
}

EAR_DROP = 115.0
JAW_DROP = 170.0
SHOULDER_DROP = 255.0


def default_spec(anchors, crown, pins):
    """Build the frozen spec dict from measured anchors + pinned shas."""
    params = [
        {
            "name": name,
            "init_mm": DEFAULTS[name][0],
            "lo_mm": DEFAULTS[name][1],
            "hi_mm": DEFAULTS[name][2],
        }
        for name in PARAM_ORDER
    ]
    return {
        "schemaVersion": "openclinxr.envelope-spec.v1",
        "frame": "X lateral mm, U anterior+ mm rel crown, Z up mm; "
        "world = (X, crown_y - U, Z)",
        "rings": "apex, hairline, ear@115, jaw@170, shoulder@255(interp), "
        "mid(interp), hem; ellipse loops N=%d" % LOOP_N,
        "params": params,
        "anchors": anchors,
        "crown": [float(v) for v in crown],
        "pins": pins,
        "raster": {"frame": FRAME, "loopN": LOOP_N, "fill": "PIL polygon"},
        "collision": {
            "method": "offline voxel signed field of the body; negative "
            "inside; trilinear query",
        },
        "loss": {
            "model": "one-sided signed contour distance with Huber delta "
            "3 px; excess (fitted outside target) + miss (target outside "
            "fitted); hairline rows (<p15) and hem rows (>p80) weight x2",
            "huberDeltaPx": 3.0,
            "collisionWeight": 8.0,
            "collisionDeltaMm": 2.0,
            "smoothWeight": 0.02,
        },
    }


def interp_anchor(anchors, drop):
    """Linear-interp (xmax, ufront, uback) of the head section at a drop."""
    drops = np.array([row[0] for row in anchors], dtype=np.float64)
    arr = np.array(anchors, dtype=np.float64)
    out = []
    for col in (1, 2, 3):
        out.append(float(np.interp(drop, drops, arr[:, col])))
    return out  # xmax, ufront, uback


def build_world_mesh(params, anchors, crown):
    """Return (verts_world[N,3] in metres, faces[M,3]) for a param vector.

    params/anchors are mm in the head frame (X lateral, U anterior+ rel
    crown, drops below crown); crown is metres in the world frame.
    """
    p = dict(zip(PARAM_ORDER, [float(v) for v in params]))
    crown_mm = np.array(crown, dtype=np.float64) * 1000.0
    cx, cy, cz = (float(crown_mm[0]), float(crown_mm[1]), float(crown_mm[2]))

    def ring(drop, halfw, ufront, uback):
        z = cz - drop
        uc = 0.5 * (ufront + uback)
        t = np.linspace(0.0, 2.0 * np.pi, LOOP_N, endpoint=False)
        c, s = np.cos(t), np.sin(t)
        x = halfw * c
        u = np.where(s >= 0.0, uc + (ufront - uc) * s, uc - (uback - uc) * s)
        y = cy - u
        return np.stack([np.full_like(x, 0.0) + x, y, np.full_like(x, z)], axis=1)

    rings = []
    # apex ring above the crown
    rings.append(ring(-p["cap_top"], p["crown_w"], p["apex_front"], p["apex_back"]))
    # hairline ring on the forehead section
    xmax, ufront, uback = interp_anchor(anchors, p["hairline_z"])
    rings.append(
        ring(p["hairline_z"], xmax + p["side_hl"], ufront + 2.0, uback - p["back_hl"])
    )
    # ear ring
    xmax, _, uback = interp_anchor(anchors, EAR_DROP)
    rings.append(
        ring(
            EAR_DROP,
            xmax + p["side_ear"],
            p["curtain_front_ear"],
            uback - p["back_ear"],
        )
    )
    # jaw ring
    xmax, _, uback = interp_anchor(anchors, JAW_DROP)
    rings.append(
        ring(JAW_DROP, xmax + p["side_jaw"], p["jaw_front"], uback - p["back_jaw"])
    )
    # shoulder + mid rings interpolate jaw -> hem (no extra params)
    hem_w, hem_f, hem_b = p["hem_halfw"], p["hem_front"], p["hem_back"]
    jaw = rings[3]
    jaw_w = float(np.abs(jaw[:, 0]).max())
    jaw_u = cy - jaw[:, 1]
    jaw_f, jaw_b = float(jaw_u.max()), float(jaw_u.min())
    for drop, mix in (
        (SHOULDER_DROP, None),
        (0.5 * (SHOULDER_DROP + p["hem_drop"]), None),
    ):
        alpha = (drop - JAW_DROP) / (p["hem_drop"] - JAW_DROP)
        alpha = float(min(1.0, max(0.0, alpha)))
        w = (1.0 - alpha) * jaw_w + alpha * hem_w
        uf = (1.0 - alpha) * jaw_f + alpha * hem_f
        ub = (1.0 - alpha) * jaw_b + alpha * hem_b
        rings.append(ring(drop, w, uf, ub))
    # hem ring
    rings.append(ring(p["hem_drop"], hem_w, hem_f, hem_b))

    verts = np.vstack(rings)
    faces = []
    n = LOOP_N
    for r in range(len(rings) - 1):
        base0, base1 = r * n, (r + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append([base0 + i, base1 + i, base1 + j])
            faces.append([base0 + i, base1 + j, base0 + j])
    # apex fan (close the top) and hem fan (close the bottom for filling)
    top_c = verts.shape[0]
    top_pt = np.array([[0.0, cy - 0.5 * (p["apex_front"] + p["apex_back"]),
                        cz - (-p["cap_top"]) + 10.0]])
    verts = np.vstack([verts, top_pt])
    for i in range(n):
        faces.append([top_c, i, (i + 1) % n])
    hem_c = verts.shape[0]
    hem_ring = rings[-1]
    hem_pt = np.array(
        [[0.0, float(hem_ring[:, 1].mean()), float(hem_ring[:, 2].mean())]]
    )
    verts = np.vstack([verts, hem_pt])
    base = (len(rings) - 1) * n
    for i in range(n):
        faces.append([hem_c, base + (i + 1) % n, base + i])
    return verts / 1000.0, np.array(faces, dtype=np.int64)


def project_to_render(verts, cam, sensor_width_mm=36.0):
    """Pinhole project world verts with a pinned camera -> 1024 coords.

    cam: {matrixWorld 4x4, lensMm}. Square frame, sensor fit spans the
    width. Returns (cols, rows, depth) float64 arrays.
    """
    mat = np.array(cam["matrixWorld"], dtype=np.float64)
    inv = np.linalg.inv(mat)
    hom = np.ones((verts.shape[0], 4), dtype=np.float64)
    hom[:, :3] = verts
    local = (inv @ hom.T).T
    depth = -local[:, 2]
    focal_px = float(cam["lensMm"]) / float(sensor_width_mm) * FRAME
    cols = FRAME / 2.0 + (local[:, 0] / depth) * focal_px
    rows = FRAME / 2.0 - (local[:, 1] / depth) * focal_px
    return cols, rows, depth


def render_mask(verts, faces, cam, transform):
    """Fill projected triangles into a target-frame bool mask (1024)."""
    cols, rows, depth = project_to_render(verts, cam)
    if bool((depth <= 0).any()):
        raise ValueError("mesh behind camera")
    s = float(transform["scale"])
    img = Image.new("L", (FRAME, FRAME), 0)
    draw = ImageDraw.Draw(img)
    for tri in faces:
        pts = [
            (float(s * cols[k] + transform["tx"]),
             float(s * rows[k] + transform["ty"]))
            for k in tri
        ]
        draw.polygon(pts, fill=1)
    return np.asarray(img, dtype=bool)


def boundary(mask):
    """Boundary pixels of a bool mask."""
    return mask ^ ndimage.binary_erosion(mask)


def huber(d, delta):
    a = np.abs(np.asarray(d, dtype=np.float64))
    return np.where(a <= delta, 0.5 * a * a / delta, a - 0.5 * delta)


def band_limits(rows, top_frac=0.15, bottom_frac=0.20):
    """Row limits of the hairline band (top rows) and hem band."""
    lo = float(np.quantile(rows, top_frac))
    hi = float(np.quantile(rows, 1.0 - bottom_frac))
    return lo, hi


def band_weight(rows, lo, hi):
    """x2 weights for points inside the hairline/hem row bands."""
    rows = np.asarray(rows, dtype=np.float64)
    return np.where((rows <= lo) | (rows >= hi), 2.0, 1.0)


def contour_residuals(fitted, target, delta=3.0, k=600):
    """One-sided signed contour residuals between two bool masks.

    excess: fitted boundary points outside the target (Huber of the
    distance to the target boundary). miss: target boundary points
    outside the fitted mask. Both zero when covered. Each side samples
    exactly k points (deterministic order, tiled if short) so the
    residual vector has fixed length for least_squares.
    """
    bf = boundary(fitted)
    bt = boundary(target)
    edt_t = ndimage.distance_transform_edt(~bt)
    edt_f = ndimage.distance_transform_edt(~bf)
    fr, fc = np.nonzero(bf)
    tr, tc = np.nonzero(bt)
    lo, hi = band_limits(tr)
    order_f = np.lexsort((fc, fr))
    order_t = np.lexsort((tc, tr))
    take = lambda n: (np.linspace(0, n - 1, min(n, k)).astype(int)
                      if n else np.zeros(0, dtype=int))
    sel_f = take(fr.shape[0])
    sel_t = take(tr.shape[0])

    def tile(sel, n):
        if n >= k:
            return sel
        reps = int(np.ceil(k / max(n, 1)))
        return np.tile(sel, reps)[:k]

    sel_f = tile(sel_f, fr.shape[0])
    sel_t = tile(sel_t, tr.shape[0])
    sfr, sfc = fr[order_f][sel_f], fc[order_f][sel_f]
    str_, stc = tr[order_t][sel_t], tc[order_t][sel_t]
    outside_f = ~target[sfr, sfc]
    excess = (huber(edt_t[sfr, sfc], delta) * band_weight(sfr, lo, hi)
              * outside_f.astype(float))
    outside_t = ~fitted[str_, stc]
    miss = (huber(edt_f[str_, stc], delta) * band_weight(str_, lo, hi)
            * outside_t.astype(float))
    return np.concatenate([excess, miss])


def load_sdf(path):
    doc = np.load(str(path))
    return {
        "origin": np.array(doc["origin"], dtype=np.float64),
        "spacing": float(doc["spacing"]),
        "sdf": np.array(doc["sdf"], dtype=np.float64),
    }


def query_sdf(grid, points):
    """Trilinear sample of the signed field at world points (mm out)."""
    origin, h = grid["origin"], grid["spacing"]
    sdf = grid["sdf"]
    idx = (np.asarray(points, dtype=np.float64) - origin) / h
    lo = np.floor(idx).astype(np.int64)
    fr = idx - lo
    lo = np.clip(lo, 0, np.array(sdf.shape) - 2)
    fr = np.clip(fr, 0.0, 1.0)
    i0, j0, k0 = lo[:, 0], lo[:, 1], lo[:, 2]
    fx, fy, fz = fr[:, 0], fr[:, 1], fr[:, 2]
    c000 = sdf[i0, j0, k0]
    c100 = sdf[i0 + 1, j0, k0]
    c010 = sdf[i0, j0 + 1, k0]
    c110 = sdf[i0 + 1, j0 + 1, k0]
    c001 = sdf[i0, j0, k0 + 1]
    c101 = sdf[i0 + 1, j0, k0 + 1]
    c011 = sdf[i0, j0 + 1, k0 + 1]
    c111 = sdf[i0 + 1, j0 + 1, k0 + 1]
    c00 = c000 * (1 - fx) + c100 * fx
    c10 = c010 * (1 - fx) + c110 * fx
    c01 = c001 * (1 - fx) + c101 * fx
    c11 = c011 * (1 - fx) + c111 * fx
    c0 = c00 * (1 - fy) + c10 * fy
    c1 = c01 * (1 - fy) + c11 * fy
    return c0 * (1 - fz) + c1 * fz


def spec_path_of(station):
    return Path(station) / "envelope-spec.json"

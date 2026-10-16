"""FaceLandmarker polygon regions for the below-brow mask (handback 2).

Wires the proven tool tools/openclinxr/evidence/face-gate/face_gate.py
(read-and-import only; that file is never edited here): create_landmarker
+ detect_points supply 478 Face Mesh landmarks, region_polygons builds
the anatomical quads (forehead, cheek_side_a/b, chin, upperlip_skin),
raster_masks rasterizes them (erode_px=3, the face-gate default).

Model: face_gate.MODEL_PATH (tools/.../evidence/landmarks/models/...) is
absent from checkouts that only carry the asset store, so when it is
missing this module points at the pinned store copy
(/Volumes/files/openclinxr-assets/store/face-fit/face_landmarker.task,
sha 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff,
== face-fit/store-manifest.json) and records which path was used.

Each polygon is intersected with the eroded skin-gate largest component
(NOT the brow-row band: the anatomical forehead spans rows above
brow_row on both images, so the band would empty it; the quads carry
their own anatomical restriction). Lab is measured over the intersected
pixels with the same rgb2lab as the box patches. Cheek mapping:
cheek_side_a centroid x < cx on both images -> L_cheek (image-left,
matching the legacy cx-115 box); cheek_side_b -> R_cheek.

MIN_POLY_N = 300, the same confidence floor as the box patches
(PATCH_MIN_N): regions below it record Lab None.
"""
import hashlib
import os
import sys

import numpy as np

sys.path.insert(0, os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "..", "evidence", "face-gate")))
import face_gate as _FG  # noqa: E402  (read-only; never edited here)

FACE_GATE_MODULE = "face_gate"
STORE_MODEL = ("/Volumes/files/openclinxr-assets/store/face-fit/"
               "face_landmarker.task")
MIN_POLY_N = 300
ERODE_PX = 3  # face_gate.raster_masks default


def model_path():
    """face_gate.MODEL_PATH when present, else the pinned store copy."""
    if os.path.isfile(_FG.MODEL_PATH):
        return _FG.MODEL_PATH
    return STORE_MODEL


def model_sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def create_landmarker():
    """The proven tool's landmarker, with the model path wired above."""
    if not os.path.isfile(_FG.MODEL_PATH):
        _FG.MODEL_PATH = STORE_MODEL
    return _FG.create_landmarker()


def detect_twice(landmarker, pil_img):
    """Two detections; returns (pts, spread_px over 478x2)."""
    p1 = _FG.detect_points(landmarker, pil_img)
    p2 = _FG.detect_points(landmarker, pil_img)
    if p1 is None or p2 is None:
        raise RuntimeError("FaceLandmarker detected no face: refuse")
    return p1, float(np.abs(p1 - p2).max())


def polygon_regions(lab, skin_eroded, pil_img, landmarker):
    """Polygon Lab regions over skin-eroded pixels.

    Returns (regions, info) where regions maps forehead/L_cheek/R_cheek/
    chin/upperlip_skin to {center, n, gatefrac, Lab, poly_n, poly_bbox}
    and info carries landmarks rows, spread, and model provenance.
    """
    w, h = pil_img.size
    pts, spread = detect_twice(landmarker, pil_img)
    polys = _FG.region_polygons(pts)
    masks = _FG.raster_masks(polys, w, h, erode_px=ERODE_PX)
    cx_img = float(pts[:, 0].mean())
    mapping = {}
    for side in ("cheek_side_a", "cheek_side_b"):
        ys, xs = np.where(masks[side] > 0)
        mapping[side] = "L_cheek" if float(xs.mean()) < cx_img else "R_cheek"
    regions = {}
    for side, name in (("forehead", "forehead"),
                       ("cheek_side_a", mapping["cheek_side_a"]),
                       ("cheek_side_b", mapping["cheek_side_b"]),
                       ("chin", "chin"),
                       ("upperlip_skin", "upperlip_skin")):
        m = masks[side]
        poly_n = int(m.sum())
        sel = (m > 0) & (skin_eroded > 0)
        n = int(sel.sum())
        Lab = ([round(float(v), 2) for v in lab[sel].mean(axis=0)]
               if n >= MIN_POLY_N else None)
        if n:
            ys, xs = np.where(sel)
            center = [int(round(float(xs.mean()))),
                      int(round(float(ys.mean())))]
        else:
            center = [0, 0]
        ysp, xsp = np.where(m > 0)
        regions[name] = {
            "center": center, "n": n,
            "gatefrac": round(n / max(1, poly_n), 3), "Lab": Lab,
            "poly_n": poly_n,
            "poly_bbox_xywh": [int(xsp.min()), int(ysp.min()),
                               int(xsp.max() - xsp.min()),
                               int(ysp.max() - ysp.min())],
        }
    info = {"spread_px": spread,
            "model_path": model_path(), "model_sha256": model_sha(model_path()),
            "cheek_mapping": mapping,
            "lip_rows": {"p13_upper": round(float(pts[13][1]), 1),
                         "p14_lower": round(float(pts[14][1]), 1),
                         "corner_61": round(float(pts[61][1]), 1),
                         "corner_291": round(float(pts[291][1]), 1)}}
    return regions, info, polys

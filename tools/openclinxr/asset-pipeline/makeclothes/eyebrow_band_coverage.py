#!/usr/bin/env python3
"""Pure-NumPy eye-anchored eyebrow band coverage primitives."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


GRID_X = 96
GRID_Y = 24
PAD_X = 0.5
Y_BELOW = 0.3
Y_ABOVE = 0.5


@dataclass(frozen=True)
class BandCoverage:
    cells_covered: int
    cells_total: int
    cell_fraction: float
    projected_ink_area: float
    projected_ink_fraction: float


def eye_anchored_band(
    eye_vertices: np.ndarray,
    *,
    horizontal_axis: int = 0,
    vertical_axis: int = 2,
) -> tuple[float, float, float, float]:
    """Return the v2 TS band as (horizontal min/max, vertical min/max)."""
    eyes = np.asarray(eye_vertices, dtype=np.float64)
    horizontal = eyes[:, horizontal_axis]
    vertical = eyes[:, vertical_axis]
    x0, x1 = float(horizontal.min()), float(horizontal.max())
    y0, y1 = float(vertical.min()), float(vertical.max())
    width, height = x1 - x0, y1 - y0
    return (
        x0 - PAD_X * width,
        x1 + PAD_X * width,
        y1 - Y_BELOW * height,
        y1 + Y_ABOVE * height,
    )


def cells_covered_by_triangles(
    vertices: np.ndarray,
    triangles: np.ndarray,
    band: tuple[float, float, float, float],
    *,
    horizontal_axis: int = 0,
    vertical_axis: int = 2,
) -> np.ndarray:
    """Rasterize triangle coverage at the 96x24 cell centres used by v2 TS."""
    verts = np.asarray(vertices, dtype=np.float64)
    tris = np.asarray(triangles, dtype=np.int64).reshape((-1, 3))
    x0, x1, y0, y1 = band
    cell_w = (x1 - x0) / GRID_X
    cell_h = (y1 - y0) / GRID_Y
    hit = np.zeros(GRID_X * GRID_Y, dtype=np.uint8)
    for tri in tris:
        points = verts[tri]
        ax, bx, cx = points[:, horizontal_axis]
        ay, by, cy = points[:, vertical_axis]
        denominator = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(denominator) < 1e-12:
            continue
        gx0 = max(0, int(np.floor((min(ax, bx, cx) - x0) / cell_w)))
        gx1 = min(GRID_X - 1, int(np.ceil((max(ax, bx, cx) - x0) / cell_w)))
        gy0 = max(0, int(np.floor((min(ay, by, cy) - y0) / cell_h)))
        gy1 = min(GRID_Y - 1, int(np.ceil((max(ay, by, cy) - y0) / cell_h)))
        for gy in range(gy0, gy1 + 1):
            for gx in range(gx0, gx1 + 1):
                offset = gy * GRID_X + gx
                if hit[offset]:
                    continue
                px = x0 + (gx + 0.5) * cell_w
                py = y0 + (gy + 0.5) * cell_h
                w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / denominator
                w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / denominator
                if w0 >= -1e-6 and w1 >= -1e-6 and 1.0 - w0 - w1 >= -1e-6:
                    hit[offset] = 1
    return hit


def projected_ink_area(
    vertices: np.ndarray,
    triangles: np.ndarray,
    *,
    horizontal_axis: int = 0,
    vertical_axis: int = 2,
) -> float:
    """Sum triangle area projected onto the brow band plane."""
    verts = np.asarray(vertices, dtype=np.float64)
    points = verts[np.asarray(triangles, dtype=np.int64).reshape((-1, 3))]
    ax, bx, cx = points[:, :, horizontal_axis].T
    ay, by, cy = points[:, :, vertical_axis].T
    return float(np.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)).sum() / 2.0)


def measure_band_coverage(
    brow_vertices: np.ndarray,
    brow_triangles: np.ndarray,
    eye_vertices: np.ndarray,
    *,
    horizontal_axis: int = 0,
    vertical_axis: int = 2,
) -> BandCoverage:
    """Measure cell coverage and projected strand ink with one predicate."""
    band = eye_anchored_band(
        eye_vertices, horizontal_axis=horizontal_axis, vertical_axis=vertical_axis
    )
    hit = cells_covered_by_triangles(
        brow_vertices,
        brow_triangles,
        band,
        horizontal_axis=horizontal_axis,
        vertical_axis=vertical_axis,
    )
    ink = projected_ink_area(
        brow_vertices,
        brow_triangles,
        horizontal_axis=horizontal_axis,
        vertical_axis=vertical_axis,
    )
    band_area = (band[1] - band[0]) * (band[3] - band[2])
    covered = int(hit.sum())
    total = GRID_X * GRID_Y
    return BandCoverage(covered, total, covered / total, ink, ink / band_area)

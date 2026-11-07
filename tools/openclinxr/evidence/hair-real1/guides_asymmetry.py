"""Seeded per-side guide perturbations for hair-real1.

This is a scoped copy of the guide-level responsibility from the frozen
curtain/top stations.  It consumes their immutable guide roots and assigns
independent left/right perturbation tables; it never rewrites the sources.
"""
from __future__ import annotations

import numpy as np


PARAMS = {
    "seedLeft": 2026101411,
    "seedRight": 2026101429,
    "rootAlongScalpMaxMm": 0.10,
    "flowAngleMaxDeg": 2.5,
    "liftOffMaxMm": 0.10,
    "hangClearanceMaxMm": 0.50,
}


def assign_guides(roots: np.ndarray, guide_roots: np.ndarray, cx: float) -> np.ndarray:
    """Nearest same-side guide, chunked to keep the 69k station bounded."""
    out = np.empty(len(roots), np.int32)
    guide_side = guide_roots[:, 0] >= cx
    root_side = roots[:, 0] >= cx
    for side in (False, True):
        gids = np.flatnonzero(guide_side == side)
        ids = np.flatnonzero(root_side == side)
        for start in range(0, len(ids), 2048):
            take = ids[start:start + 2048]
            distance = np.linalg.norm(roots[take, None, :] - guide_roots[gids][None, :, :], axis=2)
            out[take] = gids[np.argmin(distance, axis=1)]
    return out


def perturbation_table(guide_roots: np.ndarray, cx: float) -> dict[str, np.ndarray]:
    """Independent bounded draws for each side; no mirrored samples."""
    rows = {name: np.zeros(len(guide_roots), float) for name in ("root_mm", "flow_deg", "lift_mm", "clear_mm")}
    for side, seed in ((False, PARAMS["seedLeft"]), (True, PARAMS["seedRight"])):
        ids = np.flatnonzero((guide_roots[:, 0] >= cx) == side)
        rng = np.random.default_rng(seed)
        rows["root_mm"][ids] = rng.uniform(-PARAMS["rootAlongScalpMaxMm"], PARAMS["rootAlongScalpMaxMm"], len(ids))
        rows["flow_deg"][ids] = rng.uniform(-PARAMS["flowAngleMaxDeg"], PARAMS["flowAngleMaxDeg"], len(ids))
        rows["lift_mm"][ids] = rng.uniform(-PARAMS["liftOffMaxMm"], PARAMS["liftOffMaxMm"], len(ids))
        rows["clear_mm"][ids] = rng.uniform(-PARAMS["hangClearanceMaxMm"], PARAMS["hangClearanceMaxMm"], len(ids))
    return rows

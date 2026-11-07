"""Independent child-root seeds and optional triangle-weight decorrelation."""
from __future__ import annotations

import math
import numpy as np

import guides_asymmetry as G


CHILD_PARAMS = {
    "seedLeft": 2026101453,
    "seedRight": 2026101471,
    "rootJitterMaxMm": 0.03,
    "triangleWeightJitterSeed": 2026101493,
    "triangleWeightEquivalentMaxMm": 0.65,
}


def smooth(value):
    value = np.clip(value, 0.0, 1.0)
    return value * value * (3.0 - 2.0 * value)


def arc(points):
    return np.concatenate([np.zeros((len(points), 1)), np.cumsum(np.linalg.norm(np.diff(points, axis=1), axis=2), axis=1)], axis=1)


def _rotate_xy(vectors, radians):
    c, s = np.cos(radians), np.sin(radians)
    out = vectors.copy()
    out[..., 0] = c * vectors[..., 0] - s * vectors[..., 1]
    out[..., 1] = s * vectors[..., 0] + c * vectors[..., 1]
    return out


def asymmetry(points, roots, guide_roots, cx, scalp_center):
    """Apply bounded guide-level fields plus independent per-side child seeds.

    The central +/-3 mm root band is frozen so the existing single clean part
    line cannot split or zig-zag.  Flow changes vanish at both endpoints, so
    the accepted hem/end-angle construction remains intact.
    """
    out = np.asarray(points, float).copy()
    new_roots = np.asarray(roots, float).copy()
    guide_id = G.assign_guides(new_roots, guide_roots, cx)
    table = G.perturbation_table(guide_roots, cx)
    protected = np.abs(new_roots[:, 0] - cx) <= 0.003
    active = ~protected
    side = np.where(new_roots[:, 0] >= cx, 1.0, -1.0)
    s = arc(out)
    u = s / np.maximum(s[:, -1, None], 1e-9)

    # The lateral sheet axis is tangent to the cap near the centre part and
    # depth-only in the 90-degree profile.  Encode the independent signed
    # root draws around a small outward baseline so no child enters the head.
    normal = new_roots - np.asarray(scalp_center, float)[None, :]
    normal /= np.maximum(np.linalg.norm(normal, axis=1, keepdims=True), 1e-9)
    root_mm = table["root_mm"][guide_id]
    root_arc = root_mm / 1000.0

    # Independent child root samples on each side (not paired by mirror ID).
    child_mm = np.zeros(len(out), float)
    for is_right, seed in ((False, CHILD_PARAMS["seedLeft"]), (True, CHILD_PARAMS["seedRight"])):
        ids = np.flatnonzero(((new_roots[:, 0] >= cx) == is_right) & active)
        child_mm[ids] = np.random.default_rng(seed).uniform(-CHILD_PARAMS["rootJitterMaxMm"], CHILD_PARAMS["rootJitterMaxMm"], len(ids))
    root_arc += child_mm / 1000.0
    root_fraction = root_arc / max(G.PARAMS["rootAlongScalpMaxMm"] / 1000.0 + CHILD_PARAMS["rootJitterMaxMm"] / 1000.0, 1e-9)
    root_delta = np.zeros_like(new_roots)
    root_delta[:, 0] = side * (0.06 + 0.03 * np.clip(root_fraction, -1.0, 1.0)) / 1000.0
    root_delta[~active] = 0.0
    root_fade = 1.0 - smooth(s / 0.055)
    out += root_delta[:, None, :] * root_fade[:, :, None]
    new_roots += root_delta

    # Guide flow angle is strongest through the crown/upper sheet and returns
    # exactly to the accepted tip.  Rotation is about the perturbed root.
    relative = out - out[:, :1]
    angle_fraction = table["flow_deg"][guide_id] / G.PARAMS["flowAngleMaxDeg"]
    off_scalp = smooth(np.clip((s - 0.150) / 0.080, 0.0, 1.0))
    flow_weight = (np.sin(np.pi * u) ** 1.25) * off_scalp * active[:, None]
    # Encode the independent signed angle draw as 0.05--0.25 mm of outward
    # lateral flow.  This preserves the angle field's ordering but cannot
    # rotate a child back through the head collider.
    flow_mm = 0.15 + 0.10 * angle_fraction
    out[:, :, 0] += side[:, None] * (flow_mm[:, None] / 1000.0) * flow_weight

    # Guide lift-off is a collar bump; hang clearance is a mid/lower-sheet
    # lateral offset.  Both are side-independent random fields and endpoint 0.
    # All collars remain outside the surface: +/-0.1 mm is varied around a
    # 0.15 mm lift baseline, rather than allowing negative lift to penetrate.
    lift = (0.15 + table["lift_mm"][guide_id]) / 1000.0
    lift_weight = np.sin(np.pi * np.clip(s / 0.080, 0.0, 1.0)) * (s <= 0.080)
    out[:, :, 0] += side[:, None] * lift[:, None] * lift_weight * active[:, None]
    clear = (0.11 + 0.20 * table["clear_mm"][guide_id]) / 1000.0
    clear_weight = (np.sin(np.pi * u) ** 2) * smooth(np.clip((s - 0.150) / 0.080, 0.0, 1.0))
    out[:, :, 0] += side[:, None] * clear[:, None] * clear_weight * active[:, None]
    return out, new_roots, guide_id


def decorrelate_triangle_weights(points, roots, cx):
    """Per-child equivalent blend-weight jitter, zero at root and tip.

    The frozen station stores baked children rather than parent weights.  A
    bounded local-sheet displacement is the exact downstream degree of
    freedom produced by jittering weights inside the same guide triangle.
    """
    out = np.asarray(points, float).copy()
    rng = np.random.default_rng(CHILD_PARAMS["triangleWeightJitterSeed"])
    amount = rng.uniform(-CHILD_PARAMS["triangleWeightEquivalentMaxMm"], CHILD_PARAMS["triangleWeightEquivalentMaxMm"], len(out)) / 1000.0
    protected = np.abs(roots[:, 0] - cx) <= 0.003
    amount[protected] = 0.0
    s = arc(out)
    u = s / np.maximum(s[:, -1, None], 1e-9)
    # Two incommensurate lobes break guide-cell coherence without a new band.
    weight = np.sin(np.pi * u) * (0.65 + 0.35 * np.sin(2.0 * np.pi * u + rng.uniform(-math.pi, math.pi, len(out))[:, None]))
    tangent = np.gradient(out, axis=1)
    tangent /= np.maximum(np.linalg.norm(tangent, axis=2, keepdims=True), 1e-9)
    radial = out.copy()
    radial[:, :, 0] -= cx
    radial[:, :, 2] = 0.0
    radial /= np.maximum(np.linalg.norm(radial, axis=2, keepdims=True), 1e-9)
    sheet = np.cross(tangent, radial)
    sheet /= np.maximum(np.linalg.norm(sheet, axis=2, keepdims=True), 1e-9)
    out += sheet * (amount[:, None] * weight)[:, :, None]
    return out

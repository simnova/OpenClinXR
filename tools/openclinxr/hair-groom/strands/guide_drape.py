"""Guide drape correction for the Blender Essentials children stage.

Diagnosis (hair-groom13): the lower back sheet splits because the
field-traced guides themselves spread apart below the crown -- guide
roots are uniform across the back, but guide shapes in the band
|x| < ~30 mm lean AWAY from the centre (|lean| 5-24 mm at the tips,
measured on guides-8a), while the interpolation faithfully follows
them (centre-rooted children end ~17 mm left at the hem). "Part by
Mesh Islands" is a no-op here (head UV has no seams; islands=0 build
byte-comparable migration), and Clump 0 changes nothing, so the
split is guide-drape, not interpolation side-keying.

Correction: collapse the lateral (x) component of posterior guide
shapes progressively below the crown, keeping y/z drape (head-follow
+ length) and roots untouched. The crown part survives because (a)
roots are untouched and (b) the falloff keeps w=1 within 20 mm below
the crown. Front/side guides are untouched (posterior-only gate), so
the curtain and temples cannot regress from this step.

All operations are deterministic numpy (no randomness).
"""
from __future__ import annotations

import numpy as np


def collapse_lateral(guides_w: np.ndarray, crown: np.ndarray,
                     keep: float = 0.0,
                     y_post_m: float = 0.01,
                     z_top_below_crown_m: float = 0.02,
                     z_full_below_crown_m: float = 0.10,
                     root_band_m: float = 0.070,
                     mean_r_m: float = 0.020) -> tuple[np.ndarray, dict]:
    """Remove part-away lateral divergence below the crown.

    guides_w: (N, P, 3) world-metre guides. crown: (3,) world crown.
    keep: residual divergent fraction below the falloff (0 = fully
      local-mean drape). Only guides with root |root_x| <= root_band_m
      and points posterior of crown (y > crown[1] + y_post_m) are
      touched.

    METHOD (v4): each guide's lateral (x) shape is blended toward the
    LOCAL MEAN x-shape of guides rooted within mean_r_m (both sides).
    The local mean is continuous by construction, so no side-switching
    crease can form; because neighbours ride the same surface region,
    the mean stays surface-following (sagitta ~0.4 mm at R=20 mm,
    inside the shrinkwrap offset). Divergent (part-away) components
    cancel in the mean; one-sided neighbourhoods (part gap edges) keep
    their drape, preserving the crown part through the falloff.
    (v1/v2 straight-hang buried hair on the curved head; v3 mirror
    averaging is a fixed point on symmetric divergence.)
    """
    g = np.asarray(guides_w, dtype=np.float64).copy()
    crown = np.asarray(crown, dtype=np.float64)
    n, P = g.shape[0], g.shape[1]
    r = g[:, 0, :]
    d2 = ((r[:, None, :] - r[None, :, :]) ** 2).sum(axis=-1)
    M = d2 <= mean_r_m ** 2
    cnt = M.sum(axis=1)
    mean_x = (M.astype(np.float64) @ g[:, :, 0]) / cnt[:, None]
    in_band = np.abs(g[:, 0, 0]) <= root_band_m
    z = g[:, :, 2]
    z_top = crown[2] - z_top_below_crown_m
    z_bot = crown[2] - z_full_below_crown_m
    t = np.clip((z - z_bot) / max(z_top - z_bot, 1e-9), 0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    w = keep + (1.0 - keep) * t
    post = g[:, :, 1] > crown[1] + y_post_m
    gate = in_band[:, None] & post
    n_touched = int(gate.sum())
    g[:, :, 0] = np.where(gate, mean_x * (1.0 - w) + g[:, :, 0] * w,
                          g[:, :, 0])
    stats = {"nGuides": int(n),
             "nGuidesInBand": int(in_band.sum()),
             "meanNeighbours": float(cnt.mean()),
             "nPointsTouched": n_touched,
             "keep": float(keep)}
    return g, stats


def tuck_sideburn(guides_w: np.ndarray, pinna_xyz: np.ndarray,
                  idx_pos: np.ndarray, idx_neg: np.ndarray,
                  clear_m: float = 0.008,
                  corr_x_m: float = 0.064,
                  strength: float = 0.7) -> tuple[np.ndarray, dict]:
    """Route ear-crossing guides into the post-auricular corridor.

    Measured (ear_pinna SDF profiles): behind the pinna back edge the
    mastoid surface sits at |x| ~ 58-62 mm, so the valid tuck corridor
    is (|x| ~ 62-68 mm, y ~ pinna_top_y + 11 mm), reading SDF +3..+6 mm
    (just off the skull, behind the ear). A medial pull (v1) buried
    hair up to 25 mm deep -- the SDF has no sulcus at pinna depth, so
    the tuck must go posterior, not medial.

    Gate: root in the broad sideburn box per side AND min path distance
    to any pinna vert < clear_m (through/around-ear guides = the knot
    contributors; already-tucked or anterior-wisp guides passing clear
    are untouched). Correction: windowed (in below the pinna top,
    released below the pinna bottom so the hem hangs free) attraction
    toward the corridor; already-correct guides barely move.
    Deterministic numpy (pure-numpy distances: Blender has no scipy).
    """
    g = np.asarray(guides_w, dtype=np.float64).copy()
    pinna_xyz = np.asarray(pinna_xyz, dtype=np.float64)

    def _min_dist(pts):
        best = np.full(len(pts), np.inf)
        for a in range(0, len(pinna_xyz), 64):
            d = np.linalg.norm(
                pts[:, None, :] - pinna_xyz[None, a:a + 64, :], axis=2)
            best = np.minimum(best, d.min(axis=1))
        return best

    n_hit = 0
    per_side = {}
    P = g.shape[1]
    for _s, _idx in ((1.0, idx_pos), (-1.0, idx_neg)):
        s = float(_s)
        pv = pinna_xyz[np.asarray(_idx)]
        pc = pv.mean(axis=0)
        pyc = float(pc[1])
        pz1 = float(pv[:, 2].max())
        pz0 = float(pv[:, 2].min())
        # corridor target: just off the mastoid behind the pinna
        tx = s * corr_x_m
        tyy = float(pv[:, 1].max()) + 0.011
        r = g[:, 0, :]
        inroot = ((np.sign(r[:, 0]) == s)
                  & (np.abs(r[:, 0]) >= 0.030)
                  & (np.abs(r[:, 0]) <= 0.110)
                  & (r[:, 1] >= pyc - 0.060)
                  & (r[:, 1] <= pyc + 0.040)
                  & (r[:, 2] >= pz0 - 0.010))
        cand = np.nonzero(inroot)[0]
        if len(cand) == 0:
            per_side[str(s)] = {"candidates": 0, "hit": 0}
            continue
        dd = _min_dist(g[cand].reshape(-1, 3))
        hit = cand[dd.reshape(len(cand), P).min(axis=1) < clear_m]
        if len(hit) == 0:
            per_side[str(s)] = {"candidates": int(len(cand)), "hit": 0}
            continue
        m = np.zeros((len(g), P), dtype=bool)
        m[hit, :] = True
        z = g[:, :, 2]
        up = np.clip((pz1 + 0.005 - z) / 0.015, 0.0, 1.0)
        up = up * up * (3.0 - 2.0 * up)
        dn = np.clip((z - (pz0 - 0.060)) / 0.060, 0.0, 1.0)
        dn = dn * dn * (3.0 - 2.0 * dn)
        w = np.where(m, up * dn, 0.0)
        x = g[:, :, 0]
        pull_x = np.clip((np.abs(x) - 0.060) / 0.020, 0.0, 1.0)
        g[:, :, 0] = x + (tx - x) * strength * pull_x * w
        y = g[:, :, 1]
        need_y = np.clip(tyy - y, 0.0, None)
        g[:, :, 1] = y + need_y * strength * w
        n_hit += int(len(hit))
        per_side[str(s)] = {"candidates": int(len(cand)),
                            "hit": int(len(hit))}
    return g, {"nGuidesHit": n_hit, "perSide": per_side,
               "clearM": clear_m, "corrXM": corr_x_m,
               "strength": strength}

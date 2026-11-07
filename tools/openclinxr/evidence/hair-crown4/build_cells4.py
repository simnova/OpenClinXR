#!/usr/bin/env python3
"""hair-crown4 STEP 2 strand cells (numpy; deterministic).

Diagnosis: 20-26mm bare band (zero roots) between cap front boundary
(y=-0.148) and first roots (y=-0.124); front strands dive forward-down
(sideways 0.42 vs part-flow 1.00) instead of sweeping sideways flat;
no standoff where strands exist (B cleared).

Cells (base = crown2 spread.npz, 73228; 32 pts/strand; no strip geometry):
  fill_flat : +N roots in the bare band (|x|>=2mm seam kept for the part
              line), strands draped ON the scalp (0.4-1.0mm lift) with
              part-like sideways-flat flow, L=45mm, curving back at the
              edges and conformed to the scalp every step. FULL SET.
  flatten   : reshape the first 40mm of existing front strands
              (roots y<-0.10) to the same hug+sideways flow, lerped back
              to the original shape (no new strands). REVERTED on scoring
              (thins crown centre: -1944 centre TP, IoU f -0.078).
  fill_long : +N roots in the bare band, L=90mm, sideways arcing to
              backward (target sweep), conformed to the scalp. FULL SET.
  side_fill : +N roots in the bare band flanks only (|x| in [25,45]mm),
              L=45mm flat drape arcing back. FULL SET.
  edge_fill : +N roots just behind the band (y in [-0.124,-0.110],
              |x|>=2mm), L=30mm flat sideways drape reaching INTO the
              band from behind (no forehead-ward roots). FULL SET.
  combo     : v1 = flatten + fill_flat + fill_long (REVERTED as composed:
              IoU f -0.037, ori f +2.4). v2 in build_cells4b.
Raw outputs *_raw.npz; repair runs in Blender (repair_cells4.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

E = Path(__file__).resolve().parent
C2 = E.parent / "hair-crown2"
C3 = E.parent / "hair-crown3"
BASE = C2 / "cells" / "spread.npz"
CAP = C3 / "probe_out" / "cap_live.npz"

N_FILL = 4200
SEAM = 0.002
GAP_Y0, GAP_Y1 = -0.146, -0.122
LIFT0, LIFTBOW = 0.0004, 0.0006
NPTS = 32


def vert_normals(V: np.ndarray, F: np.ndarray) -> np.ndarray:
    N = np.zeros_like(V)
    e1 = V[F[:, 1]] - V[F[:, 0]]
    e2 = V[F[:, 2]] - V[F[:, 0]]
    fn = np.cross(e1, e2)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    n = np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    return N / n


class Scalp:
    def __init__(self):
        cap = np.load(CAP)
        self.V = np.asarray(cap["verts"], dtype=float)
        self.F = np.asarray(cap["faces"], dtype=int)
        self.N = vert_normals(self.V, self.F)

    def query(self, xy: np.ndarray):
        """Nearest cap vert (xy) -> (z, normal). Chunked."""
        z = np.empty(len(xy))
        nrm = np.empty((len(xy), 3))
        dxy = np.empty(len(xy))
        for i in range(0, len(xy), 512):
            d2 = ((self.V[None, :, :2] - xy[i:i + 512, None, :]) ** 2).sum(-1)
            j = d2.argmin(axis=1)
            z[i:i + 512] = self.V[j, 2]
            nrm[i:i + 512] = self.N[j]
            dxy[i:i + 512] = np.sqrt(d2.min(axis=1))
        return z, nrm, dxy

    def height(self, P: np.ndarray):
        """Signed height above scalp (nearest 3D vert normal projection)."""
        h = np.empty(len(P))
        for i in range(0, len(P), 512):
            d2 = ((self.V[None, :, :] - P[i:i + 512, None, :]) ** 2).sum(-1)
            j = d2.argmin(axis=1)
            h[i:i + 512] = ((P[i:i + 512] - self.V[j]) * self.N[j]).sum(axis=1)
        return h


def flow_dir(xs: np.ndarray, progress: np.ndarray, long: bool) -> np.ndarray:
    """Sideways-from-part flow in scalp tangent plane (unnormalized xyz).

    Center: mostly sideways; edges (|x|->45mm): mostly backward so strands
    stay on the cap. Long strands additionally arc backward with progress.
    """
    sx = np.sign(xs)
    edge = np.clip(np.abs(xs) / 0.045, 0.0, 1.0)
    if long:
        fwd_side = (1.0 - edge) * (1.0 - 0.7 * progress)
        back = 0.15 + 0.85 * np.maximum(edge, progress)
    else:
        fwd_side = 1.0 - 0.85 * edge
        back = 0.15 + 0.85 * edge
    return np.c_[sx * fwd_side, back, np.zeros(len(xs))]


def drape(scalp: Scalp, roots_xy: np.ndarray, L: float, long: bool) -> np.ndarray:
    """Conformed drape strands: step along tangent-projected flow, snap to
    scalp + lift each step; redirect toward cap interior if leaving footprint.
    Returns (M, NPTS, 3)."""
    M = len(roots_xy)
    z0, _, _ = scalp.query(roots_xy)
    P = np.empty((M, NPTS, 3))
    P[:, 0, :2] = roots_xy
    P[:, 0, 2] = z0 + LIFT0
    s_grid = np.linspace(0.0, L, NPTS)
    for k in range(1, NPTS):
        ds = s_grid[k] - s_grid[k - 1]
        prog = s_grid[k - 1] / L
        cur = P[:, k - 1, :]
        zc, nrm, dxy = scalp.query(cur[:, :2])
        f = flow_dir(cur[:, 0], np.full(M, prog), long)
        t = f - nrm * (nrm * f).sum(axis=1)[:, None]
        tn = np.linalg.norm(t, axis=1, keepdims=True) + 1e-12
        t = t / tn
        off = dxy > 0.003
        if off.any():
            # redirect leavers toward the nearest cap point (interior)
            idx = np.flatnonzero(off)
            d2 = ((scalp.V[None, :, :2] - cur[idx, None, :2]) ** 2).sum(-1)
            j = d2.argmin(axis=1)
            to = scalp.V[j] - cur[idx]
            to -= nrm[idx] * (nrm[idx] * to).sum(axis=1)[:, None]
            tn2 = np.linalg.norm(to, axis=1, keepdims=True) + 1e-12
            t[idx] = 0.5 * t[idx] + 0.5 * (to / tn2)
            t[idx] /= np.linalg.norm(t[idx], axis=1, keepdims=True) + 1e-12
        nxt = cur + t * ds
        zn, _, _ = scalp.query(nxt[:, :2])
        lift = LIFT0 + LIFTBOW * np.sin(np.pi * s_grid[k] / L)
        nxt[:, 2] = zn + lift
        P[:, k, :] = nxt
    return P


def sample_band_roots(scalp: Scalp, rng: np.random.Generator, n: int, seed_tag: str):
    xs_list, ys_list = [], []
    need = n
    guard = 0
    while need > 0 and guard < 40:
        ys = rng.uniform(GAP_Y0, GAP_Y1, need * 2)
        xs = rng.uniform(-0.045, 0.045, need * 2)
        keep = np.abs(xs) >= SEAM
        xs, ys = xs[keep], ys[keep]
        _, _, dxy = scalp.query(np.c_[xs, ys])
        inside = dxy < 0.002
        xs_list.append(xs[inside][:need])
        ys_list.append(ys[inside][:need])
        need -= int(inside.sum())
        guard += 1
    xs = np.concatenate(xs_list)[:n]
    ys = np.concatenate(ys_list)[:n]
    z, _, _ = scalp.query(np.c_[xs, ys])
    return np.c_[xs, ys, z + LIFT0]


def main():
    rng = np.random.default_rng(7)
    scalp = Scalp()
    src = np.load(BASE)
    points = np.asarray(src["points"], dtype=float)
    roots = np.asarray(src["roots"], dtype=float)
    radii = np.asarray(src["radii"], np.float32)
    apex, cx = float(src["apex_y"]), float(src["cx"])
    cells = E / "cells"
    cells.mkdir(exist_ok=True)
    meta: dict = {}

    prof_m = (roots[:, 1] >= -0.124) & (roots[:, 1] < -0.09)
    prof = np.median(radii[prof_m], axis=0).astype(np.float32)

    # ---- fill_flat ----
    froots = sample_band_roots(scalp, rng, N_FILL, "flat")
    fstr = drape(scalp, froots[:, :2], 0.045, long=False)
    h = scalp.height(fstr.reshape(-1, 3)).reshape(len(fstr), -1)
    meta["fill_flat"] = {"added": len(froots), "lengthMm": 45,
                         "heightMm": {"p50": round(float(np.median(h)) * 1000, 2),
                                      "max": round(float(h.max()) * 1000, 2)}}
    np.savez_compressed(cells / "fill_flat_raw.npz",
                        points=fstr.astype(np.float32),
                        roots=froots.astype(np.float32),
                        radii=np.tile(prof, (len(froots), 1)),
                        apex_y=apex, cx=cx)
    print("fill_flat", len(froots), "h p50/max mm",
          round(float(np.median(h)) * 1000, 2), round(float(h.max()) * 1000, 2), flush=True)

    # ---- flatten (reshape existing front strands, no new roots) ----
    fz = np.flatnonzero(roots[:, 1] < -0.10)
    seg = np.linalg.norm(np.diff(points[fz], axis=1), axis=2)
    cum = np.cumsum(seg, axis=1)
    flat_pts = points.copy()
    for ii, gi in enumerate(fz):
        c = np.concatenate([[0.0], cum[ii]])
        j = int(np.searchsorted(c, 0.040, side="right"))
        j = min(max(j, 8), NPTS - 1)
        new = drape(scalp, roots[gi:gi + 1, :2], 0.040, long=False)[0]
        # resample new (32 pts over 40mm) onto first j+1 slots, lerp tail
        use = np.linspace(0, NPTS - 1, j + 1).astype(int)
        flat_pts[gi, :j + 1] = new[use]
        tail = min(8, NPTS - 1 - j)
        for k in range(tail):
            a = (k + 1) / (tail + 1)
            flat_pts[gi, j + 1 + k] = ((1 - a) * new[-1] + a * points[gi, j + 1 + k])
    meta["flatten"] = {"reshaped": int(len(fz)), "lengthMm": 40, "added": 0}
    np.savez_compressed(cells / "flatten_raw.npz", points=flat_pts.astype(np.float32),
                        roots=roots.astype(np.float32), radii=radii,
                        apex_y=apex, cx=cx)
    print("flatten reshaped", len(fz), flush=True)

    # ---- fill_long ----
    lroots = sample_band_roots(scalp, rng, N_FILL, "long")
    lstr = drape(scalp, lroots[:, :2], 0.090, long=True)
    hl = scalp.height(lstr.reshape(-1, 3)).reshape(len(lstr), -1)
    meta["fill_long"] = {"added": len(lroots), "lengthMm": 90,
                         "heightMm": {"p50": round(float(np.median(hl)) * 1000, 2),
                                      "max": round(float(hl.max()) * 1000, 2)}}
    np.savez_compressed(cells / "fill_long_raw.npz",
                        points=lstr.astype(np.float32),
                        roots=lroots.astype(np.float32),
                        radii=np.tile(prof, (len(lroots), 1)),
                        apex_y=apex, cx=cx)
    print("fill_long", len(lroots), "h p50/max mm",
          round(float(np.median(hl)) * 1000, 2), round(float(hl.max()) * 1000, 2), flush=True)

    # ---- combo ----
    c_points = np.concatenate([flat_pts, fstr, lstr])
    c_roots = np.concatenate([roots, froots, lroots])
    c_radii = np.concatenate([radii, np.tile(prof, (len(froots) + len(lroots), 1))])
    meta["combo"] = {"added": int(len(froots) + len(lroots)),
                     "reshaped": int(len(fz)),
                     "newTotal": int(len(c_points))}
    np.savez_compressed(cells / "combo_raw.npz", points=c_points.astype(np.float32),
                        roots=c_roots.astype(np.float32), radii=c_radii,
                        apex_y=apex, cx=cx)
    print("combo total", len(c_points), flush=True)
    (E / "cell_meta.json").write_text(json.dumps(meta, indent=1) + "\n")


if __name__ == "__main__":
    main()

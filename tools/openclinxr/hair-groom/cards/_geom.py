"""Shared numpy geometry for the S5 card station (no bpy, no station imports).

Provides: vectorized point-triangle closest point, a uniform-grid
triangle mesh index for fast closest-point queries, and arclength
resampling. All deterministic (no RNG here).
"""
from __future__ import annotations

import numpy as np


def closest_point_tri(p: np.ndarray, a: np.ndarray, b: np.ndarray,
                      c: np.ndarray):
    """Vectorized closest point on triangles. p (Q,3); a,b,c (T,3).

    Returns (closest (Q,T,3), dist2 (Q,T)) via Ericson's region tests.
    Memory: caller must chunk; this broadcasts Q x T.
    """
    ab = b - a
    ac = c - a
    ap = p[:, None, :] - a[None, :, :]
    d1 = (ab[None, :, :] * ap).sum(-1)
    d2 = (ac[None, :, :] * ap).sum(-1)
    closest = np.empty((p.shape[0], a.shape[0], 3))
    done = np.zeros_like(d1, dtype=bool)
    # vertex A region
    m = (d1 <= 0) & (d2 <= 0)
    closest[m] = np.broadcast_to(a[None, :, :], closest.shape)[m]
    done |= m
    # vertex B region
    bp = p[:, None, :] - b[None, :, :]
    d3 = (ab[None, :, :] * bp).sum(-1)
    d4 = (ac[None, :, :] * bp).sum(-1)
    m = (~done) & (d3 >= 0) & (d4 <= d3)
    closest[m] = np.broadcast_to(b[None, :, :], closest.shape)[m]
    done |= m
    # edge AB region
    vc = d1 * d4 - d3 * d2
    m = (~done) & (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    v = np.zeros_like(d1)
    v[m] = d1[m] / (d1[m] - d3[m])
    closest[m] = (a[None, :, :] + v[:, :, None] * ab[None, :, :])[m]
    done |= m
    # vertex C region
    cp = p[:, None, :] - c[None, :, :]
    d5 = (ab[None, :, :] * cp).sum(-1)
    d6 = (ac[None, :, :] * cp).sum(-1)
    m = (~done) & (d6 >= 0) & (d5 <= d6)
    closest[m] = np.broadcast_to(c[None, :, :], closest.shape)[m]
    done |= m
    # edge AC region
    vb = d5 * d2 - d1 * d6
    m = (~done) & (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    w = np.zeros_like(d1)
    w[m] = d2[m] / (d2[m] - d6[m])
    closest[m] = (a[None, :, :] + w[:, :, None] * ac[None, :, :])[m]
    done |= m
    # edge BC region
    va = d3 * d6 - d5 * d4
    m = (~done) & (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    w2 = np.zeros_like(d1)
    w2[m] = (d4[m] - d3[m]) / ((d4[m] - d3[m]) + (d5[m] - d6[m]))
    closest[m] = (b[None, :, :] + w2[:, :, None] * (c - b)[None, :, :])[m]
    done |= m
    # inside face region: project onto the plane
    n = np.cross(ab, ac)
    nn = (n ** 2).sum(-1).clip(1e-24, None)
    t = ((a[None, :, :] - p[:, None, :]) * n[None, :, :]).sum(-1) / nn[None, :]
    proj = p[:, None, :] - t[:, :, None] * n[None, :, :]
    closest[~done] = proj[~done]
    d2out = ((closest - p[:, None, :]) ** 2).sum(-1)
    return closest, d2out


class MeshIndex:
    """Uniform-grid closest-point index over static triangles."""

    def __init__(self, verts: np.ndarray, tris: np.ndarray, cell: float = 0.008):
        self.v = np.asarray(verts, dtype=np.float64)
        self.t = np.asarray(tris, dtype=np.int64)
        self.cell = float(cell)
        self.lo = self.v.min(0) - cell
        self.n = np.maximum(1, np.ceil(
            (self.v.max(0) - self.v.min(0) + 2 * cell) / cell).astype(int))
        tv = self.v[self.t]
        tlo = tv.min(1)
        thi = tv.max(1)
        c0 = np.floor((tlo - self.lo) / cell).astype(int).clip(0, self.n - 1)
        c1 = np.floor((thi - self.lo) / cell).astype(int).clip(0, self.n - 1)
        from collections import defaultdict
        grid: dict = defaultdict(list)
        for i in range(len(self.t)):
            for ix in range(c0[i, 0], c1[i, 0] + 1):
                for iy in range(c0[i, 1], c1[i, 1] + 1):
                    for iz in range(c0[i, 2], c1[i, 2] + 1):
                        grid[(ix, iy, iz)].append(i)
        self.grid = {k: np.array(v, dtype=np.int64)
                     for k, v in grid.items()}

    def query(self, pts: np.ndarray, chunk: int = 2048):
        """Closest point + distance for pts (Q,3). Returns (closest, dist)."""
        pts = np.asarray(pts, dtype=np.float64)
        a = self.v[self.t[:, 0]]
        b = self.v[self.t[:, 1]]
        cc = self.v[self.t[:, 2]]
        out_c = np.empty_like(pts)
        out_d = np.empty(len(pts))
        ci = np.floor((pts - self.lo) / self.cell).astype(int)
        for s in range(0, len(pts), chunk):
            blk = pts[s:s + chunk]
            cbi = ci[s:s + chunk]
            for j in range(len(blk)):
                ix, iy, iz = (int(np.clip(cbi[j, 0], 0, self.n[0] - 1)),
                              int(np.clip(cbi[j, 1], 0, self.n[1] - 1)),
                              int(np.clip(cbi[j, 2], 0, self.n[2] - 1)))
                cand = None
                for rad in (1, 3, 7, 10**9):
                    if rad > 7:
                        cand = np.arange(len(self.t))
                        break
                    seen = set()
                    for ax in range(max(0, ix - rad), min(self.n[0], ix + rad + 1)):
                        for ay in range(max(0, iy - rad), min(self.n[1], iy + rad + 1)):
                            for az in range(max(0, iz - rad), min(self.n[2], iz + rad + 1)):
                                hit = self.grid.get((ax, ay, az))
                                if hit is not None:
                                    seen.update(hit.tolist())
                    if seen:
                        cand = np.array(sorted(seen), dtype=np.int64)
                        break
                cls, d2 = closest_point_tri(
                    blk[j:j + 1], a[cand], b[cand], cc[cand])
                k = int(np.argmin(d2[0]))
                out_c[s + j] = cls[0, k]
                out_d[s + j] = float(np.sqrt(d2[0, k]))
        return out_c, out_d


def arclength_resample(path: np.ndarray, n: int) -> np.ndarray:
    """Resample a (K,3) polyline to n arclength-uniform points."""
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    total = cum[-1]
    if total < 1e-12:
        return np.repeat(path[:1], n, axis=0)
    want = np.linspace(0.0, total, n)
    out = np.empty((n, 3))
    k = 0
    for i, w in enumerate(want):
        while k < len(cum) - 2 and cum[k + 1] < w:
            k += 1
        t = 0.0 if cum[k + 1] <= cum[k] else (w - cum[k]) / (cum[k + 1] - cum[k])
        out[i] = path[k] * (1 - t) + path[k + 1] * t
    return out


OPENED: list = []


def log_open(path) -> str:
    from pathlib import Path as _P
    s = str(_P(path).resolve())
    if s not in OPENED:
        OPENED.append(s)
    return s


def merge_opened(outpath) -> list:
    from pathlib import Path as _P
    p = _P(outpath)
    prev = p.read_text().split() if p.exists() else []
    merged = sorted(set(prev) | set(OPENED))
    p.write_text("\n".join(merged) + "\n")
    return merged

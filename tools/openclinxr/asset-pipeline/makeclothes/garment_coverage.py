#!/usr/bin/env python3
"""#272 — deterministic garment-region coverage measurement for the clothing consume step.

Pure-numpy geometry predicates shared by:
  - `body_param_stage.py` (Blender factory gate: reject a fitted garment that cannot
    cover the body region it claims, and fall back to a body-derived cover shell), and
  - the evidence test `garment-covers-its-region.test.ts` (proves the predicate on the
    shipped library GLBs: the 392-triangle cargo trousers do NOT cover the legs while
    the 9,384-triangle scrub shirt DOES cover the torso).

Why this instrument (issue-272 diagnosis, measured):
  `ClothesService.fit_clothes_to_human` never alters garment topology — it only repositions
  each garment vertex to a weighted sum of three body vertices plus the mhclo offset. The
  392-triangle trouser is therefore the source asset's own geometry (a sparse, partially
  open shell), not something the fit "emitted". Sparse shells leave the skin visible through
  the gaps between triangles ("translucent legs"); dense shells that sit coincident with the
  body z-fight ("translucent torso patch"). Both are the same class: a garment whose geometry
  does not present a surface over the body region it claims.

Coverage is measured with the instrument the §6s research names for "does this garment hide
the body region": outward-normal rays from the body surface, hit-tested against the garment
within a small band. Nearest-surface distance is NOT used — it is fooled by large triangles
bridging gaps (measured: the 392-tri trouser scores 96% "within 2 cm" while 26% of leg rays
pass through bare skin). Shell continuity (position-merged boundary edges) is the second
term: a closed shell over the region is structurally covering, an open one is judged by the
raycast.

claimScope: coverage of a body region by a garment surface — factory gate + evidence predicate.
notEvidenceFor: garment quality/aesthetics, clinical wardrobe, Quest readiness, cloth physics,
               animation deformation quality (a sparse shell may cover statically and tear
               under motion; the stage fallback replaces it regardless when below threshold).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np

# Default standoff the factory applies so fitted garments sit OUTSIDE the skin
# (the coincident fit z-fights; measured median fit distance ≈ 0.7 mm).
CLOTH_STANDOFF_M = 0.015
# Ray tolerance: garments sit ≤ ~1.5 cm from the body; a generous band keeps the
# verdict hit-or-miss rather than distance-sensitive.
RAY_TOLERANCE_M = 0.06
COVERAGE_THRESHOLD = 0.90
ADHERENCE_THRESHOLD = 0.90
ADHERENCE_BAND_M = 0.03
# issue-285 — signed-clearance poke-through measurement (see signed_clearance_report).
# A body vertex "pokes" the garment when it renders IN FRONT of it: signed clearance
# (distance to the garment surface along the body's outward normal, positive = garment
# outside the skin) below this threshold is a poke — negative means the garment is
# behind the body surface, sub-epsilon positive means the surfaces are coincident and
# z-fight. Coverage answers "is garment surface out along this normal"; this answers
# "is the garment OUTSIDE the body at this point" — the §6e gap the 0.9974-coverage
# shell exposed.
POKE_EPSILON_M = 0.002
# issue-285 body-part hiding: a body face is hidden (assigned an invisible material)
# when its signed clearance to the garment is below this. Slightly above the poke
# epsilon so the z-fight band AND the near-coincident fold strip are both covered; the
# garment gate guarantees the garment overlies the region, so hiding a face that is a
# few mm behind it is harmless (it was never visible).
HIDE_EPSILON_M = 0.005
# Search radius for "garment nearby": the standoff is 1.5 cm and the coverage ray
# tolerance is 6 cm; an 8 cm band separates "garment surface in front/behind" from
# "no garment within reach" without classifying a far-away (ballooned) surface as a poke.
SIGNED_SEARCH_M = RAY_TOLERANCE_M + 0.02
# Fixed histogram edges for signed clearance (metres), covering the poke region dense
# and the positive region coarse.
HISTOGRAM_EDGES_M = (-0.02, -0.005, -0.002, -0.0005, 0.0, 0.002, 0.005, 0.015, 0.03, 0.06)


def _as_np(value) -> np.ndarray:
    return np.asarray(value, dtype=float)


def weld_by_position(verts, faces, ndigits: int = 5):
    """Merge vertices at coincident positions; remap faces. Position identity, not index
    identity — index connectivity lies on exports that split every face (§8q)."""
    v = _as_np(verts)
    f = np.asarray(faces, dtype=np.int64)
    uniq, inv = np.unique(np.round(v, ndigits), axis=0, return_inverse=True)
    return uniq, inv[f]


def boundary_edge_count(verts, faces) -> int:
    """Position-merged open edges of a mesh. 0 = closed shell over its surface."""
    v, f = weld_by_position(verts, faces)
    edge_count: dict[tuple[int, int], int] = {}
    for tri in f:
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            e = (int(min(a, b)), int(max(a, b)))
            edge_count[e] = edge_count.get(e, 0) + 1
    return sum(1 for c in edge_count.values() if c == 1)


def _orient_outward(v, f) -> np.ndarray:
    """Flood-fill consistent winding, then flip globally to outward via signed volume.

    The GLB exports here have arbitrary per-face winding (trimesh recomputed normals
    came back inward for this same body), so we cannot trust any single face's winding.
    This produces a globally consistent, outward-pointing face-normal set."""
    v = _as_np(v)
    f = np.asarray(f, dtype=np.int64)
    face_count = len(f)
    # face -> edge -> [neighbor faces]
    edge_to_faces: dict[tuple[int, int], list[int]] = {}
    for fi, tri in enumerate(f):
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            e = (int(min(a, b)), int(max(a, b)))
            edge_to_faces.setdefault(e, []).append(fi)

    adj: dict[int, list[tuple[int, bool]]] = {i: [] for i in range(face_count)}
    for e, fis in edge_to_faces.items():
        if len(fis) < 2:
            continue
        for i in range(len(fis)):
            for j in range(i + 1, len(fis)):
                a, b = fis[i], fis[j]
                # same direction along the shared edge => windings disagree => flip needed
                def _dir(tri_idx):
                    tri = f[tri_idx]
                    for k in range(3):
                        if (int(tri[k]), int(tri[(k + 1) % 3])) == e:
                            return 1
                        if (int(tri[(k + 1) % 3]), int(tri[k])) == e:
                            return -1
                    return 0

                same = _dir(a) == _dir(b)
                adj[a].append((b, same))
                adj[b].append((a, same))

    orient = np.zeros(face_count, dtype=bool)  # True = flipped
    seen = np.zeros(face_count, dtype=bool)
    for start in range(face_count):
        if seen[start]:
            continue
        seen[start] = True
        queue = deque([start])
        while queue:
            cur = queue.popleft()
            for nxt, same in adj[cur]:
                if seen[nxt]:
                    continue
                seen[nxt] = True
                orient[nxt] = orient[cur] ^ same
                queue.append(nxt)

    f2 = f.copy()
    f2[orient] = f2[orient][:, ::-1]

    v0 = v[f2[:, 0]]
    v1 = v[f2[:, 1]]
    v2 = v[f2[:, 2]]
    cross = np.cross(v1 - v0, v2 - v0)
    signed_volume = float(np.sum(np.sum(v0 * cross, axis=1))) / 6.0

    # Flip globally to outward. Signed volume is the primary signal; for meshes with
    # open boundaries (the factory strips MH helpers after the fit) it is still dominated
    # by the intact surface, and the "away from the mesh centroid" fraction acts as a
    # tiebreaker: a standing humanoid's centroid is inside, so >50% of a correct
    # orientation points away from it.
    if signed_volume < 0.0:
        f2 = f2[:, ::-1]
        cross = -cross
    cents = v[f2].mean(axis=1)
    centroid = cents.mean(axis=0)
    away = np.sum(cross * (cents - centroid), axis=1) > 0.0
    if away.mean() < 0.5:
        f2 = f2[:, ::-1]
        cross = -cross

    normals = np.cross(v[f2[:, 1]] - v[f2[:, 0]], v[f2[:, 2]] - v[f2[:, 0]])
    normals /= (np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12)
    return normals


def _ray_tri_hits(origins, dirs, tri_verts, max_t: float) -> np.ndarray:
    """Min hit distance per ray against the triangle soup (Möller–Trumbore, vectorized).
    Returns inf for rays that miss within max_t."""
    origins = np.asarray(origins, dtype=float)
    dirs = np.asarray(dirs, dtype=float)
    tri_verts = np.asarray(tri_verts, dtype=float)
    best = np.full(len(origins), np.inf)
    ray_block = 256
    tri_block = 512
    for r0 in range(0, len(origins), ray_block):
        r1 = min(r0 + ray_block, len(origins))
        o = origins[r0:r1]
        d = dirs[r0:r1]
        local_best = np.full(r1 - r0, np.inf)
        for t0 in range(0, len(tri_verts), tri_block):
            t1 = min(t0 + tri_block, len(tri_verts))
            tris = tri_verts[t0:t1]  # (T,3,3)
            v0 = tris[:, 0][None, :, :]
            v1 = tris[:, 1][None, :, :]
            v2 = tris[:, 2][None, :, :]
            e1 = v1 - v0
            e2 = v2 - v0
            p = np.cross(d[:, None, :], np.broadcast_to(e2, (r1 - r0, t1 - t0, 3)))
            det = np.sum(e1 * p, axis=2)
            inv = 1.0 / (det + 1e-12)
            s = o[:, None, :] - v0
            u = np.sum(s * p, axis=2) * inv
            q = np.cross(s, e1)
            vv = np.sum(d[:, None, :] * q, axis=2) * inv
            t = np.sum(e2 * q, axis=2) * inv
            # Two-sided test: a coincident garment (median fit distance ~0.7 mm, half its
            # surface behind the body surface) is hit on its BACK face by body-outward rays,
            # and it still hides the skin. `det` may be negative; |det| guards degenerates.
            hit = (
                (np.abs(det) > 1e-10)
                & (u >= 0.0)
                & (vv >= 0.0)
                & (u + vv <= 1.0)
                & (t > 1e-6)
                & (t <= max_t)
            )
            with np.errstate(invalid="ignore"):
                local_best = np.minimum(local_best, np.where(hit, t, np.inf).min(axis=1))
        best[r0:r1] = local_best
    return best


def _lateral_footprint(
    garment_verts,
    band_lo: float,
    band_hi: float,
    *,
    height_axis: int = 1,
    lateral_axis: int = 0,
    n_slices: int = 24,
) -> np.ndarray:
    """Per-slice lateral half-extent of the garment over the band.

    issue-283: the body region a garment CLAIMS is bounded laterally by the
    garment's own silhouette — a torso garment claims the body surface it wraps,
    not the arms that hang through its vertical extent. This returns, for each
    height slice of the band, the garment's max |lateral| in that slice (falling
    back to the garment's global max for empty slices)."""
    gv = _as_np(garment_verts)
    foot = np.zeros(n_slices)
    if band_hi <= band_lo or len(gv) == 0:
        return foot
    fallback = float(np.abs(gv[:, lateral_axis]).max())
    edges = np.linspace(band_lo, band_hi, n_slices + 1)
    for k in range(n_slices):
        m = (gv[:, height_axis] >= edges[k]) & (gv[:, height_axis] < edges[k + 1])
        foot[k] = float(np.abs(gv[m, lateral_axis]).max()) if m.sum() else fallback
    return foot


def outward_raycast_coverage(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    tol: float = RAY_TOLERANCE_M,
    max_rays: int = 2048,
    height_axis: int = 1,
    lateral_axis: int = 0,
) -> tuple[float, int, int]:
    """Fraction of the body region's outward rays that hit the garment within `tol`.

    Returns (coverage_fraction, region_face_count, sampled_face_count).

    The region is the body surface the garment CLAIMS: the faces whose centroid
    height is inside the band AND whose centroid lateral coordinate is inside the
    garment's own per-slice lateral footprint (issue-283). Without the lateral
    bound the region includes the arms, which hang through every torso band and
    which no shirt without sleeves claims — a closed shell then read 14-35%
    coverage while its true claim covers >= 0.9.

    `height_axis` is the axis the region band runs along. Exported GLBs are Y-up
    (height along Y, index 1 — the default, used by the evidence module), while the
    factory stage measures the Z-up Blender scene (height along Z, index 2). The band
    values passed in must be in the caller's frame; this parameter keeps the predicate
    frame-consistent (issue-277, measured on the first gate run). The lateral axis is
    X (index 0) in both frames — the body is symmetric about the X=0 plane."""
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    gv = _as_np(garment_verts)
    gf = np.asarray(garment_faces, dtype=np.int64)

    tri_verts = v[f]
    cents = tri_verts.mean(axis=1)
    sel = (cents[:, height_axis] > band_lo) & (cents[:, height_axis] < band_hi)
    if sel.any() and band_hi > band_lo:
        footprint = _lateral_footprint(gv, band_lo, band_hi, height_axis=height_axis, lateral_axis=lateral_axis)
        lat = np.abs(cents[:, lateral_axis])
        slice_k = np.clip(
            ((cents[:, height_axis] - band_lo) / (band_hi - band_lo) * len(footprint)).astype(np.int64),
            0,
            len(footprint) - 1,
        )
        sel = sel & (lat <= footprint[slice_k])
    idx = np.where(sel)[0]
    region_count = int(sel.sum())
    if len(idx) == 0:
        return 0.0, region_count, 0
    if len(idx) > max_rays:
        step = math.ceil(len(idx) / max_rays)
        idx = idx[::step]

    normals = _orient_outward(v, f)
    origins = cents[idx] + normals[idx] * 5e-4
    dirs = normals[idx]
    garment_tris = gv[gf]
    hits = _ray_tri_hits(origins, dirs, garment_tris, max_t=tol)
    covered = int(np.isfinite(hits).sum())
    return covered / len(idx), region_count, len(idx)


def _closest_points_on_triangles(pts, tri_verts):
    """Vectorized closest point on triangle (Ericson) + squared distance.

    pts: (T,3) points (one per candidate triangle), tri_verts: (T,3,3).
    Returns (closest (T,3), dist2 (T,))."""
    a = tri_verts[:, 0]
    b = tri_verts[:, 1]
    c = tri_verts[:, 2]
    ab = b - a
    ac = c - a
    ap = pts - a
    d1 = np.sum(ab * ap, axis=1)
    d2 = np.sum(ac * ap, axis=1)
    bp = pts - b
    d3 = np.sum(ab * bp, axis=1)
    d4 = np.sum(ac * bp, axis=1)
    cp = pts - c
    d5 = np.sum(ab * cp, axis=1)
    d6 = np.sum(ac * cp, axis=1)

    # region: A
    q = np.broadcast_to(a, pts.shape).copy()
    # region: edge AB (vc <= 0, d1 >= 0, d3 <= 0)
    vc = d1 * d4 - d3 * d2
    m = (vc <= 0.0) & (d1 >= 0.0) & (d3 <= 0.0)
    t = np.where(m, d1 / np.maximum(d1 - d3, 1e-12), 0.0)
    q = np.where(m[:, None], a + ab * t[:, None], q)
    # region: B
    m = (d3 >= 0.0) & (d4 <= d3)
    q = np.where(m[:, None], b, q)
    # region: edge BC (va <= 0, d4-d3 >= 0, d5-d6 >= 0)
    va = d3 * d6 - d5 * d4
    m = (va <= 0.0) & ((d4 - d3) >= 0.0) & ((d5 - d6) >= 0.0)
    w = np.where(m, (d4 - d3) / np.maximum((d4 - d3) + (d5 - d6), 1e-12), 0.0)
    q = np.where(m[:, None], b + w[:, None] * (c - b), q)
    # region: C
    m = (d6 >= 0.0) & (d5 <= d6)
    q = np.where(m[:, None], c, q)
    # region: edge AC (vb <= 0, d2 >= 0, d6 <= 0)
    vb = d5 * d2 - d1 * d6
    m = (vb <= 0.0) & (d2 >= 0.0) & (d6 <= 0.0)
    w = np.where(m, d2 / np.maximum(d2 - d6, 1e-12), 0.0)
    q = np.where(m[:, None], a + ac * w[:, None], q)
    # region: interior
    denom = va + vb + vc
    m = denom > 1e-12
    vv = np.where(m, vb / np.maximum(denom, 1e-12), 0.0)
    ww = np.where(m, vc / np.maximum(denom, 1e-12), 0.0)
    q = np.where(m[:, None], a + ab * vv[:, None] + ac * ww[:, None], q)

    delta = pts - q
    d2q = np.sum(delta * delta, axis=1)
    return q, d2q


def _region_signed_clearance_samples(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    max_search_m: float = SIGNED_SEARCH_M,
    height_axis: int = 1,
    lateral_axis: int = 0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Shared engine for signed-clearance measurements and the body-hide mask.

    Returns (clearance_per_sample, region_fidx, face_verts, sample_normals).
    clearance_per_sample[i] is the signed clearance for sample i = the i-th vertex of
    the region_fidx[i//3]-th body face; NaN = no garment surface within max_search_m.
    See signed_clearance_report for the sign convention (BODY normal, not garment).
    """
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    gv = _as_np(garment_verts)
    gf = np.asarray(garment_faces, dtype=np.int64)

    tri_verts = v[f]
    cents = tri_verts.mean(axis=1)
    sel = (cents[:, height_axis] > band_lo) & (cents[:, height_axis] < band_hi)
    if sel.any() and band_hi > band_lo:
        footprint = _lateral_footprint(gv, band_lo, band_hi, height_axis=height_axis, lateral_axis=lateral_axis)
        lat = np.abs(cents[:, lateral_axis])
        slice_k = np.clip(
            ((cents[:, height_axis] - band_lo) / (band_hi - band_lo) * len(footprint)).astype(np.int64),
            0,
            len(footprint) - 1,
        )
        sel = sel & (lat <= footprint[slice_k])
    fidx = np.where(sel)[0]
    if len(fidx) == 0:
        return np.array([], dtype=float), fidx, np.zeros((0, 3, 3), dtype=float), np.zeros((0, 3), dtype=float)

    # Weld the garment: the GLB exporter duplicates every boundary vertex (the female
    # upper shell exports as 34,572 verts / 11,524 tris = 3 verts/tri), so nearest
    # queries run against the true surface, not the split soup. Garment NORMALS are
    # deliberately NOT used for the sign — the exported scrub shirt welds to a
    # degenerate orientation (signed volume ≈ 0, away_fraction 0.16, measured), so a
    # sign based on garment normals flips randomly. The sign comes from the BODY's
    # outward normal at the sample point instead (body flood-filled signed volumes are
    # positive and sane: 0.056 / 0.069 m³, measured).
    gw, gfw = weld_by_position(gv, gf)

    # triangle list + per-welded-vertex incident triangles (pure-numpy adjacency)
    tri_list = gw[gfw]  # (T,3,3)
    vert_to_tris: list[list[int]] = [[] for _ in range(len(gw))]
    for ti in range(len(gfw)):
        for vi in gfw[ti]:
            vert_to_tris[int(vi)].append(ti)

    # uniform grid over garment verts (cell 1 cm) — the same spatial-hash pattern the
    # file already uses in adherence_fraction / cloth_offset; no scipy dependency.
    cell = 0.01
    grid: dict[tuple[int, int, int], list[int]] = {}
    for i, p in enumerate(gw):
        key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)), int(math.floor(p[2] / cell)))
        grid.setdefault(key, []).append(i)

    face_verts = v[f[fidx]]  # (F, 3, 3)
    pts = face_verts.reshape(-1, 3)  # (N, 3)
    body_normals = _orient_outward(v, f)[fidx]  # (F, 3) — body face normals
    sample_normals = np.repeat(body_normals, 3, axis=0)  # (N, 3) per (face, vertex)
    n = len(pts)
    max_cells = int(math.ceil(max_search_m / cell)) + 1

    clearance = np.full(n, np.nan)
    for block in range(0, n, 512):
        bl = pts[block : block + 512]
        bnorm = sample_normals[block : block + 512]
        nb = len(bl)
        cand_v: list[list[int]] = [[] for _ in range(nb)]
        for bi, p in enumerate(bl):
            cx, cy, cz = (
                int(math.floor(p[0] / cell)),
                int(math.floor(p[1] / cell)),
                int(math.floor(p[2] / cell)),
            )
            seen: set[int] = set()
            for r in range(0, max_cells + 1):
                found_any = False
                for dx in range(-r, r + 1):
                    for dy in range(-r, r + 1):
                        for dz in range(-r, r + 1):
                            if max(abs(dx), abs(dy), abs(dz)) != r:
                                continue
                            for j in grid.get((cx + dx, cy + dy, cz + dz), ()):
                                if j not in seen:
                                    seen.add(j)
                                    found_any = True
                if r >= 1 and found_any:
                    break
            cand_v[bi] = list(seen)
        # flatten candidates
        counts = np.array([len(c) for c in cand_v], dtype=np.int64)
        if counts.sum() == 0:
            continue
        offsets = np.concatenate(([0], np.cumsum(counts)))
        flat_c = np.concatenate([np.asarray(c, dtype=np.int64) for c in cand_v])
        # nearest garment VERTEX per body point (candidate set only)
        delta = gw[flat_c] - np.repeat(bl, counts, axis=0)
        d2v = np.sum(delta * delta, axis=1)
        # exact point-to-surface via triangles incident to the k nearest vertices
        k = 6
        best_s = np.full(nb, np.inf)
        # for each body point, its candidate triangle ids
        for bi in range(nb):
            lo, hi = int(offsets[bi]), int(offsets[bi + 1])
            if lo == hi:
                continue
            sub = np.argsort(d2v[lo:hi])[:k]
            tris: set[int] = set()
            for vi in flat_c[lo:hi][sub]:
                tris.update(vert_to_tris[int(vi)])
            if not tris:
                continue
            tarr = np.asarray(sorted(tris), dtype=np.int64)
            p3 = np.broadcast_to(bl[bi][None, :], (len(tarr), 3)).copy()
            q, d2q = _closest_points_on_triangles(p3, tri_list[tarr])
            best_j = int(np.argmin(d2q))
            if d2q[best_j] <= max_search_m * max_search_m:
                # signed distance along the BODY's outward normal: negative = the body
                # surface is OUTSIDE the garment at this point (renders in front = poke),
                # positive = garment in front of the skin, ~0 = coincident (z-fight).
                best_s[bi] = -np.dot(p3[best_j] - q[best_j], bnorm[bi])
        clearance[block : block + nb] = best_s

    return clearance, fidx, face_verts, sample_normals


def body_hide_mask(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    hide_epsilon_m: float = HIDE_EPSILON_M,
    max_search_m: float = SIGNED_SEARCH_M,
    height_axis: int = 1,
    lateral_axis: int = 0,
) -> dict:
    """issue-285 — the body-part-hiding fix (what the §6s research named).

    A body-derived cover shell offset along vertex normals SELF-INTERSECTS at the
    concave hip/waist crease (measured: 34.5% of the female upper's claim region is
    within 3 mm of the shell surface, exactly at the flanks / hem / neck the pixels
    show skin through). NO outward offset fixes this — offsetting a concave/undercut
    surface folds regardless of direction or magnitude, and a magnitude that clears
    every vertex balloons the garment (#121). The industry answer is to hide the body
    under the garment (body-part hiding / alpha mask), which has no such failure mode.

    Returns a per-body-face boolean mask: faces to HIDE (assign an invisible material)
    because they poke through or z-fight the garment. A face is hidden when any of its
    three vertex samples has signed clearance < hide_epsilon_m (negative = renders in
    front of the garment; sub-epsilon = coincident / z-fight). Faces with no garment
    surface within max_search_m are NOT hidden (the garment is not there).

    Deterministic, pure numpy, winding-free — the Blender stage consumes this mask to
    paint material regions, and the evidence test asserts the mask covers the pokes on
    the shipped GLBs.
    """
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    clearance, fidx, _face_verts, _normals = _region_signed_clearance_samples(
        body_verts, body_faces, garment_verts, garment_faces, band_lo, band_hi,
        max_search_m=max_search_m, height_axis=height_axis, lateral_axis=lateral_axis,
    )
    n_faces = len(f)
    mask = np.zeros(n_faces, dtype=bool)
    region_mask = np.zeros(n_faces, dtype=bool)
    if len(fidx) == 0 or len(clearance) == 0:
        return {
            "hideMask": mask,
            "hiddenFaceCount": 0,
            "regionFaceCount": 0,
            "regionBandY": [band_lo, band_hi],
            "hideEpsilonMeters": hide_epsilon_m,
        }
    region_mask[fidx] = True
    per_face = clearance.reshape(len(fidx), 3).min(axis=1)  # NaN-safe (NaN < eps = False)
    hide = per_face < hide_epsilon_m
    mask[fidx[hide]] = True
    return {
        "hideMask": mask,
        "hiddenFaceCount": int(hide.sum()),
        "regionFaceCount": int(len(fidx)),
        "regionBandY": [band_lo, band_hi],
        "hideEpsilonMeters": hide_epsilon_m,
    }


def _poking_face_count(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    poke_epsilon_m: float = POKE_EPSILON_M,
    max_search_m: float = SIGNED_SEARCH_M,
    height_axis: int = 1,
    lateral_axis: int = 0,
) -> int:
    """Number of region body faces with ANY vertex sample whose signed clearance is
    below the poke epsilon — the faces that render in front of or z-fight the garment.
    The hide mask must cover every one of them (issue-285 contract)."""
    clearance, fidx, _face_verts, _normals = _region_signed_clearance_samples(
        body_verts, body_faces, garment_verts, garment_faces, band_lo, band_hi,
        max_search_m=max_search_m, height_axis=height_axis, lateral_axis=lateral_axis,
    )
    if len(fidx) == 0 or len(clearance) == 0:
        return 0
    per_face = clearance.reshape(len(fidx), 3).min(axis=1)
    return int((per_face < poke_epsilon_m).sum())


def signed_clearance_report(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    poke_epsilon_m: float = POKE_EPSILON_M,
    max_search_m: float = SIGNED_SEARCH_M,
    height_axis: int = 1,
    lateral_axis: int = 0,
    coverage_number: float | None = None,
) -> dict:
    """issue-285 — per-region body vertex SIGNED clearance to the garment.

    The defect this measures: `outward_raycast_coverage` answers "is there garment
    surface out along this normal?" — a face whose body vertex sits 1 mm PROUD of the
    shell still has garment within RAY_TOLERANCE_M along its normal and counts as
    covered. This answers the question coverage cannot: "is the garment OUTSIDE the
    body at this point?" (the §6e gap, and what the §6s research consult said the
    industry measures instead — skin offset, not coverage).

    Region: body faces whose centroid height is inside the band AND whose centroid
    lateral coordinate is inside the garment's own per-slice lateral footprint — the
    same region `outward_raycast_coverage` claims (pass the FULL garment extent to
    include the garment's own edges; the coverage gate trims 2 cm to dodge them).

    For every (region face, vertex) sample, the signed distance is the projection of
    the body-vertex-to-nearest-garment-surface vector onto the BODY's outward face
    normal (negative = the body surface is OUTSIDE the garment there = renders in
    front = poke-through; positive = garment in front of the skin; ~0 = coincident
    surfaces that z-fight). The sign uses the body normal, NEVER the garment normal:
    exported garments weld to degenerate orientations (measured: the 9,384-tri scrub
    shirt has signed volume ≈ 0.00002 m³ and 16% away-from-centroid normals), so a
    garment-normal sign flips at random. The body's flood-filled signed volume is
    positive and sane (0.056 / 0.069 m³, measured) and its orientation is trusted.
    The nearest-surface distance itself is winding-free (position-welded garment).

    Poking samples: clearance < poke_epsilon_m (negative OR sub-epsilon coincidence).
    Counts are reported as counts AND as a fraction of the sampled vertices — one
    poking vertex is visible, and a 0.9974 average hides it — plus the worst
    (most negative) clearance and a fixed signed-clearance histogram.

    claimScope: body-vertex poke-through of an existing garment surface, on shipped
    library GLBs, against the region the garment claims.
    notEvidenceFor: garment aesthetics, cloth physics/deformation, Quest readiness.
    """
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)

    clearance, fidx, _face_verts, _normals = _region_signed_clearance_samples(
        body_verts, body_faces, garment_verts, garment_faces, band_lo, band_hi,
        max_search_m=max_search_m, height_axis=height_axis, lateral_axis=lateral_axis,
    )
    region_faces = int(len(fidx))
    n = int(len(clearance))
    if n == 0:
        return {
            "regionBandY": [band_lo, band_hi],
            "regionFaceCount": region_faces,
            "sampledVertexCount": 0,
            "pokeCount": 0,
            "pokeFraction": 0.0,
            "distinctPokingVertexCount": 0,
            "worstClearanceMeters": None,
            "noGarmentNearbyCount": 0,
            "histogram": [],
            "pokeEpsilonMeters": poke_epsilon_m,
            "maxSearchMeters": max_search_m,
            "coverageNumber": coverage_number,
            "region": "empty",
        }

    no_nearby = ~np.isfinite(clearance)
    valid = np.isfinite(clearance)
    poke = valid & (clearance < poke_epsilon_m)
    poke_count = int(poke.sum())
    distinct_poke = int(np.unique(f[fidx][poke.reshape(region_faces, 3).any(axis=1)]).size) if poke_count else 0
    worst = float(np.min(clearance[valid])) if valid.any() else None

    hist: list[dict] = []
    edges = [None, *HISTOGRAM_EDGES_M, None]
    for k in range(len(edges) - 1):
        lo = edges[k]
        hi = edges[k + 1]
        if lo is None:
            m = valid & (clearance < hi)
            label = f"<{hi:g}"
        elif hi is None:
            m = valid & (clearance >= lo)
            label = f">={lo:g}"
        else:
            m = valid & (clearance >= lo) & (clearance < hi)
            label = f"[{lo:g},{hi:g})"
        hist.append({"bucket": label, "count": int(m.sum())})

    return {
        "regionBandY": [band_lo, band_hi],
        "regionFaceCount": region_faces,
        "sampledVertexCount": n,
        "pokeCount": poke_count,
        "pokeFraction": round(poke_count / max(n, 1), 6),
        "distinctPokingVertexCount": distinct_poke,
        "worstClearanceMeters": round(worst, 6) if worst is not None else None,
        "noGarmentNearbyCount": int(no_nearby.sum()),
        "histogram": hist,
        "pokeEpsilonMeters": poke_epsilon_m,
        "maxSearchMeters": max_search_m,
        "coverageNumber": coverage_number,
        "region": "band_plus_garment_lateral_footprint",
    }


def adherence_fraction(
    garment_verts,
    body_verts,
    *,
    band: float = ADHERENCE_BAND_M,
) -> float:
    """Coarse guard: fraction of garment vertices near the body (voxel grid).

    Cell size = `band`, and a vertex counts as near when a body vertex occupies the same
    or an adjacent cell — so the effective acceptance radius is roughly 2×band. This is a
    deliberately coarse balloon-rejection guard; the raycast and boundary terms carry the
    coverage verdict. All shipped garments sit ≤ 1.5 cm from the body and pass at 1.0."""
    gv = _as_np(garment_verts)
    bv = _as_np(body_verts)
    cell = band
    grid: dict[tuple[int, int, int], bool] = {}
    for p in bv[:: max(1, len(bv) // 200_000)]:
        key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)), int(math.floor(p[2] / cell)))
        grid[key] = True
    near = 0
    for p in gv:
        kx, ky, kz = int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)), int(math.floor(p[2] / cell))
        found = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    if (kx + dx, ky + dy, kz + dz) in grid:
                        found = True
                        break
                if found:
                    break
            if found:
                break
        if found:
            near += 1
    return near / max(len(gv), 1)


def coverage_report(
    body_verts,
    body_faces,
    garment_verts,
    garment_faces,
    band_lo: float,
    band_hi: float,
    *,
    tol: float = RAY_TOLERANCE_M,
    coverage_threshold: float = COVERAGE_THRESHOLD,
    max_rays: int = 2048,
    garment_label: str = "",
    height_axis: int = 1,
    lateral_axis: int = 0,
) -> dict:
    """Verdict for "does this garment cover the body region it claims".

    `height_axis` — see outward_raycast_coverage. Default 1 (Y-up exported GLBs, the
    evidence module's frame); the factory stage passes 2 for its Z-up scene.
    `lateral_axis` — the body's bilateral symmetry axis (X in both frames).

    The region is the body surface the garment claims: the band's vertical extent
    intersected with the garment's own per-slice lateral footprint (issue-283).
    This excludes the arms — which hang through any torso band and which a shirt
    without sleeves does not claim — from the region a closed shell would otherwise
    be credited for.

    A garment covers when it either (a) is a closed shell (no position-merged open edges)
    that adheres to the body, or (b) overlies at least `coverage_threshold` of the region's
    outward surface. The sparse 392-triangle trouser fails both (open shell, low coverage);
    the dense closed scrub shirt passes on (a) and, against the corrected region, also on
    (b) (measured 0.927 for the heavy-male scrub shirt on the shipped GLB, issue-283)."""
    coverage, region_count, sampled = outward_raycast_coverage(
        body_verts, body_faces, garment_verts, garment_faces, band_lo, band_hi, tol=tol, max_rays=max_rays, height_axis=height_axis, lateral_axis=lateral_axis
    )
    boundary = boundary_edge_count(garment_verts, garment_faces)
    adherence = adherence_fraction(garment_verts, body_verts)

    closure_ok = boundary == 0
    coverage_ok = coverage >= coverage_threshold
    adheres = adherence >= ADHERENCE_THRESHOLD
    covers = adheres and (closure_ok or coverage_ok)

    return {
        "garmentLabel": garment_label,
        "regionBandY": [band_lo, band_hi],
        "regionFaceCount": int(region_count),
        "sampledFaceCount": int(sampled),
        "outwardRaycastCoverage": round(float(coverage), 4),
        "garmentBoundaryEdges": int(boundary),
        "garmentAdherence": round(float(adherence), 4),
        "rayToleranceMeters": tol,
        "coverageThreshold": coverage_threshold,
        "verdict": "covers" if covers else "does_not_cover",
        "reason": (
            "closed_shell_adherent"
            if covers and closure_ok
            else "outward_surface_present"
            if covers
            else "open_shell_and_sparse_surface"
        ),
    }


def build_cover_shell(
    body_verts,
    body_faces,
    band_lo: float,
    band_hi: float,
    *,
    standoff: float = CLOTH_STANDOFF_M,
    label: str = "procedural_lower_cover_shell",
    height_axis: int = 1,
) -> dict:
    """Deterministic fallback garment: the body's own region surface, offset outward.

    The shell is the body surface the garment claims, displaced by `standoff` along the
    body's outward vertex normals. It covers the region by construction — the rays that
    sample the region's outward surface hit the offset shell at ~standoff. This is what
    the factory ships when a library fit cannot cover (D2: procedural clothing, no LLM).

    `height_axis` — see outward_raycast_coverage (1 = Y-up exported GLBs; the factory
    stage passes 2 for its Z-up scene)."""
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    # The GLB/OBJ exports split every face (per-face vertex duplication), so build the
    # shell on the position-welded body: adjacent faces must share welded vertices for
    # the shell to be a connected surface rather than a triangle soup.
    v, f = weld_by_position(v, f)
    tri_verts = v[f]
    cents = tri_verts.mean(axis=1)
    sel = (cents[:, height_axis] > band_lo) & (cents[:, height_axis] < band_hi)
    fidx = np.where(sel)[0]
    if len(fidx) == 0:
        raise ValueError("build_cover_shell: empty region band")

    normals = _orient_outward(v, f)
    # vertex normals: area-weighted average of incident face normals
    vert_norm = np.zeros_like(v)
    vert_area = np.zeros(len(v))
    tri_area = np.linalg.norm(np.cross(tri_verts[:, 1] - tri_verts[:, 0], tri_verts[:, 2] - tri_verts[:, 0]), axis=1) * 0.5
    for fi in fidx:
        for vi in f[fi]:
            vert_norm[vi] += normals[fi] * tri_area[fi]
            vert_area[vi] += tri_area[fi]
    for vi in np.where(vert_area > 1e-12)[0]:
        vert_norm[vi] /= vert_area[vi]
    vn = vert_norm / (np.linalg.norm(vert_norm, axis=1, keepdims=True) + 1e-12)

    region_verts = set(int(vi) for tri in f[fidx] for vi in tri)
    region_verts = sorted(region_verts)
    index_map = {old: new for new, old in enumerate(region_verts)}
    new_v = np.array([v[old] + vn[old] * standoff for old in region_verts], dtype=float)
    new_f = np.array([[index_map[int(vi)] for vi in tri] for tri in f[fidx]], dtype=np.int64)

    return {
        "label": label,
        "bandY": [band_lo, band_hi],
        "standoffMeters": standoff,
        "position": new_v.reshape(-1).tolist(),
        "indices": new_f.reshape(-1).tolist(),
        "vertexCount": len(new_v),
        "faceCount": len(new_f),
        "boundaryEdges": boundary_edge_count(new_v, new_f),
    }


def cloth_offset(
    garment_verts,
    body_verts,
    body_faces,
    standoff: float = CLOTH_STANDOFF_M,
) -> np.ndarray:
    """Move every garment vertex to `standoff` OUTSIDE the body surface (deterministic).

    The library fit places garments coincident with the skin (measured median ≈ 0.7 mm;
    half the surface behind the body surface), which z-fights in the render — the
    "translucent torso patch". This pushes each vertex out along the body's outward
    surface normal at its nearest body vertex, to a uniform air gap. The garment's own
    topology is unchanged (D9: deterministic component, no LLM)."""
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    gv = _as_np(garment_verts)

    face_normals = _orient_outward(v, f)
    tri_verts = v[f]
    tri_area = (
        0.5 * np.linalg.norm(
            np.cross(tri_verts[:, 1] - tri_verts[:, 0], tri_verts[:, 2] - tri_verts[:, 0]),
            axis=1,
        )
    )
    vert_norm = np.zeros_like(v)
    vert_w = np.zeros(len(v))
    for k in range(3):
        np.add.at(vert_norm, f[:, k], face_normals * tri_area[:, None])
        np.add.at(vert_w, f[:, k], tri_area)
    nz = vert_w > 1e-12
    vert_norm[nz] /= vert_w[nz, None]
    vn = vert_norm / (np.linalg.norm(vert_norm, axis=1, keepdims=True) + 1e-12)

    cell = 0.02
    grid: dict[tuple[int, int, int], list[int]] = {}
    for i, p in enumerate(v):
        key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)), int(math.floor(p[2] / cell)))
        grid.setdefault(key, []).append(i)

    out = gv.copy()
    for i, p in enumerate(gv):
        cx, cy, cz = (
            int(math.floor(p[0] / cell)),
            int(math.floor(p[1] / cell)),
            int(math.floor(p[2] / cell)),
        )
        best_i: int | None = None
        best_d2 = np.inf
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                for dz in (-2, -1, 0, 1, 2):
                    for j in grid.get((cx + dx, cy + dy, cz + dz), ()):
                        d2 = float(np.dot(v[j] - p, v[j] - p))
                        if d2 < best_d2:
                            best_d2 = d2
                            best_i = j
        if best_i is None:
            best_i = int(np.argmin(np.sum((v - p) ** 2, axis=1)))
        out[i] = v[best_i] + vn[best_i] * standoff
    return out


def _load_mesh_json(path: str) -> tuple[np.ndarray, np.ndarray]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    pos = np.asarray(data["position"], dtype=float).reshape(-1, 3)
    idx = np.asarray(data["indices"], dtype=np.int64).reshape(-1, 3)
    return pos, idx


def _write_mesh_json(path: str, position, indices, label: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "label": label,
        "position": np.asarray(position, dtype=float).reshape(-1).tolist(),
        "indices": np.asarray(indices, dtype=np.int64).reshape(-1).tolist(),
    }
    Path(path).write_text(json.dumps(payload) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # Accept both `garment_coverage.py --mode coverage-report …` and
    # `garment_coverage.py coverage-report …` (subparsers are positional).
    if argv and argv[0] == "--mode":
        argv = argv[1:]
    p = argparse.ArgumentParser(description="garment region coverage predicate")
    sub = p.add_subparsers(dest="mode", required=True)

    rep = sub.add_parser("coverage-report")
    rep.add_argument("--body", required=True, help="body mesh JSON {position, indices}")
    rep.add_argument("--garment", required=True, help="garment mesh JSON {position, indices}")
    rep.add_argument("--band-lo", type=float, required=True)
    rep.add_argument("--band-hi", type=float, required=True)
    rep.add_argument("--tol", type=float, default=RAY_TOLERANCE_M)
    rep.add_argument("--threshold", type=float, default=COVERAGE_THRESHOLD)
    rep.add_argument("--max-rays", type=int, default=2048)
    rep.add_argument("--label", default="garment")
    rep.add_argument("--out", required=True)

    sh = sub.add_parser("cover-shell")
    sh.add_argument("--body", required=True)
    sh.add_argument("--band-lo", type=float, required=True)
    sh.add_argument("--band-hi", type=float, required=True)
    sh.add_argument("--standoff", type=float, default=CLOTH_STANDOFF_M)
    sh.add_argument("--label", default="procedural_lower_cover_shell")
    sh.add_argument("--out", required=True, help="report JSON")
    sh.add_argument("--garment-out", required=True, help="shell mesh JSON")

    sc = sub.add_parser("signed-clearance")
    sc.add_argument("--body", required=True, help="body mesh JSON {position, indices}")
    sc.add_argument("--garment", required=True, help="garment mesh JSON {position, indices}")
    sc.add_argument("--band-lo", type=float, required=True)
    sc.add_argument("--band-hi", type=float, required=True)
    sc.add_argument("--epsilon", type=float, default=POKE_EPSILON_M)
    sc.add_argument("--max-search", type=float, default=SIGNED_SEARCH_M)
    sc.add_argument("--label", default="garment")
    sc.add_argument("--out", required=True)

    hm = sub.add_parser("body-hide-mask")
    hm.add_argument("--body", required=True, help="body mesh JSON {position, indices}")
    hm.add_argument("--garment", required=True, help="garment mesh JSON {position, indices}")
    hm.add_argument("--band-lo", type=float, required=True)
    hm.add_argument("--band-hi", type=float, required=True)
    hm.add_argument("--epsilon", type=float, default=HIDE_EPSILON_M)
    hm.add_argument("--max-search", type=float, default=SIGNED_SEARCH_M)
    hm.add_argument("--label", default="garment")
    hm.add_argument("--out", required=True)

    args = p.parse_args(argv)

    if args.mode == "coverage-report":
        bv, bf = _load_mesh_json(args.body)
        gv, gf = _load_mesh_json(args.garment)
        report = coverage_report(
            bv, bf, gv, gf,
            args.band_lo, args.band_hi,
            tol=args.tol,
            coverage_threshold=args.threshold,
            max_rays=args.max_rays,
            garment_label=args.label,
        )
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
        return 0

    if args.mode == "cover-shell":
        bv, bf = _load_mesh_json(args.body)
        shell = build_cover_shell(
            bv, bf, args.band_lo, args.band_hi,
            standoff=args.standoff,
            label=args.label,
        )
        _write_mesh_json(args.garment_out, shell["position"], shell["indices"], shell["label"])
        report = {
            "label": shell["label"],
            "bandY": shell["bandY"],
            "standoffMeters": shell["standoffMeters"],
            "vertexCount": shell["vertexCount"],
            "faceCount": shell["faceCount"],
            "boundaryEdges": shell["boundaryEdges"],
        }
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
        return 0

    if args.mode == "signed-clearance":
        bv, bf = _load_mesh_json(args.body)
        gv, gf = _load_mesh_json(args.garment)
        report = signed_clearance_report(
            bv, bf, gv, gf,
            args.band_lo, args.band_hi,
            poke_epsilon_m=args.epsilon,
            max_search_m=args.max_search,
        )
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
        return 0

    if args.mode == "body-hide-mask":
        bv, bf = _load_mesh_json(args.body)
        gv, gf = _load_mesh_json(args.garment)
        report = body_hide_mask(
            bv, bf, gv, gf,
            args.band_lo, args.band_hi,
            hide_epsilon_m=args.epsilon,
            max_search_m=args.max_search,
        )
        # compact the mask: emit indices, not a 26k-array, for the evidence test
        report["hiddenFaceIndices"] = [
            int(i) for i in np.where(np.asarray(report["hideMask"], dtype=bool))[0]
        ]
        del report["hideMask"]
        report["pokingFaceCount"] = int(
            _poking_face_count(bv, bf, gv, gf, args.band_lo, args.band_hi, max_search_m=args.max_search)
        )
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())

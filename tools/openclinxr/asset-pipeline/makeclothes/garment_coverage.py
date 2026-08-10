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
) -> tuple[float, int, int]:
    """Fraction of the body region's outward rays that hit the garment within `tol`.

    Returns (coverage_fraction, region_face_count, sampled_face_count)."""
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    gv = _as_np(garment_verts)
    gf = np.asarray(garment_faces, dtype=np.int64)

    tri_verts = v[f]
    cents = tri_verts.mean(axis=1)
    sel = (cents[:, 1] > band_lo) & (cents[:, 1] < band_hi)
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
) -> dict:
    """Verdict for "does this garment cover the body region it claims".

    A garment covers when it either (a) is a closed shell (no position-merged open edges)
    that adheres to the body, or (b) overlies at least `coverage_threshold` of the region's
    outward surface. The sparse 392-triangle trouser fails both (open shell, 74% coverage);
    the dense closed scrub shirt passes on (a)."""
    coverage, region_count, sampled = outward_raycast_coverage(
        body_verts, body_faces, garment_verts, garment_faces, band_lo, band_hi, tol=tol, max_rays=max_rays
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
) -> dict:
    """Deterministic fallback garment: the body's own region surface, offset outward.

    The shell is the body surface the garment claims, displaced by `standoff` along the
    body's outward vertex normals. It covers the region by construction — the rays that
    sample the region's outward surface hit the offset shell at ~standoff. This is what
    the factory ships when a library fit cannot cover (D2: procedural clothing, no LLM)."""
    v = _as_np(body_verts)
    f = np.asarray(body_faces, dtype=np.int64)
    # The GLB/OBJ exports split every face (per-face vertex duplication), so build the
    # shell on the position-welded body: adjacent faces must share welded vertices for
    # the shell to be a connected surface rather than a triangle soup.
    v, f = weld_by_position(v, f)
    tri_verts = v[f]
    cents = tri_verts.mean(axis=1)
    sel = (cents[:, 1] > band_lo) & (cents[:, 1] < band_hi)
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

    return 2


if __name__ == "__main__":
    sys.exit(main())

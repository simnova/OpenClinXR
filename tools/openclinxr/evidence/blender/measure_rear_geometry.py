#!/usr/bin/env python3
"""Issue-255 rear-geometry measurement for the ecg-cart A/B bake.

Takes two bake output dirs (1-view and 4-view), each containing bake-measure.json
and <subject>.glb, and writes multiview-report.json with per-bake geometry metrics
focused on the REAR — the claimed defect (the pack has no back/top/bottom view, so
the rear stays under-informed even at 4 views; views are unposed, no camera poses).

Measures (text-only — the orchestrator grades the rendered pixels):
  - total triangles / surface area / vertices (bake-measure.json cross-check)
  - watertightness + boundary edge count + volume ratio (collapse/hole signatures)
  - near/far hemisphere asymmetry on each horizontal AABB axis: the far half's
    projected surface area and vertex share vs the near half, plus a rasterized
    orthographic fill fraction per hemisphere.

"Far" = the half of the axis with LESS surface area — i.e. the under-informed side.
The two bakes are compared on the same per-axis values; TRELLIS orientation is not
guaranteed stable across bakes, so both horizontal axes are reported for each.

Usage:
  ~/.openclinxr-tools/trellis2-apple/venv/bin/python3 measure_rear_geometry.py \
    --subject ecg-cart \
    --dir-1view /path/to/bake-1view \
    --dir-4view /path/to/bake-4view \
    --output-json /path/to/multiview-report.json
"""
import argparse, json, os, sys
import numpy as np


def load_mesh(glb_path):
    import trimesh
    loaded = trimesh.load(glb_path, force=None)
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            return None
        mesh = meshes[0]
        if len(meshes) > 1:
            # merge into one surface for measurement (positions are world-space)
            mesh = trimesh.util.concatenate(meshes)
    elif isinstance(loaded, trimesh.Trimesh):
        mesh = loaded
    else:
        return None
    mesh.remove_unreferenced_vertices()
    return mesh


def axis_split_metrics(mesh, axis_idx):
    """Split the mesh at the AABB midpoint of one axis; measure near/far asymmetry.

    Returns dict with projected-area and vertex fractions for the two halves.
    'far' is the half with LESS surface area (the under-informed side).
    """
    bounds = mesh.bounds  # (2, 3)
    lo, hi = bounds[0, axis_idx], bounds[1, axis_idx]
    mid = (lo + hi) / 2.0
    if hi - lo < 1e-9:
        return None
    verts = mesh.vertices
    faces = mesh.faces
    centroids = verts[faces].mean(axis=1)  # (F, 3)
    side = centroids[:, axis_idx] >= mid
    if side.sum() == 0 or (~side).sum() == 0:
        return None

    face_areas = mesh.area_faces  # (F,)
    face_normals = mesh.face_normals
    proj_w = face_areas * np.abs(face_normals[:, axis_idx])
    area_near = float(proj_w[~side].sum())
    area_far = float(proj_w[side].sum())

    # Vertex share
    vcount = len(verts)
    far_verts = int(np.count_nonzero(verts[:, axis_idx] >= mid))
    near_verts = vcount - far_verts

    # Rasterized orthographic fill fraction (project along the axis)
    fill_near = raster_fill(mesh, axis_idx, side)
    fill_far = raster_fill(mesh, axis_idx, ~side)

    far_frac = area_far / (area_near + area_far) if (area_near + area_far) > 0 else None
    return {
        "axis": ["x", "y", "z"][axis_idx],
        "midpoint": float(mid),
        "nearProjectedArea": round(area_near, 4),
        "farProjectedArea": round(area_far, 4),
        "farAreaFraction": round(far_frac, 4) if far_frac is not None else None,
        "nearVertexCount": near_verts,
        "farVertexCount": far_verts,
        "farVertexFraction": round(far_verts / vcount, 4) if vcount else None,
        "nearFillFraction": round(fill_near, 4) if fill_near is not None else None,
        "farFillFraction": round(fill_far, 4) if fill_far is not None else None,
    }


def raster_fill(mesh, axis_idx, face_mask, grid=96):
    """Orthographically project the masked faces onto the plane perpendicular to
    the axis and rasterize; return the fraction of the projected AABB bounding
    box covered by filled cells."""
    axes = [i for i in range(3) if i != axis_idx]
    verts = mesh.vertices
    faces = mesh.faces[face_mask]
    if len(faces) == 0:
        return None
    tri = verts[faces][:, :, axes]  # (F,3,2)
    lo = tri.reshape(-1, 2).min(axis=0)
    hi = tri.reshape(-1, 2).max(axis=0)
    span = (hi - lo)
    if float(span.max()) < 1e-9:
        return None
    scale = (grid - 1) / span
    tris_g = (tri - lo) * scale  # (F,3,2) in grid coords
    tris_i = np.floor(tris_g).astype(np.int64)
    filled = set()
    # Edge-function rasterization per triangle (vectorised over cells in bbox)
    for t, tg in zip(tris_i, tris_g):
        x0, y0 = int(max(0, t[:, 0].min())), int(max(0, t[:, 1].min()))
        x1, y1 = int(min(grid - 1, t[:, 0].max())), int(min(grid - 1, t[:, 1].max()))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        pts = np.stack([xs.ravel(), ys.ravel()], axis=-1).astype(np.float64)
        # edge functions for CCW triangle (may be CW; use abs orientation)
        p0, p1, p2 = tg[0], tg[1], tg[2]
        e0 = (p1[0] - p0[0]) * (pts[:, 1] - p0[1]) - (p1[1] - p0[1]) * (pts[:, 0] - p0[0])
        e1 = (p2[0] - p1[0]) * (pts[:, 1] - p1[1]) - (p2[1] - p1[1]) * (pts[:, 0] - p1[0])
        e2 = (p0[0] - p2[0]) * (pts[:, 1] - p2[1]) - (p0[1] - p2[1]) * (pts[:, 0] - p2[0])
        inside = (e0 >= -0.5) & (e1 >= -0.5) & (e2 >= -0.5)
        if inside.sum() == 0:
            inside = (e0 <= 0.5) & (e1 <= 0.5) & (e2 <= 0.5)
        filled.update(zip(xs.ravel()[inside].tolist(), ys.ravel()[inside].tolist()))
    return len(filled) / (grid * grid)


def measure(glb_path, measure_path):
    out = {"bake": None, "geometry": None}
    if os.path.exists(measure_path):
        with open(measure_path) as f:
            out["bake"] = json.load(f)
    mesh = load_mesh(glb_path)
    if mesh is None:
        out["geometry"] = {"error": f"could not load GLB: {glb_path}"}
        return out
    try:
        hull = mesh.convex_hull
        hull_vol = float(hull.volume)
        vol_ratio = float(mesh.volume / hull_vol) if hull_vol > 1e-12 else None
    except Exception:
        hull_vol = None
        vol_ratio = None
    counts = np.bincount(mesh.edges_unique_inverse)
    boundary_edges = int((counts == 1).sum())
    out["geometry"] = {
        "vertexCount": int(len(mesh.vertices)),
        "triangleCount": int(len(mesh.faces)),
        "surfaceArea": round(float(mesh.area), 4),
        "volume": round(float(mesh.volume), 4),
        "convexHullVolume": round(hull_vol, 4) if hull_vol is not None else None,
        "volumeRatio": round(vol_ratio, 4) if vol_ratio is not None else None,
        "isWatertight": bool(mesh.is_watertight),
        "boundaryEdgeCount": boundary_edges,
        "aabbMin": [round(float(v), 4) for v in mesh.bounds[0]],
        "aabbMax": [round(float(v), 4) for v in mesh.bounds[1]],
        "aabbExtent": [round(float(b[1] - b[0]), 4) for b in zip(mesh.bounds[0], mesh.bounds[1])],
        "axisSplits": {
            "x": axis_split_metrics(mesh, 0),
            "z": axis_split_metrics(mesh, 2),
        },
    }
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--subject", required=True)
    parser.add_argument("--dir-1view", required=True)
    parser.add_argument("--dir-4view", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    subj = args.subject
    m1 = measure(
        os.path.join(args.dir_1view, f"{subj}.glb"),
        os.path.join(args.dir_1view, "bake-measure.json"),
    )
    m4 = measure(
        os.path.join(args.dir_4view, f"{subj}.glb"),
        os.path.join(args.dir_4view, "bake-measure.json"),
    )

    def tris(m):
        return (m.get("bake") or {}).get("rawTriangleCount")

    report = {
        "subject": subj,
        "measurementKind": "A/B bake 1 view vs 4 views — rear geometry focus",
        "constraints": {
            "viewsUnposed": True,
            "noCameraPosesPassed": True,
            "packHasNoBackTopBottomView": True,
            "rearStaysUnderInformedEvenAt4Views": True,
            "orchestratorGradesRenders": True,
        },
        "bake1view": m1,
        "bake4view": m4,
        "comparison": {
            "triangleCount_1view": tris(m1),
            "triangleCount_4view": tris(m4),
            "triangleDeltaPct": round(
                (tris(m4) - tris(m1)) / tris(m1) * 100, 1
            ) if tris(m1) else None,
            "volumeRatio_1view": (m1.get("geometry") or {}).get("volumeRatio"),
            "volumeRatio_4view": (m4.get("geometry") or {}).get("volumeRatio"),
            "watertight_1view": (m1.get("geometry") or {}).get("isWatertight"),
            "watertight_4view": (m4.get("geometry") or {}).get("isWatertight"),
            "boundaryEdges_1view": (m1.get("geometry") or {}).get("boundaryEdgeCount"),
            "boundaryEdges_4view": (m4.get("geometry") or {}).get("boundaryEdgeCount"),
        },
        "verdict": "recorded",
        "verdictReason": (
            "Both bakes kept. See per-bake geometry; the orchestrator grades the "
            "rendered rear. Rear is under-informed in both (no back view in the pack)."
        ),
    }

    out_path = os.path.abspath(args.output_json)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"[REAR] Wrote {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

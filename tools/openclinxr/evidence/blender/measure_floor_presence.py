#!/usr/bin/env python3
"""Measure floor/ground-plane presence in a GLB mesh (#269).

The #267 bake reconstructed a ground plane (a teal speckled surface) despite a
subject-only pack. This probe quantifies that failure class directly so the
4-view bake can be compared on the SAME instrument:

  - near-horizontal surface fraction: area-weighted fraction of triangles whose
    normal is near-vertical (|n_y| dominant) — a floor/ceiling reads here;
  - bottom-slab fraction: near-horizontal area in the bottom 15% of the mesh
    height, relative to total surface area (a ground plane sits at the bottom);
  - bottom-slab width vs object width: the largest connected near-horizontal
    region in the bottom band, relative to the widest horizontal extent of the
    whole mesh (a floor spans the object width or more).

The bake is object-centered and normalized (~1 m AABB, #255), so absolute sizes
are not comparable across artifacts; the fractions are. This is geometry only —
the orchestrator grades the rendered pixels.

Usage:
  ~/.openclinxr-tools/trellis2-apple/venv/bin/python3 measure_floor_presence.py \
    --glb <path> [--output-json <path>]
"""
import argparse, json, os
import numpy as np


def load_mesh(glb_path):
    import trimesh
    loaded = trimesh.load(glb_path, force=None)
    if isinstance(loaded, trimesh.Scene):
        try:
            mesh = loaded.dump(concatenate=True)
        except Exception:
            meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
            if not meshes:
                return None
            mesh = meshes[0]
            if len(meshes) > 1:
                mesh = trimesh.util.concatenate(meshes)
    elif isinstance(loaded, trimesh.Trimesh):
        mesh = loaded
    else:
        return None
    mesh.remove_unreferenced_vertices()
    return mesh


def measure(mesh):
    """Return floor-presence metrics for one mesh."""
    tris = mesh.triangles  # (N,3,3) world space
    area = mesh.area_faces  # (N,)
    total_area = float(area.sum())
    bounds = mesh.bounds  # (2,3)
    extent = bounds[1] - bounds[0]
    height = float(extent[1])
    if height <= 1e-9 or total_area <= 1e-12:
        return {
            "totalSurfaceArea": round(total_area, 4),
            "nearHorizontalFraction": 0.0,
            "bottomSlabFraction": 0.0,
            "bottomSlabArea": 0.0,
            "bottomSlabWidthVsObjectWidth": 0.0,
            "aabbExtent": [round(float(extent[i]), 4) for i in range(3)],
            "reading": "degenerate mesh — no area or no height",
        }

    # Triangle normals (area-weighted via cross product). |n_y| ~ 1 => horizontal face.
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    cross = np.cross(v1 - v0, v2 - v0)
    norm = np.linalg.norm(cross, axis=1)
    n_y = np.zeros_like(norm)
    ok = norm > 1e-12
    n_y[ok] = np.abs(cross[ok, 1]) / norm[ok]
    near_horizontal = ok & (n_y > 0.95)  # within ~18° of horizontal

    horiz_area = float(area[near_horizontal].sum()) if near_horizontal.any() else 0.0
    near_horizontal_fraction = horiz_area / total_area

    # Bottom slab: near-horizontal triangles whose centroid is in the bottom 15% of height.
    centroid_y = (tris[:, :, 1].mean(axis=1))
    y_min = float(bounds[0, 1])
    bottom_band = near_horizontal & (centroid_y <= y_min + 0.15 * height)
    bottom_slab_area = float(area[bottom_band].sum()) if bottom_band.any() else 0.0
    bottom_slab_fraction = bottom_slab_area / total_area

    # Width of the largest connected near-horizontal region in the bottom band,
    # compared to the whole-mesh max horizontal extent.
    object_horiz_extent = max(float(extent[0]), float(extent[2]))
    bottom_width = 0.0
    if bottom_band.any():
        xs = tris[bottom_band, :, 0]
        zs = tris[bottom_band, :, 2]
        bottom_width = max(float(xs.max()) - float(xs.min()), float(zs.max()) - float(zs.min()))
    slab_width_ratio = bottom_width / object_horiz_extent if object_horiz_extent > 1e-9 else 0.0

    # Reading heuristics — data recorded, verdict is the orchestrator's.
    if bottom_slab_fraction > 0.20 and slab_width_ratio > 0.8:
        reading = (
            f"FLOOR-LIKE SURFACE: {bottom_slab_fraction * 100:.1f}% of surface area is "
            f"near-horizontal in the bottom 15% of height, spanning {slab_width_ratio * 100:.0f}% "
            f"of the object's horizontal extent"
        )
    elif near_horizontal_fraction > 0.25:
        reading = (
            f"substantial horizontal surface: {near_horizontal_fraction * 100:.1f}% of surface area "
            f"is near-horizontal (bottom slab {bottom_slab_fraction * 100:.1f}%, width ratio "
            f"{slab_width_ratio * 100:.0f}%) — plate/table-like, not necessarily a floor"
        )
    else:
        reading = (
            f"no floor-like surface: near-horizontal fraction {near_horizontal_fraction * 100:.1f}%, "
            f"bottom-slab fraction {bottom_slab_fraction * 100:.1f}%"
        )

    return {
        "totalSurfaceArea": round(total_area, 4),
        "nearHorizontalFraction": round(near_horizontal_fraction, 4),
        "bottomSlabFraction": round(bottom_slab_fraction, 4),
        "bottomSlabArea": round(bottom_slab_area, 6),
        "bottomSlabWidthVsObjectWidth": round(slab_width_ratio, 4),
        "aabbExtent": [round(float(extent[i]), 4) for i in range(3)],
        "reading": reading,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--output-json", default=None)
    args = parser.parse_args()

    if not os.path.exists(args.glb):
        print(f"[floor-probe] input not found: {args.glb}", flush=True)
        return 1

    mesh = load_mesh(args.glb)
    if mesh is None:
        print(f"[floor-probe] failed to load mesh: {args.glb}", flush=True)
        return 1

    result = {
        "glb": args.glb,
        "measurementKind": "floor-presence probe — near-horizontal surface fraction, bottom-slab fraction, slab width vs object width (trimesh)",
        "constraints": {
            "bakeIsObjectCenteredAndNormalized": True,
            "comparisonOnDimensionlessFractions": True,
            "orchestratorGradesRenders": True,
        },
        "metrics": measure(mesh),
    }

    if args.output_json:
        os.makedirs(os.path.dirname(args.output_json) or ".", exist_ok=True)
        with open(args.output_json, "w") as f:
            json.dump(result, f, indent=2)
    print(json.dumps(result, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())

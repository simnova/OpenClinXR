#!/usr/bin/env python3
"""Issue-262 geometry comparison: parametric equipment source vs TRELLIS bake.

Measures BOTH GLBs with the SAME instrument (trimesh) so the comparison is
apples-to-apples — no browser-side counts vs python-side counts (§8q).

The TRELLIS bake is object-centered and normalized (~1 m AABB, #255), while the
parametric source is authored at real scale, so ABSOLUTE extents are not
comparable. Comparison is on dimensionless SHAPE metrics:
  - aspect ratio        height / max(width, depth)   (pole-ness)
  - slimmest slice      min horizontal extent over vertical slices / max
                        (did the thin pole survive?)
  - volume ratio        signed volume / convex-hull volume
  - winding coherence   signed volume sign + watertightness + boundary edges

Verdict is recorded as data plus a reading; the orchestrator grades the rendered
pixels (this tier is text-only and opens no PNG/GLB).

Usage:
  ~/.openclinxr-tools/trellis2-apple/venv/bin/python3 measure_parametric_vs_bake.py \
    --parametric-glb /path/to/parametric-source.glb \
    --bake-glb /path/to/iv-pole.glb \
    --output-json /path/to/geometry-comparison.json
"""
import argparse, json, os
import numpy as np


def load_mesh(glb_path):
    import trimesh
    loaded = trimesh.load(glb_path, force=None)
    if isinstance(loaded, trimesh.Scene):
        # dump(concatenate=True) bakes the scene-graph node transforms into the
        # vertices — `scene.geometry` values alone are LOCAL space, which would
        # center the parametric source (pure Y translations) and skew yMin/yMax.
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
    """Return dimensionless shape metrics + recorded counts for one mesh."""
    bounds = mesh.bounds  # (2, 3)
    extent = bounds[1] - bounds[0]
    width, height, depth = float(extent[0]), float(extent[1]), float(extent[2])
    max_horiz = max(width, depth)
    aspect = height / max_horiz if max_horiz > 1e-9 else float("nan")

    # Slimmest vertical slice: the thin pole is the defining feature of an IV pole.
    # Uses TRIANGLE AABBs, not vertices — three.js cylinders only have vertices at
    # the two cap rings, so a vertex-only profile sees an empty shaft and misses
    # the pole entirely.
    triangles = mesh.triangles  # (N,3,3), world space
    tri_min_y = triangles[:, :, 1].min(axis=1)
    tri_max_y = triangles[:, :, 1].max(axis=1)
    tri_horiz = np.maximum(
        triangles[:, :, 0].max(axis=1) - triangles[:, :, 0].min(axis=1),
        triangles[:, :, 2].max(axis=1) - triangles[:, :, 2].min(axis=1),
    )
    n_slices = 12
    y_edges = np.linspace(bounds[0, 1], bounds[1, 1], n_slices + 1)
    slice_extents = []
    for i in range(n_slices):
        overlap = (tri_min_y < y_edges[i + 1]) & (tri_max_y >= y_edges[i])
        if not bool(overlap.any()):
            continue
        slice_extents.append(float(tri_horiz[overlap].max()))
    slimmest_fraction = (
        min(slice_extents) / max(slice_extents) if len(slice_extents) >= 2 and max(slice_extents) > 1e-9
        else float("nan")
    )

    surface_area = float(mesh.area)
    try:
        volume = float(mesh.volume)
    except Exception:
        volume = float("nan")
    hull_volume = float(mesh.convex_hull.volume) if mesh.convex_hull is not None else float("nan")
    volume_ratio = volume / hull_volume if hull_volume and hull_volume > 1e-12 else float("nan")

    boundary_edges = 0
    try:
        if hasattr(mesh, "edges_unique_length") and mesh.edges_unique_length is not None:
            boundary_edges = int(bool(mesh.edges_unique_length).sum())
    except Exception:
        boundary_edges = 0

    is_watertight = bool(mesh.is_watertight)

    return {
        "vertexCount": int(len(mesh.vertices)),
        "triangleCount": int(len(mesh.faces)),
        "surfaceArea": round(surface_area, 4),
        "aabbExtent": [round(width, 4), round(height, 4), round(depth, 4)],
        "aspectRatio": round(aspect, 4),
        "slimmestSliceFraction": round(slimmest_fraction, 4),
        "volume": round(volume, 6),
        "convexHullVolume": round(hull_volume, 6),
        "volumeRatio": round(volume_ratio, 4),
        "isWatertight": is_watertight,
        "boundaryEdgeCount": boundary_edges,
        "yMin": round(float(bounds[0, 1]), 4),
        "yMax": round(float(bounds[1, 1]), 4),
    }


def compare(p, b):
    """Return per-metric comparison + a cautious geometry reading."""
    reading = []
    if b["aspectRatio"] >= 1.5 and b["aspectRatio"] < p["aspectRatio"] * 1.6:
        reading.append(
            f"bake stays tall (aspect {b['aspectRatio']} vs parametric {p['aspectRatio']})"
        )
    elif b["aspectRatio"] >= p["aspectRatio"] * 1.6:
        reading.append(
            f"bake is TALLER relative to its width than the source (aspect {b['aspectRatio']} vs {p['aspectRatio']})"
        )
    elif b["aspectRatio"] < 1.5:
        reading.append(
            f"bake lost the tall/thin silhouette (aspect {b['aspectRatio']} vs parametric {p['aspectRatio']})"
        )
    if b["slimmestSliceFraction"] <= p["slimmestSliceFraction"] * 1.5:
        reading.append(
            f"thin-pole structure preserved (slimmest slice {b['slimmestSliceFraction']} vs parametric {p['slimmestSliceFraction']})"
        )
    else:
        reading.append(
            f"thin-pole structure BLURRED (slimmest slice {b['slimmestSliceFraction']} vs parametric {p['slimmestSliceFraction']}; >1.0 = no sustained thin element)"
        )
    if b["volumeRatio"] >= 0 and b["volumeRatio"] > p["volumeRatio"]:
        reading.append(
            f"bake is more solid than the source (volumeRatio {b['volumeRatio']} vs {p['volumeRatio']})"
        )
    return reading


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--parametric-glb", required=True)
    parser.add_argument("--bake-glb", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    for p in (args.parametric_glb, args.bake_glb):
        if not os.path.exists(p):
            print(f"[measure] input not found: {p}", flush=True)
            return 1

    pm = load_mesh(args.parametric_glb)
    bm = load_mesh(args.bake_glb)
    if pm is None or bm is None:
        print(f"[measure] failed to load: parametric={'ok' if pm else 'MISSING'} bake={'ok' if bm else 'MISSING'}", flush=True)
        return 1

    p_metrics = measure(pm)
    b_metrics = measure(bm)
    reading = compare(p_metrics, b_metrics)

    report = {
        "measurementKind": "geometry comparison — parametric source vs TRELLIS bake, same instrument (trimesh)",
        "parametricGlb": args.parametric_glb,
        "bakeGlb": args.bake_glb,
        "constraints": {
            "bakeIsObjectCenteredAndNormalized": True,
            "absoluteExtentsNotComparable": True,
            "comparisonOnDimensionlessShapeMetrics": True,
            "orchestratorGradesRenders": True,
        },
        "parametric": p_metrics,
        "bake": b_metrics,
        "comparison": {
            "aspectRatio_parametric": p_metrics["aspectRatio"],
            "aspectRatio_bake": b_metrics["aspectRatio"],
            "slimmestSliceFraction_parametric": p_metrics["slimmestSliceFraction"],
            "slimmestSliceFraction_bake": b_metrics["slimmestSliceFraction"],
            "volumeRatio_parametric": p_metrics["volumeRatio"],
            "volumeRatio_bake": b_metrics["volumeRatio"],
            "triangleCount_parametric": p_metrics["triangleCount"],
            "triangleCount_bake": b_metrics["triangleCount"],
            "watertight_parametric": p_metrics["isWatertight"],
            "watertight_bake": b_metrics["isWatertight"],
        },
        "geometryReading": reading,
        "notEvidenceFor": [
            "mesh quality suitable for exam use",
            "production adoption into learner runtime",
            "replacement of parametric equipment builders",
            "clinical accuracy",
        ],
    }

    os.makedirs(os.path.dirname(args.output_json) or ".", exist_ok=True)
    with open(args.output_json, "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())

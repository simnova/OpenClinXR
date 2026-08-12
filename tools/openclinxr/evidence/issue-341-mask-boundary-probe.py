#!/usr/bin/env python3
"""issue-341 round 7 — hide-mask boundary instrument.

The round-7 pixel grade shows a ragged black sawtooth at EVERY garment/skin seam
(hairline, shoulders, sleeve hems, waistband, trouser hems, boot tops, jaw), and
the orchestrator's measured fact is that the hide-mask and the garment vertical
extents match almost exactly (aisha upper mask 0.581..0.853 vs shirt 0.581..0.852)
— so whatever produces the ragged edge lives in the BOUNDARY POLYGON SHAPE, which
an AABB or band table is blind to (§11s: bounded an extent, defect lives in shape).

The alpha-0 hide primitives (openclinxr_hidden_*) are DISCARDED at render. A hidden
body polygon that is only PARTIALLY covered by the garment (it straddles the garment
edge: some vertices within HIDE_EPSILON_M of the cloth, others past it) is discarded
WHOLE, so its uncovered part reads as a hole -> the dark capture background
(#18211d) -> a black fringe shaped like the body's own triangulation.

This instrument measures exactly that, per discarded polygon, on the SHIPPED bytes:

  for each hidden polygon:
    - cast along its OWN outward normal (not a fixed axis): does the garment
      surface sit within reach along the direction the body surface faces?
    - sample the polygon AREA (barycentric grid, not just vertices or centroid):
      viewer rays (+Z) to measure the fraction of the polygon NOT covered by any
      garment from the front. A centroid test is blind to the straddling class.
    - report per-slot (upper/lower/foot) and per body-height band so the seams map.

Ray casts use trimesh's built-in BVH intersector (a library call, not a new
ray-triangle implementation — D1); _ray_tri_hits is the proven brute-force path
and remains available for spot checks.

claimScope: which discarded (alpha-0) body polygons are not fully covered by a
garment from the front viewer, on shipped MPFB GLBs, and where they sit.
notEvidenceFor: garment aesthetics, clinical wardrobe, render quality, cloth
physics. This does not grade pixels; the orchestrator does.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[2]

# Viewer: exported GLBs are Y-up, face at +Z (#279). Camera at +Z looking -Z, so a
# "front-view" ray from a surface point toward the viewer runs along +Z.
VIEWER = np.array([0.0, 0.0, 1.0])
# Same generous reach the occlusion gate uses (figure depth ~0.5 m).
MAX_RAY_T = 0.5
RAY_OFFSET = 1e-4
# Barycentric sample grid over each triangle (n=3 -> 10 samples incl. edges).
GRID_N = 3

ACTORS = [
    "mpfb-ob-patient-aisha",
    "mpfb-peds-nurse-kevin",
    "mpfb-peds-patient-child",
]


def _material_name(geom: trimesh.Trimesh) -> str:
    try:
        vis = geom.visual
        if vis is None:
            return ""
        mat = vis.material
        if mat is None:
            return ""
        return getattr(mat, "name", "") or ""
    except Exception:
        return ""


def load_actor(rel: str) -> dict[str, list[trimesh.Trimesh]]:
    scene = trimesh.load(str(_REPO_ROOT / rel), force=None)
    out: dict[str, list[trimesh.Trimesh]] = {}
    for gname, geom in scene.geometry.items():
        if isinstance(geom, trimesh.Scene) or not isinstance(geom, trimesh.Trimesh):
            continue
        mat = _material_name(geom)
        if "hidden" in mat.lower():
            slot = "upper" if "upper" in mat.lower() else "lower" if "lower" in mat.lower() else "foot"
            out.setdefault(f"hidden_{slot}", []).append(geom)
        elif "scalp_hair" in mat.lower():
            out.setdefault("scalp", []).append(geom)
        elif "t_shirt" in gname or "shirt" in gname:
            out.setdefault("tshirt", []).append(geom)
        elif "pants" in gname or "trouser" in gname:
            out.setdefault("pants", []).append(geom)
        elif "boot" in gname or "shoe" in gname or "footwear" in gname or "flat" in gname:
            out.setdefault("shoes", []).append(geom)
        elif "skin" in mat.lower():
            out.setdefault("skin", []).append(geom)
    return out


def layer_mesh(parts: list[trimesh.Trimesh]) -> trimesh.Trimesh | None:
    """Concatenate a layer's parts into one mesh for BVH raycasting."""
    geoms = [g for g in (parts or []) if len(g.faces)]
    if not geoms:
        return None
    if len(geoms) == 1:
        return geoms[0]
    return trimesh.util.concatenate(geoms)


def layer_tris(parts: list[trimesh.Trimesh]) -> np.ndarray:
    m = layer_mesh(parts)
    if m is None:
        return np.zeros((0, 3, 3), dtype=float)
    return m.vertices[m.faces]


def barycentric_grid(n: int) -> np.ndarray:
    """Barycentric sample points (u,v,w) for a triangle, edges included."""
    pts = []
    for i in range(n + 1):
        for j in range(n + 1 - i):
            u = i / n
            v = j / n
            pts.append((u, v, 1.0 - u - v))
    return np.array(pts, dtype=float)


def measure_slot(
    hidden: np.ndarray,
    garments: dict[str, trimesh.Trimesh | None],
    slot: str,
    fig_y_lo: float,
    fig_y_hi: float,
) -> dict:
    """hidden: (H,3,3) triangle soup of discarded body polygons."""
    n = len(hidden)
    if n == 0:
        return {"slot": slot, "present": False, "triangleCount": 0}
    cents = hidden.mean(axis=1)  # (H,3)

    # One BVH intersector over the merged garment surface (thin shells included in
    # full density — a +Z ray crosses the shell nearly perpendicular to it and a
    # strided soup would miss it, measured).
    gar_meshes = [m for m in garments.values() if m is not None and len(m.faces)]
    if gar_meshes:
        if len(gar_meshes) == 1:
            gar_mesh = gar_meshes[0]
        else:
            gar_mesh = trimesh.util.concatenate(gar_meshes)
        inter = gar_mesh.ray
    else:
        inter = None

    # trimesh's built-in BVH per-ray variant: which rays hit the garment surface.
    def rays_hit(origins: np.ndarray, dirs: np.ndarray) -> np.ndarray:
        if inter is None or len(origins) == 0:
            return np.zeros(len(origins), dtype=bool)
        return inter.intersects_any(origins, dirs)  # uses the same BVH

    # --- 1) outward-normal ray: garment within reach along the body surface normal?
    norms = np.cross(hidden[:, 1] - hidden[:, 0], hidden[:, 2] - hidden[:, 0])
    norms = norms / (np.linalg.norm(norms, axis=1, keepdims=True) + 1e-12)
    body_cent = cents.mean(axis=0)
    flip = np.einsum("ij,ij->i", norms, cents - body_cent) < 0.0
    norms[flip] = -norms[flip]
    o_n = cents + norms * RAY_OFFSET
    # trimesh intersects_any has NO max_distance arg in some versions; filter by
    # intersection distance via intersects_location per block would be slow, so we
    # accept the BVH full-reach result and rely on the viewer test for the reach
    # bound (the normal test is a presence test, not a distance gate).
    normal_hit = rays_hit(o_n, norms) if inter is not None else np.zeros(n, dtype=bool)

    # --- 2) viewer-ray area coverage: sample the polygon AREA (barycentric grid).
    grid = barycentric_grid(GRID_N)
    per_face_exposed = np.zeros(n)
    per_face_hit_any = np.zeros(n, dtype=bool)
    block = 2048
    for b0 in range(0, n, block):
        b1 = min(b0 + block, n)
        tris = hidden[b0:b1]
        B = b1 - b0
        G = len(grid)
        verts = tris[:, None, :, :]  # (B,1,3,3)
        pts = (verts * grid[None, :, :, None]).sum(axis=2)  # (B,G,3)
        origins = pts.reshape(B * G, 3) + VIEWER * RAY_OFFSET
        dirs = np.tile(VIEWER, (B * G, 1))
        any_hit = rays_hit(origins, dirs).reshape(B, G)
        per_face_hit_any[b0:b1] = any_hit.any(axis=1)
        per_face_exposed[b0:b1] = (~any_hit).mean(axis=1)

    exposed_any = per_face_exposed > 0.0
    areas = np.linalg.norm(np.cross(
        hidden[:, 1] - hidden[:, 0], hidden[:, 2] - hidden[:, 0]), axis=1) / 2.0
    total_area = float(areas.sum())
    exposed_area = float((areas * per_face_exposed).sum())

    # --- 3) spatial band grouping in BODY-HEIGHT fractions (the figure's own
    # extent, not the slot's — a foot slot's own span would mislabel feet as head).
    span = max(fig_y_hi - fig_y_lo, 1e-6)
    frac = (cents[:, 1] - fig_y_lo) / span
    bands = ["head(0.90-1.00)", "neck(0.82-0.90)", "chest(0.64-0.82)", "waist(0.55-0.64)",
             "hip(0.44-0.55)", "thigh(0.24-0.44)", "knee(0.14-0.24)", "ankle(0.06-0.14)", "foot(0.00-0.06)"]
    band_edges = [(0.90, 1.01), (0.82, 0.90), (0.64, 0.82), (0.55, 0.64),
                  (0.44, 0.55), (0.24, 0.44), (0.14, 0.24), (0.06, 0.14), (0.00, 0.06)]
    band_counts: dict[str, int] = {}
    band_exposed: dict[str, int] = {}
    band_exposed_faces: dict[str, int] = {}
    for b, (lo, hi) in zip(bands, band_edges):
        m = (frac >= lo) & (frac < hi)
        band_counts[b] = int(m.sum())
        band_exposed[b] = int((m & exposed_any).sum())
        band_exposed_faces[b] = int((m & exposed_any & (per_face_exposed >= 0.5)).sum()) if m.any() else 0

    return {
        "slot": slot,
        "present": True,
        "triangleCount": int(n),
        "garmentTriCount": int(sum(len(m.faces) for m in gar_meshes)),
        "normalCovered": int(normal_hit.sum()),
        "normalMiss": int((~normal_hit).sum()),
        "viewerCoveredAny": int(per_face_hit_any.sum()),
        "viewerExposedAny": int(exposed_any.sum()),
        "viewerExposedHalfOrMore": int((per_face_exposed >= 0.5).sum()),
        "exposedFractionMean": round(float(per_face_exposed.mean()), 4),
        "exposedAreaM2": round(exposed_area, 5),
        "totalAreaM2": round(total_area, 5),
        "bands": {k: {"hidden": band_counts[k], "exposedAny": band_exposed[k],
                      "exposedHalfOrMore": band_exposed_faces[k]} for k in bands},
        "note": (
            "normalCovered = garment hit along the polygon's OWN outward normal "
            "(BVH, presence only); viewerExposedAny = at least one area sample has "
            "no garment in front along +Z (the black-hole class); bands are in "
            "BODY-height fractions."
        ),
    }


def run_actor(rel: str) -> dict:
    layers = load_actor(rel)
    garments = {
        "tshirt": layer_mesh(layers.get("tshirt", [])),
        "pants": layer_mesh(layers.get("pants", [])),
        "shoes": layer_mesh(layers.get("shoes", [])),
    }
    skin = layer_mesh(layers.get("skin", []))
    if skin is not None:
        fig_y_lo = float(skin.vertices[:, 1].min())
        fig_y_hi = float(skin.vertices[:, 1].max())
    else:
        allv = [m.vertices[:, 1] for m in [garments["tshirt"], garments["pants"], garments["shoes"]] if m is not None]
        if allv:
            fig_y_lo = float(min(v.min() for v in allv))
            fig_y_hi = float(max(v.max() for v in allv))
        else:
            fig_y_lo, fig_y_hi = 0.0, 1.0
    report: dict = {"file": rel, "figureYRange": [round(fig_y_lo, 3), round(fig_y_hi, 3)], "slots": {}}
    for slot in ("upper", "lower", "foot"):
        hidden = layer_tris(layers.get(f"hidden_{slot}", []))
        report["slots"][slot] = measure_slot(hidden, garments, slot, fig_y_lo, fig_y_hi)
    tot_exposed = sum(s.get("viewerExposedAny", 0) for s in report["slots"].values())
    tot_hidden = sum(s.get("triangleCount", 0) for s in report["slots"].values())
    report["summary"] = {
        "hiddenPolygons": tot_hidden,
        "exposedAny": tot_exposed,
        "exposedFracOfHidden": round(tot_exposed / max(tot_hidden, 1), 4),
        "exposedAreaM2": round(sum(s.get("exposedAreaM2", 0) for s in report["slots"].values()), 5),
    }
    return report


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    p = argparse.ArgumentParser(description="issue-341 hide-mask boundary instrument")
    p.add_argument("--out", required=True, help="report JSON path")
    p.add_argument("--actor", action="append", default=None, help="actor relpath")
    args = p.parse_args(argv)
    actors = args.actor or [f"apps/ui-xr/public/generated-humanoids/{a}.glb" for a in ACTORS]
    out: dict[str, dict] = {}
    for rel in actors:
        out[rel] = run_actor(rel)
    Path(args.out).write_text(json.dumps(out, indent=2), "utf-8")
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

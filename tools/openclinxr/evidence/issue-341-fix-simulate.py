#!/usr/bin/env python3
"""issue-341 round 7 — dry-run the proposed black-sliver predicate change on the
SHIPPED bytes, before any product edit.

The round-7 defect: discarded (alpha-0) hide-mask polygons that poke past the
garment's front coverage read as the dark background (black sawtooth at every
garment/skin seam; the nurse's jaw is the worst instance). The current predicate
un-hides only faces with NO cloth in front AND NO cloth behind along the back
axis (reach 0.5 m), so the jaw stays hidden — the collar's BACK panel is 13-19 cm
behind it and the 0.5 m reach counts it as "cloth behind", but a back-facing
panel is backface-culled at render, so the discarded jaw reads black.

Proposed predicate (measured here, not yet in the materializer), per AREA SAMPLE
of each hidden polygon (vertices + edge midpoints + centroid):

  hole(sample) = no cloth in front along the viewer ray AND no OUTER-facing
                 (front-facing) cloth surface behind it
  un_hide(polygon) = ANY sample is a hole

The behind test counts only garment triangles whose outward winding normal faces
the viewer (the front panel of the shirt, the outer boot upper); a back-facing
surface (the collar's back panel behind the jaw) cannot fill a discarded hole at
render (three.js culls backfaces).

claimScope: how many discarded polygons the proposed predicate would un-hide on
shipped MPFB GLBs, and where they sit.
notEvidenceFor: appearance, aesthetics, readiness. The orchestrator grades pixels.
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

sys.path.insert(0, str(_REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"))
from garment_coverage import _ray_tri_hits  # noqa: E402

VIEWER = np.array([0.0, 0.0, 1.0])   # GLB frame: toward the front viewer (+Z)
BACK = np.array([0.0, 0.0, -1.0])    # GLB frame: toward the figure's back
MAX_RAY_T = 0.5
RAY_OFFSET = 1e-4

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


def front_facing_tris(tris: np.ndarray) -> np.ndarray:
    """Garment triangles whose outward winding normal faces the GLB front viewer
    (+Z). Outward = centroid-away tiebreak (same as _orient_outward's tiebreak)."""
    if len(tris) == 0:
        return tris
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    n = np.cross(v1 - v0, v2 - v0)
    cents = tris.mean(axis=1)
    centroid = cents.mean(axis=0)
    away = np.einsum("ij,ij->i", n, cents - centroid)
    n = np.where(away[:, None] < 0, -n, n)
    n = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
    return tris[n[:, 2] > 0.0]


def area_samples(tris: np.ndarray) -> np.ndarray:
    """7 samples per triangle: 3 verts + 3 edge midpoints + centroid."""
    v = tris
    verts = v
    emid = np.stack([(v[:, 0] + v[:, 1]) * 0.5, (v[:, 1] + v[:, 2]) * 0.5, (v[:, 2] + v[:, 0]) * 0.5], axis=1)
    cent = v.mean(axis=1, keepdims=True)
    return np.concatenate([verts, emid, cent], axis=1)  # (F,7,3)


def measure_slot(hidden: np.ndarray, garments: dict[str, np.ndarray], slot: str,
                 fig_y_lo: float, fig_y_hi: float) -> dict:
    n = len(hidden)
    if n == 0:
        return {"slot": slot, "present": False, "triangleCount": 0}
    cents = hidden.mean(axis=1)
    all_gar = np.concatenate([g for g in garments.values() if len(g)]) if garments else np.zeros((0, 3, 3))
    front_gar = front_facing_tris(all_gar)
    samples = area_samples(hidden)  # (F,7,3)
    S = samples.reshape(n * 7, 3)

    # front test: any cloth surface in front along the viewer ray
    oa = S + VIEWER * RAY_OFFSET
    da = np.tile(VIEWER, (len(oa), 1))
    ha = _ray_tri_hits(oa, da, all_gar, MAX_RAY_T).reshape(n, 7)
    covered = np.isfinite(ha)

    # behind test: OUTER-facing cloth surface behind along the back ray
    ob = S + BACK * RAY_OFFSET
    db = np.tile(BACK, (len(oa), 1))
    hb = _ray_tri_hits(ob, db, front_gar, MAX_RAY_T).reshape(n, 7)
    front_behind = np.isfinite(hb)

    hole = ~covered & ~front_behind
    new_unhide = hole.any(axis=1)

    # current predicate for comparison: centroid front(any) + centroid behind(any @0.5m)
    oc = cents + VIEWER * RAY_OFFSET
    dc = np.tile(VIEWER, (len(cents), 1))
    hc = _ray_tri_hits(oc, dc, all_gar, MAX_RAY_T)
    cur_covered = np.isfinite(hc)
    obc = cents + BACK * RAY_OFFSET
    dbc = np.tile(BACK, (len(cents), 1))
    hbc = _ray_tri_hits(obc, dbc, all_gar, MAX_RAY_T)
    cur_behind = np.isfinite(hbc)
    cur_unhide = ~cur_covered & ~cur_behind

    span = max(fig_y_hi - fig_y_lo, 1e-6)
    frac = (cents[:, 1] - fig_y_lo) / span
    bands = ["head(0.90-1.00)", "neck(0.82-0.90)", "chest(0.64-0.82)", "waist(0.55-0.64)",
             "hip(0.44-0.55)", "thigh(0.24-0.44)", "knee(0.14-0.24)", "ankle(0.06-0.14)", "foot(0.00-0.06)"]
    edges = [(0.90, 1.01), (0.82, 0.90), (0.64, 0.82), (0.55, 0.64),
             (0.44, 0.55), (0.24, 0.44), (0.14, 0.24), (0.06, 0.14), (0.00, 0.06)]
    band_new = {}
    for b, (lo, hi) in zip(bands, edges):
        m = (frac >= lo) & (frac < hi)
        band_new[b] = int((m & new_unhide & ~cur_unhide).sum()) if m.any() else 0
    band_keep = {}
    for b, (lo, hi) in zip(bands, edges):
        m = (frac >= lo) & (frac < hi)
        band_keep[b] = int((m & ~new_unhide).sum()) if m.any() else 0

    return {
        "slot": slot,
        "triangleCount": int(n),
        "currentPredicateUnhide": int(cur_unhide.sum()),
        "proposedPredicateUnhide": int(new_unhide.sum()),
        "newlyUnhidden": int((new_unhide & ~cur_unhide).sum()),
        "keptHiddenByBoth": int((~new_unhide & ~cur_unhide).sum()),
        "newBands": band_new,
        "keptHiddenBands": band_keep,
    }


def run_actor(rel: str) -> dict:
    layers = load_actor(rel)
    garments = {
        "tshirt": layer_tris(layers.get("tshirt", [])),
        "pants": layer_tris(layers.get("pants", [])),
        "shoes": layer_tris(layers.get("shoes", [])),
    }
    skin = layer_mesh(layers.get("skin", []))
    fig_y_lo = float(skin.vertices[:, 1].min()) if skin is not None else 0.0
    fig_y_hi = float(skin.vertices[:, 1].max()) if skin is not None else 1.0
    report: dict = {"file": rel, "slots": {}}
    for slot in ("upper", "lower", "foot"):
        report["slots"][slot] = measure_slot(layer_tris(layers.get(f"hidden_{slot}", [])),
                                             garments, slot, fig_y_lo, fig_y_hi)
    return report


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    p = argparse.ArgumentParser(description="issue-341 fix predicate dry-run")
    p.add_argument("--out", required=True)
    p.add_argument("--actor", action="append", default=None)
    args = p.parse_args(argv)
    actors = args.actor or [f"apps/ui-xr/public/generated-humanoids/{a}.glb" for a in ACTORS]
    out = {}
    for rel in actors:
        out[rel] = run_actor(rel)
    Path(args.out).write_text(json.dumps(out, indent=2), "utf-8")
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

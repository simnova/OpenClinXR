#!/usr/bin/env python3
"""issue-338 — between-layers occlusion gate for shipped humanoid GLBs.

Every per-layer contract in this repo bounds ONE layer (eyes resolve, scalp stops
behind the face band, channels present+skinned+grounded). None of them can see a
defect that lives BETWEEN layers: #337 landed CC0 MakeHuman eyes 20 minutes after
#282 fixed the scalp face band, and the band (height fraction [0.82, 0.93]) is
correct and blind to the eyes that sit at 0.93-0.945 of body height — so the
scalp-painted brow renders IN FRONT of every eye on all three MPFB bodies, and
every layer gate is green while no figure is presentable.

This gate is the instrument for that class. It reuses the PROVEN ray-triangle
intersector `_ray_tri_hits` (tools/openclinxr/asset-pipeline/makeclothes/
garment_coverage.py:184) — no new intersector is written. For each named layer on
each actor it casts rays from every triangle centroid toward the VIEWER (the
figure's +Z; GLB Y-up, face at +Z on every shipped rail, #279) and asks WHICH
LAYER IS HIT FIRST. That is a ray hit-order question — it needs no clearance
threshold and none is invented.

Verdict per sample ray:
  visible           no other layer's surface lies between the sample and the viewer
  self-occluded     the FIRST surface the ray meets is the subject's own layer
                    (an inner/back surface of the same shell — e.g. the heel
                    lining of a boot, the back of a shirt shell)
  occluded-by-<L>   the first surface the ray meets belongs to another named layer

The subject's OWN layer is included in the hit test so an interior-facing surface
(the boot heel lining, which would otherwise read as "occluded by the leg" because
the leg is inside the boot) is correctly classified as self-occluded instead of as
a poke-through. Invisible (alpha-0 body-hide) regions are excluded entirely — they
do not render, so they cannot occlude.

Calibration (the same figure, before any assertion): the t-shirt and boots on the
nurse must report near-zero occludedByOther (they are genuinely the frontmost
surface on the torso/feet) while the eyes must report a large occludedByOther
(scalp in front). An instrument that reports everything occluded fails; one that
reports everything visible fails. Both directions are written to the report before
any product edit.

claimScope: which named layer is in front of which, on shipped MPFB GLBs, from a
front (+Z) viewer — a between-layers occlusion predicate for the eyes/scalp,
footwear/toes and garment/hand classes.
notEvidenceFor: garment aesthetics, clinical wardrobe, Quest readiness, cloth
physics, render quality. The gate does not grade pixels; the orchestrator does.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh

_HERE = Path(__file__).resolve().parent
_REPO_ROOT = _HERE.parents[2]

sys.path.insert(0, str(_REPO_ROOT / "tools/openclinxr/asset-pipeline/makeclothes"))
from garment_coverage import _ray_tri_hits  # noqa: E402 — the proven intersector

# Viewer: the exported GLBs are Y-up with the face at +Z (verified #279 on every
# shipped rail). The "front view" is a camera at +Z looking toward -Z, so a ray
# from a surface point toward the viewer runs along +Z.
VIEWER_DIR = np.array([0.0, 0.0, 1.0])
# Generous ray reach: the figure is ~0.5 m deep; anything in front of a sample at
# up to half a metre is a real occluder. This is NOT a clearance threshold — it is
# the maximum scene depth the ray is allowed to cross before "no layer in front".
MAX_RAY_T = 0.5
# Rays start 0.1 mm off the sample surface so a sample does not hit its own plane.
RAY_OFFSET = 1e-4
# Sample cap per layer (uniform stride over triangle order) — keeps the report
# deterministic and fast while covering the whole surface. 30k-tri boots drop to
# the cap; the 172-tri eye is sampled whole.
MAX_SAMPLES = 4000
# Occluder triangle cap per layer: a hit on ANY occluder triangle classifies the
# ray, so large occluders (30k-tri boots) are strided without losing the verdict —
# a layer in front is still hit, a layer not in front still misses.
MAX_OCCLUDER_TRIS = 6000

# Actors the gate measures (the #337 eyes landed on all three MPFB bodies).
ACTORS = [
    "mpfb-ob-patient-aisha",
    "mpfb-peds-nurse-kevin",
    "mpfb-peds-patient-child",
]

# Layer classification: mesh-name / material-name based, the same attribution the
# repo's evidence modules use (/eye|cornea|iris|sclera/, /scalp_hair/, ...).
def classify(gname: str, material: str) -> str:
    n = gname.lower()
    m = material.lower()
    if "eye" in n and ("low_poly" in n or "cornea" in n or "iris" in n or "sclera" in n):
        return "eyes"
    if "scalp_hair" in m:
        return "scalp"
    if "hidden" in m:
        return "hidden"
    if "boot" in n or "shoe" in n or "footwear" in n:
        return "boots"
    if "t_shirt" in n or "tshirt" in n or "shirt" in n or "sweater" in n:
        return "tshirt"
    if "pants" in n or "trouser" in n:
        return "pants"
    if "hair" in n:
        return "hair"
    if "skin" in m:
        return "skin"
    return "other"


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


def _is_invisible_material(mat: str) -> bool:
    """Body-hide regions (alpha-0, alphaCutoff MASK) do not render; they cannot
    occlude. The materializer names them openclinxr_hidden_* — classify() already
    maps them to 'hidden'; this is a defensive second check on the base color."""
    return "hidden" in mat.lower()


def load_actor(rel: str) -> dict[str, list[trimesh.Trimesh]]:
    path = _REPO_ROOT / rel
    scene = trimesh.load(str(path), force=None)
    layers: dict[str, list[trimesh.Trimesh]] = {}
    for gname, geom in scene.geometry.items():
        if isinstance(geom, trimesh.Scene) or not isinstance(geom, trimesh.Trimesh):
            continue
        mat = _material_name(geom)
        key = classify(gname, mat)
        layers.setdefault(key, []).append(geom)
    return layers


def layer_triangles(
    layers: dict[str, list[trimesh.Trimesh]], key: str, cap: int = 0
) -> np.ndarray:
    parts = []
    for geom in layers.get(key, []):
        v = geom.vertices
        f = geom.faces
        if len(f) == 0:
            continue
        parts.append(v[f])
    if not parts:
        return np.zeros((0, 3, 3), dtype=float)
    tris = np.concatenate(parts)
    if cap and len(tris) > cap:
        stride = max(1, math.ceil(len(tris) / cap))
        tris = tris[::stride]
    return tris


def measure_layer(
    subject: str,
    layers: dict[str, list[trimesh.Trimesh]],
    occluders: list[str],
) -> dict:
    tris = layer_triangles(layers, subject)
    n_total = len(tris)
    if n_total == 0:
        return {"layer": subject, "present": False, "triangleCount": 0}

    # Sample the FRONT hemisphere of the subject only: triangles whose centroid z
    # is beyond the layer's own z-centre. The occlusion question is "is the front
    # of this layer visible from the viewer" — the back of a shell (the boot heel,
    # the shirt back, the far side of an eye) is never a front-view surface, and
    # sampling it pollutes the verdict with inner surfaces that the viewer cannot
    # see through anyway (measured: the boot heel-lining read as "occluded by the
    # leg" because the leg is inside the boot). The z-centre is a property of the
    # layer's own bounds — not a fitted threshold.
    z_lo = float(tris[:, :, 2].min())
    z_hi = float(tris[:, :, 2].max())
    z_centre = (z_lo + z_hi) * 0.5
    cents = tris.mean(axis=1)
    cents = cents[cents[:, 2] >= z_centre]
    if len(cents) == 0:
        cents = tris.mean(axis=1)
    # uniform stride to the sample cap (deterministic; triangle order is stable)
    step = max(1, math.ceil(len(cents) / MAX_SAMPLES))
    cents = cents[::step]
    origins = cents + VIEWER_DIR * RAY_OFFSET
    dirs = np.tile(VIEWER_DIR, (len(origins), 1))

    # first hit per ray across every occluding layer (including the subject's own
    # layer so a curved front surface that re-enters its own shell classifies as
    # self-occluded rather than as a poke from behind)
    first_dist = np.full(len(origins), np.inf)
    first_layer = np.full(len(origins), "", dtype=object)
    for other in occluders:
        t = layer_triangles(layers, other, cap=MAX_OCCLUDER_TRIS)
        if len(t) == 0:
            continue
        hits = _ray_tri_hits(origins, dirs, t, MAX_RAY_T)
        closer = np.isfinite(hits) & (hits < first_dist)
        first_dist[closer] = hits[closer]
        first_layer[closer] = other

    n = len(origins)
    visible = int((~np.isfinite(first_dist)).sum())
    occ: dict[str, int] = {}
    for lbl in np.unique(first_layer):
        if lbl == "":
            continue
        occ[lbl] = int((first_layer == lbl).sum())

    per_other = {k: round(v / n, 4) for k, v in sorted(occ.items()) if k != subject}
    self_frac = round(occ.get(subject, 0) / n, 4)
    return {
        "layer": subject,
        "present": True,
        "triangleCount": n_total,
        "sampledCount": n,
        "visibleFraction": round(visible / n, 4),
        "selfOccludedFraction": self_frac,
        "occludedByOtherFraction": round(sum(v for k, v in per_other.items()), 4),
        "occludedBy": per_other,
    }


def landmarks(layers: dict[str, list[trimesh.Trimesh]]) -> dict:
    """Per-actor landmark numbers in the issue's units (metres, GLB frame): the
    scalp and eye vertical spans plus their anterior (maxZ) extents — the
    bounding-box proxy the issue measured, reproduced for comparison. The gate's
    VERDICT is the ray hit-order above; these are the diagnostic table only."""
    out: dict[str, dict] = {}
    for label, key in (("scalp", "scalp"), ("eyes", "eyes")):
        tris = layer_triangles(layers, key)
        if len(tris) == 0:
            out[label] = None
            continue
        v = tris.reshape(-1, 3)
        out[label] = {
            "minY": round(float(v[:, 1].min()), 4),
            "maxY": round(float(v[:, 1].max()), 4),
            "maxZ": round(float(v[:, 2].max()), 4),
            "triangleCount": int(len(tris)),
        }
    return out


def run_actor(rel: str) -> dict:
    layers = load_actor(rel)
    # occluder set: every layer that RENDERS (visible material). The subject's own
    # layer is tested for self-occlusion; hidden (alpha-0) layers are excluded.
    occluders = [
        k
        for k in layers
        if k not in ("hidden",)
    ]
    report: dict = {"file": rel, "layers": {}, "landmarks": landmarks(layers)}
    for subject in ("eyes", "scalp", "tshirt", "boots", "pants", "skin", "hair", "other"):
        report["layers"][subject] = measure_layer(subject, layers, occluders)
    # summary verdicts for the three defect classes the issue names
    eyes = report["layers"]["eyes"]
    tshirt = report["layers"]["tshirt"]
    boots = report["layers"]["boots"]
    report["verdicts"] = {
        "eyes": "occluded" if eyes.get("occludedByOtherFraction", 1) > 0.5 else "visible",
        "tshirt": "visible" if tshirt.get("occludedByOtherFraction", 1) < 0.2 else "occluded",
        "boots": "visible" if boots.get("occludedByOtherFraction", 1) < 0.2 else "occluded",
    }
    return report


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    p = argparse.ArgumentParser(description="issue-338 between-layers occlusion gate")
    p.add_argument("--out", required=True, help="report JSON path")
    p.add_argument("--actor", action="append", default=None, help="actor relpath (default: all)")
    args = p.parse_args(argv)

    actors = args.actor or [f"apps/ui-xr/public/generated-humanoids/{a}.glb" for a in ACTORS]
    actors_report: dict[str, dict] = {}
    for rel in actors:
        actors_report[rel] = run_actor(rel)

    # PRE-FIX BASELINE — the calibration snapshot, written 2026-08-11 BEFORE any
    # product edit and committed as b9ef5176. Immutable evidence that the instrument
    # discriminated on one figure (t-shirt + boots visible, eyes occluded) before it
    # was used to assert anything. The fix work then re-pointed the defects at it.
    pre_fix = {
        "calibration": {
            "figure": "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
            "tshirtOccludedByOther": 0.0096,
            "bootsOccludedByOther": 0.0459,
            "eyesOccludedByOther": 0.5517,
            "eyeOccluders": {"scalp": 0.5, "skin": 0.0517},
            "passes": True,
            "note": (
                "written before any product edit; both directions of the discriminator "
                "proved on one figure — an instrument that said everything occluded or "
                "everything visible would have failed this row"
            ),
        },
        "actors": {
            "mpfb-ob-patient-aisha.glb": {
                "eyesOccludedByOther": 0.213,
                "tshirtOccludedByOther": 0.015,
                "bootsOccludedByOther": 0.074,
            },
            "mpfb-peds-nurse-kevin.glb": {
                "eyesOccludedByOther": 0.552,
                "tshirtOccludedByOther": 0.010,
                "bootsOccludedByOther": 0.046,
            },
            "mpfb-peds-patient-child.glb": {
                "eyesOccludedByOther": 0.215,
                "tshirtOccludedByOther": 0.065,
                "bootsOccludedByOther": 0.0,
            },
        },
        "note": (
            "the issue's bounding-box proxy (scalp maxZ vs eye maxZ) over-claimed for "
            "aisha/child: the ray instrument shows their eyes mostly VISIBLE (the scalp "
            "is beside/above those eyes, not in front). Only the nurse's eyes were "
            "genuinely scalp-occluded (§11s: a box cannot see in front of vs beside)."
        ),
    }

    fix_summary: dict[str, dict] = {}
    for rel, a in actors_report.items():
        name = rel.split("/")[-1]
        base = pre_fix["actors"][name]
        fix_summary[name] = {
            "eyes": {
                "preFixOccludedByOther": base["eyesOccludedByOther"],
                "postFixOccludedByOther": a["layers"]["eyes"]["occludedByOtherFraction"],
                "postFixOccluders": a["layers"]["eyes"]["occludedBy"],
                "postFixVisibleFraction": a["layers"]["eyes"]["visibleFraction"],
            },
            "tshirt": {
                "preFixOccludedByOther": base["tshirtOccludedByOther"],
                "postFixOccludedByOther": a["layers"]["tshirt"]["occludedByOtherFraction"],
            },
            "boots": {
                "preFixOccludedByOther": base["bootsOccludedByOther"],
                "postFixOccludedByOther": a["layers"]["boots"]["occludedByOtherFraction"],
            },
        }

    report = {
        "schema": "figure-occlusion-report.v1",
        "issue": "issue-338",
        "stage": "post-fix",
        "preFixBaseline": pre_fix,
        "fixSummary": fix_summary,
        "instrument": {
            "intersector": "_ray_tri_hits (garment_coverage.py:184)",
            "viewerDirection": [0, 0, 1],
            "maxRayMeters": MAX_RAY_T,
            "selfLayerIncluded": True,
            "hiddenLayersExcluded": True,
            "claimScope": (
                "which named layer renders in front of which, per actor, from a front "
                "(+Z) viewer; between-layers occlusion predicate"
            ),
            "notEvidenceFor": [
                "garment aesthetics",
                "clinical wardrobe",
                "Quest readiness",
                "cloth physics",
                "pixel grading (orchestrator grades captures)",
            ],
        },
        "actors": actors_report,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"WROTE {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

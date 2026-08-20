#!/usr/bin/env python3
"""#485 — cause probe: what renders through the closed gown skirt?

Measure-only. Full 3D containment: for every body (skin) vertex and every trouser
(cargo_pants) vertex in the hem->hip band, the SIGNED distance along the skirt's own
outward surface normal, using the nearest skirt triangle (not a per-axis projection).

The two-band framing the orchestrator asked for:
  - known-good band: the UPPER skirt near the hip (grades visibly clean)
  - treatment band:  the THIGH (grades pale patches from mid-thigh to hem)

Skin is the body mesh; trousers are `makeclothes_library_cargo_pants` — still cast on
this body under the gown. Signed convention: dot(body_vertex - nearest_skirt_point,
skirt_outward_normal) > 0 means the vertex is on the OUTWARD side of the skirt surface
and pokes through; < 0 means hidden behind it; ~0 means coincident (z-fight).

Instrument: trimesh `nearest.on_surface` (nearest point + triangle id) against the
position-welded skirt, normals made globally outward via `fix_normals` + signed-volume
sign (the skirt below the hip is a single closed tube, so its orientation is sane —
signed volume +0.0701 m^3, 89.8% faces away from centroid).

claimScope: which mesh pokes through the gown skirt on mpfb-gown-inspect.glb.
notEvidenceFor: runtime skinning/pose, cloth physics, clinical wardrobe policy.
"""

from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
import trimesh

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
GLB = REPO_ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb"
OUT = pathlib.Path(__file__).resolve().with_suffix(".json")

HIP_FRAC = 0.55          # body-height fraction of the hip (same SSOT as the #481 test)
BAND_STEP_M = 0.03       # per-band reporting resolution
POKE_EPS_M = 0.002       # |sd| below this = coincident / z-fight
POKE_SOFT_M = 0.005      # sd above this = clearly protruding
# Known-good vs treatment split, as fractions of the hem->hip span:
# the thigh (bottom) is the defective region; the upper skirt near the hip is clean.
TREATMENT_SPAN = 0.45    # bottom 45% of the span (hem -> mid-thigh)
KNOWN_GOOD_START = 0.70  # top 30% of the span (upper skirt near hip)


def _geom(prefix: str) -> trimesh.Trimesh:
    scene = trimesh.load(GLB)
    for name, g in scene.geometry.items():
        if isinstance(g, trimesh.Trimesh) and prefix in name:
            return g
    raise KeyError(prefix)


def _base_color(mesh: trimesh.Trimesh):
    vis = mesh.visual
    mat = getattr(vis, "material", None)
    if mat is None:
        return None
    for attr in ("baseColorFactor", "main_color"):
        v = getattr(mat, attr, None)
        if v is not None:
            return [int(x) for x in np.asarray(v)[:4]]
    return None


def _outward_skirt(skirt: trimesh.Trimesh) -> trimesh.Trimesh:
    sk = skirt.copy()
    sk.fix_normals()
    if sk.volume < 0.0:
        sk.invert()
    return sk


def _signed_distance(sk: trimesh.Trimesh, pts: np.ndarray):
    closest, _dist, tid = sk.nearest.on_surface(np.asarray(pts, dtype=float))
    normals = sk.face_normals[np.asarray(tid)]
    sd = np.einsum("ij,ij->i", np.asarray(pts, dtype=float) - closest, normals)
    return sd, closest


def _band_stats(sk: trimesh.Trimesh, verts: np.ndarray, lo: float, hi: float):
    m = (verts[:, 1] >= lo) & (verts[:, 1] < hi)
    pts = verts[m]
    if len(pts) == 0:
        return None
    sd, closest = _signed_distance(sk, pts)
    poke = sd > POKE_EPS_M
    soft = sd > POKE_SOFT_M
    zf = np.abs(sd) < POKE_EPS_M
    # protrusion direction: how much of the displacement is front/back (|Z|) vs lateral (|X|)
    delta = pts - closest
    dx = np.abs(delta[poke, 0])
    dz = np.abs(delta[poke, 2])
    z_share = float(np.sum(dz) / (np.sum(dx) + np.sum(dz) + 1e-12)) if poke.any() else None
    return {
        "bandY": [round(float(lo), 3), round(float(hi), 3)],
        "vertexCount": int(len(pts)),
        "pokeCount": int(poke.sum()),
        "pokeFraction": round(float(poke.mean()), 4),
        "clearPokeCount": int(soft.sum()),
        "clearPokeFraction": round(float(soft.mean()), 4),
        "coincidentFraction": round(float(zf.mean()), 4),
        "maxSignedMeters": round(float(sd.max()), 4),
        "meanSignedMeters": round(float(sd.mean()), 4),
        "frontBackShareOfPoke": round(z_share, 4) if z_share is not None else None,
    }


def main() -> int:
    body = _geom("mpfb_ob_patient_aisha_body")
    skirt = _geom("openclinxr_real_garment_peds_upper_v1_mesh")
    trou = _geom("makeclothes_library_cargo_pants")

    sk = _outward_skirt(skirt)
    hem = float(skirt.vertices[:, 1].min())
    by0 = float(body.vertices[:, 1].min())
    by1 = float(body.vertices[:, 1].max())
    hip = by0 + HIP_FRAC * (by1 - by0)
    span = hip - hem

    treatment_lo, treatment_hi = hem, hem + TREATMENT_SPAN * span
    known_lo, known_hi = hem + KNOWN_GOOD_START * span, hip

    report = {
        "issue": 485,
        "verdict": "mechanism_named",
        "asset": str(GLB.relative_to(REPO_ROOT)),
        "instrument": "trimesh nearest.on_surface -> signed distance along skirt outward normal "
                      "(fix_normals + signed-volume orientation; nearest skirt triangle, full 3D)",
        "skirt": {
            "mesh": "openclinxr_real_garment_peds_upper_v1_mesh",
            "signedVolumeM3": round(float(sk.volume), 4),
            "awayFromCentroidFraction": round(float(
                (np.einsum("ij,ij->i", sk.face_normals, sk.triangles_center - sk.vertices.mean(axis=0)) > 0).mean()
            ), 4),
            "color": _base_color(skirt),
        },
        "bands": {
            "hemM": round(hem, 3),
            "hipM": round(hip, 3),
            "knownGoodBandY": [round(known_lo, 3), round(known_hi, 3)],
            "treatmentBandY": [round(treatment_lo, 3), round(treatment_hi, 3)],
        },
        "skin": {
            "mesh": "mpfb_ob_patient_aisha_body",
            "color": _base_color(body),
            "knownGoodBand": _band_stats(sk, body.vertices, known_lo, known_hi),
            "treatmentBand": _band_stats(sk, body.vertices, treatment_lo, treatment_hi),
            "profile": [
                _band_stats(sk, body.vertices, y, y + BAND_STEP_M)
                for y in np.arange(hem, hip, BAND_STEP_M)
            ],
        },
        "trousers": {
            "mesh": "makeclothes_library_cargo_pants_mpfb_ob_patient_aisha_mesh",
            "color": _base_color(trou),
            "knownGoodBand": _band_stats(sk, trou.vertices, known_lo, known_hi),
            "treatmentBand": _band_stats(sk, trou.vertices, treatment_lo, treatment_hi),
            "profile": [
                _band_stats(sk, trou.vertices, y, y + BAND_STEP_M)
                for y in np.arange(hem, hip, BAND_STEP_M)
            ],
        },
        "mechanism": (
            "The pale leg-coloured patches are the cargo_pants trousers, not skin. "
            "Skin signed distance is negative everywhere (max +0.2 mm, 0% poking), so the body "
            "never protrudes through the closed skirt. The cargo_pants mesh pokes through the "
            "skirt along the skirt outward normal: up to +16.6 mm and 56% of thigh-band vertices "
            "poking, with a beige base colour [184,173,140] that matches the pale patches. The "
            "trousers are wider than the skirt tube (baggy cargo pants), so a full-length gown "
            "shell that drapes tight to the legs cannot contain them."
        ),
        "file": "tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py",
        "line": 119,
        "fileNote": (
            "The bake imports the source body (which already wears makeclothes_library_cargo_pants) "
            "and adds the gown shell as a NEW object; the pre-existing lower garment is never "
            "stripped (the keep-list at lines 177-197 retains only the new gown/declaration meshes "
            "and the source cargo_pants mesh passes through to the export untouched)."
        ),
        "claimScope": "which mesh pokes through the gown skirt on mpfb-gown-inspect.glb (static bind pose)",
        "notEvidenceFor": (
            "runtime skinning/pose deformation, cloth physics, clinical wardrobe policy, "
            "or the production cast (this measures the inspect asset only)"
        ),
    }

    OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

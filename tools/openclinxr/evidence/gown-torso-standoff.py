#!/usr/bin/env python3
"""#488 — cause probe: is the gown's TORSO conformal (traces the body) or draped (hangs)?

Measure-only. Reuses the #485 nearest-triangle instrument (`gown-see-through-cause.py`)
which is immune to the arm confound because it measures the signed distance from each body
vertex to its NEAREST shell triangle along that triangle's outward normal — a true 3D
standoff, not a lateral-sector radius projection.

Three bands, two of them controls that live inside the same asset:
  - conformal control: the fitted MakeClothes t-shirt torso (supposed to trace the body)
  - draped control:    the gown's own skirt, hem->hip (a resampled ring, not tracing the legs)
  - treatment:         the gown's torso (the band under test)

The discriminating statistic is the VARIATION (standard deviation) of the body->shell
signed distance within a band (§11s: bound the shape, not the extreme). A conformal offset
has near-constant clearance; a draped garment's clearance grows under the bust / at the
waist. The sub-band profile (0.03 m steps) is the shape evidence.

Arms are abducted in this bind pose, so at torso height the body's lateral extremes are
arms, not the trunk. We exclude them with a trunk filter (|x| < TRUNK_X_MAX), which keeps
every skirt-band vertex too (legs are inside 0.22 m).

claimScope: whether the gown TORSO standoff profile on mpfb-gown-inspect.glb is a conformal
  offset (traces bust/navel) or draped (hangs) in the static bind pose.
notEvidenceFor: runtime skinning/pose, cloth physics, clinical wardrobe policy, the
  production cast, or the gown's skirt/sleeves.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

import numpy as np
import trimesh

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
GLB = REPO_ROOT / "apps/ui-xr/public/generated-humanoids/mpfb-gown-inspect.glb"
OUT = pathlib.Path(__file__).resolve().with_suffix(".json")

# Reuse the #485 instrument verbatim rather than authoring a fourth probe (D1).
_SPEC = importlib.util.spec_from_file_location(
    "gown_see_through_cause", pathlib.Path(__file__).resolve().with_name("gown-see-through-cause.py")
)
assert _SPEC is not None and _SPEC.loader is not None
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)
_geom = _MOD._geom
_outward_skirt = _MOD._outward_skirt
_signed_distance = _MOD._signed_distance

HIP_FRAC = 0.55          # body-height fraction of the hip (same SSOT as #485/#481)
TRUNK_X_MAX = 0.22       # m; excludes abducted arms, keeps the trunk (and all skirt verts)
BAND_STEP_M = 0.03       # per-sub-band shape resolution
# Below the neckline both garments stop tracing the trunk (collar opening / neck), which is
# not "bust and navel". Torso-proper discriminator window used for the conformal/draped call.
TORSO_PROPER_TOP = 1.35


def _orient_outward_from_body(shell: trimesh.Trimesh, body: trimesh.Trimesh) -> trimesh.Trimesh:
    """Outward-orient an OPEN shell (t-shirt / gown torso) relative to the body.

    `_outward_skirt` (fix_normals + signed-volume sign) is only sound for a closed tube;
    an open torso shell has no signed volume, so orient each face away from the nearest
    body vertex instead. Reduces to the same result for closed shells.
    """
    c = shell.copy()
    c.fix_normals()
    centers = c.triangles_center
    closest_body, _dist, _tid = body.nearest.on_surface(centers)
    outward = centers - closest_body
    fn = c.face_normals.copy()
    fn[np.einsum("ij,ij->i", c.face_normals, outward) < 0.0] *= -1.0
    c.face_normals = fn
    return c


def _standoff_stats(shell: trimesh.Trimesh, verts: np.ndarray, lo: float, hi: float):
    """Signed standoff of trunk vertices in [lo, hi) against the outward shell."""
    m = (verts[:, 1] >= lo) & (verts[:, 1] < hi) & (np.abs(verts[:, 0]) < TRUNK_X_MAX)
    pts = verts[m]
    if len(pts) == 0:
        return None
    sd, _closest = _signed_distance(shell, pts)
    return {
        "bandY": [round(float(lo), 3), round(float(hi), 3)],
        "vertexCount": int(len(pts)),
        "meanSignedMeters": round(float(sd.mean()), 4),
        "stdSignedMeters": round(float(sd.std(ddof=0)), 4),  # the discriminating statistic
        "minSignedMeters": round(float(sd.min()), 4),
        "maxSignedMeters": round(float(sd.max()), 4),
    }


def _profile(shell: trimesh.Trimesh, verts: np.ndarray, lo: float, hi: float):
    return [
        _standoff_stats(shell, verts, y, min(y + BAND_STEP_M, hi))
        for y in np.arange(lo, hi, BAND_STEP_M)
    ]


def main() -> int:
    body = _geom("mpfb_ob_patient_aisha_body")
    gown = _geom("openclinxr_real_garment_peds_upper_v1_mesh")
    tshirt = _geom("makeclothes_library_toigo_t_shirt_mpfb_ob_patient_aisha_mesh")

    sk = _outward_skirt(gown)             # closed skirt tube: reuse #485 orientation
    ts = _orient_outward_from_body(tshirt, body)   # open shells: body-relative outward
    gt = _orient_outward_from_body(gown, body)

    by0 = float(body.vertices[:, 1].min())
    by1 = float(body.vertices[:, 1].max())
    hip = by0 + HIP_FRAC * (by1 - by0)
    hem = float(gown.vertices[:, 1].min())
    gown_top = float(gown.vertices[:, 1].max())
    tshirt_lo = float(tshirt.vertices[:, 1].min())
    tshirt_hi = float(tshirt.vertices[:, 1].max())

    bands = {
        "conformalControl": {
            "role": "fitted MakeClothes t-shirt torso (supposed to trace the body)",
            "mesh": "makeclothes_library_toigo_t_shirt_mpfb_ob_patient_aisha_mesh",
            "shell": ts,
            "lo": tshirt_lo,
            "hi": tshirt_hi,
        },
        "drapedControl": {
            "role": "gown skirt, hem->hip (resampled ring, not tracing the legs)",
            "mesh": "openclinxr_real_garment_peds_upper_v1_mesh (skirt)",
            "shell": sk,
            "lo": hem,
            "hi": hip,
        },
        "treatment": {
            "role": "gown torso (band under test)",
            "mesh": "openclinxr_real_garment_peds_upper_v1_mesh (torso)",
            "shell": gt,
            "lo": hip,
            "hi": gown_top,
        },
    }

    stats = {
        key: {
            "band": bands[key]["role"],
            "mesh": bands[key]["mesh"],
            "full": _standoff_stats(bands[key]["shell"], body.vertices, bands[key]["lo"], bands[key]["hi"]),
            "profile": _profile(bands[key]["shell"], body.vertices, bands[key]["lo"], bands[key]["hi"]),
        }
        for key in ("conformalControl", "drapedControl", "treatment")
    }

    conf = stats["conformalControl"]["full"]
    drap = stats["drapedControl"]["full"]
    treat = stats["treatment"]["full"]

    conf_std = conf["stdSignedMeters"]
    drap_std = drap["stdSignedMeters"]
    treat_std = treat["stdSignedMeters"]

    # Stop-rule gate: can the statistic separate a fitted t-shirt from a hanging skirt?
    separation = max(conf_std, drap_std) / (min(conf_std, drap_std) + 1e-12)
    controls_separated = separation >= 2.0

    # Torso-proper discriminator: the flat standoff region below the neckline, where
    # "bust and navel" live. The neckline/collar top of either garment is not a torso band.
    def _torso_proper(shell, lo):
        return _standoff_stats(shell, body.vertices, lo, TORSO_PROPER_TOP)

    conf_proper = _torso_proper(ts, tshirt_lo)
    treat_proper = _torso_proper(gt, hip)

    # A conformal offset has a flat (near-constant) clearance profile; a draped garment's
    # grows. Call the treatment by which control's proper-torso variation it matches.
    if not controls_separated:
        verdict = "reject_measured"
    elif treat_proper is None or conf_proper is None:
        verdict = "reject_measured"
    else:
        # distance to each control in variation space
        d_conf = abs(treat_proper["stdSignedMeters"] - conf_proper["stdSignedMeters"])
        d_drap = abs(treat_proper["stdSignedMeters"] - drap_std)
        verdict = "conformal" if d_conf <= d_drap else "draped"

    report = {
        "issue": 488,
        "verdict": verdict,
        "asset": str(GLB.relative_to(REPO_ROOT)),
        "instrument": (
            "reuses #485 gown-see-through-cause.py `_geom`/`_signed_distance`/`_outward_skirt` "
            "(trimesh nearest.on_surface -> signed distance along the shell's outward normal, "
            "nearest triangle, full 3D). Open torso shells oriented outward relative to the "
            "body (generalizes `_outward_skirt`, which needs a closed tube). Arms excluded by "
            "trunk filter |x| < 0.22 m because the bind pose abducts the arms."
        ),
        "statistic": (
            "stdSignedMeters: standard deviation (ddof=0) of the body->shell signed distance "
            "within the band, over trunk vertices. A conformal offset has near-constant "
            "clearance (low std); a draped garment's clearance grows under the bust / at the "
            "waist (high std). The 0.03 m sub-band profile is the shape evidence."
        ),
        "bands": {
            "hemM": round(hem, 3),
            "hipM": round(hip, 3),
            "gownTopM": round(gown_top, 3),
            "tShirtY": [round(tshirt_lo, 3), round(tshirt_hi, 3)],
            "trunkXMaxM": TRUNK_X_MAX,
            "torsoProperTopM": TORSO_PROPER_TOP,
        },
        "perBand": stats,
        "torsoProper": {
            "conformalControl": conf_proper,
            "treatment": treat_proper,
            "drapedControlStd": drap_std,
        },
        "discrimination": {
            "controlsSeparated": controls_separated,
            "drapedOverConformalStdRatio": round(float(separation), 3),
            "conformalControlStd": conf_std,
            "drapedControlStd": drap_std,
            "treatmentStd": treat_std,
        },
        "claimScope": "whether the gown TORSO standoff on mpfb-gown-inspect.glb is conformal or draped (static bind pose)",
        "notEvidenceFor": (
            "runtime skinning/pose deformation, cloth physics, clinical wardrobe policy, "
            "the production cast, or the gown skirt/sleeves"
        ),
    }

    OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())

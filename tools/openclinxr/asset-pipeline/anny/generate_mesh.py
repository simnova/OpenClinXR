#!/usr/bin/env python3
"""
Anny mesh generation (Python/PyTorch script, target <5 seconds).

This is the local, OSS-first entrypoint for role_specific_humanoid_glb base body generation.

Usage (example for peds_asthma_parent_anxiety case):
  python generate_mesh.py \
    --params '{"age": 8, "body_profile": "pediatric_school_age", "pose": "standing_neutral", "phenotype": {"skin_tone": "warm_light_child", "hair_color": "light_brown", "eye_color": "hazel", "gender_presentation": "child", "height_cm": 125, "build": "slender_asthma"}}' \
    --output .openclinxr/asset-production/peds-asthma/generated/anny-peds-asthma-patient.obj \
    --manifest .openclinxr/asset-production/peds-asthma/generated/anny-peds-asthma-patient-manifest.json \
    # Final GLB is produced by automate_blender.py.

In a real deployment the "forward pass" section loads the Anny (or Anny-compatible) PyTorch model
from the official tutorials/notebooks, runs inference on the normalized parameter vector, and
exports a production-quality mesh with clean UVs ready for StableGen / ComfyUI baking.

The script is deliberately dependency-light for the stub so it runs in CI and on M1 Max without
heavy GPU requirements for the mesh stage itself (texturing is the heavier stage, offloaded to
ComfyUI server or Blender addon).

This advances the blueprint-driven asset factory: case spec (actor description + clinical
phenotype hints) -> explicit params -> generated base mesh + provenance manifest.
"""

import argparse
import hashlib
import json
import math
import os
import contextlib
import io
from typing import Any, Dict, List, Optional, Sequence, Tuple

# issue-294 sufficiency gate: a phenotype that is merely PRESENT is not enough — at
# least one field that actually drives body geometry must be authored. Cosmetic and
# affect fields (flush, hair_color, eye_color, skin_tone, anxious, brow_tension,
# age_wrinkle, clothing_*, garmentLayers, ...) do not make a body distinguishable and
# must not satisfy the gate alone. The set is the fields build_source_body /
# normalized_anny_phenotype / automate_blender read to vary geometry; see #294 NOT
# TESTED: whether these six are the RIGHT set is a generator question, not a clinical
# claim.
PHENOTYPE_BODY_SHAPE_FIELDS = (
    "age",
    "height_cm",
    "build",
    "bmi",
    "body_profile",
    "gender_presentation",
)


def phenotype_is_sufficient(phenotype: Any) -> bool:
    """True when the authored phenotype carries at least one body-geometry-driving field.

    Presence is the criterion: an author who wrote `phenotype: {flush: 0.1}` has not
    described a body and must be refused, while an author who wrote `age: 8` has.
    Cosmetic/affect fields must not satisfy this on their own. Shared by
    generate_mesh.py and orchestrate_character.py (one predicate, not two).
    """
    if not isinstance(phenotype, dict):
        return False
    return any(field in phenotype for field in PHENOTYPE_BODY_SHAPE_FIELDS)


def parse_params(params_arg: str) -> Dict[str, Any]:
    try:
        return json.loads(params_arg)
    except Exception:
        # allow @file.json
        if params_arg.startswith("@"):
            with open(params_arg[1:], "r") as f:
                return json.load(f)
        raise


def role_material_hints(params: Dict[str, Any], phenotype: Dict[str, Any]) -> Dict[str, Any]:
    role = str(params.get("actor_role") or params.get("actorRole") or "").lower()
    cue = phenotype.get("role_visual_cue") or ("clinical_nurse" if role == "nurse" else "anxious_parent_guardian" if role == "parent" else "pediatric_patient")
    clothing_style = phenotype.get("clothing_style", f"{cue}_local_fixture_clothing")
    clothing_color = phenotype.get("clothing_color", "role_distinction_neutral")
    return {
        "wardrobeRole": phenotype.get("wardrobeRole", cue),
        "garmentLayers": phenotype.get("garmentLayers", [clothing_style]),
        "fabricPalette": phenotype.get("fabricPalette", clothing_color),
        "materialFinish": phenotype.get("materialFinish", "matte_local_fixture_cloth"),
        "accessoryMarkers": phenotype.get("accessoryMarkers", []),
        "fitProfile": phenotype.get("fitProfile", "case_actor_basic_fit"),
        "clothing_style": clothing_style,
        "clothing_color": clothing_color,
        "role_visual_cue": cue,
        "claim_scope": "procedural_role_distinction_marker_not_production_costume",
    }


def build_simple_uv_body(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deterministic stub "forward pass".

    Produces a low-poly but UV-mapped humanoid (head + torso + limbs) whose proportions
    are driven by the input scalars. Real Anny would replace this with the actual
    parametric decoder + UV unwrap from the model.
    """
    age = float(params.get("age", 30))
    profile = params.get("body_profile", "adult_standard")
    phenotype = params.get("phenotype", {})
    role_hints = role_material_hints(params, phenotype)
    seed_material = json.dumps({
        "seed": params.get("seed", 0),
        "profile": profile,
        "phenotype": phenotype,
        "pose": params.get("pose", "standing_neutral"),
    }, sort_keys=True)
    seed_unit = int(hashlib.sha256(seed_material.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
    height_scale = float(phenotype.get("height_cm", 170)) / 170.0
    build = phenotype.get("build", "average")
    bmi = float(phenotype.get("bmi", 23.0))

    # Very rough parametric scaling
    if "pediatric" in profile or age < 12:
        height_scale *= 0.65
        head_scale = 1.15
    else:
        head_scale = 1.0

    if "slender" in build or "asthma" in str(phenotype).lower():
        torso_width = 0.82 + seed_unit * 0.04
    elif "bariatric" in profile:
        torso_width = 1.25
    else:
        torso_width = 0.96 + min(0.12, max(-0.06, (bmi - 23.0) * 0.015)) + seed_unit * 0.03
    shoulder_width = 0.42 * torso_width
    hip_width = 0.28 * torso_width
    limb_width = 0.055 + min(0.03, max(-0.012, (bmi - 21.0) * 0.004))

    # Simple mesh: head, torso, and limbs as smooth UV ellipsoids/capsules.
    # We generate a minimal vertex list + faces + UVs so that Blender has something
    # with valid texture coordinates for later PBR baking.
    verts = []
    uvs = []
    faces = []

    def add_vert(x, y, z, u, v):
        verts.append((x, y, z))
        uvs.append((u, v))
        return len(verts) - 1

    def add_box(cx, cy, cz, sx, sy, sz, uv_u):
        x0, x1 = cx - sx / 2, cx + sx / 2
        y0, y1 = cy - sy / 2, cy + sy / 2
        z0, z1 = cz - sz / 2, cz + sz / 2
        box = [
            add_vert(x0, y0, z0, uv_u, 0.0),
            add_vert(x1, y0, z0, uv_u + 0.1, 0.0),
            add_vert(x1, y1, z0, uv_u + 0.1, 0.2),
            add_vert(x0, y1, z0, uv_u, 0.2),
            add_vert(x0, y0, z1, uv_u, 0.25),
            add_vert(x1, y0, z1, uv_u + 0.1, 0.25),
            add_vert(x1, y1, z1, uv_u + 0.1, 0.45),
            add_vert(x0, y1, z1, uv_u, 0.45),
        ]
        quads = [
            (0, 1, 2, 3),
            (4, 7, 6, 5),
            (0, 4, 5, 1),
            (1, 5, 6, 2),
            (2, 6, 7, 3),
            (3, 7, 4, 0),
        ]
        for a, b, c, d in quads:
            faces.append((box[a], box[b], box[c]))
            faces.append((box[a], box[c], box[d]))

    def add_uv_ellipsoid(cx, cy, cz, rx, ry, rz, u0, v0, u_span=0.16, v_span=0.20, segments=16, rings=8):
        start = len(verts)
        for i in range(segments + 1):
            theta = (i / segments) * math.pi * 2
            for j in range(rings + 1):
                phi = (j / rings) * math.pi - math.pi / 2
                x = cx + rx * math.cos(phi) * math.cos(theta)
                z = cz + rz * math.cos(phi) * math.sin(theta)
                y = cy + ry * math.sin(phi)
                add_vert(x, y, z, u0 + (i / segments) * u_span, v0 + (j / rings) * v_span)
        for i in range(segments):
            for j in range(rings):
                a = start + i * (rings + 1) + j
                b = a + 1
                c = start + (i + 1) * (rings + 1) + j
                d = c + 1
                faces.append((a, b, d))
                faces.append((a, d, c))

    def add_uv_capsule(cx0, cy0, cz0, cx1, cy1, cz1, r0, r1, u0, v0, u_span=0.10, v_span=0.24, segments=14, stacks=5):
        start = len(verts)
        for k in range(stacks + 1):
            t = k / stacks
            cx = cx0 + (cx1 - cx0) * t
            cy = cy0 + (cy1 - cy0) * t
            cz = cz0 + (cz1 - cz0) * t
            radius = r0 + (r1 - r0) * t
            for i in range(segments + 1):
                theta = (i / segments) * math.pi * 2
                x = cx + radius * math.cos(theta)
                z = cz + radius * 0.82 * math.sin(theta)
                add_vert(x, cy, z, u0 + (i / segments) * u_span, v0 + t * v_span)
        for k in range(stacks):
            for i in range(segments):
                a = start + k * (segments + 1) + i
                b = a + 1
                c = start + (k + 1) * (segments + 1) + i
                d = c + 1
                faces.append((a, c, d))
                faces.append((a, d, b))

    # Head (smooth local Anny-compatible stub, not real Anny topology)
    head_y = 1.65 * height_scale
    head_rx = 0.17 * head_scale
    head_ry = 0.23 * head_scale
    head_rz = 0.15 * head_scale
    add_uv_ellipsoid(0.0, head_y, 0.0, head_rx, head_ry, head_rz, 0.00, 0.00, 0.18, 0.24, segments=18, rings=10)

    # Torso
    torso_top = head_y - 0.35 * head_scale
    torso_bot = 0.95 * height_scale
    torso_center_y = (torso_top + torso_bot) / 2
    torso_height = max(0.28, torso_top - torso_bot)
    add_uv_ellipsoid(0.0, torso_center_y, 0.0, shoulder_width * 0.55, torso_height * 0.52, 0.13, 0.20, 0.04, 0.18, 0.32, segments=18, rings=10)
    add_uv_capsule(0.0, torso_top - 0.015, 0.0, 0.0, head_y - head_ry * 0.82, 0.0, 0.045 * torso_width, 0.038 * torso_width, 0.40, 0.02, 0.08, 0.12, segments=12, stacks=4)

    # Smooth limb stubs (still deterministic fallback, but no longer box silhouettes).
    # Arms
    for side in (-1, 1):
        shoulder_x = 0.22 * torso_width * side
        hand_y = torso_top - 0.64 * height_scale
        add_uv_capsule(
            shoulder_x,
            torso_top - 0.06 * height_scale,
            0.0,
            shoulder_x + side * 0.09,
            hand_y,
            0.0,
            limb_width * 0.82,
            limb_width * 0.56,
            0.46 if side < 0 else 0.58,
            0.10,
            0.10,
            0.30,
        )
        add_uv_ellipsoid(shoulder_x + side * 0.10, hand_y - 0.035, 0.0, limb_width * 0.58, limb_width * 0.70, limb_width * 0.45, 0.48 if side < 0 else 0.60, 0.42, 0.06, 0.08, segments=10, rings=5)

    # Legs
    for side in (-1, 1):
        hip_x = 0.12 * side
        ankle_y = max(0.06 * height_scale, torso_bot - 0.88 * height_scale)
        add_uv_capsule(
            hip_x,
            torso_bot - 0.04 * height_scale,
            0.0,
            hip_x + side * 0.03,
            ankle_y,
            0.0,
            limb_width * 0.95,
            limb_width * 0.68,
            0.70 if side < 0 else 0.82,
            0.08,
            0.10,
            0.34,
            segments=14,
            stacks=6,
        )
        add_uv_ellipsoid(hip_x + side * 0.05, ankle_y - 0.035, 0.07, limb_width * 0.95, limb_width * 0.44, 0.12, 0.76 if side < 0 else 0.88, 0.44, 0.10, 0.08, segments=12, rings=5)

    # Extremely simplified faces for torso/limbs (the important part is that UVs exist
    # and are non-degenerate so StableGen/ComfyUI baking and Blender texture paint work).
    # In a real Anny output the topology + UVs would be much higher quality.

    mesh = {
        "vertices": verts,
        "uvs": uvs,
        "faces": faces,
        "material_hints": {
            "skin": phenotype.get("skin_tone", "warm_light"),
            "hair": phenotype.get("hair_color", "brown"),
            "torso_width": torso_width,
            "shoulder_width": shoulder_width,
            "hip_width": hip_width,
            "limb_width": limb_width,
            "seed_unit": seed_unit,
            "sourceTopologyMode": "smooth_uv_parametric_stub_v2_not_real_anny",
            "role": role_hints,
        },
    }
    return mesh


# ---------------------------------------------------------------------------
# issue-302: the height macro is SOLVED against the model, not hand-fitted.
#
# The old mapping `values["height"] = max(0.08, min(0.95, (height_cm - 85.0) / 115.0))`
# is wrong by up to 47 cm, and NO formula in height_cm alone can be right: Anny's
# stature is a function of height AND age AND gender. Bisecting the macro against
# `anny.Anthropometry` (the model's own measurement of the body it just produced)
# gives 166 cm -> 0.7320, 176 cm -> 0.8635, 178 cm -> 0.5093 — a TALLER target
# takes a LOWER macro. The solve asks the tool instead of hand-authoring against
# it (same D1 lesson as bake_modifiers_remove_helpers / create_human(feet_on_ground=True)).
#
# The reachable band is the trained macro space [0, 1]. Production creates the
# model with extrapolate_phenotypes=False (the default), so a macro above 1.0
# silently clamps and cannot reach a taller target — the child (125 cm authored,
# ceiling ~115.7 cm at macro 1.0) is genuinely unreachable and REFUSES loudly
# rather than shipping a short body as if it were the authored height.
# ---------------------------------------------------------------------------

_HEIGHT_SOLVE_STATE: Optional[Tuple[Any, Any]] = None  # (model, Anthropometry), created once


def _height_solve_state() -> Tuple[Any, Any]:
    """Lazily create and cache the (model, Anthropometry) pair used to bisect the
    height macro. Same config the height contract measures against, so a macro the
    solver finds is measured identically by the contract's own model instance."""
    global _HEIGHT_SOLVE_STATE
    if _HEIGHT_SOLVE_STATE is None:
        import anny
        with contextlib.redirect_stdout(io.StringIO()):
            model = anny.create_fullbody_model(triangulate_faces=True, extrapolate_phenotypes=True)
        _HEIGHT_SOLVE_STATE = (model, anny.Anthropometry(model))
    return _HEIGHT_SOLVE_STATE


def _stature_cm_for(values: Dict[str, float], height_macro: float) -> float:
    """Measure the model's stature in cm for `values` with the height macro overridden."""
    model, anthropometry = _height_solve_state()
    kw = {label: float(values[label]) for label in model.phenotype_labels if label in values}
    kw["height"] = height_macro
    import torch
    with torch.no_grad():
        out = model.forward(phenotype_kwargs=kw)
    return float(anthropometry.height(out["rest_vertices"])) * 100.0


def _solve_height_macro(values: Dict[str, float], height_cm: float) -> float:
    """Bisect the Anny height macro so the model measures the authored stature.

    `values` carries every other mapped phenotype label (gender/age/weight/muscle/
    proportions already resolved); only `height` is varied. A target outside the
    reachable [0, 1] macro band refuses loudly (SystemExit), never a silent short body.
    """
    lo, hi = 0.0, 1.0
    ceiling_cm = _stature_cm_for(values, hi)
    if height_cm > ceiling_cm:
        floor_cm = _stature_cm_for(values, lo)
        raise SystemExit(
            "REFUSE (issue-302): authored height_cm "
            f"{height_cm:g} cm is outside the reachable band "
            f"[{floor_cm:.1f}, {ceiling_cm:.1f}] cm on Anny's height macro (0..1) "
            "for this age/gender/build. The solve refuses loudly instead of silently "
            "shipping a short body. Author a reachable height_cm (#293) or accept the "
            "closest achievable stature."
        )
    floor_cm = _stature_cm_for(values, lo)
    if height_cm < floor_cm:
        raise SystemExit(
            "REFUSE (issue-302): authored height_cm "
            f"{height_cm:g} cm is below the reachable band "
            f"[{floor_cm:.1f}, {ceiling_cm:.1f}] cm on Anny's height macro (0..1) "
            "for this age/gender/build. The solve refuses loudly instead of silently "
            "shipping a tall body. Author a reachable height_cm (#293) or accept the "
            "closest achievable stature."
        )
    for _ in range(25):
        mid = (lo + hi) / 2.0
        if _stature_cm_for(values, mid) < height_cm:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def normalized_anny_phenotype(params: Dict[str, Any], labels: Sequence[str], dtype: Any, device: Any) -> Dict[str, Any]:
    phenotype = params.get("phenotype", {})
    role = str(params.get("actor_role") or params.get("actorRole") or "").lower()
    age_years = float(params.get("age", phenotype.get("age", 30)))
    height_cm = float(phenotype.get("height_cm", 170))
    height_cm_authored = "height_cm" in phenotype
    bmi = float(phenotype.get("bmi", 23.0))
    build = str(phenotype.get("build", "")).lower()
    gender_presentation = str(phenotype.get("gender_presentation", role)).lower()

    values = {label: 0.5 for label in labels}
    if "gender" in values:
        # Anny's gender axis runs 0 = MALE, 1 = FEMALE (measured, #299). The authored presentation
        # maps to the near poles (0.85 / 0.15) so female/male bodies span ~70% of Anny's achievable
        # dimorphism instead of the old 28% (0.18 / 0.35 was inverted AND compressed). A role with no
        # stated sex stays neutral (0.5); the old role special-casing (nurse -> 0.08 regardless of
        # stated sex) is dropped because every authored preset carries an explicit
        # gender_presentation marker — reading it alone is the correct source of truth.
        if "female" in gender_presentation:
            values["gender"] = 0.85
        elif "male" in gender_presentation:
            values["gender"] = 0.15
        else:
            values["gender"] = 0.5
    if "age" in values:
        values["age"] = max(0.02, min(0.98, age_years / 90.0))
    if "weight" in values:
        values["weight"] = max(0.08, min(0.95, (bmi - 13.5) / 23.0))
    if "muscle" in values:
        values["muscle"] = 0.32 if ("slender" in build or "asthma" in build) else 0.42 if role == "parent" else 0.5
    if "proportions" in values:
        values["proportions"] = 0.42 if age_years < 12 else 0.5
    if "cupsize" in values:
        values["cupsize"] = 0.08 if age_years < 13 else 0.35
    if "firmness" in values:
        values["firmness"] = 0.55
    if "african" in values:
        values["african"] = float(phenotype.get("african", 0.18))
    if "asian" in values:
        values["asian"] = float(phenotype.get("asian", 0.22))
    if "caucasian" in values:
        values["caucasian"] = float(phenotype.get("caucasian", 0.60))
    if "height" in values:
        if height_cm_authored:
            # Solved against the model's own anthropometry last, because the stature a
            # given height macro produces depends on the other mapped labels (age/gender/
            # weight/muscle/proportions) that were just resolved above (#302).
            values["height"] = _solve_height_macro(values, height_cm)
        else:
            # Unspecified height: no authored target exists to miss, so the legacy
            # formula stays as the neutral default rather than solving toward a
            # fabricated 170 cm (which is unreachable for e.g. a child and would
            # wrongly refuse an otherwise-valid {age: 8} body — #294 contract (3)).
            values["height"] = max(0.08, min(0.95, (height_cm - 85.0) / 115.0))

    import torch
    return {label: torch.tensor([values[label]], dtype=dtype, device=device) for label in labels}


def build_real_anny_body(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Local real Anny forward pass using the installed Apache-2.0 package and bundled MPFB2 data.

    This path does not call the Anny noncommercial download helper, cloud providers, paid APIs,
    credentials, or external network. It is still a quarantined source candidate until downstream
    provenance, rig, isolated model-vetting, and visual realism gates clear.
    """
    import anny
    import torch

    phenotype = params.get("phenotype", {})
    topology = str(phenotype.get("anny_topology") or params.get("anny_topology") or "default-noeyes-notongue")
    allowed_topologies = {"default", "default-noeyes-notongue", "default-noeyes", "default-notongue"}
    if topology not in allowed_topologies:
        raise ValueError(f"Unsupported Anny topology {topology!r}; expected one of {sorted(allowed_topologies)}")

    with contextlib.redirect_stdout(io.StringIO()):
        model = anny.create_fullbody_model(
            rig="default",
            topology=topology,
            remove_unattached_vertices=True,
            all_phenotypes=True,
            local_changes=True,
        )
    model = model.to(dtype=torch.float32, device=torch.device("cpu"))
    pose_parameters = torch.eye(4, dtype=model.dtype, device=model.device).reshape(1, 1, 4, 4).repeat(1, model.bone_count, 1, 1)
    phenotype_kwargs = normalized_anny_phenotype(params, model.phenotype_labels, model.dtype, model.device)
    local_changes_kwargs = {label: torch.zeros((1,), dtype=model.dtype, device=model.device) for label in model.local_change_labels}

    with torch.no_grad():
        output = model(
            pose_parameters=pose_parameters,
            phenotype_kwargs=phenotype_kwargs,
            local_changes_kwargs=local_changes_kwargs,
        )

    vertices = output["vertices"].squeeze(dim=0).cpu()
    faces = model.faces.cpu().tolist()
    min_values = vertices.min(dim=0).values
    max_values = vertices.max(dim=0).values
    source_height = float(max_values[2] - min_values[2])
    target_height = float(params.get("phenotype", {}).get("height_cm", 170)) / 100.0
    scale = target_height / source_height if source_height > 0 else 1.0

    transformed: List[Tuple[float, float, float]] = []
    # Anny is Z-up with Y depth. The existing Blender stage expects local Y-up and
    # positive Z as the face/camera direction for procedural eyes and landmarks.
    for vertex in vertices.tolist():
        x = float(vertex[0]) * scale
        y = (float(vertex[2]) - float(min_values[2])) * scale
        z = -float(vertex[1]) * scale
        transformed.append((x, y, z))

    min_x = min(v[0] for v in transformed)
    max_x = max(v[0] for v in transformed)
    min_y = min(v[1] for v in transformed)
    max_y = max(v[1] for v in transformed)
    width = max(max_x - min_x, 1e-6)
    height = max(max_y - min_y, 1e-6)
    uvs = [((x - min_x) / width, (y - min_y) / height) for x, y, _z in transformed]

    return {
        "vertices": transformed,
        "uvs": uvs,
        "faces": faces,
        "source": {
            "kind": "real_anny_forward_pass",
            "package_path": os.path.abspath(os.path.dirname(anny.__file__)),
            "model": f"anny.create_fullbody_model(default/{topology})",
            "topology": topology,
            "topologyIncludesEyes": "noeyes" not in topology,
            "topologyIncludesTongue": "notongue" not in topology,
            "source_vertex_count": int(vertices.shape[0]),
            "source_face_count": len(faces),
            "source_height": source_height,
            "target_height": target_height,
            "scale": scale,
            "external_network_used": False,
            "model_download_used": False,
            "noncommercial_download_used": False,
        },
        "material_hints": {
            "skin": phenotype.get("skin_tone", "warm_light"),
            "hair": phenotype.get("hair_color", "brown"),
            "sourceTopologyMode": "real_anny_mpfb2_forward_pass_v1",
            "role": role_material_hints(params, phenotype),
        },
    }


def build_source_body(params: Dict[str, Any]) -> Dict[str, Any]:
    if params.get("force_stub_mesh") is True:
        mesh = build_simple_uv_body(params)
        mesh["fallback_reason"] = "force_stub_mesh_param"
        return mesh
    # issue-291/294 refuse gate: a missing OR insufficient phenotype that silently
    # yields a generic adult is how six humanoids became one body (#276). Refuse
    # before any fallback, so even the broken-real-Anny path cannot quietly default.
    phenotype = params.get("phenotype")
    if not phenotype_is_sufficient(phenotype):
        raise SystemExit(
            "REFUSE (issue-294): params carry no phenotype field that drives body geometry "
            "(expected at least one of " + ", ".join(PHENOTYPE_BODY_SHAPE_FIELDS) + "). "
            "Cosmetic/affect fields (flush, hair_color, ...) do not make a body distinguishable "
            "and still yield a generic adult (#276). Author a body-shape field on the scenario "
            "fixture actor record and let orchestrate_character.py resolve it, or pass an "
            "explicit phenotype dict with a body-shape field (force_stub_mesh is the escape hatch)."
        )
    try:
        return build_real_anny_body(params)
    except Exception as exc:
        mesh = build_simple_uv_body(params)
        mesh["fallback_reason"] = f"{exc.__class__.__name__}: {exc}"
        return mesh


def write_obj(mesh: Dict[str, Any], path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    source_kind = mesh.get("source", {}).get("kind") if isinstance(mesh.get("source"), dict) else "stub"
    mtl_path = os.path.join(os.path.dirname(path) or ".", "anny_stub.mtl")
    with open(mtl_path, "w") as mtl:
        mtl.write("newmtl skin\n")
        mtl.write("Kd 0.82 0.66 0.56\n")
        mtl.write("Ks 0.12 0.10 0.08\n")
        mtl.write("Ns 24\n")
        mtl.write("d 1.0\n")
    with open(path, "w") as f:
        f.write(f"# OpenClinXR Anny source mesh ({source_kind})\n")
        f.write("mtllib anny_stub.mtl\n")
        for (x, y, z), (u, v) in zip(mesh["vertices"], mesh["uvs"]):
            f.write(f"v {x:.6f} {y:.6f} {z:.6f}\n")
            f.write(f"vt {u:.6f} {v:.6f}\n")
        f.write("usemtl skin\n")
        for face in mesh["faces"]:
            # OBJ is 1-based and Blender accepts triangles or quads.
            refs = " ".join(f"{int(index)+1}/{int(index)+1}" for index in face)
            f.write(f"f {refs}\n")


def write_manifest(params: Dict[str, Any], mesh: Dict[str, Any], out_path: str, obj_path: str) -> None:
    source = mesh.get("source") if isinstance(mesh.get("source"), dict) else {}
    uses_real_anny = source.get("kind") == "real_anny_forward_pass"
    fallback_reason: Optional[str] = mesh.get("fallback_reason") if isinstance(mesh.get("fallback_reason"), str) else None
    manifest = {
        "schema_version": "openclinxr.anny-source-manifest.v1",
        "generator": "tools/openclinxr/asset-pipeline/anny/generate_mesh.py",
        "source_kind": "real_anny_candidate_unverified" if uses_real_anny else "anny_compatible_stub_mesh",
        "generator_mode": "real_anny_local_forward_pass" if uses_real_anny else "stub",
        "uses_real_anny_forward_pass": uses_real_anny,
        "real_anny_weights_used": False,
        "fallback_active": not uses_real_anny,
        **({"fallback_reason": fallback_reason} if fallback_reason else {}),
        "input_params": params,
        "output": {
            "obj_path": os.path.abspath(obj_path),
            "vertex_count": len(mesh["vertices"]),
            "face_count": len(mesh["faces"]),
            "has_uvs": True,
            "source_topology_mode": mesh.get("material_hints", {}).get("sourceTopologyMode", "unknown"),
            "uv_coverage_note": "planar normalized review UVs over real Anny source mesh" if uses_real_anny else "smooth local UV ellipsoid/capsule unwrap for head/torso/limbs; production Anny produces production unwraps",
        },
        "anny_forward_pass": source if uses_real_anny else None,
        "phenotype_summary": params.get("phenotype", {}),
        "material_hints": mesh.get("material_hints", {}),
        "not_evidence_for": [
            *([] if uses_real_anny else ["real_anny_model_output"]),
            "b_plus_visual_realism_gate",
            "production_asset_readiness",
            "quest_readiness",
        ],
        "notes": [
            "This source OBJ came from a local Anny forward pass using bundled package data; no external provider, credential, paid API, model download, or noncommercial download helper was used." if uses_real_anny else "This is a deterministic stub so the rest of the pipeline (Blender rigging + texturing) can be exercised without the real Anny package path.",
            "This remains a quarantined source candidate and is not a B+ realism, production, Quest, learner, clinical, or scoring readiness claim.",
            "The produced OBJ + this manifest are the handoff into the headless Blender stage (automate_blender.py).",
        ],
    }
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(manifest, f, indent=2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", required=True, help="JSON string or @path/to/params.json with age, body_profile, pose, phenotype, etc.")
    ap.add_argument("--output", required=True, help="Path to write the .obj (Anny base mesh with UVs)")
    ap.add_argument("--manifest", required=True, help="Path to write the Anny source manifest (provenance + params)")
    ap.add_argument("--gltf", required=False, help="Deprecated compatibility option; ignored because automate_blender.py produces the final GLB")
    args = ap.parse_args()

    params = parse_params(args.params)
    mesh = build_source_body(params)

    write_obj(mesh, args.output)
    write_manifest(params, mesh, args.manifest, args.output)

    print(f"[anny] wrote base mesh with UVs: {args.output}")
    print(f"[anny] wrote manifest: {args.manifest}")
    if args.gltf:
        print(f"[anny] --gltf ignored: final GLB is produced by automate_blender.py ({args.gltf})")
    print("[anny] ready for headless Blender rigging + StableGen/ComfyUI texturing stage.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Single-call orchestrator for the full Anny -> textured/rigged GLB pipeline.

This is the "pass patient parameters → get textured, rigged GLB back. No GUI ever opens."
entrypoint described in the user query.

It calls:
1. generate_mesh.py (Anny stage, <5s)
2. automate_blender.py via `blender --background --python` (headless Blender + StableGen/ComfyUI stage)

Example (peds case):
  python orchestrate_character.py \
    --case-id peds_asthma_parent_anxiety_v1 \
    --actor-role patient \
    --params-json '{"age": 8, "body_profile": "pediatric_school_age", "phenotype": {"skin_tone": "warm_light_child", "build": "slender_asthma"}}' \
    --output-glb .openclinxr/asset-production/peds-asthma/patient_robert_hayes.glb

You can also run it as a tiny FastAPI service (if fastapi/uvicorn installed):
  uvicorn orchestrate_character:app --port 8765
  curl -X POST http://localhost:8765/generate -d '{...}'

The orchestrator is deliberately thin so it can be called from the TS asset worker
(via child_process.execFile or a local HTTP capability adapter) for the
"character-generation" / "role_specific_humanoid_glb" materialization work orders.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

HERE = Path(__file__).parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from generate_mesh import (  # noqa: E402
    PHENOTYPE_BODY_SHAPE_FIELDS,
    phenotype_is_sufficient,
)
from humanoid_provenance import (  # noqa: E402
    DERIVATION_MODE_ORCHESTRATE,
    build_provenance_document,
    write_provenance_document,
)

GEN_MESH = HERE / "generate_mesh.py"
BLENDER_STAGE = HERE / "automate_blender.py"
MPFB2_EYE_RIG = HERE / "add_mpfb2_eye_rig.py"
OPTIMIZE_GLB = HERE / "optimize_glb_meshopt.mjs"

PEDS_ASTHMA_PARENT_ANXIETY_PRESETS: Dict[str, Dict[str, Any]] = {
    "patient_maya_johnson_v1": {
        "case_id": "peds_asthma_parent_anxiety_v1",
        "actor_id": "patient_maya_johnson_v1",
        "actor_role": "patient",
        "output_name": "peds_patient_child.glb",
        "params": {
            "age": 8,
            "body_profile": "pediatric_school_age",
            "pose": "standing_neutral_work_of_breathing",
            "seed": 1001,
            "phenotype": {
                "skin_tone": "warm_light_child",
                "hair_color": "light_brown",
                "eye_color": "hazel",
                "anny_topology": "default",
                "gender_presentation": "child",
                "height_cm": 125,
                "build": "slender_asthma",
                "hair_density": 0.55,
                "brow_tension": 0.18,
                "anxious": 0.42,
                "flush": 0.05,
                "age_wrinkle": 0.04,
                "bmi": 16.5,
                "clothing_style": "pediatric_soft_blue_exam_tshirt",
                "clothing_color": "soft_blue",
                "role_visual_cue": "pediatric_patient",
                "wardrobeRole": "patient_casual_child",
                "garmentLayers": ["short_sleeve_exam_tshirt"],
                "fabricPalette": "soft_blue_and_warm_white",
                "materialFinish": "cotton_matte",
                "accessoryMarkers": [],
                "fitProfile": "pediatric_slim_fit",
                "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",  # re-orchestrated patient preset for expanded real garment in apply_role_clothing_material_regions (Q1 peds blueprint)
            },
        },
    },
    "parent_tara_johnson_v1": {
        "case_id": "peds_asthma_parent_anxiety_v1",
        "actor_id": "parent_tara_johnson_v1",
        "actor_role": "parent",
        "output_name": "peds_anxious_parent.glb",
        "params": {
            "age": 34,
            "body_profile": "adult_standard_parent",
            "pose": "standing_anxious_guardian",
            "seed": 1002,
            "phenotype": {
                "skin_tone": "warm_light",
                "hair_color": "dark_brown",
                "eye_color": "brown",
                "gender_presentation": "adult_female_parent",
                "height_cm": 166,
                "build": "average_parent",
                "hair_density": 0.72,
                "brow_tension": 0.36,
                "anxious": 0.82,
                "flush": 0.28,
                "age_wrinkle": 0.22,
                "bmi": 24.0,
                "clothing_style": "muted_rose_guardian_cardigan",
                "clothing_color": "muted_rose",
                "role_visual_cue": "anxious_parent_guardian",
                "wardrobeRole": "anxious_parent_casual",
                "garmentLayers": ["casual_top", "open_cardigan"],
                "fabricPalette": "muted_rose_and_neutral",
                "materialFinish": "cotton_knit_matte",
                "accessoryMarkers": [],
                "fitProfile": "adult_parent_average_fit",
                "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",  # re-orchestrated parent preset for expanded real garment in apply_role_clothing_material_regions (Q1 peds-parent-nurse-garment-asset slice)
            },
        },
    },
    "nurse_kevin_lee_v1": {
        "case_id": "peds_asthma_parent_anxiety_v1",
        "actor_id": "nurse_kevin_lee_v1",
        "actor_role": "nurse",
        "output_name": "peds_nurse_kevin.glb",
        "params": {
            "age": 29,
            "body_profile": "adult_clinical_team",
            "pose": "standing_clinical_ready",
            "seed": 1003,
            "phenotype": {
                "skin_tone": "medium_warm",
                "hair_color": "black",
                "eye_color": "brown",
                "gender_presentation": "adult_male_nurse",
                "height_cm": 176,
                "build": "average_clinical_team",
                "hair_density": 0.58,
                "brow_tension": 0.12,
                "anxious": 0.18,
                "flush": 0.02,
                "age_wrinkle": 0.10,
                "bmi": 23.0,
                "clothing_style": "teal_clinical_scrubs_with_name_badge",
                "clothing_color": "teal_scrubs",
                "role_visual_cue": "clinical_nurse",
                "wardrobeRole": "pediatric_nurse_scrubs",
                "garmentLayers": ["scrub_top", "scrub_pocket"],
                "fabricPalette": "teal_scrubs_and_white_badge",
                "materialFinish": "poly_cotton_slight_sheen",
                "accessoryMarkers": ["name_badge", "scrub_pocket"],
                "fitProfile": "adult_clinical_team_fit",
                "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",  # re-orchestrated nurse preset for expanded real garment in apply_role_clothing_material_regions (Q1 peds-parent-nurse-garment-asset slice)
            },
        },
    },
}

ED_CHEST_PAIN_PRESETS: Dict[str, Dict[str, Any]] = {
    "patient_ed_chest_pain_v1": {
        "case_id": "ed_chest_pain_priority_v2",
        "actor_id": "patient_ed_chest_pain_v1",
        "actor_role": "patient",
        "output_name": "ed_chest_pain_patient_adult.glb",
        "params": {
            "age": 52,
            "body_profile": "adult_standard",
            "pose": "standing_neutral_chest_pain_priority",
            "seed": 2001,
            "phenotype": {
                "skin_tone": "warm_medium",
                "hair_color": "brown",
                "eye_color": "brown",
                "anny_topology": "default",
                "gender_presentation": "adult_male",
                "height_cm": 178,
                "build": "average_adult",
                "hair_density": 0.65,
                "brow_tension": 0.55,
                "anxious": 0.65,
                "flush": 0.15,
                "age_wrinkle": 0.18,
                "bmi": 26.0,
                "clothing_style": "clinical_exam_tshirt_chest_pain",
                "clothing_color": "soft_blue",
                "role_visual_cue": "ed_chest_pain_patient",
                "wardrobeRole": "ed_patient_exam",
                "garmentLayers": ["hospital_gown"],
                "fabricPalette": "hospital_gown_blue_pattern",
                "materialFinish": "cotton_slight_sheen",
                "accessoryMarkers": [],
                "fitProfile": "adult_standard_fit",
                "sleeveGeometryExpansion": "v2_gown_sleeves_0.35_len_r0.38_9r14c_rippled_folds_vivid_gown_blue",  # ed-gown-geo-reorchestrate (Q1): set hospital_gown from phenotype.garmentLayers for actual ED adult gown topology + expanded sleeve geo (longer/looser for gown vs tshirt); deformsWithBreathing + realGarmentRegion; cagematch + UI-XR dual visible per MANDATE_VISIBILITY + skeptic handoff; cp to current/ + 2026-06-07/ evidence dir; update reports
            },
        },
    },
}

# issue-650: these four rows are the PINNED KNOWN-GOOD baseline the #650 contract
# pins (the heights 125/166/176/178 must keep appearing here). They are NOT the
# source of the people: per-actor phenotype comes from the case-definition export
# (see resolve_case_actor_params below), and covering a new case means authoring a
# fixture phenotype, not editing this table. The rows remain functional only as
# the fallback for pre-migration actors whose fixture does not author them (e.g.
# ed_chest_pain_priority_v2:patient_ed_chest_pain_v1).
CASE_ACTOR_PRESETS = {
    **{f"peds_asthma_parent_anxiety_v1:{actor_id}": preset for actor_id, preset in PEDS_ASTHMA_PARENT_ANXIETY_PRESETS.items()},
    **{f"ed_chest_pain_priority_v2:{actor_id}": preset for actor_id, preset in ED_CHEST_PAIN_PRESETS.items()},
}

# issue-653: which source described the human the resolver chose. The provenance
# writer records this so a case-driven body and a preset-driven body are
# distinguishable after the bake (#650 gave the pipeline both; the artifact
# recorded neither).
PHENOTYPE_SOURCE_CASE_DEFINITION = "case_definition"
PHENOTYPE_SOURCE_CASE_ACTOR_PRESET = "case_actor_preset"

# ---------------------------------------------------------------------------
# issue-291/issue-650: case-definition phenotype reader
#
# The encounter specification (scenario fixture actor record) is the home for
# authored clinical/cosmetic phenotype. Resolution order for --case-actor-preset
# and the #601 seam (resolve_case_actor_params):
#   1. fixture export entry (case-definition phenotype) if present — the case is
#      the source; a new case authors its actors' phenotypes and needs NO Python
#      edit to become bakeable (#650),
#   2. CASE_ACTOR_PRESETS entry if present (issue-650: pinned known-good rows for
#      pre-migration actors only — the four heights clause (2) of the #650
#      contract pins in place; a regression record, not the source),
#   3. REFUSE (SystemExit) — never silently default to a generic adult (#276).
# ---------------------------------------------------------------------------
REPO_ROOT = HERE.parent.parent.parent.parent  # tools/openclinxr/asset-pipeline/anny -> repo root

DEFAULT_ACTOR_PHENOTYPE_JSON = str(
    REPO_ROOT / "packages" / "openclinxr" / "scenario-fixtures" / "generated" / "actor-phenotype.v1.json"
)

# Keys the fixture authors at the top of the phenotype object that the generator
# treats as top-level params (not part of the inner `phenotype` dict).
GENERATOR_TOP_LEVEL_PHENOTYPE_KEYS = ("age", "body_profile", "pose")

# Pipeline-only phenotype fields the case definition deliberately does NOT
# author. Per-actor values preserve the legacy preset dicts exactly (including
# which actors carry anny_topology) so a migrated case stays byte-identical.
PIPELINE_PHENOTYPE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "patient_maya_johnson_v1": {
        "anny_topology": "default",
        "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",
    },
    "parent_tara_johnson_v1": {
        "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",
    },
    "nurse_kevin_lee_v1": {
        "sleeveGeometryExpansion": "v2_obvious_sleeves_0.27_len_r0.35_7r12c_rippled_folds_vivid_blue",
    },
    "patient_ed_chest_pain_v1": {
        "anny_topology": "default",
        "sleeveGeometryExpansion": "v2_gown_sleeves_0.35_len_r0.38_9r14c_rippled_folds_vivid_gown_blue",
    },
    # issue-650: the ED case now authors its patient's phenotype in the fixture;
    # these pipeline-only knobs preserve the proven garment-geometry path the
    # legacy preset carried (the case definition deliberately does not author them).
    "patient_robert_hayes_v1": {
        "anny_topology": "default",
        "sleeveGeometryExpansion": "v2_gown_sleeves_0.35_len_r0.38_9r14c_rippled_folds_vivid_gown_blue",
    },
}
# Scalar phenotype fields the generator treats as floats (float() at use in
# generate_mesh.py). JSON round-trips authored whole floats (24.0) as ints (24),
# so the reader restores the float representation for byte-identical params.
FLOAT_SEED_PHENOTYPE_KEYS = ("bmi",)
PIPELINE_ACTOR_SEED_DEFAULTS: Dict[str, int] = {
    "patient_maya_johnson_v1": 1001,
    "parent_tara_johnson_v1": 1002,
    "nurse_kevin_lee_v1": 1003,
    "patient_ed_chest_pain_v1": 2001,
}
PIPELINE_OUTPUT_NAME_DEFAULTS: Dict[str, str] = {
    "patient_maya_johnson_v1": "peds_patient_child.glb",
    "parent_tara_johnson_v1": "peds_anxious_parent.glb",
    "nurse_kevin_lee_v1": "peds_nurse_kevin.glb",
    "patient_ed_chest_pain_v1": "ed_chest_pain_patient_adult.glb",
}


def load_actor_phenotype_export(path: Optional[str] = None) -> Dict[str, Any]:
    """Load the committed case-definition phenotype export (scenario fixtures).
    Empty dict when the export is absent, so the legacy preset path is unaffected."""
    export_path = path or os.environ.get("OPENCLINXR_ACTOR_PHENOTYPE_JSON") or DEFAULT_ACTOR_PHENOTYPE_JSON
    if not os.path.exists(export_path):
        return {}
    try:
        with open(export_path, "r") as f:
            value = json.load(f)
    except (OSError, ValueError):
        return {}
    entries = value.get("entries") if isinstance(value, dict) else None
    return entries if isinstance(entries, dict) else {}


def pipeline_seed_for(actor_id: str) -> int:
    if actor_id in PIPELINE_ACTOR_SEED_DEFAULTS:
        return PIPELINE_ACTOR_SEED_DEFAULTS[actor_id]
    return int(hashlib.sha256(actor_id.encode("utf-8")).hexdigest()[:8], 16) % 100000


def pipeline_output_name_for(actor_id: str, case_id: str) -> str:
    if actor_id in PIPELINE_OUTPUT_NAME_DEFAULTS:
        return PIPELINE_OUTPUT_NAME_DEFAULTS[actor_id]
    return f"{case_id}:{actor_id}.glb"


def params_from_case_definition(case_id: str, actor_id: str) -> Optional[Tuple[Dict[str, Any], str, str]]:
    """Resolve generator params from the case-definition phenotype export.

    Returns (params, actor_role, output_name) when the case definition authors a
    phenotype for this actor; None when it does not (caller falls back to the
    legacy preset or refuses). The produced params are byte-identical to the
    legacy preset params for the migrated case, because every authored field is
    carried verbatim and pipeline-only fields are re-applied from the maps above.
    """
    entries = load_actor_phenotype_export()
    case_entries = entries.get(case_id)
    if not isinstance(case_entries, dict):
        return None
    entry = case_entries.get(actor_id)
    if not isinstance(entry, dict):
        return None
    authored = entry.get("phenotype")
    if not isinstance(authored, dict) or len(authored) == 0:
        return None
    inner = {k: v for k, v in authored.items() if k not in GENERATOR_TOP_LEVEL_PHENOTYPE_KEYS}
    for key in FLOAT_SEED_PHENOTYPE_KEYS:
        if isinstance(inner.get(key), int):
            inner[key] = float(inner[key])
    inner.update(PIPELINE_PHENOTYPE_DEFAULTS.get(actor_id, {}))
    params: Dict[str, Any] = {
        "age": authored.get("age"),
        "body_profile": authored.get("body_profile"),
        "pose": authored.get("pose"),
        "seed": pipeline_seed_for(actor_id),
        "phenotype": inner,
    }
    actor_role = str(entry.get("role") or "patient")
    return params, actor_role, pipeline_output_name_for(actor_id, case_id)


def allowed_case_actor_preset_ids() -> list[str]:
    """Allow-list for --case-actor-preset: legacy presets UNION export entries with phenotype.

    Keeps the #276 refuse gate for actors the export does not cover — never "anything typed".
    """
    allowed = set(CASE_ACTOR_PRESETS.keys())
    for case_id, actors in load_actor_phenotype_export().items():
        if not isinstance(actors, dict):
            continue
        for actor_id, entry in actors.items():
            if not isinstance(entry, dict):
                continue
            ph = entry.get("phenotype")
            if isinstance(ph, dict) and len(ph) > 0:
                allowed.add(f"{case_id}:{actor_id}")
    return sorted(allowed)


def resolve_case_actor_params_with_source(case_id: str, actor_id: str) -> Tuple[Dict[str, Any], str]:
    """Resolve generator params AND the phenotype source that described the human (issue-653).

    Prefer the case-definition phenotype export when the case authors this actor
    (issue-650: the case is the source of its actors' bodies); fall back to the
    legacy CASE_ACTOR_PRESETS rows, which remain as the pinned known-good for
    pre-migration actors the export does not cover. Authored top-level fields
    (age, body_profile, pose) are mirrored into phenotype so seam consumers see
    the same authored numbers the export stores under phenotype.

    Returns ``(params, source)`` where ``source`` is
    :data:`PHENOTYPE_SOURCE_CASE_DEFINITION` or
    :data:`PHENOTYPE_SOURCE_CASE_ACTOR_PRESET` — the same call that returns the
    params names which source chose them, so the provenance writer can record it.
    """
    preset_key = f"{case_id}:{actor_id}"
    fixture = params_from_case_definition(case_id, actor_id)
    if fixture is not None:
        params = dict(fixture[0])
        source = PHENOTYPE_SOURCE_CASE_DEFINITION
    else:
        preset = CASE_ACTOR_PRESETS.get(preset_key)
        if preset is None:
            raise KeyError(
                f"no case-actor params for '{preset_key}': neither a CASE_ACTOR_PRESETS "
                f"row nor a phenotype export entry exists (#276)"
            )
        params = dict(preset["params"])
        source = PHENOTYPE_SOURCE_CASE_ACTOR_PRESET
    phenotype = dict(params.get("phenotype") or {})
    for key in GENERATOR_TOP_LEVEL_PHENOTYPE_KEYS:
        if params.get(key) is not None and key not in phenotype:
            phenotype[key] = params[key]
    params["phenotype"] = phenotype
    return params, source


def resolve_case_actor_params(case_id: str, actor_id: str) -> Dict[str, Any]:
    """Public seam: resolve generator params for one case actor (issue #601).

    Params only; see :func:`resolve_case_actor_params_with_source` for the
    (params, phenotype source) pair that names which source chose the human.
    """
    return resolve_case_actor_params_with_source(case_id, actor_id)[0]


def run_cmd(cmd: list[str], cwd: Optional[str] = None, timeout: Optional[int] = None) -> None:
    print(f"[orchestrate] $ {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=cwd, timeout=timeout)


def provenance_path_for(output_glb: str) -> str:
    return output_glb.replace(".glb", ".provenance.json") if output_glb.endswith(".glb") else output_glb + ".provenance.json"


def bundle_sidecar_path_for(output_glb: str) -> str:
    return output_glb.replace(".glb", ".bundle.json") if output_glb.endswith(".glb") else output_glb + ".bundle.json"


def read_source_manifest(manifest_path: str) -> Dict[str, Any]:
    with open(manifest_path, "r") as f:
        value = json.load(f)
    return value if isinstance(value, dict) else {}


def source_generation_summary(manifest_path: str) -> Dict[str, Any]:
    manifest = read_source_manifest(manifest_path)
    uses_real_anny = manifest.get("uses_real_anny_forward_pass") is True
    real_anny_weights_used = manifest.get("real_anny_weights_used") is True
    return {
        "manifest": manifest,
        "usesRealAnnyForwardPass": uses_real_anny,
        "realAnnyWeightsUsed": real_anny_weights_used,
        "generatorMode": "real_anny_local_forward_pass_plus_blender_procedural" if uses_real_anny else "anny_compatible_stub_plus_blender_procedural",
        "sourceKind": "real_anny_candidate_unverified" if uses_real_anny else "case_driven_generated_humanoid_candidate",
        "toolVersion": "openclinxr-real-anny-local-forward-pass-blender-v1-case-actor-presets" if uses_real_anny else "openclinxr-anny-compatible-stub-blender-v3-case-actor-presets",
        "notEvidenceFor": [
            *([] if uses_real_anny else ["real_anny_model_output"]),
            "b_plus_visual_realism_gate",
            "quest_readiness",
            "production_asset_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
            "scene_placement_readiness",
            "provider_runtime_readiness",
            "production_asset_readiness",
            "quest_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
        "sourceNotes": [
            "Generated through the installed local Anny package forward pass plus Blender procedural rigging/material fallback; preserved as a quarantined source candidate until isolated model-vetting evidence clears.",
            "This is evidence of local Anny source generation only, not B+ realism, production, Quest, learner, clinical, or scoring readiness.",
        ] if uses_real_anny else [
            "Generated through a case-actor preset in the local Anny-compatible stub mesh stage plus Blender procedural rigging and material fallback.",
            "Preserved as a WebXR runtime wiring candidate and provenance test fixture until a real Anny manifest or stronger local humanoid source replaces it.",
        ],
    }


def read_optional_json(path: Optional[str]) -> Optional[Dict[str, Any]]:
    if not path or not os.path.exists(path):
        return None
    with open(path, "r") as f:
        value = json.load(f)
    return value if isinstance(value, dict) else None


def write_provenance(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, report_path: str, manifest_path: str, optimization_report_path: Optional[str] = None, phenotype_source: Optional[str] = None) -> str:
    """Write orchestrate-mode provenance via shared mode-tagged builder (issue #142)."""
    provenance_path = provenance_path_for(output_glb)
    actor_id = str(params.get("actor_id") or params.get("actorId") or f"{actor_role}_candidate")
    source_summary = source_generation_summary(manifest_path)
    optimization_handoff = read_optional_json(optimization_report_path)
    source_origin = {
        "sourceRecordPath": "sources/anny-github-2026.json",
        "meshStage": str(GEN_MESH),
        "blenderStage": str(BLENDER_STAGE),
        "orchestrator": str(HERE / "orchestrate_character.py"),
        "optimizationStage": str(OPTIMIZE_GLB) if optimization_handoff else None,
        "sourceManifestKind": source_summary["manifest"].get("source_kind"),
        "sourceTopologyMode": (
            source_summary["manifest"].get("output", {}).get("source_topology_mode")
            if isinstance(source_summary["manifest"].get("output"), dict)
            else None
        ),
    }
    payload = build_provenance_document(
        derivation_mode=DERIVATION_MODE_ORCHESTRATE,
        scenario_id=case_id,
        actor_id=actor_id,
        actor_role=actor_role,
        asset_path=output_glb,
        generator_mode=source_summary["generatorMode"],
        source_kind=source_summary["sourceKind"],
        uses_real_anny_forward_pass=bool(source_summary["usesRealAnnyForwardPass"]),
        real_anny_weights_used=bool(source_summary["realAnnyWeightsUsed"]),
        not_evidence_for=source_summary["notEvidenceFor"],
        source_notes=source_summary["sourceNotes"],
        params_for_hash=params,
        rigging_report_path=report_path,
        source_manifest_path=manifest_path,
        optimization_mode="meshopt_post_blender_glb" if optimization_handoff else "unoptimized_post_blender_glb",
        tool_version=source_summary["toolVersion"],
        source_origin_chain_extra=source_origin,
        optimization_handoff=optimization_handoff,
        phenotype_source=phenotype_source,
    )
    return write_provenance_document(provenance_path, payload)


def write_bundle_sidecar(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, report_path: str, provenance_path: str, manifest_path: str, obj_path: str, use_comfy: bool, optimization_report_path: Optional[str] = None) -> str:
    bundle_path = bundle_sidecar_path_for(output_glb)
    actor_id = str(params.get("actor_id") or params.get("actorId") or f"{actor_role}_candidate")
    params_hash = hashlib.sha256(json.dumps(params, sort_keys=True).encode("utf-8")).hexdigest()
    source_summary = source_generation_summary(manifest_path)
    optimization_handoff = read_optional_json(optimization_report_path)
    payload = {
        "schemaVersion": "openclinxr.anny-local-candidate-bundle.v1",
        "claimScope": "local_real_anny_candidate_bundle_not_readiness" if source_summary["usesRealAnnyForwardPass"] else "local_anny_compatible_candidate_bundle_not_real_anny_or_readiness",
        "scenarioId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "outputs": {
            "objPath": obj_path,
            "sourceManifestPath": manifest_path,
            "glbPath": output_glb,
            "riggingReportPath": report_path,
            "provenancePath": provenance_path,
            "optimizationReportPath": optimization_report_path,
        },
        "generation": {
            "meshStage": str(GEN_MESH),
            "blenderStage": str(BLENDER_STAGE),
            "generatorMode": source_summary["generatorMode"],
            "usesRealAnnyForwardPass": source_summary["usesRealAnnyForwardPass"],
            "realAnnyWeightsUsed": source_summary["realAnnyWeightsUsed"],
            "useComfy": use_comfy,
            "seed": params.get("seed"),
            "paramsHash": params_hash,
            "optimizationApplied": bool(optimization_handoff),
            "optimizationStage": "post_blender_glb" if optimization_handoff else "none",
            "meshoptEnabled": bool(optimization_handoff and optimization_handoff.get("meshoptEnabled") is True),
        },
        "providerExecution": {
            "cloudProviderUsed": False,
            "paidApiUsed": False,
            "modelDownloadUsed": False,
            "comfyUsed": use_comfy,
        },
        "gates": {
            "realAnnyModelOutput": source_summary["usesRealAnnyForwardPass"],
            "bPlusVisualRealismGate": False,
            "scenePlacementReadiness": False,
            "questReadiness": False,
            "productionReadiness": False,
            "learnerReadiness": False,
            "clinicalValidity": False,
            "scoringValidity": False,
        },
        "notEvidenceFor": [
            *([] if source_summary["usesRealAnnyForwardPass"] else ["real_anny_model_output"]),
            "b_plus_visual_realism_gate",
            "scene_placement_readiness",
            "quest_readiness",
            "production_asset_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
        ],
    }
    if optimization_handoff:
        payload["optimizationHandoff"] = optimization_handoff
    os.makedirs(os.path.dirname(bundle_path) or ".", exist_ok=True)
    with open(bundle_path, "w") as f:
        json.dump(payload, f, indent=2)
    return bundle_path


def apply_mpfb2_eye_rig(output_glb: str) -> str:
    """Optional post-Blender stage: MPFB2-informed seated procedural eyes + gaze-probe export (peds-asthma-blueprint-eye-joint-integration-v1: eye bones in canonical armature from automate_blender, eyes parented to eye.L/eye.R, probe drives bone rots + target compat; truthful notEvidenceFor on all gates)."""
    report_path = output_glb.replace(".glb", "_mpfb2_eye_rig_report.json") if output_glb.endswith(".glb") else output_glb + "_mpfb2_eye_rig_report.json"
    staged_glb = output_glb.replace(".glb", "_mpfb2_eye_staged.glb") if output_glb.endswith(".glb") else output_glb + "_mpfb2_eye_staged.glb"
    blender_bin = os.environ.get("BLENDER_PATH", "blender")
    run_cmd([
        blender_bin, "--background", "--python", str(MPFB2_EYE_RIG), "--",
        "--input-glb", str(output_glb),
        "--output-glb", str(staged_glb),
        "--report", str(report_path),
    ], timeout=180)
    os.replace(staged_glb, output_glb)
    return report_path


def generate(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, use_comfy: bool = False, comfy_url: str = "http://127.0.0.1:8188", optimize_meshopt: bool = False, mpfb2_eye_rig: bool = False, garment_source_geometry_hint: bool = False, phenotype_source: Optional[str] = None) -> Dict[str, str]:  # garment_source_geometry_hint legacy (aborted); phenotype.garmentLayers drives real embed garment in apply_role_clothing_material_regions (automate:1050) for Q1 blueprint case->skinned-sleeve-geo; patient preset re-orchestrated v2 for expanded obvious sleeves (0.27/0.35r/7x12 + folds/ripple/vivid)
    if use_comfy:
        raise SystemExit("--use-comfy is approval-gated; keep StableGen/ComfyUI off until explicitly approved.")
    # issue-291/294 refuse gate: a case-driven generation with a missing OR
    # insufficient phenotype must refuse, not silently yield a generic adult (#276).
    # generate_mesh.py enforces the same predicate (phenotype_is_sufficient); this
    # fails earlier with the case context.
    authored_phenotype = params.get("phenotype")
    if not phenotype_is_sufficient(authored_phenotype):
        raise SystemExit(
            f"REFUSE (issue-294): no body-geometry-driving phenotype in params for case "
            f"'{case_id}' actor role '{actor_role}'. At least one of "
            f"{', '.join(PHENOTYPE_BODY_SHAPE_FIELDS)} is required; cosmetic/affect fields "
            f"(flush, hair_color, ...) do not make a body distinguishable and still yield a "
            f"generic adult (#276). Author a body-shape field on the scenario fixture actor "
            f"record and regenerate the actor-phenotype export."
        )
    output_path = Path(output_glb)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    obj = output_path.with_suffix(".anny_base.obj")
    manifest = output_path.with_suffix(".anny_manifest.json")

    # 1. Anny mesh stage
    run_cmd([
        sys.executable, str(GEN_MESH),
        "--params", json.dumps(params),
        "--output", str(obj),
        "--manifest", str(manifest),
    ])

    # 2. Headless Blender stage (emits rigging_report.json next to the candidate GLB)
    report_path = output_glb.replace(".glb", "_rigging_report.json") if output_glb.endswith(".glb") else output_glb + "_rigging_report.json"
    blender_cmd = [
        "blender", "--background", "--python", str(BLENDER_STAGE), "--",
        "--input-mesh", str(obj),
        "--input-manifest", str(manifest),
        "--output-glb", str(output_glb),
        "--case-id", case_id,
        "--actor-role", actor_role,
    ]
    if garment_source_geometry_hint:
        blender_cmd.extend(["--garment-source-geometry-hint"])  # legacy only; per pivot, real garment (sleeved+weighted from phenotype.garmentLayers e.g. short_sleeve_exam_tshirt) is now default behavior inside apply_role_clothing_material_regions (Q1/Q5); re-orchestrated patient_maya_johnson_v1 preset now emits expanded sleeve geo on re-run

    # Blender may not be on PATH in all envs; the caller can pass BLENDER_PATH
    blender_bin = os.environ.get("BLENDER_PATH", "blender")
    blender_cmd[0] = blender_bin

    run_cmd(blender_cmd, timeout=300)

    mpfb2_eye_rig_report_path: Optional[str] = None
    if mpfb2_eye_rig:
        mpfb2_eye_rig_report_path = apply_mpfb2_eye_rig(output_glb)

    optimization_report_path: Optional[str] = None
    if optimize_meshopt:
        optimization_report_path = output_glb.replace(".glb", "_optimization_report.json") if output_glb.endswith(".glb") else output_glb + "_optimization_report.json"
        run_cmd([
            "node", str(OPTIMIZE_GLB),
            "--input", str(output_glb),
            "--output", str(output_glb),
            "--report", str(optimization_report_path),
            "--rigging-report", str(report_path),
        ], timeout=120)

    provenance_path = write_provenance(params, case_id, actor_role, output_glb, report_path, str(manifest), optimization_report_path, phenotype_source)
    bundle_path = write_bundle_sidecar(params, case_id, actor_role, output_glb, report_path, provenance_path, str(manifest), str(obj), use_comfy, optimization_report_path)

    print(f"[orchestrate] SUCCESS: {output_glb} + report + provenance + bundle")
    result = {"glb": output_glb, "report": report_path, "provenance": provenance_path, "bundle": bundle_path}
    if mpfb2_eye_rig_report_path:
        result["mpfb2EyeRigReport"] = mpfb2_eye_rig_report_path
    return result


def resolve_generation_inputs(args: argparse.Namespace) -> Tuple[Dict[str, Any], str, str, str, Optional[str]]:
    if args.case_actor_preset:
        # Preset ids are "<case_id>:<actor_id>". The case-definition phenotype
        # export takes precedence when it authors this actor (issue-291); the
        # legacy Python dict remains the fallback for pre-migration cases.
        case_part, actor_part = (args.case_actor_preset.split(":", 1) + [None])[:2]
        fixture = params_from_case_definition(case_part, actor_part) if case_part and actor_part else None
        if fixture is not None:
            params, fixture_role, output_name = fixture
            params = dict(params)
            params["actor_id"] = actor_part
            case_id = args.case_id or case_part
            actor_role = args.actor_role or fixture_role
            if args.output_glb:
                output_glb = args.output_glb
            else:
                output_dir = args.output_dir or ".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1"
                output_glb = str(Path(output_dir) / output_name)
            return params, case_id, actor_role, output_glb, PHENOTYPE_SOURCE_CASE_DEFINITION
        preset = CASE_ACTOR_PRESETS.get(args.case_actor_preset)
        if not preset:
            raise SystemExit(
                f"REFUSE (issue-291): unknown --case-actor-preset '{args.case_actor_preset}'. The case "
                f"definition carries no phenotype for this actor and no legacy preset exists. Author "
                f"phenotype on the scenario fixture actor record (packages/openclinxr/scenario-fixtures) "
                f"and regenerate the export; the factory will not silently generate a generic adult (#276)."
            )
        params = dict(preset["params"])
        params["actor_id"] = preset["actor_id"]
        case_id = args.case_id or preset["case_id"]
        actor_role = args.actor_role or preset["actor_role"]
        if args.output_glb:
            output_glb = args.output_glb
        else:
            output_dir = args.output_dir or ".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1"
            output_glb = str(Path(output_dir) / preset["output_name"])
        return params, case_id, actor_role, output_glb, PHENOTYPE_SOURCE_CASE_ACTOR_PRESET

    params_source = args.params_json or (f"@{args.params_file}" if getattr(args, "params_file", None) else None)
    if not args.case_id or not args.actor_role or not params_source or not args.output_glb:
        raise SystemExit("--case-id, --actor-role, --params-json/--params-file, and --output-glb are required unless --case-actor-preset is used.")

    params_str = params_source
    if params_str.startswith("@"):
        with open(params_str[1:]) as f:
            params = json.load(f)
    else:
        params = json.loads(params_str)
    return params, args.case_id, args.actor_role, args.output_glb, None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id")
    ap.add_argument("--actor-role")
    ap.add_argument("--params-json", help="JSON or @file")
    ap.add_argument("--params-file", help="Path to JSON params file. Equivalent to --params-json @file.")
    ap.add_argument("--output-glb")
    ap.add_argument("--output-dir", help="Directory for preset output when --output-glb is omitted.")
    ap.add_argument(
        "--case-actor-preset",
        choices=allowed_case_actor_preset_ids(),
        help="Case actor id (legacy preset row OR phenotype-export entry) to materialize locally.",
    )
    ap.add_argument("--list-presets", action="store_true", help="List built-in case actor presets and exit.")
    ap.add_argument("--use-comfy", action="store_true")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    ap.add_argument("--optimize-meshopt", action="store_true", help="Apply post-Blender Meshopt compression only after browser evidence confirms skinned body visibility.")
    ap.add_argument("--mpfb2-eye-rig", action="store_true", help="Apply MPFB2-informed seated procedural eyes and exportable gaze-probe clips after Blender rigging (now drives canonical eye.L/eye.R bones under head for peds school-age blueprint eye-joint-integration; gaze via bone rotations + target compat; diagnostics/reports updated with notEvidenceFor all readiness gates).")
    ap.add_argument("--garment-source-geometry-hint", action="store_true", help="LEGACY (hint-v1 aborted 2026-06-07 per chief pivot + anti-toil + Q1 violation: 48-face rigid no-weight cylinder, ignored garmentLayers=short_sleeve_exam_tshirt from peds_asthma_parent_anxiety_v1). Real embed from phenotype now in apply_role_clothing_material_regions (sleeved weighted geo deforms on breathing; v2 expanded 0.27len/visible volume/ripples/folds/vivid blue per asset-pipeline-lead for peds patient preset re-orchestrate). Default OFF; flag for backward only.")
    argv = sys.argv[1:]
    if argv and argv[0] == "--":
        argv = argv[1:]
    args = ap.parse_args(argv)

    if args.list_presets:
        print(json.dumps({
            preset_id: {
                "case_id": preset["case_id"],
                "actor_id": preset["actor_id"],
                "actor_role": preset["actor_role"],
                "output_name": preset["output_name"],
            }
            for preset_id, preset in sorted(CASE_ACTOR_PRESETS.items())
        }, indent=2))
        return

    params, case_id, actor_role, output_glb, phenotype_source = resolve_generation_inputs(args)
    out = generate(params, case_id, actor_role, output_glb, args.use_comfy, args.comfy_url, args.optimize_meshopt, args.mpfb2_eye_rig, getattr(args, "garment_source_geometry_hint", False), phenotype_source)
    print("ORCHESTRATE_SUCCESS")
    print(json.dumps(out))


# --- Optional FastAPI (for web API / worker HTTP call) ---
try:
    from fastapi import FastAPI
    from pydantic import BaseModel

    app = FastAPI(title="OpenClinXR Anny Character Generator")

    class GenerateRequest(BaseModel):
        case_id: Optional[str] = None
        actor_role: Optional[str] = None
        params: Optional[Dict[str, Any]] = None
        params_file: Optional[str] = None
        output_glb: Optional[str] = None
        output_dir: Optional[str] = None
        case_actor_preset: Optional[str] = None
        use_comfy: bool = False
        mpfb2_eye_rig: bool = False
        garment_source_geometry_hint: bool = False  # legacy (hint aborted); real garment region now driven by phenotype.garmentLayers (short_sleeve_exam_tshirt etc) in apply_role_clothing_material_regions; patient preset re-orchestrated for v2 obvious sleeves (Q1)
        comfy_url: str = "http://127.0.0.1:8188"
        optimize_meshopt: bool = False

    @app.post("/generate")
    def generate_endpoint(req: GenerateRequest):
        namespace = argparse.Namespace(
            case_id=req.case_id,
            actor_role=req.actor_role,
            params_json=json.dumps(req.params) if req.params is not None else None,
            params_file=req.params_file,
            output_glb=req.output_glb,
            output_dir=req.output_dir,
            case_actor_preset=req.case_actor_preset,
            garment_source_geometry_hint=getattr(req, "garment_source_geometry_hint", False),  # legacy only
        )
        params, case_id, actor_role, output_glb, phenotype_source = resolve_generation_inputs(namespace)
        out = generate(params, case_id, actor_role, output_glb, req.use_comfy, req.comfy_url, req.optimize_meshopt, getattr(req, "mpfb2_eye_rig", False), getattr(req, "garment_source_geometry_hint", False), phenotype_source)  # phenotype.garmentLayers now primary for real sleeved garment in blender stage; re-orchestrated peds patient preset triggers expanded sleeve geometry on next orchestrate_character --case-actor-preset patient_maya_johnson_v1
        return {"ok": True, "glb": out.get("glb"), "report": out.get("report"), "provenance": out.get("provenance"), "bundle": out.get("bundle")}

except ImportError:
    app = None  # FastAPI not installed; CLI still works


if __name__ == "__main__":
    main()

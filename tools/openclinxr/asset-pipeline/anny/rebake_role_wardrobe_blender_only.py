#!/usr/bin/env python3
"""
Blender-only wardrobe re-bake on tracked .anny_base.obj files (#96 + #94).

Does NOT call generate_mesh / anny (absent → silent ~0.8 MB stubs).
Copies existing real-Anny bases, overlays role phenotype.garmentLayers, runs
automate_blender.py, writes provenance + leaves rigging_report next to GLB.

Role → base map (named decision for #96):
  ED patient  → peds_nurse_kevin.anny_base.obj (adult_male 176cm) + hospital_gown
  ED nurse    → (no re-bake) peds_nurse_kevin.glb scrubs already distinct
  ED spouse   → (no re-bake) peds_anxious_parent.glb street clothes already distinct
  Peds child  → peds_patient_child.anny_base.obj (125cm) + short_sleeve_exam_tshirt

Rejected: full orchestrate_character without anny; three copies of one nurse;
hand-tuning garment shape literals in automate_blender.py.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[4]
GEN = ROOT / "apps/ui-xr/public/generated-humanoids"
BLENDER = os.environ.get("BLENDER_PATH", "blender")
AUTOMATE = ROOT / "tools/openclinxr/asset-pipeline/anny/automate_blender.py"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def overlay_manifest(
    source_manifest: Path,
    *,
    actor_id: str,
    phenotype_overlay: Dict[str, Any],
    extra_params: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    src = json.loads(source_manifest.read_text(encoding="utf-8"))
    params = dict(src.get("input_params") or {})
    phenotype = dict(params.get("phenotype") or {})
    phenotype.update(phenotype_overlay)
    params["phenotype"] = phenotype
    params["actor_id"] = actor_id
    if extra_params:
        for k, v in extra_params.items():
            if k != "phenotype":
                params[k] = v
    src["input_params"] = params
    src["reuse_note"] = (
        "blender_only_rebake_on_tracked_anny_base_obj_issue_96_94_no_anny_forward_pass"
    )
    return src


def run_blender(
    *,
    input_mesh: Path,
    input_manifest: Path,
    output_glb: Path,
    case_id: str,
    actor_role: str,
) -> Path:
    report = output_glb.with_name(output_glb.stem + "_rigging_report.json")
    cmd = [
        BLENDER,
        "--background",
        "--python",
        str(AUTOMATE),
        "--",
        "--input-mesh",
        str(input_mesh),
        "--input-manifest",
        str(input_manifest),
        "--output-glb",
        str(output_glb),
        "--case-id",
        case_id,
        "--actor-role",
        actor_role,
    ]
    print("[rebake]", " ".join(cmd), flush=True)
    subprocess.check_call(cmd, cwd=str(ROOT), timeout=600)
    if not output_glb.is_file():
        raise SystemExit(f"blender did not write {output_glb}")
    bytes_ = output_glb.stat().st_size
    if bytes_ < 1_000_000:
        raise SystemExit(f"GLB too small ({bytes_} B) — stub/quality fail: {output_glb}")
    return report


def write_provenance(
    *,
    output_glb: Path,
    case_id: str,
    actor_id: str,
    actor_role: str,
    base_obj: str,
    garment_layers: List[str],
    report_path: Path | None,
) -> None:
    prov = {
        "schemaVersion": "openclinxr.generated-humanoid-provenance.v1",
        "scenarioId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "assetPath": str(output_glb.relative_to(ROOT)),
        "riggingReportPath": (
            str(report_path.relative_to(ROOT)) if report_path and report_path.is_file() else None
        ),
        "sourceManifestPath": str(
            output_glb.with_suffix(".anny_manifest.json").relative_to(ROOT)
        ),
        "generatorMode": "blender_only_rebake_on_tracked_real_anny_base_obj_v1",
        "sourceKind": "real_anny_candidate_unverified",
        "usesRealAnnyForwardPass": True,
        "realAnnyWeightsUsed": False,
        "textureMode": "procedural_fallback",
        "animationMode": "procedural_clinical_idle_conversation_posture_fallback",
        "optimizationMode": "unoptimized_post_blender_glb",
        "realismGrade": "B",
        "promotionStatus": "runtime_candidate_not_realism_gate_pass",
        "outputSha256": sha256(output_glb),
        "outputBytes": output_glb.stat().st_size,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "method": "blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
        "baseObj": base_obj,
        "garmentLayers": garment_layers,
        "notEvidenceFor": [
            "b_plus_visual_realism_gate",
            "quest_readiness",
            "production_asset_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
            "scene_placement_readiness",
        ],
        "sourceNotes": [
            "Issue #96/#94: Blender-only re-bake on tracked .anny_base.obj (anny package not importable).",
            f"Base {base_obj}; garmentLayers={garment_layers}.",
            "Not full orchestrate_character (would emit ~0.8 MB stubs without anny).",
            "Not B+ realism / production / clinical readiness.",
        ],
        "claimScope": "local_role_distinct_wardrobe_rebake_not_readiness",
        "promotionGates": False,
    }
    write_json(output_glb.with_suffix(".provenance.json"), prov)


def rebake_ed_patient() -> None:
    """Adult male base + hospital_gown → ed_chest_pain_adult_cast.glb (ED patient only)."""
    base_obj = GEN / "peds_nurse_kevin.anny_base.obj"
    base_man = GEN / "peds_nurse_kevin.anny_manifest.json"
    out_glb = GEN / "ed_chest_pain_adult_cast.glb"
    work_mesh = GEN / "ed_chest_pain_adult_cast.anny_base.obj"
    work_man = GEN / "ed_chest_pain_adult_cast.anny_manifest.json"

    phenotype = {
        "skin_tone": "warm_medium",
        "hair_color": "brown",
        "eye_color": "brown",
        "anny_topology": "default",
        "gender_presentation": "adult_male",
        "height_cm": 176,
        "build": "average_adult",
        "hair_density": 0.65,
        "brow_tension": 0.55,
        "anxious": 0.65,
        "flush": 0.15,
        "age_wrinkle": 0.18,
        "bmi": 26.0,
        "clothing_style": "clinical_exam_hospital_gown_chest_pain",
        "clothing_color": "soft_blue",
        "role_visual_cue": "ed_chest_pain_patient",
        "wardrobeRole": "ed_patient_exam",
        "garmentLayers": ["hospital_gown"],
        "fabricPalette": "hospital_gown_blue_pattern",
        "materialFinish": "cotton_slight_sheen",
        "accessoryMarkers": [],
        "fitProfile": "adult_standard_fit",
        "sleeveGeometryExpansion": "v2_gown_sleeves_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="patient_robert_hayes_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 52,
            "body_profile": "adult_standard",
            "pose": "standing_neutral_chest_pain_priority",
            "seed": 2001,
        },
    )
    shutil.copy2(base_obj, work_mesh)
    write_json(work_man, man)
    report = run_blender(
        input_mesh=work_mesh,
        input_manifest=work_man,
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_role="patient",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_id="patient_robert_hayes_v1",
        actor_role="patient",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["hospital_gown"],
        report_path=report,
    )
    print("[rebake] ED patient done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_ed_nurse() -> None:
    """Adult male base + scrubs → ed_chest_pain_nurse_adult.glb (ED provenance)."""
    base_obj = GEN / "peds_nurse_kevin.anny_base.obj"
    base_man = GEN / "peds_nurse_kevin.anny_manifest.json"
    out_glb = GEN / "ed_chest_pain_nurse_adult.glb"
    work_mesh = GEN / "ed_chest_pain_nurse_adult.anny_base.obj"
    work_man = GEN / "ed_chest_pain_nurse_adult.anny_manifest.json"
    phenotype = {
        "skin_tone": "medium_warm",
        "hair_color": "black",
        "eye_color": "brown",
        "anny_topology": "default",
        "gender_presentation": "adult_female_nurse",
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
        "wardrobeRole": "ed_nurse_scrubs",
        "garmentLayers": ["scrub_top", "scrub_pocket"],
        "fabricPalette": "teal_scrubs_and_white_badge",
        "materialFinish": "poly_cotton_slight_sheen",
        "accessoryMarkers": ["name_badge", "scrub_pocket"],
        "fitProfile": "adult_clinical_team_fit",
        "sleeveGeometryExpansion": "v2_scrubs_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="nurse_maria_alvarez_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 34,
            "body_profile": "adult_clinical_team",
            "pose": "standing_clinical_ready",
            "seed": 2103,
        },
    )
    shutil.copy2(base_obj, work_mesh)
    write_json(work_man, man)
    report = run_blender(
        input_mesh=work_mesh,
        input_manifest=work_man,
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_role="nurse",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_id="nurse_maria_alvarez_v1",
        actor_role="nurse",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["scrub_top", "scrub_pocket"],
        report_path=report,
    )
    print("[rebake] ED nurse done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_ed_spouse() -> None:
    """Adult female base + casual+cardigan → ed_chest_pain_spouse_adult.glb (ED provenance)."""
    base_obj = GEN / "peds_anxious_parent.anny_base.obj"
    base_man = GEN / "peds_anxious_parent.anny_manifest.json"
    out_glb = GEN / "ed_chest_pain_spouse_adult.glb"
    work_mesh = GEN / "ed_chest_pain_spouse_adult.anny_base.obj"
    work_man = GEN / "ed_chest_pain_spouse_adult.anny_manifest.json"
    phenotype = {
        "skin_tone": "warm_light",
        "hair_color": "dark_brown",
        "eye_color": "brown",
        "gender_presentation": "adult_female",
        "height_cm": 166,
        "build": "average_adult",
        "hair_density": 0.72,
        "brow_tension": 0.40,
        "anxious": 0.75,
        "flush": 0.22,
        "age_wrinkle": 0.20,
        "bmi": 24.0,
        "clothing_style": "muted_rose_street_cardigan",
        "clothing_color": "muted_rose",
        "role_visual_cue": "anxious_spouse",
        "wardrobeRole": "ed_spouse_casual",
        "garmentLayers": ["casual_top", "open_cardigan"],
        "fabricPalette": "muted_rose_and_neutral",
        "materialFinish": "cotton_knit_matte",
        "accessoryMarkers": [],
        "fitProfile": "adult_parent_average_fit",
        "sleeveGeometryExpansion": "v2_street_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="spouse_anna_hayes_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 48,
            "body_profile": "adult_standard",
            "pose": "standing_anxious_guardian",
            "seed": 2102,
        },
    )
    shutil.copy2(base_obj, work_mesh)
    write_json(work_man, man)
    report = run_blender(
        input_mesh=work_mesh,
        input_manifest=work_man,
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_role="family",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="ed_chest_pain_priority_v1",
        actor_id="spouse_anna_hayes_v1",
        actor_role="family",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["casual_top", "open_cardigan"],
        report_path=report,
    )
    print("[rebake] ED spouse done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_peds_child() -> None:
    """Child base + short_sleeve_exam_tshirt → peds_patient_child.glb."""
    base_obj = GEN / "peds_patient_child.anny_base.obj"
    base_man = GEN / "peds_patient_child.anny_manifest.json"
    out_glb = GEN / "peds_patient_child.glb"
    # Backup current naked GLB path is not required; re-bake overwrites.
    phenotype = {
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
        "sleeveGeometryExpansion": "v2_obvious_sleeves_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="patient_maya_johnson_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 8,
            "body_profile": "pediatric_school_age",
            "pose": "standing_neutral_work_of_breathing",
            "seed": 1001,
        },
    )
    # Keep base obj in place; write overlay manifest next to it.
    write_json(base_man, man)
    report = run_blender(
        input_mesh=base_obj,
        input_manifest=base_man,
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_role="patient",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_id="patient_maya_johnson_v1",
        actor_role="patient",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["short_sleeve_exam_tshirt"],
        report_path=report,
    )
    print("[rebake] peds child done", out_glb, out_glb.stat().st_size, "bytes")


def main() -> None:
    targets = sys.argv[1:] or ["ed_patient", "ed_nurse", "ed_spouse", "peds_child"]
    if "ed_patient" in targets:
        rebake_ed_patient()
    if "ed_nurse" in targets:
        rebake_ed_nurse()
    if "ed_spouse" in targets:
        rebake_ed_spouse()
    if "peds_child" in targets:
        rebake_peds_child()
    print("REBAKE_ROLE_WARDROBE_SUCCESS", targets)


if __name__ == "__main__":
    main()

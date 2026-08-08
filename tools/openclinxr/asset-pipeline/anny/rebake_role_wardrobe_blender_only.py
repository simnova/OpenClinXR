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

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

# Shared mode-tagged provenance writer (#142). Do not hand-edit chain fields on artifacts.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
from humanoid_provenance import write_blender_only_rebake_provenance  # noqa: E402

ROOT = Path(__file__).resolve().parents[4]
GEN = ROOT / "apps/ui-xr/public/generated-humanoids"
BLENDER = os.environ.get("BLENDER_PATH", "blender")
AUTOMATE = ROOT / "tools/openclinxr/asset-pipeline/anny/automate_blender.py"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


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
    garment_coeff_overrides: Path | None = None,
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
    if garment_coeff_overrides is not None:
        cmd.extend(["--garment-coeff-overrides", str(garment_coeff_overrides)])
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
    """Delegate to shared mode-tagged writer (issue #142).

    Emits derivationMode=blender_only_rebake with inherited_from_base_not_reverified
    licence posture — not an orchestrate-shaped annyCode/mpfb2 fiction.
    """
    write_blender_only_rebake_provenance(
        output_glb=output_glb,
        case_id=case_id,
        actor_id=actor_id,
        actor_role=actor_role,
        base_obj=base_obj,
        garment_layers=garment_layers,
        report_path=report_path,
        repo_root=ROOT,
    )


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


def rebake_peds_parent() -> None:
    """Adult female base + casual_top/open_cardigan → peds_anxious_parent.glb."""
    base_obj = GEN / "peds_anxious_parent.anny_base.obj"
    base_man = GEN / "peds_anxious_parent.anny_manifest.json"
    out_glb = GEN / "peds_anxious_parent.glb"
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
        "role_visual_cue": "anxious_parent",
        "wardrobeRole": "parent_casual",
        "garmentLayers": ["casual_top", "open_cardigan"],
        "fabricPalette": "muted_rose_and_neutral",
        "materialFinish": "cotton_knit_matte",
        "accessoryMarkers": [],
        "fitProfile": "adult_parent_average_fit",
        "sleeveGeometryExpansion": "v2_street_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="parent_tara_johnson_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 38,
            "body_profile": "adult_standard",
            "pose": "standing_anxious_guardian",
            "seed": 1102,
        },
    )
    write_json(base_man, man)
    report = run_blender(
        input_mesh=base_obj,
        input_manifest=base_man,
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_role="parent",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_id="parent_tara_johnson_v1",
        actor_role="parent",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["casual_top", "open_cardigan"],
        report_path=report,
    )
    print("[rebake] peds parent done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_male_street_patient() -> None:
    """Adult male base + casual_top/open_cardigan → adult_male_street_casual.glb (#160).

    Telehealth / ambulatory patients need a MALE street body; female street shells
    already sit on peds_anxious_parent / ed spouse. Base: peds_nurse_kevin adult male.
    Rejected: reusing spouse body (breaks within-scenario distinctness + gender), full
    orchestrate_character (silent stubs without anny).
    """
    base_obj = GEN / "peds_nurse_kevin.anny_base.obj"
    base_man = GEN / "peds_nurse_kevin.anny_manifest.json"
    out_glb = GEN / "adult_male_street_casual.glb"
    work_mesh = GEN / "adult_male_street_casual.anny_base.obj"
    work_man = GEN / "adult_male_street_casual.anny_manifest.json"
    phenotype = {
        "skin_tone": "warm_medium",
        "hair_color": "dark_brown",
        "eye_color": "brown",
        "anny_topology": "default",
        "gender_presentation": "adult_male",
        "height_cm": 176,
        "build": "average_adult",
        "hair_density": 0.60,
        "brow_tension": 0.22,
        "anxious": 0.35,
        "flush": 0.08,
        "age_wrinkle": 0.16,
        "bmi": 26.5,
        "clothing_style": "home_street_casual_cardigan",
        "clothing_color": "warm_olive_and_cream",
        "role_visual_cue": "telehealth_home_patient",
        "wardrobeRole": "home_street_patient",
        "garmentLayers": ["casual_top", "open_cardigan"],
        "fabricPalette": "olive_knit_and_cream_casual",
        "materialFinish": "cotton_knit_matte",
        "accessoryMarkers": [],
        "fitProfile": "adult_standard_fit",
        "sleeveGeometryExpansion": "v2_street_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="patient_luis_martinez_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 58,
            "body_profile": "adult_standard",
            "pose": "standing_neutral_home_visit",
            "seed": 1601,
        },
    )
    shutil.copy2(base_obj, work_mesh)
    write_json(work_man, man)
    report = run_blender(
        input_mesh=work_mesh,
        input_manifest=work_man,
        output_glb=out_glb,
        case_id="telehealth_diabetes_health_literacy_v1",
        actor_role="patient",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="telehealth_diabetes_health_literacy_v1",
        actor_id="patient_luis_martinez_v1",
        actor_role="patient",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["casual_top", "open_cardigan"],
        report_path=report,
    )
    print("[rebake] male street patient done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_peds_nurse() -> None:
    """Adult male base + scrubs → peds_nurse_kevin.glb."""
    base_obj = GEN / "peds_nurse_kevin.anny_base.obj"
    base_man = GEN / "peds_nurse_kevin.anny_manifest.json"
    out_glb = GEN / "peds_nurse_kevin.glb"
    phenotype = {
        "skin_tone": "medium_warm",
        "hair_color": "black",
        "eye_color": "brown",
        "anny_topology": "default",
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
        "wardrobeRole": "peds_nurse_scrubs",
        "garmentLayers": ["scrub_top", "scrub_pocket"],
        # #180a: distinct palette so co-present nurse-class bodies do not share primary
        # outer pocket colour. scrub_top stays locked at teal (counterweight #180b).
        "fabricPalette": "teal_scrubs_peds_shift",
        "materialFinish": "poly_cotton_slight_sheen",
        "accessoryMarkers": ["name_badge", "scrub_pocket"],
        "fitProfile": "adult_clinical_team_fit",
        "sleeveGeometryExpansion": "v2_scrubs_from_preset_factory_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id="nurse_kevin_lee_v1",
        phenotype_overlay=phenotype,
        extra_params={
            "age": 34,
            "body_profile": "adult_clinical_team",
            "pose": "standing_clinical_ready",
            "seed": 1103,
        },
    )
    write_json(base_man, man)
    report = run_blender(
        input_mesh=base_obj,
        input_manifest=base_man,
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_role="nurse",
    )
    write_provenance(
        output_glb=out_glb,
        case_id="peds_asthma_parent_anxiety_v1",
        actor_id="nurse_kevin_lee_v1",
        actor_role="nurse",
        base_obj=str(base_obj.relative_to(ROOT)),
        garment_layers=["scrub_top", "scrub_pocket"],
        report_path=report,
    )
    print("[rebake] peds nurse done", out_glb, out_glb.stat().st_size, "bytes")


def rebake_matrix_variant(
    *,
    body_base_name: str,
    garment_layers: List[str],
    actor_role: str,
    output_glb: Path,
    coeff_overrides: Dict[str, Any],
    work_dir: Path,
    case_id: str = "garment_bake_matrix_issue_195",
    actor_id: str = "matrix_variant_v1",
) -> Path:
    """#195: Blender-only rebake of ONE fixed base + garmentLayers with optional coeff overrides.

    Decisions:
      - Body: tracked *.anny_base.obj under generated-humanoids (no anny regen → no stub trap).
      - Parametrisation: JSON coeff-overrides file passed to automate_blender (reproducible;
        REJECTED pure env-only — less discoverable; REJECTED mutating shipping constants).
      - Output: export GLB (runtime path) so continuity is measured from the file, not Blender.
    """
    base_obj = GEN / body_base_name
    if not base_obj.is_file():
        # allow absolute / relative path outside GEN
        base_obj = Path(body_base_name)
    if not base_obj.is_file():
        raise SystemExit(f"matrix-variant: body base not found: {body_base_name}")

    # Prefer sibling manifest of the base; fall back to peds_nurse_kevin manifest skeleton.
    base_man = base_obj.with_suffix(".json")
    if base_man.name.endswith(".anny_base.json"):
        base_man = base_obj.with_name(base_obj.name.replace(".anny_base.obj", ".anny_manifest.json"))
    if not base_man.is_file():
        sibling = GEN / "peds_nurse_kevin.anny_manifest.json"
        if not sibling.is_file():
            raise SystemExit(f"matrix-variant: no manifest for {base_obj}")
        base_man = sibling

    work_dir.mkdir(parents=True, exist_ok=True)
    work_mesh = work_dir / f"{output_glb.stem}.anny_base.obj"
    work_man = work_dir / f"{output_glb.stem}.anny_manifest.json"
    overrides_path = work_dir / f"{output_glb.stem}.coeff_overrides.json"

    phenotype = {
        "skin_tone": "warm_medium",
        "hair_color": "brown",
        "eye_color": "brown",
        "anny_topology": "default",
        "gender_presentation": "adult_male",
        "height_cm": 176,
        "build": "average_adult",
        "hair_density": 0.60,
        "brow_tension": 0.30,
        "anxious": 0.20,
        "flush": 0.05,
        "age_wrinkle": 0.12,
        "bmi": 25.0,
        "clothing_style": "matrix_sweep_garment",
        "clothing_color": "soft_blue",
        "role_visual_cue": "garment_bake_matrix",
        "wardrobeRole": "matrix_sweep",
        "garmentLayers": garment_layers,
        "fabricPalette": "matrix_sweep_neutral",
        "materialFinish": "cotton_matte",
        "accessoryMarkers": [],
        "fitProfile": "adult_standard_fit",
        "sleeveGeometryExpansion": "v2_matrix_sweep_no_hand_tune",
    }
    man = overlay_manifest(
        base_man,
        actor_id=actor_id,
        phenotype_overlay=phenotype,
        extra_params={
            "age": 40,
            "body_profile": "adult_standard",
            "pose": "standing_neutral_matrix",
            "seed": 19501,
        },
    )
    shutil.copy2(base_obj, work_mesh)
    write_json(work_man, man)
    write_json(overrides_path, coeff_overrides)
    output_glb.parent.mkdir(parents=True, exist_ok=True)
    report = run_blender(
        input_mesh=work_mesh,
        input_manifest=work_man,
        output_glb=output_glb,
        case_id=case_id,
        actor_role=actor_role,
        garment_coeff_overrides=overrides_path if coeff_overrides else None,
    )
    write_provenance(
        output_glb=output_glb,
        case_id=case_id,
        actor_id=actor_id,
        actor_role=actor_role,
        base_obj=str(base_obj.relative_to(ROOT)) if str(base_obj).startswith(str(ROOT)) else str(base_obj),
        garment_layers=garment_layers,
        report_path=report,
    )
    print(
        "[rebake] matrix-variant done",
        output_glb,
        output_glb.stat().st_size,
        "bytes",
        "overrides=",
        coeff_overrides,
        flush=True,
    )
    return report


def _parse_matrix_cli(argv: List[str]) -> None:
    """CLI: matrix-variant --body-base NAME --garment-layers a,b --output-glb PATH --coeff-overrides JSON"""
    import argparse

    ap = argparse.ArgumentParser(description="#195 garment bake-matrix single variant (Blender-only)")
    ap.add_argument("--body-base", required=True, help="Tracked *.anny_base.obj name or path")
    ap.add_argument(
        "--garment-layers",
        required=True,
        help="Comma-separated phenotype.garmentLayers (e.g. open_cardigan or hospital_gown)",
    )
    ap.add_argument("--actor-role", default="patient")
    ap.add_argument("--output-glb", required=True)
    ap.add_argument(
        "--coeff-overrides",
        default="{}",
        help='JSON object of coefficient overrides, e.g. {"bot_y_fraction":0.28}',
    )
    ap.add_argument(
        "--work-dir",
        default=None,
        help="Scratch dir for mesh/manifest/override copies (default: beside output-glb)",
    )
    args = ap.parse_args(argv)
    layers = [p.strip() for p in args.garment_layers.split(",") if p.strip()]
    overrides = json.loads(args.coeff_overrides)
    out = Path(args.output_glb)
    if not out.is_absolute():
        out = ROOT / out
    work = Path(args.work_dir) if args.work_dir else out.parent / f"_work_{out.stem}"
    if not work.is_absolute():
        work = ROOT / work
    rebake_matrix_variant(
        body_base_name=args.body_base,
        garment_layers=layers,
        actor_role=args.actor_role,
        output_glb=out,
        coeff_overrides=overrides if isinstance(overrides, dict) else {},
        work_dir=work,
    )
    print("REBAKE_MATRIX_VARIANT_SUCCESS", out)


def main() -> None:
    # #195 matrix-variant subcommand (JSON-driven coefficient sweep). Default: production role rebakes.
    if len(sys.argv) > 1 and sys.argv[1] == "matrix-variant":
        _parse_matrix_cli(sys.argv[2:])
        return

    targets = sys.argv[1:] or [
        "ed_patient",
        "ed_nurse",
        "ed_spouse",
        "peds_child",
        "peds_parent",
        "peds_nurse",
    ]
    if "ed_patient" in targets:
        rebake_ed_patient()
    if "ed_nurse" in targets:
        rebake_ed_nurse()
    if "ed_spouse" in targets:
        rebake_ed_spouse()
    if "peds_child" in targets:
        rebake_peds_child()
    if "peds_parent" in targets:
        rebake_peds_parent()
    if "peds_nurse" in targets:
        rebake_peds_nurse()
    if "male_street_patient" in targets:
        rebake_male_street_patient()
    print("REBAKE_ROLE_WARDROBE_SUCCESS", targets)


if __name__ == "__main__":
    main()

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
            },
        },
    },
}

CASE_ACTOR_PRESETS = {
    f"peds_asthma_parent_anxiety_v1:{actor_id}": preset
    for actor_id, preset in PEDS_ASTHMA_PARENT_ANXIETY_PRESETS.items()
}


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


def write_provenance(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, report_path: str, manifest_path: str, optimization_report_path: Optional[str] = None) -> str:
    provenance_path = provenance_path_for(output_glb)
    actor_id = str(params.get("actor_id") or params.get("actorId") or f"{actor_role}_candidate")
    params_hash = hashlib.sha256(json.dumps(params, sort_keys=True).encode("utf-8")).hexdigest()
    source_summary = source_generation_summary(manifest_path)
    optimization_handoff = read_optional_json(optimization_report_path)
    payload = {
        "schemaVersion": "openclinxr.generated-humanoid-provenance.v1",
        "scenarioId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "assetPath": output_glb,
        "riggingReportPath": report_path,
        "sourceManifestPath": manifest_path,
        "generatorMode": source_summary["generatorMode"],
        "sourceKind": source_summary["sourceKind"],
        "usesRealAnnyForwardPass": source_summary["usesRealAnnyForwardPass"],
        "realAnnyWeightsUsed": source_summary["realAnnyWeightsUsed"],
        "textureMode": "procedural_fallback",
        "animationMode": "procedural_clinical_idle_conversation_posture_fallback",
        "optimizationMode": "meshopt_post_blender_glb" if optimization_handoff else "unoptimized_post_blender_glb",
        "realismGrade": "B",
        "promotionStatus": "runtime_candidate_not_realism_gate_pass",
        "sourceOriginChain": {
            "sourceRecordPath": "sources/anny-github-2026.json",
            "meshStage": str(GEN_MESH),
            "blenderStage": str(BLENDER_STAGE),
            "orchestrator": str(HERE / "orchestrate_character.py"),
            "optimizationStage": str(OPTIMIZE_GLB) if optimization_handoff else None,
            "sourceManifestKind": source_summary["manifest"].get("source_kind"),
            "sourceTopologyMode": source_summary["manifest"].get("output", {}).get("source_topology_mode") if isinstance(source_summary["manifest"].get("output"), dict) else None,
        },
        "optimizationHandoff": optimization_handoff,
        "licenseChain": {
            "annyCode": "Apache-2.0 per sources/anny-github-2026.json",
            "mpfb2AdaptedAssets": "CC0 per sources/anny-github-2026.json",
            "generatedCandidate": "OpenClinXR local Anny forward-pass candidate; no cloud provider, paid API, credential, external model download, or noncommercial download helper used" if source_summary["usesRealAnnyForwardPass"] else "OpenClinXR deterministic local fixture; no external generated third-party asset committed",
        },
        "derivativeLineage": {
            "caseId": case_id,
            "actorId": actor_id,
            "reuseKey": f"{case_id}:{actor_id}:{actor_role}:anny_candidate",
            "sourceParametersHash": params_hash,
        },
        "toolVersion": source_summary["toolVersion"],
        "promptOrCaseParameterHash": params_hash,
        "notEvidenceFor": source_summary["notEvidenceFor"],
        "sourceNotes": source_summary["sourceNotes"],
    }
    os.makedirs(os.path.dirname(provenance_path) or ".", exist_ok=True)
    with open(provenance_path, "w") as f:
        json.dump(payload, f, indent=2)
    return provenance_path


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
    """Optional post-Blender stage: MPFB2-informed seated procedural eyes + gaze-probe export."""
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


def generate(params: Dict[str, Any], case_id: str, actor_role: str, output_glb: str, use_comfy: bool = False, comfy_url: str = "http://127.0.0.1:8188", optimize_meshopt: bool = False, mpfb2_eye_rig: bool = False) -> Dict[str, str]:
    if use_comfy:
        raise SystemExit("--use-comfy is approval-gated; keep StableGen/ComfyUI off until explicitly approved.")
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

    provenance_path = write_provenance(params, case_id, actor_role, output_glb, report_path, str(manifest), optimization_report_path)
    bundle_path = write_bundle_sidecar(params, case_id, actor_role, output_glb, report_path, provenance_path, str(manifest), str(obj), use_comfy, optimization_report_path)

    print(f"[orchestrate] SUCCESS: {output_glb} + report + provenance + bundle")
    result = {"glb": output_glb, "report": report_path, "provenance": provenance_path, "bundle": bundle_path}
    if mpfb2_eye_rig_report_path:
        result["mpfb2EyeRigReport"] = mpfb2_eye_rig_report_path
    return result


def resolve_generation_inputs(args: argparse.Namespace) -> Tuple[Dict[str, Any], str, str, str]:
    if args.case_actor_preset:
        preset = CASE_ACTOR_PRESETS.get(args.case_actor_preset)
        if not preset:
            raise SystemExit(f"Unknown --case-actor-preset '{args.case_actor_preset}'. Use --list-presets.")
        params = dict(preset["params"])
        params["actor_id"] = preset["actor_id"]
        case_id = args.case_id or preset["case_id"]
        actor_role = args.actor_role or preset["actor_role"]
        if args.output_glb:
            output_glb = args.output_glb
        else:
            output_dir = args.output_dir or ".openclinxr/asset-production/anny/peds_asthma_parent_anxiety_v1"
            output_glb = str(Path(output_dir) / preset["output_name"])
        return params, case_id, actor_role, output_glb

    params_source = args.params_json or (f"@{args.params_file}" if getattr(args, "params_file", None) else None)
    if not args.case_id or not args.actor_role or not params_source or not args.output_glb:
        raise SystemExit("--case-id, --actor-role, --params-json/--params-file, and --output-glb are required unless --case-actor-preset is used.")

    params_str = params_source
    if params_str.startswith("@"):
        with open(params_str[1:]) as f:
            params = json.load(f)
    else:
        params = json.loads(params_str)
    return params, args.case_id, args.actor_role, args.output_glb


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case-id")
    ap.add_argument("--actor-role")
    ap.add_argument("--params-json", help="JSON or @file")
    ap.add_argument("--params-file", help="Path to JSON params file. Equivalent to --params-json @file.")
    ap.add_argument("--output-glb")
    ap.add_argument("--output-dir", help="Directory for preset output when --output-glb is omitted.")
    ap.add_argument("--case-actor-preset", choices=sorted(CASE_ACTOR_PRESETS), help="Case actor preset to materialize locally.")
    ap.add_argument("--list-presets", action="store_true", help="List built-in case actor presets and exit.")
    ap.add_argument("--use-comfy", action="store_true")
    ap.add_argument("--comfy-url", default="http://127.0.0.1:8188")
    ap.add_argument("--optimize-meshopt", action="store_true", help="Apply post-Blender Meshopt compression only after browser evidence confirms skinned body visibility.")
    ap.add_argument("--mpfb2-eye-rig", action="store_true", help="Apply MPFB2-informed seated procedural eyes and exportable gaze-probe clips after Blender rigging.")
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

    params, case_id, actor_role, output_glb = resolve_generation_inputs(args)
    out = generate(params, case_id, actor_role, output_glb, args.use_comfy, args.comfy_url, args.optimize_meshopt, args.mpfb2_eye_rig)
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
        )
        params, case_id, actor_role, output_glb = resolve_generation_inputs(namespace)
        out = generate(params, case_id, actor_role, output_glb, req.use_comfy, req.comfy_url, req.optimize_meshopt)
        return {"ok": True, "glb": out.get("glb"), "report": out.get("report"), "provenance": out.get("provenance"), "bundle": out.get("bundle")}

except ImportError:
    app = None  # FastAPI not installed; CLI still works


if __name__ == "__main__":
    main()

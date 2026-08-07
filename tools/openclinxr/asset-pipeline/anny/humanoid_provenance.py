#!/usr/bin/env python3
"""Mode-tagged generated-humanoid provenance writer (issue #142).

One schema, two derivation modes:

- ``orchestrate`` — full local Anny forward-pass + Blender; may enumerate
  Apache-2.0 / CC0 claims from ``sources/anny-github-2026.json`` because that
  path actually ran the Anny package stages.
- ``blender_only_rebake`` — Blender wardrobe re-bake on a tracked ``*.anny_base.obj``.
  Records what the rebake **knows** (base path, base topology class, output hash,
  tool id, case/actor identity) plus explicit ``notRun`` / unknown fields.
  Must **not** manufacture an orchestrate-shaped licence re-enumeration.

Shared writer = schema + merge rules. Callers supply mode-specific knowns;
this module fills chain fields honestly and writes JSON.

CLAIM: mode-tagged chains with presence of licenseChain / derivativeLineage /
toolVersion / promptOrCaseParameterHash for both modes.
NOT: clinical / Quest / production readiness; not a re-verification of Anny licence.
"""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Sequence, Union

SCHEMA_VERSION = "openclinxr.generated-humanoid-provenance.v1"
SOURCE_RECORD_PATH = "sources/anny-github-2026.json"

DERIVATION_MODE_ORCHESTRATE = "orchestrate"
DERIVATION_MODE_BLENDER_ONLY_REBAKE = "blender_only_rebake"

GENERATOR_MODE_ORCHESTRATE_REAL = "real_anny_local_forward_pass_plus_blender_procedural"
GENERATOR_MODE_ORCHESTRATE_STUB = "anny_compatible_stub_plus_blender_procedural"
GENERATOR_MODE_BLENDER_ONLY_REBAKE = "blender_only_rebake_on_tracked_real_anny_base_obj_v1"

TOOL_VERSION_ORCHESTRATE_REAL = "openclinxr-real-anny-local-forward-pass-blender-v1-case-actor-presets"
TOOL_VERSION_ORCHESTRATE_STUB = "openclinxr-anny-compatible-stub-blender-v3-case-actor-presets"
TOOL_VERSION_BLENDER_ONLY_REBAKE = "openclinxr-blender-only-rebake-on-tracked-real-anny-base-obj-v1"

PathLike = Union[str, Path]


def stable_params_hash(params: Mapping[str, Any]) -> str:
    """SHA-256 of canonical JSON for case/rebake parameters (32–64 hex for preflight)."""
    return hashlib.sha256(
        json.dumps(params, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()


def sha256_file(path: PathLike) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_orchestrate_chains(
    *,
    case_id: str,
    actor_id: str,
    actor_role: str,
    params_hash: str,
    uses_real_anny_forward_pass: bool,
    source_origin_chain: Mapping[str, Any],
) -> Dict[str, Any]:
    """Licence + derivative chains for a path that actually ran orchestrate stages."""
    license_chain: Dict[str, Any] = {
        "status": "enumerated_from_source_record_at_orchestrate",
        "annyCode": f"Apache-2.0 per {SOURCE_RECORD_PATH}",
        "mpfb2AdaptedAssets": f"CC0 per {SOURCE_RECORD_PATH}",
        "generatedCandidate": (
            "OpenClinXR local Anny forward-pass candidate; no cloud provider, paid API, "
            "credential, external model download, or noncommercial download helper used"
            if uses_real_anny_forward_pass
            else "OpenClinXR deterministic local fixture; no external generated third-party asset committed"
        ),
        "sourceRecordPath": SOURCE_RECORD_PATH,
        "notRun": [],
    }
    derivative_lineage: Dict[str, Any] = {
        "status": "orchestrate_derivative",
        "caseId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "reuseKey": f"{case_id}:{actor_id}:{actor_role}:anny_candidate",
        "sourceParametersHash": params_hash,
        "notRun": [],
    }
    return {
        "sourceOriginChain": dict(source_origin_chain),
        "licenseChain": license_chain,
        "derivativeLineage": derivative_lineage,
    }


def build_blender_only_rebake_chains(
    *,
    case_id: str,
    actor_id: str,
    actor_role: str,
    base_obj: str,
    params_hash: str,
    source_topology_mode: str = "real_anny_mpfb2_forward_pass_v1",
    garment_authoring_class: str = "body_surface_normal_offset_issue_121",
    base_obj_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Honest chains for Blender-only wardrobe rebake.

    Knows: base OBJ path, base topology class claim carried by that base, case/actor
    identity, that this step did wardrobe re-authoring only.

    Does **not** claim: a fresh Anny forward pass, a re-enumeration of Apache/CC0
    licence text as if orchestrate ran, or production readiness.
    """
    base_name = base_obj_name or Path(base_obj).name
    not_run = [
        "anny_forward_pass",
        "orchestrate_character",
        "licence_text_reenumeration",
        "mesh_regeneration_from_anny_package",
    ]
    source_origin_chain: Dict[str, Any] = {
        "sourceTopologyMode": source_topology_mode,
        "rebakedFrom": f"{base_name} (tracked, unchanged by this re-bake)",
        "garmentAuthoringClass": garment_authoring_class,
        "sourceRecordPath": SOURCE_RECORD_PATH,
        "derivationNote": "Topology class inherited from tracked base OBJ; this step did not re-run Anny.",
    }
    # Inherited licence posture — not an orchestrate-shaped annyCode/mpfb2/generatedCandidate fiction.
    license_chain: Dict[str, Any] = {
        "status": "inherited_from_base_not_reverified",
        "base": base_obj,
        "baseTopologyMode": source_topology_mode,
        "sourceRecordPath": SOURCE_RECORD_PATH,
        "sourceRecordClaimsSupported": [
            "Anny code is licensed under Apache-2.0 and uses adapted MPFB2 assets licensed CC0.",
        ],
        "notRun": not_run,
        "explicitUnknown": [
            "Licence text was not re-read or re-asserted at rebake time; posture is inherited from the base topology class and source record only.",
            "Base OBJ has no separate .provenance.json sidecar; chain is path + topology class + source record, not a verified hash chain of licence documents.",
        ],
        "notes": (
            "Blender-only rebake consumed a tracked real-Anny base OBJ and did not run the Anny package. "
            "Do not treat this record as an orchestrate-time licence enumeration."
        ),
    }
    derivative_lineage: Dict[str, Any] = {
        "status": "wardrobe_rebake_derivative",
        "caseId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "reuseKey": f"{case_id}:{actor_id}:{actor_role}:anny_candidate",
        "baseObj": base_obj,
        "rebakePath": GENERATOR_MODE_BLENDER_ONLY_REBAKE,
        "method": "blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
        "sourceParametersHash": params_hash,
        "notRun": not_run,
    }
    return {
        "sourceOriginChain": source_origin_chain,
        "licenseChain": license_chain,
        "derivativeLineage": derivative_lineage,
    }


def build_provenance_document(
    *,
    derivation_mode: str,
    scenario_id: str,
    actor_id: str,
    actor_role: str,
    asset_path: str,
    generator_mode: str,
    source_kind: str,
    uses_real_anny_forward_pass: bool,
    real_anny_weights_used: bool,
    not_evidence_for: Sequence[str],
    source_notes: Sequence[str],
    params_for_hash: Mapping[str, Any],
    rigging_report_path: Optional[str] = None,
    source_manifest_path: Optional[str] = None,
    texture_mode: str = "procedural_fallback",
    animation_mode: str = "procedural_clinical_idle_conversation_posture_fallback",
    optimization_mode: str = "unoptimized_post_blender_glb",
    realism_grade: str = "B",
    promotion_status: str = "runtime_candidate_not_realism_gate_pass",
    claim_scope: Optional[str] = None,
    promotion_gates: Optional[bool] = None,
    output_sha256: Optional[str] = None,
    output_bytes: Optional[int] = None,
    generated_at: Optional[str] = None,
    method: Optional[str] = None,
    base_obj: Optional[str] = None,
    garment_layers: Optional[Sequence[str]] = None,
    tool_version: Optional[str] = None,
    # orchestrate-only extras
    source_origin_chain_extra: Optional[Mapping[str, Any]] = None,
    optimization_handoff: Optional[Mapping[str, Any]] = None,
    # rebake-only extras
    source_topology_mode: str = "real_anny_mpfb2_forward_pass_v1",
    garment_authoring_class: str = "body_surface_normal_offset_issue_121",
    extra_fields: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Pure builder: returns provenance dict; does not touch the filesystem."""
    if derivation_mode not in (DERIVATION_MODE_ORCHESTRATE, DERIVATION_MODE_BLENDER_ONLY_REBAKE):
        raise ValueError(
            f"Unknown derivation_mode={derivation_mode!r}; "
            f"expected {DERIVATION_MODE_ORCHESTRATE!r} or {DERIVATION_MODE_BLENDER_ONLY_REBAKE!r}"
        )

    params_hash = stable_params_hash(params_for_hash)

    if derivation_mode == DERIVATION_MODE_ORCHESTRATE:
        chains = build_orchestrate_chains(
            case_id=scenario_id,
            actor_id=actor_id,
            actor_role=actor_role,
            params_hash=params_hash,
            uses_real_anny_forward_pass=uses_real_anny_forward_pass,
            source_origin_chain=source_origin_chain_extra or {},
        )
        resolved_tool = tool_version or (
            TOOL_VERSION_ORCHESTRATE_REAL if uses_real_anny_forward_pass else TOOL_VERSION_ORCHESTRATE_STUB
        )
    else:
        if not base_obj:
            raise ValueError("blender_only_rebake requires base_obj")
        chains = build_blender_only_rebake_chains(
            case_id=scenario_id,
            actor_id=actor_id,
            actor_role=actor_role,
            base_obj=base_obj,
            params_hash=params_hash,
            source_topology_mode=source_topology_mode,
            garment_authoring_class=garment_authoring_class,
        )
        resolved_tool = tool_version or TOOL_VERSION_BLENDER_ONLY_REBAKE

    doc: Dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "derivationMode": derivation_mode,
        "scenarioId": scenario_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "assetPath": asset_path,
        "riggingReportPath": rigging_report_path,
        "sourceManifestPath": source_manifest_path,
        "generatorMode": generator_mode,
        "sourceKind": source_kind,
        "usesRealAnnyForwardPass": uses_real_anny_forward_pass,
        "realAnnyWeightsUsed": real_anny_weights_used,
        "textureMode": texture_mode,
        "animationMode": animation_mode,
        "optimizationMode": optimization_mode,
        "realismGrade": realism_grade,
        "promotionStatus": promotion_status,
        "sourceOriginChain": chains["sourceOriginChain"],
        "licenseChain": chains["licenseChain"],
        "derivativeLineage": chains["derivativeLineage"],
        "toolVersion": resolved_tool,
        "promptOrCaseParameterHash": params_hash,
        "notEvidenceFor": list(not_evidence_for),
        "sourceNotes": list(source_notes),
    }

    if optimization_handoff is not None:
        doc["optimizationHandoff"] = dict(optimization_handoff)
    if claim_scope is not None:
        doc["claimScope"] = claim_scope
    if promotion_gates is not None:
        doc["promotionGates"] = promotion_gates
    if output_sha256 is not None:
        doc["outputSha256"] = output_sha256
    if output_bytes is not None:
        doc["outputBytes"] = output_bytes
    if generated_at is not None:
        doc["generatedAt"] = generated_at
    if method is not None:
        doc["method"] = method
    if base_obj is not None:
        doc["baseObj"] = base_obj
    if garment_layers is not None:
        doc["garmentLayers"] = list(garment_layers)
    if extra_fields:
        for key, value in extra_fields.items():
            if key not in doc:
                doc[key] = value

    return doc


def write_provenance_document(path: PathLike, document: Mapping[str, Any]) -> str:
    """Write provenance JSON to disk. Returns the path string."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dict(document), indent=2) + "\n", encoding="utf-8")
    return str(out)


def write_blender_only_rebake_provenance(
    *,
    output_glb: PathLike,
    case_id: str,
    actor_id: str,
    actor_role: str,
    base_obj: str,
    garment_layers: Sequence[str],
    report_path: Optional[PathLike] = None,
    repo_root: Optional[PathLike] = None,
    generated_at: Optional[str] = None,
) -> str:
    """Convenience used by ``rebake_role_wardrobe_blender_only.py``."""
    root = Path(repo_root) if repo_root else Path(__file__).resolve().parents[4]
    glb = Path(output_glb)
    if not glb.is_absolute():
        glb = root / glb
    report = Path(report_path) if report_path else None
    if report is not None and not report.is_absolute():
        report = root / report

    def rel(p: Path) -> str:
        try:
            return str(p.relative_to(root))
        except ValueError:
            return str(p)

    params_for_hash = {
        "caseId": case_id,
        "actorId": actor_id,
        "actorRole": actor_role,
        "baseObj": base_obj,
        "garmentLayers": list(garment_layers),
        "method": "blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
        "generatorMode": GENERATOR_MODE_BLENDER_ONLY_REBAKE,
    }
    doc = build_provenance_document(
        derivation_mode=DERIVATION_MODE_BLENDER_ONLY_REBAKE,
        scenario_id=case_id,
        actor_id=actor_id,
        actor_role=actor_role,
        asset_path=rel(glb),
        generator_mode=GENERATOR_MODE_BLENDER_ONLY_REBAKE,
        source_kind="real_anny_candidate_unverified",
        uses_real_anny_forward_pass=True,
        real_anny_weights_used=False,
        not_evidence_for=[
            "b_plus_visual_realism_gate",
            "quest_readiness",
            "production_asset_readiness",
            "learner_readiness",
            "clinical_validity",
            "scoring_validity",
            "scene_placement_readiness",
        ],
        source_notes=[
            "Issue #96/#94: Blender-only re-bake on tracked .anny_base.obj (anny package not importable).",
            f"Base {base_obj}; garmentLayers={list(garment_layers)}.",
            "Not full orchestrate_character (would emit ~0.8 MB stubs without anny).",
            "Not B+ realism / production / clinical readiness.",
            "Issue #142: licence/derivative chains are mode-tagged inherited_from_base_not_reverified — not an orchestrate licence fiction.",
        ],
        params_for_hash=params_for_hash,
        rigging_report_path=rel(report) if report is not None and report.is_file() else None,
        source_manifest_path=rel(glb.with_suffix(".anny_manifest.json")),
        claim_scope="local_role_distinct_wardrobe_rebake_not_readiness",
        promotion_gates=False,
        output_sha256=sha256_file(glb) if glb.is_file() else None,
        output_bytes=glb.stat().st_size if glb.is_file() else None,
        generated_at=generated_at or datetime.now(timezone.utc).isoformat(),
        method="blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
        base_obj=base_obj,
        garment_layers=list(garment_layers),
    )
    return write_provenance_document(glb.with_suffix(".provenance.json"), doc)


def _self_test(tmpdir: Path) -> None:
    """Pure-function self-test: write both modes to temp, read back, assert keys + mode."""
    rebake_doc = build_provenance_document(
        derivation_mode=DERIVATION_MODE_BLENDER_ONLY_REBAKE,
        scenario_id="case_test",
        actor_id="actor_test",
        actor_role="patient",
        asset_path="apps/ui-xr/public/generated-humanoids/test.glb",
        generator_mode=GENERATOR_MODE_BLENDER_ONLY_REBAKE,
        source_kind="real_anny_candidate_unverified",
        uses_real_anny_forward_pass=True,
        real_anny_weights_used=False,
        not_evidence_for=["b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness"],
        source_notes=["self-test"],
        params_for_hash={"caseId": "case_test", "baseObj": "base.obj", "garmentLayers": ["gown"]},
        base_obj="apps/ui-xr/public/generated-humanoids/base.anny_base.obj",
        garment_layers=["hospital_gown"],
        output_sha256="a" * 64,
        output_bytes=1_500_000,
        generated_at="2026-08-07T00:00:00+00:00",
        method="blender_stage_on_existing_real_anny_base_obj_role_wardrobe",
    )
    rebake_path = tmpdir / "rebake.provenance.json"
    write_provenance_document(rebake_path, rebake_doc)
    loaded = json.loads(rebake_path.read_text())
    assert loaded["derivationMode"] == DERIVATION_MODE_BLENDER_ONLY_REBAKE
    assert loaded["generatorMode"] == GENERATOR_MODE_BLENDER_ONLY_REBAKE
    assert isinstance(loaded["sourceOriginChain"], dict)
    assert isinstance(loaded["licenseChain"], dict)
    assert loaded["licenseChain"]["status"] == "inherited_from_base_not_reverified"
    assert "annyCode" not in loaded["licenseChain"], "rebake must not manufacture orchestrate licence keys"
    assert isinstance(loaded["derivativeLineage"], dict)
    assert loaded["derivativeLineage"]["status"] == "wardrobe_rebake_derivative"
    assert isinstance(loaded["toolVersion"], str) and loaded["toolVersion"]
    assert isinstance(loaded["promptOrCaseParameterHash"], str)
    assert len(loaded["promptOrCaseParameterHash"]) == 64
    assert "anny_forward_pass" in loaded["licenseChain"]["notRun"]

    orch_doc = build_provenance_document(
        derivation_mode=DERIVATION_MODE_ORCHESTRATE,
        scenario_id="case_test",
        actor_id="actor_test",
        actor_role="patient",
        asset_path="apps/ui-xr/public/generated-humanoids/test.glb",
        generator_mode=GENERATOR_MODE_ORCHESTRATE_REAL,
        source_kind="real_anny_candidate_unverified",
        uses_real_anny_forward_pass=True,
        real_anny_weights_used=False,
        not_evidence_for=["b_plus_visual_realism_gate", "quest_readiness", "production_asset_readiness"],
        source_notes=["self-test orchestrate"],
        params_for_hash={"seed": 1, "actor_id": "actor_test"},
        source_origin_chain_extra={
            "sourceRecordPath": SOURCE_RECORD_PATH,
            "meshStage": "generate_mesh.py",
            "blenderStage": "automate_blender.py",
            "orchestrator": "orchestrate_character.py",
        },
    )
    orch_path = tmpdir / "orchestrate.provenance.json"
    write_provenance_document(orch_path, orch_doc)
    orch_loaded = json.loads(orch_path.read_text())
    assert orch_loaded["derivationMode"] == DERIVATION_MODE_ORCHESTRATE
    assert "annyCode" in orch_loaded["licenseChain"]
    assert orch_loaded["licenseChain"]["status"] == "enumerated_from_source_record_at_orchestrate"
    assert orch_loaded["derivativeLineage"]["status"] == "orchestrate_derivative"
    print("humanoid_provenance self-test OK")


if __name__ == "__main__":
    import sys
    import tempfile

    if len(sys.argv) > 1 and sys.argv[1] == "self-test":
        with tempfile.TemporaryDirectory(prefix="openclinxr-prov-") as td:
            _self_test(Path(td))
        sys.exit(0)
    print("Usage: humanoid_provenance.py self-test", file=sys.stderr)
    sys.exit(2)

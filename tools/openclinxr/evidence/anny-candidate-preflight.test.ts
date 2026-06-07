import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAnnyCandidatePreflightReport,
  validateAnnyCandidatePreflightReport,
} from "./anny-candidate-preflight.js";

describe("Anny candidate preflight", () => {
  it("exposes package scripts for preflight generation and validation", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(rootPackage.scripts["asset:anny-candidate:preflight"]).toBe("tsx tools/openclinxr/evidence/anny-candidate-preflight.ts");
    expect(rootPackage.scripts["asset:anny-candidate:validate"]).toBe("tsx tools/openclinxr/evidence/anny-candidate-preflight.ts --validate-latest");
  });

  it("inspects current peds Anny-compatible candidates without runtime promotion", async () => {
    const report = await buildAnnyCandidatePreflightReport({
      generatedAt: "2026-06-05T04:30:00.000Z",
    });

    expect(report).toMatchObject({
      schemaVersion: "openclinxr.anny-candidate-preflight.v1",
      claimScope: "anny_candidate_preflight_metadata_and_structural_only",
      providerBoundary: {
        providerId: "anny_local_or_anny_compatible_import",
        policyMode: "local_metadata_and_structural_inspection_only",
        executionEnabled: false,
        localOnly: true,
        externalProviderExecutionAttempted: false,
        externalNetworkUsed: false,
        paidApiUsed: false,
      },
      advisoryReview: {
        moonbridgeDeepSeekFirstPass: "useful_policy_contract_reviewer",
        grade: "B",
        score: 0.8,
      },
      decision: {
        status: "metadata_review_ready",
        currentFallbacksRemainActive: true,
        runtimePromotionAllowed: false,
      },
      notEvidenceFor: [
        "b_plus_visual_realism_gate",
        "provider_runtime_readiness",
        "generated_asset_quality",
        "production_asset_readiness",
        "quest_readiness",
        "learner_readiness",
        "clinical_validity",
        "scoring_validity",
      ],
    });
    expect(report.candidates.map((candidate) => candidate.actorMapping.actorId)).toEqual([
      "patient_maya_johnson_v1",
      "parent_tara_johnson_v1",
      "nurse_kevin_lee_v1",
    ]);
    for (const candidate of report.candidates) {
      expect(candidate.source.usesRealAnnyForwardPass).toBe(true);
      expect(candidate.source.sourceKind).toBe("real_anny_candidate_unverified");
      expect(candidate.source.realAnnyWeightsUsed).toBe(false);
      expect(candidate.source.executionEnabled).toBe(false);
      expect(candidate.roleNormalization.aliasPolicy).toBe("case_definition_role_alias_map");
      expect(candidate.roleNormalization.aliasAccepted).toBe(true);
      expect(candidate.glb.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(candidate.provenance.documentSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(candidate.provenance.sourceOriginChainPresent).toBe(true);
      expect(candidate.provenance.licenseChainPresent).toBe(true);
      expect(candidate.provenance.derivativeLineagePresent).toBe(true);
      expect(candidate.provenance.notEvidenceFor).not.toContain("real_anny_model_output");
      expect(candidate.provenance.notEvidenceFor).toContain("b_plus_visual_realism_gate");
      expect(candidate.rigControlEvidence.requiredMorphTargets).toEqual([
        "openclinxr_mouth_open",
        "openclinxr_brow_concern",
        "openclinxr_cheek_tension",
      ]);
      expect(candidate.rigControlEvidence.requiredMorphTargetsPresent).toBe(true);
      expect(candidate.rigControlEvidence.missingMorphTargets).toEqual([]);
      expect(candidate.rigControlEvidence.observedMorphTargets).toEqual(expect.arrayContaining([
        "openclinxr_mouth_open",
        "openclinxr_brow_concern",
        "openclinxr_cheek_tension",
      ]));
      expect(candidate.status).toBe("ready_for_webxr_visual_evidence");
      expect(candidate.blockers).toEqual([]);
      expect(candidate.rigControlEvidence.faceRigNodesPresent).toBe(true);
      expect(candidate.rigControlEvidence.gazeEyeNodesPresent).toBe(true);
      expect(candidate.rigControlEvidence.blinkControlPresent).toBe(true);
      expect(candidate.rigControlEvidence.locomotionPostureClipPresent).toBe(true);
      expect(candidate.glb.animationCount).toBeGreaterThan(0);
      expect(candidate.glb.clinicalIdlePoseClipCount).toBeGreaterThan(0);
      expect(candidate.quarantine.runtimeBundlePromotionAllowed).toBe(false);
      expect(candidate.nextEvidenceRequired).toContain("license_provenance_chain_review_with_source_origin_derivative_lineage_and_document_hash");
      expect(candidate.nextEvidenceRequired).toContain("canonical_rig_expression_gaze_blink_and_locomotion_clip_evidence");
      expect(candidate.nextEvidenceRequired).toContain("webxr_only_actor_closeup_screenshot");
    }
    expect(report.candidates.map((candidate) => candidate.roleNormalization.sourceActorRole)).toEqual([
      "patient",
      "parent",
      "nurse",
    ]);
    expect(validateAnnyCandidatePreflightReport(report)).toEqual({ ok: true });
  });

  it("rejects reports that enable execution or runtime promotion", async () => {
    const report = await buildAnnyCandidatePreflightReport();
    report.providerBoundary.executionEnabled = true as never;
    report.providerBoundary.externalNetworkUsed = true as never;
    report.candidates[0]!.roleNormalization.aliasAccepted = false;
    report.candidates[0]!.provenance.documentSha256 = "not-a-sha";
    report.candidates[0]!.source.executionEnabled = true as never;
    report.candidates[0]!.rigControlEvidence.requiredMorphTargets = [];
    report.candidates[0]!.quarantine.runtimeBundlePromotionAllowed = true as never;
    report.decision.runtimePromotionAllowed = true as never;
    report.notEvidenceFor = report.notEvidenceFor.filter((gate) => gate !== "clinical_validity") as never;

    expect(validateAnnyCandidatePreflightReport(report)).toEqual({
      ok: false,
      errors: expect.arrayContaining([
        "/providerBoundary/executionEnabled must be false",
        "/providerBoundary/externalNetworkUsed must be false",
        "/candidates/0/provenance/documentSha256 must be sha256 hex",
        "/candidates/0/roleNormalization/aliasAccepted must be true",
        "/candidates/0/source/executionEnabled must be false",
        "/candidates/0/rigControlEvidence/requiredMorphTargets must include openclinxr_mouth_open",
        "/candidates/0/rigControlEvidence/requiredMorphTargets must include openclinxr_brow_concern",
        "/candidates/0/rigControlEvidence/requiredMorphTargets must include openclinxr_cheek_tension",
        "/candidates/0/quarantine/runtimeBundlePromotionAllowed must be false",
        "/decision/runtimePromotionAllowed must be false",
        "/notEvidenceFor must include clinical_validity",
      ]),
    });
  });

  it("consumes local candidate bundle sidecars without promoting readiness", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-anny-bundle-"));
    const bundlePath = path.join(tempDir, "peds_patient_child.bundle.json");
    const objPath = path.join(tempDir, "peds_patient_child.anny_base.obj");
    const sourceManifestPath = path.join(tempDir, "peds_patient_child.anny_manifest.json");
    const riggingReportPath = path.join(tempDir, "peds_patient_child_rigging_report.json");
    try {
      await writeFile(objPath, "o peds_patient_child\nv 0 0 0\n", "utf8");
      await writeFile(sourceManifestPath, JSON.stringify({ vertices: 128, faces: 152 }), "utf8");
      await writeFile(riggingReportPath, JSON.stringify({
        morphTargetCount: 25,
        animationClipCount: 4,
        roleVisualMarkers: {
          status: "abandoned_rejected_experiment",
          rejectedApproach: "visible_bounds_based_role_clothing_cube_markers",
          actorRole: "patient",
          roleVisualCue: "pediatric_patient",
          clothingStyle: "pediatric_soft_blue_exam_tshirt",
          objectNames: [],
          claimScope: "visible_role_clothing_cube_markers_disabled_not_realism_evidence",
          notEvidenceFor: ["production_asset_readiness", "b_plus_visual_realism_gate"],
        },
        roleClothingMaterialRegions: {
          meshRegionMaterialMode: "bounds_based_role_clothing_material_assignment",
          topMaterialName: "openclinxr_role_mesh_clothing_patient_top",
          lowerMaterialName: "openclinxr_role_mesh_clothing_patient_lower",
          topFaceCount: 2474,
          lowerFaceCount: 1042,
          claimScope: "procedural_bounds_based_clothing_material_regions_not_production_wardrobe",
          notEvidenceFor: ["production_asset_readiness", "b_plus_visual_realism_gate"],
        },
        wardrobeTags: {
          wardrobeRole: "patient_casual_child",
          garmentLayers: ["short_sleeve_exam_tshirt"],
          fabricPalette: "soft_blue_and_warm_white",
          materialFinish: "cotton_matte",
        },
        accessoryPresence: {
          markers: [],
          generatedObjects: [],
        },
        faceDetailMarkers: {
          status: "abandoned_rejected_experiment",
          rejectedApproach: "manual_bounds_based_hair_eye_and_face_marker_geometry",
          reason: "Visual review rejected the procedural hair cap, eye spheres, brow bars, nose marker, and mouth marker as visibly awful and counterproductive for Anny realism.",
          nextSafeStep: "Use a real humanoid source-quality path for hair, eyes, and facial topology.",
          claimScope: "manual_face_hair_markers_disabled_not_realism_evidence",
          notEvidenceFor: ["b_plus_visual_realism_gate", "production_asset_readiness", "clinical_validity", "scoring_validity"],
        },
      }), "utf8");
      await writeFile(bundlePath, `${JSON.stringify({
        schemaVersion: "openclinxr.anny-local-candidate-bundle.v1",
        claimScope: "local_anny_compatible_candidate_bundle_not_real_anny_or_readiness",
        scenarioId: "peds_asthma_parent_anxiety_v1",
        actorId: "patient_maya_johnson_v1",
        actorRole: "patient",
        outputs: {
          objPath,
          sourceManifestPath,
          glbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
          riggingReportPath,
          provenancePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
        },
        generation: {
          generatorMode: "anny_compatible_stub_plus_blender_procedural",
          realAnnyWeightsUsed: false,
          useComfy: false,
          seed: 1001,
          paramsHash: "d3b2d99f7e78224bbd3443ab4a93b125d5d587851c8e8c8503de6d98adcb9e1c",
        },
        providerExecution: {
          cloudProviderUsed: false,
          paidApiUsed: false,
          modelDownloadUsed: false,
          comfyUsed: false,
        },
        gates: {
          realAnnyModelOutput: false,
          bPlusVisualRealismGate: false,
          scenePlacementReadiness: false,
          questReadiness: false,
          productionReadiness: false,
          learnerReadiness: false,
          clinicalValidity: false,
          scoringValidity: false,
        },
        notEvidenceFor: [
          "real_anny_model_output",
          "b_plus_visual_realism_gate",
          "scene_placement_readiness",
          "quest_readiness",
          "production_asset_readiness",
          "learner_readiness",
          "clinical_validity",
          "scoring_validity",
        ],
      }, null, 2)}\n`, "utf8");

      const report = await buildAnnyCandidatePreflightReport({
        generatedAt: "2026-06-05T21:30:00.000Z",
        localCandidateBundlePaths: [bundlePath],
      });
      const patient = report.candidates.find((candidate) => candidate.actorMapping.actorId === "patient_maya_johnson_v1");

      expect(patient).toMatchObject({
        paths: {
          sourceGlbPath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.glb",
          provenancePath: "apps/ui-xr/public/generated-humanoids/peds_patient_child.provenance.json",
          localCandidateBundlePath: bundlePath,
        },
        localCandidateBundle: {
          schemaVersion: "openclinxr.anny-local-candidate-bundle.v1",
          claimScope: "local_anny_compatible_candidate_bundle_not_real_anny_or_readiness",
          bundlePath,
          generation: {
            realAnnyWeightsUsed: false,
            useComfy: false,
            seed: 1001,
          },
          providerExecution: {
            cloudProviderUsed: false,
            paidApiUsed: false,
            modelDownloadUsed: false,
            comfyUsed: false,
          },
          gates: {
            realAnnyModelOutput: false,
            bPlusVisualRealismGate: false,
            scenePlacementReadiness: false,
            questReadiness: false,
            productionReadiness: false,
            learnerReadiness: false,
            clinicalValidity: false,
            scoringValidity: false,
          },
          outputEvidence: {
            allOutputsPresent: true,
          },
        },
        source: {
          realAnnyWeightsUsed: false,
          executionEnabled: false,
          externalNetworkUsed: false,
          paidApiUsed: false,
        },
        quarantine: {
          runtimeBundlePromotionAllowed: false,
          productionManifestPromotionAllowed: false,
        },
      });
      expect(patient?.localCandidateBundle?.outputEvidence.glbSha256).toBe(patient?.glb.sha256);
      expect(patient?.localCandidateBundle?.roleMaterialHandoff).toMatchObject({
        wardrobeRole: "patient_casual_child",
        roleVisualCue: "pediatric_patient",
        clothingStyle: "pediatric_soft_blue_exam_tshirt",
        objectNames: [],
        generatedAccessoryObjects: [],
        meshRegionMaterialMode: "bounds_based_role_clothing_material_assignment",
        topMaterialName: "openclinxr_role_mesh_clothing_patient_top",
        lowerMaterialName: "openclinxr_role_mesh_clothing_patient_lower",
        topFaceCount: 2474,
        lowerFaceCount: 1042,
        claimScope: "visible_role_clothing_cube_markers_disabled_not_realism_evidence",
        notEvidenceFor: expect.arrayContaining(["production_asset_readiness"]),
      });
      expect(patient?.localCandidateBundle?.proceduralFaceDetailHandoff).toBeUndefined();
      expect(patient?.localCandidateBundle?.notEvidenceFor).toContain("clinical_validity");
      expect(validateAnnyCandidatePreflightReport(report)).toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates checked-in report shape from disk-compatible JSON", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-anny-preflight-"));
    const reportPath = path.join(tempDir, "anny-candidate-preflight.json");
    try {
      await writeFile(reportPath, `${JSON.stringify(await buildAnnyCandidatePreflightReport(), null, 2)}\n`, "utf8");
      await expect(readFile(reportPath, "utf8").then(JSON.parse).then(validateAnnyCandidatePreflightReport)).resolves.toEqual({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

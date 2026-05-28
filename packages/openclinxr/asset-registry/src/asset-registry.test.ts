import { edChestPainScenario, pediatricAsthmaScenario, scenarioBank } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  type AssetManifest,
  buildAssetProductionReviewPacket,
  buildEncounterAssetNeedsReadinessManifest,
  buildEncounterDynamicBehaviorCoverageSummary,
  buildEncounterFactoryDryRunSummary,
  buildEncounterRuntimeAssetBundle,
  buildEncounterRuntimeBundlePublicationMetadata,
  buildEnvironmentGenerationPacket,
  buildEnvironmentGenerationQueue,
  buildEnvironmentGenerationWorkOrder,
  buildEnvironmentGenerationWorkOrderQueue,
  buildScenarioSceneGenerationPipelineWorkOrder,
  buildScenarioSceneGenerationPipelineWorkOrderQueue,
  createEdChestPainLocalAssetEvidenceFixtureManifests,
  createEdChestPainLocalEncounterRuntimeAssetBundle,
  createEdChestPainLocalLearnerRuntimeAssetBundle,
  createEdChestPainPlaceholderManifests,
  createScenarioPlaceholderManifests,
  evaluateAssetManifest,
  evaluateAssetPipelineTool,
  evaluateAssetPipelineToolMatrix,
  evaluateAssetProductionReadinessLadder,
  evaluateEncounterRuntimeLearnerUseGate,
  evaluateScenarioGenerationEvidence,
  evaluateScenarioOptimizationEvidence,
  findRuntimeActorAsset,
  findRuntimeEquipmentAsset,
  type HumanoidRealismMetadata,
  InMemoryAssetRegistry,
  promoteEncounterRuntimeAssetBundleForLocalUse,
  recommendedAssetPipelineTools,
  registerGeneratedRuntimeAssetReference,
  resolveRuntimeAssetBlobUrl,
  resolveRuntimeAssetStoreConfig,
  resolveRuntimeAssetUrl,
  selectAssetPipelineToolsForLane,
  toLearnerRuntimeAssetBundle,
  validateAssetManifestStructure,
} from "./index.js";

function requireManifest(manifests: AssetManifest[], index: number): AssetManifest {
  const manifest = manifests[index];
  if (!manifest) {
    throw new Error(`Missing test asset manifest at index ${index}`);
  }
  return manifest;
}

const edChestPainRequiredAssetIds = [
  "patient_robert_hayes_character",
  "nurse_maria_alvarez_character",
  "spouse_anna_hayes_character",
  "ed_exam_bay_environment",
  "12_lead_ecg_machine_equipment",
  "bedside_monitor_equipment",
  "stretcher_equipment",
  "iv_pole_equipment",
  "oxygen_nasal_cannula_equipment",
  "wall_clock_equipment",
];

const edChestPainCharacterAssetIds = [
  "patient_robert_hayes_character",
  "nurse_maria_alvarez_character",
  "spouse_anna_hayes_character",
];

const edChestPainEquipmentAssetIds = [
  "12_lead_ecg_machine_equipment",
  "bedside_monitor_equipment",
  "stretcher_equipment",
  "iv_pole_equipment",
  "oxygen_nasal_cannula_equipment",
  "wall_clock_equipment",
];

describe("asset registry", () => {
  it("marks approved Quest-budgeted placeholder assets as dev ready but not production ready", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const readiness = evaluateAssetManifest(patient);

    expect(readiness).toEqual({
      assetId: "patient_robert_hayes_character",
      devReady: true,
      productionReady: false,
      blockers: [],
      productionBlockers: ["placeholder_asset_not_clinical_release_ready"],
      warnings: [],
    });
  });

  it("blocks assets with copyleft or unknown license posture", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const readiness = evaluateAssetManifest({
      ...patient,
      assetId: "blocked_patient_mesh",
      provenance: {
        ...patient.provenance,
        licenseStatus: "copyleft_blocked",
        sourceRefs: ["agpl-character-generator"],
      },
    });

    expect(readiness.productionReady).toBe(false);
    expect(readiness.blockers).toContain("license_copyleft_blocked");

    const unknownReadiness = evaluateAssetManifest({
      ...patient,
      assetId: "unknown_patient_mesh",
      provenance: {
        ...patient.provenance,
        licenseStatus: "unknown",
        sourceRefs: ["unreviewed-character-source"],
      },
    });
    expect(unknownReadiness.productionReady).toBe(false);
    expect(unknownReadiness.blockers).toContain("license_unknown");
  });

  it("requires license, optimization target, and explicit Quest QA status", () => {
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);

    const missingLicenseReadiness = evaluateAssetManifest({
      ...patient,
      provenance: {
        ...patient.provenance,
        licenseStatus: undefined as unknown as AssetManifest["provenance"]["licenseStatus"],
      },
    });
    expect(missingLicenseReadiness.blockers).toContain("license_status_missing");

    const missingProvenanceReadiness = evaluateAssetManifest({
      ...patient,
      provenance: undefined as unknown as AssetManifest["provenance"],
    });
    expect(missingProvenanceReadiness.blockers).toContain("license_status_missing");

    const missingOptimizationReadiness = evaluateAssetManifest({
      ...patient,
      geometryBudget: undefined as unknown as AssetManifest["geometryBudget"],
    });
    expect(missingOptimizationReadiness.blockers).toContain("optimization_target_missing");

    const missingQuestQaReadiness = evaluateAssetManifest({
      ...patient,
      questQaStatus: undefined as unknown as AssetManifest["questQaStatus"],
    });
    expect(missingQuestQaReadiness.blockers).toContain("quest_qa_status_missing");
    expect(missingQuestQaReadiness.blockers).toContain("placeholder_quest_qa_status_missing");
  });

  it("rejects structurally invalid manifests before registry upsert", () => {
    const registry = new InMemoryAssetRegistry();
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    const invalidManifest = {
      ...patient,
      provenance: {
        generationMethod: patient.provenance.generationMethod,
        sourceRefs: patient.provenance.sourceRefs,
      },
    };

    expect(validateAssetManifestStructure(invalidManifest).ok).toBe(false);
    expect(() => registry.upsert(invalidManifest as AssetManifest)).toThrow("Invalid asset manifest patient_robert_hayes_character");
  });

  it("evaluates all required ED chest pain asset needs before scenario runtime use", () => {
    const registry = new InMemoryAssetRegistry();
    for (const manifest of createEdChestPainPlaceholderManifests()) {
      registry.upsert(manifest);
    }

    const readiness = registry.evaluateScenarioReadiness(edChestPainScenario);

    expect(readiness.scenarioId).toBe("ed_chest_pain_priority_v1");
    expect(readiness.devReady).toBe(true);
    expect(readiness.productionReady).toBe(false);
    expect(readiness.missingRequiredAssetIds).toEqual([]);
    expect(readiness.blockedAssets).toEqual([]);
    expect(readiness.productionBlockedAssets).toEqual(edChestPainRequiredAssetIds.map((assetId) => ({
      assetId,
      blockers: ["placeholder_asset_not_clinical_release_ready"],
    })));
  });

  it("deduplicates repeated scenario asset needs before readiness and budget evaluation", () => {
    const registry = new InMemoryAssetRegistry();
    for (const manifest of createEdChestPainPlaceholderManifests()) {
      registry.upsert(manifest);
    }
    const repeatedNeed = edChestPainScenario.assetNeeds?.[0];
    if (!repeatedNeed) {
      throw new Error("Expected ED asset need");
    }

    const readiness = registry.evaluateScenarioReadiness({
      ...edChestPainScenario,
      assetNeeds: [...(edChestPainScenario.assetNeeds ?? []), repeatedNeed],
    });

    expect(readiness.productionBlockedAssets.map((asset) => asset.assetId)).toEqual(edChestPainRequiredAssetIds);
  });

  it("creates the ED chest pain room, equipment, patient, spouse, and nurse placeholder records", () => {
    expect(createEdChestPainPlaceholderManifests().map((manifest) => manifest.assetId)).toEqual(edChestPainRequiredAssetIds);
  });

  it("lists scenario assets deterministically by asset ID", () => {
    const registry = new InMemoryAssetRegistry();
    const manifests = createEdChestPainPlaceholderManifests();
    for (const manifest of [requireManifest(manifests, 1), requireManifest(manifests, 0), requireManifest(manifests, 2)]) {
      registry.upsert(manifest);
    }

    expect(registry.listByScenario("ed_chest_pain_priority_v1").map((manifest) => manifest.assetId)).toEqual([
      "nurse_maria_alvarez_character",
      "patient_robert_hayes_character",
      "spouse_anna_hayes_character",
    ]);
  });

  it("keeps stored manifests immutable from caller mutation", () => {
    const registry = new InMemoryAssetRegistry();
    const patient = requireManifest(createEdChestPainPlaceholderManifests(), 0);
    registry.upsert(patient);

    patient.displayName = "Mutated input";
    const stored = registry.get("patient_robert_hayes_character");
    if (!stored) {
      throw new Error("Expected stored patient manifest");
    }
    stored.displayName = "Mutated return";

    expect(registry.get("patient_robert_hayes_character")?.displayName).toBe("Robert Hayes patient character");
  });

  it("reports missing or not-QA-ready assets as blockers", () => {
    const registry = new InMemoryAssetRegistry();
    const manifests = createEdChestPainPlaceholderManifests();
    const patient = requireManifest(manifests, 0);
    const nurse = requireManifest(manifests, 1);
    registry.upsert(patient);
    registry.upsert({
      ...nurse,
      assetId: "nurse_maria_alvarez_character",
      pipelineStages: nurse.pipelineStages.filter((stage) => stage.stage !== "qa_ready"),
    });

    const readiness = registry.evaluateScenarioReadiness(edChestPainScenario);

    expect(readiness.productionReady).toBe(false);
    expect(readiness.devReady).toBe(false);
    expect(readiness.missingRequiredAssetIds).toEqual([
      "spouse_anna_hayes_character",
      "ed_exam_bay_environment",
      ...edChestPainEquipmentAssetIds,
    ]);
    expect(readiness.blockedAssets).toEqual([
      {
        assetId: "nurse_maria_alvarez_character",
        blockers: ["missing_qa_ready_stage"],
      },
    ]);
  });

  it("blocks scenario readiness when aggregate Quest station budgets are exceeded", () => {
    const registry = new InMemoryAssetRegistry();
    const baseManifests = createEdChestPainPlaceholderManifests()
      .slice(0, 3)
      .map((manifest) => ({
        ...manifest,
        geometryBudget: {
          ...manifest.geometryBudget,
          maxTriangles: 80000,
        },
      }));
    const extraActor: AssetManifest = {
      ...requireManifest(baseManifests, 0),
      assetId: "spouse_anna_hayes_character",
      displayName: "Anna Hayes spouse character",
      description: "Additional family member actor for interruption and emotional-pressure testing.",
      tags: ["family", "interruption"],
    };

    for (const manifest of [...baseManifests, extraActor]) {
      registry.upsert(manifest);
    }

    const readiness = registry.evaluateScenarioReadiness({
      ...edChestPainScenario,
      assetNeeds: [...baseManifests, extraActor].map((manifest) => ({
        assetId: manifest.assetId,
        assetType: manifest.kind,
        description: manifest.description,
        licenseStatus: "placeholder-approved",
      })),
    });

    expect(readiness.devReady).toBe(false);
    expect(readiness.stationBudget).toEqual({
      maxVisibleTriangles: 180000,
      maxTextureMegabytes: 512,
      maxDrawCalls: 120,
      totalTriangles: 240000,
      totalTextureMegabytes: 72,
      totalDrawCalls: 24,
      blockers: ["station_triangle_budget_exceeded"],
    });
  });

  it("derives scenario optimization evidence from manifest-level slots", () => {
    const placeholderEvidence = evaluateScenarioOptimizationEvidence(createEdChestPainPlaceholderManifests());

    expect(placeholderEvidence).toEqual({
      lodTiersObserved: false,
      textureCompressionBudgetObserved: false,
      colliderSimplificationObserved: false,
      placeholderOnly: true,
      blockers: [
        "lod_tiers_missing",
        "texture_compression_budget_missing",
        "collider_simplification_report_missing",
      ],
    });
  });

  it("derives scenario generation evidence from manifest-level slots", () => {
    const placeholderEvidence = evaluateScenarioGenerationEvidence(createEdChestPainPlaceholderManifests());

    expect(placeholderEvidence).toEqual({
      generatedHumanRiggingObserved: false,
      skinClothingProvenanceObserved: false,
      medicalEquipmentLibraryObserved: false,
      animationRetargetingObserved: false,
      placeholderOnly: true,
      blockers: [
        "generated_human_rigging_missing",
        "skin_clothing_provenance_missing",
        "medical_equipment_library_missing",
        "animation_retargeting_missing",
      ],
    });

    const productionManifests = createEdChestPainPlaceholderManifests().map((manifest) => ({
      ...manifest,
      provenance: {
        ...manifest.provenance,
        generationMethod: manifest.kind === "environment" ? "manual_modeling" as const : "anny" as const,
        sourceRefs: [`${manifest.assetId}_reviewed_generation_source`],
        licenseStatus: "approved" as const,
      },
      generationEvidence: {
        ...(manifest.kind === "character" ? {
          generatedHumanRiggingReportId: `${manifest.assetId}_rig_report`,
          skinClothingProvenanceId: `${manifest.assetId}_skin_clothing_manifest`,
          animationRetargetingReportId: `${manifest.assetId}_animation_retarget_report`,
        } : {}),
        ...(manifest.kind === "environment" || manifest.kind === "equipment" ? {
          medicalEquipmentLibraryRecordId: `${manifest.assetId}_equipment_library_record`,
        } : {}),
      },
      pipelineStages: manifest.pipelineStages.map((stage) => ({
        ...stage,
        notes: `Reviewed production ${stage.stage} evidence for ${manifest.assetId}.`,
      })),
    }));

    expect(evaluateScenarioGenerationEvidence(productionManifests)).toEqual({
      generatedHumanRiggingObserved: true,
      skinClothingProvenanceObserved: true,
      medicalEquipmentLibraryObserved: true,
      animationRetargetingObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
  });

  it("creates a local ED chest pain evidence fixture with rigging, equipment, LOD, texture, and collider proof slots", () => {
    const fixtureManifests = createEdChestPainLocalAssetEvidenceFixtureManifests();

    expect(fixtureManifests.map((manifest) => manifest.assetId)).toEqual(edChestPainRequiredAssetIds);
    expect(fixtureManifests.every((manifest) => manifest.provenance.licenseStatus === "approved")).toBe(true);
    expect(fixtureManifests.every((manifest) => manifest.provenance.sourceRefs.includes("openclinxr-local-asset-evidence-fixture-2026-05-06"))).toBe(true);
    expect(evaluateScenarioGenerationEvidence(fixtureManifests)).toEqual({
      generatedHumanRiggingObserved: true,
      skinClothingProvenanceObserved: true,
      medicalEquipmentLibraryObserved: true,
      animationRetargetingObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
    expect(evaluateScenarioOptimizationEvidence(fixtureManifests)).toEqual({
      lodTiersObserved: true,
      textureCompressionBudgetObserved: true,
      colliderSimplificationObserved: true,
      placeholderOnly: false,
      blockers: [],
    });
    expect(evaluateAssetManifest(requireManifest(fixtureManifests, 0))).toMatchObject({
      assetId: "patient_robert_hayes_character",
      devReady: true,
      productionReady: false,
      productionBlockers: ["quest_qa_production_limitations_present"],
    });
  });

  it("builds a frozen encounter runtime asset bundle for dynamic XR asset resolution", () => {
    const bundle = createEdChestPainLocalEncounterRuntimeAssetBundle({
      tenantId: "tenant_alpha",
      userId: "learner_1",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
    });

    expect(bundle).toMatchObject({
      bundleId: "exam_run_1:encounter_1:runtime-assets",
      tenantId: "tenant_alpha",
      userId: "learner_1",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
      scenarioId: "ed_chest_pain_priority_v1",
      frozenForEncounter: true,
      assetStoreKind: "app_public_fixture",
    });
    expect(resolveRuntimeAssetUrl(bundle.environment)).toBe("/xr-assets/environment/ed-exam-bay-shell.glb");
    expect(resolveRuntimeAssetUrl(findRuntimeActorAsset(bundle, "patient_robert_hayes_v1")?.model ?? bundle.environment))
      .toBe("/xr-assets/humanoids/neutral-generated-human.glb");
    expect(resolveRuntimeAssetUrl(findRuntimeEquipmentAsset(bundle, "ecg_cart_equipment")?.model ?? bundle.environment))
      .toBe("/xr-assets/medical-equipment/ecg-cart-12-lead.glb");
    expect(bundle.actors.every((actor) => actor.gazeProfile.supportsActorTargets)).toBe(true);
    expect(bundle.sceneManifest).toMatchObject({
      schemaVersion: "openclinxr.runtime-scene-manifest.v1",
      source: "generated_scene_pipeline",
      productionReadinessClaimed: false,
    });
    expect(bundle.sceneManifest.roomProps).toHaveLength(30);
    expect(bundle.sceneManifest.roomProps.every((prop) => prop.generatedBy === "scene_manifest")).toBe(true);
    expect(bundle.sceneManifest.roomProps.map((prop) => prop.propId)).toEqual(expect.arrayContaining([
      "oxygen-panel",
      "monitor-waveform-card",
      "doorway-escalation-badge",
      "call-light-remote",
    ]));
    expect(bundle.evidenceGateRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: "runtime_realism_evidence",
        status: "pending",
        requiredSignalIds: expect.arrayContaining([
          "animated_humanoid_runtime_playback",
          "authored_clinical_idle_pose_runtime_cue",
          "visible_mouth_eye_expression_cues",
          "dialogue_viseme_and_gaze_mapping",
          "emotion_aligned_expression_transition_cue",
        ]),
        blockers: ["runtime_realism_evidence_not_attached_to_encounter_bundle"],
      }),
      expect.objectContaining({
        gateId: "visual_qa_evidence",
        status: "pending",
        requiredSignalIds: expect.arrayContaining(["emotion_expression_transition_readability"]),
        blockers: ["visual_qa_evidence_not_attached_to_encounter_bundle"],
      }),
    ]));
    expect(bundle.notEvidenceFor).toContain("production_asset_readiness");
    expect(bundle.notEvidenceFor).toContain("quest_readiness");
  });

  it("preserves attached evidence gate references on encounter runtime bundles", () => {
    const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
    const roomShell = registerGeneratedRuntimeAssetReference({
      assetId: "generated_ed_room_with_evidence_gate_v1",
      version: "v1",
      kind: "environment_model",
      displayName: "Generated ED room with evidence gate v1",
      scenarioAssetId: "ed_exam_bay_environment",
      blobName: "tenants/local/asset-library/generated_ed_room_with_evidence_gate_v1/v1/model.glb",
      assetStore,
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["environment_generation_report_review_gate_v1"],
    });

    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "exam_run_2:encounter_9:runtime-assets",
      tenantId: "local",
      userId: "learner_2",
      examRunId: "exam_run_2",
      encounterId: "encounter_9",
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStore,
      environment: roomShell,
      actors: [],
      evidenceGateRefs: [{
        gateId: "runtime_realism_evidence",
        status: "attached",
        evidenceRefs: ["docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json"],
        requiredSignalIds: ["animated_humanoid_runtime_playback"],
        blockers: [],
        notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
      }],
    });

    expect(bundle.evidenceGateRefs).toEqual([
      expect.objectContaining({
        gateId: "runtime_realism_evidence",
        status: "attached",
        evidenceRefs: ["docs/openclinxr/runtime-realism-evidence-check-authored-idle-pose-required-2026-05-23.json"],
        blockers: [],
      }),
    ]);
    const learnerBundle = toLearnerRuntimeAssetBundle(bundle);
    bundle.evidenceGateRefs[0]?.evidenceRefs.push("mutated");
    expect(learnerBundle.evidenceGateRefs[0]?.evidenceRefs).not.toContain("mutated");
    expect(learnerBundle.identityScope).toBe("learner_runtime_opaque_bundle");
  });

  it("evaluates learner runtime use readiness from encounter bundle evidence gates", () => {
    const blockedBundle = createEdChestPainLocalEncounterRuntimeAssetBundle();

    expect(evaluateEncounterRuntimeLearnerUseGate(blockedBundle)).toMatchObject({
      canUseGeneratedBundleForLearnerRuntime: false,
      pendingGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
      attachedGateIds: [],
      blockers: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
        "quest_runtime_evidence_not_attached_to_encounter_bundle",
      ],
    });

    const readyBundle = {
      ...blockedBundle,
      evidenceGateRefs: blockedBundle.evidenceGateRefs.map((gateRef) => ({
        ...gateRef,
        status: "attached" as const,
        blockers: [],
        evidenceRefs: [`${gateRef.gateId}:evidence`],
      })),
    };

    expect(evaluateEncounterRuntimeLearnerUseGate(readyBundle)).toMatchObject({
      canUseGeneratedBundleForLearnerRuntime: true,
      pendingGateIds: [],
      attachedGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
      blockers: [],
    });
  });

  it("builds local publication metadata without learner-use or readiness claims", () => {
    const bundle = createEdChestPainLocalEncounterRuntimeAssetBundle();
    const metadata = buildEncounterRuntimeBundlePublicationMetadata(bundle, {
      humanoidRealismProfiles: [
        {
          actorRole: "patient",
          requiredRealismEvidenceIds: [
            "dialogue_viseme_and_gaze_mapping",
            "dialogue_eye_micro_saccade_blink_cue",
          ],
          claimScope: "metadata_only_not_visual_quality_evidence",
        },
        {
          actorRole: "nurse",
          requiredRealismEvidenceIds: [
            "dialogue_viseme_and_gaze_mapping",
            "generated_eyelid_blink_control_cue",
          ],
          claimScope: "metadata_only_not_visual_quality_evidence",
        },
        {
          actorRole: "spouse",
          requiredRealismEvidenceIds: [
            "generated_eyelid_blink_control_cue",
          ],
          claimScope: "metadata_only_not_visual_quality_evidence",
        },
      ],
    });

    expect(metadata).toMatchObject({
      bundleId: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
      scenarioId: "ed_chest_pain_priority_v1",
      stationId: "ed_chest_pain_station_v1",
      status: "blocked",
      assetStoreKind: "app_public_fixture",
      generatedAssetCount: 6,
      humanoidActorCount: 3,
      equipmentCount: 2,
      pendingEvidenceGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
      attachedEvidenceGateIds: [],
      learnerRuntimeUseBlocked: true,
      learnerRuntimeUseBlockers: expect.arrayContaining([
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
        "quest_runtime_evidence_not_attached_to_encounter_bundle",
      ]),
      publicationReviewEvidenceRefs: [],
      blockers: expect.arrayContaining([
        "approved_runtime_asset_review_evidence_missing",
      ]),
      publicationArtifactRefs: {
        sceneManifest: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets:scene-manifest.v1.json",
        learnerRuntimeBundle: "local_exam_run:ed_chest_pain_local_encounter:runtime-assets:learner-runtime-bundle.v1.json",
      },
      assemblyAuditMetadata: expect.objectContaining({
        schemaVersion: "openclinxr.runtime-bundle-assembly-audit.v1",
        claimBoundary: "asset_reference_audit_metadata_not_materialized_assets",
        sourceDefinitionRefs: expect.arrayContaining([
          "scenario_definition:ed_chest_pain_priority_v1",
          "station_definition:ed_chest_pain_station_v1",
          "runtime_scene_manifest:ed_chest_pain_runtime_scene_manifest_v1",
        ]),
        workOrderRefs: expect.arrayContaining([
          "scene_generation_work_order:ed_chest_pain_priority_v1",
          "runtime_bundle_binding:local_exam_run:ed_chest_pain_local_encounter:runtime-assets",
        ]),
        generatedAssetRefs: expect.arrayContaining([
          expect.objectContaining({
            assetId: "neutral_generated_humanoid_model_glb",
            scenarioAssetId: "spouse_anna_hayes_character",
            blobRef: expect.objectContaining({
              storeKind: "app_public_fixture",
              blobName: "xr-assets/humanoids/neutral-generated-human.glb",
            }),
          }),
        ]),
        humanoidMetadataRefs: expect.arrayContaining([
          expect.objectContaining({
            actorId: "patient_robert_hayes_v1",
            actorRole: "patient",
            modelAssetId: "neutral_generated_humanoid_model_glb",
            requiredSignalIds: expect.arrayContaining(["dialogue_viseme_and_gaze_mapping"]),
            claimScope: "metadata_only_not_visual_quality_evidence",
          }),
        ]),
        fallbackPosture: {
          usesLocalFixtureFallbackAssets: true,
          fallbackAssetIds: expect.arrayContaining([
            "neutral_generated_humanoid_model_glb",
            "ed_exam_bay_environment_shell_glb",
            "ecg_cart_12_lead_glb",
          ]),
          learnerUseBlockedUntilEvidenceGatesAttach: true,
        },
      }),
      humanoidRealismProfileSummary: {
        profileCount: 3,
        actorRoles: ["patient", "nurse", "spouse"],
        requiredSignalIds: expect.arrayContaining([
          "dialogue_viseme_and_gaze_mapping",
          "dialogue_eye_micro_saccade_blink_cue",
          "generated_eyelid_blink_control_cue",
        ]),
        claimScope: "metadata_only_not_visual_quality_evidence",
      },
      claimBoundary: "local_publication_metadata_not_runtime_readiness",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    });
  });

  it("keeps learner runtime use blocked when required runtime gates are missing or publication is prepared", () => {
    const missingGatePosture = evaluateEncounterRuntimeLearnerUseGate({ evidenceGateRefs: [] });
    expect(missingGatePosture).toMatchObject({
      canUseGeneratedBundleForLearnerRuntime: false,
      pendingGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
      blockers: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
        "quest_runtime_evidence_not_attached_to_encounter_bundle",
      ],
    });

    const legacyStaticBundleGatePosture = evaluateEncounterRuntimeLearnerUseGate({});
    expect(legacyStaticBundleGatePosture).toMatchObject({
      canUseGeneratedBundleForLearnerRuntime: false,
      pendingGateIds: ["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"],
      blockers: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
        "quest_runtime_evidence_not_attached_to_encounter_bundle",
      ],
    });

    const bundle = createEdChestPainLocalEncounterRuntimeAssetBundle();
    const metadata = buildEncounterRuntimeBundlePublicationMetadata(bundle, {
      publicationReviewEvidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
    });

    expect(metadata).toMatchObject({
      status: "publication_prepared_not_learner_use",
      learnerRuntimeUseBlocked: true,
      publicationReviewEvidenceRefs: ["generated_patient_model_review_gate_v1:privacy_evidence"],
      blockers: ["learner_runtime_use_requires_explicit_operator_gate_after_publication"],
      learnerRuntimeUseBlockers: [
        "runtime_realism_evidence_not_attached_to_encounter_bundle",
        "visual_qa_evidence_not_attached_to_encounter_bundle",
        "quest_runtime_evidence_not_attached_to_encounter_bundle",
      ],
      claimBoundary: "local_publication_metadata_not_runtime_readiness",
      notEvidenceFor: ["production_asset_readiness", "quest_readiness", "clinical_validity", "scoring_validity"],
    });
    expect(evaluateEncounterRuntimeLearnerUseGate(bundle).canUseGeneratedBundleForLearnerRuntime).toBe(false);
  });

  it("derives shared ED chest pain dynamic behavior coverage and dry-run summaries", () => {
    const learnerBundle = createEdChestPainLocalLearnerRuntimeAssetBundle();
    const requiredActorRoles = ["patient", "nurse", "family_member"];
    const dynamicBehaviorCoverage = buildEncounterDynamicBehaviorCoverageSummary({
      learnerRuntimeBundle: learnerBundle,
      requiredActorRoles,
      scenarioId: learnerBundle.scenarioId,
    });
    const dryRunSummary = buildEncounterFactoryDryRunSummary({
      requestId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin",
      scenarioId: learnerBundle.scenarioId,
      learnerRuntimeBundle: learnerBundle,
      actorRoles: requiredActorRoles,
      reviewAttached: false,
    });

    expect(dynamicBehaviorCoverage).toMatchObject({
      schemaVersion: "openclinxr.dynamic-encounter-behavior-coverage.v1",
      claimBoundary: "metadata_only_not_runtime_behavior_evidence",
      dialogueTurnCoverage: {
        actorRolesWithDialogueTurns: ["patient", "nurse", "family_member"],
        missingActorRoles: [],
        dialogueTurnCount: 6,
      },
      gazeTargetCoverage: {
        actorRolesWithGazeTargets: ["patient", "nurse", "family_member"],
        actorRolesWithActorTargetSupport: ["patient", "nurse", "family_member"],
        missingActorRoles: [],
      },
      actorRolePlacementCoverage: {
        actorRolesWithPlacements: ["patient", "nurse", "family_member"],
        missingActorRoles: [],
      },
      affectTimelineCoverage: {
        actorRolesWithAffectTimelines: ["patient", "nurse", "family_member"],
        missingActorRoles: [],
        affectTimelineCount: 6,
        claimBoundary: "metadata_only_not_runtime_facial_animation_evidence",
      },
      blockerIds: [],
      warningIds: [],
    });
    expect(dryRunSummary).toMatchObject({
      planId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin:dry-run-plan:v1",
      status: "review_plan_created_not_asset_generation",
      sourceScenarioId: "ed_chest_pain_priority_v1",
      actorRoles: ["patient", "nurse", "family_member"],
      stageIds: [
        "scenario_definition_to_asset_requirements",
        "humanoid_roles_to_realism_profiles",
        "runtime_bundle_binding_plan",
        "publication_and_evidence_gate_plan",
      ],
      blockerIds: ["runtime_asset_review_decisions_missing"],
      warningIds: [],
      recommendedNextAction: "attach_runtime_asset_review_decisions",
      claimBoundary: "encounter_factory_dry_run_not_asset_generation",
      evidenceBoundaries: {
        metadataOnlyPlan: true,
        generatedAssetsMaterialized: false,
        runtimeBundlePublished: false,
        learnerRuntimeEnabled: false,
        questReadinessClaimed: false,
        productionReadinessClaimed: false,
      },
    });
    expect(dryRunSummary.dynamicBehaviorCoverage).toEqual(dynamicBehaviorCoverage);
  });

  it("derives a deterministic encounter asset-needs/readiness manifest with concrete humanoid/prop/environment requirements", () => {
    const fullExplicitNeedsScenario = edChestPainScenario;
    const manifest = buildEncounterAssetNeedsReadinessManifest(fullExplicitNeedsScenario);
    const deterministicReplay = buildEncounterAssetNeedsReadinessManifest(fullExplicitNeedsScenario);

    expect(manifest.readyForDeterministicGeneration).toBe(true);
    expect(manifest.blockers).toHaveLength(0);
    expect(manifest.warnings).toHaveLength(0);
    expect(manifest.requiredHumanoids).toHaveLength(3);
    expect(manifest.requiredHumanoids.every((actorNeed) => actorNeed.hasExplicitAssetNeed)).toBe(true);
    expect(manifest.requiredHumanoids.every((actorNeed) => actorNeed.behaviorCategoryRequirements)).toBe(true);
    expect(manifest.requiredHumanoids.map((actorNeed) => actorNeed.actorId)).toEqual([
      "patient_robert_hayes_v1",
      "spouse_anna_hayes_v1",
      "nurse_maria_alvarez_v1",
    ]);
    const firstHumanoid = manifest.requiredHumanoids[0];
    if (!firstHumanoid) {
      throw new Error("Expected first required humanoid");
    }
    expect(firstHumanoid.sharedAssetLibraryLookupKeys).toHaveLength(3);
    expect(firstHumanoid.sharedAssetLibraryLookupKeys.map((entry) => entry.targetKind)).toEqual([
      "role_specific_humanoid_glb",
      "role_idle_animation_glb",
      "facial_lipsync_gaze_animation",
    ]);
    expect(manifest.requiredEnvironment).not.toBeNull();
    if (!manifest.requiredEnvironment) {
      throw new Error("Expected required environment");
    }
    expect(manifest.requiredEnvironment.assetNeedId).toBe("ed_exam_bay_environment");
    expect(manifest.requiredEnvironment.hasExplicitAssetNeed).toBe(true);
    expect(manifest.requiredEnvironment.sharedAssetLibraryLookupKey.targetKind).toBe("environment_shell_glb");
    expect(manifest.requiredEnvironment.roomSemanticTokens).toEqual(expect.arrayContaining(["ed", "exam", "bay", "v1"]));
    expect(manifest.requiredPropsAndEquipment).toHaveLength(6);
    expect(manifest.requiredPropsAndEquipment.every((equipmentNeed) => equipmentNeed.hasExplicitAssetNeed)).toBe(true);
    expect(manifest.requiredPropsAndEquipment.map((equipmentNeed) => equipmentNeed.source)).toEqual([
      "ed_chest_pain_priority_v1:12-lead ECG machine",
      "ed_chest_pain_priority_v1:bedside monitor",
      "ed_chest_pain_priority_v1:stretcher",
      "ed_chest_pain_priority_v1:IV pole",
      "ed_chest_pain_priority_v1:oxygen nasal cannula",
      "ed_chest_pain_priority_v1:wall clock",
    ]);
    expect(manifest.requiredPropsAndEquipment.every((equipmentNeed) => equipmentNeed.sharedAssetLibraryLookupKey.targetKind === "medical_equipment_glb")).toBe(true);
    expect(manifest.animationRequirements.requiredSignalIds).toEqual(expect.arrayContaining([
      "clinical_idle_animation",
      "conversation_animation",
      "history_question_pose",
      "role_specific_humanoid_glb",
    ]));
    expect(manifest.emotionRequirements.requiredSignalIds).toEqual(expect.arrayContaining([
      "patient_reporting_affect_clarity",
      "concern_acknowledgement_clarity",
    ]));
    expect(manifest.gazeRequirements.requiredSignalIds).toEqual(expect.arrayContaining([
      "learner_camera_facing",
      "limited_face_tracking",
      "speaker_targeting",
    ]));
    expect(manifest.lipSyncRequirements.requiredSignalIds).toEqual(expect.arrayContaining([
      "viseme_phoneme_map",
      "patient_voice_projection",
      "dialogue_viseme_and_gaze_mapping",
    ]));
    expect(manifest.sharedAssetLibrarySemanticKeys).toEqual(expect.arrayContaining([
      ...manifest.requiredHumanoids.flatMap((actorNeed) => actorNeed.sharedAssetLibraryLookupKeys.map((entry) => entry.lookupKey)),
      manifest.requiredEnvironment.sharedAssetLibraryLookupKey.lookupKey,
      ...manifest.requiredPropsAndEquipment.map((equipmentNeed) => equipmentNeed.sharedAssetLibraryLookupKey.lookupKey),
    ]));
    expect(manifest.sharedAssetLibrarySemanticKeys).toHaveLength(manifest.sharedAssetLibrarySemanticKeys.length);
    expect(manifest).toEqual(deterministicReplay);
    expect(manifest.schemaVersion).toBe("openclinxr.encounter-asset-needs-readiness.v1");
  });

  it("flags communication-profile-free actors as warnings while deriving a deterministic manifest", () => {
    const fullExplicitNeedsScenario = {
      ...edChestPainScenario,
      actors: edChestPainScenario.actors.map((actor) => {
        if (actor.actorId !== "spouse_anna_hayes_v1") {
          return actor;
        }
        const { communicationProfile: _communicationProfile, ...actorWithoutProfile } = actor;
        return actorWithoutProfile;
      }),
    };
    const manifest = buildEncounterAssetNeedsReadinessManifest(fullExplicitNeedsScenario);

    expect(manifest.readyForDeterministicGeneration).toBe(false);
    expect(manifest.blockers).toHaveLength(0);
    expect(manifest.warnings).toContain("actor_missing_communication_profile:spouse_anna_hayes_v1");
    expect(manifest.requiredHumanoids.find((actor) => actor.actorId === "spouse_anna_hayes_v1")?.hasExplicitAssetNeed).toBe(true);
    expect(manifest.requiredHumanoids.find((actor) => actor.actorId === "spouse_anna_hayes_v1")?.inferredFromActorId).toBe(true);
  });

  it("derives a learner-facing runtime bundle without tenant/user/exam identifiers", () => {
    const encounterBundle = createEdChestPainLocalEncounterRuntimeAssetBundle({
      tenantId: "tenant_alpha",
      userId: "learner_1",
      examRunId: "exam_run_1",
      encounterId: "encounter_1",
    });
    const learnerBundle = toLearnerRuntimeAssetBundle(encounterBundle);

    expect(learnerBundle.identityScope).toBe("learner_runtime_opaque_bundle");
    expect(learnerBundle.bundleId).toBe("exam_run_1:encounter_1:runtime-assets");
    expect("tenantId" in learnerBundle).toBe(false);
    expect("userId" in learnerBundle).toBe(false);
    expect("examRunId" in learnerBundle).toBe(false);
    expect("encounterId" in learnerBundle).toBe(false);
    expect(createEdChestPainLocalLearnerRuntimeAssetBundle().identityScope).toBe("learner_runtime_opaque_bundle");
  });

  it("resolves the same encounter bundle contract against Azurite and Azure Blob stores", () => {
    const azuriteBundle = createEdChestPainLocalEncounterRuntimeAssetBundle({
      assetStore: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
      },
    });
    expect(resolveRuntimeAssetUrl(azuriteBundle.environment))
      .toBe("http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/xr-assets/environment/ed-exam-bay-shell.glb");
    expect(azuriteBundle.environment.blob.storeKind).toBe("azurite_blob");

    const azureStore = resolveRuntimeAssetStoreConfig({
      storeKind: "azure_blob",
      accountName: "openclinxrprodassets",
      containerName: "tenant-assets",
    });
    expect(resolveRuntimeAssetBlobUrl(azureStore, "/generated/humanoids/patient.glb"))
      .toBe("https://openclinxrprodassets.blob.core.windows.net/tenant-assets/generated/humanoids/patient.glb");

    const azureBundle = createEdChestPainLocalEncounterRuntimeAssetBundle({
      assetStore: azureStore,
    });
    expect(resolveRuntimeAssetUrl(findRuntimeActorAsset(azureBundle, "nurse_maria_alvarez_v1")?.model ?? azureBundle.environment))
      .toBe("https://openclinxrprodassets.blob.core.windows.net/tenant-assets/xr-assets/humanoids/neutral-generated-human.glb");
    expect(azureBundle.assetStoreKind).toBe("azure_blob");
  });

  it("registers generated blob-backed asset references into a frozen encounter bundle", () => {
    const assetStore = resolveRuntimeAssetStoreConfig({
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
    });
    const patientModel = registerGeneratedRuntimeAssetReference({
      assetId: "generated_patient_model_v17",
      version: "v17",
      kind: "humanoid_model",
      displayName: "Generated patient model v17",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/generated_patient_model_v17/v17/model.glb",
      contentType: "model/gltf-binary",
      contentHash: "sha256:patient-model-v17",
      assetStore,
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["generated_human_rigging_report_v17", "skin_clothing_provenance_v17"],
    });
    const roomShell = registerGeneratedRuntimeAssetReference({
      assetId: "generated_ed_room_shell_v4",
      version: "v4",
      kind: "environment_model",
      displayName: "Generated ED room shell v4",
      scenarioAssetId: "ed_exam_bay_environment",
      blobName: "tenants/local/asset-library/generated_ed_room_shell_v4/v4/model.glb",
      contentType: "model/gltf-binary",
      assetStore,
      reviewStatus: "approved_for_local_runtime",
      provenanceRefs: ["environment_generation_report_v4"],
    });

    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "exam_run_2:encounter_9:runtime-assets",
      tenantId: "local",
      userId: "learner_2",
      examRunId: "exam_run_2",
      encounterId: "encounter_9",
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStore,
      environment: roomShell,
      actors: [{
        actorId: "patient_robert_hayes_v1",
        embodiment: "humanoid",
        role: "patient",
        model: patientModel,
        animationClips: [],
        gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
      }],
    });

    expect(bundle.frozenForEncounter).toBe(true);
    expect(bundle.actors[0]?.model.blob.contentHash).toBe("sha256:patient-model-v17");
    expect(resolveRuntimeAssetUrl(bundle.actors[0]?.model ?? bundle.environment))
      .toBe("http://127.0.0.1:10000/devstoreaccount1/openclinxr-assets/tenants/local/asset-library/generated_patient_model_v17/v17/model.glb");
    expect(bundle.notEvidenceFor).toContain("clinical_validity");
  });

  it("promotes generated encounter bundles only after required local runtime asset reviews", () => {
    const assetStore = resolveRuntimeAssetStoreConfig({ storeKind: "azurite_blob", containerName: "openclinxr-assets" });
    const patientModel = registerGeneratedRuntimeAssetReference({
      assetId: "generated_patient_model_review_gate_v1",
      version: "v1",
      kind: "humanoid_model",
      displayName: "Generated patient model review gate v1",
      scenarioAssetId: "patient_robert_hayes_character",
      blobName: "tenants/local/asset-library/generated_patient_model_review_gate_v1/v1/model.glb",
      contentType: "model/gltf-binary",
      assetStore,
      reviewStatus: "blocked",
      provenanceRefs: ["generated_human_rigging_report_review_gate_v1"],
    });
    const roomShell = registerGeneratedRuntimeAssetReference({
      assetId: "generated_ed_room_review_gate_v1",
      version: "v1",
      kind: "environment_model",
      displayName: "Generated ED room review gate v1",
      scenarioAssetId: "ed_exam_bay_environment",
      blobName: "tenants/local/asset-library/generated_ed_room_review_gate_v1/v1/model.glb",
      contentType: "model/gltf-binary",
      assetStore,
      reviewStatus: "blocked",
      provenanceRefs: ["environment_generation_report_review_gate_v1"],
    });
    const bundle = buildEncounterRuntimeAssetBundle({
      bundleId: "scene_generation_request:ed_chest_pain_priority_v1:local-admin:runtime-assets",
      tenantId: "local",
      userId: "learner_2",
      examRunId: "exam_run_2",
      encounterId: "encounter_9",
      stationId: "ed_chest_pain_station_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      assetStore,
      environment: roomShell,
      actors: [{
        actorId: "patient_robert_hayes_v1",
        embodiment: "humanoid",
        role: "patient",
        model: patientModel,
        animationClips: [],
        gazeProfile: { defaultTarget: "learner_camera", supportsActorTargets: true },
      }],
    });

    const blocked = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle,
      decisions: [
        {
          assetId: patientModel.assetId,
          reviewerRole: "asset_pipeline",
          reviewerId: "asset_pipeline_reviewer",
          decision: "approved_for_local_runtime",
          comments: "Generated humanoid references are present for local runtime only.",
          evidenceRefs: ["generated_human_rigging_report_review_gate_v1"],
          reviewedAt: "2026-05-22T23:20:00.000Z",
        },
      ],
    });

    expect(blocked.promoted).toBe(false);
    expect(blocked.promotedBundle).toBeNull();
    expect(blocked.blockers).toContain("generated_patient_model_review_gate_v1:asset_currently_blocked");
    expect(blocked.blockers).toContain("generated_patient_model_review_gate_v1:missing_runtime_asset_review:security_privacy");
    expect(blocked.blockers).toContain("generated_ed_room_review_gate_v1:missing_runtime_asset_review:asset_pipeline");

    const firstActor = bundle.actors[0];
    expect(firstActor).toBeDefined();
    if (!firstActor) {
      throw new Error("Expected runtime bundle to include an actor for promotion gating.");
    }

    const promoted = promoteEncounterRuntimeAssetBundleForLocalUse({
      bundle: {
        ...bundle,
        environment: { ...bundle.environment, reviewStatus: "approved_for_local_runtime" },
        actors: [{ ...firstActor, model: { ...patientModel, reviewStatus: "approved_for_local_runtime" } }],
      },
      decisions: [patientModel, roomShell].flatMap((asset) => [
        {
          assetId: asset.assetId,
          reviewerRole: "asset_pipeline" as const,
          reviewerId: "asset_pipeline_reviewer",
          decision: "approved_for_local_runtime" as const,
          comments: "Generated asset references are present for local runtime only.",
          evidenceRefs: [`${asset.assetId}:pipeline_evidence`],
          reviewedAt: "2026-05-22T23:20:00.000Z",
        },
        {
          assetId: asset.assetId,
          reviewerRole: "security_privacy" as const,
          reviewerId: "security_privacy_reviewer",
          decision: "approved_for_local_runtime" as const,
          comments: "No identity-bearing asset URLs or production storage claims.",
          evidenceRefs: [`${asset.assetId}:privacy_evidence`],
          reviewedAt: "2026-05-22T23:21:00.000Z",
        },
      ]),
    });

    expect(promoted.promoted).toBe(true);
    expect(promoted.promotedBundle?.environment.reviewStatus).toBe("approved_for_local_runtime");
    expect(promoted.promotedBundle?.actors[0]?.model.reviewStatus).toBe("approved_for_local_runtime");
    expect(promoted.notEvidenceFor).toContain("quest_readiness");
  });

  it("builds a production readiness ladder for a named clinical artifact without claiming release readiness", () => {
    const patient = requireManifest(createEdChestPainLocalAssetEvidenceFixtureManifests(), 0);

    expect(evaluateAssetProductionReadinessLadder(patient)).toEqual({
      assetId: "patient_robert_hayes_character",
      scenarioId: "ed_chest_pain_priority_v1",
      productionReady: false,
      blockers: [
        "quest_qa_production_limitations_present",
        "visual_clinical_critique_missing",
      ],
      steps: [
        {
          step: "provenance_license",
          status: "complete",
          evidenceRefs: ["openclinxr-local-asset-evidence-fixture-2026-05-06", "patient_robert_hayes_character_local_fixture_provenance"],
          blockers: [],
        },
        {
          step: "generation_evidence",
          status: "complete",
          evidenceRefs: [
            "patient_robert_hayes_character_canonical_skeleton_report",
            "patient_robert_hayes_character_skin_clothing_provenance",
            "patient_robert_hayes_character_retargeting_report",
          ],
          blockers: [],
        },
        {
          step: "optimization_evidence",
          status: "complete",
          evidenceRefs: [
            "patient_robert_hayes_character_lod0",
            "patient_robert_hayes_character_lod1",
            "patient_robert_hayes_character_lod2",
            "patient_robert_hayes_character_texture_budget_report",
            "patient_robert_hayes_character_collider_simplification_report",
          ],
          blockers: [],
        },
        {
          step: "quest_qa",
          status: "blocked",
          evidenceRefs: ["sim_qa_ready:2026-05-06T00:00:00.000Z"],
          blockers: ["quest_qa_production_limitations_present"],
        },
        {
          step: "visual_clinical_critique",
          status: "blocked",
          evidenceRefs: [],
          blockers: ["visual_clinical_critique_missing"],
        },
        {
          step: "production_release",
          status: "blocked",
          evidenceRefs: [],
          blockers: [
            "quest_qa_production_limitations_present",
            "visual_clinical_critique_missing",
          ],
        },
      ],
    });
  });

  it("builds a named artifact production review packet with next evidence actions", () => {
    const patient = requireManifest(createEdChestPainLocalAssetEvidenceFixtureManifests(), 0);

    expect(buildAssetProductionReviewPacket(patient)).toMatchObject({
      assetId: "patient_robert_hayes_character",
      scenarioId: "ed_chest_pain_priority_v1",
      displayName: "Robert Hayes patient character",
      kind: "character",
      targetRuntime: "quest3_webxr",
      productionReady: false,
      claimBoundary: "review_packet_not_release_approval",
      nextReviewStep: "quest_qa",
      blockerCount: 2,
      evidenceChecklist: [
        {
          step: "provenance_license",
          status: "complete",
          recommendedAction: "Keep evidence attached for release review.",
        },
        {
          step: "generation_evidence",
          status: "complete",
          recommendedAction: "Keep evidence attached for release review.",
        },
        {
          step: "optimization_evidence",
          status: "complete",
          recommendedAction: "Keep evidence attached for release review.",
        },
        {
          step: "quest_qa",
          status: "blocked",
          blockers: ["quest_qa_production_limitations_present"],
          recommendedAction: "Run or attach Quest QA evidence and resolve any production-limiting limitations before release review.",
        },
        {
          step: "visual_clinical_critique",
          status: "blocked",
          blockers: ["visual_clinical_critique_missing"],
          recommendedAction: "Complete visual clinical realism critique with simulation/clinical reviewers before release review.",
        },
        {
          step: "production_release",
          status: "blocked",
          blockers: ["quest_qa_production_limitations_present", "visual_clinical_critique_missing"],
          recommendedAction: "Do not release until every prior evidence step is complete and no production blockers remain.",
        },
      ],
    });
  });

  it("builds a station-level production readiness ladder without promoting placeholder evidence to release readiness", () => {
    const registry = new InMemoryAssetRegistry();
    for (const manifest of createEdChestPainLocalAssetEvidenceFixtureManifests()) {
      registry.upsert(manifest);
    }

    const ladder = registry.evaluateScenarioProductionReadinessLadder(edChestPainScenario);

    expect(ladder.productionReady).toBe(false);
    expect(ladder.assetCount).toBe(10);
    expect(ladder.productionReadyAssetIds).toEqual([]);
    expect(ladder.blockedAssetIds).toEqual(edChestPainRequiredAssetIds);
    expect(ladder.missingRequiredAssetIds).toEqual([]);
    expect(ladder.blockers).toEqual(
      expect.arrayContaining([
        "patient_robert_hayes_character:quest_qa_production_limitations_present",
        "patient_robert_hayes_character:visual_clinical_critique_missing",
        "nurse_maria_alvarez_character:visual_clinical_critique_missing",
        "ed_exam_bay_environment:visual_clinical_critique_missing",
      ]),
    );
    expect(ladder.assetLadders.every((assetLadder) => assetLadder.steps.some((step) => step.step === "visual_clinical_critique"))).toBe(true);
  });

  it("does not count whitespace-only source refs as production asset generation evidence", () => {
    const manifest = {
      ...requireManifest(createEdChestPainLocalAssetEvidenceFixtureManifests(), 0),
      provenance: {
        generationMethod: "anny" as const,
        sourceRefs: [" "],
        licenseStatus: "approved" as const,
      },
    };

    expect(evaluateScenarioGenerationEvidence([manifest])).toMatchObject({
      generatedHumanRiggingObserved: false,
      skinClothingProvenanceObserved: false,
      placeholderOnly: false,
      blockers: expect.arrayContaining([
        "generated_human_rigging_missing",
        "skin_clothing_provenance_missing",
      ]),
    });
  });

  it("creates dev-ready placeholder manifests for every seed-bank scenario without production release claims", () => {
    const registry = new InMemoryAssetRegistry();
    for (const scenario of scenarioBank) {
      for (const manifest of createScenarioPlaceholderManifests(scenario)) {
        registry.upsert(manifest);
      }
    }

    for (const scenario of scenarioBank) {
      const readiness = registry.evaluateScenarioReadiness(scenario);
      expect(readiness.devReady).toBe(true);
      expect(readiness.productionReady).toBe(false);
      expect(readiness.missingRequiredAssetIds).toEqual([]);
      expect(readiness.blockedAssets).toEqual([]);
      expect(readiness.productionBlockedAssets).toHaveLength(scenario.assetNeeds?.length ?? 0);
      expect(readiness.stationBudget.blockers).toEqual([]);
    }
  });

  it("keeps SkinTokens as an offline rigging sidecar candidate rather than a Quest runtime dependency", () => {
    const riggingTools = selectAssetPipelineToolsForLane("rigging");
    expect(riggingTools.map((tool) => tool.toolId)).toEqual(["mesh2motion", "skintokens_tokenrig"]);

    const skinTokens = riggingTools.find((tool) => tool.toolId === "skintokens_tokenrig");
    expect(skinTokens).toBeDefined();
    if (!skinTokens) {
      throw new Error("Missing SkinTokens tool contract.");
    }

    const readiness = evaluateAssetPipelineTool(skinTokens);
    expect(readiness).toEqual({
      toolId: "skintokens_tokenrig",
      authoringAllowedNow: false,
      productionRuntimeAllowed: false,
      sidecarCandidate: true,
      blockers: ["not_apple_silicon_default", "cuda_gpu_required", "model_data_provenance_review_required"],
      warnings: ["not_a_production_runtime_dependency", "not_preferred_for_initial_build"],
    });
    expect(skinTokens.prohibitedUses).toContain("quest_runtime_dependency");
    expect(skinTokens.requiredOutputEvidence).toContain("skin_weight_quality_report");
  });

  it("marks Blender and Mesh2Motion as authoring tools while keeping production runtime empty", () => {
    const matrix = evaluateAssetPipelineToolMatrix();

    expect(matrix.authoringReadyToolIds).toEqual([
      "anny",
      "blender",
      "makehuman_outputs",
      "mesh2motion",
    ]);
    expect(matrix.productionRuntimeToolIds).toEqual([]);
    expect(matrix.sidecarCandidateToolIds).toEqual(["skintokens_tokenrig", "audio2face_adapter"]);
    expect(matrix.blockedToolIds).toEqual(["stablegen"]);
    expect(matrix.policyBlockers).toEqual([
      "skintokens_tokenrig:not_apple_silicon_default",
      "skintokens_tokenrig:cuda_gpu_required",
      "skintokens_tokenrig:model_data_provenance_review_required",
      "stablegen:gpl3_source_path",
      "stablegen:legal_exception_required",
      "stablegen:license_exception_required",
      "audio2face_adapter:commercial_terms_review_required",
      "audio2face_adapter:cloud_or_gpu_dependency_review_required",
    ]);
  });

  it("does not treat whitespace-only source refs as reviewed asset pipeline evidence", () => {
    const anny = recommendedAssetPipelineTools.find((tool) => tool.toolId === "anny");
    if (!anny) {
      throw new Error("Missing Anny tool contract.");
    }

    expect(evaluateAssetPipelineTool({
      ...anny,
      toolId: "blank_source_tool",
      sourceRefs: [" "],
    })).toMatchObject({
      toolId: "blank_source_tool",
      authoringAllowedNow: false,
      productionRuntimeAllowed: false,
      blockers: ["missing_source_refs"],
    });
  });

  it("requires every recommended pipeline tool to cite source records and explicit evidence outputs", () => {
    expect(recommendedAssetPipelineTools).toHaveLength(7);

    for (const tool of recommendedAssetPipelineTools) {
      expect(tool.sourceRefs.length, tool.toolId).toBeGreaterThan(0);
      expect(tool.sourceRefs.every((sourceRef) => sourceRef.trim().length > 0), tool.toolId).toBe(true);
      expect(tool.requiredOutputEvidence.length, tool.toolId).toBeGreaterThan(0);
      expect(tool.prohibitedUses.length, tool.toolId).toBeGreaterThan(0);
    }
  });

  it("builds an ED bay environment generation packet without claiming produced assets or Quest readiness", () => {
    const packet = buildEnvironmentGenerationPacket(
      edChestPainScenario,
      createEdChestPainPlaceholderManifests(),
    );

    expect(packet).toMatchObject({
      scenarioId: "ed_chest_pain_priority_v1",
      environmentAssetId: "ed_exam_bay_environment",
      displayName: "Emergency department exam bay",
      claimBoundary: "environment_generation_plan_not_generated_asset",
      targetRuntime: "quest3_webxr",
      authoringToolIds: ["blender"],
      blockedToolIds: ["stablegen"],
      nextReviewGate: "attach_environment_generation_evidence",
      readyForGenerationReview: false,
    });
    expect(packet.spatialZones.map((zone) => zone.zoneId)).toEqual([
      "learner_entry",
      "patient_bedside",
      "nurse_workflow",
      "family_interrupt",
      "diagnostic_equipment",
    ]);
    expect(packet.requiredAssetIds).toEqual(edChestPainRequiredAssetIds);
    expect(packet.optionalContextAssetIds).toEqual([]);
    expect(packet.questBudget).toMatchObject({
      blockers: [],
      totalTriangles: 108000,
      totalTextureMegabytes: 152,
      totalDrawCalls: 60,
    });
    expect(packet.reviewGates).toEqual([
      {
        gate: "provenance_license",
        status: "complete",
        evidenceRefs: ["openclinxr-placeholder-environment"],
        blockers: [],
        recommendedAction: "Keep approved environment source and license records attached before generation review.",
      },
      {
        gate: "attach_environment_generation_evidence",
        status: "blocked",
        evidenceRefs: [],
        blockers: ["environment_generation_evidence_missing"],
        recommendedAction: "Attach Blender/manual-modeling export evidence, equipment library records, and scene-layout notes before review.",
      },
      {
        gate: "attach_optimization_evidence",
        status: "blocked",
        evidenceRefs: [],
        blockers: ["environment_optimization_evidence_missing"],
        recommendedAction: "Attach LOD, texture-compression, collider, and draw-call budget reports for Quest/WebXR review.",
      },
      {
        gate: "visual_clinical_critique",
        status: "blocked",
        evidenceRefs: [],
        blockers: ["visual_clinical_critique_missing"],
        recommendedAction: "Complete clinical/simulation review of spatial layout, equipment realism, and distraction fidelity.",
      },
      {
        gate: "quest_runtime_evidence",
        status: "blocked",
        evidenceRefs: [],
        blockers: ["quest_runtime_evidence_not_attached"],
        recommendedAction: "Attach approved worn-headset or documented Quest/WebXR evidence before any runtime-readiness claim.",
      },
    ]);
  });

  it("builds a seed-bank environment generation queue without promoting placeholder scenes", () => {
    const manifests = scenarioBank.flatMap((scenario) => createScenarioPlaceholderManifests(scenario));
    const queue = buildEnvironmentGenerationQueue(scenarioBank, manifests);

    expect(queue.scenarioCount).toBe(scenarioBank.length);
    expect(queue.packetCount).toBe(scenarioBank.length);
    expect(queue.readyForGenerationReviewScenarioIds).toEqual([]);
    expect(queue.blockedScenarioIds).toEqual(scenarioBank.map((scenario) => scenario.scenarioId));
    expect(queue.nextReviewGateCounts).toEqual({
      attach_environment_generation_evidence: scenarioBank.length,
    });
    expect(queue.packets.every((packet) => packet.claimBoundary === "environment_generation_plan_not_generated_asset")).toBe(true);
    expect(queue.packets.every((packet) => packet.blockedToolIds.includes("stablegen"))).toBe(true);
  });

  it("builds an actionable ED bay environment authoring work order from the generation packet", () => {
    const packet = buildEnvironmentGenerationPacket(
      edChestPainScenario,
      createEdChestPainPlaceholderManifests(),
    );
    const workOrder = buildEnvironmentGenerationWorkOrder(packet);

    expect(workOrder).toMatchObject({
      workOrderId: "environment_work_order:ed_chest_pain_priority_v1:ed_exam_bay_environment",
      scenarioId: "ed_chest_pain_priority_v1",
      environmentAssetId: "ed_exam_bay_environment",
      targetRuntime: "quest3_webxr",
      authoringToolId: "blender",
      claimBoundary: "authoring_work_order_not_generated_asset",
      nextEvidenceGate: "attach_environment_generation_evidence",
      status: "blocked_pending_evidence",
    });
    expect(workOrder.requiredOutputEvidence).toEqual([
      "blender_bake_report",
      "gltf_validation_report",
      "quest_budget_report",
      "environment_spatial_layout_notes",
      "clinical_visual_review_request",
    ]);
    expect(workOrder.assetBundle).toEqual({
      requiredAssetIds: [
        ...edChestPainRequiredAssetIds,
      ],
      optionalContextAssetIds: [],
      spatialZoneCount: 5,
      spatialAnchorCount: 15,
    });
    expect(workOrder.tasks.map((task) => task.taskId)).toEqual([
      "prepare_scene_layout",
      "model_static_room_shell",
      "place_required_equipment",
      "export_quest_budget_reports",
      "request_clinical_visual_review",
    ]);
    expect(workOrder.tasks.every((task) => task.status === "pending")).toBe(true);
    expect(workOrder.prohibitedActions).toEqual([
      "do_not_use_stablegen_without_legal_exception",
      "do_not_add_blender_as_production_runtime_dependency",
      "do_not_claim_quest_runtime_readiness_without_attached_worn_headset_evidence",
      "do_not_release_without_visual_clinical_critique",
    ]);
    expect(workOrder.operatorHandoff).toMatchObject({
      summary: "Emergency department exam bay: 5 authoring tasks and 8 evidence outputs before generation review.",
      nextAction: "Attach Blender/manual-modeling export evidence, equipment library records, and scene-layout notes before review.",
      reviewBlockerIds: [
        "environment_generation_evidence_missing",
        "environment_optimization_evidence_missing",
        "quest_runtime_evidence_not_attached",
        "visual_clinical_critique_missing",
      ],
      claimBoundary: "operator_handoff_not_asset_generation",
    });
    expect(workOrder.operatorHandoff.missingEvidenceIds).toContain("equipment_placement_manifest");
  });

  it("builds a seed-bank environment work-order queue from generation packets", () => {
    const generationQueue = buildEnvironmentGenerationQueue(
      scenarioBank,
      scenarioBank.flatMap((scenario) => createScenarioPlaceholderManifests(scenario)),
    );
    const workOrderQueue = buildEnvironmentGenerationWorkOrderQueue(generationQueue);

    expect(workOrderQueue).toMatchObject({
      scenarioCount: scenarioBank.length,
      workOrderCount: scenarioBank.length,
      blockedWorkOrderCount: scenarioBank.length,
      pendingTaskCount: scenarioBank.length * 5,
      readyForGenerationReviewWorkOrderIds: [],
      claimBoundary: "work_order_queue_not_asset_production",
      nextEvidenceGateCounts: { attach_environment_generation_evidence: scenarioBank.length },
    });
    expect(workOrderQueue.workOrders[0]).toMatchObject({
      scenarioId: "ed_chest_pain_priority_v1",
      environmentAssetId: "ed_exam_bay_environment",
      status: "blocked_pending_evidence",
      claimBoundary: "authoring_work_order_not_generated_asset",
    });
    expect(workOrderQueue.prohibitedActionCounts).toEqual({
      do_not_use_stablegen_without_legal_exception: scenarioBank.length,
      do_not_add_blender_as_production_runtime_dependency: scenarioBank.length,
      do_not_claim_quest_runtime_readiness_without_attached_worn_headset_evidence: scenarioBank.length,
      do_not_release_without_visual_clinical_critique: scenarioBank.length,
    });
    expect(workOrderQueue.missingEvidenceCounts).toMatchObject({
      blender_bake_report: scenarioBank.length,
      equipment_placement_manifest: scenarioBank.length,
      clinical_visual_review_request: scenarioBank.length,
    });
  });

  it("builds an admin-initiated full scene generation pipeline work order", () => {
    const workOrder = buildScenarioSceneGenerationPipelineWorkOrder(edChestPainScenario);

    expect(workOrder).toMatchObject({
      workOrderId: "scene_generation_pipeline:ed_chest_pain_priority_v1",
      scenarioId: "ed_chest_pain_priority_v1",
      scenarioStatus: edChestPainScenario.status,
      initiatedFrom: "admin_scenario_configuration",
      claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
      approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
      targetRuntime: "quest3_webxr",
      storageTarget: {
        storeKind: "azurite_blob",
        containerName: "openclinxr-assets",
        blobPrefix: "scenario-assets/ed_chest_pain_priority_v1/",
        emulatorAllowed: true,
      },
      pipelineStageCount: 9,
    });
    expect(workOrder.characterAssetIds).toEqual(edChestPainCharacterAssetIds);
    expect(workOrder.environmentAssetIds).toEqual(["ed_exam_bay_environment"]);
    expect(workOrder.equipmentAssetIds).toEqual(edChestPainEquipmentAssetIds);
    expect(workOrder.stages.map((stage) => stage.stageId)).toEqual([
      "admin_scenario_configuration",
      "asset_need_expansion",
      "humanoid_generation",
      "hair_clothing_skin_generation",
      "rigging_animation_generation",
      "equipment_environment_generation",
      "blob_storage_publication",
      "runtime_bundle_binding",
      "review_and_quest_evidence",
    ]);
    expect(workOrder.stages[0]?.title).toBe("Scenario configuration captured for asset generation planning");
    expect(workOrder.requiredOutputEvidence).toEqual(expect.arrayContaining([
      "humanoid_mesh_manifest",
      "hair_clothing_skin_provenance",
      "license_provenance_report",
      "rig_validation_report",
      "facial_blendshape_map",
      "viseme_phoneme_map",
      "gaze_blink_control_map",
      "animation_clip_manifest",
      "collision_proxy_manifest",
      "environment_glbs",
      "equipment_glbs",
      "equipment_placement_manifest",
      "quest_budget_report",
      "blob_asset_urls",
      "learner_runtime_asset_bundle",
      "quest_runtime_evidence",
    ]));
    expect(workOrder.actorWorkOrders.map((actorWorkOrder) => actorWorkOrder.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(workOrder.actorWorkOrders.every((actorWorkOrder) =>
      actorWorkOrder.claimBoundary === "metadata_work_order_not_generated_asset"
      && actorWorkOrder.source === "scenario_actor_definition"
      && actorWorkOrder.requiredEvidenceIds.includes("humanoid_mesh_manifest")
      && actorWorkOrder.requiredEvidenceIds.includes("license_provenance_report")
      && actorWorkOrder.requiredEvidenceIds.includes("rig_validation_report")
      && actorWorkOrder.requiredEvidenceIds.includes("facial_blendshape_map")
      && actorWorkOrder.requiredEvidenceIds.includes("viseme_phoneme_map")
      && actorWorkOrder.requiredEvidenceIds.includes("gaze_blink_control_map")
      && actorWorkOrder.requiredEvidenceIds.includes("animation_clip_manifest")
      && actorWorkOrder.requiredEvidenceIds.includes("collision_proxy_manifest")
      && actorWorkOrder.evidenceGateRefs.includes("runtime_realism_evidence")
      && actorWorkOrder.evidenceGateRefs.includes("visual_qa_evidence")
      && actorWorkOrder.appearanceCues.roleAppropriateClothing.length > 0
      && actorWorkOrder.appearanceCues.hairOrHeadCovering.length > 0
      && actorWorkOrder.appearanceCues.skinMaterial.length > 0
      && actorWorkOrder.riggingAndAnimationCues.includes("locomotion_idle_conversation_animation_set")
      && actorWorkOrder.provenanceAndLicensingRefs.includes("no_agpl_or_copyleft_without_exception")
      && actorWorkOrder.optimizationAndPerformanceRefs.includes("quest_budget_report")
    )).toBe(true);
    expect(workOrder.environmentWorkOrder).toMatchObject({
      claimBoundary: "metadata_work_order_not_generated_asset",
      environmentAssetId: "ed_exam_bay_environment",
      evidenceGateRefs: expect.arrayContaining(["asset_production_review", "visual_qa_evidence", "quest_runtime_evidence"]),
      requiredEvidenceIds: expect.arrayContaining([
        "scene_layout_manifest",
        "equipment_placement_manifest",
        "license_provenance_report",
        "quest_budget_report",
      ]),
    });
    expect(workOrder.prohibitedActions).toContain("do_not_generate_assets_before_admin_scenario_configuration");
    expect(workOrder.prohibitedActions).toContain("do_not_use_agpl_or_copyleft_assets_without_legal_exception");
    expect(workOrder.prohibitedActions).toContain("do_not_materialize_production_assets_from_this_metadata_work_order");
  });

  it("adds reviewable humanoid realism metadata to ED actor work orders and manifests without readiness claims", () => {
    const workOrder = buildScenarioSceneGenerationPipelineWorkOrder(edChestPainScenario);
    const characterManifests = createEdChestPainPlaceholderManifests().filter((manifest) => manifest.kind === "character");

    for (const actorWorkOrder of workOrder.actorWorkOrders) {
      expectHumanoidRealismMetadata(actorWorkOrder.humanoidRealismMetadata, actorWorkOrder.actorRole);
      expect(actorWorkOrder.humanoidRealismMetadata.eyeAndGazeControls.eyeContactTargets.targetActorIds.length).toBeGreaterThan(0);
      expect(actorWorkOrder.humanoidRealismMetadata.fixtureStatus.materializedAssetGenerated).toBe(false);
      expect(Object.values(actorWorkOrder.humanoidRealismMetadata.claimBoundaries).every((claimed) => claimed === false)).toBe(true);
    }

    for (const manifest of characterManifests) {
      const humanoidRealismMetadata = manifest.humanoidRealismMetadata;
      expect(humanoidRealismMetadata).toBeDefined();
      if (!humanoidRealismMetadata) {
        throw new Error(`Expected humanoid realism metadata for ${manifest.id}.`);
      }
      expectHumanoidRealismMetadata(humanoidRealismMetadata, manifest.tags.includes("nurse") ? "nurse" : manifest.tags.includes("patient") ? "patient" : "family");
      expect(validateAssetManifestStructure(manifest).ok).toBe(true);
    }
  });

  it("consumes the pediatric asthma factory-planning projection without approving peds assets", () => {
    const workOrder = buildScenarioSceneGenerationPipelineWorkOrder(pediatricAsthmaScenario);
    const characterManifests = createScenarioPlaceholderManifests(pediatricAsthmaScenario).filter((manifest) => manifest.kind === "character");

    expect(pediatricAsthmaScenario.status).toBe("draft");
    expect(workOrder).toMatchObject({
      scenarioId: "peds_asthma_parent_anxiety_v1",
      scenarioStatus: "draft",
      claimBoundary: "admin_initiated_pipeline_contract_not_generated_asset",
      approvalBoundary: "scenario_status_preserved_no_generation_approval_inferred",
    });
    expect(JSON.stringify(workOrder).toLowerCase()).not.toContain("approved for asset generation");
    expect(JSON.stringify(workOrder).toLowerCase()).not.toContain("approved");
    expect(workOrder.stages[0]?.title).toBe("Scenario configuration captured for asset generation planning");
    expect(workOrder.actorWorkOrders.map((actorWorkOrder) => actorWorkOrder.actorRole)).toEqual([
      "patient",
      "family",
      "nurse",
    ]);
    expect(workOrder.actorWorkOrders.find((actorWorkOrder) => actorWorkOrder.actorId === "patient_maya_johnson_v1")).toMatchObject({
      ageBand: "child_or_adolescent",
      characterAssetId: "patient_maya_johnson_character",
      claimBoundary: "metadata_work_order_not_generated_asset",
      evidenceGateRefs: expect.arrayContaining(["runtime_realism_evidence", "visual_qa_evidence", "quest_runtime_evidence"]),
      appearanceCues: {
        roleAppropriateClothing: expect.arrayContaining(["patient_role_appropriate_clothing"]),
        hairOrHeadCovering: expect.arrayContaining(["patient_hair_or_head_covering_profile"]),
        skinMaterial: expect.arrayContaining(["patient_skin_material_or_morph_target_profile"]),
      },
    });
    expect(workOrder.environmentWorkOrder).toMatchObject({
      environmentAssetId: "pediatric_urgent_care_bay_environment",
      equipmentAssetIds: expect.arrayContaining([
        "pulse_oximeter_equipment",
        "nebulizer_mask_equipment",
        "oxygen_wall_port_equipment",
        "pediatric_stretcher_equipment",
        "parent_chair_equipment",
        "inhaler_spacer_equipment",
      ]),
      requiredEvidenceIds: expect.arrayContaining(["license_provenance_report", "quest_budget_report"]),
      claimBoundary: "metadata_work_order_not_generated_asset",
    });
    expect(workOrder.prohibitedActions).toEqual(expect.arrayContaining([
      "do_not_use_paid_or_cloud_generation_without_explicit_approval",
      "do_not_materialize_production_assets_from_this_metadata_work_order",
      "do_not_claim_quest_readiness_without_worn_headset_evidence",
    ]));
    for (const actorWorkOrder of workOrder.actorWorkOrders) {
      expectHumanoidRealismMetadata(actorWorkOrder.humanoidRealismMetadata, actorWorkOrder.actorRole);
      expect(actorWorkOrder.humanoidRealismMetadata.fixtureStatus.materializedAssetGenerated).toBe(false);
      expect(Object.values(actorWorkOrder.humanoidRealismMetadata.claimBoundaries).every((claimed) => claimed === false)).toBe(true);
    }
    for (const manifest of characterManifests) {
      const humanoidRealismMetadata = manifest.humanoidRealismMetadata;
      expect(humanoidRealismMetadata).toBeDefined();
      if (!humanoidRealismMetadata) {
        throw new Error(`Expected humanoid realism metadata for ${manifest.id}.`);
      }
      expectHumanoidRealismMetadata(humanoidRealismMetadata, manifest.tags.includes("nurse") ? "nurse" : manifest.tags.includes("patient") ? "patient" : "family");
      expect(validateAssetManifestStructure(manifest).ok).toBe(true);
    }
  });

  it("builds an admin-initiated scene generation pipeline queue for the seed bank", () => {
    const queue = buildScenarioSceneGenerationPipelineWorkOrderQueue(scenarioBank);

    expect(queue).toMatchObject({
      scenarioCount: scenarioBank.length,
      workOrderCount: scenarioBank.length,
      pendingStageCount: scenarioBank.length * 9,
      claimBoundary: "scene_generation_pipeline_queue_not_asset_production",
      featuredFactoryPlanningScenarioId: "peds_asthma_parent_anxiety_v1",
      featuredFactoryPlanningWorkOrderId: "scene_generation_pipeline:peds_asthma_parent_anxiety_v1",
      factoryPlanningClaimBoundary: "review_gated_factory_metadata_only",
      generationApprovalInferred: false,
    });
    expect(queue.workOrders[0]?.workOrderId).toBe("scene_generation_pipeline:ed_chest_pain_priority_v1");
    expect(queue.storageTargets[0]).toMatchObject({
      storeKind: "azurite_blob",
      containerName: "openclinxr-assets",
      emulatorAllowed: true,
    });
  });
});

function expectHumanoidRealismMetadata(metadata: HumanoidRealismMetadata, actorRole: string): void {
  expect(metadata).toMatchObject({
    schemaVersion: "openclinxr.humanoid-realism-metadata.v1",
    actorRole,
    metadataScope: "review_contract_only",
    fixtureStatus: {
      fixtureOnly: true,
      nonProduction: true,
      materializedAssetGenerated: false,
    },
    claimBoundaries: {
      productionReadinessClaimed: false,
      questReadinessClaimed: false,
      clinicalValidityClaimed: false,
      scoringValidityClaimed: false,
    },
  });
  expect(metadata.faceAndMouthControls.requiredBlendshapeIds).toEqual(expect.arrayContaining(["jaw_open", "blink_left", "blink_right"]));
  expect(metadata.faceAndMouthControls.requiredVisemeIds).toEqual(expect.arrayContaining(["sil", "aa", "m_b_p"]));
  expect(metadata.eyeAndGazeControls.eyeContactTargets.allowedTargetKinds).toEqual(expect.arrayContaining(["learner_camera", "actor"]));
  expect(metadata.poseAndAnimationNeeds.idleClipNeeds.length).toBeGreaterThan(0);
  expect(metadata.poseAndAnimationNeeds.conversationGestureNeeds.length).toBeGreaterThan(0);
  expect(metadata.appearanceConstraints.clothing.length).toBeGreaterThan(0);
  expect(metadata.appearanceConstraints.skinMaterial.length).toBeGreaterThan(0);
  expect(metadata.appearanceConstraints.hairOrHeadCovering.length).toBeGreaterThan(0);
  expect(metadata.collisionAndInteractionProxyNeeds.requiredProxyIds.length).toBeGreaterThan(0);
  expect(metadata.provenanceAndLicenseNeeds.requiredRefs).toEqual(expect.arrayContaining(["source_asset_manifest", "license_provenance_report"]));
  expect(metadata.provenanceAndLicenseNeeds.prohibitedSourcePosture).toEqual(expect.arrayContaining([
    "agpl_or_copyleft_without_legal_exception",
    "unreviewed_paid_or_cloud_generation",
  ]));
  expect(metadata.limitations).toEqual(expect.arrayContaining([
    "metadata_contract_only",
    "no_materialized_humanoid_asset_generated",
  ]));
  expect(metadata.visualQaBlockers).toEqual(expect.arrayContaining([
    "visual_qa_not_attached",
    "facial_expression_quality_not_reviewed",
    "eye_contact_and_blink_quality_not_reviewed",
    "mouth_viseme_quality_not_reviewed",
    "pose_clothing_skin_hair_quality_not_reviewed",
    "collision_interaction_proxy_not_reviewed",
  ]));
  expect(metadata.requiredReviewEvidenceIds).toEqual(expect.arrayContaining([
    "facial_blendshape_map",
    "viseme_phoneme_map",
    "gaze_blink_control_map",
    "animation_clip_manifest",
    "collision_proxy_manifest",
    "license_provenance_report",
    "visual_qa_evidence",
  ]));
}
